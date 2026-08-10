import { expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type TimestampEntry = {
  sampleTimeSeconds: number
  sourceFrameIndex: number
  sourcePts: string
  sourceTimeBase: string
  timeSeconds: number
}

const { __test } = require('../electron/mediaPipeline.cjs') as {
  __test: {
    readFrameTimestampStats: (
      statsPath: string,
      frameNames: string[],
      durationSeconds: number,
    ) => Promise<TimestampEntry[]>
  }
}

async function parseTimestampRows(
  rows: string[],
  durationSeconds: number,
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'aurora-frame-timestamps-'),
  )
  const statsPath = path.join(directory, 'frame-map.txt')
  const frameNames = rows.map(
    (_row, index) => `frame-${String(index).padStart(6, '0')}.jpg`,
  )
  await writeFile(statsPath, `${rows.join('\n')}\n`, 'utf8')
  try {
    return await __test.readFrameTimestampStats(
      statsPath,
      frameNames,
      durationSeconds,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('accepts FFmpeg six-significant-digit time text while retaining exact NAS camera PTS', async () => {
  const frames = await parseTimestampRows(
    [
      // This is the exact row that caused DJI_20250707163418_0026_D.MP4
      // to fail at 5%: 664664 / 60000 = 11.077733333…, while FFmpeg
      // intentionally prints `{ti}` as the six-significant-digit 11.0777.
      '0|664|664664|1/60000|11.0777|10.2395|6|1616334631/947117519',
    ],
    69.9699,
  )

  expect(frames[0]).toMatchObject({
    sourceFrameIndex: 664,
    sourcePts: '664664',
    sourceTimeBase: '1/60000',
  })
  expect(frames[0].timeSeconds).toBeCloseTo(664664 / 60000, 12)
  expect(frames[0].sampleTimeSeconds).toBeCloseTo(
    (6 * 1616334631) / 947117519,
    12,
  )

  const scientificFrame = await parseTimestampRows(
    ['0|0|3|1/2000000|1.5e-06|0|0|1/1000'],
    1,
  )
  expect(scientificFrame[0].timeSeconds).toBeCloseTo(1.5e-6, 12)
})

test('accepts stripped trailing zeroes without widening the six-digit tolerance', async () => {
  const frames = await parseTimestampRows(
    ['0|0|1|1/5|0.2|0.2|1|1/5'],
    1,
  )
  expect(frames[0].timeSeconds).toBe(0.2)

  await expect(
    parseTimestampRows(['0|0|249|1/1000|0.2|0.2|1|1/5'], 1),
  ).rejects.toThrow('printed input time does not match its exact timestamp')
})

test('still rejects materially incorrect, reversed, or out-of-bounds timestamps', async () => {
  await expect(
    parseTimestampRows(
      ['0|664|664664|1/60000|11.07|10.2395|6|1616334631/947117519'],
      69.9699,
    ),
  ).rejects.toThrow('printed input time does not match its exact timestamp')

  await expect(
    parseTimestampRows(
      [
        '0|0|1000|1/1000|1|0|0|1/1000',
        '1|1|900|1/1000|0.9|0.1|100|1/1000',
      ],
      2,
    ),
  ).rejects.toThrow('outside the source timeline')
})
