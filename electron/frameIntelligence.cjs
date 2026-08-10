const path = require('node:path')
const { readFile, stat } = require('node:fs/promises')
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')

const ENGINE_VERSION = 1
const MAX_FRAME_COUNT = 5_000
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_SOURCE_DIMENSION = 8_192
const MAX_SOURCE_PIXELS = 16 * 1024 * 1024
const ANALYSIS_WIDTH = 192
const ANALYSIS_HEIGHT = 108
const COMPARISON_WIDTH = 64
const COMPARISON_HEIGHT = 36
const COLOR_WIDTH = 32
const COLOR_HEIGHT = 18
const HASH_WIDTH = 17
const HASH_HEIGHT = 16

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
])

const SENSITIVITY = Object.freeze({
  conservative: Object.freeze({
    blackMean: 10,
    blackP99: 18,
    whiteMean: 245,
    whiteP01: 237,
    blankStdDev: 5,
    blankEdgeDensity: 0.0025,
    blankEdgeEnergy: 0.010,
    blankContrastRatio: 0.0015,
    hashDistance: 16,
    pixelMae: 0.025,
    colorMae: 0.035,
    gradientMae: 0.040,
    correlation: 0.992,
  }),
  balanced: Object.freeze({
    blackMean: 14,
    blackP99: 24,
    whiteMean: 241,
    whiteP01: 231,
    blankStdDev: 7,
    blankEdgeDensity: 0.0045,
    blankEdgeEnergy: 0.016,
    blankContrastRatio: 0.003,
    hashDistance: 24,
    pixelMae: 0.040,
    colorMae: 0.055,
    gradientMae: 0.065,
    correlation: 0.982,
  }),
  aggressive: Object.freeze({
    blackMean: 22,
    blackP99: 30,
    whiteMean: 237,
    whiteP01: 225,
    blankStdDev: 10,
    blankEdgeDensity: 0.008,
    blankEdgeEnergy: 0.026,
    blankContrastRatio: 0.006,
    hashDistance: 32,
    pixelMae: 0.060,
    colorMae: 0.080,
    gradientMae: 0.090,
    correlation: 0.965,
  }),
})

class FrameIntelligenceError extends TypeError {
  constructor(code, message) {
    super(message)
    this.name = 'FrameIntelligenceError'
    this.code = code
  }
}

function invalidInput(message) {
  throw new FrameIntelligenceError(
    'FRAME_INTELLIGENCE_INVALID_INPUT',
    message,
  )
}

function decodeFailed(message) {
  throw new FrameIntelligenceError(
    'FRAME_INTELLIGENCE_DECODE_FAILED',
    message,
  )
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value, places = 6) {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

function normalizeFrame(frame, index) {
  if (!frame || typeof frame !== 'object') {
    invalidInput(`Frame ${index} is invalid.`)
  }
  const frameId = typeof frame.frameId === 'string' ? frame.frameId.trim() : ''
  if (!frameId) invalidInput(`Frame ${index} frameId is required.`)
  const imagePath = typeof frame.imagePath === 'string'
    ? frame.imagePath.trim()
    : ''
  if (!imagePath || !path.isAbsolute(imagePath)) {
    invalidInput(`Frame ${index} imagePath must be an absolute path.`)
  }
  const timeSeconds = Number(frame.timeSeconds)
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    invalidInput(`Frame ${index} timeSeconds must be a non-negative number.`)
  }
  return { frameId, imagePath, timeSeconds, inputIndex: index }
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.frames)) {
    invalidInput('frames must be an array.')
  }
  if (input.frames.length < 1 || input.frames.length > MAX_FRAME_COUNT) {
    invalidInput(`frames must contain from 1 to ${MAX_FRAME_COUNT} items.`)
  }
  const sensitivity = input.sensitivity == null
    ? 'conservative'
    : String(input.sensitivity).trim().toLowerCase()
  if (!Object.hasOwn(SENSITIVITY, sensitivity)) {
    invalidInput('sensitivity must be conservative, balanced, or aggressive.')
  }
  const frames = input.frames.map(normalizeFrame)
  const frameIds = new Set()
  for (const frame of frames) {
    if (frameIds.has(frame.frameId)) {
      invalidInput(`Frame ID ${frame.frameId} is duplicated.`)
    }
    frameIds.add(frame.frameId)
  }
  return { frames, sensitivity }
}

