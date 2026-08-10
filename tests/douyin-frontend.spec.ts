import { expect, test } from '@playwright/test'
import {
  parsePersistentLibrary,
  serializePersistentLibrary,
} from '../src/data/libraryPersistence'
import type { MediaAsset } from '../src/data/mediaLibraryTypes'
import {
  ONLINE_PROVIDER_MANIFESTS,
  parseOnlineProviderSettings,
} from '../src/data/onlineProviderRegistry'
import { getOnlineSearchFailureStatus } from '../src/features/discovery/onlineSearchFailureStatus'
import {
  createOnlineEmbeddedWebviewAttributes,
} from '../src/features/frame-ring/OnlineEmbeddedPlayer'
import {
  getOnlineEmbeddedPlayerLayout,
  shouldUseOnlinePlayerAmbientFallback,
} from '../src/features/frame-ring/onlineOfficialPlayback'

const MEDIA_ID = '7535724040761244971'

const createDouyinAsset = (canonicalUrl: string): MediaAsset => ({
  id: `asset:online:douyin:video:${MEDIA_ID}`,
  filename: '抖音公开视频',
  thumbnail: null,
  duration: '00:15',
  resolution: '在线',
  fps: '在线',
  frameCount: '不适用',
  sampleCount: 0,
  size: '不下载',
  codec: 'Douyin',
  camera: '在线来源',
  capturedAt: '2026-08-07',
  sourceFingerprint: `online:douyin:video:${MEDIA_ID}`,
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
    provider: 'douyin',
    kind: 'video',
    mediaId: MEDIA_ID,
    canonicalUrl,
    author: '抖音用户',
    description: '公开作品',
    publishedAt: '2026-08-07',
  },
})

const createLibrary = (asset: MediaAsset) => {
  const project = {
    id: 'douyin-project',
    title: '抖音收藏',
    subtitle: '',
    cover: '',
    videoCount: 1,
    collectionCount: 0,
    updatedAt: '2026-08-07 12:00',
  }
  return serializePersistentLibrary({
    projects: [project],
    mediaAssets: [asset],
    projectAssetRefs: [{
      id: 'douyin-reference',
      projectId: project.id,
      assetId: asset.id,
      order: 0,
      thumbnailFollowsProject: false,
      tags: ['短视频'],
      annotated: false,
      note: '保留到项目',
    }],
    projectTitles: { [project.id]: project.title },
    selectedProjectId: project.id,
  })
}

test('抖音作为默认关闭的关键词搜索来源注册', () => {
  const manifest = ONLINE_PROVIDER_MANIFESTS.douyin
  expect(manifest).toMatchObject({
    id: 'douyin',
    defaultEnabled: false,
    releaseStage: 'beta',
    sessionPartition: 'persist:aurora-online-douyin-v1',
  })
  expect(manifest.capabilities).toEqual(expect.arrayContaining([
    'search',
    'pagination',
    'account',
    'official-playback',
  ]))
  expect(manifest.capabilities).not.toContain('episodes')
  expect(parseOnlineProviderSettings({
    schemaVersion: 1,
    enabled: { bilibili: true, tencent: true, douyin: true },
  }).enabled.douyin).toBe(true)
})

test('收藏或加入项目后的抖音公开视频可安全持久化', () => {
  const canonicalUrl = `https://www.douyin.com/video/${MEDIA_ID}`
  const asset = createDouyinAsset(canonicalUrl)
  const restored = parsePersistentLibrary({ library: createLibrary(asset) })
  expect(restored?.mediaAssets).toEqual([asset])
  expect(restored?.projectAssetRefs).toHaveLength(1)
})

test('抖音持久化拒绝非官方域名、查询参数与非视频种类', () => {
  const assertRejected = (asset: MediaAsset) => {
    const restored = parsePersistentLibrary({ library: createLibrary(asset) })
    expect(restored?.mediaAssets).toEqual([])
    expect(restored?.projectAssetRefs).toEqual([])
  }
  assertRejected(createDouyinAsset(`https://evil.example/video/${MEDIA_ID}`))
  assertRejected(createDouyinAsset(
    `https://www.douyin.com/video/${MEDIA_ID}?from=search`,
  ))
  const episode = createDouyinAsset(`https://www.douyin.com/video/${MEDIA_ID}`)
  episode.online = { ...episode.online!, kind: 'episode' }
  assertRejected(episode)
})

test('抖音登录与验证失败会显示可操作提示且不透传任意错误', () => {
  expect(getOnlineSearchFailureStatus(
    'douyin',
    new Error("Error invoking remote method: 请先登录抖音，再搜索视频。"),
  )).toBe('请先在右上角账号中心登录抖音，再搜索视频')
  expect(getOnlineSearchFailureStatus(
    'douyin',
    { code: 'DOUYIN_VERIFICATION_REQUIRED' },
    true,
  )).toBe('请在弹出的抖音窗口完成验证，再点击此处重试')
  expect(getOnlineSearchFailureStatus(
    'douyin',
    new Error('sensitive backend detail'),
  )).toBeNull()
  expect(getOnlineSearchFailureStatus(
    'youku',
    new Error('请先登录抖音'),
  )).toBeNull()
})

