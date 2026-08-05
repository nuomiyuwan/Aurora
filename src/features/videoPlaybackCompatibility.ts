const normalizeVideoCodecLabel = (codec: string) =>
  codec.trim().toLowerCase().replace(/[\s._-]+/g, '')

/**
 * MPEG-4 Part 2 inside an MP4 can leave Chromium playing only the AAC track:
 * `play()` succeeds and no media error is emitted, but no video frame advances.
 * This one deterministic case should skip the failed direct attempt while
 * platform-dependent codecs such as HEVC continue to use direct-first playback.
 */
export const requiresKnownVideoPreviewProxy = (codec: string) => {
  const normalized = normalizeVideoCodecLabel(codec)
  return (
    normalized === 'mpeg4' ||
    normalized === 'mpeg4part2' ||
    normalized.startsWith('mp4v')
  )
}
