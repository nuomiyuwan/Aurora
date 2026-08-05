export type BilibiliEmbeddedPlayback = {
  kind: 'video' | 'episode'
  mediaId: string
}

const BILIBILI_VIDEO_ID = /^BV[0-9A-Za-z]{10}$/
const BILIBILI_EPISODE_ID = /^\d{1,18}$/

export function createBilibiliOfficialPlaybackUrl(
  playback: BilibiliEmbeddedPlayback,
) {
  const mediaId = playback.mediaId.trim()
  if (playback.kind === 'video') {
    if (!BILIBILI_VIDEO_ID.test(mediaId)) return null
    return `https://www.bilibili.com/video/${mediaId}/`
  }
  if (!BILIBILI_EPISODE_ID.test(mediaId)) return null
  return `https://www.bilibili.com/bangumi/play/ep${mediaId}`
}
