import {
  BACKGROUND_REFLECTION_SURFACE_HEIGHT,
  BACKGROUND_REFLECTION_SURFACE_WIDTH,
  type BackgroundReflectionSurfaceWorkerRequest,
  type BackgroundReflectionSurfaceWorkerResponse,
} from './backgroundReflectionSurfaceProtocol'

const SOURCE_CROP_TOP = 0.59
const TARGET_HEIGHT_STANDARD_DEVIATION = 0.09
const TARGET_NORMAL_SLOPE_95 = 0.38
const HEIGHT_MINIMUM = 0.22
const HEIGHT_MAXIMUM = 0.78
const MINIMUM_LUMINANCE_STANDARD_DEVIATION = 0.006
const PERCENTILE_BUCKET_COUNT = 4096

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

const sample = (
  values: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
) => values[
  clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)
]

const smoothHeight = (
  source: Float32Array,
  width: number,
  height: number,
) => {
  const result = new Float32Array(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = sample(source, width, height, x, y) * 4
      const cardinal =
        sample(source, width, height, x - 1, y) +
        sample(source, width, height, x + 1, y) +
        sample(source, width, height, x, y - 1) +
        sample(source, width, height, x, y + 1)
      result[y * width + x] = (center + cardinal) / 8
    }
  }
  return result
}

const percentileMagnitude = (
  gradientX: Float32Array,
  gradientY: Float32Array,
  maximum: number,
  percentile: number,
) => {
  if (maximum <= 0) return 0
  const histogram = new Uint32Array(PERCENTILE_BUCKET_COUNT)
  for (let index = 0; index < gradientX.length; index += 1) {
    const magnitude = Math.hypot(gradientX[index], gradientY[index])
    const bucket = Math.min(
      PERCENTILE_BUCKET_COUNT - 1,
      Math.floor(magnitude / maximum * (PERCENTILE_BUCKET_COUNT - 1)),
    )
    histogram[bucket] += 1
  }

  const target = Math.ceil(gradientX.length * percentile)
  let accumulated = 0
  for (let bucket = 0; bucket < histogram.length; bucket += 1) {
    accumulated += histogram[bucket]
    if (accumulated >= target) {
      return maximum * bucket / (PERCENTILE_BUCKET_COUNT - 1)
    }
  }
  return maximum
}

const drawBackgroundGround = (bitmap: ImageBitmap) => {
  const width = BACKGROUND_REFLECTION_SURFACE_WIDTH
  const height = BACKGROUND_REFLECTION_SURFACE_HEIGHT
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to create reflection surface canvas')

  context.fillStyle = 'rgb(128, 128, 128)'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  const sourceAspect = bitmap.width / Math.max(1, bitmap.height)
  const targetAspect = width / height
  let sourceX = 0
  let sourceY = 0
  let sourceWidth = bitmap.width
  let sourceHeight = bitmap.height

  if (sourceAspect > targetAspect) {
    sourceWidth = bitmap.height * targetAspect
    sourceX = (bitmap.width - sourceWidth) / 2
  } else {
    sourceHeight = bitmap.width / targetAspect
    sourceY = (bitmap.height - sourceHeight) / 2
  }

  sourceY += sourceHeight * SOURCE_CROP_TOP
  sourceHeight *= 1 - SOURCE_CROP_TOP
  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  )
  return context.getImageData(0, 0, width, height)
}

