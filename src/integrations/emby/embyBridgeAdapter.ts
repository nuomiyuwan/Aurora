import {
  isAbortError,
  throwIfAborted,
} from '../../features/discovery/search/types'
import type {
  EmbyBridgeImageRequest,
  EmbyBridgeItemRequest,
  EmbyBridgeSearchRequest,
  EmbyBridgeSearchResponse,
  EmbyConnectionInput,
  EmbyConnectionState,
  EmbyImageResponse,
  EmbyItemDto,
  EmbyPublicError,
  EmbyRendererBridgeAdapter,
  EmbyResult,
  EmbySearchRequest,
  EmbySearchResponse,
} from './embyTypes'

const EMBY_DEV_ROOT = '/__aurora/emby'

// Read the declared preload contract directly so renderer-side calls cannot
// silently drift from src/desktopBridge.d.ts.
const readDesktopBridge = () =>
  typeof window === 'undefined' ? undefined : window.desktopBridge

const isUnavailableError = (error: EmbyPublicError) =>
  error.code === 'EMBY_NOT_CONNECTED' ||
  error.code === 'EMBY_FETCH_UNAVAILABLE'

const unwrapResult = <T>(result: EmbyResult<T>): T => {
  if (result.ok) return result.data
  if (isUnavailableError(result.error)) {
    throw new EmbyConnectionUnavailableError(result.error.message)
  }
  throw new EmbyBridgeError(result.error)
}

const readResponseError = async (response: Response) => {
  const text = await response.text().catch(() => '')
  return text.trim() || `HTTP ${response.status}`
}

const fetchEnvelope = async <T>(
  input: RequestInfo | URL,
  init: RequestInit,
) => {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new EmbyConnectionUnavailableError(
      error instanceof Error ? error.message : 'Emby dev endpoint unavailable',
    )
  }
  if (response.status === 404 || response.status === 503) {
    throw new EmbyConnectionUnavailableError(
      await readResponseError(response),
    )
  }

  let envelope: EmbyResult<T>
  try {
    envelope = await response.json() as EmbyResult<T>
  } catch {
    throw new EmbyBridgeError({
      code: 'EMBY_BAD_RESPONSE',
      message: await readResponseError(response),
      status: response.status,
      retryable: response.status >= 500,
    })
  }
  return unwrapResult(envelope)
}

