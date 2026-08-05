export const HOME_CARD_SOURCE_WIDTH = 1448
export const HOME_CARD_SOURCE_HEIGHT = 1080
export const HOME_CARD_ALPHA_BOUNDS = {
  left: 61,
  top: 103,
  right: 1386,
  bottom: 974,
} as const

export const HOME_CARD_ALPHA_BOTTOM =
  HOME_CARD_ALPHA_BOUNDS.bottom / HOME_CARD_SOURCE_HEIGHT
export const HOME_CARD_BASE_WIDTH = 610
export const HOME_CARD_BASE_HEIGHT =
  (HOME_CARD_BASE_WIDTH * HOME_CARD_SOURCE_HEIGHT) / HOME_CARD_SOURCE_WIDTH
export const GALLERY_GROUND_Y_RATIO = 0.72

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

export const getHomeCardAlphaBottomLocalY = (cardHeight: number) =>
  Math.max(0, finiteOr(cardHeight, 0)) * HOME_CARD_ALPHA_BOTTOM

export const getHomeCardAlphaBottomOffset = (
  renderScale: number,
  cardHeight = HOME_CARD_BASE_HEIGHT,
) =>
  Math.max(0, finiteOr(renderScale, 0)) *
  Math.max(0, finiteOr(cardHeight, HOME_CARD_BASE_HEIGHT)) *
  (HOME_CARD_ALPHA_BOTTOM - 0.5)

export const getGroundedCardTopCss = (
  renderScale: number,
  groundRatio = GALLERY_GROUND_Y_RATIO,
) => {
  const safeGroundRatio = Math.max(
    0,
    Math.min(1, finiteOr(groundRatio, GALLERY_GROUND_Y_RATIO)),
  )
  const offset = getHomeCardAlphaBottomOffset(renderScale)
  return `calc(${safeGroundRatio * 100}% - ${offset.toFixed(4)}px)`
}
