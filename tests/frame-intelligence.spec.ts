import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
      write(input: { width: number; height: number; data: Buffer }): Buffer
    }
  }
}
const {
  FrameIntelligenceError,
  createFrameIntelligenceEngine,
} = require('../electron/frameIntelligence.cjs') as {
  FrameIntelligenceError: new (code: string, message: string) => Error & {
    code: string
  }
  createFrameIntelligenceEngine(): {
    analyzeFrames(input: {
      frames: FrameInput[]
      sensitivity?: 'conservative' | 'balanced' | 'aggressive'
    }): Promise<AnalysisResult>
  }
}

type FrameInput = {
  frameId: string
  imagePath: string
  timeSeconds: number
}

type AnalysisResult = {
  version: number
  sensitivity: string
  analyzedFrameCount: number
  frames: Array<{
    frameId: string
    blankCandidate: null | {
      kind: 'black' | 'white'
      confidence: number
    }
    metrics: Record<string, number>
  }>
  blankCandidates: Array<{
    frameId: string
    kind: 'black' | 'white'
    confidence: number
  }>
  duplicateGroups: Array<{
    keepFrameId: string
    removeFrameIds: string[]
    representative: { frameId: string; qualityScore: number }
    members: Array<{
      frameId: string
      comparedToFrameId: string
      metrics: { similarity: number; hashDistance: number }
    }>
  }>
}

function rgba(
  width: number,
  height: number,
  painter: (x: number, y: number) => [number, number, number],
) {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = painter(x, y)
      const offset = (y * width + x) * 4
      data[offset] = red
      data[offset + 1] = green
      data[offset + 2] = blue
      data[offset + 3] = 255
    }
  }
  return data
}

function png(width: number, height: number, data: Buffer) {
  return PNG.sync.write({ width, height, data })
}

function jpg(width: number, height: number, data: Buffer, quality = 92) {
  return Buffer.from(jpeg.encode({ width, height, data }, quality).data)
}

