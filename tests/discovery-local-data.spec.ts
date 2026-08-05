import { expect, test } from '@playwright/test'
import type { FrameAnnotation } from '../src/data/mediaLibraryTypes'
import type { ModelAsset } from '../src/data/modelLibraryTypes'
import type { Project } from '../src/data/projects'
import {
  createLocalDiscoveryResults,
  type LocalDiscoveryClip,
} from '../src/features/discovery/createLocalDiscoveryResults'
import type { DiscoveryFootageResult } from '../src/features/discovery/discoveryData'
import { LocalDiscoverySearchProvider } from '../src/features/discovery/search/LocalDiscoverySearchProvider'

function makeDiscoveryResult(
  id: string,
  overrides: Partial<DiscoveryFootageResult> = {},
): DiscoveryFootageResult {
  return {
    id,
    title: id,
    secondaryLabel: id,
    sourceCollection: '测试项目',
    thumbnail: `aurora-media://thumbnail/${id}`,
    timecode: '00:00:00:00',
    duration: '00:00:12:00',
    resolution: '3840 × 2160',
    resolutionLabel: '4K',
    source: 'local',
    detailType: 'footage',
    kind: 'clip',
    description: '',
    tags: [],
    previewProgress: 0,
    footage: {
      filename: `${id}.mov`,
      project: '测试项目',
      auroraProjectId: 'project-one',
      auroraClipId: id,
      codec: 'Apple ProRes',
      fps: '24 fps',
      size: '1 GB',
      camera: '未写入',
      capturedAt: '2026-08-02 10:00',
      sourcePath: `/Volumes/Aurora/${id}.mov`,
    },
    visualIndex: {
      status: 'ready',
      keyframeCount: 1,
      highlightCount: 0,
      favoriteCount: 0,
    },
    ...overrides,
  }
}

test('本地探索 Provider 可按文件名、标签和项目内备注检索', async () => {
  const filenameResult = makeDiscoveryResult('filename', {
    footage: {
      ...makeDiscoveryResult('filename').footage,
      filename: 'A001_C012.MOV',
    },
  })
  const tagResult = makeDiscoveryResult('tag', {
    tags: ['极光倒影', '人物'],
  })
  const noteResult = makeDiscoveryResult('note', {
    description: '保留远景中的高压电塔。',
  })
  const results = [filenameResult, tagResult, noteResult]
  const provider = new LocalDiscoverySearchProvider({
    getResults: () => results,
  })

  const search = (query: string) =>
    provider.search({ query, sources: ['local'], limit: 18 })

  await expect(search('a001_c012')).resolves.toMatchObject({
    results: [{ id: 'filename' }],
    totalCount: 1,
  })
  await expect(search('极光倒影')).resolves.toMatchObject({
    results: [{ id: 'tag' }],
    totalCount: 1,
  })
  await expect(search('高压电塔')).resolves.toMatchObject({
    results: [{ id: 'note' }],
    totalCount: 1,
  })
})

test('真实项目素材引用映射为稳定结果，并只展开有意义的标注帧', () => {
  const project: Project = {
    id: 'project-one',
    kind: 'video',
    title: '极光观察站',
    subtitle: 'Aurora Station',
    description: '追踪极光与地面倒影。',
    cover: './aurora/project-cover.png',
    videoCount: 1,
    collectionCount: 0,
    updatedAt: '2026-08-02 10:00',
  }
  const clip: LocalDiscoveryClip = {
    id: 'project-one:ref:asset-one',
    assetId: 'asset-one',
    projectId: project.id,
    filename: 'A001_C012.mov',
    thumbnail: 'aurora-media://poster/asset-one',
    duration: '00:42',
    durationSeconds: 42,
    resolution: '3840 x 2160',
    width: 3840,
    height: 2160,
    fps: '24 fps',
    fpsValue: 24,
    size: '2.4 GB',
    codec: 'Apple ProRes 422 HQ',
    camera: 'ARRI Alexa 35',
    capturedAt: '2026-08-02 10:00',
    sourcePath: '/Volumes/Aurora/A001_C012.mov',
    favorite: false,
    tags: [' 雾 ', '极光'],
    note: '素材级备注',
    indexedFrames: [
      {
        id: 'frame-meaningful',
        index: 0,
        thumbnail: 'aurora-media://frame/meaningful',
        timeSeconds: 10.5,
      },
      {
        id: 'frame-empty-annotation',
        index: 1,
        thumbnail: 'aurora-media://frame/empty',
        timeSeconds: 20,
      },
      {
        id: 'frame-without-annotation',
        index: 2,
        thumbnail: 'aurora-media://frame/unannotated',
        timeSeconds: 30,
      },
    ],
  }
  const annotations: FrameAnnotation[] = [
    {
      assetId: clip.assetId,
      frameId: 'frame-meaningful',
      favorite: true,
      rating: 4,
      tags: ['极光', '人物'],
      note: '人物站在极光倒影前。',
    },
    {
      assetId: clip.assetId,
      frameId: 'frame-empty-annotation',
      favorite: false,
      rating: 0,
      tags: [],
      note: '   ',
    },
  ]

  const results = createLocalDiscoveryResults({
    clips: [clip],
    projects: [project],
    frameAnnotations: annotations,
  })

  expect(results.map((result) => result.id)).toEqual([
    'local:clip:project-one:ref:asset-one',
    'local:frame:project-one:ref:asset-one:frame-meaningful',
  ])

  const [clipResult, frameResult] = results
  expect(clipResult).toMatchObject({
    sourceCollection: project.title,
    kind: 'clip',
    resolution: '3840 × 2160',
    resolutionLabel: '4K',
    footage: {
      auroraProjectId: project.id,
      auroraClipId: clip.id,
      filename: clip.filename,
      sourcePath: clip.sourcePath,
    },
    visualIndex: {
      status: 'ready',
      keyframeCount: 3,
      highlightCount: 1,
      favoriteCount: 1,
    },
  })
  expect(frameResult).toMatchObject({
    kind: 'frame',
    timecode: '00:00:10:12',
    description: '人物站在极光倒影前。',
    tags: ['极光', '人物', '雾'],
    previewProgress: 25,
    footage: {
      auroraProjectId: project.id,
      auroraClipId: clip.id,
      auroraFrameId: 'frame-meaningful',
      auroraTimeSeconds: 10.5,
    },
  })

  const aiFrameResults = createLocalDiscoveryResults({
    clips: [clip],
    projects: [project],
    frameAnnotations: annotations,
    includeUnannotatedFrames: true,
  }).filter((result) => result.kind === 'frame')

  expect(aiFrameResults.map((result) => result.id)).toEqual([
    'local:frame:project-one:ref:asset-one:frame-meaningful',
    'local:frame:project-one:ref:asset-one:frame-empty-annotation',
    'local:frame:project-one:ref:asset-one:frame-without-annotation',
  ])
  expect(aiFrameResults[2]).toMatchObject({
    description: '素材级备注',
    tags: ['雾', '极光'],
    footage: {
      auroraFrameId: 'frame-without-annotation',
      auroraTimeSeconds: 30,
    },
  })
})

