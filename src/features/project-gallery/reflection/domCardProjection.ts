import * as THREE from 'three'
import { getHomeCardAlphaBottomLocalY } from '../galleryCardLayout'

export interface DomCardSample {
  carouselKey: string
  projectId?: string
  projectIndex: number
  width: number
  height: number
  opacity: number
  reflectionOpacity: number
  reflectionBlurTexels?: number
  lightOpacity?: number
  sourceAlphaBottom?: number
  paintOrder: number
  cardMatrix: THREE.Matrix4
  reflectionMatrix: THREE.Matrix4
  usedRectFallback: boolean
}

export type DomCoordinateSpace = 'rig-local' | 'stage-screen'

export interface DomFloorLock {
  floorY: number
  coordinateSpace: DomCoordinateSpace
}

export interface DomGallerySnapshot {
  width: number
  height: number
  coordinateSpace: DomCoordinateSpace
  floorLock: DomFloorLock
  samples: DomCardSample[]
  signature: string
}

interface CardMeasurement {
  element: HTMLElement
  carouselKey: string
  projectId: string
  projectIndex: number
  width: number
  height: number
  opacity: number
  reflectionOpacity: number
  lightOpacity: number
  paintOrder: number
  cardMatrix: THREE.Matrix4 | null
}

const translation = (x: number, y: number, z = 0) =>
  new THREE.Matrix4().makeTranslation(x, y, z)

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

export const parseCssLength = (value: string | null | undefined, basis = 0) => {
  const source = value?.trim()
  if (!source || source === 'auto' || source === 'none') return Number.NaN
  const parsed = Number.parseFloat(source)
  if (!Number.isFinite(parsed)) return Number.NaN
  return source.endsWith('%') ? (parsed / 100) * basis : parsed
}

export const readElementSize = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
  dimension: 'width' | 'height',
) => {
  const computed = parseCssLength(style[dimension])
  if (Number.isFinite(computed)) return computed
  const offset = dimension === 'width' ? element.offsetWidth : element.offsetHeight
  if (offset > 0) return offset
  return dimension === 'width' ? element.clientWidth : element.clientHeight
}

// Offset coordinates stay stable while an ancestor is running the page Z animation.
export const readLayoutOffset = (
  element: HTMLElement,
  ancestor: HTMLElement,
): { x: number; y: number } | null => {
  let x = 0
  let y = 0
  let current: HTMLElement | null = element

  while (current && current !== ancestor) {
    x += current.offsetLeft
    y += current.offsetTop
    const parent: Element | null = current.offsetParent
    current = parent && 'offsetLeft' in parent
      ? parent as HTMLElement
      : null
  }

  return current === ancestor ? { x, y } : null
}

const parseOriginPart = (value: string | undefined, basis: number, axis: 'x' | 'y') => {
  if (!value || value === 'center') return basis / 2
  if (axis === 'x') {
    if (value === 'left') return 0
    if (value === 'right') return basis
  } else {
    if (value === 'top') return 0
    if (value === 'bottom') return basis
  }
  return finiteOr(parseCssLength(value, basis), basis / 2)
}

export const parseTransformOrigin = (value: string, width: number, height: number) => {
  const parts = value.trim().split(/\s+/)
  return {
    x: parseOriginPart(parts[0], width, 'x'),
    y: parseOriginPart(parts[1], height, 'y'),
    z: finiteOr(parseCssLength(parts[2]), 0),
  }
}

export const parseCssTransform = (value: string | null | undefined): THREE.Matrix4 | null => {
  const source = value?.trim()
  if (!source || source === 'none') return new THREE.Matrix4()

  const match = /^(matrix|matrix3d)\((.*)\)$/.exec(source)
  if (!match) return null
  const values = match[2]
    .trim()
    .split(/\s*,\s*|\s+/)
    .filter(Boolean)
    .map(Number)

  if (values.some((entry) => !Number.isFinite(entry))) return null
  if (match[1] === 'matrix' && values.length === 6) {
    const [a, b, c, d, e, f] = values
    return new THREE.Matrix4().set(
      a,
      c,
      0,
      e,
      b,
      d,
      0,
      f,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    )
  }
  if (match[1] === 'matrix3d' && values.length === 16) {
    return new THREE.Matrix4().fromArray(values)
  }
  return null
}

