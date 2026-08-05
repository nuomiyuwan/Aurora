import {
  MEDIA_VISUAL_INDEX_VERSION,
  type FrameAnnotation,
  type MediaAsset,
  type MediaIndexTask,
  type OnlineMediaDescriptor,
  type MediaVisualIndex,
  type MediaVisualIndexFrame,
  type ProjectAssetRef,
} from './mediaLibraryTypes'
import {
  getProjectAssetCounts,
  isDemoMediaAsset,
} from './mediaLibrarySelectors'
import type {
  ModelAsset,
  ModelAssetFormat,
  ModelAssetDimensions,
  ModelCameraState,
} from './modelLibraryTypes'
import { isModelEnvironmentPresetId } from './modelLibraryTypes'
import { isOnlineMediaProvider } from './onlineProviderRegistry'
/*
 * The library schema and the generated visual-index schema evolve
 * independently. Old library records remain readable, but an index generated
 * before actual source-frame PTS were stored must be rebuilt.
 */
import type { Project } from './projects'

export const LIBRARY_SCHEMA_VERSION = 4

export type PersistedProjectCover = {
  name: string
  managedPath: string
}

export type PersistentLibraryState = {
  schemaVersion: typeof LIBRARY_SCHEMA_VERSION
  projects: Project[]
  mediaAssets: MediaAsset[]
  projectAssetRefs: ProjectAssetRef[]
  visualIndexes: MediaVisualIndex[]
  frameAnnotations: FrameAnnotation[]
  modelAssets: ModelAsset[]
  projectTitles: Record<string, string>
  projectCovers: Record<string, PersistedProjectCover>
  selectedProjectId: string
}

type SerializablePersistentLibraryState = Omit<
  PersistentLibraryState,
  | 'schemaVersion'
  | 'visualIndexes'
  | 'frameAnnotations'
  | 'modelAssets'
  | 'projectCovers'
> &
  Partial<
    Pick<
      PersistentLibraryState,
      'visualIndexes' | 'frameAnnotations' | 'modelAssets' | 'projectCovers'
    >
  >

const MAX_PROJECT_COVER_NAME_LENGTH = 255

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function readNullableString(value: unknown) {
  return value === null || typeof value === 'string' ? value : undefined
}

function readNullableFiniteNumber(value: unknown) {
  return value === null ||
    (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined
}

function parseLegacyDurationSeconds(value: string) {
  const components = value
    .trim()
    .split(':')
    .map((component) => Number(component))
  if (
    (components.length !== 2 && components.length !== 3) ||
    components.some(
      (component) => !Number.isFinite(component) || component < 0,
    )
  ) {
    return null
  }
  if (
    components.slice(1).some((component) => component >= 60)
  ) {
    return null
  }
  return components.reduce(
    (total, component) => total * 60 + component,
    0,
  )
}

function parseLegacyResolution(value: string) {
  const match = value.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return { width: null, height: null }
  const width = Number(match[1])
  const height = Number(match[2])
  return {
    width: Number.isInteger(width) && width > 0 ? width : null,
    height: Number.isInteger(height) && height > 0 ? height : null,
  }
}

function parseLegacyFps(value: string) {
  const fps = Number.parseFloat(value)
  return Number.isFinite(fps) && fps > 0 ? fps : null
}

function parseLegacySizeBytes(value: string) {
  const match = value
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/i)
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2].toUpperCase()
  const powers: Record<string, number> = {
    B: 0,
    KB: 1,
    MB: 2,
    GB: 3,
    TB: 4,
  }
  const bytes = amount * 1024 ** powers[unit]
  return Number.isSafeInteger(bytes) ? bytes : Math.round(bytes)
}

function parseProject(value: unknown): Project | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const title = readString(value.title)
  const subtitle = readString(value.subtitle)
  const description =
    value.description === undefined ? undefined : readString(value.description)
  const cover = readString(value.cover)
  const videoCount = readFiniteNumber(value.videoCount)
  const collectionCount = readFiniteNumber(value.collectionCount)
  const updatedAt = readString(value.updatedAt)
  if (
    !id ||
    !title ||
    subtitle === null ||
    description === null ||
    cover === null ||
    videoCount === null ||
    collectionCount === null ||
    !updatedAt
  ) {
    return null
  }

  return {
    id,
    ...(value.kind === 'video' || value.kind === '3d'
      ? { kind: value.kind }
      : {}),
    title,
    subtitle,
    ...(description === undefined ? {} : { description }),
    cover,
    videoCount: Math.max(0, Math.round(videoCount)),
    collectionCount: Math.max(0, Math.round(collectionCount)),
    updatedAt,
  }
}