test('真实三维模型映射为可检索结果并保留项目与模型稳定标识', async () => {
  const project: Project = {
    id: 'project-model',
    kind: '3d',
    title: '环形标志',
    subtitle: 'Ring Mark',
    description: '用于极光品牌片头的三维资产。',
    cover: './aurora/project-model-cover.png',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2026-08-02 12:00',
  }
  const model: ModelAsset = {
    id: 'model-ring-v2',
    projectId: project.id,
    filename: 'twisted_ring_logo.fbx',
    format: 'fbx',
    // Aurora preserves the source format while the runtime asset is managed GLB.
    sourcePath: '/Volumes/Aurora/Models/managed/model-ring-v2.glb',
    sizeBytes: 761_856,
    importedAt: '2026-08-02 12:30',
    thumbnail: 'aurora-media://model/model-ring-v2/thumbnail',
    favorite: false,
    tags: ['品牌', '金属环'],
    note: '表面使用拉丝银材质。',
    vertexCount: 17_280,
    triangleCount: 34_560,
    nodeCount: 2,
    materialCount: 1,
    textureCount: 0,
    dimensions: { x: 7.01, y: 6.99, z: 1.07 },
    camera: null,
  }

  const results = createLocalDiscoveryResults({
    clips: [],
    models: [model],
    projects: [project],
    frameAnnotations: [],
  })

  expect(results).toHaveLength(1)
  const result = results[0]
  expect(result).toMatchObject({
    id: 'local:model:model-ring-v2',
    kind: 'model',
    detailType: 'model',
    source: 'local',
    title: 'twisted_ring_logo',
    thumbnail: model.thumbnail,
    resolution: '7.01 × 6.99 × 1.07',
    resolutionLabel: 'FBX',
    description: model.note,
    tags: ['品牌', '金属环'],
    searchTerms: [project.description, 'FBX'],
    model: {
      filename: model.filename,
      project: project.title,
      auroraProjectId: project.id,
      auroraModelId: model.id,
      format: 'FBX',
      size: '744 KB',
      sourcePath: model.sourcePath,
      vertexCount: model.vertexCount,
      triangleCount: model.triangleCount,
      dimensions: '7.01 × 6.99 × 1.07',
    },
  })

  const provider = new LocalDiscoverySearchProvider({
    getResults: () => results,
  })
  const search = (query: string) =>
    provider.search({ query, sources: ['local'], limit: 18 })

  for (const query of [
    'twisted_ring_logo',
    '金属环',
    '拉丝银',
    '品牌片头',
    '34560',
    'fbx',
  ]) {
    await expect(search(query)).resolves.toMatchObject({
      results: [{ id: result.id, detailType: 'model' }],
      totalCount: 1,
    })
  }

  await expect(
    provider.search({
      query: '',
      sources: ['local'],
      kind: 'model',
      resolution: 'FBX',
      limit: 18,
    }),
  ).resolves.toMatchObject({
    results: [{ id: result.id, kind: 'model', resolutionLabel: 'FBX' }],
    totalCount: 1,
  })
})
