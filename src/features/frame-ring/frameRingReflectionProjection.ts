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
  VIDEO_CLIP_FALLBACK_REFLECTION_OPACITY,
  VIDEO_CLIP_REFLECTION_OPACITY,
  VIDEO_DETAIL_REFLECTION_OPACITY,
} from '../video-library/clipReflectionProjection'

export interface FrameRingReflectionSnapshot {
  width: number
  height: number
  samples: DomCardSample[]
  signature: string
}

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

const readLightOpacity = (element: HTMLElement) => {
  const light = element.querySelector<HTMLElement>(
    '.frameRingCardLight, .frameRingPreviewLight',
  )
  return light
    ? finiteOr(Number.parseFloat(getComputedStyle(light).opacity), 0)
    : 0
}

export const FRAME_RING_ALPHA_BOTTOM = 975 / 1080
export const FRAME_RING_CARD_REFLECTION_CAPACITY = 11
export const FRAME_RING_REFLECTION_SOURCE_CAPACITY = 14

const translation = (x: number, y: number, z = 0) =>
  new THREE.Matrix4().makeTranslation(x, y, z)

export const createFrameRingReflectionMatrix = (
  stageOffsetMatrix: THREE.Matrix4,
  perspectiveMatrix: THREE.Matrix4,
  floorY: number,
  cardMatrix: THREE.Matrix4,
  rigMatrix = new THREE.Matrix4(),
) =>
  createProjectedFloorReflectionMatrix(
    stageOffsetMatrix,
    perspectiveMatrix,
    rigMatrix,
    floorY,
    cardMatrix,
  )

const createRectFallbackSample = (
  element: HTMLElement,
  domIndex: number,
  rootRect: DOMRect,
): DomCardSample => {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const width = Math.max(1, element.offsetWidth || element.clientWidth || rect.width)
  const height = Math.max(1, element.offsetHeight || element.clientHeight || rect.height)
  const scaleX = rect.width / width
  const scaleY = rect.height / height
  const left = rect.left - rootRect.left
  const top = rect.top - rootRect.top
  const floorY = top + height * scaleY * FRAME_RING_ALPHA_BOTTOM
  const frameId = element.dataset.frameId ?? `frame-${domIndex}`
  const projectIndex = finiteOr(
    Number.parseInt(element.dataset.reflectionIndex ?? '', 10),
    domIndex,
  )
  const cardMatrix = translation(left, top).multiply(
    new THREE.Matrix4().makeScale(scaleX, scaleY, 1),
  )

  return {
    carouselKey: frameId,
    projectId: frameId,
    projectIndex,
    width,
    height,
    opacity: finiteOr(Number.parseFloat(style.opacity), 1),
    reflectionOpacity: VIDEO_CLIP_FALLBACK_REFLECTION_OPACITY,
    lightOpacity: readLightOpacity(element),
    paintOrder: finiteOr(Number.parseInt(style.zIndex, 10), domIndex),
    cardMatrix,
    reflectionMatrix: createFloorReflectionMatrix(floorY).multiply(cardMatrix),
    usedRectFallback: true,
  }
}