const parseStartIndex = (cursor: string | null) => {
  if (!cursor) return 0
  const parsed = Number.parseInt(cursor, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const createSearchRequest = (
  request: EmbyBridgeSearchRequest,
): EmbySearchRequest => ({
  query: request.query,
  startIndex: parseStartIndex(request.cursor),
  limit: request.limit,
  includeItemTypes: [
    'Movie',
    'Series',
    'Episode',
    'Video',
    'Trailer',
    'MusicVideo',
  ],
})

const normalizeSearchResponse = (
  connection: EmbyConnectionState,
  request: EmbySearchRequest,
  response: EmbySearchResponse,
): EmbyBridgeSearchResponse => {
  if (!connection.connected || !connection.serverId) {
    throw new EmbyConnectionUnavailableError()
  }
  const startIndex = Math.max(
    0,
    response.StartIndex ?? request.startIndex ?? 0,
  )
  const nextIndex = startIndex + response.Items.length
  return {
    connected: true,
    serverId: connection.serverId,
    items: response.Items,
    totalCount: Math.max(0, response.TotalRecordCount),
    nextCursor:
      nextIndex < response.TotalRecordCount ? String(nextIndex) : null,
  }
}

export class EmbyConnectionUnavailableError extends Error {
  constructor(message = 'Emby is not connected') {
    super(message)
    this.name = 'EmbyConnectionUnavailableError'
  }
}

export class EmbyBridgeError extends Error {
  readonly code: string
  readonly status: number | null
  readonly retryable: boolean

  constructor(error: EmbyPublicError) {
    super(error.message)
    this.name = 'EmbyBridgeError'
    this.code = error.code
    this.status = error.status
    this.retryable = error.retryable
  }
}

class RendererEmbyBridgeAdapter implements EmbyRendererBridgeAdapter {
  async getConnection(
    signal?: AbortSignal,
  ): Promise<EmbyConnectionState> {
    throwIfAborted(signal)
    const desktopBridge = readDesktopBridge()
    const connection = desktopBridge
      ? unwrapResult(await desktopBridge.getEmbyConnection())
      : await fetchEnvelope<EmbyConnectionState>(
          `${EMBY_DEV_ROOT}/connection`,
          { method: 'GET', signal },
        )
    throwIfAborted(signal)
    return connection
  }

  async testConnection(
    input: EmbyConnectionInput,
    signal?: AbortSignal,
  ): Promise<EmbyConnectionState> {
    throwIfAborted(signal)
    const desktopBridge = readDesktopBridge()
    const connection = desktopBridge
      ? unwrapResult(await desktopBridge.testEmbyConnection(input))
      : await fetchEnvelope<EmbyConnectionState>(
          `${EMBY_DEV_ROOT}/connection/test`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal,
          },
        )
    throwIfAborted(signal)
    return connection
  }

  async disconnect(
    signal?: AbortSignal,
  ): Promise<EmbyConnectionState> {
    throwIfAborted(signal)
    const desktopBridge = readDesktopBridge()
    const connection = desktopBridge
      ? unwrapResult(await desktopBridge.disconnectEmby())
      : await fetchEnvelope<EmbyConnectionState>(
          `${EMBY_DEV_ROOT}/connection`,
          { method: 'DELETE', signal },
        )
    throwIfAborted(signal)
    return connection
  }

  async search(
    request: EmbyBridgeSearchRequest,
    signal?: AbortSignal,
  ): Promise<EmbyBridgeSearchResponse> {
    throwIfAborted(signal)
    const connection = await this.getConnection(signal)
    if (!connection.connected || !connection.serverId) {
      throw new EmbyConnectionUnavailableError()
    }
    const searchRequest = createSearchRequest(request)
    const desktopBridge = readDesktopBridge()
    const response = desktopBridge
      ? unwrapResult(await desktopBridge.searchEmby(searchRequest))
      : await fetchEnvelope<EmbySearchResponse>(
          `${EMBY_DEV_ROOT}/search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(searchRequest),
            signal,
          },
        )
    throwIfAborted(signal)
    return normalizeSearchResponse(connection, searchRequest, response)
  }

  async getItem(
    request: EmbyBridgeItemRequest,
    signal?: AbortSignal,
  ): Promise<EmbyItemDto> {
    throwIfAborted(signal)
    const desktopBridge = readDesktopBridge()
    const item = desktopBridge
      ? unwrapResult(
          await desktopBridge.getEmbyItem({ itemId: request.itemId }),
        )
      : await fetchEnvelope<EmbyItemDto>(
          `${EMBY_DEV_ROOT}/item?${new URLSearchParams({
            itemId: request.itemId,
          }).toString()}`,
          { method: 'GET', signal },
        )
    throwIfAborted(signal)
    return item
  }

  async getImageBlob(
    request: EmbyBridgeImageRequest,
    signal?: AbortSignal,
  ): Promise<Blob> {
    throwIfAborted(signal)
    const desktopBridge = readDesktopBridge()
    if (desktopBridge) {
      const image = unwrapResult(
        await desktopBridge.getEmbyImage({
          itemId: request.itemId,
          type: request.imageType ?? 'Primary',
          maxWidth: request.maxWidth ?? 1280,
        }),
      )
      throwIfAborted(signal)
      return createImageBlob(image)
    }

    let response: Response
    try {
      response = await fetch(
        `${EMBY_DEV_ROOT}/image?${new URLSearchParams({
          itemId: request.itemId,
          type: request.imageType ?? 'Primary',
          maxWidth: String(request.maxWidth ?? 1280),
        }).toString()}`,
        { method: 'GET', signal },
      )
    } catch (error) {
      if (isAbortError(error)) throw error
      throw new EmbyConnectionUnavailableError()
    }
    if (response.status === 404 || response.status === 503) {
      throw new EmbyConnectionUnavailableError(
        await readResponseError(response),
      )
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const envelope =
        await response.json() as EmbyResult<EmbyImageResponse>
      return createImageBlob(unwrapResult(envelope))
    }
    if (!response.ok) throw new Error(await readResponseError(response))
    return response.blob()
  }
}

const createImageBlob = (image: EmbyImageResponse) => {
  const source = new Uint8Array(image.data)
  const bytes = new Uint8Array(source.byteLength)
  bytes.set(source)
  return new Blob([bytes.buffer], { type: image.mimeType })
}

export const createRendererEmbyBridgeAdapter =
  (): EmbyRendererBridgeAdapter => new RendererEmbyBridgeAdapter()
