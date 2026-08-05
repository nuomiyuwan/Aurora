export const FRAME_RING_LIVE_REFLECTION_TEXTURE_WIDTH = 768
export const FRAME_RING_VIDEO_CURRENT_DATA_READY_STATE = 2
export const FRAME_RING_REFLECTION_SNAPSHOT_RETRY_DELAYS_MS = [
  40,
  80,
  120,
  180,
  260,
  360,
] as const

export const getFrameRingReflectionSnapshotRetryDelay = (
  retryAttempt: number,
) => {
  if (!Number.isInteger(retryAttempt) || retryAttempt < 0) return null
  return FRAME_RING_REFLECTION_SNAPSHOT_RETRY_DELAYS_MS[retryAttempt] ?? null
}

export interface FrameRingLiveReflectionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FrameRingLiveReflectionLifecycle {
  active: boolean
  suspended: boolean
  fullscreen: boolean
  documentHidden: boolean
}

export const canUpdateFrameRingLiveReflection = ({
  active,
  suspended,
  fullscreen,
  documentHidden,
}: FrameRingLiveReflectionLifecycle) =>
  active && !suspended && !fullscreen && !documentHidden

export interface FrameRingReflectionSnapshotReadiness {
  lifecycle: FrameRingLiveReflectionLifecycle
  blocked: boolean
  paused: boolean
  ended: boolean
  seeking: boolean
  readyState: number
  currentTime: number
  expectedTime: number
  timeTolerance: number
}

export const canCaptureFrameRingReflectionSnapshot = ({
  lifecycle,
  blocked,
  paused,
  ended,
  seeking,
  readyState,
  currentTime,
  expectedTime,
  timeTolerance,
}: FrameRingReflectionSnapshotReadiness) =>
  canUpdateFrameRingLiveReflection(lifecycle) &&
  !blocked &&
  (paused || ended) &&
  !seeking &&
  readyState >= FRAME_RING_VIDEO_CURRENT_DATA_READY_STATE &&
  Number.isFinite(currentTime) &&
  Number.isFinite(expectedTime) &&
  Math.abs(currentTime - expectedTime) <= Math.max(0.001, timeTolerance)

export const getFrameRingVideoCrossOrigin = (
  sourceUrl: string | null | undefined,
) =>
  sourceUrl?.startsWith('aurora-media:') ? 'anonymous' : undefined

export const resolveFrameRingObjectFitRect = (
  sourceWidth: number,
  sourceHeight: number,
  target: FrameRingLiveReflectionRect,
  objectFit: string,
  positionX = 0.5,
  positionY = 0.5,
): FrameRingLiveReflectionRect => {
  const safeSourceWidth = Math.max(1, sourceWidth)
  const safeSourceHeight = Math.max(1, sourceHeight)
  const safeTargetWidth = Math.max(1, target.width)
  const safeTargetHeight = Math.max(1, target.height)
  if (objectFit === 'fill') return { ...target }

  const containScale = Math.min(
    safeTargetWidth / safeSourceWidth,
    safeTargetHeight / safeSourceHeight,
  )
  const coverScale = Math.max(
    safeTargetWidth / safeSourceWidth,
    safeTargetHeight / safeSourceHeight,
  )
  const noneScale = 1
  const scale = objectFit === 'cover'
    ? coverScale
    : objectFit === 'none'
      ? noneScale
      : objectFit === 'scale-down'
        ? Math.min(1, containScale)
        : containScale
  const width = safeSourceWidth * scale
  const height = safeSourceHeight * scale
  return {
    x: target.x + (safeTargetWidth - width) * positionX,
    y: target.y + (safeTargetHeight - height) * positionY,
    width,
    height,
  }
}

const parseObjectPositionPart = (value: string | undefined) => {
  if (!value) return 0.5
  const normalized = value.trim().toLowerCase()
  if (normalized === 'left' || normalized === 'top') return 0
  if (normalized === 'right' || normalized === 'bottom') return 1
  if (normalized === 'center') return 0.5
  if (normalized.endsWith('%')) {
    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) ? parsed / 100 : 0.5
  }
  return 0.5
}

