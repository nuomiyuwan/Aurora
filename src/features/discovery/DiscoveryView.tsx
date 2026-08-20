import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import {
  ArrowRight,
  Box,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  Info,
  LoaderCircle,
  Play,
  Plus,
  Search,
  Scissors,
  Star,
  Upload,
  WandSparkles,
} from 'lucide-react'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'
import {
  ONLINE_MEDIA_PROVIDER_IDS,
  getOnlineProviderLabel,
  getOnlineProviderSearchTypeOptions,
  isOnlineMediaProvider,
  normalizeOnlineProviderSearchType,
  onlineProviderHasCapability,
  type OnlineMediaProvider,
  type OnlineProviderSearchType,
} from '../../data/onlineProviderRegistry'
import {
  readWheelDragSample,
  resolveWheelDragPreviewPosition,
  resolveTrackpadSnapTarget,
  WHEEL_DRAG_END_DELAY,
  type WheelDragAxis,
} from '../wheelDragGesture'
import {
  type DiscoveryResult,
  type DiscoveryResultKind,
  type DiscoverySource,
  type DiscoveryVisualIndexStatus,
} from './discoveryData'
import {
  resolveDiscoveryResultActions,
  type DiscoveryResultActionIcon,
  type DiscoveryResultActionRequest,
} from './discoveryResultActions'
import {
  createDefaultDiscoverySearchRepository,
  findStrongLocalMetadataMatches,
  LocalDiscoverySearchProvider,
  runHybridDiscoverySearch,
  useDiscoverySearch,
} from './search'
import type { BackgroundReflectionSurface } from '../reflection/backgroundReflectionSurfaceProtocol'
import { syncProjectedGlass } from '../video-library/projectedGlassProjection'
import { DETAIL_PANEL_CORNER_RADIUS_RATIO } from '../video-library/videoClipGeometry'
import {
  DiscoveryReflectionCanvas,
  DISCOVERY_REFLECTION_MOTION_EVENT,
} from './DiscoveryReflectionCanvas'
import {
  mergeBalancedOnlineDiscoverySearchResults,
  mergeOnlineDiscoverySearchResults,
  shouldRunDirectOnlineSearch,
} from './mergeOnlineDiscoverySearchResults'
import {
  appendUniqueDiscoveryResults,
  BILIBILI_DISCOVERY_PAGE_SIZE,
  getDiscoveryProviderPrefetchWindow,
  shouldPrefetchNextBilibiliPage,
  type DiscoveryBilibiliSearchPage,
  type DiscoveryBilibiliSearchRequest,
} from './bilibiliDiscoveryPagination'
import { getOnlineSearchFailureStatus } from './onlineSearchFailureStatus'

type DiscoverySourceFilter = 'all' | Exclude<DiscoverySource, 'nas'>
type DiscoveryKindFilter = 'all' | DiscoveryResultKind
type DiscoveryResolutionFilter = 'all' | DiscoveryResult['resolutionLabel']
type DiscoveryDetailTab = 'info' | 'source' | 'related'
type DiscoverySelectionTransition = {
  resultId: string
  fromSlotIndex: number
  fromOrderIds: string[]
  toOrderIds: string[]
  startedFromHover: boolean
  sequence: number
}
type DiscoverySnakeDirection = -1 | 1
type DiscoverySnakeTransition = {
  direction: DiscoverySnakeDirection
  fromWindowStart: number
  toWindowStart: number
  fromOrderIds: string[]
  toOrderIds: string[]
  renderedOrderIds: string[]
  sequence: number
}
type DiscoveryOnlinePaginationState = {
  searchSequence: number
  query: string
  searchType: OnlineProviderSearchType | null
  nextPage: number | null
  totalCount: number | null
  hasMore: boolean
  loading: boolean
  autoLoadBlocked: boolean
  loadMoreError: string | null
}
type DiscoveryOnlineRetryMode = 'manual' | 'recovery'
type DiscoveryOnlineRecoveryState = {
  attempts: number
  timer: number | null
  searchSequence: number
  query: string
  nextPage: number
}
const DEFAULT_QUERY = ''
const SEARCH_DELAY_MS = 320
const FIRST_RESULT_REVEAL_DELAY_MS = 520
const DISCOVERY_VISUAL_PREPARATION_TIMEOUT_MS = 8_000
const DISCOVERY_CARD_SWITCH_MS = 420
const DISCOVERY_CARD_REFLOW_DELAY_MS = 96
const DISCOVERY_CARD_REFLOW_MS =
  DISCOVERY_CARD_SWITCH_MS - DISCOVERY_CARD_REFLOW_DELAY_MS
const DISCOVERY_CARD_SWITCH_FALLBACK_MS = DISCOVERY_CARD_SWITCH_MS + 120
const DISCOVERY_CARD_SWITCH_SAMPLE_COUNT = 24
const DISCOVERY_LOCAL_DOUBLE_CLICK_MS = 460
const DISCOVERY_LOCAL_DOUBLE_CLICK_DISTANCE = 28
const DISCOVERY_RESULT_POINTER_DRAG_THRESHOLD = 6
const DISCOVERY_SNAKE_STEP_MS = 520
const DISCOVERY_SNAKE_STEP_FALLBACK_MS = DISCOVERY_SNAKE_STEP_MS + 80
const DISCOVERY_SNAKE_STEP_SAMPLE_COUNT = 24
const DISCOVERY_SNAKE_STEP_EASING =
  'cubic-bezier(0.16, 0.82, 0.2, 1)'
const DISCOVERY_SNAKE_WHEEL_THRESHOLD = 88
const DISCOVERY_SNAKE_ACCUMULATOR_IDLE_MS = 560
const DISCOVERY_SNAKE_MAX_PENDING_STEPS = 4
const DISCOVERY_CORRIDOR_CLICK_MIN_MS = 280
const DISCOVERY_CORRIDOR_CLICK_MAX_MS = 560
const DISCOVERY_CORRIDOR_WHEEL_MIN_MS = 180
const DISCOVERY_CORRIDOR_WHEEL_MAX_MS = 420
const DISCOVERY_CORRIDOR_GUARD_DISTANCE = 0.5
// Keep the resting rig on the authored nine-slot baseline. Trackpad and mouse
// drag temporarily apply continuous corridor poses only while input is active.
const DISCOVERY_RESULT_CORRIDOR_ENABLED = false
// Changing this value remounts the result-card rig after a Fast Refresh. This
// prevents a cancelled corridor frame from surviving as stale inline geometry.
const DISCOVERY_RESULT_LAYOUT_REVISION = 6
const DISCOVERY_IMAGE_PRELOAD_TIMEOUT_MS = 6_000
const DISCOVERY_PRELOAD_CACHE_LIMIT = 96
const DOUYIN_DISCOVERY_RECOVERY_DELAYS_MS = [700, 1_600, 3_600] as const
// The main-process Douyin collector has its own 40 second deadline. Keep a
// small IPC grace period here so a lost renderer/main-process reply can never
// leave Discovery's pagination state permanently marked as loading.
const DOUYIN_DISCOVERY_PAGE_REQUEST_TIMEOUT_MS = 45_000
const discoveryImagePreloadCache = new Map<string, Promise<boolean>>()

const EMPTY_ONLINE_PAGINATION: DiscoveryOnlinePaginationState = {
  searchSequence: 0,
  query: '',
  searchType: null,
  nextPage: null,
  totalCount: null,
  hasMore: false,
  loading: false,
  autoLoadBlocked: false,
  loadMoreError: null,
}

const createOnlinePaginationState = () =>
  Object.fromEntries(
    ONLINE_MEDIA_PROVIDER_IDS.map((provider) => [
      provider,
      { ...EMPTY_ONLINE_PAGINATION },
    ]),
  ) as Record<OnlineMediaProvider, DiscoveryOnlinePaginationState>

const ONLINE_SEARCH_STATUS_NON_ISSUE_PREFIXES = [
  '正在',
  '已找到',
  '已加载',
  '没有找到',
] as const

const isOnlineSearchStatusIssue = (status: string) =>
  !ONLINE_SEARCH_STATUS_NON_ISSUE_PREFIXES.some((prefix) =>
    status.startsWith(prefix),
  )

const formatMultiProviderOnlineSearchHint = ({
  providerCount,
  visibleResultCount,
  isSearching,
  loadingProviderCount,
  issueProviderCount,
  retryableProviderCount,
}: {
  providerCount: number
  visibleResultCount: number
  isSearching: boolean
  loadingProviderCount: number
  issueProviderCount: number
  retryableProviderCount: number
}) => {
  if (isSearching) return `正在搜索 ${providerCount} 个在线来源…`

  const summary = `在线结果 ${visibleResultCount} 条 · ${providerCount} 个来源`
  if (retryableProviderCount > 0) {
    return `${summary} · ${retryableProviderCount} 个需重试`
  }
  if (issueProviderCount > 0) {
    return `${summary} · ${issueProviderCount} 个异常`
  }
  if (loadingProviderCount > 0) return `${summary} · 正在加载更多…`
  return summary
}

const renderDiscoveryActionIcon = (
  icon: DiscoveryResultActionIcon,
) => {
  switch (icon) {
    case 'scissors':
      return <Scissors size={12} aria-hidden="true" />
    case 'folder-plus':
      return <FolderPlus size={12} aria-hidden="true" />
    case 'export':
      return <Upload size={12} aria-hidden="true" />
    case 'box':
      return <Box size={12} aria-hidden="true" />
    case 'folder-open':
      return <FolderOpen size={12} aria-hidden="true" />
    case 'star':
      return <Star size={12} aria-hidden="true" />
    case 'play':
    default:
      return <Play size={12} aria-hidden="true" />
  }
}

const preloadDiscoveryImage = (source: string) => {
  const url = resolveDocumentAssetUrl(source)
  if (!url) return Promise.resolve(false)
  const cached = discoveryImagePreloadCache.get(url)
  if (cached) return cached

  const request = new Promise<boolean>((resolve) => {
    const image = new Image()
    let settled = false
    const settle = (loaded: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      resolve(loaded)
    }
    const timeout = window.setTimeout(
      () => settle(false),
      DISCOVERY_IMAGE_PRELOAD_TIMEOUT_MS,
    )
    image.onload = () => {
      if (typeof image.decode !== 'function') {
        settle(true)
        return
      }
      void image.decode().catch(() => undefined).finally(() => settle(true))
    }
    image.onerror = () => settle(false)
    image.src = url
  })

  discoveryImagePreloadCache.set(url, request)
  void request.then((loaded) => {
    if (!loaded) discoveryImagePreloadCache.delete(url)
  })
  while (discoveryImagePreloadCache.size > DISCOVERY_PRELOAD_CACHE_LIMIT) {
    const oldest = discoveryImagePreloadCache.keys().next().value as
      | string
      | undefined
    if (!oldest) break
    discoveryImagePreloadCache.delete(oldest)
  }
  return request
}

const prepareDiscoveryResultImages = async (
  results: readonly DiscoveryResult[],
) => {
  const sources = Array.from(
    new Set([
      './aurora/discovery-result-frame.png',
      './aurora/detail-panel.png',
      ...results.map((result) => result.thumbnail).filter(Boolean),
    ]),
  )
  await Promise.all(sources.map(preloadDiscoveryImage))
  // A transient CDN/cache timeout must not permanently erase the source from
  // the result. Failed preload entries are evicted above, so a later search or
  // render can retry the same thumbnail while the card backdrop remains safe.
  return [...results]
}

const STATIC_SOURCE_LABELS: Record<'all' | Exclude<DiscoverySource, OnlineMediaProvider>, string> = {
  all: '全部来源',
  local: '本地',
  emby: 'Emby',
  nas: 'NAS',
}

const getDiscoverySourceLabel = (source: 'all' | DiscoverySource) =>
  isOnlineMediaProvider(source)
    ? getOnlineProviderLabel(source)
    : STATIC_SOURCE_LABELS[source]

const KIND_LABELS: Record<DiscoveryKindFilter, string> = {
  all: '全部类型',
  clip: '视频片段',
  frame: '关键帧',
  model: '三维模型',
}

const RESOLUTION_LABELS: Record<DiscoveryResolutionFilter, string> = {
  all: '全部分辨率',
  '4K': '4K',
  '1080P': '1080P',
  ONLINE: '在线',
  GLB: 'GLB',
  OBJ: 'OBJ',
  FBX: 'FBX',
}

const filtersAllowOnlineResults = (
  kind: DiscoveryKindFilter,
  resolution: DiscoveryResolutionFilter,
) =>
  (kind === 'all' || kind === 'clip') &&
  (resolution === 'all' || resolution === 'ONLINE')

const INDEX_STATUS_LABELS: Record<DiscoveryVisualIndexStatus, string> = {
  'not-created': '未建立索引',
  ready: '索引已就绪',
}

const DISCOVERY_CARD_BASE_WIDTH = 470
const DISCOVERY_HOVER_SCALE = 1.004
const DISCOVERY_HOVER_TURN_FACTOR = 0.24
const DISCOVERY_HOVER_ROLL_FACTOR = 0.18
const DISCOVERY_HOVER_LIFT_MIN = 8
const DISCOVERY_HOVER_LIFT_MAX = 28
const DISCOVERY_HOVER_ROLL_MIN = 0.35
const DISCOVERY_HOVER_ROLL_MAX = 2.4
const DISCOVERY_HOVER_EXIT_DELAY_MS = 70
const DISCOVERY_CARD_DRAW_Z_INDEX = 96
const DISCOVERY_PREVIOUS_MAIN_Z_INDEX = DISCOVERY_CARD_DRAW_Z_INDEX - 1

type DiscoveryCardLayout = {
  x: number
  y: number
  width: number
  rotateY: number
  rotateZ: number
  depth: number
  order: number
  layer: number
  brightness: number
  saturation: number
  opacity: number
}

// All result slots reflect across the shared rig-local floor declared as
// DISCOVERY_RESULT_SHARED_FLOOR_Y in discoveryReflectionSource.ts.
const CARD_SLOTS = [
  {
    x: 640,
    y: 364,
    width: 430,
    rotateY: 0,
    rotateZ: 0,
    depth: 400,
    order: 60,
    layer: 0,
    brightness: 1,
    saturation: 1,
    opacity: 1,
  },
  {
    x: 940,
    y: 381.43,
    width: 400,
    rotateY: -5,
    rotateZ: 0,
    depth: 150,
    order: 50,
    layer: 2,
    brightness: 0.9,
    saturation: 0.9,
    opacity: 1,
  },
  {
    x: 310,
    y: 381.43,
    width: 400,
    rotateY: 15,
    rotateZ: 0,
    depth: 150,
    order: 50,
    layer: 1,
    brightness: 0.9,
    saturation: 0.9,
    opacity: 1,
  },
  {
    x: 280,
    y: 230,
    width: 400,
    rotateY: 20,
    rotateZ: 0,
    depth: -150,
    order: 40,
    layer: 3,
    brightness: 0.6,
    saturation: 0.8,
    opacity: 1,
  },
  {
    x: 600,
    y: 140,
    width: 400,
    rotateY: -4,
    rotateZ: 0.6,
    depth: 0,
    order: 40,
    layer: 3,
    brightness: 0.6,
    saturation: 0.8,
    opacity: 1,
  },
  {
    x: 900,
    y: 210,
    width: 400,
    rotateY: -8,
    rotateZ: -0.6,
    depth: -160,
    order: 40,
    layer: 1,
    brightness: 0.6,
    saturation: 0.8,
    opacity: 1,
  },
  {
    x: 1000,
    y: 280,
    width: 400,
    rotateY: -15,
    rotateZ: 0.8,
    depth: -230,
    order: 39,
    layer: 2,
    brightness: 0.6,
    saturation: 0.8,
    opacity: 1,
  },
  {
    x: 890,
    y: 55,
    width: 300,
    rotateY: -8,
    rotateZ: 0.5,
    depth: -600,
    order: 7,
    layer: 4,
    brightness: 0.3,
    saturation: 0.5,
    opacity: 1,
  },
  {
    x: 200,
    y: 55,
    width: 320,
    rotateY: 8,
    rotateZ: -0.6,
    depth: -600,
    order: 8,
    layer: 4,
    brightness: 0.3,
    saturation: 0.5,
    opacity: 1,
  },
] as const satisfies readonly DiscoveryCardLayout[]

type DiscoveryCardSlot = DiscoveryCardLayout

const getDiscoveryMaximumWindowStart = (resultCount: number) =>
  Math.max(0, resultCount - 1)

const DISCOVERY_FRONT_DEPTH = Math.max(
  ...CARD_SLOTS.map((slot) => slot.depth),
)
const DISCOVERY_BACK_DEPTH = Math.min(
  ...CARD_SLOTS.map((slot) => slot.depth),
)
const DISCOVERY_FRONT_ORDER = Math.max(
  ...CARD_SLOTS.map((slot) => slot.order),
)
const DISCOVERY_BACK_ORDER = Math.min(
  ...CARD_SLOTS.map((slot) => slot.order),
)
const DISCOVERY_COMPOSITION_CENTER_X = CARD_SLOTS[0].x

const clampUnit = (value: number) => Math.min(1, Math.max(0, value))
const smoothStepUnit = (value: number) => {
  const progress = clampUnit(value)
  return progress * progress * (3 - 2 * progress)
}
const getRearFactor = (value: number, front: number, back: number) => {
  const range = front - back
  return range > 0 ? clampUnit((front - value) / range) : 0
}

const getDiscoveryHoverGeometry = (slot: DiscoveryCardSlot) => {
  const depthFactor = getRearFactor(
    slot.depth,
    DISCOVERY_FRONT_DEPTH,
    DISCOVERY_BACK_DEPTH,
  )
  const paintFactor = getRearFactor(
    slot.order,
    DISCOVERY_FRONT_ORDER,
    DISCOVERY_BACK_ORDER,
  )
  const occlusionFactor = depthFactor * 0.75 + paintFactor * 0.25
  const liftY =
    DISCOVERY_HOVER_LIFT_MIN +
    (DISCOVERY_HOVER_LIFT_MAX - DISCOVERY_HOVER_LIFT_MIN) *
      occlusionFactor
  const rollMagnitude =
    DISCOVERY_HOVER_ROLL_MIN +
    (DISCOVERY_HOVER_ROLL_MAX - DISCOVERY_HOVER_ROLL_MIN) *
      occlusionFactor
  const rollDirection =
    slot.x < DISCOVERY_COMPOSITION_CENTER_X
      ? -1
      : slot.x > DISCOVERY_COMPOSITION_CENTER_X
        ? 1
        : 0

  return {
    occlusionFactor,
    liftY,
    rotateZ:
      -slot.rotateZ * DISCOVERY_HOVER_ROLL_FACTOR +
      rollMagnitude * rollDirection,
  }
}

const createDiscoverySelectionStyle = (
  sourceSlot: DiscoveryCardSlot,
  startedFromHover: boolean,
) => {
  const hoverGeometry = getDiscoveryHoverGeometry(sourceSlot)

  return {
    '--discovery-card-selection-start-lift-y': `${
      startedFromHover ? -hoverGeometry.liftY : 0
    }px`,
    '--discovery-card-selection-start-rotate-y': `${
      startedFromHover
        ? -sourceSlot.rotateY * DISCOVERY_HOVER_TURN_FACTOR
        : 0
    }deg`,
    '--discovery-card-selection-start-rotate-z': `${
      startedFromHover ? hoverGeometry.rotateZ : 0
    }deg`,
    '--discovery-card-selection-start-scale':
      startedFromHover ? DISCOVERY_HOVER_SCALE : 1,
    zIndex: DISCOVERY_CARD_DRAW_Z_INDEX,
  } as CSSProperties
}

type DiscoveryCardPose = {
  x: number
  y: number
  depth: number
  rotateY: number
  rotateZ: number
  scale: number
}

const sampleCubicBezier = (
  start: number,
  controlA: number,
  controlB: number,
  end: number,
  progress: number,
) => {
  const remaining = 1 - progress
  return (
    remaining ** 3 * start +
    3 * remaining ** 2 * progress * controlA +
    3 * remaining * progress ** 2 * controlB +
    progress ** 3 * end
  )
}

const sampleDiscoveryCardPose = (
  start: DiscoveryCardPose,
  controlA: DiscoveryCardPose,
  controlB: DiscoveryCardPose,
  end: DiscoveryCardPose,
  progress: number,
): DiscoveryCardPose => ({
  x: sampleCubicBezier(
    start.x,
    controlA.x,
    controlB.x,
    end.x,
    progress,
  ),
  y: sampleCubicBezier(
    start.y,
    controlA.y,
    controlB.y,
    end.y,
    progress,
  ),
  depth: sampleCubicBezier(
    start.depth,
    controlA.depth,
    controlB.depth,
    end.depth,
    progress,
  ),
  rotateY: sampleCubicBezier(
    start.rotateY,
    controlA.rotateY,
    controlB.rotateY,
    end.rotateY,
    progress,
  ),
  rotateZ: sampleCubicBezier(
    start.rotateZ,
    controlA.rotateZ,
    controlB.rotateZ,
    end.rotateZ,
    progress,
  ),
  scale: sampleCubicBezier(
    start.scale,
    controlA.scale,
    controlB.scale,
    end.scale,
    progress,
  ),
})

const createDiscoveryCardTransform = (pose: DiscoveryCardPose) =>
  [
    `translate3d(${pose.x.toFixed(3)}px, ${pose.y.toFixed(3)}px, ${pose.depth.toFixed(3)}px)`,
    'translate(-50%, -50%)',
    `rotateY(${pose.rotateY.toFixed(4)}deg)`,
    `rotateZ(${pose.rotateZ.toFixed(4)}deg)`,
    `scale(${pose.scale.toFixed(6)})`,
  ].join(' ')

const createDiscoverySlotPose = (
  slot: DiscoveryCardSlot,
  selected: boolean,
): DiscoveryCardPose => ({
  x: slot.x,
  y: slot.y,
  depth: slot.depth,
  rotateY: slot.rotateY,
  rotateZ: slot.rotateZ,
  scale:
    (slot.width / DISCOVERY_CARD_BASE_WIDTH) *
    (selected ? 1.06 : 1),
})

const createDiscoveryReflowKeyframes = (
  sourceSlot: DiscoveryCardSlot,
  destinationSlot: DiscoveryCardSlot,
  sourceSelected: boolean,
  destinationSelected = false,
): Keyframe[] => [
  {
    transform: createDiscoveryCardTransform(
      createDiscoverySlotPose(sourceSlot, sourceSelected),
    ),
  },
  {
    transform: createDiscoveryCardTransform(
      createDiscoverySlotPose(destinationSlot, destinationSelected),
    ),
  },
]

const createDiscoveryMaterialKeyframes = (
  sourceSlot: DiscoveryCardSlot,
  destinationSlot: DiscoveryCardSlot,
): Keyframe[] => [
  {
    filter:
      `brightness(${sourceSlot.brightness}) ` +
      `saturate(${sourceSlot.saturation})`,
  },
  {
    filter:
      `brightness(${destinationSlot.brightness}) ` +
      `saturate(${destinationSlot.saturation})`,
  },
]

