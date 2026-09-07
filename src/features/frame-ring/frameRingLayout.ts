import {
  AURORA_LAYOUT_REFERENCE,
  AURORA_TOPBAR_CENTER_Y,
  cssPx,
  resolveResponsiveMetrics,
  roundLayoutValue,
  type LayoutRect,
  type ViewportSize,
} from '../responsive-layout/responsiveLayout'

export const FRAME_RING_LAYOUT_REFERENCE = AURORA_LAYOUT_REFERENCE
export const FRAME_RING_SLOT_REFERENCE_WIDTH = 1280
const FRAME_RING_SEARCH_HEIGHT = 38

const FRAME_RING_PREVIEW_BASE = Object.freeze({
  x: 860,
  y: 68.832,
  z: -380,
  width: 800,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  scale: 1.4,
  reflectionX: 0,
  reflectionY: 30,
})

const FRAME_RING_INFO_BASE = Object.freeze({
  x: 1450,
  y: 100,
  z: -380,
  width: 270,
  height: 405,
  rotateX: 0,
  rotateY: -20,
  rotateZ: 0,
  scale: 1.4,
  reflectionX: 0,
  reflectionY: 0,
})

export const FRAME_RING_BASE_LAYOUT = Object.freeze({
  stage: Object.freeze({
    top: 500,
    right: 78,
    bottom: 192,
    left: 88,
    perspective: 2000,
    perspectiveOriginX: 50,
    perspectiveOriginY: 60,
    rotateX: -10,
  }),
  floating: Object.freeze({
    floorY: 625,
    perspective: 1180,
    perspectiveOriginX: 853,
    perspectiveOriginY: 500,
  }),
  preview: FRAME_RING_PREVIEW_BASE,
  emptyPreview: Object.freeze({
    ...FRAME_RING_PREVIEW_BASE,
    x: FRAME_RING_LAYOUT_REFERENCE.width / 2,
    y: 120,
    scale: 1.5,
  }),
  // Preserve the ready preview's alpha-bottom-to-floor gap after the empty
  // preview moves and scales, so its real WebGL reflection remains attached.
  emptyPreviewFloorY: 696.307,
  info: FRAME_RING_INFO_BASE,
  unindexedTrimInfo: Object.freeze({
    ...FRAME_RING_INFO_BASE,
    y: 124,
  }),
  action: Object.freeze({
    x: 0,
    y: 100,
    z: -380,
    width: 270,
    height: 405,
    rotateX: 0,
    rotateY: 20,
    rotateZ: 0,
    scale: 1.4,
    reflectionX: 0,
    reflectionY: 0,
  }),
  card: Object.freeze({ width: 226.898 }),
  breadcrumb: Object.freeze({ top: AURORA_TOPBAR_CENTER_Y, x: 853 }),
  search: Object.freeze({
    top: AURORA_TOPBAR_CENTER_Y - FRAME_RING_SEARCH_HEIGHT / 2,
    right: 78,
    width: 248,
    height: FRAME_RING_SEARCH_HEIGHT,
  }),
  dragSpacing: 168,
})

interface ResolvedFloatingObject {
  x: number
  y: number
  z: number
  width: number
  rotateX: number
  rotateY: number
  rotateZ: number
  scale: number
  reflectionX: number
  reflectionY: number
}

export interface ResolvedFrameRingLayout {
  viewport: ViewportSize
  layoutScale: number
  slotScale: number
  uiScale: number
  dragSpacing: number
  signature: string
  plane: LayoutRect
  stage: LayoutRect & {
    rightInset: number
    bottomInset: number
    perspective: number
    perspectiveOriginX: number
    perspectiveOriginY: number
    rotateX: number
  }
  floating: {
    floorY: number
    perspective: number
    perspectiveOriginX: number
    perspectiveOriginY: number
  }
  preview: ResolvedFloatingObject
  emptyPreview: ResolvedFloatingObject
  emptyPreviewFloorY: number
  info: ResolvedFloatingObject & { height: number }
  unindexedTrimInfo: ResolvedFloatingObject & { height: number }
  action: ResolvedFloatingObject & { height: number }
  card: { width: number }
  breadcrumb: { top: number; x: number }
  search: { top: number; right: number; width: number; height: number }
}

