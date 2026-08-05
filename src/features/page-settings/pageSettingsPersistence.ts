import type {
  PageBackgroundMedia,
  PageVisualSettings,
} from './PageSettingsPanel'
import { PAGE_SETTINGS_RANGE_DEFAULTS } from './pageSettingsDefaults'
import {
  isParticlePresetId,
  type CustomParticleMedia,
  type HomeParticleSettings,
  type ParticleShape,
} from './particleSettings'

export const APPEARANCE_PAGE_IDS = [
  'gallery',
  'video-library',
  'frame-ring',
  'model-library',
  'model-viewer',
  'online-search',
] as const

export type AppearancePageId = (typeof APPEARANCE_PAGE_IDS)[number]

export const DEFAULT_UI_BORDER_COLOR = '#dcdee4'
export const DEFAULT_MATERIAL_TINT = '#aec5ff'
export const DEFAULT_PARTICLE_COLOR = '#e4f0ff'
export const APPEARANCE_SETTINGS_SCHEMA_VERSION = 2

type MediaUrlResolver = ((filePath: string) => string | null) | undefined

type PersistedParticleMedia = Omit<
  CustomParticleMedia,
  'url' | 'posterUrl' | 'managedPath'
> & {
  managedPath: string
}

type PersistedParticles = Omit<HomeParticleSettings, 'customMedia'> & {
  customMedia: PersistedParticleMedia | null
}

type PersistedPageBackground = {
  kind: 'image' | 'video'
  name: string
  managedPath: string
}

type PersistedPageVisualSettings = Omit<
  PageVisualSettings,
  'background' | 'particles'
> & {
  background: PersistedPageBackground | null
  particles: PersistedParticles
}

export type PersistedAppearanceSettings = {
  schemaVersion: typeof APPEARANCE_SETTINGS_SCHEMA_VERSION
  pages: Record<AppearancePageId, PersistedPageVisualSettings>
}

type LegacyAppearanceSettings = {
  schemaVersion: 1
  galleryParticles: PersistedParticles
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

const clampNumber = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) =>
  Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Number(value)))
    : fallback

export function createDefaultVisualSettings(): PageVisualSettings {
  return {
    background: null,
    contrast: PAGE_SETTINGS_RANGE_DEFAULTS.contrast,
    saturation: PAGE_SETTINGS_RANGE_DEFAULTS.saturation,
    hue: PAGE_SETTINGS_RANGE_DEFAULTS.hue,
    uiBorderColor: DEFAULT_UI_BORDER_COLOR,
    materialTint: DEFAULT_MATERIAL_TINT,
    particles: {
      shape: 'dot',
      customMedia: null,
      color: DEFAULT_PARTICLE_COLOR,
      speed: PAGE_SETTINGS_RANGE_DEFAULTS.particleSpeed,
      size: PAGE_SETTINGS_RANGE_DEFAULTS.particleSize,
      count: PAGE_SETTINGS_RANGE_DEFAULTS.particleCount,
      rotationSpeed: PAGE_SETTINGS_RANGE_DEFAULTS.particleRotationSpeed,
    },
  }
}

export function createDefaultPageSettings(): Record<
  AppearancePageId,
  PageVisualSettings
> {
  return Object.fromEntries(
    APPEARANCE_PAGE_IDS.map((view) => [view, createDefaultVisualSettings()]),
  ) as Record<AppearancePageId, PageVisualSettings>
}

function serializeParticleMedia(
  media: CustomParticleMedia | null,
): PersistedParticleMedia | null {
  if (!media?.managedPath) return null
  return {
    kind: media.kind,
    name: media.name,
    width: media.width,
    height: media.height,
    durationSeconds: media.durationSeconds,
    sizeBytes: media.sizeBytes,
    managedPath: media.managedPath,
    posterPath: media.posterPath,
  }
}

function serializeParticles(settings: HomeParticleSettings): PersistedParticles {
  const customMedia = serializeParticleMedia(settings.customMedia)
  return {
    shape:
      settings.shape === 'custom' && !customMedia ? 'dot' : settings.shape,
    customMedia,
    color: settings.color,
    speed: settings.speed,
    size: settings.size,
    count: settings.count,
    rotationSpeed: settings.rotationSpeed,
  }
}

function serializeBackground(
  background: PageBackgroundMedia,
): PersistedPageBackground | null {
  if (!background?.managedPath) return null
  return {
    kind: background.kind,
    name: background.name,
    managedPath: background.managedPath,
  }
}

export function serializeAppearanceSettings(
  settings: Record<AppearancePageId, PageVisualSettings>,
): PersistedAppearanceSettings {
  return {
    schemaVersion: APPEARANCE_SETTINGS_SCHEMA_VERSION,
    pages: Object.fromEntries(
      APPEARANCE_PAGE_IDS.map((view) => {
        const page = settings[view]
        return [
          view,
          {
            background: serializeBackground(page.background),
            contrast: page.contrast,
            saturation: page.saturation,
            hue: page.hue,
            uiBorderColor: page.uiBorderColor,
            materialTint: page.materialTint,
            particles: serializeParticles(page.particles),
          } satisfies PersistedPageVisualSettings,
        ]
      }),
    ) as Record<AppearancePageId, PersistedPageVisualSettings>,
  }
}

