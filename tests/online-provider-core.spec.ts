import { expect, test } from '@playwright/test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  ONLINE_PROVIDER_MANIFESTS,
  createOnlineProviderRegistry,
} = require('../electron/onlineProviderRegistry.cjs')
const {
  installOnlinePlayerWebviewFirewall,
} = require('../electron/onlinePlayerWebviewGuard.cjs')

test('主进程平台注册表只分派到显式注册的适配器', async () => {
  const requests: unknown[] = []
  const registry = createOnlineProviderRegistry({
    adapters: {
      xinpianchang: {
        searchVideos: async (request: unknown) => {
          requests.push(request)
          return { results: [] }
        },
      },
    },
  })

  await registry.search({
    provider: 'xinpianchang',
    query: '广告',
    page: 2,
    limit: 9,
    searchType: 'official',
  })
  expect(requests).toEqual([{
    query: '广告', page: 2, limit: 9, searchType: 'official',
  }])
  await expect(
    registry.search({ provider: 'unknown', query: '广告' }),
  ).rejects.toThrow('registered online provider')
})

test('新片场账号能力通过统一注册表调用独立官方会话', async () => {
  const calls: string[] = []
  const registry = createOnlineProviderRegistry({
    adapters: {
      xinpianchang: {
        searchVideos: async () => ({ results: [] }),
        getAuthState: async () => ({ signedIn: true }),
        openLogin: async () => { calls.push('login'); return { signedIn: false } },
        logout: async () => { calls.push('logout'); return { signedIn: false } },
      },
    },
  })
  await expect(registry.getAuthState('xinpianchang')).resolves.toEqual({
    supported: true,
    signedIn: true,
  })
  await expect(registry.openLogin('xinpianchang')).resolves.toEqual({
    supported: true,
    signedIn: false,
  })
  await expect(registry.logout('xinpianchang')).resolves.toEqual({
    supported: true,
    signedIn: false,
  })
  expect(calls).toEqual(['login', 'logout'])
})

test('平台注册表公开新增来源为默认关闭的 beta', () => {
  expect(
    ONLINE_PROVIDER_MANIFESTS.filter(
      (manifest: { id: string }) =>
        manifest.id === 'xinpianchang' || manifest.id === 'youku',
    ).map((manifest: { id: string; releaseStage: string; defaultEnabled: boolean }) => ({
      id: manifest.id,
      releaseStage: manifest.releaseStage,
      defaultEnabled: manifest.defaultEnabled,
    })),
  ).toEqual([
    { id: 'xinpianchang', releaseStage: 'beta', defaultEnabled: false },
    { id: 'youku', releaseStage: 'beta', defaultEnabled: false },
  ])
})

test('优酷平台注册契约公开分页能力', () => {
  const youkuManifest = ONLINE_PROVIDER_MANIFESTS.find(
    (manifest: { id: string }) => manifest.id === 'youku',
  )
  expect(youkuManifest?.capabilities).toContain('pagination')
})

test('中央 webview 防火墙拒绝未知分区和参数不一致', () => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const hostContents = {
    on: (name: string, listener: (...args: unknown[]) => void) => {
      listeners.set(name, listener)
    },
    prependListener: (name: string, listener: (...args: unknown[]) => void) => {
      listeners.set(name, listener)
    },
    removeListener: (name: string) => listeners.delete(name),
  }
  const dispose = installOnlinePlayerWebviewFirewall(hostContents, [
    'persist:aurora-bilibili-v1',
    'persist:aurora-online-youku-v1',
  ])
  const listener = listeners.get('will-attach-webview')!
  const rejected = { preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true } }
  listener(
    rejected,
    { partition: 'persist:untrusted' },
    { partition: 'persist:untrusted' },
  )
  expect(rejected.preventDefaultCalled).toBe(true)

  const accepted = { preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true } }
  listener(
    accepted,
    { partition: 'persist:aurora-online-youku-v1' },
    { partition: 'persist:aurora-online-youku-v1' },
  )
  expect(accepted.preventDefaultCalled).toBe(false)
  dispose()
})