function pngDimensions(imageBytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (
    imageBytes.length < 24 ||
    !imageBytes.subarray(0, 8).equals(signature) ||
    imageBytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    decodeFailed('PNG header is invalid.')
  }
  return {
    mimeType: 'image/png',
    width: imageBytes.readUInt32BE(16),
    height: imageBytes.readUInt32BE(20),
  }
}

function jpegDimensions(imageBytes) {
  if (
    imageBytes.length < 4 ||
    imageBytes[0] !== 0xff ||
    imageBytes[1] !== 0xd8
  ) {
    decodeFailed('JPEG header is invalid.')
  }
  let offset = 2
  while (offset + 3 < imageBytes.length) {
    if (imageBytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < imageBytes.length && imageBytes[offset] === 0xff) {
      offset += 1
    }
    if (offset >= imageBytes.length) break
    const marker = imageBytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > imageBytes.length) break
    const segmentLength = imageBytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > imageBytes.length) {
      decodeFailed('JPEG segment is invalid.')
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) decodeFailed('JPEG dimensions are invalid.')
      return {
        mimeType: 'image/jpeg',
        height: imageBytes.readUInt16BE(offset + 3),
        width: imageBytes.readUInt16BE(offset + 5),
      }
    }
    offset += segmentLength
  }
  decodeFailed('JPEG dimensions could not be read.')
}

function inspectImageHeader(imageBytes) {
  if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) {
    return pngDimensions(imageBytes)
  }
  if (imageBytes[0] === 0xff && imageBytes[1] === 0xd8) {
    return jpegDimensions(imageBytes)
  }
  decodeFailed('Only JPEG and PNG frame images are supported.')
}

function validateDimensions(dimensions, frameId) {
  if (
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_SOURCE_DIMENSION ||
    dimensions.height > MAX_SOURCE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_SOURCE_PIXELS
  ) {
    throw new FrameIntelligenceError(
      'FRAME_INTELLIGENCE_IMAGE_TOO_LARGE',
      `Frame ${frameId} has unsafe pixel dimensions.`,
    )
  }
}

async function decodeImage(frame) {
  let fileInfo
  try {
    fileInfo = await stat(frame.imagePath)
  } catch {
    throw new FrameIntelligenceError(
      'FRAME_INTELLIGENCE_IMAGE_UNAVAILABLE',
      `Frame ${frame.frameId} image is unavailable.`,
    )
  }
  if (!fileInfo.isFile() || fileInfo.size < 1 || fileInfo.size > MAX_IMAGE_BYTES) {
    throw new FrameIntelligenceError(
      'FRAME_INTELLIGENCE_IMAGE_UNAVAILABLE',
      `Frame ${frame.frameId} image has an unsafe file size.`,
    )
  }
  const imageBytes = await readFile(frame.imagePath)
  const expected = inspectImageHeader(imageBytes)
  validateDimensions(expected, frame.frameId)
  try {
    const decoded = expected.mimeType === 'image/png'
      ? PNG.sync.read(imageBytes, { checkCRC: true, skipRescale: false })
      : jpeg.decode(imageBytes, {
          useTArray: true,
          formatAsRGBA: true,
          tolerantDecoding: false,
          maxResolutionInMP: MAX_SOURCE_PIXELS / 1_000_000,
          maxMemoryUsageInMB: 128,
        })
    if (
      decoded.width !== expected.width ||
      decoded.height !== expected.height ||
      !decoded.data ||
      decoded.data.length !== decoded.width * decoded.height * 4
    ) {
      decodeFailed(`Frame ${frame.frameId} decoded incorrectly.`)
    }
    return {
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
    }
  } catch (error) {
    if (error instanceof FrameIntelligenceError) throw error
    decodeFailed(`Frame ${frame.frameId} could not be decoded.`)
  }
}

