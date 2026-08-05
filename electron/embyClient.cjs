const { randomUUID } = require('crypto')

const DEFAULT_TIMEOUT_MS = 12_000
const IMAGE_TIMEOUT_MS = 20_000
const MAX_JSON_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_BYTES = 24 * 1024 * 1024

const SEARCH_ITEM_TYPES = new Set([
  'Movie',
  'Series',
  'Episode',
  'Video',
  'Trailer',
  'MusicVideo',
])

const IMAGE_TYPES = new Set([
  'Primary',
  'Art',
  'Backdrop',
  'Banner',
  'Logo',
  'Thumb',
  'Disc',
  'Box',
  'Screenshot',
  'Menu',
  'Chapter',
])

const IMAGE_FORMATS = new Set(['original', 'gif', 'jpg', 'png', 'webp'])

class EmbyClientError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'EmbyClientError'
    this.code = code
    this.status = options.status
    this.retryable = Boolean(options.retryable)
    this.cause = options.cause
  }
}

function normalizeEmbyError(error) {
  if (error instanceof EmbyClientError) {
    return {
      code: error.code,
      message: error.message,
      status: Number.isInteger(error.status) ? error.status : null,
      retryable: error.retryable,
    }
  }

  return {
    code: 'EMBY_UNKNOWN',
    message: 'Emby 请求失败，请稍后重试。',
    status: null,
    retryable: false,
  }
}

function invalidInput(message) {
  throw new EmbyClientError('EMBY_INVALID_INPUT', message)
}

function assertPlainObject(value, fieldName = '请求') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidInput(`${fieldName}格式无效。`)
  }
  return value
}

function containsDisallowedControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      return true
    }
  }
  return false
}

function cleanString(value, fieldName, options = {}) {
  const {
    allowEmpty = false,
    maxLength = 256,
    trim = true,
  } = options

  if (typeof value !== 'string') {
    invalidInput(`${fieldName}必须是文本。`)
  }

  const result = trim ? value.trim() : value
  if (!allowEmpty && result.length === 0) {
    invalidInput(`请填写${fieldName}。`)
  }
  if (result.length > maxLength || containsDisallowedControlCharacters(result)) {
    invalidInput(`${fieldName}格式无效。`)
  }

  return result
}

function cleanInteger(value, fieldName, options = {}) {
  const { defaultValue, min = 0, max = Number.MAX_SAFE_INTEGER } = options
  if (value === undefined || value === null) return defaultValue
  if (!Number.isInteger(value) || value < min || value > max) {
    invalidInput(`${fieldName}必须是 ${min} 到 ${max} 之间的整数。`)
  }
  return value
}

function cleanItemId(value) {
  const itemId = cleanString(value, '媒体 ID', { maxLength: 256 })
  if (!/^[A-Za-z0-9._:-]+$/.test(itemId)) {
    invalidInput('媒体 ID 格式无效。')
  }
  return itemId
}

function normalizeServerUrl(value) {
  let input = cleanString(value, 'Emby 服务器地址', { maxLength: 2048 })
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
    input = `http://${input}`
  }

  let url
  try {
    url = new URL(input)
  } catch {
    invalidInput('Emby 服务器地址无效。')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    invalidInput('Emby 服务器地址只支持 HTTP 或 HTTPS。')
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    invalidInput('Emby 服务器地址不能包含账号、密码、查询参数或锚点。')
  }

  const pathSegments = url.pathname.split('/').filter(Boolean)
  const embyIndex = pathSegments.findIndex((segment) => segment.toLowerCase() === 'emby')
  if (embyIndex >= 0) {
    url.pathname = `/${pathSegments.slice(0, embyIndex + 1).join('/')}`
  } else {
    pathSegments.push('emby')
    url.pathname = `/${pathSegments.join('/')}`
  }

  return url.toString().replace(/\/$/, '')
}

function escapeAuthorizationValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function makeAuthorizationHeader(session = {}) {
  const fields = [
    ['Client', session.clientName || 'Aurora'],
    ['Device', session.deviceName || 'Aurora Desktop'],
    ['DeviceId', session.deviceId],
    ['Version', session.version || '1.0.0'],
  ]

  if (session.userId) fields.unshift(['UserId', session.userId])

  return `Emby ${fields
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([key, value]) => `${key}="${escapeAuthorizationValue(value)}"`)
    .join(', ')}`
}

