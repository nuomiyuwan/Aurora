import { expect, test, type Page } from '@playwright/test'

function createEmptyGlb() {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [] }],
  }))
  const paddedJsonLength = Math.ceil(json.length / 4) * 4
  const buffer = Buffer.alloc(12 + 8 + paddedJsonLength, 0x20)
  buffer.writeUInt32LE(0x46546c67, 0)
  buffer.writeUInt32LE(2, 4)
  buffer.writeUInt32LE(buffer.length, 8)
  buffer.writeUInt32LE(paddedJsonLength, 12)
  buffer.writeUInt32LE(0x4e4f534a, 16)
  json.copy(buffer, 20)
  return buffer
}

async function waitForIdlePageTransition(page: Page) {
  await expect(page.locator('.auroraApp')).not.toHaveClass(
    /isPageEntering|isPageExiting/,
  )
}

async function createModelProject(
  page: Page,
  projectName: string,
  filename: string,
) {
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: '新建项目' })
  await createDialog.getByRole('radio', { name: /三维项目/ }).click()
  await createDialog.locator('input[name="projectName"]').fill(projectName)
  await createDialog
    .getByRole('button', { name: '创建项目', exact: true })
    .click()

  await page
    .getByRole('button', { name: `${projectName} 尚未导入模型`, exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: `${projectName} 三维模型库` }),
  ).toBeVisible()

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入三维模型' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: filename,
    mimeType: 'model/gltf-binary',
    buffer: createEmptyGlb(),
  })

  await expect(page.locator(`.modelAssetCard[data-model-id]`)).toHaveCount(1)
  await expect(page.getByLabel(`${filename} 详情`)).toBeVisible()
  await waitForIdlePageTransition(page)
}

async function returnToGallery(page: Page) {
  await page
    .getByRole('complementary', { name: '主导航' })
    .getByRole('button', { name: '项目库', exact: true })
    .click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-gallery/)
  await waitForIdlePageTransition(page)
}

async function openProjectFromSearch(page: Page, projectName: string) {
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '搜索项目' })
  await dialog.getByPlaceholder('搜索项目名称').fill(projectName)
  const result = dialog.getByRole('button').filter({ hasText: projectName })
  await expect(result).toHaveCount(1)
  await result.click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-model-library/)
}

type Box = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

type GeometrySample = {
  entering: boolean
  hit: Box | null
  card: Box | null
}

const maxBoxDelta = (left: Box | null, right: Box | null) => {
  if (!left || !right) return Number.POSITIVE_INFINITY
  return Math.max(
    Math.abs(left.left - right.left),
    Math.abs(left.top - right.top),
    Math.abs(left.right - right.right),
    Math.abs(left.bottom - right.bottom),
  )
}

test('model cards keep flat hit geometry aligned throughout the depth-page entrance', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await createModelProject(page, '三维换页几何', 'geometry-model.glb')
  await returnToGallery(page)

  await openProjectFromSearch(page, '三维换页几何')
  const app = page.locator('.auroraApp')
  await expect(app).toHaveClass(/isPageEntering/)

  const samples = await page.evaluate(async () => {
    const readBox = (element: Element | null): Box | null => {
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }
    const frames: GeometrySample[] = []
    for (let frame = 0; frame < 36; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const root = document.querySelector('.auroraApp')
      frames.push({
        entering: root?.classList.contains('isPageEntering') ?? false,
        card: readBox(document.querySelector('.modelAssetCard .videoClipVisual')),
        hit: readBox(document.querySelector('.modelAssetStage .videoClipHitTarget')),
      })
      if (frames.length > 4 && !frames.at(-1)?.entering) break
    }
    return frames
  })

  const enteringSamples = samples.filter((sample) => sample.entering)
  expect(enteringSamples.length).toBeGreaterThan(2)
  expect(
    Math.max(
      ...enteringSamples.map((sample) => maxBoxDelta(sample.card, sample.hit)),
    ),
  ).toBeLessThan(3)
})

