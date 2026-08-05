import { expect, test } from '@playwright/test'
import {
  LIBRARY_SCHEMA_VERSION,
  parsePersistentLibrary,
  serializePersistentLibrary,
} from '../src/data/libraryPersistence'
import {
  MEDIA_VISUAL_INDEX_VERSION,
  type FrameAnnotation,
  type MediaAsset,
  type MediaVisualIndex,
} from '../src/data/mediaLibraryTypes'
import { isOnlineMediaAsset } from '../src/data/mediaLibrarySelectors'
import {
  mergeDefaultProjects,
  projects as defaultProjects,
} from '../src/data/projects'
import { resolveDocumentAssetUrl } from '../src/documentAssetUrl'

test('无封面空项目可持久化并在重启后恢复', () => {
  const project = {
    id: 'empty-project',
    title: '空白项目',
    subtitle: '',
    description: '这个描述会随项目一起保存。',
    cover: '',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2026-07-29 13:00',
  }
  const serialized = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [],
    projectAssetRefs: [],
    projectTitles: { [project.id]: project.title },
    selectedProjectId: project.id,
  })

  const restored = parsePersistentLibrary({ library: serialized })

  expect(restored?.projects).toEqual([project])
  expect(restored?.selectedProjectId).toBe(project.id)
  expect(restored?.visualIndexes).toEqual([])
  expect(restored?.frameAnnotations).toEqual([])
  expect(restored?.projectCovers).toEqual({})
})

test('schema v4 自定义项目封面可跨平台 roundtrip', () => {
  const projects = [
    {
      id: 'cover-posix',
      title: 'POSIX 封面',
      subtitle: '',
      cover: '',
      videoCount: 0,
      collectionCount: 0,
      updatedAt: '2026-08-03 10:00',
    },
    {
      id: 'cover-windows',
      title: 'Windows 封面',
      subtitle: '',
      cover: '',
      videoCount: 0,
      collectionCount: 0,
      updatedAt: '2026-08-03 10:01',
    },
    {
      id: 'cover-unc',
      title: 'UNC 封面',
      subtitle: '',
      cover: '',
      videoCount: 0,
      collectionCount: 0,
      updatedAt: '2026-08-03 10:02',
    },
  ]
  const projectCovers = {
    'cover-posix': {
      name: 'ice-valley.png',
      managedPath:
        '/Users/apple/Library/Application Support/Aurora/covers/ice-valley.png',
    },
    'cover-windows': {
      name: 'ring.png',
      managedPath: 'C:\\Users\\Aurora\\covers\\ring.png',
    },
    'cover-unc': {
      name: 'forest.png',
      managedPath: '\\\\media-server\\Aurora\\covers\\forest.png',
    },
  }
  const serialized = serializePersistentLibrary({
    projects,
    mediaAssets: [],
    projectAssetRefs: [],
    projectTitles: {},
    projectCovers,
    selectedProjectId: projects[0].id,
  })

  expect(serialized.schemaVersion).toBe(LIBRARY_SCHEMA_VERSION)
  expect(serialized.projectCovers).toEqual(projectCovers)
  expect(parsePersistentLibrary({ library: serialized })?.projectCovers).toEqual(
    projectCovers,
  )
})

test('schema v2 迁移到 v4 时自定义项目封面默认为空', () => {
  const project = {
    id: 'v2-cover-project',
    title: '旧版项目',
    subtitle: '',
    cover: '',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2026-08-03 10:03',
  }
  const currentLibrary = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [],
    projectAssetRefs: [],
    projectTitles: {},
    selectedProjectId: project.id,
  })
  const restored = parsePersistentLibrary({
    library: {
      ...currentLibrary,
      schemaVersion: 2,
      projectCovers: {
        [project.id]: {
          name: 'must-not-leak.png',
          managedPath: '/managed/must-not-leak.png',
        },
      },
    },
  })

  expect(restored?.schemaVersion).toBe(LIBRARY_SCHEMA_VERSION)
  expect(restored?.projectCovers).toEqual({})
})