function sampleRgba(decoded, targetWidth, targetHeight) {
  const output = new Uint8Array(targetWidth * targetHeight * 4)
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(
      decoded.height - 1,
      Math.floor(((y + 0.5) * decoded.height) / targetHeight),
    )
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(
        decoded.width - 1,
        Math.floor(((x + 0.5) * decoded.width) / targetWidth),
      )
      const sourceOffset = (sourceY * decoded.width + sourceX) * 4
      const outputOffset = (y * targetWidth + x) * 4
      const alpha = decoded.data[sourceOffset + 3] / 255
      output[outputOffset] = Math.round(decoded.data[sourceOffset] * alpha)
      output[outputOffset + 1] = Math.round(
        decoded.data[sourceOffset + 1] * alpha,
      )
      output[outputOffset + 2] = Math.round(
        decoded.data[sourceOffset + 2] * alpha,
      )
      output[outputOffset + 3] = 255
    }
  }
  return output
}

function rgbaToLuma(rgba) {
  const luma = new Uint8Array(rgba.length / 4)
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * 4
    luma[index] = Math.round(
      rgba[offset] * 0.2126 +
      rgba[offset + 1] * 0.7152 +
      rgba[offset + 2] * 0.0722,
    )
  }
  return luma
}

function percentileFromHistogram(histogram, pixelCount, percentile) {
  const target = Math.max(0, Math.ceil(pixelCount * percentile) - 1)
  let count = 0
  for (let value = 0; value < histogram.length; value += 1) {
    count += histogram[value]
    if (count > target) return value
  }
  return 255
}

function lumaMetrics(luma, width, height) {
  const histogram = new Uint32Array(256)
  let sum = 0
  let sumSquares = 0
  let darkPixels = 0
  let brightPixels = 0
  for (const value of luma) {
    histogram[value] += 1
    sum += value
    sumSquares += value * value
    if (value <= 20) darkPixels += 1
    if (value >= 235) brightPixels += 1
  }
  const meanRaw = sum / luma.length
  const varianceRaw = Math.max(0, sumSquares / luma.length - meanRaw ** 2)
  let edgeCount = 0
  let edgeEnergy = 0
  let gradientCount = 0
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x
      const dx = Math.abs(luma[index] - luma[index - 1])
      const dy = Math.abs(luma[index] - luma[index - width])
      const gradient = Math.max(dx, dy)
      if (gradient >= 18) edgeCount += 1
      edgeEnergy += gradient / 255
      gradientCount += 1
    }
  }
  const p01 = percentileFromHistogram(histogram, luma.length, 0.01)
  const p05 = percentileFromHistogram(histogram, luma.length, 0.05)
  const p50 = percentileFromHistogram(histogram, luma.length, 0.50)
  const p95 = percentileFromHistogram(histogram, luma.length, 0.95)
  const p99 = percentileFromHistogram(histogram, luma.length, 0.99)
  return {
    lumaMean: round(meanRaw / 255),
    lumaStdDev: round(Math.sqrt(varianceRaw) / 255),
    lumaP01: round(p01 / 255),
    lumaP05: round(p05 / 255),
    lumaP50: round(p50 / 255),
    lumaP95: round(p95 / 255),
    lumaP99: round(p99 / 255),
    darkPixelRatio: round(darkPixels / luma.length),
    brightPixelRatio: round(brightPixels / luma.length),
    edgeDensity: round(edgeCount / Math.max(1, gradientCount)),
    edgeEnergy: round(edgeEnergy / Math.max(1, gradientCount)),
    raw: {
      mean: meanRaw,
      stdDev: Math.sqrt(varianceRaw),
      p01,
      p99,
    },
  }
}

