export interface FrameRingOnlineReflectionSource {
  playbackKey: string
  sourceUrl: string
  revision: number
}

export const resolveFrameRingOnlineReflectionSource = (
  current: FrameRingOnlineReflectionSource | null,
  playbackKey: string,
) =>
  current?.playbackKey === playbackKey
    ? current
    : null

const getDocumentBaseUrl = () =>
  typeof document === 'undefined' ? null : document.baseURI

/**
 * Reflections may consume a renderer-owned capture, an Aurora-managed media
 * URL, or an asset that lives alongside the current document. Arbitrary
 * remote and local-file URLs stay excluded from this texture path.
 */
export const isSafeFrameRingOnlineReflectionSourceUrl = (
  sourceUrl: string | null,
  documentBaseUrl = getDocumentBaseUrl(),
): sourceUrl is string => {
  if (!sourceUrl) return false
  if (sourceUrl.startsWith('data:image/')) return true

  let source: URL
  try {
    source = new URL(sourceUrl, documentBaseUrl ?? undefined)
  } catch {
    return false
  }
  if (
    source.protocol === 'aurora-media:' &&
    !source.username &&
    !source.password
  ) {
    return true
  }
  if (!documentBaseUrl) return false

  let base: URL
  try {
    base = new URL(documentBaseUrl)
  } catch {
    return false
  }
  if (base.protocol === 'file:') {
    const documentDirectory = new URL('.', base).href
    return source.protocol === 'file:' && source.href.startsWith(documentDirectory)
  }
  return (
    (base.protocol === 'http:' || base.protocol === 'https:') &&
    source.protocol === base.protocol &&
    source.origin === base.origin
  )
}

/**
 * Accept at most one trusted player surface for a playback item. Bilibili and
 * Tencent provide a main-process capture; providers that cannot expose their
 * protected guest surface provide an Aurora-managed poster instead. In both
 * cases the first accepted image is frozen and playback never refreshes it.
 */
export const acceptFirstFrameRingOnlineReflectionCapture = (
  current: FrameRingOnlineReflectionSource | null,
  playbackKey: string,
  dataUrl: string | null,
): FrameRingOnlineReflectionSource | null => {
  const source = resolveFrameRingOnlineReflectionSource(current, playbackKey)
  if (source || !isSafeFrameRingOnlineReflectionSourceUrl(dataUrl)) return source

  return {
    playbackKey,
    sourceUrl: dataUrl,
    revision: 1,
  }
}

export const getFrameRingOnlineReflectionSourceId = (
  source: FrameRingOnlineReflectionSource,
) => JSON.stringify([
  source.playbackKey,
  source.revision,
])
