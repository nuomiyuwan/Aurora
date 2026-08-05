const { execFile } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const {
  mediaToolCandidates,
  validateMediaFilePath,
} = require('./mediaProbe.cjs')

const execFileAsync = promisify(execFile)

const MANAGED_DIRECTORY_NAME = 'appearance-assets'
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])
const MAX_PNG_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_PNG_DIMENSION = 1024
const MAX_PNG_PIXELS = 1_000_000
const MAX_VIDEO_SOURCE_BYTES = 200 * 1024 * 1024
const MAX_VIDEO_DURATION_SECONDS = 10
const MAX_VIDEO_OUTPUT_DIMENSION = 512
const MAX_VIDEO_OUTPUT_FPS = 30
const MAX_VIDEO_OUTPUT_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_SOURCE_DIMENSION = 16_384
const MAX_VIDEO_SOURCE_PIXELS = 100_000_000
const PROBE_TIMEOUT_MS = 20_000
const FFMPEG_TIMEOUT_MS = 180_000
const MAX_TOOL_OUTPUT_BYTES = 256 * 1024
const MANAGED_FILE_PATTERN =
  /^particle-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\.poster)?\.(?:png|webm)$/i
const MANAGED_TEMP_FILE_PATTERN =
  /^\.particle-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.poster)?\.tmp\.(?:png|webm)$/i
const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function particleAssetError(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause) error.cause = cause
  return error
}

function normalizeDisplayName(value, fallbackPath) {
  const fallback = path.basename(fallbackPath)
  if (typeof value !== 'string') return fallback
  const sanitized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && codePoint > 31 && codePoint !== 127
      ? character
      : ''
  }).join('')
  const normalized = path.basename(sanitized.trim())
  return (normalized || fallback).normalize('NFC').slice(0, 255)
}

function parseRate(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const [numeratorText, denominatorText = '1'] = value.split('/')
  const numerator = Number(numeratorText)
  const denominator = Number(denominatorText)
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null
  }
  const rate = numerator / denominator
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

async function runMediaTool(toolName, args, options = {}) {
  let lastMissingError = null

  for (const candidate of mediaToolCandidates(toolName)) {
    try {
      return await execFileAsync(candidate, args, {
        encoding: 'utf8',
        maxBuffer: options.maxBuffer ?? MAX_TOOL_OUTPUT_BYTES,
        timeout:
          options.timeout ??
          (toolName === 'ffprobe' ? PROBE_TIMEOUT_MS : FFMPEG_TIMEOUT_MS),
        windowsHide: true,
      })
    } catch (error) {
      if (error?.code === 'ENOENT') {
        lastMissingError = error
        continue
      }

      const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
      throw particleAssetError(
        toolName === 'ffprobe'
          ? 'PARTICLE_ASSET_PROBE_FAILED'
          : 'PARTICLE_ASSET_TRANSCODE_FAILED',
        `${toolName} failed${stderr ? `: ${stderr}` : ''}`,
        error,
      )
    }
  }

  throw particleAssetError(
    toolName === 'ffprobe'
      ? 'FFPROBE_UNAVAILABLE'
      : 'FFMPEG_UNAVAILABLE',
    `${toolName} is unavailable. Install it or bundle it in Resources/bin.`,
    lastMissingError,
  )
}

