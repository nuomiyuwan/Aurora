const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')

const MIN_FRAME_COUNT = 2
const MAX_FRAME_COUNT = 12
const DEFAULT_CELL_WIDTH = 320
const DEFAULT_GAP = 8
const DEFAULT_PADDING = 8
const MIN_CELL_WIDTH = 160
const MAX_CELL_WIDTH = 960
const MAX_SOURCE_DIMENSION = 8_192
const MAX_SOURCE_PIXELS = 12 * 1024 * 1024
const MAX_OUTPUT_PIXELS = 32 * 1024 * 1024
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
])

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

const DIGIT_GLYPHS = Object.freeze({
  0: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['11110', '00001', '00001', '11110', '10000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01111', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '11110'],
})

class AiContactSheetError extends TypeError {
  constructor(code, message) {
    super(message)
    this.name = 'AiContactSheetError'
    this.code = code
  }
}

function invalidInput(message) {
  throw new AiContactSheetError('AI_CONTACT_SHEET_INVALID_INPUT', message)
}

function decodeFailed(message) {
  throw new AiContactSheetError('AI_CONTACT_SHEET_DECODE_FAILED', message)
}

function boundedInteger(value, label, minimum, maximum) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    invalidInput(`${label} must be an integer from ${minimum} to ${maximum}.`)
  }
  return number
}

function resolveContactSheetGrid(frameCount, requestedColumns) {
  boundedInteger(frameCount, 'Frame count', MIN_FRAME_COUNT, MAX_FRAME_COUNT)

  const columns = requestedColumns == null
    ? frameCount <= 4
      ? 2
      : frameCount <= 9
        ? 3
        : 4
    : boundedInteger(requestedColumns, 'Column count', 1, frameCount)

  return {
    columns,
    rows: Math.ceil(frameCount / columns),
  }
}

function normalizeFrame(frame, index) {
  if (!frame || typeof frame !== 'object') {
    invalidInput(`Frame ${index} is invalid.`)
  }
  if (!Buffer.isBuffer(frame.imageBytes) || frame.imageBytes.length === 0) {
    invalidInput(`Frame ${index} imageBytes must be a non-empty Buffer.`)
  }
  const mimeType = typeof frame.mimeType === 'string'
    ? frame.mimeType.trim().toLowerCase()
    : ''
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    invalidInput(`Frame ${index} mimeType is unsupported.`)
  }
  const slot = frame.slot == null
    ? index
    : boundedInteger(frame.slot, `Frame ${index} slot`, 0, 9_999)
  return {
    imageBytes: frame.imageBytes,
    mimeType,
    slot,
  }
}

function pngDimensions(imageBytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (
    imageBytes.length < 24 ||
    !imageBytes.subarray(0, 8).equals(signature) ||
    imageBytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    decodeFailed('The contact-sheet PNG header is invalid.')
  }
  return {
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
    decodeFailed('The contact-sheet JPEG header is invalid.')
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
    if (
      segmentLength < 2 ||
      offset + segmentLength > imageBytes.length
    ) {
      decodeFailed('The contact-sheet JPEG segment is invalid.')
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        decodeFailed('The contact-sheet JPEG dimensions are invalid.')
      }
      return {
        height: imageBytes.readUInt16BE(offset + 3),
        width: imageBytes.readUInt16BE(offset + 5),
      }
    }
    offset += segmentLength
  }
  decodeFailed('The contact-sheet JPEG dimensions could not be read.')
}

function validateSourceDimensions(frame) {
  const dimensions = frame.mimeType === 'image/png'
    ? pngDimensions(frame.imageBytes)
    : jpegDimensions(frame.imageBytes)
  if (
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_SOURCE_DIMENSION ||
    dimensions.height > MAX_SOURCE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_SOURCE_PIXELS
  ) {
    throw new AiContactSheetError(
      'AI_CONTACT_SHEET_IMAGE_TOO_LARGE',
      `Contact-sheet frame ${frame.slot} has unsafe pixel dimensions.`,
    )
  }
  return dimensions
}

