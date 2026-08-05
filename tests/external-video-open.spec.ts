import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  createExternalVideoOpenBroker,
  describeExternalVideoPath,
  isSupportedExternalVideoPath,
} = require('../electron/externalVideoOpen.cjs') as {
  createExternalVideoOpenBroker(options?: {
    describePath?: (filePath: string) => ExternalDescriptor | null
  }): ExternalVideoOpenBroker
  describeExternalVideoPath(
    filePath: string,
    statFile?: (filePath: string) => {
      isFile(): boolean
      size: number
      mtime: Date
    },
  ): ExternalDescriptor | null
  isSupportedExternalVideoPath(filePath: string): boolean
}

type ExternalDescriptor = {
  path: string
  name: string
  sizeBytes: number
  modifiedAt: string
}

type ExternalVideoOpenBroker = {
  enqueue(filePaths: string | string[]): ExternalDescriptor[]
  setConsumer(consumer: (batch: ExternalDescriptor[]) => void): boolean
  clearConsumer(consumer?: (batch: ExternalDescriptor[]) => void): void
  pendingCount(): number
}

const describePath = (filePath: string): ExternalDescriptor | null =>
  isSupportedExternalVideoPath(filePath)
    ? {
        path: filePath,
        name: path.basename(filePath),
        sizeBytes: 128,
        modifiedAt: '2026-08-03T00:00:00.000Z',
      }
    : null

async function enterAuroraFromStartupGate(page: Page) {
  await page.goto('/')
  const gate = page.getByRole('dialog', { name: 'Aurora 启动载入' })
  await expect(
    gate.getByRole('button', { name: '点击画面进入' }),
  ).toBeVisible({ timeout: 45_000 })
  await gate.click({ position: { x: 24, y: 24 } })
}

test('macOS 视频文件关联覆盖 Aurora 可接收的格式', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    build: {
      fileAssociations: Array<{
        ext: string[]
        role: string
        rank: string
      }>
    }
  }
  const association = packageJson.build.fileAssociations[0]
  expect(association.role).toBe('Viewer')
  expect(association.rank).toBe('Alternate')
  expect(association.ext).toEqual(
    expect.arrayContaining(['mov', 'mp4', 'mxf', 'mkv', 'webm']),
  )
})

test('冷启动文件会排队，renderer ready 后按原顺序一次交付', () => {
  const broker = createExternalVideoOpenBroker({ describePath })
  broker.enqueue(['/tmp/first.mov', '/tmp/second.mp4', '/tmp/first.mov'])
  expect(broker.pendingCount()).toBe(2)

  const deliveries: ExternalDescriptor[][] = []
  expect(broker.setConsumer((batch) => deliveries.push(batch))).toBe(true)
  expect(deliveries).toHaveLength(1)
  expect(deliveries[0].map((entry) => entry.name)).toEqual([
    'first.mov',
    'second.mp4',
  ])
  expect(broker.pendingCount()).toBe(0)
})

test('运行中 open-file 立即交付，发送失败则保留到 renderer 重连', () => {
  const broker = createExternalVideoOpenBroker({ describePath })
  const runningDeliveries: string[][] = []
  const runningConsumer = (batch: ExternalDescriptor[]) => {
    runningDeliveries.push(batch.map((entry) => entry.name))
  }
  broker.setConsumer(runningConsumer)
  broker.enqueue('/tmp/running.mkv')
  expect(runningDeliveries).toEqual([['running.mkv']])

  broker.setConsumer(() => {
    throw new Error('renderer reloading')
  })
  broker.enqueue('/tmp/retry.webm')
  expect(broker.pendingCount()).toBe(1)

  broker.setConsumer(runningConsumer)
  expect(runningDeliveries.at(-1)).toEqual(['retry.webm'])
  expect(broker.pendingCount()).toBe(0)
})