async function probeParticleVideo(filePath) {
  const result = await runMediaTool('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    [
      'format=duration,size,format_name',
      'stream=index,codec_type,codec_name,width,height,pix_fmt,duration,avg_frame_rate,r_frame_rate',
      'stream_tags=alpha_mode',
    ].join(':'),
    '-of',
    'json',
    filePath,
  ])

  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    throw particleAssetError(
      'PARTICLE_ASSET_PROBE_FAILED',
      'ffprobe returned invalid particle metadata',
      error,
    )
  }

  const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
  const stream = streams.find((entry) => entry?.codec_type === 'video')
  const format = parsed?.format && typeof parsed.format === 'object'
    ? parsed.format
    : {}
  if (!stream) {
    throw particleAssetError(
      'PARTICLE_ASSET_UNSUPPORTED',
      'The selected particle asset does not contain a video stream',
    )
  }

  const formatDuration = Number(format.duration)
  const streamDuration = Number(stream.duration)
  const durationSeconds = Number.isFinite(formatDuration)
    ? formatDuration
    : Number.isFinite(streamDuration)
      ? streamDuration
      : null

  return {
    codec: typeof stream.codec_name === 'string' ? stream.codec_name : '',
    container:
      typeof format.format_name === 'string' ? format.format_name : '',
    durationSeconds,
    fps:
      parseRate(stream.avg_frame_rate) ??
      parseRate(stream.r_frame_rate),
    height: Number(stream.height),
    hasAudio: streams.some((entry) => entry?.codec_type === 'audio'),
    pixFmt: typeof stream.pix_fmt === 'string' ? stream.pix_fmt : '',
    tags: stream.tags && typeof stream.tags === 'object' ? stream.tags : {},
    width: Number(stream.width),
  }
}

function streamHasAlpha(probe) {
  const pixelFormat = probe.pixFmt.toLowerCase()
  const alphaPixelFormat =
    pixelFormat.startsWith('yuva') ||
    pixelFormat.startsWith('gbrap') ||
    pixelFormat.startsWith('ya') ||
    pixelFormat === 'rgba' ||
    pixelFormat === 'argb' ||
    pixelFormat === 'bgra' ||
    pixelFormat === 'abgr' ||
    pixelFormat.startsWith('ayuv') ||
    pixelFormat.startsWith('vuya')
  const alphaMode = Object.entries(probe.tags).some(
    ([key, value]) =>
      key.toLowerCase() === 'alpha_mode' && String(value).trim() === '1',
  )
  // WebM stores VP8/VP9 alpha as an auxiliary bitstream and ffprobe commonly
  // reports yuv420p plus alpha_mode=1. Do not trust that tag for unrelated MOV
  // codecs, where a user-authored metadata key could otherwise spoof alpha.
  return (
    alphaPixelFormat ||
    ((probe.codec === 'vp8' || probe.codec === 'vp9') && alphaMode)
  )
}

