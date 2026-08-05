import {
  PARTICLE_PNG_MAX_BYTES,
  PARTICLE_PNG_MAX_EDGE,
  PARTICLE_VIDEO_MAX_DURATION_SECONDS,
  PARTICLE_VIDEO_SOURCE_MAX_BYTES,
  type CustomParticleMedia,
} from './particleSettings'

const ALPHA_SAMPLE_EDGE = 128
const TRANSPARENT_ALPHA_THRESHOLD = 250

const waitForEvent = (
  target: EventTarget,
  eventName: string,
  errorEventName = 'error',
) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, handleReady)
      target.removeEventListener(errorEventName, handleError)
    }
    const handleReady = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('素材无法解码'))
    }
    target.addEventListener(eventName, handleReady, { once: true })
    target.addEventListener(errorEventName, handleError, { once: true })
  })

const hasTransparentPixels = (
  source: CanvasImageSource,
  width: number,
  height: number,
) => {
  const sampleScale = Math.min(
    1,
    ALPHA_SAMPLE_EDGE / Math.max(1, width),
    ALPHA_SAMPLE_EDGE / Math.max(1, height),
  )
  const sampleWidth = Math.max(1, Math.round(width * sampleScale))
  const sampleHeight = Math.max(1, Math.round(height * sampleScale))
  const canvas = document.createElement('canvas')
  canvas.width = sampleWidth
  canvas.height = sampleHeight
  const context = canvas.getContext('2d', {
    alpha: true,
    willReadFrequently: true,
  })
  if (!context) throw new Error('无法检查素材透明通道')
  context.clearRect(0, 0, sampleWidth, sampleHeight)
  context.drawImage(source, 0, 0, sampleWidth, sampleHeight)
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < TRANSPARENT_ALPHA_THRESHOLD) return true
  }
  return false
}

const createPoster = (
  source: CanvasImageSource,
  width: number,
  height: number,
) => {
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 256 / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('无法生成素材预览')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

const validatePng = async (
  file: File,
  objectUrl: string,
): Promise<CustomParticleMedia> => {
  if (file.size > PARTICLE_PNG_MAX_BYTES) {
    throw new Error('PNG 不能超过 8 MB')
  }
  const bitmap = await createImageBitmap(file)
  try {
    if (
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width > PARTICLE_PNG_MAX_EDGE ||
      bitmap.height > PARTICLE_PNG_MAX_EDGE ||
      bitmap.width * bitmap.height > PARTICLE_PNG_MAX_EDGE ** 2
    ) {
      throw new Error('PNG 边长不能超过 1024 像素')
    }
    if (!hasTransparentPixels(bitmap, bitmap.width, bitmap.height)) {
      throw new Error('PNG 未检测到透明背景')
    }
    return {
      kind: 'image',
      name: file.name,
      url: objectUrl,
      posterUrl: objectUrl,
      width: bitmap.width,
      height: bitmap.height,
      durationSeconds: null,
      sizeBytes: file.size,
      managedPath: null,
      posterPath: null,
    }
  } finally {
    bitmap.close()
  }
}

const seekVideo = async (video: HTMLVideoElement, time: number) => {
  if (!Number.isFinite(time) || time <= 0) return
  const ready = waitForEvent(video, 'seeked')
  video.currentTime = time
  await ready
}

const validateVideo = async (
  file: File,
  objectUrl: string,
): Promise<CustomParticleMedia> => {
  if (file.size > PARTICLE_VIDEO_SOURCE_MAX_BYTES) {
    throw new Error('透明视频源文件不能超过 200 MB')
  }
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = objectUrl
  await waitForEvent(video, 'loadedmetadata')
  if (
    video.videoWidth <= 0 ||
    video.videoHeight <= 0 ||
    video.videoWidth > 1024 ||
    video.videoHeight > 1024
  ) {
    throw new Error('透明视频源素材边长不能超过 1024 像素')
  }
  if (
    !Number.isFinite(video.duration) ||
    video.duration <= 0 ||
    video.duration > PARTICLE_VIDEO_MAX_DURATION_SECONDS
  ) {
    throw new Error('透明视频时长需在 10 秒以内')
  }
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await waitForEvent(video, 'loadeddata')
  }
  await seekVideo(video, Math.min(video.duration * 0.35, 1))
  if (!hasTransparentPixels(video, video.videoWidth, video.videoHeight)) {
    throw new Error('视频未检测到可用的 Alpha 通道')
  }
  const width = video.videoWidth
  const height = video.videoHeight
  const durationSeconds = video.duration
  const posterUrl = createPoster(video, width, height)
  video.pause()
  video.removeAttribute('src')
  video.load()
  return {
    kind: 'video',
    name: file.name,
    url: objectUrl,
    posterUrl,
    width,
    height,
    durationSeconds,
    sizeBytes: file.size,
    managedPath: null,
    posterPath: null,
  }
}

export const validateParticleMediaInBrowser = async (
  file: File,
  objectUrl: string,
) => {
  const lowerName = file.name.toLocaleLowerCase()
  const isPng = file.type === 'image/png' || lowerName.endsWith('.png')
  const isVideo =
    file.type === 'video/webm' ||
    file.type === 'video/quicktime' ||
    lowerName.endsWith('.webm') ||
    lowerName.endsWith('.mov')
  if (isPng) return validatePng(file, objectUrl)
  if (isVideo) return validateVideo(file, objectUrl)
  throw new Error('仅支持带透明通道的 PNG、WebM 或 MOV')
}
