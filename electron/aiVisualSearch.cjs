const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const AI_VISUAL_SEARCH_CACHE_VERSION = 2
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000
const MAX_QUERY_LENGTH = 600
const MAX_CANDIDATE_COUNT = 2_000
const MAX_RESULT_COUNT = 100
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VISION_BATCH_BYTES = 24 * 1024 * 1024
const MAX_CONTACT_SHEET_BYTES = 10 * 1024 * 1024
const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_CACHE_ENTRIES = 20_000
const MAX_CACHE_ESTIMATED_BYTES = 160 * 1024 * 1024
const MAX_EMBEDDING_DIMENSIONS = 8_192
const MAX_VISION_REQUESTS_PER_BATCH = 32
const MIN_VISION_BATCH_DEADLINE_MS = 60_000
const MAX_VISION_BATCH_DEADLINE_MS = 240_000
const VISION_BATCH_SIZE = 12
const EMBEDDING_BATCH_SIZE = 96
const NEARBY_FRAME_WINDOW_SECONDS = 3
const ALLOWED_IMAGE_EXTENSIONS = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])

class AiVisualSearchError extends Error {
  constructor(code, message, { status = null, retryable = false, cause } = {}) {
    super(message)
    this.name = 'AiVisualSearchError'
    this.code = code
    this.status = status
    this.retryable = retryable
    if (cause) this.cause = cause
  }
}

function normalizeAiVisualSearchError(error) {
  if (error instanceof AiVisualSearchError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.retryable,
    }
  }

  return {
    code: 'AI_SEARCH_UNKNOWN',
    message: 'AI 搜索暂时不可用，请稍后重试。',
    status: null,
    retryable: false,
  }
}

function boundedString(value, label, maxLength = 512) {
  if (typeof value !== 'string') {
    throw new AiVisualSearchError(
      'AI_SEARCH_INVALID_INPUT',
      `${label}无效。`,
    )
  }
  const normalized = value.trim()
  if (normalized === '' || normalized.length > maxLength || normalized.includes('\0')) {
    throw new AiVisualSearchError(
      'AI_SEARCH_INVALID_INPUT',
      `${label}无效。`,
    )
  }
  return normalized
}

function optionalBoundedString(value, maxLength = 2_000) {
  if (value == null) return ''
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function normalizeStringList(value, maxItems = 32, maxLength = 120) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
}

function finiteNonNegativeNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new AiVisualSearchError(
      'AI_SEARCH_INVALID_INPUT',
      `${label}无效。`,
    )
  }
  return number
}

function normalizeSearchRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new AiVisualSearchError(
      'AI_SEARCH_INVALID_INPUT',
      'AI 搜索请求无效。',
    )
  }

  const query = boundedString(request.query, '搜索内容', MAX_QUERY_LENGTH)
  if (!Array.isArray(request.candidates)) {
    throw new AiVisualSearchError(
      'AI_SEARCH_INVALID_INPUT',
      '没有可搜索的关键帧。',
    )
  }
  if (request.candidates.length > MAX_CANDIDATE_COUNT) {
    throw new AiVisualSearchError(
      'AI_SEARCH_REQUEST_TOO_LARGE',
      '可搜索的关键帧过多，请缩小搜索范围后重试。',
    )
  }

  const requestedLimit = request.limit == null ? 24 : Number(request.limit)
  if (
    !Number.isInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > MAX_RESULT_COUNT
  ) {
    throw new AiVisualSearchError(
      'AI_SEARCH_INVALID_INPUT',
      '搜索结果数量无效。',
    )
  }

  const seenResultIds = new Set()
  const candidates = request.candidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new AiVisualSearchError(
        'AI_SEARCH_INVALID_INPUT',
        '关键帧信息无效。',
      )
    }

    const normalized = {
      resultId: boundedString(candidate.resultId, '搜索结果 ID'),
      assetId: boundedString(candidate.assetId, '素材 ID'),
      clipId: optionalBoundedString(candidate.clipId, 512),
      projectId: optionalBoundedString(candidate.projectId, 512),
      frameId: boundedString(candidate.frameId, '关键帧 ID'),
      sourceFingerprint: boundedString(
        candidate.sourceFingerprint,
        '素材指纹',
        1_024,
      ),
      imagePath: boundedString(candidate.imagePath, '关键帧路径', 8_192),
      timeSeconds: finiteNonNegativeNumber(candidate.timeSeconds, '关键帧时间'),
      filename: optionalBoundedString(candidate.filename, 512),
      projectTitle: optionalBoundedString(candidate.projectTitle, 512),
      tags: normalizeStringList(candidate.tags),
      note: optionalBoundedString(candidate.note),
    }

    if (seenResultIds.has(normalized.resultId)) {
      throw new AiVisualSearchError(
        'AI_SEARCH_INVALID_INPUT',
        '搜索结果包含重复关键帧。',
      )
    }
    seenResultIds.add(normalized.resultId)
    return normalized
  })

  return {
    query,
    candidates,
    limit: requestedLimit,
    profileId:
      request.profileId == null
        ? null
        : boundedString(request.profileId, '模型服务 ID', 128),
    visionProfileId:
      request.visionProfileId == null && request.visionServiceId == null
        ? null
        : boundedString(
            request.visionProfileId ?? request.visionServiceId,
            '画面理解服务 ID',
            128,
          ),
    embeddingProfileId:
      request.embeddingProfileId == null && request.embeddingServiceId == null
        ? null
        : boundedString(
            request.embeddingProfileId ?? request.embeddingServiceId,
            '语义检索服务 ID',
            128,
          ),
  }
}

