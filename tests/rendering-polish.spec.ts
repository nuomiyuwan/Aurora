import { expect, test } from '@playwright/test'

test('keeps only five idle gallery cards and screen-composites the home Light', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.locator('.projectCard')).toHaveCount(5)
  await expect(page.locator('.cardLight').first()).toHaveCSS('mix-blend-mode', 'screen')
  await expect(
    page.locator(
      '.projectCard[data-project-id="ring"] .cardCopy small',
    ).first(),
  ).toHaveText('0 个视频 · 0 个在线视频 · 0 个素材')
  await expect(page.locator('.statusBar')).toContainText('0 个本地资产')
  await expect(page.locator('.statusBar')).toContainText('0 个在线视频')

  await page.locator('.projectStage').evaluate((element) => {
    element.setPointerCapture = () => undefined
    element.releasePointerCapture = () => undefined
    element.hasPointerCapture = () => false
  })
  const activeHitTarget = page.locator('.projectHitTarget[data-card-active="true"]')
  const box = await activeHitTarget.boundingBox()
  expect(box).not.toBeNull()
  await activeHitTarget.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 21,
    clientX: box!.x + box!.width / 2,
    clientY: box!.y + box!.height / 2,
  })
  await activeHitTarget.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 21,
    clientX: box!.x + box!.width / 2 - 80,
    clientY: box!.y + box!.height / 2,
  })
  await expect(page.locator('.projectCard')).toHaveCount(7)
  await activeHitTarget.dispatchEvent('pointerup', {
    button: 0,
    pointerId: 21,
    clientX: box!.x + box!.width / 2 - 80,
    clientY: box!.y + box!.height / 2,
  })
  await expect(page.locator('.projectCard')).toHaveCount(5)
})

test('uses the tightened gallery downward pitch target and keeps its background covered at every camera extreme', async ({
  page,
}) => {
  await page.goto('/')
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
    expect(rect!.x).toBeLessThanOrEqual(0)
    expect(rect!.y).toBeLessThanOrEqual(0)
    expect(rect!.x + rect!.width).toBeGreaterThanOrEqual(2560)
    expect(rect!.y + rect!.height).toBeGreaterThanOrEqual(1440)
  }

  await app.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 31,
    clientX: 400,
    clientY: 400,
  })
  await app.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 31,
    clientX: 2400,
    clientY: -1600,
  })
  await expect(app).toHaveCSS('--camera-yaw', '10.5deg')
  await expect(app).toHaveCSS('--camera-pitch', '10deg')
  await assertCoverage()
  await app.dispatchEvent('pointerup', { button: 0, pointerId: 31 })

  await app.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 32,
    clientX: 2200,
    clientY: 1200,
  })
  await app.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 32,
    clientX: 0,
    clientY: 4000,
  })
  await expect(app).toHaveCSS('--camera-yaw', '-10.5deg')
  await expect(app).toHaveCSS('--camera-pitch', '-11deg')
  await assertCoverage()
  await app.dispatchEvent('pointerup', { button: 0, pointerId: 32 })
})

test('shares the corrected pitch range on project pages and resets the camera before paint', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const app = page.locator('.auroraApp')
  await app.evaluate((element) => {
    element.setPointerCapture = () => undefined
    element.releasePointerCapture = () => undefined
    element.hasPointerCapture = () => false
  })

  await app.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 41,
    clientX: 400,
    clientY: 400,
  })
  await app.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 41,
    clientX: 400,
    clientY: -1600,
  })
  await expect(app).toHaveCSS('--camera-pitch', '10deg')
  await app.dispatchEvent('pointerup', { button: 0, pointerId: 41 })

  await page.locator('.projectHitTarget[data-card-active="true"]').click()
  await expect(app).toHaveClass(/view-video-library/)
  await expect(app).toHaveCSS('--camera-pitch', '6deg')

  await app.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 42,
    clientX: 400,
    clientY: 400,
  })
  await app.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 42,
    clientX: 400,
    clientY: -1600,
  })
  await expect(app).toHaveCSS('--camera-pitch', '10deg')
  await app.dispatchEvent('pointerup', { button: 0, pointerId: 42 })
})

