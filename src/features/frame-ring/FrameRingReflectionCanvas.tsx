import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Project } from '../../data/projects'
import {
  combineMediaColorFilters,
  getMediaColorPreset,
} from '../../data/mediaColorPresets'
import type { BackgroundReflectionSurface } from '../reflection/backgroundReflectionSurfaceProtocol'
import {
  createReflectionContentRevision,
  waitForReflectionDomFrames,
} from '../reflection/reflectionContentReadiness'
import {
  DOM_REFLECTION_MAX_DPR,
  createIceReflectionRenderer,
  type IceReflectionDiagnostics,
} from '../project-gallery/reflection/IceReflectionRenderer'
import { ReflectionFrameLoop } from '../project-gallery/reflection/ReflectionFrameLoop'
import type { FrameRingClipSource, FrameRingFrame } from './frameRingData'
import {
  FRAME_RING_ALPHA_BOTTOM,
  FRAME_RING_REFLECTION_SOURCE_CAPACITY,
  sampleFrameRingReflections,
} from './frameRingReflectionProjection'
import {
  drawFrameRingPreviewChromeSource,
  drawFrameRingReflectionSource,
} from './drawFrameRingReflectionSource'
import {
  canCaptureFrameRingReflectionSnapshot,
  canUpdateFrameRingLiveReflection,
  drawFrameRingLiveReflectionFrame,
  FRAME_RING_LIVE_REFLECTION_TEXTURE_WIDTH,
  getFrameRingReflectionSnapshotRetryDelay,
  loadFrameRingPreviewMask,
  resolveFrameRingVideoCanvasRect,
} from './frameRingLiveReflection'

const FRAME_RING_REFLECTION_RUNTIME_VERSION = 'frame-ring-dom-reflection-v14-paused-snapshot'

export interface FrameRingReflectionCanvasProps {
  active: boolean
  sourceDomAvailable: boolean
  suspended: boolean
  stageRef: RefObject<HTMLElement | null>
  previewVideoRef: RefObject<HTMLVideoElement | null>
  previewFullscreen: boolean
  previewPlaying: boolean
  previewSnapshotRevision: number
  previewSnapshotTime: number
  previewSnapshotTolerance: number
  previewDomRevision?: number
  snapshotBlocked: boolean
  frames: readonly FrameRingFrame[]
  preloadFrames?: readonly FrameRingFrame[]
  activeFrame: FrameRingFrame
  clip: FrameRingClipSource
  infoRevision: string
  interactionActive: boolean
  motionSignal: string
  cameraYaw: number
  cameraPitch: number
  materialTint?: string
  materialTintFilter?: string
  pageColorGradeFilter?: string
  surfaceData?: BackgroundReflectionSurface | null
}

const writeDiagnostics = (
  canvas: HTMLCanvasElement,
  diagnostics: IceReflectionDiagnostics,
  renderState: 'active' | 'idle' | 'fallback',
) => {
  canvas.dataset.renderState = renderState
  canvas.dataset.rendererCount = String(diagnostics.rendererCount)
  canvas.dataset.renderCount = String(diagnostics.renderCount)
  canvas.dataset.reflectionTargets = String(diagnostics.targetCount)
  canvas.dataset.visibleSourceCount = String(diagnostics.visibleSourceCount)
  canvas.dataset.textureCount = String(diagnostics.textureCount)
  canvas.dataset.reflectionReady = String(diagnostics.ready)
  canvas.dataset.contextLost = String(diagnostics.contextLost)
  canvas.dataset.reflectionSurfaceKey = diagnostics.surfaceKey
}

const createFrameReflectionSource = (frame: FrameRingFrame): Project => ({
  id: frame.id,
  title: frame.shortTimecode,
  subtitle: frame.timecode,
  cover: frame.thumbnail,
  videoCount: 0,
  collectionCount: 0,
  updatedAt: frame.timecode,
})

