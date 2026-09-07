import type {
  FrameAnnotation,
  FrameExclusion,
  MediaAsset,
  MediaVisualIndex,
  ProjectAssetRef,
  ProjectTrimRange,
} from './mediaLibraryTypes'
import type { Project } from './projects'

export const PROJECT_EDIT_MANIFEST_SCHEMA = 'aurora-edit-manifest/v1' as const

type ProjectEditRange = {
  id: string
  source: 'project-trim' | 'whole-source'
  inFrame: number
  outFrame: number | null
  inSeconds: number
  outSeconds: number | null
  durationSeconds: number | null
  inTimecode: string
  outTimecode: string | null
}

type ProjectEditVisualObservation = {
  frameId: string
  frameIndex: number
  timeSeconds: number
  timecode: string
  favorite: boolean
  rating: number
  tags: string[]
  note: string
  tagsSource: 'manual' | 'ai'
  noteSource: 'manual' | 'ai'
}

export type ProjectEditManifestMedia = {
  referenceId: string
  assetId: string
  order: number
  filename: string
  sourcePath: string | null
  sourceAvailable: boolean
  sourceFingerprint: string
  durationSeconds: number | null
  resolution: {
    label: string
    width: number | null
    height: number | null
  }
  fps: number | null
  frameCount: number | null
  codec: string
  capturedAt: string
  favorite: boolean
  projectTags: string[]
  projectNote: string
  usableRange: ProjectEditRange
  visualObservations: ProjectEditVisualObservation[]
  staleTrimRange: boolean
}

export type ProjectEditManifest = {
  schema: typeof PROJECT_EDIT_MANIFEST_SCHEMA
  generatedAt: string
  rangeEnd: 'exclusive'
  project: {
    id: string
    title: string
    subtitle: string
    description: string
    updatedAt: string
  }
  summary: {
    localMediaCount: number
    availableSourceCount: number
    trimmedMediaCount: number
    visualObservationCount: number
    excludedOnlineMediaCount: number
    staleTrimRangeCount: number
  }
  media: ProjectEditManifestMedia[]
}

type ProjectEditManifestInput = {
  project: Project
  mediaAssets: readonly MediaAsset[]
  projectAssetRefs: readonly ProjectAssetRef[]
  visualIndexes: readonly MediaVisualIndex[]
  frameAnnotations: readonly FrameAnnotation[]
  frameExclusions: readonly FrameExclusion[]
  generatedAt?: string
}

