export type ModelAssetDimensions = {
  x: number
  y: number
  z: number
}

export type ModelCameraState = {
  position: [number, number, number]
  target: [number, number, number]
}

export const MODEL_ENVIRONMENT_PRESET_IDS = [
  'studio-neutral',
  'studio-soft',
  'outdoor-dawn',
  'city-night',
] as const

export type ModelEnvironmentPresetId =
  (typeof MODEL_ENVIRONMENT_PRESET_IDS)[number]

export const isModelEnvironmentPresetId = (
  value: unknown,
): value is ModelEnvironmentPresetId =>
  typeof value === 'string' &&
  (MODEL_ENVIRONMENT_PRESET_IDS as readonly string[]).includes(value)

/** The format selected by the user before Aurora normalizes it to managed GLB. */
export type ModelAssetFormat = 'glb' | 'obj' | 'fbx'

export function getModelAssetFormatLabel(format: ModelAssetFormat) {
  return format.toUpperCase() as Uppercase<ModelAssetFormat>
}

export type ModelAsset = {
  id: string
  projectId: string
  filename: string
  format: ModelAssetFormat
  sourcePath: string | null
  sizeBytes: number
  importedAt: string
  thumbnail: string | null
  favorite: boolean
  tags: string[]
  note: string
  vertexCount: number | null
  triangleCount: number | null
  nodeCount: number | null
  materialCount: number | null
  textureCount: number | null
  dimensions: ModelAssetDimensions | null
  camera: ModelCameraState | null
  environmentPresetId?: ModelEnvironmentPresetId | null
}

type ModelImportIdentity = Pick<
  ModelAsset,
  'projectId' | 'filename' | 'format' | 'sizeBytes'
>

/**
 * GLB bytes fully determine the imported runtime asset. OBJ/FBX imports also
 * depend on companion materials/textures, so source name and size alone must
 * never suppress a new conversion.
 */
export function isDuplicateModelImport(
  assets: readonly ModelImportIdentity[],
  candidate: ModelImportIdentity,
) {
  return candidate.format === 'glb' && assets.some(
    (asset) =>
      asset.projectId === candidate.projectId &&
      asset.filename === candidate.filename &&
      asset.format === candidate.format &&
      asset.sizeBytes === candidate.sizeBytes,
  )
}

export type PreparedModelAsset = Pick<
  ModelAsset,
  | 'thumbnail'
  | 'vertexCount'
  | 'triangleCount'
  | 'nodeCount'
  | 'materialCount'
  | 'textureCount'
  | 'dimensions'
>
