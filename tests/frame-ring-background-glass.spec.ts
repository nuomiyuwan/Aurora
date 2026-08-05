import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1706, height: 956 } })

async function openFrameRing(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: '极境之环 项目设置' }).click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', {
    name: '导入素材 添加本地视频到当前项目',
    exact: true,
  }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'A001_C012.mov',
    mimeType: 'video/quicktime',
    buffer: Buffer.from('Aurora frame ring player fixture'),
  })
  await page.getByRole('button', { name: '极境之环 打开项目', exact: true }).click()
  await expect(page.getByRole('region', { name: '极境之环 视频片段库' })).toBeVisible()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '打开帧环浏览/预览' }).click()
  await expect(page.getByRole('region', { name: 'A001_C012.mov 帧环浏览' })).toBeVisible()
}

test('keeps the frame-ring background over the viewport at every camera extreme', async ({
  page,
}) => {
  await openFrameRing(page)
  const app = page.locator('.auroraApp')
  const background = page.locator('.stageBackground')
  await app.evaluate((element) => {
    element.setPointerCapture = () => undefined
    element.releasePointerCapture = () => undefined
    element.hasPointerCapture = () => false
  })

  const assertCoverage = async () => {
    const rect = await background.boundingBox()
    expect(rect).not.toBeNull()
    expect(rect!.x).toBeLessThanOrEqual(-2)
    expect(rect!.y).toBeLessThanOrEqual(-2)
    expect(rect!.x + rect!.width).toBeGreaterThanOrEqual(1708)
    expect(rect!.y + rect!.height).toBeGreaterThanOrEqual(958)
  }

  await assertCoverage()
  const extremes = [
    { pointerId: 71, x: 3000, y: -3000, yaw: '10.5deg', pitch: '8deg' },
    { pointerId: 72, x: -3000, y: -3000, yaw: '-10.5deg', pitch: '8deg' },
    { pointerId: 73, x: -3000, y: 3000, yaw: '-10.5deg', pitch: '-10deg' },
    { pointerId: 74, x: 3000, y: 3000, yaw: '10.5deg', pitch: '-10deg' },
  ]

  for (const extreme of extremes) {
    await app.dispatchEvent('pointerdown', {
      button: 0,
      pointerId: extreme.pointerId,
      clientX: 850,
      clientY: 480,
    })
    await app.dispatchEvent('pointermove', {
      button: 0,
      pointerId: extreme.pointerId,
      clientX: extreme.x,
      clientY: extreme.y,
    })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    await expect(app).toHaveCSS('--camera-yaw', extreme.yaw)
    await expect(app).toHaveCSS('--camera-pitch', extreme.pitch)
    await assertCoverage()
    await app.dispatchEvent('pointerup', {
      button: 0,
      pointerId: extreme.pointerId,
      clientX: extreme.x,
      clientY: extreme.y,
    })
  }
})

