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
  DISCOVERY_DETAIL_ALPHA_BOTTOM,
  DISCOVERY_DETAIL_REFLECTION_ID,
  DISCOVERY_REFLECTION_ELEVATION_FADE_END,
  DISCOVERY_REFLECTION_ELEVATION_FADE_START,
  DISCOVERY_REFLECTION_ELEVATION_MAX_BLUR_TEXELS,
  DISCOVERY_REFLECTION_ELEVATION_MIN_OPACITY_FACTOR,
  DISCOVERY_REFLECTION_OPACITY,
  DISCOVERY_RESULT_ALPHA_BOTTOM,
  DISCOVERY_RESULT_SHARED_FLOOR_Y,
} from './discoveryReflectionSource'

export interface DiscoveryReflectionSnapshot {
  width: number
  height: number
  samples: DomCardSample[]
  signature: string
  fallbackCount: number
}

type DiscoveryProjectionContext = {
  root: HTMLElement
  rootRect: DOMRect
  spatialWidth: number
  spatialHeight: number
  outerMatrix: THREE.Matrix4
  perspectiveMatrix: THREE.Matrix4
  rigMatrix: THREE.Matrix4
  rig: HTMLElement
}

type DiscoveryFloorLock = {
  rigLocalY: number
  screenY?: number
}

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

const clampUnit = (value: number) => Math.min(1, Math.max(0, value))

const getElevationReflectionTreatment = (
  measuredFloorY: number,
  lockedFloorY: number,
) => {
  const elevation = Math.max(0, lockedFloorY - measuredFloorY)
  const fadeRange = Math.max(
    1,
    DISCOVERY_REFLECTION_ELEVATION_FADE_END -
      DISCOVERY_REFLECTION_ELEVATION_FADE_START,
  )
  const progress = clampUnit(
    (elevation - DISCOVERY_REFLECTION_ELEVATION_FADE_START) /
      fadeRange,
  )
  const easedProgress = progress * progress * (3 - 2 * progress)

  return {
    opacityFactor:
      1 -
      easedProgress *
        (1 - DISCOVERY_REFLECTION_ELEVATION_MIN_OPACITY_FACTOR),
    blurTexels:
      easedProgress *
      DISCOVERY_REFLECTION_ELEVATION_MAX_BLUR_TEXELS,
  }
}

const translation = (x: number, y: number, z = 0) =>
  new THREE.Matrix4().makeTranslation(x, y, z)

const parseIndividualScale = (value: string) => {
  const source = value.trim()
  if (!source || source === 'none') return new THREE.Matrix4()
  const values = source.split(/\s+/).map(Number.parseFloat)
  if (values.length === 0 || values.some((entry) => !Number.isFinite(entry))) {
    return null
  }
  const scaleX = values[0]
  const scaleY = values[1] ?? scaleX
  const scaleZ = values[2] ?? 1
  return new THREE.Matrix4().makeScale(scaleX, scaleY, scaleZ)
}

const parseCssZoom = (value: string) => {
  const source = value.trim()
  if (!source || source === 'normal') return 1
  const parsed = Number.parseFloat(source)
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return source.endsWith('%') ? parsed / 100 : parsed
}

const parseElementTransform = (style: CSSStyleDeclaration) => {
  const transform = parseCssTransform(style.transform)
  const scale = parseIndividualScale(style.getPropertyValue('scale'))
  if (!transform || !scale) return null
  return scale.multiply(transform)
}

const readOpacity = (element: HTMLElement) => {
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return 0
  return finiteOr(Number.parseFloat(style.opacity), 1)
}