function isPathInside(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

async function validateManagedFramePath({
  imagePath,
  mediaRoot,
  fileSystem,
}) {
  if (!path.isAbsolute(imagePath)) {
    throw new AiVisualSearchError(
      'AI_SEARCH_FILE_NOT_ALLOWED',
      '关键帧不在 Aurora 管理的媒体目录中。',
    )
  }

  const resolvedPath = path.resolve(imagePath)
  if (!isPathInside(mediaRoot, resolvedPath)) {
    throw new AiVisualSearchError(
      'AI_SEARCH_FILE_NOT_ALLOWED',
      '关键帧不在 Aurora 管理的媒体目录中。',
    )
  }

  const extension = path.extname(resolvedPath).toLowerCase()
  const mimeType = ALLOWED_IMAGE_EXTENSIONS.get(extension)
  if (!mimeType) {
    throw new AiVisualSearchError(
      'AI_SEARCH_UNSUPPORTED_IMAGE',
      '关键帧图片格式不受支持。',
    )
  }

  let realMediaRoot
  let realImagePath
  let stat
  try {
    realMediaRoot = await fileSystem.realpath(mediaRoot)
    realImagePath = await fileSystem.realpath(resolvedPath)
    if (!isPathInside(realMediaRoot, realImagePath)) {
      throw new AiVisualSearchError(
        'AI_SEARCH_FILE_NOT_ALLOWED',
        '关键帧不在 Aurora 管理的媒体目录中。',
      )
    }
    stat = await fileSystem.stat(realImagePath)
  } catch (error) {
    if (error instanceof AiVisualSearchError) throw error
    throw new AiVisualSearchError(
      'AI_SEARCH_FILE_UNAVAILABLE',
      '关键帧文件不可用，请重新建立视觉索引。',
    )
  }

  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) {
    throw new AiVisualSearchError(
      'AI_SEARCH_FILE_UNAVAILABLE',
      '关键帧文件不可用，请重新建立视觉索引。',
    )
  }

  return {
    imagePath: realImagePath,
    mimeType,
  }
}

function providerCacheFingerprint(profile) {
  return crypto
    .createHash('sha256')
    .update(profile.id || 'unpersisted-provider')
    .update('\0')
    .update(profile.baseUrl)
    .update('\0')
    .update(profile.visionModel)
    .update('\0')
    .update(profile.embeddingModel)
    .digest('hex')
}

function normalizeResolvedServiceProfile(service, kind) {
  if (!service || typeof service !== 'object') return null
  const model = service.model ?? (
    kind === 'vision' ? service.visionModel : service.embeddingModel
  )
  return {
    id:
      service.id == null || service.id === ''
        ? null
        : boundedString(service.id, '模型服务 ID', 128),
    name: optionalBoundedString(service.name, 120),
    baseUrl: boundedString(service.baseUrl, 'API 地址', 2_048),
    model: boundedString(
      model,
      kind === 'vision' ? '画面理解模型' : '语义检索模型',
      512,
    ),
    apiKey:
      typeof service.apiKey === 'string' && service.apiKey !== ''
        ? service.apiKey
        : null,
  }
}

function servicesFromLegacyProfile(profile) {
  if (!profile) return { vision: null, embedding: null }
  return {
    vision: normalizeResolvedServiceProfile(profile, 'vision'),
    embedding: normalizeResolvedServiceProfile(profile, 'embedding'),
  }
}

function visionServiceFingerprint(service) {
  const normalized = normalizeResolvedServiceProfile(service, 'vision')
  if (!normalized) {
    throw new AiVisualSearchError(
      'AI_SEARCH_VISION_PROFILE_NOT_CONFIGURED',
      '请先配置画面理解服务。',
    )
  }
  return crypto
    .createHash('sha256')
    .update('aurora-vision-description-v2')
    .update('\0')
    .update(normalized.id || 'unpersisted-vision-provider')
    .update('\0')
    .update(normalized.baseUrl)
    .update('\0')
    .update(normalized.model)
    .digest('hex')
}

function embeddingServiceFingerprint(service, descriptionFingerprint) {
  const normalized = normalizeResolvedServiceProfile(service, 'embedding')
  if (!normalized) {
    throw new AiVisualSearchError(
      'AI_SEARCH_EMBEDDING_PROFILE_NOT_CONFIGURED',
      '请先配置语义检索服务。',
    )
  }
  return crypto
    .createHash('sha256')
    .update('aurora-frame-embedding-v1')
    .update('\0')
    .update(descriptionFingerprint)
    .update('\0')
    .update(normalized.id || 'unpersisted-embedding-provider')
    .update('\0')
    .update(normalized.baseUrl)
    .update('\0')
    .update(normalized.model)
    .digest('hex')
}

function frameCacheKey(candidate, providerFingerprint) {
  return crypto
    .createHash('sha256')
    .update(providerFingerprint)
    .update('\0')
    .update(candidate.assetId)
    .update('\0')
    .update(candidate.sourceFingerprint)
    .update('\0')
    .update(candidate.frameId)
    .digest('hex')
}

function createEmptyCache() {
  return {
    version: AI_VISUAL_SEARCH_CACHE_VERSION,
    entries: {},
  }
}

function normalizeDescription(value, maxLength = 2_000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeEmbedding(value, expectedDimensions = null) {
  if (!Array.isArray(value)) return null
  if (
    value.length < 1 ||
    value.length > MAX_EMBEDDING_DIMENSIONS ||
    (expectedDimensions != null && value.length !== expectedDimensions)
  ) return null
  const normalized = value.map(Number)
  return normalized.every(Number.isFinite) ? normalized : null
}

function decodeEmbeddingBase64(value, expectedDimensions) {
  if (typeof value !== 'string' || value === '') return null
  let bytes
  try {
    bytes = Buffer.from(value, 'base64')
  } catch {
    return null
  }
  if (bytes.byteLength !== expectedDimensions * Float32Array.BYTES_PER_ELEMENT) {
    return null
  }
  const embedding = Array.from(
    { length: expectedDimensions },
    (_, index) => bytes.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT),
  )
  return embedding.every(Number.isFinite) ? embedding : null
}

function encodeEmbeddingBase64(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) return null
  const bytes = Buffer.allocUnsafe(
    embedding.length * Float32Array.BYTES_PER_ELEMENT,
  )
  for (let index = 0; index < embedding.length; index += 1) {
    bytes.writeFloatLE(embedding[index], index * Float32Array.BYTES_PER_ELEMENT)
  }
  return bytes.toString('base64')
}

function normalizeCacheEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const assetId = normalizeDescription(entry.assetId, 512)
  const sourceFingerprint = normalizeDescription(entry.sourceFingerprint, 1_024)
  const frameId = normalizeDescription(entry.frameId, 512)
  const providerFingerprint = normalizeDescription(entry.providerFingerprint, 64)
  const descriptionFingerprint = normalizeDescription(
    entry.descriptionFingerprint,
    64,
  )
  const embeddingFingerprint = normalizeDescription(
    entry.embeddingFingerprint,
    64,
  )
  const descriptionZh = normalizeDescription(entry.descriptionZh)
  const descriptionEn = normalizeDescription(entry.descriptionEn)
  const embeddingDimensions = Number(entry.embeddingDimensions)
  const validProviderFingerprint = /^[a-f0-9]{64}$/.test(providerFingerprint)
  const validDescriptionFingerprint = /^[a-f0-9]{64}$/.test(
    descriptionFingerprint,
  )
  if (
    assetId === '' ||
    sourceFingerprint === '' ||
    frameId === '' ||
    (!validProviderFingerprint && !validDescriptionFingerprint) ||
    (descriptionZh === '' && descriptionEn === '')
  ) {
    return null
  }

  const normalizedDimensions =
    Number.isInteger(embeddingDimensions) &&
    embeddingDimensions > 0 &&
    embeddingDimensions <= MAX_EMBEDDING_DIMENSIONS
      ? embeddingDimensions
      : null

  return {
    assetId,
    sourceFingerprint,
    frameId,
    providerFingerprint: validProviderFingerprint ? providerFingerprint : null,
    descriptionFingerprint: validDescriptionFingerprint
      ? descriptionFingerprint
      : null,
    embeddingFingerprint: /^[a-f0-9]{64}$/.test(embeddingFingerprint)
      ? embeddingFingerprint
      : null,
    descriptionZh,
    descriptionEn,
    keywordsZh: normalizeStringList(entry.keywordsZh, 24, 120),
    keywordsEn: normalizeStringList(entry.keywordsEn, 24, 120),
    embedding:
      normalizedDimensions == null
        ? null
        : decodeEmbeddingBase64(
            entry.embeddingBase64,
            normalizedDimensions,
          ) ?? normalizeEmbedding(entry.embedding, normalizedDimensions),
    embeddingDimensions: normalizedDimensions,
    updatedAt:
      typeof entry.updatedAt === 'string' && entry.updatedAt !== ''
        ? entry.updatedAt
        : new Date(0).toISOString(),
  }
}

async function readCache(cachePath, fileSystem) {
  try {
    const text = await fileSystem.readFile(cachePath, 'utf8')
    const parsed = JSON.parse(text)
    if (
      !parsed ||
      parsed.version !== AI_VISUAL_SEARCH_CACHE_VERSION ||
      !parsed.entries ||
      typeof parsed.entries !== 'object' ||
      Array.isArray(parsed.entries)
    ) {
      return createEmptyCache()
    }

    const cache = createEmptyCache()
    for (const [key, value] of Object.entries(parsed.entries)) {
      if (!/^[a-f0-9]{64}$/.test(key)) continue
      const normalized = normalizeCacheEntry(value)
      if (normalized) cache.entries[key] = normalized
    }
    return cache
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      return createEmptyCache()
    }
    throw new AiVisualSearchError(
      'AI_SEARCH_STORAGE_ERROR',
      '无法读取 AI 视觉索引。',
    )
  }
}

function pruneCacheEntries(cache) {
  const entries = Object.entries(cache.entries)
  entries.sort((left, right) =>
    String(right[1].updatedAt).localeCompare(String(left[1].updatedAt)),
  )
  let estimatedBytes = 0
  const retained = []
  for (const entry of entries) {
    if (retained.length >= MAX_CACHE_ENTRIES) break
    const embeddingBytes = Array.isArray(entry[1].embedding)
      ? Math.ceil(entry[1].embedding.length * 16 / 3)
      : 0
    const metadataBytes = Buffer.byteLength(
      `${entry[0]}${entry[1].descriptionZh}${entry[1].descriptionEn}${entry[1].keywordsZh.join(',')}${entry[1].keywordsEn.join(',')}`,
      'utf8',
    ) + 512
    const entryBytes = embeddingBytes + metadataBytes
    if (
      retained.length > 0 &&
      estimatedBytes + entryBytes > MAX_CACHE_ESTIMATED_BYTES
    ) break
    retained.push(entry)
    estimatedBytes += entryBytes
  }
  if (retained.length !== entries.length) {
    cache.entries = Object.fromEntries(retained)
  }
}

function serializeCache(cache) {
  const entries = {}
  for (const [key, entry] of Object.entries(cache.entries)) {
    const { embedding, ...metadata } = entry
    entries[key] = {
      ...metadata,
      embeddingBase64: encodeEmbeddingBase64(embedding),
    }
  }
  return JSON.stringify({ version: AI_VISUAL_SEARCH_CACHE_VERSION, entries })
}

async function writeCacheAtomically(cachePath, cache, fileSystem) {
  pruneCacheEntries(cache)
  const tempPath = `${cachePath}.tmp-${process.pid}-${crypto.randomUUID()}`
  try {
    await fileSystem.mkdir(path.dirname(cachePath), { recursive: true })
    await fileSystem.writeFile(tempPath, serializeCache(cache), {
      encoding: 'utf8',
      mode: 0o600,
    })
    await fileSystem.rename(tempPath, cachePath)
    await fileSystem.chmod(cachePath, 0o600)
  } catch {
    try {
      await fileSystem.rm(tempPath, { force: true })
    } catch {
      // Preserve the original persistence error.
    }
    throw new AiVisualSearchError(
      'AI_SEARCH_STORAGE_ERROR',
      '无法保存 AI 视觉索引。',
    )
  }
}

function providerHttpError(status) {
  if (status === 401 || status === 403) {
    return new AiVisualSearchError(
      'AI_SEARCH_AUTH_FAILED',
      '模型服务拒绝了访问，请检查 API Key 和模型权限。',
      { status, retryable: false },
    )
  }
  if (status === 429) {
    return new AiVisualSearchError(
      'AI_SEARCH_RATE_LIMITED',
      'AI 搜索请求过于频繁或额度不足，请稍后重试。',
      { status, retryable: true },
    )
  }
  if (status === 408) {
    return new AiVisualSearchError(
      'AI_SEARCH_TIMEOUT',
      'AI 搜索请求超时，请稍后重试。',
      { status, retryable: true },
    )
  }
  if (status >= 500) {
    return new AiVisualSearchError(
      'AI_SEARCH_PROVIDER_ERROR',
      'AI 搜索服务暂时不可用，请稍后重试。',
      { status, retryable: true },
    )
  }
  return new AiVisualSearchError(
    'AI_SEARCH_PROVIDER_ERROR',
    'AI 搜索请求未被服务接受，请检查设置后重试。',
    { status, retryable: false },
  )
}