function parseParticleMedia(
  value: unknown,
  getMediaUrl: MediaUrlResolver,
): CustomParticleMedia | null {
  if (
    !isRecord(value) ||
    (value.kind !== 'image' && value.kind !== 'video') ||
    typeof value.name !== 'string' ||
    typeof value.managedPath !== 'string' ||
    value.managedPath.trim() === '' ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height) ||
    !Number.isFinite(value.sizeBytes) ||
    !getMediaUrl
  ) {
    return null
  }

  const url = getMediaUrl(value.managedPath)
  const posterPath = typeof value.posterPath === 'string'
    ? value.posterPath
    : null
  const posterUrl = posterPath ? getMediaUrl(posterPath) : url
  if (!url || !posterUrl) return null

  return {
    kind: value.kind,
    name: value.name.slice(0, 255),
    url,
    posterUrl,
    width: Math.max(1, Math.round(Number(value.width))),
    height: Math.max(1, Math.round(Number(value.height))),
    durationSeconds: Number.isFinite(value.durationSeconds)
      ? Math.max(0, Number(value.durationSeconds))
      : null,
    sizeBytes: Math.max(0, Math.round(Number(value.sizeBytes))),
    managedPath: value.managedPath,
    posterPath,
  }
}

function parseParticles(
  value: unknown,
  getMediaUrl: MediaUrlResolver,
): HomeParticleSettings {
  const defaults = createDefaultVisualSettings().particles
  if (!isRecord(value)) return defaults

  const customMedia = parseParticleMedia(value.customMedia, getMediaUrl)
  const rawShape = value.shape
  const shape: ParticleShape =
    rawShape === 'custom' && customMedia
      ? 'custom'
      : isParticlePresetId(rawShape)
        ? rawShape
        : defaults.shape

  return {
    shape,
    customMedia,
    color: isHexColor(value.color) ? value.color : defaults.color,
    speed: clampNumber(value.speed, defaults.speed, 0.5, 2),
    size: clampNumber(value.size, defaults.size, 0.5, 2),
    count: Math.round(clampNumber(value.count, defaults.count, 0, 160)),
    rotationSpeed: clampNumber(
      value.rotationSpeed,
      defaults.rotationSpeed,
      -2,
      2,
    ),
  }
}

function parseBackground(
  value: unknown,
  getMediaUrl: MediaUrlResolver,
): PageBackgroundMedia {
  if (
    !isRecord(value) ||
    (value.kind !== 'image' && value.kind !== 'video') ||
    typeof value.name !== 'string' ||
    typeof value.managedPath !== 'string' ||
    value.managedPath.trim() === '' ||
    !getMediaUrl
  ) {
    return null
  }
  const url = getMediaUrl(value.managedPath)
  if (!url) return null
  return {
    kind: value.kind,
    name: value.name.slice(0, 255),
    url,
    managedPath: value.managedPath,
  }
}

function parsePage(
  value: unknown,
  getMediaUrl: MediaUrlResolver,
): PageVisualSettings {
  const defaults = createDefaultVisualSettings()
  if (!isRecord(value)) return defaults
  return {
    background: parseBackground(value.background, getMediaUrl),
    contrast: clampNumber(value.contrast, defaults.contrast, 50, 150),
    saturation: clampNumber(value.saturation, defaults.saturation, 0, 200),
    hue: clampNumber(value.hue, defaults.hue, -180, 180),
    uiBorderColor: isHexColor(value.uiBorderColor)
      ? value.uiBorderColor
      : defaults.uiBorderColor,
    materialTint: isHexColor(value.materialTint)
      ? value.materialTint
      : defaults.materialTint,
    particles: parseParticles(value.particles, getMediaUrl),
  }
}

export function parseAppearanceSettings(
  value: unknown,
  getMediaUrl: MediaUrlResolver,
): Record<AppearancePageId, PageVisualSettings> | null {
  if (!isRecord(value)) return null

  if (value.schemaVersion === 1) {
    const defaults = createDefaultPageSettings()
    defaults.gallery = {
      ...defaults.gallery,
      particles: parseParticles(
        (value as unknown as LegacyAppearanceSettings).galleryParticles,
        getMediaUrl,
      ),
    }
    return defaults
  }

  if (
    value.schemaVersion !== APPEARANCE_SETTINGS_SCHEMA_VERSION ||
    !isRecord(value.pages)
  ) {
    return null
  }
  const pages = value.pages

  return Object.fromEntries(
    APPEARANCE_PAGE_IDS.map((view) => [
      view,
      parsePage(pages[view], getMediaUrl),
    ]),
  ) as Record<AppearancePageId, PageVisualSettings>
}
