import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'
import {
  PAGE_TRANSITION_ENTER_MS,
  PAGE_TRANSITION_EXIT_MS,
} from '../../pageTransition'
import { StartupReflectionCanvas } from './StartupReflectionCanvas'
import './StartupGate.css'

export type StartupWarmupView =
  | 'gallery'
  | 'video-library'
  | 'model-library'
  | 'frame-ring'
  | 'online-search'
  | 'favorites'

export type StartupLibraryState = 'loading' | 'ready' | 'failed'

interface StartupGateProps {
  enabled: boolean
  initialView: StartupWarmupView
  libraryState: StartupLibraryState
  mediaUrls: readonly string[]
  canWarmFrameRing: boolean
  canWarmModelLibrary: boolean
  canWarmFavorites: boolean
  modelLibraryReflectionRequired: boolean
  onWarmupViewChange: (view: StartupWarmupView) => void
  onEntryStart: () => void
  onEntered: () => void
}

type StartupGatePhase = 'loading' | 'ready' | 'leaving'
type StartupBackgroundState = 'loading' | 'ready' | 'fallback'

type WarmupStep = {
  view: StartupWarmupView
  label: string
  reflectionSelector: string
  reflectionRequired?: boolean
  glassSelector?: string
  glassCacheRequired?: boolean
  geometrySelector?: string
  auxiliaryRendererSelector?: string
  prepaintSelector?: string
  preloadRequired?: boolean
  enabled: boolean
  timeoutMs: number
}

type ReflectionFrameBaseline = {
  canvas: HTMLCanvasElement | null
  rendererCount: number
  renderCount: number
}

const STARTUP_HARD_TIMEOUT_MS = 150_000
const STARTUP_BACKGROUND_TIMEOUT_MS = 6_500
const STARTUP_LOGO_POSTER_TIMEOUT_MS = 4_000
const ASSET_TIMEOUT_MS = 6_000
const LIBRARY_TIMEOUT_MS = 20_000
const EXIT_FALLBACK_MS = PAGE_TRANSITION_EXIT_MS + 80
const PRELOAD_CONCURRENCY = 5
const STARTUP_BACKGROUND_POSTER_ASSET =
  './aurora/startup-ice-valley-v1.png'
const STARTUP_BACKGROUND_VIDEO_ASSET =
  './aurora/startup-ice-valley-v1.webm'
const STARTUP_BACKGROUND_VIDEO_FALLBACK_ASSET =
  './aurora/startup-ice-valley-v1.mp4'
const STARTUP_LOGO_FALLBACK_ASSET = './aurora/startup-logo-mark.png'
const STARTUP_LOGO_POSTER_ASSET =
  './aurora/startup-logo-mark-loop-poster.png'
const STARTUP_LOGO_VIDEO_ASSET =
  './aurora/startup-logo-mark-loop.webm'
const STARTUP_WORDMARK_ASSET =
  './aurora/startup-aurora-wordmark.png'

/*
 * This list contains the shared visual runtime used by the current pages,
 * including the project/model backgrounds and the common Aurora brand.
 * Retired alternatives (old displacement maps, background3 and the original
 * Chinese-named discovery frame) are deliberately excluded.
 */
const AURORA_STARTUP_VISUAL_ASSETS = [
  STARTUP_BACKGROUND_POSTER_ASSET,
  STARTUP_LOGO_FALLBACK_ASSET,
  STARTUP_LOGO_POSTER_ASSET,
  STARTUP_WORDMARK_ASSET,
  './aurora/background-stage.png',
  './aurora/Project-Details-Background.png',
  './aurora/frame-ring-background.png',
  './aurora/home-kuang-2k.png',
  './aurora/home-kuang-alpha-2k.png',
  './aurora/home-kuang-light-2k.png',
  './aurora/home-create-project-button-frame.png',
  './aurora/square-frame.png',
  './aurora/square-frame-alpha.png',
  './aurora/square-frame-light.png',
  './aurora/detail-panel.png',
  './aurora/detail-panel-alpha.png',
  './aurora/video-kuang16x9.png',
  './aurora/video-kuang-alpha16x9.png',
  './aurora/video-kuang-light16x9.png',
  './aurora/discovery-result-frame.png',
  './aurora/reflection-ice-surface-generated-2048.png',
  './aurora/particles/dust.png',
  './aurora/particles/bamboo-leaf.png',
  './aurora/particles/leaf.png',
  './aurora/particles/snowflake.png',
  './aurora/particles/maple-leaf.png',
] as const

const FAVORITES_STARTUP_VISUAL_ASSETS = [
  './aurora/favorites-gallery-background.png',
  './aurora/favorites-pedestal-edge-light.png',
] as const

class StartupAbortError extends Error {
  constructor() {
    super('Aurora startup warmup was aborted')
    this.name = 'StartupAbortError'
  }
}

class StartupTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StartupTimeoutError'
  }
}

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new StartupAbortError()
}

const waitForAnimationFrame = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    throwIfAborted(signal)
    const frame = window.requestAnimationFrame(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    })
    const cancel = () => {
      window.cancelAnimationFrame(frame)
      reject(new StartupAbortError())
    }
    signal.addEventListener('abort', cancel, { once: true })
  })

const waitForPaintFrames = async (count: number, signal: AbortSignal) => {
  for (let index = 0; index < count; index += 1) {
    await waitForAnimationFrame(signal)
  }
}

