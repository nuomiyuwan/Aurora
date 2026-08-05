import { expect, test, type Locator, type Page } from '@playwright/test'

async function expectNavigationGlass(locator: Locator) {
  await expect(locator).toHaveClass(/uiGlassShell/)
  await expect(locator).toHaveCSS('backdrop-filter', 'blur(16px) saturate(1.08)')
  await expect(locator).toHaveCSS('box-shadow', 'none')
}

async function expectTransparentNavigationControl(locator: Locator) {
  await expect(locator).toHaveClass(/uiGlassInteractive/)
  await expect(locator).toHaveCSS('backdrop-filter', 'none')
  await expect(locator).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(locator).toHaveCSS('box-shadow', 'none')
}

async function openVideoLibrary(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '极境之环 打开项目', exact: true }).click()
  await expect(page.getByRole('region', { name: '极境之环 视频片段库' })).toBeVisible()
}

test('opens a single-surface new project panel from the renamed home action', async ({ page }) => {
  await page.goto('/')

  const action = page.getByRole('button', { name: '新建项目', exact: true })
  await expectNavigationGlass(action)
  await action.click()

  const dialog = page.getByRole('dialog', { name: '新建项目' })
  const panel = dialog.locator('.createPanel')
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('dialog', { name: '导入素材' })).toHaveCount(0)
  await expectNavigationGlass(panel)
  await expectTransparentNavigationControl(dialog.locator('.panelClose'))

  for (const selector of [
    '.createProjectChoice',
    '.secondaryAction',
    '.primaryAction',
  ]) {
    await expect(dialog.locator(selector)).toHaveCSS('backdrop-filter', 'none')
  }
  const projectInputs = dialog.locator('.createProjectInput')
  await expect(projectInputs).toHaveCount(2)
  expect(
    await projectInputs.evaluateAll((elements) =>
      elements.every(
        (element) => getComputedStyle(element).backdropFilter === 'none',
      ),
    ),
  ).toBe(true)

  const nestedBackdropOwners = await panel.locator('*').evaluateAll((elements) =>
    elements.filter((element) => getComputedStyle(element).backdropFilter !== 'none').length,
  )
  expect(nestedBackdropOwners).toBe(0)
  await expect(dialog.getByRole('button', { name: '创建项目', exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('reuses the navigation shell and transparent icon-control structure across pages', async ({ page }) => {
  await page.goto('/')

  for (const selector of ['.sideDock', '.statusBar', '.createProjectButton']) {
    await expectNavigationGlass(page.locator(selector))
  }
  await expectTransparentNavigationControl(page.locator('.sideDock button').first())

  await openVideoLibrary(page)
  for (const selector of [
    '.videoLibrarySearch',
    '.videoLibraryFilterControl:first-child > .videoLibraryFilterButton',
  ]) {
    await expectNavigationGlass(page.locator(selector))
  }

  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '打开帧环浏览' }).click()
  await expect(page.getByRole('region', { name: 'A001_C012.mov 帧环浏览' })).toBeVisible()
  for (const selector of [
    '.frameRingSearch',
    '.frameRingBottomActions',
  ]) {
    await expectNavigationGlass(page.locator(selector))
  }
  expect(
    await page.locator('.frameRingBottomActions button').evaluateAll((elements) =>
      elements.every((element) => {
        const style = getComputedStyle(element)
        return (
          style.backdropFilter === 'none' &&
          style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
          style.boxShadow === 'none'
        )
      }),
    ),
  ).toBe(true)

  await expect(page.locator('.uiGlassInteractive.active svg').last()).toHaveCSS('filter', /drop-shadow/)
  await expect(page.locator('.glass2dFrame')).toHaveCount(0)

  for (const rig of [
    '.projectCameraRig',
    '.videoClipCameraRig',
    '.videoLibraryDetailCameraRig',
    '.frameRingCameraRig',
    '.frameRingFloatingCameraRig',
  ]) {
    await expect(page.locator(`${rig} .uiGlassShell, ${rig} .uiGlassInset`)).toHaveCount(0)
  }
})
