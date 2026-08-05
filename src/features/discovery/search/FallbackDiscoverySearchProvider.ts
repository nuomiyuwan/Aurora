import type {
  DiscoverySearchPage,
  DiscoverySearchProvider,
  DiscoverySearchRequest,
} from './types'

export type DiscoveryProviderFallbackPredicate = (error: unknown) => boolean

export class FallbackDiscoverySearchProvider
  implements DiscoverySearchProvider
{
  readonly id: string
  readonly sources: DiscoverySearchProvider['sources']
  readonly #primary: DiscoverySearchProvider
  readonly #fallback: DiscoverySearchProvider
  readonly #shouldFallback: DiscoveryProviderFallbackPredicate

  constructor(
    id: string,
    primary: DiscoverySearchProvider,
    fallback: DiscoverySearchProvider,
    shouldFallback: DiscoveryProviderFallbackPredicate,
  ) {
    this.id = id
    this.sources = [...new Set([...primary.sources, ...fallback.sources])]
    this.#primary = primary
    this.#fallback = fallback
    this.#shouldFallback = shouldFallback
  }

  async search(
    request: DiscoverySearchRequest,
    signal?: AbortSignal,
  ): Promise<DiscoverySearchPage> {
    try {
      return await this.#primary.search(request, signal)
    } catch (error) {
      if (!this.#shouldFallback(error)) throw error
      return this.#fallback.search(request, signal)
    }
  }
}
