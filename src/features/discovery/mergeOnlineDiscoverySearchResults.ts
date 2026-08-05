import type {
  DiscoveryResult,
  DiscoverySource,
} from './discoveryData'
import type {
  DiscoverySearchKindFilter,
  DiscoverySearchResolutionFilter,
} from './search/types'
import type { OnlineMediaProvider } from '../../data/onlineProviderRegistry'

type OnlineDiscoverySource = Extract<DiscoverySource, OnlineMediaProvider>

export interface MergeOnlineDiscoverySearchResultsOptions {
  provider: OnlineDiscoverySource
  directResults: readonly DiscoveryResult[]
  repositoryResults: readonly DiscoveryResult[]
  kind: DiscoverySearchKindFilter
  resolution: DiscoverySearchResolutionFilter
  limit?: number
}

export interface MergeBalancedOnlineDiscoverySearchResultsOptions {
  providers: readonly OnlineMediaProvider[]
  directResultsByProvider: Partial<
    Record<OnlineMediaProvider, readonly DiscoveryResult[]>
  >
  repositoryResults: readonly DiscoveryResult[]
  kind: DiscoverySearchKindFilter
  resolution: DiscoverySearchResolutionFilter
  limit?: number
}

export const shouldRunDirectOnlineSearch = (
  source: DiscoverySource | 'all',
  provider: OnlineDiscoverySource,
) => source === 'all' || source === provider

const resultIdentity = (result: DiscoveryResult) =>
  result.detailType === 'online-video'
    ? `online:${result.online.provider}:${result.online.mediaKind}:${result.online.mediaId}`
    : `result:${result.id}`

const resultMatchesFilters = (
  result: DiscoveryResult,
  kind: DiscoverySearchKindFilter,
  resolution: DiscoverySearchResolutionFilter,
) =>
  (kind === 'all' || result.kind === kind) &&
  (resolution === 'all' || result.resolutionLabel === resolution)

/**
 * Produces the mixed-source card order used by “全部来源”. Every enabled
 * online provider and every repository source gets one turn per round, so a
 * provider returning a full first page cannot bury all other sources. Direct
 * provider results stay ahead of persisted results from the same provider and
 * are de-duplicated by stable online media identity.
 */
export const mergeBalancedOnlineDiscoverySearchResults = ({
  providers,
  directResultsByProvider,
  repositoryResults,
  kind,
  resolution,
  limit = 18,
}: MergeBalancedOnlineDiscoverySearchResultsOptions): DiscoveryResult[] => {
  const boundedLimit = Math.max(1, Math.floor(limit))
  const providerSet = new Set(providers)
  const repositoryGroups = new Map<DiscoverySource, DiscoveryResult[]>()

  repositoryResults
    .filter((result) => resultMatchesFilters(result, kind, resolution))
    .forEach((result) => {
      const group = repositoryGroups.get(result.source) ?? []
      group.push(result)
      repositoryGroups.set(result.source, group)
    })

  const queues: DiscoveryResult[][] = []
  providers.forEach((provider) => {
    const direct = (directResultsByProvider[provider] ?? []).filter(
      (result) =>
        result.source === provider &&
        result.detailType === 'online-video' &&
        resultMatchesFilters(result, kind, resolution),
    )
    const persisted = repositoryGroups.get(provider) ?? []
    repositoryGroups.delete(provider)
    queues.push([...direct, ...persisted])
  })

  repositoryGroups.forEach((results, source) => {
    if (!providerSet.has(source as OnlineMediaProvider)) queues.push(results)
  })

  const merged: DiscoveryResult[] = []
  const seenIds = new Set<string>()
  const seenIdentities = new Set<string>()
  const offsets = queues.map(() => 0)
  let madeProgress = true

  while (merged.length < boundedLimit && madeProgress) {
    madeProgress = false
    queues.forEach((queue, queueIndex) => {
      if (merged.length >= boundedLimit) return
      while (offsets[queueIndex] < queue.length) {
        const result = queue[offsets[queueIndex]]
        offsets[queueIndex] += 1
        const identity = resultIdentity(result)
        if (seenIds.has(result.id) || seenIdentities.has(identity)) continue
        seenIds.add(result.id)
        seenIdentities.add(identity)
        merged.push(result)
        madeProgress = true
        break
      }
    })
  }

  return merged
}

export const mergeOnlineDiscoverySearchResults = ({
  provider,
  directResults,
  repositoryResults,
  kind,
  resolution,
  limit = 18,
}: MergeOnlineDiscoverySearchResultsOptions): DiscoveryResult[] => {
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
    .filter((result) =>
      result.source === provider &&
      result.detailType === 'online-video' &&
      resultMatchesFilters(result, kind, resolution),
    )
    .forEach(append)
  repositoryResults.forEach(append)
  return merged
}
