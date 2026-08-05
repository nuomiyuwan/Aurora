import { expect, test } from '@playwright/test'
import type {
  DiscoveryFootageResult,
  DiscoveryMediaResult,
  DiscoveryModelResult,
  DiscoveryOnlineVideoResult,
} from '../src/features/discovery/discoveryData'
import { resolveDiscoveryResultActions } from '../src/features/discovery/discoveryResultActions'

const visualIndex = {
  status: 'ready' as const,
  keyframeCount: 8,
  highlightCount: 1,
  favoriteCount: 0,
}

const footageResult = (
  kind: 'clip' | 'frame',
): DiscoveryFootageResult => ({
  id: `local:${kind}:asset-one`,
  title: 'A001_C001.mov',
  secondaryLabel: 'A001_C001.mov',
  sourceCollection: '测试项目',
  thumbnail: '',
  timecode: kind === 'frame' ? '00:00:05:12' : '00:00:00:00',
  duration: '00:00:20:00',
  resolution: '3840 × 2160',
  resolutionLabel: '4K',
  kind,
  description: '',
  tags: [],
  previewProgress: 0,
  detailType: 'footage',
  source: 'local',
  footage: {
    filename: 'A001_C001.mov',
    project: '测试项目',
    auroraProjectId: 'project-one',
    auroraClipId: 'clip-one',
    auroraFrameId: kind === 'frame' ? 'frame-one' : undefined,
    auroraTimeSeconds: kind === 'frame' ? 5.5 : undefined,
    codec: 'ProRes',
    fps: '24 fps',
    size: '1 GB',
    camera: '未写入',
    capturedAt: '2026-08-03',
    sourcePath: '/Volumes/Aurora/A001_C001.mov',
    sourcePathAvailable: true,
  },
  visualIndex,
})

const modelResult: DiscoveryModelResult = {
  id: 'local:model:model-one',
  title: 'ring.glb',
  secondaryLabel: 'ring.glb',
  sourceCollection: '三维项目',
  thumbnail: '',
  timecode: '3D',
  duration: '—',
  resolution: 'GLB',
  resolutionLabel: 'GLB',
  kind: 'model',
  description: '',
  tags: [],
  previewProgress: 0,
  detailType: 'model',
  source: 'local',
  model: {
    filename: 'ring.glb',
    project: '三维项目',
    auroraProjectId: 'project-3d',
    auroraModelId: 'model-one',
    format: 'GLB',
    size: '2 MB',
    importedAt: '2026-08-03',
    sourcePath: '/Volumes/Aurora/ring.glb',
    sourcePathAvailable: true,
    vertexCount: 100,
    triangleCount: 200,
    nodeCount: 1,
    materialCount: 1,
    textureCount: 0,
    dimensions: '1 × 1 × 1',
  },
  visualIndex,
}

const embyResult: DiscoveryMediaResult = {
  id: 'emby:item-one',
  title: '远程影片',
  secondaryLabel: '远程影片',
  sourceCollection: 'Emby',
  thumbnail: '',
  timecode: '00:00:00:00',
  duration: '01:30:00',
  resolution: '1920 × 1080',
  resolutionLabel: '1080P',
  kind: 'clip',
  description: '',
  tags: [],
  previewProgress: 0,
  detailType: 'media',
  source: 'emby',
  media: {
    englishTitle: '',
    year: '2026',
    type: '电影',
    genres: [],
    director: '',
    cast: [],
    hdrAudio: '',
  },
  visualIndex,
}

const onlineVideoResult = (
  favorite = false,
): DiscoveryOnlineVideoResult => ({
  id: 'bilibili:video:BV1Aurora',
  title: 'Aurora 在线样片',
  secondaryLabel: 'Aurora 在线样片',
  sourceCollection: 'Bilibili',
  thumbnail: '',
  timecode: 'ONLINE',
  duration: '以 B站页面为准',
  resolution: '在线',
  resolutionLabel: 'ONLINE',
  kind: 'clip',
  description: '官方页面在线播放',
  tags: ['在线'],
  previewProgress: 0,
  detailType: 'online-video',
  source: 'bilibili',
  online: {
    provider: 'bilibili',
    mediaKind: 'video',
    mediaId: 'BV1Aurora',
    bvid: 'BV1Aurora',
    episodeId: null,
    canonicalUrl: 'https://www.bilibili.com/video/BV1Aurora',
    author: 'Aurora',
    publishedAt: '2026-08-04',
    favorite,
    projectIds: [],
  },
  visualIndex,
})

