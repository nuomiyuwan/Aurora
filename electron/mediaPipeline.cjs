const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  inspectMediaFile,
  mediaToolCandidates,
  validateMediaFilePath,
} = require('./mediaProbe.cjs')

const INDEX_VERSION = 4
const INDEX_TIMESTAMP_MODE = 'ffmpeg-input-pts-v1'
const PREVIEW_PROXY_VERSION = 1
const MEDIA_THUMBNAIL_VERSION = 1
const MEDIA_THUMBNAIL_MAX_WIDTH = 960
const MEDIA_THUMBNAIL_SAMPLE_FRAMES = 24
const MAX_CONCURRENT_MEDIA_THUMBNAILS = 2
const MIN_INDEX_FRAME_COUNT = 10
const MAX_INDEX_FRAME_COUNT = 1200
const INDEX_MAX_EDGE = 640
const INDEX_JPEG_QUALITY = 5
const INDEX_SCENE_CHANGE_THRESHOLD = 0.35
const MAX_ERROR_OUTPUT_BYTES = 256 * 1024
const MEDIA_URL_SCHEME = 'aurora-media'
const DIRECT_MP4_PLAYBACK_CODECS = new Set(['av1', 'h264'])
const DIRECT_WEBM_PLAYBACK_CODECS = new Set(['av1', 'vp8', 'vp9'])
const UNAVAILABLE_FRAME_PTS = '9223372036854775807'
const FRAME_STATS_FORMAT = '{n}|{ni}|{ptsi}|{tbi}|{ti}|{t}|{pts}|{tb}'

function mediaError(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause) error.cause = cause
  return error
}

function validateOperationId(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value)
  ) {
    throw mediaError('MEDIA_INVALID_INPUT', 'A valid media operation ID is required')
  }
  return value
}

function resolveOperationId(value) {
  return value == null || value === ''
    ? crypto.randomUUID()
    : validateOperationId(value)
}

function validateAssetId(value) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 512
  ) {
    throw mediaError('MEDIA_INVALID_INPUT', 'A valid asset ID is required')
  }
  return value.trim()
}

function finiteNumber(value, label, minimum = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < minimum) {
    throw mediaError('MEDIA_INVALID_INPUT', `${label} must be a finite number`)
  }
  return numeric
}

function optionalPositiveInteger(value, label) {
  if (value == null) return null
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 16_384) {
    throw mediaError('MEDIA_INVALID_INPUT', `${label} must be a positive integer`)
  }
  return numeric
}

async function validateDestinationPath(inputPath, sourcePath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw mediaError('MEDIA_INVALID_INPUT', 'An export destination is required')
  }
  if (inputPath.includes('\0')) {
    throw mediaError('MEDIA_INVALID_INPUT', 'The export destination is invalid')
  }

  const destinationPath = path.resolve(inputPath.trim())
  if (sourcePath && destinationPath === sourcePath) {
    throw mediaError(
      'MEDIA_INVALID_INPUT',
      'The export destination cannot overwrite the source media',
    )
  }

  const parentPath = path.dirname(destinationPath)
  const parentStat = await fs.promises.stat(parentPath)
  if (!parentStat.isDirectory()) {
    throw mediaError('MEDIA_INVALID_INPUT', 'The export folder is not a directory')
  }
  return destinationPath
}

function temporaryOutputPath(destinationPath, operationId) {
  const extension = path.extname(destinationPath)
  const basename = path.basename(destinationPath, extension)
  return path.join(
    path.dirname(destinationPath),
    `.${basename}.${operationId}.tmp${extension}`,
  )
}

async function atomicReplace(tempPath, destinationPath) {
  const backupPath = `${destinationPath}.aurora-backup-${crypto.randomUUID()}`
  let movedExistingFile = false

  try {
    try {
      await fs.promises.rename(destinationPath, backupPath)
      movedExistingFile = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    await fs.promises.rename(tempPath, destinationPath)
    if (movedExistingFile) {
      await fs.promises.rm(backupPath, { force: true })
    }
  } catch (error) {
    if (movedExistingFile) {
      try {
        await fs.promises.rename(backupPath, destinationPath)
      } catch {
        // Preserve the original failure. The backup name is retained for recovery.
      }
    }
    throw error
  }
}

function parseProgressTime(progressValues) {
  const microseconds = Number(
    progressValues.out_time_us ?? progressValues.out_time_ms,
  )
  if (Number.isFinite(microseconds) && microseconds >= 0) {
    return microseconds / 1_000_000
  }

  if (typeof progressValues.out_time === 'string') {
    const parts = progressValues.out_time.split(':').map(Number)
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    }
  }
  return null
}

function appendBounded(current, chunk) {
  const next = `${current}${chunk}`
  return next.length <= MAX_ERROR_OUTPUT_BYTES
    ? next
    : next.slice(next.length - MAX_ERROR_OUTPUT_BYTES)
}

function parseIntegerText(value, label, minimum = null) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw mediaError(
      'MEDIA_INDEX_TIMESTAMPS_INVALID',
      `${label} is missing or invalid`,
    )
  }
  const parsed = BigInt(value)
  if (minimum != null && parsed < BigInt(minimum)) {
    throw mediaError(
      'MEDIA_INDEX_TIMESTAMPS_INVALID',
      `${label} is outside the supported range`,
    )
  }
  return parsed
}

function parseTimeBase(value, label) {
  const match =
    typeof value === 'string' ? value.match(/^(\d+)\/(\d+)$/) : null
  if (!match) {
    throw mediaError(
      'MEDIA_INDEX_TIMESTAMPS_INVALID',
      `${label} is missing or invalid`,
    )
  }
  const numerator = BigInt(match[1])
  const denominator = BigInt(match[2])
  if (numerator <= 0n || denominator <= 0n) {
    throw mediaError(
      'MEDIA_INDEX_TIMESTAMPS_INVALID',
      `${label} must be positive`,
    )
  }
  return { numerator, denominator, text: value }
}

function rationalSeconds(timestamp, timeBase, label) {
  const scaled = timestamp * timeBase.numerator
  const whole = scaled / timeBase.denominator
  const remainder = scaled % timeBase.denominator
  const seconds =
    Number(whole) + Number(remainder) / Number(timeBase.denominator)
  if (!Number.isFinite(seconds)) {
    throw mediaError(
      'MEDIA_INDEX_TIMESTAMPS_INVALID',
      `${label} is outside the supported range`,
    )
  }
  return seconds
}

function validatePrintedTime(value, exactSeconds, timeBase, label) {
  const printedSeconds = Number(value)
  if (!Number.isFinite(printedSeconds)) {
    throw mediaError(
      'MEDIA_INDEX_TIMESTAMPS_INVALID',
      `${label} is missing or invalid`,
    )
  }
  const timeBaseSeconds =
    Number(timeBase.numerator) / Number(timeBase.denominator)
  const tolerance = Math.max(
    1e-6,
    Math.abs(exactSeconds) * 2e-6,
    timeBaseSeconds,
  )
  if (Math.abs(printedSeconds - exactSeconds) > tolerance) {
    throw mediaError(
      'MEDIA_INDEX_TIMESTAMPS_INVALID',
      `${label} does not match its exact timestamp`,
    )
  }
}

