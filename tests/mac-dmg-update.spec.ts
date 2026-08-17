import { expect, test } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type UpdateInfo = {
  version: string
  files: Array<{ url: string; size: number; sha512: string }>
}

type InstallerOptions = {
  userDataPath: string
  architecture: 'arm64' | 'x64'
  fetchImpl: (url: string) => Promise<Response>
  openPath: (filePath: string) => Promise<string>
  quitApp: () => void
  schedule: (callback: () => void, delay: number) => unknown
}

type InstallRequest = {
  updateInfo: UpdateInfo
  feedConfiguration: Record<string, unknown>
  onProgress?: (progress: number) => void
  onReadyToOpen?: (filePath: string) => void
}

const {
  MAC_DMG_QUIT_DELAY_MS,
  createMacDmgInstaller,
} = require('../electron/macDmgUpdate.cjs') as {
  MAC_DMG_QUIT_DELAY_MS: number
  createMacDmgInstaller(options: InstallerOptions): {
    downloadAndOpen(request: InstallRequest): Promise<{ filePath: string }>
  }
}

function updateInfoFor(payload: Buffer, sha512 = crypto
  .createHash('sha512')
  .update(payload)
  .digest('base64')): UpdateInfo {
  return {
    version: '1.1.1',
    files: [
      {
        url: 'Aurora-macOS-1.1.1-arm64.dmg',
        size: payload.length,
        sha512,
      },
    ],
  }
}

test('verified macOS DMG is stored, opened, then Aurora quits after the delay', async () => {
  const userDataPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'aurora-dmg-update-'),
  )
  try {
    const payload = Buffer.from('Aurora 1.1.1 DMG fixture')
    const fetchedUrls: string[] = []
    const openedPaths: string[] = []
    const progress: number[] = []
    let quitCount = 0
    let scheduledTask: { callback: () => void; delay: number } | null = null
    const installer = createMacDmgInstaller({
      userDataPath,
      architecture: 'arm64',
      fetchImpl: async (url) => {
        fetchedUrls.push(url)
        return new Response(payload, { status: 200 })
      },
      openPath: async (filePath) => {
        openedPaths.push(filePath)
        return ''
      },
      quitApp: () => {
        quitCount += 1
      },
      schedule: (callback, delay) => {
        scheduledTask = { callback, delay }
        return 1
      },
    })

    const result = await installer.downloadAndOpen({
      updateInfo: updateInfoFor(payload),
      feedConfiguration: {
        provider: 'generic',
        url: 'https://gitcode.com/nuomiyuwan/Aurora-Updates/releases/download/latest/',
      },
      onProgress: (value) => progress.push(value),
    })

    expect(fetchedUrls).toEqual([
      'https://gitcode.com/nuomiyuwan/Aurora-Updates/releases/download/latest/Aurora-macOS-1.1.1-arm64.dmg',
    ])
    expect(openedPaths).toEqual([result.filePath])
    expect(await fs.promises.readFile(result.filePath)).toEqual(payload)
    expect(progress.at(-1)).toBe(100)
    expect(quitCount).toBe(0)
    expect(scheduledTask).not.toBeNull()
    expect(scheduledTask?.delay).toBe(MAC_DMG_QUIT_DELAY_MS)
    scheduledTask?.callback()
    expect(quitCount).toBe(1)
  } finally {
    await fs.promises.rm(userDataPath, { recursive: true, force: true })
  }
})

test('invalid DMG checksum is rejected and the partial file is removed', async () => {
  const userDataPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'aurora-dmg-update-'),
  )
  try {
    const payload = Buffer.from('corrupted DMG fixture')
    let openCount = 0
    const installer = createMacDmgInstaller({
      userDataPath,
      architecture: 'arm64',
      fetchImpl: async () => new Response(payload, { status: 200 }),
      openPath: async () => {
        openCount += 1
        return ''
      },
      quitApp: () => undefined,
      schedule: () => 1,
    })
    const validHashForDifferentFile = crypto
      .createHash('sha512')
      .update('different file')
      .digest('base64')

    await expect(
      installer.downloadAndOpen({
        updateInfo: updateInfoFor(payload, validHashForDifferentFile),
        feedConfiguration: {
          provider: 'github',
          owner: 'nuomiyuwan',
          repo: 'Aurora',
        },
      }),
    ).rejects.toThrow('checksum')

    const updateDirectory = path.join(userDataPath, 'updates')
    expect(openCount).toBe(0)
    expect(await fs.promises.readdir(updateDirectory)).toEqual([])
  } finally {
    await fs.promises.rm(userDataPath, { recursive: true, force: true })
  }
})
