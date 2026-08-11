import { expect, test } from '@playwright/test'

test('maps idle mouse movement across a clip preview to its full timeline', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const {
      resolveVideoClipHoverFrameIndex,
      resolveVideoClipHoverPlaybackSource,
      resolveVideoClipHoverProgress,
      resolveVideoClipHoverSeekTime,
      resolveVideoClipHoverTime,
      shouldHandleVideoClipHoverPointer,
    } = await import(
      '/src/features/video-library/videoClipHoverScrub.ts'
    )
    const rect = {
      left: 100,
      right: 500,
      top: 40,
      bottom: 240,
      width: 400,
      height: 200,
    }

    return {
      left: resolveVideoClipHoverProgress(100, 120, rect),
      quarter: resolveVideoClipHoverProgress(200, 120, rect),
      middle: resolveVideoClipHoverProgress(300, 120, rect),
      right: resolveVideoClipHoverProgress(500, 120, rect),
      outsideTop: resolveVideoClipHoverProgress(300, 20, rect),
      outsideRight: resolveVideoClipHoverProgress(501, 120, rect),
      invalidRect: resolveVideoClipHoverProgress(100, 120, {
        ...rect,
        width: 0,
      }),
      middleTime: resolveVideoClipHoverTime(0.5, 120),
      boundedTime: resolveVideoClipHoverTime(2, 120),
      invalidTime: resolveVideoClipHoverTime(0.5, 0),
      quantizedSeek: resolveVideoClipHoverSeekTime(0.501, 120),
      guardedEndSeek: resolveVideoClipHoverSeekTime(1, 120),
      warmingSource: resolveVideoClipHoverPlaybackSource(
        null,
        'aurora-media://source.mov',
      ),
      readyLightweightSource: resolveVideoClipHoverPlaybackSource(
        'aurora-media://lightweight.mp4',
        'aurora-media://source.mov',
      ),
      timedFrame: resolveVideoClipHoverFrameIndex(
        0.52,
        [0, 20, 60, 90, 120],
        120,
      ),
      fallbackFrame: resolveVideoClipHoverFrameIndex(
        0.5,
        [Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN],
        null,
      ),
      idleMouse: shouldHandleVideoClipHoverPointer({
        pointerType: 'mouse',
        buttons: 0,
      }),
      pressedMouse: shouldHandleVideoClipHoverPointer({
        pointerType: 'mouse',
        buttons: 1,
      }),
      touch: shouldHandleVideoClipHoverPointer({
        pointerType: 'touch',
        buttons: 0,
      }),
      pen: shouldHandleVideoClipHoverPointer({
        pointerType: 'pen',
        buttons: 0,
      }),
    }
  })

  expect(result).toMatchObject({
    left: 0,
    quarter: 0.25,
    middle: 0.5,
    right: 1,
    outsideTop: null,
    outsideRight: null,
    invalidRect: null,
    middleTime: 60,
    boundedTime: 120,
    invalidTime: null,
    warmingSource: 'aurora-media://source.mov',
    readyLightweightSource: 'aurora-media://lightweight.mp4',
    timedFrame: 2,
    fallbackFrame: 2,
    idleMouse: true,
    pressedMouse: false,
    touch: false,
    pen: false,
  })
  expect(result.quantizedSeek).toBeCloseTo(60.083333, 6)
  expect(result.guardedEndSeek).toBeCloseTo(119.916667, 6)
})
