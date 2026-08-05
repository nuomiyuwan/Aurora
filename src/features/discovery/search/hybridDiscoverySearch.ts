import type {
  DiscoveryResult,
  DiscoveryResultKind,
} from '../discoveryData'

type StrongLocalMetadataMatchOptions = {
  query: string
  kind: 'all' | DiscoveryResultKind
  resolution: 'all' | DiscoveryResult['resolutionLabel']
  limit: number
}

type RunHybridDiscoverySearchOptions = {
  strongLocalResults: readonly DiscoveryResult[]
  runLocalSearch: () => Promise<readonly DiscoveryResult[]>
  runAiSearch: () => Promise<readonly DiscoveryResult[]>
  limit: number
}

type HybridDiscoverySearchResult = {
  results: DiscoveryResult[]
  aiError: Error | null
}

const normalizeMetadataValue = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')

const filenameForResult = (result: DiscoveryResult) =>
  result.detailType === 'footage'
    ? result.footage.filename
    : result.detailType === 'model'
      ? result.model.filename
      : ''

const filenameStem = (value: string) => value.replace(/\.[^.]+$/, '')

const matchesActiveFilters = (
  result: DiscoveryResult,
  options: StrongLocalMetadataMatchOptions,
) =>
  result.source === 'local' &&
  (options.kind === 'all' || result.kind === options.kind) &&
  (options.resolution === 'all' ||
    result.resolutionLabel === options.resolution)

const strongMetadataMatchScore = (
  result: DiscoveryResult,
  normalizedQuery: string,
) => {
  const filename = normalizeMetadataValue(filenameForResult(result))
  if (filename !== '') {
    if (filename === normalizedQuery) return 2
    if (filenameStem(filename) === normalizedQuery) return 1
  }
  return 0
}

export const findStrongLocalMetadataMatches = (
  results: readonly DiscoveryResult[],
  options: StrongLocalMetadataMatchOptions,
) => {
  const normalizedQuery = normalizeMetadataValue(options.query)
  if (normalizedQuery === '') return []

  return results
    .map((result, originalIndex) => ({
      result,
      originalIndex,
      score:
        matchesActiveFilters(result, options) &&
        (options.kind === 'frame' || result.kind !== 'frame')
        ? strongMetadataMatchScore(result, normalizedQuery)
        : 0,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.originalIndex - right.originalIndex,
    )
    .slice(0, Math.max(1, options.limit))
    .map(({ result }) => result)
}

const appendUniqueResults = (
  target: DiscoveryResult[],
  incoming: readonly DiscoveryResult[],
  seenIds: Set<string>,
  limit: number,
) => {
  for (const result of incoming) {
    if (target.length >= limit) return
    if (seenIds.has(result.id)) continue
    seenIds.add(result.id)
    target.push(result)
  }
}

const mergeHybridResults = (
  localResults: readonly DiscoveryResult[],
  aiResults: readonly DiscoveryResult[],
  limit: number,
) => {
  const normalizedLimit = Math.max(1, limit)
  const merged: DiscoveryResult[] = []
  const seenIds = new Set<string>()
  appendUniqueResults(merged, localResults, seenIds, normalizedLimit)
  appendUniqueResults(merged, aiResults, seenIds, normalizedLimit)
  return merged
}

const asError = (value: unknown) =>
  value instanceof Error ? value : new Error('AI 搜索请求失败')

export async function runHybridDiscoverySearch({
  strongLocalResults,
  runLocalSearch,
  runAiSearch,
  limit,
}: RunHybridDiscoverySearchOptions): Promise<HybridDiscoverySearchResult> {
  if (strongLocalResults.length > 0) {
    return {
      results: strongLocalResults.slice(0, Math.max(1, limit)),
      aiError: null,
    }
  }

  const [localResponse, aiResponse] = await Promise.allSettled([
    runLocalSearch(),
    runAiSearch(),
  ])
  const localResults = localResponse.status === 'fulfilled'
    ? localResponse.value
    : []
  const aiResults = aiResponse.status === 'fulfilled'
    ? aiResponse.value
    : []

  return {
    results: mergeHybridResults(localResults, aiResults, limit),
    aiError:
      aiResponse.status === 'rejected' ? asError(aiResponse.reason) : null,
  }
}