export const parseCssTranslate = (
  value: string | null | undefined,
  width: number,
  height: number,
) => {
  const source = value?.trim()
  if (!source || source === 'none') return new THREE.Matrix4()
  const parts = source.split(/\s+/)
  const x = finiteOr(parseCssLength(parts[0], width), 0)
  const y = finiteOr(parseCssLength(parts[1], height), 0)
  const z = finiteOr(parseCssLength(parts[2]), 0)
  return translation(x, y, z)
}

export const composeAroundOrigin = (
  matrix: THREE.Matrix4,
  origin: { x: number; y: number; z: number },
) =>
  translation(origin.x, origin.y, origin.z)
    .multiply(matrix)
    .multiply(translation(-origin.x, -origin.y, -origin.z))

const getStyle = (element: HTMLElement) => {
  const view = element.ownerDocument?.defaultView
  if (view) return view.getComputedStyle(element)
  return getComputedStyle(element)
}

export const createFloorReflectionMatrix = (floorY: number): THREE.Matrix4 =>
  translation(0, floorY)
    .multiply(new THREE.Matrix4().makeScale(1, -1, 1))
    .multiply(translation(0, -floorY))

export const createProjectedFloorReflectionMatrix = (
  stageOffsetMatrix: THREE.Matrix4,
  perspectiveMatrix: THREE.Matrix4,
  rigMatrix: THREE.Matrix4,
  floorY: number,
  cardMatrix: THREE.Matrix4,
) =>
  stageOffsetMatrix
    .clone()
    .multiply(perspectiveMatrix)
    .multiply(rigMatrix)
    .multiply(createFloorReflectionMatrix(floorY))
    .multiply(cardMatrix)

export const createCssPerspectiveMatrix = (
  perspective: number,
  originX: number,
  originY: number,
): THREE.Matrix4 => {
  if (!Number.isFinite(perspective) || perspective <= 0) return new THREE.Matrix4()
  const perspectiveMatrix = new THREE.Matrix4()
  perspectiveMatrix.elements[11] = -1 / perspective
  return translation(originX, originY)
    .multiply(perspectiveMatrix)
    .multiply(translation(-originX, -originY))
}

export const projectCssPoint = (
  matrix: THREE.Matrix4,
  x: number,
  y: number,
  z = 0,
): { x: number; y: number } => {
  const projected = new THREE.Vector4(x, y, z, 1).applyMatrix4(matrix)
  return { x: projected.x / projected.w, y: projected.y / projected.w }
}

export const createSampleSignature = (samples: readonly DomCardSample[]): string =>
  samples
    .map((sample) =>
      JSON.stringify([
        sample.carouselKey,
        sample.projectId ?? '',
        sample.projectIndex,
        sample.width,
        sample.height,
        sample.opacity,
        sample.reflectionOpacity,
        sample.reflectionBlurTexels ?? '',
        sample.lightOpacity ?? '',
        sample.sourceAlphaBottom ?? '',
        sample.paintOrder,
        sample.usedRectFallback,
        ...sample.reflectionMatrix.elements,
      ]),
    )
    .join('|')

const deriveFloorY = (
  measurement: CardMeasurement,
  matrix = measurement.cardMatrix,
) => {
  if (!matrix) return Number.NaN
  const alphaBottomY = getHomeCardAlphaBottomLocalY(measurement.height)
  const bottomLeft = projectCssPoint(matrix, 0, alphaBottomY)
  const bottomRight = projectCssPoint(matrix, measurement.width, alphaBottomY)
  return (bottomLeft.y + bottomRight.y) / 2
}

const createRectFallbackMatrix = (
  measurement: CardMeasurement,
  stageRect: DOMRect,
  rect: DOMRect,
): THREE.Matrix4 => {
  const width = measurement.width || rect.width || 1
  const height = measurement.height || rect.height || 1
  return translation(rect.left - stageRect.left, rect.top - stageRect.top).multiply(
    new THREE.Matrix4().makeScale(rect.width / width, rect.height / height, 1),
  )
}

