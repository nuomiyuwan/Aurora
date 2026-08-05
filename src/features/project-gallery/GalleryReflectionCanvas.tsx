import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RefObject } from 'react'
import type { Project } from '../../data/projects'
import type { BackgroundReflectionSurface } from '../reflection/backgroundReflectionSurfaceProtocol'
import {
  createReflectionContentRevision,
  waitForReflectionDomFrames,
} from '../reflection/reflectionContentReadiness'
import {
  DOM_REFLECTION_MAX_DPR,
  createIceReflectionRenderer,
  type IceReflectionDiagnostics,
} from './reflection/IceReflectionRenderer'
import { ReflectionFrameLoop } from './reflection/ReflectionFrameLoop'
import {
  sampleDomGallery,
  type DomFloorLock,
} from './reflection/domCardProjection'
import { HOME_CARD_UI_LAYOUT_VERSION } from './cardUiLayout'
import { drawProjectDomReflectionTexture } from './reflection/drawProjectDomReflectionTexture'

export interface GalleryReflectionCanvasProps {
  active: boolean
  suspended: boolean
  stageRef: RefObject<HTMLElement | null>
  projects: readonly Project[]
  preloadProjects?: readonly Project[]
  motionSignal: string
  layoutSignal: string
  cameraYaw: number
  cameraPitch: number
  materialTint?: string
  surfaceData?: BackgroundReflectionSurface | null
}

const LAYOUT_SETTLE_DURATION_MS = 900
const HOME_PROJECT_COVER_RESOURCE_VERSION = 'home-project-cover-resource-v2'
const GALLERY_REFLECTION_PREPARE_ATTEMPTS = 3

const writeDiagnostics = (
  canvas: HTMLCanvasElement,
  diagnostics: IceReflectionDiagnostics,
  renderState: 'active' | 'idle' | 'fallback',
) => {
  canvas.dataset.renderState = renderState
  canvas.dataset.rendererCount = String(diagnostics.rendererCount)
  canvas.dataset.reflectionRenderCount = String(diagnostics.renderCount)
  canvas.dataset.reflectionTargets = String(diagnostics.targetCount)
  canvas.dataset.reflectionSize = JSON.stringify({
    width: diagnostics.targetWidth,
    height: diagnostics.targetHeight,
  })
  canvas.dataset.sourceCount = String(diagnostics.sourceCount)
  canvas.dataset.visibleSourceCount = String(diagnostics.visibleSourceCount)
  canvas.dataset.sourceSignature = diagnostics.sourceSignature
  canvas.dataset.projectionSignature = diagnostics.projectionSignature
  canvas.dataset.reflectionSurfaceKey = diagnostics.surfaceKey
  canvas.dataset.textureCount = String(diagnostics.textureCount)
  canvas.dataset.missingTextureProjectIds = JSON.stringify(
    diagnostics.missingTextureProjectIds,
  )
  canvas.dataset.textureErrorProjectIds = JSON.stringify(
    diagnostics.textureErrorProjectIds,
  )
  canvas.dataset.reflectionReady = String(diagnostics.ready)
  canvas.dataset.contextLost = String(diagnostics.contextLost)
}

const writeFallbackDiagnostics = (canvas: HTMLCanvasElement) => {
  canvas.dataset.renderState = 'fallback'
  canvas.dataset.rendererCount = '0'
  canvas.dataset.reflectionRenderCount = '0'
  canvas.dataset.reflectionTargets = '0'
  canvas.dataset.reflectionSize = JSON.stringify({ width: 0, height: 0 })
  canvas.dataset.sourceCount = '0'
  canvas.dataset.visibleSourceCount = '0'
  canvas.dataset.sourceSignature = ''
  canvas.dataset.projectionSignature = ''
  canvas.dataset.reflectionSurfaceKey = 'fallback'
  canvas.dataset.textureCount = '0'
  canvas.dataset.missingTextureProjectIds = '[]'
  canvas.dataset.textureErrorProjectIds = '[]'
  canvas.dataset.reflectionReady = 'false'
  canvas.dataset.contextLost = 'false'
  canvas.dataset.reflectionContentReady = 'false'
  canvas.dataset.reflectionPrepareState = 'fallback'
}

