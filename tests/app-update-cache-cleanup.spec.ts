import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
  WINDOWS_UPDATER_CACHE_DIR_NAME,
  cleanupAppUpdateCache,
} = require('../electron/appUpdateCacheCleanup.cjs') as {
  WINDOWS_UPDATER_CACHE_DIR_NAME: string
  cleanupAppUpdateCache(options: {
    platform: string
    currentVersion: string
    userDataPath: string
    windowsCacheRoot?: string
  }): Promise<{ removedFiles: number; removedDirectories: number }>
}

test('macOS removes completed DMGs and partial downloads but keeps a future installer', async () => {
  const userDataPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'aurora-update-cleanup-mac-'),
  )
  try {
    const updateDirectory = path.join(userDataPath, 'updates')
    await fs.promises.mkdir(updateDirectory)
    const oldInstaller = 'Aurora-macOS-1.1.0-arm64.dmg'
    const currentInstaller = 'Aurora-macOS-1.1.1-x64.dmg'
    const futureInstaller = 'Aurora-macOS-1.1.2-arm64.dmg'
    const partialDownload = `${futureInstaller}.download`
    await Promise.all([
      fs.promises.writeFile(path.join(updateDirectory, oldInstaller), 'old'),
      fs.promises.writeFile(path.join(updateDirectory, currentInstaller), 'current'),
      fs.promises.writeFile(path.join(updateDirectory, futureInstaller), 'future'),
      fs.promises.writeFile(path.join(updateDirectory, partialDownload), 'partial'),
    ])

    const result = await cleanupAppUpdateCache({
      platform: 'darwin',
      currentVersion: '1.1.1',
      userDataPath,
    })

    expect(result.removedFiles).toBe(3)
    expect(await fs.promises.readdir(updateDirectory)).toEqual([
      futureInstaller,
    ])
  } finally {
    await fs.promises.rm(userDataPath, { recursive: true, force: true })
  }
})

test('Windows removes the pending installer after that version is installed', async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'aurora-update-cleanup-win-'),
  )
  try {
    const pendingDirectory = path.join(
      root,
      WINDOWS_UPDATER_CACHE_DIR_NAME,
      'pending',
    )
    const installerName = 'Aurora-Windows-1.1.1-x64-Setup.exe'
    await fs.promises.mkdir(pendingDirectory, { recursive: true })
    await fs.promises.writeFile(path.join(pendingDirectory, installerName), 'setup')
    await fs.promises.writeFile(
      path.join(pendingDirectory, 'update-info.json'),
      JSON.stringify({ fileName: installerName, sha512: 'fixture' }),
    )

    const result = await cleanupAppUpdateCache({
      platform: 'win32',
      currentVersion: '1.1.1',
      userDataPath: root,
      windowsCacheRoot: root,
    })

    expect(result.removedDirectories).toBe(1)
    await expect(fs.promises.stat(pendingDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('Windows keeps a future installer while removing interrupted temporary files', async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'aurora-update-cleanup-future-win-'),
  )
  try {
    const pendingDirectory = path.join(
      root,
      WINDOWS_UPDATER_CACHE_DIR_NAME,
      'pending',
    )
    const installerName = 'Aurora-Windows-1.1.2-x64-Setup.exe'
    const temporaryName = `temp-${installerName}`
    await fs.promises.mkdir(pendingDirectory, { recursive: true })
    await fs.promises.writeFile(path.join(pendingDirectory, installerName), 'setup')
    await fs.promises.writeFile(path.join(pendingDirectory, temporaryName), 'partial')
    await fs.promises.writeFile(
      path.join(pendingDirectory, 'update-info.json'),
      JSON.stringify({ fileName: installerName, sha512: 'fixture' }),
    )

    const result = await cleanupAppUpdateCache({
      platform: 'win32',
      currentVersion: '1.1.1',
      userDataPath: root,
      windowsCacheRoot: root,
    })

    expect(result.removedFiles).toBe(1)
    expect(await fs.promises.readdir(pendingDirectory)).toEqual([
      installerName,
      'update-info.json',
    ])
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