test('schema v4 过滤非法与孤儿项目封面', () => {
  const projectIds = [
    'valid-project',
    'relative-path-project',
    'drive-relative-project',
    'empty-name-project',
    'long-name-project',
    'bad-record-project',
  ]
  const projects = projectIds.map((id, index) => ({
    id,
    title: id,
    subtitle: '',
    cover: '',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: `2026-08-03 10:${10 + index}`,
  }))
  const baseLibrary = serializePersistentLibrary({
    projects,
    mediaAssets: [],
    projectAssetRefs: [],
    projectTitles: {},
    selectedProjectId: projects[0].id,
  })
  const restored = parsePersistentLibrary({
    library: {
      ...baseLibrary,
      projectCovers: {
        'valid-project': {
          name: '  valid.png  ',
          managedPath: '/managed/covers/valid.png',
        },
        'orphan-project': {
          name: 'orphan.png',
          managedPath: '/managed/covers/orphan.png',
        },
        'relative-path-project': {
          name: 'relative.png',
          managedPath: 'managed/covers/relative.png',
        },
        'drive-relative-project': {
          name: 'drive-relative.png',
          managedPath: 'C:managed\\covers\\drive-relative.png',
        },
        'empty-name-project': {
          name: '   ',
          managedPath: '/managed/covers/empty-name.png',
        },
        'long-name-project': {
          name: `${'x'.repeat(256)}.png`,
          managedPath: '/managed/covers/long-name.png',
        },
        'bad-record-project': 'not-an-object',
      },
    },
  })

  expect(restored?.projectCovers).toEqual({
    'valid-project': {
      name: 'valid.png',
      managedPath: '/managed/covers/valid.png',
    },
  })

  const serialized = serializePersistentLibrary({
    projects: [projects[0]],
    mediaAssets: [],
    projectAssetRefs: [],
    projectTitles: {},
    projectCovers: {
      'valid-project': {
        name: 'valid.png',
        managedPath: '/managed/covers/valid.png',
      },
      'orphan-project': {
        name: 'orphan.png',
        managedPath: '/managed/covers/orphan.png',
      },
    },
    selectedProjectId: projects[0].id,
  })
  expect(serialized.projectCovers).toEqual({
    'valid-project': {
      name: 'valid.png',
      managedPath: '/managed/covers/valid.png',
    },
  })
})

test('三维项目与模型资产可完整持久化并恢复视角', () => {
  const project = {
    id: 'model-project',
    kind: '3d' as const,
    title: '三维项目',
    subtitle: 'Model Project',
    cover: '',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2026-08-01 21:00',
  }
  const model = {
    id: 'model-one',
    projectId: project.id,
    filename: 'aurora.glb',
    format: 'glb' as const,
    sourcePath: '/managed/model-one.glb',
    sizeBytes: 1024,
    importedAt: '2026-08-01 21:01',
    thumbnail: 'data:image/webp;base64,preview',
    favorite: true,
    tags: ['标志'],
    note: '保留银色材质版本。',
    vertexCount: 120,
    triangleCount: 80,
    nodeCount: 4,
    materialCount: 2,
    textureCount: 1,
    dimensions: { x: 1, y: 2, z: 3 },
    camera: {
      position: [4, 5, 6] as [number, number, number],
      target: [0, 1, 0] as [number, number, number],
    },
    environmentPresetId: 'city-night' as const,
  }
  const convertedModel = {
    ...model,
    id: 'model-from-obj',
    filename: 'aurora.obj',
    format: 'obj' as const,
    // The original format is metadata; the durable viewer source stays GLB.
    sourcePath: '/managed/model-from-obj.glb',
  }
  const serialized = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [],
    modelAssets: [model, convertedModel],
    projectAssetRefs: [],
    projectTitles: { [project.id]: project.title },
    selectedProjectId: project.id,
  })

  const restored = parsePersistentLibrary({ library: serialized })

  expect(restored?.projects).toEqual([project])
  expect(restored?.modelAssets).toEqual([model, convertedModel])

  const { favorite: _favorite, ...legacyModel } = model
  const restoredLegacyModel = parsePersistentLibrary({
    library: {
      ...serialized,
      modelAssets: [legacyModel],
    },
  })
  expect(restoredLegacyModel?.modelAssets[0].favorite).toBe(false)
})

test('保存时按项目引用重算视频数，不持久化漂移计数', () => {
  const project = {
    id: 'counted-project',
    title: '权威计数',
    subtitle: '',
    cover: '',
    videoCount: 99,
    collectionCount: 0,
    updatedAt: '2026-07-30 12:00',
  }
  const serialized = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [],
    projectAssetRefs: [
      {
        id: 'ref-one',
        projectId: project.id,
        assetId: 'asset-one',
        order: 0,
        thumbnailFollowsProject: true,
        tags: [],
        annotated: false,
        note: '',
      },
      {
        id: 'ref-two',
        projectId: project.id,
        assetId: 'asset-two',
        order: 1,
        thumbnailFollowsProject: true,
        tags: [],
        annotated: false,
        note: '',
      },
    ],
    projectTitles: { [project.id]: project.title },
    selectedProjectId: project.id,
  })

  expect(serialized.projects[0].videoCount).toBe(2)
})

test('空封面不会被解析为当前文档地址', () => {
  expect(resolveDocumentAssetUrl('', 'file:///Aurora/dist/index.html')).toBe('')
})

