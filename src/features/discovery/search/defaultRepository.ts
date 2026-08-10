import {
  createRendererEmbyBridgeAdapter,
  EmbyConnectionUnavailableError,
} from '../../../integrations/emby/embyBridgeAdapter'
import { EmbyDiscoverySearchProvider } from '../../../integrations/emby/EmbyDiscoverySearchProvider'
import { DiscoverySearchRepository } from './DiscoverySearchRepository'
import { FallbackDiscoverySearchProvider } from './FallbackDiscoverySearchProvider'
import { LocalDiscoverySearchProvider } from './LocalDiscoverySearchProvider'
import { UnavailableDiscoverySearchProvider } from './UnavailableDiscoverySearchProvider'
import type { DiscoveryResult } from '../discoveryData'

export const createDefaultDiscoverySearchRepository = (
  getLocalResults: () => readonly DiscoveryResult[],
) => {
  const localProvider = new LocalDiscoverySearchProvider({ getResults: getLocalResults })
  const onlineProvider = new LocalDiscoverySearchProvider({
    id: 'aurora-online-library',
    sources: ['bilibili', 'tencent', 'xinpianchang', 'youku', 'douyin'],
    getResults: getLocalResults,
  })
  const embyProvider = new EmbyDiscoverySearchProvider(
    createRendererEmbyBridgeAdapter(),
  )
  const embyWithFallback = new FallbackDiscoverySearchProvider(
    'emby',
    embyProvider,
    new UnavailableDiscoverySearchProvider(),
    (error) => error instanceof EmbyConnectionUnavailableError,
  )

  return new DiscoverySearchRepository([
    localProvider,
    onlineProvider,
    embyWithFallback,
  ])
}
