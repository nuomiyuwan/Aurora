import * as THREE from 'three'
import type { Project } from '../../../data/projects'
import type { BackgroundReflectionSurface } from '../../reflection/backgroundReflectionSurfaceProtocol'
import {
  CardTextureEvictedError,
  CardTextureCache,
  type CardTextureCacheOptions,
} from './cardTextureCache'
import type { DomCardSample } from './domCardProjection'
import { HOME_CARD_ALPHA_BOTTOM } from '../galleryCardLayout'
import {
  ICE_REFLECTION_FADE_START,
  ICE_REFLECTION_MAX_BLUR_TEXELS,
  ICE_REFLECTION_VISIBLE_DISTANCE,
  iceCompositeFragmentShader,
  iceCompositeVertexShader,
  reflectionSourceFragmentShader,
  reflectionSourceVertexShader,
} from './reflectionShaders'

export const DOM_REFLECTION_TARGET_SCALE = 1.0
export const DOM_REFLECTION_TARGET_MAX_EDGE = 1536
export const DOM_REFLECTION_MAX_SOURCES = 6
const DOM_REFLECTION_SOURCE_CAPACITY_LIMIT = 32
export const DOM_REFLECTION_MAX_DPR = 1.25
export const DOM_REFLECTION_PREFERRED_DPR = 1
export const ICE_REFLECTION_SURFACE_ASSET =
  './aurora/reflection-ice-surface-generated-2048.png'
export const ICE_REFLECTION_ASSET_VERSION = 'ice-reflection-v5'
export const ICE_REFLECTION_DEFAULT_MATERIAL_TINT = '#aec5ff'

export type IceReflectionDiagnostics = {
  renderCount: number
  rendererCount: number
  targetCount: number
  targetWidth: number
  targetHeight: number
  sourceCapacity: number
  sourceCount: number
  visibleSourceCount: number
  sourceSignature: string
  projectionSignature: string
  surfaceKey: string
  textureCount: number
  missingTextureProjectIds: string[]
  textureErrorProjectIds: string[]
  ready: boolean
  contextLost: boolean
}

export type IceReflectionRendererOptions = {
  onInvalidate?: () => void
  onTextureFrame?: () => void
  textureCache: CardTextureCacheOptions
  sourceCapacity?: number
  sourceAlphaBottom?: number
  sourceVisibleDistance?: number
  sourceFadeStart?: number
  sourceMaxBlurTexels?: number
  sourceContactOverlapPixels?: number
  sourceEdgeFadeWidth?: number
  sourceLightAsset?: string
  materialTint?: string
  blendOverlappingSources?: boolean
  /** Prevent ice displacement from pulling a reflection outside its source silhouette. */
  lockCompositeToSourceCoverage?: boolean
}

type ValueUniform<T> = { value: T }

const loadReflectionDataTexture = (asset: string, name: string) => {
  let resolveTexture: () => void = () => undefined
  let rejectTexture: (reason?: unknown) => void = () => undefined
  const ready = new Promise<void>((resolve, reject) => {
    resolveTexture = resolve
    rejectTexture = reject
  })
  const texture = new THREE.TextureLoader().load(
    asset,
    () => resolveTexture(),
    undefined,
    () => rejectTexture(new Error(`Unable to load reflection data asset: ${asset}`)),
  )
  texture.name = name
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return { ready, texture }
}

type SourceSlot = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  material: THREE.ShaderMaterial
  reflectionMatrix: THREE.Matrix4
  viewport: THREE.Vector2
  cardSize: THREE.Vector2
  cardTexelSize: THREE.Vector2
  cardTextureUniform: ValueUniform<THREE.Texture | null>
  sourceOpacityUniform: ValueUniform<number>
  sourceLightOpacityUniform: ValueUniform<number>
  sourceAlphaBottomUniform: ValueUniform<number>
  sourceBaseBlurTexelsUniform: ValueUniform<number>
  carouselKey: string
  projectId: string
  projectIndex: number
  width: number
  height: number
  opacity: number
  reflectionOpacity: number
  reflectionBlurTexels: number
  lightOpacity: number
  paintOrder: number
  usedRectFallback: boolean
}

const HASH_OFFSET = 2166136261
const HASH_PRIME = 16777619

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

const clamp01 = (value: number) => Math.min(1, Math.max(0, finiteOr(value, 0)))

const normalizeMaterialTint = (value?: string) => {
  const trimmed = value?.trim().toLowerCase() ?? ''
  const shortMatch = /^#([0-9a-f]{3})$/.exec(trimmed)
  if (shortMatch) {
    const [red, green, blue] = shortMatch[1].split('')
    return `#${red}${red}${green}${green}${blue}${blue}`
  }
  return /^#[0-9a-f]{6}$/.test(trimmed)
    ? trimmed
    : ICE_REFLECTION_DEFAULT_MATERIAL_TINT
}

const materialTintToRgb = (value: string) => {
  return {
    red: Number.parseInt(value.slice(1, 3), 16) / 255,
    green: Number.parseInt(value.slice(3, 5), 16) / 255,
    blue: Number.parseInt(value.slice(5, 7), 16) / 255,
  }
}

const DEFAULT_MATERIAL_TINT_RGB = materialTintToRgb(
  ICE_REFLECTION_DEFAULT_MATERIAL_TINT,
)

export const normalizeDomReflectionSourceCapacity = (value?: number) => {
  const requested = finiteOr(
    value ?? DOM_REFLECTION_MAX_SOURCES,
    DOM_REFLECTION_MAX_SOURCES,
  )
  return Math.min(
    DOM_REFLECTION_SOURCE_CAPACITY_LIMIT,
    Math.max(1, Math.floor(requested)),
  )
}

const hashString = (initial: number, value: string) => {
  let hash = initial
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), HASH_PRIME) >>> 0
  }
  return hash
}

