import { expect, test, type Page } from '@playwright/test'

test.use({
  viewport: { width: 2560, height: 1440 },
  deviceScaleFactor: 1.5,
})

async function installDesktopBridge(
  page: Page,
  platform: 'darwin' | 'win32',
) {
  await page.addInitScript(({ platform: desktopPlatform }) => {
    const maximizedListeners = new Set<(maximized: boolean) => void>()
    const fullscreenListeners = new Set<(fullscreen: boolean) => void>()

    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        platform: desktopPlatform,
        notifyStartupVisualReady() {},
        loadAppData: async () => null,
        saveAppData: async () => true,
        getMediaUrl: () => null,
        minimizeWindow() {},
        toggleMaximizeWindow: async () => false,
        toggleFullscreenWindow: async () => false,
        getWindowMaximizedState: async () => false,
        onWindowMaximizedStateChange(
          listener: (maximized: boolean) => void,
        ) {
          maximizedListeners.add(listener)
          return () => maximizedListeners.delete(listener)
        },
        getWindowFullscreenState: async () => false,
        onWindowFullscreenStateChange(
          listener: (fullscreen: boolean) => void,
        ) {
          fullscreenListeners.add(listener)
          return () => fullscreenListeners.delete(listener)
        },
        closeWindow() {},
        searchOnlineProvider: async ({
          provider,
          query,
          page = 1,
          limit = 12,
        }: {
          provider: string
          query: string
          page?: number
          limit?: number
        }) => ({
          query,
          page,
          pageSize: limit,
          totalCount: 12,
          hasMore: false,
          nextPage: null,
          results: Array.from({ length: 12 }, (_, index) => {
            const ordinal = index + 1
            const mediaId = `BV1HIDPI${String(ordinal).padStart(2, '0')}`
            return {
              source: provider,
              kind: 'video' as const,
              mediaId,
              bvid: mediaId,
              episodeId: null,
              url: `https://example.com/${mediaId}`,
              canonicalUrl: `https://example.com/${mediaId}`,
              title: `${query} 第 ${ordinal} 条`,
              description: 'Windows 高 DPI 搜索结果清晰度回归',
              coverUrl: '/aurora/project-ring-of-horizon.png',
              thumbnailPath: null,
              author: 'Aurora',
              duration: '01:00',
              publishedAt: '',
              tags: [query, '4K'],
            }
          }),
        }),
      },
    })
  }, { platform })
}

async function openDiscovery(page: Page) {
  await page.goto('/')
  await page.locator('.auroraApp').evaluate((app) => {
    app.setAttribute('data-platform', 'win32')
  })
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await expect(page.locator('.discoveryView')).toHaveAttribute(
    'data-page-active',
    'true',
  )
  await expect(page.locator('.auroraApp')).not.toHaveClass(
    /isPageEntering|isPageExiting/,
  )
}

async function installSearchBridge(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        searchOnlineProvider: async ({
          provider,
          query,
          page = 1,
          limit = 12,
        }: {
          provider: string
          query: string
          page?: number
          limit?: number
        }) => ({
          query,
          page,
          pageSize: limit,
          totalCount: 12,
          hasMore: false,
          nextPage: null,
          results: Array.from({ length: 12 }, (_, index) => {
            const ordinal = index + 1
            const mediaId = `BV1HIDPI${String(ordinal).padStart(2, '0')}`
            return {
              source: provider,
              kind: 'video' as const,
              mediaId,
              bvid: mediaId,
              episodeId: null,
              url: `https://example.com/${mediaId}`,
              canonicalUrl: `https://example.com/${mediaId}`,
              title: `${query} 第 ${ordinal} 条`,
              description: 'Windows 高 DPI 搜索结果清晰度回归',
              coverUrl: '/aurora/project-ring-of-horizon.png',
              thumbnailPath: null,
              author: 'Aurora',
              duration: '01:00',
              publishedAt: '',
              tags: [query, '4K'],
            }
          }),
        }),
      },
    })
  })
}

