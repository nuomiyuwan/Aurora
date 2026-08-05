import { expect, test } from '@playwright/test'
import { createBilibiliOfficialPlaybackUrl } from '../src/features/frame-ring/bilibiliOfficialPlayback'

test('builds only canonical first-party Bilibili playback pages', () => {
  expect(createBilibiliOfficialPlaybackUrl({
    kind: 'video',
    mediaId: ' BV1xx411c7mD ',
  })).toBe('https://www.bilibili.com/video/BV1xx411c7mD/')
  expect(createBilibiliOfficialPlaybackUrl({
    kind: 'episode',
    mediaId: '733316',
  })).toBe('https://www.bilibili.com/bangumi/play/ep733316')

  expect(createBilibiliOfficialPlaybackUrl({
    kind: 'video',
    mediaId: 'https://attacker.example/BV1xx411c7mD',
  })).toBeNull()
  expect(createBilibiliOfficialPlaybackUrl({
    kind: 'episode',
    mediaId: '../733316',
  })).toBeNull()
})
