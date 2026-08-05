import {
  throwIfAborted,
  type DiscoverySearchPage,
  type DiscoverySearchProvider,
  type DiscoverySearchRequest,
} from './types'

export class UnavailableDiscoverySearchProvider
  implements DiscoverySearchProvider
{
  readonly id = 'emby-unavailable'
  readonly sources = ['emby'] as const

  async search(
    _request: DiscoverySearchRequest,
    signal?: AbortSignal,
  ): Promise<DiscoverySearchPage> {
    throwIfAborted(signal)
    return {
      results: [],
      totalCount: 0,
      nextCursor: null,
      connection: 'unavailable',
    }
  }
}
