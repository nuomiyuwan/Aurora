import { expect, test } from '@playwright/test'
import {
  ONLINE_MEDIA_PROVIDER_IDS,
  ONLINE_PROVIDER_MANIFESTS,
  createDefaultOnlineProviderEnabledState,
  getOnlineProviderSearchTypeOptions,
  normalizeOnlineProviderSearchType,
  parseOnlineProviderSettings,
  serializeOnlineProviderSettings,
} from '../src/data/onlineProviderRegistry'

test('已有在线源默认启用，新增试点来源默认关闭', () => {
  expect(createDefaultOnlineProviderEnabledState()).toEqual({
    bilibili: true,
    tencent: true,
    xinpianchang: false,
    youku: false,
    douyin: false,
  })
})

test('平台启用状态只接受注册表中的布尔值', () => {
  expect(parseOnlineProviderSettings({
    schemaVersion: 1,
    enabled: {
      bilibili: false,
      tencent: true,
      xinpianchang: true,
      youku: 'yes',
      unknown: true,
    },
  }).enabled).toEqual({
    bilibili: false,
    tencent: true,
    xinpianchang: true,
    youku: false,
    douyin: false,
  })
})

test('平台注册表身份稳定且会话分区互相隔离', () => {
  const manifests = ONLINE_MEDIA_PROVIDER_IDS.map(
    (provider) => ONLINE_PROVIDER_MANIFESTS[provider],
  )
  expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(5)
  expect(new Set(manifests.map((manifest) => manifest.sessionPartition)).size)
    .toBe(5)
  expect(
    manifests.every((manifest) =>
      manifest.sessionPartition.startsWith('persist:aurora-'),
    ),
  ).toBe(true)
})

test('平台启用设置序列化会过滤额外字段并可 roundtrip', () => {
  const enabled = {
    bilibili: true,
    tencent: false,
    xinpianchang: true,
    youku: true,
    douyin: false,
  }
  const serialized = serializeOnlineProviderSettings(enabled)
  expect(serialized).toEqual({ schemaVersion: 1, enabled })
  expect(parseOnlineProviderSettings(serialized)).toEqual(serialized)
})

test('在线来源从统一注册表读取各自的类型筛选', () => {
  expect(getOnlineProviderSearchTypeOptions('tencent')).toEqual([
    { value: 'all', label: '全部' },
    { value: 'kids', label: '少儿' },
    { value: 'documentary', label: '纪录片' },
    { value: 'anime', label: '动漫' },
    { value: 'variety', label: '综艺' },
    { value: 'tv', label: '电视剧' },
  ])
  expect(
    getOnlineProviderSearchTypeOptions('bilibili').map(({ label }) => label),
  ).toEqual(['综合', '视频', '番剧', '影视', '直播'])
  expect(
    getOnlineProviderSearchTypeOptions('youku').map(({ label }) => label),
  ).toEqual(['全部', '影视', '用户'])
  expect(getOnlineProviderSearchTypeOptions('xinpianchang')).toEqual([])
  expect(getOnlineProviderSearchTypeOptions('douyin')).toEqual([])
})

test('切换来源时无效类型会回退为该来源首项', () => {
  expect(normalizeOnlineProviderSearchType('bilibili', 'bangumi')).toBe(
    'bangumi',
  )
  expect(normalizeOnlineProviderSearchType('youku', 'bangumi')).toBe('all')
  expect(normalizeOnlineProviderSearchType('tencent', 'unknown')).toBe('all')
  expect(normalizeOnlineProviderSearchType('xinpianchang', 'all')).toBeNull()
  expect(normalizeOnlineProviderSearchType('douyin', 'all')).toBeNull()
})
