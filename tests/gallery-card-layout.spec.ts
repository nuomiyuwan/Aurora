import { expect, test } from '@playwright/test'
import {
  GALLERY_GROUND_Y_RATIO,
  HOME_CARD_ALPHA_BOTTOM,
  HOME_CARD_ALPHA_BOUNDS,
  HOME_CARD_BASE_HEIGHT,
  getGroundedCardTopCss,
  getHomeCardAlphaBottomLocalY,
  getHomeCardAlphaBottomOffset,
} from '../src/features/project-gallery/galleryCardLayout'

test('uses the measured home-card alpha bounds as geometry truth', () => {
  expect(HOME_CARD_ALPHA_BOUNDS).toEqual({
    left: 61,
    top: 103,
    right: 1386,
    bottom: 974,
  })
  expect(HOME_CARD_ALPHA_BOTTOM).toBeCloseTo(974 / 1080, 12)
  expect(getHomeCardAlphaBottomLocalY(1080)).toBe(974)
})

test('derives one responsive CSS ground from scaled alpha content', () => {
  expect(GALLERY_GROUND_Y_RATIO).toBe(0.72)
  expect(HOME_CARD_BASE_HEIGHT).toBeCloseTo((610 * 1080) / 1448, 12)
  expect(getHomeCardAlphaBottomOffset(1)).toBeCloseTo(182.8314917127, 9)
  expect(getGroundedCardTopCss(1)).toBe('calc(72% - 182.8315px)')
})

test('keeps differently scaled cards on the same effective bottom', () => {
  const renderScales = [
    0.4006557377,
    0.6683278689,
    0.6996983607,
    0.9398360656,
    1.3,
  ]

  for (const stageHeight of [720, 941, 1100, 1440]) {
    for (const renderScale of renderScales) {
      const offset = getHomeCardAlphaBottomOffset(renderScale)
      const top = stageHeight * GALLERY_GROUND_Y_RATIO - offset
      expect(top + offset).toBeCloseTo(
        stageHeight * GALLERY_GROUND_Y_RATIO,
        8,
      )
    }
  }
})
