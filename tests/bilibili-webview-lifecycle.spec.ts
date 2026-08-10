import { expect, test } from '@playwright/test'
import {
  installBilibiliWebviewLifecycle,
  type BilibiliWebviewElement,
} from '../src/features/frame-ring/bilibiliWebviewLifecycle'

class FakeBilibiliWebview extends EventTarget {
  readonly dataset: Record<string, string> = {}
  readonly style = { display: '', width: '', height: '' }
  isConnected = true
  focusCalls = 0
  layoutReads = 0
  executedScripts: string[] = []

  async executeJavaScript(code: string) {
    this.executedScripts.push(code)
    return true
  }

  focus() {
    this.focusCalls += 1
  }

  getBoundingClientRect() {
    this.layoutReads += 1
    return {} as DOMRect
  }
}

class FakeVisibilityDocument extends EventTarget {
  hidden = false
}

function createFrameScheduler() {
  let nextHandle = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  return {
    requestFrame(callback: FrameRequestCallback) {
      const handle = nextHandle
      nextHandle += 1
      callbacks.set(handle, callback)
      return handle
    },
    cancelFrame(handle: number) {
      callbacks.delete(handle)
    },
    runNextFrame() {
      const next = callbacks.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined
      if (!next) return false
      callbacks.delete(next[0])
      next[1](performance.now())
      return true
    },
    get pendingCount() {
      return callbacks.size
    },
  }
}

function createTimerScheduler() {
  let nextHandle = 1
  const callbacks = new Map<number, { callback: () => void; delayMs: number }>()
  return {
    setTimer(callback: () => void, delayMs: number) {
      const handle = nextHandle
      nextHandle += 1
      callbacks.set(handle, { callback, delayMs })
      return handle
    },
    clearTimer(handle: number) {
      callbacks.delete(handle)
    },
    runNextTimer() {
      const next = callbacks.entries().next().value as
        | [number, { callback: () => void; delayMs: number }]
        | undefined
      if (!next) return false
      callbacks.delete(next[0])
      next[1].callback()
      return true
    },
    get nextDelay() {
      return callbacks.values().next().value?.delayMs as number | undefined
    },
    get pendingCount() {
      return callbacks.size
    },
  }
}

