export interface WheelDragInput {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
}

export type WheelDragAxis = 'x' | 'y'

export interface WheelDragSample {
  axis: WheelDragAxis
  delta: number
  moves: boolean
}

export const WHEEL_DRAG_END_DELAY = 120
export const TRACKPAD_SNAP_COMMIT_PROGRESS = 0.22
export const WHEEL_DRAG_PREVIEW_IDLE_DELAY = 24
const WHEEL_DRAG_PREVIEW_MAX_BLEND = 0.72
const WHEEL_DRAG_MOVE_THRESHOLD = 0.01

export function resolveWheelDragPreviewPosition(
  startPosition: number,
  targetPosition: number,
  idleDuration: number,
) {
  if (idleDuration <= WHEEL_DRAG_PREVIEW_IDLE_DELAY) return startPosition
  const previewDuration = Math.max(
    1,
    WHEEL_DRAG_END_DELAY - WHEEL_DRAG_PREVIEW_IDLE_DELAY,
  )
  const progress = Math.min(
    1,
    Math.max(0, (idleDuration - WHEEL_DRAG_PREVIEW_IDLE_DELAY) / previewDuration),
  )
  const blend = progress * progress * WHEEL_DRAG_PREVIEW_MAX_BLEND
  return startPosition + (targetPosition - startPosition) * blend
}

export function resolveTrackpadSnapTarget(
  anchorPosition: number,
  releasePosition: number,
  minimumPosition: number,
  maximumPosition: number,
) {
  const minimum = Math.min(minimumPosition, maximumPosition)
  const maximum = Math.max(minimumPosition, maximumPosition)
  const anchor = Math.max(minimum, Math.min(maximum, Math.round(anchorPosition)))
  const displacement = releasePosition - anchor
  const direction = Math.sign(displacement)
  if (direction === 0) return anchor

  const distance = Math.abs(displacement)
  const completedSteps = Math.floor(distance)
  const remainder = distance - completedSteps
  const committedSteps = completedSteps + (
    remainder >= TRACKPAD_SNAP_COMMIT_PROGRESS ? 1 : 0
  )
  const target = anchor + direction * committedSteps
  return Math.max(minimum, Math.min(maximum, target))
}

export function readWheelDragSample(
  input: WheelDragInput,
  pageExtent: number,
  lockedAxis: WheelDragAxis | null,
): WheelDragSample | null {
  if (input.ctrlKey) return null

  const axis = lockedAxis ?? (
    Math.abs(input.deltaX) > Math.abs(input.deltaY) ? 'x' : 'y'
  )
  const rawDelta = axis === 'x' ? input.deltaX : input.deltaY
  if (!Number.isFinite(rawDelta)) return null
  const moves = Math.abs(rawDelta) >= WHEEL_DRAG_MOVE_THRESHOLD

  const deltaScale = input.deltaMode === 1
    ? 16
    : input.deltaMode === 2
      ? Math.max(1, pageExtent)
      : 1
  const delta = moves ? rawDelta * deltaScale : 0
  const maximumDelta = Math.max(80, pageExtent * 0.5)
  return {
    axis,
    delta: Math.max(-maximumDelta, Math.min(maximumDelta, delta)),
    moves,
  }
}
