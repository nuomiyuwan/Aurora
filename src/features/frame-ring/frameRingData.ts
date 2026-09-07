import type { ResolvedFrameRingLayout } from './frameRingLayout'
import type { MediaColorPresetId } from '../../data/mediaColorPresets'
import type { ProjectTrimRange } from '../../data/mediaLibraryTypes'

export interface FrameRingClipSource {
  id: string
  assetId?: string
  filename: string
  thumbnail: string
  sourcePath?: string | null
  sourceUrl?: string | null
  indexedFrames?: readonly FrameRingIndexedFrame[]
  duration: string
  durationSeconds?: number | null
  sourceDurationSeconds?: number | null
  trimRange?: ProjectTrimRange | null
  resolution: string
  fps: string
  fpsValue?: number | null
  frameCount: string
  sampleCount: number
  size?: string
  sizeBytes?: number | null
  codec: string
  capturedAt: string
  tags: string[]
  note: string
  colorPreset?: MediaColorPresetId
}

export interface FrameRingIndexedFrame {
  id: string
  index: number
  thumbnail: string
  timeSeconds: number
}

export interface FrameRingFrame {
  id: string
  index: number
  thumbnail: string
  timeSeconds: number
  timecode: string
  shortTimecode: string
  cropX: number
  cropY: number
  brightness: number
}

export type FrameRingPreviewTask = 'preparing' | 'ready' | 'failed'

export interface FrameRingVideoDecodeWatchdogSample {
  playing: boolean
  documentVisible: boolean
  monitoringSupported: boolean
  elapsedMediaTime: number
  observedAdvancingVideoFrame: boolean
  decodedFrameCountBefore: number | null
  decodedFrameCountAfter: number | null
}

export const shouldFallbackAfterFrameRingVideoDecodeWatchdog = ({
  playing,
  documentVisible,
  monitoringSupported,
  elapsedMediaTime,
  observedAdvancingVideoFrame,
  decodedFrameCountBefore,
  decodedFrameCountAfter,
}: FrameRingVideoDecodeWatchdogSample) => {
  if (
    !playing ||
    !documentVisible ||
    !monitoringSupported ||
    elapsedMediaTime < 0.35 ||
    observedAdvancingVideoFrame
  ) {
    return false
  }

  if (
    decodedFrameCountBefore !== null &&
    decodedFrameCountAfter !== null &&
    decodedFrameCountAfter > decodedFrameCountBefore
  ) {
    return false
  }

  return true
}

/**
 * A local source is attempted directly unless compatibility probing or the
 * playback watchdog has established that its visual stream cannot advance.
 */
export const canPlayFrameRingVideoSource = (
  sourceUrl: string | null | undefined,
  playbackFailed: boolean,
) => Boolean(sourceUrl) && !playbackFailed

export const resolveFrameRingPreviewTask = (
  sourceUrl: string | null | undefined,
  storedStatus?: FrameRingPreviewTask,
): FrameRingPreviewTask =>
  storedStatus ?? (sourceUrl ? 'ready' : 'failed')

export const canOpenUnavailableFrameRingSource = (
  indexedFrameCount: number,
  sampleCount: number,
) => indexedFrameCount > 0 || sampleCount > 0

