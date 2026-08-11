import { expect, test } from '@playwright/test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { toggleWindowFullscreen } = require('../electron/windowControls.cjs') as {
  toggleWindowFullscreen(windowInstance: {
    isDestroyed(): boolean
    isFullScreen(): boolean
    setFullScreenable(fullscreenable: boolean): void
    setFullScreen(fullscreen: boolean): void
  }): boolean
}

type WindowControlTestState = {
  actions: string[]
  maximized: boolean
  fullscreen: boolean
  setMaximized(maximized: boolean): void
  setFullscreen(fullscreen: boolean): void
}

declare global {
  interface Window {
    __auroraWindowControlTestState?: WindowControlTestState
  }
}

test('Windows 使用三色窗口按钮并保留顶部拖动区域', async ({ page }) => {
  await page.addInitScript(() => {
    const maximizedListeners = new Set<(maximized: boolean) => void>()
    const fullscreenListeners = new Set<(fullscreen: boolean) => void>()
    const state: WindowControlTestState = {
      actions: [],
      maximized: false,
      fullscreen: false,
      setMaximized(maximized) {
        state.maximized = maximized
        maximizedListeners.forEach((listener) => listener(maximized))
      },
      setFullscreen(fullscreen) {
        state.fullscreen = fullscreen
        fullscreenListeners.forEach((listener) => listener(fullscreen))
      },
    }
    window.__auroraWindowControlTestState = state

    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        platform: 'win32',
        notifyStartupVisualReady() {},
        loadAppData: async () => null,
        saveAppData: async () => true,
        getMediaUrl: () => null,
        minimizeWindow() {
          state.actions.push('minimize')
        },
        async toggleMaximizeWindow() {
          state.maximized = !state.maximized
          state.actions.push(state.maximized ? 'maximize' : 'restore')
          maximizedListeners.forEach((listener) =>
            listener(state.maximized),
          )
          return state.maximized
        },
        async toggleFullscreenWindow() {
          state.fullscreen = !state.fullscreen
          state.actions.push(
            state.fullscreen ? 'enter-fullscreen' : 'leave-fullscreen',
          )
          fullscreenListeners.forEach((listener) =>
            listener(state.fullscreen),
          )
          return state.fullscreen
        },
        async getWindowMaximizedState() {
          return state.maximized
        },
        onWindowMaximizedStateChange(
          listener: (maximized: boolean) => void,
        ) {
          maximizedListeners.add(listener)
          return () => maximizedListeners.delete(listener)
        },
        async getWindowFullscreenState() {
          return state.fullscreen
        },
        onWindowFullscreenStateChange(
          listener: (fullscreen: boolean) => void,
        ) {
          fullscreenListeners.add(listener)
          return () => fullscreenListeners.delete(listener)
        },
        closeWindow() {
          state.actions.push('close')
        },
      },
    })
  })

  await page.goto('/')

  const controls = page.locator('.windowsWindowControls')
  const close = page.getByRole('button', { name: '关闭窗口' })
  const minimize = page.getByRole('button', { name: '最小化窗口' })
  const enterFullscreen = page.getByRole('button', { name: '进入全屏' })
  await expect(controls).toBeVisible()
  await expect(page.getByRole('group', { name: '窗口控制' })).toBeVisible()
  await expect(close).toBeVisible()
  await expect(minimize).toBeVisible()
  await expect(enterFullscreen).toBeVisible()

  await expect
    .poll(() =>
      page.locator('.windowsWindowDragStrip').evaluate((element) =>
        getComputedStyle(element).getPropertyValue('-webkit-app-region'),
      ),
    )
    .toBe('drag')
  await expect
    .poll(() =>
      controls.evaluate((element) =>
        getComputedStyle(element).getPropertyValue('-webkit-app-region'),
      ),
    )
    .toBe('no-drag')

  await minimize.click()
  await enterFullscreen.click()
  await expect(controls).toHaveAttribute('data-concealed', 'true')
  await page.mouse.move(400, 400)
  await expect(controls).toHaveCSS('opacity', '0')

  await page.locator('.windowsWindowControlsRegion').hover({ position: { x: 20, y: 20 } })
  await expect(controls).toHaveCSS('opacity', '1')
  await page.getByRole('button', { name: '退出全屏' }).click()
  await page.mouse.move(400, 400)
  await expect(controls).not.toHaveAttribute('data-concealed', 'true')
  await expect(controls).toHaveCSS('opacity', '1')
  await expect(
    page.getByRole('button', { name: '进入全屏' }),
  ).toBeVisible()

  await page.evaluate(() => {
    window.__auroraWindowControlTestState?.setMaximized(true)
  })
  await expect(controls).toHaveAttribute('data-concealed', 'true')
  await page.locator('.windowsWindowControlsRegion').hover({ position: { x: 20, y: 20 } })
  await expect(controls).toHaveCSS('opacity', '1')
  await page.getByRole('button', { name: '还原窗口' }).click()
  await expect(controls).not.toHaveAttribute('data-concealed', 'true')

  await page.evaluate(() => {
    window.__auroraWindowControlTestState?.setFullscreen(true)
  })
  await expect(controls).toHaveAttribute('data-concealed', 'true')
  await page.mouse.move(400, 400)
  await expect(controls).toHaveCSS('opacity', '0')
  await page.keyboard.press('Escape')
  await expect(controls).not.toHaveAttribute('data-concealed', 'true')
  await close.click()

  await expect
    .poll(() =>
      page.evaluate(
        () => window.__auroraWindowControlTestState?.actions ?? [],
      ),
    )
    .toEqual([
      'minimize',
      'enter-fullscreen',
      'leave-fullscreen',
      'restore',
      'leave-fullscreen',
      'close',
    ])
})

test('Windows 原生全屏切换使用 BrowserWindow.setFullScreen 覆盖任务栏', () => {
  let fullscreen = false
  const fullscreenableValues: boolean[] = []
  const fullscreenValues: boolean[] = []
  const windowInstance = {
    isDestroyed: () => false,
    isFullScreen: () => fullscreen,
    setFullScreenable(value: boolean) {
      fullscreenableValues.push(value)
    },
    setFullScreen(value: boolean) {
      fullscreen = value
      fullscreenValues.push(value)
    },
  }

  expect(toggleWindowFullscreen(windowInstance)).toBe(true)
  expect(toggleWindowFullscreen(windowInstance)).toBe(false)
  expect(fullscreenableValues).toEqual([true, true])
  expect(fullscreenValues).toEqual([true, false])
})
