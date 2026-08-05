import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  ACESFilmicToneMapping,
  Color,
  GridHelper,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import type { Object3D } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  RotateCcw,
  SunMedium,
  Upload,
  X,
} from 'lucide-react'
import type {
  ModelAsset,
  ModelCameraState,
  ModelEnvironmentPresetId,
  PreparedModelAsset,
} from '../../data/modelLibraryTypes'
import { isModelEnvironmentPresetId } from '../../data/modelLibraryTypes'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'
import {
  getFrameRingCssVariables,
  type ResolvedFrameRingLayout,
} from '../frame-ring/frameRingLayout'
import {
  collectModelAssetMetadata,
  createModelLoader,
  disposeModelRoot,
  frameCameraForObject,
  installModelStudioEnvironment,
} from './modelAssetRuntime'
import { styleAuroraViewHelper } from './auroraViewHelperStyle'
import './ModelViewerPage.css'

type ExportPreset = {
  id: string
  label: string
  width: number
  height: number
}

const EXPORT_PRESETS: ExportPreset[] = [
  { id: '1080p', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: '4k', label: '3840 × 2160', width: 3840, height: 2160 },
  { id: 'square', label: '2048 × 2048', width: 2048, height: 2048 },
]

type ModelEnvironmentPreset = {
  id: ModelEnvironmentPresetId
  label: string
  asset: string
  intensity: number
}

const MODEL_ENVIRONMENT_PRESETS: ModelEnvironmentPreset[] = [
  {
    id: 'studio-neutral',
    label: '影棚',
    asset: './aurora/hdr-environments/studio-neutral-1k.hdr',
    intensity: 1.05,
  },
  {
    id: 'studio-soft',
    label: '室内柔光',
    asset: './aurora/hdr-environments/studio-soft-1k.hdr',
    intensity: 1,
  },
  {
    id: 'outdoor-dawn',
    label: '清晨户外',
    asset: './aurora/hdr-environments/outdoor-dawn-1k.hdr',
    intensity: 1.12,
  },
  {
    id: 'city-night',
    label: '城市夜景',
    asset: './aurora/hdr-environments/city-night-1k.hdr',
    intensity: 1.18,
  },
]

type ModelViewerPageProps = {
  active: boolean
  projectTitle: string
  layout: ResolvedFrameRingLayout
  asset: ModelAsset | null
  assetUrl: string | null
  onBack: () => void
  onMetadata: (assetId: string, metadata: PreparedModelAsset) => void
  onCameraChange: (assetId: string, camera: ModelCameraState) => void
  onEnvironmentPresetChange: (
    assetId: string,
    presetId: ModelEnvironmentPresetId,
  ) => void
}

function safeExportName(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-')
  return `${stem || 'Aurora-3D'}-render.png`
}

