import { expect, test } from '@playwright/test'
import type { OnlineMediaProvider } from '../src/data/onlineProviderRegistry'
import type {
  DiscoveryOnlineVideoResult,
  DiscoveryResult,
} from '../src/features/discovery/discoveryData'
import {
  mergeBalancedOnlineDiscoverySearchResults,
  shouldRunDirectOnlineSearch,
} from '../src/features/discovery/mergeOnlineDiscoverySearchResults'

const createOnlineResult = (
  provider: OnlineMediaProvider,
  mediaId: string,
): DiscoveryOnlineVideoResult => ({
  id: `${provider}:video:${mediaId}`,
  title: `${provider} ${mediaId}`,
  secondaryLabel: provider,
  sourceCollection: provider,
  thumbnail: `/managed/${provider}/${mediaId}.jpg`,
  timecode: 'ONLINE',
  duration: '',
  resolution: '在线',
  resolutionLabel: 'ONLINE',
  kind: 'clip',
  description: '',
  tags: [],
  previewProgress: 0,
  detailType: 'online-video',
  source: provider,
  online: {
    provider,
    mediaKind: 'video',
    mediaId,
    bvid: provider === 'bilibili' ? mediaId : null,
    episodeId: null,
    canonicalUrl: `https://example.com/${provider}/${mediaId}`,
    author: '',
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

const createLocalResult = (id: string): DiscoveryResult => ({
  id,
  title: id,
  secondaryLabel: '',
  sourceCollection: '本地',
  thumbnail: '',
  timecode: '00:00:00:00',
  duration: '00:10',
  resolution: '1920 × 1080',
  resolutionLabel: '1080P',
  kind: 'clip',
  description: '',
  tags: [],
  previewProgress: 0,
  detailType: 'footage',
  source: 'local',
  footage: {
    filename: `${id}.mp4`,
    project: '本地',
    codec: 'H.264',
    fps: '25 fps',
    size: '1 MB',
    camera: '',
    capturedAt: '',
    sourcePath: `/tmp/${id}.mp4`,
  },
  visualIndex: {
    status: 'not-created',
    keyframeCount: 0,
    highlightCount: 0,
    favoriteCount: 0,
  },
})

test('全部来源按来源轮询，单个平台的大结果页不会淹没其他来源', () => {
  const results = mergeBalancedOnlineDiscoverySearchResults({
    providers: ['bilibili', 'tencent', 'xinpianchang', 'youku'],
    directResultsByProvider: {
      bilibili: [
        createOnlineResult('bilibili', 'b1'),
        createOnlineResult('bilibili', 'b2'),
      ],
      tencent: [createOnlineResult('tencent', 't1')],
      xinpianchang: [createOnlineResult('xinpianchang', 'x1')],
      youku: [createOnlineResult('youku', 'y1')],
    },
    repositoryResults: [createLocalResult('local-1')],
    kind: 'all',
    resolution: 'all',
    limit: 6,
  })

  expect(results.map((result) => result.id)).toEqual([
    'bilibili:video:b1',
    'tencent:video:t1',
    'xinpianchang:video:x1',
    'youku:video:y1',
    'local-1',
    'bilibili:video:b2',
  ])
})

test('在线直搜判断支持四个平台且不会误触发本地来源', () => {
  ;(['bilibili', 'tencent', 'xinpianchang', 'youku'] as const).forEach(
    (provider) => {
      expect(shouldRunDirectOnlineSearch('all', provider)).toBe(true)
      expect(shouldRunDirectOnlineSearch(provider, provider)).toBe(true)
      expect(shouldRunDirectOnlineSearch('local', provider)).toBe(false)
    },
  )
})