test('model card, detail glass and hit geometry are ready after entry and stay warm when switching 3D projects', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await createModelProject(page, '三维项目甲', 'model-a.glb')
  await returnToGallery(page)
  await createModelProject(page, '三维项目乙', 'model-b.glb')
  await returnToGallery(page)

  await openProjectFromSearch(page, '三维项目甲')
  await waitForIdlePageTransition(page)
  await returnToGallery(page)
  await openProjectFromSearch(page, '三维项目乙')

  const warmupFrames = await page.evaluate(async () => {
    const frames: Array<{
      entering: boolean
      cacheValid: boolean
      cardGlassOpacity: number
      detailGlassOpacity: number
    }> = []
    for (let frame = 0; frame < 12; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const root = document.querySelector('.auroraApp')
      const layer = document.querySelector('.modelLibraryProjectedGlassLayer')
      const cardGlass = layer?.querySelector('.videoClipProjectedGlass')
      const detailGlass = layer?.querySelector('.videoDetailProjectedGlass')
      frames.push({
        entering: root?.classList.contains('isPageEntering') ?? false,
        cacheValid: layer?.getAttribute('data-geometry-cache-valid') === 'true',
        cardGlassOpacity:
          cardGlass instanceof HTMLElement
            ? Number.parseFloat(getComputedStyle(cardGlass).opacity)
            : 0,
        detailGlassOpacity:
          detailGlass instanceof HTMLElement
            ? Number.parseFloat(getComputedStyle(detailGlass).opacity)
            : 0,
      })
    }
    return frames
  })

  expect(warmupFrames.some((frame) => frame.entering)).toBe(true)
  const firstReadyFrame = warmupFrames.findIndex(
    (frame) =>
      frame.cacheValid &&
      frame.cardGlassOpacity > 0.02 &&
      frame.detailGlassOpacity > 0.02,
  )
  expect(firstReadyFrame).toBeGreaterThanOrEqual(0)
  expect(firstReadyFrame).toBeLessThanOrEqual(4)

  await waitForIdlePageTransition(page)
  const finalGeometry = await page.evaluate(() => {
    const box = (element: Element | null): Box | null => {
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }
    const anchorBounds = (selector: string): Box | null => {
      const anchors = [...document.querySelectorAll<HTMLElement>(selector)]
      if (anchors.length !== 4) return null
      const centers = anchors.map((anchor) => {
        const rect = anchor.getBoundingClientRect()
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        }
      })
      const left = Math.min(...centers.map(({ x }) => x))
      const top = Math.min(...centers.map(({ y }) => y))
      const right = Math.max(...centers.map(({ x }) => x))
      const bottom = Math.max(...centers.map(({ y }) => y))
      return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
      }
    }
    const layer = document.querySelector('.modelLibraryProjectedGlassLayer')
    const hit = document.querySelector('.modelAssetStage .videoClipHitTarget')
    return {
      cacheValid: layer?.getAttribute('data-geometry-cache-valid') === 'true',
      card: box(document.querySelector('.modelAssetCard .videoClipVisual')),
      hit: box(hit),
      hitVisibility:
        hit instanceof HTMLElement ? getComputedStyle(hit).visibility : '',
      cardGlass: box(layer?.querySelector('.videoClipProjectedGlass') ?? null),
      cardAnchors: anchorBounds(
        '.modelAssetCard .videoClipGlassAnchor',
      ),
      detailGlass: box(layer?.querySelector('.videoDetailProjectedGlass') ?? null),
      detailAnchors: anchorBounds(
        '.modelLibraryDetailPanel .detailPanelGlassAnchor',
      ),
    }
  })

  expect(finalGeometry.cacheValid).toBe(true)
  expect(finalGeometry.hitVisibility).toBe('visible')
  expect(maxBoxDelta(finalGeometry.card, finalGeometry.hit)).toBeLessThan(3)
  expect(
    maxBoxDelta(finalGeometry.cardGlass, finalGeometry.cardAnchors),
  ).toBeLessThan(3)
  expect(
    maxBoxDelta(finalGeometry.detailGlass, finalGeometry.detailAnchors),
  ).toBeLessThan(3)
})
