import { expect, test } from '@playwright/test'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
)

test('OBJ 与同批 MTL/贴图会转为 GLB 运行资产并显示原始格式', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const projectName = 'OBJ 转换测试'
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

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入三维模型' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles([
    {
      name: 'painted-triangle.obj',
      mimeType: 'text/plain',
      buffer: Buffer.from([
        'mtllib painted-triangle.mtl',
        'o PaintedTriangle',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'vt 0 0',
        'vt 1 0',
        'vt 0 1',
        'vn 0 0 1',
        'usemtl Painted',
        'f 1/1/1 2/2/1 3/3/1',
      ].join('\n')),
    },
    {
      name: 'painted-triangle.mtl',
      mimeType: 'text/plain',
      buffer: Buffer.from('newmtl Painted\nKd 1 1 1\nmap_Kd albedo.png\n'),
    },
    {
      name: 'albedo.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    },
  ])

  await expect(page.locator('.modelAssetCard')).toHaveCount(1)
  await expect(page.locator('.modelAssetCard .clipBadge')).toHaveText('OBJ')
  const details = page.getByLabel('painted-triangle.obj 详情')
  await expect(details).toContainText('原始格式OBJ')
  await expect(details).toContainText('材质 / 贴图1 / 1')
  await expect(page.getByRole('status')).toContainText('已导入 1 个模型')
})

test('模型依赖按精确路径优先，重名 basename 不会串用', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const runtime = await import('/src/features/model-viewer/modelAssetRuntime.ts')
    const withPath = (file: File, relativePath: string) => {
      Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
      return file
    }
    const source = withPath(
      new File([
        'mtllib ../materials/shared.mtl\n' +
        'v 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Exact\nf 1 2 3\n',
      ], 'model.obj'),
      'package/models/model.obj',
    )
    const exact = withPath(
      new File(['newmtl Exact\nKd 1 0 0\n'], 'shared.mtl'),
      'package/materials/shared.mtl',
    )
    const conflictingBasename = withPath(
      new File(['newmtl Wrong\nKd 0 0 1\n'], 'shared.mtl'),
      'other/shared.mtl',
    )
    const normalized = await runtime.normalizeModelImport(source, [
      source,
      exact,
      conflictingBasename,
    ])
    return {
      converted: normalized.converted,
      runtimeName: normalized.runtimeFile.name,
    }
  })

  expect(result).toEqual({ converted: true, runtimeName: 'model.glb' })
})

test('模型依赖 basename 冲突和未选择的远程依赖会立即失败', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const runtime = await import('/src/features/model-viewer/modelAssetRuntime.ts')
    const withPath = (file: File, relativePath: string) => {
      Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
      return file
    }
    const conflictSource = withPath(
      new File(['mtllib shared.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'], 'model.obj'),
      'package/model.obj',
    )
    const first = withPath(
      new File(['newmtl One\n'], 'shared.mtl'),
      'first/shared.mtl',
    )
    const second = withPath(
      new File(['newmtl Two\n'], 'shared.mtl'),
      'second/shared.mtl',
    )
    let conflictMessage = ''
    try {
      await runtime.normalizeModelImport(conflictSource, [
        conflictSource,
        first,
        second,
      ])
    } catch (error) {
      conflictMessage = error instanceof Error ? error.message : String(error)
    }

    const remoteSource = new File([
      'mtllib remote.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Remote\nf 1 2 3\n',
    ], 'remote.obj')
    const remoteMtl = new File([
      'newmtl Remote\nmap_Kd https://assets.invalid.example/missing.png\n',
    ], 'remote.mtl')
    const startedAt = performance.now()
    let remoteMessage = ''
    try {
      await runtime.normalizeModelImport(remoteSource, [remoteSource, remoteMtl])
    } catch (error) {
      remoteMessage = error instanceof Error ? error.message : String(error)
    }
    const remoteElapsedMs = performance.now() - startedAt

    const corruptSource = new File([
      'mtllib corrupt.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Corrupt\nf 1 2 3\n',
    ], 'corrupt.obj')
    const corruptMtl = new File([
      'newmtl Corrupt\nmap_Kd corrupt.png\n',
    ], 'corrupt.mtl')
    const corruptTexture = new File(
      [new Uint8Array([0, 1, 2, 3, 4, 5])],
      'corrupt.png',
      { type: 'image/png' },
    )
    const corruptStartedAt = performance.now()
    let corruptMessage = ''
    try {
      await runtime.normalizeModelImport(corruptSource, [
        corruptSource,
        corruptMtl,
        corruptTexture,
      ])
    } catch (error) {
      corruptMessage = error instanceof Error ? error.message : String(error)
    }
    return {
      conflictMessage,
      remoteMessage,
      remoteElapsedMs,
      corruptMessage,
      corruptElapsedMs: performance.now() - corruptStartedAt,
    }
  })

  expect(result.conflictMessage).toContain('模型依赖文件名冲突')
  expect(result.remoteMessage).toContain('未在同一批次中选择模型依赖')
  expect(result.remoteElapsedMs).toBeLessThan(2_000)
  expect(result.corruptMessage).toContain('模型依赖加载失败')
  expect(result.corruptElapsedMs).toBeLessThan(2_000)
})

test('OBJ/FBX 主文件与 companion 合计受 500 MB 批次上限约束', async ({
  page,
}) => {
  await page.goto('/')
  const message = await page.evaluate(async () => {
    const runtime = await import('/src/features/model-viewer/modelAssetRuntime.ts')
    const source = {
      name: 'large.obj',
      size: 300 * 1024 * 1024,
      lastModified: 0,
    } as File
    const texture = {
      name: 'large-texture.png',
      size: 201 * 1024 * 1024,
      lastModified: 0,
    } as File
    try {
      await runtime.normalizeModelImport(source, [source, texture])
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })

  expect(message).toContain('同批依赖文件合计超过 500 MB')
})
