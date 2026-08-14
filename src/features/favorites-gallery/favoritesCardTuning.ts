import type { CSSProperties } from 'react'

export interface FavoritesDisplaySlotPose {
  readonly slot: 'left2' | 'left1' | 'center' | 'right1' | 'right2'
  readonly relative: -2 | -1 | 0 | 1 | 2
  readonly xVw: number
  readonly yPx: number
  readonly scale: number
  readonly rotateYDeg: number
  readonly depthPx: number
}

export const FAVORITES_CARD_SLOT_POSES = [
  {
    slot: 'left2',
    relative: -2,
    xVw: -42,
    yPx: 0,
    scale: 0.8,
    rotateYDeg: 80,
    depthPx: -260,
  },
  {
    slot: 'left1',
    relative: -1,
    xVw: -24,
    yPx: 0,
    scale: 1,
    rotateYDeg: 70,
    depthPx: -15,
  },
  {
    slot: 'center',
    relative: 0,
    xVw: 0,
    yPx: 0,
    scale: 1.2,
    rotateYDeg: 0,
    depthPx: 350,
  },
  {
    slot: 'right1',
    relative: 1,
    xVw: 25.4,
    yPx: 0,
    scale: 1,
    rotateYDeg: -70,
    depthPx: -15,
  },
  {
    slot: 'right2',
    relative: 2,
    xVw: 44.4,
    yPx: 0,
    scale: 0.8,
    rotateYDeg: -80,
    depthPx: -260,
  },
] as const satisfies readonly FavoritesDisplaySlotPose[]

interface SampledCardPose {
  xVw: number
  yPx: number
  scale: number
  rotateYDeg: number
  depthPx: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const mix = (from: number, to: number, progress: number) =>
  from + (to - from) * progress

const mixPose = (
  from: FavoritesDisplaySlotPose,
  to: FavoritesDisplaySlotPose,
  progress: number,
): SampledCardPose => ({
  xVw: mix(from.xVw, to.xVw, progress),
  yPx: mix(from.yPx, to.yPx, progress),
  scale: mix(from.scale, to.scale, progress),
  rotateYDeg: mix(from.rotateYDeg, to.rotateYDeg, progress),
  depthPx: mix(from.depthPx, to.depthPx, progress),
})

const extendOuterPose = (
  edge: FavoritesDisplaySlotPose,
  inner: FavoritesDisplaySlotPose,
  distance: number,
): SampledCardPose => ({
  xVw: edge.xVw + (edge.xVw - inner.xVw) * distance,
  yPx: edge.yPx + (edge.yPx - inner.yPx) * distance,
  scale: clamp(
    edge.scale + (edge.scale - inner.scale) * distance,
    0.38,
    1.2,
  ),
  rotateYDeg: edge.rotateYDeg,
  depthPx: edge.depthPx + (edge.depthPx - inner.depthPx) * distance,
})

const sampleManualPose = (relative: number): SampledCardPose => {
  const first = FAVORITES_CARD_SLOT_POSES[0]
  const second = FAVORITES_CARD_SLOT_POSES[1]
  const penultimate = FAVORITES_CARD_SLOT_POSES.at(-2)!
  const last = FAVORITES_CARD_SLOT_POSES.at(-1)!

  if (relative <= first.relative) {
    return extendOuterPose(first, second, first.relative - relative)
  }
  if (relative >= last.relative) {
    return extendOuterPose(last, penultimate, relative - last.relative)
  }

  for (let index = 0; index < FAVORITES_CARD_SLOT_POSES.length - 1; index += 1) {
    const from = FAVORITES_CARD_SLOT_POSES[index]
    const to = FAVORITES_CARD_SLOT_POSES[index + 1]
    if (relative < from.relative || relative > to.relative) continue
    return mixPose(
      from,
      to,
      (relative - from.relative) / (to.relative - from.relative),
    )
  }

  return mixPose(first, last, 0.5)
}

export const getFavoritesCardStyle = (
  relative: number,
  keepMotionEdgeVisible = false,
) => {
  const magnitude = Math.abs(relative)
  const pose = sampleManualPose(relative)
  const blur = Math.max(0, magnitude - 0.12) * 0.22
  const saturation = clamp(1 - magnitude * 0.11, 0.66, 1)
  const brightness = clamp(1 - magnitude * 0.12, 0.68, 1)
  const opacity = clamp(1 - Math.max(0, magnitude - 2.05) * 1.7, 0, 1)

  return {
    '--favorite-card-x': `${pose.xVw}vw`,
    '--favorite-card-y': `${pose.yPx}px`,
    '--favorite-card-scale': pose.scale,
    '--favorite-card-rotate-y': `${pose.rotateYDeg}deg`,
    '--favorite-card-depth': `${pose.depthPx}px`,
    '--favorite-card-blur': `${blur}px`,
    '--favorite-card-saturation': saturation,
    '--favorite-card-brightness': brightness,
    '--favorite-card-opacity': opacity,
    '--favorite-card-z': Math.round(1000 - magnitude * 120),
    '--reflection-opacity': 1,
    '--reflection-slot-opacity': clamp(0.88 - magnitude * 0.16, 0.44, 0.88),
    '--reflection-light-opacity': magnitude < 0.5 ? 1 : 0.82,
    '--reflection-blur-texels': Math.max(0, magnitude - 0.3) * 0.38,
    pointerEvents: magnitude <= 2.55 ? 'auto' : 'none',
    visibility:
      magnitude <= (keepMotionEdgeVisible ? 3.05 : 2.8)
        ? 'visible'
        : 'hidden',
  } as CSSProperties
}