test('uses the live scene as the video-card glass source', async ({ page }, testInfo) => {
  const openVideoLibrary = async () => {
    await page.goto('/')
    await page.locator('.projectHitTarget[data-card-active="true"]').click()
    await expect(page.locator('.videoClipCard')).toHaveCount(8)
    await expect(page.locator('.videoClipProjectedGlass')).toHaveCount(8)
    await expect(page.locator('.videoClipProjectedGlass').first()).toBeVisible()
    await expect(page.locator('.videoDetailProjectedGlass')).toBeVisible()
  }

  await openVideoLibrary()

  const styles = await page.locator('.videoClipCard').first().evaluate((card) => {
    const surface = getComputedStyle(card.querySelector('.videoClipSurface')!)
    const glass = getComputedStyle(card.querySelector('.clipInfoGlass')!)
    const light = getComputedStyle(card.querySelector('.videoClipLight')!)
    return {
      surfaceBackdrop:
        surface.getPropertyValue('backdrop-filter') ||
        surface.getPropertyValue('-webkit-backdrop-filter'),
      glassBackground: glass.backgroundImage,
      glassFilter: glass.filter,
      lightBlend: light.mixBlendMode,
    }
  })
  const projectedGlass = page.locator('.videoClipProjectedGlass')
  const projectedDetailGlass = page.locator('.videoDetailProjectedGlass')
  const projectedStyles = await projectedGlass.first().evaluate((glass) => {
    const style = getComputedStyle(glass)
    return {
      backdrop:
        style.getPropertyValue('backdrop-filter') ||
        style.getPropertyValue('-webkit-backdrop-filter'),
      clipPath: style.clipPath,
      transform: style.transform,
      layerClass: glass.parentElement?.className,
      rootClass: glass.parentElement?.parentElement?.className,
    }
  })

  expect(styles.surfaceBackdrop).toBe('none')
  expect(styles.glassBackground).not.toContain('url(')
  expect(styles.glassBackground).not.toContain('background-stage')
  expect(styles.glassFilter).toBe('none')
  expect(styles.lightBlend).toBe('screen')
  expect(projectedStyles.backdrop).toContain('blur(')
  expect(projectedStyles.clipPath).toContain('path(')
  expect(projectedStyles.clipPath).toContain('C')
  expect(projectedStyles.transform).toBe('none')
  expect(projectedStyles.layerClass).toBe('videoLibraryProjectedGlassLayer')
  expect(projectedStyles.rootClass).toContain('auroraApp')
  await expect(projectedDetailGlass).toHaveCSS('backdrop-filter', /blur\(/)
  await expect(projectedDetailGlass).toHaveCSS('transform', 'none')
  await expect(projectedDetailGlass).toHaveCSS('mask-image', 'none')
  expect((await projectedDetailGlass.boundingBox())!.width).toBeGreaterThan(100)
  const detailPanelBackdrop = await page.locator('.clipDetailPanel').evaluate((panel) => {
    const style = getComputedStyle(panel, '::before')
    return (
      style.getPropertyValue('backdrop-filter') ||
      style.getPropertyValue('-webkit-backdrop-filter')
    )
  })
  expect(detailPanelBackdrop).toBe('none')

  const fourthColumn = projectedGlass.nth(3)
  await expect(fourthColumn).toBeVisible()
  expect((await fourthColumn.boundingBox())!.width).toBeGreaterThan(20)

  const layer = page.locator('.videoLibraryProjectedGlassLayer')
  await layer.evaluate((element) =>
    (element as HTMLElement).style.setProperty('--clip-backdrop-blur', '4px'),
  )
  await expect(projectedGlass.first()).toHaveCSS('backdrop-filter', /blur\(4px\)/)
  await expect(projectedDetailGlass).toHaveCSS('backdrop-filter', /blur\(4px\)/)
  await page.screenshot({
    path: testInfo.outputPath('video-library-projected-glass-4px.png'),
    fullPage: true,
  })
  await layer.evaluate((element) =>
    (element as HTMLElement).style.setProperty('--clip-backdrop-blur', '32px'),
  )
  await expect(projectedGlass.first()).toHaveCSS('backdrop-filter', /blur\(32px\)/)
  await expect(projectedDetailGlass).toHaveCSS('backdrop-filter', /blur\(32px\)/)
  await page.screenshot({
    path: testInfo.outputPath('video-library-projected-glass-32px.png'),
    fullPage: true,
  })

  await page.reload()
  await page.locator('.projectHitTarget[data-card-active="true"]').click()
  await expect(page.locator('.videoClipProjectedGlass').first()).toBeVisible()
  await expect(page.locator('.videoDetailProjectedGlass')).toBeVisible()
  await expect(page.locator('.videoClipProjectedGlass').first()).toHaveCSS(
    'backdrop-filter',
    /blur\(/,
  )
  await page.screenshot({
    path: testInfo.outputPath('video-library-projected-glass.png'),
    fullPage: true,
  })
})

test('scales every direct-layout video-library control with the design plane', async ({
  page,
}) => {
  const referenceViewport = { width: 1706, height: 956 }
  const smallViewport = { width: 1280, height: 720 }
  const selectors = [
    '.videoLibraryBreadcrumb svg',
    '.videoLibraryToolbar .iconFilterButton',
    '.clipStatus svg',
    '.detailTagCloud button svg',
    '.detailNoteHeader svg',
    '.openFrameRingButton svg',
  ]
  const measure = () =>
    page.evaluate((targetSelectors) =>
      targetSelectors.map((selector) => {
        const element = document.querySelector(selector)
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return { selector, width: rect.width, height: rect.height }
      }), selectors)

  await page.setViewportSize(referenceViewport)
  await page.goto('/')
  await page.locator('.projectHitTarget[data-card-active="true"]').click()
  await expect(page.locator('.videoClipCard')).toHaveCount(8)
  const reference = await measure()

  await page.setViewportSize(smallViewport)
  await page.waitForTimeout(100)
  const small = await measure()
  const expectedScale = Math.min(
    smallViewport.width / referenceViewport.width,
    smallViewport.height / referenceViewport.height,
  )

  for (let index = 0; index < selectors.length; index += 1) {
    expect(reference[index], selectors[index]).not.toBeNull()
    expect(small[index], selectors[index]).not.toBeNull()
    expect(
      Math.abs(small[index]!.width / reference[index]!.width - expectedScale),
      selectors[index],
    ).toBeLessThan(0.02)
    expect(
      Math.abs(small[index]!.height / reference[index]!.height - expectedScale),
      selectors[index],
    ).toBeLessThan(0.02)
  }

  await expect(page.locator('.videoLibrarySearch')).toHaveCSS('backdrop-filter', /blur\(/)
  await expect(page.locator('.videoLibraryToolbar button').first()).toHaveCSS(
    'backdrop-filter',
    /blur\(/,
  )
})

test('uses the shared live backdrop blur directly on the navigation shell', async ({ page }) => {
  await page.goto('/')

  const dock = page.locator('.sideDock')
  await expect(dock).toHaveCSS('backdrop-filter', 'blur(16px) saturate(1.08)')
  await expect(dock).toHaveCSS('box-shadow', 'none')
  await expect(dock.locator('svg').first()).toHaveCSS('filter', /drop-shadow/)
  await expect(page.locator('.sideDockGlassWarp')).toHaveCount(0)
  await expect(page.locator('#sideDockLiquidLens')).toHaveCount(0)

  const generatedDecorations = await dock.evaluate((element) => ({
    before: getComputedStyle(element, '::before').content,
    after: getComputedStyle(element, '::after').content,
  }))
  expect(generatedDecorations).toEqual({ before: 'none', after: 'none' })
})
