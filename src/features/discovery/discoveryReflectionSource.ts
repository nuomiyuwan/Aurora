import type { Project } from '../../data/projects'
import type { DiscoveryResult } from './discoveryData'

export const DISCOVERY_DETAIL_REFLECTION_ID = 'discovery-detail-panel'

export const DISCOVERY_RESULT_ALPHA_BOTTOM = 1948 / 2160
export const DISCOVERY_DETAIL_ALPHA_BOTTOM = 1688 / 1728

// Rig-local design Y. This matches the current selected slot's visible alpha
// bottom and remains fixed while individual CARD_SLOTS move above or below it.
export const DISCOVERY_RESULT_SHARED_FLOOR_Y = 731.32

export const DISCOVERY_REFLECTION_OPACITY = 0.8
export const DISCOVERY_REFLECTION_ELEVATION_FADE_START = 12
export const DISCOVERY_REFLECTION_ELEVATION_FADE_END = 320
export const DISCOVERY_REFLECTION_ELEVATION_MIN_OPACITY_FACTOR = 0.08
export const DISCOVERY_REFLECTION_ELEVATION_MAX_BLUR_TEXELS = 8
// A one-slot snake transition briefly keeps the outgoing and incoming cards
// alive together, so the renderer needs room for ten result identities plus
// the independent detail panel.
export const DISCOVERY_REFLECTION_CARD_CAPACITY = 10
export const DISCOVERY_REFLECTION_SOURCE_CAPACITY =
  DISCOVERY_REFLECTION_CARD_CAPACITY + 1

export const DISCOVERY_REFLECTION_RUNTIME_VERSION =
  'discovery-dom-reflection-v12'

const resultToProject = (result: DiscoveryResult): Project => ({
  id: result.id,
  title: result.title,
  subtitle: `${result.secondaryLabel} · ${result.resolutionLabel}`,
  cover: result.thumbnail,
  videoCount: 0,
  collectionCount: 0,
  updatedAt: `${result.timecode} · ${result.source}`,
})

export const createDiscoveryReflectionProjects = (
  results: readonly DiscoveryResult[],
  selectedResult?: DiscoveryResult | null,
): Project[] => {
  const projects = results
    .slice(0, DISCOVERY_REFLECTION_CARD_CAPACITY)
    .map(resultToProject)

  if (!selectedResult) return projects

  return [
    ...projects,
    {
      ...resultToProject(selectedResult),
      id: DISCOVERY_DETAIL_REFLECTION_ID,
    },
  ]
}
