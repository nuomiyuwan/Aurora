import * as THREE from 'three'
import {
  composeAroundOrigin,
  createCssPerspectiveMatrix,
  createFloorReflectionMatrix,
  createProjectedFloorReflectionMatrix,
  createSampleSignature,
  parseCssLength,
  parseCssTransform,
  parseTransformOrigin,
  projectCssPoint,
  readElementSize,
  readLayoutOffset,
  type DomCardSample,
} from '../project-gallery/reflection/domCardProjection'
import {
  DETAIL_PANEL_ALPHA_BOTTOM,
  SQUARE_CARD_ALPHA_BOTTOM,
} from './videoClipGeometry'
import { VIDEO_DETAIL_REFLECTION_ID } from './videoReflectionSource'

export interface ClipReflectionSnapshot {
  width: number
  height: number
  samples: DomCardSample[]
  signature: string
}

export interface ClipReflectionSamplingOptions {
  sourceScopeSelector?: string
  cardSelector?: string
}

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

export const VIDEO_CLIP_REFLECTION_OPACITY = 0.8
export const VIDEO_CLIP_FALLBACK_REFLECTION_OPACITY = 1.0
export const VIDEO_DETAIL_REFLECTION_OPACITY = 0.8

const translation = (x: number, y: number, z = 0) =>
  new THREE.Matrix4().makeTranslation(x, y, z)

