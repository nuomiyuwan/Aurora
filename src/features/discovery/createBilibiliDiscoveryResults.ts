import type {
  MediaAsset,
  ProjectAssetRef,
} from '../../data/mediaLibraryTypes'
import { isOnlineMediaAsset } from '../../data/mediaLibrarySelectors'
import type { Project } from '../../data/projects'
import type { DiscoveryOnlineVideoResult } from './discoveryData'

export type CreateBilibiliDiscoveryResultsOptions = {
  mediaAssets: readonly MediaAsset[]
  projectAssetRefs: readonly ProjectAssetRef[]
  projects: readonly Project[]
  resolveThumbnailUrl?: (thumbnail: string) => string
  selectedAssetId?: string | null
  transientAssetIds?: readonly string[]
}

const uniqueText = (values: readonly string[]) => {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const trimmed = value.trim()
    const key = trimmed.toLocaleLowerCase('zh-CN')
    if (!trimmed || seen.has(key)) return []
    seen.add(key)
    return [trimmed]
  })
}

export function createBilibiliDiscoveryResults({
  mediaAssets,
  projectAssetRefs,
  projects,
  resolveThumbnailUrl = (thumbnail) => thumbnail,
  selectedAssetId = null,
  transientAssetIds = [],
}: CreateBilibiliDiscoveryResultsOptions): DiscoveryOnlineVideoResult[] {
  const transientAssetIdSet = new Set(transientAssetIds)
  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const referencesByAssetId = new Map<string, ProjectAssetRef[]>()
  projectAssetRefs.forEach((reference) => {
    if (!projectsById.has(reference.projectId)) return
    const current = referencesByAssetId.get(reference.assetId) ?? []
    current.push(reference)
    referencesByAssetId.set(reference.assetId, current)
  })

  return mediaAssets.flatMap((asset) => {
    if (!isOnlineMediaAsset(asset) || asset.online.provider !== 'bilibili') {
      return []
    }

    const references = referencesByAssetId.get(asset.id) ?? []
    if (
      references.length === 0 &&
      !asset.favorite &&
      asset.id !== selectedAssetId &&
      !transientAssetIdSet.has(asset.id)
    ) {
      return []
    }

    const projectIds = uniqueText(
      references.map((reference) => reference.projectId),
    )
    const projectTitles = uniqueText(
      projectIds.flatMap((projectId) => {
        const project = projectsById.get(projectId)
        return project ? [project.title] : []
      }),
    )
    const tags = uniqueText(
      references.flatMap((reference) => reference.tags),
    )
    const notes = uniqueText(references.map((reference) => reference.note))
    const description = notes.join('；') || asset.online.description
    const sourceCollection = projectTitles.join(' · ') || 'B站'
    const thumbnail = asset.thumbnail?.trim()
      ? resolveThumbnailUrl(asset.thumbnail)
      : ''

    return [{
      id: `bilibili:${asset.online.kind}:${asset.online.mediaId}`,
      title: asset.filename.trim() || asset.online.mediaId,
      secondaryLabel: uniqueText([
        asset.online.author,
        ...projectTitles,
      ]).join(' · '),
      sourceCollection,
      thumbnail,
      timecode: asset.online.kind === 'episode' ? '番剧剧集' : '在线视频',
      duration: asset.duration || '待分析',
      resolution: asset.resolution || '在线',
      resolutionLabel: 'ONLINE',
      source: 'bilibili',
      detailType: 'online-video',
      kind: 'clip',
      description,
      tags,
      searchTerms: uniqueText([
        ...projectTitles,
        ...projectIds,
        ...notes,
        asset.online.description,
        asset.online.author,
        asset.online.mediaId,
        asset.online.canonicalUrl,
      ]),
      previewProgress: 0,
      online: {
        provider: 'bilibili',
        mediaKind: asset.online.kind,
        mediaId: asset.online.mediaId,
        bvid: asset.online.kind === 'video' ? asset.online.mediaId : null,
        episodeId:
          asset.online.kind === 'episode' ? asset.online.mediaId : null,
        canonicalUrl: asset.online.canonicalUrl,
        author: asset.online.author,
        publishedAt: asset.online.publishedAt,
        auroraAssetId: asset.id,
        favorite: asset.favorite,
        projectIds,
      },
      visualIndex: {
        status: 'not-created',
        keyframeCount: 0,
        highlightCount: 0,
        favoriteCount: 0,
      },
    } satisfies DiscoveryOnlineVideoResult]
  })
}
