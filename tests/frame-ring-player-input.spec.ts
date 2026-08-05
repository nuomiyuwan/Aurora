import { expect, test } from '@playwright/test'

test('maps local-player keyboard and horizontal trackpad input to bounded seeking', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const {
      clampLocalPlayerTime,
      LOCAL_PLAYER_KEYBOARD_SEEK_SECONDS,
      resolveLocalPlayerTrackpadSeekDelta,
    } = await import(
      '/src/features/frame-ring/frameRingPlayerInput.ts'
    )

    return {
      keyboardStep: LOCAL_PLAYER_KEYBOARD_SEEK_SECONDS,
      lowerBoundary: clampLocalPlayerTime(-4, 0, 120),
      upperBoundary: clampLocalPlayerTime(124, 0, 120),
      middle: clampLocalPlayerTime(61, 0, 120),
      shortClipTrackpad: resolveLocalPlayerTrackpadSeekDelta(
        { deltaX: 10, deltaY: 1, deltaMode: 0, ctrlKey: false },
        10,
        900,
      ),
      longClipTrackpad: resolveLocalPlayerTrackpadSeekDelta(
        { deltaX: 10, deltaY: 1, deltaMode: 0, ctrlKey: false },
        3_200,
        900,
      ),
      reverseTrackpad: resolveLocalPlayerTrackpadSeekDelta(
        { deltaX: -10, deltaY: 1, deltaMode: 0, ctrlKey: false },
        3_200,
        900,
      ),
      verticalGesture: resolveLocalPlayerTrackpadSeekDelta(
        { deltaX: 3, deltaY: 12, deltaMode: 0, ctrlKey: false },
        120,
        900,
      ),
      pinchGesture: resolveLocalPlayerTrackpadSeekDelta(
        { deltaX: 12, deltaY: 1, deltaMode: 0, ctrlKey: true },
        120,
        900,
      ),
    }
  })

  expect(result).toEqual({
    keyboardStep: 5,
    lowerBoundary: 0,
    upperBoundary: 120,
    middle: 61,
    shortClipTrackpad: -0.2,
    longClipTrackpad: -5,
    reverseTrackpad: 5,
    verticalGesture: null,
    pinchGesture: null,
  })
})
