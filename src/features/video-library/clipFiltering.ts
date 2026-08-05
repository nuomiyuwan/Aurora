export const ALL_CLIP_FILTER_VALUE = 'all' as const
export const UNKNOWN_CLIP_FILTER_VALUE = 'unknown' as const

export type ClipStatusFilter =
  | typeof ALL_CLIP_FILTER_VALUE
  | 'favorite'
  | 'indexed'
  | 'unindexed'

export type ClipDateSort = 'default' | 'newest' | 'oldest'

export type ClipDurationFilter =
  | typeof ALL_CLIP_FILTER_VALUE
  | 'under60'
  | '60to300'
  | '300to1200'
  | 'over1200'
  | typeof UNKNOWN_CLIP_FILTER_VALUE

export interface ClipFilterState {
  status: ClipStatusFilter
  dateSort: ClipDateSort
  resolution: string
  duration: ClipDurationFilter
  tag: string
}

export const DEFAULT_CLIP_FILTER_STATE: Readonly<ClipFilterState> = {
  status: ALL_CLIP_FILTER_VALUE,
  dateSort: 'default',
  resolution: ALL_CLIP_FILTER_VALUE,
  duration: ALL_CLIP_FILTER_VALUE,
  tag: ALL_CLIP_FILTER_VALUE,
}

export interface FilterableVideoClip {
  filename: string
  tags: readonly string[]
  order?: number | null
  note?: string | null
  codec?: string | null
  resolution?: string | null
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  capturedAt?: string | null
  favorite?: boolean
  hasVisualIndex?: boolean
  sampleCount?: number | null
  indexedFrames?: readonly unknown[] | null
}

function normalizeDimension(value: number | null | undefined) {
  if (!Number.isFinite(value) || value === null || value === undefined || value <= 0) {
    return null
  }

  return Math.round(value)
}

function parseResolution(value: string | null | undefined) {
  if (!value) return null

  const match = value.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return null

  const width = Number.parseInt(match[1], 10)
  const height = Number.parseInt(match[2], 10)
  if (width <= 0 || height <= 0) return null

  return { width, height }
}

export function getClipResolutionKey(
  clip: Pick<FilterableVideoClip, 'width' | 'height' | 'resolution'>,
) {
  const width = normalizeDimension(clip.width)
  const height = normalizeDimension(clip.height)

  if (width !== null && height !== null) {
    return `${width}x${height}`
  }

  const parsed = parseResolution(clip.resolution)
  if (!parsed) return UNKNOWN_CLIP_FILTER_VALUE

  return `${parsed.width}x${parsed.height}`
}

export function formatClipResolutionKey(key: string) {
  if (key === UNKNOWN_CLIP_FILTER_VALUE) return '待分析'

  const parsed = parseResolution(key)
  if (!parsed) return key

  return `${parsed.width} × ${parsed.height}`
}

export function hasClipVisualIndex(
  clip: Pick<
    FilterableVideoClip,
    'hasVisualIndex' | 'sampleCount' | 'indexedFrames'
  >,
) {
  if (typeof clip.hasVisualIndex === 'boolean') return clip.hasVisualIndex

  return (
    (Number.isFinite(clip.sampleCount) && (clip.sampleCount ?? 0) > 0) ||
    (clip.indexedFrames?.length ?? 0) > 0
  )
}

function getDurationBucket(
  durationSeconds: number | null | undefined,
): Exclude<ClipDurationFilter, typeof ALL_CLIP_FILTER_VALUE> {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds === null ||
    durationSeconds === undefined ||
    durationSeconds <= 0
  ) {
    return UNKNOWN_CLIP_FILTER_VALUE
  }

  if (durationSeconds < 60) return 'under60'
  if (durationSeconds < 300) return '60to300'
  if (durationSeconds < 1200) return '300to1200'
  return 'over1200'
}

export function getClipCapturedAtSortValue(value: string | null | undefined) {
  if (!value) return null

  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  )
  if (!match) return null

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  const hour = Number.parseInt(match[4] ?? '0', 10)
  const minute = Number.parseInt(match[5] ?? '0', 10)
  const second = Number.parseInt(match[6] ?? '0', 10)
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second)
  const validated = new Date(timestamp)

  if (
    validated.getUTCFullYear() !== year ||
    validated.getUTCMonth() !== month - 1 ||
    validated.getUTCDate() !== day ||
    validated.getUTCHours() !== hour ||
    validated.getUTCMinutes() !== minute ||
    validated.getUTCSeconds() !== second
  ) {
    return null
  }

  return timestamp
}

function matchesSearch(clip: FilterableVideoClip, query: string) {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) return true

  const resolutionKey = getClipResolutionKey(clip)
  const haystack = [
    clip.filename,
    ...clip.tags,
    clip.note ?? '',
    clip.codec ?? '',
    clip.resolution ?? '',
    resolutionKey === UNKNOWN_CLIP_FILTER_VALUE ? '' : resolutionKey,
    formatClipResolutionKey(resolutionKey),
  ]
    .join(' ')
    .toLocaleLowerCase()

  return terms.every((term) => haystack.includes(term))
}

