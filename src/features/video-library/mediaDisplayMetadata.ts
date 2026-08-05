const STANDARD_RESOLUTION_BADGES = new Map<string, string>([
  ['7680x4320', '8K'],
  ['4096x2160', '4K'],
  ['3840x2160', '4K'],
  ['2560x1440', '1440P'],
  ['2048x1080', '2K'],
  ['1920x1080', '1080P'],
  ['1280x720', '720P'],
  ['720x576', '576P'],
  ['720x480', '480P'],
])

function normalizeDimension(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) return null
  return Math.round(value)
}

function parseResolutionLabel(value: string) {
  const match = value.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return null
  const width = Number.parseInt(match[1], 10)
  const height = Number.parseInt(match[2], 10)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return { width, height }
}

export function getStandardResolutionBadge(
  width: number | null | undefined,
  height: number | null | undefined,
  fallbackResolution = '',
) {
  let normalizedWidth = normalizeDimension(width)
  let normalizedHeight = normalizeDimension(height)

  if (normalizedWidth === null || normalizedHeight === null) {
    const parsed = parseResolutionLabel(fallbackResolution)
    normalizedWidth = parsed?.width ?? null
    normalizedHeight = parsed?.height ?? null
  }

  if (normalizedWidth === null || normalizedHeight === null) return null
  const longEdge = Math.max(normalizedWidth, normalizedHeight)
  const shortEdge = Math.min(normalizedWidth, normalizedHeight)
  return STANDARD_RESOLUTION_BADGES.get(`${longEdge}x${shortEdge}`) ?? null
}

function formatUnitValue(value: number) {
  const fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return value
    .toFixed(fractionDigits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1')
}

export function formatMediaFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '待分析'

  const gibibytes = bytes / 1024 ** 3
  if (gibibytes >= 1) {
    return `${formatUnitValue(gibibytes)} GB`
  }

  const mebibytes = bytes / 1024 ** 2
  if (mebibytes >= 1) {
    return `${formatUnitValue(mebibytes)} MB`
  }

  const kibibytes = Math.max(bytes / 1024, 0.01)
  return `${formatUnitValue(kibibytes)} KB`
}
