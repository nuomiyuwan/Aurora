export function resolveDocumentAssetUrl(
  asset: string,
  base = typeof document === 'undefined' ? undefined : document.baseURI,
) {
  if (!asset) return asset
  return base ? new URL(asset, base).href : asset
}

export function toCssImageValue(asset: string) {
  const normalizedAsset = asset.trim()
  return normalizedAsset
    ? `url(${JSON.stringify(normalizedAsset)})`
    : 'none'
}
