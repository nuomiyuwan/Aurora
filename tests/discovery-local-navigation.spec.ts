import { expect, test } from '@playwright/test'

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

async function openDiscoverySearch(
  page: import('@playwright/test').Page,
  query: string,
) {
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-online-search/)
  await page.getByLabel('搜索视频片段或关键帧').fill(query)
  await page.getByRole('button', { name: '开始搜索' }).click()
}

async function createImportedVideoProject(
  page: import('@playwright/test').Page,
  projectName: string,
  filename: string,
) {
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: '新建项目' })
  await createDialog.locator('input[name="projectName"]').fill(projectName)
  await createDialog
    .getByRole('button', { name: '创建项目', exact: true })
    .click()
  await page
    .getByRole('button', { name: `${projectName} 尚未导入素材`, exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: `${projectName} 视频片段库` }),
  ).toBeVisible()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入视频素材' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: filename,
    mimeType: 'video/mp4',
    buffer: Buffer.from([0]),
  })
}

test('本地视频结果双击后通过稳定素材标识进入帧环', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const projectName = '探索双击视频项目'
  const filename = 'discovery-double-click.mp4'
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  await createImportedVideoProject(page, projectName, filename)

  await openDiscoverySearch(page, filename)

  const result = page.locator(
    '.discoveryResultHit[data-discovery-result-id^="local:clip:"]',
  )
  await expect(result).toHaveCount(1)
  await expect(result).toBeVisible()
  await expect(result).toHaveAttribute('aria-label', /双击预览视频/)
  await expect(result).toHaveAttribute('data-discovery-result-id', /^local:clip:/)
  await result.dblclick({ delay: 60 })

  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)
  await expect(
    page.getByRole('region', { name: `${filename} 帧环浏览` }),
  ).toBeVisible()
})

test('探索页剪辑动作进入现有帧环剪辑与导出流程', async ({ page }) => {
  test.setTimeout(60_000)
  const projectName = '探索剪辑联动项目'
  const filename = 'discovery-trim-intent.mp4'
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  await createImportedVideoProject(page, projectName, filename)
  await openDiscoverySearch(page, filename)

  const addButton = page
    .locator('.discoveryDetailActions')
    .getByRole('button', { name: '添加到项目' })
  await expect(addButton).toBeVisible()
  await addButton.click()
  await expect(
    page.getByRole('dialog', { name: `将 ${filename} 添加到项目` }),
  ).toBeVisible()
  await page.getByRole('button', { name: '关闭添加到项目' }).click()

  await page
    .locator('.discoveryDetailActions')
    .getByRole('button', { name: '剪辑片段' })
    .click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)
  await expect(page.locator('.frameRingView')).toHaveAttribute(
    'data-entry-intent',
    'trim',
  )
  await expect(page.locator('.frameRingView.isTrimMode')).toBeVisible()
  await expect(
    page.locator('.frameRingExportPanel[data-export-kind="video"]'),
  ).toBeVisible()
})

test('本地三维结果按可用能力排版，双击后进入现有三维查看页', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const projectName = '探索双击三维项目'
  const filename = 'discovery-double-click.glb'
  await page.emulateMedia({ reducedMotion: 'reduce' })
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

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入三维模型' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: filename,
    mimeType: 'model/gltf-binary',
    buffer: createEmptyGlb(),
  })
  await expect(page.locator('.modelAssetCard')).toHaveCount(1)

  await openDiscoverySearch(page, filename)
  const result = page.locator(
    '.discoveryResultHit[data-discovery-result-id^="local:model:"]',
  )
  await expect(result).toHaveCount(1)
  await expect(result).toBeVisible()
  await expect(result).toHaveAttribute('aria-label', /双击打开三维查看/)

  const actions = page.locator(
    '.discoveryDetailActions[data-action-layout="single"]',
  )
  const actionButton = actions.getByRole('button', { name: '打开三维查看' })
  await expect(actionButton).toBeVisible()
  const layout = await actions.evaluate((element) => {
    const button = element.querySelector('button')
    if (!(button instanceof HTMLButtonElement)) return null
    const actionsStyle = getComputedStyle(element)
    const buttonStyle = getComputedStyle(button)
    return {
      actionsWidth: Number.parseFloat(actionsStyle.width),
      buttonWidth: Number.parseFloat(buttonStyle.width),
      columnStart: buttonStyle.gridColumnStart,
      columnEnd: buttonStyle.gridColumnEnd,
      justifySelf: buttonStyle.justifySelf,
    }
  })
  expect(layout).not.toBeNull()
  expect(layout).toMatchObject({
    columnStart: '1',
    columnEnd: '-1',
    justifySelf: 'center',
  })
  expect(layout!.buttonWidth).toBeCloseTo((layout!.actionsWidth - 4) / 2, 1)

  await result.dblclick({ delay: 60 })
  await expect(page.locator('.auroraApp')).toHaveClass(/view-model-viewer/)
  await expect(
    page.getByRole('region', { name: `${filename} 三维查看` }),
  ).toBeVisible()
})
