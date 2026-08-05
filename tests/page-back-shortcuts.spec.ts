import { expect, test } from '@playwright/test'

async function openCurrentProject(page: import('@playwright/test').Page) {
  await page
    .getByRole('complementary', { name: '主导航' })
    .getByRole('button', { name: '项目详情' })
    .click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-video-library/)
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
})

test('Esc 和平台标准返回键按页面层级返回', async ({ page }) => {
  await openCurrentProject(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('.auroraApp')).toHaveClass(/view-gallery/)

  await openCurrentProject(page)
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.locator('.auroraApp')).toHaveClass(/view-gallery/)

  await openCurrentProject(page)
  await page.keyboard.down('Meta')
  await page.keyboard.press('BracketLeft')
  await page.keyboard.up('Meta')
  await expect(page.locator('.auroraApp')).toHaveClass(/view-gallery/)

  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.locator('.auroraApp')).toHaveClass(/view-gallery/)
})

test('筛选菜单和输入框优先消费按键，不误退页面', async ({ page }) => {
  await openCurrentProject(page)

  await page.getByRole('button', { name: '标签', exact: true }).click()
  await expect(page.getByRole('menu', { name: '标签选项' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: '标签选项' })).toHaveCount(0)
  await expect(page.locator('.auroraApp')).toHaveClass(/view-video-library/)

  const search = page.getByPlaceholder('搜索视频片段...')
  await search.focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.auroraApp')).toHaveClass(/view-video-library/)
})

test('帧环中的 Alt+左键只返回项目详情，不触发视频快退', async ({ page }) => {
  await openCurrentProject(page)
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入视频素材' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'back-shortcut-preview.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('Aurora page back shortcut fixture'),
  })
  await page.getByRole('button', { name: '打开帧环浏览/预览' }).click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)

  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.locator('.auroraApp')).toHaveClass(/view-video-library/)
})