const createDiscoverySelectionKeyframes = (
  sourceSlot: DiscoveryCardSlot,
): Keyframe[] => {
  const frontSlot = CARD_SLOTS[0]
  const extractedDepth = frontSlot.depth + 56
  const extractionEnd = 0.18
  const settlingStart = 0.82
  const hoverGeometry = getDiscoveryHoverGeometry(sourceSlot)
  const arcLift = 40 + hoverGeometry.occlusionFactor * 52
  const arcDepth = 72 + hoverGeometry.occlusionFactor * 104
  const arcOffset =
    Math.sign(sourceSlot.x - DISCOVERY_COMPOSITION_CENTER_X) *
    (16 + hoverGeometry.occlusionFactor * 20)
  const drawRotateZ = Math.min(
    2.4,
    Math.max(-2.4, hoverGeometry.rotateZ * 1.08),
  )
  const sourceScale = sourceSlot.width / DISCOVERY_CARD_BASE_WIDTH
  const frontScale =
    (frontSlot.width / DISCOVERY_CARD_BASE_WIDTH) * 1.06

  const start: DiscoveryCardPose = {
    x: sourceSlot.x,
    y: sourceSlot.y,
    depth: sourceSlot.depth,
    rotateY: sourceSlot.rotateY,
    rotateZ: sourceSlot.rotateZ,
    scale: sourceScale,
  }
  const controlA: DiscoveryCardPose = {
    x:
      sourceSlot.x +
      (frontSlot.x - sourceSlot.x) * 0.08 +
      arcOffset,
    y:
      sourceSlot.y +
      (frontSlot.y - sourceSlot.y) * 0.08 -
      arcLift,
    depth:
      sourceSlot.depth +
      (frontSlot.depth - sourceSlot.depth) * 0.5 +
      arcDepth,
    rotateY: sourceSlot.rotateY * 0.42,
    rotateZ: drawRotateZ,
    scale: sourceScale + (frontScale - sourceScale) * 0.35,
  }
  const controlB: DiscoveryCardPose = {
    x:
      frontSlot.x +
      (sourceSlot.x - frontSlot.x) * 0.08,
    y: frontSlot.y - 18,
    depth: frontSlot.depth + 44,
    rotateY: sourceSlot.rotateY * 0.06,
    rotateZ: drawRotateZ * 0.16,
    scale: frontScale * 1.006,
  }
  const end: DiscoveryCardPose = {
    x: frontSlot.x,
    y: frontSlot.y,
    depth: frontSlot.depth,
    rotateY: frontSlot.rotateY,
    rotateZ: frontSlot.rotateZ,
    scale: frontScale,
  }

  return Array.from(
    { length: DISCOVERY_CARD_SWITCH_SAMPLE_COUNT + 1 },
    (_, index) => {
      const offset = index / DISCOVERY_CARD_SWITCH_SAMPLE_COUNT
      const pose = sampleDiscoveryCardPose(
        start,
        controlA,
        controlB,
        end,
        offset,
      )
      pose.depth =
        offset <= extractionEnd
          ? sourceSlot.depth +
            (extractedDepth - sourceSlot.depth) *
              smoothStepUnit(offset / extractionEnd)
          : offset < settlingStart
            ? extractedDepth
            : extractedDepth +
              (frontSlot.depth - extractedDepth) *
                smoothStepUnit(
                  (offset - settlingStart) /
                    (1 - settlingStart),
                )

      return {
        offset,
        transform: createDiscoveryCardTransform(pose),
      }
    },
  )
}

const createDiscoveryStaticCardStyle = (
  slot: DiscoveryCardSlot,
  {
    selected,
    focused,
    materialSlot = slot,
    materialSourceSlot = materialSlot,
  }: {
    selected: boolean
    focused: boolean
    materialSlot?: DiscoveryCardSlot
    materialSourceSlot?: DiscoveryCardSlot
  },
) => {
  const hoverGeometry = getDiscoveryHoverGeometry(slot)

  return {
    '--discovery-card-x': `${slot.x}px`,
    '--discovery-card-y': `${slot.y}px`,
    '--discovery-card-base-width': `${DISCOVERY_CARD_BASE_WIDTH}px`,
    '--discovery-card-rotate-y': `${slot.rotateY}deg`,
    '--discovery-card-rotate-z': `${slot.rotateZ}deg`,
    '--discovery-card-depth': `${slot.depth}px`,
    '--discovery-card-focus-depth': '0px',
    '--discovery-card-focus-lift-y': `${
      focused ? -hoverGeometry.liftY : 0
    }px`,
    '--discovery-card-focus-scale':
      focused ? DISCOVERY_HOVER_SCALE : 1,
    '--discovery-card-focus-rotate-y': `${
      focused ? -slot.rotateY * DISCOVERY_HOVER_TURN_FACTOR : 0
    }deg`,
    '--discovery-card-focus-rotate-z': `${
      focused ? hoverGeometry.rotateZ : 0
    }deg`,
    '--discovery-card-scale':
      (slot.width / DISCOVERY_CARD_BASE_WIDTH) * (selected ? 1.06 : 1),
    '--discovery-card-brightness': materialSlot.brightness,
    '--discovery-card-saturation': materialSlot.saturation,
    '--discovery-card-opacity': materialSlot.opacity,
    '--discovery-card-material-from-brightness':
      materialSourceSlot.brightness,
    '--discovery-card-material-from-saturation':
      materialSourceSlot.saturation,
    '--discovery-card-material-to-brightness':
      materialSlot.brightness,
    '--discovery-card-material-to-saturation':
      materialSlot.saturation,
    '--discovery-card-motion-opacity': 1,
    '--discovery-card-focus-brightness':
      focused ? 1.08 : 1,
    '--discovery-card-focus-saturation':
      focused ? 1.06 : 1,
    '--discovery-card-order': selected ? 90 : slot.order,
    zIndex: selected ? 90 : slot.order,
  } as CSSProperties
}

type DiscoveryCorridorPose = DiscoveryCardLayout & {
  active: boolean
  front: boolean
  reflectionIndex: number
}

const lerp = (start: number, end: number, progress: number) =>
  start + (end - start) * progress

const sampleCatmullRom = (
  previous: number,
  start: number,
  end: number,
  next: number,
  progress: number,
) => {
  const progress2 = progress * progress
  const progress3 = progress2 * progress
  return (
    0.5 *
    (
      2 * start +
      (-previous + end) * progress +
      (2 * previous - 5 * start + 4 * end - next) * progress2 +
      (-previous + 3 * start - 3 * end + next) * progress3
    )
  )
}

const interpolateCorridorLayout = (
  relativePosition: number,
): DiscoveryCardLayout => {
  const authoredSlotIndex = Math.round(relativePosition)
  if (
    authoredSlotIndex >= 0 &&
    authoredSlotIndex < CARD_SLOTS.length &&
    Math.abs(relativePosition - authoredSlotIndex) < 0.000001
  ) {
    return { ...CARD_SLOTS[authoredSlotIndex] }
  }

  const frontSlot = CARD_SLOTS[0]
  const secondSlot = CARD_SLOTS[1]
  const rearSlot = CARD_SLOTS[CARD_SLOTS.length - 1]
  const penultimateSlot = CARD_SLOTS[CARD_SLOTS.length - 2]
  const frontExit: DiscoveryCardLayout = {
    x: frontSlot.x + (frontSlot.x - secondSlot.x) * 0.35,
    y: frontSlot.y + (frontSlot.y - secondSlot.y) * 0.35,
    width: frontSlot.width * 1.04,
    rotateY: frontSlot.rotateY * 0.4,
    rotateZ: frontSlot.rotateZ,
    depth: frontSlot.depth + 150,
    order: 92,
    layer: frontSlot.layer,
    brightness: 1,
    saturation: 1,
    opacity: 0,
  }
  const rearEntry: DiscoveryCardLayout = {
    x: rearSlot.x + (rearSlot.x - penultimateSlot.x) * 0.15,
    y: rearSlot.y + (rearSlot.y - penultimateSlot.y) * 0.15,
    width: rearSlot.width * 0.92,
    rotateY: rearSlot.rotateY * 1.12,
    rotateZ: rearSlot.rotateZ,
    depth: rearSlot.depth - 140,
    order: 1,
    layer: rearSlot.layer,
    brightness: 0.18,
    saturation: 0.12,
    opacity: 0,
  }

  if (relativePosition <= 0) {
    const progress = clampUnit(
      (relativePosition + DISCOVERY_CORRIDOR_GUARD_DISTANCE) /
        DISCOVERY_CORRIDOR_GUARD_DISTANCE,
    )
    return {
      x: lerp(frontExit.x, frontSlot.x, progress),
      y: lerp(frontExit.y, frontSlot.y, progress),
      width: lerp(frontExit.width, frontSlot.width, progress),
      rotateY: lerp(frontExit.rotateY, frontSlot.rotateY, progress),
      rotateZ: lerp(frontExit.rotateZ, frontSlot.rotateZ, progress),
      depth: lerp(frontExit.depth, frontSlot.depth, progress),
      order: lerp(frontExit.order, frontSlot.order, progress),
      layer: frontSlot.layer,
      brightness: lerp(frontExit.brightness, frontSlot.brightness, progress),
      saturation: lerp(frontExit.saturation, frontSlot.saturation, progress),
      opacity: lerp(frontExit.opacity, frontSlot.opacity, progress),
    }
  }

  const rearIndex = CARD_SLOTS.length - 1
  if (relativePosition >= rearIndex) {
    const progress = clampUnit(
      (relativePosition - rearIndex) /
        DISCOVERY_CORRIDOR_GUARD_DISTANCE,
    )
    return {
      x: lerp(rearSlot.x, rearEntry.x, progress),
      y: lerp(rearSlot.y, rearEntry.y, progress),
      width: lerp(rearSlot.width, rearEntry.width, progress),
      rotateY: lerp(rearSlot.rotateY, rearEntry.rotateY, progress),
      rotateZ: lerp(rearSlot.rotateZ, rearEntry.rotateZ, progress),
      depth: lerp(rearSlot.depth, rearEntry.depth, progress),
      order: lerp(rearSlot.order, rearEntry.order, progress),
      layer: rearSlot.layer,
      brightness: lerp(rearSlot.brightness, rearEntry.brightness, progress),
      saturation: lerp(rearSlot.saturation, rearEntry.saturation, progress),
      opacity: lerp(rearSlot.opacity, rearEntry.opacity, progress),
    }
  }

  const startIndex = Math.floor(relativePosition)
  const endIndex = Math.min(rearIndex, startIndex + 1)
  const progress = relativePosition - startIndex
  const previousSlot = CARD_SLOTS[Math.max(0, startIndex - 1)]
  const startSlot = CARD_SLOTS[startIndex]
  const endSlot = CARD_SLOTS[endIndex]
  const nextSlot = CARD_SLOTS[Math.min(rearIndex, endIndex + 1)]
  const sample = (property: keyof Pick<
    DiscoveryCardLayout,
    'x' | 'y' | 'width' | 'rotateY' | 'rotateZ' | 'depth'
  >) =>
    sampleCatmullRom(
      previousSlot[property],
      startSlot[property],
      endSlot[property],
      nextSlot[property],
      progress,
    )

  return {
    x: sample('x'),
    y: sample('y'),
    width: lerp(startSlot.width, endSlot.width, progress),
    rotateY: sample('rotateY'),
    rotateZ: sample('rotateZ'),
    depth: sample('depth'),
    order: progress < 0.5 ? startSlot.order : endSlot.order,
    layer: progress < 0.5 ? startSlot.layer : endSlot.layer,
    brightness: clampUnit(
      lerp(startSlot.brightness, endSlot.brightness, progress),
    ),
    saturation: clampUnit(
      lerp(startSlot.saturation, endSlot.saturation, progress),
    ),
    opacity: clampUnit(
      lerp(startSlot.opacity, endSlot.opacity, progress),
    ),
  }
}

const createDiscoverySnakeMotionKeyframes = (
  sourcePosition: number,
  destinationPosition: number,
  sourceSelected: boolean,
  destinationSelected: boolean,
): Keyframe[] =>
  Array.from(
    { length: DISCOVERY_SNAKE_STEP_SAMPLE_COUNT + 1 },
    (_, index) => {
      const offset = index / DISCOVERY_SNAKE_STEP_SAMPLE_COUNT
      const pathPosition = lerp(
        sourcePosition,
        destinationPosition,
        offset,
      )
      const layout = interpolateCorridorLayout(pathPosition)
      const selectedScale = lerp(
        sourceSelected ? 1.06 : 1,
        destinationSelected ? 1.06 : 1,
        offset,
      )

      return {
        offset,
        transform: createDiscoveryCardTransform({
          x: layout.x,
          y: layout.y,
          depth: layout.depth,
          rotateY: layout.rotateY,
          rotateZ: layout.rotateZ,
          scale:
            (layout.width / DISCOVERY_CARD_BASE_WIDTH) *
            selectedScale,
        }),
      }
    },
  )

const getDiscoveryCorridorPose = (
  resultIndex: number,
  corridorPosition: number,
): DiscoveryCorridorPose => {
  const windowStart = Math.max(0, Math.round(corridorPosition))
  const relativePosition = resultIndex - corridorPosition
  const active =
    resultIndex >= windowStart &&
    resultIndex < windowStart + CARD_SLOTS.length
  const layout = interpolateCorridorLayout(relativePosition)
  const frontness = active
    ? 1 - clampUnit(Math.abs(relativePosition))
    : 0

  return {
    ...layout,
    width: layout.width * (1 + frontness * 0.06),
    opacity: active ? layout.opacity : 0,
    order: frontness > 0.5 ? 90 : layout.order,
    active,
    front: active && resultIndex === windowStart,
    reflectionIndex: active ? resultIndex - windowStart : -1,
  }
}

const createDiscoveryCardStyle = (
  pose: DiscoveryCorridorPose,
  focused: boolean,
) => {
  const hoverGeometry = getDiscoveryHoverGeometry(pose)

  return {
    '--discovery-card-x': `${pose.x}px`,
    '--discovery-card-y': `${pose.y}px`,
    '--discovery-card-base-width': `${DISCOVERY_CARD_BASE_WIDTH}px`,
    '--discovery-card-rotate-y': `${pose.rotateY}deg`,
    '--discovery-card-rotate-z': `${pose.rotateZ}deg`,
    '--discovery-card-depth': `${pose.depth}px`,
    '--discovery-card-focus-depth': '0px',
    '--discovery-card-focus-lift-y': `${
      focused ? -hoverGeometry.liftY : 0
    }px`,
    '--discovery-card-focus-scale':
      focused ? DISCOVERY_HOVER_SCALE : 1,
    '--discovery-card-focus-rotate-y': `${
      focused ? -pose.rotateY * DISCOVERY_HOVER_TURN_FACTOR : 0
    }deg`,
    '--discovery-card-focus-rotate-z': `${
      focused ? hoverGeometry.rotateZ : 0
    }deg`,
    '--discovery-card-scale':
      pose.width / DISCOVERY_CARD_BASE_WIDTH,
    '--discovery-card-brightness': pose.brightness,
    '--discovery-card-saturation': pose.saturation,
    '--discovery-card-opacity': 1,
    '--discovery-card-motion-opacity': pose.opacity,
    '--discovery-card-focus-brightness':
      focused ? 1.08 : 1,
    '--discovery-card-focus-saturation':
      focused ? 1.06 : 1,
    '--discovery-card-order': Math.round(pose.order),
  } as CSSProperties
}

const writeDiscoveryCorridorPose = (
  element: HTMLDivElement,
  pose: DiscoveryCorridorPose,
  moving: boolean,
) => {
  const style = element.style
  style.setProperty('--discovery-corridor-x', `${pose.x.toFixed(3)}px`)
  style.setProperty('--discovery-corridor-y', `${pose.y.toFixed(3)}px`)
  style.setProperty(
    '--discovery-corridor-rotate-y',
    `${pose.rotateY.toFixed(4)}deg`,
  )
  style.setProperty(
    '--discovery-corridor-rotate-z',
    `${pose.rotateZ.toFixed(4)}deg`,
  )
  style.setProperty(
    '--discovery-corridor-depth',
    `${pose.depth.toFixed(3)}px`,
  )
  style.setProperty(
    '--discovery-corridor-scale',
    (pose.width / DISCOVERY_CARD_BASE_WIDTH).toFixed(6),
  )
  style.setProperty(
    '--discovery-corridor-brightness',
    pose.brightness.toFixed(4),
  )
  style.setProperty(
    '--discovery-corridor-saturation',
    pose.saturation.toFixed(4),
  )
  style.setProperty(
    '--discovery-corridor-opacity',
    pose.opacity.toFixed(4),
  )
  style.setProperty(
    '--discovery-corridor-order',
    String(Math.round(pose.order)),
  )
  element.classList.toggle('isCorridorFront', pose.front)
  element.dataset.depthLayer = String(pose.layer)

  const hitTarget = element.querySelector<HTMLButtonElement>(
    '.discoveryResultHit',
  )
  if (hitTarget) hitTarget.disabled = moving || !pose.active

  if (pose.active) {
    element.dataset.discoveryReflection = 'true'
    element.dataset.reflectionIndex = String(pose.reflectionIndex)
  } else {
    delete element.dataset.discoveryReflection
    delete element.dataset.reflectionIndex
  }
  if (pose.front) {
    element.dataset.discoveryReflectionFloorAnchor = 'true'
  } else {
    delete element.dataset.discoveryReflectionFloorAnchor
  }
}

const clearDiscoveryCorridorPose = (element: HTMLDivElement) => {
  const style = element.style
  ;[
    '--discovery-corridor-x',
    '--discovery-corridor-y',
    '--discovery-corridor-rotate-y',
    '--discovery-corridor-rotate-z',
    '--discovery-corridor-depth',
    '--discovery-corridor-scale',
    '--discovery-corridor-brightness',
    '--discovery-corridor-saturation',
    '--discovery-corridor-opacity',
    '--discovery-corridor-order',
  ].forEach((property) => style.removeProperty(property))
  // Remove the legacy imperative writer's inline z-index after Fast Refresh.
  style.removeProperty('z-index')
}

interface FilterSelectProps<T extends string> {
  label: string
  value: T
  options: Readonly<Partial<Record<T, string>>>
  onChange: (value: T) => void
}

export type DiscoveryAiSearchRequest = {
  query: string
  sources: readonly DiscoverySource[]
  kind: DiscoveryKindFilter
  resolution: DiscoveryResolutionFilter
  limit: number
}

export type DiscoveryOnlineSearchRequest = DiscoveryBilibiliSearchRequest & {
  provider: OnlineMediaProvider
  searchType?: OnlineProviderSearchType
}

export type DiscoveryOnlineSearchPage = DiscoveryBilibiliSearchPage

export type DiscoveryAiCoverage = {
  totalLocalVideos: number
  searchableLocalVideos: number
  thumbnailVideos: number
  visualIndexVideos: number
}

export interface DiscoveryViewProps {
  active: boolean
  suspended: boolean
  cameraYaw: number
  cameraPitch: number
  isCameraDragging: boolean
  layoutSignal: string
  materialTint?: string
  reflectionSurface?: BackgroundReflectionSurface | null
  localResults: readonly DiscoveryResult[]
  onResultAction: (
    request: DiscoveryResultActionRequest,
  ) => boolean | Promise<boolean>
  aiSearchMode?: boolean
  aiSearchConfigured?: boolean
  onAiSearchModeChange?: (enabled: boolean) => void
  onAiSearchSetupRequired?: () => void
  onAiSearch?: (
    request: DiscoveryAiSearchRequest,
  ) => Promise<readonly DiscoveryResult[]>
  aiCoverage?: DiscoveryAiCoverage
  enabledOnlineProviders?: readonly OnlineMediaProvider[]
  onOnlineSearch?: (
    request: DiscoveryOnlineSearchRequest,
  ) => DiscoveryOnlineSearchPage | Promise<DiscoveryOnlineSearchPage>
  /** @deprecated Use onOnlineSearch. */
  onBilibiliSearch?: (
    request: DiscoveryBilibiliSearchRequest,
  ) => DiscoveryBilibiliSearchPage | Promise<DiscoveryBilibiliSearchPage>
  /** @deprecated Use onOnlineSearch. */
  onTencentSearch?: (
    request: DiscoveryBilibiliSearchRequest,
  ) => DiscoveryBilibiliSearchPage | Promise<DiscoveryBilibiliSearchPage>
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: FilterSelectProps<T>) {
  return (
    <label className="discoveryFilterSelect uiGlassInset">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {(Object.keys(options) as T[]).map((option) => (
          <option key={option} value={option}>
            {options[option]}
          </option>
        ))}
      </select>
      <ChevronDown size={12} strokeWidth={1.6} aria-hidden="true" />
    </label>
  )
}

