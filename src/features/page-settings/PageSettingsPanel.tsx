import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Folder,
  HardDrive,
  Image,
  KeyRound,
  Palette,
  RefreshCw,
  Server,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'
import { PageSettingsGlassBackdrop } from './PageSettingsGlassBackdrop'
import { PAGE_SETTINGS_RANGE_DEFAULTS } from './pageSettingsDefaults'
import {
  PARTICLE_IMPORT_LIMIT_HINT,
  PARTICLE_PRESETS,
  type HomeParticleSettings,
  type ParticleImportState,
} from './particleSettings'

export type PageBackgroundMedia = {
  kind: 'image' | 'video'
  name: string
  url: string
  managedPath: string | null
} | null

export type PageVisualSettings = {
  background: PageBackgroundMedia
  contrast: number
  saturation: number
  hue: number
  uiBorderColor: string
  materialTint: string
  pedestalTint: string
  particles: HomeParticleSettings
}

export type AppCacheState = {
  status: 'idle' | 'checking' | 'ready' | 'cleaning' | 'cleaned' | 'error'
  totalBytes: number
  reclaimableBytes: number
  totalDirectories: number
  reclaimableDirectories: number
  semanticEntries: number
  reclaimableSemanticEntries: number
  removedBytes: number
  removedDirectories: number
  removedSemanticEntries: number
  error: string | null
}

export type AiServiceKind = 'vision' | 'embedding'

