import { expect, test } from '@playwright/test'

test('筛选无结果复用项目空态尺寸与常驻毛玻璃', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page
    .getByRole('complementary', { name: '主导航' })
    .getByRole('button', { name: '项目详情' })
    .click()

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入视频素材' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'filter-empty-state.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('Aurora filter empty state fixture'),
  })

  await expect(page.locator('.videoClipCard')).toHaveCount(1)
  await page.getByPlaceholder('搜索视频片段...').fill('不存在的 Aurora 结果')

  const emptyState = page.locator('.videoProjectFilteredEmptyState')
  const emptyGlass = page.locator('.videoLibraryEmptyProjectedGlass')
  await expect(emptyState).toBeVisible()
  await expect(emptyState).toContainText('没有符合条件的视频')
  await expect(emptyGlass).toHaveCSS('opacity', '1')

  const geometry = await Promise.all([
    emptyState.boundingBox(),
    emptyGlass.boundingBox(),
  ])
  expect(geometry[0]).not.toBeNull()
  expect(geometry[1]).not.toBeNull()
  expect(geometry[0]!.width).toBeCloseTo(geometry[1]!.width, 1)
  expect(geometry[0]!.height).toBeCloseTo(geometry[1]!.height, 1)

  await page.getByRole('button', { name: '重置搜索与筛选' }).click()
  await expect(emptyState).toHaveCount(0)
  await expect(page.locator('.videoClipCard')).toHaveCount(1)
  await expect(emptyGlass).toHaveCSS('opacity', '0.001')
})
