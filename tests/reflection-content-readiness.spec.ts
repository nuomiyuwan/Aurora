import { expect, test, type Locator } from '@playwright/test'

type ReflectionRevisionState = {
  active: string | null
  contentReady: string | null
  prepareCount: number
  prepareState: string | null
  prepared: string | null
  rendered: string | null
  source: string | null
}

async function readRevisionState(
  canvas: Locator,
): Promise<ReflectionRevisionState> {
  return canvas.evaluate((element) => ({
    active: element.getAttribute('data-reflection-active'),
    contentReady: element.getAttribute('data-reflection-content-ready'),
    prepareCount: Number(
      element.getAttribute('data-reflection-prepare-count') ?? 0,
    ),
    prepareState: element.getAttribute('data-reflection-prepare-state'),
    prepared: element.getAttribute('data-reflection-prepared-revision'),
    rendered: element.getAttribute('data-reflection-rendered-revision'),
    source: element.getAttribute('data-reflection-source-revision'),
  }))
}

async function waitForCurrentRevisionToRender(canvas: Locator) {
  await expect
    .poll(async () => {
      const state = await readRevisionState(canvas)
      return Boolean(
        state.source &&
          state.source === state.prepared &&
          state.source === state.rendered &&
          state.contentReady === 'true',
      )
    })
    .toBe(true)
}

test('waits for every declared gallery reflection source before completing warmup', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    const state = {
      mode: 'zero',
      sourceCount: 0,
    }
    const setAttribute = (
      canvas: HTMLCanvasElement,
      name: string,
      value: string,
    ) => {
      if (canvas.getAttribute(name) !== value) {
        canvas.setAttribute(name, value)
      }
    }
    const enforce = () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '.galleryReflectionCanvas',
      )
      if (!canvas) return
      const reportedSourceCount = Number(
        canvas.getAttribute('data-source-count'),
      )
      if (
        Number.isInteger(reportedSourceCount) &&
        reportedSourceCount > 0
      ) {
        state.sourceCount = reportedSourceCount
      }
      if (state.sourceCount <= 1 || state.mode === 'complete') return
      if (state.mode === 'zero') {
        setAttribute(canvas, 'data-source-count', '0')
        setAttribute(canvas, 'data-visible-source-count', '0')
        return
      }
      setAttribute(
        canvas,
        'data-source-count',
        String(state.sourceCount),
      )
      setAttribute(
        canvas,
        'data-visible-source-count',
        String(state.sourceCount - 1),
      )
    }
    const observer = new MutationObserver(enforce)
    observer.observe(document, {
      attributes: true,
      attributeFilter: [
        'data-source-count',
        'data-visible-source-count',
      ],
      childList: true,
      subtree: true,
    })
    window.setInterval(enforce, 8)
    Object.defineProperty(window, '__auroraGalleryWarmupControl', {
      configurable: true,
      value: {
        setMode(mode: 'zero' | 'partial' | 'complete') {
          state.mode = mode
          const canvas = document.querySelector<HTMLCanvasElement>(
            '.galleryReflectionCanvas',
          )
          if (mode === 'complete' && canvas && state.sourceCount > 0) {
            setAttribute(
              canvas,
              'data-source-count',
              String(state.sourceCount),
            )
            setAttribute(
              canvas,
              'data-visible-source-count',
              String(state.sourceCount),
            )
          } else {
            enforce()
          }
        },
        snapshot() {
          return { ...state }
        },
      },
    })
  })
  await page.goto('/?startup=1')

  const startupGate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  const progress = startupGate.getByRole('progressbar')
  await expect(progress).toHaveAttribute(
    'aria-valuetext',
    /正在预热主页倒影/,
  )
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __auroraGalleryWarmupControl: {
                snapshot: () => {
                  mode: string
                  sourceCount: number
                }
              }
            }
          ).__auroraGalleryWarmupControl.snapshot().sourceCount,
      ),
    )
    .toBeGreaterThan(1)

  const enterButton = startupGate.getByRole('button', {
    name: '点击画面进入',
  })
  await page.waitForTimeout(220)
  await expect(enterButton).toHaveCount(0)
  await expect(startupGate).toHaveAttribute('data-phase', 'loading')

  await page.evaluate(() => {
    (
      window as typeof window & {
        __auroraGalleryWarmupControl: {
          setMode: (mode: 'zero' | 'partial' | 'complete') => void
        }
      }
    ).__auroraGalleryWarmupControl.setMode('partial')
  })
  await page.waitForTimeout(220)
  await expect(enterButton).toHaveCount(0)
  await expect(progress).toHaveAttribute(
    'aria-valuetext',
    /正在预热主页倒影/,
  )

  await page.evaluate(() => {
    (
      window as typeof window & {
        __auroraGalleryWarmupControl: {
          setMode: (mode: 'zero' | 'partial' | 'complete') => void
        }
      }
    ).__auroraGalleryWarmupControl.setMode('complete')
  })
  await expect(enterButton).toBeVisible()
  await expect(startupGate).toHaveAttribute('data-degraded', 'false')
})