test('只接受存在的绝对视频文件并生成安全描述', () => {
  expect(isSupportedExternalVideoPath('/tmp/movie.mp4')).toBe(true)
  expect(isSupportedExternalVideoPath('/tmp/model.glb')).toBe(false)
  expect(isSupportedExternalVideoPath('relative/movie.mp4')).toBe(false)

  const descriptor = describeExternalVideoPath('/tmp/movie.mov', () => ({
    isFile: () => true,
    size: 4096,
    mtime: new Date('2026-08-03T08:00:00.000Z'),
  }))
  expect(descriptor).toEqual({
    path: '/tmp/movie.mov',
    name: 'movie.mov',
    sizeBytes: 4096,
    modifiedAt: '2026-08-03T08:00:00.000Z',
  })
})

test('外部视频先进入临时帧环预览，加入 Aurora 后复用项目弹框', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const descriptor = {
      path: '/tmp/finder-open-video.mp4',
      name: 'finder-open-video.mp4',
      sizeBytes: 1024,
      modifiedAt: '2026-08-03T08:00:00.000Z',
    }
    let externalListener:
      | ((files: typeof descriptor[]) => void)
      | null = null
    const bridge = {
      notifyStartupVisualReady() {},
      loadAppData: async () => null,
      saveAppData: async () => true,
      getMediaUrl: () => 'data:video/mp4;base64,AAAA',
      inspectMediaFile: async () => ({
        filePath: descriptor.path,
        filename: descriptor.name,
        durationSeconds: 12,
        sizeBytes: descriptor.sizeBytes,
        width: 1920,
        height: 1080,
        fps: 25,
        frameCount: 300,
        codec: 'h264',
        container: 'mov,mp4,m4a,3gp,3g2,mj2',
        capturedAt: null,
        modifiedAt: descriptor.modifiedAt,
      }),
      createMediaThumbnail: async (request: { assetId: string }) => ({
        assetId: request.assetId,
        sourcePath: descriptor.path,
        thumbnailPath:
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        sizeBytes: descriptor.sizeBytes,
        modifiedAt: descriptor.modifiedAt,
        cached: false,
        createdAt: descriptor.modifiedAt,
      }),
      createMediaOperationId: () => 'external-preview-operation',
      ensureMediaPreview: async () => ({
        operationId: 'external-preview-operation',
        cached: true,
        version: 1,
        assetId: 'external',
        sourcePath: descriptor.path,
        playbackPath: descriptor.path,
        usesPreviewProxy: false,
        metadata: null,
        createdAt: descriptor.modifiedAt,
      }),
      onExternalVideoFiles(listener: (files: typeof descriptor[]) => void) {
        externalListener = listener
        return () => {
          externalListener = null
        }
      },
      notifyExternalVideoFilesReady() {
        queueMicrotask(() => externalListener?.([descriptor]))
      },
    }
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: bridge,
    })
  })

  await enterAuroraFromStartupGate(page)

  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)
  await expect(
    page.getByRole('region', { name: 'finder-open-video.mp4 帧环浏览' }),
  ).toBeVisible()
  await expect(
    page.getByRole('slider', { name: '视频播放进度' }),
  ).toHaveAttribute(
    'max',
    '12',
  )
  await expect(
    page.getByText('尚未加入 Aurora', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('当前视频可以直接预览；加入 Aurora 后可以建立帧环。'),
  ).toBeVisible()
  await expect(
    page.getByRole('dialog', {
      name: '将 finder-open-video.mp4 添加到项目',
    }),
  ).toBeHidden()

  await page
    .getByRole('button', { name: '加入 Aurora', exact: true })
    .click()
  const addDialog = page.getByRole('dialog', {
    name: '将 finder-open-video.mp4 添加到项目',
  })
  await expect(addDialog).toBeVisible()
  await addDialog.getByRole('button', { name: '添加', exact: true }).click()

  await expect(addDialog).toBeHidden()
  await expect(
    page.getByText('尚未加入 Aurora', { exact: true }),
  ).toBeHidden()
  await expect(page.getByText('尚未建立帧环')).toBeVisible()
})

