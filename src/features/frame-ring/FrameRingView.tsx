import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  GripVertical,
  Maximize2,
  MessageSquareText,
  Orbit,
  Pause,
  Play,
  Plus,
  Search,
  Scissors,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Upload,
  Undo2,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import type { Project } from '../../data/projects'
import type {
  MediaIndexTask,
  ProjectTrimRange,
} from '../../data/mediaLibraryTypes'
import { getMediaColorPreset } from '../../data/mediaColorPresets'
import {
  readWheelDragSample,
  resolveTrackpadSnapTarget,
  resolveWheelDragPreviewPosition,
  type WheelDragAxis,
  WHEEL_DRAG_END_DELAY,
} from '../wheelDragGesture'
import { FrameRingReflectionCanvas } from './FrameRingReflectionCanvas'
import {
  OnlineEmbeddedPlayer,
  type OnlineEmbeddedPlayback,
} from './OnlineEmbeddedPlayer'
import type { FrameRingEntryIntent } from './frameRingEntryIntent'
import {
  clampLocalPlayerTime,
  clampLocalPlayerVolume,
  LOCAL_PLAYER_KEYBOARD_SEEK_SECONDS,
  LOCAL_PLAYER_KEYBOARD_VOLUME_STEP,
  resolveLocalPlayerTrackpadSeekDelta,
  shouldRestartLocalPlayerPlayback,
} from './frameRingPlayerInput'
import { getFrameRingVideoCrossOrigin } from './frameRingLiveReflection'
import {
  acceptFirstFrameRingOnlineReflectionCapture,
  createFrameRingOnlineReflectionPosterSource,
  getFrameRingOnlineReflectionSourceId,
  resolveFrameRingOnlineReflectionSource,
  type FrameRingOnlineReflectionSource,
} from './frameRingOnlineReflection'
import {
  canPlayFrameRingVideoSource,
  clampFramePosition,
  createFrameRingFrames,
  findNearestFrameIndexByTime,
  formatFrameRingTimecode,
  getDefaultFrameIndex,
  getFrameRingReflectionPreloadFrames,
  getFrameRingVisual,
  getVisibleFrameRange,
  parseFrameRingFps,
  resolveFrameRingPlaybackDurationSeconds,
  resolveFrameRingMediaDurationForSource,
  shouldFallbackAfterFrameRingVideoDecodeWatchdog,
  type FrameRingClipSource,
  type FrameRingFrame,
  type FrameRingPreviewTask,
} from './frameRingData'
import {
  getFrameRingCssVariables,
  type ResolvedFrameRingLayout,
} from './frameRingLayout'
import type { BackgroundReflectionSurface } from '../reflection/backgroundReflectionSurfaceProtocol'
import { requiresKnownVideoPreviewProxy } from '../videoPlaybackCompatibility'
import {
  getFrameRingSmartExcludedFrameIds,
  type FrameRingAnnotationSuggestion,
  type FrameRingSmartApplyRequest,
  type FrameRingSmartApplyResult,
  type FrameRingSmartScanResult,
  type FrameRingSmartSensitivity,
} from './frameRingSmartOrganize'

export interface FrameAnnotation {
  favorite: boolean
  rating: number
  tags: string[]
  note: string
  tagsSource?: 'manual' | 'ai'
  noteSource?: 'manual' | 'ai'
}

export interface FrameRingExportDirectory {
  path: string
  name?: string
}

export interface FrameRingExportResult {
  ok: boolean
  outputPath?: string
  message?: string
  addedToProject?: boolean
}

export interface FrameRingStillExportRequest {
  sourcePath: string | null
  sourceFilename: string
  assetId?: string
  frameId: string
  timeSeconds: number
  timecode: string
  resolution: string
  directoryPath: string
  filename: string
}

export interface FrameRingClipExportRequest {
  sourcePath: string | null
  sourceFilename: string
  assetId?: string
  inFrame: number
  outFrame: number
  inSeconds: number
  outSeconds: number
  format: string
  resolution: string
  fps: string
  defaultFilename: string
  addToProjectId?: string
}

export interface FrameRingQuickClipExportRequest {
  sourcePath: string | null
  sourceFilename: string
  assetId?: string
  inSeconds: number
  outSeconds: number
  directoryPath: string
  filename: string
  rangeKind: 'project-trim' | 'full-source'
}

export interface FrameRingTrimRangeSaveRequest {
  inFrame: number
  outFrame: number
  inSeconds: number
  outSeconds: number
}

export interface FrameRingTrimRangeSaveResult {
  ok: boolean
  message?: string
}

export interface FrameRingViewProps {
  active: boolean
  suspended: boolean
  project: Project
  clip: FrameRingClipSource
  relatedClips: readonly Pick<FrameRingClipSource, 'thumbnail'>[]
  layout: ResolvedFrameRingLayout
  cameraYaw: number
  cameraPitch: number
  materialTint: string
  materialTintFilter?: string
  pageColorGradeFilter?: string
  reflectionSurface?: BackgroundReflectionSurface | null
  focusTarget?: {
    frameId?: string
    timeSeconds: number
    requestId: number
    intent: FrameRingEntryIntent
  } | null
  onBack: () => void
  annotations?: Record<string, FrameAnnotation>
  onAnnotationChange?: (frameId: string, annotation: FrameAnnotation) => void
  onChooseExportDirectory?: () =>
    | FrameRingExportDirectory
    | null
    | Promise<FrameRingExportDirectory | null>
  onExportStill?: (
    request: FrameRingStillExportRequest,
  ) => FrameRingExportResult | Promise<FrameRingExportResult>
  onExportClip?: (
    request: FrameRingClipExportRequest,
  ) => FrameRingExportResult | Promise<FrameRingExportResult>
  onQuickExportClip?: (
    request: FrameRingQuickClipExportRequest,
  ) => FrameRingExportResult | Promise<FrameRingExportResult>
  savedTrimRange?: ProjectTrimRange | null
  onSaveTrimRange?: (
    request: FrameRingTrimRangeSaveRequest,
  ) =>
    | FrameRingTrimRangeSaveResult
    | Promise<FrameRingTrimRangeSaveResult>
  onResetTrimRange?: () =>
    | FrameRingTrimRangeSaveResult
    | Promise<FrameRingTrimRangeSaveResult>
  onRevealSource?: (sourcePath: string) => boolean | Promise<boolean>
  onDeleteFrame?: (frameId: string) => boolean | Promise<boolean>
  onScanSmartFrames?: (
    sensitivity: FrameRingSmartSensitivity,
  ) => FrameRingSmartScanResult | Promise<FrameRingSmartScanResult>
  onAnalyzeSmartFrames?: (
    frameIds: readonly string[],
  ) => FrameRingAnnotationSuggestion[] | Promise<FrameRingAnnotationSuggestion[]>
  onCancelSmartOrganize?: () => void | Promise<void>
  onApplySmartOrganize?: (
    request: FrameRingSmartApplyRequest,
  ) => FrameRingSmartApplyResult | Promise<FrameRingSmartApplyResult>
  onUndoSmartOrganize?: () => boolean | Promise<boolean>
  indexTask?: MediaIndexTask
  indexProgress?: number
  onBuildFrameRing?: () => boolean | Promise<boolean>
  sourceOffline?: boolean
  previewTask?: FrameRingPreviewTask
  previewProgress?: number
  previewError?: string | null
  previewUsesProxy?: boolean
  onPreviewPlaybackError?: () => boolean | Promise<boolean>
  externalPreview?: boolean
  onAddExternalVideo?: () => void
  onlinePlayback?: OnlineEmbeddedPlayback | null
  onlineFavorite?: boolean
  onToggleOnlineFavorite?: () => void
  onAddOnlineToProject?: () => void
}

const FRAME_SETTLE_DURATION = 440
const VIDEO_DECODE_WATCHDOG_DELAY = 1_400
const DEFAULT_TRIM_DURATION_SECONDS = 2
const TRIM_THUMBNAIL_TARGET_WIDTH = 64
const FRAME_NOTE_MAX_LENGTH = 20
const TAG_CAPACITY_STATUS = '标签已满，请先移除一个标签'
const TRIM_ADJUSTMENT_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
])

const resolveTimelineThumbnailTileFrames = (
  viewportFrames: number,
  timelineWidth: number,
) => {
  const targetTileCount = Math.max(
    1,
    Math.ceil(Math.max(1, timelineWidth) / TRIM_THUMBNAIL_TARGET_WIDTH),
  )
  const rawTileFrames = Math.max(1, viewportFrames / targetTileCount)
  return Math.max(1, 2 ** Math.round(Math.log2(rawTileFrames)))
}

const getTimelineThumbnailTimeKey = (timeSeconds: number) =>
  String(Math.round(timeSeconds * 1_000_000))

const getExportResolutionLabel = (resolution: string) =>
  resolution.includes('3840') ? `${resolution} (4K UHD)` : resolution

const getExportFpsLabel = (fps: string) =>
  fps.toLowerCase().includes('fps') ? fps : `${fps} fps`

const getStillExportDirectory = (projectTitle: string) =>
  `${projectTitle.trim() || 'Aurora Project'}/Exports/Stills`

const getQuickClipExportDirectory = (projectTitle: string) =>
  `${projectTitle.trim() || 'Aurora Project'}/Exports/Video`

const sanitizeStillExportFilename = (value: string) => Array.from(value.trim())
  .filter((character) => character.charCodeAt(0) >= 32)
  .join('')
  .replace(/[<>:"/\\|?*]/g, '-')
  .replace(/\s+/g, '_')
  .replace(/_{2,}/g, '_')
  .replace(/-{2,}/g, '-')
  .replace(/[. ]+$/g, '')

const getDefaultStillExportFilename = (
  sourceFilename: string,
  timecode: string,
  resolution: string,
) => {
  const sourceStem = sourceFilename.replace(/\.[^./\\]+$/, '') || 'Aurora_Frame'
  const safeSourceStem = sanitizeStillExportFilename(sourceStem) || 'Aurora_Frame'
  const safeTimecode = timecode.replace(/[:;]/g, '-')
  const safeResolution = resolution.replace(/\s*[x×]\s*/i, 'x').replace(/\s+/g, '')
  return `${safeSourceStem}_STILL_TC_${safeTimecode}_${safeResolution}.png`
}

const normalizeStillExportFilename = (value: string, fallback: string) => {
  const sanitized = sanitizeStillExportFilename(value) || fallback
  const fallbackStem = fallback.replace(/\.png$/i, '')
  const filenameStem = sanitized.replace(/\.[a-z0-9]{2,5}$/i, '') || fallbackStem
  return `${filenameStem}.png`
}

const getSourceVideoExtension = (sourceFilename: string) =>
  sourceFilename.match(/\.([a-z0-9]{2,8})$/i)?.[1].toLowerCase() || 'mov'

const getDefaultQuickClipExportFilename = (
  sourceFilename: string,
  inTimecode: string,
  outTimecode: string,
) => {
  const sourceStem = sourceFilename.replace(/\.[^./\\]+$/, '') || 'Aurora_Clip'
  const safeSourceStem = sanitizeStillExportFilename(sourceStem) || 'Aurora_Clip'
  const safeInTimecode = inTimecode.replace(/[:;]/g, '-')
  const safeOutTimecode = outTimecode.replace(/[:;]/g, '-')
  const extension = getSourceVideoExtension(sourceFilename)
  return `${safeSourceStem}_QUICK_TC_${safeInTimecode}_${safeOutTimecode}.${extension}`
}

const normalizeQuickClipExportFilename = (
  value: string,
  fallback: string,
  extension: string,
) => {
  const sanitized = sanitizeStillExportFilename(value) || fallback
  const fallbackStem = fallback.replace(/\.[a-z0-9]{2,8}$/i, '')
  const filenameStem = sanitized.replace(/\.[a-z0-9]{2,8}$/i, '') || fallbackStem
  return `${filenameStem}.${extension}`
}

const getDefaultClipExportFilename = (
  sourceFilename: string,
  inTimecode: string,
  outTimecode: string,
  format: string,
) => {
  const sourceStem = sourceFilename.replace(/\.[^./\\]+$/, '') || 'Aurora_Clip'
  const safeSourceStem = sanitizeStillExportFilename(sourceStem) || 'Aurora_Clip'
  const safeInTimecode = inTimecode.replace(/[:;]/g, '-')
  const safeOutTimecode = outTimecode.replace(/[:;]/g, '-')
  const extension = format.toLowerCase().includes('h.264') ? 'mp4' : 'mov'
  return `${safeSourceStem}_CLIP_TC_${safeInTimecode}_${safeOutTimecode}.${extension}`
}

interface TrimViewport {
  startFrame: number
  endFrame: number
}

type TrimHandle = 'start' | 'end'

type VideoFrameCallbackMetadata = {
  mediaTime?: number
}

type VideoWithDecodeMetrics = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameCallbackMetadata) => void,
  ) => number
  cancelVideoFrameCallback?: (handle: number) => void
  getVideoPlaybackQuality?: () => {
    totalVideoFrames?: number
  }
  webkitDecodedFrameCount?: number
}

interface TimelineTrimThumbnailSet {
  sourceKey: string
  samples: Record<string, {
    thumbnail: string
    timeSeconds: number
  }>
}

const readDecodedVideoFrameCount = (video: VideoWithDecodeMetrics) => {
  const qualityCount = video.getVideoPlaybackQuality?.().totalVideoFrames
  if (Number.isFinite(qualityCount)) return Number(qualityCount)
  if (Number.isFinite(video.webkitDecodedFrameCount)) {
    return Number(video.webkitDecodedFrameCount)
  }
  return null
}

const resolveTrimViewport = (
  clipInFrame: number,
  clipOutFrame: number,
  totalFrames: number,
  fps: number,
): TrimViewport => {
  const safeTotalFrames = Math.max(1, Math.round(totalFrames))
  const safeInFrame = Math.min(safeTotalFrames - 1, Math.max(0, Math.round(clipInFrame)))
  const safeOutFrame = Math.min(
    safeTotalFrames,
    Math.max(safeInFrame + 1, Math.round(clipOutFrame)),
  )
  const selectionFrames = Math.max(1, safeOutFrame - safeInFrame)
  const minimumViewportFrames = Math.max(2, Math.round(Math.max(1, fps) * 0.5))
  const viewportFrames = Math.min(
    safeTotalFrames,
    Math.max(selectionFrames * 2, minimumViewportFrames),
  )
  const centeredStartFrame = Math.round(
    (safeInFrame + safeOutFrame - viewportFrames) / 2,
  )
  const startFrame = Math.min(
    Math.max(0, safeTotalFrames - viewportFrames),
    Math.max(0, centeredStartFrame),
  )

  return {
    startFrame,
    endFrame: startFrame + viewportFrames,
  }
}

interface StillExportTarget {
  frameId: string
  timeSeconds: number
  timecode: string
  resolution: string
  sourceFilename: string
}

type QuickExportKind = 'still' | 'video'

interface StillExportDirectoryPickerOptions {
  id: string
  mode: 'readwrite'
  startIn: FileSystemDirectoryHandle | 'pictures'
}

type StillExportPickerWindow = Window & {
  showDirectoryPicker?: (
    options: StillExportDirectoryPickerOptions,
  ) => Promise<FileSystemDirectoryHandle>
}