function parseModelAssetDimensions(value: unknown): ModelAssetDimensions | null {
  if (!isRecord(value)) return null
  const x = readFiniteNumber(value.x)
  const y = readFiniteNumber(value.y)
  const z = readFiniteNumber(value.z)
  if (x === null || y === null || z === null || x < 0 || y < 0 || z < 0) {
    return null
  }
  return { x, y, z }
}

function parseModelCameraState(value: unknown): ModelCameraState | null {
  if (!isRecord(value)) return null
  const position = Array.isArray(value.position) ? value.position : null
  const target = Array.isArray(value.target) ? value.target : null
  if (
    !position ||
    !target ||
    position.length !== 3 ||
    target.length !== 3 ||
    [...position, ...target].some(
      (entry) => typeof entry !== 'number' || !Number.isFinite(entry),
    )
  ) {
    return null
  }
  return {
    position: [position[0], position[1], position[2]],
    target: [target[0], target[1], target[2]],
  }
}

function parseNullableCount(value: unknown) {
  if (value === null) return null
  const count = readFiniteNumber(value)
  return count !== null && count >= 0 ? Math.round(count) : undefined
}

function parseModelAssetFormat(value: unknown): ModelAssetFormat | null {
  return value === 'glb' || value === 'obj' || value === 'fbx'
    ? value
    : null
}

function parseModelAsset(value: unknown): ModelAsset | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const projectId = readString(value.projectId)
  const filename = readString(value.filename)
  const sourcePath = value.sourcePath === null ? null : readString(value.sourcePath)
  const sizeBytes = readFiniteNumber(value.sizeBytes)
  const importedAt = readString(value.importedAt)
  const thumbnail = value.thumbnail === null ? null : readString(value.thumbnail)
  const favorite = value.favorite === undefined
    ? false
    : readBoolean(value.favorite)
  const tags = Array.isArray(value.tags)
    ? Array.from(
        new Set(
          value.tags
            .filter((tag): tag is string => typeof tag === 'string')
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ).slice(0, 6)
    : []
  const note = readString(value.note) ?? ''
  const vertexCount = parseNullableCount(value.vertexCount)
  const triangleCount = parseNullableCount(value.triangleCount)
  const nodeCount = parseNullableCount(value.nodeCount)
  const materialCount = parseNullableCount(value.materialCount)
  const textureCount = parseNullableCount(value.textureCount)
  const format = parseModelAssetFormat(value.format)
  const environmentPresetId =
    value.environmentPresetId === undefined
      ? undefined
      : value.environmentPresetId === null ||
          isModelEnvironmentPresetId(value.environmentPresetId)
        ? value.environmentPresetId
        : undefined
  if (
    !id ||
    !projectId ||
    !filename ||
    format === null ||
    sourcePath === undefined ||
    sizeBytes === null ||
    sizeBytes < 0 ||
    !importedAt ||
    thumbnail === null && value.thumbnail !== null ||
    favorite === null ||
    vertexCount === undefined ||
    triangleCount === undefined ||
    nodeCount === undefined ||
    materialCount === undefined ||
    textureCount === undefined
  ) {
    return null
  }

  return {
    id,
    projectId,
    filename,
    format,
    sourcePath,
    sizeBytes,
    importedAt,
    thumbnail,
    favorite,
    tags,
    note,
    vertexCount,
    triangleCount,
    nodeCount,
    materialCount,
    textureCount,
    dimensions:
      value.dimensions === null
        ? null
        : parseModelAssetDimensions(value.dimensions),
    camera:
      value.camera === null ? null : parseModelCameraState(value.camera),
    ...(environmentPresetId === undefined ? {} : { environmentPresetId }),
  }
}

function isMediaIndexTask(value: unknown): value is MediaIndexTask {
  return (
    value === 'idle' ||
    value === 'build-queued' ||
    value === 'rebuild-queued' ||
    value === 'building' ||
    value === 'failed'
  )
}