const waitForCondition = (
  check: () => boolean,
  timeoutMs: number,
  signal: AbortSignal,
  message: string,
) =>
  new Promise<void>((resolve, reject) => {
    throwIfAborted(signal)
    const startedAt = performance.now()
    let timer: number | undefined

    const cleanup = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
    }
    const cancel = () => {
      cleanup()
      reject(new StartupAbortError())
    }
    const inspect = () => {
      if (signal.aborted) {
        cancel()
        return
      }
      if (check()) {
        cleanup()
        resolve()
        return
      }
      if (performance.now() - startedAt >= timeoutMs) {
        cleanup()
        reject(new StartupTimeoutError(message))
        return
      }
      timer = window.setTimeout(inspect, 42)
    }

    signal.addEventListener('abort', cancel, { once: true })
    inspect()
  })

const loadDecodedImage = (
  assetUrl: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    throwIfAborted(signal)
    const image = new Image()
    let timeout: number | undefined
    let settled = false

    const cleanup = () => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      signal.removeEventListener('abort', cancel)
      image.onload = null
      image.onerror = null
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(image)
    }
    const decode = () => {
      void image
        .decode()
        .then(() => finish())
        .catch(() => {
          /*
           * Chromium can reject decode() for an image that is already decoded
           * by CSS. A successful load still means the resource is available.
           */
          if (image.complete && image.naturalWidth > 0) finish()
          else finish(new Error(`Unable to decode ${assetUrl}`))
        })
    }
    const cancel = () => {
      image.onload = null
      image.onerror = null
      image.src = ''
      finish(new StartupAbortError())
    }

    image.decoding = 'sync'
    image.loading = 'eager'
    image.onload = decode
    image.onerror = () => finish(new Error(`Unable to load ${assetUrl}`))
    signal.addEventListener('abort', cancel, { once: true })
    timeout = window.setTimeout(
      () => finish(new StartupTimeoutError(`Timed out loading ${assetUrl}`)),
      ASSET_TIMEOUT_MS,
    )
    image.src = resolveDocumentAssetUrl(assetUrl)
    if (image.complete && image.naturalWidth > 0) decode()
  })

const reflectionRenderCount = (canvas: HTMLCanvasElement) =>
  Number.parseInt(
    canvas.dataset.reflectionRenderCount ??
      canvas.dataset.renderCount ??
      '0',
    10,
  ) || 0

const captureReflectionBaseline = (
  selector: string,
): ReflectionFrameBaseline => {
  const canvas = document.querySelector<HTMLCanvasElement>(selector)
  return {
    canvas,
    rendererCount: Number.parseInt(
      canvas?.dataset.rendererCount ?? '0',
      10,
    ) || 0,
    renderCount: canvas ? reflectionRenderCount(canvas) : 0,
  }
}

const readReflectionCount = (...values: Array<string | undefined>) => {
  for (const value of values) {
    if (value === undefined || value.trim() === '') continue
    const count = Number.parseInt(value, 10)
    if (Number.isInteger(count) && count >= 0) return count
  }
  return null
}

const hasExplicitlyEmptyReflectionView = (canvas: HTMLCanvasElement) => {
  const sourceQuery = canvas.classList.contains('galleryReflectionCanvas')
    ? {
        root: '.auroraApp.view-gallery',
        sources: '.projectStage .projectCard',
      }
    : canvas.classList.contains('videoLibraryReflectionCanvas')
      ? {
          root: '.videoLibraryView[data-page-active="true"]',
          sources:
            '.videoClipCard.clipRowBottom, .clipDetailPanel[data-detail-reflection]',
        }
      : canvas.classList.contains('frameRingReflectionCanvas')
        ? {
            root: '.frameRingView[data-page-active="true"]',
            sources:
              '.frameRingCard[data-frame-reflection="true"], .frameRingFloatingObject[data-frame-reflection="true"]',
          }
        : canvas.classList.contains('discoveryReflectionCanvas')
          ? {
              root: '.discoveryView[data-page-active="true"]',
              sources:
                '.discoveryResultCard[data-discovery-reflection], .discoveryDetailPanel[data-discovery-detail-reflection]',
            }
          : null
  if (!sourceQuery) return false
  const activeView = document.querySelector<HTMLElement>(sourceQuery.root)
  return Boolean(activeView && !activeView.querySelector(sourceQuery.sources))
}

const hasCompleteReflectionSources = (canvas: HTMLCanvasElement) => {
  const usesLiveSampledSourceCount =
    canvas.classList.contains('galleryReflectionCanvas') ||
    canvas.classList.contains('discoveryReflectionCanvas')
  /*
   * Video/frame-ring publish the revision-scoped count, while gallery and
   * discovery expose the renderer's live source count. Missing or malformed
   * diagnostics must remain pending instead of being coerced to an empty page.
   */
  const sourceCount = usesLiveSampledSourceCount
    ? readReflectionCount(
        canvas.dataset.sourceCount,
        canvas.dataset.reflectionSourceCount,
      )
    : readReflectionCount(
        canvas.dataset.reflectionSourceCount,
        canvas.dataset.sourceCount,
      )
  const visibleSourceCount = readReflectionCount(
    canvas.dataset.reflectionVisibleSourceCount,
    canvas.dataset.visibleSourceCount,
  )
  if (sourceCount === null || visibleSourceCount === null) return false
  if (sourceCount > 0) {
    /*
     * Gallery/discovery publish the renderer's live sampled-source count, so
     * every one of those declared sources must have a visible texture. The
     * revision-based video/frame-ring count also includes prepared sources
     * outside the current sampled window; their exact completeness is already
     * guarded by source/prepared/rendered revision equality.
     */
    return usesLiveSampledSourceCount
      ? visibleSourceCount === sourceCount
      : visibleSourceCount > 0
  }

  /*
   * Zero is complete only when the active view genuinely has no DOM sources.
   * During renderer startup every canvas begins at 0/0, including pages whose
   * cards are already mounted, so 0/0 alone is not a readiness signal.
   */
  return (
    visibleSourceCount === 0 &&
    hasExplicitlyEmptyReflectionView(canvas)
  )
}

