const DEFAULT_AUTOMATIC_CHECK_DELAY_MS = 6_000
const INSTALL_RESTART_DELAY_MS = 650

const UPDATE_STATUSES = new Set([
  'idle',
  'unsupported',
  'checking',
  'up-to-date',
  'available',
  'downloading',
  'downloaded',
  'installing',
  'error',
])

function clampProgress(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const codePoint = Number(code)
      return Number.isSafeInteger(codePoint)
        ? String.fromCodePoint(codePoint)
        : ''
    })
}

function htmlToPlainText(value) {
  if (typeof value !== 'string') return ''
  const withLineBreaks = value
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li(?:\s[^>]*)?>/gi, '• ')
  return decodeHtmlEntities(withLineBreaks.replace(/<[^>]*>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

function normalizeReleaseNotes(updateInfo) {
  const source = updateInfo?.releaseNotes
  const chunks = Array.isArray(source)
    ? source.map((entry) =>
        typeof entry === 'string' ? entry : entry?.note,
      )
    : [source]
  const lines = chunks
    .flatMap((chunk) => htmlToPlainText(chunk).split('\n'))
    .map((line) => line.trim())
    .filter(Boolean)
  const unique = []
  const seen = new Set()
  for (const line of lines) {
    const shortened = line.slice(0, 240)
    if (seen.has(shortened)) continue
    seen.add(shortened)
    unique.push(shortened)
    if (unique.length >= 12) break
  }
  return unique
}

function createInitialState({ currentVersion, supported }) {
  return {
    currentVersion,
    supported,
    status: supported ? 'idle' : 'unsupported',
    latestVersion: null,
    releaseName: null,
    releaseNotes: [],
    releaseDate: null,
    progress: null,
    checkedAt: null,
    source: null,
    error: null,
  }
}

function cloneState(state) {
  return {
    ...state,
    releaseNotes: [...state.releaseNotes],
  }
}

function normalizeFeedConfigurations(feedConfiguration, feedConfigurations) {
  if (Array.isArray(feedConfigurations) && feedConfigurations.length > 0) {
    return feedConfigurations.filter(Boolean)
  }
  return feedConfiguration ? [feedConfiguration] : []
}

function createAppUpdateManager({
  updater,
  currentVersion,
  packaged,
  platform,
  feedConfiguration = null,
  feedConfigurations = null,
  onStateChange = () => {},
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  automaticCheckDelayMs = DEFAULT_AUTOMATIC_CHECK_DELAY_MS,
  logger = console,
}) {
  const supported = Boolean(
    packaged && updater && (platform === 'darwin' || platform === 'win32'),
  )
  let state = createInitialState({ currentVersion, supported })
  let checkPromise = null
  let automaticCheckTimer = null
  let automaticCheckScheduled = false
  let installRequested = false
  let disposed = false
  let activeFeedIndex = -1
  let suppressUpdaterErrors = 0
  let deferredUpdaterError = null
  const listeners = []
  const configuredFeeds = normalizeFeedConfigurations(
    feedConfiguration,
    feedConfigurations,
  )

  const emit = (patch) => {
    if (disposed) return cloneState(state)
    const status = UPDATE_STATUSES.has(patch.status)
      ? patch.status
      : state.status
    state = {
      ...state,
      ...patch,
      status,
      releaseNotes: Array.isArray(patch.releaseNotes)
        ? [...patch.releaseNotes]
        : state.releaseNotes,
    }
    const snapshot = cloneState(state)
    onStateChange(snapshot)
    return snapshot
  }

  const listen = (eventName, listener) => {
    updater.on(eventName, listener)
    listeners.push([eventName, listener])
  }

  const selectFeed = (index) => {
    const configuration = configuredFeeds[index]
    if (!configuration || typeof updater.setFeedURL !== 'function') return
    if (activeFeedIndex === index) return
    const { requestHeaders = null, ...providerConfiguration } = configuration
    updater.requestHeaders = requestHeaders
    updater.setFeedURL(providerConfiguration)
    activeFeedIndex = index
  }

  const runUpdaterAttempt = async (operation) => {
    deferredUpdaterError = null
    const result = await operation()
    if (deferredUpdaterError) throw deferredUpdaterError
    return result
  }

  const runWithDeferredUpdaterErrors = async (operation) => {
    suppressUpdaterErrors += 1
    try {
      return await operation()
    } finally {
      suppressUpdaterErrors -= 1
      deferredUpdaterError = null
    }
  }

  const feedAttemptCount = () => Math.max(1, configuredFeeds.length)

  const checkConfiguredFeeds = async () =>
    runWithDeferredUpdaterErrors(async () => {
      let latestError = null
      for (let index = 0; index < feedAttemptCount(); index += 1) {
        selectFeed(index)
        try {
          return await runUpdaterAttempt(() => updater.checkForUpdates())
        } catch (error) {
          latestError = error
          if (index + 1 < feedAttemptCount()) {
            logger?.warn?.('[Aurora updater] primary update source unavailable', error)
          }
        }
      }
      throw latestError ?? new Error('No update source is available')
    })

  const fail = (kind, error) => {
    logger?.warn?.(`[Aurora updater] ${kind}`, error)
    const message =
      kind === 'download'
        ? '更新下载失败，请稍后重试。'
        : kind === 'install'
          ? '更新安装失败，请稍后重试。'
          : '暂时无法检查更新，请稍后重试。'
    return emit({ status: 'error', progress: null, error: message })
  }

  const installDownloadedUpdate = () => {
    if (!supported || state.status !== 'downloaded') return false
    emit({ status: 'installing', progress: 100, error: null })
    try {
      updater.quitAndInstall(false, true)
      return true
    } catch (error) {
      fail('install', error)
      return false
    }
  }

  if (supported) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    selectFeed(0)

    listen('checking-for-update', () => {
      emit({ status: 'checking', progress: null, error: null })
    })
    listen('update-available', (info) => {
      emit({
        status: 'available',
        latestVersion:
          typeof info?.version === 'string' ? info.version : null,
        releaseName:
          typeof info?.releaseName === 'string' ? info.releaseName : null,
        releaseNotes: normalizeReleaseNotes(info),
        releaseDate:
          typeof info?.releaseDate === 'string' ? info.releaseDate : null,
        checkedAt: new Date().toISOString(),
        progress: null,
        error: null,
      })
    })
    listen('update-not-available', () => {
      emit({
        status: 'up-to-date',
        latestVersion: null,
        releaseName: null,
        releaseNotes: [],
        releaseDate: null,
        checkedAt: new Date().toISOString(),
        progress: null,
        error: null,
      })
    })
    listen('download-progress', (progress) => {
      emit({
        status: 'downloading',
        progress: clampProgress(progress?.percent) ?? state.progress ?? 0,
        error: null,
      })
    })
    listen('update-downloaded', (info) => {
      const downloadedReleaseNotes = normalizeReleaseNotes(info)
      emit({
        status: 'downloaded',
        latestVersion:
          typeof info?.version === 'string'
            ? info.version
            : state.latestVersion,
        releaseNotes:
          downloadedReleaseNotes.length > 0
            ? downloadedReleaseNotes
            : state.releaseNotes,
        progress: 100,
        error: null,
      })
      if (installRequested) {
        schedule(installDownloadedUpdate, INSTALL_RESTART_DELAY_MS)
      }
    })
    listen('error', (error) => {
      if (suppressUpdaterErrors > 0) {
        deferredUpdaterError = error
        return
      }
      const kind =
        state.status === 'installing'
          ? 'install'
          : state.status === 'downloading' || installRequested
            ? 'download'
            : 'check'
      fail(kind, error)
    })
  }

  const checkForUpdates = ({ source = 'manual' } = {}) => {
    if (!supported || disposed) return Promise.resolve(cloneState(state))
    if (checkPromise) return checkPromise
    if (state.status === 'downloading' || state.status === 'installing') {
      return Promise.resolve(cloneState(state))
    }
    installRequested = false
    emit({ status: 'checking', source, progress: null, error: null })
    checkPromise = Promise.resolve()
      .then(() => checkConfiguredFeeds())
      .then(() => cloneState(state))
      .catch((error) => fail('check', error))
      .finally(() => {
        checkPromise = null
      })
    return checkPromise
  }

  const downloadAndInstall = async () => {
    if (!supported || disposed) return cloneState(state)
    if (state.status === 'downloaded') {
      installDownloadedUpdate()
      return cloneState(state)
    }
    if (
      state.status !== 'available' &&
      !(state.status === 'error' && state.latestVersion)
    ) {
      return cloneState(state)
    }
    installRequested = true
    emit({ status: 'downloading', source: 'install', progress: 0, error: null })
    try {
      await runWithDeferredUpdaterErrors(async () => {
        let latestError = null
        const firstFeedIndex = activeFeedIndex < 0
          ? 0
          : Math.min(activeFeedIndex, feedAttemptCount() - 1)
        for (
          let index = firstFeedIndex;
          index < feedAttemptCount();
          index += 1
        ) {
          if (index !== firstFeedIndex) {
            selectFeed(index)
            await runUpdaterAttempt(() => updater.checkForUpdates())
            emit({
              status: 'downloading',
              source: 'install',
              progress: 0,
              error: null,
            })
          }
          try {
            await runUpdaterAttempt(() => updater.downloadUpdate())
            return
          } catch (error) {
            latestError = error
            if (index + 1 < feedAttemptCount()) {
              logger?.warn?.(
                '[Aurora updater] primary download source unavailable',
                error,
              )
            }
          }
        }
        throw latestError ?? new Error('No update download source is available')
      })
    } catch (error) {
      fail('download', error)
    }
    return cloneState(state)
  }

  const scheduleAutomaticCheck = () => {
    if (!supported || disposed || automaticCheckScheduled) return false
    automaticCheckScheduled = true
    automaticCheckTimer = schedule(() => {
      automaticCheckTimer = null
      void checkForUpdates({ source: 'automatic' })
    }, automaticCheckDelayMs)
    automaticCheckTimer?.unref?.()
    return true
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    if (automaticCheckTimer !== null) {
      cancelSchedule(automaticCheckTimer)
      automaticCheckTimer = null
    }
    listeners.forEach(([eventName, listener]) => {
      updater?.removeListener?.(eventName, listener)
    })
    listeners.length = 0
  }

  return {
    getState: () => cloneState(state),
    checkForUpdates,
    downloadAndInstall,
    installDownloadedUpdate,
    scheduleAutomaticCheck,
    dispose,
  }
}

module.exports = {
  clampProgress,
  createAppUpdateManager,
  htmlToPlainText,
  normalizeReleaseNotes,
}