test('临时帧环预览中再收到外部视频会原地替换', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const descriptors = [
      {
        path: '/tmp/first-external-video.mp4',
        name: 'first-external-video.mp4',
        sizeBytes: 1024,
        modifiedAt: '2026-08-03T08:00:00.000Z',
      },
      {
        path: '/tmp/second-external-video.mov',
        name: 'second-external-video.mov',
        sizeBytes: 2048,
        modifiedAt: '2026-08-03T08:01:00.000Z',
      },
    ]
    type Descriptor = (typeof descriptors)[number]
    let externalListener: ((files: Descriptor[]) => void) | null = null
    const findDescriptor = (filePath: string) =>
      descriptors.find((entry) => entry.path === filePath) ?? descriptors[0]
    const bridge = {
      notifyStartupVisualReady() {},
      loadAppData: async () => null,
      saveAppData: async () => true,
      getMediaUrl: () => 'data:video/mp4;base64,AAAA',
      inspectMediaFile: async (filePath: string) => {
        const descriptor = findDescriptor(filePath)
        return {
          filePath: descriptor.path,
          filename: descriptor.name,
          durationSeconds: descriptor === descriptors[0] ? 12 : 24,
          sizeBytes: descriptor.sizeBytes,
          width: 1920,
          height: 1080,
          fps: 25,
          frameCount: descriptor === descriptors[0] ? 300 : 600,
          codec: 'h264',
          container: 'mov,mp4,m4a,3gp,3g2,mj2',
          capturedAt: null,
          modifiedAt: descriptor.modifiedAt,
        }
      },
      createMediaThumbnail: async (request: {
        assetId: string
        sourcePath: string
      }) => {
        const descriptor = findDescriptor(request.sourcePath)
        return {
          assetId: request.assetId,
          sourcePath: descriptor.path,
          thumbnailPath:
            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          sizeBytes: descriptor.sizeBytes,
          modifiedAt: descriptor.modifiedAt,
          cached: false,
          createdAt: descriptor.modifiedAt,
        }
      },
      createMediaOperationId: () => 'external-preview-operation',
      ensureMediaPreview: async (request: { sourcePath: string }) => ({
        operationId: 'external-preview-operation',
        cached: true,
        version: 1,
        assetId: 'external',
        sourcePath: request.sourcePath,
        playbackPath: request.sourcePath,
        usesPreviewProxy: false,
        metadata: null,
        createdAt: '2026-08-03T08:00:00.000Z',
      }),
      onExternalVideoFiles(listener: (files: Descriptor[]) => void) {
        externalListener = listener
        return () => {
          externalListener = null
        }
      },
      notifyExternalVideoFilesReady() {
        queueMicrotask(() => externalListener?.([descriptors[0]]))
      },
    }
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: bridge,
    })
    Object.defineProperty(window, '__emitExternalVideoFilesForTest', {
      configurable: true,
      value: (files: Descriptor[]) => externalListener?.(files),
    })
    Object.defineProperty(window, '__externalVideoDescriptorsForTest', {
      configurable: true,
      value: descriptors,
    })
  })

  await enterAuroraFromStartupGate(page)

  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)
  await expect(
    page.getByRole('region', { name: 'first-external-video.mp4 帧环浏览' }),
  ).toBeVisible()
  await expect(page.getByText('尚未加入 Aurora', { exact: true })).toBeVisible()

  await page.evaluate(() => {
    const testWindow = window as Window & {
      __emitExternalVideoFilesForTest(files: ExternalDescriptor[]): void
      __externalVideoDescriptorsForTest: ExternalDescriptor[]
    }
    testWindow.__emitExternalVideoFilesForTest([
      testWindow.__externalVideoDescriptorsForTest[1],
    ])
  })

  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)
  await expect(
    page.getByRole('region', { name: 'second-external-video.mov 帧环浏览' }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'first-external-video.mp4 帧环浏览' }),
  ).toBeHidden()
  await expect(page.getByText('尚未加入 Aurora', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '加入 Aurora', exact: true }),
  ).toBeVisible()
})