function buildApiUrl(serverUrl, endpoint, query) {
  const url = new URL(`${serverUrl}${endpoint}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
    }
  }
  return url
}

function httpError(status) {
  if (status === 400) {
    return new EmbyClientError('EMBY_BAD_REQUEST', 'Emby 无法处理该请求。', { status })
  }
  if (status === 401) {
    return new EmbyClientError('EMBY_UNAUTHORIZED', 'Emby 登录已失效，请重新连接。', { status })
  }
  if (status === 403) {
    return new EmbyClientError('EMBY_FORBIDDEN', '当前 Emby 用户没有执行此操作的权限。', { status })
  }
  if (status === 404) {
    return new EmbyClientError('EMBY_NOT_FOUND', '未找到对应的 Emby 内容。', { status })
  }
  if (status === 429) {
    return new EmbyClientError('EMBY_RATE_LIMITED', 'Emby 请求过于频繁，请稍后重试。', {
      status,
      retryable: true,
    })
  }
  if (status >= 500) {
    return new EmbyClientError('EMBY_SERVER_ERROR', 'Emby 服务器暂时无法完成请求。', {
      status,
      retryable: true,
    })
  }
  return new EmbyClientError('EMBY_REQUEST_FAILED', 'Emby 请求失败。', { status })
}

async function readLimitedBytes(response, maximumBytes) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new EmbyClientError('EMBY_RESPONSE_TOO_LARGE', 'Emby 返回的数据超过允许大小。')
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maximumBytes) {
      throw new EmbyClientError('EMBY_RESPONSE_TOO_LARGE', 'Emby 返回的数据超过允许大小。')
    }
    return buffer
  }

  const reader = response.body.getReader()
  const chunks = []
  let totalLength = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalLength += value.byteLength
    if (totalLength > maximumBytes) {
      await reader.cancel()
      throw new EmbyClientError('EMBY_RESPONSE_TOO_LARGE', 'Emby 返回的数据超过允许大小。')
    }
    chunks.push(value)
  }

  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function parseJsonResponse(response) {
  if (response.status === 204) return null
  const bytes = await readLimitedBytes(response, MAX_JSON_BYTES)
  if (bytes.byteLength === 0) return null

  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (cause) {
    throw new EmbyClientError('EMBY_BAD_RESPONSE', 'Emby 返回了无法识别的数据。', { cause })
  }
}

function redactUrlSecrets(value) {
  if (typeof value !== 'string' || !/[?&](api_key|x-emby-token|token|access_token)=/i.test(value)) {
    return value
  }

  const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
  try {
    const url = new URL(value, 'http://aurora.invalid')
    for (const key of [...url.searchParams.keys()]) {
      if (/^(api_key|x-emby-token|token|access_token)$/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`
  } catch {
    return value.replace(/([?&])(api_key|x-emby-token|token|access_token)=[^&#]*/gi, '$1')
  }
}

function isSensitiveKey(key) {
  const normalized = key.toLowerCase().replace(/[-_]/g, '')
  return [
    'accesstoken',
    'token',
    'apikey',
    'password',
    'pw',
    'opentoken',
    'xembytoken',
  ].includes(normalized)
}

function sanitizeEmbyPayload(value, secrets = []) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeEmbyPayload(entry, secrets))
  }

  if (value && typeof value === 'object') {
    const result = {}
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue
      result[key] = sanitizeEmbyPayload(entry, secrets)
    }
    return result
  }

  if (typeof value === 'string') {
    let result = redactUrlSecrets(value)
    for (const secret of secrets) {
      if (secret && result.includes(secret)) {
        result = result.split(secret).join('[REDACTED]')
      }
    }
    return result
  }

  return value
}

class EmbySessionManager {
  constructor(options = {}) {
    if (options.fetchImpl !== undefined && typeof options.fetchImpl !== 'function') {
      invalidInput('fetchImpl 必须是函数。')
    }

    this.fetchImpl = options.fetchImpl || globalThis.fetch
    if (typeof this.fetchImpl !== 'function') {
      throw new EmbyClientError('EMBY_FETCH_UNAVAILABLE', '当前运行环境不支持网络请求。')
    }

    this.persistence = options.persistence || null
    this.clientName = options.clientName || 'Aurora'
    this.deviceName = options.deviceName || 'Aurora Desktop'
    this.version = options.version || '1.0.0'
    this.defaultDeviceId = options.deviceId || `aurora-${randomUUID()}`
    this.session = null
    this.activeControllers = new Set()
    this.initialized = false
    this.persistenceMode = 'none'
  }

