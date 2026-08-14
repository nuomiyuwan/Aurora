import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { ChevronLeft, ChevronRight, Star } from 'lucide-react'
import type { Project } from '../../data/projects'
import type { BackgroundReflectionSurface } from '../reflection/backgroundReflectionSurfaceProtocol'
import { GalleryReflectionCanvas } from '../project-gallery/GalleryReflectionCanvas'
import { HOME_CARD_ALPHA_BOUNDS } from '../project-gallery/galleryCardLayout'
import {
  readWheelDragSample,
  resolveTrackpadSnapTarget,
  resolveWheelDragPreviewPosition,
  TRACKPAD_SNAP_COMMIT_PROGRESS,
  type WheelDragAxis,
  WHEEL_DRAG_END_DELAY,
} from '../wheelDragGesture'
import {
  drawFavoritesDomReflectionTexture,
} from './drawFavoritesDomReflectionTexture'
import { getFavoritesCardStyle } from './favoritesCardTuning'
import {
  FAVORITES_CARD_HOLDER_LIFT_TO_CARD_WIDTH,
  FAVORITES_CARD_INSERTION_CLIP_TO_CARD_WIDTH,
  FAVORITES_CARD_VERTICAL_OFFSET_PX,
  FAVORITES_PEDESTAL_RENDER_HEIGHT_TO_CARD_WIDTH,
} from './favoritesPedestalLayout'
import { FavoritesPedestalCanvas } from './FavoritesPedestalCanvas'
import { DEFAULT_FAVORITES_PEDESTAL_LOOK_ID } from './favoritesPedestalMaterial'
import { sampleFavoritesGallery } from './favoritesReflectionProjection'
import './FavoritesGalleryView.css'

export type FavoriteGalleryKind =
  | 'frame'
  | 'clip'
  | 'video'
  | 'model'
  | 'online'

export type FavoriteGallerySource =
  | { type: 'media'; assetId: string }
  | { type: 'frame'; assetId: string; frameId: string }
  | { type: 'model'; assetId: string }
  | { type: 'preview'; projectId: string }

export interface FavoriteGalleryItem {
  id: string
  kind: FavoriteGalleryKind
  title: string
  titleSuffix?: string
  label: string
  rating?: number
  meta: string
  tags: readonly string[]
  statusBadges?: readonly string[]
  cover: string
  source: FavoriteGallerySource
}

interface FavoritesGalleryViewProps {
  active: boolean
  items: readonly FavoriteGalleryItem[]
  cameraYaw: number
  cameraPitch: number
  suspended: boolean
  materialTint?: string
  pedestalTint?: string
  surfaceData?: BackgroundReflectionSurface | null
  layoutSignal: string
  textRasterRevision: string
  onToggleFavorite?: (item: FavoriteGalleryItem) => void
  onOpenItem?: (item: FavoriteGalleryItem) => void
}

type FilterId = 'all' | FavoriteGalleryKind

const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: 'all', label: '全部收藏' },
  { id: 'frame', label: '单帧画面' },
  { id: 'clip', label: '视频片段' },
  { id: 'video', label: '视频素材' },
  { id: 'model', label: '三维资产' },
  { id: 'online', label: '在线收藏' },
]

const HOME_CARD_SOURCE_WIDTH = 1448
const HOME_CARD_SOURCE_HEIGHT = 1080
const HOME_CARD_ALPHA_BOTTOM_RATIO =
  HOME_CARD_ALPHA_BOUNDS.bottom / HOME_CARD_SOURCE_HEIGHT
const HOME_CARD_ALPHA_TOP_RATIO =
  HOME_CARD_ALPHA_BOUNDS.top / HOME_CARD_SOURCE_HEIGHT
const HOME_CARD_ALPHA_LEFT_RATIO =
  HOME_CARD_ALPHA_BOUNDS.left / HOME_CARD_SOURCE_WIDTH
const HOME_CARD_ALPHA_RIGHT_RATIO =
  HOME_CARD_ALPHA_BOUNDS.right / HOME_CARD_SOURCE_WIDTH
const HOME_CARD_ALPHA_CENTER_X_RATIO =
  ((HOME_CARD_ALPHA_BOUNDS.left + HOME_CARD_ALPHA_BOUNDS.right) / 2) /
  HOME_CARD_SOURCE_WIDTH