export interface FrameRingVisual {
  x: number
  y: number
  z: number
  rotateY: number
  scale: number
  scaleX: number
  opacity: number
  edgeBlur: number
  edgeBrightness: number
  edgeSaturation: number
  zIndex: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const smoothstep = (minimum: number, maximum: number, value: number) => {
  const progress = clamp((value - minimum) / (maximum - minimum), 0, 1)
  return progress * progress * (3 - 2 * progress)
}

export interface FrameRingSlotLayout {
  offset: number
  x: number
  y: number
  z: number
  rotateY: number
  scale: number
  scaleX: number
}

/**
 * Manual 13-slot tuning table at the 1280 px reference width.
 * x/y are screen-layout pixels, z is perspective depth, and rotateY is degrees.
 * Fractional drag positions interpolate between adjacent rows.
 */
export const FRAME_RING_SLOT_LAYOUT: readonly FrameRingSlotLayout[] = [
  { offset: -6, x: -473, y: -18, z: -400, rotateY: -95, scale: 0.75, scaleX: 0.2 },
  { offset: -5, x: -459, y: -15, z: -300, rotateY: -75, scale: 0.8, scaleX: 0.28 },
  { offset: -4, x: -439, y: -12, z: -230, rotateY: -65, scale: 0.85, scaleX: 0.48 },
  { offset: -3, x: -395, y: -9, z: -160, rotateY: -50, scale: 0.9, scaleX: 0.68 },
  { offset: -2, x: -304, y: -6, z: -50, rotateY: -35, scale: 0.95, scaleX: 0.9 },
  { offset: -1, x: -172, y: -3, z: 50, rotateY: -25, scale: 1.0, scaleX: 1 },
  { offset: 0, x: 0, y: 0, z: 100, rotateY: 0, scale: 1.2, scaleX: 1 },
  { offset: 1, x: 172, y: -3, z: 50, rotateY: 25, scale: 1.0, scaleX: 1 },
  { offset: 2, x: 304, y: -6, z: -50, rotateY: 35, scale: 0.95, scaleX: 0.9 },
  { offset: 3, x: 395, y: -10, z: -160, rotateY: 50, scale: 0.9, scaleX: 0.68 },
  { offset: 4, x: 439, y: -15, z: -230, rotateY: 65, scale: 0.85, scaleX: 0.48 },
  { offset: 5, x: 459, y: -18, z: -300, rotateY: 75, scale: 0.8, scaleX: 0.28 },
  { offset: 6, x: 473, y: -20, z: -400, rotateY: 95, scale: 0.75, scaleX: 0.2 },
]

const FRAME_RING_MIN_SLOT_OFFSET = FRAME_RING_SLOT_LAYOUT[0].offset
const FRAME_RING_MAX_SLOT_OFFSET =
  FRAME_RING_SLOT_LAYOUT[FRAME_RING_SLOT_LAYOUT.length - 1].offset
const FRAME_RING_VISIBLE_RADIUS = Math.abs(FRAME_RING_MIN_SLOT_OFFSET)
const FRAME_RING_SPACING_SCALE = 0.975

export const parseFrameRingDurationSeconds = (duration: string) => {
  const parts = duration.split(':').map((part) => Number.parseInt(part, 10) || 0)
  if (parts.length >= 4) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Math.max(1, parts[0] || 1)
}

export interface FrameRingMediaDurationSample {
  sourceKey: string
  durationSeconds: number
}

export const resolveFrameRingMediaDurationForSource = (
  sample: FrameRingMediaDurationSample | null | undefined,
  sourceKey: string,
) =>
  sample?.sourceKey === sourceKey &&
  Number.isFinite(sample.durationSeconds) &&
  sample.durationSeconds > 0
    ? sample.durationSeconds
    : null

export const resolveFrameRingPlaybackDurationSeconds = (
  persistedDurationSeconds: number | null | undefined,
  displayDuration: string,
  mediaDurationSeconds?: number | null,
) => {
  const candidates = [
    persistedDurationSeconds,
    mediaDurationSeconds,
    parseFrameRingDurationSeconds(displayDuration),
  ].filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0,
  )

  /*
   * ffprobe metadata and Chromium's loaded media metadata describe the same
   * full-length source (including Aurora's full preview proxy). Use the
   * longest credible value so a temporarily missing/stale persisted duration
   * cannot collapse otherwise playable media to the parser's 1-second
   * fallback. `durationchange` can then repair the bound as soon as Chromium
   * learns the real stream duration.
   */
  return Math.max(1, ...candidates)
}

export const parseFrameRingFps = (fps: string) => {
  const parsedFps = Number.parseFloat(fps)
  return Number.isFinite(parsedFps) && parsedFps > 0 ? parsedFps : 24
}

