const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  protocol,
  safeStorage,
  session,
  shell,
} = require('electron')
const { autoUpdater } = require('electron-updater')
const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')
const {
  createEmbySessionManager,
  normalizeEmbyError,
} = require('./embyClient.cjs')
const {
  AiCredentialError,
  createAiCredentialsStore,
  normalizeAiCredentialError,
} = require('./aiCredentials.cjs')
const {
  createAiVisualSearchService,
  normalizeAiVisualSearchError,
} = require('./aiVisualSearch.cjs')
const { createAiLocalModelDetector } = require('./aiLocalModels.cjs')
const { createAiContactSheetComposer } = require('./aiContactSheet.cjs')
const {
  createFrameIntelligenceEngine,
} = require('./frameIntelligence.cjs')
const { inspectMediaFile } = require('./mediaProbe.cjs')
const {
  MEDIA_URL_SCHEME,
  createMediaPipeline,
  decodeMediaUrl,
} = require('./mediaPipeline.cjs')
const { createParticleAssetManager } = require('./particleAssets.cjs')
const { createVisualAssetStore } = require('./visualAssets.cjs')
const { createModelAssetManager } = require('./modelAssets.cjs')
const { createWindowRevealGate } = require('./windowRevealGate.cjs')
const { toggleWindowFullscreen } = require('./windowControls.cjs')
const { createExternalVideoOpenBroker } = require('./externalVideoOpen.cjs')
const { createAppUpdateManager } = require('./appUpdater.cjs')
const {
  createOnlineProviderRegistry,
} = require('./onlineProviderRegistry.cjs')
const {
  installOnlinePlayerWebviewFirewall,
} = require('./onlinePlayerWebviewGuard.cjs')
const {
  BILIBILI_PARTITION,
  captureBilibiliEmbeddedFrame,
  createBilibiliSessionManager,
  installBilibiliPlayerWebviewGuard,
} = require('./bilibiliSession.cjs')
const {
  TENCENT_VIDEO_PARTITION,
  captureTencentEmbeddedFrame,
  createTencentVideoSessionManager,
  installTencentPlayerWebviewGuard,
} = require('./tencentVideoSession.cjs')
const {
  XINPIANCHANG_PARTITION,
  captureXinpianchangEmbeddedFrame,
  createXinpianchangSessionManager,
  installXinpianchangPlayerWebviewGuard,
} = require('./xinpianchangSession.cjs')
const {
  YOUKU_PARTITION,
  captureYoukuEmbeddedFrame,
  createYoukuSessionManager,
  installYoukuPlayerWebviewGuard,
} = require('./youkuSession.cjs')
const {
  DOUYIN_PARTITION,
  createDouyinSessionManager,
  installDouyinPlayerWebviewGuard,
} = require('./douyinSession.cjs')

const isDev = !app.isPackaged
const STARTUP_VISUAL_READY_CHANNEL = 'startup:visual-ready'
const EXTERNAL_VIDEO_FILES_CHANNEL = 'external-video-files:open'
const EXTERNAL_VIDEO_RENDERER_READY_CHANNEL = 'external-video-files:renderer-ready'
const WINDOW_MINIMIZE_CHANNEL = 'window-controls:minimize'
const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = 'window-controls:toggle-maximize'
const WINDOW_TOGGLE_FULLSCREEN_CHANNEL = 'window-controls:toggle-fullscreen'
const WINDOW_MAXIMIZED_STATE_CHANNEL = 'window-controls:maximized-state'
const WINDOW_GET_MAXIMIZED_STATE_CHANNEL = 'window-controls:get-maximized-state'
const WINDOW_FULLSCREEN_STATE_CHANNEL = 'window-controls:fullscreen-state'
const WINDOW_GET_FULLSCREEN_STATE_CHANNEL = 'window-controls:get-fullscreen-state'
const WINDOW_CLOSE_CHANNEL = 'window-controls:close'
const BILIBILI_SELECTION_CHANNEL = 'bilibili:selection'
const BILIBILI_AUTH_STATE_CHANNEL = 'bilibili:auth-state'
const TENCENT_VIDEO_AUTH_STATE_CHANNEL = 'tencent:auth-state'
const ONLINE_PROVIDER_AUTH_STATE_CHANNEL = 'online-provider:auth-state'
const APP_UPDATE_STATE_CHANNEL = 'app-update:state'
const APP_UPDATE_GET_STATE_CHANNEL = 'app-update:get-state'
const APP_UPDATE_CHECK_CHANNEL = 'app-update:check'
const APP_UPDATE_INSTALL_CHANNEL = 'app-update:download-and-install'
const WINDOW_REVEAL_FALLBACK_MS = 8_000
let saveQueue = Promise.resolve()
let appDataSyncEpoch = 0
let appDataWriteSequence = 0
let latestSynchronousAppData = null
let mediaPipeline = null
let particleAssetManager = null
let visualAssetStore = null
let modelAssetManager = null
let bilibiliSessionManager = null
let tencentVideoSessionManager = null
let xinpianchangSessionManager = null
let youkuSessionManager = null
let douyinSessionManager = null
let onlineProviderRegistry = null
let appUpdateManager = null
let mainWindow = null
let createWindowPromise = null
let windowCreationReady = false
const revealedWindows = new WeakSet()
const focusAfterRevealWindows = new WeakSet()