function parseOnlineMediaDescriptor(
  value: unknown,
): OnlineMediaDescriptor | null {
  if (!isRecord(value)) return null

  const provider = value.provider
  const kind = value.kind
  const mediaId = readString(value.mediaId)
  const canonicalUrl = readString(value.canonicalUrl)
  const authorValue = readString(value.author)
  const author = authorValue?.trim() || '未公开'
  const description = readString(value.description)
  const publishedAt = readString(value.publishedAt)
  if (
    !isOnlineMediaProvider(provider) ||
    (kind !== 'video' && kind !== 'episode') ||
    mediaId === null ||
    canonicalUrl === null ||
    (value.author !== undefined &&
      value.author !== null &&
      authorValue === null) ||
    description === null ||
    publishedAt === null
  ) {
    return null
  }

  if (provider === 'xinpianchang') {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(canonicalUrl)
    } catch {
      return null
    }
    if (
      kind !== 'video' ||
      !/^[1-9][0-9]{0,19}$/.test(mediaId) ||
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.hostname !== 'www.xinpianchang.com' ||
      parsedUrl.port ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.pathname !== `/a${mediaId}` ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      return null
    }
    return {
      provider,
      kind,
      mediaId,
      canonicalUrl: parsedUrl.toString(),
      author,
      description,
      publishedAt,
    }
  }

  if (provider === 'youku') {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(canonicalUrl)
    } catch {
      return null
    }
    if (
      !/^[0-9A-Za-z=_-]{6,80}$/.test(mediaId) ||
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.hostname !== 'v.youku.com' ||
      parsedUrl.port ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.hash
    ) {
      return null
    }
    const videoMatch = /^\/v_show\/id_([0-9A-Za-z=_-]{6,80})\.html$/.exec(
      parsedUrl.pathname,
    )
    const isMatchingVideo =
      kind === 'video' &&
      videoMatch?.[1] === mediaId &&
      !parsedUrl.search
    const isMatchingSeries =
      kind === 'episode' &&
      parsedUrl.pathname === '/video' &&
      parsedUrl.searchParams.size === 1 &&
      parsedUrl.searchParams.get('s') === mediaId
    if (!isMatchingVideo && !isMatchingSeries) return null
    return {
      provider,
      kind,
      mediaId,
      canonicalUrl: parsedUrl.toString(),
      author,
      description,
      publishedAt,
    }
  }

  if (provider === 'tencent') {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(canonicalUrl)
    } catch {
      return null
    }
    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.hostname !== 'v.qq.com' ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      return null
    }
    const videoMatch = /^\/x\/page\/([0-9A-Za-z]{11})\.html$/.exec(
      parsedUrl.pathname,
    )
    const episodeMatch =
      /^\/x\/cover\/([0-9A-Za-z]{11,32})(?:\/[0-9A-Za-z]{11})?\.html$/.exec(
        parsedUrl.pathname,
      )
    const isMatchingVideo =
      kind === 'video' && videoMatch?.[1] === mediaId
    const isMatchingEpisode =
      kind === 'episode' && episodeMatch?.[1] === mediaId
    if (!isMatchingVideo && !isMatchingEpisode) return null
    return {
      provider,
      kind,
      mediaId,
      canonicalUrl: parsedUrl.toString(),
      author,
      description,
      publishedAt,
    }
  }

  const isMatchingVideo =
    kind === 'video' &&
    /^BV[0-9A-Za-z]{10}$/.test(mediaId) &&
    canonicalUrl === `https://www.bilibili.com/video/${mediaId}`
  const episodeMatch = /^(?:ep)?([1-9][0-9]*)$/i.exec(mediaId)
  const normalizedEpisodeId = episodeMatch?.[1] ?? null
  const isMatchingEpisode =
    kind === 'episode' &&
    normalizedEpisodeId !== null &&
    canonicalUrl ===
      `https://www.bilibili.com/bangumi/play/ep${normalizedEpisodeId}`
  if (!isMatchingVideo && !isMatchingEpisode) return null

  return {
    provider,
    kind,
    mediaId:
      isMatchingEpisode && normalizedEpisodeId
        ? normalizedEpisodeId
        : mediaId,
    canonicalUrl: isMatchingEpisode
      ? `https://www.bilibili.com/bangumi/play/ep${normalizedEpisodeId}`
      : canonicalUrl,
    author,
    description,
    publishedAt,
  }
}

