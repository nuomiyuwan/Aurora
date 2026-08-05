import * as THREE from 'three'
import type { Project } from '../../../data/projects'

export type CardTextureCacheOptions = {
  assetVersion?: string
  drawCard: (project: Project, width?: number) => Promise<HTMLCanvasElement>
  createTextureKey?: (project: Project, assetVersion: string) => string
  textureWidth?: number
  textureHeight?: number
}

export function createCardTextureKey(project: Project, assetVersion = 'v1') {
  return JSON.stringify([
    assetVersion,
    project.id,
    project.cover,
    project.title,
    project.subtitle,
    project.localVideoCount,
    project.onlineVideoCount,
    project.videoCount,
    project.collectionCount,
    project.updatedAt,
  ])
}

type SharedCardRasterEntry = {
  promise: Promise<HTMLCanvasElement>
  estimatedBytes: number
}

const SHARED_CARD_RASTER_CACHE_MAX_ENTRIES = 32
const SHARED_CARD_RASTER_CACHE_MAX_BYTES = 96 * 1024 * 1024
const sharedCardRasterCache = new Map<string, SharedCardRasterEntry>()
const sharedRasterizerIds = new WeakMap<CardTextureCacheOptions['drawCard'], number>()
let sharedCardRasterCacheBytes = 0
let nextSharedRasterizerId = 1

const getSharedRasterizerId = (drawCard: CardTextureCacheOptions['drawCard']) => {
  const existing = sharedRasterizerIds.get(drawCard)
  if (existing !== undefined) return existing
  const next = nextSharedRasterizerId
  nextSharedRasterizerId += 1
  sharedRasterizerIds.set(drawCard, next)
  return next
}

const removeSharedCardRaster = (key: string, entry: SharedCardRasterEntry) => {
  if (sharedCardRasterCache.get(key) !== entry) return
  sharedCardRasterCache.delete(key)
  sharedCardRasterCacheBytes -= entry.estimatedBytes
}

const pruneSharedCardRasters = (protectedKey: string) => {
  while (
    (sharedCardRasterCacheBytes > SHARED_CARD_RASTER_CACHE_MAX_BYTES ||
      sharedCardRasterCache.size > SHARED_CARD_RASTER_CACHE_MAX_ENTRIES) &&
    sharedCardRasterCache.size > 1
  ) {
    const oldestKey = sharedCardRasterCache.keys().next().value as string | undefined
    if (!oldestKey) return
    if (oldestKey === protectedKey) {
      const protectedEntry = sharedCardRasterCache.get(oldestKey)
      if (!protectedEntry) return
      sharedCardRasterCache.delete(oldestKey)
      sharedCardRasterCache.set(oldestKey, protectedEntry)
      continue
    }
    const oldestEntry = sharedCardRasterCache.get(oldestKey)
    if (oldestEntry) removeSharedCardRaster(oldestKey, oldestEntry)
  }
}

const getSharedCardRaster = (
  key: string,
  project: Project,
  width: number,
  height: number,
  drawCard: CardTextureCacheOptions['drawCard'],
) => {
  const rasterKey = JSON.stringify([
    getSharedRasterizerId(drawCard),
    width,
    height,
    key,
  ])
  const existing = sharedCardRasterCache.get(rasterKey)
  if (existing) {
    sharedCardRasterCache.delete(rasterKey)
    sharedCardRasterCache.set(rasterKey, existing)
    return existing.promise
  }

  let entry: SharedCardRasterEntry
  const promise = Promise.resolve()
    .then(() => drawCard(project, width))
    .then((drawnCanvas) => {
      if (drawnCanvas.width === width && drawnCanvas.height === height) {
        return drawnCanvas
      }
      const normalizedCanvas = document.createElement('canvas')
      normalizedCanvas.width = width
      normalizedCanvas.height = height
      const normalizedContext = normalizedCanvas.getContext('2d')
      if (!normalizedContext) throw new Error('2D canvas is unavailable')
      normalizedContext.drawImage(drawnCanvas, 0, 0, width, height)
      return normalizedCanvas
    })
    .catch((error: unknown) => {
      removeSharedCardRaster(rasterKey, entry)
      throw error
    })
  entry = {
    estimatedBytes: width * height * 4,
    promise,
  }
  sharedCardRasterCache.set(rasterKey, entry)
  sharedCardRasterCacheBytes += entry.estimatedBytes
  pruneSharedCardRasters(rasterKey)
  return entry.promise
}

type CardTextureEntry = {
  projectId: string
  key: string
  token: number
  texture: THREE.CanvasTexture
  promise: Promise<THREE.CanvasTexture>
  ready: boolean
  evicted: boolean
  disposed: boolean
}

export class CardTextureEvictedError extends Error {
  constructor(projectId: string) {
    super(`Card texture request was evicted: ${projectId}`)
    this.name = 'CardTextureEvictedError'
  }
}

export class CardTextureCache {
  readonly #assetVersion: string
  readonly #drawCard: (project: Project, width?: number) => Promise<HTMLCanvasElement>
  readonly #createTextureKey: (project: Project, assetVersion: string) => string
  readonly #textureWidth: number
  readonly #textureHeight: number
  readonly #entries = new Map<string, CardTextureEntry>()
  readonly #projectEntries = new Map<string, CardTextureEntry>()
  readonly #pending = new Set<Promise<void>>()
  #nextToken = 1
  #disposed = false

