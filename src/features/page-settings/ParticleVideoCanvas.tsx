import { useEffect, useRef } from 'react'

export type ParticleCanvasPoint = {
  x: number
  y: number
}

export type ParticleCanvasSprite = {
  id: string | number
  start: ParticleCanvasPoint
  control1: ParticleCanvasPoint
  control2: ParticleCanvasPoint
  end: ParticleCanvasPoint
  duration: number
  delay: number
  opacity: number
  size: number
  trail: number
  trailOpacity: number
  rotationSeed: number
}

export type ParticleVideoCanvasProps = {
  src: string
  active: boolean
  width: number
  height: number
  sprites: readonly ParticleCanvasSprite[]
  rotationSpeed: number
  trailRgb: string
}

type VideoFrameMetadata = {
  mediaTime?: number
}

type VideoWithFrameCallbacks = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameMetadata) => void,
  ) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

type CanvasSource = HTMLCanvasElement | OffscreenCanvas

const PARTICLE_ROTATION_SECONDS = 8
const MAX_DEVICE_PIXEL_RATIO = 2
const TWO_PI = Math.PI * 2

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

function sampleCubicBezier(
  start: ParticleCanvasPoint,
  control1: ParticleCanvasPoint,
  control2: ParticleCanvasPoint,
  end: ParticleCanvasPoint,
  progress: number,
) {
  const inverse = 1 - progress
  const inverseSquared = inverse * inverse
  const progressSquared = progress * progress
  return {
    x:
      inverseSquared * inverse * start.x +
      3 * inverseSquared * progress * control1.x +
      3 * inverse * progressSquared * control2.x +
      progressSquared * progress * end.x,
    y:
      inverseSquared * inverse * start.y +
      3 * inverseSquared * progress * control1.y +
      3 * inverse * progressSquared * control2.y +
      progressSquared * progress * end.y,
  }
}

function sampleCubicBezierTangent(
  start: ParticleCanvasPoint,
  control1: ParticleCanvasPoint,
  control2: ParticleCanvasPoint,
  end: ParticleCanvasPoint,
  progress: number,
) {
  const inverse = 1 - progress
  return {
    x:
      3 * inverse * inverse * (control1.x - start.x) +
      6 * inverse * progress * (control2.x - control1.x) +
      3 * progress * progress * (end.x - control2.x),
    y:
      3 * inverse * inverse * (control1.y - start.y) +
      6 * inverse * progress * (control2.y - control1.y) +
      3 * progress * progress * (end.y - control2.y),
  }
}

const MOTION_KEYFRAMES = [
  { progress: 0, opacity: 0, scale: 0.72 },
  { progress: 0.08, opacity: 1, scale: 0.86 },
  { progress: 0.48, opacity: 0.96, scale: 1 },
  { progress: 0.9, opacity: 0.9, scale: 1.08 },
  { progress: 1, opacity: 0, scale: 1.18 },
] as const

function sampleMotionKeyframes(progress: number) {
  const normalized = clamp(progress, 0, 1)
  for (let index = 1; index < MOTION_KEYFRAMES.length; index += 1) {
    const previous = MOTION_KEYFRAMES[index - 1]
    const next = MOTION_KEYFRAMES[index]
    if (normalized > next.progress) continue
    const span = next.progress - previous.progress
    const amount = span > 0 ? (normalized - previous.progress) / span : 0
    return {
      opacity: previous.opacity + (next.opacity - previous.opacity) * amount,
      scale: previous.scale + (next.scale - previous.scale) * amount,
    }
  }
  return MOTION_KEYFRAMES[MOTION_KEYFRAMES.length - 1]
}

function normalizeRgb(value: string) {
  const channels = value.match(/-?\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return '222, 238, 255'
  }
  return channels.map((channel) => Math.round(clamp(channel, 0, 255))).join(', ')
}

function createCanvasSource(): CanvasSource {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1)
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas
}

function resizeCanvasSource(source: CanvasSource, width: number, height: number) {
  if (source.width !== width) source.width = width
  if (source.height !== height) source.height = height
}

