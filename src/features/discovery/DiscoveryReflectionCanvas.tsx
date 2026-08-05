import { useEffect, useMemo, useRef, useState } from 'react'
import type { BackgroundReflectionSurface } from '../reflection/backgroundReflectionSurfaceProtocol'
import {
  DOM_REFLECTION_MAX_DPR,
  createIceReflectionRenderer,
  type IceReflectionDiagnostics,
} from '../project-gallery/reflection/IceReflectionRenderer'
import { ReflectionFrameLoop } from '../project-gallery/reflection/ReflectionFrameLoop'
import type { DiscoveryResult } from './discoveryData'
import {
  createDiscoveryReflectionProjects,
  DISCOVERY_DETAIL_REFLECTION_ID,
  DISCOVERY_REFLECTION_RUNTIME_VERSION,
  DISCOVERY_REFLECTION_SOURCE_CAPACITY,
  DISCOVERY_RESULT_ALPHA_BOTTOM,
} from './discoveryReflectionSource'
import { sampleDiscoveryReflections } from './discoveryReflectionProjection'
import { drawDiscoveryDomReflectionTexture } from './drawDiscoveryDomReflectionTexture'

export const DISCOVERY_REFLECTION_MOTION_EVENT =
  'aurora:discovery-reflection-motion'

export interface DiscoveryReflectionCanvasProps {
  active: boolean
  suspended: boolean
  visible?: boolean
  results: readonly DiscoveryResult[]
  preloadResults?: readonly DiscoveryResult[]
  selectedResult?: DiscoveryResult | null
  preparationRevision?: string
  onPreparationReady?: (
    revision: string,
    outcome: 'ready' | 'fallback',
  ) => void
  motionSignal: string
  textureRevisionSignal?: string
  cameraYaw: number
  cameraPitch: number
  materialTint?: string
  surfaceData?: BackgroundReflectionSurface | null
}

const writeDiagnostics = (
  canvas: HTMLCanvasElement,
  diagnostics: IceReflectionDiagnostics,
  fallbackCount: number,
  renderState: 'active' | 'idle' | 'fallback',
) => {
  canvas.dataset.renderState = renderState
  canvas.dataset.rendererCount = String(diagnostics.rendererCount)
  canvas.dataset.renderCount = String(diagnostics.renderCount)
  canvas.dataset.reflectionTargets = String(diagnostics.targetCount)
  canvas.dataset.reflectionSize = JSON.stringify({
    width: diagnostics.targetWidth,
    height: diagnostics.targetHeight,
  })
  canvas.dataset.sourceCapacity = String(diagnostics.sourceCapacity)
  canvas.dataset.sourceCount = String(diagnostics.sourceCount)
  canvas.dataset.visibleSourceCount = String(diagnostics.visibleSourceCount)
  canvas.dataset.sourceSignature = diagnostics.sourceSignature
  canvas.dataset.projectionSignature = diagnostics.projectionSignature
  canvas.dataset.textureCount = String(diagnostics.textureCount)
  canvas.dataset.reflectionReady = String(diagnostics.ready)
  canvas.dataset.contextLost = String(diagnostics.contextLost)
  canvas.dataset.reflectionSurfaceKey = diagnostics.surfaceKey
  canvas.dataset.projectionFallbackCount = String(fallbackCount)
}

