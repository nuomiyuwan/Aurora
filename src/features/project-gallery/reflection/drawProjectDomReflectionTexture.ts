import type { Project } from '../../../data/projects'
import {
  captureDomReflectionElement,
  type DomReflectionCaptureOptions,
} from '../../video-library/drawVideoDomReflectionTexture'

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const findProjectCard = (projectId: string) => {
  const escapedId = CSS.escape(projectId)
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>(
      `.projectCard[data-project-id="${escapedId}"]`,
    ),
  )
  cards.sort((first, second) => {
    const firstOffset = Math.abs(Number.parseFloat(first.dataset.carouselOffset ?? '0'))
    const secondOffset = Math.abs(Number.parseFloat(second.dataset.carouselOffset ?? '0'))
    return firstOffset - secondOffset
  })
  return (
    cards[0] ??
    document.querySelector<HTMLElement>(
      `.galleryReflectionPreloadSource[data-project-id="${escapedId}"]`,
    )
  )
}

export async function drawProjectDomReflectionTexture(
  project: Project,
  width = 1024,
  options: Pick<DomReflectionCaptureOptions, 'resourceRevision'> = {},
) {
  let source = findProjectCard(project.id)
  if (!source) {
    await nextFrame()
    source = findProjectCard(project.id)
  }
  if (!source) throw new Error(`Unable to find project DOM reflection source: ${project.id}`)
  const captureSource =
    source.querySelector<HTMLElement>('.projectCardRasterSurface') ?? source
  const materialTintFilter = getComputedStyle(captureSource)
    .getPropertyValue('--asset-ui-tint-filter')
    .trim()
  return captureDomReflectionElement(captureSource, width, {
    resourceRevision: options.resourceRevision,
    respectBackgroundMasks: true,
    excludeBackgroundSelectors: ['.cardLight'],
    filterOverrides: [
      {
        selector: '.cardImage',
        value: 'none',
      },
      {
        selector: '.cardFrame',
        value: materialTintFilter || 'none',
      },
    ],
  })
}
