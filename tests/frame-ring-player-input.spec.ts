import { expect, test } from '@playwright/test'

test('maps local-player keyboard and horizontal trackpad input to bounded seeking', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const {
      clampLocalPlayerTime,
      clampLocalPlayerVolume,
      LOCAL_PLAYER_KEYBOARD_SEEK_SECONDS,
      LOCAL_PLAYER_KEYBOARD_VOLUME_STEP,
      resolveLocalPlayerTrackpadSeekDelta,
      shouldRestartLocalPlayerPlayback,
    } = await import(
      '/src/features/frame-ring/frameRingPlayerInput.ts'
    )

    return {
      keyboardStep: LOCAL_PLAYER_KEYBOARD_SEEK_SECONDS,
      keyboardVolumeStep: LOCAL_PLAYER_KEYBOARD_VOLUME_STEP,
      lowerBoundary: clampLocalPlayerTime(-4, 0, 120),
      upperBoundary: clampLocalPlayerTime(124, 0, 120),
      middle: clampLocalPlayerTime(61, 0, 120),
      mutedVolumeBoundary: clampLocalPlayerVolume(-0.2),
      fullVolumeBoundary: clampLocalPlayerVolume(1.2),
      middleVolume: clampLocalPlayerVolume(0.55),
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
      nativeEndBeforeMetadataEnd: shouldRestartLocalPlayerPlayback({
        currentTime: 13.8,
        startSeconds: 0,
        endSeconds: 14,
        frameDurationSeconds: 1 / 60,
        ended: true,
      }),
      ordinaryPausedPosition: shouldRestartLocalPlayerPlayback({
        currentTime: 8,
        startSeconds: 0,
        endSeconds: 14,
        frameDurationSeconds: 1 / 60,
        ended: false,
      }),
    }
  })

  expect(result).toEqual({
    keyboardStep: 5,
    keyboardVolumeStep: 0.05,
    lowerBoundary: 0,
    upperBoundary: 120,
    middle: 61,
    mutedVolumeBoundary: 0,
    fullVolumeBoundary: 1,
    middleVolume: 0.55,
    shortClipTrackpad: -0.2,
    longClipTrackpad: -5,
    reverseTrackpad: 5,
    verticalGesture: null,
    pinchGesture: null,
    nativeEndBeforeMetadataEnd: true,
    ordinaryPausedPosition: false,
  })
})

test('adjusts local-video volume with ArrowUp and ArrowDown outside controls', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.evaluate(() => {
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        getPathForFile: (file: File) => `/virtual/${file.name}`,
        getMediaUrl: (sourcePath: string) =>
          sourcePath.endsWith('/startup-ice-valley-v1.webm')
            ? '/aurora/startup-ice-valley-v1.webm'
            : null,
      },
    })
  })
  await page.getByRole('button', { name: '极境之环 项目设置' }).click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', {
    name: '导入素材 添加本地视频到当前项目',
    exact: true,
  }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles('public/aurora/startup-ice-valley-v1.webm')
  await page.getByRole('button', {
    name: '极境之环 打开项目',
    exact: true,
  }).click()
  await expect(
    page.getByRole('region', { name: '极境之环 视频片段库' }),
  ).toBeVisible()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '打开帧环浏览' }).click()
  await expect(
    page.getByRole('region', {
      name: 'startup-ice-valley-v1.webm 帧环浏览',
    }),
  ).toBeVisible()

  const volumeRanges = page.locator('.frameRingPreviewVolumeRange:not(:disabled)')
  await expect(volumeRanges.first()).toHaveValue('100')
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })

  await page.keyboard.press('ArrowDown')
  await expect(volumeRanges.first()).toHaveValue('95')
  await page.keyboard.press('ArrowUp')
  await expect(volumeRanges.first()).toHaveValue('100')
})