export function FrameRingView({
  active,
  suspended,
  project,
  clip,
  relatedClips,
  layout,
  cameraYaw,
  cameraPitch,
  materialTint,
  materialTintFilter = '',
  pageColorGradeFilter = '',
  reflectionSurface = null,
  focusTarget = null,
  onBack,
  annotations,
  onAnnotationChange,
  onChooseExportDirectory,
  onExportStill,
  onExportClip,
  onQuickExportClip,
  savedTrimRange = null,
  onSaveTrimRange,
  onResetTrimRange,
  onRevealSource,
  onDeleteFrame,
  onScanSmartFrames,
  onAnalyzeSmartFrames,
  onCancelSmartOrganize,
  onApplySmartOrganize,
  onUndoSmartOrganize,
  indexTask = 'idle',
  indexProgress,
  onBuildFrameRing,
  sourceOffline = false,
  previewTask = 'ready',
  previewProgress,
  previewError,
  previewUsesProxy = false,
  onPreviewPlaybackError,
  externalPreview = false,
  onAddExternalVideo,
  onlinePlayback = null,
  onlineFavorite = false,
  onToggleOnlineFavorite,
  onAddOnlineToProject,
}: FrameRingViewProps) {
  const onlinePlaybackMode = Boolean(onlinePlayback)
  const onlinePlaybackKey = onlinePlayback
    ? `${onlinePlayback.provider}:${onlinePlayback.kind}:${onlinePlayback.mediaId}`
    : ''
  const relatedThumbnails = useMemo(
    () => [clip.thumbnail, ...relatedClips.map((item) => item.thumbnail)],
    [clip.thumbnail, relatedClips],
  )
  const frames = useMemo(
    () => createFrameRingFrames(clip, relatedThumbnails),
    [clip, relatedThumbnails],
  )
  const hasFrameRing = frames.length > 0
  const hasUnindexedLocalActions =
    !hasFrameRing &&
    !onlinePlaybackMode &&
    !externalPreview &&
    !sourceOffline &&
    Boolean(clip.sourcePath)
  const hasLocalTimelineThumbnailSource =
    !onlinePlaybackMode &&
    !externalPreview &&
    Boolean(clip.sourcePath)
  const hasLocalBottomActions = hasFrameRing || hasUnindexedLocalActions
  const mediaColorFilter = getMediaColorPreset(clip.colorPreset).cssFilter
  const getRequestedFrameIndex = useCallback(() => {
    if (frames.length === 0) return 0
    if (focusTarget?.frameId) {
      const exactIndex = frames.findIndex(
        (frame) => frame.id === focusTarget.frameId,
      )
      if (exactIndex >= 0) return exactIndex
    }
    if (focusTarget) {
      return findNearestFrameIndexByTime(frames, focusTarget.timeSeconds)
    }
    return getDefaultFrameIndex(frames.length)
  }, [focusTarget, frames])
  const initialIndex = getRequestedFrameIndex()
  const [reflectionHost, setReflectionHost] = useState<HTMLElement | null>(null)
  const [hasGlassBeenActive, setHasGlassBeenActive] = useState(active)
  const [hasPageBeenActive, setHasPageBeenActive] = useState(active)
  const viewRef = useRef<HTMLElement>(null)
  const [position, setPosition] = useState(initialIndex)
  const [settledIndex, setSettledIndex] = useState(initialIndex)
  const [targetIndex, setTargetIndex] = useState(initialIndex)
  const [isDragging, setIsDragging] = useState(false)
  const [isSettling, setIsSettling] = useState(false)
  const [hoveredFrameId, setHoveredFrameId] = useState<string | null>(null)
  const [settleDuration, setSettleDuration] = useState(FRAME_SETTLE_DURATION)
  const [boundary, setBoundary] = useState<'start' | 'end' | null>(null)
  const [isPlayerPlaying, setIsPlayerPlaying] = useState(false)
  const [onlineReflectionCapture, setOnlineReflectionCapture] =
    useState<FrameRingOnlineReflectionSource | null>(null)
  const [onlineReflectionReadySourceId, setOnlineReflectionReadySourceId] =
    useState('')
  const [playerTimeSeconds, setPlayerTimeSeconds] = useState(
    frames[initialIndex]?.timeSeconds ??
      focusTarget?.timeSeconds ??
      savedTrimRange?.inSeconds ??
      0,
  )
  const mediaDurationSourceKey = `${clip.id}\u0000${clip.sourceUrl ?? ''}`
  const [mediaDurationSample, setMediaDurationSample] = useState<{
    sourceKey: string
    durationSeconds: number
  } | null>(null)
  const [previewReflectionSnapshotRequest, setPreviewReflectionSnapshotRequest] =
    useState({
      revision: 0,
      expectedMediaTime: frames[initialIndex]?.timeSeconds ?? 0,
    })
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false)
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(false)
  const [windowControlsVisible, setWindowControlsVisible] = useState(false)
  const [playerVolume, setPlayerVolume] = useState(1)
  const [playerMuted, setPlayerMuted] = useState(false)
  const fullscreenControlsHideTimerRef = useRef<number | null>(null)
  const [frameAnnotations, setFrameAnnotations] = useState<Record<string, FrameAnnotation>>(
    annotations ?? {},
  )
  const [tagDraft, setTagDraft] = useState('')
  const [tagDraftFits, setTagDraftFits] = useState(true)
  const [actionStatus, setActionStatus] = useState('')
  const [annotationEditing, setAnnotationEditing] = useState(false)
  const [frameQuery, setFrameQuery] = useState('')
  const [trimMode, setTrimMode] = useState(false)
  const infoPanelVisible = hasFrameRing || trimMode
  const frameRingCssVariables = useMemo(
    () => ({
      ...getFrameRingCssVariables(layout, {
        hasFrameRing,
        alignInfoToUnindexedTrim: !hasFrameRing && trimMode,
      }),
      '--media-color-filter': mediaColorFilter,
    }) as CSSProperties,
    [hasFrameRing, layout, mediaColorFilter, trimMode],
  )
  const [clipInFrame, setClipInFrame] = useState(0)
  const [clipOutFrame, setClipOutFrame] = useState(1)
  const [trimViewport, setTrimViewport] = useState<TrimViewport>({
    startFrame: 0,
    endFrame: 1,
  })
  const trimFilmstripRef = useRef<HTMLDivElement>(null)
  const [trimFilmstripWidth, setTrimFilmstripWidth] = useState(0)
  const [timelineTrimThumbnails, setTimelineTrimThumbnails] =
    useState<TimelineTrimThumbnailSet | null>(null)
  const timelineTrimThumbnailsRef = useRef<TimelineTrimThumbnailSet | null>(null)
  const trimThumbnailRequestRevisionRef = useRef(0)
  const [trimHandleAdjusting, setTrimHandleAdjusting] = useState(false)
  const [activeTrimHandle, setActiveTrimHandle] = useState<TrimHandle | null>(null)
  const [exportFormat, setExportFormat] = useState('Apple ProRes 422 HQ')
  const [exportResolution, setExportResolution] = useState(
    getExportResolutionLabel(clip.resolution),
  )
  const [exportFps, setExportFps] = useState(getExportFpsLabel(clip.fps))
  const [addExportToCurrentProject, setAddExportToCurrentProject] =
    useState(false)
  const [stillExportDialogOpen, setStillExportDialogOpen] = useState(false)
  const [quickExportKind, setQuickExportKind] =
    useState<QuickExportKind>('still')
  const [smartOrganizeDialogOpen, setSmartOrganizeDialogOpen] = useState(false)
  const [smartOrganizeSensitivity, setSmartOrganizeSensitivity] =
    useState<FrameRingSmartSensitivity>('conservative')
  const [smartOrganizeStage, setSmartOrganizeStage] = useState<
    | 'ready'
    | 'scanning'
    | 'review'
    | 'analyzing'
    | 'preview'
    | 'applying'
    | 'complete'
  >('ready')
  const [smartOrganizeScan, setSmartOrganizeScan] =
    useState<FrameRingSmartScanResult | null>(null)
  const [smartOrganizeSelectedFrameIds, setSmartOrganizeSelectedFrameIds] =
    useState<Set<string>>(() => new Set())
  const [smartOrganizeAnnotationsEnabled, setSmartOrganizeAnnotationsEnabled] =
    useState(Boolean(onAnalyzeSmartFrames))
  const [smartOrganizeSuggestions, setSmartOrganizeSuggestions] = useState<
    FrameRingAnnotationSuggestion[]
  >([])
  const [smartOrganizeResult, setSmartOrganizeResult] =
    useState<FrameRingSmartApplyResult | null>(null)
  const [smartOrganizeError, setSmartOrganizeError] = useState('')
  const smartOrganizeRunRevisionRef = useRef(0)
  const [stillExportDirectory, setStillExportDirectory] = useState('')
  const [stillExportFilename, setStillExportFilename] = useState('')
  const editableTagsRef = useRef<HTMLDivElement>(null)
  const tagFitProbeRef = useRef<HTMLButtonElement>(null)
  const [stillExportTarget, setStillExportTarget] = useState<StillExportTarget | null>(null)
  const [stillExportDirectoryPicked, setStillExportDirectoryPicked] = useState(false)
  const [stillExportDirectoryPickerStatus, setStillExportDirectoryPickerStatus] = useState('')
  const [stillExportDirectoryPicking, setStillExportDirectoryPicking] = useState(false)
  const [exportPending, setExportPending] = useState(false)
  const [trimRangePending, setTrimRangePending] = useState(false)
  const [videoPlaybackFailed, setVideoPlaybackFailed] = useState(false)
  const [pendingDeleteFrameId, setPendingDeleteFrameId] = useState<
    string | null
  >(null)
  const [buildFrameRingPending, setBuildFrameRingPending] = useState(false)
  const interactive = active && !suspended
  const knownCompatibilityPreviewRequired =
    !sourceOffline &&
    clip.sampleCount <= 0 &&
    requiresKnownVideoPreviewProxy(clip.codec) &&
    !previewUsesProxy
  const hasPlayableVideo = !sourceOffline &&
    canPlayFrameRingVideoSource(
      clip.sourceUrl,
      videoPlaybackFailed,
    ) && !knownCompatibilityPreviewRequired
  const frameDragSpacing = layout.dragSpacing
  const suppressClick = useRef(false)
  const settleTimer = useRef<number | undefined>(undefined)
  const settleRaf = useRef<number | undefined>(undefined)
  const dragRaf = useRef<number | undefined>(undefined)
  const pendingPosition = useRef(initialIndex)
  const ringStageRef = useRef<HTMLDivElement>(null)
  const ringHitLayerRef = useRef<HTMLDivElement>(null)
  const ringGeometryCacheSignatureRef = useRef('')
  const ringGeometrySyncCountRef = useRef(0)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const previewFallbackRequestedRef = useRef(false)
  const videoDecodeWatchdogRef = useRef<{
    generation: number
    timer: number | null
    frameCallback: number | null
    video: VideoWithDecodeMetrics | null
  }>({
    generation: 0,
    timer: null,
    frameCallback: null,
    video: null,
  })
  const stillExportDialogRef = useRef<HTMLFormElement>(null)
  const stillExportTriggerRef = useRef<HTMLButtonElement>(null)
  const stillExportDirectoryHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const stillExportDirectoryPickerButtonRef = useRef<HTMLButtonElement>(null)
  const stillExportDirectoryPickingRef = useRef(false)
  const handledEntryIntentRequestRef = useRef<number | null>(null)
  const wheelDragRef = useRef({
    active: false,
    axis: null as WheelDragAxis | null,
    snapAnchor: initialIndex,
    rawPosition: initialIndex,
    visualPosition: initialIndex,
    previewStartPosition: initialIndex,
    snapTarget: initialIndex,
    lastTime: 0,
    velocityX: 0,
    hasVelocity: false,
  })
  const wheelReleaseTimer = useRef<number | undefined>(undefined)
  const wheelPreviewRaf = useRef<number | undefined>(undefined)
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {})
  const playerWheelSeekRef = useRef<{
    animationFrame: number | undefined
    pendingTime: number | null
  }>({
    animationFrame: undefined,
    pendingTime: null,
  })
  const lastAudiblePlayerVolumeRef = useRef(1)
  const trimHandleAdjustingRef = useRef(false)
  const activeTrimHandleRef = useRef<TrimHandle | null>(null)
  const trimPointerDragRef = useRef({
    active: false,
    handle: null as TrimHandle | null,
    pointerId: -1,
    startClientX: 0,
    startFrame: 0,
    framesPerPixel: 1,
  })
  const trimRangeRef = useRef({ clipInFrame: 0, clipOutFrame: 1 })
  const dragState = useRef({
    active: false,
    dragging: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startPosition: initialIndex,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
  })

  const handleOnlineReflectionFrame = useCallback((dataUrl: string | null) => {
    if (!onlinePlaybackKey) return
    setOnlineReflectionCapture((current) =>
      acceptFirstFrameRingOnlineReflectionCapture(
        current,
        onlinePlaybackKey,
        dataUrl,
      ),
    )
  }, [onlinePlaybackKey])

  useEffect(() => {
    setOnlineReflectionCapture(null)
    setOnlineReflectionReadySourceId('')
  }, [onlinePlaybackKey])

  const requestPreviewReflectionSnapshot = useCallback(
    (expectedMediaTime: number) => {
      if (!Number.isFinite(expectedMediaTime)) return
      setPreviewReflectionSnapshotRequest((current) => ({
        revision: current.revision + 1,
        expectedMediaTime,
      }))
    },
    [],
  )

  const clearVideoDecodeWatchdog = useCallback(() => {
    const watchdog = videoDecodeWatchdogRef.current
    watchdog.generation += 1
    if (watchdog.timer !== null) {
      window.clearTimeout(watchdog.timer)
      watchdog.timer = null
    }
    if (watchdog.frameCallback !== null && watchdog.video) {
      watchdog.video.cancelVideoFrameCallback?.(watchdog.frameCallback)
      watchdog.frameCallback = null
    }
    watchdog.video = null
  }, [])

  const requestCompatibleVideoPreview = useCallback(() => {
    if (
      sourceOffline ||
      previewUsesProxy ||
      previewFallbackRequestedRef.current ||
      !onPreviewPlaybackError
    ) {
      return false
    }

    previewFallbackRequestedRef.current = true
    clearVideoDecodeWatchdog()
    setIsPlayerPlaying(false)
    setVideoPlaybackFailed(true)
    setActionStatus('正在准备兼容视频预览…')
    void Promise.resolve()
      .then(() => onPreviewPlaybackError())
      .then((prepared) => {
        if (prepared === false) {
          previewFallbackRequestedRef.current = false
          setVideoPlaybackFailed(false)
          setActionStatus('视频预览准备失败，请检查素材文件后重试')
        }
      })
      .catch(() => {
        previewFallbackRequestedRef.current = false
        setVideoPlaybackFailed(false)
        setActionStatus('视频预览准备失败，请检查素材文件后重试')
      })
    return true
  }, [
    clearVideoDecodeWatchdog,
    onPreviewPlaybackError,
    previewUsesProxy,
    sourceOffline,
  ])

  const armVideoDecodeWatchdog = useCallback((source: HTMLVideoElement) => {
    clearVideoDecodeWatchdog()
    if (
      previewUsesProxy ||
      previewFallbackRequestedRef.current ||
      !interactive
    ) {
      return
    }

    const video = source as VideoWithDecodeMetrics
    const watchdog = videoDecodeWatchdogRef.current
    const generation = watchdog.generation
    const sourceKey = video.currentSrc || video.src
    const startedMediaTime = video.currentTime
    const decodedFrameCountBefore = readDecodedVideoFrameCount(video)
    let observedAdvancingVideoFrame = false
    const supportsFrameCallbacks = Boolean(video.requestVideoFrameCallback)
    const sourceFps =
      clip.fpsValue !== null &&
      clip.fpsValue !== undefined &&
      Number.isFinite(clip.fpsValue) &&
      clip.fpsValue > 0
        ? clip.fpsValue
        : parseFrameRingFps(clip.fps)
    const watchdogDelay = Math.max(
      VIDEO_DECODE_WATCHDOG_DELAY,
      Math.min(5_000, 2_500 / Math.max(0.5, sourceFps)),
    )

    watchdog.video = video

    const waitForAdvancingFrame = () => {
      if (
        watchdog.generation !== generation ||
        observedAdvancingVideoFrame ||
        !video.requestVideoFrameCallback
      ) {
        return
      }
      watchdog.frameCallback = video.requestVideoFrameCallback(
        (_now, metadata) => {
          watchdog.frameCallback = null
          if (watchdog.generation !== generation) return
          if (
            Number.isFinite(metadata.mediaTime) &&
            Number(metadata.mediaTime) > startedMediaTime + 0.05
          ) {
            observedAdvancingVideoFrame = true
            return
          }
          waitForAdvancingFrame()
        },
      )
    }

    waitForAdvancingFrame()
    watchdog.timer = window.setTimeout(() => {
      watchdog.timer = null
      if (
        watchdog.generation !== generation ||
        previewVideoRef.current !== video ||
        (video.currentSrc || video.src) !== sourceKey
      ) {
        return
      }

      const decodedFrameCountAfter = readDecodedVideoFrameCount(video)
      if (shouldFallbackAfterFrameRingVideoDecodeWatchdog({
        playing: !video.paused && !video.ended,
        documentVisible: document.visibilityState === 'visible',
        monitoringSupported:
          supportsFrameCallbacks || decodedFrameCountBefore !== null,
        elapsedMediaTime: video.currentTime - startedMediaTime,
        observedAdvancingVideoFrame,
        decodedFrameCountBefore,
        decodedFrameCountAfter,
      })) {
        requestCompatibleVideoPreview()
      }
    }, watchdogDelay)
  }, [
    clearVideoDecodeWatchdog,
    clip.fps,
    clip.fpsValue,
    interactive,
    previewUsesProxy,
    requestCompatibleVideoPreview,
  ])

  const emptyPreviewTimeSeconds = savedTrimRange?.inSeconds ?? 0
  const emptyPreviewTimecode = formatFrameRingTimecode(
    emptyPreviewTimeSeconds,
    clip.fpsValue ?? parseFrameRingFps(clip.fps),
  )
  const emptyPreviewFrame = useMemo<FrameRingFrame>(() => ({
    id: `${clip.assetId ?? clip.id}:preview`,
    index: 0,
    thumbnail: clip.thumbnail,
    timeSeconds: emptyPreviewTimeSeconds,
    timecode: emptyPreviewTimecode,
    shortTimecode: emptyPreviewTimecode.slice(3, 8),
    cropX: 50,
    cropY: 50,
    brightness: 1,
  }), [
    clip.assetId,
    clip.id,
    clip.thumbnail,
    emptyPreviewTimeSeconds,
    emptyPreviewTimecode,
  ])
  const settledFrame = frames[settledIndex] ?? frames[0] ?? emptyPreviewFrame
  const mediaDurationSeconds = resolveFrameRingMediaDurationForSource(
    mediaDurationSample,
    mediaDurationSourceKey,
  )
  const durationSeconds =
    typeof clip.sourceDurationSeconds === 'number' &&
    Number.isFinite(clip.sourceDurationSeconds) &&
    clip.sourceDurationSeconds > 0
      ? clip.sourceDurationSeconds
      : resolveFrameRingPlaybackDurationSeconds(
          clip.durationSeconds,
          clip.duration,
          mediaDurationSeconds,
        )
  const playerFps =
    clip.fpsValue !== null &&
    clip.fpsValue !== undefined &&
    Number.isFinite(clip.fpsValue) &&
    clip.fpsValue > 0
      ? clip.fpsValue
      : parseFrameRingFps(clip.fps)
  const playerFrameIndex = findNearestFrameIndexByTime(
    frames,
    playerTimeSeconds,
  )
  const playerFrame = frames[playerFrameIndex] ?? settledFrame
  const playerTimecode = formatFrameRingTimecode(playerTimeSeconds, playerFps)
  const totalTrimFrames = Math.max(1, Math.round(durationSeconds * playerFps))
  const clipInSeconds = Math.min(durationSeconds, clipInFrame / playerFps)
  const clipOutSeconds = Math.min(durationSeconds, clipOutFrame / playerFps)
  const minimumPlaybackDuration = 1 / playerFps
  const projectPlaybackStartSeconds = savedTrimRange
    ? Math.min(
        Math.max(0, durationSeconds - minimumPlaybackDuration),
        Math.max(0, savedTrimRange.inSeconds),
      )
    : 0
  const projectPlaybackEndSeconds = savedTrimRange
    ? Math.min(
        durationSeconds,
        Math.max(
          projectPlaybackStartSeconds + minimumPlaybackDuration,
          Math.min(durationSeconds, savedTrimRange.outSeconds),
        ),
      )
    : durationSeconds
  const quickClipInSeconds = savedTrimRange ? projectPlaybackStartSeconds : 0
  const quickClipOutSeconds = savedTrimRange
    ? projectPlaybackEndSeconds
    : durationSeconds
  const quickClipInTimecode = formatFrameRingTimecode(
    quickClipInSeconds,
    playerFps,
  )
  const quickClipOutTimecode = formatFrameRingTimecode(
    quickClipOutSeconds,
    playerFps,
  )
  const quickClipDurationTimecode = formatFrameRingTimecode(
    Math.max(minimumPlaybackDuration, quickClipOutSeconds - quickClipInSeconds),
    playerFps,
  )
  const quickClipExtension = getSourceVideoExtension(clip.filename)
  const quickClipDefaultFilename = getDefaultQuickClipExportFilename(
    clip.filename,
    quickClipInTimecode,
    quickClipOutTimecode,
  )
  const playbackStartSeconds = trimMode
    ? clipInSeconds
    : projectPlaybackStartSeconds
  const playbackEndSeconds = trimMode
    ? clipOutSeconds
    : projectPlaybackEndSeconds
  const playbackDurationSeconds = Math.max(
    minimumPlaybackDuration,
    playbackEndSeconds - playbackStartSeconds,
  )
  const durationTimecode = formatFrameRingTimecode(
    playbackDurationSeconds,
    playerFps,
  )
  const playerProgress = Math.min(
    100,
    Math.max(
      0,
      ((playerTimeSeconds - playbackStartSeconds) / playbackDurationSeconds) * 100,
    ),
  )
  const effectivePlayerVolume = playerMuted ? 0 : playerVolume
  const windowPlaybackControlsVisible =
    !isPlayerPlaying || windowControlsVisible
  const clipSelectionFrames = Math.max(1, clipOutFrame - clipInFrame)
  const clipSelectionDuration = clipSelectionFrames / playerFps
  const trimViewportFrames = Math.max(
    1,
    trimViewport.endFrame - trimViewport.startFrame,
  )
  const getTrimProgress = (frame: number) => Math.min(
    100,
    Math.max(0, ((frame - trimViewport.startFrame) / trimViewportFrames) * 100),
  )
  const clipInProgress = getTrimProgress(clipInFrame)
  const clipOutProgress = getTrimProgress(clipOutFrame)
  const playerFrameForTrim = Math.round(playerTimeSeconds * playerFps)
  const trimPlayheadProgress = getTrimProgress(playerFrameForTrim)
  const trimPlayheadOnBoundary =
    Math.abs(playerFrameForTrim - clipInFrame) <= 1 ||
    Math.abs(playerFrameForTrim - clipOutFrame) <= 1
  const trimSelectionCoverage = Math.min(
    1,
    clipSelectionFrames / trimViewportFrames,
  )
  const timelineThumbnailSourceKey = JSON.stringify([
    clip.id,
    clip.assetId,
    clip.sourcePath,
  ])
  const timelineThumbnailTileFrames = resolveTimelineThumbnailTileFrames(
    trimViewportFrames,
    trimFilmstripWidth,
  )
  const timelineThumbnailFirstTileFrame = Math.floor(
    trimViewport.startFrame / timelineThumbnailTileFrames,
  ) * timelineThumbnailTileFrames
  const timelineThumbnailLastTileFrame = Math.floor(
    Math.max(trimViewport.startFrame, trimViewport.endFrame - 1) /
      timelineThumbnailTileFrames,
  ) * timelineThumbnailTileFrames
  const timelineThumbnailRequestKey = JSON.stringify([
    timelineThumbnailSourceKey,
    timelineThumbnailTileFrames,
    timelineThumbnailFirstTileFrame,
    timelineThumbnailLastTileFrame,
    playerFps,
  ])
  const timelineThumbnailRequests = useMemo(() => {
    const requests: Array<{
      key: string
      startFrame: number
      endFrame: number
      sampleFrame: number
      timeSeconds: number
    }> = []
    for (
      let startFrame = timelineThumbnailFirstTileFrame;
      startFrame <= timelineThumbnailLastTileFrame;
      startFrame += timelineThumbnailTileFrames
    ) {
      const endFrame = Math.min(
        totalTrimFrames,
        startFrame + timelineThumbnailTileFrames,
      )
      const sampleFrame = Math.min(
        totalTrimFrames - 1,
        Math.floor((startFrame + endFrame) / 2),
      )
      const timeSeconds = sampleFrame / playerFps
      requests.push({
        key: getTimelineThumbnailTimeKey(timeSeconds),
        startFrame,
        endFrame,
        sampleFrame,
        timeSeconds,
      })
    }
    return requests
  }, [
    playerFps,
    timelineThumbnailFirstTileFrame,
    timelineThumbnailLastTileFrame,
    timelineThumbnailTileFrames,
    totalTrimFrames,
  ])
  const timelineThumbnailTiles = useMemo(() =>
    timelineThumbnailRequests.map((request) => ({
      ...request,
      leftPercent:
        ((request.startFrame - trimViewport.startFrame) / trimViewportFrames) * 100,
      widthPercent:
        ((request.endFrame - request.startFrame) / trimViewportFrames) * 100,
    })), [
    timelineThumbnailRequests,
    trimViewport.startFrame,
    trimViewportFrames,
  ])

  useLayoutEffect(() => {
    if (!trimMode) return
    const filmstrip = trimFilmstripRef.current
    if (!filmstrip) return
    const updateWidth = () => {
      const nextWidth = filmstrip.getBoundingClientRect().width
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return
      setTrimFilmstripWidth((current) =>
        Math.abs(current - nextWidth) < 0.5 ? current : nextWidth,
      )
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(filmstrip)
    return () => observer.disconnect()
  }, [layout.signature, trimMode])

  useEffect(() => {
    if (
      timelineTrimThumbnailsRef.current?.sourceKey ===
      timelineThumbnailSourceKey
    ) return
    const next = {
      sourceKey: timelineThumbnailSourceKey,
      samples: {},
    }
    timelineTrimThumbnailsRef.current = next
    setTimelineTrimThumbnails(next)
  }, [timelineThumbnailSourceKey])

  useEffect(() => {
    const bridge = window.desktopBridge
    const assetId = clip.assetId
    const sourcePath = clip.sourcePath
    if (
      !active ||
      suspended ||
      !trimMode ||
      !hasLocalTimelineThumbnailSource ||
      sourceOffline ||
      trimFilmstripWidth <= 0 ||
      !assetId ||
      !sourcePath ||
      !bridge?.ensureTimelineThumbnail
    ) {
      return
    }

    const requestRevision = trimThumbnailRequestRevisionRef.current + 1
    trimThumbnailRequestRevisionRef.current = requestRevision
    const operationIds = new Set<string>()
    let cancelled = false
    const existingSamples =
      timelineTrimThumbnailsRef.current?.sourceKey ===
      timelineThumbnailSourceKey
        ? timelineTrimThumbnailsRef.current.samples
        : {}

    timelineThumbnailRequests
      .filter((request) => !existingSamples[request.key])
      .forEach((request) => {
        const operationId = bridge.createMediaOperationId()
        operationIds.add(operationId)
        void bridge.ensureTimelineThumbnail({
          assetId,
          sourcePath,
          timeSeconds: request.timeSeconds,
          operationId,
        }).then((result) => {
          if (
            cancelled ||
            trimThumbnailRequestRevisionRef.current !== requestRevision ||
            result.assetId !== assetId
          ) return
          const thumbnail = bridge.getMediaUrl(result.thumbnailPath)
          if (!thumbnail) return
          setTimelineTrimThumbnails((current) => {
            if (current?.sourceKey !== timelineThumbnailSourceKey) return current
            const next = {
              ...current,
              samples: {
                ...current.samples,
                [request.key]: {
                  thumbnail,
                  timeSeconds: result.timeSeconds,
                },
              },
            }
            timelineTrimThumbnailsRef.current = next
            return next
          })
        }).catch(() => undefined).finally(() => {
          operationIds.delete(operationId)
        })
      })

    return () => {
      cancelled = true
      if (trimThumbnailRequestRevisionRef.current === requestRevision) {
        trimThumbnailRequestRevisionRef.current += 1
      }
      for (const operationId of operationIds) {
        void bridge.cancelMediaOperation(operationId).catch(() => undefined)
      }
    }
  }, [
    active,
    clip.assetId,
    clip.sourcePath,
    hasLocalTimelineThumbnailSource,
    playerFps,
    sourceOffline,
    suspended,
    trimFilmstripWidth,
    timelineThumbnailRequestKey,
    timelineThumbnailRequests,
    timelineThumbnailSourceKey,
    trimMode,
  ])
  const defaultAnnotation = useMemo<FrameAnnotation>(() => ({
    favorite: false,
    rating: 0,
    tags: clip.tags.slice(0, 8),
    note: clip.note,
  }), [clip.note, clip.tags])
  const activeAnnotation = frameAnnotations[settledFrame.id] ?? defaultAnnotation
  const normalizedTagDraft = tagDraft.trim()
  const tagDraftIsDuplicate = activeAnnotation.tags.includes(normalizedTagDraft)
  useLayoutEffect(() => {
    if (!normalizedTagDraft || tagDraftIsDuplicate) {
      setTagDraftFits(true)
      return
    }

    const tagList = editableTagsRef.current
    const tagProbe = tagFitProbeRef.current
    const nextDraftFits = Boolean(
      tagList &&
      tagProbe &&
      activeAnnotation.tags.length < 10 &&
      tagProbe.offsetTop - tagList.offsetTop + tagProbe.offsetHeight <= tagList.clientHeight + 1,
    )
    setTagDraftFits((current) => current === nextDraftFits ? current : nextDraftFits)
  }, [activeAnnotation.tags, layout.uiScale, normalizedTagDraft, tagDraftIsDuplicate])
  const favoriteCount = Object.values(frameAnnotations).filter((annotation) => annotation.favorite).length
  const highlightedIndex = isDragging
    ? Math.round(clampFramePosition(position, frames.length))
    : targetIndex
  const frameOrdinalDigits = String(Math.max(1, frames.length)).length
  const visibleRange = getVisibleFrameRange(position, frames.length)
  const visibleFrames = useMemo(
    () => frames.slice(visibleRange.start, visibleRange.end),
    [frames, visibleRange.end, visibleRange.start],
  )
  const reflectionPreloadDirection: -1 | 0 | 1 =
    position > settledIndex + 0.01
      ? 1
      : position < settledIndex - 0.01
        ? -1
        : targetIndex > settledIndex
          ? 1
          : targetIndex < settledIndex
            ? -1
            : 0
  const reflectionPreloadFrames = useMemo(
    () =>
      getFrameRingReflectionPreloadFrames(
        frames,
        {
          start: visibleRange.start,
          end: visibleRange.end,
        },
        reflectionPreloadDirection,
      ),
    [
      frames,
      reflectionPreloadDirection,
      visibleRange.end,
      visibleRange.start,
    ],
  )
  const ringGeometrySyncSignature = [
    clip.id,
    position.toFixed(4),
    cameraYaw.toFixed(4),
    cameraPitch.toFixed(4),
    layout.signature,
    visibleFrames.map((frame) => frame.id).join(','),
  ].join('|')
  const trimTimelineFrames = useMemo(() => {
    if (hasLocalTimelineThumbnailSource) {
      const timelineSet = timelineTrimThumbnails?.sourceKey ===
          timelineThumbnailSourceKey
        ? timelineTrimThumbnails
        : null
      return timelineThumbnailTiles.map((tile) => {
        const sample = timelineSet?.samples[tile.key]
        return {
          frame: sample
            ? {
                ...emptyPreviewFrame,
                id: `${emptyPreviewFrame.id}:trim:${tile.sampleFrame}`,
                thumbnail: sample.thumbnail,
                timeSeconds: sample.timeSeconds,
                timecode: formatFrameRingTimecode(sample.timeSeconds, playerFps),
              }
            : emptyPreviewFrame,
          key: `${timelineThumbnailSourceKey}:${timelineThumbnailTileFrames}:${tile.startFrame}`,
          leftPercent: tile.leftPercent,
          widthPercent: tile.widthPercent,
        }
      })
    }
    const previewCount = Math.min(9, frames.length)
    if (previewCount <= 1) {
      return frames.slice(0, 1).map((frame, index) => ({
        frame,
        key: `${frame.id}:trim:${index}`,
        leftPercent: 0,
        widthPercent: 100,
      }))
    }
    return Array.from({ length: previewCount }, (_, index) => {
      const timelineProgress = index / (previewCount - 1)
      const sampleFrame = Math.round(
        trimViewport.startFrame + trimViewportFrames * timelineProgress,
      )
      const frameProgress = sampleFrame / totalTrimFrames
      const frameIndex = Math.round(frameProgress * (frames.length - 1))
      const frame = frames[Math.min(frames.length - 1, Math.max(0, frameIndex))]
      return frame ? {
        frame,
        key: `${frame.id}:trim:${index}`,
        leftPercent: (index / previewCount) * 100,
        widthPercent: 100 / previewCount,
      } : null
    }).filter((item): item is NonNullable<typeof item> => Boolean(item))
  }, [
    emptyPreviewFrame,
    frames,
    hasLocalTimelineThumbnailSource,
    playerFps,
    timelineThumbnailSourceKey,
    timelineThumbnailTileFrames,
    timelineThumbnailTiles,
    timelineTrimThumbnails,
    totalTrimFrames,
    trimViewport.startFrame,
    trimViewportFrames,
  ])
  const trimRulerTicks = useMemo(() => {
    const rawStepFrames = Math.max(1, trimViewportFrames / 80)
    const magnitude = 10 ** Math.floor(Math.log10(rawStepFrames))
    const normalizedStep = rawStepFrames / magnitude
    const niceMultiplier = normalizedStep <= 1
      ? 1
      : normalizedStep <= 2
        ? 2
        : normalizedStep <= 5
          ? 5
          : 10
    const tickStepFrames = Math.max(1, Math.ceil(niceMultiplier * magnitude))
    const firstTickFrame = Math.ceil(trimViewport.startFrame / tickStepFrames) * tickStepFrames
    const ticks: Array<{ frame: number; major: boolean; progress: number }> = []

    for (
      let frame = firstTickFrame;
      frame <= trimViewport.endFrame;
      frame += tickStepFrames
    ) {
      const progress = Math.min(
        100,
        Math.max(0, ((frame - trimViewport.startFrame) / trimViewportFrames) * 100),
      )
      ticks.push({
        frame,
        major: Math.round(frame / tickStepFrames) % 5 === 0,
        progress,
      })
    }

    return ticks
  }, [trimViewport.endFrame, trimViewport.startFrame, trimViewportFrames])
  const exportResolutionOptions = Array.from(new Set([
    getExportResolutionLabel(clip.resolution),
    '1920 x 1080 (Full HD)',
  ]))
  const exportFpsOptions = Array.from(new Set([
    getExportFpsLabel(clip.fps),
    '24 fps',
    '25 fps',
    '30 fps',
  ]))

  const togglePlayerPlayback = useCallback(() => {
    if (sourceOffline) {
      setIsPlayerPlaying(false)
      setActionStatus('素材已离线，重新连接原文件后可恢复播放')
      return
    }
    if (knownCompatibilityPreviewRequired) {
      requestCompatibleVideoPreview()
      return
    }

    const frameDurationSeconds = 1 / playerFps
    const video = previewVideoRef.current
    if (hasPlayableVideo && video) {
      if (!video.paused) {
        video.pause()
        return
      }

      const nextTime =
        shouldRestartLocalPlayerPlayback({
          currentTime: video.currentTime,
          startSeconds: playbackStartSeconds,
          endSeconds: playbackEndSeconds,
          frameDurationSeconds,
          ended: video.ended,
        })
          ? playbackStartSeconds
          : video.currentTime
      video.currentTime = nextTime
      setPlayerTimeSeconds(nextTime)
      setWindowControlsVisible(false)
      void video.play().catch(() => {
        setIsPlayerPlaying(false)
        setActionStatus('无法播放当前原视频，请检查素材路径或编码格式')
      })
      return
    }

    if (shouldRestartLocalPlayerPlayback({
      currentTime: playerTimeSeconds,
      startSeconds: playbackStartSeconds,
      endSeconds: playbackEndSeconds,
      frameDurationSeconds,
      ended: false,
    })) {
      setPlayerTimeSeconds(playbackStartSeconds)
      setWindowControlsVisible(false)
      setIsPlayerPlaying(true)
      return
    }
    setWindowControlsVisible(false)
    setIsPlayerPlaying((current) => !current)
  }, [
    hasPlayableVideo,
    knownCompatibilityPreviewRequired,
    playbackEndSeconds,
    playbackStartSeconds,
    playerFps,
    playerTimeSeconds,
    requestCompatibleVideoPreview,
    sourceOffline,
  ])

  const seekPlayer = useCallback((nextTime: number, pausePlayback = true) => {
    const clampedTime = clampLocalPlayerTime(
      nextTime,
      playbackStartSeconds,
      playbackEndSeconds,
    )
    if (pausePlayback) setIsPlayerPlaying(false)
    setPlayerTimeSeconds(clampedTime)
    const video = previewVideoRef.current
    if (hasPlayableVideo && video) {
      if (pausePlayback) video.pause()
      video.currentTime = clampedTime
    }
  }, [hasPlayableVideo, playbackEndSeconds, playbackStartSeconds])

  const seekPlayerBy = useCallback((deltaSeconds: number) => {
    const videoTime = previewVideoRef.current?.currentTime
    const currentTime = typeof videoTime === 'number' && Number.isFinite(videoTime)
      ? videoTime
      : playerTimeSeconds
    seekPlayer(currentTime + deltaSeconds, false)
  }, [playerTimeSeconds, seekPlayer])

  const updatePlayerVolume = useCallback((nextVolume: number) => {
    const normalizedVolume = clampLocalPlayerVolume(nextVolume)
    setPlayerVolume(normalizedVolume)
    setPlayerMuted(normalizedVolume <= 0)
    if (normalizedVolume > 0) {
      lastAudiblePlayerVolumeRef.current = normalizedVolume
    }
    const video = previewVideoRef.current
    if (!video) return
    video.volume = normalizedVolume
    video.muted = normalizedVolume <= 0
  }, [])

  const settleTo = useCallback(
    (nextIndex: number, duration = FRAME_SETTLE_DURATION) => {
      if (settleRaf.current !== undefined) {
        window.cancelAnimationFrame(settleRaf.current)
        settleRaf.current = undefined
      }
      if (settleTimer.current !== undefined) {
        window.clearTimeout(settleTimer.current)
      }
      const clampedIndex = Math.round(clampFramePosition(nextIndex, frames.length))
      setSettleDuration(duration)
      pendingPosition.current = clampedIndex
      setTargetIndex(clampedIndex)
      setIsDragging(false)
      setIsSettling(true)
      setPosition(clampedIndex)
      setIsPlayerPlaying(false)

      settleTimer.current = window.setTimeout(() => {
        const nextTime =
          frames[clampedIndex]?.timeSeconds ?? savedTrimRange?.inSeconds ?? 0
        setSettledIndex(clampedIndex)
        setPlayerTimeSeconds(nextTime)
        requestPreviewReflectionSnapshot(nextTime)
        setIsSettling(false)
        setBoundary(null)
        settleTimer.current = undefined
      }, duration)
    },
    [frames, requestPreviewReflectionSnapshot, savedTrimRange?.inSeconds],
  )

  useEffect(() => {
    previewFallbackRequestedRef.current = false
    setVideoPlaybackFailed(false)
    return clearVideoDecodeWatchdog
  }, [clearVideoDecodeWatchdog, clip.id, clip.sourceUrl])

  useEffect(() => {
    const nextInitialIndex = getRequestedFrameIndex()
    handledEntryIntentRequestRef.current = null
    pendingPosition.current = nextInitialIndex
    setPosition(nextInitialIndex)
    setSettledIndex(nextInitialIndex)
    setTargetIndex(nextInitialIndex)
    setBoundary(null)
    setIsPlayerPlaying(false)
    setWindowControlsVisible(false)
    const requestedInitialTime =
      frames[nextInitialIndex]?.timeSeconds ??
      focusTarget?.timeSeconds ??
      savedTrimRange?.inSeconds ??
      0
    const nextInitialTime = Math.min(
      projectPlaybackEndSeconds,
      Math.max(projectPlaybackStartSeconds, requestedInitialTime),
    )
    setPlayerTimeSeconds(nextInitialTime)
    requestPreviewReflectionSnapshot(nextInitialTime)
    setTagDraft('')
    setActionStatus('')
    setTrimMode(false)
    setClipInFrame(0)
    setClipOutFrame(1)
    setTrimViewport({ startFrame: 0, endFrame: totalTrimFrames })
    setTrimHandleAdjusting(false)
    setActiveTrimHandle(null)
    trimHandleAdjustingRef.current = false
    activeTrimHandleRef.current = null
    trimPointerDragRef.current.active = false
    trimPointerDragRef.current.handle = null
    trimPointerDragRef.current.pointerId = -1
    trimRangeRef.current = { clipInFrame: 0, clipOutFrame: 1 }
    setExportFormat('Apple ProRes 422 HQ')
    setExportResolution(getExportResolutionLabel(clip.resolution))
    setExportFps(getExportFpsLabel(clip.fps))
    setAddExportToCurrentProject(false)
    setStillExportDialogOpen(false)
    setQuickExportKind('still')
    setStillExportDirectory('')
    setStillExportFilename('')
    setStillExportTarget(null)
    setStillExportDirectoryPicked(Boolean(stillExportDirectoryHandleRef.current))
    setStillExportDirectoryPickerStatus('')
    setStillExportDirectoryPicking(false)
    setExportPending(false)
    setTrimRangePending(false)
    setPendingDeleteFrameId(null)
    setBuildFrameRingPending(false)
    stillExportDirectoryPickingRef.current = false
  }, [
    clip.assetId,
    clip.durationSeconds,
    clip.fps,
    clip.fpsValue,
    clip.id,
    clip.resolution,
    clip.sourceDurationSeconds,
    clip.sourceUrl,
    frames,
    focusTarget?.requestId,
    focusTarget?.timeSeconds,
    getRequestedFrameIndex,
    projectPlaybackEndSeconds,
    projectPlaybackStartSeconds,
    requestPreviewReflectionSnapshot,
    savedTrimRange?.inSeconds,
    totalTrimFrames,
  ])

  useEffect(() => {
    smartOrganizeRunRevisionRef.current += 1
    void onCancelSmartOrganize?.()
    setSmartOrganizeDialogOpen(false)
    setSmartOrganizeStage('ready')
    setSmartOrganizeScan(null)
    setSmartOrganizeSelectedFrameIds(new Set())
    setSmartOrganizeAnnotationsEnabled(Boolean(onAnalyzeSmartFrames))
    setSmartOrganizeSuggestions([])
    setSmartOrganizeResult(null)
    setSmartOrganizeError('')
  }, [clip.assetId, clip.id, clip.sourceUrl])

  useEffect(() => {
    if (annotations) setFrameAnnotations(annotations)
  }, [annotations])

  useEffect(() => {
    if (hasFrameRing || indexTask !== 'building') {
      setBuildFrameRingPending(false)
    }
  }, [hasFrameRing, indexTask])

  useEffect(() => {
    setReflectionHost(document.querySelector<HTMLElement>('.auroraApp'))
  }, [])

  useEffect(() => {
    if (!active) return
    setHasGlassBeenActive(true)
    setHasPageBeenActive(true)
  }, [active])

  useEffect(() => {
    if (!active) {
      setStillExportDialogOpen(false)
      setSmartOrganizeDialogOpen(false)
    }
  }, [active])

  useEffect(() => {
    const hitLayer = ringHitLayerRef.current
    if (!hitLayer) return
    const geometryCacheValid =
      ringGeometryCacheSignatureRef.current ===
      ringGeometrySyncSignature
    hitLayer.dataset.geometrySourceRevision =
      ringGeometrySyncSignature
    hitLayer.dataset.geometryCacheValid = String(geometryCacheValid)
    if (!interactive || isDragging) return
    if (geometryCacheValid) {
      hitLayer.dataset.geometryReused = 'true'
      return
    }
    let frame: number | undefined
    let sampledFrames = 0
    const maxFrames = isSettling
      ? Math.ceil((settleDuration + 80) / 16)
      : 26
    ringGeometrySyncCountRef.current += 1
    hitLayer.dataset.geometryReused = 'false'
    hitLayer.dataset.geometrySyncCount = String(
      ringGeometrySyncCountRef.current,
    )

    const syncHitTargets = () => {
      const stage = ringStageRef.current
      if (!stage) return

      const stageRect = stage.getBoundingClientRect()
      const cardsById = new Map<string, HTMLElement>(
        Array.from(stage.querySelectorAll<HTMLElement>('.frameRingCard')).map((card) => [
          card.dataset.frameId ?? '',
          card,
        ] as const),
      )

      hitLayer.querySelectorAll<HTMLElement>('.frameRingHitTarget').forEach((target) => {
        const card = cardsById.get(target.dataset.frameId ?? '')
        if (!card) {
          target.style.visibility = 'hidden'
          target.style.pointerEvents = 'none'
          return
        }

        const cardRect = card.getBoundingClientRect()
        const cardStyle = getComputedStyle(card)
        const opacity = Number.parseFloat(cardStyle.opacity)
        target.style.left = `${cardRect.left - stageRect.left}px`
        target.style.top = `${cardRect.top - stageRect.top}px`
        target.style.width = `${cardRect.width}px`
        target.style.height = `${cardRect.height}px`
        target.style.zIndex = cardStyle.zIndex
        target.style.visibility = opacity > 0.05 ? 'visible' : 'hidden'
        target.style.pointerEvents = opacity > 0.05 ? 'auto' : 'none'
      })

      sampledFrames += 1
      if (sampledFrames < maxFrames) {
        frame = window.requestAnimationFrame(syncHitTargets)
      } else {
        ringGeometryCacheSignatureRef.current =
          ringGeometrySyncSignature
        hitLayer.dataset.geometryPreparedRevision =
          ringGeometrySyncSignature
        hitLayer.dataset.geometryCacheValid = 'true'
      }
    }

    syncHitTargets()
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [
    interactive,
    cameraPitch,
    cameraYaw,
    isDragging,
    isSettling,
    position,
    ringGeometrySyncSignature,
    settleDuration,
    layout.signature,
    visibleRange.end,
    visibleRange.start,
  ])

  useEffect(() => {
    if (!interactive || !isPlayerPlaying || hasPlayableVideo) return
    let animationFrame = 0
    let previousTime = performance.now()

    const advancePlayer = (timestamp: number) => {
      if (timestamp - previousTime < 32) {
        animationFrame = window.requestAnimationFrame(advancePlayer)
        return
      }
      const elapsedSeconds = Math.min(0.1, Math.max(0, (timestamp - previousTime) / 1000))
      previousTime = timestamp
      setPlayerTimeSeconds((current) => {
        const currentInRange = Math.min(
          playbackEndSeconds,
          Math.max(playbackStartSeconds, current),
        )
        const next = Math.min(playbackEndSeconds, currentInRange + elapsedSeconds)
        if (next >= playbackEndSeconds) setIsPlayerPlaying(false)
        return next
      })
      animationFrame = window.requestAnimationFrame(advancePlayer)
    }

    animationFrame = window.requestAnimationFrame(advancePlayer)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [
    interactive,
    isPlayerPlaying,
    hasPlayableVideo,
    playbackEndSeconds,
    playbackStartSeconds,
  ])

  useEffect(() => {
    const video = previewVideoRef.current
    if (!hasPlayableVideo || !video) return
    if (!isPlayerPlaying && !video.paused) video.pause()
  }, [hasPlayableVideo, isPlayerPlaying])

  useEffect(() => {
    const video = previewVideoRef.current
    if (!hasPlayableVideo || !video) return
    video.volume = playerVolume
    video.muted = playerMuted || playerVolume <= 0
  }, [clip.sourceUrl, hasPlayableVideo, playerMuted, playerVolume])

  useEffect(() => {
    if (
      !interactive ||
      onlinePlaybackMode ||
      isPlayerFullscreen ||
      !isPlayerPlaying
    ) {
      setWindowControlsVisible(false)
      return
    }

    const handleWindowPlayerPointerMove = (event: PointerEvent) => {
      const preview = previewRef.current
      if (!preview) return
      const bounds = preview.getBoundingClientRect()
      const insidePreview =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom
      const overBottomControls =
        insidePreview && event.clientY >= bounds.top + bounds.height * 0.68
      setWindowControlsVisible((current) =>
        current === overBottomControls ? current : overBottomControls,
      )
    }

    window.addEventListener('pointermove', handleWindowPlayerPointerMove, {
      passive: true,
    })
    return () => {
      window.removeEventListener('pointermove', handleWindowPlayerPointerMove)
    }
  }, [interactive, isPlayerFullscreen, isPlayerPlaying, onlinePlaybackMode])

  useEffect(() => {
    if (!trimMode) return
    setIsPlayerPlaying(false)
    setPlayerTimeSeconds((current) => {
      const nextTime = Math.min(
        playbackEndSeconds,
        Math.max(playbackStartSeconds, current),
      )
      const video = previewVideoRef.current
      if (hasPlayableVideo && video) {
        video.pause()
        video.currentTime = nextTime
      }
      return nextTime
    })
  }, [hasPlayableVideo, playbackEndSeconds, playbackStartSeconds, trimMode])

  useEffect(() => {
    const handleFullscreenChange = () => {
      clearFullscreenControlsHideTimer()
      setFullscreenControlsVisible(false)
      setIsPlayerFullscreen(document.fullscreenElement === previewRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      clearFullscreenControlsHideTimer()
    }
  }, [])

  useEffect(() => {
    setTagDraft('')
    setActionStatus('')
    setPendingDeleteFrameId(null)
    const video = previewVideoRef.current
    if (hasPlayableVideo && video) {
      video.pause()
      const nextTime = Math.min(
        playbackEndSeconds,
        Math.max(playbackStartSeconds, settledFrame.timeSeconds),
      )
      if (Number.isFinite(nextTime)) video.currentTime = nextTime
    }
  }, [
    hasPlayableVideo,
    playbackEndSeconds,
    playbackStartSeconds,
    settledFrame.id,
    settledFrame.timeSeconds,
  ])

  useEffect(() => {
    if (!interactive || onlinePlaybackMode) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (stillExportDialogOpen || smartOrganizeDialogOpen) return
      if (event.altKey || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, button, [role="slider"], [contenteditable="true"]')) return
      if (trimMode && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (hasPlayableVideo) {
          seekPlayerBy(-LOCAL_PLAYER_KEYBOARD_SEEK_SECONDS)
        } else {
          settleTo(targetIndex - 1)
        }
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (hasPlayableVideo) {
          seekPlayerBy(LOCAL_PLAYER_KEYBOARD_SEEK_SECONDS)
        } else {
          settleTo(targetIndex + 1)
        }
      }
      if (
        hasPlayableVideo &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault()
        updatePlayerVolume(
          effectivePlayerVolume +
            (event.key === 'ArrowUp'
              ? LOCAL_PLAYER_KEYBOARD_VOLUME_STEP
              : -LOCAL_PLAYER_KEYBOARD_VOLUME_STEP),
        )
      }
      if (event.key === ' ') {
        event.preventDefault()
        togglePlayerPlayback()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    hasPlayableVideo,
    effectivePlayerVolume,
    interactive,
    onlinePlaybackMode,
    seekPlayerBy,
    settleTo,
    smartOrganizeDialogOpen,
    stillExportDialogOpen,
    targetIndex,
    togglePlayerPlayback,
    trimMode,
    updatePlayerVolume,
  ])

  useEffect(() => {
    if (interactive) return
    setIsPlayerPlaying(false)
    setHoveredFrameId(null)
    dragState.current.active = false
  }, [interactive])

  useEffect(
    () => () => {
      if (settleTimer.current !== undefined) window.clearTimeout(settleTimer.current)
      if (settleRaf.current !== undefined) window.cancelAnimationFrame(settleRaf.current)
      if (dragRaf.current !== undefined) window.cancelAnimationFrame(dragRaf.current)
      if (playerWheelSeekRef.current.animationFrame !== undefined) {
        window.cancelAnimationFrame(playerWheelSeekRef.current.animationFrame)
      }
      playerWheelSeekRef.current.animationFrame = undefined
      playerWheelSeekRef.current.pendingTime = null
    },
    [],
  )

  function schedulePosition(nextPosition: number) {
    pendingPosition.current = nextPosition
    if (dragRaf.current !== undefined) return
    dragRaf.current = window.requestAnimationFrame(() => {
      dragRaf.current = undefined
      setPosition(pendingPosition.current)
    })
  }

  function scheduleWheelVisualPosition(nextPosition: number) {
    const maximum = frames.length - 1
    if (nextPosition < 0) {
      setBoundary('start')
      schedulePosition(nextPosition * 0.18)
    } else if (nextPosition > maximum) {
      setBoundary('end')
      schedulePosition(maximum + (nextPosition - maximum) * 0.18)
    } else {
      setBoundary(null)
      schedulePosition(nextPosition)
    }
  }

  function cancelWheelPreview() {
    if (wheelPreviewRaf.current === undefined) return
    window.cancelAnimationFrame(wheelPreviewRaf.current)
    wheelPreviewRaf.current = undefined
  }

  function scheduleWheelPreview() {
    if (wheelPreviewRaf.current !== undefined) return
    const animate = (now: number) => {
      const wheelState = wheelDragRef.current
      if (!wheelState.active || wheelState.axis !== 'x') {
        wheelPreviewRaf.current = undefined
        return
      }
      const idleDuration = now - wheelState.lastTime
      if (idleDuration >= WHEEL_DRAG_END_DELAY) {
        wheelPreviewRaf.current = undefined
        return
      }
      wheelState.visualPosition = resolveWheelDragPreviewPosition(
        wheelState.previewStartPosition,
        wheelState.snapTarget,
        idleDuration,
      )
      scheduleWheelVisualPosition(wheelState.visualPosition)
      wheelPreviewRaf.current = window.requestAnimationFrame(animate)
    }
    wheelPreviewRaf.current = window.requestAnimationFrame(animate)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || frames.length <= 1) return
    if (!(event.target as HTMLElement).closest('.frameRingHitTarget, .frameRingCard')) return
    if (wheelReleaseTimer.current !== undefined) {
      window.clearTimeout(wheelReleaseTimer.current)
      wheelReleaseTimer.current = undefined
    }
    wheelDragRef.current.active = false
    cancelWheelPreview()
    if (settleTimer.current !== undefined) {
      window.clearTimeout(settleTimer.current)
      settleTimer.current = undefined
    }
    setIsSettling(false)
    setIsPlayerPlaying(false)
    const now = performance.now()
    dragState.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: position,
      lastX: event.clientX,
      lastTime: now,
      velocityX: 0,
    }
  }

  function schedulePlayerWheelSeek(deltaSeconds: number) {
    const seekState = playerWheelSeekRef.current
    const videoTime = previewVideoRef.current?.currentTime
    const currentTime = seekState.pendingTime ?? (
      typeof videoTime === 'number' && Number.isFinite(videoTime)
        ? videoTime
        : playerTimeSeconds
    )
    seekState.pendingTime = clampLocalPlayerTime(
      currentTime + deltaSeconds,
      playbackStartSeconds,
      playbackEndSeconds,
    )
    if (seekState.animationFrame !== undefined) return
    seekState.animationFrame = window.requestAnimationFrame(() => {
      seekState.animationFrame = undefined
      const nextTime = seekState.pendingTime
      seekState.pendingTime = null
      if (nextTime !== null) seekPlayer(nextTime, false)
    })
  }

  function handleWheel(event: WheelEvent) {
    if (!interactive) return
    const eventTarget = event.target instanceof Element ? event.target : null
    const overLocalPlayer = Boolean(
      !onlinePlaybackMode &&
      hasPlayableVideo &&
      !trimMode &&
      eventTarget?.closest(
        '.frameRingPreview, .frameRingPreviewControlsPortalObject',
      ) &&
      !eventTarget?.closest('.frameRingPreviewControls'),
    )
    if (overLocalPlayer) {
      const seekDelta = resolveLocalPlayerTrackpadSeekDelta(
        event,
        playbackDurationSeconds,
        Math.max(1, previewRef.current?.getBoundingClientRect().width ?? layout.viewport.width),
      )
      if (seekDelta !== null) {
        event.preventDefault()
        event.stopPropagation()
        schedulePlayerWheelSeek(seekDelta)
        return
      }
    }

    if (frames.length <= 1 || dragState.current.active) return
    const wheelState = wheelDragRef.current
    const canStartFromTarget = Boolean(
      (event.target as HTMLElement).closest('.frameRingHitTarget, .frameRingCard'),
    )
    // A trackpad gesture may continue after the pointer leaves the card. Only
    // require a hit target to begin the gesture; retain it until the quiet
    // release window expires so the drag does not stop mid-motion.
    if (!wheelState.active && !canStartFromTarget) return
    const sample = readWheelDragSample(
      event,
      layout.viewport.height,
      wheelState.active ? wheelState.axis : null,
    )
    if (!sample || (!wheelState.active && !sample.moves)) return
    event.preventDefault()
    event.stopPropagation()

    const now = performance.now()
    if (!wheelState.active) {
      if (settleTimer.current !== undefined) {
        window.clearTimeout(settleTimer.current)
        settleTimer.current = undefined
      }
      if (settleRaf.current !== undefined) {
        window.cancelAnimationFrame(settleRaf.current)
        settleRaf.current = undefined
      }
      wheelState.active = true
      wheelState.axis = sample.axis
      wheelState.snapAnchor = Math.round(pendingPosition.current)
      wheelState.rawPosition = pendingPosition.current
      wheelState.visualPosition = pendingPosition.current
      wheelState.previewStartPosition = pendingPosition.current
      wheelState.snapTarget = wheelState.snapAnchor
      wheelState.lastTime = now
      wheelState.velocityX = 0
      wheelState.hasVelocity = false
      setIsDragging(true)
      setIsSettling(false)
      setIsPlayerPlaying(false)
      suppressClick.current = true
    } else if (sample.moves) {
      const elapsed = Math.max(16, now - wheelState.lastTime)
      const instantVelocityX = -sample.delta / elapsed
      wheelState.velocityX = wheelState.hasVelocity
        ? wheelState.velocityX * 0.68 + instantVelocityX * 0.32
        : instantVelocityX
      wheelState.lastTime = now
      wheelState.hasVelocity = true
    } else {
      wheelState.velocityX = 0
      wheelState.hasVelocity = false
    }

    if (sample.moves) {
      const frameDelta = sample.delta / frameDragSpacing
      wheelState.rawPosition += frameDelta
      wheelState.visualPosition += frameDelta
      wheelState.previewStartPosition = wheelState.visualPosition
      wheelState.snapTarget = resolveTrackpadSnapTarget(
        wheelState.snapAnchor,
        wheelState.rawPosition,
        0,
        frames.length - 1,
      )
      scheduleWheelVisualPosition(wheelState.visualPosition)
      if (wheelState.axis === 'x') scheduleWheelPreview()

      if (wheelReleaseTimer.current !== undefined) {
        window.clearTimeout(wheelReleaseTimer.current)
      }
      wheelReleaseTimer.current = window.setTimeout(
        finishWheelDrag,
        WHEEL_DRAG_END_DELAY,
      )
    }
  }

  function finishWheelDrag() {
    const wheelState = wheelDragRef.current
    if (!wheelState.active) return
    wheelState.active = false
    wheelReleaseTimer.current = undefined
    cancelWheelPreview()

    if (dragRaf.current !== undefined) {
      window.cancelAnimationFrame(dragRaf.current)
      dragRaf.current = undefined
      setPosition(pendingPosition.current)
    }
    const releasePosition = pendingPosition.current
    if (wheelState.axis === 'x') {
      releaseFrameDrag(releasePosition, 0, wheelState.snapTarget)
    } else {
      releaseFrameDrag(releasePosition, wheelState.velocityX)
    }
  }

  wheelHandlerRef.current = handleWheel

  useEffect(() => {
    if (!active) return
    const stage = ringStageRef.current
    if (!stage) return

    const listener = (event: WheelEvent) => wheelHandlerRef.current(event)
    const wheelState = wheelDragRef.current
    window.addEventListener('wheel', listener, { capture: true, passive: false })
    return () => {
      window.removeEventListener('wheel', listener, { capture: true })
      if (wheelReleaseTimer.current !== undefined) {
        window.clearTimeout(wheelReleaseTimer.current)
        wheelReleaseTimer.current = undefined
      }
      cancelWheelPreview()
      wheelState.active = false
    }
  }, [active])

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const state = dragState.current
    if (!state.active || state.pointerId !== event.pointerId) return
    const deltaX = event.clientX - state.startX
    const deltaY = event.clientY - state.startY
    if (!state.dragging && Math.abs(deltaX) < 5) return
    if (!state.dragging && Math.abs(deltaY) > Math.abs(deltaX) * 1.15) return

    const now = performance.now()
    const elapsed = Math.max(16, now - state.lastTime)
    const instantVelocityX = (event.clientX - state.lastX) / elapsed
    state.velocityX = state.dragging
      ? state.velocityX * 0.68 + instantVelocityX * 0.32
      : instantVelocityX
    state.lastX = event.clientX
    state.lastTime = now
    if (!state.dragging && !event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    state.dragging = true
    suppressClick.current = true
    setIsDragging(true)

    const rawPosition = state.startPosition - deltaX / frameDragSpacing
    const maximum = frames.length - 1
    if (rawPosition < 0) {
      setBoundary('start')
      schedulePosition(rawPosition * 0.18)
    } else if (rawPosition > maximum) {
      setBoundary('end')
      schedulePosition(maximum + (rawPosition - maximum) * 0.18)
    } else {
      setBoundary(null)
      schedulePosition(rawPosition)
    }
    event.preventDefault()
  }

  function finishDrag(event: ReactPointerEvent<HTMLElement>, commit: boolean) {
    const state = dragState.current
    if (!state.active || state.pointerId !== event.pointerId) return
    state.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (dragRaf.current !== undefined) {
      window.cancelAnimationFrame(dragRaf.current)
      dragRaf.current = undefined
      setPosition(pendingPosition.current)
    }

    if (!state.dragging) {
      setIsDragging(false)
      return
    }

    const releasePosition = pendingPosition.current
    const velocityAge = performance.now() - state.lastTime
    const effectiveVelocity = commit && velocityAge <= 90 ? state.velocityX : 0
    releaseFrameDrag(
      releasePosition,
      effectiveVelocity,
      commit ? undefined : state.startPosition,
    )
  }

  function releaseFrameDrag(
    releasePosition: number,
    effectiveVelocity: number,
    fallbackPosition?: number,
  ) {
    const releasedBeyondBoundary =
      releasePosition < 0 || releasePosition > frames.length - 1
    const momentumFrames = Math.max(
      -1.5,
      Math.min(1.5, (-effectiveVelocity * 80) / frameDragSpacing),
    )
    const projected = fallbackPosition ?? releasePosition + momentumFrames
    setPosition(releasePosition)
    settleRaf.current = window.requestAnimationFrame(() => {
      settleRaf.current = undefined
      settleTo(projected, releasedBeyondBoundary ? 300 : FRAME_SETTLE_DURATION)
    })
    window.setTimeout(() => {
      suppressClick.current = false
    }, 0)
  }

  function handleFrameClick(index: number) {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    settleTo(index)
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedQuery = frameQuery.replace(/\D/g, '')
    if (!normalizedQuery) return
    const match = frames.find((frame) => frame.timecode.replace(/\D/g, '').includes(normalizedQuery))
    if (match) settleTo(match.index)
  }

  function updateSettledAnnotation(patch: Partial<FrameAnnotation>) {
    const nextAnnotation = {
      ...activeAnnotation,
      ...patch,
    }
    setFrameAnnotations((current) => ({
      ...current,
      [settledFrame.id]: nextAnnotation,
    }))
    onAnnotationChange?.(settledFrame.id, nextAnnotation)
  }

  function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextTag = normalizedTagDraft
    if (!nextTag) return
    if (activeAnnotation.tags.includes(nextTag)) {
      setTagDraft('')
      return
    }

    const tagList = editableTagsRef.current
    const tagProbe = tagFitProbeRef.current
    const draftStillFits = Boolean(
      tagList &&
      tagProbe &&
      activeAnnotation.tags.length < 10 &&
      tagProbe.offsetTop - tagList.offsetTop + tagProbe.offsetHeight <= tagList.clientHeight + 1,
    )
    if (!draftStillFits) {
      setTagDraft('')
      setActionStatus(TAG_CAPACITY_STATUS)
      return
    }

    const tags = [...activeAnnotation.tags, nextTag]
    updateSettledAnnotation({ tags })
    setTagDraft('')
    setActionStatus('')
  }

  function removeTag(tag: string) {
    updateSettledAnnotation({
      tags: activeAnnotation.tags.filter((item) => item !== tag),
    })
    setActionStatus('')
  }

  function togglePlayerMute() {
    const video = previewVideoRef.current
    if (playerMuted || playerVolume <= 0) {
      const restoredVolume = playerVolume > 0
        ? playerVolume
        : lastAudiblePlayerVolumeRef.current
      setPlayerVolume(restoredVolume)
      setPlayerMuted(false)
      if (video) {
        video.volume = restoredVolume
        video.muted = false
      }
      return
    }

    lastAudiblePlayerVolumeRef.current = playerVolume
    setPlayerMuted(true)
    if (video) video.muted = true
  }

  function handleVideoTimeUpdate() {
    const video = previewVideoRef.current
    if (!video) return
    const boundaryTolerance = Math.max(0.002, 0.5 / playerFps)
    if (video.currentTime >= playbackEndSeconds - boundaryTolerance) {
      video.pause()
      const endTime = Math.min(video.duration || playbackEndSeconds, playbackEndSeconds)
      if (Number.isFinite(endTime)) video.currentTime = endTime
      setPlayerTimeSeconds(playbackEndSeconds)
      setIsPlayerPlaying(false)
      return
    }
    setPlayerTimeSeconds(Math.min(
      playbackEndSeconds,
      Math.max(playbackStartSeconds, video.currentTime),
    ))
  }

  function handleVideoLoadedMetadata() {
    const video = previewVideoRef.current
    if (!video) return
    video.volume = playerVolume
    video.muted = playerMuted || playerVolume <= 0
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setMediaDurationSample({
        sourceKey: mediaDurationSourceKey,
        durationSeconds: video.duration,
      })
    }
    const nextTime = Math.min(
      playbackEndSeconds,
      Math.max(playbackStartSeconds, playerTimeSeconds),
    )
    if (Number.isFinite(nextTime)) video.currentTime = nextTime
  }

  async function togglePlayerFullscreen() {
    try {
      if (document.fullscreenElement === previewRef.current) {
        await document.exitFullscreen()
      } else {
        await previewRef.current?.requestFullscreen()
      }
    } catch {
      setActionStatus('当前环境暂不支持全屏播放')
    }
  }

  function clearFullscreenControlsHideTimer() {
    if (fullscreenControlsHideTimerRef.current === null) return
    window.clearTimeout(fullscreenControlsHideTimerRef.current)
    fullscreenControlsHideTimerRef.current = null
  }

  function scheduleFullscreenControlsHide() {
    clearFullscreenControlsHideTimer()
    fullscreenControlsHideTimerRef.current = window.setTimeout(() => {
      fullscreenControlsHideTimerRef.current = null
      setFullscreenControlsVisible(false)
    }, 1800)
  }

  function revealFullscreenControls() {
    setFullscreenControlsVisible(true)
    scheduleFullscreenControlsHide()
  }

  function holdFullscreenControls() {
    clearFullscreenControlsHideTimer()
    setFullscreenControlsVisible(true)
  }

  function hideFullscreenControls() {
    clearFullscreenControlsHideTimer()
    setFullscreenControlsVisible(false)
  }

  function showUnavailableAction(message: string) {
    setActionStatus(message)
  }

  async function buildFrameRing() {
    if (!onBuildFrameRing || buildFrameRingPending || indexTask === 'building') {
      return
    }
    setBuildFrameRingPending(true)
    setActionStatus('正在分析画面并建立帧环…')
    try {
      const built = await onBuildFrameRing()
      if (!built) {
        setActionStatus('未能建立帧环，请检查原视频后重试')
      }
    } catch {
      setActionStatus('未能建立帧环，请检查原视频后重试')
    } finally {
      setBuildFrameRingPending(false)
    }
  }

  async function revealOriginalSource() {
    if (!clip.sourcePath || !onRevealSource) {
      showUnavailableAction('当前素材尚未关联可访问的本地原视频路径')
      return
    }
    try {
      const revealed = await onRevealSource(clip.sourcePath)
      setActionStatus(
        revealed ? '已在 Finder 中显示原视频' : '未能在 Finder 中显示原视频',
      )
    } catch {
      setActionStatus('未能在 Finder 中显示原视频')
    }
  }

  async function deleteSettledIndexFrame() {
    if (!onDeleteFrame) {
      showUnavailableAction('当前帧不能从视觉索引中移除')
      return
    }
    if (pendingDeleteFrameId !== settledFrame.id) {
      setPendingDeleteFrameId(settledFrame.id)
      setActionStatus('再次点击“确认删除”可将此帧从视觉索引中移除')
      return
    }

    try {
      const deleted = await onDeleteFrame(settledFrame.id)
      setActionStatus(
        deleted ? '当前帧已从视觉索引中移除' : '未能删除当前索引帧',
      )
    } catch {
      setActionStatus('未能删除当前索引帧')
    } finally {
      setPendingDeleteFrameId(null)
    }
  }

  function isSmartOrganizeBusy() {
    return (
      smartOrganizeStage === 'scanning' ||
      smartOrganizeStage === 'analyzing' ||
      smartOrganizeStage === 'applying'
    )
  }

  function resetSmartOrganize() {
    setSmartOrganizeStage('ready')
    setSmartOrganizeScan(null)
    setSmartOrganizeSelectedFrameIds(new Set())
    setSmartOrganizeAnnotationsEnabled(Boolean(onAnalyzeSmartFrames))
    setSmartOrganizeSuggestions([])
    setSmartOrganizeResult(null)
    setSmartOrganizeError('')
  }

  function openSmartOrganizeDialog() {
    smartOrganizeRunRevisionRef.current += 1
    resetSmartOrganize()
    setIsPlayerPlaying(false)
    setSmartOrganizeDialogOpen(true)
  }

  function closeSmartOrganizeDialog() {
    const wasBusy = isSmartOrganizeBusy()
    smartOrganizeRunRevisionRef.current += 1
    if (wasBusy) void onCancelSmartOrganize?.()
    setSmartOrganizeDialogOpen(false)
    if (wasBusy) resetSmartOrganize()
  }

  function frameHasProtectedAnnotation(frameId: string) {
    const annotation = frameAnnotations[frameId]
    if (!annotation) return false
    return Boolean(
      annotation.favorite ||
      annotation.rating > 0 ||
      annotation.tagsSource === 'manual' ||
      annotation.noteSource === 'manual' ||
      (annotation.tagsSource !== 'ai' && annotation.tags.length > 0) ||
      (annotation.noteSource !== 'ai' && annotation.note.trim()),
    )
  }

  async function scanSmartFrames() {
    if (!onScanSmartFrames) {
      setSmartOrganizeError('当前环境暂不支持帧质量检测')
      return
    }
    const runRevision = ++smartOrganizeRunRevisionRef.current
    setSmartOrganizeStage('scanning')
    setSmartOrganizeError('')
    setSmartOrganizeSuggestions([])
    setSmartOrganizeResult(null)
    try {
      const scan = await onScanSmartFrames(smartOrganizeSensitivity)
      if (runRevision !== smartOrganizeRunRevisionRef.current) return
      const candidateFrameIds = getFrameRingSmartExcludedFrameIds(scan)
      setSmartOrganizeScan(scan)
      setSmartOrganizeSelectedFrameIds(
        new Set(
          [...candidateFrameIds].filter(
            (frameId) => !frameHasProtectedAnnotation(frameId),
          ),
        ),
      )
      setSmartOrganizeStage('review')
    } catch (error) {
      if (runRevision !== smartOrganizeRunRevisionRef.current) return
      setSmartOrganizeError(
        error instanceof Error && error.message
          ? error.message
          : '帧质量检测失败，请稍后重试',
      )
      setSmartOrganizeStage('ready')
    }
  }

  function toggleSmartOrganizeFrame(frameId: string) {
    setSmartOrganizeSelectedFrameIds((current) => {
      const next = new Set(current)
      if (next.has(frameId)) next.delete(frameId)
      else next.add(frameId)
      return next
    })
  }

  function createSmartOrganizeApplyRequest(
    suggestions: FrameRingAnnotationSuggestion[],
  ): FrameRingSmartApplyRequest {
    const exclusions = new Map<
      string,
      FrameRingSmartApplyRequest['exclusions'][number]
    >()
    for (const candidate of smartOrganizeScan?.blankCandidates ?? []) {
      if (!smartOrganizeSelectedFrameIds.has(candidate.frameId)) continue
      exclusions.set(candidate.frameId, {
        frameId: candidate.frameId,
        reason: candidate.kind,
        duplicateOfFrameId: null,
      })
    }
    for (const group of smartOrganizeScan?.duplicateGroups ?? []) {
      for (const frameId of group.removeFrameIds) {
        if (
          !smartOrganizeSelectedFrameIds.has(frameId) ||
          exclusions.has(frameId)
        ) {
          continue
        }
        exclusions.set(frameId, {
          frameId,
          reason: 'duplicate',
          duplicateOfFrameId: group.keepFrameId,
        })
      }
    }
    return {
      exclusions: [...exclusions.values()],
      annotations: suggestions,
    }
  }

  async function applySmartOrganize(
    suggestions = smartOrganizeSuggestions,
  ) {
    if (!onApplySmartOrganize) {
      setSmartOrganizeError('当前环境暂不支持应用整理结果')
      return
    }
    const runRevision = ++smartOrganizeRunRevisionRef.current
    setSmartOrganizeStage('applying')
    setSmartOrganizeError('')
    try {
      const result = await onApplySmartOrganize(
        createSmartOrganizeApplyRequest(suggestions),
      )
      if (runRevision !== smartOrganizeRunRevisionRef.current) return
      setSmartOrganizeResult(result)
      setSmartOrganizeStage('complete')
      setActionStatus(
        `智能整理完成：移除 ${result.excludedCount} 帧，更新 ${result.annotatedCount} 帧标注`,
      )
    } catch (error) {
      if (runRevision !== smartOrganizeRunRevisionRef.current) return
      setSmartOrganizeError(
        error instanceof Error && error.message
          ? error.message
          : '应用整理结果失败，请稍后重试',
      )
      setSmartOrganizeStage(
        smartOrganizeSuggestions.length > 0 ? 'preview' : 'review',
      )
    }
  }

  async function continueSmartOrganize() {
    if (!smartOrganizeAnnotationsEnabled) {
      await applySmartOrganize([])
      return
    }
    if (!onAnalyzeSmartFrames) {
      setSmartOrganizeError('尚未配置可用的视觉理解模型')
      return
    }
    const retainedFrameIds = frames
      .filter((frame) => !smartOrganizeSelectedFrameIds.has(frame.id))
      .map((frame) => frame.id)
    const runRevision = ++smartOrganizeRunRevisionRef.current
    setSmartOrganizeStage('analyzing')
    setSmartOrganizeError('')
    try {
      const suggestions = await onAnalyzeSmartFrames(retainedFrameIds)
      if (runRevision !== smartOrganizeRunRevisionRef.current) return
      setSmartOrganizeSuggestions(suggestions)
      setSmartOrganizeStage('preview')
    } catch (error) {
      if (runRevision !== smartOrganizeRunRevisionRef.current) return
      setSmartOrganizeError(
        error instanceof Error && error.message
          ? error.message
          : '画面理解失败，可关闭自动标注后继续整理',
      )
      setSmartOrganizeStage('review')
    }
  }

  async function undoSmartOrganize() {
    if (!onUndoSmartOrganize) return
    try {
      const undone = await onUndoSmartOrganize()
      if (!undone) {
        setSmartOrganizeError('没有可撤销的智能整理记录')
        return
      }
      setActionStatus('已撤销本次智能整理')
      setSmartOrganizeDialogOpen(false)
    } catch {
      setSmartOrganizeError('撤销失败，请稍后重试')
    }
  }

  const openTrimWorkspace = useCallback((entryTimeSeconds?: number, endTimeSeconds?: number) => {
    if (isDragging || isSettling) return
    const requestedTimeSeconds = entryTimeSeconds ??
      (hasFrameRing
        ? settledFrame.timeSeconds
        : previewVideoRef.current?.currentTime ?? playerTimeSeconds)
    const requestedInFrame = Math.min(
      Math.max(0, totalTrimFrames - 1),
      Math.max(0, Math.round(requestedTimeSeconds * playerFps)),
    )
    const defaultDurationFrames = Math.max(
      1,
      Math.round(DEFAULT_TRIM_DURATION_SECONDS * playerFps),
    )
    const nextInFrame = requestedInFrame
    const nextOutFrame = Math.min(
      totalTrimFrames,
      endTimeSeconds === undefined
        ? nextInFrame + defaultDurationFrames
        : Math.max(nextInFrame + 1, Math.round(endTimeSeconds * playerFps)),
    )
    setClipInFrame(nextInFrame)
    setClipOutFrame(nextOutFrame)
    const nextViewport = resolveTrimViewport(
      nextInFrame,
      nextOutFrame,
      totalTrimFrames,
      playerFps,
    )
    setTrimViewport(nextViewport)
    setTrimHandleAdjusting(false)
    setActiveTrimHandle(null)
    trimHandleAdjustingRef.current = false
    activeTrimHandleRef.current = null
    trimPointerDragRef.current.active = false
    trimPointerDragRef.current.handle = null
    trimPointerDragRef.current.pointerId = -1
    trimRangeRef.current = { clipInFrame: nextInFrame, clipOutFrame: nextOutFrame }
    const nextTime = Math.min(durationSeconds, nextInFrame / playerFps)
    setPlayerTimeSeconds(nextTime)
    setIsPlayerPlaying(false)
    const video = previewVideoRef.current
    if (hasPlayableVideo && video) {
      video.pause()
      video.currentTime = nextTime
    }
    setActionStatus('')
    setTrimMode(true)
  }, [
    durationSeconds,
    hasFrameRing,
    hasPlayableVideo,
    isDragging,
    isSettling,
    playerFps,
    playerTimeSeconds,
    settledFrame.timeSeconds,
    totalTrimFrames,
  ])

  function closeTrimWorkspace() {
    setTrimMode(false)
    setIsPlayerPlaying(false)
    const requestedTimeSeconds = hasFrameRing
      ? settledFrame.timeSeconds
      : playerTimeSeconds
    const nextTime = Math.min(
      projectPlaybackEndSeconds,
      Math.max(projectPlaybackStartSeconds, requestedTimeSeconds),
    )
    setPlayerTimeSeconds(nextTime)
    const video = previewVideoRef.current
    if (hasPlayableVideo && video) {
      video.pause()
      video.currentTime = nextTime
    }
    setTrimHandleAdjusting(false)
    setActiveTrimHandle(null)
    trimHandleAdjustingRef.current = false
    activeTrimHandleRef.current = null
    trimPointerDragRef.current.active = false
    trimPointerDragRef.current.handle = null
    trimPointerDragRef.current.pointerId = -1
    setActionStatus('')
  }

  function beginTrimHandleAdjustment(handle: TrimHandle) {
    trimHandleAdjustingRef.current = true
    activeTrimHandleRef.current = handle
    setTrimHandleAdjusting(true)
    setActiveTrimHandle(handle)
  }

  function beginTrimPointerAdjustment(
    handle: TrimHandle,
    event: ReactPointerEvent<HTMLInputElement>,
  ) {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const range = trimRangeRef.current
    trimPointerDragRef.current = {
      active: true,
      handle,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startFrame: handle === 'start' ? range.clipInFrame : range.clipOutFrame,
      framesPerPixel: trimViewportFrames / Math.max(1, bounds.width),
    }
    beginTrimHandleAdjustment(handle)
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveTrimPointerAdjustment(
    handle: TrimHandle,
    event: ReactPointerEvent<HTMLInputElement>,
  ) {
    const drag = trimPointerDragRef.current
    if (
      !drag.active ||
      drag.handle !== handle ||
      drag.pointerId !== event.pointerId
    ) return

    event.preventDefault()
    const nextFrame = drag.startFrame + Math.round(
      (event.clientX - drag.startClientX) * drag.framesPerPixel,
    )
    if (handle === 'start') updateClipIn(nextFrame)
    else updateClipOut(nextFrame)
  }

  function finishTrimPointerAdjustment(
    handle: TrimHandle,
    event: ReactPointerEvent<HTMLInputElement>,
  ) {
    const drag = trimPointerDragRef.current
    if (
      !drag.active ||
      drag.handle !== handle ||
      drag.pointerId !== event.pointerId
    ) return

    drag.active = false
    drag.handle = null
    drag.pointerId = -1
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishTrimHandleAdjustment()
  }

  function finishTrimHandleAdjustment() {
    const { clipInFrame: nextInFrame, clipOutFrame: nextOutFrame } = trimRangeRef.current
    trimHandleAdjustingRef.current = false
    activeTrimHandleRef.current = null
    trimPointerDragRef.current.active = false
    trimPointerDragRef.current.handle = null
    trimPointerDragRef.current.pointerId = -1
    setTrimHandleAdjusting(false)
    setActiveTrimHandle(null)
    const nextViewport = resolveTrimViewport(
      nextInFrame,
      nextOutFrame,
      totalTrimFrames,
      playerFps,
    )
    setTrimViewport(nextViewport)
  }

  function updateClipIn(nextValue: number) {
    const currentOutFrame = trimRangeRef.current.clipOutFrame
    const nextInFrame = Math.min(
      currentOutFrame - 1,
      Math.max(0, Math.round(nextValue)),
    )
    trimRangeRef.current = { clipInFrame: nextInFrame, clipOutFrame: currentOutFrame }
    setClipInFrame(nextInFrame)
    const nextTime = Math.min(durationSeconds, nextInFrame / playerFps)
    setPlayerTimeSeconds(nextTime)
    setIsPlayerPlaying(false)
    const video = previewVideoRef.current
    if (hasPlayableVideo && video) {
      video.pause()
      video.currentTime = nextTime
    }
    setTrimViewport(resolveTrimViewport(
      nextInFrame,
      currentOutFrame,
      totalTrimFrames,
      playerFps,
    ))
  }

  function updateClipOut(nextValue: number) {
    const currentInFrame = trimRangeRef.current.clipInFrame
    const nextOutFrame = Math.max(
      currentInFrame + 1,
      Math.min(totalTrimFrames, Math.round(nextValue)),
    )
    trimRangeRef.current = { clipInFrame: currentInFrame, clipOutFrame: nextOutFrame }
    setClipOutFrame(nextOutFrame)
    const nextTime = Math.min(durationSeconds, nextOutFrame / playerFps)
    setPlayerTimeSeconds(nextTime)
    setIsPlayerPlaying(false)
    const video = previewVideoRef.current
    if (hasPlayableVideo && video) {
      video.pause()
      video.currentTime = nextTime
    }
    setTrimViewport(resolveTrimViewport(
      currentInFrame,
      nextOutFrame,
      totalTrimFrames,
      playerFps,
    ))
  }

  async function confirmClipExport() {
    const selectionTimecode = formatFrameRingTimecode(
      clipSelectionDuration,
      playerFps,
    )
    if (!onExportClip) {
      setActionStatus(`已创建 ${selectionTimecode} 的视频导出任务`)
      return
    }

    const inTimecode = formatFrameRingTimecode(clipInSeconds, playerFps)
    const outTimecode = formatFrameRingTimecode(clipOutSeconds, playerFps)
    const defaultFilename = getDefaultClipExportFilename(
      clip.filename,
      inTimecode,
      outTimecode,
      exportFormat,
    )
    setExportPending(true)
    setActionStatus(
      addExportToCurrentProject
        ? `正在导出并加入“${project.title}”…`
        : '正在导出视频片段…',
    )
    try {
      const result = await onExportClip({
        sourcePath: clip.sourcePath ?? null,
        sourceFilename: clip.filename,
        assetId: clip.assetId,
        inFrame: clipInFrame,
        outFrame: clipOutFrame,
        inSeconds: clipInSeconds,
        outSeconds: clipOutSeconds,
        format: exportFormat,
        resolution: exportResolution,
        fps: exportFps,
        defaultFilename,
        addToProjectId: addExportToCurrentProject
          ? project.id
          : undefined,
      })
      const outputName = result.outputPath?.split(/[\\/]/).pop()
      setActionStatus(
        result.message ??
          (result.ok
            ? `视频片段导出完成${outputName ? ` · ${outputName}` : ''}`
            : '视频片段导出失败，请重试'),
      )
    } catch {
      setActionStatus('视频片段导出失败，请检查原视频和保存位置')
    } finally {
      setExportPending(false)
    }
  }

  async function saveCurrentTrimRange() {
    if (!onSaveTrimRange) return
    setTrimRangePending(true)
    setActionStatus(savedTrimRange ? '正在更新裁剪范围…' : '正在保存裁剪范围…')
    try {
      const result = await onSaveTrimRange({
        inFrame: clipInFrame,
        outFrame: clipOutFrame,
        inSeconds: clipInSeconds,
        outSeconds: clipOutSeconds,
      })
      if (result.ok) {
        setTrimMode(false)
        setPlayerTimeSeconds(clipInSeconds)
        setIsPlayerPlaying(false)
        const video = previewVideoRef.current
        if (hasPlayableVideo && video) {
          video.pause()
          video.currentTime = clipInSeconds
        }
      }
      setActionStatus(
        result.message ??
          (result.ok ? '裁剪范围已保存到当前项目' : '裁剪范围保存失败'),
      )
    } catch {
      setActionStatus('裁剪范围保存失败，请稍后重试')
    } finally {
      setTrimRangePending(false)
    }
  }

  async function resetCurrentTrimRange() {
    if (!onResetTrimRange) return
    setTrimRangePending(true)
    setActionStatus('正在恢复完整素材…')
    try {
      const result = await onResetTrimRange()
      if (result.ok) {
        setTrimMode(false)
        setPlayerTimeSeconds(0)
        setIsPlayerPlaying(false)
        const video = previewVideoRef.current
        if (hasPlayableVideo && video) {
          video.pause()
          video.currentTime = 0
        }
      }
      setActionStatus(
        result.message ??
          (result.ok ? '已恢复完整素材' : '恢复完整素材失败'),
      )
    } catch {
      setActionStatus('恢复完整素材失败，请稍后重试')
    } finally {
      setTrimRangePending(false)
    }
  }

  const openStillExportDialog = useCallback((entryTimeSeconds?: number) => {
    if (isDragging || isSettling) return
    const requestedTimeSeconds = hasFrameRing
      ? settledFrame.timeSeconds
      : entryTimeSeconds ??
        previewVideoRef.current?.currentTime ??
        playerTimeSeconds
    const targetTimeSeconds = hasFrameRing
      ? requestedTimeSeconds
      : Math.min(
          Math.max(
            playbackStartSeconds,
            playbackEndSeconds - minimumPlaybackDuration,
          ),
          Math.max(playbackStartSeconds, requestedTimeSeconds),
        )
    const targetTimecode = hasFrameRing
      ? settledFrame.timecode
      : formatFrameRingTimecode(targetTimeSeconds, playerFps)
    const target: StillExportTarget = {
      frameId: settledFrame.id,
      timeSeconds: targetTimeSeconds,
      timecode: targetTimecode,
      resolution: clip.resolution,
      sourceFilename: clip.filename,
    }
    const defaultFilename = getDefaultStillExportFilename(
      target.sourceFilename,
      target.timecode,
      target.resolution,
    )
    setIsPlayerPlaying(false)
    setActionStatus('')
    const selectedDirectory = stillExportDirectoryHandleRef.current?.name
    setStillExportDirectory(
      selectedDirectory || getStillExportDirectory(project.title),
    )
    setQuickExportKind('still')
    setStillExportFilename(defaultFilename)
    setStillExportTarget(target)
    setStillExportDirectoryPicked(Boolean(selectedDirectory))
    setStillExportDirectoryPickerStatus('')
    setStillExportDialogOpen(true)
  }, [
    clip.filename,
    clip.resolution,
    hasFrameRing,
    isDragging,
    isSettling,
    minimumPlaybackDuration,
    playbackEndSeconds,
    playbackStartSeconds,
    playerFps,
    playerTimeSeconds,
    project.title,
    settledFrame.id,
    settledFrame.timeSeconds,
    settledFrame.timecode,
  ])

  function selectQuickExportKind(nextKind: QuickExportKind) {
    setQuickExportKind(nextKind)
    if (!stillExportDirectoryPicked) {
      setStillExportDirectory(
        nextKind === 'still'
          ? getStillExportDirectory(project.title)
          : getQuickClipExportDirectory(project.title),
      )
    }
    if (nextKind === 'video') {
      setStillExportFilename(quickClipDefaultFilename)
      return
    }
    if (!stillExportTarget) return
    setStillExportFilename(getDefaultStillExportFilename(
      stillExportTarget.sourceFilename,
      stillExportTarget.timecode,
      stillExportTarget.resolution,
    ))
  }

  useEffect(() => {
    if (
      !interactive ||
      !focusTarget ||
      focusTarget.intent === 'preview' ||
      handledEntryIntentRequestRef.current === focusTarget.requestId ||
      isDragging ||
      isSettling ||
      settledIndex !== getRequestedFrameIndex()
    ) {
      return
    }

    if (
      focusTarget.intent === 'export-still' &&
      !hasFrameRing &&
      !hasUnindexedLocalActions
    ) return

    handledEntryIntentRequestRef.current = focusTarget.requestId
    if (focusTarget.intent === 'trim') {
      openTrimWorkspace(hasFrameRing ? undefined : focusTarget.timeSeconds)
      return
    }
    openStillExportDialog(hasFrameRing ? undefined : focusTarget.timeSeconds)
  }, [
    focusTarget,
    getRequestedFrameIndex,
    hasFrameRing,
    hasUnindexedLocalActions,
    interactive,
    isDragging,
    isSettling,
    openStillExportDialog,
    openTrimWorkspace,
    settledIndex,
  ])

  async function chooseStillExportDirectory() {
    if (stillExportDirectoryPickingRef.current) return
    if (onChooseExportDirectory) {
      stillExportDirectoryPickingRef.current = true
      setStillExportDirectoryPicking(true)
      try {
        const directory = await onChooseExportDirectory()
        if (!directory) return
        const directoryPath = directory.path.trim()
        if (!directoryPath) {
          setStillExportDirectoryPickerStatus('未能读取所选文件夹路径，请重试。')
          return
        }
        stillExportDirectoryHandleRef.current = null
        setStillExportDirectory(directoryPath)
        setStillExportDirectoryPicked(true)
        setStillExportDirectoryPickerStatus(
          `已选择文件夹“${directory.name?.trim() || directoryPath.split(/[\\/]/).pop() || directoryPath}”`,
        )
      } catch {
        setStillExportDirectoryPickerStatus('未能打开文件夹选择器，请重试。')
      } finally {
        stillExportDirectoryPickingRef.current = false
        setStillExportDirectoryPicking(false)
        window.requestAnimationFrame(() => {
          stillExportDirectoryPickerButtonRef.current?.focus({ preventScroll: true })
        })
      }
      return
    }

    const picker = (window as StillExportPickerWindow).showDirectoryPicker
    if (!picker) {
      setStillExportDirectoryPickerStatus(
        '当前浏览器不支持直接选择文件夹；仍可创建导出任务。',
      )
      return
    }

    stillExportDirectoryPickingRef.current = true
    setStillExportDirectoryPicking(true)
    try {
      const directoryHandle = await picker.call(window, {
        id: 'aurora-still-export',
        mode: 'readwrite',
        startIn: stillExportDirectoryHandleRef.current ?? 'pictures',
      })
      stillExportDirectoryHandleRef.current = directoryHandle
      setStillExportDirectory(directoryHandle.name)
      setStillExportDirectoryPicked(true)
      setStillExportDirectoryPickerStatus(
        `已选择“${directoryHandle.name}”，本次浏览器会话已获得文件夹授权。`,
      )
    } catch (error) {
      const errorName = error instanceof DOMException
        ? error.name
        : typeof error === 'object' && error && 'name' in error
          ? String(error.name)
          : ''
      if (errorName !== 'AbortError') {
        setStillExportDirectoryPickerStatus('未能打开文件夹选择器，请重试。')
      }
    } finally {
      stillExportDirectoryPickingRef.current = false
      setStillExportDirectoryPicking(false)
      window.requestAnimationFrame(() => {
        stillExportDirectoryPickerButtonRef.current?.focus({ preventScroll: true })
      })
    }
  }

  function closeStillExportDialog(restoreFocus = true) {
    setStillExportDialogOpen(false)
    if (!restoreFocus) return
    window.requestAnimationFrame(() => {
      stillExportTriggerRef.current?.focus({ preventScroll: true })
    })
  }

  function handleStillExportDialogKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeStillExportDialog()
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.key !== 'Tab') return
    const dialog = stillExportDialogRef.current
    if (!dialog) return
    const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0)
    if (focusableElements.length === 0) {
      event.preventDefault()
      return
    }

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]
    const activeElement = document.activeElement
    if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
      event.preventDefault()
      lastElement.focus()
    } else if (!event.shiftKey && (activeElement === lastElement || !dialog.contains(activeElement))) {
      event.preventDefault()
      firstElement.focus()
    }
  }

  async function confirmStillExport() {
    if (!stillExportTarget) return
    const fallbackFilename = getDefaultStillExportFilename(
      stillExportTarget.sourceFilename,
      stillExportTarget.timecode,
      stillExportTarget.resolution,
    )
    const finalDirectory = stillExportDirectory.trim().replace(/[\\/]+$/, '') ||
      getStillExportDirectory(project.title)
    const finalFilename = normalizeStillExportFilename(
      stillExportFilename,
      fallbackFilename,
    )
    setStillExportDirectory(finalDirectory)
    setStillExportFilename(finalFilename)
    closeStillExportDialog()
    if (!onExportStill) {
      setActionStatus(`单帧导出任务已创建 · ${finalFilename}`)
      return
    }

    setExportPending(true)
    setActionStatus('正在导出当前帧…')
    try {
      const result = await onExportStill({
        sourcePath: clip.sourcePath ?? null,
        sourceFilename: stillExportTarget.sourceFilename,
        assetId: clip.assetId,
        frameId: stillExportTarget.frameId,
        timeSeconds: stillExportTarget.timeSeconds,
        timecode: stillExportTarget.timecode,
        resolution: stillExportTarget.resolution,
        directoryPath: finalDirectory,
        filename: finalFilename,
      })
      const outputName = result.outputPath?.split(/[\\/]/).pop()
      setActionStatus(
        result.message ??
          (result.ok
            ? `单帧导出完成${outputName ? ` · ${outputName}` : ''}`
            : '单帧导出失败，请重试'),
      )
    } catch {
      setActionStatus('单帧导出失败，请检查原视频和保存位置')
    } finally {
      setExportPending(false)
    }
  }

  async function confirmQuickClipExport() {
    const finalDirectory = stillExportDirectory.trim().replace(/[\\/]+$/, '') ||
      getQuickClipExportDirectory(project.title)
    const finalFilename = normalizeQuickClipExportFilename(
      stillExportFilename,
      quickClipDefaultFilename,
      quickClipExtension,
    )
    setStillExportDirectory(finalDirectory)
    setStillExportFilename(finalFilename)
    closeStillExportDialog()
    if (!onQuickExportClip) {
      setActionStatus(`快速视频导出任务已创建 · ${finalFilename}`)
      return
    }

    setExportPending(true)
    setActionStatus(
      savedTrimRange
        ? '正在快速导出已保存区间…'
        : '正在快速导出完整视频…',
    )
    try {
      const result = await onQuickExportClip({
        sourcePath: clip.sourcePath ?? null,
        sourceFilename: clip.filename,
        assetId: clip.assetId,
        inSeconds: quickClipInSeconds,
        outSeconds: quickClipOutSeconds,
        directoryPath: finalDirectory,
        filename: finalFilename,
        rangeKind: savedTrimRange ? 'project-trim' : 'full-source',
      })
      const outputName = result.outputPath?.split(/[\\/]/).pop()
      setActionStatus(
        result.message ??
          (result.ok
            ? `快速视频导出完成${outputName ? ` · ${outputName}` : ''}`
            : '快速视频导出失败，请重试'),
      )
    } catch {
      setActionStatus('快速视频导出失败，请检查原视频和保存位置')
    } finally {
      setExportPending(false)
    }
  }

  async function confirmQuickExport() {
    if (quickExportKind === 'video') {
      await confirmQuickClipExport()
      return
    }
    await confirmStillExport()
  }

  const actionPanel = hasFrameRing ? (
    <aside
      className="frameRingActionPanel frameRingFloatingObject"
      data-frame-action-visible="true"
      aria-label={`${settledFrame.timecode} 帧操作`}
    >
      <span className="frameRingActionBackdrop" aria-hidden="true" />
      <span className="frameRingActionChrome" aria-hidden="true" />
      <header>
        <strong>帧操作</strong>
      </header>

        <section className="frameRingRatingSection">
          <h2>评级</h2>
          <div className="frameRingRating" aria-label={`当前评级 ${activeAnnotation.rating} 星`}>
            {[1, 2, 3, 4, 5].map((rating) => (
              <button
                key={rating}
                className={rating <= activeAnnotation.rating ? 'active' : ''}
                type="button"
                aria-label={`${rating} 星`}
                onClick={() => updateSettledAnnotation({ rating })}
              >
                <Star size={14 * layout.uiScale} fill={rating <= activeAnnotation.rating ? 'currentColor' : 'none'} strokeWidth={1.35} />
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2><Tag size={11 * layout.uiScale} strokeWidth={1.5} /> 添加标签</h2>
          <form className="frameRingTagEditor" onSubmit={addTag}>
            <input
              value={tagDraft}
              placeholder={actionStatus === TAG_CAPACITY_STATUS
                ? TAG_CAPACITY_STATUS
                : '输入标签'}
              onChange={(event) => {
                setTagDraft(event.target.value)
                setActionStatus('')
              }}
              onFocus={() => setAnnotationEditing(true)}
              onBlur={() => setAnnotationEditing(false)}
              aria-label="添加当前帧标签"
            />
            <button
              type="submit"
              aria-label={Boolean(normalizedTagDraft) && !tagDraftFits
                ? TAG_CAPACITY_STATUS
                : '确认添加标签'}
              title={Boolean(normalizedTagDraft) && !tagDraftFits
                ? TAG_CAPACITY_STATUS
                : '添加标签'}
            >
              <Plus size={13 * layout.uiScale} strokeWidth={1.5} />
            </button>
          </form>
          <div ref={editableTagsRef} className="frameRingEditableTags">
            {activeAnnotation.tags.map((tag) => (
              <button key={tag} type="button" onClick={() => removeTag(tag)} title="点击删除标签">
                {tag}<span aria-hidden="true">×</span>
              </button>
            ))}
            {normalizedTagDraft && !tagDraftIsDuplicate && (
              <button
                ref={tagFitProbeRef}
                className="frameRingTagFitProbe"
                type="button"
                tabIndex={-1}
                aria-hidden="true"
              >
                {normalizedTagDraft}<span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        </section>

        <section className="frameRingNoteEditor">
          <h2><MessageSquareText size={11 * layout.uiScale} strokeWidth={1.5} /> 备注</h2>
          <textarea
            value={activeAnnotation.note}
            placeholder="添加这一帧的备注"
            maxLength={FRAME_NOTE_MAX_LENGTH}
            onChange={(event) => updateSettledAnnotation({
              note: event.currentTarget.value.slice(0, FRAME_NOTE_MAX_LENGTH),
            })}
            onFocus={() => setAnnotationEditing(true)}
            onBlur={() => setAnnotationEditing(false)}
            aria-label="当前帧备注"
          />
          <span className="frameRingNoteCounter" aria-hidden="true">
            {activeAnnotation.note.length}/{FRAME_NOTE_MAX_LENGTH}
          </span>
        </section>

        <div className="frameRingDirectActions" aria-label="帧文件操作">
          <button
            type="button"
            onClick={() => void revealOriginalSource()}
          >
            <FolderOpen size={12 * layout.uiScale} strokeWidth={1.45} />
            <span>打开原视频位置</span>
          </button>
          <button
            className="danger"
            type="button"
            onClick={() => void deleteSettledIndexFrame()}
          >
            <Trash2 size={12 * layout.uiScale} strokeWidth={1.45} />
            <span>
              {pendingDeleteFrameId === settledFrame.id
                ? '确认删除'
                : '删除帧'}
            </span>
          </button>
        </div>
      {actionStatus && actionStatus !== TAG_CAPACITY_STATUS && !trimMode && (
        <p className="frameRingActionStatus" aria-live="polite">{actionStatus}</p>
      )}
    </aside>
  ) : null

  const infoPanel = trimMode ? (
    <aside
      className="frameRingInfoPanel frameRingExportPanel frameRingFloatingObject"
      data-frame-info-visible="true"
      data-export-kind="video"
      aria-label="片段设置与导出"
    >
      <span className="frameRingInfoBackdrop" aria-hidden="true" />
      <span className="frameRingInfoChrome" aria-hidden="true" />
      <header>
        <strong>片段设置</strong>
        <Box size={15 * layout.uiScale} strokeWidth={1.35} aria-hidden="true" />
      </header>
      <form
        className="frameRingExportForm"
        onSubmit={(event) => {
          event.preventDefault()
          void confirmClipExport()
        }}
      >
        <label>
          <span>格式</span>
          <span className="frameRingExportSelect">
            <select
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value)}
              aria-label="导出格式"
            >
              <option>Apple ProRes 422 HQ</option>
              <option>Apple ProRes 4444</option>
              <option>H.264 高质量</option>
            </select>
            <ChevronDown size={11 * layout.uiScale} strokeWidth={1.5} aria-hidden="true" />
          </span>
        </label>
        <label>
          <span>分辨率</span>
          <span className="frameRingExportSelect">
            <select
              value={exportResolution}
              onChange={(event) => setExportResolution(event.target.value)}
              aria-label="导出分辨率"
            >
              {exportResolutionOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown size={11 * layout.uiScale} strokeWidth={1.5} aria-hidden="true" />
          </span>
        </label>
        <label>
          <span>帧率</span>
          <span className="frameRingExportSelect">
            <select
              value={exportFps}
              onChange={(event) => setExportFps(event.target.value)}
              aria-label="导出帧率"
            >
              {exportFpsOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown size={11 * layout.uiScale} strokeWidth={1.5} aria-hidden="true" />
          </span>
        </label>
        <div className="frameRingExportEstimate">
          <span>预计时长 <strong>{formatFrameRingTimecode(clipSelectionDuration, playerFps)}</strong></span>
          <label className="frameRingExportProjectOption">
            <span className="frameRingExportProjectCopy">
              <small>导出后加入项目</small>
              <strong title={project.title}>{project.title}</strong>
            </span>
            <input
              type="checkbox"
              checked={addExportToCurrentProject}
              disabled={exportPending}
              aria-label={`导出后加入项目 ${project.title}`}
              onChange={(event) =>
                setAddExportToCurrentProject(event.currentTarget.checked)
              }
            />
            <span className="frameRingExportProjectSwitch" aria-hidden="true" />
          </label>
        </div>
        <div
          className="frameRingExportActions"
          data-has-save-action={Boolean(onSaveTrimRange)}
        >
          {onSaveTrimRange && (
            <button
              className="frameRingExportButton"
              type="button"
              disabled={trimRangePending || exportPending}
              aria-busy={trimRangePending}
              onClick={() => void saveCurrentTrimRange()}
            >
              <Check size={13 * layout.uiScale} strokeWidth={1.5} />
              <span>{trimRangePending ? '保存中…' : '保存区间'}</span>
            </button>
          )}
          <button
            className="frameRingExportButton"
            type="submit"
            disabled={exportPending || trimRangePending}
            aria-busy={exportPending}
          >
            <Upload size={14 * layout.uiScale} strokeWidth={1.45} />
            <span>
              {exportPending
                ? addExportToCurrentProject
                  ? '正在导出并加入…'
                  : '导出中…'
                : addExportToCurrentProject
                  ? onSaveTrimRange
                    ? '导出并加入'
                    : '导出并加入项目'
                  : onSaveTrimRange
                    ? '导出文件'
                    : '导出'}
            </span>
          </button>
        </div>
        {savedTrimRange && onResetTrimRange && (
          <button
            className="frameRingTrimResetButton"
            type="button"
            disabled={trimRangePending || exportPending}
            onClick={() => void resetCurrentTrimRange()}
          >
            <Undo2 size={11 * layout.uiScale} strokeWidth={1.5} />
            <span>恢复完整素材</span>
          </button>
        )}
        {actionStatus && (
          <p className="frameRingExportStatus" aria-live="polite">{actionStatus}</p>
        )}
      </form>
    </aside>
  ) : !hasFrameRing ? null : (
    <aside
      className="frameRingInfoPanel frameRingFloatingObject"
      data-frame-info-visible="true"
      aria-label={`${settledFrame.timecode} 帧信息`}
    >
      <span className="frameRingInfoBackdrop" aria-hidden="true" />
      <span className="frameRingInfoChrome" aria-hidden="true" />
        <header>
          <strong>帧&nbsp;&nbsp;{settledFrame.timecode}</strong>
          <span
            className={`frameRingFavoriteStatus ${activeAnnotation.favorite ? 'active' : ''}`}
            aria-label={activeAnnotation.favorite ? '当前帧已收藏' : '当前帧未收藏'}
          >
            <Star
              size={11 * layout.uiScale}
              fill={activeAnnotation.favorite ? 'currentColor' : 'none'}
              strokeWidth={1.5}
            />
            <span>{activeAnnotation.favorite ? '已收藏' : '未收藏'}</span>
          </span>
        </header>
        <dl>
          {[
            ['分辨率', clip.resolution],
            ['编码格式', clip.codec],
            ['时长', clip.duration],
            ['源文件', clip.filename],
            ['拍摄日期', clip.capturedAt],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <section>
          <h2>标签</h2>
          <div className="frameRingTagList">
            {activeAnnotation.tags.slice(0, 8).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </section>
      <section className="frameRingNotes">
        <h2>备注</h2>
        <p>{activeAnnotation.note || '暂无备注'}</p>
      </section>
    </aside>
  )

  const renderPreviewControls = (
    surface: 'portal' | 'fullscreen' | 'reflection',
  ) => {
    const reflectionProxy = surface === 'reflection'
    const controlsDisabled = reflectionProxy || sourceOffline
    return (
      <div
        className={`frameRingPreviewControls frameRingPreviewControls${surface[0].toUpperCase()}${surface.slice(1)}`}
        data-frame-preview-controls-surface={surface}
        data-frame-preview-controls-reflection-proxy={reflectionProxy || undefined}
        data-camera-gesture={reflectionProxy ? undefined : 'block'}
        aria-label={reflectionProxy ? undefined : '视频播放控制'}
        aria-hidden={reflectionProxy || undefined}
        inert={reflectionProxy || undefined}
        onPointerDown={reflectionProxy ? undefined : (event) => event.stopPropagation()}
      >
        <button
          className="frameRingPreviewPlayButton"
          type="button"
          disabled={controlsDisabled}
          tabIndex={controlsDisabled ? -1 : undefined}
          onClick={controlsDisabled ? undefined : togglePlayerPlayback}
          aria-label={
            reflectionProxy
              ? undefined
              : isPlayerPlaying
                ? '暂停视频'
                : '播放视频'
          }
        >
          {isPlayerPlaying ? (
            <Pause size={15 * layout.uiScale} fill="currentColor" strokeWidth={1.25} />
          ) : (
            <Play size={15 * layout.uiScale} fill="currentColor" strokeWidth={1.25} />
          )}
        </button>
        <time>{playerTimecode}</time>
        <div className="frameRingPreviewVolume">
          <button
            className="frameRingPreviewMuteButton"
            type="button"
            disabled={controlsDisabled || !hasPlayableVideo}
            tabIndex={controlsDisabled ? -1 : undefined}
            onClick={controlsDisabled ? undefined : togglePlayerMute}
            aria-label={
              reflectionProxy
                ? undefined
                : effectivePlayerVolume <= 0
                  ? '取消静音'
                  : '静音'
            }
          >
            {effectivePlayerVolume <= 0 ? (
              <VolumeX size={14 * layout.uiScale} strokeWidth={1.45} />
            ) : (
              <Volume2 size={14 * layout.uiScale} strokeWidth={1.45} />
            )}
          </button>
          <input
            className="frameRingPreviewVolumeRange"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(effectivePlayerVolume * 100)}
            disabled={controlsDisabled || !hasPlayableVideo}
            tabIndex={controlsDisabled ? -1 : undefined}
            onChange={
              controlsDisabled
                ? undefined
                : (event) => updatePlayerVolume(Number(event.target.value) / 100)
            }
            aria-label={reflectionProxy ? undefined : '视频音量'}
          />
        </div>
        <div
          className="frameRingPreviewProgress"
          style={{ '--frame-ring-player-progress': `${playerProgress}%` } as CSSProperties}
        >
          <span className="frameRingPreviewProgressTrack" aria-hidden="true" />
          <span className="frameRingPreviewProgressFill" aria-hidden="true" />
          <span className="frameRingPreviewProgressThumb" aria-hidden="true" />
          <input
            className="frameRingPreviewRange"
            type="range"
            min={playbackStartSeconds}
            max={playbackEndSeconds}
            step={1 / playerFps}
            value={playerTimeSeconds}
            disabled={controlsDisabled}
            tabIndex={controlsDisabled ? -1 : undefined}
            onChange={
              controlsDisabled
                ? undefined
                : (event) => seekPlayer(Number(event.target.value))
            }
            aria-label={reflectionProxy ? undefined : '视频播放进度'}
          />
        </div>
        <button
          className="frameRingPreviewFullscreenButton"
          type="button"
          disabled={controlsDisabled}
          tabIndex={controlsDisabled ? -1 : undefined}
          onClick={
            controlsDisabled
              ? undefined
              : () => void togglePlayerFullscreen()
          }
          aria-label={
            reflectionProxy
              ? undefined
              : isPlayerFullscreen
                ? '退出全屏'
                : '全屏播放'
          }
        >
          <Maximize2 size={14 * layout.uiScale} strokeWidth={1.45} />
        </button>
      </div>
    )
  }

  const onlineReflectionCaptureSource = onlinePlaybackKey
    ? resolveFrameRingOnlineReflectionSource(
        onlineReflectionCapture,
        onlinePlaybackKey,
      )
    : null
  const onlineReflectionPosterSource = onlinePlaybackKey
    ? createFrameRingOnlineReflectionPosterSource(
        onlinePlaybackKey,
        playerFrame.thumbnail || clip.thumbnail,
      )
    : null
  const onlineReflectionSource =
    onlineReflectionCaptureSource ?? onlineReflectionPosterSource
  const onlineReflectionSourceId = onlineReflectionSource
    ? getFrameRingOnlineReflectionSourceId(onlineReflectionSource)
    : ''
  const onlineReflectionReady = Boolean(
    onlineReflectionSource &&
      onlineReflectionReadySourceId === onlineReflectionSourceId,
  )
  const smartOrganizeFrameById = new Map(
    frames.map((frame) => [frame.id, frame]),
  )
  const smartOrganizeCandidateMap = new Map<
    string,
    {
      frameId: string
      kind: 'black' | 'white' | 'duplicate'
      confidence: number
      reason: string
      duplicateOfFrameId: string | null
    }
  >()
  for (const candidate of smartOrganizeScan?.blankCandidates ?? []) {
    smartOrganizeCandidateMap.set(candidate.frameId, {
      frameId: candidate.frameId,
      kind: candidate.kind,
      confidence: candidate.confidence,
      reason: candidate.reason,
      duplicateOfFrameId: null,
    })
  }
  for (const group of smartOrganizeScan?.duplicateGroups ?? []) {
    for (const frameId of group.removeFrameIds) {
      if (smartOrganizeCandidateMap.has(frameId)) continue
      smartOrganizeCandidateMap.set(frameId, {
        frameId,
        kind: 'duplicate',
        confidence: group.confidence,
        reason: group.reason,
        duplicateOfFrameId: group.keepFrameId,
      })
    }
  }
  const smartOrganizeCandidates = [...smartOrganizeCandidateMap.values()]
    .sort((left, right) => (
      (smartOrganizeFrameById.get(left.frameId)?.index ?? 0) -
      (smartOrganizeFrameById.get(right.frameId)?.index ?? 0)
    ))
  const reflectionCanvas = reflectionHost &&
    (!onlinePlaybackMode || onlineReflectionSource)
    ? createPortal(
      <FrameRingReflectionCanvas
        active={active}
        sourceDomAvailable={
          (active || hasPageBeenActive) &&
          (!onlinePlaybackMode || onlineReflectionReady)
        }
        suspended={suspended}
        materialTint={materialTint}
        surfaceData={reflectionSurface}
        stageRef={viewRef}
        previewVideoRef={previewVideoRef}
        previewFullscreen={isPlayerFullscreen}
        previewPlaying={isPlayerPlaying}
        previewSnapshotRevision={previewReflectionSnapshotRequest.revision}
        previewSnapshotTime={previewReflectionSnapshotRequest.expectedMediaTime}
        previewSnapshotTolerance={Math.max(0.02, 1 / playerFps)}
        previewDomRevision={
          onlinePlaybackMode ? onlineReflectionSource?.revision ?? 0 : 0
        }
        snapshotBlocked={isDragging || isSettling || trimHandleAdjusting}
        frames={visibleFrames}
        preloadFrames={reflectionPreloadFrames}
        activeFrame={settledFrame}
        clip={clip}
        infoPanelVisible={infoPanelVisible}
        infoRevision={JSON.stringify({
          annotation: activeAnnotation,
          trimMode,
          clipInFrame,
          clipOutFrame,
          exportFormat,
          exportResolution,
          exportFps,
          addExportToCurrentProject,
          exportProject: {
            id: project.id,
            title: project.title,
          },
          actionStatus,
        })}
        materialTintFilter={materialTintFilter}
        pageColorGradeFilter={pageColorGradeFilter}
        interactionActive={isDragging || annotationEditing || trimHandleAdjusting}
        cameraYaw={cameraYaw}
        cameraPitch={cameraPitch}
        motionSignal={`${position.toFixed(4)}|${settledIndex}|${hoveredFrameId ?? ''}|${isDragging}|${isSettling}|${boundary ?? ''}|${trimMode}|${clipInFrame}|${clipOutFrame}|${cameraYaw}|${cameraPitch}|${layout.signature}`}
      />,
      reflectionHost,
    )
    : null

  const projectedGlassLayer = !onlinePlaybackMode && reflectionHost && (active || hasGlassBeenActive)
    ? createPortal(
      <div
        className="frameRingProjectedGlassLayer"
        data-glass-active={active}
        data-frame-ring-ready={hasFrameRing}
        style={frameRingCssVariables}
        aria-hidden="true"
      >
        <div className="frameRingFloatingStage">
          <div className="frameRingFloatingCameraRig">
            <span
              className="frameRingPreviewControlsProjectedGlass frameRingFloatingObject"
              data-controls-visible={
                windowPlaybackControlsVisible && !isPlayerFullscreen
              }
            />
            <span
              className="frameRingProjectedGlass frameRingFloatingObject"
              data-projected-glass-visible={infoPanelVisible}
            />
            <span
              className="frameRingActionProjectedGlass frameRingFloatingObject"
              data-projected-glass-visible={hasFrameRing}
            />
          </div>
        </div>
      </div>,
      reflectionHost,
    )
    : null

  const infoPanelPortal = !onlinePlaybackMode && reflectionHost && (active || hasPageBeenActive)
    ? createPortal(
      <div
        className="frameRingInfoPortalLayer"
        data-page-active={active}
        aria-hidden={
          !active ||
          !interactive ||
          stillExportDialogOpen ||
          smartOrganizeDialogOpen ||
          undefined
        }
        inert={
          !active ||
          !interactive ||
          stillExportDialogOpen ||
          smartOrganizeDialogOpen
        }
        style={frameRingCssVariables}
      >
        <div className="frameRingFloatingStage" aria-label="悬浮帧信息">
          <div className="frameRingFloatingCameraRig">
            {!isPlayerFullscreen && (
              <div
                className="frameRingPreviewControlsPortalObject frameRingFloatingObject"
                data-controls-visible={windowPlaybackControlsVisible}
                aria-hidden={!windowPlaybackControlsVisible || undefined}
                inert={!windowPlaybackControlsVisible}
              >
                {renderPreviewControls('portal')}
              </div>
            )}
            {actionPanel}
            {infoPanel}
          </div>
        </div>
      </div>,
      reflectionHost,
    )
    : null

  const bottomActionsPortal = reflectionHost
    ? createPortal(
      <div
        className={`frameRingBottomActions uiGlassShell ${onlinePlaybackMode ? 'isOnlinePlaybackActions' : hasUnindexedLocalActions ? 'isUnindexedLocalActions' : ''}`}
        role="toolbar"
        aria-label={onlinePlaybackMode ? '在线视频操作栏' : hasFrameRing ? '帧操作栏' : '视频操作栏'}
        aria-hidden={
          !interactive ||
          (!onlinePlaybackMode && (
            !hasLocalBottomActions ||
            trimMode ||
            stillExportDialogOpen ||
            smartOrganizeDialogOpen
          )) ||
          undefined
        }
        inert={
          !interactive ||
          (!onlinePlaybackMode && (
            !hasLocalBottomActions ||
            trimMode ||
            stillExportDialogOpen ||
            smartOrganizeDialogOpen
          ))
        }
        data-page-active={
          active && (
            onlinePlaybackMode ||
            (hasLocalBottomActions && !trimMode && !smartOrganizeDialogOpen)
          )
        }
        data-camera-gesture="block"
        onPointerDown={(event) => event.stopPropagation()}
        style={frameRingCssVariables}
      >
        {onlinePlaybackMode ? (
          <>
            <button
              className={onlineFavorite ? 'active' : ''}
              type="button"
              aria-label={onlineFavorite ? '取消 Aurora 收藏' : '收藏到 Aurora'}
              aria-pressed={onlineFavorite}
              disabled={!onToggleOnlineFavorite}
              onClick={onToggleOnlineFavorite}
            >
              <Star
                size={20 * layout.uiScale}
                fill={onlineFavorite ? 'currentColor' : 'none'}
                strokeWidth={1.45}
              />
              <span>{onlineFavorite ? '取消 Aurora 收藏' : 'Aurora 收藏'}</span>
            </button>
            <button
              type="button"
              aria-label="将在线视频加入项目"
              disabled={!onAddOnlineToProject}
              onClick={onAddOnlineToProject}
            >
              <FolderOpen size={20 * layout.uiScale} strokeWidth={1.45} />
              <span>加入项目</span>
            </button>
          </>
        ) : (
          <>
            {hasFrameRing && (
              <button
                className={activeAnnotation.favorite ? 'active' : ''}
                type="button"
                aria-label={activeAnnotation.favorite ? '取消收藏当前帧' : '收藏当前帧'}
                aria-pressed={activeAnnotation.favorite}
                onClick={() => updateSettledAnnotation({ favorite: !activeAnnotation.favorite })}
              >
                <Star
                  size={20 * layout.uiScale}
                  fill={activeAnnotation.favorite ? 'currentColor' : 'none'}
                  strokeWidth={1.45}
                />
                <span>收藏帧</span>
                <span className="frameRingFavoriteCount" aria-label={`共收藏 ${favoriteCount} 帧`}>
                  {favoriteCount}
                </span>
              </button>
            )}
            <button
              type="button"
              data-export-kind="video"
              aria-label="剪辑片段"
              disabled={isDragging || isSettling}
              onClick={() => openTrimWorkspace()}
            >
              <Scissors size={20 * layout.uiScale} strokeWidth={1.45} />
              <span>剪辑片段</span>
            </button>
            <button
              ref={stillExportTriggerRef}
              type="button"
              data-export-kind="quick"
              data-export-resolution={clip.resolution}
              data-export-timecode={hasFrameRing ? settledFrame.timecode : playerTimecode}
              aria-label="导出单帧或视频"
              disabled={isDragging || isSettling}
              onClick={() => openStillExportDialog()}
            >
              <Upload size={20 * layout.uiScale} strokeWidth={1.45} />
              <span>导出</span>
            </button>
            {hasFrameRing && (
              <button
                type="button"
                aria-label="智能整理帧环"
                disabled={
                  isDragging ||
                  isSettling ||
                  !onScanSmartFrames ||
                  !onApplySmartOrganize
                }
                onClick={openSmartOrganizeDialog}
              >
                <Sparkles size={20 * layout.uiScale} strokeWidth={1.45} />
                <span>智能整理</span>
              </button>
            )}
          </>
        )}
      </div>,
      reflectionHost,
    )
    : null

  const stillExportDialogPortal = !onlinePlaybackMode && reflectionHost && active && stillExportDialogOpen && stillExportTarget
    ? createPortal(
      <div
        className="overlay frameRingStillExportOverlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="frame-ring-export-title"
        data-camera-gesture="block"
        onPointerDown={(event) => {
          event.stopPropagation()
          if (event.target === event.currentTarget) closeStillExportDialog()
        }}
      >
        <form
          ref={stillExportDialogRef}
          className="createPanel frameRingStillExportPanel uiGlassShell"
          autoComplete="off"
          data-export-kind={quickExportKind}
          data-export-frame-id={
            quickExportKind === 'still' ? stillExportTarget.frameId : undefined
          }
          data-export-timecode={
            quickExportKind === 'still'
              ? stillExportTarget.timecode
              : `${quickClipInTimecode}-${quickClipOutTimecode}`
          }
          data-export-resolution={stillExportTarget.resolution}
          onKeyDown={handleStillExportDialogKeyDown}
          onSubmit={(event) => {
            event.preventDefault()
            void confirmQuickExport()
          }}
        >
          <button
            className="panelClose uiGlassInteractive"
            type="button"
            aria-label="关闭导出"
            onClick={() => closeStillExportDialog()}
          >
            <X size={17} />
          </button>

          <header className="createPanelHeader frameRingStillExportHeader">
            <span className="sheetEyebrow">Export</span>
            <h2 id="frame-ring-export-title">
              {quickExportKind === 'still' ? '导出当前帧' : '快速导出视频'}
            </h2>
            {quickExportKind === 'still' ? (
              <p>
                时间码 {stillExportTarget.timecode} · {stillExportTarget.resolution}（原始）· PNG
              </p>
            ) : (
              <p>
                {savedTrimRange ? '已保存区间' : '完整素材'} · {quickClipDurationTimecode} · {clip.resolution}
              </p>
            )}
          </header>

          <div className="frameRingQuickExportKinds" role="group" aria-label="导出内容">
            <button
              className={quickExportKind === 'still' ? 'active' : ''}
              type="button"
              aria-pressed={quickExportKind === 'still'}
              onClick={() => selectQuickExportKind('still')}
            >
              单帧图片
            </button>
            {onQuickExportClip && (
              <button
                className={quickExportKind === 'video' ? 'active' : ''}
                type="button"
                aria-pressed={quickExportKind === 'video'}
                onClick={() => selectQuickExportKind('video')}
              >
                快速视频
              </button>
            )}
            {onExportClip && (
              <button
                type="button"
                onClick={() => {
                  closeStillExportDialog(false)
                  openTrimWorkspace(quickClipInSeconds, quickClipOutSeconds)
                  window.requestAnimationFrame(() => {
                    reflectionHost.querySelector<HTMLSelectElement>(
                      '.frameRingExportPanel select',
                    )?.focus({ preventScroll: true })
                  })
                }}
              >
                详细视频导出
              </button>
            )}
          </div>

          <div className="projectNameField frameRingStillExportField">
            <span>保存位置</span>
            <button
              ref={stillExportDirectoryPickerButtonRef}
              className="createProjectInput frameRingStillExportLocationButton uiGlassInset uiGlassInteractive"
              type="button"
              data-directory-source={stillExportDirectoryPicked ? 'picker' : 'project-default'}
              aria-busy={stillExportDirectoryPicking}
              aria-disabled={stillExportDirectoryPicking}
              aria-label={`选择导出保存文件夹，当前为 ${stillExportDirectory}`}
              onClick={() => void chooseStillExportDirectory()}
            >
              <FolderOpen size={15} strokeWidth={1.5} aria-hidden="true" />
              <span className="frameRingStillExportLocationPath">{stillExportDirectory}</span>
              <span className="frameRingStillExportLocationAction">
                {stillExportDirectoryPicking ? '选择中…' : '选择…'}
              </span>
            </button>
            <small className="frameRingStillExportLocationStatus" aria-live="polite">
              {stillExportDirectoryPickerStatus || (
                stillExportDirectoryPicked
                  ? `已选择文件夹“${stillExportDirectory}”`
                  : '点击上方路径选择 Mac 文件夹'
              )}
            </small>
          </div>

          <label className="projectNameField frameRingStillExportField">
            <span>文件名</span>
            <span className="createProjectInput frameRingStillExportInput uiGlassInset">
              <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
              <input
                autoFocus
                name="exportFilename"
                value={stillExportFilename}
                onChange={(event) => setStillExportFilename(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                maxLength={180}
                required
                aria-label={quickExportKind === 'still' ? '单帧文件名' : '视频文件名'}
                spellCheck={false}
              />
            </span>
          </label>

          <div className="createPanelMeta frameRingStillExportMeta">
            {quickExportKind === 'still' ? (
              <>
                <span><FileText size={14} strokeWidth={1.45} />PNG 无损单帧</span>
                <span>{stillExportTarget.resolution} · TC {stillExportTarget.timecode}</span>
              </>
            ) : (
              <>
                <span><FileText size={14} strokeWidth={1.45} />保持源格式快速导出</span>
                <span>
                  {quickClipExtension.toUpperCase()} · {clip.codec} · TC {quickClipInTimecode}–{quickClipOutTimecode}
                </span>
              </>
            )}
          </div>

          <footer className="createPanelActions">
            <button
              className="secondaryAction uiGlassInset uiGlassInteractive"
              type="button"
              onClick={() => closeStillExportDialog()}
            >
              取消
            </button>
            <button
              className="primaryAction uiGlassInset uiGlassInteractive active"
              type="submit"
              disabled={exportPending}
              aria-busy={exportPending}
            >
              <Upload size={15} strokeWidth={1.65} />
              {quickExportKind === 'still' ? '导出单帧' : '快速导出视频'}
            </button>
          </footer>
        </form>
      </div>,
      reflectionHost,
    )
    : null

  const smartOrganizeDialogPortal = !onlinePlaybackMode &&
    reflectionHost &&
    active &&
    smartOrganizeDialogOpen
    ? createPortal(
      <div
        className="overlay frameRingSmartOrganizeOverlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="frame-ring-smart-organize-title"
        data-camera-gesture="block"
        style={frameRingCssVariables}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (event.target === event.currentTarget) closeSmartOrganizeDialog()
        }}
      >
        <section
          className="createPanel frameRingSmartOrganizePanel uiGlassShell"
          data-stage={smartOrganizeStage}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            closeSmartOrganizeDialog()
          }}
        >
          <button
            className="panelClose uiGlassInteractive"
            type="button"
            aria-label="关闭智能整理"
            onClick={closeSmartOrganizeDialog}
          >
            <X size={17} />
          </button>

          <header className="createPanelHeader frameRingSmartOrganizeHeader">
            <span className="sheetEyebrow">Smart Organize</span>
            <h2 id="frame-ring-smart-organize-title">智能整理帧环</h2>
            <p>
              本地识别无意义与重复画面，再用已连接的视觉模型补全标签和备注。
            </p>
          </header>

          {smartOrganizeStage === 'ready' && (
            <>
              <section className="frameRingSmartOrganizeSection">
                <div className="frameRingSmartOrganizeSectionTitle">
                  <strong>检测灵敏度</strong>
                  <span>默认采用保守策略，优先避免误删</span>
                </div>
                <div
                  className="frameRingSmartSensitivity uiGlassInset"
                  role="radiogroup"
                  aria-label="智能整理灵敏度"
                >
                  {([
                    ['conservative', '保守'],
                    ['balanced', '标准'],
                    ['aggressive', '积极'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className={smartOrganizeSensitivity === value ? 'active' : ''}
                      type="button"
                      role="radio"
                      aria-checked={smartOrganizeSensitivity === value}
                      onClick={() => setSmartOrganizeSensitivity(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="frameRingSmartFeatureList">
                <div className="uiGlassInset">
                  <span className="frameRingSmartFeatureIcon">
                    <Check size={16} strokeWidth={1.55} />
                  </span>
                  <span>
                    <strong>黑白帧与重复帧</strong>
                    <small>在本机快速检测，不调用视觉模型</small>
                  </span>
                  <span className="frameRingSmartFeatureState">已启用</span>
                </div>
                <label className="uiGlassInset">
                  <span className="frameRingSmartFeatureIcon">
                    <Sparkles size={16} strokeWidth={1.55} />
                  </span>
                  <span>
                    <strong>自动标签与备注</strong>
                    <small>
                      {onAnalyzeSmartFrames
                        ? '复用当前已连接的本地视觉模型'
                        : '尚未连接可用的视觉模型'}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={smartOrganizeAnnotationsEnabled}
                    disabled={!onAnalyzeSmartFrames}
                    onChange={(event) =>
                      setSmartOrganizeAnnotationsEnabled(event.currentTarget.checked)
                    }
                  />
                  <span className="frameRingSmartSwitch" aria-hidden="true" />
                </label>
              </section>

              <p className="frameRingSmartOrganizeNotice">
                原视频不会被改动；候选帧会先交给你确认，整理后也可立即撤销。
              </p>
            </>
          )}

          {(smartOrganizeStage === 'scanning' ||
            smartOrganizeStage === 'analyzing' ||
            smartOrganizeStage === 'applying') && (
            <section className="frameRingSmartOrganizeBusy" aria-live="polite">
              <span className="frameRingSmartOrganizeBusyIcon">
                <Sparkles size={25} strokeWidth={1.4} />
              </span>
              <strong>
                {smartOrganizeStage === 'scanning'
                  ? '正在检查帧环画面…'
                  : smartOrganizeStage === 'analyzing'
                    ? '正在理解画面并生成标注…'
                    : '正在应用整理结果…'}
              </strong>
              <small>
                {smartOrganizeStage === 'analyzing'
                  ? `将分析 ${Math.max(0, frames.length - smartOrganizeSelectedFrameIds.size)} 帧，首次运行可能需要一些时间`
                  : '请保持当前素材不变，完成后会自动继续'}
              </small>
            </section>
          )}

          {smartOrganizeStage === 'review' && (
            <>
              <section className="frameRingSmartSummary" aria-label="检测结果">
                <span>
                  <strong>{smartOrganizeScan?.blankCandidates.length ?? 0}</strong>
                  黑白候选
                </span>
                <span>
                  <strong>{smartOrganizeScan?.duplicateGroups.length ?? 0}</strong>
                  重复组
                </span>
                <span>
                  <strong>{smartOrganizeSelectedFrameIds.size}</strong>
                  将从帧环移除
                </span>
              </section>

              {smartOrganizeCandidates.length > 0 ? (
                <div className="frameRingSmartCandidateList" role="list">
                  {smartOrganizeCandidates.map((candidate) => {
                    const frame = smartOrganizeFrameById.get(candidate.frameId)
                    const selected = smartOrganizeSelectedFrameIds.has(candidate.frameId)
                    const protectedAnnotation = frameHasProtectedAnnotation(candidate.frameId)
                    return (
                      <button
                        key={candidate.frameId}
                        className={`frameRingSmartCandidate uiGlassInset ${selected ? 'selected' : ''}`}
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        onClick={() => toggleSmartOrganizeFrame(candidate.frameId)}
                      >
                        <span className="frameRingSmartCandidateCheck" aria-hidden="true">
                          {selected && <Check size={13} strokeWidth={2} />}
                        </span>
                        {frame ? (
                          <img src={frame.thumbnail} alt="" draggable={false} />
                        ) : (
                          <span className="frameRingSmartCandidatePlaceholder" />
                        )}
                        <span className="frameRingSmartCandidateCopy">
                          <strong>
                            {candidate.kind === 'black'
                              ? '近纯黑画面'
                              : candidate.kind === 'white'
                                ? '近纯白画面'
                                : '高度重复画面'}
                            {frame ? ` · ${frame.timecode}` : ''}
                          </strong>
                          <small>
                            {protectedAnnotation
                              ? '检测到手动标注，已默认保留'
                              : candidate.reason}
                          </small>
                        </span>
                        <span className="frameRingSmartCandidateConfidence">
                          {Math.round(candidate.confidence * 100)}%
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="frameRingSmartEmpty uiGlassInset">
                  <Check size={22} strokeWidth={1.4} />
                  <strong>没有发现需要清理的画面</strong>
                  <small>仍可继续使用视觉模型补全标签与备注。</small>
                </div>
              )}

              <label className="frameRingSmartAnnotationOption uiGlassInset">
                <span>
                  <strong>继续生成标签与备注</strong>
                  <small>默认导入信息可被更新，手动逐帧修改会保留</small>
                </span>
                <input
                  type="checkbox"
                  checked={smartOrganizeAnnotationsEnabled}
                  disabled={!onAnalyzeSmartFrames}
                  onChange={(event) =>
                    setSmartOrganizeAnnotationsEnabled(event.currentTarget.checked)
                  }
                />
                <span className="frameRingSmartSwitch" aria-hidden="true" />
              </label>
            </>
          )}

          {smartOrganizeStage === 'preview' && (
            <>
              <section className="frameRingSmartSummary" aria-label="整理预览">
                <span>
                  <strong>{smartOrganizeSelectedFrameIds.size}</strong>
                  待移除
                </span>
                <span>
                  <strong>{smartOrganizeSuggestions.length}</strong>
                  待更新标注
                </span>
                <span>
                  <strong>{frames.length - smartOrganizeSelectedFrameIds.size}</strong>
                  保留帧
                </span>
              </section>
              <div className="frameRingSmartSuggestionList">
                {smartOrganizeSuggestions.slice(0, 4).map((suggestion) => {
                  const frame = smartOrganizeFrameById.get(suggestion.frameId)
                  return (
                    <div key={suggestion.frameId} className="uiGlassInset">
                      {frame && <img src={frame.thumbnail} alt="" draggable={false} />}
                      <span>
                        <strong>{frame?.timecode ?? '画面标注'}</strong>
                        <small>{suggestion.note || '未生成备注'}</small>
                        <span className="frameRingSmartSuggestionTags">
                          {suggestion.tags.slice(0, 4).map((tag) => (
                            <i key={tag}>{tag}</i>
                          ))}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
              {smartOrganizeSuggestions.length > 4 && (
                <p className="frameRingSmartOrganizeNotice">
                  另有 {smartOrganizeSuggestions.length - 4} 帧标注将在应用后写入。
                </p>
              )}
            </>
          )}

          {smartOrganizeStage === 'complete' && (
            <section className="frameRingSmartComplete" aria-live="polite">
              <span><Check size={26} strokeWidth={1.5} /></span>
              <strong>帧环整理完成</strong>
              <small>
                已移除 {smartOrganizeResult?.excludedCount ?? 0} 帧，更新{' '}
                {smartOrganizeResult?.annotatedCount ?? 0} 帧标签与备注。
              </small>
              <p>原视频保持不变，本次结果可在关闭前撤销。</p>
            </section>
          )}

          {smartOrganizeError && (
            <p className="frameRingSmartError" role="alert">
              {smartOrganizeError}
            </p>
          )}

          {smartOrganizeStage === 'ready' && (
            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={closeSmartOrganizeDialog}
              >
                取消
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="button"
                onClick={() => void scanSmartFrames()}
              >
                <Sparkles size={15} strokeWidth={1.65} />
                开始检测
              </button>
            </footer>
          )}

          {smartOrganizeStage === 'review' && (
            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={resetSmartOrganize}
              >
                返回
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="button"
                onClick={() => void continueSmartOrganize()}
              >
                {smartOrganizeAnnotationsEnabled ? '理解画面' : '应用整理'}
                <ChevronRight size={15} strokeWidth={1.65} />
              </button>
            </footer>
          )}

          {smartOrganizeStage === 'preview' && (
            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => setSmartOrganizeStage('review')}
              >
                返回
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="button"
                onClick={() => void applySmartOrganize()}
              >
                <Check size={15} strokeWidth={1.75} />
                确认应用
              </button>
            </footer>
          )}

          {smartOrganizeStage === 'complete' && (
            <footer className="createPanelActions">
              <button
                className="secondaryAction frameRingSmartUndo uiGlassInset uiGlassInteractive"
                type="button"
                disabled={!onUndoSmartOrganize}
                onClick={() => void undoSmartOrganize()}
              >
                <Undo2 size={14} strokeWidth={1.55} />
                撤销本次整理
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="button"
                onClick={closeSmartOrganizeDialog}
              >
                完成
              </button>
            </footer>
          )}
        </section>
      </div>,
      reflectionHost,
    )
    : null

  return (
    <>
      {reflectionCanvas}
      {projectedGlassLayer}
      {infoPanelPortal}
      {bottomActionsPortal}
      {stillExportDialogPortal}
      {smartOrganizeDialogPortal}
      {(active || hasPageBeenActive) && (
        <section
          ref={viewRef}
          className={`frameRingView ${trimMode ? 'isTrimMode' : ''}`}
          data-page-active={active}
          data-entry-intent={focusTarget?.intent}
          aria-hidden={
            !active ||
            !interactive ||
            stillExportDialogOpen ||
            smartOrganizeDialogOpen ||
            undefined
          }
          inert={
            !active ||
            !interactive ||
            stillExportDialogOpen ||
            smartOrganizeDialogOpen
          }
          style={frameRingCssVariables}
          aria-label={`${clip.filename} 帧环浏览`}
        >

      <div className="frameRingBreadcrumb" aria-label="当前位置">
        <button type="button" onClick={onBack}>
          {project.title}
        </button>
        <ChevronRight size={13 * layout.uiScale} strokeWidth={1.5} />
        <strong>{clip.filename}</strong>
        <ChevronRight size={13 * layout.uiScale} strokeWidth={1.5} />
        <span>{onlinePlaybackMode ? '在线播放' : '帧环浏览'}</span>
      </div>

      {hasFrameRing && !onlinePlaybackMode && (
        <form className="frameRingSearch uiGlassShell" onSubmit={handleSearch}>
          <Search size={14 * layout.uiScale} strokeWidth={1.55} />
          <input
            value={frameQuery}
            placeholder="搜索帧时间码..."
            onChange={(event) => setFrameQuery(event.target.value)}
            aria-label="搜索帧时间码"
          />
        </form>
      )}

      <div className="frameRingFloatingStage" aria-label="悬浮帧详情">
        <div className="frameRingFloatingCameraRig">
          <div
            ref={previewRef}
            className="frameRingPreview frameRingFloatingObject"
            data-frame-id={settledFrame.id}
            data-frame-reflection="true"
            data-reflection-project-id="frame-ring-preview"
            data-reflection-index={visibleFrames.length}
            data-player-playing={isPlayerPlaying}
          >
            <span
              className={`frameRingPreviewMedia ${onlinePlaybackMode ? 'isOnlinePlayback' : ''}`}
            >
              {onlinePlayback ? (
                <>
                  {onlineReflectionSource && (
                    <img
                      key={onlineReflectionSourceId}
                      className="frameRingPreviewImage frameRingPreviewOnlineReflectionSource"
                      src={onlineReflectionSource.sourceUrl}
                      alt=""
                      aria-hidden="true"
                      data-online-reflection-source={onlineReflectionSource.kind}
                      onLoad={() => {
                        setOnlineReflectionReadySourceId(
                          onlineReflectionSourceId,
                        )
                      }}
                    />
                  )}
                  <OnlineEmbeddedPlayer
                    key={onlinePlaybackKey}
                    active={active && !suspended}
                    playback={onlinePlayback}
                    poster={playerFrame.thumbnail || clip.thumbnail}
                    reflectionActive={
                      active &&
                      !suspended &&
                      !onlineReflectionCaptureSource
                    }
                    onReflectionFrame={handleOnlineReflectionFrame}
                  />
                </>
              ) : hasPlayableVideo ? (
                <video
                  key={clip.sourceUrl}
                  ref={previewVideoRef}
                  className="frameRingPreviewImage frameRingPreviewVideo"
                  crossOrigin={getFrameRingVideoCrossOrigin(clip.sourceUrl)}
                  src={clip.sourceUrl ?? undefined}
                  poster={playerFrame.thumbnail}
                  preload="metadata"
                  playsInline
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  onDurationChange={handleVideoLoadedMetadata}
                  onLoadedData={(event) => {
                    requestPreviewReflectionSnapshot(event.currentTarget.currentTime)
                  }}
                  onSeeked={(event) => {
                    const nextTime = event.currentTarget.currentTime
                    setPlayerTimeSeconds(nextTime)
                    requestPreviewReflectionSnapshot(nextTime)
                  }}
                  onSeeking={clearVideoDecodeWatchdog}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onPlay={() => {
                    setWindowControlsVisible(false)
                    setIsPlayerPlaying(true)
                  }}
                  onPlaying={(event) => {
                    armVideoDecodeWatchdog(event.currentTarget)
                  }}
                  onWaiting={clearVideoDecodeWatchdog}
                  onStalled={clearVideoDecodeWatchdog}
                  onPause={(event) => {
                    clearVideoDecodeWatchdog()
                    const nextTime = event.currentTarget.currentTime
                    setIsPlayerPlaying(false)
                    setPlayerTimeSeconds(nextTime)
                    requestPreviewReflectionSnapshot(nextTime)
                  }}
                  onEnded={(event) => {
                    clearVideoDecodeWatchdog()
                    const nextTime = event.currentTarget.currentTime
                    setIsPlayerPlaying(false)
                    setPlayerTimeSeconds(nextTime)
                    requestPreviewReflectionSnapshot(nextTime)
                  }}
                  onError={() => {
                    clearVideoDecodeWatchdog()
                    setIsPlayerPlaying(false)
                    if (!previewUsesProxy && onPreviewPlaybackError) {
                      requestCompatibleVideoPreview()
                    } else {
                      setVideoPlaybackFailed(true)
                      setActionStatus(
                        '视频预览无法播放，请检查素材路径或编码格式',
                      )
                    }
                  }}
                />
              ) : (
                <img
                  className="frameRingPreviewImage"
                  src={playerFrame.thumbnail}
                  alt=""
                  style={{
                    objectPosition: `${playerFrame.cropX}% ${playerFrame.cropY}%`,
                    filter: `${mediaColorFilter} brightness(${playerFrame.brightness})`,
                  }}
                />
              )}
                {!onlinePlaybackMode && (
                  <span className="frameRingPreviewShade" aria-hidden="true" />
                )}
                {sourceOffline && !onlinePlaybackMode && (
                  <span className="frameRingPreviewOffline" role="status">
                    <VideoOff size={24 * layout.uiScale} strokeWidth={1.3} />
                    <strong>素材已离线</strong>
                    <small>帧环仍可浏览，重新连接原文件后可恢复播放</small>
                  </span>
                )}
              </span>
              <img className="frameRingPreviewFrame" src="./aurora/video-kuang16x9.png" alt="" />
              <img className="frameRingPreviewLight" src="./aurora/video-kuang-light16x9.png" alt="" />
              {!onlinePlaybackMode && (
                <>
                  <span className="frameRingPreviewTime">总时长&nbsp;&nbsp;{durationTimecode}</span>
                  <span className="frameRingPreviewResolution">{clip.resolution}</span>
                  {renderPreviewControls('reflection')}
                </>
              )}
              {!onlinePlaybackMode && isPlayerFullscreen && (
                <div
                  className="frameRingPreviewFullscreenControlsRegion"
                  data-frame-preview-fullscreen-controls-region="true"
                  data-controls-visible={fullscreenControlsVisible}
                  onPointerEnter={revealFullscreenControls}
                  onPointerMove={revealFullscreenControls}
                  onPointerLeave={hideFullscreenControls}
                  onPointerDownCapture={holdFullscreenControls}
                  onPointerUpCapture={revealFullscreenControls}
                  onFocusCapture={revealFullscreenControls}
                  onBlurCapture={scheduleFullscreenControlsHide}
                >
                  <span
                    className="frameRingPreviewControlsFullscreenGlass"
                    aria-hidden="true"
                  />
                  {renderPreviewControls('fullscreen')}
                </div>
              )}
          </div>

          {!onlinePlaybackMode && infoPanelVisible && (
            <div
              className="frameRingInfoPanel frameRingFloatingObject frameRingInfoReflectionProxy"
              data-frame-reflection="true"
              data-reflection-project-id="frame-ring-info"
              data-reflection-index={visibleFrames.length + 1}
              data-reflection-padded="true"
              aria-hidden="true"
            />
          )}

          {hasFrameRing && !onlinePlaybackMode && (
              <div
                className="frameRingActionPanel frameRingFloatingObject frameRingActionReflectionProxy"
                data-frame-reflection="true"
                data-reflection-project-id="frame-ring-action"
                data-reflection-index={visibleFrames.length + 2}
                data-reflection-padded="true"
                aria-hidden="true"
              />
          )}
        </div>
      </div>

      {trimMode && (
        <section
          className="frameRingTrimWorkspace uiGlassShell"
          aria-label="片段截取时间线"
          data-camera-gesture="block"
          data-trim-adjusting={trimHandleAdjusting}
          data-trim-selection-coverage={trimSelectionCoverage.toFixed(4)}
          data-trim-in-frame={clipInFrame}
          data-trim-out-frame={clipOutFrame}
          data-trim-total-frames={totalTrimFrames}
          data-trim-fps={playerFps}
          data-trim-viewport-start-frame={trimViewport.startFrame}
          data-trim-viewport-end-frame={trimViewport.endFrame}
          data-trim-at-source-start={trimViewport.startFrame <= 0}
          data-trim-at-source-end={trimViewport.endFrame >= totalTrimFrames}
          data-trim-selection-fills-viewport={
            clipInProgress <= 0.5 && clipOutProgress >= 99.5
          }
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            '--frame-ring-trim-in': `${clipInProgress}%`,
            '--frame-ring-trim-out': `${clipOutProgress}%`,
            '--frame-ring-trim-playhead': `${trimPlayheadProgress}%`,
          } as CSSProperties}
        >
          <button
            className="frameRingTrimClose"
            type="button"
            aria-label="退出剪辑模式"
            onClick={closeTrimWorkspace}
          >
            <X size={14 * layout.uiScale} strokeWidth={1.5} />
          </button>
          <div className="frameRingTrimTimeline">
            <div className="frameRingTrimFilmstrip" ref={trimFilmstripRef}>
              <div className="frameRingTrimVisual" aria-hidden="true">
                <div className="frameRingTrimThumbnails">
                  {trimTimelineFrames.map(({
                    frame,
                    key,
                    leftPercent,
                    widthPercent,
                  }) =>
                    frame.thumbnail ? (
                      <img
                        key={key}
                        src={frame.thumbnail}
                        alt=""
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                          objectPosition: `${frame.cropX}% ${frame.cropY}%`,
                        }}
                      />
                    ) : (
                      <span
                        key={key}
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                        }}
                      />
                    ),
                  )}
                </div>
                <span className="frameRingTrimShade frameRingTrimShadeStart" />
                <span className="frameRingTrimShade frameRingTrimShadeEnd" />
              </div>
              <span className="frameRingTrimSelection" aria-hidden="true">
                <span className="frameRingTrimHandle frameRingTrimHandleStart">
                  <GripVertical size={8 * layout.uiScale} strokeWidth={1.6} />
                </span>
                <span className="frameRingTrimHandle frameRingTrimHandleEnd">
                  <GripVertical size={8 * layout.uiScale} strokeWidth={1.6} />
                </span>
              </span>
              {!trimPlayheadOnBoundary && (
                <span className="frameRingTrimPlayhead" aria-hidden="true" />
              )}
              {activeTrimHandle && (
                <output
                  className={`frameRingTrimHandleTime frameRingTrimHandleTime${activeTrimHandle === 'start' ? 'Start' : 'End'}`}
                  aria-hidden="true"
                >
                  {formatFrameRingTimecode(
                    activeTrimHandle === 'start' ? clipInSeconds : clipOutSeconds,
                    playerFps,
                  )}
                </output>
              )}
              <input
                className="frameRingTrimRange frameRingTrimRangeStart"
                type="range"
                min={trimViewport.startFrame}
                max={trimViewport.endFrame}
                step={1}
                value={clipInFrame}
                onPointerDown={(event) => beginTrimPointerAdjustment('start', event)}
                onPointerMove={(event) => moveTrimPointerAdjustment('start', event)}
                onPointerUp={(event) => finishTrimPointerAdjustment('start', event)}
                onPointerCancel={(event) => finishTrimPointerAdjustment('start', event)}
                onLostPointerCapture={() => {
                  if (
                    trimHandleAdjustingRef.current &&
                    activeTrimHandleRef.current === 'start' &&
                    trimPointerDragRef.current.handle === 'start'
                  ) finishTrimHandleAdjustment()
                }}
                onBlur={() => {
                  if (
                    trimHandleAdjustingRef.current &&
                    activeTrimHandleRef.current === 'start'
                  ) finishTrimHandleAdjustment()
                }}
                onKeyDown={(event) => {
                  if (TRIM_ADJUSTMENT_KEYS.has(event.key)) beginTrimHandleAdjustment('start')
                }}
                onKeyUp={(event) => {
                  if (TRIM_ADJUSTMENT_KEYS.has(event.key)) finishTrimHandleAdjustment()
                }}
                onChange={(event) => {
                  if (!trimPointerDragRef.current.active) {
                    updateClipIn(Number(event.target.value))
                  }
                }}
                aria-label="片段入点"
              />
              <input
                className="frameRingTrimRange frameRingTrimRangeEnd"
                type="range"
                min={trimViewport.startFrame}
                max={trimViewport.endFrame}
                step={1}
                value={clipOutFrame}
                onPointerDown={(event) => beginTrimPointerAdjustment('end', event)}
                onPointerMove={(event) => moveTrimPointerAdjustment('end', event)}
                onPointerUp={(event) => finishTrimPointerAdjustment('end', event)}
                onPointerCancel={(event) => finishTrimPointerAdjustment('end', event)}
                onLostPointerCapture={() => {
                  if (
                    trimHandleAdjustingRef.current &&
                    activeTrimHandleRef.current === 'end' &&
                    trimPointerDragRef.current.handle === 'end'
                  ) finishTrimHandleAdjustment()
                }}
                onBlur={() => {
                  if (
                    trimHandleAdjustingRef.current &&
                    activeTrimHandleRef.current === 'end'
                  ) finishTrimHandleAdjustment()
                }}
                onKeyDown={(event) => {
                  if (TRIM_ADJUSTMENT_KEYS.has(event.key)) beginTrimHandleAdjustment('end')
                }}
                onKeyUp={(event) => {
                  if (TRIM_ADJUSTMENT_KEYS.has(event.key)) finishTrimHandleAdjustment()
                }}
                onChange={(event) => {
                  if (!trimPointerDragRef.current.active) {
                    updateClipOut(Number(event.target.value))
                  }
                }}
                aria-label="片段出点"
              />
            </div>
            <div
              className="frameRingTrimRuler"
              data-tick-count={trimRulerTicks.length}
              aria-hidden="true"
            >
              {trimRulerTicks.map((tick) => (
                <span
                  key={tick.frame}
                  data-major={tick.major}
                  style={{ left: `${tick.progress}%` }}
                />
              ))}
            </div>
            <div className="frameRingTrimSummary">
              <div className="frameRingTrimEndpoint frameRingTrimEndpointStart">
                <span>入点</span>
                <strong>{formatFrameRingTimecode(clipInSeconds, playerFps)}</strong>
              </div>
              <div className="frameRingTrimDuration">
                <span>裁剪时长</span>
                <strong>{formatFrameRingTimecode(clipSelectionDuration, playerFps)}</strong>
              </div>
              <div className="frameRingTrimEndpoint frameRingTrimEndpointEnd">
                <span>出点</span>
                <strong>{formatFrameRingTimecode(clipOutSeconds, playerFps)}</strong>
              </div>
            </div>
          </div>
        </section>
      )}

      {!onlinePlaybackMode && (
        <>
          <div
            className="frameRingPreloadSourceLayer"
            data-frame-ring-preload-count={reflectionPreloadFrames.length}
            aria-hidden="true"
            inert
          >
        {reflectionPreloadFrames.map((frame: FrameRingFrame) => (
          <div
            key={`preload:${frame.id}`}
            className="frameRingCard frameRingPreloadSourceCard"
            data-frame-id={frame.id}
            data-frame-preload-source="true"
            aria-hidden="true"
            style={{
              '--frame-cover-x': `${frame.cropX}%`,
              '--frame-cover-y': `${frame.cropY}%`,
              '--frame-cover-brightness': frame.brightness,
            } as CSSProperties}
          >
            <span className="frameRingCardMedia">
              <span
                className="frameRingCardImage"
                style={{ backgroundImage: `url(${frame.thumbnail})` }}
              />
            </span>
            <img
              className="frameRingCardFrame"
              src="./aurora/video-kuang16x9.png"
              alt=""
            />
            <img
              className="frameRingCardLight"
              src="./aurora/video-kuang-light16x9.png"
              alt=""
            />
            <span className="frameRingCardTime">{frame.shortTimecode}</span>
          </div>
        ))}
          </div>

          <div
            ref={ringStageRef}
            className={`frameRingStage ${isDragging ? 'isDragging' : ''} ${isSettling ? 'isSettling' : ''}`}
            style={{
              '--frame-ring-settle-duration': `${settleDuration}ms`,
            } as CSSProperties}
            aria-label="帧环"
            aria-hidden={trimMode || undefined}
            inert={trimMode}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => finishDrag(event, true)}
            onPointerCancel={(event) => finishDrag(event, false)}
          >
        {!hasFrameRing && (
          <div
            className="frameRingEmptyState"
            data-camera-gesture="block"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Orbit size={19 * layout.uiScale} strokeWidth={1.25} />
            <strong>
              {externalPreview ? '尚未加入 Aurora' : '尚未建立帧环'}
            </strong>
            <small>
              {externalPreview
                ? '当前视频可以直接预览；加入 Aurora 后可以建立帧环。'
                : '视频可以直接预览；建立帧环后，索引帧会显示在这里。'}
            </small>
            <button
              type="button"
              disabled={
                externalPreview
                  ? !onAddExternalVideo
                  : buildFrameRingPending ||
                    indexTask === 'building' ||
                    !onBuildFrameRing
              }
              onClick={() => {
                if (externalPreview) onAddExternalVideo?.()
                else void buildFrameRing()
              }}
            >
              {externalPreview
                ? '加入 Aurora'
                : indexTask === 'building' || buildFrameRingPending
                  ? `正在建立 ${Math.round((indexProgress ?? 0) * 100)}%`
                  : indexTask === 'failed'
                    ? '重新建立帧环'
                    : '建立帧环'}
            </button>
            {(previewTask !== 'ready' || actionStatus) && (
              <span
                className="frameRingEmptyStatus"
                role="status"
                aria-live="polite"
                title={previewTask === 'failed' ? previewError ?? undefined : undefined}
              >
                {previewTask === 'preparing'
                  ? `正在准备视频预览 ${Math.round((previewProgress ?? 0) * 100)}%`
                  : previewTask === 'failed'
                    ? '视频预览准备失败，请检查素材文件后重试'
                    : actionStatus}
              </span>
            )}
          </div>
        )}
        <div className="frameRingCameraRig">
          {visibleFrames.map((frame, visibleIndex) => {
          const ordinal = visibleRange.start + visibleIndex
          const offset = ordinal - position
          const visual = getFrameRingVisual(offset, layout)
          const selected = ordinal === highlightedIndex
          const style = {
            '--frame-ring-x': `${visual.x}px`,
            '--frame-ring-y': `${visual.y}px`,
            '--frame-ring-z': `${visual.z}px`,
            '--frame-ring-rotate-y': `${visual.rotateY}deg`,
            '--frame-ring-scale': visual.scale,
            '--frame-ring-scale-x': visual.scaleX,
            '--frame-ring-opacity': visual.opacity,
            '--frame-ring-edge-blur': `${visual.edgeBlur}px`,
            '--frame-ring-edge-brightness': visual.edgeBrightness,
            '--frame-ring-edge-saturation': visual.edgeSaturation,
            '--frame-cover-x': `${frame.cropX}%`,
            '--frame-cover-y': `${frame.cropY}%`,
            '--frame-cover-brightness': frame.brightness,
            zIndex: visual.zIndex,
          } as CSSProperties

          return (
            <div
              key={frame.id}
              className={`frameRingCard ${visual.edgeBlur > 0.001 ? 'isEdgeFaded' : ''} ${selected ? 'selected' : ''} ${hoveredFrameId === frame.id ? 'isHitHovered' : ''}`}
              style={style}
              data-frame-id={frame.id}
              data-frame-index={ordinal}
              data-source-frame-index={frame.index}
              data-frame-ordinal={ordinal + 1}
              data-frame-total={frames.length}
              data-frame-offset={offset.toFixed(3)}
              data-frame-rotation={visual.rotateY.toFixed(3)}
              data-frame-reflection="true"
              data-reflection-index={visibleIndex}
              aria-hidden="true"
            >
              <span className="frameRingCardMedia">
                <span className="frameRingCardImage" style={{ backgroundImage: `url(${frame.thumbnail})` }} />
              </span>
              <img className="frameRingCardFrame" src="./aurora/video-kuang16x9.png" alt="" />
              <img className="frameRingCardLight" src="./aurora/video-kuang-light16x9.png" alt="" />
              <span className="frameRingCardTime">{frame.shortTimecode}</span>
            </div>
          )
          })}
        </div>
        {hasFrameRing && (
          <output
            className="frameRingIndexReadout"
            aria-live="off"
            aria-label={`当前索引帧 ${highlightedIndex + 1}，共 ${frames.length} 帧`}
            data-frame-index={highlightedIndex}
            data-frame-ordinal={highlightedIndex + 1}
            data-frame-total={frames.length}
          >
            <small>索引帧</small>
            <strong>
              {String(highlightedIndex + 1).padStart(frameOrdinalDigits, '0')}
              {' / '}
              {frames.length}
            </strong>
          </output>
        )}
        <div ref={ringHitLayerRef} className="frameRingHitLayer">
          {visibleFrames.map((frame, visibleIndex) => {
            const ordinal = visibleRange.start + visibleIndex
            const selected = ordinal === highlightedIndex
            return (
              <button
                key={`hit:${frame.id}`}
                type="button"
                className="frameRingHitTarget"
                data-frame-id={frame.id}
                data-frame-index={ordinal}
                data-source-frame-index={frame.index}
                aria-label={`选择帧 ${frame.timecode}`}
                aria-pressed={selected}
                onPointerEnter={() => setHoveredFrameId(frame.id)}
                onPointerLeave={() =>
                  setHoveredFrameId((current) => (current === frame.id ? null : current))
                }
                onFocus={() => setHoveredFrameId(frame.id)}
                onBlur={() =>
                  setHoveredFrameId((current) => (current === frame.id ? null : current))
                }
                onClick={() => handleFrameClick(ordinal)}
              />
            )
          })}
        </div>
          </div>
        </>
      )}

        </section>
      )}
    </>
  )
}
