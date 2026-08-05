import {
  isAbortError,
  normalizeDiscoverySearchRequest,
  throwIfAborted,
  type DiscoverySearchPage,
  type DiscoverySearchProvider,
  type DiscoverySearchRequest,
} from '../../features/discovery/search/types'
import { mapEmbyItemToDiscoveryResult } from './embyMapper'
import type {
  EmbyItemDto,
  EmbyBridgeSearchRequest,
  EmbyRendererBridgeAdapter,
} from './embyTypes'

let requestSequence = 0

const createRequestId = () => {
  requestSequence += 1
  return `emby-search-${Date.now()}-${requestSequence}`
}

export class EmbyDiscoverySearchProvider
  implements DiscoverySearchProvider
{
  readonly id = 'emby-live'
  readonly sources = ['emby'] as const
  readonly #adapter: EmbyRendererBridgeAdapter
  readonly #thumbnailUrls = new Map<string, string>()

  constructor(adapter: EmbyRendererBridgeAdapter) {
    this.#adapter = adapter
  }

  async search(
    request: DiscoverySearchRequest,
    signal?: AbortSignal,
  ): Promise<DiscoverySearchPage> {
    throwIfAborted(signal)
    const normalized = normalizeDiscoverySearchRequest(request)
    if (!normalized.sources.includes('emby')) {
      return {
        results: [],
        totalCount: 0,
        nextCursor: null,
        connection: 'not-requested',
      }
    }
    // The secure bridge intentionally rejects an empty SearchTerm. Treat an
    // empty Discovery query as idle instead of turning it into an Emby error
    // (or an implicit "browse entire library" request).
    if (!normalized.query) {
      return {
        results: [],
        totalCount: 0,
        nextCursor: null,
        connection: 'not-requested',
      }
    }

    const bridgeRequest: EmbyBridgeSearchRequest = {
      requestId: createRequestId(),
      query: normalized.query,
      cursor: normalized.cursor ?? null,
      limit: normalized.limit,
      kind: normalized.kind,
      resolution: normalized.resolution,
    }
    const response = await this.#adapter.search(bridgeRequest, signal)
    throwIfAborted(signal)
    const thumbnails = await Promise.all(
      response.items.map((item) =>
        this.#getThumbnailUrl(response.serverId, item, signal),
      ),
    )
    throwIfAborted(signal)
    const results = response.items
      .map((item, index) =>
        mapEmbyItemToDiscoveryResult(
          response.serverId,
          item,
          thumbnails[index],
        ),
      )
      .filter((result): result is NonNullable<typeof result> => result !== null)

    return {
      results,
      totalCount: Math.max(0, response.totalCount),
      nextCursor: response.nextCursor ?? null,
      connection: 'connected',
    }
  }

  async #getThumbnailUrl(
    serverId: string,
    item: EmbyItemDto,
    signal?: AbortSignal,
  ) {
    const itemId = item.Id
    if (!itemId || !this.#adapter.getImageBlob) return ''
    const cacheKey = `${serverId}:${itemId}`
    const cached = this.#thumbnailUrls.get(cacheKey)
    if (cached) return cached

    const imageTypes =
      (item.BackdropImageTags?.length ?? 0) > 0
        ? (['Backdrop', 'Primary'] as const)
        : (['Primary'] as const)

    for (const imageType of imageTypes) {
      try {
        const blob = await this.#adapter.getImageBlob(
          { serverId, itemId, imageType, maxWidth: 1280 },
          signal,
        )
        throwIfAborted(signal)
        const objectUrl = URL.createObjectURL(blob)
        this.#thumbnailUrls.set(cacheKey, objectUrl)
        this.#trimThumbnailCache()
        return objectUrl
      } catch (error) {
        if (isAbortError(error)) throw error
      }
    }

    return ''
  }

  #trimThumbnailCache() {
    while (this.#thumbnailUrls.size > 64) {
      const oldest = this.#thumbnailUrls.entries().next().value as
        | [string, string]
        | undefined
      if (!oldest) return
      this.#thumbnailUrls.delete(oldest[0])
      URL.revokeObjectURL(oldest[1])
    }
  }
}
