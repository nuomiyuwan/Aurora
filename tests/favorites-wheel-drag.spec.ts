import { expect, test } from '@playwright/test'

test.describe('favorites gallery wheel drag', () => {
  test('follows horizontal trackpad movement pixel by pixel before snapping', async ({
    page,
  }) => {
    await page.goto('/#/favorites')
    const selectedBefore = await page
      .locator('.favoritesGalleryCard[data-selected]')
      .getAttribute('data-item-id')
    const centerHit = page.locator(
      '.favoritesGalleryHitPose[data-relative="0.000"] .favoritesGalleryCardHitTarget',
    )
    const box = await centerHit.boundingBox()
    expect(box).not.toBeNull()
    const stageWidth = await page.locator('.favoritesGalleryStage').evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    const dragDistance = Math.min(330, Math.max(190, stageWidth * 0.18))
    const wheelDelta = 54

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.wheel(wheelDelta, 4)
    await expect(page.locator('.favoritesGalleryView')).toHaveClass(
      /isCardDragging/,
    )
    await expect.poll(async () => Number(
      await page
        .locator('.favoritesGalleryCard[data-item-id="' + selectedBefore + '"]')
        .getAttribute('data-relative'),
    )).toBeCloseTo(-wheelDelta / dragDistance, 2)

    await page.waitForTimeout(760)
    await expect(page.locator('.favoritesGalleryView')).not.toHaveClass(
      /isCardDragging/,
    )
    await expect(page.locator('.favoritesGalleryCard[data-selected]')).toHaveAttribute(
      'data-item-id',
      selectedBefore ?? '',
    )
  })

  test('crosses into the next card during one continuous swipe', async ({
    page,
  }) => {
    await page.goto('/#/favorites')
    const selectedBefore = await page
      .locator('.favoritesGalleryCard[data-selected]')
      .getAttribute('data-item-id')
    const centerHit = page.locator(
      '.favoritesGalleryHitPose[data-relative="0.000"] .favoritesGalleryCardHitTarget',
    )
    const box = await centerHit.boundingBox()
    expect(box).not.toBeNull()
    const stageWidth = await page.locator('.favoritesGalleryStage').evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    const dragDistance = Math.min(330, Math.max(190, stageWidth * 0.18))

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.wheel(Math.ceil(dragDistance * 1.08), 2)

    await expect(page.locator('.favoritesGalleryView')).toHaveClass(
      /isCardDragging/,
    )
    await expect(page.locator('.favoritesGalleryCard[data-selected]')).not.toHaveAttribute(
      'data-item-id',
      selectedBefore ?? '',
    )
  })

  test('ignores vertical wheel input so the shared camera/background keeps it', async ({
    page,
  }) => {
    await page.goto('/#/favorites')
    const selectedBefore = await page
      .locator('.favoritesGalleryCard[data-selected]')
      .getAttribute('data-item-id')
    await page.mouse.move(1280, 720)
    await page.mouse.wheel(0, 160)
    await page.waitForTimeout(250)
    await expect(page.locator('.favoritesGalleryCard[data-selected]')).toHaveAttribute(
      'data-item-id',
      selectedBefore ?? '',
    )
  })

  test('locks to the dominant axis like the home carousel', async ({ page }) => {
    await page.goto('/#/favorites')
    const selectedBefore = await page
      .locator('.favoritesGalleryCard[data-selected]')
      .getAttribute('data-item-id')
    const centerHit = page.locator(
      '.favoritesGalleryHitPose[data-relative="0.000"] .favoritesGalleryCardHitTarget',
    )
    const box = await centerHit.boundingBox()
    expect(box).not.toBeNull()

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.wheel(24, 38)
    await page.waitForTimeout(180)
    await expect(page.locator('.favoritesGalleryView')).not.toHaveClass(
      /isCardDragging/,
    )
    await expect(page.locator('.favoritesGalleryCard[data-selected]')).toHaveAttribute(
      'data-item-id',
      selectedBefore ?? '',
    )

    await page.mouse.wheel(38, 24)
    await expect(page.locator('.favoritesGalleryView')).toHaveClass(
      /isCardDragging/,
    )
    await expect(page.locator(
      '.favoritesGalleryCard[data-item-id="' + selectedBefore + '"]',
    )).not.toHaveAttribute('data-relative', '0.000')
  })

  test('keeps two-finger switching active over the favorite star hit area', async ({
    page,
  }) => {
    await page.goto('/#/favorites')
    const selectedBefore = await page
      .locator('.favoritesGalleryCard[data-selected]')
      .getAttribute('data-item-id')
    const favoriteHit = page.locator(
      '.favoritesGalleryHitPose[data-relative="0.000"] .favoritesGalleryFavoriteHitTarget',
    )
    const box = await favoriteHit.boundingBox()
    expect(box).not.toBeNull()

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.wheel(92, 2)
    await page.waitForTimeout(800)
    await expect(page.locator('.favoritesGalleryCard[data-selected]')).not.toHaveAttribute(
      'data-item-id',
      selectedBefore ?? '',
    )
  })
})