const POINTER_DRAG_THRESHOLD = 5
const FAVORITES_STEP_RELEASE_DURATION_MS = 520
const FAVORITES_RELEASE_SETTLE_PADDING_MS = 40
const FAVORITES_RELEASE_MIN_DURATION_MS = 300
const FAVORITES_RELEASE_MAX_DURATION_MS = 620

const FAVORITES_CAMERA_PITCH_OFFSET_DEG = -5
const FAVORITES_SCENE_VERTICAL_OFFSET_PX = 10

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const normalizeFrameRating = (rating?: number) =>
  Math.round(clamp(Number.isFinite(rating) ? rating! : 0, 0, 5))

const wrapIndex = (index: number, count: number) =>
  count > 0 ? (index + count) % count : 0

const getRelativeIndex = (index: number, activeIndex: number, count: number) => {
  if (count <= 1) return 0
  let relative = index - activeIndex
  while (relative > count / 2) relative -= count
  while (relative < -count / 2) relative += count
  return relative
}

const getFavoritesCarouselOffsets = (
  itemCount: number,
  realtimeMotion: boolean,
) => {
  if (itemCount < 5) return null
  return realtimeMotion
    ? [-3, -2, -1, 0, 1, 2, 3]
    : [-2, -1, 0, 1, 2]
}

const createReflectionProject = (
  item: FavoriteGalleryItem,
  favorite: boolean,
): Project => ({
  id: item.id,
  kind: item.kind === 'model' ? '3d' : 'video',
  title: item.title,
  subtitle: item.label,
  cover: item.cover,
  videoCount: 0,
  collectionCount: 0,
  updatedAt: [
    item.meta,
    item.titleSuffix ?? '',
    String(item.rating ?? 0),
    item.statusBadges?.join(',') ?? '',
    item.tags.join(','),
    String(favorite),
  ].join('|'),
})

function FavoriteCardRaster({
  item,
  favorite,
  textRasterRevision,
}: {
  item: FavoriteGalleryItem
  favorite: boolean
  textRasterRevision: string
}) {
  return (
    <div
      className="favoritesCardRaster"
      style={{ '--favorite-cover': `url("${item.cover.replaceAll('"', '\\"')}")` } as CSSProperties}
    >
      <span className="favoritesCardCover" aria-hidden="true" />
      <span className="favoritesCardFrame" aria-hidden="true" />
      <span className="favoritesCardLight" aria-hidden="true" />
      <span
        key={`${item.id}:${textRasterRevision}:topline`}
        className="favoritesCardTopline"
      >
        <em>{item.label}</em>
        {item.kind === 'frame' && normalizeFrameRating(item.rating) > 0 && (
          <span
            className="favoritesCardRating"
            aria-label={`${normalizeFrameRating(item.rating)} 星`}
          >
            {Array.from(
              { length: normalizeFrameRating(item.rating) },
              (_, index) => (
                <Star
                  key={index}
                  size={8}
                  strokeWidth={1.25}
                  fill="currentColor"
                  aria-hidden="true"
                />
              ),
            )}
          </span>
        )}
        <span className="favoritesCardTopActions">
          {item.statusBadges && item.statusBadges.length > 0 && (
            <span className="favoritesCardStatusList">
              {item.statusBadges.slice(0, 2).map((badge) => (
                <i key={badge}>{badge}</i>
              ))}
            </span>
          )}
          <span
            className={`favoritesCardFavorite${favorite ? ' isFavorite' : ''}`}
            aria-hidden="true"
          >
            <Star
              size={12}
              strokeWidth={1.5}
              fill={favorite ? 'currentColor' : 'none'}
            />
          </span>
        </span>
      </span>
      <span
        key={`${item.id}:${textRasterRevision}:card`}
        className={`favoritesCardCopy${item.tags.length > 0 ? ' hasTags' : ''}`}
      >
        <strong>
          <span className="favoritesCardTitleText">{item.title}</span>
          {item.titleSuffix && (
            <span className="favoritesCardTitleSuffix">
              {item.titleSuffix}
            </span>
          )}
        </strong>
        <small>{item.meta}</small>
        {item.tags.length > 0 && (
          <span className="favoritesCardTagList">
            {item.tags.slice(0, 3).map((tag) => (
              <i key={tag}>{tag}</i>
            ))}
          </span>
        )}
      </span>
    </div>
  )
}

