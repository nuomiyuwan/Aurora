import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react'
import {
  Box,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  getModelAssetFormatLabel,
  type ModelAsset,
} from '../../data/modelLibraryTypes'
import {
  getDefaultProjectDescription,
  type Project,
} from '../../data/projects'
import { formatMediaFileSize } from '../video-library/mediaDisplayMetadata'
import {
  getVideoClipVisualStyle,
  type ResolvedVideoLibraryLayout,
} from '../video-library/videoLibraryLayout'
import { syncProjectedGlass } from '../video-library/projectedGlassProjection'
import {
  DETAIL_PANEL_CORNER_RADIUS_RATIO,
  VIDEO_CLIP_INFO_CORNER_RADIUS,
} from '../video-library/videoClipGeometry'
import { formatModelDimension } from '../model-viewer/modelAssetRuntime'
import './ModelLibraryView.css'

export type ModelImportState = {
  status: 'idle' | 'importing' | 'done' | 'error'
  message: string
}

type ModelLibraryViewProps = {
  active: boolean
  project: Project
  models: ModelAsset[]
  layout: ResolvedVideoLibraryLayout
  geometryRevision: string
  glassLayerRef: RefObject<HTMLDivElement | null>
  selectedModelId: string | null
  importState: ModelImportState
  onBack: () => void
  onSelect: (modelId: string) => void
  onOpen: (modelId: string) => void
  onReveal: (modelId: string) => void | Promise<void>
  onRemove: (modelId: string) => void
  onTagsChange: (modelId: string, tags: string[]) => void
  onNoteChange: (modelId: string, note: string) => void
  onToggleFavorite: (modelId: string) => void
  onVisibleModelIdsChange: (
    projectId: string,
    modelIds: readonly string[],
  ) => void
  onImport: (files?: File[]) => void
}

function countLabel(value: number | null, suffix: string) {
  return value === null
    ? `待分析${suffix}`
    : `${new Intl.NumberFormat('zh-CN').format(value)}${suffix ? ` ${suffix}` : ''}`
}

const MODEL_TAG_MAX_COUNT = 6
const MODEL_TAG_MAX_LENGTH = 12
const MODEL_DETAIL_NOTE_MAX_LENGTH = 40

type ModelSort = 'default' | 'size' | 'triangles' | 'materials'

const modelSortLabels: Record<ModelSort, string> = {
  default: '全部模型',
  size: '文件大小',
  triangles: '三角面',
  materials: '材质数量',
}

function toCssImageValue(value: string | null) {
  return value ? `url(${JSON.stringify(value)})` : 'none'
}

