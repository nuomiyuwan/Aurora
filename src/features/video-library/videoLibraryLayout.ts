import {
  AURORA_LAYOUT_REFERENCE,
  AURORA_TOPBAR_CENTER_Y,
  clampLayoutValue,
  cssPx,
  resolveResponsiveMetrics,
  roundLayoutValue,
  type LayoutRect,
  type ViewportSize,
} from '../responsive-layout/responsiveLayout'

export type VideoLibraryColumnTuple = readonly [number, number, number, number]

const VIDEO_LIBRARY_SEARCH_HEIGHT = 35.648339

export interface ResolvedVideoLibraryColumns {
  readonly x: VideoLibraryColumnTuple
  readonly rotateY: VideoLibraryColumnTuple
  readonly depth: VideoLibraryColumnTuple
  readonly scale: VideoLibraryColumnTuple
}

export const VIDEO_LIBRARY_LAYOUT_REFERENCE = AURORA_LAYOUT_REFERENCE

export const VIDEO_LIBRARY_BASE_LAYOUT = Object.freeze({
  contentScale: 0.938114,
  header: Object.freeze({ top: 98.501991, left: 153.85073 }),
  toolbar: Object.freeze({ top: 118.202389, left: 750.491362 }),
  search: Object.freeze({
    top: AURORA_TOPBAR_CENTER_Y - VIDEO_LIBRARY_SEARCH_HEIGHT / 2,
    right: 111.63559,
    width: 212.01381,
    height: VIDEO_LIBRARY_SEARCH_HEIGHT,
  }),
  grid: Object.freeze({
    top: 216,
    left: 110,
    width: 1100,
    height: 575,
    panelGap: 55.348738,
  }),
  card: Object.freeze({
    size: 320,
    anchorOffsetX: 100,
    imageTrim: 8,
  }),
  panel: Object.freeze({
    top: 187.622841,
    right: 0,
    width: 323.6494,
    height: 638.855772,
    paddingTop: 46.90571,
    paddingX: 51.596281,
    paddingBottom: 20.638512,
    previewHeight: 168.860556,
  }),
  countBottom: 52.534395,
  columns: Object.freeze({
    x: Object.freeze([13, 38.7, 64.8, 89.9] as const),
    rotateY: Object.freeze([12, 10, 3, -28] as const),
    depth: Object.freeze([0, -47.704591, -76.327345, -38.163673] as const),
    scale: Object.freeze([1, 1, 1, 1] as const),
  }),
  rows: Object.freeze({ top: 0, bottom: 50 }),
})

interface ResolvedPosition {
  top: number
  left: number
}

interface ResolvedRightInsetPosition {
  top: number
  right: number
}

interface ResolvedSize extends ResolvedRightInsetPosition {
  width: number
  height: number
}

interface ResolvedPanel extends LayoutRect {
  paddingTop: number
  paddingX: number
  paddingBottom: number
  previewHeight: number
}

export interface ResolvedVideoLibraryLayout {
  viewport: ViewportSize
  layoutScale: number
  uiScale: number
  sceneScale: number
  cardScale: number
  panelScale: number
  uiContentScale: number
  cardContentScale: number
  panelContentScale: number
  header: ResolvedPosition
  toolbar: ResolvedPosition
  search: ResolvedSize
  safeRect: LayoutRect
  grid: LayoutRect
  panelGap: number
  card: {
    size: number
    anchorOffsetX: number
    imageTrim: number
  }
  panel: ResolvedPanel
  countBottom: number
  columns: ResolvedVideoLibraryColumns
  rows: {
    top: number
    bottom: number
  }
  columnTravel: number
}

export type VideoClipCssVariableName =
  | '--clip-x'
  | '--clip-y'
  | '--clip-depth'
  | '--clip-rotate-y'
  | '--clip-rotate-x'
  | '--clip-rotate-z'
  | '--clip-scale'
  | '--clip-scale-y'
  | '--clip-opacity'
  | '--clip-z-index'
  | '--clip-reflection-opacity'

export type VideoClipVisualStyle = {
  [Name in VideoClipCssVariableName]: string
}