async function readProviderJson(response) {
  let text
  try {
    const declaredLength = Number(response.headers?.get?.('content-length'))
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_PROVIDER_RESPONSE_BYTES
    ) {
      throw new AiVisualSearchError(
        'AI_SEARCH_BAD_RESPONSE',
        'AI 搜索服务返回的数据过大。',
        { status: response.status ?? null },
      )
    }
    const reader = response.body?.getReader?.()
    if (reader) {
      const chunks = []
      let totalBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        totalBytes += chunk.byteLength
        if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new AiVisualSearchError(
            'AI_SEARCH_BAD_RESPONSE',
            'AI 搜索服务返回的数据过大。',
            { status: response.status ?? null },
          )
        }
        chunks.push(chunk)
      }
      text = Buffer.concat(chunks, totalBytes).toString('utf8')
    } else {
      text = await response.text()
    }
  } catch (error) {
    if (error instanceof AiVisualSearchError) throw error
    throw new AiVisualSearchError(
      'AI_SEARCH_BAD_RESPONSE',
      'AI 搜索服务返回了无法读取的数据。',
      { status: response.status ?? null },
    )
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new AiVisualSearchError(
      'AI_SEARCH_BAD_RESPONSE',
      'AI 搜索服务返回的数据过大。',
      { status: response.status ?? null },
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new AiVisualSearchError(
      'AI_SEARCH_BAD_RESPONSE',
      'AI 搜索服务返回了无效数据。',
      { status: response.status ?? null },
    )
  }
}

function providerEndpoint(baseUrl, suffix) {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

async function postProviderJson({
  fetchImpl,
  url,
  apiKey,
  body,
  timeoutMs,
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (typeof apiKey === 'string' && apiKey !== '') {
      headers.Authorization = `Bearer ${apiKey}`
    }
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    })
    if (!response || typeof response.ok !== 'boolean') {
      throw new AiVisualSearchError(
        'AI_SEARCH_BAD_RESPONSE',
        'AI 搜索服务返回了无效响应。',
      )
    }
    if (!response.ok) throw providerHttpError(Number(response.status) || 500)
    return await readProviderJson(response)
  } catch (error) {
    if (error instanceof AiVisualSearchError) throw error
    if (error?.name === 'AbortError') {
      throw new AiVisualSearchError(
        'AI_SEARCH_TIMEOUT',
        'AI 搜索请求超时，请稍后重试。',
        { retryable: true },
      )
    }
    throw new AiVisualSearchError(
      'AI_SEARCH_NETWORK_ERROR',
      '无法连接 AI 搜索服务，请检查网络后重试。',
      { retryable: true },
    )
  } finally {
    clearTimeout(timeout)
  }
}

function extractChatCompletionText(response) {
  const content = response?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (typeof item?.text === 'string') return item.text
      return ''
    })
    .join('')
    .trim()
}

function parseLooseJson(text) {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(normalized)
  } catch {
    const start = normalized.indexOf('{')
    const end = normalized.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(normalized.slice(start, end + 1))
      } catch {
        // Fall through to the public, provider-neutral error below.
      }
    }
    throw new AiVisualSearchError(
      'AI_SEARCH_BAD_RESPONSE',
      'AI 无法完成关键帧理解，请稍后重试。',
    )
  }
}

function parseVisionDescriptions(response, expectedCount) {
  const parsed = parseLooseJson(extractChatCompletionText(response))

  if (!Array.isArray(parsed?.frames) || parsed.frames.length !== expectedCount) {
    throw new AiVisualSearchError(
      'AI_SEARCH_BAD_RESPONSE',
      'AI 返回的关键帧描述不完整，请稍后重试。',
    )
  }

  const bySlot = new Map()
  for (const frame of parsed.frames) {
    const slot = Number(frame?.slot)
    const descriptionZh = normalizeDescription(frame?.descriptionZh)
    const descriptionEn = normalizeDescription(frame?.descriptionEn)
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= expectedCount ||
      bySlot.has(slot) ||
      (descriptionZh === '' && descriptionEn === '')
    ) {
      throw new AiVisualSearchError(
        'AI_SEARCH_BAD_RESPONSE',
        'AI 返回的关键帧描述无效，请稍后重试。',
      )
    }
    bySlot.set(slot, {
      descriptionZh,
      descriptionEn,
      keywordsZh: normalizeStringList(frame?.keywordsZh, 24, 120),
      keywordsEn: normalizeStringList(frame?.keywordsEn, 24, 120),
    })
  }

  return Array.from({ length: expectedCount }, (_, slot) => bySlot.get(slot))
}

function isLikelyLocalModelService(service) {
  let parsed
  try {
    parsed = new URL(service.baseUrl)
  } catch {
    return false
  }
  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return true
  }
  return false
}

function isVisionRequestCompatibilityError(error) {
  return (
    error instanceof AiVisualSearchError &&
    error.code === 'AI_SEARCH_PROVIDER_ERROR' &&
    [400, 404, 415, 422].includes(error.status)
  )
}

function shouldSplitVisionBatch(error) {
  return (
    error instanceof AiVisualSearchError &&
    (error.code === 'AI_SEARCH_BAD_RESPONSE' ||
      error.code === 'AI_SEARCH_REQUEST_TOO_LARGE')
  )
}

async function loadVisionBatchImages({ batch, fileSystem }) {
  const loaded = []
  let batchImageBytes = 0
  for (let slot = 0; slot < batch.length; slot += 1) {
    const item = batch[slot]
    let imageBytes
    if (Buffer.isBuffer(item.imageBytes)) {
      imageBytes = item.imageBytes
    } else {
      try {
        imageBytes = await fileSystem.readFile(item.imagePath)
      } catch {
        throw new AiVisualSearchError(
          'AI_SEARCH_FILE_UNAVAILABLE',
          '关键帧文件不可用，请重新建立视觉索引。',
        )
      }
    }
    if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
      throw new AiVisualSearchError(
        'AI_SEARCH_FILE_UNAVAILABLE',
        '关键帧图片过大，请重新建立视觉索引。',
      )
    }
    batchImageBytes += imageBytes.byteLength
    if (batchImageBytes > MAX_VISION_BATCH_BYTES) {
      throw new AiVisualSearchError(
        'AI_SEARCH_REQUEST_TOO_LARGE',
        '本批关键帧图片过大，请缩小搜索范围后重试。',
      )
    }
    loaded.push({
      imageBytes,
      mimeType: item.mimeType,
      slot,
    })
  }
  return loaded
}