test('抖音播放器单独使用竖屏等比布局且不改变其他在线来源', async ({
  page,
}) => {
  expect(getOnlineEmbeddedPlayerLayout('douyin')).toBe('portrait-contain')
  expect(getOnlineEmbeddedPlayerLayout('bilibili')).toBe('provider-default')
  expect(getOnlineEmbeddedPlayerLayout('tencent')).toBe('provider-default')
  expect(getOnlineEmbeddedPlayerLayout('xinpianchang')).toBe('provider-default')
  expect(getOnlineEmbeddedPlayerLayout('youku')).toBe('provider-default')
  expect(shouldUseOnlinePlayerAmbientFallback('douyin')).toBe(true)
  expect(shouldUseOnlinePlayerAmbientFallback('bilibili')).toBe(false)
  expect(shouldUseOnlinePlayerAmbientFallback('tencent')).toBe(false)
  expect(shouldUseOnlinePlayerAmbientFallback('xinpianchang')).toBe(false)
  expect(shouldUseOnlinePlayerAmbientFallback('youku')).toBe(false)

  const douyinAttributes = createOnlineEmbeddedWebviewAttributes(
    'douyin',
    `https://open.douyin.com/player/video?vid=${MEDIA_ID}&autoplay=1`,
  )
  expect(douyinAttributes).toMatchObject({
    partition: 'persist:aurora-online-douyin-v1',
    allowpopups: 'true',
  })
  for (const provider of [
    'bilibili',
    'tencent',
    'xinpianchang',
    'youku',
  ] as const) {
    expect(createOnlineEmbeddedWebviewAttributes(
      provider,
      'https://example.test/player',
    )).not.toHaveProperty('allowpopups')
  }

  await page.goto('/')
  const colors = await page.evaluate(() => {
    const readSurfaces = (layout: string) => {
      const shell = document.createElement('span')
      shell.className = 'frameRingPreviewOnlinePlayer'
      shell.dataset.onlinePlayerLayout = layout
      const webview = document.createElement('div')
      webview.className = 'frameRingPreviewOnlineWebview'
      webview.dataset.onlinePlayerLayout = layout
      shell.append(webview)
      document.body.append(shell)
      return {
        shell: getComputedStyle(shell).backgroundColor,
        webview: getComputedStyle(webview).backgroundColor,
      }
    }
    return {
      douyin: readSurfaces('portrait-contain'),
      bilibili: readSurfaces('provider-default'),
    }
  })
  expect(colors.douyin).toEqual({
    shell: 'rgb(0, 0, 0)',
    webview: 'rgb(0, 0, 0)',
  })
  expect(colors.bilibili).toEqual({
    shell: 'rgb(3, 6, 10)',
    webview: 'rgb(3, 6, 10)',
  })

  const responsiveLayout = await page.evaluate(() => {
    const readLayout = (width: number) => {
      const shell = document.createElement('span')
      shell.className = 'frameRingPreviewOnlinePlayer'
      shell.dataset.onlinePlayerLayout = 'portrait-contain'
      Object.assign(shell.style, {
        position: 'relative',
        inset: 'auto',
        width: `${width}px`,
        height: `${Math.round(width * 9 / 16)}px`,
      })
      const webview = document.createElement('div')
      webview.className = 'frameRingPreviewOnlineWebview'
      webview.dataset.onlinePlayerLayout = 'portrait-contain'
      shell.append(webview)
      document.body.append(shell)
      const style = getComputedStyle(webview)
      const result = {
        width: style.width,
        height: style.height,
        transform: style.transform,
        transformOrigin: style.transformOrigin,
      }
      shell.remove()
      return result
    }
    return {
      compact: readLayout(430),
      desktop: readLayout(730),
    }
  })
  expect(responsiveLayout.compact).toMatchObject({
    width: '860px',
    transform: 'matrix(0.5, 0, 0, 0.5, 0, 0)',
    transformOrigin: '0px 0px',
  })
  expect(responsiveLayout.desktop).toMatchObject({
    width: '730px',
    transform: 'none',
  })
})

test('抖音播放器加载时使用封面模糊兜底且主体保持完整比例', async ({
  page,
}) => {
  await page.goto('/')
  const styles = await page.evaluate(async () => {
    const shell = document.createElement('span')
    shell.className = 'frameRingPreviewOnlinePlayer'
    shell.dataset.onlinePlayerLayout = 'portrait-contain'
    shell.dataset.onlinePlayerReady = 'false'
    const fallback = document.createElement('span')
    fallback.className = 'frameRingPreviewOnlineAmbientFallback'
    const backdrop = document.createElement('img')
    backdrop.className = 'frameRingPreviewOnlineAmbientBackdrop'
    const subject = document.createElement('img')
    subject.className = 'frameRingPreviewOnlineAmbientSubject'
    fallback.append(backdrop, subject)
    shell.append(fallback)
    document.body.append(shell)

    const initial = {
      fallbackOpacity: getComputedStyle(fallback).opacity,
      backdropFit: getComputedStyle(backdrop).objectFit,
      backdropFilter: getComputedStyle(backdrop).filter,
      subjectFit: getComputedStyle(subject).objectFit,
      subjectPosition: getComputedStyle(subject).objectPosition,
    }
    shell.dataset.onlinePlayerReady = 'true'
    // Leave headroom above the 220ms transition so busy parallel browser
    // workers cannot sample the final composited frame a few milliseconds early.
    await new Promise((resolve) => window.setTimeout(resolve, 420))
    const ready = {
      fallbackOpacity: getComputedStyle(fallback).opacity,
    }
    return { initial, ready }
  })

  expect(styles.initial).toMatchObject({
    fallbackOpacity: '1',
    backdropFit: 'cover',
    subjectFit: 'contain',
    subjectPosition: '50% 50%',
  })
  expect(styles.initial.backdropFilter).toContain('blur(28px)')
  expect(styles.ready).toEqual({
    fallbackOpacity: '0',
  })
})
