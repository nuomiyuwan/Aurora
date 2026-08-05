import { expect, test } from '@playwright/test'

async function openActiveProjectVideoLibrary(page: import('@playwright/test').Page) {
  await page.goto('http://127.0.0.1:5174/')
  await page.getByRole('button', { name: '极境之环 打开项目', exact: true }).click()
  await expect(page.getByRole('region', { name: '极境之环 视频片段库' })).toBeVisible()
}

async function getClipInteraction(
  page: import('@playwright/test').Page,
  cardIndex: number,
) {
  const clipId = await page.locator('.videoClipCard').nth(cardIndex).getAttribute('data-clip-id')
  expect(clipId).toBeTruthy()
  const card = page.locator(`.videoClipCard[data-clip-id="${clipId}"]`)
  const visual = page.locator(
    `.videoClipCard[data-clip-id="${clipId}"] .videoClipVisual`,
  )
  const hitTarget = page.locator(`.videoClipHitTarget[data-clip-id="${clipId}"]`)
  await expect(hitTarget).toBeVisible()
  return { card, clipId: clipId!, visual, hitTarget }
}

function expectRectCloseTo(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width?: number; height?: number },
) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(1)
  if (expected.width !== undefined) {
    expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(1)
  }
  if (expected.height !== undefined) {
    expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(1)
  }
}

test('matches the 1644 by 1002 final DOM baseline without the legacy mixed scale', async ({ page }) => {
  await page.setViewportSize({ width: 1644, height: 1002 })
  await openActiveProjectVideoLibrary(page)
  await page.locator('.videoLibraryView').evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  )

  const grid = await page.locator('.videoClipGrid').boundingBox()
  const header = await page.locator('.videoLibraryHeader').boundingBox()
  const toolbar = await page.locator('.videoLibraryToolbar').boundingBox()
  expect(grid).not.toBeNull()
  expect(header).not.toBeNull()
  expect(toolbar).not.toBeNull()
  expectRectCloseTo(grid!, {
    x: 106,
    y: 248.5156,
    width: 1060.0313,
    height: 554.1094,
  })
  expectRectCloseTo(header!, {
    x: 148.25,
    y: 135.2813,
    width: 397.75,
    height: 119.0156,
  })
  expectRectCloseTo(toolbar!, {
    x: 723.2031,
    y: 154.2656,
    width: 519.6875,
    height: 34.3438,
  })

  const exposedLegacyScales = await page
    .locator('.auroraApp, .videoClipCard, .clipDetailPanel')
    .evaluateAll((elements) =>
      elements.map((element) =>
        getComputedStyle(element).getPropertyValue('--detail-layout-scale').trim(),
      ),
    )
  expect(exposedLegacyScales.every((value) => value === '')).toBe(true)
})

test('renders one bounded window of eight unique real clips', async ({ page }) => {
  await openActiveProjectVideoLibrary(page)

  const cards = page.locator('.videoClipCard')
  await expect(cards).toHaveCount(8)

  const clipIds = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-clip-id')),
  )
  expect(new Set(clipIds).size).toBe(8)
  expect(clipIds.every(Boolean)).toBe(true)
})

test('aligns each real hit target with its final transformed visual', async ({ page }) => {
  await openActiveProjectVideoLibrary(page)

  const { card, clipId, visual, hitTarget } = await getClipInteraction(page, 1)
  await expect.poll(async () => {
    const visualBox = await visual.boundingBox()
    const hitBox = await hitTarget.boundingBox()
    if (!visualBox || !hitBox) return false
    return [
      visualBox.x - hitBox.x,
      visualBox.y - hitBox.y,
      visualBox.width - hitBox.width,
      visualBox.height - hitBox.height,
    ].every((difference) => Math.abs(difference) <= 1)
  }).toBe(true)

  const hitBox = await hitTarget.boundingBox()
  expect(hitBox).not.toBeNull()
  const centerHitId = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('.videoClipHitTarget')
        ?.dataset.clipId,
    {
      x: hitBox!.x + hitBox!.width / 2,
      y: hitBox!.y + hitBox!.height / 2,
    },
  )
  expect(centerHitId).toBe(clipId)

  await hitTarget.hover()
  await expect(card).toHaveClass(/isHitHovered/)
})

