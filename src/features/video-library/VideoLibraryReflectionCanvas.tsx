import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
} from '../project-gallery/reflection/IceReflectionRenderer'
import { ReflectionFrameLoop } from '../project-gallery/reflection/ReflectionFrameLoop'
import { sampleVideoClipReflections } from './clipReflectionProjection'
import { drawVideoDomReflectionTexture } from './drawVideoDomReflectionTexture'
import { SQUARE_CARD_ALPHA_BOTTOM } from './videoClipGeometry'
import {
  VIDEO_DETAIL_REFLECTION_ID,
  type ClipReflectionSource,
} from './videoReflectionSource'

export type { ClipReflectionSource } from './videoReflectionSource'

export interface VideoLibraryReflectionCanvasProps {
  active: boolean
  sourceDomAvailable: boolean
  suspended: boolean
  clips: readonly ClipReflectionSource[]
  preloadClips?: readonly ClipReflectionSource[]
  detailClip?: ClipReflectionSource
  motionSignal: string
  cameraYaw: number
  cameraPitch: number
  materialTint?: string
  materialTintFilter?: string
  pageColorGradeFilter?: string
  surfaceData?: BackgroundReflectionSurface | null
  sourceScopeSelector?: string
  cardSelector?: string
  rendererName?: string
  canvasClassName?: string
}

const writeDiagnostics = (
  canvas: HTMLCanvasElement,
  diagnostics: IceReflectionDiagnostics,
  renderState: 'active' | 'idle' | 'fallback',
) => {
  canvas.dataset.renderState = renderState
  canvas.dataset.rendererCount = String(diagnostics.rendererCount)
  canvas.dataset.renderCount = String(diagnostics.renderCount)
  canvas.dataset.reflectionTargets = String(diagnostics.visibleSourceCount)
  canvas.dataset.visibleSourceCount = String(diagnostics.visibleSourceCount)
  canvas.dataset.textureCount = String(diagnostics.textureCount)
  canvas.dataset.reflectionReady = String(diagnostics.ready)
  canvas.dataset.contextLost = String(diagnostics.contextLost)
  canvas.dataset.reflectionSurfaceKey = diagnostics.surfaceKey
}

