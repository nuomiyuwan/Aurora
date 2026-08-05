import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const { createModelAssetManager } = require('../electron/modelAssets.cjs')

function createEmptyGlb() {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [] }],
  }))
  const paddedJsonLength = Math.ceil(json.length / 4) * 4
  const buffer = Buffer.alloc(12 + 8 + paddedJsonLength, 0x20)
  buffer.writeUInt32LE(0x46546c67, 0)
  buffer.writeUInt32LE(2, 4)
  buffer.writeUInt32LE(buffer.length, 8)
  buffer.writeUInt32LE(paddedJsonLength, 12)
  buffer.writeUInt32LE(0x4e4f534a, 16)
  json.copy(buffer, 20)
  return buffer
}

test('Electron 分块托管转换后的 GLB，同时保留用户选择的原始文件名', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'aurora-model-assets-'))
  try {
    const manager = createModelAssetManager({ userDataPath })
    const glb = createEmptyGlb()
    const started = await manager.beginModelAssetImport({
      name: 'hero-character.fbx',
      sizeBytes: glb.length,
    })
    await manager.appendModelAssetImport({
      operationId: started.operationId,
      bytes: new Uint8Array(glb.subarray(0, 17)),
    })
    await manager.appendModelAssetImport({
      operationId: started.operationId,
      bytes: new Uint8Array(glb.subarray(17)),
    })
    const imported = await manager.completeModelAssetImport({
      operationId: started.operationId,
    })

    expect(imported.name).toBe('hero-character.fbx')
    expect(imported.managedPath).toMatch(/\.glb$/)
    expect(imported.sizeBytes).toBe(glb.length)
    await expect(readFile(imported.managedPath)).resolves.toEqual(glb)
    await expect(manager.removeModelAsset(imported.managedPath)).resolves.toBe(true)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('Electron 中止分块模型导入时清理临时文件', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'aurora-model-assets-'))
  try {
    const manager = createModelAssetManager({ userDataPath })
    const glb = createEmptyGlb()
    const started = await manager.beginModelAssetImport({
      name: 'aborted.obj',
      sizeBytes: glb.length,
    })
    await manager.appendModelAssetImport({
      operationId: started.operationId,
      bytes: new Uint8Array(glb.subarray(0, 16)),
    })
    await expect(
      manager.abortModelAssetImport({ operationId: started.operationId }),
    ).resolves.toBe(true)
    await expect(
      manager.completeModelAssetImport({ operationId: started.operationId }),
    ).rejects.toThrow(/not active/)
    await expect(
      readdir(path.join(userDataPath, 'model-assets')),
    ).resolves.toEqual([])
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('Electron 拒绝无效的分块 GLB 并清理临时文件', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'aurora-model-assets-'))
  try {
    const manager = createModelAssetManager({ userDataPath })
    const invalid = Buffer.alloc(32, 0)
    const started = await manager.beginModelAssetImport({
      name: 'invalid.fbx',
      sizeBytes: invalid.length,
    })
    await manager.appendModelAssetImport({
      operationId: started.operationId,
      bytes: new Uint8Array(invalid),
    })
    await expect(
      manager.completeModelAssetImport({ operationId: started.operationId }),
    ).rejects.toThrow(/not a valid glTF 2.0 GLB/)
    await expect(
      readdir(path.join(userDataPath, 'model-assets')),
    ).resolves.toEqual([])
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('Electron 继续接受原有本地 GLB 路径并拒绝无效转换结果', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'aurora-model-assets-'))
  try {
    const manager = createModelAssetManager({ userDataPath })
    const sourcePath = path.join(userDataPath, 'legacy.glb')
    const glb = createEmptyGlb()
    await writeFile(sourcePath, glb)

    const imported = await manager.importModelAsset({ filePath: sourcePath })
    expect(imported.name).toBe('legacy.glb')
    await expect(readFile(imported.managedPath)).resolves.toEqual(glb)

    const invalidPath = path.join(userDataPath, 'broken.glb')
    await writeFile(invalidPath, Buffer.alloc(32, 0))
    await expect(
      manager.importModelAsset({ filePath: invalidPath }),
    ).rejects.toThrow(/not a valid glTF 2.0 GLB/)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})