export function sampleFrameRingReflections(stage: HTMLElement): FrameRingReflectionSnapshot {
  let fallbackRootRect: DOMRect | null = null
  const getFallbackRootRect = () =>
    fallbackRootRect ??= stage.getBoundingClientRect()
  const rootWidth = Math.max(
    1,
    stage.offsetWidth || stage.clientWidth || getFallbackRootRect().width,
  )
  const rootHeight = Math.max(
    1,
    stage.offsetHeight || stage.clientHeight || getFallbackRootRect().height,
  )
  const ringStage = stage.querySelector<HTMLElement>('.frameRingStage')
  const cameraRig = ringStage?.querySelector<HTMLElement>('.frameRingCameraRig')
  const elements = Array.from(
    stage.querySelectorAll<HTMLElement>('.frameRingCard[data-frame-reflection="true"]'),
  )

  const ringStageStyle = ringStage ? getComputedStyle(ringStage) : null
  const ringStageWidth = ringStage && ringStageStyle
    ? Math.max(1, readElementSize(ringStage, ringStageStyle, 'width'))
    : 1
  const ringStageHeight = ringStage && ringStageStyle
    ? Math.max(1, readElementSize(ringStage, ringStageStyle, 'height'))
    : 1
  const ringStageLayoutOffset = ringStage ? readLayoutOffset(ringStage, stage) : null
  const stageOffsetMatrix = ringStageLayoutOffset
    ? translation(ringStageLayoutOffset.x, ringStageLayoutOffset.y)
    : new THREE.Matrix4()
  const perspectiveOrigin = ringStageStyle
    ? parseTransformOrigin(
        ringStageStyle.perspectiveOrigin,
        ringStageWidth,
        ringStageHeight,
      )
    : { x: ringStageWidth / 2, y: ringStageHeight / 2, z: 0 }
  const perspectiveMatrix = createCssPerspectiveMatrix(
    ringStageStyle
      ? finiteOr(parseCssLength(ringStageStyle.perspective), Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY,
    perspectiveOrigin.x,
    perspectiveOrigin.y,
  )
  const cameraRigStyle = cameraRig ? getComputedStyle(cameraRig) : null
  const parsedCameraRigTransform = cameraRigStyle
    ? parseCssTransform(cameraRigStyle.transform)
    : null
  const cameraRigOrigin = cameraRigStyle
    ? parseTransformOrigin(
        cameraRigStyle.transformOrigin || '50% 50%',
        ringStageWidth,
        ringStageHeight,
      )
    : { x: ringStageWidth / 2, y: ringStageHeight / 2, z: 0 }
  const cameraRigMatrix = parsedCameraRigTransform
    ? composeAroundOrigin(parsedCameraRigTransform, cameraRigOrigin)
    : null

  const candidates = elements.map((element, domIndex) => {
    const style = getComputedStyle(element)
    const frameId = element.dataset.frameId ?? `frame-${domIndex}`
    const width = Math.max(1, finiteOr(readElementSize(element, style, 'width'), 1))
    const height = Math.max(1, finiteOr(readElementSize(element, style, 'height'), 1))
    const parsedTransform = parseCssTransform(style.transform)
    const origin = parseTransformOrigin(style.transformOrigin || '50% 50%', width, height)
    const left = parseCssLength(style.left, ringStageWidth)
    const top = parseCssLength(style.top, ringStageHeight)
    const canProject = Boolean(
      ringStage &&
      ringStageLayoutOffset &&
      cameraRigMatrix &&
      parsedTransform &&
      Number.isFinite(left) &&
      Number.isFinite(top),
    )

    let sample: DomCardSample
    if (!canProject) {
      sample = createRectFallbackSample(element, domIndex, getFallbackRootRect())
    } else {
      const projectIndex = finiteOr(
        Number.parseInt(element.dataset.reflectionIndex ?? '', 10),
        domIndex,
      )
      const cardMatrix = translation(left, top).multiply(
        composeAroundOrigin(parsedTransform!, origin),
      )
      const alphaBottomY = height * FRAME_RING_ALPHA_BOTTOM
      const bottomLeft = projectCssPoint(cardMatrix, 0, alphaBottomY)
      const bottomRight = projectCssPoint(cardMatrix, width, alphaBottomY)
      const floorY = (bottomLeft.y + bottomRight.y) / 2
      const foregroundMatrix = stageOffsetMatrix
        .clone()
        .multiply(perspectiveMatrix)
        .multiply(cameraRigMatrix!)
        .multiply(cardMatrix)

      sample = {
        carouselKey: frameId,
        projectId: frameId,
        projectIndex,
        width,
        height,
        opacity: finiteOr(Number.parseFloat(style.opacity), 1),
        reflectionOpacity: VIDEO_CLIP_REFLECTION_OPACITY,
        lightOpacity: readLightOpacity(element),
        paintOrder: finiteOr(Number.parseInt(style.zIndex, 10), domIndex),
        cardMatrix: foregroundMatrix,
        reflectionMatrix: createFrameRingReflectionMatrix(
          stageOffsetMatrix,
          perspectiveMatrix,
          floorY,
          cardMatrix,
          cameraRigMatrix!,
        ),
        usedRectFallback: false,
      }
    }
    return {
      sample,
      distanceFromCenter: Math.abs(
        finiteOr(Number.parseFloat(element.dataset.frameOffset ?? ''), domIndex),
      ),
      domIndex,
    }
  })

  const cardSamples = candidates
    .sort(
      (left, right) =>
        left.distanceFromCenter - right.distanceFromCenter ||
        left.domIndex - right.domIndex,
    )
    .slice(0, FRAME_RING_CARD_REFLECTION_CAPACITY)
    .map(({ sample }) => sample)

  const floatingStage = stage.querySelector<HTMLElement>('.frameRingFloatingStage')
  const floatingRig = floatingStage?.querySelector<HTMLElement>('.frameRingFloatingCameraRig')
  const floatingElements = Array.from(
    stage.querySelectorAll<HTMLElement>(
      '.frameRingFloatingObject[data-frame-reflection="true"]',
    ),
  ).filter((element) => Boolean(element.dataset.reflectionProjectId))
  const floatingStageStyle = floatingStage ? getComputedStyle(floatingStage) : null
  const floatingStageLayoutOffset = floatingStage
    ? readLayoutOffset(floatingStage, stage)
    : null
  const floatingStageWidth = floatingStage && floatingStageStyle
    ? Math.max(1, readElementSize(floatingStage, floatingStageStyle, 'width'))
    : rootWidth
  const floatingStageHeight = floatingStage && floatingStageStyle
    ? Math.max(1, readElementSize(floatingStage, floatingStageStyle, 'height'))
    : rootHeight
  const floatingOffsetMatrix = floatingStageLayoutOffset
    ? translation(
        floatingStageLayoutOffset.x,
        floatingStageLayoutOffset.y,
      )
    : new THREE.Matrix4()
  const floatingPerspectiveOrigin = floatingStageStyle
    ? parseTransformOrigin(
        floatingStageStyle.perspectiveOrigin,
        floatingStageWidth,
        floatingStageHeight,
      )
    : { x: floatingStageWidth / 2, y: floatingStageHeight / 2, z: 0 }
  const floatingPerspectiveMatrix = createCssPerspectiveMatrix(
    floatingStageStyle
      ? finiteOr(
          parseCssLength(floatingStageStyle.perspective),
          Number.POSITIVE_INFINITY,
        )
      : Number.POSITIVE_INFINITY,
    floatingPerspectiveOrigin.x,
    floatingPerspectiveOrigin.y,
  )
  const floatingRigStyle = floatingRig ? getComputedStyle(floatingRig) : null
  const floatingRigTransform = floatingRigStyle
    ? parseCssTransform(floatingRigStyle.transform)
    : null
  const floatingRigOrigin = floatingRigStyle
    ? parseTransformOrigin(
        floatingRigStyle.transformOrigin || '50% 50%',
        floatingStageWidth,
        floatingStageHeight,
      )
    : { x: floatingStageWidth / 2, y: floatingStageHeight / 2, z: 0 }
  const floatingRigMatrix = floatingRigTransform
    ? composeAroundOrigin(floatingRigTransform, floatingRigOrigin)
    : null
  const rootStyle = floatingElements.length > 0 ? getComputedStyle(stage) : null
  const floatingFloorY = finiteOr(
    rootStyle
      ? parseCssLength(
          rootStyle.getPropertyValue('--frame-ring-floating-floor-y'),
          floatingStageHeight,
        )
      : Number.NaN,
    floatingStageHeight * 0.78,
  )

  const floatingSamples = floatingElements.map<DomCardSample>((element, index) => {
    const style = getComputedStyle(element)
    const visualWidth = Math.max(
      1,
      finiteOr(readElementSize(element, style, 'width'), 1),
    )
    const visualHeight = Math.max(
      1,
      finiteOr(readElementSize(element, style, 'height'), 1),
    )
    const sourceHeight = element.dataset.reflectionPadded === 'true'
      ? visualHeight / FRAME_RING_ALPHA_BOTTOM
      : visualHeight
    const parsedTransform = parseCssTransform(style.transform)
    const origin = parseTransformOrigin(
      style.transformOrigin || '50% 50%',
      visualWidth,
      visualHeight,
    )
    const left = parseCssLength(style.left, floatingStageWidth)
    const top = parseCssLength(style.top, floatingStageHeight)
    const projectId = element.dataset.reflectionProjectId ?? `frame-ring-floating-${index}`
    const projectIndex = finiteOr(
      Number.parseInt(element.dataset.reflectionIndex ?? '', 10),
      FRAME_RING_CARD_REFLECTION_CAPACITY + index,
    )
    const reflectionOpacity = element.classList.contains('frameRingPreview') ||
      element.classList.contains('frameRingActionReflectionProxy')
      ? VIDEO_CLIP_REFLECTION_OPACITY
      : VIDEO_DETAIL_REFLECTION_OPACITY
    const lightOpacity = readLightOpacity(element)
    const reflectionOffsetX = finiteOr(
      parseCssLength(
        style.getPropertyValue('--frame-ring-reflection-x'),
        rootWidth,
      ),
      0,
    )
    const reflectionOffsetY = finiteOr(
      parseCssLength(
        style.getPropertyValue('--frame-ring-reflection-y'),
        rootHeight,
      ),
      0,
    )
    const reflectionOffsetMatrix = translation(
      reflectionOffsetX,
      reflectionOffsetY,
    )
    const canProject = Boolean(
      floatingStage &&
      floatingStageLayoutOffset &&
      floatingRigMatrix &&
      parsedTransform &&
      Number.isFinite(left) &&
      Number.isFinite(top),
    )

    if (!canProject) {
      const rect = element.getBoundingClientRect()
      const floatingStageRect = floatingStage?.getBoundingClientRect()
      const rootRect = getFallbackRootRect()
      const scaleX = rect.width / visualWidth
      const scaleY = rect.height / visualHeight
      const cardMatrix = translation(
        rect.left - rootRect.left,
        rect.top - rootRect.top,
      ).multiply(new THREE.Matrix4().makeScale(scaleX, scaleY, 1))
      const screenFloorY =
        (floatingStageLayoutOffset?.y ?? (floatingStageRect?.top ?? rootRect.top) - rootRect.top) +
        floatingFloorY
      return {
        carouselKey: projectId,
        projectId,
        projectIndex,
        width: visualWidth,
        height: sourceHeight,
        opacity: finiteOr(Number.parseFloat(style.opacity), 1),
        reflectionOpacity,
        lightOpacity,
        paintOrder: finiteOr(Number.parseInt(style.zIndex, 10), 20 + index),
        cardMatrix,
        reflectionMatrix: reflectionOffsetMatrix
          .clone()
          .multiply(createFloorReflectionMatrix(screenFloorY))
          .multiply(cardMatrix),
        usedRectFallback: true,
      }
    }

    const localMatrix = translation(left, top).multiply(
      composeAroundOrigin(parsedTransform!, origin),
    )
    const foregroundMatrix = floatingOffsetMatrix
      .clone()
      .multiply(floatingPerspectiveMatrix)
      .multiply(floatingRigMatrix!)
      .multiply(localMatrix)
    return {
      carouselKey: projectId,
      projectId,
      projectIndex,
      width: visualWidth,
      height: sourceHeight,
      opacity: finiteOr(Number.parseFloat(style.opacity), 1),
      reflectionOpacity,
      lightOpacity,
      paintOrder: finiteOr(Number.parseInt(style.zIndex, 10), 20 + index),
      cardMatrix: foregroundMatrix,
      reflectionMatrix: reflectionOffsetMatrix.multiply(
        createFrameRingReflectionMatrix(
          floatingOffsetMatrix,
          floatingPerspectiveMatrix,
          floatingFloorY,
          localMatrix,
          floatingRigMatrix!,
        ),
      ),
      usedRectFallback: false,
    }
  })

  const samples = [...cardSamples, ...floatingSamples].slice(
    0,
    FRAME_RING_REFLECTION_SOURCE_CAPACITY,
  )

  return {
    width: rootWidth,
    height: rootHeight,
    samples,
    signature: createSampleSignature(samples),
  }
}