test('删除项目后只移除其引用并保留共享素材资产', () => {
  const remainingProject = {
    id: 'remaining-project',
    title: '保留项目',
    subtitle: '',
    cover: '',
    videoCount: 1,
    collectionCount: 0,
    updatedAt: '2026-07-29 15:00',
  }
  const sharedAsset = {
    id: 'shared-asset',
    filename: 'A001_C001.mov',
    thumbnail: null,
    duration: '00:12',
    resolution: '3840 × 2160',
    fps: '24 fps',
    frameCount: '288',
    sampleCount: 0,
    size: '120 MB',
    codec: 'ProRes 422 HQ',
    camera: '未知设备',
    capturedAt: '2026-07-29 15:00',
    sourceFingerprint: 'shared-source',
    sourcePath: '/Volumes/Media/A001_C001.mov',
    favorite: false,
    indexTask: 'idle' as const,
    durationSeconds: 12,
    width: 3840,
    height: 2160,
    fpsValue: 24,
    sizeBytes: 120 * 1024 ** 2,
    indexError: null,
  }
  const remainingReference = {
    id: 'remaining-reference',
    projectId: remainingProject.id,
    assetId: sharedAsset.id,
    order: 0,
    thumbnailFollowsProject: true,
    tags: ['测试'],
    annotated: false,
    note: '',
  }
  const serialized = serializePersistentLibrary({
    projects: [remainingProject],
    mediaAssets: [sharedAsset],
    projectAssetRefs: [remainingReference],
    projectTitles: {
      [remainingProject.id]: remainingProject.title,
    },
    selectedProjectId: remainingProject.id,
  })

  const restored = parsePersistentLibrary({ library: serialized })

  expect(restored?.mediaAssets).toEqual([sharedAsset])
  expect(restored?.projectAssetRefs).toEqual([remainingReference])
  expect(restored?.projects[0].videoCount).toBe(1)
})

test('旧演示素材迁移时只删除 mock 数据并保留真实素材索引', () => {
  const project = { ...defaultProjects[2] }
  const mockAsset: MediaAsset = {
    id: 'asset:mock:ring-A001_C012.mov',
    filename: 'A001_C012.mov',
    thumbnail: './aurora/project-ring-of-horizon.png',
    duration: '02:14',
    resolution: '3840 × 2160',
    fps: '24 fps',
    frameCount: '3216',
    sampleCount: 0,
    size: '12.8 GB',
    codec: 'ProRes 4444',
    camera: 'ARRI Alexa 35',
    capturedAt: '2024-05-12 14:35',
    sourceFingerprint: 'mock:ring-A001_C012.mov',
    sourcePath: null,
    favorite: false,
    indexTask: 'idle',
    durationSeconds: null,
    width: null,
    height: null,
    fpsValue: null,
    sizeBytes: null,
    indexError: null,
  }
  const realAsset: MediaAsset = {
    ...mockAsset,
    id: 'asset:real:first-shot',
    filename: 'first-shot.mp4',
    thumbnail: '/managed/first-shot/poster.jpg',
    duration: '00:10',
    resolution: '1920 × 1080',
    frameCount: '240',
    sampleCount: 1,
    size: '20 MB',
    codec: 'H.264',
    camera: '未知设备',
    capturedAt: '2026-08-02 16:30',
    sourceFingerprint: 'local:/Volumes/Media/first-shot.mp4:20971520',
    sourcePath: '/Volumes/Media/first-shot.mp4',
    durationSeconds: 10,
    width: 1920,
    height: 1080,
    fpsValue: 24,
    sizeBytes: 20 * 1024 ** 2,
  }
  const mockReference = {
    id: 'ref:mock',
    projectId: project.id,
    assetId: mockAsset.id,
    order: 0,
    thumbnailFollowsProject: false,
    tags: ['演示'],
    annotated: false,
    note: '',
  }
  const realReference = {
    ...mockReference,
    id: 'ref:real',
    assetId: realAsset.id,
    order: 1,
    tags: ['真实素材'],
  }
  const visualIndex: MediaVisualIndex = {
    assetId: realAsset.id,
    sourceFingerprint: realAsset.sourceFingerprint,
    createdAt: '2026-08-02T08:30:00.000Z',
    version: MEDIA_VISUAL_INDEX_VERSION,
    posterPath: '/managed/first-shot/poster.jpg',
    previewPath: '/managed/first-shot/preview.mp4',
    frames: [
      {
        id: 'frame-real-0',
        index: 0,
        timeSeconds: 0,
        imagePath: '/managed/first-shot/frames/000000.jpg',
      },
    ],
  }
  const annotation: FrameAnnotation = {
    assetId: realAsset.id,
    frameId: 'frame-real-0',
    favorite: true,
    rating: 5,
    tags: ['保留'],
    note: '真实标注',
  }
  const serialized = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [mockAsset, realAsset],
    projectAssetRefs: [mockReference, realReference],
    visualIndexes: [visualIndex],
    frameAnnotations: [annotation],
    projectTitles: { [project.id]: project.title },
    selectedProjectId: project.id,
  })

  const restored = parsePersistentLibrary({ library: serialized })

  expect(restored?.mediaAssets).toEqual([realAsset])
  expect(restored?.projectAssetRefs).toEqual([realReference])
  expect(restored?.visualIndexes).toEqual([visualIndex])
  expect(restored?.frameAnnotations).toEqual([annotation])
  expect(restored?.projects[0].videoCount).toBe(1)
})

