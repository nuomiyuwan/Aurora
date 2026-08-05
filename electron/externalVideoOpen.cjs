const fs = require('fs')
const path = require('path')

const EXTERNAL_VIDEO_EXTENSIONS = new Set([
  '.3g2',
  '.3gp',
  '.asf',
  '.avi',
  '.f4v',
  '.flv',
  '.m2ts',
  '.m2v',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.mts',
  '.mxf',
  '.ogv',
  '.rm',
  '.rmvb',
  '.ts',
  '.vob',
  '.webm',
  '.wmv',
])

function isSupportedExternalVideoPath(filePath) {
  return (
    typeof filePath === 'string' &&
    path.isAbsolute(filePath) &&
    EXTERNAL_VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  )
}

function describeExternalVideoPath(filePath, statFile = fs.statSync) {
  if (!isSupportedExternalVideoPath(filePath)) return null
  try {
    const stat = statFile(filePath)
    if (!stat?.isFile?.()) return null
    return {
      path: filePath,
      name: path.basename(filePath),
      sizeBytes: Number.isSafeInteger(stat.size) ? stat.size : 0,
      modifiedAt:
        stat.mtime instanceof Date && Number.isFinite(stat.mtime.getTime())
          ? stat.mtime.toISOString()
          : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

function createExternalVideoOpenBroker({
  describePath = describeExternalVideoPath,
} = {}) {
  const pending = new Map()
  let consumer = null

  const flush = () => {
    if (!consumer || pending.size === 0) return false
    const batch = [...pending.values()]
    try {
      consumer(batch)
      batch.forEach((descriptor) => pending.delete(descriptor.path))
      return true
    } catch {
      return false
    }
  }

  return {
    enqueue(filePaths) {
      const accepted = []
      for (const filePath of Array.isArray(filePaths) ? filePaths : [filePaths]) {
        const descriptor = describePath(filePath)
        if (!descriptor || pending.has(descriptor.path)) continue
        pending.set(descriptor.path, descriptor)
        accepted.push(descriptor)
      }
      flush()
      return accepted
    },

    setConsumer(nextConsumer) {
      consumer = typeof nextConsumer === 'function' ? nextConsumer : null
      return flush()
    },

    clearConsumer(nextConsumer) {
      if (!nextConsumer || consumer === nextConsumer) consumer = null
    },

    pendingCount() {
      return pending.size
    },
  }
}

module.exports = {
  EXTERNAL_VIDEO_EXTENSIONS,
  createExternalVideoOpenBroker,
  describeExternalVideoPath,
  isSupportedExternalVideoPath,
}
