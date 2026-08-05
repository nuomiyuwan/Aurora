import { expect, test } from '@playwright/test'
import type { DiscoveryOnlineVideoResult } from '../src/features/discovery/discoveryData'
import {
  appendUniqueDiscoveryResults,
  getDiscoveryProviderPrefetchWindow,
  shouldPrefetchNextBilibiliPage,
} from '../src/features/discovery/bilibiliDiscoveryPagination'

const createBilibiliResult = (
  mediaId: string,
  id = `bilibili:video:${mediaId}`,
): DiscoveryOnlineVideoResult => ({
  id,
  title: mediaId,
  secondaryLabel: '作者',
  sourceCollection: 'B站',
  thumbnail: '',
  timecode: 'ONLINE',
  duration: '',
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
    author: '作者',
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
})

test('追加 B站后续页时保持已有排名并按媒体身份去重', () => {
  const firstPage = [
    createBilibiliResult('BV-first'),
    createBilibiliResult('BV-shared', 'first-page-id'),
  ]
  const nextPage = [
    createBilibiliResult('BV-shared', 'next-page-duplicate-id'),
    createBilibiliResult('BV-next'),
  ]

  const merged = appendUniqueDiscoveryResults(firstPage, nextPage)

  expect(merged.map((result) => result.id)).toEqual([
    'bilibili:video:BV-first',
    'first-page-id',
    'bilibili:video:BV-next',
  ])
})

test('仅在接近当前结果末端且仍有下一页时预取', () => {
  expect(
    shouldPrefetchNextBilibiliPage({
      resultCount: 18,
      windowStart: 5,
      windowSize: 9,
      hasMore: true,
      loading: false,
      blocked: false,
    }),
  ).toBe(false)
  expect(
    shouldPrefetchNextBilibiliPage({
      resultCount: 18,
      windowStart: 6,
      windowSize: 9,
      hasMore: true,
      loading: false,
      blocked: false,
    }),
  ).toBe(true)
  expect(
    shouldPrefetchNextBilibiliPage({
      resultCount: 18,
      windowStart: 9,
      windowSize: 9,
      hasMore: false,
      loading: false,
      blocked: false,
    }),
  ).toBe(false)
  expect(
    shouldPrefetchNextBilibiliPage({
      resultCount: 12,
      windowStart: 0,
      windowSize: 9,
      hasMore: true,
      loading: false,
      blocked: true,
    }),
  ).toBe(false)
})

test('混合来源搜索按当前提供方自身的结果进度判断预取', () => {
  const results = Array.from({ length: 20 }, (_, index) => ({
    source: index % 2 === 0 ? 'bilibili' as const : 'tencent' as const,
  }))
  const providerWindow = getDiscoveryProviderPrefetchWindow({
    results,
    provider: 'bilibili',
    windowStart: 6,
    windowSize: 9,
  })

  expect(providerWindow).toEqual({
    resultCount: 10,
    windowStart: 3,
    windowSize: 5,
  })
  expect(
    shouldPrefetchNextBilibiliPage({
      ...providerWindow,
      hasMore: true,
      loading: false,
      blocked: false,
    }),
  ).toBe(true)
})