app.setName('Aurora')
const userDataArgument = process.argv.find((argument) =>
  argument.startsWith('--aurora-user-data-dir='),
)
const userDataOverride =
  process.env.AURORA_USER_DATA_DIR ??
  (userDataArgument ? userDataArgument.slice('--aurora-user-data-dir='.length) : null)
app.setPath(
  'userData',
  typeof userDataOverride === 'string' && path.isAbsolute(userDataOverride)
    ? userDataOverride
    : path.join(app.getPath('appData'), 'Aurora'),
)

const externalVideoOpenBroker = createExternalVideoOpenBroker()

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady() && windowCreationReady) {
      void ensureMainWindow().then(focusMainWindow).catch(() => undefined)
    }
    return
  }
  if (!mainWindow.isVisible() && !revealedWindows.has(mainWindow)) {
    // Keep the first frame behind the native + renderer reveal gate. Finder may
    // deliver open-file while the hidden window is still warming its visuals.
    focusAfterRevealWindows.add(mainWindow)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function enqueueExternalVideoPaths(filePaths) {
  const accepted = externalVideoOpenBroker.enqueue(filePaths)
  if (accepted.length > 0) focusMainWindow()
  return accepted
}

function getWindowsControlTarget(event) {
  if (process.platform !== 'win32') return null
  const target = BrowserWindow.fromWebContents(event.sender)
  return target && !target.isDestroyed() ? target : null
}

function requireMainWindowSender(event) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event?.sender !== mainWindow.webContents
  ) {
    throw new Error('Unauthorized Aurora renderer')
  }
  return mainWindow
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    enqueueExternalVideoPaths(argv)
    focusMainWindow()
  })
}

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  enqueueExternalVideoPaths([filePath])
})

