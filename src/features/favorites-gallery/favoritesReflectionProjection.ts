import * as THREE from 'three'
import {
  composeAroundOrigin,
  createCssPerspectiveMatrix,
  createFloorReflectionMatrix,
  createSampleSignature,
  parseCssLength,
  parseCssTransform,
  parseCssTranslate,
  parseTransformOrigin,
  projectCssPoint,
  readElementSize,
  type DomCardSample,
  type DomCoordinateSpace,
  type DomFloorLock,
  type DomGallerySnapshot,
} from '../project-gallery/reflection/domCardProjection'
import {
  getFavoritesPedestalLayout,
} from './favoritesPedestalLayout'
import { HOME_CARD_ALPHA_BOTTOM } from '../project-gallery/galleryCardLayout'
import { FAVORITES_REFLECTION_OPACITY_SCALE } from './favoritesReflectionAppearance'

export type FavoriteCardMeasurement = {
  element: HTMLElement
  carouselKey: string
  projectId: string
  projectIndex: number
  width: number
  height: number
  opacity: number
  reflectionOpacity: number
  reflectionBlurTexels: number
  lightOpacity: number
  paintOrder: number
  relative: number
  cardMatrix: THREE.Matrix4 | null
}

export type FavoriteGallerySpatialSnapshot = {
  width: number
  height: number
  perspective: number
  perspectiveOrigin: { x: number; y: number }
  rigMatrix: THREE.Matrix4
  floorY: number
  measurements: FavoriteCardMeasurement[]
}

const translation = (x: number, y: number, z = 0) =>
  new THREE.Matrix4().makeTranslation(x, y, z)

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

const getStyle = (element: HTMLElement) =>
  element.ownerDocument.defaultView?.getComputedStyle(element) ??
  getComputedStyle(element)

const createRectFallbackMatrix = (
  measurement: FavoriteCardMeasurement,
  stageRect: DOMRect,
  rect: DOMRect,
) => {
  const width = measurement.width || rect.width || 1
  const height = measurement.height || rect.height || 1
  return translation(rect.left - stageRect.left, rect.top - stageRect.top)
    .multiply(
      new THREE.Matrix4().makeScale(
        rect.width / width,
        rect.height / height,
        1,
      ),
    )
}

const deriveFloorY = (
  measurement: FavoriteCardMeasurement,
  matrix: THREE.Matrix4 | null,
) => {
  if (!matrix) return Number.NaN
  const pedestal = getFavoritesPedestalLayout(
    measurement.width,
    measurement.height,
  )
  const bottomLeft = projectCssPoint(matrix, 0, pedestal.bottomY)
  const bottomRight = projectCssPoint(
    matrix,
    measurement.width,
    pedestal.bottomY,
  )
  return (bottomLeft.y + bottomRight.y) / 2
}

