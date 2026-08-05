import type { Project } from '../../data/projects'
import {
  captureDomReflectionElement,
  type DomReflectionCaptureOptions,
} from '../video-library/drawVideoDomReflectionTexture'
import { FRAME_RING_ALPHA_BOTTOM } from './frameRingReflectionProjection'

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const findFrameRingReflectionSource = (projectId: string) => {
  if (projectId === 'frame-ring-preview') {
    return document.querySelector<HTMLElement>(
      '.frameRingPreview[data-reflection-project-id="frame-ring-preview"]',
    )
  }
  if (projectId === 'frame-ring-info') {
    return document.querySelector<HTMLElement>(
      '.frameRingInfoPanel[data-frame-info-visible="true"]',
    )
  }
  if (projectId === 'frame-ring-action') {
    return document.querySelector<HTMLElement>(
      '.frameRingActionPanel[data-frame-action-visible="true"]',
    )
  }

  const escapedId = CSS.escape(projectId)
  return document.querySelector<HTMLElement>(
    `.frameRingCard[data-frame-id="${escapedId}"]`,
  )
}

export type FrameRingReflectionFilters = {
  materialTintFilter?: string
  pageColorGradeFilter?: string
}

const createFrameRingCaptureOptions = (
  projectId: string,
  source: HTMLElement,
  filters: FrameRingReflectionFilters,
  excludeLiveVideo: boolean,
): DomReflectionCaptureOptions => {
  const materialTintFilter =
    filters.materialTintFilter ??
    getComputedStyle(source)
      .getPropertyValue('--asset-ui-tint-filter')
      .trim()
  const pageColorGradeFilter = filters.pageColorGradeFilter?.trim() || 'none'
  const floatingPanelChromeSelector =
    projectId === 'frame-ring-info'
      ? '.frameRingInfoChrome'
      : projectId === 'frame-ring-action'
        ? '.frameRingActionChrome'
        : ''
  const filterOverrides = [
    { selector: '.frameRingCard', value: 'none' },
    {
      selector:
        '.frameRingCardMedia, .frameRingCardTime, .frameRingPreviewMedia, .frameRingPreviewTime, .frameRingPreviewResolution',
      value: pageColorGradeFilter,
    },
    {
      selector: '.frameRingCardFrame, .frameRingPreviewFrame',
      value:
        [materialTintFilter, pageColorGradeFilter]
          .filter((value) => value && value !== 'none')
          .join(' ') || 'none',
    },
    {
      selector:
        '.frameRingInfoPanel > :not(.frameRingInfoBackdrop, .frameRingInfoChrome), .frameRingActionPanel > :not(.frameRingActionBackdrop, .frameRingActionChrome)',
      value: pageColorGradeFilter,
    },
  ]
  if (floatingPanelChromeSelector) {
    filterOverrides.push({
      selector: floatingPanelChromeSelector,
      value:
        [materialTintFilter, pageColorGradeFilter]
          .filter((value) => value && value !== 'none')
          .join(' ') || 'none',
    })
  }

  return {
    respectBackgroundMasks: true,
    excludeSelectors: [
      '.frameRingCardLight',
      '.frameRingPreviewLight',
      '.frameRingPreviewRange',
      '.frameRingPreviewOnlinePlayer',
      ...(excludeLiveVideo ? ['.frameRingPreviewVideo'] : []),
    ],
    styleOverrides:
      projectId === 'frame-ring-preview'
        ? [
            {
              selector: '[data-frame-preview-controls-reflection-proxy="true"]',
              properties: { opacity: '1' },
            },
          ]
        : undefined,
    filterOverrides,
  }
}

const resolveFrameRingReflectionSource = async (projectId: string) => {
  let source = findFrameRingReflectionSource(projectId)
  if (!source) {
    await nextFrame()
    source = findFrameRingReflectionSource(projectId)
  }
  if (!source) {
    throw new Error(`Unable to find frame ring DOM reflection source: ${projectId}`)
  }
  return source
}

const padFloatingPanelSource = (source: HTMLCanvasElement) => {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = Math.ceil(source.height / FRAME_RING_ALPHA_BOTTOM)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable')
  context.drawImage(source, 0, 0)
  return canvas
}

export async function drawFrameRingReflectionSource(
  project: Project,
  width = 1024,
  filters: FrameRingReflectionFilters = {},
) {
  const source = await resolveFrameRingReflectionSource(project.id)

  const captured = await captureDomReflectionElement(
    source,
    width,
    createFrameRingCaptureOptions(project.id, source, filters, false),
  )
  return project.id === 'frame-ring-info' || project.id === 'frame-ring-action'
    ? padFloatingPanelSource(captured)
    : captured
}

export async function drawFrameRingPreviewChromeSource(
  width = 768,
  filters: FrameRingReflectionFilters = {},
) {
  const source = await resolveFrameRingReflectionSource('frame-ring-preview')
  return captureDomReflectionElement(
    source,
    width,
    createFrameRingCaptureOptions(
      'frame-ring-preview',
      source,
      filters,
      true,
    ),
  )
}
