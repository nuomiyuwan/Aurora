import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  LoadingManager,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { Material } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { TGALoader } from 'three/addons/loaders/TGALoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'
import type {
  ModelAssetFormat,
  ModelAssetDimensions,
  PreparedModelAsset,
} from '../../data/modelLibraryTypes'

export const MODEL_ASSET_MAX_BYTES = 500 * 1024 * 1024
export const MODEL_ASSET_WARNING_BYTES = 200 * 1024 * 1024
export const MODEL_ASSET_TRIANGLE_WARNING = 2_000_000
export const MODEL_ASSET_TRIANGLE_LIMIT = 5_000_000

const GLB_MAGIC = 0x46546c67
const MODEL_FILE_PATTERN = /\.(glb|obj|fbx)$/i
const MTL_FILE_PATTERN = /\.mtl$/i
const MODEL_DEPENDENCY_PATTERN =
  /\.(?:mtl|png|jpe?g|webp|avif|bmp|gif|tga)$/i
const DEPENDENCY_LOAD_TIMEOUT_MS = 20_000

export type NormalizedModelImport = {
  sourceFile: File
  sourceFormat: ModelAssetFormat
  runtimeFile: File
  converted: boolean
}

export function getModelSourceFormat(filename: string): ModelAssetFormat | null {
  const match = filename.trim().match(MODEL_FILE_PATTERN)
  return match ? (match[1].toLocaleLowerCase() as ModelAssetFormat) : null
}

export function isSupportedModelFile(file: Pick<File, 'name'>) {
  return getModelSourceFormat(file.name) !== null
}

function formatLabel(format: ModelAssetFormat) {
  return format.toUpperCase()
}

async function validateConvertibleModelFile(
  file: File,
  format: Exclude<ModelAssetFormat, 'glb'>,
) {
  if (file.size <= 0) {
    throw new Error(`${formatLabel(format)} 文件内容为空。`)
  }
  if (file.size > MODEL_ASSET_MAX_BYTES) {
    throw new Error(`${formatLabel(format)} 文件超过 500 MB 的导入上限。`)
  }
}

export async function validateGlbFile(file: File) {
  if (!/\.glb$/i.test(file.name)) {
    throw new Error('当前三维项目仅支持 GLB 文件。')
  }
  if (file.size <= 12) throw new Error('GLB 文件内容不完整。')
  if (file.size > MODEL_ASSET_MAX_BYTES) {
    throw new Error('GLB 文件超过 500 MB 的导入上限。')
  }

  const header = new DataView(await file.slice(0, 12).arrayBuffer())
  const magic = header.getUint32(0, true)
  const version = header.getUint32(4, true)
  const declaredLength = header.getUint32(8, true)
  if (magic !== GLB_MAGIC || version !== 2) {
    throw new Error('文件不是有效的 glTF 2.0 GLB。')
  }
  if (declaredLength !== file.size) {
    throw new Error('GLB 文件长度校验失败，文件可能不完整。')
  }
}

function normalizeDependencyKey(
  value: string,
  preserveLeadingParents = false,
) {
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // Keep malformed-but-usable authoring paths available for basename lookup.
  }
  if (/^(?:https?|file):/i.test(decoded)) {
    try {
      decoded = new URL(decoded).pathname
    } catch {
      // The strict resolver below will report a useful missing dependency.
    }
  }
  const segments: string[] = []
  for (const segment of decoded
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/')
    .split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') {
        segments.pop()
      } else if (preserveLeadingParents) {
        segments.push(segment)
      }
      continue
    }
    segments.push(segment)
  }
  return segments.join('/').toLocaleLowerCase()
}