test('恢复时固定补齐五个默认封面项目并保留用户项目', () => {
  const renamedDefault = {
    ...defaultProjects[2],
    title: '用户改名后的极境',
    cover: '',
    collectionCount: 24,
  }
  const userProject = {
    id: 'user-project',
    title: '用户项目',
    subtitle: '',
    cover: '',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2026-08-02 16:30',
  }

  const restored = mergeDefaultProjects([renamedDefault, userProject])

  expect(restored.slice(0, 5).map((project) => project.id)).toEqual(
    defaultProjects.map((project) => project.id),
  )
  expect(restored.slice(0, 5).map((project) => project.cover)).toEqual(
    defaultProjects.map((project) => project.cover),
  )
  expect(restored.slice(0, 5).every((project) =>
    project.collectionCount === 0,
  )).toBe(true)
  expect(restored[2].title).toBe(renamedDefault.title)
  expect(restored[5]).toEqual(userProject)
})

test('schema v1 媒体库迁移到 v4 并清除无索引的旧抽帧计数', () => {
  const project = {
    id: 'legacy-project',
    title: '旧项目',
    subtitle: 'Legacy Project',
    cover: '',
    videoCount: 99,
    collectionCount: 2,
    updatedAt: '2026-07-29 16:00',
  }
  const legacyAsset = {
    id: 'legacy-asset',
    filename: 'A001_C002.mov',
    thumbnail: null,
    duration: '01:02:03',
    resolution: '3840 × 2160',
    fps: '23.976 fps',
    frameCount: '89235',
    sampleCount: 96,
    size: '120 MB',
    codec: 'ProRes 422 HQ',
    camera: 'ARRI Alexa 35',
    capturedAt: '2026-07-29 16:00',
    sourceFingerprint: 'local:/Volumes/Media/A001_C002.mov',
    sourcePath: '/Volumes/Media/A001_C002.mov',
    favorite: true,
    indexTask: 'build-queued',
  }
  const reference = {
    id: 'legacy-ref',
    projectId: project.id,
    assetId: legacyAsset.id,
    order: 0,
    thumbnailFollowsProject: true,
    tags: ['旧素材'],
    annotated: true,
    note: '旧备注',
  }

  const restored = parsePersistentLibrary({
    library: {
      schemaVersion: 1,
      projects: [project],
      mediaAssets: [legacyAsset],
      projectAssetRefs: [reference],
      projectTitles: { [project.id]: '旧项目自定义名称' },
      selectedProjectId: project.id,
    },
  })

  expect(restored).not.toBeNull()
  expect(restored?.schemaVersion).toBe(LIBRARY_SCHEMA_VERSION)
  expect(restored?.projects).toEqual([{ ...project, videoCount: 1 }])
  expect(restored?.projectAssetRefs).toEqual([reference])
  expect(restored?.projectTitles).toEqual({
    [project.id]: '旧项目自定义名称',
  })
  expect(restored?.mediaAssets).toEqual([
    {
      ...legacyAsset,
      sampleCount: 0,
      durationSeconds: 3723,
      width: 3840,
      height: 2160,
      fpsValue: 23.976,
      sizeBytes: 120 * 1024 ** 2,
      indexError: '视觉索引数据缺失，请重新建立。',
    },
  ])
  expect(restored?.visualIndexes).toEqual([])
  expect(restored?.frameAnnotations).toEqual([])
  expect(restored?.projectCovers).toEqual({})
})

test('真实素材的索引帧数只由当前有效视觉索引决定', () => {
  const project = {
    id: 'index-count-project',
    title: '索引计数项目',
    subtitle: '',
    cover: '',
    videoCount: 1,
    collectionCount: 0,
    updatedAt: '2026-07-30 18:00',
  }
  const asset: MediaAsset = {
    id: 'index-count-asset',
    filename: 'count.mp4',
    thumbnail: '/managed/count/thumbnail.jpg',
    duration: '00:10',
    resolution: '1920 x 1080',
    fps: '24 fps',
    frameCount: '240',
    sampleCount: 96,
    size: '10 MB',
    codec: 'H.264',
    camera: '未写入',
    capturedAt: '2026-07-30 18:00',
    sourceFingerprint: 'local:/Volumes/Media/count.mp4:10485760',
    sourcePath: '/Volumes/Media/count.mp4',
    favorite: false,
    indexTask: 'idle',
    durationSeconds: 10,
    width: 1920,
    height: 1080,
    fpsValue: 24,
    sizeBytes: 10 * 1024 ** 2,
    indexError: null,
  }
  const reference = {
    id: 'index-count-reference',
    projectId: project.id,
    assetId: asset.id,
    order: 0,
    thumbnailFollowsProject: false,
    tags: [],
    annotated: false,
    note: '',
  }
  const visualIndex: MediaVisualIndex = {
    assetId: asset.id,
    sourceFingerprint: asset.sourceFingerprint,
    createdAt: '2026-07-30T10:00:00.000Z',
    version: MEDIA_VISUAL_INDEX_VERSION,
    posterPath: '/managed/count/poster.jpg',
    previewPath: null,
    frames: [
      {
        id: 'count-frame-0',
        index: 0,
        timeSeconds: 0,
        imagePath: '/managed/count/000000.jpg',
      },
      {
        id: 'count-frame-1',
        index: 1,
        timeSeconds: 5,
        imagePath: '/managed/count/000001.jpg',
      },
    ],
  }
  const baseLibrary = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [asset],
    projectAssetRefs: [reference],
    visualIndexes: [visualIndex],
    frameAnnotations: [],
    projectTitles: {},
    selectedProjectId: project.id,
  })

  const indexed = parsePersistentLibrary({ library: baseLibrary })
  expect(indexed?.mediaAssets[0].sampleCount).toBe(2)
  expect(indexed?.visualIndexes[0].frames).toHaveLength(2)

  const missing = parsePersistentLibrary({
    library: { ...baseLibrary, visualIndexes: [] },
  })
  expect(missing?.mediaAssets[0]).toMatchObject({
    sampleCount: 0,
    indexError: '视觉索引数据缺失，请重新建立。',
  })

  const empty = parsePersistentLibrary({
    library: {
      ...baseLibrary,
      visualIndexes: [{ ...visualIndex, frames: [] }],
    },
  })
  expect(empty?.visualIndexes).toEqual([])
  expect(empty?.mediaAssets[0].sampleCount).toBe(0)

  const staleFingerprint = parsePersistentLibrary({
    library: {
      ...baseLibrary,
      visualIndexes: [
        {
          ...visualIndex,
          sourceFingerprint: 'local:/Volumes/Media/replaced.mp4:10485760',
        },
      ],
    },
  })
  expect(staleFingerprint?.visualIndexes).toEqual([])
  expect(staleFingerprint?.mediaAssets[0].sampleCount).toBe(0)
})

