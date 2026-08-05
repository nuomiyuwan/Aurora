import type { DiscoveryResult } from '../discoveryData'
import type { DiscoverySource } from '../discoveryData'
import {
  normalizeDiscoverySearchRequest,
  throwIfAborted,
  type DiscoverySearchPage,
  type DiscoverySearchProvider,
  type DiscoverySearchRequest,
} from './types'

const tokenize = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('zh-CN')
    .split(/[\s、，,;；/]+/)
    .filter(Boolean)

const createSearchText = (result: DiscoveryResult) =>
  [
    result.title,
    result.secondaryLabel,
    result.sourceCollection,
    result.description,
    ...result.tags,
    ...(result.searchTerms ?? []),
    ...(result.detailType === 'media'
      ? [
          result.media.englishTitle,
          result.media.type,
          ...result.media.genres,
          result.media.director,
          ...result.media.cast,
        ]
      : result.detailType === 'footage'
        ? [
          result.footage.filename,
          result.footage.codec,
          result.footage.camera,
          result.footage.sourcePath,
        ]
        : result.detailType === 'model'
          ? [
            result.model.filename,
            result.model.project,
            result.model.format,
            result.model.size,
            result.model.importedAt,
            result.model.sourcePath,
            result.model.vertexCount,
            result.model.triangleCount,
            result.model.nodeCount,
            result.model.materialCount,
            result.model.textureCount,
            result.model.dimensions,
          ]
          : [
              result.online.mediaId,
              result.online.author,
              result.online.canonicalUrl,
              result.online.publishedAt,
            ]),
  ]
    .join(' ')
    .toLocaleLowerCase('zh-CN')

const readOffset = (cursor: string | null | undefined) => {
  if (!cursor) return 0
  const parsed = Number.parseInt(cursor, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

type LocalDiscoverySearchProviderOptions = {
  getResults: () => readonly DiscoveryResult[]
  id?: string
  sources?: readonly DiscoverySource[]
}

export class LocalDiscoverySearchProvider
  implements DiscoverySearchProvider
{
  readonly id: string
  readonly sources: readonly DiscoverySource[]
  readonly #getResults: () => readonly DiscoveryResult[]

  constructor({
    getResults,
    id = 'aurora-local',
    sources = ['local'],
  }: LocalDiscoverySearchProviderOptions) {
    this.#getResults = getResults
    this.id = id
    this.sources = [...new Set(sources)]
  }

  async search(
    request: DiscoverySearchRequest,
    signal?: AbortSignal,
  ): Promise<DiscoverySearchPage> {
    throwIfAborted(signal)
    const normalized = normalizeDiscoverySearchRequest(request)
    if (!this.sources.some((source) => normalized.sources.includes(source))) {
      return {
        results: [],
        totalCount: 0,
        nextCursor: null,
        connection: 'not-requested',
      }
    }

    const terms = tokenize(normalized.query)
    const matches = this.#getResults()
      .map((result, originalIndex) => {
        const haystack = createSearchText(result)
        const score = terms.reduce(
          (total, term) => total + Number(haystack.includes(term)),
          0,
        )
        return { result, originalIndex, score }
      })
      .filter(({ result, score }) => {
        if (
          !this.sources.includes(result.source) ||
          !normalized.sources.includes(result.source)
        ) return false
        if (terms.length > 0 && score === 0) return false
        if (normalized.kind !== 'all' && result.kind !== normalized.kind) {
          return false
        }
        return normalized.resolution === 'all' ||
          result.resolutionLabel === normalized.resolution
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.originalIndex - right.originalIndex,
      )
      .map(({ result }) => result)

    const offset = Math.min(readOffset(normalized.cursor), matches.length)
    const end = Math.min(matches.length, offset + normalized.limit)
    await Promise.resolve()
    throwIfAborted(signal)

    return {
      results: matches.slice(offset, end),
      totalCount: matches.length,
      nextCursor: end < matches.length ? String(end) : null,
      connection: 'not-requested',
    }
  }
}