function blankCandidate(metrics, threshold) {
  const blackContrastRatio = 1 - metrics.darkPixelRatio
  const whiteContrastRatio = 1 - metrics.brightPixelRatio
  const commonDetailPass =
    metrics.edgeDensity <= threshold.blankEdgeDensity &&
    metrics.edgeEnergy <= threshold.blankEdgeEnergy
  const black =
    metrics.raw.mean <= threshold.blackMean &&
    metrics.raw.p99 <= threshold.blackP99 &&
    metrics.raw.stdDev <= threshold.blankStdDev &&
    blackContrastRatio <= threshold.blankContrastRatio &&
    commonDetailPass
  const white =
    metrics.raw.mean >= threshold.whiteMean &&
    metrics.raw.p01 >= threshold.whiteP01 &&
    metrics.raw.stdDev <= threshold.blankStdDev &&
    whiteContrastRatio <= threshold.blankContrastRatio &&
    commonDetailPass
  if (!black && !white) return null

  const kind = black ? 'black' : 'white'
  const toneMargin = black
    ? (threshold.blackP99 - metrics.raw.p99) /
      Math.max(1, threshold.blackP99)
    : (metrics.raw.p01 - threshold.whiteP01) /
      Math.max(1, 255 - threshold.whiteP01)
  const detailMargin = 1 - Math.max(
    metrics.edgeDensity / Math.max(0.000001, threshold.blankEdgeDensity),
    metrics.edgeEnergy / Math.max(0.000001, threshold.blankEdgeEnergy),
    (kind === 'black' ? blackContrastRatio : whiteContrastRatio) /
      Math.max(0.000001, threshold.blankContrastRatio),
  )
  return {
    kind,
    confidence: round(clamp(0.92 + toneMargin * 0.04 + detailMargin * 0.035, 0.92, 0.995), 3),
    reason: kind === 'black'
      ? '画面整体接近纯黑，且未检测到足以构成字幕、Logo 或主体的边缘细节。'
      : '画面整体接近纯白，且未检测到足以构成字幕、Logo 或主体的边缘细节。',
  }
}

function buildHash(luma) {
  const hash = new Uint32Array(8)
  let bitIndex = 0
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let x = 0; x < HASH_WIDTH - 1; x += 1) {
      // A small dead zone keeps JPEG ringing in otherwise-flat areas from
      // flipping dozens of perceptual-hash bits.
      if (luma[y * HASH_WIDTH + x] > luma[y * HASH_WIDTH + x + 1] + 3) {
        hash[bitIndex >>> 5] |= (1 << (bitIndex & 31)) >>> 0
      }
      bitIndex += 1
    }
  }
  return hash
}

function popCount32(value) {
  value -= (value >>> 1) & 0x55555555
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function hashDistance(left, right) {
  let distance = 0
  for (let index = 0; index < left.length; index += 1) {
    distance += popCount32((left[index] ^ right[index]) >>> 0)
  }
  return distance
}

function comparePixels(left, right, width, height) {
  let absoluteError = 0
  let squareError = 0
  let leftSum = 0
  let rightSum = 0
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] - right[index]) / 255
    absoluteError += Math.abs(difference)
    squareError += difference ** 2
    leftSum += left[index]
    rightSum += right[index]
  }
  const leftMean = leftSum / left.length
  const rightMean = rightSum / right.length
  let covariance = 0
  let leftVariance = 0
  let rightVariance = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean
    const rightDelta = right[index] - rightMean
    covariance += leftDelta * rightDelta
    leftVariance += leftDelta ** 2
    rightVariance += rightDelta ** 2
  }
  const varianceProduct = Math.sqrt(leftVariance * rightVariance)
  const correlation = varianceProduct <= 0.000001
    ? absoluteError === 0 ? 1 : 0
    : covariance / varianceProduct

  let gradientError = 0
  let gradientCount = 0
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x
      const leftDx = left[index] - left[index - 1]
      const leftDy = left[index] - left[index - width]
      const rightDx = right[index] - right[index - 1]
      const rightDy = right[index] - right[index - width]
      gradientError += (
        Math.abs(leftDx - rightDx) + Math.abs(leftDy - rightDy)
      ) / (2 * 255)
      gradientCount += 1
    }
  }
  return {
    pixelMae: absoluteError / left.length,
    pixelRmse: Math.sqrt(squareError / left.length),
    correlation,
    gradientMae: gradientError / Math.max(1, gradientCount),
  }
}