const createProjectionContext = (
  root: HTMLElement,
  rootRect: DOMRect,
): DiscoveryProjectionContext | null => {
  const plane = root.querySelector<HTMLElement>('.discoveryPlane')
  const spatialStage = plane?.querySelector<HTMLElement>(
    '.discoverySpatialStage',
  )
  const rig = spatialStage?.querySelector<HTMLElement>('.discoveryCameraRig')
  if (!plane || !spatialStage || !rig) return null

  const planeStyle = getComputedStyle(plane)
  const planeWidth = Math.max(1, readElementSize(plane, planeStyle, 'width'))
  const planeHeight = Math.max(1, readElementSize(plane, planeStyle, 'height'))
  const planeOffset = readLayoutOffset(plane, root)
  const parsedPlaneTransform = parseElementTransform(planeStyle)
  if (!planeOffset || !parsedPlaneTransform) return null
  const planeZoom = parseCssZoom(planeStyle.zoom)
  const planeOrigin = parseTransformOrigin(
    planeStyle.transformOrigin || '0 0',
    planeWidth,
    planeHeight,
  )
  const planeMatrix = translation(
    planeOffset.x * planeZoom,
    planeOffset.y * planeZoom,
  )
    .multiply(new THREE.Matrix4().makeScale(planeZoom, planeZoom, planeZoom))
    .multiply(composeAroundOrigin(parsedPlaneTransform, planeOrigin))

  const spatialStyle = getComputedStyle(spatialStage)
  const spatialWidth = Math.max(
    1,
    readElementSize(spatialStage, spatialStyle, 'width'),
  )
  const spatialHeight = Math.max(
    1,
    readElementSize(spatialStage, spatialStyle, 'height'),
  )
  const spatialOffset = readLayoutOffset(spatialStage, plane)
  if (!spatialOffset) return null
  const perspectiveOrigin = parseTransformOrigin(
    spatialStyle.perspectiveOrigin || '50% 50%',
    spatialWidth,
    spatialHeight,
  )
  const perspectiveMatrix = createCssPerspectiveMatrix(
    finiteOr(
      parseCssLength(spatialStyle.perspective),
      Number.POSITIVE_INFINITY,
    ),
    perspectiveOrigin.x,
    perspectiveOrigin.y,
  )

  const rigStyle = getComputedStyle(rig)
  const rigTransform = parseElementTransform(rigStyle)
  const rigOffset = readLayoutOffset(rig, spatialStage)
  if (!rigTransform || !rigOffset) return null
  const rigWidth = Math.max(
    1,
    readElementSize(rig, rigStyle, 'width') || spatialWidth,
  )
  const rigHeight = Math.max(
    1,
    readElementSize(rig, rigStyle, 'height') || spatialHeight,
  )
  const rigOrigin = parseTransformOrigin(
    rigStyle.transformOrigin || '50% 50%',
    rigWidth,
    rigHeight,
  )

  return {
    root,
    rootRect,
    spatialWidth,
    spatialHeight,
    outerMatrix: planeMatrix.multiply(
      translation(spatialOffset.x, spatialOffset.y),
    ),
    perspectiveMatrix,
    rigMatrix: translation(rigOffset.x, rigOffset.y).multiply(
      composeAroundOrigin(rigTransform, rigOrigin),
    ),
    rig,
  }
}

const createRectFallbackSample = (
  element: HTMLElement,
  rootRect: DOMRect,
  projectId: string,
  projectIndex: number,
  alphaBottom: number,
  paintOrder: number,
  opacity: number,
  lockedFloorY?: number,
): DomCardSample => {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const width = Math.max(1, readElementSize(element, style, 'width') || rect.width)
  const height = Math.max(
    1,
    readElementSize(element, style, 'height') || rect.height,
  )
  const scaleX = rect.width / width
  const scaleY = rect.height / height
  const left = rect.left - rootRect.left
  const top = rect.top - rootRect.top
  const measuredFloorY = top + height * scaleY * alphaBottom
  const floorY = finiteOr(lockedFloorY ?? Number.NaN, measuredFloorY)
  const cardMatrix = translation(left, top).multiply(
    new THREE.Matrix4().makeScale(scaleX, scaleY, 1),
  )

  return {
    carouselKey: projectId,
    projectId,
    projectIndex,
    width,
    height,
    opacity,
    reflectionOpacity: DISCOVERY_REFLECTION_OPACITY,
    reflectionBlurTexels: 0,
    lightOpacity: 0,
    sourceAlphaBottom: alphaBottom,
    paintOrder,
    cardMatrix,
    reflectionMatrix: createFloorReflectionMatrix(floorY).multiply(cardMatrix),
    usedRectFallback: true,
  }
}

