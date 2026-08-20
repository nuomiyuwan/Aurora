import { expect, test } from '@playwright/test'

async function openCurrentProject(page: import('@playwright/test').Page) {
  await page
    .getByRole('complementary', { name: '主导航' })
    .getByRole('button', { name: '项目详情' })
    .click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-video-library/)
}

test('settings checks and cleans only reclaimable Aurora cache', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => {
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        inspectAppCache: async () => ({
          totalBytes: 5 * 1024 * 1024,
          reclaimableBytes: 2 * 1024 * 1024,
          totalDirectories: 5,
          reclaimableDirectories: 2,
          semanticEntries: 12,
          reclaimableSemanticEntries: 3,
        }),
        cleanAppCache: async () => ({
          totalBytes: 3 * 1024 * 1024,
          reclaimableBytes: 0,
          totalDirectories: 3,
          reclaimableDirectories: 0,
          semanticEntries: 9,
          reclaimableSemanticEntries: 0,
          removedBytes: 2 * 1024 * 1024,
          removedDirectories: 2,
          removedSemanticEntries: 3,
        }),
      },
    })
  })

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '检查缓存', exact: true }).click()
  await expect(page.getByText('可释放 2.00 MB', { exact: true })).toBeVisible()
  await page
    .getByRole('button', { name: '清理可释放缓存', exact: true })
    .click()
  await expect(page.getByText('已清理 2.00 MB', { exact: true })).toBeVisible()
  await expect(
    page.getByText('另清理 3 条 AI 视觉索引', { exact: true }),
  ).toBeVisible()
})

test('Delete and Backspace open deletion confirmation and Enter confirms', async ({
  page,
}) => {
  await page.goto('/')
  await openCurrentProject(page)
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入视频素材' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'delete-shortcut-preview.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('Aurora delete shortcut fixture'),
  })
  await expect(
    page.getByText('delete-shortcut-preview.mp4', { exact: true }).first(),
  ).toBeVisible()

  await page.keyboard.press('Delete')
  const dialog = page.getByRole('alertdialog', { name: /从 Aurora 删除/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()

  await page.keyboard.press('Backspace')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText(/已从 Aurora 删除/)).toBeVisible()
})
