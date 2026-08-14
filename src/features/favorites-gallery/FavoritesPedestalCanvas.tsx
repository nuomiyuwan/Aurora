import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'
import type { BackgroundReflectionSurface } from '../reflection/backgroundReflectionSurfaceProtocol'
import {
  createCssPerspectiveMatrix,
  createFloorReflectionMatrix,
  projectCssPoint,
} from '../project-gallery/reflection/domCardProjection'
import {
  getDomReflectionTargetSize,
  ICE_REFLECTION_ASSET_VERSION,
  ICE_REFLECTION_SURFACE_ASSET,
} from '../project-gallery/reflection/IceReflectionRenderer'
import {
  iceCompositeFragmentShader,
  iceCompositeVertexShader,
} from '../project-gallery/reflection/reflectionShaders'
import {
  createFavoritesCardDepthOccluder,
  createFavoritesCardReflectionOcclusionMask,
  loadFavoritesCardDepthMaskTexture,
} from './favoritesCardDepthOccluder'
import {
  FAVORITES_CARD_VERTICAL_OFFSET_PX,
  getFavoritesPedestalLayout,
} from './favoritesPedestalLayout'
import {
  centerFavoritesPedestalModel,
  FAVORITES_PEDESTAL_AXIS_THICKNESS,
  FAVORITES_PEDESTAL_MODEL_SIZE,
  measureFavoritesPedestalModel,
  type FavoritesPedestalModelMetrics,
} from './favoritesPedestalGeometry'
import { createFavoritesPedestalEnvironmentTarget } from './favoritesPedestalEnvironment'
import {
  addFavoritesPedestalEdgeLight,
  applyFavoritesPedestalEdgeLightTint,
  loadFavoritesPedestalEdgeLightTexture,
} from './favoritesPedestalEdgeLight'
import {
  applyFavoritesPedestalMaterialTint,
  cloneFavoritesPedestalMaterial,
  createFavoritesPedestalLights,
  createFavoritesPedestalMatteMetalMaterial,
  getFavoritesPedestalLook,
  type FavoritesPedestalLookId,
} from './favoritesPedestalMaterial'
import { sampleFavoritesGallerySpatialState } from './favoritesReflectionProjection'
import { FAVORITES_REFLECTION_OPACITY_SCALE } from './favoritesReflectionAppearance'

interface FavoritesPedestalCanvasProps {
  active: boolean
  suspended: boolean
  lookId: FavoritesPedestalLookId
  stageRef: React.RefObject<HTMLElement | null>
  cardIds: readonly string[]
  motionSignal: string
  layoutSignal: string
  cameraYaw: number
  cameraPitch: number
  materialTint: string
  pedestalTint: string
  surfaceData?: BackgroundReflectionSurface | null
}

const PEDESTAL_ASSET = './aurora/glass-product-base.glb'
const PEDESTAL_MAX_DPR = 1.5
const PEDESTAL_SETTLE_DURATION_MS = 720
/** Only reduces reflected RGB energy; opacity and ice distortion stay intact. */
const PEDESTAL_REFLECTION_COLOR_ENERGY = 0.76

/*
 * The pedestal mirror is rendered as real mirrored GLB geometry, then passed
 * through the same public ice composite shader and surface data as every DOM
 * reflection page. This keeps its side faces and depth instead of mirroring a
 * flattened screenshot of the entire WebGL canvas.
 */
const pedestalIceFragmentShader = iceCompositeFragmentShader
  .replace(
    'uniform float cameraPitch;',
    'uniform float cameraPitch;\nuniform sampler2D cardOcclusionMap;\nuniform float reflectionFloorUv;\nuniform float reflectionStrength;\nuniform float reflectionColorEnergy;',
  )
  .replace(
    'float surfaceReflectivity = mix(0.50, 0.70, contact);',
    `float reflectionDistance = max(0.0, reflectionFloorUv - vUv.y);
  float pedestalDistanceFade = 1.0 - smoothstep(0.02, 0.29, reflectionDistance);
  alpha *= pedestalDistanceFade * reflectionStrength;
  float cardOcclusion = max(
    texture2D(cardOcclusionMap, vUv).r,
    texture2D(cardOcclusionMap, vUv).a
  );
  alpha *= 1.0 - smoothstep(0.015, 0.16, cardOcclusion);
  float surfaceReflectivity = mix(0.50, 0.70, contact);`,
  )
  .replace(
    'gl_FragColor = vec4(neutralColor, alpha);',
    `neutralColor *= reflectionColorEnergy;
  gl_FragColor = vec4(neutralColor, alpha);`,
  )

