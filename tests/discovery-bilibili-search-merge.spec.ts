import { expect, test } from '@playwright/test'
import type { DiscoveryOnlineVideoResult } from '../src/features/discovery/discoveryData'
import {
  mergeBilibiliDiscoverySearchResults,
  shouldRunDirectBilibiliSearch,
} from '../src/features/discovery/mergeBilibiliDiscoverySearchResults'

const createBilibiliResult = (
  mediaId: string,
  overrides: Partial<DiscoveryOnlineVideoResult> = {},
): DiscoveryOnlineVideoResult => ({
  id: `bilibili:video:${mediaId}`,
  title: `B站视频 ${mediaId}`,
  secondaryLabel: '创作者',
  sourceCollection: 'B站',
  thumbnail: `/managed/bilibili/${mediaId}.jpg`,
  timecode: 'ONLINE',
  duration: '01:20',
  resolution: '在线',
  resolutionLabel: 'ONLINE',
  kind: 'clip',
  description: '',
  tags: [],
  previewProgress: 0,
  detailType: 'online-video',
  source: 'bilibili',
  online: {
    provider: 'bilibili',
    mediaKind: 'video',
    mediaId,
    bvid: mediaId,
    episodeId: null,
    canonicalUrl: `https://www.bilibili.com/video/${mediaId}`,
    author: '创作者',
    publishedAt: '',
    favorite: false,
    projectIds: [],
  },
  visualIndex: {
    status: 'not-created',
    keyframeCount: 0,
    highlightCount: 0,
    favoriteCount: 0,
  },
  ...overrides,
})

test('B站在线结果保持搜索排名并与 Aurora 仓库结果按媒体身份去重', () => {
  const first = createBilibiliResult('BV-first')
  const directDuplicate = createBilibiliResult('BV-shared', {
    id: 'direct-result-id',
    title: '在线搜索返回的新标题',
  })
  const repositoryDuplicate = createBilibiliResult('BV-shared', {
    id: 'persisted-result-id',
    title: 'Aurora 已保存标题',
  })
  const persistedOnly = createBilibiliResult('BV-persisted')

  const results = mergeBilibiliDiscoverySearchResults({
    directResults: [first, directDuplicate],
    repositoryResults: [repositoryDuplicate, persistedOnly],
    kind: 'all',
    resolution: 'all',
  })

  expect(results.map((result) => result.id)).toEqual([
    first.id,
    directDuplicate.id,
    persistedOnly.id,
  ])
  expect(results[1]?.title).toBe('在线搜索返回的新标题')
})

test('B站在线结果遵守 Aurora 类型、分辨率和数量筛选', () => {
  const directResults = [
    createBilibiliResult('BV-one'),
    createBilibiliResult('BV-two'),
  ]

  expect(
    mergeBilibiliDiscoverySearchResults({
      directResults,
      repositoryResults: [],
      kind: 'model',
      resolution: 'all',
    }),
  ).toEqual([])

  expect(
    mergeBilibiliDiscoverySearchResults({
      directResults,
      repositoryResults: [],
      kind: 'clip',
      resolution: '4K',
    }),
  ).toEqual([])

  expect(
    mergeBilibiliDiscoverySearchResults({
      directResults,
      repositoryResults: [],
      kind: 'clip',
      resolution: 'ONLINE',
      limit: 1,
    }).map((result) => result.id),
  ).toEqual([directResults[0]?.id])
})

test('全部来源与 B站来源都会触发 B站在线直搜', () => {
  expect(shouldRunDirectBilibiliSearch('all')).toBe(true)
  expect(shouldRunDirectBilibiliSearch('bilibili')).toBe(true)
  expect(shouldRunDirectBilibiliSearch('local')).toBe(false)
  expect(shouldRunDirectBilibiliSearch('emby')).toBe(false)
})