test('Windows high-DPI mode keeps active text sharp and preserves card depth effects', async ({
  page,
}) => {
  await installDesktopBridge(page, 'win32')
  await page.goto('/')

  const app = page.locator('.auroraApp')
  await expect(app).toHaveAttribute('data-platform', 'win32')

  const rasterState = await page.evaluate(() => {
    const appElement = document.querySelector<HTMLElement>('.auroraApp')!
    const activeCard = document.querySelector<HTMLElement>(
      '.projectCard[data-card-active="true"]',
    )!
    const sideCard = document.querySelector<HTMLElement>(
      '.projectCard:not([data-card-active="true"])',
    )!
    const activeCopy = activeCard.querySelector<HTMLElement>('.cardCopy')!
    const sideCopy = sideCard.querySelector<HTMLElement>('.cardCopy')!
    const activeSurface = activeCard.querySelector<HTMLElement>(
      '.projectCardRasterSurface',
    )!

    return {
      appFontFamily: getComputedStyle(appElement).fontFamily,
      appTextRendering: getComputedStyle(appElement).textRendering,
      activeCopyFilter: getComputedStyle(activeCopy).filter,
      activeCopyTextRendering: getComputedStyle(activeCopy).textRendering,
      activeCopyOpacity: Number.parseFloat(getComputedStyle(activeCopy).opacity),
      sideCopyFilter: getComputedStyle(sideCopy).filter,
      sideCopyOpacity: Number.parseFloat(getComputedStyle(sideCopy).opacity),
      cardWillChange: getComputedStyle(activeCard).willChange,
      surfaceWillChange: getComputedStyle(activeSurface).willChange,
    }
  })

  expect(rasterState.appFontFamily).toContain('Segoe UI')
  expect(rasterState.appTextRendering).toBe('auto')
  expect(rasterState.activeCopyFilter).toBe('none')
  expect(rasterState.activeCopyTextRendering).toBe('auto')
  expect(rasterState.activeCopyOpacity).toBe(1)
  expect(rasterState.sideCopyFilter).toContain('blur(')
  expect(rasterState.sideCopyFilter).toContain('saturate(')
  expect(rasterState.sideCopyFilter).toContain('brightness(')
  expect(rasterState.sideCopyOpacity).toBe(1)
  expect(rasterState.cardWillChange).toBe('auto')
  expect(rasterState.surfaceWillChange).toBe('auto')
})

test('Windows window resize rebuilds gallery text at the new physical size', async ({
  page,
}) => {
  await installDesktopBridge(page, 'win32')
  await page.goto('/')

  const app = page.locator('.auroraApp')
  const activeCopy = page.locator(
    '.projectCard[data-card-active="true"] .cardCopy',
  )
  const galleryTitle = page.locator('.pageIntro h1')
  const statusCopy = page.locator('.statusBar span').first()
  const createLabel = page.locator('.createProjectButtonLabel')
  const initialRevision = await app.getAttribute(
    'data-windows-text-raster-revision',
  )
  await page.evaluate(() => {
    const currentWindow = window as typeof window & {
      __auroraWindowsResizeTextNodes?: Element[]
    }
    currentWindow.__auroraWindowsResizeTextNodes = [
      document.querySelector(
        '.projectCard[data-card-active="true"] .cardCopy',
      )!,
      document.querySelector('.pageIntro h1')!,
      document.querySelector('.statusBar span')!,
      document.querySelector('.createProjectButtonLabel')!,
    ]
  })

  await page.setViewportSize({ width: 2048, height: 1280 })
  await expect(app).not.toHaveAttribute(
    'data-windows-text-raster-revision',
    initialRevision ?? '',
  )

  const repainted = await page.evaluate(() => {
    const currentWindow = window as typeof window & {
      __auroraWindowsResizeTextNodes?: Element[]
    }
    const previous = currentWindow.__auroraWindowsResizeTextNodes ?? []
    const current = [
      document.querySelector(
        '.projectCard[data-card-active="true"] .cardCopy',
      )!,
      document.querySelector('.pageIntro h1')!,
      document.querySelector('.statusBar span')!,
      document.querySelector('.createProjectButtonLabel')!,
    ]
    return {
      allReplaced: current.every(
        (element, index) => element !== previous[index],
      ),
      connected: current.every((element) => element.isConnected),
      cardFilter: getComputedStyle(current[0]).filter,
      cardTextRendering: getComputedStyle(current[0]).textRendering,
    }
  })

  expect(repainted.allReplaced).toBe(true)
  expect(repainted.connected).toBe(true)
  expect(repainted.cardFilter).toBe('none')
  expect(repainted.cardTextRendering).toBe('auto')
  await expect(activeCopy).toBeVisible()
  await expect(galleryTitle).toBeVisible()
  await expect(statusCopy).toBeVisible()
  await expect(createLabel).toBeVisible()
})