function parseMediaAsset(
  value: unknown,
  fromSchemaVersion: 1 | 2 | 3 | 4,
): MediaAsset | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const filename = readString(value.filename)
  const thumbnail =
    value.thumbnail === null ? null : readString(value.thumbnail)
  const duration = readString(value.duration)
  const resolution = readString(value.resolution)
  const fps = readString(value.fps)
  const frameCount = readString(value.frameCount)
  const sampleCount = readFiniteNumber(value.sampleCount)
  const size = readString(value.size)
  const codec = readString(value.codec)
  const camera = readString(value.camera)
  const capturedAt = readString(value.capturedAt)
  const sourceFingerprint = readString(value.sourceFingerprint)
  const sourcePath =
    value.sourcePath === null ? null : readString(value.sourcePath)
  const favorite = readBoolean(value.favorite)
  const indexTask = value.indexTask
  const canonicalDurationSeconds = readNullableFiniteNumber(
    value.durationSeconds,
  )
  const canonicalWidth = readNullableFiniteNumber(value.width)
  const canonicalHeight = readNullableFiniteNumber(value.height)
  const canonicalFps = readNullableFiniteNumber(value.fpsValue)
  const canonicalSizeBytes = readNullableFiniteNumber(value.sizeBytes)
  const indexError = readNullableString(value.indexError)
  const online =
    fromSchemaVersion === 4 && value.online !== undefined
      ? parseOnlineMediaDescriptor(value.online)
      : undefined

  if (
    !id ||
    !filename ||
    thumbnail === undefined ||
    !duration ||
    !resolution ||
    !fps ||
    !frameCount ||
    sampleCount === null ||
    !size ||
    !codec ||
    !camera ||
    !capturedAt ||
    !sourceFingerprint ||
    sourcePath === undefined ||
    favorite === null ||
    !isMediaIndexTask(indexTask) ||
    (fromSchemaVersion === 4 &&
      value.online !== undefined &&
      online === null) ||
    (online !== undefined &&
      online !== null &&
      (sourcePath !== null ||
        (thumbnail !== null && !isAbsoluteManagedPath(thumbnail)))) ||
    (fromSchemaVersion >= 2 &&
      (canonicalDurationSeconds === undefined ||
        canonicalWidth === undefined ||
        canonicalHeight === undefined ||
        canonicalFps === undefined ||
        canonicalSizeBytes === undefined ||
        indexError === undefined)) ||
    (canonicalDurationSeconds !== undefined &&
      canonicalDurationSeconds !== null &&
      canonicalDurationSeconds < 0) ||
    (canonicalWidth !== undefined &&
      canonicalWidth !== null &&
      (!Number.isInteger(canonicalWidth) || canonicalWidth <= 0)) ||
    (canonicalHeight !== undefined &&
      canonicalHeight !== null &&
      (!Number.isInteger(canonicalHeight) || canonicalHeight <= 0)) ||
    (canonicalFps !== undefined &&
      canonicalFps !== null &&
      canonicalFps <= 0) ||
    (canonicalSizeBytes !== undefined &&
      canonicalSizeBytes !== null &&
      (!Number.isSafeInteger(canonicalSizeBytes) || canonicalSizeBytes < 0))
  ) {
    return null
  }

  const legacyResolution = parseLegacyResolution(resolution)
  return {
    id,
    filename,
    thumbnail,
    duration,
    resolution,
    fps,
    frameCount,
    sampleCount: Math.max(0, Math.round(sampleCount)),
    size,
    codec,
    camera,
    capturedAt,
    sourceFingerprint,
    sourcePath,
    favorite,
    indexTask,
    durationSeconds:
      canonicalDurationSeconds ??
      (fromSchemaVersion === 1 ? parseLegacyDurationSeconds(duration) : null),
    width:
      canonicalWidth ??
      (fromSchemaVersion === 1 ? legacyResolution.width : null),
    height:
      canonicalHeight ??
      (fromSchemaVersion === 1 ? legacyResolution.height : null),
    fpsValue:
      canonicalFps ??
      (fromSchemaVersion === 1 ? parseLegacyFps(fps) : null),
    sizeBytes:
      canonicalSizeBytes ??
      (fromSchemaVersion === 1 ? parseLegacySizeBytes(size) : null),
    indexError: indexError ?? null,
    ...(online ? { online } : {}),
  }
}

