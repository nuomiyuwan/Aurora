import { expect, test } from '@playwright/test'
import type {
  MediaAsset,
  OnlineMediaDescriptor,
  ProjectAssetRef,
} from '../src/data/mediaLibraryTypes'
import type { Project } from '../src/data/projects'
import { createBilibiliDiscoveryResults } from '../src/features/discovery/createBilibiliDiscoveryResults'
import { LocalDiscoverySearchProvider } from '../src/features/discovery/search/LocalDiscoverySearchProvider'

const createOnlineAsset = (
  id: string,
  online: OnlineMediaDescriptor,
  overrides: Partial<MediaAsset> = {},
): MediaAsset => ({
  id,
  filename: `B站素材 ${online.mediaId}`,
  thumbnail: `/managed/bilibili/${online.mediaId}.jpg`,
  duration: '01:20',
  resolution: '1920 × 1080',
  fps: '30 fps',
  frameCount: '2400',
  sampleCount: 0,
  size: '在线',
  codec: 'H.264',
  camera: '未写入',
  capturedAt: '未写入',
  sourceFingerprint: `bilibili:${online.mediaId}`,
  sourcePath: null,
  favorite: false,
  indexTask: 'idle',
  durationSeconds: 80,
  width: 1920,
  height: 1080,
  fpsValue: 30,
  sizeBytes: null,
  indexError: null,
  online,
  ...overrides,
})

const videoDescriptor = (
  mediaId = 'BV1xx411c7mD',
): OnlineMediaDescriptor => ({
  provider: 'bilibili',
  kind: 'video',
  mediaId,
  canonicalUrl: `https://www.bilibili.com/video/${mediaId}`,
  author: '极光创作者',
  description: '在线素材简介',
  publishedAt: '2026-08-04T02:00:00.000Z',
})

const project = (
  id: string,
  title: string,
  cover = 'https://remote.example/cover.jpg',
): Project => ({
  id,
  kind: 'video',
  title,
  subtitle: '',
  cover,
  videoCount: 0,
  collectionCount: 0,
  updatedAt: '2026-08-04 10:00',
})

const reference = (
  id: string,
  projectId: string,
  assetId: string,
  tags: string[] = [],
  note = '',
): ProjectAssetRef => ({
  id,
  projectId,
  assetId,
  order: 0,
  thumbnailFollowsProject: true,
  tags,
  annotated: false,
  note,
})

test('B 站素材生成稳定结果 ID 并仅解析受管缩略图', () => {
  const descriptor = videoDescriptor()
  const asset = createOnlineAsset('asset-one', descriptor, {
    filename: '银河旅行',
  })
  const owningProject = project('project-one', '星河项目')
  const resolverInputs: string[] = []
  const resolveThumbnailUrl = (thumbnail: string) => {
    resolverInputs.push(thumbnail)
    return `aurora-media://${thumbnail}`
  }
  const options = {
    mediaAssets: [asset],
    projectAssetRefs: [
      reference('ref-one', owningProject.id, asset.id, ['科幻'], '深空备注'),
    ],
    projects: [owningProject],
    resolveThumbnailUrl,
  }

  const [result] = createBilibiliDiscoveryResults(options)
  const [renamedResult] = createBilibiliDiscoveryResults({
    ...options,
    mediaAssets: [{ ...asset, filename: '用户改名后' }],
  })

  expect(result.id).toBe(`bilibili:video:${descriptor.mediaId}`)
  expect(renamedResult.id).toBe(result.id)
  expect(result).toMatchObject({
    source: 'bilibili',
    detailType: 'online-video',
    kind: 'clip',
    resolutionLabel: 'ONLINE',
    thumbnail: `aurora-media://${asset.thumbnail}`,
    description: '深空备注',
    tags: ['科幻'],
    visualIndex: {
      status: 'not-created',
      keyframeCount: 0,
      highlightCount: 0,
      favoriteCount: 0,
    },
    online: {
      mediaKind: 'video',
      mediaId: descriptor.mediaId,
      bvid: descriptor.mediaId,
      episodeId: null,
      canonicalUrl: descriptor.canonicalUrl,
      author: descriptor.author,
      publishedAt: descriptor.publishedAt,
      auroraAssetId: asset.id,
      favorite: false,
      projectIds: [owningProject.id],
    },
  })
  expect(resolverInputs).toEqual([asset.thumbnail, asset.thumbnail])
  expect(result.thumbnail).not.toBe(owningProject.cover)
})

