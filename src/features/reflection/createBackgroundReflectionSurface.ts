import {
  BACKGROUND_REFLECTION_SURFACE_VERSION,
  type BackgroundReflectionSurface,
  type BackgroundReflectionSurfaceWorkerRequest,
  type BackgroundReflectionSurfaceWorkerResponse,
} from './backgroundReflectionSurfaceProtocol'

export type BackgroundReflectionMediaKind = 'image' | 'video'

export type BackgroundReflectionSurfaceOptions = {
  signal?: AbortSignal
}

export type BackgroundReflectionUrlSource = {
  url: string
  name: string
  cacheKey: string
}

const SURFACE_CACHE_LIMIT = 4
const FILE_FINGERPRINT_CHUNK_BYTES = 64 * 1024
const FILE_FINGERPRINT_SMALL_FILE_BYTES = FILE_FINGERPRINT_CHUNK_BYTES * 3
const VIDEO_DECODE_TIMEOUT_MS = 10_000
const IMAGE_DECODE_TIMEOUT_MS = 10_000

let worker: Worker | null = null
let workerLifecycleEpoch = 0
let nextWorkerRequestId = 1
let generationQueue: Promise<void> = Promise.resolve()
const pendingWorkerRequests = new Map<
  number,
  {
    resolve: (surface: Omit<BackgroundReflectionSurface, 'key'>) => void
    reject: (error: Error) => void
  }
>()
const surfaceCache = new Map<string, BackgroundReflectionSurface>()

const createAbortError = () =>
  new DOMException('Reflection surface generation aborted', 'AbortError')

export const isBackgroundReflectionSurfaceAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

const throwIfGenerationCancelled = (
  signal: AbortSignal | undefined,
  lifecycleEpoch: number,
) => {
  if (signal?.aborted || lifecycleEpoch !== workerLifecycleEpoch) {
    throw createAbortError()
  }
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')

const createFileContentFingerprint = async (
  file: File,
  signal: AbortSignal | undefined,
  lifecycleEpoch: number,
) => {
  const offsets = file.size <= FILE_FINGERPRINT_SMALL_FILE_BYTES
    ? [0]
    : [
        0,
        Math.max(0, Math.floor(file.size / 2 - FILE_FINGERPRINT_CHUNK_BYTES / 2)),
        Math.max(0, file.size - FILE_FINGERPRINT_CHUNK_BYTES),
      ]
  const uniqueOffsets = Array.from(new Set(offsets))
  const chunks: Uint8Array[] = []
  let byteLength = 0

  for (const offset of uniqueOffsets) {
    throwIfGenerationCancelled(signal, lifecycleEpoch)
    const end = file.size <= FILE_FINGERPRINT_SMALL_FILE_BYTES
      ? file.size
      : Math.min(file.size, offset + FILE_FINGERPRINT_CHUNK_BYTES)
    const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer())
    throwIfGenerationCancelled(signal, lifecycleEpoch)
    chunks.push(bytes)
    byteLength += 8 + bytes.byteLength
  }

  const fingerprintInput = new Uint8Array(byteLength)
  const view = new DataView(fingerprintInput.buffer)
  let writeOffset = 0
  uniqueOffsets.forEach((sourceOffset, index) => {
    const chunk = chunks[index]
    view.setUint32(writeOffset, sourceOffset >>> 0)
    view.setUint32(writeOffset + 4, chunk.byteLength)
    writeOffset += 8
    fingerprintInput.set(chunk, writeOffset)
    writeOffset += chunk.byteLength
  })
  const digest = await crypto.subtle.digest('SHA-256', fingerprintInput)
  throwIfGenerationCancelled(signal, lifecycleEpoch)
  return toHex(new Uint8Array(digest).subarray(0, 16))
}

const createSurfaceKey = async (
  file: File,
  kind: BackgroundReflectionMediaKind,
  signal: AbortSignal | undefined,
  lifecycleEpoch: number,
) => {
  const contentFingerprint = await createFileContentFingerprint(
    file,
    signal,
    lifecycleEpoch,
  )
  return [
    BACKGROUND_REFLECTION_SURFACE_VERSION,
    kind,
    file.name,
    file.type,
    file.size,
    file.lastModified,
    contentFingerprint,
  ].join(':')
}

