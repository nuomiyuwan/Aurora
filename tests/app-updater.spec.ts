import { expect, test } from '@playwright/test'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type UpdateStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

interface UpdateState {
  currentVersion: string
  supported: boolean
  installMode: 'automatic' | 'manual-dmg'
  status: UpdateStatus
  latestVersion: string | null
  releaseName: string | null
  releaseNotes: string[]
  releaseDate: string | null
  progress: number | null
  checkedAt: string | null
  source: string | null
  error: string | null
}

interface UpdateManager {
  getState(): UpdateState
  checkForUpdates(options?: { source?: string }): Promise<UpdateState>
  downloadAndInstall(): Promise<UpdateState>
  installDownloadedUpdate(): boolean
  scheduleAutomaticCheck(): boolean
  dispose(): void
}

interface UpdateManagerOptions {
  updater: FakeUpdater
  currentVersion: string
  packaged: boolean
  platform: string
  feedConfiguration?: Record<string, unknown>
  feedConfigurations?: Array<Record<string, unknown>>
  onStateChange?: (state: UpdateState) => void
  schedule?: (
    callback: () => unknown,
    delay: number,
  ) => { unref(): void }
  cancelSchedule?: (timer: { unref(): void }) => void
  automaticCheckDelayMs?: number
  macDmgInstaller?: {
    downloadAndOpen(options: {
      updateInfo: unknown
      feedConfiguration: Record<string, unknown>
      onProgress(progress: number): void
      onReadyToOpen(): void
    }): Promise<unknown>
  } | null
  logger?: { warn(...args: unknown[]): void }
}

const { createAppUpdateManager, normalizeReleaseNotes } = require(
  '../electron/appUpdater.cjs',
) as {
  createAppUpdateManager(options: UpdateManagerOptions): UpdateManager
  normalizeReleaseNotes(info: { releaseNotes?: unknown }): string[]
}

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  requestHeaders: Record<string, string> | null = null
  checkCalls = 0
  downloadCalls = 0
  quitCalls: Array<[boolean, boolean]> = []
  checkError: Error | null = null
  downloadError: Error | null = null
  checkErrors: Array<Error | null> = []
  downloadErrors: Array<Error | null> = []
  emitErrorsWithRejections = false
  installError: Error | null = null
  feedConfigurations: unknown[] = []

  setFeedURL(configuration: unknown) {
    this.feedConfigurations.push(configuration)
  }

  async checkForUpdates() {
    this.checkCalls += 1
    const error = this.checkErrors.length > 0
      ? this.checkErrors.shift()
      : this.checkError
    if (error) {
      if (this.emitErrorsWithRejections) this.emit('error', error)
      throw error
    }
    return null
  }

  async downloadUpdate() {
    this.downloadCalls += 1
    const error = this.downloadErrors.length > 0
      ? this.downloadErrors.shift()
      : this.downloadError
    if (error) {
      if (this.emitErrorsWithRejections) this.emit('error', error)
      throw error
    }
    return []
  }

  quitAndInstall(silent: boolean, forceRunAfter: boolean) {
    if (this.installError) throw this.installError
    this.quitCalls.push([silent, forceRunAfter])
  }
}

interface ScheduledTask {
  callback: () => unknown
  delay: number
  unrefCount: number
  timer: { unref(): void }
}