export function ParticleVideoCanvas({
  src,
  active,
  width,
  height,
  sprites,
  rotationSpeed,
  trailRgb,
}: ParticleVideoCanvasProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceCanvasRef = useRef<CanvasSource | null>(null)
  const sourceFrameReadyRef = useRef(false)
  const elapsedSecondsRef = useRef(0)
  const latestPropsRef = useRef({
    width,
    height,
    sprites,
    rotationSpeed,
    trailRgb,
  })

  latestPropsRef.current = {
    width,
    height,
    sprites,
    rotationSpeed,
    trailRgb,
  }

  useEffect(() => {
    const video = videoRef.current as VideoWithFrameCallbacks | null
    const canvas = canvasRef.current
    if (!video || !canvas) return

    let disposed = false
    let running = false
    let mainAnimationFrame: number | undefined
    let videoFrameCallback: number | undefined
    let fallbackVideoFrame: number | undefined
    let previousMainTimestamp: number | undefined
    let previousFallbackMediaTime = Number.NaN

    sourceFrameReadyRef.current = false
    const visibleContext = canvas.getContext('2d', { alpha: true })
    if (!visibleContext) return

    const clearVisibleCanvas = () => {
      const logicalWidth = Math.max(0, finiteOr(latestPropsRef.current.width, 0))
      const logicalHeight = Math.max(0, finiteOr(latestPropsRef.current.height, 0))
      const devicePixelRatio = Math.min(
        MAX_DEVICE_PIXEL_RATIO,
        Math.max(1, finiteOr(window.devicePixelRatio, 1)),
      )
      const pixelWidth = Math.max(1, Math.round(logicalWidth * devicePixelRatio))
      const pixelHeight = Math.max(1, Math.round(logicalHeight * devicePixelRatio))
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      canvas.style.width = `${logicalWidth}px`
      canvas.style.height = `${logicalHeight}px`
      visibleContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      visibleContext.clearRect(0, 0, logicalWidth, logicalHeight)
      return { logicalWidth, logicalHeight, devicePixelRatio }
    }

    const copyPresentedVideoFrame = () => {
      if (
        disposed ||
        !running ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0
      ) {
        return
      }

      const source = sourceCanvasRef.current ?? createCanvasSource()
      sourceCanvasRef.current = source
      resizeCanvasSource(source, video.videoWidth, video.videoHeight)
      const sourceContext = source.getContext('2d', { alpha: true })
      if (!sourceContext) return
      sourceContext.setTransform(1, 0, 0, 1, 0, 0)
      sourceContext.clearRect(0, 0, source.width, source.height)
      sourceContext.drawImage(video, 0, 0, source.width, source.height)
      sourceFrameReadyRef.current = true
    }

    const cancelVideoFrameLoop = () => {
      if (videoFrameCallback !== undefined) {
        video.cancelVideoFrameCallback?.(videoFrameCallback)
        videoFrameCallback = undefined
      }
      if (fallbackVideoFrame !== undefined) {
        window.cancelAnimationFrame(fallbackVideoFrame)
        fallbackVideoFrame = undefined
      }
    }

    const scheduleVideoFrame = () => {
      if (disposed || !running || videoFrameCallback !== undefined || fallbackVideoFrame !== undefined) {
        return
      }

      if (video.requestVideoFrameCallback) {
        videoFrameCallback = video.requestVideoFrameCallback(() => {
          videoFrameCallback = undefined
          if (!running || disposed) return
          copyPresentedVideoFrame()
          scheduleVideoFrame()
        })
        return
      }

      const pollVideoFrame = () => {
        fallbackVideoFrame = undefined
        if (!running || disposed) return
        if (
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.currentTime !== previousFallbackMediaTime
        ) {
          previousFallbackMediaTime = video.currentTime
          copyPresentedVideoFrame()
        }
        scheduleVideoFrame()
      }
      fallbackVideoFrame = window.requestAnimationFrame(pollVideoFrame)
    }

    const drawParticles = (timestamp: number) => {
      mainAnimationFrame = undefined
      if (!running || disposed) return

      if (previousMainTimestamp !== undefined) {
        elapsedSecondsRef.current += Math.max(0, (timestamp - previousMainTimestamp) / 1000)
      }
      previousMainTimestamp = timestamp

      const { logicalWidth, logicalHeight, devicePixelRatio } = clearVisibleCanvas()
      const source = sourceCanvasRef.current
      if (sourceFrameReadyRef.current && source && logicalWidth > 0 && logicalHeight > 0) {
        const current = latestPropsRef.current
        const normalizedTrailRgb = normalizeRgb(current.trailRgb)
        const sourceAspect = source.width > 0 && source.height > 0
          ? source.width / source.height
          : 1
        visibleContext.imageSmoothingEnabled = true
        visibleContext.imageSmoothingQuality = 'high'

        current.sprites.forEach((sprite) => {
          const duration = finiteOr(sprite.duration, 0)
          const delay = finiteOr(sprite.delay, 0)
          if (duration <= 0 || elapsedSecondsRef.current < delay) return

          const progress = positiveModulo(
            (elapsedSecondsRef.current - delay) / duration,
            1,
          )
          const motion = sampleMotionKeyframes(progress)
          const spriteOpacity = clamp(finiteOr(sprite.opacity, 0), 0, 1) * motion.opacity
          const spriteSize = Math.max(0, finiteOr(sprite.size, 0)) * motion.scale
          if (spriteOpacity <= 0.001 || spriteSize <= 0.01) return

          const position = sampleCubicBezier(
            sprite.start,
            sprite.control1,
            sprite.control2,
            sprite.end,
            progress,
          )
          const tangent = sampleCubicBezierTangent(
            sprite.start,
            sprite.control1,
            sprite.control2,
            sprite.end,
            progress,
          )
          const tangentLength = Math.hypot(tangent.x, tangent.y)
          const tangentAngle = tangentLength > 0.0001
            ? Math.atan2(tangent.y, tangent.x)
            : 0
          const rotation =
            tangentAngle +
            finiteOr(sprite.rotationSeed, 0) * TWO_PI +
            (elapsedSecondsRef.current / PARTICLE_ROTATION_SECONDS) *
              TWO_PI *
              finiteOr(current.rotationSpeed, 0)

          const trailLength = Math.max(0, finiteOr(sprite.trail, 0)) * motion.scale
          const trailOpacity =
            spriteOpacity * clamp(finiteOr(sprite.trailOpacity, 0), 0, 1)
          if (trailLength > 0.25 && trailOpacity > 0.001 && tangentLength > 0.0001) {
            const tangentX = tangent.x / tangentLength
            const tangentY = tangent.y / tangentLength
            visibleContext.save()
            visibleContext.beginPath()
            visibleContext.moveTo(
              position.x - tangentX * trailLength,
              position.y - tangentY * trailLength,
            )
            visibleContext.lineTo(position.x, position.y)
            visibleContext.globalAlpha = trailOpacity * 0.58
            visibleContext.lineCap = 'round'
            visibleContext.lineWidth = Math.max(0.55, spriteSize * 0.34)
            visibleContext.strokeStyle = `rgb(${normalizedTrailRgb})`
            visibleContext.stroke()
            visibleContext.restore()
          }

          const drawWidth = sourceAspect >= 1 ? spriteSize : spriteSize * sourceAspect
          const drawHeight = sourceAspect >= 1 ? spriteSize / sourceAspect : spriteSize
          visibleContext.save()
          visibleContext.translate(position.x, position.y)
          visibleContext.rotate(rotation)
          visibleContext.globalAlpha = spriteOpacity
          visibleContext.drawImage(
            source,
            -drawWidth / 2,
            -drawHeight / 2,
            drawWidth,
            drawHeight,
          )
          visibleContext.restore()
        })

        visibleContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      }

      mainAnimationFrame = window.requestAnimationFrame(drawParticles)
    }

    const stop = () => {
      if (!running) return
      running = false
      previousMainTimestamp = undefined
      if (mainAnimationFrame !== undefined) {
        window.cancelAnimationFrame(mainAnimationFrame)
        mainAnimationFrame = undefined
      }
      cancelVideoFrameLoop()
      video.pause()
    }

    const start = () => {
      if (
        disposed ||
        running ||
        !active ||
        !src ||
        document.visibilityState !== 'visible'
      ) {
        return
      }
      running = true
      previousMainTimestamp = undefined
      scheduleVideoFrame()
      mainAnimationFrame = window.requestAnimationFrame(drawParticles)
      void video.play().catch(() => {
        if (!disposed && running && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          copyPresentedVideoFrame()
        }
      })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }
    const handleCanPlay = () => {
      if (!running) {
        start()
        return
      }
      if (
        !disposed &&
        active &&
        src &&
        document.visibilityState === 'visible' &&
        video.paused
      ) {
        void video.play().catch(() => {
          copyPresentedVideoFrame()
        })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    video.addEventListener('canplay', handleCanPlay)
    clearVisibleCanvas()
    start()

    return () => {
      disposed = true
      stop()
      cancelVideoFrameLoop()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      video.removeEventListener('canplay', handleCanPlay)
    }
  }, [active, src])

  return (
    <>
      <video
        ref={videoRef}
        className="ambientParticleVideoSource"
        src={src}
        muted
        playsInline
        loop
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        className="ambientParticleVideoCanvas"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'block',
          visibility: active ? 'visible' : 'hidden',
          pointerEvents: 'none',
        }}
      />
    </>
  )
}
