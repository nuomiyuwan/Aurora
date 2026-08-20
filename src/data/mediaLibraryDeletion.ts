import type {
  FrameAnnotation,
  FrameExclusion,
  MediaAsset,
  MediaVisualIndex,
  ProjectAssetRef,
} from './mediaLibraryTypes'

export type MediaLibraryRecords = {
  mediaAssets: readonly MediaAsset[]
  projectAssetRefs: readonly ProjectAssetRef[]
  visualIndexes: readonly MediaVisualIndex[]
  frameAnnotations: readonly FrameAnnotation[]
  frameExclusions: readonly FrameExclusion[]
}

export function removeMediaAssetRecords(
  records: MediaLibraryRecords,
  assetId: string,
) {
  return {
    removedAsset:
      records.mediaAssets.find((asset) => asset.id === assetId) ?? null,
    removedReferences: records.projectAssetRefs.filter(
      (reference) => reference.assetId === assetId,
    ),
    mediaAssets: records.mediaAssets.filter((asset) => asset.id !== assetId),
    projectAssetRefs: records.projectAssetRefs.filter(
      (reference) => reference.assetId !== assetId,
    ),
    visualIndexes: records.visualIndexes.filter(
      (index) => index.assetId !== assetId,
    ),
    frameAnnotations: records.frameAnnotations.filter(
      (annotation) => annotation.assetId !== assetId,
    ),
    frameExclusions: records.frameExclusions.filter(
      (exclusion) => exclusion.assetId !== assetId,
    ),
  }
}