test('schema v4 可完整 roundtrip 且保留视觉索引的绝对受管路径', () => {
  const project = {
    id: 'indexed-project',
    title: '索引项目',
    subtitle: '',
    cover: '',
    videoCount: 1,
    collectionCount: 0,
    updatedAt: '2026-07-29 17:00',
  }
  const asset: MediaAsset = {
    id: 'indexed-asset',
    filename: 'A001_C003.mov',
    thumbnail: null,
    duration: '00:10',
    resolution: '1920 × 1080',
    fps: '25 fps',
    frameCount: '250',
    sampleCount: 2,
    size: '20 MB',
    codec: 'H.264',
    camera: '未知设备',
    capturedAt: '2026-07-29 17:00',
    sourceFingerprint: 'local:/Volumes/Media/A001_C003.mov:20',
    sourcePath: '/Volumes/Media/A001_C003.mov',
    favorite: false,
    indexTask: 'failed',
    durationSeconds: 10,
    width: 1920,
    height: 1080,
    fpsValue: 25,
    sizeBytes: 20 * 1024 ** 2,
    indexError: '上一次索引被中断',
  }
  const reference = {
    id: 'indexed-reference',
    projectId: project.id,
    assetId: asset.id,
    order: 0,
    thumbnailFollowsProject: true,
    tags: ['测试'],
    annotated: true,
    note: '',
  }
  const visualIndex: MediaVisualIndex = {
    assetId: asset.id,
    sourceFingerprint: asset.sourceFingerprint,
    createdAt: '2026-07-29T09:00:00.000Z',
    version: MEDIA_VISUAL_INDEX_VERSION,
    posterPath:
      '/Users/apple/Library/Application Support/Aurora/indexes/indexed-asset/poster.jpg',
    previewPath: null,
    frames: [
      {
        id: 'frame-0',
        index: 0,
        timeSeconds: 0,
        imagePath:
          '/Users/apple/Library/Application Support/Aurora/indexes/indexed-asset/frames/000000.jpg',
      },
      {
        id: 'frame-1',
        index: 1,
        timeSeconds: 5.5,
        imagePath:
          '/Users/apple/Library/Application Support/Aurora/indexes/indexed-asset/frames/000001.jpg',
      },
    ],
  }
  const annotation: FrameAnnotation = {
    assetId: asset.id,
    frameId: 'frame-1',
    favorite: true,
    rating: 4,
    tags: ['逆光', '人物'],
    note: '保留这一帧',
  }

  const serialized = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [asset],
    projectAssetRefs: [reference],
    visualIndexes: [visualIndex],
    frameAnnotations: [annotation],
    projectTitles: { [project.id]: project.title },
    selectedProjectId: project.id,
  })
  const restored = parsePersistentLibrary({ library: serialized })

  expect(serialized.schemaVersion).toBe(LIBRARY_SCHEMA_VERSION)
  expect(serialized.visualIndexes[0].posterPath).toBe(visualIndex.posterPath)
  expect(serialized.visualIndexes[0].frames[0].imagePath).toBe(
    visualIndex.frames[0].imagePath,
  )
  expect(restored).toEqual(serialized)

  const staleIndexLibrary = {
    ...serialized,
    visualIndexes: serialized.visualIndexes.map((index) => ({
      ...index,
      version: MEDIA_VISUAL_INDEX_VERSION - 1,
    })),
  }
  const staleIndexRestored = parsePersistentLibrary({
    library: staleIndexLibrary,
  })
  expect(staleIndexRestored?.visualIndexes).toEqual([])
  expect(staleIndexRestored?.frameAnnotations).toEqual([])
  expect(staleIndexRestored?.mediaAssets[0]).toMatchObject({
    sampleCount: 0,
    thumbnail: null,
    indexTask: 'idle',
    indexError: '视觉索引版本已更新，请重新建立。',
  })
})

