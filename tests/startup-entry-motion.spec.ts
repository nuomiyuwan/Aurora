import { expect, test } from '@playwright/test'

test('waits for the decoded startup backdrop before publishing its first frame', async ({
  page,
}) => {
  test.setTimeout(60_000)
  let releaseBackground!: () => void
  const backgroundReleased = new Promise<void>((resolve) => {
    releaseBackground = resolve
  })
  await page.route('**/startup-ice-valley-v1.png', async (route) => {
    await backgroundReleased
    await route.continue()
  })

  await page.goto('/?startup=1', { waitUntil: 'domcontentloaded' })
  const gate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  await expect(gate).toHaveAttribute('data-background-state', 'loading')
  await expect(gate).toHaveAttribute('data-first-frame-ready', 'false')
  await expect(gate.locator('.startupGateBackdropPoster')).toHaveCSS('opacity', '0')

  releaseBackground()
  await expect(gate).toHaveAttribute('data-background-state', 'ready')
  await expect(gate.locator('.startupGateBackdropPoster')).toHaveCSS('opacity', '1')
  await expect(gate).toHaveAttribute('data-first-frame-ready', 'true')
  await expect(gate).toHaveAttribute('data-phase', 'loading')
})

test('publishes a stable fallback frame when the startup backdrop fails', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.route('**/startup-ice-valley-v1.png', (route) => route.abort())
  await page.goto('/?startup=1', { waitUntil: 'domcontentloaded' })

  const gate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  await expect(gate).toHaveAttribute('data-background-state', 'fallback')
  await expect(gate).toHaveAttribute('data-first-frame-ready', 'true')
  await expect(gate).toHaveAttribute('data-degraded', 'true')
  await expect(gate.locator('.startupGateBackdropPoster')).toHaveCSS('opacity', '0')
  await expect(gate.locator('.startupGateVisual')).toHaveCSS(
    'background-color',
    'rgb(3, 6, 10)',
  )
})

test('waits for the decoded animated-logo poster before publishing the first frame', async ({
  page,
}) => {
  test.setTimeout(60_000)
  let releasePoster!: () => void
  const posterReleased = new Promise<void>((resolve) => {
    releasePoster = resolve
  })
  await page.route('**/startup-logo-mark-loop-poster.png', async (route) => {
    await posterReleased
    await route.continue()
  })

  await page.goto('/?startup=1', { waitUntil: 'domcontentloaded' })
  const gate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  await expect(gate).toHaveAttribute('data-background-state', 'ready')
  await expect(gate).toHaveAttribute('data-logo-poster-state', 'loading')
  await expect(gate).toHaveAttribute('data-first-frame-ready', 'false')

  releasePoster()
  await expect(gate).toHaveAttribute('data-logo-poster-state', 'ready')
  await expect(gate).toHaveAttribute('data-first-frame-ready', 'true')
})

test('positions the startup prompt and reuses the deeper page transition', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1440, height: 930 })
  await page.goto('/?startup=1')

  const gate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  const prompt = gate.getByRole('button', {
    name: '点击画面进入',
  })
  await expect(prompt).toBeVisible()
  await expect(gate).toHaveAttribute(
    'data-entry-motion',
    'page-transition-deeper',
  )
  await expect(gate.locator('.startupDepthTrail')).toHaveCount(0)
  await expect(gate.locator('.startupGateGlow')).toHaveCount(0)
  await expect(gate.locator('.startupLogoVideo')).toHaveCount(2)
  await expect(gate.locator('.startupLogoVideo').first()).toHaveAttribute(
    'src',
    /startup-logo-mark-loop\.webm/,
  )
  await expect(gate.locator('.startupLogoVideo').first()).toHaveAttribute(
    'loop',
    '',
  )
  await expect(gate.locator('.startupLogoPoster').first()).toHaveAttribute(
    'src',
    /startup-logo-mark-loop-poster\.png/,
  )
  await expect(prompt).toHaveCSS('background-image', 'none')
  expect(
    await gate.locator('.startupGateVisual').evaluate((element) =>
      getComputedStyle(element).backgroundImage,
    ),
  ).not.toContain('gradient')
  await prompt.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  )

  const promptBox = await prompt.boundingBox()
  expect(promptBox).not.toBeNull()
  const promptCenterRatio =
    (promptBox!.y + promptBox!.height / 2) / 930
  expect(Math.abs(promptCenterRatio - 0.753)).toBeLessThan(0.004)

  await gate.click({ position: { x: 24, y: 24 } })
  await expect(gate).toHaveAttribute('data-phase', 'leaving')
  await expect(gate).toHaveCSS('pointer-events', 'auto')
  await expect(gate.locator('.startupGateVisual')).toHaveCSS(
    'animation-name',
    'auroraPageExitDepthReverse',
  )
  await expect(gate.locator('.startupGateVisual')).toHaveCSS(
    'animation-duration',
    '0.22s',
  )
  const app = page.locator('.auroraApp')
  await expect(app).not.toHaveClass(/isPageExiting/)
  await expect(gate).toHaveCount(0)
  await expect(app).toHaveClass(/isPageEntering/)
  await page.waitForTimeout(500)
  await expect(app).not.toHaveClass(/isPageEntering/)
})

test('skips the depth motion when reduced motion is requested', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?startup=1')

  const gate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  await expect(
    gate.getByRole('button', { name: '点击画面进入' }),
  ).toBeVisible()
  await gate.click({ position: { x: 24, y: 24 } })
  await expect(gate).toHaveCount(0)
  await expect(page.locator('.auroraApp')).not.toHaveClass(/isPageEntering/)
})

test('keeps the warmed video glass live from the first incoming frame', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1706, height: 956 })
  await page.goto('/?startup=1')

  const gate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  await expect(
    gate.getByRole('button', { name: '点击画面进入' }),
  ).toBeVisible()

  const glassLayer = page.locator(
    '.videoLibraryProjectedGlassLayer',
  )
  const syncCount = await glassLayer.getAttribute(
    'data-geometry-sync-count',
  )
  await gate.click({ position: { x: 24, y: 24 } })
  await expect(gate).toHaveCount(0)
  await expect(page.locator('.auroraApp')).not.toHaveClass(
    /isPageEntering/,
  )

  await page
    .locator('.projectHitTarget[data-card-active="true"]')
    .click()
  const app = page.locator('.auroraApp')
  await expect(app).toHaveClass(/view-video-library/)
  await expect(app).toHaveClass(/isPageEntering/)
  await expect(page.locator('.videoClipHitLayer')).toHaveAttribute(
    'inert',
    '',
  )
  await expect(glassLayer).toHaveAttribute(
    'data-glass-cache-valid',
    'true',
  )
  await expect(glassLayer).toHaveAttribute(
    'data-geometry-cache-valid',
    'true',
  )
  expect(
    await glassLayer.getAttribute('data-geometry-sync-count'),
  ).toBe(syncCount)

  const glassLeaf = glassLayer.locator(
    '.videoClipProjectedGlass',
  ).first()
  await expect(glassLeaf).toHaveCSS('opacity', '1')
  await expect(glassLeaf).toHaveCSS(
    'backdrop-filter',
    /blur\(8px\)/,
  )
  expect(
    await glassLeaf.evaluate((element) =>
      element
        .getAnimations()
        .map((animation) => animation.animationName),
    ),
  ).not.toContain('auroraProjectedGlassFadeIn')
})
