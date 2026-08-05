import type {
  DiscoveryMediaDetails,
  DiscoveryMediaResult,
  DiscoveryMediaType,
  DiscoveryVisualIndexSummary,
} from '../../features/discovery/discoveryData'
import type {
  EmbyItemDto,
  EmbyMediaStreamDto,
  EmbyVisualIndexDto,
} from './embyTypes'

const TICKS_PER_SECOND = 10_000_000

const finiteOr = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? (value as number) : fallback

const firstNonEmpty = (...values: (string | undefined)[]) =>
  values.find((value) => value?.trim())?.trim() ?? ''

const readStreams = (item: EmbyItemDto) =>
  [
    ...(item.MediaStreams ?? []),
    ...(item.MediaSources?.flatMap(
      (source) => source.MediaStreams ?? [],
    ) ?? []),
  ]

const findStream = (streams: readonly EmbyMediaStreamDto[], type: string) =>
  streams.find(
    (stream) => stream.Type?.toLocaleLowerCase('en-US') === type,
  )

const readFrameRate = (stream: EmbyMediaStreamDto | undefined) =>
  Math.max(
    1,
    finiteOr(stream?.RealFrameRate, finiteOr(stream?.AverageFrameRate, 24)),
  )

const ticksToTimecode = (ticks: number | undefined, frameRate: number) => {
  const totalSeconds = Math.max(0, finiteOr(ticks, 0) / TICKS_PER_SECOND)
  const wholeSeconds = Math.floor(totalSeconds)
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const seconds = wholeSeconds % 60
  const frames = Math.min(
    Math.max(0, Math.round(frameRate) - 1),
    Math.floor((totalSeconds - wholeSeconds) * frameRate),
  )
  return [hours, minutes, seconds, frames]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

const inferMediaType = (item: EmbyItemDto): DiscoveryMediaType => {
  const type = item.Type?.toLocaleLowerCase('en-US')
  if (type === 'series' || type === 'episode' || type === 'season') {
    return '电视剧'
  }
  if (
    item.Genres?.some((genre) =>
      /documentary|纪录片/i.test(genre),
    )
  ) {
    return '纪录片'
  }
  return '电影'
}

const createHdrAudioLabel = (
  video: EmbyMediaStreamDto | undefined,
  audio: EmbyMediaStreamDto | undefined,
) => {
  const hdr = firstNonEmpty(
    video?.ExtendedVideoType,
    video?.ExtendedVideoSubType,
    video?.DisplayTitle,
    'SDR',
  )
  const audioCodec = audio?.Codec?.toLocaleUpperCase('en-US') ?? 'Audio'
  const channelLabel =
    audio?.ChannelLayout ??
    (audio?.Channels ? `${audio.Channels}ch` : '')
  return [hdr, [audioCodec, channelLabel].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' · ')
}

const mapVisualIndex = (
  value: EmbyVisualIndexDto | undefined,
): DiscoveryVisualIndexSummary => ({
  status: value?.Status === 'ready' ? 'ready' : 'not-created',
  keyframeCount: Math.max(0, Math.floor(value?.KeyframeCount ?? 0)),
  highlightCount: Math.max(0, Math.floor(value?.HighlightCount ?? 0)),
  favoriteCount: Math.max(0, Math.floor(value?.FavoriteCount ?? 0)),
})

export const createEmbyDiscoveryId = (
  serverId: string,
  itemId: string,
) => `emby:${serverId}:${itemId}`

export const mapEmbyItemToDiscoveryResult = (
  serverId: string,
  item: EmbyItemDto,
  thumbnail = '',
): DiscoveryMediaResult | null => {
  const itemId = item.Id?.trim()
  if (!serverId.trim() || !itemId) return null

  const streams = readStreams(item)
  const video = findStream(streams, 'video')
  const audio = findStream(streams, 'audio')
  const width = Math.max(1, Math.round(video?.Width ?? item.Width ?? 1920))
  const height = Math.max(1, Math.round(video?.Height ?? item.Height ?? 1080))
  const resolutionLabel = width >= 3000 || height >= 1700 ? '4K' : '1080P'
  const frameRate = readFrameRate(video)
  const runtimeTicks =
    item.RunTimeTicks ?? item.MediaSources?.[0]?.RunTimeTicks ?? 0
  const playbackTicks = item.UserData?.PlaybackPositionTicks ?? 0
  const title = firstNonEmpty(item.Name, item.OriginalTitle, '未命名媒体')
  const collection = firstNonEmpty(
    item.CollectionName,
    item.SeriesName,
    item.Album,
    '媒体库',
  )
  const people = item.People ?? []
  const directors = people
    .filter((person) => person.Type?.toLocaleLowerCase('en-US') === 'director')
    .map((person) => person.Name?.trim())
    .filter((name): name is string => Boolean(name))
  const cast = people
    .filter((person) => person.Type?.toLocaleLowerCase('en-US') === 'actor')
    .map((person) => person.Name?.trim())
    .filter((name): name is string => Boolean(name))
  const genres = (item.Genres ?? []).filter(Boolean)
  const media: DiscoveryMediaDetails = {
    englishTitle: firstNonEmpty(item.OriginalTitle, item.Name, '—'),
    year: item.ProductionYear
      ? String(item.ProductionYear)
      : item.PremiereDate?.slice(0, 4) || '—',
    type: inferMediaType(item),
    genres,
    director: directors.join('、') || '—',
    cast,
    hdrAudio: createHdrAudioLabel(video, audio),
  }

  return {
    id: createEmbyDiscoveryId(serverId, itemId),
    title,
    secondaryLabel: media.englishTitle,
    sourceCollection: `Emby · ${collection}`,
    thumbnail,
    timecode: ticksToTimecode(playbackTicks, frameRate),
    duration: ticksToTimecode(runtimeTicks, frameRate),
    resolution: `${width} × ${height}`,
    resolutionLabel,
    source: 'emby',
    detailType: 'media',
    // The current UI exposes clip/frame filters only. Raw Emby media remains
    // clip-compatible until the UI adds a distinct media filter.
    kind: 'clip',
    description: item.Overview?.trim() || '来自 Emby 媒体库的视频内容。',
    tags: [...new Set([...(item.Tags ?? []), ...genres])].slice(0, 12),
    previewProgress:
      runtimeTicks > 0
        ? Math.max(0, Math.min(100, (playbackTicks / runtimeTicks) * 100))
        : 0,
    media,
    visualIndex: mapVisualIndex(item.AuroraVisualIndex),
  }
}