export const formatFrameRingTimecode = (seconds: number, fps: number) => {
  const nominalFps = Math.max(1, Math.round(Number.isFinite(fps) ? fps : 24))
  const safeSeconds = Math.max(0, seconds)
  const wholeSeconds = Math.floor(safeSeconds)
  const frames = Math.min(
    nominalFps - 1,
    Math.floor((safeSeconds - wholeSeconds) * nominalFps),
  )
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const remainingSeconds = wholeSeconds % 60
  return [hours, minutes, remainingSeconds, frames]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

export function findNearestFrameIndexByTime(
  frames: readonly Pick<FrameRingFrame, 'timeSeconds'>[],
  targetSeconds: number,
) {
  if (frames.length <= 1) return 0
  const target = Number.isFinite(targetSeconds)
    ? Math.max(0, targetSeconds)
    : 0
  let low = 0
  let high = frames.length - 1

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (frames[middle].timeSeconds < target) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  if (low === 0) return 0
  const previous = low - 1
  return target - frames[previous].timeSeconds <= frames[low].timeSeconds - target
    ? previous
    : low
}

const frameNoise = (index: number, channel: number) => {
  const value = Math.sin((index + 1) * 18.917 + channel * 47.231) * 19847.318
  return value - Math.floor(value)
}

export function createFrameRingFrames(
  clip: FrameRingClipSource,
  relatedThumbnails: readonly string[],
): FrameRingFrame[] {
  if (clip.indexedFrames && clip.indexedFrames.length > 0) {
    const fps = parseFrameRingFps(clip.fps)

    return clip.indexedFrames.map((frame) => {
      const timeSeconds = Math.max(
        0,
        Number.isFinite(frame.timeSeconds) ? frame.timeSeconds : 0,
      )
      const timecode = formatFrameRingTimecode(timeSeconds, fps)

      return {
        id: frame.id,
        index: frame.index,
        thumbnail: frame.thumbnail,
        timeSeconds,
        timecode,
        shortTimecode: timecode.slice(3, 8),
        cropX: 50,
        cropY: 50,
        brightness: 1,
      }
    })
  }

  // A clip without a persisted visual index has no frame ring yet. Keep the
  // ring genuinely empty instead of synthesizing a poster card; the preview
  // player can still use the original media source while indexing is started
  // from the empty state.
  if (clip.sampleCount <= 0) return []

  const frameTotal = Math.max(1, Math.round(clip.sampleCount))
  const durationSeconds = parseFrameRingDurationSeconds(clip.duration)
  const playbackStartSeconds = clip.trimRange?.inSeconds ?? 0
  const fps = parseFrameRingFps(clip.fps)
  const thumbnails = relatedThumbnails.length > 0 ? relatedThumbnails : [clip.thumbnail]

  return Array.from({ length: frameTotal }, (_, index) => {
    const progress = frameTotal <= 1 ? 0 : index / (frameTotal - 1)
    const timeSeconds = playbackStartSeconds + durationSeconds * progress
    const timecode = formatFrameRingTimecode(timeSeconds, fps)
    const thumbnailGroup = Math.floor(index / 5)
    const thumbnail =
      index === Math.round((frameTotal - 1) * 0.42)
        ? clip.thumbnail
        : thumbnails[thumbnailGroup % thumbnails.length]

    return {
      id: `${clip.assetId ?? clip.id}:frame:${index}`,
      index,
      thumbnail,
      timeSeconds,
      timecode,
      shortTimecode: timecode.slice(3, 8),
      cropX: 46 + frameNoise(index, 1) * 8,
      cropY: 45 + frameNoise(index, 2) * 8,
      brightness: 0.86 + frameNoise(index, 3) * 0.2,
    }
  })
}

export function getDefaultFrameIndex(frameCount: number) {
  const lastFrameIndex = Math.max(0, Math.round(frameCount) - 1)

  // Keep the existing full 13-slot composition on first entry, but anchor its
  // visible range to the beginning of the media instead of jumping into the
  // middle. For a normal index this places frame 0 in the leftmost slot (-6).
  return Math.min(FRAME_RING_VISIBLE_RADIUS, lastFrameIndex)
}

export function clampFramePosition(position: number, frameCount: number) {
  return clamp(position, 0, Math.max(0, frameCount - 1))
}

export function getFrameRingVisual(
  offset: number,
  layout: ResolvedFrameRingLayout,
): FrameRingVisual {
  const absoluteOffset = Math.abs(offset)
  const clampedOffset = clamp(
    offset,
    FRAME_RING_MIN_SLOT_OFFSET,
    FRAME_RING_MAX_SLOT_OFFSET,
  )
  const lowerSlotOffset = Math.floor(clampedOffset)
  const lowerIndex = lowerSlotOffset - FRAME_RING_MIN_SLOT_OFFSET
  const upperIndex = Math.min(FRAME_RING_SLOT_LAYOUT.length - 1, lowerIndex + 1)
  const progress = clampedOffset - lowerSlotOffset
  const lower = FRAME_RING_SLOT_LAYOUT[lowerIndex]
  const upper = FRAME_RING_SLOT_LAYOUT[upperIndex]
  const interpolate = (key: keyof Omit<FrameRingSlotLayout, 'offset'>) =>
    lower[key] + (upper[key] - lower[key]) * progress
  const edgeFalloff = smoothstep(1, 5, absoluteOffset)
  const edgeOpacity = 1 - edgeFalloff * 0.6
  const virtualizationFade = 1 - smoothstep(5, 6, absoluteOffset)

  return {
    x: interpolate('x') * layout.slotScale * FRAME_RING_SPACING_SCALE,
    y: interpolate('y') * layout.slotScale,
    z: interpolate('z') * layout.layoutScale,
    // The center stays mathematically front-facing; dragging interpolates the
    // manually tuned left/right rows so rotation never jumps between slots.
    rotateY: interpolate('rotateY'),
    scale: interpolate('scale'),
    scaleX: interpolate('scaleX'),
    opacity: edgeOpacity * virtualizationFade,
    edgeBlur: edgeFalloff * 4.2 * layout.layoutScale,
    edgeBrightness: 1 - edgeFalloff * 0.62,
    edgeSaturation: 1 - edgeFalloff * 0.4,
    zIndex: 1000 - Math.round(absoluteOffset * 20),
  }
}

export function getVisibleFrameRange(
  position: number,
  frameCount: number,
  radius = FRAME_RING_VISIBLE_RADIUS,
) {
  const center = clampFramePosition(Math.round(position), frameCount)
  const start = Math.max(0, center - radius)
  const end = Math.min(frameCount, center + radius + 1)
  return { start, end }
}

export const FRAME_RING_REFLECTION_PRELOAD_COUNT = 4

export function getFrameRingReflectionPreloadFrames(
  frames: readonly FrameRingFrame[],
  visibleRange: { start: number; end: number },
  direction: -1 | 0 | 1,
  count = FRAME_RING_REFLECTION_PRELOAD_COUNT,
) {
  const preloadCount = Math.max(0, Math.floor(count))
  if (preloadCount === 0 || frames.length === 0) return []

  const indexes: number[] = []
  const included = new Set<number>()
  const append = (index: number) => {
    if (
      indexes.length >= preloadCount ||
      index < 0 ||
      index >= frames.length ||
      (index >= visibleRange.start && index < visibleRange.end) ||
      included.has(index)
    ) {
      return
    }
    included.add(index)
    indexes.push(index)
  }

  if (direction > 0) {
    for (let offset = 0; offset < 3; offset += 1) {
      append(visibleRange.end + offset)
    }
    append(visibleRange.start - 1)
  } else if (direction < 0) {
    for (let offset = 1; offset <= 3; offset += 1) {
      append(visibleRange.start - offset)
    }
    append(visibleRange.end)
  } else {
    append(visibleRange.end)
    append(visibleRange.end + 1)
    append(visibleRange.start - 1)
    append(visibleRange.start - 2)
  }

  for (let offset = 0; indexes.length < preloadCount && offset < frames.length; offset += 1) {
    if (direction < 0) {
      append(visibleRange.start - 1 - offset)
      append(visibleRange.end + offset)
    } else {
      append(visibleRange.end + offset)
      append(visibleRange.start - 1 - offset)
    }
  }

  return indexes.map((index) => frames[index])
}
