const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)
const MEDIA_PROBE_TIMEOUT_MS = 20_000
const MEDIA_PROBE_MAX_BUFFER = 4 * 1024 * 1024

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

function mediaToolCandidates(toolName) {
  if (toolName !== 'ffmpeg' && toolName !== 'ffprobe') {
    throw new TypeError('Unsupported media tool')
  }

  const executableName =
    process.platform === 'win32' ? `${toolName}.exe` : toolName
  const environmentPath =
    toolName === 'ffmpeg'
      ? process.env.AURORA_FFMPEG_PATH
      : process.env.AURORA_FFPROBE_PATH
  const candidates = [
    // Packaged builds should always prefer the binaries shipped with Aurora.
    process.resourcesPath
      ? path.join(process.resourcesPath, 'bin', executableName)
      : null,
    environmentPath,
    process.platform === 'darwin'
      ? path.join('/opt/homebrew/bin', executableName)
      : null,
    process.platform === 'darwin'
      ? path.join('/usr/local/bin', executableName)
      : null,
    executableName,
  ]

  return [...new Set(candidates.filter((candidate) =>
    typeof candidate === 'string' && candidate.trim() !== '',
  ))]
}

async function validateMediaFilePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new TypeError('A media file path is required')
  }

  const filePath = path.resolve(inputPath.trim())
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile()) throw new TypeError('The selected path is not a file')
  return {
    filePath: await fs.promises.realpath(filePath),
    stat,
  }
}

async function runFfprobe(filePath) {
  const args = [
    '-v',
    'error',
    '-show_entries',
    [
      'format=duration,size,format_name:format_tags=creation_time',
      'stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_frames',
    ].join(':'),
    '-of',
    'json',
    filePath,
  ]
  let lastError = null

  for (const candidate of mediaToolCandidates('ffprobe')) {
    try {
      const result = await execFileAsync(candidate, args, {
        encoding: 'utf8',
        maxBuffer: MEDIA_PROBE_MAX_BUFFER,
        timeout: MEDIA_PROBE_TIMEOUT_MS,
        windowsHide: true,
      })
      return JSON.parse(result.stdout)
    } catch (error) {
      lastError = error
      if (error?.code !== 'ENOENT') throw error
    }
  }

  const unavailable = new Error('ffprobe is unavailable')
  unavailable.code = 'FFPROBE_UNAVAILABLE'
  unavailable.cause = lastError
  throw unavailable
}

async function inspectMediaFile(inputPath) {
  const { filePath, stat } = await validateMediaFilePath(inputPath)
  const probe = await runFfprobe(filePath)
  const format = probe?.format && typeof probe.format === 'object'
    ? probe.format
    : {}
  const streams = Array.isArray(probe?.streams) ? probe.streams : []
  const videoStream =
    streams.find((stream) => stream?.codec_type === 'video') ?? {}
  const durationSeconds = Number(format.duration)
  const averageFps = parseRate(videoStream.avg_frame_rate)
  const nominalFps = parseRate(videoStream.r_frame_rate)
  // Display/timecode semantics use the stream's nominal cadence. The average
  // rate remains the safer fallback for estimating a missing frame count on
  // variable-frame-rate recordings.
  const fps = nominalFps ?? averageFps
  const explicitFrameCount = Number(videoStream.nb_frames)
  const frameCount =
    Number.isFinite(explicitFrameCount) && explicitFrameCount >= 0
      ? Math.round(explicitFrameCount)
      : Number.isFinite(durationSeconds) &&
          durationSeconds >= 0 &&
          (averageFps ?? fps)
        ? Math.round(durationSeconds * (averageFps ?? fps))
        : null
  const creationTime =
    typeof format?.tags?.creation_time === 'string'
      ? format.tags.creation_time
      : null

  return {
    filePath,
    filename: path.basename(filePath),
    durationSeconds:
      Number.isFinite(durationSeconds) && durationSeconds >= 0
        ? durationSeconds
        : null,
    sizeBytes: stat.size,
    width:
      Number.isFinite(Number(videoStream.width))
        ? Math.max(0, Math.round(Number(videoStream.width)))
        : null,
    height:
      Number.isFinite(Number(videoStream.height))
        ? Math.max(0, Math.round(Number(videoStream.height)))
        : null,
    fps,
    frameCount,
    codec:
      typeof videoStream.codec_name === 'string'
        ? videoStream.codec_name
        : null,
    container:
      typeof format.format_name === 'string' ? format.format_name : null,
    capturedAt: creationTime,
    modifiedAt: stat.mtime.toISOString(),
  }
}

module.exports = {
  inspectMediaFile,
  mediaToolCandidates,
  runFfprobe,
  validateMediaFilePath,
}
