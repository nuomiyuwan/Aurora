const ONLINE_PROVIDER_MANIFESTS = Object.freeze([
  Object.freeze({
    schemaVersion: 1,
    id: 'bilibili',
    displayName: 'B站',
    adapterVersion: 1,
    releaseStage: 'stable',
    defaultEnabled: true,
    capabilities: Object.freeze([
      'official-playback',
      'search',
      'pagination',
      'account',
      'episodes',
      'poster-reflection',
    ]),
  }),
  Object.freeze({
    schemaVersion: 1,
    id: 'tencent',
    displayName: '腾讯视频',
    adapterVersion: 1,
    releaseStage: 'stable',
    defaultEnabled: true,
    capabilities: Object.freeze([
      'official-playback',
      'search',
      'account',
      'episodes',
      'poster-reflection',
    ]),
  }),
  Object.freeze({
    schemaVersion: 1,
    id: 'xinpianchang',
    displayName: '新片场',
    adapterVersion: 1,
    releaseStage: 'beta',
    defaultEnabled: false,
    capabilities: Object.freeze([
      'official-playback',
      'search',
      'pagination',
      'account',
      'poster-reflection',
    ]),
  }),
  Object.freeze({
    schemaVersion: 1,
    id: 'youku',
    displayName: '优酷',
    adapterVersion: 1,
    releaseStage: 'beta',
    defaultEnabled: false,
    capabilities: Object.freeze([
      'official-playback',
      'search',
      'pagination',
      'account',
      'episodes',
      'poster-reflection',
    ]),
  }),
])

const MANIFEST_BY_ID = new Map(
  ONLINE_PROVIDER_MANIFESTS.map((manifest) => [manifest.id, manifest]),
)

function normalizeProviderId(value) {
  return typeof value === 'string' && MANIFEST_BY_ID.has(value)
    ? value
    : null
}

function publicManifest(manifest) {
  return {
    ...manifest,
    capabilities: [...manifest.capabilities],
  }
}

function boundedText(value, maximumLength) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength)
}

function formatDuration(value, secondsValue, providerName) {
  const duration = boundedText(value, 80)
  if (duration) return duration
  const seconds = Number(secondsValue)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return `由${providerName}页面提供`
  }
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3_600)
  const minutes = Math.floor((rounded % 3_600) / 60)
  const rest = rounded % 60
  return (hours > 0 ? [hours, minutes, rest] : [minutes, rest])
    .map((component) => String(component).padStart(2, '0'))
    .join(':')
}

function normalizeSearchResponse(provider, response, request) {
  const manifest = MANIFEST_BY_ID.get(provider)
  const page = Number.isSafeInteger(response?.page) && response.page > 0
    ? response.page
    : Number.isSafeInteger(request?.page) && request.page > 0
      ? request.page
      : 1
  const pageSize = Number.isSafeInteger(response?.pageSize) &&
      response.pageSize > 0
    ? response.pageSize
    : Number.isSafeInteger(request?.limit) && request.limit > 0
      ? request.limit
      : 12
  const results = (Array.isArray(response?.results) ? response.results : [])
    .flatMap((result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return []
      }
      const kind = result.kind === 'episode' ? 'episode' : 'video'
      const mediaId = boundedText(result.mediaId, 120)
      const canonicalUrl = boundedText(
        result.canonicalUrl || result.url,
        2_048,
      )
      if (!mediaId || !canonicalUrl) return []
      const thumbnailPath = typeof result.thumbnailPath === 'string' &&
          result.thumbnailPath.trim()
        ? result.thumbnailPath
        : null
      const coverUrl = typeof result.coverUrl === 'string' &&
          result.coverUrl.trim()
        ? result.coverUrl
        : null
      return [{
        source: provider,
        kind,
        mediaId,
        title: boundedText(result.title, 300) || mediaId,
        description: boundedText(result.description, 2_000),
        coverUrl,
        thumbnailPath,
        author: boundedText(result.author, 300) || '未公开',
        url: canonicalUrl,
        canonicalUrl,
        duration: formatDuration(
          result.duration,
          result.durationSeconds,
          manifest.displayName,
        ),
        publishedAt: boundedText(result.publishedAt, 100),
        tags: (Array.isArray(result.tags) ? result.tags : [])
          .map((tag) => boundedText(tag, 80))
          .filter(Boolean)
          .slice(0, 12),
      }]
    })
  const totalCount = Number.isSafeInteger(response?.totalCount) &&
      response.totalCount >= 0
    ? Math.max(results.length, response.totalCount)
    : results.length
  const hasMore = Boolean(response?.hasMore)
  const nextPage = hasMore && Number.isSafeInteger(response?.nextPage) &&
      response.nextPage > page
    ? response.nextPage
    : null
  return {
    query: boundedText(response?.query || request?.query, 160),
    page,
    pageSize,
    totalCount,
    hasMore: nextPage !== null,
    nextPage,
    results,
  }
}

