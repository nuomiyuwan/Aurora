const { contextBridge, ipcRenderer, webUtils } = require('electron')

const MODEL_IMPORT_CHUNK_BYTES = 4 * 1024 * 1024

function createMediaOperationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const randomPart = Math.random().toString(36).slice(2)
  return `media-${Date.now().toString(36)}-${randomPart}`
}

function encodeMediaPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null
  const normalizedPath = filePath.trim()
  const bytes = new TextEncoder().encode(normalizedPath)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encodedPath = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `aurora-media://file/${encodedPath}`
}

contextBridge.exposeInMainWorld('desktopBridge', {
  platform: process.platform,
  getAppUpdateState: () => ipcRenderer.invoke('app-update:get-state'),
  checkForAppUpdate: () => ipcRenderer.invoke('app-update:check'),
  downloadAndInstallAppUpdate: () =>
    ipcRenderer.invoke('app-update:download-and-install'),
  onAppUpdateStateChange: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('app-update:state', handler)
    return () => ipcRenderer.removeListener('app-update:state', handler)
  },
  minimizeWindow: () => ipcRenderer.send('window-controls:minimize'),
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke('window-controls:toggle-maximize'),
  getWindowMaximizedState: () =>
    ipcRenderer.invoke('window-controls:get-maximized-state'),
  onWindowMaximizedStateChange: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, maximized) => listener(Boolean(maximized))
    ipcRenderer.on('window-controls:maximized-state', handler)
    return () =>
      ipcRenderer.removeListener('window-controls:maximized-state', handler)
  },
  getWindowFullscreenState: () =>
    ipcRenderer.invoke('window-controls:get-fullscreen-state'),
  onWindowFullscreenStateChange: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, fullscreen) => listener(Boolean(fullscreen))
    ipcRenderer.on('window-controls:fullscreen-state', handler)
    return () =>
      ipcRenderer.removeListener('window-controls:fullscreen-state', handler)
  },
  closeWindow: () => ipcRenderer.send('window-controls:close'),
  notifyStartupVisualReady: () =>
    ipcRenderer.send('startup:visual-ready'),
  selectProjectFolder: () => ipcRenderer.invoke('project-folder:select'),
  openProjectFolder: (folderPath) => ipcRenderer.invoke('project-folder:open', folderPath),
  selectProjectFile: (title) => ipcRenderer.invoke('project-file:select', title),
  openProjectFile: (filePath) => ipcRenderer.invoke('project-file:open', filePath),
  revealProjectFile: (filePath) => ipcRenderer.invoke('project-file:reveal', filePath),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },
  inspectMediaFile: (filePath) => ipcRenderer.invoke('media-file:inspect', filePath),
  createMediaThumbnail: (request) =>
    ipcRenderer.invoke('media-thumbnail:create', request),
  importParticleAsset: (file) => {
    let filePath = ''
    try {
      filePath = webUtils.getPathForFile(file) || ''
    } catch {
      // The main process performs the authoritative validation; avoid sending
      // an unserializable renderer File object across IPC.
    }
    if (!filePath) {
      return Promise.reject(new TypeError('A local particle asset file is required'))
    }
    return ipcRenderer.invoke('particle-asset:import', {
      filePath,
      name: typeof file?.name === 'string' ? file.name : undefined,
    })
  },
  removeParticleAsset: (managedPath) =>
    ipcRenderer.invoke('particle-asset:remove', managedPath),
  validateParticleAsset: (managedPath, posterPath) =>
    ipcRenderer.invoke('particle-asset:validate', { managedPath, posterPath }),
  pruneParticleAssets: (referencedPaths) =>
    ipcRenderer.invoke('particle-asset:prune', referencedPaths),
  importVisualAsset: (file, category) => {
    let sourcePath = ''
    try {
      sourcePath = webUtils.getPathForFile(file) || ''
    } catch {
      // Main performs the authoritative path, category and size validation.
    }
    if (!sourcePath) {
      return Promise.reject(new TypeError('A local visual asset file is required'))
    }
    return ipcRenderer.invoke('visual-asset:import', {
      sourcePath,
      category,
      name: typeof file?.name === 'string' ? file.name : undefined,
    })
  },
  removeVisualAsset: (managedPath) =>
    ipcRenderer.invoke('visual-asset:remove', managedPath),
  validateVisualAsset: (managedPath, category) =>
    ipcRenderer.invoke('visual-asset:validate', { managedPath, category }),
  pruneVisualAssets: (referencedPaths) =>
    ipcRenderer.invoke('visual-asset:prune', referencedPaths),
  importModelAsset: async (file, options = {}) => {
    let filePath = ''
    try {
      filePath = webUtils.getPathForFile(file) || ''
    } catch {
      // The main process validates the GLB before copying it into managed storage.
    }
    const name =
      typeof options?.sourceName === 'string'
        ? options.sourceName
        : typeof file?.name === 'string'
          ? file.name
          : undefined
    if (filePath) {
      return ipcRenderer.invoke('model-asset:import', { filePath, name })
    }
    if (
      file &&
      typeof file.slice === 'function' &&
      Number.isSafeInteger(file.size)
    ) {
      const started = await ipcRenderer.invoke('model-asset:import-begin', {
        name,
        sizeBytes: file.size,
      })
      try {
        for (let offset = 0; offset < file.size; offset += MODEL_IMPORT_CHUNK_BYTES) {
          const bytes = new Uint8Array(
            await file
              .slice(offset, Math.min(file.size, offset + MODEL_IMPORT_CHUNK_BYTES))
              .arrayBuffer(),
          )
          await ipcRenderer.invoke('model-asset:import-chunk', {
            operationId: started.operationId,
            bytes,
          })
        }
        return await ipcRenderer.invoke('model-asset:import-complete', {
          operationId: started.operationId,
        })
      } catch (error) {
        await ipcRenderer.invoke('model-asset:import-abort', {
          operationId: started.operationId,
        }).catch(() => undefined)
        throw error
      }
    }
    throw new TypeError('A local or converted GLB file is required')
  },
  removeModelAsset: (managedPath) =>
    ipcRenderer.invoke('model-asset:remove', managedPath),
  saveModelRender: (request) =>
    ipcRenderer.invoke('model-render:save', request),
  selectDirectory: (options) => ipcRenderer.invoke('media-directory:select', options),
  selectSavePath: (options) => ipcRenderer.invoke('media-save-path:select', options),
  createMediaOperationId,
  getMediaUrl: (filePath) => encodeMediaPath(filePath),
  ensureMediaPreview: (request) =>
    ipcRenderer.invoke('media-preview:ensure', request),
  buildVisualIndex: (request) => ipcRenderer.invoke('media-index:build', request),
  analyzeFrameQuality: (request) =>
    ipcRenderer.invoke('frame-intelligence:analyze-quality', request),
  cancelMediaOperation: (operationId) =>
    ipcRenderer.invoke('media-operation:cancel', { operationId }),
  exportStill: (request) => ipcRenderer.invoke('media-still:export', request),
  exportClip: (request) => ipcRenderer.invoke('media-clip:export', request),
  onMediaProgress: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('media:progress', handler)
    return () => ipcRenderer.removeListener('media:progress', handler)
  },
  onExternalVideoFiles: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('external-video-files:open', handler)
    return () => ipcRenderer.removeListener('external-video-files:open', handler)
  },
  notifyExternalVideoFilesReady: () =>
    ipcRenderer.send('external-video-files:renderer-ready'),
  getOnlineProviderManifests: () =>
    ipcRenderer.invoke('online-provider:manifests:get'),
  searchOnlineProvider: (request) =>
    ipcRenderer.invoke('online-provider:search', request),
  getOnlineProviderAuthState: (provider) =>
    ipcRenderer.invoke('online-provider:auth:get', provider),
  openOnlineProviderLogin: (provider) =>
    ipcRenderer.invoke('online-provider:login:open', provider),
  logoutOnlineProvider: (provider) =>
    ipcRenderer.invoke('online-provider:logout', provider),
  onOnlineProviderAuthStateChange: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, payload) => {
      if (!payload || typeof payload.provider !== 'string') return
      listener(payload.provider, {
        supported: payload.state?.supported !== false,
        signedIn: Boolean(payload.state?.signedIn),
      })
    }
    ipcRenderer.on('online-provider:auth-state', handler)
    return () =>
      ipcRenderer.removeListener('online-provider:auth-state', handler)
  },
  getBilibiliAuthState: () => ipcRenderer.invoke('bilibili:auth:get'),
  openBilibiliLogin: () => ipcRenderer.invoke('bilibili:login:open'),
  logoutBilibili: () => ipcRenderer.invoke('bilibili:logout'),
  searchBilibiliVideos: (request) =>
    ipcRenderer.invoke('bilibili:search', request),
  openBilibiliVideo: (request) =>
    ipcRenderer.invoke('bilibili:video:open', request),
  captureBilibiliEmbeddedFrame: (request) =>
    ipcRenderer.invoke('bilibili:embedded:capture', request),
  getTencentVideoAuthState: () => ipcRenderer.invoke('tencent:auth:get'),
  openTencentVideoLogin: () => ipcRenderer.invoke('tencent:login:open'),
  logoutTencentVideo: () => ipcRenderer.invoke('tencent:logout'),
  searchTencentVideos: (request) =>
    ipcRenderer.invoke('tencent:search', request),
  captureTencentEmbeddedFrame: (request) =>
    ipcRenderer.invoke('tencent:embedded:capture', request),
  captureXinpianchangEmbeddedFrame: (request) =>
    ipcRenderer.invoke('xinpianchang:embedded:capture', request),
  captureYoukuEmbeddedFrame: (request) =>
    ipcRenderer.invoke('youku:embedded:capture', request),
  onBilibiliSelection: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, descriptor) => listener(descriptor)
    ipcRenderer.on('bilibili:selection', handler)
    return () => ipcRenderer.removeListener('bilibili:selection', handler)
  },
  onBilibiliAuthStateChange: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, state) => listener({
      signedIn: Boolean(state?.signedIn),
    })
    ipcRenderer.on('bilibili:auth-state', handler)
    return () => ipcRenderer.removeListener('bilibili:auth-state', handler)
  },
  onTencentVideoAuthStateChange: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, state) => listener({
      signedIn: Boolean(state?.signedIn),
    })
    ipcRenderer.on('tencent:auth-state', handler)
    return () => ipcRenderer.removeListener('tencent:auth-state', handler)
  },
  loadAppData: () => ipcRenderer.invoke('app-data:load'),
  saveAppData: (data) => ipcRenderer.invoke('app-data:save', data),
  saveAppDataSync: (data) => ipcRenderer.sendSync('app-data:save-sync', data),
  copyText: (value) => ipcRenderer.invoke('clipboard:write-text', value),
  getAiProviderProfiles: () =>
    ipcRenderer.invoke('ai:provider-profiles:get'),
  selectAiProviderProfile: (profileId) =>
    ipcRenderer.invoke('ai:provider-profiles:select', profileId),
  saveAiProviderProfile: (request) =>
    ipcRenderer.invoke('ai:provider-profiles:save', request),
  deleteAiProviderProfile: (profileId) =>
    ipcRenderer.invoke('ai:provider-profiles:delete', profileId),
  testAiProviderProfile: (request) =>
    ipcRenderer.invoke('ai:provider-profiles:test', request),
  getAiServiceProfiles: () =>
    ipcRenderer.invoke('ai:service-profiles:get'),
  selectAiServiceProfile: (kind, profileId) =>
    ipcRenderer.invoke('ai:service-profiles:select', { kind, profileId }),
  saveAiServiceProfile: (kind, input) =>
    ipcRenderer.invoke('ai:service-profiles:save', { kind, input }),
  deleteAiServiceProfile: (kind, profileId) =>
    ipcRenderer.invoke('ai:service-profiles:delete', { kind, profileId }),
  testAiServiceProfile: (kind, input) =>
    ipcRenderer.invoke('ai:service-profiles:test', { kind, input }),
  detectAiLocalModels: () =>
    ipcRenderer.invoke('ai:local-models:detect'),
  searchAiVisualFrames: (request) =>
    ipcRenderer.invoke('ai:visual-search:search', request),
  analyzeAiVisualFrames: (request) =>
    ipcRenderer.invoke('ai:visual-search:analyze-frames', request),
  getEmbyConnection: () => ipcRenderer.invoke('emby:connection:get'),
  testEmbyConnection: (request) => ipcRenderer.invoke('emby:connection:test', request),
  disconnectEmby: () => ipcRenderer.invoke('emby:connection:disconnect'),
  searchEmby: (request) => ipcRenderer.invoke('emby:search', request),
  getEmbyItem: (request) => ipcRenderer.invoke('emby:item:get', request),
  getEmbyImage: (request) => ipcRenderer.invoke('emby:image:get', request),
  getEmbyPlaybackInfo: (request) => ipcRenderer.invoke('emby:playback-info:get', request),
})