  async initialize() {
    if (this.initialized) return this.getEmbyConnection()
    this.initialized = true

    if (!this.persistence || typeof this.persistence.load !== 'function') {
      return this.getEmbyConnection()
    }

    try {
      const stored = await this.persistence.load()
      if (!stored) return this.getEmbyConnection()

      const candidate = this.validateStoredSession(stored)
      this.session = candidate
      this.persistenceMode = 'encrypted'
    } catch {
      this.session = null
      this.persistenceMode = 'none'
      await this.clearPersistenceQuietly()
    }

    return this.getEmbyConnection()
  }

  validateStoredSession(value) {
    const stored = assertPlainObject(value, '已保存的 Emby 连接')
    return {
      serverUrl: normalizeServerUrl(stored.serverUrl),
      serverId: cleanString(stored.serverId, '服务器 ID', { maxLength: 256 }),
      serverName: cleanString(stored.serverName || '', '服务器名称', {
        allowEmpty: true,
        maxLength: 256,
      }),
      userId: cleanItemId(stored.userId),
      userName: cleanString(stored.userName, '用户名', { maxLength: 256 }),
      deviceId: cleanString(stored.deviceId, '设备 ID', { maxLength: 256 }),
      connectedAt: cleanString(stored.connectedAt, '连接时间', { maxLength: 64 }),
      token: cleanString(stored.token, '访问令牌', { maxLength: 8192 }),
      clientName: this.clientName,
      deviceName: this.deviceName,
      version: this.version,
    }
  }

  getEmbyConnection() {
    if (!this.session) {
      return {
        connected: false,
        serverUrl: null,
        serverId: null,
        serverName: null,
        user: null,
        connectedAt: null,
        persistence: 'none',
      }
    }

    return {
      connected: true,
      serverUrl: this.session.serverUrl,
      serverId: this.session.serverId,
      serverName: this.session.serverName || null,
      user: {
        id: this.session.userId,
        name: this.session.userName,
      },
      connectedAt: this.session.connectedAt,
      persistence: this.persistenceMode,
    }
  }

  async testEmbyConnection(request) {
    const input = assertPlainObject(request, 'Emby 连接信息')
    const serverUrl = normalizeServerUrl(input.serverUrl)
    const username = cleanString(input.username, '用户名', { maxLength: 256 })
    const password = cleanString(input.password, '密码', {
      allowEmpty: true,
      maxLength: 1024,
      trim: false,
    })
    const deviceId = input.deviceId
      ? cleanString(input.deviceId, '设备 ID', { maxLength: 256 })
      : this.session?.deviceId || this.defaultDeviceId

    const provisionalSession = {
      serverUrl,
      userId: '',
      token: '',
      deviceId,
      clientName: this.clientName,
      deviceName: this.deviceName,
      version: this.version,
    }

    let authentication
    try {
      authentication = await this.requestJson(provisionalSession, '/Users/AuthenticateByName', {
        method: 'POST',
        authenticated: false,
        body: { Username: username, Pw: password },
      })
    } catch (error) {
      if (error instanceof EmbyClientError && error.code === 'EMBY_UNAUTHORIZED') {
        throw new EmbyClientError(
          'EMBY_AUTH_FAILED',
          'Emby 用户名或密码无效，或该用户不允许连接。',
          { status: error.status },
        )
      }
      throw error
    }

    const token = cleanString(authentication?.AccessToken, 'Emby 访问令牌', { maxLength: 8192 })
    const userId = cleanItemId(authentication?.User?.Id)
    const userName = cleanString(authentication?.User?.Name || username, '用户名', {
      maxLength: 256,
    })
    const serverId = cleanString(
      authentication?.ServerId || authentication?.User?.ServerId,
      '服务器 ID',
      { maxLength: 256 },
    )

    const nextSession = {
      serverUrl,
      serverId,
      serverName:
        typeof authentication?.User?.ServerName === 'string'
          ? authentication.User.ServerName.slice(0, 256)
          : '',
      userId,
      userName,
      deviceId,
      connectedAt: new Date().toISOString(),
      token,
      clientName: this.clientName,
      deviceName: this.deviceName,
      version: this.version,
    }

    this.abortActiveRequests()
    this.session = nextSession
    this.persistenceMode = 'memory'

    if (this.persistence && typeof this.persistence.save === 'function') {
      try {
        const persisted = await this.persistence.save({ ...nextSession })
        if (persisted) this.persistenceMode = 'encrypted'
      } catch {
        this.persistenceMode = 'memory'
      }
    }

    return this.getEmbyConnection()
  }

