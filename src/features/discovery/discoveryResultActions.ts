import type { DiscoveryResult } from './discoveryData'

export type DiscoveryResultActionId =
  | 'open-footage'
  | 'trim-footage'
  | 'export-still'
  | 'add-footage-to-project'
  | 'open-model'
  | 'reveal-file'
  | 'open-online-video'
  | 'add-online-to-project'
  | 'toggle-online-favorite'

export type DiscoveryResultActionIcon =
  | 'play'
  | 'scissors'
  | 'folder-plus'
  | 'export'
  | 'box'
  | 'folder-open'
  | 'star'

export type DiscoveryResultActionLayout =
  | 'none'
  | 'single'
  | 'double'
  | 'triple'
  | 'quad'

export interface ResolvedDiscoveryResultAction {
  id: DiscoveryResultActionId
  label: string
  icon: DiscoveryResultActionIcon
  primary: boolean
}

export interface ResolvedDiscoveryResultActionGroup {
  actions: readonly ResolvedDiscoveryResultAction[]
  primaryAction: ResolvedDiscoveryResultAction | null
  layout: DiscoveryResultActionLayout
}

export interface DiscoveryResultActionRequest {
  actionId: DiscoveryResultActionId
  result: DiscoveryResult
}

const createAction = (
  id: DiscoveryResultActionId,
  label: string,
  icon: DiscoveryResultActionIcon,
  primary = false,
): ResolvedDiscoveryResultAction => ({ id, label, icon, primary })

const resolveLayout = (count: number): DiscoveryResultActionLayout => {
  if (count <= 0) return 'none'
  if (count === 1) return 'single'
  if (count === 2) return 'double'
  if (count === 3) return 'triple'
  return 'quad'
}

export const resolveDiscoveryResultActions = (
  result: DiscoveryResult,
): ResolvedDiscoveryResultActionGroup => {
  let actions: ResolvedDiscoveryResultAction[] = []

  if (
    result.detailType === 'footage' &&
    result.source === 'local' &&
    result.footage.auroraProjectId &&
    result.footage.auroraClipId
  ) {
    if (result.kind === 'frame') {
      actions = [
        createAction('open-footage', '定位原视频', 'play', true),
        createAction('trim-footage', '以此帧剪辑', 'scissors'),
        createAction('export-still', '导出单帧', 'export'),
        createAction(
          'add-footage-to-project',
          '添加源视频',
          'folder-plus',
        ),
      ]
    } else {
      actions = [
        createAction('open-footage', '预览视频', 'play', true),
        createAction('trim-footage', '剪辑片段', 'scissors'),
        createAction('add-footage-to-project', '添加到项目', 'folder-plus'),
      ]
      if (result.footage.sourcePathAvailable === true) {
        actions.push(
          createAction('reveal-file', '在 Finder 中显示', 'folder-open'),
        )
      }
    }
  } else if (
    result.detailType === 'model' &&
    result.source === 'local' &&
    result.model.auroraProjectId &&
    result.model.auroraModelId
  ) {
    actions = [
      createAction('open-model', '打开三维查看', 'box', true),
    ]
    if (result.model.sourcePathAvailable === true) {
      actions.push(
        createAction('reveal-file', '在 Finder 中显示', 'folder-open'),
      )
    }
  } else if (
    result.detailType === 'online-video' &&
    result.online.provider === result.source
  ) {
    actions = [
      createAction('open-online-video', '在线播放', 'play', true),
      createAction(
        'toggle-online-favorite',
        result.online.favorite ? '取消收藏' : '收藏',
        'star',
      ),
      createAction('add-online-to-project', '添加到项目', 'folder-plus'),
    ]
  }

  const visibleActions = actions.slice(0, 4)
  return {
    actions: visibleActions,
    primaryAction:
      visibleActions.find((action) => action.primary) ??
      visibleActions[0] ??
      null,
    layout: resolveLayout(visibleActions.length),
  }
}