async function readFrameTimestampStats(
  statsPath,
  frameNames,
  durationSeconds,
) {
  let contents
  try {
    contents = await fs.promises.readFile(statsPath, 'utf8')
  } catch (error) {
    throw mediaError(
      'MEDIA_INDEX_TIMESTAMPS_INVALID',
      'ffmpeg did not write the visual-index frame timestamp map',
      error,
    )
  }

  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length !== frameNames.length) {
    throw mediaError(
      'MEDIA_INDEX_TIMESTAMPS_INVALID',
      'The visual-index frame and timestamp counts do not match',
    )
  }

  let previousTimeSeconds = -Infinity
  return lines.map((line, index) => {
    const fields = line.split('|')
    if (fields.length !== 8) {
      throw mediaError(
        'MEDIA_INDEX_TIMESTAMPS_INVALID',
        `Frame timestamp row ${index} has an invalid format`,
      )
    }

    const [
      outputIndexText,
      sourceFrameIndexText,
      sourcePtsText,
      sourceTimeBaseText,
      sourceTimeText,
      sampleTimeText,
      samplePtsText,
      sampleTimeBaseText,
    ] = fields
    const outputIndex = parseIntegerText(
      outputIndexText,
      `Frame timestamp row ${index} output index`,
      0,
    )
    if (outputIndex !== BigInt(index)) {
      throw mediaError(
        'MEDIA_INDEX_TIMESTAMPS_INVALID',
        'The visual-index frame timestamp rows are not sequential',
      )
    }
    const expectedName = `frame-${String(index).padStart(6, '0')}.jpg`
    if (frameNames[index] !== expectedName) {
      throw mediaError(
        'MEDIA_INDEX_TIMESTAMPS_INVALID',
        'The visual-index image sequence is not contiguous',
      )
    }

    const sourceFrameIndex = parseIntegerText(
      sourceFrameIndexText,
      `Frame timestamp row ${index} input frame`,
      0,
    )
    if (sourcePtsText === UNAVAILABLE_FRAME_PTS) {
      throw mediaError(
        'MEDIA_INDEX_TIMESTAMPS_INVALID',
        `Frame timestamp row ${index} has no input-frame timestamp`,
      )
    }
    const sourcePts = parseIntegerText(
      sourcePtsText,
      `Frame timestamp row ${index} input PTS`,
    )
    const sourceTimeBase = parseTimeBase(
      sourceTimeBaseText,
      `Frame timestamp row ${index} input time base`,
    )
    const timeSeconds = rationalSeconds(
      sourcePts,
      sourceTimeBase,
      `Frame timestamp row ${index} input time`,
    )
    validatePrintedTime(
      sourceTimeText,
      timeSeconds,
      sourceTimeBase,
      `Frame timestamp row ${index} printed input time`,
    )

    const samplePts = parseIntegerText(
      samplePtsText,
      `Frame timestamp row ${index} output PTS`,
    )
    const sampleTimeBase = parseTimeBase(
      sampleTimeBaseText,
      `Frame timestamp row ${index} output time base`,
    )
    const sampleTimeSeconds = rationalSeconds(
      samplePts,
      sampleTimeBase,
      `Frame timestamp row ${index} output time`,
    )
    validatePrintedTime(
      sampleTimeText,
      sampleTimeSeconds,
      sampleTimeBase,
      `Frame timestamp row ${index} printed output time`,
    )

    const durationTolerance = Math.max(
      1e-6,
      Number(sourceTimeBase.numerator) / Number(sourceTimeBase.denominator),
    )
    if (
      timeSeconds < -durationTolerance ||
      timeSeconds > durationSeconds + durationTolerance ||
      timeSeconds + durationTolerance < previousTimeSeconds
    ) {
      throw mediaError(
        'MEDIA_INDEX_TIMESTAMPS_INVALID',
        `Frame timestamp row ${index} is outside the source timeline`,
      )
    }
    previousTimeSeconds = Math.max(previousTimeSeconds, timeSeconds)

    return {
      timeSeconds: timeSeconds < 0 ? 0 : timeSeconds,
      sampleTimeSeconds,
      sourceFrameIndex: Number(sourceFrameIndex),
      sourcePts: sourcePts.toString(),
      sourceTimeBase: sourceTimeBase.text,
    }
  })
}

async function runSpawnedFfmpeg(args, operation, progressOptions = {}) {
  const {
    durationSeconds = null,
    onStderr = null,
    phase = 'processing',
    progressStart = 0,
    progressEnd = 1,
  } = progressOptions

  let lastMissingError = null

  for (const candidate of mediaToolCandidates('ffmpeg')) {
    if (operation.cancelled) {
      throw mediaError('MEDIA_CANCELLED', 'The media operation was cancelled')
    }

    try {
      await new Promise((resolveCandidate, rejectCandidate) => {
        let stderr = ''
        let stdoutBuffer = ''
        let progressValues = {}
        let settled = false
        const child = spawn(candidate, args, {
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        operation.child = child

        function settle(method, value) {
          if (settled) return
          settled = true
          if (operation.child === child) operation.child = null
          method(value)
        }

        function reportProgress(isComplete = false) {
          const processedSeconds = parseProgressTime(progressValues)
          const ratio =
            isComplete
              ? 1
              : durationSeconds && processedSeconds != null
                ? Math.min(1, Math.max(0, processedSeconds / durationSeconds))
                : 0
          operation.report({
            phase,
            progress:
              progressStart + ratio * (progressEnd - progressStart),
            processedSeconds,
            totalSeconds: durationSeconds,
          })
        }

        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk) => {
          stdoutBuffer += chunk
          const lines = stdoutBuffer.split(/\r?\n/)
          stdoutBuffer = lines.pop() ?? ''
          for (const line of lines) {
            const separatorIndex = line.indexOf('=')
            if (separatorIndex <= 0) continue
            const key = line.slice(0, separatorIndex)
            const value = line.slice(separatorIndex + 1)
            progressValues[key] = value
            if (key === 'progress') {
              reportProgress(value === 'end')
              progressValues = {}
            }
          }
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk) => {
          onStderr?.(chunk)
          stderr = appendBounded(stderr, chunk)
        })
        child.once('error', (error) => {
          if (error?.code === 'ENOENT') {
            settle(rejectCandidate, { missing: true, error })
            return
          }
          settle(
            rejectCandidate,
            mediaError(
              'FFMPEG_START_FAILED',
              `Unable to start ffmpeg: ${error.message}`,
              error,
            ),
          )
        })
        child.once('close', (code, signal) => {
          if (operation.cancelled) {
            settle(
              rejectCandidate,
              mediaError('MEDIA_CANCELLED', 'The media operation was cancelled'),
            )
            return
          }
          if (code === 0) {
            reportProgress(true)
            settle(resolveCandidate)
            return
          }
          const detail = stderr.trim()
          settle(
            rejectCandidate,
            mediaError(
              'FFMPEG_FAILED',
              `ffmpeg exited with code ${code ?? 'unknown'}${
                signal ? ` (${signal})` : ''
              }${detail ? `: ${detail}` : ''}`,
            ),
          )
        })
      })
      return
    } catch (error) {
      if (error?.missing) {
        lastMissingError = error.error
        continue
      }
      throw error
    }
  }

  throw mediaError(
    'FFMPEG_UNAVAILABLE',
    'ffmpeg is unavailable. Install it or bundle it in Resources/bin.',
    lastMissingError,
  )
}

function createOperation(registry, kind, requestedId, context, progressListener) {
  const operationId = resolveOperationId(requestedId)
  if (registry.has(operationId)) {
    throw mediaError('MEDIA_BUSY', 'A media operation with this ID is already active')
  }

  const operation = {
    operationId,
    kind,
    context,
    child: null,
    cancelled: false,
    lastProgress: -1,
    report(update) {
      if (typeof progressListener !== 'function') return
      const progress = Math.min(1, Math.max(0, Number(update.progress) || 0))
      // Keep IPC traffic bounded while still delivering stage changes and completion.
      if (
        update.phase === operation.lastPhase &&
        progress < 1 &&
        Math.abs(progress - operation.lastProgress) < 0.0025
      ) {
        return
      }
      operation.lastProgress = progress
      operation.lastPhase = update.phase
      progressListener({
        operationId,
        kind,
        ...context,
        ...update,
        progress,
      })
    },
    cancel() {
      operation.cancelled = true
      const child = operation.child
      if (child && !child.killed) {
        child.kill('SIGTERM')
        const timer = setTimeout(() => {
          if (child.exitCode == null && child.signalCode == null) {
            child.kill('SIGKILL')
          }
        }, 1500)
        timer.unref?.()
      }
    },
  }

  registry.set(operationId, operation)
  return operation
}