const sampleElement = (
  element: HTMLElement,
  context: DiscoveryProjectionContext | null,
  rootRect: DOMRect,
  projectId: string,
  projectIndex: number,
  alphaBottom: number,
  minimumPaintOrder = 0,
  floorLock?: DiscoveryFloorLock,
): DomCardSample => {
  const style = getComputedStyle(element)
  const motion = element.querySelector<HTMLElement>('.discoveryResultMotion')
  const visual = element.querySelector<HTMLElement>(
    '.discoveryResultVisual[data-discovery-reflection-id]',
  )
  const opacity =
    readOpacity(element) *
    (motion ? readOpacity(motion) : 1) *
    (visual ? readOpacity(visual) : 1)
  const paintOrder = Math.max(
    minimumPaintOrder,
    finiteOr(Number.parseInt(style.zIndex, 10), projectIndex),
  )

  if (context) {
    const width = Math.max(1, readElementSize(element, style, 'width'))
    const height = Math.max(1, readElementSize(element, style, 'height'))
    const layoutOffset = readLayoutOffset(element, context.rig)
    const parsedTransform = parseElementTransform(style)
    if (layoutOffset && parsedTransform) {
      const origin = parseTransformOrigin(
        style.transformOrigin || '50% 50%',
        width,
        height,
      )
      const localMatrix = translation(layoutOffset.x, layoutOffset.y).multiply(
        composeAroundOrigin(parsedTransform, origin),
      )
      let paintLocalMatrix = localMatrix
      if (motion) {
        const motionStyle = getComputedStyle(motion)
        const motionTransform = parseElementTransform(motionStyle)
        const motionOffset = readLayoutOffset(motion, element)
        if (motionTransform && motionOffset) {
          const motionWidth = Math.max(
            1,
            readElementSize(motion, motionStyle, 'width') || width,
          )
          const motionHeight = Math.max(
            1,
            readElementSize(motion, motionStyle, 'height') || height,
          )
          const motionOrigin = parseTransformOrigin(
            motionStyle.transformOrigin || '50% 50%',
            motionWidth,
            motionHeight,
          )
          paintLocalMatrix = localMatrix
            .clone()
            .multiply(translation(motionOffset.x, motionOffset.y))
            .multiply(composeAroundOrigin(motionTransform, motionOrigin))
        }
      }
      const alphaBottomY = height * alphaBottom
      const bottomLeft = projectCssPoint(paintLocalMatrix, 0, alphaBottomY)
      const bottomRight = projectCssPoint(paintLocalMatrix, width, alphaBottomY)
      const measuredFloorY = (bottomLeft.y + bottomRight.y) / 2
      const floorY = finiteOr(floorLock?.rigLocalY ?? Number.NaN, measuredFloorY)
      const elevationTreatment = getElevationReflectionTreatment(
        measuredFloorY,
        floorY,
      )
      const cardMatrix = context.outerMatrix
        .clone()
        .multiply(context.perspectiveMatrix)
        .multiply(context.rigMatrix)
        .multiply(paintLocalMatrix)

      return {
        carouselKey: projectId,
        projectId,
        projectIndex,
        width,
        height,
        opacity,
        reflectionOpacity:
          DISCOVERY_REFLECTION_OPACITY *
          elevationTreatment.opacityFactor,
        reflectionBlurTexels: elevationTreatment.blurTexels,
        lightOpacity: 0,
        sourceAlphaBottom: alphaBottom,
        paintOrder,
        cardMatrix,
        reflectionMatrix: createProjectedFloorReflectionMatrix(
          context.outerMatrix,
          context.perspectiveMatrix,
          context.rigMatrix,
          floorY,
          paintLocalMatrix,
        ),
        usedRectFallback: false,
      }
    }
  }

  return createRectFallbackSample(
    motion ?? element,
    rootRect,
    projectId,
    projectIndex,
    alphaBottom,
    paintOrder,
    opacity,
    floorLock?.screenY,
  )
}

