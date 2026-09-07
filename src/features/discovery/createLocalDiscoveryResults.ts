import type {
  FrameAnnotation,
  ProjectTrimRange,
} from '../../data/mediaLibraryTypes'
import type { ModelAsset } from '../../data/modelLibraryTypes'
import { getModelAssetFormatLabel } from '../../data/modelLibraryTypes'
import {
  getDefaultProjectDescription,
  type Project,
} from '../../data/projects'
import { formatFrameRingTimecode } from '../frame-ring/frameRingData'
import type {
  DiscoveryFootageResult,
  DiscoveryModelResult,
  DiscoveryVisualIndexSummary,
} from './discoveryData'

export type LocalDiscoveryClip = {
  id: string
  assetId: string
  projectId: string
  filename: string
  thumbnail: string
  duration: string
  durationSeconds: number | null
  trimRange?: ProjectTrimRange | null
  resolution: string
  width: number | null
  height: number | null
  fps: string
  fpsValue: number | null
  size: string
  codec: string
  camera: string
  capturedAt: string
  sourcePath: string | null
  favorite: boolean
  tags: string[]
  note: string
  indexedFrames: Array<{
    id: string
    index: number
    thumbnail: string
    timeSeconds: number
    imagePath?: string
  }>
}

type CreateLocalDiscoveryResultsOptions = {
  clips: readonly LocalDiscoveryClip[]
  models?: readonly ModelAsset[]
  projects: readonly Project[]
  frameAnnotations: readonly FrameAnnotation[]
  includeUnannotatedFrames?: boolean
}

const hasMeaningfulAnnotation = (annotation: FrameAnnotation) =>
  annotation.favorite ||
  annotation.rating > 0 ||
  annotation.tags.length > 0 ||
  annotation.note.trim().length > 0

const uniqueText = (...groups: readonly string[][]) => {
  const seen = new Set<string>()
  return groups.flatMap((group) =>
    group.flatMap((value) => {
      const trimmed = value.trim()
      const key = trimmed.toLocaleLowerCase('zh-CN')
      if (!trimmed || seen.has(key)) return []
      seen.add(key)
      return [trimmed]
    }),
  )
}

const getResolution = (clip: LocalDiscoveryClip) =>
  clip.width && clip.height
    ? `${clip.width} × ${clip.height}`
    : clip.resolution || '待分析'

const getResolutionLabel = (
  clip: Pick<LocalDiscoveryClip, 'width' | 'height' | 'resolution'>,
): DiscoveryFootageResult['resolutionLabel'] => {
  const parsed = clip.resolution.match(/(\d+)\s*[x×]\s*(\d+)/i)
  const width = clip.width ?? (parsed ? Number.parseInt(parsed[1], 10) : 0)
  const height = clip.height ?? (parsed ? Number.parseInt(parsed[2], 10) : 0)
  return width >= 3000 || height >= 1700 ? '4K' : '1080P'
}

const getProjectDescription = (project: Project) =>
  project.description ?? getDefaultProjectDescription(project.kind)

