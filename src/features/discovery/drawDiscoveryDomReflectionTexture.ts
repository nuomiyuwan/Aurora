import type { Project } from '../../data/projects'
import { captureDomReflectionElement } from '../video-library/drawVideoDomReflectionTexture'
import { DISCOVERY_DETAIL_REFLECTION_ID } from './discoveryReflectionSource'

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const findActiveDiscoveryView = () =>
  document.querySelector<HTMLElement>(
    '.discoveryView[data-page-active="true"]',
  )

const findDiscoveryReflectionSource = (projectId: string) => {
  const activeView = findActiveDiscoveryView()
  if (!activeView) return null

  if (projectId === DISCOVERY_DETAIL_REFLECTION_ID) {
    return activeView.querySelector<HTMLElement>(
      '.discoveryDetailPanel[data-discovery-detail-reflection]',
    )
  }

  const escapedId = CSS.escape(projectId)
  return activeView.querySelector<HTMLElement>(
    `.discoveryResultVisual[data-discovery-reflection-id="${escapedId}"]`,
  )
}

export async function drawDiscoveryDomReflectionTexture(
  project: Project,
  width = 1024,
) {
  let source = findDiscoveryReflectionSource(project.id)
  if (!source) {
    await nextFrame()
    source = findDiscoveryReflectionSource(project.id)
  }
  if (!source) {
    throw new Error(
      `Unable to find Discovery DOM reflection source: ${project.id}`,
    )
  }
  const materialTintFilter = getComputedStyle(source)
    .getPropertyValue('--asset-ui-tint-filter')
    .trim()

  return captureDomReflectionElement(source, width, {
    excludePageGrade: true,
    respectBackgroundMasks: true,
    filterOverrides: [
      {
        selector: '.discoveryResultVisual',
        value: 'drop-shadow(0 18px 34px rgba(0, 0, 0, 0.32))',
      },
      {
        selector: '.discoveryResultMedia',
        value: 'brightness(1) saturate(1)',
      },
      {
        selector: '.discoveryResultFrame',
        value: materialTintFilter || 'none',
      },
    ],
  })
}
