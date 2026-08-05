export const PARTICLE_PRESET_IDS = [
  'dot',
  'dust',
  'bamboo-leaf',
  'leaf',
  'snowflake',
  'maple-leaf',
] as const

export type ParticlePresetId = (typeof PARTICLE_PRESET_IDS)[number]
export type ParticleShape = ParticlePresetId | 'custom'

export type CustomParticleMedia = {
  kind: 'image' | 'video'
  name: string
  url: string
  posterUrl: string
  width: number
  height: number
  durationSeconds: number | null
  sizeBytes: number
  managedPath: string | null
  posterPath: string | null
}

export type HomeParticleSettings = {
  shape: ParticleShape
  customMedia: CustomParticleMedia | null
  color: string
  speed: number
  size: number
  count: number
  rotationSpeed: number
}

export type ParticleImportState =
  | { status: 'idle'; message: null }
  | { status: 'validating'; message: string }
  | { status: 'error'; message: string }

export type ParticlePresetDefinition = {
  id: ParticlePresetId
  label: string
  assetPath: string | null
  visualScale: number
}

export const PARTICLE_PRESETS: readonly ParticlePresetDefinition[] = [
  { id: 'dot', label: '圆点', assetPath: null, visualScale: 1 },
  {
    id: 'dust',
    label: '尘埃',
    assetPath: './aurora/particles/dust.png',
    visualScale: 11,
  },
  {
    id: 'bamboo-leaf',
    label: '竹叶',
    assetPath: './aurora/particles/bamboo-leaf.png',
    visualScale: 8.5,
  },
  {
    id: 'leaf',
    label: '树叶',
    assetPath: './aurora/particles/leaf.png',
    visualScale: 8,
  },
  {
    id: 'snowflake',
    label: '雪花',
    assetPath: './aurora/particles/snowflake.png',
    visualScale: 7.5,
  },
  {
    id: 'maple-leaf',
    label: '枫叶',
    assetPath: './aurora/particles/maple-leaf.png',
    visualScale: 8,
  },
] as const

export const PARTICLE_PNG_MAX_BYTES = 8 * 1024 * 1024
export const PARTICLE_VIDEO_SOURCE_MAX_BYTES = 200 * 1024 * 1024
export const PARTICLE_VIDEO_MAX_DURATION_SECONDS = 10
export const PARTICLE_PNG_MAX_EDGE = 1024
export const PARTICLE_VIDEO_MAX_EDGE = 512

export const PARTICLE_IMPORT_LIMIT_HINT =
  'PNG ≤ 8 MB、边长 ≤ 1024；透明视频 ≤ 200 MB / 10 秒'

export const isParticlePresetId = (
  value: unknown,
): value is ParticlePresetId =>
  typeof value === 'string' &&
  (PARTICLE_PRESET_IDS as readonly string[]).includes(value)

export const getParticleVisualScale = (shape: ParticleShape) =>
  shape === 'custom'
    ? 8
    : PARTICLE_PRESETS.find((preset) => preset.id === shape)?.visualScale ?? 1