function directVisionContent(loadedBatch) {
  const content = []
  for (const item of loadedBatch) {
    content.push({ type: 'text', text: `关键帧 slot ${item.slot}` })
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${item.mimeType};base64,${item.imageBytes.toString('base64')}`,
        detail: 'low',
      },
    })
  }
  return {
    content,
    contactSheet: null,
  }
}

async function visionImageContent({
  loadedBatch,
  contactSheetComposer,
  preferContactSheet,
}) {
  if (
    !preferContactSheet ||
    loadedBatch.length < 2 ||
    typeof contactSheetComposer?.compose !== 'function'
  ) {
    return directVisionContent(loadedBatch)
  }

  try {
    const contactSheet = await contactSheetComposer.compose({
      frames: loadedBatch,
    })
    if (
      !contactSheet ||
      !Buffer.isBuffer(contactSheet.imageBytes) ||
      contactSheet.imageBytes.byteLength < 1 ||
      contactSheet.imageBytes.byteLength > MAX_CONTACT_SHEET_BYTES ||
      !['image/png', 'image/jpeg'].includes(contactSheet.mimeType) ||
      !Number.isInteger(contactSheet.columns) ||
      contactSheet.columns < 1 ||
      !Number.isInteger(contactSheet.rows) ||
      contactSheet.rows < 1
    ) {
      return directVisionContent(loadedBatch)
    }
    return {
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${contactSheet.mimeType};base64,${contactSheet.imageBytes.toString('base64')}`,
            detail: 'high',
          },
        },
      ],
      contactSheet,
    }
  } catch {
    // The contact sheet is only an optimization. Keep the validated source frames
    // as a provider-compatible fallback if the platform image codec cannot compose.
    return directVisionContent(loadedBatch)
  }
}

function visionResponseSchema(expectedCount) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      frames: {
        type: 'array',
        minItems: expectedCount,
        maxItems: expectedCount,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slot: {
              type: 'integer',
              minimum: 0,
              maximum: expectedCount - 1,
            },
            descriptionZh: { type: 'string' },
            descriptionEn: { type: 'string' },
            keywordsZh: { type: 'array', items: { type: 'string' } },
            keywordsEn: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'slot',
            'descriptionZh',
            'descriptionEn',
            'keywordsZh',
            'keywordsEn',
          ],
        },
      },
    },
    required: ['frames'],
  }
}

async function describeFrameBatchOnce({
  batch,
  service,
  fetchImpl,
  fileSystem,
  timeoutMs,
  connectionTest = false,
  contactSheetComposer = null,
  requestContext,
}) {
  const loadedBatch = await loadVisionBatchImages({ batch, fileSystem })
  const localService = isLikelyLocalModelService(service)
  const imageContent = await visionImageContent({
    loadedBatch,
    contactSheetComposer,
    preferContactSheet: localService,
  })
  const exactSlots = `必须准确返回 ${batch.length} 项，slot 从 0 到 ${batch.length - 1}，每个 slot 恰好一次，不得遗漏、重复或合并。`
  const layoutInstruction = imageContent.contactSheet
    ? `下面是一张包含 ${batch.length} 个关键帧的联系表，共 ${imageContent.contactSheet.columns} 列、${imageContent.contactSheet.rows} 行，按从左到右、从上到下排列；每格左上角白色数字就是 slot。`
    : '下面会按编号逐张提供关键帧，slot 就是图片前的编号。'
  const content = [
    {
      type: 'text',
      text:
        `${connectionTest ? '这是连接测试，必须实际读取全部画面并按正式索引格式作答。' : ''}你是影视素材的视觉检索索引器。${layoutInstruction}${exactSlots}逐格分析，只描述画面中实际可见的主体、人物动作、场景、环境、构图、镜头景别、光线、色彩、天气、时间氛围和可辨识物体；不要猜测人物身份或故事。为每格输出简洁的中文与英文描述，以及便于视觉语义搜索的中英文关键词。只返回 JSON，不要 Markdown。格式为 {"frames":[{"slot":0,"descriptionZh":"","descriptionEn":"","keywordsZh":[],"keywordsEn":[]}]}。`,
    },
    ...imageContent.content,
  ]
  const schema = visionResponseSchema(batch.length)
  const baseBody = {
    model: service.model,
    temperature: 0.1,
    max_tokens: Math.min(6_000, Math.max(1_000, batch.length * 360)),
    messages: [{ role: 'user', content }],
  }
  const request = (body) => {
    const remainingMs = requestContext.deadlineAt - Date.now()
    if (
      requestContext.requestCount >= MAX_VISION_REQUESTS_PER_BATCH ||
      remainingMs <= 0
    ) {
      throw new AiVisualSearchError(
        'AI_SEARCH_RETRY_EXHAUSTED',
        '画面理解模型多次返回不完整结果，请尝试更换模型或减少素材范围。',
      )
    }
    requestContext.requestCount += 1
    return postProviderJson({
      fetchImpl,
      url: providerEndpoint(service.baseUrl, 'chat/completions'),
      apiKey: service.apiKey,
      timeoutMs: Math.max(1, Math.min(timeoutMs, remainingMs)),
      body,
    })
  }

  const baseVariants = localService
    ? [
        { structured: true, reasoning: true },
        { structured: true, reasoning: false },
        { structured: false, reasoning: true },
        { structured: false, reasoning: false },
      ]
    : [
        { structured: true, reasoning: false },
        { structured: false, reasoning: false },
      ]
  const preferredVariant = requestContext.preferredVariant
  const variants = preferredVariant
    ? [
        preferredVariant,
        ...baseVariants.filter((variant) =>
          variant.structured !== preferredVariant.structured ||
          variant.reasoning !== preferredVariant.reasoning,
        ),
      ]
    : baseVariants
  let lastError = null
  let skipStructured = false
  for (const variant of variants) {
    if (skipStructured && variant.structured) continue
    const body = { ...baseBody }
    if (variant.reasoning) body.reasoning_effort = 'none'
    if (variant.structured) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'aurora_frame_descriptions',
          strict: true,
          schema,
        },
      }
    }
    try {
      const response = await request(body)
      requestContext.preferredVariant = variant
      return parseVisionDescriptions(response, batch.length)
    } catch (error) {
      lastError = error
      if (
        error instanceof AiVisualSearchError &&
        error.code === 'AI_SEARCH_BAD_RESPONSE'
      ) {
        if (variant.structured) {
          skipStructured = true
          continue
        }
        break
      }
      if (!isVisionRequestCompatibilityError(error)) throw error
      if (variant.structured && !variant.reasoning) {
        skipStructured = true
      }
    }
  }
  throw lastError
}

async function describeFrameBatch(options) {
  const requestContext = options.requestContext ?? {
    requestCount: 0,
    deadlineAt:
      Date.now() +
      Math.max(
        MIN_VISION_BATCH_DEADLINE_MS,
        Math.min(
          MAX_VISION_BATCH_DEADLINE_MS,
          options.timeoutMs * 4,
        ),
      ),
    preferredVariant: null,
  }
  const scopedOptions = {
    ...options,
    requestContext,
  }
  try {
    return await describeFrameBatchOnce(scopedOptions)
  } catch (error) {
    if (options.batch.length < 2 || !shouldSplitVisionBatch(error)) {
      throw error
    }
    const descriptions = []
    for (const item of options.batch) {
      descriptions.push(
        ...(await describeFrameBatch({
          ...scopedOptions,
          batch: [item],
        })),
      )
    }
    return descriptions
  }
}