const toFrameCount = (value: string) => {
  const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

const toTimecode = (seconds: number, fps: number | null) => {
  const safeSeconds = Math.max(0, seconds)
  const nominalFps = Math.max(1, Math.round(fps ?? 24))
  const wholeSeconds = Math.floor(safeSeconds)
  const frames = Math.min(
    nominalFps - 1,
    Math.max(0, Math.round((safeSeconds - wholeSeconds) * nominalFps)),
  )
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const remainingSeconds = wholeSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}:${pad(frames)}`
}

const toTrimmedRange = (
  referenceId: string,
  range: ProjectTrimRange,
  fps: number | null,
): ProjectEditRange => ({
  id: `${referenceId}:project-trim`,
  source: 'project-trim',
  inFrame: range.inFrame,
  outFrame: range.outFrame,
  inSeconds: range.inSeconds,
  outSeconds: range.outSeconds,
  durationSeconds: range.outSeconds - range.inSeconds,
  inTimecode: toTimecode(range.inSeconds, fps),
  outTimecode: toTimecode(range.outSeconds, fps),
})

const toWholeSourceRange = (
  referenceId: string,
  asset: MediaAsset,
): ProjectEditRange => ({
  id: `${referenceId}:whole-source`,
  source: 'whole-source',
  inFrame: 0,
  outFrame: toFrameCount(asset.frameCount),
  inSeconds: 0,
  outSeconds: asset.durationSeconds,
  durationSeconds: asset.durationSeconds,
  inTimecode: toTimecode(0, asset.fpsValue),
  outTimecode:
    asset.durationSeconds === null
      ? null
      : toTimecode(asset.durationSeconds, asset.fpsValue),
})

export function createProjectEditManifest({
  project,
  mediaAssets,
  projectAssetRefs,
  visualIndexes,
  frameAnnotations,
  frameExclusions,
  generatedAt = new Date().toISOString(),
}: ProjectEditManifestInput): ProjectEditManifest {
  const assetsById = new Map(mediaAssets.map((asset) => [asset.id, asset]))
  const indexesByAssetId = new Map(
    visualIndexes.map((index) => [index.assetId, index]),
  )
  const annotationsByFrame = new Map(
    frameAnnotations.map((annotation) => [
      `${annotation.assetId}\u0000${annotation.frameId}`,
      annotation,
    ]),
  )
  const excludedFrames = new Set(
    frameExclusions.map((exclusion) =>
      `${exclusion.assetId}\u0000${exclusion.sourceFingerprint}\u0000${exclusion.frameId}`,
    ),
  )
  let excludedOnlineMediaCount = 0

  const media = projectAssetRefs
    .filter((reference) => reference.projectId === project.id)
    .sort((left, right) => left.order - right.order)
    .flatMap((reference): ProjectEditManifestMedia[] => {
      const asset = assetsById.get(reference.assetId)
      if (!asset) return []
      if (asset.online) {
        excludedOnlineMediaCount += 1
        return []
      }

      const activeTrimRange =
        reference.trimRange?.sourceFingerprint === asset.sourceFingerprint
          ? reference.trimRange
          : null
      const staleTrimRange = Boolean(reference.trimRange && !activeTrimRange)
      const visualIndex = indexesByAssetId.get(asset.id)
      const matchingVisualIndex =
        visualIndex?.sourceFingerprint === asset.sourceFingerprint
          ? visualIndex
          : null
      const visualObservations = (matchingVisualIndex?.frames ?? [])
        .filter(
          (frame) =>
            !excludedFrames.has(
              `${asset.id}\u0000${asset.sourceFingerprint}\u0000${frame.id}`,
            ) &&
            (!activeTrimRange ||
              (frame.timeSeconds >= activeTrimRange.inSeconds &&
                frame.timeSeconds < activeTrimRange.outSeconds)),
        )
        .map((frame): ProjectEditVisualObservation => {
          const annotation = annotationsByFrame.get(
            `${asset.id}\u0000${frame.id}`,
          )
          return {
            frameId: frame.id,
            frameIndex: frame.index,
            timeSeconds: frame.timeSeconds,
            timecode: toTimecode(frame.timeSeconds, asset.fpsValue),
            favorite: annotation?.favorite ?? false,
            rating: annotation?.rating ?? 0,
            tags: annotation?.tags ?? [],
            note: annotation?.note ?? '',
            tagsSource: annotation?.tagsSource ?? 'manual',
            noteSource: annotation?.noteSource ?? 'manual',
          }
        })

      return [{
        referenceId: reference.id,
        assetId: asset.id,
        order: reference.order,
        filename: asset.filename,
        sourcePath: asset.sourcePath,
        sourceAvailable: Boolean(asset.sourcePath),
        sourceFingerprint: asset.sourceFingerprint,
        durationSeconds: asset.durationSeconds,
        resolution: {
          label: asset.resolution,
          width: asset.width,
          height: asset.height,
        },
        fps: asset.fpsValue,
        frameCount: toFrameCount(asset.frameCount),
        codec: asset.codec,
        capturedAt: asset.capturedAt,
        favorite: asset.favorite,
        projectTags: reference.tags,
        projectNote: reference.note,
        usableRange: activeTrimRange
          ? toTrimmedRange(reference.id, activeTrimRange, asset.fpsValue)
          : toWholeSourceRange(reference.id, asset),
        visualObservations,
        staleTrimRange,
      }]
    })

  return {
    schema: PROJECT_EDIT_MANIFEST_SCHEMA,
    generatedAt,
    rangeEnd: 'exclusive',
    project: {
      id: project.id,
      title: project.title,
      subtitle: project.subtitle,
      description: project.description ?? '',
      updatedAt: project.updatedAt,
    },
    summary: {
      localMediaCount: media.length,
      availableSourceCount: media.filter((item) => item.sourceAvailable).length,
      trimmedMediaCount: media.filter(
        (item) => item.usableRange.source === 'project-trim',
      ).length,
      visualObservationCount: media.reduce(
        (count, item) => count + item.visualObservations.length,
        0,
      ),
      excludedOnlineMediaCount,
      staleTrimRangeCount: media.filter((item) => item.staleTrimRange).length,
    },
    media,
  }
}

const markdownValue = (value: string) =>
  value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()

export function createProjectEditManifestMarkdown(
  manifest: ProjectEditManifest,
) {
  const lines = [
    `# ${manifest.project.title} · Aurora 剪辑清单`,
    '',
    `- 生成时间：${manifest.generatedAt}`,
    `- 本地素材：${manifest.summary.localMediaCount}`,
    `- 已裁剪素材：${manifest.summary.trimmedMediaCount}`,
    `- 视觉帧记录：${manifest.summary.visualObservationCount}`,
  ]
  if (manifest.project.subtitle) {
    lines.push(`- 英文名称：${markdownValue(manifest.project.subtitle)}`)
  }
  if (manifest.project.description) {
    lines.push(`- 项目说明：${markdownValue(manifest.project.description)}`)
  }
  if (manifest.summary.excludedOnlineMediaCount > 0) {
    lines.push(`- 未写入在线素材：${manifest.summary.excludedOnlineMediaCount}`)
  }
  lines.push('')

  manifest.media.forEach((item, index) => {
    lines.push(`## ${String(index + 1).padStart(2, '0')} · ${markdownValue(item.filename)}`)
    lines.push('')
    lines.push(`- 源文件：${item.sourcePath ? markdownValue(item.sourcePath) : '当前不可用'}`)
    lines.push(`- 时长：${item.durationSeconds ?? '未知'} 秒`)
    lines.push(`- 分辨率：${markdownValue(item.resolution.label)}`)
    lines.push(`- 帧率：${item.fps ?? '未知'}`)
    lines.push(`- 编码：${markdownValue(item.codec)}`)
    lines.push(`- 项目标签：${item.projectTags.length > 0 ? item.projectTags.map(markdownValue).join('、') : '无'}`)
    lines.push(`- 项目备注：${item.projectNote ? markdownValue(item.projectNote) : '无'}`)
    lines.push('')
    lines.push('### 可用区间')
    lines.push('')
    const range = item.usableRange
    const rangeLabel = range.source === 'whole-source'
      ? '整段素材'
      : '项目裁剪范围'
    lines.push(
      `- ${rangeLabel}：${range.inTimecode} → ${range.outTimecode ?? '素材结尾'}（${range.inSeconds.toFixed(3)}s → ${range.outSeconds?.toFixed(3) ?? 'end'}s）`,
    )
    lines.push('')
    lines.push('### 视觉帧内容')
    lines.push('')
    const annotatedObservations = item.visualObservations.filter(
      (observation) =>
        observation.note ||
        observation.tags.length > 0 ||
        observation.favorite ||
        observation.rating > 0,
    )
    if (annotatedObservations.length === 0) {
      lines.push('- 暂无带文字或评级的视觉帧记录。')
    } else {
      annotatedObservations.forEach((observation) => {
        const details = [
          observation.note ? markdownValue(observation.note) : '',
          observation.tags.length > 0
            ? `标签：${observation.tags.map(markdownValue).join('、')}`
            : '',
          observation.rating > 0 ? `评级：${observation.rating} 星` : '',
          observation.favorite ? '已收藏' : '',
        ].filter(Boolean)
        lines.push(
          `- ${observation.timecode}（${observation.timeSeconds.toFixed(3)}s）：${details.join('；')}`,
        )
      })
    }
    if (item.staleTrimRange) {
      lines.push('')
      lines.push('> 已忽略属于旧版源文件的裁剪范围。')
    }
    lines.push('')
  })

  return `${lines.join('\n').trim()}\n`
}

export function createProjectEditManifestJson(
  manifest: ProjectEditManifest,
) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function getProjectEditManifestDefaultFilename(title: string) {
  const safeTitle = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${safeTitle || 'Aurora项目'}-剪辑清单.json`
}