  async disconnectEmby() {
    this.abortActiveRequests()
    this.session = null
    this.persistenceMode = 'none'

    if (this.persistence && typeof this.persistence.clear === 'function') {
      try {
        await this.persistence.clear()
      } catch (cause) {
        throw new EmbyClientError(
          'EMBY_STORAGE_ERROR',
          'Emby 已从当前会话断开，但无法清除已保存的加密连接。',
          { cause },
        )
      }
    }

    return this.getEmbyConnection()
  }

  async searchEmby(request) {
    const input = assertPlainObject(request, 'Emby 搜索请求')
    const query = cleanString(input.query, '搜索内容', { maxLength: 256 })
    const startIndex = cleanInteger(input.startIndex, '起始位置', {
      defaultValue: 0,
      min: 0,
      max: 1_000_000,
    })
    const limit = cleanInteger(input.limit, '结果数量', {
      defaultValue: 30,
      min: 1,
      max: 50,
    })

    let includeItemTypes = ['Movie', 'Series', 'Episode', 'Video']
    if (input.includeItemTypes !== undefined) {
      if (!Array.isArray(input.includeItemTypes) || input.includeItemTypes.length === 0) {
        invalidInput('媒体类型筛选格式无效。')
      }
      includeItemTypes = [...new Set(input.includeItemTypes.map((itemType) => {
        const value = cleanString(itemType, '媒体类型', { maxLength: 32 })
        if (!SEARCH_ITEM_TYPES.has(value)) invalidInput(`不支持媒体类型：${value}。`)
        return value
      }))]
    }

    const parentId = input.parentId === undefined ? undefined : cleanItemId(input.parentId)
    return this.runAuthenticated((session) => this.requestJson(session, `/Users/${encodeURIComponent(session.userId)}/Items`, {
      query: {
        Recursive: true,
        SearchTerm: query,
        StartIndex: startIndex,
        Limit: limit,
        ParentId: parentId,
        IncludeItemTypes: includeItemTypes,
        Fields: [
          'Genres',
          'People',
          'Overview',
          'MediaStreams',
          'ProviderIds',
          'Studios',
          'PrimaryImageAspectRatio',
          'DateCreated',
        ],
        EnableImages: true,
        EnableUserData: true,
        ImageTypeLimit: 1,
        EnableImageTypes: ['Primary', 'Backdrop', 'Thumb'],
      },
    }))
  }

  async getEmbyItem(request) {
    const input = assertPlainObject(request, 'Emby 详情请求')
    const itemId = cleanItemId(input.itemId)
    return this.runAuthenticated((session) => this.requestJson(
      session,
      `/Users/${encodeURIComponent(session.userId)}/Items/${encodeURIComponent(itemId)}`,
    ))
  }

