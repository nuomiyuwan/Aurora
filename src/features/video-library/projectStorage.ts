import { formatMediaFileSize } from './mediaDisplayMetadata'

export type ProjectStorageReference = {
  projectId: string
  assetId: string
}

export type ProjectStorageAsset = {
  id: string
  sizeBytes: number | null
}

export type ProjectStorageSummary = {
  assetCount: number
  knownBytes: number
  unknownCount: number
}

export function summarizeProjectStorage(
  projectId: string,
  references: readonly ProjectStorageReference[],
  assets: readonly ProjectStorageAsset[],
): ProjectStorageSummary {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const uniqueAssetIds = new Set(
    references
      .filter((reference) => reference.projectId === projectId)
      .map((reference) => reference.assetId),
  )

  let knownBytes = 0
  let unknownCount = 0

  uniqueAssetIds.forEach((assetId) => {
    const sizeBytes = assetsById.get(assetId)?.sizeBytes
    if (
      typeof sizeBytes !== 'number' ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes <= 0
    ) {
      unknownCount += 1
      return
    }
    knownBytes += sizeBytes
  })

  return {
    assetCount: uniqueAssetIds.size,
    knownBytes,
    unknownCount,
  }
}

export function formatProjectStorageSummary(
  summary: ProjectStorageSummary,
) {
  if (summary.knownBytes > 0) {
    const formatted = formatMediaFileSize(summary.knownBytes)
    return summary.unknownCount > 0 ? `${formatted} + 待分析` : formatted
  }

  return summary.unknownCount > 0 ? '待分析' : '0 KB'
}