test('keeps an eight-card continuous track with damped hard boundaries', async ({ page }) => {
  await openActiveProjectVideoLibrary(page)

  const grid = page.locator('.videoClipGrid')
  const cards = page.locator('.videoClipCard')
  await expect(cards).toHaveCount(8)
  const boundaryInteraction = await getClipInteraction(page, 1)
  const columnTravel = await page.locator('.auroraApp').evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue('--detail-column-travel')),
  )
  expect(columnTravel).toBeGreaterThan(0)
  const initialClipIds = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-clip-id')),
  )
  const initialFilter = await boundaryInteraction.card.evaluate(
    (element) => getComputedStyle(element).filter,
  )
  await page.waitForTimeout(700)
  await grid.evaluate((element) => {
    element.setPointerCapture = () => undefined
    element.releasePointerCapture = () => undefined
    element.hasPointerCapture = () => false
  })

  await boundaryInteraction.hitTarget.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 1,
    clientX: 500,
    clientY: 400,
  })
  await boundaryInteraction.hitTarget.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 1,
    clientX: 680,
    clientY: 400,
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
  await expect(grid).toHaveClass(/isClipDragging/)
  await expect(grid).toHaveAttribute('style', /--clip-overscroll:\s*[1-9][\d.]*px/)
  await expect(boundaryInteraction.card).toHaveCSS('filter', initialFilter)
  const boundaryGlow = await grid.evaluate((element) => ({
    before: getComputedStyle(element, '::before').content,
    after: getComputedStyle(element, '::after').content,
  }))
  expect([boundaryGlow.before, boundaryGlow.after].every((value) => value === 'none' || value === 'normal')).toBe(true)
  await boundaryInteraction.hitTarget.dispatchEvent('pointerup', {
    button: 0,
    pointerId: 1,
    clientX: 680,
    clientY: 400,
  })
  await expect(grid).toHaveClass(/isClipReleasing/)
  await page.waitForTimeout(800)
  await expect(grid).not.toHaveClass(/isClipReleasing/)
  await expect(grid).toHaveAttribute('style', /--clip-overscroll:\s*0px/)

  const trackInteraction = await getClipInteraction(page, 2)
  await trackInteraction.hitTarget.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 2,
    clientX: 680,
    clientY: 400,
  })
  await trackInteraction.hitTarget.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 2,
    clientX: 680 - columnTravel,
    clientY: 400,
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
  await expect(grid).toHaveClass(/isClipDragging/)
  await expect(cards).toHaveCount(8)
  const draggedClipIds = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-clip-id')),
  )
  expect(draggedClipIds).not.toEqual(initialClipIds)
  expect(draggedClipIds.filter((id) => initialClipIds.includes(id)).length).toBe(6)
  await expect(grid).not.toHaveClass(/isClipDeparting|isClipArriving/)
  await trackInteraction.hitTarget.dispatchEvent('pointerup', {
    button: 0,
    pointerId: 2,
    clientX: 680 - columnTravel,
    clientY: 400,
  })
  await expect(grid).not.toHaveClass(/isClipDragging/)
  await page.waitForTimeout(800)
  await expect(grid).not.toHaveClass(/isClipReleasing/)
  await expect(cards).toHaveCount(8)
})