test('schema v4 过滤失效外键、坏帧、重复帧与坏标注', () => {
  const project = {
    id: 'strict-project',
    title: '严格校验',
    subtitle: '',
    cover: '',
    videoCount: 1,
    collectionCount: 0,
    updatedAt: '2026-07-29 18:00',
  }
  const asset: MediaAsset = {
    id: 'strict-asset',
    filename: 'strict.mov',
    thumbnail: null,
    duration: '00:08',
    resolution: '1920 x 1080',
    fps: '24 fps',
    frameCount: '192',
    sampleCount: 1,
    size: '10 MB',
    codec: 'H.264',
    camera: '未知设备',
    capturedAt: '2026-07-29 18:00',
    sourceFingerprint: 'strict-source',
    sourcePath: '/Volumes/Media/strict.mov',
    favorite: false,
    indexTask: 'building',
    durationSeconds: 8,
    width: 1920,
    height: 1080,
    fpsValue: 24,
    sizeBytes: 10 * 1024 ** 2,
    indexError: null,
  }
  const validFrame = {
    id: 'valid-frame',
    index: 0,
    timeSeconds: 2,
    imagePath: '/managed/strict/000000.jpg',
  }
  const library = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [asset],
    projectAssetRefs: [
      {
        id: 'valid-ref',
        projectId: project.id,
        assetId: asset.id,
        order: 0,
        thumbnailFollowsProject: true,
        tags: [],
        annotated: false,
        note: '',
      },
      {
        id: 'orphan-ref',
        projectId: 'missing-project',
        assetId: asset.id,
        order: 1,
        thumbnailFollowsProject: true,
        tags: [],
        annotated: false,
        note: '',
      },
    ],
    visualIndexes: [
      {
        assetId: asset.id,
        sourceFingerprint: asset.sourceFingerprint,
        createdAt: '2026-07-29T10:00:00.000Z',
        version: MEDIA_VISUAL_INDEX_VERSION,
        posterPath: '/managed/strict/poster.jpg',
        previewPath: null,
        frames: [
          validFrame,
          { ...validFrame, index: 1 },
          {
            id: 'duplicate-index',
            index: 0,
            timeSeconds: 3,
            imagePath: '/managed/strict/duplicate-index.jpg',
          },
          {
            id: 'past-duration',
            index: 3,
            timeSeconds: 9,
            imagePath: '/managed/strict/past-duration.jpg',
          },
          {
            id: 'negative-time',
            index: 4,
            timeSeconds: -1,
            imagePath: '/managed/strict/negative-time.jpg',
          },
        ],
      },
      {
        assetId: asset.id,
        sourceFingerprint: 'stale-fingerprint',
        createdAt: '2026-07-29T10:00:00.000Z',
        version: MEDIA_VISUAL_INDEX_VERSION,
        posterPath: '/managed/stale/poster.jpg',
        previewPath: null,
        frames: [],
      },
    ],
    frameAnnotations: [
      {
        assetId: asset.id,
        frameId: validFrame.id,
        favorite: true,
        rating: 5,
        tags: ['保留'],
        note: '',
      },
      {
        assetId: asset.id,
        frameId: 'missing-frame',
        favorite: false,
        rating: 0,
        tags: [],
        note: '',
      },
      {
        assetId: asset.id,
        frameId: validFrame.id,
        favorite: false,
        rating: 7,
        tags: [],
        note: '',
      },
    ],
    projectTitles: {},
    selectedProjectId: project.id,
  })

  const restored = parsePersistentLibrary({ library })

  expect(restored?.projectAssetRefs).toHaveLength(1)
  expect(restored?.visualIndexes).toHaveLength(1)
  expect(restored?.visualIndexes[0].frames).toEqual([validFrame])
  expect(restored?.frameAnnotations).toEqual([
    {
      assetId: asset.id,
      frameId: validFrame.id,
      favorite: true,
      rating: 5,
      tags: ['保留'],
      note: '',
    },
  ])
})

test('schema v3 媒体库迁移到 v4 并保留 v3 封面', () => {
  const project = {
    id: 'v3-online-migration-project',
    title: '旧版媒体库',
    subtitle: '',
    cover: '',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2026-08-04 10:00',
  }
  const legacyAsset: MediaAsset = {
    id: 'v3-local-asset',
    filename: 'legacy.mp4',
    thumbnail: '/managed/legacy/poster.jpg',
    duration: '00:10',
    resolution: '1920 x 1080',
    fps: '25 fps',
    frameCount: '250',
    sampleCount: 0,
    size: '12 MB',
    codec: 'H.264',
    camera: '未写入',
    capturedAt: '2026-08-04 10:00',
    sourceFingerprint: 'local:/Volumes/Media/legacy.mp4',
    sourcePath: '/Volumes/Media/legacy.mp4',
    favorite: false,
    indexTask: 'idle',
    durationSeconds: 10,
    width: 1920,
    height: 1080,
    fpsValue: 25,
    sizeBytes: 12 * 1024 ** 2,
    indexError: null,
  }
  const current = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [legacyAsset],
    projectAssetRefs: [],
    projectTitles: {},
    projectCovers: {
      [project.id]: {
        name: 'legacy-cover.png',
        managedPath: '/managed/covers/legacy-cover.png',
      },
    },
    selectedProjectId: project.id,
  })

  const restored = parsePersistentLibrary({
    library: { ...current, schemaVersion: 3 },
  })

  expect(restored?.schemaVersion).toBe(4)
  expect(restored?.mediaAssets).toEqual([legacyAsset])
  expect(restored?.mediaAssets[0].online).toBeUndefined()
  expect(restored?.projectCovers).toEqual(current.projectCovers)
})

