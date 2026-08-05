const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MANAGED_DIRECTORY_NAME = 'visual-assets'
const VISUAL_ASSET_CATEGORIES = Object.freeze([
  'page-background',
  'project-cover',
])
const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp',
])
const BACKGROUND_VIDEO_EXTENSIONS = new Set([
  '.m4v',
  '.mov',
  '.mp4',
  '.webm',
])
const MAX_IMAGE_BYTES = 128 * 1024 * 1024
const MAX_BACKGROUND_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
const MANAGED_FILE_NAME_PATTERN =
  /^(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?<extension>\.[a-z0-9]+)$/i
const TEMPORARY_FILE_NAME_PATTERN =
  /^\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.importing$/i
const UNSUPPORTED_FILE_SYNC_ERROR_CODES = new Set([
  'EINVAL',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EPERM',
])

class VisualAssetError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'VisualAssetError'
    this.code = code
    if (cause) this.cause = cause
  }
}

function visualAssetError(code, message, cause) {
  return new VisualAssetError(code, message, cause)
}

function normalizeDisplayName(value, fallbackPath) {
  const fallback = path.basename(fallbackPath)
  const source = typeof value === 'string' ? value : fallback
  const sanitized = Array.from(source, (character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && codePoint > 31 && codePoint !== 127
      ? character
      : ''
  }).join('')
  const normalized = path.basename(sanitized.trim())
  return (normalized || fallback || 'visual-asset').normalize('NFC').slice(0, 255)
}

function normalizeCategory(value) {
  if (!VISUAL_ASSET_CATEGORIES.includes(value)) {
    throw visualAssetError(
      'VISUAL_ASSET_INVALID_CATEGORY',
      'Visual asset category must be page-background or project-cover',
    )
  }
  return value
}

function assetKindForExtension(category, extension) {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (
    category === 'page-background' &&
    BACKGROUND_VIDEO_EXTENSIONS.has(extension)
  ) {
    return 'video'
  }
  throw visualAssetError(
    'VISUAL_ASSET_UNSUPPORTED',
    category === 'project-cover'
      ? 'Project covers must use a supported image format'
      : 'Page backgrounds must use a supported image or MP4, MOV, M4V, or WebM video',
  )
}

function maximumSizeForKind(kind) {
  return kind === 'video' ? MAX_BACKGROUND_VIDEO_BYTES : MAX_IMAGE_BYTES
}

async function syncCopiedFileForDurability(
  filePath,
  openFile = fs.promises.open,
) {
  // Windows rejects fsync on read-only descriptors with EPERM. Open the copy
  // writable even though no additional bytes are changed. Some redirected or
  // virtual filesystems do not implement fsync at all; after the copy's size
  // and source fingerprint have been verified, those explicit unsupported
  // errors are safe to treat as a best-effort durability limitation.
  const handle = await openFile(filePath, 'r+')
  try {
    try {
      await handle.sync()
    } catch (error) {
      if (!UNSUPPORTED_FILE_SYNC_ERROR_CODES.has(error?.code)) throw error
    }
  } finally {
    await handle.close()
  }
}

function assertSafeSourcePath(sourcePath) {
  if (
    typeof sourcePath !== 'string' ||
    !path.isAbsolute(sourcePath) ||
    sourcePath.includes('\0')
  ) {
    throw visualAssetError(
      'VISUAL_ASSET_INVALID_PATH',
      'An absolute local visual asset path is required',
    )
  }
}