export function ModelLibraryView({
  active,
  project,
  models,
  layout,
  geometryRevision,
  glassLayerRef,
  selectedModelId,
  importState,
  onBack,
  onSelect,
  onOpen,
  onReveal,
  onRemove,
  onTagsChange,
  onNoteChange,
  onToggleFavorite,
  onVisibleModelIdsChange,
  onImport,
}: ModelLibraryViewProps) {
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(false)
  const [sortMode, setSortMode] = useState<ModelSort>('default')
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null)
  const [modelMenuId, setModelMenuId] = useState<string | null>(null)
  const [modelRemoveDialogId, setModelRemoveDialogId] = useState<string | null>(null)
  const [tagEditorModelId, setTagEditorModelId] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [tagEditorStatus, setTagEditorStatus] = useState('')
  const [noteEditorModelId, setNoteEditorModelId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const modelGridRef = useRef<HTMLDivElement>(null)
  const modelHitLayerRef = useRef<HTMLDivElement>(null)
  const glassCacheSignatureRef = useRef('')
  const geometryCacheSignatureRef = useRef('')
  const geometrySyncCountRef = useRef(0)
  const filteredModels = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    const nextModels = keyword ? models.filter((model) =>
      model.filename.toLocaleLowerCase().includes(keyword) ||
      model.format.includes(keyword) ||
      model.tags.some((tag) => tag.toLocaleLowerCase().includes(keyword)),
    ) : [...models]
    if (sortMode === 'size') {
      nextModels.sort((left, right) => right.sizeBytes - left.sizeBytes)
    } else if (sortMode === 'triangles') {
      nextModels.sort(
        (left, right) => (right.triangleCount ?? -1) - (left.triangleCount ?? -1),
      )
    } else if (sortMode === 'materials') {
      nextModels.sort(
        (left, right) => (right.materialCount ?? -1) - (left.materialCount ?? -1),
      )
    }
    return nextModels
  }, [models, query, sortMode])
  useLayoutEffect(() => {
    onVisibleModelIdsChange(
      project.id,
      filteredModels.map((model) => model.id),
    )
  }, [filteredModels, onVisibleModelIdsChange, project.id])
  const selectedModel =
    models.find((model) => model.id === selectedModelId) ?? models[0] ?? null
  const tagEditorModel =
    models.find((model) => model.id === tagEditorModelId) ?? null
  const noteEditorModel =
    models.find((model) => model.id === noteEditorModelId) ?? null
  const modelMenu = models.find((model) => model.id === modelMenuId) ?? null
  const modelRemoveDialog =
    models.find((model) => model.id === modelRemoveDialogId) ?? null
  const glassCacheSignature = [
    project.id,
    filteredModels.map((model) => model.id).join(','),
    selectedModel?.id ?? '',
  ].join('|')
  const geometryCacheSignature = [
    glassCacheSignature,
    geometryRevision,
    hoveredModelId ?? '',
    layout.cardContentScale.toFixed(4),
    layout.panelContentScale.toFixed(4),
  ].join('|')

  const openModelMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    modelId: string,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect(modelId)
    setModelMenuId(modelId)
  }

  const addModelTag = () => {
    if (!tagEditorModel) return
    const tag = tagDraft.trim().slice(0, MODEL_TAG_MAX_LENGTH)
    if (!tag) return
    if (tagEditorModel.tags.includes(tag)) {
      setTagEditorStatus('这个标签已经存在')
      return
    }
    if (tagEditorModel.tags.length >= MODEL_TAG_MAX_COUNT) {
      setTagEditorStatus(`最多保留 ${MODEL_TAG_MAX_COUNT} 个标签，请先删除一个`)
      return
    }
    onTagsChange(tagEditorModel.id, [...tagEditorModel.tags, tag])
    setTagEditorModelId(null)
    setTagDraft('')
    setTagEditorStatus('')
  }

  const removeModelTag = (model: ModelAsset, tag: string) => {
    onTagsChange(
      model.id,
      model.tags.filter((entry) => entry !== tag),
    )
    setTagEditorStatus('')
  }

  const openModelNoteEditor = (model: ModelAsset) => {
    setNoteEditorModelId(model.id)
    setNoteDraft(model.note.slice(0, MODEL_DETAIL_NOTE_MAX_LENGTH))
  }

  const closeModelNoteEditor = () => {
    setNoteEditorModelId(null)
    setNoteDraft('')
  }

  const saveModelNote = () => {
    if (!noteEditorModel) return
    onNoteChange(
      noteEditorModel.id,
      noteDraft.trim().slice(0, MODEL_DETAIL_NOTE_MAX_LENGTH),
    )
    closeModelNoteEditor()
  }

  /* Reuse the video-detail page's proven interaction architecture: the
     transformed visual cards never receive input directly. A flat hit layer
     is projected onto their live screen-space rectangles. */
  useLayoutEffect(() => {
    const grid = modelGridRef.current
    const hitLayer = modelHitLayerRef.current
    const glassLayer = glassLayerRef.current
    if (!grid || !hitLayer || !glassLayer) return

    const glassCacheValid =
      glassCacheSignatureRef.current === glassCacheSignature
    const geometryCacheValid =
      glassCacheValid &&
      geometryCacheSignatureRef.current === geometryCacheSignature
    glassLayer.dataset.geometrySourceRevision = geometryCacheSignature
    glassLayer.dataset.glassCacheValid = String(glassCacheValid)
    glassLayer.dataset.geometryCacheValid = String(geometryCacheValid)
    glassLayer.dataset.geometryReused = String(geometryCacheValid)
    if (!geometryCacheValid) {
      geometrySyncCountRef.current += 1
      glassLayer.dataset.geometrySyncCount = String(
        geometrySyncCountRef.current,
      )
    }

    let frame: number | undefined
    let sampledFrames = 0
    /*
     * Keep the same warm projected-glass contract as the video library. A
     * hidden model page still owns live geometry and 0.001-alpha compositor
     * leaves, so the incoming transition never has to allocate backdrop
     * surfaces after it becomes visible. A valid cache only needs one frame
     * to refresh the flat hit layer's active/inactive pointer state.
     */
    const maxFrames = geometryCacheValid ? 1 : 24

    const syncHitTargets = () => {
      const gridRect = grid.getBoundingClientRect()
      const glassLayerRect = glassLayer.getBoundingClientRect()
      const cardsById = new Map<string, HTMLElement>(
        Array.from(grid.querySelectorAll<HTMLElement>('.modelAssetCard')).map(
          (card) => [card.dataset.modelId ?? '', card] as const,
        ),
      )
      const glassesById = new Map<string, HTMLElement>(
        Array.from(
          glassLayer.querySelectorAll<HTMLElement>('.videoClipProjectedGlass'),
        ).map((glass) => [glass.dataset.modelId ?? '', glass] as const),
      )

      glassesById.forEach((glass, modelId) => {
        if (!cardsById.has(modelId)) glass.style.visibility = 'hidden'
      })

      hitLayer.querySelectorAll<HTMLElement>('.videoClipHitTarget').forEach((target) => {
        const card = cardsById.get(target.dataset.modelId ?? '')
        const glass = glassesById.get(target.dataset.modelId ?? '')
        if (!card) {
          target.style.visibility = 'hidden'
          target.style.pointerEvents = 'none'
          if (glass) glass.style.visibility = 'hidden'
          return
        }
        const visual = card.querySelector<HTMLElement>('.videoClipVisual')
        const projected = visual ?? card
        const cardRect = projected.getBoundingClientRect()
        const opacity = Number.parseFloat(getComputedStyle(projected).opacity)
        const interactionHidden = target.getAttribute('aria-hidden') === 'true'
        target.style.left = `${cardRect.left - gridRect.left}px`
        target.style.top = `${cardRect.top - gridRect.top}px`
        target.style.width = `${cardRect.width}px`
        target.style.height = `${cardRect.height}px`
        target.style.zIndex = getComputedStyle(card).zIndex
        target.style.visibility =
          active && opacity > 0.02 && !interactionHidden ? 'visible' : 'hidden'
        target.style.pointerEvents =
          active && opacity > 0.02 && !interactionHidden ? 'auto' : 'none'

        syncProjectedGlass(
          glass,
          Array.from(card.querySelectorAll<HTMLElement>('.videoClipGlassAnchor')),
          glassLayerRect,
          opacity,
          [0, 0, VIDEO_CLIP_INFO_CORNER_RADIUS, VIDEO_CLIP_INFO_CORNER_RADIUS],
        )
      })

      hitLayer
        .querySelectorAll<HTMLElement>('.videoClipMenuHitTarget')
        .forEach((target) => {
          const card = cardsById.get(target.dataset.modelId ?? '')
          const anchor = card?.querySelector<HTMLElement>('.clipStatus')
          if (!card || !anchor) {
            target.style.visibility = 'hidden'
            target.style.pointerEvents = 'none'
            return
          }

          const visual = card.querySelector<HTMLElement>('.videoClipVisual')
          const opacity = Number.parseFloat(
            getComputedStyle(visual ?? card).opacity,
          )
          const anchorRect = anchor.getBoundingClientRect()
          const cardZIndex =
            Number.parseInt(getComputedStyle(card).zIndex, 10) || 0
          const interactionHidden =
            target.getAttribute('aria-hidden') === 'true'
          const targetSize = Math.max(
            anchorRect.width,
            anchorRect.height,
            26 * layout.cardContentScale,
          )
          const hidden = !active || opacity <= 0.02 || interactionHidden

          target.style.left = `${
            anchorRect.left +
            anchorRect.width / 2 -
            targetSize / 2 -
            gridRect.left
          }px`
          target.style.top = `${
            anchorRect.top +
            anchorRect.height / 2 -
            targetSize / 2 -
            gridRect.top
          }px`
          target.style.width = `${targetSize}px`
          target.style.height = `${targetSize}px`
          target.style.zIndex = String(cardZIndex + 1)
          target.style.visibility = hidden ? 'hidden' : 'visible'
          target.style.pointerEvents = hidden ? 'none' : 'auto'
        })

      const detailPanel = grid.parentElement?.querySelector<HTMLElement>('.clipDetailPanel')
      const detailGlass = glassLayer.querySelector<HTMLElement>('.videoDetailProjectedGlass')
      const detailCornerRadius = detailPanel
        ? detailPanel.offsetWidth * DETAIL_PANEL_CORNER_RADIUS_RATIO
        : 0
      syncProjectedGlass(
        detailGlass,
        detailPanel
          ? Array.from(
              detailPanel.querySelectorAll<HTMLElement>('.detailPanelGlassAnchor'),
            )
          : [],
        glassLayerRect,
        detailPanel ? 1 : 0,
        [detailCornerRadius, detailCornerRadius, detailCornerRadius, detailCornerRadius],
      )
      const emptyState = grid.parentElement?.querySelector<HTMLElement>(
        '.modelLibraryEmptyState',
      )
      const emptyGlass = glassLayer.querySelector<HTMLElement>(
        '.modelLibraryEmptyProjectedGlass',
      )
      if (emptyGlass) {
        emptyGlass.dataset.emptyVisible = String(Boolean(emptyState))
      }
      glassCacheSignatureRef.current = glassCacheSignature
      glassLayer.dataset.glassCacheValid = 'true'

      sampledFrames += 1
      if (sampledFrames < maxFrames) {
        frame = window.requestAnimationFrame(syncHitTargets)
      } else {
        geometryCacheSignatureRef.current = geometryCacheSignature
        glassLayer.dataset.geometryPreparedRevision = geometryCacheSignature
        glassLayer.dataset.geometryCacheValid = 'true'
      }
    }

    syncHitTargets()
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [
    active,
    filteredModels,
    geometryRevision,
    geometryCacheSignature,
    glassCacheSignature,
    glassLayerRef,
    hoveredModelId,
    layout,
    selectedModelId,
  ])

  const handleDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.some((file) => /\.(?:glb|obj|fbx)$/i.test(file.name))) {
      onImport(files)
    }
  }

  return (
    <section
      className={`modelLibraryView ${dragging ? 'isDraggingModel' : ''}`}
      data-page-active={active}
      aria-hidden={!active || undefined}
      inert={!active}
      aria-label={`${project.title} 三维模型库`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDragging(false)
      }}
      onDrop={handleDrop}
    >
      <div className="videoLibraryBreadcrumb" aria-label="当前位置">
        <button type="button" onClick={onBack}>项目库</button>
        <ChevronRight size={14 * layout.sceneScale} strokeWidth={1.6} />
        <button type="button">{project.title}</button>
        <ChevronRight size={14 * layout.sceneScale} strokeWidth={1.6} />
        <strong>三维模型</strong>
      </div>

      <label className="videoLibrarySearch modelLibrarySearch uiGlassShell">
        <Search size={15 * layout.sceneScale} strokeWidth={1.55} />
        <input
          value={query}
          placeholder="搜索三维模型..."
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>

      <header className="videoLibraryHeader modelLibraryHeader">
        <div className="videoLibraryTitleLine">
          <h1>{project.title}</h1>
          {project.subtitle.trim() && <span className="libraryEnglishName">{project.subtitle}</span>}
        </div>
        <p>{models.length} 个三维模型 · GLB / OBJ / FBX</p>
        {(project.description ?? getDefaultProjectDescription(project.kind)).trim() && (
          <small>
            {project.description ?? getDefaultProjectDescription(project.kind)}
          </small>
        )}
      </header>

      <div className="videoLibraryToolbar modelLibraryToolbar" aria-label="模型排序" data-camera-gesture="block">
        {(Object.keys(modelSortLabels) as ModelSort[]).map((mode) => (
          <div className="videoLibraryFilterControl" key={mode}>
            <button
              className={`videoLibraryFilterButton uiGlassShell uiGlassInteractive ${sortMode === mode ? 'active' : ''}`}
              type="button"
              aria-pressed={sortMode === mode}
              onClick={() => setSortMode(mode)}
            >
              <span className="videoLibraryFilterButtonLabel">{modelSortLabels[mode]}</span>
              <ChevronDown size={13 * layout.sceneScale} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          className={`iconFilterButton uiGlassShell uiGlassInteractive ${query || sortMode !== 'default' ? 'active' : ''}`}
          type="button"
          aria-label="重置模型搜索与排序"
          disabled={!query && sortMode === 'default'}
          onClick={() => {
            setQuery('')
            setSortMode('default')
          }}
        >
          <ListFilter size={15 * layout.sceneScale} strokeWidth={1.5} />
        </button>
      </div>

      <div
        ref={modelGridRef}
        className="videoClipGrid modelAssetStage"
        data-camera-gesture={filteredModels.length > 1 ? 'block' : undefined}
        data-track-scrollable={filteredModels.length > 1}
      >
        <div className="videoClipCameraRig modelAssetCameraRig">
          {filteredModels.map((model, index) => {
            const format = getModelAssetFormatLabel(model.format)
            const rowIndex = Math.min(1, Math.floor(index / 4)) as 0 | 1
            const visualSlot = index % 4
            const selected = selectedModel?.id === model.id
            const visibleTags = model.tags.length > 0
              ? model.tags.slice(0, 3)
              : [
                  countLabel(model.materialCount, '材质'),
                  countLabel(model.textureCount, '贴图'),
                ]
            return (
              <div
                key={model.id}
                className={`videoClipCard modelAssetCard clipRow${rowIndex === 0 ? 'Top' : 'Bottom'} ${selected ? 'selected' : ''} ${hoveredModelId === model.id ? 'isHitHovered' : ''}`}
                style={{
                  ...getVideoClipVisualStyle(rowIndex, visualSlot, layout),
                  '--clip-cover': toCssImageValue(model.thumbnail),
                } as CSSProperties}
                data-model-id={model.id}
                data-clip-id={model.id}
                data-reflection-index={index}
                aria-hidden="true"
              >
                <span className="videoClipVisual">
                  <span className="videoClipSurface" />
                  <span className="videoClipImage">
                    {!model.thumbnail && <Box className="modelAssetPlaceholder" size={38} strokeWidth={1.1} />}
                  </span>
                  <span className="videoClipFrame" aria-hidden="true" />
                  <span className="videoClipLight" aria-hidden="true" />
                  <span className="clipBadge">{format}</span>
                  <span className="clipDuration">{countLabel(model.triangleCount, '面')}</span>
                  <span className="clipInfo">
                    <span className="clipInfoGlass" aria-hidden="true" />
                    <strong>{model.filename}</strong>
                    <small>{formatMediaFileSize(model.sizeBytes)} · {countLabel(model.nodeCount, '节点')}</small>
                    <span className="clipTagList">
                      {visibleTags.map((tag) => <em key={tag}>{tag}</em>)}
                    </span>
                  </span>
                  <span className="clipStatus"><MoreHorizontal size={16 * layout.cardContentScale} strokeWidth={1.5} /></span>
                  <span className="videoClipGlassAnchor videoClipGlassAnchorTopLeft" />
                  <span className="videoClipGlassAnchor videoClipGlassAnchorTopRight" />
                  <span className="videoClipGlassAnchor videoClipGlassAnchorBottomRight" />
                  <span className="videoClipGlassAnchor videoClipGlassAnchorBottomLeft" />
                </span>
              </div>
            )
          })}
        </div>
        <div ref={modelHitLayerRef} className="videoClipHitLayer">
          {filteredModels.map((model, index) => {
            const rowIndex = Math.min(1, Math.floor(index / 4)) as 0 | 1
            const visualSlot = index % 4
            const interactionHidden = Number.parseFloat(
              getVideoClipVisualStyle(rowIndex, visualSlot, layout)['--clip-opacity'],
            ) <= 0.02
            return [
                <button
                  key={`hit:${model.id}`}
                  className="videoClipHitTarget"
                  type="button"
                  data-camera-gesture={
                    filteredModels.length <= 1 ? 'allow' : undefined
                  }
                  data-model-id={model.id}
                  aria-hidden={interactionHidden || undefined}
                  tabIndex={interactionHidden ? -1 : 0}
                  aria-label={`查看 ${model.filename}`}
                  onPointerEnter={() => setHoveredModelId(model.id)}
                  onPointerLeave={() => setHoveredModelId((current) => current === model.id ? null : current)}
                  onFocus={() => setHoveredModelId(model.id)}
                  onBlur={() => setHoveredModelId((current) => current === model.id ? null : current)}
                  onClick={() => onSelect(model.id)}
                  onDoubleClick={() => onOpen(model.id)}
                />,
                <button
                  key={`menu-hit:${model.id}`}
                  className="videoClipMenuHitTarget"
                  type="button"
                  data-model-id={model.id}
                  aria-hidden={interactionHidden || undefined}
                  tabIndex={interactionHidden ? -1 : 0}
                  aria-label={`${model.filename} 更多操作`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => openModelMenu(event, model.id)}
                />,
              ]
          })}
        </div>
      </div>

      {models.length === 0 && (
        <div className="modelLibraryEmptyState" data-camera-gesture="block">
          <Box size={24} strokeWidth={1.35} />
          <strong>这个三维项目还没有模型</strong>
          <small>导入 GLB、OBJ 或 FBX 文件，Aurora 会统一建立模型预览与基础信息。</small>
          <button className="uiGlassInset uiGlassInteractive active" type="button" onClick={() => onImport()}><Plus size={14} />导入三维模型</button>
        </div>
      )}

      {models.length > 0 && filteredModels.length === 0 && (
        <div className="modelLibraryEmptyState" data-camera-gesture="block">
          <Search size={22} strokeWidth={1.35} />
          <strong>没有符合条件的模型</strong>
          <small>清除搜索关键词后重试。</small>
          <button className="uiGlassInset uiGlassInteractive" type="button" onClick={() => setQuery('')}>清除搜索</button>
        </div>
      )}

      {selectedModel && (
        <div className="videoLibraryDetailStage modelLibraryDetailStage">
          <div className="videoLibraryDetailCameraRig">
            <aside
              className="clipDetailPanel modelLibraryDetailPanel"
              data-detail-reflection="true"
              data-clip-id={selectedModel.id}
              data-reflection-index={filteredModels.length}
              aria-label={`${selectedModel.filename} 详情`}
            >
              <span className="detailPanelGlassAnchor detailPanelGlassAnchorTopLeft" />
              <span className="detailPanelGlassAnchor detailPanelGlassAnchorTopRight" />
              <span className="detailPanelGlassAnchor detailPanelGlassAnchorBottomRight" />
              <span className="detailPanelGlassAnchor detailPanelGlassAnchorBottomLeft" />
              <div className="detailPanelChrome" aria-hidden="true" />
              <div className="detailPanelContent">
                <div className="detailPanelTop">
                  <strong>{selectedModel.filename}</strong>
                  <button
                    className={`detailFavoriteButton ${selectedModel.favorite ? 'active' : ''}`}
                    type="button"
                    aria-label={
                      selectedModel.favorite ? '取消收藏三维模型' : '收藏三维模型'
                    }
                    aria-pressed={selectedModel.favorite}
                    title={selectedModel.favorite ? '取消收藏三维模型' : '收藏三维模型'}
                    onClick={() => onToggleFavorite(selectedModel.id)}
                  >
                    <Star
                      size={13 * layout.panelContentScale}
                      fill={selectedModel.favorite ? 'currentColor' : 'none'}
                      strokeWidth={1.5}
                    />
                  </button>
                </div>
                <div className="detailPanelBody">
                  <div className="detailPreview modelLibraryDetailPreview" style={{ '--clip-cover': toCssImageValue(selectedModel.thumbnail) } as CSSProperties}>
                    {!selectedModel.thumbnail && <Box size={42} strokeWidth={1.05} />}
                  </div>
                  <section className="clipFacts">
                    <h2>基本信息</h2>
                    <p><span>原始格式</span><strong>{getModelAssetFormatLabel(selectedModel.format)}</strong></p>
                    <p><span>文件大小</span><strong>{formatMediaFileSize(selectedModel.sizeBytes)}</strong></p>
                    <p><span>三角面</span><strong>{countLabel(selectedModel.triangleCount, '')}</strong></p>
                    <p><span>顶点</span><strong>{countLabel(selectedModel.vertexCount, '')}</strong></p>
                    <p><span>节点</span><strong>{countLabel(selectedModel.nodeCount, '')}</strong></p>
                    <p><span>材质 / 贴图</span><strong>{selectedModel.materialCount ?? '—'} / {selectedModel.textureCount ?? '—'}</strong></p>
                    <p><span>模型尺寸</span><strong>{selectedModel.dimensions ? `${formatModelDimension(selectedModel.dimensions.x)} × ${formatModelDimension(selectedModel.dimensions.y)} × ${formatModelDimension(selectedModel.dimensions.z)}` : '待分析'}</strong></p>
                    <p><span>导入时间</span><strong>{selectedModel.importedAt}</strong></p>
                  </section>
                  <section className="detailTagCloud modelDetailTagCloud">
                    <h2>标签</h2>
                    <div>
                      {selectedModel.tags.map((tag) => (
                        <button
                          className="detailTagChip"
                          type="button"
                          key={tag}
                          title={`删除标签 ${tag}`}
                          onClick={() => removeModelTag(selectedModel, tag)}
                        >
                          {tag}<span aria-hidden="true">×</span>
                        </button>
                      ))}
                      <button
                        className="detailTagAddButton"
                        type="button"
                        aria-label="添加标签"
                        title={selectedModel.tags.length >= MODEL_TAG_MAX_COUNT ? `最多 ${MODEL_TAG_MAX_COUNT} 个标签` : '添加标签'}
                        disabled={selectedModel.tags.length >= MODEL_TAG_MAX_COUNT}
                        onClick={() => {
                          setTagEditorModelId(selectedModel.id)
                          setTagDraft('')
                          setTagEditorStatus('')
                        }}
                      >
                        <Plus size={12 * layout.panelContentScale} strokeWidth={1.5} />
                      </button>
                    </div>
                  </section>
                  <section className="detailNote" aria-label="备注">
                    <div className="detailNoteHeader">
                      <h2>备注</h2>
                      <button
                        type="button"
                        aria-label="编辑备注"
                        onClick={() => openModelNoteEditor(selectedModel)}
                      >
                        <Pencil
                          size={13 * layout.panelContentScale}
                          strokeWidth={1.5}
                        />
                      </button>
                    </div>
                    <p>{selectedModel.note || '暂无备注'}</p>
                  </section>
                  <button className="openFrameRingButton" type="button" onClick={() => onOpen(selectedModel.id)}>打开三维查看<ChevronRight size={15 * layout.panelContentScale} strokeWidth={1.5} /></button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      <footer className="modelLibraryCount">
        {filteredModels.length === models.length ? `共 ${models.length} 个三维模型` : `显示 ${filteredModels.length} / 共 ${models.length} 个三维模型`}
      </footer>

      {importState.status !== 'idle' && (
        <div className={`modelLibraryImportNotice uiGlassShell is-${importState.status}`} role="status" aria-live="polite">
          {importState.status === 'importing' && <i aria-hidden="true" />}
          <span>{importState.message}</span>
        </div>
      )}

      {dragging && (
        <div className="modelLibraryDropGuide" aria-hidden="true"><span className="uiGlassShell"><Upload size={20} /><strong>松开以导入 GLB / OBJ / FBX</strong></span></div>
      )}

      {modelMenu && (
        <div
          className="overlay clipActionOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${modelMenu.filename} 更多操作`}
          data-camera-gesture="block"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setModelMenuId(null)
          }}
        >
          <section
            className="clipActionPanel uiGlassShell"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭模型操作"
              onClick={() => setModelMenuId(null)}
            >
              <X size={17} />
            </button>
            <header>
              <span className="sheetEyebrow">Model Actions</span>
              <h2>模型操作</h2>
            </header>
            <div className="clipActionSummary uiGlassInset">
              {modelMenu.thumbnail ? (
                <img src={modelMenu.thumbnail} alt="" />
              ) : (
                <span className="modelActionSummaryPlaceholder" aria-hidden="true">
                  <Box size={24} strokeWidth={1.2} />
                </span>
              )}
              <span>
                <strong>{modelMenu.filename}</strong>
                <small>{getModelAssetFormatLabel(modelMenu.format)} · {formatMediaFileSize(modelMenu.sizeBytes)}</small>
              </span>
            </div>
            <div className="clipActionList">
              <button
                className="uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => {
                  setModelMenuId(null)
                  onOpen(modelMenu.id)
                }}
              >
                <Box size={17} strokeWidth={1.45} />
                <span>
                  <strong>打开三维查看</strong>
                  <small>进入模型浏览与单帧导出</small>
                </span>
                <ChevronRight size={14} strokeWidth={1.45} />
              </button>
              <button
                className="uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => {
                  setModelMenuId(null)
                  void onReveal(modelMenu.id)
                }}
              >
                <FolderOpen size={17} strokeWidth={1.45} />
                <span>
                  <strong>在 Finder 中显示</strong>
                  <small>定位 Aurora 管理的模型文件</small>
                </span>
                <ChevronRight size={14} strokeWidth={1.45} />
              </button>
              <button
                className="uiGlassInset uiGlassInteractive destructive"
                type="button"
                onClick={() => {
                  setModelMenuId(null)
                  setModelRemoveDialogId(modelMenu.id)
                }}
              >
                <Trash2 size={17} strokeWidth={1.45} />
                <span>
                  <strong>从当前项目移除…</strong>
                  <small>不会删除导入前的磁盘原文件</small>
                </span>
                <ChevronRight size={14} strokeWidth={1.45} />
              </button>
            </div>
          </section>
        </div>
      )}

      {modelRemoveDialog && (
        <div
          className="overlay clipRemoveOverlay"
          role="alertdialog"
          aria-modal="true"
          aria-label={`从 ${project.title} 移除 ${modelRemoveDialog.filename}`}
          data-camera-gesture="block"
        >
          <section className="clipRemovePanel uiGlassShell">
            <span className="clipRemoveIcon" aria-hidden="true">
              <Trash2 size={20} strokeWidth={1.45} />
            </span>
            <span className="sheetEyebrow">Remove Model</span>
            <h2>从当前项目移除？</h2>
            <p>
              “{modelRemoveDialog.filename}”会从“{project.title}”中移除，
              Aurora 管理的模型副本也会被清理。导入前的磁盘原文件不会被删除。
            </p>
            <footer>
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => setModelRemoveDialogId(null)}
              >
                取消
              </button>
              <button
                className="primaryAction destructive uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => {
                  const modelId = modelRemoveDialog.id
                  setModelRemoveDialogId(null)
                  onRemove(modelId)
                }}
              >
                从项目移除
              </button>
            </footer>
          </section>
        </div>
      )}

      {tagEditorModel && (
        <div
          className="overlay clipMetadataEditorOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`为 ${tagEditorModel.filename} 添加标签`}
          data-camera-gesture="block"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return
            setTagEditorModelId(null)
            setTagDraft('')
            setTagEditorStatus('')
          }}
        >
          <form
            className="createPanel clipMetadataEditorPanel uiGlassShell"
            autoComplete="off"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              addModelTag()
            }}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭标签编辑"
              onClick={() => {
                setTagEditorModelId(null)
                setTagDraft('')
                setTagEditorStatus('')
              }}
            >
              <X size={17} />
            </button>
            <header className="createPanelHeader">
              <span className="sheetEyebrow">Edit Tags</span>
              <h2>添加标签</h2>
              <p>标签属于当前项目中的这个三维模型，不会修改模型文件。</p>
            </header>

            <div className="clipMetadataContext uiGlassInset">
              <strong>{tagEditorModel.filename}</strong>
              <small>{tagEditorModel.tags.length}/{MODEL_TAG_MAX_COUNT} 个标签</small>
            </div>

            {tagEditorModel.tags.length > 0 && (
              <div className="clipMetadataTagList" aria-label="现有标签">
                {tagEditorModel.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-label={`删除标签 ${tag}`}
                    onClick={() => removeModelTag(tagEditorModel, tag)}
                  >
                    {tag}<span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            )}

            <label className="projectNameField">
              <span>新标签</span>
              <span className="createProjectInput uiGlassInset">
                <Plus size={15} strokeWidth={1.5} aria-hidden="true" />
                <input
                  autoFocus
                  name="modelTag"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={MODEL_TAG_MAX_LENGTH}
                  placeholder="输入标签名称"
                  value={tagDraft}
                  onChange={(event) => {
                    setTagDraft(event.currentTarget.value)
                    setTagEditorStatus('')
                  }}
                />
              </span>
              <span className="clipMetadataFieldStatus">
                <small>{tagDraft.length}/{MODEL_TAG_MAX_LENGTH}</small>
                <small>{tagEditorStatus}</small>
              </span>
            </label>

            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={() => {
                  setTagEditorModelId(null)
                  setTagDraft('')
                  setTagEditorStatus('')
                }}
              >取消</button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="submit"
                disabled={!tagDraft.trim() || tagEditorModel.tags.length >= MODEL_TAG_MAX_COUNT}
              >
                <Plus size={15} strokeWidth={1.65} />添加标签
              </button>
            </footer>
          </form>
        </div>
      )}

      {noteEditorModel && (
        <div
          className="overlay clipMetadataEditorOverlay"
          role="dialog"
          aria-modal="true"
          aria-label={`编辑 ${noteEditorModel.filename} 的备注`}
          data-camera-gesture="block"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeModelNoteEditor()
          }}
        >
          <form
            className="createPanel clipMetadataEditorPanel uiGlassShell"
            autoComplete="off"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              saveModelNote()
            }}
          >
            <button
              className="panelClose uiGlassInteractive"
              type="button"
              aria-label="关闭备注编辑"
              onClick={closeModelNoteEditor}
            >
              <X size={17} />
            </button>
            <header className="createPanelHeader">
              <span className="sheetEyebrow">Edit Note</span>
              <h2>编辑备注</h2>
              <p>
                备注属于当前项目中的这个三维模型，不会修改模型文件。
              </p>
            </header>

            <div className="clipMetadataContext uiGlassInset">
              <strong>{noteEditorModel.filename}</strong>
              <small>项目备注</small>
            </div>

            <label className="projectNameField">
              <span>备注内容</span>
              <textarea
                className="clipNoteEditorInput uiGlassInset"
                autoFocus
                maxLength={MODEL_DETAIL_NOTE_MAX_LENGTH}
                placeholder="输入素材备注"
                value={noteDraft}
                onChange={(event) =>
                  setNoteDraft(
                    event.currentTarget.value.slice(
                      0,
                      MODEL_DETAIL_NOTE_MAX_LENGTH,
                    ),
                  )
                }
              />
              <span className="clipMetadataFieldStatus">
                <small>
                  {noteDraft.length}/{MODEL_DETAIL_NOTE_MAX_LENGTH}
                </small>
              </span>
            </label>

            <footer className="createPanelActions">
              <button
                className="secondaryAction uiGlassInset uiGlassInteractive"
                type="button"
                onClick={closeModelNoteEditor}
              >
                取消
              </button>
              <button
                className="primaryAction uiGlassInset uiGlassInteractive active"
                type="submit"
              >
                保存备注
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  )
}