export const sampleDomGallery = (
  stage: HTMLElement,
  lockedFloor?: DomFloorLock,
): DomGallerySnapshot => {
  const stageStyle = getStyle(stage)
  const width = readElementSize(stage, stageStyle, 'width')
  const height = readElementSize(stage, stageStyle, 'height')
  const rig = stage.querySelector<HTMLElement>('.projectCameraRig')
  if (!rig) {
    const coordinateSpace: DomCoordinateSpace = 'stage-screen'
    const floorY =
      lockedFloor?.coordinateSpace === coordinateSpace && Number.isFinite(lockedFloor.floorY)
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
  const rigOrigin = parseTransformOrigin(rigStyle.transformOrigin, rigWidth, rigHeight)
  const rigMatrix = parsedRigTransform
    ? composeAroundOrigin(parsedRigTransform, rigOrigin)
    : null

  const perspective = finiteOr(parseCssLength(stageStyle.perspective), Number.POSITIVE_INFINITY)
  const perspectiveOrigin = parseTransformOrigin(stageStyle.perspectiveOrigin, width, height)
  const perspectiveMatrix = createCssPerspectiveMatrix(
    perspective,
    perspectiveOrigin.x,
    perspectiveOrigin.y,
  )

  const stageCards =
    typeof stage.querySelectorAll === 'function'
      ? Array.from(stage.querySelectorAll<HTMLElement>('.projectCard'))
      : []
  const cardElements = stageCards.length > 0
    ? stageCards
    : Array.from(rig.children).filter(
        (child): child is HTMLElement => child.classList.contains('projectCard'),
      )
  const measurements = cardElements.map<CardMeasurement>((element, domIndex) => {
    const style = getStyle(element)
    const cardWidth = readElementSize(element, style, 'width')
    const cardHeight = readElementSize(element, style, 'height')
    const parsedTransform = parseCssTransform(style.transform)
    const individualTranslate = parseCssTranslate(style.translate, cardWidth, cardHeight)
    const origin = parseTransformOrigin(style.transformOrigin, cardWidth, cardHeight)
    const left = finiteOr(parseCssLength(style.left, rigWidth), 0)
    const top = finiteOr(parseCssLength(style.top, rigHeight), 0)
    const projectIndex = finiteOr(Number.parseInt(element.dataset.projectIndex ?? '', 10), domIndex)
    const reflectionStrength = finiteOr(
      Number.parseFloat(style.getPropertyValue('--reflection-opacity')),
      1,
    )
    const slotReflectionOpacity = finiteOr(
      Number.parseFloat(style.getPropertyValue('--reflection-slot-opacity')),
      1,
    )
    const lightOpacity = finiteOr(
      Number.parseFloat(style.getPropertyValue('--reflection-light-opacity')),
      1,
    )

    return {
      element,
      carouselKey: element.dataset.carouselKey ?? String(projectIndex),
      projectId: element.dataset.projectId ?? '',
      projectIndex,
      width: cardWidth,
      height: cardHeight,
      opacity: finiteOr(Number.parseFloat(style.opacity), 1),
      reflectionOpacity: reflectionStrength * slotReflectionOpacity,
      lightOpacity,
      paintOrder: finiteOr(Number.parseInt(style.zIndex, 10), domIndex),
      cardMatrix: parsedTransform
        ? translation(left, top)
            .multiply(individualTranslate)
            .multiply(composeAroundOrigin(parsedTransform, origin))
        : null,
    }
  })

  const activeMeasurement =
    measurements.find((measurement) => measurement.element.classList.contains('active')) ??
    measurements[0]
  const useRectFallback =
    rigMatrix === null || measurements.some((measurement) => measurement.cardMatrix === null)
  const coordinateSpace: DomCoordinateSpace = useRectFallback ? 'stage-screen' : 'rig-local'
  const stageRect = useRectFallback ? stage.getBoundingClientRect() : null
  const fallbackRects = useRectFallback
    ? measurements.map((measurement) => measurement.element.getBoundingClientRect())
    : []
  const activeIndex = activeMeasurement ? measurements.indexOf(activeMeasurement) : -1
  let floorY =
    lockedFloor?.coordinateSpace === coordinateSpace && Number.isFinite(lockedFloor.floorY)
      ? lockedFloor.floorY
      : Number.NaN
  if (!Number.isFinite(floorY) && activeMeasurement) {
    const activeMatrix = useRectFallback
      ? createRectFallbackMatrix(
          activeMeasurement,
          stageRect!,
          fallbackRects[activeIndex],
        )
      : activeMeasurement.cardMatrix
    floorY = deriveFloorY(activeMeasurement, activeMatrix)
  }
  floorY = finiteOr(floorY, 0)

  const floorReflection = createFloorReflectionMatrix(floorY)
  const samples = measurements.map<DomCardSample>((measurement, index) => {
    const cardMatrix = useRectFallback
      ? createRectFallbackMatrix(measurement, stageRect!, fallbackRects[index])
      : measurement.cardMatrix!
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
      lightOpacity: measurement.lightOpacity,
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
