import { expect, test } from '@playwright/test'

test('空视频项目进入详情页，并让空态毛玻璃在 App 根常驻', async ({
  page,
}) => {
  const projectName = '空视频项目详情回归'
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const emptyGlass = page.locator('.videoLibraryEmptyProjectedGlass')
  await expect(emptyGlass).toHaveCount(1)

  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: '新建项目' })
  await createDialog.locator('input[name="projectName"]').fill(projectName)
  await createDialog
    .getByRole('button', { name: '创建项目', exact: true })
    .click()

  await expect(emptyGlass).toHaveCSS('opacity', '0.001')
  await page
    .getByRole('button', { name: `${projectName} 尚未导入素材`, exact: true })
    .click()

  await expect(
    page.getByRole('region', { name: `${projectName} 视频片段库` }),
  ).toBeVisible()
  await expect(page.locator('.videoProjectEmptyState')).toBeVisible()
  await expect(page.locator('.videoProjectEmptyState')).toContainText(
    '导入视频后',
  )
  await expect(
    page.getByRole('button', { name: '导入视频素材' }),
  ).toBeVisible()
  await expect(emptyGlass).toHaveCSS('opacity', '1')

  await page
    .locator('.videoLibraryBreadcrumb')
    .getByRole('button', { name: '项目库' })
    .click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-gallery/)
  await expect(emptyGlass).toHaveCount(1)
  await expect(emptyGlass).toHaveCSS('opacity', '0.001')
})