export type VideoLibraryCssVariableName =
  | '--detail-viewport-width'
  | '--detail-viewport-height'
  | '--detail-ui-scale'
  | '--detail-scene-scale'
  | '--detail-card-scale'
  | '--detail-panel-scale'
  | '--detail-header-top'
  | '--detail-header-left'
  | '--detail-toolbar-top'
  | '--detail-toolbar-left'
  | '--detail-search-top'
  | '--detail-search-right-inset'
  | '--detail-search-width'
  | '--detail-search-height'
  | '--detail-grid-left'
  | '--detail-grid-top'
  | '--detail-grid-right-edge'
  | '--detail-grid-bottom-edge'
  | '--detail-card-size'
  | '--detail-card-anchor-offset-x'
  | '--detail-card-image-trim'
  | '--detail-panel-left'
  | '--detail-panel-top'
  | '--detail-panel-right-edge'
  | '--detail-panel-bottom-edge'
  | '--detail-panel-padding-top'
  | '--detail-panel-padding-x'
  | '--detail-panel-padding-bottom'
  | '--detail-panel-preview-height'
  | '--detail-count-bottom-inset'
  | '--detail-column-travel'

export type VideoLibraryCssVariables = {
  [Name in VideoLibraryCssVariableName]: string
}

const scaleValue = (value: number, scale: number) => roundLayoutValue(value * scale)
const cssPercent = (value: number) => `${roundLayoutValue(value)}%`
const cssDegrees = (value: number) => `${roundLayoutValue(value)}deg`
const cssNumber = (value: number) => `${roundLayoutValue(value)}`

const createRoundedRect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): LayoutRect => {
  const roundedLeft = roundLayoutValue(left)
  const roundedTop = roundLayoutValue(top)
  const roundedRight = Math.max(roundedLeft, roundLayoutValue(right))
  const roundedBottom = Math.max(roundedTop, roundLayoutValue(bottom))
  return {
    left: roundedLeft,
    top: roundedTop,
    right: roundedRight,
    bottom: roundedBottom,
    width: roundLayoutValue(roundedRight - roundedLeft),
    height: roundLayoutValue(roundedBottom - roundedTop),
  }
}

const smoothstep = (progress: number) => progress * progress * (3 - 2 * progress)
const interpolate = (start: number, end: number, progress: number) =>
  start + (end - start) * progress

const resolveVisualSlot = (visualSlot: number) =>
  Number.isFinite(visualSlot) ? visualSlot : 0

const interpolateLinearWithEdgeExtrapolation = (
  values: VideoLibraryColumnTuple,
  visualSlot: number,
) => {
  const slot = resolveVisualSlot(visualSlot)
  const lowerIndex = slot <= 0 ? 0 : slot >= 3 ? 2 : Math.floor(slot)
  return interpolate(values[lowerIndex], values[lowerIndex + 1], slot - lowerIndex)
}

const interpolateBoundedMotion = (
  values: VideoLibraryColumnTuple,
  visualSlot: number,
) => {
  const slot = clampLayoutValue(resolveVisualSlot(visualSlot), 0, 3)
  const lowerIndex = Math.min(2, Math.floor(slot))
  return interpolate(
    values[lowerIndex],
    values[lowerIndex + 1],
    smoothstep(slot - lowerIndex),
  )
}

export function getClipColumnTravel(
  gridWidth: number,
  columns: ResolvedVideoLibraryColumns,
): number {
  const normalizedGridWidth = Number.isFinite(gridWidth) ? Math.max(0, gridWidth) : 0
  const columnDelta = (columns.x[1] - columns.x[0]) / 100
  return roundLayoutValue(normalizedGridWidth * columnDelta)
}

