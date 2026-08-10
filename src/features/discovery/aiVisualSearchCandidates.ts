import type { MediaAsset } from '../../data/mediaLibraryTypes'
import type { Project } from '../../data/projects'

type SearchableClip = {
  id: string
  assetId: string
  projectId: string
  filename: string
  sourceFingerprint: string
  durationSeconds: number | null
  tags: string[]
  note: string
  indexedFrames: Array<{
    id: string
    imagePath?: string
    timeSeconds: number
  }>
}

const POSTER_FRAME_ID = 'asset-poster-v1'
const POSTER_RESULT_PREFIX = 'local:poster:'

const isAbsoluteLocalPath = (value: string) =>
  value.startsWith('/') || /^[a-z]:[\\/]/i.test(value)

/** Keep this in sync with the media thumbnail sampler in the main process. */
export const getAiPosterTimeSeconds = (durationSeconds: number | null) => {
  if (!Number.isFinite(durationSeconds) || (durationSeconds ?? 0) < 0.5) {
    return 0
  }
  const duration = durationSeconds as number
  const latestSafeTime = Math.max(0, duration - 0.25)
  return Math.min(latestSafeTime, Math.min(5, Math.max(0.5, duration * 0.1)))
}

/**
 * Builds one searchable poster for an unindexed local asset. Once a full
 * visual index exists, its keyframes replace the poster so the same asset is
 * never analyzed twice in a single search pass.
 */
export function createAiVisualSearchCandidates({
  clips,
  assets,
  projects,
}: {
  clips: readonly SearchableClip[]
  assets: readonly MediaAsset[]
  projects: readonly Project[]
}): AiVisualFrameCandidate[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const selectedClipsByAsset = new Map<
    string,
    { clip: SearchableClip; project: Project }
  >()
  const seenFrames = new Set<string>()

  clips.forEach((clip) => {
    const asset = assetsById.get(clip.assetId)
    const project = projectsById.get(clip.projectId)
    if (
      !asset?.sourcePath ||
      asset.sourceFingerprint !== clip.sourceFingerprint ||
      !project ||
      (project.kind ?? 'video') !== 'video'
    ) {
      return
    }

    const assetKey = `${clip.assetId}:${clip.sourceFingerprint}`
    const current = selectedClipsByAsset.get(assetKey)
    const hasUsableIndex = clip.indexedFrames.some((frame) => frame.imagePath)
    const currentHasUsableIndex = current?.clip.indexedFrames.some(
      (frame) => frame.imagePath,
    ) ?? false
    if (!current || (!currentHasUsableIndex && hasUsableIndex)) {
      selectedClipsByAsset.set(assetKey, { clip, project })
    }
  })

  return [...selectedClipsByAsset.values()].flatMap<AiVisualFrameCandidate>(
    ({ clip, project }) => {
      const asset = assetsById.get(clip.assetId)
      if (!asset) return []

      const indexedCandidates = clip.indexedFrames.flatMap((frame) => {
        const semanticFrameKey = [
          clip.assetId,
          clip.sourceFingerprint,
          frame.id,
        ].join(':')
        if (!frame.imagePath || seenFrames.has(semanticFrameKey)) return []
        seenFrames.add(semanticFrameKey)
        return [{
          resultId: `local:frame:${clip.id}:${frame.id}`,
          assetId: clip.assetId,
          clipId: clip.id,
          projectId: clip.projectId,
          frameId: frame.id,
          sourceFingerprint: clip.sourceFingerprint,
          imagePath: frame.imagePath,
          timeSeconds: frame.timeSeconds,
          filename: clip.filename,
          projectTitle: project.title,
          tags: clip.tags,
          note: clip.note,
          analysisTier: 'visual-index',
        } satisfies AiVisualFrameCandidate]
      })
      if (indexedCandidates.length > 0) return indexedCandidates

      // Imported thumbnails live in Aurora's managed media directory. Built-in
      // relative artwork and remote URLs must never be sent to the AI bridge.
      const thumbnailPath = asset.thumbnail
      if (!thumbnailPath || !isAbsoluteLocalPath(thumbnailPath)) return []
      const semanticFrameKey = [
        clip.assetId,
        clip.sourceFingerprint,
        POSTER_FRAME_ID,
      ].join(':')
      if (seenFrames.has(semanticFrameKey)) return []
      seenFrames.add(semanticFrameKey)

      return [{
        resultId: `${POSTER_RESULT_PREFIX}${clip.id}`,
        assetId: clip.assetId,
        clipId: clip.id,
        projectId: clip.projectId,
        frameId: POSTER_FRAME_ID,
        sourceFingerprint: clip.sourceFingerprint,
        imagePath: thumbnailPath,
        timeSeconds: getAiPosterTimeSeconds(clip.durationSeconds),
        filename: clip.filename,
        projectTitle: project.title,
        tags: clip.tags,
        note: clip.note,
        analysisTier: 'thumbnail',
      } satisfies AiVisualFrameCandidate]
    },
  )
}
