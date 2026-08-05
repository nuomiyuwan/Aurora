import { expect, test } from '@playwright/test'

async function openVideoLibrary(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page
    .getByRole('button', { name: '极境之环 打开项目', exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: '极境之环 视频片段库' }),
  ).toBeVisible()
}

test('搜索备注并让详情面板跟随首个真实结果', async ({ page }) => {
  await openVideoLibrary(page)

  await page.getByPlaceholder('搜索视频片段...').fill('情绪段落')

  await expect(page.locator('.videoLibraryCount')).toHaveText(
    '显示 16 / 共 128 个视频片段',
  )
  await expect(page.getByLabel('A001_C010.mov 详情')).toBeVisible()
})

test('标签、日期排序和一键重置连接到同一结果轨道', async ({ page }) => {
  await openVideoLibrary(page)

  await page.getByRole('button', { name: '标签', exact: true }).click()
  const layerOrder = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.videoLibraryToolbar')
    const grid = document.querySelector<HTMLElement>('.videoClipGrid')
    if (!toolbar || !grid) return null
    return {
      toolbar: Number.parseFloat(getComputedStyle(toolbar).zIndex),
      grid: Number.parseFloat(getComputedStyle(grid).zIndex),
      isolation: getComputedStyle(toolbar).isolation,
    }
  })
  expect(layerOrder).not.toBeNull()
  expect(layerOrder?.toolbar).toBeGreaterThan(layerOrder?.grid ?? Infinity)
  expect(layerOrder?.isolation).toBe('isolate')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: '标签选项' })).toHaveCount(0)

  await page.getByRole('button', { name: '标签', exact: true }).click()
  await page
    .getByRole('menu', { name: '标签选项' })
    .getByRole('menuitemradio', { name: '人物', exact: true })
    .click()
  await expect(page.locator('.videoLibraryCount')).toHaveText(
    '显示 32 / 共 128 个视频片段',
  )

  await page.getByRole('button', { name: '拍摄日期', exact: true }).click()
  await page
    .getByRole('menu', { name: '拍摄日期选项' })
    .getByRole('menuitemradio', { name: '最新优先', exact: true })
    .click()
  await expect(page.locator('.videoClipCard').first()).toHaveAttribute(
    'data-clip-id',
    'ring-A001_C012.mov',
  )

  await page.getByRole('button', { name: '重置全部筛选' }).click()
  await expect(page.locator('.videoLibraryCount')).toHaveText(
    '共 128 个视频片段',
  )
  await expect(
    page.getByRole('button', { name: '当前没有启用筛选' }),
  ).toBeDisabled()
})