test('收藏的 B 站素材聚合多项目标题、ID、标签与备注', () => {
  const asset = createOnlineAsset('favorite-online', videoDescriptor(), {
    favorite: true,
  })
  const projectA = project('project-a', '项目甲')
  const projectB = project('project-b', '项目乙')

  const [result] = createBilibiliDiscoveryResults({
    mediaAssets: [asset],
    projectAssetRefs: [
      reference('ref-a', projectA.id, asset.id, ['海边'], '备注甲'),
      reference('ref-b', projectB.id, asset.id, ['夜景', '海边'], '备注乙'),
      reference('ref-a-duplicate', projectA.id, asset.id, ['夜景'], '备注甲'),
      reference('orphan-ref', 'missing-project', asset.id, ['不应保留']),
    ],
    projects: [projectA, projectB],
  })

  expect(result.sourceCollection).toBe('项目甲 · 项目乙')
  expect(result.online.projectIds).toEqual([projectA.id, projectB.id])
  expect(result.online.favorite).toBe(true)
  expect(result.tags).toEqual(['海边', '夜景'])
  expect(result.description).toBe('备注甲；备注乙')
  expect(result.searchTerms).toEqual(expect.arrayContaining([
    '项目甲',
    '项目乙',
    projectA.id,
    projectB.id,
    '备注甲',
    '备注乙',
  ]))
})

test('未引用的全局素材只保留收藏项与当前选择项', () => {
  const favorite = createOnlineAsset('global-favorite', videoDescriptor('BV1ab411c7mD'), {
    favorite: true,
    thumbnail: null,
  })
  const selected = createOnlineAsset('global-selected', videoDescriptor('BV1cd411c7mD'), {
    thumbnail: null,
  })
  const hidden = createOnlineAsset('global-hidden', videoDescriptor('BV1ef411c7mD'))
  const ordinary: MediaAsset = {
    ...createOnlineAsset('ordinary-local', videoDescriptor('BV1gh411c7mD')),
    sourcePath: '/Volumes/Media/ordinary.mp4',
    online: undefined,
  }
  const remoteCoverProject = project('unused-project', '未使用项目')

  const results = createBilibiliDiscoveryResults({
    mediaAssets: [favorite, selected, hidden, ordinary],
    projectAssetRefs: [],
    projects: [remoteCoverProject],
    selectedAssetId: selected.id,
    resolveThumbnailUrl: () => {
      throw new Error('无缩略图时不应调用 resolver')
    },
  })

  expect(results.map((result) => result.online.auroraAssetId)).toEqual([
    favorite.id,
    selected.id,
  ])
  expect(results.every((result) => result.thumbnail === '')).toBe(true)
  expect(results.every((result) => result.online.projectIds.length === 0)).toBe(
    true,
  )
  expect(results.every((result) => result.thumbnail !== remoteCoverProject.cover)).toBe(
    true,
  )
})

test('临时 B站结果不会因为上一轮搜索而命中无关关键词', async () => {
  const transient = createOnlineAsset(
    'transient-bangumi',
    videoDescriptor('BV1zz411c7mD'),
    {
      filename: '凡人修仙传',
    },
  )
  const results = createBilibiliDiscoveryResults({
    mediaAssets: [transient],
    projectAssetRefs: [],
    projects: [],
    transientAssetIds: [transient.id],
  })
  const provider = new LocalDiscoverySearchProvider({
    id: 'transient-bilibili-test',
    sources: ['bilibili'],
    getResults: () => results,
  })

  const unrelated = await provider.search({
    query: '冰川',
    sources: ['bilibili'],
    kind: 'all',
    resolution: 'all',
    limit: 18,
  })

  expect(unrelated.results).toEqual([])
})
