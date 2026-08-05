import type {
  MediaAsset,
  OnlineMediaDescriptor,
  ProjectAssetRef,
} from './mediaLibraryTypes'

export const EXPORTED_CLIP_MATERIAL_TAG = '剪辑导出'
export const EXPORTED_CLIP_ASSET_ID_PREFIX = 'asset:export:'

export type ProjectMediaCounts = {
  localVideoCount: number
  onlineVideoCount: number
  totalVideoCount: number
}

type OnlineMediaCandidate = {
  online?: OnlineMediaDescriptor
  sourcePath?: string | null
}

export function isOnlineMediaAsset<T extends OnlineMediaCandidate>(
  asset: T,
): asset is T & {
  online: OnlineMediaDescriptor
  sourcePath: null
} {
  return asset.online !== undefined && asset.sourcePath === null
}

export function isDemoMediaAsset(
  asset: Pick<MediaAsset, 'sourceFingerprint'> & OnlineMediaCandidate,
) {
  return (
    !isOnlineMediaAsset(asset) && asset.sourceFingerprint.startsWith('mock:')
  )
}

export function selectLibraryMediaAssets<
  T extends Pick<MediaAsset, 'sourceFingerprint'> & OnlineMediaCandidate,
>(
  assets: readonly T[],
) {
  return assets.filter((asset) => !isDemoMediaAsset(asset))
}

export function getProjectAssetCounts(
  references: readonly Pick<ProjectAssetRef, 'projectId'>[],
) {
  const counts = new Map<string, number>()
  references.forEach((reference) => {
    counts.set(reference.projectId, (counts.get(reference.projectId) ?? 0) + 1)
  })
  return counts
}

/**
 * Derive the visible project media counts from the live reference graph.
 * Project.videoCount is persisted only for migration compatibility; UI counts
 * should use this selector so removing a reference cannot leave stale copy.
 */
export function getProjectMediaCounts(
  references: readonly Pick<ProjectAssetRef, 'projectId' | 'assetId'>[],
  assets: readonly (Pick<MediaAsset, 'id' | 'sourceFingerprint'> &
    OnlineMediaCandidate)[],
) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset] as const))
  const counts = new Map<string, ProjectMediaCounts>()
  const seenMemberships = new Set<string>()

  references.forEach((reference) => {
    const asset = assetsById.get(reference.assetId)
    if (!asset || isDemoMediaAsset(asset)) return

    const membershipKey = `${reference.projectId}\u0000${reference.assetId}`
    if (seenMemberships.has(membershipKey)) return
    seenMemberships.add(membershipKey)

    const current = counts.get(reference.projectId) ?? {
      localVideoCount: 0,
      onlineVideoCount: 0,
      totalVideoCount: 0,
    }
    if (isOnlineMediaAsset(asset)) current.onlineVideoCount += 1
    else current.localVideoCount += 1
    current.totalVideoCount += 1
    counts.set(reference.projectId, current)
  })

  return counts
}

/** Return unique, still-referenced assets for live library status totals. */
export function selectReferencedMediaAssets<
  T extends Pick<MediaAsset, 'id' | 'sourceFingerprint'> & OnlineMediaCandidate,
>(
  references: readonly Pick<ProjectAssetRef, 'assetId'>[],
  assets: readonly T[],
) {
  const referencedIds = new Set(references.map((reference) => reference.assetId))
  return selectLibraryMediaAssets(assets).filter((asset) =>
    referencedIds.has(asset.id),
  )
}

export function getProjectExportedMaterialCounts(
  references: readonly Pick<ProjectAssetRef, 'projectId' | 'assetId'>[],
) {
  const counts = new Map<string, number>()
  references.forEach((reference) => {
    if (!reference.assetId.startsWith(EXPORTED_CLIP_ASSET_ID_PREFIX)) return
    counts.set(reference.projectId, (counts.get(reference.projectId) ?? 0) + 1)
  })
  return counts
}

export function getNextProjectAssetOrder(
  projectId: string,
  references: readonly Pick<ProjectAssetRef, 'projectId' | 'order'>[],
) {
  return (
    references.reduce(
      (maximum, reference) =>
        reference.projectId === projectId
          ? Math.max(maximum, reference.order)
          : maximum,
      -1,
    ) + 1
  )
}