export type AiServiceProfileOption = {
  id: string
  name: string
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export type AiServiceProfileInput = {
  id?: string
  name: string
  baseUrl: string
  model: string
  apiKey?: string
  clearApiKey?: boolean
}

export type AiServiceConnectionTestResult = {
  ok: true
  model: string
  dimensions?: number
  latencyMs: number
}

export type AiLocalModelOption = {
  id: string
  capabilities?: readonly AiServiceKind[]
}

export type AiLocalModelService = {
  provider: 'ollama' | 'lm-studio'
  label: string
  baseUrl: string
  models: readonly AiLocalModelOption[]
}

export type AiLocalModelDetectionResult = {
  services: readonly AiLocalModelService[]
}

export type PageSettingsPanelProps = {
  pageLabel: string
  showParticleSettings: boolean
  showProjectSettings: boolean
  showPedestalTint?: boolean
  showMediaSourceSettings?: boolean
  showAiSearchSettings?: boolean
  projectName?: string
  projectDefaultName?: string
  projectEnglishName?: string
  projectDescription?: string
  projectDefaultDescription?: string
  projectCoverUrl?: string
  projectCoverName?: string | null
  settings: PageVisualSettings
  onClose: () => void
  onProjectNameChange?: (value: string) => void
  onResetProjectName?: () => void
  onProjectEnglishNameChange?: (value: string) => void
  onProjectDescriptionChange?: (value: string) => void
  onResetProjectDescription?: () => void
  onChooseProjectCover?: () => void
  onResetProjectCover?: () => void
  onChooseBackground: () => void
  onResetBackground: () => void
  onResetAll: () => void
  onOpenEmbyMediaSource?: () => void
  aiVisionProfiles?: readonly AiServiceProfileOption[]
  aiEmbeddingProfiles?: readonly AiServiceProfileOption[]
  aiActiveVisionProfileId?: string | null
  aiActiveEmbeddingProfileId?: string | null
  aiProviderSecureStorageAvailable?: boolean
  aiProviderExternalMessage?: string | null
  onSelectAiServiceProfile?: (
    kind: AiServiceKind,
    profileId: string | null,
  ) => void | Promise<void>
  onDeleteAiServiceProfile?: (
    kind: AiServiceKind,
    profileId: string,
  ) => void | Promise<void>
  onTestAiServiceProfile?: (
    kind: AiServiceKind,
    input: AiServiceProfileInput,
  ) => Promise<AiServiceConnectionTestResult>
  onSaveAiServiceProfile?: (
    kind: AiServiceKind,
    input: AiServiceProfileInput,
  ) => void | Promise<void>
  onDetectAiLocalModels?: () => Promise<AiLocalModelDetectionResult>
  particleImportState?: ParticleImportState
  onChooseParticleMedia?: () => void
  onRemoveCustomParticleMedia?: () => void
  appUpdateState?: AppUpdateState
  onCheckForUpdates?: () => void
  appCacheState?: AppCacheState
  onInspectAppCache?: () => void
  onCleanAppCache?: () => void
  onChange: (patch: Partial<PageVisualSettings>) => void
  onParticlesChange: (patch: Partial<HomeParticleSettings>) => void
}

const RANGE_THUMB_SIZE = 11
const RANGE_THUMB_HIT_PADDING = 4

const FALLBACK_APP_UPDATE_STATE: AppUpdateState = {
  currentVersion: __AURORA_VERSION__,
  supported: false,
  installMode: 'automatic',
  status: 'unsupported',
  latestVersion: null,
  releaseName: null,
  releaseNotes: [],
  releaseDate: null,
  progress: null,
  checkedAt: null,
  source: null,
  error: null,
}

const FALLBACK_APP_CACHE_STATE: AppCacheState = {
  status: 'idle',
  totalBytes: 0,
  reclaimableBytes: 0,
  totalDirectories: 0,
  reclaimableDirectories: 0,
  semanticEntries: 0,
  reclaimableSemanticEntries: 0,
  removedBytes: 0,
  removedDirectories: 0,
  removedSemanticEntries: 0,
  error: null,
}

function formatStorageBytes(value: number) {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = bytes / 1024
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unitIndex]}`
}

function appUpdateButtonLabel(state: AppUpdateState) {
  if (!state.supported) return '当前版本'
  if (state.status === 'checking') return '正在检查…'
  if (state.status === 'up-to-date') return '已是最新'
  if (state.status === 'available') return `更新到 v${state.latestVersion ?? ''}`
  if (state.status === 'downloading') {
    return `下载 ${Math.round(state.progress ?? 0)}%`
  }
  if (state.status === 'downloaded') return '准备安装…'
  if (state.status === 'installing') {
    return state.installMode === 'manual-dmg' ? '正在打开…' : '正在重启…'
  }
  if (state.status === 'error') return '重新检查'
  return '检查更新'
}

type RangeThumbDoubleClickState = {
  firstPressHit: boolean
  secondPressHit: boolean
}

type AiServiceProfileDraft = Pick<AiServiceProfileInput, 'baseUrl' | 'model'>

type AiProviderOperationStatus =
  | 'idle'
  | 'testing'
  | 'passed'
  | 'saving'
  | 'deleting'
  | 'saved'
  | 'error'

const EMPTY_AI_SERVICE_DRAFT: AiServiceProfileDraft = {
  baseUrl: '',
  model: '',
}

const EMPTY_AI_SERVICE_PROFILES: readonly AiServiceProfileOption[] = []

const aiServiceDraftSignature = (draft: AiServiceProfileDraft) =>
  JSON.stringify([draft.baseUrl.trim(), draft.model.trim()])

const comparableAiProviderBaseUrl = (value: string) =>
  value.trim().replace(/\/+$/, '')

const aiServiceProfileLabel = (profile: AiServiceProfileOption) => {
  try {
    const host = new URL(profile.baseUrl).host
    return host ? `${profile.name} · ${host}` : profile.name
  } catch {
    return profile.name
  }
}

const aiProviderErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback

type AiServiceConfigurationProps = {
  kind: AiServiceKind
  title: string
  modelLabel: string
  modelPlaceholder: string
  profiles: readonly AiServiceProfileOption[]
  activeProfileId: string | null
  secureStorageAvailable: boolean
  externalMessage: string | null
  localServices: readonly AiLocalModelService[]
  onSelect?: (kind: AiServiceKind, profileId: string | null) => void | Promise<void>
  onDelete?: (kind: AiServiceKind, profileId: string) => void | Promise<void>
  onTest?: (
    kind: AiServiceKind,
    input: AiServiceProfileInput,
  ) => Promise<AiServiceConnectionTestResult>
  onSave?: (
    kind: AiServiceKind,
    input: AiServiceProfileInput,
  ) => void | Promise<void>
}

type AiLocalModelSelection = {
  key: string
  providerLabel: string
  baseUrl: string
  model: string
}

const getAiLocalModelSelections = (
  services: readonly AiLocalModelService[],
  kind: AiServiceKind,
): AiLocalModelSelection[] =>
  services.flatMap((service) =>
    service.models.flatMap((model) => {
      const capabilities = model.capabilities ?? []
      if (capabilities.length > 0 && !capabilities.includes(kind)) return []
      return [{
        key: [service.provider, service.baseUrl, model.id]
          .map(encodeURIComponent)
          .join('|'),
        providerLabel: service.label,
        baseUrl: service.baseUrl,
        model: model.id,
      }]
    }),
  )

function AiServiceConfiguration({
  kind,
  title,
  modelLabel,
  modelPlaceholder,
  profiles,
  activeProfileId,
  secureStorageAvailable,
  externalMessage,
  localServices,
  onSelect,
  onDelete,
  onTest,
  onSave,
}: AiServiceConfigurationProps) {
  const apiKeyInputRef = useRef<HTMLInputElement>(null)
  const [selectedProfileId, setSelectedProfileId] = useState(
    activeProfileId ?? '',
  )
  const [draft, setDraft] = useState<AiServiceProfileDraft>(
    EMPTY_AI_SERVICE_DRAFT,
  )
  const [hasApiKeyDraft, setHasApiKeyDraft] = useState(false)
  const [operationStatus, setOperationStatus] =
    useState<AiProviderOperationStatus>('idle')
  const [operationMessage, setOperationMessage] = useState<string | null>(null)
  const [testedSignature, setTestedSignature] = useState<string | null>(null)
  const [selectedLocalModelKey, setSelectedLocalModelKey] = useState('')

  const selectedProfile = profiles.find(
    (profile) => profile.id === selectedProfileId,
  )
  const activeProfile = profiles.find(
    (profile) => profile.id === activeProfileId,
  )
  const activeProfilePublicId = activeProfile?.id ?? ''
  const activeProfileBaseUrl = activeProfile?.baseUrl ?? ''
  const activeProfileModel = activeProfile?.model ?? ''
  const canReuseSelectedKey = Boolean(
    selectedProfile?.hasApiKey &&
      comparableAiProviderBaseUrl(draft.baseUrl) ===
        comparableAiProviderBaseUrl(selectedProfile.baseUrl),
  )
  const currentSignature = aiServiceDraftSignature(draft)
  const isBusy =
    operationStatus === 'testing' ||
    operationStatus === 'saving' ||
    operationStatus === 'deleting'
  const draftIsComplete = Boolean(draft.baseUrl.trim() && draft.model.trim())
  const canTest = draftIsComplete && !isBusy && Boolean(onTest)
  const canSave =
    operationStatus === 'passed' &&
    testedSignature === currentSignature &&
    (!hasApiKeyDraft || secureStorageAvailable) &&
    !isBusy &&
    Boolean(onSave)
  const localSelections = getAiLocalModelSelections(localServices, kind)

  const clearApiKeyInput = () => {
    if (apiKeyInputRef.current) apiKeyInputRef.current.value = ''
    setHasApiKeyDraft(false)
  }

  const resetTest = () => {
    setTestedSignature(null)
    setOperationStatus('idle')
    setOperationMessage(null)
  }

  const hydrateDraft = (profile: AiServiceProfileOption | undefined) => {
    setDraft(
      profile
        ? { baseUrl: profile.baseUrl, model: profile.model }
        : EMPTY_AI_SERVICE_DRAFT,
    )
    setSelectedLocalModelKey('')
    clearApiKeyInput()
    resetTest()
  }

  useEffect(() => {
    setSelectedProfileId(activeProfilePublicId)
    setDraft(
      activeProfilePublicId
        ? { baseUrl: activeProfileBaseUrl, model: activeProfileModel }
        : EMPTY_AI_SERVICE_DRAFT,
    )
    setSelectedLocalModelKey('')
    if (apiKeyInputRef.current) apiKeyInputRef.current.value = ''
    setHasApiKeyDraft(false)
    setTestedSignature(null)
    setOperationStatus('idle')
    setOperationMessage(null)
  }, [
    activeProfileBaseUrl,
    activeProfileModel,
    activeProfilePublicId,
  ])

  const updateDraft = (
    patch: Partial<AiServiceProfileDraft>,
    preserveLocalSelection = false,
  ) => {
    setDraft((current) => ({ ...current, ...patch }))
    if (!preserveLocalSelection) setSelectedLocalModelKey('')
    resetTest()
  }

  const createInput = (): AiServiceProfileInput => {
    const apiKey = apiKeyInputRef.current?.value.trim() ?? ''
    return {
      ...(selectedProfileId ? { id: selectedProfileId } : {}),
      name: selectedProfile?.name || draft.model.trim(),
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      ...(apiKey ? { apiKey } : {}),
    }
  }

  const handleSelectProfile = async (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId)
    setSelectedProfileId(profile?.id ?? '')
    hydrateDraft(profile)
    try {
      await onSelect?.(kind, profile?.id ?? null)
    } catch (error) {
      setOperationStatus('error')
      setOperationMessage(aiProviderErrorMessage(error, `切换${title}失败`))
    }
  }

  const handleSelectLocalModel = (selectionKey: string) => {
    const selection = localSelections.find((item) => item.key === selectionKey)
    if (!selection) return
    setSelectedProfileId('')
    setSelectedLocalModelKey(selection.key)
    clearApiKeyInput()
    updateDraft(
      { baseUrl: selection.baseUrl, model: selection.model },
      true,
    )
  }

  const handleTest = async () => {
    if (!canTest || !onTest) return
    const signature = currentSignature
    setOperationStatus('testing')
    setOperationMessage(`正在测试${title}…`)
    try {
      const result = await onTest(kind, createInput())
      setTestedSignature(signature)
      setOperationStatus('passed')
      const dimensions =
        kind === 'embedding' && result.dimensions
          ? ` · ${result.dimensions} 维`
          : ''
      setOperationMessage(
        `${result.model}${dimensions} · ${Math.max(0, Math.round(result.latencyMs))} ms`,
      )
    } catch (error) {
      setTestedSignature(null)
      setOperationStatus('error')
      setOperationMessage(
        aiProviderErrorMessage(error, `${title}连接测试失败，请检查配置`),
      )
    }
  }

  const handleSave = async () => {
    if (!canSave || !onSave) return
    setOperationStatus('saving')
    setOperationMessage(`正在保存${title}…`)
    try {
      await onSave(kind, createInput())
      clearApiKeyInput()
      setTestedSignature(null)
      setOperationStatus('saved')
      setOperationMessage(`${title}已保存并设为当前服务`)
    } catch (error) {
      setOperationStatus('error')
      setOperationMessage(aiProviderErrorMessage(error, `保存${title}失败`))
    }
  }

  const handleDelete = async () => {
    if (!selectedProfile || !onDelete || isBusy) return
    if (!window.confirm(`删除${title}“${selectedProfile.name}”吗？`)) return
    setOperationStatus('deleting')
    setOperationMessage(`正在删除${title}…`)
    try {
      await onDelete(kind, selectedProfile.id)
      setSelectedProfileId('')
      hydrateDraft(undefined)
      setOperationStatus('saved')
      setOperationMessage(`${title}配置已删除`)
    } catch (error) {
      setOperationStatus('error')
      setOperationMessage(aiProviderErrorMessage(error, `删除${title}失败`))
    }
  }

  return (
    <form
      className="pageSettingsAiProviderForm"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      <div className="pageSettingsAiServiceHeading">
        <h4>{title}</h4>
        <span>{kind === 'vision' ? '分析画面内容' : '理解搜索语义'}</span>
      </div>

      <div className="pageSettingsAiProviderField">
        <span className="pageSettingsFieldLabel">常用配置</span>
        <div className="pageSettingsAiProfileRow">
          <select
            className="pageSettingsAiProviderSelect"
            value={selectedProfileId}
            aria-label={`${title}常用配置`}
            disabled={isBusy}
            onChange={(event) => void handleSelectProfile(event.currentTarget.value)}
          >
            <option value="">手动填写新配置</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {aiServiceProfileLabel(profile)}
              </option>
            ))}
          </select>
          <button
            className="pageSettingsAiProfileDelete"
            type="button"
            aria-label={`删除当前${title}`}
            title={`删除当前${title}`}
            disabled={!selectedProfile || !onDelete || isBusy}
            onClick={() => void handleDelete()}
          >
            <Trash2 aria-hidden="true" size={13} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {localSelections.length > 0 && (
        <label className="pageSettingsAiProviderField">
          <span className="pageSettingsFieldLabel">本地可用模型</span>
          <select
            className="pageSettingsAiProviderSelect"
            value={selectedLocalModelKey}
            aria-label={`${title}本地模型`}
            disabled={isBusy}
            onChange={(event) =>
              handleSelectLocalModel(event.currentTarget.value)
            }
          >
            <option value="" disabled>选择本地模型…</option>
            {localSelections.map((selection) => (
              <option key={selection.key} value={selection.key}>
                {selection.providerLabel} · {selection.model}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="pageSettingsAiProviderField">
        <span className="pageSettingsFieldLabel">API 地址</span>
        <input
          className="pageSettingsTextInput"
          type="url"
          value={draft.baseUrl}
          placeholder="https://openrouter.ai/api/v1"
          aria-label={`${title} API 地址`}
          disabled={isBusy}
          onChange={(event) => updateDraft({ baseUrl: event.currentTarget.value })}
        />
      </label>

      <label className="pageSettingsAiProviderField">
        <span className="pageSettingsFieldLabel">{modelLabel}</span>
        <input
          className="pageSettingsTextInput"
          type="text"
          value={draft.model}
          placeholder={modelPlaceholder}
          aria-label={modelLabel}
          disabled={isBusy}
          onChange={(event) => updateDraft({ model: event.currentTarget.value })}
        />
      </label>

      <label className="pageSettingsAiProviderField">
        <span className="pageSettingsFieldLabel">API Key</span>
        <input
          ref={apiKeyInputRef}
          className="pageSettingsTextInput pageSettingsAiKeyInput"
          type="password"
          placeholder={
            canReuseSelectedKey
              ? '已安全保存，留空表示继续使用'
              : selectedProfile?.hasApiKey
                ? 'API 地址已更改，请输入新服务的 Key'
                : '本地无密钥服务可留空'
          }
          aria-label={`${title} API Key`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={isBusy}
          onChange={(event) => {
            setHasApiKeyDraft(event.currentTarget.value.trim().length > 0)
            resetTest()
          }}
        />
      </label>

      <div
        className="pageSettingsAiProviderStatus"
        data-status={operationStatus}
        role={operationStatus === 'error' ? 'alert' : undefined}
        aria-live="polite"
      >
        <span aria-hidden="true" />
        <p>
          {operationMessage ??
            externalMessage ??
            (hasApiKeyDraft && !secureStorageAvailable
              ? '当前系统无法安全保存新的 API Key'
              : !secureStorageAvailable
                ? '安全存储不可用；仍可使用本机无密钥服务'
                : selectedProfile?.hasApiKey && !canReuseSelectedKey
                  ? 'API 地址已更改；旧 Key 不会发送给新服务'
                  : canReuseSelectedKey
                    ? '已保存 API Key；留空会继续使用'
                    : !draftIsComplete
                      ? '填写完整配置后测试连接'
                      : '可直接测试；外部服务通常需要 API Key')}
        </p>
      </div>

      <div className="pageSettingsAiProviderActions">
        <button
          className="pageSettingsAiProviderTest uiGlassInset uiGlassInteractive"
          type="button"
          disabled={!canTest}
          onClick={() => void handleTest()}
        >
          {operationStatus === 'testing' ? '测试中…' : '测试连接'}
        </button>
        <button
          className="pageSettingsAiProviderSave uiGlassInset uiGlassInteractive"
          type="submit"
          title={canSave ? `保存${title}` : '请先测试连接'}
          disabled={!canSave}
        >
          {operationStatus === 'saving' ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  )
}

const isRangeThumbHit = (
  input: HTMLInputElement,
  clientX: number,
) => {
  const minimum = Number.parseFloat(input.min || '0')
  const maximum = Number.parseFloat(input.max || '100')
  const value = Number.parseFloat(input.value)
  const range = maximum - minimum
  if (!Number.isFinite(value) || !Number.isFinite(range) || range <= 0) return false

  const bounds = input.getBoundingClientRect()
  const progress = Math.min(1, Math.max(0, (value - minimum) / range))
  const travel = Math.max(0, bounds.width - RANGE_THUMB_SIZE)
  const thumbCenterX = bounds.left + RANGE_THUMB_SIZE / 2 + travel * progress

  return Math.abs(clientX - thumbCenterX)
    <= RANGE_THUMB_SIZE / 2 + RANGE_THUMB_HIT_PADDING
}

export function PageSettingsPanel({
  pageLabel,
  showParticleSettings,
  showProjectSettings,
  showPedestalTint = false,
  showMediaSourceSettings = false,
  showAiSearchSettings = false,
  projectName,
  projectDefaultName,
  projectEnglishName,
  projectDescription,
  projectDefaultDescription,
  projectCoverUrl,
  projectCoverName,
  settings,
  onClose,
  onProjectNameChange,
  onResetProjectName,
  onProjectEnglishNameChange,
  onProjectDescriptionChange,
  onResetProjectDescription,
  onChooseProjectCover,
  onResetProjectCover,
  onChooseBackground,
  onResetBackground,
  onResetAll,
  onOpenEmbyMediaSource,
  aiVisionProfiles = EMPTY_AI_SERVICE_PROFILES,
  aiEmbeddingProfiles = EMPTY_AI_SERVICE_PROFILES,
  aiActiveVisionProfileId = null,
  aiActiveEmbeddingProfileId = null,
  aiProviderSecureStorageAvailable = true,
  aiProviderExternalMessage = null,
  onSelectAiServiceProfile,
  onDeleteAiServiceProfile,
  onTestAiServiceProfile,
  onSaveAiServiceProfile,
  onDetectAiLocalModels,
  particleImportState = { status: 'idle', message: null },
  onChooseParticleMedia,
  onRemoveCustomParticleMedia,
  appUpdateState = FALLBACK_APP_UPDATE_STATE,
  onCheckForUpdates,
  appCacheState = FALLBACK_APP_CACHE_STATE,
  onInspectAppCache,
  onCleanAppCache,
  onChange,
  onParticlesChange,
}: PageSettingsPanelProps) {
  const rangeThumbDoubleClickState = useRef(
    new WeakMap<HTMLInputElement, RangeThumbDoubleClickState>(),
  )
  const [aiLocalModelServices, setAiLocalModelServices] = useState<
    readonly AiLocalModelService[]
  >([])
  const [aiLocalDetectionStatus, setAiLocalDetectionStatus] = useState<
    'idle' | 'detecting' | 'ready' | 'error'
  >('idle')
  const [aiLocalDetectionMessage, setAiLocalDetectionMessage] = useState<
    string | null
  >(null)
  const aiLocalModelDetectorRef = useRef(onDetectAiLocalModels)
  aiLocalModelDetectorRef.current = onDetectAiLocalModels
  const cacheBusy =
    appCacheState.status === 'checking' || appCacheState.status === 'cleaning'
  const cacheCanClean =
    appCacheState.reclaimableDirectories > 0 ||
    appCacheState.reclaimableSemanticEntries > 0
  const cacheReadyLabel =
    appCacheState.reclaimableBytes > 0
      ? `可释放 ${formatStorageBytes(appCacheState.reclaimableBytes)}`
      : `可清理 ${appCacheState.reclaimableSemanticEntries} 条 AI 视觉索引`
  const cacheCleanedLabel =
    appCacheState.removedBytes > 0
      ? `已清理 ${formatStorageBytes(appCacheState.removedBytes)}`
      : appCacheState.removedSemanticEntries > 0
        ? `已清理 ${appCacheState.removedSemanticEntries} 条 AI 视觉索引`
        : '清理完成'
  const cacheButtonLabel =
    appCacheState.status === 'checking'
      ? '正在检查…'
      : appCacheState.status === 'cleaning'
        ? '正在清理…'
        : cacheCanClean
          ? '清理可释放缓存'
          : appCacheState.status === 'idle'
            ? '检查缓存'
            : '重新检查'

  const detectAiLocalModels = useCallback(async () => {
    const detect = aiLocalModelDetectorRef.current
    if (!detect) return
    setAiLocalDetectionStatus('detecting')
    setAiLocalDetectionMessage('正在检测本机 Ollama 与 LM Studio…')
    try {
      const result = await detect()
      setAiLocalModelServices(result.services)
      const modelCount = result.services.reduce(
        (total, service) => total + service.models.length,
        0,
      )
      setAiLocalDetectionStatus('ready')
      setAiLocalDetectionMessage(
        modelCount > 0
          ? `发现 ${result.services.length} 个本地服务、${modelCount} 个模型`
          : '未发现正在运行的本地模型服务',
      )
    } catch (error) {
      setAiLocalModelServices([])
      setAiLocalDetectionStatus('error')
      setAiLocalDetectionMessage(
        aiProviderErrorMessage(error, '本地模型检测失败，不影响在线配置'),
      )
    }
  }, [])

  useEffect(() => {
    if (!showAiSearchSettings || !aiLocalModelDetectorRef.current) return
    void detectAiLocalModels()
  }, [showAiSearchSettings, detectAiLocalModels])

  const handleRangeMouseDown = (event: ReactMouseEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const hit = isRangeThumbHit(input, event.clientX)

    if (event.detail === 1) {
      rangeThumbDoubleClickState.current.set(input, {
        firstPressHit: hit,
        secondPressHit: false,
      })
      return
    }

    if (event.detail === 2) {
      const previous = rangeThumbDoubleClickState.current.get(input)
      rangeThumbDoubleClickState.current.set(input, {
        firstPressHit: previous?.firstPressHit ?? false,
        secondPressHit: hit,
      })
    }
  }

  const handleRangeDoubleClick = (
    event: ReactMouseEvent<HTMLInputElement>,
    reset: () => void,
  ) => {
    const input = event.currentTarget
    const state = rangeThumbDoubleClickState.current.get(input)
    rangeThumbDoubleClickState.current.delete(input)
    if (!state?.firstPressHit || !state.secondPressHit) return

    event.preventDefault()
    reset()
  }

  return (
    <>
      <PageSettingsGlassBackdrop />
      <aside
        id="page-settings-panel"
        className="pageSettingsPanel"
        data-camera-gesture="block"
        aria-label={`${pageLabel}页面设置`}
      >
      <header className="pageSettingsHeader">
        <div className="pageSettingsHeading">
          <Settings aria-hidden="true" size={16} strokeWidth={1.5} />
          <div>
            <p className="pageSettingsEyebrow">当前页面</p>
            <h2>{pageLabel}</h2>
          </div>
        </div>
        <button
          className="pageSettingsClose uiGlassInteractive"
          type="button"
          aria-label="关闭页面设置"
          onClick={onClose}
        >
          <X aria-hidden="true" size={16} strokeWidth={1.5} />
        </button>
      </header>

      <div className="pageSettingsBody">
        {showAiSearchSettings && (
          <section
            className="pageSettingsSection pageSettingsAiSearchSection"
            aria-labelledby="page-settings-ai-search"
          >
            <div className="pageSettingsSectionTitle">
              <KeyRound aria-hidden="true" size={15} strokeWidth={1.5} />
              <h3 id="page-settings-ai-search">AI 画面搜索</h3>
            </div>
            <div
              className="pageSettingsAiLocalDetection"
              data-status={aiLocalDetectionStatus}
            >
              <div>
                <span>本地模型</span>
                <p>{aiLocalDetectionMessage ?? '可检测 Ollama 与 LM Studio'}</p>
              </div>
              <button
                className="pageSettingsAiLocalRefresh uiGlassInteractive"
                type="button"
                aria-label="重新检测本地模型"
                title="重新检测本地模型"
                disabled={
                  aiLocalDetectionStatus === 'detecting' ||
                  !onDetectAiLocalModels
                }
                onClick={() => void detectAiLocalModels()}
              >
                <RefreshCw aria-hidden="true" size={12} strokeWidth={1.5} />
              </button>
            </div>

            <AiServiceConfiguration
              kind="vision"
              title="画面理解服务"
              modelLabel="画面理解模型"
              modelPlaceholder="openrouter/free"
              profiles={aiVisionProfiles}
              activeProfileId={aiActiveVisionProfileId}
              secureStorageAvailable={aiProviderSecureStorageAvailable}
              externalMessage={aiProviderExternalMessage}
              localServices={aiLocalModelServices}
              onSelect={onSelectAiServiceProfile}
              onDelete={onDeleteAiServiceProfile}
              onTest={onTestAiServiceProfile}
              onSave={onSaveAiServiceProfile}
            />

            <AiServiceConfiguration
              kind="embedding"
              title="语义检索服务"
              modelLabel="语义检索模型"
              modelPlaceholder="text-embedding-3-small"
              profiles={aiEmbeddingProfiles}
              activeProfileId={aiActiveEmbeddingProfileId}
              secureStorageAvailable={aiProviderSecureStorageAvailable}
              externalMessage={aiProviderExternalMessage}
              localServices={aiLocalModelServices}
              onSelect={onSelectAiServiceProfile}
              onDelete={onDeleteAiServiceProfile}
              onTest={onTestAiServiceProfile}
              onSave={onSaveAiServiceProfile}
            />
            <p className="pageSettingsAiSearchPrivacy">
              两项服务分别测试、分别保存，可自由组合在线与本地模型。启用 AI 搜索时仅向画面理解服务上传视觉索引关键帧缩略图，原视频不会上传；语义检索服务只接收文本。
            </p>
          </section>
        )}

        {showMediaSourceSettings && (
          <section
            className="pageSettingsSection"
            aria-labelledby="page-settings-media-sources"
          >
            <div className="pageSettingsSectionTitle">
              <Server aria-hidden="true" size={15} strokeWidth={1.5} />
              <h3 id="page-settings-media-sources">媒体来源</h3>
            </div>
            <button
              className="pageSettingsBackgroundButton uiGlassInset uiGlassInteractive"
              type="button"
              disabled={!onOpenEmbyMediaSource}
              onClick={onOpenEmbyMediaSource}
            >
              <span>连接或管理 Emby 媒体库</span>
            </button>
            <p className="pageSettingsProjectCoverHint">
              Emby 只整理你有权访问的自有媒体；在线平台账号请从页面右上角的账号中心统一管理。
            </p>
          </section>
        )}

        {showProjectSettings && (
          <section className="pageSettingsSection" aria-labelledby="page-settings-project">
            <div className="pageSettingsSectionTitle">
              <Folder aria-hidden="true" size={15} strokeWidth={1.5} />
              <h3 id="page-settings-project">当前项目</h3>
            </div>

            <label className="pageSettingsProjectNameControl">
              <span className="pageSettingsFieldLabel">项目名称</span>
              <input
                className="pageSettingsTextInput"
                type="text"
                value={projectName ?? ''}
                maxLength={40}
                placeholder={projectDefaultName ?? '输入项目名称'}
                aria-label="当前项目名称"
                onChange={(event) => onProjectNameChange?.(event.currentTarget.value)}
              />
            </label>
            <div className="pageSettingsProjectNameStatus">
              <span>{(projectName ?? '').length}/40</span>
              <button
                className="pageSettingsTextButton"
                type="button"
                disabled={
                  !onResetProjectName ||
                  projectName === undefined ||
                  projectName === projectDefaultName
                }
                onClick={onResetProjectName}
              >
                恢复默认名称
              </button>
            </div>

            <label className="pageSettingsProjectNameControl">
              <span className="pageSettingsFieldLabel">英文名称</span>
              <input
                className="pageSettingsTextInput"
                type="text"
                value={projectEnglishName ?? ''}
                lang="en"
                maxLength={60}
                placeholder="可留空；为空时项目卡不显示"
                aria-label="当前项目英文名称"
                onBlur={(event) =>
                  onProjectEnglishNameChange?.(event.currentTarget.value.trim())
                }
                onChange={(event) =>
                  onProjectEnglishNameChange?.(event.currentTarget.value)
                }
              />
            </label>
            <div className="pageSettingsProjectNameStatus">
              <span>{(projectEnglishName ?? '').length}/60</span>
              <span>可留空</span>
            </div>

            <label className="pageSettingsProjectNameControl">
              <span className="pageSettingsFieldLabel">项目描述</span>
              <input
                className="pageSettingsTextInput"
                type="text"
                value={projectDescription ?? ''}
                maxLength={100}
                placeholder={projectDefaultDescription ?? '输入项目描述'}
                aria-label="当前项目描述"
                onBlur={(event) =>
                  onProjectDescriptionChange?.(event.currentTarget.value.trim())
                }
                onChange={(event) =>
                  onProjectDescriptionChange?.(event.currentTarget.value)
                }
              />
            </label>
            <div className="pageSettingsProjectNameStatus">
              <span>{(projectDescription ?? '').length}/100</span>
              <button
                className="pageSettingsTextButton"
                type="button"
                disabled={
                  !onResetProjectDescription ||
                  projectDescription === undefined ||
                  projectDescription === projectDefaultDescription
                }
                onClick={onResetProjectDescription}
              >
                恢复默认描述
              </button>
            </div>

            <div className="pageSettingsProjectCoverPreview" aria-label="当前项目封面预览">
              {projectCoverUrl ? (
                <img src={projectCoverUrl} alt="当前项目封面" />
              ) : (
                <span className="pageSettingsProjectCoverEmpty">
                  <Image aria-hidden="true" size={17} strokeWidth={1.35} />
                  暂无封面
                </span>
              )}
            </div>
            <p className="pageSettingsProjectCoverHint">任意尺寸，自动等比居中裁剪为 4:3</p>
            <button
              className="pageSettingsBackgroundButton uiGlassInset uiGlassInteractive"
              type="button"
              disabled={!onChooseProjectCover}
              onClick={onChooseProjectCover}
            >
              <span>选择本地封面图片</span>
            </button>
            <div className="pageSettingsBackgroundStatus">
              <span
                className="pageSettingsBackgroundName"
                title={projectCoverName ?? undefined}
              >
                {projectCoverName ??
                  (projectCoverUrl ? '使用项目默认封面' : '暂无封面')}
              </span>
              <button
                className="pageSettingsTextButton"
                type="button"
                disabled={!projectCoverName || !onResetProjectCover}
                onClick={onResetProjectCover}
              >
                恢复默认封面
              </button>
            </div>
          </section>
        )}

        <section className="pageSettingsSection" aria-labelledby="page-settings-background">
          <div className="pageSettingsSectionTitle">
            <Image aria-hidden="true" size={15} strokeWidth={1.5} />
            <h3 id="page-settings-background">页面背景</h3>
          </div>
          <button
            className="pageSettingsBackgroundButton uiGlassInset uiGlassInteractive"
            type="button"
            onClick={onChooseBackground}
          >
            <span>选择本地图片或视频</span>
          </button>
          <div className="pageSettingsBackgroundStatus">
            <span className="pageSettingsBackgroundName" title={settings.background?.name}>
              {settings.background?.name ?? '使用页面默认背景'}
            </span>
            <button
              className="pageSettingsTextButton"
              type="button"
              disabled={!settings.background}
              onClick={onResetBackground}
            >
              恢复默认
            </button>
          </div>
        </section>

        <section className="pageSettingsSection" aria-labelledby="page-settings-grade">
          <div className="pageSettingsSectionTitle">
            <SlidersHorizontal aria-hidden="true" size={15} strokeWidth={1.5} />
            <h3 id="page-settings-grade">整体滤镜</h3>
          </div>

          <label className="pageSettingsRangeControl">
            <span className="pageSettingsControlLabel">
              <span>对比度</span>
              <output>{settings.contrast}%</output>
            </span>
            <input
              type="range"
              min="50"
              max="150"
              step="1"
              value={settings.contrast}
              title="双击滑块恢复默认值"
              onMouseDown={handleRangeMouseDown}
              onDoubleClick={(event) =>
                handleRangeDoubleClick(event, () =>
                  onChange({ contrast: PAGE_SETTINGS_RANGE_DEFAULTS.contrast }),
                )
              }
              onChange={(event) => onChange({ contrast: Number(event.currentTarget.value) })}
            />
          </label>

          <label className="pageSettingsRangeControl">
            <span className="pageSettingsControlLabel">
              <span>饱和度</span>
              <output>{settings.saturation}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="200"
              step="1"
              value={settings.saturation}
              title="双击滑块恢复默认值"
              onMouseDown={handleRangeMouseDown}
              onDoubleClick={(event) =>
                handleRangeDoubleClick(event, () =>
                  onChange({ saturation: PAGE_SETTINGS_RANGE_DEFAULTS.saturation }),
                )
              }
              onChange={(event) => onChange({ saturation: Number(event.currentTarget.value) })}
            />
          </label>

          <label className="pageSettingsRangeControl">
            <span className="pageSettingsControlLabel">
              <span>色彩偏移</span>
              <output>{settings.hue > 0 ? '+' : ''}{settings.hue}°</output>
            </span>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={settings.hue}
              title="双击滑块恢复默认值"
              onMouseDown={handleRangeMouseDown}
              onDoubleClick={(event) =>
                handleRangeDoubleClick(event, () =>
                  onChange({ hue: PAGE_SETTINGS_RANGE_DEFAULTS.hue }),
                )
              }
              onChange={(event) => onChange({ hue: Number(event.currentTarget.value) })}
            />
          </label>
        </section>

        <section className="pageSettingsSection" aria-labelledby="page-settings-colors">
          <div className="pageSettingsSectionTitle">
            <Palette aria-hidden="true" size={15} strokeWidth={1.5} />
            <h3 id="page-settings-colors">界面颜色</h3>
          </div>

          <label className="pageSettingsColorControl">
            <span>二维 UI 边框</span>
            <span className="pageSettingsColorValue">
              <code>{settings.uiBorderColor.toUpperCase()}</code>
              <input
                type="color"
                value={settings.uiBorderColor}
                aria-label="二维 UI 边框颜色"
                onChange={(event) => onChange({ uiBorderColor: event.currentTarget.value })}
              />
            </span>
          </label>

          <label className="pageSettingsColorControl">
            <span>素材 UI 染色</span>
            <span className="pageSettingsColorValue">
              <code>{settings.materialTint.toUpperCase()}</code>
              <input
                type="color"
                value={settings.materialTint}
                aria-label="素材 UI 染色"
                onChange={(event) => onChange({ materialTint: event.currentTarget.value })}
              />
            </span>
          </label>

          {showPedestalTint && (
            <label className="pageSettingsColorControl">
              <span>底座染色</span>
              <span className="pageSettingsColorValue">
                <code>{settings.pedestalTint.toUpperCase()}</code>
                <input
                  type="color"
                  value={settings.pedestalTint}
                  aria-label="底座染色"
                  onChange={(event) =>
                    onChange({ pedestalTint: event.currentTarget.value })
                  }
                />
              </span>
            </label>
          )}
        </section>

        {showParticleSettings && (
          <section className="pageSettingsSection" aria-labelledby="page-settings-particles">
            <div className="pageSettingsSectionTitle">
              <Sparkles aria-hidden="true" size={15} strokeWidth={1.5} />
              <h3 id="page-settings-particles">背景粒子</h3>
            </div>

            <div className="pageSettingsFieldGroup">
              <span className="pageSettingsFieldLabel">粒子素材</span>
              <div
                className="pageSettingsParticlePresetGrid"
                role="group"
                aria-label="粒子素材预设"
              >
                {PARTICLE_PRESETS.map((option) => (
                  <button
                    className={settings.particles.shape === option.id ? 'active' : ''}
                    type="button"
                    key={option.id}
                    aria-pressed={settings.particles.shape === option.id}
                    onClick={() => onParticlesChange({ shape: option.id })}
                  >
                    <span className="pageSettingsParticlePresetPreview" aria-hidden="true">
                      {option.assetPath ? (
                        <img
                          src={resolveDocumentAssetUrl(option.assetPath)}
                          alt=""
                          draggable="false"
                        />
                      ) : (
                        <span className="pageSettingsParticleDotPreview" />
                      )}
                    </span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>

              <div
                className={`pageSettingsParticleCustom ${
                  settings.particles.shape === 'custom' ? 'active' : ''
                }`}
              >
                <button
                  className="pageSettingsParticleCustomSelect"
                  type="button"
                  disabled={particleImportState.status === 'validating'}
                  aria-pressed={settings.particles.shape === 'custom'}
                  onClick={() => {
                    if (settings.particles.customMedia) {
                      onParticlesChange({ shape: 'custom' })
                    } else {
                      onChooseParticleMedia?.()
                    }
                  }}
                >
                  <span className="pageSettingsParticleCustomPreview" aria-hidden="true">
                    {settings.particles.customMedia ? (
                      <img
                        src={settings.particles.customMedia.posterUrl}
                        alt=""
                        draggable="false"
                      />
                    ) : (
                      <Image size={14} strokeWidth={1.45} />
                    )}
                  </span>
                  <span className="pageSettingsParticleCustomCopy">
                    <strong>
                      {particleImportState.status === 'validating'
                        ? '正在准备素材…'
                        : settings.particles.customMedia?.name ?? '导入自定义素材'}
                    </strong>
                    <small>
                      {settings.particles.customMedia
                        ? settings.particles.customMedia.kind === 'video'
                          ? '透明视频'
                          : '透明 PNG'
                        : 'PNG 或带通道视频'}
                    </small>
                  </span>
                </button>
                {settings.particles.customMedia && (
                  <button
                    className="pageSettingsParticleCustomReplace"
                    type="button"
                    disabled={particleImportState.status === 'validating'}
                    onClick={onChooseParticleMedia}
                  >
                    替换
                  </button>
                )}
              </div>
              <div className="pageSettingsParticleImportMeta">
                <span>{PARTICLE_IMPORT_LIMIT_HINT}</span>
                {settings.particles.customMedia && (
                  <button type="button" onClick={onRemoveCustomParticleMedia}>
                    移除自定义
                  </button>
                )}
              </div>
              {particleImportState.status === 'error' && (
                <p className="pageSettingsParticleImportError" role="alert">
                  {particleImportState.message}
                </p>
              )}
            </div>

            <label className="pageSettingsColorControl">
              <span>
                {settings.particles.shape === 'dot' ? '粒子颜色' : '光效颜色'}
              </span>
              <span className="pageSettingsColorValue">
                <code>{settings.particles.color.toUpperCase()}</code>
                <input
                  type="color"
                  value={settings.particles.color}
                  aria-label="背景粒子颜色"
                  onChange={(event) => onParticlesChange({ color: event.currentTarget.value })}
                />
              </span>
            </label>

            <label className="pageSettingsRangeControl">
              <span className="pageSettingsControlLabel">
                <span>旋转速率</span>
                <output>{settings.particles.rotationSpeed.toFixed(1)}×</output>
              </span>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.1"
                value={settings.particles.rotationSpeed}
                title="负值为反向旋转，双击滑块恢复默认值"
                onMouseDown={handleRangeMouseDown}
                onDoubleClick={(event) =>
                  handleRangeDoubleClick(event, () =>
                    onParticlesChange({
                      rotationSpeed:
                        PAGE_SETTINGS_RANGE_DEFAULTS.particleRotationSpeed,
                    }),
                  )
                }
                onChange={(event) =>
                  onParticlesChange({
                    rotationSpeed: Number(event.currentTarget.value),
                  })
                }
              />
            </label>

            <label className="pageSettingsRangeControl">
              <span className="pageSettingsControlLabel">
                <span>粒子速率</span>
                <output>{settings.particles.speed.toFixed(1)}×</output>
              </span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={settings.particles.speed}
                title="双击滑块恢复默认值"
                onMouseDown={handleRangeMouseDown}
                onDoubleClick={(event) =>
                  handleRangeDoubleClick(event, () =>
                    onParticlesChange({ speed: PAGE_SETTINGS_RANGE_DEFAULTS.particleSpeed }),
                  )
                }
                onChange={(event) => onParticlesChange({ speed: Number(event.currentTarget.value) })}
              />
            </label>

            <label className="pageSettingsRangeControl">
              <span className="pageSettingsControlLabel">
                <span>粒子大小</span>
                <output>
                  {`${(settings.particles.size ?? PAGE_SETTINGS_RANGE_DEFAULTS.particleSize).toFixed(1)}×`}
                </output>
              </span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={settings.particles.size ?? PAGE_SETTINGS_RANGE_DEFAULTS.particleSize}
                title="双击滑块恢复默认值"
                onMouseDown={handleRangeMouseDown}
                onDoubleClick={(event) =>
                  handleRangeDoubleClick(event, () =>
                    onParticlesChange({ size: PAGE_SETTINGS_RANGE_DEFAULTS.particleSize }),
                  )
                }
                onChange={(event) => onParticlesChange({ size: Number(event.currentTarget.value) })}
              />
            </label>

            <label className="pageSettingsRangeControl">
              <span className="pageSettingsControlLabel">
                <span>粒子数量</span>
                <output>{settings.particles.count}</output>
              </span>
              <input
                type="range"
                min="0"
                max="160"
                step="1"
                value={settings.particles.count}
                title="双击滑块恢复默认值"
                onMouseDown={handleRangeMouseDown}
                onDoubleClick={(event) =>
                  handleRangeDoubleClick(event, () =>
                    onParticlesChange({ count: PAGE_SETTINGS_RANGE_DEFAULTS.particleCount }),
                  )
                }
                onChange={(event) => onParticlesChange({ count: Number(event.currentTarget.value) })}
              />
            </label>
          </section>
        )}

        <section className="pageSettingsSection" aria-labelledby="page-settings-cache">
          <div className="pageSettingsSectionTitle">
            <HardDrive aria-hidden="true" size={15} strokeWidth={1.5} />
            <h3 id="page-settings-cache">存储与缓存</h3>
          </div>
          <div
            className="pageSettingsCacheCard uiGlassInset"
            data-status={appCacheState.status}
          >
            <span aria-live="polite">
              <strong>
                {appCacheState.status === 'idle'
                  ? '尚未检查'
                  : appCacheState.status === 'checking'
                    ? '正在统计 Aurora 缓存'
                    : appCacheState.status === 'cleaning'
                      ? '正在清理未使用缓存'
                      : appCacheState.status === 'error'
                        ? '缓存检查失败'
                        : appCacheState.status === 'cleaned'
                          ? cacheCleanedLabel
                          : cacheCanClean
                            ? cacheReadyLabel
                            : '暂无可清理缓存'}
              </strong>
              <small>
                {appCacheState.status === 'idle'
                  ? '检查未被项目或收藏使用的缓存'
                  : appCacheState.status === 'error'
                    ? appCacheState.error ?? '请稍后重试'
                    : appCacheState.status === 'cleaned'
                      ? appCacheState.removedSemanticEntries > 0 && appCacheState.removedBytes > 0
                        ? `另清理 ${appCacheState.removedSemanticEntries} 条 AI 视觉索引`
                        : `剩余媒体缓存 ${formatStorageBytes(appCacheState.totalBytes)} · AI 视觉索引 ${appCacheState.semanticEntries} 条`
                      : `媒体缓存 ${formatStorageBytes(appCacheState.totalBytes)} · AI 视觉索引 ${appCacheState.semanticEntries} 条`}
              </small>
            </span>
            <button
              className="pageSettingsCacheButton uiGlassInteractive"
              type="button"
              disabled={
                cacheBusy ||
                (cacheCanClean ? !onCleanAppCache : !onInspectAppCache)
              }
              onClick={cacheCanClean ? onCleanAppCache : onInspectAppCache}
            >
              {cacheCanClean && !cacheBusy ? (
                <Trash2 aria-hidden="true" size={12} strokeWidth={1.5} />
              ) : (
                <RefreshCw aria-hidden="true" size={12} strokeWidth={1.5} />
              )}
              <span>{cacheButtonLabel}</span>
            </button>
          </div>
          <p className="pageSettingsCacheHint">
            只清理 Aurora 托管的未使用预览、抽帧与 AI 搜索缓存；磁盘原文件和使用中的素材不会删除。
          </p>
        </section>
      </div>

        <footer className="pageSettingsFooter">
          <div className="pageSettingsVersionRow">
            <span>
              <strong>Aurora</strong>
              <small>版本 {appUpdateState.currentVersion}</small>
            </span>
            <button
              type="button"
              disabled={
                !appUpdateState.supported ||
                appUpdateState.status === 'checking' ||
                appUpdateState.status === 'downloading' ||
                appUpdateState.status === 'downloaded' ||
                appUpdateState.status === 'installing'
              }
              onClick={onCheckForUpdates}
            >
              {appUpdateButtonLabel(appUpdateState)}
            </button>
          </div>
          {appUpdateState.status === 'error' &&
            appUpdateState.source !== 'automatic' &&
            appUpdateState.error && (
            <p className="pageSettingsUpdateError" role="status">
              {appUpdateState.error}
            </p>
          )}
          <button
            className="pageSettingsResetButton uiGlassInset uiGlassInteractive"
            type="button"
            onClick={onResetAll}
          >
            <RefreshCw aria-hidden="true" size={14} strokeWidth={1.5} />
            <span>重置当前页设置</span>
          </button>
        </footer>
      </aside>
    </>
  )
}
