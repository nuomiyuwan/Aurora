'use strict'

const DEFAULT_TIMEOUT_MS = 750
const MAX_MODEL_COUNT = 512
const MAX_MODEL_ID_LENGTH = 512

const PROVIDERS = Object.freeze([
  Object.freeze({
    provider: 'ollama',
    label: 'Ollama',
    origin: 'http://127.0.0.1:11434',
    baseUrl: 'http://127.0.0.1:11434/v1',
  }),
  Object.freeze({
    provider: 'lm-studio',
    label: 'LM Studio',
    origin: 'http://127.0.0.1:1234',
    baseUrl: 'http://127.0.0.1:1234/v1',
  }),
])

const EMBEDDING_MODEL_PATTERNS = [
  /(?:^|[-_.:/])(?:embed|embedding)(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])(?:bge|e5|gte)(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])(?:all-)?minilm(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])mxbai-embed(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])nomic-embed(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])snowflake-arctic-embed(?:[-_.:/]|$)/,
]

const VISION_MODEL_PATTERNS = [
  /(?:^|[-_.:/])vision(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])(?:vl|vlm)(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])(?:llava|bakllava|moondream|pixtral|mllama)(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])(?:internvl|cogvlm)(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])minicpm-v(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])qwen[^/:]*-vl(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])llama-?3(?:\.2)?-vision(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])phi-?3(?:\.5)?-vision(?:[-_.:/]|$)/,
  /(?:^|[-_.:/])gemma-?3(?:[-_.:/]|$)/,
]

function inferModelCapabilities(modelId) {
  const normalized = modelId.toLowerCase()
  const capabilities = []
  if (VISION_MODEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    capabilities.push('vision')
  }
  if (EMBEDDING_MODEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    capabilities.push('embedding')
  }
  return capabilities
}

function normalizeModelId(value) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (id === '' || id.length > MAX_MODEL_ID_LENGTH) return null
  if ([...id].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 31 || codePoint === 127
  })) {
    return null
  }
  return id
}

function normalizeModels(ids) {
  const seen = new Set()
  const models = []
  for (const rawId of ids) {
    const id = normalizeModelId(rawId)
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      capabilities: inferModelCapabilities(id),
    })
    if (models.length >= MAX_MODEL_COUNT) break
  }
  return models
}

function parseOpenAiModels(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    return null
  }
  return normalizeModels(payload.data.map((model) => model?.id))
}

function parseOllamaTags(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.models)) {
    return null
  }
  return normalizeModels(
    payload.models.map((model) => model?.name ?? model?.model),
  )
}

async function requestJson(fetchImpl, url, timeoutMs) {
  const controller = new AbortController()
  let timeout
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('Local AI model detection timed out'))
    }, timeoutMs)
    timeout.unref?.()
  })

  try {
    const requestPromise = (async () => {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response || response.ok !== true || typeof response.json !== 'function') {
        throw new Error('Local AI model endpoint is unavailable')
      }
      return response.json()
    })()
    return await Promise.race([requestPromise, timeoutPromise])
  } finally {
    clearTimeout(timeout)
  }
}

function toDetectionResult(provider, models) {
  return {
    provider: provider.provider,
    label: provider.label,
    baseUrl: provider.baseUrl,
    models,
  }
}

async function detectOpenAiProvider(fetchImpl, provider, timeoutMs) {
  try {
    const payload = await requestJson(
      fetchImpl,
      `${provider.origin}/v1/models`,
      timeoutMs,
    )
    const models = parseOpenAiModels(payload)
    return models === null ? null : toDetectionResult(provider, models)
  } catch {
    return null
  }
}

async function detectOllama(fetchImpl, provider, timeoutMs) {
  const openAiResult = await detectOpenAiProvider(
    fetchImpl,
    provider,
    timeoutMs,
  )
  if (openAiResult?.models.length) return openAiResult

  try {
    const payload = await requestJson(
      fetchImpl,
      `${provider.origin}/api/tags`,
      timeoutMs,
    )
    const models = parseOllamaTags(payload)
    if (models !== null) return toDetectionResult(provider, models)
  } catch {
    // A missing native endpoint does not invalidate a valid, empty OpenAI list.
  }

  return openAiResult
}

function createAiLocalModelDetector(options = {}) {
  const fetchImpl = Object.prototype.hasOwnProperty.call(options, 'fetchImpl')
    ? options.fetchImpl
    : globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const safeTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(5_000, Math.max(25, Math.round(timeoutMs)))
      : DEFAULT_TIMEOUT_MS

  async function detect() {
    if (typeof fetchImpl !== 'function') return []

    const detections = await Promise.all(
      PROVIDERS.map((provider) =>
        provider.provider === 'ollama'
          ? detectOllama(fetchImpl, provider, safeTimeoutMs)
          : detectOpenAiProvider(fetchImpl, provider, safeTimeoutMs),
      ),
    )
    return detections.filter(Boolean)
  }

  return Object.freeze({ detect })
}

module.exports = {
  createAiLocalModelDetector,
}