function parseVisualIndexFrame(
  value: unknown,
  durationSeconds: number | null,
): MediaVisualIndexFrame | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const index = readFiniteNumber(value.index)
  const timeSeconds = readFiniteNumber(value.timeSeconds)
  const imagePath = readString(value.imagePath)
  if (
    !id ||
    index === null ||
    !Number.isInteger(index) ||
    index < 0 ||
    timeSeconds === null ||
    timeSeconds < 0 ||
    (durationSeconds !== null && timeSeconds > durationSeconds) ||
    !imagePath
  ) {
    return null
  }
  return { id, index, timeSeconds, imagePath }
}

function parseMediaVisualIndex(
  value: unknown,
  assetsById: Map<string, MediaAsset>,
): MediaVisualIndex | null {
  if (!isRecord(value) || !Array.isArray(value.frames)) return null
  const assetId = readString(value.assetId)
  const sourceFingerprint = readString(value.sourceFingerprint)
  const createdAt = readString(value.createdAt)
  const version = readFiniteNumber(value.version)
  const posterPath = readString(value.posterPath)
  const previewPath =
    value.previewPath === undefined
      ? null
      : readNullableString(value.previewPath)
  const asset = assetId ? assetsById.get(assetId) : null
  if (
    !assetId ||
    !asset ||
    !sourceFingerprint ||
    sourceFingerprint !== asset.sourceFingerprint ||
    !createdAt ||
    version === null ||
    !Number.isInteger(version) ||
    version < MEDIA_VISUAL_INDEX_VERSION ||
    !posterPath ||
    previewPath === undefined
  ) {
    return null
  }

  const frameIds = new Set<string>()
  const frameIndexes = new Set<number>()
  const frames = value.frames
    .map((frame) => parseVisualIndexFrame(frame, asset.durationSeconds))
    .filter((frame): frame is MediaVisualIndexFrame => {
      if (
        frame === null ||
        frameIds.has(frame.id) ||
        frameIndexes.has(frame.index)
      ) {
        return false
      }
      frameIds.add(frame.id)
      frameIndexes.add(frame.index)
      return true
    })
  if (frames.length === 0) return null

  return {
    assetId,
    sourceFingerprint,
    createdAt,
    version,
    posterPath,
    previewPath,
    frames,
  }
}

function parseFrameAnnotation(
  value: unknown,
  validFrameIdsByAsset: Map<string, Set<string>>,
): FrameAnnotation | null {
  if (!isRecord(value)) return null
  const assetId = readString(value.assetId)
  const frameId = readString(value.frameId)
  const favorite = readBoolean(value.favorite)
  const rating = readFiniteNumber(value.rating)
  const tags = Array.isArray(value.tags)
    ? [
        ...new Set(
          value.tags.filter(
            (tag): tag is string =>
              typeof tag === 'string' && tag.trim() !== '',
          ),
        ),
      ]
    : null
  const note = readString(value.note)
  if (
    !assetId ||
    !frameId ||
    !validFrameIdsByAsset.get(assetId)?.has(frameId) ||
    favorite === null ||
    rating === null ||
    !Number.isInteger(rating) ||
    rating < 0 ||
    rating > 5 ||
    tags === null ||
    note === null
  ) {
    return null
  }
  return { assetId, frameId, favorite, rating, tags, note }
}

function parseProjectAssetRef(value: unknown): ProjectAssetRef | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const projectId = readString(value.projectId)
  const assetId = readString(value.assetId)
  const order = readFiniteNumber(value.order)
  const thumbnailFollowsProject = readBoolean(value.thumbnailFollowsProject)
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === 'string')
    : null
  const annotated = readBoolean(value.annotated)
  const note = readString(value.note)

  if (
    !id ||
    !projectId ||
    !assetId ||
    order === null ||
    thumbnailFollowsProject === null ||
    tags === null ||
    annotated === null ||
    note === null
  ) {
    return null
  }

  return {
    id,
    projectId,
    assetId,
    order: Math.max(0, Math.round(order)),
    thumbnailFollowsProject,
    tags,
    annotated,
    note,
  }
}

