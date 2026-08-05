import { expect, test } from '@playwright/test'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createMediaPipeline } = require('../electron/mediaPipeline.cjs') as {
  createMediaPipeline: (options: {
    userDataPath: string
    onProgress?: (progress: {
      kind: string
      phase: string
      progress: number
    }) => void
  }) => {
    createMediaThumbnail: (request: {
      assetId: string
      operationId: string
      sourcePath: string
      durationSeconds: number
    }) => Promise<{
      cached: boolean
      thumbnailPath: string
    }>
    buildVisualIndex: (request: {
      assetId: string
      operationId: string
      sourcePath: string
    }) => Promise<{
      cached: boolean
      frames: Array<{
        imagePath: string
        sampleTimeSeconds: number
        sourceFrameIndex: number
        sourcePts: string
        sourceTimeBase: string
        timeSeconds: number
      }>
      timestampMode: string
      version: number
    }>
    ensureMediaPreview: (request: {
      assetId: string
      forceProxy?: boolean
      operationId: string
      rebuild?: boolean
      sourcePath: string
    }) => Promise<{
      cached: boolean
      frames?: unknown
      playbackPath: string
      previewPath: string | null
      usesPreviewProxy: boolean
      version: number
    }>
  }
}

const execFile = promisify(execFileCallback)

function resolveMediaTool(name: 'ffmpeg' | 'ffprobe'): string | null {
  const environmentPath =
    name === 'ffmpeg'
      ? process.env.AURORA_FFMPEG_PATH
      : process.env.AURORA_FFPROBE_PATH
  const candidates = [
    environmentPath,
    process.platform === 'darwin' ? `/opt/homebrew/bin/${name}` : null,
    process.platform === 'darwin' ? `/usr/local/bin/${name}` : null,
  ]
  return (
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && existsSync(candidate),
    ) ?? null
  )
}

