import { expect, test } from '@playwright/test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js') as {
  encode(input: { width: number; height: number; data: Buffer }, quality: number): {
    data: Buffer
  }
}
const { PNG } = require('pngjs') as {
  PNG: {
    sync: {
      read(buffer: Buffer): { width: number; height: number; data: Buffer }
      write(input: { width: number; height: number; data: Buffer }): Buffer
    }
  }
}
const {
  AiContactSheetError,
  createAiContactSheetComposer,
  resolveContactSheetGrid,
} = require('../electron/aiContactSheet.cjs') as {
  AiContactSheetError: new (code: string, message: string) => Error & { code: string }
  createAiContactSheetComposer(): (input: ContactSheetInput) => ContactSheetResult
  resolveContactSheetGrid(
    frameCount: number,
    requestedColumns?: number,
  ): { columns: number; rows: number }
}

type ContactSheetInput = {
  frames: Array<{
    imageBytes: Buffer
    mimeType: string
    slot?: number
  }>
  cellWidth?: number
  columns?: number
  gap?: number
  padding?: number
}

type ContactSheetResult = {
  imageBytes: Buffer
  mimeType: 'image/png'
  columns: number
  rows: number
  width: number
  height: number
  cellWidth: number
  cellHeight: number
  slots: number[]
}

function solidRgba(width: number, height: number, value: number) {
  const data = Buffer.alloc(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }
  return data
}

function solidPng(width: number, height: number, value: number) {
  return PNG.sync.write({
    width,
    height,
    data: solidRgba(width, height, value),
  })
}

function solidJpeg(width: number, height: number, value: number) {
  return Buffer.from(
    jpeg.encode(
      {
        width,
        height,
        data: solidRgba(width, height, value),
      },
      90,
    ).data,
  )
}

function pixelValue(bitmap: Buffer, width: number, x: number, y: number) {
  return bitmap[(y * width + x) * 4]
}

test('builds a row-major in-memory PNG with fixed 16:9 cells and black spacing', () => {
  const composer = createAiContactSheetComposer()
  const result = composer({
    frames: [
      { imageBytes: solidPng(400, 200, 80), mimeType: 'image/png', slot: 7 },
      { imageBytes: solidJpeg(100, 200, 160), mimeType: 'image/jpeg', slot: 8 },
      { imageBytes: solidPng(200, 200, 220), mimeType: 'image/png', slot: 9 },
    ],
  })

  expect(result).toMatchObject({
    mimeType: 'image/png',
    columns: 2,
    rows: 2,
    width: 664,
    height: 384,
    cellWidth: 320,
    cellHeight: 180,
    slots: [7, 8, 9],
  })
  expect(result.imageBytes.byteLength).toBeGreaterThan(0)

  const output = PNG.sync.read(result.imageBytes)
  expect(output).toMatchObject({ width: result.width, height: result.height })
  // The first wide image is vertically letterboxed and centered in its 16:9 tile.
  expect(pixelValue(output.data, result.width, 200, 12)).toBe(0)
  expect(pixelValue(output.data, result.width, 200, 24)).toBe(80)
  // The portrait JPEG is horizontally letterboxed and centered in the second tile.
  expect(pixelValue(output.data, result.width, 350, 100)).toBe(0)
  expect(pixelValue(output.data, result.width, 500, 100)).toBeGreaterThan(150)
  // Horizontal/vertical separators are black, while the slot glyph is white.
  expect(pixelValue(output.data, result.width, 332, 100)).toBe(0)
  expect(pixelValue(output.data, result.width, 200, 192)).toBe(0)
  expect(pixelValue(output.data, result.width, 16, 12)).toBe(255)
})

test('derives stable grids for two through twelve row-major frames', () => {
  expect(resolveContactSheetGrid(2)).toEqual({ columns: 2, rows: 1 })
  expect(resolveContactSheetGrid(4)).toEqual({ columns: 2, rows: 2 })
  expect(resolveContactSheetGrid(5)).toEqual({ columns: 3, rows: 2 })
  expect(resolveContactSheetGrid(9)).toEqual({ columns: 3, rows: 3 })
  expect(resolveContactSheetGrid(12)).toEqual({ columns: 4, rows: 3 })
  expect(resolveContactSheetGrid(7, 4)).toEqual({ columns: 4, rows: 2 })
})

test('rejects invalid frames, unsupported WebP and unsafe decoded dimensions', () => {
  const composer = createAiContactSheetComposer()
  const validPng = solidPng(16, 16, 90)

  expect(() => composer({ frames: [] })).toThrow(AiContactSheetError)
  expect(() => composer({
    frames: [
      { imageBytes: validPng, mimeType: 'image/png', slot: 1 },
      { imageBytes: validPng, mimeType: 'image/png', slot: 1 },
    ],
  })).toThrow('Frame slots must be unique.')
  expect(() => composer({
    frames: [
      { imageBytes: validPng, mimeType: 'image/webp' },
      { imageBytes: validPng, mimeType: 'image/png' },
    ],
  })).toThrow('mimeType is unsupported')
  expect(() => composer({
    frames: [
      { imageBytes: Buffer.from('not-an-image'), mimeType: 'image/jpeg' },
      { imageBytes: validPng, mimeType: 'image/png' },
    ],
  })).toThrow('JPEG header is invalid')

  const unsafePng = Buffer.from(validPng)
  unsafePng.writeUInt32BE(16_384, 16)
  unsafePng.writeUInt32BE(16_384, 20)
  expect(() => composer({
    frames: [
      { imageBytes: unsafePng, mimeType: 'image/png' },
      { imageBytes: validPng, mimeType: 'image/png' },
    ],
  })).toThrow('unsafe pixel dimensions')
})