const createUrlSurfaceKey = (
  source: BackgroundReflectionUrlSource,
  kind: BackgroundReflectionMediaKind,
) => {
  const cacheKey = source.cacheKey.trim()
  if (!cacheKey) {
    throw new TypeError('A stable reflection surface cache key is required')
  }
  return [
    BACKGROUND_REFLECTION_SURFACE_VERSION,
    kind,
    'url',
    cacheKey,
  ].join(':')
}

const readCachedSurface = (key: string) => {
  const cached = surfaceCache.get(key)
  if (!cached) return null
  surfaceCache.delete(key)
  surfaceCache.set(key, cached)
  return cached
}

const cacheSurface = (surface: BackgroundReflectionSurface) => {
  surfaceCache.delete(surface.key)
  surfaceCache.set(surface.key, surface)
  while (surfaceCache.size > SURFACE_CACHE_LIMIT) {
    const oldestKey = surfaceCache.keys().next().value
    if (typeof oldestKey !== 'string') break
    surfaceCache.delete(oldestKey)
  }
}

const enqueueGeneration = <Result>(task: () => Promise<Result>) => {
  const result = generationQueue.then(task)
  generationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const ensureWorker = (lifecycleEpoch: number) => {
  throwIfGenerationCancelled(undefined, lifecycleEpoch)
  if (worker) return worker
  const nextWorker = new Worker(
    new URL('./backgroundReflectionSurface.worker.ts', import.meta.url),
    { type: 'module', name: 'aurora-background-reflection-surface' },
  )
  nextWorker.onmessage = (
    event: MessageEvent<BackgroundReflectionSurfaceWorkerResponse>,
  ) => {
    const response = event.data
    const pending = pendingWorkerRequests.get(response.id)
    if (!pending) return
    pendingWorkerRequests.delete(response.id)
    if (
      !response.ok ||
      !response.pixels ||
      !response.width ||
      !response.height
    ) {
      pending.reject(new Error(response.error || 'Unable to generate reflection surface'))
      return
    }
    pending.resolve({
      width: response.width,
      height: response.height,
      pixels: new Uint8Array(response.pixels),
      generationMs: response.generationMs ?? 0,
    })
  }
  nextWorker.onerror = (event) => {
    const error = new Error(event.message || 'Reflection surface worker failed')
    pendingWorkerRequests.forEach(({ reject }) => reject(error))
    pendingWorkerRequests.clear()
    nextWorker.terminate()
    if (worker === nextWorker) worker = null
  }
  worker = nextWorker
  return nextWorker
}

const shouldUseAnonymousCrossOrigin = (url: string) =>
  url.startsWith('aurora-media:') ||
  (/^https?:/i.test(url) && new URL(url, document.baseURI).origin !== location.origin)

const waitForVideoFrameFromSource = (
  source: {
    url: string
    name: string
    release?: () => void
  },
  signal: AbortSignal | undefined,
  lifecycleEpoch: number,
) => new Promise<ImageBitmap>((resolve, reject) => {
  throwIfGenerationCancelled(signal, lifecycleEpoch)
  const video = document.createElement('video')
  let settled = false
  let timeout = 0

  const cleanup = () => {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', handleAbort)
    video.pause()
    video.removeAttribute('src')
    video.load()
    source.release?.()
  }
  const finish = (callback: () => void) => {
    if (settled) return false
    settled = true
    cleanup()
    callback()
    return true
  }
  const handleAbort = () => {
    finish(() => reject(createAbortError()))
  }
  const capture = async () => {
    try {
      const bitmap = await createImageBitmap(video)
      if (
        settled ||
        signal?.aborted ||
        lifecycleEpoch !== workerLifecycleEpoch
      ) {
        bitmap.close()
        if (!settled) finish(() => reject(createAbortError()))
        return
      }
      finish(() => resolve(bitmap))
    } catch (error) {
      if (settled) return
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
  }
  const seekRepresentativeFrame = () => {
    if (signal?.aborted || lifecycleEpoch !== workerLifecycleEpoch) {
      handleAbort()
      return
    }
    const sampleTime = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(0.75, Math.max(0.05, video.duration * 0.05))
      : 0
    if (sampleTime <= 0.01) {
      void capture()
      return
    }
    video.addEventListener('seeked', () => void capture(), { once: true })
    video.currentTime = sampleTime
  }

  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  if (shouldUseAnonymousCrossOrigin(source.url)) {
    video.crossOrigin = 'anonymous'
  }
  video.addEventListener('loadeddata', seekRepresentativeFrame, { once: true })
  video.addEventListener('error', () => {
    finish(() => reject(new Error(
      `Unable to decode custom background video: ${source.name}`,
    )))
  }, { once: true })
  signal?.addEventListener('abort', handleAbort, { once: true })
  timeout = window.setTimeout(() => {
    if (signal?.aborted || lifecycleEpoch !== workerLifecycleEpoch) {
      handleAbort()
      return
    }
    finish(() => reject(new Error(
      `Custom background video decode timed out: ${source.name}`,
    )))
  }, VIDEO_DECODE_TIMEOUT_MS)
  video.src = source.url
  video.load()
})

const waitForVideoFrame = (
  file: File,
  signal: AbortSignal | undefined,
  lifecycleEpoch: number,
) => {
  const objectUrl = URL.createObjectURL(file)
  return waitForVideoFrameFromSource(
    {
      url: objectUrl,
      name: file.name,
      release: () => URL.revokeObjectURL(objectUrl),
    },
    signal,
    lifecycleEpoch,
  )
}

const waitForImageFrameFromUrl = (
  source: BackgroundReflectionUrlSource,
  signal: AbortSignal | undefined,
  lifecycleEpoch: number,
) => new Promise<ImageBitmap>((resolve, reject) => {
  throwIfGenerationCancelled(signal, lifecycleEpoch)
  const image = new Image()
  let settled = false
  let timeout = 0

  const cleanup = () => {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', handleAbort)
    image.removeAttribute('src')
  }
  const finish = (callback: () => void) => {
    if (settled) return false
    settled = true
    cleanup()
    callback()
    return true
  }
  const handleAbort = () => {
    finish(() => reject(createAbortError()))
  }
  const capture = async () => {
    try {
      const bitmap = await createImageBitmap(image)
      if (
        settled ||
        signal?.aborted ||
        lifecycleEpoch !== workerLifecycleEpoch
      ) {
        bitmap.close()
        if (!settled) finish(() => reject(createAbortError()))
        return
      }
      finish(() => resolve(bitmap))
    } catch (error) {
      if (settled) return
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
  }

  image.decoding = 'async'
  if (shouldUseAnonymousCrossOrigin(source.url)) {
    image.crossOrigin = 'anonymous'
  }
  image.addEventListener('load', () => void capture(), { once: true })
  image.addEventListener('error', () => {
    finish(() => reject(new Error(
      `Unable to decode custom background image: ${source.name}`,
    )))
  }, { once: true })
  signal?.addEventListener('abort', handleAbort, { once: true })
  timeout = window.setTimeout(() => {
    if (signal?.aborted || lifecycleEpoch !== workerLifecycleEpoch) {
      handleAbort()
      return
    }
    finish(() => reject(new Error(
      `Custom background image decode timed out: ${source.name}`,
    )))
  }, IMAGE_DECODE_TIMEOUT_MS)
  image.src = source.url
})

const decodeBackgroundFrame = async (
  file: File,
  kind: BackgroundReflectionMediaKind,
  signal: AbortSignal | undefined,
  lifecycleEpoch: number,
) => {
  if (kind === 'video') {
    return waitForVideoFrame(file, signal, lifecycleEpoch)
  }
  throwIfGenerationCancelled(signal, lifecycleEpoch)
  const bitmap = await createImageBitmap(file)
  if (signal?.aborted || lifecycleEpoch !== workerLifecycleEpoch) {
    bitmap.close()
    throw createAbortError()
  }
  return bitmap
}

const decodeBackgroundFrameFromUrl = async (
  source: BackgroundReflectionUrlSource,
  kind: BackgroundReflectionMediaKind,
  signal: AbortSignal | undefined,
  lifecycleEpoch: number,
) => {
  const url = source.url.trim()
  if (!url) throw new TypeError('A reflection surface media URL is required')
  const normalizedSource = { ...source, url }
  if (kind === 'video') {
    return waitForVideoFrameFromSource(
      normalizedSource,
      signal,
      lifecycleEpoch,
    )
  }
  return waitForImageFrameFromUrl(
    normalizedSource,
    signal,
    lifecycleEpoch,
  )
}

const generateSurface = async (
  bitmapPromise: Promise<ImageBitmap>,
  key: string,
  signal: AbortSignal | undefined,
  lifecycleEpoch: number,
) => {
  const bitmap = await bitmapPromise
  const requestId = nextWorkerRequestId
  nextWorkerRequestId += 1
  const request: BackgroundReflectionSurfaceWorkerRequest = {
    id: requestId,
    bitmap,
  }
  const generated = new Promise<Omit<BackgroundReflectionSurface, 'key'>>(
    (resolve, reject) => pendingWorkerRequests.set(requestId, { resolve, reject }),
  )
  try {
    throwIfGenerationCancelled(signal, lifecycleEpoch)
    ensureWorker(lifecycleEpoch).postMessage(request, [bitmap])
  } catch (error) {
    pendingWorkerRequests.delete(requestId)
    bitmap.close()
    throw error
  }
  const surface = await generated
  throwIfGenerationCancelled(signal, lifecycleEpoch)
  return { key, ...surface }
}

export const createBackgroundReflectionSurface = (
  file: File,
  kind: BackgroundReflectionMediaKind,
  options: BackgroundReflectionSurfaceOptions = {},
) => {
  const lifecycleEpoch = workerLifecycleEpoch
  return enqueueGeneration(async () => {
    throwIfGenerationCancelled(options.signal, lifecycleEpoch)
    const key = await createSurfaceKey(
      file,
      kind,
      options.signal,
      lifecycleEpoch,
    )
    const cached = readCachedSurface(key)
    if (cached) return cached
    const surface = await generateSurface(
      decodeBackgroundFrame(file, kind, options.signal, lifecycleEpoch),
      key,
      options.signal,
      lifecycleEpoch,
    )
    throwIfGenerationCancelled(options.signal, lifecycleEpoch)
    cacheSurface(surface)
    return surface
  })
}

export const createBackgroundReflectionSurfaceFromUrl = (
  source: BackgroundReflectionUrlSource,
  kind: BackgroundReflectionMediaKind,
  options: BackgroundReflectionSurfaceOptions = {},
) => {
  const lifecycleEpoch = workerLifecycleEpoch
  return enqueueGeneration(async () => {
    throwIfGenerationCancelled(options.signal, lifecycleEpoch)
    const key = createUrlSurfaceKey(source, kind)
    const cached = readCachedSurface(key)
    if (cached) return cached
    const surface = await generateSurface(
      decodeBackgroundFrameFromUrl(
        source,
        kind,
        options.signal,
        lifecycleEpoch,
      ),
      key,
      options.signal,
      lifecycleEpoch,
    )
    throwIfGenerationCancelled(options.signal, lifecycleEpoch)
    cacheSurface(surface)
    return surface
  })
}

export const disposeBackgroundReflectionSurfaceWorker = () => {
  workerLifecycleEpoch += 1
  worker?.terminate()
  worker = null
  const error = createAbortError()
  pendingWorkerRequests.forEach(({ reject }) => reject(error))
  pendingWorkerRequests.clear()
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeBackgroundReflectionSurfaceWorker)
}