test('visual index stores decoder-input PTS, writes 640px frames, and only reuses v4 cache', async () => {
  const ffmpegPath = resolveMediaTool('ffmpeg')
  const ffprobePath = resolveMediaTool('ffprobe')
  test.skip(
    !ffmpegPath || !ffprobePath,
    'This integration test requires ffmpeg and ffprobe',
  )
  if (!ffmpegPath || !ffprobePath) return

  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'aurora-media-pipeline-test-'),
  )
  const userDataPath = path.join(testDirectory, 'user-data')
  const sourcePath = path.join(testDirectory, 'source.mp4')
  const previousFfmpegPath = process.env.AURORA_FFMPEG_PATH
  const previousFfprobePath = process.env.AURORA_FFPROBE_PATH
  process.env.AURORA_FFMPEG_PATH = ffmpegPath
  process.env.AURORA_FFPROBE_PATH = ffprobePath

  try {
    await execFile(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=128x72:rate=24:duration=8',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      sourcePath,
    ])

    const assetId = 'actual-frame-pts'
    const pipeline = createMediaPipeline({ userDataPath })
    const thumbnail = await pipeline.createMediaThumbnail({
      assetId,
      operationId: 'actual-frame-thumbnail-generate',
      sourcePath,
      durationSeconds: 8,
    })
    expect(thumbnail.cached).toBe(false)
    expect(existsSync(thumbnail.thumbnailPath)).toBe(true)
    expect(
      Array.from(
        (await readFile(thumbnail.thumbnailPath)).subarray(0, 3),
      ),
    ).toEqual([0xff, 0xd8, 0xff])

    const reusedThumbnail = await pipeline.createMediaThumbnail({
      assetId,
      operationId: 'actual-frame-thumbnail-reuse',
      sourcePath,
      durationSeconds: 8,
    })
    expect(reusedThumbnail).toMatchObject({
      cached: true,
      thumbnailPath: thumbnail.thumbnailPath,
    })

    await execFile(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=960x540:rate=24:duration=8',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      sourcePath,
    ])
    const refreshedThumbnail = await pipeline.createMediaThumbnail({
      assetId,
      operationId: 'actual-frame-thumbnail-refresh',
      sourcePath,
      durationSeconds: 8,
    })
    expect(refreshedThumbnail.cached).toBe(false)
    expect(refreshedThumbnail.thumbnailPath).not.toBe(
      thumbnail.thumbnailPath,
    )
    expect(existsSync(thumbnail.thumbnailPath)).toBe(false)
    expect(existsSync(refreshedThumbnail.thumbnailPath)).toBe(true)

    const mediaHash = createHash('sha256')
      .update(assetId)
      .digest('hex')
      .slice(0, 32)
    const v4Directory = path.join(
      userDataPath,
      'media',
      mediaHash,
      'index',
      'v4',
    )
    const v3Directory = path.join(
      userDataPath,
      'media',
      mediaHash,
      'index',
      'v3',
    )
    await mkdir(v3Directory, { recursive: true })
    await writeFile(path.join(v3Directory, 'stale-frame.jpg'), 'stale', 'utf8')
    await mkdir(v4Directory, { recursive: true })
    await writeFile(
      path.join(v4Directory, 'manifest.json'),
      JSON.stringify({ version: 3 }),
      'utf8',
    )

    const generated = await pipeline.buildVisualIndex({
      assetId,
      operationId: 'actual-frame-pts-generate',
      sourcePath,
    })

    expect(generated.cached).toBe(false)
    expect(generated.version).toBe(4)
    expect(generated.timestampMode).toBe('ffmpeg-input-pts-v1')
    expect(generated.frames).toHaveLength(10)
    expect(generated.frames[0]).toMatchObject({
      sampleTimeSeconds: 0,
    })
    expect(generated.frames[0].sourceFrameIndex).toBeGreaterThan(0)
    expect(generated.frames[0].sourcePts).toMatch(/^\d+$/)
    expect(generated.frames[0].sourceTimeBase).toMatch(/^\d+\/\d+$/)
    expect(generated.frames[0].timeSeconds).toBeCloseTo(
      generated.frames[0].sourceFrameIndex / 24,
      8,
    )
    expect(generated.frames[0].timeSeconds).not.toBe(
      generated.frames[0].sampleTimeSeconds,
    )
    const { stdout: indexedFrameDimensions } = await execFile(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=s=x:p=0',
      generated.frames[0].imagePath,
    ])
    expect(indexedFrameDimensions.trim()).toBe('640x360')

    const storedManifest = JSON.parse(
      await readFile(path.join(v4Directory, 'manifest.json'), 'utf8'),
    ) as {
      timestampMode?: string
      version?: number
    }
    expect(storedManifest).toMatchObject({
      timestampMode: 'ffmpeg-input-pts-v1',
      version: 4,
    })
    expect(existsSync(v3Directory)).toBe(false)

    const reused = await pipeline.buildVisualIndex({
      assetId,
      operationId: 'actual-frame-pts-reuse',
      sourcePath,
    })
    expect(reused.cached).toBe(true)
    expect(reused.frames[0].timeSeconds).toBeCloseTo(
      generated.frames[0].timeSeconds,
      8,
    )
  } finally {
    if (previousFfmpegPath == null) {
      delete process.env.AURORA_FFMPEG_PATH
    } else {
      process.env.AURORA_FFMPEG_PATH = previousFfmpegPath
    }
    if (previousFfprobePath == null) {
      delete process.env.AURORA_FFPROBE_PATH
    } else {
      process.env.AURORA_FFPROBE_PATH = previousFfprobePath
    }
    await rm(testDirectory, { recursive: true, force: true })
  }
})