test('prepares exact page-two and page-three reflection content before activation', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/?startup=1')

  const startupGate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  await expect(
    startupGate.getByRole('button', { name: '点击画面进入' }),
  ).toBeVisible()
  await expect(startupGate.locator('.startupReflectionCanvas')).toHaveAttribute(
    'data-reflection-ready',
    'true',
  )
  await expect(
    startupGate.locator('[data-startup-reflection-source]'),
  ).toHaveCount(3)
  await expect(
    startupGate.locator('button[data-startup-reflection-source]'),
  ).toHaveCount(0)

  const libraryReflection = page.locator('.videoLibraryReflectionCanvas')
  await expect(libraryReflection).toHaveAttribute(
    'data-reflection-active',
    'false',
  )
  await waitForCurrentRevisionToRender(libraryReflection)
  const libraryWarmState = await readRevisionState(libraryReflection)
  expect(libraryWarmState.prepareCount).toBeGreaterThan(0)

  await startupGate.click({ position: { x: 24, y: 24 } })
  await expect(startupGate).toHaveCount(0)
  await page
    .getByRole('button', { name: '极境之环 打开项目', exact: true })
    .click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-video-library/)
  const activatedLibraryState = await readRevisionState(libraryReflection)
  expect(activatedLibraryState.source).toBe(libraryWarmState.source)
  expect(activatedLibraryState.prepared).toBe(libraryWarmState.source)
  expect(activatedLibraryState.rendered).toBe(libraryWarmState.source)
  expect(activatedLibraryState.contentReady).toBe('true')
  expect(activatedLibraryState.prepareCount).toBe(libraryWarmState.prepareCount)

  const openFrameRing = page.getByRole('button', {
    name: '打开帧环浏览',
  })
  await expect(openFrameRing).toBeEnabled()
  await openFrameRing.click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)

  const frameReflection = page.locator('.frameRingReflectionCanvas')
  await waitForCurrentRevisionToRender(frameReflection)
  const firstFrameState = await readRevisionState(frameReflection)

  const frameRingView = page.getByRole('region', {
    name: 'A001_C012.mov 帧环浏览',
  })
  await frameRingView.getByRole('button', { name: '极境之环' }).click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-video-library/)

  await page
    .getByRole('button', { name: '查看 A001_C011.mov', exact: true })
    .click()
  await expect
    .poll(async () => {
      const state = await readRevisionState(frameReflection)
      return Boolean(
          state.active === 'false' &&
          state.source &&
          state.source !== firstFrameState.source &&
          state.source === state.prepared &&
          state.source === state.rendered &&
          state.contentReady === 'true' &&
          state.prepareState === 'ready' &&
          state.prepareCount === firstFrameState.prepareCount + 1,
      )
    })
    .toBe(true)

  const hiddenPreparedState = await readRevisionState(frameReflection)
  await expect(openFrameRing).toBeEnabled()
  await openFrameRing.click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)

  const activatedState = await readRevisionState(frameReflection)
  expect(activatedState.source).toBe(hiddenPreparedState.source)
  expect(activatedState.prepared).toBe(hiddenPreparedState.source)
  expect(activatedState.rendered).toBe(hiddenPreparedState.source)
  expect(activatedState.contentReady).toBe('true')
  expect(activatedState.prepareCount).toBe(hiddenPreparedState.prepareCount)
})