export function sampleFavoritesGallerySpatialState(
  stage: HTMLElement,
): FavoriteGallerySpatialSnapshot | null {
  const stageStyle = getStyle(stage)
  const width = readElementSize(stage, stageStyle, 'width')
  const height = readElementSize(stage, stageStyle, 'height')
  const rig = stage.querySelector<HTMLElement>('.favoritesGalleryCardCamera')
  if (!rig || width <= 0 || height <= 0) return null

  const rigStyle = getStyle(rig)
  const rigWidth = readElementSize(rig, rigStyle, 'width') || width
  const rigHeight = readElementSize(rig, rigStyle, 'height') || height
  const parsedRigTransform = parseCssTransform(rigStyle.transform)
  if (!parsedRigTransform) return null
  const rigOrigin = parseTransformOrigin(
    rigStyle.transformOrigin,
    rigWidth,
    rigHeight,
  )
  const rigMatrix = composeAroundOrigin(parsedRigTransform, rigOrigin)
  const perspective = finiteOr(
    parseCssLength(stageStyle.perspective),
    Number.POSITIVE_INFINITY,
  )
  const perspectiveOrigin = parseTransformOrigin(
    stageStyle.perspectiveOrigin,
    width,
    height,
  )
  const cardElements = Array.from(
    stage.querySelectorAll<HTMLElement>(
      '.favoritesGalleryCard[data-item-id]',
    ),
  )
  const measurements = cardElements.flatMap<FavoriteCardMeasurement>(
    (element, domIndex) => {
      const style = getStyle(element)
      const cardWidth = readElementSize(element, style, 'width')
      const cardHeight = readElementSize(element, style, 'height')
      const parsedTransform = parseCssTransform(style.transform)
      if (!parsedTransform || cardWidth <= 0 || cardHeight <= 0) return []
      const individualTranslate = parseCssTranslate(
        style.translate,
        cardWidth,
        cardHeight,
      )
      const origin = parseTransformOrigin(
        style.transformOrigin,
        cardWidth,
        cardHeight,
      )
      const left = finiteOr(parseCssLength(style.left, rigWidth), 0)
      const top = finiteOr(parseCssLength(style.top, rigHeight), 0)
      const projectIndex = finiteOr(
        Number.parseInt(element.dataset.itemIndex ?? '', 10),
        domIndex,
      )
      const carouselKey =
        element.dataset.carouselKey ?? element.dataset.itemId ?? String(projectIndex)

      return [{
        element,
        carouselKey,
        projectId: element.dataset.itemId ?? '',
        projectIndex,
        width: cardWidth,
        height: cardHeight,
        opacity: finiteOr(Number.parseFloat(style.opacity), 1),
        reflectionOpacity: 0,
        reflectionBlurTexels: 0,
        lightOpacity: 0,
        paintOrder: finiteOr(Number.parseInt(style.zIndex, 10), domIndex),
        relative: finiteOr(
          Number.parseFloat(element.dataset.relative ?? ''),
          domIndex,
        ),
        cardMatrix: translation(left, top)
          .multiply(individualTranslate)
          .multiply(composeAroundOrigin(parsedTransform, origin)),
      }]
    },
  )
  const floorMeasurement = measurements.reduce<FavoriteCardMeasurement | null>(
    (closest, measurement) =>
      !closest || Math.abs(measurement.relative) < Math.abs(closest.relative)
        ? measurement
        : closest,
    null,
  )
  const floorY = floorMeasurement
    ? finiteOr(
        deriveFloorY(floorMeasurement, floorMeasurement.cardMatrix),
        0,
      )
    : 0

  return {
    width,
    height,
    perspective,
    perspectiveOrigin,
    rigMatrix,
    floorY,
    measurements,
  }
}