const waitForReflectionFirstFrame = async (
  selector: string,
  timeoutMs: number,
  signal: AbortSignal,
  baseline: ReflectionFrameBaseline,
) => {
  let fallback = false
  await waitForCondition(
    () => {
      const canvas = document.querySelector<HTMLCanvasElement>(selector)
      if (!canvas || canvas.dataset.reflectionActive !== 'true') return false
      if (canvas.dataset.renderState === 'fallback') {
        fallback = true
        return true
      }
      const rendererCount =
        Number.parseInt(canvas.dataset.rendererCount ?? '0', 10) || 0
      const renderCount = reflectionRenderCount(canvas)
      const sourceRevision = canvas.dataset.reflectionSourceRevision
      const preparedRevision = canvas.dataset.reflectionPreparedRevision
      const renderedRevision = canvas.dataset.reflectionRenderedRevision
      const usesContentReadiness =
        sourceRevision !== undefined ||
        canvas.dataset.reflectionContentReady !== undefined
      const currentContentReady =
        !usesContentReadiness ||
        (Boolean(sourceRevision) &&
          sourceRevision === preparedRevision &&
          sourceRevision === renderedRevision &&
          canvas.dataset.reflectionContentReady === 'true')
      const producedFreshFrame =
        canvas !== baseline.canvas ||
        rendererCount !== baseline.rendererCount
          ? renderCount > 0
          : renderCount > baseline.renderCount
      return (
        canvas.dataset.contextLost !== 'true' &&
        canvas.dataset.reflectionReady === 'true' &&
        currentContentReady &&
        hasCompleteReflectionSources(canvas) &&
        producedFreshFrame
      )
    },
    timeoutMs,
    signal,
    `Timed out warming ${selector}`,
  )
  return !fallback
}

const warmGlassAndCompositor = async (
  step: WarmupStep,
  signal: AbortSignal,
  retainedPromotions?: Map<HTMLElement, string>,
) => {
  if (step.glassSelector) {
    await waitForCondition(
      () => {
        const layer = document.querySelector<HTMLElement>(step.glassSelector!)
        if (!layer || layer.dataset.glassActive !== 'true') return false
        return (
          !step.glassCacheRequired ||
          layer.dataset.glassCacheValid === 'true'
        )
      },
      Math.min(step.timeoutMs, 4_200),
      signal,
      `Timed out warming glass for ${step.view}`,
    )
  }

  const warmSurfaceSelector = [
    '.uiGlassShell',
    '.galleryProjectProjectedGlass',
    '.videoClipProjectedGlass',
    '.videoDetailProjectedGlass',
    '.frameRingPreviewControlsProjectedGlass',
    '.frameRingProjectedGlass',
    '.frameRingActionProjectedGlass',
    '.discoveryDetailProjectedGlass',
    step.prepaintSelector,
  ]
    .filter(Boolean)
    .join(',')
  const visibleGlass = Array.from(
    document.querySelectorAll<HTMLElement>(
      warmSurfaceSelector,
    ),
  ).filter((element) => {
    const style = window.getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })

  const explicitPrepaintSurfaces = step.prepaintSelector
    ? Array.from(
        document.querySelectorAll<HTMLElement>(step.prepaintSelector),
      ).filter((element) => {
        const style = window.getComputedStyle(element)
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getBoundingClientRect().width > 0 &&
          element.getBoundingClientRect().height > 0
        )
      })
    : []
  if (step.prepaintSelector && explicitPrepaintSurfaces.length === 0) {
    throw new StartupTimeoutError(
      `No visible prepaint surface for ${step.view}`,
    )
  }

  const previousWillChange = new Map<HTMLElement, string>()
  visibleGlass.forEach((element) => {
    element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    void style.backdropFilter
    void style.getPropertyValue('-webkit-backdrop-filter')
    const backdropFilter =
      style.backdropFilter ||
      style.getPropertyValue('-webkit-backdrop-filter')
    if (backdropFilter && backdropFilter !== 'none') {
      previousWillChange.set(element, element.style.willChange)
      element.style.willChange = 'backdrop-filter'
    }
  })
  try {
    await waitForPaintFrames(4, signal)
    visibleGlass.forEach((element) => {
      const style = window.getComputedStyle(element)
      void style.backdropFilter
      void style.getPropertyValue('-webkit-backdrop-filter')
    })
    await waitForPaintFrames(2, signal)
  } finally {
    if (retainedPromotions) {
      previousWillChange.forEach((willChange, element) => {
        if (!retainedPromotions.has(element)) {
          retainedPromotions.set(element, willChange)
        }
      })
    } else {
      previousWillChange.forEach((willChange, element) => {
        if (willChange) element.style.willChange = willChange
        else element.style.removeProperty('will-change')
      })
    }
  }
  new Set([...visibleGlass, ...explicitPrepaintSurfaces]).forEach((element) => {
    element.dataset.startupGlassPrepared = 'true'
  })
}

