import { expect, test } from '@playwright/test'
import {
  resolveDocumentAssetUrl,
  toCssImageValue,
} from '../src/documentAssetUrl'

test('binds project and clip CSS cover variables to document URLs', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('region', { name: '项目轮播' })).toBeVisible()

  const activeProject = page.locator('.projectCard.active')
  await expect(activeProject).toHaveAttribute('data-project-id', 'ring')

  const expectedCoverUrl = await page.evaluate(
    () => new URL('./aurora/project-ring-of-horizon.png', document.baseURI).href,
  )
  const projectCoverUrl = await activeProject.evaluate((element) =>
    element.style.getPropertyValue('--cover').trim().replace(/^url\(["']?|["']?\)$/g, ''),
  )
  expect(projectCoverUrl).toBe(expectedCoverUrl)

  await page
    .getByRole('complementary', { name: '主导航' })
    .getByRole('button', { name: '项目详情' })
    .click()

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入视频素材' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'cover-binding.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from([0]),
  })

  const firstClip = page.locator('.videoClipCard').first()
  await expect(firstClip).toBeVisible()
  const clipCoverUrl = await firstClip.evaluate((element) =>
    element.style.getPropertyValue('--clip-cover').trim().replace(/^url\(["']?|["']?\)$/g, ''),
  )
  expect(clipCoverUrl).toBe(expectedCoverUrl)
})

test('resolves relative assets from explicit document bases', () => {
  const packagedUrl = resolveDocumentAssetUrl(
    './aurora/project-ring-of-horizon.png',
    'file:///Applications/Aurora.app/Contents/Resources/app.asar/dist/index.html',
  )
  expect(packagedUrl).toBe(
    'file:///Applications/Aurora.app/Contents/Resources/app.asar/dist/aurora/project-ring-of-horizon.png',
  )
  expect(packagedUrl).not.toContain('/dist/assets/aurora/')

  expect(
    resolveDocumentAssetUrl(
      './aurora/project-ring-of-horizon.png',
      'http://127.0.0.1:5174/nested/index.html',
    ),
  ).toBe('http://127.0.0.1:5174/nested/aurora/project-ring-of-horizon.png')
})

test('preserves absolute asset URL meanings', () => {
  const base = 'file:///Applications/Aurora.app/Contents/Resources/app.asar/dist/index.html'
  const absoluteAssets = [
    'blob:https://example.com/8ae3db6e-d258-4a84-9d13-b0f797141b88',
    'data:image/png;base64,AAAA',
    'https://cdn.example.com/project-cover.png',
    'file:///tmp/project-cover.png',
  ]

  for (const asset of absoluteAssets) {
    expect(resolveDocumentAssetUrl(asset, base)).toBe(new URL(asset, base).href)
  }
})

test('returns a relative asset unchanged without a document base', () => {
  const asset = './aurora/project-ring-of-horizon.png'

  expect(resolveDocumentAssetUrl(asset)).toBe(asset)
})

test('does not turn a missing thumbnail into an empty CSS url', () => {
  expect(toCssImageValue('')).toBe('none')
  expect(toCssImageValue('   ')).toBe('none')
  expect(toCssImageValue('file:///tmp/Frame 01.png')).toBe(
    'url("file:///tmp/Frame 01.png")',
  )
})
