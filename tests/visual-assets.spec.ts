import { createRequire } from 'node:module'
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const {
  MANAGED_DIRECTORY_NAME,
  MAX_IMAGE_BYTES,
  createVisualAssetStore,
  syncCopiedFileForDurability,
} = require('../electron/visualAssets.cjs') as {
  MANAGED_DIRECTORY_NAME: string
  MAX_IMAGE_BYTES: number
  createVisualAssetStore(input: { userDataPath: string }): {
    importAsset(input: {
      sourcePath: string
      category: 'page-background' | 'project-cover'
      name?: string
    }): Promise<{
      name: string
      kind: 'image' | 'video'
      managedPath: string
      sizeBytes: number
    }>
    removeAsset(input: { managedPath: string } | string): Promise<boolean>
    pruneAssets(referencedPaths: string[]): Promise<number>
    validateManagedPath(input: {
      managedPath: string
      category?: 'page-background' | 'project-cover'
    } | string): Promise<{
      category: 'page-background' | 'project-cover'
      kind: 'image' | 'video'
      managedPath: string
      sizeBytes: number
    } | null>
  }
  syncCopiedFileForDurability(
    filePath: string,
    openFile?: (
      filePath: string,
      flags: string,
    ) => Promise<{
      sync(): Promise<void>
      close(): Promise<void>
    }>,
  ): Promise<void>
}

test('opens copied assets writable and tolerates unsupported filesystem fsync', async () => {
  const calls: string[] = []
  let closed = false

  await expect(
    syncCopiedFileForDurability('/managed/background.mp4', async (filePath, flags) => {
      calls.push(filePath, flags)
      return {
        async sync() {
          const error = new Error('operation not permitted') as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        },
        async close() {
          closed = true
        },
      }
    }),
  ).resolves.toBeUndefined()

  expect(calls).toEqual(['/managed/background.mp4', 'r+'])
  expect(closed).toBe(true)
})

test('does not hide genuine copied-asset flush failures', async () => {
  let closed = false
  const diskError = new Error('I/O error') as NodeJS.ErrnoException
  diskError.code = 'EIO'

  await expect(
    syncCopiedFileForDurability('/managed/background.mp4', async () => ({
      async sync() {
        throw diskError
      },
      async close() {
        closed = true
      },
    })),
  ).rejects.toBe(diskError)
  expect(closed).toBe(true)
})

