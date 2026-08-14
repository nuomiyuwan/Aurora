import { expect, test } from '@playwright/test'

test.describe('favorites gallery rendering contract', () => {
  test('uses one card reflection canvas and one true-3d pedestal canvas', async ({
    page,
  }) => {
    await page.goto('/#/favorites')

    const view = page.locator('.favoritesGalleryView')
    await expect(view).toHaveAttribute('data-page-active', 'true')
    await expect(page.locator('.favoritesReflectionCanvas')).toHaveCount(1)
    await expect(page.locator('.favoritesReflectionCanvas')).toHaveAttribute(
      'data-reflection-coverage-lock',
      'true',
    )
    await expect(page.locator('.favoritesPedestalReflectionCanvas')).toHaveCount(0)

    const pedestal = page.locator('.favoritesPedestalCanvas')
    await expect(pedestal).toHaveCount(1)
    await expect(pedestal).toHaveAttribute(
      'data-reflection-mode',
      'shared-ice-true-3d',
    )
    await expect(pedestal).toHaveAttribute('data-reflection-renderer-count', '0')
    await expect(pedestal).toHaveAttribute('data-pedestal-ready', 'true')
    await expect(pedestal).toHaveAttribute('data-reflection-ready', 'true')
    await expect(pedestal).toHaveAttribute(
      'data-reflection-opacity-scale',
      '0.7',
    )
    await expect(pedestal).toHaveAttribute(
      'data-card-reflection-occlusion-ready',
      'true',
    )
    await expect(pedestal).toHaveAttribute('data-pedestal-source-count', '5')

    await expect(page.locator('.favoritesGalleryCard')).toHaveCount(5)
    await expect(page.locator('.favoritesGalleryCardHitTarget')).toHaveCount(5)
    await expect(page.locator('.favoritesGalleryCard').first()).toHaveCSS(
      'pointer-events',
      'none',
    )
    await expect(page.locator('.favoritesCardTopline')).toHaveCount(5)
    await expect(page.locator('.favoritesCardCopy strong')).toHaveCount(5)
  })

  test('uses the reference card hierarchy for online favorites', async ({ page }) => {
    await page.goto('/#/favorites')
    await page
      .locator('.favoritesGalleryFilters button')
      .filter({ hasText: '在线收藏' })
      .click()
    const onlineCard = page.locator(
      '.favoritesGalleryCard[data-item-kind="online"]',
    )

    await expect(onlineCard.locator('.favoritesCardTopline > em')).toHaveText(
      '在线收藏',
    )
    await expect(onlineCard.locator('.favoritesCardStatusList i')).toHaveText([
      '在线',
      'B站',
    ])
    await expect(onlineCard.locator('.favoritesCardTagList i')).toHaveText([
      '国创',
      '中国大陆',
      '泡面',
    ])

    const [statusBox, favoriteBox, hitBox] = await Promise.all([
      onlineCard.locator('.favoritesCardStatusList').boundingBox(),
      onlineCard.locator('.favoritesCardFavorite').boundingBox(),
      page
        .locator(
          '.favoritesGalleryHitPose[data-relative="0.000"] .favoritesGalleryFavoriteHitTarget',
        )
        .boundingBox(),
    ])
    expect(statusBox).not.toBeNull()
    expect(favoriteBox).not.toBeNull()
    expect(hitBox).not.toBeNull()
    expect((statusBox?.x ?? 0) + (statusBox?.width ?? 0)).toBeLessThanOrEqual(
      (favoriteBox?.x ?? 0) + 1,
    )
    expect(
      Math.abs(
        (favoriteBox?.x ?? 0) + (favoriteBox?.width ?? 0) / 2 -
          ((hitBox?.x ?? 0) + (hitBox?.width ?? 0) / 2),
      ),
    ).toBeLessThan(3)
  })

  test('names single-frame favorites with the source filename and frame-ring timecode', async ({
    page,
  }) => {
    await page.goto('/#/favorites')
    await page
      .locator('.favoritesGalleryFilters button')
      .filter({ hasText: '单帧画面' })
      .click()

    const frameCard = page.locator(
      '.favoritesGalleryCard[data-item-kind="frame"]',
    )
    await expect(frameCard.locator('.favoritesCardTopline > em')).toHaveText(
      '单帧',
    )
    await expect(frameCard.locator('.favoritesCardRating')).toHaveAttribute(
      'aria-label',
      '5 星',
    )
    await expect(frameCard.locator('.favoritesCardRating svg')).toHaveCount(5)
    await expect(frameCard.locator('.favoritesCardTitleText')).toHaveText(
      'DJI_20250707163418_0026',
    )
    await expect(frameCard.locator('.favoritesCardTitleSuffix')).toHaveText(
      '帧 00:12:08',
    )
    await expect(frameCard.locator('.favoritesCardCopy small')).toHaveText(
      '索引帧 03 / 41 · 4K',
    )
    await expect(frameCard.locator('.favoritesCardCopy small')).not.toContainText(
      '单帧',
    )
    await expect(frameCard.locator('.favoritesCardTagList i')).toHaveText([
      '新导入',
    ])
    expect(
      await frameCard.locator('.favoritesCardTagList i').evaluate((element) =>
        element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true)

    const [labelBox, ratingBox, titleBox, timecodeBox] = await Promise.all([
      frameCard.locator('.favoritesCardTopline > em').boundingBox(),
      frameCard.locator('.favoritesCardRating').boundingBox(),
      frameCard.locator('.favoritesCardTitleText').boundingBox(),
      frameCard.locator('.favoritesCardTitleSuffix').boundingBox(),
    ])
    expect(labelBox).not.toBeNull()
    expect(ratingBox).not.toBeNull()
    expect(titleBox).not.toBeNull()
    expect(timecodeBox).not.toBeNull()
    expect(
      Math.abs(
        (labelBox?.y ?? 0) + (labelBox?.height ?? 0) / 2 -
          ((ratingBox?.y ?? 0) + (ratingBox?.height ?? 0) / 2),
      ),
    ).toBeLessThan(2)
    expect(
      (timecodeBox?.x ?? 0) -
        ((titleBox?.x ?? 0) + (titleBox?.width ?? 0)),
    ).toBeLessThan(8)
    expect(timecodeBox?.height ?? 0).toBeLessThan(titleBox?.height ?? 0)

  })

  test('keeps the pedestal renderer alive but paused off page', async ({ page }) => {
    await page.goto('/#/favorites')
    const pedestal = page.locator('.favoritesPedestalCanvas')
    await expect(pedestal).toHaveAttribute('data-pedestal-ready', 'true')
    const renderCalls = await pedestal.getAttribute('data-pedestal-render-calls')

    await page.getByRole('button', { name: '项目库', exact: true }).click()
    await expect(page.locator('.favoritesGalleryView')).toHaveAttribute(
      'data-page-active',
      'false',
    )
    await page.waitForTimeout(800)
    await expect(pedestal).toHaveAttribute('data-asset-ready', 'true')
    await expect(pedestal).toHaveAttribute(
      'data-pedestal-render-calls',
      renderCalls ?? '',
    )
  })

  test('moves card, hit target and pedestal through the same track', async ({
    page,
  }) => {
    await page.goto('/#/favorites')
    const selectedBefore = await page
      .locator('.favoritesGalleryCard[data-selected]')
      .getAttribute('data-item-id')

    await page.getByRole('button', { name: '下一个收藏' }).click()
    await expect(page.locator('.favoritesGalleryCard[data-selected]')).not.toHaveAttribute(
      'data-item-id',
      selectedBefore ?? '',
    )
    await expect(
      page.locator('.favoritesGalleryHitPose[data-relative="0.000"]'),
    ).toHaveCount(1)
    await expect(page.locator('.favoritesPedestalCanvas')).toHaveAttribute(
      'data-pedestal-source-count',
      '5',
    )
  })

  test('keeps the pedestal edge light in sync with the material UI tint', async ({
    page,
  }) => {
    await page.goto('/#/favorites')

    const pedestal = page.locator('.favoritesPedestalCanvas')
    await expect(pedestal).toHaveAttribute('data-pedestal-ready', 'true')
    await expect(pedestal).toHaveAttribute(
      'data-edge-light-material-tint',
      '#aec5ff',
    )

    await page.getByRole('button', { name: '设置', exact: true }).click()
    const materialTint = page.getByLabel('素材 UI 染色')

    await materialTint.fill('#ff4d9d')
    await expect(pedestal).toHaveAttribute(
      'data-edge-light-material-tint',
      '#ff4d9d',
    )
    await expect(page.getByText('#FF4D9D', { exact: true })).toBeVisible()

    await materialTint.fill('#aec5ff')
    await expect(pedestal).toHaveAttribute(
      'data-edge-light-material-tint',
      '#aec5ff',
    )
  })

  test('opens the selected favorite in its mapped content page', async ({ page }) => {
    await page.goto('/#/favorites')
    const selectedHit = page.locator(
      '.favoritesGalleryHitPose[data-relative="0.000"] .favoritesGalleryCardHitTarget',
    )

    await selectedHit.click()

    await expect(page.locator('.auroraApp')).toHaveClass(/view-video-library/)
  })
})