if (hasSingleInstanceLock) {
  enqueueExternalVideoPaths(process.argv.slice(1))
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_URL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function appDataPath() {
  return path.join(app.getPath('userData'), 'aurora-data.json')
}

function embyConnectionPath() {
  return path.join(app.getPath('userData'), 'emby-connection.json')
}

function aiCredentialsPath() {
  return path.join(app.getPath('userData'), 'ai-credentials.json')
}

async function readAppData() {
  try {
    const data = await fs.promises.readFile(appDataPath(), 'utf8')
    return JSON.parse(data)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function writeAppData(data, syncEpoch, writeId) {
  if (syncEpoch !== appDataSyncEpoch) return true
  const filePath = appDataPath()
  const tempPath = `${filePath}.${process.pid}.${writeId}.tmp`
  const currentData = (await readAppData()) || {}
  const nextData = {
    ...currentData,
    ...data,
    updatedAt: new Date().toISOString(),
  }

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(tempPath, JSON.stringify(nextData, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  if (syncEpoch !== appDataSyncEpoch) {
    await fs.promises.unlink(tempPath).catch(() => undefined)
    return true
  }
  try {
    await fs.promises.copyFile(filePath, `${filePath}.bak`)
    await fs.promises.chmod(`${filePath}.bak`, 0o600).catch(() => undefined)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (syncEpoch !== appDataSyncEpoch) {
    await fs.promises.unlink(tempPath).catch(() => undefined)
    return true
  }
  await fs.promises.rename(tempPath, filePath)
  await fs.promises.chmod(filePath, 0o600).catch(() => undefined)

  /*
   * A synchronous renderer-unload save can happen after the last epoch check
   * but before this asynchronous rename completes. In that narrow window the
   * stale rename wins at the filesystem layer, so immediately restore the
   * authoritative final snapshot before resolving the queued write.
   */
  if (syncEpoch !== appDataSyncEpoch && latestSynchronousAppData) {
    writeAppDataSnapshotSync(latestSynchronousAppData, 'repair')
  }

  return true
}

function queueWriteAppData(data) {
  const syncEpoch = appDataSyncEpoch
  appDataWriteSequence += 1
  const writeId = appDataWriteSequence
  saveQueue = saveQueue.then(
    () => writeAppData(data, syncEpoch, writeId),
    () => writeAppData(data, syncEpoch, writeId),
  )
  return saveQueue
}

function writeAppDataSnapshotSync(snapshot, suffix = 'sync') {
  appDataWriteSequence += 1
  const writeId = appDataWriteSequence
  const filePath = appDataPath()
  const tempPath = `${filePath}.${process.pid}.${writeId}.${suffix}.tmp`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    fs.copyFileSync(filePath, `${filePath}.bak`)
    fs.chmodSync(`${filePath}.bak`, 0o600)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  fs.renameSync(tempPath, filePath)
  fs.chmodSync(filePath, 0o600)
}

function writeAppDataSync(data) {
  appDataSyncEpoch += 1
  const filePath = appDataPath()
  let currentData = {}
  try {
    currentData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const nextData = {
    ...currentData,
    ...data,
    updatedAt: new Date().toISOString(),
  }
  latestSynchronousAppData = nextData
  writeAppDataSnapshotSync(nextData)
  return true
}

function createEncryptedEmbyPersistence() {
  return {
    async load() {
      if (!safeStorage.isEncryptionAvailable()) return null

      try {
        const text = await fs.promises.readFile(embyConnectionPath(), 'utf8')
        const stored = JSON.parse(text)
        if (!stored || stored.version !== 1 || typeof stored.encryptedToken !== 'string') {
          return null
        }

        const token = safeStorage.decryptString(Buffer.from(stored.encryptedToken, 'base64'))
        return {
          ...stored.connection,
          token,
        }
      } catch {
        return null
      }
    },

    async save(connection) {
      if (!safeStorage.isEncryptionAvailable()) return false

      const filePath = embyConnectionPath()
      const tempPath = `${filePath}.tmp`
      const encryptedToken = safeStorage.encryptString(connection.token).toString('base64')
      const stored = {
        version: 1,
        connection: {
          serverUrl: connection.serverUrl,
          serverId: connection.serverId,
          serverName: connection.serverName,
          userId: connection.userId,
          userName: connection.userName,
          deviceId: connection.deviceId,
          connectedAt: connection.connectedAt,
        },
        encryptedToken,
      }

      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(tempPath, JSON.stringify(stored, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      })
      await fs.promises.rename(tempPath, filePath)
      await fs.promises.chmod(filePath, 0o600)
      return true
    },

    async clear() {
      try {
        await fs.promises.unlink(embyConnectionPath())
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    },
  }
}

const embyManager = createEmbySessionManager({
  clientName: 'Aurora',
  deviceName: 'Aurora Desktop',
  version: app.getVersion(),
  persistence: createEncryptedEmbyPersistence(),
})

const aiCredentialsStore = createAiCredentialsStore({
  filePath: aiCredentialsPath(),
  safeStorage,
})
const composeAiContactSheet = createAiContactSheetComposer()

const aiVisualSearchService = createAiVisualSearchService({
  userDataPath: app.getPath('userData'),
  credentialsStore: aiCredentialsStore,
  contactSheetComposer: {
    compose: composeAiContactSheet,
  },
})
const aiLocalModelDetector = createAiLocalModelDetector()
const frameIntelligenceEngine = createFrameIntelligenceEngine()

function embyIpcHandler(operation) {
  return async (_event, request) => {
    try {
      return {
        ok: true,
        data: await operation(request),
      }
    } catch (error) {
      return {
        ok: false,
        error: normalizeEmbyError(error),
      }
    }
  }
}

function aiCredentialIpcHandler(operation) {
  return async (_event, value) => {
    try {
      return {
        ok: true,
        data: await operation(value),
      }
    } catch (error) {
      return {
        ok: false,
        error: normalizeAiCredentialError(error),
      }
    }
  }
}

function aiVisualSearchIpcHandler(operation) {
  return async (_event, request) => {
    try {
      return {
        ok: true,
        data: await operation(request),
      }
    } catch (error) {
      return {
        ok: false,
        error: normalizeAiVisualSearchError(error),
      }
    }
  }
}

function aiProviderTestIpcHandler(operation) {
  return async (_event, request) => {
    try {
      return {
        ok: true,
        data: await operation(request),
      }
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof AiCredentialError
            ? normalizeAiCredentialError(error)
            : normalizeAiVisualSearchError(error),
      }
    }
  }
}

function normalizeDialogFilters(input) {
  if (!Array.isArray(input)) return undefined
  const filters = input
    .filter((filter) => filter && typeof filter === 'object')
    .map((filter) => ({
      name:
        typeof filter.name === 'string' && filter.name.trim() !== ''
          ? filter.name.trim().slice(0, 120)
          : '文件',
      extensions: Array.isArray(filter.extensions)
        ? filter.extensions
            .filter(
              (extension) =>
                typeof extension === 'string' &&
                /^[A-Za-z0-9*]{1,16}$/.test(extension),
            )
            .slice(0, 32)
        : [],
    }))
    .filter((filter) => filter.extensions.length > 0)
  return filters.length > 0 ? filters : undefined
}

function registerMediaFileProtocol() {
  protocol.handle(MEDIA_URL_SCHEME, async (request) => {
    const filePath = decodeMediaUrl(request.url)
    if (!filePath) {
      return new Response('Invalid media path', { status: 403 })
    }

    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) {
        return new Response('Media file not found', { status: 404 })
      }
      const mimeTypes = {
        '.3gp': 'video/3gpp',
        '.avif': 'image/avif',
        '.avi': 'video/x-msvideo',
        '.bmp': 'image/bmp',
        '.flv': 'video/x-flv',
        '.gif': 'image/gif',
        '.glb': 'model/gltf-binary',
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/jpeg',
        '.m2ts': 'video/mp2t',
        '.m4v': 'video/x-m4v',
        '.mkv': 'video/x-matroska',
        '.mov': 'video/quicktime',
        '.mp4': 'video/mp4',
        '.mpeg': 'video/mpeg',
        '.mpg': 'video/mpeg',
        '.mts': 'video/mp2t',
        '.mxf': 'application/mxf',
        '.png': 'image/png',
        '.tif': 'image/tiff',
        '.tiff': 'image/tiff',
        '.ts': 'video/mp2t',
        '.webm': 'video/webm',
        '.webp': 'image/webp',
        '.wmv': 'video/x-ms-wmv',
      }
      const contentType = mimeTypes[path.extname(filePath).toLowerCase()]
      if (!contentType) {
        return new Response('Unsupported media type', { status: 403 })
      }
      const headers = new Headers({
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      const rangeHeader = request.headers.get('range')
      let start = 0
      let end = Math.max(0, stat.size - 1)
      let status = 200

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
        if (!match || stat.size === 0) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${stat.size}` },
          })
        }

        if (match[1] === '') {
          const suffixLength = Number(match[2])
          if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` },
            })
          }
          start = Math.max(0, stat.size - suffixLength)
        } else {
          start = Number(match[1])
          if (!Number.isSafeInteger(start) || start >= stat.size) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` },
            })
          }
        }

        if (match[2] !== '') {
          const requestedEnd = Number(match[2])
          if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` },
            })
          }
          end = Math.min(end, requestedEnd)
        }
        status = 206
        headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      }

      const contentLength = stat.size === 0 ? 0 : end - start + 1
      headers.set('Content-Length', String(contentLength))
      if (request.method === 'HEAD' || stat.size === 0) {
        return new Response(null, { status, headers })
      }
      const body = Readable.toWeb(fs.createReadStream(filePath, { start, end }))
      return new Response(body, { status, headers })
    } catch {
      return new Response('Media file not found', { status: 404 })
    }
  })
}