test('keeps the player controls above a dedicated root three-dimensional glass leaf', async ({
  page,
}) => {
  await openFrameRing(page)

  const glass = page.locator('.frameRingPreviewControlsProjectedGlass')
  const portalObject = page.locator('.frameRingPreviewControlsPortalObject')
  const controls = page.locator('.frameRingPreviewControlsPortal')
  const reflectionProxy = page.locator('.frameRingPreviewControlsReflection')

  await expect(glass).toHaveCount(1)
  await expect(portalObject).toHaveCount(1)
  await expect(controls).toHaveCount(1)
  await expect(reflectionProxy).toHaveCount(1)
  await expect(reflectionProxy).toHaveCSS('opacity', '0')
  await expect(glass).toHaveCSS('pointer-events', 'none')
  await expect(glass).toHaveCSS('backdrop-filter', /blur\(/)
  await expect(controls).toHaveCSS('backdrop-filter', 'none')
  await expect(page.locator('.frameRingFloatingCameraRig').first()).toHaveCSS(
    'backdrop-filter',
    'none',
  )

  const structure = await page.evaluate(() => {
    const glassElement = document.querySelector<HTMLElement>(
      '.frameRingPreviewControlsProjectedGlass',
    )!
    const portalElement = document.querySelector<HTMLElement>(
      '.frameRingPreviewControlsPortalObject',
    )!
    return {
      glassRoot: glassElement.closest('.frameRingProjectedGlassLayer')?.parentElement?.className,
      portalRoot: portalElement.closest('.frameRingInfoPortalLayer')?.parentElement?.className,
      glassTransform: getComputedStyle(glassElement).transform,
      portalTransform: getComputedStyle(portalElement).transform,
      clipPath: getComputedStyle(glassElement).clipPath,
      activeRanges: document.querySelectorAll('.frameRingPreviewRange:not(:disabled)').length,
    }
  })
  expect(structure.glassRoot).toContain('auroraApp')
  expect(structure.portalRoot).toContain('auroraApp')
  expect(structure.glassTransform).toBe(structure.portalTransform)
  expect(structure.clipPath).toContain('inset(')
  expect(structure.activeRanges).toBe(1)
  await expect(page.getByRole('slider', { name: '视频播放进度' })).toHaveCount(1)
  await expect(page.getByRole('slider', { name: '视频音量' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '播放视频' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '全屏播放' })).toHaveCount(1)

  await page.getByRole('button', { name: '播放视频' }).click()
  await expect(portalObject).toHaveAttribute('data-controls-visible', 'false')
  await expect(glass).toHaveAttribute('data-controls-visible', 'false')
  await expect(portalObject).toHaveCSS('opacity', '0')
  await expect(page.locator('.frameRingPreviewTime')).toHaveCSS('opacity', '0')
  await expect(page.locator('.frameRingPreviewResolution')).toHaveCSS('opacity', '0')

  const previewBounds = await page.locator('.frameRingPreview').boundingBox()
  expect(previewBounds).not.toBeNull()
  await page.mouse.move(
    previewBounds!.x + previewBounds!.width / 2,
    previewBounds!.y + previewBounds!.height * 0.84,
  )
  await expect(portalObject).toHaveAttribute('data-controls-visible', 'true')
  await expect(glass).toHaveAttribute('data-controls-visible', 'true')
  await expect(portalObject).toHaveCSS('opacity', '1')
  await expect(page.locator('.frameRingPreviewTime')).toHaveCSS('opacity', '0')

  await page.mouse.move(10, 10)
  await expect(portalObject).toHaveAttribute('data-controls-visible', 'false')
  await expect(portalObject).toHaveCSS('opacity', '0')

  await page.mouse.move(
    previewBounds!.x + previewBounds!.width / 2,
    previewBounds!.y + previewBounds!.height * 0.84,
  )
  await page.getByRole('button', { name: '暂停视频' }).click()
  await expect(portalObject).toHaveAttribute('data-controls-visible', 'true')
  await expect(page.locator('.frameRingPreviewTime')).toHaveCSS('opacity', '1')

  await page.getByRole('button', { name: '全屏播放' }).click()
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('frameRingPreview')))
    .toBe(true)
  const fullscreenRegion = page.locator('.frameRingPreviewFullscreenControlsRegion')
  const fullscreenControls = page.locator('.frameRingPreviewControlsFullscreen')
  const fullscreenGlass = page.locator('.frameRingPreviewControlsFullscreenGlass')
  await expect(fullscreenControls).toHaveCSS('opacity', '0')
  await expect(fullscreenControls).toHaveCSS('pointer-events', 'none')
  await expect(fullscreenGlass).toHaveCSS('opacity', '0')
  await expect(fullscreenGlass).toHaveCSS('backdrop-filter', /blur\(/)
  await expect(page.locator('.frameRingPreviewShade')).toHaveCSS('display', 'none')
  await expect(page.locator('.frameRingPreviewTime')).toHaveCSS('display', 'none')
  await expect(page.locator('.frameRingPreviewResolution')).toHaveCSS('display', 'none')

  await fullscreenRegion.hover({ position: { x: 40, y: 80 } })
  await expect(fullscreenRegion).toHaveAttribute('data-controls-visible', 'true')
  await expect(fullscreenControls).toHaveCSS('opacity', '1')
  await expect(fullscreenControls).toHaveCSS('pointer-events', 'auto')
  await expect(fullscreenGlass).toHaveCSS('opacity', '1')
  await expect(page.getByRole('slider', { name: '视频播放进度' })).toHaveCount(1)
  await expect(page.getByRole('slider', { name: '视频音量' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '退出全屏' })).toHaveCount(1)

  await page.getByRole('slider', { name: '视频播放进度' }).click()
  await page.mouse.move(10, 10)
  await expect(fullscreenRegion).toHaveAttribute('data-controls-visible', 'false')
  await expect(fullscreenControls).toHaveCSS('opacity', '0')
  await expect(fullscreenControls).toHaveCSS('pointer-events', 'none')
  await expect(fullscreenGlass).toHaveCSS('opacity', '0')
})