const waitForReflectionPreload = async (
  step: WarmupStep,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
) => {
  if (!step.preloadRequired) {
    onProgress(1)
    return
  }
  let reportedProgress = -1
  await waitForCondition(
    () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        step.reflectionSelector,
      )
      if (!canvas) return false
      const sourceCount = readReflectionCount(
        canvas.dataset.reflectionPreloadSourceCount,
      )
      const readyCount = readReflectionCount(
        canvas.dataset.reflectionPreloadReadyCount,
      )
      if (sourceCount !== null && readyCount !== null) {
        const progress =
          sourceCount === 0
            ? 1
            : Math.min(1, readyCount / sourceCount)
        if (progress !== reportedProgress) {
          reportedProgress = progress
          onProgress(progress)
        }
      }
      return (
        sourceCount !== null &&
        readyCount !== null &&
        readyCount === sourceCount &&
        canvas.dataset.reflectionPreloadState === 'ready'
      )
    },
    step.timeoutMs,
    signal,
    `Timed out warming adjacent textures for ${step.view}`,
  )
  onProgress(1)
}

const waitForGeometryCache = async (
  step: WarmupStep,
  signal: AbortSignal,
) => {
  if (!step.geometrySelector) return
  await waitForCondition(
    () =>
      document.querySelector<HTMLElement>(
        step.geometrySelector!,
      )?.dataset.geometryCacheValid === 'true',
    Math.min(step.timeoutMs, 8_000),
    signal,
    `Timed out warming geometry for ${step.view}`,
  )
}

const waitForAuxiliaryRenderer = async (
  step: WarmupStep,
  signal: AbortSignal,
) => {
  if (!step.auxiliaryRendererSelector) return
  await waitForCondition(
    () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        step.auxiliaryRendererSelector!,
      )
      return (
        canvas?.dataset.assetReady === 'true' &&
        canvas.dataset.pedestalReady === 'true' &&
        canvas.dataset.reflectionReady === 'true' &&
        canvas.dataset.cardDepthOcclusionReady === 'true' &&
        canvas.dataset.cardReflectionOcclusionReady === 'true' &&
        ['true', 'fallback'].includes(
          canvas.dataset.reflectionSurfaceReady ?? '',
        ) &&
        ['true', 'fallback'].includes(
          canvas.dataset.environmentReady ?? '',
        ) &&
        canvas.dataset.renderState === 'ready'
      )
    },
    Math.min(step.timeoutMs, 8_000),
    signal,
    `Timed out warming auxiliary renderer for ${step.view}`,
  )
}

const uniqueVisualUrls = (mediaUrls: readonly string[]) =>
  Array.from(
    new Set(
      [...AURORA_STARTUP_VISUAL_ASSETS, ...mediaUrls]
        .map((url) => url.trim())
        .filter(
          (url) =>
            url.length > 0 &&
            !url.startsWith('blob:') &&
            (
              !url.startsWith('data:') ||
              /* Imported GLB thumbnails are compact WebP data URLs. Decode
                 reasonable-sized images here so their first card paint is
                 warm too, while refusing unbounded inline payloads. */
              (url.startsWith('data:image/') && url.length <= 2_000_000)
            ),
        ),
    ),
  )