function parseProjectTitles(value: unknown) {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].trim() !== '' &&
        typeof entry[1] === 'string' &&
        entry[1].trim() !== '',
    ),
  )
}

function isAbsoluteManagedPath(value: string) {
  if (value.includes('\0')) return false
  return (
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value)
  )
}

function parseProjectCovers(
  value: unknown,
  projectIds: Set<string>,
): Record<string, PersistedProjectCover> {
  if (!isRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value).flatMap(([projectId, rawCover]) => {
      if (!projectIds.has(projectId) || !isRecord(rawCover)) return []
      const name = readString(rawCover.name)?.trim() ?? ''
      const managedPath = readString(rawCover.managedPath) ?? ''
      if (
        !name ||
        name.length > MAX_PROJECT_COVER_NAME_LENGTH ||
        !isAbsoluteManagedPath(managedPath)
      ) {
        return []
      }
      return [[projectId, { name, managedPath }]]
    }),
  )
}

function portableAssetUrl(value: string | null) {
  if (!value) return value
  try {
    const url = new URL(value)
    const managedAssetPathMarker = ['', 'aurora', ''].join('/')
    const assetPathIndex = url.pathname.lastIndexOf(managedAssetPathMarker)
    if (
      (url.protocol === 'http:' ||
        url.protocol === 'https:' ||
        url.protocol === 'file:') &&
      assetPathIndex >= 0
    ) {
      return `.${url.pathname.slice(assetPathIndex)}`
    }
  } catch {
    return value
  }
  return value
}

export function serializePersistentLibrary(
  state: SerializablePersistentLibraryState,
): PersistentLibraryState {
  const projectAssetCounts = getProjectAssetCounts(state.projectAssetRefs)
  const projectIds = new Set(state.projects.map((project) => project.id))
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    projects: state.projects.map((project) => ({
      ...project,
      videoCount: projectAssetCounts.get(project.id) ?? 0,
      cover: portableAssetUrl(project.cover) ?? project.cover,
    })),
    mediaAssets: state.mediaAssets.map((asset) => ({
      ...asset,
      thumbnail: portableAssetUrl(asset.thumbnail),
    })),
    projectAssetRefs: state.projectAssetRefs,
    // Visual-index files live inside Aurora's managed application-data
    // directory. Keep their absolute paths intact so Electron can read them
    // without resolving them against the current document URL.
    visualIndexes: state.visualIndexes ?? [],
    frameAnnotations: state.frameAnnotations ?? [],
    modelAssets: state.modelAssets ?? [],
    projectTitles: state.projectTitles,
    projectCovers: parseProjectCovers(state.projectCovers ?? {}, projectIds),
    selectedProjectId: state.selectedProjectId,
  }
}

