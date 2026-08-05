import type { MediaAsset, ProjectAssetRef } from './mediaLibraryTypes'
import { getNextProjectAssetOrder } from './mediaLibrarySelectors'

export type ExportedMediaRegistrationResolution = {
  existingAsset: MediaAsset | null
  existingReference: ProjectAssetRef | null
  sourceChanged: boolean
  nextOrder: number
}

export function resolveExportedMediaRegistration(
  targetProjectId: string,
  sourcePath: string,
  sourceFingerprint: string,
  mediaAssets: readonly MediaAsset[],
  projectAssetRefs: readonly ProjectAssetRef[],
): ExportedMediaRegistrationResolution {
  const existingAsset =
    mediaAssets.find((asset) => asset.sourcePath === sourcePath) ??
    mediaAssets.find(
      (asset) => asset.sourceFingerprint === sourceFingerprint,
    ) ??
    null
  const existingReference = existingAsset
    ? projectAssetRefs.find(
        (reference) =>
          reference.projectId === targetProjectId &&
          reference.assetId === existingAsset.id,
      ) ?? null
    : null

  return {
    existingAsset,
    existingReference,
    sourceChanged: Boolean(
      existingAsset &&
        existingAsset.sourceFingerprint !== sourceFingerprint,
    ),
    nextOrder: getNextProjectAssetOrder(
      targetProjectId,
      projectAssetRefs,
    ),
  }
}
