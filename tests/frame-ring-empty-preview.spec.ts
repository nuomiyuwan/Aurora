import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 1706, height: 956 } })

test('keeps an unindexed preview centered and synchronizes its three-dimensional layers', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  await page.getByRole('button', { name: '极境之环 项目设置' }).click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', {
    name: '导入素材 添加本地视频到当前项目',
    exact: true,
  }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'unindexed-preview.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('Aurora unindexed preview fixture'),
  })

  await page.getByRole('button', { name: '极境之环 打开项目', exact: true }).click()
  await expect(page.getByRole('region', { name: '极境之环 视频片段库' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'unindexed-preview.mp4 详情' })).toBeVisible()
  await page.getByRole('button', { name: '打开帧环浏览/预览' }).click()
  await expect(
    page.getByRole('region', { name: 'unindexed-preview.mp4 帧环浏览' }),
  ).toBeVisible()
  await expect(page.getByText('尚未建立帧环')).toBeVisible()

  const view = page.locator('.frameRingView[data-page-active="true"]')
  const glassLayer = page.locator(
    '.frameRingProjectedGlassLayer[data-glass-active="true"]',
  )
  const portalLayer = page.locator(
    '.frameRingInfoPortalLayer[data-page-active="true"]',
  )
  await expect(glassLayer).toHaveAttribute('data-frame-ring-ready', 'false')

  const geometry = await page.evaluate(() => {
    const selectors = [
      '.frameRingView[data-page-active="true"]',
      '.frameRingProjectedGlassLayer[data-glass-active="true"]',
      '.frameRingInfoPortalLayer[data-page-active="true"]',
    ]
    const variableNames = [
      '--frame-ring-preview-x',
      '--frame-ring-preview-y',
      '--frame-ring-preview-z',
      '--frame-ring-preview-width',
      '--frame-ring-preview-scale',
      '--frame-ring-floating-floor-y',
    ]
    const variables = selectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector)!
      const style = getComputedStyle(element)
      return Object.fromEntries(
        variableNames.map((name) => [name, style.getPropertyValue(name).trim()]),
      )
    })
    const preview = document.querySelector<HTMLElement>('.frameRingPreview')!
    const glass = document.querySelector<HTMLElement>(
      '.frameRingPreviewControlsProjectedGlass',
    )!
    const portal = document.querySelector<HTMLElement>(
      '.frameRingPreviewControlsPortalObject',
    )!
    return {
      variables,
      transforms: [preview, glass, portal].map(
        (element) => getComputedStyle(element).transform,
      ),
    }
  })

  expect(geometry.variables[1]).toEqual(geometry.variables[0])
  expect(geometry.variables[2]).toEqual(geometry.variables[0])
  expect(geometry.variables[0]).toMatchObject({
    '--frame-ring-preview-x': '853px',
    '--frame-ring-preview-y': '120px',
    '--frame-ring-preview-scale': '1.5',
    '--frame-ring-floating-floor-y': '696.307px',
  })
  expect(geometry.transforms[1]).toBe(geometry.transforms[0])
  expect(geometry.transforms[2]).toBe(geometry.transforms[0])

  const previewBounds = await page.locator('.frameRingPreview').boundingBox()
  const emptyStateBounds = await page.locator('.frameRingEmptyState').boundingBox()
  expect(previewBounds).not.toBeNull()
  expect(emptyStateBounds).not.toBeNull()
  expect(previewBounds!.x + previewBounds!.width / 2).toBeCloseTo(853, 0)
  expect(previewBounds!.y + previewBounds!.height).toBeLessThan(
    emptyStateBounds!.y,
  )

  await expect(view).toBeVisible()
  await expect(glassLayer).toBeAttached()
  await expect(portalLayer).toBeAttached()
})
