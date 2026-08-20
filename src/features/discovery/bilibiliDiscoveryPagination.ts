import type { DiscoveryResult } from './discoveryData'

export const BILIBILI_DISCOVERY_PAGE_SIZE = 12
export const BILIBILI_DISCOVERY_PREFETCH_THRESHOLD = 7

export interface DiscoveryBilibiliSearchRequest {
  query: string
  page: number
  limit: number
}

export interface DiscoveryBilibiliSearchPage {
  results: readonly DiscoveryResult[]
  page: number
  pageSize: number
  totalCount: number | null
  hasMore: boolean
  nextPage: number | null
}

const resultIdentity = (result: DiscoveryResult) =>
  result.detailType === 'online-video'
    ? [
        'online',
        result.online.provider,
        result.online.mediaKind,
        result.online.mediaId,
      ].join(':')
    : `result:${result.id}`

/**
 * Appends a live-search page without disturbing the B站 ranking already on
 * screen. A persisted Aurora result and a later live page can have different
 * result ids for the same video, so both id and provider media identity are
 * de-duplicated.
 */
export const appendUniqueDiscoveryResults = (
  current: DiscoveryResult[],
  incoming: readonly DiscoveryResult[],
): DiscoveryResult[] => {
  const seenIds = new Set(current.map((result) => result.id))
  const seenIdentities = new Set(current.map(resultIdentity))
  const appended = incoming.filter((result) => {
    const identity = resultIdentity(result)
    if (seenIds.has(result.id) || seenIdentities.has(identity)) return false
    seenIds.add(result.id)
    seenIdentities.add(identity)
    return true
  })
  return appended.length > 0 ? [...current, ...appended] : current
}

export const shouldPrefetchNextBilibiliPage = ({
  resultCount,
  windowStart,
  windowSize,
  hasMore,
  loading,
  blocked,
}: {
  resultCount: number
  windowStart: number
  windowSize: number
  hasMore: boolean
  loading: boolean
  blocked: boolean
}) =>
  hasMore &&
  !loading &&
  !blocked &&
  resultCount - (windowStart + windowSize) <=
    BILIBILI_DISCOVERY_PREFETCH_THRESHOLD

export const getDiscoveryProviderPrefetchWindow = ({
  results,
  provider,
  windowStart,
  windowSize,
}: {
  results: readonly Pick<DiscoveryResult, 'source'>[]
  provider: DiscoveryResult['source']
  windowStart: number
  windowSize: number
}) => {
  const normalizedWindowStart = Math.max(0, Math.floor(windowStart))
  const normalizedWindowSize = Math.max(0, Math.floor(windowSize))
  const windowEnd = normalizedWindowStart + normalizedWindowSize
  let resultCount = 0
  let providerWindowStart = 0
  let providerWindowSize = 0

  results.forEach((result, index) => {
    if (result.source !== provider) return
    resultCount += 1
    if (index < normalizedWindowStart) {
      providerWindowStart += 1
    } else if (index < windowEnd) {
      providerWindowSize += 1
    }
  })

  return {
    resultCount,
    windowStart: providerWindowStart,
    windowSize: providerWindowSize,
  }
}
