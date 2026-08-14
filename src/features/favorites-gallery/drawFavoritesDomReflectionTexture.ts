import type { Project } from '../../data/projects'
import {
  captureDomReflectionElement,
  type DomReflectionCaptureOptions,
} from '../video-library/drawVideoDomReflectionTexture'
import { HOME_CARD_ALPHA_BOTTOM } from '../project-gallery/galleryCardLayout'
import {
  FAVORITES_CARD_HOLDER_LIFT_TO_CARD_WIDTH,
  FAVORITES_CARD_VERTICAL_OFFSET_PX,
  FAVORITES_PEDESTAL_HEIGHT_TO_WIDTH,
  FAVORITES_PEDESTAL_WIDTH_TO_CARD,
} from './favoritesPedestalLayout'
import { FAVORITES_PEDESTAL_AXIS_THICKNESS } from './favoritesPedestalGeometry'

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const findFavoriteCard = (itemId: string) => {
  const escapedId = CSS.escape(itemId)
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>(
      `.favoritesGalleryCard[data-item-id="${escapedId}"]`,
    ),
  )
  cards.sort(
    (first, second) =>
      Math.abs(Number.parseFloat(first.dataset.relative ?? '0')) -
      Math.abs(Number.parseFloat(second.dataset.relative ?? '0')),
  )
  return cards[0]
}

const waitForFavoriteCard = async (itemId: string) => {
  let source = findFavoriteCard(itemId)
  if (!source) {
    await nextFrame()
    source = findFavoriteCard(itemId)
  }
  if (!source) {
    throw new Error(
      `Unable to find favorites DOM reflection source: ${itemId}`,
    )
  }
  return source
}

export async function drawFavoritesDomReflectionTexture(
  project: Project,
  width = 1024,
  options: Pick<DomReflectionCaptureOptions, 'resourceRevision'> = {},
) {
  const source = await waitForFavoriteCard(project.id)

  const captureSource =
    source.querySelector<HTMLElement>('.favoritesCardRaster') ?? source
  const materialTintFilter = getComputedStyle(captureSource)
    .getPropertyValue('--asset-ui-tint-filter')
    .trim()

  const cardCanvas = await captureDomReflectionElement(captureSource, width, {
    resourceRevision: options.resourceRevision,
    respectBackgroundMasks: true,
    styleOverrides: [
      {
        selector: '.favoritesCardRaster',
        properties: {
          transform: 'none',
        },
      },
    ],
    filterOverrides: [
      { selector: '.favoritesCardCover', value: 'none' },
      {
        selector: '.favoritesCardFrame',
        value: materialTintFilter || 'none',
      },
      { selector: '.favoritesCardCopy', value: 'none' },
    ],
  })

  const combined = document.createElement('canvas')
  combined.width = cardCanvas.width
  combined.height = cardCanvas.height
  const context = combined.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable')

  const cardLift =
    combined.width * FAVORITES_CARD_HOLDER_LIFT_TO_CARD_WIDTH
  const pedestalWidth =
    combined.width * FAVORITES_PEDESTAL_WIDTH_TO_CARD
  const pedestalHeight =
    pedestalWidth * FAVORITES_PEDESTAL_HEIGHT_TO_WIDTH
  const pedestalRenderHeight =
    pedestalHeight * FAVORITES_PEDESTAL_AXIS_THICKNESS.y
  const pedestalTopY =
    combined.height * HOME_CARD_ALPHA_BOTTOM - pedestalRenderHeight

  context.clearRect(0, 0, combined.width, combined.height)
  /* Capture the complete card first, then let the opaque pedestal paint over
   * the inserted strip exactly as it does in the visible scene. */
  context.drawImage(
    cardCanvas,
    0,
    -cardLift + FAVORITES_CARD_VERTICAL_OFFSET_PX,
  )
  /* Match the visible DOM crop: the card stops at the pedestal's top plane,
   * so neither the inserted strip nor its bottom light enters the reflection. */
  context.clearRect(
    0,
    pedestalTopY,
    combined.width,
    combined.height - pedestalTopY,
  )

  return combined
}
