const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const AI_CREDENTIAL_PROVIDER = 'openai-compatible'
const AI_CREDENTIAL_VERSION = 3
const AI_SERVICE_KINDS = Object.freeze({
  VISION: 'vision',
  EMBEDDING: 'embedding',
})
const MAX_API_KEY_LENGTH = 8_192
const MAX_PROFILE_COUNT = 30

class AiCredentialError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AiCredentialError'
    this.code = code
  }
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 31 || codePoint === 127
  })
}

function normalizeAiCredentialError(error) {
  if (error instanceof AiCredentialError) {
    return {
      code: error.code,
      message: error.message,
    }
  }

  return {
    code: 'AI_PROVIDER_STORAGE_ERROR',
    message: '无法更新模型服务设置，请稍后重试。',
  }
}

function cleanRequiredText(value, label, maxLength) {
  if (typeof value !== 'string') {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      `请填写${label}。`,
    )
  }
  const normalized = value.trim()
  if (
    normalized === '' ||
    normalized.length > maxLength ||
    containsControlCharacter(normalized)
  ) {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      `${label}无效。`,
    )
  }
  return normalized
}

function normalizeProfileId(value, { optional = false } = {}) {
  if ((value == null || value === '') && optional) return null
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.trim())
  ) {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      '模型服务 ID 无效。',
    )
  }
  return value.trim()
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  )
}

function normalizeProviderBaseUrl(value) {
  const normalized = cleanRequiredText(value, 'API 地址', 2_048)
  let url
  try {
    url = new URL(normalized)
  } catch {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      'API 地址格式不正确。',
    )
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      'API 地址不能包含账号、密码、查询参数或片段。',
    )
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AiCredentialError(
      'AI_PROVIDER_INSECURE_URL',
      'API 地址仅支持 HTTPS；本机回环服务可使用 HTTP。',
    )
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new AiCredentialError(
      'AI_PROVIDER_INSECURE_URL',
      '外部模型服务必须使用 HTTPS；只有本机回环地址可使用 HTTP。',
    )
  }

  url.pathname = url.pathname
    .replace(/\/(?:chat\/completions|embeddings)\/?$/i, '')
    .replace(/\/+$/, '')
  return url.toString().replace(/\/+$/, '')
}

function normalizeApiKey(value) {
  if (value == null) return ''
  if (typeof value !== 'string') {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      'API Key 无效。',
    )
  }
  const normalized = value.trim()
  if (normalized.length > MAX_API_KEY_LENGTH || containsControlCharacter(normalized)) {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      'API Key 无效。',
    )
  }
  return normalized
}

function normalizeAiServiceKind(value) {
  if (value !== AI_SERVICE_KINDS.VISION && value !== AI_SERVICE_KINDS.EMBEDDING) {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      '模型服务类型无效。',
    )
  }
  return value
}

function normalizeServiceProfileInput(kind, value) {
  const normalizedKind = normalizeAiServiceKind(kind)
  if (!value || typeof value !== 'object') {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      '模型服务设置无效。',
    )
  }
  return {
    id: normalizeProfileId(value.id, { optional: true }),
    name: cleanRequiredText(value.name, '配置名称', 120),
    baseUrl: normalizeProviderBaseUrl(value.baseUrl),
    model: cleanRequiredText(
      value.model,
      normalizedKind === AI_SERVICE_KINDS.VISION
        ? '视觉模型名称'
        : 'Embedding 模型名称',
      300,
    ),
    apiKey: normalizeApiKey(value.apiKey),
    clearApiKey: value.clearApiKey === true,
  }
}

function normalizeProviderProfileInput(value) {
  if (!value || typeof value !== 'object') {
    throw new AiCredentialError(
      'AI_PROVIDER_INVALID_INPUT',
      '模型服务设置无效。',
    )
  }
  return {
    id: normalizeProfileId(value.id, { optional: true }),
    name: cleanRequiredText(value.name, '配置名称', 120),
    baseUrl: normalizeProviderBaseUrl(value.baseUrl),
    visionModel: cleanRequiredText(value.visionModel, '视觉模型名称', 300),
    embeddingModel: cleanRequiredText(value.embeddingModel, 'Embedding 模型名称', 300),
    apiKey: normalizeApiKey(value.apiKey),
    clearApiKey: value.clearApiKey === true,
  }
}