test('本地视频、关键帧与模型按真实能力解析稳定动作', () => {
  const clip = resolveDiscoveryResultActions(footageResult('clip'))
  expect(clip.actions.map((action) => action.id)).toEqual([
    'open-footage',
    'trim-footage',
    'add-footage-to-project',
    'reveal-file',
  ])
  expect(clip.primaryAction?.id).toBe('open-footage')
  expect(clip.layout).toBe('quad')

  const frame = resolveDiscoveryResultActions(footageResult('frame'))
  expect(frame.actions.map((action) => action.id)).toEqual([
    'open-footage',
    'trim-footage',
    'export-still',
    'add-footage-to-project',
  ])
  expect(frame.primaryAction?.id).toBe('open-footage')
  expect(frame.layout).toBe('quad')

  const model = resolveDiscoveryResultActions(modelResult)
  expect(model.actions.map((action) => action.id)).toEqual([
    'open-model',
    'reveal-file',
  ])
  expect(model.primaryAction?.id).toBe('open-model')
  expect(model.layout).toBe('double')
})

test('没有真实执行链的远程占位动作不会显示', () => {
  const remote = resolveDiscoveryResultActions(embyResult)
  expect(remote).toMatchObject({
    actions: [],
    primaryAction: null,
    layout: 'none',
  })
})

test('B站在线视频按收藏状态解析三按钮动作', () => {
  const regular = resolveDiscoveryResultActions(onlineVideoResult())
  expect(regular.actions).toEqual([
    {
      id: 'open-online-video',
      label: '在线播放',
      icon: 'play',
      primary: true,
    },
    {
      id: 'toggle-online-favorite',
      label: '收藏',
      icon: 'star',
      primary: false,
    },
    {
      id: 'add-online-to-project',
      label: '添加到项目',
      icon: 'folder-plus',
      primary: false,
    },
  ])
  expect(regular.primaryAction?.id).toBe('open-online-video')
  expect(regular.layout).toBe('triple')

  const favorite = resolveDiscoveryResultActions(onlineVideoResult(true))
  expect(
    favorite.actions.find(
      (action) => action.id === 'toggle-online-favorite',
    )?.label,
  ).toBe('取消收藏')
  expect(favorite.primaryAction?.id).toBe('open-online-video')
  expect(favorite.layout).toBe('triple')
})

test('腾讯视频复用在线媒体的播放、收藏与加入项目动作', () => {
  const tencentResult: DiscoveryOnlineVideoResult = {
    ...onlineVideoResult(),
    id: 'tencent:episode:mzc00200aaogpgh',
    source: 'tencent',
    sourceCollection: '腾讯视频',
    online: {
      ...onlineVideoResult().online,
      provider: 'tencent',
      mediaKind: 'episode',
      mediaId: 'mzc00200aaogpgh',
      bvid: null,
      episodeId: null,
      canonicalUrl:
        'https://v.qq.com/x/cover/mzc00200aaogpgh/s4100example.html',
    },
  }
  const group = resolveDiscoveryResultActions(tencentResult)
  expect(group.actions.map((action) => action.id)).toEqual([
    'open-online-video',
    'toggle-online-favorite',
    'add-online-to-project',
  ])
  expect(group.primaryAction?.id).toBe('open-online-video')
  expect(group.layout).toBe('triple')
})

test('缺少文件路径时隐藏 Finder 动作，但保留核心动作', () => {
  const result = footageResult('clip')
  result.footage.sourcePath = ''
  result.footage.sourcePathAvailable = false
  const group = resolveDiscoveryResultActions(result)
  expect(group.actions.map((action) => action.id)).toEqual([
    'open-footage',
    'trim-footage',
    'add-footage-to-project',
  ])
  expect(group.layout).toBe('triple')
})
