import { expect, test, type Locator, type Page } from '@playwright/test'

async function expectCameraDragFrom(page: Page, target: Locator) {
  const root = page.locator('.auroraApp')
  const before = await root.evaluate((element) =>
    Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--camera-yaw'),
    ),
  )
  const box = await target.boundingBox()
  expect(box).not.toBeNull()

  const startX = box!.x + box!.width * 0.5
  const startY = box!.y + box!.height * 0.5
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 120, startY + 8, { steps: 4 })
  await page.mouse.up()

  await expect.poll(() => root.evaluate((element) =>
    Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--camera-yaw'),
    ),
  )).not.toBe(before)
}

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

async function expectCurrentReflectionRevisionReady(reflection: Locator) {
  await expect(reflection).toHaveAttribute('data-reflection-ready', 'true')
  await expect
    .poll(() =>
      reflection.evaluate((element) => {
        const source = element.getAttribute('data-reflection-source-revision')
        return Boolean(
          source &&
            source === element.getAttribute('data-reflection-prepared-revision') &&
            source === element.getAttribute('data-reflection-rendered-revision') &&
            element.getAttribute('data-reflection-content-ready') === 'true' &&
            element.getAttribute('data-reflection-prepare-state') === 'ready',
        )
      }),
    )
    .toBe(true)
}

test('single video keeps card controls while handing its non-scrollable hit target to the camera', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: '极境之环 项目设置' }).click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', {
    name: '导入素材 添加本地视频到当前项目',
    exact: true,
  }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'single-video.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('Aurora single video gesture fixture'),
  })

  await page
    .getByRole('button', { name: '极境之环 打开项目', exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: '极境之环 视频片段库' }),
  ).toBeVisible()

  const grid = page.locator('.videoClipGrid')
  const hitTarget = page.locator('.videoClipHitTarget')
  const menuTarget = page.locator('.videoClipMenuHitTarget')

  await expect(page.locator('.videoClipCard')).toHaveCount(1)
  await expect(grid).toHaveAttribute('data-track-scrollable', 'false')
  await expect(hitTarget).toHaveAttribute('data-camera-gesture', 'allow')
  await expect(menuTarget).not.toHaveAttribute('data-camera-gesture', 'allow')
  await expectCameraDragFrom(page, hitTarget)
  await expect(grid).not.toHaveClass(/isClipDragging/)

  await hitTarget.click()
  await expect(page.getByLabel('single-video.mp4 详情')).toBeVisible()

  await hitTarget.dblclick()
  await expect(
    page.getByRole('region', { name: 'single-video.mp4 帧环浏览' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '极境之环' }).click()

  await menuTarget.click()
  await expect(
    page.getByRole('dialog', { name: 'single-video.mp4 更多操作' }),
  ).toBeVisible()
})

test('single model removes the broad stage blocker while preserving selection and menu targets', async ({
  page,
}) => {
  const projectName = '单卡三维手势'
  await page.goto('/')
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
    name: 'single-model.glb',
    mimeType: 'model/gltf-binary',
    buffer: createEmptyGlb(),
  })

  const stage = page.locator('.modelAssetStage')
  const hitTarget = page.locator('.modelAssetStage .videoClipHitTarget')
  const menuTarget = page.locator('.modelAssetStage .videoClipMenuHitTarget')
  const videoReflection = page.locator('.videoLibraryReflectionCanvas')
  const modelReflection = page.locator('.modelLibraryReflectionCanvas')
  await expect(page.locator('.modelAssetCard')).toHaveCount(1)
  await expect(videoReflection).toHaveCount(1)
  await expect(modelReflection).toHaveCount(1)
  await expect(videoReflection).toHaveAttribute('data-reflection-active', 'false')
  await expect(modelReflection).toHaveAttribute('data-reflection-active', 'true')
  await expect(modelReflection).toHaveAttribute(
    'data-aurora-renderer',
    'model-reflection',
  )
  await expect(modelReflection).toHaveAttribute(
    'data-reflection-source-scope',
    '.modelLibraryView',
  )
  await expectCurrentReflectionRevisionReady(modelReflection)
  await expect(stage).toHaveAttribute('data-track-scrollable', 'false')
  await expect(stage).not.toHaveAttribute('data-camera-gesture', 'block')
  await expect(hitTarget).toHaveAttribute('data-camera-gesture', 'allow')
  await expect(menuTarget).not.toHaveAttribute('data-camera-gesture', 'allow')

  const modelSearch = page.getByPlaceholder('搜索三维模型...')
  await modelSearch.fill('没有这个模型')
  await expect(page.getByText('没有符合条件的模型')).toBeVisible()
  await expect(modelReflection).toHaveAttribute(
    'data-reflection-prepare-state',
    'ready',
  )
  await expect(modelReflection).not.toHaveAttribute(
    'data-reflection-prepare-state',
    'error',
  )
  await modelSearch.fill('')
  await expect(page.locator('.modelAssetCard')).toHaveCount(1)
  await expectCurrentReflectionRevisionReady(modelReflection)

  await expectCameraDragFrom(page, hitTarget)

  await hitTarget.click()
  await expect(page.getByLabel('single-model.glb 详情')).toBeVisible()
  const favoriteButton = page.getByRole('button', { name: '收藏三维模型' })
  await expect(favoriteButton).toHaveClass(/detailFavoriteButton/)
  await expect(favoriteButton).toHaveAttribute('aria-pressed', 'false')
  const reflectionRevisionBeforeFavorite = await modelReflection.getAttribute(
    'data-reflection-source-revision',
  )
  expect(reflectionRevisionBeforeFavorite).toBeTruthy()
  await favoriteButton.click()
  await expect(
    page.getByRole('button', { name: '取消收藏三维模型' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() =>
      modelReflection.getAttribute('data-reflection-source-revision'),
    )
    .not.toBe(reflectionRevisionBeforeFavorite)
  await expectCurrentReflectionRevisionReady(modelReflection)
  await menuTarget.click()
  await expect(
    page.getByRole('dialog', { name: 'single-model.glb 更多操作' }),
  ).toBeVisible()
})
