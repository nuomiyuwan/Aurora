import type { DiscoveryResult, DiscoverySource } from './discoveryData'
import type {
  DiscoverySearchKindFilter,
  DiscoverySearchResolutionFilter,
} from './search/types'

export interface MergeBilibiliDiscoverySearchResultsOptions {
  directResults: readonly DiscoveryResult[]
  repositoryResults: readonly DiscoveryResult[]
  kind: DiscoverySearchKindFilter
  resolution: DiscoverySearchResolutionFilter
  limit?: number
}

export const shouldRunDirectBilibiliSearch = (
  source: DiscoverySource | 'all',
) => source === 'all' || source === 'bilibili'

const matchesFilters = (
  result: DiscoveryResult,
  kind: DiscoverySearchKindFilter,
  resolution: DiscoverySearchResolutionFilter,
) =>
  result.source === 'bilibili' &&
  result.detailType === 'online-video' &&
  (kind === 'all' || result.kind === kind) &&
  (resolution === 'all' || result.resolutionLabel === resolution)

const resultIdentity = (result: DiscoveryResult) =>
  result.detailType === 'online-video'
    ? `online:${result.online.provider}:${result.online.mediaKind}:${result.online.mediaId}`
    : `result:${result.id}`

/**
 * Keeps Bilibili's live search ranking while de-duplicating any matching
 * Aurora-library entries returned by the regular discovery repository.
 */
export const mergeBilibiliDiscoverySearchResults = ({
  directResults,
  repositoryResults,
  kind,
  resolution,
  limit = 18,
}: MergeBilibiliDiscoverySearchResultsOptions): DiscoveryResult[] => {
  const merged: DiscoveryResult[] = []
  const seenIds = new Set<string>()
  const seenIdentities = new Set<string>()
  const boundedLimit = Math.max(1, Math.floor(limit))

  const append = (result: DiscoveryResult) => {
    if (merged.length >= boundedLimit) return
    const identity = resultIdentity(result)
    if (seenIds.has(result.id) || seenIdentities.has(identity)) return
    seenIds.add(result.id)
    seenIdentities.add(identity)
    merged.push(result)
  }

  directResults
    .filter((result) => matchesFilters(result, kind, resolution))
    .forEach(append)
  repositoryResults.forEach(append)

  return merged
}