export function StartupGate({
  enabled,
  initialView,
  libraryState,
  mediaUrls,
  canWarmFrameRing,
  canWarmModelLibrary,
  canWarmFavorites,
  modelLibraryReflectionRequired,
  onWarmupViewChange,
  onEntryStart,
  onEntered,
}: StartupGateProps) {
  const [phase, setPhase] = useState<StartupGatePhase>('loading')
  const [backgroundState, setBackgroundState] =
    useState<StartupBackgroundState>('loading')
  const [backgroundVideoReady, setBackgroundVideoReady] = useState(false)
  const [logoPosterState, setLogoPosterState] =
    useState<StartupBackgroundState>('loading')
  const [logoVideoReady, setLogoVideoReady] = useState(false)
  const [firstFrameReady, setFirstFrameReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('正在启动 Aurora')
  const [degraded, setDegraded] = useState(false)
  const libraryStateRef = useRef(libraryState)
  const mediaUrlsRef = useRef(mediaUrls)
  const canWarmFrameRingRef = useRef(canWarmFrameRing)
  const canWarmModelLibraryRef = useRef(canWarmModelLibrary)
  const canWarmFavoritesRef = useRef(canWarmFavorites)
  const modelLibraryReflectionRequiredRef = useRef(
    modelLibraryReflectionRequired,
  )
  const enterButtonRef = useRef<HTMLButtonElement>(null)
  const startupGateRef = useRef<HTMLElement>(null)
  const startupBackgroundRef = useRef<HTMLImageElement>(null)
  const startupBackgroundVideoRef = useRef<HTMLVideoElement>(null)
  const startupLogoPosterRef = useRef<HTMLImageElement>(null)
  const startupLogoVideoRef = useRef<HTMLVideoElement>(null)
  const retainedImagesRef = useRef<HTMLImageElement[]>([])
  const retainedGlassPromotionsRef = useRef<Map<HTMLElement, string>>(
    new Map(),
  )
  const exitTimerRef = useRef<number | undefined>(undefined)
  const glassPromotionReleaseTimerRef = useRef<number | undefined>(
    undefined,
  )
  const enteredRef = useRef(false)
  const backgroundSettledRef = useRef(false)
  const logoPosterSettledRef = useRef(false)
  const criticalVisualFailedRef = useRef(false)
  const firstFrameNotifiedRef = useRef(false)
  const prefersReducedMotionRef = useRef(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const releaseRetainedGlassPromotions = useCallback(() => {
    retainedGlassPromotionsRef.current.forEach((willChange, element) => {
      if (!element.isConnected) return
      if (willChange) element.style.willChange = willChange
      else element.style.removeProperty('will-change')
    })
    retainedGlassPromotionsRef.current.clear()
    glassPromotionReleaseTimerRef.current = undefined
  }, [])

  libraryStateRef.current = libraryState
  mediaUrlsRef.current = mediaUrls
  canWarmFrameRingRef.current = canWarmFrameRing
  canWarmModelLibraryRef.current = canWarmModelLibrary
  canWarmFavoritesRef.current = canWarmFavorites
  modelLibraryReflectionRequiredRef.current =
    modelLibraryReflectionRequired

  const settleStartupBackground = useCallback(
    (outcome: Exclude<StartupBackgroundState, 'loading'>) => {
      if (backgroundSettledRef.current) return
      backgroundSettledRef.current = true
      if (outcome === 'fallback') {
        criticalVisualFailedRef.current = true
        setDegraded(true)
      }
      setBackgroundState(outcome)
    },
    [],
  )

  const handleStartupBackgroundLoaded = useCallback(
    (image: HTMLImageElement) => {
      void image
        .decode()
        .then(() => settleStartupBackground('ready'))
        .catch(() => {
          if (image.complete && image.naturalWidth > 0) {
            settleStartupBackground('ready')
          } else {
            settleStartupBackground('fallback')
          }
        })
    },
    [settleStartupBackground],
  )

  const handleStartupBackgroundVideoLoaded = useCallback(
    (video: HTMLVideoElement) => {
      void video.play().catch(() => {
        // The decoded poster remains visible if autoplay is unavailable.
      })
    },
    [],
  )

  const settleStartupLogoPoster = useCallback(
    (outcome: Exclude<StartupBackgroundState, 'loading'>) => {
      if (logoPosterSettledRef.current) return
      logoPosterSettledRef.current = true
      if (outcome === 'fallback') {
        criticalVisualFailedRef.current = true
        setDegraded(true)
      }
      setLogoPosterState(outcome)
    },
    [],
  )

  const handleStartupLogoPosterLoaded = useCallback(
    (image: HTMLImageElement) => {
      void image
        .decode()
        .then(() => settleStartupLogoPoster('ready'))
        .catch(() => {
          if (image.complete && image.naturalWidth > 0) {
            settleStartupLogoPoster('ready')
          } else {
            settleStartupLogoPoster('fallback')
          }
        })
    },
    [settleStartupLogoPoster],
  )

  useEffect(() => {
    if (!enabled || backgroundState !== 'loading') return
    const timer = window.setTimeout(
      () => settleStartupBackground('fallback'),
      STARTUP_BACKGROUND_TIMEOUT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [backgroundState, enabled, settleStartupBackground])

  useEffect(() => {
    if (!enabled || logoPosterState !== 'loading') return
    const timer = window.setTimeout(
      () => settleStartupLogoPoster('fallback'),
      STARTUP_LOGO_POSTER_TIMEOUT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [enabled, logoPosterState, settleStartupLogoPoster])

  useEffect(() => {
    if (
      !enabled ||
      backgroundState === 'loading' ||
      logoPosterState === 'loading'
    ) return
    let disposed = false
    let firstFrame = 0
    let secondFrame = 0

    firstFrame = window.requestAnimationFrame(() => {
      if (disposed) return
      const gate = startupGateRef.current
      const background = startupBackgroundRef.current
      const backgroundVideo = startupBackgroundVideoRef.current
      const logoPoster = startupLogoPosterRef.current
      void gate?.getBoundingClientRect()
      if (background) void window.getComputedStyle(background).opacity
      if (backgroundVideo) void window.getComputedStyle(backgroundVideo).opacity
      if (logoPoster) void window.getComputedStyle(logoPoster).opacity

      secondFrame = window.requestAnimationFrame(() => {
        if (disposed || firstFrameNotifiedRef.current) return
        firstFrameNotifiedRef.current = true
        setFirstFrameReady(true)
        window.desktopBridge?.notifyStartupVisualReady()
      })
    })

    return () => {
      disposed = true
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [backgroundState, enabled, logoPosterState])

  const finishEntry = useCallback(() => {
    if (enteredRef.current) return
    enteredRef.current = true
    if (exitTimerRef.current !== undefined) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = undefined
    }
    retainedImagesRef.current = []
    onEntered()
  }, [onEntered])

  const beginEntry = useCallback(() => {
    if (phase !== 'ready') return
    onEntryStart()
    setPhase('leaving')
    setStatus('正在进入 Aurora')
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (glassPromotionReleaseTimerRef.current !== undefined) {
      window.clearTimeout(glassPromotionReleaseTimerRef.current)
    }
    glassPromotionReleaseTimerRef.current = window.setTimeout(
      releaseRetainedGlassPromotions,
      reducedMotion
        ? 96
        : EXIT_FALLBACK_MS + PAGE_TRANSITION_ENTER_MS + 120,
    )
    if (reducedMotion) {
      finishEntry()
      return
    }
    exitTimerRef.current = window.setTimeout(finishEntry, EXIT_FALLBACK_MS)
  }, [finishEntry, onEntryStart, phase, releaseRetainedGlassPromotions])

  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        phase === 'ready' &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        beginEntry()
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [beginEntry, enabled, phase])

  useEffect(() => {
    if (phase === 'ready') enterButtonRef.current?.focus()
  }, [phase])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const { signal } = controller
    let disposed = false
    let hardTimedOut = false
    let degradedWarmup = false
    let completedWeight = 0

    const setWeightedProgress = (partialWeight = 0) => {
      if (disposed) return
      setProgress(
        Math.min(99, Math.round(completedWeight + partialWeight)),
      )
    }
    const completeWeight = (weight: number) => {
      completedWeight += weight
      setWeightedProgress()
    }
    const markDegraded = (error: unknown) => {
      if (
        disposed ||
        (error instanceof StartupAbortError && !hardTimedOut)
      ) return
      degradedWarmup = true
      setDegraded(true)
      console.warn('[Aurora startup] Warmup continued in fallback mode', error)
    }

    const hardTimeout = window.setTimeout(() => {
      hardTimedOut = true
      degradedWarmup = true
      setDegraded(true)
      controller.abort()
    }, STARTUP_HARD_TIMEOUT_MS)

    const steps: WarmupStep[] = [
      {
        view: 'gallery',
        label: '正在预热主页倒影',
        reflectionSelector: '.galleryReflectionCanvas',
        glassSelector: '.galleryProjectedGlassLayer',
        glassCacheRequired: true,
        geometrySelector: '.galleryProjectedGlassLayer',
        preloadRequired: true,
        enabled: true,
        timeoutMs: 15_000,
      },
      {
        view: 'video-library',
        label: '正在预热素材库',
        reflectionSelector: '.videoLibraryReflectionCanvas',
        glassSelector: '.videoLibraryProjectedGlassLayer',
        glassCacheRequired: true,
        geometrySelector: '.videoLibraryProjectedGlassLayer',
        prepaintSelector:
          '.videoProjectEmptyState, .videoProjectFilteredEmptyState',
        preloadRequired: true,
        enabled: true,
        timeoutMs: 18_000,
      },
      {
        view: 'model-library',
        label: '正在预热三维素材库',
        reflectionSelector: '.modelLibraryReflectionCanvas',
        reflectionRequired: modelLibraryReflectionRequiredRef.current,
        glassSelector: '.modelLibraryProjectedGlassLayer',
        glassCacheRequired: true,
        geometrySelector: '.modelLibraryProjectedGlassLayer',
        prepaintSelector: '.modelLibraryEmptyState',
        get enabled() {
          return canWarmModelLibraryRef.current
        },
        timeoutMs: 18_000,
      },
      {
        view: 'frame-ring',
        label: '正在预热帧环',
        reflectionSelector: '.frameRingReflectionCanvas',
        glassSelector: '.frameRingProjectedGlassLayer',
        geometrySelector: '.frameRingHitLayer',
        preloadRequired: true,
        get enabled() {
          return canWarmFrameRingRef.current
        },
        timeoutMs: 20_000,
      },
      {
        view: 'online-search',
        label: '正在预热探索空间',
        reflectionSelector: '.discoveryReflectionCanvas',
        prepaintSelector:
          '.discoverySearchBar, .discoveryDetailWarmupGlass',
        enabled: true,
        timeoutMs: 5_500,
      },
      {
        view: 'favorites',
        label: '正在预热收藏展馆',
        reflectionSelector: '.favoritesReflectionCanvas',
        auxiliaryRendererSelector: '.favoritesPedestalCanvas',
        prepaintSelector:
          '.favoritesGalleryFilters, .favoritesGalleryPager, .favoritesGalleryPager button',
        preloadRequired: true,
        get enabled() {
          return canWarmFavoritesRef.current
        },
        timeoutMs: 12_000,
      },
    ]

    const warmup = async () => {
      try {
        setStatus('正在读取项目资料')
        try {
          await waitForCondition(
            () => libraryStateRef.current !== 'loading',
            LIBRARY_TIMEOUT_MS,
            signal,
            'Timed out reading the Aurora library',
          )
          if (libraryStateRef.current === 'failed') {
            markDegraded(new Error('Aurora library data could not be restored'))
          }
        } catch (error) {
          markDegraded(error)
        }
        completeWeight(14)

        setStatus('正在准备字体与界面')
        try {
          await Promise.race([
            document.fonts.ready,
            waitForCondition(
              () => false,
              2_000,
              signal,
              'Font warmup timed out',
            ),
          ])
        } catch (error) {
          markDegraded(error)
        }
        completeWeight(6)

        setStatus('正在解码视觉素材')
        const visualUrls = uniqueVisualUrls([
          ...mediaUrlsRef.current,
          ...FAVORITES_STARTUP_VISUAL_ASSETS,
        ])
        let cursor = 0
        let settled = 0
        const worker = async () => {
          while (!signal.aborted && cursor < visualUrls.length) {
            const index = cursor
            cursor += 1
            try {
              const image = await loadDecodedImage(visualUrls[index], signal)
              retainedImagesRef.current.push(image)
            } catch (error) {
              markDegraded(error)
            } finally {
              settled += 1
              setWeightedProgress(
                visualUrls.length > 0
                  ? (settled / visualUrls.length) * 34
                  : 34,
              )
            }
          }
        }
        await Promise.all(
          Array.from(
            {
              length: Math.min(
                PRELOAD_CONCURRENCY,
                Math.max(1, visualUrls.length),
              ),
            },
            () => worker(),
          ),
        )
        completeWeight(34)

        const warmupStepWeight = 36 / steps.length

        for (const step of steps) {
          throwIfAborted(signal)
          if (!step.enabled) {
            completeWeight(warmupStepWeight)
            continue
          }
          setStatus(step.label)
          const reflectionBaseline = step.reflectionRequired === false
            ? null
            : captureReflectionBaseline(step.reflectionSelector)
          onWarmupViewChange(step.view)
          try {
            await waitForCondition(
              () =>
                document
                  .querySelector('.auroraApp')
                  ?.classList.contains(`view-${step.view}`) === true,
              1_800,
              signal,
              `Timed out activating ${step.view}`,
            )
            await waitForPaintFrames(2, signal)
            setWeightedProgress(warmupStepWeight * (1 / 9))
            if (reflectionBaseline) {
              const reflectionReady = await waitForReflectionFirstFrame(
                step.reflectionSelector,
                step.timeoutMs,
                signal,
                reflectionBaseline,
              )
              if (!reflectionReady) {
                markDegraded(
                  new Error(`${step.view} reflection renderer used fallback`),
                )
              }
            }
            setWeightedProgress(warmupStepWeight * (3 / 9))
            await waitForReflectionPreload(
              step,
              signal,
              (preloadProgress) =>
                setWeightedProgress(
                  warmupStepWeight * ((3 + preloadProgress * 3) / 9),
                ),
            )
            await waitForGeometryCache(step, signal)
            await waitForAuxiliaryRenderer(step, signal)
            setWeightedProgress(warmupStepWeight * (7 / 9))
            await warmGlassAndCompositor(step, signal)
            setWeightedProgress(warmupStepWeight * (8.5 / 9))
          } catch (error) {
            markDegraded(error)
          }
          completeWeight(warmupStepWeight)
        }
      } catch (error) {
        markDegraded(error)
      } finally {
        window.clearTimeout(hardTimeout)
        if (!disposed) {
          setStatus('正在恢复入口画面')
          const restoreStep = steps.find((step) => step.view === initialView)
          const restoringAlreadyActive =
            document
              .querySelector('.auroraApp')
              ?.classList.contains(`view-${initialView}`) === true
          const restoreBaseline = restoreStep && !restoringAlreadyActive
            ? captureReflectionBaseline(restoreStep.reflectionSelector)
            : null
          onWarmupViewChange(initialView)
          if (!signal.aborted) {
            try {
              await waitForCondition(
                () =>
                  document
                    .querySelector('.auroraApp')
                    ?.classList.contains(`view-${initialView}`) === true,
                1_800,
                signal,
                `Timed out restoring ${initialView}`,
              )
              await waitForPaintFrames(4, signal)
              if (restoreStep && restoreBaseline) {
                const reflectionReady = await waitForReflectionFirstFrame(
                  restoreStep.reflectionSelector,
                  3_200,
                  signal,
                  restoreBaseline,
                )
                if (!reflectionReady) {
                  markDegraded(
                    new Error(
                      `${initialView} reflection renderer used fallback while restoring`,
                    ),
                  )
                }
              }
              if (restoreStep) {
                await waitForReflectionPreload(
                  restoreStep,
                  signal,
                  () => undefined,
                )
                await waitForGeometryCache(restoreStep, signal)
                await waitForAuxiliaryRenderer(restoreStep, signal)
                await warmGlassAndCompositor(
                  restoreStep,
                  signal,
                  retainedGlassPromotionsRef.current,
                )
              }
            } catch (error) {
              markDegraded(error)
            }
          } else {
            await new Promise<void>((resolve) =>
              window.requestAnimationFrame(() =>
                window.requestAnimationFrame(() => resolve()),
              ),
            )
          }
          completeWeight(10)
          setProgress(100)
          const usedFallback =
            degradedWarmup || criticalVisualFailedRef.current
          setStatus(
            hardTimedOut
              ? '部分视觉任务已超时，已使用备用显示'
              : usedFallback
                ? '部分视觉效果已使用备用显示'
                : '视觉环境已准备完成',
          )
          setPhase('ready')
        }
      }
    }

    void warmup()
    return () => {
      disposed = true
      window.clearTimeout(hardTimeout)
      controller.abort()
      if (exitTimerRef.current !== undefined) {
        window.clearTimeout(exitTimerRef.current)
      }
      if (!enteredRef.current) {
        if (glassPromotionReleaseTimerRef.current !== undefined) {
          window.clearTimeout(glassPromotionReleaseTimerRef.current)
        }
        releaseRetainedGlassPromotions()
      }
      retainedImagesRef.current = []
    }
  }, [
    enabled,
    initialView,
    onWarmupViewChange,
    releaseRetainedGlassPromotions,
  ])

  if (!enabled) return null

  return (
    <section
      ref={startupGateRef}
      className="startupGate"
      data-phase={phase}
      data-background-state={backgroundState}
      data-background-video-ready={backgroundVideoReady}
      data-logo-poster-state={logoPosterState}
      data-logo-video-ready={logoVideoReady}
      data-first-frame-ready={firstFrameReady}
      data-progress={progress}
      data-degraded={degraded}
      data-entry-motion="page-transition-deeper"
      data-camera-gesture="block"
      role="dialog"
      aria-modal="true"
      aria-label="Aurora 启动载入"
      aria-busy={phase === 'loading'}
      onClick={beginEntry}
      style={
        {
          '--startup-progress': `${progress}%`,
        } as CSSProperties
      }
    >
      <div
        className="startupGateVisual"
        onAnimationEnd={(event) => {
          if (
            phase === 'leaving' &&
            event.currentTarget === event.target &&
            event.animationName === 'auroraPageExitDepthReverse'
          ) {
            finishEntry()
          }
        }}
      >
        <img
          ref={startupBackgroundRef}
          className="startupGateBackdrop startupGateBackdropPoster"
          src={resolveDocumentAssetUrl(STARTUP_BACKGROUND_POSTER_ASSET)}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="sync"
          fetchPriority="high"
          onLoad={(event) =>
            handleStartupBackgroundLoaded(event.currentTarget)
          }
          onError={() => settleStartupBackground('fallback')}
        />
        {!prefersReducedMotionRef.current && (
          <video
            ref={startupBackgroundVideoRef}
            className="startupGateBackdrop startupGateBackdropVideo"
            poster={resolveDocumentAssetUrl(STARTUP_BACKGROUND_POSTER_ASSET)}
            aria-hidden="true"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            controls={false}
            disablePictureInPicture
            onLoadedData={(event) =>
              handleStartupBackgroundVideoLoaded(event.currentTarget)
            }
            onPlaying={() => setBackgroundVideoReady(true)}
            onError={() => setBackgroundVideoReady(false)}
          >
            <source
              src={resolveDocumentAssetUrl(STARTUP_BACKGROUND_VIDEO_ASSET)}
              type="video/webm"
            />
            <source
              src={resolveDocumentAssetUrl(
                STARTUP_BACKGROUND_VIDEO_FALLBACK_ASSET,
              )}
              type="video/mp4"
            />
          </video>
        )}
        <StartupReflectionCanvas
          progress={progress}
          sourceLogoVideoRef={startupLogoVideoRef}
        />
        <div className="startupGateContent">
          <div className="startupBrand" aria-label="Aurora">
            <span
              className="startupLogoMark"
              data-startup-reflection-source="logo"
              data-logo-poster-state={logoPosterState}
              data-logo-video-ready={logoVideoReady}
              aria-hidden="true"
            >
              <img
                className="startupLogoFallback"
                src={resolveDocumentAssetUrl(STARTUP_LOGO_FALLBACK_ASSET)}
                alt=""
                draggable={false}
                decoding="sync"
              />
              <img
                ref={startupLogoPosterRef}
                className="startupLogoPoster"
                src={resolveDocumentAssetUrl(STARTUP_LOGO_POSTER_ASSET)}
                alt=""
                draggable={false}
                decoding="sync"
                fetchPriority="high"
                onLoad={(event) =>
                  handleStartupLogoPosterLoaded(event.currentTarget)
                }
                onError={() => settleStartupLogoPoster('fallback')}
              />
              <video
                ref={startupLogoVideoRef}
                className="startupLogoVideo"
                src={resolveDocumentAssetUrl(STARTUP_LOGO_VIDEO_ASSET)}
                poster={resolveDocumentAssetUrl(STARTUP_LOGO_POSTER_ASSET)}
                muted
                autoPlay={!prefersReducedMotionRef.current}
                loop
                playsInline
                preload="auto"
                disablePictureInPicture
                tabIndex={-1}
                onLoadedData={(event) => {
                  const video = event.currentTarget
                  if (prefersReducedMotionRef.current) {
                    video.pause()
                    video.currentTime = 0
                  } else {
                    void video.play().catch(() => undefined)
                  }
                  setLogoVideoReady(true)
                }}
                onError={() => {
                  setLogoVideoReady(false)
                  criticalVisualFailedRef.current = true
                  setDegraded(true)
                }}
              />
            </span>
            <span
              className="startupWordmark"
              data-startup-reflection-source="wordmark"
              aria-hidden="true"
            >
              <img
                src={resolveDocumentAssetUrl(STARTUP_WORDMARK_ASSET)}
                alt=""
                draggable={false}
                decoding="sync"
                fetchPriority="high"
              />
            </span>
          </div>

          <div
            className="startupGateAction"
            data-startup-reflection-source="progress"
          >
            <div
              className="startupProgressTrack"
              role="progressbar"
              aria-label="Aurora 载入进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-valuetext={`${progress}% · ${status}`}
            >
              <span />
            </div>
            <output className="startupProgressValue">
              {String(progress).padStart(2, '0')}%
            </output>
          </div>
        </div>

        {phase !== 'loading' && (
          <button
            ref={enterButtonRef}
            className="startupEnterButton"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              beginEntry()
            }}
            disabled={phase === 'leaving'}
          >
            {phase === 'leaving' ? '正在进入 Aurora' : '点击画面进入'}
          </button>
        )}
      </div>
    </section>
  )
}