function chooseIndexFrameCount(durationSeconds) {
  const intervalSeconds = Math.max(
    1,
    Math.pow(durationSeconds / 10, 0.28),
  )
  return Math.min(
    MAX_INDEX_FRAME_COUNT,
    Math.max(
      MIN_INDEX_FRAME_COUNT,
      Math.round(durationSeconds / intervalSeconds),
    ),
  )
}

function createIndexScaleFilter() {
  return [
    `scale='min(${INDEX_MAX_EDGE},iw)'`,
    `'min(${INDEX_MAX_EDGE},ih)'`,
    'force_original_aspect_ratio=decrease',
    'force_divisible_by=2',
  ].join(':')
}

function createSceneChangeParser() {
  let pending = ''
  const candidates = []

  function parseLine(line) {
    if (!line.includes('showinfo')) return
    const match = line.match(
      /\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:\s*([-+\d.eE]+)/,
    )
    if (!match) return
    const index = Number(match[1])
    const timeSeconds = Number(match[3])
    if (!Number.isSafeInteger(index) || !Number.isFinite(timeSeconds)) return
    candidates.push({ index, pts: match[2], timeSeconds })
  }

  return {
    append(chunk) {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) parseLine(line)
    },
    finish() {
      if (pending) parseLine(pending)
      pending = ''
      return candidates
    },
  }
}

function selectEvenlyDistributed(items, limit) {
  if (limit <= 0 || items.length === 0) return []
  if (items.length <= limit) return [...items]
  if (limit === 1) return [items[Math.floor(items.length / 2)]]

  const selected = []
  for (let index = 0; index < limit; index += 1) {
    selected.push(
      items[Math.round((index * (items.length - 1)) / (limit - 1))],
    )
  }
  return selected
}

function chooseSceneChangeCandidates(
  candidates,
  durationSeconds,
  uniformFrameCount,
) {
  const availableCount = Math.max(
    0,
    MAX_INDEX_FRAME_COUNT - uniformFrameCount,
  )
  if (availableCount === 0 || candidates.length === 0) return []

  const uniformStep = durationSeconds / uniformFrameCount
  const duplicateRadius = Math.min(0.2, uniformStep * 0.2)
  const eligibleCandidates = candidates
    .filter((candidate) => {
      if (
        !Number.isSafeInteger(candidate?.index) ||
        candidate.index < 0 ||
        !Number.isFinite(candidate?.timeSeconds) ||
        candidate.timeSeconds < 0 ||
        candidate.timeSeconds > durationSeconds
      ) {
        return false
      }
      const nearestUniformIndex = Math.min(
        uniformFrameCount - 1,
        Math.max(0, Math.round(candidate.timeSeconds / uniformStep)),
      )
      const nearestUniformTime = nearestUniformIndex * uniformStep
      return Math.abs(candidate.timeSeconds - nearestUniformTime) > duplicateRadius
    })
    .sort(
      (first, second) =>
        first.timeSeconds - second.timeSeconds || first.index - second.index,
    )

  return selectEvenlyDistributed(eligibleCandidates, availableCount)
}

function createBalancedSceneSelectionExpression(candidates) {
  let expressions = candidates.map((candidate) => `eq(n,${candidate.index})`)
  if (expressions.length === 0) return '0'

  // FFmpeg's expression parser exhausts its recursive AST path once a flat
  // left-associated `a+b+c+...` chain grows past roughly 100 terms. Pairing
  // terms into a balanced tree preserves the exact selected frames while
  // keeping parser depth logarithmic, including the full 1200-frame budget.
  while (expressions.length > 1) {
    const nextLevel = []
    for (let index = 0; index < expressions.length; index += 2) {
      const left = expressions[index]
      const right = expressions[index + 1]
      nextLevel.push(right == null ? left : `(${left}+${right})`)
    }
    expressions = nextLevel
  }
  return expressions[0]
}

function mergeIndexFrameEntries(uniformFrames, sceneFrames) {
  const safeUniformFrames =
    uniformFrames.length <= MAX_INDEX_FRAME_COUNT
      ? [...uniformFrames]
      : selectEvenlyDistributed(uniformFrames, MAX_INDEX_FRAME_COUNT)
  const uniformSourceFrames = new Set(
    safeUniformFrames.map(
      (frame) => `${frame.timestamp.sourceTimeBase}:${frame.timestamp.sourcePts}`,
    ),
  )
  const uniqueSceneFrames = sceneFrames.filter(
    (frame) =>
      !uniformSourceFrames.has(
        `${frame.timestamp.sourceTimeBase}:${frame.timestamp.sourcePts}`,
      ),
  )
  const selectedSceneFrames = selectEvenlyDistributed(
    uniqueSceneFrames,
    MAX_INDEX_FRAME_COUNT - safeUniformFrames.length,
  )

  return [...safeUniformFrames, ...selectedSceneFrames].sort(
    (first, second) => {
      const timeDifference =
        first.timestamp.timeSeconds - second.timestamp.timeSeconds
      if (timeDifference !== 0) return timeDifference
      if (first.kind === second.kind) return 0
      return first.kind === 'uniform' ? -1 : 1
    },
  )
}

function mediaDirectoryHash(assetId) {
  return crypto.createHash('sha256').update(assetId).digest('hex').slice(0, 32)
}

function chooseMediaThumbnailTime(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.5) return 0
  const latestSafeTime = Math.max(0, durationSeconds - 0.25)
  return Math.min(
    latestSafeTime,
    Math.min(5, Math.max(0.5, durationSeconds * 0.1)),
  )
}

function mediaThumbnailFilename(sourcePath, sourceStat) {
  const revision = crypto
    .createHash('sha256')
    .update(sourcePath)
    .update('\0')
    .update(String(sourceStat.size))
    .update('\0')
    .update(sourceStat.mtime.toISOString())
    .digest('hex')
    .slice(0, 16)
  return `thumbnail-${revision}.jpg`
}

async function readReusableMediaThumbnail(
  targetDirectory,
  assetId,
  sourcePath,
  sourceStat,
) {
  try {
    const manifest = JSON.parse(
      await fs.promises.readFile(
        path.join(targetDirectory, 'manifest.json'),
        'utf8',
      ),
    )
    const thumbnailPath = path.join(
      targetDirectory,
      mediaThumbnailFilename(sourcePath, sourceStat),
    )
    if (
      manifest?.version !== MEDIA_THUMBNAIL_VERSION ||
      manifest?.assetId !== assetId ||
      manifest?.sourcePath !== sourcePath ||
      manifest?.sizeBytes !== sourceStat.size ||
      manifest?.modifiedAt !== sourceStat.mtime.toISOString() ||
      manifest?.thumbnailPath !== thumbnailPath
    ) {
      return null
    }
    const thumbnailStat = await fs.promises.stat(thumbnailPath)
    if (!thumbnailStat.isFile() || thumbnailStat.size <= 0) return null
    return {
      assetId: manifest.assetId,
      sourcePath,
      thumbnailPath,
      sizeBytes: sourceStat.size,
      modifiedAt: sourceStat.mtime.toISOString(),
      cached: true,
      createdAt: manifest.createdAt,
    }
  } catch {
    return null
  }
}

function requiresPreviewProxy(metadata) {
  const codec =
    typeof metadata?.codec === 'string' ? metadata.codec.toLowerCase() : ''
  const container =
    typeof metadata?.container === 'string'
      ? metadata.container.toLowerCase()
      : ''
  const extension =
    typeof metadata?.filePath === 'string'
      ? path.extname(metadata.filePath).toLowerCase()
      : ''

  // Codec support alone is not enough: Chromium cannot reliably seek/play
  // MXF, AVI or Matroska even when their video essence is H.264. Keep direct
  // playback intentionally conservative and fall back to the cached proxy for
  // every other imported container/codec combination.
  if (extension === '.webm') {
    return !DIRECT_WEBM_PLAYBACK_CODECS.has(codec)
  }
  if (new Set(['.m4v', '.mov', '.mp4']).has(extension)) {
    return !DIRECT_MP4_PLAYBACK_CODECS.has(codec)
  }
  if (container.split(',').some((name) => name.includes('webm'))) {
    return !DIRECT_WEBM_PLAYBACK_CODECS.has(codec)
  }
  return true
}

