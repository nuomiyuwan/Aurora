import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent as ReactChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Box,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  FolderOpen,
  FolderPlus,
  Grid3X3,
  HardDrive,
  Image,
  ListFilter,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { WindowsWindowControls } from './features/window-controls/WindowsWindowControls'
import { AppUpdatePrompt } from './features/app-update/AppUpdatePrompt'
import {
  DEFAULT_ACTIVE_PROJECT_ID,
  getDefaultProjectDescription,
  mergeDefaultProjects,
  projects as initialProjects,
  type Project,
  type ProjectKind,
} from './data/projects'
import type {
  ModelAsset,
  ModelCameraState,
  ModelEnvironmentPresetId,
  PreparedModelAsset,
} from './data/modelLibraryTypes'
import {
  getModelAssetFormatLabel,
  isDuplicateModelImport,
} from './data/modelLibraryTypes'
import {
  parsePersistentLibrary,
  serializePersistentLibrary,
} from './data/libraryPersistence'
import {
  getMediaColorPreset,
  getNextMediaColorPresetId,
  normalizeMediaColorPresetId,
  type MediaColorPresetId,
} from './data/mediaColorPresets'
import type {
  FrameAnnotation as StoredFrameAnnotation,
  FrameExclusion,
  MediaAsset,
  MediaIndexTask,
  MediaVisualIndex,
  OnlineMediaDescriptor,
  ProjectAssetRef,
} from './data/mediaLibraryTypes'
import {
  ONLINE_MEDIA_PROVIDER_IDS,
  createDefaultOnlineProviderEnabledState,
  getOnlineProviderLabel,
  getOnlineProviderManifest,
  parseOnlineProviderSettings,
  serializeOnlineProviderSettings,
  type OnlineMediaProvider,
  type OnlineProviderEnabledState,
} from './data/onlineProviderRegistry'
import {
  EXPORTED_CLIP_MATERIAL_TAG,
  getNextProjectAssetOrder,
  getProjectExportedMaterialCounts,
  getProjectMediaCounts,
  isOnlineMediaAsset,
  selectReferencedMediaAssets,
  selectLibraryMediaAssets,
} from './data/mediaLibrarySelectors'
import { resolveExportedMediaRegistration } from './data/exportedMediaRegistration'
import {
  resolveDocumentAssetUrl,
  toCssImageValue,
} from './documentAssetUrl'
import {
  DiscoveryView,
  type DiscoveryAiSearchRequest,
  type DiscoveryOnlineSearchPage,
  type DiscoveryOnlineSearchRequest,
} from './features/discovery/DiscoveryView'
import { createLocalDiscoveryResults } from './features/discovery/createLocalDiscoveryResults'
import { createOnlineDiscoveryResults } from './features/discovery/createOnlineDiscoveryResults'
import { createAiVisualSearchCandidates } from './features/discovery/aiVisualSearchCandidates'
import type {
  DiscoveryFootageResult,
  DiscoveryModelResult,
  DiscoveryOnlineVideoResult,
  DiscoveryResult,
} from './features/discovery/discoveryData'
import type { DiscoveryResultActionRequest } from './features/discovery/discoveryResultActions'
import { EmbyConnectionPanel } from './features/media-sources/EmbyConnectionPanel'
import { OnlineAccountCenter } from './features/media-sources/OnlineAccountCenter'
import {
  FrameRingView,
  type FrameAnnotation as FrameRingAnnotation,
  type FrameRingClipExportRequest,
  type FrameRingExportResult,
  type FrameRingStillExportRequest,
} from './features/frame-ring/FrameRingView'
import {
  createFrameRingAnnotationSuggestion,
  type FrameRingAnnotationSuggestion,
  type FrameRingSmartApplyRequest,
  type FrameRingSmartApplyResult,
  type FrameRingSmartScanResult,
  type FrameRingSmartSensitivity,
} from './features/frame-ring/frameRingSmartOrganize'
import { resolveFrameRingLayout } from './features/frame-ring/frameRingLayout'
import type { FrameRingEntryIntent } from './features/frame-ring/frameRingEntryIntent'
import {
  createFrameRingFrames,
  formatFrameRingTimecode,
  getDefaultFrameIndex,
  getFrameRingReflectionPreloadFrames,
  getVisibleFrameRange,
  parseFrameRingFps,
  resolveFrameRingPreviewTask,
} from './features/frame-ring/frameRingData'
import {
  createBackgroundReflectionSurface,
  createBackgroundReflectionSurfaceFromUrl,
  disposeBackgroundReflectionSurfaceWorker,
  isBackgroundReflectionSurfaceAbortError,
  type BackgroundReflectionMediaKind,
} from './features/reflection/createBackgroundReflectionSurface'
import type { BackgroundReflectionSurface } from './features/reflection/backgroundReflectionSurfaceProtocol'
import { GalleryReflectionCanvas } from './features/project-gallery/GalleryReflectionCanvas'
import { HOME_CARD_GLASS_CORNER_RADIUS_RATIO } from './features/project-gallery/cardUiLayout'
import {
  GALLERY_GROUND_Y_RATIO,
  getHomeCardAlphaBottomOffset,
} from './features/project-gallery/galleryCardLayout'
import {
  FavoritesGalleryView,
  type FavoriteGalleryItem,
} from './features/favorites-gallery/FavoritesGalleryView'
import {
  AURORA_LAYOUT_REFERENCE,
  AURORA_TOPBAR_CENTER_Y,
  resolveResponsiveMetrics,
  type ResponsiveMetrics,
} from './features/responsive-layout/responsiveLayout'
import { useSceneCameraController } from './features/scene-camera/useSceneCameraController'
import { requiresKnownVideoPreviewProxy } from './features/videoPlaybackCompatibility'
import {
  VideoLibraryReflectionCanvas,
  type ClipReflectionSource,
} from './features/video-library/VideoLibraryReflectionCanvas'
import {
  resolveVideoClipHoverFrameIndex,
  resolveVideoClipHoverPlaybackSource,
  resolveVideoClipHoverProgress,
  resolveVideoClipHoverSeekTime,
  shouldHandleVideoClipHoverPointer,
} from './features/video-library/videoClipHoverScrub'
import {
  ModelLibraryView,
  type ModelImportState,
} from './features/model-library/ModelLibraryView'
import { ModelViewerPage } from './features/model-viewer/ModelViewerPage'
import {
  MODEL_ASSET_TRIANGLE_WARNING,
  MODEL_ASSET_WARNING_BYTES,
  getModelSourceFormat,
  isSupportedModelFile,
  normalizeModelImport,
  prepareModelAsset,
} from './features/model-viewer/modelAssetRuntime'
import {
  PageSettingsPanel,
  type AiLocalModelDetectionResult,
  type AiServiceConnectionTestResult,
  type AiServiceKind,
  type AiServiceProfileInput,
  type PageBackgroundMedia,
  type PageVisualSettings,
} from './features/page-settings/PageSettingsPanel'
import { PAGE_SETTINGS_RANGE_DEFAULTS } from './features/page-settings/pageSettingsDefaults'
import {
  APPEARANCE_PAGE_IDS,
  DEFAULT_MATERIAL_TINT,
  createDefaultPageSettings,
  createDefaultVisualSettings,
  parseAppearanceSettings,
  serializeAppearanceSettings,
} from './features/page-settings/pageSettingsPersistence'
import {
  getParticleVisualScale,
  type CustomParticleMedia,
  type ParticleImportState,
  type ParticleShape,
} from './features/page-settings/particleSettings'
import {
  ParticleVideoCanvas,
  type ParticleCanvasSprite,
} from './features/page-settings/ParticleVideoCanvas'
import { validateParticleMediaInBrowser } from './features/page-settings/validateParticleMedia'
import {
  DETAIL_PANEL_CORNER_RADIUS_RATIO,
  VIDEO_CLIP_INFO_CORNER_RADIUS,
} from './features/video-library/videoClipGeometry'
import {
  getVideoClipVisualStyle,
  getVideoLibraryCssVariables,
  resolveVideoLibraryLayout,
} from './features/video-library/videoLibraryLayout'
import {
  formatMediaFileSize,
  getStandardResolutionBadge,
} from './features/video-library/mediaDisplayMetadata'
import {
  ALL_CLIP_FILTER_VALUE,
  DEFAULT_CLIP_FILTER_STATE,
  filterAndSortVideoClips,
  formatClipResolutionKey,
  getClipResolutionOptions,
  getClipTagOptions,
  isClipFilterStateActive,
  type ClipFilterState,
} from './features/video-library/clipFiltering'
import {
  createClipAiMetadataSuggestion,
  createImportedClipAiMetadataPatch,
  mergeClipAiTags,
  selectClipAiRepresentativeFrames,
  type ClipAiMetadataSuggestion,
} from './features/video-library/clipAiMetadata'
import {
  formatProjectStorageSummary,
  summarizeProjectStorage,
} from './features/video-library/projectStorage'
import { syncProjectedGlass } from './features/video-library/projectedGlassProjection'
import {
  StartupGate,
  type StartupLibraryState,
  type StartupWarmupView,
} from './features/startup/StartupGate'
import {
  PAGE_TRANSITION_ENTER_MS,
  PAGE_TRANSITION_EXIT_MS,
} from './pageTransition'
import {
  readWheelDragSample,
  resolveTrackpadSnapTarget,
  resolveWheelDragPreviewPosition,
  type WheelDragAxis,
  WHEEL_DRAG_END_DELAY,
} from './features/wheelDragGesture'
import './App.css'
import './features/discovery/DiscoveryView.css'

type NavId = 'library' | 'project-details' | 'online-search' | 'favorites'

type PageVisualCapabilities = {
  label: string
  reflection: boolean
  particles: boolean
  projectDetails: boolean
}

/*
 * Register every new page here before rendering it. This keeps the settings
 * panel and reflection lifecycle aligned instead of growing page-specific
 * conditionals in several unrelated places.
 */
const PAGE_VISUAL_CAPABILITIES = {
  gallery: {
    label: '主页',
    reflection: true,
    particles: true,
    projectDetails: false,
  },
  'video-library': {
    label: '视频片段库',
    reflection: true,
    particles: false,
    projectDetails: true,
  },
  'frame-ring': {
    label: '帧环浏览',
    reflection: true,
    particles: false,
    projectDetails: false,
  },
  'model-library': {
    label: '三维模型库',
    reflection: false,
    particles: false,
    projectDetails: true,
  },
  'model-viewer': {
    label: '三维查看',
    reflection: false,
    particles: false,
    projectDetails: false,
  },
  'online-search': {
    label: '探索页',
    reflection: true,
    particles: false,
    projectDetails: false,
  },
  favorites: {
    label: '收藏展馆',
    reflection: true,
    particles: false,
    projectDetails: false,
  },
} as const satisfies Record<string, PageVisualCapabilities>

type AppView = keyof typeof PAGE_VISUAL_CAPABILITIES
type ReflectionView = {
  [View in AppView]:
    (typeof PAGE_VISUAL_CAPABILITIES)[View]['reflection'] extends true
      ? View
      : never
}[AppView]
type ReflectionSurfaceNotice = {
  state: 'generating' | 'fallback'
  message: string
} | null

type PageTransitionPhase = 'idle' | 'exiting' | 'entering'
type PageTransitionDirection = 'deeper' | 'shallower'
type SettingsPanelMode = 'visual' | 'emby'

const DISCOVERY_ROUTE_HASH = '#/discovery'
const FAVORITES_ROUTE_HASH = '#/favorites'
const SCENE_CAMERA_PITCH_RANGE = [-10, 8] as const

const readAppViewFromLocation = (): AppView => {
  const route = window.location.hash.toLocaleLowerCase()
  if (route === DISCOVERY_ROUTE_HASH) return 'online-search'
  if (route === FAVORITES_ROUTE_HASH) return 'favorites'
  return 'gallery'
}

const writeAppViewRoute = (view: AppView) => {
  const nextHash = view === 'online-search'
    ? DISCOVERY_ROUTE_HASH
    : view === 'favorites'
      ? FAVORITES_ROUTE_HASH
      : ''
  if (window.location.hash === nextHash) return
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`
  window.history.pushState({ auroraView: view }, '', nextUrl)
}

const REFLECTION_VIEWS = (
  Object.keys(PAGE_VISUAL_CAPABILITIES) as AppView[]
).filter(
  (view): view is ReflectionView =>
    PAGE_VISUAL_CAPABILITIES[view].reflection,
)

const isReflectionView = (view: AppView): view is ReflectionView =>
  PAGE_VISUAL_CAPABILITIES[view].reflection

const createEmptyReflectionSurfaces = (): Record<ReflectionView, BackgroundReflectionSurface | null> => ({
  gallery: null,
  'video-library': null,
  'frame-ring': null,
  'online-search': null,
  favorites: null,
})

const createEmptyReflectionNotices = (): Record<ReflectionView, ReflectionSurfaceNotice> => ({
  gallery: null,
  'video-library': null,
  'frame-ring': null,
  'online-search': null,
  favorites: null,
})

const createReflectionRequestVersions = (): Record<ReflectionView, number> => ({
  gallery: 0,
  'video-library': 0,
  'frame-ring': 0,
  'online-search': 0,
  favorites: 0,
})

const createPageImportRequestVersions = (): Record<AppView, number> =>
  Object.fromEntries(
    (Object.keys(PAGE_VISUAL_CAPABILITIES) as AppView[]).map((view) => [
      view,
      0,
    ]),
  ) as Record<AppView, number>

type NavItem = {
  id: NavId
  label: string
  icon: typeof Circle
}

type VideoClip = {
  id: string
  assetId: string
  projectId: string
  order: number
  filename: string
  thumbnail: string
  duration: string
  durationSeconds: number | null
  resolution: string
  resolutionBadge: string | null
  width: number | null
  height: number | null
  fps: string
  fpsValue: number | null
  frameCount: string
  sampleCount: number
  size: string
  sizeBytes: number | null
  codec: string
  camera: string
  capturedAt: string
  sourcePath: string | null
  sourceUrl: string | null
  sourceFingerprint: string
  indexedFrames: Array<{
    id: string
    index: number
    thumbnail: string
    timeSeconds: number
    imagePath: string
  }>
  favorite: boolean
  indexTask: MediaIndexTask
  tags: string[]
  annotated: boolean
  note: string
  colorPreset: MediaColorPresetId
  online?: OnlineMediaDescriptor
}

type ClipHoverScrubVideoPortal = {
  clipId: string
  sourceUrl: string
  poster: string
  target: HTMLElement
  lightweight: boolean
}

type ClipHoverScrubSession = {
  clipId: string
  mode: 'frames' | 'video'
  image: HTMLElement
  hitTarget: HTMLElement
  progress: number
  sourceUrl: string | null
  lastFrameIndex: number
  frameLoadVersion: number
}

type PendingClipHoverScrub = {
  clip: VideoClip
  clientX: number
  clientY: number
  hitTarget: HTMLElement
}

type ExternalVideoAddCandidate = {
  descriptor: ExternalVideoFileDescriptor
  asset: MediaAsset
  clip: VideoClip
  sourceChanged: boolean
}

type OnlineVideoAddCandidate = {
  asset: MediaAsset & { online: OnlineMediaDescriptor; sourcePath: null }
  clip: VideoClip & { online: OnlineMediaDescriptor }
}

type PreviewPlaybackState = {
  status: 'preparing' | 'ready' | 'failed'
  sourcePath: string
  playbackPath: string | null
  usesPreviewProxy: boolean
  error: string | null
}

type LightweightPreviewState = {
  status: 'preparing' | 'ready' | 'failed'
  sourcePath: string
  playbackPath: string | null
  error: string | null
}

type FrameRingFocusTarget = {
  clipId: string
  frameId?: string
  timeSeconds: number
  requestId: number
  intent: FrameRingEntryIntent
}

type FrameRingSmartUndoSnapshot = {
  assetId: string
  clipId: string
  sourceFingerprint: string
  visualIndexCreatedAt: string
  annotations: StoredFrameAnnotation[]
  exclusions: FrameExclusion[]
}

const AI_SEARCH_MAX_CANDIDATES = 2_000
const AI_SEARCH_COARSE_FRAMES_PER_CLIP = 24
const AI_SEARCH_REFINEMENT_RADIUS = 3
const AI_SEARCH_REFINEMENT_SEED_COUNT = 12

const sampleEvenly = <T,>(items: readonly T[], maximum: number): T[] => {
  if (items.length <= maximum) return [...items]
  return Array.from({ length: maximum }, (_, index) =>
    items[Math.floor(index * items.length / maximum)],
  )
}

const createCoarseAiVisualCandidates = (
  candidates: readonly AiVisualFrameCandidate[],
) => {
  const candidatesByClip = new Map<string, AiVisualFrameCandidate[]>()
  candidates.forEach((candidate) => {
    const current = candidatesByClip.get(candidate.clipId) ?? []
    current.push(candidate)
    candidatesByClip.set(candidate.clipId, current)
  })
  const coarse = [...candidatesByClip.values()].flatMap((clipCandidates) =>
    sampleEvenly(clipCandidates, AI_SEARCH_COARSE_FRAMES_PER_CLIP),
  )
  return sampleEvenly(coarse, AI_SEARCH_MAX_CANDIDATES)
}

const createRefinedAiVisualCandidates = (
  candidates: readonly AiVisualFrameCandidate[],
  coarseCandidates: readonly AiVisualFrameCandidate[],
  matches: readonly AiVisualSearchMatch[],
) => {
  const candidatesByClip = new Map<string, AiVisualFrameCandidate[]>()
  candidates.forEach((candidate) => {
    const current = candidatesByClip.get(candidate.clipId) ?? []
    current.push(candidate)
    candidatesByClip.set(candidate.clipId, current)
  })
  const selected = new Map(
    coarseCandidates.map((candidate) => [candidate.resultId, candidate]),
  )

  matches.slice(0, AI_SEARCH_REFINEMENT_SEED_COUNT).forEach((match) => {
    const seed = candidates.find(
      (candidate) => candidate.resultId === match.resultId,
    )
    if (!seed) return
    const clipCandidates = candidatesByClip.get(seed.clipId) ?? []
    const seedIndex = clipCandidates.findIndex(
      (candidate) => candidate.resultId === seed.resultId,
    )
    if (seedIndex < 0) return
    const start = Math.max(0, seedIndex - AI_SEARCH_REFINEMENT_RADIUS)
    const end = Math.min(
      clipCandidates.length,
      seedIndex + AI_SEARCH_REFINEMENT_RADIUS + 1,
    )
    clipCandidates.slice(start, end).forEach((candidate) => {
      selected.set(candidate.resultId, candidate)
    })
  })

  return sampleEvenly([...selected.values()], AI_SEARCH_MAX_CANDIDATES)
}

type ClipFilterMenuId = keyof ClipFilterState

type ClipFilterOption = {
  value: string
  label: string
}

const CLIP_STATUS_FILTER_OPTIONS = [
  { value: 'all', label: '全部视频' },
  { value: 'favorite', label: '已收藏' },
  { value: 'indexed', label: '已建立索引' },
  { value: 'unindexed', label: '未建立索引' },
] as const satisfies readonly ClipFilterOption[]

const CLIP_DATE_SORT_OPTIONS = [
  { value: 'default', label: '拍摄日期' },
  { value: 'newest', label: '最新优先' },
  { value: 'oldest', label: '最早优先' },
] as const satisfies readonly ClipFilterOption[]

const CLIP_DURATION_FILTER_OPTIONS = [
  { value: 'all', label: '时长' },
  { value: 'under60', label: '小于 1 分钟' },
  { value: '60to300', label: '1–5 分钟' },
  { value: '300to1200', label: '5–20 分钟' },
  { value: 'over1200', label: '20 分钟以上' },
  { value: 'unknown', label: '待分析' },
] as const satisfies readonly ClipFilterOption[]

type CardSlotStyle = {
  left: number
  width: number
  opacity: number
  scale: number
  rotate: number
  tilt: number
  depth: number
  blur: number
  saturate: number
  brightness: number
  reflectionOpacity: number
}

type ProjectCoverOverride = {
  name: string
  url: string
  managedPath: string | null
}

type ProjectCustomization = {
  title: string
  cover: ProjectCoverOverride | null
}

type ProjectMenuState = {
  projectId: string
}

type ClipActionNotice = {
  message: string
  projectId?: string
}

type ClipAiMetadataDialogState = {
  clipId: string
  filename: string
  status: 'analyzing' | 'ready' | 'error'
  tags: string[]
  selectedTags: string[]
  note: string
  applyNote: boolean
  evidenceCount: number
  evidenceTier: 'thumbnail' | 'visual-index' | null
  newlyAnalyzedFrameCount: number
  error: string | null
}

type ClipAiMetadataTarget = {
  clipId: string
  assetId: string
  projectId: string
  filename: string
  sourceFingerprint: string
  evidenceRevision: string
  evidenceTier: 'thumbnail' | 'visual-index'
  candidates: AiVisualFrameCandidate[]
}

type ClipAiMetadataAnalysisResult = {
  target: ClipAiMetadataTarget
  suggestion: ClipAiMetadataSuggestion
  evidenceCount: number
  newlyAnalyzedFrameCount: number
}

type ImportedClipAiMetadataRequest = {
  referenceId: string
  placeholder: {
    tag: string
    note: string
  }
}

type ProjectImportProgress = {
  projectId: string
  projectTitle: string
  total: number
  processed: number
  added: number
  duplicate: number
  unsupported: number
  failed: number
  currentName: string
  complete: boolean
}

const PROJECT_RELEASE_SETTLE_PADDING = 40
const PAGE_VIEW_DEPTH: Record<AppView, number> = {
  gallery: 0,
  'video-library': 1,
  'frame-ring': 2,
  'model-library': 1,
  'model-viewer': 2,
  'online-search': 1,
  favorites: 1,
}
const CLIP_TRACK_VISIBLE_COLUMNS = 4
const CLIP_TRACK_SPRING_STIFFNESS = 220
const CLIP_TRACK_SPRING_DAMPING = 30
const CLIP_TRACK_RELEASE_PROJECTION_SECONDS = 0.14
const CLIP_TRACK_MAX_FLING_COLUMNS = 4
const CLIP_DETAIL_TAG_MAX_COUNT = 6
const CLIP_DETAIL_TAG_MAX_LENGTH = 12
const CLIP_DETAIL_NOTE_MAX_LENGTH = 40
const CLIP_AI_REPRESENTATIVE_FRAME_LIMIT = 8
const IMPORTED_CLIP_DEFAULT_TAG = '新导入'
const IMPORTED_CLIP_DEFAULT_NOTE = '刚导入 Aurora，等待后续建立视觉索引。'
const EXTERNAL_CLIP_DEFAULT_NOTE = '从系统打开的外部视频，尚未加入 Aurora。'
const STARTUP_MODEL_THUMBNAIL_PRELOAD_LIMIT = 48
const EMPTY_PROJECT_COVER = ''
const LEGACY_EMPTY_PROJECT_COVER = './aurora/Project-Details-Background.png'
const navItems: NavItem[] = [
  { id: 'library', label: '项目库', icon: Circle },
  { id: 'project-details', label: '项目详情', icon: Grid3X3 },
  { id: 'online-search', label: '探索', icon: Search },
  { id: 'favorites', label: '收藏精选', icon: Star },
]

function formatProjectTimestamp(timestamp = Date.now()) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(' ')
}

function formatProjectMediaSummary(
  project: Pick<
    Project,
    | 'videoCount'
    | 'localVideoCount'
    | 'onlineVideoCount'
    | 'collectionCount'
  >,
  options: { includeMaterials?: boolean } = {},
) {
  const onlineVideoCount = project.onlineVideoCount ?? 0
  const localVideoCount =
    project.localVideoCount ??
    Math.max(0, project.videoCount - onlineVideoCount)
  const parts = [
    `${localVideoCount} 个视频`,
    `${onlineVideoCount} 个在线视频`,
  ]
  if (options.includeMaterials !== false) {
    parts.push(`${project.collectionCount} 个素材`)
  }
  return parts.join(' · ')
}

function formatImportedDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '待分析'
  }
  const totalSeconds = Math.max(0, Math.round(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`
    : `${pad(minutes)}:${pad(remainingSeconds)}`
}

function formatImportedFps(fps: number | null) {
  if (fps === null || !Number.isFinite(fps) || fps <= 0) return '待分析'
  const rounded = Math.round(fps)
  const value =
    Math.abs(fps - rounded) < 0.005
      ? String(rounded)
      : fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `${value} fps`
}

function formatImportedCodecName(codec: string | null, filename: string) {
  if (!codec) return getImportedCodec(filename)
  const labels: Record<string, string> = {
    av1: 'AV1',
    h264: 'H.264',
    hevc: 'HEVC',
    mjpeg: 'Motion JPEG',
    prores: 'Apple ProRes',
    vp8: 'VP8',
    vp9: 'VP9',
  }
  return labels[codec.toLowerCase()] ?? codec.toUpperCase()
}

function createMediaSourceFingerprint(
  filePath: string,
  sizeBytes: number,
  modifiedAt: string,
) {
  return [
    'local',
    filePath,
    sizeBytes,
    modifiedAt,
  ].join(':')
}

function getExternalVideoPreviewAssetId(
  descriptor: ExternalVideoFileDescriptor,
) {
  const value = [
    descriptor.path,
    descriptor.sizeBytes,
    descriptor.modifiedAt,
  ].join('\u0000')
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `asset:external-preview:${(hash >>> 0).toString(36)}`
}

function getMediaSourceFingerprint(metadata: MediaFileMetadata) {
  return createMediaSourceFingerprint(
    metadata.filePath,
    metadata.sizeBytes,
    metadata.modifiedAt,
  )
}

function mediaAssetMatchesSourceState(
  asset: MediaAsset,
  sizeBytes: number,
  modifiedAt: string,
) {
  if (!asset.sourcePath) return false
  return (
    asset.sizeBytes === sizeBytes &&
    asset.sourceFingerprint ===
      createMediaSourceFingerprint(
        asset.sourcePath,
        sizeBytes,
        modifiedAt,
      )
  )
}

function mediaAssetMatchesImportedFile(
  asset: MediaAsset,
  file: File,
  sourcePath: string | null,
) {
  if (
    !sourcePath ||
    asset.sourcePath !== sourcePath ||
    asset.sizeBytes !== file.size
  ) {
    return false
  }
  if (!Number.isFinite(file.lastModified) || file.lastModified <= 0) {
    return true
  }
  return mediaAssetMatchesSourceState(
    asset,
    file.size,
    new Date(file.lastModified).toISOString(),
  )
}

function applyMediaFileMetadata(
  asset: MediaAsset,
  metadata: MediaFileMetadata,
): MediaAsset {
  const capturedAt = Date.parse(metadata.capturedAt ?? metadata.modifiedAt)
  return {
    ...asset,
    filename: metadata.filename || asset.filename,
    duration: formatImportedDuration(metadata.durationSeconds),
    resolution:
      metadata.width && metadata.height
        ? `${metadata.width} x ${metadata.height}`
        : '待分析',
    fps: formatImportedFps(metadata.fps),
    frameCount:
      metadata.frameCount === null
        ? '待分析'
        : String(metadata.frameCount),
    size: formatMediaFileSize(metadata.sizeBytes),
    codec: formatImportedCodecName(metadata.codec, metadata.filename),
    capturedAt: Number.isFinite(capturedAt)
      ? formatProjectTimestamp(capturedAt)
      : asset.capturedAt,
    sourcePath: metadata.filePath,
    sourceFingerprint: getMediaSourceFingerprint(metadata),
    durationSeconds: metadata.durationSeconds,
    width: metadata.width,
    height: metadata.height,
    fpsValue: metadata.fps,
    sizeBytes: metadata.sizeBytes,
    indexError: null,
  }
}

function mediaAssetNeedsInspection(asset: MediaAsset) {
  return (
    Boolean(asset.sourcePath) &&
    (asset.durationSeconds === null ||
      asset.width === null ||
      asset.height === null ||
      asset.sizeBytes === null)
  )
}

function mediaAssetNeedsThumbnail(asset: MediaAsset) {
  return Boolean(asset.sourcePath) && !asset.thumbnail
}

function getImportedCodec(filename: string) {
  const extension = filename.split('.').pop()?.toUpperCase()
  return extension ? `${extension} 媒体` : '待分析'
}

function resolveLibraryMediaUrl(value: string | null | undefined) {
  if (!value) return ''
  if (
    window.desktopBridge?.getMediaUrl &&
    (value.startsWith('/') || /^[a-z]:[\\/]/i.test(value))
  ) {
    return window.desktopBridge.getMediaUrl(value) ?? ''
  }
  return resolveDocumentAssetUrl(value)
}

type OnlineSelectionDescriptor = OnlineProviderSelectionDescriptor

type OnlineSearchAsset = MediaAsset & {
  online: OnlineMediaDescriptor
  sourcePath: null
}

const createEmptyOnlineSearchAssets = (): Record<
  OnlineMediaProvider,
  OnlineSearchAsset[]
> => ({
  bilibili: [],
  tencent: [],
  xinpianchang: [],
  youku: [],
  douyin: [],
})

const createOnlineSearchRequestState = (): Record<
  OnlineMediaProvider,
  { sequence: number; query: string }
> => ({
  bilibili: { sequence: 0, query: '' },
  tencent: { sequence: 0, query: '' },
  xinpianchang: { sequence: 0, query: '' },
  youku: { sequence: 0, query: '' },
  douyin: { sequence: 0, query: '' },
})

function createOnlineMediaAsset(
  descriptor: OnlineSelectionDescriptor,
  existing?: MediaAsset,
): (MediaAsset & { online: OnlineMediaDescriptor; sourcePath: null }) | null {
  const mediaId = descriptor.mediaId.trim()
  if (!mediaId) return null

  const assetId = `asset:online:${descriptor.source}:${descriptor.kind}:${mediaId}`
  const existingOnline =
    existing && isOnlineMediaAsset(existing) ? existing.online : undefined
  const online: OnlineMediaDescriptor = {
    provider: descriptor.source,
    kind: descriptor.kind,
    mediaId,
    canonicalUrl: descriptor.canonicalUrl,
    author:
      descriptor.author.trim() || existingOnline?.author.trim() || '未公开',
    description:
      descriptor.description.trim() || existingOnline?.description || '',
    publishedAt:
      descriptor.publishedAt.trim() || existingOnline?.publishedAt || '',
  }

  return {
    id: assetId,
    filename: descriptor.title.trim() || existing?.filename || mediaId,
    thumbnail: descriptor.thumbnailPath ?? existing?.thumbnail ?? null,
    duration:
      descriptor.duration.trim() ||
      existing?.duration ||
      `由${getOnlineProviderLabel(descriptor.source)}页面提供`,
    resolution: existing?.resolution || '在线',
    fps: existing?.fps || '在线',
    frameCount: '不适用',
    sampleCount: 0,
    size: '不下载',
    codec: getOnlineProviderManifest(descriptor.source).codecLabel,
    camera: '在线来源',
    capturedAt:
      descriptor.publishedAt.trim() || existing?.capturedAt || '未写入',
    sourceFingerprint: `online:${descriptor.source}:${descriptor.kind}:${mediaId}`,
    sourcePath: null,
    favorite: existing?.favorite ?? false,
    indexTask: 'idle',
    durationSeconds: null,
    width: null,
    height: null,
    fpsValue: null,
    sizeBytes: null,
    indexError: null,
    online,
  }
}

function createOnlineVideoClip(
  asset: MediaAsset & { online: OnlineMediaDescriptor; sourcePath: null },
  reference?: ProjectAssetRef,
  projectCover?: string,
): VideoClip & { online: OnlineMediaDescriptor } {
  return {
    id: reference?.id ?? `online:${asset.id}`,
    assetId: asset.id,
    projectId: reference?.projectId ?? '',
    order: reference?.order ?? 0,
    filename: asset.filename,
    thumbnail:
      resolveLibraryMediaUrl(asset.thumbnail) ||
      projectCover ||
      resolveDocumentAssetUrl('./aurora/project-new-frontier.png'),
    duration: asset.duration,
    durationSeconds: null,
    resolution: asset.resolution,
    resolutionBadge: null,
    width: null,
    height: null,
    fps: asset.fps,
    fpsValue: null,
    frameCount: '不适用',
    sampleCount: 0,
    size: asset.size,
    sizeBytes: null,
    codec: asset.codec,
    camera: asset.camera,
    capturedAt: asset.capturedAt,
    sourcePath: null,
    sourceUrl: null,
    sourceFingerprint: asset.sourceFingerprint,
    indexedFrames: [],
    favorite: asset.favorite,
    indexTask: 'idle',
    tags: reference?.tags ?? [],
    annotated: reference?.annotated ?? false,
    note: reference?.note ?? asset.online.description,
    colorPreset: 'original',
    online: asset.online,
  }
}

function isSupportedVideoFile(file: File) {
  return (
    file.type.startsWith('video/') ||
    /\.(avi|m4v|mkv|mov|mp4|mxf|webm)$/i.test(file.name)
  )
}

function createImportedProjectMedia(
  file: File,
  project: Project,
  sequence: number,
): { asset: MediaAsset; reference: ProjectAssetRef } {
  const runtimeId = `${Date.now().toString(36)}:${sequence}:${Math.random()
    .toString(36)
    .slice(2, 8)}`
  const assetId = `asset:import:${runtimeId}`
  const sourcePath =
    window.desktopBridge?.getPathForFile?.(file) ??
    ('path' in file && typeof (file as File & { path?: unknown }).path === 'string'
      ? ((file as File & { path: string }).path || null)
      : null)
  const sourceFingerprint = sourcePath
    ? `local:${sourcePath}`
    : `browser:${file.name}:${file.size}:${file.lastModified}:${file.type}`

  return {
    asset: {
      id: assetId,
      filename: file.name,
      thumbnail: null,
      duration: '待分析',
      resolution: '待分析',
      fps: '待分析',
      frameCount: '待分析',
      sampleCount: 0,
      size: formatMediaFileSize(file.size),
      codec: getImportedCodec(file.name),
      camera: '未写入',
      capturedAt: formatProjectTimestamp(file.lastModified || Date.now()),
      sourceFingerprint,
      sourcePath,
      favorite: false,
      indexTask: 'idle',
      durationSeconds: null,
      width: null,
      height: null,
      fpsValue: null,
      sizeBytes: file.size,
      indexError: null,
    },
    reference: {
      id: `${project.id}:ref:${assetId}`,
      projectId: project.id,
      assetId,
      order: project.videoCount + sequence,
      thumbnailFollowsProject: true,
      tags: [IMPORTED_CLIP_DEFAULT_TAG],
      annotated: false,
      note: IMPORTED_CLIP_DEFAULT_NOTE,
    },
  }
}

function createExportedMediaAsset(
  metadata: MediaFileMetadata,
): MediaAsset {
  const runtimeId = `${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 8)}`
  const capturedAt = Date.parse(metadata.capturedAt ?? metadata.modifiedAt)
  const asset: MediaAsset = {
    id: `asset:export:${runtimeId}`,
    filename: metadata.filename,
    thumbnail: null,
    duration: '待分析',
    resolution: '待分析',
    fps: '待分析',
    frameCount: '待分析',
    sampleCount: 0,
    size: formatMediaFileSize(metadata.sizeBytes),
    codec: getImportedCodec(metadata.filename),
    camera: '未写入',
    capturedAt: formatProjectTimestamp(
      Number.isFinite(capturedAt) ? capturedAt : Date.now(),
    ),
    sourceFingerprint: getMediaSourceFingerprint(metadata),
    sourcePath: metadata.filePath,
    favorite: false,
    indexTask: 'idle',
    durationSeconds: null,
    width: null,
    height: null,
    fpsValue: null,
    sizeBytes: metadata.sizeBytes,
    indexError: null,
  }
  return applyMediaFileMetadata(asset, metadata)
}

type ExportedClipRegistrationResult = {
  projectTitle: string
  addedReference: boolean
  thumbnailReady: boolean
}

function particleNoise(index: number, channel: number) {
  const value = Math.sin((index + 1) * 12.9898 + channel * 78.233) * 43758.5453
  return value - Math.floor(value)
}

const ambientParticlePool = Array.from({ length: 160 }, (_, index) => {
  const duration = 18 + particleNoise(index, 4) * 34
  const speed = (52 - duration) / 34
  const trailFactor = Math.max(0, Math.min(1, (speed - 0.32) / 0.68))
  const size = 1.1 + particleNoise(index, 3) * 3.2
  const verticalDirection = particleNoise(index, 7) < 0.5 ? -1 : 1
  const verticalEnd = verticalDirection * (80 + particleNoise(index, 8) * 250)
  const curveBend = verticalEnd * ((particleNoise(index, 12) - 0.5) * 0.28)

  return {
    id: index,
    left: 102 + particleNoise(index, 1) * 32,
    top: 16 + particleNoise(index, 2) * 78,
    size,
    delay: -particleNoise(index, 5) * duration,
    duration,
    drift: 104 + particleNoise(index, 6) * 92,
    verticalEnd,
    curveBend,
    opacity: 0.2 + particleNoise(index, 9) * 0.34,
    stretch:
      size * (1 + particleNoise(index, 13) * 0.48) +
      trailFactor * (2.4 + speed * 6.8 + particleNoise(index, 10) * 2.8),
    trail: trailFactor * (4 + speed * 12 + particleNoise(index, 10) * 4),
    trailOpacity: trailFactor * (0.12 + speed * 0.28),
    motionBlur: 0.12 + trailFactor * (0.16 + speed * 0.38),
    coreBlur: 0.02 + particleNoise(index, 11) * 0.1,
    rotationSeed: particleNoise(index, 14),
  }
})

type AmbientParticleRenderItem = ParticleCanvasSprite & {
  motionPath: string
  cssStyle: CSSProperties
}

const cardSlotStyles: Record<-2 | -1 | 0 | 1 | 2, CardSlotStyle> = {
  [-2]: {
    left: 22,
    width: 500,
    opacity: 1,
    scale: 0.96,
    rotate: 50,
    tilt: 0,
    depth: -90,
    blur: 0.4,
    saturate: 0.66,
    brightness: 0.7,
    reflectionOpacity: 0.56,
  },
  [-1]: {
    left: 37.5,
    width: 580,
    opacity: 1,
    scale: 0.98,
    rotate: 45,
    tilt: 0,
    depth: 50,
    blur: 0.2,
    saturate: 0.85,
    brightness: 0.85,
    reflectionOpacity: 0.72,
  },
  0: {
    left: 55,
    width: 610,
    opacity: 1,
    scale: 1,
    rotate: 30,
    tilt: 0,
    depth: 300,
    blur: 0,
    saturate: 1,
    brightness: 1,
    reflectionOpacity: 0.88,
  },
  1: {
    left: 69,
    width: 600,
    opacity: 1,
    scale: 1,
    rotate: -30,
    tilt: 0,
    depth: -120,
    blur: 0.2,
    saturate: 0.8,
    brightness: 0.8,
    reflectionOpacity: 0.52,
  },
  2: {
    left: 86,
    width: 540,
    opacity: 1,
    scale: 1,
    rotate: -35,
    tilt: 0,
    depth: -420,
    blur: 0.4,
    saturate: 0.62,
    brightness: 0.62,
    reflectionOpacity: 0.56,
  },
}

function clampVisualOffset(offset: number) {
  return Math.max(-2, Math.min(2, offset))
}

function wrapProjectIndex(index: number, projectCount: number) {
  return (index + projectCount) % projectCount
}

function getCarouselOffsets(projectCount: number, realtimeMotion: boolean) {
  if (projectCount <= 1) return [0]
  if (projectCount === 2) return [-1, 0]
  if (projectCount === 3) return [-1, 0, 1]
  if (projectCount === 4) return [-2, -1, 0, 1]

  return realtimeMotion ? [-3, -2, -1, 0, 1, 2, 3] : [-2, -1, 0, 1, 2]
}

function getStepReleaseOffsets(projectCount: number, stepDelta: number) {
  return getCarouselOffsets(projectCount, stepDelta !== 0)
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

let cachedMaterialTritoneColor = ''
let cachedMaterialTritoneFilter = ''

function createDefaultProjectCustomizations(): Record<string, ProjectCustomization> {
  return Object.fromEntries(
    initialProjects.map((project) => [
      project.id,
      {
        title: project.title,
        cover: null,
      },
    ]),
  )
}

function hexToRgb(color: string) {
  const normalized = color.trim().replace(/^#/, '')
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((channel) => `${channel}${channel}`)
          .join('')
      : normalized
  const value = Number.parseInt(expanded, 16)

  if (!Number.isFinite(value) || expanded.length !== 6) {
    return { r: 255, g: 255, b: 255 }
  }

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function getMaterialTintFilter(color: string) {
  const normalizedColor = color.trim().toLowerCase()
  if (normalizedColor === DEFAULT_MATERIAL_TINT) return ''
  if (normalizedColor === cachedMaterialTritoneColor) {
    return cachedMaterialTritoneFilter
  }

  const midtone = hexToRgb(normalizedColor)
  const tableValues = {
    red: `0 ${(midtone.r / 255).toFixed(6)} 1`,
    green: `0 ${(midtone.g / 255).toFixed(6)} 1`,
    blue: `0 ${(midtone.b / 255).toFixed(6)} 1`,
  }
  const filterSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<filter id="tritone" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">',
    '<feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0" result="luminance"/>',
    '<feComponentTransfer in="luminance">',
    `<feFuncR type="table" tableValues="${tableValues.red}"/>`,
    `<feFuncG type="table" tableValues="${tableValues.green}"/>`,
    `<feFuncB type="table" tableValues="${tableValues.blue}"/>`,
    '<feFuncA type="identity"/>',
    '</feComponentTransfer>',
    '</filter>',
    '</svg>',
  ].join('')

  cachedMaterialTritoneColor = normalizedColor
  cachedMaterialTritoneFilter =
    `url("data:image/svg+xml,${encodeURIComponent(filterSvg)}#tritone")`
  return cachedMaterialTritoneFilter
}

function getPageColorGradeFilter(settings: PageVisualSettings) {
  if (
    settings.contrast === PAGE_SETTINGS_RANGE_DEFAULTS.contrast &&
    settings.saturation === PAGE_SETTINGS_RANGE_DEFAULTS.saturation &&
    settings.hue === PAGE_SETTINGS_RANGE_DEFAULTS.hue
  ) {
    return ''
  }

  return [
    `contrast(${settings.contrast / 100})`,
    `saturate(${settings.saturation / 100})`,
    `hue-rotate(${settings.hue}deg)`,
  ].join(' ')
}

function getParticlePalette(color: string) {
  const { r, g, b } = hexToRgb(color)
  const scale = (value: number, factor: number) => Math.round(clampNumber(value * factor, 0, 255))
  return {
    core: `${r}, ${g}, ${b}`,
    trail: `${scale(r, 222 / 228)}, ${scale(g, 238 / 240)}, ${b}`,
    glow: `${scale(r, 202 / 228)}, ${scale(g, 228 / 240)}, ${b}`,
  }
}

function smoothstep01(value: number) {
  const progress = clampNumber(value, 0, 1)
  return progress * progress * (3 - 2 * progress)
}

function getProjectDragLimit(
  layoutScale: number,
  direction: number,
  projectCount = initialProjects.length,
) {
  if (projectCount <= 1) return 46 * layoutScale

  const targetSlot = direction > 0 ? -1 : direction < 0 ? 1 : 0
  if (targetSlot === 0) {
    const leftTravel = Math.abs(cardSlotStyles[-1].left - cardSlotStyles[0].left)
    const rightTravel = Math.abs(cardSlotStyles[1].left - cardSlotStyles[0].left)
    const baseTravel =
      (AURORA_LAYOUT_REFERENCE.width * ((leftTravel + rightTravel) / 2)) / 100
    return clampNumber(baseTravel, 160, 460) * layoutScale
  }

  const travel = Math.abs(cardSlotStyles[targetSlot].left - cardSlotStyles[0].left)
  const baseTravel = (AURORA_LAYOUT_REFERENCE.width * travel) / 100
  return clampNumber(baseTravel, 160, 460) * layoutScale
}

function createClipTrackColumns(items: readonly VideoClip[]) {
  const columns: Array<{ top?: VideoClip; bottom?: VideoClip }> = []

  for (let pageStart = 0; pageStart < items.length; pageStart += 8) {
    for (let column = 0; column < CLIP_TRACK_VISIBLE_COLUMNS; column += 1) {
      const top = items[pageStart + column]
      const bottom = items[pageStart + CLIP_TRACK_VISIBLE_COLUMNS + column]
      if (top || bottom) columns.push({ top, bottom })
    }
  }

  return columns
}

function getActiveCardWidth() {
  return Math.min(AURORA_LAYOUT_REFERENCE.width * 0.42, 650)
}

const HOME_CARD_DOM_RASTER_SCALE = 1
const HOME_CARD_SURFACE_RASTER_SCALE = 1.5

function getCardVisualStyle(
  offset: number,
  dragProgress: number,
  layout: ResponsiveMetrics,
  realtimeMotion = false,
) {
  const rawVisualOffset = offset + dragProgress
  const visualOffset = clampVisualOffset(rawVisualOffset)
  const lowerSlot = Math.floor(visualOffset) as -2 | -1 | 0 | 1 | 2
  const upperSlot = Math.ceil(visualOffset) as -2 | -1 | 0 | 1 | 2
  const progress = visualOffset - lowerSlot
  const lower = {
    ...cardSlotStyles[lowerSlot],
    width: lowerSlot === 0 ? getActiveCardWidth() : cardSlotStyles[lowerSlot].width,
  }
  const upper = {
    ...cardSlotStyles[upperSlot],
    width: upperSlot === 0 ? getActiveCardWidth() : cardSlotStyles[upperSlot].width,
  }

  const blur = lerp(lower.blur, upper.blur, progress)
  const saturate = lerp(lower.saturate, upper.saturate, progress)
  const brightness = lerp(lower.brightness, upper.brightness, progress)
  const reflectionOpacity = lerp(lower.reflectionOpacity, upper.reflectionOpacity, progress)
  const cardWidth = lerp(lower.width, upper.width, progress)
  const cardLeftPercent = lerp(lower.left, upper.left, progress)
  const cardScale = lerp(lower.scale, upper.scale, progress)
  const cardDepth = lerp(lower.depth, upper.depth, progress)
  const crossesActiveSlot = lowerSlot !== upperSlot && (lowerSlot === 0 || upperSlot === 0)
  const paintDepth = crossesActiveSlot
    ? progress < 0.5
      ? lower.depth
      : upper.depth
    : cardDepth
  const stablePaintLayer = Math.min(90_000, Math.round((paintDepth + 400) * 100))
  const edgeOverflow = realtimeMotion ? Math.max(0, Math.abs(rawVisualOffset) - 2) : 0
  const edgeExitProgress = smoothstep01(edgeOverflow)
  const edgeFade = 1 - edgeExitProgress
  const edgeScale = 1 - edgeExitProgress * 0.12
  const visualCardScale =
    (cardWidth / 610) * cardScale * edgeScale * layout.layoutScale
  const cardRenderScale = visualCardScale / HOME_CARD_DOM_RASTER_SCALE
  const edgeTravelPercent = Math.sign(rawVisualOffset) * edgeExitProgress * 6
  const cardLeft =
    layout.planeLeft + (layout.planeWidth * (cardLeftPercent + edgeTravelPercent)) / 100
  const cardTop =
    layout.planeTop +
    layout.planeHeight * GALLERY_GROUND_Y_RATIO -
    getHomeCardAlphaBottomOffset(visualCardScale)
  const cardVisualFilter = `blur(${blur * layout.layoutScale * HOME_CARD_DOM_RASTER_SCALE * HOME_CARD_SURFACE_RASTER_SCALE}px) saturate(${saturate}) brightness(${brightness})`
  const cardTextFilter =
    Math.abs(blur) < 0.0001 &&
    Math.abs(saturate - 1) < 0.0001 &&
    Math.abs(brightness - 1) < 0.0001
      ? 'none'
      : cardVisualFilter

  return {
    '--card-left': `${cardLeft}px`,
    '--card-top': `${cardTop}px`,
    '--card-width': `${cardWidth * layout.layoutScale}px`,
    '--card-raster-scale': HOME_CARD_DOM_RASTER_SCALE,
    '--card-opacity': lerp(lower.opacity, upper.opacity, progress) * edgeFade,
    '--card-render-scale': cardRenderScale,
    '--card-rotate': `${lerp(lower.rotate, upper.rotate, progress)}deg`,
    '--card-tilt': `${lerp(lower.tilt, upper.tilt, progress)}deg`,
    '--card-depth': `${cardDepth * layout.layoutScale}px`,
    '--card-z': stablePaintLayer,
    '--reflection-slot-opacity': reflectionOpacity * edgeFade,
    '--card-text-filter': cardTextFilter,
    '--card-visual-filter': cardVisualFilter,
  } as CSSProperties
}

function StageBackgroundMedia({
  active,
  background,
  view,
}: {
  active: boolean
  background: NonNullable<PageBackgroundMedia>
  view: AppView
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!active) {
      video.pause()
      return
    }
    void video.play().catch(() => undefined)
  }, [active, background.url])

  if (background.kind === 'image') {
    return (
      <img
        className="stageBackgroundMedia"
        data-page-active={active}
        data-background-view={view}
        src={background.url}
        alt=""
        decoding="async"
      />
    )
  }

  return (
    <video
      ref={videoRef}
      className="stageBackgroundMedia"
      data-page-active={active}
      data-background-view={view}
      src={background.url}
      autoPlay={active}
      muted
      loop
      playsInline
      preload="auto"
    />
  )
}

const INITIAL_APP_UPDATE_STATE: AppUpdateState = {
  currentVersion: __AURORA_VERSION__,
  supported: false,
  installMode: 'automatic',
  status: 'unsupported',
  latestVersion: null,
  releaseName: null,
  releaseNotes: [],
  releaseDate: null,
  progress: null,
  checkedAt: null,
  source: null,
  error: null,
}

function App() {
  const defaultActiveIndex = initialProjects.findIndex(
    (project) => project.id === DEFAULT_ACTIVE_PROJECT_ID,
  )
  const [projects, setProjects] = useState<Project[]>(() => [
    ...initialProjects,
  ])
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([])
  const [modelAssets, setModelAssets] = useState<ModelAsset[]>([])
  const [projectAssetRefs, setProjectAssetRefs] = useState<ProjectAssetRef[]>([])
  const [visualIndexes, setVisualIndexes] = useState<MediaVisualIndex[]>([])
  const [frameAnnotations, setFrameAnnotations] = useState<
    StoredFrameAnnotation[]
  >([])
  const [frameExclusions, setFrameExclusions] = useState<FrameExclusion[]>([])
  const [indexProgressByAsset, setIndexProgressByAsset] = useState<
    Record<string, number>
  >({})
  const [previewProgressByAsset, setPreviewProgressByAsset] = useState<
    Record<string, number>
  >({})
  const [previewPlaybackByAsset, setPreviewPlaybackByAsset] = useState<
    Record<string, PreviewPlaybackState>
  >({})
  const [lightweightPreviewByAsset, setLightweightPreviewByAsset] = useState<
    Record<string, LightweightPreviewState>
  >({})
  const [clipMenuId, setClipMenuId] = useState<string | null>(null)
  const [clipAddDialogId, setClipAddDialogId] = useState<string | null>(null)
  const [externalVideoQueue, setExternalVideoQueue] = useState<
    ExternalVideoFileDescriptor[]
  >([])
  const [externalVideoPreparing, setExternalVideoPreparing] = useState(false)
  const [externalVideoAddCandidate, setExternalVideoAddCandidate] =
    useState<ExternalVideoAddCandidate | null>(null)
  const [bilibiliSelectionAsset, setBilibiliSelectionAsset] =
    useState<(MediaAsset & {
      online: OnlineMediaDescriptor
      sourcePath: null
    }) | null>(null)
  const [onlineSearchAssetsByProvider, setOnlineSearchAssetsByProvider] =
    useState<Record<OnlineMediaProvider, OnlineSearchAsset[]>>(
      createEmptyOnlineSearchAssets,
    )
  const onlineSearchAssetsByProviderRef = useRef(
    onlineSearchAssetsByProvider,
  )
  const onlineSearchRequestStateRef = useRef(createOnlineSearchRequestState())
  const [onlineProviderEnabled, setOnlineProviderEnabled] =
    useState<OnlineProviderEnabledState>(
      createDefaultOnlineProviderEnabledState,
    )
  const onlineProviderEnabledRef = useRef(onlineProviderEnabled)
  const [onlineProviderSettingsReady, setOnlineProviderSettingsReady] =
    useState(() => !window.desktopBridge)
  const [onlineFrameRingAsset, setOnlineFrameRingAsset] = useState<
    (MediaAsset & {
      online: OnlineMediaDescriptor
      sourcePath: null
    }) | null
  >(null)
  const [onlineVideoAddCandidate, setOnlineVideoAddCandidate] =
    useState<OnlineVideoAddCandidate | null>(null)
  const [externalVideoNavigationClipId, setExternalVideoNavigationClipId] =
    useState<string | null>(null)
  const [clipRemoveDialogId, setClipRemoveDialogId] = useState<string | null>(
    null,
  )
  const [clipAddMode, setClipAddMode] = useState<'existing' | 'new'>(
    'existing',
  )
  const [clipAddTargetProjectId, setClipAddTargetProjectId] = useState('')
  const [clipAddNewProjectName, setClipAddNewProjectName] =
    useState('新素材项目')
  const [clipAddNewProjectEnglishName, setClipAddNewProjectEnglishName] =
    useState('')
  const [clipActionNotice, setClipActionNotice] =
    useState<ClipActionNotice | null>(null)
  const [projectImportProgress, setProjectImportProgress] =
    useState<ProjectImportProgress | null>(null)
  const [isProjectFileDragActive, setIsProjectFileDragActive] =
    useState(false)
  const [clipTagEditorId, setClipTagEditorId] = useState<string | null>(null)
  const [clipTagDraft, setClipTagDraft] = useState('')
  const [clipTagEditorStatus, setClipTagEditorStatus] = useState('')
  const [clipNoteEditorId, setClipNoteEditorId] = useState<string | null>(null)
  const [clipNoteDraft, setClipNoteDraft] = useState('')
  const [clipAiMetadataDialog, setClipAiMetadataDialog] =
    useState<ClipAiMetadataDialogState | null>(null)
  const [detailPreviewPlayingKey, setDetailPreviewPlayingKey] =
    useState<string | null>(null)
  const [detailPreviewFailedSource, setDetailPreviewFailedSource] =
    useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(defaultActiveIndex)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isReleasing, setIsReleasing] = useState(false)
  const [hoveredProjectCardKey, setHoveredProjectCardKey] = useState<string | null>(null)
  const [releaseSource, setReleaseSource] = useState<'drag' | 'step' | null>(null)
  const [releaseStepDelta, setReleaseStepDelta] = useState(0)
  const [isRecycling, setIsRecycling] = useState(false)
  const [releaseDuration, setReleaseDuration] = useState(360)
  const [currentView, setCurrentView] = useState<AppView>(readAppViewFromLocation)
  const pageParentViewRef = useRef<Partial<Record<AppView, AppView>>>({})
  const {
    pose: cameraPose,
    isDragging: isCameraDragging,
    resetPose: resetCameraPose,
    bind: cameraGesture,
  } = useSceneCameraController({
    pitchRange: SCENE_CAMERA_PITCH_RANGE,
  })
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  const appPlatform = window.desktopBridge?.platform ?? 'web'
  /*
   * Chromium can retain the old DirectWrite texture after a Windows window
   * resize changes the scale of the gallery's 3D ancestors. Re-key only the
   * text paint leaves at the new physical viewport size; media, card state and
   * interaction layers stay mounted throughout the native resize.
   */
  const windowsTextRasterRevision = appPlatform === 'win32'
    ? `${Math.round(viewportWidth * window.devicePixelRatio)}x${Math.round(
        viewportHeight * window.devicePixelRatio,
      )}`
    : 'stable'
  const [activeNav, setActiveNav] = useState<NavId>(() =>
    readAppViewFromLocation() === 'online-search'
      ? 'online-search'
      : readAppViewFromLocation() === 'favorites'
        ? 'favorites'
        : 'library',
  )
  const startupInitialViewRef = useRef<StartupWarmupView>(
    currentView === 'online-search'
      ? 'online-search'
      : currentView === 'favorites'
        ? 'favorites'
        : 'gallery',
  )
  const startupGateEnabledRef = useRef(
    Boolean(window.desktopBridge) ||
      (import.meta.env.DEV &&
        new URLSearchParams(window.location.search).get('startup') === '1'),
  )
  const [startupGateActive, setStartupGateActive] = useState(
    startupGateEnabledRef.current,
  )
  const [videoLibraryMounted, setVideoLibraryMounted] = useState(
    () =>
      startupGateEnabledRef.current ||
      currentView === 'video-library',
  )
  const [pageTransitionPhase, setPageTransitionPhase] =
    useState<PageTransitionPhase>('idle')
  const [pageTransitionDirection, setPageTransitionDirection] =
    useState<PageTransitionDirection>('deeper')
  const [hasPageTransitioned, setHasPageTransitioned] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState(DEFAULT_ACTIVE_PROJECT_ID)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [frameRingFocusTarget, setFrameRingFocusTarget] =
    useState<FrameRingFocusTarget | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [clipTrackPosition, setClipTrackPosition] = useState(0)
  const [clipOverscroll, setClipOverscroll] = useState(0)
  const [isClipDragging, setIsClipDragging] = useState(false)
  const [isClipReleasing, setIsClipReleasing] = useState(false)
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null)
  const [clipHoverScrubVideoPortal, setClipHoverScrubVideoPortal] =
    useState<ClipHoverScrubVideoPortal | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('新边界计划')
  const [newProjectEnglishName, setNewProjectEnglishName] = useState('')
  const [newProjectKind, setNewProjectKind] = useState<ProjectKind>('video')
  const [modelImportState, setModelImportState] = useState<ModelImportState>({
    status: 'idle',
    message: '',
  })
  const [modelReflectionWindow, setModelReflectionWindow] = useState<{
    projectId: string
    modelIds: readonly string[]
  }>({ projectId: '', modelIds: [] })
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null)
  const [projectMenuDraftName, setProjectMenuDraftName] = useState('')
  const [projectMenuDraftSubtitle, setProjectMenuDraftSubtitle] = useState('')
  const [projectDeleteDialogId, setProjectDeleteDialogId] = useState<
    string | null
  >(null)
  const [emptyProjectPromptId, setEmptyProjectPromptId] = useState<string | null>(
    null,
  )
  const [query, setQuery] = useState('')
  const [clipFilters, setClipFilters] = useState<ClipFilterState>(() => ({
    ...DEFAULT_CLIP_FILTER_STATE,
  }))
  const [openClipFilterMenu, setOpenClipFilterMenu] =
    useState<ClipFilterMenuId | null>(null)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)
  const [settingsPanelMode, setSettingsPanelMode] =
    useState<SettingsPanelMode>('visual')
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState>(
    INITIAL_APP_UPDATE_STATE,
  )
  const [appUpdatePromptOpen, setAppUpdatePromptOpen] = useState(false)
  const [accountCenterOpen, setAccountCenterOpen] = useState(false)
  const [aiSearchMode, setAiSearchMode] = useState(false)
  const [aiServiceProfilesState, setAiServiceProfilesState] =
    useState<AiServiceProfilesState>({
      visionProfiles: [],
      embeddingProfiles: [],
      activeVisionProfileId: null,
      activeEmbeddingProfileId: null,
      secureStorageAvailable: true,
    })
  const [aiProviderProfilesError, setAiProviderProfilesError] = useState<
    string | null
  >(null)
  const [pageSettings, setPageSettings] = useState<Record<AppView, PageVisualSettings>>(
    createDefaultPageSettings,
  )
  const [particleImportState, setParticleImportState] =
    useState<ParticleImportState>({ status: 'idle', message: null })
  const [reflectionSurfaces, setReflectionSurfaces] = useState(
    createEmptyReflectionSurfaces,
  )
  const [reflectionSurfaceNotices, setReflectionSurfaceNotices] = useState(
    createEmptyReflectionNotices,
  )
  const [projectCustomizations, setProjectCustomizations] = useState<
    Record<string, ProjectCustomization>
  >(createDefaultProjectCustomizations)
  const [libraryPersistenceReady, setLibraryPersistenceReady] = useState(
    () => !window.desktopBridge,
  )
  const [libraryPersistenceFailed, setLibraryPersistenceFailed] =
    useState(false)
  const [appearancePersistenceReady, setAppearancePersistenceReady] = useState(
    () => !window.desktopBridge,
  )
  const backgroundFileInputRef = useRef<HTMLInputElement>(null)
  const particleFileInputRef = useRef<HTMLInputElement>(null)
  const projectCoverFileInputRef = useRef<HTMLInputElement>(null)
  const projectImportFileInputRef = useRef<HTMLInputElement>(null)
  const modelImportFileInputRef = useRef<HTMLInputElement>(null)
  const projectCoverTargetIdRef = useRef<string | null>(null)
  const projectImportTargetIdRef = useRef<string | null>(null)
  const modelImportTargetIdRef = useRef<string | null>(null)
  const projectImportBatchActiveRef = useRef(false)
  const projectImportDragDepthRef = useRef(0)
  const projectImportProgressTimerRef = useRef<number | undefined>(undefined)
  const importedMediaFilesRef = useRef(new Map<string, File>())
  const previewRequestsRef = useRef(new Map<string, Promise<boolean>>())
  const lightweightPreviewRequestsRef = useRef(
    new Map<string, Promise<boolean>>(),
  )
  const clipActionNoticeTimerRef = useRef<number | undefined>(undefined)
  const detailPreviewVideoRef = useRef<HTMLVideoElement>(null)
  const detailColorPresetClickTimerRef = useRef<number | undefined>(undefined)
  const openFrameRingRef = useRef<(clipId: string) => void>(() => undefined)
  const backgroundObjectUrlsRef = useRef(new Set<string>())
  const particleObjectUrlsRef = useRef(new Set<string>())
  const particleImportVersionRef = useRef(0)
  const projectCoverObjectUrlsRef = useRef(new Set<string>())
  const backgroundImportVersionsRef = useRef(createPageImportRequestVersions())
  const projectCoverImportVersionsRef = useRef(new Map<string, number>())
  const pendingAppearanceVisualCleanupRef = useRef(new Set<string>())
  const pendingAppearanceParticleCleanupRef = useRef(new Set<string>())
  const pendingLibraryVisualCleanupRef = useRef(new Set<string>())
  const latestLibraryPersistenceRef = useRef<
    ReturnType<typeof serializePersistentLibrary> | null
  >(null)
  const latestAppearancePersistenceRef = useRef<
    ReturnType<typeof serializeAppearanceSettings> | null
  >(null)
  const latestOnlineProviderSettingsRef = useRef(
    serializeOnlineProviderSettings(onlineProviderEnabled),
  )
  const frameRingSmartUndoRef = useRef<FrameRingSmartUndoSnapshot | null>(null)
  const modelObjectUrlsRef = useRef(new Map<string, string>())
  const reflectionSurfaceRequestVersionsRef = useRef(createReflectionRequestVersions())
  const reflectionSurfaceAbortControllersRef = useRef<
    Partial<Record<ReflectionView, AbortController>>
  >({})
  const reflectionSurfaceNoticeTimersRef = useRef<
    Partial<Record<ReflectionView, number>>
  >({})
  const appMountedRef = useRef(true)
  const prepareExternalVideoAddCandidateRef = useRef<
    (descriptor: ExternalVideoFileDescriptor) => Promise<ExternalVideoAddCandidate>
  >(async () => {
    throw new Error('External video preview is not ready')
  })
  const projectsRef = useRef(projects)
  const mediaAssetsRef = useRef(mediaAssets)
  const modelAssetsRef = useRef(modelAssets)
  const projectAssetRefsRef = useRef(projectAssetRefs)
  const visualIndexesRef = useRef(visualIndexes)
  const frameAnnotationsRef = useRef(frameAnnotations)
  const frameExclusionsRef = useRef(frameExclusions)
  const aiServiceProfilesStateRef = useRef(aiServiceProfilesState)
  const clipAiMetadataRequestVersionRef = useRef(0)
  const importedClipAiMetadataQueueRef = useRef<Promise<void>>(
    Promise.resolve(),
  )
  projectsRef.current = projects
  mediaAssetsRef.current = mediaAssets
  modelAssetsRef.current = modelAssets
  projectAssetRefsRef.current = projectAssetRefs
  visualIndexesRef.current = visualIndexes
  frameAnnotationsRef.current = frameAnnotations
  frameExclusionsRef.current = frameExclusions
  aiServiceProfilesStateRef.current = aiServiceProfilesState
  onlineSearchAssetsByProviderRef.current = onlineSearchAssetsByProvider
  onlineProviderEnabledRef.current = onlineProviderEnabled

  const saveLatestStateSync = useCallback(() => {
    const bridge = window.desktopBridge
    if (!bridge?.saveAppDataSync) return
    const library = latestLibraryPersistenceRef.current
    const appearance = latestAppearancePersistenceRef.current
    const onlineProviders = latestOnlineProviderSettingsRef.current
    const data: Record<string, unknown> = {}
    if (library) data.library = library
    if (appearance) data.appearance = appearance
    if (onlineProviders) data.onlineProviders = onlineProviders
    if (Object.keys(data).length === 0) return
    bridge.saveAppDataSync(data)
  }, [])

  useEffect(() => {
    const bridge = window.desktopBridge
    if (
      typeof bridge?.getAppUpdateState !== 'function' ||
      typeof bridge?.onAppUpdateStateChange !== 'function'
    ) {
      return
    }
    let active = true
    const applyState = (state: AppUpdateState) => {
      if (!active || !state || typeof state.currentVersion !== 'string') return
      setAppUpdateState(state)
    }
    void bridge.getAppUpdateState().then(applyState).catch(() => undefined)
    const dispose = bridge.onAppUpdateStateChange(applyState)
    return () => {
      active = false
      dispose()
    }
  }, [])

  useEffect(() => {
    if (startupGateActive) return
    if (
      appUpdateState.status === 'available' ||
      appUpdateState.status === 'downloading' ||
      appUpdateState.status === 'downloaded' ||
      appUpdateState.status === 'installing'
    ) {
      setAppUpdatePromptOpen(true)
    }
  }, [appUpdateState.status, appUpdateState.latestVersion, startupGateActive])

  const handleCheckForUpdates = useCallback(() => {
    if (appUpdateState.status === 'available') {
      setAppUpdatePromptOpen(true)
      return
    }
    const bridge = window.desktopBridge
    if (typeof bridge?.checkForAppUpdate !== 'function') return
    void bridge.checkForAppUpdate().then(setAppUpdateState).catch(() => undefined)
  }, [appUpdateState.status])

  const handleInstallAppUpdate = useCallback(() => {
    const bridge = window.desktopBridge
    if (typeof bridge?.downloadAndInstallAppUpdate !== 'function') return
    saveLatestStateSync()
    void bridge
      .downloadAndInstallAppUpdate()
      .then(setAppUpdateState)
      .catch(() => undefined)
  }, [saveLatestStateSync])

  useEffect(() => {
    const bridge = window.desktopBridge
    if (!bridge?.onBilibiliSelection) return
    return bridge.onBilibiliSelection((descriptor) => {
      const provisional = createOnlineMediaAsset(descriptor)
      if (!provisional) return
      const existing = mediaAssetsRef.current.find(
        (asset) => asset.id === provisional.id,
      )
      const selectedAsset = createOnlineMediaAsset(descriptor, existing)
      if (!selectedAsset) return
      setBilibiliSelectionAsset(selectedAsset)
      setOnlineSearchAssetsByProvider((current) => {
        const withoutSelected = current.bilibili.filter(
          (asset) => asset.id !== selectedAsset.id,
        )
        return {
          ...current,
          bilibili: [selectedAsset, ...withoutSelected],
        }
      })
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const bridge = window.desktopBridge
    if (!bridge?.getAiServiceProfiles) {
      setAiProviderProfilesError('请在 Aurora 桌面版中配置 AI 模型服务')
      return
    }

    void bridge.getAiServiceProfiles().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setAiProviderProfilesError(result.error.message)
        return
      }
      setAiProviderProfilesError(null)
      setAiServiceProfilesState(result.data)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const hasFilePayload = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const resetProjectFileDrag = () => {
      projectImportDragDepthRef.current = 0
      setIsProjectFileDragActive(false)
    }
    const preventFileNavigation = (event: DragEvent) => {
      if (hasFilePayload(event)) event.preventDefault()
    }
    const handleWindowDrop = (event: DragEvent) => {
      if (!hasFilePayload(event)) return
      event.preventDefault()
      resetProjectFileDrag()
    }
    const handleWindowDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) resetProjectFileDrag()
    }

    window.addEventListener('dragover', preventFileNavigation)
    window.addEventListener('drop', handleWindowDrop)
    window.addEventListener('dragleave', handleWindowDragLeave)
    window.addEventListener('blur', resetProjectFileDrag)
    return () => {
      window.removeEventListener('dragover', preventFileNavigation)
      window.removeEventListener('drop', handleWindowDrop)
      window.removeEventListener('dragleave', handleWindowDragLeave)
      window.removeEventListener('blur', resetProjectFileDrag)
    }
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('renderer')) return
    url.searchParams.delete('renderer')
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    )
  }, [])

  useEffect(() => {
    if (startupGateActive || currentView === 'video-library') {
      setVideoLibraryMounted(true)
    }
  }, [currentView, startupGateActive])

  useEffect(() => {
    const bridge = window.desktopBridge
    if (!bridge) return
    let cancelled = false

    void bridge
      .loadAppData()
      .then(async (appData) => {
        if (cancelled) return
        setLibraryPersistenceFailed(false)
        const restoredOnlineProviders = parseOnlineProviderSettings(
          appData?.onlineProviders,
        )
        setOnlineProviderEnabled(restoredOnlineProviders.enabled)
        latestOnlineProviderSettingsRef.current = restoredOnlineProviders
        setOnlineProviderSettingsReady(true)
        let restoredAppearance = parseAppearanceSettings(
          appData?.appearance,
          bridge.getMediaUrl,
        )
        const hasPersistedAppearance = Boolean(
          appData && Object.hasOwn(appData, 'appearance'),
        )
        const appearanceReadable = !hasPersistedAppearance || Boolean(restoredAppearance)
        const restoredVisualReferences: string[] = []
        const restoredParticleReferences: string[] = []
        if (
          restoredAppearance &&
          (bridge.validateVisualAsset || bridge.validateParticleAsset)
        ) {
          const validatedAppearance = { ...restoredAppearance }
          await Promise.all(
            APPEARANCE_PAGE_IDS.map(async (view) => {
              const page = restoredAppearance?.[view]
              if (!page) return
              let validatedPage = page
              const background = page.background
              if (background && bridge.validateVisualAsset) {
                const validated = await bridge.validateVisualAsset(
                  background.managedPath ?? '',
                  'page-background',
                )
                if (
                  cancelled ||
                  !validated ||
                  validated.kind !== background.kind
                ) {
                  validatedPage = { ...validatedPage, background: null }
                } else {
                  restoredVisualReferences.push(validated.managedPath)
                }
              }
              const customParticle = page.particles.customMedia
              if (customParticle && bridge.validateParticleAsset) {
                const validated = await bridge.validateParticleAsset(
                  customParticle.managedPath ?? '',
                  customParticle.posterPath,
                )
                if (
                  cancelled ||
                  !validated ||
                  validated.kind !== customParticle.kind
                ) {
                  validatedPage = {
                    ...validatedPage,
                    particles: {
                      ...validatedPage.particles,
                      shape: 'dot',
                      customMedia: null,
                    },
                  }
                } else {
                  restoredParticleReferences.push(validated.managedPath)
                  if (validated.posterPath) {
                    restoredParticleReferences.push(validated.posterPath)
                  }
                }
              }
              validatedAppearance[view] = validatedPage
            }),
          )
          restoredAppearance = validatedAppearance
        } else if (restoredAppearance) {
          APPEARANCE_PAGE_IDS.forEach((view) => {
            const managedPath = restoredAppearance?.[view].background?.managedPath
            if (managedPath) restoredVisualReferences.push(managedPath)
            const customParticle =
              restoredAppearance?.[view].particles.customMedia
            if (customParticle?.managedPath) {
              restoredParticleReferences.push(customParticle.managedPath)
            }
            if (customParticle?.posterPath) {
              restoredParticleReferences.push(customParticle.posterPath)
            }
          })
        }
        if (cancelled) return
        if (restoredAppearance) {
          setPageSettings(restoredAppearance)
          Object.entries(restoredAppearance).forEach(([view, settings]) => {
            if (!settings.background) return
            generateReflectionSurfaceForBackground(
              view as AppView,
              settings.background,
              settings.background.kind,
            )
          })
        }
        if (appearanceReadable) {
          if (bridge.pruneParticleAssets) {
            await bridge.pruneParticleAssets(restoredParticleReferences).catch(
              (error) => {
                console.warn(
                  '[Aurora particles] Failed to prune unreferenced particle assets',
                  error,
                )
              },
            )
          }
          if (cancelled) return
          setAppearancePersistenceReady(true)
        } else {
          console.warn(
            '[Aurora appearance] Persisted page settings are invalid; writes remain disabled',
          )
        }

        const parsedLibrary = parsePersistentLibrary(appData)
        if (!parsedLibrary) {
          if (appData && Object.hasOwn(appData, 'library')) {
            setLibraryPersistenceFailed(true)
            return
          }
          if (appearanceReadable && bridge.pruneVisualAssets) {
            await bridge.pruneVisualAssets(restoredVisualReferences).catch(
              (error) => {
                console.warn(
                  '[Aurora appearance] Failed to prune unreferenced visual assets',
                  error,
                )
              },
            )
          }
          if (cancelled) return
          setLibraryPersistenceReady(true)
          return
        }

        let projectCovers = parsedLibrary.projectCovers
        if (bridge.validateVisualAsset) {
          const validatedProjectCovers: typeof projectCovers = {}
          await Promise.all(
            Object.entries(projectCovers).map(async ([projectId, cover]) => {
              const validated = await bridge.validateVisualAsset(
                cover.managedPath,
                'project-cover',
              )
              if (cancelled || !validated || validated.kind !== 'image') return
              validatedProjectCovers[projectId] = cover
              restoredVisualReferences.push(validated.managedPath)
            }),
          )
          projectCovers = validatedProjectCovers
        } else {
          Object.values(projectCovers).forEach((cover) => {
            restoredVisualReferences.push(cover.managedPath)
          })
        }
        if (cancelled) return
        const library = { ...parsedLibrary, projectCovers }
        if (appearanceReadable && bridge.pruneVisualAssets) {
          await bridge.pruneVisualAssets(restoredVisualReferences).catch(
            (error) => {
              console.warn(
                '[Aurora appearance] Failed to prune unreferenced visual assets',
                error,
              )
            },
          )
        }
        if (cancelled) return

        const restoredProjects = mergeDefaultProjects(library.projects).map(
          (project) =>
            project.videoCount === 0 &&
            project.cover === LEGACY_EMPTY_PROJECT_COVER
              ? { ...project, cover: EMPTY_PROJECT_COVER }
              : project,
        )
        const restoredProjectCustomizations = Object.fromEntries(
          restoredProjects.map((project) => {
            const persistedCover = library.projectCovers[project.id]
            const coverUrl = persistedCover
              ? bridge.getMediaUrl(persistedCover.managedPath)
              : null
            return [
              project.id,
              {
                title: library.projectTitles[project.id] ?? project.title,
                cover:
                  persistedCover && coverUrl
                    ? {
                        name: persistedCover.name,
                        url: coverUrl,
                        managedPath: persistedCover.managedPath,
                      }
                    : null,
              } satisfies ProjectCustomization,
            ]
          }),
        )
        const restoredProjectIndex = Math.max(
          0,
          restoredProjects.findIndex(
            (project) => project.id === library.selectedProjectId,
          ),
        )
        const restoredClipId =
          library.projectAssetRefs.find(
            (reference) =>
              reference.projectId === library.selectedProjectId,
          )?.id ?? null

        setProjects(restoredProjects)
        const restoredMediaAssets: MediaAsset[] = library.mediaAssets.map(
          (asset): MediaAsset =>
            asset.indexTask === 'building' ||
            asset.indexTask === 'build-queued' ||
            asset.indexTask === 'rebuild-queued'
              ? {
                  ...asset,
                  indexTask: asset.sampleCount > 0 ? 'idle' : 'failed',
                  indexError:
                    asset.sampleCount > 0
                      ? null
                      : '上一次视觉索引任务未完成，请重新建立。',
                }
              : asset,
        )
        setMediaAssets(restoredMediaAssets)
        setModelAssets(library.modelAssets)
        const assetsWithThumbnails = new Set(
          restoredMediaAssets.flatMap((asset) =>
            asset.thumbnail ? [asset.id] : [],
          ),
        )
        setProjectAssetRefs(
          library.projectAssetRefs.map((reference) =>
            assetsWithThumbnails.has(reference.assetId)
              ? { ...reference, thumbnailFollowsProject: false }
              : reference,
          ),
        )
        setVisualIndexes(library.visualIndexes)
        setFrameAnnotations(library.frameAnnotations)
        setFrameExclusions(library.frameExclusions)
        setProjectCustomizations(restoredProjectCustomizations)
        setSelectedProjectId(library.selectedProjectId)
        setSelectedClipId(restoredClipId)
        setActiveIndex(restoredProjectIndex)

        const inspectMediaFile = bridge.inspectMediaFile
        const createMediaThumbnail = bridge.createMediaThumbnail
        const recoveryQueue = restoredMediaAssets.filter(
          (asset) =>
            Boolean(asset.sourcePath) &&
            (mediaAssetNeedsInspection(asset) ||
              !asset.thumbnail),
        )
        let recoveryCursor = 0
        const recoverNextAsset = async () => {
          while (!cancelled && recoveryCursor < recoveryQueue.length) {
            const queueIndex = recoveryCursor
            recoveryCursor += 1
            const asset = recoveryQueue[queueIndex]
            if (!asset.sourcePath) continue
            let recoveredAsset = asset
            let thumbnailRecovered = false
            let sourceChanged = false
            try {
              if (
                mediaAssetNeedsInspection(recoveredAsset) &&
                recoveredAsset.sourcePath
              ) {
                const metadata = await inspectMediaFile(
                  recoveredAsset.sourcePath,
                )
                recoveredAsset = applyMediaFileMetadata(
                  recoveredAsset,
                  metadata,
                )
              }
              if (cancelled) return
            } catch (error) {
              console.warn(
                `[Aurora library] Failed to resume metadata inspection for ${asset.filename}`,
                error,
              )
            }
            if (
              !recoveredAsset.thumbnail &&
              recoveredAsset.sourcePath
            ) {
              try {
                const result = await createMediaThumbnail({
                  assetId: recoveredAsset.id,
                  sourcePath: recoveredAsset.sourcePath,
                  durationSeconds: recoveredAsset.durationSeconds,
                })
                sourceChanged = !mediaAssetMatchesSourceState(
                  recoveredAsset,
                  result.sizeBytes,
                  result.modifiedAt,
                )
                if (sourceChanged) {
                  try {
                    const metadata = await inspectMediaFile(
                      result.sourcePath,
                    )
                    recoveredAsset = {
                      ...applyMediaFileMetadata(
                        recoveredAsset,
                        metadata,
                      ),
                      sampleCount: 0,
                      indexTask: 'idle',
                      indexError: null,
                    }
                  } catch (error) {
                    console.warn(
                      `[Aurora library] Failed to refresh changed media metadata for ${asset.filename}`,
                      error,
                    )
                  }
                }
                recoveredAsset = {
                  ...recoveredAsset,
                  thumbnail: result.thumbnailPath,
                }
                thumbnailRecovered = true
              } catch (error) {
                console.warn(
                  `[Aurora library] Failed to resume thumbnail generation for ${asset.filename}`,
                  error,
                )
              }
            }
            if (cancelled) return
            setMediaAssets((current) =>
              current.map((entry) =>
                entry.id === recoveredAsset.id ? recoveredAsset : entry,
              ),
            )
            if (thumbnailRecovered) {
              setProjectAssetRefs((current) =>
                current.map((reference) =>
                  reference.assetId === recoveredAsset.id
                    ? {
                        ...reference,
                        thumbnailFollowsProject: false,
                      }
                    : reference,
                ),
              )
            }
            if (sourceChanged) {
              setVisualIndexes((current) =>
                current.filter(
                  (index) => index.assetId !== recoveredAsset.id,
                ),
              )
              setFrameAnnotations((current) =>
                current.filter(
                  (annotation) =>
                    annotation.assetId !== recoveredAsset.id,
                ),
              )
              setFrameExclusions((current) =>
                current.filter(
                  (exclusion) => exclusion.assetId !== recoveredAsset.id,
                ),
              )
            }
          }
        }
        const recoveryWorkers =
          recoveryQueue.length > 0
            ? Array.from(
                { length: Math.min(2, recoveryQueue.length) },
                () => recoverNextAsset(),
              )
            : []
        void Promise.all(recoveryWorkers).finally(() => {
          if (!cancelled) setLibraryPersistenceReady(true)
        })
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('[Aurora library] Failed to load persisted data', error)
        setOnlineProviderSettingsReady(true)
        /*
         * Keep persistence writes disabled so malformed or unreadable user
         * data can never be overwritten by the in-memory fallback library.
         * The startup gate treats this as a settled, degraded read and still
         * allows the user to enter.
         */
        setLibraryPersistenceFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const bridge = window.desktopBridge
    if (!bridge || !libraryPersistenceReady) return
    const projectTitles = Object.fromEntries(
      projects.map((project) => [
        project.id,
        projectCustomizations[project.id]?.title ?? project.title,
      ]),
    )
    const projectCovers = Object.fromEntries(
      projects.flatMap((project) => {
        const cover = projectCustomizations[project.id]?.cover
        return cover?.managedPath
          ? [[project.id, { name: cover.name, managedPath: cover.managedPath }]]
          : []
      }),
    )
    const library = serializePersistentLibrary({
      projects,
      mediaAssets,
      projectAssetRefs,
      visualIndexes,
      frameAnnotations,
      frameExclusions,
      modelAssets,
      projectTitles,
      projectCovers,
      selectedProjectId,
    })
    latestLibraryPersistenceRef.current = library

    const saveTimer = window.setTimeout(() => {
      void bridge.saveAppData({ library }).then(() => {
        const latestLibrary = latestLibraryPersistenceRef.current
        const referencedCovers = new Set(
          Object.values(latestLibrary?.projectCovers ?? {}).map(
            (cover) => cover.managedPath,
          ),
        )
        pendingLibraryVisualCleanupRef.current.forEach((managedPath) => {
          if (referencedCovers.has(managedPath)) return
          void bridge.removeVisualAsset(managedPath).then(() => {
            pendingLibraryVisualCleanupRef.current.delete(managedPath)
          }).catch((error) => {
            console.warn(
              '[Aurora library] Failed to remove replaced project cover',
              error,
            )
          })
        })
      }).catch((error) => {
        console.warn('[Aurora library] Failed to save persisted data', error)
      })
    }, 280)

    return () => window.clearTimeout(saveTimer)
  }, [
    libraryPersistenceReady,
    mediaAssets,
    modelAssets,
    frameAnnotations,
    frameExclusions,
    projectAssetRefs,
    projectCustomizations,
    projects,
    selectedProjectId,
    visualIndexes,
  ])

  useEffect(() => {
    const bridge = window.desktopBridge
    if (!bridge || !appearancePersistenceReady) return
    const appearance = serializeAppearanceSettings(pageSettings)
    latestAppearancePersistenceRef.current = appearance
    const saveTimer = window.setTimeout(() => {
      void bridge.saveAppData({ appearance }).then(() => {
        const latestAppearance = latestAppearancePersistenceRef.current
        const referencedBackgrounds = new Set(
          APPEARANCE_PAGE_IDS.flatMap((view) => {
            const managedPath = latestAppearance?.pages[view].background?.managedPath
            return managedPath ? [managedPath] : []
          }),
        )
        const referencedParticles = new Set(
          APPEARANCE_PAGE_IDS.flatMap((view) => {
            const managedPath =
              latestAppearance?.pages[view].particles.customMedia?.managedPath
            return managedPath ? [managedPath] : []
          }),
        )
        pendingAppearanceVisualCleanupRef.current.forEach((managedPath) => {
          if (referencedBackgrounds.has(managedPath)) return
          void bridge.removeVisualAsset(managedPath).then(() => {
            pendingAppearanceVisualCleanupRef.current.delete(managedPath)
          }).catch((error) => {
            console.warn(
              '[Aurora appearance] Failed to remove replaced page background',
              error,
            )
          })
        })
        pendingAppearanceParticleCleanupRef.current.forEach((managedPath) => {
          if (referencedParticles.has(managedPath)) return
          void bridge.removeParticleAsset(managedPath).then(() => {
            pendingAppearanceParticleCleanupRef.current.delete(managedPath)
          }).catch((error) => {
            console.warn(
              '[Aurora particles] Failed to remove replaced particle asset',
              error,
            )
          })
        })
      }).catch((error) => {
        console.warn('[Aurora appearance] Failed to save page settings', error)
      })
    }, 280)

    return () => window.clearTimeout(saveTimer)
  }, [appearancePersistenceReady, pageSettings])

  useEffect(() => {
    const bridge = window.desktopBridge
    if (!bridge || !onlineProviderSettingsReady) return
    const onlineProviders = serializeOnlineProviderSettings(
      onlineProviderEnabled,
    )
    latestOnlineProviderSettingsRef.current = onlineProviders
    const saveTimer = window.setTimeout(() => {
      void bridge.saveAppData({ onlineProviders }).catch((error) => {
        console.warn(
          '[Aurora online providers] Failed to save enabled sources',
          error,
        )
      })
    }, 280)
    return () => window.clearTimeout(saveTimer)
  }, [onlineProviderEnabled, onlineProviderSettingsReady])

  useEffect(() => {
    setOnlineSearchAssetsByProvider((current) => {
      let changed = false
      const next = { ...current }
      ONLINE_MEDIA_PROVIDER_IDS.forEach((provider) => {
        if (onlineProviderEnabled[provider] || current[provider].length === 0) {
          return
        }
        const requestState = onlineSearchRequestStateRef.current[provider]
        requestState.sequence += 1
        requestState.query = ''
        next[provider] = []
        changed = true
      })
      return changed ? next : current
    })
  }, [onlineProviderEnabled])

  useEffect(() => {
    const bridge = window.desktopBridge
    if (!bridge?.saveAppDataSync) return
    window.addEventListener('beforeunload', saveLatestStateSync)
    return () => window.removeEventListener('beforeunload', saveLatestStateSync)
  }, [saveLatestStateSync])

  useEffect(() => {
    const bridge = window.desktopBridge
    if (!bridge?.onMediaProgress) return

    return bridge.onMediaProgress((progress) => {
      if (!progress.assetId) return
      const nextProgress = Math.min(1, Math.max(0, progress.progress))
      if (progress.kind === 'visual-index') {
        setIndexProgressByAsset((current) => ({
          ...current,
          [progress.assetId!]: nextProgress,
        }))
      } else if (progress.kind === 'preview-proxy') {
        setPreviewProgressByAsset((current) => ({
          ...current,
          [progress.assetId!]: nextProgress,
        }))
      }
    })
  }, [])

  const ensureLightweightPreview = useCallback(async (
    clip: VideoClip,
    rebuild = false,
  ) => {
    const bridge = window.desktopBridge
    if (clip.online || !clip.sourcePath || !bridge?.ensureMediaPreview) {
      return false
    }

    const currentPreview = lightweightPreviewByAsset[clip.assetId]
    if (
      !rebuild &&
      currentPreview?.sourcePath === clip.sourcePath
    ) {
      if (currentPreview.status === 'ready') return true
      if (currentPreview.status === 'failed') return false
    }

    const requestKey = `${clip.assetId}\u0000${clip.sourcePath}`
    const runningRequest = lightweightPreviewRequestsRef.current.get(requestKey)
    if (runningRequest) return runningRequest

    const operationId = bridge.createMediaOperationId()
    setLightweightPreviewByAsset((current) => ({
      ...current,
      [clip.assetId]: {
        status: 'preparing',
        sourcePath: clip.sourcePath!,
        playbackPath:
          current[clip.assetId]?.sourcePath === clip.sourcePath
            ? current[clip.assetId].playbackPath
            : null,
        error: null,
      },
    }))

    const request = (async () => {
      try {
        const result = await bridge.ensureMediaPreview({
          assetId: clip.assetId,
          sourcePath: clip.sourcePath!,
          profile: 'lightweight',
          forceProxy: true,
          rebuild,
          operationId,
        })
        if (!result.usesPreviewProxy || !result.playbackPath) {
          throw new Error('未生成轻量视频预览')
        }
        const resolvedSourcePath = result.metadata?.filePath ?? clip.sourcePath!
        if (result.metadata) {
          setMediaAssets((current) =>
            current.map((asset) =>
              asset.id === clip.assetId
                ? applyMediaFileMetadata(asset, result.metadata)
                : asset,
            ),
          )
        }
        setLightweightPreviewByAsset((current) => ({
          ...current,
          [clip.assetId]: {
            status: 'ready',
            sourcePath: resolvedSourcePath,
            playbackPath: result.playbackPath,
            error: null,
          },
        }))
        return true
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '轻量视频预览准备失败'
        setLightweightPreviewByAsset((current) => ({
          ...current,
          [clip.assetId]: {
            status: 'failed',
            sourcePath: clip.sourcePath!,
            playbackPath: null,
            error: message,
          },
        }))
        return false
      } finally {
        lightweightPreviewRequestsRef.current.delete(requestKey)
      }
    })()

    lightweightPreviewRequestsRef.current.set(requestKey, request)
    return request
  }, [lightweightPreviewByAsset])

  useEffect(() => {
    const bridge = window.desktopBridge
    if (
      !bridge?.onExternalVideoFiles ||
      !bridge.notifyExternalVideoFilesReady
    ) {
      return
    }
    const unsubscribe = bridge.onExternalVideoFiles((descriptors) => {
      const validDescriptors = Array.isArray(descriptors)
        ? descriptors.filter(
            (descriptor): descriptor is ExternalVideoFileDescriptor =>
              Boolean(
                descriptor &&
                  typeof descriptor.path === 'string' &&
                  descriptor.path.length > 0 &&
                  typeof descriptor.name === 'string' &&
                  descriptor.name.length > 0 &&
                  Number.isSafeInteger(descriptor.sizeBytes) &&
                  typeof descriptor.modifiedAt === 'string',
              ),
          )
        : []
      if (validDescriptors.length === 0) return
      setExternalVideoQueue((current) => {
        const queuedPaths = new Set(current.map((entry) => entry.path))
        const additions = validDescriptors.filter((entry) => {
          if (queuedPaths.has(entry.path)) return false
          queuedPaths.add(entry.path)
          return true
        })
        return additions.length > 0 ? [...current, ...additions] : current
      })
    })
    bridge.notifyExternalVideoFilesReady()
    return unsubscribe
  }, [])

  useEffect(() => {
    if (
      !libraryPersistenceReady ||
      startupGateActive ||
      externalVideoPreparing ||
      externalVideoNavigationClipId !== null ||
      pageTransitionPhase !== 'idle' ||
      clipAddDialogId !== null ||
      projectImportProgress?.complete === false
    ) {
      return
    }
    const descriptor = externalVideoQueue[0]
    if (!descriptor) return

    setExternalVideoPreparing(true)
    if (clipActionNoticeTimerRef.current !== undefined) {
      window.clearTimeout(clipActionNoticeTimerRef.current)
      clipActionNoticeTimerRef.current = undefined
    }
    setClipActionNotice({ message: `正在打开“${descriptor.name}”…` })
    void prepareExternalVideoAddCandidateRef.current(descriptor)
      .then((candidate) => {
        if (!appMountedRef.current) return
        if (clipActionNoticeTimerRef.current !== undefined) {
          window.clearTimeout(clipActionNoticeTimerRef.current)
          clipActionNoticeTimerRef.current = undefined
        }
        setClipActionNotice(null)
        setExternalVideoQueue((current) =>
          current[0]?.path === descriptor.path
            ? current.slice(1)
            : current.filter((entry) => entry.path !== descriptor.path),
        )
        const membershipIds = new Set(
          projectAssetRefsRef.current
            .filter((reference) => reference.assetId === candidate.asset.id)
            .map((reference) => reference.projectId),
        )
        const existingReference = projectAssetRefsRef.current.find(
          (reference) => reference.assetId === candidate.asset.id,
        )
        if (existingReference) {
          commitExternalVideoAsset(candidate)
          setClipAddDialogId(null)
          setExternalVideoAddCandidate(null)
          setSelectedClipId(existingReference.id)
          setExternalVideoNavigationClipId(existingReference.id)
          return
        }
        const firstTarget = projectsRef.current.find(
          (project) =>
            (project.kind ?? 'video') === 'video' &&
            !membershipIds.has(project.id),
        )
        setClipAddDialogId(null)
        setExternalVideoAddCandidate(candidate)
        setClipAddMode(firstTarget ? 'existing' : 'new')
        setClipAddTargetProjectId(firstTarget?.id ?? '')
        setClipAddNewProjectName(
          `${candidate.clip.filename.replace(/\.[^.]+$/, '')} 项目`,
        )
        setClipAddNewProjectEnglishName('')
        setSelectedClipId(candidate.clip.id)
        setExternalVideoNavigationClipId(candidate.clip.id)
      })
      .catch((error) => {
        if (!appMountedRef.current) return
        setExternalVideoQueue((current) =>
          current[0]?.path === descriptor.path
            ? current.slice(1)
            : current.filter((entry) => entry.path !== descriptor.path),
        )
        console.warn('[Aurora library] External video could not be prepared', error)
        showClipActionNotice(
          `无法打开“${descriptor.name}”，请确认文件仍存在且为受支持的视频。`,
        )
      })
      .finally(() => {
        if (appMountedRef.current) setExternalVideoPreparing(false)
      })
  }, [
    clipAddDialogId,
    externalVideoNavigationClipId,
    externalVideoPreparing,
    externalVideoQueue,
    libraryPersistenceReady,
    projectImportProgress?.complete,
    pageTransitionPhase,
    startupGateActive,
  ])

  const dragState = useRef({
    active: false,
    dragging: false,
    pointerId: -1,
    projectIndex: -1,
    cardActive: false,
    cardOffset: 0,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
  })
  const clipDragState = useRef({
    active: false,
    dragging: false,
    pointerId: -1,
    clipId: '',
    startPosition: 0,
    columnTravel: 1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
  })
  const suppressNextClick = useRef(false)
  const suppressNextClipClick = useRef(false)
  const releaseTimer = useRef<number | undefined>(undefined)
  const pageTransitionExitTimer = useRef<number | undefined>(undefined)
  const pageTransitionEnterTimer = useRef<number | undefined>(undefined)
  const pageTransitionActiveRef = useRef(false)
  const dragRaf = useRef<number | undefined>(undefined)
  const pendingDragOffset = useRef(0)
  const projectStageRef = useRef<HTMLElement>(null)
  const projectHitLayerRef = useRef<HTMLDivElement>(null)
  const galleryGlassLayerRef = useRef<HTMLDivElement>(null)
  const galleryGeometryCacheSignatureRef = useRef('')
  const galleryGeometrySyncCountRef = useRef(0)
  const clipReleaseRaf = useRef<number | undefined>(undefined)
  const clipDragRaf = useRef<number | undefined>(undefined)
  const pendingClipTrackPosition = useRef(0)
  const pendingClipOverscroll = useRef(0)
  const clipGridRef = useRef<HTMLDivElement>(null)
  const clipHitLayerRef = useRef<HTMLDivElement>(null)
  const clipHoverScrubSessionRef = useRef<ClipHoverScrubSession | null>(null)
  const pendingClipHoverScrubRef = useRef<PendingClipHoverScrub | null>(null)
  const clipHoverScrubRafRef = useRef<number | undefined>(undefined)
  const clipHoverScrubVideoRef = useRef<HTMLVideoElement>(null)
  const loadedClipHoverFramesRef = useRef(new Set<string>())
  const clipHoverPreviewPrepareRef = useRef<{
    clipId: string
    timer: number
  } | null>(null)
  const clipGlassLayerRef = useRef<HTMLDivElement>(null)
  const modelGlassLayerRef = useRef<HTMLDivElement>(null)
  const videoLibraryToolbarRef = useRef<HTMLDivElement>(null)
  const videoGlassCacheSignatureRef = useRef('')
  const videoGeometrySyncSignatureRef = useRef('')
  const videoGeometrySyncCountRef = useRef(0)
  const projectWheelDragRef = useRef({
    active: false,
    axis: null as WheelDragAxis | null,
    offset: 0,
    visualOffset: 0,
    previewStartOffset: 0,
    snapTargetProgress: 0,
    lastTime: 0,
    velocityX: 0,
  })
  const clipWheelDragRef = useRef({
    active: false,
    axis: null as WheelDragAxis | null,
    snapAnchor: 0,
    rawPosition: 0,
    visualPosition: 0,
    previewStartPosition: 0,
    snapTarget: 0,
    lastTime: 0,
    velocityX: 0,
  })
  const projectWheelReleaseTimer = useRef<number | undefined>(undefined)
  const projectWheelStepReleaseTimer = useRef<number | undefined>(undefined)
  const projectWheelStepGestureActiveRef = useRef(false)
  const clipWheelReleaseTimer = useRef<number | undefined>(undefined)
  const projectWheelPreviewRaf = useRef<number | undefined>(undefined)
  const clipWheelPreviewRaf = useRef<number | undefined>(undefined)
  const projectWheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {})
  const clipWheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {})

  const projectMediaCounts = useMemo(
    () => getProjectMediaCounts(projectAssetRefs, mediaAssets),
    [mediaAssets, projectAssetRefs],
  )
  const projectExportedMaterialCounts = useMemo(() => {
    return getProjectExportedMaterialCounts(projectAssetRefs)
  }, [projectAssetRefs])
  const projectModelCounts = useMemo(() => {
    const counts = new Map<string, number>()
    modelAssets.forEach((asset) => {
      counts.set(asset.projectId, (counts.get(asset.projectId) ?? 0) + 1)
    })
    return counts
  }, [modelAssets])
  const projectFirstThumbnails = useMemo(() => {
    const assetThumbnails = new Map(
      mediaAssets.map(
        (asset) => [asset.id, resolveLibraryMediaUrl(asset.thumbnail)] as const,
      ),
    )
    const thumbnails = new Map<string, string>()
    const orderedReferences = [...projectAssetRefs].sort(
      (left, right) => left.order - right.order,
    )
    orderedReferences.forEach((reference) => {
      if (thumbnails.has(reference.projectId)) return
      const thumbnail = assetThumbnails.get(reference.assetId)
      if (thumbnail) thumbnails.set(reference.projectId, thumbnail)
    })
    return thumbnails
  }, [mediaAssets, projectAssetRefs])
  const projectFirstModelThumbnails = useMemo(() => {
    const thumbnails = new Map<string, string>()
    modelAssets.forEach((asset) => {
      if (!thumbnails.has(asset.projectId) && asset.thumbnail) {
        thumbnails.set(asset.projectId, asset.thumbnail)
      }
    })
    return thumbnails
  }, [modelAssets])
  const displayProjects = useMemo(
    () =>
      projects.map((project) => {
        const customization = projectCustomizations[project.id]
        const kind = project.kind ?? 'video'
        const customCover = customization?.cover?.url
        const mediaCounts = projectMediaCounts.get(project.id) ?? {
          localVideoCount: 0,
          onlineVideoCount: 0,
          totalVideoCount: 0,
        }
        const baseCover =
          project.cover && project.cover !== LEGACY_EMPTY_PROJECT_COVER
            ? project.cover
            : undefined
        const cover =
          customCover ??
          baseCover ??
          (kind === '3d'
            ? projectFirstModelThumbnails.get(project.id)
            : projectFirstThumbnails.get(project.id)) ??
          EMPTY_PROJECT_COVER
        return {
          ...project,
          kind,
          title: customization?.title.trim() || project.title,
          description:
            project.description ?? getDefaultProjectDescription(kind),
          cover: resolveDocumentAssetUrl(cover),
          localVideoCount: mediaCounts.localVideoCount,
          onlineVideoCount: mediaCounts.onlineVideoCount,
          videoCount: mediaCounts.totalVideoCount,
          collectionCount:
            project.collectionCount +
            (projectExportedMaterialCounts.get(project.id) ?? 0),
          modelCount: projectModelCounts.get(project.id) ?? 0,
          usesEmptyGlass: !cover,
        }
      }),
    [
      projectCustomizations,
      projectExportedMaterialCounts,
      projectFirstThumbnails,
      projectFirstModelThumbnails,
      projectMediaCounts,
      projectModelCounts,
      projects,
    ],
  )
  const videoClips = useMemo(() => {
    const assetsById = new Map(mediaAssets.map((asset) => [asset.id, asset]))
    const excludedFrameIdsBySource = new Map<string, Set<string>>()
    frameExclusions.forEach((exclusion) => {
      const sourceKey = `${exclusion.assetId}\u0000${exclusion.sourceFingerprint}`
      const excludedFrameIds = excludedFrameIdsBySource.get(sourceKey) ?? new Set()
      excludedFrameIds.add(exclusion.frameId)
      excludedFrameIdsBySource.set(sourceKey, excludedFrameIds)
    })
    const indexesByAssetId = new Map(
      visualIndexes.map((index) => [index.assetId, index]),
    )
    const projectsById = new Map(
      displayProjects.map((project) => [project.id, project]),
    )

    return projectAssetRefs.flatMap((reference) => {
      const asset = assetsById.get(reference.assetId)
      const project = projectsById.get(reference.projectId)
      if (!asset || !project) return []
      const indexedCandidate = indexesByAssetId.get(asset.id)
      const visualIndex =
        indexedCandidate?.sourceFingerprint === asset.sourceFingerprint
          ? indexedCandidate
          : undefined
      const previewPlayback = previewPlaybackByAsset[asset.id]
      const previewPlaybackPath =
        previewPlayback?.status === 'ready' &&
        previewPlayback.sourcePath === asset.sourcePath
          ? previewPlayback.playbackPath
          : null
      const excludedFrameIds = excludedFrameIdsBySource.get(
        `${asset.id}\u0000${asset.sourceFingerprint}`,
      )
      const indexedFrames = (visualIndex?.frames ?? []).flatMap((frame) => {
        if (excludedFrameIds?.has(frame.id)) return []
        const thumbnail = resolveLibraryMediaUrl(frame.imagePath)
        return thumbnail
          ? [{
              id: frame.id,
              index: frame.index,
              thumbnail,
              timeSeconds: frame.timeSeconds,
              imagePath: frame.imagePath,
            }]
          : []
      })
      const posterWasExcluded = Boolean(
        visualIndex?.frames.some(
          (frame) =>
            frame.imagePath === visualIndex.posterPath &&
            excludedFrameIds?.has(frame.id),
        ),
      )
      const visiblePosterPath = posterWasExcluded
        ? indexedFrames[Math.floor(indexedFrames.length / 2)]?.imagePath ?? null
        : visualIndex?.posterPath ?? null
      const indexedPoster = resolveLibraryMediaUrl(visiblePosterPath)
      const effectiveSampleCount = asset.sourcePath
        ? indexedFrames.length
        : asset.sampleCount
      return [
        {
          id: reference.id,
          assetId: asset.id,
          projectId: reference.projectId,
          order: reference.order,
          filename: asset.filename,
          thumbnail:
            indexedPoster ||
            (reference.thumbnailFollowsProject || !asset.thumbnail
              ? project.cover
              /*
               * Persisted built-in thumbnails are portable (`./aurora/...`).
               * Resolve them before placing them in a CSS custom property;
               * otherwise packaged CSS treats them as `dist/assets/aurora/...`.
               */
              : resolveLibraryMediaUrl(asset.thumbnail)),
          duration: asset.duration,
          durationSeconds: asset.durationSeconds,
          resolution: asset.resolution,
          resolutionBadge: getStandardResolutionBadge(
            asset.width,
            asset.height,
            asset.resolution,
          ),
          width: asset.width,
          height: asset.height,
          fps: asset.fps,
          fpsValue: asset.fpsValue,
          frameCount: asset.frameCount,
          sampleCount: effectiveSampleCount,
          size:
            asset.sizeBytes !== null
              ? formatMediaFileSize(asset.sizeBytes)
              : asset.size,
          sizeBytes: asset.sizeBytes,
          codec: asset.codec,
          camera: asset.camera,
          capturedAt: asset.capturedAt,
          sourcePath: asset.sourcePath,
          sourceFingerprint: asset.sourceFingerprint,
          sourceUrl:
            resolveLibraryMediaUrl(visualIndex?.previewPath) ||
            resolveLibraryMediaUrl(previewPlaybackPath) ||
            (asset.sourcePath
              ? resolveLibraryMediaUrl(asset.sourcePath)
              : null),
          indexedFrames,
          favorite: asset.favorite,
          indexTask: asset.indexTask,
          tags: reference.tags,
          annotated: reference.annotated,
          note: reference.note,
          colorPreset: normalizeMediaColorPresetId(asset.colorPreset),
          online: asset.online,
        } satisfies VideoClip,
      ]
    })
  }, [
    displayProjects,
    frameExclusions,
    mediaAssets,
    previewPlaybackByAsset,
    projectAssetRefs,
    visualIndexes,
  ])
  const favoriteGalleryItems = useMemo<FavoriteGalleryItem[]>(() => {
    const items: FavoriteGalleryItem[] = []
    const clipsByAssetId = new Map<string, VideoClip>()
    videoClips.forEach((clip) => {
      if (!clipsByAssetId.has(clip.assetId)) clipsByAssetId.set(clip.assetId, clip)
    })

    const favoriteFrames = frameAnnotations
      .map((annotation, sourceIndex) => ({
        annotation,
        sourceIndex,
        rating: Number.isFinite(annotation.rating)
          ? Math.min(5, Math.max(0, Math.round(annotation.rating)))
          : 0,
      }))
      .filter(({ annotation }) => annotation.favorite)
      .sort(
        (first, second) =>
          second.rating - first.rating ||
          first.sourceIndex - second.sourceIndex,
      )

    favoriteFrames.forEach(({ annotation, rating }) => {
      const clip = clipsByAssetId.get(annotation.assetId)
      const frame = clip?.indexedFrames.find(
        (candidate) => candidate.id === annotation.frameId,
      )
      if (!clip || !frame) return
      const frameOrdinal = Math.max(
        1,
        clip.indexedFrames.findIndex((candidate) => candidate.id === frame.id) + 1,
      )
      const frameOrdinalDigits = String(
        Math.max(1, clip.indexedFrames.length),
      ).length
      const frameTimecode = formatFrameRingTimecode(
        frame.timeSeconds,
        clip.fpsValue ?? parseFrameRingFps(clip.fps),
      )
      const compactFrameTimecode = frameTimecode.startsWith('00:')
        ? frameTimecode.slice(3)
        : frameTimecode
      items.push({
        id: `favorite-frame:${clip.assetId}:${frame.id}`,
        kind: 'frame',
        title: clip.filename.replace(/\.[^.]+$/, ''),
        titleSuffix: `帧 ${compactFrameTimecode}`,
        label: '单帧',
        rating,
        meta: `索引帧 ${String(frameOrdinal).padStart(frameOrdinalDigits, '0')} / ${clip.indexedFrames.length} · ${clip.resolutionBadge ?? clip.resolution}`,
        tags: annotation.tags,
        cover: frame.thumbnail || clip.thumbnail,
        source: {
          type: 'frame',
          assetId: clip.assetId,
          frameId: frame.id,
        },
      })
    })

    clipsByAssetId.forEach((clip) => {
      if (!clip.favorite || clip.online) return
      const kind =
        clip.durationSeconds !== null && clip.durationSeconds <= 90
          ? 'clip'
          : 'video'
      items.push({
        id: `favorite-media:${clip.assetId}`,
        kind,
        title: clip.filename.replace(/\.[^.]+$/, ''),
        label: kind === 'clip' ? '视频片段' : '视频素材',
        meta: `${clip.duration} · ${clip.resolutionBadge ?? clip.resolution} · ${clip.codec}`,
        tags: clip.tags,
        cover: clip.thumbnail,
        source: { type: 'media', assetId: clip.assetId },
      })
    })

    modelAssets.forEach((model) => {
      if (!model.favorite) return
      const project = displayProjects.find(
        (candidate) => candidate.id === model.projectId,
      )
      const cover = resolveLibraryMediaUrl(model.thumbnail) || project?.cover
      if (!cover) return
      items.push({
        id: `favorite-model:${model.id}`,
        kind: 'model',
        title: model.filename.replace(/\.[^.]+$/, ''),
        label: '三维资产',
        meta: `${getModelAssetFormatLabel(model.format)} · ${formatMediaFileSize(model.sizeBytes)}`,
        tags: model.tags,
        cover,
        source: { type: 'model', assetId: model.id },
      })
    })

    mediaAssets.forEach((asset) => {
      if (!asset.favorite || !isOnlineMediaAsset(asset)) return
      const cover = resolveLibraryMediaUrl(asset.thumbnail)
      if (!cover) return
      items.push({
        id: `favorite-online:${asset.id}`,
        kind: 'online',
        title: asset.filename || asset.online.mediaId,
        label: asset.online.kind === 'episode' ? '影视剧集' : '在线视频',
        meta: asset.online.author || asset.online.publishedAt || '在线收藏',
        tags: clipsByAssetId.get(asset.id)?.tags ?? [],
        statusBadges: [
          '在线',
          getOnlineProviderLabel(asset.online.provider),
        ],
        cover,
        source: { type: 'media', assetId: asset.id },
      })
    })

    if (items.length > 0 || !import.meta.env.DEV || window.desktopBridge) {
      return items
    }

    const previewProjects = [
      displayProjects[2],
      displayProjects[1],
      displayProjects[3],
      displayProjects[0],
      displayProjects[4],
    ].filter(Boolean)
    const previewKinds: FavoriteGalleryItem['kind'][] = [
      'frame',
      'clip',
      'model',
      'video',
      'online',
    ]
    const previewLabels: Record<FavoriteGalleryItem['kind'], string> = {
      frame: '单帧',
      clip: '视频片段',
      video: '视频素材',
      model: '三维资产',
      online: '在线收藏',
    }
    const previewMeta: Record<FavoriteGalleryItem['kind'], string> = {
      frame: '00:31:08 · 8K · RAW',
      clip: '00:18 · 4K · HEVC',
      video: '03:24 · 4K · ProRes',
      model: 'GLB · 84.6 MB',
      online: 'Bilibili · 12:48 · 4K',
    }
    return previewProjects.flatMap((project, index) => {
      if (!project.cover) return []
      const kind = previewKinds[index] ?? 'frame'
      return [{
        id: `favorite-preview:${project.id}:${kind}`,
        kind,
        title:
          kind === 'frame'
            ? 'DJI_20250707163418_0026'
            : project.title,
        titleSuffix: kind === 'frame' ? '帧 00:12:08' : undefined,
        label: previewLabels[kind],
        rating: kind === 'frame' ? 5 : undefined,
        meta: kind === 'frame'
          ? '索引帧 03 / 41 · 4K'
          : previewMeta[kind],
        tags:
          kind === 'frame'
            ? [IMPORTED_CLIP_DEFAULT_TAG]
            : kind === 'online'
              ? ['国创', '中国大陆', '泡面']
              : [],
        statusBadges: kind === 'online' ? ['在线', 'B站'] : undefined,
        cover: project.cover,
        source: { type: 'preview', projectId: project.id } as const,
      }]
    })
  }, [displayProjects, frameAnnotations, mediaAssets, modelAssets, videoClips])
  const activeProject = displayProjects[activeIndex]
  const selectedProject =
    displayProjects.find((project) => project.id === selectedProjectId) ?? activeProject
  const menuProject =
    displayProjects.find((project) => project.id === projectMenu?.projectId) ??
    null
  const projectDeleteDialog =
    displayProjects.find(
      (project) => project.id === projectDeleteDialogId,
    ) ?? null
  const menuBaseProject =
    projects.find((project) => project.id === projectMenu?.projectId) ??
    null
  const menuProjectCoverName =
    projectMenu === null
      ? null
      : projectCustomizations[projectMenu.projectId]?.cover?.name ?? null
  const emptyProjectPrompt =
    displayProjects.find((project) => project.id === emptyProjectPromptId) ??
    null
  const selectedBaseProject =
    projects.find((project) => project.id === selectedProject.id) ?? projects[activeIndex]
  const selectedProjectCustomization =
    projectCustomizations[selectedProject.id] ?? {
      title: selectedBaseProject.title,
      cover: null,
    }
  const selectedProjectModels = useMemo(
    () => modelAssets.filter((asset) => asset.projectId === selectedProject.id),
    [modelAssets, selectedProject.id],
  )
  const selectedModel =
    selectedProjectModels.find((asset) => asset.id === selectedModelId) ??
    selectedProjectModels[0] ??
    null
  const selectedModelUrl = selectedModel
    ? selectedModel.sourcePath
      ? window.desktopBridge?.getMediaUrl(selectedModel.sourcePath) ?? null
      : modelObjectUrlsRef.current.get(selectedModel.id) ?? null
    : null
  /*
   * Keep one model-library DOM tree mounted even while another project type is
   * active. This mirrors the video page's process-local Keep-Alive contract:
   * selecting a 3D project during the 220ms gallery exit gives its cards and
   * projected glass time to prepare before the incoming page is revealed.
   */
  const modelLibraryProject =
    (selectedProject.kind ?? 'video') === '3d'
      ? selectedProject
      : displayProjects.find((project) => (project.kind ?? 'video') === '3d') ?? null
  const modelLibraryModels = useMemo(
    () => modelLibraryProject
      ? modelAssets.filter((asset) => asset.projectId === modelLibraryProject.id)
      : [],
    [modelAssets, modelLibraryProject],
  )
  const modelLibrarySelectedModel =
    modelLibraryModels.find((asset) => asset.id === selectedModelId) ??
    modelLibraryModels[0] ??
    null
  const modelReflectionSources = useMemo<ClipReflectionSource[]>(
    () => modelLibraryModels.map((model) => {
      const format = getModelAssetFormatLabel(model.format)
      return {
        id: model.id,
        filename: model.filename,
        thumbnail: resolveLibraryMediaUrl(model.thumbnail) ?? '',
        duration: format,
        resolution: model.dimensions
          ? `${model.dimensions.x.toFixed(2)} × ${model.dimensions.y.toFixed(2)} × ${model.dimensions.z.toFixed(2)}`
          : '待分析',
        fps: model.vertexCount === null
          ? '待分析顶点'
          : `${new Intl.NumberFormat('zh-CN').format(model.vertexCount)} 顶点`,
        frameCount: model.nodeCount === null
          ? '待分析节点'
          : `${new Intl.NumberFormat('zh-CN').format(model.nodeCount)} 节点`,
        sampleCount: model.triangleCount ?? 0,
        size: formatMediaFileSize(model.sizeBytes),
        codec: format,
        camera: `${model.materialCount ?? 0} 材质 · ${model.textureCount ?? 0} 贴图`,
        capturedAt: model.importedAt,
        tags: model.tags,
        annotated: Boolean(model.note.trim()),
        note: model.note,
        favorite: model.favorite,
      }
    }),
    [modelLibraryModels],
  )
  const modelReflectionClips = useMemo<ClipReflectionSource[]>(() => {
    const visibleIds =
      modelReflectionWindow.projectId === modelLibraryProject?.id
        ? modelReflectionWindow.modelIds
        : modelLibraryModels.map((model) => model.id)
    const sourcesById = new Map(
      modelReflectionSources.map((source) => [source.id, source]),
    )
    return visibleIds.flatMap((id) => {
      const source = sourcesById.get(id)
      return source ? [source] : []
    })
  }, [
    modelLibraryModels,
    modelLibraryProject?.id,
    modelReflectionSources,
    modelReflectionWindow,
  ])
  const modelReflectionDetail =
    modelReflectionSources.find(
      (model) => model.id === modelLibrarySelectedModel?.id,
    ) ?? null
  const handleVisibleModelIdsChange = useCallback((
    projectId: string,
    modelIds: readonly string[],
  ) => {
    setModelReflectionWindow((current) => {
      if (
        current.projectId === projectId &&
        current.modelIds.length === modelIds.length &&
        current.modelIds.every((id, index) => id === modelIds[index])
      ) {
        return current
      }
      return { projectId, modelIds: [...modelIds] }
    })
  }, [])
  const handleModelMetadata = useCallback(
    (assetId: string, metadata: PreparedModelAsset) => {
      setModelAssets((current) => {
        const next = current.map((asset) =>
          asset.id === assetId
            ? {
                ...asset,
                ...metadata,
                thumbnail: metadata.thumbnail ?? asset.thumbnail,
              }
            : asset,
        )
        modelAssetsRef.current = next
        return next
      })
    },
    [],
  )
  const handleModelCameraChange = useCallback(
    (assetId: string, camera: ModelCameraState) => {
      setModelAssets((current) => {
        const next = current.map((asset) =>
          asset.id === assetId ? { ...asset, camera } : asset,
        )
        modelAssetsRef.current = next
        return next
      })
    },
    [],
  )
  const handleModelEnvironmentPresetChange = useCallback(
    (assetId: string, environmentPresetId: ModelEnvironmentPresetId) => {
      setModelAssets((current) => {
        const next = current.map((asset) =>
          asset.id === assetId ? { ...asset, environmentPresetId } : asset,
        )
        modelAssetsRef.current = next
        return next
      })
    },
    [],
  )
  const handleModelTagsChange = useCallback(
    (assetId: string, tags: string[]) => {
      const normalizedTags = Array.from(
        new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
      ).slice(0, 6)
      setModelAssets((current) => {
        const next = current.map((asset) =>
          asset.id === assetId ? { ...asset, tags: normalizedTags } : asset,
        )
        modelAssetsRef.current = next
        return next
      })
    },
    [],
  )
  const handleModelNoteChange = useCallback(
    (assetId: string, note: string) => {
      const normalizedNote = note
        .trim()
        .slice(0, CLIP_DETAIL_NOTE_MAX_LENGTH)
      setModelAssets((current) => {
        const next = current.map((asset) =>
          asset.id === assetId ? { ...asset, note: normalizedNote } : asset,
        )
        modelAssetsRef.current = next
        return next
      })
    },
    [],
  )
  const toggleModelFavorite = useCallback((assetId: string) => {
    setModelAssets((current) => {
      const next = current.map((asset) =>
        asset.id === assetId
          ? { ...asset, favorite: !asset.favorite }
          : asset,
      )
      modelAssetsRef.current = next
      return next
    })
  }, [])
  const revealModelInFinder = useCallback(async (assetId: string) => {
    const model = modelAssetsRef.current.find((asset) => asset.id === assetId)
    if (!model) return
    if (!model.sourcePath || !window.desktopBridge?.revealProjectFile) {
      showClipActionNotice(
        '浏览器预览无法访问模型文件位置；请在桌面版中使用此功能。',
      )
      return
    }
    const revealed = await window.desktopBridge.revealProjectFile(
      model.sourcePath,
    )
    showClipActionNotice(
      revealed
        ? '已在 Finder 中显示模型文件。'
        : '模型文件当前不可用，请重新导入。',
    )
  }, [])
  const removeModelFromCurrentProject = useCallback((assetId: string) => {
    const currentModels = modelAssetsRef.current
    const removedModel = currentModels.find((asset) => asset.id === assetId)
    if (!removedModel) return

    const projectModels = currentModels.filter(
      (asset) => asset.projectId === removedModel.projectId,
    )
    const removedIndex = projectModels.findIndex((asset) => asset.id === assetId)
    const remainingModels = currentModels.filter((asset) => asset.id !== assetId)
    const remainingProjectModels = projectModels.filter(
      (asset) => asset.id !== assetId,
    )
    const nextModel = remainingProjectModels[
      Math.min(removedIndex, Math.max(0, remainingProjectModels.length - 1))
    ] ?? null

    modelAssetsRef.current = remainingModels
    setModelAssets(remainingModels)
    setProjects((current) =>
      current.map((project) =>
        project.id === removedModel.projectId
          ? { ...project, updatedAt: formatProjectTimestamp() }
          : project,
      ),
    )
    if (selectedModelId === assetId) setSelectedModelId(nextModel?.id ?? null)

    const objectUrl = modelObjectUrlsRef.current.get(assetId)
    modelObjectUrlsRef.current.delete(assetId)
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    if (
      removedModel.sourcePath &&
      !remainingModels.some(
        (asset) => asset.sourcePath === removedModel.sourcePath,
      )
    ) {
      void window.desktopBridge?.removeModelAsset?.(removedModel.sourcePath).catch(
        () => undefined,
      )
    }

    showClipActionNotice(
      `已从“${selectedProject.title}”移除模型；导入前的磁盘原文件不受影响。`,
    )
  }, [selectedModelId, selectedProject.title])
  const projectClips = useMemo(
    () => videoClips.filter((clip) => clip.projectId === selectedProject.id),
    [selectedProject.id, videoClips],
  )
  const selectedProjectStorage = useMemo(
    () => {
      const localAssetIds = new Set(
        mediaAssets
          .filter((asset) => !isOnlineMediaAsset(asset))
          .map((asset) => asset.id),
      )
      return summarizeProjectStorage(
        selectedProject.id,
        projectAssetRefs.filter((reference) =>
          localAssetIds.has(reference.assetId),
        ),
        mediaAssets,
      )
    },
    [mediaAssets, projectAssetRefs, selectedProject.id],
  )
  const selectedProjectStorageLabel = formatProjectStorageSummary(
    selectedProjectStorage,
  )
  const selectedProjectStorageTitle =
    selectedProjectStorage.unknownCount > 0
      ? selectedProjectStorage.knownBytes > 0
        ? `已统计 ${formatMediaFileSize(selectedProjectStorage.knownBytes)}，另有 ${selectedProjectStorage.unknownCount} 个素材等待分析`
        : `${selectedProjectStorage.unknownCount} 个素材等待分析`
      : `${selectedProjectStorage.assetCount} 个素材，共 ${selectedProjectStorageLabel}`
  const clipResolutionFilterOptions = useMemo<ClipFilterOption[]>(
    () => [
      { value: ALL_CLIP_FILTER_VALUE, label: '分辨率' },
      ...getClipResolutionOptions(projectClips).map((value) => ({
        value,
        label: formatClipResolutionKey(value).replaceAll(' ', ''),
      })),
    ],
    [projectClips],
  )
  const clipTagFilterOptions = useMemo<ClipFilterOption[]>(
    () => [
      { value: ALL_CLIP_FILTER_VALUE, label: '标签' },
      ...getClipTagOptions(projectClips).map((value) => ({
        value,
        label: value,
      })),
    ],
    [projectClips],
  )
  const clipFilterControls = useMemo(
    () =>
      [
        {
          id: 'status',
          label:
            CLIP_STATUS_FILTER_OPTIONS.find(
              (option) => option.value === clipFilters.status,
            )?.label ?? '全部视频',
          options: CLIP_STATUS_FILTER_OPTIONS,
        },
        {
          id: 'dateSort',
          label:
            CLIP_DATE_SORT_OPTIONS.find(
              (option) => option.value === clipFilters.dateSort,
            )?.label ?? '拍摄日期',
          options: CLIP_DATE_SORT_OPTIONS,
        },
        {
          id: 'resolution',
          label:
            clipResolutionFilterOptions.find(
              (option) => option.value === clipFilters.resolution,
            )?.label ?? '分辨率',
          options: clipResolutionFilterOptions,
        },
        {
          id: 'duration',
          label:
            CLIP_DURATION_FILTER_OPTIONS.find(
              (option) => option.value === clipFilters.duration,
            )?.label ?? '时长',
          options: CLIP_DURATION_FILTER_OPTIONS,
        },
        {
          id: 'tag',
          label:
            clipTagFilterOptions.find(
              (option) => option.value === clipFilters.tag,
            )?.label ?? '标签',
          options: clipTagFilterOptions,
        },
      ] satisfies Array<{
        id: ClipFilterMenuId
        label: string
        options: readonly ClipFilterOption[]
      }>,
    [clipFilters, clipResolutionFilterOptions, clipTagFilterOptions],
  )
  const clipFiltersActive = isClipFilterStateActive(clipFilters)
  const filteredProjectClips = useMemo(
    () => filterAndSortVideoClips(projectClips, clipFilters, query),
    [clipFilters, projectClips, query],
  )

  useEffect(() => {
    if (openClipFilterMenu === null) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        videoLibraryToolbarRef.current?.contains(target)
      ) {
        return
      }
      setOpenClipFilterMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenClipFilterMenu(null)
    }

    window.addEventListener('pointerdown', closeOnOutsidePointer, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [openClipFilterMenu])

  const selectedClip = projectClips.find((clip) => clip.id === selectedClipId)
  const onlineFrameRingReference = useMemo(
    () =>
      onlineFrameRingAsset
        ? projectAssetRefs.find(
            (reference) => reference.assetId === onlineFrameRingAsset.id,
          ) ?? null
        : null,
    [onlineFrameRingAsset, projectAssetRefs],
  )
  const onlineFrameRingProject = useMemo<Project | null>(() => {
    if (!onlineFrameRingAsset) return null
    const referencedProject = onlineFrameRingReference
      ? displayProjects.find(
          (project) => project.id === onlineFrameRingReference.projectId,
        )
      : null
    if (referencedProject) return referencedProject
    return {
      id: `${onlineFrameRingAsset.online.provider}-online-preview`,
      kind: 'video',
      title: getOnlineProviderLabel(onlineFrameRingAsset.online.provider),
      subtitle: '',
      description: '在线内容不下载、不生成帧环。',
      cover:
        resolveLibraryMediaUrl(onlineFrameRingAsset.thumbnail) ||
        resolveDocumentAssetUrl('./aurora/project-new-frontier.png'),
      videoCount: 0,
      collectionCount: 0,
      updatedAt: onlineFrameRingAsset.capturedAt,
    }
  }, [displayProjects, onlineFrameRingAsset, onlineFrameRingReference])
  const onlineFrameRingClip = useMemo<OnlineVideoAddCandidate['clip'] | null>(() => {
    if (!onlineFrameRingAsset) return null
    return createOnlineVideoClip(
      onlineFrameRingAsset,
      onlineFrameRingReference ?? undefined,
      onlineFrameRingProject?.cover,
    )
  }, [onlineFrameRingAsset, onlineFrameRingProject, onlineFrameRingReference])
  const externalFrameRingClip = useMemo<VideoClip | null>(() => {
    if (externalVideoAddCandidate?.clip.id !== selectedClipId) return null
    const previewState =
      previewPlaybackByAsset[externalVideoAddCandidate.asset.id]
    const previewPath =
      previewState?.status === 'ready' &&
      previewState.sourcePath === externalVideoAddCandidate.clip.sourcePath
        ? previewState.playbackPath
        : null
    return previewPath
      ? {
          ...externalVideoAddCandidate.clip,
          sourceUrl:
            resolveLibraryMediaUrl(previewPath) ??
            externalVideoAddCandidate.clip.sourceUrl,
        }
      : externalVideoAddCandidate.clip
  }, [
    externalVideoAddCandidate,
    previewPlaybackByAsset,
    selectedClipId,
  ])
  const startupFrameRingClip = useMemo(
    () =>
      [selectedClip, ...projectClips, ...videoClips].find(
        (clip, index, candidates) =>
          Boolean(
            clip?.sourcePath &&
              clip.indexedFrames.length > 0 &&
              candidates.findIndex((candidate) => candidate?.id === clip.id) ===
                index,
          ),
      ) ?? null,
    [projectClips, selectedClip, videoClips],
  )
  const frameRingClipCandidate =
    onlineFrameRingClip ?? externalFrameRingClip ?? (startupGateActive
      ? startupFrameRingClip ?? selectedClip ?? null
      : selectedClip ?? startupFrameRingClip)
  const frameRingClip = frameRingClipCandidate
  const externalFrameRingProject = useMemo<Project | null>(
    () =>
      externalVideoAddCandidate
        ? {
            id: 'external-video-preview',
            kind: 'video',
            title: '未加入 Aurora',
            subtitle: '',
            description: '临时预览来自系统打开的视频。',
            cover: externalVideoAddCandidate.clip.thumbnail,
            videoCount: 0,
            collectionCount: 0,
            updatedAt: externalVideoAddCandidate.clip.capturedAt,
          }
        : null,
    [externalVideoAddCandidate],
  )
  const frameRingProject = onlineFrameRingClip && onlineFrameRingProject
    ? onlineFrameRingProject
    : externalFrameRingClip && externalFrameRingProject
    ? externalFrameRingProject
    : frameRingClip
    ? displayProjects.find((project) => project.id === frameRingClip.projectId) ??
      selectedProject
    : selectedProject
  const frameRingHasIndex = Boolean(
    frameRingClip &&
      ((frameRingClip.indexedFrames?.length ?? 0) > 0 ||
        frameRingClip.sampleCount > 0),
  )
  const storedFrameRingPreviewState = frameRingClip
    ? previewPlaybackByAsset[frameRingClip.assetId]
    : undefined
  const frameRingPreviewState =
    frameRingClip &&
    storedFrameRingPreviewState?.sourcePath === frameRingClip.sourcePath
      ? storedFrameRingPreviewState
      : undefined
  const frameRingRelatedClips = useMemo(
    () =>
      frameRingClip && !externalFrameRingClip && !onlineFrameRingClip
        ? videoClips.filter((clip) => clip.projectId === frameRingClip.projectId)
        : [],
    [externalFrameRingClip, frameRingClip, onlineFrameRingClip, videoClips],
  )
  useEffect(() => {
    if (
      currentView !== 'frame-ring' &&
      pageTransitionPhase === 'idle' &&
      onlineFrameRingAsset
    ) {
      setOnlineFrameRingAsset(null)
    }
  }, [currentView, onlineFrameRingAsset, pageTransitionPhase])
  const detailClip =
    filteredProjectClips.find((clip) => clip.id === selectedClipId) ??
    filteredProjectClips[0] ??
    null
  const startupLibraryState: StartupLibraryState = libraryPersistenceReady
    ? 'ready'
    : libraryPersistenceFailed
      ? 'failed'
      : 'loading'
  const startupGalleryProjects = useMemo(() => {
    if (displayProjects.length === 0) return []
    const seenProjectIds = new Set<string>()
    return getCarouselOffsets(displayProjects.length, true).flatMap(
      (offset) => {
        const project =
          displayProjects[
            wrapProjectIndex(activeIndex + offset, displayProjects.length)
          ]
        if (!project || seenProjectIds.has(project.id)) return []
        seenProjectIds.add(project.id)
        return [project]
      },
    )
  }, [activeIndex, displayProjects])
  const detailColorPreset = getMediaColorPreset(detailClip?.colorPreset)
  const storedDetailLightweightPreview = detailClip
    ? lightweightPreviewByAsset[detailClip.assetId]
    : undefined
  const detailLightweightPreview =
    detailClip &&
    storedDetailLightweightPreview?.sourcePath === detailClip.sourcePath
      ? storedDetailLightweightPreview
      : undefined
  const detailPreviewSourceUrl =
    detailClip && detailLightweightPreview?.status === 'ready'
      ? resolveLibraryMediaUrl(detailLightweightPreview.playbackPath)
      : null
  const detailPreviewPlaybackKey = detailClip
    ? `${detailClip.id}\u0000${detailPreviewSourceUrl ?? ''}`
    : null
  const detailIndexProgress = detailClip
    ? indexProgressByAsset[detailClip.assetId]
    : undefined

  useEffect(() => {
    if (
      currentView !== 'video-library' ||
      !detailClip ||
      detailClip.online ||
      !detailClip.sourcePath ||
      detailLightweightPreview?.status === 'preparing' ||
      detailLightweightPreview?.status === 'ready' ||
      detailLightweightPreview?.status === 'failed'
    ) {
      return
    }
    void ensureLightweightPreview(detailClip)
  }, [
    currentView,
    detailClip,
    detailLightweightPreview?.status,
    ensureLightweightPreview,
  ])

  useEffect(() => {
    const video = detailPreviewVideoRef.current
    return () => {
      video?.pause()
    }
  }, [currentView, detailClip?.id, detailPreviewSourceUrl])
  useEffect(
    () => () => {
      if (detailColorPresetClickTimerRef.current !== undefined) {
        window.clearTimeout(detailColorPresetClickTimerRef.current)
        detailColorPresetClickTimerRef.current = undefined
      }
    },
    [detailClip?.id],
  )
  const frameRingAnnotations = useMemo<Record<string, FrameRingAnnotation>>(
    () =>
      Object.fromEntries(
        frameAnnotations
          .filter(
            (annotation) =>
              annotation.assetId === frameRingClip?.assetId,
          )
          .map((annotation) => [
            annotation.frameId,
            {
              favorite: annotation.favorite,
              rating: annotation.rating,
              tags: annotation.tags,
              note: annotation.note,
              tagsSource: annotation.tagsSource,
              noteSource: annotation.noteSource,
            },
          ]),
      ),
    [frameAnnotations, frameRingClip?.assetId],
  )
  const clipMenu = videoClips.find((clip) => clip.id === clipMenuId) ?? null
  const clipAddDialog = clipAddDialogId
    ? externalVideoAddCandidate?.clip.id === clipAddDialogId
      ? externalVideoAddCandidate.clip
      : onlineVideoAddCandidate?.clip.id === clipAddDialogId
        ? onlineVideoAddCandidate.clip
      : videoClips.find((clip) => clip.id === clipAddDialogId) ?? null
    : null
  const clipRemoveDialog =
    videoClips.find((clip) => clip.id === clipRemoveDialogId) ?? null
  const clipTagEditor =
    videoClips.find((clip) => clip.id === clipTagEditorId) ?? null
  const clipNoteEditor =
    videoClips.find((clip) => clip.id === clipNoteEditorId) ?? null
  const clipAiMetadataDialogClip =
    videoClips.find((clip) => clip.id === clipAiMetadataDialog?.clipId) ?? null
  const clipMembershipProjectIds = useMemo(
    () =>
      new Set(
        clipAddDialog
          ? projectAssetRefs
              .filter(
                (reference) => reference.assetId === clipAddDialog.assetId,
              )
              .map((reference) => reference.projectId)
          : [],
      ),
    [clipAddDialog, projectAssetRefs],
  )
  const availableClipTargetProjects = useMemo(
    () =>
      displayProjects.filter(
        (project) =>
          project.kind === 'video' &&
          !clipMembershipProjectIds.has(project.id),
      ),
    [clipMembershipProjectIds, displayProjects],
  )
  const clipTrackColumns = useMemo(
    () => createClipTrackColumns(filteredProjectClips),
    [filteredProjectClips],
  )
  const clipTrackMaxPosition = Math.max(
    0,
    clipTrackColumns.length - CLIP_TRACK_VISIBLE_COLUMNS,
  )
  const clipTrackWindowStart = Math.max(
    0,
    Math.min(clipTrackMaxPosition, Math.round(clipTrackPosition)),
  )
  const clipRenderRows = useMemo(() => {
    const visibleColumns = clipTrackColumns.slice(
      clipTrackWindowStart,
      clipTrackWindowStart + CLIP_TRACK_VISIBLE_COLUMNS,
    )

    return ([0, 1] as const).map((rowIndex) =>
      visibleColumns.flatMap((column, slot) => {
        const clip = rowIndex === 0 ? column.top : column.bottom
        if (!clip) return []
        const logicalColumn = clipTrackWindowStart + slot
        return [{ clip, rowIndex, slot, logicalColumn }]
      }),
    )
  }, [clipTrackColumns, clipTrackWindowStart])
  const visibleProjectClips = useMemo(
    () => clipRenderRows.flatMap((row) => row.map((item) => item.clip)),
    [clipRenderRows],
  )
  const videoReflectionPreloadClips = useMemo(() => {
    const visibleIds = new Set(
      visibleProjectClips.map((clip) => clip.id),
    )
    const guardColumns = [
      clipTrackColumns[clipTrackWindowStart - 1],
      clipTrackColumns[
        clipTrackWindowStart + CLIP_TRACK_VISIBLE_COLUMNS
      ],
    ]
    return guardColumns.flatMap((column) => {
      if (!column) return []
      return [column.top, column.bottom].flatMap((clip) => {
        if (!clip || visibleIds.has(clip.id)) return []
        visibleIds.add(clip.id)
        return [clip]
      })
    })
  }, [
    clipTrackColumns,
    clipTrackWindowStart,
    visibleProjectClips,
  ])
  const startupFrameRingWarmFrames = useMemo(() => {
    if (!startupFrameRingClip) return []
    const relatedThumbnails = videoClips
      .filter(
        (clip) =>
          clip.projectId === startupFrameRingClip.projectId &&
          clip.id !== startupFrameRingClip.id,
      )
      .map((clip) => clip.thumbnail)
    const frames = createFrameRingFrames(
      startupFrameRingClip,
      relatedThumbnails,
    )
    const initialIndex = getDefaultFrameIndex(frames.length)
    const visibleRange = getVisibleFrameRange(
      initialIndex,
      frames.length,
    )
    const visibleFrames = frames.slice(
      visibleRange.start,
      visibleRange.end,
    )
    const guardFrames = getFrameRingReflectionPreloadFrames(
      frames,
      visibleRange,
      0,
    )
    const frameIds = new Set<string>()
    return [...visibleFrames, ...guardFrames].filter((frame) => {
      if (frameIds.has(frame.id)) return false
      frameIds.add(frame.id)
      return true
    })
  }, [startupFrameRingClip, videoClips])
  const startupModelThumbnailUrls = useMemo(
    () =>
      modelAssets
        .flatMap((asset) => {
          const thumbnail = resolveLibraryMediaUrl(asset.thumbnail)
          return thumbnail ? [thumbnail] : []
        })
        .slice(0, STARTUP_MODEL_THUMBNAIL_PRELOAD_LIMIT),
    [modelAssets],
  )
  const startupMediaUrls = useMemo(
    () => [
      ...startupGalleryProjects.map((project) => project.cover),
      ...startupModelThumbnailUrls,
      ...visibleProjectClips.map((clip) => clip.thumbnail),
      ...videoReflectionPreloadClips.map(
        (clip) => clip.thumbnail,
      ),
      ...startupFrameRingWarmFrames.map(
        (frame) => frame.thumbnail,
      ),
    ],
    [
      startupFrameRingWarmFrames,
      startupGalleryProjects,
      startupModelThumbnailUrls,
      videoReflectionPreloadClips,
      visibleProjectClips,
    ],
  )
  const viewport = { width: viewportWidth, height: viewportHeight }
  const responsiveMetrics = resolveResponsiveMetrics(viewport)
  const videoLibraryLayout = resolveVideoLibraryLayout(viewport)
  const frameRingLayout = resolveFrameRingLayout(viewport)
  const videoGlassGeometrySignature = [
    viewportWidth,
    viewportHeight,
    selectedProject.id,
    detailClip?.id ?? '',
    visibleProjectClips.map((clip) => clip.id).join(','),
    clipTrackPosition.toFixed(4),
    clipOverscroll.toFixed(4),
    hoveredClipId ?? '',
    cameraPose.yaw.toFixed(4),
    cameraPose.pitch.toFixed(4),
  ].join('|')
  const videoGeometrySyncSignature = [
    videoGlassGeometrySignature,
    openClipFilterMenu ?? '',
    isClipDragging,
    isClipReleasing,
    clipTrackWindowStart,
    videoLibraryLayout.cardContentScale.toFixed(4),
  ].join('|')
  const currentPageSettings = pageSettings[currentView]
  const galleryPageSettings = pageSettings.gallery
  const galleryParticleShape: ParticleShape =
    galleryPageSettings.particles.shape === 'custom' &&
    !galleryPageSettings.particles.customMedia
      ? 'dot'
      : galleryPageSettings.particles.shape
  const galleryParticleSize =
    galleryPageSettings.particles.size ?? PAGE_SETTINGS_RANGE_DEFAULTS.particleSize
  const galleryParticleVisualScale = getParticleVisualScale(
    galleryParticleShape,
  )
  const galleryParticleRenderItems = useMemo<AmbientParticleRenderItem[]>(() =>
    ambientParticlePool
      .slice(0, galleryPageSettings.particles.count)
      .map((particle) => {
        const startX =
          responsiveMetrics.planeLeft +
          (responsiveMetrics.planeWidth * particle.left) / 100
        const startY =
          responsiveMetrics.planeTop +
          (responsiveMetrics.planeHeight * particle.top) / 100
        const drift = (responsiveMetrics.planeWidth * particle.drift) / 100
        const endX = startX - drift
        const verticalEnd =
          particle.verticalEnd * responsiveMetrics.layoutScale
        const curveBend = particle.curveBend * responsiveMetrics.layoutScale
        const endY = startY + verticalEnd
        const controlOneX = startX - drift * 0.28
        const controlTwoX = startX - drift * 0.68
        const controlOneY = startY + verticalEnd * 0.28 + curveBend
        const controlTwoY = startY + verticalEnd * 0.68 + curveBend
        const motionPath = `path("M ${startX.toFixed(2)} ${startY.toFixed(2)} C ${controlOneX.toFixed(2)} ${controlOneY.toFixed(2)} ${controlTwoX.toFixed(2)} ${controlTwoY.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}")`
        const particleSize =
          particle.size *
          responsiveMetrics.layoutScale *
          galleryParticleSize
        const duration = particle.duration / galleryPageSettings.particles.speed
        const delay = particle.delay / galleryPageSettings.particles.speed
        const rotationMagnitude = Math.abs(
          galleryPageSettings.particles.rotationSpeed,
        )
        const spinDuration = 8 / Math.max(0.001, rotationMagnitude)

        return {
          id: particle.id,
          start: { x: startX, y: startY },
          control1: { x: controlOneX, y: controlOneY },
          control2: { x: controlTwoX, y: controlTwoY },
          end: { x: endX, y: endY },
          duration,
          delay,
          opacity: particle.opacity,
          size: particleSize * galleryParticleVisualScale,
          trail:
            particle.trail *
            responsiveMetrics.layoutScale *
            galleryParticleSize,
          trailOpacity: particle.trailOpacity,
          rotationSeed: particle.rotationSeed,
          motionPath,
          cssStyle: {
            offsetPath: motionPath,
            offsetRotate: 'auto',
            '--particle-size': `${particleSize}px`,
            '--particle-visual-size': `${particleSize * galleryParticleVisualScale}px`,
            '--particle-delay': `${delay}s`,
            '--particle-duration': `${duration}s`,
            '--particle-opacity': particle.opacity,
            '--particle-stretch': `${particle.stretch * responsiveMetrics.layoutScale * galleryParticleSize}px`,
            '--particle-trail': `${particle.trail * responsiveMetrics.layoutScale * galleryParticleSize}px`,
            '--particle-trail-opacity': particle.trailOpacity,
            '--particle-motion-blur': `${particle.motionBlur * responsiveMetrics.layoutScale * galleryParticleSize}px`,
            '--particle-core-blur': `${particle.coreBlur * responsiveMetrics.layoutScale * galleryParticleSize}px`,
            '--particle-base-rotation': `${particle.rotationSeed * 360}deg`,
            '--particle-spin-duration': `${spinDuration}s`,
            '--particle-spin-delay': `${-particle.rotationSeed * spinDuration}s`,
            '--particle-spin-direction':
              galleryPageSettings.particles.rotationSpeed < 0
                ? 'reverse'
                : 'normal',
          } as CSSProperties,
        }
      }), [
    galleryPageSettings.particles.count,
    galleryPageSettings.particles.rotationSpeed,
    galleryPageSettings.particles.speed,
    galleryParticleSize,
    galleryParticleVisualScale,
    responsiveMetrics.layoutScale,
    responsiveMetrics.planeHeight,
    responsiveMetrics.planeLeft,
    responsiveMetrics.planeTop,
    responsiveMetrics.planeWidth,
  ])
  const videoPageSettings = pageSettings['video-library']
  const modelLibraryPageSettings = pageSettings['model-library']
  const frameRingPageSettings = pageSettings['frame-ring']
  const discoveryPageSettings = pageSettings['online-search']
  const currentReflectionSurfaceNotice = isReflectionView(currentView)
    ? reflectionSurfaceNotices[currentView]
    : null
  const currentParticlePalette = getParticlePalette(currentPageSettings.particles.color)
  const currentUiBorder = hexToRgb(currentPageSettings.uiBorderColor)
  const hasPageColorGrade =
    currentPageSettings.contrast !== 100 ||
    currentPageSettings.saturation !== 100 ||
    currentPageSettings.hue !== 0
  const stageStyle =
    {
      '--drag-offset': '0px',
      '--release-duration': `${releaseDuration}ms`,
      '--camera-yaw': `${cameraPose.yaw}deg`,
      '--camera-pitch': `${cameraPose.pitch}deg`,
      '--camera-pan-x': `${cameraPose.yaw * -2.8 * responsiveMetrics.layoutScale}px`,
      '--camera-pan-y': `${cameraPose.pitch * 2.2 * responsiveMetrics.layoutScale}px`,
      '--camera-design-pan-x': `${cameraPose.yaw * -2.8}px`,
      '--camera-design-pan-y': `${cameraPose.pitch * 2.2}px`,
      '--camera-bg-x': `${cameraPose.yaw * -5.6 * responsiveMetrics.layoutScale}px`,
      '--camera-bg-y': `${cameraPose.pitch * 4.4 * responsiveMetrics.layoutScale}px`,
      '--layout-scale': responsiveMetrics.layoutScale,
      '--layout-plane-left': `${responsiveMetrics.planeLeft}px`,
      '--layout-plane-top': `${responsiveMetrics.planeTop}px`,
      '--layout-plane-design-left': `${responsiveMetrics.planeLeft / responsiveMetrics.layoutScale}px`,
      '--layout-plane-design-top': `${responsiveMetrics.planeTop / responsiveMetrics.layoutScale}px`,
      '--layout-plane-right-inset': `${responsiveMetrics.rightInset}px`,
      '--layout-plane-bottom-inset': `${responsiveMetrics.bottomInset}px`,
      '--layout-plane-height': `${responsiveMetrics.planeHeight}px`,
      '--layout-plane-center-x': `${responsiveMetrics.planeLeft + responsiveMetrics.planeWidth / 2}px`,
      '--layout-plane-center-y': `${responsiveMetrics.planeTop + responsiveMetrics.planeHeight / 2}px`,
      '--clip-action-notice-center-x': `${
        currentView === 'frame-ring'
          ? frameRingLayout.stage.left + frameRingLayout.stage.width / 2
          : responsiveMetrics.planeLeft + responsiveMetrics.planeWidth / 2
      }px`,
      '--aurora-topbar-center-design-y': `${AURORA_TOPBAR_CENTER_Y}px`,
      '--layout-gallery-origin-x': `${responsiveMetrics.planeLeft + responsiveMetrics.planeWidth * 0.55}px`,
      '--layout-gallery-origin-y': `${responsiveMetrics.planeTop + responsiveMetrics.planeHeight * 0.56}px`,
      '--ui-2d-border-color': `rgba(${currentUiBorder.r}, ${currentUiBorder.g}, ${currentUiBorder.b}, 0.3)`,
      '--asset-ui-tint-filter': getMaterialTintFilter(currentPageSettings.materialTint),
      '--page-filter-contrast': currentPageSettings.contrast / 100,
      '--page-filter-saturation': currentPageSettings.saturation / 100,
      '--page-filter-hue': `${currentPageSettings.hue}deg`,
      '--particle-core-rgb': currentParticlePalette.core,
      '--particle-trail-rgb': currentParticlePalette.trail,
      '--particle-glow-rgb': currentParticlePalette.glow,
      ...getVideoLibraryCssVariables(videoLibraryLayout),
    } as CSSProperties
  const dragProgress =
    isDragging || isReleasing
      ? dragOffset / getProjectDragLimit(responsiveMetrics.layoutScale, dragOffset)
      : 0
  const useLoopEdgeCards = projects.length >= 5
  const useMotionEdgeFade = projects.length >= 5 || isDragging || isReleasing

  function resetClipTrackForFiltering() {
    cancelClipReleaseAnimation()
    if (clipDragRaf.current !== undefined) {
      window.cancelAnimationFrame(clipDragRaf.current)
      clipDragRaf.current = undefined
    }
    pendingClipTrackPosition.current = 0
    pendingClipOverscroll.current = 0
    setClipTrackPosition(0)
    setClipOverscroll(0)
    setIsClipDragging(false)
    setIsClipReleasing(false)
    setHoveredClipId(null)
  }

  function selectClipFilter(menuId: ClipFilterMenuId, value: string) {
    setClipFilters(
      (current) =>
        ({
          ...current,
          [menuId]: value,
        }) as ClipFilterState,
    )
    setOpenClipFilterMenu(null)
    resetClipTrackForFiltering()
  }

  function resetClipFilters(clearSearch = false) {
    setClipFilters({ ...DEFAULT_CLIP_FILTER_STATE })
    if (clearSearch) setQuery('')
    setOpenClipFilterMenu(null)
    resetClipTrackForFiltering()
  }

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []

    return displayProjects.filter((project) => {
      const haystack = `${project.title} ${project.subtitle}`.toLowerCase()
      return haystack.includes(term)
    })
  }, [displayProjects, query])
  const libraryMediaAssets = useMemo(
    () =>
      selectLibraryMediaAssets(mediaAssets).filter(
        (asset) => !isOnlineMediaAsset(asset),
      ),
    [mediaAssets],
  )
  const referencedMediaAssets = useMemo(
    () => selectReferencedMediaAssets(projectAssetRefs, mediaAssets),
    [mediaAssets, projectAssetRefs],
  )
  const referencedLocalMediaAssets = useMemo(
    () => referencedMediaAssets.filter((asset) => !isOnlineMediaAsset(asset)),
    [referencedMediaAssets],
  )
  const referencedOnlineMediaAssets = useMemo(
    () => referencedMediaAssets.filter(isOnlineMediaAsset),
    [referencedMediaAssets],
  )
  const enabledOnlineProviders = useMemo(
    () =>
      ONLINE_MEDIA_PROVIDER_IDS.filter(
        (provider) => onlineProviderEnabled[provider],
      ),
    [onlineProviderEnabled],
  )
  const onlineDiscoveryAssets = useMemo(() => {
    const assetsById = new Map(
      mediaAssets
        .filter(isOnlineMediaAsset)
        .map((asset) => [asset.id, asset] as const),
    )
    if (bilibiliSelectionAsset) {
      assetsById.set(bilibiliSelectionAsset.id, bilibiliSelectionAsset)
    }
    ONLINE_MEDIA_PROVIDER_IDS.forEach((provider) => {
      onlineSearchAssetsByProvider[provider].forEach((asset) =>
        assetsById.set(asset.id, asset),
      )
    })
    return [...assetsById.values()]
  }, [
    bilibiliSelectionAsset,
    mediaAssets,
    onlineSearchAssetsByProvider,
  ])
  const localDiscoveryResults = useMemo(() => {
    const localAssetIds = new Set(
      libraryMediaAssets.map((asset) => asset.id),
    )
    return [
      ...createLocalDiscoveryResults({
        clips: videoClips.filter((clip) => localAssetIds.has(clip.assetId)),
        models: modelAssets,
        projects: displayProjects,
        frameAnnotations,
      }),
      ...createOnlineDiscoveryResults({
        mediaAssets: onlineDiscoveryAssets,
        projectAssetRefs,
        projects: displayProjects,
        selectedAssetId: bilibiliSelectionAsset?.id,
        transientAssetIds: ONLINE_MEDIA_PROVIDER_IDS.flatMap((provider) =>
          onlineSearchAssetsByProvider[provider].map((asset) => asset.id),
        ),
        resolveThumbnailUrl: (thumbnail) =>
          resolveLibraryMediaUrl(thumbnail),
      }),
    ]
  }, [
    onlineDiscoveryAssets,
    bilibiliSelectionAsset?.id,
    displayProjects,
    frameAnnotations,
    libraryMediaAssets,
    modelAssets,
    projectAssetRefs,
    onlineSearchAssetsByProvider,
    videoClips,
  ])
  const aiDiscoveryFrameResults = useMemo(() => {
    const localAssetIds = new Set(
      libraryMediaAssets.map((asset) => asset.id),
    )
    return createLocalDiscoveryResults({
      clips: videoClips.filter((clip) => localAssetIds.has(clip.assetId)),
      projects: displayProjects,
      frameAnnotations,
      includeUnannotatedFrames: true,
    }).filter(
      (result): result is DiscoveryFootageResult =>
        result.detailType === 'footage' && result.kind === 'frame',
    )
  }, [
    displayProjects,
    frameAnnotations,
    libraryMediaAssets,
    videoClips,
  ])
  const aiDiscoveryFrameResultsById = useMemo(
    () => new Map(aiDiscoveryFrameResults.map((result) => [result.id, result])),
    [aiDiscoveryFrameResults],
  )
  const aiVisualFrameCandidates = useMemo(() => {
    return createAiVisualSearchCandidates({
      clips: videoClips,
      assets: libraryMediaAssets,
      projects: displayProjects,
    })
  }, [displayProjects, libraryMediaAssets, videoClips])
  const aiDiscoveryVisualResultsById = useMemo(() => {
    const results = new Map(aiDiscoveryFrameResultsById)
    const localClipResultsById = new Map(
      localDiscoveryResults.flatMap((result) =>
        result.detailType === 'footage' &&
        result.source === 'local' &&
        result.kind === 'clip'
          ? [[result.id, result] as const]
          : [],
      ),
    )
    const clipsById = new Map(videoClips.map((clip) => [clip.id, clip]))

    aiVisualFrameCandidates.forEach((candidate) => {
      if (candidate.analysisTier !== 'thumbnail') return
      const clipResult = localClipResultsById.get(
        `local:clip:${candidate.clipId}`,
      )
      const clip = clipsById.get(candidate.clipId)
      if (!clipResult || !clip) return
      const previewProgress = clip.durationSeconds && clip.durationSeconds > 0
        ? Math.min(
            100,
            Math.max(0, candidate.timeSeconds / clip.durationSeconds * 100),
          )
        : 0
      results.set(candidate.resultId, {
        ...clipResult,
        id: candidate.resultId,
        kind: 'frame',
        thumbnail:
          resolveLibraryMediaUrl(candidate.imagePath) || clipResult.thumbnail,
        previewProgress,
        footage: {
          ...clipResult.footage,
          auroraTimeSeconds: candidate.timeSeconds,
        },
      })
    })
    return results
  }, [
    aiDiscoveryFrameResultsById,
    aiVisualFrameCandidates,
    localDiscoveryResults,
    videoClips,
  ])
  const aiDiscoveryCoverage = useMemo(() => {
    const localAssetIds = new Set(
      libraryMediaAssets.map((asset) => asset.id),
    )
    const totalAssetIds = new Set(
      videoClips
        .filter((clip) => localAssetIds.has(clip.assetId))
        .map((clip) => clip.assetId),
    )
    const thumbnailAssetIds = new Set<string>()
    const visualIndexAssetIds = new Set<string>()
    aiVisualFrameCandidates.forEach((candidate) => {
      if (candidate.analysisTier === 'thumbnail') {
        thumbnailAssetIds.add(candidate.assetId)
      } else {
        visualIndexAssetIds.add(candidate.assetId)
      }
    })
    const searchableAssetIds = new Set([
      ...thumbnailAssetIds,
      ...visualIndexAssetIds,
    ])
    return {
      totalLocalVideos: totalAssetIds.size,
      searchableLocalVideos: searchableAssetIds.size,
      thumbnailVideos: thumbnailAssetIds.size,
      visualIndexVideos: visualIndexAssetIds.size,
    }
  }, [aiVisualFrameCandidates, libraryMediaAssets, videoClips])
  const libraryStorageLabel = useMemo(() => {
    let knownBytes = 0
    let unknownCount = 0

    referencedLocalMediaAssets.forEach((asset) => {
      if (
        typeof asset.sizeBytes === 'number' &&
        Number.isFinite(asset.sizeBytes) &&
        asset.sizeBytes > 0
      ) {
        knownBytes += asset.sizeBytes
      } else {
        unknownCount += 1
      }
    })
    modelAssets.forEach((asset) => {
      if (Number.isFinite(asset.sizeBytes) && asset.sizeBytes > 0) {
        knownBytes += asset.sizeBytes
      }
    })

    if (knownBytes > 0) {
      const formatted = formatMediaFileSize(knownBytes)
      return unknownCount > 0 ? `${formatted} + 待分析` : formatted
    }

    return unknownCount > 0 ? '容量待分析' : '0 KB'
  }, [modelAssets, referencedLocalMediaAssets])
  const storageStats = useMemo(
    () => [
      { label: `${displayProjects.length} 个项目`, icon: Box },
      {
        label: `${referencedLocalMediaAssets.length + modelAssets.length} 个本地资产`,
        icon: Video,
      },
      {
        label: `${referencedOnlineMediaAssets.length} 个在线视频`,
        icon: Play,
      },
      { label: libraryStorageLabel, icon: HardDrive },
    ],
    [
      displayProjects.length,
      libraryStorageLabel,
      modelAssets.length,
      referencedLocalMediaAssets.length,
      referencedOnlineMediaAssets.length,
    ],
  )

  const moveProject = useCallback((delta: number) => {
    setActiveIndex((index) => (index + delta + projects.length) % projects.length)
  }, [projects.length])

  const animateProjectStep = useCallback((delta: number) => {
    if (releaseTimer.current !== undefined || dragRaf.current !== undefined) return

    const canCycle = projects.length > 1
    const stepDelta = Math.sign(delta)
    const targetOffset = canCycle
      ? stepDelta > 0
        ? -getProjectDragLimit(responsiveMetrics.layoutScale, -1)
        : getProjectDragLimit(responsiveMetrics.layoutScale, 1)
      : -stepDelta * 46 * responsiveMetrics.layoutScale
    const duration = canCycle ? 520 : 240

    setIsDragging(false)
    setIsReleasing(true)
    setReleaseSource('step')
    setReleaseStepDelta(stepDelta)
    setReleaseDuration(duration)
    pendingDragOffset.current = 0
    setDragOffset(0)

    dragRaf.current = window.requestAnimationFrame(() => {
      dragRaf.current = window.requestAnimationFrame(() => {
        dragRaf.current = undefined
        pendingDragOffset.current = targetOffset
        setDragOffset(targetOffset)

        releaseTimer.current = window.setTimeout(() => {
          if (canCycle) {
            moveProject(stepDelta)
            setIsRecycling(true)
          }
          setIsReleasing(false)
          setReleaseSource(null)
          setReleaseStepDelta(0)
          pendingDragOffset.current = 0
          setDragOffset(0)
          suppressNextClick.current = false
          releaseTimer.current = undefined
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => setIsRecycling(false))
          })
        }, duration + PROJECT_RELEASE_SETTLE_PADDING)
      })
    })
  }, [moveProject, projects.length, responsiveMetrics.layoutScale])

  function clampDragOffset(value: number) {
    const limit = getProjectDragLimit(responsiveMetrics.layoutScale, value)
    return Math.max(-limit, Math.min(limit, value))
  }

  function clampProgress(value: number) {
    return Math.max(-1, Math.min(1, value))
  }

  function scheduleDragOffset(value: number) {
    pendingDragOffset.current = projects.length <= 1 ? clampDragOffset(value) : value
    if (dragRaf.current !== undefined) return

    dragRaf.current = window.requestAnimationFrame(() => {
      dragRaf.current = undefined
      setDragOffset(projects.length <= 1 ? pendingDragOffset.current : clampDragOffset(pendingDragOffset.current))
    })
  }

  function getClipTrackGesture(rawPosition: number, columnTravel: number) {
    const overscrollLimit = 38 * responsiveMetrics.layoutScale
    if (rawPosition < 0) {
      return {
        position: 0,
        overscroll: Math.min(overscrollLimit, -rawPosition * columnTravel * 0.16),
      }
    }
    if (rawPosition > clipTrackMaxPosition) {
      return {
        position: clipTrackMaxPosition,
        overscroll: -Math.min(
          overscrollLimit,
          (rawPosition - clipTrackMaxPosition) * columnTravel * 0.16,
        ),
      }
    }
    return { position: rawPosition, overscroll: 0 }
  }

  function scheduleClipTrack(position: number, overscroll: number) {
    pendingClipTrackPosition.current = position
    pendingClipOverscroll.current = overscroll
    if (clipDragRaf.current !== undefined) return

    clipDragRaf.current = window.requestAnimationFrame(() => {
      clipDragRaf.current = undefined
      setClipTrackPosition(pendingClipTrackPosition.current)
      setClipOverscroll(pendingClipOverscroll.current)
    })
  }

  function cancelProjectWheelPreview() {
    if (projectWheelPreviewRaf.current === undefined) return
    window.cancelAnimationFrame(projectWheelPreviewRaf.current)
    projectWheelPreviewRaf.current = undefined
  }

  function scheduleProjectWheelPreview() {
    if (projectWheelPreviewRaf.current !== undefined) return
    const animate = (now: number) => {
      const wheelState = projectWheelDragRef.current
      if (!wheelState.active || wheelState.axis !== 'x') {
        projectWheelPreviewRaf.current = undefined
        return
      }
      const idleDuration = now - wheelState.lastTime
      if (idleDuration >= WHEEL_DRAG_END_DELAY) {
        projectWheelPreviewRaf.current = undefined
        return
      }
      const dragLimit = getProjectDragLimit(
        responsiveMetrics.layoutScale,
        wheelState.offset,
      )
      wheelState.visualOffset = resolveWheelDragPreviewPosition(
        wheelState.previewStartOffset,
        wheelState.snapTargetProgress * dragLimit,
        idleDuration,
      )
      scheduleDragOffset(wheelState.visualOffset)
      projectWheelPreviewRaf.current = window.requestAnimationFrame(animate)
    }
    projectWheelPreviewRaf.current = window.requestAnimationFrame(animate)
  }

  function cancelClipWheelPreview() {
    if (clipWheelPreviewRaf.current === undefined) return
    window.cancelAnimationFrame(clipWheelPreviewRaf.current)
    clipWheelPreviewRaf.current = undefined
  }

  function scheduleClipWheelPreview() {
    if (clipWheelPreviewRaf.current !== undefined) return
    const animate = (now: number) => {
      const wheelState = clipWheelDragRef.current
      if (!wheelState.active || wheelState.axis !== 'x') {
        clipWheelPreviewRaf.current = undefined
        return
      }
      const idleDuration = now - wheelState.lastTime
      if (idleDuration >= WHEEL_DRAG_END_DELAY) {
        clipWheelPreviewRaf.current = undefined
        return
      }
      wheelState.visualPosition = resolveWheelDragPreviewPosition(
        wheelState.previewStartPosition,
        wheelState.snapTarget,
        idleDuration,
      )
      const gesture = getClipTrackGesture(
        wheelState.visualPosition,
        videoLibraryLayout.columnTravel,
      )
      scheduleClipTrack(gesture.position, gesture.overscroll)
      clipWheelPreviewRaf.current = window.requestAnimationFrame(animate)
    }
    clipWheelPreviewRaf.current = window.requestAnimationFrame(animate)
  }

  function cancelClipReleaseAnimation() {
    if (clipReleaseRaf.current === undefined) return
    window.cancelAnimationFrame(clipReleaseRaf.current)
    clipReleaseRaf.current = undefined
  }

  function settleClipTrack(targetPosition: number, initialVelocity: number) {
    cancelClipReleaseAnimation()
    let position = pendingClipTrackPosition.current
    let overscroll = pendingClipOverscroll.current
    let velocity = clampNumber(initialVelocity, -8, 8)
    let overscrollVelocity = 0
    let previousTime = performance.now()
    const startedAt = previousTime

    if (position <= 0 && targetPosition === 0 && velocity < 0) velocity = 0
    if (
      position >= clipTrackMaxPosition &&
      targetPosition === clipTrackMaxPosition &&
      velocity > 0
    ) {
      velocity = 0
    }

    setIsClipDragging(false)
    setIsClipReleasing(true)

    const animate = (now: number) => {
      const deltaSeconds = Math.min(0.032, Math.max(0.001, (now - previousTime) / 1000))
      previousTime = now

      const acceleration =
        -CLIP_TRACK_SPRING_STIFFNESS * (position - targetPosition) -
        CLIP_TRACK_SPRING_DAMPING * velocity
      velocity += acceleration * deltaSeconds
      position += velocity * deltaSeconds

      if (position < 0) {
        position = 0
        if (velocity < 0) velocity = 0
      } else if (position > clipTrackMaxPosition) {
        position = clipTrackMaxPosition
        if (velocity > 0) velocity = 0
      }

      const overscrollAcceleration =
        -CLIP_TRACK_SPRING_STIFFNESS * overscroll -
        CLIP_TRACK_SPRING_DAMPING * overscrollVelocity
      overscrollVelocity += overscrollAcceleration * deltaSeconds
      overscroll += overscrollVelocity * deltaSeconds

      pendingClipTrackPosition.current = position
      pendingClipOverscroll.current = overscroll
      setClipTrackPosition(position)
      setClipOverscroll(overscroll)

      const settled =
        Math.abs(position - targetPosition) < 0.001 &&
        Math.abs(velocity) < 0.015 &&
        Math.abs(overscroll) < 0.08 &&
        Math.abs(overscrollVelocity) < 1

      if (settled || now - startedAt > 720) {
        pendingClipTrackPosition.current = targetPosition
        pendingClipOverscroll.current = 0
        setClipTrackPosition(targetPosition)
        setClipOverscroll(0)
        setIsClipReleasing(false)
        clipReleaseRaf.current = undefined
        window.setTimeout(() => {
          suppressNextClipClick.current = false
        }, 0)
        return
      }

      clipReleaseRaf.current = window.requestAnimationFrame(animate)
    }

    clipReleaseRaf.current = window.requestAnimationFrame(animate)
  }

  function clearClipHoverScrub(expectedClipId?: string) {
    const previewPreparation = clipHoverPreviewPrepareRef.current
    if (
      previewPreparation &&
      (!expectedClipId || previewPreparation.clipId === expectedClipId)
    ) {
      window.clearTimeout(previewPreparation.timer)
      clipHoverPreviewPrepareRef.current = null
    }

    const pending = pendingClipHoverScrubRef.current
    if (!expectedClipId || pending?.clip.id === expectedClipId) {
      pendingClipHoverScrubRef.current = null
      if (clipHoverScrubRafRef.current !== undefined) {
        window.cancelAnimationFrame(clipHoverScrubRafRef.current)
        clipHoverScrubRafRef.current = undefined
      }
    }

    const session = clipHoverScrubSessionRef.current
    if (!session || (expectedClipId && session.clipId !== expectedClipId)) {
      return
    }

    session.image.style.removeProperty('--clip-preview-cover')
    session.image.removeAttribute('data-hover-scrubbing')
    session.hitTarget.removeAttribute('data-hover-scrubbing')
    const video = clipHoverScrubVideoRef.current
    if (video) {
      video.pause()
      video.removeAttribute('data-frame-ready')
    }
    clipHoverScrubSessionRef.current = null
    setClipHoverScrubVideoPortal((current) =>
      current?.clipId === session.clipId ? null : current,
    )
  }

  function resolveReadyLightweightPreviewUrl(clip: VideoClip) {
    const preview = lightweightPreviewByAsset[clip.assetId]
    if (
      preview?.status !== 'ready' ||
      preview.sourcePath !== clip.sourcePath ||
      !preview.playbackPath
    ) {
      return null
    }
    return resolveLibraryMediaUrl(preview.playbackPath)
  }

  function scheduleLightweightHoverPreview(clip: VideoClip) {
    if (clip.online || !clip.sourcePath || clip.indexedFrames.length > 1) return
    const preview = lightweightPreviewByAsset[clip.assetId]
    if (
      preview?.sourcePath === clip.sourcePath &&
      (preview.status === 'preparing' ||
        preview.status === 'ready' ||
        preview.status === 'failed')
    ) {
      return
    }

    const scheduled = clipHoverPreviewPrepareRef.current
    if (scheduled?.clipId === clip.id) return
    if (scheduled) window.clearTimeout(scheduled.timer)
    const timer = window.setTimeout(() => {
      if (clipHoverPreviewPrepareRef.current?.clipId !== clip.id) return
      clipHoverPreviewPrepareRef.current = null
      const activeClipId =
        clipHoverScrubSessionRef.current?.clipId ??
        pendingClipHoverScrubRef.current?.clip.id
      if (activeClipId === clip.id) {
        void ensureLightweightPreview(clip)
      }
    }, 180)
    clipHoverPreviewPrepareRef.current = { clipId: clip.id, timer }
  }

  function findClipHoverScrubImage(clipId: string) {
    const card = Array.from(
      clipGridRef.current?.querySelectorAll<HTMLElement>('.videoClipCard') ?? [],
    ).find((candidate) => candidate.dataset.clipId === clipId)
    return card?.querySelector<HTMLElement>('.videoClipImage') ?? null
  }

  function preloadClipHoverFrame(url: string) {
    if (!url || loadedClipHoverFramesRef.current.has(url)) return
    const loader = new window.Image()
    loader.decoding = 'async'
    loader.onload = () => loadedClipHoverFramesRef.current.add(url)
    loader.src = url
  }

  function applyIndexedClipHoverFrame(
    clip: VideoClip,
    session: ClipHoverScrubSession,
    progress: number,
  ) {
    const frameIndex = resolveVideoClipHoverFrameIndex(
      progress,
      clip.indexedFrames.map((frame) => frame.timeSeconds),
      clip.durationSeconds,
    )
    if (frameIndex === null || session.lastFrameIndex === frameIndex) return
    const frame = clip.indexedFrames[frameIndex]
    if (!frame?.thumbnail) return

    session.lastFrameIndex = frameIndex
    session.frameLoadVersion += 1
    const requestVersion = session.frameLoadVersion
    const applyFrame = () => {
      const current = clipHoverScrubSessionRef.current
      if (
        current !== session ||
        current.mode !== 'frames' ||
        current.frameLoadVersion !== requestVersion ||
        current.lastFrameIndex !== frameIndex
      ) {
        return
      }
      current.image.style.setProperty(
        '--clip-preview-cover',
        toCssImageValue(frame.thumbnail),
      )
    }

    if (loadedClipHoverFramesRef.current.has(frame.thumbnail)) {
      applyFrame()
    } else {
      const loader = new window.Image()
      loader.decoding = 'async'
      loader.onload = () => {
        loadedClipHoverFramesRef.current.add(frame.thumbnail)
        applyFrame()
      }
      loader.src = frame.thumbnail
    }

    const previousFrame = clip.indexedFrames[frameIndex - 1]
    const nextFrame = clip.indexedFrames[frameIndex + 1]
    if (previousFrame?.thumbnail) preloadClipHoverFrame(previousFrame.thumbnail)
    if (nextFrame?.thumbnail) preloadClipHoverFrame(nextFrame.thumbnail)
  }

  function seekClipHoverScrubVideo(video = clipHoverScrubVideoRef.current) {
    const session = clipHoverScrubSessionRef.current
    if (!session || session.mode !== 'video' || !video || video.readyState < 1) {
      return
    }
    if (video.dataset.clipId !== session.clipId) return
    if (video.seeking) return

    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : null
    if (duration === null) return
    const seekStep = 1 / 12
    const targetTime = resolveVideoClipHoverSeekTime(
      session.progress,
      duration,
    )
    if (targetTime === null) return
    if (Math.abs(video.currentTime - targetTime) < seekStep * 0.75) return
    try {
      video.currentTime = targetTime
    } catch {
      // A later pointer sample or loadedmetadata event will retry quietly.
    }
  }

  function flushClipHoverScrub() {
    clipHoverScrubRafRef.current = undefined
    const pending = pendingClipHoverScrubRef.current
    pendingClipHoverScrubRef.current = null
    if (!pending || !pending.hitTarget.isConnected) return

    const image = findClipHoverScrubImage(pending.clip.id)
    if (!image) {
      clearClipHoverScrub(pending.clip.id)
      return
    }
    const progress = resolveVideoClipHoverProgress(
      pending.clientX,
      pending.clientY,
      image.getBoundingClientRect(),
    )
    if (progress === null) {
      clearClipHoverScrub(pending.clip.id)
      return
    }

    const useIndexedFrames = pending.clip.indexedFrames.length > 1
    const lightweightSourceUrl = resolveReadyLightweightPreviewUrl(pending.clip)
    // Keep the original source interactive while the one-time lightweight
    // proxy is warming. Once the proxy is ready, the next pointer sample
    // switches over without making first hover look broken.
    const hoverSourceUrl = resolveVideoClipHoverPlaybackSource(
      lightweightSourceUrl,
      pending.clip.sourceUrl,
    )
    const useVideoFallback = Boolean(hoverSourceUrl)
    if (!useIndexedFrames && !useVideoFallback) {
      clearClipHoverScrub(pending.clip.id)
      return
    }

    const nextMode = useIndexedFrames ? 'frames' : 'video'
    let session = clipHoverScrubSessionRef.current
    if (
      !session ||
      session.clipId !== pending.clip.id ||
      session.mode !== nextMode ||
      session.image !== image ||
      (nextMode === 'video' && session.sourceUrl !== hoverSourceUrl)
    ) {
      clearClipHoverScrub()
      session = {
        clipId: pending.clip.id,
        mode: nextMode,
        image,
        hitTarget: pending.hitTarget,
        progress,
        sourceUrl: hoverSourceUrl,
        lastFrameIndex: -1,
        frameLoadVersion: 0,
      }
      clipHoverScrubSessionRef.current = session
      image.dataset.hoverScrubbing = nextMode
      pending.hitTarget.dataset.hoverScrubbing = nextMode
      if (nextMode === 'video' && hoverSourceUrl) {
        setClipHoverScrubVideoPortal({
          clipId: pending.clip.id,
          sourceUrl: hoverSourceUrl,
          poster: pending.clip.thumbnail,
          target: image,
          lightweight: Boolean(lightweightSourceUrl),
        })
      }
    }

    session.progress = progress
    if (session.mode === 'frames') {
      applyIndexedClipHoverFrame(pending.clip, session, progress)
    } else {
      seekClipHoverScrubVideo()
    }
  }

  function handleClipHoverScrubPointerMove(
    event: ReactPointerEvent<HTMLElement>,
    clip: VideoClip,
  ) {
    if (
      clip.online ||
      !shouldHandleVideoClipHoverPointer({
        pointerType: event.pointerType,
        buttons: event.buttons,
      }) ||
      clipDragState.current.active ||
      clipWheelDragRef.current.active ||
      isClipDragging ||
      isClipReleasing ||
      isCameraDragging
    ) {
      clearClipHoverScrub(clip.id)
      return
    }

    scheduleLightweightHoverPreview(clip)

    pendingClipHoverScrubRef.current = {
      clip,
      clientX: event.clientX,
      clientY: event.clientY,
      hitTarget: event.currentTarget,
    }
    if (clipHoverScrubRafRef.current === undefined) {
      clipHoverScrubRafRef.current = window.requestAnimationFrame(
        flushClipHoverScrub,
      )
    }
  }

  function markClipHoverScrubVideoReady(video: HTMLVideoElement) {
    const session = clipHoverScrubSessionRef.current
    if (
      session?.mode === 'video' &&
      session.clipId === video.dataset.clipId
    ) {
      video.dataset.frameReady = 'true'
    }
  }

  function handleClipHoverScrubVideoError(
    clipId: string,
    sourceUrl: string,
  ) {
    const session = clipHoverScrubSessionRef.current
    if (
      session?.clipId !== clipId ||
      session.sourceUrl !== sourceUrl
    ) {
      return
    }
    clearClipHoverScrub(clipId)
  }

  function handleClipStagePointerDown(event: ReactPointerEvent<HTMLElement>) {
    clearClipHoverScrub()
    if (event.button !== 0 || clipTrackMaxPosition <= 0) return

    const pointerTarget = event.target as HTMLElement
    const cardTarget = pointerTarget.closest(
      '.videoClipHitTarget, .videoClipCard',
    ) as HTMLElement | null
    if (!cardTarget) return
    event.stopPropagation()

    if (clipWheelReleaseTimer.current !== undefined) {
      window.clearTimeout(clipWheelReleaseTimer.current)
      clipWheelReleaseTimer.current = undefined
    }
    clipWheelDragRef.current.active = false
    cancelClipWheelPreview()

    cancelClipReleaseAnimation()
    if (clipDragRaf.current !== undefined) {
      window.cancelAnimationFrame(clipDragRaf.current)
      clipDragRaf.current = undefined
    }

    const now = performance.now()
    clipDragState.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      clipId: cardTarget.dataset.clipId ?? '',
      startPosition: pendingClipTrackPosition.current,
      columnTravel: videoLibraryLayout.columnTravel,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: now,
      velocityX: 0,
    }
    pendingClipOverscroll.current = 0
    setClipTrackPosition(pendingClipTrackPosition.current)
    setClipOverscroll(0)
    setIsClipDragging(false)
    setIsClipReleasing(false)
    setHoveredClipId(null)
    suppressNextClipClick.current = false
  }

  function handleClipStageWheel(event: WheelEvent) {
    if (clipTrackMaxPosition <= 0 || clipDragState.current.active) return
    const wheelState = clipWheelDragRef.current
    const canStartFromTarget = Boolean(
      (event.target as HTMLElement).closest('.videoClipHitTarget, .videoClipCard'),
    )
    if (!wheelState.active && !canStartFromTarget) return
    const sample = readWheelDragSample(
      event,
      viewportHeight,
      wheelState.active ? wheelState.axis : null,
    )
    if (!sample || (!wheelState.active && !sample.moves)) return
    event.preventDefault()
    event.stopPropagation()

    const now = performance.now()
    if (!wheelState.active) {
      cancelClipReleaseAnimation()
      wheelState.active = true
      wheelState.axis = sample.axis
      wheelState.snapAnchor = Math.round(pendingClipTrackPosition.current)
      wheelState.rawPosition = pendingClipTrackPosition.current
      wheelState.visualPosition = pendingClipTrackPosition.current
      wheelState.previewStartPosition = pendingClipTrackPosition.current
      wheelState.snapTarget = wheelState.snapAnchor
      wheelState.lastTime = now
      wheelState.velocityX = 0
      pendingClipOverscroll.current = 0
      setClipOverscroll(0)
      setIsClipDragging(true)
      setIsClipReleasing(false)
      setHoveredClipId(null)
      clearClipHoverScrub()
      suppressNextClipClick.current = true
    } else if (sample.moves) {
      const elapsed = Math.max(1, now - wheelState.lastTime)
      wheelState.velocityX = -sample.delta / elapsed
      wheelState.lastTime = now
    } else {
      wheelState.velocityX = 0
    }

    if (sample.moves) {
      const trackDelta = sample.delta / videoLibraryLayout.columnTravel
      wheelState.rawPosition += trackDelta
      wheelState.visualPosition += trackDelta
      wheelState.previewStartPosition = wheelState.visualPosition
      wheelState.snapTarget = resolveTrackpadSnapTarget(
        wheelState.snapAnchor,
        wheelState.rawPosition,
        0,
        clipTrackMaxPosition,
      )
      const gesture = getClipTrackGesture(
        wheelState.visualPosition,
        videoLibraryLayout.columnTravel,
      )
      scheduleClipTrack(gesture.position, gesture.overscroll)
      if (wheelState.axis === 'x') scheduleClipWheelPreview()

      if (clipWheelReleaseTimer.current !== undefined) {
        window.clearTimeout(clipWheelReleaseTimer.current)
      }
      clipWheelReleaseTimer.current = window.setTimeout(
        finishClipWheelDrag,
        WHEEL_DRAG_END_DELAY,
      )
    }
  }

  function finishClipWheelDrag() {
    const wheelState = clipWheelDragRef.current
    if (!wheelState.active) return
    wheelState.active = false
    clipWheelReleaseTimer.current = undefined
    cancelClipWheelPreview()

    if (clipDragRaf.current !== undefined) {
      window.cancelAnimationFrame(clipDragRaf.current)
      clipDragRaf.current = undefined
      setClipTrackPosition(pendingClipTrackPosition.current)
      setClipOverscroll(pendingClipOverscroll.current)
    }

    if (wheelState.axis === 'x') {
      const releasePosition = pendingClipTrackPosition.current
      const targetPosition = wheelState.snapTarget
      const trackVelocity = (
        -wheelState.velocityX / videoLibraryLayout.columnTravel
      ) * 1000
      const remainingDirection = Math.sign(targetPosition - releasePosition)
      const velocityContinuesToTarget =
        remainingDirection !== 0 && Math.sign(trackVelocity) === remainingDirection
      settleClipTrack(
        targetPosition,
        velocityContinuesToTarget ? trackVelocity : 0,
      )
    } else {
      releaseClipTrackDrag(
        pendingClipTrackPosition.current,
        pendingClipOverscroll.current,
        wheelState.velocityX,
        videoLibraryLayout.columnTravel,
      )
    }
  }

  clipWheelHandlerRef.current = handleClipStageWheel

  function handleClipStagePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const state = clipDragState.current
    if (!state.active || state.pointerId !== event.pointerId) return

    let deltaX = event.clientX - state.startX
    const deltaY = event.clientY - state.startY
    if (!state.dragging && Math.abs(deltaX) < 6) return
    if (!state.dragging && Math.abs(deltaY) > Math.abs(deltaX) * 1.15) return

    const now = performance.now()
    const elapsed = Math.max(1, now - state.lastTime)
    state.velocityX = (event.clientX - state.lastX) / elapsed
    state.lastX = event.clientX
    state.lastTime = now
    if (!state.dragging && !event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    state.dragging = true
    suppressNextClipClick.current = true
    setIsClipDragging(true)

    const rawPosition = state.startPosition - deltaX / state.columnTravel
    const gesture = getClipTrackGesture(rawPosition, state.columnTravel)
    scheduleClipTrack(gesture.position, gesture.overscroll)
    event.preventDefault()
  }

  function finishClipStageDrag(event: ReactPointerEvent<HTMLElement>, shouldCommit: boolean) {
    const state = clipDragState.current
    if (!state.active || state.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (clipDragRaf.current !== undefined) {
      window.cancelAnimationFrame(clipDragRaf.current)
      clipDragRaf.current = undefined
    }

    if (!state.dragging) {
      state.active = false
      setIsClipDragging(false)
      setIsClipReleasing(false)
      if (shouldCommit && state.clipId) setSelectedClipId(state.clipId)
      return
    }

    state.active = false
    const deltaX = event.clientX - state.startX
    const rawPosition = state.startPosition - deltaX / state.columnTravel
    const gesture = getClipTrackGesture(rawPosition, state.columnTravel)
    const velocityAge = performance.now() - state.lastTime
    const pointerVelocity = shouldCommit && velocityAge <= 90 ? state.velocityX : 0
    releaseClipTrackDrag(
      gesture.position,
      gesture.overscroll,
      pointerVelocity,
      state.columnTravel,
    )
  }

  function releaseClipTrackDrag(
    position: number,
    overscroll: number,
    pointerVelocity: number,
    columnTravel: number,
  ) {
    pendingClipTrackPosition.current = position
    pendingClipOverscroll.current = overscroll
    setClipTrackPosition(position)
    setClipOverscroll(overscroll)

    const trackVelocity = (-pointerVelocity / columnTravel) * 1000
    const projectedPosition =
      position + trackVelocity * CLIP_TRACK_RELEASE_PROJECTION_SECONDS
    const unclampedTarget = Math.round(
      clampNumber(projectedPosition, 0, clipTrackMaxPosition),
    )
    const targetPosition = clampNumber(
      unclampedTarget,
      Math.max(0, Math.floor(position - CLIP_TRACK_MAX_FLING_COLUMNS)),
      Math.min(
        clipTrackMaxPosition,
        Math.ceil(position + CLIP_TRACK_MAX_FLING_COLUMNS),
      ),
    )

    settleClipTrack(targetPosition, trackVelocity)
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    if (event.button !== 0) return
    const cardTarget = target.closest('.projectHitTarget, .projectCard') as HTMLElement | null
    if (!cardTarget) return

    const projectIndex = Number(cardTarget.dataset.projectIndex ?? -1)
    const cardActive = cardTarget.dataset.cardActive === 'true'
    const cardOffset = Number(cardTarget.dataset.carouselOffset ?? 0)
    if (
      isReleasing ||
      isRecycling ||
      releaseTimer.current !== undefined ||
      dragRaf.current !== undefined
    ) return

    if (projectWheelReleaseTimer.current !== undefined) {
      window.clearTimeout(projectWheelReleaseTimer.current)
      projectWheelReleaseTimer.current = undefined
    }
    if (projectWheelStepReleaseTimer.current !== undefined) {
      window.clearTimeout(projectWheelStepReleaseTimer.current)
      projectWheelStepReleaseTimer.current = undefined
    }
    projectWheelStepGestureActiveRef.current = false
    projectWheelDragRef.current.active = false
    cancelProjectWheelPreview()

    const now = performance.now()
    dragState.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      projectIndex,
      cardActive,
      cardOffset,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: now,
      velocityX: 0,
    }
    pendingDragOffset.current = 0
    setDragOffset(0)
    setIsDragging(false)
    setIsReleasing(false)
    setReleaseSource(null)
    setReleaseStepDelta(0)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleProjectStageWheel(event: WheelEvent) {
    if (projects.length <= 1 || dragState.current.active) return
    const wheelState = projectWheelDragRef.current
    const canStartFromTarget = Boolean(
      (event.target as HTMLElement).closest('.projectHitTarget, .projectCard'),
    )
    if (
      !wheelState.active &&
      !projectWheelStepGestureActiveRef.current &&
      !canStartFromTarget
    ) return
    const sample = readWheelDragSample(
      event,
      viewportHeight,
      wheelState.active ? wheelState.axis : null,
    )
    if (!sample || (!wheelState.active && !sample.moves)) return

    const isSingleStepGesture = sample.axis === 'y' || event.deltaMode !== 0
    if (isSingleStepGesture) {
      event.preventDefault()
      event.stopPropagation()

      if (projectWheelStepReleaseTimer.current !== undefined) {
        window.clearTimeout(projectWheelStepReleaseTimer.current)
      }
      projectWheelStepReleaseTimer.current = window.setTimeout(() => {
        projectWheelStepReleaseTimer.current = undefined
        projectWheelStepGestureActiveRef.current = false
      }, WHEEL_DRAG_END_DELAY)

      if (projectWheelStepGestureActiveRef.current) return
      projectWheelStepGestureActiveRef.current = true
      if (
        isReleasing ||
        isRecycling ||
        releaseTimer.current !== undefined ||
        dragRaf.current !== undefined
      ) return
      animateProjectStep(Math.sign(sample.delta))
      return
    }
    if (
      !wheelState.active &&
      (isReleasing || isRecycling || releaseTimer.current !== undefined)
    ) return

    event.preventDefault()
    event.stopPropagation()

    const now = performance.now()
    if (!wheelState.active) {
      wheelState.active = true
      wheelState.axis = sample.axis
      wheelState.offset = pendingDragOffset.current
      wheelState.visualOffset = pendingDragOffset.current
      wheelState.previewStartOffset = pendingDragOffset.current
      wheelState.snapTargetProgress = 0
      wheelState.lastTime = now
      wheelState.velocityX = 0
      setIsDragging(true)
      setIsReleasing(false)
      setReleaseSource(null)
      setReleaseStepDelta(0)
      suppressNextClick.current = true
    } else if (sample.moves) {
      const elapsed = Math.max(16, now - wheelState.lastTime)
      wheelState.velocityX = -sample.delta / elapsed
      wheelState.lastTime = now
    } else {
      wheelState.velocityX = 0
    }

    if (sample.moves) {
      let nextOffset = wheelState.offset - sample.delta
      let nextVisualOffset = wheelState.visualOffset - sample.delta
      if (projects.length > 1) {
        let dragLimit = getProjectDragLimit(responsiveMetrics.layoutScale, nextOffset)
        let didCycle = false
        while (nextOffset <= -dragLimit) {
          moveProject(1)
          nextOffset += dragLimit
          nextVisualOffset += dragLimit
          didCycle = true
          dragLimit = getProjectDragLimit(responsiveMetrics.layoutScale, nextOffset)
        }
        while (nextOffset >= dragLimit) {
          moveProject(-1)
          nextOffset -= dragLimit
          nextVisualOffset -= dragLimit
          didCycle = true
          dragLimit = getProjectDragLimit(responsiveMetrics.layoutScale, nextOffset)
        }
        if (didCycle) wheelState.velocityX = 0
      }
      wheelState.offset = nextOffset
      wheelState.visualOffset = nextVisualOffset
      wheelState.previewStartOffset = nextVisualOffset
      const currentDragLimit = getProjectDragLimit(
        responsiveMetrics.layoutScale,
        nextOffset,
      )
      const rawProgress = clampProgress(
        clampDragOffset(nextOffset) / currentDragLimit,
      )
      wheelState.snapTargetProgress = resolveTrackpadSnapTarget(
        0,
        rawProgress,
        -1,
        1,
      )
      scheduleDragOffset(nextVisualOffset)
      if (wheelState.axis === 'x') scheduleProjectWheelPreview()

      if (projectWheelReleaseTimer.current !== undefined) {
        window.clearTimeout(projectWheelReleaseTimer.current)
      }
      projectWheelReleaseTimer.current = window.setTimeout(
        finishProjectWheelDrag,
        WHEEL_DRAG_END_DELAY,
      )
    }
  }

  function finishProjectWheelDrag() {
    const wheelState = projectWheelDragRef.current
    if (!wheelState.active) return
    wheelState.active = false
    projectWheelReleaseTimer.current = undefined
    cancelProjectWheelPreview()

    if (dragRaf.current !== undefined) {
      window.cancelAnimationFrame(dragRaf.current)
      dragRaf.current = undefined
    }
    const dragLimit = getProjectDragLimit(
      responsiveMetrics.layoutScale,
      wheelState.offset,
    )
    const currentProgress = clampProgress(
      clampDragOffset(pendingDragOffset.current) / dragLimit,
    )
    pendingDragOffset.current = currentProgress * dragLimit
    setDragOffset(pendingDragOffset.current)
    const trackpadTargetProgress = wheelState.axis === 'x'
      ? wheelState.snapTargetProgress
      : undefined
    startProjectDragRelease(
      currentProgress,
      dragLimit,
      wheelState.velocityX,
      trackpadTargetProgress,
    )
  }

  projectWheelHandlerRef.current = handleProjectStageWheel

  useEffect(() => {
    const stage = currentView === 'gallery'
      ? projectStageRef.current
      : currentView === 'video-library'
        ? clipGridRef.current
        : null
    if (!stage) return

    const listener = (event: WheelEvent) => {
      if (currentView === 'gallery') projectWheelHandlerRef.current(event)
      else clipWheelHandlerRef.current(event)
    }
    const wheelState = currentView === 'gallery'
      ? projectWheelDragRef.current
      : clipWheelDragRef.current
    window.addEventListener('wheel', listener, { capture: true, passive: false })
    return () => {
      window.removeEventListener('wheel', listener, { capture: true })
      if (currentView === 'gallery') {
        cancelProjectWheelPreview()
        if (projectWheelReleaseTimer.current !== undefined) {
          window.clearTimeout(projectWheelReleaseTimer.current)
          projectWheelReleaseTimer.current = undefined
        }
        if (projectWheelStepReleaseTimer.current !== undefined) {
          window.clearTimeout(projectWheelStepReleaseTimer.current)
          projectWheelStepReleaseTimer.current = undefined
        }
        projectWheelStepGestureActiveRef.current = false
      } else {
        cancelClipWheelPreview()
        if (clipWheelReleaseTimer.current !== undefined) {
          window.clearTimeout(clipWheelReleaseTimer.current)
          clipWheelReleaseTimer.current = undefined
        }
      }
      wheelState.active = false
    }
  }, [currentView])

  function handleStagePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const state = dragState.current
    if (!state.active || state.pointerId !== event.pointerId) return

    let deltaX = event.clientX - state.startX
    const deltaY = event.clientY - state.startY
    if (!state.dragging && Math.abs(deltaX) < 6) return
    if (!state.dragging && Math.abs(deltaY) > Math.abs(deltaX) * 1.15) return

    const now = performance.now()
    const elapsed = Math.max(16, now - state.lastTime)
    state.velocityX = (event.clientX - state.lastX) / elapsed
    state.lastX = event.clientX
    state.lastTime = now
    state.dragging = true
    suppressNextClick.current = true
    setIsDragging(true)
    if (projects.length > 1) {
      let dragLimit = getProjectDragLimit(responsiveMetrics.layoutScale, deltaX)
      let didCycle = false
      while (deltaX <= -dragLimit) {
        moveProject(1)
        state.startX -= dragLimit
        deltaX += dragLimit
        didCycle = true
        dragLimit = getProjectDragLimit(responsiveMetrics.layoutScale, deltaX)
      }
      while (deltaX >= dragLimit) {
        moveProject(-1)
        state.startX += dragLimit
        deltaX -= dragLimit
        didCycle = true
        dragLimit = getProjectDragLimit(responsiveMetrics.layoutScale, deltaX)
      }
      if (didCycle) state.velocityX = 0
    }
    scheduleDragOffset(deltaX)
    event.preventDefault()
  }

  function startProjectDragRelease(
    currentProgress: number,
    dragLimit: number,
    effectiveVelocity: number,
    forcedTargetProgress?: number,
  ) {
    const velocityProgress = projects.length <= 1 ? 0 : effectiveVelocity * 0.78
    const projectedProgress = clampProgress(currentProgress + velocityProgress)
    const canCycle = projects.length > 1
    const resolvedTargetProgress = forcedTargetProgress === undefined
      ? projectedProgress < -0.48
        ? -1
        : projectedProgress > 0.48
          ? 1
          : 0
      : clampProgress(forcedTargetProgress)
    const targetProgress = canCycle ? resolvedTargetProgress : 0
    const shouldMoveNext = canCycle && targetProgress < 0
    const shouldMovePrevious = canCycle && targetProgress > 0
    const remainingProgress = Math.abs(targetProgress - currentProgress)
    const speed = Math.abs(effectiveVelocity)
    const duration = Math.round(
      Math.max(300, Math.min(620, remainingProgress * 520 + 180 - speed * 80)),
    )
    const releaseStartOffset = currentProgress * dragLimit
    const releaseTargetOffset = targetProgress * dragLimit

    setIsDragging(false)
    setIsReleasing(true)
    setReleaseSource('drag')
    setReleaseStepDelta(shouldMoveNext ? 1 : shouldMovePrevious ? -1 : 0)
    setReleaseDuration(duration)
    pendingDragOffset.current = releaseStartOffset
    setDragOffset(releaseStartOffset)
    dragRaf.current = window.requestAnimationFrame(() => {
      dragRaf.current = undefined
      pendingDragOffset.current = releaseTargetOffset
      setDragOffset(releaseTargetOffset)

      function finishRelease() {
        if (shouldMoveNext) moveProject(1)
        if (shouldMovePrevious) moveProject(-1)
        setIsRecycling(true)
        setIsReleasing(false)
        setReleaseSource(null)
        setReleaseStepDelta(0)
        pendingDragOffset.current = 0
        projectWheelDragRef.current.offset = 0
        setDragOffset(0)
        suppressNextClick.current = false
        releaseTimer.current = undefined
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setIsRecycling(false))
        })
      }

      releaseTimer.current = window.setTimeout(
        finishRelease,
        duration + PROJECT_RELEASE_SETTLE_PADDING,
      )
    })
  }

  function finishStageDrag(event: ReactPointerEvent<HTMLElement>, shouldCommit: boolean) {
    const state = dragState.current
    if (!state.active || state.pointerId !== event.pointerId) return

    const deltaX = event.clientX - state.startX
    const deltaY = event.clientY - state.startY
    const dragLimit = getProjectDragLimit(responsiveMetrics.layoutScale, deltaX)
    const currentProgress = clampProgress(clampDragOffset(deltaX) / dragLimit)
    const velocityAge = performance.now() - state.lastTime
    const effectiveVelocity = velocityAge <= 90 ? state.velocityX : 0
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (dragRaf.current !== undefined) {
      window.cancelAnimationFrame(dragRaf.current)
      dragRaf.current = undefined
    }

    if (
      shouldCommit &&
      !state.dragging &&
      Math.hypot(deltaX, deltaY) <= 6 &&
      state.projectIndex >= 0
    ) {
      state.active = false
      setIsDragging(false)
      setReleaseSource(null)
      setReleaseStepDelta(0)
      pendingDragOffset.current = 0
      setDragOffset(0)
      suppressNextClick.current = true
      if (state.cardActive) {
        openProjectDetails(state.projectIndex)
      } else {
        const cardOffset = Number.isFinite(state.cardOffset) ? state.cardOffset : 0
        const stepDelta = Math.sign(cardOffset)
        if (stepDelta !== 0) animateProjectStep(stepDelta)
      }
      window.setTimeout(() => {
        suppressNextClick.current = false
      }, 0)
      return
    }

    if (shouldCommit && state.dragging) {
      state.active = false
      startProjectDragRelease(currentProgress, dragLimit, effectiveVelocity)
      return
    }

    state.active = false
    setIsDragging(false)
    setReleaseSource(null)
    setReleaseStepDelta(0)
    pendingDragOffset.current = 0
    setDragOffset(0)
    suppressNextClick.current = false
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const projectOverlayOpen =
        createOpen ||
        emptyProjectPromptId !== null ||
        projectMenu !== null ||
        projectDeleteDialogId !== null ||
        clipMenuId !== null ||
        clipAddDialogId !== null ||
        clipRemoveDialogId !== null ||
        clipTagEditorId !== null ||
        clipNoteEditorId !== null ||
        clipAiMetadataDialog !== null
      if (
        currentView === 'gallery' &&
        !projectOverlayOpen &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        event.key === 'ArrowLeft'
      ) {
        animateProjectStep(-1)
      }
      if (
        currentView === 'gallery' &&
        !projectOverlayOpen &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        event.key === 'ArrowRight'
      ) {
        animateProjectStep(1)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setCreateOpen(false)
        setProjectMenu(null)
        setProjectMenuDraftName('')
        setProjectMenuDraftSubtitle('')
        setProjectDeleteDialogId(null)
        setHoveredProjectCardKey(null)
        setEmptyProjectPromptId(null)
        setSettingsPanelOpen(false)
        setClipMenuId(null)
        if (clipAddDialogId !== null) closeClipAddDialog()
        setClipRemoveDialogId(null)
        setClipTagEditorId(null)
        setClipTagDraft('')
        setClipTagEditorStatus('')
        setClipNoteEditorId(null)
        setClipNoteDraft('')
        clipAiMetadataRequestVersionRef.current += 1
        setClipAiMetadataDialog(null)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (projectOverlayOpen) return
        event.preventDefault()
        setSettingsPanelOpen(false)
        setProjectMenu(null)
        setHoveredProjectCardKey(null)
        setSearchOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    animateProjectStep,
    clipAddDialogId,
    clipAiMetadataDialog,
    clipMenuId,
    clipNoteEditorId,
    clipRemoveDialogId,
    clipTagEditorId,
    createOpen,
    currentView,
    emptyProjectPromptId,
    projectMenu,
    projectDeleteDialogId,
  ])

  useEffect(() => {
    if (!settingsPanelOpen) return

    function handleSettingsOutsidePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      if (
        target.closest('#page-settings-panel') ||
        target.closest('[data-page-settings-toggle="true"]')
      ) {
        return
      }
      setSettingsPanelOpen(false)
    }

    document.addEventListener('pointerdown', handleSettingsOutsidePointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', handleSettingsOutsidePointerDown, true)
  }, [settingsPanelOpen])

  useEffect(() => {
    if (!openClipFilterMenu) return

    function closeClipFilterMenu(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
      } else {
        const target = event.target
        if (
          target instanceof Node &&
          videoLibraryToolbarRef.current?.contains(target)
        ) {
          return
        }
      }
      setOpenClipFilterMenu(null)
    }

    document.addEventListener('pointerdown', closeClipFilterMenu, true)
    window.addEventListener('keydown', closeClipFilterMenu)
    return () => {
      document.removeEventListener('pointerdown', closeClipFilterMenu, true)
      window.removeEventListener('keydown', closeClipFilterMenu)
    }
  }, [openClipFilterMenu])

  useEffect(() => {
    setClipFilters({ ...DEFAULT_CLIP_FILTER_STATE })
    setOpenClipFilterMenu(null)
  }, [selectedProject.id])

  useEffect(() => {
    if (!settingsPanelOpen) setSettingsPanelMode('visual')
  }, [settingsPanelOpen])

  useEffect(() => {
    setSettingsPanelMode('visual')
    setAccountCenterOpen(false)
  }, [currentView])

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth)
      setViewportHeight(window.innerHeight)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useLayoutEffect(() => {
    resetCameraPose()
  }, [currentView, resetCameraPose])

  useEffect(() => {
    cancelClipReleaseAnimation()
    if (clipDragRaf.current !== undefined) {
      window.cancelAnimationFrame(clipDragRaf.current)
      clipDragRaf.current = undefined
    }
    pendingClipTrackPosition.current = 0
    pendingClipOverscroll.current = 0
    setClipTrackPosition(0)
    setClipOverscroll(0)
    setIsClipDragging(false)
    setIsClipReleasing(false)
    suppressNextClipClick.current = false
    clearClipHoverScrub()
  }, [clipFilters, query, selectedProject.id])

  useEffect(() => {
    if (currentView !== 'video-library') clearClipHoverScrub()
  }, [currentView])

  useLayoutEffect(() => {
    const glassLayer = clipGlassLayerRef.current
    if (!glassLayer) return

    const cacheValid = videoGlassCacheSignatureRef.current === videoGlassGeometrySignature
    const geometryCacheValid =
      cacheValid &&
      videoGeometrySyncSignatureRef.current === videoGeometrySyncSignature
    glassLayer.dataset.geometrySourceRevision = videoGeometrySyncSignature
    glassLayer.dataset.geometryCacheValid = String(geometryCacheValid)
    if (currentView !== 'video-library') {
      glassLayer.dataset.glassCacheValid = String(cacheValid)
      return
    }
    if (pageTransitionPhase === 'exiting') return

    glassLayer.dataset.glassCacheValid = String(cacheValid)
    if (pageTransitionPhase !== 'idle') return
    if (geometryCacheValid) {
      glassLayer.dataset.geometryReused = 'true'
      return
    }

    let frame: number | undefined
    let sampledFrames = 0
    const maxFrames = isCameraDragging || isClipDragging || isClipReleasing ? 2 : 24
    videoGeometrySyncCountRef.current += 1
    glassLayer.dataset.geometryReused = 'false'
    glassLayer.dataset.geometrySyncCount = String(
      videoGeometrySyncCountRef.current,
    )

    const syncHitTargets = () => {
      const grid = clipGridRef.current
      const hitLayer = clipHitLayerRef.current
      if (!grid || !hitLayer || !glassLayer) return

      const gridRect = grid.getBoundingClientRect()
      const glassLayerRect = glassLayer.getBoundingClientRect()
      const cardsById = new Map<string, HTMLElement>(
        Array.from(grid.querySelectorAll<HTMLElement>('.videoClipCard')).map((card) => [
          card.dataset.clipId ?? '',
          card,
        ] as const),
      )
      const glassesById = new Map<string, HTMLElement>(
        Array.from(
          glassLayer.querySelectorAll<HTMLElement>('.videoClipProjectedGlass'),
        ).map((glass) => [glass.dataset.clipId ?? '', glass] as const),
      )

      hitLayer.querySelectorAll<HTMLElement>('.videoClipHitTarget').forEach((target) => {
        const card = cardsById.get(target.dataset.clipId ?? '')
        const glass = glassesById.get(target.dataset.clipId ?? '')
        if (!card) {
          target.style.visibility = 'hidden'
          target.style.pointerEvents = 'none'
          if (glass) glass.style.visibility = 'hidden'
          return
        }

        const visual = card.querySelector<HTMLElement>('.videoClipVisual')
        const cardRect = (visual ?? card).getBoundingClientRect()
        const cardStyle = getComputedStyle(visual ?? card)
        const opacity = Number.parseFloat(cardStyle.opacity)
        const cardZIndex = getComputedStyle(card).zIndex
        const interactionHidden = target.getAttribute('aria-hidden') === 'true'
        const interactionBlocked = openClipFilterMenu !== null
        target.style.left = `${cardRect.left - gridRect.left}px`
        target.style.top = `${cardRect.top - gridRect.top}px`
        target.style.width = `${cardRect.width}px`
        target.style.height = `${cardRect.height}px`
        target.style.zIndex = cardZIndex
        target.style.visibility = opacity > 0.02 && !interactionHidden ? 'visible' : 'hidden'
        target.style.pointerEvents =
          opacity > 0.02 && !interactionHidden && !interactionBlocked
            ? 'auto'
            : 'none'

        syncProjectedGlass(
          glass,
          Array.from(card.querySelectorAll<HTMLElement>('.videoClipGlassAnchor')),
          glassLayerRect,
          opacity,
          [0, 0, VIDEO_CLIP_INFO_CORNER_RADIUS, VIDEO_CLIP_INFO_CORNER_RADIUS],
        )
      })

      hitLayer
        .querySelectorAll<HTMLElement>('.videoClipMenuHitTarget')
        .forEach((target) => {
          const card = cardsById.get(target.dataset.clipId ?? '')
          const anchor = card?.querySelector<HTMLElement>('.clipStatus')
          if (!card || !anchor) {
            target.style.visibility = 'hidden'
            target.style.pointerEvents = 'none'
            return
          }

          const visual = card.querySelector<HTMLElement>('.videoClipVisual')
          const opacity = Number.parseFloat(
            getComputedStyle(visual ?? card).opacity,
          )
          const anchorRect = anchor.getBoundingClientRect()
          const cardZIndex =
            Number.parseInt(getComputedStyle(card).zIndex, 10) || 0
          const interactionHidden =
            target.getAttribute('aria-hidden') === 'true'
          const targetSize = Math.max(
            anchorRect.width,
            anchorRect.height,
            26 * videoLibraryLayout.cardContentScale,
          )
          const hidden =
            opacity <= 0.02 ||
            interactionHidden ||
            isClipDragging ||
            isClipReleasing ||
            openClipFilterMenu !== null

          target.style.left = `${
            anchorRect.left +
            anchorRect.width / 2 -
            targetSize / 2 -
            gridRect.left
          }px`
          target.style.top = `${
            anchorRect.top +
            anchorRect.height / 2 -
            targetSize / 2 -
            gridRect.top
          }px`
          target.style.width = `${targetSize}px`
          target.style.height = `${targetSize}px`
          target.style.zIndex = String(cardZIndex + 1)
          target.style.visibility = hidden ? 'hidden' : 'visible'
          target.style.pointerEvents = hidden ? 'none' : 'auto'
        })

      const detailPanel = grid.parentElement?.querySelector<HTMLElement>('.clipDetailPanel')
      const detailGlass = glassLayer.querySelector<HTMLElement>('.videoDetailProjectedGlass')
      const detailCornerRadius = detailPanel
        ? detailPanel.offsetWidth * DETAIL_PANEL_CORNER_RADIUS_RATIO
        : 0
      syncProjectedGlass(
        detailGlass,
        detailPanel
          ? Array.from(
              detailPanel.querySelectorAll<HTMLElement>('.detailPanelGlassAnchor'),
            )
          : [],
        glassLayerRect,
        detailPanel ? 1 : 0,
        [detailCornerRadius, detailCornerRadius, detailCornerRadius, detailCornerRadius],
      )

      const emptyState = grid.parentElement?.querySelector<HTMLElement>(
        '.videoProjectEmptyState[data-empty-visible="true"], .videoProjectFilteredEmptyState[data-empty-visible="true"]',
      )
      const emptyGlass = glassLayer.querySelector<HTMLElement>(
        '.videoLibraryEmptyProjectedGlass',
      )
      if (emptyState && emptyGlass) {
        const emptyRect = emptyState.getBoundingClientRect()
        emptyGlass.style.left = `${emptyRect.left - glassLayerRect.left}px`
        emptyGlass.style.top = `${emptyRect.top - glassLayerRect.top}px`
        emptyGlass.style.width = `${emptyRect.width}px`
        emptyGlass.style.height = `${emptyRect.height}px`
        emptyGlass.style.transform = 'none'
      }

      videoGlassCacheSignatureRef.current = videoGlassGeometrySignature
      glassLayer.dataset.glassCacheValid = 'true'

      sampledFrames += 1
      if (sampledFrames < maxFrames) {
        frame = window.requestAnimationFrame(syncHitTargets)
      } else {
        videoGeometrySyncSignatureRef.current = videoGeometrySyncSignature
        glassLayer.dataset.geometryPreparedRevision =
          videoGeometrySyncSignature
        glassLayer.dataset.geometryCacheValid = 'true'
      }
    }

    syncHitTargets()
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [
    cameraPose.pitch,
    cameraPose.yaw,
    clipOverscroll,
    clipTrackPosition,
    clipTrackWindowStart,
    currentView,
    hoveredClipId,
    isCameraDragging,
    isClipDragging,
    isClipReleasing,
    openClipFilterMenu,
    pageTransitionPhase,
    selectedClipId,
    videoLibraryLayout.cardContentScale,
    videoGlassGeometrySignature,
    videoGeometrySyncSignature,
    viewportHeight,
    viewportWidth,
    visibleProjectClips,
  ])

  useEffect(() => {
    const reflectionRequestVersions = reflectionSurfaceRequestVersionsRef.current
    const reflectionAbortControllers = reflectionSurfaceAbortControllersRef.current
    const backgroundObjectUrls = backgroundObjectUrlsRef.current
    const particleObjectUrls = particleObjectUrlsRef.current
    const projectCoverObjectUrls = projectCoverObjectUrlsRef.current
    const modelObjectUrls = modelObjectUrlsRef.current
    const importedMediaFiles = importedMediaFilesRef.current
    appMountedRef.current = true
    return () => {
      appMountedRef.current = false
      particleImportVersionRef.current += 1
      for (const view of Object.keys(
        backgroundImportVersionsRef.current,
      ) as AppView[]) {
        backgroundImportVersionsRef.current[view] += 1
      }
      projectCoverImportVersionsRef.current.forEach((version, projectId) => {
        projectCoverImportVersionsRef.current.set(projectId, version + 1)
      })
      REFLECTION_VIEWS.forEach((view) => {
        reflectionRequestVersions[view] += 1
        reflectionAbortControllers[view]?.abort()
        delete reflectionAbortControllers[view]
      })
      if (releaseTimer.current !== undefined) {
        window.clearTimeout(releaseTimer.current)
      }
      if (dragRaf.current !== undefined) {
        window.cancelAnimationFrame(dragRaf.current)
      }
      if (clipReleaseRaf.current !== undefined) {
        window.cancelAnimationFrame(clipReleaseRaf.current)
      }
      if (clipDragRaf.current !== undefined) {
        window.cancelAnimationFrame(clipDragRaf.current)
      }
      if (projectWheelReleaseTimer.current !== undefined) {
        window.clearTimeout(projectWheelReleaseTimer.current)
      }
      if (projectWheelStepReleaseTimer.current !== undefined) {
        window.clearTimeout(projectWheelStepReleaseTimer.current)
      }
      if (clipWheelReleaseTimer.current !== undefined) {
        window.clearTimeout(clipWheelReleaseTimer.current)
      }
      if (pageTransitionExitTimer.current !== undefined) {
        window.clearTimeout(pageTransitionExitTimer.current)
      }
      if (pageTransitionEnterTimer.current !== undefined) {
        window.clearTimeout(pageTransitionEnterTimer.current)
      }
      if (clipActionNoticeTimerRef.current !== undefined) {
        window.clearTimeout(clipActionNoticeTimerRef.current)
      }
      if (projectImportProgressTimerRef.current !== undefined) {
        window.clearTimeout(projectImportProgressTimerRef.current)
      }
      Object.values(reflectionSurfaceNoticeTimersRef.current).forEach((timer) => {
        if (timer !== undefined) window.clearTimeout(timer)
      })
      reflectionSurfaceNoticeTimersRef.current = {}
      disposeBackgroundReflectionSurfaceWorker()
      backgroundObjectUrls.forEach((url) => URL.revokeObjectURL(url))
      backgroundObjectUrls.clear()
      particleObjectUrls.forEach((url) => URL.revokeObjectURL(url))
      particleObjectUrls.clear()
      projectCoverObjectUrls.forEach((url) => URL.revokeObjectURL(url))
      projectCoverObjectUrls.clear()
      modelObjectUrls.forEach((url) => URL.revokeObjectURL(url))
      modelObjectUrls.clear()
      importedMediaFiles.clear()
      pageTransitionActiveRef.current = false
    }
  }, [])

  function updateCurrentPageSettings(patch: Partial<PageVisualSettings>) {
    setPageSettings((current) => ({
      ...current,
      [currentView]: {
        ...current[currentView],
        ...patch,
      },
    }))
  }

  function updateCurrentPageParticles(
    patch: Partial<PageVisualSettings['particles']>,
  ) {
    if (patch.shape && patch.shape !== 'custom') {
      particleImportVersionRef.current += 1
      setParticleImportState({ status: 'idle', message: null })
    }
    setPageSettings((current) => ({
      ...current,
      [currentView]: {
        ...current[currentView],
        particles: {
          ...current[currentView].particles,
          ...patch,
        },
      },
    }))
  }

  function releaseBackgroundUrl(url: string | undefined) {
    if (!url || !backgroundObjectUrlsRef.current.has(url)) return
    URL.revokeObjectURL(url)
    backgroundObjectUrlsRef.current.delete(url)
  }

  function releaseBackgroundMediaAfterPaint(
    background: PageBackgroundMedia | undefined,
  ) {
    if (!background) return
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        releaseBackgroundUrl(background.url)
        if (background.managedPath) {
          pendingAppearanceVisualCleanupRef.current.add(
            background.managedPath,
          )
        }
      })
    })
  }

  function releaseParticleObjectUrl(url: string | undefined) {
    if (!url || !particleObjectUrlsRef.current.has(url)) return
    URL.revokeObjectURL(url)
    particleObjectUrlsRef.current.delete(url)
  }

  function releaseParticleMedia(media: CustomParticleMedia | null | undefined) {
    if (!media) return
    releaseParticleObjectUrl(media.url)
    if (media.managedPath) {
      void window.desktopBridge
        ?.removeParticleAsset(media.managedPath)
        .catch((error) => {
          console.warn('[Aurora particles] Failed to remove managed asset', error)
        })
    }
  }

  function releaseParticleMediaAfterPaint(
    media: CustomParticleMedia | null | undefined,
  ) {
    if (!media) return
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        releaseParticleObjectUrl(media.url)
        if (media.managedPath) {
          pendingAppearanceParticleCleanupRef.current.add(media.managedPath)
        }
      })
    })
  }

  function formatParticleImportError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const normalized = message.toLocaleLowerCase()
    if (normalized.includes('ffmpeg') || normalized.includes('ffprobe')) {
      return '透明视频处理组件不可用，请检查 FFmpeg 安装。'
    }
    if (normalized.includes('alpha') || normalized.includes('transparen')) {
      return '素材未检测到可用的透明通道。'
    }
    if (
      normalized.includes('exceed') ||
      normalized.includes('1024') ||
      normalized.includes('200 mib') ||
      normalized.includes('20 mib') ||
      normalized.includes('10 seconds')
    ) {
      return '素材超过粒子导入的大小、尺寸或时长限制。'
    }
    if (
      normalized.includes('unsupported') ||
      normalized.includes('must be') ||
      normalized.includes('decode') ||
      normalized.includes('invalid')
    ) {
      return '无法读取该素材，请使用透明 PNG、WebM 或 MOV。'
    }
    return message || '粒子素材导入失败。'
  }

  async function handleParticleFileChange(
    event: ReactChangeEvent<HTMLInputElement>,
  ) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    const lowerName = file.name.toLocaleLowerCase()
    const isSupported =
      lowerName.endsWith('.png') ||
      lowerName.endsWith('.webm') ||
      lowerName.endsWith('.mov')
    if (!isSupported) {
      setParticleImportState({
        status: 'error',
        message: '仅支持透明 PNG、WebM 或 MOV 粒子素材。',
      })
      return
    }

    const requestVersion = particleImportVersionRef.current + 1
    particleImportVersionRef.current = requestVersion
    setParticleImportState({
      status: 'validating',
      message: lowerName.endsWith('.png')
        ? '正在检查透明 PNG…'
        : '正在规范化透明视频…',
    })

    let nextMedia: CustomParticleMedia | null = null
    let browserObjectUrl: string | null = null
    try {
      const bridge = window.desktopBridge
      if (bridge?.importParticleAsset) {
        const imported = await bridge.importParticleAsset(file)
        const url = bridge.getMediaUrl(imported.managedPath)
        const posterUrl = imported.posterPath
          ? bridge.getMediaUrl(imported.posterPath)
          : url
        if (!url || !posterUrl) {
          await bridge.removeParticleAsset(imported.managedPath)
          throw new Error('无法创建受管粒子素材地址')
        }
        nextMedia = {
          ...imported,
          url,
          posterUrl,
        }
      } else {
        browserObjectUrl = URL.createObjectURL(file)
        particleObjectUrlsRef.current.add(browserObjectUrl)
        nextMedia = await validateParticleMediaInBrowser(file, browserObjectUrl)
      }

      if (
        !appMountedRef.current ||
        particleImportVersionRef.current !== requestVersion
      ) {
        releaseParticleMedia(nextMedia)
        return
      }

      const previousMedia = pageSettings.gallery.particles.customMedia
      setPageSettings((current) => ({
        ...current,
        gallery: {
          ...current.gallery,
          particles: {
            ...current.gallery.particles,
            shape: 'custom',
            customMedia: nextMedia,
          },
        },
      }))
      setParticleImportState({ status: 'idle', message: null })
      if (previousMedia?.url !== nextMedia.url) {
        releaseParticleMediaAfterPaint(previousMedia)
      }
    } catch (error) {
      if (browserObjectUrl) releaseParticleObjectUrl(browserObjectUrl)
      if (particleImportVersionRef.current !== requestVersion) return
      setParticleImportState({
        status: 'error',
        message: formatParticleImportError(error),
      })
    }
  }

  function removeCustomParticleMedia() {
    particleImportVersionRef.current += 1
    const previousMedia = pageSettings.gallery.particles.customMedia
    setPageSettings((current) => ({
      ...current,
      gallery: {
        ...current.gallery,
        particles: {
          ...current.gallery.particles,
          shape:
            current.gallery.particles.shape === 'custom'
              ? 'dot'
              : current.gallery.particles.shape,
          customMedia: null,
        },
      },
    }))
    setParticleImportState({ status: 'idle', message: null })
    releaseParticleMediaAfterPaint(previousMedia)
  }

  function clearReflectionSurfaceNoticeTimer(view: ReflectionView) {
    const timer = reflectionSurfaceNoticeTimersRef.current[view]
    if (timer !== undefined) window.clearTimeout(timer)
    delete reflectionSurfaceNoticeTimersRef.current[view]
  }

  function resetReflectionSurface(view: AppView) {
    if (!isReflectionView(view)) return
    reflectionSurfaceAbortControllersRef.current[view]?.abort()
    delete reflectionSurfaceAbortControllersRef.current[view]
    reflectionSurfaceRequestVersionsRef.current[view] += 1
    clearReflectionSurfaceNoticeTimer(view)
    setReflectionSurfaces((current) => ({ ...current, [view]: null }))
    setReflectionSurfaceNotices((current) => ({ ...current, [view]: null }))
  }

  function generateReflectionSurfaceForBackground(
    view: AppView,
    source: File | NonNullable<PageBackgroundMedia>,
    kind: BackgroundReflectionMediaKind,
  ) {
    if (!isReflectionView(view)) return
    reflectionSurfaceAbortControllersRef.current[view]?.abort()
    const abortController = new AbortController()
    reflectionSurfaceAbortControllersRef.current[view] = abortController
    const requestVersion = reflectionSurfaceRequestVersionsRef.current[view] + 1
    reflectionSurfaceRequestVersionsRef.current[view] = requestVersion
    clearReflectionSurfaceNoticeTimer(view)
    setReflectionSurfaces((current) => ({ ...current, [view]: null }))
    setReflectionSurfaceNotices((current) => ({ ...current, [view]: null }))

    reflectionSurfaceNoticeTimersRef.current[view] = window.setTimeout(() => {
      if (
        !appMountedRef.current ||
        abortController.signal.aborted ||
        reflectionSurfaceRequestVersionsRef.current[view] !== requestVersion
      ) return
      setReflectionSurfaceNotices((current) => ({
        ...current,
        [view]: {
          state: 'generating',
          message: '正在根据新背景生成倒影纹理…',
        },
      }))
    }, 150)

    const surfacePromise = source instanceof File
      ? createBackgroundReflectionSurface(source, kind, {
          signal: abortController.signal,
        })
      : createBackgroundReflectionSurfaceFromUrl(
          {
            url: source.url,
            name: source.name,
            cacheKey: source.managedPath ?? source.url,
          },
          kind,
          { signal: abortController.signal },
        )

    void surfacePromise.then((surface) => {
      if (
        !appMountedRef.current ||
        abortController.signal.aborted ||
        reflectionSurfaceRequestVersionsRef.current[view] !== requestVersion
      ) return
      clearReflectionSurfaceNoticeTimer(view)
      setReflectionSurfaces((current) => ({ ...current, [view]: surface }))
      setReflectionSurfaceNotices((current) => ({ ...current, [view]: null }))
    }).catch((error) => {
      const requestIsCurrent =
        appMountedRef.current &&
        reflectionSurfaceAbortControllersRef.current[view] === abortController &&
        reflectionSurfaceRequestVersionsRef.current[view] === requestVersion
      if (isBackgroundReflectionSurfaceAbortError(error)) {
        if (requestIsCurrent) {
          clearReflectionSurfaceNoticeTimer(view)
          setReflectionSurfaceNotices((current) => ({ ...current, [view]: null }))
        }
        return
      }
      if (
        !requestIsCurrent ||
        abortController.signal.aborted
      ) return
      clearReflectionSurfaceNoticeTimer(view)
      console.warn('[Aurora reflection] Background surface generation failed', error)
      setReflectionSurfaces((current) => ({ ...current, [view]: null }))
      setReflectionSurfaceNotices((current) => ({
        ...current,
        [view]: {
          state: 'fallback',
          message: '未能生成倒影纹理，已继续使用默认效果',
        },
      }))
      reflectionSurfaceNoticeTimersRef.current[view] = window.setTimeout(() => {
        if (
          !appMountedRef.current ||
          abortController.signal.aborted ||
          reflectionSurfaceRequestVersionsRef.current[view] !== requestVersion
        ) return
        setReflectionSurfaceNotices((current) => ({ ...current, [view]: null }))
        delete reflectionSurfaceNoticeTimersRef.current[view]
      }, 2800)
    }).finally(() => {
      if (reflectionSurfaceAbortControllersRef.current[view] === abortController) {
        delete reflectionSurfaceAbortControllersRef.current[view]
      }
    })
  }

  async function handleBackgroundFileChange(
    event: ReactChangeEvent<HTMLInputElement>,
  ) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    const isVideo = /\.(mp4|m4v|mov|webm)$/i.test(file.name)
    const isImage = /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name)
    if (!isVideo && !isImage) return

    const targetView = currentView
    const requestVersion = backgroundImportVersionsRef.current[targetView] + 1
    backgroundImportVersionsRef.current[targetView] = requestVersion
    const backgroundKind: BackgroundReflectionMediaKind = isVideo ? 'video' : 'image'
    const previousBackground = pageSettings[targetView].background
    const bridge = window.desktopBridge

    try {
      let nextBackground: NonNullable<PageBackgroundMedia>
      if (bridge?.importVisualAsset) {
        const imported = await bridge.importVisualAsset(file, 'page-background')
        const url = bridge.getMediaUrl(imported.managedPath)
        if (!url) {
          await bridge.removeVisualAsset(imported.managedPath).catch(() => undefined)
          throw new Error('无法读取已导入的页面背景。')
        }
        nextBackground = {
          kind: imported.kind,
          name: imported.name,
          url,
          managedPath: imported.managedPath,
        }
      } else {
        const objectUrl = URL.createObjectURL(file)
        backgroundObjectUrlsRef.current.add(objectUrl)
        nextBackground = {
          kind: backgroundKind,
          name: file.name,
          url: objectUrl,
          managedPath: null,
        }
      }

      if (
        !appMountedRef.current ||
        backgroundImportVersionsRef.current[targetView] !== requestVersion
      ) {
        if (nextBackground.managedPath) {
          await bridge?.removeVisualAsset(nextBackground.managedPath).catch(
            () => undefined,
          )
        } else {
          releaseBackgroundUrl(nextBackground.url)
        }
        return
      }

      setPageSettings((current) => ({
        ...current,
        [targetView]: {
          ...current[targetView],
          background: nextBackground,
        },
      }))
      releaseBackgroundMediaAfterPaint(previousBackground)
      generateReflectionSurfaceForBackground(
        targetView,
        file,
        nextBackground.kind,
      )
    } catch (error) {
      if (
        !appMountedRef.current ||
        backgroundImportVersionsRef.current[targetView] !== requestVersion
      ) return
      console.warn('[Aurora appearance] Failed to import page background', error)
      showClipActionNotice(
        error instanceof Error && error.message.trim()
          ? error.message
          : '页面背景导入失败，请检查文件格式与大小。',
      )
    }
  }

  function resetCurrentPageBackground() {
    backgroundImportVersionsRef.current[currentView] += 1
    releaseBackgroundMediaAfterPaint(pageSettings[currentView].background)
    resetReflectionSurface(currentView)
    updateCurrentPageSettings({ background: null })
  }

  function resetCurrentPageSettings() {
    backgroundImportVersionsRef.current[currentView] += 1
    releaseBackgroundMediaAfterPaint(pageSettings[currentView].background)
    if (currentView === 'gallery') {
      particleImportVersionRef.current += 1
      releaseParticleMediaAfterPaint(
        pageSettings.gallery.particles.customMedia,
      )
      setParticleImportState({ status: 'idle', message: null })
    }
    resetReflectionSurface(currentView)
    setPageSettings((current) => ({
      ...current,
      [currentView]: createDefaultVisualSettings(),
    }))
  }

  async function selectAiServiceProfile(
    kind: AiServiceKind,
    profileId: string | null,
  ) {
    const bridge = window.desktopBridge
    if (!bridge?.selectAiServiceProfile) {
      throw new Error('请在 Aurora 桌面版中管理 AI 模型服务')
    }

    const result = await bridge.selectAiServiceProfile(kind, profileId)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    setAiServiceProfilesState(result.data)
    setAiProviderProfilesError(null)
    if (
      !result.data.activeVisionProfileId ||
      !result.data.activeEmbeddingProfileId
    ) {
      setAiSearchMode(false)
    }
  }

  async function testAiServiceProfile(
    kind: AiServiceKind,
    input: AiServiceProfileInput,
  ): Promise<AiServiceConnectionTestResult> {
    const bridge = window.desktopBridge
    if (!bridge?.testAiServiceProfile) {
      throw new Error('请在 Aurora 桌面版中测试 AI 模型服务')
    }

    const result = await bridge.testAiServiceProfile(kind, input)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }

  async function saveAiServiceProfile(
    kind: AiServiceKind,
    input: AiServiceProfileInput,
  ) {
    const bridge = window.desktopBridge
    if (!bridge?.saveAiServiceProfile) {
      throw new Error('请在 Aurora 桌面版中保存 AI 模型服务')
    }

    const result = await bridge.saveAiServiceProfile(kind, input)
    if (!result.ok) throw new Error(result.error.message)
    setAiServiceProfilesState(result.data.state)
    setAiProviderProfilesError(null)
  }

  async function deleteAiServiceProfile(
    kind: AiServiceKind,
    profileId: string,
  ) {
    const bridge = window.desktopBridge
    if (!bridge?.deleteAiServiceProfile) {
      throw new Error('请在 Aurora 桌面版中管理 AI 模型服务')
    }

    const result = await bridge.deleteAiServiceProfile(kind, profileId)
    if (!result.ok) throw new Error(result.error.message)
    setAiServiceProfilesState(result.data)
    setAiProviderProfilesError(null)
    if (
      !result.data.activeVisionProfileId ||
      !result.data.activeEmbeddingProfileId
    ) {
      setAiSearchMode(false)
    }
  }

  async function detectAiLocalModels(): Promise<AiLocalModelDetectionResult> {
    const bridge = window.desktopBridge
    if (!bridge?.detectAiLocalModels) {
      return { services: [] }
    }

    const result = await bridge.detectAiLocalModels()
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }

  function openAiSearchSettings() {
    setSettingsPanelMode('visual')
    setSettingsPanelOpen(true)
  }

  async function searchAiDiscovery(
    request: DiscoveryAiSearchRequest,
  ): Promise<readonly DiscoveryResult[]> {
    if (!request.sources.includes('local') || request.kind === 'model') {
      return []
    }

    const bridge = window.desktopBridge
    if (!bridge?.searchAiVisualFrames) {
      throw new Error('AI 画面搜索仅可在 Aurora 桌面版中使用')
    }
    const visionProfileId = aiServiceProfilesState.activeVisionProfileId
    const embeddingProfileId = aiServiceProfilesState.activeEmbeddingProfileId
    if (!visionProfileId || !embeddingProfileId) {
      throw new Error('请先在探索页设置中分别选择画面理解与语义检索服务')
    }

    const filteredCandidates = aiVisualFrameCandidates.filter((candidate) => {
      const result = aiDiscoveryVisualResultsById.get(candidate.resultId)
      return Boolean(
        result &&
          (request.resolution === 'all' ||
            result.resolutionLabel === request.resolution),
      )
    })
    if (filteredCandidates.length === 0) return []

    const serviceResultLimit = request.kind === 'clip'
      ? Math.min(100, Math.max(request.limit, request.limit * 3))
      : request.limit
    const runVisualSearch = async (
      candidates: readonly AiVisualFrameCandidate[],
      limit: number,
    ) => {
      const response = await bridge.searchAiVisualFrames({
        query: request.query,
        candidates: [...candidates],
        limit,
        visionProfileId,
        embeddingProfileId,
      })
      if (response.ok) return response.data

      throw new Error(response.error.message)
    }

    // Build a durable coarse semantic index first, then inspect nearby frames
    // around its strongest matches. This keeps a large library searchable on
    // the first request without uploading every densely sampled index frame.
    const coarseCandidates = createCoarseAiVisualCandidates(filteredCandidates)
    const coarseResponse = await runVisualSearch(
      coarseCandidates,
      Math.min(100, Math.max(serviceResultLimit, request.limit * 3)),
    )
    const refinedCandidates = createRefinedAiVisualCandidates(
      filteredCandidates,
      coarseCandidates,
      coarseResponse.matches,
    )
    const searchResponse = refinedCandidates.length > coarseCandidates.length
      ? await runVisualSearch(refinedCandidates, serviceResultLimit)
      : coarseResponse

    const matchedFrames = searchResponse.matches.flatMap((match) => {
      const result = aiDiscoveryVisualResultsById.get(match.resultId)
      if (!result) return []
      return [{
        ...result,
        description: match.reason || result.description,
        searchTerms: [
          ...(result.searchTerms ?? []),
          match.descriptionZh,
          match.descriptionEn,
          ...match.keywords,
        ],
        footage: {
          ...result.footage,
          auroraTimeSeconds: match.timeSeconds,
        },
      } satisfies DiscoveryFootageResult]
    })

    if (request.kind !== 'clip') {
      return matchedFrames.slice(0, request.limit)
    }

    const localResultsById = new Map(
      localDiscoveryResults.map((result) => [result.id, result]),
    )
    const seenClipIds = new Set<string>()
    return matchedFrames.flatMap((frame) => {
      const clipId = frame.footage.auroraClipId
      if (!clipId || seenClipIds.has(clipId)) return []
      const clipResult = localResultsById.get(`local:clip:${clipId}`)
      if (!clipResult || clipResult.detailType !== 'footage') return []
      seenClipIds.add(clipId)
      return [{
        ...clipResult,
        thumbnail: frame.thumbnail,
        description: frame.description,
        previewProgress: frame.previewProgress,
        footage: frame.footage,
      } satisfies DiscoveryFootageResult]
    }).slice(0, request.limit)
  }

  function releaseProjectCoverUrl(url: string | undefined) {
    if (!url || !projectCoverObjectUrlsRef.current.has(url)) return
    URL.revokeObjectURL(url)
    projectCoverObjectUrlsRef.current.delete(url)
  }

  function releaseProjectCoverAfterPaint(
    cover: ProjectCoverOverride | null | undefined,
  ) {
    if (!cover) return
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        releaseProjectCoverUrl(cover.url)
        if (cover.managedPath) {
          pendingLibraryVisualCleanupRef.current.add(cover.managedPath)
        }
      })
    })
  }

  function updateSelectedProjectName(title: string) {
    const projectId = selectedProject.id
    setProjectCustomizations((current) => ({
      ...current,
      [projectId]: {
        ...current[projectId],
        title,
      },
    }))
  }

  function resetSelectedProjectName() {
    updateSelectedProjectName(selectedBaseProject.title)
  }

  function updateSelectedProjectSubtitle(subtitle: string) {
    const projectId = selectedProject.id
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId ? { ...project, subtitle } : project,
      ),
    )
  }

  function updateSelectedProjectDescription(description: string) {
    const projectId = selectedProject.id
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId ? { ...project, description } : project,
      ),
    )
  }

  function resetSelectedProjectDescription() {
    updateSelectedProjectDescription(
      getDefaultProjectDescription(selectedProject.kind),
    )
  }

  function openProjectCoverPicker(projectId: string) {
    projectCoverTargetIdRef.current = projectId
    projectCoverFileInputRef.current?.click()
  }

  async function handleProjectCoverFileChange(
    event: ReactChangeEvent<HTMLInputElement>,
  ) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    const isImage = /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name)
    if (!isImage) return

    const projectId =
      projectCoverTargetIdRef.current ?? selectedProject.id
    projectCoverTargetIdRef.current = null
    const baseProject = projects.find((project) => project.id === projectId)
    if (!baseProject) return
    const requestVersion =
      (projectCoverImportVersionsRef.current.get(projectId) ?? 0) + 1
    projectCoverImportVersionsRef.current.set(projectId, requestVersion)
    const previousCover = projectCustomizations[projectId]?.cover
    const bridge = window.desktopBridge

    try {
      let nextCover: ProjectCoverOverride
      if (bridge?.importVisualAsset) {
        const imported = await bridge.importVisualAsset(file, 'project-cover')
        const url = bridge.getMediaUrl(imported.managedPath)
        if (!url) {
          await bridge.removeVisualAsset(imported.managedPath).catch(() => undefined)
          throw new Error('无法读取已导入的项目封面。')
        }
        nextCover = {
          name: imported.name,
          url,
          managedPath: imported.managedPath,
        }
      } else {
        const objectUrl = URL.createObjectURL(file)
        projectCoverObjectUrlsRef.current.add(objectUrl)
        nextCover = {
          name: file.name,
          url: objectUrl,
          managedPath: null,
        }
      }


      if (
        !appMountedRef.current ||
        projectCoverImportVersionsRef.current.get(projectId) !== requestVersion ||
        !projectsRef.current.some((project) => project.id === projectId)
      ) {
        if (nextCover.managedPath) {
          await bridge?.removeVisualAsset(nextCover.managedPath).catch(
            () => undefined,
          )
        } else {
          releaseProjectCoverUrl(nextCover.url)
        }
        return
      }

      setProjectCustomizations((current) => ({
        ...current,
        [projectId]: {
          title: current[projectId]?.title ?? baseProject.title,
          cover: nextCover,
        },
      }))
      releaseProjectCoverAfterPaint(previousCover)
    } catch (error) {
      if (
        !appMountedRef.current ||
        projectCoverImportVersionsRef.current.get(projectId) !== requestVersion
      ) return
      console.warn('[Aurora library] Failed to import project cover', error)
      showClipActionNotice(
        error instanceof Error && error.message.trim()
          ? error.message
          : '项目封面导入失败，请检查图片格式与大小。',
        projectId,
      )
    }
  }

  function resetProjectCover(projectId: string) {
    const baseProject = projects.find((project) => project.id === projectId)
    if (!baseProject) return
    projectCoverImportVersionsRef.current.set(
      projectId,
      (projectCoverImportVersionsRef.current.get(projectId) ?? 0) + 1,
    )
    const previousCover = projectCustomizations[projectId]?.cover
    setProjectCustomizations((current) => ({
      ...current,
      [projectId]: {
        title: current[projectId]?.title ?? baseProject.title,
        cover: null,
      },
    }))
    releaseProjectCoverAfterPaint(previousCover)
  }

  function resetSelectedProjectCover() {
    resetProjectCover(selectedProject.id)
  }

  function openProjectImportPicker(projectId: string) {
    if (projectImportBatchActiveRef.current) {
      showClipActionNotice('当前批次仍在导入，请稍候。')
      return
    }
    projectImportTargetIdRef.current = projectId
    projectImportFileInputRef.current?.click()
  }

  async function prepareExternalVideoAddCandidate(
    descriptor: ExternalVideoFileDescriptor,
  ): Promise<ExternalVideoAddCandidate> {
    const bridge = window.desktopBridge
    if (!bridge?.inspectMediaFile || !bridge.createMediaThumbnail) {
      throw new Error('Aurora desktop media bridge is unavailable')
    }

    // `inspectMediaFile` resolves aliases/symlinks and normalizes platform path
    // casing. Match again with that canonical path so opening an already
    // imported file never creates a second transient asset merely because the
    // path delivered by Finder/Explorer is spelled differently.
    const metadata = await bridge.inspectMediaFile(descriptor.path)
    const metadataFingerprint = getMediaSourceFingerprint(metadata)
    const matchingAssets = mediaAssetsRef.current.filter(
      (asset) =>
        asset.sourcePath === descriptor.path ||
        asset.sourcePath === metadata.filePath ||
        asset.sourceFingerprint === metadataFingerprint,
    )
    const existingAsset =
      matchingAssets.find((asset) =>
        projectAssetRefsRef.current.some(
          (reference) =>
            reference.assetId === asset.id &&
            reference.projectId === selectedProjectId,
        ),
      ) ??
      matchingAssets.find((asset) =>
        projectAssetRefsRef.current.some(
          (reference) => reference.assetId === asset.id,
        ),
      ) ??
      matchingAssets[0]
    const runtimeId = `${Date.now().toString(36)}:${Math.random()
      .toString(36)
      .slice(2, 8)}`
    let asset: MediaAsset = existingAsset
      ? { ...existingAsset }
      : {
          id: `asset:external:${runtimeId}`,
          filename: descriptor.name,
          thumbnail: null,
          duration: '待分析',
          resolution: '待分析',
          fps: '待分析',
          frameCount: '待分析',
          sampleCount: 0,
          size: formatMediaFileSize(descriptor.sizeBytes),
          codec: getImportedCodec(descriptor.name),
          camera: '未写入',
          capturedAt: formatProjectTimestamp(
            Date.parse(descriptor.modifiedAt) || Date.now(),
          ),
          sourceFingerprint: createMediaSourceFingerprint(
            descriptor.path,
            descriptor.sizeBytes,
            descriptor.modifiedAt,
          ),
          sourcePath: descriptor.path,
          favorite: false,
          indexTask: 'idle',
          durationSeconds: null,
          width: null,
          height: null,
          fpsValue: null,
          sizeBytes: descriptor.sizeBytes,
          indexError: null,
        }

    const previousFingerprint = existingAsset?.sourceFingerprint ?? null
    asset = applyMediaFileMetadata(asset, metadata)
    const sourceChanged = Boolean(
      previousFingerprint && previousFingerprint !== asset.sourceFingerprint,
    )
    if (sourceChanged) {
      asset = {
        ...asset,
        thumbnail: null,
        sampleCount: 0,
        indexTask: 'idle',
        indexError: null,
      }
    }
    if (!asset.thumbnail) {
      const thumbnail = await bridge.createMediaThumbnail({
        assetId: getExternalVideoPreviewAssetId({
          path: metadata.filePath,
          name: metadata.filename,
          sizeBytes: metadata.sizeBytes,
          modifiedAt: metadata.modifiedAt,
        }),
        sourcePath: descriptor.path,
        durationSeconds: asset.durationSeconds,
      })
      asset = {
        ...asset,
        thumbnail: thumbnail.thumbnailPath,
        sourceFingerprint: createMediaSourceFingerprint(
          thumbnail.sourcePath,
          thumbnail.sizeBytes,
          thumbnail.modifiedAt,
        ),
      }
    }

    const existingReference = projectAssetRefsRef.current.find(
      (reference) => reference.assetId === asset.id,
    )
    const thumbnail = resolveLibraryMediaUrl(asset.thumbnail)
    const clip: VideoClip = {
      id: `external:${asset.id}`,
      assetId: asset.id,
      projectId: '',
      order: 0,
      filename: asset.filename,
      thumbnail:
        thumbnail || resolveDocumentAssetUrl('./aurora/project-new-frontier.png'),
      duration: asset.duration,
      durationSeconds: asset.durationSeconds,
      resolution: asset.resolution,
      resolutionBadge: getStandardResolutionBadge(
        asset.width,
        asset.height,
        asset.resolution,
      ),
      width: asset.width,
      height: asset.height,
      fps: asset.fps,
      fpsValue: asset.fpsValue,
      frameCount: asset.frameCount,
      sampleCount: asset.sampleCount,
      size:
        asset.sizeBytes !== null
          ? formatMediaFileSize(asset.sizeBytes)
          : asset.size,
      sizeBytes: asset.sizeBytes,
      codec: asset.codec,
      camera: asset.camera,
      capturedAt: asset.capturedAt,
      sourcePath: asset.sourcePath,
      sourceFingerprint: asset.sourceFingerprint,
      sourceUrl: resolveLibraryMediaUrl(asset.sourcePath),
      indexedFrames: [],
      favorite: asset.favorite,
      indexTask: asset.indexTask,
      tags: existingReference?.tags ?? [IMPORTED_CLIP_DEFAULT_TAG],
      annotated: existingReference?.annotated ?? false,
      note:
        existingReference?.note ??
        EXTERNAL_CLIP_DEFAULT_NOTE,
      colorPreset: normalizeMediaColorPresetId(asset.colorPreset),
    }
    return { descriptor, asset, clip, sourceChanged }
  }
  prepareExternalVideoAddCandidateRef.current =
    prepareExternalVideoAddCandidate

  async function importProjectMediaFiles(projectId: string, files: File[]) {
    if (files.length === 0) return
    if (projectImportBatchActiveRef.current) {
      showClipActionNotice('当前批次仍在导入，请稍候。')
      return
    }
    const project = projects.find((entry) => entry.id === projectId)
    if (!project) return

    projectImportBatchActiveRef.current = true
    if (projectImportProgressTimerRef.current !== undefined) {
      window.clearTimeout(projectImportProgressTimerRef.current)
      projectImportProgressTimerRef.current = undefined
    }

    const supportedFiles = files.filter(isSupportedVideoFile)
    const unsupported = files.length - supportedFiles.length
    let duplicate = 0
    let failed = 0
    let processed = unsupported
    const assetsByFingerprint = new Map(
      mediaAssets.map((asset) => [asset.sourceFingerprint, asset]),
    )
    const assetsBySourcePath = new Map(
      mediaAssets.flatMap((asset) =>
        asset.sourcePath ? [[asset.sourcePath, asset] as const] : [],
      ),
    )
    const membershipKeys = new Set(
      projectAssetRefs.map(
        (reference) => `${reference.projectId}:${reference.assetId}`,
      ),
    )
    const newAssets: MediaAsset[] = []
    const newReferences: ProjectAssetRef[] = []
    const inspectionQueue: Array<{
      asset: MediaAsset
      file: File
      refreshMetadata: boolean
      ensureThumbnail: boolean
      sourceChanged: boolean
    }> = []
    const queuedAssetIds = new Set<string>()
    const changedAssetIds = new Set<string>()
    const indexedAssetIds = new Set(
      visualIndexes.flatMap((index) => {
        const asset = mediaAssets.find(
          (entry) => entry.id === index.assetId,
        )
        return asset?.sourceFingerprint === index.sourceFingerprint
          ? [index.assetId]
          : []
      }),
    )
    const projectReferences = projectAssetRefs.filter(
      (reference) => reference.projectId === projectId,
    )
    let nextOrder = getNextProjectAssetOrder(projectId, projectReferences)

    supportedFiles.forEach((file, index) => {
      const imported = createImportedProjectMedia(
        file,
        { ...project, videoCount: nextOrder },
        index,
      )
      const existingAsset =
        (imported.asset.sourcePath
          ? assetsBySourcePath.get(imported.asset.sourcePath)
          : undefined) ??
        assetsByFingerprint.get(imported.asset.sourceFingerprint)
      const asset = existingAsset ?? imported.asset
      const sourceChanged = Boolean(
        existingAsset &&
          imported.asset.sourcePath &&
          !mediaAssetMatchesImportedFile(
            existingAsset,
            file,
            imported.asset.sourcePath,
          ),
      )
      const refreshMetadata =
        !existingAsset ||
        sourceChanged ||
        mediaAssetNeedsInspection(asset)
      const ensureThumbnail =
        !existingAsset ||
        sourceChanged ||
        (!indexedAssetIds.has(asset.id) &&
          (mediaAssetNeedsThumbnail(asset) || Boolean(existingAsset)))
      const enqueueInspection = () => {
        if (
          queuedAssetIds.has(asset.id) ||
          (!refreshMetadata && !ensureThumbnail)
        ) {
          return false
        }
        inspectionQueue.push({
          asset,
          file,
          refreshMetadata,
          ensureThumbnail,
          sourceChanged,
        })
        queuedAssetIds.add(asset.id)
        if (sourceChanged) changedAssetIds.add(asset.id)
        return true
      }
      const membershipKey = `${projectId}:${asset.id}`
      if (membershipKeys.has(membershipKey)) {
        duplicate += 1
        if (!enqueueInspection()) processed += 1
        return
      }

      if (!existingAsset) {
        newAssets.push(asset)
        enqueueInspection()
        assetsByFingerprint.set(asset.sourceFingerprint, asset)
        if (asset.sourcePath) assetsBySourcePath.set(asset.sourcePath, asset)
      } else {
        const queued = enqueueInspection()
        if (!queued && (
          !asset.sourcePath &&
          (asset.durationSeconds === null ||
            asset.width === null ||
            asset.height === null ||
            asset.sizeBytes === null)
        )) {
          failed += 1
        }
        if (!queued) processed += 1
      }
      if (!importedMediaFilesRef.current.has(asset.id)) {
        importedMediaFilesRef.current.set(asset.id, file)
      }
      newReferences.push({
        ...imported.reference,
        id: `${projectId}:ref:${asset.id}`,
        assetId: asset.id,
        order: nextOrder,
        thumbnailFollowsProject: sourceChanged || !asset.thumbnail,
      })
      membershipKeys.add(membershipKey)
      nextOrder += 1
    })

    const updateImportProgress = (
      currentName: string,
      complete = false,
    ) => {
      if (!appMountedRef.current) return
      setProjectImportProgress({
        projectId,
        projectTitle:
          displayProjects.find((entry) => entry.id === projectId)?.title ??
          project.title,
        total: files.length,
        processed: complete ? files.length : processed,
        added: newReferences.length,
        duplicate,
        unsupported,
        failed,
        currentName,
        complete,
      })
    }

    updateImportProgress(inspectionQueue[0]?.file.name ?? '')

    if (newAssets.length > 0) {
      setMediaAssets((current) => [...current, ...newAssets])
    }
    if (changedAssetIds.size > 0) {
      setMediaAssets((current) =>
        current.map((asset) =>
          changedAssetIds.has(asset.id)
            ? {
                ...asset,
                thumbnail: null,
                sampleCount: 0,
                indexTask: 'idle',
                indexError: null,
              }
            : asset,
        ),
      )
      setVisualIndexes((current) =>
        current.filter(
          (index) => !changedAssetIds.has(index.assetId),
        ),
      )
      setFrameAnnotations((current) =>
        current.filter(
          (annotation) =>
            !changedAssetIds.has(annotation.assetId),
        ),
      )
      setFrameExclusions((current) =>
        current.filter(
          (exclusion) => !changedAssetIds.has(exclusion.assetId),
        ),
      )
      setProjectAssetRefs((current) =>
        current.map((reference) =>
          changedAssetIds.has(reference.assetId)
            ? {
                ...reference,
                thumbnailFollowsProject: true,
              }
            : reference,
        ),
      )
    }
    if (newReferences.length > 0) {
      setProjectAssetRefs((current) => [...current, ...newReferences])
      setProjects((current) =>
        current.map((entry) =>
          entry.id === projectId
            ? {
                ...entry,
                updatedAt: formatProjectTimestamp(),
              }
            : entry,
        ),
      )
      const projectIndex = projects.findIndex((entry) => entry.id === projectId)
      if (projectIndex >= 0) setActiveIndex(projectIndex)
      setSelectedProjectId(projectId)
      setSelectedClipId(newReferences[0]?.id ?? null)
      setEmptyProjectPromptId(null)
    }

    const inspectMediaFile = window.desktopBridge?.inspectMediaFile
    const createMediaThumbnail =
      window.desktopBridge?.createMediaThumbnail
    const activeInspectionNames = new Map<string, string>()
    let inspectionCursor = 0

    const inspectNext = async () => {
      while (inspectionCursor < inspectionQueue.length) {
        const queueIndex = inspectionCursor
        inspectionCursor += 1
        const {
          asset,
          file,
          refreshMetadata,
          ensureThumbnail,
          sourceChanged,
        } = inspectionQueue[queueIndex]
        activeInspectionNames.set(asset.id, file.name)
        updateImportProgress(activeInspectionNames.values().next().value ?? file.name)

        let importedAsset = sourceChanged
          ? {
              ...asset,
              thumbnail: null,
              sampleCount: 0,
              indexTask: 'idle' as const,
              indexError: null,
            }
          : asset
        let fileFailed = false
        if (
          refreshMetadata &&
          inspectMediaFile &&
          importedAsset.sourcePath
        ) {
          try {
            const metadata = await inspectMediaFile(
              importedAsset.sourcePath,
            )
            importedAsset = applyMediaFileMetadata(
              importedAsset,
              metadata,
            )
          } catch (error) {
            fileFailed = true
            console.warn(
              `[Aurora library] Failed to inspect ${asset.filename}`,
              error,
            )
          }
        } else if (refreshMetadata) {
          fileFailed = true
        }

        if (
          ensureThumbnail &&
          createMediaThumbnail &&
          importedAsset.sourcePath
        ) {
          try {
            const result = await createMediaThumbnail({
              assetId: importedAsset.id,
              sourcePath: importedAsset.sourcePath,
              durationSeconds: importedAsset.durationSeconds,
            })
            const sourceChangedDuringImport =
              !mediaAssetMatchesSourceState(
                importedAsset,
                result.sizeBytes,
                result.modifiedAt,
              )
            if (
              sourceChangedDuringImport &&
              inspectMediaFile
            ) {
              try {
                const metadata = await inspectMediaFile(
                  result.sourcePath,
                )
                importedAsset = {
                  ...applyMediaFileMetadata(
                    importedAsset,
                    metadata,
                  ),
                  sampleCount: 0,
                  indexTask: 'idle',
                  indexError: null,
                }
              } catch (error) {
                fileFailed = true
                console.warn(
                  `[Aurora library] Failed to refresh changed media metadata for ${asset.filename}`,
                  error,
                )
              }
            }
            importedAsset = {
              ...importedAsset,
              thumbnail: result.thumbnailPath,
            }
            if (sourceChangedDuringImport) {
              setVisualIndexes((current) =>
                current.filter(
                  (index) => index.assetId !== importedAsset.id,
                ),
              )
              setFrameAnnotations((current) =>
                current.filter(
                  (annotation) =>
                    annotation.assetId !== importedAsset.id,
                ),
              )
              setFrameExclusions((current) =>
                current.filter(
                  (exclusion) => exclusion.assetId !== importedAsset.id,
                ),
              )
            }
          } catch (error) {
            fileFailed = true
            console.warn(
              `[Aurora library] Failed to generate thumbnail for ${asset.filename}`,
              error,
            )
          }
        } else if (ensureThumbnail) {
          fileFailed = true
        }

        if (fileFailed) failed += 1
        if (appMountedRef.current) {
          setMediaAssets((current) =>
            current.map((entry) =>
              entry.id === importedAsset.id ? importedAsset : entry,
            ),
          )
          if (importedAsset.thumbnail) {
            setProjectAssetRefs((current) =>
              current.map((reference) =>
                reference.assetId === importedAsset.id
                  ? {
                      ...reference,
                      thumbnailFollowsProject: false,
                    }
                  : reference,
              ),
            )
          }
        }

        activeInspectionNames.delete(asset.id)
        processed += 1
        updateImportProgress(
          activeInspectionNames.values().next().value ??
            inspectionQueue[inspectionCursor]?.file.name ??
            '',
        )
      }
    }

    try {
      const workerCount = Math.min(2, inspectionQueue.length)
      if (workerCount > 0) {
        await Promise.all(
          Array.from({ length: workerCount }, () => inspectNext()),
        )
      }
      updateImportProgress('', true)
      const autoMetadataRequests = newReferences.map((reference) => ({
        referenceId: reference.id,
        placeholder: {
          tag: IMPORTED_CLIP_DEFAULT_TAG,
          note: IMPORTED_CLIP_DEFAULT_NOTE,
        },
      }))
      if (autoMetadataRequests.length > 0) {
        window.setTimeout(() => {
          if (!appMountedRef.current) return
          enqueueImportedClipAutoMetadata(autoMetadataRequests)
        }, 0)
      }
      projectImportProgressTimerRef.current = window.setTimeout(() => {
        setProjectImportProgress(null)
        projectImportProgressTimerRef.current = undefined
      }, 2600)
    } finally {
      projectImportBatchActiveRef.current = false
    }
  }

  function startProjectMediaImport(projectId: string, files: File[]) {
    void importProjectMediaFiles(projectId, files).catch((error) => {
      projectImportBatchActiveRef.current = false
      setProjectImportProgress(null)
      console.warn('[Aurora library] Project media import failed', error)
      showClipActionNotice('素材导入未完成，请检查文件后重试。')
    })
  }

  function handleProjectImportFileChange(
    event: ReactChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    const projectId = projectImportTargetIdRef.current
    projectImportTargetIdRef.current = null
    if (!projectId || files.length === 0) return
    startProjectMediaImport(projectId, files)
  }

  function openModelImportPicker(projectId: string) {
    modelImportTargetIdRef.current = projectId
    modelImportFileInputRef.current?.click()
  }

  async function importProjectModelFiles(projectId: string, files: File[]) {
    const project = projectsRef.current.find((entry) => entry.id === projectId)
    if (!project || (project.kind ?? 'video') !== '3d') return
    const candidates = files.filter(isSupportedModelFile)
    if (candidates.length === 0) {
      setModelImportState({ status: 'error', message: '请选择 GLB、OBJ 或 FBX 三维文件。' })
      return
    }

    let imported = 0
    let skipped = 0
    let lastImportedId: string | null = null
    for (const [index, file] of candidates.entries()) {
      const sourceFormat = getModelSourceFormat(file.name)
      if (!sourceFormat) continue
      setModelImportState({
        status: 'importing',
        message: `${sourceFormat === 'glb' ? '正在导入' : '正在转换并导入'} ${index + 1}/${candidates.length} · ${file.name}`,
      })
      let managedPath: string | null = null
      let runtimeUrl: string | null = null
      let browserObjectUrl = false
      try {
        // Converted OBJ/FBX output also depends on the selected MTL/textures.
        // A same-name/same-size source may therefore be a genuinely new import.
        const duplicate = isDuplicateModelImport(modelAssetsRef.current, {
          projectId,
          filename: file.name,
          format: sourceFormat,
          sizeBytes: file.size,
        })
        if (duplicate) {
          skipped += 1
          continue
        }

        const normalized = await normalizeModelImport(file, files)

        const bridge = window.desktopBridge
        if (bridge?.importModelAsset) {
          const result = await bridge.importModelAsset(normalized.runtimeFile, {
            sourceName: file.name,
          })
          managedPath = result.managedPath
          runtimeUrl = bridge.getMediaUrl(result.managedPath)
        } else {
          runtimeUrl = URL.createObjectURL(normalized.runtimeFile)
          browserObjectUrl = true
        }
        if (!runtimeUrl) throw new Error('无法创建模型运行地址。')
        const prepared = await prepareModelAsset(runtimeUrl)
        const id = `model-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${index}`}`
        const asset: ModelAsset = {
          id,
          projectId,
          filename: file.name,
          format: normalized.sourceFormat,
          sourcePath: managedPath,
          sizeBytes: file.size,
          importedAt: formatProjectTimestamp(),
          thumbnail: prepared.thumbnail,
          favorite: false,
          tags: [],
          note: '',
          vertexCount: prepared.vertexCount,
          triangleCount: prepared.triangleCount,
          nodeCount: prepared.nodeCount,
          materialCount: prepared.materialCount,
          textureCount: prepared.textureCount,
          dimensions: prepared.dimensions,
          camera: null,
          environmentPresetId: 'studio-neutral',
        }
        if (browserObjectUrl) modelObjectUrlsRef.current.set(id, runtimeUrl)
        modelAssetsRef.current = [...modelAssetsRef.current, asset]
        setModelAssets(modelAssetsRef.current)
        imported += 1
        lastImportedId = id
      } catch (error) {
        if (browserObjectUrl && runtimeUrl) URL.revokeObjectURL(runtimeUrl)
        if (managedPath) {
          void window.desktopBridge?.removeModelAsset?.(managedPath).catch(
            () => undefined,
          )
        }
        console.warn(`[Aurora model] Failed to import ${file.name}`, error)
        setModelImportState({
          status: 'error',
          message: error instanceof Error ? error.message : `${file.name} 导入失败。`,
        })
      }
    }

    if (lastImportedId) setSelectedModelId(lastImportedId)
    if (imported > 0) {
      setProjects((current) =>
        current.map((entry) =>
          entry.id === projectId
            ? { ...entry, updatedAt: formatProjectTimestamp() }
            : entry,
        ),
      )
      const largeModel = candidates.some(
        (file) => file.size > MODEL_ASSET_WARNING_BYTES,
      )
      const complexModel = modelAssetsRef.current.some(
        (asset) =>
          asset.projectId === projectId &&
          (asset.triangleCount ?? 0) > MODEL_ASSET_TRIANGLE_WARNING,
      )
      setModelImportState({
        status: 'done',
        message: `已导入 ${imported} 个模型${skipped ? ` · 跳过重复 ${skipped}` : ''}${largeModel || complexModel ? ' · 大型模型可能降低交互帧率' : ''}`,
      })
    } else if (skipped > 0) {
      setModelImportState({ status: 'done', message: `已跳过 ${skipped} 个重复模型。` })
    }
  }

  function handleModelImportFileChange(
    event: ReactChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    const projectId = modelImportTargetIdRef.current
    modelImportTargetIdRef.current = null
    if (!projectId || files.length === 0) return
    void importProjectModelFiles(projectId, files)
  }

  function isFileDragEvent(event: ReactDragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  function handleProjectFileDragEnter(event: ReactDragEvent<HTMLElement>) {
    if (!isFileDragEvent(event)) return
    event.preventDefault()
    if (projectImportBatchActiveRef.current) return
    projectImportDragDepthRef.current += 1
    setIsProjectFileDragActive(true)
  }

  function handleProjectFileDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!isFileDragEvent(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = projectImportBatchActiveRef.current
      ? 'none'
      : 'copy'
  }

  function handleProjectFileDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (!isFileDragEvent(event)) return
    event.preventDefault()
    projectImportDragDepthRef.current = Math.max(
      0,
      projectImportDragDepthRef.current - 1,
    )
    if (projectImportDragDepthRef.current === 0) {
      setIsProjectFileDragActive(false)
    }
  }

  function handleProjectFileDrop(event: ReactDragEvent<HTMLElement>) {
    if (!isFileDragEvent(event)) return
    event.preventDefault()
    projectImportDragDepthRef.current = 0
    setIsProjectFileDragActive(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    startProjectMediaImport(selectedProject.id, files)
  }

  function createEmptyProject() {
    const title = newProjectName.trim() || '未命名项目'
    const subtitle = newProjectEnglishName.trim()
    const projectId = `project-${Date.now().toString(36)}`
    const project: Project = {
      id: projectId,
      kind: newProjectKind,
      title,
      subtitle,
      description: getDefaultProjectDescription(newProjectKind),
      cover: EMPTY_PROJECT_COVER,
      videoCount: 0,
      collectionCount: 0,
      updatedAt: formatProjectTimestamp(),
    }
    const nextIndex = projects.length

    setProjects((current) => [...current, project])
    setProjectCustomizations((current) => ({
      ...current,
      [projectId]: {
        title,
        cover: null,
      },
    }))
    setActiveIndex(nextIndex)
    setSelectedProjectId(projectId)
    setSelectedClipId(null)
    setSelectedModelId(null)
    setHoveredProjectCardKey(null)
    setCreateOpen(false)
    setNewProjectName('新边界计划')
    setNewProjectEnglishName('')
    setNewProjectKind('video')
    setEmptyProjectPromptId(null)
  }

  const beginPageEnterPhase = useCallback(() => {
    if (pageTransitionEnterTimer.current !== undefined) {
      window.clearTimeout(pageTransitionEnterTimer.current)
    }
    pageTransitionActiveRef.current = true
    setPageTransitionPhase('entering')
    pageTransitionEnterTimer.current = window.setTimeout(() => {
      pageTransitionEnterTimer.current = undefined
      pageTransitionActiveRef.current = false
      setPageTransitionPhase('idle')
    }, PAGE_TRANSITION_ENTER_MS)
  }, [])

  const transitionToView = useCallback((nextView: AppView, updateHistory = true) => {
    if (nextView === currentView || pageTransitionActiveRef.current) return false
    if (updateHistory) writeAppViewRoute(nextView)

    if (PAGE_VIEW_DEPTH[nextView] > PAGE_VIEW_DEPTH[currentView]) {
      pageParentViewRef.current[nextView] = currentView
    }

    if (pageTransitionExitTimer.current !== undefined) {
      window.clearTimeout(pageTransitionExitTimer.current)
      pageTransitionExitTimer.current = undefined
    }
    if (pageTransitionEnterTimer.current !== undefined) {
      window.clearTimeout(pageTransitionEnterTimer.current)
      pageTransitionEnterTimer.current = undefined
    }

    setPageTransitionDirection(
      PAGE_VIEW_DEPTH[nextView] < PAGE_VIEW_DEPTH[currentView] ? 'shallower' : 'deeper',
    )

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setHasPageTransitioned(true)
      setPageTransitionPhase('idle')
      setCurrentView(nextView)
      return true
    }

    pageTransitionActiveRef.current = true
    setHasPageTransitioned(true)
    setPageTransitionPhase('exiting')
    pageTransitionExitTimer.current = window.setTimeout(() => {
      pageTransitionExitTimer.current = undefined
      setCurrentView(nextView)
      beginPageEnterPhase()
    }, PAGE_TRANSITION_EXIT_MS)
    return true
  }, [beginPageEnterPhase, currentView])

  const navigateBackOneLevel = useCallback(() => {
    let fallbackView: AppView | null = null

    if (currentView === 'video-library' || currentView === 'model-library') {
      fallbackView = 'gallery'
    } else if (currentView === 'model-viewer') {
      fallbackView = 'model-library'
    } else if (currentView === 'frame-ring') {
      fallbackView = externalFrameRingClip
        ? 'gallery'
        : onlineFrameRingClip && !onlineFrameRingReference
          ? 'online-search'
          : 'video-library'
    } else if (currentView === 'online-search') {
      fallbackView = 'gallery'
    } else if (currentView === 'favorites') {
      fallbackView = 'gallery'
    }

    const nextView = pageParentViewRef.current[currentView] ?? fallbackView
    if (!nextView) return false
    const nextNav: NavId = nextView === 'online-search'
      ? 'online-search'
      : nextView === 'favorites'
        ? 'favorites'
      : nextView === 'gallery'
        ? 'library'
        : 'project-details'
    setActiveNav(nextNav)
    setSearchOpen(false)
    setSettingsPanelOpen(false)
    setAccountCenterOpen(false)
    return transitionToView(nextView)
  }, [
    currentView,
    externalFrameRingClip,
    onlineFrameRingClip,
    onlineFrameRingReference,
    transitionToView,
  ])

  useEffect(() => {
    function handlePageBackShortcut(event: KeyboardEvent) {
      const escapeShortcut =
        event.key === 'Escape' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      const macBackShortcut =
        event.metaKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        (event.key === '[' || event.code === 'BracketLeft')
      const alternateBackShortcut =
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key === 'ArrowLeft'

      if (
        (!escapeShortcut && !macBackShortcut && !alternateBackShortcut) ||
        event.defaultPrevented
      ) {
        return
      }

      // Prevent Chromium from leaving Aurora when a browser-style back
      // shortcut is pressed at the root page or while another UI owns it.
      if (!escapeShortcut) event.preventDefault()

      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"]',
        )
      ) {
        return
      }
      if (
        event.repeat ||
        startupGateActive ||
        pageTransitionPhase !== 'idle' ||
        document.fullscreenElement
      ) {
        return
      }

      const activeModalOpen = Array.from(
        document.querySelectorAll<HTMLElement>('[aria-modal="true"]'),
      ).some(
        (element) =>
          !element.closest('[inert]') && element.getClientRects().length > 0,
      )
      const activeTrimMode = Boolean(
        document.querySelector(
          '.frameRingView[data-page-active="true"].isTrimMode',
        ),
      )
      const anotherUiOwnsEscape =
        searchOpen ||
        createOpen ||
        settingsPanelOpen ||
        accountCenterOpen ||
        openClipFilterMenu !== null ||
        projectMenu !== null ||
        projectDeleteDialogId !== null ||
        emptyProjectPromptId !== null ||
        clipMenuId !== null ||
        clipAddDialogId !== null ||
        clipRemoveDialogId !== null ||
        clipTagEditorId !== null ||
        clipNoteEditorId !== null ||
        activeModalOpen ||
        activeTrimMode
      if (anotherUiOwnsEscape) return

      if (escapeShortcut) event.preventDefault()
      navigateBackOneLevel()
    }

    window.addEventListener('keydown', handlePageBackShortcut)
    return () => window.removeEventListener('keydown', handlePageBackShortcut)
  }, [
    accountCenterOpen,
    clipAddDialogId,
    clipMenuId,
    clipNoteEditorId,
    clipRemoveDialogId,
    clipTagEditorId,
    createOpen,
    emptyProjectPromptId,
    navigateBackOneLevel,
    openClipFilterMenu,
    pageTransitionPhase,
    projectDeleteDialogId,
    projectMenu,
    searchOpen,
    settingsPanelOpen,
    startupGateActive,
  ])

  const handleStartupEntryStart = useCallback(() => {
    setPageTransitionDirection('deeper')
    setHasPageTransitioned(true)
    pageTransitionActiveRef.current = true
  }, [])

  const handleStartupEntered = useCallback(() => {
    setStartupGateActive(false)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pageTransitionActiveRef.current = false
      setPageTransitionPhase('idle')
      return
    }
    beginPageEnterPhase()
  }, [beginPageEnterPhase])

  useEffect(() => {
    const handleHistoryNavigation = () => {
      const routeView = readAppViewFromLocation()
      setActiveNav(
        routeView === 'online-search'
          ? 'online-search'
          : routeView === 'favorites'
            ? 'favorites'
            : 'library',
      )
      setSearchOpen(false)
      setSettingsPanelOpen(false)
      transitionToView(routeView, false)
    }

    window.addEventListener('popstate', handleHistoryNavigation)
    return () => window.removeEventListener('popstate', handleHistoryNavigation)
  }, [transitionToView])

  function openProjectVideoLibrary(index: number) {
    if (pageTransitionActiveRef.current) return
    const project = projects[index]
    if (!project) return
    const firstClip =
      videoClips.find((clip) => clip.projectId === project.id) ?? null

    const retainedClip =
      selectedProjectId === project.id
        ? videoClips.find(
            (clip) =>
              clip.id === selectedClipId &&
              clip.projectId === project.id,
          ) ?? null
        : null
    const nextClip = retainedClip ?? firstClip

    setActiveIndex(index)
    setSelectedProjectId(project.id)
    setSelectedClipId(nextClip?.id ?? null)
    setHoveredClipId(null)
    setQuery('')
    setProjectMenu(null)
    setHoveredProjectCardKey(null)
    setEmptyProjectPromptId(null)
    setActiveNav('project-details')
    transitionToView('video-library')
  }

  function openProjectModelLibrary(index: number) {
    if (pageTransitionActiveRef.current) return
    const project = projects[index]
    if (!project || (project.kind ?? 'video') !== '3d') return
    const projectModels = modelAssetsRef.current.filter(
      (asset) => asset.projectId === project.id,
    )
    const retainedModel =
      selectedProjectId === project.id
        ? projectModels.find((asset) => asset.id === selectedModelId) ?? null
        : null
    const nextModel = retainedModel ?? projectModels[0] ?? null
    setActiveIndex(index)
    setSelectedProjectId(project.id)
    setSelectedModelId(nextModel?.id ?? null)
    setSelectedClipId(null)
    setModelImportState({ status: 'idle', message: '' })
    setProjectMenu(null)
    setHoveredProjectCardKey(null)
    setActiveNav('project-details')
    transitionToView('model-library')
  }

  function openProjectDetails(index: number) {
    const project = projects[index]
    if (!project) return
    if ((project.kind ?? 'video') === '3d') {
      openProjectModelLibrary(index)
      return
    }
    openProjectVideoLibrary(index)
  }

  function openModelViewer(modelId: string) {
    if (pageTransitionActiveRef.current) return
    const model = modelAssetsRef.current.find((asset) => asset.id === modelId)
    if (!model) return
    const projectIndex = projects.findIndex(
      (project) => project.id === model.projectId,
    )
    if (projectIndex < 0) return
    setActiveIndex(projectIndex)
    setSelectedProjectId(model.projectId)
    setSelectedModelId(model.id)
    setSelectedClipId(null)
    setActiveNav('project-details')
    transitionToView('model-viewer')
  }

  function handleNavSelect(id: NavId) {
    if (pageTransitionActiveRef.current) return

    if (id === 'favorites') {
      setActiveNav('favorites')
      setSearchOpen(false)
      setSettingsPanelOpen(false)
      setAccountCenterOpen(false)
      transitionToView('favorites')
      return
    }

    setActiveNav(id)
    setSearchOpen(false)

    if (id === 'library') {
      transitionToView('gallery')
      return
    }

    if (id === 'project-details') {
      openProjectDetails(activeIndex)
      return
    }

    transitionToView(id)
  }

  function goToProject(index: number) {
    if (suppressNextClick.current) {
      suppressNextClick.current = false
      return
    }

    if (index === activeIndex) {
      openProjectDetails(index)
      return
    }

    const forwardDistance = (index - activeIndex + projects.length) % projects.length
    const stepDelta = forwardDistance <= projects.length / 2 ? 1 : -1
    animateProjectStep(stepDelta)
  }

  function openProjectMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    projectId: string,
    cardKey: string,
  ) {
    event.preventDefault()
    event.stopPropagation()
    if (
      isDragging ||
      isReleasing ||
      isRecycling ||
      projectWheelDragRef.current.active ||
      releaseTimer.current !== undefined
    ) {
      return
    }
    const project = displayProjects.find((entry) => entry.id === projectId)
    if (!project) return

    setHoveredProjectCardKey(cardKey)
    setProjectMenuDraftName(project.title)
    setProjectMenuDraftSubtitle(project.subtitle)
    setProjectMenu({ projectId })
    setSettingsPanelOpen(false)
    setSearchOpen(false)
  }

  function saveProjectMenuSettings(projectId: string) {
    const title = projectMenuDraftName.trim()
    const subtitle = projectMenuDraftSubtitle.trim()
    const baseProject = projects.find((project) => project.id === projectId)
    if (!title || !baseProject) return

    setProjectCustomizations((current) => ({
      ...current,
      [projectId]: {
        title,
        cover: current[projectId]?.cover ?? null,
      },
    }))
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId ? { ...project, subtitle } : project,
      ),
    )
    setProjectMenu(null)
    setProjectMenuDraftName('')
    setProjectMenuDraftSubtitle('')
    setHoveredProjectCardKey(null)
  }

  function openProjectDeleteConfirmation(projectId: string) {
    const project = displayProjects.find((entry) => entry.id === projectId)
    if (!project) return

    setProjectDeleteDialogId(projectId)
    setProjectMenu(null)
    setProjectMenuDraftName('')
    setProjectMenuDraftSubtitle('')
    setHoveredProjectCardKey(null)
  }

  function deleteProjectFromLibrary() {
    if (!projectDeleteDialog || projects.length <= 1) return

    const projectId = projectDeleteDialog.id
    projectCoverImportVersionsRef.current.set(
      projectId,
      (projectCoverImportVersionsRef.current.get(projectId) ?? 0) + 1,
    )
    const deletedIndex = projects.findIndex(
      (project) => project.id === projectId,
    )
    if (deletedIndex < 0) return

    const currentActiveProjectId = projects[activeIndex]?.id
    const remainingProjects = projects.filter(
      (project) => project.id !== projectId,
    )
    const fallbackIndex = Math.min(
      deletedIndex,
      remainingProjects.length - 1,
    )
    const fallbackProject = remainingProjects[fallbackIndex]
    const nextActiveProjectId =
      currentActiveProjectId && currentActiveProjectId !== projectId
        ? currentActiveProjectId
        : fallbackProject.id
    const nextActiveIndex = Math.max(
      0,
      remainingProjects.findIndex(
        (project) => project.id === nextActiveProjectId,
      ),
    )
    const nextSelectedProjectId =
      selectedProjectId !== projectId
        ? selectedProjectId
        : fallbackProject.id
    const nextSelectedClipId =
      selectedProjectId !== projectId
        ? selectedClipId
        : projectAssetRefs
            .filter(
              (reference) =>
                reference.projectId === nextSelectedProjectId,
            )
            .sort((left, right) => left.order - right.order)[0]?.id ?? null
    const customCover = projectCustomizations[projectId]?.cover
    const removedModels = modelAssetsRef.current.filter(
      (asset) => asset.projectId === projectId,
    )
    const remainingModels = modelAssetsRef.current.filter(
      (asset) => asset.projectId !== projectId,
    )

    setProjects(remainingProjects)
    setProjectAssetRefs((current) =>
      current.filter((reference) => reference.projectId !== projectId),
    )
    modelAssetsRef.current = remainingModels
    setModelAssets(remainingModels)
    removedModels.forEach((asset) => {
      const objectUrl = modelObjectUrlsRef.current.get(asset.id)
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        modelObjectUrlsRef.current.delete(asset.id)
      }
      if (asset.sourcePath) {
        void window.desktopBridge?.removeModelAsset?.(asset.sourcePath).catch(
          () => undefined,
        )
      }
    })
    setProjectCustomizations((current) => {
      const next = { ...current }
      delete next[projectId]
      return next
    })
    setActiveIndex(nextActiveIndex)
    setSelectedProjectId(nextSelectedProjectId)
    setSelectedClipId(nextSelectedClipId)
    setSelectedModelId(
      selectedProjectId !== projectId
        ? selectedModelId
        : remainingModels.find(
            (asset) => asset.projectId === nextSelectedProjectId,
          )?.id ?? null,
    )
    setProjectDeleteDialogId(null)
    setEmptyProjectPromptId(null)
    setHoveredProjectCardKey(null)
    setDragOffset(0)
    setReleaseSource(null)
    setReleaseStepDelta(0)
    projectCoverTargetIdRef.current =
      projectCoverTargetIdRef.current === projectId
        ? null
        : projectCoverTargetIdRef.current
    projectImportTargetIdRef.current =
      projectImportTargetIdRef.current === projectId
        ? null
        : projectImportTargetIdRef.current
    modelImportTargetIdRef.current =
      modelImportTargetIdRef.current === projectId
        ? null
        : modelImportTargetIdRef.current
    releaseProjectCoverAfterPaint(customCover)
    showClipActionNotice(
      `已删除“${projectDeleteDialog.title}”；磁盘原文件和其他项目中的素材不受影响。`,
    )
  }

  function showClipActionNotice(message: string, projectId?: string) {
    if (clipActionNoticeTimerRef.current !== undefined) {
      window.clearTimeout(clipActionNoticeTimerRef.current)
    }
    setClipActionNotice({ message, projectId })
    clipActionNoticeTimerRef.current = window.setTimeout(() => {
      setClipActionNotice(null)
      clipActionNoticeTimerRef.current = undefined
    }, 3600)
  }

  function openClipMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    clipId: string,
  ) {
    event.preventDefault()
    event.stopPropagation()
    if (
      isClipDragging ||
      isClipReleasing ||
      clipWheelDragRef.current.active
    ) {
      return
    }
    setSelectedClipId(clipId)
    setClipMenuId(clipId)
    setSettingsPanelOpen(false)
    setSearchOpen(false)
  }

  function beginAddClipToProject(clipId: string) {
    const clip = videoClips.find((entry) => entry.id === clipId)
    if (!clip) return
    const membershipIds = new Set(
      projectAssetRefs
        .filter((reference) => reference.assetId === clip.assetId)
        .map((reference) => reference.projectId),
    )
    const firstTarget = displayProjects.find(
      (project) =>
        project.kind === 'video' && !membershipIds.has(project.id),
    )
    setClipMenuId(null)
    setExternalVideoAddCandidate(null)
    const onlineAsset = mediaAssets.find(
      (asset) => asset.id === clip.assetId,
    )
    setOnlineVideoAddCandidate(
      clip.online && onlineAsset && isOnlineMediaAsset(onlineAsset)
        ? { asset: onlineAsset, clip: { ...clip, online: clip.online } }
        : null,
    )
    setClipAddDialogId(clipId)
    setClipAddMode(firstTarget ? 'existing' : 'new')
    setClipAddTargetProjectId(firstTarget?.id ?? '')
    setClipAddNewProjectName(`${clip.filename.replace(/\.[^.]+$/, '')} 项目`)
    setClipAddNewProjectEnglishName('')
  }

  function beginAddExternalVideoToProject() {
    const candidate = externalVideoAddCandidate
    if (!candidate) return
    const membershipIds = new Set(
      projectAssetRefs
        .filter((reference) => reference.assetId === candidate.asset.id)
        .map((reference) => reference.projectId),
    )
    const firstTarget = displayProjects.find(
      (project) =>
        project.kind === 'video' && !membershipIds.has(project.id),
    )
    setClipAddDialogId(candidate.clip.id)
    setClipAddMode(firstTarget ? 'existing' : 'new')
    setClipAddTargetProjectId(firstTarget?.id ?? '')
    setClipAddNewProjectName(
      `${candidate.clip.filename.replace(/\.[^.]+$/, '')} 项目`,
    )
    setClipAddNewProjectEnglishName('')
  }

  function createProjectAssetReference(
    clip: VideoClip,
    projectId: string,
    order: number,
  ): ProjectAssetRef {
    const asset =
      mediaAssets.find((entry) => entry.id === clip.assetId) ??
      (externalVideoAddCandidate?.asset.id === clip.assetId
        ? externalVideoAddCandidate.asset
        : onlineVideoAddCandidate?.asset.id === clip.assetId
          ? onlineVideoAddCandidate.asset
        : undefined)
    return {
      id: `${projectId}:ref:${clip.assetId}`,
      projectId,
      assetId: clip.assetId,
      order,
      thumbnailFollowsProject: !asset?.thumbnail,
      tags: [...clip.tags],
      annotated: clip.annotated,
      note: clip.note,
    }
  }

  function closeClipAddDialog() {
    setClipAddDialogId(null)
    setOnlineVideoAddCandidate(null)
  }

  function commitExternalVideoAsset(candidate: ExternalVideoAddCandidate) {
    setMediaAssets((current) => {
      const existingIndex = current.findIndex(
        (asset) => asset.id === candidate.asset.id,
      )
      if (existingIndex < 0) return [...current, candidate.asset]
      return current.map((asset, index) =>
        index === existingIndex ? candidate.asset : asset,
      )
    })
    if (candidate.sourceChanged) {
      setVisualIndexes((current) =>
        current.filter((index) => index.assetId !== candidate.asset.id),
      )
      setFrameAnnotations((current) =>
        current.filter(
          (annotation) => annotation.assetId !== candidate.asset.id,
        ),
      )
      setFrameExclusions((current) =>
        current.filter(
          (exclusion) => exclusion.assetId !== candidate.asset.id,
        ),
      )
    }
    if (candidate.asset.thumbnail) {
      setProjectAssetRefs((current) =>
        current.map((reference) =>
          reference.assetId === candidate.asset.id
            ? { ...reference, thumbnailFollowsProject: false }
            : reference,
        ),
      )
    }
  }

  function commitOnlineVideoAsset(candidate: OnlineVideoAddCandidate) {
    setMediaAssets((current) => {
      const exists = current.some((asset) => asset.id === candidate.asset.id)
      return exists
        ? current.map((asset) =>
            asset.id === candidate.asset.id ? candidate.asset : asset,
          )
        : [...current, candidate.asset]
    })
    setBilibiliSelectionAsset((current) =>
      current?.id === candidate.asset.id ? candidate.asset : current,
    )
  }

  function addClipToExistingProject() {
    if (!clipAddDialog || !clipAddTargetProjectId) return
    const targetProject = displayProjects.find(
      (project) => project.id === clipAddTargetProjectId,
    )
    if (!targetProject || clipMembershipProjectIds.has(targetProject.id)) return

    const order = getNextProjectAssetOrder(
      targetProject.id,
      projectAssetRefs,
    )
    const reference = createProjectAssetReference(
      clipAddDialog,
      targetProject.id,
      order,
    )
    const externalCandidate = externalVideoAddCandidate
    const onlineCandidate = onlineVideoAddCandidate
    if (externalCandidate) {
      commitExternalVideoAsset(externalCandidate)
    }
    if (onlineCandidate) {
      commitOnlineVideoAsset(onlineCandidate)
    }
    setProjectAssetRefs((current) => [...current, reference])
    setProjects((current) =>
      current.map((project) =>
        project.id === targetProject.id
          ? {
              ...project,
              updatedAt: formatProjectTimestamp(),
            }
          : project,
      ),
    )
    closeClipAddDialog()
    showClipActionNotice(
      onlineCandidate
        ? `已添加到“${targetProject.title}”；只保存${getOnlineProviderLabel(onlineCandidate.asset.online.provider)}链接，不下载视频，也不建立帧环。`
        : `已添加到“${targetProject.title}”，原文件与视觉索引不会重复复制。`,
      targetProject.id,
    )
    if (externalCandidate) {
      const targetIndex = projects.findIndex(
        (project) => project.id === targetProject.id,
      )
      if (targetIndex >= 0) setActiveIndex(targetIndex)
      setSelectedProjectId(targetProject.id)
      setSelectedClipId(reference.id)
      setExternalVideoNavigationClipId(reference.id)
      setExternalVideoAddCandidate(null)
      if (
        reference.tags.length === 1 &&
        reference.tags[0] === IMPORTED_CLIP_DEFAULT_TAG &&
        reference.note === EXTERNAL_CLIP_DEFAULT_NOTE
      ) {
        window.setTimeout(() => {
          if (!appMountedRef.current) return
          enqueueImportedClipAutoMetadata([{
            referenceId: reference.id,
            placeholder: {
              tag: IMPORTED_CLIP_DEFAULT_TAG,
              note: EXTERNAL_CLIP_DEFAULT_NOTE,
            },
          }])
        }, 0)
      }
    }
    if (onlineCandidate) setOnlineVideoAddCandidate(null)
  }

  function createProjectFromClip() {
    if (!clipAddDialog) return
    const title = clipAddNewProjectName.trim()
    const subtitle = clipAddNewProjectEnglishName.trim()
    const asset =
      mediaAssets.find((entry) => entry.id === clipAddDialog.assetId) ??
      (externalVideoAddCandidate?.asset.id === clipAddDialog.assetId
        ? externalVideoAddCandidate.asset
        : onlineVideoAddCandidate?.asset.id === clipAddDialog.assetId
          ? onlineVideoAddCandidate.asset
        : undefined)
    if (!title || !asset) return

    const projectId = `project-${Date.now().toString(36)}`
    const project: Project = {
      id: projectId,
      kind: 'video',
      title,
      subtitle,
      description: getDefaultProjectDescription('video'),
      cover: onlineVideoAddCandidate
        ? EMPTY_PROJECT_COVER
        : asset.thumbnail ?? EMPTY_PROJECT_COVER,
      videoCount: 0,
      collectionCount: 0,
      updatedAt: formatProjectTimestamp(),
    }
    const reference = createProjectAssetReference(clipAddDialog, projectId, 0)

    const externalCandidate = externalVideoAddCandidate
    const onlineCandidate = onlineVideoAddCandidate
    if (externalCandidate) {
      commitExternalVideoAsset(externalCandidate)
    }
    if (onlineCandidate) {
      commitOnlineVideoAsset(onlineCandidate)
    }
    setProjects((current) => [...current, project])
    setProjectCustomizations((current) => ({
      ...current,
      [projectId]: {
        title,
        cover: null,
      },
    }))
    setProjectAssetRefs((current) => [...current, reference])
    closeClipAddDialog()
    showClipActionNotice(
      onlineCandidate
        ? `已创建“${title}”并保存${getOnlineProviderLabel(onlineCandidate.asset.online.provider)}链接；视频仍由官方页面播放。`
        : `已创建“${title}”并添加素材，原文件与视觉索引继续共用。`,
      projectId,
    )
    if (externalCandidate) {
      setActiveIndex(projects.length)
      setSelectedProjectId(projectId)
      setSelectedClipId(reference.id)
      setExternalVideoNavigationClipId(reference.id)
      setExternalVideoAddCandidate(null)
      if (
        reference.tags.length === 1 &&
        reference.tags[0] === IMPORTED_CLIP_DEFAULT_TAG &&
        reference.note === EXTERNAL_CLIP_DEFAULT_NOTE
      ) {
        window.setTimeout(() => {
          if (!appMountedRef.current) return
          enqueueImportedClipAutoMetadata([{
            referenceId: reference.id,
            placeholder: {
              tag: IMPORTED_CLIP_DEFAULT_TAG,
              note: EXTERNAL_CLIP_DEFAULT_NOTE,
            },
          }])
        }, 0)
      }
    }
    if (onlineCandidate) setOnlineVideoAddCandidate(null)
  }

  async function revealClipInFinder(clip: VideoClip) {
    setClipMenuId(null)
    if (!clip.sourcePath || !window.desktopBridge?.revealProjectFile) {
      showClipActionNotice(
        '浏览器预览无法访问原文件位置；桌面版导入并保留路径后可在 Finder 中显示。',
      )
      return
    }
    const revealed = await window.desktopBridge.revealProjectFile(
      clip.sourcePath,
    )
    showClipActionNotice(
      revealed
        ? '已在 Finder 中显示原视频。'
        : '原视频路径当前不可用，请重新定位素材。',
    )
  }

  function removeClipFromCurrentProject() {
    if (!clipRemoveDialog) return
    const projectId = clipRemoveDialog.projectId
    const currentProjectReferences = projectAssetRefs
      .filter((reference) => reference.projectId === projectId)
      .sort((left, right) => left.order - right.order)
    const removedIndex = currentProjectReferences.findIndex(
      (reference) => reference.id === clipRemoveDialog.id,
    )
    if (removedIndex < 0) return
    const remainingReferences = currentProjectReferences.filter(
      (reference) => reference.id !== clipRemoveDialog.id,
    )
    const nextReference =
      remainingReferences[
        Math.min(removedIndex, Math.max(0, remainingReferences.length - 1))
      ] ?? null

    setProjectAssetRefs((current) =>
      current.filter((reference) => reference.id !== clipRemoveDialog.id),
    )
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              updatedAt: formatProjectTimestamp(),
            }
          : project,
      ),
    )
    if (selectedClipId === clipRemoveDialog.id) {
      setSelectedClipId(nextReference?.id ?? null)
    }
    setHoveredClipId(null)
    setClipRemoveDialogId(null)
    setClipTrackPosition(0)
    setClipOverscroll(0)
    setEmptyProjectPromptId(null)
    showClipActionNotice(
      `已从“${selectedProject.title}”移除；原文件与视觉索引仍保留在 Aurora 中。`,
    )
  }

  function toggleClipFavorite(clip: VideoClip) {
    setMediaAssets((current) =>
      current.map((asset) =>
        asset.id === clip.assetId
          ? { ...asset, favorite: !asset.favorite }
          : asset,
      ),
    )
    if (clip.online) {
      setBilibiliSelectionAsset((current) =>
        current?.id === clip.assetId
          ? { ...current, favorite: !current.favorite }
          : current,
      )
      setOnlineSearchAssetsByProvider((current) => ({
        ...current,
        [clip.online!.provider]: current[clip.online!.provider].map((asset) =>
          asset.id === clip.assetId
            ? { ...asset, favorite: !asset.favorite }
            : asset,
        ),
      }))
      setOnlineFrameRingAsset((current) =>
        current?.id === clip.assetId
          ? { ...current, favorite: !current.favorite }
          : current,
      )
    }
  }

  function toggleFavoriteGalleryItem(item: FavoriteGalleryItem) {
    const source = item.source
    if (source.type === 'preview') return
    if (source.type === 'model') {
      toggleModelFavorite(source.assetId)
      return
    }
    if (source.type === 'frame') {
      const nextAnnotations = frameAnnotationsRef.current.map((annotation) =>
        annotation.assetId === source.assetId &&
        annotation.frameId === source.frameId
          ? { ...annotation, favorite: !annotation.favorite }
          : annotation,
      )
      frameAnnotationsRef.current = nextAnnotations
      setFrameAnnotations(nextAnnotations)
      return
    }

    const clip = videoClips.find(
      (candidate) => candidate.assetId === source.assetId,
    )
    if (clip) {
      toggleClipFavorite(clip)
      return
    }
    const asset = mediaAssetsRef.current.find(
      (candidate) => candidate.id === source.assetId,
    )
    if (asset && isOnlineMediaAsset(asset)) {
      toggleOnlineAssetFavorite(
        asset as OnlineVideoAddCandidate['asset'],
      )
    }
  }

  function openFavoriteGalleryItem(item: FavoriteGalleryItem) {
    if (pageTransitionActiveRef.current) {
      return false
    }
    const source = item.source
    if (source.type === 'preview') {
      const projectIndex = projects.findIndex(
        (project) => project.id === source.projectId,
      )
      if (projectIndex < 0) return false
      openProjectDetails(projectIndex)
      return true
    }
    if (source.type === 'model') {
      openModelViewer(source.assetId)
      return true
    }

    const clip = videoClips.find(
      (candidate) => candidate.assetId === source.assetId,
    )
    if (clip) {
      const projectIndex = projects.findIndex(
        (project) => project.id === clip.projectId,
      )
      if (projectIndex < 0) return false
      setActiveIndex(projectIndex)
      setSelectedProjectId(clip.projectId)
      setSelectedClipId(clip.id)
      if (clip.online) {
        const onlineAsset = mediaAssetsRef.current.find(
          (candidate) =>
            candidate.id === clip.assetId && isOnlineMediaAsset(candidate),
        )
        if (!onlineAsset || !isOnlineMediaAsset(onlineAsset)) return false
        setOnlineFrameRingAsset(
          onlineAsset as OnlineVideoAddCandidate['asset'],
        )
      } else {
        setOnlineFrameRingAsset(null)
      }
      if (source.type === 'frame') {
        const frame = clip.indexedFrames.find(
          (candidate) => candidate.id === source.frameId,
        )
        if (!frame) return false
        setFrameRingFocusTarget({
          clipId: clip.id,
          frameId: frame.id,
          timeSeconds: frame.timeSeconds,
          requestId: Date.now(),
          intent: 'preview',
        })
      } else {
        setFrameRingFocusTarget(null)
      }
      setHoveredClipId(null)
      setQuery('')
      setActiveNav('project-details')
      setSearchOpen(false)
      transitionToView('frame-ring')
      return true
    }

    const asset = mediaAssetsRef.current.find(
      (candidate) => candidate.id === source.assetId,
    )
    if (!asset || !isOnlineMediaAsset(asset)) return false
    const onlineAsset = asset as OnlineVideoAddCandidate['asset']
    const reference = projectAssetRefsRef.current.find(
      (candidate) => candidate.assetId === onlineAsset.id,
    )
    if (reference) {
      const projectIndex = projects.findIndex(
        (project) => project.id === reference.projectId,
      )
      if (projectIndex >= 0) {
        setActiveIndex(projectIndex)
        setSelectedProjectId(reference.projectId)
      }
      setSelectedClipId(reference.id)
    } else {
      setSelectedClipId(null)
    }
    setOnlineFrameRingAsset(onlineAsset)
    setFrameRingFocusTarget(null)
    setHoveredClipId(null)
    setQuery('')
    setActiveNav('project-details')
    setSearchOpen(false)
    transitionToView('frame-ring')
    return true
  }

  function cycleClipColorPreset(clip: VideoClip) {
    if (clip.online) return
    setMediaAssets((current) =>
      current.map((asset) =>
        asset.id === clip.assetId
          ? {
              ...asset,
              colorPreset: getNextMediaColorPresetId(asset.colorPreset),
            }
          : asset,
      ),
    )
  }

  function scheduleClipColorPresetCycle(clip: VideoClip) {
    if (detailColorPresetClickTimerRef.current !== undefined) {
      window.clearTimeout(detailColorPresetClickTimerRef.current)
    }
    detailColorPresetClickTimerRef.current = window.setTimeout(() => {
      detailColorPresetClickTimerRef.current = undefined
      cycleClipColorPreset(clip)
    }, 200)
  }

  function resetClipColorPreset(clip: VideoClip) {
    if (clip.online) return
    if (detailColorPresetClickTimerRef.current !== undefined) {
      window.clearTimeout(detailColorPresetClickTimerRef.current)
      detailColorPresetClickTimerRef.current = undefined
    }
    setMediaAssets((current) =>
      current.map((asset) =>
        asset.id === clip.assetId
          ? { ...asset, colorPreset: 'original' }
          : asset,
      ),
    )
  }

  async function toggleDetailPreviewPlayback(clip: VideoClip) {
    if (clip.online) {
      openFrameRing(clip.id)
      return
    }
    const previewState = lightweightPreviewByAsset[clip.assetId]
    const matchingPreview =
      previewState?.sourcePath === clip.sourcePath ? previewState : undefined
    const sourceUrl =
      matchingPreview?.status === 'ready' && matchingPreview.playbackPath
        ? resolveLibraryMediaUrl(matchingPreview.playbackPath)
        : null
    if (!sourceUrl) {
      if (!clip.sourcePath) {
        showClipActionNotice(
          '当前素材没有可读取的视频源，请在桌面程序中重新导入或定位原视频。',
        )
      } else {
        const retry = matchingPreview?.status === 'failed'
        showClipActionNotice(
          retry
            ? '轻量视频预览准备失败，正在重新尝试…'
            : '正在准备轻量视频预览，请稍候…',
        )
        if (matchingPreview?.status !== 'preparing') {
          void ensureLightweightPreview(clip, retry)
        }
      }
      return
    }

    if (detailPreviewFailedSource === sourceUrl) {
      showClipActionNotice(
        '当前轻量预览无法播放，请重新进入项目后重试。',
      )
      return
    }

    const video = detailPreviewVideoRef.current
    if (!video) return
    if (!video.paused && !video.ended) {
      video.pause()
      return
    }

    if (video.ended) video.currentTime = 0
    try {
      await video.play()
    } catch {
      setDetailPreviewPlayingKey(null)
      setDetailPreviewFailedSource(sourceUrl)
      showClipActionNotice('当前轻量预览无法播放，请重新进入项目后重试。')
    }
  }

  function updateClipReferenceMetadata(
    clipId: string,
    patch: Partial<Pick<ProjectAssetRef, 'tags' | 'note'>>,
  ) {
    setProjectAssetRefs((current) => {
      const next = current.map((reference) =>
        reference.id === clipId
          ? {
              ...reference,
              ...patch,
              annotated:
                (patch.tags ?? reference.tags).length > 0 ||
                (patch.note ?? reference.note).trim().length > 0,
            }
          : reference,
      )
      projectAssetRefsRef.current = next
      return next
    })
  }

  function removeClipTag(clip: VideoClip, tag: string) {
    updateClipReferenceMetadata(clip.id, {
      tags: clip.tags.filter((item) => item !== tag),
    })
  }

  function openClipTagEditor(clip: VideoClip) {
    setClipTagEditorId(clip.id)
    setClipTagDraft('')
    setClipTagEditorStatus('')
  }

  function addClipTag() {
    if (!clipTagEditor) return
    const nextTag = clipTagDraft
      .trim()
      .slice(0, CLIP_DETAIL_TAG_MAX_LENGTH)
    if (!nextTag) return
    if (clipTagEditor.tags.includes(nextTag)) {
      setClipTagEditorStatus('这个标签已经存在')
      return
    }
    if (clipTagEditor.tags.length >= CLIP_DETAIL_TAG_MAX_COUNT) {
      setClipTagEditorStatus(
        `最多保留 ${CLIP_DETAIL_TAG_MAX_COUNT} 个标签，请先删除一个`,
      )
      return
    }

    updateClipReferenceMetadata(clipTagEditor.id, {
      tags: [...clipTagEditor.tags, nextTag],
    })
    setClipTagEditorId(null)
    setClipTagDraft('')
    setClipTagEditorStatus('')
  }

  function openClipNoteEditor(clip: VideoClip) {
    setClipNoteEditorId(clip.id)
    setClipNoteDraft(clip.note.slice(0, CLIP_DETAIL_NOTE_MAX_LENGTH))
  }

  function saveClipNote() {
    if (!clipNoteEditor) return
    updateClipReferenceMetadata(clipNoteEditor.id, {
      note: clipNoteDraft
        .trim()
        .slice(0, CLIP_DETAIL_NOTE_MAX_LENGTH),
    })
    setClipNoteEditorId(null)
    setClipNoteDraft('')
  }

  function captureClipAiMetadataTarget(
    clipId: string,
  ): ClipAiMetadataTarget | null {
    const reference = projectAssetRefsRef.current.find(
      (entry) => entry.id === clipId,
    )
    if (!reference) return null
    const asset = mediaAssetsRef.current.find(
      (entry) => entry.id === reference.assetId,
    )
    const project = projectsRef.current.find(
      (entry) => entry.id === reference.projectId,
    )
    if (
      !asset?.sourcePath ||
      isOnlineMediaAsset(asset) ||
      !project ||
      (project.kind ?? 'video') !== 'video'
    ) {
      return null
    }

    const visualIndex = visualIndexesRef.current.find(
      (entry) =>
        entry.assetId === asset.id &&
        entry.sourceFingerprint === asset.sourceFingerprint,
    )
    const excludedFrameIds = new Set(
      frameExclusionsRef.current.flatMap((exclusion) =>
        exclusion.assetId === asset.id &&
        exclusion.sourceFingerprint === asset.sourceFingerprint
          ? [exclusion.frameId]
          : [],
      ),
    )
    const candidates = createAiVisualSearchCandidates({
      clips: [{
        id: reference.id,
        assetId: asset.id,
        projectId: reference.projectId,
        filename: asset.filename,
        sourceFingerprint: asset.sourceFingerprint,
        durationSeconds: asset.durationSeconds,
        tags: reference.tags,
        note: reference.note,
        indexedFrames: (visualIndex?.frames ?? []).flatMap((frame) =>
          excludedFrameIds.has(frame.id)
            ? []
            : [{
                id: frame.id,
                imagePath: frame.imagePath,
                timeSeconds: frame.timeSeconds,
              }],
        ),
      }],
      assets: [asset],
      projects: [project],
    }).sort((left, right) => left.timeSeconds - right.timeSeconds)
    if (candidates.length === 0) return null

    const evidenceTier = candidates[0].analysisTier
    return {
      clipId: reference.id,
      assetId: asset.id,
      projectId: reference.projectId,
      filename: asset.filename,
      sourceFingerprint: asset.sourceFingerprint,
      evidenceRevision:
        evidenceTier === 'visual-index'
          ? `visual-index:${visualIndex?.createdAt ?? ''}`
          : `thumbnail:${asset.thumbnail ?? ''}`,
      evidenceTier,
      candidates,
    }
  }

  function clipAiMetadataTargetIsCurrent(target: ClipAiMetadataTarget) {
    const current = captureClipAiMetadataTarget(target.clipId)
    return Boolean(
      current &&
        current.assetId === target.assetId &&
        current.sourceFingerprint === target.sourceFingerprint &&
        current.evidenceRevision === target.evidenceRevision,
    )
  }

  async function analyzeClipAiMetadata(
    clipId: string,
  ): Promise<ClipAiMetadataAnalysisResult> {
    const bridge = window.desktopBridge
    if (!bridge?.analyzeAiVisualFrames) {
      throw new Error('AI 画面理解仅可在 Aurora 桌面版中使用')
    }
    const visionProfileId =
      aiServiceProfilesStateRef.current.activeVisionProfileId
    if (!visionProfileId) {
      throw new Error('请先在探索页设置中选择画面理解模型')
    }
    const target = captureClipAiMetadataTarget(clipId)
    if (!target) {
      throw new Error('当前素材还没有可用于识别的关键帧或本地缩略图')
    }

    const candidates = selectClipAiRepresentativeFrames(
      target.candidates,
      CLIP_AI_REPRESENTATIVE_FRAME_LIMIT,
    )
    const response = await bridge.analyzeAiVisualFrames({
      visionProfileId,
      candidates,
    })
    if (!response.ok) throw new Error(response.error.message)
    if (!clipAiMetadataTargetIsCurrent(target)) {
      throw new Error('识别期间素材画面已变化，请重新识别')
    }

    const requestedResultIds = new Set(
      candidates.map((candidate) => candidate.resultId),
    )
    const frames = response.data.frames.filter((frame) =>
      requestedResultIds.has(frame.resultId),
    )
    if (frames.length === 0) {
      throw new Error('视觉模型没有返回可用的片段描述')
    }
    const suggestion = createClipAiMetadataSuggestion(frames, {
      maxTags: CLIP_DETAIL_TAG_MAX_COUNT,
      maxTagLength: CLIP_DETAIL_TAG_MAX_LENGTH,
      maxNoteLength: CLIP_DETAIL_NOTE_MAX_LENGTH,
    })
    if (suggestion.tags.length === 0 && !suggestion.note) {
      throw new Error('暂时没有识别出适合写入的标签或备注')
    }
    return {
      target,
      suggestion,
      evidenceCount: frames.length,
      newlyAnalyzedFrameCount: response.data.newlyAnalyzedFrameCount,
    }
  }

  function closeClipAiMetadataDialog() {
    clipAiMetadataRequestVersionRef.current += 1
    setClipAiMetadataDialog(null)
  }

  async function openClipAiMetadataDialog(clip: VideoClip) {
    if (clip.online) return
    if (!clip.sourcePath) {
      showClipActionNotice('当前素材无法访问本地文件，请重新定位或导入后再识别。')
      return
    }
    if (!window.desktopBridge?.analyzeAiVisualFrames) {
      showClipActionNotice('AI 画面理解仅可在 Aurora 桌面版中使用。')
      return
    }
    if (!aiServiceProfilesStateRef.current.activeVisionProfileId) {
      showClipActionNotice('请先在探索页设置中选择画面理解模型。')
      return
    }

    const requestVersion = clipAiMetadataRequestVersionRef.current + 1
    clipAiMetadataRequestVersionRef.current = requestVersion
    setClipAiMetadataDialog({
      clipId: clip.id,
      filename: clip.filename,
      status: 'analyzing',
      tags: [],
      selectedTags: [],
      note: '',
      applyNote: false,
      evidenceCount: 0,
      evidenceTier: null,
      newlyAnalyzedFrameCount: 0,
      error: null,
    })

    try {
      const result = await analyzeClipAiMetadata(clip.id)
      if (clipAiMetadataRequestVersionRef.current !== requestVersion) return
      const reference = projectAssetRefsRef.current.find(
        (entry) => entry.id === clip.id,
      )
      if (!reference) throw new Error('当前项目中的素材引用已移除')
      const existingTagKeys = new Set(
        reference.tags.map((tag) =>
          tag.trim().replace(/^#+/u, '').toLocaleLowerCase('zh-CN'),
        ),
      )
      const availableTagCount = Math.max(
        0,
        CLIP_DETAIL_TAG_MAX_COUNT - reference.tags.length,
      )
      const suggestedTags = result.suggestion.tags.filter(
        (tag) => !existingTagKeys.has(tag.toLocaleLowerCase('zh-CN')),
      )
      setClipAiMetadataDialog({
        clipId: clip.id,
        filename: clip.filename,
        status: 'ready',
        tags: suggestedTags,
        selectedTags: suggestedTags.slice(0, availableTagCount),
        note: result.suggestion.note,
        applyNote:
          Boolean(result.suggestion.note) &&
          (!reference.note.trim() || reference.note === IMPORTED_CLIP_DEFAULT_NOTE),
        evidenceCount: result.evidenceCount,
        evidenceTier: result.target.evidenceTier,
        newlyAnalyzedFrameCount: result.newlyAnalyzedFrameCount,
        error: null,
      })
    } catch (error) {
      if (clipAiMetadataRequestVersionRef.current !== requestVersion) return
      setClipAiMetadataDialog((current) =>
        current?.clipId === clip.id
          ? {
              ...current,
              status: 'error',
              error:
                error instanceof Error ? error.message : '片段识别失败',
            }
          : current,
      )
    }
  }

  function toggleClipAiMetadataTag(tag: string) {
    setClipAiMetadataDialog((current) => {
      if (!current || current.status !== 'ready') return current
      if (current.selectedTags.includes(tag)) {
        return {
          ...current,
          selectedTags: current.selectedTags.filter((entry) => entry !== tag),
        }
      }
      const reference = projectAssetRefsRef.current.find(
        (entry) => entry.id === current.clipId,
      )
      const availableTagCount = Math.max(
        0,
        CLIP_DETAIL_TAG_MAX_COUNT - (reference?.tags.length ?? 0),
      )
      if (current.selectedTags.length >= availableTagCount) return current
      return { ...current, selectedTags: [...current.selectedTags, tag] }
    })
  }

  function applyClipAiMetadataSuggestion() {
    const dialog = clipAiMetadataDialog
    if (!dialog || dialog.status !== 'ready') return
    const reference = projectAssetRefsRef.current.find(
      (entry) => entry.id === dialog.clipId,
    )
    if (!reference) {
      closeClipAiMetadataDialog()
      return
    }
    const patch: Partial<Pick<ProjectAssetRef, 'tags' | 'note'>> = {}
    if (dialog.selectedTags.length > 0) {
      patch.tags = mergeClipAiTags(
        reference.tags,
        dialog.selectedTags,
        CLIP_DETAIL_TAG_MAX_COUNT,
      )
    }
    if (dialog.applyNote && dialog.note) patch.note = dialog.note
    if (patch.tags || patch.note !== undefined) {
      updateClipReferenceMetadata(dialog.clipId, patch)
      showClipActionNotice('AI 标签与备注已应用，可继续手动修改。')
    }
    closeClipAiMetadataDialog()
  }

  async function autoAnnotateImportedClipReferences(
    requests: readonly ImportedClipAiMetadataRequest[],
  ) {
    if (!window.desktopBridge?.analyzeAiVisualFrames) return
    if (!aiServiceProfilesStateRef.current.activeVisionProfileId) {
      showClipActionNotice(
        '素材已导入；选择画面理解模型后，可在详情页使用 AI 识别。',
      )
      return
    }

    showClipActionNotice('素材已导入，正在自动识别标签与备注…')
    let appliedCount = 0
    let failedCount = 0
    const uniqueRequests = [
      ...new Map(
        requests.map((request) => [request.referenceId, request]),
      ).values(),
    ]
    for (const request of uniqueRequests) {
      if (!appMountedRef.current) return
      const { referenceId } = request
      try {
        const result = await analyzeClipAiMetadata(referenceId)
        const currentReference = projectAssetRefsRef.current.find(
          (reference) => reference.id === referenceId,
        )
        if (!currentReference) continue
        const patch = createImportedClipAiMetadataPatch(
          currentReference,
          result.suggestion,
          request.placeholder,
        )
        if (!patch) continue
        setProjectAssetRefs((current) => {
          const next = current.map((reference) =>
            reference.id === referenceId
              ? {
                  ...reference,
                  ...patch,
                  annotated:
                    (patch.tags ?? reference.tags).length > 0 ||
                    (patch.note ?? reference.note).trim().length > 0,
                }
              : reference,
          )
          projectAssetRefsRef.current = next
          return next
        })
        appliedCount += 1
      } catch (error) {
        failedCount += 1
        console.warn(
          `[Aurora library] Failed to auto annotate ${referenceId}`,
          error,
        )
      }
    }

    if (!appMountedRef.current) return
    if (appliedCount > 0) {
      showClipActionNotice(
        `已自动为 ${appliedCount} 个新素材添加标签与备注。`,
      )
    } else if (failedCount > 0) {
      showClipActionNotice('自动标注暂未完成，可稍后在详情页重新识别。')
    }
  }

  function enqueueImportedClipAutoMetadata(
    requests: readonly ImportedClipAiMetadataRequest[],
  ) {
    if (requests.length === 0) return
    const run = () => autoAnnotateImportedClipReferences(requests)
    importedClipAiMetadataQueueRef.current =
      importedClipAiMetadataQueueRef.current.then(run, run)
  }

  const ensureClipPreview = useCallback(async (
    clip: VideoClip,
    forceProxy = false,
    rebuild = false,
  ) => {
    const bridge = window.desktopBridge
    if (!clip.sourcePath || !bridge?.ensureMediaPreview) {
      setPreviewPlaybackByAsset((current) => ({
        ...current,
        [clip.assetId]: {
          status: 'failed',
          sourcePath: clip.sourcePath ?? '',
          playbackPath: null,
          usesPreviewProxy: false,
          error: '当前环境无法访问原视频，不能准备可播放预览。',
        },
      }))
      return false
    }

    const currentPreview = previewPlaybackByAsset[clip.assetId]
    if (
      !rebuild &&
      currentPreview?.status === 'ready' &&
      currentPreview.sourcePath === clip.sourcePath &&
      (!forceProxy || currentPreview.usesPreviewProxy)
    ) {
      return true
    }

    const requestKey = [
      clip.assetId,
      clip.sourcePath,
      forceProxy ? 'proxy' : 'auto',
      rebuild ? 'rebuild' : 'reuse',
    ].join('\u0000')
    const runningRequest = previewRequestsRef.current.get(requestKey)
    if (runningRequest) return runningRequest

    const operationId = bridge.createMediaOperationId()
    setPreviewPlaybackByAsset((current) => ({
      ...current,
      [clip.assetId]: {
        status: 'preparing',
        sourcePath: clip.sourcePath!,
        playbackPath:
          current[clip.assetId]?.sourcePath === clip.sourcePath
            ? current[clip.assetId].playbackPath
            : null,
        usesPreviewProxy:
          current[clip.assetId]?.sourcePath === clip.sourcePath
            ? current[clip.assetId].usesPreviewProxy
            : false,
        error: null,
      },
    }))
    setPreviewProgressByAsset((current) => ({
      ...current,
      [clip.assetId]: 0,
    }))

    const request = (async () => {
      try {
        const result = await bridge.ensureMediaPreview({
          assetId: clip.assetId,
          sourcePath: clip.sourcePath!,
          forceProxy,
          rebuild,
          operationId,
        })
        const resolvedSourcePath = result.metadata?.filePath ?? clip.sourcePath!
        if (result.metadata) {
          setMediaAssets((current) =>
            current.map((asset) =>
              asset.id === clip.assetId
                ? applyMediaFileMetadata(asset, result.metadata)
                : asset,
            ),
          )
        }
        setPreviewPlaybackByAsset((current) => ({
          ...current,
          [clip.assetId]: {
            status: 'ready',
            sourcePath: resolvedSourcePath,
            playbackPath: result.playbackPath,
            usesPreviewProxy: result.usesPreviewProxy,
            error: null,
          },
        }))
        return true
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '视频预览准备失败'
        setPreviewPlaybackByAsset((current) => ({
          ...current,
          [clip.assetId]: {
            status: 'failed',
            sourcePath: clip.sourcePath!,
            playbackPath: null,
            usesPreviewProxy: false,
            error: message,
          },
        }))
        return false
      } finally {
        previewRequestsRef.current.delete(requestKey)
        setPreviewProgressByAsset((current) => {
          const next = { ...current }
          delete next[clip.assetId]
          return next
        })
      }
    })()

    previewRequestsRef.current.set(requestKey, request)
    return request
  }, [previewPlaybackByAsset])

  useEffect(() => {
    const clip = currentView === 'frame-ring'
      ? frameRingClip
      : currentView === 'video-library'
        ? detailClip
        : null
    if (
      !clip?.sourcePath ||
      clip.sampleCount > 0 ||
      !requiresKnownVideoPreviewProxy(clip.codec)
    ) {
      return
    }

    const previewState = previewPlaybackByAsset[clip.assetId]
    if (
      previewState?.sourcePath === clip.sourcePath &&
      (previewState.status === 'preparing' ||
        previewState.status === 'failed' ||
        (previewState.status === 'ready' && previewState.usesPreviewProxy))
    ) {
      return
    }

    void ensureClipPreview(clip, true)
  }, [
    currentView,
    detailClip,
    ensureClipPreview,
    frameRingClip,
    previewPlaybackByAsset,
  ])

  async function queueClipVisualIndex(clip: VideoClip, rebuild = false) {
    const bridge = window.desktopBridge
    if (!clip.sourcePath || !bridge?.buildVisualIndex) {
      showClipActionNotice(
        '当前环境无法访问原视频；请在 Aurora 桌面程序中重新定位或导入素材。',
      )
      return false
    }

    const operationId = bridge.createMediaOperationId()
    setMediaAssets((current) =>
      current.map((asset) =>
        asset.id === clip.assetId
          ? {
              ...asset,
              indexTask: 'building',
              indexError: null,
            }
          : asset,
      ),
    )
    setIndexProgressByAsset((current) => ({
      ...current,
      [clip.assetId]: 0,
    }))
    showClipActionNotice(
      rebuild ? '正在重新建立视觉索引…' : '正在分析画面并建立视觉索引…',
    )

    try {
      const result = await bridge.buildVisualIndex({
        assetId: clip.assetId,
        sourcePath: clip.sourcePath,
        rebuild,
        operationId,
      })
      const nextIndex: MediaVisualIndex = {
        assetId: clip.assetId,
        sourceFingerprint: getMediaSourceFingerprint(result.metadata),
        createdAt: result.createdAt,
        version: result.version,
        posterPath: result.posterPath,
        previewPath: result.previewPath,
        frames: result.frames,
      }
      setVisualIndexes((current) => [
        ...current.filter((index) => index.assetId !== clip.assetId),
        nextIndex,
      ])
      if (
        rebuild ||
        nextIndex.sourceFingerprint !== clip.sourceFingerprint
      ) {
        frameRingSmartUndoRef.current = null
        setFrameExclusions((current) =>
          current.filter((exclusion) => exclusion.assetId !== clip.assetId),
        )
      }
      setMediaAssets((current) =>
        current.map((asset) => {
          if (asset.id !== clip.assetId) return asset
          const inspected = result.metadata
            ? applyMediaFileMetadata(asset, result.metadata)
            : asset
          return {
            ...inspected,
            thumbnail: result.posterPath,
            sampleCount: result.frames.length,
            indexTask: 'idle',
            indexError: null,
          }
        }),
      )
      setProjectAssetRefs((current) =>
        current.map((reference) =>
          reference.assetId === clip.assetId
            ? { ...reference, thumbnailFollowsProject: false }
            : reference,
        ),
      )
      showClipActionNotice(
        `视觉索引已建立，共生成 ${result.frames.length} 个关键帧。`,
      )
      return true
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '视觉索引建立失败'
      setMediaAssets((current) =>
        current.map((asset) =>
          asset.id === clip.assetId
            ? {
                ...asset,
                indexTask: 'failed',
                indexError: message,
              }
            : asset,
        ),
      )
      showClipActionNotice(`视觉索引建立失败：${message}`)
      return false
    } finally {
      setIndexProgressByAsset((current) => {
        const next = { ...current }
        delete next[clip.assetId]
        return next
      })
    }
  }

  function updateSelectedFrameAnnotation(
    frameId: string,
    annotation: FrameRingAnnotation,
  ) {
    if (!selectedClip) return
    const currentAnnotations = frameAnnotationsRef.current
    const existing = currentAnnotations.find(
      (entry) =>
        entry.assetId === selectedClip.assetId && entry.frameId === frameId,
    )
    const previousTags = existing?.tags ?? selectedClip.tags.slice(0, 8)
    const previousNote = existing?.note ?? selectedClip.note
    const tagsChanged =
      annotation.tags.length !== previousTags.length ||
      annotation.tags.some((tag, index) => tag !== previousTags[index])
    const noteChanged = annotation.note !== previousNote
    const nextAnnotation: StoredFrameAnnotation = {
      assetId: selectedClip.assetId,
      frameId,
      favorite: annotation.favorite,
      rating: annotation.rating,
      tags: annotation.tags,
      note: annotation.note,
      tagsSource: tagsChanged
        ? 'manual'
        : existing
          ? existing.tagsSource ?? 'manual'
          : 'ai',
      noteSource: noteChanged
        ? 'manual'
        : existing
          ? existing.noteSource ?? 'manual'
          : 'ai',
    }
    const nextAnnotations = [
      ...currentAnnotations.filter(
        (entry) =>
          entry.assetId !== nextAnnotation.assetId ||
          entry.frameId !== frameId,
      ),
      nextAnnotation,
    ]
    frameAnnotationsRef.current = nextAnnotations
    setFrameAnnotations(nextAnnotations)
  }

  function captureSelectedFrameSmartTarget() {
    if (!selectedClip?.sourcePath || selectedClip.online) return null
    const asset = mediaAssetsRef.current.find(
      (entry) => entry.id === selectedClip.assetId,
    )
    const visualIndex = visualIndexesRef.current.find(
      (entry) => entry.assetId === selectedClip.assetId,
    )
    if (
      !asset ||
      asset.sourceFingerprint !== selectedClip.sourceFingerprint ||
      !visualIndex ||
      visualIndex.sourceFingerprint !== selectedClip.sourceFingerprint
    ) {
      return null
    }
    return {
      assetId: selectedClip.assetId,
      clipId: selectedClip.id,
      projectId: selectedClip.projectId,
      projectTitle:
        displayProjects.find((project) => project.id === selectedClip.projectId)
          ?.title ?? '',
      filename: selectedClip.filename,
      sourceFingerprint: selectedClip.sourceFingerprint,
      visualIndexCreatedAt: visualIndex.createdAt,
      visualIndex,
      frames: selectedClip.indexedFrames,
      inheritedTags: selectedClip.tags.slice(0, 8),
      inheritedNote: selectedClip.note,
    }
  }

  function selectedFrameSmartTargetIsCurrent(target: {
    assetId: string
    clipId: string
    sourceFingerprint: string
    visualIndexCreatedAt: string
  }) {
    const asset = mediaAssetsRef.current.find(
      (entry) => entry.id === target.assetId,
    )
    const visualIndex = visualIndexesRef.current.find(
      (entry) => entry.assetId === target.assetId,
    )
    return Boolean(
      selectedClip?.id === target.clipId &&
        asset &&
        asset.sourceFingerprint === target.sourceFingerprint &&
        visualIndex &&
        visualIndex.sourceFingerprint === target.sourceFingerprint &&
        visualIndex.createdAt === target.visualIndexCreatedAt,
    )
  }

  async function scanSelectedFramesForSmartOrganize(
    sensitivity: FrameRingSmartSensitivity,
  ): Promise<FrameRingSmartScanResult> {
    const bridge = window.desktopBridge
    const target = captureSelectedFrameSmartTarget()
    if (!bridge?.analyzeFrameQuality || !target || target.frames.length === 0) {
      throw new Error('当前素材还没有可分析的帧环')
    }

    const response = await bridge.analyzeFrameQuality({
      sensitivity,
      frames: target.frames.map((frame) => ({
        frameId: frame.id,
        imagePath: frame.imagePath,
        timeSeconds: frame.timeSeconds,
      })),
    })
    if (!selectedFrameSmartTargetIsCurrent(target)) {
      throw new Error('分析期间素材已变化，请重新扫描')
    }

    const validFrameIds = new Set(target.frames.map((frame) => frame.id))
    return {
      version: response.version,
      blankCandidates: response.blankCandidates.flatMap((candidate) =>
        validFrameIds.has(candidate.frameId)
          ? [{
              frameId: candidate.frameId,
              kind: candidate.kind,
              confidence: candidate.confidence,
              reason: candidate.reason,
            }]
          : [],
      ),
      duplicateGroups: response.duplicateGroups.flatMap((group) => {
        const removeFrameIds = group.removeFrameIds.filter((frameId) =>
          validFrameIds.has(frameId),
        )
        if (!validFrameIds.has(group.keepFrameId) || removeFrameIds.length === 0) {
          return []
        }
        return [{
          id: group.groupId,
          keepFrameId: group.keepFrameId,
          removeFrameIds,
          reason: group.reason,
          confidence: group.confidence,
        }]
      }),
    }
  }

  async function analyzeSelectedFramesForSmartOrganize(
    frameIds: readonly string[],
  ): Promise<FrameRingAnnotationSuggestion[]> {
    const bridge = window.desktopBridge
    const target = captureSelectedFrameSmartTarget()
    const visionProfileId = aiServiceProfilesState.activeVisionProfileId
    if (!bridge?.analyzeAiVisualFrames || !target) {
      throw new Error('AI 画面理解仅可在 Aurora 桌面版中使用')
    }
    if (!visionProfileId) {
      throw new Error('请先在探索页设置中选择画面理解模型')
    }

    const requestedFrameIds = new Set(frameIds)
    const requestedFrames = target.frames.filter((frame) =>
      requestedFrameIds.has(frame.id),
    )
    if (requestedFrames.length === 0) return []

    const response = await bridge.analyzeAiVisualFrames({
      visionProfileId,
      candidates: requestedFrames.map((frame) => ({
        resultId: `frame-smart:${target.assetId}:${target.sourceFingerprint}:${frame.id}`,
        assetId: target.assetId,
        clipId: target.clipId,
        projectId: target.projectId,
        frameId: frame.id,
        sourceFingerprint: target.sourceFingerprint,
        imagePath: frame.imagePath,
        timeSeconds: frame.timeSeconds,
        filename: target.filename,
        projectTitle: target.projectTitle,
        tags: target.inheritedTags,
        note: target.inheritedNote,
        analysisTier: 'visual-index',
      })),
    })
    if (!response.ok) throw new Error(response.error.message)
    if (!selectedFrameSmartTargetIsCurrent(target)) {
      throw new Error('理解画面期间素材已变化，请重新扫描')
    }

    return response.data.frames.flatMap((suggestion) =>
      requestedFrameIds.has(suggestion.frameId)
        ? [createFrameRingAnnotationSuggestion({
            frameId: suggestion.frameId,
            descriptionZh: suggestion.descriptionZh,
            keywordsZh: suggestion.keywordsZh,
          })]
        : [],
    )
  }

  function applySelectedFrameSmartOrganize(
    request: FrameRingSmartApplyRequest,
  ): FrameRingSmartApplyResult {
    const target = captureSelectedFrameSmartTarget()
    if (!target || !selectedFrameSmartTargetIsCurrent(target)) {
      throw new Error('素材已变化，请重新扫描后再应用')
    }

    const validFrameIds = new Set(
      target.visualIndex.frames.map((frame) => frame.id),
    )
    const currentExclusions = frameExclusionsRef.current
    const currentAnnotations = frameAnnotationsRef.current
    const exclusionKeys = new Set(
      currentExclusions
        .filter(
          (exclusion) =>
            exclusion.assetId === target.assetId &&
            exclusion.sourceFingerprint === target.sourceFingerprint,
        )
        .map((exclusion) => exclusion.frameId),
    )
    const now = new Date().toISOString()
    let excludedCount = 0
    let nextExclusions = [...currentExclusions]
    request.exclusions.forEach((exclusion) => {
      if (!validFrameIds.has(exclusion.frameId)) return
      const duplicateOfFrameId =
        exclusion.reason === 'duplicate' &&
        exclusion.duplicateOfFrameId !== exclusion.frameId &&
        exclusion.duplicateOfFrameId !== null &&
        validFrameIds.has(exclusion.duplicateOfFrameId)
          ? exclusion.duplicateOfFrameId
          : null
      if (!exclusionKeys.has(exclusion.frameId)) excludedCount += 1
      exclusionKeys.add(exclusion.frameId)
      nextExclusions = nextExclusions.filter(
        (entry) =>
          entry.assetId !== target.assetId ||
          entry.sourceFingerprint !== target.sourceFingerprint ||
          entry.frameId !== exclusion.frameId,
      )
      nextExclusions.push({
        assetId: target.assetId,
        sourceFingerprint: target.sourceFingerprint,
        frameId: exclusion.frameId,
        reason: exclusion.reason,
        duplicateOfFrameId,
        createdAt: now,
      })
    })

    const annotationsByFrameId = new Map(
      currentAnnotations
        .filter((annotation) => annotation.assetId === target.assetId)
        .map((annotation) => [annotation.frameId, annotation]),
    )
    let annotatedCount = 0
    request.annotations.forEach((suggestion) => {
      if (
        !validFrameIds.has(suggestion.frameId) ||
        exclusionKeys.has(suggestion.frameId)
      ) {
        return
      }
      const existing = annotationsByFrameId.get(suggestion.frameId)
      const protectTags = Boolean(
        existing && (existing.tagsSource ?? 'manual') === 'manual',
      )
      const protectNote = Boolean(
        existing && (existing.noteSource ?? 'manual') === 'manual',
      )
      const generatedTags = suggestion.tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 10)
      const generatedNote = Array.from(suggestion.note.trim())
        .slice(0, 20)
        .join('')
      const nextAnnotation: StoredFrameAnnotation = {
        assetId: target.assetId,
        frameId: suggestion.frameId,
        favorite: existing?.favorite ?? false,
        rating: existing?.rating ?? 0,
        tags: protectTags
          ? existing?.tags ?? target.inheritedTags
          : generatedTags.length > 0
            ? generatedTags
            : existing?.tags ?? target.inheritedTags,
        note: protectNote
          ? existing?.note ?? target.inheritedNote
          : generatedNote || existing?.note || target.inheritedNote,
        tagsSource: protectTags ? 'manual' : 'ai',
        noteSource: protectNote ? 'manual' : 'ai',
      }
      const changed =
        !existing ||
        nextAnnotation.favorite !== existing.favorite ||
        nextAnnotation.rating !== existing.rating ||
        nextAnnotation.note !== existing.note ||
        nextAnnotation.tagsSource !== (existing.tagsSource ?? 'manual') ||
        nextAnnotation.noteSource !== (existing.noteSource ?? 'manual') ||
        nextAnnotation.tags.length !== existing.tags.length ||
        nextAnnotation.tags.some((tag, index) => tag !== existing.tags[index])
      if (changed) {
        annotatedCount += 1
        annotationsByFrameId.set(suggestion.frameId, nextAnnotation)
      }
    })

    const nextAnnotations = [
      ...currentAnnotations.filter(
        (annotation) => annotation.assetId !== target.assetId,
      ),
      ...annotationsByFrameId.values(),
    ]
    if (excludedCount === 0 && annotatedCount === 0) {
      return { excludedCount: 0, annotatedCount: 0 }
    }

    frameRingSmartUndoRef.current = {
      assetId: target.assetId,
      clipId: target.clipId,
      sourceFingerprint: target.sourceFingerprint,
      visualIndexCreatedAt: target.visualIndexCreatedAt,
      annotations: currentAnnotations.filter(
        (annotation) => annotation.assetId === target.assetId,
      ),
      exclusions: currentExclusions.filter(
        (exclusion) => exclusion.assetId === target.assetId,
      ),
    }
    frameExclusionsRef.current = nextExclusions
    frameAnnotationsRef.current = nextAnnotations
    setFrameExclusions(nextExclusions)
    setFrameAnnotations(nextAnnotations)
    return { excludedCount, annotatedCount }
  }

  function undoSelectedFrameSmartOrganize() {
    const snapshot = frameRingSmartUndoRef.current
    if (!snapshot || !selectedFrameSmartTargetIsCurrent(snapshot)) return false
    const nextExclusions = [
      ...frameExclusionsRef.current.filter(
        (exclusion) => exclusion.assetId !== snapshot.assetId,
      ),
      ...snapshot.exclusions,
    ]
    const nextAnnotations = [
      ...frameAnnotationsRef.current.filter(
        (annotation) => annotation.assetId !== snapshot.assetId,
      ),
      ...snapshot.annotations,
    ]
    frameRingSmartUndoRef.current = null
    frameExclusionsRef.current = nextExclusions
    frameAnnotationsRef.current = nextAnnotations
    setFrameExclusions(nextExclusions)
    setFrameAnnotations(nextAnnotations)
    return true
  }

  async function revealSelectedFrameSource(sourcePath: string) {
    return window.desktopBridge?.revealProjectFile(sourcePath) ?? false
  }

  async function deleteSelectedIndexFrame(frameId: string) {
    if (!selectedClip) return false
    const visualIndex = visualIndexesRef.current.find(
      (index) => index.assetId === selectedClip.assetId,
    )
    if (
      !visualIndex ||
      visualIndex.sourceFingerprint !== selectedClip.sourceFingerprint ||
      !selectedClip.indexedFrames.some((frame) => frame.id === frameId)
    ) return false

    const nextExclusions = [
      ...frameExclusionsRef.current.filter(
        (exclusion) =>
          exclusion.assetId !== selectedClip.assetId ||
          exclusion.sourceFingerprint !== selectedClip.sourceFingerprint ||
          exclusion.frameId !== frameId,
      ),
      {
        assetId: selectedClip.assetId,
        sourceFingerprint: selectedClip.sourceFingerprint,
        frameId,
        reason: 'manual' as const,
        duplicateOfFrameId: null,
        createdAt: new Date().toISOString(),
      },
    ]
    frameRingSmartUndoRef.current = null
    frameExclusionsRef.current = nextExclusions
    setFrameExclusions(nextExclusions)

    if (selectedClip.indexedFrames.length <= 1) {
      showClipActionNotice('最后一帧已移除，需要重新建立视觉索引。')
      transitionToView('video-library')
    }
    return true
  }

  async function chooseFrameExportDirectory() {
    const directoryPath = await window.desktopBridge?.selectDirectory({
      title: '选择 Aurora 单帧保存位置',
      buttonLabel: '选择此文件夹',
    })
    if (!directoryPath) return null
    return {
      path: directoryPath,
      name: directoryPath.split(/[\\/]/).pop() || directoryPath,
    }
  }

  async function exportFrameStill(
    request: FrameRingStillExportRequest,
  ): Promise<FrameRingExportResult> {
    const bridge = window.desktopBridge
    if (!bridge || !request.sourcePath) {
      return {
        ok: false,
        message: '无法读取原视频，请在 Aurora 桌面程序中重新定位素材。',
      }
    }

    let directoryPath = request.directoryPath
    if (!directoryPath.startsWith('/') && !/^[a-z]:[\\/]/i.test(directoryPath)) {
      const selectedDirectory = await bridge.selectDirectory({
        title: '选择 Aurora 单帧保存位置',
        buttonLabel: '导出到此文件夹',
      })
      if (!selectedDirectory) {
        return { ok: false, message: '已取消单帧导出' }
      }
      directoryPath = selectedDirectory
    }
    const separator = directoryPath.includes('\\') ? '\\' : '/'
    const destinationPath = `${directoryPath.replace(/[\\/]+$/, '')}${separator}${request.filename}`

    try {
      const result = await bridge.exportStill({
        sourcePath: request.sourcePath,
        destinationPath,
        timeSeconds: request.timeSeconds,
      })
      return {
        ok: true,
        outputPath: result.destinationPath,
        message: `单帧导出完成 · ${request.filename}`,
      }
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? `单帧导出失败：${error.message}`
            : '单帧导出失败，请检查原视频和保存位置。',
      }
    }
  }

  async function registerExportedClipInProject(
    request: FrameRingClipExportRequest,
    outputPath: string,
    targetProjectId: string,
  ): Promise<ExportedClipRegistrationResult> {
    const bridge = window.desktopBridge
    const targetProject = displayProjects.find(
      (project) => project.id === targetProjectId,
    )
    const targetBaseProject = projectsRef.current.find(
      (project) => project.id === targetProjectId,
    )
    if (!bridge || !targetProject || !targetBaseProject) {
      throw new Error('目标项目已不存在')
    }

    const metadata = await bridge.inspectMediaFile(outputPath)
    const sourceFingerprint = getMediaSourceFingerprint(metadata)
    const currentAssets = mediaAssetsRef.current
    const currentReferences = projectAssetRefsRef.current
    const registrationResolution = resolveExportedMediaRegistration(
      targetProjectId,
      metadata.filePath,
      sourceFingerprint,
      currentAssets,
      currentReferences,
    )
    const {
      existingAsset,
      existingReference,
      nextOrder,
      sourceChanged,
    } = registrationResolution
    let registeredAsset = existingAsset
      ? applyMediaFileMetadata(existingAsset, metadata)
      : createExportedMediaAsset(metadata)

    if (sourceChanged) {
      registeredAsset = {
        ...registeredAsset,
        thumbnail: null,
        sampleCount: 0,
        indexTask: 'idle',
        indexError: null,
      }
    }

    let nextReferences = sourceChanged
      ? currentReferences.map((reference) =>
          reference.assetId === registeredAsset.id
            ? {
                ...reference,
                thumbnailFollowsProject: true,
              }
            : reference,
        )
      : [...currentReferences]

    if (!existingReference) {
      nextReferences.push({
        id: `${targetProjectId}:ref:${registeredAsset.id}`,
        projectId: targetProjectId,
        assetId: registeredAsset.id,
        order: nextOrder,
        thumbnailFollowsProject: !registeredAsset.thumbnail,
        tags: [EXPORTED_CLIP_MATERIAL_TAG],
        annotated: false,
        note: `帧环剪辑导出 · ${request.sourceFilename}`.slice(
          0,
          CLIP_DETAIL_NOTE_MAX_LENGTH,
        ),
      })
    }

    const nextAssets = existingAsset
      ? currentAssets.map((asset) =>
          asset.id === registeredAsset.id ? registeredAsset : asset,
        )
      : [...currentAssets, registeredAsset]
    const nextProjectMediaCounts = getProjectMediaCounts(
      nextReferences,
      nextAssets,
    )
    const nextProjects = projectsRef.current.map((project) =>
      project.id === targetProjectId
        ? {
            ...project,
            videoCount:
              nextProjectMediaCounts.get(targetProjectId)?.totalVideoCount ??
              0,
            updatedAt: formatProjectTimestamp(),
          }
        : project,
    )

    mediaAssetsRef.current = nextAssets
    projectAssetRefsRef.current = nextReferences
    projectsRef.current = nextProjects
    setMediaAssets(nextAssets)
    setProjectAssetRefs(nextReferences)
    setProjects(nextProjects)

    if (sourceChanged) {
      setVisualIndexes((current) =>
        current.filter(
          (index) => index.assetId !== registeredAsset.id,
        ),
      )
      setFrameAnnotations((current) =>
        current.filter(
          (annotation) =>
            annotation.assetId !== registeredAsset.id,
        ),
      )
      setFrameExclusions((current) =>
        current.filter(
          (exclusion) => exclusion.assetId !== registeredAsset.id,
        ),
      )
    }

    let thumbnailReady = Boolean(registeredAsset.thumbnail)
    if (!thumbnailReady) {
      try {
        const thumbnail = await bridge.createMediaThumbnail({
          assetId: registeredAsset.id,
          sourcePath: metadata.filePath,
          durationSeconds: registeredAsset.durationSeconds,
        })
        registeredAsset = {
          ...registeredAsset,
          thumbnail: thumbnail.thumbnailPath,
        }
        const assetsWithThumbnail = mediaAssetsRef.current.map((asset) =>
          asset.id === registeredAsset.id ? registeredAsset : asset,
        )
        const referencesWithThumbnail =
          projectAssetRefsRef.current.map((reference) =>
            reference.assetId === registeredAsset.id
              ? {
                  ...reference,
                  thumbnailFollowsProject: false,
                }
              : reference,
          )
        mediaAssetsRef.current = assetsWithThumbnail
        projectAssetRefsRef.current = referencesWithThumbnail
        setMediaAssets(assetsWithThumbnail)
        setProjectAssetRefs(referencesWithThumbnail)
        thumbnailReady = true
      } catch (error) {
        console.warn(
          `[Aurora export] Failed to create thumbnail for ${metadata.filename}`,
          error,
        )
      }
    }

    return {
      projectTitle: targetProject.title,
      addedReference: !existingReference,
      thumbnailReady,
    }
  }

  async function exportFrameClip(
    request: FrameRingClipExportRequest,
  ): Promise<FrameRingExportResult> {
    const bridge = window.desktopBridge
    if (!bridge || !request.sourcePath) {
      return {
        ok: false,
        message: '无法读取原视频，请在 Aurora 桌面程序中重新定位素材。',
      }
    }
    const targetProject = request.addToProjectId
      ? displayProjects.find(
          (project) => project.id === request.addToProjectId,
        )
      : null
    if (request.addToProjectId && !targetProject) {
      return {
        ok: false,
        message: '当前项目已不存在，未开始导出。',
      }
    }

    const extension = request.defaultFilename.split('.').pop()?.toLowerCase()
    const destinationPath = await bridge.selectSavePath({
      title: '导出 Aurora 视频片段',
      defaultPath: request.defaultFilename,
      buttonLabel: targetProject ? '导出并加入项目' : '导出',
      filters: [
        {
          name: extension === 'mp4' ? 'MP4 视频' : 'QuickTime 视频',
          extensions: [extension === 'mp4' ? 'mp4' : 'mov'],
        },
      ],
    })
    if (!destinationPath) {
      return { ok: false, message: '已取消视频片段导出' }
    }

    const resolutionMatch = request.resolution.match(
      /(\d{3,5})\s*[x×]\s*(\d{3,5})/i,
    )
    const fps = Number.parseFloat(request.fps)
    const normalizedFormat = request.format.toLowerCase()
    const videoCodec: ClipVideoCodec = normalizedFormat.includes('h.264')
      ? 'h264'
      : normalizedFormat.includes('hevc') ||
          normalizedFormat.includes('h.265')
        ? 'hevc'
        : normalizedFormat.includes('4444')
          ? 'prores4444'
          : 'prores422hq'

    try {
      const result = await bridge.exportClip({
        sourcePath: request.sourcePath,
        destinationPath,
        startSeconds: request.inSeconds,
        endSeconds: request.outSeconds,
        videoCodec,
        audioCodec: 'aac',
        width: resolutionMatch
          ? Number.parseInt(resolutionMatch[1], 10)
          : undefined,
        height: resolutionMatch
          ? Number.parseInt(resolutionMatch[2], 10)
          : undefined,
        fps: Number.isFinite(fps) && fps > 0 ? fps : undefined,
      })
      if (targetProject && request.addToProjectId) {
        try {
          const registration = await registerExportedClipInProject(
            request,
            result.destinationPath,
            request.addToProjectId,
          )
          const registrationStatus = registration.addedReference
            ? `并已加入“${registration.projectTitle}”`
            : `“${registration.projectTitle}”中已存在该素材`
          return {
            ok: true,
            outputPath: result.destinationPath,
            addedToProject: true,
            message: `视频片段导出完成，${registrationStatus}${
              registration.thumbnailReady
                ? ''
                : ' · 缩略图稍后补齐'
            }`,
          }
        } catch (error) {
          console.warn(
            '[Aurora export] Clip was exported but could not be added to the project',
            error,
          )
          return {
            ok: true,
            outputPath: result.destinationPath,
            addedToProject: false,
            message: `视频片段已导出，但未能加入“${targetProject.title}”`,
          }
        }
      }
      return {
        ok: true,
        outputPath: result.destinationPath,
        message: `视频片段导出完成 · ${
          result.destinationPath.split(/[\\/]/).pop() ?? request.defaultFilename
        }`,
      }
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? `视频片段导出失败：${error.message}`
            : '视频片段导出失败，请检查编码和保存位置。',
      }
    }
  }

  function handleClipSelect(clipId: string) {
    if (suppressNextClipClick.current) {
      suppressNextClipClick.current = false
      return
    }

    setSelectedClipId(clipId)
  }

  function openFrameRing(clipId: string) {
    if (pageTransitionActiveRef.current) return
    const clip = videoClips.find((entry) => entry.id === clipId)
    if (!clip) return
    if (clip.online) {
      const asset = mediaAssetsRef.current.find(
        (entry) => entry.id === clip.assetId && isOnlineMediaAsset(entry),
      )
      if (!asset || !isOnlineMediaAsset(asset)) return
      const projectIndex = projects.findIndex(
        (project) => project.id === clip.projectId,
      )
      if (projectIndex >= 0) {
        setActiveIndex(projectIndex)
        setSelectedProjectId(clip.projectId)
      }
      setSelectedClipId(clipId)
      setOnlineFrameRingAsset(asset)
      setFrameRingFocusTarget(null)
      setActiveNav('project-details')
      transitionToView('frame-ring')
      setSearchOpen(false)
      return
    }
    setOnlineFrameRingAsset(null)
    const projectIndex = projects.findIndex(
      (project) => project.id === clip.projectId,
    )
    if (projectIndex < 0) return
    setActiveIndex(projectIndex)
    setSelectedProjectId(clip.projectId)
    setSelectedClipId(clipId)
    setFrameRingFocusTarget(null)
    setActiveNav('project-details')
    transitionToView('frame-ring')
    setSearchOpen(false)
  }
  openFrameRingRef.current = openFrameRing

  useEffect(() => {
    const externalClip =
      externalVideoAddCandidate?.clip.id === externalVideoNavigationClipId
        ? externalVideoAddCandidate.clip
        : null
    const persistentClipExists = videoClips.some(
      (clip) => clip.id === externalVideoNavigationClipId,
    )
    if (
      !externalVideoNavigationClipId ||
      pageTransitionActiveRef.current ||
      pageTransitionPhase !== 'idle' ||
      (!externalClip && !persistentClipExists)
    ) {
      return
    }
    const clipId = externalVideoNavigationClipId
    setExternalVideoNavigationClipId(null)
    if (externalClip) {
      setSelectedClipId(externalClip.id)
      setFrameRingFocusTarget(null)
      setActiveNav('project-details')
      transitionToView('frame-ring')
      setSearchOpen(false)
      return
    }
    openFrameRingRef.current(clipId)
  }, [
    externalVideoAddCandidate,
    externalVideoNavigationClipId,
    pageTransitionPhase,
    transitionToView,
    videoClips,
  ])

  useEffect(() => {
    if (
      !externalVideoAddCandidate ||
      currentView === 'frame-ring' ||
      externalVideoNavigationClipId !== null ||
      clipAddDialogId !== null ||
      pageTransitionPhase !== 'idle'
    ) {
      return
    }
    setSelectedClipId((current) =>
      current === externalVideoAddCandidate.clip.id ? null : current,
    )
    setExternalVideoAddCandidate(null)
  }, [
    clipAddDialogId,
    currentView,
    externalVideoAddCandidate,
    externalVideoNavigationClipId,
    pageTransitionPhase,
  ])

  function openSelectedFrameRing() {
    if (pageTransitionActiveRef.current) return
    if (!detailClip) return
    openFrameRing(detailClip.id)
  }

  function openDiscoveryLocalFrameRing(
    result: DiscoveryFootageResult,
    intent: FrameRingEntryIntent = 'preview',
  ) {
    if (result.source !== 'local') return false
    const projectId = result.footage.auroraProjectId
    const clipId = result.footage.auroraClipId
    if (!projectId || !clipId) return false

    const projectIndex = projects.findIndex(
      (project) => project.id === projectId,
    )
    const clip = videoClips.find(
      (entry) => entry.id === clipId && entry.projectId === projectId,
    )
    if (
      projectIndex < 0 ||
      !clip ||
      pageTransitionActiveRef.current
    ) {
      return false
    }

    setActiveIndex(projectIndex)
    setSelectedProjectId(projectId)
    setSelectedClipId(clipId)
    const requestedTime = result.footage.auroraTimeSeconds
    setFrameRingFocusTarget(
      typeof requestedTime === 'number' || intent !== 'preview'
        ? {
            clipId,
            frameId: result.footage.auroraFrameId,
            timeSeconds: requestedTime ?? 0,
            requestId: Date.now(),
            intent,
          }
        : null,
    )
    setHoveredClipId(null)
    setQuery('')
    setActiveNav('project-details')
    setSearchOpen(false)
    return transitionToView('frame-ring')
  }

  function openDiscoveryLocalModel(result: DiscoveryModelResult) {
    const projectId = result.model.auroraProjectId
    const modelId = result.model.auroraModelId
    const projectIndex = projects.findIndex(
      (project) =>
        project.id === projectId && (project.kind ?? 'video') === '3d',
    )
    const model = modelAssetsRef.current.find(
      (entry) => entry.id === modelId && entry.projectId === projectId,
    )
    if (
      projectIndex < 0 ||
      !model ||
      pageTransitionActiveRef.current
    ) {
      return false
    }

    setActiveIndex(projectIndex)
    setSelectedProjectId(projectId)
    setSelectedModelId(modelId)
    setSelectedClipId(null)
    setHoveredClipId(null)
    setQuery('')
    setActiveNav('project-details')
    setSearchOpen(false)
    return transitionToView('model-viewer')
  }

  function getOnlineAssetForResult(
    result: DiscoveryOnlineVideoResult,
  ): (MediaAsset & {
    online: OnlineMediaDescriptor
    sourcePath: null
  }) | null {
    const assetId =
      result.online.auroraAssetId ??
      `asset:online:${result.online.provider}:${result.online.mediaKind}:${result.online.mediaId}`
    const candidate =
      (bilibiliSelectionAsset?.id === assetId
        ? bilibiliSelectionAsset
        : undefined) ??
      ONLINE_MEDIA_PROVIDER_IDS.flatMap(
        (provider) => onlineSearchAssetsByProvider[provider],
      ).find((asset) => asset.id === assetId) ??
      mediaAssetsRef.current.find((asset) => asset.id === assetId)
    return candidate && isOnlineMediaAsset(candidate) ? candidate : null
  }

  async function searchOnlineProviderForDiscovery({
    provider,
    query: searchQuery,
    page,
    limit,
    searchType,
  }: DiscoveryOnlineSearchRequest): Promise<DiscoveryOnlineSearchPage> {
    if (!onlineProviderEnabled[provider]) {
      throw new Error(`${getOnlineProviderLabel(provider)}来源尚未启用`)
    }
    const requestState = onlineSearchRequestStateRef.current[provider]
    const startsNewSearch = page === 1 || requestState.query !== searchQuery
    const searchSequence = startsNewSearch
      ? requestState.sequence + 1
      : requestState.sequence
    if (startsNewSearch) {
      requestState.sequence = searchSequence
      requestState.query = searchQuery
      setOnlineSearchAssetsByProvider((current) => ({
        ...current,
        [provider]: [],
      }))
      if (provider === 'bilibili') setBilibiliSelectionAsset(null)
    }

    const bridge = window.desktopBridge
    const legacyRequest = {
      query: searchQuery,
      page,
      limit,
      ...(searchType ? { searchType } : {}),
    }
    const response = bridge?.searchOnlineProvider
      ? await bridge.searchOnlineProvider({
          provider,
          ...legacyRequest,
        })
      : provider === 'bilibili' && bridge?.searchBilibiliVideos
        ? await bridge.searchBilibiliVideos({
            query: searchQuery,
            page,
            limit,
            ...(searchType === 'all' ||
            searchType === 'video' ||
            searchType === 'bangumi' ||
            searchType === 'film' ||
            searchType === 'live'
              ? { searchType }
              : {}),
          })
        : provider === 'tencent' && bridge?.searchTencentVideos
          ? await bridge.searchTencentVideos({
              query: searchQuery,
              page,
              limit,
            })
          : null
    if (!response) {
      throw new Error(
        `${getOnlineProviderLabel(provider)}搜索仅可在 Aurora 桌面版中使用`,
      )
    }
    const responsePage = Number.isFinite(response.page)
      ? Math.max(1, Math.floor(response.page))
      : page
    const responsePageSize = Number.isFinite(response.pageSize)
      ? Math.max(1, Math.floor(response.pageSize))
      : Math.max(1, response.results.length || limit)
    const responseTotalCount = Number.isFinite(response.totalCount)
      ? Math.max(0, Math.floor(response.totalCount))
      : response.results.length
    const responseHasMore = response.hasMore === true
    const responseNextPage = responseHasMore
      ? Number.isFinite(response.nextPage)
        ? Math.max(responsePage + 1, Math.floor(response.nextPage ?? 0))
        : responsePage + 1
      : null
    if (
      requestState.sequence !== searchSequence ||
      requestState.query !== searchQuery ||
      !onlineProviderEnabledRef.current[provider]
    ) {
      return {
        results: [],
        page: responsePage,
        pageSize: responsePageSize,
        totalCount: responseTotalCount,
        hasMore: false,
        nextPage: null,
      }
    }

    const descriptorsByAssetId = new Map<
      string,
      OnlineProviderSelectionDescriptor
    >()
    const existingTransientAssets =
      onlineSearchAssetsByProviderRef.current[provider]
    const searchAssets = response.results.flatMap((descriptor) => {
      const mediaId = descriptor.mediaId.trim()
      if (!mediaId || descriptor.source !== provider) return []
      const assetId = `asset:online:${provider}:${descriptor.kind}:${mediaId}`
      const existing =
        mediaAssetsRef.current.find((asset) => asset.id === assetId) ??
        existingTransientAssets.find((asset) => asset.id === assetId)
      const asset = createOnlineMediaAsset(descriptor, existing)
      if (!asset) return []
      descriptorsByAssetId.set(asset.id, descriptor)
      return [asset]
    })

    setOnlineSearchAssetsByProvider((current) => {
      const assetsById = new Map(
        (page === 1 ? [] : current[provider]).map(
          (asset) => [asset.id, asset] as const,
        ),
      )
      searchAssets.forEach((asset) => assetsById.set(asset.id, asset))
      return {
        ...current,
        [provider]: [...assetsById.values()],
      }
    })
    if (provider === 'bilibili' && page === 1) {
      setBilibiliSelectionAsset(searchAssets[0] ?? null)
    }

    const results = createOnlineDiscoveryResults({
      mediaAssets: searchAssets,
      projectAssetRefs: projectAssetRefsRef.current,
      projects: projectsRef.current,
      transientAssetIds: searchAssets.map((asset) => asset.id),
      resolveThumbnailUrl: resolveLibraryMediaUrl,
    }).map((result) => {
      const descriptor = result.online.auroraAssetId
        ? descriptorsByAssetId.get(result.online.auroraAssetId)
        : undefined
      const tags = [...result.tags, ...(descriptor?.tags ?? [])].filter(
        (tag, index, values) =>
          Boolean(tag.trim()) && values.indexOf(tag) === index,
      )
      return {
        ...result,
        tags,
        searchTerms: [
          ...(result.searchTerms ?? []),
          response.query,
          ...(descriptor?.tags ?? []),
        ],
      }
    })
    return {
      results,
      page: responsePage,
      pageSize: responsePageSize,
      totalCount: responseTotalCount,
      hasMore: responseHasMore,
      nextPage: responseNextPage,
    }
  }

  function openOfficialOnlineMedia(online: OnlineMediaDescriptor) {
    if (online.provider !== 'bilibili') {
      window.open(online.canonicalUrl, '_blank', 'noopener,noreferrer')
      return true
    }
    const bridge = window.desktopBridge
    if (!bridge?.openBilibiliVideo) {
      showClipActionNotice('B站在线播放仅可在 Aurora 桌面版中使用。')
      return false
    }
    if (online.kind === 'video') {
      return bridge.openBilibiliVideo({ bvid: online.mediaId })
    }
    return bridge.openBilibiliVideo({ episodeId: online.mediaId })
  }

  function openDiscoveryOnlineVideo(result: DiscoveryOnlineVideoResult) {
    let asset = getOnlineAssetForResult(result)
    if (!asset) {
      asset = createOnlineMediaAsset({
        source: result.online.provider,
        kind: result.online.mediaKind,
        mediaId: result.online.mediaId,
        title: result.title,
        description: result.description,
        coverUrl: null,
        thumbnailPath: null,
        author: result.online.author,
        url: result.online.canonicalUrl,
        canonicalUrl: result.online.canonicalUrl,
        duration: result.duration,
        publishedAt: result.online.publishedAt,
        tags: [...result.tags],
      })
    }
    if (!asset || pageTransitionActiveRef.current) return false

    const reference = projectAssetRefsRef.current.find(
      (entry) => entry.assetId === asset.id,
    )
    if (reference) {
      const projectIndex = projects.findIndex(
        (project) => project.id === reference.projectId,
      )
      if (projectIndex >= 0) {
        setActiveIndex(projectIndex)
        setSelectedProjectId(reference.projectId)
      }
      setSelectedClipId(reference.id)
    } else {
      setSelectedClipId(null)
    }
    setOnlineFrameRingAsset(asset)
    setFrameRingFocusTarget(null)
    setHoveredClipId(null)
    setQuery('')
    setActiveNav('project-details')
    setSearchOpen(false)
    return transitionToView('frame-ring')
  }

  function toggleOnlineAssetFavorite(
    asset: OnlineVideoAddCandidate['asset'],
  ) {
    const nextAsset = { ...asset, favorite: !asset.favorite }
    const hasProjectReference = projectAssetRefsRef.current.some(
      (reference) => reference.assetId === asset.id,
    )
    setMediaAssets((current) => {
      const exists = current.some((entry) => entry.id === asset.id)
      if (!nextAsset.favorite && !hasProjectReference) {
        return current.filter((entry) => entry.id !== asset.id)
      }
      return exists
        ? current.map((entry) =>
            entry.id === asset.id ? nextAsset : entry,
          )
        : [...current, nextAsset]
    })
    setBilibiliSelectionAsset((current) =>
      current?.id === asset.id ? nextAsset : current,
    )
    setOnlineSearchAssetsByProvider((current) => ({
      ...current,
      [asset.online.provider]: current[asset.online.provider].map((entry) =>
        entry.id === asset.id ? nextAsset : entry,
      ),
    }))
    setOnlineFrameRingAsset((current) =>
      current?.id === asset.id ? nextAsset : current,
    )
    showClipActionNotice(
      nextAsset.favorite
        ? `已收藏${getOnlineProviderLabel(asset.online.provider)}内容；Aurora 只保存链接和封面。`
        : '已取消收藏。',
    )
    return true
  }

  function toggleDiscoveryOnlineFavorite(
    result: DiscoveryOnlineVideoResult,
  ) {
    const asset = getOnlineAssetForResult(result)
    if (!asset) return false
    return toggleOnlineAssetFavorite(asset)
  }

  function beginAddOnlineAssetToProject(
    candidate: OnlineVideoAddCandidate,
  ) {
    const { asset, clip } = candidate
    const membershipIds = new Set(
      projectAssetRefsRef.current
        .filter((reference) => reference.assetId === asset.id)
        .map((reference) => reference.projectId),
    )
    const firstTarget = displayProjects.find(
      (project) =>
        project.kind === 'video' && !membershipIds.has(project.id),
    )
    setExternalVideoAddCandidate(null)
    setOnlineVideoAddCandidate(candidate)
    setClipAddDialogId(clip.id)
    setClipAddMode(firstTarget ? 'existing' : 'new')
    setClipAddTargetProjectId(firstTarget?.id ?? '')
    setClipAddNewProjectName(`${clip.filename} 项目`)
    setClipAddNewProjectEnglishName('')
    return true
  }

  function beginAddDiscoveryOnlineToProject(
    result: DiscoveryOnlineVideoResult,
  ) {
    const asset = getOnlineAssetForResult(result)
    if (!asset) return false
    const clip = {
      ...createOnlineVideoClip(asset),
      tags: [...result.tags],
      annotated: result.tags.length > 0 || result.description.trim().length > 0,
      note: result.description,
    }
    return beginAddOnlineAssetToProject({ asset, clip })
  }

  function toggleOnlineFrameRingFavorite() {
    return onlineFrameRingAsset
      ? toggleOnlineAssetFavorite(onlineFrameRingAsset)
      : false
  }

  function beginAddOnlineFrameRingToProject() {
    return onlineFrameRingAsset && onlineFrameRingClip
      ? beginAddOnlineAssetToProject({
          asset: onlineFrameRingAsset,
          clip: onlineFrameRingClip,
        })
      : false
  }

  function handleDiscoveryResultAction({
    actionId,
    result,
  }: DiscoveryResultActionRequest): boolean | Promise<boolean> {
    if (result.detailType === 'online-video') {
      if (actionId === 'open-online-video') {
        return openDiscoveryOnlineVideo(result)
      }
      if (actionId === 'toggle-online-favorite') {
        return toggleDiscoveryOnlineFavorite(result)
      }
      if (actionId === 'add-online-to-project') {
        return beginAddDiscoveryOnlineToProject(result)
      }
      return false
    }

    if (actionId === 'open-model') {
      return result.detailType === 'model'
        ? openDiscoveryLocalModel(result)
        : false
    }

    if (actionId === 'reveal-file') {
      if (result.detailType === 'model') {
        return revealModelInFinder(result.model.auroraModelId).then(() => true)
      }
      if (result.detailType === 'footage' && result.source === 'local') {
        const clip = videoClips.find(
          (entry) => entry.id === result.footage.auroraClipId,
        )
        return clip
          ? revealClipInFinder(clip).then(() => true)
          : false
      }
      return false
    }

    if (actionId === 'add-footage-to-project') {
      if (result.detailType !== 'footage' || result.source !== 'local') {
        return false
      }
      const clip = videoClips.find(
        (entry) => entry.id === result.footage.auroraClipId,
      )
      if (!clip) return false
      beginAddClipToProject(clip.id)
      return true
    }

    if (result.detailType !== 'footage' || result.source !== 'local') {
      return false
    }

    if (actionId === 'open-footage') {
      return openDiscoveryLocalFrameRing(result, 'preview')
    }
    if (actionId === 'trim-footage') {
      return openDiscoveryLocalFrameRing(result, 'trim')
    }
    if (actionId === 'export-still') {
      return openDiscoveryLocalFrameRing(result, 'export-still')
    }
    return false
  }

  function renderProjectCardRasterSurface(
    project: Project & {
      usesEmptyGlass: boolean
      kind: ProjectKind
      modelCount: number
    },
  ) {
    return (
      <div className="projectCardRasterSurface">
        <span className="projectGlassAnchor projectGlassAnchorTopLeft" />
        <span className="projectGlassAnchor projectGlassAnchorTopRight" />
        <span className="projectGlassAnchor projectGlassAnchorBottomRight" />
        <span className="projectGlassAnchor projectGlassAnchorBottomLeft" />
        <span className="cardLight" />
        <span className="cardImage" />
        <span className="cardFrame" />
        <span
          key={`card-copy:${windowsTextRasterRevision}`}
          className="cardCopy"
          data-raster-revision={windowsTextRasterRevision}
          aria-hidden="true"
        >
          <strong>{project.title}</strong>
          <em className={project.subtitle.trim() ? undefined : 'isEmpty'}>
            {project.subtitle}
          </em>
          <small>
            {project.kind === '3d'
              ? `${project.modelCount} 个模型 · 三维项目`
              : formatProjectMediaSummary(project)}
          </small>
          <small>更新于 {project.updatedAt}</small>
        </span>
        <span className="projectCardMenuControl" aria-hidden="true">
          <MoreHorizontal
            className="projectCardMenuGlyph"
            size={25.5}
            strokeWidth={1.65}
          />
          <span className="projectCardMenuAnchor" />
        </span>
      </div>
    )
  }

  function renderClipCardLayers(clip: VideoClip) {
    return (
      <>
        <span className="videoClipSurface" />
        <span className="videoClipImage">
          <span className="videoClipColorImage" />
        </span>
        <span className="videoClipFrame" aria-hidden="true" />
        <span className="videoClipLight" aria-hidden="true" />
        {clip.resolutionBadge && (
          <span className="clipBadge">{clip.resolutionBadge}</span>
        )}
        <span className="clipDuration">{clip.duration}</span>
        <span className="clipInfo">
          <span className="clipInfoGlass" aria-hidden="true" />
          <strong>{clip.filename}</strong>
          <small>
            {clip.capturedAt} · {clip.resolution}
          </small>
          <span className="clipTagList">
            {clip.tags.slice(0, 3).map((tag) => (
              <em key={tag}>{tag}</em>
            ))}
          </span>
        </span>
        <span className="clipStatus" aria-label={clip.annotated ? '已标注' : '未标注'}>
          <MoreHorizontal size={16 * videoLibraryLayout.cardContentScale} strokeWidth={1.5} />
        </span>
      </>
    )
  }

  const carouselOffsets =
    releaseSource === 'step'
      ? getStepReleaseOffsets(projects.length, releaseStepDelta)
      : getCarouselOffsets(
          projects.length,
          useLoopEdgeCards && (isDragging || isReleasing),
        )

  const carouselCards = carouselOffsets.map((offset) => {
    const index = wrapProjectIndex(activeIndex + offset, projects.length)
    const project = displayProjects[index]
    const isActive = offset === 0
    const style = {
      ...getCardVisualStyle(offset, dragProgress, responsiveMetrics, useMotionEdgeFade),
      '--cover': project.usesEmptyGlass ? 'none' : `url(${project.cover})`,
    } as CSSProperties
    const cardKey = `carousel-slot-${offset}`

    return { cardKey, index, isActive, offset, project, style }
  })
  const galleryReflectionProjects = carouselCards.map(
    ({ project }) => project,
  )
  const galleryReflectionProjectIds = new Set(
    galleryReflectionProjects.map((project) => project.id),
  )
  const galleryReflectionPreloadProjects = startupGalleryProjects.filter(
    (project) => !galleryReflectionProjectIds.has(project.id),
  )

  const projectHitMotionSignal = `${activeIndex}|${dragOffset}|${isDragging}|${isReleasing}|${isRecycling}|${releaseDuration}|${cameraPose.yaw}|${cameraPose.pitch}|${viewportWidth}|${viewportHeight}|${hoveredProjectCardKey ?? ''}`
  const galleryGlassContentSignal = carouselCards
    .map(({ cardKey, project }) => `${cardKey}:${project.usesEmptyGlass}`)
    .join('|')
  const galleryGeometrySyncSignature = [
    galleryGlassContentSignal,
    projectHitMotionSignal,
  ].join('|')

  useEffect(() => {
    const glassLayer = galleryGlassLayerRef.current
    if (!glassLayer) return
    const geometryCacheValid =
      galleryGeometryCacheSignatureRef.current ===
      galleryGeometrySyncSignature
    glassLayer.dataset.geometrySourceRevision =
      galleryGeometrySyncSignature
    glassLayer.dataset.geometryCacheValid = String(geometryCacheValid)
    glassLayer.dataset.glassCacheValid = String(geometryCacheValid)
    if (
      currentView !== 'gallery' ||
      pageTransitionPhase !== 'idle'
    ) {
      return
    }
    if (geometryCacheValid) {
      glassLayer.dataset.geometryReused = 'true'
      return
    }

    let frame: number | undefined
    let sampledFrames = 0
    const maxFrames = isReleasing
      ? Math.ceil((releaseDuration + 100) / 16)
      : isDragging || isCameraDragging
        ? 2
        : 26
    galleryGeometrySyncCountRef.current += 1
    glassLayer.dataset.geometryReused = 'false'
    glassLayer.dataset.geometrySyncCount = String(
      galleryGeometrySyncCountRef.current,
    )

    const syncHitTargets = () => {
      const stage = projectStageRef.current
      const hitLayer = projectHitLayerRef.current
      if (!stage || !hitLayer) return

      const stageRect = stage.getBoundingClientRect()
      const glassLayerRect = glassLayer.getBoundingClientRect()
      const cardsByKey = new Map<string, HTMLElement>(
        Array.from(stage.querySelectorAll<HTMLElement>('.projectCard')).map((card) => [
          card.dataset.carouselKey ?? '',
          card,
        ] as const),
      )
      const backgroundGlassesByKey = new Map<string, HTMLElement>(
        Array.from(
          glassLayer.querySelectorAll<HTMLElement>(
            '.galleryProjectProjectedGlass',
          ),
        ).map((glass) => [glass.dataset.carouselKey ?? '', glass] as const),
      )

      hitLayer.querySelectorAll<HTMLElement>('.projectHitTarget').forEach((target) => {
        const card = cardsByKey.get(target.dataset.carouselKey ?? '')
        const carouselKey = target.dataset.carouselKey ?? ''
        const glass = backgroundGlassesByKey.get(carouselKey)
        if (!card) {
          target.style.visibility = 'hidden'
          target.style.pointerEvents = 'none'
          if (glass) glass.style.visibility = 'hidden'
          return
        }

        const cardRect = card.getBoundingClientRect()
        const cardStyle = getComputedStyle(card)
        const opacity = Number.parseFloat(cardStyle.opacity)
        const interactionHidden = target.getAttribute('aria-hidden') === 'true'
        const projectedCorners = Array.from(
          card.querySelectorAll<HTMLElement>('.projectHitAnchor'),
        ).map((anchor) => {
          const rect = anchor.getBoundingClientRect()
          return {
            x: rect.left + rect.width / 2 - stageRect.left,
            y: rect.top + rect.height / 2 - stageRect.top,
          }
        })

        if (projectedCorners.length === 4) {
          const left = Math.min(...projectedCorners.map((corner) => corner.x))
          const top = Math.min(...projectedCorners.map((corner) => corner.y))
          const right = Math.max(...projectedCorners.map((corner) => corner.x))
          const bottom = Math.max(...projectedCorners.map((corner) => corner.y))
          const width = Math.max(1, right - left)
          const height = Math.max(1, bottom - top)

          target.style.left = `${left}px`
          target.style.top = `${top}px`
          target.style.width = `${width}px`
          target.style.height = `${height}px`
          target.style.clipPath = `polygon(${projectedCorners
            .map(
              (corner) =>
                `${((corner.x - left) / width) * 100}% ${((corner.y - top) / height) * 100}%`,
            )
            .join(', ')})`
        } else {
          target.style.left = `${cardRect.left - stageRect.left}px`
          target.style.top = `${cardRect.top - stageRect.top}px`
          target.style.width = `${cardRect.width}px`
          target.style.height = `${cardRect.height}px`
          target.style.clipPath = 'none'
        }
        target.style.zIndex = cardStyle.zIndex
        target.style.visibility = opacity > 0.05 && !interactionHidden ? 'visible' : 'hidden'
        target.style.pointerEvents = opacity > 0.05 && !interactionHidden ? 'auto' : 'none'

        const rasterSurface = card.querySelector<HTMLElement>(
          '.projectCardRasterSurface',
        )
        const glassCornerRadius =
          (rasterSurface?.offsetWidth ?? card.offsetWidth) *
          HOME_CARD_GLASS_CORNER_RADIUS_RATIO
        if (
          syncProjectedGlass(
            glass,
            Array.from(
              card.querySelectorAll<HTMLElement>('.projectGlassAnchor'),
            ),
            glassLayerRect,
            opacity,
            [
              glassCornerRadius,
              glassCornerRadius,
              glassCornerRadius,
              glassCornerRadius,
            ],
          ) &&
          glass
        ) {
          glass.style.zIndex = cardStyle.zIndex
        }
      })

      hitLayer
        .querySelectorAll<HTMLElement>('.projectMenuHitTarget')
        .forEach((target) => {
          const card = cardsByKey.get(target.dataset.carouselKey ?? '')
          const anchor = card?.querySelector<HTMLElement>(
            '.projectCardMenuAnchor',
          )
          if (!card || !anchor) {
            target.style.visibility = 'hidden'
            target.style.pointerEvents = 'none'
            return
          }

          const anchorRect = anchor.getBoundingClientRect()
          const cardStyle = getComputedStyle(card)
          const opacity = Number.parseFloat(cardStyle.opacity)
          const interactionHidden =
            target.getAttribute('aria-hidden') === 'true'
          const cardZIndex =
            Number.parseInt(cardStyle.zIndex, 10) || 0

          target.style.left = `${anchorRect.left - stageRect.left}px`
          target.style.top = `${anchorRect.top - stageRect.top}px`
          target.style.width = `${Math.max(1, anchorRect.width)}px`
          target.style.height = `${Math.max(1, anchorRect.height)}px`
          target.style.zIndex = String(cardZIndex + 1)
          target.style.visibility =
            opacity > 0.05 && !interactionHidden ? 'visible' : 'hidden'
          target.style.pointerEvents =
            opacity > 0.05 && !interactionHidden ? 'auto' : 'none'
        })

      sampledFrames += 1
      if (sampledFrames < maxFrames) {
        frame = window.requestAnimationFrame(syncHitTargets)
      } else {
        galleryGeometryCacheSignatureRef.current =
          galleryGeometrySyncSignature
        glassLayer.dataset.geometryPreparedRevision =
          galleryGeometrySyncSignature
        glassLayer.dataset.geometryCacheValid = 'true'
        glassLayer.dataset.glassCacheValid = 'true'
      }
    }

    syncHitTargets()
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [
    currentView,
    galleryGeometrySyncSignature,
    isCameraDragging,
    isDragging,
    isReleasing,
    galleryGlassContentSignal,
    pageTransitionPhase,
    projectHitMotionSignal,
    releaseDuration,
  ])

  /*
   * Freeze the outgoing scene so its final frame leaves as one stable
   * composition. The incoming scene must paint during the 440ms enter phase;
   * otherwise a cold WebGL/Three.js layer appears only after the DOM motion.
   */
  const pageSceneSuspended = pageTransitionPhase === 'exiting'

  return (
    <main
      className={`auroraApp view-${currentView} pageTransition${pageTransitionDirection === 'deeper' ? 'Deeper' : 'Shallower'} ${hasPageTransitioned ? 'hasPageTransitioned' : ''} ${pageTransitionPhase === 'exiting' ? 'isPageExiting' : ''} ${pageTransitionPhase === 'entering' ? 'isPageEntering' : ''} ${hasPageColorGrade ? 'hasPageColorGrade' : ''} ${isCameraDragging ? 'isCameraDragging' : ''}`}
      style={stageStyle}
      data-platform={appPlatform}
      data-windows-text-raster-revision={
        appPlatform === 'win32' ? windowsTextRasterRevision : undefined
      }
      data-startup-locked={startupGateActive || undefined}
      aria-busy={startupGateActive}
      {...cameraGesture}
    >
      {window.desktopBridge && (
        <div
          className="windowDragFrame"
          data-camera-gesture="block"
          aria-hidden="true"
        >
          <span className="windowDragEdge windowDragEdgeTop" />
          <span className="windowDragEdge windowDragEdgeRight" />
          <span className="windowDragEdge windowDragEdgeBottom" />
          <span className="windowDragEdge windowDragEdgeLeft" />
        </div>
      )}
      <WindowsWindowControls />
      <OnlineAccountCenter
        open={accountCenterOpen}
        onOpenChange={setAccountCenterOpen}
        enabledProviders={onlineProviderEnabled}
        onProviderEnabledChange={(provider, enabled) =>
          setOnlineProviderEnabled((current) => ({
            ...current,
            [provider]: enabled,
          }))
        }
      />
      <div className="stageBackground" aria-hidden="true">
        {(Object.keys(PAGE_VIEW_DEPTH) as AppView[]).map((view) => {
          const background = pageSettings[view].background
          if (!background) return null
          return (
            <StageBackgroundMedia
              key={`${view}:${background.url}`}
              active={currentView === view}
              background={background}
              view={view}
            />
          )
        })}
      </div>
      {currentReflectionSurfaceNotice && (
        <div
          className="backgroundReflectionStatus uiGlassShell"
          data-state={currentReflectionSurfaceNotice.state}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {currentReflectionSurfaceNotice.message}
        </div>
      )}
      <GalleryReflectionCanvas
        active={currentView === 'gallery'}
        suspended={pageSceneSuspended}
        stageRef={projectStageRef}
        projects={galleryReflectionProjects}
        preloadProjects={galleryReflectionPreloadProjects}
        materialTint={galleryPageSettings.materialTint}
        motionSignal={`${activeIndex}|${dragOffset}|${isDragging}|${isReleasing}|${isRecycling}|${releaseDuration}|${cameraPose.yaw}|${cameraPose.pitch}|${viewportWidth}|${viewportHeight}|${responsiveMetrics.layoutScale}`}
        layoutSignal={`${viewportWidth}|${viewportHeight}|${responsiveMetrics.layoutScale}|${responsiveMetrics.planeLeft}|${responsiveMetrics.planeTop}`}
        cameraYaw={cameraPose.yaw}
        cameraPitch={cameraPose.pitch}
        surfaceData={reflectionSurfaces.gallery}
      />
      <div
        ref={galleryGlassLayerRef}
        className="galleryProjectedGlassLayer"
        data-glass-active={currentView === 'gallery'}
        aria-hidden="true"
      >
        {carouselCards
          .filter(({ project }) => project.usesEmptyGlass)
          .map(({ cardKey }) => (
            <span
              key={`gallery-glass:${cardKey}`}
              className="galleryProjectProjectedGlass"
              data-carousel-key={cardKey}
            />
          ))}
      </div>
      <VideoLibraryReflectionCanvas
        active={currentView === 'video-library'}
        sourceDomAvailable={videoLibraryMounted}
        suspended={pageSceneSuspended}
        clips={visibleProjectClips}
        preloadClips={videoReflectionPreloadClips}
        detailClip={detailClip}
        materialTint={videoPageSettings.materialTint}
        materialTintFilter={getMaterialTintFilter(
          videoPageSettings.materialTint,
        )}
        pageColorGradeFilter={getPageColorGradeFilter(videoPageSettings)}
        cameraYaw={cameraPose.yaw}
        cameraPitch={cameraPose.pitch}
        surfaceData={reflectionSurfaces['video-library']}
        motionSignal={`${selectedProject.id}|${selectedClipId ?? ''}|${hoveredClipId ?? ''}|${clipTrackPosition}|${clipOverscroll}|${isClipDragging}|${isClipReleasing}|${cameraPose.yaw}|${cameraPose.pitch}|${viewportWidth}|${viewportHeight}`}
      />
      <VideoLibraryReflectionCanvas
        active={currentView === 'model-library'}
        sourceDomAvailable={Boolean(modelLibraryProject)}
        suspended={pageSceneSuspended}
        clips={modelReflectionClips}
        detailClip={modelReflectionDetail ?? undefined}
        materialTint={modelLibraryPageSettings.materialTint}
        materialTintFilter={getMaterialTintFilter(
          modelLibraryPageSettings.materialTint,
        )}
        pageColorGradeFilter={getPageColorGradeFilter(
          modelLibraryPageSettings,
        )}
        cameraYaw={cameraPose.yaw}
        cameraPitch={cameraPose.pitch}
        motionSignal={`${modelLibraryProject?.id ?? ''}|${modelLibrarySelectedModel?.id ?? ''}|${modelReflectionClips.map((model) => model.id).join(',')}|${cameraPose.yaw}|${cameraPose.pitch}|${viewportWidth}|${viewportHeight}`}
        sourceScopeSelector=".modelLibraryView"
        cardSelector=".modelAssetCard.clipRowBottom"
        rendererName="model-reflection"
        canvasClassName="modelLibraryReflectionCanvas"
      />
      <div
        ref={clipGlassLayerRef}
        className="videoLibraryProjectedGlassLayer"
        data-glass-active={currentView === 'video-library'}
        aria-hidden="true"
      >
        {clipRenderRows.flatMap((rowItems, rowIndex) =>
          rowItems.map(({ clip }, columnIndex) => (
            <span
              key={`glass-slot:${rowIndex}:${columnIndex}`}
              className="videoClipProjectedGlass"
              data-clip-id={clip.id}
            />
          )),
        )}
        {detailClip && <span className="videoDetailProjectedGlass" />}
        <span
          className="modelLibraryEmptyProjectedGlass videoLibraryEmptyProjectedGlass uiGlassShell"
          data-empty-visible={filteredProjectClips.length === 0}
        />
      </div>
      <div
        ref={modelGlassLayerRef}
        className="videoLibraryProjectedGlassLayer modelLibraryProjectedGlassLayer"
        data-glass-active={
          currentView === 'model-library' && Boolean(modelLibraryProject)
        }
        aria-hidden="true"
      >
        {modelLibraryModels.map((model) => (
          <span
            key={`model-glass:${model.id}`}
            className="videoClipProjectedGlass"
            data-model-id={model.id}
          />
        ))}
        {modelLibrarySelectedModel && <span className="videoDetailProjectedGlass" />}
        {modelLibraryProject && (
          <span
            className="modelLibraryEmptyProjectedGlass uiGlassShell"
            data-empty-visible="false"
          />
        )}
      </div>
      <FavoritesGalleryView
        active={currentView === 'favorites'}
        items={favoriteGalleryItems}
        cameraYaw={cameraPose.yaw}
        cameraPitch={cameraPose.pitch}
        suspended={pageSceneSuspended}
        materialTint={pageSettings.favorites.materialTint}
        pedestalTint={pageSettings.favorites.pedestalTint}
        surfaceData={reflectionSurfaces.favorites}
        layoutSignal={`${viewportWidth}|${viewportHeight}|${responsiveMetrics.layoutScale}|${responsiveMetrics.planeLeft}|${responsiveMetrics.planeTop}`}
        textRasterRevision={windowsTextRasterRevision}
        onToggleFavorite={toggleFavoriteGalleryItem}
        onOpenItem={openFavoriteGalleryItem}
      />
      <header className="brandHeader" aria-label="Aurora">
        <img
          className="brandHeaderLogoMark"
          src={resolveDocumentAssetUrl('./aurora/startup-logo-mark.png')}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
        />
        <span className="brandHeaderWordmark" aria-hidden="true">
          <img
            src={resolveDocumentAssetUrl(
              './aurora/startup-aurora-wordmark.png',
            )}
            alt=""
            draggable={false}
            decoding="async"
          />
        </span>
      </header>

      <span
        className="sideDockGlassBackdrop uiGlassShell"
        aria-hidden="true"
      />
      <aside className="sideDock" aria-label="主导航">
        <nav className="dockNav">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`uiGlassInteractive ${activeNav === item.id ? 'active' : ''}`}
                type="button"
                aria-label={item.label}
                title={item.label}
                onClick={() => handleNavSelect(item.id)}
              >
                <Icon size={17} strokeWidth={1.65} />
              </button>
            )
          })}
        </nav>

        <div className="dockDivider" />

        <button
          className={`uiGlassInteractive ${settingsPanelOpen ? 'active' : ''}`}
          type="button"
          data-page-settings-toggle="true"
          aria-label="设置"
          title="设置"
          aria-expanded={settingsPanelOpen}
          aria-controls="page-settings-panel"
          onClick={() => {
            setSearchOpen(false)
            setCreateOpen(false)
            setAccountCenterOpen(false)
            setProjectMenu(null)
            setHoveredProjectCardKey(null)
            setEmptyProjectPromptId(null)
            setSettingsPanelOpen((open) => !open)
          }}
        >
          <Settings size={16} strokeWidth={1.65} />
        </button>
        <button
          className="uiGlassInteractive"
          type="button"
          aria-label="返回项目库"
          title="返回项目库"
          onClick={() => {
            if (pageTransitionActiveRef.current) return
            setActiveIndex(defaultActiveIndex)
            transitionToView('gallery')
            setActiveNav('library')
          }}
        >
          <RefreshCw size={16} strokeWidth={1.65} />
        </button>
      </aside>

      <input
        ref={backgroundFileInputRef}
        className="pageSettingsFileInput"
        type="file"
        accept=".avif,.bmp,.gif,.jpeg,.jpg,.png,.webp,.m4v,.mov,.mp4,.webm"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleBackgroundFileChange}
      />
      <input
        ref={particleFileInputRef}
        className="pageSettingsFileInput"
        type="file"
        accept="image/png,video/webm,video/quicktime,.png,.webm,.mov"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleParticleFileChange}
      />
      <input
        ref={projectCoverFileInputRef}
        className="pageSettingsFileInput"
        type="file"
        accept=".avif,.bmp,.gif,.jpeg,.jpg,.png,.webp"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleProjectCoverFileChange}
      />
      <input
        ref={projectImportFileInputRef}
        className="pageSettingsFileInput"
        type="file"
        accept="video/*,.mov,.mp4,.m4v,.mkv,.mxf,.avi,.webm,.mts,.m2ts,.ts,.mpg,.mpeg,.m2v,.vob,.wmv,.asf,.flv,.f4v,.ogv,.3gp,.3g2,.rm,.rmvb"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleProjectImportFileChange}
      />
      <input
        ref={modelImportFileInputRef}
        className="pageSettingsFileInput"
        type="file"
        accept="model/gltf-binary,.glb,.obj,.fbx,.mtl,image/*,.tga"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleModelImportFileChange}
      />

      {settingsPanelOpen && settingsPanelMode === 'visual' && (
        <PageSettingsPanel
          pageLabel={PAGE_VISUAL_CAPABILITIES[currentView].label}
          showParticleSettings={
            PAGE_VISUAL_CAPABILITIES[currentView].particles
          }
          showProjectSettings={
            PAGE_VISUAL_CAPABILITIES[currentView].projectDetails
          }
          showPedestalTint={currentView === 'favorites'}
          showMediaSourceSettings={currentView === 'online-search'}
          showAiSearchSettings={currentView === 'online-search'}
          aiVisionProfiles={aiServiceProfilesState.visionProfiles}
          aiEmbeddingProfiles={aiServiceProfilesState.embeddingProfiles}
          aiActiveVisionProfileId={
            aiServiceProfilesState.activeVisionProfileId
          }
          aiActiveEmbeddingProfileId={
            aiServiceProfilesState.activeEmbeddingProfileId
          }
          aiProviderSecureStorageAvailable={
            aiServiceProfilesState.secureStorageAvailable
          }
          aiProviderExternalMessage={aiProviderProfilesError}
          projectName={selectedProjectCustomization.title}
          projectDefaultName={selectedBaseProject.title}
          projectEnglishName={selectedProject.subtitle}
          projectDescription={selectedProject.description}
          projectDefaultDescription={getDefaultProjectDescription(
            selectedProject.kind,
          )}
          projectCoverUrl={
            selectedProject.usesEmptyGlass ? undefined : selectedProject.cover
          }
          projectCoverName={selectedProjectCustomization.cover?.name ?? null}
          settings={currentPageSettings}
          onClose={() => setSettingsPanelOpen(false)}
          onProjectNameChange={updateSelectedProjectName}
          onResetProjectName={resetSelectedProjectName}
          onProjectEnglishNameChange={updateSelectedProjectSubtitle}
          onProjectDescriptionChange={updateSelectedProjectDescription}
          onResetProjectDescription={resetSelectedProjectDescription}
          onChooseProjectCover={() =>
            openProjectCoverPicker(selectedProject.id)
          }
          onResetProjectCover={resetSelectedProjectCover}
          onChooseBackground={() => backgroundFileInputRef.current?.click()}
          onResetBackground={resetCurrentPageBackground}
          onResetAll={resetCurrentPageSettings}
          onOpenEmbyMediaSource={() => setSettingsPanelMode('emby')}
          onSelectAiServiceProfile={selectAiServiceProfile}
          onDeleteAiServiceProfile={deleteAiServiceProfile}
          onTestAiServiceProfile={testAiServiceProfile}
          onSaveAiServiceProfile={saveAiServiceProfile}
          onDetectAiLocalModels={detectAiLocalModels}
          particleImportState={particleImportState}
          onChooseParticleMedia={() => particleFileInputRef.current?.click()}
          onRemoveCustomParticleMedia={removeCustomParticleMedia}
          appUpdateState={appUpdateState}
          onCheckForUpdates={handleCheckForUpdates}
          onChange={updateCurrentPageSettings}
          onParticlesChange={updateCurrentPageParticles}
        />
      )}
      {settingsPanelOpen &&
        settingsPanelMode === 'emby' &&
        currentView === 'online-search' && (
          <EmbyConnectionPanel
            id="page-settings-panel"
            onClose={() => setSettingsPanelMode('visual')}
            onConnectionChange={() => {
              window.dispatchEvent(
                new Event('aurora:emby-connection-changed'),
              )
            }}
          />
        )}
      <div className="topTools" aria-label="顶部工具">
        <button
          className="uiGlassInteractive"
          type="button"
          aria-label="搜索"
          title="搜索"
          onClick={() => {
            setQuery('')
            setSettingsPanelOpen(false)
            setSearchOpen(true)
          }}
        >
          <Search size={18} strokeWidth={1.65} />
        </button>
      </div>

      <>
          <section
            className="pageIntro"
            data-page-active={currentView === 'gallery'}
            aria-hidden={currentView !== 'gallery' || undefined}
            inert={currentView !== 'gallery'}
            aria-label="项目库简介"
          >
            <h1 key={`gallery-title:${windowsTextRasterRevision}`}>项目库</h1>
            <p key={`gallery-subtitle:${windowsTextRasterRevision}`}>
              探索、管理和检索您的影像与三维资产
            </p>
            <span aria-hidden="true" />
          </section>

      <div
        className="galleryReflectionPreloadSourceLayer"
        data-gallery-preload-count={galleryReflectionPreloadProjects.length}
        aria-hidden="true"
        inert
      >
        {galleryReflectionPreloadProjects.map((project) => (
          <div
            key={`gallery-preload:${project.id}`}
            className="galleryReflectionPreloadSource"
            data-project-id={project.id}
            style={
              {
                '--cover': project.usesEmptyGlass
                  ? 'none'
                  : `url(${project.cover})`,
              } as CSSProperties
            }
          >
            {renderProjectCardRasterSurface(project)}
          </div>
        ))}
      </div>

      <section
        ref={projectStageRef}
        className={`projectStage ${isDragging ? 'isDragging' : ''} ${isReleasing ? 'isReleasing' : ''} ${isRecycling ? 'isRecycling' : ''} ${isCameraDragging ? 'isCameraDragging' : ''}`}
        data-page-active={currentView === 'gallery'}
        aria-hidden={currentView !== 'gallery' || undefined}
        inert={currentView !== 'gallery'}
        aria-label="项目轮播"
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={(event) => finishStageDrag(event, true)}
        onPointerCancel={(event) => finishStageDrag(event, false)}
      >
        <div className="projectCardStack">
          {carouselCards.map(({ cardKey, index, isActive, offset, project, style }) => (
            <div key={cardKey} className="projectCardPaintLayer" style={style}>
              <div className="projectCameraRig">
                <div
                  className={`projectCard ${isActive ? 'active' : ''} ${hoveredProjectCardKey === cardKey ? 'isHitHovered' : ''}`}
                  style={style}
                  data-project-index={index}
                  data-card-active={isActive}
                  data-carousel-key={cardKey}
                  data-carousel-offset={offset}
                  data-project-id={project.id}
                  data-project-empty={project.videoCount === 0}
                  data-project-empty-glass={project.usesEmptyGlass}
                  aria-hidden="true"
                >
                  <span className="projectHitAnchor projectHitAnchorTopLeft" />
                  <span className="projectHitAnchor projectHitAnchorTopRight" />
                  <span className="projectHitAnchor projectHitAnchorBottomRight" />
                  <span className="projectHitAnchor projectHitAnchorBottomLeft" />
                  {renderProjectCardRasterSurface(project)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div ref={projectHitLayerRef} className="projectHitLayer">
          {carouselCards.map(({ cardKey, index, isActive, offset, project }) => (
            <span key={`hit:${cardKey}`} className="projectHitGroup">
              <button
                className="projectHitTarget"
                type="button"
                data-project-index={index}
                data-card-active={isActive}
                data-carousel-key={cardKey}
                data-carousel-offset={offset}
                data-project-id={project.id}
                aria-hidden={Math.abs(offset) > 2 || undefined}
                tabIndex={Math.abs(offset) > 2 ? -1 : 0}
                aria-label={
                  project.kind === '3d'
                    ? project.modelCount > 0
                      ? `${project.title} 打开三维项目`
                      : `${project.title} 尚未导入模型`
                    : project.videoCount > 0
                    ? `${project.title} 打开项目`
                    : `${project.title} 尚未导入素材`
                }
                onPointerEnter={() => setHoveredProjectCardKey(cardKey)}
                onPointerLeave={() =>
                  setHoveredProjectCardKey((current) =>
                    current === cardKey ? null : current,
                  )
                }
                onPointerCancel={() =>
                  setHoveredProjectCardKey((current) =>
                    current === cardKey ? null : current,
                  )
                }
                onFocus={() => setHoveredProjectCardKey(cardKey)}
                onBlur={() =>
                  setHoveredProjectCardKey((current) =>
                    current === cardKey ? null : current,
                  )
                }
                onClick={() => goToProject(index)}
              />
              <button
                className="projectMenuHitTarget"
                type="button"
                data-carousel-key={cardKey}
                data-project-id={project.id}
                aria-hidden={
                  Math.abs(offset) > 2 ||
                  isDragging ||
                  isReleasing ||
                  isRecycling ||
                  undefined
                }
                tabIndex={
                  Math.abs(offset) > 2 ||
                  isDragging ||
                  isReleasing ||
                  isRecycling
                    ? -1
                    : 0
                }
                aria-label={`${project.title} 项目设置`}
                aria-haspopup="dialog"
                aria-expanded={projectMenu?.projectId === project.id}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={() => setHoveredProjectCardKey(cardKey)}
                onPointerLeave={() =>
                  setHoveredProjectCardKey((current) =>
                    current === cardKey && projectMenu?.projectId !== project.id
                      ? null
                      : current,
                  )
                }
                onFocus={() => setHoveredProjectCardKey(cardKey)}
                onBlur={() => {
                  if (projectMenu?.projectId !== project.id) {
                    setHoveredProjectCardKey((current) =>
                      current === cardKey ? null : current,
                    )
                  }
                }}
                onClick={(event) =>
                  openProjectMenu(event, project.id, cardKey)
                }
              />
            </span>
          ))}
        </div>
        <div
          className="ambientParticleLayer"
          data-particle-shape={galleryParticleShape}
          data-particle-rotation={
            Math.abs(galleryPageSettings.particles.rotationSpeed) > 0.001
              ? 'active'
              : 'stopped'
          }
          aria-hidden="true"
        >
          {galleryParticleShape === 'custom' &&
          galleryPageSettings.particles.customMedia?.kind === 'video' ? (
            <ParticleVideoCanvas
              src={galleryPageSettings.particles.customMedia.url}
              active={currentView === 'gallery'}
              width={viewportWidth}
              height={viewportHeight}
              sprites={galleryParticleRenderItems}
              rotationSpeed={galleryPageSettings.particles.rotationSpeed}
              trailRgb={currentParticlePalette.trail}
            />
          ) : (
            galleryParticleRenderItems.map((particle) => (
              <i key={particle.id} style={particle.cssStyle}>
                <span
                  className="ambientParticleVisual"
                  style={
                    galleryParticleShape === 'custom' &&
                    galleryPageSettings.particles.customMedia?.kind === 'image'
                      ? {
                          backgroundImage: toCssImageValue(
                            galleryPageSettings.particles.customMedia.url,
                          ),
                        }
                      : undefined
                  }
                />
              </i>
            ))
          )}
        </div>

      </section>

      <footer
        className="statusBar uiGlassShell"
        data-page-active={currentView === 'gallery'}
        aria-hidden={currentView !== 'gallery' || undefined}
        inert={currentView !== 'gallery'}
        aria-label="项目统计"
      >
        {storageStats.map((item) => {
          const Icon = item.icon
          return (
            <span key={`${item.label}:${windowsTextRasterRevision}`}>
              <Icon size={17} strokeWidth={1.55} />
              {item.label}
            </span>
          )
        })}
      </footer>

      <button
        className="createProjectButton uiGlassShell uiGlassInteractive"
        type="button"
        data-page-active={currentView === 'gallery'}
        aria-hidden={currentView !== 'gallery' || undefined}
        inert={currentView !== 'gallery'}
        onClick={() => {
          setSettingsPanelOpen(false)
          setProjectMenu(null)
          setHoveredProjectCardKey(null)
          setEmptyProjectPromptId(null)
          setCreateOpen(true)
        }}
      >
        <Plus size={17} strokeWidth={1.7} />
        <span
          key={`create-project-label:${windowsTextRasterRevision}`}
          className="createProjectButtonLabel"
        >
          新建项目
        </span>
      </button>
      </>

      {videoLibraryMounted && (
        <>
        <section
          className={`videoLibraryView ${isProjectFileDragActive ? 'isFileDragActive' : ''}`}
          data-page-active={currentView === 'video-library'}
          aria-hidden={currentView !== 'video-library' || undefined}
          inert={currentView !== 'video-library'}
          aria-label={`${selectedProject.title} 视频片段库`}
          onDragEnter={handleProjectFileDragEnter}
          onDragOver={handleProjectFileDragOver}
          onDragLeave={handleProjectFileDragLeave}
          onDrop={handleProjectFileDrop}
        >
          <div className="videoLibraryBreadcrumb" aria-label="当前位置">
            <button type="button" onClick={() => handleNavSelect('library')}>
              项目库
            </button>
            <ChevronRight size={14 * videoLibraryLayout.sceneScale} strokeWidth={1.6} />
            <button type="button" onClick={() => transitionToView('video-library')}>
              {selectedProject.title}
            </button>
            <ChevronRight size={14 * videoLibraryLayout.sceneScale} strokeWidth={1.6} />
            <strong>视频片段</strong>
          </div>

          <label className="videoLibrarySearch uiGlassShell">
            <Search size={15 * videoLibraryLayout.sceneScale} strokeWidth={1.55} />
            <input
              value={query}
              placeholder="搜索视频片段..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <header className="videoLibraryHeader">
            <div className="videoLibraryTitleLine">
              <h1>{selectedProject.title}</h1>
              {selectedProject.subtitle.trim() && (
                <span className="libraryEnglishName">
                  {selectedProject.subtitle}
                </span>
              )}
            </div>
            <p>
              {formatProjectMediaSummary(selectedProject, {
                includeMaterials: false,
              })}{' '}
              ·{' '}
              <span title={selectedProjectStorageTitle}>
                {selectedProjectStorageLabel}
              </span>
            </p>
            {selectedProject.description?.trim() && (
              <small>{selectedProject.description}</small>
            )}
          </header>

          <div
            ref={videoLibraryToolbarRef}
            className="videoLibraryToolbar"
            aria-label="视频筛选"
            data-camera-gesture="block"
          >
            {clipFilterControls.map((control) => {
              const selectedValue = clipFilters[control.id]
              const menuOpen = openClipFilterMenu === control.id
              return (
                <div
                  className="videoLibraryFilterControl"
                  key={control.id}
                >
                  <button
                    className={`videoLibraryFilterButton uiGlassShell uiGlassInteractive ${
                      selectedValue !== DEFAULT_CLIP_FILTER_STATE[control.id]
                        ? 'active'
                        : ''
                    }`}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() =>
                      setOpenClipFilterMenu((current) =>
                        current === control.id ? null : control.id,
                      )
                    }
                  >
                    <span className="videoLibraryFilterButtonLabel">
                      {control.label}
                    </span>
                    <ChevronDown
                      size={13 * videoLibraryLayout.sceneScale}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                  </button>
                  {menuOpen && (
                    <div
                      className="videoLibraryFilterMenu uiGlassShell"
                      role="menu"
                      aria-label={`${control.label}选项`}
                    >
                      {control.options.map((option) => {
                        const selected = selectedValue === option.value
                        return (
                          <button
                            className={selected ? 'active' : ''}
                            key={option.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            onClick={() =>
                              selectClipFilter(control.id, option.value)
                            }
                          >
                            <span>{option.label}</span>
                            {selected && (
                              <Check
                                size={12 * videoLibraryLayout.sceneScale}
                                strokeWidth={1.7}
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            <button
              className={`iconFilterButton uiGlassShell uiGlassInteractive ${
                clipFiltersActive ? 'active' : ''
              }`}
              type="button"
              aria-label={
                clipFiltersActive ? '重置全部筛选' : '当前没有启用筛选'
              }
              title={clipFiltersActive ? '重置全部筛选' : '当前没有启用筛选'}
              disabled={!clipFiltersActive}
              onClick={() => resetClipFilters()}
            >
              <ListFilter size={15 * videoLibraryLayout.sceneScale} strokeWidth={1.5} />
            </button>
          </div>

          <div
            className="videoReflectionPreloadSourceLayer"
            data-video-preload-count={
              videoReflectionPreloadClips.length
            }
            aria-hidden="true"
            inert
          >
            {videoReflectionPreloadClips.map((clip) => (
              <div
                key={`video-preload:${clip.id}`}
                className="videoReflectionPreloadSource"
                data-clip-id={clip.id}
                style={
                  {
                    '--clip-cover': toCssImageValue(clip.thumbnail),
                    '--media-color-filter': getMediaColorPreset(
                      clip.colorPreset,
                    ).cssFilter,
                  } as CSSProperties
                }
              >
                <span className="videoClipVisual">
                  {renderClipCardLayers(clip)}
                </span>
              </div>
            ))}
          </div>

          <div
            ref={clipGridRef}
            className={`videoClipGrid ${isClipDragging ? 'isClipDragging' : ''} ${isClipReleasing ? 'isClipReleasing' : ''} ${openClipFilterMenu ? 'isFilterMenuOpen' : ''}`}
            data-track-scrollable={clipTrackMaxPosition > 0}
            style={
              {
                '--clip-overscroll': `${clipOverscroll}px`,
              } as CSSProperties
            }
            aria-label="视频片段列表"
            onPointerDown={handleClipStagePointerDown}
            onPointerMove={handleClipStagePointerMove}
            onPointerUp={(event) => finishClipStageDrag(event, true)}
            onPointerCancel={(event) => finishClipStageDrag(event, false)}
          >
            <div className="videoClipCameraRig">
              {clipRenderRows.flatMap((rowItems) =>
                rowItems.map(({ clip, logicalColumn, rowIndex, slot }) => {
                const visualSlot = logicalColumn - clipTrackPosition
                const selected = detailClip?.id === clip.id
                const hitHovered = hoveredClipId === clip.id
                const dragSource =
                  (isClipDragging || isClipReleasing) && clipDragState.current.clipId === clip.id
                const style =
                  {
                    ...getVideoClipVisualStyle(
                      rowIndex,
                      visualSlot,
                      videoLibraryLayout,
                    ),
                    '--clip-cover': toCssImageValue(clip.thumbnail),
                    '--media-color-filter': getMediaColorPreset(
                      clip.colorPreset,
                    ).cssFilter,
                  } as CSSProperties

                return (
                  <div
                    key={clip.id}
                    className={`videoClipCard clipRow${rowIndex === 0 ? 'Top' : 'Bottom'} ${selected ? 'selected' : ''} ${hitHovered ? 'isHitHovered' : ''} ${dragSource ? 'isDragSource' : ''}`}
                    style={style}
                    data-clip-id={clip.id}
                    data-reflection-index={rowIndex * 4 + slot}
                    aria-hidden="true"
                  >
                    <span className="videoClipVisual">
                      {renderClipCardLayers(clip)}
                      <span className="videoClipGlassAnchor videoClipGlassAnchorTopLeft" />
                      <span className="videoClipGlassAnchor videoClipGlassAnchorTopRight" />
                      <span className="videoClipGlassAnchor videoClipGlassAnchorBottomRight" />
                      <span className="videoClipGlassAnchor videoClipGlassAnchorBottomLeft" />
                    </span>
                  </div>
                )
                }),
              )}
            </div>
            {clipHoverScrubVideoPortal?.target.isConnected &&
              createPortal(
                <video
                  key={`${clipHoverScrubVideoPortal.clipId}:${clipHoverScrubVideoPortal.sourceUrl}`}
                  ref={clipHoverScrubVideoRef}
                  className="videoClipHoverScrubVideo"
                  data-clip-id={clipHoverScrubVideoPortal.clipId}
                  data-preview-profile={
                    clipHoverScrubVideoPortal.lightweight
                      ? 'lightweight'
                      : 'source'
                  }
                  src={clipHoverScrubVideoPortal.sourceUrl}
                  poster={clipHoverScrubVideoPortal.poster}
                  muted
                  playsInline
                  preload="auto"
                  disablePictureInPicture
                  aria-hidden="true"
                  onLoadedMetadata={(event) =>
                    seekClipHoverScrubVideo(event.currentTarget)
                  }
                  onLoadedData={(event) => {
                    seekClipHoverScrubVideo(event.currentTarget)
                    markClipHoverScrubVideoReady(event.currentTarget)
                  }}
                  onSeeked={(event) => {
                    markClipHoverScrubVideoReady(event.currentTarget)
                    seekClipHoverScrubVideo(event.currentTarget)
                  }}
                  onError={() =>
                    handleClipHoverScrubVideoError(
                      clipHoverScrubVideoPortal.clipId,
                      clipHoverScrubVideoPortal.sourceUrl,
                    )
                  }
                />,
                clipHoverScrubVideoPortal.target,
                `clip-hover-scrub:${clipHoverScrubVideoPortal.clipId}`,
              )}
            <div
              ref={clipHitLayerRef}
              className="videoClipHitLayer"
              inert={pageTransitionPhase !== 'idle'}
            >
              {clipRenderRows.flatMap((rowItems) =>
                rowItems.map(({ clip, logicalColumn, rowIndex }) => {
                  const visualSlot = logicalColumn - clipTrackPosition
                  const interactionHidden =
                    Number.parseFloat(
                      getVideoClipVisualStyle(
                        rowIndex,
                        visualSlot,
                        videoLibraryLayout,
                      )['--clip-opacity'],
                    ) <= 0.02
                  return [
                    <button
                      key={`hit:${clip.id}`}
                      className="videoClipHitTarget"
                      type="button"
                      data-camera-gesture={
                        clipTrackMaxPosition <= 0 ? 'allow' : undefined
                      }
                      data-clip-id={clip.id}
                      aria-hidden={interactionHidden || undefined}
                      tabIndex={interactionHidden ? -1 : 0}
                      aria-label={`查看 ${clip.filename}`}
                      onPointerEnter={() => setHoveredClipId(clip.id)}
                      onPointerMove={(event) =>
                        handleClipHoverScrubPointerMove(event, clip)
                      }
                      onPointerLeave={() => {
                        clearClipHoverScrub(clip.id)
                        setHoveredClipId((current) =>
                          current === clip.id ? null : current,
                        )
                      }}
                      onFocus={() => setHoveredClipId(clip.id)}
                      onBlur={() => {
                        clearClipHoverScrub(clip.id)
                        setHoveredClipId((current) =>
                          current === clip.id ? null : current,
                        )
                      }}
                      onClick={() => handleClipSelect(clip.id)}
                      onDoubleClick={() => openFrameRing(clip.id)}
                    />,
                    <button
                      key={`menu-hit:${clip.id}`}
                      className="videoClipMenuHitTarget"
                      type="button"
                      data-clip-id={clip.id}
                      aria-hidden={interactionHidden || undefined}
                      tabIndex={interactionHidden ? -1 : 0}
                      aria-label={`${clip.filename} 更多操作`}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onClick={(event) => openClipMenu(event, clip.id)}
                    />,
                  ]
                }),
              )}
            </div>
            <div
              className="modelLibraryEmptyState videoProjectFilteredEmptyState"
              data-camera-gesture="block"
              data-empty-visible={
                projectClips.length > 0 && filteredProjectClips.length === 0
              }
              aria-hidden={
                projectClips.length > 0 && filteredProjectClips.length === 0
                  ? undefined
                  : true
              }
              inert={
                !(projectClips.length > 0 && filteredProjectClips.length === 0)
              }
            >
                <ListFilter size={24} strokeWidth={1.35} aria-hidden="true" />
                <strong>没有符合条件的视频</strong>
                <small>可以调整筛选条件，或清除搜索关键词后重试。</small>
                <button
                  className="uiGlassInset uiGlassInteractive active"
                  type="button"
                  onClick={() => resetClipFilters(true)}
                >
                  <RefreshCw size={14} strokeWidth={1.6} />
                  重置搜索与筛选
                </button>
            </div>
          </div>

          <div
            className="modelLibraryEmptyState videoProjectEmptyState"
            data-camera-gesture="block"
            data-empty-visible={projectClips.length === 0}
            aria-hidden={projectClips.length === 0 ? undefined : true}
            inert={projectClips.length !== 0}
          >
              <Video size={24} strokeWidth={1.35} aria-hidden="true" />
              <strong>这个视频项目还没有素材</strong>
              <small>
                导入视频后，Aurora 会建立视频预览、视觉索引与帧环。
              </small>
              <button
                className="uiGlassInset uiGlassInteractive active"
                type="button"
                onClick={() => openProjectImportPicker(selectedProject.id)}
              >
                <Plus size={14} strokeWidth={1.6} />
                导入视频素材
              </button>
          </div>

          <footer className="videoLibraryCount">
            {filteredProjectClips.length === projectClips.length
              ? `共 ${formatProjectMediaSummary(selectedProject, {
                  includeMaterials: false,
                })}`
              : `显示 ${filteredProjectClips.length} / 共 ${projectClips.length} 项媒体`}
          </footer>

          {isProjectFileDragActive && (
            <div className="videoLibraryDropGuide" aria-hidden="true">
              <span className="uiGlassShell">
                <Video size={18 * videoLibraryLayout.uiContentScale} strokeWidth={1.45} />
                <strong>松开以导入到“{selectedProject.title}”</strong>
                <small>支持同时拖入多个视频文件</small>
              </span>
            </div>
          )}

          {projectImportProgress?.projectId === selectedProject.id && (
            <aside
              className={`videoLibraryImportProgress uiGlassShell ${projectImportProgress.complete ? 'isComplete' : ''}`}
              aria-live="polite"
              aria-label="素材导入进度"
              style={
                {
                  '--project-import-progress': `${
                    projectImportProgress.total > 0
                      ? (projectImportProgress.processed /
                          projectImportProgress.total) *
                        100
                      : 0
                  }%`,
                } as CSSProperties
              }
            >
              <span className="videoLibraryImportProgressCopy">
                <strong>
                  {projectImportProgress.complete
                    ? projectImportProgress.failed > 0
                      ? '素材已加入，部分信息生成失败'
                      : projectImportProgress.added > 0
                        ? '导入完成'
                        : '没有新增素材'
                    : `正在导入到“${projectImportProgress.projectTitle}”`}
                </strong>
                <small>
                  {projectImportProgress.complete
                    ? [
                        `已加入 ${projectImportProgress.added}`,
                        projectImportProgress.duplicate > 0
                          ? `重复 ${projectImportProgress.duplicate}`
                          : '',
                        projectImportProgress.unsupported > 0
                          ? `不支持 ${projectImportProgress.unsupported}`
                          : '',
                        projectImportProgress.failed > 0
                          ? `信息或缩略图失败 ${projectImportProgress.failed}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : `已处理 ${projectImportProgress.processed}/${projectImportProgress.total}${
                        projectImportProgress.currentName
                          ? ` · ${projectImportProgress.currentName}`
                          : ''
                      }`}
                </small>
              </span>
              <span className="videoLibraryImportProgressTrack" aria-hidden="true">
                <i />
              </span>
            </aside>
          )}

          {detailClip && (
            <div className="videoLibraryDetailStage">
              <div className="videoLibraryDetailCameraRig">
                <aside
                  className="clipDetailPanel"
                  data-detail-reflection="true"
                  data-clip-id={detailClip.id}
                  data-reflection-index={visibleProjectClips.length}
                  aria-label={`${detailClip.filename} 详情`}
                >
              <span className="detailPanelGlassAnchor detailPanelGlassAnchorTopLeft" />
              <span className="detailPanelGlassAnchor detailPanelGlassAnchorTopRight" />
              <span className="detailPanelGlassAnchor detailPanelGlassAnchorBottomRight" />
              <span className="detailPanelGlassAnchor detailPanelGlassAnchorBottomLeft" />
              <div className="detailPanelChrome" aria-hidden="true" />
              <div className="detailPanelContent">
                <div className="detailPanelTop">
                  <strong>{detailClip.filename}</strong>
                  <button
                    className={`detailFavoriteButton ${detailClip.favorite ? 'active' : ''}`}
                    type="button"
                    aria-label={
                      detailClip.favorite ? '取消收藏视频' : '收藏视频'
                    }
                    aria-pressed={detailClip.favorite}
                    title={detailClip.favorite ? '取消收藏视频' : '收藏视频'}
                    onClick={() => toggleClipFavorite(detailClip)}
                  >
                    <Star
                      size={13 * videoLibraryLayout.panelContentScale}
                      fill={detailClip.favorite ? 'currentColor' : 'none'}
                      strokeWidth={1.5}
                    />
                  </button>
                </div>
                <div className="detailPanelBody">
                  <div
                    className="detailPreview"
                    style={{
                      '--clip-cover': toCssImageValue(detailClip.thumbnail),
                      '--media-color-filter': detailColorPreset.cssFilter,
                    } as CSSProperties}
                  >
                    <span className="detailPreviewPoster" aria-hidden="true" />
                    {detailPreviewSourceUrl &&
                      detailPreviewFailedSource !== detailPreviewSourceUrl && (
                        <>
                          <video
                            key={`${detailClip.id}:${detailPreviewSourceUrl}`}
                            ref={detailPreviewVideoRef}
                            className="detailPreviewVideo"
                            src={detailPreviewSourceUrl}
                            poster={detailClip.thumbnail}
                            preload="auto"
                            playsInline
                            onPlay={() =>
                              setDetailPreviewPlayingKey(
                                detailPreviewPlaybackKey,
                              )
                            }
                            onPause={() =>
                              setDetailPreviewPlayingKey((current) =>
                                current === detailPreviewPlaybackKey
                                  ? null
                                  : current,
                              )
                            }
                            onEnded={() =>
                              setDetailPreviewPlayingKey((current) =>
                                current === detailPreviewPlaybackKey
                                  ? null
                                  : current,
                              )
                            }
                            onError={() => {
                              setDetailPreviewPlayingKey(null)
                              setDetailPreviewFailedSource(
                                detailPreviewSourceUrl,
                              )
                            }}
                          />
                          <span
                            className="detailPreviewVideoShade"
                            aria-hidden="true"
                          />
                        </>
                      )}
                    {!detailClip.online && (
                      <button
                        className={`detailPreviewColorPresetButton ${
                          detailColorPreset.id === 'original' ? '' : 'active'
                        }`}
                        type="button"
                        data-camera-gesture="block"
                        data-color-preset={detailColorPreset.id}
                        aria-label={`颜色预设：${detailColorPreset.label}。单击切换，双击恢复原始`}
                        title="单击切换颜色预设，双击恢复原始"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          scheduleClipColorPresetCycle(detailClip)
                        }}
                        onDoubleClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          resetClipColorPreset(detailClip)
                        }}
                      >
                        {detailColorPreset.label}
                      </button>
                    )}
                    <button
                      className="detailPreviewPlayButton"
                      type="button"
                      data-camera-gesture="block"
                      aria-label={
                        detailClip.online
                          ? `在${getOnlineProviderLabel(detailClip.online.provider)}官方页面播放`
                          : detailPreviewPlayingKey === detailPreviewPlaybackKey
                          ? '暂停视频预览'
                          : '播放视频预览'
                      }
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() =>
                        void toggleDetailPreviewPlayback(detailClip)
                      }
                    >
                      {detailPreviewPlayingKey ===
                      detailPreviewPlaybackKey ? (
                        <Pause
                          size={18}
                          fill="currentColor"
                          strokeWidth={1.2}
                        />
                      ) : (
                        <Play
                          size={18}
                          fill="currentColor"
                          strokeWidth={1.2}
                        />
                      )}
                    </button>
                  </div>

                  <div
                    className="detailPanelMetadata"
                    data-compact={
                      detailClip.tags.length >= 5 && detailClip.note.trim()
                        ? 'true'
                        : undefined
                    }
                  >
                  <section className="clipFacts" aria-label="基本信息">
                    <h2>基本信息</h2>
                    {(detailClip.online
                      ? [
                          [
                            '来源',
                            getOnlineProviderLabel(detailClip.online.provider),
                          ],
                          [
                            '内容类型',
                            detailClip.online.kind === 'episode'
                              ? '番剧剧集'
                              : '在线视频',
                          ],
                          ['视频 ID', detailClip.online.mediaId],
                          ['UP 主', detailClip.online.author],
                          ['本地文件', '暂不可用'],
                          ['帧环', '暂不可用'],
                        ]
                      : [
                          ['时长', detailClip.duration],
                          ['分辨率', detailClip.resolution],
                          ['帧率', detailClip.fps],
                          ['编码格式', detailClip.codec],
                          ['文件大小', detailClip.size],
                          ['拍摄日期', detailClip.capturedAt],
                          [
                            '索引帧数',
                            detailClip.sampleCount > 0
                              ? String(detailClip.sampleCount)
                              : '未建立',
                          ],
                        ]
                    ).map(([label, value]) => (
                      <p key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </p>
                    ))}
                  </section>

                  <section className="detailTagCloud" aria-label="标签">
                    <header className="detailTagHeader">
                      <h2>标签</h2>
                      {!detailClip.online && (
                        <button
                          className="detailAiMetadataButton"
                          type="button"
                          aria-label="AI 识别标签与备注"
                          title="识别片段画面并推荐标签与备注"
                          disabled={
                            clipAiMetadataDialog?.clipId === detailClip.id &&
                            clipAiMetadataDialog.status === 'analyzing'
                          }
                          onClick={() =>
                            void openClipAiMetadataDialog(detailClip)
                          }
                        >
                          <Sparkles
                            size={11 * videoLibraryLayout.panelContentScale}
                            strokeWidth={1.55}
                          />
                          AI 识别
                        </button>
                      )}
                    </header>
                    <div>
                      {detailClip.tags.map((tag) => (
                        <button
                          className="detailTagChip"
                          key={tag}
                          type="button"
                          aria-label={`删除标签 ${tag}`}
                          title="点击删除标签"
                          onClick={() => removeClipTag(detailClip, tag)}
                        >
                          {tag}
                          <span aria-hidden="true">×</span>
                        </button>
                      ))}
                      {detailClip.tags.length < CLIP_DETAIL_TAG_MAX_COUNT && (
                        <button
                          className="detailTagAddButton"
                          type="button"
                          aria-label="添加标签"
                          title="添加标签"
                          onClick={() => openClipTagEditor(detailClip)}
                        >
                          <Plus size={12 * videoLibraryLayout.panelContentScale} strokeWidth={1.7} />
                        </button>
                      )}
                    </div>
                  </section>

                  <section className="detailNote" aria-label="备注">
                    <div className="detailNoteHeader">
                      <h2>备注</h2>
                      <button
                        type="button"
                        aria-label="编辑备注"
                        onClick={() => openClipNoteEditor(detailClip)}
                      >
                        <Pencil size={13 * videoLibraryLayout.panelContentScale} strokeWidth={1.5} />
                      </button>
                    </div>
                    <p>{detailClip.note || '暂无备注'}</p>
                  </section>
                  </div>

                  <section className="detailIndexStatus" aria-label="视觉索引">
                    <span>
                      <strong>
                        {detailClip.online ? '在线媒体' : '视觉索引'}
                      </strong>
                      <small>
                        {detailClip.online
                          ? '暂不可用'
                          : detailClip.sampleCount > 0
                          ? detailClip.indexTask === 'building'
                            ? `正在重新建立 · ${Math.round((detailIndexProgress ?? 0) * 100)}%`
                            : '已建立'
                          : detailClip.indexTask === 'building'
                            ? `正在建立 · ${Math.round((detailIndexProgress ?? 0) * 100)}%`
                            : detailClip.indexTask === 'failed'
                              ? '建立失败，可重试'
                              : '未建立'}
                      </small>
                    </span>
                    {!detailClip.online && detailClip.sampleCount > 0 && (
                      <button
                        type="button"
                        disabled={detailClip.indexTask === 'building'}
                        onClick={() => void queueClipVisualIndex(detailClip, true)}
                      >
                        <RefreshCw
                          size={11 * videoLibraryLayout.panelContentScale}
                          strokeWidth={1.5}
                        />
                        {detailClip.indexTask === 'building'
                          ? '正在重建'
                          : '重新建立'}
                      </button>
                    )}
                  </section>

                  <button
                    className="openFrameRingButton"
                    type="button"
                    aria-disabled={pageTransitionPhase !== 'idle'}
                    tabIndex={pageTransitionPhase === 'idle' ? undefined : -1}
                    onClick={openSelectedFrameRing}
                  >
                    {detailClip.online
                      ? `在${getOnlineProviderLabel(detailClip.online.provider)}在线播放`
                      : '打开帧环浏览/预览'}
                    <ChevronRight size={15 * videoLibraryLayout.panelContentScale} strokeWidth={1.5} />
                  </button>
                </div>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </section>
        </>
      )}

      {modelLibraryProject && (
        <ModelLibraryView
          active={
            currentView === 'model-library' &&
            (startupGateActive ||
              selectedProject.id === modelLibraryProject.id)
          }
          pageTransitionPhase={pageTransitionPhase}
          project={modelLibraryProject}
          models={modelLibraryModels}
          layout={videoLibraryLayout}
          geometryRevision={`${cameraPose.pitch}:${cameraPose.yaw}:${viewportWidth}:${viewportHeight}`}
          glassLayerRef={modelGlassLayerRef}
          selectedModelId={modelLibrarySelectedModel?.id ?? null}
          importState={modelImportState}
          onBack={navigateBackOneLevel}
          onSelect={setSelectedModelId}
          onOpen={openModelViewer}
          onReveal={revealModelInFinder}
          onRemove={removeModelFromCurrentProject}
          onTagsChange={handleModelTagsChange}
          onNoteChange={handleModelNoteChange}
          onToggleFavorite={toggleModelFavorite}
          onVisibleModelIdsChange={handleVisibleModelIdsChange}
          onImport={(files) => {
            if (files?.length) {
              void importProjectModelFiles(modelLibraryProject.id, files)
              return
            }
            openModelImportPicker(modelLibraryProject.id)
          }}
        />
      )}

      <ModelViewerPage
        active={currentView === 'model-viewer'}
        projectTitle={selectedProject.title}
        layout={frameRingLayout}
        asset={selectedModel}
        assetUrl={selectedModelUrl}
        onBack={navigateBackOneLevel}
        onMetadata={handleModelMetadata}
        onCameraChange={handleModelCameraChange}
        onEnvironmentPresetChange={handleModelEnvironmentPresetChange}
      />

      {frameRingClip && (
        <FrameRingView
          active={
            currentView === 'frame-ring' &&
            (startupGateActive ||
              frameRingClip.id === selectedClip?.id ||
              frameRingClip.id === externalFrameRingClip?.id ||
              frameRingClip.id === onlineFrameRingClip?.id)
          }
          suspended={pageSceneSuspended}
          project={frameRingProject}
          clip={frameRingClip}
          relatedClips={frameRingRelatedClips}
          materialTint={frameRingPageSettings.materialTint}
          materialTintFilter={getMaterialTintFilter(
            frameRingPageSettings.materialTint,
          )}
          pageColorGradeFilter={getPageColorGradeFilter(
            frameRingPageSettings,
          )}
          reflectionSurface={
            onlineFrameRingClip ? null : reflectionSurfaces['frame-ring']
          }
          focusTarget={
            frameRingFocusTarget?.clipId === frameRingClip.id
              ? frameRingFocusTarget
              : null
          }
          layout={frameRingLayout}
          cameraYaw={cameraPose.yaw}
          cameraPitch={cameraPose.pitch}
          annotations={frameRingAnnotations}
          onAnnotationChange={updateSelectedFrameAnnotation}
          onChooseExportDirectory={
            onlineFrameRingClip ? undefined : chooseFrameExportDirectory
          }
          onExportStill={onlineFrameRingClip ? undefined : exportFrameStill}
          onExportClip={onlineFrameRingClip ? undefined : exportFrameClip}
          onRevealSource={
            onlineFrameRingClip ? undefined : revealSelectedFrameSource
          }
          onDeleteFrame={
            onlineFrameRingClip ? undefined : deleteSelectedIndexFrame
          }
          onScanSmartFrames={
            externalFrameRingClip || onlineFrameRingClip
              ? undefined
              : scanSelectedFramesForSmartOrganize
          }
          onAnalyzeSmartFrames={
            externalFrameRingClip ||
            onlineFrameRingClip ||
            !aiServiceProfilesState.activeVisionProfileId
              ? undefined
              : analyzeSelectedFramesForSmartOrganize
          }
          onApplySmartOrganize={
            externalFrameRingClip || onlineFrameRingClip
              ? undefined
              : applySelectedFrameSmartOrganize
          }
          onUndoSmartOrganize={
            externalFrameRingClip || onlineFrameRingClip
              ? undefined
              : undoSelectedFrameSmartOrganize
          }
          indexTask={frameRingClip.indexTask}
          indexProgress={indexProgressByAsset[frameRingClip.assetId]}
          onBuildFrameRing={
            externalFrameRingClip || onlineFrameRingClip
              ? undefined
              : () => queueClipVisualIndex(frameRingClip)
          }
          previewTask={
            frameRingHasIndex
              ? 'ready'
              : resolveFrameRingPreviewTask(
                  frameRingClip.sourceUrl,
                  frameRingPreviewState?.status,
                )
          }
          previewProgress={previewProgressByAsset[frameRingClip.assetId]}
          previewError={frameRingPreviewState?.error}
          previewUsesProxy={frameRingPreviewState?.usesPreviewProxy ?? false}
          onPreviewPlaybackError={
            onlineFrameRingClip
              ? undefined
              : () => ensureClipPreview(frameRingClip, true)
          }
          externalPreview={Boolean(externalFrameRingClip)}
          onlinePlayback={
            frameRingClip.online
              ? {
                  provider: frameRingClip.online.provider,
                  kind: frameRingClip.online.kind,
                  mediaId: frameRingClip.online.mediaId,
                  canonicalUrl: frameRingClip.online.canonicalUrl,
                }
              : null
          }
          onlineFavorite={onlineFrameRingAsset?.favorite ?? false}
          onToggleOnlineFavorite={
            onlineFrameRingClip
              ? toggleOnlineFrameRingFavorite
              : undefined
          }
          onAddOnlineToProject={
            onlineFrameRingClip
              ? beginAddOnlineFrameRingToProject
              : undefined
          }
          onAddExternalVideo={
            externalFrameRingClip
              ? beginAddExternalVideoToProject
              : undefined
          }
          onBack={navigateBackOneLevel}
        />
      )}

      <DiscoveryView
        active={currentView === 'online-search'}
        suspended={pageSceneSuspended}
        cameraYaw={cameraPose.yaw}
        cameraPitch={cameraPose.pitch}
        isCameraDragging={isCameraDragging}
        layoutSignal={`${viewportWidth}|${viewportHeight}|${responsiveMetrics.layoutScale}|${responsiveMetrics.planeLeft}|${responsiveMetrics.planeTop}`}
        materialTint={discoveryPageSettings.materialTint}
        reflectionSurface={reflectionSurfaces['online-search']}
        localResults={localDiscoveryResults}
        onResultAction={handleDiscoveryResultAction}
        enabledOnlineProviders={enabledOnlineProviders}
        onOnlineSearch={searchOnlineProviderForDiscovery}
        aiSearchMode={aiSearchMode}
        aiSearchConfigured={Boolean(
          aiServiceProfilesState.activeVisionProfileId &&
            aiServiceProfilesState.visionProfiles.some(
              (profile) =>
                profile.id === aiServiceProfilesState.activeVisionProfileId,
            ) &&
            aiServiceProfilesState.activeEmbeddingProfileId &&
            aiServiceProfilesState.embeddingProfiles.some(
              (profile) =>
                profile.id === aiServiceProfilesState.activeEmbeddingProfileId,
            ),
        )}
        onAiSearchModeChange={setAiSearchMode}
        onAiSearchSetupRequired={openAiSearchSettings}
        onAiSearch={searchAiDiscovery}
        aiCoverage={aiDiscoveryCoverage}
      />

      {projectMenu && menuProject && menuBaseProject && (
        <div
          className="overlay projectSettingsOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${menuProject.title} 项目设置`}
          data-camera-gesture="block"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return
            setProjectMenu(null)
            setProjectMenuDraftName('')
            setProjectMenuDraftSubtitle('')
            setHoveredProjectCardKey(null)
          }}
        >
          <form
            className="createPanel projectSettingsPanel uiGlassShell"
            autoComplete="off"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              saveProjectMenuSettings(menuProject.id)
            }}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭项目设置"
              onClick={() => {
                setProjectMenu(null)
                setProjectMenuDraftName('')
                setProjectMenuDraftSubtitle('')
                setHoveredProjectCardKey(null)
              }}
            >
              <X size={17} />
            </button>

            <header className="createPanelHeader">
              <span className="sheetEyebrow">Project Settings</span>
              <h2>项目设置</h2>
              <p>管理项目名称、封面与项目内容。</p>
            </header>

            <div
              className="createProjectChoice projectSettingsSummary uiGlassInset"
              aria-label={`${menuProject.title} 项目摘要`}
            >
              <span className="projectSettingsSummaryCover" aria-hidden="true">
                {!menuProject.usesEmptyGlass ? (
                  <img src={menuProject.cover} alt="" />
                ) : (
                  <span className="projectCoverPlaceholder" />
                )}
              </span>
              <span className="projectSettingsSummaryCopy">
                <strong>{menuProject.title}</strong>
                <small>
                  {menuProject.kind === '3d'
                    ? menuProject.modelCount > 0
                      ? `${menuProject.modelCount} 个三维模型`
                      : '三维项目 · 尚未导入模型'
                    : menuProject.videoCount > 0
                      ? formatProjectMediaSummary(menuProject, {
                          includeMaterials: false,
                        })
                      : '影像项目 · 尚未导入素材'}
                </small>
              </span>
            </div>

            <div className="projectNameField">
              <span>项目名称</span>
              <span className="createProjectInput uiGlassInset">
                <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
                <input
                  aria-label="项目名称"
                  name="projectSettingsName"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={40}
                  placeholder="输入项目名称"
                  value={projectMenuDraftName}
                  onChange={(event) =>
                    setProjectMenuDraftName(event.currentTarget.value)
                  }
                />
              </span>
              <span className="projectSettingsFieldStatus">
                <small>{projectMenuDraftName.length}/40</small>
                <button
                  type="button"
                  disabled={projectMenuDraftName === menuBaseProject.title}
                  onClick={() => setProjectMenuDraftName(menuBaseProject.title)}
                >
                  恢复默认名称
                </button>
              </span>
            </div>

            <div className="projectNameField">
              <span>英文名称</span>
              <span className="createProjectInput uiGlassInset">
                <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
                <input
                  aria-label="英文名称"
                  name="projectSettingsEnglishName"
                  autoComplete="off"
                  spellCheck={false}
                  lang="en"
                  maxLength={60}
                  placeholder="可留空；为空时项目卡不显示"
                  value={projectMenuDraftSubtitle}
                  onChange={(event) =>
                    setProjectMenuDraftSubtitle(event.currentTarget.value)
                  }
                />
              </span>
              <span className="projectSettingsFieldStatus">
                <small>{projectMenuDraftSubtitle.length}/60</small>
                <small>可留空</small>
              </span>
            </div>

            <section className="projectSettingsContent" aria-label="项目内容">
              <span className="projectSettingsSectionLabel">项目内容</span>
              <div className="projectSettingsActionGrid">
                <button
                  className="projectSettingsAction uiGlassInset uiGlassInteractive"
                  type="button"
                  onClick={() => {
                    setProjectMenu(null)
                    if (menuProject.kind === '3d') {
                      openModelImportPicker(menuProject.id)
                    } else {
                      openProjectImportPicker(menuProject.id)
                    }
                  }}
                >
                  {menuProject.kind === '3d' ? (
                    <Box size={17} strokeWidth={1.5} aria-hidden="true" />
                  ) : (
                    <Video size={17} strokeWidth={1.5} aria-hidden="true" />
                  )}
                  <span>
                    <strong>
                      {menuProject.kind === '3d'
                        ? menuProject.modelCount > 0
                          ? '导入更多模型'
                          : '导入三维模型'
                        : menuProject.videoCount > 0
                          ? '导入更多素材'
                          : '导入素材'}
                    </strong>
                    <small>
                      {menuProject.kind === '3d'
                        ? '支持 GLB、OBJ、FBX；OBJ 可同批选择 MTL 与贴图'
                        : '添加本地视频到当前项目'}
                    </small>
                  </span>
                </button>
                <button
                  className="projectSettingsAction uiGlassInset uiGlassInteractive"
                  type="button"
                  onClick={() => openProjectCoverPicker(menuProject.id)}
                >
                  <Image size={17} strokeWidth={1.5} aria-hidden="true" />
                  <span>
                    <strong>更换封面</strong>
                    <small>自动等比居中裁剪为 4:3</small>
                  </span>
                </button>
              </div>
              <div className="projectSettingsCoverStatus">
                <span title={menuProjectCoverName ?? undefined}>
                  {menuProjectCoverName ??
                    (menuProject.usesEmptyGlass
                      ? '暂无封面'
                      : '使用项目默认封面')}
                </span>
                <button
                  type="button"
                  disabled={!menuProjectCoverName}
                  onClick={() => resetProjectCover(menuProject.id)}
                >
                  恢复默认封面
                </button>
              </div>
            </section>

            <div className="createPanelMeta">
              <span>
                <HardDrive size={14} strokeWidth={1.45} />
                本地项目舱
              </span>
              <span>更新于 {menuProject.updatedAt}</span>
            </div>

            <footer className="projectSettingsFooter">
              <button
                className="projectSettingsDeleteAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() =>
                  openProjectDeleteConfirmation(menuProject.id)
                }
              >
                <Trash2 size={14} strokeWidth={1.5} />
                删除项目
              </button>
              <span className="createPanelActions">
                <button
                  className="secondaryAction uiGlassInset uiGlassInteractive"
                  type="button"
                  onClick={() => {
                    setProjectMenu(null)
                    setProjectMenuDraftName('')
                    setProjectMenuDraftSubtitle('')
                    setHoveredProjectCardKey(null)
                  }}
                >
                  取消
                </button>
                <button
                  className="primaryAction uiGlassInset uiGlassInteractive active"
                  type="submit"
                  disabled={!projectMenuDraftName.trim()}
                >
                  保存修改
                </button>
              </span>
            </footer>
          </form>
        </div>
      )}

      {projectDeleteDialog && (
        <div
          className="overlay projectDeleteOverlay"
          role="alertdialog"
          aria-modal="true"
          aria-label={`删除项目 ${projectDeleteDialog.title}`}
          data-camera-gesture="block"
        >
          <section className="clipRemovePanel projectDeletePanel uiGlassShell">
            <span className="clipRemoveIcon" aria-hidden="true">
              <Trash2 size={20} strokeWidth={1.45} />
            </span>
            <span className="sheetEyebrow">Delete Project</span>
            <h2>
              {projects.length <= 1
                ? '无法删除唯一项目'
                : '确认删除这个项目？'}
            </h2>
            <p>
              {projects.length <= 1 ? (
                <>
                  Aurora 需要至少保留一个项目。请先新建另一个项目，再删除“
                  {projectDeleteDialog.title}”。
                </>
              ) : (
                <>
                  “{projectDeleteDialog.title}”及其项目内标签、备注和素材引用将从
                  Aurora 中移除。磁盘原文件、视觉索引，以及其他项目中的引用都不会被删除。
                  此操作无法撤销。
                </>
              )}
            </p>
            <footer>
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                autoFocus
                onClick={() => setProjectDeleteDialogId(null)}
              >
                {projects.length <= 1 ? '知道了' : '取消'}
              </button>
              {projects.length > 1 && (
                <button
                  className="primaryAction destructive uiGlassInset uiGlassInteractive"
                  type="button"
                  onClick={deleteProjectFromLibrary}
                >
                  确认删除
                </button>
              )}
            </footer>
          </section>
        </div>
      )}

      {clipMenu && (
        <div
          className="overlay clipActionOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${clipMenu.filename} 更多操作`}
          data-camera-gesture="block"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setClipMenuId(null)
          }}
        >
          <section
            className="clipActionPanel uiGlassShell"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭素材操作"
              onClick={() => setClipMenuId(null)}
            >
              <X size={17} />
            </button>
            <header>
              <span className="sheetEyebrow">Clip Actions</span>
              <h2>素材操作</h2>
            </header>
            <div className="clipActionSummary uiGlassInset">
              <img src={clipMenu.thumbnail} alt="" />
              <span>
                <strong>{clipMenu.filename}</strong>
                <small>
                  {clipMenu.resolution} · {clipMenu.duration}
                </small>
              </span>
            </div>
            <div className="clipActionList">
              <button
                className="uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => beginAddClipToProject(clipMenu.id)}
              >
                <FolderPlus size={17} strokeWidth={1.45} />
                <span>
                  <strong>添加到项目…</strong>
                  <small>引用同一原文件与视觉索引</small>
                </span>
                <ChevronRight size={14} strokeWidth={1.45} />
              </button>
              <button
                className="uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() =>
                  clipMenu.online
                    ? void openOfficialOnlineMedia(clipMenu.online)
                    : void revealClipInFinder(clipMenu)
                }
              >
                {clipMenu.online ? (
                  <Play size={17} strokeWidth={1.45} />
                ) : (
                  <FolderOpen size={17} strokeWidth={1.45} />
                )}
                <span>
                  <strong>
                    {clipMenu.online
                      ? `打开${getOnlineProviderLabel(clipMenu.online.provider)}原页面`
                      : '在 Finder 中显示'}
                  </strong>
                  <small>
                    {clipMenu.online
                      ? '使用官方页面与当前登录权益播放'
                      : '定位原始视频文件'}
                  </small>
                </span>
                <ChevronRight size={14} strokeWidth={1.45} />
              </button>
              <button
                className="uiGlassInset uiGlassInteractive destructive"
                type="button"
                onClick={() => {
                  setClipMenuId(null)
                  setClipRemoveDialogId(clipMenu.id)
                }}
              >
                <Trash2 size={17} strokeWidth={1.45} />
                <span>
                  <strong>从当前项目移除…</strong>
                  <small>
                    {clipMenu.online
                      ? `不会取消收藏或影响${getOnlineProviderLabel(clipMenu.online.provider)}原视频`
                      : '不会删除磁盘原文件或视觉索引'}
                  </small>
                </span>
                <ChevronRight size={14} strokeWidth={1.45} />
              </button>
            </div>
          </section>
        </div>
      )}

      {clipAddDialog && (
        <div
          className="overlay clipAddProjectOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`将 ${clipAddDialog.filename} 添加到项目`}
          data-camera-gesture="block"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeClipAddDialog()
          }}
        >
          <form
            className="createPanel clipAddProjectPanel uiGlassShell"
            autoComplete="off"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              if (clipAddMode === 'existing') addClipToExistingProject()
              else createProjectFromClip()
            }}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭添加到项目"
              onClick={closeClipAddDialog}
            >
              <X size={17} />
            </button>
            <header className="createPanelHeader">
              <span className="sheetEyebrow">Add To Project</span>
              <h2>添加到项目</h2>
              <p>
                {clipAddDialog.online
                  ? `只保存${getOnlineProviderLabel(clipAddDialog.online.provider)}链接与项目引用，不下载原视频，也不会建立帧环。`
                  : '只增加项目引用，不复制原视频，也不会重复建立视觉索引。'}
              </p>
            </header>

            <div className="clipActionSummary uiGlassInset">
              <img src={clipAddDialog.thumbnail} alt="" />
              <span>
                <strong>{clipAddDialog.filename}</strong>
                <small>
                  已被 {clipMembershipProjectIds.size} 个项目引用
                </small>
              </span>
            </div>

            <div className="clipAddModeSwitch uiGlassInset" aria-label="添加方式">
              <button
                className={clipAddMode === 'existing' ? 'active' : ''}
                type="button"
                onClick={() => {
                  setClipAddMode('existing')
                  if (
                    !availableClipTargetProjects.some(
                      (project) => project.id === clipAddTargetProjectId,
                    )
                  ) {
                    setClipAddTargetProjectId(
                      availableClipTargetProjects[0]?.id ?? '',
                    )
                  }
                }}
              >
                现有项目
              </button>
              <button
                className={clipAddMode === 'new' ? 'active' : ''}
                type="button"
                onClick={() => setClipAddMode('new')}
              >
                新建项目
              </button>
            </div>

            {clipAddMode === 'existing' ? (
              <div className="clipProjectChoiceList" role="radiogroup" aria-label="选择项目">
                {availableClipTargetProjects.length > 0 ? (
                  availableClipTargetProjects.map((project) => (
                    <button
                      key={project.id}
                      className={`clipProjectChoice uiGlassInset uiGlassInteractive ${clipAddTargetProjectId === project.id ? 'active' : ''}`}
                      type="button"
                      role="radio"
                      aria-checked={clipAddTargetProjectId === project.id}
                      onClick={() => setClipAddTargetProjectId(project.id)}
                    >
                      {!project.usesEmptyGlass ? (
                        <img src={project.cover} alt="" />
                      ) : (
                        <span
                          className="projectCoverPlaceholder"
                          aria-hidden="true"
                        />
                      )}
                      <span>
                        <strong>{project.title}</strong>
                        <small>
                          {formatProjectMediaSummary(project, {
                            includeMaterials: false,
                          })}
                        </small>
                      </span>
                      {clipAddTargetProjectId === project.id && (
                        <Check size={15} strokeWidth={1.7} />
                      )}
                    </button>
                  ))
                ) : (
                  <div className="clipProjectChoiceEmpty">
                    当前素材已在所有现有项目中，可直接新建一个项目。
                  </div>
                )}
              </div>
            ) : (
              <div className="clipAddNewProjectFields">
                <label className="projectNameField">
                  <span>新项目名称</span>
                  <span className="createProjectInput uiGlassInset">
                    <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
                    <input
                      autoFocus
                      name="clipProjectName"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={40}
                      value={clipAddNewProjectName}
                      onChange={(event) =>
                        setClipAddNewProjectName(event.currentTarget.value)
                      }
                    />
                  </span>
                </label>
                <label className="projectNameField">
                  <span>英文名称</span>
                  <span className="createProjectInput uiGlassInset">
                    <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
                    <input
                      name="clipProjectEnglishName"
                      autoComplete="off"
                      spellCheck={false}
                      lang="en"
                      maxLength={60}
                      placeholder="可留空；为空时项目卡不显示"
                      value={clipAddNewProjectEnglishName}
                      onChange={(event) =>
                        setClipAddNewProjectEnglishName(event.currentTarget.value)
                      }
                    />
                  </span>
                  <span className="projectSettingsFieldStatus">
                    <small>{clipAddNewProjectEnglishName.length}/60</small>
                    <small>可留空</small>
                  </span>
                </label>
              </div>
            )}

            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={closeClipAddDialog}
              >
                取消
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="submit"
                disabled={
                  clipAddMode === 'existing'
                    ? !clipAddTargetProjectId
                    : !clipAddNewProjectName.trim()
                }
              >
                <Plus size={15} strokeWidth={1.65} />
                {clipAddMode === 'existing' ? '添加' : '创建并添加'}
              </button>
            </footer>
          </form>
        </div>
      )}

      {clipRemoveDialog && (
        <div
          className="overlay clipRemoveOverlay"
          role="alertdialog"
          aria-modal="true"
          aria-label={`从 ${selectedProject.title} 移除 ${clipRemoveDialog.filename}`}
          data-camera-gesture="block"
        >
          <section className="clipRemovePanel uiGlassShell">
            <span className="clipRemoveIcon" aria-hidden="true">
              <Trash2 size={20} strokeWidth={1.45} />
            </span>
            <span className="sheetEyebrow">Remove Reference</span>
            <h2>从当前项目移除？</h2>
            <p>
              “{clipRemoveDialog.filename}”只会从“{selectedProject.title}”中移除。
              磁盘原文件、视觉索引，以及其他项目中的引用都不会被删除。
            </p>
            <footer>
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => setClipRemoveDialogId(null)}
              >
                取消
              </button>
              <button
                className="primaryAction destructive uiGlassInset uiGlassInteractive"
                type="button"
                onClick={removeClipFromCurrentProject}
              >
                从项目移除
              </button>
            </footer>
          </section>
        </div>
      )}

      {clipTagEditor && (
        <div
          className="overlay clipMetadataEditorOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`为 ${clipTagEditor.filename} 添加标签`}
          data-camera-gesture="block"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return
            setClipTagEditorId(null)
            setClipTagDraft('')
            setClipTagEditorStatus('')
          }}
        >
          <form
            className="createPanel clipMetadataEditorPanel uiGlassShell"
            autoComplete="off"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              addClipTag()
            }}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭标签编辑"
              onClick={() => {
                setClipTagEditorId(null)
                setClipTagDraft('')
                setClipTagEditorStatus('')
              }}
            >
              <X size={17} />
            </button>
            <header className="createPanelHeader">
              <span className="sheetEyebrow">Edit Tags</span>
              <h2>添加标签</h2>
              <p>
                标签属于当前项目中的这条素材引用，不会改动其他项目。
              </p>
            </header>

            <div className="clipMetadataContext uiGlassInset">
              <strong>{clipTagEditor.filename}</strong>
              <small>
                {clipTagEditor.tags.length}/{CLIP_DETAIL_TAG_MAX_COUNT} 个标签
              </small>
            </div>

            {clipTagEditor.tags.length > 0 && (
              <div className="clipMetadataTagList" aria-label="现有标签">
                {clipTagEditor.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-label={`删除标签 ${tag}`}
                    onClick={() => removeClipTag(clipTagEditor, tag)}
                  >
                    {tag}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            )}

            <label className="projectNameField">
              <span>新标签</span>
              <span className="createProjectInput uiGlassInset">
                <Plus size={15} strokeWidth={1.5} aria-hidden="true" />
                <input
                  autoFocus
                  name="clipTag"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={CLIP_DETAIL_TAG_MAX_LENGTH}
                  placeholder="输入标签名称"
                  value={clipTagDraft}
                  onChange={(event) => {
                    setClipTagDraft(event.currentTarget.value)
                    setClipTagEditorStatus('')
                  }}
                />
              </span>
              <span className="clipMetadataFieldStatus">
                <small>
                  {clipTagDraft.length}/{CLIP_DETAIL_TAG_MAX_LENGTH}
                </small>
                <small>{clipTagEditorStatus}</small>
              </span>
            </label>

            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => {
                  setClipTagEditorId(null)
                  setClipTagDraft('')
                  setClipTagEditorStatus('')
                }}
              >
                取消
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="submit"
                disabled={
                  !clipTagDraft.trim() ||
                  clipTagEditor.tags.length >= CLIP_DETAIL_TAG_MAX_COUNT
                }
              >
                <Plus size={15} strokeWidth={1.65} />
                添加标签
              </button>
            </footer>
          </form>
        </div>
      )}

      {clipNoteEditor && (
        <div
          className="overlay clipMetadataEditorOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`编辑 ${clipNoteEditor.filename} 的备注`}
          data-camera-gesture="block"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return
            setClipNoteEditorId(null)
            setClipNoteDraft('')
          }}
        >
          <form
            className="createPanel clipMetadataEditorPanel uiGlassShell"
            autoComplete="off"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              saveClipNote()
            }}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭备注编辑"
              onClick={() => {
                setClipNoteEditorId(null)
                setClipNoteDraft('')
              }}
            >
              <X size={17} />
            </button>
            <header className="createPanelHeader">
              <span className="sheetEyebrow">Edit Note</span>
              <h2>编辑备注</h2>
              <p>
                备注属于当前项目中的这条素材引用，不会覆盖其他项目的内容。
              </p>
            </header>

            <div className="clipMetadataContext uiGlassInset">
              <strong>{clipNoteEditor.filename}</strong>
              <small>项目备注</small>
            </div>

            <label className="projectNameField">
              <span>备注内容</span>
              <textarea
                className="clipNoteEditorInput uiGlassInset"
                autoFocus
                maxLength={CLIP_DETAIL_NOTE_MAX_LENGTH}
                placeholder="输入素材备注"
                value={clipNoteDraft}
                onChange={(event) =>
                  setClipNoteDraft(
                    event.currentTarget.value.slice(
                      0,
                      CLIP_DETAIL_NOTE_MAX_LENGTH,
                    ),
                  )
                }
              />
              <span className="clipMetadataFieldStatus">
                <small>
                  {clipNoteDraft.length}/{CLIP_DETAIL_NOTE_MAX_LENGTH}
                </small>
              </span>
            </label>

            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => {
                  setClipNoteEditorId(null)
                  setClipNoteDraft('')
                }}
              >
                取消
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="submit"
              >
                保存备注
              </button>
            </footer>
          </form>
        </div>
      )}

      {clipAiMetadataDialog && (
        <div
          className="overlay clipMetadataEditorOverlay clipAiMetadataOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`AI 识别 ${clipAiMetadataDialog.filename}`}
          data-camera-gesture="block"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return
            closeClipAiMetadataDialog()
          }}
        >
          <section
            className="createPanel clipAiMetadataPanel uiGlassShell"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭 AI 识别"
              onClick={closeClipAiMetadataDialog}
            >
              <X size={17} />
            </button>
            <header className="createPanelHeader">
              <span className="sheetEyebrow">AI Clip Metadata</span>
              <h2>识别标签与备注</h2>
              <p>
                识别结果只会写入当前项目；应用后仍可继续手动修改。
              </p>
            </header>

            <div className="clipMetadataContext uiGlassInset">
              <strong>{clipAiMetadataDialog.filename}</strong>
              <small>
                {clipAiMetadataDialog.status === 'ready'
                  ? clipAiMetadataDialog.evidenceTier === 'visual-index'
                    ? `基于 ${clipAiMetadataDialog.evidenceCount} 个关键帧`
                    : '基于本地预览图'
                  : '片段画面理解'}
              </small>
            </div>

            {clipAiMetadataDialog.status === 'analyzing' && (
              <div className="clipAiMetadataState" role="status">
                <RefreshCw
                  className="clipAiMetadataSpinner"
                  size={22}
                  strokeWidth={1.45}
                />
                <strong>正在理解片段画面…</strong>
                <small>已分析过的关键帧会直接复用缓存。</small>
              </div>
            )}

            {clipAiMetadataDialog.status === 'error' && (
              <div className="clipAiMetadataState clipAiMetadataError" role="alert">
                <Sparkles size={22} strokeWidth={1.45} />
                <strong>暂时无法完成识别</strong>
                <small>{clipAiMetadataDialog.error}</small>
              </div>
            )}

            {clipAiMetadataDialog.status === 'ready' && (
              <>
                <section className="clipAiMetadataSuggestionGroup">
                  <header>
                    <strong>推荐标签</strong>
                    <small>
                      已选择 {clipAiMetadataDialog.selectedTags.length} 个
                    </small>
                  </header>
                  {clipAiMetadataDialog.tags.length > 0 ? (
                    <div
                      className="clipAiMetadataTagChoices"
                      role="group"
                      aria-label="选择 AI 推荐标签"
                    >
                      {clipAiMetadataDialog.tags.map((tag) => {
                        const selected =
                          clipAiMetadataDialog.selectedTags.includes(tag)
                        const availableTagCount = Math.max(
                          0,
                          CLIP_DETAIL_TAG_MAX_COUNT -
                            (clipAiMetadataDialogClip?.tags.length ?? 0),
                        )
                        return (
                          <button
                            className={selected ? 'selected' : undefined}
                            key={tag}
                            type="button"
                            aria-pressed={selected}
                            disabled={
                              !selected &&
                              clipAiMetadataDialog.selectedTags.length >=
                                availableTagCount
                            }
                            onClick={() => toggleClipAiMetadataTag(tag)}
                          >
                            {selected && <Check size={12} strokeWidth={1.8} />}
                            {tag}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="clipAiMetadataEmptySuggestion">
                      没有发现需要补充的新标签。
                    </p>
                  )}
                  {(clipAiMetadataDialogClip?.tags.length ?? 0) >=
                    CLIP_DETAIL_TAG_MAX_COUNT && (
                    <small className="clipAiMetadataLimitHint">
                      当前标签已满；可应用备注，或关闭后先删除一个标签。
                    </small>
                  )}
                </section>

                <section className="clipAiMetadataSuggestionGroup">
                  <header>
                    <strong>备注建议</strong>
                    <small>
                      {clipAiMetadataDialogClip?.note
                        ? '选中后替换当前备注'
                        : '可选'}
                    </small>
                  </header>
                  <button
                    className={`clipAiMetadataNoteChoice${
                      clipAiMetadataDialog.applyNote ? ' selected' : ''
                    }`}
                    type="button"
                    aria-pressed={clipAiMetadataDialog.applyNote}
                    disabled={!clipAiMetadataDialog.note}
                    onClick={() =>
                      setClipAiMetadataDialog((current) =>
                        current?.status === 'ready'
                          ? { ...current, applyNote: !current.applyNote }
                          : current,
                      )
                    }
                  >
                    <span>{clipAiMetadataDialog.note || '暂无备注建议'}</span>
                    <span className="clipAiMetadataChoiceState" aria-hidden="true">
                      {clipAiMetadataDialog.applyNote && (
                        <Check size={14} strokeWidth={1.8} />
                      )}
                    </span>
                  </button>
                </section>

                <div className="clipAiMetadataEvidence">
                  <span>
                    {clipAiMetadataDialog.newlyAnalyzedFrameCount === 0
                      ? '本次结果已复用视觉缓存'
                      : `新分析 ${clipAiMetadataDialog.newlyAnalyzedFrameCount} 个画面`}
                  </span>
                  {clipAiMetadataDialog.evidenceTier === 'thumbnail' && (
                    <span>建立视觉索引后可获得更完整结果</span>
                  )}
                </div>
              </>
            )}

            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={closeClipAiMetadataDialog}
              >
                取消
              </button>
              {clipAiMetadataDialog.status === 'error' ? (
                <button
                  className="primaryAction uiGlassInset uiGlassInteractive active"
                  type="button"
                  disabled={!clipAiMetadataDialogClip}
                  onClick={() => {
                    if (!clipAiMetadataDialogClip) return
                    void openClipAiMetadataDialog(clipAiMetadataDialogClip)
                  }}
                >
                  <RefreshCw size={15} strokeWidth={1.65} />
                  重新识别
                </button>
              ) : (
                <button
                  className="primaryAction uiGlassInset uiGlassInteractive active"
                  type="button"
                  disabled={
                    clipAiMetadataDialog.status !== 'ready' ||
                    (clipAiMetadataDialog.selectedTags.length === 0 &&
                      !clipAiMetadataDialog.applyNote)
                  }
                  onClick={applyClipAiMetadataSuggestion}
                >
                  <Sparkles size={15} strokeWidth={1.65} />
                  应用所选内容
                </button>
              )}
            </footer>
          </section>
        </div>
      )}

      {emptyProjectPrompt && (
        <div
          className="overlay emptyProjectOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${emptyProjectPrompt.title} 尚未导入素材`}
          data-camera-gesture="block"
        >
          <section className="emptyProjectPanel uiGlassShell">
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭"
              onClick={() => setEmptyProjectPromptId(null)}
            >
              <X size={17} />
            </button>
            <span className="emptyProjectPanelIcon" aria-hidden="true">
              <Box size={22} strokeWidth={1.4} />
            </span>
            <span className="sheetEyebrow">Empty Project</span>
            <h2>{emptyProjectPrompt.title}</h2>
            <p>
              这个项目目前没有素材。先导入视频，Aurora 才能建立片段库和帧环。
            </p>
            <footer>
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => setEmptyProjectPromptId(null)}
              >
                稍后设置
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="button"
                onClick={() => openProjectImportPicker(emptyProjectPrompt.id)}
              >
                <Plus size={15} strokeWidth={1.65} />
                导入素材
              </button>
            </footer>
          </section>
        </div>
      )}

      {clipActionNotice && (
        <div
          className="clipActionNotice uiGlassShell"
          role="status"
          aria-live="polite"
        >
          <span>{clipActionNotice.message}</span>
          {clipActionNotice.projectId && (
            <button
              type="button"
              onClick={() => {
                const projectIndex = projects.findIndex(
                  (project) => project.id === clipActionNotice.projectId,
                )
                if (projectIndex >= 0) openProjectDetails(projectIndex)
                setClipActionNotice(null)
              }}
            >
              查看项目
            </button>
          )}
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setClipActionNotice(null)}
          >
            <X size={13} strokeWidth={1.6} />
          </button>
        </div>
      )}

      {searchOpen && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="搜索项目">
          <div className="searchPanel uiGlassShell">
            <div className="panelHeader">
              <Search size={18} />
              <input
                autoFocus
                value={query}
                placeholder="搜索项目名称"
                onChange={(event) => setQuery(event.target.value)}
              />
              <button className="uiGlassInteractive" type="button" aria-label="关闭搜索" onClick={() => setSearchOpen(false)}>
                <X size={17} />
              </button>
            </div>
            {query.trim() && (
              <div className="resultList">
                {searchResults.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      openProjectDetails(projects.findIndex((item) => item.id === project.id))
                      setSearchOpen(false)
                    }}
                  >
                    {!project.usesEmptyGlass ? (
                      <img src={project.cover} alt="" />
                    ) : (
                      <span
                        className="projectCoverPlaceholder"
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      <strong>{project.title}</strong>
                      <small>
                        {project.subtitle.trim()
                          ? `${project.subtitle} · ${
                              project.kind === '3d'
                                ? `${project.modelCount} 个模型`
                                : formatProjectMediaSummary(project, {
                                    includeMaterials: false,
                                  })
                            }`
                          : project.kind === '3d'
                            ? `${project.modelCount} 个模型 · 三维项目`
                            : formatProjectMediaSummary(project, {
                                includeMaterials: false,
                              })}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {createOpen && (
        <div className="overlay createProjectOverlay" role="dialog" aria-modal="true" aria-label="新建项目">
          <form
            className="createPanel uiGlassShell"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault()
              createEmptyProject()
            }}
          >
            <button className="panelClose uiGlassInteractive" type="button" aria-label="关闭" onClick={() => setCreateOpen(false)}>
              <X size={17} />
            </button>
            <header className="createPanelHeader">
              <span className="sheetEyebrow">New Project</span>
              <h2>新建项目</h2>
              <p>创建独立的影像或三维项目空间，沿用同一套 Aurora 项目库。</p>
            </header>

            <div className="createProjectTypeGrid" role="radiogroup" aria-label="项目类型">
              <button
                className={`createProjectChoice uiGlassInset uiGlassInteractive ${newProjectKind === 'video' ? 'active' : ''}`}
                type="button"
                role="radio"
                aria-checked={newProjectKind === 'video'}
                onClick={() => setNewProjectKind('video')}
              >
                <span className="createProjectChoiceIcon" aria-hidden="true">
                  <Video size={20} strokeWidth={1.45} />
                </span>
                <span>
                  <strong>影像项目</strong>
                  <small>项目详情、视觉索引与帧环浏览</small>
                </span>
                {newProjectKind === 'video' ? (
                  <Check className="createProjectChoiceState" size={15} strokeWidth={1.8} />
                ) : (
                  <Circle className="createProjectChoiceState" size={14} strokeWidth={1.2} />
                )}
              </button>
              <button
                className={`createProjectChoice uiGlassInset uiGlassInteractive ${newProjectKind === '3d' ? 'active' : ''}`}
                type="button"
                role="radio"
                aria-checked={newProjectKind === '3d'}
                onClick={() => setNewProjectKind('3d')}
              >
                <span className="createProjectChoiceIcon" aria-hidden="true">
                  <Box size={20} strokeWidth={1.45} />
                </span>
                <span>
                  <strong>三维项目</strong>
                  <small>GLB、OBJ、FBX 模型与三维查看</small>
                </span>
                {newProjectKind === '3d' ? (
                  <Check className="createProjectChoiceState" size={15} strokeWidth={1.8} />
                ) : (
                  <Circle className="createProjectChoiceState" size={14} strokeWidth={1.2} />
                )}
              </button>
            </div>

            <label className="projectNameField">
              <span>项目名称</span>
              <span className="createProjectInput uiGlassInset">
                <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
                <input
                  autoFocus
                  name="projectName"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="输入项目名称"
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.currentTarget.value)}
                />
              </span>
            </label>

            <label className="projectNameField">
              <span>英文名称</span>
              <span className="createProjectInput uiGlassInset">
                <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
                <input
                  name="projectEnglishName"
                  autoComplete="off"
                  spellCheck={false}
                  lang="en"
                  maxLength={60}
                  placeholder="可留空；为空时项目卡不显示"
                  value={newProjectEnglishName}
                  onChange={(event) =>
                    setNewProjectEnglishName(event.currentTarget.value)
                  }
                />
              </span>
              <span className="projectSettingsFieldStatus">
                <small>{newProjectEnglishName.length}/60</small>
                <small>可留空</small>
              </span>
            </label>

            <div className="createPanelMeta">
              <span>
                <HardDrive size={14} strokeWidth={1.45} />
                已登记资产 {libraryStorageLabel}
              </span>
              <span>本地项目舱</span>
            </div>

            <footer className="createPanelActions">
              <button className="secondaryAction uiGlassInset uiGlassInteractive" type="button" onClick={() => setCreateOpen(false)}>
                取消
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="submit"
                disabled={!newProjectName.trim()}
              >
                <Plus size={15} strokeWidth={1.65} />
                创建项目
              </button>
            </footer>
          </form>
        </div>
      )}

      <StartupGate
        enabled={startupGateActive}
        initialView={startupInitialViewRef.current}
        libraryState={startupLibraryState}
        mediaUrls={startupMediaUrls}
        canWarmFrameRing={Boolean(
          startupFrameRingClip,
        )}
        canWarmModelLibrary={Boolean(modelLibraryProject)}
        canWarmFavorites={favoriteGalleryItems.length > 0}
        modelLibraryReflectionRequired={modelLibraryModels.length > 0}
        onWarmupViewChange={setCurrentView}
        onEntryStart={handleStartupEntryStart}
        onEntered={handleStartupEntered}
      />
      <AppUpdatePrompt
        open={appUpdatePromptOpen}
        state={appUpdateState}
        onClose={() => setAppUpdatePromptOpen(false)}
        onUpdate={handleInstallAppUpdate}
      />
    </main>
  )
}

export default App
