import { expect, test } from '@playwright/test'
import {
  formatProjectStorageSummary,
  summarizeProjectStorage,
} from '../src/features/video-library/projectStorage'

test('按项目和唯一素材实时汇总权威字节数', () => {
  const references = [
    { projectId: 'one', assetId: 'a' },
    { projectId: 'one', assetId: 'a' },
    { projectId: 'one', assetId: 'b' },
    { projectId: 'two', assetId: 'a' },
  ]
  const assets = [
    { id: 'a', sizeBytes: 2 * 1024 ** 3 },
    { id: 'b', sizeBytes: 512 * 1024 ** 2 },
  ]

  expect(summarizeProjectStorage('one', references, assets)).toEqual({
    assetCount: 2,
    knownBytes: 2.5 * 1024 ** 3,
    unknownCount: 0,
  })
  expect(
    formatProjectStorageSummary(
      summarizeProjectStorage('one', references, assets),
    ),
  ).toBe('2.5 GB')
})

test('空项目与元数据待分析状态不会伪造容量', () => {
  expect(formatProjectStorageSummary(summarizeProjectStorage('empty', [], []))).toBe(
    '0 KB',
  )

  const summary = summarizeProjectStorage(
    'one',
    [
      { projectId: 'one', assetId: 'known' },
      { projectId: 'one', assetId: 'unknown' },
      { projectId: 'one', assetId: 'missing' },
    ],
    [
      { id: 'known', sizeBytes: 12 * 1024 ** 2 },
      { id: 'unknown', sizeBytes: null },
    ],
  )

  expect(summary).toEqual({
    assetCount: 3,
    knownBytes: 12 * 1024 ** 2,
    unknownCount: 2,
  })
  expect(formatProjectStorageSummary(summary)).toBe('12 MB + 待分析')
})
