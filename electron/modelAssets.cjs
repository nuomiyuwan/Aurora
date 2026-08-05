const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MAX_MODEL_BYTES = 500 * 1024 * 1024
const MAX_MODEL_CHUNK_BYTES = 8 * 1024 * 1024
const MAX_RENDER_BYTES = 128 * 1024 * 1024
const GLB_MAGIC = 0x46546c67

function safeName(value, fallback) {
  if (typeof value !== 'string') return fallback
  const name = path.basename(value.trim()).slice(0, 180)
  return name || fallback
}

function createModelAssetManager({ userDataPath }) {
  const root = path.join(userDataPath, 'model-assets')
  const chunkedImports = new Map()

  async function validateGlbContents(filePath, stat) {
    if (!stat.isFile() || stat.size <= 12 || stat.size > MAX_MODEL_BYTES) {
      throw new RangeError('The GLB file is empty or exceeds 500 MB')
    }
    const handle = await fs.promises.open(filePath, 'r')
    try {
      const header = Buffer.alloc(12)
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      if (
        bytesRead !== 12 ||
        header.readUInt32LE(0) !== GLB_MAGIC ||
        header.readUInt32LE(4) !== 2 ||
        header.readUInt32LE(8) !== stat.size
      ) {
        throw new TypeError('The file is not a valid glTF 2.0 GLB')
      }
    } finally {
      await handle.close()
    }
  }

  async function validateGlb(filePath, stat) {
    if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.glb') {
      throw new TypeError('A local GLB file is required')
    }
    await validateGlbContents(filePath, stat)
  }

  async function importModelAsset(request = {}) {
    const filePath = typeof request.filePath === 'string' ? request.filePath : ''
    if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.glb') {
      throw new TypeError('A local GLB file is required')
    }
    const stat = await fs.promises.stat(filePath)
    await validateGlb(filePath, stat)
    await fs.promises.mkdir(root, { recursive: true })
    const id = crypto.randomUUID()
    const managedPath = path.join(root, `${id}.glb`)
    await fs.promises.copyFile(filePath, managedPath, fs.constants.COPYFILE_EXCL)
    return {
      managedPath,
      name: safeName(request.name, path.basename(filePath)),
      sizeBytes: stat.size,
    }
  }

  async function discardChunkedImport(session) {
    chunkedImports.delete(session.operationId)
    if (!session.closed) {
      session.closed = true
      await session.handle.close().catch(() => undefined)
    }
    await fs.promises.unlink(session.temporaryPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }

  async function beginModelAssetImport(request = {}) {
    const sizeBytes = Number(request.sizeBytes)
    if (
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 12 ||
      sizeBytes > MAX_MODEL_BYTES
    ) {
      throw new RangeError('The GLB file is empty or exceeds 500 MB')
    }
    await fs.promises.mkdir(root, { recursive: true })
    const operationId = crypto.randomUUID()
    const managedPath = path.join(root, `${operationId}.glb`)
    const temporaryPath = path.join(root, `.${operationId}.glb.importing`)
    const handle = await fs.promises.open(temporaryPath, 'wx')
    chunkedImports.set(operationId, {
      operationId,
      managedPath,
      temporaryPath,
      handle,
      name: safeName(request.name, 'model.glb'),
      expectedSizeBytes: sizeBytes,
      writtenSizeBytes: 0,
      writing: false,
      closed: false,
    })
    return { operationId }
  }

  async function appendModelAssetImport(request = {}) {
    const operationId = typeof request.operationId === 'string'
      ? request.operationId
      : ''
    const session = chunkedImports.get(operationId)
    if (!session) throw new TypeError('The model import operation is not active')
    if (session.writing || session.closed) {
      throw new Error('The model import operation is busy')
    }
    const bytes = Buffer.from(request.bytes ?? [])
    if (bytes.length <= 0 || bytes.length > MAX_MODEL_CHUNK_BYTES) {
      throw new RangeError('The model import chunk is empty or too large')
    }
    if (session.writtenSizeBytes + bytes.length > session.expectedSizeBytes) {
      await discardChunkedImport(session)
      throw new RangeError('The model import exceeds its declared size')
    }

    session.writing = true
    try {
      let offset = 0
      while (offset < bytes.length) {
        const result = await session.handle.write(
          bytes,
          offset,
          bytes.length - offset,
          null,
        )
        if (result.bytesWritten <= 0) {
          throw new Error('The model import chunk could not be written')
        }
        offset += result.bytesWritten
      }
      session.writtenSizeBytes += bytes.length
      return { writtenSizeBytes: session.writtenSizeBytes }
    } catch (error) {
      await discardChunkedImport(session)
      throw error
    } finally {
      session.writing = false
    }
  }

  async function completeModelAssetImport(request = {}) {
    const operationId = typeof request.operationId === 'string'
      ? request.operationId
      : ''
    const session = chunkedImports.get(operationId)
    if (!session) throw new TypeError('The model import operation is not active')
    if (session.writing || session.closed) {
      throw new Error('The model import operation is busy')
    }
    if (session.writtenSizeBytes !== session.expectedSizeBytes) {
      await discardChunkedImport(session)
      throw new RangeError('The model import is incomplete')
    }

    chunkedImports.delete(operationId)
    try {
      await session.handle.sync()
      await session.handle.close()
      session.closed = true
      const stat = await fs.promises.stat(session.temporaryPath)
      await validateGlbContents(session.temporaryPath, stat)
      await fs.promises.rename(session.temporaryPath, session.managedPath)
      return {
        managedPath: session.managedPath,
        name: session.name,
        sizeBytes: stat.size,
      }
    } catch (error) {
      await discardChunkedImport(session)
      throw error
    }
  }

  async function abortModelAssetImport(request = {}) {
    const operationId = typeof request.operationId === 'string'
      ? request.operationId
      : ''
    const session = chunkedImports.get(operationId)
    if (!session) return false
    if (session.writing) throw new Error('The model import operation is busy')
    await discardChunkedImport(session)
    return true
  }

  async function removeModelAsset(managedPath) {
    if (typeof managedPath !== 'string' || !path.isAbsolute(managedPath)) return false
    const relative = path.relative(root, managedPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
    try {
      await fs.promises.unlink(managedPath)
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return true
      throw error
    }
  }

  async function saveModelRender(request = {}) {
    const destinationPath =
      typeof request.destinationPath === 'string'
        ? request.destinationPath.trim()
        : ''
    if (
      !path.isAbsolute(destinationPath) ||
      path.extname(destinationPath).toLowerCase() !== '.png'
    ) {
      throw new TypeError('An absolute PNG destination is required')
    }
    const bytes = Buffer.from(request.bytes ?? [])
    if (bytes.length <= 0 || bytes.length > MAX_RENDER_BYTES) {
      throw new RangeError('The rendered PNG is empty or too large')
    }
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true })
    await fs.promises.writeFile(destinationPath, bytes)
    return { destinationPath, sizeBytes: bytes.length }
  }

  return {
    importModelAsset,
    beginModelAssetImport,
    appendModelAssetImport,
    completeModelAssetImport,
    abortModelAssetImport,
    removeModelAsset,
    saveModelRender,
  }
}

module.exports = { createModelAssetManager }
