export type VideoClipHoverScrubRect = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export type VideoClipHoverPointerSample = {
  pointerType: string
  buttons: number
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value))

export function shouldHandleVideoClipHoverPointer(
  sample: VideoClipHoverPointerSample,
) {
  return sample.pointerType === 'mouse' && sample.buttons === 0
}

export function resolveVideoClipHoverProgress(
  clientX: number,
  clientY: number,
  rect: VideoClipHoverScrubRect,
) {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.right) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.bottom) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    clientY < rect.top ||
    clientY > rect.bottom ||
    clientX < rect.left ||
    clientX > rect.right
  ) {
    return null
  }

  return clampUnit((clientX - rect.left) / rect.width)
}

export function resolveVideoClipHoverTime(
  progress: number,
  durationSeconds: number,
) {
  if (!Number.isFinite(progress) || !Number.isFinite(durationSeconds)) {
    return null
  }
  if (durationSeconds <= 0) return null
  return clampUnit(progress) * durationSeconds
}

export function resolveVideoClipHoverSeekTime(
  progress: number,
  durationSeconds: number,
  previewFps = 12,
) {
  const rawTarget = resolveVideoClipHoverTime(progress, durationSeconds)
  if (rawTarget === null) return null
  const normalizedFps =
    Number.isFinite(previewFps) && previewFps > 0 ? previewFps : 12
  const seekStep = 1 / normalizedFps
  const endGuard = Math.min(seekStep, durationSeconds * 0.02)
  const maximumTime = Math.max(0, durationSeconds - endGuard)
  const boundedTarget = Math.min(rawTarget, maximumTime)
  return Math.min(
    Math.round(boundedTarget / seekStep) * seekStep,
    maximumTime,
  )
}

export function resolveVideoClipHoverPlaybackSource(
  lightweightSourceUrl: string | null,
  immediateSourceUrl: string | null,
) {
  return lightweightSourceUrl ?? immediateSourceUrl
}

export function resolveVideoClipHoverFrameIndex(
  progress: number,
  frameTimes: readonly number[],
  durationSeconds: number | null,
) {
  if (!Number.isFinite(progress) || frameTimes.length === 0) return null
  if (frameTimes.length === 1) return 0

  const normalizedProgress = clampUnit(progress)
  if (
    durationSeconds === null ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    frameTimes.some((time) => !Number.isFinite(time))
  ) {
    return Math.round(normalizedProgress * (frameTimes.length - 1))
  }

  const targetTime = normalizedProgress * durationSeconds
  let closestIndex = 0
  let closestDistance = Math.abs(frameTimes[0] - targetTime)
  for (let index = 1; index < frameTimes.length; index += 1) {
    const distance = Math.abs(frameTimes[index] - targetTime)
    if (distance >= closestDistance) continue
    closestIndex = index
    closestDistance = distance
  }
  return closestIndex
}
