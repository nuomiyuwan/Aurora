import { expect, test } from '@playwright/test'

test('启动页预绘制空项目提示、探索详情玻璃与可用的三维素材库', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        platform: 'darwin',
        notifyStartupVisualReady() {},
        notifyExternalVideoFilesReady() {},
        onExternalVideoFiles: () => () => undefined,
        loadAppData: async () => ({
          library: {
            schemaVersion: 5,
            projects: [
              {
                id: 'startup-empty-model-project',
                kind: '3d',
                title: '启动预热三维项目',
                subtitle: 'Startup Model Project',
                cover: './aurora/project-ring-of-horizon.png',
                videoCount: 0,
                collectionCount: 0,
                updatedAt: '2026-08-11 15:00',
              },
            ],
            mediaAssets: [],
            projectAssetRefs: [],
            visualIndexes: [],
            frameAnnotations: [],
            frameExclusions: [],
            modelAssets: [],
            projectTitles: {
              'startup-empty-model-project': '启动预热三维项目',
            },
            projectCovers: {},
            selectedProjectId: 'startup-empty-model-project',
          },
        }),
        saveAppData: async () => true,
        saveAppDataSync: () => true,
        getMediaUrl: () => null,
      },
    })
  })

  await page.goto('/')
  const startupGate = page.getByRole('dialog', {
    name: 'Aurora 启动载入',
  })
  await expect(
    startupGate.getByRole('button', { name: '点击画面进入' }),
  ).toBeVisible({ timeout: 45_000 })
  await expect(startupGate).toHaveAttribute('data-degraded', 'false')

  const restoredGalleryGlass = await page
    .locator('.statusBar.uiGlassShell, .createProjectButton.uiGlassShell')
    .evaluateAll((elements) => {
      const visibleElements = elements.filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number.parseFloat(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0
        )
      })
      return {
        count: visibleElements.length,
        prepared: visibleElements.every(
          (element) =>
            (element as HTMLElement).dataset.startupGlassPrepared === 'true',
        ),
        promoted: visibleElements.every((element) =>
          getComputedStyle(element).willChange.includes('backdrop-filter'),
        ),
      }
    })
  expect(restoredGalleryGlass.count).toBeGreaterThan(0)
  expect(restoredGalleryGlass.prepared).toBe(true)
  expect(restoredGalleryGlass.promoted).toBe(true)
  await expect(page.locator('.galleryProjectedGlassLayer')).toHaveAttribute(
    'data-geometry-cache-valid',
    'true',
  )

  const videoPrompts = page.locator(
    '.videoProjectEmptyState, .videoProjectFilteredEmptyState',
  )
  await expect(videoPrompts).toHaveCount(2)
  await expect(page.locator('.videoProjectEmptyState')).toHaveAttribute(
    'data-empty-visible',
    'true',
  )
  expect(
    await videoPrompts.evaluateAll((elements) =>
      elements.every((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }),
    ),
  ).toBe(true)

  const modelPrompts = page.locator(
    '.modelLibraryView .modelLibraryEmptyState',
  )
  await expect(modelPrompts).toHaveCount(2)
  await expect(modelPrompts.first()).toHaveAttribute(
    'data-empty-visible',
    'true',
  )
  await expect(page.locator('.modelLibraryProjectedGlassLayer')).toHaveAttribute(
    'data-geometry-cache-valid',
    'true',
  )
  const discoveryWarmupGlass = page.locator(
    '.discoveryDetailWarmupGlass',
  )
  await expect(discoveryWarmupGlass).toHaveCount(1)
  await expect(discoveryWarmupGlass).toHaveCSS('opacity', '0.001')
  expect(
    await discoveryWarmupGlass.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }),
  ).toBe(true)

  const discoverySearchBar = page.locator('.discoverySearchBar')
  await expect(discoverySearchBar).toHaveAttribute(
    'data-startup-glass-prepared',
    'true',
  )
  await expect(discoverySearchBar).toHaveCSS('transform', 'none')
  expect(
    await discoverySearchBar.evaluate((element) => {
      const style = getComputedStyle(element)
      return (
        style.backdropFilter ||
        style.getPropertyValue('-webkit-backdrop-filter')
      )
    }),
  ).not.toBe('none')
})