const formatFileSize = (sizeBytes: number) => {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '待分析'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  const unitIndex = Math.min(
    units.length - 1,
    Math.floor(Math.log(sizeBytes) / Math.log(1024)),
  )
  const value = sizeBytes / 1024 ** unitIndex
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

const formatModelDimensions = (model: ModelAsset) => {
  if (!model.dimensions) return '待分析'
  const formatDimension = (value: number) =>
    Number.isFinite(value)
      ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
      : '—'
  return [model.dimensions.x, model.dimensions.y, model.dimensions.z]
    .map(formatDimension)
    .join(' × ')
}

const getVisualIndexSummary = (
  clip: LocalDiscoveryClip,
  annotations: readonly FrameAnnotation[],
): DiscoveryVisualIndexSummary => ({
  status: clip.indexedFrames.length > 0 ? 'ready' : 'not-created',
  keyframeCount: clip.indexedFrames.length,
  highlightCount: annotations.filter((annotation) => annotation.rating >= 4)
    .length,
  favoriteCount: annotations.filter((annotation) => annotation.favorite)
    .length,
})

const createFootageDetails = (
  clip: LocalDiscoveryClip,
  project: Project,
): DiscoveryFootageResult['footage'] => ({
  filename: clip.filename,
  project: project.title,
  auroraProjectId: project.id,
  auroraClipId: clip.id,
  codec: clip.codec || '待分析',
  fps: clip.fps || '待分析',
  size: clip.size || '待分析',
  camera: clip.camera || '未写入',
  capturedAt: clip.capturedAt || '待分析',
  sourcePath: clip.sourcePath || 'Aurora 管理的本地素材',
  sourcePathAvailable: Boolean(clip.sourcePath),
})

const createModelResult = (
  model: ModelAsset,
  project: Project,
): DiscoveryModelResult => {
  const projectDescription = getProjectDescription(project)
  const dimensions = formatModelDimensions(model)
  const format = getModelAssetFormatLabel(model.format)
  return {
    id: `local:model:${model.id}`,
    title: model.filename.replace(/\.[^.]+$/, ''),
    secondaryLabel: `${project.title} · ${model.filename}`,
    sourceCollection: project.title,
    thumbnail: model.thumbnail || project.cover,
    timecode: '三维模型',
    duration: '静态资产',
    resolution: dimensions,
    resolutionLabel: format,
    source: 'local',
    detailType: 'model',
    kind: 'model',
    description: model.note.trim() || projectDescription,
    tags: uniqueText(model.tags),
    searchTerms: [projectDescription, format],
    previewProgress: 0,
    model: {
      filename: model.filename,
      project: project.title,
      auroraProjectId: project.id,
      auroraModelId: model.id,
      format,
      size: formatFileSize(model.sizeBytes),
      importedAt: model.importedAt || '待分析',
      sourcePath: model.sourcePath || 'Aurora 管理的本地三维资产',
      sourcePathAvailable: Boolean(model.sourcePath),
      vertexCount: model.vertexCount,
      triangleCount: model.triangleCount,
      nodeCount: model.nodeCount,
      materialCount: model.materialCount,
      textureCount: model.textureCount,
      dimensions,
    },
    visualIndex: {
      status: 'not-created',
      keyframeCount: 0,
      highlightCount: 0,
      favoriteCount: 0,
    },
  }
}

export function createLocalDiscoveryResults({
  clips,
  models = [],
  projects,
  frameAnnotations,
  includeUnannotatedFrames = false,
}: CreateLocalDiscoveryResultsOptions): Array<
  DiscoveryFootageResult | DiscoveryModelResult
> {
  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const annotationsByAssetId = new Map<string, FrameAnnotation[]>()
  frameAnnotations.forEach((annotation) => {
    const current = annotationsByAssetId.get(annotation.assetId) ?? []
    current.push(annotation)
    annotationsByAssetId.set(annotation.assetId, current)
  })

  const footageResults: DiscoveryFootageResult[] = clips.flatMap((clip) => {
    const project = projectsById.get(clip.projectId)
    if (!project || (project.kind ?? 'video') !== 'video') return []

    const visibleFrameIds = new Set(
      clip.indexedFrames.map((frame) => frame.id),
    )
    const annotations = (annotationsByAssetId.get(clip.assetId) ?? []).filter(
      (annotation) => visibleFrameIds.has(annotation.frameId),
    )
    const annotationsByFrameId = new Map(
      annotations.map((annotation) => [annotation.frameId, annotation]),
    )
    const fps = clip.fpsValue && clip.fpsValue > 0 ? clip.fpsValue : 24
    const duration = clip.durationSeconds && clip.durationSeconds > 0
      ? formatFrameRingTimecode(clip.durationSeconds, fps)
      : clip.duration || '待分析'
    const resolution = getResolution(clip)
    const resolutionLabel = getResolutionLabel(clip)
    const projectDescription = getProjectDescription(project)
    const visualIndex = getVisualIndexSummary(clip, annotations)
    const footage = createFootageDetails(clip, project)
    const clipResult: DiscoveryFootageResult = {
      id: `local:clip:${clip.id}`,
      title: clip.filename.replace(/\.[^.]+$/, ''),
      secondaryLabel: `${project.title} · ${clip.filename}`,
      sourceCollection: project.title,
      thumbnail: clip.thumbnail,
      timecode: '00:00:00:00',
      duration,
      resolution,
      resolutionLabel,
      source: 'local',
      detailType: 'footage',
      kind: 'clip',
      description: clip.note.trim() || projectDescription,
      tags: uniqueText(clip.tags),
      searchTerms: [projectDescription],
      previewProgress: 0,
      footage,
      visualIndex,
    }

    const frameResults = clip.indexedFrames.flatMap((frame) => {
      const annotation = annotationsByFrameId.get(frame.id)
      if (
        !includeUnannotatedFrames &&
        (!annotation || !hasMeaningfulAnnotation(annotation))
      ) {
        return []
      }
      const timecode = formatFrameRingTimecode(frame.timeSeconds, fps)
      const playbackStartSeconds = clip.trimRange?.inSeconds ?? 0
      const previewProgress = clip.durationSeconds && clip.durationSeconds > 0
        ? Math.min(
            100,
            Math.max(
              0,
              (frame.timeSeconds - playbackStartSeconds) /
                clip.durationSeconds * 100,
            ),
          )
        : 0
      return [{
        ...clipResult,
        id: `local:frame:${clip.id}:${frame.id}`,
        title: `${clipResult.title} · ${timecode}`,
        secondaryLabel: `${project.title} · ${clip.filename} · ${timecode}`,
        thumbnail: frame.thumbnail || clip.thumbnail,
        timecode,
        kind: 'frame' as const,
        description:
          annotation?.note.trim() || clip.note.trim() || projectDescription,
        tags: uniqueText(annotation?.tags ?? [], clip.tags),
        searchTerms: [projectDescription, clip.note],
        previewProgress,
        footage: {
          ...footage,
          auroraFrameId: frame.id,
          auroraTimeSeconds: frame.timeSeconds,
        },
      } satisfies DiscoveryFootageResult]
    })

    return [clipResult, ...frameResults]
  })
  const modelResults: DiscoveryModelResult[] = models.flatMap((model) => {
    const project = projectsById.get(model.projectId)
    if (!project || project.kind !== '3d') return []
    return [createModelResult(model, project)]
  })

  return [...footageResults, ...modelResults]
}
