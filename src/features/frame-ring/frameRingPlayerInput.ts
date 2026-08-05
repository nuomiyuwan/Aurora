import {
  readWheelDragSample,
  type WheelDragInput,
} from '../wheelDragGesture'

export const LOCAL_PLAYER_KEYBOARD_SEEK_SECONDS = 5

const MINIMUM_TRACKPAD_SECONDS_PER_PIXEL = 0.02
const MAXIMUM_TRACKPAD_SECONDS_PER_PIXEL = 0.5
const TRACKPAD_DURATION_SCALE = 1_600
const TRACKPAD_HORIZONTAL_DOMINANCE = 1.15

export function clampLocalPlayerTime(
  timeSeconds: number,
  startSeconds: number,
  endSeconds: number,
) {
  const start = Math.min(startSeconds, endSeconds)
  const end = Math.max(startSeconds, endSeconds)
  return Math.min(end, Math.max(start, timeSeconds))
}

export function resolveLocalPlayerTrackpadSeekDelta(
  input: WheelDragInput,
  durationSeconds: number,
  pageExtent: number,
) {
  if (
    input.ctrlKey ||
    Math.abs(input.deltaX) <= Math.abs(input.deltaY) * TRACKPAD_HORIZONTAL_DOMINANCE
  ) {
    return null
  }

  const sample = readWheelDragSample(input, pageExtent, 'x')
  if (!sample?.moves) return null

  const secondsPerPixel = Math.min(
    MAXIMUM_TRACKPAD_SECONDS_PER_PIXEL,
    Math.max(
      MINIMUM_TRACKPAD_SECONDS_PER_PIXEL,
      Math.max(0, durationSeconds) / TRACKPAD_DURATION_SCALE,
    ),
  )
  return -sample.delta * secondsPerPixel
}