function canUseLegacyOpenAiKey(input) {
  try {
    return normalizeProviderBaseUrl(input.baseUrl) === 'https://api.openai.com/v1'
  } catch {
    return false
  }
}

function createEmptyStoredProfiles() {
  return {
    version: AI_CREDENTIAL_VERSION,
    activeVisionProfileId: null,
    activeEmbeddingProfileId: null,
    visionProfiles: [],
    embeddingProfiles: [],
    legacyEncryptedApiKey: '',
    legacyKeyPendingKinds: [],
  }
}

function normalizeStoredServiceProfile(value) {
  if (!value || typeof value !== 'object') return null
  try {
    return {
      id: normalizeProfileId(value.id),
      name: cleanRequiredText(value.name, '配置名称', 120),
      baseUrl: normalizeProviderBaseUrl(value.baseUrl),
      model: cleanRequiredText(value.model, '模型名称', 300),
      encryptedApiKey:
        typeof value.encryptedApiKey === 'string'
          ? value.encryptedApiKey.slice(0, 32_768)
          : '',
      createdAt:
        typeof value.createdAt === 'string' && value.createdAt !== ''
          ? value.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof value.updatedAt === 'string' && value.updatedAt !== ''
          ? value.updatedAt
          : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

function normalizeLegacyCombinedProfile(value) {
  if (!value || typeof value !== 'object') return null
  try {
    return {
      id: normalizeProfileId(value.id),
      name: cleanRequiredText(value.name, '配置名称', 120),
      baseUrl: normalizeProviderBaseUrl(value.baseUrl),
      visionModel: cleanRequiredText(value.visionModel, '视觉模型名称', 300),
      embeddingModel: cleanRequiredText(value.embeddingModel, 'Embedding 模型名称', 300),
      encryptedApiKey:
        typeof value.encryptedApiKey === 'string'
          ? value.encryptedApiKey.slice(0, 32_768)
          : '',
      createdAt:
        typeof value.createdAt === 'string' && value.createdAt !== ''
          ? value.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof value.updatedAt === 'string' && value.updatedAt !== ''
          ? value.updatedAt
          : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

function normalizeStoredServiceProfiles(values) {
  if (!Array.isArray(values) || values.length > MAX_PROFILE_COUNT) {
    throw new AiCredentialError(
      'AI_PROVIDER_STORAGE_ERROR',
      '模型服务设置档案数量异常；原文件已保留。',
    )
  }

  const seen = new Set()
  const profiles = []
  for (const rawProfile of values) {
    const profile = normalizeStoredServiceProfile(rawProfile)
    if (!profile || seen.has(profile.id)) {
      throw new AiCredentialError(
        'AI_PROVIDER_STORAGE_ERROR',
        '模型服务设置包含无效档案；原文件已保留。',
      )
    }
    seen.add(profile.id)
    profiles.push(profile)
  }
  return profiles
}

function normalizeStoredProfiles(value) {
  if (!value || typeof value !== 'object') {
    throw new AiCredentialError(
      'AI_PROVIDER_STORAGE_ERROR',
      '模型服务设置文件已损坏；原文件已保留，请先修复或备份后移除。',
    )
  }

  if (
    value.version === 1 &&
    value.provider === 'openai' &&
    typeof value.encryptedApiKey === 'string'
  ) {
    return {
      ...createEmptyStoredProfiles(),
      legacyEncryptedApiKey: value.encryptedApiKey.slice(0, 32_768),
      legacyKeyPendingKinds: [
        AI_SERVICE_KINDS.VISION,
        AI_SERVICE_KINDS.EMBEDDING,
      ],
    }
  }

  if (value.version === 2 && Array.isArray(value.profiles)) {
    if (value.profiles.length > MAX_PROFILE_COUNT) {
      throw new AiCredentialError(
        'AI_PROVIDER_STORAGE_ERROR',
        '模型服务设置档案数量异常；原文件已保留。',
      )
    }
    const seen = new Set()
    const legacyProfiles = value.profiles.map((rawProfile) => {
      const profile = normalizeLegacyCombinedProfile(rawProfile)
      if (!profile || seen.has(profile.id)) {
        throw new AiCredentialError(
          'AI_PROVIDER_STORAGE_ERROR',
          '模型服务设置包含无效档案；原文件已保留。',
        )
      }
      seen.add(profile.id)
      return profile
    })
    const requestedActiveId =
      typeof value.activeProfileId === 'string' ? value.activeProfileId : null
    const activeProfileId = legacyProfiles.some(
      (profile) => profile.id === requestedActiveId,
    )
      ? requestedActiveId
      : null
    return {
      version: AI_CREDENTIAL_VERSION,
      activeVisionProfileId: activeProfileId,
      activeEmbeddingProfileId: activeProfileId,
      visionProfiles: legacyProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        baseUrl: profile.baseUrl,
        model: profile.visionModel,
        encryptedApiKey: profile.encryptedApiKey,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      })),
      embeddingProfiles: legacyProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        baseUrl: profile.baseUrl,
        model: profile.embeddingModel,
        encryptedApiKey: profile.encryptedApiKey,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      })),
      legacyEncryptedApiKey:
        typeof value.legacyEncryptedApiKey === 'string'
          ? value.legacyEncryptedApiKey.slice(0, 32_768)
          : '',
      legacyKeyPendingKinds:
        typeof value.legacyEncryptedApiKey === 'string' &&
        value.legacyEncryptedApiKey !== ''
          ? [AI_SERVICE_KINDS.VISION, AI_SERVICE_KINDS.EMBEDDING]
          : [],
    }
  }

  if (value.version !== AI_CREDENTIAL_VERSION) {
    throw new AiCredentialError(
      'AI_PROVIDER_STORAGE_ERROR',
      '模型服务设置版本无法识别；原文件已保留。',
    )
  }
  const visionProfiles = normalizeStoredServiceProfiles(value.visionProfiles)
  const embeddingProfiles = normalizeStoredServiceProfiles(value.embeddingProfiles)
  const requestedActiveVisionId =
    typeof value.activeVisionProfileId === 'string'
      ? value.activeVisionProfileId
      : null
  const requestedActiveEmbeddingId =
    typeof value.activeEmbeddingProfileId === 'string'
      ? value.activeEmbeddingProfileId
      : null
  const pendingKinds = Array.isArray(value.legacyKeyPendingKinds)
    ? value.legacyKeyPendingKinds.filter(
        (kind, index, values) =>
          (kind === AI_SERVICE_KINDS.VISION ||
            kind === AI_SERVICE_KINDS.EMBEDDING) &&
          values.indexOf(kind) === index,
      )
    : []
  return {
    version: AI_CREDENTIAL_VERSION,
    activeVisionProfileId: visionProfiles.some(
      (profile) => profile.id === requestedActiveVisionId,
    )
      ? requestedActiveVisionId
      : null,
    activeEmbeddingProfileId: embeddingProfiles.some(
      (profile) => profile.id === requestedActiveEmbeddingId,
    )
      ? requestedActiveEmbeddingId
      : null,
    visionProfiles,
    embeddingProfiles,
    legacyEncryptedApiKey:
      typeof value.legacyEncryptedApiKey === 'string'
        ? value.legacyEncryptedApiKey.slice(0, 32_768)
        : '',
    legacyKeyPendingKinds: pendingKinds,
  }
}