test('规范化路径命中已有项目引用时直接打开现有帧环', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const descriptor = {
      path: '/tmp/alias-to-existing-video.mp4',
      name: 'alias-to-existing-video.mp4',
      sizeBytes: 4096,
      modifiedAt: '2026-08-03T09:00:00.000Z',
    }
    const canonicalPath = '/media/library/existing-library-video.mp4'
    let externalListener:
      | ((files: typeof descriptor[]) => void)
      | null = null
    const bridge = {
      notifyStartupVisualReady() {},
      loadAppData: async () => ({
        library: {
          schemaVersion: 2,
          projects: [
            {
              id: 'glacier',
              kind: 'video',
              title: '冰川纪元',
              subtitle: 'Glacier Age',
              cover: './aurora/project-glacier-age.png',
              videoCount: 1,
              collectionCount: 0,
              updatedAt: '2026-08-03 17:00',
            },
          ],
          mediaAssets: [
            {
              id: 'asset-existing-library-video',
              filename: 'existing-library-video.mp4',
              thumbnail:
                'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
              duration: '00:18',
              resolution: '1920 x 1080',
              fps: '25 fps',
              frameCount: '450',
              sampleCount: 0,
              size: '4 KB',
              codec: 'H.264',
              camera: '未写入',
              capturedAt: '2026-08-03 17:00',
              sourceFingerprint: `local:${canonicalPath}:4096:2026-08-03T09:00:00.000Z`,
              sourcePath: canonicalPath,
              favorite: false,
              indexTask: 'idle',
              durationSeconds: 18,
              width: 1920,
              height: 1080,
              fpsValue: 25,
              sizeBytes: 4096,
              indexError: null,
            },
          ],
          projectAssetRefs: [
            {
              id: 'glacier:ref:asset-existing-library-video',
              projectId: 'glacier',
              assetId: 'asset-existing-library-video',
              order: 0,
              thumbnailFollowsProject: false,
              tags: ['已归档'],
              annotated: false,
              note: '这是已加入 Aurora 项目的素材。',
            },
          ],
          visualIndexes: [],
          frameAnnotations: [],
          modelAssets: [],
          projectTitles: { glacier: '冰川纪元' },
          selectedProjectId: 'glacier',
        },
      }),
      saveAppData: async () => true,
      getMediaUrl: () => 'data:video/mp4;base64,AAAA',
      inspectMediaFile: async () => ({
        filePath: canonicalPath,
        filename: 'existing-library-video.mp4',
        durationSeconds: 18,
        sizeBytes: descriptor.sizeBytes,
        width: 1920,
        height: 1080,
        fps: 25,
        frameCount: 450,
        codec: 'h264',
        container: 'mov,mp4,m4a,3gp,3g2,mj2',
        capturedAt: null,
        modifiedAt: descriptor.modifiedAt,
      }),
      createMediaThumbnail: async (request: { assetId: string }) => ({
        assetId: request.assetId,
        sourcePath: canonicalPath,
        thumbnailPath:
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        sizeBytes: descriptor.sizeBytes,
        modifiedAt: descriptor.modifiedAt,
        cached: true,
        createdAt: descriptor.modifiedAt,
      }),
      createMediaOperationId: () => 'existing-preview-operation',
      ensureMediaPreview: async () => ({
        operationId: 'existing-preview-operation',
        cached: true,
        version: 1,
        assetId: 'asset-existing-library-video',
        sourcePath: canonicalPath,
        playbackPath: canonicalPath,
        usesPreviewProxy: false,
        metadata: null,
        createdAt: descriptor.modifiedAt,
      }),
      onExternalVideoFiles(listener: (files: typeof descriptor[]) => void) {
        externalListener = listener
        return () => {
          externalListener = null
        }
      },
      notifyExternalVideoFilesReady() {
        queueMicrotask(() => externalListener?.([descriptor]))
      },
    }
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: bridge,
    })
  })

  await enterAuroraFromStartupGate(page)

  await expect(page.locator('.auroraApp')).toHaveClass(/view-frame-ring/)
  const existingFrameRing = page.getByRole('region', {
    name: 'existing-library-video.mp4 帧环浏览',
  })
  await expect(existingFrameRing).toBeVisible()
  await expect(
    existingFrameRing.getByRole('button', { name: '冰川纪元', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('尚未加入 Aurora', { exact: true })).toBeHidden()
  await expect(
    page.getByRole('button', { name: '加入 Aurora', exact: true }),
  ).toBeHidden()
  await expect(
    page.getByRole('dialog', {
      name: '将 existing-library-video.mp4 添加到项目',
    }),
  ).toBeHidden()
})
