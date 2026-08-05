export const AURORA_LAYOUT_REFERENCE = Object.freeze({ width: 1706, height: 956 })
export const AURORA_TOPBAR_CENTER_Y = 46

export interface ViewportSize {
  width: number
  height: number
}

export interface LayoutInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface LayoutRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface ResponsiveMetrics extends ViewportSize {
  layoutScale: number
  planeLeft: number
  planeTop: number
  planeRight: number
  planeBottom: number
  planeWidth: number
  planeHeight: number
  rightInset: number
  bottomInset: number
}

export const clampLayoutValue = (value: number, minimum: number, maximum: number) =>
  Number.isNaN(value) ? minimum : Math.min(maximum, Math.max(minimum, value))

export const roundLayoutValue = (value: number) =>
  Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0
export const cssPx = (value: number) => `${roundLayoutValue(value)}px`

const normalizeViewportDimension = (value: number) =>
  Number.isFinite(value) && value >= 1 ? value : 1

const normalizeLayoutInset = (value: number) =>
  Number.isFinite(value) && value >= 0 ? value : 0

export function resolveSafeRect(viewport: ViewportSize, insets: LayoutInsets): LayoutRect {
  const width = normalizeViewportDimension(viewport.width)
  const height = normalizeViewportDimension(viewport.height)
  const left = clampLayoutValue(normalizeLayoutInset(insets.left), 0, width)
  const top = clampLayoutValue(normalizeLayoutInset(insets.top), 0, height)
  const right = clampLayoutValue(width - normalizeLayoutInset(insets.right), left, width)
  const bottom = clampLayoutValue(height - normalizeLayoutInset(insets.bottom), top, height)
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

export function resolveResponsiveMetrics(viewport: ViewportSize): ResponsiveMetrics {
  const width = normalizeViewportDimension(viewport.width)
  const height = normalizeViewportDimension(viewport.height)
  const widthScale = width / AURORA_LAYOUT_REFERENCE.width
  const heightScale = height / AURORA_LAYOUT_REFERENCE.height
  const widthConstrained = widthScale <= heightScale
  const viewportScale = widthConstrained ? widthScale : heightScale
  const planeWidth = widthConstrained
    ? width
    : AURORA_LAYOUT_REFERENCE.width * viewportScale
  const planeHeight = widthConstrained
    ? AURORA_LAYOUT_REFERENCE.height * viewportScale
    : height
  const planeLeft = widthConstrained ? 0 : (width - planeWidth) / 2
  const planeTop = widthConstrained ? (height - planeHeight) / 2 : 0
  const planeRight = planeLeft + planeWidth
  const planeBottom = planeTop + planeHeight

  return {
    width,
    height,
    layoutScale: viewportScale,
    planeLeft,
    planeTop,
    planeRight,
    planeBottom,
    planeWidth,
    planeHeight,
    rightInset: width - planeRight,
    bottomInset: height - planeBottom,
  }
}