type PedestalSlot = {
  id: string
  root: THREE.Group
  reflectionRoot: THREE.Group
  cardDepthOccluder: THREE.Mesh
  cardReflectionOcclusionMask: THREE.Mesh
  opacity: number
}

const disposeObject = (root: THREE.Object3D) => {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    geometries.add(object.geometry)
    const source = Array.isArray(object.material)
      ? object.material
      : [object.material]
    source.forEach((material) => materials.add(material))
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

const prepareBaseModel = (
  source: THREE.Object3D,
  lookId: FavoritesPedestalLookId,
  pedestalTint: string,
) => {
  const look = getFavoritesPedestalLook(lookId)
  const root = source.clone(true)
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry = object.geometry.clone()
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    const preparedMaterials = materials.map(() =>
      createFavoritesPedestalMatteMetalMaterial(look, pedestalTint),
    )
    object.material = preparedMaterials.length === 1
      ? preparedMaterials[0]
      : preparedMaterials
  })
  return root
}

const clonePreparedModel = (template: THREE.Object3D) => {
  const root = new THREE.Group()
  const model = template.clone(true)
  let hasMesh = false
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    hasMesh = true
    object.geometry = object.geometry.clone()
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneFavoritesPedestalMaterial)
      : cloneFavoritesPedestalMaterial(object.material)
    object.frustumCulled = false
  })
  root.add(model)
  root.matrixAutoUpdate = false
  return hasMesh ? root : null
}

const applyFavoritesPedestalSlotOpacity = (
  root: THREE.Object3D,
  opacity: number,
) => {
  const slotOpacity = THREE.MathUtils.clamp(opacity, 0, 1)
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]

    materials.forEach((material) => {
      if (
        material instanceof THREE.MeshPhysicalMaterial &&
        material.userData.auroraFavoritesPedestalBody
      ) {
        const baseOpacity = Number(
          material.userData.auroraPedestalBaseOpacity ?? material.opacity,
        )
        material.userData.auroraPedestalBaseOpacity = baseOpacity
        material.opacity = baseOpacity * slotOpacity
        return
      }

      if (
        material instanceof THREE.ShaderMaterial &&
        object.userData.auroraPedestalEdgeLight
      ) {
        const opacityUniform = material.uniforms.opacity as
          | { value: number }
          | undefined
        if (!opacityUniform) return
        const baseOpacity = Number(
          material.userData.auroraPedestalBaseOpacity ?? opacityUniform.value,
        )
        material.userData.auroraPedestalBaseOpacity = baseOpacity
        opacityUniform.value = baseOpacity * slotOpacity
        material.uniformsNeedUpdate = true
      }
    })
  })
}

const cloneBaseSlot = (
  template: THREE.Object3D,
  id: string,
  cardDepthMask: THREE.Texture,
): PedestalSlot | null => {
  const root = clonePreparedModel(template)
  const reflectionRoot = clonePreparedModel(template)
  if (!root || !reflectionRoot) {
    if (root) disposeObject(root)
    if (reflectionRoot) disposeObject(reflectionRoot)
    return null
  }
  root.name = `favorites-pedestal:${id}`
  reflectionRoot.name = `favorites-pedestal-reflection:${id}`
  return {
    id,
    root,
    reflectionRoot,
    cardDepthOccluder: createFavoritesCardDepthOccluder(cardDepthMask),
    cardReflectionOcclusionMask:
      createFavoritesCardReflectionOcclusionMask(cardDepthMask),
    opacity: -1,
  }
}

