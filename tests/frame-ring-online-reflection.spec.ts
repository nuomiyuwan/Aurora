import { expect, test } from '@playwright/test'
import {
  acceptFirstFrameRingOnlineReflectionCapture,
  getFrameRingOnlineReflectionSourceId,
  isSafeFrameRingOnlineReflectionSourceUrl,
  resolveFrameRingOnlineReflectionSource,
} from '../src/features/frame-ring/frameRingOnlineReflection'

test('waits for the actual player frame and freezes its first capture', () => {
  const playbackKey = 'video:BV1xx411c7mD'
  expect(resolveFrameRingOnlineReflectionSource(null, playbackKey)).toBeNull()
  expect(
    acceptFirstFrameRingOnlineReflectionCapture(
      null,
      playbackKey,
      null,
    ),
  ).toBeNull()

  const firstCapture = acceptFirstFrameRingOnlineReflectionCapture(
    null,
    playbackKey,
    'data:image/png;base64,first-frame',
  )
  expect(firstCapture).toEqual({
    playbackKey,
    sourceUrl: 'data:image/png;base64,first-frame',
    revision: 1,
  })
  expect(getFrameRingOnlineReflectionSourceId(firstCapture!)).toContain(
    playbackKey,
  )

  const laterPlaybackFrame = acceptFirstFrameRingOnlineReflectionCapture(
    firstCapture,
    playbackKey,
    'data:image/png;base64,later-frame',
  )
  expect(laterPlaybackFrame).toBe(firstCapture)
  expect(laterPlaybackFrame.sourceUrl).toBe(
    'data:image/png;base64,first-frame',
  )

  expect(
    resolveFrameRingOnlineReflectionSource(
      firstCapture,
      'episode:733316',
    ),
  ).toBeNull()
})

test('accepts managed poster URLs and freezes the first static reflection', () => {
  const playbackKey = 'xinpianchang:video:13772048'
  const poster = 'aurora-media://file/managed-xinpianchang-poster.jpg'
  expect(isSafeFrameRingOnlineReflectionSourceUrl(poster)).toBe(true)

  const firstPoster = acceptFirstFrameRingOnlineReflectionCapture(
    null,
    playbackKey,
    poster,
  )
  expect(firstPoster).toEqual({
    playbackKey,
    sourceUrl: poster,
    revision: 1,
  })
  expect(
    acceptFirstFrameRingOnlineReflectionCapture(
      firstPoster,
      playbackKey,
      'aurora-media://file/later-poster.jpg',
    ),
  ).toBe(firstPoster)
})

test('allows document-owned assets but rejects arbitrary remote or local files', () => {
  const documentUrl = 'file:///Applications/Aurora.app/Contents/Resources/app/dist/index.html'
  expect(isSafeFrameRingOnlineReflectionSourceUrl(
    './aurora/project-new-frontier.png',
    documentUrl,
  )).toBe(true)
  expect(isSafeFrameRingOnlineReflectionSourceUrl(
    'file:///Users/apple/private.png',
    documentUrl,
  )).toBe(false)
  expect(isSafeFrameRingOnlineReflectionSourceUrl(
    'https://attacker.example/poster.jpg',
    'https://aurora.local/index.html',
  )).toBe(false)
  expect(isSafeFrameRingOnlineReflectionSourceUrl(
    '/aurora/managed-poster.jpg',
    'https://aurora.local/index.html',
  )).toBe(true)
})