test('copies custom page backgrounds and project covers into isolated managed storage', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-visual-assets-'))
  const userDataPath = path.join(sandbox, 'user-data')
  try {
    const store = createVisualAssetStore({ userDataPath })
    const coverSource = path.join(sandbox, '封面.PNG')
    const backgroundSource = path.join(sandbox, 'ice-valley.MOV')
    const coverBytes = Buffer.from('representative-png-bytes')
    const backgroundBytes = Buffer.from('representative-mov-bytes')
    await writeFile(coverSource, coverBytes)
    await writeFile(backgroundSource, backgroundBytes)

    const cover = await store.importAsset({
      sourcePath: coverSource,
      category: 'project-cover',
    })
    const background = await store.importAsset({
      sourcePath: backgroundSource,
      category: 'page-background',
    })

    expect(cover).toMatchObject({
      name: '封面.PNG',
      kind: 'image',
      sizeBytes: coverBytes.length,
    })
    expect(background).toMatchObject({
      name: 'ice-valley.MOV',
      kind: 'video',
      sizeBytes: backgroundBytes.length,
    })
    expect(cover.managedPath).toMatch(
      /visual-assets\/project-cover\/[0-9a-f-]+\.png$/,
    )
    expect(background.managedPath).toMatch(
      /visual-assets\/page-background\/[0-9a-f-]+\.mov$/,
    )
    expect(cover.managedPath).not.toBe(coverSource)
    expect(background.managedPath).not.toBe(backgroundSource)
    await expect(readFile(cover.managedPath)).resolves.toEqual(coverBytes)
    await expect(readFile(background.managedPath)).resolves.toEqual(
      backgroundBytes,
    )

    const coverValidation = await store.validateManagedPath({
      managedPath: cover.managedPath,
      category: 'project-cover',
    })
    expect(coverValidation).toEqual({
      category: 'project-cover',
      kind: 'image',
      managedPath: cover.managedPath,
      sizeBytes: coverBytes.length,
    })
    await expect(
      store.validateManagedPath({
        managedPath: cover.managedPath,
        category: 'page-background',
      }),
    ).resolves.toBeNull()

    const coverFiles = await readdir(
      path.join(userDataPath, MANAGED_DIRECTORY_NAME, 'project-cover'),
    )
    const backgroundFiles = await readdir(
      path.join(userDataPath, MANAGED_DIRECTORY_NAME, 'page-background'),
    )
    expect(coverFiles).toEqual([path.basename(cover.managedPath)])
    expect(backgroundFiles).toEqual([path.basename(background.managedPath)])
    expect([...coverFiles, ...backgroundFiles]).not.toContainEqual(
      expect.stringContaining('.importing'),
    )
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('uses random collision-resistant names when the same source is imported twice', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-visual-assets-'))
  try {
    const store = createVisualAssetStore({
      userDataPath: path.join(sandbox, 'user-data'),
    })
    const sourcePath = path.join(sandbox, 'cover.webp')
    await writeFile(sourcePath, Buffer.from('webp'))

    const first = await store.importAsset({
      sourcePath,
      category: 'project-cover',
    })
    const second = await store.importAsset({
      sourcePath,
      category: 'project-cover',
    })

    expect(first.managedPath).not.toBe(second.managedPath)
    await expect(readFile(first.managedPath)).resolves.toEqual(Buffer.from('webp'))
    await expect(readFile(second.managedPath)).resolves.toEqual(Buffer.from('webp'))
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('enforces category formats, absolute paths, and non-empty source files', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-visual-assets-'))
  try {
    const store = createVisualAssetStore({
      userDataPath: path.join(sandbox, 'user-data'),
    })
    const videoPath = path.join(sandbox, 'cover.mp4')
    const unsupportedPath = path.join(sandbox, 'background.avi')
    const emptyPath = path.join(sandbox, 'empty.png')
    const oversizedPath = path.join(sandbox, 'oversized.png')
    await writeFile(videoPath, Buffer.from('mp4'))
    await writeFile(unsupportedPath, Buffer.from('avi'))
    await writeFile(emptyPath, Buffer.alloc(0))
    await writeFile(oversizedPath, Buffer.alloc(0))
    await truncate(oversizedPath, MAX_IMAGE_BYTES + 1)

    await expect(
      store.importAsset({
        sourcePath: videoPath,
        category: 'project-cover',
      }),
    ).rejects.toMatchObject({ code: 'VISUAL_ASSET_UNSUPPORTED' })
    await expect(
      store.importAsset({
        sourcePath: unsupportedPath,
        category: 'page-background',
      }),
    ).rejects.toMatchObject({ code: 'VISUAL_ASSET_UNSUPPORTED' })
    await expect(
      store.importAsset({
        sourcePath: 'relative.png',
        category: 'project-cover',
      }),
    ).rejects.toMatchObject({ code: 'VISUAL_ASSET_INVALID_PATH' })
    await expect(
      store.importAsset({
        sourcePath: emptyPath,
        category: 'project-cover',
      }),
    ).rejects.toMatchObject({ code: 'VISUAL_ASSET_SIZE_LIMIT' })
    await expect(
      store.importAsset({
        sourcePath: oversizedPath,
        category: 'page-background',
      }),
    ).rejects.toMatchObject({ code: 'VISUAL_ASSET_SIZE_LIMIT' })
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('only removes regular files owned by the managed visual asset store', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-visual-assets-'))
  const userDataPath = path.join(sandbox, 'user-data')
  try {
    const store = createVisualAssetStore({ userDataPath })
    const sourcePath = path.join(sandbox, 'cover.jpg')
    const outsidePath = path.join(sandbox, 'outside.jpg')
    await writeFile(sourcePath, Buffer.from('managed'))
    await writeFile(outsidePath, Buffer.from('outside'))
    const imported = await store.importAsset({
      sourcePath,
      category: 'project-cover',
    })

    await expect(store.removeAsset({ managedPath: outsidePath })).resolves.toBe(
      false,
    )
    await expect(readFile(outsidePath, 'utf8')).resolves.toBe('outside')

    const symlinkPath = path.join(
      userDataPath,
      MANAGED_DIRECTORY_NAME,
      'project-cover',
      '11111111-1111-4111-8111-111111111111.jpg',
    )
    await symlink(outsidePath, symlinkPath)
    await expect(store.removeAsset({ managedPath: symlinkPath })).resolves.toBe(
      false,
    )
    await expect(store.validateManagedPath(symlinkPath)).resolves.toBeNull()
    await expect(readFile(outsidePath, 'utf8')).resolves.toBe('outside')

    await expect(
      store.removeAsset({ managedPath: imported.managedPath }),
    ).resolves.toBe(true)
    await expect(
      store.removeAsset({ managedPath: imported.managedPath }),
    ).resolves.toBe(true)
    await expect(store.validateManagedPath(imported.managedPath)).resolves.toBeNull()
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('prunes only unreferenced managed files and interrupted import remnants', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-visual-assets-'))
  const userDataPath = path.join(sandbox, 'user-data')
  try {
    const store = createVisualAssetStore({ userDataPath })
    const firstSource = path.join(sandbox, 'keep.png')
    const secondSource = path.join(sandbox, 'orphan.png')
    await writeFile(firstSource, Buffer.from('keep'))
    await writeFile(secondSource, Buffer.from('orphan'))
    const kept = await store.importAsset({
      sourcePath: firstSource,
      category: 'project-cover',
    })
    const orphan = await store.importAsset({
      sourcePath: secondSource,
      category: 'project-cover',
    })
    const interruptedPath = path.join(
      userDataPath,
      MANAGED_DIRECTORY_NAME,
      'project-cover',
      '.11111111-1111-4111-8111-111111111111.importing',
    )
    await writeFile(interruptedPath, Buffer.from('partial'))

    await expect(store.pruneAssets([kept.managedPath])).resolves.toBe(2)
    await expect(readFile(kept.managedPath, 'utf8')).resolves.toBe('keep')
    await expect(store.validateManagedPath(orphan.managedPath)).resolves.toBeNull()
    await expect(readFile(interruptedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
