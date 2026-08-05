import { expect, test } from '@playwright/test'

test('loads the generated packed reflection surface and the page-two background', async ({ page }) => {
  await page.goto('/')

  const reflection = page.locator('canvas[data-aurora-renderer="reflection"]')
  await expect(reflection).toHaveAttribute('data-reflection-ready', 'true')

  const loadedAssets = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('/aurora/')),
  )
  expect(
    loadedAssets.some((name) =>
      name.endsWith('/reflection-ice-surface-generated-2048.png'),
    ),
  ).toBe(true)

  await page.getByRole('button', { name: '项目详情', exact: true }).click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-video-library/)
  const backgroundImage = await page.locator('.stageBackground').evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  )
  expect(backgroundImage).toContain('Project-Details-Background.png')

  await page.getByRole('button', { name: '打开帧环浏览' }).click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)
  await expect(
    page.locator('canvas[data-aurora-renderer="frame-ring-reflection"]'),
  ).toHaveAttribute('data-reflection-ready', 'true')
})
