import { expect, test } from '@playwright/test'
import {
  getFavoritesCarouselSlots,
  type FavoritesCarouselDirection,
} from '../src/features/favorites-gallery/favoritesCarouselLayout'

const wrapIndex = (index: number, count: number) =>
  (index + count) % count

const visibleLayout = (
  itemCount: number,
  activeIndex: number,
  direction: FavoritesCarouselDirection,
  progress: number,
) =>
  getFavoritesCarouselSlots(itemCount, true, direction, progress)
    .filter((slot) => slot.opacityScale > 0.999)
    .map((slot) => ({
      itemIndex: wrapIndex(activeIndex + slot.offset, itemCount),
      relative: slot.offset + progress,
    }))
    .sort((first, second) => first.relative - second.relative)

for (const itemCount of [2, 3, 4]) {
  for (const direction of [-1, 1] as const) {
    test(`${itemCount} favorites recycle continuously after dragging ${direction < 0 ? 'left' : 'right'}`, () => {
      const restingSlots = getFavoritesCarouselSlots(
        itemCount,
        false,
        0,
        0,
      )
      expect(restingSlots).toHaveLength(itemCount)
      expect(
        new Set(
          restingSlots.map((slot) =>
            wrapIndex(slot.offset, itemCount),
          ),
        ).size,
      ).toBe(itemCount)

      const movingSlots = getFavoritesCarouselSlots(
        itemCount,
        true,
        direction,
        direction,
      )
      expect(movingSlots).toHaveLength(itemCount + 1)
      expect(movingSlots.filter((slot) => slot.transient)).toHaveLength(1)

      const step = direction < 0 ? 1 : -1
      expect(visibleLayout(itemCount, 0, direction, direction)).toEqual(
        visibleLayout(itemCount, wrapIndex(step, itemCount), 0, 0),
      )
    })
  }
}