function createScheduler() {
  const tasks: ScheduledTask[] = []
  const canceled: ScheduledTask['timer'][] = []
  const schedule = (callback: () => unknown, delay: number) => {
    const task = {} as ScheduledTask
    const timer = {
      unref() {
        task.unrefCount += 1
      },
    }
    Object.assign(task, { callback, delay, unrefCount: 0, timer })
    tasks.push(task)
    return timer
  }
  return {
    tasks,
    canceled,
    schedule,
    cancelSchedule(timer: ScheduledTask['timer']) {
      canceled.push(timer)
    },
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

function createSupportedManager(
  updater: FakeUpdater,
  overrides: Partial<UpdateManagerOptions> = {},
) {
  return createAppUpdateManager({
    updater,
    currentVersion: '1.0.1',
    packaged: true,
    platform: 'win32',
    feedConfiguration: {
      provider: 'github',
      owner: 'nuomiyuwan',
      repo: 'Aurora',
    },
    ...overrides,
  })
}

test('development and unsupported platforms never check or schedule updates', async () => {
  for (const options of [
    { packaged: false, platform: 'darwin' },
    { packaged: true, platform: 'linux' },
  ]) {
    const updater = new FakeUpdater()
    let scheduled = 0
    const manager = createAppUpdateManager({
      updater,
      currentVersion: '1.0.1',
      ...options,
      schedule: () => {
        scheduled += 1
        return { unref() {} }
      },
    })

    expect(manager.getState()).toMatchObject({
      currentVersion: '1.0.1',
      supported: false,
      status: 'unsupported',
    })
    expect(manager.scheduleAutomaticCheck()).toBe(false)
    expect((await manager.checkForUpdates()).status).toBe('unsupported')
    expect((await manager.downloadAndInstall()).status).toBe('unsupported')
    expect(updater.checkCalls).toBe(0)
    expect(updater.downloadCalls).toBe(0)
    expect(scheduled).toBe(0)
    manager.dispose()
  }
})

test('automatic startup check is scheduled once and keeps its source', async () => {
  const updater = new FakeUpdater()
  const scheduler = createScheduler()
  const states: UpdateState[] = []
  const manager = createSupportedManager(updater, {
    automaticCheckDelayMs: 1_234,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancelSchedule,
    onStateChange: (state) => states.push(state),
  })

  expect(manager.scheduleAutomaticCheck()).toBe(true)
  expect(manager.scheduleAutomaticCheck()).toBe(false)
  expect(scheduler.tasks).toHaveLength(1)
  expect(scheduler.tasks[0]).toMatchObject({ delay: 1_234, unrefCount: 1 })

  scheduler.tasks[0].callback()
  await flushPromises()

  expect(updater.checkCalls).toBe(1)
  expect(manager.getState()).toMatchObject({
    status: 'checking',
    source: 'automatic',
  })
  expect(states.filter((state) => state.source === 'automatic')).toHaveLength(1)
  expect(manager.scheduleAutomaticCheck()).toBe(false)
  manager.dispose()
})

test('available update exposes deduplicated plain-text release notes', async () => {
  const updater = new FakeUpdater()
  const manager = createSupportedManager(updater)

  await manager.checkForUpdates({ source: 'manual' })
  updater.emit('update-available', {
    version: '1.1.0',
    releaseName: 'Aurora 1.1',
    releaseDate: '2026-08-09T08:00:00.000Z',
    releaseNotes: [
      '<h2>新增</h2><ul><li>自动检查更新</li><li>修复 &amp; 优化</li></ul>',
      { note: '<p>自动检查更新</p><p>更稳定</p>' },
    ],
  })

  expect(manager.getState()).toMatchObject({
    status: 'available',
    source: 'manual',
    latestVersion: '1.1.0',
    releaseName: 'Aurora 1.1',
    releaseDate: '2026-08-09T08:00:00.000Z',
    releaseNotes: ['新增', '• 自动检查更新', '• 修复 & 优化', '自动检查更新', '更稳定'],
    error: null,
  })
  expect(manager.getState().checkedAt).not.toBeNull()

  const tooManyNotes = Array.from(
    { length: 16 },
    (_, index) => `<p>第 ${index + 1} 项</p>`,
  )
  expect(normalizeReleaseNotes({ releaseNotes: tooManyNotes })).toHaveLength(12)
  manager.dispose()
})

test('GitCode check failures fall back to GitHub without exposing a transient error', async () => {
  const updater = new FakeUpdater()
  updater.checkErrors = [new Error('GitCode unavailable'), null]
  updater.emitErrorsWithRejections = true
  const manager = createSupportedManager(updater, {
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
    logger: { warn() {} },
  })

  expect(updater.requestHeaders).toEqual({ 'Private-Token': '' })
  expect(await manager.checkForUpdates({ source: 'manual' })).toMatchObject({
    status: 'checking',
    source: 'manual',
    error: null,
  })
  expect(updater.checkCalls).toBe(2)
  expect(updater.requestHeaders).toBeNull()
  expect(updater.feedConfigurations).toEqual([
    {
      provider: 'generic',
      url: 'https://gitcode.com/nuomiyuwan/Aurora-Updates/releases/download/latest/',
    },
    {
      provider: 'github',
      owner: 'nuomiyuwan',
      repo: 'Aurora',
    },
  ])
  manager.dispose()
})

test('GitCode download failures re-check and download from GitHub', async () => {
  const updater = new FakeUpdater()
  updater.downloadErrors = [new Error('GitCode CDN unavailable'), null]
  updater.emitErrorsWithRejections = true
  const manager = createSupportedManager(updater, {
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
    logger: { warn() {} },
  })
  updater.emit('update-available', { version: '1.1.0' })

  expect(await manager.downloadAndInstall()).toMatchObject({
    status: 'downloading',
    latestVersion: '1.1.0',
    error: null,
  })
  expect(updater.downloadCalls).toBe(2)
  expect(updater.checkCalls).toBe(1)
  expect(updater.requestHeaders).toBeNull()
  expect(updater.feedConfigurations.at(-1)).toEqual({
    provider: 'github',
    owner: 'nuomiyuwan',
    repo: 'Aurora',
  })
  manager.dispose()
})

test('macOS downloads and opens the trusted DMG instead of using Squirrel install', async () => {
  const updater = new FakeUpdater()
  const installerCalls: Array<{
    updateInfo: unknown
    feedConfiguration: Record<string, unknown>
  }> = []
  const macDmgInstaller = {
    async downloadAndOpen(options: {
      updateInfo: unknown
      feedConfiguration: Record<string, unknown>
      onProgress(progress: number): void
      onReadyToOpen(): void
    }) {
      installerCalls.push({
        updateInfo: options.updateInfo,
        feedConfiguration: options.feedConfiguration,
      })
      options.onProgress(46.6)
      options.onReadyToOpen()
      return { filePath: '/updates/Aurora-macOS-1.1.1-arm64.dmg' }
    },
  }
  const manager = createSupportedManager(updater, {
    platform: 'darwin',
    macDmgInstaller,
    feedConfiguration: {
      provider: 'github',
      owner: 'nuomiyuwan',
      repo: 'Aurora',
    },
  })
  const updateInfo = {
    version: '1.1.1',
    files: [{ url: 'Aurora-macOS-1.1.1-arm64.dmg' }],
  }
  updater.emit('update-available', updateInfo)

  expect(await manager.downloadAndInstall()).toMatchObject({
    installMode: 'manual-dmg',
    status: 'installing',
    source: 'install',
    progress: 100,
  })
  expect(installerCalls).toEqual([
    {
      updateInfo,
      feedConfiguration: {
        provider: 'github',
        owner: 'nuomiyuwan',
        repo: 'Aurora',
      },
    },
  ])
  expect(updater.downloadCalls).toBe(0)
  expect(updater.quitCalls).toHaveLength(0)
  manager.dispose()
})

test('download progress is clamped and downloaded update restarts Aurora automatically', async () => {
  const updater = new FakeUpdater()
  const scheduler = createScheduler()
  const manager = createSupportedManager(updater, {
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancelSchedule,
  })

  expect(updater.autoDownload).toBe(false)
  expect(updater.autoInstallOnAppQuit).toBe(false)
  expect(manager.getState().installMode).toBe('automatic')
  expect(updater.feedConfigurations).toEqual([
    {
      provider: 'github',
      owner: 'nuomiyuwan',
      repo: 'Aurora',
    },
  ])
  updater.emit('update-available', {
    version: '1.1.0',
    releaseNotes: '<p>更稳定</p>',
  })

  await manager.downloadAndInstall()
  expect(updater.downloadCalls).toBe(1)
  expect(manager.getState()).toMatchObject({
    status: 'downloading',
    source: 'install',
    progress: 0,
  })

  updater.emit('download-progress', { percent: 42.6 })
  expect(manager.getState()).toMatchObject({
    status: 'downloading',
    progress: 43,
  })
  updater.emit('download-progress', { percent: 180 })
  expect(manager.getState().progress).toBe(100)

  updater.emit('update-downloaded', { version: '1.1.0' })
  expect(manager.getState()).toMatchObject({
    status: 'downloaded',
    progress: 100,
  })
  expect(scheduler.tasks).toHaveLength(1)
  expect(scheduler.tasks[0].delay).toBe(650)

  scheduler.tasks[0].callback()
  expect(manager.getState()).toMatchObject({
    status: 'installing',
    progress: 100,
  })
  expect(updater.quitCalls).toEqual([[false, true]])
  manager.dispose()
})

test('check, download, and install failures expose safe user-facing messages', async () => {
  const warnings: unknown[][] = []
  const logger = { warn: (...args: unknown[]) => warnings.push(args) }

  const checkUpdater = new FakeUpdater()
  checkUpdater.checkError = new Error('private token leaked by provider')
  const checkManager = createSupportedManager(checkUpdater, { logger })
  expect(await checkManager.checkForUpdates()).toMatchObject({
    status: 'error',
    error: '暂时无法检查更新，请稍后重试。',
  })
  expect(checkManager.getState().error).not.toContain('private token')

  const downloadUpdater = new FakeUpdater()
  downloadUpdater.downloadError = new Error('/secret/update-cache')
  const downloadManager = createSupportedManager(downloadUpdater, { logger })
  downloadUpdater.emit('update-available', { version: '1.1.0' })
  expect(await downloadManager.downloadAndInstall()).toMatchObject({
    status: 'error',
    latestVersion: '1.1.0',
    error: '更新下载失败，请稍后重试。',
  })
  expect(downloadManager.getState().error).not.toContain('/secret')

  const installUpdater = new FakeUpdater()
  installUpdater.installError = new Error('spawn EACCES /Applications/Aurora.app')
  const installManager = createSupportedManager(installUpdater, { logger })
  installUpdater.emit('update-downloaded', { version: '1.1.0' })
  expect(installManager.installDownloadedUpdate()).toBe(false)
  expect(installManager.getState()).toMatchObject({
    status: 'error',
    error: '更新安装失败，请稍后重试。',
  })
  expect(installManager.getState().error).not.toContain('EACCES')

  expect(warnings).toHaveLength(3)
  checkManager.dispose()
  downloadManager.dispose()
  installManager.dispose()
})
