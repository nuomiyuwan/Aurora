export const ONLINE_MEDIA_PROVIDER_IDS = [
  'bilibili',
  'tencent',
  'xinpianchang',
  'youku',
] as const

export type OnlineMediaProvider = (typeof ONLINE_MEDIA_PROVIDER_IDS)[number]

export type OnlineProviderCapability =
  | 'official-playback'
  | 'search'
  | 'pagination'
  | 'account'
  | 'episodes'
  | 'poster-reflection'

export type OnlineProviderReleaseStage = 'stable' | 'beta'

export type OnlineProviderManifest = {
  schemaVersion: 1
  id: OnlineMediaProvider
  displayName: string
  sourceLabel: string
  shortLabel: string
  codecLabel: string
  releaseStage: OnlineProviderReleaseStage
  defaultEnabled: boolean
  capabilities: readonly OnlineProviderCapability[]
  sessionPartition: string
}

export const ONLINE_PROVIDER_MANIFESTS: Readonly<
  Record<OnlineMediaProvider, OnlineProviderManifest>
> = {
  bilibili: {
    schemaVersion: 1,
    id: 'bilibili',
    displayName: 'B站',
    sourceLabel: 'Bilibili',
    shortLabel: 'B',
    codecLabel: 'Bilibili',
    releaseStage: 'stable',
    defaultEnabled: true,
    capabilities: [
      'official-playback',
      'search',
      'pagination',
      'account',
      'episodes',
      'poster-reflection',
    ],
    sessionPartition: 'persist:aurora-bilibili-v1',
  },
  tencent: {
    schemaVersion: 1,
    id: 'tencent',
    displayName: '腾讯视频',
    sourceLabel: '腾讯视频',
    shortLabel: 'T',
    codecLabel: 'Tencent Video',
    releaseStage: 'stable',
    defaultEnabled: true,
    capabilities: [
      'official-playback',
      'search',
      'account',
      'episodes',
      'poster-reflection',
    ],
    sessionPartition: 'persist:aurora-tencent-v1',
  },
  xinpianchang: {
    schemaVersion: 1,
    id: 'xinpianchang',
    displayName: '新片场',
    sourceLabel: '新片场',
    shortLabel: 'X',
    codecLabel: 'Xinpianchang',
    releaseStage: 'beta',
    defaultEnabled: false,
    capabilities: [
      'official-playback',
      'search',
      'pagination',
      'account',
      'poster-reflection',
    ],
    sessionPartition: 'persist:aurora-online-xinpianchang-v1',
  },
  youku: {
    schemaVersion: 1,
    id: 'youku',
    displayName: '优酷',
    sourceLabel: '优酷',
    shortLabel: 'Y',
    codecLabel: 'Youku',
    releaseStage: 'beta',
    defaultEnabled: false,
    capabilities: [
      'official-playback',
      'search',
      'account',
      'episodes',
      'poster-reflection',
    ],
    sessionPartition: 'persist:aurora-online-youku-v1',
  },
}

export const ONLINE_PROVIDER_SETTINGS_SCHEMA_VERSION = 1

export type OnlineProviderEnabledState = Record<OnlineMediaProvider, boolean>

export type PersistedOnlineProviderSettings = {
  schemaVersion: typeof ONLINE_PROVIDER_SETTINGS_SCHEMA_VERSION
  enabled: OnlineProviderEnabledState
}

export const createDefaultOnlineProviderEnabledState =
  (): OnlineProviderEnabledState =>
    Object.fromEntries(
      ONLINE_MEDIA_PROVIDER_IDS.map((provider) => [
        provider,
        ONLINE_PROVIDER_MANIFESTS[provider].defaultEnabled,
      ]),
    ) as OnlineProviderEnabledState

export const isOnlineMediaProvider = (
  value: unknown,
): value is OnlineMediaProvider =>
  typeof value === 'string' &&
  ONLINE_MEDIA_PROVIDER_IDS.includes(value as OnlineMediaProvider)

export const getOnlineProviderManifest = (provider: OnlineMediaProvider) =>
  ONLINE_PROVIDER_MANIFESTS[provider]

export const getOnlineProviderLabel = (provider: OnlineMediaProvider) =>
  getOnlineProviderManifest(provider).displayName

export const onlineProviderHasCapability = (
  provider: OnlineMediaProvider,
  capability: OnlineProviderCapability,
) => getOnlineProviderManifest(provider).capabilities.includes(capability)

export function parseOnlineProviderSettings(
  value: unknown,
): PersistedOnlineProviderSettings {
  const defaults = createDefaultOnlineProviderEnabledState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      schemaVersion: ONLINE_PROVIDER_SETTINGS_SCHEMA_VERSION,
      enabled: defaults,
    }
  }

  const candidate = value as Record<string, unknown>
  const enabledValue = candidate.enabled
  if (
    candidate.schemaVersion !== ONLINE_PROVIDER_SETTINGS_SCHEMA_VERSION ||
    !enabledValue ||
    typeof enabledValue !== 'object' ||
    Array.isArray(enabledValue)
  ) {
    return {
      schemaVersion: ONLINE_PROVIDER_SETTINGS_SCHEMA_VERSION,
      enabled: defaults,
    }
  }

  const enabledRecord = enabledValue as Record<string, unknown>
  return {
    schemaVersion: ONLINE_PROVIDER_SETTINGS_SCHEMA_VERSION,
    enabled: Object.fromEntries(
      ONLINE_MEDIA_PROVIDER_IDS.map((provider) => [
        provider,
        typeof enabledRecord[provider] === 'boolean'
          ? enabledRecord[provider]
          : defaults[provider],
      ]),
    ) as OnlineProviderEnabledState,
  }
}

export const serializeOnlineProviderSettings = (
  enabled: OnlineProviderEnabledState,
): PersistedOnlineProviderSettings => ({
  schemaVersion: ONLINE_PROVIDER_SETTINGS_SCHEMA_VERSION,
  enabled: Object.fromEntries(
    ONLINE_MEDIA_PROVIDER_IDS.map((provider) => [
      provider,
      Boolean(enabled[provider]),
    ]),
  ) as OnlineProviderEnabledState,
})