export function DiscoveryReflectionCanvas({
  active,
  suspended,
  visible = true,
  results,
  preloadResults = [],
  selectedResult,
  preparationRevision = '',
  onPreparationReady,
  motionSignal,
  textureRevisionSignal = '',
  cameraYaw,
  cameraPitch,
  materialTint = '#aec5ff',
  surfaceData = null,
}: DiscoveryReflectionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const invalidateRef = useRef<() => void>(() => undefined)
  const rendererRef = useRef<ReturnType<typeof createIceReflectionRenderer>>(null)
  const cameraYawRef = useRef(cameraYaw)
  const cameraPitchRef = useRef(cameraPitch)
  const materialTintRef = useRef(materialTint)
  const surfaceDataRef = useRef(surfaceData)
  const activeRef = useRef(active)
  const suspendedRef = useRef(suspended)
  const frameLoopRef = useRef<ReflectionFrameLoop | null>(null)
  const onPreparationReadyRef = useRef(onPreparationReady)
  const notifiedPreparationRevisionRef = useRef('')
  const [runtimeReady, setRuntimeReady] = useState(false)
  const reflectionSources = useMemo(
    () => createDiscoveryReflectionProjects(results, selectedResult),
    [results, selectedResult],
  )
  const preloadSources = useMemo(
    () => createDiscoveryReflectionProjects(preloadResults),
    [preloadResults],
  )
  const textureRevisions = useMemo(() => {
    const revisions = new Map<string, string>()
    const writeRevision = (result: DiscoveryResult) => {
      revisions.set(
        result.id,
        JSON.stringify({
          runtimeVersion: DISCOVERY_REFLECTION_RUNTIME_VERSION,
          result,
          materialTint,
        }),
      )
    }
    results.forEach(writeRevision)
    preloadResults.forEach((result) => {
      if (revisions.has(result.id)) return
      writeRevision(result)
    })
    if (selectedResult) {
      revisions.set(
        DISCOVERY_DETAIL_REFLECTION_ID,
        JSON.stringify({
          runtimeVersion: DISCOVERY_REFLECTION_RUNTIME_VERSION,
          result: selectedResult,
          ui: textureRevisionSignal,
          materialTint,
        }),
      )
    }
    return revisions
  }, [
    materialTint,
    preloadResults,
    results,
    selectedResult,
    textureRevisionSignal,
  ])
  const reflectionSourcesRef = useRef(reflectionSources)
  const textureRevisionsRef = useRef(textureRevisions)
  reflectionSourcesRef.current = reflectionSources
  textureRevisionsRef.current = textureRevisions
  cameraYawRef.current = cameraYaw
  cameraPitchRef.current = cameraPitch
  materialTintRef.current = materialTint
  surfaceDataRef.current = surfaceData
  activeRef.current = active
  suspendedRef.current = suspended
  onPreparationReadyRef.current = onPreparationReady

  useEffect(() => {
    if ((!active && !preparationRevision) || runtimeReady) return
    const frame = requestAnimationFrame(() => setRuntimeReady(true))
    return () => cancelAnimationFrame(frame)
  }, [active, preparationRevision, runtimeReady])

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
      ) {
        return
      }
      canvas.dataset.renderState = 'active'
      frameLoop.invalidate()
    }
    invalidateRef.current = invalidate

    const renderer = createIceReflectionRenderer(
      canvas,
      reflectionSourcesRef.current,
      {
        onInvalidate: invalidate,
        sourceCapacity: DISCOVERY_REFLECTION_SOURCE_CAPACITY,
        sourceAlphaBottom: DISCOVERY_RESULT_ALPHA_BOTTOM,
        materialTint: materialTintRef.current,
        blendOverlappingSources: true,
        textureCache: {
          assetVersion: DISCOVERY_REFLECTION_RUNTIME_VERSION,
          createTextureKey: (project, assetVersion) =>
            JSON.stringify([
              assetVersion,
              project.id,
              textureRevisionsRef.current.get(project.id) ?? project.cover,
            ]),
          drawCard: drawDiscoveryDomReflectionTexture,
          textureWidth: 1024,
          textureHeight: 764,
        },
      },
    )

    if (!renderer) {
      fallback = true
      canvas.dataset.renderState = 'fallback'
      return
    }
    rendererRef.current = renderer
    renderer.setSurfaceData(surfaceDataRef.current)

    frameLoop = new ReflectionFrameLoop({
      sampleAndRender: (timestamp) => {
        if (!activeRef.current || suspendedRef.current) {
          return { changed: false }
        }
        const snapshot = sampleDiscoveryReflections(stage)
        renderer.resize(snapshot.width, snapshot.height)
        const changed = renderer.sync(
          snapshot.samples,
          cameraYawRef.current,
          cameraPitchRef.current,
        )
        renderer.render(timestamp / 1000)
        writeDiagnostics(
          canvas,
          renderer.diagnostics,
          snapshot.fallbackCount,
          'active',
        )
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
    window.addEventListener(DISCOVERY_REFLECTION_MOTION_EVENT, invalidate)
    stage.addEventListener('pointermove', invalidate)
    stage.addEventListener('transitionrun', invalidate, true)
    stage.addEventListener('transitionend', invalidate, true)
    stage.addEventListener('transitioncancel', invalidate, true)
    canvas.addEventListener('webglcontextlost', invalidate)
    canvas.addEventListener('webglcontextrestored', invalidate)

    void renderer
      .whenReady()
      .then(invalidate)
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
      resizeObserver.disconnect()
      window.removeEventListener(DISCOVERY_REFLECTION_MOTION_EVENT, invalidate)
      stage.removeEventListener('pointermove', invalidate)
      stage.removeEventListener('transitionrun', invalidate, true)
      stage.removeEventListener('transitionend', invalidate, true)
      stage.removeEventListener('transitioncancel', invalidate, true)
      canvas.removeEventListener('webglcontextlost', invalidate)
      canvas.removeEventListener('webglcontextrestored', invalidate)
      frameLoop?.dispose()
      if (frameLoopRef.current === frameLoop) frameLoopRef.current = null
      renderer.disposeDeferred()
      if (rendererRef.current === renderer) rendererRef.current = null
    }
  }, [runtimeReady])

  useEffect(() => {
    if (!active || suspended) {
      frameLoopRef.current?.pause()
      return
    }
    invalidateRef.current()
  }, [active, suspended])

  useEffect(() => {
    if (!active || suspended || preparationRevision) return
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.ensureProjects(reflectionSources)
    invalidateRef.current()
  }, [
    active,
    preparationRevision,
    reflectionSources,
    suspended,
    textureRevisions,
  ])

  useEffect(() => {
    if (!preparationRevision) {
      notifiedPreparationRevisionRef.current = ''
      return
    }
    if (!runtimeReady) return
    if (
      notifiedPreparationRevisionRef.current === preparationRevision
    ) {
      return
    }

    const revision = preparationRevision
    const renderer = rendererRef.current
    let cancelled = false
    const notifyReady = (outcome: 'ready' | 'fallback') => {
      if (
        cancelled ||
        notifiedPreparationRevisionRef.current === revision
      ) {
        return
      }
      notifiedPreparationRevisionRef.current = revision
      onPreparationReadyRef.current?.(revision, outcome)
    }

    if (!renderer) {
      queueMicrotask(() => notifyReady('fallback'))
      return () => {
        cancelled = true
      }
    }

    void renderer.prepareProjects(reflectionSources, 3).then(
      () => notifyReady('ready'),
      () => notifyReady('fallback'),
    )
    return () => {
      cancelled = true
    }
  }, [
    preparationRevision,
    reflectionSources,
    runtimeReady,
    textureRevisions,
  ])

  useEffect(() => {
    if (!active || suspended || preloadSources.length === 0) return
    const renderer = rendererRef.current
    if (!renderer) return

    const prepare = () => {
      void renderer.prepareProjects(preloadSources, 3).catch(() => undefined)
    }
    if (typeof window.requestIdleCallback === 'function') {
      const idleHandle = window.requestIdleCallback(prepare, {
        timeout: 500,
      })
      return () => window.cancelIdleCallback(idleHandle)
    }

    const timer = window.setTimeout(prepare, 120)
    return () => window.clearTimeout(timer)
  }, [active, preloadSources, suspended, textureRevisions])

  useEffect(() => {
    void motionSignal
    invalidateRef.current()
  }, [motionSignal])

  useEffect(() => {
    void cameraYaw
    void cameraPitch
    invalidateRef.current()
  }, [cameraYaw, cameraPitch])

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
      className="discoveryReflectionCanvas"
      data-reflection-active={active}
      data-results-visible={visible}
      data-aurora-renderer="discovery-reflection"
      data-dpr-cap={String(DOM_REFLECTION_MAX_DPR)}
      data-render-state="initializing"
      data-renderer-count="0"
      data-render-count="0"
      data-reflection-targets="0"
      data-reflection-size={JSON.stringify({ width: 0, height: 0 })}
      data-source-capacity={String(DISCOVERY_REFLECTION_SOURCE_CAPACITY)}
      data-source-count="0"
      data-visible-source-count="0"
      data-source-signature=""
      data-projection-signature=""
      data-texture-count="0"
      data-reflection-ready="false"
      data-context-lost="false"
      data-reflection-surface-key="initializing"
      data-projection-fallback-count="0"
      aria-hidden="true"
    />
  )
}