export type FrameRingCssVariableName =
  | '--frame-ring-layout-scale'
  | '--frame-ring-ui-scale'
  | '--frame-ring-stage-top'
  | '--frame-ring-stage-right-inset'
  | '--frame-ring-stage-bottom-inset'
  | '--frame-ring-stage-left'
  | '--frame-ring-stage-perspective'
  | '--frame-ring-stage-perspective-origin-x'
  | '--frame-ring-stage-perspective-origin-y'
  | '--frame-ring-rotate-x'
  | '--frame-ring-floating-floor-y'
  | '--frame-ring-floating-perspective'
  | '--frame-ring-floating-perspective-origin-x'
  | '--frame-ring-floating-perspective-origin-y'
  | '--frame-ring-preview-x'
  | '--frame-ring-preview-y'
  | '--frame-ring-preview-z'
  | '--frame-ring-preview-width'
  | '--frame-ring-preview-rotate-x'
  | '--frame-ring-preview-rotate-y'
  | '--frame-ring-preview-rotate-z'
  | '--frame-ring-preview-scale'
  | '--frame-ring-preview-reflection-x'
  | '--frame-ring-preview-reflection-y'
  | '--frame-ring-info-x'
  | '--frame-ring-info-y'
  | '--frame-ring-info-z'
  | '--frame-ring-info-width'
  | '--frame-ring-info-height'
  | '--frame-ring-info-rotate-x'
  | '--frame-ring-info-rotate-y'
  | '--frame-ring-info-rotate-z'
  | '--frame-ring-info-scale'
  | '--frame-ring-info-reflection-x'
  | '--frame-ring-info-reflection-y'
  | '--frame-ring-action-x'
  | '--frame-ring-action-y'
  | '--frame-ring-action-z'
  | '--frame-ring-action-width'
  | '--frame-ring-action-height'
  | '--frame-ring-action-rotate-x'
  | '--frame-ring-action-rotate-y'
  | '--frame-ring-action-rotate-z'
  | '--frame-ring-action-scale'
  | '--frame-ring-action-reflection-x'
  | '--frame-ring-action-reflection-y'
  | '--frame-ring-card-width'
  | '--frame-ring-breadcrumb-top'
  | '--frame-ring-breadcrumb-x'
  | '--frame-ring-search-top'
  | '--frame-ring-search-right-inset'
  | '--frame-ring-search-width'
  | '--frame-ring-search-height'

export type FrameRingCssVariables = {
  [Name in FrameRingCssVariableName]: string
}

const scaleValue = (value: number, scale: number) => roundLayoutValue(value * scale)
const cssNumber = (value: number) => `${roundLayoutValue(value)}`
const cssDegrees = (value: number) => `${roundLayoutValue(value)}deg`

const createRect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): LayoutRect => {
  const resolvedLeft = roundLayoutValue(left)
  const resolvedTop = roundLayoutValue(top)
  const resolvedRight = Math.max(resolvedLeft, roundLayoutValue(right))
  const resolvedBottom = Math.max(resolvedTop, roundLayoutValue(bottom))

  return {
    left: resolvedLeft,
    top: resolvedTop,
    right: resolvedRight,
    bottom: resolvedBottom,
    width: roundLayoutValue(resolvedRight - resolvedLeft),
    height: roundLayoutValue(resolvedBottom - resolvedTop),
  }
}

