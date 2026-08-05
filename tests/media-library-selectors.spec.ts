import { expect, test } from '@playwright/test'
import {
  getProjectExportedMaterialCounts,
  getProjectMediaCounts,
  getNextProjectAssetOrder,
  getProjectAssetCounts,
  isDemoMediaAsset,
  selectReferencedMediaAssets,
  selectLibraryMediaAssets,
} from '../src/data/mediaLibrarySelectors'

test('项目计数只由引用关系推导', () => {
  const counts = getProjectAssetCounts([
    { projectId: 'one' },
    { projectId: 'one' },
    { projectId: 'two' },
  ])

  expect(Object.fromEntries(counts)).toEqual({ one: 2, two: 1 })
})

test('新增引用始终使用当前项目最大 order 的下一位', () => {
  const references = [
    { projectId: 'one', order: 0 },
    { projectId: 'one', order: 4 },
    { projectId: 'two', order: 18 },
  ]

  expect(getNextProjectAssetOrder('one', references)).toBe(5)
  expect(getNextProjectAssetOrder('missing', references)).toBe(0)
})

test('项目本地视频与在线视频由引用图实时分类派生', () => {
  const assets = [
    {
      id: 'local-one',
      sourceFingerprint: 'local:/Volumes/one.mp4',
      sourcePath: '/Volumes/one.mp4',
    },
    {
      id: 'online-one',
      sourceFingerprint: 'online:bilibili:video:BV1',
      sourcePath: null,
      online: {
        provider: 'bilibili' as const,
        kind: 'video' as const,
        mediaId: 'BV1',
        canonicalUrl: 'https://www.bilibili.com/video/BV1',
        author: '测试',
        description: '',
        publishedAt: '',
      },
    },
  ]
  const initialReferences = [
    { projectId: 'one', assetId: 'local-one' },
    { projectId: 'one', assetId: 'online-one' },
    // Duplicate project membership must not inflate a project card.
    { projectId: 'one', assetId: 'online-one' },
  ]

  expect(Object.fromEntries(getProjectMediaCounts(initialReferences, assets))).toEqual({
    one: {
      localVideoCount: 1,
      onlineVideoCount: 1,
      totalVideoCount: 2,
    },
  })

  const afterDelete = initialReferences.filter(
    (reference) => reference.assetId !== 'local-one',
  )
  expect(Object.fromEntries(getProjectMediaCounts(afterDelete, assets))).toEqual({
    one: {
      localVideoCount: 0,
      onlineVideoCount: 1,
      totalVideoCount: 1,
    },
  })
})

test('左下角库状态只统计仍被项目引用的唯一资产', () => {
  const assets = [
    {
      id: 'local-one',
      sourceFingerprint: 'local:/Volumes/one.mp4',
      sourcePath: '/Volumes/one.mp4',
    },
    {
      id: 'online-one',
      sourceFingerprint: 'online:bilibili:video:BV1',
      sourcePath: null,
      online: {
        provider: 'bilibili' as const,
        kind: 'video' as const,
        mediaId: 'BV1',
        canonicalUrl: 'https://www.bilibili.com/video/BV1',
        author: '测试',
        description: '',
        publishedAt: '',
      },
    },
    {
      id: 'unreferenced',
      sourceFingerprint: 'local:/Volumes/old.mp4',
      sourcePath: '/Volumes/old.mp4',
    },
  ]

  const referenced = selectReferencedMediaAssets(
    [
      { assetId: 'local-one' },
      { assetId: 'local-one' },
      { assetId: 'online-one' },
    ],
    assets,
  )
  expect(referenced.map((asset) => asset.id)).toEqual([
    'local-one',
    'online-one',
  ])
})

test('素材计数只统计帧环剪辑导出的项目引用', () => {
  const counts = getProjectExportedMaterialCounts([
    { projectId: 'one', assetId: 'asset:import:ordinary' },
    { projectId: 'one', assetId: 'asset:export:first' },
    { projectId: 'one', assetId: 'asset:export:second' },
    { projectId: 'two', assetId: 'asset:export:shared' },
  ])

  expect(Object.fromEntries(counts)).toEqual({ one: 2, two: 1 })
})

test('正式素材统计与内置演示素材隔离', () => {
  const assets = [
    { id: 'demo', sourceFingerprint: 'mock:ring-A001_C012.mov' },
    { id: 'local', sourceFingerprint: 'local:/Volumes/A001_C012.mov' },
    { id: 'indexed', sourceFingerprint: 'emby:server:item' },
  ]

  expect(isDemoMediaAsset(assets[0])).toBe(true)
  expect(selectLibraryMediaAssets(assets).map((asset) => asset.id)).toEqual([
    'local',
    'indexed',
  ])
})