function createPreviewProxyArgs(sourcePath, destinationPath) {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-vf',
    "scale='trunc(min(1920,iw)/2)*2':-2",
    ...h264CodecArguments(20, { realtime: true }),
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-max_muxing_queue_size',
    '1024',
    '-fps_mode:v',
    'passthrough',
    '-progress',
    'pipe:1',
    '-nostats',
    destinationPath,
  ]
}

async function readReusablePreviewManifest(
  targetDirectory,
  assetId,
  sourcePath,
  metadata,
) {
  try {
    const manifest = JSON.parse(
      await fs.promises.readFile(
        path.join(targetDirectory, 'manifest.json'),
        'utf8',
      ),
    )
    const previewPath = path.join(targetDirectory, 'preview.mp4')
    if (
      manifest?.version !== PREVIEW_PROXY_VERSION ||
      manifest?.assetId !== assetId ||
      manifest?.sourcePath !== sourcePath ||
      manifest?.metadata?.sizeBytes !== metadata.sizeBytes ||
      manifest?.metadata?.modifiedAt !== metadata.modifiedAt ||
      manifest?.previewPath !== previewPath ||
      manifest?.playbackPath !== previewPath ||
      manifest?.usesPreviewProxy !== true
    ) {
      return null
    }
    const previewStat = await fs.promises.stat(previewPath)
    return previewStat.isFile() && previewStat.size > 0 ? manifest : null
  } catch {
    return null
  }
}

async function readReusableManifest(
  targetDirectory,
  sourcePath,
  metadata,
  previewRequired,
) {
  try {
    const manifestPath = path.join(targetDirectory, 'manifest.json')
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'))
    if (
      manifest?.version !== INDEX_VERSION ||
      manifest?.timestampMode !== INDEX_TIMESTAMP_MODE ||
      manifest?.sourcePath !== sourcePath ||
      manifest?.metadata?.sizeBytes !== metadata.sizeBytes ||
      manifest?.metadata?.modifiedAt !== metadata.modifiedAt ||
      manifest?.usesPreviewProxy !== previewRequired ||
      (previewRequired
        ? typeof manifest?.previewPath !== 'string' ||
          manifest?.playbackPath !== manifest.previewPath
        : manifest?.previewPath !== null ||
          manifest?.playbackPath !== sourcePath) ||
      !Array.isArray(manifest?.frames) ||
      manifest.frames.length === 0
    ) {
      return null
    }

    let previousTimeSeconds = -Infinity
    for (const frame of manifest.frames) {
      const timeSeconds = Number(frame?.timeSeconds)
      if (
        !Number.isFinite(timeSeconds) ||
        timeSeconds < 0 ||
        (metadata.durationSeconds != null &&
          timeSeconds > metadata.durationSeconds + 1e-6) ||
        timeSeconds < previousTimeSeconds
      ) {
        return null
      }
      previousTimeSeconds = timeSeconds
    }

    const requiredFiles = [
      manifest.posterPath,
      ...(previewRequired ? [manifest.previewPath] : []),
      ...manifest.frames.map((frame) => frame?.imagePath),
    ]
    if (
      requiredFiles.some(
        (filePath) =>
          typeof filePath !== 'string' ||
          !path.isAbsolute(filePath) ||
          !fs.existsSync(filePath),
      )
    ) {
      return null
    }
    return manifest
  } catch {
    return null
  }
}