export function resolveVideoLibraryLayout(viewport: ViewportSize): ResolvedVideoLibraryLayout {
  const designPlane = resolveResponsiveMetrics(viewport)
  const {
    width,
    height,
    layoutScale,
    planeLeft,
    planeTop,
    planeRight,
    planeBottom,
  } = designPlane
  const contentScale = layoutScale * VIDEO_LIBRARY_BASE_LAYOUT.contentScale

  const panelWidth = scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.panel.width, layoutScale)
  const panelHeight = scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.panel.height, layoutScale)
  const panelRight = roundLayoutValue(
    planeRight - VIDEO_LIBRARY_BASE_LAYOUT.panel.right * layoutScale,
  )
  const panelLeft = roundLayoutValue(panelRight - panelWidth)
  const panelTop = roundLayoutValue(
    planeTop + VIDEO_LIBRARY_BASE_LAYOUT.panel.top * layoutScale,
  )
  const panel = {
    ...createRoundedRect(panelLeft, panelTop, panelRight, panelTop + panelHeight),
    paddingTop: scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.panel.paddingTop, layoutScale),
    paddingX: scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.panel.paddingX, layoutScale),
    paddingBottom: scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.panel.paddingBottom, layoutScale),
    previewHeight: scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.panel.previewHeight, layoutScale),
  }

  const panelGap = scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.grid.panelGap, layoutScale)
  const gridLeft = roundLayoutValue(
    planeLeft + VIDEO_LIBRARY_BASE_LAYOUT.grid.left * layoutScale,
  )
  const gridTop = roundLayoutValue(
    planeTop + VIDEO_LIBRARY_BASE_LAYOUT.grid.top * layoutScale,
  )
  const gridWidth = scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.grid.width, layoutScale)
  const gridHeight = scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.grid.height, layoutScale)
  const safeRect = createRoundedRect(
    gridLeft,
    gridTop,
    panelLeft - panelGap,
    gridTop + gridHeight,
  )
  const grid = createRoundedRect(
    gridLeft,
    gridTop,
    gridLeft + gridWidth,
    gridTop + gridHeight,
  )

  const columns: ResolvedVideoLibraryColumns = VIDEO_LIBRARY_BASE_LAYOUT.columns

  return {
    viewport: { width, height },
    layoutScale,
    uiScale: layoutScale,
    sceneScale: layoutScale,
    cardScale: layoutScale,
    panelScale: layoutScale,
    uiContentScale: contentScale,
    cardContentScale: contentScale,
    panelContentScale: contentScale,
    header: {
      top: roundLayoutValue(planeTop + VIDEO_LIBRARY_BASE_LAYOUT.header.top * layoutScale),
      left: roundLayoutValue(planeLeft + VIDEO_LIBRARY_BASE_LAYOUT.header.left * layoutScale),
    },
    toolbar: {
      top: roundLayoutValue(planeTop + VIDEO_LIBRARY_BASE_LAYOUT.toolbar.top * layoutScale),
      left: roundLayoutValue(planeLeft + VIDEO_LIBRARY_BASE_LAYOUT.toolbar.left * layoutScale),
    },
    search: {
      top: roundLayoutValue(planeTop + VIDEO_LIBRARY_BASE_LAYOUT.search.top * layoutScale),
      right: roundLayoutValue(width - planeRight + VIDEO_LIBRARY_BASE_LAYOUT.search.right * layoutScale),
      width: scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.search.width, layoutScale),
      height: scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.search.height, layoutScale),
    },
    safeRect,
    grid,
    panelGap: roundLayoutValue(panelGap),
    card: {
      size: scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.card.size, layoutScale),
      anchorOffsetX: scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.card.anchorOffsetX, layoutScale),
      imageTrim: scaleValue(VIDEO_LIBRARY_BASE_LAYOUT.card.imageTrim, layoutScale),
    },
    panel,
    countBottom: roundLayoutValue(
      height - planeBottom + VIDEO_LIBRARY_BASE_LAYOUT.countBottom * layoutScale,
    ),
    columns,
    rows: {
      top: VIDEO_LIBRARY_BASE_LAYOUT.rows.top,
      bottom: VIDEO_LIBRARY_BASE_LAYOUT.rows.bottom,
    },
    columnTravel: getClipColumnTravel(grid.width, columns),
  }
}