function decodeFrame(frame) {
  const expected = validateSourceDimensions(frame)
  try {
    const decoded = frame.mimeType === 'image/png'
      ? PNG.sync.read(frame.imageBytes, {
          checkCRC: true,
          skipRescale: false,
        })
      : jpeg.decode(frame.imageBytes, {
          useTArray: true,
          formatAsRGBA: true,
          tolerantDecoding: false,
          maxResolutionInMP: MAX_SOURCE_PIXELS / 1_000_000,
          maxMemoryUsageInMB: 96,
        })
    if (
      decoded.width !== expected.width ||
      decoded.height !== expected.height ||
      !decoded.data ||
      decoded.data.length !== decoded.width * decoded.height * 4
    ) {
      decodeFailed(`Contact-sheet frame ${frame.slot} decoded incorrectly.`)
    }
    return {
      width: decoded.width,
      height: decoded.height,
      data: Buffer.from(decoded.data),
    }
  } catch (error) {
    if (error instanceof AiContactSheetError) throw error
    decodeFailed(`Unable to decode contact-sheet frame ${frame.slot}.`)
  }
}

function resizeFrameToFit(frame, cellWidth, cellHeight) {
  const decoded = decodeFrame(frame)
  const scale = Math.min(
    cellWidth / decoded.width,
    cellHeight / decoded.height,
  )
  const width = Math.max(
    1,
    Math.min(cellWidth, Math.round(decoded.width * scale)),
  )
  const height = Math.max(
    1,
    Math.min(cellHeight, Math.round(decoded.height * scale)),
  )
  const data = Buffer.allocUnsafe(width * height * 4)
  const sourceXRatio = decoded.width / width
  const sourceYRatio = decoded.height / height

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(
      decoded.height - 1,
      Math.floor((y + 0.5) * sourceYRatio),
    )
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(
        decoded.width - 1,
        Math.floor((x + 0.5) * sourceXRatio),
      )
      const sourceOffset = (sourceY * decoded.width + sourceX) * 4
      const destinationOffset = (y * width + x) * 4
      data[destinationOffset] = decoded.data[sourceOffset]
      data[destinationOffset + 1] = decoded.data[sourceOffset + 1]
      data[destinationOffset + 2] = decoded.data[sourceOffset + 2]
      data[destinationOffset + 3] = decoded.data[sourceOffset + 3]
    }
  }

  return { data, width, height }
}

function fillOpaqueBlack(bitmap) {
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    bitmap[offset] = 0
    bitmap[offset + 1] = 0
    bitmap[offset + 2] = 0
    bitmap[offset + 3] = 255
  }
}

function fillRectangle(bitmap, bitmapWidth, x, y, width, height, value) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = (row * bitmapWidth + column) * 4
      bitmap[offset] = value
      bitmap[offset + 1] = value
      bitmap[offset + 2] = value
      bitmap[offset + 3] = 255
    }
  }
}

function drawSlotLabel(bitmap, bitmapWidth, x, y, slot, cellHeight) {
  const label = String(slot)
  const scale = Math.max(2, Math.floor(cellHeight / 45))
  const glyphWidth = 5 * scale
  const glyphGap = scale
  const horizontalPadding = 2 * scale
  const verticalPadding = scale
  const labelWidth =
    horizontalPadding * 2 +
    label.length * glyphWidth +
    Math.max(0, label.length - 1) * glyphGap
  const labelHeight = verticalPadding * 2 + 7 * scale

  fillRectangle(bitmap, bitmapWidth, x, y, labelWidth, labelHeight, 0)
  let glyphX = x + horizontalPadding
  for (const digit of label) {
    const glyph = DIGIT_GLYPHS[digit]
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== '1') continue
        fillRectangle(
          bitmap,
          bitmapWidth,
          glyphX + column * scale,
          y + verticalPadding + row * scale,
          scale,
          scale,
          255,
        )
      }
    }
    glyphX += glyphWidth + glyphGap
  }
}

