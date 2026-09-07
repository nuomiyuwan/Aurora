const { BrowserWindow, ipcMain } = require('electron')
const { createHash, randomUUID } = require('crypto')
const path = require('path')
const { inspectMediaFile } = require('./mediaProbe.cjs')
const { encodeMediaPath } = require('./mediaPipeline.cjs')

function createStandalonePlayer({ isDev, mediaPipeline, readAppData }) {
  let playerWindow = null
  let current = null
  let sequence = 0

  const isPlayerSender = (event) =>
    playerWindow &&
    !playerWindow.isDestroyed() &&
    event.sender === playerWindow.webContents &&
    event.senderFrame === event.sender.mainFrame

  function publish(entry, changes = {}) {
    if (current !== entry) return
    Object.assign(entry.state, changes)
    if (playerWindow && !playerWindow.isDestroyed()) {
      playerWindow.webContents.send('standalone-player:state', entry.state)
    }
  }

  function ensureWindow() {
    if (playerWindow && !playerWindow.isDestroyed()) {
      if (playerWindow.isMinimized()) playerWindow.restore()
      playerWindow.show()
      playerWindow.focus()
      return playerWindow
    }

    const windowInstance = new BrowserWindow({
      width: 960,
      height: 540,
      minWidth: 360,
      minHeight: 240,
      useContentSize: true,
      show: false,
      title: 'Aurora 播放器',
      backgroundColor: '#080a0e',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
        preload: path.join(__dirname, 'standalonePlayerPreload.cjs'),
      },
    })
    playerWindow = windowInstance
    windowInstance.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    windowInstance.webContents.on('will-navigate', (event) => event.preventDefault())
    windowInstance.once('ready-to-show', () => {
      windowInstance.show()
      windowInstance.focus()
    })
    windowInstance.once('closed', () => {
      if (playerWindow !== windowInstance) return
      playerWindow = null
      current = null
    })
    const loading = isDev
      ? windowInstance.loadURL('http://127.0.0.1:5174/player.html')
      : windowInstance.loadFile(path.join(__dirname, '../dist/player.html'))
    void loading.catch((error) => {
      console.warn('[Aurora player] Unable to load player window', error)
    })
    return windowInstance
  }

  function openFiles(descriptors) {
    const descriptor = descriptors.at(-1)
    if (!descriptor) return
    const entry = {
      descriptor,
      metadata: null,
      previewPromise: null,
      operationId: null,
      state: {
        id: ++sequence,
        name: descriptor.name,
        status: 'loading',
        sourceUrl: null,
        codec: '',
        durationSeconds: null,
        fps: null,
        usesPreviewProxy: false,
        progress: null,
        message: '正在打开视频…',
      },
    }
    current = entry
    ensureWindow().setTitle(`${descriptor.name} — Aurora 播放器`)
    publish(entry)
    void inspectMediaFile(descriptor.path)
      .then((metadata) => {
        if (current !== entry) return
        if (!metadata.width || !metadata.height || !metadata.durationSeconds) {
          throw new Error('文件中没有可播放的视频画面')
        }
        entry.metadata = metadata
        publish(entry, {
          status: 'ready',
          sourceUrl: encodeMediaPath(metadata.filePath),
          codec: metadata.codec ?? '',
          durationSeconds: metadata.durationSeconds,
          fps: metadata.fps,
          message: '',
        })
      })
      .catch((error) => {
        publish(entry, { status: 'error', message: `无法打开视频：${error.message}` })
      })
  }

  async function preparePreview(entry) {
    if (entry.previewPromise) return entry.previewPromise
    publish(entry, { status: 'preparing', progress: null, message: '正在准备兼容播放…' })
    entry.previewPromise = (async () => {
      try {
        const appData = await readAppData().catch(() => null)
        if (current !== entry) return
        const metadata = entry.metadata
        const assets = appData?.library?.mediaAssets
        const fingerprint = [
          'local', metadata.filePath, metadata.sizeBytes, metadata.modifiedAt,
        ].join(':')
        const existingAsset = Array.isArray(assets)
          ? assets.find((asset) =>
              asset?.sourceFingerprint === fingerprint ||
              asset?.sourcePath === metadata.filePath ||
              asset?.sourcePath === entry.descriptor.path,
            )
          : null
        const assetId = existingAsset?.id ?? `asset:external-player:${
          createHash('sha256').update(metadata.filePath).digest('hex').slice(0, 32)
        }`
        entry.operationId = `player-${randomUUID()}`
        const result = await mediaPipeline.ensureMediaPreview({
          assetId,
          sourcePath: metadata.filePath,
          operationId: entry.operationId,
          forceProxy: true,
          profile: 'playback',
        })
        publish(entry, {
          status: 'ready',
          sourceUrl: encodeMediaPath(result.playbackPath),
          usesPreviewProxy: result.usesPreviewProxy,
          progress: null,
          message: '',
        })
      } catch (error) {
        publish(entry, { status: 'error', message: `无法准备兼容播放：${error.message}` })
      }
    })()
    return entry.previewPromise
  }

  ipcMain.on('standalone-player:ready', (event) => {
    if (isPlayerSender(event) && current) publish(current)
  })
  ipcMain.handle('standalone-player:preview', async (event, id) => {
    if (!isPlayerSender(event)) throw new Error('Unauthorized player renderer')
    const entry = current
    if (!entry || entry.state.id !== id || !entry.metadata) return
    await preparePreview(entry)
  })
  ipcMain.on('standalone-player:retry', (event, id) => {
    if (isPlayerSender(event) && current?.state.id === id) {
      openFiles([current.descriptor])
    }
  })

  return {
    openFiles,
    onProgress(payload) {
      if (!current || current.operationId !== payload.operationId) return
      if (current.state.status !== 'preparing') return
      publish(current, { progress: payload.progress })
    },
  }
}

module.exports = { createStandalonePlayer }
