export const MEDIA_COLOR_PRESETS = [
  {
    id: 'original',
    label: '原始',
    cssFilter: 'brightness(1)',
  },
  {
    id: 'rec709-standard',
    label: '709 标准',
    cssFilter: 'brightness(0.98) contrast(1.35) saturate(1.18)',
  },
  {
    id: 'rec709-soft',
    label: '709 柔和',
    cssFilter: 'brightness(1.02) contrast(1.2) saturate(1.08)',
  },
  {
    id: 'rec709-warm',
    label: '709 暖调',
    cssFilter:
      'brightness(1) contrast(1.27) saturate(1.16) sepia(0.08) hue-rotate(-4deg)',
  },
  {
    id: 'rec709-cool',
    label: '709 冷调',
    cssFilter: 'brightness(1) contrast(1.28) saturate(1.08) hue-rotate(8deg)',
  },
] as const

export type MediaColorPresetId = (typeof MEDIA_COLOR_PRESETS)[number]['id']

const MEDIA_COLOR_PRESET_IDS = new Set<MediaColorPresetId>(
  MEDIA_COLOR_PRESETS.map((preset) => preset.id),
)

export function isMediaColorPresetId(
  value: unknown,
): value is MediaColorPresetId {
  return (
    typeof value === 'string' &&
    MEDIA_COLOR_PRESET_IDS.has(value as MediaColorPresetId)
  )
}

export function normalizeMediaColorPresetId(
  value: unknown,
): MediaColorPresetId {
  return isMediaColorPresetId(value) ? value : 'original'
}

export function getMediaColorPreset(value: unknown) {
  const id = normalizeMediaColorPresetId(value)
  return MEDIA_COLOR_PRESETS.find((preset) => preset.id === id)!
}

export function getNextMediaColorPresetId(
  value: unknown,
): MediaColorPresetId {
  const currentId = normalizeMediaColorPresetId(value)
  const currentIndex = MEDIA_COLOR_PRESETS.findIndex(
    (preset) => preset.id === currentId,
  )
  return MEDIA_COLOR_PRESETS[(currentIndex + 1) % MEDIA_COLOR_PRESETS.length].id
}

export function combineMediaColorFilters(
  ...filters: Array<string | null | undefined>
) {
  const combined = filters
    .map((filter) => filter?.trim() ?? '')
    .filter((filter) => filter && filter !== 'none')
    .join(' ')
  return combined || 'none'
}