test('moves one logical column per resolved travel while preserving continuous 3D cards', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await openActiveProjectVideoLibrary(page)

  const root = page.locator('.auroraApp')
  const grid = page.locator('.videoClipGrid')
  const cards = page.locator('.videoClipCard')
  const reflection = page.locator('.videoLibraryReflectionCanvas')
  await expect(cards).toHaveCount(8)
  await expect(reflection).toBeVisible()
  await expect.poll(() =>
    reflection.evaluate((element) => {
      const canvas = element as HTMLCanvasElement
      return canvas.width > 0 && canvas.height > 0
    }),
  ).toBe(true)

  const columnTravel = await root.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue('--detail-column-travel')),
  )
  expect(Number.isFinite(columnTravel)).toBe(true)
  expect(columnTravel).toBeGreaterThan(0)

  const { card: trackedCard, hitTarget: trackedHitTarget } = await getClipInteraction(page, 1)
  const initialX = await trackedCard.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue('--clip-x')),
  )

  await grid.evaluate((element) => {
    element.setPointerCapture = () => undefined
    element.releasePointerCapture = () => undefined
    element.hasPointerCapture = () => false
  })
  await trackedHitTarget.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 7,
    clientX: 1000,
    clientY: 500,
  })
  await trackedHitTarget.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 7,
    clientX: 1000 - columnTravel * 0.4,
    clientY: 500,
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
  const fractionalX = await trackedCard.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue('--clip-x')),
  )
  const fractionalRotateY = await trackedCard.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue('--clip-rotate-y')),
  )
  expect(fractionalX).toBeLessThan(initialX - 1)
  expect(fractionalX).toBeGreaterThan(13 + 1)
  expect(Number.isFinite(fractionalRotateY)).toBe(true)
  expect(fractionalRotateY).toBeGreaterThan(10)
  expect(fractionalRotateY).toBeLessThan(12)
  const fractionalTransforms = await page.locator('.videoClipVisual').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).transform),
  )
  expect(fractionalTransforms).toHaveLength(8)
  expect(fractionalTransforms.every((transform) => transform.startsWith('matrix3d('))).toBe(true)

  await trackedHitTarget.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 7,
    clientX: 1000 - columnTravel,
    clientY: 500,
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
  const finalX = await trackedCard.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue('--clip-x')),
  )
  expect(Math.abs(initialX - finalX - 25.1)).toBeLessThanOrEqual(1)
  await expect(cards).toHaveCount(8)
  const transforms = await page.locator('.videoClipVisual').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).transform),
  )
  expect(transforms.every((transform) => transform.startsWith('matrix3d('))).toBe(true)

  await trackedHitTarget.dispatchEvent('pointerup', {
    button: 0,
    pointerId: 7,
    clientX: 1000 - columnTravel,
    clientY: 500,
  })
})

test('keeps reflection on the shared canvas and disables repeated glass work while idle', async ({ page }) => {
  await openActiveProjectVideoLibrary(page)

  await expect(page.locator('.videoClipCard')).toHaveCount(8)
  const reflection = page.locator('.videoLibraryReflectionCanvas')
  await expect(reflection).toBeVisible()
  await expect(reflection).toHaveAttribute('data-reflection-ready', 'true')
  await expect(reflection).toHaveAttribute('data-renderer-count', '1')
  await expect(reflection).toHaveAttribute('data-reflection-targets', '5')
  await expect(reflection).toHaveAttribute('data-context-lost', 'false')
  await expect(reflection).toHaveAttribute('data-render-state', 'idle')
  const initialRenderCount = await reflection.evaluate((element) =>
    Number(element.getAttribute('data-render-count')),
  )
  expect(initialRenderCount).toBeGreaterThan(0)
  await expect(page.locator('.videoClipReflectionSurface')).toHaveCount(0)

  const reflectedGlass = page.locator(
    '.videoClipReflectionSurface .videoClipSurface, .videoClipReflectionSurface .clipInfoGlass, .videoClipReflectionSurface .clipBadge, .videoClipReflectionSurface .clipDuration',
  )
  await expect(reflectedGlass).toHaveCount(0)

  const grid = page.locator('.videoClipGrid')
  const { hitTarget } = await getClipInteraction(page, 1)
  const hitBox = await hitTarget.boundingBox()
  expect(hitBox).not.toBeNull()
  const startX = hitBox!.x + hitBox!.width / 2
  const startY = hitBox!.y + hitBox!.height / 2
  await grid.evaluate((element) => {
    element.setPointerCapture = () => undefined
    element.releasePointerCapture = () => undefined
    element.hasPointerCapture = () => false
  })
  await hitTarget.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 11,
    clientX: startX,
    clientY: startY,
  })
  await hitTarget.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 11,
    clientX: startX - 40,
    clientY: startY,
  })
  await expect(grid).toHaveClass(/isClipDragging/)
  await expect.poll(() =>
    reflection.evaluate((element) =>
      Number(element.getAttribute('data-render-count')),
    ),
  ).toBeGreaterThan(initialRenderCount)
  await expect(reflection).toHaveAttribute('data-reflection-targets', '5')
  await hitTarget.dispatchEvent('pointerup', {
    button: 0,
    pointerId: 11,
    clientX: startX - 40,
    clientY: startY,
  })

  const idleHints = await page.locator('.videoClipCard, .clipInfoGlass').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).willChange),
  )
  expect(idleHints.every((value) => value === 'auto')).toBe(true)
})
