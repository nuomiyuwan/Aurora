export interface FrameRingOnlineReflectionSource {
  playbackKey: string
  sourceUrl: string
  revision: number
  kind: 'poster' | 'capture'
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

/** Actual player captures must always be renderer-owned PNG/JPEG data. */
export const isSafeFrameRingOnlineReflectionSourceUrl = (
  sourceUrl: string | null,
): sourceUrl is string => Boolean(
  sourceUrl &&
  /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(sourceUrl),
)

/**
 * A poster may be used only as the short-lived reflection placeholder while
 * the protected player is producing its first real frame. Keep that fallback
 * limited to Aurora-managed media and document-owned assets.
 */
export const isSafeFrameRingOnlineReflectionPosterUrl = (
  sourceUrl: string | null,
  documentBaseUrl = getDocumentBaseUrl(),
): sourceUrl is string => {
  if (!sourceUrl) return false
  if (isSafeFrameRingOnlineReflectionSourceUrl(sourceUrl)) return true

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

export const createFrameRingOnlineReflectionPosterSource = (
  playbackKey: string,
  posterUrl: string | null,
): FrameRingOnlineReflectionSource | null =>
  playbackKey && isSafeFrameRingOnlineReflectionPosterUrl(posterUrl)
    ? {
        playbackKey,
        sourceUrl: posterUrl,
        revision: 0,
        kind: 'poster',
      }
    : null

/**
 * Accept at most one trusted player capture for a playback item. A temporary
 * poster source may be replaced, but the first actual player frame is frozen.
 */
export const acceptFirstFrameRingOnlineReflectionCapture = (
  current: FrameRingOnlineReflectionSource | null,
  playbackKey: string,
  dataUrl: string | null,
): FrameRingOnlineReflectionSource | null => {
  const source = resolveFrameRingOnlineReflectionSource(current, playbackKey)
  if (
    source?.kind === 'capture' ||
    !isSafeFrameRingOnlineReflectionSourceUrl(dataUrl)
  ) return source

  return {
    playbackKey,
    sourceUrl: dataUrl,
    revision: 1,
    kind: 'capture',
  }
}

export const getFrameRingOnlineReflectionSourceId = (
  source: FrameRingOnlineReflectionSource,
) => JSON.stringify([
  source.playbackKey,
  source.kind,
  source.revision,
  source.kind === 'poster' ? source.sourceUrl : '',
])