const hashNumber = (initial: number, value: number) => {
  const quantized = Math.round(finiteOr(value, 0) * 10_000)
  return Math.imul(initial ^ quantized, HASH_PRIME) >>> 0
}

export const orderDomReflectionSamples = (
  samples: readonly DomCardSample[],
): DomCardSample[] =>
  samples
    .map((sample, domOrder) => ({ sample, domOrder }))
    .sort(
      (left, right) =>
        finiteOr(left.sample.paintOrder, left.domOrder) -
          finiteOr(right.sample.paintOrder, right.domOrder) ||
        left.domOrder - right.domOrder,
    )
    .map(({ sample }) => sample)

export const getDomReflectionTargetSize = (
  width: number,
  height: number,
): { width: number; height: number } => {
  const safeWidth = Math.max(1, finiteOr(width, 1))
  const safeHeight = Math.max(1, finiteOr(height, 1))
  const halfResolutionLongEdge =
    Math.max(safeWidth, safeHeight) * DOM_REFLECTION_TARGET_SCALE
  const scale =
    halfResolutionLongEdge > DOM_REFLECTION_TARGET_MAX_EDGE
      ? DOM_REFLECTION_TARGET_MAX_EDGE / Math.max(safeWidth, safeHeight)
      : DOM_REFLECTION_TARGET_SCALE
  const targetWidth = Math.max(1, Math.round(safeWidth * scale))
  const targetHeight = Math.max(1, Math.round(safeHeight * scale))

  return { width: targetWidth, height: targetHeight }
}

const createSourceGeometry = () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
      3,
    ),
  )
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2),
  )
  geometry.setIndex([0, 2, 1, 2, 3, 1])
  return geometry
}