function createVisualAssetStore({ userDataPath } = {}) {
  if (
    typeof userDataPath !== 'string' ||
    !path.isAbsolute(userDataPath) ||
    userDataPath.includes('\0')
  ) {
    throw new TypeError('An absolute Electron userData path is required')
  }

  const root = path.join(path.resolve(userDataPath), MANAGED_DIRECTORY_NAME)

  function categoryDirectory(category) {
    return path.join(root, normalizeCategory(category))
  }

  async function ensureManagedDirectory(category) {
    const directory = categoryDirectory(category)
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 })
    const rootStat = await fs.promises.lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw visualAssetError(
        'VISUAL_ASSET_UNSAFE_STORAGE',
        'The managed visual asset directory is not a safe local directory',
      )
    }
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })

    const categoryStat = await fs.promises.lstat(directory)
    if (
      !categoryStat.isDirectory() ||
      categoryStat.isSymbolicLink()
    ) {
      throw visualAssetError(
        'VISUAL_ASSET_UNSAFE_STORAGE',
        'The managed visual asset directory is not a safe local directory',
      )
    }

    // Best effort on Windows, and deliberately restrictive on POSIX.
    await fs.promises.chmod(root, 0o700).catch(() => undefined)
    await fs.promises.chmod(directory, 0o700).catch(() => undefined)
    return directory
  }

  function parseManagedPath(managedPath) {
    if (
      typeof managedPath !== 'string' ||
      !path.isAbsolute(managedPath) ||
      managedPath.includes('\0')
    ) {
      return null
    }

    const relative = path.relative(root, path.resolve(managedPath))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null
    }
    const components = relative.split(path.sep)
    if (components.length !== 2) return null
    const [category, fileName] = components
    if (!VISUAL_ASSET_CATEGORIES.includes(category)) return null
    const match = MANAGED_FILE_NAME_PATTERN.exec(fileName)
    if (!match?.groups) return null

    const extension = match.groups.extension.toLowerCase()
    let kind
    try {
      kind = assetKindForExtension(category, extension)
    } catch {
      return null
    }
    return {
      category,
      extension,
      fileName,
      kind,
      managedPath: path.join(root, category, fileName),
    }
  }

  async function validateManagedPath(request = {}) {
    const managedPath =
      typeof request === 'string' ? request : request?.managedPath
    const expectedCategory =
      typeof request === 'object' && request !== null
        ? request.category
        : undefined
    const parsed = parseManagedPath(managedPath)
    if (!parsed || (expectedCategory && expectedCategory !== parsed.category)) {
      return null
    }

    try {
      const directory = await ensureManagedDirectory(parsed.category)
      const [rootRealPath, directoryRealPath] = await Promise.all([
        fs.promises.realpath(root),
        fs.promises.realpath(directory),
      ])
      if (path.dirname(directoryRealPath) !== rootRealPath) return null

      const linkStat = await fs.promises.lstat(parsed.managedPath)
      if (!linkStat.isFile() || linkStat.isSymbolicLink()) return null
      const realPath = await fs.promises.realpath(parsed.managedPath)
      if (path.dirname(realPath) !== directoryRealPath) return null
      const stat = await fs.promises.stat(realPath)
      const maximumBytes = maximumSizeForKind(parsed.kind)
      if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
        return null
      }
      return {
        category: parsed.category,
        kind: parsed.kind,
        managedPath: parsed.managedPath,
        sizeBytes: stat.size,
      }
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
      throw error
    }
  }

  async function importAsset(request = {}) {
    const sourcePath = request?.sourcePath
    const category = normalizeCategory(request?.category)
    assertSafeSourcePath(sourcePath)

    let realSourcePath
    try {
      realSourcePath = await fs.promises.realpath(sourcePath)
    } catch (error) {
      throw visualAssetError(
        'VISUAL_ASSET_NOT_FOUND',
        'The selected visual asset could not be found',
        error,
      )
    }

    const extension = path.extname(sourcePath).toLowerCase()
    const kind = assetKindForExtension(category, extension)
    const maximumBytes = maximumSizeForKind(kind)
    const sourceStat = await fs.promises.stat(realSourcePath)
    if (!sourceStat.isFile()) {
      throw visualAssetError(
        'VISUAL_ASSET_INVALID_PATH',
        'The selected visual asset must be a local file',
      )
    }
    if (sourceStat.size <= 0 || sourceStat.size > maximumBytes) {
      throw visualAssetError(
        'VISUAL_ASSET_SIZE_LIMIT',
        kind === 'video'
          ? 'The selected background video is empty or exceeds 2 GB'
          : 'The selected image is empty or exceeds 128 MB',
      )
    }

    const directory = await ensureManagedDirectory(category)
    const id = crypto.randomUUID()
    const destinationPath = path.join(directory, `${id}${extension}`)
    const temporaryPath = path.join(directory, `.${id}.importing`)

    try {
      await fs.promises.copyFile(
        realSourcePath,
        temporaryPath,
        fs.constants.COPYFILE_EXCL,
      )
      const copiedStat = await fs.promises.stat(temporaryPath)
      if (!copiedStat.isFile() || copiedStat.size !== sourceStat.size) {
        throw visualAssetError(
          'VISUAL_ASSET_COPY_FAILED',
          'The visual asset copy did not pass its integrity check',
        )
      }
      const sourceStatAfterCopy = await fs.promises.stat(realSourcePath)
      if (
        sourceStatAfterCopy.dev !== sourceStat.dev ||
        sourceStatAfterCopy.ino !== sourceStat.ino ||
        sourceStatAfterCopy.size !== sourceStat.size ||
        sourceStatAfterCopy.mtimeMs !== sourceStat.mtimeMs
      ) {
        throw visualAssetError(
          'VISUAL_ASSET_SOURCE_CHANGED',
          'The selected visual asset changed while it was being imported',
        )
      }

      await fs.promises.chmod(temporaryPath, 0o600).catch(() => undefined)
      await syncCopiedFileForDurability(temporaryPath)
      await fs.promises.rename(temporaryPath, destinationPath)

      return {
        name: normalizeDisplayName(request?.name, sourcePath),
        kind,
        managedPath: destinationPath,
        sizeBytes: copiedStat.size,
      }
    } catch (error) {
      await fs.promises.unlink(temporaryPath).catch((cleanupError) => {
        if (cleanupError?.code !== 'ENOENT') throw cleanupError
      })
      throw error
    }
  }

  async function removeAsset(request = {}) {
    const managedPath =
      typeof request === 'string' ? request : request?.managedPath
    const parsed = parseManagedPath(managedPath)
    if (!parsed) return false

    try {
      const directory = categoryDirectory(parsed.category)
      const [rootStat, directoryStat, assetStat] = await Promise.all([
        fs.promises.lstat(root),
        fs.promises.lstat(directory),
        fs.promises.lstat(parsed.managedPath),
      ])
      if (
        !rootStat.isDirectory() ||
        rootStat.isSymbolicLink() ||
        !directoryStat.isDirectory() ||
        directoryStat.isSymbolicLink() ||
        !assetStat.isFile() ||
        assetStat.isSymbolicLink()
      ) {
        return false
      }
      const [rootRealPath, directoryRealPath, assetRealPath] = await Promise.all([
        fs.promises.realpath(root),
        fs.promises.realpath(directory),
        fs.promises.realpath(parsed.managedPath),
      ])
      if (
        path.dirname(directoryRealPath) !== rootRealPath ||
        path.dirname(assetRealPath) !== directoryRealPath
      ) {
        return false
      }
      await fs.promises.unlink(parsed.managedPath)
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return true
      throw error
    }
  }

  async function pruneAssets(referencedPaths = []) {
    const references = new Set(
      (Array.isArray(referencedPaths) ? referencedPaths : []).flatMap(
        (managedPath) => {
          const parsed = parseManagedPath(managedPath)
          return parsed ? [parsed.managedPath] : []
        },
      ),
    )
    let removed = 0

    for (const category of VISUAL_ASSET_CATEGORIES) {
      const directory = await ensureManagedDirectory(category)
      const entries = await fs.promises.readdir(directory, {
        withFileTypes: true,
      })
      for (const entry of entries) {
        const managedPath = path.join(directory, entry.name)
        if (entry.isFile() && TEMPORARY_FILE_NAME_PATTERN.test(entry.name)) {
          await fs.promises.unlink(managedPath).catch((error) => {
            if (error?.code !== 'ENOENT') throw error
          })
          removed += 1
          continue
        }
        const parsed = parseManagedPath(managedPath)
        if (!parsed || references.has(parsed.managedPath)) continue
        if (await removeAsset(parsed.managedPath)) removed += 1
      }
    }

    return removed
  }

  return {
    importAsset,
    pruneAssets,
    removeAsset,
    validateManagedPath,
  }
}

module.exports = {
  BACKGROUND_VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MANAGED_DIRECTORY_NAME,
  MAX_BACKGROUND_VIDEO_BYTES,
  MAX_IMAGE_BYTES,
  VISUAL_ASSET_CATEGORIES,
  VisualAssetError,
  createVisualAssetStore,
  syncCopiedFileForDurability,
}