function entryEmbeddingText(entry) {
  return [
    `中文画面描述：${entry.descriptionZh}`,
    `English visual description: ${entry.descriptionEn}`,
    `中文视觉关键词：${entry.keywordsZh.join('、')}`,
    `English visual keywords: ${entry.keywordsEn.join(', ')}`,
  ].join('\n')
}

async function createEmbeddings({
  input,
  service,
  fetchImpl,
  timeoutMs,
}) {
  const response = await postProviderJson({
    fetchImpl,
    url: providerEndpoint(service.baseUrl, 'embeddings'),
    apiKey: service.apiKey,
    timeoutMs,
    body: {
      model: service.model,
      input,
    },
  })

  if (!Array.isArray(response?.data) || response.data.length !== input.length) {
    throw new AiVisualSearchError(
      'AI_SEARCH_BAD_RESPONSE',
      'AI 无法建立语义索引，请稍后重试。',
    )
  }

  const byIndex = new Map()
  let dimensions = null
  for (const item of response.data) {
    const index = Number(item?.index)
    const embedding = normalizeEmbedding(item?.embedding)
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= input.length ||
      byIndex.has(index) ||
      embedding == null
    ) {
      throw new AiVisualSearchError(
        'AI_SEARCH_BAD_RESPONSE',
        'AI 返回的语义索引无效，请稍后重试。',
      )
    }
    if (dimensions == null) dimensions = embedding.length
    if (embedding.length !== dimensions) {
      throw new AiVisualSearchError(
        'AI_SEARCH_BAD_RESPONSE',
        'Embedding 模型返回了维数不一致的向量。',
      )
    }
    byIndex.set(index, embedding)
  }

  return {
    embeddings: Array.from(
      { length: input.length },
      (_, index) => byIndex.get(index),
    ),
    dimensions,
  }
}

function cosineSimilarity(left, right) {
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] * left[index]
    rightMagnitude += right[index] * right[index]
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return -1
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

const CONNECTION_TEST_IMAGE_DATA_URLS = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAA7UlEQVR4Ae3BsWnDAAAF0ctHlYZJ7/0L9V4jkCqkjVdwITgI997H1/fPH9GMqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6qDm/1+PvjPzufFnUZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlEd3Ox8XuR9I6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YjqBWVZCTO+iwdBAAAAAElFTkSuQmCC',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAACE0lEQVR4Ae3BsY3lBgxF0bsP6oCVsC0WxLZYyIKOnNuYYMJ1YEii9Ifn/Pr919//sMaINUqsUWKNEmuUWKPEGiXWKLFGiTVKrFFijRJrlFijxBol1iixRok1SrycR/NmBy/g0fwXj+ZPKo0nO3goj+YMHs23SuNpDh7Eo7mSR/Ot0ngC8RAezZ08mic4GObRTPFovlQaUw6GeDRP4dF8qTTuJgZ4NE/k0dxN3MyjeTKP5k7iRh7NG3g0dxE38WjexKO5g7iBR/NG3s3VxMU8mjfzaK4k1ihxIY/mE3g0VxFrlLiIR/NJPJoriAt4NJ/IozmbWKPEGiVO5tF8Mo/mTGKNEmuUOJFH8xN4NGcRa5RYo8QaJdYosUaJNUqcxKP5STyaM4iTVBo/SaVxBrFGiTVKrFFijRJrlFijxIkqjZ+g0jiLWKPEGiVOVml8skrjTGKNEmuUuECl8YkqjbOJi1Qan6TSuIJYo8SFKo1PUGlcRaxR4mKVxptVGlcSN6g03qjSuJq4SaXxJpXGHcSNKo03qDTuIm5WaTxZpXEnMaDSeKJK424HQyqNLx7NtEpjysGwSuOLR3O3SmOaeIhK406VxhMcPEil8c2jOVul8TQHD1VpfPNo/q9K48kOXqDS+BOPptJ4K/FylcabiTVKrFFijRJrlFijxBol1iixRok1SqxRYo0Sa5RYo8QaJdYosUb9CzmjgqALeyqyAAAAAElFTkSuQmCC',
]

function validateVisionConnectionDescriptions(descriptions) {
  const text = descriptions.map((description) =>
    [
      description.descriptionZh,
      description.descriptionEn,
      ...description.keywordsZh,
      ...description.keywordsEn,
    ].join(' ').toLowerCase(),
  )
  const seesRed = /红|赤|朱|red|crimson|scarlet|maroon/i.test(text[0] ?? '')
  const seesBlue = /蓝|青|blue|azure|cyan|navy/i.test(text[1] ?? '')
  if (!seesRed || !seesBlue || text[0] === text[1]) {
    throw new AiVisualSearchError(
      'AI_SEARCH_BAD_RESPONSE',
      '模型未能正确识别测试画面，请确认选择了支持图像理解的模型。',
    )
  }
}

