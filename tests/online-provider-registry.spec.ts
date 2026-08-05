import { expect, test } from '@playwright/test'
import {
  ONLINE_MEDIA_PROVIDER_IDS,
  ONLINE_PROVIDER_MANIFESTS,
  createDefaultOnlineProviderEnabledState,
  parseOnlineProviderSettings,
  serializeOnlineProviderSettings,
} from '../src/data/onlineProviderRegistry'

test('已有在线源默认启用，新增试点来源默认关闭', () => {
  expect(createDefaultOnlineProviderEnabledState()).toEqual({
    bilibili: true,
    tencent: true,
    xinpianchang: false,
    youku: false,
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
  })
})

test('平台注册表身份稳定且会话分区互相隔离', () => {
  const manifests = ONLINE_MEDIA_PROVIDER_IDS.map(
    (provider) => ONLINE_PROVIDER_MANIFESTS[provider],
  )
  expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(4)
  expect(new Set(manifests.map((manifest) => manifest.sessionPartition)).size)
    .toBe(4)
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
  }
  const serialized = serializeOnlineProviderSettings(enabled)
  expect(serialized).toEqual({ schemaVersion: 1, enabled })
  expect(parseOnlineProviderSettings(serialized)).toEqual(serialized)
})