function createOnlineProviderRegistry({ adapters = {} } = {}) {
  const adapterById = new Map()
  for (const [provider, adapter] of Object.entries(adapters)) {
    if (!normalizeProviderId(provider)) {
      throw new TypeError(`Unknown online provider adapter: ${provider}`)
    }
    if (!adapter || typeof adapter !== 'object') {
      throw new TypeError(`Online provider adapter ${provider} is invalid`)
    }
    adapterById.set(provider, adapter)
  }

  const requireProvider = (value) => {
    const provider = normalizeProviderId(value)
    if (!provider) throw new TypeError('A registered online provider is required')
    return provider
  }

  const requireCapability = (provider, capability, method) => {
    const manifest = MANIFEST_BY_ID.get(provider)
    const adapter = adapterById.get(provider)
    if (
      !manifest?.capabilities.includes(capability) ||
      typeof adapter?.[method] !== 'function'
    ) {
      throw new TypeError(
        `${manifest?.displayName ?? provider} does not support ${capability}`,
      )
    }
    return adapter
  }

  return {
    listManifests() {
      return ONLINE_PROVIDER_MANIFESTS.map(publicManifest)
    },
    async search(request = {}) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new TypeError('An online provider search request is required')
      }
      const provider = requireProvider(request.provider)
      const adapter = requireCapability(
        provider,
        'search',
        'searchVideos',
      )
      const normalizedRequest = {
        query: request.query,
        page: request.page,
        limit: request.limit,
      }
      const response = await adapter.searchVideos(normalizedRequest)
      return normalizeSearchResponse(provider, response, normalizedRequest)
    },
    async getAuthState(providerValue) {
      const provider = requireProvider(providerValue)
      const manifest = MANIFEST_BY_ID.get(provider)
      if (!manifest.capabilities.includes('account')) {
        return { supported: false, signedIn: false }
      }
      const adapter = requireCapability(
        provider,
        'account',
        'getAuthState',
      )
      const state = await adapter.getAuthState()
      return { supported: true, signedIn: Boolean(state?.signedIn) }
    },
    async openLogin(providerValue) {
      const provider = requireProvider(providerValue)
      const adapter = requireCapability(provider, 'account', 'openLogin')
      const state = await adapter.openLogin()
      return { supported: true, signedIn: Boolean(state?.signedIn) }
    },
    async logout(providerValue) {
      const provider = requireProvider(providerValue)
      const adapter = requireCapability(provider, 'account', 'logout')
      const state = await adapter.logout()
      return { supported: true, signedIn: Boolean(state?.signedIn) }
    },
    closeWindows() {
      for (const adapter of adapterById.values()) {
        adapter.closeWindows?.()
      }
    },
    dispose() {
      for (const adapter of adapterById.values()) {
        adapter.dispose?.()
      }
      adapterById.clear()
    },
  }
}

module.exports = {
  ONLINE_PROVIDER_MANIFESTS,
  createOnlineProviderRegistry,
  normalizeProviderId,
  normalizeSearchResponse,
}
