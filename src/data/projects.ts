export type ProjectKind = 'video' | '3d'

export type Project = {
  id: string
  /** Existing projects without this field are treated as video projects. */
  kind?: ProjectKind
  title: string
  /** Optional English display name. An empty string hides it in the UI. */
  subtitle: string
  /** Custom project summary. Missing values use the project-kind default. */
  description?: string
  /** Project cover URL. An empty string means the project has no cover. */
  cover: string
  /** Live presentation count derived from project asset references. */
  localVideoCount?: number
  /** Live presentation count derived from online project asset references. */
  onlineVideoCount?: number
  videoCount: number
  /** Seed material count. Runtime clip exports are added when displayed. */
  collectionCount: number
  updatedAt: string
}

export const DEFAULT_PROJECT_DESCRIPTIONS: Record<ProjectKind, string> = {
  video: '探索未知领域，记录前线的每一刻。',
  '3d': '探索模型、材质与三维视角。',
}

export function getDefaultProjectDescription(
  kind: ProjectKind | undefined,
) {
  return DEFAULT_PROJECT_DESCRIPTIONS[kind ?? 'video']
}

export const DEFAULT_ACTIVE_PROJECT_ID = 'ring'

export const projects: Project[] = [
  {
    id: 'glacier',
    kind: 'video',
    title: '冰川纪元',
    subtitle: 'Glacier Age',
    cover: './aurora/project-glacier-age.png',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2024-05-06 10:47',
  },
  {
    id: 'distant-city',
    kind: 'video',
    title: '远山之城',
    subtitle: 'Distant City',
    cover: './aurora/project-distant-city.png',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2024-05-06 10:21',
  },
  {
    id: 'ring',
    kind: 'video',
    title: '极境之环',
    subtitle: 'The Ring of Horizon',
    cover: './aurora/project-ring-of-horizon.png',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2024-05-12 14:35',
  },
  {
    id: 'woods',
    kind: 'video',
    title: '林间絮语',
    subtitle: 'Whisper in Woods',
    cover: './aurora/project-whisper-woods.png',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2024-04-29 00:22',
  },
  {
    id: 'frontier',
    kind: 'video',
    title: '新境前线',
    subtitle: 'New Frontier',
    cover: './aurora/project-new-frontier.png',
    videoCount: 0,
    collectionCount: 0,
    updatedAt: '2024-04-18 16:06',
  },
]

export function mergeDefaultProjects(
  persistedProjects: readonly Project[],
): Project[] {
  const persistedById = new Map(
    persistedProjects.map((project) => [project.id, project]),
  )
  const defaultIds = new Set(projects.map((project) => project.id))
  const restoredDefaults = projects.map((defaultProject) => {
    const persistedProject = persistedById.get(defaultProject.id)
    if (!persistedProject) return { ...defaultProject }
    return {
      ...defaultProject,
      ...persistedProject,
      id: defaultProject.id,
      kind: defaultProject.kind,
      cover: defaultProject.cover,
      collectionCount: 0,
    }
  })
  return [
    ...restoredDefaults,
    ...persistedProjects.filter((project) => !defaultIds.has(project.id)),
  ]
}