export function parsePersistentLibrary(
  appData: Record<string, unknown> | null,
): PersistentLibraryState | null {
  const library = appData?.library
  const sourceSchemaVersion = library && isRecord(library)
    ? library.schemaVersion
    : null
  if (
    !isRecord(library) ||
    (sourceSchemaVersion !== 1 &&
      sourceSchemaVersion !== 2 &&
      sourceSchemaVersion !== 3 &&
      sourceSchemaVersion !== LIBRARY_SCHEMA_VERSION) ||
    !Array.isArray(library.projects) ||
    !Array.isArray(library.mediaAssets) ||
    !Array.isArray(library.projectAssetRefs) ||
    (typeof sourceSchemaVersion === 'number' &&
      sourceSchemaVersion >= 2 &&
      (!Array.isArray(library.visualIndexes) ||
        !Array.isArray(library.frameAnnotations)))
  ) {
    return null
  }
  const parsedSchemaVersion = sourceSchemaVersion as 1 | 2 | 3 | 4

  const projects = library.projects
    .map(parseProject)
    .filter((project): project is Project => project !== null)
  const mediaAssets = library.mediaAssets
    .map((asset) => parseMediaAsset(asset, parsedSchemaVersion))
    .filter((asset): asset is MediaAsset => asset !== null)
    .filter((asset) => !isDemoMediaAsset(asset))
  const projectIds = new Set(projects.map((project) => project.id))
  const modelAssets = (Array.isArray(library.modelAssets)
    ? library.modelAssets
    : []
  )
    .map(parseModelAsset)
    .filter(
      (asset): asset is ModelAsset =>
        asset !== null && projectIds.has(asset.projectId),
    )
  const assetIds = new Set(mediaAssets.map((asset) => asset.id))
  const assetsById = new Map(mediaAssets.map((asset) => [asset.id, asset]))
  const projectAssetRefs = library.projectAssetRefs
    .map(parseProjectAssetRef)
    .filter(
      (reference): reference is ProjectAssetRef =>
        reference !== null &&
        projectIds.has(reference.projectId) &&
        assetIds.has(reference.assetId),
    )
  const visualIndexAssetIds = new Set<string>()
  const persistedVisualIndexValues =
    parsedSchemaVersion >= 2
      ? (library.visualIndexes as unknown[])
      : []
  const outdatedVisualIndexAssetIds = new Set(
    persistedVisualIndexValues.flatMap((value) => {
      if (!isRecord(value)) return []
      const assetId = readString(value.assetId)
      const version = readFiniteNumber(value.version)
      return assetId &&
        assetsById.has(assetId) &&
        version !== null &&
        Number.isInteger(version) &&
        version < MEDIA_VISUAL_INDEX_VERSION
        ? [assetId]
        : []
    }),
  )
  const visualIndexes =
    parsedSchemaVersion >= 2
      ? persistedVisualIndexValues
          .map((index) => parseMediaVisualIndex(index, assetsById))
          .filter((index): index is MediaVisualIndex => {
            if (
              index === null ||
              visualIndexAssetIds.has(index.assetId)
            ) {
              return false
            }
            visualIndexAssetIds.add(index.assetId)
            return true
          })
      : []
  const validFrameIdsByAsset = new Map(
    visualIndexes.map((index) => [
      index.assetId,
      new Set(index.frames.map((frame) => frame.id)),
    ]),
  )
  const visualIndexesByAssetId = new Map(
    visualIndexes.map((index) => [index.assetId, index]),
  )
  const normalizedMediaAssets = mediaAssets.map((asset) => {
    if (!asset.sourcePath) return asset

    const visualIndex = visualIndexesByAssetId.get(asset.id)
    if (visualIndex) {
      const sampleCount = visualIndex.frames.length
      return asset.sampleCount === sampleCount
        ? asset
        : { ...asset, sampleCount }
    }
    if (asset.sampleCount <= 0) return asset

    const outdated = outdatedVisualIndexAssetIds.has(asset.id)
    return {
      ...asset,
      thumbnail: outdated ? null : asset.thumbnail,
      sampleCount: 0,
      indexTask:
        outdated || asset.indexTask === 'building'
          ? ('idle' as const)
          : asset.indexTask,
      indexError: outdated
        ? '视觉索引版本已更新，请重新建立。'
        : asset.indexError ?? '视觉索引数据缺失，请重新建立。',
    }
  })
  const annotationKeys = new Set<string>()
  const frameAnnotations =
    parsedSchemaVersion >= 2
      ? (library.frameAnnotations as unknown[])
          .map((annotation) =>
            parseFrameAnnotation(annotation, validFrameIdsByAsset),
          )
          .filter((annotation): annotation is FrameAnnotation => {
            if (annotation === null) return false
            const key = `${annotation.assetId}\u0000${annotation.frameId}`
            if (annotationKeys.has(key)) return false
            annotationKeys.add(key)
            return true
          })
      : []

  if (projects.length === 0) return null

  const counts = getProjectAssetCounts(projectAssetRefs)
  const normalizedProjects = projects.map((project) => ({
    ...project,
    videoCount: counts.get(project.id) ?? 0,
  }))
  const selectedProjectId =
    readString(library.selectedProjectId) &&
    projectIds.has(String(library.selectedProjectId))
      ? String(library.selectedProjectId)
      : normalizedProjects[0].id

  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    projects: normalizedProjects,
    mediaAssets: normalizedMediaAssets,
    projectAssetRefs,
    visualIndexes,
    frameAnnotations,
    modelAssets,
    projectTitles: parseProjectTitles(library.projectTitles),
    projectCovers:
      parsedSchemaVersion >= 3
        ? parseProjectCovers(library.projectCovers, projectIds)
        : {},
    selectedProjectId,
  }
}