export function resolveFrameRingLayout(viewport: ViewportSize): ResolvedFrameRingLayout {
  const designPlane = resolveResponsiveMetrics(viewport)
  const {
    width,
    height,
    layoutScale: rawLayoutScale,
    planeLeft,
    planeTop,
    planeWidth,
    planeHeight,
  } = designPlane
  const layoutScale = rawLayoutScale
  const plane = createRect(
    planeLeft,
    planeTop,
    planeLeft + planeWidth,
    planeTop + planeHeight,
  )
  const screenX = (value: number) => roundLayoutValue(planeLeft + value * rawLayoutScale)
  const screenY = (value: number) => roundLayoutValue(planeTop + value * rawLayoutScale)
  const rightInset = (value: number) =>
    roundLayoutValue(width - plane.right + value * rawLayoutScale)
  const bottomInset = (value: number) =>
    roundLayoutValue(height - plane.bottom + value * rawLayoutScale)
  const stageLeft = screenX(FRAME_RING_BASE_LAYOUT.stage.left)
  const stageTop = screenY(FRAME_RING_BASE_LAYOUT.stage.top)
  const stageRight = roundLayoutValue(
    plane.right - FRAME_RING_BASE_LAYOUT.stage.right * rawLayoutScale,
  )
  const stageBottom = roundLayoutValue(
    plane.bottom - FRAME_RING_BASE_LAYOUT.stage.bottom * rawLayoutScale,
  )
  const stage = {
    ...createRect(stageLeft, stageTop, stageRight, stageBottom),
    rightInset: rightInset(FRAME_RING_BASE_LAYOUT.stage.right),
    bottomInset: bottomInset(FRAME_RING_BASE_LAYOUT.stage.bottom),
    perspective: scaleValue(FRAME_RING_BASE_LAYOUT.stage.perspective, rawLayoutScale),
    perspectiveOriginX: roundLayoutValue(
      (stageRight - stageLeft) * FRAME_RING_BASE_LAYOUT.stage.perspectiveOriginX / 100,
    ),
    perspectiveOriginY: roundLayoutValue(
      (stageBottom - stageTop) * FRAME_RING_BASE_LAYOUT.stage.perspectiveOriginY / 100,
    ),
    rotateX: FRAME_RING_BASE_LAYOUT.stage.rotateX,
  }
  const resolveFloatingObject = (
    source:
      | typeof FRAME_RING_BASE_LAYOUT.preview
      | typeof FRAME_RING_BASE_LAYOUT.emptyPreview
      | typeof FRAME_RING_BASE_LAYOUT.info
      | typeof FRAME_RING_BASE_LAYOUT.unindexedTrimInfo
      | typeof FRAME_RING_BASE_LAYOUT.action,
  ): ResolvedFloatingObject => ({
    x: screenX(source.x),
    y: screenY(source.y),
    z: scaleValue(source.z, rawLayoutScale),
    width: scaleValue(source.width, rawLayoutScale),
    rotateX: source.rotateX,
    rotateY: source.rotateY,
    rotateZ: source.rotateZ,
    scale: source.scale,
    reflectionX: scaleValue(source.reflectionX, rawLayoutScale),
    reflectionY: scaleValue(source.reflectionY, rawLayoutScale),
  })
  const preview = resolveFloatingObject(FRAME_RING_BASE_LAYOUT.preview)
  const emptyPreview = resolveFloatingObject(FRAME_RING_BASE_LAYOUT.emptyPreview)
  const info = {
    ...resolveFloatingObject(FRAME_RING_BASE_LAYOUT.info),
    height: scaleValue(FRAME_RING_BASE_LAYOUT.info.height, rawLayoutScale),
  }
  const unindexedTrimInfo = {
    ...resolveFloatingObject(FRAME_RING_BASE_LAYOUT.unindexedTrimInfo),
    height: scaleValue(
      FRAME_RING_BASE_LAYOUT.unindexedTrimInfo.height,
      rawLayoutScale,
    ),
  }
  const action = {
    ...resolveFloatingObject(FRAME_RING_BASE_LAYOUT.action),
    height: scaleValue(FRAME_RING_BASE_LAYOUT.action.height, rawLayoutScale),
  }

  return {
    viewport: { width, height },
    layoutScale,
    slotScale:
      (FRAME_RING_LAYOUT_REFERENCE.width / FRAME_RING_SLOT_REFERENCE_WIDTH) * rawLayoutScale,
    uiScale: layoutScale,
    dragSpacing: scaleValue(
      FRAME_RING_BASE_LAYOUT.dragSpacing
        * (FRAME_RING_LAYOUT_REFERENCE.width / FRAME_RING_SLOT_REFERENCE_WIDTH),
      rawLayoutScale,
    ),
    signature: `${roundLayoutValue(width)}x${roundLayoutValue(height)}@${layoutScale}`,
    plane,
    stage,
    floating: {
      floorY: screenY(FRAME_RING_BASE_LAYOUT.floating.floorY),
      perspective: scaleValue(FRAME_RING_BASE_LAYOUT.floating.perspective, rawLayoutScale),
      perspectiveOriginX: screenX(FRAME_RING_BASE_LAYOUT.floating.perspectiveOriginX),
      perspectiveOriginY: screenY(FRAME_RING_BASE_LAYOUT.floating.perspectiveOriginY),
    },
    preview,
    emptyPreview,
    emptyPreviewFloorY: screenY(FRAME_RING_BASE_LAYOUT.emptyPreviewFloorY),
    info,
    unindexedTrimInfo,
    action,
    card: { width: scaleValue(FRAME_RING_BASE_LAYOUT.card.width, rawLayoutScale) },
    breadcrumb: {
      top: screenY(FRAME_RING_BASE_LAYOUT.breadcrumb.top),
      x: screenX(FRAME_RING_BASE_LAYOUT.breadcrumb.x),
    },
    search: {
      top: screenY(FRAME_RING_BASE_LAYOUT.search.top),
      right: rightInset(FRAME_RING_BASE_LAYOUT.search.right),
      width: scaleValue(FRAME_RING_BASE_LAYOUT.search.width, rawLayoutScale),
      height: scaleValue(FRAME_RING_BASE_LAYOUT.search.height, rawLayoutScale),
    },
  }
}