export class IceReflectionRenderer {
  readonly #canvas: HTMLCanvasElement
  readonly #onInvalidate: (() => void) | undefined
  readonly #onTextureFrame: (() => void) | undefined
  readonly #renderer: THREE.WebGLRenderer
  readonly #sourceScene = new THREE.Scene()
  readonly #sourceCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  readonly #sourceGeometry = createSourceGeometry()
  readonly #sourceSlots: SourceSlot[] = []
  readonly #target: THREE.WebGLRenderTarget
  readonly #compositeScene = new THREE.Scene()
  readonly #compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  readonly #compositeGeometry: THREE.PlaneGeometry
  readonly #compositeMaterial: THREE.ShaderMaterial
  readonly #compositeMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  readonly #sourceMapUniform: ValueUniform<THREE.Texture>
  readonly #sourceLightMapUniform: ValueUniform<THREE.Texture>
  readonly #sourceLightEnabledUniform: ValueUniform<number>
  readonly #sourceMaterialTintEnabledUniform: ValueUniform<number> = { value: 0 }
  readonly #sourceMaterialTintMidtoneUniform: ValueUniform<THREE.Vector3> = {
    value: new THREE.Vector3(
      DEFAULT_MATERIAL_TINT_RGB.red,
      DEFAULT_MATERIAL_TINT_RGB.green,
      DEFAULT_MATERIAL_TINT_RGB.blue,
    ),
  }
  readonly #surfaceDataMapUniform: ValueUniform<THREE.Texture>
  readonly #texelSize = new THREE.Vector2(1, 1)
  readonly #cameraYawUniform: ValueUniform<number> = { value: 0 }
  readonly #cameraPitchUniform: ValueUniform<number> = { value: 0 }
  readonly #defaultSurfaceDataTexture: THREE.Texture
  #customSurfaceDataTexture: THREE.DataTexture | null = null
  readonly #sourceLightTexture: THREE.Texture
  readonly #textureCache: CardTextureCache
  readonly #sourceCapacity: number
  readonly #defaultSourceAlphaBottom: number
  readonly #projectTextures: (THREE.Texture | null)[]
  readonly #legacyProjectIds: string[]
  readonly #projectTexturesById = new Map<string, THREE.Texture | null>()
  readonly #projectTextureOverridesById = new Map<string, THREE.CanvasTexture>()
  readonly #projectTextureRequestVersions = new Map<string, number>()
  readonly #projectTextureErrors = new Map<string, string>()
  readonly #ready: Promise<void>
  #settleSourceLightReady: (() => void) | null = null

  #viewportWidth = 0
  #viewportHeight = 0
  #targetWidth = 1
  #targetHeight = 1
  #sourceCount = 0
  #visibleSourceCount = 0
  #renderCount = 0
  #sourceSignature = ''
  #projectionSignature = ''
  #surfaceKey = ICE_REFLECTION_ASSET_VERSION
  #syncInvalidated = true
  #readyForDisplay = false
  #contextLost = false
  #disposed = false
  #materialTint = ICE_REFLECTION_DEFAULT_MATERIAL_TINT

  readonly #handleContextLost = (event: Event) => {
    if (this.#disposed) return
    event.preventDefault()
    this.#contextLost = true
    this.#syncInvalidated = true
    this.#updateVisibility()
  }

  readonly #handleContextRestored = () => {
    if (this.#disposed) return
    this.#contextLost = false
    this.#syncInvalidated = true
    this.#updateVisibility()
    this.#onInvalidate?.()
  }

  constructor(
    canvas: HTMLCanvasElement,
    projects: readonly Project[],
    options: IceReflectionRendererOptions,
  ) {
    this.#canvas = canvas
    this.#onInvalidate = options.onInvalidate
    this.#onTextureFrame = options.onTextureFrame
    this.#textureCache = new CardTextureCache({
      assetVersion: ICE_REFLECTION_ASSET_VERSION,
      ...options.textureCache,
    })
    this.#sourceCapacity = normalizeDomReflectionSourceCapacity(options.sourceCapacity)
    const sourceAlphaBottom = Math.min(
      1,
      Math.max(
        0.0001,
        finiteOr(
          options.sourceAlphaBottom ?? HOME_CARD_ALPHA_BOTTOM,
          HOME_CARD_ALPHA_BOTTOM,
        ),
      ),
    )
    this.#defaultSourceAlphaBottom = sourceAlphaBottom
    const sourceVisibleDistance = Math.min(
      1,
      Math.max(
        0.0001,
        finiteOr(
          options.sourceVisibleDistance ?? ICE_REFLECTION_VISIBLE_DISTANCE,
          ICE_REFLECTION_VISIBLE_DISTANCE,
        ),
      ),
    )
    const sourceFadeStart = Math.min(
      sourceVisibleDistance,
      Math.max(
        0,
        finiteOr(
          options.sourceFadeStart ?? ICE_REFLECTION_FADE_START,
          ICE_REFLECTION_FADE_START,
        ),
      ),
    )
    const sourceMaxBlurTexels = Math.max(
      0,
      finiteOr(
        options.sourceMaxBlurTexels ?? ICE_REFLECTION_MAX_BLUR_TEXELS,
        ICE_REFLECTION_MAX_BLUR_TEXELS,
      ),
    )
    const sourceContactOverlapPixels = Math.min(
      8,
      Math.max(0, finiteOr(options.sourceContactOverlapPixels ?? 0, 0)),
    )
    const sourceEdgeFadeWidth = Math.min(
      0.25,
      Math.max(0.0001, finiteOr(options.sourceEdgeFadeWidth ?? 0.075, 0.075)),
    )
    this.#renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    })
    this.#renderer.autoClear = false
    this.#renderer.sortObjects = false
    this.#renderer.setClearColor(0x000000, 0)
    this.#renderer.setPixelRatio(
      Math.min(DOM_REFLECTION_PREFERRED_DPR, DOM_REFLECTION_MAX_DPR),
    )

    const sourceLightAsset = options.sourceLightAsset?.trim()
    let resolveSourceLight: (() => void) | undefined
    let rejectSourceLight: ((reason?: unknown) => void) | undefined
    let sourceLightSettled = false
    const sourceLightReady = sourceLightAsset
      ? new Promise<void>((resolve, reject) => {
          resolveSourceLight = resolve
          rejectSourceLight = reject
        })
      : Promise.resolve()
    const settleSourceLight = (error?: unknown) => {
      if (sourceLightSettled) return
      sourceLightSettled = true
      this.#settleSourceLightReady = null
      if (error) rejectSourceLight?.(error)
      else resolveSourceLight?.()
    }
    if (sourceLightAsset) {
      this.#settleSourceLightReady = () => settleSourceLight()
    }
    this.#sourceLightTexture = sourceLightAsset
      ? new THREE.TextureLoader().load(
          sourceLightAsset,
          () => {
            settleSourceLight()
            if (this.#disposed) return
            this.#syncInvalidated = true
            this.#onInvalidate?.()
          },
          undefined,
          (error) => settleSourceLight(error),
        )
      : new THREE.DataTexture(
          new Uint8Array([0, 0, 0, 0]),
          1,
          1,
          THREE.RGBAFormat,
        )
    this.#sourceLightTexture.name = sourceLightAsset
      ? 'ice-reflection-source-light'
      : 'ice-reflection-source-light-empty'
    this.#sourceLightTexture.colorSpace = THREE.SRGBColorSpace
    this.#sourceLightTexture.minFilter = THREE.LinearFilter
    this.#sourceLightTexture.magFilter = THREE.LinearFilter
    this.#sourceLightTexture.generateMipmaps = false
    this.#sourceLightTexture.needsUpdate = true
    this.#sourceLightMapUniform = { value: this.#sourceLightTexture }
    this.#sourceLightEnabledUniform = { value: sourceLightAsset ? 1 : 0 }

    this.#applyMaterialTint(options.materialTint)

    this.#sourceCamera.position.z = 1
    this.#compositeCamera.position.z = 1

    for (let index = 0; index < this.#sourceCapacity; index += 1) {
      const reflectionMatrix = new THREE.Matrix4()
      const viewport = new THREE.Vector2(1, 1)
      const cardSize = new THREE.Vector2()
      const cardTexelSize = new THREE.Vector2(1 / 1024, 1 / 764)
      const cardTextureUniform: ValueUniform<THREE.Texture | null> = { value: null }
      const sourceOpacityUniform: ValueUniform<number> = { value: 0 }
      const sourceLightOpacityUniform: ValueUniform<number> = { value: 0 }
      const sourceAlphaBottomUniform: ValueUniform<number> = { value: sourceAlphaBottom }
      const sourceBaseBlurTexelsUniform: ValueUniform<number> = { value: 0 }
      const material = new THREE.ShaderMaterial({
        vertexShader: reflectionSourceVertexShader,
        fragmentShader: reflectionSourceFragmentShader,
        uniforms: {
          reflectionMatrix: { value: reflectionMatrix },
          viewport: { value: viewport },
          cardSize: { value: cardSize },
          cardTexelSize: { value: cardTexelSize },
          cardTexture: cardTextureUniform,
          sourceLightTexture: this.#sourceLightMapUniform,
          sourceOpacity: sourceOpacityUniform,
          sourceLightEnabled: this.#sourceLightEnabledUniform,
          sourceLightOpacity: sourceLightOpacityUniform,
          sourceMaterialTintEnabled: this.#sourceMaterialTintEnabledUniform,
          sourceMaterialTintMidtone: this.#sourceMaterialTintMidtoneUniform,
          sourceAlphaBottom: sourceAlphaBottomUniform,
          sourceVisibleDistance: { value: sourceVisibleDistance },
          sourceFadeStart: { value: sourceFadeStart },
          sourceBaseBlurTexels: sourceBaseBlurTexelsUniform,
          sourceMaxBlurTexels: { value: sourceMaxBlurTexels },
          sourceContactOverlapPixels: { value: sourceContactOverlapPixels },
          sourceEdgeFadeWidth: { value: sourceEdgeFadeWidth },
        },
        transparent: true,
        premultipliedAlpha: true,
        blending: options.blendOverlappingSources
          ? THREE.NormalBlending
          : THREE.NoBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.#sourceGeometry, material)
      mesh.name = `ice-reflection-source-${index}`
      mesh.frustumCulled = false
      mesh.matrixAutoUpdate = false
      mesh.renderOrder = index
      mesh.visible = false
      this.#sourceScene.add(mesh)
      this.#sourceSlots.push({
        mesh,
        material,
        reflectionMatrix,
        viewport,
        cardSize,
        cardTexelSize,
        cardTextureUniform,
        sourceOpacityUniform,
        sourceLightOpacityUniform,
        sourceAlphaBottomUniform,
        sourceBaseBlurTexelsUniform,
        carouselKey: '',
        projectId: '',
        projectIndex: -1,
        width: 0,
        height: 0,
        opacity: 0,
        reflectionOpacity: 0,
        reflectionBlurTexels: 0,
        lightOpacity: 0,
        paintOrder: 0,
        usedRectFallback: false,
      })
    }

    this.#target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    this.#target.texture.name = 'ice-reflection-source-target'
    this.#sourceMapUniform = { value: this.#target.texture }

    const surfaceData = loadReflectionDataTexture(
      ICE_REFLECTION_SURFACE_ASSET,
      'ice-reflection-surface-generated-2048',
    )
    this.#defaultSurfaceDataTexture = surfaceData.texture
    this.#surfaceDataMapUniform = { value: this.#defaultSurfaceDataTexture }

    this.#compositeGeometry = new THREE.PlaneGeometry(2, 2)
    this.#compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: iceCompositeVertexShader,
      fragmentShader: iceCompositeFragmentShader,
      uniforms: {
        sourceMap: this.#sourceMapUniform,
        surfaceDataMap: this.#surfaceDataMapUniform,
        texelSize: { value: this.#texelSize },
        cameraYaw: this.#cameraYawUniform,
        cameraPitch: this.#cameraPitchUniform,
        sourceCoverageLock: {
          value: options.lockCompositeToSourceCoverage ? 1 : 0,
        },
      },
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    })
    this.#compositeMesh = new THREE.Mesh(
      this.#compositeGeometry,
      this.#compositeMaterial,
    )
    this.#compositeMesh.name = 'ice-reflection-composite'
    this.#compositeMesh.frustumCulled = false
    this.#compositeMesh.matrixAutoUpdate = false
    this.#compositeMesh.visible = false
    this.#compositeScene.add(this.#compositeMesh)

    this.#canvas.addEventListener('webglcontextlost', this.#handleContextLost)
    this.#canvas.addEventListener('webglcontextrestored', this.#handleContextRestored)

    this.resize(canvas.clientWidth || canvas.width || 1, canvas.clientHeight || canvas.height || 1)

    this.#projectTextures = new Array<THREE.Texture | null>(projects.length).fill(null)
    this.#legacyProjectIds = projects.map((project) => project.id)
    projects.forEach((project) => this.#projectTexturesById.set(project.id, null))
    const textureAssignments: Promise<void>[] = []
    for (let index = 0; index < projects.length; index += 1) {
      const project = projects[index]
      const requestVersion =
        (this.#projectTextureRequestVersions.get(project.id) ?? 0) + 1
      this.#projectTextureRequestVersions.set(project.id, requestVersion)
      textureAssignments.push(
        this.#textureCache
          .get(project)
          .then((texture) => {
            if (
              this.#disposed ||
              this.#projectTextureRequestVersions.get(project.id) !==
                requestVersion
            ) {
              return
            }
            this.#assignProjectTexture(project.id, texture)
            this.#syncInvalidated = true
          })
          .catch((error: unknown) => {
            if (
              this.#disposed ||
              this.#projectTextureRequestVersions.get(project.id) !==
                requestVersion
            ) {
              return
            }
            this.#recordProjectTextureError(project.id, error)
            throw error
          }),
      )
    }
    const cardsReady = Promise.all(textureAssignments).then(() =>
      this.#textureCache.whenReady(),
    )
    this.#ready = Promise.all([
      cardsReady,
      surfaceData.ready,
      sourceLightReady,
    ]).then(() => {
      if (this.#disposed) return
      this.#readyForDisplay = true
      this.#syncInvalidated = true
      this.#updateVisibility()
      this.#onInvalidate?.()
    })
  }

  ensureProjects(projects: readonly Project[]): void {
    if (this.#disposed) return
    projects.forEach((project) => {
      if (!this.#projectTexturesById.has(project.id)) {
        this.#projectTexturesById.set(project.id, null)
      }
      const requestVersion = (this.#projectTextureRequestVersions.get(project.id) ?? 0) + 1
      this.#projectTextureRequestVersions.set(project.id, requestVersion)
      void this.#textureCache
        .get(project)
        .then((texture) => {
          if (this.#disposed) return
          if (this.#projectTextureRequestVersions.get(project.id) !== requestVersion) return
          if (this.#projectTexturesById.get(project.id) === texture) return
          this.#assignProjectTexture(project.id, texture)
          this.#syncInvalidated = true
          this.#updateVisibility()
          this.#onInvalidate?.()
        })
        .catch((error: unknown) => {
          /*
           * A page transition can remove a DOM reflection source while its
           * asynchronous raster is still pending. Do not surface stale
           * eviction as an unhandled rejection, but retain real failures in
           * diagnostics so the owning page can retry the missing source.
           */
          if (
            this.#disposed ||
            this.#projectTextureRequestVersions.get(project.id) !==
              requestVersion
          ) {
            return
          }
          this.#recordProjectTextureError(project.id, error)
        })
    })
  }

  async prepareProjects(
    projects: readonly Project[],
    batchSize = 3,
  ): Promise<void> {
    if (this.#disposed || projects.length === 0) return
    const safeBatchSize = Math.max(1, Math.floor(batchSize))

    for (
      let batchStart = 0;
      batchStart < projects.length;
      batchStart += safeBatchSize
    ) {
      if (this.#disposed) return
      const batch = projects.slice(
        batchStart,
        batchStart + safeBatchSize,
      )
      await Promise.all(
        batch.map(async (project) => {
          if (!this.#projectTexturesById.has(project.id)) {
            this.#projectTexturesById.set(project.id, null)
          }
          const requestVersion =
            (this.#projectTextureRequestVersions.get(project.id) ?? 0) + 1
          this.#projectTextureRequestVersions.set(
            project.id,
            requestVersion,
          )
          let texture: THREE.Texture
          try {
            texture = await this.#textureCache.get(project)
          } catch (error) {
            if (
              !this.#disposed &&
              this.#projectTextureRequestVersions.get(project.id) ===
                requestVersion
            ) {
              this.#recordProjectTextureError(project.id, error)
            }
            throw error
          }
          if (
            this.#disposed ||
            this.#projectTextureRequestVersions.get(project.id) !==
              requestVersion
          ) {
            return
          }

          this.#assignProjectTexture(project.id, texture)
          if (!this.#contextLost) this.#renderer.initTexture(texture)
        }),
      )

      if (batchStart + safeBatchSize < projects.length) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
      }
    }

    if (this.#disposed) return
    this.#syncInvalidated = true
    this.#updateVisibility()
    this.#onInvalidate?.()
  }

  hasProjectTexture(projectId: string): boolean {
    return this.#resolveProjectTexture(projectId) != null
  }

  /**
   * Temporarily replaces one cached DOM raster with a mutable canvas source.
   * The cached raster remains owned by CardTextureCache and becomes the
   * immediate fallback again when the override is cleared.
   */
  setProjectCanvasTexture(
    projectId: string,
    canvas: HTMLCanvasElement | null,
  ): void {
    if (this.#disposed) return

    const current = this.#projectTextureOverridesById.get(projectId)
    if (!canvas) {
      if (!current) return
      this.#projectTextureOverridesById.delete(projectId)
      current.dispose()
      this.#assignResolvedProjectTexture(projectId)
      this.#syncInvalidated = true
      this.#updateVisibility()
      ;(this.#onTextureFrame ?? this.#onInvalidate)?.()
      return
    }

    if (current?.image === canvas) {
      current.needsUpdate = true
      ;(this.#onTextureFrame ?? this.#onInvalidate)?.()
      return
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.name = `ice-reflection-live-canvas:${projectId}`
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
    this.#projectTextureOverridesById.set(projectId, texture)
    this.#assignResolvedProjectTexture(projectId)
    this.#syncInvalidated = true
    this.#updateVisibility()
    if (!this.#contextLost) this.#renderer.initTexture(texture)
    current?.dispose()
    ;(this.#onTextureFrame ?? this.#onInvalidate)?.()
  }

  retainProjects(projects: readonly Project[]): void {
    if (this.#disposed) return
    const retainedProjectIds = new Set(projects.map((project) => project.id))
    this.#sourceSlots.forEach((slot) => {
      const projectId =
        slot.projectId ||
        (slot.projectIndex >= 0
          ? (this.#legacyProjectIds[slot.projectIndex] ?? '')
          : '')
      if (projectId) retainedProjectIds.add(projectId)
    })

    let changed = false
    const residentProjectIds = new Set([
      ...this.#projectTexturesById.keys(),
      ...this.#projectTextureOverridesById.keys(),
    ])
    for (const projectId of residentProjectIds) {
      if (retainedProjectIds.has(projectId)) continue
      const requestVersion =
        (this.#projectTextureRequestVersions.get(projectId) ?? 0) + 1
      this.#projectTextureRequestVersions.set(projectId, requestVersion)
      this.#projectTexturesById.delete(projectId)
      this.#projectTextureErrors.delete(projectId)
      this.#projectTextureOverridesById.get(projectId)?.dispose()
      this.#projectTextureOverridesById.delete(projectId)
      this.#legacyProjectIds.forEach((legacyProjectId, index) => {
        if (legacyProjectId === projectId) this.#projectTextures[index] = null
      })
      this.#textureCache.evictProject(projectId)
      changed = true
    }

    this.#textureCache.retainProjectIds(retainedProjectIds)
    if (!changed) return
    this.#syncInvalidated = true
    this.#updateVisibility()
    this.#onInvalidate?.()
  }

  #assignProjectTexture(projectId: string, texture: THREE.Texture): void {
    this.#projectTexturesById.set(projectId, texture)
    this.#projectTextureErrors.delete(projectId)
    this.#legacyProjectIds.forEach((legacyProjectId, index) => {
      if (legacyProjectId === projectId) {
        this.#projectTextures[index] = this.#resolveProjectTexture(projectId)
      }
    })
    for (let slotIndex = 0; slotIndex < this.#sourceSlots.length; slotIndex += 1) {
      const slot = this.#sourceSlots[slotIndex]
      const slotProjectId =
        slot.projectId ||
        (slot.projectIndex >= 0
          ? (this.#legacyProjectIds[slot.projectIndex] ?? '')
          : '')
      if (slotProjectId !== projectId) continue
      slot.cardTextureUniform.value = this.#resolveProjectTexture(projectId)
    }
  }

  #resolveProjectTexture(projectId: string): THREE.Texture | null {
    return (
      this.#projectTextureOverridesById.get(projectId) ??
      this.#projectTexturesById.get(projectId) ??
      null
    )
  }

  #assignResolvedProjectTexture(projectId: string): void {
    const texture = this.#resolveProjectTexture(projectId)
    this.#legacyProjectIds.forEach((legacyProjectId, index) => {
      if (legacyProjectId === projectId) this.#projectTextures[index] = texture
    })
    for (let slotIndex = 0; slotIndex < this.#sourceSlots.length; slotIndex += 1) {
      const slot = this.#sourceSlots[slotIndex]
      const slotProjectId =
        slot.projectId ||
        (slot.projectIndex >= 0
          ? (this.#legacyProjectIds[slot.projectIndex] ?? '')
          : '')
      if (slotProjectId === projectId) slot.cardTextureUniform.value = texture
    }
  }

  setMaterialTint(materialTint?: string): void {
    if (this.#disposed || !this.#applyMaterialTint(materialTint)) return
    this.#syncInvalidated = true
    this.#onInvalidate?.()
  }

  setSurfaceData(surface: BackgroundReflectionSurface | null): void {
    if (this.#disposed) return
    const nextKey = surface?.key ?? ICE_REFLECTION_ASSET_VERSION
    if (nextKey === this.#surfaceKey) return

    if (!surface) {
      this.#surfaceDataMapUniform.value = this.#defaultSurfaceDataTexture
      this.#customSurfaceDataTexture?.dispose()
      this.#customSurfaceDataTexture = null
      this.#surfaceKey = nextKey
      this.#syncInvalidated = true
      this.#onInvalidate?.()
      return
    }

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

    const previousTexture = this.#customSurfaceDataTexture
    this.#customSurfaceDataTexture = texture
    this.#surfaceDataMapUniform.value = texture
    this.#surfaceKey = nextKey
    this.#syncInvalidated = true
    previousTexture?.dispose()
    this.#onInvalidate?.()
  }

  resize(width: number, height: number): void {
    if (this.#disposed) return
    const nextWidth = Math.max(1, finiteOr(width, 1))
    const nextHeight = Math.max(1, finiteOr(height, 1))
    const nextTarget = getDomReflectionTargetSize(nextWidth, nextHeight)
    const viewportChanged =
      nextWidth !== this.#viewportWidth || nextHeight !== this.#viewportHeight
    const targetChanged =
      nextTarget.width !== this.#targetWidth || nextTarget.height !== this.#targetHeight

    if (viewportChanged) {
      this.#viewportWidth = nextWidth
      this.#viewportHeight = nextHeight
      this.#renderer.setSize(nextWidth, nextHeight, false)
      for (let index = 0; index < this.#sourceSlots.length; index += 1) {
        this.#sourceSlots[index].viewport.set(nextWidth, nextHeight)
      }
    }

    if (targetChanged) {
      this.#targetWidth = nextTarget.width
      this.#targetHeight = nextTarget.height
      this.#target.setSize(nextTarget.width, nextTarget.height)
      this.#texelSize.set(1 / nextTarget.width, 1 / nextTarget.height)
    }

    if (viewportChanged || targetChanged) this.#syncInvalidated = true
  }

  sync(
    samples: readonly DomCardSample[],
    cameraYawDegrees: number,
    cameraPitchDegrees: number,
  ): boolean {
    if (this.#disposed) return false
    let changed = this.#syncInvalidated
    const orderedSamples = orderDomReflectionSamples(samples)
    const nextSourceCount = Math.min(
      this.#sourceCapacity,
      orderedSamples.length,
    )
    const nextYaw = finiteOr(cameraYawDegrees, 0)
    const nextPitch = finiteOr(cameraPitchDegrees, 0)

    if (nextSourceCount !== this.#sourceCount) changed = true
    if (this.#cameraYawUniform.value !== nextYaw) {
      this.#cameraYawUniform.value = nextYaw
      changed = true
    }
    if (this.#cameraPitchUniform.value !== nextPitch) {
      this.#cameraPitchUniform.value = nextPitch
      changed = true
    }

    for (let index = 0; index < this.#sourceSlots.length; index += 1) {
      const slot = this.#sourceSlots[index]
      if (index >= nextSourceCount) {
        if (
          slot.projectIndex !== -1 ||
          slot.carouselKey !== '' ||
          slot.mesh.visible ||
          slot.cardTextureUniform.value !== null
        ) {
          slot.mesh.visible = false
          slot.cardTextureUniform.value = null
          slot.sourceOpacityUniform.value = 0
          slot.sourceLightOpacityUniform.value = 0
          slot.sourceAlphaBottomUniform.value = this.#defaultSourceAlphaBottom
          slot.sourceBaseBlurTexelsUniform.value = 0
          slot.reflectionMatrix.identity()
          slot.cardSize.set(0, 0)
          slot.carouselKey = ''
          slot.projectId = ''
          slot.projectIndex = -1
          slot.width = 0
          slot.height = 0
          slot.opacity = 0
          slot.reflectionOpacity = 0
          slot.reflectionBlurTexels = 0
          slot.lightOpacity = 0
          slot.paintOrder = 0
          slot.usedRectFallback = false
          changed = true
        }
        continue
      }

      const sample = orderedSamples[index]
      const projectId = sample.projectId ?? ''
      const projectIndex = Number.isInteger(sample.projectIndex)
        ? sample.projectIndex
        : -1
      const width = Math.max(0, finiteOr(sample.width, 0))
      const height = Math.max(0, finiteOr(sample.height, 0))
      const opacity = clamp01(sample.opacity)
      const reflectionOpacity = clamp01(sample.reflectionOpacity)
      const reflectionBlurTexels = Math.min(
        24,
        Math.max(
          0,
          finiteOr(sample.reflectionBlurTexels ?? 0, 0),
        ),
      )
      const lightOpacity = clamp01(sample.lightOpacity ?? 0)
      const sourceAlphaBottom = Math.min(
        1,
        Math.max(
          0.0001,
          finiteOr(
            sample.sourceAlphaBottom ?? this.#defaultSourceAlphaBottom,
            this.#defaultSourceAlphaBottom,
          ),
        ),
      )
      const paintOrder = finiteOr(sample.paintOrder, index)
      const sourceOpacity = opacity * reflectionOpacity
      const texture = projectId
        ? this.#resolveProjectTexture(projectId)
        : projectIndex >= 0 && projectIndex < this.#projectTextures.length
          ? this.#projectTextures[projectIndex]
          : null
      const textureImage = texture?.image as
        | { width?: number; height?: number }
        | undefined
      const textureWidth = Math.max(1, finiteOr(textureImage?.width ?? 0, 1))
      const textureHeight = Math.max(1, finiteOr(textureImage?.height ?? 0, 1))
      const visible =
        this.#readyForDisplay &&
        !this.#contextLost &&
        texture !== null &&
        width > 0 &&
        height > 0 &&
        sourceOpacity > 0

      if (slot.carouselKey !== sample.carouselKey) {
        slot.carouselKey = sample.carouselKey
        changed = true
      }
      if (slot.projectIndex !== projectIndex) {
        slot.projectIndex = projectIndex
        changed = true
      }
      if (slot.projectId !== projectId) {
        slot.projectId = projectId
        changed = true
      }
      if (slot.width !== width || slot.height !== height) {
        slot.width = width
        slot.height = height
        slot.cardSize.set(width, height)
        changed = true
      }
      if (slot.opacity !== opacity || slot.reflectionOpacity !== reflectionOpacity) {
        slot.opacity = opacity
        slot.reflectionOpacity = reflectionOpacity
        slot.sourceOpacityUniform.value = sourceOpacity
        changed = true
      }
      if (slot.reflectionBlurTexels !== reflectionBlurTexels) {
        slot.reflectionBlurTexels = reflectionBlurTexels
        slot.sourceBaseBlurTexelsUniform.value = reflectionBlurTexels
        changed = true
      }
      if (slot.lightOpacity !== lightOpacity) {
        slot.lightOpacity = lightOpacity
        slot.sourceLightOpacityUniform.value = lightOpacity
        changed = true
      }
      if (slot.sourceAlphaBottomUniform.value !== sourceAlphaBottom) {
        slot.sourceAlphaBottomUniform.value = sourceAlphaBottom
        changed = true
      }
      if (slot.paintOrder !== paintOrder) {
        slot.paintOrder = paintOrder
        changed = true
      }
      if (slot.usedRectFallback !== sample.usedRectFallback) {
        slot.usedRectFallback = sample.usedRectFallback
        changed = true
      }
      if (!slot.reflectionMatrix.equals(sample.reflectionMatrix)) {
        slot.reflectionMatrix.copy(sample.reflectionMatrix)
        changed = true
      }
      if (slot.cardTextureUniform.value !== texture) {
        slot.cardTextureUniform.value = texture
        changed = true
      }
      const nextTexelX = 1 / textureWidth
      const nextTexelY = 1 / textureHeight
      if (slot.cardTexelSize.x !== nextTexelX || slot.cardTexelSize.y !== nextTexelY) {
        slot.cardTexelSize.set(nextTexelX, nextTexelY)
        changed = true
      }
      if (slot.mesh.visible !== visible) {
        slot.mesh.visible = visible
        changed = true
      }
    }

    this.#sourceCount = nextSourceCount
    this.#refreshVisibleSourceCount()
    this.#syncInvalidated = false
    if (changed) this.#refreshSignatures()
    return changed
  }

  render(timeSeconds: number): void {
    if (this.#disposed || this.#contextLost) return
    void timeSeconds

    if (!this.#readyForDisplay) {
      this.#renderer.setRenderTarget(null)
      this.#renderer.clear(true, true, true)
      return
    }

    this.#renderer.setRenderTarget(this.#target)
    this.#renderer.clear(true, true, true)
    this.#renderer.render(this.#sourceScene, this.#sourceCamera)

    this.#renderer.setRenderTarget(null)
    this.#renderer.clear(true, true, true)
    this.#renderer.render(this.#compositeScene, this.#compositeCamera)
    this.#renderCount += 1
  }

  whenReady(): Promise<void> {
    return this.#ready
  }

  get diagnostics(): IceReflectionDiagnostics {
    const missingTextureProjectIds = new Set<string>()
    for (let index = 0; index < this.#sourceCount; index += 1) {
      const slot = this.#sourceSlots[index]
      if (slot.projectId && slot.cardTextureUniform.value === null) {
        missingTextureProjectIds.add(slot.projectId)
      }
    }
    return {
      renderCount: this.#renderCount,
      rendererCount: this.#disposed ? 0 : 1,
      targetCount: this.#disposed ? 0 : 1,
      targetWidth: this.#disposed ? 0 : this.#targetWidth,
      targetHeight: this.#disposed ? 0 : this.#targetHeight,
      sourceCapacity: this.#disposed ? 0 : this.#sourceCapacity,
      sourceCount: this.#sourceCount,
      visibleSourceCount: this.#visibleSourceCount,
      sourceSignature: this.#sourceSignature,
      projectionSignature: this.#projectionSignature,
      surfaceKey: this.#surfaceKey,
      textureCount: this.#textureCache.size,
      missingTextureProjectIds: [...missingTextureProjectIds],
      textureErrorProjectIds: [...this.#projectTextureErrors.keys()],
      ready: this.#readyForDisplay,
      contextLost: this.#contextLost,
    }
  }

  dispose(): void {
    this.#beginDispose(false)
  }

  disposeDeferred(): void {
    this.#beginDispose(true)
  }

  #beginDispose(deferResourceRelease: boolean): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#settleSourceLightReady?.()
    this.#settleSourceLightReady = null
    this.#sourceCount = 0
    this.#visibleSourceCount = 0
    this.#readyForDisplay = false
    this.#contextLost = false
    this.#sourceSignature = ''
    this.#projectionSignature = ''

    this.#canvas.removeEventListener('webglcontextlost', this.#handleContextLost)
    this.#canvas.removeEventListener('webglcontextrestored', this.#handleContextRestored)

    const releaseResources = () => {
      for (let index = 0; index < this.#sourceSlots.length; index += 1) {
        const slot = this.#sourceSlots[index]
        slot.mesh.visible = false
        slot.material.dispose()
      }
      this.#sourceGeometry.dispose()
      this.#compositeGeometry.dispose()
      this.#compositeMaterial.dispose()
      this.#target.dispose()
      this.#customSurfaceDataTexture?.dispose()
      this.#customSurfaceDataTexture = null
      this.#defaultSurfaceDataTexture.dispose()
      this.#sourceLightTexture.dispose()
      this.#textureCache.dispose()
      this.#projectTextureOverridesById.forEach((texture) => texture.dispose())
      this.#projectTextureOverridesById.clear()
      this.#projectTexturesById.clear()
      this.#projectTextureRequestVersions.clear()
      this.#projectTextureErrors.clear()
      this.#sourceScene.clear()
      this.#compositeScene.clear()
      this.#renderer.setRenderTarget(null)
      this.#renderer.dispose()
      this.#renderer.forceContextLoss()
    }

    if (!deferResourceRelease) {
      releaseResources()
      return
    }

    window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(releaseResources, { timeout: 1400 })
      } else {
        releaseResources()
      }
    }, 620)
  }

  #updateVisibility(): void {
    const displayEnabled = this.#readyForDisplay && !this.#contextLost
    this.#compositeMesh.visible = displayEnabled
    let visibleSourceCount = 0
    for (let index = 0; index < this.#sourceSlots.length; index += 1) {
      const slot = this.#sourceSlots[index]
      const visible =
        displayEnabled &&
        index < this.#sourceCount &&
        slot.cardTextureUniform.value !== null &&
        slot.width > 0 &&
        slot.height > 0 &&
        slot.sourceOpacityUniform.value > 0
      slot.mesh.visible = visible
      if (visible) visibleSourceCount += 1
    }
    this.#visibleSourceCount = visibleSourceCount
  }

  #refreshVisibleSourceCount(): void {
    let visibleSourceCount = 0
    for (let index = 0; index < this.#sourceSlots.length; index += 1) {
      if (this.#sourceSlots[index].mesh.visible) visibleSourceCount += 1
    }
    this.#visibleSourceCount = visibleSourceCount
  }

  #refreshSignatures(): void {
    let sourceHash = hashNumber(HASH_OFFSET, this.#sourceCount)
    let projectionHash = hashNumber(HASH_OFFSET, this.#viewportWidth)
    projectionHash = hashNumber(projectionHash, this.#viewportHeight)
    projectionHash = hashNumber(projectionHash, this.#cameraYawUniform.value)
    projectionHash = hashNumber(projectionHash, this.#cameraPitchUniform.value)

    for (let index = 0; index < this.#sourceCount; index += 1) {
      const slot = this.#sourceSlots[index]
      sourceHash = hashString(sourceHash, slot.carouselKey)
      sourceHash = hashString(sourceHash, slot.projectId)
      sourceHash = hashNumber(sourceHash, slot.projectIndex)
      sourceHash = hashNumber(sourceHash, slot.cardTextureUniform.value ? 1 : 0)
      projectionHash = hashNumber(projectionHash, slot.width)
      projectionHash = hashNumber(projectionHash, slot.height)
      projectionHash = hashNumber(projectionHash, slot.opacity)
      projectionHash = hashNumber(projectionHash, slot.reflectionOpacity)
      projectionHash = hashNumber(
        projectionHash,
        slot.reflectionBlurTexels,
      )
      projectionHash = hashNumber(projectionHash, slot.lightOpacity)
      projectionHash = hashNumber(
        projectionHash,
        slot.sourceAlphaBottomUniform.value,
      )
      projectionHash = hashNumber(projectionHash, slot.paintOrder)
      projectionHash = hashNumber(projectionHash, slot.usedRectFallback ? 1 : 0)
      const elements = slot.reflectionMatrix.elements
      for (let matrixIndex = 0; matrixIndex < 16; matrixIndex += 1) {
        projectionHash = hashNumber(projectionHash, elements[matrixIndex])
      }
    }

    this.#sourceSignature =
      this.#sourceCount === 0
        ? ''
        : `${this.#sourceCount}:${sourceHash.toString(36)}`
    this.#projectionSignature = `${this.#viewportWidth}x${this.#viewportHeight}:${projectionHash.toString(36)}`
  }

  #applyMaterialTint(materialTint?: string): boolean {
    const normalizedTint = normalizeMaterialTint(materialTint)
    if (normalizedTint === this.#materialTint) return false

    const tintRgb = materialTintToRgb(normalizedTint)

    this.#materialTint = normalizedTint
    this.#sourceMaterialTintEnabledUniform.value =
      normalizedTint === ICE_REFLECTION_DEFAULT_MATERIAL_TINT ? 0 : 1
    this.#sourceMaterialTintMidtoneUniform.value.set(
      tintRgb.red,
      tintRgb.green,
      tintRgb.blue,
    )
    return true
  }

  #recordProjectTextureError(projectId: string, error: unknown): void {
    if (error instanceof CardTextureEvictedError) return
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error')
    this.#projectTextureErrors.set(projectId, message)
    this.#syncInvalidated = true
    this.#updateVisibility()
    this.#onInvalidate?.()
  }
}

export const createIceReflectionRenderer = (
  canvas: HTMLCanvasElement,
  projects: readonly Project[],
  options: IceReflectionRendererOptions,
): IceReflectionRenderer | null => {
  try {
    return new IceReflectionRenderer(canvas, projects, options)
  } catch (error) {
    console.error('[Aurora reflection] Unable to create renderer', error)
    return null
  }
}