test('在线 B 站素材描述可完整 roundtrip', () => {
  const project = {
    id: 'online-roundtrip-project',
    title: '在线素材',
    subtitle: '',
    cover: '',
    videoCount: 1,
    collectionCount: 0,
    updatedAt: '2026-08-04 10:10',
  }
  const asset: MediaAsset = {
    id: 'online:bilibili:BV1xx411c7mD',
    filename: '在线视频',
    thumbnail:
      '/Users/apple/Library/Application Support/Aurora/online-media/BV1xx411c7mD/poster.jpg',
    duration: '01:20',
    resolution: '1920 x 1080',
    fps: '30 fps',
    frameCount: '2400',
    sampleCount: 0,
    size: '在线',
    codec: 'H.264',
    camera: '未写入',
    capturedAt: '未写入',
    sourceFingerprint: 'mock:bilibili:BV1xx411c7mD',
    sourcePath: null,
    favorite: false,
    indexTask: 'idle',
    durationSeconds: 80,
    width: 1920,
    height: 1080,
    fpsValue: 30,
    sizeBytes: null,
    indexError: null,
    online: {
      provider: 'bilibili',
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
      canonicalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      author: 'Aurora',
      description: '',
      publishedAt: '',
    },
  }
  const reference = {
    id: 'online-roundtrip-ref',
    projectId: project.id,
    assetId: asset.id,
    order: 0,
    thumbnailFollowsProject: false,
    tags: [],
    annotated: false,
    note: '',
  }

  const serialized = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [asset],
    projectAssetRefs: [reference],
    projectTitles: {},
    selectedProjectId: project.id,
  })
  const restored = parsePersistentLibrary({ library: serialized })

  expect(serialized.mediaAssets[0].online).toEqual(asset.online)
  expect(restored?.mediaAssets).toEqual([asset])
  expect(restored?.projectAssetRefs).toEqual([reference])
  expect(restored?.projects[0].videoCount).toBe(1)
  expect(restored && isOnlineMediaAsset(restored.mediaAssets[0])).toBe(true)

  const { author: _author, ...onlineWithoutAuthor } = asset.online!
  const restoredWithoutCachedCoverOrAuthor = parsePersistentLibrary({
    library: {
      ...serialized,
      mediaAssets: [
        {
          ...serialized.mediaAssets[0],
          thumbnail: null,
          online: onlineWithoutAuthor,
        },
      ],
    },
  })

  expect(restoredWithoutCachedCoverOrAuthor?.mediaAssets).toHaveLength(1)
  expect(restoredWithoutCachedCoverOrAuthor?.mediaAssets[0]).toMatchObject({
    id: asset.id,
    thumbnail: null,
    sourcePath: null,
    online: {
      ...onlineWithoutAuthor,
      author: '未公开',
    },
  })
  expect(
    restoredWithoutCachedCoverOrAuthor &&
      isOnlineMediaAsset(restoredWithoutCachedCoverOrAuthor.mediaAssets[0]),
  ).toBe(true)

  const restoredWithBlankAuthor = parsePersistentLibrary({
    library: {
      ...serialized,
      mediaAssets: [
        {
          ...serialized.mediaAssets[0],
          online: { ...asset.online!, author: '   ' },
        },
      ],
    },
  })
  expect(restoredWithBlankAuthor?.mediaAssets[0].online?.author).toBe('未公开')
})

test('新片场和优酷在线资产可安全 roundtrip', () => {
  const project = {
    id: 'online-provider-roundtrip-project',
    title: '新增在线来源',
    subtitle: '',
    cover: '',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2026-08-05 12:00',
  }
  const createAsset = (
    provider: 'xinpianchang' | 'youku',
    kind: 'video' | 'episode',
    mediaId: string,
    canonicalUrl: string,
  ): MediaAsset => ({
    id: `asset:online:${provider}:${kind}:${mediaId}`,
    filename: `${provider}-${mediaId}`,
    thumbnail: null,
    duration: '由官方页面提供',
    resolution: '在线',
    fps: '在线',
    frameCount: '不适用',
    sampleCount: 0,
    size: '不下载',
    codec: provider,
    camera: '在线来源',
    capturedAt: '未写入',
    sourceFingerprint: `online:${provider}:${kind}:${mediaId}`,
    sourcePath: null,
    favorite: true,
    indexTask: 'idle',
    durationSeconds: null,
    width: null,
    height: null,
    fpsValue: null,
    sizeBytes: null,
    indexError: null,
    online: {
      provider,
      kind,
      mediaId,
      canonicalUrl,
      author: '未公开',
      description: '',
      publishedAt: '',
    },
  })
  const assets = [
    createAsset(
      'xinpianchang',
      'video',
      '13772048',
      'https://www.xinpianchang.com/a13772048',
    ),
    createAsset(
      'youku',
      'episode',
      'z1234567890abcd',
      'https://v.youku.com/video?s=z1234567890abcd',
    ),
  ]
  const serialized = serializePersistentLibrary({
    projects: [project],
    mediaAssets: assets,
    projectAssetRefs: [],
    projectTitles: {},
    selectedProjectId: project.id,
  })

  expect(parsePersistentLibrary({ library: serialized })?.mediaAssets).toEqual(
    assets,
  )
})