async function flushAsyncCapture() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('keeps the same embedded player mounted when its reflection source appears', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-online-search/)

  await page.evaluate(() => {
    let resolveCapture: ((dataUrl: string) => void) | null = null
    let captureCalls = 0
    const mediaId = 'BV1xx411c7mD'
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        searchBilibiliVideos: async ({ query }: { query: string }) => ({
          query,
          results: [
            {
              source: 'bilibili' as const,
              kind: 'video' as const,
              mediaId,
              bvid: mediaId,
              episodeId: null,
              url: `https://www.bilibili.com/video/${mediaId}/`,
              canonicalUrl: `https://www.bilibili.com/video/${mediaId}/`,
              title: '倒影生命周期测试',
              description: '',
              coverUrl: null,
              thumbnailPath: null,
              author: 'Aurora',
              duration: '01:00',
              publishedAt: '',
              tags: [],
            },
          ],
        }),
        captureBilibiliEmbeddedFrame: () => {
          captureCalls += 1
          return new Promise<string>((resolve) => {
            resolveCapture = resolve
          })
        },
      },
    })
    Object.defineProperty(window, '__auroraBilibiliReflectionTest', {
      configurable: true,
      value: {
        finishCapture(dataUrl: string) {
          resolveCapture?.(dataUrl)
        },
        captureCalls: () => captureCalls,
      },
    })
  })

  const input = page.getByLabel('搜索视频片段或关键帧')
  await input.fill('倒影生命周期测试')
  await page.getByRole('button', { name: '开始搜索' }).click()
  await page
    .getByLabel('在线视频操作')
    .getByRole('button', { name: '在线播放' })
    .click()

  const webview = page.locator('.frameRingPreviewOnlineWebview')
  await expect(webview).toHaveCount(1)
  await webview.evaluate((element) => {
    Object.defineProperty(window, '__auroraInitialBilibiliWebview', {
      configurable: true,
      value: element,
    })
  })
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __auroraBilibiliReflectionTest: {
              captureCalls: () => number
            }
          }
        ).__auroraBilibiliReflectionTest.captureCalls(),
      ),
    )
    .toBe(1)
  await expect(
    page.locator(
      '.frameRingPreviewOnlineReflectionSource[data-online-reflection-source="poster"]',
    ),
  ).toHaveCount(1)
  const reflectionCanvas = page.locator('.frameRingReflectionCanvas')
  await expect(reflectionCanvas).toHaveCount(1)
  await expect(reflectionCanvas).toHaveAttribute(
    'data-reflection-content-ready',
    'true',
  )
  await page.evaluate(() => {
    (
      window as typeof window & {
        __auroraBilibiliReflectionTest: {
          finishCapture: (dataUrl: string) => void
        }
      }
    ).__auroraBilibiliReflectionTest.finishCapture(
      'data:image/png;base64,bm90LWFuLWltYWdl',
    )
  })
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __auroraBilibiliReflectionTest: {
              captureCalls: () => number
            }
          }
        ).__auroraBilibiliReflectionTest.captureCalls(),
      ),
    )
    .toBe(2)
  await expect(
    page.locator(
      '.frameRingPreviewOnlineReflectionSource[data-online-reflection-source="poster"]',
    ),
  ).toHaveCount(1)
  await expect(reflectionCanvas).toHaveCount(1)

  await page.evaluate(() => {
    (
      window as typeof window & {
        __auroraBilibiliReflectionTest: {
          finishCapture: (dataUrl: string) => void
        }
      }
    ).__auroraBilibiliReflectionTest.finishCapture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    )
  })

  await expect(
    page.locator(
      '.frameRingPreviewOnlineReflectionSource[data-online-reflection-source="capture"]',
    ),
  ).toHaveCount(1)
  await expect(reflectionCanvas).toHaveCount(1)
  await expect(reflectionCanvas).toHaveAttribute(
    'data-reflection-content-ready',
    'true',
  )
  await expect
    .poll(async () =>
      Number(await reflectionCanvas.getAttribute('data-texture-count')),
    )
    .toBeGreaterThan(0)
  await expect
    .poll(() =>
      webview.evaluate((element) =>
        element ===
        (
          window as typeof window & {
            __auroraInitialBilibiliWebview: Element
          }
        ).__auroraInitialBilibiliWebview,
      ),
    )
    .toBe(true)
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __auroraBilibiliReflectionTest: {
              captureCalls: () => number
            }
          }
        ).__auroraBilibiliReflectionTest.captureCalls(),
      ),
    )
    .toBe(2)

  const onlineActions = page.getByRole('toolbar', {
    name: '在线视频操作栏',
  })
  await expect(onlineActions).toBeVisible()
  await expect(onlineActions.getByRole('button')).toHaveCount(2)
  await onlineActions
    .getByRole('button', { name: '收藏到 Aurora' })
    .click()
  await expect(
    onlineActions.getByRole('button', { name: '取消 Aurora 收藏' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await onlineActions
    .getByRole('button', { name: '将在线视频加入项目' })
    .click()
  await expect(
    page.getByRole('dialog', {
      name: '将 倒影生命周期测试 添加到项目',
    }),
  ).toBeVisible()
})

test('restores the same Bilibili webview after guest fullscreen exits', async () => {
  const webview = new FakeBilibiliWebview()
  const scheduler = createFrameScheduler()
  let readyWebview: BilibiliWebviewElement | null = null
  const lifecycle = installBilibiliWebviewLifecycle(
    webview as unknown as BilibiliWebviewElement,
    {
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      onReady: (currentWebview) => {
        readyWebview = currentWebview
      },
    },
  )

  webview.dispatchEvent(new Event('dom-ready'))
  await Promise.resolve()
  expect(readyWebview).toBe(webview)

  webview.dispatchEvent(new Event('enter-html-full-screen'))
  expect(webview.dataset.htmlFullscreen).toBe('true')

  webview.dispatchEvent(new Event('leave-html-full-screen'))
  expect(webview.dataset.htmlFullscreen).toBeUndefined()
  expect(webview.dataset.geometryRecovering).toBe('true')
  expect(webview.style.width).toBe('')
  expect(scheduler.pendingCount).toBe(1)

  expect(scheduler.runNextFrame()).toBe(true)
  expect(webview.style.display).toBe('none')
  expect(webview.style.width).toBe('')
  expect(webview.style.height).toBe('')
  expect(webview.layoutReads).toBe(1)
  expect(webview.executedScripts).toHaveLength(0)
  expect(webview.focusCalls).toBe(0)

  expect(scheduler.runNextFrame()).toBe(true)
  expect(webview.style.display).toBe('flex')
  expect(webview.style.width).toBe('calc(100% - 1px)')
  expect(webview.style.height).toBe('calc(100% - 1px)')
  expect(webview.layoutReads).toBe(2)
  expect(webview.executedScripts).toHaveLength(0)
  expect(webview.focusCalls).toBe(0)

  expect(scheduler.runNextFrame()).toBe(true)
  expect(webview.style.display).toBe('')
  expect(webview.style.width).toBe('')
  expect(webview.style.height).toBe('')
  expect(webview.dataset.geometryRecovering).toBeUndefined()
  expect(webview.layoutReads).toBe(3)
  expect(webview.executedScripts).toHaveLength(1)
  expect(webview.executedScripts[0]).toContain("new Event('resize')")
  expect(webview.focusCalls).toBe(1)
  expect(scheduler.pendingCount).toBe(0)

  lifecycle.dispose()
})

test('cancels an in-flight fullscreen recovery when the webview unmounts', () => {
  const webview = new FakeBilibiliWebview()
  webview.style.display = 'grid'
  webview.style.width = '73%'
  webview.style.height = '61%'
  const scheduler = createFrameScheduler()
  let readyCalls = 0
  const lifecycle = installBilibiliWebviewLifecycle(
    webview as unknown as BilibiliWebviewElement,
    {
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      onReady: () => {
        readyCalls += 1
      },
    },
  )

  webview.dispatchEvent(new Event('leave-html-full-screen'))
  expect(scheduler.runNextFrame()).toBe(true)
  expect(webview.style.display).toBe('none')
  expect(scheduler.pendingCount).toBe(1)

  lifecycle.dispose()
  expect(webview.style.display).toBe('grid')
  expect(webview.style.width).toBe('73%')
  expect(webview.style.height).toBe('61%')
  expect(webview.dataset.geometryRecovering).toBeUndefined()
  expect(scheduler.pendingCount).toBe(0)

  webview.dispatchEvent(new Event('dom-ready'))
  webview.dispatchEvent(new Event('leave-html-full-screen'))
  expect(readyCalls).toBe(0)
  expect(scheduler.pendingCount).toBe(0)
  expect(webview.focusCalls).toBe(0)
  expect(webview.executedScripts).toHaveLength(0)
})

test('captures one usable reflection frame and keeps it across fullscreen', async () => {
  const webview = new FakeBilibiliWebview()
  const frames = createFrameScheduler()
  const timers = createTimerScheduler()
  const visibilityDocument = new FakeVisibilityDocument()
  const reflectionFrames: Array<string | null> = []
  let captureCalls = 0
  const captureReflectionFrame = async () => {
    captureCalls += 1
    return 'data:image/png;base64,reflection-frame'
  }
  const lifecycle = installBilibiliWebviewLifecycle(
    webview as unknown as BilibiliWebviewElement,
    {
      active: true,
      reflectionActive: true,
      onReflectionFrame: (frame) => reflectionFrames.push(frame),
      captureReflectionFrame,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      visibilityDocument,
    },
  )

  webview.dispatchEvent(new Event('dom-ready'))
  expect(timers.pendingCount).toBe(1)
  expect(timers.nextDelay).toBe(800)
  expect(timers.runNextTimer()).toBe(true)
  lifecycle.updateReflectionCapture({
    active: true,
    reflectionActive: true,
    onReflectionFrame: (frame) => reflectionFrames.push(frame),
    captureReflectionFrame,
  })
  expect(captureCalls).toBe(1)
  expect(timers.pendingCount).toBe(0)

  await flushAsyncCapture()
  expect(reflectionFrames.at(-1)).toBe(
    'data:image/png;base64,reflection-frame',
  )
  expect(timers.pendingCount).toBe(0)

  const publishedFrameCount = reflectionFrames.length
  webview.dispatchEvent(new Event('enter-html-full-screen'))
  expect(reflectionFrames).toHaveLength(publishedFrameCount)
  expect(reflectionFrames.at(-1)).toBe(
    'data:image/png;base64,reflection-frame',
  )
  expect(timers.pendingCount).toBe(0)

  webview.dispatchEvent(new Event('leave-html-full-screen'))
  expect(frames.runNextFrame()).toBe(true)
  expect(frames.runNextFrame()).toBe(true)
  expect(timers.pendingCount).toBe(0)
  expect(captureCalls).toBe(1)

  visibilityDocument.hidden = true
  visibilityDocument.dispatchEvent(new Event('visibilitychange'))
  visibilityDocument.hidden = false
  visibilityDocument.dispatchEvent(new Event('visibilitychange'))
  expect(timers.pendingCount).toBe(0)
  expect(reflectionFrames).toHaveLength(publishedFrameCount)
  expect(captureCalls).toBe(1)

  webview.dispatchEvent(new Event('did-start-loading'))
  webview.dispatchEvent(new Event('dom-ready'))
  expect(reflectionFrames).toHaveLength(publishedFrameCount)
  expect(reflectionFrames.at(-1)).toBe(
    'data:image/png;base64,reflection-frame',
  )
  expect(timers.pendingCount).toBe(0)
  expect(captureCalls).toBe(1)

  lifecycle.updateReflectionCapture({
    active: false,
    reflectionActive: true,
    onReflectionFrame: (frame) => reflectionFrames.push(frame),
    captureReflectionFrame,
  })
  lifecycle.updateReflectionCapture({
    active: true,
    reflectionActive: true,
    onReflectionFrame: (frame) => reflectionFrames.push(frame),
    captureReflectionFrame,
  })
  expect(reflectionFrames).toHaveLength(publishedFrameCount)
  expect(timers.pendingCount).toBe(0)
  expect(captureCalls).toBe(1)

  lifecycle.dispose()
  expect(timers.pendingCount).toBe(0)
  expect(reflectionFrames.at(-1)).toBe(
    'data:image/png;base64,reflection-frame',
  )
})

test('discards an in-flight capture while hidden and resumes when visible', async () => {
  const webview = new FakeBilibiliWebview()
  const frames = createFrameScheduler()
  const timers = createTimerScheduler()
  const visibilityDocument = new FakeVisibilityDocument()
  const reflectionFrames: Array<string | null> = []
  let captureCalls = 0
  let resolveCapture: ((dataUrl: string | null) => void) | null = null
  let captureImplementation = () => new Promise<string | null>((resolve) => {
    resolveCapture = resolve
  })
  const captureReflectionFrame = () => {
    captureCalls += 1
    return captureImplementation()
  }

  const lifecycle = installBilibiliWebviewLifecycle(
    webview as unknown as BilibiliWebviewElement,
    {
      active: true,
      reflectionActive: true,
      onReflectionFrame: (frame) => reflectionFrames.push(frame),
      captureReflectionFrame,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      visibilityDocument,
    },
  )

  webview.dispatchEvent(new Event('dom-ready'))
  expect(timers.nextDelay).toBe(800)
  expect(timers.runNextTimer()).toBe(true)
  expect(captureCalls).toBe(1)

  const framesBeforeHide = reflectionFrames.length
  visibilityDocument.hidden = true
  visibilityDocument.dispatchEvent(new Event('visibilitychange'))
  expect(reflectionFrames).toHaveLength(framesBeforeHide)
  expect(timers.pendingCount).toBe(0)

  resolveCapture?.('data:image/png;base64,stale')
  await flushAsyncCapture()
  expect(reflectionFrames).not.toContain(
    'data:image/png;base64,reflection-frame',
  )
  expect(timers.pendingCount).toBe(0)

  captureImplementation = async () => 'data:image/png;base64,current'
  visibilityDocument.hidden = false
  visibilityDocument.dispatchEvent(new Event('visibilitychange'))
  expect(timers.nextDelay).toBe(800)
  expect(timers.runNextTimer()).toBe(true)
  await flushAsyncCapture()
  expect(captureCalls).toBe(2)
  expect(reflectionFrames.at(-1)).toBe(
    'data:image/png;base64,current',
  )
  expect(timers.pendingCount).toBe(0)

  lifecycle.updateReflectionCapture({
    active: false,
    reflectionActive: true,
    onReflectionFrame: (frame) => reflectionFrames.push(frame),
    captureReflectionFrame,
  })
  expect(reflectionFrames.at(-1)).toBe(
    'data:image/png;base64,current',
  )
  expect(timers.pendingCount).toBe(0)

  lifecycle.dispose()
})

test('optimistically captures a cached guest even when dom-ready was missed', async () => {
  const webview = new FakeBilibiliWebview()
  const frames = createFrameScheduler()
  const timers = createTimerScheduler()
  const visibilityDocument = new FakeVisibilityDocument()
  const reflectionFrames: Array<string | null> = []
  let captureCalls = 0
  const captureReflectionFrame = async () => {
    captureCalls += 1
    return 'data:image/png;base64,cached-guest'
  }
  const lifecycle = installBilibiliWebviewLifecycle(
    webview as unknown as BilibiliWebviewElement,
    {
      active: false,
      reflectionActive: false,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      visibilityDocument,
    },
  )

  lifecycle.updateReflectionCapture({
    active: true,
    reflectionActive: true,
    onReflectionFrame: (frame) => reflectionFrames.push(frame),
    captureReflectionFrame,
  })
  expect(timers.nextDelay).toBe(800)
  expect(timers.runNextTimer()).toBe(true)
  await flushAsyncCapture()

  expect(captureCalls).toBe(1)
  expect(reflectionFrames).toEqual([
    'data:image/png;base64,cached-guest',
  ])
  expect(timers.pendingCount).toBe(0)

  lifecycle.dispose()
})

test('retries an empty first capture until one usable frame is published', async () => {
  const webview = new FakeBilibiliWebview()
  const frames = createFrameScheduler()
  const timers = createTimerScheduler()
  const visibilityDocument = new FakeVisibilityDocument()
  const reflectionFrames: Array<string | null> = []
  let captureCalls = 0
  let captureImplementation = async (): Promise<string | null> => null
  const captureReflectionFrame = () => {
    captureCalls += 1
    return captureImplementation()
  }
  const lifecycle = installBilibiliWebviewLifecycle(
    webview as unknown as BilibiliWebviewElement,
    {
      active: true,
      reflectionActive: true,
      onReflectionFrame: (frame) => reflectionFrames.push(frame),
      captureReflectionFrame,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      visibilityDocument,
    },
  )

  webview.dispatchEvent(new Event('dom-ready'))
  expect(timers.nextDelay).toBe(800)
  expect(timers.runNextTimer()).toBe(true)
  await flushAsyncCapture()
  expect(captureCalls).toBe(1)
  expect(reflectionFrames).toEqual([])
  expect(timers.nextDelay).toBe(800)

  captureImplementation = async () => 'data:image/png;base64,usable'
  expect(timers.runNextTimer()).toBe(true)
  await flushAsyncCapture()
  expect(captureCalls).toBe(2)
  expect(reflectionFrames.at(-1)).toBe(
    'data:image/png;base64,usable',
  )
  expect(timers.pendingCount).toBe(0)

  lifecycle.dispose()
})

test('resumes reflection capture when loading settles without another dom-ready', async () => {
  const webview = new FakeBilibiliWebview()
  const frames = createFrameScheduler()
  const timers = createTimerScheduler()
  const visibilityDocument = new FakeVisibilityDocument()
  const reflectionFrames: Array<string | null> = []
  let captureCalls = 0
  const captureReflectionFrame = async () => {
    captureCalls += 1
    return 'data:image/png;base64,settled-frame'
  }
  const lifecycle = installBilibiliWebviewLifecycle(
    webview as unknown as BilibiliWebviewElement,
    {
      active: true,
      reflectionActive: true,
      onReflectionFrame: (frame) => reflectionFrames.push(frame),
      captureReflectionFrame,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      visibilityDocument,
    },
  )

  webview.dispatchEvent(new Event('dom-ready'))
  expect(timers.pendingCount).toBe(1)
  webview.dispatchEvent(new Event('did-start-loading'))
  expect(timers.pendingCount).toBe(0)

  webview.dispatchEvent(new Event('did-stop-loading'))
  expect(timers.nextDelay).toBe(800)
  expect(timers.runNextTimer()).toBe(true)
  await flushAsyncCapture()
  expect(captureCalls).toBe(1)
  expect(reflectionFrames).toEqual([
    'data:image/png;base64,settled-frame',
  ])

  lifecycle.dispose()
})
