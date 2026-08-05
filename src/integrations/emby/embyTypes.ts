import type {
  DiscoverySearchKindFilter,
  DiscoverySearchResolutionFilter,
} from '../../features/discovery/search/types'

export interface EmbyPersonDto {
  Name?: string
  Type?: string
  Role?: string
}

export interface EmbyMediaStreamDto {
  Index?: number
  Type?: string
  Codec?: string
  DisplayTitle?: string
  Language?: string
  Width?: number
  Height?: number
  AverageFrameRate?: number
  RealFrameRate?: number
  BitRate?: number
  BitDepth?: number
  Channels?: number
  ChannelLayout?: string
  ExtendedVideoType?: string
  ExtendedVideoSubType?: string
}

export interface EmbyMediaSourceDto {
  Id?: string
  Name?: string
  Path?: string
  Container?: string
  Size?: number
  Bitrate?: number
  RunTimeTicks?: number
  IsRemote?: boolean
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  SupportsTranscoding?: boolean
  DirectStreamUrl?: string
  TranscodingUrl?: string
  MediaStreams?: EmbyMediaStreamDto[]
}

export interface EmbyVisualIndexDto {
  Status?: 'not-created' | 'ready'
  KeyframeCount?: number
  HighlightCount?: number
  FavoriteCount?: number
}

export interface EmbyItemDto {
  Id?: string
  Name?: string
  OriginalTitle?: string
  Type?: string
  MediaType?: string
  Overview?: string
  ProductionYear?: number
  PremiereDate?: string
  Genres?: string[]
  Tags?: string[]
  People?: EmbyPersonDto[]
  RunTimeTicks?: number
  Width?: number
  Height?: number
  Container?: string
  SeriesName?: string
  Album?: string
  CollectionName?: string
  PrimaryImageUrl?: string
  ImageTags?: Record<string, string>
  BackdropImageTags?: string[]
  PrimaryImageAspectRatio?: number
  MediaStreams?: EmbyMediaStreamDto[]
  MediaSources?: EmbyMediaSourceDto[]
  UserData?: {
    PlaybackPositionTicks?: number
    IsFavorite?: boolean
  }
  AuroraVisualIndex?: EmbyVisualIndexDto
}

export interface EmbyBridgeSearchRequest {
  requestId: string
  query: string
  cursor: string | null
  limit: number
  kind: DiscoverySearchKindFilter
  resolution: DiscoverySearchResolutionFilter
}

export interface EmbySearchRequest {
  query: string
  startIndex?: number
  limit?: number
  parentId?: string
  includeItemTypes?: Array<
    'Movie' | 'Series' | 'Episode' | 'Video' | 'Trailer' | 'MusicVideo'
  >
}

export interface EmbySearchResponse {
  Items: EmbyItemDto[]
  TotalRecordCount: number
  StartIndex?: number
}

export interface EmbyBridgeSearchResponse {
  connected?: boolean
  serverId: string
  items: EmbyItemDto[]
  totalCount: number
  nextCursor?: string | null
}

export interface EmbyBridgeItemRequest {
  serverId: string
  itemId: string
}

export interface EmbyBridgeImageRequest extends EmbyBridgeItemRequest {
  imageType?: 'Primary' | 'Backdrop' | 'Thumb'
  maxWidth?: number
}

export interface EmbyConnectionInput {
  serverUrl: string
  username: string
  password: string
  deviceId?: string
}

export interface EmbyConnectionState {
  connected: boolean
  serverUrl: string | null
  serverId: string | null
  serverName: string | null
  user: { id: string; name: string } | null
  connectedAt: string | null
  persistence: 'none' | 'memory' | 'encrypted'
}

export interface EmbyPublicError {
  code: string
  message: string
  status: number | null
  retryable: boolean
}

export type EmbyResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: EmbyPublicError }

export interface EmbyImageResponse {
  mimeType: string
  data: ArrayBuffer
  byteLength: number
  etag: string | null
  cacheControl: string | null
}

export interface EmbyRendererBridgeAdapter {
  getConnection(signal?: AbortSignal): Promise<EmbyConnectionState>
  testConnection(
    input: EmbyConnectionInput,
    signal?: AbortSignal,
  ): Promise<EmbyConnectionState>
  disconnect(signal?: AbortSignal): Promise<EmbyConnectionState>
  search(
    request: EmbyBridgeSearchRequest,
    signal?: AbortSignal,
  ): Promise<EmbyBridgeSearchResponse>
  getItem?(
    request: EmbyBridgeItemRequest,
    signal?: AbortSignal,
  ): Promise<EmbyItemDto>
  getImageBlob?(
    request: EmbyBridgeImageRequest,
    signal?: AbortSignal,
  ): Promise<Blob>
}
