import { expect, test } from '@playwright/test'
import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const execFile = promisify(execFileCallback)

type SceneCandidate = {
  index: number
  pts: string
  timeSeconds: number
}

type FrameEntry = {
  kind: 'scene' | 'uniform'
  timestamp: {
    sourcePts: string
    sourceTimeBase: string
    timeSeconds: number
  }
}

const { __test } = require('../electron/mediaPipeline.cjs') as {
  __test: {
    INDEX_JPEG_QUALITY: number
    INDEX_MAX_EDGE: number
    MAX_INDEX_FRAME_COUNT: number
    chooseIndexFrameCount: (durationSeconds: number) => number
    chooseSceneChangeCandidates: (
      candidates: SceneCandidate[],
      durationSeconds: number,
      uniformFrameCount: number,
    ) => SceneCandidate[]
    createBalancedSceneSelectionExpression: (
      candidates: SceneCandidate[],
    ) => string
    createIndexScaleFilter: () => string
    createSceneChangeParser: () => {
      append: (chunk: string) => void
      finish: () => SceneCandidate[]
    }
    mergeIndexFrameEntries: (
      uniformFrames: FrameEntry[],
      sceneFrames: FrameEntry[],
    ) => FrameEntry[]
  }
}

function frameEntry(
  kind: FrameEntry['kind'],
  index: number,
  timeSeconds: number,
): FrameEntry {
  return {
    kind,
    timestamp: {
      sourcePts: `${kind}-${index}`,
      sourceTimeBase: '1/1000',
      timeSeconds,
    },
  }
}

test('uses the adaptive sampling formula across short videos and feature films', () => {
  expect(
    [10, 100, 500, 3600, 7200].map((durationSeconds) =>
      __test.chooseIndexFrameCount(durationSeconds),
    ),
  ).toEqual([10, 52, 167, 693, 1141])
  expect(__test.chooseIndexFrameCount(10_800)).toBe(1200)
})

test('caps the longest thumbnail edge at 640 and uses moderate JPEG quality', () => {
  expect(__test.INDEX_MAX_EDGE).toBe(640)
  expect(__test.INDEX_JPEG_QUALITY).toBe(5)
  expect(__test.createIndexScaleFilter()).toBe(
    "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
  )
})

test('parses scene changes across stderr chunks without losing the last row', () => {
  const parser = __test.createSceneChangeParser()
  parser.append('[Parsed_showinfo_4] n:   0 pts:  12288 pts_time:1.0 dur')
  parser.append('ation:512\nnoise\n[Parsed_showinfo_4] n: 1 pts:24576 ')
  parser.append('pts_time:2.0')

  expect(parser.finish()).toEqual([
    { index: 0, pts: '12288', timeSeconds: 1 },
    { index: 1, pts: '24576', timeSeconds: 2 },
  ])
})

test('selects scene supplements globally instead of truncating at early cuts', () => {
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    index,
    pts: String(index),
    timeSeconds: index * 10 + 5,
  }))
  const selected = __test.chooseSceneChangeCandidates(
    candidates,
    11_980,
    1198,
  )

  expect(selected.map((candidate) => candidate.index)).toEqual([0, 99])
  expect(
    __test.chooseSceneChangeCandidates(candidates, 11_980, 1200),
  ).toEqual([])
})

test('never lets scene supplements displace the uniform timeline skeleton', () => {
  const uniformFrames = Array.from({ length: 1198 }, (_, index) =>
    frameEntry('uniform', index, index * 10),
  )
  const sceneFrames = Array.from({ length: 20 }, (_, index) =>
    frameEntry('scene', index, index + 0.5),
  )
  const merged = __test.mergeIndexFrameEntries(uniformFrames, sceneFrames)

  expect(merged).toHaveLength(__test.MAX_INDEX_FRAME_COUNT)
  expect(merged.filter((frame) => frame.kind === 'uniform')).toHaveLength(1198)
  expect(merged).toContain(uniformFrames.at(-1))
  expect(
    merged
      .filter((frame) => frame.kind === 'scene')
      .map((frame) => frame.timestamp.sourcePts),
  ).toEqual(['scene-0', 'scene-19'])
})

test('balances large scene-selection expressions below FFmpeg parser depth limits', async () => {
  const candidates = Array.from({ length: 1200 }, (_, index) => ({
    index,
    pts: String(index),
    timeSeconds: index,
  }))
  const expression =
    __test.createBalancedSceneSelectionExpression(candidates)
  let depth = 0
  let maximumDepth = 0
  for (const character of expression) {
    if (character === '(') maximumDepth = Math.max(maximumDepth, ++depth)
    if (character === ')') depth -= 1
  }
  expect(depth).toBe(0)
  expect(maximumDepth).toBeLessThanOrEqual(12)
  expect((expression.match(/eq\(n,/g) ?? [])).toHaveLength(1200)

  const bundledFfmpeg = path.resolve(process.cwd(), 'resources/bin/ffmpeg')
  const startupVideo = path.resolve(
    process.cwd(),
    'public/aurora/startup-ice-valley-v1.mp4',
  )
  test.skip(
    !existsSync(bundledFfmpeg) || !existsSync(startupVideo),
    'This regression check requires the bundled FFmpeg parser and startup video',
  )
  await execFile(
    bundledFfmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      startupVideo,
      '-an',
      '-vf',
      `select='${expression}'`,
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ],
    { timeout: 10_000 },
  )
})