function colorMae(left, right) {
  let error = 0
  const channels = left.length / 4 * 3
  for (let offset = 0; offset < left.length; offset += 4) {
    error += Math.abs(left[offset] - right[offset]) / 255
    error += Math.abs(left[offset + 1] - right[offset + 1]) / 255
    error += Math.abs(left[offset + 2] - right[offset + 2]) / 255
  }
  return error / channels
}

function duplicateComparison(representative, candidate, threshold) {
  const distance = hashDistance(representative.hash, candidate.hash)
  if (distance > threshold.hashDistance) return null
  const pixels = comparePixels(
    representative.comparisonLuma,
    candidate.comparisonLuma,
    COMPARISON_WIDTH,
    COMPARISON_HEIGHT,
  )
  const comparedColorMae = colorMae(
    representative.comparisonColor,
    candidate.comparisonColor,
  )
  const veryLowError = pixels.pixelMae <= threshold.pixelMae * 0.35
  if (
    pixels.pixelMae > threshold.pixelMae ||
    comparedColorMae > threshold.colorMae ||
    pixels.gradientMae > threshold.gradientMae ||
    (!veryLowError && pixels.correlation < threshold.correlation)
  ) {
    return null
  }
  const similarity = clamp(
    1 - (
      distance / 256 * 0.20 +
      pixels.pixelMae * 0.30 +
      comparedColorMae * 0.25 +
      pixels.gradientMae * 0.15 +
      (1 - clamp(pixels.correlation, 0, 1)) * 0.10
    ),
    0,
    1,
  )
  return {
    hashDistance: distance,
    hashDistanceRatio: round(distance / 256),
    pixelMae: round(pixels.pixelMae),
    pixelRmse: round(pixels.pixelRmse),
    colorMae: round(comparedColorMae),
    gradientMae: round(pixels.gradientMae),
    correlation: round(pixels.correlation),
    similarity: round(similarity),
  }
}

function qualityScore(metrics, width, height) {
  const exposure = 1 - Math.min(1, Math.abs(metrics.lumaMean - 0.5) / 0.5)
  const detail = clamp(metrics.edgeEnergy / 0.08, 0, 1)
  const resolution = clamp((width * height) / (640 * 360), 0, 1)
  return round(exposure * 0.30 + detail * 0.55 + resolution * 0.15)
}

async function analyzeOneFrame(frame, threshold) {
  const decoded = await decodeImage(frame)
  const analysisRgba = sampleRgba(decoded, ANALYSIS_WIDTH, ANALYSIS_HEIGHT)
  const analysisLuma = rgbaToLuma(analysisRgba)
  const metrics = lumaMetrics(
    analysisLuma,
    ANALYSIS_WIDTH,
    ANALYSIS_HEIGHT,
  )
  const blank = blankCandidate(metrics, threshold)
  const comparisonRgba = sampleRgba(
    decoded,
    COMPARISON_WIDTH,
    COMPARISON_HEIGHT,
  )
  const comparisonLuma = rgbaToLuma(comparisonRgba)
  const hashRgba = sampleRgba(decoded, HASH_WIDTH, HASH_HEIGHT)
  const hash = buildHash(rgbaToLuma(hashRgba))
  const comparisonColor = sampleRgba(decoded, COLOR_WIDTH, COLOR_HEIGHT)
  const publicMetrics = { ...metrics }
  delete publicMetrics.raw
  publicMetrics.qualityScore = qualityScore(metrics, decoded.width, decoded.height)
  return {
    ...frame,
    width: decoded.width,
    height: decoded.height,
    metrics: publicMetrics,
    blankCandidate: blank,
    hash,
    comparisonLuma,
    comparisonColor,
  }
}