const readRectFloorY = (
  element: HTMLElement,
  rootRect: DOMRect,
  alphaBottom: number,
) => {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const height = Math.max(
    1,
    readElementSize(element, style, 'height') || rect.height,
  )
  const scaleY = rect.height / height
  return rect.top - rootRect.top + height * scaleY * alphaBottom
}

export function sampleDiscoveryReflections(
  stage: HTMLElement,
): DiscoveryReflectionSnapshot {
  const rootWidth = Math.max(
    1,
    stage.offsetWidth || stage.clientWidth || stage.getBoundingClientRect().width,
  )
  const rootHeight = Math.max(
    1,
    stage.offsetHeight ||
      stage.clientHeight ||
      stage.getBoundingClientRect().height,
  )
  const activeRoot = stage.matches(
    '.discoveryView[data-page-active="true"]',
  )
    ? stage
    : stage.querySelector<HTMLElement>(
        '.discoveryView[data-page-active="true"]',
      )

  if (!activeRoot) {
    return {
      width: rootWidth,
      height: rootHeight,
      samples: [],
      signature: '',
      fallbackCount: 0,
    }
  }

  const rootRect = activeRoot.getBoundingClientRect()
  const context = createProjectionContext(activeRoot, rootRect)
  const cards = Array.from(
    activeRoot.querySelectorAll<HTMLElement>(
      '.discoveryResultCard[data-discovery-reflection]',
    ),
  )
  const floorAnchor =
    cards.find(
      (card) =>
        card.dataset.discoveryReflectionFloorAnchor === 'true',
    ) ??
    cards.find((card) => card.classList.contains('selected')) ??
    cards[0]
  const resultFloorLock: DiscoveryFloorLock = {
    rigLocalY: DISCOVERY_RESULT_SHARED_FLOOR_Y,
    screenY: floorAnchor
      ? readRectFloorY(floorAnchor, rootRect, DISCOVERY_RESULT_ALPHA_BOTTOM)
      : undefined,
  }
  const samples = cards.map((card, index) => {
    const projectId =
      card.dataset.discoveryReflectionId ?? `discovery-result-${index}`
    const projectIndex = finiteOr(
      Number.parseInt(card.dataset.reflectionIndex ?? '', 10),
      index,
    )
    return sampleElement(
      card,
      context,
      rootRect,
      projectId,
      projectIndex,
      DISCOVERY_RESULT_ALPHA_BOTTOM,
      0,
      resultFloorLock,
    )
  })

  const detailPanel = activeRoot.querySelector<HTMLElement>(
    '.discoveryDetailPanel[data-discovery-detail-reflection]',
  )
  if (detailPanel) {
    const projectIndex = finiteOr(
      Number.parseInt(detailPanel.dataset.reflectionIndex ?? '', 10),
      cards.length,
    )
    samples.push(
      sampleElement(
        detailPanel,
        context,
        rootRect,
        DISCOVERY_DETAIL_REFLECTION_ID,
        projectIndex,
        DISCOVERY_DETAIL_ALPHA_BOTTOM,
        100,
      ),
    )
  }

  const fallbackCount = samples.reduce(
    (count, sample) => count + Number(sample.usedRectFallback),
    0,
  )

  return {
    width: Math.max(1, activeRoot.offsetWidth || rootWidth),
    height: Math.max(1, activeRoot.offsetHeight || rootHeight),
    samples,
    signature: createSampleSignature(samples),
    fallbackCount,
  }
}