function pngCrc32(buffer, start, end) {
  let crc = 0xffffffff
  for (let index = start; index < end; index += 1) {
    crc = PNG_CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function inspectPngBuffer(buffer) {
  if (
    buffer.length < PNG_SIGNATURE.length + 25 ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw particleAssetError(
      'PARTICLE_ASSET_UNSUPPORTED',
      'The selected image is not a valid PNG file',
    )
  }

  let offset = PNG_SIGNATURE.length
  let width = null
  let height = null
  let colorType = null
  let hasTransparencyChunk = false
  let hasAnimationChunk = false
  let hasImageData = false
  let hasImageEnd = false
  let chunkIndex = 0

  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset)
    const chunkEnd = offset + 12 + chunkLength
    if (chunkEnd > buffer.length) {
      throw particleAssetError(
        'PARTICLE_ASSET_UNSUPPORTED',
        'The selected PNG file is truncated',
      )
    }

    const chunkType = buffer.toString('ascii', offset + 4, offset + 8)
    const expectedCrc = buffer.readUInt32BE(offset + 8 + chunkLength)
    const actualCrc = pngCrc32(buffer, offset + 4, offset + 8 + chunkLength)
    if (expectedCrc !== actualCrc) {
      throw particleAssetError(
        'PARTICLE_ASSET_UNSUPPORTED',
        'The selected PNG file failed its integrity check',
      )
    }
    if (chunkIndex === 0 && (chunkType !== 'IHDR' || chunkLength !== 13)) {
      throw particleAssetError(
        'PARTICLE_ASSET_UNSUPPORTED',
        'The selected PNG file has an invalid header',
      )
    }
    if (chunkType === 'IHDR') {
      if (width !== null || chunkLength !== 13) {
        throw particleAssetError(
          'PARTICLE_ASSET_UNSUPPORTED',
          'The selected PNG file has an invalid header',
        )
      }
      width = buffer.readUInt32BE(offset + 8)
      height = buffer.readUInt32BE(offset + 12)
      colorType = buffer[offset + 17]
      const bitDepth = buffer[offset + 16]
      const compressionMethod = buffer[offset + 18]
      const filterMethod = buffer[offset + 19]
      const interlaceMethod = buffer[offset + 20]
      const validBitDepths = {
        0: new Set([1, 2, 4, 8, 16]),
        2: new Set([8, 16]),
        3: new Set([1, 2, 4, 8]),
        4: new Set([8, 16]),
        6: new Set([8, 16]),
      }
      if (
        !validBitDepths[colorType]?.has(bitDepth) ||
        compressionMethod !== 0 ||
        filterMethod !== 0 ||
        (interlaceMethod !== 0 && interlaceMethod !== 1)
      ) {
        throw particleAssetError(
          'PARTICLE_ASSET_UNSUPPORTED',
          'The selected PNG file uses an invalid image format',
        )
      }
    } else if (chunkType === 'tRNS') {
      hasTransparencyChunk = true
    } else if (chunkType === 'acTL') {
      hasAnimationChunk = true
    } else if (chunkType === 'IDAT') {
      hasImageData = true
    } else if (chunkType === 'IEND') {
      if (chunkLength !== 0) {
        throw particleAssetError(
          'PARTICLE_ASSET_UNSUPPORTED',
          'The selected PNG file has an invalid end marker',
        )
      }
      hasImageEnd = true
      offset = chunkEnd
      break
    }

    offset = chunkEnd
    chunkIndex += 1
  }

  if (
    !hasImageEnd ||
    !hasImageData ||
    offset !== buffer.length ||
    !Number.isInteger(width) ||
    !Number.isInteger(height)
  ) {
    throw particleAssetError(
      'PARTICLE_ASSET_UNSUPPORTED',
      'The selected PNG file is incomplete',
    )
  }
  if (width <= 0 || height <= 0) {
    throw particleAssetError(
      'PARTICLE_ASSET_UNSUPPORTED',
      'The selected PNG dimensions are invalid',
    )
  }
  if (
    width > MAX_PNG_DIMENSION ||
    height > MAX_PNG_DIMENSION ||
    width * height > MAX_PNG_PIXELS
  ) {
    throw particleAssetError(
      'PARTICLE_ASSET_LIMIT_EXCEEDED',
      'PNG particle assets must be at most 1024 px per edge and 1 MP total',
    )
  }
  if (hasAnimationChunk) {
    throw particleAssetError(
      'PARTICLE_ASSET_UNSUPPORTED',
      'Animated PNG files are not supported as particle images',
    )
  }
  if (colorType !== 4 && colorType !== 6 && !hasTransparencyChunk) {
    throw particleAssetError(
      'PARTICLE_ASSET_ALPHA_REQUIRED',
      'PNG particle assets must contain transparency',
    )
  }

  return { width, height }
}

async function readAndInspectPng(filePath, expectedSize) {
  if (expectedSize > MAX_PNG_SOURCE_BYTES) {
    throw particleAssetError(
      'PARTICLE_ASSET_LIMIT_EXCEEDED',
      'PNG particle assets must not exceed 8 MiB',
    )
  }
  const buffer = await fs.promises.readFile(filePath)
  if (buffer.length !== expectedSize || buffer.length > MAX_PNG_SOURCE_BYTES) {
    throw particleAssetError(
      'PARTICLE_ASSET_SOURCE_CHANGED',
      'The selected PNG changed while it was being imported',
    )
  }
  return inspectPngBuffer(buffer)
}

function videoInputDecoderArgs(codec) {
  if (codec === 'vp9') return ['-c:v', 'libvpx-vp9']
  if (codec === 'vp8') return ['-c:v', 'libvpx']
  return []
}