function createAiVisualSearchService({
  userDataPath,
  credentialsStore,
  fetchImpl = globalThis.fetch,
  fileSystem = fs.promises,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  now = () => new Date(),
  contactSheetComposer = null,
}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('An absolute userDataPath is required')
  }
  const hasSplitReader =
    typeof credentialsStore?.readActiveServicesForMainProcess === 'function'
  const hasLegacyReader =
    typeof credentialsStore?.readActiveProfileForMainProcess === 'function'
  const hasSplitResolver =
    typeof credentialsStore?.resolveServiceProfileInputForMainProcess ===
    'function'
  const hasLegacyResolver =
    typeof credentialsStore?.resolveProfileInputForMainProcess === 'function'
  if (
    !credentialsStore ||
    (!hasSplitReader && !hasLegacyReader) ||
    (!hasSplitResolver && !hasLegacyResolver)
  ) {
    throw new TypeError('The main-process AI credential store is required')
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required')
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new TypeError('A positive request timeout is required')
  }
  if (
    contactSheetComposer != null &&
    typeof contactSheetComposer?.compose !== 'function'
  ) {
    throw new TypeError('A contact sheet composer with compose() is required')
  }

  const mediaRoot = path.resolve(userDataPath, 'media')
  const cachePath = path.join(
    userDataPath,
    'semantic-index',
    'compatible-frame-index-v2.json',
  )
  let operationQueue = Promise.resolve()

  async function readActiveServiceBundle() {
    let legacyProfile = null
    if (hasLegacyReader) {
      legacyProfile = await credentialsStore.readActiveProfileForMainProcess()
    }

    if (hasSplitReader) {
      const active = await credentialsStore.readActiveServicesForMainProcess()
      return {
        vision: normalizeResolvedServiceProfile(
          active?.vision ?? active?.visionService,
          'vision',
        ),
        embedding: normalizeResolvedServiceProfile(
          active?.embedding ?? active?.embeddingService,
          'embedding',
        ),
        legacyProfile,
      }
    }

    return {
      ...servicesFromLegacyProfile(legacyProfile),
      legacyProfile,
    }
  }

  async function resolveServiceProfile(kind, rawInput) {
    if (hasSplitResolver) {
      return normalizeResolvedServiceProfile(
        await credentialsStore.resolveServiceProfileInputForMainProcess(
          kind,
          rawInput,
        ),
        kind,
      )
    }
    const legacyProfile =
      await credentialsStore.resolveProfileInputForMainProcess(rawInput)
    return servicesFromLegacyProfile(legacyProfile)[kind]
  }

  function connectionTestFrames() {
    return CONNECTION_TEST_IMAGE_DATA_URLS.map((dataUrl) => ({
      imageBytes: Buffer.from(
        dataUrl.slice(dataUrl.indexOf(',') + 1),
        'base64',
      ),
      mimeType: 'image/png',
    }))
  }

  async function testVisionService(service) {
    const startedAt = Date.now()
    const descriptions = []
    for (const frame of connectionTestFrames()) {
      descriptions.push(
        ...(await describeFrameBatch({
          batch: [frame],
          service,
          fetchImpl,
          fileSystem,
          timeoutMs: requestTimeoutMs,
          connectionTest: true,
          contactSheetComposer,
        })),
      )
    }
    validateVisionConnectionDescriptions(descriptions)
    return {
      ok: true,
      model: service.model,
      latencyMs: Math.max(0, Date.now() - startedAt),
    }
  }

  async function testEmbeddingService(service) {
    const startedAt = Date.now()
    const embeddingResult = await createEmbeddings({
      input: [
        'Aurora model service connection test',
        '极光模型服务连接测试',
      ],
      service,
      fetchImpl,
      timeoutMs: requestTimeoutMs,
    })
    return {
      ok: true,
      model: service.model,
      dimensions: embeddingResult.dimensions,
      latencyMs: Math.max(0, Date.now() - startedAt),
    }
  }

  async function testVisionProfile(rawInput) {
    return testVisionService(await resolveServiceProfile('vision', rawInput))
  }

  async function testEmbeddingProfile(rawInput) {
    return testEmbeddingService(
      await resolveServiceProfile('embedding', rawInput),
    )
  }

  async function testProfile(rawInput) {
    const startedAt = Date.now()
    let visionService
    let embeddingService
    const splitInput = rawInput && typeof rawInput === 'object' && (
      rawInput.vision != null ||
      rawInput.visionService != null ||
      rawInput.embedding != null ||
      rawInput.embeddingService != null
    )
    if (splitInput) {
      const visionInput = rawInput.vision ?? rawInput.visionService
      const embeddingInput = rawInput.embedding ?? rawInput.embeddingService
      if (visionInput == null || embeddingInput == null) {
        throw new AiVisualSearchError(
          'AI_SEARCH_INVALID_INPUT',
          '连接测试需要同时提供画面理解与语义检索服务。',
        )
      }
      ;[visionService, embeddingService] = await Promise.all([
        resolveServiceProfile('vision', visionInput),
        resolveServiceProfile('embedding', embeddingInput),
      ])
    } else if (hasLegacyResolver) {
      const profile =
        await credentialsStore.resolveProfileInputForMainProcess(rawInput)
      ;({ vision: visionService, embedding: embeddingService } =
        servicesFromLegacyProfile(profile))
    } else {
      ;[visionService, embeddingService] = await Promise.all([
        resolveServiceProfile('vision', {
          ...rawInput,
          model: rawInput?.visionModel,
        }),
        resolveServiceProfile('embedding', {
          ...rawInput,
          model: rawInput?.embeddingModel,
        }),
      ])
    }
    const vision = await testVisionService(visionService)
    const embedding = await testEmbeddingService(embeddingService)
    return {
      vision: { ok: true, model: vision.model },
      embedding: {
        ok: true,
        model: embedding.model,
        dimensions: embedding.dimensions,
      },
      latencyMs: Math.max(0, Date.now() - startedAt),
    }
  }

  async function executeSearch(rawRequest) {
    const request = normalizeSearchRequest(rawRequest)
    if (request.candidates.length === 0) {
      return {
        matches: [],
        indexedFrameCount: 0,
        newlyAnalyzedFrameCount: 0,
        semanticQuery: request.query,
      }
    }

    const {
      vision: visionService,
      embedding: embeddingService,
      legacyProfile,
    } = await readActiveServiceBundle()
    if (!visionService && !embeddingService) {
      throw new AiVisualSearchError(
        'AI_SEARCH_PROFILE_NOT_CONFIGURED',
        '请先在探索页设置中选择一个模型服务。',
      )
    }
    if (!visionService) {
      throw new AiVisualSearchError(
        'AI_SEARCH_VISION_PROFILE_NOT_CONFIGURED',
        '请先在探索页设置中配置画面理解服务。',
      )
    }
    if (!embeddingService) {
      throw new AiVisualSearchError(
        'AI_SEARCH_EMBEDDING_PROFILE_NOT_CONFIGURED',
        '请先在探索页设置中配置语义检索服务。',
      )
    }
    const legacyProfileMatches =
      !request.profileId ||
      legacyProfile?.id === request.profileId ||
      visionService.id === request.profileId ||
      embeddingService.id === request.profileId
    if (
      !legacyProfileMatches ||
      (request.visionProfileId &&
        visionService.id !== request.visionProfileId) ||
      (request.embeddingProfileId &&
        embeddingService.id !== request.embeddingProfileId)
    ) {
      throw new AiVisualSearchError(
        'AI_SEARCH_PROFILE_CHANGED',
        '搜索期间模型服务发生了切换，请重新搜索。',
      )
    }
    const descriptionFingerprint = visionServiceFingerprint(visionService)
    const embeddingFingerprint = embeddingServiceFingerprint(
      embeddingService,
      descriptionFingerprint,
    )
    const preparedCandidates = []
    for (const candidate of request.candidates) {
      const managedFrame = await validateManagedFramePath({
        imagePath: candidate.imagePath,
        mediaRoot,
        fileSystem,
      })
      preparedCandidates.push({
        ...candidate,
        ...managedFrame,
        cacheKey: frameCacheKey(candidate, descriptionFingerprint),
      })
    }

    const cache = await readCache(cachePath, fileSystem)
    const uniqueFrames = new Map()
    for (const candidate of preparedCandidates) {
      if (!uniqueFrames.has(candidate.cacheKey)) {
        uniqueFrames.set(candidate.cacheKey, candidate)
      }
    }

    const missingDescriptions = [...uniqueFrames.values()].filter(
      (candidate) => {
        const entry = cache.entries[candidate.cacheKey]
        return !entry || entry.descriptionFingerprint !== descriptionFingerprint
      },
    )
    let newlyAnalyzedFrameCount = 0

    for (let index = 0; index < missingDescriptions.length; index += VISION_BATCH_SIZE) {
      const batch = missingDescriptions.slice(index, index + VISION_BATCH_SIZE)
      const descriptions = await describeFrameBatch({
        batch,
        service: visionService,
        fetchImpl,
        fileSystem,
        timeoutMs: requestTimeoutMs,
        contactSheetComposer,
      })
      const updatedAt = now().toISOString()
      for (let offset = 0; offset < batch.length; offset += 1) {
        const candidate = batch[offset]
        cache.entries[candidate.cacheKey] = {
          assetId: candidate.assetId,
          sourceFingerprint: candidate.sourceFingerprint,
          frameId: candidate.frameId,
          providerFingerprint: null,
          descriptionFingerprint,
          embeddingFingerprint: null,
          ...descriptions[offset],
          embedding: null,
          embeddingDimensions: null,
          updatedAt,
        }
      }
      newlyAnalyzedFrameCount += batch.length
      const batchNumber = Math.floor(index / VISION_BATCH_SIZE) + 1
      const isFinalBatch = index + batch.length >= missingDescriptions.length
      if (isFinalBatch || batchNumber % 10 === 0) {
        await writeCacheAtomically(cachePath, cache, fileSystem)
      }
    }

    const queryResult = await createEmbeddings({
      input: [`寻找符合以下自然语言要求的影视画面：${request.query}`],
      service: embeddingService,
      fetchImpl,
      timeoutMs: requestTimeoutMs,
    })
    const queryEmbedding = queryResult.embeddings[0]
    const queryDimensions = queryResult.dimensions

    const missingEmbeddings = [...uniqueFrames.values()].filter((candidate) => {
      const entry = cache.entries[candidate.cacheKey]
      return (
        entry &&
        (entry.embedding == null ||
          entry.embeddingFingerprint !== embeddingFingerprint ||
          entry.embeddingDimensions !== queryDimensions)
      )
    })
    for (let index = 0; index < missingEmbeddings.length; index += EMBEDDING_BATCH_SIZE) {
      const batch = missingEmbeddings.slice(index, index + EMBEDDING_BATCH_SIZE)
      const embeddingResult = await createEmbeddings({
        input: batch.map((candidate) =>
          entryEmbeddingText(cache.entries[candidate.cacheKey]),
        ),
        service: embeddingService,
        fetchImpl,
        timeoutMs: requestTimeoutMs,
      })
      if (embeddingResult.dimensions !== queryDimensions) {
        throw new AiVisualSearchError(
          'AI_SEARCH_BAD_RESPONSE',
          'Embedding 模型在同一次搜索中返回了不同维数。',
        )
      }
      const updatedAt = now().toISOString()
      for (let offset = 0; offset < batch.length; offset += 1) {
        const entry = cache.entries[batch[offset].cacheKey]
        entry.embedding = embeddingResult.embeddings[offset]
        entry.embeddingFingerprint = embeddingFingerprint
        entry.embeddingDimensions = embeddingResult.dimensions
        entry.updatedAt = updatedAt
      }
      const batchNumber = Math.floor(index / EMBEDDING_BATCH_SIZE) + 1
      const isFinalBatch = index + batch.length >= missingEmbeddings.length
      if (isFinalBatch || batchNumber % 10 === 0) {
        await writeCacheAtomically(cachePath, cache, fileSystem)
      }
    }

    const ranked = preparedCandidates
      .map((candidate) => {
        const entry = cache.entries[candidate.cacheKey]
        if (
          !entry?.embedding ||
          entry.descriptionFingerprint !== descriptionFingerprint ||
          entry.embeddingFingerprint !== embeddingFingerprint ||
          entry.embeddingDimensions !== queryDimensions
        ) return null
        return {
          candidate,
          entry,
          score: cosineSimilarity(queryEmbedding, entry.embedding),
        }
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return left.candidate.timeSeconds - right.candidate.timeSeconds
      })

    const selected = []
    const selectedTimesByClip = new Map()
    for (const item of ranked) {
      const clipKey = item.candidate.clipId || item.candidate.assetId
      const selectedTimes = selectedTimesByClip.get(clipKey) ?? []
      if (
        selectedTimes.some(
          (timeSeconds) =>
            Math.abs(timeSeconds - item.candidate.timeSeconds) <
            NEARBY_FRAME_WINDOW_SECONDS,
        )
      ) {
        continue
      }
      selected.push(item)
      selectedTimes.push(item.candidate.timeSeconds)
      selectedTimesByClip.set(clipKey, selectedTimes)
      if (selected.length >= request.limit) break
    }

    return {
      matches: selected.map(({ candidate, entry, score }) => ({
        resultId: candidate.resultId,
        score,
        reason: entry.descriptionZh || entry.descriptionEn,
        descriptionZh: entry.descriptionZh,
        descriptionEn: entry.descriptionEn,
        keywords: [...entry.keywordsZh, ...entry.keywordsEn],
        timeSeconds: candidate.timeSeconds,
      })),
      indexedFrameCount: ranked.length,
      newlyAnalyzedFrameCount,
      semanticQuery: request.query,
    }
  }

  function search(request) {
    const task = operationQueue.then(
      () => executeSearch(request),
      () => executeSearch(request),
    )
    operationQueue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  return {
    search,
    testProfile,
    testVisionProfile,
    testEmbeddingProfile,
    cachePath,
  }
}

module.exports = {
  AI_VISUAL_SEARCH_CACHE_VERSION,
  AiVisualSearchError,
  createAiVisualSearchService,
  embeddingServiceFingerprint,
  normalizeAiVisualSearchError,
  providerCacheFingerprint,
  visionServiceFingerprint,
}