export function getFrameRingCssVariables(
  layout: ResolvedFrameRingLayout,
  options: {
    hasFrameRing?: boolean
    alignInfoToUnindexedTrim?: boolean
  } = {},
): FrameRingCssVariables {
  const hasFrameRing = options.hasFrameRing ?? true
  const preview = hasFrameRing ? layout.preview : layout.emptyPreview
  const info = options.alignInfoToUnindexedTrim
    ? layout.unindexedTrimInfo
    : layout.info
  const floatingFloorY = hasFrameRing
    ? layout.floating.floorY
    : layout.emptyPreviewFloorY

  return {
    '--frame-ring-layout-scale': cssNumber(layout.layoutScale),
    '--frame-ring-ui-scale': cssNumber(layout.uiScale),
    '--frame-ring-stage-top': cssPx(layout.stage.top),
    '--frame-ring-stage-right-inset': cssPx(layout.stage.rightInset),
    '--frame-ring-stage-bottom-inset': cssPx(layout.stage.bottomInset),
    '--frame-ring-stage-left': cssPx(layout.stage.left),
    '--frame-ring-stage-perspective': cssPx(layout.stage.perspective),
    '--frame-ring-stage-perspective-origin-x': cssPx(layout.stage.perspectiveOriginX),
    '--frame-ring-stage-perspective-origin-y': cssPx(layout.stage.perspectiveOriginY),
    '--frame-ring-rotate-x': cssDegrees(layout.stage.rotateX),
    '--frame-ring-floating-floor-y': cssPx(floatingFloorY),
    '--frame-ring-floating-perspective': cssPx(layout.floating.perspective),
    '--frame-ring-floating-perspective-origin-x': cssPx(layout.floating.perspectiveOriginX),
    '--frame-ring-floating-perspective-origin-y': cssPx(layout.floating.perspectiveOriginY),
    '--frame-ring-preview-x': cssPx(preview.x),
    '--frame-ring-preview-y': cssPx(preview.y),
    '--frame-ring-preview-z': cssPx(preview.z),
    '--frame-ring-preview-width': cssPx(preview.width),
    '--frame-ring-preview-rotate-x': cssDegrees(preview.rotateX),
    '--frame-ring-preview-rotate-y': cssDegrees(preview.rotateY),
    '--frame-ring-preview-rotate-z': cssDegrees(preview.rotateZ),
    '--frame-ring-preview-scale': cssNumber(preview.scale),
    '--frame-ring-preview-reflection-x': cssPx(preview.reflectionX),
    '--frame-ring-preview-reflection-y': cssPx(preview.reflectionY),
    '--frame-ring-info-x': cssPx(info.x),
    '--frame-ring-info-y': cssPx(info.y),
    '--frame-ring-info-z': cssPx(info.z),
    '--frame-ring-info-width': cssPx(info.width),
    '--frame-ring-info-height': cssPx(info.height),
    '--frame-ring-info-rotate-x': cssDegrees(info.rotateX),
    '--frame-ring-info-rotate-y': cssDegrees(info.rotateY),
    '--frame-ring-info-rotate-z': cssDegrees(info.rotateZ),
    '--frame-ring-info-scale': cssNumber(info.scale),
    '--frame-ring-info-reflection-x': cssPx(info.reflectionX),
    '--frame-ring-info-reflection-y': cssPx(info.reflectionY),
    '--frame-ring-action-x': cssPx(layout.action.x),
    '--frame-ring-action-y': cssPx(layout.action.y),
    '--frame-ring-action-z': cssPx(layout.action.z),
    '--frame-ring-action-width': cssPx(layout.action.width),
    '--frame-ring-action-height': cssPx(layout.action.height),
    '--frame-ring-action-rotate-x': cssDegrees(layout.action.rotateX),
    '--frame-ring-action-rotate-y': cssDegrees(layout.action.rotateY),
    '--frame-ring-action-rotate-z': cssDegrees(layout.action.rotateZ),
    '--frame-ring-action-scale': cssNumber(layout.action.scale),
    '--frame-ring-action-reflection-x': cssPx(layout.action.reflectionX),
    '--frame-ring-action-reflection-y': cssPx(layout.action.reflectionY),
    '--frame-ring-card-width': cssPx(layout.card.width),
    '--frame-ring-breadcrumb-top': cssPx(layout.breadcrumb.top),
    '--frame-ring-breadcrumb-x': cssPx(layout.breadcrumb.x),
    '--frame-ring-search-top': cssPx(layout.search.top),
    '--frame-ring-search-right-inset': cssPx(layout.search.right),
    '--frame-ring-search-width': cssPx(layout.search.width),
    '--frame-ring-search-height': cssPx(layout.search.height),
  }
}
