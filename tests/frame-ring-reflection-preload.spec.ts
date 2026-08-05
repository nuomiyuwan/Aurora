import { expect, test } from '@playwright/test'

test('selects a bounded directional halo outside the visible frame range', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const { getFrameRingReflectionPreloadFrames } = await import(
      '/src/features/frame-ring/frameRingData.ts'
    )
    const frames = Array.from({ length: 30 }, (_, index) => ({
      id: `frame-${index}`,
      index,
      thumbnail: '',
      timeSeconds: index,
      timecode: String(index),
      shortTimecode: String(index),
      cropX: 50,
      cropY: 50,
      brightness: 1,
    }))
    const ids = (
      direction: -1 | 0 | 1,
      visibleRange = { start: 10, end: 23 },
    ) =>
      getFrameRingReflectionPreloadFrames(
        frames,
        visibleRange,
        direction,
      ).map((frame) => frame.id)

    return {
      forward: ids(1),
      reverse: ids(-1),
      idle: ids(0),
      leadingBoundary: ids(-1, { start: 0, end: 13 }),
      trailingBoundary: ids(1, { start: 17, end: 30 }),
    }
  })

  expect(result.forward).toEqual(['frame-23', 'frame-24', 'frame-25', 'frame-9'])
  expect(result.reverse).toEqual(['frame-9', 'frame-8', 'frame-7', 'frame-23'])
  expect(result.idle).toEqual(['frame-23', 'frame-24', 'frame-9', 'frame-8'])
  expect(result.leadingBoundary).toEqual([
    'frame-13',
    'frame-14',
    'frame-15',
    'frame-16',
  ])
  expect(result.trailingBoundary).toEqual([
    'frame-16',
    'frame-15',
    'frame-14',
    'frame-13',
  ])
})