  async getEmbyImage(request) {
    const input = assertPlainObject(request, 'Emby 图片请求')
    const itemId = cleanItemId(input.itemId)
    const type = input.type === undefined
      ? 'Primary'
      : cleanString(input.type, '图片类型', { maxLength: 32 })
    if (!IMAGE_TYPES.has(type)) invalidInput(`不支持图片类型：${type}。`)

    const index = cleanInteger(input.index, '图片序号', {
      defaultValue: 0,
      min: 0,
      max: 1000,
    })
    const maxWidth = cleanInteger(input.maxWidth, '图片最大宽度', {
      defaultValue: 1280,
      min: 16,
      max: 8192,
    })
    const maxHeight = cleanInteger(input.maxHeight, '图片最大高度', {
      defaultValue: 1280,
      min: 16,
      max: 8192,
    })
    const quality = cleanInteger(input.quality, '图片质量', {
      defaultValue: 90,
      min: 1,
      max: 100,
    })
    const format = input.format === undefined
      ? 'jpg'
      : cleanString(input.format, '图片格式', { maxLength: 16 }).toLowerCase()
    if (!IMAGE_FORMATS.has(format)) invalidInput(`不支持图片格式：${format}。`)

    return this.runAuthenticated(async (session) => {
      return this.request(
        session,
        `/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(type)}`,
        {
          query: {
            Index: index,
            MaxWidth: maxWidth,
            MaxHeight: maxHeight,
            Quality: quality,
            Format: format,
            AutoOrient: true,
          },
          timeoutMs: IMAGE_TIMEOUT_MS,
          consume: async (response) => {
            const bytes = await readLimitedBytes(response, MAX_IMAGE_BYTES)
            const transferable = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            )

            return {
              mimeType: response.headers.get('content-type') || 'application/octet-stream',
              data: transferable,
              byteLength: bytes.byteLength,
              etag: response.headers.get('etag'),
              cacheControl: response.headers.get('cache-control'),
            }
          },
        },
      )
    })
  }

  async getEmbyPlaybackInfo(request) {
    const input = assertPlainObject(request, 'Emby 播放信息请求')
    const itemId = cleanItemId(input.itemId)
    return this.runAuthenticated((session) => this.requestJson(
      session,
      `/Items/${encodeURIComponent(itemId)}/PlaybackInfo`,
      {
        query: {
          UserId: session.userId,
          AutoOpenLiveStream: false,
        },
      },
    ))
  }

  async runAuthenticated(operation) {
    await this.initialize()
    if (!this.session) {
      throw new EmbyClientError('EMBY_NOT_CONNECTED', '请先连接 Emby 服务器。')
    }

    const session = this.session
    try {
      const result = await operation(session)
      return sanitizeEmbyPayload(result, [session.token])
    } catch (error) {
      if (error instanceof EmbyClientError && error.code === 'EMBY_UNAUTHORIZED') {
        this.abortActiveRequests()
        this.session = null
        this.persistenceMode = 'none'
        await this.clearPersistenceQuietly()
      }
      throw error
    }
  }

  async requestJson(session, endpoint, options = {}) {
    return this.request(session, endpoint, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      consume: parseJsonResponse,
    })
  }

  async request(session, endpoint, options = {}) {
    const controller = new AbortController()
    const timeoutMs = cleanInteger(options.timeoutMs, '请求超时', {
      defaultValue: DEFAULT_TIMEOUT_MS,
      min: 1000,
      max: 60_000,
    })
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    this.activeControllers.add(controller)

    const headers = {
      'X-Emby-Authorization': makeAuthorizationHeader(session),
      ...(options.headers || {}),
    }
    if (options.authenticated !== false && session.token) {
      headers['X-Emby-Token'] = session.token
    }

    try {
      const response = await this.fetchImpl(
        buildApiUrl(session.serverUrl, endpoint, options.query),
        {
          method: options.method || 'GET',
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          redirect: 'error',
          signal: controller.signal,
        },
      )

      if (!response.ok) throw httpError(response.status)
      return typeof options.consume === 'function'
        ? await options.consume(response)
        : response
    } catch (error) {
      if (error instanceof EmbyClientError) throw error
      if (timedOut) {
        throw new EmbyClientError('EMBY_TIMEOUT', '连接 Emby 超时，请检查服务器地址和网络。', {
          retryable: true,
          cause: error,
        })
      }
      throw new EmbyClientError(
        'EMBY_NETWORK_ERROR',
        '无法连接到 Emby，请检查服务器地址、网络与 HTTPS 配置。',
        { retryable: true, cause: error },
      )
    } finally {
      clearTimeout(timeout)
      this.activeControllers.delete(controller)
    }
  }

  abortActiveRequests() {
    for (const controller of this.activeControllers) controller.abort()
    this.activeControllers.clear()
  }

  async clearPersistenceQuietly() {
    if (!this.persistence || typeof this.persistence.clear !== 'function') return
    try {
      await this.persistence.clear()
    } catch {
      // The in-memory token is already gone. Storage failures stay private.
    }
  }
}

function createEmbySessionManager(options) {
  return new EmbySessionManager(options)
}

module.exports = {
  EmbyClientError,
  EmbySessionManager,
  createEmbySessionManager,
  normalizeEmbyError,
  normalizeServerUrl,
}