async function atomicReplaceDirectory(tempDirectory, targetDirectory) {
  const backupDirectory = `${targetDirectory}.aurora-backup-${crypto.randomUUID()}`
  let movedExistingDirectory = false
  try {
    try {
      await fs.promises.rename(targetDirectory, backupDirectory)
      movedExistingDirectory = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await fs.promises.rename(tempDirectory, targetDirectory)
    if (movedExistingDirectory) {
      await fs.promises.rm(backupDirectory, { recursive: true, force: true })
    }
  } catch (error) {
    if (movedExistingDirectory) {
      try {
        await fs.promises.rename(backupDirectory, targetDirectory)
      } catch {
        // Leave the backup in place for recovery and preserve the original failure.
      }
    }
    throw error
  }
}

async function removeOutdatedIndexDirectories(indexRoot, currentDirectory) {
  let entries
  try {
    entries = await fs.promises.readdir(indexRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }

  const currentName = path.basename(currentDirectory)
  await Promise.allSettled(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^v\d+$/.test(entry.name) &&
          entry.name !== currentName,
      )
      .map((entry) =>
        fs.promises.rm(path.join(indexRoot, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  )
}

function extensionForStill(destinationPath) {
  const extension = path.extname(destinationPath).toLowerCase()
  const supported = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'])
  if (!supported.has(extension)) {
    throw mediaError(
      'MEDIA_INVALID_INPUT',
      'Still images must use JPEG, PNG, WebP, or TIFF',
    )
  }
  return extension
}

function usesBundledMacArm64MediaTools() {
  return process.platform === 'darwin' && process.arch === 'arm64'
}

function videotoolboxQuality(crf, defaultCrf) {
  const normalizedCrf = Math.min(51, Math.max(0, crf ?? defaultCrf))
  // Aurora's public API remains CRF-like (0 is best), while VideoToolbox's
  // qscale is 1-100 (100 is best). Keep the UI contract and invert the scale.
  return String(
    Math.max(1, Math.min(100, Math.round(100 - (normalizedCrf * 99) / 51))),
  )
}

function h264CodecArguments(quality, options = {}) {
  if (usesBundledMacArm64MediaTools()) {
    return [
      '-c:v',
      'h264_videotoolbox',
      // Prefer Apple Silicon's hardware encoder and permit VideoToolbox's
      // software path if a particular session cannot be created in hardware.
      '-allow_sw',
      '1',
      ...(options.realtime ? ['-realtime', '1'] : []),
      '-q:v',
      videotoolboxQuality(quality, 18),
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
    ]
  }

  // Preserve the existing system-FFmpeg behavior on non-bundled platforms.
  return [
    '-c:v',
    'libx264',
    '-preset',
    options.realtime ? 'veryfast' : 'medium',
    '-crf',
    String(quality ?? 18),
    '-pix_fmt',
    'yuv420p',
  ]
}

function hevcCodecArguments(quality, destinationPath) {
  if (usesBundledMacArm64MediaTools()) {
    const extension = path.extname(destinationPath ?? '').toLowerCase()
    return [
      '-c:v',
      'hevc_videotoolbox',
      '-allow_sw',
      '1',
      '-q:v',
      videotoolboxQuality(quality, 20),
      '-pix_fmt',
      'yuv420p',
      ...(new Set(['.m4v', '.mov', '.mp4']).has(extension)
        ? ['-tag:v', 'hvc1']
        : []),
    ]
  }

  return [
    '-c:v',
    'libx265',
    '-preset',
    'medium',
    '-crf',
    String(quality ?? 20),
  ]
}

function videoCodecArguments(codec, quality, destinationPath) {
  switch (codec ?? 'h264') {
    case 'copy':
      return ['-c:v', 'copy']
    case 'h264':
      return h264CodecArguments(quality)
    case 'hevc':
      return hevcCodecArguments(quality, destinationPath)
    case 'prores':
    case 'prores422hq':
      return [
        '-c:v',
        'prores_ks',
        '-profile:v',
        '3',
        '-pix_fmt',
        'yuv422p10le',
      ]
    case 'prores4444':
      return [
        '-c:v',
        'prores_ks',
        '-profile:v',
        '4',
        '-pix_fmt',
        'yuva444p10le',
      ]
    default:
      throw mediaError('MEDIA_INVALID_INPUT', 'Unsupported video codec')
  }
}

function audioCodecArguments(codec) {
  switch (codec ?? 'aac') {
    case 'none':
      return ['-an']
    case 'copy':
      return ['-c:a', 'copy']
    case 'aac':
      return ['-c:a', 'aac', '-b:a', '192k']
    default:
      throw mediaError('MEDIA_INVALID_INPUT', 'Unsupported audio codec')
  }
}

function videoFilterArguments(request, options = {}) {
  const width = optionalPositiveInteger(request.width, 'Export width')
  const height = optionalPositiveInteger(request.height, 'Export height')
  const fps =
    request.fps == null ? null : finiteNumber(request.fps, 'Export frame rate', 0.01)
  const filters = []
  const evenWidth =
    options.ensureEvenDimensions && width ? Math.max(2, width - (width % 2)) : width
  const evenHeight =
    options.ensureEvenDimensions && height
      ? Math.max(2, height - (height % 2))
      : height

  if (evenWidth || evenHeight) {
    filters.push(`scale=${evenWidth ?? -2}:${evenHeight ?? -2}`)
  } else if (options.ensureEvenDimensions) {
    filters.push("scale='trunc(iw/2)*2':'trunc(ih/2)*2'")
  }
  if (fps) filters.push(`fps=${fps}`)
  return filters.length > 0 ? ['-vf', filters.join(',')] : []
}

function encodeMediaPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null
  const normalizedPath = path.resolve(filePath.trim())
  return `${MEDIA_URL_SCHEME}://file/${Buffer.from(
    normalizedPath,
    'utf8',
  ).toString('base64url')}`
}

function decodeMediaUrl(inputUrl) {
  try {
    const parsed = new URL(inputUrl)
    if (parsed.protocol !== `${MEDIA_URL_SCHEME}:` || parsed.hostname !== 'file') {
      return null
    }
    const encodedPath = parsed.pathname.replace(/^\/+/, '')
    if (!/^[A-Za-z0-9_-]+$/.test(encodedPath)) return null
    const decodedPath = Buffer.from(encodedPath, 'base64url').toString('utf8')
    if (!decodedPath || decodedPath.includes('\0') || !path.isAbsolute(decodedPath)) {
      return null
    }
    return path.normalize(decodedPath)
  } catch {
    return null
  }
}

function createMediaPipeline({ userDataPath, onProgress }) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('An absolute userData path is required')
  }

  const registry = new Map()
  const indexLocks = new Set()
  const previewTasks = new Map()
  const thumbnailTasks = new Map()
  let activeThumbnailTasks = 0
  const thumbnailWaiters = []

  function releaseThumbnailSlot() {
    activeThumbnailTasks = Math.max(0, activeThumbnailTasks - 1)
    while (
      activeThumbnailTasks < MAX_CONCURRENT_MEDIA_THUMBNAILS &&
      thumbnailWaiters.length > 0
    ) {
      const waiter = thumbnailWaiters.shift()
      if (waiter.operation.cancelled) {
        waiter.reject(
          mediaError(
            'MEDIA_CANCELLED',
            'The media thumbnail operation was cancelled',
          ),
        )
        continue
      }
      activeThumbnailTasks += 1
      waiter.resolve()
    }
  }

  async function withThumbnailSlot(operation, task) {
    if (activeThumbnailTasks >= MAX_CONCURRENT_MEDIA_THUMBNAILS) {
      await new Promise((resolve, reject) => {
        thumbnailWaiters.push({ operation, resolve, reject })
      })
    } else {
      activeThumbnailTasks += 1
    }
    if (operation.cancelled) {
      releaseThumbnailSlot()
      throw mediaError(
        'MEDIA_CANCELLED',
        'The media thumbnail operation was cancelled',
      )
    }
    try {
      return await task()
    } finally {
      releaseThumbnailSlot()
    }
  }

  async function withOperation(kind, request, context, task) {
    const operation = createOperation(
      registry,
      kind,
      request?.operationId,
      context,
      onProgress,
    )
    try {
      return await task(operation)
    } finally {
      registry.delete(operation.operationId)
    }
  }

  async function createMediaThumbnail(request) {
    const assetId = validateAssetId(request?.assetId)
    const { filePath: sourcePath, stat: sourceStat } =
      await validateMediaFilePath(request?.sourcePath)
    const durationSeconds =
      request?.durationSeconds == null
        ? null
        : finiteNumber(
            request.durationSeconds,
            'Media thumbnail duration',
          )
    const targetDirectory = path.join(
      userDataPath,
      'media',
      mediaDirectoryHash(assetId),
      'thumbnail',
      `v${MEDIA_THUMBNAIL_VERSION}`,
    )
    const runningTask = thumbnailTasks.get(targetDirectory)
    if (runningTask) return runningTask

    const task = withOperation(
      'media-thumbnail',
      request,
      { assetId, sourcePath },
      async (operation) => {
        if (!request?.rebuild) {
          const reusable = await readReusableMediaThumbnail(
            targetDirectory,
            assetId,
            sourcePath,
            sourceStat,
          )
          if (reusable) {
            operation.report({
              phase: 'complete',
              progress: 1,
              processedSeconds: durationSeconds,
              totalSeconds: durationSeconds,
            })
            return reusable
          }
        }

        return withThumbnailSlot(operation, async () => {
          const tempDirectory = `${targetDirectory}.tmp-${operation.operationId}`
          const thumbnailFilename = mediaThumbnailFilename(
            sourcePath,
            sourceStat,
          )
          const tempThumbnailPath = path.join(
            tempDirectory,
            thumbnailFilename,
          )
          const thumbnailPath = path.join(
            targetDirectory,
            thumbnailFilename,
          )
          await fs.promises.rm(tempDirectory, { recursive: true, force: true })
          await fs.promises.mkdir(tempDirectory, { recursive: true })

          const createThumbnailArgs = (sampleTimeSeconds) => [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            ...(sampleTimeSeconds > 0
              ? ['-ss', sampleTimeSeconds.toFixed(6)]
              : []),
            '-i',
            sourcePath,
            '-map',
            '0:v:0',
            '-an',
            '-vf',
            [
              `thumbnail=${MEDIA_THUMBNAIL_SAMPLE_FRAMES}`,
              `scale='min(${MEDIA_THUMBNAIL_MAX_WIDTH},iw)':-2`,
            ].join(','),
            '-frames:v',
            '1',
            '-q:v',
            '3',
            '-fps_mode:v',
            'vfr',
            '-progress',
            'pipe:1',
            '-nostats',
            tempThumbnailPath,
          ]

          try {
            const sampleTimeSeconds = chooseMediaThumbnailTime(
              durationSeconds,
            )
            try {
              await runSpawnedFfmpeg(
                createThumbnailArgs(sampleTimeSeconds),
                operation,
                {
                  durationSeconds,
                  phase: 'extracting-thumbnail',
                  progressStart: 0.05,
                  progressEnd: 0.9,
                },
              )
            } catch (error) {
              if (operation.cancelled || sampleTimeSeconds === 0) throw error
              await fs.promises.rm(tempThumbnailPath, { force: true })
              await runSpawnedFfmpeg(createThumbnailArgs(0), operation, {
                durationSeconds,
                phase: 'extracting-thumbnail',
                progressStart: 0.05,
                progressEnd: 0.9,
              })
            }
            if (operation.cancelled) {
              throw mediaError(
                'MEDIA_CANCELLED',
                'The media thumbnail operation was cancelled',
              )
            }

            const thumbnailStat = await fs.promises.stat(tempThumbnailPath)
            if (!thumbnailStat.isFile() || thumbnailStat.size <= 0) {
              throw mediaError(
                'MEDIA_THUMBNAIL_EMPTY',
                'ffmpeg did not produce a media thumbnail',
              )
            }

            const createdAt = new Date().toISOString()
            await fs.promises.writeFile(
              path.join(tempDirectory, 'manifest.json'),
              JSON.stringify(
                {
                  version: MEDIA_THUMBNAIL_VERSION,
                  assetId,
                  sourcePath,
                  sizeBytes: sourceStat.size,
                  modifiedAt: sourceStat.mtime.toISOString(),
                  thumbnailPath,
                  createdAt,
                },
                null,
                2,
              ),
              'utf8',
            )
            operation.report({
              phase: 'finalizing',
              progress: 0.94,
              processedSeconds: durationSeconds,
              totalSeconds: durationSeconds,
            })
            await atomicReplaceDirectory(tempDirectory, targetDirectory)
            operation.report({
              phase: 'complete',
              progress: 1,
              processedSeconds: durationSeconds,
              totalSeconds: durationSeconds,
            })
            return {
              assetId,
              sourcePath,
              thumbnailPath,
              sizeBytes: sourceStat.size,
              modifiedAt: sourceStat.mtime.toISOString(),
              cached: false,
              createdAt,
            }
          } catch (error) {
            await fs.promises.rm(tempDirectory, {
              recursive: true,
              force: true,
            })
            throw error
          }
        })
      },
    )
    thumbnailTasks.set(targetDirectory, task)
    try {
      return await task
    } finally {
      if (thumbnailTasks.get(targetDirectory) === task) {
        thumbnailTasks.delete(targetDirectory)
      }
    }
  }

  async function ensureMediaPreview(request) {
    const assetId = validateAssetId(request?.assetId)
    const { filePath: sourcePath } =
      await validateMediaFilePath(request?.sourcePath)
    const targetDirectory = path.join(
      userDataPath,
      'media',
      mediaDirectoryHash(assetId),
      'preview',
      `v${PREVIEW_PROXY_VERSION}`,
    )
    const runningTask = previewTasks.get(targetDirectory)
    if (runningTask) return runningTask

    const task = withOperation(
      'preview-proxy',
      request,
      { assetId, sourcePath },
      async (operation) => {
        const metadata = await inspectMediaFile(sourcePath)
        if (
          metadata.durationSeconds == null ||
          metadata.durationSeconds <= 0 ||
          metadata.width == null ||
          metadata.height == null
        ) {
          throw mediaError(
            'MEDIA_UNSUPPORTED',
            'The selected file does not contain a supported video stream',
          )
        }

        operation.report({
          phase: 'probing',
          progress: 0.04,
          processedSeconds: 0,
          totalSeconds: metadata.durationSeconds,
        })

        if (!request?.rebuild) {
          const reusable = await readReusablePreviewManifest(
            targetDirectory,
            assetId,
            sourcePath,
            metadata,
          )
          if (reusable) {
            operation.report({
              phase: 'complete',
              progress: 1,
              processedSeconds: metadata.durationSeconds,
              totalSeconds: metadata.durationSeconds,
            })
            return {
              ...reusable,
              operationId: operation.operationId,
              cached: true,
            }
          }
        }

        if (!request?.forceProxy && !requiresPreviewProxy(metadata)) {
          operation.report({
            phase: 'complete',
            progress: 1,
            processedSeconds: metadata.durationSeconds,
            totalSeconds: metadata.durationSeconds,
          })
          return {
            version: PREVIEW_PROXY_VERSION,
            assetId,
            sourcePath,
            previewPath: null,
            playbackPath: sourcePath,
            usesPreviewProxy: false,
            metadata,
            createdAt: new Date().toISOString(),
            operationId: operation.operationId,
            cached: true,
          }
        }

        const tempDirectory = `${targetDirectory}.tmp-${operation.operationId}`
        const tempPreviewPath = path.join(tempDirectory, 'preview.mp4')
        const previewPath = path.join(targetDirectory, 'preview.mp4')
        await fs.promises.rm(tempDirectory, { recursive: true, force: true })
        await fs.promises.mkdir(tempDirectory, { recursive: true })

        try {
          await runSpawnedFfmpeg(
            createPreviewProxyArgs(sourcePath, tempPreviewPath),
            operation,
            {
              durationSeconds: metadata.durationSeconds,
              phase: 'transcoding-preview',
              progressStart: 0.05,
              progressEnd: 0.94,
            },
          )
          if (operation.cancelled) {
            throw mediaError(
              'MEDIA_CANCELLED',
              'The media preview operation was cancelled',
            )
          }

          const previewStat = await fs.promises.stat(tempPreviewPath)
          if (!previewStat.isFile() || previewStat.size <= 0) {
            throw mediaError(
              'MEDIA_PREVIEW_EMPTY',
              'ffmpeg did not produce a media preview',
            )
          }

          const manifest = {
            version: PREVIEW_PROXY_VERSION,
            assetId,
            sourcePath,
            previewPath,
            playbackPath: previewPath,
            usesPreviewProxy: true,
            metadata,
            createdAt: new Date().toISOString(),
          }
          operation.report({
            phase: 'finalizing',
            progress: 0.96,
            processedSeconds: metadata.durationSeconds,
            totalSeconds: metadata.durationSeconds,
          })
          await fs.promises.writeFile(
            path.join(tempDirectory, 'manifest.json'),
            JSON.stringify(manifest, null, 2),
            'utf8',
          )
          await fs.promises.mkdir(path.dirname(targetDirectory), {
            recursive: true,
          })
          await atomicReplaceDirectory(tempDirectory, targetDirectory)
          operation.report({
            phase: 'complete',
            progress: 1,
            processedSeconds: metadata.durationSeconds,
            totalSeconds: metadata.durationSeconds,
          })
          return {
            ...manifest,
            operationId: operation.operationId,
            cached: false,
          }
        } catch (error) {
          await fs.promises.rm(tempDirectory, {
            recursive: true,
            force: true,
          })
          throw error
        }
      },
    )
    previewTasks.set(targetDirectory, task)
    try {
      return await task
    } finally {
      if (previewTasks.get(targetDirectory) === task) {
        previewTasks.delete(targetDirectory)
      }
    }
  }

  async function buildVisualIndex(request) {
    const assetId = validateAssetId(request?.assetId)
    const { filePath: sourcePath } = await validateMediaFilePath(request?.sourcePath)
    const hash = mediaDirectoryHash(assetId)
    const indexRoot = path.join(userDataPath, 'media', hash, 'index')
    const targetDirectory = path.join(
      indexRoot,
      `v${INDEX_VERSION}`,
    )

    if (indexLocks.has(targetDirectory)) {
      throw mediaError('MEDIA_BUSY', 'This visual index is already being generated')
    }
    indexLocks.add(targetDirectory)

    try {
      return await withOperation(
        'visual-index',
        request,
        { assetId },
        async (operation) => {
          const metadata = await inspectMediaFile(sourcePath)
          if (
            metadata.durationSeconds == null ||
            metadata.durationSeconds <= 0 ||
            metadata.width == null ||
            metadata.height == null
          ) {
            throw mediaError(
              'MEDIA_UNSUPPORTED',
              'The selected file does not contain a supported video stream',
            )
          }

          operation.report({
            phase: 'probing',
            progress: 0.04,
            processedSeconds: 0,
            totalSeconds: metadata.durationSeconds,
          })
          const previewRequired = requiresPreviewProxy(metadata)

          if (!request?.rebuild) {
            const reusable = await readReusableManifest(
              targetDirectory,
              sourcePath,
              metadata,
              previewRequired,
            )
            if (reusable) {
              operation.report({
                phase: 'complete',
                progress: 1,
                processedSeconds: metadata.durationSeconds,
                totalSeconds: metadata.durationSeconds,
              })
              return {
                ...reusable,
                operationId: operation.operationId,
                cached: true,
              }
            }
          }

          const tempDirectory = `${targetDirectory}.tmp-${operation.operationId}`
          await fs.promises.rm(tempDirectory, { recursive: true, force: true })
          await fs.promises.mkdir(tempDirectory, { recursive: true })

          try {
            const targetFrameCount = chooseIndexFrameCount(metadata.durationSeconds)
            const uniformDirectory = path.join(tempDirectory, 'uniform')
            const sceneDirectory = path.join(tempDirectory, 'scenes')
            await fs.promises.mkdir(uniformDirectory)
            const uniformOutputPattern = path.join(
              uniformDirectory,
              'frame-%06d.jpg',
            )
            const uniformStatsPath = path.join(uniformDirectory, 'frame-map.txt')
            const samplingRate = targetFrameCount / metadata.durationSeconds
            const frameProgressEnd = previewRequired ? 0.52 : 0.94
            const shouldDetectScenes = targetFrameCount < MAX_INDEX_FRAME_COUNT
            const uniformProgressEnd = shouldDetectScenes
              ? previewRequired
                ? 0.36
                : 0.68
              : frameProgressEnd
            const uniformFilter = [
              `fps=${samplingRate}`,
              createIndexScaleFilter(),
            ].join(',')
            const sceneChangeParser = createSceneChangeParser()
            const commonUniformOutputArgs = [
              '-map',
              '0:v:0',
              '-an',
              '-vf',
              uniformFilter,
              '-frames:v',
              String(targetFrameCount),
              '-q:v',
              String(INDEX_JPEG_QUALITY),
              '-start_number',
              '0',
              '-stats_enc_pre:v:0',
              uniformStatsPath,
              '-stats_enc_pre_fmt:v:0',
              FRAME_STATS_FORMAT,
              '-fps_mode:v',
              'passthrough',
              uniformOutputPattern,
            ]
            const uniformArgs = [
              '-hide_banner',
              '-loglevel',
              shouldDetectScenes ? 'info' : 'error',
              '-y',
              '-i',
              sourcePath,
              ...commonUniformOutputArgs,
              ...(shouldDetectScenes
                ? [
                    '-map',
                    '0:v:0',
                    '-an',
                    '-vf',
                    `select='isnan(prev_selected_t)+gt(scene,${INDEX_SCENE_CHANGE_THRESHOLD})',showinfo`,
                    '-f',
                    'null',
                    '-',
                  ]
                : []),
              '-progress',
              'pipe:1',
              '-nostats',
            ]
            await runSpawnedFfmpeg(uniformArgs, operation, {
              durationSeconds: metadata.durationSeconds,
              phase: 'extracting',
              progressStart: 0.05,
              progressEnd: uniformProgressEnd,
              onStderr: shouldDetectScenes
                ? (chunk) => sceneChangeParser.append(chunk)
                : null,
            })
            if (operation.cancelled) {
              throw mediaError('MEDIA_CANCELLED', 'The media operation was cancelled')
            }

            const uniformFrameNames = (
              await fs.promises.readdir(uniformDirectory)
            )
              .filter((name) => /^frame-\d{6}\.jpg$/.test(name))
              .sort()
            if (uniformFrameNames.length === 0) {
              throw mediaError(
                'MEDIA_INDEX_EMPTY',
                'ffmpeg did not produce any index frames',
              )
            }

            const uniformTimestampStats = await readFrameTimestampStats(
              uniformStatsPath,
              uniformFrameNames,
              metadata.durationSeconds,
            )
            if (operation.cancelled) {
              throw mediaError('MEDIA_CANCELLED', 'The media operation was cancelled')
            }
            await fs.promises.rm(uniformStatsPath, { force: true })

            const uniformFrameEntries = uniformFrameNames.map((name, index) => ({
              kind: 'uniform',
              tempImagePath: path.join(uniformDirectory, name),
              timestamp: uniformTimestampStats[index],
            }))
            const sceneCandidates = shouldDetectScenes
              ? chooseSceneChangeCandidates(
                  sceneChangeParser.finish().slice(1),
                  metadata.durationSeconds,
                  targetFrameCount,
                )
              : []
            let sceneFrameEntries = []

            if (sceneCandidates.length > 0) {
              await fs.promises.mkdir(sceneDirectory)
              const sceneOutputPattern = path.join(
                sceneDirectory,
                'frame-%06d.jpg',
              )
              const sceneStatsPath = path.join(sceneDirectory, 'frame-map.txt')
              const selectedSceneExpression =
                createBalancedSceneSelectionExpression(sceneCandidates)
              const sceneFilter = [
                `select='isnan(prev_selected_t)+gt(scene,${INDEX_SCENE_CHANGE_THRESHOLD})'`,
                `select='${selectedSceneExpression}'`,
                createIndexScaleFilter(),
              ].join(',')
              const sceneArgs = [
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-i',
                sourcePath,
                '-map',
                '0:v:0',
                '-an',
                '-vf',
                sceneFilter,
                '-frames:v',
                String(sceneCandidates.length),
                '-q:v',
                String(INDEX_JPEG_QUALITY),
                '-start_number',
                '0',
                '-stats_enc_pre:v:0',
                sceneStatsPath,
                '-stats_enc_pre_fmt:v:0',
                FRAME_STATS_FORMAT,
                '-fps_mode:v',
                'passthrough',
                '-progress',
                'pipe:1',
                '-nostats',
                sceneOutputPattern,
              ]
              await runSpawnedFfmpeg(sceneArgs, operation, {
                durationSeconds: metadata.durationSeconds,
                phase: 'extracting-scenes',
                progressStart: uniformProgressEnd,
                progressEnd: frameProgressEnd,
              })
              if (operation.cancelled) {
                throw mediaError(
                  'MEDIA_CANCELLED',
                  'The media operation was cancelled',
                )
              }

              const sceneFrameNames = (
                await fs.promises.readdir(sceneDirectory)
              )
                .filter((name) => /^frame-\d{6}\.jpg$/.test(name))
                .sort()
              if (sceneFrameNames.length !== sceneCandidates.length) {
                throw mediaError(
                  'MEDIA_INDEX_SCENES_INVALID',
                  'ffmpeg did not reproduce the selected scene-change frames',
                )
              }
              const sceneTimestampStats = await readFrameTimestampStats(
                sceneStatsPath,
                sceneFrameNames,
                metadata.durationSeconds,
              )
              await fs.promises.rm(sceneStatsPath, { force: true })
              sceneFrameEntries = sceneFrameNames.map((name, index) => ({
                kind: 'scene',
                tempImagePath: path.join(sceneDirectory, name),
                timestamp: sceneTimestampStats[index],
              }))
            }

            const mergedFrameEntries = mergeIndexFrameEntries(
              uniformFrameEntries,
              sceneFrameEntries,
            )
            const frameNames = mergedFrameEntries.map(
              (_entry, index) =>
                `frame-${String(index).padStart(6, '0')}.jpg`,
            )
            await Promise.all(
              mergedFrameEntries.map((entry, index) =>
                fs.promises.rename(
                  entry.tempImagePath,
                  path.join(tempDirectory, frameNames[index]),
                ),
              ),
            )
            await fs.promises.rm(uniformDirectory, {
              recursive: true,
              force: true,
            })
            await fs.promises.rm(sceneDirectory, {
              recursive: true,
              force: true,
            })

            const frames = frameNames.map((name, index) => {
              const timestamp = mergedFrameEntries[index].timestamp
              return {
                id: `${assetId}:frame:${index}`,
                index,
                timeSeconds: timestamp.timeSeconds,
                sampleTimeSeconds: timestamp.sampleTimeSeconds,
                sourceFrameIndex: timestamp.sourceFrameIndex,
                sourcePts: timestamp.sourcePts,
                sourceTimeBase: timestamp.sourceTimeBase,
                imagePath: path.join(targetDirectory, name),
              }
            })
            const posterPath = frames[Math.floor(frames.length / 2)].imagePath
            const previewPath = previewRequired
              ? path.join(targetDirectory, 'preview.mp4')
              : null

            if (previewRequired) {
              const tempPreviewPath = path.join(tempDirectory, 'preview.mp4')
              await runSpawnedFfmpeg(
                createPreviewProxyArgs(sourcePath, tempPreviewPath),
                operation,
                {
                  durationSeconds: metadata.durationSeconds,
                  phase: 'transcoding-preview',
                  progressStart: frameProgressEnd,
                  progressEnd: 0.94,
                },
              )
              if (operation.cancelled) {
                throw mediaError(
                  'MEDIA_CANCELLED',
                  'The media operation was cancelled',
                )
              }
            }

            const manifest = {
              version: INDEX_VERSION,
              timestampMode: INDEX_TIMESTAMP_MODE,
              assetId,
              sourcePath,
              posterPath,
              previewPath,
              playbackPath: previewPath ?? sourcePath,
              usesPreviewProxy: previewRequired,
              frames,
              metadata,
              createdAt: new Date().toISOString(),
            }

            operation.report({
              phase: 'finalizing',
              progress: 0.96,
              processedSeconds: metadata.durationSeconds,
              totalSeconds: metadata.durationSeconds,
            })
            await fs.promises.writeFile(
              path.join(tempDirectory, 'manifest.json'),
              JSON.stringify(manifest, null, 2),
              'utf8',
            )
            if (operation.cancelled) {
              throw mediaError('MEDIA_CANCELLED', 'The media operation was cancelled')
            }
            await fs.promises.mkdir(path.dirname(targetDirectory), {
              recursive: true,
            })
            await atomicReplaceDirectory(tempDirectory, targetDirectory)
            await removeOutdatedIndexDirectories(indexRoot, targetDirectory)
            operation.report({
              phase: 'complete',
              progress: 1,
              processedSeconds: metadata.durationSeconds,
              totalSeconds: metadata.durationSeconds,
            })
            return {
              ...manifest,
              operationId: operation.operationId,
              cached: false,
            }
          } catch (error) {
            await fs.promises.rm(tempDirectory, {
              recursive: true,
              force: true,
            })
            throw error
          }
        },
      )
    } finally {
      indexLocks.delete(targetDirectory)
    }
  }

  async function exportStill(request) {
    const { filePath: sourcePath } = await validateMediaFilePath(
      request?.sourcePath,
    )
    const destinationPath = await validateDestinationPath(
      request?.destinationPath,
      sourcePath,
    )
    const extension = extensionForStill(destinationPath)
    const timeSeconds = finiteNumber(
      request?.timeSeconds ?? 0,
      'Still time',
    )
    const metadata = await inspectMediaFile(sourcePath)
    if (
      metadata.durationSeconds != null &&
      timeSeconds > metadata.durationSeconds
    ) {
      throw mediaError('MEDIA_INVALID_INPUT', 'Still time exceeds media duration')
    }

    return withOperation(
      'still-export',
      request,
      { sourcePath, destinationPath },
      async (operation) => {
        const tempPath = temporaryOutputPath(
          destinationPath,
          operation.operationId,
        )
        await fs.promises.rm(tempPath, { force: true })
        operation.report({
          phase: 'exporting',
          progress: 0,
          processedSeconds: 0,
          totalSeconds: null,
        })

        try {
          const quality = Math.min(
            100,
            Math.max(1, Number(request?.quality) || 92),
          )
          const args = [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-ss',
            String(timeSeconds),
            '-i',
            sourcePath,
            '-map',
            '0:v:0',
            '-frames:v',
            '1',
            ...videoFilterArguments(request ?? {}),
          ]
          if (extension === '.jpg' || extension === '.jpeg') {
            args.push('-q:v', String(Math.round(31 - (quality / 100) * 29)))
          }
          args.push('-progress', 'pipe:1', '-nostats', tempPath)
          await runSpawnedFfmpeg(args, operation, {
            phase: 'exporting',
            progressStart: 0,
            progressEnd: 0.95,
          })
          if (operation.cancelled) {
            throw mediaError('MEDIA_CANCELLED', 'The media operation was cancelled')
          }
          await atomicReplace(tempPath, destinationPath)
          const stat = await fs.promises.stat(destinationPath)
          operation.report({
            phase: 'complete',
            progress: 1,
            processedSeconds: null,
            totalSeconds: null,
          })
          return {
            operationId: operation.operationId,
            destinationPath,
            sizeBytes: stat.size,
          }
        } catch (error) {
          await fs.promises.rm(tempPath, { force: true })
          throw error
        }
      },
    )
  }

  async function exportClip(request) {
    const { filePath: sourcePath } = await validateMediaFilePath(
      request?.sourcePath,
    )
    const destinationPath = await validateDestinationPath(
      request?.destinationPath,
      sourcePath,
    )
    if (!path.extname(destinationPath)) {
      throw mediaError('MEDIA_INVALID_INPUT', 'The clip destination needs a file extension')
    }
    const startSeconds = finiteNumber(request?.startSeconds, 'Clip start')
    const endSeconds = finiteNumber(request?.endSeconds, 'Clip end')
    if (endSeconds <= startSeconds) {
      throw mediaError('MEDIA_INVALID_INPUT', 'Clip end must be after clip start')
    }
    const clipDuration = endSeconds - startSeconds
    const metadata = await inspectMediaFile(sourcePath)
    if (
      metadata.durationSeconds != null &&
      endSeconds > metadata.durationSeconds + 0.001
    ) {
      throw mediaError('MEDIA_INVALID_INPUT', 'Clip end exceeds media duration')
    }

    return withOperation(
      'clip-export',
      request,
      { sourcePath, destinationPath },
      async (operation) => {
        const tempPath = temporaryOutputPath(
          destinationPath,
          operation.operationId,
        )
        await fs.promises.rm(tempPath, { force: true })
        operation.report({
          phase: 'exporting',
          progress: 0,
          processedSeconds: 0,
          totalSeconds: clipDuration,
        })

        try {
          const videoCodec = request?.videoCodec ?? 'h264'
          if (
            videoCodec === 'copy' &&
            (request?.width != null ||
              request?.height != null ||
              request?.fps != null)
          ) {
            throw mediaError(
              'MEDIA_INVALID_INPUT',
              'Copy exports cannot change resolution or frame rate',
            )
          }
          const quality =
            request?.quality == null
              ? null
              : Math.min(
                  51,
                  Math.max(0, Math.round(finiteNumber(request.quality, 'Quality'))),
                )
          const args = [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-ss',
            String(startSeconds),
            '-i',
            sourcePath,
            '-t',
            String(clipDuration),
            '-map',
            '0:v:0',
            '-map',
            '0:a?',
            ...videoCodecArguments(videoCodec, quality, tempPath),
            ...audioCodecArguments(request?.audioCodec),
            ...videoFilterArguments(request ?? {}, {
              ensureEvenDimensions:
                videoCodec === 'h264' || videoCodec === 'hevc',
            }),
            '-progress',
            'pipe:1',
            '-nostats',
            tempPath,
          ]
          await runSpawnedFfmpeg(args, operation, {
            durationSeconds: clipDuration,
            phase: 'exporting',
            progressStart: 0,
            progressEnd: 0.97,
          })
          if (operation.cancelled) {
            throw mediaError('MEDIA_CANCELLED', 'The media operation was cancelled')
          }
          await atomicReplace(tempPath, destinationPath)
          const stat = await fs.promises.stat(destinationPath)
          operation.report({
            phase: 'complete',
            progress: 1,
            processedSeconds: clipDuration,
            totalSeconds: clipDuration,
          })
          return {
            operationId: operation.operationId,
            destinationPath,
            sizeBytes: stat.size,
            durationSeconds: clipDuration,
          }
        } catch (error) {
          await fs.promises.rm(tempPath, { force: true })
          throw error
        }
      },
    )
  }

  function cancelOperation(input) {
    const operationId =
      typeof input === 'string' ? input : input?.operationId
    validateOperationId(operationId)
    const operation = registry.get(operationId)
    if (!operation) return false
    operation.cancel()
    return true
  }

  function cancelAll() {
    for (const operation of registry.values()) operation.cancel()
  }

  return {
    buildVisualIndex,
    cancelAll,
    cancelOperation,
    createMediaThumbnail,
    ensureMediaPreview,
    exportClip,
    exportStill,
  }
}

module.exports = {
  __test: {
    INDEX_JPEG_QUALITY,
    INDEX_MAX_EDGE,
    MAX_INDEX_FRAME_COUNT,
    chooseIndexFrameCount,
    chooseSceneChangeCandidates,
    createBalancedSceneSelectionExpression,
    createIndexScaleFilter,
    createSceneChangeParser,
    mergeIndexFrameEntries,
  },
  MEDIA_URL_SCHEME,
  createMediaPipeline,
  decodeMediaUrl,
  encodeMediaPath,
}