async function createWindow() {
  const windowInstance = new BrowserWindow({
    width: 1440,
    height: 930,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    title: 'Aurora',
    backgroundColor: '#03060a',
    autoHideMenuBar: process.platform === 'win32',
    frame: process.platform !== 'win32',
    thickFrame: process.platform === 'win32',
    roundedCorners: true,
    hasShadow: true,
    transparent: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true,
    },
  })
  mainWindow = windowInstance
  const disposeOnlinePlayerWebviewFirewall =
    installOnlinePlayerWebviewFirewall(windowInstance.webContents, [
      BILIBILI_PARTITION,
      TENCENT_VIDEO_PARTITION,
      XINPIANCHANG_PARTITION,
      YOUKU_PARTITION,
      DOUYIN_PARTITION,
    ])
  const disposeBilibiliPlayerWebviewGuard =
    installBilibiliPlayerWebviewGuard(
      windowInstance.webContents,
      session.fromPartition(BILIBILI_PARTITION),
    )
  const disposeTencentPlayerWebviewGuard =
    installTencentPlayerWebviewGuard(
      windowInstance.webContents,
      session.fromPartition(TENCENT_VIDEO_PARTITION),
    )
  const disposeXinpianchangPlayerWebviewGuard =
    installXinpianchangPlayerWebviewGuard(
      windowInstance.webContents,
      session.fromPartition(XINPIANCHANG_PARTITION),
    )
  const disposeYoukuPlayerWebviewGuard =
    installYoukuPlayerWebviewGuard(
      windowInstance.webContents,
      session.fromPartition(YOUKU_PARTITION),
    )
  const disposeDouyinPlayerWebviewGuard =
    installDouyinPlayerWebviewGuard(
      windowInstance.webContents,
      session.fromPartition(DOUYIN_PARTITION),
    )

  const notifyMaximizedState = () => {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send(
        WINDOW_MAXIMIZED_STATE_CHANNEL,
        windowInstance.isMaximized(),
      )
    }
  }
  windowInstance.on('maximize', notifyMaximizedState)
  windowInstance.on('unmaximize', notifyMaximizedState)

  const notifyFullscreenState = () => {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send(
        WINDOW_FULLSCREEN_STATE_CHANNEL,
        windowInstance.isFullScreen(),
      )
    }
  }
  windowInstance.on('enter-full-screen', notifyFullscreenState)
  windowInstance.on('leave-full-screen', notifyFullscreenState)

  const revealGate = createWindowRevealGate({
    reveal: () => windowInstance.show(),
    isDestroyed: () => windowInstance.isDestroyed(),
    timeoutMs: WINDOW_REVEAL_FALLBACK_MS,
  })
  const handleStartupVisualReady = (event) => {
    if (
      windowInstance.isDestroyed() ||
      event.sender !== windowInstance.webContents
    ) {
      return
    }
    revealGate.markRendererReady()
  }
  const cleanupRevealGate = () => {
    revealGate.dispose()
    ipcMain.removeListener(
      STARTUP_VISUAL_READY_CHANNEL,
      handleStartupVisualReady,
    )
  }

  ipcMain.on(STARTUP_VISUAL_READY_CHANNEL, handleStartupVisualReady)
  windowInstance.once('ready-to-show', () => revealGate.markNativeReady())
  windowInstance.once('show', () => {
    revealedWindows.add(windowInstance)
    if (focusAfterRevealWindows.has(windowInstance)) {
      focusAfterRevealWindows.delete(windowInstance)
      if (windowInstance.isMinimized()) windowInstance.restore()
      windowInstance.focus()
    }
  })
  windowInstance.once('show', cleanupRevealGate)
  windowInstance.once('closed', cleanupRevealGate)
  windowInstance.once('closed', disposeOnlinePlayerWebviewFirewall)
  windowInstance.once('closed', disposeBilibiliPlayerWebviewGuard)
  windowInstance.once('closed', disposeTencentPlayerWebviewGuard)
  windowInstance.once('closed', disposeXinpianchangPlayerWebviewGuard)
  windowInstance.once('closed', disposeYoukuPlayerWebviewGuard)
  windowInstance.once('closed', disposeDouyinPlayerWebviewGuard)
  windowInstance.once('closed', () => {
    externalVideoOpenBroker.clearConsumer()
    onlineProviderRegistry?.closeWindows()
    if (mainWindow === windowInstance) mainWindow = null
  })

  if (isDev) {
    await windowInstance.loadURL('http://127.0.0.1:5174')
  } else {
    await windowInstance.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function ensureMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return Promise.resolve(mainWindow)
  }
  if (createWindowPromise) return createWindowPromise
  createWindowPromise = createWindow()
    .then(() => mainWindow)
    .finally(() => {
      createWindowPromise = null
    })
  return createWindowPromise
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  if (process.platform === 'win32') Menu.setApplicationMenu(null)

  appUpdateManager = createAppUpdateManager({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    feedConfigurations: [
      {
        provider: 'generic',
        url: 'https://gitcode.com/nuomiyuwan/Aurora-Updates/releases/download/latest/',
        requestHeaders: { 'Private-Token': '' },
      },
      {
        provider: 'github',
        owner: 'nuomiyuwan',
        repo: 'Aurora',
      },
    ],
    onStateChange: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(APP_UPDATE_STATE_CHANNEL, state)
      }
    },
  })

  ipcMain.handle(APP_UPDATE_GET_STATE_CHANNEL, (event) => {
    requireMainWindowSender(event)
    return appUpdateManager.getState()
  })
  ipcMain.handle(APP_UPDATE_CHECK_CHANNEL, (event) => {
    requireMainWindowSender(event)
    return appUpdateManager.checkForUpdates({ source: 'manual' })
  })
  ipcMain.handle(APP_UPDATE_INSTALL_CHANNEL, (event) => {
    requireMainWindowSender(event)
    return appUpdateManager.downloadAndInstall()
  })

  ipcMain.on(WINDOW_MINIMIZE_CHANNEL, (event) => {
    getWindowsControlTarget(event)?.minimize()
  })
  ipcMain.handle(WINDOW_TOGGLE_MAXIMIZE_CHANNEL, (event) => {
    const target = getWindowsControlTarget(event)
    if (!target) return false
    if (target.isMaximized()) target.unmaximize()
    else target.maximize()
    return target.isMaximized()
  })
  ipcMain.handle(WINDOW_TOGGLE_FULLSCREEN_CHANNEL, (event) =>
    toggleWindowFullscreen(getWindowsControlTarget(event)),
  )
  ipcMain.handle(WINDOW_GET_MAXIMIZED_STATE_CHANNEL, (event) =>
    getWindowsControlTarget(event)?.isMaximized() ?? false,
  )
  ipcMain.handle(WINDOW_GET_FULLSCREEN_STATE_CHANNEL, (event) =>
    getWindowsControlTarget(event)?.isFullScreen() ?? false,
  )
  ipcMain.on(WINDOW_CLOSE_CHANNEL, (event) => {
    getWindowsControlTarget(event)?.close()
  })

  await embyManager.initialize()
  registerMediaFileProtocol()
  mediaPipeline = createMediaPipeline({
    userDataPath: app.getPath('userData'),
    onProgress: (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media:progress', payload)
      }
    },
  })
  particleAssetManager = createParticleAssetManager({
    userDataPath: app.getPath('userData'),
  })
  visualAssetStore = createVisualAssetStore({
    userDataPath: app.getPath('userData'),
  })
  modelAssetManager = createModelAssetManager({
    userDataPath: app.getPath('userData'),
  })
  bilibiliSessionManager = createBilibiliSessionManager({
    BrowserWindow,
    sessionModule: session,
    getParentWindow: () => mainWindow,
    cacheDirectory: path.join(
      app.getPath('userData'),
      'bilibili-cache',
      'thumbnails',
    ),
    isDev,
    onSelection: (descriptor) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(BILIBILI_SELECTION_CHANNEL, descriptor)
      }
    },
    onAuthStateChange: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(BILIBILI_AUTH_STATE_CHANNEL, state)
        mainWindow.webContents.send(ONLINE_PROVIDER_AUTH_STATE_CHANNEL, {
          provider: 'bilibili',
          state: { supported: true, signedIn: Boolean(state?.signedIn) },
        })
      }
    },
  })
  tencentVideoSessionManager = createTencentVideoSessionManager({
    BrowserWindow,
    sessionModule: session,
    getParentWindow: () => mainWindow,
    cacheDirectory: path.join(
      app.getPath('userData'),
      'tencent-video-cache',
      'thumbnails',
    ),
    isDev,
    onAuthStateChange: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(TENCENT_VIDEO_AUTH_STATE_CHANNEL, state)
        mainWindow.webContents.send(ONLINE_PROVIDER_AUTH_STATE_CHANNEL, {
          provider: 'tencent',
          state: { supported: true, signedIn: Boolean(state?.signedIn) },
        })
      }
    },
  })
  xinpianchangSessionManager = createXinpianchangSessionManager({
    BrowserWindow,
    sessionModule: session,
    getParentWindow: () => mainWindow,
    cacheDirectory: path.join(
      app.getPath('userData'),
      'xinpianchang-cache',
      'thumbnails',
    ),
    onAuthStateChange: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(ONLINE_PROVIDER_AUTH_STATE_CHANNEL, {
          provider: 'xinpianchang',
          state: { supported: true, signedIn: Boolean(state?.signedIn) },
        })
      }
    },
  })
  youkuSessionManager = createYoukuSessionManager({
    BrowserWindow,
    sessionModule: session,
    getParentWindow: () => mainWindow,
    cacheDirectory: path.join(
      app.getPath('userData'),
      'youku-cache',
      'thumbnails',
    ),
    onAuthStateChange: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(ONLINE_PROVIDER_AUTH_STATE_CHANNEL, {
          provider: 'youku',
          state: { supported: true, signedIn: Boolean(state?.signedIn) },
        })
      }
    },
  })
  douyinSessionManager = createDouyinSessionManager({
    BrowserWindow,
    sessionModule: session,
    getParentWindow: () => mainWindow,
    cacheDirectory: path.join(
      app.getPath('userData'),
      'douyin-cache',
      'thumbnails',
    ),
    onAuthStateChange: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(ONLINE_PROVIDER_AUTH_STATE_CHANNEL, {
          provider: 'douyin',
          state: { supported: true, signedIn: Boolean(state?.signedIn) },
        })
      }
    },
  })
  onlineProviderRegistry = createOnlineProviderRegistry({
    adapters: {
      bilibili: bilibiliSessionManager,
      tencent: tencentVideoSessionManager,
      xinpianchang: xinpianchangSessionManager,
      youku: youkuSessionManager,
      douyin: douyinSessionManager,
    },
  })

  ipcMain.handle('online-provider:manifests:get', (event) => {
    requireMainWindowSender(event)
    return onlineProviderRegistry.listManifests()
  })
  ipcMain.handle('online-provider:search', async (event, request) => {
    requireMainWindowSender(event)
    return onlineProviderRegistry.search(request)
  })
  ipcMain.handle('online-provider:auth:get', async (event, provider) => {
    requireMainWindowSender(event)
    return onlineProviderRegistry.getAuthState(provider)
  })
  ipcMain.handle('online-provider:login:open', async (event, provider) => {
    requireMainWindowSender(event)
    return onlineProviderRegistry.openLogin(provider)
  })
  ipcMain.handle('online-provider:logout', async (event, provider) => {
    requireMainWindowSender(event)
    return onlineProviderRegistry.logout(provider)
  })

  ipcMain.handle('bilibili:auth:get', async (event) => {
    requireMainWindowSender(event)
    return bilibiliSessionManager.getAuthState()
  })
  ipcMain.handle('bilibili:login:open', async (event) => {
    requireMainWindowSender(event)
    return bilibiliSessionManager.openLogin()
  })
  ipcMain.handle('bilibili:logout', async (event) => {
    requireMainWindowSender(event)
    return bilibiliSessionManager.logout()
  })
  ipcMain.handle('bilibili:search', async (event, request) => {
    requireMainWindowSender(event)
    return bilibiliSessionManager.searchVideos(request)
  })
  ipcMain.handle('bilibili:video:open', async (event, request) => {
    requireMainWindowSender(event)
    return bilibiliSessionManager.openVideo(request)
  })
  ipcMain.handle('bilibili:embedded:capture', async (event, request) => {
    requireMainWindowSender(event)
    return captureBilibiliEmbeddedFrame(event.sender, request)
  })
  ipcMain.handle('tencent:search', async (event, request) => {
    requireMainWindowSender(event)
    return tencentVideoSessionManager.searchVideos(request)
  })
  ipcMain.handle('tencent:auth:get', async (event) => {
    requireMainWindowSender(event)
    return tencentVideoSessionManager.getAuthState()
  })
  ipcMain.handle('tencent:login:open', async (event) => {
    requireMainWindowSender(event)
    return tencentVideoSessionManager.openLogin()
  })
  ipcMain.handle('tencent:logout', async (event) => {
    requireMainWindowSender(event)
    return tencentVideoSessionManager.logout()
  })
  ipcMain.handle('tencent:embedded:capture', async (event, request) => {
    requireMainWindowSender(event)
    return captureTencentEmbeddedFrame(event.sender, request)
  })
  ipcMain.handle('xinpianchang:embedded:capture', async (event, request) => {
    requireMainWindowSender(event)
    return captureXinpianchangEmbeddedFrame(event.sender, request)
  })
  ipcMain.handle('youku:embedded:capture', async (event, request) => {
    requireMainWindowSender(event)
    return captureYoukuEmbeddedFrame(event.sender, request)
  })

  ipcMain.on(EXTERNAL_VIDEO_RENDERER_READY_CHANNEL, (event) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents
    ) {
      return
    }
    const webContents = event.sender
    const sendToReadyRenderer = (descriptors) => {
      if (webContents.isDestroyed()) throw new Error('Renderer is unavailable')
      webContents.send(EXTERNAL_VIDEO_FILES_CHANNEL, descriptors)
    }
    const clearReadyRenderer = () => {
      externalVideoOpenBroker.clearConsumer(sendToReadyRenderer)
      webContents.removeListener('did-start-loading', clearReadyRenderer)
      webContents.removeListener('destroyed', clearReadyRenderer)
    }
    externalVideoOpenBroker.setConsumer(sendToReadyRenderer)
    // A reload keeps WebContents alive, while its renderer listener disappears.
    // Disconnect before navigation so queued files survive until the next ready
    // handshake instead of being acknowledged into an unlistened renderer.
    webContents.once('did-start-loading', clearReadyRenderer)
    webContents.once('destroyed', clearReadyRenderer)
  })

  ipcMain.handle('project-folder:select', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择项目文件夹',
      properties: ['openDirectory', 'createDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) return null

    return result.filePaths[0]
  })

  ipcMain.handle('project-folder:open', async (_event, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string') return false

    const error = await shell.openPath(folderPath)
    return error === ''
  })

  ipcMain.handle('project-file:select', async (_event, title = '选择文件') => {
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openFile'],
      filters: [
        { name: '常用文件', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'numbers'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) return null

    return result.filePaths[0]
  })

  ipcMain.handle('project-file:open', async (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return false

    const error = await shell.openPath(filePath)
    return error === ''
  })

  ipcMain.handle('project-file:reveal', async (_event, filePath) => {
    if (typeof filePath !== 'string' || filePath.trim() === '') return false

    const normalizedFilePath = filePath.trim()
    if (!fs.existsSync(normalizedFilePath)) return false

    shell.showItemInFolder(normalizedFilePath)
    return true
  })

  ipcMain.handle('media-file:inspect', async (_event, filePath) => {
    return inspectMediaFile(filePath)
  })

  ipcMain.handle('media-thumbnail:create', async (_event, request) => {
    return mediaPipeline.createMediaThumbnail(request)
  })

  ipcMain.handle('media-directory:select', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog({
      title:
        typeof options?.title === 'string' && options.title.trim() !== ''
          ? options.title.trim().slice(0, 160)
          : '选择文件夹',
      defaultPath:
        typeof options?.defaultPath === 'string' &&
        path.isAbsolute(options.defaultPath)
          ? options.defaultPath
          : undefined,
      buttonLabel:
        typeof options?.buttonLabel === 'string' &&
        options.buttonLabel.trim() !== ''
          ? options.buttonLabel.trim().slice(0, 80)
          : undefined,
      properties: ['openDirectory', 'createDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('media-save-path:select', async (_event, options = {}) => {
    const result = await dialog.showSaveDialog({
      title:
        typeof options?.title === 'string' && options.title.trim() !== ''
          ? options.title.trim().slice(0, 160)
          : '保存文件',
      defaultPath:
        typeof options?.defaultPath === 'string' &&
        options.defaultPath.trim() !== ''
          ? options.defaultPath.trim()
          : undefined,
      buttonLabel:
        typeof options?.buttonLabel === 'string' &&
        options.buttonLabel.trim() !== ''
          ? options.buttonLabel.trim().slice(0, 80)
          : undefined,
      filters: normalizeDialogFilters(options?.filters),
      showsTagField: false,
    })

    return result.canceled ? null : result.filePath ?? null
  })

  ipcMain.handle('media-index:build', async (_event, request) => {
    return mediaPipeline.buildVisualIndex(request)
  })

  ipcMain.handle('frame-intelligence:analyze-quality', async (_event, request) => {
    return frameIntelligenceEngine.analyzeFrames(request)
  })

  ipcMain.handle('media-preview:ensure', async (_event, request) => {
    return mediaPipeline.ensureMediaPreview(request)
  })

  ipcMain.handle('media-operation:cancel', async (_event, request) => {
    return mediaPipeline.cancelOperation(request)
  })

  ipcMain.handle('media-still:export', async (_event, request) => {
    return mediaPipeline.exportStill(request)
  })

  ipcMain.handle('media-clip:export', async (_event, request) => {
    return mediaPipeline.exportClip(request)
  })

  ipcMain.handle('particle-asset:import', async (_event, request) => {
    return particleAssetManager.importParticleAsset(request)
  })

  ipcMain.handle('particle-asset:remove', async (_event, managedPath) => {
    return particleAssetManager.removeParticleAsset(managedPath)
  })

  ipcMain.handle('particle-asset:validate', async (_event, request) => {
    return particleAssetManager.validateParticleAsset(request)
  })

  ipcMain.handle('particle-asset:prune', async (_event, referencedPaths) => {
    return particleAssetManager.pruneParticleAssets(referencedPaths)
  })

  ipcMain.handle('visual-asset:import', async (_event, request) => {
    return visualAssetStore.importAsset(request)
  })

  ipcMain.handle('visual-asset:remove', async (_event, managedPath) => {
    return visualAssetStore.removeAsset(managedPath)
  })

  ipcMain.handle('visual-asset:validate', async (_event, request) => {
    return visualAssetStore.validateManagedPath(request)
  })

  ipcMain.handle('visual-asset:prune', async (_event, referencedPaths) => {
    return visualAssetStore.pruneAssets(referencedPaths)
  })

  ipcMain.handle('model-asset:import', async (_event, request) => {
    return modelAssetManager.importModelAsset(request)
  })

  ipcMain.handle('model-asset:import-begin', async (_event, request) => {
    return modelAssetManager.beginModelAssetImport(request)
  })

  ipcMain.handle('model-asset:import-chunk', async (_event, request) => {
    return modelAssetManager.appendModelAssetImport(request)
  })

  ipcMain.handle('model-asset:import-complete', async (_event, request) => {
    return modelAssetManager.completeModelAssetImport(request)
  })

  ipcMain.handle('model-asset:import-abort', async (_event, request) => {
    return modelAssetManager.abortModelAssetImport(request)
  })

  ipcMain.handle('model-asset:remove', async (_event, managedPath) => {
    return modelAssetManager.removeModelAsset(managedPath)
  })

  ipcMain.handle('model-render:save', async (_event, request) => {
    return modelAssetManager.saveModelRender(request)
  })

  ipcMain.handle('app-data:load', async () => {
    return readAppData()
  })

  ipcMain.handle('app-data:save', async (_event, data) => {
    return queueWriteAppData(data)
  })

  ipcMain.on('app-data:save-sync', (event, data) => {
    try {
      event.returnValue = writeAppDataSync(data)
    } catch (error) {
      console.warn('[Aurora persistence] Final synchronous save failed', error)
      event.returnValue = false
    }
  })

  ipcMain.handle('clipboard:write-text', async (_event, value) => {
    if (typeof value !== 'string') return false
    clipboard.writeText(value)
    return true
  })

  ipcMain.handle(
    'ai:provider-profiles:get',
    aiCredentialIpcHandler(() => aiCredentialsStore.getProfiles()),
  )
  ipcMain.handle(
    'ai:provider-profiles:select',
    aiCredentialIpcHandler((profileId) =>
      aiCredentialsStore.selectProfile(profileId),
    ),
  )
  ipcMain.handle(
    'ai:provider-profiles:save',
    aiCredentialIpcHandler((request) => aiCredentialsStore.saveProfile(request)),
  )
  ipcMain.handle(
    'ai:provider-profiles:delete',
    aiCredentialIpcHandler((profileId) =>
      aiCredentialsStore.deleteProfile(profileId),
    ),
  )
  ipcMain.handle(
    'ai:provider-profiles:test',
    aiProviderTestIpcHandler((request) =>
      aiVisualSearchService.testProfile(request),
    ),
  )
  ipcMain.handle(
    'ai:service-profiles:get',
    aiCredentialIpcHandler(() => aiCredentialsStore.getServiceProfiles()),
  )
  ipcMain.handle(
    'ai:service-profiles:select',
    aiCredentialIpcHandler((request) =>
      aiCredentialsStore.selectServiceProfile(
        request?.kind,
        request?.profileId,
      ),
    ),
  )
  ipcMain.handle(
    'ai:service-profiles:save',
    aiCredentialIpcHandler((request) =>
      aiCredentialsStore.saveServiceProfile(request?.kind, request?.input),
    ),
  )
  ipcMain.handle(
    'ai:service-profiles:delete',
    aiCredentialIpcHandler((request) =>
      aiCredentialsStore.deleteServiceProfile(
        request?.kind,
        request?.profileId,
      ),
    ),
  )
  ipcMain.handle(
    'ai:service-profiles:test',
    aiProviderTestIpcHandler((request) => {
      if (request?.kind === 'vision') {
        return aiVisualSearchService.testVisionProfile(request?.input)
      }
      if (request?.kind === 'embedding') {
        return aiVisualSearchService.testEmbeddingProfile(request?.input)
      }
      throw new AiCredentialError(
        'AI_PROVIDER_INVALID_INPUT',
        '模型服务类型无效。',
      )
    }),
  )
  ipcMain.handle('ai:local-models:detect', async () => ({
    ok: true,
    data: { services: await aiLocalModelDetector.detect() },
  }))
  ipcMain.handle(
    'ai:visual-search:search',
    aiVisualSearchIpcHandler((request) => aiVisualSearchService.search(request)),
  )
  ipcMain.handle(
    'ai:visual-search:analyze-frames',
    aiVisualSearchIpcHandler((request) =>
      aiVisualSearchService.analyzeFrames(request),
    ),
  )

  ipcMain.handle(
    'emby:connection:get',
    embyIpcHandler(() => embyManager.getEmbyConnection()),
  )
  ipcMain.handle(
    'emby:connection:test',
    embyIpcHandler((request) => embyManager.testEmbyConnection(request)),
  )
  ipcMain.handle(
    'emby:connection:disconnect',
    embyIpcHandler(() => embyManager.disconnectEmby()),
  )
  ipcMain.handle(
    'emby:search',
    embyIpcHandler((request) => embyManager.searchEmby(request)),
  )
  ipcMain.handle(
    'emby:item:get',
    embyIpcHandler((request) => embyManager.getEmbyItem(request)),
  )
  ipcMain.handle(
    'emby:image:get',
    embyIpcHandler((request) => embyManager.getEmbyImage(request)),
  )
  ipcMain.handle(
    'emby:playback-info:get',
    embyIpcHandler((request) => embyManager.getEmbyPlaybackInfo(request)),
  )

  windowCreationReady = true
  void ensureMainWindow()
    .then(() => {
      appUpdateManager?.scheduleAutomaticCheck()
    })
    .catch((error) => {
      console.warn('[Aurora updater] Unable to schedule automatic check', error)
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void ensureMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  mediaPipeline?.cancelAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  mediaPipeline?.cancelAll()
  appUpdateManager?.dispose()
  appUpdateManager = null
  onlineProviderRegistry?.dispose()
  onlineProviderRegistry = null
  bilibiliSessionManager = null
  tencentVideoSessionManager = null
  xinpianchangSessionManager = null
  youkuSessionManager = null
  douyinSessionManager = null
})