function matchesStatus(clip: FilterableVideoClip, status: ClipStatusFilter) {
  if (status === ALL_CLIP_FILTER_VALUE) return true
  if (status === 'favorite') return Boolean(clip.favorite)

  const indexed = hasClipVisualIndex(clip)
  return status === 'indexed' ? indexed : !indexed
}

function matchesTag(clip: FilterableVideoClip, tag: string) {
  if (tag === ALL_CLIP_FILTER_VALUE) return true

  const normalizedTag = tag.trim().toLocaleLowerCase()
  return clip.tags.some(
    (clipTag) => clipTag.trim().toLocaleLowerCase() === normalizedTag,
  )
}

function getClipOrder(
  clip: Pick<FilterableVideoClip, 'order'>,
  fallback: number,
) {
  return typeof clip.order === 'number' && Number.isFinite(clip.order)
    ? clip.order
    : fallback
}

function compareProjectOrder(
  left: {
    clip: Pick<FilterableVideoClip, 'order'>
    originalIndex: number
  },
  right: {
    clip: Pick<FilterableVideoClip, 'order'>
    originalIndex: number
  },
) {
  return (
    getClipOrder(left.clip, left.originalIndex) -
      getClipOrder(right.clip, right.originalIndex) ||
    left.originalIndex - right.originalIndex
  )
}

export function filterAndSortVideoClips<T extends FilterableVideoClip>(
  clips: readonly T[],
  filterState: Partial<ClipFilterState> = DEFAULT_CLIP_FILTER_STATE,
  query = '',
) {
  const filters: ClipFilterState = {
    ...DEFAULT_CLIP_FILTER_STATE,
    ...filterState,
  }

  const filtered = clips
    .map((clip, originalIndex) => ({ clip, originalIndex }))
    .filter(({ clip }) => {
      if (!matchesSearch(clip, query)) return false
      if (!matchesStatus(clip, filters.status)) return false
      if (!matchesTag(clip, filters.tag)) return false

      if (
        filters.resolution !== ALL_CLIP_FILTER_VALUE &&
        getClipResolutionKey(clip) !== filters.resolution
      ) {
        return false
      }

      return (
        filters.duration === ALL_CLIP_FILTER_VALUE ||
        getDurationBucket(clip.durationSeconds) === filters.duration
      )
    })

  if (filters.dateSort === 'default') {
    return filtered.sort(compareProjectOrder).map(({ clip }) => clip)
  }

  return filtered
    .sort((left, right) => {
      const leftDate = getClipCapturedAtSortValue(left.clip.capturedAt)
      const rightDate = getClipCapturedAtSortValue(right.clip.capturedAt)

      if (leftDate === null && rightDate === null) {
        return left.originalIndex - right.originalIndex
      }
      if (leftDate === null) return 1
      if (rightDate === null) return -1

      const dateDifference =
        filters.dateSort === 'newest'
          ? rightDate - leftDate
          : leftDate - rightDate

      return dateDifference || compareProjectOrder(left, right)
    })
    .map(({ clip }) => clip)
}

export function getClipResolutionOptions(
  clips: readonly FilterableVideoClip[],
) {
  const uniqueKeys = new Set(clips.map(getClipResolutionKey))

  return [...uniqueKeys].sort((left, right) => {
    if (left === UNKNOWN_CLIP_FILTER_VALUE) return 1
    if (right === UNKNOWN_CLIP_FILTER_VALUE) return -1

    const leftResolution = parseResolution(left)
    const rightResolution = parseResolution(right)
    const leftPixels =
      (leftResolution?.width ?? 0) * (leftResolution?.height ?? 0)
    const rightPixels =
      (rightResolution?.width ?? 0) * (rightResolution?.height ?? 0)

    return rightPixels - leftPixels || left.localeCompare(right)
  })
}

export function getClipTagOptions(clips: readonly FilterableVideoClip[]) {
  const tags = new Map<string, string>()

  clips.forEach((clip) => {
    clip.tags.forEach((tag) => {
      const trimmedTag = tag.trim()
      const normalizedTag = trimmedTag.toLocaleLowerCase()
      if (trimmedTag && !tags.has(normalizedTag)) {
        tags.set(normalizedTag, trimmedTag)
      }
    })
  })

  return [...tags.values()].sort((left, right) =>
    left.localeCompare(right, 'zh-CN'),
  )
}

export function isClipFilterStateActive(
  filterState: Partial<ClipFilterState>,
) {
  const filters = {
    ...DEFAULT_CLIP_FILTER_STATE,
    ...filterState,
  }

  return (
    filters.status !== DEFAULT_CLIP_FILTER_STATE.status ||
    filters.dateSort !== DEFAULT_CLIP_FILTER_STATE.dateSort ||
    filters.resolution !== DEFAULT_CLIP_FILTER_STATE.resolution ||
    filters.duration !== DEFAULT_CLIP_FILTER_STATE.duration ||
    filters.tag !== DEFAULT_CLIP_FILTER_STATE.tag
  )
}