export function GalleryReflectionCanvas({
  active,
  suspended,
  stageRef,
  projects,
  preloadProjects = [],
  motionSignal,
  layoutSignal,
  cameraYaw,
  cameraPitch,
  materialTint = '#aec5ff',
  surfaceData = null,
}: GalleryReflectionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const projectsRef = useRef(projects)
  const cameraYawRef = useRef(cameraYaw)
  const cameraPitchRef = useRef(cameraPitch)
  const materialTintRef = useRef(materialTint)
  const surfaceDataRef = useRef(surfaceData)
  const activeRef = useRef(active)
  const suspendedRef = useRef(suspended)
  const rendererRef = useRef<ReturnType<typeof createIceReflectionRenderer>>(null)
  const frameLoopRef = useRef<ReflectionFrameLoop | null>(null)
  const renderPreparedRevisionRef = useRef<(revision: string) => boolean>(
    () => false,
  )
  const preparedRevisionRef = useRef('')
  const contentRevisionRef = useRef('')
  const prepareGenerationRef = useRef(0)
  const preloadGenerationRef = useRef(0)
  const prepareCountRef = useRef(0)
  const preparedTextureRevisionsRef = useRef(new Map<string, string>())
  const invalidateRef = useRef<() => void>(() => undefined)
  const refreshLayoutRef = useRef<() => void>(() => undefined)
  const resetFloorLockRef = useRef<() => void>(() => undefined)
  const runtimeCleanupRef = useRef<(() => void) | null>(null)
  const cleanupTokenRef = useRef(0)
  const [runtimeReady, setRuntimeReady] = useState(active)
  const [prepareRetryToken, setPrepareRetryToken] = useState(0)
  const reflectionProjects = useMemo(() => {
    const projectIds = new Set<string>()
    return projects.filter((project) => {
      if (projectIds.has(project.id)) return false
      projectIds.add(project.id)
      return true
    })
  }, [projects])
  const preloadReflectionProjects = useMemo(() => {
    const projectIds = new Set(
      reflectionProjects.map((project) => project.id),
    )
    return preloadProjects.filter((project) => {
      if (projectIds.has(project.id)) return false
      projectIds.add(project.id)
      return true
    })
  }, [preloadProjects, reflectionProjects])
  const retainedProjects = useMemo(
    () => [...reflectionProjects, ...preloadReflectionProjects],
    [preloadReflectionProjects, reflectionProjects],
  )
  const textureRevisions = useMemo(() => {
    const revisions = new Map<string, string>()
    retainedProjects.forEach((project) => {
      revisions.set(
        project.id,
        JSON.stringify([
          HOME_PROJECT_COVER_RESOURCE_VERSION,
          HOME_CARD_UI_LAYOUT_VERSION,
          materialTint,
          project.id,
          project.cover,
          project.title,
          project.subtitle,
          project.localVideoCount,
          project.onlineVideoCount,
          project.videoCount,
          project.collectionCount,
          project.updatedAt,
        ]),
      )
    })
    return revisions
  }, [materialTint, retainedProjects])
  const contentRevision = useMemo(
    () => createReflectionContentRevision(reflectionProjects, textureRevisions),
    [reflectionProjects, textureRevisions],
  )
  const preloadRevision = useMemo(
    () =>
      createReflectionContentRevision(
        preloadReflectionProjects,
        textureRevisions,
      ),
    [preloadReflectionProjects, textureRevisions],
  )
  const textureRevisionsRef = useRef(textureRevisions)
  const retainedProjectsRef = useRef(retainedProjects)

  projectsRef.current = reflectionProjects
  textureRevisionsRef.current = textureRevisions
  retainedProjectsRef.current = retainedProjects
  contentRevisionRef.current = contentRevision
  cameraYawRef.current = cameraYaw
  cameraPitchRef.current = cameraPitch
  materialTintRef.current = materialTint
  surfaceDataRef.current = surfaceData
  activeRef.current = active
  suspendedRef.current = suspended

  useEffect(() => {
    if (!active || runtimeReady) return
    const frame = requestAnimationFrame(() => setRuntimeReady(true))
    return () => cancelAnimationFrame(frame)
  }, [active, runtimeReady])

  useEffect(() => {
    if (!runtimeReady) return
    cleanupTokenRef.current += 1
    if (!runtimeCleanupRef.current) {
      runtimeCleanupRef.current = (() => {
        const canvas = canvasRef.current
        if (!canvas) return null

        let disposed = false
        let fallback = false
        let floorLock: DomFloorLock | undefined
        let layoutRefreshUntil = 0
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

        const refreshLayout = () => {
          floorLock = undefined
          layoutRefreshUntil = performance.now() + LAYOUT_SETTLE_DURATION_MS
          invalidate()
        }
        const resetFloorLock = () => {
          floorLock = undefined
          layoutRefreshUntil = 0
          invalidate()
        }
        invalidateRef.current = invalidate
        refreshLayoutRef.current = refreshLayout
        resetFloorLockRef.current = resetFloorLock

        preparedRevisionRef.current = ''
        canvas.dataset.reflectionPreparedRevision = ''
        canvas.dataset.reflectionRenderedRevision = ''
        canvas.dataset.reflectionContentReady = 'false'
        canvas.dataset.reflectionPrepareState = 'waiting-dom'

        const renderer = createIceReflectionRenderer(canvas, [], {
          onInvalidate: invalidate,
          sourceCapacity: 7,
          sourceContactOverlapPixels: 1.2,
          sourceEdgeFadeWidth: 0.0001,
          sourceLightAsset: './aurora/home-kuang-light-2k.png',
          materialTint: materialTintRef.current,
          blendOverlappingSources: true,
          textureCache: {
            assetVersion: 'home-dom-reflection-v8',
            createTextureKey: (project, assetVersion) =>
              JSON.stringify([
                assetVersion,
                textureRevisionsRef.current.get(project.id) ??
                  JSON.stringify(project),
              ]),
            drawCard: (project, width) =>
              drawProjectDomReflectionTexture(project, width, {
                resourceRevision:
                  textureRevisionsRef.current.get(project.id) ?? project.cover,
              }),
          },
        })

        if (!renderer) {
          fallback = true
          writeFallbackDiagnostics(canvas)
          return () => {
            disposed = true
            invalidateRef.current = () => undefined
            refreshLayoutRef.current = () => undefined
            resetFloorLockRef.current = () => undefined
            renderPreparedRevisionRef.current = () => false
          }
        }
        rendererRef.current = renderer
        renderer.setSurfaceData(surfaceDataRef.current)

        const renderSnapshot = (
          timestamp: number,
          renderState: 'active' | 'idle',
        ) => {
          const stage = stageRef.current
          if (!stage) return { changed: false, rendered: false }
          const layoutRefreshing = timestamp < layoutRefreshUntil
          const snapshot = sampleDomGallery(
            stage,
            layoutRefreshing ? undefined : floorLock,
          )
          floorLock = layoutRefreshing ? undefined : snapshot.floorLock

          renderer.resize(snapshot.width, snapshot.height)
          const changed = renderer.sync(
            snapshot.samples,
            cameraYawRef.current,
            cameraPitchRef.current,
          )
          const previousRenderCount = renderer.diagnostics.renderCount
          renderer.render(timestamp / 1000)
          const diagnostics = renderer.diagnostics
          writeDiagnostics(canvas, diagnostics, renderState)

          const currentRevision = contentRevisionRef.current
          const sourcesComplete =
            diagnostics.sourceCount === 0
              ? projectsRef.current.length === 0 &&
                snapshot.samples.length === 0
              : diagnostics.visibleSourceCount === diagnostics.sourceCount
          const rendered =
            diagnostics.ready &&
            diagnostics.renderCount > previousRenderCount &&
            preparedRevisionRef.current === currentRevision &&
            diagnostics.missingTextureProjectIds.length === 0 &&
            sourcesComplete
          if (rendered) {
            canvas.dataset.reflectionRenderedRevision = currentRevision
            canvas.dataset.reflectionContentReady = 'true'
            canvas.dataset.reflectionPrepareState = 'ready'
          } else if (preparedRevisionRef.current === currentRevision) {
            canvas.dataset.reflectionContentReady = 'false'
            if (diagnostics.missingTextureProjectIds.length > 0) {
              canvas.dataset.reflectionPrepareState = 'missing-texture'
            }
          }

          return {
            changed: changed || layoutRefreshing,
            rendered,
          }
        }

        renderPreparedRevisionRef.current = (revision) => {
          if (
            disposed ||
            fallback ||
            rendererRef.current !== renderer ||
            !renderer.diagnostics.ready ||
            !activeRef.current ||
            suspendedRef.current ||
            contentRevisionRef.current !== revision ||
            preparedRevisionRef.current !== revision
          ) {
            return false
          }
          return renderSnapshot(performance.now(), 'active').rendered
        }

        frameLoop = new ReflectionFrameLoop({
          sampleAndRender: (timestamp) => {
            if (
              !activeRef.current ||
              suspendedRef.current ||
              !stageRef.current
            ) {
              return { changed: false }
            }
            const { changed } = renderSnapshot(timestamp, 'active')

            queueMicrotask(() => {
              if (disposed || fallback || frameLoop?.running) return
              canvas.dataset.renderState = 'idle'
            })

            return { changed }
          },
        })
        frameLoopRef.current = frameLoop

        const handleVisibilityChange = () => {
          if (document.visibilityState !== 'visible') return
          invalidate()
          if (canvas.dataset.reflectionContentReady !== 'true') {
            setPrepareRetryToken((value) => value + 1)
          }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)
        canvas.addEventListener('webglcontextlost', invalidate)
        canvas.addEventListener('webglcontextrestored', invalidate)

        const styleObserver = new MutationObserver(invalidate)
        styleObserver.observe(document.head, {
          childList: true,
          subtree: true,
          characterData: true,
        })

        let runtimeObserversDetached = false
        const detachRuntimeObservers = () => {
          if (runtimeObserversDetached) return
          runtimeObserversDetached = true
          document.removeEventListener('visibilitychange', handleVisibilityChange)
          canvas.removeEventListener('webglcontextlost', invalidate)
          canvas.removeEventListener('webglcontextrestored', invalidate)
          styleObserver.disconnect()
        }

        void renderer
          .whenReady()
          .then(() => {
            const revision = contentRevisionRef.current
            if (!renderPreparedRevisionRef.current(revision)) invalidate()
          })
          .catch(() => {
            if (disposed) return
            fallback = true
            detachRuntimeObservers()
            frameLoop?.dispose()
            if (frameLoopRef.current === frameLoop) frameLoopRef.current = null
            renderer.dispose()
            if (rendererRef.current === renderer) rendererRef.current = null
            writeFallbackDiagnostics(canvas)
          })

        invalidate()

        return () => {
          disposed = true
          invalidateRef.current = () => undefined
          refreshLayoutRef.current = () => undefined
          resetFloorLockRef.current = () => undefined
          renderPreparedRevisionRef.current = () => false
          detachRuntimeObservers()
          frameLoop?.dispose()
          if (frameLoopRef.current === frameLoop) frameLoopRef.current = null
          renderer.disposeDeferred()
          if (rendererRef.current === renderer) rendererRef.current = null
        }
      })()
    }

    return () => {
      const cleanupToken = cleanupTokenRef.current + 1
      cleanupTokenRef.current = cleanupToken
      queueMicrotask(() => {
        if (cleanupTokenRef.current !== cleanupToken) return
        runtimeCleanupRef.current?.()
        runtimeCleanupRef.current = null
      })
    }
  }, [runtimeReady, stageRef])

  useEffect(() => {
    if (!active || suspended) {
      frameLoopRef.current?.pause()
      return
    }

    const stage = stageRef.current
    if (!stage) return
    const invalidate = () => invalidateRef.current()
    const refreshLayout = () => refreshLayoutRef.current()
    const resizeObserver = new ResizeObserver(refreshLayout)
    resizeObserver.observe(stage)
    stage.addEventListener('pointermove', invalidate)
    stage.addEventListener('pointerover', invalidate)
    stage.addEventListener('pointerout', invalidate)
    stage.addEventListener('transitionrun', invalidate, true)
    stage.addEventListener('transitionend', invalidate, true)
    resetFloorLockRef.current()

    return () => {
      resizeObserver.disconnect()
      stage.removeEventListener('pointermove', invalidate)
      stage.removeEventListener('pointerover', invalidate)
      stage.removeEventListener('pointerout', invalidate)
      stage.removeEventListener('transitionrun', invalidate, true)
      stage.removeEventListener('transitionend', invalidate, true)
    }
  }, [active, stageRef, suspended])

  useLayoutEffect(() => {
    if (!active) return
    renderPreparedRevisionRef.current(contentRevision)
  }, [active, contentRevision])

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    const generation = prepareGenerationRef.current + 1
    prepareGenerationRef.current = generation
    if (!canvas) return

    const sourceProjects = projectsRef.current
    canvas.dataset.reflectionSourceRevision = contentRevision
    canvas.dataset.reflectionSourceCount = String(sourceProjects.length)
    if (preparedRevisionRef.current !== contentRevision) {
      canvas.dataset.reflectionPreparedRevision = ''
      canvas.dataset.reflectionRenderedRevision = ''
      canvas.dataset.reflectionContentReady = 'false'
      canvas.dataset.reflectionPrepareState = 'waiting-dom'
    }
    if (
      !renderer ||
      !runtimeReady ||
      suspended ||
      !stageRef.current
    ) {
      return
    }

    const allSourceTexturesReady = () =>
      sourceProjects.every((project) =>
        renderer.hasProjectTexture(project.id) &&
        preparedTextureRevisionsRef.current.get(project.id) ===
          textureRevisionsRef.current.get(project.id),
      )
    if (allSourceTexturesReady()) {
      preparedRevisionRef.current = contentRevision
      canvas.dataset.reflectionPreparedRevision = contentRevision
      canvas.dataset.reflectionPrepareState = 'prepared'
      renderer.retainProjects(retainedProjectsRef.current)
      if (!renderPreparedRevisionRef.current(contentRevision)) {
        invalidateRef.current()
      }
      return
    }

    let cancelled = false
    const prepare = async () => {
      if (sourceProjects.length === 0) {
        preparedRevisionRef.current = contentRevision
        canvas.dataset.reflectionPreparedRevision = contentRevision
        canvas.dataset.reflectionPrepareState = 'prepared'
        invalidateRef.current()
        return
      }

      for (
        let attempt = 0;
        attempt < GALLERY_REFLECTION_PREPARE_ATTEMPTS;
        attempt += 1
      ) {
        await waitForReflectionDomFrames(2)
        if (
          cancelled ||
          prepareGenerationRef.current !== generation ||
          rendererRef.current !== renderer ||
          contentRevisionRef.current !== contentRevision ||
          suspendedRef.current ||
          !stageRef.current
        ) {
          return
        }

        canvas.dataset.reflectionPrepareState = 'preparing'
        try {
          await renderer.prepareProjects(sourceProjects, 3)
          if (
            cancelled ||
            prepareGenerationRef.current !== generation ||
            rendererRef.current !== renderer ||
            contentRevisionRef.current !== contentRevision ||
            suspendedRef.current ||
            !stageRef.current
          ) {
            return
          }
          sourceProjects.forEach((project) => {
            const revision =
              textureRevisionsRef.current.get(project.id)
            if (revision !== undefined) {
              preparedTextureRevisionsRef.current.set(
                project.id,
                revision,
              )
            }
          })
          if (!allSourceTexturesReady()) {
            throw new Error('Gallery reflection texture preparation is incomplete')
          }
          preparedRevisionRef.current = contentRevision
          prepareCountRef.current += 1
          canvas.dataset.reflectionPreparedRevision = contentRevision
          canvas.dataset.reflectionPrepareCount = String(
            prepareCountRef.current,
          )
          canvas.dataset.reflectionPrepareState = 'prepared'
          renderer.retainProjects(retainedProjectsRef.current)
          if (!renderPreparedRevisionRef.current(contentRevision)) {
            invalidateRef.current()
          }
          return
        } catch {
          canvas.dataset.reflectionContentReady = 'false'
          if (attempt === GALLERY_REFLECTION_PREPARE_ATTEMPTS - 1) {
            canvas.dataset.reflectionPrepareState = 'error'
          } else {
            canvas.dataset.reflectionPrepareState = 'waiting-dom'
          }
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
    prepareRetryToken,
    runtimeReady,
    stageRef,
    suspended,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    const generation = preloadGenerationRef.current + 1
    preloadGenerationRef.current = generation
    if (!canvas) return

    canvas.dataset.reflectionPreloadRevision = preloadRevision
    canvas.dataset.reflectionPreloadSourceCount = String(
      preloadReflectionProjects.length,
    )
    canvas.dataset.reflectionPreloadReadyCount = String(
      preloadReflectionProjects.filter((project) =>
        renderer?.hasProjectTexture(project.id) &&
        preparedTextureRevisionsRef.current.get(project.id) ===
          textureRevisionsRef.current.get(project.id),
      ).length,
    )
    if (preloadReflectionProjects.length === 0) {
      canvas.dataset.reflectionPreloadState = 'ready'
      return
    }
    if (!renderer || !runtimeReady || suspended || !stageRef.current) {
      canvas.dataset.reflectionPreloadState = 'waiting-idle'
      return
    }

    canvas.dataset.reflectionPreloadState = 'waiting-idle'
    let cancelled = false
    const prepare = async () => {
      canvas.dataset.reflectionPreloadState = 'preparing'
      for (let index = 0; index < preloadReflectionProjects.length; index += 1) {
        if (
          cancelled ||
          preloadGenerationRef.current !== generation ||
          rendererRef.current !== renderer ||
          suspendedRef.current ||
          !stageRef.current
        ) {
          return
        }
        try {
          await renderer.prepareProjects(
            [preloadReflectionProjects[index]],
            1,
          )
        } catch {
          canvas.dataset.reflectionPreloadState = 'error'
          return
        }
        const project = preloadReflectionProjects[index]
        const revision =
          textureRevisionsRef.current.get(project.id)
        if (revision !== undefined) {
          preparedTextureRevisionsRef.current.set(
            project.id,
            revision,
          )
        }
        canvas.dataset.reflectionPreloadReadyCount = String(index + 1)
        if (index + 1 < preloadReflectionProjects.length) {
          await waitForReflectionDomFrames(1)
        }
      }
      if (
        cancelled ||
        preloadGenerationRef.current !== generation ||
        rendererRef.current !== renderer
      ) {
        return
      }
      renderer.retainProjects(retainedProjectsRef.current)
      canvas.dataset.reflectionPreloadReadyCount = String(
        preloadReflectionProjects.length,
      )
      canvas.dataset.reflectionPreloadState = 'ready'
    }

    let idleHandle: number | undefined
    let timer: number | undefined
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(
        () => void prepare(),
        { timeout: 320 },
      )
    } else {
      timer = window.setTimeout(() => void prepare(), 120)
    }

    return () => {
      cancelled = true
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [
    preloadReflectionProjects,
    preloadRevision,
    runtimeReady,
    stageRef,
    suspended,
  ])

  useEffect(() => {
    void motionSignal
    invalidateRef.current()
    const canvas = canvasRef.current
    if (
      active &&
      !suspended &&
      (canvas?.dataset.reflectionPrepareState === 'error' ||
        canvas?.dataset.reflectionPrepareState === 'missing-texture')
    ) {
      setPrepareRetryToken((value) => value + 1)
    }
  }, [active, motionSignal, suspended])

  useEffect(() => {
    void layoutSignal
    refreshLayoutRef.current()
  }, [layoutSignal])

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
      className="galleryReflectionCanvas"
      data-reflection-active={active}
      data-aurora-renderer="reflection"
      data-dpr-cap={String(DOM_REFLECTION_MAX_DPR)}
      data-card-source="full"
      data-render-state="initializing"
      data-renderer-count="0"
      data-reflection-render-count="0"
      data-reflection-targets="0"
      data-reflection-size={JSON.stringify({ width: 0, height: 0 })}
      data-source-count="0"
      data-visible-source-count="0"
      data-source-signature=""
      data-projection-signature=""
      data-reflection-surface-key="initializing"
      data-texture-count="0"
      data-missing-texture-project-ids="[]"
      data-texture-error-project-ids="[]"
      data-reflection-ready="false"
      data-reflection-source-revision={contentRevision}
      data-reflection-prepared-revision=""
      data-reflection-rendered-revision=""
      data-reflection-content-ready="false"
      data-reflection-prepare-state="waiting-dom"
      data-reflection-prepare-count="0"
      data-reflection-source-count={String(reflectionProjects.length)}
      data-reflection-preload-revision={preloadRevision}
      data-reflection-preload-source-count={String(
        preloadReflectionProjects.length,
      )}
      data-reflection-preload-ready-count="0"
      data-reflection-preload-state={
        preloadReflectionProjects.length === 0 ? 'ready' : 'waiting-idle'
      }
      data-context-lost="false"
      aria-hidden="true"
    />
  )
}