test('keeps unchanged pages mounted and reuses warmed geometry across navigation', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?startup=1')

  const startupGate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  await expect(
    startupGate.getByRole('button', { name: '点击画面进入' }),
  ).toBeVisible()

  const galleryReflection = page.locator('.galleryReflectionCanvas')
  const videoReflection = page.locator('.videoLibraryReflectionCanvas')
  for (const canvas of [galleryReflection, videoReflection]) {
    await expect(canvas).toHaveAttribute(
      'data-reflection-preload-state',
      'ready',
    )
    const preloadState = await canvas.evaluate((element) => ({
      ready: Number(
        element.getAttribute('data-reflection-preload-ready-count') ?? 0,
      ),
      source: Number(
        element.getAttribute('data-reflection-preload-source-count') ?? 0,
      ),
    }))
    expect(preloadState.ready).toBe(preloadState.source)
  }

  const galleryGlass = page.locator('.galleryProjectedGlassLayer')
  const videoGlass = page.locator('.videoLibraryProjectedGlassLayer')
  await expect(galleryGlass).toHaveAttribute(
    'data-geometry-cache-valid',
    'true',
  )
  await expect(videoGlass).toHaveAttribute(
    'data-geometry-cache-valid',
    'true',
  )
  await startupGate.click({ position: { x: 24, y: 24 } })
  await expect(startupGate).toHaveCount(0)
  await page.locator('.projectStage').evaluate((element) => {
    ;(
      window as typeof window & {
        __auroraStableProjectStage?: Element
      }
    ).__auroraStableProjectStage = element
  })

  const openDefaultProject = page.getByRole('button', {
    name: '极境之环 打开项目',
    exact: true,
  })
  await openDefaultProject.click()
  await expect(page.locator('.auroraApp')).toHaveClass(
    /view-video-library/,
  )
  await expect(page.locator('.projectStage')).toHaveAttribute(
    'data-page-active',
    'false',
  )
  expect(
    await page.locator('.projectStage').evaluate(
      (element) =>
        element ===
        (
          window as typeof window & {
            __auroraStableProjectStage?: Element
          }
        ).__auroraStableProjectStage,
    ),
  ).toBe(true)

  const retainedClipTarget = page
    .locator('.videoClipHitTarget:not([aria-hidden="true"])')
    .nth(1)
  await expect(retainedClipTarget).toBeVisible()
  const retainedClipId = await retainedClipTarget.getAttribute(
    'data-clip-id',
  )
  expect(retainedClipId).toBeTruthy()
  await retainedClipTarget.click()
  await expect(page.locator('.clipDetailPanel')).toHaveAttribute(
    'data-clip-id',
    retainedClipId!,
  )
  await page.mouse.move(8, 8)
  await expect(videoGlass).toHaveAttribute(
    'data-geometry-cache-valid',
    'true',
  )

  await page.locator('.sideDock button[aria-label="项目库"]').click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-gallery/)
  await expect(page.locator('.projectStage')).toHaveAttribute(
    'data-page-active',
    'true',
  )
  await page.mouse.move(8, 8)
  await expect(galleryGlass).toHaveAttribute(
    'data-geometry-cache-valid',
    'true',
  )
  await expect(videoGlass).toHaveAttribute(
    'data-geometry-cache-valid',
    'true',
  )
  const stableVideoSyncCount = Number(
    await videoGlass.getAttribute('data-geometry-sync-count'),
  )
  const stableGallerySyncCount = Number(
    await galleryGlass.getAttribute('data-geometry-sync-count'),
  )

  await page.locator('.sideDock button[aria-label="项目详情"]').click()
  await expect(page.locator('.auroraApp')).toHaveClass(
    /view-video-library/,
  )
  await expect(page.locator('.clipDetailPanel')).toHaveAttribute(
    'data-clip-id',
    retainedClipId!,
  )
  expect(
    Number(await videoGlass.getAttribute('data-geometry-sync-count')),
  ).toBe(stableVideoSyncCount)
  await page.locator('.sideDock button[aria-label="项目库"]').click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-gallery/)
  expect(
    Number(await galleryGlass.getAttribute('data-geometry-sync-count')),
  ).toBe(stableGallerySyncCount)
  await page.locator('.sideDock button[aria-label="项目详情"]').click()
  await expect(page.locator('.auroraApp')).toHaveClass(
    /view-video-library/,
  )

  const openFrameRing = page.getByRole('button', {
    name: '打开帧环浏览',
  })
  await openFrameRing.click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)
  const frameView = page.locator('.frameRingView')
  const frameHitLayer = page.locator('.frameRingHitLayer')
  await expect(frameHitLayer).toHaveAttribute(
    'data-geometry-cache-valid',
    'true',
  )
  const frameSyncCount = Number(
    await frameHitLayer.getAttribute('data-geometry-sync-count'),
  )
  await frameView.evaluate((element) => {
    ;(
      window as typeof window & {
        __auroraStableFrameView?: Element
      }
    ).__auroraStableFrameView = element
  })

  await frameView.getByRole('button', { name: '极境之环' }).click()
  await expect(page.locator('.auroraApp')).toHaveClass(
    /view-video-library/,
  )
  await openFrameRing.click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)
  expect(
    await frameView.evaluate(
      (element) =>
        element ===
        (
          window as typeof window & {
            __auroraStableFrameView?: Element
          }
        ).__auroraStableFrameView,
    ),
  ).toBe(true)
  expect(
    Number(await frameHitLayer.getAttribute('data-geometry-sync-count')),
  ).toBe(frameSyncCount)

  await page.locator('.sideDock button[aria-label="探索"]').click()
  await expect(page.locator('.auroraApp')).toHaveClass(
    /view-online-search/,
  )
  await expect(page.locator('.discoveryView')).toHaveAttribute(
    'data-page-active',
    'true',
  )
})