export function getVideoClipVisualStyle(
  rowIndex: 0 | 1,
  visualSlot: number,
  layout: ResolvedVideoLibraryLayout,
): VideoClipVisualStyle {
  const slot = resolveVisualSlot(visualSlot)
  const x = interpolateLinearWithEdgeExtrapolation(layout.columns.x, slot)
  const rotateY = interpolateBoundedMotion(layout.columns.rotateY, slot)
  const depth = interpolateBoundedMotion(layout.columns.depth, slot)
  const scale = interpolateBoundedMotion(layout.columns.scale, slot)
  const rowValues: VideoLibraryColumnTuple = rowIndex === 0
    ? [layout.rows.top, layout.rows.top, layout.rows.top, layout.rows.top]
    : [layout.rows.bottom, layout.rows.bottom, layout.rows.bottom, layout.rows.bottom]
  const y = interpolateBoundedMotion(rowValues, slot)
  const scaleY = rowIndex === 0
    ? interpolateBoundedMotion(layout.columns.scale, slot)
    : 1
  const leadingOpacity = clampLayoutValue((slot + 0.5) * 2, 0, 1)
  const trailingOpacity = clampLayoutValue((3.5 - slot) * 2, 0, 1)
  const rawOpacity = Math.min(leadingOpacity, trailingOpacity)
  const opacity = smoothstep(rawOpacity)

  return {
    '--clip-x': cssPercent(x),
    '--clip-y': cssPercent(y),
    '--clip-depth': cssPx(depth * layout.sceneScale),
    '--clip-rotate-y': cssDegrees(rotateY),
    '--clip-rotate-x': '0deg',
    '--clip-rotate-z': '0deg',
    '--clip-scale': cssNumber(scale),
    '--clip-scale-y': cssNumber(scaleY),
    '--clip-opacity': cssNumber(opacity),
    '--clip-z-index': rowIndex === 0 ? '18' : '16',
    '--clip-reflection-opacity': '0',
  }
}

export function getVideoLibraryCssVariables(
  layout: ResolvedVideoLibraryLayout,
): VideoLibraryCssVariables {
  return {
    '--detail-viewport-width': cssPx(layout.viewport.width),
    '--detail-viewport-height': cssPx(layout.viewport.height),
    '--detail-ui-scale': cssNumber(layout.uiContentScale),
    '--detail-scene-scale': cssNumber(layout.sceneScale),
    '--detail-card-scale': cssNumber(layout.cardContentScale),
    '--detail-panel-scale': cssNumber(layout.panelContentScale),
    '--detail-header-top': cssPx(layout.header.top),
    '--detail-header-left': cssPx(layout.header.left),
    '--detail-toolbar-top': cssPx(layout.toolbar.top),
    '--detail-toolbar-left': cssPx(layout.toolbar.left),
    '--detail-search-top': cssPx(layout.search.top),
    '--detail-search-right-inset': cssPx(layout.search.right),
    '--detail-search-width': cssPx(layout.search.width),
    '--detail-search-height': cssPx(layout.search.height),
    '--detail-grid-left': cssPx(layout.grid.left),
    '--detail-grid-top': cssPx(layout.grid.top),
    '--detail-grid-right-edge': cssPx(layout.grid.right),
    '--detail-grid-bottom-edge': cssPx(layout.grid.bottom),
    '--detail-card-size': cssPx(layout.card.size),
    '--detail-card-anchor-offset-x': cssPx(layout.card.anchorOffsetX),
    '--detail-card-image-trim': cssPx(layout.card.imageTrim),
    '--detail-panel-left': cssPx(layout.panel.left),
    '--detail-panel-top': cssPx(layout.panel.top),
    '--detail-panel-right-edge': cssPx(layout.panel.right),
    '--detail-panel-bottom-edge': cssPx(layout.panel.bottom),
    '--detail-panel-padding-top': cssPx(layout.panel.paddingTop),
    '--detail-panel-padding-x': cssPx(layout.panel.paddingX),
    '--detail-panel-padding-bottom': cssPx(layout.panel.paddingBottom),
    '--detail-panel-preview-height': cssPx(layout.panel.previewHeight),
    '--detail-count-bottom-inset': cssPx(layout.countBottom),
    '--detail-column-travel': cssPx(layout.columnTravel),
  }
}