function dependencyBasename(value: string) {
  const normalized = normalizeDependencyKey(value)
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

class ModelDependencyResolutionError extends Error {
  readonly kind: 'missing' | 'conflict'

  constructor(
    kind: 'missing' | 'conflict',
    message: string,
  ) {
    super(message)
    this.kind = kind
    this.name = 'ModelDependencyResolutionError'
  }
}

function appendFileCandidate(
  candidates: Map<string, File[]>,
  key: string,
  file: File,
) {
  if (!key) return
  const matches = candidates.get(key) ?? []
  if (!matches.includes(file)) matches.push(file)
  candidates.set(key, matches)
}

function selectedRelativePath(file: File) {
  return normalizeDependencyKey(
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '',
  )
}

function createModelDependencyResolver(
  files: readonly File[],
  sourceFile: File,
) {
  const urls = new Map<File, string>()
  const filesByPath = new Map<string, File[]>()
  const filesByBasename = new Map<string, File[]>()
  for (const file of files) {
    const relativePath = selectedRelativePath(file)
    if (relativePath) appendFileCandidate(filesByPath, relativePath, file)
    appendFileCandidate(
      filesByBasename,
      dependencyBasename(file.name),
      file,
    )
  }

  const sourcePath = selectedRelativePath(sourceFile)
  const sourceDirectory = sourcePath.includes('/')
    ? sourcePath.slice(0, sourcePath.lastIndexOf('/'))
    : ''

  const urlForFile = (file: File) => {
    const current = urls.get(file)
    if (current) return current
    const next = URL.createObjectURL(file)
    urls.set(file, next)
    return next
  }

  const selectExact = (key: string, requestedUrl: string) => {
    const matches = filesByPath.get(key) ?? []
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      throw new ModelDependencyResolutionError(
        'conflict',
        `模型依赖路径冲突：${requestedUrl}。请只保留一个对应文件。`,
      )
    }
    return null
  }

  const findFile = (requestedUrl: string) => {
    const key = normalizeDependencyKey(requestedUrl)
    const isAbsoluteResource = /^(?:https?|file):/i.test(requestedUrl)
    if (!isAbsoluteResource && sourceDirectory) {
      const sourceRelativeKey = normalizeDependencyKey(requestedUrl, true)
      const sourceRelative = normalizeDependencyKey(
        `${sourceDirectory}/${sourceRelativeKey}`,
      )
      const sourceMatch = selectExact(sourceRelative, requestedUrl)
      if (sourceMatch) return sourceMatch
    }
    const exactMatch = selectExact(key, requestedUrl)
    if (exactMatch) return exactMatch

    const basename = dependencyBasename(key)
    const basenameMatches = filesByBasename.get(basename) ?? []
    if (basenameMatches.length === 1) return basenameMatches[0]
    if (basenameMatches.length > 1) {
      throw new ModelDependencyResolutionError(
        'conflict',
        `模型依赖文件名冲突：${basename}。请保留相对目录后重新选择，或移除重名文件。`,
      )
    }
    throw new ModelDependencyResolutionError(
      'missing',
      `未在同一批次中选择模型依赖：${requestedUrl}。`,
    )
  }

  return {
    findFile,
    resolve(url: string) {
      if (/^(?:blob:|data:)/i.test(url)) return url
      return urlForFile(findFile(url))
    },
    describe(url: string) {
      for (const [file, objectUrl] of urls) {
        if (objectUrl === url) return file.name
      }
      return dependencyBasename(url) || url
    },
    dispose() {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    },
  }
}