test('非法在线 URL、ID 与非受管缩略图会被隔离，普通素材不受影响', () => {
  const project = {
    id: 'strict-online-project',
    title: '严格在线素材',
    subtitle: '',
    cover: '',
    videoCount: 6,
    collectionCount: 0,
    updatedAt: '2026-08-04 10:20',
  }
  const ordinaryAsset: MediaAsset = {
    id: 'ordinary-local-asset',
    filename: 'ordinary.mp4',
    thumbnail: null,
    duration: '00:05',
    resolution: '1280 x 720',
    fps: '25 fps',
    frameCount: '125',
    sampleCount: 0,
    size: '3 MB',
    codec: 'H.264',
    camera: '未写入',
    capturedAt: '2026-08-04 10:20',
    sourceFingerprint: 'local:/Volumes/Media/ordinary.mp4',
    sourcePath: '/Volumes/Media/ordinary.mp4',
    favorite: false,
    indexTask: 'idle',
    durationSeconds: 5,
    width: 1280,
    height: 720,
    fpsValue: 25,
    sizeBytes: 3 * 1024 ** 2,
    indexError: null,
  }
  const validOnlineAsset: MediaAsset = {
    ...ordinaryAsset,
    id: 'valid-online-episode',
    filename: '番剧剧集',
    thumbnail: 'C:\\Aurora\\cache\\online\\ep12345.jpg',
    sourceFingerprint: 'mock:bilibili:ep12345',
    sourcePath: null,
    online: {
      provider: 'bilibili',
      kind: 'episode',
      mediaId: '12345',
      canonicalUrl: 'https://www.bilibili.com/bangumi/play/ep12345',
      author: 'Bilibili',
      description: '番剧简介',
      publishedAt: '2026-08-04T02:20:00.000Z',
    },
  }
  const legacyOnlineAsset: MediaAsset = {
    ...validOnlineAsset,
    id: 'legacy-online-episode',
    thumbnail: 'C:\\Aurora\\cache\\online\\ep54321.jpg',
    sourceFingerprint: 'mock:bilibili:ep54321',
    online: {
      ...validOnlineAsset.online!,
      mediaId: 'ep54321',
      canonicalUrl: 'https://www.bilibili.com/bangumi/play/ep54321',
    },
  }
  const invalidAssets = [
    {
      ...validOnlineAsset,
      id: 'evil-host',
      online: {
        ...validOnlineAsset.online!,
        canonicalUrl: 'https://www.bilibili.com.evil.example/video/BV1xx411c7mD',
      },
    },
    {
      ...validOnlineAsset,
      id: 'mismatched-id',
      online: { ...validOnlineAsset.online!, mediaId: '54321' },
    },
    {
      ...validOnlineAsset,
      id: 'local-source-online',
      sourcePath: '/tmp/not-online.mp4',
    },
    {
      ...validOnlineAsset,
      id: 'relative-online-thumbnail',
      thumbnail: './online/ep12345.jpg',
    },
  ]
  const assets = [
    ordinaryAsset,
    validOnlineAsset,
    legacyOnlineAsset,
    ...invalidAssets,
  ]
  const references = assets.map((asset, order) => ({
    id: `strict-online-ref-${order}`,
    projectId: project.id,
    assetId: asset.id,
    order,
    thumbnailFollowsProject: false,
    tags: [],
    annotated: false,
    note: '',
  }))
  const serialized = serializePersistentLibrary({
    projects: [project],
    mediaAssets: assets,
    projectAssetRefs: references,
    projectTitles: {},
    selectedProjectId: project.id,
  })

  const restored = parsePersistentLibrary({ library: serialized })

  expect(restored?.mediaAssets.map((asset) => asset.id)).toEqual([
    ordinaryAsset.id,
    validOnlineAsset.id,
    legacyOnlineAsset.id,
  ])
  expect(
    restored?.mediaAssets.find((asset) => asset.id === legacyOnlineAsset.id)
      ?.online?.mediaId,
  ).toBe('54321')
  expect(restored?.projectAssetRefs.map((reference) => reference.assetId)).toEqual(
    [ordinaryAsset.id, validOnlineAsset.id, legacyOnlineAsset.id],
  )
  expect(restored?.projects[0].videoCount).toBe(3)
})
