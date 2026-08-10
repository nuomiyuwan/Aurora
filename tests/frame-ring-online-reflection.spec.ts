import { expect, test } from '@playwright/test'
import {
  acceptFirstFrameRingOnlineReflectionCapture,
  createFrameRingOnlineReflectionPosterSource,
  getFrameRingOnlineReflectionSourceId,
  isSafeFrameRingOnlineReflectionPosterUrl,
  isSafeFrameRingOnlineReflectionSourceUrl,
  resolveFrameRingOnlineReflectionSource,
} from '../src/features/frame-ring/frameRingOnlineReflection'

test('waits for the actual player frame and freezes its first capture', () => {
  const playbackKey = 'video:BV1xx411c7mD'
  const firstFrame =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
  const laterFrame =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD='
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
    firstFrame,
  )
  expect(firstCapture).toEqual({
    playbackKey,
    sourceUrl: firstFrame,
    revision: 1,
    kind: 'capture',
  })
  expect(getFrameRingOnlineReflectionSourceId(firstCapture!)).toContain(
    playbackKey,
  )

  const laterPlaybackFrame = acceptFirstFrameRingOnlineReflectionCapture(
    firstCapture,
    playbackKey,
    laterFrame,
  )
  expect(laterPlaybackFrame).toBe(firstCapture)
  expect(laterPlaybackFrame.sourceUrl).toBe(
    firstFrame,
  )

  expect(
    resolveFrameRingOnlineReflectionSource(
      firstCapture,
      'episode:733316',
    ),
  ).toBeNull()
})

test('uses managed posters only as a temporary source and replaces them', () => {
  const playbackKey = 'xinpianchang:video:13772048'
  const poster = 'aurora-media://file/managed-xinpianchang-poster.jpg'
  expect(isSafeFrameRingOnlineReflectionSourceUrl(poster)).toBe(false)
  expect(isSafeFrameRingOnlineReflectionPosterUrl(poster)).toBe(true)

  const firstPoster = createFrameRingOnlineReflectionPosterSource(
    playbackKey,
    poster,
  )
  expect(firstPoster).toEqual({
    playbackKey,
    sourceUrl: poster,
    revision: 0,
    kind: 'poster',
  })

  const capturedFrame = 'data:image/png;base64,aGVsbG8='
  expect(
    acceptFirstFrameRingOnlineReflectionCapture(
      firstPoster,
      playbackKey,
      capturedFrame,
    ),
  ).toEqual({
    playbackKey,
    sourceUrl: capturedFrame,
    revision: 1,
    kind: 'capture',
  })
})

test('limits poster placeholders to managed and document-owned assets', () => {
  const documentUrl =
    'file:///Applications/Aurora.app/Contents/Resources/app/dist/index.html'
  expect(isSafeFrameRingOnlineReflectionSourceUrl(
    './aurora/project-new-frontier.png',
  )).toBe(false)
  expect(isSafeFrameRingOnlineReflectionPosterUrl(
    './aurora/project-new-frontier.png',
    documentUrl,
  )).toBe(true)
  expect(isSafeFrameRingOnlineReflectionSourceUrl(
    'file:///Users/apple/private.png',
  )).toBe(false)
  expect(isSafeFrameRingOnlineReflectionPosterUrl(
    'file:///Users/apple/private.png',
    documentUrl,
  )).toBe(false)
  expect(isSafeFrameRingOnlineReflectionSourceUrl(
    'https://attacker.example/poster.jpg',
  )).toBe(false)
  expect(isSafeFrameRingOnlineReflectionPosterUrl(
    'https://attacker.example/poster.jpg',
    'https://aurora.local/index.html',
  )).toBe(false)
  expect(isSafeFrameRingOnlineReflectionSourceUrl(
    '/aurora/managed-poster.jpg',
  )).toBe(false)
  expect(isSafeFrameRingOnlineReflectionPosterUrl(
    '/aurora/managed-poster.jpg',
    'https://aurora.local/index.html',
  )).toBe(true)
})