export function FrameRingReflectionCanvas({
  active,
  sourceDomAvailable,
  suspended,
  stageRef,
  previewVideoRef,
  previewFullscreen,
  previewPlaying,
  previewSnapshotRevision,
  previewSnapshotTime,
  previewSnapshotTolerance,
  previewDomRevision = 0,
  snapshotBlocked,
  frames,
  preloadFrames = [],
  activeFrame,
  clip,
  infoRevision,
  interactionActive,
  motionSignal,
  cameraYaw,
  cameraPitch,
  materialTint = '#aec5ff',
  materialTintFilter = '',
  pageColorGradeFilter = '',
  surfaceData = null,
}: FrameRingReflectionCanvasProps) {
  const reflectionRuntimeVersion = FRAME_RING_REFLECTION_RUNTIME_VERSION
  const mediaColorFilter = getMediaColorPreset(clip.colorPreset).cssFilter
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const invalidateRef = useRef<() => void>(() => undefined)
  const rendererRef = useRef<ReturnType<typeof createIceReflectionRenderer>>(null)
  const cameraYawRef = useRef(cameraYaw)
  const cameraPitchRef = useRef(cameraPitch)
  const materialTintRef = useRef(materialTint)
  const materialTintFilterRef = useRef(materialTintFilter)
  const pageColorGradeFilterRef = useRef(pageColorGradeFilter)
  const surfaceDataRef = useRef(surfaceData)
  const activeRef = useRef(active)
  const sourceDomAvailableRef = useRef(sourceDomAvailable)
  const suspendedRef = useRef(suspended)
  const previewFullscreenRef = useRef(previewFullscreen)
  const previewSnapshotTimeRef = useRef(previewSnapshotTime)
  const previewSnapshotToleranceRef = useRef(previewSnapshotTolerance)
  const snapshotBlockedRef = useRef(snapshotBlocked)
  const frameLoopRef = useRef<ReflectionFrameLoop | null>(null)
  const renderPreparedRevisionRef = useRef<(revision: string) => boolean>(
    () => false,
  )
  const preparedRevisionRef = useRef('')
  const contentRevisionRef = useRef('')
  const prepareGenerationRef = useRef(0)
  const urgentGenerationRef = useRef(0)
  const preloadGenerationRef = useRef(0)
  const prepareCountRef = useRef(0)
  const [runtimeReady, setRuntimeReady] = useState(false)
  const livePreviewControllerRef = useRef<{
    syncLifecycle: () => void
    requestSnapshot: () => void
  } | null>(null)
  const frameSources = useMemo(
    () => frames.map(createFrameReflectionSource),
    [frames],
  )
  const preloadSources = useMemo(
    () => preloadFrames.map(createFrameReflectionSource),
    [preloadFrames],
  )
  const reflectionSources = useMemo<Project[]>(() => {
    const sourceTemplate =
      frameSources.find((source) => source.id === activeFrame.id) ??
      frameSources[0] ??
      createFrameReflectionSource(activeFrame)

    return [
      ...frameSources,
      {
        ...sourceTemplate,
        id: 'frame-ring-preview',
        title: activeFrame.timecode,
        subtitle: clip.resolution,
        cover: activeFrame.thumbnail,
        updatedAt: activeFrame.timecode,
      },
      ...(frames.length > 0
        ? [
            {
              ...sourceTemplate,
              id: 'frame-ring-info',
              title: `Frame  ${activeFrame.timecode}`,
              subtitle: `${clip.resolution} · ${clip.codec}`,
              cover: activeFrame.thumbnail,
              updatedAt: clip.duration,
            },
            {
              ...sourceTemplate,
              id: 'frame-ring-action',
              title: `Frame actions  ${activeFrame.timecode}`,
              subtitle: `${clip.resolution} · ${clip.codec}`,
              cover: activeFrame.thumbnail,
              updatedAt: clip.duration,
            },
          ]
        : []),
    ]
  }, [activeFrame, clip.codec, clip.duration, clip.resolution, frameSources, frames.length])
  const retainedSources = useMemo(() => {
    const sourcesById = new Map<string, Project>()
    reflectionSources.forEach((source) => sourcesById.set(source.id, source))
    preloadSources.forEach((source) => sourcesById.set(source.id, source))
    return [...sourcesById.values()]
  }, [preloadSources, reflectionSources])
  const textureRevisions = useMemo(() => {
    const revisions = new Map<string, string>()
    ;[...frames, ...preloadFrames].forEach((frame) => {
      revisions.set(
        frame.id,
        JSON.stringify({
          frame,
          materialTint,
          materialTintFilter,
          pageColorGradeFilter,
        }),
      )
    })
    revisions.set(
      'frame-ring-preview',
      JSON.stringify({
        runtimeVersion: reflectionRuntimeVersion,
        frame: activeFrame,
        clipId: clip.id,
        sourceUrl: clip.sourceUrl,
        resolution: clip.resolution,
        previewDomRevision,
        materialTint,
        materialTintFilter,
        pageColorGradeFilter,
      }),
    )
    revisions.set(
      'frame-ring-info',
      JSON.stringify({
        runtimeVersion: reflectionRuntimeVersion,
        frame: activeFrame,
        clip: {
          id: clip.id,
          filename: clip.filename,
          duration: clip.duration,
          resolution: clip.resolution,
          codec: clip.codec,
          capturedAt: clip.capturedAt,
        },
        infoRevision,
        materialTint,
        materialTintFilter,
        pageColorGradeFilter,
      }),
    )
    revisions.set(
      'frame-ring-action',
      JSON.stringify({
        runtimeVersion: reflectionRuntimeVersion,
        frame: activeFrame,
        clip: {
          id: clip.id,
          filename: clip.filename,
          duration: clip.duration,
          resolution: clip.resolution,
          codec: clip.codec,
          capturedAt: clip.capturedAt,
        },
        infoRevision,
        materialTint,
        materialTintFilter,
        pageColorGradeFilter,
      }),
    )
    return revisions
  }, [
    activeFrame,
    clip,
    frames,
    infoRevision,
    materialTint,
    materialTintFilter,
    pageColorGradeFilter,
    preloadFrames,
    previewDomRevision,
    reflectionRuntimeVersion,
  ])
  const contentRevision = useMemo(
    () => createReflectionContentRevision(reflectionSources, textureRevisions),
    [reflectionSources, textureRevisions],
  )
  const reflectionSourcesRef = useRef(reflectionSources)
  const retainedSourcesRef = useRef(retainedSources)
  const textureRevisionsRef = useRef(textureRevisions)
  reflectionSourcesRef.current = reflectionSources
  retainedSourcesRef.current = retainedSources
  textureRevisionsRef.current = textureRevisions
  contentRevisionRef.current = contentRevision
  cameraYawRef.current = cameraYaw
  cameraPitchRef.current = cameraPitch
  materialTintRef.current = materialTint
  materialTintFilterRef.current = materialTintFilter
  pageColorGradeFilterRef.current = pageColorGradeFilter
  surfaceDataRef.current = surfaceData
  activeRef.current = active
  sourceDomAvailableRef.current = sourceDomAvailable
  suspendedRef.current = suspended
  previewFullscreenRef.current = previewFullscreen
  previewSnapshotTimeRef.current = previewSnapshotTime
  previewSnapshotToleranceRef.current = previewSnapshotTolerance
  snapshotBlockedRef.current = snapshotBlocked

  useEffect(() => {
    if (!active || runtimeReady) return
    const frame = requestAnimationFrame(() => setRuntimeReady(true))
    return () => cancelAnimationFrame(frame)
  }, [active, runtimeReady])

  useEffect(() => {
    if (!runtimeReady) return
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let fallback = false
    let frameLoop: ReflectionFrameLoop | null = null

    const invalidate = () => {
      if (
        disposed ||
        fallback ||
        !frameLoop ||
        !activeRef.current ||
        suspendedRef.current
      ) return
      canvas.dataset.renderState = 'active'
      frameLoop.invalidate()
    }
    const requestTextureFrame = () => {
      if (
        disposed ||
        fallback ||
        !frameLoop ||
        !activeRef.current ||
        suspendedRef.current
      ) return
      canvas.dataset.renderState = 'active'
      frameLoop.wakeForTextureFrame()
    }
    invalidateRef.current = invalidate

    preparedRevisionRef.current = ''
    canvas.dataset.reflectionPreparedRevision = ''
    canvas.dataset.reflectionRenderedRevision = ''
    canvas.dataset.reflectionContentReady = 'false'
    canvas.dataset.reflectionPrepareState = 'waiting-dom'

    const renderer = createIceReflectionRenderer(canvas, [], {
      onInvalidate: invalidate,
      onTextureFrame: requestTextureFrame,
      sourceCapacity: FRAME_RING_REFLECTION_SOURCE_CAPACITY,
      sourceAlphaBottom: FRAME_RING_ALPHA_BOTTOM,
      sourceLightAsset: './aurora/video-kuang-light16x9.png',
      materialTint: materialTintRef.current,
      textureCache: {
        assetVersion: reflectionRuntimeVersion,
        createTextureKey: (project, assetVersion) =>
          JSON.stringify([
            assetVersion,
            project.id,
            textureRevisionsRef.current.get(project.id) ?? project,
          ]),
        drawCard: (project, width) =>
          drawFrameRingReflectionSource(project, width, {
            materialTintFilter: materialTintFilterRef.current,
            pageColorGradeFilter: pageColorGradeFilterRef.current,
          }),
        textureWidth: 1024,
        textureHeight: Math.round((1024 * 1080) / 1728),
      },
    })

    if (!renderer) {
      fallback = true
      canvas.dataset.renderState = 'fallback'
      return
    }
    rendererRef.current = renderer
    renderer.setSurfaceData(surfaceDataRef.current)

    const renderSnapshot = (
      timestamp: number,
      renderState: 'active' | 'idle',
    ) => {
      const stage = stageRef.current
      if (!stage) return { changed: false, rendered: false }

      const snapshot = sampleFrameRingReflections(stage)
      renderer.resize(snapshot.width, snapshot.height)
      canvas.dataset.reflectionSampledSourceCount = String(
        snapshot.samples.length,
      )
      canvas.dataset.reflectionMissingSourceIds = snapshot.samples
        .map((sample) => sample.projectId ?? '')
        .filter(
          (projectId) =>
            projectId && !renderer.hasProjectTexture(projectId),
        )
        .join(',')
      canvas.dataset.reflectionInactiveSourceIds = snapshot.samples
        .filter(
          (sample) =>
            sample.width <= 0 ||
            sample.height <= 0 ||
            sample.opacity <= 0 ||
            sample.reflectionOpacity <= 0,
        )
        .map(
          (sample) =>
            `${sample.projectId ?? ''}:${sample.opacity.toFixed(3)}:${sample.reflectionOpacity.toFixed(3)}`,
        )
        .join(',')
      const changed = renderer.sync(
        snapshot.samples,
        cameraYawRef.current,
        cameraPitchRef.current,
      )
      renderer.retainProjects(retainedSourcesRef.current)
      const previousRenderCount = renderer.diagnostics.renderCount
      renderer.render(timestamp / 1000)
      const diagnostics = renderer.diagnostics
      writeDiagnostics(canvas, diagnostics, renderState)
      const currentRevision = contentRevisionRef.current
      const rendered =
        diagnostics.ready &&
        diagnostics.renderCount > previousRenderCount &&
        preparedRevisionRef.current === currentRevision
      if (rendered) {
        canvas.dataset.reflectionRenderedRevision = currentRevision
        canvas.dataset.reflectionContentReady = 'true'
        canvas.dataset.reflectionPrepareState = 'ready'
      }
      return { changed, rendered }
    }

    renderPreparedRevisionRef.current = (revision) => {
      if (
        disposed ||
        fallback ||
        rendererRef.current !== renderer ||
        !renderer.diagnostics.ready ||
        !sourceDomAvailableRef.current ||
        contentRevisionRef.current !== revision ||
        preparedRevisionRef.current !== revision
      ) {
        return false
      }

      return renderSnapshot(
        performance.now(),
        activeRef.current ? 'active' : 'idle',
      ).rendered
    }

    frameLoop = new ReflectionFrameLoop({
      sampleAndRender: (timestamp) => {
        if (!activeRef.current || suspendedRef.current) {
          return { changed: false }
        }
        const { changed } = renderSnapshot(timestamp, 'active')
        queueMicrotask(() => {
          if (!disposed && !fallback && !frameLoop?.running) {
            canvas.dataset.renderState = 'idle'
          }
        })
        return { changed }
      },
    })
    frameLoopRef.current = frameLoop

    void renderer
      .whenReady()
      .then(() => {
        const revision = contentRevisionRef.current
        if (!renderPreparedRevisionRef.current(revision)) invalidate()
      })
      .catch(() => {
        if (disposed) return
        fallback = true
        frameLoop?.dispose()
        if (frameLoopRef.current === frameLoop) frameLoopRef.current = null
        renderer.dispose()
        if (rendererRef.current === renderer) rendererRef.current = null
        canvas.dataset.renderState = 'fallback'
      })

    invalidate()

    return () => {
      disposed = true
      invalidateRef.current = () => undefined
      renderPreparedRevisionRef.current = () => false
      frameLoop?.dispose()
      if (frameLoopRef.current === frameLoop) frameLoopRef.current = null
      renderer.disposeDeferred()
      if (rendererRef.current === renderer) rendererRef.current = null
    }
  // The renderer is kept alive across page changes. Including the runtime
  // version ensures an HMR schema/capacity change cannot retain stale GPU and
  // DOM-raster caches until the whole browser page is refreshed.
  }, [reflectionRuntimeVersion, runtimeReady, stageRef])

  const previewCaptureRevision = useMemo(
    () => JSON.stringify({
      runtimeVersion: reflectionRuntimeVersion,
      clipId: clip.id,
      sourceUrl: clip.sourceUrl,
      resolution: clip.resolution,
      materialTintFilter,
      pageColorGradeFilter,
    }),
    [
      clip.id,
      clip.resolution,
      clip.sourceUrl,
      materialTintFilter,
      pageColorGradeFilter,
      reflectionRuntimeVersion,
    ],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    const video = previewVideoRef.current
    const preview = stageRef.current?.querySelector<HTMLElement>(
      '.frameRingPreview[data-reflection-project-id="frame-ring-preview"]',
    )
    if (
      !canvas ||
      !renderer ||
      !video ||
      !preview ||
      !runtimeReady ||
      !sourceDomAvailable
    ) {
      livePreviewControllerRef.current = null
      if (canvas) canvas.dataset.liveReflectionState = 'static'
      return
    }

    const liveVideo = video
    let disposed = false
    let snapshotGeneration = 0
    let snapshotCount = 0
    let targetCanvas: HTMLCanvasElement | null = null
    let maskImage: HTMLImageElement | null = null
    let blockedSource = ''
    let snapshotRetryAttempt = 0
    let snapshotRetryTimer: number | null = null
    let snapshotVideoFrameCallback: number | null = null

    const getLifecycle = () => ({
      active: activeRef.current,
      suspended: suspendedRef.current,
      fullscreen:
        previewFullscreenRef.current || document.fullscreenElement === preview,
      documentHidden: document.visibilityState === 'hidden',
    })

    const canUpdate = () => canUpdateFrameRingLiveReflection(getLifecycle())

    const clearSnapshotRetryWakeups = () => {
      if (snapshotRetryTimer !== null) {
        window.clearTimeout(snapshotRetryTimer)
        snapshotRetryTimer = null
      }
      if (
        snapshotVideoFrameCallback !== null &&
        typeof liveVideo.cancelVideoFrameCallback === 'function'
      ) {
        liveVideo.cancelVideoFrameCallback(snapshotVideoFrameCallback)
        snapshotVideoFrameCallback = null
      }
    }

    const invalidatePendingSnapshot = () => {
      snapshotGeneration += 1
      snapshotRetryAttempt = 0
      clearSnapshotRetryWakeups()
    }

    const isSnapshotReady = () => canCaptureFrameRingReflectionSnapshot({
      lifecycle: getLifecycle(),
      blocked: snapshotBlockedRef.current,
      paused: liveVideo.paused,
      ended: liveVideo.ended,
      seeking: liveVideo.seeking,
      readyState: liveVideo.readyState,
      currentTime: liveVideo.currentTime,
      expectedTime: previewSnapshotTimeRef.current,
      timeTolerance: previewSnapshotToleranceRef.current,
    })

    const scheduleSnapshotRetry = (generation: number) => {
      if (
        disposed ||
        snapshotGeneration !== generation ||
        !canUpdate() ||
        snapshotBlockedRef.current ||
        liveVideo.seeking ||
        (!liveVideo.paused && !liveVideo.ended)
      ) {
        return
      }

      const retryDelay = getFrameRingReflectionSnapshotRetryDelay(
        snapshotRetryAttempt,
      )
      if (retryDelay === null) {
        canvas.dataset.liveReflectionState = 'snapshot-error'
        return
      }
      snapshotRetryAttempt += 1
      clearSnapshotRetryWakeups()

      let retryConsumed = false
      const retry = () => {
        if (
          retryConsumed ||
          disposed ||
          snapshotGeneration !== generation
        ) {
          return
        }
        retryConsumed = true
        clearSnapshotRetryWakeups()
        requestSnapshot(true)
      }

      if (typeof liveVideo.requestVideoFrameCallback === 'function') {
        snapshotVideoFrameCallback = liveVideo.requestVideoFrameCallback(() => {
          snapshotVideoFrameCallback = null
          retry()
        })
      }
      snapshotRetryTimer = window.setTimeout(() => {
        snapshotRetryTimer = null
        retry()
      }, retryDelay)
    }

    const requestSnapshot = (retry = false) => {
      const generation = retry
        ? snapshotGeneration
        : snapshotGeneration + 1
      if (!retry) {
        snapshotGeneration = generation
        snapshotRetryAttempt = 0
        clearSnapshotRetryWakeups()
      }
      const sourceKey = liveVideo.currentSrc || liveVideo.src

      if (blockedSource && blockedSource === sourceKey) {
        canvas.dataset.liveReflectionState = 'fallback'
        return
      }
      if (!canUpdate()) {
        canvas.dataset.liveReflectionState =
          previewFullscreenRef.current || document.fullscreenElement === preview
          ? 'fullscreen-paused'
          : 'hidden-paused'
        return
      }
      if (snapshotBlockedRef.current) {
        canvas.dataset.liveReflectionState = 'interaction-held'
        return
      }
      if (!liveVideo.paused && !liveVideo.ended) {
        canvas.dataset.liveReflectionState = 'playing-frozen'
        return
      }
      if (liveVideo.seeking) {
        canvas.dataset.liveReflectionState = 'seeking-held'
        return
      }
      if (!isSnapshotReady()) {
        canvas.dataset.liveReflectionState = 'waiting-frame'
        scheduleSnapshotRetry(generation)
        return
      }

      canvas.dataset.liveReflectionState = 'snapshot-pending'
      void (async () => {
        try {
          await waitForReflectionDomFrames(2)
          const snapshotInvalid =
            disposed ||
            snapshotGeneration !== generation ||
            rendererRef.current !== renderer ||
            previewVideoRef.current !== liveVideo ||
            (liveVideo.currentSrc || liveVideo.src) !== sourceKey
          if (snapshotInvalid) {
            return
          }
          if (
            !isSnapshotReady() ||
            liveVideo.videoWidth <= 0 ||
            liveVideo.videoHeight <= 0
          ) {
            canvas.dataset.liveReflectionState = 'waiting-frame'
            scheduleSnapshotRetry(generation)
            return
          }

          const [chromeCanvas, nextMaskImage] = await Promise.all([
            drawFrameRingPreviewChromeSource(
              FRAME_RING_LIVE_REFLECTION_TEXTURE_WIDTH,
              {
                materialTintFilter,
                pageColorGradeFilter,
              },
            ),
            maskImage
              ? Promise.resolve(maskImage)
              : loadFrameRingPreviewMask(),
          ])
          const snapshotBecameInvalid =
            disposed ||
            snapshotGeneration !== generation ||
            rendererRef.current !== renderer ||
            previewVideoRef.current !== liveVideo ||
            (liveVideo.currentSrc || liveVideo.src) !== sourceKey
          if (snapshotBecameInvalid) {
            return
          }
          if (!isSnapshotReady()) {
            canvas.dataset.liveReflectionState = 'waiting-frame'
            scheduleSnapshotRetry(generation)
            return
          }
          maskImage = nextMaskImage

          const scratchTarget = document.createElement('canvas')
          scratchTarget.width = chromeCanvas.width
          scratchTarget.height = chromeCanvas.height
          const scratchMedia = document.createElement('canvas')
          scratchMedia.width = chromeCanvas.width
          scratchMedia.height = chromeCanvas.height
          const mediaRect = resolveFrameRingVideoCanvasRect(
            preview,
            liveVideo,
            scratchTarget,
          )
          if (!mediaRect) {
            canvas.dataset.liveReflectionState = 'waiting-frame'
            scheduleSnapshotRetry(generation)
            return
          }

          const videoStyle = getComputedStyle(liveVideo)
          const drawn = drawFrameRingLiveReflectionFrame({
            targetCanvas: scratchTarget,
            mediaCanvas: scratchMedia,
            chromeCanvas,
            frame: liveVideo,
            frameWidth: liveVideo.videoWidth,
            frameHeight: liveVideo.videoHeight,
            mediaRect,
            objectFit: videoStyle.objectFit || 'contain',
            objectPosition: videoStyle.objectPosition || '50% 50%',
            colorFilter: combineMediaColorFilters(
              mediaColorFilter,
              pageColorGradeFilter,
            ),
            maskImage,
          })
          const scratchContext = scratchTarget.getContext('2d')
          if (!drawn || !scratchContext) {
            canvas.dataset.liveReflectionState = 'waiting-frame'
            scheduleSnapshotRetry(generation)
            return
          }
          scratchContext.getImageData(0, 0, 1, 1)

          const snapshotNoLongerCurrent =
            disposed ||
            snapshotGeneration !== generation ||
            rendererRef.current !== renderer ||
            previewVideoRef.current !== liveVideo ||
            (liveVideo.currentSrc || liveVideo.src) !== sourceKey
          if (snapshotNoLongerCurrent) {
            return
          }
          if (!isSnapshotReady()) {
            canvas.dataset.liveReflectionState = 'waiting-frame'
            scheduleSnapshotRetry(generation)
            return
          }

          if (!targetCanvas) targetCanvas = document.createElement('canvas')
          if (
            targetCanvas.width !== scratchTarget.width ||
            targetCanvas.height !== scratchTarget.height
          ) {
            targetCanvas.width = scratchTarget.width
            targetCanvas.height = scratchTarget.height
          }
          const targetContext = targetCanvas.getContext('2d')
          if (!targetContext) return
          targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
          targetContext.drawImage(scratchTarget, 0, 0)
          renderer.setProjectCanvasTexture('frame-ring-preview', targetCanvas)
          clearSnapshotRetryWakeups()
          snapshotRetryAttempt = 0
          snapshotCount += 1
          canvas.dataset.liveReflectionFrameCount = String(snapshotCount)
          canvas.dataset.liveReflectionState = 'paused-snapshot'
        } catch (error) {
          if (
            disposed ||
            snapshotGeneration !== generation ||
            rendererRef.current !== renderer
          ) {
            return
          }
          if ((error as { name?: string })?.name === 'SecurityError') {
            blockedSource = sourceKey
            renderer.setProjectCanvasTexture('frame-ring-preview', null)
            canvas.dataset.liveReflectionState = 'fallback'
            return
          }
          canvas.dataset.liveReflectionState = 'waiting-frame'
          scheduleSnapshotRetry(generation)
        }
      })()
    }

    const syncLifecycle = () => {
      if (
        !canUpdate() ||
        snapshotBlockedRef.current ||
        (!liveVideo.paused && !liveVideo.ended)
      ) {
        invalidatePendingSnapshot()
      }
      if (!canUpdate()) {
        canvas.dataset.liveReflectionState =
          previewFullscreenRef.current || document.fullscreenElement === preview
          ? 'fullscreen-paused'
          : 'hidden-paused'
        return
      }
      if (snapshotBlockedRef.current) {
        canvas.dataset.liveReflectionState = 'interaction-held'
        return
      }
      if (!liveVideo.paused && !liveVideo.ended) {
        canvas.dataset.liveReflectionState = 'playing-frozen'
        return
      }
      requestSnapshot()
    }

    const handlePlay = () => syncLifecycle()
    const handleSeeking = () => {
      invalidatePendingSnapshot()
      canvas.dataset.liveReflectionState = 'seeking-held'
    }
    const handleStablePausedFrame = () => {
      window.queueMicrotask(() => {
        if (
          disposed ||
          liveVideo.seeking ||
          (!liveVideo.paused && !liveVideo.ended)
        ) {
          return
        }
        requestSnapshot()
      })
    }
    const handleVideoUnavailable = () => {
      invalidatePendingSnapshot()
      renderer.setProjectCanvasTexture('frame-ring-preview', null)
      canvas.dataset.liveReflectionState = 'fallback'
    }
    const handleVisibilityChange = () => syncLifecycle()

    liveVideo.addEventListener('play', handlePlay)
    liveVideo.addEventListener('seeking', handleSeeking)
    liveVideo.addEventListener('pause', handleStablePausedFrame)
    liveVideo.addEventListener('ended', handleStablePausedFrame)
    liveVideo.addEventListener('seeked', handleStablePausedFrame)
    liveVideo.addEventListener('loadeddata', handleStablePausedFrame)
    liveVideo.addEventListener('canplay', handleStablePausedFrame)
    liveVideo.addEventListener('emptied', handleVideoUnavailable)
    liveVideo.addEventListener('error', handleVideoUnavailable)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    canvas.dataset.liveReflectionState = 'preparing'
    canvas.dataset.liveReflectionFrameCount = '0'
    livePreviewControllerRef.current = { requestSnapshot, syncLifecycle }
    syncLifecycle()

    return () => {
      disposed = true
      invalidatePendingSnapshot()
      liveVideo.removeEventListener('play', handlePlay)
      liveVideo.removeEventListener('seeking', handleSeeking)
      liveVideo.removeEventListener('pause', handleStablePausedFrame)
      liveVideo.removeEventListener('ended', handleStablePausedFrame)
      liveVideo.removeEventListener('seeked', handleStablePausedFrame)
      liveVideo.removeEventListener('loadeddata', handleStablePausedFrame)
      liveVideo.removeEventListener('canplay', handleStablePausedFrame)
      liveVideo.removeEventListener('emptied', handleVideoUnavailable)
      liveVideo.removeEventListener('error', handleVideoUnavailable)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (livePreviewControllerRef.current?.syncLifecycle === syncLifecycle) {
        livePreviewControllerRef.current = null
      }
      if (rendererRef.current === renderer) {
        renderer.setProjectCanvasTexture('frame-ring-preview', null)
      }
    }
  }, [
    materialTintFilter,
    mediaColorFilter,
    pageColorGradeFilter,
    previewCaptureRevision,
    previewVideoRef,
    reflectionRuntimeVersion,
    runtimeReady,
    sourceDomAvailable,
    stageRef,
  ])

  useEffect(() => {
    livePreviewControllerRef.current?.syncLifecycle()
  }, [active, previewFullscreen, previewPlaying, snapshotBlocked, suspended])

  useEffect(() => {
    void previewSnapshotRevision
    livePreviewControllerRef.current?.requestSnapshot()
  }, [previewSnapshotRevision])

  useLayoutEffect(() => {
    if (!active) return
    renderPreparedRevisionRef.current(contentRevision)
  }, [active, contentRevision])

  useEffect(() => {
    if (!active || suspended) {
      frameLoopRef.current?.pause()
      return
    }

    const stage = stageRef.current
    if (!stage) return
    const invalidate = () => invalidateRef.current()
    const resizeObserver = new ResizeObserver(invalidate)
    resizeObserver.observe(stage)
    stage.addEventListener('pointermove', invalidate)
    stage.addEventListener('transitionrun', invalidate, true)
    stage.addEventListener('transitionend', invalidate, true)
    invalidate()

    return () => {
      resizeObserver.disconnect()
      stage.removeEventListener('pointermove', invalidate)
      stage.removeEventListener('transitionrun', invalidate, true)
      stage.removeEventListener('transitionend', invalidate, true)
    }
  }, [active, stageRef, suspended])

  useEffect(() => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !runtimeReady || !canvas) return
    renderer.retainProjects(retainedSources)
    canvas.dataset.reflectionRetainedSourceCount = String(retainedSources.length)
    canvas.dataset.reflectionTextureLimit = String(retainedSources.length)
    invalidateRef.current()
  }, [retainedSources, runtimeReady])

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    const generation = prepareGenerationRef.current + 1
    prepareGenerationRef.current = generation
    if (!canvas) return

    canvas.dataset.reflectionSourceRevision = contentRevision
    canvas.dataset.reflectionSourceCount = String(reflectionSources.length)
    if (preparedRevisionRef.current !== contentRevision) {
      canvas.dataset.reflectionContentReady = 'false'
      canvas.dataset.reflectionRenderedRevision = ''
      canvas.dataset.reflectionPrepareState = 'waiting-dom'
    }
    if (
      !renderer ||
      !runtimeReady ||
      !sourceDomAvailable ||
      interactionActive
    ) {
      return
    }
    if (preparedRevisionRef.current === contentRevision) {
      canvas.dataset.reflectionPreparedRevision = contentRevision
      if (!renderPreparedRevisionRef.current(contentRevision) && active) {
        invalidateRef.current()
      }
      return
    }

    let cancelled = false
    const prepare = async () => {
      let attempt = 0
      while (!cancelled) {
        if (attempt < 3) {
          await waitForReflectionDomFrames(2)
        } else {
          const retryDelay = Math.min(
            2_000,
            250 * 2 ** Math.min(3, attempt - 3),
          )
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, retryDelay)
          })
        }
        if (
          cancelled ||
          prepareGenerationRef.current !== generation ||
          rendererRef.current !== renderer ||
          contentRevisionRef.current !== contentRevision ||
          !sourceDomAvailableRef.current
        ) {
          return
        }

        canvas.dataset.reflectionPrepareState = 'preparing'
        canvas.dataset.reflectionPrepareAttempt = String(attempt + 1)
        try {
          await renderer.prepareProjects(reflectionSources, 3)
          if (
            cancelled ||
            prepareGenerationRef.current !== generation ||
            rendererRef.current !== renderer ||
            contentRevisionRef.current !== contentRevision ||
            !sourceDomAvailableRef.current
          ) {
            renderer.retainProjects(retainedSourcesRef.current)
            return
          }
          renderer.retainProjects(retainedSourcesRef.current)
          preparedRevisionRef.current = contentRevision
          prepareCountRef.current += 1
          canvas.dataset.reflectionPreparedRevision = contentRevision
          canvas.dataset.reflectionPrepareCount = String(
            prepareCountRef.current,
          )
          canvas.dataset.reflectionPrepareState = 'prepared'
          if (
            !renderPreparedRevisionRef.current(contentRevision) &&
            activeRef.current
          ) {
            invalidateRef.current()
          }
          return
        } catch {
          attempt += 1
          canvas.dataset.reflectionPrepareState =
            attempt < 3 ? 'waiting-dom' : 'retrying'
        }
      }
    }

    void prepare()
    return () => {
      cancelled = true
    }
  }, [
    active,
    contentRevision,
    interactionActive,
    reflectionSources,
    runtimeReady,
    sourceDomAvailable,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    const generation = urgentGenerationRef.current + 1
    urgentGenerationRef.current = generation
    if (
      !canvas ||
      !renderer ||
      !active ||
      suspended ||
      !runtimeReady ||
      !sourceDomAvailable ||
      !interactionActive
    ) {
      return
    }

    const urgentSources = frameSources.filter(
      (source) => !renderer.hasProjectTexture(source.id),
    )
    canvas.dataset.reflectionUrgentSourceCount = String(urgentSources.length)
    if (urgentSources.length === 0) return

    let cancelled = false
    const prepareUrgentSources = async () => {
      for (const source of urgentSources) {
        if (
          cancelled ||
          urgentGenerationRef.current !== generation ||
          rendererRef.current !== renderer ||
          !sourceDomAvailableRef.current
        ) {
          return
        }
        try {
          await renderer.prepareProjects([source], 1)
        } catch {
          return
        }
      }
      if (
        cancelled ||
        urgentGenerationRef.current !== generation ||
        rendererRef.current !== renderer
      ) {
        renderer.retainProjects(retainedSourcesRef.current)
        return
      }
      renderer.retainProjects(retainedSourcesRef.current)
      canvas.dataset.reflectionUrgentSourceCount = '0'
      invalidateRef.current()
    }

    void prepareUrgentSources()
    return () => {
      cancelled = true
    }
  }, [
    active,
    frameSources,
    interactionActive,
    runtimeReady,
    sourceDomAvailable,
    suspended,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    const generation = preloadGenerationRef.current + 1
    preloadGenerationRef.current = generation
    if (!canvas) return

    canvas.dataset.reflectionPreloadSourceCount = String(preloadSources.length)
    canvas.dataset.reflectionPreloadReadyCount = String(
      preloadSources.filter((source) =>
        renderer?.hasProjectTexture(source.id),
      ).length,
    )
    if (preloadSources.length === 0) {
      canvas.dataset.reflectionPreloadState = 'ready'
      return
    }
    canvas.dataset.reflectionPreloadState = 'waiting-idle'
    if (
      !renderer ||
      suspended ||
      !runtimeReady ||
      !sourceDomAvailable ||
      interactionActive
    ) {
      return
    }

    let cancelled = false
    const prepare = async () => {
      if (
        cancelled ||
        preloadGenerationRef.current !== generation ||
        rendererRef.current !== renderer
      ) {
        return
      }
      canvas.dataset.reflectionPreloadState = 'preparing'
      for (let index = 0; index < preloadSources.length; index += 1) {
        if (
          cancelled ||
          preloadGenerationRef.current !== generation ||
          rendererRef.current !== renderer ||
          !sourceDomAvailableRef.current
        ) {
          return
        }
        try {
          await renderer.prepareProjects([preloadSources[index]], 1)
        } catch {
          canvas.dataset.reflectionPreloadState = 'error'
          return
        }
        if (index + 1 < preloadSources.length) {
          await waitForReflectionDomFrames(1)
        }
      }
      if (
        cancelled ||
        preloadGenerationRef.current !== generation ||
        rendererRef.current !== renderer
      ) {
        renderer.retainProjects(retainedSourcesRef.current)
        return
      }
      renderer.retainProjects(retainedSourcesRef.current)
      canvas.dataset.reflectionPreloadReadyCount = String(
        preloadSources.filter((source) =>
          renderer.hasProjectTexture(source.id),
        ).length,
      )
      canvas.dataset.reflectionPreloadState = 'ready'
      invalidateRef.current()
    }

    let idleHandle: number | undefined
    let timer: number | undefined
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => {
        void prepare()
      }, { timeout: 320 })
    } else {
      timer = window.setTimeout(() => {
        void prepare()
      }, 120)
    }

    return () => {
      cancelled = true
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [
    interactionActive,
    preloadSources,
    runtimeReady,
    sourceDomAvailable,
    suspended,
    textureRevisions,
  ])

  useEffect(() => {
    void motionSignal
    invalidateRef.current()
  }, [motionSignal])

  useEffect(() => {
    rendererRef.current?.setMaterialTint(materialTint)
    invalidateRef.current()
  }, [materialTint])

  useEffect(() => {
    rendererRef.current?.setSurfaceData(surfaceData)
    invalidateRef.current()
  }, [surfaceData])

  return (
    <canvas
      ref={canvasRef}
      className="frameRingReflectionCanvas"
      data-reflection-active={active}
      data-aurora-renderer="frame-ring-reflection"
      data-dpr-cap={String(DOM_REFLECTION_MAX_DPR)}
      data-render-state="initializing"
      data-renderer-count="0"
      data-render-count="0"
      data-reflection-targets="0"
      data-visible-source-count="0"
      data-texture-count="0"
      data-reflection-ready="false"
      data-reflection-source-revision={contentRevision}
      data-reflection-prepared-revision=""
      data-reflection-rendered-revision=""
      data-reflection-content-ready="false"
      data-reflection-prepare-state="waiting-dom"
      data-reflection-prepare-count="0"
      data-reflection-source-count={String(reflectionSources.length)}
      data-reflection-preload-source-count={String(preloadSources.length)}
      data-reflection-preload-ready-count="0"
      data-reflection-preload-state="waiting-idle"
      data-reflection-urgent-source-count="0"
      data-reflection-retained-source-count={String(retainedSources.length)}
      data-reflection-texture-limit={String(retainedSources.length)}
      data-reflection-sampled-source-count="0"
      data-reflection-missing-source-ids=""
      data-reflection-inactive-source-ids=""
      data-context-lost="false"
      data-reflection-surface-key="initializing"
      data-live-reflection-state="static"
      data-live-reflection-frame-count="0"
      aria-hidden="true"
    />
  )
}
