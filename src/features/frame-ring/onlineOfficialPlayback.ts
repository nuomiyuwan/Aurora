import type {
  OnlineMediaKind,
  OnlineMediaProvider,
} from '../../data/mediaLibraryTypes'
import { createBilibiliOfficialPlaybackUrl } from './bilibiliOfficialPlayback'

export type OnlineEmbeddedPlayback = {
  provider: OnlineMediaProvider
  kind: OnlineMediaKind
  mediaId: string
  canonicalUrl: string
}

export type OnlineEmbeddedPlayerLayout =
  | 'provider-default'
  | 'portrait-contain'

export function getOnlineEmbeddedPlayerLayout(
  provider: OnlineMediaProvider,
): OnlineEmbeddedPlayerLayout {
  return provider === 'douyin' ? 'portrait-contain' : 'provider-default'
}

export function shouldUseOnlinePlayerAmbientFallback(
  provider: OnlineMediaProvider,
) {
  return getOnlineEmbeddedPlayerLayout(provider) === 'portrait-contain'
}

const TENCENT_VIDEO_ID = /^[0-9A-Za-z]{11}$/
const TENCENT_COVER_ID = /^[0-9A-Za-z]{11,32}$/
const XINPIANCHANG_ARTICLE_ID = /^[1-9][0-9]{0,15}$/
const YOUKU_SHOW_ID = /^[0-9A-Za-z_-]{6,64}$/
const YOUKU_VIDEO_ID = /^X[0-9A-Za-z_-]{8,80}={0,2}$/
const DOUYIN_VIDEO_ID = /^[1-9][0-9]{18}$/

function parseCanonicalHttpsUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      !parsed.hash
      ? parsed
      : null
  } catch {
    return null
  }
}

function createTencentOfficialPlaybackUrl(
  playback: OnlineEmbeddedPlayback,
) {
  const mediaId = playback.mediaId.trim()
  const parsed = parseCanonicalHttpsUrl(playback.canonicalUrl)
  if (!parsed || parsed.hostname !== 'v.qq.com' || parsed.search) return null

  const videoMatch = /^\/x\/page\/([0-9A-Za-z]{11})\.html$/.exec(
    parsed.pathname,
  )
  if (
    playback.kind === 'video' &&
    TENCENT_VIDEO_ID.test(mediaId) &&
    videoMatch?.[1] === mediaId
  ) {
    return parsed.toString()
  }

  const coverMatch =
    /^\/x\/cover\/([0-9A-Za-z]{11,32})(?:\/[0-9A-Za-z]{11})?\.html$/.exec(
      parsed.pathname,
    )
  return playback.kind === 'episode' &&
    TENCENT_COVER_ID.test(mediaId) &&
    coverMatch?.[1] === mediaId
    ? parsed.toString()
    : null
}

function createXinpianchangOfficialPlaybackUrl(
  playback: OnlineEmbeddedPlayback,
) {
  const mediaId = playback.mediaId.trim()
  const parsed = parseCanonicalHttpsUrl(playback.canonicalUrl)
  if (
    playback.kind !== 'video' ||
    !XINPIANCHANG_ARTICLE_ID.test(mediaId) ||
    !parsed ||
    parsed.hostname !== 'www.xinpianchang.com' ||
    parsed.search ||
    parsed.pathname !== `/a${mediaId}`
  ) {
    return null
  }
  return `https://www.xinpianchang.com/iframe/a${mediaId}`
}

function createYoukuOfficialPlaybackUrl(playback: OnlineEmbeddedPlayback) {
  const mediaId = playback.mediaId.trim()
  const parsed = parseCanonicalHttpsUrl(playback.canonicalUrl)
  if (!parsed || parsed.hostname !== 'v.youku.com') return null

  if (parsed.pathname === '/video' || parsed.pathname === '/video/') {
    const queryKeys = [...parsed.searchParams.keys()]
    if (queryKeys.some((key) => key !== 's' && key !== 'vid')) return null

    const showValues = parsed.searchParams.getAll('s')
    const videoValues = parsed.searchParams.getAll('vid')
    const showId = showValues.length === 1 ? showValues[0] : ''
    const videoId = videoValues.length === 1 ? videoValues[0] : ''
    if (
      playback.kind !== 'episode' ||
      !YOUKU_SHOW_ID.test(mediaId) ||
      showId !== mediaId ||
      (videoValues.length > 0 && !YOUKU_VIDEO_ID.test(videoId)) ||
      showValues.length !== 1 ||
      videoValues.length > 1
    ) {
      return null
    }
    const target = new URL('https://v.youku.com/video')
    target.searchParams.set('s', showId)
    if (videoId) target.searchParams.set('vid', videoId)
    return target.toString()
  }

  const videoMatch = /^\/v_show\/id_(X[0-9A-Za-z_-]{8,80}={0,2})\.html$/.exec(
    parsed.pathname,
  )
  return playback.kind === 'video' &&
    YOUKU_VIDEO_ID.test(mediaId) &&
    videoMatch?.[1] === mediaId &&
    !parsed.search
    ? `https://v.youku.com/v_show/id_${mediaId}.html`
    : null
}

function createDouyinOfficialPlaybackUrl(playback: OnlineEmbeddedPlayback) {
  const mediaId = playback.mediaId.trim()
  const parsed = parseCanonicalHttpsUrl(playback.canonicalUrl)
  if (
    playback.kind !== 'video' ||
    !DOUYIN_VIDEO_ID.test(mediaId) ||
    !parsed ||
    parsed.hostname !== 'www.douyin.com' ||
    parsed.pathname !== `/video/${mediaId}` ||
    parsed.search
  ) {
    return null
  }
  const target = new URL('https://open.douyin.com/player/video')
  target.searchParams.set('vid', mediaId)
  target.searchParams.set('autoplay', '1')
  return target.toString()
}

export function createOnlineOfficialPlaybackUrl(
  playback: OnlineEmbeddedPlayback,
) {
  switch (playback.provider) {
    case 'bilibili':
      return createBilibiliOfficialPlaybackUrl(playback)
    case 'tencent':
      return createTencentOfficialPlaybackUrl(playback)
    case 'xinpianchang':
      return createXinpianchangOfficialPlaybackUrl(playback)
    case 'youku':
      return createYoukuOfficialPlaybackUrl(playback)
    case 'douyin':
      return createDouyinOfficialPlaybackUrl(playback)
  }
}