function createAiCredentialsStore({
  filePath,
  safeStorage,
  fileSystem = fs.promises,
  now = () => new Date(),
}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new TypeError('An absolute AI credential file path is required')
  }
  if (
    !safeStorage ||
    typeof safeStorage.isEncryptionAvailable !== 'function' ||
    typeof safeStorage.encryptString !== 'function' ||
    typeof safeStorage.decryptString !== 'function'
  ) {
    throw new TypeError('Electron safeStorage is required')
  }

  const secureStorageAvailable = () => safeStorage.isEncryptionAvailable() === true
  let writeQueue = Promise.resolve()

  async function readStoredProfiles() {
    try {
      const text = await fileSystem.readFile(filePath, 'utf8')
      return normalizeStoredProfiles(JSON.parse(text))
    } catch (error) {
      if (error?.code === 'ENOENT') return createEmptyStoredProfiles()
      if (error instanceof AiCredentialError) throw error
      throw new AiCredentialError(
        'AI_PROVIDER_STORAGE_ERROR',
        error instanceof SyntaxError
          ? '模型服务设置文件已损坏；原文件已保留，请先修复或备份后移除。'
          : '无法读取模型服务设置。',
      )
    }
  }

  function decryptApiKey(encryptedApiKey) {
    if (!encryptedApiKey || !secureStorageAvailable()) return null
    try {
      const apiKey = safeStorage
        .decryptString(Buffer.from(encryptedApiKey, 'base64'))
        .trim()
      return apiKey && apiKey.length <= MAX_API_KEY_LENGTH ? apiKey : null
    } catch {
      return null
    }
  }

  function encryptApiKey(apiKey) {
    if (!apiKey) return ''
    if (!secureStorageAvailable()) {
      throw new AiCredentialError(
        'AI_PROVIDER_ENCRYPTION_UNAVAILABLE',
        '当前系统无法安全保存 API Key；可以留空连接本地无密钥服务。',
      )
    }
    try {
      return safeStorage.encryptString(apiKey).toString('base64')
    } catch {
      throw new AiCredentialError(
        'AI_PROVIDER_STORAGE_ERROR',
        '无法加密 API Key。',
      )
    }
  }

  function publicServiceProfile(profile) {
    return {
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      model: profile.model,
      hasApiKey: decryptApiKey(profile.encryptedApiKey) !== null,
    }
  }

  function publicServiceState(stored) {
    return {
      visionProfiles: stored.visionProfiles.map(publicServiceProfile),
      embeddingProfiles: stored.embeddingProfiles.map(publicServiceProfile),
      activeVisionProfileId: stored.activeVisionProfileId,
      activeEmbeddingProfileId: stored.activeEmbeddingProfileId,
      secureStorageAvailable: secureStorageAvailable(),
    }
  }

  function serviceProfileList(stored, kind) {
    return kind === AI_SERVICE_KINDS.VISION
      ? stored.visionProfiles
      : stored.embeddingProfiles
  }

  function activeProfileIdField(kind) {
    return kind === AI_SERVICE_KINDS.VISION
      ? 'activeVisionProfileId'
      : 'activeEmbeddingProfileId'
  }

  function mainProcessServiceProfile(profile) {
    if (!profile) return null
    return {
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: decryptApiKey(profile.encryptedApiKey),
    }
  }

  function consumeLegacyKeyForKind(stored, kind) {
    stored.legacyKeyPendingKinds = stored.legacyKeyPendingKinds.filter(
      (pendingKind) => pendingKind !== kind,
    )
    if (stored.legacyKeyPendingKinds.length === 0) {
      stored.legacyEncryptedApiKey = ''
    }
  }

  function resolveEncryptedKeyForSave({ stored, kind, input, existing }) {
    const handlesLegacyClaim =
      !existing &&
      stored.legacyEncryptedApiKey &&
      stored.legacyKeyPendingKinds.includes(kind) &&
      canUseLegacyOpenAiKey(input)
    if (input.clearApiKey) {
      return {
        encryptedApiKey: '',
        handlesLegacyClaim: Boolean(handlesLegacyClaim),
      }
    }
    if (input.apiKey) {
      return {
        encryptedApiKey: encryptApiKey(input.apiKey),
        handlesLegacyClaim: Boolean(handlesLegacyClaim),
      }
    }
    if (existing?.baseUrl === input.baseUrl) {
      return {
        encryptedApiKey: existing.encryptedApiKey,
        handlesLegacyClaim: false,
      }
    }
    if (handlesLegacyClaim) {
      return {
        encryptedApiKey: stored.legacyEncryptedApiKey,
        handlesLegacyClaim: true,
      }
    }
    return { encryptedApiKey: '', handlesLegacyClaim: false }
  }

  function upsertServiceProfileInStored(stored, kind, input, forcedId = null) {
    const profiles = serviceProfileList(stored, kind)
    const existingIndex = input.id
      ? profiles.findIndex((profile) => profile.id === input.id)
      : -1
    if (input.id && existingIndex < 0) {
      throw new AiCredentialError(
        'AI_PROVIDER_PROFILE_NOT_FOUND',
        '要更新的模型服务不存在。',
      )
    }
    if (existingIndex < 0 && profiles.length >= MAX_PROFILE_COUNT) {
      throw new AiCredentialError(
        'AI_PROVIDER_PROFILE_LIMIT',
        `每类最多保存 ${MAX_PROFILE_COUNT} 个模型服务。`,
      )
    }

    const existing = existingIndex >= 0 ? profiles[existingIndex] : null
    const { encryptedApiKey, handlesLegacyClaim } = resolveEncryptedKeyForSave({
      stored,
      kind,
      input,
      existing,
    })
    const timestamp = now().toISOString()
    const profile = {
      id: existing?.id ?? forcedId ?? `${kind}-${crypto.randomUUID()}`,
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      encryptedApiKey,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    if (existingIndex >= 0) profiles[existingIndex] = profile
    else profiles.unshift(profile)
    stored[activeProfileIdField(kind)] = profile.id
    if (handlesLegacyClaim) consumeLegacyKeyForKind(stored, kind)
    return profile
  }

  function compatibleCombinedProfile(stored, profileId) {
    const vision = stored.visionProfiles.find((profile) => profile.id === profileId)
    const embedding = stored.embeddingProfiles.find(
      (profile) => profile.id === profileId,
    )
    if (!vision || !embedding || vision.baseUrl !== embedding.baseUrl) return null
    const visionKey = decryptApiKey(vision.encryptedApiKey)
    const embeddingKey = decryptApiKey(embedding.encryptedApiKey)
    if (visionKey !== embeddingKey) return null
    return { vision, embedding, apiKey: visionKey }
  }

  function publicCombinedProfile(pair) {
    return {
      id: pair.vision.id,
      name: pair.vision.name,
      baseUrl: pair.vision.baseUrl,
      visionModel: pair.vision.model,
      embeddingModel: pair.embedding.model,
      hasApiKey: pair.apiKey !== null,
    }
  }

  function publicCombinedState(stored) {
    const profiles = stored.visionProfiles.flatMap((profile) => {
      const pair = compatibleCombinedProfile(stored, profile.id)
      return pair ? [publicCombinedProfile(pair)] : []
    })
    const activeProfileId =
      stored.activeVisionProfileId === stored.activeEmbeddingProfileId &&
      profiles.some((profile) => profile.id === stored.activeVisionProfileId)
        ? stored.activeVisionProfileId
        : null
    return {
      profiles,
      activeProfileId,
      secureStorageAvailable: secureStorageAvailable(),
    }
  }

  async function writeStoredProfiles(stored) {
    const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`
    const serialized = {
      version: AI_CREDENTIAL_VERSION,
      activeVisionProfileId: stored.activeVisionProfileId,
      activeEmbeddingProfileId: stored.activeEmbeddingProfileId,
      visionProfiles: stored.visionProfiles,
      embeddingProfiles: stored.embeddingProfiles,
      ...(stored.legacyEncryptedApiKey
        ? {
            legacyEncryptedApiKey: stored.legacyEncryptedApiKey,
            legacyKeyPendingKinds: stored.legacyKeyPendingKinds,
          }
        : {}),
    }
    try {
      await fileSystem.mkdir(path.dirname(filePath), { recursive: true })
      await fileSystem.writeFile(tempPath, JSON.stringify(serialized, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      })
      try {
        await fileSystem.copyFile(filePath, `${filePath}.bak`)
        await fileSystem.chmod(`${filePath}.bak`, 0o600)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      await fileSystem.rename(tempPath, filePath)
      await fileSystem.chmod(filePath, 0o600)
    } catch {
      try {
        await fileSystem.rm(tempPath, { force: true })
      } catch {
        // Preserve the original storage failure.
      }
      throw new AiCredentialError(
        'AI_PROVIDER_STORAGE_ERROR',
        '无法保存模型服务设置。',
      )
    }
  }

  function mutate(operation) {
    const task = writeQueue.then(operation, operation)
    writeQueue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  async function getServiceProfiles() {
    await writeQueue
    return publicServiceState(await readStoredProfiles())
  }

  function saveServiceProfile(kind, rawInput) {
    const normalizedKind = normalizeAiServiceKind(kind)
    return mutate(async () => {
      const input = normalizeServiceProfileInput(normalizedKind, rawInput)
      const stored = await readStoredProfiles()
      const profile = upsertServiceProfileInStored(stored, normalizedKind, input)
      await writeStoredProfiles(stored)
      return {
        profile: publicServiceProfile(profile),
        state: publicServiceState(stored),
      }
    })
  }

  function selectServiceProfile(kind, profileId) {
    const normalizedKind = normalizeAiServiceKind(kind)
    return mutate(async () => {
      const normalizedId =
        profileId == null || profileId === ''
          ? null
          : normalizeProfileId(profileId)
      const stored = await readStoredProfiles()
      const profiles = serviceProfileList(stored, normalizedKind)
      if (
        normalizedId &&
        !profiles.some((profile) => profile.id === normalizedId)
      ) {
        throw new AiCredentialError(
          'AI_PROVIDER_PROFILE_NOT_FOUND',
          '选择的模型服务不存在。',
        )
      }
      stored[activeProfileIdField(normalizedKind)] = normalizedId
      await writeStoredProfiles(stored)
      return publicServiceState(stored)
    })
  }

  function deleteServiceProfile(kind, profileId) {
    const normalizedKind = normalizeAiServiceKind(kind)
    return mutate(async () => {
      const normalizedId = normalizeProfileId(profileId)
      const stored = await readStoredProfiles()
      const profiles = serviceProfileList(stored, normalizedKind)
      const nextProfiles = profiles.filter(
        (profile) => profile.id !== normalizedId,
      )
      if (nextProfiles.length === profiles.length) {
        throw new AiCredentialError(
          'AI_PROVIDER_PROFILE_NOT_FOUND',
          '要删除的模型服务不存在。',
        )
      }
      if (normalizedKind === AI_SERVICE_KINDS.VISION) {
        stored.visionProfiles = nextProfiles
      } else {
        stored.embeddingProfiles = nextProfiles
      }
      const activeField = activeProfileIdField(normalizedKind)
      if (stored[activeField] === normalizedId) stored[activeField] = null
      await writeStoredProfiles(stored)
      return publicServiceState(stored)
    })
  }

  async function readActiveServicesForMainProcess() {
    await writeQueue
    const stored = await readStoredProfiles()
    const vision = stored.visionProfiles.find(
      (profile) => profile.id === stored.activeVisionProfileId,
    )
    const embedding = stored.embeddingProfiles.find(
      (profile) => profile.id === stored.activeEmbeddingProfileId,
    )
    return {
      vision: mainProcessServiceProfile(vision),
      embedding: mainProcessServiceProfile(embedding),
    }
  }

  async function resolveServiceProfileInputForMainProcess(kind, rawInput) {
    await writeQueue
    const normalizedKind = normalizeAiServiceKind(kind)
    const input = normalizeServiceProfileInput(normalizedKind, rawInput)
    const stored = await readStoredProfiles()
    const profiles = serviceProfileList(stored, normalizedKind)
    const existing = input.id
      ? profiles.find((profile) => profile.id === input.id)
      : null
    if (input.id && !existing) {
      throw new AiCredentialError(
        'AI_PROVIDER_PROFILE_NOT_FOUND',
        '要测试的模型服务不存在。',
      )
    }
    let apiKey = null
    if (!input.clearApiKey && input.apiKey) {
      apiKey = input.apiKey
    } else if (
      !input.clearApiKey &&
      existing &&
      existing.baseUrl === input.baseUrl
    ) {
      apiKey = decryptApiKey(existing.encryptedApiKey)
    } else if (
      !input.clearApiKey &&
      !existing &&
      stored.legacyEncryptedApiKey &&
      stored.legacyKeyPendingKinds.includes(normalizedKind) &&
      canUseLegacyOpenAiKey(input)
    ) {
      apiKey = decryptApiKey(stored.legacyEncryptedApiKey)
    }
    return {
      id: existing?.id ?? null,
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey,
    }
  }

  // Compatibility adapters for the v2 single-provider IPC. New integrations
  // should use the service-specific methods above. A combined profile is only
  // exposed when both capabilities still share an ID, base URL and key.
  async function getProfiles() {
    await writeQueue
    return publicCombinedState(await readStoredProfiles())
  }

  function saveProfile(rawInput) {
    return mutate(async () => {
      const input = normalizeProviderProfileInput(rawInput)
      const stored = await readStoredProfiles()
      if (input.id && !compatibleCombinedProfile(stored, input.id)) {
        throw new AiCredentialError(
          'AI_PROVIDER_PROFILE_NOT_FOUND',
          '要更新的模型服务不存在。',
        )
      }
      const sharedId = input.id ?? `provider-${crypto.randomUUID()}`
      const visionInput = {
        id: input.id,
        name: input.name,
        baseUrl: input.baseUrl,
        model: input.visionModel,
        apiKey: input.apiKey,
        clearApiKey: input.clearApiKey,
      }
      const embeddingInput = {
        id: input.id,
        name: input.name,
        baseUrl: input.baseUrl,
        model: input.embeddingModel,
        apiKey: input.apiKey,
        clearApiKey: input.clearApiKey,
      }
      const vision = upsertServiceProfileInStored(
        stored,
        AI_SERVICE_KINDS.VISION,
        visionInput,
        sharedId,
      )
      const embedding = upsertServiceProfileInStored(
        stored,
        AI_SERVICE_KINDS.EMBEDDING,
        embeddingInput,
        sharedId,
      )
      await writeStoredProfiles(stored)
      const pair = compatibleCombinedProfile(stored, vision.id)
      if (!pair || embedding.id !== vision.id) {
        throw new AiCredentialError(
          'AI_PROVIDER_STORAGE_ERROR',
          '无法兼容保存模型服务设置。',
        )
      }
      return {
        profile: publicCombinedProfile(pair),
        state: publicCombinedState(stored),
      }
    })
  }

  function selectProfile(profileId) {
    return mutate(async () => {
      const normalizedId =
        profileId == null || profileId === ''
          ? null
          : normalizeProfileId(profileId)
      const stored = await readStoredProfiles()
      if (normalizedId && !compatibleCombinedProfile(stored, normalizedId)) {
        throw new AiCredentialError(
          'AI_PROVIDER_PROFILE_NOT_FOUND',
          '选择的模型服务不存在。',
        )
      }
      stored.activeVisionProfileId = normalizedId
      stored.activeEmbeddingProfileId = normalizedId
      await writeStoredProfiles(stored)
      return publicCombinedState(stored)
    })
  }

  function deleteProfile(profileId) {
    return mutate(async () => {
      const normalizedId = normalizeProfileId(profileId)
      const stored = await readStoredProfiles()
      const hadVision = stored.visionProfiles.some(
        (profile) => profile.id === normalizedId,
      )
      const hadEmbedding = stored.embeddingProfiles.some(
        (profile) => profile.id === normalizedId,
      )
      if (!hadVision && !hadEmbedding) {
        throw new AiCredentialError(
          'AI_PROVIDER_PROFILE_NOT_FOUND',
          '要删除的模型服务不存在。',
        )
      }
      stored.visionProfiles = stored.visionProfiles.filter(
        (profile) => profile.id !== normalizedId,
      )
      stored.embeddingProfiles = stored.embeddingProfiles.filter(
        (profile) => profile.id !== normalizedId,
      )
      if (stored.activeVisionProfileId === normalizedId) {
        stored.activeVisionProfileId = null
      }
      if (stored.activeEmbeddingProfileId === normalizedId) {
        stored.activeEmbeddingProfileId = null
      }
      await writeStoredProfiles(stored)
      return publicCombinedState(stored)
    })
  }

  async function readActiveProfileForMainProcess() {
    await writeQueue
    const stored = await readStoredProfiles()
    if (
      !stored.activeVisionProfileId ||
      stored.activeVisionProfileId !== stored.activeEmbeddingProfileId
    ) {
      return null
    }
    const pair = compatibleCombinedProfile(stored, stored.activeVisionProfileId)
    if (!pair) return null
    return {
      id: pair.vision.id,
      name: pair.vision.name,
      baseUrl: pair.vision.baseUrl,
      visionModel: pair.vision.model,
      embeddingModel: pair.embedding.model,
      apiKey: pair.apiKey,
    }
  }

  async function resolveProfileInputForMainProcess(rawInput) {
    await writeQueue
    const input = normalizeProviderProfileInput(rawInput)
    const stored = await readStoredProfiles()
    const pair = input.id ? compatibleCombinedProfile(stored, input.id) : null
    if (input.id && !pair) {
      throw new AiCredentialError(
        'AI_PROVIDER_PROFILE_NOT_FOUND',
        '要测试的模型服务不存在。',
      )
    }
    let apiKey = null
    if (!input.clearApiKey && input.apiKey) {
      apiKey = input.apiKey
    } else if (
      !input.clearApiKey &&
      pair &&
      pair.vision.baseUrl === input.baseUrl
    ) {
      apiKey = pair.apiKey
    } else if (
      !input.clearApiKey &&
      !pair &&
      stored.legacyEncryptedApiKey &&
      stored.legacyKeyPendingKinds.includes(AI_SERVICE_KINDS.VISION) &&
      stored.legacyKeyPendingKinds.includes(AI_SERVICE_KINDS.EMBEDDING) &&
      canUseLegacyOpenAiKey(input)
    ) {
      apiKey = decryptApiKey(stored.legacyEncryptedApiKey)
    }
    return {
      id: pair?.vision.id ?? null,
      name: input.name,
      baseUrl: input.baseUrl,
      visionModel: input.visionModel,
      embeddingModel: input.embeddingModel,
      apiKey,
    }
  }

  return {
    getServiceProfiles,
    saveServiceProfile,
    selectServiceProfile,
    deleteServiceProfile,
    getProfiles,
    saveProfile,
    selectProfile,
    deleteProfile,
    // These methods intentionally remain main-process-only. Never expose their
    // return values directly through preload or IPC because they may contain a key.
    readActiveServicesForMainProcess,
    resolveServiceProfileInputForMainProcess,
    readActiveProfileForMainProcess,
    resolveProfileInputForMainProcess,
  }
}

module.exports = {
  AI_CREDENTIAL_PROVIDER,
  AI_CREDENTIAL_VERSION,
  AI_SERVICE_KINDS,
  AiCredentialError,
  createAiCredentialsStore,
  isLoopbackHostname,
  normalizeAiServiceKind,
  normalizeAiCredentialError,
  normalizeProviderBaseUrl,
  normalizeProviderProfileInput,
  normalizeServiceProfileInput,
}