function evenOutputDimension(value, scale) {
  const scaled = Math.floor((value * scale) / 2) * 2
  return Math.max(2, Math.min(MAX_VIDEO_OUTPUT_DIMENSION, scaled))
}

async function unlinkIfPresent(filePath) {
  if (!filePath) return false
  try {
    await fs.promises.unlink(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function createParticleAssetManager({ userDataPath }) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('An absolute Aurora user-data path is required')
  }

  const managedRoot = path.resolve(userDataPath, MANAGED_DIRECTORY_NAME)
  let managedRootPromise = null

  async function ensureManagedRoot() {
    if (!managedRootPromise) {
      managedRootPromise = (async () => {
        await fs.promises.mkdir(managedRoot, { recursive: true, mode: 0o700 })
        const root = await fs.promises.realpath(managedRoot)
        const entries = await fs.promises.readdir(root, { withFileTypes: true })
        await Promise.all(
          entries
            .filter(
              (entry) =>
                entry.isFile() && MANAGED_TEMP_FILE_PATTERN.test(entry.name),
            )
            .map((entry) => unlinkIfPresent(path.join(root, entry.name))),
        )
        return root
      })().catch((error) => {
        managedRootPromise = null
        throw error
      })
    }
    return managedRootPromise
  }

  async function importPng({ filePath, stat, name }) {
    const dimensions = await readAndInspectPng(filePath, stat.size)
    const root = await ensureManagedRoot()
    const id = crypto.randomUUID()
    const destinationPath = path.join(root, `particle-${id}.png`)
    const temporaryPath = path.join(root, `.particle-${id}.tmp.png`)
    let published = false

    try {
      await fs.promises.copyFile(filePath, temporaryPath, fs.constants.COPYFILE_EXCL)
      await fs.promises.chmod(temporaryPath, 0o600)
      const copiedStat = await fs.promises.stat(temporaryPath)
      if (copiedStat.size !== stat.size || copiedStat.size > MAX_PNG_SOURCE_BYTES) {
        throw particleAssetError(
          'PARTICLE_ASSET_SOURCE_CHANGED',
          'The selected PNG changed while it was being imported',
        )
      }
      const copiedBuffer = await fs.promises.readFile(temporaryPath)
      inspectPngBuffer(copiedBuffer)
      await fs.promises.rename(temporaryPath, destinationPath)
      published = true

      return {
        kind: 'image',
        name,
        managedPath: destinationPath,
        posterPath: null,
        width: dimensions.width,
        height: dimensions.height,
        durationSeconds: null,
        sizeBytes: copiedStat.size,
      }
    } finally {
      await unlinkIfPresent(temporaryPath)
      if (!published) await unlinkIfPresent(destinationPath)
    }
  }

  async function importVideo({ filePath, stat, name, extension }) {
    if (stat.size > MAX_VIDEO_SOURCE_BYTES) {
      throw particleAssetError(
        'PARTICLE_ASSET_LIMIT_EXCEEDED',
        'Video particle sources must not exceed 200 MiB',
      )
    }

    const sourceProbe = await probeParticleVideo(filePath)
    const isWebmContainer = sourceProbe.container
      .split(',')
      .some((entry) => entry.trim() === 'webm' || entry.trim() === 'matroska')
    const isMovContainer = sourceProbe.container
      .split(',')
      .some((entry) => entry.trim() === 'mov' || entry.trim() === 'mp4')
    if (
      (extension === '.webm' && !isWebmContainer) ||
      (extension === '.mov' && !isMovContainer)
    ) {
      throw particleAssetError(
        'PARTICLE_ASSET_UNSUPPORTED',
        'The selected video container does not match its file extension',
      )
    }
    if (
      extension === '.webm' &&
      sourceProbe.codec !== 'vp8' &&
      sourceProbe.codec !== 'vp9'
    ) {
      throw particleAssetError(
        'PARTICLE_ASSET_UNSUPPORTED',
        'Transparent WebM particle sources must use VP8 or VP9',
      )
    }
    if (!streamHasAlpha(sourceProbe)) {
      throw particleAssetError(
        'PARTICLE_ASSET_ALPHA_REQUIRED',
        'Video particle assets must contain an alpha channel',
      )
    }
    if (
      !Number.isFinite(sourceProbe.durationSeconds) ||
      sourceProbe.durationSeconds <= 0 ||
      sourceProbe.durationSeconds > MAX_VIDEO_DURATION_SECONDS + 0.001
    ) {
      throw particleAssetError(
        'PARTICLE_ASSET_LIMIT_EXCEEDED',
        'Video particle assets must be longer than 0 and no longer than 10 seconds',
      )
    }
    if (
      !Number.isInteger(sourceProbe.width) ||
      !Number.isInteger(sourceProbe.height) ||
      sourceProbe.width < 2 ||
      sourceProbe.height < 2 ||
      sourceProbe.width > MAX_VIDEO_SOURCE_DIMENSION ||
      sourceProbe.height > MAX_VIDEO_SOURCE_DIMENSION ||
      sourceProbe.width * sourceProbe.height > MAX_VIDEO_SOURCE_PIXELS
    ) {
      throw particleAssetError(
        'PARTICLE_ASSET_LIMIT_EXCEEDED',
        'The video particle dimensions are outside the supported range',
      )
    }

    const root = await ensureManagedRoot()
    const id = crypto.randomUUID()
    const destinationPath = path.join(root, `particle-${id}.webm`)
    const posterPath = path.join(root, `particle-${id}.poster.png`)
    const temporaryVideoPath = path.join(root, `.particle-${id}.tmp.webm`)
    const temporaryPosterPath = path.join(root, `.particle-${id}.poster.tmp.png`)
    const scale = Math.min(
      1,
      MAX_VIDEO_OUTPUT_DIMENSION / sourceProbe.width,
      MAX_VIDEO_OUTPUT_DIMENSION / sourceProbe.height,
    )
    const outputWidth = evenOutputDimension(sourceProbe.width, scale)
    const outputHeight = evenOutputDimension(sourceProbe.height, scale)
    let videoPublished = false
    let posterPublished = false

    try {
      await runMediaTool('ffmpeg', [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-y',
        ...videoInputDecoderArgs(sourceProbe.codec),
        '-i',
        filePath,
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-t',
        String(Math.min(sourceProbe.durationSeconds, MAX_VIDEO_DURATION_SECONDS)),
        '-vf',
        `scale=${outputWidth}:${outputHeight}:flags=lanczos,fps=${MAX_VIDEO_OUTPUT_FPS},format=yuva420p`,
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuva420p',
        '-auto-alt-ref',
        '0',
        '-row-mt',
        '1',
        '-deadline',
        'good',
        '-cpu-used',
        '4',
        '-b:v',
        '0',
        '-crf',
        '30',
        '-g',
        String(MAX_VIDEO_OUTPUT_FPS),
        '-metadata:s:v:0',
        'alpha_mode=1',
        '-f',
        'webm',
        temporaryVideoPath,
      ])

      const temporaryVideoStat = await fs.promises.stat(temporaryVideoPath)
      if (
        temporaryVideoStat.size <= 0 ||
        temporaryVideoStat.size > MAX_VIDEO_OUTPUT_BYTES
      ) {
        throw particleAssetError(
          'PARTICLE_ASSET_LIMIT_EXCEEDED',
          'The normalized video particle asset exceeds 20 MiB',
        )
      }

      const outputProbe = await probeParticleVideo(temporaryVideoPath)
      if (
        outputProbe.codec !== 'vp9' ||
        !streamHasAlpha(outputProbe) ||
        outputProbe.width !== outputWidth ||
        outputProbe.height !== outputHeight ||
        outputProbe.hasAudio ||
        (outputProbe.fps !== null &&
          outputProbe.fps > MAX_VIDEO_OUTPUT_FPS + 0.01) ||
        !Number.isFinite(outputProbe.durationSeconds) ||
        outputProbe.durationSeconds > MAX_VIDEO_DURATION_SECONDS + 0.05
      ) {
        throw particleAssetError(
          'PARTICLE_ASSET_TRANSCODE_FAILED',
          'The normalized particle video did not pass validation',
        )
      }

      await runMediaTool('ffmpeg', [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-y',
        '-c:v',
        'libvpx-vp9',
        '-i',
        temporaryVideoPath,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-vf',
        'format=rgba',
        '-c:v',
        'png',
        '-pix_fmt',
        'rgba',
        '-update',
        '1',
        '-f',
        'image2',
        temporaryPosterPath,
      ])

      const posterStat = await fs.promises.stat(temporaryPosterPath)
      const posterBuffer = await fs.promises.readFile(temporaryPosterPath)
      const posterDimensions = inspectPngBuffer(posterBuffer)
      if (
        posterStat.size > MAX_PNG_SOURCE_BYTES ||
        posterDimensions.width !== outputWidth ||
        posterDimensions.height !== outputHeight
      ) {
        throw particleAssetError(
          'PARTICLE_ASSET_TRANSCODE_FAILED',
          'The particle poster did not pass validation',
        )
      }

      await fs.promises.chmod(temporaryVideoPath, 0o600)
      await fs.promises.chmod(temporaryPosterPath, 0o600)
      await fs.promises.rename(temporaryVideoPath, destinationPath)
      videoPublished = true
      await fs.promises.rename(temporaryPosterPath, posterPath)
      posterPublished = true

      return {
        kind: 'video',
        name,
        managedPath: destinationPath,
        posterPath,
        width: outputWidth,
        height: outputHeight,
        durationSeconds: outputProbe.durationSeconds,
        sizeBytes: temporaryVideoStat.size,
      }
    } finally {
      await unlinkIfPresent(temporaryVideoPath)
      await unlinkIfPresent(temporaryPosterPath)
      if (!posterPublished) await unlinkIfPresent(posterPath)
      if (!videoPublished || !posterPublished) await unlinkIfPresent(destinationPath)
    }
  }

  async function importParticleAsset(request) {
    if (!request || typeof request !== 'object') {
      throw particleAssetError(
        'PARTICLE_ASSET_INVALID_INPUT',
        'A particle asset file is required',
      )
    }

    const { filePath, stat } = await validateMediaFilePath(request.filePath)
    const extension = path.extname(filePath).toLowerCase()
    const name = normalizeDisplayName(request.name, filePath)
    if (extension === '.png') {
      return importPng({ filePath, stat, name })
    }
    if (extension === '.webm' || extension === '.mov') {
      return importVideo({ filePath, stat, name, extension })
    }
    throw particleAssetError(
      'PARTICLE_ASSET_UNSUPPORTED',
      'Particle assets must be a transparent PNG, WebM, or MOV file',
    )
  }

  async function removeParticleAsset(managedPath) {
    if (
      typeof managedPath !== 'string' ||
      managedPath.trim() === '' ||
      managedPath.includes('\0')
    ) {
      throw particleAssetError(
        'PARTICLE_ASSET_INVALID_INPUT',
        'A managed particle asset path is required',
      )
    }

    const root = await ensureManagedRoot()
    const candidate = path.resolve(managedPath.trim())
    const basename = path.basename(candidate)
    const match = basename.match(MANAGED_FILE_PATTERN)
    if (path.dirname(candidate) !== root || !match) {
      throw particleAssetError(
        'PARTICLE_ASSET_PATH_FORBIDDEN',
        'Only Aurora-managed particle assets can be removed',
      )
    }

    const targets = [candidate]
    if (path.extname(candidate).toLowerCase() === '.webm') {
      targets.push(path.join(root, `particle-${match[1]}.poster.png`))
    }

    let removed = false
    for (const target of targets) {
      try {
        const targetStat = await fs.promises.lstat(target)
        if (!targetStat.isFile()) {
          throw particleAssetError(
            'PARTICLE_ASSET_PATH_FORBIDDEN',
            'Only regular Aurora-managed particle files can be removed',
          )
        }
        await fs.promises.unlink(target)
        removed = true
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    return removed
  }

  async function validateParticleAsset(request = {}) {
    const managedPath = request?.managedPath
    const posterPath = request?.posterPath ?? null
    if (
      typeof managedPath !== 'string' ||
      managedPath.trim() === '' ||
      managedPath.includes('\0')
    ) {
      return null
    }

    const root = await ensureManagedRoot()
    const candidate = path.resolve(managedPath.trim())
    const basename = path.basename(candidate)
    const match = basename.match(MANAGED_FILE_PATTERN)
    if (!match || basename.includes('.poster.')) {
      return null
    }
    const extension = path.extname(candidate).toLowerCase()
    const kind = extension === '.webm' ? 'video' : 'image'
    const expectedPosterPath = kind === 'video'
      ? path.join(path.dirname(candidate), `particle-${match[1]}.poster.png`)
      : null
    if (
      (expectedPosterPath === null && posterPath !== null) ||
      (expectedPosterPath !== null &&
        (typeof posterPath !== 'string' || path.resolve(posterPath) !== expectedPosterPath))
    ) {
      return null
    }

    try {
      const candidateStat = await fs.promises.lstat(candidate)
      if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) return null
      const candidateRealPath = await fs.promises.realpath(candidate)
      if (path.dirname(candidateRealPath) !== root) return null
      const maximumBytes = kind === 'video'
        ? MAX_VIDEO_OUTPUT_BYTES
        : MAX_PNG_SOURCE_BYTES
      if (candidateStat.size <= 0 || candidateStat.size > maximumBytes) return null

      if (expectedPosterPath) {
        const posterStat = await fs.promises.lstat(expectedPosterPath)
        if (
          !posterStat.isFile() ||
          posterStat.isSymbolicLink() ||
          posterStat.size <= 0 ||
          posterStat.size > MAX_PNG_SOURCE_BYTES
        ) {
          return null
        }
        const posterRealPath = await fs.promises.realpath(expectedPosterPath)
        if (path.dirname(posterRealPath) !== root) return null
      }

      return {
        kind,
        managedPath: candidate,
        posterPath: expectedPosterPath,
        sizeBytes: candidateStat.size,
      }
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
      throw error
    }
  }

  async function pruneParticleAssets(referencedPaths = []) {
    const root = await ensureManagedRoot()
    const references = new Set()
    for (const value of Array.isArray(referencedPaths) ? referencedPaths : []) {
      if (typeof value !== 'string' || value.includes('\0')) continue
      const candidate = path.resolve(value)
      const match = path.basename(candidate).match(MANAGED_FILE_PATTERN)
      if (!match) continue
      let realCandidate
      try {
        realCandidate = await fs.promises.realpath(candidate)
      } catch {
        continue
      }
      if (path.dirname(realCandidate) !== root) continue
      references.add(realCandidate)
      if (
        path.extname(candidate).toLowerCase() === '.webm' &&
        !path.basename(candidate).includes('.poster.')
      ) {
        references.add(path.join(root, `particle-${match[1]}.poster.png`))
      }
    }

    let removed = 0
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !MANAGED_FILE_PATTERN.test(entry.name)) continue
      const candidate = path.join(root, entry.name)
      if (references.has(candidate)) continue
      if (await unlinkIfPresent(candidate)) removed += 1
    }
    return removed
  }

  return {
    importParticleAsset,
    managedRoot,
    pruneParticleAssets,
    removeParticleAsset,
    validateParticleAsset,
  }
}

module.exports = {
  createParticleAssetManager,
}