export function sampleFavoritesGallery(
  stage: HTMLElement,
  lockedFloor?: DomFloorLock,
): DomGallerySnapshot {
  const stageStyle = getStyle(stage)
  const width = readElementSize(stage, stageStyle, 'width')
  const height = readElementSize(stage, stageStyle, 'height')
  const rig = stage.querySelector<HTMLElement>('.favoritesGalleryCardCamera')
  if (!rig) {
    const coordinateSpace: DomCoordinateSpace = 'stage-screen'
    const floorY =
      lockedFloor?.coordinateSpace === coordinateSpace &&
      Number.isFinite(lockedFloor.floorY)
        ? lockedFloor.floorY
        : 0
    return {
      width,
      height,
      coordinateSpace,
      floorLock: { floorY, coordinateSpace },
      samples: [],
      signature: '',
    }
  }

  const rigStyle = getStyle(rig)
  const rigWidth = readElementSize(rig, rigStyle, 'width') || width
  const rigHeight = readElementSize(rig, rigStyle, 'height') || height
  const parsedRigTransform = parseCssTransform(rigStyle.transform)
  const rigOrigin = parseTransformOrigin(
    rigStyle.transformOrigin,
    rigWidth,
    rigHeight,
  )
  const rigMatrix = parsedRigTransform
    ? composeAroundOrigin(parsedRigTransform, rigOrigin)
    : null

  const perspective = finiteOr(
    parseCssLength(stageStyle.perspective),
    Number.POSITIVE_INFINITY,
  )
  const perspectiveOrigin = parseTransformOrigin(
    stageStyle.perspectiveOrigin,
    width,
    height,
  )
  const perspectiveMatrix = createCssPerspectiveMatrix(
    perspective,
    perspectiveOrigin.x,
    perspectiveOrigin.y,
  )

  const cardElements = Array.from(
    stage.querySelectorAll<HTMLElement>(
      '.favoritesGalleryCard[data-item-id]',
    ),
  )
  const measurements = cardElements.map<FavoriteCardMeasurement>(
    (element, domIndex) => {
      const style = getStyle(element)
      const cardWidth = readElementSize(element, style, 'width')
      const cardHeight = readElementSize(element, style, 'height')
      const parsedTransform = parseCssTransform(style.transform)
      const individualTranslate = parseCssTranslate(
        style.translate,
        cardWidth,
        cardHeight,
      )
      const origin = parseTransformOrigin(
        style.transformOrigin,
        cardWidth,
        cardHeight,
      )
      const left = finiteOr(parseCssLength(style.left, rigWidth), 0)
      const top = finiteOr(parseCssLength(style.top, rigHeight), 0)
      const projectIndex = finiteOr(
        Number.parseInt(element.dataset.itemIndex ?? '', 10),
        domIndex,
      )
      const carouselKey =
        element.dataset.carouselKey ?? element.dataset.itemId ?? String(projectIndex)

      return {
        element,
        carouselKey,
        projectId: element.dataset.itemId ?? '',
        projectIndex,
        width: cardWidth,
        height: cardHeight,
        opacity: finiteOr(Number.parseFloat(style.opacity), 1),
        reflectionOpacity:
          FAVORITES_REFLECTION_OPACITY_SCALE *
          finiteOr(
            Number.parseFloat(
              style.getPropertyValue('--reflection-opacity'),
            ),
            1,
          ) *
          finiteOr(
            Number.parseFloat(
              style.getPropertyValue('--reflection-slot-opacity'),
            ),
            1,
          ),
        reflectionBlurTexels: finiteOr(
          Number.parseFloat(
            style.getPropertyValue('--reflection-blur-texels'),
          ),
          0,
        ),
        lightOpacity: finiteOr(
          Number.parseFloat(
            style.getPropertyValue('--reflection-light-opacity'),
          ),
          0.82,
        ),
        paintOrder: finiteOr(Number.parseInt(style.zIndex, 10), domIndex),
        relative: finiteOr(
          Number.parseFloat(element.dataset.relative ?? ''),
          domIndex,
        ),
        cardMatrix: parsedTransform
          ? translation(left, top)
              .multiply(individualTranslate)
              .multiply(composeAroundOrigin(parsedTransform, origin))
          : null,
      }
    },
  )

  const floorMeasurement = measurements.reduce<FavoriteCardMeasurement | null>(
    (closest, measurement) =>
      !closest || Math.abs(measurement.relative) < Math.abs(closest.relative)
        ? measurement
        : closest,
    null,
  )
  const useRectFallback =
    rigMatrix === null ||
    measurements.some((measurement) => measurement.cardMatrix === null)
  const coordinateSpace: DomCoordinateSpace = useRectFallback
    ? 'stage-screen'
    : 'rig-local'
  const stageRect = useRectFallback ? stage.getBoundingClientRect() : null
  const fallbackRects = useRectFallback
    ? measurements.map((measurement) =>
        measurement.element.getBoundingClientRect(),
      )
    : []
  const floorIndex = floorMeasurement
    ? measurements.indexOf(floorMeasurement)
    : -1
  let floorY =
    lockedFloor?.coordinateSpace === coordinateSpace &&
    Number.isFinite(lockedFloor.floorY)
      ? lockedFloor.floorY
      : Number.NaN
  if (!Number.isFinite(floorY) && floorMeasurement) {
    floorY = deriveFloorY(
      floorMeasurement,
      useRectFallback
        ? createRectFallbackMatrix(
            floorMeasurement,
            stageRect!,
            fallbackRects[floorIndex],
          )
        : floorMeasurement.cardMatrix,
    )
  }
  floorY = finiteOr(floorY, 0)

  const floorReflection = createFloorReflectionMatrix(floorY)
  const samples = measurements.map<DomCardSample>((measurement, index) => {
    const slotMatrix = useRectFallback
      ? createRectFallbackMatrix(
          measurement,
          stageRect!,
          fallbackRects[index],
        )
      : measurement.cardMatrix!
    const cardMatrix = slotMatrix.clone()
    const reflectionMatrix = useRectFallback
      ? floorReflection.clone().multiply(cardMatrix)
      : perspectiveMatrix
          .clone()
          .multiply(rigMatrix!)
          .multiply(floorReflection)
          .multiply(cardMatrix)

    return {
      carouselKey: measurement.carouselKey,
      projectId: measurement.projectId,
      projectIndex: measurement.projectIndex,
      width: measurement.width,
      height: measurement.height,
      opacity: measurement.opacity,
      reflectionOpacity: measurement.reflectionOpacity,
      reflectionBlurTexels: measurement.reflectionBlurTexels,
      lightOpacity: measurement.lightOpacity,
      sourceAlphaBottom: HOME_CARD_ALPHA_BOTTOM,
      paintOrder: measurement.paintOrder,
      cardMatrix,
      reflectionMatrix,
      usedRectFallback: useRectFallback,
    }
  })

  return {
    width,
    height,
    coordinateSpace,
    floorLock: { floorY, coordinateSpace },
    samples,
    signature: createSampleSignature(samples),
  }
}
