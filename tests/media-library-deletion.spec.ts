import { expect, test } from '@playwright/test'
import { removeMediaAssetRecords } from '../src/data/mediaLibraryDeletion'
import type {
  FrameAnnotation,
  FrameExclusion,
  MediaAsset,
  MediaVisualIndex,
  ProjectAssetRef,
} from '../src/data/mediaLibraryTypes'

const mediaAssets = [
  { id: 'asset-remove' },
  { id: 'asset-keep' },
] as MediaAsset[]
const projectAssetRefs = [
  { id: 'ref-one', projectId: 'project-one', assetId: 'asset-remove' },
  { id: 'ref-two', projectId: 'project-two', assetId: 'asset-remove' },
  { id: 'ref-keep', projectId: 'project-one', assetId: 'asset-keep' },
] as ProjectAssetRef[]
const visualIndexes = [
  { assetId: 'asset-remove' },
  { assetId: 'asset-keep' },
] as MediaVisualIndex[]
const frameAnnotations = [
  { assetId: 'asset-remove', frameId: 'remove-frame' },
  { assetId: 'asset-keep', frameId: 'keep-frame' },
] as FrameAnnotation[]
const frameExclusions = [
  { assetId: 'asset-remove', frameId: 'remove-exclusion' },
  { assetId: 'asset-keep', frameId: 'keep-exclusion' },
] as FrameExclusion[]

test('从 Aurora 删除视频时清理其全部引用、视觉索引和帧环数据', () => {
  const result = removeMediaAssetRecords(
    {
      mediaAssets,
      projectAssetRefs,
      visualIndexes,
      frameAnnotations,
      frameExclusions,
    },
    'asset-remove',
  )

  expect(result.removedAsset?.id).toBe('asset-remove')
  expect(result.removedReferences.map((reference) => reference.id)).toEqual([
    'ref-one',
    'ref-two',
  ])
  expect(result.mediaAssets.map((asset) => asset.id)).toEqual(['asset-keep'])
  expect(result.projectAssetRefs.map((reference) => reference.id)).toEqual([
    'ref-keep',
  ])
  expect(result.visualIndexes.map((index) => index.assetId)).toEqual([
    'asset-keep',
  ])
  expect(result.frameAnnotations.map((annotation) => annotation.frameId)).toEqual([
    'keep-frame',
  ])
  expect(result.frameExclusions.map((exclusion) => exclusion.frameId)).toEqual([
    'keep-exclusion',
  ])
})
