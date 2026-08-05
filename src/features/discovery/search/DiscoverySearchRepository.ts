import type { DiscoverySource } from '../discoveryData'
import {
  normalizeDiscoverySearchRequest,
  throwIfAborted,
  type DiscoverySearchPage,
  type DiscoverySearchProvider,
  type DiscoverySearchRequest,
} from './types'

interface ProviderCursorState {
  cursor: string | null
  exhausted: boolean
  totalCount: number
  connection: DiscoverySearchPage['connection']
}

interface RepositoryCursor {
  providers: Record<string, ProviderCursorState>
}

const CURSOR_PREFIX = 'aurora-discovery:'

const encodeCursor = (cursor: RepositoryCursor) =>
  `${CURSOR_PREFIX}${encodeURIComponent(JSON.stringify(cursor))}`

const decodeCursor = (value: string | null | undefined): RepositoryCursor => {
  if (!value?.startsWith(CURSOR_PREFIX)) return { providers: {} }
  try {
    const decoded = JSON.parse(
      decodeURIComponent(value.slice(CURSOR_PREFIX.length)),
    ) as Partial<RepositoryCursor>
    return {
      providers:
        decoded.providers && typeof decoded.providers === 'object'
          ? decoded.providers
          : {},
    }
  } catch {
    return { providers: {} }
  }
}

const intersects = (
  providerSources: readonly DiscoverySource[],
  requestedSources: readonly DiscoverySource[],
) => {
  const requested = new Set(requestedSources)
  return providerSources.some((source) => requested.has(source))
}

export class DiscoverySearchRepository {
  readonly #providers: readonly DiscoverySearchProvider[]

  constructor(providers: readonly DiscoverySearchProvider[]) {
    const providerIds = new Set<string>()
    providers.forEach((provider) => {
      if (providerIds.has(provider.id)) {
        throw new Error(`Duplicate Discovery provider id: ${provider.id}`)
      }
      providerIds.add(provider.id)
    })
    this.#providers = [...providers]
  }

  async search(
    request: DiscoverySearchRequest,
    signal?: AbortSignal,
  ): Promise<DiscoverySearchPage> {
    throwIfAborted(signal)
    const normalized = normalizeDiscoverySearchRequest(request)
    const previousCursor = decodeCursor(normalized.cursor)
    const activeProviders = this.#providers.filter(
      (provider) =>
        intersects(provider.sources, normalized.sources) &&
        !previousCursor.providers[provider.id]?.exhausted,
    )

    const pages = await Promise.all(
      activeProviders.map(async (provider) => {
        const previous = previousCursor.providers[provider.id]
        const sources = normalized.sources.filter((source) =>
          provider.sources.includes(source),
        )
        const page = await provider.search(
          {
            ...normalized,
            sources,
            cursor: previous?.cursor ?? null,
          },
          signal,
        )
        return { provider, page }
      }),
    )
    throwIfAborted(signal)

    const nextProviderStates: Record<string, ProviderCursorState> = {
      ...previousCursor.providers,
    }
    pages.forEach(({ provider, page }) => {
      nextProviderStates[provider.id] = {
        cursor: page.nextCursor,
        exhausted: page.nextCursor === null,
        totalCount: Math.max(0, page.totalCount),
        connection: page.connection,
      }
    })

    const seenIds = new Set<string>()
    const results = pages.flatMap(({ page }) =>
      page.results.filter((result) => {
        if (seenIds.has(result.id)) return false
        seenIds.add(result.id)
        return true
      }),
    )
    const relevantProviderIds = this.#providers
      .filter((provider) => intersects(provider.sources, normalized.sources))
      .map((provider) => provider.id)
    const totalCount = relevantProviderIds.reduce(
      (total, providerId) =>
        total + (nextProviderStates[providerId]?.totalCount ?? 0),
      0,
    )
    const hasMore = relevantProviderIds.some(
      (providerId) => !nextProviderStates[providerId]?.exhausted,
    )
    const connection = relevantProviderIds.some(
      (providerId) =>
        nextProviderStates[providerId]?.connection === 'connected',
    )
      ? 'connected'
      : relevantProviderIds.some(
            (providerId) =>
              nextProviderStates[providerId]?.connection === 'unavailable',
          )
        ? 'unavailable'
        : 'not-requested'

    return {
      results,
      totalCount,
      nextCursor: hasMore
        ? encodeCursor({ providers: nextProviderStates })
        : null,
      connection,
    }
  }
}
