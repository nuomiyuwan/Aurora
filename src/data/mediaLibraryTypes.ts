import type { OnlineMediaProvider } from './onlineProviderRegistry'

export type MediaIndexTask =
  | 'idle'
  | 'build-queued'
  | 'rebuild-queued'
  | 'building'
  | 'failed'

export const MEDIA_VISUAL_INDEX_VERSION = 4

export type { OnlineMediaProvider } from './onlineProviderRegistry'

export type OnlineMediaKind = 'video' | 'episode'

export type OnlineMediaDescriptor = {
  provider: OnlineMediaProvider
  kind: OnlineMediaKind
  mediaId: string
  canonicalUrl: string
  author: string
  description: string
  publishedAt: string
}

export type MediaAsset = {
  id: string
  filename: string
  thumbnail: string | null
  duration: string
  resolution: string
  fps: string
  frameCount: string
  sampleCount: number
  size: string
  codec: string
  camera: string
  capturedAt: string
  sourceFingerprint: string
  sourcePath: string | null
  favorite: boolean
  indexTask: MediaIndexTask
  durationSeconds: number | null
  width: number | null
  height: number | null
  fpsValue: number | null
  sizeBytes: number | null
  indexError: string | null
  online?: OnlineMediaDescriptor
}

export type ProjectAssetRef = {
  id: string
  projectId: string
  assetId: string
  order: number
  thumbnailFollowsProject: boolean
  tags: string[]
  annotated: boolean
  note: string
}

export type MediaVisualIndexFrame = {
  id: string
  index: number
  timeSeconds: number
  imagePath: string
}

export type MediaVisualIndex = {
  assetId: string
  sourceFingerprint: string
  createdAt: string
  version: number
  posterPath: string
  previewPath: string | null
  frames: MediaVisualIndexFrame[]
}

export type FrameAnnotationSource = 'manual' | 'ai'

export type FrameAnnotation = {
  assetId: string
  frameId: string
  favorite: boolean
  rating: number
  tags: string[]
  note: string
  /** Missing on legacy records and is treated as manual. */
  tagsSource?: FrameAnnotationSource
  /** Missing on legacy records and is treated as manual. */
  noteSource?: FrameAnnotationSource
}

export type FrameExclusionReason =
  | 'black'
  | 'white'
  | 'duplicate'
  | 'manual'

/**
 * A reversible frame-ring exclusion. The generated frame remains in its
 * visual index so restoring an exclusion never needs to rebuild the source.
 */
export type FrameExclusion = {
  assetId: string
  sourceFingerprint: string
  frameId: string
  reason: FrameExclusionReason
  duplicateOfFrameId: string | null
  createdAt: string
}