test('strictly detects pure black and white frames with explicit confidence metrics', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aurora-frame-intelligence-'))
  try {
    const blackPath = path.join(directory, 'black.jpg')
    const whitePath = path.join(directory, 'white.png')
    await writeFile(blackPath, jpg(320, 180, rgba(320, 180, () => [2, 2, 2])))
    await writeFile(whitePath, png(320, 180, rgba(320, 180, () => [253, 253, 253])))

    const result = await createFrameIntelligenceEngine().analyzeFrames({
      frames: [
        { frameId: 'black', imagePath: blackPath, timeSeconds: 0 },
        { frameId: 'white', imagePath: whitePath, timeSeconds: 1 },
      ],
    })

    expect(result).toMatchObject({
      version: 1,
      sensitivity: 'conservative',
      analyzedFrameCount: 2,
    })
    expect(result.blankCandidates.map(({ frameId, kind }) => ({ frameId, kind }))).toEqual([
      { frameId: 'black', kind: 'black' },
      { frameId: 'white', kind: 'white' },
    ])
    expect(result.blankCandidates.every(({ confidence }) => confidence >= 0.92)).toBe(true)
    expect(result.frames[0].metrics).toMatchObject({
      lumaP99: expect.any(Number),
      lumaStdDev: expect.any(Number),
      edgeDensity: expect.any(Number),
      qualityScore: expect.any(Number),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('does not classify black or white title cards with visible subtitle or logo detail', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aurora-frame-intelligence-'))
  try {
    const blackTitlePath = path.join(directory, 'black-title.png')
    const whiteLogoPath = path.join(directory, 'white-logo.png')
    await writeFile(
      blackTitlePath,
      png(320, 180, rgba(320, 180, (x, y) => {
        const subtitle = y >= 145 && y <= 156 && x >= 65 && x <= 255
        return subtitle ? [245, 245, 245] : [2, 2, 2]
      })),
    )
    await writeFile(
      whiteLogoPath,
      png(320, 180, rgba(320, 180, (x, y) => {
        const logo = x >= 278 && x <= 306 && y >= 12 && y <= 40
        return logo ? [10, 10, 10] : [252, 252, 252]
      })),
    )

    const result = await createFrameIntelligenceEngine().analyzeFrames({
      frames: [
        { frameId: 'subtitle', imagePath: blackTitlePath, timeSeconds: 0 },
        { frameId: 'logo', imagePath: whiteLogoPath, timeSeconds: 1 },
      ],
      sensitivity: 'aggressive',
    })

    expect(result.blankCandidates).toEqual([])
    expect(result.frames.every(({ blankCandidate }) => blankCandidate === null)).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('groups JPEG and PNG near-duplicates using one best representative and pixel confirmation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aurora-frame-intelligence-'))
  try {
    const width = 320
    const height = 180
    const scene = rgba(width, height, (x, y) => {
      const stripe = (Math.floor(x / 22) + Math.floor(y / 18)) % 2
      return stripe ? [28 + (x % 20), 90 + (y % 30), 182] : [190, 72, 35]
    })
    const representativePath = path.join(directory, 'representative.png')
    const encodedPath = path.join(directory, 'encoded.jpg')
    const copyPath = path.join(directory, 'copy.png')
    const differentPath = path.join(directory, 'different.png')
    await writeFile(representativePath, png(width, height, scene))
    await writeFile(encodedPath, jpg(width, height, scene, 95))
    await writeFile(copyPath, png(width, height, scene))
    await writeFile(
      differentPath,
      png(width, height, rgba(width, height, (x, y) => [x % 255, y % 255, (x + y) % 255])),
    )

    const result = await createFrameIntelligenceEngine().analyzeFrames({
      frames: [
        { frameId: 'best', imagePath: representativePath, timeSeconds: 1 },
        { frameId: 'jpeg-copy', imagePath: encodedPath, timeSeconds: 2 },
        { frameId: 'png-copy', imagePath: copyPath, timeSeconds: 3 },
        { frameId: 'different', imagePath: differentPath, timeSeconds: 4 },
      ],
    })

    expect(result.duplicateGroups).toHaveLength(1)
    const group = result.duplicateGroups[0]
    expect(group.keepFrameId).toBe('best')
    expect(group.removeFrameIds).toEqual(['jpeg-copy', 'png-copy'])
    expect(group.members.map(({ comparedToFrameId }) => comparedToFrameId)).toEqual([
      'best',
      'best',
    ])
    expect(group.members.every(({ metrics }) => (
      metrics.similarity > 0.95 && metrics.hashDistance <= 16
    ))).toBe(true)
    expect(group.removeFrameIds).not.toContain('different')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('sensitivity is explicit and conservative remains the default', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aurora-frame-intelligence-'))
  try {
    const darkPath = path.join(directory, 'dark.png')
    await writeFile(darkPath, png(320, 180, rgba(320, 180, () => [20, 20, 20])))
    const engine = createFrameIntelligenceEngine()
    const conservative = await engine.analyzeFrames({
      frames: [{ frameId: 'dark', imagePath: darkPath, timeSeconds: 0 }],
    })
    const aggressive = await engine.analyzeFrames({
      sensitivity: 'aggressive',
      frames: [{ frameId: 'dark', imagePath: darkPath, timeSeconds: 0 }],
    })

    expect(conservative.sensitivity).toBe('conservative')
    expect(conservative.blankCandidates).toEqual([])
    expect(aggressive.blankCandidates).toEqual([
      expect.objectContaining({ frameId: 'dark', kind: 'black' }),
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects duplicate IDs, relative paths and unsupported image bytes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aurora-frame-intelligence-'))
  try {
    const unsupportedPath = path.join(directory, 'frame.webp')
    await writeFile(unsupportedPath, Buffer.from('not-a-supported-image'))
    const engine = createFrameIntelligenceEngine()

    await expect(engine.analyzeFrames({
      frames: [{ frameId: 'relative', imagePath: 'frame.jpg', timeSeconds: 0 }],
    })).rejects.toBeInstanceOf(FrameIntelligenceError)
    await expect(engine.analyzeFrames({
      frames: [
        { frameId: 'same', imagePath: unsupportedPath, timeSeconds: 0 },
        { frameId: 'same', imagePath: unsupportedPath, timeSeconds: 1 },
      ],
    })).rejects.toThrow('duplicated')
    await expect(engine.analyzeFrames({
      frames: [{ frameId: 'unsupported', imagePath: unsupportedPath, timeSeconds: 0 }],
    })).rejects.toThrow('Only JPEG and PNG')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('exposes local quality analysis through the Electron bridge without replacing AI frame analysis', async () => {
  const [mainSource, preloadSource, bridgeTypes] = await Promise.all([
    readFile(path.resolve('electron/main.cjs'), 'utf8'),
    readFile(path.resolve('electron/preload.cjs'), 'utf8'),
    readFile(path.resolve('src/desktopBridge.d.ts'), 'utf8'),
  ])

  expect(mainSource).toContain("require('./frameIntelligence.cjs')")
  expect(mainSource).toContain(
    "ipcMain.handle('frame-intelligence:analyze-quality'",
  )
  expect(mainSource).toContain('frameIntelligenceEngine.analyzeFrames(request)')
  expect(preloadSource).toContain('analyzeFrameQuality: (request) =>')
  expect(preloadSource).toContain(
    "ipcRenderer.invoke('frame-intelligence:analyze-quality', request)",
  )
  expect(preloadSource).toContain('analyzeAiVisualFrames: (request) =>')
  expect(bridgeTypes).toContain('interface FrameQualityAnalysisRequest')
  expect(bridgeTypes).toContain('interface FrameQualityAnalysisResponse')
  expect(bridgeTypes).toContain('analyzeFrameQuality(')
  expect(bridgeTypes).toContain('analyzeAiVisualFrames(')
})