const createSurfaceDataTexture = (surface: BackgroundReflectionSurface) => {
  const texture = new THREE.DataTexture(
    surface.pixels,
    surface.width,
    surface.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = `background-reflection-surface:${surface.key}`
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

export function FavoritesPedestalCanvas({
  active,
  suspended,
  lookId,
  stageRef,
  cardIds,
  motionSignal,
  layoutSignal,
  cameraYaw,
  cameraPitch,
  materialTint,
  pedestalTint,
  surfaceData = null,
}: FavoritesPedestalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)
  const suspendedRef = useRef(suspended)
  const cameraYawRef = useRef(cameraYaw)
  const cameraPitchRef = useRef(cameraPitch)
  const materialTintRef = useRef(materialTint)
  const pedestalTintRef = useRef(pedestalTint)
  const surfaceDataRef = useRef(surfaceData)
  const updateSurfaceDataRef = useRef<
    (surface: BackgroundReflectionSurface | null) => void
  >(() => undefined)
  const updateMaterialTintRef = useRef<(tint: string) => void>(
    () => undefined,
  )
  const updatePedestalTintRef = useRef<(tint: string) => void>(
    () => undefined,
  )
  const [runtimeReady, setRuntimeReady] = useState(
    active && cardIds.length > 0,
  )
  const cardIdsSignal = cardIds.join('|')

  activeRef.current = active
  suspendedRef.current = suspended
  cameraYawRef.current = cameraYaw
  cameraPitchRef.current = cameraPitch
  materialTintRef.current = materialTint
  pedestalTintRef.current = pedestalTint
  surfaceDataRef.current = surfaceData

  useEffect(() => {
    if (runtimeReady || !active || cardIds.length === 0) return
    const frame = window.requestAnimationFrame(() => setRuntimeReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [active, cardIds.length, runtimeReady])

  useEffect(() => {
    if (!runtimeReady) return
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const look = getFavoritesPedestalLook(lookId)

    let disposed = false
    let animationFrame = 0
    let settleUntil = 0
    let resizeObserver: ResizeObserver | null = null
    let template: THREE.Object3D | null = null
    let edgeLightTexture: THREE.Texture | null = null
    let cardDepthMaskTexture: THREE.Texture | null = null
    let customSurfaceTexture: THREE.DataTexture | null = null
    let templateMetrics: FavoritesPedestalModelMetrics = {
      center: new THREE.Vector3(),
      size: new THREE.Vector3(
        FAVORITES_PEDESTAL_MODEL_SIZE.width,
        FAVORITES_PEDESTAL_MODEL_SIZE.height,
        FAVORITES_PEDESTAL_MODEL_SIZE.depth,
      ),
    }
    let loadState: 'loading' | 'ready' | 'error' = 'loading'
    let currentPixelRatio = 0
    let pixelRatioPollTimer = 0
    let reflectionTargetWidth = 1
    let reflectionTargetHeight = 1
    let renderFrame: FrameRequestCallback = () => undefined
    const slots = new Map<string, PedestalSlot>()

    const setMaterialTint = (nextTint: string) => {
      const normalizedTint = template
        ? applyFavoritesPedestalEdgeLightTint(template, nextTint)
        : nextTint.trim().toLowerCase()
      slots.forEach((slot) => {
        applyFavoritesPedestalEdgeLightTint(slot.root, nextTint)
        applyFavoritesPedestalEdgeLightTint(slot.reflectionRoot, nextTint)
      })
      canvas.dataset.edgeLightMaterialTint = normalizedTint
      invalidate()
    }
    updateMaterialTintRef.current = setMaterialTint

    const setPedestalTint = (nextTint: string) => {
      const normalizedTint = template
        ? applyFavoritesPedestalMaterialTint(template, nextTint)
        : nextTint.trim().toLowerCase()
      slots.forEach((slot) => {
        applyFavoritesPedestalMaterialTint(slot.root, nextTint)
        applyFavoritesPedestalMaterialTint(slot.reflectionRoot, nextTint)
      })
      canvas.dataset.pedestalMaterialTint = normalizedTint
      invalidate()
    }
    updatePedestalTintRef.current = setPedestalTint

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    })
    renderer.autoClear = false
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = look.rendererExposure
    renderer.setClearColor(0x000000, 0)
    renderer.sortObjects = true
    canvas.dataset.bloomEnabled = 'false'
    canvas.dataset.rendererCount = '1'
    canvas.dataset.reflectionRendererCount = '0'
    canvas.dataset.reflectionMode = 'shared-ice-true-3d'

    const scene = new THREE.Scene()
    const reflectionScene = new THREE.Scene()
    const cardOcclusionScene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10_000, 10_000)
    camera.position.set(0, 0, 2000)
    camera.lookAt(0, 0, 0)

    const reflectionTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    reflectionTarget.texture.name = 'favorites-pedestal-ice-source-target'
    const cardOcclusionTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    cardOcclusionTarget.texture.name =
      'favorites-pedestal-card-occlusion-target'
    cardOcclusionTarget.texture.colorSpace = THREE.NoColorSpace
    const defaultSurfaceTexture = new THREE.TextureLoader().load(
      resolveDocumentAssetUrl(ICE_REFLECTION_SURFACE_ASSET),
      () => {
        if (disposed) return
        canvas.dataset.reflectionSurfaceReady = 'true'
        invalidate()
      },
      undefined,
      () => {
        if (disposed) return
        canvas.dataset.reflectionSurfaceReady = 'fallback'
      },
    )
    defaultSurfaceTexture.name = 'favorites-pedestal-ice-surface'
    defaultSurfaceTexture.colorSpace = THREE.NoColorSpace
    defaultSurfaceTexture.wrapS = THREE.ClampToEdgeWrapping
    defaultSurfaceTexture.wrapT = THREE.ClampToEdgeWrapping
    defaultSurfaceTexture.minFilter = THREE.LinearFilter
    defaultSurfaceTexture.magFilter = THREE.LinearFilter
    defaultSurfaceTexture.generateMipmaps = false

    const texelSize = new THREE.Vector2(1, 1)
    const sourceMapUniform = { value: reflectionTarget.texture }
    const surfaceDataMapUniform: { value: THREE.Texture } = {
      value: defaultSurfaceTexture,
    }
    const reflectionFloorUvUniform = { value: 0 }
    const compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: iceCompositeVertexShader,
      fragmentShader: pedestalIceFragmentShader,
      uniforms: {
        sourceMap: sourceMapUniform,
        cardOcclusionMap: { value: cardOcclusionTarget.texture },
        surfaceDataMap: surfaceDataMapUniform,
        texelSize: { value: texelSize },
        cameraYaw: { value: cameraYawRef.current },
        cameraPitch: { value: cameraPitchRef.current },
        reflectionFloorUv: reflectionFloorUvUniform,
        reflectionStrength: {
          value: 0.92 * FAVORITES_REFLECTION_OPACITY_SCALE,
        },
        sourceCoverageLock: { value: 1 },
        reflectionColorEnergy: {
          value: PEDESTAL_REFLECTION_COLOR_ENERGY,
        },
      },
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    })
    const compositeGeometry = new THREE.PlaneGeometry(2, 2)
    const compositeMesh = new THREE.Mesh(compositeGeometry, compositeMaterial)
    compositeMesh.frustumCulled = false
    const compositeScene = new THREE.Scene()
    const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    compositeCamera.position.z = 1
    compositeScene.add(compositeMesh)

    const environmentScene = new RoomEnvironment()
    const environmentGenerator = new THREE.PMREMGenerator(renderer)
    environmentGenerator.compileEquirectangularShader()
    const fallbackEnvironmentTarget = environmentGenerator.fromScene(
      environmentScene,
      0.04,
    )
    environmentScene.dispose()
    let hdrEnvironmentTarget: THREE.WebGLRenderTarget | null = null
    scene.environment = fallbackEnvironmentTarget.texture
    reflectionScene.environment = fallbackEnvironmentTarget.texture
    const environmentRotation = look.environmentRotationDegrees
    scene.environmentRotation.set(
      THREE.MathUtils.degToRad(environmentRotation.x),
      THREE.MathUtils.degToRad(environmentRotation.y),
      THREE.MathUtils.degToRad(environmentRotation.z),
    )
    reflectionScene.environmentRotation.copy(scene.environmentRotation)
    scene.environmentIntensity = look.environmentIntensity
    reflectionScene.environmentIntensity = look.environmentIntensity
    scene.add(...createFavoritesPedestalLights(look))
    reflectionScene.add(...createFavoritesPedestalLights(look))

    const setSurfaceData = (
      nextSurface: BackgroundReflectionSurface | null,
    ) => {
      if (disposed) return
      const nextKey = nextSurface?.key ?? ICE_REFLECTION_ASSET_VERSION
      if (canvas.dataset.reflectionSurfaceKey === nextKey) return
      const previousTexture = customSurfaceTexture
      if (nextSurface) {
        customSurfaceTexture = createSurfaceDataTexture(nextSurface)
        surfaceDataMapUniform.value = customSurfaceTexture
        canvas.dataset.reflectionSurfaceKey = nextSurface.key
        canvas.dataset.reflectionSurfaceReady = 'true'
      } else {
        customSurfaceTexture = null
        surfaceDataMapUniform.value = defaultSurfaceTexture
        canvas.dataset.reflectionSurfaceKey = ICE_REFLECTION_ASSET_VERSION
      }
      previousTexture?.dispose()
      invalidate()
    }
    updateSurfaceDataRef.current = setSurfaceData
    canvas.dataset.reflectionSurfaceKey = 'initializing'
    setSurfaceData(surfaceDataRef.current)

    const updateCanvasSize = () => {
      const width = Math.max(1, stage.clientWidth)
      const height = Math.max(1, stage.clientHeight)
      const nextPixelRatio = Math.min(
        Math.max(1, window.devicePixelRatio || 1),
        PEDESTAL_MAX_DPR,
      )
      if (nextPixelRatio !== currentPixelRatio) {
        currentPixelRatio = nextPixelRatio
        renderer.setPixelRatio(nextPixelRatio)
      }
      renderer.setSize(width, height, false)
      const targetSize = getDomReflectionTargetSize(width, height)
      if (
        targetSize.width !== reflectionTargetWidth ||
        targetSize.height !== reflectionTargetHeight
      ) {
        reflectionTargetWidth = targetSize.width
        reflectionTargetHeight = targetSize.height
        reflectionTarget.setSize(targetSize.width, targetSize.height)
        cardOcclusionTarget.setSize(targetSize.width, targetSize.height)
        texelSize.set(1 / targetSize.width, 1 / targetSize.height)
      }
      camera.updateProjectionMatrix()
      canvas.dataset.dpr = String(nextPixelRatio)
      canvas.dataset.reflectionSize = `${targetSize.width}x${targetSize.height}`
    }
    updateCanvasSize()
    resizeObserver = new ResizeObserver(() => {
      updateCanvasSize()
      invalidate()
    })
    resizeObserver.observe(stage)
    pixelRatioPollTimer = window.setInterval(() => {
      const nextPixelRatio = Math.min(
        Math.max(1, window.devicePixelRatio || 1),
        PEDESTAL_MAX_DPR,
      )
      if (nextPixelRatio === currentPixelRatio) return
      updateCanvasSize()
      invalidate()
    }, 500)

    const render = (timestamp = performance.now()) => {
      animationFrame = 0
      if (disposed || !activeRef.current || suspendedRef.current) return
      const snapshot = sampleFavoritesGallerySpatialState(stage)
      if (
        !snapshot ||
        loadState !== 'ready' ||
        !template ||
        !cardDepthMaskTexture
      ) {
        renderer.setRenderTarget(null)
        renderer.clear(true, true, true)
        return
      }

      const visibleIds = new Set<string>()
      camera.left = -snapshot.width / 2
      camera.right = snapshot.width / 2
      camera.top = snapshot.height / 2
      camera.bottom = -snapshot.height / 2
      camera.updateProjectionMatrix()
      const perspectiveMatrix = createCssPerspectiveMatrix(
        snapshot.perspective,
        snapshot.perspectiveOrigin.x,
        snapshot.perspectiveOrigin.y,
      )
      const floorReflectionMatrix = createFloorReflectionMatrix(snapshot.floorY)
      const screenToThree = new THREE.Matrix4().set(
        1, 0, 0, -snapshot.width / 2,
        0, -1, 0, snapshot.height / 2,
        0, 0, 1, 0,
        0, 0, 0, 1,
      )

      snapshot.measurements.forEach((measurement) => {
        if (!measurement.cardMatrix) return
        visibleIds.add(measurement.carouselKey)
        let slot = slots.get(measurement.carouselKey)
        if (!slot) {
          const nextSlot = cloneBaseSlot(
            template!,
            measurement.carouselKey,
            cardDepthMaskTexture!,
          )
          if (!nextSlot) return
          slot = nextSlot
          slots.set(measurement.carouselKey, nextSlot)
          scene.add(nextSlot.root, nextSlot.cardDepthOccluder)
          reflectionScene.add(nextSlot.reflectionRoot)
          cardOcclusionScene.add(nextSlot.cardReflectionOcclusionMask)
        }

        const pedestal = getFavoritesPedestalLayout(
          measurement.width,
          measurement.height,
        )
        const pedestalRenderHeight =
          pedestal.height * FAVORITES_PEDESTAL_AXIS_THICKNESS.y
        const pedestalRenderCenterY =
          pedestal.bottomY - pedestalRenderHeight / 2
        const pedestalRenderDepth =
          Math.max(
            (pedestal.width / templateMetrics.size.x) * 0.14,
            pedestal.height * 0.72,
          ) * FAVORITES_PEDESTAL_AXIS_THICKNESS.z
        const pedestalLocalMatrix = new THREE.Matrix4()
          .makeTranslation(
            measurement.width / 2,
            pedestalRenderCenterY,
            0,
          )
          .multiply(
            new THREE.Matrix4().makeScale(
              pedestal.width / templateMetrics.size.x,
              pedestalRenderHeight / templateMetrics.size.y,
              pedestalRenderDepth,
            ),
          )
        const pedestalToScreen = perspectiveMatrix
          .clone()
          .multiply(snapshot.rigMatrix)
          .multiply(measurement.cardMatrix)
          .multiply(pedestalLocalMatrix)
        const reflectedPedestalToScreen = perspectiveMatrix
          .clone()
          .multiply(snapshot.rigMatrix)
          .multiply(floorReflectionMatrix)
          .multiply(measurement.cardMatrix)
          .multiply(pedestalLocalMatrix)

        slot.root.matrix.copy(screenToThree.clone().multiply(pedestalToScreen))
        slot.root.updateMatrixWorld(true)
        slot.reflectionRoot.matrix.copy(
          screenToThree.clone().multiply(reflectedPedestalToScreen),
        )
        slot.reflectionRoot.updateMatrixWorld(true)
        const slotOpacity = THREE.MathUtils.clamp(measurement.opacity, 0, 1)
        if (Math.abs(slot.opacity - slotOpacity) > 0.001) {
          slot.opacity = slotOpacity
          applyFavoritesPedestalSlotOpacity(slot.root, slotOpacity)
          applyFavoritesPedestalSlotOpacity(slot.reflectionRoot, slotOpacity)
        }
        const visible = slotOpacity > 0.001
        slot.root.visible = visible
        slot.reflectionRoot.visible = visible
        const renderOrder = Math.max(0, measurement.paintOrder - 1)
        slot.root.renderOrder = renderOrder
        slot.reflectionRoot.renderOrder = renderOrder
        slot.root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          object.frustumCulled = false
          object.renderOrder = renderOrder +
            (object.userData.auroraPedestalEdgeLight ? 1 : 0)
        })
        slot.reflectionRoot.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          object.frustumCulled = false
          object.renderOrder = renderOrder +
            (object.userData.auroraPedestalEdgeLight ? 1 : 0)
        })

        const cardDepthLocalMatrix = new THREE.Matrix4()
          .makeTranslation(
            measurement.width / 2,
            measurement.height / 2 - pedestal.cardLift +
              FAVORITES_CARD_VERTICAL_OFFSET_PX,
            0,
          )
          .multiply(
            new THREE.Matrix4().makeScale(
              measurement.width,
              measurement.height,
              1,
            ),
          )
        const cardDepthToScreen = perspectiveMatrix
          .clone()
          .multiply(snapshot.rigMatrix)
          .multiply(measurement.cardMatrix)
          .multiply(cardDepthLocalMatrix)
        slot.cardDepthOccluder.matrix.copy(
          screenToThree.clone().multiply(cardDepthToScreen),
        )
        slot.cardDepthOccluder.updateMatrixWorld(true)
        slot.cardDepthOccluder.visible = visible
        slot.cardReflectionOcclusionMask.matrix.copy(
          slot.cardDepthOccluder.matrix,
        )
        slot.cardReflectionOcclusionMask.updateMatrixWorld(true)
        slot.cardReflectionOcclusionMask.visible = visible
      })

      slots.forEach((slot, id) => {
        if (visibleIds.has(id)) return
        slot.root.visible = false
        slot.reflectionRoot.visible = false
        slot.cardDepthOccluder.visible = false
        slot.cardReflectionOcclusionMask.visible = false
      })

      const floorMeasurement = snapshot.measurements.reduce(
        (closest, measurement) =>
          !closest || Math.abs(measurement.relative) < Math.abs(closest.relative)
            ? measurement
            : closest,
        null as (typeof snapshot.measurements)[number] | null,
      )
      let floorScreenY = snapshot.floorY
      if (floorMeasurement?.cardMatrix) {
        const floorPedestal = getFavoritesPedestalLayout(
          floorMeasurement.width,
          floorMeasurement.height,
        )
        const floorCardToScreen = perspectiveMatrix
          .clone()
          .multiply(snapshot.rigMatrix)
          .multiply(floorMeasurement.cardMatrix)
        const floorLeft = projectCssPoint(
          floorCardToScreen,
          0,
          floorPedestal.bottomY,
        )
        const floorRight = projectCssPoint(
          floorCardToScreen,
          floorMeasurement.width,
          floorPedestal.bottomY,
        )
        floorScreenY = (floorLeft.y + floorRight.y) / 2
      }
      reflectionFloorUvUniform.value =
        1 - floorScreenY / Math.max(1, snapshot.height)
      compositeMaterial.uniforms.cameraYaw.value = cameraYawRef.current
      compositeMaterial.uniforms.cameraPitch.value = cameraPitchRef.current

      renderer.info.reset()
      renderer.setRenderTarget(reflectionTarget)
      renderer.clear(true, true, true)
      renderer.render(reflectionScene, camera)
      renderer.setRenderTarget(cardOcclusionTarget)
      renderer.clear(true, true, true)
      renderer.render(cardOcclusionScene, camera)
      renderer.setRenderTarget(null)
      renderer.clear(true, true, true)
      renderer.render(compositeScene, compositeCamera)
      renderer.clearDepth()
      renderer.render(scene, camera)

      canvas.dataset.pedestalSourceCount = String(visibleIds.size)
      canvas.dataset.pedestalRenderCalls = String(renderer.info.render.calls)
      canvas.dataset.pedestalTriangles = String(renderer.info.render.triangles)
      canvas.dataset.pedestalReady = 'true'
      canvas.dataset.reflectionReady = 'true'
      canvas.dataset.cardReflectionOcclusionReady = 'true'
      canvas.dataset.renderState = 'ready'
      if (timestamp < settleUntil) scheduleFrame()
    }

    function scheduleFrame() {
      if (
        disposed ||
        animationFrame !== 0 ||
        !activeRef.current ||
        suspendedRef.current
      ) return
      animationFrame = window.requestAnimationFrame((timestamp) =>
        renderFrame(timestamp),
      )
    }

    function invalidate() {
      settleUntil = Math.max(
        settleUntil,
        performance.now() + PEDESTAL_SETTLE_DURATION_MS,
      )
      scheduleFrame()
    }

    renderFrame = render

    const handleInvalidate = () => invalidate()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') invalidate()
    }
    canvas.addEventListener(
      'aurora-favorites-pedestal-invalidate',
      handleInvalidate,
    )
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const loader = new GLTFLoader()
    void loader
      .loadAsync(resolveDocumentAssetUrl(PEDESTAL_ASSET))
      .then(async (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene)
          return
        }
        const nextTemplate = prepareBaseModel(
          gltf.scene,
          lookId,
          pedestalTintRef.current,
        )
        const nextTemplateMetrics = measureFavoritesPedestalModel(nextTemplate)
        centerFavoritesPedestalModel(nextTemplate, nextTemplateMetrics)
        disposeObject(gltf.scene)

        let nextEdgeLightTexture: THREE.Texture | null = null
        let nextCardDepthMaskTexture: THREE.Texture | null = null
        try {
          nextEdgeLightTexture =
            await loadFavoritesPedestalEdgeLightTexture(
              renderer.capabilities.getMaxAnisotropy(),
            )
          addFavoritesPedestalEdgeLight(
            nextTemplate,
            nextTemplateMetrics,
            nextEdgeLightTexture,
            {
              opacity: look.edgeLightOpacity,
              color: look.edgeLightColor,
              materialTint: materialTintRef.current,
            },
          )
        } catch (error) {
          console.warn(
            '[Aurora favorites] Pedestal edge light load failed',
            error,
          )
        }
        try {
          nextCardDepthMaskTexture =
            await loadFavoritesCardDepthMaskTexture(
              renderer.capabilities.getMaxAnisotropy(),
            )
        } catch (error) {
          console.warn(
            '[Aurora favorites] Card depth mask load failed',
            error,
          )
        }

        if (disposed) {
          disposeObject(nextTemplate)
          nextEdgeLightTexture?.dispose()
          nextCardDepthMaskTexture?.dispose()
          return
        }
        if (!nextCardDepthMaskTexture) {
          disposeObject(nextTemplate)
          nextEdgeLightTexture?.dispose()
          throw new Error('Favorites card depth mask is unavailable')
        }
        template = nextTemplate
        templateMetrics = nextTemplateMetrics
        edgeLightTexture = nextEdgeLightTexture
        cardDepthMaskTexture = nextCardDepthMaskTexture
        setMaterialTint(materialTintRef.current)
        setPedestalTint(pedestalTintRef.current)
        canvas.dataset.modelWidth = String(templateMetrics.size.x)
        canvas.dataset.modelHeight = String(templateMetrics.size.y)
        canvas.dataset.modelDepth = String(templateMetrics.size.z)
        canvas.dataset.edgeLightReady = String(Boolean(edgeLightTexture))
        canvas.dataset.cardDepthOcclusionReady = 'true'
        canvas.dataset.materialLook = look.id
        canvas.dataset.materialLabel = look.label
        loadState = 'ready'
        canvas.dataset.assetReady = 'true'
        invalidate()
      })
      .catch((error) => {
        if (disposed) return
        loadState = 'error'
        canvas.dataset.assetReady = 'false'
        canvas.dataset.renderState = 'fallback'
        console.warn('[Aurora favorites] Pedestal model load failed', error)
      })

    canvas.dataset.environmentReady = 'false'
    canvas.dataset.environmentSource = 'procedural-fallback'
    void createFavoritesPedestalEnvironmentTarget(environmentGenerator, look)
      .then((target) => {
        if (disposed) {
          target.dispose()
          return
        }
        hdrEnvironmentTarget = target
        scene.environment = target.texture
        reflectionScene.environment = target.texture
        scene.environmentIntensity = look.environmentIntensity
        reflectionScene.environmentIntensity = look.environmentIntensity
        canvas.dataset.environmentReady = 'true'
        canvas.dataset.environmentSource = look.environmentAsset
        invalidate()
      })
      .catch((error) => {
        if (disposed) return
        canvas.dataset.environmentReady = 'fallback'
        console.warn(
          '[Aurora favorites] Gallery environment reflection load failed',
          error,
        )
      })

    invalidate()
    return () => {
      disposed = true
      updateSurfaceDataRef.current = () => undefined
      updateMaterialTintRef.current = () => undefined
      updatePedestalTintRef.current = () => undefined
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      canvas.removeEventListener(
        'aurora-favorites-pedestal-invalidate',
        handleInvalidate,
      )
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      resizeObserver?.disconnect()
      window.clearInterval(pixelRatioPollTimer)
      slots.forEach((slot) => {
        scene.remove(slot.root)
        scene.remove(slot.cardDepthOccluder)
        reflectionScene.remove(slot.reflectionRoot)
        cardOcclusionScene.remove(slot.cardReflectionOcclusionMask)
        disposeObject(slot.root)
        disposeObject(slot.reflectionRoot)
        disposeObject(slot.cardDepthOccluder)
        disposeObject(slot.cardReflectionOcclusionMask)
      })
      slots.clear()
      if (template) disposeObject(template)
      edgeLightTexture?.dispose()
      cardDepthMaskTexture?.dispose()
      scene.environment = null
      reflectionScene.environment = null
      hdrEnvironmentTarget?.dispose()
      fallbackEnvironmentTarget.dispose()
      environmentGenerator.dispose()
      customSurfaceTexture?.dispose()
      defaultSurfaceTexture.dispose()
      reflectionTarget.dispose()
      cardOcclusionTarget.dispose()
      compositeGeometry.dispose()
      compositeMaterial.dispose()
      renderer.dispose()
    }
  }, [lookId, runtimeReady, stageRef])

  useEffect(() => {
    updateSurfaceDataRef.current(surfaceData)
  }, [surfaceData])

  useEffect(() => {
    updateMaterialTintRef.current(materialTint)
  }, [materialTint])

  useEffect(() => {
    updatePedestalTintRef.current(pedestalTint)
  }, [pedestalTint])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !runtimeReady || !active || suspended) return
    canvas.dataset.motionSignal = motionSignal
    canvas.dataset.layoutSignal = layoutSignal
    canvas.dataset.cardIds = cardIdsSignal
    canvas.dispatchEvent(new Event('aurora-favorites-pedestal-invalidate'))
  }, [
    active,
    cameraPitch,
    cameraYaw,
    cardIdsSignal,
    layoutSignal,
    motionSignal,
    runtimeReady,
    suspended,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !runtimeReady || !active || suspended) return
    const animationFrame = window.requestAnimationFrame(() => {
      canvas.dispatchEvent(new Event('aurora-favorites-pedestal-invalidate'))
    })
    return () => window.cancelAnimationFrame(animationFrame)
  }, [active, cardIdsSignal, runtimeReady, suspended])

  return (
    <canvas
      ref={canvasRef}
      className="favoritesPedestalCanvas"
      data-aurora-renderer="favorites-pedestals"
      data-asset-ready="false"
      data-pedestal-ready="false"
      data-reflection-ready="false"
      data-reflection-opacity-scale={FAVORITES_REFLECTION_OPACITY_SCALE}
      data-reflection-coverage-lock="true"
      data-reflection-surface-ready="false"
      data-reflection-surface-key="initializing"
      data-environment-ready="false"
      data-environment-source="initializing"
      data-material-look={lookId}
      data-edge-light-ready="false"
      data-edge-light-material-tint="initializing"
      data-pedestal-material-tint="initializing"
      data-card-depth-occlusion-ready="false"
      data-card-reflection-occlusion-ready="false"
      data-bloom-enabled="false"
      data-render-state={runtimeReady ? 'initializing' : 'deferred'}
      aria-hidden="true"
    />
  )
}