  constructor({
    assetVersion = 'v1',
    drawCard,
    createTextureKey = createCardTextureKey,
    textureWidth = 1024,
    textureHeight = Math.round((textureWidth * 1080) / 1448),
  }: CardTextureCacheOptions) {
    this.#assetVersion = assetVersion
    this.#drawCard = drawCard
    this.#createTextureKey = createTextureKey
    this.#textureWidth = textureWidth
    this.#textureHeight = textureHeight
  }

  get size() {
    return this.#entries.size
  }

  get(project: Project) {
    if (this.#disposed) {
      return Promise.reject(new Error('Card texture cache is disposed'))
    }

    const key = this.#createTextureKey(project, this.#assetVersion)
    const existing = this.#entries.get(key)
    if (existing && !existing.evicted && !existing.disposed) {
      const current = this.#projectEntries.get(project.id)
      if (current !== existing) {
        if (current) this.#removeEntry(current, true)
        this.#projectEntries.set(project.id, existing)
      }
      return existing.promise
    }

    const previous = this.#projectEntries.get(project.id)
    if (previous && !previous.ready) this.#removeEntry(previous, true)

    const canvas = document.createElement('canvas')
    canvas.width = this.#textureWidth
    canvas.height = this.#textureHeight
    const context = canvas.getContext('2d')
    if (!context) return Promise.reject(new Error('2D canvas is unavailable'))
    context.fillStyle = 'rgba(10, 14, 22, 0.92)'
    context.fillRect(0, 0, canvas.width, canvas.height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.name = key
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
    const entry: CardTextureEntry = {
      projectId: project.id,
      key,
      token: this.#nextToken,
      texture,
      promise: Promise.resolve(texture),
      ready: false,
      evicted: false,
      disposed: false,
    }
    this.#nextToken += 1
    this.#entries.set(key, entry)
    this.#projectEntries.set(project.id, entry)

    const texturePromise = getSharedCardRaster(
      key,
      project,
      this.#textureWidth,
      this.#textureHeight,
      this.#drawCard,
    )
      .then((drawnCanvas) => {
        if (
          this.#disposed ||
          entry.evicted ||
          this.#entries.get(key) !== entry ||
          this.#projectEntries.get(project.id) !== entry
        ) {
          this.#removeEntry(entry, true)
          throw new CardTextureEvictedError(project.id)
        }
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(drawnCanvas, 0, 0, canvas.width, canvas.height)
        texture.needsUpdate = true
        entry.ready = true
        for (const candidate of [...this.#entries.values()]) {
          if (candidate.projectId === project.id && candidate !== entry) {
            this.#removeEntry(candidate, true)
          }
        }
        return texture
      })
      .catch((error: unknown) => {
        const stale =
          error instanceof CardTextureEvictedError ||
          this.#disposed ||
          entry.evicted ||
          this.#entries.get(key) !== entry ||
          this.#projectEntries.get(project.id) !== entry
        this.#removeEntry(entry, true)
        if (stale) {
          throw error instanceof CardTextureEvictedError
            ? error
            : new CardTextureEvictedError(project.id)
        }

        const fallback = this.#findLatestReadyProjectEntry(project.id)
        if (fallback) this.#projectEntries.set(project.id, fallback)
        throw error
      })
    entry.promise = texturePromise
    const pending = texturePromise.then(
      () => undefined,
      (error: unknown) => {
        if (error instanceof CardTextureEvictedError) return
        throw error
      },
    )
    this.#pending.add(pending)
    void pending
      .finally(() => this.#pending.delete(pending))
      .catch(() => undefined)
    return texturePromise
  }

  evictProject(projectId: string) {
    let evicted = false
    for (const entry of [...this.#entries.values()]) {
      if (entry.projectId !== projectId) continue
      this.#removeEntry(entry, true)
      evicted = true
    }
    return evicted
  }

  retainProjectIds(projectIds: ReadonlySet<string>) {
    const cachedProjectIds = new Set(
      [...this.#entries.values()].map((entry) => entry.projectId),
    )
    cachedProjectIds.forEach((projectId) => {
      if (!projectIds.has(projectId)) this.evictProject(projectId)
    })
  }

  whenReady() {
    return Promise.all([...this.#pending]).then(() => undefined)
  }

  dispose() {
    this.#disposed = true
    this.#entries.forEach((entry) => {
      entry.evicted = true
      this.#disposeEntry(entry, false)
    })
    this.#entries.clear()
    this.#projectEntries.clear()
    this.#pending.clear()
  }

  #removeEntry(entry: CardTextureEntry, deferDispose: boolean) {
    entry.evicted = true
    if (this.#entries.get(entry.key) === entry) {
      this.#entries.delete(entry.key)
    }
    if (this.#projectEntries.get(entry.projectId) === entry) {
      this.#projectEntries.delete(entry.projectId)
    }
    this.#disposeEntry(entry, deferDispose)
  }

  #disposeEntry(entry: CardTextureEntry, deferDispose = false) {
    if (entry.disposed) return
    entry.disposed = true
    if (deferDispose && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => entry.texture.dispose())
      return
    }
    entry.texture.dispose()
  }

  #findLatestReadyProjectEntry(projectId: string) {
    let latest: CardTextureEntry | undefined
    for (const entry of this.#entries.values()) {
      if (
        entry.projectId !== projectId ||
        !entry.ready ||
        entry.evicted ||
        entry.disposed
      ) {
        continue
      }
      if (!latest || entry.token > latest.token) latest = entry
    }
    return latest
  }
}
