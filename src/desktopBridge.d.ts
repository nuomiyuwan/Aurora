export {}

declare global {
  type AiProviderErrorCode =
    | 'AI_PROVIDER_ENCRYPTION_UNAVAILABLE'
    | 'AI_PROVIDER_INSECURE_URL'
    | 'AI_PROVIDER_INVALID_INPUT'
    | 'AI_PROVIDER_PROFILE_LIMIT'
    | 'AI_PROVIDER_PROFILE_NOT_FOUND'
    | 'AI_PROVIDER_STORAGE_ERROR'

  interface AiProviderPublicError {
    code: AiProviderErrorCode | AiVisualSearchErrorCode
    message: string
    status?: number | null
    retryable?: boolean
  }

  type AiProviderResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: AiProviderPublicError }

  interface AiProviderProfile {
    id: string
    name: string
    baseUrl: string
    visionModel: string
    embeddingModel: string
    hasApiKey: boolean
  }

  interface AiProviderProfilesState {
    profiles: AiProviderProfile[]
    activeProfileId: string | null
    secureStorageAvailable: boolean
  }

  interface AiProviderProfileInput {
    id?: string
    name: string
    baseUrl: string
    visionModel: string
    embeddingModel: string
    /** Empty or omitted retains a saved key; a new profile remains keyless. */
    apiKey?: string
    /** Explicitly removes a key already saved for this profile. */
    clearApiKey?: boolean
  }

  interface AiProviderProfileSaveResponse {
    profile: AiProviderProfile
    state: AiProviderProfilesState
  }

  interface AiProviderProfileTestResponse {
    vision: {
      ok: true
      model: string
    }
    embedding: {
      ok: true
      model: string
      dimensions: number
    }
    latencyMs: number
  }

  type AiServiceKind = 'vision' | 'embedding'

  interface AiServiceProfile {
    id: string
    name: string
    baseUrl: string
    model: string
    hasApiKey: boolean
  }

  interface AiServiceProfilesState {
    visionProfiles: AiServiceProfile[]
    embeddingProfiles: AiServiceProfile[]
    activeVisionProfileId: string | null
    activeEmbeddingProfileId: string | null
    secureStorageAvailable: boolean
  }

  interface AiServiceProfileInput {
    id?: string
    name: string
    baseUrl: string
    model: string
    /** Empty or omitted retains a saved key; a new profile remains keyless. */
    apiKey?: string
    /** Explicitly removes a key already saved for this profile. */
    clearApiKey?: boolean
  }

  interface AiServiceProfileSaveResponse {
    profile: AiServiceProfile
    state: AiServiceProfilesState
  }

  interface AiServiceProfileTestResponse {
    ok: true
    model: string
    dimensions?: number
    latencyMs: number
  }

  interface AiLocalModel {
    id: string
    capabilities: AiServiceKind[]
  }

  interface AiLocalModelService {
    provider: 'ollama' | 'lm-studio'
    label: string
    baseUrl: string
    models: AiLocalModel[]
  }

  interface AiLocalModelDetectionResponse {
    services: AiLocalModelService[]
  }

  type AiVisualSearchErrorCode =
    | 'AI_SEARCH_AUTH_FAILED'
    | 'AI_SEARCH_BAD_RESPONSE'
    | 'AI_SEARCH_FILE_NOT_ALLOWED'
    | 'AI_SEARCH_FILE_UNAVAILABLE'
    | 'AI_SEARCH_INVALID_INPUT'
    | 'AI_SEARCH_NETWORK_ERROR'
    | 'AI_SEARCH_PROFILE_CHANGED'
    | 'AI_SEARCH_PROFILE_NOT_CONFIGURED'
    | 'AI_SEARCH_PROVIDER_ERROR'
    | 'AI_SEARCH_RATE_LIMITED'
    | 'AI_SEARCH_REQUEST_TOO_LARGE'
    | 'AI_SEARCH_STORAGE_ERROR'
    | 'AI_SEARCH_TIMEOUT'
    | 'AI_SEARCH_UNKNOWN'
    | 'AI_SEARCH_UNSUPPORTED_IMAGE'

  interface AiVisualSearchPublicError {
    code: AiVisualSearchErrorCode
    message: string
    status: number | null
    retryable: boolean
  }

  type AiVisualSearchResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: AiVisualSearchPublicError }

  interface AiVisualFrameCandidate {
    resultId: string
    assetId: string
    clipId: string
    projectId: string
    frameId: string
    sourceFingerprint: string
    imagePath: string
    timeSeconds: number
    filename: string
    projectTitle: string
    tags: string[]
    note: string
  }

  interface AiVisualSearchRequest {
    query: string
    candidates: AiVisualFrameCandidate[]
    limit?: number
    profileId?: string | null
    visionProfileId?: string | null
    embeddingProfileId?: string | null
  }

  interface AiVisualSearchMatch {
    resultId: string
    score: number
    reason: string
    descriptionZh: string
    descriptionEn: string
    keywords: string[]
    timeSeconds: number
  }

  interface AiVisualSearchResponse {
    matches: AiVisualSearchMatch[]
    indexedFrameCount: number
    newlyAnalyzedFrameCount: number
    semanticQuery: string
  }

  type EmbyErrorCode =
    | 'EMBY_AUTH_FAILED'
    | 'EMBY_BAD_REQUEST'
    | 'EMBY_BAD_RESPONSE'
    | 'EMBY_FETCH_UNAVAILABLE'
    | 'EMBY_FORBIDDEN'
    | 'EMBY_INVALID_INPUT'
    | 'EMBY_NETWORK_ERROR'
    | 'EMBY_NOT_CONNECTED'
    | 'EMBY_NOT_FOUND'
    | 'EMBY_RATE_LIMITED'
    | 'EMBY_REQUEST_FAILED'
    | 'EMBY_RESPONSE_TOO_LARGE'
    | 'EMBY_SERVER_ERROR'
    | 'EMBY_STORAGE_ERROR'
    | 'EMBY_TIMEOUT'
    | 'EMBY_UNAUTHORIZED'
    | 'EMBY_UNKNOWN'

  interface EmbyPublicError {
    code: EmbyErrorCode
    message: string
    status: number | null
    retryable: boolean
  }

  type EmbyResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: EmbyPublicError }

  interface EmbyConnectionState {
    connected: boolean
    serverUrl: string | null
    serverId: string | null
    serverName: string | null
    user: { id: string; name: string } | null
    connectedAt: string | null
    persistence: 'none' | 'memory' | 'encrypted'
  }

  interface EmbyConnectionRequest {
    serverUrl: string
    username: string
    password: string
    deviceId?: string
  }

  interface EmbySearchRequest {
    query: string
    startIndex?: number
    limit?: number
    parentId?: string
    includeItemTypes?: Array<
      'Movie' | 'Series' | 'Episode' | 'Video' | 'Trailer' | 'MusicVideo'
    >
  }

  interface EmbyItemRequest {
    itemId: string
  }

  interface EmbyImageRequest extends EmbyItemRequest {
    type?:
      | 'Primary'
      | 'Art'
      | 'Backdrop'
      | 'Banner'
      | 'Logo'
      | 'Thumb'
      | 'Disc'
      | 'Box'
      | 'Screenshot'
      | 'Menu'
      | 'Chapter'
    index?: number
    maxWidth?: number
    maxHeight?: number
    quality?: number
    format?: 'original' | 'gif' | 'jpg' | 'png' | 'webp'
  }

  interface EmbyPlaybackInfoRequest extends EmbyItemRequest {}

  interface EmbyPersonDto {
    Name?: string
    Id?: string
    Role?: string
    Type?: string
    PrimaryImageTag?: string
    [key: string]: unknown
  }

  interface EmbyMediaStreamDto {
    Index?: number
    Type?: string
    Codec?: string
    DisplayTitle?: string
    Language?: string
    Width?: number
    Height?: number
    AverageFrameRate?: number
    BitRate?: number
    BitDepth?: number
    Channels?: number
    ChannelLayout?: string
    ExtendedVideoType?: string
    ExtendedVideoSubType?: string
    [key: string]: unknown
  }

  interface EmbyMediaSourceDto {
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
    [key: string]: unknown
  }

  interface EmbyItemDto {
    Id?: string
    Name?: string
    OriginalTitle?: string
    Type?: string
    MediaType?: string
    ProductionYear?: number
    Overview?: string
    RunTimeTicks?: number
    Genres?: string[]
    Tags?: string[]
    People?: EmbyPersonDto[]
    ImageTags?: Record<string, string>
    BackdropImageTags?: string[]
    PrimaryImageAspectRatio?: number
    MediaStreams?: EmbyMediaStreamDto[]
    MediaSources?: EmbyMediaSourceDto[]
    [key: string]: unknown
  }

  interface EmbySearchResponse {
    Items: EmbyItemDto[]
    TotalRecordCount: number
    StartIndex?: number
    [key: string]: unknown
  }

  interface EmbyImageResponse {
    mimeType: string
    data: ArrayBuffer
    byteLength: number
    etag: string | null
    cacheControl: string | null
  }

  interface EmbyPlaybackInfoResponse {
    MediaSources?: EmbyMediaSourceDto[]
    PlaySessionId?: string
    [key: string]: unknown
  }

  interface MediaFileMetadata {
    filePath: string
    filename: string
    durationSeconds: number | null
    sizeBytes: number
    width: number | null
    height: number | null
    fps: number | null
    frameCount: number | null
    codec: string | null
    container: string | null
    capturedAt: string | null
    modifiedAt: string
  }

  interface NativeDialogFilter {
    name: string
    extensions: string[]
  }

  interface NativeDirectoryDialogOptions {
    title?: string
    defaultPath?: string
    buttonLabel?: string
  }

  interface NativeSaveDialogOptions {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: NativeDialogFilter[]
  }

  type MediaOperationKind =
    | 'media-thumbnail'
    | 'preview-proxy'
    | 'visual-index'
    | 'still-export'
    | 'clip-export'

  type MediaOperationPhase =
    | 'probing'
    | 'extracting-thumbnail'
    | 'extracting'
    | 'transcoding-preview'
    | 'finalizing'
    | 'exporting'
    | 'complete'

  interface MediaOperationProgress {
    operationId: string
    kind: MediaOperationKind
    phase: MediaOperationPhase
    progress: number
    processedSeconds: number | null
    totalSeconds: number | null
    assetId?: string
    sourcePath?: string
    destinationPath?: string
  }

  interface VisualIndexBuildRequest {
    assetId: string
    sourcePath: string
    rebuild?: boolean
    operationId?: string
  }

  interface MediaPreviewRequest {
    assetId: string
    sourcePath: string
    forceProxy?: boolean
    rebuild?: boolean
    operationId?: string
  }

  interface MediaThumbnailRequest {
    assetId: string
    sourcePath: string
    durationSeconds?: number | null
    rebuild?: boolean
    operationId?: string
  }

  interface MediaThumbnailResult {
    assetId: string
    sourcePath: string
    thumbnailPath: string
    sizeBytes: number
    modifiedAt: string
    cached: boolean
    createdAt: string
  }

  interface VisualIndexFrame {
    id: string
    index: number
    timeSeconds: number
    imagePath: string
  }

  interface VisualIndexBuildResult {
    operationId: string
    cached: boolean
    version: number
    assetId: string
    sourcePath: string
    posterPath: string
    previewPath: string | null
    playbackPath: string
    usesPreviewProxy: boolean
    frames: VisualIndexFrame[]
    metadata: MediaFileMetadata
    createdAt: string
  }

  interface MediaPreviewResult {
    operationId: string
    cached: boolean
    version: number
    assetId: string
    sourcePath: string
    previewPath: string | null
    playbackPath: string
    usesPreviewProxy: boolean
    metadata: MediaFileMetadata
    createdAt: string
  }

  interface StillExportRequest {
    sourcePath: string
    destinationPath: string
    timeSeconds: number
    width?: number
    height?: number
    quality?: number
    operationId?: string
  }

  interface StillExportResult {
    operationId: string
    destinationPath: string
    sizeBytes: number
  }

  type ClipVideoCodec =
    | 'copy'
    | 'h264'
    | 'hevc'
    | 'prores'
    | 'prores422hq'
    | 'prores4444'
  type ClipAudioCodec = 'none' | 'copy' | 'aac'

  interface ClipExportRequest {
    sourcePath: string
    destinationPath: string
    startSeconds: number
    endSeconds: number
    videoCodec?: ClipVideoCodec
    audioCodec?: ClipAudioCodec
    width?: number
    height?: number
    fps?: number
    /** ffmpeg CRF value for H.264/HEVC. Lower values retain more detail. */
    quality?: number
    operationId?: string
  }

  interface ClipExportResult {
    operationId: string
    destinationPath: string
    sizeBytes: number
    durationSeconds: number
  }

  interface ImportedParticleAsset {
    kind: 'image' | 'video'
    name: string
    managedPath: string
    posterPath: string | null
    width: number
    height: number
    durationSeconds: number | null
    sizeBytes: number
  }

  interface ValidatedParticleAsset {
    kind: 'image' | 'video'
    managedPath: string
    posterPath: string | null
    sizeBytes: number
  }

  type VisualAssetCategory = 'page-background' | 'project-cover'

  interface ImportedVisualAsset {
    name: string
    kind: 'image' | 'video'
    managedPath: string
    sizeBytes: number
  }

  interface ValidatedVisualAsset {
    category: VisualAssetCategory
    kind: 'image' | 'video'
    managedPath: string
    sizeBytes: number
  }

  interface ImportedModelAsset {
    managedPath: string
    name: string
    sizeBytes: number
  }

  interface ModelAssetImportOptions {
    /** Preserve the user-selected OBJ/FBX filename while storing a GLB. */
    sourceName?: string
  }

  interface ModelRenderSaveRequest {
    destinationPath: string
    bytes: Uint8Array
  }

  interface ModelRenderSaveResult {
    destinationPath: string
    sizeBytes: number
  }

  interface ExternalVideoFileDescriptor {
    path: string
    name: string
    sizeBytes: number
    modifiedAt: string
  }

  type OnlineProviderId =
    | 'bilibili'
    | 'tencent'
    | 'xinpianchang'
    | 'youku'

  type OnlineProviderCapability =
    | 'official-playback'
    | 'search'
    | 'pagination'
    | 'account'
    | 'episodes'
    | 'poster-reflection'

  interface OnlineProviderManifestDescriptor {
    schemaVersion: 1
    id: OnlineProviderId
    displayName: string
    adapterVersion: number
    releaseStage: 'stable' | 'beta'
    defaultEnabled: boolean
    capabilities: OnlineProviderCapability[]
  }

  interface OnlineProviderAuthState {
    supported: boolean
    signedIn: boolean
  }

  interface OnlineProviderSelectionDescriptor {
    source: OnlineProviderId
    kind: 'video' | 'episode'
    mediaId: string
    title: string
    description: string
    coverUrl: string | null
    /** Managed absolute path. Remote image URLs must not be persisted. */
    thumbnailPath: string | null
    author: string
    url: string
    canonicalUrl: string
    duration: string
    publishedAt: string
    tags: string[]
  }

  interface OnlineProviderSearchRequest {
    provider: OnlineProviderId
    query: string
    limit?: number
    page?: number
  }

  interface OnlineProviderSearchResponse {
    query: string
    page: number
    pageSize: number
    totalCount: number
    hasMore: boolean
    nextPage: number | null
    results: OnlineProviderSelectionDescriptor[]
  }

  interface BilibiliAuthState {
    signedIn: boolean
  }

  interface TencentVideoAuthState {
    signedIn: boolean
  }

  type BilibiliVideoRequest =
    | { bvid: string; episodeId?: never }
    | { bvid?: never; episodeId: string | number }

  interface BilibiliSelectionDescriptor extends OnlineProviderSelectionDescriptor {
    source: 'bilibili'
    kind: 'video' | 'episode'
    /** Stable BV or ep identifier, without a URL or query string. */
    mediaId: string
    bvid: string | null
    episodeId: string | null
  }

  interface BilibiliSearchRequest {
    query: string
    /** Combined page size across ordinary-video and bangumi result streams. */
    limit?: number
    /** One-based page number; omitted uses the first page. */
    page?: number
  }

  interface BilibiliSearchResponse {
    query: string
    page: number
    pageSize: number
    totalCount: number
    hasMore: boolean
    nextPage: number | null
    results: BilibiliSelectionDescriptor[]
  }

  interface BilibiliEmbeddedFrameRequest {
    kind: 'video' | 'episode'
    mediaId: string
  }

  interface TencentVideoSelectionDescriptor extends OnlineProviderSelectionDescriptor {
    source: 'tencent'
    kind: 'video' | 'episode'
    /** A Tencent VID for video, or CID for an official series/album. */
    mediaId: string
    videoId: string
  }

  interface TencentVideoSearchRequest {
    query: string
    limit?: number
    page?: number
  }

  interface TencentVideoSearchResponse {
    query: string
    page: number
    pageSize: number
    totalCount: number
    hasMore: boolean
    nextPage: number | null
    results: TencentVideoSelectionDescriptor[]
  }

  interface TencentEmbeddedFrameRequest {
    kind: 'video' | 'episode'
    mediaId: string
  }

  interface DesktopBridge {
    platform: 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'
    minimizeWindow(): void
    toggleMaximizeWindow(): Promise<boolean>
    getWindowMaximizedState(): Promise<boolean>
    onWindowMaximizedStateChange(
      listener: (maximized: boolean) => void,
    ): () => void
    getWindowFullscreenState(): Promise<boolean>
    onWindowFullscreenStateChange(
      listener: (fullscreen: boolean) => void,
    ): () => void
    closeWindow(): void
    notifyStartupVisualReady(): void
    selectProjectFolder(): Promise<string | null>
    openProjectFolder(folderPath: string): Promise<boolean>
    selectProjectFile(title?: string): Promise<string | null>
    openProjectFile(filePath: string): Promise<boolean>
    revealProjectFile(filePath: string): Promise<boolean>
    getPathForFile(file: File): string | null
    inspectMediaFile(filePath: string): Promise<MediaFileMetadata>
    createMediaThumbnail(
      request: MediaThumbnailRequest,
    ): Promise<MediaThumbnailResult>
    importParticleAsset(file: File): Promise<ImportedParticleAsset>
    removeParticleAsset(managedPath: string): Promise<boolean>
    validateParticleAsset(
      managedPath: string,
      posterPath: string | null,
    ): Promise<ValidatedParticleAsset | null>
    pruneParticleAssets(referencedPaths: string[]): Promise<number>
    importVisualAsset(
      file: File,
      category: VisualAssetCategory,
    ): Promise<ImportedVisualAsset>
    removeVisualAsset(managedPath: string): Promise<boolean>
    validateVisualAsset(
      managedPath: string,
      category: VisualAssetCategory,
    ): Promise<ValidatedVisualAsset | null>
    pruneVisualAssets(referencedPaths: string[]): Promise<number>
    importModelAsset(
      file: File,
      options?: ModelAssetImportOptions,
    ): Promise<ImportedModelAsset>
    removeModelAsset(managedPath: string): Promise<boolean>
    saveModelRender(
      request: ModelRenderSaveRequest,
    ): Promise<ModelRenderSaveResult>
    selectDirectory(
      options?: NativeDirectoryDialogOptions,
    ): Promise<string | null>
    selectSavePath(options?: NativeSaveDialogOptions): Promise<string | null>
    createMediaOperationId(): string
    getMediaUrl(filePath: string): string | null
    ensureMediaPreview(
      request: MediaPreviewRequest,
    ): Promise<MediaPreviewResult>
    buildVisualIndex(
      request: VisualIndexBuildRequest,
    ): Promise<VisualIndexBuildResult>
    cancelMediaOperation(operationId: string): Promise<boolean>
    exportStill(request: StillExportRequest): Promise<StillExportResult>
    exportClip(request: ClipExportRequest): Promise<ClipExportResult>
    onMediaProgress(
      listener: (progress: MediaOperationProgress) => void,
    ): () => void
    onExternalVideoFiles(
      listener: (files: ExternalVideoFileDescriptor[]) => void,
    ): () => void
    notifyExternalVideoFilesReady(): void
    getOnlineProviderManifests(): Promise<OnlineProviderManifestDescriptor[]>
    searchOnlineProvider(
      request: OnlineProviderSearchRequest,
    ): Promise<OnlineProviderSearchResponse>
    getOnlineProviderAuthState(
      provider: OnlineProviderId,
    ): Promise<OnlineProviderAuthState>
    openOnlineProviderLogin(
      provider: OnlineProviderId,
    ): Promise<OnlineProviderAuthState>
    logoutOnlineProvider(
      provider: OnlineProviderId,
    ): Promise<OnlineProviderAuthState>
    onOnlineProviderAuthStateChange(
      listener: (
        provider: OnlineProviderId,
        state: OnlineProviderAuthState,
      ) => void,
    ): () => void
    getBilibiliAuthState(): Promise<BilibiliAuthState>
    openBilibiliLogin(): Promise<BilibiliAuthState>
    logoutBilibili(): Promise<BilibiliAuthState>
    searchBilibiliVideos(
      request: BilibiliSearchRequest,
    ): Promise<BilibiliSearchResponse>
    openBilibiliVideo(request: BilibiliVideoRequest): Promise<boolean>
    captureBilibiliEmbeddedFrame(
      request: BilibiliEmbeddedFrameRequest,
    ): Promise<string | null>
    getTencentVideoAuthState(): Promise<TencentVideoAuthState>
    openTencentVideoLogin(): Promise<TencentVideoAuthState>
    logoutTencentVideo(): Promise<TencentVideoAuthState>
    searchTencentVideos(
      request: TencentVideoSearchRequest,
    ): Promise<TencentVideoSearchResponse>
    captureTencentEmbeddedFrame(
      request: TencentEmbeddedFrameRequest,
    ): Promise<string | null>
    onBilibiliSelection(
      listener: (descriptor: BilibiliSelectionDescriptor) => void,
    ): () => void
    onBilibiliAuthStateChange(
      listener: (state: BilibiliAuthState) => void,
    ): () => void
    onTencentVideoAuthStateChange(
      listener: (state: TencentVideoAuthState) => void,
    ): () => void
    loadAppData(): Promise<Record<string, unknown> | null>
    saveAppData(data: Record<string, unknown>): Promise<boolean>
    saveAppDataSync?(data: Record<string, unknown>): boolean
    copyText(value: string): Promise<boolean>
    getAiProviderProfiles(): Promise<
      AiProviderResult<AiProviderProfilesState>
    >
    selectAiProviderProfile(
      profileId: string | null,
    ): Promise<AiProviderResult<AiProviderProfilesState>>
    saveAiProviderProfile(
      request: AiProviderProfileInput,
    ): Promise<AiProviderResult<AiProviderProfileSaveResponse>>
    deleteAiProviderProfile(
      profileId: string,
    ): Promise<AiProviderResult<AiProviderProfilesState>>
    testAiProviderProfile(
      request: AiProviderProfileInput,
    ): Promise<AiProviderResult<AiProviderProfileTestResponse>>
    getAiServiceProfiles(): Promise<
      AiProviderResult<AiServiceProfilesState>
    >
    selectAiServiceProfile(
      kind: AiServiceKind,
      profileId: string | null,
    ): Promise<AiProviderResult<AiServiceProfilesState>>
    saveAiServiceProfile(
      kind: AiServiceKind,
      request: AiServiceProfileInput,
    ): Promise<AiProviderResult<AiServiceProfileSaveResponse>>
    deleteAiServiceProfile(
      kind: AiServiceKind,
      profileId: string,
    ): Promise<AiProviderResult<AiServiceProfilesState>>
    testAiServiceProfile(
      kind: AiServiceKind,
      request: AiServiceProfileInput,
    ): Promise<AiProviderResult<AiServiceProfileTestResponse>>
    detectAiLocalModels(): Promise<
      AiProviderResult<AiLocalModelDetectionResponse>
    >
    searchAiVisualFrames(
      request: AiVisualSearchRequest,
    ): Promise<AiVisualSearchResult<AiVisualSearchResponse>>
    getEmbyConnection(): Promise<EmbyResult<EmbyConnectionState>>
    testEmbyConnection(
      request: EmbyConnectionRequest,
    ): Promise<EmbyResult<EmbyConnectionState>>
    disconnectEmby(): Promise<EmbyResult<EmbyConnectionState>>
    searchEmby(request: EmbySearchRequest): Promise<EmbyResult<EmbySearchResponse>>
    getEmbyItem(request: EmbyItemRequest): Promise<EmbyResult<EmbyItemDto>>
    getEmbyImage(request: EmbyImageRequest): Promise<EmbyResult<EmbyImageResponse>>
    getEmbyPlaybackInfo(
      request: EmbyPlaybackInfoRequest,
    ): Promise<EmbyResult<EmbyPlaybackInfoResponse>>
  }

  interface Window {
    desktopBridge?: DesktopBridge
  }
}
