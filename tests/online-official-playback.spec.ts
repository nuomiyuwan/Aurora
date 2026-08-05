import { expect, test } from '@playwright/test'
import { createOnlineOfficialPlaybackUrl } from '../src/features/frame-ring/onlineOfficialPlayback'

test('keeps canonical Tencent official playback URLs', () => {
  expect(createOnlineOfficialPlaybackUrl({
    provider: 'tencent',
    kind: 'video',
    mediaId: 'mzc00200abc',
    canonicalUrl: 'https://v.qq.com/x/page/mzc00200abc.html',
  })).toBe('https://v.qq.com/x/page/mzc00200abc.html')
  expect(createOnlineOfficialPlaybackUrl({
    provider: 'tencent',
    kind: 'episode',
    mediaId: 'mzc00200xyz',
    canonicalUrl: 'https://v.qq.com/x/cover/mzc00200xyz/a1b2c3d4e5f.html',
  })).toBe('https://v.qq.com/x/cover/mzc00200xyz/a1b2c3d4e5f.html')
})

test('turns only canonical Xinpianchang articles into official iframe URLs', () => {
  const playback = {
    provider: 'xinpianchang' as const,
    kind: 'video' as const,
    mediaId: '13772048',
    canonicalUrl: 'https://www.xinpianchang.com/a13772048',
  }
  expect(createOnlineOfficialPlaybackUrl(playback)).toBe(
    'https://www.xinpianchang.com/iframe/a13772048',
  )
  expect(createOnlineOfficialPlaybackUrl({
    ...playback,
    canonicalUrl: 'https://www.xinpianchang.com/a13772048?mid=secret',
  })).toBeNull()
  expect(createOnlineOfficialPlaybackUrl({
    ...playback,
    mediaId: '13772049',
  })).toBeNull()
  expect(createOnlineOfficialPlaybackUrl({
    ...playback,
    canonicalUrl: 'https://attacker.example/a13772048',
  })).toBeNull()
})

test('accepts only identity-matched canonical Youku show and video pages', () => {
  const showId = 'a1b2c3d4e5f6'
  const videoId = 'XNTE2NjA5NjI4MA=='
  expect(createOnlineOfficialPlaybackUrl({
    provider: 'youku',
    kind: 'episode',
    mediaId: showId,
    canonicalUrl: `https://v.youku.com/video?s=${showId}`,
  })).toBe(`https://v.youku.com/video?s=${showId}`)
  expect(createOnlineOfficialPlaybackUrl({
    provider: 'youku',
    kind: 'episode',
    mediaId: showId,
    canonicalUrl: `https://v.youku.com/video?s=${showId}&vid=${encodeURIComponent(videoId)}`,
  })).toBe(
    `https://v.youku.com/video?s=${showId}&vid=${encodeURIComponent(videoId)}`,
  )
  expect(createOnlineOfficialPlaybackUrl({
    provider: 'youku',
    kind: 'video',
    mediaId: videoId,
    canonicalUrl: `https://v.youku.com/v_show/id_${videoId}.html`,
  })).toBe(`https://v.youku.com/v_show/id_${videoId}.html`)

  expect(createOnlineOfficialPlaybackUrl({
    provider: 'youku',
    kind: 'episode',
    mediaId: showId,
    canonicalUrl: `https://v.youku.com/video?s=${showId}&from=search`,
  })).toBeNull()
  expect(createOnlineOfficialPlaybackUrl({
    provider: 'youku',
    kind: 'episode',
    mediaId: 'other-show',
    canonicalUrl: `https://v.youku.com/video?s=${showId}`,
  })).toBeNull()
  expect(createOnlineOfficialPlaybackUrl({
    provider: 'youku',
    kind: 'video',
    mediaId: videoId,
    canonicalUrl: `https://evil.example/v_show/id_${videoId}.html`,
  })).toBeNull()
})
