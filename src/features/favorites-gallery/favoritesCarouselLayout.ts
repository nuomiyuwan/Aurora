export type FavoritesCarouselDirection = -1 | 0 | 1

export interface FavoritesCarouselSlot {
  offset: number
  opacityScale: number
  transient: boolean
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const smoothstep = (value: number) => {
  const progress = clamp(value, 0, 1)
  return progress * progress * (3 - 2 * progress)
}

const getBaseOffsets = (itemCount: number) => {
  if (itemCount <= 0) return []
  if (itemCount === 1) return [0]
  if (itemCount === 2) return [0, 1]
  if (itemCount === 3) return [-1, 0, 1]
  if (itemCount === 4) return [-1, 0, 1, 2]
  return [-2, -1, 0, 1, 2]
}

export function getFavoritesCarouselSlots(
  itemCount: number,
  realtimeMotion: boolean,
  direction: FavoritesCarouselDirection,
  progress: number,
): FavoritesCarouselSlot[] {
  const baseOffsets = getBaseOffsets(itemCount)
  if (itemCount <= 1 || !realtimeMotion) {
    return baseOffsets.map((offset) => ({
      offset,
      opacityScale: 1,
      transient: false,
    }))
  }

  if (itemCount >= 5) {
    return [-3, -2, -1, 0, 1, 2, 3].map((offset) => ({
      offset,
      opacityScale: 1,
      transient: Math.abs(offset) === 3,
    }))
  }

  if (direction === 0) {
    return baseOffsets.map((offset) => ({
      offset,
      opacityScale: 1,
      transient: false,
    }))
  }

  const blend = smoothstep(Math.abs(progress))
  const firstOffset = baseOffsets[0]
  const lastOffset = baseOffsets.at(-1)!
  const outgoingOffset = direction < 0 ? firstOffset : lastOffset
  const incomingOffset = direction < 0 ? lastOffset + 1 : firstOffset - 1
  const offsets = direction < 0
    ? [...baseOffsets, incomingOffset]
    : [incomingOffset, ...baseOffsets]

  return offsets.map((offset) => ({
    offset,
    opacityScale:
      offset === outgoingOffset
        ? 1 - blend
        : offset === incomingOffset
          ? blend
          : 1,
    transient: offset === incomingOffset,
  }))
}