async function waitForManagedDependencies<T>(
  manager: LoadingManager,
  start: () => T | Promise<T>,
  describeDependency: (url: string) => string,
) {
  let started = false
  let resolveLoaded: (() => void) | null = null
  let rejectLoaded: ((reason: Error) => void) | null = null
  const loaded = new Promise<void>((resolve, reject) => {
    resolveLoaded = resolve
    rejectLoaded = reject
  })
  manager.onStart = () => {
    started = true
  }
  manager.onLoad = () => resolveLoaded?.()
  manager.onError = (url) => {
    rejectLoaded?.(
      new Error(`模型依赖加载失败：${describeDependency(url)}。请确认文件可读取且格式受支持。`),
    )
  }

  const result = await start()
  await Promise.resolve()
  if (!started) return result

  let timeout: number | undefined
  try {
    await Promise.race([
      loaded,
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          reject(new Error('模型依赖贴图加载超时，请确认依赖文件已在同一批次中选择。'))
        }, DEPENDENCY_LOAD_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
  return result
}

function referencedMtlFiles(
  objText: string,
  files: readonly File[],
  resolver: ReturnType<typeof createModelDependencyResolver>,
) {
  const references = Array.from(
    objText.matchAll(/^\s*mtllib\s+(.+?)\s*$/gim),
    (match) => match[1].trim(),
  )
  const materials = files.filter((file) => MTL_FILE_PATTERN.test(file.name))
  if (references.length === 0) return materials.length === 1 ? materials : []
  const matches = new Set<File>()
  for (const reference of references) {
    try {
      matches.add(resolver.findFile(reference))
    } catch (error) {
      if (
        !(error instanceof ModelDependencyResolutionError) ||
        error.kind !== 'missing'
      ) {
        throw error
      }
      const multipleReferences = reference
        .split(/\s+/)
        .filter((candidate) => MTL_FILE_PATTERN.test(candidate))
      if (multipleReferences.length <= 1) throw error
      multipleReferences.forEach((candidate) => {
        matches.add(resolver.findFile(candidate))
      })
    }
  }
  for (const material of matches) {
    if (!MTL_FILE_PATTERN.test(material.name)) {
      throw new Error(`OBJ 的 mtllib 依赖不是 MTL 文件：${material.name}。`)
    }
  }
  return Array.from(matches)
}

async function parseObjModel(
  file: File,
  files: readonly File[],
  manager: LoadingManager,
  resolver: ReturnType<typeof createModelDependencyResolver>,
) {
  const objText = await file.text()
  const objLoader = new OBJLoader(manager)
  const materialFiles = referencedMtlFiles(objText, files, resolver)
  if (materialFiles.length > 0) {
    const materialText = (
      await Promise.all(materialFiles.map((material) => material.text()))
    ).join('\n')
    const materials = new MTLLoader(manager).parse(materialText, '')
    await waitForManagedDependencies(
      manager,
      () => materials.preload(),
      resolver.describe,
    )
    objLoader.setMaterials(materials)
  }
  return objLoader.parse(objText)
}

async function parseFbxModel(
  file: File,
  manager: LoadingManager,
  resolver: ReturnType<typeof createModelDependencyResolver>,
) {
  const buffer = await file.arrayBuffer()
  return waitForManagedDependencies(
    manager,
    () => new FBXLoader(manager).parse(buffer, ''),
    resolver.describe,
  )
}

async function convertModelToGlb(
  sourceFile: File,
  sourceFormat: Exclude<ModelAssetFormat, 'glb'>,
  companionFiles: readonly File[],
) {
  await validateConvertibleModelFile(sourceFile, sourceFormat)
  const dependencies = Array.from(
    new Set(
      companionFiles.filter(
        (file) =>
          file !== sourceFile &&
          !isSupportedModelFile(file) &&
          MODEL_DEPENDENCY_PATTERN.test(file.name),
      ),
    ),
  )
  const batchSizeBytes = dependencies.reduce(
    (total, dependency) => total + dependency.size,
    sourceFile.size,
  )
  if (batchSizeBytes > MODEL_ASSET_MAX_BYTES) {
    throw new Error(
      `${formatLabel(sourceFormat)} 与同批依赖文件合计超过 500 MB 的导入上限。`,
    )
  }
  for (const dependency of dependencies) {
    if (dependency.size > MODEL_ASSET_MAX_BYTES) {
      throw new Error(`依赖文件 ${dependency.name} 超过 500 MB 的导入上限。`)
    }
  }

  const resolver = createModelDependencyResolver(dependencies, sourceFile)
  const manager = new LoadingManager()
  manager.addHandler(/\.tga(?:$|[?#])/i, new TGALoader(manager))
  manager.setURLModifier((url) => resolver.resolve(url))
  let root: Object3D | null = null
  try {
    root = sourceFormat === 'obj'
      ? await parseObjModel(sourceFile, dependencies, manager, resolver)
      : await parseFbxModel(sourceFile, manager, resolver)
    const metadata = collectModelAssetMetadata(root)
    if (
      metadata.triangleCount !== null &&
      metadata.triangleCount > MODEL_ASSET_TRIANGLE_LIMIT
    ) {
      throw new Error('模型超过 500 万三角面，已停止导入以保护渲染性能。')
    }

    const exported = await new GLTFExporter().parseAsync(root, {
      animations: root.animations,
      binary: true,
      embedImages: true,
      forceIndices: true,
      onlyVisible: false,
    })
    if (!(exported instanceof ArrayBuffer)) {
      throw new Error('模型转换未生成二进制 GLB。')
    }
    const runtimeName = `${sourceFile.name.replace(/\.[^.]+$/, '')}.glb`
    const runtimeFile = new File([exported], runtimeName, {
      type: 'model/gltf-binary',
      lastModified: sourceFile.lastModified,
    })
    await validateGlbFile(runtimeFile)
    return runtimeFile
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('500 万三角面') ||
        error.message.includes('500 MB') ||
        error.message.includes('依赖贴图加载超时'))
    ) {
      throw error
    }
    const detail = error instanceof Error ? `：${error.message}` : ''
    throw new Error(`${formatLabel(sourceFormat)} 模型解析或转换失败${detail}`)
  } finally {
    resolver.dispose()
    if (root) disposeModelRoot(root)
  }
}

/**
 * Keeps native GLB untouched and normalizes OBJ/FBX into the same managed GLB
 * runtime contract used by the existing viewer.
 */
export async function normalizeModelImport(
  sourceFile: File,
  companionFiles: readonly File[],
): Promise<NormalizedModelImport> {
  const sourceFormat = getModelSourceFormat(sourceFile.name)
  if (!sourceFormat) {
    throw new Error('请选择 GLB、OBJ 或 FBX 三维文件。')
  }
  if (sourceFormat === 'glb') {
    await validateGlbFile(sourceFile)
    return {
      sourceFile,
      sourceFormat,
      runtimeFile: sourceFile,
      converted: false,
    }
  }
  const runtimeFile = await convertModelToGlb(
    sourceFile,
    sourceFormat,
    companionFiles,
  )
  return {
    sourceFile,
    sourceFormat,
    runtimeFile,
    converted: true,
  }
}

export function createModelLoader() {
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath(
    resolveDocumentAssetUrl('./aurora/draco/'),
  )
  const loader = new GLTFLoader()
  loader.setDRACOLoader(dracoLoader)
  loader.setMeshoptDecoder(MeshoptDecoder)
  return { loader, dracoLoader }
}

export function installModelStudioEnvironment(
  renderer: WebGLRenderer,
  scene: Scene,
) {
  const environmentScene = new RoomEnvironment()
  const generator = new PMREMGenerator(renderer)
  const environmentTarget = generator.fromScene(environmentScene, 0.04)
  environmentScene.dispose()
  generator.dispose()
  scene.environment = environmentTarget.texture

  const hemisphere = new HemisphereLight(0xc7dcff, 0x0b1018, 0.5)
  const key = new DirectionalLight(0xe3edff, 0.9)
  key.position.set(6, 8, 5)
  const rim = new DirectionalLight(0x6e9dff, 0.55)
  rim.position.set(-6, 3, -5)
  scene.add(hemisphere, key, rim)

  return () => {
    if (scene.environment === environmentTarget.texture) scene.environment = null
    scene.remove(hemisphere, key, rim)
    environmentTarget.dispose()
  }
}

function materialList(material: Material | Material[]) {
  return Array.isArray(material) ? material : [material]
}

export function collectModelAssetMetadata(root: Object3D): Omit<
  PreparedModelAsset,
  'thumbnail'
> {
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  let vertexCount = 0
  let triangleCount = 0
  let nodeCount = 0

  root.traverse((object) => {
    nodeCount += 1
    if (!(object instanceof Mesh)) return
    const position = object.geometry.getAttribute('position')
    vertexCount += position?.count ?? 0
    triangleCount += object.geometry.index
      ? object.geometry.index.count / 3
      : (position?.count ?? 0) / 3
    materialList(object.material).forEach((material) => {
      materials.add(material)
      Object.values(material).forEach((value) => {
        if (value instanceof Texture) textures.add(value)
      })
    })
  })

  const bounds = new Box3().setFromObject(root)
  const size = bounds.isEmpty()
    ? new Vector3()
    : bounds.getSize(new Vector3())
  const dimensions: ModelAssetDimensions = {
    x: size.x,
    y: size.y,
    z: size.z,
  }

  return {
    vertexCount: Math.round(vertexCount),
    triangleCount: Math.round(triangleCount),
    nodeCount,
    materialCount: materials.size,
    textureCount: textures.size,
    dimensions,
  }
}

export function disposeModelRoot(root: Object3D) {
  const disposedMaterials = new Set<Material>()
  const disposedTextures = new Set<Texture>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    materialList(object.material).forEach((material) => {
      if (disposedMaterials.has(material)) return
      disposedMaterials.add(material)
      Object.values(material).forEach((value) => {
        if (!(value instanceof Texture) || disposedTextures.has(value)) return
        disposedTextures.add(value)
        value.dispose()
        const image = value.image as { close?: () => void } | undefined
        image?.close?.()
      })
      material.dispose()
    })
  })
}

export function frameCameraForObject(
  root: Object3D,
  camera: PerspectiveCamera,
  target: Vector3,
) {
  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(root)
  const center = bounds.isEmpty()
    ? new Vector3()
    : bounds.getCenter(new Vector3())
  const size = bounds.isEmpty()
    ? new Vector3(1, 1, 1)
    : bounds.getSize(new Vector3())
  const radius = Math.max(size.length() * 0.5, 0.5)
  target.copy(center)
  const halfFov = MathUtils.degToRad(camera.fov * 0.5)
  const distance = (radius / Math.tan(halfFov)) * 1.25
  camera.near = Math.max(distance / 1000, 0.001)
  camera.far = Math.max(distance * 100, 100)
  camera.position.set(
    center.x + distance * 0.86,
    center.y + distance * 0.5,
    center.z + distance * 0.86,
  )
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  return { bounds, center, size, radius, distance }
}

export async function prepareModelAsset(url: string): Promise<PreparedModelAsset> {
  const { loader, dracoLoader } = createModelLoader()
  let root: Object3D | null = null
  try {
    const gltf = await loader.loadAsync(url)
    root = gltf.scene
    const metadata = collectModelAssetMetadata(root)
    if (
      metadata.triangleCount !== null &&
      metadata.triangleCount > MODEL_ASSET_TRIANGLE_LIMIT
    ) {
      throw new Error('模型超过 500 万三角面，已停止导入以保护渲染性能。')
    }

    let thumbnail: string | null = null
    try {
      const renderer = new WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      })
      renderer.setPixelRatio(1)
      renderer.setSize(720, 450, false)
      renderer.outputColorSpace = SRGBColorSpace
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.toneMappingExposure = 1
      renderer.setClearColor(new Color('#080d16'), 1)

      const scene = new Scene()
      scene.background = new Color('#080d16')
      scene.add(root)
      const disposeStudioEnvironment = installModelStudioEnvironment(renderer, scene)
      const camera = new PerspectiveCamera(34, 720 / 450, 0.01, 1000)
      const target = new Vector3()
      const framing = frameCameraForObject(root, camera, target)
      const floor = new Mesh(
        new PlaneGeometry(framing.radius * 7, framing.radius * 7),
        new MeshStandardMaterial({
          color: 0x0b1320,
          roughness: 0.82,
          metalness: 0.12,
        }),
      )
      floor.rotation.x = -Math.PI / 2
      floor.position.y = framing.bounds.min.y - framing.radius * 0.02
      scene.add(floor)
      renderer.render(scene, camera)
      thumbnail = renderer.domElement.toDataURL('image/webp', 0.88)
      disposeStudioEnvironment()
      floor.geometry.dispose()
      floor.material.dispose()
      renderer.dispose()
      scene.remove(root)
    } catch (error) {
      console.warn('[Aurora model] Thumbnail rendering failed', error)
    }

    return { ...metadata, thumbnail }
  } finally {
    dracoLoader.dispose()
    if (root) disposeModelRoot(root)
  }
}

export function formatModelDimension(value: number) {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}k`
  if (Math.abs(value) >= 10) return value.toFixed(1)
  return value.toFixed(2)
}
