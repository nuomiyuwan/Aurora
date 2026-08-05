import type { OnlineMediaProvider } from '../../data/onlineProviderRegistry'

export type DiscoverySource =
  | 'local'
  | 'emby'
  | OnlineMediaProvider
  | 'nas'
export type DiscoveryFootageSource = Extract<DiscoverySource, 'local' | 'nas'>
export type DiscoveryResultKind = 'clip' | 'frame' | 'model'
export type DiscoveryResolutionLabel =
  | '4K'
  | '1080P'
  | 'ONLINE'
  | 'GLB'
  | 'OBJ'
  | 'FBX'
export type DiscoveryMediaType = '电影' | '电视剧' | '纪录片'
export type DiscoveryVisualIndexStatus = 'not-created' | 'ready'

export interface DiscoveryMediaDetails {
  englishTitle: string
  year: string
  type: DiscoveryMediaType
  genres: string[]
  director: string
  cast: string[]
  hdrAudio: string
}

export interface DiscoveryFootageDetails {
  filename: string
  project: string
  auroraProjectId?: string
  auroraClipId?: string
  auroraFrameId?: string
  auroraTimeSeconds?: number
  codec: string
  fps: string
  size: string
  camera: string
  capturedAt: string
  sourcePath: string
  sourcePathAvailable?: boolean
}

export interface DiscoveryModelDetails {
  filename: string
  project: string
  auroraProjectId: string
  auroraModelId: string
  format: 'GLB' | 'OBJ' | 'FBX'
  size: string
  importedAt: string
  sourcePath: string
  sourcePathAvailable?: boolean
  vertexCount: number | null
  triangleCount: number | null
  nodeCount: number | null
  materialCount: number | null
  textureCount: number | null
  dimensions: string
}

export interface DiscoveryOnlineVideoDetails {
  provider: OnlineMediaProvider
  mediaKind: 'video' | 'episode'
  mediaId: string
  bvid: string | null
  episodeId: string | null
  canonicalUrl: string
  author: string
  publishedAt: string
  auroraAssetId?: string
  favorite: boolean
  projectIds: string[]
}

export interface DiscoveryVisualIndexSummary {
  status: DiscoveryVisualIndexStatus
  keyframeCount: number
  highlightCount: number
  favoriteCount: number
}

interface DiscoveryResultBase {
  id: string
  title: string
  secondaryLabel: string
  sourceCollection: string
  thumbnail: string
  timecode: string
  duration: string
  resolution: string
  resolutionLabel: DiscoveryResolutionLabel
  kind: DiscoveryResultKind
  description: string
  tags: string[]
  /** Extra index-only text that is not rendered as the result description. */
  searchTerms?: string[]
  previewProgress: number
}

export interface DiscoveryMediaResult extends DiscoveryResultBase {
  detailType: 'media'
  source: 'emby'
  media: DiscoveryMediaDetails
  visualIndex: DiscoveryVisualIndexSummary
}

export interface DiscoveryFootageResult extends DiscoveryResultBase {
  detailType: 'footage'
  source: DiscoveryFootageSource
  footage: DiscoveryFootageDetails
  visualIndex: DiscoveryVisualIndexSummary
}

export interface DiscoveryModelResult extends DiscoveryResultBase {
  detailType: 'model'
  source: 'local'
  kind: 'model'
  model: DiscoveryModelDetails
  visualIndex: DiscoveryVisualIndexSummary
}

export interface DiscoveryOnlineVideoResult extends DiscoveryResultBase {
  detailType: 'online-video'
  source: OnlineMediaProvider
  kind: 'clip'
  resolutionLabel: 'ONLINE'
  online: DiscoveryOnlineVideoDetails
  visualIndex: DiscoveryVisualIndexSummary
}

export type DiscoveryResult =
  | DiscoveryMediaResult
  | DiscoveryFootageResult
  | DiscoveryModelResult
  | DiscoveryOnlineVideoResult