export function DiscoveryView({
  active,
  suspended,
  cameraYaw,
  cameraPitch,
  isCameraDragging,
  layoutSignal,
  materialTint = '#aec5ff',
  reflectionSurface = null,
  localResults,
  onResultAction,
  aiSearchMode = false,
  aiSearchConfigured = false,
  onAiSearchModeChange,
  onAiSearchSetupRequired,
  onAiSearch,
  aiCoverage,
  enabledOnlineProviders = ['bilibili', 'tencent'],
  onOnlineSearch,
  onBilibiliSearch,
  onTencentSearch,
}: DiscoveryViewProps) {
  const detailPanelRef = useRef<HTMLElement>(null)
  const projectedGlassLayerRef = useRef<HTMLDivElement>(null)
  const projectedGlassSignatureRef = useRef('')
  const projectedGlassSyncSignatureRef = useRef('')
  const projectedGlassSyncCountRef = useRef(0)
  const [draftQuery, setDraftQuery] = useState(DEFAULT_QUERY)
  const [committedQuery, setCommittedQuery] = useState(DEFAULT_QUERY)
  const [sourceFilter, setSourceFilter] = useState<DiscoverySourceFilter>('all')
  const [kindFilter, setKindFilter] = useState<DiscoveryKindFilter>('all')
  const [providerSearchType, setProviderSearchType] =
    useState<OnlineProviderSearchType>('all')
  const [resolutionFilter, setResolutionFilter] =
    useState<DiscoveryResolutionFilter>('all')
  const [selectedId, setSelectedId] = useState('')
  const [layoutSelectedId, setLayoutSelectedId] = useState('')
  const [spatialOrderIds, setSpatialOrderIds] = useState<string[]>([])
  const [selectionTransition, setSelectionTransition] =
    useState<DiscoverySelectionTransition | null>(null)
  const [snakeTransition, setSnakeTransition] =
    useState<DiscoverySnakeTransition | null>(null)
  const [corridorWindowStart, setCorridorWindowStart] = useState(0)
  const [isCorridorMoving, setIsCorridorMoving] = useState(false)
  const [isResultPointerDragging, setIsResultPointerDragging] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [aiSearchError, setAiSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [resultsMounted, setResultsMounted] = useState(false)
  const [displayedResults, setDisplayedResults] = useState<DiscoveryResult[]>([])
  const [stagedRevision, setStagedRevision] = useState('')
  const [reflectionFallbackRevision, setReflectionFallbackRevision] =
    useState('')
  const [detailTab, setDetailTab] = useState<DiscoveryDetailTab>('info')
  const [operationStatus, setOperationStatus] = useState('')
  const [onlineSearchStatuses, setOnlineSearchStatuses] = useState<
    Partial<Record<OnlineMediaProvider, string>>
  >({})
  const [onlinePaginationByProvider, setOnlinePaginationByProvider] = useState(
    createOnlinePaginationState,
  )
  const onlinePaginationRef = useRef(createOnlinePaginationState())
  const displayedResultsRef = useRef<DiscoveryResult[]>([])
  const ignoreTransientOnlineResultsUntilRef = useRef(0)
  const localResultsRef = useRef(localResults)
  localResultsRef.current = localResults
  const searchRepository = useMemo(
    () => createDefaultDiscoverySearchRepository(() => localResultsRef.current),
    [],
  )
  const localSearchProvider = useMemo(
    () => new LocalDiscoverySearchProvider({
      getResults: () => localResultsRef.current,
    }),
    [],
  )
  const discoverySearch = useDiscoverySearch(searchRepository)
  const searchSequenceRef = useRef(0)
  const stagedRevisionRef = useRef('')
  const glassPreparedRevisionRef = useRef('')
  const reflectionPreparedRevisionRef = useRef('')
  const refreshAfterEmbyConnectionRef = useRef<() => void>(() => undefined)
  const refreshAfterLocalDataChangeRef = useRef<() => void>(() => undefined)
  const loadMoreOnlineResultsRef = useRef<
    (
      provider: OnlineMediaProvider,
      retryMode?: DiscoveryOnlineRetryMode,
    ) => void
  >(() => undefined)
  const onlinePaginationRecoveryRef = useRef(
    new Map<OnlineMediaProvider, DiscoveryOnlineRecoveryState>(),
  )
  const previousLocalResultsRef = useRef(localResults)
  const localResultsDirtyRef = useRef(false)
  const hoverExitTimerRef = useRef<number | null>(null)
  const selectionTimerRef = useRef<number | null>(null)
  const selectionAnimationsRef = useRef<Animation[]>([])
  const selectionSequenceRef = useRef(0)
  const selectionLockRef = useRef(false)
  const localDoubleClickRef = useRef<{
    resultId: string
    clientX: number
    clientY: number
    timeStamp: number
  } | null>(null)
  const localDoubleClickResetTimerRef = useRef<number | null>(null)
  const suppressNextResultClickRef = useRef(false)
  const resultPointerClickResetTimerRef = useRef<number | null>(null)
  const resultPointerDragRef = useRef({
    active: false,
    dragging: false,
    pointerId: -1,
    axis: null as WheelDragAxis | null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
  })
  const spatialOrderIdsRef = useRef<string[]>([])
  const snakeAnimationsRef = useRef<Animation[]>([])
  const snakeFallbackTimerRef = useRef<number | null>(null)
  const snakeSettleRafRef = useRef<number | null>(null)
  const snakeSequenceRef = useRef(0)
  const snakeLockRef = useRef(false)
  const pendingSnakeStepsRef = useRef(0)
  const snakeWheelReleaseTimerRef = useRef<number | null>(null)
  const snakeWheelStateRef = useRef({
    active: false,
    axis: null as WheelDragAxis | null,
    accumulator: 0,
    accumulatorAxis: null as WheelDragAxis | null,
    lastSampleTime: 0,
  })
  const startSnakeStepRef = useRef<
    (direction: DiscoverySnakeDirection) => void
  >(() => undefined)
  const consumePendingSnakeStepRef = useRef<() => void>(() => undefined)
  const discoveryViewRef = useRef<HTMLElement>(null)
  const corridorCardsRef = useRef<HTMLDivElement>(null)
  const corridorPositionRef = useRef(0)
  const corridorWindowStartRef = useRef(0)
  const corridorPositionRafRef = useRef<number | null>(null)
  const corridorAnimationRafRef = useRef<number | null>(null)
  const corridorPreviewRafRef = useRef<number | null>(null)
  const corridorStaticResetRafRef = useRef<number | null>(null)
  const corridorSettleRafRef = useRef<number | null>(null)
  const corridorAnimationSequenceRef = useRef(0)
  const corridorWheelReleaseTimerRef = useRef<number | null>(null)
  const corridorMovingRef = useRef(false)
  const corridorWheelStateRef = useRef({
    active: false,
    axis: null as WheelDragAxis | null,
    snapAnchor: 0,
    rawPosition: 0,
    previewStartPosition: 0,
    snapTarget: 0,
    lastTime: 0,
    velocity: 0,
    hasVelocity: false,
  })
  const resultCardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const enabledProviderList = useMemo(
    () =>
      ONLINE_MEDIA_PROVIDER_IDS.filter((provider) =>
        enabledOnlineProviders.includes(provider),
      ),
    [enabledOnlineProviders],
  )
  const enabledProviderSet = useMemo(
    () => new Set(enabledProviderList),
    [enabledProviderList],
  )
  const clearOnlinePaginationRecovery = (
    provider?: OnlineMediaProvider,
  ) => {
    const recoveries = onlinePaginationRecoveryRef.current
    const clearRecovery = (recovery: DiscoveryOnlineRecoveryState) => {
      if (recovery.timer !== null) window.clearTimeout(recovery.timer)
    }
    if (provider) {
      const recovery = recoveries.get(provider)
      if (recovery) clearRecovery(recovery)
      recoveries.delete(provider)
      return
    }
    recoveries.forEach(clearRecovery)
    recoveries.clear()
  }
  const scheduleDouyinPaginationRecovery = ({
    pagination,
  }: {
    pagination: DiscoveryOnlinePaginationState
  }) => {
    if (pagination.nextPage === null) return null
    const provider: OnlineMediaProvider = 'douyin'
    const current = onlinePaginationRecoveryRef.current.get(provider)
    const samePage =
      current?.searchSequence === pagination.searchSequence &&
      current.query === pagination.query &&
      current.nextPage === pagination.nextPage
    const completedAttempts = samePage ? current.attempts : 0
    const delay = DOUYIN_DISCOVERY_RECOVERY_DELAYS_MS[completedAttempts]
    if (delay === undefined) return null
    if (current?.timer !== null && current?.timer !== undefined) {
      window.clearTimeout(current.timer)
    }
    const attempts = completedAttempts + 1
    const recovery: DiscoveryOnlineRecoveryState = {
      attempts,
      timer: null,
      searchSequence: pagination.searchSequence,
      query: pagination.query,
      nextPage: pagination.nextPage,
    }
    const timer = window.setTimeout(() => {
      const scheduled = onlinePaginationRecoveryRef.current.get(provider)
      if (scheduled?.timer !== timer) return
      scheduled.timer = null
      const latest = onlinePaginationRef.current[provider]
      if (
        searchSequenceRef.current !== recovery.searchSequence ||
        latest.searchSequence !== recovery.searchSequence ||
        latest.query !== recovery.query ||
        latest.nextPage !== recovery.nextPage
      ) {
        clearOnlinePaginationRecovery(provider)
        return
      }
      loadMoreOnlineResultsRef.current(provider, 'recovery')
    }, delay)
    recovery.timer = timer
    onlinePaginationRecoveryRef.current.set(provider, recovery)
    return { attempts, delay }
  }
  const availableSourceFilters = useMemo(
    () => [
      'all',
      'local',
      ...enabledProviderList,
      'emby',
    ] as readonly DiscoverySourceFilter[],
    [enabledProviderList],
  )
  const activeOnlineProvider = isOnlineMediaProvider(sourceFilter)
    ? sourceFilter
    : null
  const activeProviderSearchTypeOptions = useMemo(
    () => activeOnlineProvider
      ? getOnlineProviderSearchTypeOptions(activeOnlineProvider)
      : [],
    [activeOnlineProvider],
  )
  const activeProviderSearchType = activeOnlineProvider
    ? normalizeOnlineProviderSearchType(
        activeOnlineProvider,
        providerSearchType,
      )
    : null
  const activeProviderSearchTypeLabels = useMemo(
    () => Object.fromEntries(
      activeProviderSearchTypeOptions.map((option) => [
        option.value,
        option.label,
      ]),
    ) as Partial<Record<OnlineProviderSearchType, string>>,
    [activeProviderSearchTypeOptions],
  )

  const filteredResults = displayedResults
  displayedResultsRef.current = displayedResults

  const corridorOrderedResults = filteredResults

  const selectedResult =
    corridorOrderedResults.find((result) => result.id === selectedId) ??
    corridorOrderedResults[0] ??
    null
  const selectedActionGroup = useMemo(
    () => selectedResult
      ? resolveDiscoveryResultActions(selectedResult)
      : null,
    [selectedResult],
  )
  const resultById = useMemo(
    () =>
      new Map(
        corridorOrderedResults.map((result) => [result.id, result]),
      ),
    [corridorOrderedResults],
  )
  const spatiallyOrderedResults = useMemo(() => {
    const ordered = spatialOrderIds
      .map((id) => resultById.get(id))
      .filter((result): result is DiscoveryResult => result !== undefined)
    const orderedIds = new Set(ordered.map((result) => result.id))

    return [
      ...ordered,
      ...corridorOrderedResults.filter(
        (result) => !orderedIds.has(result.id),
      ),
    ]
  }, [corridorOrderedResults, resultById, spatialOrderIds])
  const corridorResults = useMemo(
    () => {
      const start = corridorWindowStart
      return spatiallyOrderedResults.slice(
        start,
        start + CARD_SLOTS.length,
      )
    },
    [corridorWindowStart, spatiallyOrderedResults],
  )
  const corridorPreloadResults = useMemo(() => {
    const start = Math.max(0, corridorWindowStart - 1)
    const end = Math.min(
      spatiallyOrderedResults.length,
      corridorWindowStart + CARD_SLOTS.length + 1,
    )
    const activeIds = new Set(corridorResults.map((result) => result.id))
    return spatiallyOrderedResults
      .slice(start, end)
      .filter((result) => !activeIds.has(result.id))
  }, [corridorResults, corridorWindowStart, spatiallyOrderedResults])
  const spatialResults = useMemo(() => {
    const visibleById = new Map(
      corridorResults.map((result) => [result.id, result]),
    )
    const ordered = spatialOrderIds
      .map((id) => visibleById.get(id))
      .filter((result): result is DiscoveryResult => result !== undefined)
    const orderedIds = new Set(ordered.map((result) => result.id))

    return [
      ...ordered,
      ...corridorResults.filter((result) => !orderedIds.has(result.id)),
    ].slice(0, CARD_SLOTS.length)
  }, [corridorResults, spatialOrderIds])
  const previousGuardResult =
    corridorWindowStart > 0
      ? spatiallyOrderedResults[corridorWindowStart - 1] ?? null
      : null
  const nextGuardResult =
    spatiallyOrderedResults[
      corridorWindowStart + CARD_SLOTS.length
    ] ?? null
  const steadyRenderedResults = useMemo(() => {
    const start = Math.max(0, corridorWindowStart - 1)
    const end = Math.min(
      spatiallyOrderedResults.length,
      corridorWindowStart + CARD_SLOTS.length + 1,
    )
    return spatiallyOrderedResults.slice(start, end)
  }, [corridorWindowStart, spatiallyOrderedResults])
  const snakeRenderedResults = useMemo(() => {
    if (!snakeTransition) return steadyRenderedResults
    return snakeTransition.renderedOrderIds
      .map((id) => resultById.get(id))
      .filter((result): result is DiscoveryResult => result !== undefined)
  }, [resultById, snakeTransition, steadyRenderedResults])
  const renderedResults = DISCOVERY_RESULT_CORRIDOR_ENABLED
    ? corridorOrderedResults
    : snakeRenderedResults
  const spatialSlotIndexById = useMemo(
    () =>
      new Map(
        spatialResults.map((result, slotIndex) => [
          result.id,
          slotIndex,
        ]),
      ),
    [spatialResults],
  )
  const reflectionResultsRef = useRef<readonly DiscoveryResult[]>(
    spatialResults,
  )
  const reflectionResults =
    snakeTransition
      ? snakeRenderedResults
      : selectionTransition === null
        ? spatialResults
        : reflectionResultsRef.current
  const previousCorridorResultIdsRef = useRef<string[]>([])

  useLayoutEffect(() => {
    const nextResultIds = corridorOrderedResults.map((result) => result.id)
    const previousResultIds = previousCorridorResultIdsRef.current
    const isPureAppend =
      previousResultIds.length > 0 &&
      nextResultIds.length > previousResultIds.length &&
      previousResultIds.every((id, index) => nextResultIds[index] === id)
    previousCorridorResultIdsRef.current = nextResultIds

    // Live online pages arrive while the user is already navigating the authored
    // 3D card track. Appending must extend that track in place; running the
    // normal result-set reset here would jump the user back to the first card.
    if (isPureAppend) {
      const knownIds = new Set(spatialOrderIdsRef.current)
      const appendedIds = nextResultIds.filter((id) => !knownIds.has(id))
      if (appendedIds.length > 0) {
        const nextOrderIds = [
          ...spatialOrderIdsRef.current,
          ...appendedIds,
        ]
        spatialOrderIdsRef.current = nextOrderIds
        setSpatialOrderIds(nextOrderIds)
      }
      return
    }

    corridorAnimationSequenceRef.current += 1
    snakeSequenceRef.current += 1
    snakeLockRef.current = false
    pendingSnakeStepsRef.current = 0
    if (snakeSettleRafRef.current !== null) {
      window.cancelAnimationFrame(snakeSettleRafRef.current)
      snakeSettleRafRef.current = null
    }
    snakeAnimationsRef.current.forEach((animation) => {
      animation.onfinish = null
      animation.cancel()
    })
    snakeAnimationsRef.current = []
    if (snakeFallbackTimerRef.current !== null) {
      window.clearTimeout(snakeFallbackTimerRef.current)
      snakeFallbackTimerRef.current = null
    }
    if (snakeWheelReleaseTimerRef.current !== null) {
      window.clearTimeout(snakeWheelReleaseTimerRef.current)
      snakeWheelReleaseTimerRef.current = null
    }
    snakeWheelStateRef.current.active = false
    snakeWheelStateRef.current.axis = null
    snakeWheelStateRef.current.accumulator = 0
    snakeWheelStateRef.current.accumulatorAxis = null
    snakeWheelStateRef.current.lastSampleTime = 0
    if (corridorPositionRafRef.current !== null) {
      window.cancelAnimationFrame(corridorPositionRafRef.current)
      corridorPositionRafRef.current = null
    }
    if (corridorSettleRafRef.current !== null) {
      window.cancelAnimationFrame(corridorSettleRafRef.current)
      corridorSettleRafRef.current = null
    }
    if (corridorAnimationRafRef.current !== null) {
      window.cancelAnimationFrame(corridorAnimationRafRef.current)
      corridorAnimationRafRef.current = null
    }
    if (corridorPreviewRafRef.current !== null) {
      window.cancelAnimationFrame(corridorPreviewRafRef.current)
      corridorPreviewRafRef.current = null
    }
    if (corridorStaticResetRafRef.current !== null) {
      window.cancelAnimationFrame(corridorStaticResetRafRef.current)
      corridorStaticResetRafRef.current = null
    }
    if (corridorWheelReleaseTimerRef.current !== null) {
      window.clearTimeout(corridorWheelReleaseTimerRef.current)
      corridorWheelReleaseTimerRef.current = null
    }

    const wheelState = corridorWheelStateRef.current
    wheelState.active = false
    wheelState.axis = null
    wheelState.snapAnchor = 0
    wheelState.rawPosition = 0
    wheelState.previewStartPosition = 0
    wheelState.snapTarget = 0
    wheelState.lastTime = 0
    wheelState.velocity = 0
    wheelState.hasVelocity = false
    corridorPositionRef.current = 0
    corridorWindowStartRef.current = 0
    corridorMovingRef.current = false
    const corridorCards = corridorCardsRef.current
    corridorCards?.classList.remove('isCorridorMoving')

    if (!DISCOVERY_RESULT_CORRIDOR_ENABLED) {
      selectionSequenceRef.current += 1
      selectionLockRef.current = false
      if (selectionTimerRef.current !== null) {
        window.clearTimeout(selectionTimerRef.current)
        selectionTimerRef.current = null
      }
      selectionAnimationsRef.current.forEach((animation) => {
        animation.onfinish = null
        animation.cancel()
      })
      selectionAnimationsRef.current = []
      corridorCards?.classList.remove('isCorridorResetting')
      resultCardRefs.current.forEach((element) => {
        clearDiscoveryCorridorPose(element)
      })
      setCorridorWindowStart(0)
      setIsCorridorMoving(false)
      setSelectionTransition(null)
      setSnakeTransition(null)
      setHoveredId(null)
      const initialOrderIds = corridorOrderedResults.map(
        (result) => result.id,
      )
      spatialOrderIdsRef.current = initialOrderIds
      setSpatialOrderIds(initialOrderIds)
      const frontResult = corridorOrderedResults[0]
      if (frontResult) {
        const initialResults = corridorOrderedResults.slice(
          0,
          CARD_SLOTS.length,
        )
        reflectionResultsRef.current = initialResults
        setSelectedId(frontResult.id)
        setLayoutSelectedId(frontResult.id)
        setDetailTab('info')
        setOperationStatus('')
      }
      return
    }

    corridorCards?.classList.add('isCorridorResetting')

    corridorOrderedResults.forEach((result, resultIndex) => {
      const element = resultCardRefs.current.get(result.id)
      if (!element) return
      clearDiscoveryCorridorPose(element)
      const pose = getDiscoveryCorridorPose(resultIndex, 0)
      element.classList.toggle('isCorridorFront', pose.front)
      element.dataset.depthLayer = String(pose.layer)
    })
    void corridorCards?.offsetWidth
    corridorStaticResetRafRef.current = window.requestAnimationFrame(() => {
      corridorStaticResetRafRef.current = null
      corridorCardsRef.current?.classList.remove('isCorridorResetting')
    })

    setCorridorWindowStart(0)
    setIsCorridorMoving(false)
    setHoveredId(null)
    const frontResult = corridorOrderedResults[0]
    if (frontResult) {
      setSelectedId(frontResult.id)
      setDetailTab('info')
      setOperationStatus('')
    }
  }, [corridorOrderedResults])

  const canPreviewResults =
    active &&
    !suspended &&
    showResults &&
    !isSearching &&
    !isCameraDragging &&
    !isCorridorMoving &&
    selectionTransition === null
  const hoveredResultId =
    canPreviewResults &&
    hoveredId &&
    spatialResults.some((result) => result.id === hoveredId)
      ? hoveredId
      : null
  const hasHoverFocus = hoveredResultId !== null
  const selectedVisualIndexStatus = selectedResult
    ? selectedResult.visualIndex.status
    : 'not-created'
  const selectedFavoriteCount = selectedResult
    ? selectedResult.visualIndex.favoriteCount
    : 0
  const selectedVisualIndexCounts = selectedResult
    ? selectedResult.visualIndex
    : null
  const sourceSummary = sourceFilter === 'all'
    ? ['本地', ...enabledProviderList.map(getOnlineProviderLabel), 'Emby'].join(' + ')
    : getDiscoverySourceLabel(sourceFilter)
  const typeSummary = activeOnlineProvider
    ? activeProviderSearchType === null
      ? null
      : activeProviderSearchTypeLabels[activeProviderSearchType]
    : KIND_LABELS[kindFilter]
  const activeFilterSummary = [
    sourceSummary,
    typeSummary,
    RESOLUTION_LABELS[resolutionFilter],
  ].filter(Boolean).join(' · ')
  const retryableOnlineProviders = enabledProviderList.filter((provider) => {
    const pagination = onlinePaginationByProvider[provider]
    return (
      shouldRunDirectOnlineSearch(sourceFilter, provider) &&
      pagination.autoLoadBlocked &&
      Boolean(pagination.loadMoreError)
    )
  })
  const onlineStatusProviders = enabledProviderList.filter(
    (provider) =>
      shouldRunDirectOnlineSearch(sourceFilter, provider) &&
      Boolean(onlineSearchStatuses[provider]),
  )
  const visibleOnlineResultCount = filteredResults.filter(
    (result) =>
      isOnlineMediaProvider(result.source) &&
      onlineStatusProviders.includes(result.source),
  ).length
  const loadingOnlineProviderCount = onlineStatusProviders.filter(
    (provider) => onlinePaginationByProvider[provider].loading,
  ).length
  const issueOnlineProviderCount = onlineStatusProviders.filter((provider) => {
    const status = onlineSearchStatuses[provider]
    return Boolean(
      onlinePaginationByProvider[provider].loadMoreError ||
      (status && isOnlineSearchStatusIssue(status)),
    )
  }).length
  const compactOnlineSearchHint =
    !aiSearchMode &&
    sourceFilter === 'all' &&
    onlineStatusProviders.length > 1
      ? formatMultiProviderOnlineSearchHint({
          providerCount: onlineStatusProviders.length,
          visibleResultCount: visibleOnlineResultCount,
          isSearching,
          loadingProviderCount: loadingOnlineProviderCount,
          issueProviderCount: issueOnlineProviderCount,
          retryableProviderCount: retryableOnlineProviders.length,
        })
      : null
  const onlineSearchStatusDetail = onlineStatusProviders
    .map((provider) =>
      `${getOnlineProviderLabel(provider)}：${onlineSearchStatuses[provider]}`,
    )
    .join(' · ')
  const discoverySearchHint = aiSearchMode
    ? aiSearchError
      ? `AI 搜索暂不可用：${aiSearchError}`
      : aiSearchConfigured
        ? aiCoverage
          ? `AI 可搜索 ${aiCoverage.searchableLocalVideos} / ${aiCoverage.totalLocalVideos} 个本地视频 · 预览图 ${aiCoverage.thumbnailVideos} 个视频 · 关键帧索引 ${aiCoverage.visualIndexVideos} 个视频`
          : 'AI 将理解视频预览图与视觉索引中的关键帧'
        : '请先在探索页设置中配置 AI 在线模型'
    : compactOnlineSearchHint
      ? compactOnlineSearchHint
    : isOnlineMediaProvider(sourceFilter) && onlineSearchStatuses[sourceFilter]
      ? onlineSearchStatuses[sourceFilter]
    : sourceFilter === 'all' &&
        enabledProviderList.some((provider) => onlineSearchStatuses[provider])
      ? enabledProviderList
          .map((provider) => onlineSearchStatuses[provider])
          .filter(Boolean)
          .join(' · ')
    : discoverySearch.error
      ? `Emby 搜索暂不可用：${discoverySearch.error.message}`
      : discoverySearch.connection === 'connected'
        ? '正在搜索 Aurora 本地素材与已连接的 Emby 媒体库'
        : discoverySearch.connection === 'unavailable'
          ? 'Emby 未连接；当前仅搜索 Aurora 中的真实本地素材'
          : '当前搜索 Aurora 中的真实本地素材；可在设置中连接 Emby'
  const discoverySearchHintDetail = compactOnlineSearchHint
    ? onlineSearchStatusDetail
    : discoverySearchHint
  const retryBlockedOnlineSearches = () => {
    retryableOnlineProviders.forEach((provider) => {
      loadMoreOnlineResultsRef.current(provider, 'manual')
    })
  }
  const directOnlineSearchActive =
    enabledProviderList.some((provider) =>
      shouldRunDirectOnlineSearch(sourceFilter, provider),
    )
  const visibleResultCount =
    !aiSearchMode && !directOnlineSearchActive
      ? Math.max(filteredResults.length, discoverySearch.totalCount)
      : filteredResults.length
  const selectedOnlinePagination =
    isOnlineMediaProvider(sourceFilter)
      ? onlinePaginationByProvider[sourceFilter]
      : null
  const visibleOnlineTotalCount =
    !aiSearchMode &&
    selectedOnlinePagination?.totalCount !== null &&
    selectedOnlinePagination?.totalCount !== undefined
      ? Math.max(visibleResultCount, selectedOnlinePagination.totalCount)
      : null
  const projectedGlassGeometrySignature = [
    layoutSignal,
    cameraYaw.toFixed(4),
    cameraPitch.toFixed(4),
  ].join('|')
  const projectedGlassSyncSignature = [
    projectedGlassGeometrySignature,
    stagedRevision,
    selectedResult?.id ?? '',
  ].join('|')

  useEffect(
    () => () => {
      searchSequenceRef.current += 1
      clearOnlinePaginationRecovery()
      if (hoverExitTimerRef.current !== null) {
        window.clearTimeout(hoverExitTimerRef.current)
      }
      if (resultPointerClickResetTimerRef.current !== null) {
        window.clearTimeout(resultPointerClickResetTimerRef.current)
      }
      resultPointerDragRef.current.active = false
      resultPointerDragRef.current.dragging = false
      resultPointerDragRef.current.axis = null
      if (corridorWheelReleaseTimerRef.current !== null) {
        window.clearTimeout(corridorWheelReleaseTimerRef.current)
      }
      if (snakeWheelReleaseTimerRef.current !== null) {
        window.clearTimeout(snakeWheelReleaseTimerRef.current)
      }
      if (snakeFallbackTimerRef.current !== null) {
        window.clearTimeout(snakeFallbackTimerRef.current)
      }
      if (snakeSettleRafRef.current !== null) {
        window.cancelAnimationFrame(snakeSettleRafRef.current)
      }
      if (corridorPositionRafRef.current !== null) {
        window.cancelAnimationFrame(corridorPositionRafRef.current)
      }
      if (corridorAnimationRafRef.current !== null) {
        window.cancelAnimationFrame(corridorAnimationRafRef.current)
      }
      if (corridorPreviewRafRef.current !== null) {
        window.cancelAnimationFrame(corridorPreviewRafRef.current)
      }
      if (corridorStaticResetRafRef.current !== null) {
        window.cancelAnimationFrame(corridorStaticResetRafRef.current)
      }
      if (corridorSettleRafRef.current !== null) {
        window.cancelAnimationFrame(corridorSettleRafRef.current)
      }
      selectionSequenceRef.current += 1
      selectionLockRef.current = false
      if (selectionTimerRef.current !== null) {
        window.clearTimeout(selectionTimerRef.current)
      }
      selectionAnimationsRef.current.forEach((animation) => {
        animation.onfinish = null
        animation.cancel()
      })
      selectionAnimationsRef.current = []
      snakeSequenceRef.current += 1
      snakeLockRef.current = false
      pendingSnakeStepsRef.current = 0
      snakeSettleRafRef.current = null
      snakeAnimationsRef.current.forEach((animation) => {
        animation.onfinish = null
        animation.cancel()
      })
      snakeAnimationsRef.current = []
      corridorAnimationSequenceRef.current += 1
    },
    [],
  )

  useEffect(() => {
    if (!DISCOVERY_RESULT_CORRIDOR_ENABLED) return
    if (corridorOrderedResults.length === 0 || corridorMovingRef.current) return

    const maximumPosition = corridorOrderedResults.length - 1
    const settledIndex = Math.max(
      0,
      Math.min(maximumPosition, Math.round(corridorPositionRef.current)),
    )
    const frontResult = corridorOrderedResults[settledIndex]
    if (!frontResult || frontResult.id === selectedId) return

    corridorPositionRef.current = settledIndex
    corridorWindowStartRef.current = settledIndex
    setCorridorWindowStart(settledIndex)
    setSelectedId(frontResult.id)
    setDetailTab('info')
    setOperationStatus('')
  }, [corridorOrderedResults, selectedId])

  useEffect(() => {
    if (
      active &&
      !suspended &&
      showResults &&
      !isSearching
    ) {
      return
    }

    corridorAnimationSequenceRef.current += 1
    if (corridorPositionRafRef.current !== null) {
      window.cancelAnimationFrame(corridorPositionRafRef.current)
      corridorPositionRafRef.current = null
    }
    if (corridorAnimationRafRef.current !== null) {
      window.cancelAnimationFrame(corridorAnimationRafRef.current)
      corridorAnimationRafRef.current = null
    }
    if (corridorPreviewRafRef.current !== null) {
      window.cancelAnimationFrame(corridorPreviewRafRef.current)
      corridorPreviewRafRef.current = null
    }
    if (corridorWheelReleaseTimerRef.current !== null) {
      window.clearTimeout(corridorWheelReleaseTimerRef.current)
      corridorWheelReleaseTimerRef.current = null
    }
    if (corridorSettleRafRef.current !== null) {
      window.cancelAnimationFrame(corridorSettleRafRef.current)
      corridorSettleRafRef.current = null
    }
    const pointerState = resultPointerDragRef.current
    if (pointerState.dragging) suppressNextResultClickRef.current = false
    if (pointerState.active && pointerState.pointerId >= 0) {
      const view = discoveryViewRef.current
      try {
        if (view?.hasPointerCapture(pointerState.pointerId)) {
          view.releasePointerCapture(pointerState.pointerId)
        }
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
    if (resultPointerClickResetTimerRef.current !== null) {
      window.clearTimeout(resultPointerClickResetTimerRef.current)
      resultPointerClickResetTimerRef.current = null
    }
    corridorWheelStateRef.current.active = false
    corridorWheelStateRef.current.axis = null
    corridorWheelStateRef.current.hasVelocity = false
    pointerState.active = false
    pointerState.dragging = false
    pointerState.pointerId = -1
    pointerState.axis = null
    setIsResultPointerDragging(false)
    const orderedIds = spatialOrderIdsRef.current
    const maximumWindowStart = getDiscoveryMaximumWindowStart(
      orderedIds.length,
    )
    const settledWindowStart = Math.max(
      0,
      Math.min(
        maximumWindowStart,
        Math.round(corridorPositionRef.current),
      ),
    )
    corridorPositionRef.current = settledWindowStart
    corridorWindowStartRef.current = settledWindowStart
    setCorridorWindowStart(settledWindowStart)
    resultCardRefs.current.forEach((element) => {
      clearDiscoveryCorridorPose(element)
    })
    corridorMovingRef.current = false
    corridorCardsRef.current?.classList.remove('isCorridorMoving')
    setIsCorridorMoving(false)
  }, [active, isSearching, showResults, suspended])

  useEffect(() => {
    if (
      active &&
      !suspended &&
      showResults &&
      !isSearching
    ) {
      return
    }
    if (
      !snakeLockRef.current &&
      snakeTransition === null &&
      snakeSettleRafRef.current === null
    ) {
      return
    }

    snakeSequenceRef.current += 1
    snakeLockRef.current = false
    pendingSnakeStepsRef.current = 0
    if (snakeSettleRafRef.current !== null) {
      window.cancelAnimationFrame(snakeSettleRafRef.current)
      snakeSettleRafRef.current = null
    }
    snakeAnimationsRef.current.forEach((animation) => {
      animation.onfinish = null
      animation.cancel()
    })
    snakeAnimationsRef.current = []
    if (snakeFallbackTimerRef.current !== null) {
      window.clearTimeout(snakeFallbackTimerRef.current)
      snakeFallbackTimerRef.current = null
    }
    corridorMovingRef.current = false
    corridorCardsRef.current?.classList.remove('isCorridorMoving')
    setIsCorridorMoving(false)
    setSnakeTransition(null)
  }, [active, isSearching, showResults, snakeTransition, suspended])

  useLayoutEffect(() => {
    if (!DISCOVERY_RESULT_CORRIDOR_ENABLED) return
    if (isCorridorMoving) return
    const corridorCards = corridorCardsRef.current
    if (!corridorCards) return

    if (corridorStaticResetRafRef.current !== null) {
      window.cancelAnimationFrame(corridorStaticResetRafRef.current)
    }
    corridorCards.classList.add('isCorridorResetting')
    resultCardRefs.current.forEach((element) => {
      clearDiscoveryCorridorPose(element)
    })
    void corridorCards.offsetWidth
    corridorStaticResetRafRef.current = window.requestAnimationFrame(() => {
      corridorStaticResetRafRef.current = null
      corridorCardsRef.current?.classList.remove('isCorridorResetting')
    })
  }, [corridorOrderedResults, corridorWindowStart, isCorridorMoving])

  useEffect(() => {
    if (DISCOVERY_RESULT_CORRIDOR_ENABLED) return
    if (isCorridorMoving) return
    if (
      corridorResults.length > 0 &&
      !corridorResults.some((result) => result.id === selectedId)
    ) {
      const fallbackId = corridorResults[0].id
      setSelectedId(fallbackId)
      setLayoutSelectedId(fallbackId)
      setDetailTab('info')
      setOperationStatus('')
      return
    }
    if (
      selectionTransition === null &&
      snakeTransition === null &&
      layoutSelectedId !== selectedId
    ) {
      setLayoutSelectedId(selectedId)
    }
  }, [
    corridorResults,
    isCorridorMoving,
    layoutSelectedId,
    selectedId,
    selectionTransition,
    snakeTransition,
  ])

  useEffect(() => {
    if (
      DISCOVERY_RESULT_CORRIDOR_ENABLED ||
      selectionTransition !== null ||
      snakeTransition !== null
    ) {
      return
    }
    reflectionResultsRef.current = spatialResults
  }, [selectionTransition, snakeTransition, spatialResults])

  useEffect(() => {
    if (DISCOVERY_RESULT_CORRIDOR_ENABLED) return
    const availableIds = corridorOrderedResults.map((result) => result.id)
    const availableIdSet = new Set(availableIds)

    setSpatialOrderIds((current) => {
      const kept = current.filter((id) => availableIdSet.has(id))
      const keptSet = new Set(kept)
      const appended = availableIds.filter((id) => !keptSet.has(id))
      const next = [...kept, ...appended]
      if (
        next.length === current.length &&
        next.every((id, index) => id === current[index])
      ) {
        spatialOrderIdsRef.current = current
        return current
      }
      spatialOrderIdsRef.current = next
      return next
    })
  }, [corridorOrderedResults])

  useEffect(() => {
    if (
      hoveredId === null ||
      (
        canPreviewResults &&
        spatialResults.some((result) => result.id === hoveredId)
      )
    ) {
      return
    }
    if (hoverExitTimerRef.current !== null) {
      window.clearTimeout(hoverExitTimerRef.current)
      hoverExitTimerRef.current = null
    }
    setHoveredId(null)
  }, [canPreviewResults, hoveredId, spatialResults])

  useEffect(() => {
    if (
      DISCOVERY_RESULT_CORRIDOR_ENABLED ||
      !selectionTransition
    ) {
      return
    }
    const targetStillVisible = spatialResults.some(
      (result) => result.id === selectionTransition.resultId,
    )
    if (
      active &&
      !suspended &&
      showResults &&
      !isSearching &&
      targetStillVisible
    ) {
      return
    }

    selectionSequenceRef.current += 1
    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current)
      selectionTimerRef.current = null
    }
    selectionAnimationsRef.current.forEach((animation) => {
      animation.onfinish = null
      animation.cancel()
    })
    selectionAnimationsRef.current = []
    if (!targetStillVisible) {
      const fallbackId = corridorResults[0]?.id

      if (fallbackId) {
        const visibleIds = corridorResults.map((result) => result.id)
        const visibleIdSet = new Set(visibleIds)
        setSelectedId(fallbackId)
        setLayoutSelectedId(fallbackId)
        setSpatialOrderIds((current) => {
          const currentWindow = current.slice(
            corridorWindowStartRef.current,
            corridorWindowStartRef.current + CARD_SLOTS.length,
          )
          const nextWindow = [
            fallbackId,
            ...currentWindow.filter(
              (id) => id !== fallbackId && visibleIdSet.has(id),
            ),
            ...visibleIds.filter(
              (id) => id !== fallbackId && !currentWindow.includes(id),
            ),
          ].slice(0, CARD_SLOTS.length)
          const next = [...current]
          next.splice(
            corridorWindowStartRef.current,
            currentWindow.length,
            ...nextWindow,
          )
          spatialOrderIdsRef.current = next
          return next
        })
      } else {
        setLayoutSelectedId(selectedId)
      }
    } else {
      setSelectedId(selectionTransition.resultId)
    }
    selectionLockRef.current = false
    setSelectionTransition(null)
  }, [
    active,
    corridorResults,
    isSearching,
    selectedId,
    selectionTransition,
    showResults,
    spatialResults,
    suspended,
  ])

  useLayoutEffect(() => {
    if (
      DISCOVERY_RESULT_CORRIDOR_ENABLED ||
      !selectionTransition
    ) {
      return
    }

    const {
      resultId,
      fromSlotIndex,
      fromOrderIds,
      toOrderIds,
      sequence,
    } = selectionTransition
    const targetCard = resultCardRefs.current.get(resultId)
    const sourceSlot = CARD_SLOTS[fromSlotIndex]
    if (
      !targetCard ||
      !sourceSlot ||
      typeof targetCard.animate !== 'function'
    ) {
      return
    }

    selectionAnimationsRef.current.forEach((animation) => {
      animation.onfinish = null
      animation.cancel()
    })

    const targetAnimation = targetCard.animate(
      createDiscoverySelectionKeyframes(sourceSlot),
      {
        duration: DISCOVERY_CARD_SWITCH_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both',
      },
    )
    const animations: Animation[] = [targetAnimation]

    fromOrderIds.forEach((cardId, sourceSlotIndex) => {
      const destinationSlotIndex = toOrderIds.indexOf(cardId)
      if (
        cardId === resultId ||
        destinationSlotIndex < 0 ||
        destinationSlotIndex === sourceSlotIndex
      ) {
        return
      }
      const card = resultCardRefs.current.get(cardId)
      const cardSourceSlot = CARD_SLOTS[sourceSlotIndex]
      const destinationSlot = CARD_SLOTS[destinationSlotIndex]
      if (
        !card ||
        !cardSourceSlot ||
        !destinationSlot ||
        typeof card.animate !== 'function'
      ) {
        return
      }

      const animation = card.animate(
        createDiscoveryReflowKeyframes(
          cardSourceSlot,
          destinationSlot,
          sourceSlotIndex === 0,
        ),
        {
          delay: DISCOVERY_CARD_REFLOW_DELAY_MS,
          duration: DISCOVERY_CARD_REFLOW_MS,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'both',
        },
      )
      animations.push(animation)
    })

    const sharedStartTime = document.timeline.currentTime
    if (sharedStartTime !== null) {
      animations.forEach((animation) => {
        animation.startTime = sharedStartTime
      })
    }
    selectionAnimationsRef.current = animations

    targetAnimation.onfinish = () => {
      if (
        selectionAnimationsRef.current !== animations ||
        selectionSequenceRef.current !== sequence
      ) {
        return
      }

      targetAnimation.onfinish = null
      selectionAnimationsRef.current = []
      selectionSequenceRef.current += 1
      if (selectionTimerRef.current !== null) {
        window.clearTimeout(selectionTimerRef.current)
        selectionTimerRef.current = null
      }
      selectionLockRef.current = false
      setSelectedId(resultId)
      setSelectionTransition((current) =>
        current?.sequence === sequence ? null : current,
      )
    }

    return () => {
      targetAnimation.onfinish = null
      if (selectionAnimationsRef.current === animations) {
        selectionAnimationsRef.current = []
      }
      animations.forEach((animation) => animation.cancel())
    }
  }, [selectionTransition])

  useLayoutEffect(() => {
    if (
      DISCOVERY_RESULT_CORRIDOR_ENABLED ||
      !snakeTransition
    ) {
      return
    }

    const {
      direction,
      fromOrderIds,
      toOrderIds,
      toWindowStart,
      renderedOrderIds,
      sequence,
    } = snakeTransition
    const frontExit = interpolateCorridorLayout(
      -DISCOVERY_CORRIDOR_GUARD_DISTANCE,
    )
    const rearEntry = interpolateCorridorLayout(
      CARD_SLOTS.length - 1 + DISCOVERY_CORRIDOR_GUARD_DISTANCE,
    )
    const animations: Animation[] = []
    let invalid = false

    snakeAnimationsRef.current.forEach((animation) => {
      animation.onfinish = null
      animation.cancel()
    })
    snakeAnimationsRef.current = []

    const finish = () => {
      if (
        snakeSequenceRef.current !== sequence ||
        !snakeLockRef.current
      ) {
        return
      }

      animations.forEach((animation) => {
        animation.onfinish = null
      })
      snakeAnimationsRef.current = []
      if (snakeFallbackTimerRef.current !== null) {
        window.clearTimeout(snakeFallbackTimerRef.current)
        snakeFallbackTimerRef.current = null
      }
      snakeSequenceRef.current += 1
      snakeLockRef.current = false
      corridorWindowStartRef.current = toWindowStart
      corridorPositionRef.current = toWindowStart

      const nextFrontId = toOrderIds[0]
      const nextReflectionResults = toOrderIds
        .map((id) => resultById.get(id))
        .filter((result): result is DiscoveryResult => result !== undefined)
      reflectionResultsRef.current = nextReflectionResults
      setCorridorWindowStart(toWindowStart)
      const pendingDirection = Math.sign(
        pendingSnakeStepsRef.current,
      ) as DiscoverySnakeDirection | 0
      const maximumWindowStart = getDiscoveryMaximumWindowStart(
        spatialOrderIdsRef.current.length,
      )
      const canContinue =
        pendingDirection !== 0 &&
        toWindowStart + pendingDirection >= 0 &&
        toWindowStart + pendingDirection <= maximumWindowStart

      if (canContinue) {
        setSnakeTransition((current) =>
          current?.sequence === sequence ? null : current,
        )
        queueMicrotask(() => {
          consumePendingSnakeStepRef.current()
        })
        return
      }

      if (pendingDirection !== 0) pendingSnakeStepsRef.current = 0
      if (nextFrontId) {
        setLayoutSelectedId(nextFrontId)
        setSelectedId(nextFrontId)
      }
      setDetailTab('info')
      setOperationStatus('')
      setSnakeTransition((current) =>
        current?.sequence === sequence ? null : current,
      )
      const settleSequence = snakeSequenceRef.current
      snakeSettleRafRef.current = window.requestAnimationFrame(() => {
        snakeSettleRafRef.current = null
        if (
          snakeSequenceRef.current !== settleSequence ||
          snakeLockRef.current
        ) {
          return
        }
        corridorMovingRef.current = false
        corridorCardsRef.current?.classList.remove('isCorridorMoving')
        setIsCorridorMoving(false)
      })
    }

    renderedOrderIds.forEach((cardId) => {
      const card = resultCardRefs.current.get(cardId)
      const fromSlotIndex = fromOrderIds.indexOf(cardId)
      const toSlotIndex = toOrderIds.indexOf(cardId)
      const sourceSlot =
        fromSlotIndex >= 0
          ? CARD_SLOTS[fromSlotIndex]
          : direction > 0
            ? rearEntry
            : frontExit
      const destinationSlot =
        toSlotIndex >= 0
          ? CARD_SLOTS[toSlotIndex]
          : direction > 0
            ? frontExit
            : rearEntry
      const sourcePosition =
        fromSlotIndex >= 0
          ? fromSlotIndex
          : direction > 0
            ? CARD_SLOTS.length -
              1 +
              DISCOVERY_CORRIDOR_GUARD_DISTANCE
            : -DISCOVERY_CORRIDOR_GUARD_DISTANCE
      const destinationPosition =
        toSlotIndex >= 0
          ? toSlotIndex
          : direction > 0
            ? -DISCOVERY_CORRIDOR_GUARD_DISTANCE
            : CARD_SLOTS.length -
              1 +
              DISCOVERY_CORRIDOR_GUARD_DISTANCE

      if (
        !card ||
        typeof card.animate !== 'function' ||
        !sourceSlot ||
        !destinationSlot
      ) {
        invalid = true
        return
      }

      const outerAnimation = card.animate(
        createDiscoverySnakeMotionKeyframes(
          sourcePosition,
          destinationPosition,
          fromSlotIndex === 0,
          toSlotIndex === 0,
        ),
        {
          duration: DISCOVERY_SNAKE_STEP_MS,
          easing: DISCOVERY_SNAKE_STEP_EASING,
          fill: 'both',
        },
      )
      animations.push(outerAnimation)

      const media = card.querySelector<HTMLElement>(
        '.discoveryResultMedia',
      )
      if (media && typeof media.animate === 'function') {
        animations.push(
          media.animate(
            createDiscoveryMaterialKeyframes(
              sourceSlot,
              destinationSlot,
            ),
            {
              duration: DISCOVERY_SNAKE_STEP_MS,
              easing: DISCOVERY_SNAKE_STEP_EASING,
              fill: 'both',
            },
          ),
        )
      }

      if (sourceSlot.opacity !== destinationSlot.opacity) {
        const motion = card.querySelector<HTMLElement>(
          '.discoveryResultMotion',
        )
        if (motion && typeof motion.animate === 'function') {
          animations.push(
            motion.animate(
              [
                { opacity: sourceSlot.opacity },
                { opacity: destinationSlot.opacity },
              ],
              {
                duration: DISCOVERY_SNAKE_STEP_MS,
                easing: DISCOVERY_SNAKE_STEP_EASING,
                fill: 'both',
              },
            ),
          )
        }
      }
    })

    if (invalid || animations.length === 0) {
      queueMicrotask(finish)
      return
    }

    const sharedStartTime = document.timeline.currentTime
    if (sharedStartTime !== null) {
      animations.forEach((animation) => {
        animation.startTime = sharedStartTime
      })
    }
    snakeAnimationsRef.current = animations
    animations[0].onfinish = finish
    snakeFallbackTimerRef.current = window.setTimeout(
      finish,
      DISCOVERY_SNAKE_STEP_FALLBACK_MS,
    )

    return () => {
      animations.forEach((animation) => {
        animation.onfinish = null
        animation.cancel()
      })
      if (snakeFallbackTimerRef.current !== null) {
        window.clearTimeout(snakeFallbackTimerRef.current)
        snakeFallbackTimerRef.current = null
      }
      if (snakeAnimationsRef.current === animations) {
        snakeAnimationsRef.current = []
      }
    }
  }, [resultById, snakeTransition])

  useLayoutEffect(() => {
    const glassLayer = projectedGlassLayerRef.current
    if (!glassLayer) return

    const detailGlass = glassLayer.querySelector<HTMLElement>(
      '.discoveryDetailProjectedGlass',
    )
    if (!resultsMounted || !selectedResult) {
      glassLayer.dataset.glassCacheValid = 'false'
      glassLayer.dataset.geometryCacheValid = 'false'
      if (detailGlass) detailGlass.style.visibility = 'hidden'
      return
    }

    const detailPanel = detailPanelRef.current
    if (!detailPanel || !detailGlass) return

    const cacheValid =
      projectedGlassSignatureRef.current === projectedGlassGeometrySignature
    const geometryCacheValid =
      cacheValid &&
      projectedGlassSyncSignatureRef.current ===
        projectedGlassSyncSignature
    glassLayer.dataset.glassCacheValid = String(cacheValid)
    glassLayer.dataset.geometrySourceRevision =
      projectedGlassSyncSignature
    glassLayer.dataset.geometryCacheValid = String(geometryCacheValid)
    if (!active || suspended) return
    if (geometryCacheValid) {
      glassLayer.dataset.geometryReused = 'true'
      glassPreparedRevisionRef.current = stagedRevision
      return
    }

    let frame: number | undefined
    let sampledFrames = 0
    let syncedAtLeastOnce = false
    const maxFrames = isCameraDragging ? 2 : 24
    projectedGlassSyncCountRef.current += 1
    glassLayer.dataset.geometryReused = 'false'
    glassLayer.dataset.geometrySyncCount = String(
      projectedGlassSyncCountRef.current,
    )

    const syncDetailGlass = () => {
      const layerRect = glassLayer.getBoundingClientRect()
      const cornerRadius =
        detailPanel.offsetWidth * DETAIL_PANEL_CORNER_RADIUS_RATIO
      const synced = syncProjectedGlass(
        detailGlass,
        Array.from(
          detailPanel.querySelectorAll<HTMLElement>(
            '.discoveryDetailGlassAnchor',
          ),
        ),
        layerRect,
        1,
        [cornerRadius, cornerRadius, cornerRadius, cornerRadius],
      )

      if (synced) {
        syncedAtLeastOnce = true
        projectedGlassSignatureRef.current =
          projectedGlassGeometrySignature
        glassLayer.dataset.glassCacheValid = 'true'
      }

      sampledFrames += 1
      if (sampledFrames < maxFrames) {
        frame = window.requestAnimationFrame(syncDetailGlass)
      } else if (
        syncedAtLeastOnce &&
        projectedGlassSignatureRef.current ===
        projectedGlassGeometrySignature
      ) {
        projectedGlassSyncSignatureRef.current =
          projectedGlassSyncSignature
        glassLayer.dataset.geometryPreparedRevision =
          projectedGlassSyncSignature
        glassLayer.dataset.geometryCacheValid = 'true'
        glassPreparedRevisionRef.current = stagedRevision
      } else {
        glassLayer.dataset.geometryCacheValid = 'false'
        glassLayer.dataset.geometryPreparedRevision = stagedRevision
        glassPreparedRevisionRef.current = stagedRevision
      }
    }

    syncDetailGlass()
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [
    active,
    isCameraDragging,
    projectedGlassGeometrySignature,
    projectedGlassSyncSignature,
    resultsMounted,
    selectedResult,
    stagedRevision,
    suspended,
  ])

  const stopPreviewAndClearStatus = () => {
    setDetailTab('info')
    setOperationStatus('')
  }

  const clearHoverExitTimer = () => {
    if (hoverExitTimerRef.current === null) return
    window.clearTimeout(hoverExitTimerRef.current)
    hoverExitTimerRef.current = null
  }

  const cancelSelectionTimer = () => {
    selectionSequenceRef.current += 1
    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current)
      selectionTimerRef.current = null
    }
    selectionAnimationsRef.current.forEach((animation) => {
      animation.onfinish = null
      animation.cancel()
    })
    selectionAnimationsRef.current = []
  }

  const finishSelectionBeforeContextChange = () => {
    cancelSelectionTimer()
    selectionLockRef.current = false
    if (!selectionTransition) return

    setSelectedId(selectionTransition.resultId)
    setSelectionTransition(null)
  }

  const cancelCorridorPreview = () => {
    if (corridorPreviewRafRef.current === null) return
    window.cancelAnimationFrame(corridorPreviewRafRef.current)
    corridorPreviewRafRef.current = null
  }

  const cancelCorridorAnimation = () => {
    corridorAnimationSequenceRef.current += 1
    cancelCorridorPreview()
    if (corridorAnimationRafRef.current !== null) {
      window.cancelAnimationFrame(corridorAnimationRafRef.current)
      corridorAnimationRafRef.current = null
    }
  }

  const setCorridorMotionActive = (moving: boolean) => {
    corridorMovingRef.current = moving
    corridorCardsRef.current?.classList.toggle(
      'isCorridorMoving',
      moving,
    )
    setIsCorridorMoving(moving)
    if (!moving) return
    clearHoverExitTimer()
    setHoveredId(null)
  }

  const resetResultPointerDrag = () => {
    const pointerState = resultPointerDragRef.current
    const wasDragging = pointerState.dragging
    const pointerId = pointerState.pointerId
    const view = discoveryViewRef.current
    if (pointerState.active && pointerId >= 0 && view) {
      try {
        if (view.hasPointerCapture(pointerId)) {
          view.releasePointerCapture(pointerId)
        }
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
    pointerState.active = false
    pointerState.dragging = false
    pointerState.pointerId = -1
    pointerState.axis = null
    setIsResultPointerDragging(false)
    if (resultPointerClickResetTimerRef.current !== null) {
      window.clearTimeout(resultPointerClickResetTimerRef.current)
      resultPointerClickResetTimerRef.current = null
    }
    if (wasDragging) suppressNextResultClickRef.current = false
  }

  const applyCorridorPosition = (position: number) => {
    const orderedIds = spatialOrderIdsRef.current
    const maximumPosition = getDiscoveryMaximumWindowStart(
      orderedIds.length,
    )
    const clampedPosition = Math.max(
      0,
      Math.min(maximumPosition, position),
    )
    corridorPositionRef.current = clampedPosition
    const nextWindowStart = Math.max(
      0,
      Math.min(maximumPosition, Math.round(clampedPosition)),
    )

    orderedIds.forEach((resultId, resultIndex) => {
      const element = resultCardRefs.current.get(resultId)
      if (!element) return
      writeDiscoveryCorridorPose(
        element,
        getDiscoveryCorridorPose(resultIndex, clampedPosition),
        corridorMovingRef.current,
      )
    })

    if (corridorWindowStartRef.current !== nextWindowStart) {
      corridorWindowStartRef.current = nextWindowStart
      setCorridorWindowStart(nextWindowStart)
    }
    window.dispatchEvent(new Event(DISCOVERY_REFLECTION_MOTION_EVENT))
  }

  const scheduleCorridorPosition = (position: number) => {
    corridorPositionRef.current = position
    if (corridorPositionRafRef.current !== null) return
    corridorPositionRafRef.current = window.requestAnimationFrame(() => {
      corridorPositionRafRef.current = null
      applyCorridorPosition(corridorPositionRef.current)
    })
  }

  const commitCorridorPosition = (position: number) => {
    const orderedIds = spatialOrderIdsRef.current
    const maximumPosition = getDiscoveryMaximumWindowStart(
      orderedIds.length,
    )
    const settledIndex = Math.max(
      0,
      Math.min(maximumPosition, Math.round(position)),
    )
    const settledId = orderedIds[settledIndex]
    applyCorridorPosition(settledIndex)
    corridorPositionRef.current = settledIndex
    corridorWindowStartRef.current = settledIndex
    setCorridorWindowStart(settledIndex)
    if (settledId) {
      setLayoutSelectedId(settledId)
      setSelectedId(settledId)
    }
    reflectionResultsRef.current = orderedIds
      .slice(settledIndex, settledIndex + CARD_SLOTS.length)
      .map((id) => resultById.get(id))
      .filter((result): result is DiscoveryResult => result !== undefined)
    setDetailTab('info')
    setOperationStatus('')

    if (corridorSettleRafRef.current !== null) {
      window.cancelAnimationFrame(corridorSettleRafRef.current)
    }
    const settleSequence = corridorAnimationSequenceRef.current
    corridorSettleRafRef.current = window.requestAnimationFrame(() => {
      corridorSettleRafRef.current = null
      if (
        corridorAnimationSequenceRef.current !== settleSequence ||
        corridorWheelStateRef.current.active ||
        corridorAnimationRafRef.current !== null
      ) {
        return
      }
      resultCardRefs.current.forEach((element) => {
        clearDiscoveryCorridorPose(element)
      })
      setCorridorMotionActive(false)
      window.dispatchEvent(new Event(DISCOVERY_REFLECTION_MOTION_EVENT))
    })
  }

  const animateCorridorTo = (
    requestedTarget: number,
    initialVelocity = 0,
    source: 'wheel' | 'click' = 'wheel',
  ) => {
    cancelCorridorAnimation()
    if (corridorPositionRafRef.current !== null) {
      window.cancelAnimationFrame(corridorPositionRafRef.current)
      corridorPositionRafRef.current = null
      applyCorridorPosition(corridorPositionRef.current)
    }
    const maximumPosition = getDiscoveryMaximumWindowStart(
      spatialOrderIdsRef.current.length,
    )
    const target = Math.max(
      0,
      Math.min(maximumPosition, Math.round(requestedTarget)),
    )
    const start = corridorPositionRef.current
    const delta = target - start
    const distance = Math.abs(delta)
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (distance < 0.0005 || prefersReducedMotion) {
      commitCorridorPosition(target)
      return
    }

    setCorridorMotionActive(true)
    const minimumDuration =
      source === 'click'
        ? DISCOVERY_CORRIDOR_CLICK_MIN_MS
        : DISCOVERY_CORRIDOR_WHEEL_MIN_MS
    const maximumDuration =
      source === 'click'
        ? DISCOVERY_CORRIDOR_CLICK_MAX_MS
        : DISCOVERY_CORRIDOR_WHEEL_MAX_MS
    const duration = Math.min(
      maximumDuration,
      minimumDuration + distance * (source === 'click' ? 42 : 68),
    )
    const tangent =
      Math.sign(initialVelocity) === Math.sign(delta)
        ? Math.max(
            -distance * 1.2,
            Math.min(distance * 1.2, initialVelocity * duration),
          )
        : 0
    const sequence = corridorAnimationSequenceRef.current
    const startedAt = performance.now()

    const animate = (now: number) => {
      if (corridorAnimationSequenceRef.current !== sequence) return
      const progress = clampUnit((now - startedAt) / duration)
      const progress2 = progress * progress
      const progress3 = progress2 * progress
      const h00 = 2 * progress3 - 3 * progress2 + 1
      const h10 = progress3 - 2 * progress2 + progress
      const h01 = -2 * progress3 + 3 * progress2
      const sampledPosition =
        h00 * start + h10 * tangent + h01 * target
      const boundedPosition =
        delta > 0
          ? Math.min(target, Math.max(start, sampledPosition))
          : Math.max(target, Math.min(start, sampledPosition))
      applyCorridorPosition(boundedPosition)

      if (progress >= 1) {
        corridorAnimationRafRef.current = null
        commitCorridorPosition(target)
        return
      }
      corridorAnimationRafRef.current =
        window.requestAnimationFrame(animate)
    }

    corridorAnimationRafRef.current =
      window.requestAnimationFrame(animate)
  }

  useLayoutEffect(() => {
    if (
      !isCorridorMoving ||
      snakeTransition !== null ||
      selectionTransition !== null
    ) {
      return
    }
    applyCorridorPosition(corridorPositionRef.current)
  }, [
    corridorWindowStart,
    isCorridorMoving,
    selectionTransition,
    snakeTransition,
  ])

  const resetCorridorForContextChange = () => {
    resetResultPointerDrag()
    finishSelectionBeforeContextChange()
    cancelCorridorAnimation()
    snakeSequenceRef.current += 1
    snakeLockRef.current = false
    pendingSnakeStepsRef.current = 0
    if (snakeSettleRafRef.current !== null) {
      window.cancelAnimationFrame(snakeSettleRafRef.current)
      snakeSettleRafRef.current = null
    }
    snakeAnimationsRef.current.forEach((animation) => {
      animation.onfinish = null
      animation.cancel()
    })
    snakeAnimationsRef.current = []
    if (snakeFallbackTimerRef.current !== null) {
      window.clearTimeout(snakeFallbackTimerRef.current)
      snakeFallbackTimerRef.current = null
    }
    if (snakeWheelReleaseTimerRef.current !== null) {
      window.clearTimeout(snakeWheelReleaseTimerRef.current)
      snakeWheelReleaseTimerRef.current = null
    }
    snakeWheelStateRef.current.active = false
    snakeWheelStateRef.current.axis = null
    snakeWheelStateRef.current.accumulator = 0
    snakeWheelStateRef.current.accumulatorAxis = null
    snakeWheelStateRef.current.lastSampleTime = 0
    if (corridorPositionRafRef.current !== null) {
      window.cancelAnimationFrame(corridorPositionRafRef.current)
      corridorPositionRafRef.current = null
    }
    if (corridorSettleRafRef.current !== null) {
      window.cancelAnimationFrame(corridorSettleRafRef.current)
      corridorSettleRafRef.current = null
    }
    if (corridorWheelReleaseTimerRef.current !== null) {
      window.clearTimeout(corridorWheelReleaseTimerRef.current)
      corridorWheelReleaseTimerRef.current = null
    }
    const wheelState = corridorWheelStateRef.current
    wheelState.active = false
    wheelState.axis = null
    wheelState.snapAnchor = 0
    wheelState.rawPosition = 0
    wheelState.previewStartPosition = 0
    wheelState.snapTarget = 0
    wheelState.lastTime = 0
    wheelState.velocity = 0
    wheelState.hasVelocity = false
    corridorPositionRef.current = 0
    corridorWindowStartRef.current = 0
    setCorridorWindowStart(0)
    setSnakeTransition(null)
    resultCardRefs.current.forEach((element) => {
      clearDiscoveryCorridorPose(element)
    })
    setCorridorMotionActive(false)
  }

  const scheduleCorridorPreview = () => {
    if (corridorPreviewRafRef.current !== null) return

    const preview = (now: number) => {
      const wheelState = corridorWheelStateRef.current
      if (!wheelState.active) {
        corridorPreviewRafRef.current = null
        return
      }
      const idleDuration = Math.max(0, now - wheelState.lastTime)
      if (idleDuration >= WHEEL_DRAG_END_DELAY) {
        corridorPreviewRafRef.current = null
        return
      }
      scheduleCorridorPosition(
        resolveWheelDragPreviewPosition(
          wheelState.previewStartPosition,
          wheelState.snapTarget,
          idleDuration,
        ),
      )
      corridorPreviewRafRef.current =
        window.requestAnimationFrame(preview)
    }

    corridorPreviewRafRef.current =
      window.requestAnimationFrame(preview)
  }

  const finishCorridorWheel = () => {
    const wheelState = corridorWheelStateRef.current
    if (!wheelState.active) return
    wheelState.active = false
    corridorWheelReleaseTimerRef.current = null
    cancelCorridorPreview()
    const maximumPosition = getDiscoveryMaximumWindowStart(
      spatialOrderIdsRef.current.length,
    )
    const snapTarget = Math.max(
      0,
      Math.min(maximumPosition, wheelState.snapTarget),
    )
    const releaseVelocity = wheelState.hasVelocity
      ? wheelState.velocity
      : 0
    wheelState.axis = null
    wheelState.hasVelocity = false
    pendingSnakeStepsRef.current = 0
    snakeWheelStateRef.current.accumulator = 0
    animateCorridorTo(snapTarget, releaseVelocity, 'wheel')
  }

  const handleResultCorridorWheel = (
    event: ReactWheelEvent<HTMLElement>,
  ) => {
    if (
      event.ctrlKey ||
      spatialOrderIdsRef.current.length <= 1 ||
      isSearching ||
      isCameraDragging ||
      snakeLockRef.current ||
      snakeTransition !== null ||
      selectionLockRef.current ||
      selectionTransition !== null ||
      !active ||
      suspended
    ) {
      return
    }

    const wheelState = corridorWheelStateRef.current
    const startedInsideResults =
      event.target instanceof Element &&
      event.target.closest('.discoveryResultCard') !== null
    if (!wheelState.active && !startedInsideResults) return
    const sample = readWheelDragSample(
      event,
      event.currentTarget.clientWidth,
      wheelState.active ? wheelState.axis : null,
    )
    if (!sample || (!wheelState.active && !sample.moves)) return
    const trackpadDelta = sample.delta

    const now = performance.now()
    if (!wheelState.active) {
      cancelCorridorAnimation()
      if (corridorSettleRafRef.current !== null) {
        window.cancelAnimationFrame(corridorSettleRafRef.current)
        corridorSettleRafRef.current = null
      }
      wheelState.active = true
      wheelState.axis = sample.axis
      wheelState.snapAnchor = Math.round(corridorPositionRef.current)
      wheelState.rawPosition = corridorPositionRef.current
      wheelState.previewStartPosition = corridorPositionRef.current
      wheelState.snapTarget = wheelState.snapAnchor
      wheelState.lastTime = now
      wheelState.velocity = 0
      wheelState.hasVelocity = false
      setCorridorMotionActive(true)
      stopPreviewAndClearStatus()
    } else if (sample.moves) {
      const elapsed = Math.max(8, now - wheelState.lastTime)
      const instantVelocity =
        trackpadDelta / DISCOVERY_SNAKE_WHEEL_THRESHOLD / elapsed
      wheelState.velocity = wheelState.hasVelocity
        ? wheelState.velocity * 0.68 + instantVelocity * 0.32
        : instantVelocity
      wheelState.hasVelocity = true
      wheelState.lastTime = now
    }

    event.preventDefault()
    event.stopPropagation()
    if (sample.moves) {
      const maximumPosition = getDiscoveryMaximumWindowStart(
        spatialOrderIdsRef.current.length,
      )
      const previousRawPosition = wheelState.rawPosition
      const positionDelta =
        trackpadDelta / DISCOVERY_SNAKE_WHEEL_THRESHOLD
      wheelState.rawPosition = Math.max(
        0,
        Math.min(
          maximumPosition,
          wheelState.rawPosition + positionDelta,
        ),
      )
      if (wheelState.rawPosition === previousRawPosition) {
        wheelState.velocity = 0
        wheelState.hasVelocity = false
      }
      const visualPosition =
        wheelState.rawPosition === previousRawPosition
          ? wheelState.rawPosition
          : Math.max(
              0,
              Math.min(
                maximumPosition,
                corridorPositionRef.current + positionDelta,
              ),
            )
      wheelState.previewStartPosition = visualPosition
      wheelState.snapTarget = resolveTrackpadSnapTarget(
        wheelState.snapAnchor,
        wheelState.rawPosition,
        0,
        maximumPosition,
      )
      scheduleCorridorPosition(visualPosition)
      scheduleCorridorPreview()
    }

    if (corridorWheelReleaseTimerRef.current !== null) {
      window.clearTimeout(corridorWheelReleaseTimerRef.current)
    }
    corridorWheelReleaseTimerRef.current = window.setTimeout(
      finishCorridorWheel,
      WHEEL_DRAG_END_DELAY,
    )
  }

  const startDiscoverySnakeStep = (
    direction: DiscoverySnakeDirection,
  ) => {
    if (
      DISCOVERY_RESULT_CORRIDOR_ENABLED ||
      snakeLockRef.current ||
      selectionLockRef.current ||
      selectionTransition !== null
    ) {
      return
    }

    const orderedIds = spatialOrderIdsRef.current
    const maximumWindowStart = getDiscoveryMaximumWindowStart(
      orderedIds.length,
    )
    const fromWindowStart = Math.max(
      0,
      Math.min(maximumWindowStart, corridorWindowStartRef.current),
    )
    const toWindowStart = Math.max(
      0,
      Math.min(maximumWindowStart, fromWindowStart + direction),
    )
    if (toWindowStart === fromWindowStart) {
      if (Math.sign(pendingSnakeStepsRef.current) === direction) {
        pendingSnakeStepsRef.current = 0
      }
      return
    }

    const fromOrderIds = orderedIds.slice(
      fromWindowStart,
      fromWindowStart + CARD_SLOTS.length,
    )
    const toOrderIds = orderedIds.slice(
      toWindowStart,
      toWindowStart + CARD_SLOTS.length,
    )
    if (fromOrderIds.length === 0 || toOrderIds.length === 0) {
      return
    }

    const renderedOrderIds = orderedIds.slice(
      Math.min(fromWindowStart, toWindowStart),
      Math.max(fromWindowStart, toWindowStart) + CARD_SLOTS.length,
    )
    const nextFrontId = toOrderIds[0]
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (snakeSettleRafRef.current !== null) {
      window.cancelAnimationFrame(snakeSettleRafRef.current)
      snakeSettleRafRef.current = null
    }

    clearHoverExitTimer()
    setHoveredId(null)
    stopPreviewAndClearStatus()

    if (prefersReducedMotion) {
      corridorWindowStartRef.current = toWindowStart
      corridorPositionRef.current = toWindowStart
      setCorridorWindowStart(toWindowStart)
      if (nextFrontId) {
        setLayoutSelectedId(nextFrontId)
        setSelectedId(nextFrontId)
      }
      reflectionResultsRef.current = toOrderIds
        .map((id) => resultById.get(id))
        .filter((result): result is DiscoveryResult => result !== undefined)
      setDetailTab('info')
      setOperationStatus('')
      window.requestAnimationFrame(() => {
        consumePendingSnakeStepRef.current()
      })
      return
    }

    const sequence = snakeSequenceRef.current
    snakeLockRef.current = true
    setCorridorMotionActive(true)
    setSnakeTransition({
      direction,
      fromWindowStart,
      toWindowStart,
      fromOrderIds,
      toOrderIds,
      renderedOrderIds,
      sequence,
    })
  }
  startSnakeStepRef.current = startDiscoverySnakeStep

  const queueDiscoverySnakeStep = (
    direction: DiscoverySnakeDirection,
  ) => {
    if (
      selectionLockRef.current ||
      selectionTransition !== null
    ) {
      return
    }
    if (!snakeLockRef.current) {
      startSnakeStepRef.current(direction)
      return
    }

    pendingSnakeStepsRef.current = Math.max(
      -DISCOVERY_SNAKE_MAX_PENDING_STEPS,
      Math.min(
        DISCOVERY_SNAKE_MAX_PENDING_STEPS,
        pendingSnakeStepsRef.current + direction,
      ),
    )
  }

  consumePendingSnakeStepRef.current = () => {
    if (
      snakeLockRef.current ||
      selectionLockRef.current ||
      pendingSnakeStepsRef.current === 0
    ) {
      return
    }
    const direction = Math.sign(
      pendingSnakeStepsRef.current,
    ) as DiscoverySnakeDirection
    pendingSnakeStepsRef.current -= direction
    startSnakeStepRef.current(direction)
  }

  const finishDiscoverySnakeWheelGesture = () => {
    const wheelState = snakeWheelStateRef.current
    wheelState.active = false
    wheelState.axis = null
    snakeWheelReleaseTimerRef.current = null
  }

  const handleDiscoverySnakeWheel = (
    event: ReactWheelEvent<HTMLElement>,
  ) => {
    if (
      DISCOVERY_RESULT_CORRIDOR_ENABLED ||
      event.ctrlKey ||
      spatialOrderIdsRef.current.length <= 1 ||
      isSearching ||
      isCameraDragging ||
      corridorWheelStateRef.current.active ||
      corridorAnimationRafRef.current !== null ||
      corridorSettleRafRef.current !== null ||
      selectionLockRef.current ||
      selectionTransition !== null ||
      !active ||
      suspended
    ) {
      return
    }

    const wheelState = snakeWheelStateRef.current
    const startedInsideResults =
      event.target instanceof Element &&
      event.target.closest('.discoveryResultCard') !== null
    if (!wheelState.active && !startedInsideResults) return

    const sample = readWheelDragSample(
      event,
      event.currentTarget.clientWidth,
      wheelState.active ? wheelState.axis : null,
    )
    if (!sample || (!wheelState.active && !sample.moves)) return

    const now = performance.now()
    if (!wheelState.active) {
      if (
        now - wheelState.lastSampleTime >
          DISCOVERY_SNAKE_ACCUMULATOR_IDLE_MS ||
        (
          wheelState.accumulatorAxis !== null &&
          wheelState.accumulatorAxis !== sample.axis
        )
      ) {
        wheelState.accumulator = 0
      }
      wheelState.active = true
      wheelState.axis = sample.axis
    }
    wheelState.accumulatorAxis = sample.axis
    wheelState.lastSampleTime = now

    event.preventDefault()
    event.stopPropagation()
    if (sample.moves) {
      if (event.deltaMode !== 0) {
        const direction = Math.sign(
          sample.delta,
        ) as DiscoverySnakeDirection
        wheelState.accumulator = 0
        queueDiscoverySnakeStep(direction)
      } else {
        wheelState.accumulator += sample.delta
        let emittedSteps = 0
        while (
          Math.abs(wheelState.accumulator) >=
            DISCOVERY_SNAKE_WHEEL_THRESHOLD &&
          emittedSteps < DISCOVERY_SNAKE_MAX_PENDING_STEPS
        ) {
          const direction = Math.sign(
            wheelState.accumulator,
          ) as DiscoverySnakeDirection
          wheelState.accumulator -=
            direction * DISCOVERY_SNAKE_WHEEL_THRESHOLD
          queueDiscoverySnakeStep(direction)
          emittedSteps += 1
        }
      }
    }

    if (snakeWheelReleaseTimerRef.current !== null) {
      window.clearTimeout(snakeWheelReleaseTimerRef.current)
    }
    snakeWheelReleaseTimerRef.current = window.setTimeout(
      finishDiscoverySnakeWheelGesture,
      WHEEL_DRAG_END_DELAY,
    )
  }

  const handleDiscoveryResultWheel = (
    event: ReactWheelEvent<HTMLElement>,
  ) => {
    if (event.deltaMode === 0) {
      handleResultCorridorWheel(event)
      return
    }
    handleDiscoverySnakeWheel(event)
  }

  const handleResultPointerEnter = (
    event: ReactPointerEvent<HTMLButtonElement>,
    resultId: string,
  ) => {
    if (event.pointerType === 'touch' || !canPreviewResults) return
    clearHoverExitTimer()
    setHoveredId(resultId)
  }

  const scheduleResultHoverExit = (resultId: string) => {
    clearHoverExitTimer()
    hoverExitTimerRef.current = window.setTimeout(() => {
      hoverExitTimerRef.current = null
      setHoveredId((current) => current === resultId ? null : current)
    }, DISCOVERY_HOVER_EXIT_DELAY_MS)
  }

  const requestOnlineSearchPage = ({
    provider,
    ...request
  }: DiscoveryOnlineSearchRequest): Promise<DiscoveryOnlineSearchPage> => {
    let pageRequest: Promise<DiscoveryOnlineSearchPage>
    if (onOnlineSearch) {
      pageRequest = Promise.resolve().then(() =>
        onOnlineSearch({ provider, ...request }),
      )
    } else if (provider === 'bilibili' && onBilibiliSearch) {
      pageRequest = Promise.resolve().then(() => onBilibiliSearch(request))
    } else if (provider === 'tencent' && onTencentSearch) {
      pageRequest = Promise.resolve().then(() => onTencentSearch(request))
    } else {
      pageRequest = Promise.reject(
        new Error(`${getOnlineProviderLabel(provider)} 搜索未接入`),
      )
    }
    if (provider !== 'douyin') return pageRequest

    return new Promise<DiscoveryOnlineSearchPage>((resolve, reject) => {
      let settled = false
      const finish = (
        settle: () => void,
      ) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        settle()
      }
      const timeout = window.setTimeout(() => {
        finish(() => reject(new Error('Douyin pagination request timed out')))
      }, DOUYIN_DISCOVERY_PAGE_REQUEST_TIMEOUT_MS)
      pageRequest.then(
        (page) => finish(() => resolve(page)),
        (error) => finish(() => reject(error)),
      )
    })
  }

  const executeDiscoverySearch = async ({
    query,
    source = sourceFilter,
    kind = kindFilter,
    resolution = resolutionFilter,
    onlineSearchType = providerSearchType,
  }: {
    query: string
    source?: DiscoverySourceFilter
    kind?: DiscoveryKindFilter
    resolution?: DiscoveryResolutionFilter
    onlineSearchType?: OnlineProviderSearchType
  }) => {
    clearOnlinePaginationRecovery()
    const sequence = searchSequenceRef.current + 1
    searchSequenceRef.current = sequence
    const initialPaginationByProvider = createOnlinePaginationState()
    enabledProviderList.forEach((provider) => {
      const searchType = source === provider
        ? normalizeOnlineProviderSearchType(provider, onlineSearchType)
        : null
      initialPaginationByProvider[provider] = {
        ...EMPTY_ONLINE_PAGINATION,
        searchSequence: sequence,
        query,
        searchType,
      }
    })
    onlinePaginationRef.current = initialPaginationByProvider
    setOnlinePaginationByProvider(initialPaginationByProvider)
    ignoreTransientOnlineResultsUntilRef.current = 0
    const startedAt = performance.now()
    clearHoverExitTimer()
    resetCorridorForContextChange()
    setHoveredId(null)
    setCommittedQuery(query)
    setIsSearching(true)
    setAiSearchError(null)
    setShowResults(false)
    setResultsMounted(false)
    displayedResultsRef.current = []
    setDisplayedResults([])
    setStagedRevision('')
    setReflectionFallbackRevision('')
    stagedRevisionRef.current = ''
    glassPreparedRevisionRef.current = ''
    reflectionPreparedRevisionRef.current = ''
    setOperationStatus('')

    type OnlineSearchOutcome = {
      results: readonly DiscoveryResult[]
      state: 'ready' | 'unavailable' | 'failed'
      failureStatus: string | null
      page: number
      pageSize: number
      totalCount: number | null
      hasMore: boolean
      nextPage: number | null
    }
    const searchedOnlineProviders = filtersAllowOnlineResults(kind, resolution)
      ? enabledProviderList.filter(
          (provider) =>
            onlineProviderHasCapability(provider, 'search') &&
            shouldRunDirectOnlineSearch(source, provider),
        )
      : []
    setOnlineSearchStatuses(
      Object.fromEntries(
        searchedOnlineProviders.map((provider) => [
          provider,
          `正在通过 Aurora 搜索${getOnlineProviderLabel(provider)}内容…`,
        ]),
      ),
    )
    const onlineSearchPromises = searchedOnlineProviders.map(
      async (provider): Promise<readonly [OnlineMediaProvider, OnlineSearchOutcome]> => {
        try {
          const page = await requestOnlineSearchPage({
            provider,
            query,
            page: 1,
            limit: BILIBILI_DISCOVERY_PAGE_SIZE,
            ...(source === provider &&
              normalizeOnlineProviderSearchType(provider, onlineSearchType)
                ? {
                    searchType: normalizeOnlineProviderSearchType(
                      provider,
                      onlineSearchType,
                    )!,
                  }
                : {}),
          })
          return [provider, {
            results: Array.isArray(page.results) ? page.results : [],
            state: 'ready',
            failureStatus: null,
            page: page.page,
            pageSize: page.pageSize,
            totalCount: page.totalCount,
            hasMore: page.hasMore,
            nextPage: page.nextPage,
          }]
        } catch (error) {
          return [provider, {
            results: [],
            state: onOnlineSearch ||
              (provider === 'bilibili' && onBilibiliSearch) ||
              (provider === 'tencent' && onTencentSearch)
              ? 'failed'
              : 'unavailable',
            failureStatus: getOnlineSearchFailureStatus(provider, error),
            page: 1,
            pageSize: BILIBILI_DISCOVERY_PAGE_SIZE,
            totalCount: null,
            hasMore: false,
            nextPage: null,
          }]
        }
      },
    )

    const sources: readonly DiscoverySource[] =
      source === 'all'
        ? ['local', ...enabledProviderList, 'emby']
        : [source]
    let searchedResults: readonly DiscoveryResult[] = []
    if (aiSearchMode) {
      const includesLocal = sources.includes('local')
      const strongLocalResults = includesLocal
        ? findStrongLocalMetadataMatches(localResultsRef.current, {
            query,
            kind,
            resolution,
            limit: 18,
          })
        : []
      const hybridResponse = await runHybridDiscoverySearch({
        strongLocalResults,
        runLocalSearch: async () => {
          const localPage = sources.length === 1 && includesLocal
            ? await localSearchProvider.search({
                query,
                sources: ['local'],
                kind,
                resolution,
                limit: 18,
              })
            : await discoverySearch.search({
                query,
                sources,
                kind,
                resolution,
                limit: 18,
              })
          return localPage?.results ?? []
        },
        runAiSearch: async () => {
          if (!includesLocal || kind === 'model') return []
          if (!onAiSearch) throw new Error('AI 搜索服务尚未接入')
          return onAiSearch({
            query,
            sources,
            kind,
            resolution,
            limit: 18,
          })
        },
        limit: 18,
      })
      searchedResults = hybridResponse.results
      if (hybridResponse.aiError) {
        setAiSearchError(hybridResponse.aiError.message)
      }
    } else {
      const page = await discoverySearch.search({
        query,
        sources,
        kind,
        resolution,
        limit: 18,
      })
      searchedResults = page?.results ?? []
    }
    const onlineOutcomeEntries = await Promise.all(onlineSearchPromises)
    if (searchSequenceRef.current !== sequence) return

    const onlineOutcomes = Object.fromEntries(onlineOutcomeEntries) as Partial<
      Record<OnlineMediaProvider, OnlineSearchOutcome>
    >
    const directResultsByProvider = Object.fromEntries(
      onlineOutcomeEntries.map(([provider, outcome]) => [
        provider,
        outcome.results,
      ]),
    ) as Partial<Record<OnlineMediaProvider, readonly DiscoveryResult[]>>
    searchedResults = mergeBalancedOnlineDiscoverySearchResults({
      providers: searchedOnlineProviders,
      directResultsByProvider,
      repositoryResults: searchedResults,
      kind,
      resolution,
      limit: 18,
    })

    const nextPaginationByProvider = {
      ...onlinePaginationRef.current,
    }
    searchedOnlineProviders.forEach((provider) => {
      const outcome = onlineOutcomes[provider]
      if (!outcome) return
      nextPaginationByProvider[provider] = {
        searchSequence: sequence,
        query,
        searchType: source === provider
          ? normalizeOnlineProviderSearchType(provider, onlineSearchType)
          : null,
        nextPage: outcome.nextPage,
        totalCount: outcome.totalCount,
        hasMore: outcome.hasMore,
        loading: false,
        autoLoadBlocked: false,
        loadMoreError: null,
      }
    })
    onlinePaginationRef.current = nextPaginationByProvider
    setOnlinePaginationByProvider(nextPaginationByProvider)
    setOnlineSearchStatuses(
      Object.fromEntries(
        searchedOnlineProviders.map((provider) => {
          const outcome = onlineOutcomes[provider]
          const label = getOnlineProviderLabel(provider)
          const resultCount = searchedResults.filter(
            (result) => result.source === provider,
          ).length
          const status = outcome?.state === 'unavailable'
            ? `${label}在线搜索仅可在 Aurora 桌面版中使用`
            : outcome?.state === 'failed'
              ? outcome.failureStatus ?? (
                  resultCount > 0
                    ? `${label}在线搜索暂不可用，已显示 Aurora 中已有结果`
                    : `${label}在线搜索暂不可用，请稍后重试`
                )
              : resultCount > 0
                ? `已找到 ${resultCount} 个${label}结果`
                : `没有找到匹配的${label}内容`
          return [provider, status]
        }),
      ),
    )

    const preparedResults = await prepareDiscoveryResultImages(
      searchedResults,
    )
    if (searchSequenceRef.current !== sequence) return

    const revision = [
      sequence,
      ...preparedResults.map((result) => `${result.id}:${result.thumbnail}`),
    ].join('|')
    stagedRevisionRef.current = revision
    setDisplayedResults(preparedResults)
    setStagedRevision(revision)
    setResultsMounted(true)

    const minimumDelay = hasSearched
      ? SEARCH_DELAY_MS
      : FIRST_RESULT_REVEAL_DELAY_MS
    const remainingDelay = Math.max(
      0,
      minimumDelay - (performance.now() - startedAt),
    )
    const minimumDelayPromise = new Promise<void>((resolve) => {
      window.setTimeout(resolve, remainingDelay)
    })
    const visualPreparationPromise = new Promise<void>((resolve) => {
      if (preparedResults.length === 0) {
        resolve()
        return
      }

      const preparationStartedAt = performance.now()
      const checkPreparation = () => {
        const stale = searchSequenceRef.current !== sequence
        const ready =
          glassPreparedRevisionRef.current === revision &&
          reflectionPreparedRevisionRef.current === revision
        const timedOut =
          performance.now() - preparationStartedAt >=
          DISCOVERY_VISUAL_PREPARATION_TIMEOUT_MS
        if (stale || ready || timedOut) {
          resolve()
          return
        }
        window.requestAnimationFrame(checkPreparation)
      }
      window.requestAnimationFrame(checkPreparation)
    })

    await Promise.all([minimumDelayPromise, visualPreparationPromise])
    if (searchSequenceRef.current !== sequence) return
    setIsSearching(false)
    setHasSearched(true)
    setShowResults(true)
  }

  loadMoreOnlineResultsRef.current = (provider, retryMode) => {
    const pagination = onlinePaginationRef.current[provider]
    const sequence = searchSequenceRef.current
    if (
      !enabledProviderSet.has(provider) ||
      pagination.loading ||
      !pagination.hasMore ||
      pagination.nextPage === null ||
      (pagination.autoLoadBlocked && retryMode === undefined) ||
      pagination.searchSequence !== sequence ||
      pagination.query !== committedQuery ||
      !shouldRunDirectOnlineSearch(sourceFilter, provider) ||
      !filtersAllowOnlineResults(kindFilter, resolutionFilter)
    ) {
      return
    }
    if (retryMode === 'manual') clearOnlinePaginationRecovery(provider)

    const loadingPagination = {
      ...pagination,
      loading: true,
      autoLoadBlocked: false,
      loadMoreError: null,
    }
    const loadingPaginationByProvider = {
      ...onlinePaginationRef.current,
      [provider]: loadingPagination,
    }
    onlinePaginationRef.current = loadingPaginationByProvider
    setOnlinePaginationByProvider(loadingPaginationByProvider)
    setOnlineSearchStatuses((current) => ({
      ...current,
      [provider]: `正在加载更多${getOnlineProviderLabel(provider)}结果…`,
    }))
    // Parent-owned transient search assets flow back through `localResults`;
    // that is part of this search, not a real local-library mutation.
    ignoreTransientOnlineResultsUntilRef.current = Math.max(
      ignoreTransientOnlineResultsUntilRef.current,
      Date.now() + 2_000,
    )

    void requestOnlineSearchPage({
      provider,
      query: pagination.query,
      page: pagination.nextPage,
      limit: BILIBILI_DISCOVERY_PAGE_SIZE,
      ...(pagination.searchType
        ? { searchType: pagination.searchType }
        : {}),
    })
      .then(async (page) => {
        ignoreTransientOnlineResultsUntilRef.current = Math.max(
          ignoreTransientOnlineResultsUntilRef.current,
          Date.now() + 1_000,
        )
        if (
          searchSequenceRef.current !== sequence ||
          onlinePaginationRef.current[provider].searchSequence !== sequence
        ) {
          return
        }
        const pageResults = mergeOnlineDiscoverySearchResults({
          provider,
          directResults: page.results,
          repositoryResults: [],
          kind: kindFilter,
          resolution: resolutionFilter,
          limit: Math.max(1, page.results.length),
        })
        const preparedPageResults = await prepareDiscoveryResultImages(
          pageResults,
        )
        if (
          searchSequenceRef.current !== sequence ||
          onlinePaginationRef.current[provider].searchSequence !== sequence
        ) {
          return
        }

        const currentResults = displayedResultsRef.current
        const nextResults = appendUniqueDiscoveryResults(
          currentResults,
          preparedPageResults,
        )
        const appendedCount = nextResults.length - currentResults.length
        if (nextResults !== currentResults) {
          displayedResultsRef.current = nextResults
          setDisplayedResults(nextResults)
        }
        if (appendedCount === 0) {
          const label = getOnlineProviderLabel(provider)
          const loadedProviderCount = nextResults.filter(
            (result) => result.source === provider,
          ).length
          if (provider === 'douyin') {
            const recovery = scheduleDouyinPaginationRecovery({
              pagination: {
                ...onlinePaginationRef.current[provider],
                searchSequence: sequence,
                query: pagination.query,
                searchType: pagination.searchType,
                nextPage: pagination.nextPage,
                totalCount: pagination.totalCount,
                hasMore: true,
                loading: false,
              },
            })
            const noProgressMessage = recovery
              ? `抖音暂未加载到新增结果，${Math.ceil(recovery.delay / 1_000)} 秒后自动重试（${recovery.attempts}/${DOUYIN_DISCOVERY_RECOVERY_DELAYS_MS.length}），也可点击立即重试`
              : '抖音暂未加载到更多结果，点击此处重试'
            const blockedPagination: DiscoveryOnlinePaginationState = {
              ...onlinePaginationRef.current[provider],
              searchSequence: sequence,
              query: pagination.query,
              searchType: pagination.searchType,
              nextPage: pagination.nextPage,
              totalCount: pagination.totalCount,
              hasMore: true,
              loading: false,
              autoLoadBlocked: true,
              loadMoreError: noProgressMessage,
            }
            const blockedPaginationByProvider = {
              ...onlinePaginationRef.current,
              [provider]: blockedPagination,
            }
            onlinePaginationRef.current = blockedPaginationByProvider
            setOnlinePaginationByProvider(blockedPaginationByProvider)
            setOnlineSearchStatuses((current) => ({
              ...current,
              [provider]: noProgressMessage,
            }))
            return
          }
          if (!page.hasMore || page.nextPage === null) {
            const completedPagination: DiscoveryOnlinePaginationState = {
              searchSequence: sequence,
              query: pagination.query,
              searchType: pagination.searchType,
              nextPage: null,
              totalCount: page.totalCount,
              hasMore: false,
              loading: false,
              autoLoadBlocked: false,
              loadMoreError: null,
            }
            const completedPaginationByProvider = {
              ...onlinePaginationRef.current,
              [provider]: completedPagination,
            }
            onlinePaginationRef.current = completedPaginationByProvider
            setOnlinePaginationByProvider(completedPaginationByProvider)
            setOnlineSearchStatuses((current) => ({
              ...current,
              [provider]: `已加载全部 ${loadedProviderCount} 个${label}结果`,
            }))
            return
          }
          const noProgressMessage = `${label}本页没有新增结果，点击此处重试`
          const blockedPagination: DiscoveryOnlinePaginationState = {
            ...onlinePaginationRef.current[provider],
            searchSequence: sequence,
            query: pagination.query,
            searchType: pagination.searchType,
            nextPage: pagination.nextPage,
            totalCount: page.totalCount,
            hasMore: true,
            loading: false,
            autoLoadBlocked: true,
            loadMoreError: noProgressMessage,
          }
          const blockedPaginationByProvider = {
            ...onlinePaginationRef.current,
            [provider]: blockedPagination,
          }
          onlinePaginationRef.current = blockedPaginationByProvider
          setOnlinePaginationByProvider(blockedPaginationByProvider)
          setOnlineSearchStatuses((current) => ({
            ...current,
            [provider]: noProgressMessage,
          }))
          return
        }
        clearOnlinePaginationRecovery(provider)
        const nextPagination: DiscoveryOnlinePaginationState = {
          searchSequence: sequence,
          query: pagination.query,
          searchType: pagination.searchType,
          nextPage: page.nextPage,
          totalCount: page.totalCount,
          hasMore: page.hasMore,
          loading: false,
          autoLoadBlocked: false,
          loadMoreError: null,
        }
        const nextPaginationByProvider = {
          ...onlinePaginationRef.current,
          [provider]: nextPagination,
        }
        onlinePaginationRef.current = nextPaginationByProvider
        setOnlinePaginationByProvider(nextPaginationByProvider)
        const loadedProviderCount = nextResults.filter(
          (result) => result.source === provider,
        ).length
        const label = getOnlineProviderLabel(provider)
        setOnlineSearchStatuses((current) => ({
          ...current,
          [provider]: page.hasMore
            ? `已加载 ${loadedProviderCount} 个${label}结果，继续浏览将自动加载更多`
            : `已加载全部 ${loadedProviderCount} 个${label}结果`,
        }))
      })
      .catch((error) => {
        if (searchSequenceRef.current !== sequence) return
        const label = getOnlineProviderLabel(provider)
        const actionableFailureStatus = getOnlineSearchFailureStatus(
          provider,
          error,
          true,
        )
        if (actionableFailureStatus) {
          clearOnlinePaginationRecovery(provider)
        }
        const recovery =
          provider === 'douyin' && !actionableFailureStatus
            ? scheduleDouyinPaginationRecovery({ pagination })
            : null
        const loadMoreError = actionableFailureStatus ?? (
          recovery
            ? `抖音加载更多结果暂时失败，${Math.ceil(recovery.delay / 1_000)} 秒后自动重试（${recovery.attempts}/${DOUYIN_DISCOVERY_RECOVERY_DELAYS_MS.length}），也可点击立即重试`
            : `加载更多${label}结果失败，点击此处重试`
        )
        const failedPagination = {
          ...onlinePaginationRef.current[provider],
          loading: false,
          hasMore: pagination.hasMore,
          nextPage: pagination.nextPage,
          autoLoadBlocked: true,
          loadMoreError,
        }
        const failedPaginationByProvider = {
          ...onlinePaginationRef.current,
          [provider]: failedPagination,
        }
        onlinePaginationRef.current = failedPaginationByProvider
        setOnlinePaginationByProvider(failedPaginationByProvider)
        setOnlineSearchStatuses((current) => ({
          ...current,
          [provider]: loadMoreError,
        }))
      })
  }

  useEffect(() => {
    if (
      !active ||
      suspended ||
      isSearching ||
      !showResults ||
      snakeTransition !== null ||
      selectionTransition !== null
    ) {
      return
    }
    enabledProviderList.forEach((provider) => {
      const pagination = onlinePaginationByProvider[provider]
      const providerPrefetchWindow = getDiscoveryProviderPrefetchWindow({
        results: spatiallyOrderedResults,
        provider,
        windowStart: corridorWindowStart,
        windowSize: CARD_SLOTS.length,
      })
      if (
        shouldRunDirectOnlineSearch(sourceFilter, provider) &&
        shouldPrefetchNextBilibiliPage({
          ...providerPrefetchWindow,
          hasMore: pagination.hasMore,
          loading: pagination.loading,
          blocked: pagination.autoLoadBlocked,
        })
      ) {
        loadMoreOnlineResultsRef.current(provider)
      }
    })
  }, [
    active,
    corridorWindowStart,
    enabledProviderList,
    isSearching,
    onlinePaginationByProvider,
    selectionTransition,
    showResults,
    snakeTransition,
    spatiallyOrderedResults,
    sourceFilter,
    suspended,
  ])

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (aiSearchMode && !aiSearchConfigured) {
      onAiSearchSetupRequired?.()
      return
    }
    void executeDiscoverySearch({
      query: draftQuery.trim(),
    })
  }

  const enabledProviderSignature = enabledProviderList.join('|')
  useEffect(() => {
    onlinePaginationRecoveryRef.current.forEach((_recovery, provider) => {
      if (!enabledProviderSet.has(provider)) {
        clearOnlinePaginationRecovery(provider)
      }
    })
    setOnlineSearchStatuses((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([provider]) =>
          enabledProviderSet.has(provider as OnlineMediaProvider),
        ),
      ) as Partial<Record<OnlineMediaProvider, string>>
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next
    })
    if (
      !isOnlineMediaProvider(sourceFilter) ||
      enabledProviderSet.has(sourceFilter)
    ) {
      return
    }
    searchSequenceRef.current += 1
    resetCorridorForContextChange()
    stopPreviewAndClearStatus()
    setSourceFilter('all')
    if (hasSearched) {
      void executeDiscoverySearch({
        query: committedQuery,
        source: 'all',
        kind: kindFilter,
        resolution: resolutionFilter,
      })
    }
  // The signature makes this react to actual enablement changes instead of a
  // caller recreating an equivalent providers array during an App render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledProviderSignature])

  const handleAiSearchModeToggle = () => {
    const nextMode = !aiSearchMode
    if (nextMode && !aiSearchConfigured) {
      onAiSearchSetupRequired?.()
      return
    }
    setAiSearchError(null)
    onAiSearchModeChange?.(nextMode)
  }

  refreshAfterEmbyConnectionRef.current = () => {
    if (!hasSearched) return
    void executeDiscoverySearch({
      query: committedQuery,
      source: sourceFilter,
      kind: kindFilter,
      resolution: resolutionFilter,
    })
  }

  refreshAfterLocalDataChangeRef.current = () => {
    if (
      !localResultsDirtyRef.current ||
      !hasSearched ||
      sourceFilter === 'emby' ||
      !active ||
      suspended
    ) {
      return
    }
    localResultsDirtyRef.current = false
    void executeDiscoverySearch({
      query: committedQuery,
      source: sourceFilter,
      kind: kindFilter,
      resolution: resolutionFilter,
    })
  }

  useEffect(() => {
    if (previousLocalResultsRef.current === localResults) return
    previousLocalResultsRef.current = localResults

    if (Date.now() < ignoreTransientOnlineResultsUntilRef.current) {
      localResultsDirtyRef.current = false
      return
    }

    // Direct online search stores transient assets in the parent so result
    // actions can resolve them. That update is not a library mutation.
    if (isSearching) {
      localResultsDirtyRef.current = false
      return
    }
    localResultsDirtyRef.current = true
    refreshAfterLocalDataChangeRef.current()
  }, [isSearching, localResults])

  useEffect(() => {
    refreshAfterLocalDataChangeRef.current()
  }, [active, suspended])

  useEffect(() => {
    const handleEmbyConnectionChange = () => {
      refreshAfterEmbyConnectionRef.current()
    }
    window.addEventListener(
      'aurora:emby-connection-changed',
      handleEmbyConnectionChange,
    )
    return () => {
      window.removeEventListener(
        'aurora:emby-connection-changed',
        handleEmbyConnectionChange,
      )
    }
  }, [])

  const handleSelectResult = (result: DiscoveryResult) => {
    const startedFromHover = hoveredId === result.id
    clearHoverExitTimer()
    setHoveredId(null)
    if (!DISCOVERY_RESULT_CORRIDOR_ENABLED) {
      stopPreviewAndClearStatus()
      if (
        selectionLockRef.current ||
        snakeLockRef.current ||
        isCorridorMoving ||
        selectionTransition !== null ||
        result.id === layoutSelectedId
      ) {
        return
      }

      const fromSlotIndex = spatialResults.findIndex(
        (entry) => entry.id === result.id,
      )
      if (fromSlotIndex < 0) return
      const fromOrderIds = spatialResults.map((entry) => entry.id)
      const toOrderIds = [
        result.id,
        ...fromOrderIds.filter((id) => id !== result.id),
      ]
      const nextSpatialOrderIds = [...spatialOrderIdsRef.current]
      nextSpatialOrderIds.splice(
        corridorWindowStartRef.current,
        fromOrderIds.length,
        ...toOrderIds,
      )

      cancelSelectionTimer()
      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches

      if (prefersReducedMotion) {
        setLayoutSelectedId(result.id)
        spatialOrderIdsRef.current = nextSpatialOrderIds
        setSpatialOrderIds(nextSpatialOrderIds)
        setSelectedId(result.id)
        return
      }

      const sequence = selectionSequenceRef.current
      selectionLockRef.current = true
      reflectionResultsRef.current = spatialResults
      setLayoutSelectedId(result.id)
      spatialOrderIdsRef.current = nextSpatialOrderIds
      setSpatialOrderIds(nextSpatialOrderIds)
      setSelectionTransition({
        resultId: result.id,
        fromSlotIndex,
        fromOrderIds,
        toOrderIds,
        startedFromHover,
        sequence,
      })

      selectionTimerRef.current = window.setTimeout(() => {
        if (selectionSequenceRef.current !== sequence) return
        selectionTimerRef.current = null
        selectionAnimationsRef.current.forEach((animation) => {
          animation.onfinish = null
          animation.cancel()
        })
        selectionAnimationsRef.current = []
        selectionSequenceRef.current += 1
        selectionLockRef.current = false
        setSelectedId(result.id)
        setSelectionTransition(null)
      }, DISCOVERY_CARD_SWITCH_FALLBACK_MS)
      return
    }
    const targetIndex = corridorOrderedResults.findIndex(
      (entry) => entry.id === result.id,
    )
    if (targetIndex < 0 || targetIndex === Math.round(corridorPositionRef.current)) {
      return
    }
    if (corridorWheelReleaseTimerRef.current !== null) {
      window.clearTimeout(corridorWheelReleaseTimerRef.current)
      corridorWheelReleaseTimerRef.current = null
    }
    corridorWheelStateRef.current.active = false
    corridorWheelStateRef.current.axis = null
    stopPreviewAndClearStatus()
    animateCorridorTo(targetIndex, 0, 'click')
  }

  const executeResultAction = (
    result: DiscoveryResult,
    actionId: DiscoveryResultActionRequest['actionId'],
  ) => {
    const action = resolveDiscoveryResultActions(result).actions.find(
      (candidate) => candidate.id === actionId,
    )
    if (!action) return false

    setOperationStatus('')
    try {
      const execution = onResultAction({ actionId, result })
      if (typeof execution === 'boolean') {
        if (!execution) {
          setOperationStatus(
            `未能执行“${action.label}”，请确认对应素材仍可用`,
          )
        }
        return execution
      }

      void execution
        .then((completed) => {
          if (!completed) {
            setOperationStatus(
              `未能执行“${action.label}”，请确认对应素材仍可用`,
            )
          }
        })
        .catch(() => {
          setOperationStatus(`“${action.label}”执行失败，请稍后重试`)
        })
      return true
    } catch {
      setOperationStatus(`“${action.label}”执行失败，请稍后重试`)
      return false
    }
  }

  const handleOpenPrimaryResult = (result: DiscoveryResult | null) => {
    if (!result) return false
    const primaryAction = resolveDiscoveryResultActions(result).primaryAction
    return primaryAction
      ? executeResultAction(result, primaryAction.id)
      : false
  }

  const clearLocalDoubleClickBridge = () => {
    localDoubleClickRef.current = null
    if (localDoubleClickResetTimerRef.current !== null) {
      window.clearTimeout(localDoubleClickResetTimerRef.current)
      localDoubleClickResetTimerRef.current = null
    }
  }

  const handleResultStagePointerDownCapture = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return

    const pending = localDoubleClickRef.current
    if (pending) {
      const elapsed = event.timeStamp - pending.timeStamp
      const distance = Math.hypot(
        event.clientX - pending.clientX,
        event.clientY - pending.clientY,
      )
      if (
        elapsed > 0 &&
        elapsed <= DISCOVERY_LOCAL_DOUBLE_CLICK_MS &&
        distance <= DISCOVERY_LOCAL_DOUBLE_CLICK_DISTANCE
      ) {
        const result = resultById.get(pending.resultId) ?? null
        clearLocalDoubleClickBridge()
        event.preventDefault()
        event.stopPropagation()
        if (handleOpenPrimaryResult(result)) {
          suppressNextResultClickRef.current = true
          localDoubleClickResetTimerRef.current = window.setTimeout(() => {
            suppressNextResultClickRef.current = false
            localDoubleClickResetTimerRef.current = null
          }, DISCOVERY_LOCAL_DOUBLE_CLICK_MS)
        }
        return
      }

      clearLocalDoubleClickBridge()
    }

    const hitTarget =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('.discoveryResultHit')
        : null
    if (
      !hitTarget ||
      hitTarget.disabled ||
      spatialOrderIdsRef.current.length <= 1 ||
      isSearching ||
      isCameraDragging ||
      isCorridorMoving ||
      snakeLockRef.current ||
      snakeTransition !== null ||
      selectionLockRef.current ||
      selectionTransition !== null ||
      !active ||
      suspended
    ) {
      return
    }

    const now = performance.now()
    resultPointerDragRef.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      axis: null,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: now,
    }
  }

  const handleResultStagePointerMoveCapture = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const pointerState = resultPointerDragRef.current
    if (
      !pointerState.active ||
      pointerState.pointerId !== event.pointerId
    ) {
      return
    }

    if (!pointerState.dragging) {
      const deltaX = event.clientX - pointerState.startX
      const deltaY = event.clientY - pointerState.startY
      if (
        Math.hypot(deltaX, deltaY) <
        DISCOVERY_RESULT_POINTER_DRAG_THRESHOLD
      ) {
        return
      }
      if (
        spatialOrderIdsRef.current.length <= 1 ||
        isSearching ||
        isCameraDragging ||
        snakeLockRef.current ||
        snakeTransition !== null ||
        selectionLockRef.current ||
        selectionTransition !== null ||
        !active ||
        suspended
      ) {
        resetResultPointerDrag()
        return
      }

      pointerState.dragging = true
      pointerState.axis = Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y'
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // The section can still finish the gesture while the pointer stays inside.
      }
      clearLocalDoubleClickBridge()
      suppressNextResultClickRef.current = true
      if (resultPointerClickResetTimerRef.current !== null) {
        window.clearTimeout(resultPointerClickResetTimerRef.current)
        resultPointerClickResetTimerRef.current = null
      }
      if (corridorWheelReleaseTimerRef.current !== null) {
        window.clearTimeout(corridorWheelReleaseTimerRef.current)
        corridorWheelReleaseTimerRef.current = null
      }
      cancelCorridorAnimation()
      if (corridorSettleRafRef.current !== null) {
        window.cancelAnimationFrame(corridorSettleRafRef.current)
        corridorSettleRafRef.current = null
      }

      const wheelState = corridorWheelStateRef.current
      wheelState.active = true
      wheelState.axis = pointerState.axis
      wheelState.snapAnchor = Math.round(corridorPositionRef.current)
      wheelState.rawPosition = corridorPositionRef.current
      wheelState.previewStartPosition = corridorPositionRef.current
      wheelState.snapTarget = wheelState.snapAnchor
      wheelState.lastTime = pointerState.lastTime
      wheelState.velocity = 0
      wheelState.hasVelocity = false
      pendingSnakeStepsRef.current = 0
      snakeWheelStateRef.current.accumulator = 0
      setIsResultPointerDragging(true)
      setCorridorMotionActive(true)
      stopPreviewAndClearStatus()
    }

    const axis = pointerState.axis
    if (!axis) return
    const now = performance.now()
    const elapsed = Math.max(8, now - pointerState.lastTime)
    const pointerDelta = axis === 'x'
      ? event.clientX - pointerState.lastX
      : event.clientY - pointerState.lastY
    const positionDelta =
      -pointerDelta / DISCOVERY_SNAKE_WHEEL_THRESHOLD
    pointerState.lastX = event.clientX
    pointerState.lastY = event.clientY
    pointerState.lastTime = now

    const wheelState = corridorWheelStateRef.current
    const maximumPosition = getDiscoveryMaximumWindowStart(
      spatialOrderIdsRef.current.length,
    )
    const previousRawPosition = wheelState.rawPosition
    wheelState.rawPosition = Math.max(
      0,
      Math.min(
        maximumPosition,
        wheelState.rawPosition + positionDelta,
      ),
    )
    if (wheelState.rawPosition === previousRawPosition) {
      wheelState.velocity = 0
      wheelState.hasVelocity = false
    } else {
      const instantVelocity = positionDelta / elapsed
      wheelState.velocity = wheelState.hasVelocity
        ? wheelState.velocity * 0.68 + instantVelocity * 0.32
        : instantVelocity
      wheelState.hasVelocity = true
    }
    wheelState.lastTime = now
    const visualPosition =
      wheelState.rawPosition === previousRawPosition
        ? wheelState.rawPosition
        : Math.max(
            0,
            Math.min(
              maximumPosition,
              corridorPositionRef.current + positionDelta,
            ),
          )
    wheelState.previewStartPosition = visualPosition
    wheelState.snapTarget = resolveTrackpadSnapTarget(
      wheelState.snapAnchor,
      wheelState.rawPosition,
      0,
      maximumPosition,
    )
    scheduleCorridorPosition(visualPosition)
    event.preventDefault()
    event.stopPropagation()
  }

  const finishResultStagePointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    shouldCommit: boolean,
  ) => {
    const pointerState = resultPointerDragRef.current
    if (
      !pointerState.active ||
      pointerState.pointerId !== event.pointerId
    ) {
      return
    }

    const wasDragging = pointerState.dragging
    pointerState.active = false
    pointerState.dragging = false
    pointerState.pointerId = -1
    pointerState.axis = null
    if (!wasDragging) return

    event.preventDefault()
    event.stopPropagation()
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    setIsResultPointerDragging(false)
    const wheelState = corridorWheelStateRef.current
    if (!shouldCommit) {
      wheelState.snapTarget = wheelState.snapAnchor
      wheelState.velocity = 0
      wheelState.hasVelocity = false
    }
    finishCorridorWheel()
    if (resultPointerClickResetTimerRef.current !== null) {
      window.clearTimeout(resultPointerClickResetTimerRef.current)
    }
    resultPointerClickResetTimerRef.current = window.setTimeout(() => {
      suppressNextResultClickRef.current = false
      resultPointerClickResetTimerRef.current = null
    }, 0)
  }

  const armLocalDoubleClickBridge = (
    result: DiscoveryResult,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (!resolveDiscoveryResultActions(result).primaryAction) return

    clearLocalDoubleClickBridge()
    localDoubleClickRef.current = {
      resultId: result.id,
      clientX: event.clientX,
      clientY: event.clientY,
      timeStamp: event.timeStamp,
    }
    localDoubleClickResetTimerRef.current = window.setTimeout(() => {
      localDoubleClickRef.current = null
      localDoubleClickResetTimerRef.current = null
    }, DISCOVERY_LOCAL_DOUBLE_CLICK_MS)
  }

  useEffect(() => {
    if (!active || suspended) {
      localDoubleClickRef.current = null
      if (
        !suppressNextResultClickRef.current &&
        localDoubleClickResetTimerRef.current !== null
      ) {
        window.clearTimeout(localDoubleClickResetTimerRef.current)
        localDoubleClickResetTimerRef.current = null
      }
    }
  }, [active, suspended])

  useEffect(() => {
    return () => {
      localDoubleClickRef.current = null
      suppressNextResultClickRef.current = false
      resultPointerDragRef.current.active = false
      resultPointerDragRef.current.dragging = false
      if (localDoubleClickResetTimerRef.current !== null) {
        window.clearTimeout(localDoubleClickResetTimerRef.current)
        localDoubleClickResetTimerRef.current = null
      }
      if (resultPointerClickResetTimerRef.current !== null) {
        window.clearTimeout(resultPointerClickResetTimerRef.current)
        resultPointerClickResetTimerRef.current = null
      }
    }
  }, [])

  return (
    <>
      <section
        className="discoverySearchCluster"
        aria-label="全局影像搜索"
        aria-hidden={!active}
        inert={!active || suspended}
        data-page-active={active}
        data-camera-gesture="block"
        data-search-position={hasSearched ? 'results' : 'center'}
      >
        <form
          className="discoverySearchBar uiGlassShell"
          data-page-grade="true"
          onSubmit={handleSearch}
        >
          <Search size={20} strokeWidth={1.45} aria-hidden="true" />
          <input
            aria-label={
              aiSearchMode
                ? '用自然语言搜索画面'
                : '搜索视频片段或关键帧'
            }
            value={draftQuery}
            placeholder={
              aiSearchMode
                ? '描述你想寻找的画面…'
                : '输入文件名、标签、备注或媒体信息…'
            }
            onChange={(event) => setDraftQuery(event.target.value)}
          />
          <button
            className="discoveryAiSearchToggle"
            type="button"
            aria-label={
              aiSearchMode ? '关闭 AI 搜索' : '打开 AI 搜索'
            }
            aria-pressed={aiSearchMode}
            data-configured={aiSearchConfigured}
            title={
              aiSearchMode
                ? '当前使用 AI 画面搜索'
                : aiSearchConfigured
                  ? '切换到 AI 画面搜索'
                  : '配置 AI 在线模型后启用'
            }
            onClick={handleAiSearchModeToggle}
          >
            <WandSparkles size={13} strokeWidth={1.55} aria-hidden="true" />
            <span className="discoveryAiSearchLabel">AI</span>
            <span className="discoveryAiSearchSwitch" aria-hidden="true">
              <span />
            </span>
          </button>
          <button
            className="discoverySearchSubmit"
            type="submit"
            aria-label={aiSearchMode ? '开始 AI 搜索' : '开始搜索'}
            disabled={isSearching}
          >
            {isSearching ? (
              <LoaderCircle size={17} strokeWidth={1.7} aria-hidden="true" />
            ) : (
              <ArrowRight size={18} strokeWidth={1.65} aria-hidden="true" />
            )}
          </button>
        </form>

        <div
          className="discoveryFilterRow"
          data-page-grade="true"
          aria-label="搜索筛选"
        >
          <div
            className="discoverySourceFilters uiGlassInset"
            role="group"
            aria-label="来源筛选"
          >
            {availableSourceFilters.map((source) => (
              <button
                key={source}
                type="button"
                className={sourceFilter === source ? 'active' : ''}
                aria-pressed={sourceFilter === source}
                onClick={() => {
                  const nextProviderSearchType = isOnlineMediaProvider(source)
                    ? normalizeOnlineProviderSearchType(
                        source,
                        providerSearchType,
                      )
                    : null
                  const nextKind = isOnlineMediaProvider(source)
                    ? 'all'
                    : kindFilter
                  resetCorridorForContextChange()
                  setSourceFilter(source)
                  if (nextProviderSearchType) {
                    setProviderSearchType(nextProviderSearchType)
                  }
                  if (nextKind !== kindFilter) setKindFilter(nextKind)
                  stopPreviewAndClearStatus()
                  if (hasSearched) {
                    void executeDiscoverySearch({
                      query: committedQuery,
                      source,
                      kind: nextKind,
                      ...(nextProviderSearchType
                        ? { onlineSearchType: nextProviderSearchType }
                        : {}),
                    })
                  }
                }}
              >
                {getDiscoverySourceLabel(source)}
              </button>
            ))}
          </div>
          {activeOnlineProvider ? (
            activeProviderSearchType &&
            activeProviderSearchTypeOptions.length > 0 ? (
              <FilterSelect
                label="类型"
                value={activeProviderSearchType}
                options={activeProviderSearchTypeLabels}
                onChange={(value) => {
                  resetCorridorForContextChange()
                  setProviderSearchType(value)
                  stopPreviewAndClearStatus()
                  if (hasSearched) {
                    void executeDiscoverySearch({
                      query: committedQuery,
                      kind: 'all',
                      onlineSearchType: value,
                    })
                  }
                }}
              />
            ) : null
          ) : (
            <FilterSelect
              label="类型"
              value={kindFilter}
              options={KIND_LABELS}
              onChange={(value) => {
                resetCorridorForContextChange()
                setKindFilter(value)
                stopPreviewAndClearStatus()
                if (hasSearched) {
                  void executeDiscoverySearch({
                    query: committedQuery,
                    kind: value,
                  })
                }
              }}
            />
          )}
          <FilterSelect
            label="分辨率"
            value={resolutionFilter}
            options={RESOLUTION_LABELS}
            onChange={(value) => {
              resetCorridorForContextChange()
              setResolutionFilter(value)
              stopPreviewAndClearStatus()
              if (hasSearched) {
                void executeDiscoverySearch({
                  query: committedQuery,
                  resolution: value,
                })
              }
            }}
          />
        </div>

        <p
          className={`discoverySearchHint${
            compactOnlineSearchHint ? ' isCompact' : ''
          }`}
          data-page-grade="true"
          role={retryableOnlineProviders.length > 0 ? 'button' : undefined}
          tabIndex={retryableOnlineProviders.length > 0 ? 0 : undefined}
          aria-label={
            compactOnlineSearchHint
              ? `${discoverySearchHintDetail}${
                  retryableOnlineProviders.length > 0
                    ? '。点击重试异常来源'
                    : ''
                }`
              : retryableOnlineProviders.length > 0
                ? discoverySearchHint
                : undefined
          }
          title={
            compactOnlineSearchHint
              ? discoverySearchHintDetail
              : undefined
          }
          style={
            retryableOnlineProviders.length > 0
              ? { cursor: 'pointer', pointerEvents: 'auto' }
              : undefined
          }
          onClick={
            retryableOnlineProviders.length > 0
              ? retryBlockedOnlineSearches
              : undefined
          }
          onKeyDown={(event) => {
            if (
              retryableOnlineProviders.length === 0 ||
              (event.key !== 'Enter' && event.key !== ' ')
            ) {
              return
            }
            event.preventDefault()
            retryBlockedOnlineSearches()
          }}
        >
          <Info size={12} strokeWidth={1.55} aria-hidden="true" />
          <span className="discoverySearchHintText">
            {discoverySearchHint}
          </span>
        </p>
      </section>
      <DiscoveryReflectionCanvas
        active={active}
        suspended={suspended}
        results={
          resultsMounted
            ? DISCOVERY_RESULT_CORRIDOR_ENABLED
              ? corridorResults
              : reflectionResults
            : []
        }
        preloadResults={resultsMounted ? corridorPreloadResults : []}
        selectedResult={resultsMounted ? selectedResult : null}
        visible={
          showResults && reflectionFallbackRevision !== stagedRevision
        }
        preparationRevision={
          resultsMounted && !showResults ? stagedRevision : ''
        }
        onPreparationReady={(revision, outcome) => {
          if (revision !== stagedRevisionRef.current) return
          reflectionPreparedRevisionRef.current = revision
          if (outcome === 'fallback') {
            setReflectionFallbackRevision(revision)
          }
        }}
        motionSignal={[
          hasSearched,
          showResults,
          selectedResult?.id ?? '',
          layoutSelectedId,
          selectionTransition
            ? [
                selectionTransition.resultId,
                selectionTransition.fromSlotIndex,
                selectionTransition.fromOrderIds.join(','),
                selectionTransition.toOrderIds.join(','),
                Number(selectionTransition.startedFromHover),
                selectionTransition.sequence,
              ].join(':')
            : '',
          snakeTransition
            ? [
                snakeTransition.direction,
                snakeTransition.fromWindowStart,
                snakeTransition.toWindowStart,
                snakeTransition.fromOrderIds.join(','),
                snakeTransition.toOrderIds.join(','),
                snakeTransition.sequence,
              ].join(':')
            : '',
          corridorWindowStart,
          isCorridorMoving,
          hoveredResultId ?? '',
          spatialResults.map((result) => result.id).join(','),
          sourceFilter,
          kindFilter,
          resolutionFilter,
          isSearching,
          operationStatus,
          detailTab,
          cameraYaw.toFixed(4),
          cameraPitch.toFixed(4),
          DISCOVERY_RESULT_LAYOUT_REVISION,
        ].join('|')}
        textureRevisionSignal={[
          selectedResult?.id ?? '',
          selectedVisualIndexStatus,
          selectedVisualIndexCounts?.keyframeCount ?? 0,
          selectedVisualIndexCounts?.highlightCount ?? 0,
          selectedFavoriteCount,
          operationStatus,
          detailTab,
        ].join('|')}
        cameraYaw={cameraYaw}
        cameraPitch={cameraPitch}
        materialTint={materialTint}
        surfaceData={reflectionSurface}
      />
      <div
        ref={projectedGlassLayerRef}
        className="discoveryProjectedGlassLayer"
        data-glass-active={active && resultsMounted}
        data-results-visible={showResults}
        aria-hidden="true"
      >
        <span className="discoveryDetailProjectedGlass" />
        <span className="discoveryDetailWarmupGlass uiGlassShell" />
      </div>
      <section
        ref={discoveryViewRef}
        className={`discoveryView${
          isResultPointerDragging ? ' isResultPointerDragging' : ''
        }`}
        aria-label="探索页"
        aria-hidden={!active}
        data-page-active={active}
        data-result-pointer-drag-enabled={
          active &&
          !suspended &&
          showResults &&
          !isSearching &&
          spatialOrderIds.length > 1
        }
        inert={!active}
        onPointerDownCapture={handleResultStagePointerDownCapture}
        onPointerMoveCapture={handleResultStagePointerMoveCapture}
        onPointerUpCapture={(event) =>
          finishResultStagePointerDrag(event, true)
        }
        onPointerCancelCapture={(event) =>
          finishResultStagePointerDrag(event, false)
        }
        onWheelCapture={handleDiscoveryResultWheel}
      >
        <div className="discoveryPlane">
        {resultsMounted && (
          <div
            className="discoverySpatialStage"
            data-results-visible={showResults}
            aria-hidden={!showResults}
            inert={!showResults}
          >
            <div className="discoveryCameraRig">
            <section
              className="discoveryResultStage"
              aria-label="空间化搜索结果"
              aria-busy={
                isSearching ||
                isCorridorMoving ||
                selectionTransition !== null ||
                snakeTransition !== null
              }
            >
              <div
                key={DISCOVERY_RESULT_LAYOUT_REVISION}
                ref={corridorCardsRef}
                style={{
                  '--discovery-card-switch-duration':
                    `${DISCOVERY_CARD_SWITCH_MS}ms`,
                  '--discovery-card-reflow-delay':
                    `${DISCOVERY_CARD_REFLOW_DELAY_MS}ms`,
                  '--discovery-card-reflow-duration':
                    `${DISCOVERY_CARD_REFLOW_MS}ms`,
                } as CSSProperties}
                className={[
                  'discoveryResultCards',
                  isSearching ? 'isSearching' : '',
                  hasHoverFocus ? 'hasHoverFocus' : '',
                  isCorridorMoving ? 'isCorridorMoving' : '',
                  selectionTransition ? 'isSelectionTransitioning' : '',
                  selectionTransition ? 'isSelectionMoving' : '',
                  snakeTransition ? 'isSnakeTransitioning' : '',
                  !DISCOVERY_RESULT_CORRIDOR_ENABLED
                    ? 'isStaticLayout'
                    : '',
                ].filter(Boolean).join(' ')}
              >
                {renderedResults.map((result, resultIndex) => {
                  const resultActionGroup = resolveDiscoveryResultActions(result)
                  const renderedCorridorPosition =
                    DISCOVERY_RESULT_CORRIDOR_ENABLED
                      ? isCorridorMoving
                        ? corridorPositionRef.current
                        : corridorWindowStart
                      : 0
                  const pose = getDiscoveryCorridorPose(
                    resultIndex,
                    renderedCorridorPosition,
                  )
                  const transitionDestinationSlotIndex =
                    !DISCOVERY_RESULT_CORRIDOR_ENABLED &&
                    selectionTransition
                      ? selectionTransition.toOrderIds.indexOf(result.id)
                      : -1
                  const snakeFromSlotIndex =
                    !DISCOVERY_RESULT_CORRIDOR_ENABLED &&
                    snakeTransition
                      ? snakeTransition.fromOrderIds.indexOf(result.id)
                      : -1
                  const snakeToSlotIndex =
                    !DISCOVERY_RESULT_CORRIDOR_ENABLED &&
                    snakeTransition
                      ? snakeTransition.toOrderIds.indexOf(result.id)
                      : -1
                  const snakeFrontExit = snakeTransition
                    ? interpolateCorridorLayout(
                        -DISCOVERY_CORRIDOR_GUARD_DISTANCE,
                      )
                    : null
                  const snakeRearEntry = snakeTransition
                    ? interpolateCorridorLayout(
                        CARD_SLOTS.length -
                          1 +
                          DISCOVERY_CORRIDOR_GUARD_DISTANCE,
                      )
                    : null
                  const steadyGuardSlot =
                    !snakeTransition &&
                    result.id === previousGuardResult?.id
                      ? interpolateCorridorLayout(
                          -DISCOVERY_CORRIDOR_GUARD_DISTANCE,
                        )
                      : !snakeTransition &&
                          result.id === nextGuardResult?.id
                        ? interpolateCorridorLayout(
                            CARD_SLOTS.length -
                              1 +
                              DISCOVERY_CORRIDOR_GUARD_DISTANCE,
                          )
                        : null
                  const snakeSourceSlot =
                    snakeTransition
                      ? snakeFromSlotIndex >= 0
                        ? CARD_SLOTS[snakeFromSlotIndex]
                        : snakeTransition.direction > 0
                          ? snakeRearEntry
                          : snakeFrontExit
                      : null
                  const snakeDestinationSlot =
                    snakeTransition
                      ? snakeToSlotIndex >= 0
                        ? CARD_SLOTS[snakeToSlotIndex]
                        : snakeTransition.direction > 0
                          ? snakeFrontExit
                          : snakeRearEntry
                      : null
                  const staticSlotIndex =
                    snakeTransition
                      ? snakeToSlotIndex >= 0
                        ? snakeToSlotIndex
                        : snakeFromSlotIndex
                      : transitionDestinationSlotIndex >= 0
                      ? transitionDestinationSlotIndex
                      : spatialSlotIndexById.get(result.id)
                  if (
                    !DISCOVERY_RESULT_CORRIDOR_ENABLED &&
                    (staticSlotIndex === undefined ||
                      staticSlotIndex < 0) &&
                    !snakeDestinationSlot &&
                    !steadyGuardSlot
                  ) {
                    return null
                  }
                  const slotIndex =
                    DISCOVERY_RESULT_CORRIDOR_ENABLED
                      ? pose.reflectionIndex
                      : snakeTransition
                        ? resultIndex
                        : staticSlotIndex ?? 0
                  const slot =
                    snakeDestinationSlot ??
                    steadyGuardSlot ??
                    CARD_SLOTS[staticSlotIndex ?? 0] ??
                    CARD_SLOTS[0]
                  const focused =
                    DISCOVERY_RESULT_CORRIDOR_ENABLED
                      ? pose.active && hoveredResultId === result.id
                      : !snakeTransition &&
                        steadyGuardSlot === null &&
                        hoveredResultId === result.id
                  const selectionTraveler =
                    !DISCOVERY_RESULT_CORRIDOR_ENABLED &&
                    selectionTransition?.resultId === result.id
                  const selected =
                    DISCOVERY_RESULT_CORRIDOR_ENABLED
                      ? result.id === selectedId
                      : snakeTransition
                        ? snakeToSlotIndex === 0
                        : result.id === layoutSelectedId
                  const visualSelected =
                    snakeTransition
                      ? result.id === selectedId
                      : !DISCOVERY_RESULT_CORRIDOR_ENABLED &&
                          selectionTransition !== null
                        ? result.id === selectedId
                        : selected
                  const previousSlotIndex =
                    !DISCOVERY_RESULT_CORRIDOR_ENABLED &&
                    selectionTransition
                      ? selectionTransition.fromOrderIds.indexOf(result.id)
                      : -1
                  const previousSlot =
                    previousSlotIndex >= 0
                      ? CARD_SLOTS[previousSlotIndex]
                      : null
                  const materialMoving =
                    !DISCOVERY_RESULT_CORRIDOR_ENABLED &&
                    selectionTransition !== null &&
                    previousSlotIndex >= 0 &&
                    previousSlotIndex !== slotIndex
                  const selectionSourceSlot =
                    selectionTraveler && selectionTransition
                      ? CARD_SLOTS[selectionTransition.fromSlotIndex]
                      : null
                  const cardStyle = DISCOVERY_RESULT_CORRIDOR_ENABLED
                    ? createDiscoveryCardStyle(pose, focused)
                    : ({
                        ...createDiscoveryStaticCardStyle(slot, {
                          selected,
                          focused,
                          materialSlot: slot,
                          materialSourceSlot:
                            snakeSourceSlot ??
                            (selectionTransition && previousSlot
                              ? previousSlot
                              : slot),
                        }),
                        ...(snakeTransition &&
                        snakeSourceSlot &&
                        snakeDestinationSlot
                          ? {
                              '--discovery-card-opacity': 1,
                              '--discovery-card-motion-opacity':
                                snakeDestinationSlot.opacity,
                              zIndex: Math.max(
                                snakeSourceSlot.order,
                                snakeDestinationSlot.order,
                              ),
                            }
                          : {}),
                        ...(steadyGuardSlot
                          ? {
                              '--discovery-card-opacity': 1,
                              '--discovery-card-motion-opacity': 0,
                              zIndex: steadyGuardSlot.order,
                            }
                          : {}),
                        ...(selectionTransition &&
                        !selectionTraveler &&
                        previousSlot
                          ? {
                              zIndex:
                                previousSlotIndex === 0
                                  ? DISCOVERY_PREVIOUS_MAIN_Z_INDEX
                                  : previousSlot.order,
                            }
                          : {}),
                        ...(selectionTraveler && selectionSourceSlot
                          ? createDiscoverySelectionStyle(
                              selectionSourceSlot,
                              selectionTransition.startedFromHover,
                            )
                          : {}),
                      } as CSSProperties)
                  const reflectionActive =
                    DISCOVERY_RESULT_CORRIDOR_ENABLED
                      ? pose.active
                      : steadyGuardSlot === null

                  return (
                    <div
                      key={result.id}
                      ref={(element) => {
                        if (element) {
                          resultCardRefs.current.set(result.id, element)
                        } else {
                          resultCardRefs.current.delete(result.id)
                        }
                      }}
                      className={[
                        'discoveryResultCard',
                        visualSelected ? 'selected' : '',
                        DISCOVERY_RESULT_CORRIDOR_ENABLED && pose.front
                          ? 'isCorridorFront'
                          : '',
                        focused ? 'isHoverFocused' : '',
                        selectionTraveler ? 'isSelectionTraveler' : '',
                        selectionTraveler ? 'isSelectionMoving' : '',
                        materialMoving ? 'isSelectionMaterialMoving' : '',
                        steadyGuardSlot ? 'isPreloadGuard' : '',
                      ].filter(Boolean).join(' ')}
                      style={cardStyle}
                      data-selection-phase={
                        selectionTraveler ? 'moving' : undefined
                      }
                      data-discovery-reflection={
                        reflectionActive ? 'true' : undefined
                      }
                      data-discovery-reflection-id={result.id}
                      data-discovery-reflection-floor-anchor={
                        snakeTransition
                          ? snakeToSlotIndex === 0
                            ? 'true'
                            : undefined
                          : visualSelected
                            ? 'true'
                            : undefined
                      }
                      data-reflection-index={
                        reflectionActive ? slotIndex : undefined
                      }
                      data-depth-layer={
                        DISCOVERY_RESULT_CORRIDOR_ENABLED
                          ? pose.layer
                          : slot.layer
                      }
                      data-result-index={resultIndex}
                    >
                      <div
                        className="discoveryResultMotion"
                        data-page-grade="true"
                      >
                        <div
                          className="discoveryResultVisual"
                          data-discovery-reflection-id={result.id}
                          aria-hidden="true"
                        >
                          <span className="discoveryResultBackdrop" />
                          {result.thumbnail && (
                            <img
                              className="discoveryResultMedia"
                              src={resolveDocumentAssetUrl(result.thumbnail)}
                              alt=""
                              draggable="false"
                            />
                          )}
                          <img
                            className="discoveryResultFrame"
                            src={resolveDocumentAssetUrl(
                              './aurora/discovery-result-frame.png',
                            )}
                            alt=""
                            draggable="false"
                          />
                          <span className="discoveryCardTopline">
                            <time>{result.timecode}</time>
                            <span>
                              <em>
                                {result.resolutionLabel === 'ONLINE'
                                  ? '在线'
                                  : result.resolutionLabel}
                              </em>
                              <em data-source={result.source}>
                                {getDiscoverySourceLabel(result.source)}
                              </em>
                            </span>
                          </span>
                          <span
                            className={`discoveryCardCaption ${
                              result.detailType === 'media'
                                ? 'discoveryCardCaptionMedia'
                                : 'discoveryCardCaptionFootage'
                            }`}
                          >
                            {result.detailType === 'media' ? (
                              <>
                                <strong>{result.title}</strong>
                                <small>{result.media.englishTitle}</small>
                                <span className="discoveryCardMediaYear">
                                  {result.media.year}
                                </span>
                                <span className="discoveryCardMediaGenres">
                                  {result.media.genres.join(' / ')}
                                </span>
                              </>
                            ) : result.detailType === 'model' ? (
                              <>
                                <strong>{result.model.filename}</strong>
                                <span className="discoveryCardCaptionTags">
                                  {result.tags.slice(0, 3).map((tag) => (
                                    <i key={tag}>{tag}</i>
                                  ))}
                                </span>
                              </>
                            ) : result.detailType === 'online-video' ? (
                              <>
                                <strong>{result.title}</strong>
                                <small>
                                  {result.online.author ||
                                    getOnlineProviderLabel(result.online.provider)}
                                </small>
                                <span className="discoveryCardCaptionTags">
                                  {result.tags.slice(0, 3).map((tag) => (
                                    <i key={tag}>{tag}</i>
                                  ))}
                                </span>
                              </>
                            ) : (
                              <>
                                <strong>{result.footage.filename}</strong>
                                <span className="discoveryCardCaptionTags">
                                  {result.tags.slice(0, 3).map((tag) => (
                                    <i key={tag}>{tag}</i>
                                  ))}
                                </span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                      <button
                        className="discoveryResultHit"
                        type="button"
                        disabled={
                          !reflectionActive ||
                          isCorridorMoving ||
                          selectionTransition !== null ||
                          snakeTransition !== null
                        }
                        data-discovery-result-id={result.id}
                        aria-label={
                          resultActionGroup.primaryAction
                            ? `选择 ${result.secondaryLabel}，双击${resultActionGroup.primaryAction.label}`
                            : `选择 ${result.secondaryLabel}`
                        }
                        aria-pressed={selected}
                        onPointerEnter={(event) =>
                          handleResultPointerEnter(event, result.id)
                        }
                        onPointerLeave={() =>
                          scheduleResultHoverExit(result.id)
                        }
                        onPointerCancel={() =>
                          scheduleResultHoverExit(result.id)
                        }
                        onFocus={(event) => {
                          if (
                            !canPreviewResults ||
                            !event.currentTarget.matches(':focus-visible')
                          ) {
                            return
                          }
                          clearHoverExitTimer()
                          setHoveredId(result.id)
                        }}
                        onBlur={() => scheduleResultHoverExit(result.id)}
                        onClick={(event) => {
                          if (suppressNextResultClickRef.current) {
                            suppressNextResultClickRef.current = false
                            return
                          }
                          const canArmLocalDoubleClick =
                            !selectionLockRef.current &&
                            selectionTransition === null &&
                            !snakeLockRef.current &&
                            snakeTransition === null &&
                            !isCorridorMoving
                          handleSelectResult(result)
                          if (canArmLocalDoubleClick) {
                            armLocalDoubleClickBridge(result, event)
                          }
                        }}
                      />
                    </div>
                  )
                })}
              </div>

              {!isSearching && filteredResults.length === 0 && (
                <div
                  className="discoveryEmptyState"
                  role="status"
                  data-camera-gesture="block"
                  data-page-grade="true"
                >
                  <Search size={24} strokeWidth={1.35} aria-hidden="true" />
                  <strong>
                    {isOnlineMediaProvider(sourceFilter)
                      ? `没有找到相符的${getOnlineProviderLabel(sourceFilter)}内容`
                      : '没有找到相符画面'}
                  </strong>
                  <span>
                    {isOnlineMediaProvider(sourceFilter)
                      ? '试试更换关键词，结果会直接显示在 Aurora 卡片中。'
                      : '试试文件名、标签或备注，或放宽来源筛选。'}
                  </span>
                </div>
              )}
            </section>

            {selectedResult && (
              <aside
                ref={detailPanelRef}
                className="discoveryDetailPanel"
                aria-label={
                  selectedResult.detailType === 'online-video'
                    ? '当前选中在线视频信息'
                    : '当前选中影像信息'
                }
                data-camera-gesture="block"
                data-discovery-detail-reflection="true"
                data-reflection-index={
                  DISCOVERY_RESULT_CORRIDOR_ENABLED
                    ? corridorResults.length
                    : reflectionResults.length
                }
                data-page-grade="true"
              >
              <span className="discoveryDetailGlassAnchor discoveryDetailGlassAnchorTopLeft" />
              <span className="discoveryDetailGlassAnchor discoveryDetailGlassAnchorTopRight" />
              <span className="discoveryDetailGlassAnchor discoveryDetailGlassAnchorBottomRight" />
              <span className="discoveryDetailGlassAnchor discoveryDetailGlassAnchorBottomLeft" />
              <span className="discoveryDetailBackdrop" aria-hidden="true" />
              <img
                className="discoveryDetailChrome"
                src={resolveDocumentAssetUrl('./aurora/detail-panel.png')}
                alt=""
                draggable="false"
                aria-hidden="true"
              />
              <div className="discoveryDetailContent">
                    <div
                      className="discoveryDetailTabs"
                      role="tablist"
                      aria-label="详情内容"
                    >
                      {(
                        selectedResult.detailType === 'media'
                          ? ([
                              ['info', '媒体详情'],
                              ['source', '来源'],
                              ['related', '视觉索引'],
                            ] as const)
                          : selectedResult.detailType === 'model'
                            ? ([
                                ['info', '模型信息'],
                                ['source', '来源'],
                                ['related', '关联内容'],
                              ] as const)
                            : selectedResult.detailType === 'online-video'
                              ? ([
                                  [
                                    'info',
                                    selectedResult.online.mediaKind === 'episode'
                                      ? '影视信息'
                                      : '视频信息',
                                  ],
                                  ['source', '来源'],
                                  ['related', '关联内容'],
                                ] as const)
                          : ([
                              ['info', '素材信息'],
                              ['source', '来源'],
                              ['related', '关联内容'],
                            ] as const)
                      ).map(([tab, label]) => (
                        <button
                          key={tab}
                          type="button"
                          role="tab"
                          aria-selected={detailTab === tab}
                          onClick={() => setDetailTab(tab)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="discoveryDetailTabBody">
                      {detailTab === 'info' && (
                        <div className="discoveryDetailInfo">
                          {selectedResult.detailType === 'media' ? (
                            <dl className="discoveryMetadata discoveryMediaMetadata">
                              {[
                                ['视频名称', selectedResult.title],
                                ['英文名称', selectedResult.media.englishTitle],
                                ['年份', selectedResult.media.year],
                                [
                                  '类型',
                                  [
                                    selectedResult.media.type,
                                    ...selectedResult.media.genres,
                                  ].join(' · '),
                                ],
                                ['导演', selectedResult.media.director],
                                ['演员', selectedResult.media.cast.join('、')],
                                ['时长', selectedResult.duration],
                                ['分辨率', selectedResult.resolution],
                                ['HDR / 音频', selectedResult.media.hdrAudio],
                                ['来源', 'Emby'],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <dt>{label}</dt>
                                  <dd
                                    title={value}
                                    data-source={
                                      label === '来源'
                                        ? selectedResult.source
                                        : undefined
                                    }
                                  >
                                    {value}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : selectedResult.detailType === 'model' ? (
                            <dl className="discoveryMetadata">
                              {[
                                ['文件名', selectedResult.model.filename],
                                ['格式', selectedResult.model.format],
                                ['文件大小', selectedResult.model.size],
                                [
                                  '三角面',
                                  selectedResult.model.triangleCount === null
                                    ? '待分析'
                                    : selectedResult.model.triangleCount.toLocaleString('zh-CN'),
                                ],
                                [
                                  '顶点',
                                  selectedResult.model.vertexCount === null
                                    ? '待分析'
                                    : selectedResult.model.vertexCount.toLocaleString('zh-CN'),
                                ],
                                [
                                  '节点',
                                  selectedResult.model.nodeCount === null
                                    ? '待分析'
                                    : selectedResult.model.nodeCount.toLocaleString('zh-CN'),
                                ],
                                [
                                  '材质 / 贴图',
                                  `${selectedResult.model.materialCount ?? '—'} / ${selectedResult.model.textureCount ?? '—'}`,
                                ],
                                ['模型尺寸', selectedResult.model.dimensions],
                                ['导入时间', selectedResult.model.importedAt],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <dt>{label}</dt>
                                  <dd title={value}>{value}</dd>
                                </div>
                              ))}
                            </dl>
                          ) : selectedResult.detailType === 'online-video' ? (
                            <dl className="discoveryMetadata">
                              {[
                                ['视频名称', selectedResult.title],
                                [
                                  selectedResult.online.mediaKind === 'episode'
                                    ? '内容来源'
                                    : '发布者',
                                  selectedResult.online.author || '未公开',
                                ],
                                [
                                  '内容类型',
                                  selectedResult.online.mediaKind === 'episode'
                                    ? '影视专辑 / 单集'
                                    : '在线视频',
                                ],
                                ['视频 ID', selectedResult.online.mediaId],
                                [
                                  '时长',
                                  selectedResult.duration ||
                                    `以${getOnlineProviderLabel(selectedResult.online.provider)}页面为准`,
                                ],
                                ['发布时间', selectedResult.online.publishedAt || '未公开'],
                                [
                                  '来源',
                                  getOnlineProviderLabel(selectedResult.online.provider),
                                ],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <dt>{label}</dt>
                                  <dd
                                    title={value}
                                    data-source={
                                      label === '来源'
                                        ? selectedResult.online.provider
                                        : undefined
                                    }
                                  >
                                    {value}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : (
                            <dl className="discoveryMetadata">
                              {[
                                ['文件名', selectedResult.footage.filename],
                                ['分辨率', selectedResult.resolution],
                                ['帧率', selectedResult.footage.fps],
                                ['编码格式', selectedResult.footage.codec],
                                ['文件大小', selectedResult.footage.size],
                                ['拍摄日期', selectedResult.footage.capturedAt],
                                ['摄影机型号', selectedResult.footage.camera],
                                ['存储路径', selectedResult.footage.sourcePath],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <dt>{label}</dt>
                                  <dd title={value}>{value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}

                          <section
                            className="discoveryMetadataTagSection"
                            aria-label="标签"
                          >
                            <h2>标签</h2>
                            <div>
                              {selectedResult.tags.slice(0, 8).map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                              {selectedResult.detailType !== 'online-video' && (
                                <button
                                  type="button"
                                  aria-label="添加标签"
                                  onClick={() =>
                                    setOperationStatus(
                                      '标签编辑将在素材索引接入后启用',
                                    )
                                  }
                                >
                                  <Plus
                                    size={12}
                                    strokeWidth={1.5}
                                    aria-hidden="true"
                                  />
                                </button>
                              )}
                            </div>
                          </section>
                        </div>
                      )}

                      {detailTab === 'source' && (
                        <dl className="discoveryMetadata discoverySourceMetadata">
                          {(selectedResult.detailType === 'media'
                            ? [
                                ['来源', 'Emby 媒体库'],
                                ['媒体类型', selectedResult.media.type],
                                ['所属资料库', selectedResult.sourceCollection],
                                ['媒体年份', selectedResult.media.year],
                              ]
                            : selectedResult.detailType === 'model'
                              ? [
                                  ['来源', 'Aurora 本地三维资产库'],
                                  ['所属项目', selectedResult.model.project],
                                  ['导入时间', selectedResult.model.importedAt],
                                  ['存储位置', selectedResult.model.sourcePath],
                                ]
                              : selectedResult.detailType === 'online-video'
                                ? [
                                    [
                                      '来源',
                                      `${getOnlineProviderLabel(selectedResult.online.provider)}官方页面`,
                                    ],
                                    [
                                      '账号权益',
                                      `由${getOnlineProviderLabel(selectedResult.online.provider)}播放器实时判断`,
                                    ],
                                    ['视频 ID', selectedResult.online.mediaId],
                                    ['原始地址', selectedResult.online.canonicalUrl],
                                  ]
                              : [
                                [
                                  '来源',
                                  selectedResult.source === 'local'
                                    ? 'Aurora 本地素材库'
                                    : 'NAS 媒体存储',
                                ],
                                ['所属项目', selectedResult.sourceCollection],
                                ['拍摄日期', selectedResult.footage.capturedAt],
                                ['存储位置', selectedResult.footage.sourcePath],
                              ]
                          ).map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd
                                title={value}
                                data-source={
                                  label === '来源'
                                    ? selectedResult.source
                                    : undefined
                                }
                              >
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}

                      {detailTab === 'related' &&
                        (selectedResult.detailType === 'media' ? (
                          <div className="discoveryIndexSummary">
                            <div className="discoveryIndexLead">
                              <strong>Aurora 视觉索引</strong>
                              <span
                                className="discoveryIndexBadge"
                                data-status={selectedVisualIndexStatus}
                              >
                                {INDEX_STATUS_LABELS[selectedVisualIndexStatus]}
                              </span>
                            </div>
                            <dl className="discoveryIndexMetrics">
                              {[
                                [
                                  '是否已生成',
                                  selectedVisualIndexStatus === 'ready'
                                    ? '是'
                                    : '否',
                                ],
                                [
                                  '关键帧数量',
                                  selectedVisualIndexStatus === 'ready'
                                    ? (selectedVisualIndexCounts?.keyframeCount ?? 0).toLocaleString(
                                        'zh-CN',
                                      )
                                    : '—',
                                ],
                                [
                                  '精彩片段数量',
                                  selectedVisualIndexStatus === 'ready'
                                    ? (selectedVisualIndexCounts?.highlightCount ?? 0).toLocaleString(
                                        'zh-CN',
                                      )
                                    : '—',
                                ],
                                [
                                  '收藏数量',
                                  selectedFavoriteCount.toLocaleString('zh-CN'),
                                ],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <dt>{label}</dt>
                                  <dd>{value}</dd>
                                </div>
                              ))}
                            </dl>
                            <p className="discoveryIndexNote">
                              Aurora
                              只保存媒体信息、抽帧索引与关键帧关联，原视频继续由
                              Emby 提供。
                            </p>
                          </div>
                        ) : selectedResult.detailType === 'model' ? (
                          <div className="discoveryRelatedPlaceholder">
                            <strong>{selectedResult.model.project}</strong>
                            <span>
                              {selectedResult.description || '暂无模型备注。'}
                            </span>
                          </div>
                        ) : selectedResult.detailType === 'online-video' ? (
                          <div className="discoveryRelatedPlaceholder">
                            <strong>
                              {selectedResult.online.projectIds.length > 0
                                ? `已加入 ${selectedResult.online.projectIds.length} 个项目`
                                : '尚未加入项目'}
                            </strong>
                            <span>
                              {selectedResult.online.favorite
                                ? `已收藏到 Aurora；视频仍由${getOnlineProviderLabel(selectedResult.online.provider)}官方页面提供。`
                                : '可收藏或加入项目；Aurora 不下载视频，也不建立帧环。'}
                            </span>
                          </div>
                        ) : (
                          <div className="discoveryRelatedPlaceholder">
                            <strong>关联内容</strong>
                            <span>真实索引接入后显示同项目与相似画面。</span>
                          </div>
                        ))}
                    </div>

                    <div className="discoveryOperationStatus" role="status" aria-live="polite">
                      {operationStatus}
                    </div>

                    {selectedActionGroup &&
                      selectedActionGroup.actions.length > 0 && (
                        <div
                          className="discoveryDetailActions"
                          aria-label={
                            selectedResult.detailType === 'model'
                              ? '三维操作'
                              : selectedResult.detailType === 'online-video'
                                ? '在线视频操作'
                              : '影像操作'
                          }
                          data-action-layout={selectedActionGroup.layout}
                        >
                          {selectedActionGroup.actions.map((action) => (
                            <button
                              key={action.id}
                              type="button"
                              className={action.primary ? 'primary' : ''}
                              onClick={() =>
                                executeResultAction(selectedResult, action.id)
                              }
                            >
                              {renderDiscoveryActionIcon(action.icon)}
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
              </div>
              </aside>
            )}
            </div>
          </div>
        )}

        {showResults && (
          <footer
            className="discoveryFooter"
            aria-live="polite"
            data-page-grade="true"
          >
            <div>
              <strong>{visibleResultCount}</strong>
              <span>
                {visibleOnlineTotalCount !== null &&
                visibleOnlineTotalCount > visibleResultCount
                  ? ` 条已加载 / 共 ${visibleOnlineTotalCount} 条`
                  : '条结果'}
              </span>
            </div>
            <span>{activeFilterSummary}</span>
            <span>查询：{committedQuery || '全部画面'}</span>
          </footer>
        )}
        </div>
      </section>
    </>
  )
}
