import type {
  DiscoveryResult,
  DiscoveryResultKind,
  DiscoverySource,
} from '../discoveryData'

export type DiscoverySearchKindFilter = 'all' | DiscoveryResultKind
export type DiscoverySearchResolutionFilter =
  | 'all'
  | DiscoveryResult['resolutionLabel']

export interface DiscoverySearchRequest {
  query: string
  sources?: readonly DiscoverySource[]
  kind?: DiscoverySearchKindFilter
  resolution?: DiscoverySearchResolutionFilter
  cursor?: string | null
  limit?: number
}

export interface DiscoverySearchPage {
  results: DiscoveryResult[]
  totalCount: number
  nextCursor: string | null
  connection: DiscoverySearchConnection
}

export interface DiscoverySearchProvider {
  readonly id: string
  readonly sources: readonly DiscoverySource[]
  search(
    request: DiscoverySearchRequest,
    signal?: AbortSignal,
  ): Promise<DiscoverySearchPage>
}

export interface DiscoverySearchState {
  results: DiscoveryResult[]
  totalCount: number
  nextCursor: string | null
  connection: DiscoverySearchConnection
  isLoading: boolean
  error: Error | null
}

export type DiscoverySearchConnection =
  | 'not-requested'
  | 'unavailable'
  | 'connected'

export const DEFAULT_DISCOVERY_SEARCH_LIMIT = 18

export const normalizeDiscoverySearchRequest = (
  request: DiscoverySearchRequest,
): Required<
  Pick<
    DiscoverySearchRequest,
    'query' | 'sources' | 'kind' | 'resolution' | 'limit'
  >
> & Pick<DiscoverySearchRequest, 'cursor'> => ({
  query: request.query.trim(),
  sources: request.sources?.length
    ? [...new Set(request.sources)]
    : ['local', 'emby', 'bilibili', 'tencent'],
  kind: request.kind ?? 'all',
  resolution: request.resolution ?? 'all',
  cursor: request.cursor ?? null,
  limit: Math.max(
    1,
    Math.min(
      100,
      Math.floor(request.limit ?? DEFAULT_DISCOVERY_SEARCH_LIMIT),
    ),
  ),
})

export const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'

export const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return
  throw new DOMException('The operation was aborted.', 'AbortError')
}