function normalizeExportName(value: string) {
  const sanitized = value.trim().replace(/[\\/:*?"<>|]/g, '-') || 'Aurora-3D-render'
  return sanitized.toLowerCase().endsWith('.png') ? sanitized : `${sanitized}.png`
}

export function ModelViewerPage({
  active,
  projectTitle,
  layout,
  asset,
  assetUrl,
  onBack,
  onMetadata,
  onCameraChange,
  onEnvironmentPresetChange,
}: ModelViewerPageProps) {
  const rootRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const viewHelperRef = useRef<ViewHelper | null>(null)
  const viewHelperHitRef = useRef<HTMLDivElement | null>(null)
  const modelRootRef = useRef<Object3D | null>(null)
  const frameModelRef = useRef<(() => void) | null>(null)
  const startRenderLoopRef = useRef<(() => void) | null>(null)
  const stopRenderLoopRef = useRef<(() => void) | null>(null)
  const applyEnvironmentRef = useRef<((presetId: string) => void) | null>(null)
  const environmentPresetRef = useRef(MODEL_ENVIRONMENT_PRESETS[0].id)
  const activeRef = useRef(active)
  const requestedRuntimeRef = useRef<{
    asset: ModelAsset
    url: string
  } | null>(null)
  const onMetadataRef = useRef(onMetadata)
  const onCameraChangeRef = useRef(onCameraChange)
  const onEnvironmentPresetChangeRef = useRef(onEnvironmentPresetChange)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadMessage, setLoadMessage] = useState('')
  const [exportPresetId, setExportPresetId] = useState('4k')
  const [transparent, setTransparent] = useState(true)
  const [exportName, setExportName] = useState('Aurora-3D-render.png')
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle')
  const [exportMessage, setExportMessage] = useState('')
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportDirectory, setExportDirectory] = useState(`${projectTitle}/Exports/Renders`)
  const [exportDirectoryPicked, setExportDirectoryPicked] = useState(false)
  const [exportDirectoryPicking, setExportDirectoryPicking] = useState(false)
  const [exportDirectoryStatus, setExportDirectoryStatus] = useState('')
  const [environmentPresetId, setEnvironmentPresetId] = useState<ModelEnvironmentPresetId>(
    isModelEnvironmentPresetId(asset?.environmentPresetId)
      ? asset.environmentPresetId
      : MODEL_ENVIRONMENT_PRESETS[0].id,
  )
  const [environmentLoading, setEnvironmentLoading] = useState(false)
  const [environmentError, setEnvironmentError] = useState(false)
  const [screenSpaceHost, setScreenSpaceHost] = useState<HTMLElement | null>(null)
  const [requestedAssetKey, setRequestedAssetKey] = useState<string | null>(null)

  const exportPreset = useMemo(
    () => EXPORT_PRESETS.find((preset) => preset.id === exportPresetId) ?? EXPORT_PRESETS[1],
    [exportPresetId],
  )
  activeRef.current = active
  onMetadataRef.current = onMetadata
  onCameraChangeRef.current = onCameraChange
  onEnvironmentPresetChangeRef.current = onEnvironmentPresetChange
  environmentPresetRef.current = environmentPresetId

  const assetId = asset?.id
  const assetFilename = asset?.filename
  useEffect(() => {
    const nextPresetId = isModelEnvironmentPresetId(asset?.environmentPresetId)
      ? asset.environmentPresetId
      : MODEL_ENVIRONMENT_PRESETS[0].id
    environmentPresetRef.current = nextPresetId
    setEnvironmentPresetId(nextPresetId)
    applyEnvironmentRef.current?.(nextPresetId)
  }, [asset?.environmentPresetId, assetId])
  useEffect(() => {
    if (assetFilename) setExportName(safeExportName(assetFilename))
  }, [assetFilename, assetId])

  useEffect(() => {
    setExportDirectory(`${projectTitle}/Exports/Renders`)
    setExportDirectoryPicked(false)
    setExportDirectoryStatus('')
  }, [projectTitle])

  useEffect(() => {
    setScreenSpaceHost(document.querySelector<HTMLElement>('.auroraApp'))
  }, [])

  /*
   * The actual 3D runtime is deliberately on-demand: selecting a model in the
   * library does not create a renderer or fetch its GLB/HDR. The first visible
   * viewer activation requests it; after that, leaving the page only pauses
   * RAF and the already-loaded runtime remains warm in-process.
   */
  useEffect(() => {
    if (!active) return
    if (!asset || !assetUrl) {
      requestedRuntimeRef.current = null
      setRequestedAssetKey(null)
      return
    }
    requestedRuntimeRef.current = { asset, url: assetUrl }
    setRequestedAssetKey(`${asset.id}\u0000${assetUrl}`)
  }, [active, asset, assetUrl])

  useEffect(() => {
    const requestedRuntime = requestedRuntimeRef.current
    if (!requestedRuntime || !requestedAssetKey) return
    const runtimeAsset = requestedRuntime.asset
    const runtimeAssetUrl = requestedRuntime.url
    const mount = viewportRef.current
    if (!mount) return
    let cancelled = false
    let animationFrame = 0
    let resizeObserver: ResizeObserver | null = null
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.className = 'modelViewerCanvas'
    renderer.domElement.setAttribute('aria-label', `${runtimeAsset.filename} 三维模型`)
    mount.replaceChildren(renderer.domElement)
    rendererRef.current = renderer

    const scene = new Scene()
    sceneRef.current = scene
    const camera = new PerspectiveCamera(36, 1, 0.01, 1000)
    cameraRef.current = camera
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.screenSpacePanning = true
    controls.minDistance = 0.02
    controls.maxDistance = 100000
    controlsRef.current = controls
    const viewHelper = new ViewHelper(camera, renderer.domElement)
    viewHelper.setLabels('X', 'Y', 'Z')
    styleAuroraViewHelper(viewHelper)
    viewHelperRef.current = viewHelper
    const disposeStudioEnvironment = installModelStudioEnvironment(renderer, scene)
    const environmentTargets = new Map<string, WebGLRenderTarget>()
    const environmentLoader = new RGBELoader()
    const environmentGenerator = new PMREMGenerator(renderer)
    environmentGenerator.compileEquirectangularShader()
    let environmentRequest = 0

    const applyEnvironment = async (presetId: string) => {
      const preset = MODEL_ENVIRONMENT_PRESETS.find((candidate) => candidate.id === presetId)
        ?? MODEL_ENVIRONMENT_PRESETS[0]
      const request = ++environmentRequest
      setEnvironmentLoading(true)
      setEnvironmentError(false)
      try {
        let target = environmentTargets.get(preset.id)
        if (!target) {
          const texture = await environmentLoader.loadAsync(
            resolveDocumentAssetUrl(preset.asset),
          )
          if (cancelled) {
            texture.dispose()
            return
          }
          target = environmentGenerator.fromEquirectangular(texture)
          texture.dispose()
          environmentTargets.set(preset.id, target)
        }
        if (cancelled || request !== environmentRequest) return
        scene.environment = target.texture
        scene.environmentIntensity = preset.intensity
        setEnvironmentLoading(false)
      } catch (error) {
        if (cancelled || request !== environmentRequest) return
        console.warn('[Aurora model] HDR environment load failed', error)
        setEnvironmentLoading(false)
        setEnvironmentError(true)
      }
    }
    applyEnvironmentRef.current = (presetId) => {
      void applyEnvironment(presetId)
    }
    void applyEnvironment(environmentPresetRef.current)

    const grid = new GridHelper(20, 20, 0x26364d, 0x182334)
    grid.material.transparent = true
    grid.material.opacity = 0.035
    scene.add(grid)

    const resize = () => {
      const width = Math.max(1, mount.clientWidth)
      const height = Math.max(1, mount.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      const hitZone = viewHelperHitRef.current
      if (hitZone) {
        const mountRect = mount.getBoundingClientRect()
        const hitRect = hitZone.getBoundingClientRect()
        viewHelper.location.left = hitRect.left - mountRect.left
        viewHelper.location.top = hitRect.top - mountRect.top
      }
    }
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(mount)
    resize()

    const saveCamera = () => {
      onCameraChangeRef.current(runtimeAsset.id, {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      })
    }
    controls.addEventListener('end', saveCamera)

    let previousFrameTime = performance.now()
    let viewHelperWasAnimating = false
    const render = (frameTime = performance.now()) => {
      animationFrame = 0
      if (cancelled) return
      const delta = Math.min(0.05, Math.max(0, (frameTime - previousFrameTime) / 1000))
      previousFrameTime = frameTime
      if (viewHelper.animating) {
        viewHelperWasAnimating = true
        viewHelper.update(delta)
      } else {
        if (viewHelperWasAnimating) {
          viewHelperWasAnimating = false
          controls.enabled = true
          controls.target.copy(viewHelper.center)
          saveCamera()
        }
        controls.update()
      }
      renderer.render(scene, camera)
      // ViewHelper performs a second renderer.render() call. With Three's default
      // autoClear=true that overlay pass clears the color buffer we just rendered,
      // leaving only the XYZ helper visible. Preserve the main model pass and let
      // ViewHelper clear depth only, as its implementation expects for an overlay.
      const previousAutoClear = renderer.autoClear
      renderer.autoClear = false
      try {
        viewHelper.render(renderer)
      } finally {
        renderer.autoClear = previousAutoClear
      }
      animationFrame = window.requestAnimationFrame(render)
    }
    const startRenderLoop = () => {
      if (cancelled || animationFrame !== 0) return
      previousFrameTime = performance.now()
      animationFrame = window.requestAnimationFrame(render)
    }
    const stopRenderLoop = () => {
      if (animationFrame === 0) return
      window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
    }
    startRenderLoopRef.current = startRenderLoop
    stopRenderLoopRef.current = stopRenderLoop
    if (activeRef.current) startRenderLoop()

    setLoadState('loading')
    setLoadMessage('正在解析模型、材质与贴图…')
    const { loader, dracoLoader } = createModelLoader()
    void loader.loadAsync(runtimeAssetUrl).then((gltf) => {
      if (cancelled) {
        disposeModelRoot(gltf.scene)
        return
      }
      const modelRoot = gltf.scene
      modelRootRef.current = modelRoot
      scene.add(modelRoot)
      const metadata = collectModelAssetMetadata(modelRoot)
      onMetadataRef.current(runtimeAsset.id, {
        ...metadata,
        thumbnail: runtimeAsset.thumbnail,
      })
      const frameModel = () => {
        const framing = frameCameraForObject(modelRoot, camera, controls.target)
        const floorY = framing.bounds.min.y - framing.radius * 0.018
        grid.position.y = floorY + framing.radius * 0.002
        const gridScale = Math.max(framing.radius / 2.5, 0.1)
        grid.scale.setScalar(gridScale)
        controls.minDistance = Math.max(framing.radius * 0.05, 0.002)
        controls.maxDistance = framing.radius * 24
        viewHelper.center.copy(controls.target)
        controls.update()
      }
      frameModelRef.current = frameModel
      if (runtimeAsset.camera) {
        camera.position.fromArray(runtimeAsset.camera.position)
        controls.target.fromArray(runtimeAsset.camera.target)
        viewHelper.center.copy(controls.target)
        controls.update()
      } else {
        frameModel()
      }
      setLoadState('ready')
      setLoadMessage('左键旋转 · 滚轮缩放 · 右键平移')
    }).catch((error) => {
      if (cancelled) return
      console.warn('[Aurora model] Viewer load failed', error)
      setLoadState('error')
      setLoadMessage(error instanceof Error ? error.message : '模型加载失败。')
    }).finally(() => dracoLoader.dispose())

    return () => {
      cancelled = true
      stopRenderLoop()
      resizeObserver?.disconnect()
      controls.removeEventListener('end', saveCamera)
      controls.dispose()
      viewHelper.dispose()
      if (modelRootRef.current) {
        scene.remove(modelRootRef.current)
        disposeModelRoot(modelRootRef.current)
        modelRootRef.current = null
      }
      disposeStudioEnvironment()
      environmentTargets.forEach((target) => target.dispose())
      environmentTargets.clear()
      environmentGenerator.dispose()
      grid.geometry.dispose()
      grid.material.dispose()
      renderer.dispose()
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      viewHelperRef.current = null
      frameModelRef.current = null
      startRenderLoopRef.current = null
      stopRenderLoopRef.current = null
      applyEnvironmentRef.current = null
      mount.replaceChildren()
    }
  }, [requestedAssetKey])

  useEffect(() => {
    if (active) {
      startRenderLoopRef.current?.()
      return
    }
    stopRenderLoopRef.current?.()
    setExportDialogOpen(false)
  }, [active])

  const environmentPreset = useMemo(
    () => MODEL_ENVIRONMENT_PRESETS.find((preset) => preset.id === environmentPresetId)
      ?? MODEL_ENVIRONMENT_PRESETS[0],
    [environmentPresetId],
  )

  function cycleEnvironment() {
    const currentIndex = MODEL_ENVIRONMENT_PRESETS.findIndex(
      (preset) => preset.id === environmentPresetId,
    )
    const nextPreset = MODEL_ENVIRONMENT_PRESETS[
      (Math.max(0, currentIndex) + 1) % MODEL_ENVIRONMENT_PRESETS.length
    ]
    environmentPresetRef.current = nextPreset.id
    setEnvironmentPresetId(nextPreset.id)
    applyEnvironmentRef.current?.(nextPreset.id)
    if (assetId) {
      onEnvironmentPresetChangeRef.current(assetId, nextPreset.id)
    }
  }

  function persistCurrentCamera() {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!assetId || !camera || !controls) return
    onCameraChangeRef.current(assetId, {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
    })
  }

  function handleViewHelperPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    const viewHelper = viewHelperRef.current
    const controls = controlsRef.current
    if (!viewHelper || !controls || loadState !== 'ready') return
    viewHelper.center.copy(controls.target)
    if (viewHelper.handleClick(event.nativeEvent)) controls.enabled = false
  }

  const exportCurrentView = useCallback(async () => {
    if (!asset || !rendererRef.current || !sceneRef.current || !cameraRef.current) return
    const bridge = window.desktopBridge
    let destinationDirectory = exportDirectory
    if (bridge?.saveModelRender && !exportDirectoryPicked) {
      setExportDirectoryPicking(true)
      setExportDirectoryStatus('请选择本次导出的保存文件夹。')
      const selectedDirectory = await bridge.selectDirectory({
        title: '选择三维单帧保存位置',
        buttonLabel: '导出到此文件夹',
      })
      setExportDirectoryPicking(false)
      if (!selectedDirectory) {
        setExportDirectoryStatus('已取消选择保存位置。')
        return
      }
      destinationDirectory = selectedDirectory
      setExportDirectory(selectedDirectory)
      setExportDirectoryPicked(true)
      setExportDirectoryStatus(`已选择文件夹“${selectedDirectory.split(/[\\/]/).pop() || selectedDirectory}”`)
    }
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    setExportState('exporting')
    setExportMessage(`正在渲染 ${exportPreset.label}…`)
    const renderTarget = new WebGLRenderTarget(
      exportPreset.width,
      exportPreset.height,
      { depthBuffer: true, stencilBuffer: false, type: UnsignedByteType },
    )
    renderTarget.texture.colorSpace = SRGBColorSpace
    const previousTarget = renderer.getRenderTarget()
    const previousAspect = camera.aspect
    const previousBackground = scene.background
    const previousAlpha = renderer.getClearAlpha()
    const grid = scene.children.find((child) => child instanceof GridHelper)
    const previousGridVisibility = grid?.visible
    try {
      camera.aspect = exportPreset.width / exportPreset.height
      camera.updateProjectionMatrix()
      scene.background = transparent ? null : new Color('#07101c')
      if (transparent) {
        if (grid) grid.visible = false
      }
      renderer.setClearAlpha(transparent ? 0 : 1)
      renderer.setRenderTarget(renderTarget)
      renderer.render(scene, camera)
      const pixels = new Uint8Array(exportPreset.width * exportPreset.height * 4)
      await renderer.readRenderTargetPixelsAsync(
        renderTarget,
        0,
        0,
        exportPreset.width,
        exportPreset.height,
        pixels,
      )
      const canvas = document.createElement('canvas')
      canvas.width = exportPreset.width
      canvas.height = exportPreset.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建图片导出画布。')
      const flipped = new Uint8ClampedArray(pixels.length)
      const rowSize = exportPreset.width * 4
      for (let y = 0; y < exportPreset.height; y += 1) {
        const sourceStart = (exportPreset.height - 1 - y) * rowSize
        flipped.set(pixels.subarray(sourceStart, sourceStart + rowSize), y * rowSize)
      }
      context.putImageData(
        new ImageData(flipped, exportPreset.width, exportPreset.height),
        0,
        0,
      )
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error('PNG 编码失败。')),
          'image/png',
        )
      })
      const filename = normalizeExportName(exportName)
      setExportName(filename)
      if (bridge?.saveModelRender) {
        const separator = destinationDirectory.includes('\\') ? '\\' : '/'
        const destinationPath = `${destinationDirectory.replace(/[\\/]+$/, '')}${separator}${filename}`
        await bridge.saveModelRender({
          destinationPath,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        })
        setExportMessage(`已导出到 ${destinationPath}`)
      } else {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportMessage(`已导出 ${filename}`)
      }
      setExportState('done')
    } catch (error) {
      console.warn('[Aurora model] Still export failed', error)
      setExportState('error')
      setExportMessage(error instanceof Error ? error.message : '导出失败。')
    } finally {
      renderer.setRenderTarget(previousTarget)
      renderer.setClearAlpha(previousAlpha)
      scene.background = previousBackground
      if (grid && previousGridVisibility !== undefined) {
        grid.visible = previousGridVisibility
      }
      camera.aspect = previousAspect
      camera.updateProjectionMatrix()
      renderTarget.dispose()
    }
  }, [asset, exportDirectory, exportDirectoryPicked, exportName, exportPreset, transparent])

  async function chooseExportDirectory() {
    if (exportDirectoryPicking) return
    const bridge = window.desktopBridge
    if (!bridge?.selectDirectory) {
      setExportDirectoryStatus('浏览器预览将使用系统下载目录；App 中可选择 Mac 文件夹。')
      return
    }
    setExportDirectoryPicking(true)
    setExportDirectoryStatus('正在打开文件夹选择器…')
    try {
      const selectedDirectory = await bridge.selectDirectory({
        title: '选择三维单帧保存位置',
        buttonLabel: '选择此文件夹',
      })
      if (!selectedDirectory) {
        setExportDirectoryStatus('未更改保存位置。')
        return
      }
      setExportDirectory(selectedDirectory)
      setExportDirectoryPicked(true)
      setExportDirectoryStatus(`已选择文件夹“${selectedDirectory.split(/[\\/]/).pop() || selectedDirectory}”`)
    } finally {
      setExportDirectoryPicking(false)
    }
  }

  function openExportDialog() {
    setExportState('idle')
    setExportMessage('')
    setExportDialogOpen(true)
  }

  return (
    <section
      ref={rootRef}
      className="modelViewerPage"
      data-page-active={active}
      aria-hidden={!active || undefined}
      inert={!active}
      aria-label={asset ? `${asset.filename} 三维查看` : '三维查看'}
      data-camera-gesture="block"
      style={getFrameRingCssVariables(layout) as CSSProperties}
    >
      <div className="frameRingBreadcrumb" aria-label="当前位置">
        <button type="button" onClick={onBack}>{projectTitle}</button>
        <ChevronRight size={13 * layout.uiScale} strokeWidth={1.5} />
        <strong>{asset?.filename ?? '三维模型'}</strong>
        <ChevronRight size={13 * layout.uiScale} strokeWidth={1.5} />
        <span>三维查看</span>
      </div>

      <div ref={viewportRef} className="modelViewerViewport" />
      {screenSpaceHost && active && createPortal(
        <button
          className="modelViewerEnvironmentControl uiGlassShell uiGlassInteractive"
          type="button"
          disabled={loadState !== 'ready'}
          aria-label={`当前环境 ${environmentPreset.label}，点击切换下一个 HDR 环境`}
          aria-busy={environmentLoading}
          title="点击切换 HDR 环境"
          data-page-active={active}
          data-camera-gesture="block"
          style={getFrameRingCssVariables(layout) as CSSProperties}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={cycleEnvironment}
        >
          <SunMedium size={15 * layout.uiScale} strokeWidth={1.45} />
          <span>环境</span>
          <strong>{environmentLoading ? '载入中' : environmentPreset.label}</strong>
          {environmentError && <i aria-label="HDR 环境载入失败" />}
        </button>,
        screenSpaceHost,
      )}
      <div
        ref={viewHelperHitRef}
        className="modelViewerViewHelperHitZone"
        role="group"
        aria-label="三维视角坐标轴；点击 X、Y 或 Z 切换对应视图"
        aria-disabled={loadState !== 'ready'}
        data-camera-gesture="block"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerUp={handleViewHelperPointerUp}
      />
      <div className={`modelViewerLoadState is-${loadState}`} aria-live="polite">
        {loadState === 'loading' && <i aria-hidden="true" />}
        <span>{loadMessage}</span>
      </div>

      {screenSpaceHost && active && createPortal(
        <div
          className="frameRingBottomActions modelViewerBottomActions uiGlassShell"
          role="toolbar"
          aria-label="三维查看操作栏"
          aria-hidden={exportDialogOpen || undefined}
          inert={exportDialogOpen}
          data-page-active={!exportDialogOpen}
          data-camera-gesture="block"
          style={getFrameRingCssVariables(layout) as CSSProperties}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={loadState !== 'ready'}
            onClick={() => {
              frameModelRef.current?.()
              const controls = controlsRef.current
              if (controls) viewHelperRef.current?.center.copy(controls.target)
              persistCurrentCamera()
            }}
          >
            <RotateCcw size={20 * layout.uiScale} strokeWidth={1.45} />
            <span>重置视角</span>
          </button>
          <button
            type="button"
            disabled={loadState !== 'ready' || exportState === 'exporting'}
            onClick={openExportDialog}
          >
            <Upload size={20 * layout.uiScale} strokeWidth={1.45} />
            <span>导出</span>
          </button>
        </div>,
        screenSpaceHost,
      )}

      {screenSpaceHost && active && exportDialogOpen && createPortal(
        <div
          className="overlay frameRingStillExportOverlay modelViewerExportOverlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="model-viewer-export-title"
          data-camera-gesture="block"
          style={getFrameRingCssVariables(layout) as CSSProperties}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.target === event.currentTarget && exportState !== 'exporting') {
              setExportDialogOpen(false)
            }
          }}
        >
          <form
            className="createPanel frameRingStillExportPanel modelViewerExportDialog uiGlassShell"
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || exportState === 'exporting') return
              event.preventDefault()
              setExportDialogOpen(false)
            }}
            onSubmit={(event) => {
              event.preventDefault()
              void exportCurrentView()
            }}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭三维单帧导出"
              disabled={exportState === 'exporting'}
              onClick={() => setExportDialogOpen(false)}
            >
              <X size={17} />
            </button>

            <header className="createPanelHeader frameRingStillExportHeader">
              <span className="sheetEyebrow">Export Still</span>
              <h2 id="model-viewer-export-title">导出当前视角</h2>
              <p>{exportPreset.label} · PNG · {transparent ? '透明背景' : '场景背景'}</p>
            </header>

            <div className="projectNameField frameRingStillExportField">
              <span>保存位置</span>
              <button
                className="createProjectInput frameRingStillExportLocationButton uiGlassInset uiGlassInteractive"
                type="button"
                data-directory-source={exportDirectoryPicked ? 'picker' : 'project-default'}
                aria-busy={exportDirectoryPicking}
                aria-label={`选择三维单帧保存文件夹，当前为 ${exportDirectory}`}
                onClick={() => void chooseExportDirectory()}
              >
                <FolderOpen size={15} strokeWidth={1.5} aria-hidden="true" />
                <span className="frameRingStillExportLocationPath">{exportDirectory}</span>
                <span className="frameRingStillExportLocationAction">
                  {exportDirectoryPicking ? '选择中…' : '选择…'}
                </span>
              </button>
              <small className="frameRingStillExportLocationStatus" aria-live="polite">
                {exportDirectoryStatus || (exportDirectoryPicked
                  ? `已选择文件夹“${exportDirectory.split(/[\\/]/).pop() || exportDirectory}”`
                  : '点击上方路径选择 Mac 文件夹')}
              </small>
            </div>

            <label className="projectNameField frameRingStillExportField">
              <span>文件名</span>
              <span className="createProjectInput frameRingStillExportInput uiGlassInset">
                <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
                <input
                  autoFocus
                  value={exportName}
                  maxLength={180}
                  required
                  spellCheck={false}
                  aria-label="三维单帧文件名"
                  onChange={(event) => setExportName(event.currentTarget.value)}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </span>
            </label>

            <div className="modelViewerExportOptions">
              <label className="projectNameField">
                <span>分辨率</span>
                <span className="createProjectInput modelViewerDialogSelect uiGlassInset">
                  <select value={exportPresetId} onChange={(event) => setExportPresetId(event.currentTarget.value)} aria-label="导出分辨率">
                    {EXPORT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                  </select>
                  <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
                </span>
              </label>
              <label className="modelViewerDialogToggle uiGlassInset">
                <input type="checkbox" checked={transparent} onChange={(event) => setTransparent(event.currentTarget.checked)} />
                <span>透明背景 PNG</span>
              </label>
            </div>

            <div className="createPanelMeta frameRingStillExportMeta">
              <span><FileText size={14} strokeWidth={1.45} />PNG 无损单帧</span>
              <span>{exportPreset.label} · 当前三维视角</span>
            </div>

            {exportMessage && (
              <p className={`modelViewerDialogStatus is-${exportState}`} aria-live="polite">{exportMessage}</p>
            )}

            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                disabled={exportState === 'exporting'}
                onClick={() => setExportDialogOpen(false)}
              >
                取消
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="submit"
                disabled={loadState !== 'ready' || exportState === 'exporting' || exportDirectoryPicking}
                aria-busy={exportState === 'exporting'}
              >
                <Upload size={15} strokeWidth={1.65} />
                {exportState === 'exporting' ? '正在导出…' : '导出单帧'}
              </button>
            </footer>
          </form>
        </div>,
        screenSpaceHost,
      )}
    </section>
  )
}