export function FavoritesGalleryView({
  active,
  items,
  cameraYaw,
  cameraPitch,
  suspended,
  materialTint = '#aec5ff',
  pedestalTint = '#555d66',
  surfaceData = null,
  layoutSignal,
  textRasterRevision,
  onToggleFavorite,
  onOpenItem,
}: FavoritesGalleryViewProps) {
  const [activeFilter, setActiveFilter] = useState<FilterId>('all')
  const [activeIndex, setActiveIndex] = useState(0)
  const [dragProgress, setDragProgress] = useState(0)
  const [isCardDragging, setIsCardDragging] = useState(false)
  const [isCardReleasing, setIsCardReleasing] = useState(false)
  const [isCardRecycling, setIsCardRecycling] = useState(false)
  const [releaseDuration, setReleaseDuration] = useState(
    FAVORITES_STEP_RELEASE_DURATION_MS,
  )
  const [previewFavoriteIds, setPreviewFavoriteIds] = useState(
    () => new Set(items.filter((item) => item.source.type === 'preview').map((item) => item.id)),
  )
  const stageRef = useRef<HTMLDivElement>(null)
  const dragProgressRef = useRef(0)
  const releaseTimerRef = useRef<number | undefined>(undefined)
  const releaseRafRef = useRef<number | undefined>(undefined)
  const recycleRafRef = useRef<number | undefined>(undefined)
  const wheelPreviewRafRef = useRef<number | undefined>(undefined)
  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
  })
  const suppressClickRef = useRef(false)
  const wheelRef = useRef({
    active: false,
    progress: 0,
    visualProgress: 0,
    previewStartProgress: 0,
    snapTargetProgress: 0,
    lastTime: 0,
    velocity: 0,
    axis: null as WheelDragAxis | null,
    releaseTimer: undefined as number | undefined,
  })

  const counts = useMemo(() => {
    const next: Record<FilterId, number> = {
      all: items.length,
      frame: 0,
      clip: 0,
      video: 0,
      model: 0,
      online: 0,
    }
    items.forEach((item) => {
      next[item.kind] += 1
    })
    return next
  }, [items])

  const visibleItems = useMemo(
    () =>
      activeFilter === 'all'
        ? [...items]
        : items.filter((item) => item.kind === activeFilter),
    [activeFilter, items],
  )

  const updateDragProgress = (nextProgress: number) => {
    dragProgressRef.current = nextProgress
    setDragProgress(nextProgress)
  }

  const cancelWheelPreview = () => {
    if (wheelPreviewRafRef.current === undefined) return
    window.cancelAnimationFrame(wheelPreviewRafRef.current)
    wheelPreviewRafRef.current = undefined
  }

  const resetWheelGesture = () => {
    const wheelState = wheelRef.current
    if (wheelState.releaseTimer !== undefined) {
      window.clearTimeout(wheelState.releaseTimer)
    }
    cancelWheelPreview()
    wheelState.active = false
    wheelState.progress = 0
    wheelState.visualProgress = 0
    wheelState.previewStartProgress = 0
    wheelState.snapTargetProgress = 0
    wheelState.lastTime = 0
    wheelState.velocity = 0
    wheelState.axis = null
    wheelState.releaseTimer = undefined
  }

  const cancelReleaseMotion = () => {
    if (releaseTimerRef.current !== undefined) {
      window.clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = undefined
    }
    if (releaseRafRef.current !== undefined) {
      window.cancelAnimationFrame(releaseRafRef.current)
      releaseRafRef.current = undefined
    }
    if (recycleRafRef.current !== undefined) {
      window.cancelAnimationFrame(recycleRafRef.current)
      recycleRafRef.current = undefined
    }
  }

  useEffect(() => {
    cancelReleaseMotion()
    resetWheelGesture()
    dragRef.current.active = false
    setActiveIndex(0)
    updateDragProgress(0)
    setIsCardDragging(false)
    setIsCardReleasing(false)
    setIsCardRecycling(false)
  }, [activeFilter])

  useEffect(() => {
    setActiveIndex((current) =>
      visibleItems.length > 0 ? wrapIndex(current, visibleItems.length) : 0,
    )
  }, [visibleItems.length])

  useEffect(() => {
    setPreviewFavoriteIds((current) => {
      const next = new Set(current)
      items.forEach((item) => {
        if (item.source.type === 'preview' && !next.has(item.id)) next.add(item.id)
      })
      return next
    })
  }, [items])

  useEffect(
    () => () => {
      if (wheelRef.current.releaseTimer !== undefined) {
        window.clearTimeout(wheelRef.current.releaseTimer)
      }
      if (wheelPreviewRafRef.current !== undefined) {
        window.cancelAnimationFrame(wheelPreviewRafRef.current)
      }
      if (releaseTimerRef.current !== undefined) {
        window.clearTimeout(releaseTimerRef.current)
      }
      if (releaseRafRef.current !== undefined) {
        window.cancelAnimationFrame(releaseRafRef.current)
      }
      if (recycleRafRef.current !== undefined) {
        window.cancelAnimationFrame(recycleRafRef.current)
      }
    },
    [],
  )

  const startCarouselRelease = (
    targetProgress: number,
    duration: number,
  ) => {
    if (
      visibleItems.length <= 1 ||
      releaseTimerRef.current !== undefined ||
      releaseRafRef.current !== undefined ||
      recycleRafRef.current !== undefined
    ) {
      return
    }

    const resolvedTarget = clamp(targetProgress, -1, 1)
    const step = resolvedTarget < 0 ? 1 : resolvedTarget > 0 ? -1 : 0
    const resolvedDuration = Math.round(clamp(
      duration,
      FAVORITES_RELEASE_MIN_DURATION_MS,
      FAVORITES_RELEASE_MAX_DURATION_MS,
    ))

    resetWheelGesture()
    setIsCardDragging(false)
    setIsCardReleasing(true)
    setReleaseDuration(resolvedDuration)
    updateDragProgress(dragProgressRef.current)

    releaseRafRef.current = window.requestAnimationFrame(() => {
      releaseRafRef.current = window.requestAnimationFrame(() => {
        releaseRafRef.current = undefined
        updateDragProgress(resolvedTarget)

        releaseTimerRef.current = window.setTimeout(() => {
          if (step !== 0) {
            setActiveIndex((current) =>
              wrapIndex(current + step, visibleItems.length),
            )
            setIsCardRecycling(true)
          }
          setIsCardReleasing(false)
          updateDragProgress(0)
          suppressClickRef.current = false
          releaseTimerRef.current = undefined

          if (step !== 0) {
            recycleRafRef.current = window.requestAnimationFrame(() => {
              recycleRafRef.current = window.requestAnimationFrame(() => {
                recycleRafRef.current = undefined
                setIsCardRecycling(false)
              })
            })
          }
        }, resolvedDuration + FAVORITES_RELEASE_SETTLE_PADDING_MS)
      })
    })
  }

  const animateCarouselStep = (step: number) => {
    const resolvedStep = Math.sign(step)
    if (resolvedStep === 0) return
    updateDragProgress(0)
    startCarouselRelease(
      resolvedStep > 0 ? -1 : 1,
      FAVORITES_STEP_RELEASE_DURATION_MS,
    )
  }

  const selectItem = (index: number) => {
    if (
      isCardReleasing ||
      isCardRecycling ||
      releaseTimerRef.current !== undefined ||
      releaseRafRef.current !== undefined
    ) {
      return
    }
    if (index === activeIndex) {
      onOpenItem?.(visibleItems[index])
      return
    }
    let offset = index - activeIndex
    if (Math.abs(offset) > visibleItems.length / 2) {
      offset -= Math.sign(offset) * visibleItems.length
    }
    animateCarouselStep(Math.sign(offset))
  }

  const getDragDistance = () => {
    const width = stageRef.current?.getBoundingClientRect().width ?? window.innerWidth
    return clamp(width * 0.18, 190, 330)
  }

  const handleCardPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (
      event.button !== 0 ||
      visibleItems.length <= 1 ||
      isCardReleasing ||
      isCardRecycling ||
      releaseTimerRef.current !== undefined ||
      releaseRafRef.current !== undefined
    ) {
      return
    }
    event.stopPropagation()
    resetWheelGesture()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* Synthetic QA events and older embedded Chromium may not expose capture. */
    }
    dragRef.current = {
      active: true,
      moved: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
    }
  }

  const handleCardPointerMove = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const gesture = dragRef.current
    if (!gesture.active || gesture.pointerId !== event.pointerId) return
    const delta = event.clientX - gesture.startX
    if (!gesture.moved && Math.abs(delta) < POINTER_DRAG_THRESHOLD) return
    event.stopPropagation()
    event.preventDefault()
    gesture.moved = true
    const elapsed = Math.max(1, event.timeStamp - gesture.lastTime)
    gesture.velocity = (event.clientX - gesture.lastX) / elapsed
    gesture.lastX = event.clientX
    gesture.lastTime = event.timeStamp
    setIsCardDragging(true)
    updateDragProgress(clamp(delta / getDragDistance(), -1, 1))
  }

  const finishCardPointer = (
    event: ReactPointerEvent<HTMLElement>,
    commit: boolean,
  ) => {
    const gesture = dragRef.current
    if (!gesture.active || gesture.pointerId !== event.pointerId) return
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* The pointer may already have been released by the host window. */
      }
    }
    const currentProgress = dragProgressRef.current
    const projected = currentProgress + gesture.velocity * 110 / getDragDistance()
    const didMove = gesture.moved
    const targetProgress =
      commit &&
      didMove &&
      Math.abs(projected) >= TRACKPAD_SNAP_COMMIT_PROGRESS
      ? projected < 0
        ? -1
        : 1
      : 0
    suppressClickRef.current = didMove
    dragRef.current.active = false
    dragRef.current.moved = false
    setIsCardDragging(false)
    if (!didMove) {
      updateDragProgress(0)
      return
    }

    const duration = Math.round(clamp(
      Math.abs(targetProgress - currentProgress) * 520 +
        180 -
        Math.abs(gesture.velocity) * 80,
      FAVORITES_RELEASE_MIN_DURATION_MS,
      FAVORITES_RELEASE_MAX_DURATION_MS,
    ))
    startCarouselRelease(targetProgress, duration)
  }

  const scheduleWheelPreview = () => {
    if (wheelPreviewRafRef.current !== undefined) return

    const animate = (now: number) => {
      const wheelState = wheelRef.current
      if (!wheelState.active || wheelState.axis !== 'x') {
        wheelPreviewRafRef.current = undefined
        return
      }
      const idleDuration = now - wheelState.lastTime
      if (idleDuration >= WHEEL_DRAG_END_DELAY) {
        wheelPreviewRafRef.current = undefined
        return
      }
      wheelState.visualProgress = resolveWheelDragPreviewPosition(
        wheelState.previewStartProgress,
        wheelState.snapTargetProgress,
        idleDuration,
      )
      updateDragProgress(wheelState.visualProgress)
      wheelPreviewRafRef.current = window.requestAnimationFrame(animate)
    }

    wheelPreviewRafRef.current = window.requestAnimationFrame(animate)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (visibleItems.length <= 1 || dragRef.current.active) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest(
        'button:not(.favoritesGalleryCardHitTarget):not(.favoritesGalleryFavoriteHitTarget), input',
      )
    ) {
      return
    }
    const state = wheelRef.current
    const distance = getDragDistance()
    const pageExtent =
      stageRef.current?.getBoundingClientRect().height ?? window.innerHeight
    const sample = readWheelDragSample(
      event,
      pageExtent,
      state.active ? state.axis : null,
    )
    if (
      !sample ||
      sample.axis !== 'x' ||
      (!state.active && !sample.moves)
    ) {
      return
    }
    if (
      !state.active &&
      (
        isCardReleasing ||
        isCardRecycling ||
        releaseTimerRef.current !== undefined ||
        releaseRafRef.current !== undefined ||
        recycleRafRef.current !== undefined
      )
    ) {
      return
    }

    const now = performance.now()
    event.preventDefault()
    event.stopPropagation()
    if (!state.active) {
      state.active = true
      state.progress = dragProgressRef.current
      state.visualProgress = dragProgressRef.current
      state.previewStartProgress = dragProgressRef.current
      state.snapTargetProgress = 0
      state.lastTime = now
      state.velocity = 0
      state.axis = sample.axis
      setIsCardDragging(true)
      suppressClickRef.current = true
    } else if (sample.moves) {
      const elapsed = Math.max(16, now - state.lastTime)
      state.velocity = (-sample.delta / distance) / elapsed
      state.lastTime = now
    } else {
      state.velocity = 0
    }

    if (sample.moves) {
      let nextProgress = state.progress - sample.delta / distance
      let nextVisualProgress =
        state.visualProgress - sample.delta / distance
      let didCycle = false

      while (nextProgress <= -1) {
        setActiveIndex((current) =>
          wrapIndex(current + 1, visibleItems.length),
        )
        nextProgress += 1
        nextVisualProgress += 1
        didCycle = true
      }
      while (nextProgress >= 1) {
        setActiveIndex((current) =>
          wrapIndex(current - 1, visibleItems.length),
        )
        nextProgress -= 1
        nextVisualProgress -= 1
        didCycle = true
      }
      if (didCycle) state.velocity = 0

      state.progress = nextProgress
      state.visualProgress = nextVisualProgress
      state.previewStartProgress = nextVisualProgress
      state.snapTargetProgress = resolveTrackpadSnapTarget(
        0,
        clamp(nextProgress, -1, 1),
        -1,
        1,
      )
      updateDragProgress(nextVisualProgress)
      scheduleWheelPreview()

      if (state.releaseTimer !== undefined) {
        window.clearTimeout(state.releaseTimer)
      }
      state.releaseTimer = window.setTimeout(() => {
        const currentProgress = dragProgressRef.current
        const targetProgress = state.snapTargetProgress
        const duration = Math.round(clamp(
          Math.abs(targetProgress - currentProgress) * 520 +
            180 -
            Math.abs(state.velocity) * 80,
          FAVORITES_RELEASE_MIN_DURATION_MS,
          FAVORITES_RELEASE_MAX_DURATION_MS,
        ))
        state.active = false
        state.releaseTimer = undefined
        cancelWheelPreview()
        startCarouselRelease(targetProgress, duration)
      }, WHEEL_DRAG_END_DELAY)
    }
  }

  const toggleItemFavorite = (item: FavoriteGalleryItem) => {
    if (item.source.type === 'preview') {
      setPreviewFavoriteIds((current) => {
        const next = new Set(current)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      return
    }
    onToggleFavorite?.(item)
  }

  const renderedCards = useMemo(
    () => {
      const keepMotionEdgeVisible = isCardDragging || isCardReleasing
      const carouselOffsets = getFavoritesCarouselOffsets(
        visibleItems.length,
        keepMotionEdgeVisible,
      )

      if (carouselOffsets) {
        return carouselOffsets.map((carouselOffset) => {
          const index = wrapIndex(
            activeIndex + carouselOffset,
            visibleItems.length,
          )
          const item = visibleItems[index]
          const relative = carouselOffset + dragProgress
          return {
            carouselKey: `favorites-slot-${carouselOffset}`,
            carouselOffset,
            item,
            index,
            relative,
            style: getFavoritesCardStyle(relative, keepMotionEdgeVisible),
          }
        })
      }

      return visibleItems.flatMap((item, index) => {
        const relative =
          getRelativeIndex(index, activeIndex, visibleItems.length) +
          dragProgress
        if (Math.abs(relative) > 2.85) return []
        return [{
          carouselKey: `favorites-item-${item.id}`,
          carouselOffset: relative - dragProgress,
          item,
          index,
          relative,
          style: getFavoritesCardStyle(relative, keepMotionEdgeVisible),
        }]
      })
    },
    [activeIndex, dragProgress, isCardDragging, isCardReleasing, visibleItems],
  )
  const reflectionProjects = useMemo<Project[]>(
    () =>
      renderedCards.map(({ item }) =>
        createReflectionProject(
          item,
          item.source.type === 'preview'
            ? previewFavoriteIds.has(item.id)
            : true,
        ),
      ),
    [previewFavoriteIds, renderedCards],
  )
  const preloadReflectionProjects = useMemo<Project[]>(() => {
    if (visibleItems.length <= reflectionProjects.length) return []
    const renderedIds = new Set(reflectionProjects.map((project) => project.id))
    const candidates = [-3, 3]
      .map((offset) => visibleItems[wrapIndex(activeIndex + offset, visibleItems.length)])
      .filter(
        (item, index, source): item is FavoriteGalleryItem =>
          Boolean(item) &&
          source.findIndex((candidate) => candidate?.id === item.id) === index &&
          !renderedIds.has(item.id),
      )
    return candidates.map((item) =>
      createReflectionProject(
        item,
        item.source.type === 'preview'
          ? previewFavoriteIds.has(item.id)
          : true,
      ),
    )
  }, [activeIndex, previewFavoriteIds, reflectionProjects, visibleItems])
  const favoritesCameraPitch = cameraPitch + FAVORITES_CAMERA_PITCH_OFFSET_DEG
  const motionSignal = `${activeFilter}|${activeIndex}|${dragProgress.toFixed(4)}|${isCardDragging}|${isCardReleasing}|${isCardRecycling}|${releaseDuration}|${cameraYaw.toFixed(4)}|${favoritesCameraPitch.toFixed(4)}|${FAVORITES_SCENE_VERTICAL_OFFSET_PX}|${reflectionProjects.map((project) => project.updatedAt).join(',')}`
  const motionClassName = [
    'favoritesGalleryView',
    isCardDragging ? 'isCardDragging' : '',
    isCardReleasing ? 'isCardReleasing' : '',
    isCardRecycling ? 'isCardRecycling' : '',
  ].filter(Boolean).join(' ')
  return (
    <>
      <section
        className={motionClassName}
        data-page-active={active}
        aria-hidden={!active || undefined}
        inert={!active}
        aria-label="收藏展馆"
        onWheelCapture={handleWheel}
        style={
          {
            '--favorites-alpha-bottom-inset':
              `${(1 - HOME_CARD_ALPHA_BOTTOM_RATIO) * 100}%`,
            '--favorites-alpha-top': `${HOME_CARD_ALPHA_TOP_RATIO * 100}%`,
            '--favorites-alpha-left': `${HOME_CARD_ALPHA_LEFT_RATIO * 100}%`,
            '--favorites-alpha-right-inset':
              `${(1 - HOME_CARD_ALPHA_RIGHT_RATIO) * 100}%`,
            '--favorites-alpha-center-x': HOME_CARD_ALPHA_CENTER_X_RATIO,
            '--favorites-card-holder-translate-y':
              `calc(var(--favorites-card-source-width) * -${FAVORITES_CARD_HOLDER_LIFT_TO_CARD_WIDTH} + ${FAVORITES_CARD_VERTICAL_OFFSET_PX}px)`,
            '--favorites-card-insertion-clip':
              `calc(var(--favorites-card-source-width) * ${FAVORITES_CARD_INSERTION_CLIP_TO_CARD_WIDTH} + ${FAVORITES_CARD_VERTICAL_OFFSET_PX}px)`,
            '--favorites-pedestal-render-height':
              `calc(var(--favorites-card-source-width) * ${FAVORITES_PEDESTAL_RENDER_HEIGHT_TO_CARD_WIDTH})`,
            '--favorites-camera-pitch': `${favoritesCameraPitch}deg`,
            '--favorites-scene-offset-y':
              `calc(${FAVORITES_SCENE_VERTICAL_OFFSET_PX}px * var(--layout-scale, 1))`,
            '--favorites-release-duration': `${releaseDuration}ms`,
          } as CSSProperties
        }
      >
        <header className="favoritesGalleryIntro videoLibraryHeader">
          <div className="videoLibraryTitleLine">
            <h1>收藏展馆</h1>
          </div>
          <p>把值得回看的灵感，陈列在自己的光里</p>
        </header>

      <div
        ref={stageRef}
        className="favoritesGalleryStage"
        data-page-active={active}
      >
        <GalleryReflectionCanvas
          active={active}
          suspended={suspended}
          stageRef={stageRef}
          projects={reflectionProjects}
          preloadProjects={preloadReflectionProjects}
          motionSignal={motionSignal}
          layoutSignal={layoutSignal}
          cameraYaw={cameraYaw}
          cameraPitch={favoritesCameraPitch}
          materialTint={materialTint}
          surfaceData={surfaceData}
          canvasClassName="favoritesReflectionCanvas"
          rendererName="favorites-reflection"
          sourceCapacity={7}
          sourceContactOverlapPixels={0}
          lockReflectionToSourceCoverage
          sourceLightAsset=""
          textureAssetVersion="favorites-dom-reflection-v12"
          textureRevisionSalt="favorites-card-pedestal-occlusion-v8:frosted-alloy"
          sampleStage={sampleFavoritesGallery}
          drawReflectionTexture={(project, width, options) =>
            drawFavoritesDomReflectionTexture(
              project,
              width,
              options,
            )
          }
        />

        <FavoritesPedestalCanvas
          active={active}
          suspended={suspended}
          lookId={DEFAULT_FAVORITES_PEDESTAL_LOOK_ID}
          stageRef={stageRef}
          cardIds={renderedCards.map(({ carouselKey }) => carouselKey)}
          motionSignal={motionSignal}
          layoutSignal={layoutSignal}
          cameraYaw={cameraYaw}
          cameraPitch={favoritesCameraPitch}
          materialTint={materialTint}
          pedestalTint={pedestalTint}
          surfaceData={surfaceData}
        />

        <div className="favoritesGalleryCardCamera">
          <div className="favoritesGalleryCardLayer">
            {renderedCards.map(({
              carouselKey,
              carouselOffset,
              item,
              index,
              relative,
              style,
            }) => {
              const isSelected = index === activeIndex && Math.abs(dragProgress) < 0.5
              const isPreviewFavorite = previewFavoriteIds.has(item.id)
              const favorite = item.source.type === 'preview'
                ? isPreviewFavorite
                : true
              return (
                <article
                  key={carouselKey}
                  className={`favoritesGalleryCard${isSelected ? ' isSelected' : ''}`}
                  data-carousel-key={carouselKey}
                  data-carousel-offset={carouselOffset}
                  data-item-id={item.id}
                  data-item-index={index}
                  data-item-kind={item.kind}
                  data-item-rating={item.rating ?? undefined}
                  data-selected={isSelected || undefined}
                  data-relative={relative.toFixed(3)}
                  style={{ ...style, pointerEvents: 'none' }}
                  aria-hidden="true"
                >
                  <FavoriteCardRaster
                    item={item}
                    favorite={favorite}
                    textRasterRevision={textRasterRevision}
                  />
                </article>
              )
            })}
          </div>
        </div>

        <div className="favoritesGalleryHitCamera">
          <div className="favoritesGalleryHitLayer">
            {renderedCards.map(({
              carouselKey,
              carouselOffset,
              item,
              index,
              relative,
              style,
            }) => {
              const favorite = item.source.type === 'preview'
                ? previewFavoriteIds.has(item.id)
                : true
              return (
                <div
                  key={`hit:${carouselKey}`}
                  className="favoritesGalleryHitPose"
                  style={{ ...style, pointerEvents: 'none' }}
                  data-carousel-key={carouselKey}
                  data-carousel-offset={carouselOffset}
                  data-item-id={item.id}
                  data-relative={relative.toFixed(3)}
                >
                  <div className="favoritesGalleryHitRaster">
                    <button
                      className="favoritesGalleryCardHitTarget"
                      type="button"
                      aria-label={`${item.label}：${item.title}`}
                      data-camera-gesture="block"
                      onPointerDown={handleCardPointerDown}
                      onPointerMove={handleCardPointerMove}
                      onPointerUp={(event) => finishCardPointer(event, true)}
                      onPointerCancel={(event) => finishCardPointer(event, false)}
                      onClick={() => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false
                          return
                        }
                        selectItem(index)
                      }}
                    />
                    <button
                      className="favoritesGalleryFavoriteHitTarget"
                      type="button"
                      aria-label={
                        favorite
                          ? `取消收藏 ${item.title}`
                          : `收藏 ${item.title}`
                      }
                      aria-pressed={favorite}
                      data-camera-gesture="block"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleItemFavorite(item)
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {visibleItems.length === 0 && (
          <div className="favoritesGalleryEmpty" role="status">
            <Star size={22} strokeWidth={1.25} />
            <strong>这里还没有收藏</strong>
            <span>在素材、帧环或三维资产中点亮星标后，会自动陈列在这里。</span>
          </div>
        )}
      </div>

      </section>

      <nav
        className="favoritesGalleryFilters uiGlassShell"
        aria-label="收藏类型"
        aria-hidden={!active || undefined}
        inert={!active}
        data-page-active={active}
      >
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            className={activeFilter === filter.id ? 'isActive' : undefined}
            type="button"
            aria-pressed={activeFilter === filter.id}
            data-camera-gesture="block"
            onClick={() => setActiveFilter(filter.id)}
          >
            <span>{filter.label}</span>
            <small>{String(counts[filter.id]).padStart(2, '0')}</small>
          </button>
        ))}
      </nav>

      <div
        className="favoritesGalleryPager"
        aria-hidden={!active || undefined}
        inert={!active}
        data-page-active={active}
        data-camera-gesture="block"
      >
        <button
          type="button"
          aria-label="上一个收藏"
          disabled={visibleItems.length <= 1}
          onClick={() => animateCarouselStep(-1)}
        >
          <ChevronLeft size={18} strokeWidth={1.55} />
        </button>
        <span>
          {visibleItems.length > 0 ? String(activeIndex + 1).padStart(2, '0') : '00'}
          <i />
          {String(visibleItems.length).padStart(2, '0')}
        </span>
        <button
          type="button"
          aria-label="下一个收藏"
          disabled={visibleItems.length <= 1}
          onClick={() => animateCarouselStep(1)}
        >
          <ChevronRight size={18} strokeWidth={1.55} />
        </button>
      </div>
    </>
  )
}