function copyRgbaInto({
  source,
  sourceWidth,
  sourceHeight,
  destination,
  destinationWidth,
  destinationX,
  destinationY,
}) {
  for (let row = 0; row < sourceHeight; row += 1) {
    const sourceStart = row * sourceWidth * 4
    const destinationStart =
      ((destinationY + row) * destinationWidth + destinationX) * 4
    source.copy(
      destination,
      destinationStart,
      sourceStart,
      sourceStart + sourceWidth * 4,
    )
  }
}

function composeAiContactSheet(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.frames)) {
    invalidInput('frames must be an array.')
  }
  const frames = input.frames.map(normalizeFrame)
  boundedInteger(frames.length, 'Frame count', MIN_FRAME_COUNT, MAX_FRAME_COUNT)
  const slots = new Set()
  for (const frame of frames) {
    if (slots.has(frame.slot)) invalidInput('Frame slots must be unique.')
    slots.add(frame.slot)
  }

  const cellWidth = input.cellWidth == null
    ? DEFAULT_CELL_WIDTH
    : boundedInteger(input.cellWidth, 'Cell width', MIN_CELL_WIDTH, MAX_CELL_WIDTH)
  const cellHeight = Math.round(cellWidth * 9 / 16)
  const gap = input.gap == null
    ? DEFAULT_GAP
    : boundedInteger(input.gap, 'Gap', 0, 64)
  const padding = input.padding == null
    ? DEFAULT_PADDING
    : boundedInteger(input.padding, 'Padding', 0, 64)
  const { columns, rows } = resolveContactSheetGrid(
    frames.length,
    input.columns,
  )
  const width = padding * 2 + columns * cellWidth + (columns - 1) * gap
  const height = padding * 2 + rows * cellHeight + (rows - 1) * gap
  if (width * height > MAX_OUTPUT_PIXELS) {
    invalidInput('The requested contact sheet is too large.')
  }

  const bitmap = Buffer.allocUnsafe(width * height * 4)
  fillOpaqueBlack(bitmap)
  frames.forEach((frame, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const cellX = padding + column * (cellWidth + gap)
    const cellY = padding + row * (cellHeight + gap)
    const fitted = resizeFrameToFit(frame, cellWidth, cellHeight)
    const imageX = cellX + Math.floor((cellWidth - fitted.width) / 2)
    const imageY = cellY + Math.floor((cellHeight - fitted.height) / 2)
    copyRgbaInto({
      source: fitted.data,
      sourceWidth: fitted.width,
      sourceHeight: fitted.height,
      destination: bitmap,
      destinationWidth: width,
      destinationX: imageX,
      destinationY: imageY,
    })
    drawSlotLabel(bitmap, width, cellX, cellY, frame.slot, cellHeight)
  })

  let imageBytes
  try {
    imageBytes = PNG.sync.write(
      { width, height, data: bitmap },
      {
        bitDepth: 8,
        colorType: 6,
        inputColorType: 6,
        inputHasAlpha: true,
        deflateLevel: 6,
      },
    )
  } catch {
    throw new AiContactSheetError(
      'AI_CONTACT_SHEET_ENCODE_FAILED',
      'Aurora could not encode the contact sheet as PNG.',
    )
  }
  if (!Buffer.isBuffer(imageBytes) || imageBytes.length === 0) {
    throw new AiContactSheetError(
      'AI_CONTACT_SHEET_ENCODE_FAILED',
      'Aurora could not encode the contact sheet as PNG.',
    )
  }
  if (imageBytes.length > MAX_OUTPUT_BYTES) {
    throw new AiContactSheetError(
      'AI_CONTACT_SHEET_OUTPUT_TOO_LARGE',
      'The encoded contact sheet exceeds Aurora limits.',
    )
  }

  return {
    imageBytes,
    mimeType: 'image/png',
    columns,
    rows,
    width,
    height,
    cellWidth,
    cellHeight,
    slots: frames.map((frame) => frame.slot),
  }
}

function createAiContactSheetComposer() {
  return function composer(input) {
    return composeAiContactSheet(input)
  }
}

module.exports = {
  AiContactSheetError,
  createAiContactSheetComposer,
  resolveContactSheetGrid,
}