export const parseFrameRingObjectPosition = (value: string) => {
  const [first = 'center', second] = value.trim().split(/\s+/, 2)
  if (!second) {
    if (first === 'top' || first === 'bottom') {
      return { x: 0.5, y: parseObjectPositionPart(first) }
    }
    return { x: parseObjectPositionPart(first), y: 0.5 }
  }
  const firstIsVertical = first === 'top' || first === 'bottom'
  const secondIsHorizontal = second === 'left' || second === 'right'
  const horizontal = firstIsVertical && secondIsHorizontal ? second : first
  const vertical = firstIsVertical && secondIsHorizontal ? first : second
  return {
    x: parseObjectPositionPart(horizontal),
    y: parseObjectPositionPart(vertical),
  }
}

export const resolveFrameRingVideoCanvasRect = (
  preview: HTMLElement,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): FrameRingLiveReflectionRect | null => {
  const previewWidth = preview.offsetWidth
  const previewHeight = preview.offsetHeight
  if (previewWidth <= 0 || previewHeight <= 0) return null

  let x = 0
  let y = 0
  let element: HTMLElement | null = video
  while (element && element !== preview) {
    x += element.offsetLeft
    y += element.offsetTop
    element = element.offsetParent as HTMLElement | null
  }
  if (element !== preview) return null

  return {
    x: (x / previewWidth) * canvas.width,
    y: (y / previewHeight) * canvas.height,
    width: (video.offsetWidth / previewWidth) * canvas.width,
    height: (video.offsetHeight / previewHeight) * canvas.height,
  }
}

export interface DrawFrameRingLiveReflectionOptions {
  targetCanvas: HTMLCanvasElement
  mediaCanvas: HTMLCanvasElement
  chromeCanvas: HTMLCanvasElement
  frame: CanvasImageSource
  frameWidth: number
  frameHeight: number
  mediaRect: FrameRingLiveReflectionRect
  objectFit: string
  objectPosition: string
  colorFilter?: string
  maskImage?: CanvasImageSource | null
}

export const drawFrameRingLiveReflectionFrame = ({
  targetCanvas,
  mediaCanvas,
  chromeCanvas,
  frame,
  frameWidth,
  frameHeight,
  mediaRect,
  objectFit,
  objectPosition,
  colorFilter = 'none',
  maskImage = null,
}: DrawFrameRingLiveReflectionOptions) => {
  const targetContext = targetCanvas.getContext('2d')
  const mediaContext = mediaCanvas.getContext('2d')
  if (!targetContext || !mediaContext || frameWidth <= 0 || frameHeight <= 0) {
    return false
  }

  const position = parseFrameRingObjectPosition(objectPosition)
  const drawRect = resolveFrameRingObjectFitRect(
    frameWidth,
    frameHeight,
    mediaRect,
    objectFit,
    position.x,
    position.y,
  )

  mediaContext.clearRect(0, 0, mediaCanvas.width, mediaCanvas.height)
  mediaContext.save()
  mediaContext.beginPath()
  mediaContext.rect(
    mediaRect.x,
    mediaRect.y,
    mediaRect.width,
    mediaRect.height,
  )
  mediaContext.clip()
  mediaContext.filter = colorFilter.trim() || 'none'
  mediaContext.drawImage(
    frame,
    drawRect.x,
    drawRect.y,
    drawRect.width,
    drawRect.height,
  )
  mediaContext.restore()

  if (maskImage) {
    mediaContext.save()
    mediaContext.globalCompositeOperation = 'destination-in'
    mediaContext.drawImage(
      maskImage,
      0,
      0,
      mediaCanvas.width,
      mediaCanvas.height,
    )
    mediaContext.restore()
  }

  targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
  targetContext.drawImage(mediaCanvas, 0, 0)
  targetContext.drawImage(chromeCanvas, 0, 0)
  return true
}

let previewMaskPromise: Promise<HTMLImageElement | null> | null = null

export const loadFrameRingPreviewMask = () => {
  if (previewMaskPromise) return previewMaskPromise
  previewMaskPromise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = new URL(
      './aurora/video-kuang-alpha16x9.png',
      document.baseURI,
    ).href
  })
  return previewMaskPromise
}