const packSurfaceData = (source: ImageData) => {
  const { width, height, data } = source
  const count = width * height
  const luminance = new Float32Array(count)
  const rowMeans = new Float64Array(height)

  for (let y = 0; y < height; y += 1) {
    let rowTotal = 0
    const rowOffset = y * width
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = (rowOffset + x) * 4
      const value = (
        data[pixelOffset] * 0.2126 +
        data[pixelOffset + 1] * 0.7152 +
        data[pixelOffset + 2] * 0.0722
      ) / 255
      luminance[rowOffset + x] = value
      rowTotal += value
    }
    rowMeans[y] = rowTotal / width
  }

  let detailSquaredTotal = 0
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width
    const rowMean = rowMeans[y]
    for (let x = 0; x < width; x += 1) {
      const detail = luminance[rowOffset + x] - rowMean
      detailSquaredTotal += detail * detail
    }
  }

  const detailStandardDeviation = Math.sqrt(detailSquaredTotal / count)
  if (detailStandardDeviation < MINIMUM_LUMINANCE_STANDARD_DEVIATION) {
    throw new Error('Background has insufficient ground texture')
  }

  const heightGain = TARGET_HEIGHT_STANDARD_DEVIATION / detailStandardDeviation
  const heightField = new Float32Array(count)
  let heightTotal = 0
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width
    const rowMean = rowMeans[y]
    for (let x = 0; x < width; x += 1) {
      const value = clamp(
        0.5 + (luminance[rowOffset + x] - rowMean) * heightGain,
        HEIGHT_MINIMUM,
        HEIGHT_MAXIMUM,
      )
      heightField[rowOffset + x] = value
      heightTotal += value
    }
  }

  const heightCenterCorrection = heightTotal / count - 0.5
  for (let index = 0; index < count; index += 1) {
    heightField[index] = clamp(
      heightField[index] - heightCenterCorrection,
      HEIGHT_MINIMUM,
      HEIGHT_MAXIMUM,
    )
  }

  const smoothedHeight = smoothHeight(heightField, width, height)
  const gradientX = new Float32Array(count)
  const gradientY = new Float32Array(count)
  let maximumGradient = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const nearX = (
        sample(smoothedHeight, width, height, x + 1, y) -
        sample(smoothedHeight, width, height, x - 1, y)
      ) * 0.5
      const nearY = (
        sample(smoothedHeight, width, height, x, y + 1) -
        sample(smoothedHeight, width, height, x, y - 1)
      ) * 0.5
      const broadX = (
        sample(smoothedHeight, width, height, x + 4, y) -
        sample(smoothedHeight, width, height, x - 4, y)
      ) / 8
      const broadY = (
        sample(smoothedHeight, width, height, x, y + 4) -
        sample(smoothedHeight, width, height, x, y - 4)
      ) / 8
      const dx = nearX * 0.68 + broadX * 0.32
      const dy = nearY * 0.68 + broadY * 0.32
      gradientX[index] = dx
      gradientY[index] = dy
      maximumGradient = Math.max(maximumGradient, Math.hypot(dx, dy))
    }
  }

  const gradient95 = percentileMagnitude(
    gradientX,
    gradientY,
    maximumGradient,
    0.95,
  )
  if (gradient95 <= 0.000001) {
    throw new Error('Background ground texture has no usable gradient')
  }
  const targetTangent = TARGET_NORMAL_SLOPE_95 /
    Math.sqrt(1 - TARGET_NORMAL_SLOPE_95 * TARGET_NORMAL_SLOPE_95)
  const slopeStrength = targetTangent / gradient95
  const packed = new Uint8Array(count * 4)

  for (let y = 0; y < height; y += 1) {
    const outputY = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = y * width + x
      const outputOffset = (outputY * width + x) * 4
      const slopeX = -gradientX[sourceIndex] * slopeStrength
      const slopeY = gradientY[sourceIndex] * slopeStrength
      const inverseLength = 1 / Math.hypot(slopeX, slopeY, 1)
      const normalX = slopeX * inverseLength
      const normalY = slopeY * inverseLength
      packed[outputOffset] = Math.round(heightField[sourceIndex] * 255)
      packed[outputOffset + 1] = Math.round((normalX * 0.5 + 0.5) * 255)
      packed[outputOffset + 2] = Math.round((normalY * 0.5 + 0.5) * 255)
      packed[outputOffset + 3] = 255
    }
  }
  return packed
}

self.onmessage = (
  event: MessageEvent<BackgroundReflectionSurfaceWorkerRequest>,
) => {
  const { id, bitmap } = event.data
  const startedAt = performance.now()
  try {
    const source = drawBackgroundGround(bitmap)
    const pixels = packSurfaceData(source)
    const response: BackgroundReflectionSurfaceWorkerResponse = {
      id,
      ok: true,
      pixels: pixels.buffer,
      width: BACKGROUND_REFLECTION_SURFACE_WIDTH,
      height: BACKGROUND_REFLECTION_SURFACE_HEIGHT,
      generationMs: performance.now() - startedAt,
    }
    self.postMessage(response, { transfer: [pixels.buffer] })
  } catch (error) {
    const response: BackgroundReflectionSurfaceWorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  } finally {
    bitmap.close()
  }
}
