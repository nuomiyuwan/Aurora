import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const { createParticleAssetManager } = require('../electron/particleAssets.cjs') as {
  createParticleAssetManager(input: { userDataPath: string }): {
    managedRoot: string
    validateParticleAsset(input: {
      managedPath: string
      posterPath: string | null
    }): Promise<{
      kind: 'image' | 'video'
      managedPath: string
      posterPath: string | null
      sizeBytes: number
    } | null>
    pruneParticleAssets(referencedPaths: string[]): Promise<number>
  }
}

test('validates persisted particle pairs and prunes only unreferenced assets', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-particles-'))
  try {
    const manager = createParticleAssetManager({
      userDataPath: path.join(sandbox, 'user-data'),
    })
    await mkdir(manager.managedRoot, { recursive: true })
    const videoId = '11111111-1111-4111-8111-111111111111'
    const imageId = '22222222-2222-4222-8222-222222222222'
    const videoPath = path.join(manager.managedRoot, `particle-${videoId}.webm`)
    const posterPath = path.join(
      manager.managedRoot,
      `particle-${videoId}.poster.png`,
    )
    const orphanPath = path.join(manager.managedRoot, `particle-${imageId}.png`)
    await writeFile(videoPath, Buffer.from('video'))
    await writeFile(posterPath, Buffer.from('poster'))
    await writeFile(orphanPath, Buffer.from('orphan'))

    await expect(
      manager.validateParticleAsset({
        managedPath: videoPath,
        posterPath,
      }),
    ).resolves.toMatchObject({
      kind: 'video',
      managedPath: videoPath,
      posterPath,
    })
    await expect(
      manager.validateParticleAsset({
        managedPath: videoPath,
        posterPath: null,
      }),
    ).resolves.toBeNull()

    await expect(manager.pruneParticleAssets([videoPath])).resolves.toBe(1)
    await expect(readFile(videoPath, 'utf8')).resolves.toBe('video')
    await expect(readFile(posterPath, 'utf8')).resolves.toBe('poster')
    await expect(readFile(orphanPath)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