test('visual index supplements the uniform skeleton with detected scene cuts', async () => {
  const ffmpegPath = resolveMediaTool('ffmpeg')
  const ffprobePath = resolveMediaTool('ffprobe')
  test.skip(
    !ffmpegPath || !ffprobePath,
    'This integration test requires ffmpeg and ffprobe',
  )
  if (!ffmpegPath || !ffprobePath) return

  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'aurora-scene-index-test-'),
  )
  const sourcePath = path.join(testDirectory, 'hard-cuts.mp4')
  const previousFfmpegPath = process.env.AURORA_FFMPEG_PATH
  const previousFfprobePath = process.env.AURORA_FFPROBE_PATH
  process.env.AURORA_FFMPEG_PATH = ffmpegPath
  process.env.AURORA_FFPROBE_PATH = ffprobePath

  try {
    await execFile(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=black:size=128x72:rate=24:duration=1',
      '-f',
      'lavfi',
      '-i',
      'color=white:size=128x72:rate=24:duration=1',
      '-f',
      'lavfi',
      '-i',
      'color=red:size=128x72:rate=24:duration=1',
      '-filter_complex',
      '[0:v][1:v][2:v]concat=n=3:v=1:a=0',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      sourcePath,
    ])

    const pipeline = createMediaPipeline({
      userDataPath: path.join(testDirectory, 'user-data'),
    })
    const generated = await pipeline.buildVisualIndex({
      assetId: 'hard-cut-scenes',
      operationId: 'hard-cut-scenes-generate',
      sourcePath,
    })

    expect(generated.frames).toHaveLength(12)
    expect(
      generated.frames.some((frame) => Math.abs(frame.timeSeconds - 1) < 1e-8),
    ).toBe(true)
    expect(
      generated.frames.some((frame) => Math.abs(frame.timeSeconds - 2) < 1e-8),
    ).toBe(true)
  } finally {
    if (previousFfmpegPath == null) {
      delete process.env.AURORA_FFMPEG_PATH
    } else {
      process.env.AURORA_FFMPEG_PATH = previousFfmpegPath
    }
    if (previousFfprobePath == null) {
      delete process.env.AURORA_FFPROBE_PATH
    } else {
      process.env.AURORA_FFPROBE_PATH = previousFfprobePath
    }
    await rm(testDirectory, { recursive: true, force: true })
  }
})

test('preview-only proxy is cached without creating a visual index', async () => {
  const ffmpegPath = resolveMediaTool('ffmpeg')
  const ffprobePath = resolveMediaTool('ffprobe')
  test.skip(
    !ffmpegPath || !ffprobePath,
    'This integration test requires ffmpeg and ffprobe',
  )
  if (!ffmpegPath || !ffprobePath) return

  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'aurora-preview-proxy-test-'),
  )
  const userDataPath = path.join(testDirectory, 'user-data')
  const sourcePath = path.join(testDirectory, 'source-prores.mov')
  const previousFfmpegPath = process.env.AURORA_FFMPEG_PATH
  const previousFfprobePath = process.env.AURORA_FFPROBE_PATH
  process.env.AURORA_FFMPEG_PATH = ffmpegPath
  process.env.AURORA_FFPROBE_PATH = ffprobePath

  try {
    await execFile(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=24:duration=1.25',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '3',
      '-pix_fmt',
      'yuv422p10le',
      sourcePath,
    ])

    const assetId = 'preview-only-prores'
    const progress: Array<{ kind: string; phase: string; progress: number }> = []
    const pipeline = createMediaPipeline({
      userDataPath,
      onProgress: (entry) => progress.push(entry),
    })
    const generated = await pipeline.ensureMediaPreview({
      assetId,
      operationId: 'preview-only-generate',
      sourcePath,
    })

    expect(generated).toMatchObject({
      cached: false,
      usesPreviewProxy: true,
      version: 1,
    })
    expect(generated.previewPath).toBe(generated.playbackPath)
    expect(generated.previewPath).not.toBeNull()
    expect(existsSync(generated.playbackPath)).toBe(true)
    const { stdout: previewDurationText } = await execFile(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      generated.playbackPath,
    ])
    expect(Number(previewDurationText.trim())).toBeCloseTo(1.25, 1)
    expect('frames' in generated).toBe(false)
    expect(
      progress.some(
        (entry) =>
          entry.kind === 'preview-proxy' &&
          entry.phase === 'transcoding-preview',
      ),
    ).toBe(true)

    const mediaHash = createHash('sha256')
      .update(assetId)
      .digest('hex')
      .slice(0, 32)
    expect(
      existsSync(path.join(userDataPath, 'media', mediaHash, 'index')),
    ).toBe(false)

    const reused = await pipeline.ensureMediaPreview({
      assetId,
      operationId: 'preview-only-reuse',
      sourcePath,
    })
    expect(reused).toMatchObject({
      cached: true,
      playbackPath: generated.playbackPath,
      usesPreviewProxy: true,
    })
    expect('frames' in reused).toBe(false)
  } finally {
    if (previousFfmpegPath == null) {
      delete process.env.AURORA_FFMPEG_PATH
    } else {
      process.env.AURORA_FFMPEG_PATH = previousFfmpegPath
    }
    if (previousFfprobePath == null) {
      delete process.env.AURORA_FFPROBE_PATH
    } else {
      process.env.AURORA_FFPROBE_PATH = previousFfprobePath
    }
    await rm(testDirectory, { recursive: true, force: true })
  }
})