function buildDuplicateGroups(analyzedFrames, threshold) {
  const eligible = analyzedFrames
    .filter((frame) => frame.blankCandidate == null)
    .slice()
    .sort((left, right) => {
      const qualityDelta = right.metrics.qualityScore - left.metrics.qualityScore
      // Minor sharpness-score movement is frequently JPEG ringing rather than
      // better source detail. Preserve the earlier frame unless the quality
      // advantage is material.
      return Math.abs(qualityDelta) >= 0.04
        ? qualityDelta
        : left.inputIndex - right.inputIndex
    })
  const groups = []
  for (const frame of eligible) {
    let closest = null
    for (const group of groups) {
      const comparison = duplicateComparison(group.representative, frame, threshold)
      if (!comparison) continue
      if (!closest || comparison.similarity > closest.comparison.similarity) {
        closest = { group, comparison }
      }
    }
    if (closest) {
      closest.group.members.push({ frame, comparison: closest.comparison })
    } else {
      groups.push({ representative: frame, members: [] })
    }
  }
  return groups
    .filter((group) => group.members.length > 0)
    .map((group, groupIndex) => {
      const orderedMembers = group.members
        .slice()
        .sort((left, right) => left.frame.inputIndex - right.frame.inputIndex)
      const allFrames = [group.representative, ...orderedMembers.map(({ frame }) => frame)]
      const firstInputIndex = Math.min(...allFrames.map(({ inputIndex }) => inputIndex))
      return {
        groupId: `duplicate-${groupIndex + 1}`,
        firstInputIndex,
        keepFrameId: group.representative.frameId,
        removeFrameIds: orderedMembers.map(({ frame }) => frame.frameId),
        confidence: round(Math.min(
          ...orderedMembers.map(({ comparison }) => comparison.similarity),
        ), 3),
        reason: '建议保留组内清晰度、曝光与分辨率综合质量更高的一帧；质量接近时保留较早帧。',
        representative: {
          frameId: group.representative.frameId,
          timeSeconds: group.representative.timeSeconds,
          qualityScore: group.representative.metrics.qualityScore,
        },
        members: orderedMembers.map(({ frame, comparison }) => ({
          frameId: frame.frameId,
          timeSeconds: frame.timeSeconds,
          comparedToFrameId: group.representative.frameId,
          qualityScore: frame.metrics.qualityScore,
          metrics: comparison,
        })),
      }
    })
    .sort((left, right) => left.firstInputIndex - right.firstInputIndex)
    .map(({ firstInputIndex: _firstInputIndex, ...group }, index) => ({
      ...group,
      groupId: `duplicate-${index + 1}`,
    }))
}

function publicFrameResult(frame) {
  return {
    frameId: frame.frameId,
    timeSeconds: frame.timeSeconds,
    imagePath: frame.imagePath,
    width: frame.width,
    height: frame.height,
    metrics: frame.metrics,
    blankCandidate: frame.blankCandidate,
  }
}

function createFrameIntelligenceEngine() {
  return {
    async analyzeFrames(input) {
      const normalized = normalizeInput(input)
      const threshold = SENSITIVITY[normalized.sensitivity]
      const analyzedFrames = []
      for (const frame of normalized.frames) {
        // Deliberately decode sequentially: a long visual index can contain more
        // than one thousand frames and must not retain several decoded bitmaps.
        analyzedFrames.push(await analyzeOneFrame(frame, threshold))
      }
      const duplicateGroups = buildDuplicateGroups(analyzedFrames, threshold)
      const frames = analyzedFrames.map(publicFrameResult)
      const blankCandidates = frames
        .filter((frame) => frame.blankCandidate != null)
        .map((frame) => ({
          frameId: frame.frameId,
          timeSeconds: frame.timeSeconds,
          kind: frame.blankCandidate.kind,
          confidence: frame.blankCandidate.confidence,
          reason: frame.blankCandidate.reason,
          metrics: frame.metrics,
        }))
      return {
        version: ENGINE_VERSION,
        sensitivity: normalized.sensitivity,
        analyzedFrameCount: frames.length,
        frames,
        blankCandidates,
        duplicateGroups,
      }
    },
  }
}

module.exports = {
  ENGINE_VERSION,
  FrameIntelligenceError,
  createFrameIntelligenceEngine,
}
