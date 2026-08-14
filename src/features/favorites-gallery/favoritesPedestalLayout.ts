import {
  getHomeCardAlphaBottomLocalY,
} from '../project-gallery/galleryCardLayout'
import { FAVORITES_PEDESTAL_AXIS_THICKNESS } from './favoritesPedestalGeometry'

export const FAVORITES_PEDESTAL_WIDTH_TO_CARD = 0.95
export const FAVORITES_PEDESTAL_HEIGHT_TO_WIDTH = 0.045
export const FAVORITES_PEDESTAL_CARD_INSERTION = 0.035
export const FAVORITES_CARD_VERTICAL_OFFSET_PX = 5

export const getFavoritesPedestalLayout = (
  cardWidth: number,
  cardHeight: number,
) => {
  const cardAlphaBottomY = getHomeCardAlphaBottomLocalY(cardHeight)
  const width = cardWidth * FAVORITES_PEDESTAL_WIDTH_TO_CARD
  const height = width * FAVORITES_PEDESTAL_HEIGHT_TO_WIDTH
  const insertion = height * FAVORITES_PEDESTAL_CARD_INSERTION
  const cardLift = height - insertion
  const topY = cardAlphaBottomY - height
  const bottomY = cardAlphaBottomY

  return {
    width,
    height,
    insertion,
    cardLift,
    topY,
    centerY: (topY + bottomY) / 2,
    bottomY,
  }
}

export const FAVORITES_CARD_HOLDER_LIFT_TO_CARD_WIDTH =
  FAVORITES_PEDESTAL_WIDTH_TO_CARD *
  FAVORITES_PEDESTAL_HEIGHT_TO_WIDTH *
  (1 - FAVORITES_PEDESTAL_CARD_INSERTION)

/** Card strip hidden inside the rendered pedestal, relative to card width. */
export const FAVORITES_CARD_INSERTION_CLIP_TO_CARD_WIDTH =
  FAVORITES_PEDESTAL_WIDTH_TO_CARD *
    FAVORITES_PEDESTAL_HEIGHT_TO_WIDTH *
    FAVORITES_PEDESTAL_AXIS_THICKNESS.y -
  FAVORITES_CARD_HOLDER_LIFT_TO_CARD_WIDTH

/** Visible pedestal height in card-width units, including the tuned Y axis. */
export const FAVORITES_PEDESTAL_RENDER_HEIGHT_TO_CARD_WIDTH =
  FAVORITES_PEDESTAL_WIDTH_TO_CARD *
  FAVORITES_PEDESTAL_HEIGHT_TO_WIDTH *
  FAVORITES_PEDESTAL_AXIS_THICKNESS.y