test('describes a partial warmup honestly when a non-critical visual asset fails', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route(
    '**/aurora/home-create-project-button-frame.png',
    (route) => route.abort(),
  )
  await page.goto('/?startup=1')

  const startupGate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  await expect(
    startupGate.getByRole('button', { name: '点击画面进入' }),
  ).toBeVisible()
  await expect(startupGate).toHaveAttribute('data-degraded', 'true')
  await expect(startupGate.getByRole('progressbar')).toHaveAttribute(
    'aria-valuetext',
    /部分视觉效果已使用备用显示/,
  )
  await expect(startupGate).not.toContainText('视觉环境已准备完成')
})

test('settles reflection readiness when disposed during source-light loading', async ({
  page,
}) => {
  await page.goto('/')

  let releaseSourceLight = () => undefined
  let sourceLightRequestedResolve = () => undefined
  const sourceLightRequested = new Promise<void>((resolve) => {
    sourceLightRequestedResolve = resolve
  })
  const sourceLightReleased = new Promise<void>((resolve) => {
    releaseSourceLight = resolve
  })
  await page.route('**/test-delayed-source-light.png', async (route) => {
    sourceLightRequestedResolve()
    await sourceLightReleased
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwMtmQAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
  })

  const readinessResultPromise = page.evaluate(async () => {
    const runtimeModule = await import(
      '/src/features/project-gallery/reflection/IceReflectionRenderer.ts'
    )
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    canvas.style.width = '32px'
    canvas.style.height = '32px'
    document.body.append(canvas)

    const renderer = new runtimeModule.IceReflectionRenderer(canvas, [], {
      sourceLightAsset: '/test-delayed-source-light.png',
      textureCache: {
        drawCard: async () => document.createElement('canvas'),
      },
    })
    const readiness = renderer.whenReady()
    renderer.dispose()
    const result = await Promise.race([
      readiness.then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise<'pending'>((resolve) =>
        window.setTimeout(() => resolve('pending'), 1_500),
      ),
    ])
    canvas.remove()
    return result
  })

  await sourceLightRequested
  const readinessResult = await readinessResultPromise
  releaseSourceLight()
  expect(readinessResult).toBe('resolved')
})
