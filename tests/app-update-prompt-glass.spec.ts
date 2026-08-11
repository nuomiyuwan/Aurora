import { expect, test, type Page } from '@playwright/test'

const AVAILABLE_UPDATE: AppUpdateState = {
  currentVersion: '1.0.2',
  supported: true,
  status: 'available',
  latestVersion: '1.0.3',
  releaseName: 'Aurora 1.0.3',
  releaseNotes: ['修复更新窗口的可读性。'],
  releaseDate: '2026-08-10T00:00:00.000Z',
  progress: null,
  checkedAt: '2026-08-10T00:00:00.000Z',
  source: 'automatic',
  error: null,
}

async function installUpdateBridge(page: Page) {
  await page.addInitScript((updateState) => {
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        platform: 'darwin',
        loadAppData: async () => null,
        saveAppData: async () => true,
        saveAppDataSync: () => true,
        getMediaUrl: () => null,
        notifyStartupVisualReady() {},
        getAppUpdateState: async () => updateState,
        checkForAppUpdate: async () => updateState,
        downloadAndInstallAppUpdate: async () => updateState,
        onAppUpdateStateChange: () => () => undefined,
      },
    })
  }, AVAILABLE_UPDATE)
}

async function enterAurora(page: Page) {
  await page.goto('/')
  const gate = page.getByRole('dialog', { name: 'Aurora 启动载入' })
  await expect(
    gate.getByRole('button', { name: '点击画面进入' }),
  ).toBeVisible({ timeout: 45_000 })
  await gate.click({ position: { x: 24, y: 24 } })
}

test('更新弹窗复用新建项目的单层可读毛玻璃', async ({ page }) => {
  test.setTimeout(60_000)
  await installUpdateBridge(page)
  await enterAurora(page)

  const dialog = page.getByRole('dialog', { name: /Aurora 有新版本/ })
  const overlay = page.locator('.appUpdateOverlay')
  await expect(dialog).toBeVisible()
  // Exercise the real entry motion, then verify it releases its compositor
  // state instead of leaving a transform/opacity backdrop root behind.
  await page.waitForTimeout(450)
  await expect(dialog).toHaveClass(/uiGlassShell/)
  await expect(dialog).toHaveCSS(
    'backdrop-filter',
    'blur(16px) saturate(1.08)',
  )
  await expect(dialog).toHaveCSS('transform', 'none')
  await expect(overlay).toHaveCSS('opacity', '1')
  await expect(overlay).toHaveCSS('animation-fill-mode', 'none')

  const structure = await dialog.evaluate((element) => ({
    insideAuroraRoot: Boolean(element.closest('.auroraApp')),
    nestedBackdropOwners: Array.from(element.querySelectorAll('*')).filter(
      (child) => {
        const style = getComputedStyle(child)
        const filter =
          style.getPropertyValue('backdrop-filter') ||
          style.getPropertyValue('-webkit-backdrop-filter')
        return Boolean(filter && filter !== 'none')
      },
    ).length,
  }))
  expect(structure.insideAuroraRoot).toBe(true)
  expect(structure.nestedBackdropOwners).toBe(0)

  const backdrop = await overlay.evaluate((element) => {
    const style = getComputedStyle(element, '::before')
    return {
      content: style.content,
      filter:
        style.getPropertyValue('backdrop-filter') ||
        style.getPropertyValue('-webkit-backdrop-filter'),
      backgroundColor: style.backgroundColor,
    }
  })
  expect(backdrop.content).not.toBe('none')
  expect(backdrop.filter).toContain('blur(2px)')
  expect(backdrop.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
})