test('Windows high-DPI mode lays out Discovery at final raster size', async ({
  page,
}) => {
  await openDiscovery(page)
  await installSearchBridge(page)

  const planeState = await page.locator('.discoveryPlane').evaluate((plane) => {
    const app = plane.closest<HTMLElement>('.auroraApp')!
    const appStyle = getComputedStyle(app)
    const style = getComputedStyle(plane)
    const appRect = app.getBoundingClientRect()
    const rect = plane.getBoundingClientRect()
    return {
      scale: Number.parseFloat(appStyle.getPropertyValue('--layout-scale')),
      planeLeft: Number.parseFloat(
        appStyle.getPropertyValue('--layout-plane-left'),
      ),
      planeTop: Number.parseFloat(
        appStyle.getPropertyValue('--layout-plane-top'),
      ),
      zoom: Number.parseFloat(style.zoom),
      transform: style.transform,
      rect: {
        left: rect.left - appRect.left,
        top: rect.top - appRect.top,
        width: rect.width,
        height: rect.height,
      },
    }
  })

  expect(planeState.zoom).toBeCloseTo(planeState.scale, 4)
  expect(planeState.transform).toBe('none')
  expect(planeState.rect.left).toBeCloseTo(planeState.planeLeft, 1)
  expect(planeState.rect.top).toBeCloseTo(planeState.planeTop, 1)
  expect(planeState.rect.width).toBeCloseTo(1706 * planeState.scale, 1)
  expect(planeState.rect.height).toBeCloseTo(956 * planeState.scale, 1)

  await page.locator('.discoverySourceFilters button').filter({
    hasText: 'B站',
  }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click()
  })
  await page.getByLabel('搜索视频片段或关键帧').fill('高分辨率')
  await page.getByRole('button', { name: '开始搜索' }).click()

  const selectedCard = page.locator('.discoveryResultCard.selected')
  const detailPanel = page.locator('.discoveryDetailPanel')
  await expect(selectedCard).toBeVisible()
  await expect(detailPanel).toBeVisible()

  const layerState = await selectedCard.evaluate((card) => {
    const motion = card.querySelector<HTMLElement>('.discoveryResultMotion')!
    const visual = card.querySelector<HTMLElement>('.discoveryResultVisual')!
    const detail = document.querySelector<HTMLElement>(
      '.discoveryDetailPanel',
    )!
    const chrome = detail.querySelector<HTMLElement>('.discoveryDetailChrome')!
    return {
      cardWillChange: getComputedStyle(card).willChange,
      motionFilter: getComputedStyle(motion).filter,
      motionWillChange: getComputedStyle(motion).willChange,
      visualFilter: getComputedStyle(visual).filter,
      detailFilter: getComputedStyle(detail).filter,
      detailChromeFilter: getComputedStyle(chrome).filter,
    }
  })

  expect(layerState.cardWillChange).toBe('auto')
  expect(layerState.motionFilter).toBe('none')
  expect(layerState.motionWillChange).toBe('auto')
  expect(layerState.visualFilter).toBe('none')
  expect(layerState.detailFilter).toBe('none')
  expect(layerState.detailChromeFilter).toContain('drop-shadow')

  const projectionState = await page.evaluate(async () => {
    const { sampleDiscoveryReflections } = await import(
      '/src/features/discovery/discoveryReflectionProjection.ts'
    )
    const view = document.querySelector<HTMLElement>('.discoveryView')!
    const card = document.querySelector<HTMLElement>(
      '.discoveryResultCard.selected',
    )!
    const snapshot = sampleDiscoveryReflections(view)
    const sample = snapshot.samples.find(
      ({ projectId }) => projectId === card.dataset.discoveryReflectionId,
    )!
    const elements = sample.cardMatrix.elements
    const projectPoint = (x: number, y: number) => {
      const projectedX = elements[0] * x + elements[4] * y + elements[12]
      const projectedY = elements[1] * x + elements[5] * y + elements[13]
      const projectedW = elements[3] * x + elements[7] * y + elements[15]
      return {
        x: projectedX / projectedW,
        y: projectedY / projectedW,
      }
    }
    const corners = [
      projectPoint(0, 0),
      projectPoint(sample.width, 0),
      projectPoint(sample.width, sample.height),
      projectPoint(0, sample.height),
    ]
    const viewRect = view.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const projectedBounds = {
      left: Math.min(...corners.map(({ x }) => x)),
      top: Math.min(...corners.map(({ y }) => y)),
      right: Math.max(...corners.map(({ x }) => x)),
      bottom: Math.max(...corners.map(({ y }) => y)),
    }
    const actualBounds = {
      left: cardRect.left - viewRect.left,
      top: cardRect.top - viewRect.top,
      right: cardRect.right - viewRect.left,
      bottom: cardRect.bottom - viewRect.top,
    }
    return {
      fallbackCount: snapshot.fallbackCount,
      maximumError: Math.max(
        ...Object.keys(actualBounds).map((key) =>
          Math.abs(
            actualBounds[key as keyof typeof actualBounds] -
              projectedBounds[key as keyof typeof projectedBounds],
          ),
        ),
      ),
    }
  })

  expect(projectionState.fallbackCount).toBe(0)
  expect(projectionState.maximumError).toBeLessThan(2)
})

test('macOS keeps the existing Discovery transform path', async ({ page }) => {
  await page.goto('/')
  await page.locator('.auroraApp').evaluate((app) => {
    app.setAttribute('data-platform', 'darwin')
  })
  await page.locator('.sideDock button[aria-label="探索"]').click()

  const state = await page.locator('.discoveryPlane').evaluate((plane) => {
    const style = getComputedStyle(plane)
    return {
      zoom: Number.parseFloat(style.zoom),
      transform: style.transform,
    }
  })

  expect(state.zoom).toBe(1)
  expect(state.transform).not.toBe('none')
})