export const sampleVideoClipReflections = (
  stage: HTMLElement,
  options: ClipReflectionSamplingOptions = {},
): ClipReflectionSnapshot => {
  let fallbackStageRect: DOMRect | null = null
  const getFallbackStageRect = () =>
    fallbackStageRect ??= stage.getBoundingClientRect()
  const stageWidth = Math.max(
    1,
    stage.offsetWidth || stage.clientWidth || getFallbackStageRect().width,
  )
  const stageHeight = Math.max(
    1,
    stage.offsetHeight || stage.clientHeight || getFallbackStageRect().height,
  )
  const sourceRoot = options.sourceScopeSelector
    ? stage.querySelector<HTMLElement>(options.sourceScopeSelector)
    : stage
  if (!sourceRoot) {
    return {
      width: stageWidth,
      height: stageHeight,
      samples: [],
      signature: createSampleSignature([]),
    }
  }
  const cardSelector =
    options.cardSelector ?? '.videoClipCard.clipRowBottom'
  const clipGrid =
    typeof sourceRoot.querySelector === 'function'
      ? sourceRoot.querySelector<HTMLElement>('.videoClipGrid')
      : null
  const cameraRig =
    clipGrid && typeof clipGrid.querySelector === 'function'
      ? clipGrid.querySelector<HTMLElement>('.videoClipCameraRig')
      : null
  const gridStyle = clipGrid ? getComputedStyle(clipGrid) : null
  const gridLayoutOffset = clipGrid ? readLayoutOffset(clipGrid, stage) : null
  const gridWidth = clipGrid && gridStyle
    ? Math.max(1, readElementSize(clipGrid, gridStyle, 'width'))
    : 1
  const gridHeight = clipGrid && gridStyle
    ? Math.max(1, readElementSize(clipGrid, gridStyle, 'height'))
    : 1
  const gridOffsetMatrix = gridLayoutOffset
    ? translation(gridLayoutOffset.x, gridLayoutOffset.y)
    : new THREE.Matrix4()
  const perspectiveOrigin = gridStyle
    ? parseTransformOrigin(gridStyle.perspectiveOrigin || '50% 50%', gridWidth, gridHeight)
    : { x: gridWidth / 2, y: gridHeight / 2, z: 0 }
  const perspectiveMatrix = createCssPerspectiveMatrix(
    gridStyle
      ? finiteOr(parseCssLength(gridStyle.perspective), Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY,
    perspectiveOrigin.x,
    perspectiveOrigin.y,
  )
  const cameraRigStyle = cameraRig ? getComputedStyle(cameraRig) : null
  const parsedRigTransform = cameraRigStyle
    ? parseCssTransform(cameraRigStyle.transform)
    : null
  const rigOrigin = cameraRigStyle
    ? parseTransformOrigin(cameraRigStyle.transformOrigin || '50% 50%', gridWidth, gridHeight)
    : { x: gridWidth / 2, y: gridHeight / 2, z: 0 }
  const rigMatrix = parsedRigTransform
    ? composeAroundOrigin(parsedRigTransform, rigOrigin)
    : null
  const elements = Array.from(
    sourceRoot.querySelectorAll<HTMLElement>(cardSelector),
  )
  const samples = elements.map<DomCardSample>((element, domIndex) => {
    const style = getComputedStyle(element)
    const visual =
      typeof element.querySelector === 'function'
        ? element.querySelector<HTMLElement>('.videoClipVisual')
        : null
    const visualStyle = visual ? getComputedStyle(visual) : null
    const light =
      typeof element.querySelector === 'function'
        ? element.querySelector<HTMLElement>('.videoClipLight')
        : null
    const lightOpacity = light
      ? finiteOr(Number.parseFloat(getComputedStyle(light).opacity), 0)
      : 0
    const measuredWidth = readElementSize(element, style, 'width')
    const measuredHeight = readElementSize(element, style, 'height')
    const width = Math.max(1, finiteOr(measuredWidth, 1))
    const height = Math.max(1, finiteOr(measuredHeight, 1))
    const parsedTransform = parseCssTransform(visualStyle?.transform ?? style.transform)
    const origin = parseTransformOrigin(
      visualStyle?.transformOrigin || style.transformOrigin || '50% 50%',
      width,
      height,
    )
    const cssLeft = parseCssLength(style.left, gridWidth)
    const cssTop = parseCssLength(style.top, gridHeight)
    const canProject = Boolean(
      clipGrid &&
      gridLayoutOffset &&
      rigMatrix &&
      parsedTransform &&
      Number.isFinite(cssLeft) &&
      Number.isFinite(cssTop),
    )
    if (canProject) {
      const localCardMatrix = translation(cssLeft, cssTop).multiply(
        composeAroundOrigin(parsedTransform!, origin),
      )
      const alphaBottomY = height * SQUARE_CARD_ALPHA_BOTTOM
      const bottomLeft = projectCssPoint(localCardMatrix, 0, alphaBottomY)
      const bottomRight = projectCssPoint(localCardMatrix, width, alphaBottomY)
      const floorY = (bottomLeft.y + bottomRight.y) / 2
      const cardMatrix = gridOffsetMatrix
        .clone()
        .multiply(perspectiveMatrix)
        .multiply(rigMatrix!)
        .multiply(localCardMatrix)

      return {
        carouselKey: element.dataset.clipId ?? `clip-${domIndex}`,
        projectId: element.dataset.clipId,
        projectIndex: finiteOr(
          Number.parseInt(element.dataset.reflectionIndex ?? '', 10),
          domIndex,
        ),
        width,
        height,
        opacity: finiteOr(Number.parseFloat(visualStyle?.opacity ?? style.opacity), 1),
        reflectionOpacity: VIDEO_CLIP_REFLECTION_OPACITY,
        lightOpacity,
        paintOrder: finiteOr(Number.parseInt(style.zIndex, 10), domIndex),
        cardMatrix,
        reflectionMatrix: createProjectedFloorReflectionMatrix(
          gridOffsetMatrix,
          perspectiveMatrix,
          rigMatrix!,
          floorY,
          localCardMatrix,
        ),
        usedRectFallback: false,
      }
    }

    const rect = element.getBoundingClientRect()
    const stageRect = getFallbackStageRect()
    const fallbackWidth = Math.max(1, rect.width)
    const fallbackHeight = Math.max(1, rect.height)
    const left = rect.left - stageRect.left
    const top = rect.top - stageRect.top
    const floorY = top + fallbackHeight * SQUARE_CARD_ALPHA_BOTTOM
    const cardMatrix = new THREE.Matrix4().makeTranslation(left, top, 0)
    const reflectionMatrix = createFloorReflectionMatrix(floorY).multiply(cardMatrix)

    return {
      carouselKey: element.dataset.clipId ?? `clip-${domIndex}`,
      projectId: element.dataset.clipId,
      projectIndex: finiteOr(
        Number.parseInt(element.dataset.reflectionIndex ?? '', 10),
        domIndex,
      ),
      width: fallbackWidth,
      height: fallbackHeight,
      opacity: finiteOr(Number.parseFloat(visualStyle?.opacity ?? style.opacity), 1),
      reflectionOpacity: VIDEO_CLIP_FALLBACK_REFLECTION_OPACITY,
      lightOpacity,
      paintOrder: finiteOr(Number.parseInt(style.zIndex, 10), domIndex),
      cardMatrix,
      reflectionMatrix,
      usedRectFallback: true,
    }
  })

  const detailPanel =
    typeof sourceRoot.querySelector === 'function'
      ? sourceRoot.querySelector<HTMLElement>('.clipDetailPanel[data-detail-reflection]')
      : null
  if (detailPanel) {
    const style = getComputedStyle(detailPanel)
    const detailStage = sourceRoot.querySelector<HTMLElement>('.videoLibraryDetailStage')
    const detailCameraRig =
      detailStage && typeof detailStage.querySelector === 'function'
        ? detailStage.querySelector<HTMLElement>('.videoLibraryDetailCameraRig')
        : null
    const detailStageStyle = detailStage ? getComputedStyle(detailStage) : null
    const detailStageLayoutOffset = detailStage
      ? readLayoutOffset(detailStage, stage)
      : null
    const detailStageWidth = detailStage && detailStageStyle
      ? Math.max(1, readElementSize(detailStage, detailStageStyle, 'width'))
      : 1
    const detailStageHeight = detailStage && detailStageStyle
      ? Math.max(1, readElementSize(detailStage, detailStageStyle, 'height'))
      : 1
    const detailStageOffsetMatrix = detailStageLayoutOffset
      ? translation(
          detailStageLayoutOffset.x,
          detailStageLayoutOffset.y,
        )
      : null
    const detailPerspectiveOrigin = detailStageStyle
      ? parseTransformOrigin(
          detailStageStyle.perspectiveOrigin || '50% 50%',
          detailStageWidth,
          detailStageHeight,
        )
      : null
    const detailPerspectiveMatrix = detailStageStyle && detailPerspectiveOrigin
      ? createCssPerspectiveMatrix(
          finiteOr(
            parseCssLength(detailStageStyle.perspective),
            Number.POSITIVE_INFINITY,
          ),
          detailPerspectiveOrigin.x,
          detailPerspectiveOrigin.y,
        )
      : null
    const detailRigStyle = detailCameraRig ? getComputedStyle(detailCameraRig) : null
    const parsedDetailRigTransform = detailRigStyle
      ? parseCssTransform(detailRigStyle.transform)
      : null
    const detailRigOrigin = detailRigStyle
      ? parseTransformOrigin(
          detailRigStyle.transformOrigin || '50% 50%',
          detailStageWidth,
          detailStageHeight,
        )
      : null
    const detailRigMatrix = parsedDetailRigTransform && detailRigOrigin
      ? composeAroundOrigin(parsedDetailRigTransform, detailRigOrigin)
      : null
    const width = Math.max(1, finiteOr(readElementSize(detailPanel, style, 'width'), 1))
    const height = Math.max(1, finiteOr(readElementSize(detailPanel, style, 'height'), 1))
    const parsedPanelTransform = parseCssTransform(style.transform)
    const panelOrigin = parseTransformOrigin(
      style.transformOrigin || '50% 50%',
      width,
      height,
    )
    const cssLeft = parseCssLength(style.left, detailStageWidth)
    const cssTop = parseCssLength(style.top, detailStageHeight)
    const canProjectDetail = Boolean(
      detailStageOffsetMatrix &&
      detailPerspectiveMatrix &&
      detailRigMatrix &&
      parsedPanelTransform &&
      Number.isFinite(cssLeft) &&
      Number.isFinite(cssTop),
    )
    const projectIndex = finiteOr(
      Number.parseInt(detailPanel.dataset.reflectionIndex ?? '', 10),
      elements.length,
    )

    let cardMatrix: THREE.Matrix4
    let reflectionMatrix: THREE.Matrix4
    let usedRectFallback = true
    let sampledWidth = width
    let sampledHeight = height

    if (canProjectDetail) {
      const localPanelMatrix = translation(cssLeft, cssTop).multiply(
        composeAroundOrigin(parsedPanelTransform!, panelOrigin),
      )
      const alphaBottomY = height * DETAIL_PANEL_ALPHA_BOTTOM
      const bottomLeft = projectCssPoint(localPanelMatrix, 0, alphaBottomY)
      const bottomRight = projectCssPoint(localPanelMatrix, width, alphaBottomY)
      const floorY = (bottomLeft.y + bottomRight.y) / 2
      cardMatrix = detailStageOffsetMatrix!
        .clone()
        .multiply(detailPerspectiveMatrix!)
        .multiply(detailRigMatrix!)
        .multiply(localPanelMatrix)
      reflectionMatrix = createProjectedFloorReflectionMatrix(
        detailStageOffsetMatrix!,
        detailPerspectiveMatrix!,
        detailRigMatrix!,
        floorY,
        localPanelMatrix,
      )
      sampledWidth = width
      sampledHeight = height
      usedRectFallback = false
    } else {
      const rect = detailPanel.getBoundingClientRect()
      sampledWidth = Math.max(1, rect.width)
      sampledHeight = Math.max(1, rect.height)
      const stageRect = getFallbackStageRect()
      const left = rect.left - stageRect.left
      const top = rect.top - stageRect.top
      const floorY = top + sampledHeight * DETAIL_PANEL_ALPHA_BOTTOM
      cardMatrix = new THREE.Matrix4().makeTranslation(left, top, 0)
      reflectionMatrix = createFloorReflectionMatrix(floorY).multiply(cardMatrix)
    }

    samples.push({
      carouselKey: VIDEO_DETAIL_REFLECTION_ID,
      projectId: VIDEO_DETAIL_REFLECTION_ID,
      projectIndex,
      width: sampledWidth,
      height: sampledHeight,
      opacity: finiteOr(Number.parseFloat(style.opacity), 1),
      reflectionOpacity: VIDEO_DETAIL_REFLECTION_OPACITY,
      sourceAlphaBottom: DETAIL_PANEL_ALPHA_BOTTOM,
      paintOrder: Math.max(32, finiteOr(Number.parseInt(style.zIndex, 10), 32)),
      cardMatrix,
      reflectionMatrix,
      usedRectFallback,
    })
  }

  return {
    width: stageWidth,
    height: stageHeight,
    samples,
    signature: createSampleSignature(samples),
  }
}