export function VideoLibraryReflectionCanvas({
  active,
  sourceDomAvailable,
  suspended,
  clips,
  preloadClips = [],
  detailClip,
  motionSignal,
  cameraYaw,
  cameraPitch,
  materialTint = '#aec5ff',
  materialTintFilter = '',
  pageColorGradeFilter = '',
  surfaceData = null,
  sourceScopeSelector = '.videoLibraryView',
  cardSelector = '.videoClipCard.clipRowBottom',
  rendererName = 'clip-reflection',
  canvasClassName = 'videoLibraryReflectionCanvas',
}: VideoLibraryReflectionCanvasProps) {
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
  const [runtimeReady, setRuntimeReady] = useState(false)
  const reflectionProjects = useMemo<Project[]>(
    () =>
      clips.map((clip) => ({
        id: clip.id,
        title: clip.filename,
        subtitle: `${clip.capturedAt} · ${clip.resolution}`,
        cover: clip.thumbnail,
        videoCount: clip.sampleCount,
        collectionCount: 0,
        updatedAt: clip.duration,
      })),
    [clips],
  )
  const preloadProjects = useMemo<Project[]>(() => {
    const sourceIds = new Set(clips.map((clip) => clip.id))
    return preloadClips.flatMap((clip) => {
      if (sourceIds.has(clip.id)) return []
      sourceIds.add(clip.id)
      return [{
        id: clip.id,
        title: clip.filename,
        subtitle: `${clip.capturedAt} · ${clip.resolution}`,
        cover: clip.thumbnail,
        videoCount: clip.sampleCount,
        collectionCount: 0,
        updatedAt: clip.duration,
      }]
    })
  }, [clips, preloadClips])
  const reflectionSources = useMemo<Project[]>(() => {
    if (!detailClip) return reflectionProjects
    return [
      ...reflectionProjects,
      {
        id: VIDEO_DETAIL_REFLECTION_ID,
        title: detailClip.filename,
        subtitle: detailClip.resolution,
        cover: detailClip.thumbnail,
        videoCount: detailClip.sampleCount,
        collectionCount: 0,
        updatedAt: detailClip.duration,
      },
    ]
  }, [detailClip, reflectionProjects])
  const textureRevisions = useMemo(() => {
    const revisions = new Map<string, string>()
    ;[...clips, ...preloadClips].forEach((clip) => {
      revisions.set(
        clip.id,
        JSON.stringify({
          clip,
          materialTint,
          materialTintFilter,
          pageColorGradeFilter,
        }),
      )
    })
    if (detailClip) {
      revisions.set(
        VIDEO_DETAIL_REFLECTION_ID,
        JSON.stringify({
          detailClip,
          materialTint,
          materialTintFilter,
          pageColorGradeFilter,
        }),
      )
    }
    return revisions
  }, [
    clips,
    detailClip,
    materialTint,
    materialTintFilter,
    pageColorGradeFilter,
    preloadClips,
  ])
  const contentRevision = useMemo(
    () => createReflectionContentRevision(reflectionSources, textureRevisions),
    [reflectionSources, textureRevisions],
  )
  const reflectionSourcesRef = useRef(reflectionSources)
  const retainedSources = useMemo(
    () => [...reflectionSources, ...preloadProjects],
    [preloadProjects, reflectionSources],
  )
  const preloadRevision = useMemo(
    () => createReflectionContentRevision(preloadProjects, textureRevisions),
    [preloadProjects, textureRevisions],
  )
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

  useEffect(() => {
    if (!active || runtimeReady) return
    const frame = requestAnimationFrame(() => setRuntimeReady(true))
    return () => cancelAnimationFrame(frame)
  }, [active, runtimeReady])

  useEffect(() => {
    if (!runtimeReady) return
    const canvas = canvasRef.current
    const stage = canvas?.parentElement
    if (!canvas || !(stage instanceof HTMLElement)) return

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
    invalidateRef.current = invalidate

    preparedRevisionRef.current = ''
    canvas.dataset.reflectionPreparedRevision = ''
    canvas.dataset.reflectionRenderedRevision = ''
    canvas.dataset.reflectionContentReady = 'false'
    canvas.dataset.reflectionPrepareState = 'waiting-dom'

    const renderer = createIceReflectionRenderer(canvas, [], {
      onInvalidate: invalidate,
      sourceAlphaBottom: SQUARE_CARD_ALPHA_BOTTOM,
      sourceLightAsset: './aurora/square-frame-light.png',
      materialTint: materialTintRef.current,
      textureCache: {
        assetVersion: `video-library-dom-reflection-v5:${sourceScopeSelector}`,
        createTextureKey: (project, assetVersion) =>
          JSON.stringify([
            assetVersion,
            project.id,
            textureRevisionsRef.current.get(project.id) ?? project.cover,
          ]),
        drawCard: (project, width) =>
          drawVideoDomReflectionTexture(project, width, {
            materialTintFilter: materialTintFilterRef.current,
            pageColorGradeFilter: pageColorGradeFilterRef.current,
            sourceScopeSelector,
          }),
        textureWidth: 1024,
        textureHeight: 1024,
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
      const snapshot = sampleVideoClipReflections(stage, {
        sourceScopeSelector,
        cardSelector,
      })
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
        if (!activeRef.current || suspendedRef.current) return { changed: false }
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

    const resizeObserver = new ResizeObserver(invalidate)
    resizeObserver.observe(stage)
    stage.addEventListener('pointermove', invalidate)
    stage.addEventListener('transitionrun', invalidate, true)
    stage.addEventListener('transitionend', invalidate, true)
    canvas.addEventListener('webglcontextlost', invalidate)
    canvas.addEventListener('webglcontextrestored', invalidate)

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
      resizeObserver.disconnect()
      stage.removeEventListener('pointermove', invalidate)
      stage.removeEventListener('transitionrun', invalidate, true)
      stage.removeEventListener('transitionend', invalidate, true)
      canvas.removeEventListener('webglcontextlost', invalidate)
      canvas.removeEventListener('webglcontextrestored', invalidate)
      frameLoop?.dispose()
      if (frameLoopRef.current === frameLoop) frameLoopRef.current = null
      renderer.disposeDeferred()
      if (rendererRef.current === renderer) rendererRef.current = null
    }
  }, [cardSelector, runtimeReady, sourceScopeSelector])

  useLayoutEffect(() => {
    if (!active) return
    renderPreparedRevisionRef.current(contentRevision)
  }, [active, contentRevision])

  useEffect(() => {
    if (!active || suspended) {
      frameLoopRef.current?.pause()
      return
    }
    invalidateRef.current()
  }, [active, suspended])

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
    if (!renderer || !runtimeReady || !sourceDomAvailable) return
    const allSourceTexturesReady = reflectionSources.every(
      (source) =>
        renderer.hasProjectTexture(source.id) &&
        preparedTextureRevisionsRef.current.get(source.id) ===
          textureRevisionsRef.current.get(source.id),
    )
    if (allSourceTexturesReady) {
      preparedRevisionRef.current = contentRevision
      canvas.dataset.reflectionPreparedRevision = contentRevision
      canvas.dataset.reflectionPrepareState = 'prepared'
      renderer.retainProjects(retainedSourcesRef.current)
      if (!renderPreparedRevisionRef.current(contentRevision) && active) {
        invalidateRef.current()
      }
      return
    }

    let cancelled = false
    const prepare = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await waitForReflectionDomFrames(2)
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
        try {
          await renderer.prepareProjects(reflectionSources, 3)
          if (
            cancelled ||
            prepareGenerationRef.current !== generation ||
            rendererRef.current !== renderer ||
            contentRevisionRef.current !== contentRevision ||
            !sourceDomAvailableRef.current
          ) {
            return
          }
          reflectionSources.forEach((source) => {
            const revision =
              textureRevisionsRef.current.get(source.id)
            if (revision !== undefined) {
              preparedTextureRevisionsRef.current.set(
                source.id,
                revision,
              )
            }
          })
          preparedRevisionRef.current = contentRevision
          prepareCountRef.current += 1
          canvas.dataset.reflectionPreparedRevision = contentRevision
          canvas.dataset.reflectionPrepareCount = String(
            prepareCountRef.current,
          )
          canvas.dataset.reflectionPrepareState = 'prepared'
          renderer.retainProjects(retainedSourcesRef.current)
          if (
            !renderPreparedRevisionRef.current(contentRevision) &&
            activeRef.current
          ) {
            invalidateRef.current()
          }
          return
        } catch {
          if (attempt === 2) {
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
    reflectionSources,
    runtimeReady,
    sourceDomAvailable,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    const generation = preloadGenerationRef.current + 1
    preloadGenerationRef.current = generation
    if (!canvas) return

    canvas.dataset.reflectionPreloadRevision = preloadRevision
    canvas.dataset.reflectionPreloadSourceCount = String(
      preloadProjects.length,
    )
    canvas.dataset.reflectionPreloadReadyCount = String(
      preloadProjects.filter((project) =>
        renderer?.hasProjectTexture(project.id) &&
        preparedTextureRevisionsRef.current.get(project.id) ===
          textureRevisionsRef.current.get(project.id),
      ).length,
    )
    if (preloadProjects.length === 0) {
      canvas.dataset.reflectionPreloadState = 'ready'
      return
    }
    if (
      !renderer ||
      !runtimeReady ||
      !sourceDomAvailable ||
      suspended
    ) {
      canvas.dataset.reflectionPreloadState = 'waiting-idle'
      return
    }

    canvas.dataset.reflectionPreloadState = 'waiting-idle'
    let cancelled = false
    const prepare = async () => {
      canvas.dataset.reflectionPreloadState = 'preparing'
      for (let index = 0; index < preloadProjects.length; index += 1) {
        if (
          cancelled ||
          preloadGenerationRef.current !== generation ||
          rendererRef.current !== renderer ||
          !sourceDomAvailableRef.current ||
          suspendedRef.current
        ) {
          return
        }
        try {
          await renderer.prepareProjects([preloadProjects[index]], 1)
        } catch {
          canvas.dataset.reflectionPreloadState = 'error'
          return
        }
        const project = preloadProjects[index]
        const revision =
          textureRevisionsRef.current.get(project.id)
        if (revision !== undefined) {
          preparedTextureRevisionsRef.current.set(
            project.id,
            revision,
          )
        }
        canvas.dataset.reflectionPreloadReadyCount = String(index + 1)
        if (index + 1 < preloadProjects.length) {
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
      renderer.retainProjects(retainedSourcesRef.current)
      canvas.dataset.reflectionPreloadReadyCount = String(
        preloadProjects.length,
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
    preloadProjects,
    preloadRevision,
    runtimeReady,
    sourceDomAvailable,
    suspended,
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
      className={canvasClassName}
      data-reflection-active={active}
      data-aurora-renderer={rendererName}
      data-reflection-source-scope={sourceScopeSelector}
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
      data-reflection-preload-revision={preloadRevision}
      data-reflection-preload-source-count={String(preloadProjects.length)}
      data-reflection-preload-ready-count="0"
      data-reflection-preload-state={
        preloadProjects.length === 0 ? 'ready' : 'waiting-idle'
      }
      data-context-lost="false"
      data-reflection-surface-key="initializing"
      aria-hidden="true"
    />
  )
}
