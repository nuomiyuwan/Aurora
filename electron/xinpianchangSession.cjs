const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const XINPIANCHANG_PARTITION = 'persist:aurora-online-xinpianchang-v1'
const XINPIANCHANG_SEARCH_UNAVAILABLE_CODE =
  'XINPIANCHANG_SEARCH_UNAVAILABLE'
const XINPIANCHANG_HOST = 'www.xinpianchang.com'
const XINPIANCHANG_API_HOST = 'app.xinpianchang.com'
const XINPIANCHANG_PASSPORT_HOST = 'passport.xinpianchang.com'
const XINPIANCHANG_PLAYER_HOST = 'player.xinpianchang.com'
const XINPIANCHANG_LOGIN_URL =
  `https://${XINPIANCHANG_PASSPORT_HOST}/iframe/xpcLogin?mode=quick`
const XINPIANCHANG_AUTH_STATE_URL = `https://${XINPIANCHANG_API_HOST}/user`
const ARTICLE_ID_PATTERN = /^[1-9][0-9]{0,15}$/
const PLAYER_MID_PATTERN = /^[0-9A-Za-z_-]{1,160}$/
const MAX_QUERY_LENGTH = 160
const DEFAULT_LIMIT = 12
const MAX_LIMIT = 24
const MAX_PAGE = 1_000
const MAX_REDIRECTS = 2
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_COVER_BYTES = 12 * 1024 * 1024
const SEARCH_TIMEOUT_MS = 12_000
const MAX_EMBEDDED_FRAME_EDGE = 480
const MAX_EMBEDDED_FRAME_SOURCE_EDGE = 16_384
const MAX_EMBEDDED_FRAME_SOURCE_PIXELS = 100_000_000
const MAX_EMBEDDED_FRAME_DATA_URL_LENGTH = 3 * 1024 * 1024
const EMBEDDED_FRAME_READY_TIMEOUT_MS = 1_500
const EMBEDDED_FRAME_CAPTURE_TIMEOUT_MS = 2_500

const IMAGE_CONTENT_TYPES = new Map([
  ['image/avif', '.avif'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/pjpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/x-png', '.png'],
  ['image/webp', '.webp'],
])
const GENERIC_BINARY_CONTENT_TYPES = new Set([
  '',
  'application/binary',
  'application/octet-stream',
  'binary/octet-stream',
])
const WAF_STATUS_CODES = new Set([403, 406, 412, 418, 429])
const XINPIANCHANG_GUESTS = new WeakMap()

const READ_EMBEDDED_VIDEO_FRAME_READY_SCRIPT = `
(() => new Promise((resolve) => {
  const video = Array.from(document.querySelectorAll('video')).find(
    (candidate) =>
      candidate.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      candidate.videoWidth > 0 &&
      candidate.videoHeight > 0 &&
      !candidate.seeking
  )
  if (!video) {
    resolve(false)
    return
  }
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    resolve(
      document.contains(video) &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      !video.seeking
    )
  }
  const timeout = window.setTimeout(finish, 280)
  const finishAfterPaint = () => {
    window.clearTimeout(timeout)
    window.requestAnimationFrame(() => window.requestAnimationFrame(finish))
  }
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(finishAfterPaint)
  } else {
    finishAfterPaint()
  }
}))()
`

class XinpianchangSearchUnavailableError extends Error {
  constructor(reason = 'unavailable') {
    super(
      reason === 'waf'
        ? '新片场官方搜索暂时不可用：官方网站要求浏览器验证，请稍后重试。'
        : '新片场官方搜索暂时不可用，请稍后重试。',
    )
    this.name = 'XinpianchangSearchUnavailableError'
    this.code = XINPIANCHANG_SEARCH_UNAVAILABLE_CODE
    this.reason = reason
    this.retryable = true
  }
}

function boundedText(value, maximumLength) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength)
}

function parseSecureUrl(value) {
  if (typeof value !== 'string' || value.length > 4_096) return null
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== '443')
    ) return null
    return parsed
  } catch {
    return null
  }
}

function normalizeArticleId(value) {
  const normalized = typeof value === 'number'
    ? (Number.isSafeInteger(value) ? String(value) : '')
    : String(value ?? '').trim()
  return ARTICLE_ID_PATTERN.test(normalized) ? normalized : null
}

function createXinpianchangArticleUrl(articleId) {
  const normalized = normalizeArticleId(articleId)
  if (!normalized) throw new TypeError('A valid XinPianChang article ID is required')
  return `https://${XINPIANCHANG_HOST}/a${normalized}`
}

function createXinpianchangPlaybackUrl(articleId) {
  const normalized = normalizeArticleId(articleId)
  if (!normalized) throw new TypeError('A valid XinPianChang article ID is required')
  return `https://${XINPIANCHANG_HOST}/iframe/a${normalized}`
}

function parseXinpianchangArticleUrl(value) {
  const parsed = parseSecureUrl(value)
  if (
    !parsed || parsed.hostname.toLowerCase() !== XINPIANCHANG_HOST ||
    parsed.search || parsed.hash
  ) return null
  const match = parsed.pathname.match(/^\/a([1-9][0-9]{0,15})\/?$/)
  if (!match) return null
  const articleId = match[1]
  const canonicalUrl = createXinpianchangArticleUrl(articleId)
  return {
    source: 'xinpianchang',
    kind: 'video',
    mediaId: articleId,
    articleId,
    url: canonicalUrl,
    canonicalUrl,
  }
}

function parseXinpianchangPlaybackUrl(value) {
  const parsed = parseSecureUrl(value)
  if (
    !parsed || parsed.hostname.toLowerCase() !== XINPIANCHANG_HOST ||
    parsed.search || parsed.hash
  ) return null
  const match = parsed.pathname.match(/^\/iframe\/a([1-9][0-9]{0,15})\/?$/)
  if (!match) return null
  return createXinpianchangPlaybackTarget(match[1])
}

function parseXinpianchangPlayerNavigationUrl(value) {
  const parsed = parseSecureUrl(value)
  if (
    !parsed || parsed.hostname.toLowerCase() !== XINPIANCHANG_PLAYER_HOST ||
    parsed.pathname !== '/' || parsed.hash
  ) return null
  const entries = [...parsed.searchParams.entries()]
  if (
    entries.length !== 2 ||
    parsed.searchParams.getAll('aid').length !== 1 ||
    parsed.searchParams.getAll('mid').length !== 1
  ) return null
  const articleId = normalizeArticleId(parsed.searchParams.get('aid'))
  const mid = parsed.searchParams.get('mid') ?? ''
  if (!articleId || !PLAYER_MID_PATTERN.test(mid)) return null

  // Deliberately return only stable identifiers. `mid` is a transient player
  // capability and must never cross Aurora's provider boundary.
  return createXinpianchangPlaybackTarget(articleId)
}

function createXinpianchangPlaybackTarget(articleId) {
  const normalized = normalizeArticleId(articleId)
  if (!normalized) throw new TypeError('A valid XinPianChang article ID is required')
  return {
    source: 'xinpianchang',
    kind: 'video',
    mediaId: normalized,
    articleId: normalized,
    url: createXinpianchangPlaybackUrl(normalized),
    canonicalUrl: createXinpianchangArticleUrl(normalized),
  }
}

function normalizeCoverUrl(value) {
  const parsed = parseSecureUrl(value)
  if (!parsed || parsed.hash) return null
  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname !== 'cs.xinpianchang.com' &&
    hostname !== 'oss-xpc0.xpccdn.com' &&
    !hostname.endsWith('.xpccdn.com')
  ) return null
  return parsed.toString()
}

function createXinpianchangManagedCoverInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const mediaId = normalizeArticleId(value.articleId ?? value.mediaId)
  const remoteUrl = normalizeCoverUrl(value.coverUrl ?? value.remoteUrl)
  if (!mediaId || !remoteUrl) return null
  return {
    provider: 'xinpianchang',
    kind: 'video',
    mediaId,
    remoteUrl,
  }
}

function normalizePage(value) {
  const page = Number(value ?? 1)
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new TypeError('XinPianChang search page is out of range')
  }
  return page
}

function normalizeLimit(value) {
  const limit = Number(value ?? DEFAULT_LIMIT)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TypeError('XinPianChang search limit is out of range')
  }
  return limit
}

function createXinpianchangSearchUrl(query, page = 1) {
  const normalizedQuery = boundedText(query, MAX_QUERY_LENGTH)
  if (!normalizedQuery) {
    throw new TypeError('A non-empty XinPianChang search query is required')
  }
  const normalizedPage = normalizePage(page)
  // Public JSON endpoint used by XinPianChang's official app. The www search
  // page is protected by an interactive WAF and cannot be queried in the
  // background without incorrectly trying to bypass that verification.
  const target = new URL(`https://${XINPIANCHANG_API_HOST}/search`)
  target.searchParams.set('type', 'article')
  target.searchParams.set('kw', normalizedQuery)
  target.searchParams.set('page', String(normalizedPage))
  return target.toString()
}

function isAllowedSearchResponseUrl(value) {
  const parsed = parseSecureUrl(value)
  if (
    !parsed || parsed.hostname.toLowerCase() !== XINPIANCHANG_API_HOST ||
    parsed.hash
  ) {
    return false
  }
  if (parsed.pathname !== '/search') {
    return false
  }
  const allowedKeys = new Set(['kw', 'page', 'type', 'sort', 'allow_download'])
  for (const [key] of parsed.searchParams) {
    if (!allowedKeys.has(key)) return false
  }
  const pages = parsed.searchParams.getAll('page')
  if (pages.length > 1 || (pages.length === 1 && !/^[1-9][0-9]{0,3}$/.test(pages[0]))) {
    return false
  }
  const types = parsed.searchParams.getAll('type')
  if (types.length > 1 || (types.length === 1 && types[0] !== 'article')) {
    return false
  }
  return true
}

function normalizeInteger(value) {
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= 0 ? result : null
}

function normalizeDuration(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 31_536_000) return null
  return Math.round(seconds)
}

function normalizePublishedAt(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const time = Date.parse(value)
    return Number.isFinite(time) ? new Date(time).toISOString() : null
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  const milliseconds = number > 10_000_000_000 ? number : number * 1_000
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return []
  const tags = []
  const seen = new Set()
  const append = (candidate) => {
    const tag = boundedText(candidate, 40)
    const key = tag.toLocaleLowerCase()
    if (!tag || seen.has(key) || tags.length >= 12) return
    seen.add(key)
    tags.push(tag)
  }
  for (const entry of value) {
    if (typeof entry === 'string') {
      append(entry)
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    append(entry.category_name ?? entry.categoryName ?? entry.name)
    const sub = entry.sub
    if (Array.isArray(sub)) {
      for (const child of sub) append(child?.category_name ?? child?.name)
    } else if (sub && typeof sub === 'object') {
      append(sub.category_name ?? sub.name)
    }
  }
  return tags
}

function articleCandidateFromEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  if (entry.article && typeof entry.article === 'object') {
    return { raw: entry.article, wrapperType: entry.type }
  }
  return { raw: entry, wrapperType: null }
}

function isWorkArticle(raw, wrapperType) {
  const forbidden = [
    wrapperType,
    raw.type,
    raw.resource_type_name,
    raw.resourceTypeName,
    raw.product_type,
  ].some((value) => /stock|material|goods|product|素材|商品/i.test(String(value ?? '')))
  if (forbidden || raw.goods_id || raw.product_id || raw.stock_id) return false

  const marker = raw.resource_type ?? raw.resourceType ?? wrapperType
  if (marker !== undefined && marker !== null && marker !== '') {
    const normalized = String(marker).toLowerCase()
    if (!['1', 'article', 'work', 'video'].includes(normalized)) return false
  }
  return true
}

function normalizeArticle(entry) {
  const candidate = articleCandidateFromEntry(entry)
  if (!candidate || !isWorkArticle(candidate.raw, candidate.wrapperType)) return null
  const raw = candidate.raw
  const articleId = normalizeArticleId(raw.id ?? raw.article_id ?? raw.articleId)
  if (!articleId) return null

  const suppliedUrl = raw.web_url ?? raw.webUrl ?? raw.url
  if (suppliedUrl) {
    const parsed = parseXinpianchangArticleUrl(suppliedUrl)
    if (!parsed || parsed.articleId !== articleId) return null
  } else if (
    raw.resource_type === undefined && raw.resourceType === undefined &&
    candidate.wrapperType === null
  ) {
    return null
  }

  const title = boundedText(raw.title ?? raw.name, 240)
  if (!title) return null
  const coverUrl = normalizeCoverUrl(
    raw.cover ?? raw.cover_url ?? raw.coverUrl ?? raw.thumbnail,
  )
  const authorInfo = raw.author?.userinfo ?? raw.author?.userInfo ?? raw.author
  const author = boundedText(
    authorInfo?.username ?? authorInfo?.name ?? raw.username,
    120,
  )
  const canonicalUrl = createXinpianchangArticleUrl(articleId)
  return {
    source: 'xinpianchang',
    kind: 'video',
    mediaId: articleId,
    articleId,
    url: canonicalUrl,
    canonicalUrl,
    playbackUrl: createXinpianchangPlaybackUrl(articleId),
    title,
    description: boundedText(raw.content ?? raw.description ?? raw.summary, 1_000),
    author,
    publishedAt: normalizePublishedAt(
      raw.publish_time ?? raw.publishTime ?? raw.published_at ?? raw.created_at,
    ),
    durationSeconds: normalizeDuration(raw.duration),
    tags: normalizeTags(raw.categories ?? raw.tags),
    coverUrl,
    thumbnailPath: null,
  }
}

function findSearchData(payload) {
  const candidates = [
    payload?.pageProps?.searchData,
    payload?.pageProps?.data?.searchData,
    payload?.pageProps?.data,
    payload?.searchData,
    payload?.data?.searchData,
    payload?.data,
    payload,
  ]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const lists = [
      candidate.list,
      candidate.articles,
      candidate.article_list,
      candidate.articleList,
      candidate.result?.list,
      candidate.articles?.list,
      candidate.data?.list,
    ]
    const list = lists.find(Array.isArray)
    if (list) return { data: candidate, list }
  }
  return null
}

function readPaginationValue(data, keys) {
  const sources = [data, data?.meta, data?.pagination]
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of keys) {
      if (source[key] !== undefined) return source[key]
    }
  }
  return undefined
}

function readArticleTotal(data) {
  const value = readPaginationValue(data, ['total', 'total_count', 'totalCount'])
  if (value && typeof value === 'object') {
    return normalizeInteger(value.article ?? value.articles ?? value.work ?? value.video)
  }
  return normalizeInteger(value)
}

function nextPageFromUrl(value, currentPage) {
  if (typeof value !== 'string') return null
  let resolved
  try {
    resolved = new URL(value, `https://${XINPIANCHANG_API_HOST}/search`).toString()
  } catch {
    return null
  }
  if (!isAllowedSearchResponseUrl(resolved)) return null
  const parsed = new URL(resolved)
  const nextPage = normalizeInteger(parsed.searchParams.get('page'))
  return nextPage && nextPage > currentPage && nextPage <= MAX_PAGE ? nextPage : null
}

function normalizeXinpianchangSearchPayload(payload, request) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('XinPianChang search payload must be an object')
  }
  const query = boundedText(request?.query, MAX_QUERY_LENGTH)
  if (!query) throw new TypeError('A non-empty XinPianChang search query is required')
  const page = normalizePage(request?.page)
  const limit = normalizeLimit(request?.limit)
  const found = findSearchData(payload)
  if (!found) throw new Error('XinPianChang search response has no work list')

  const results = []
  const seen = new Set()
  for (const entry of found.list) {
    const descriptor = normalizeArticle(entry)
    if (!descriptor || seen.has(descriptor.articleId)) continue
    seen.add(descriptor.articleId)
    results.push(descriptor)
    if (results.length >= limit) break
  }

  const remotePage = normalizeInteger(
    readPaginationValue(found.data, ['page', 'current_page', 'currentPage']),
  )
  const paginationMatches = remotePage === null || remotePage === page
  let nextPage = null
  if (paginationMatches) {
    nextPage = nextPageFromUrl(
      readPaginationValue(found.data, ['next_page_url', 'nextPageUrl']),
      page,
    )
    if (!nextPage) {
      const explicitNext = normalizeInteger(
        readPaginationValue(found.data, ['next_page', 'nextPage']),
      )
      if (explicitNext && explicitNext > page && explicitNext <= MAX_PAGE) {
        nextPage = explicitNext
      }
    }
    if (!nextPage) {
      const lastPage = normalizeInteger(
        readPaginationValue(found.data, [
          'last_page', 'lastPage', 'total_page', 'totalPage',
          'total_pages', 'totalPages', 'page_count', 'pageCount',
        ]),
      )
      if (lastPage && page < lastPage) nextPage = page + 1
    }
  }

  const visibleFloor = (page - 1) * limit + results.length
  const reportedTotal = paginationMatches ? readArticleTotal(found.data) : null
  const totalCount = Math.max(reportedTotal ?? visibleFloor, visibleFloor)
  return {
    query,
    page,
    pageSize: limit,
    totalCount,
    hasMore: nextPage !== null,
    nextPage,
    results,
  }
}

function looksLikeWaf(status, text) {
  if (WAF_STATUS_CODES.has(status)) return true
  return /captcha|challenge|access denied|安全验证|验证码|访问异常|FAIL_SYS_USER_VALIDATE/i
    .test(text)
}

async function readResponseBytes(response, maximumBytes) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error('XinPianChang response exceeds the size limit')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maximumBytes) {
    throw new Error('XinPianChang response exceeds the size limit')
  }
  return bytes
}

function sniffImageExtension(bytes) {
  if (!(bytes instanceof Uint8Array)) return null
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  ) return '.jpg'
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return '.png'
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
  ) return '.webp'
  if (
    bytes.byteLength >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (brand === 'avif' || brand === 'avis') return '.avif'
  }
  return null
}

function resolveCoverExtension(contentType, bytes) {
  const normalizedType = String(contentType ?? '')
    .split(';', 1)[0].trim().toLowerCase()
  const declaredExtension = IMAGE_CONTENT_TYPES.get(normalizedType)
  if (declaredExtension) return declaredExtension
  // Some official XinPianChang CDN objects are JPEG images served as generic
  // binary data. Accept those only after both the URL host has passed the
  // provider allow-list and the bytes contain a supported image signature.
  return GENERIC_BINARY_CONTENT_TYPES.has(normalizedType)
    ? sniffImageExtension(bytes)
    : null
}

function extractNextData(text) {
  const match = text.match(
    /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  )
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function parseSearchResponse(bytes, contentType, status) {
  const text = new TextDecoder().decode(bytes)
  if (looksLikeWaf(status, text)) {
    throw new XinpianchangSearchUnavailableError('waf')
  }
  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    try {
      return JSON.parse(text)
    } catch {
      throw new XinpianchangSearchUnavailableError('invalid-response')
    }
  }
  const payload = extractNextData(text)
  if (!payload) throw new XinpianchangSearchUnavailableError('invalid-response')
  return payload
}

function isAllowedXinpianchangAuthNavigationUrl(value) {
  const parsed = parseSecureUrl(value)
  if (!parsed) return false
  const hostname = parsed.hostname.toLowerCase()
  return hostname === XINPIANCHANG_HOST ||
    hostname === XINPIANCHANG_API_HOST ||
    hostname === XINPIANCHANG_PASSPORT_HOST ||
    hostname === 'universal.xinpianchang.com'
}

function parseXinpianchangAuthStatePayload(payload) {
  const user = payload?.data
  const userId = normalizeArticleId(user?.id ?? user?.userid ?? user?.user_id)
  return {
    signedIn: payload?.status === 0 && Boolean(userId),
  }
}

function partitionOf(sessionObject) {
  try {
    return sessionObject?.getPartition?.() ?? ''
  } catch {
    return ''
  }
}

function hardenWebPreferences(webPreferences, expectedSession) {
  webPreferences.partition = XINPIANCHANG_PARTITION
  if (expectedSession) webPreferences.session = expectedSession
  else delete webPreferences.session
  delete webPreferences.preload
  delete webPreferences.preloadURL
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.nodeIntegrationInWorker = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
  webPreferences.webviewTag = false
  webPreferences.devTools = false
}

function destroyGuest(guest) {
  if (!guest || guest.isDestroyed?.()) return
  try { guest.destroy?.() } catch { /* The guest may disappear during navigation. */ }
}

function installXinpianchangPlayerWebviewGuard(hostContents, expectedSession = null) {
  if (!hostContents?.on) throw new TypeError('Host webContents is required')
  const pendingTargets = []
  const installation = {
    activeGuest: null,
    activeTarget: null,
    disposed: false,
  }

  const handleWillAttach = (event, webPreferences = {}, params = {}) => {
    const preferencePartition = String(webPreferences.partition ?? '')
    const parameterPartition = String(params.partition ?? '')
    if (
      preferencePartition !== XINPIANCHANG_PARTITION &&
      parameterPartition !== XINPIANCHANG_PARTITION
    ) return
    const suppliedSession = webPreferences.session
    hardenWebPreferences(webPreferences, expectedSession)
    const target = parseXinpianchangPlaybackUrl(params.src)
    if (
      preferencePartition !== XINPIANCHANG_PARTITION ||
      parameterPartition !== XINPIANCHANG_PARTITION ||
      !target ||
      (expectedSession && suppliedSession && suppliedSession !== expectedSession) ||
      (expectedSession && webPreferences.session !== expectedSession) ||
      (!expectedSession && suppliedSession &&
        partitionOf(suppliedSession) !== XINPIANCHANG_PARTITION)
    ) {
      event.preventDefault()
      return
    }
    pendingTargets.push(target)
  }

  const handleAttached = (_event, guest) => {
    // Electron's real Session object does not expose getPartition().  Runtime
    // installation always supplies the dedicated persistent Session, so use
    // object identity as the authority there.  Keep the partition probe only
    // for isolated callers that do not provide an expected Session.
    const ownsExpectedSession = expectedSession
      ? guest?.session === expectedSession
      : partitionOf(guest?.session) === XINPIANCHANG_PARTITION
    if (!ownsExpectedSession) return
    const initialTarget = pendingTargets.shift() ??
      parseXinpianchangPlaybackUrl(guest.getURL?.())
    if (!initialTarget) {
      destroyGuest(guest)
      return
    }
    installation.activeGuest = guest
    installation.activeTarget = initialTarget
    guest.once?.('destroyed', () => {
      if (installation.activeGuest === guest) {
        installation.activeGuest = null
        installation.activeTarget = null
      }
    })

    const navigationTarget = (url) => {
      const direct = parseXinpianchangPlaybackUrl(url)
      if (direct?.articleId === initialTarget.articleId) return direct
      const redirected = parseXinpianchangPlayerNavigationUrl(url)
      return redirected?.articleId === initialTarget.articleId ? redirected : null
    }
    const guardNavigation = (event, url) => {
      if (!navigationTarget(url)) event.preventDefault()
    }
    const enforceNavigation = (_event, url) => {
      if (navigationTarget(url) || guest.isDestroyed?.()) return
      void guest.loadURL?.(initialTarget.url).catch?.(() => undefined)
    }
    const denyNestedWebview = (event) => event.preventDefault()
    guest.on?.('will-navigate', guardNavigation)
    guest.on?.('will-redirect', guardNavigation)
    guest.on?.('did-navigate', enforceNavigation)
    guest.on?.('will-attach-webview', denyNestedWebview)
    guest.setWindowOpenHandler?.(() => ({ action: 'deny' }))
  }

  hostContents.on('will-attach-webview', handleWillAttach)
  hostContents.on('did-attach-webview', handleAttached)
  XINPIANCHANG_GUESTS.set(hostContents, installation)
  return () => {
    if (installation.disposed) return
    installation.disposed = true
    pendingTargets.length = 0
    installation.activeGuest = null
    installation.activeTarget = null
    hostContents.removeListener?.('will-attach-webview', handleWillAttach)
    hostContents.removeListener?.('did-attach-webview', handleAttached)
    if (XINPIANCHANG_GUESTS.get(hostContents) === installation) {
      XINPIANCHANG_GUESTS.delete(hostContents)
    }
  }
}

function normalizeEmbeddedFrameCaptureRequest(request) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).sort().join(',') !== 'kind,mediaId' ||
    request.kind !== 'video'
  ) return null
  const mediaId = normalizeArticleId(request.mediaId)
  return mediaId ? { kind: 'video', mediaId } : null
}

function parseXinpianchangEmbeddedNavigationTarget(value) {
  return parseXinpianchangPlaybackUrl(value) ??
    parseXinpianchangPlayerNavigationUrl(value)
}

function settleEmbeddedFrameOperation(operation, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(null)
    }, timeoutMs)
    Promise.resolve(operation).then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

function readEmbeddedFrameImageSize(image) {
  const size = image?.getSize?.()
  const width = size?.width
  const height = size?.height
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_EMBEDDED_FRAME_SOURCE_EDGE ||
    height > MAX_EMBEDDED_FRAME_SOURCE_EDGE ||
    width * height > MAX_EMBEDDED_FRAME_SOURCE_PIXELS
  ) return null
  return { width, height }
}

async function captureXinpianchangEmbeddedFrame(hostContents, request) {
  const normalizedRequest = normalizeEmbeddedFrameCaptureRequest(request)
  const installation = hostContents && typeof hostContents === 'object'
    ? XINPIANCHANG_GUESTS.get(hostContents)
    : null
  const guest = installation?.activeGuest
  const target = installation?.activeTarget
  const currentTarget = guest && typeof guest.getURL === 'function'
    ? parseXinpianchangEmbeddedNavigationTarget(guest.getURL())
    : null
  if (
    !normalizedRequest ||
    !installation ||
    installation.disposed ||
    !guest ||
    guest.isDestroyed?.() === true ||
    !target ||
    target.kind !== normalizedRequest.kind ||
    target.mediaId !== normalizedRequest.mediaId ||
    currentTarget?.articleId !== normalizedRequest.mediaId ||
    typeof guest.executeJavaScript !== 'function' ||
    typeof guest.capturePage !== 'function'
  ) return null

  try {
    const ready = await settleEmbeddedFrameOperation(
      guest.executeJavaScript(READ_EMBEDDED_VIDEO_FRAME_READY_SCRIPT, true),
      EMBEDDED_FRAME_READY_TIMEOUT_MS,
    )
    if (
      ready !== true ||
      installation.activeGuest !== guest ||
      guest.isDestroyed?.() === true
    ) return null

    let image = await settleEmbeddedFrameOperation(
      guest.capturePage(),
      EMBEDDED_FRAME_CAPTURE_TIMEOUT_MS,
    )
    if (
      installation.activeGuest !== guest ||
      guest.isDestroyed?.() === true ||
      !image ||
      image.isEmpty?.() !== false
    ) return null

    let size = readEmbeddedFrameImageSize(image)
    if (!size) return null
    if (Math.max(size.width, size.height) > MAX_EMBEDDED_FRAME_EDGE) {
      image = image.resize?.(
        size.width >= size.height
          ? { width: MAX_EMBEDDED_FRAME_EDGE, quality: 'good' }
          : { height: MAX_EMBEDDED_FRAME_EDGE, quality: 'good' },
      )
      if (!image || image.isEmpty?.() !== false) return null
      size = readEmbeddedFrameImageSize(image)
      if (!size || Math.max(size.width, size.height) > MAX_EMBEDDED_FRAME_EDGE) {
        return null
      }
    }
    const dataUrl = image.toDataURL?.()
    return typeof dataUrl === 'string' &&
      dataUrl.length <= MAX_EMBEDDED_FRAME_DATA_URL_LENGTH &&
      /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)
      ? dataUrl
      : null
  } catch {
    return null
  }
}

function createXinpianchangSessionManager({
  BrowserWindow,
  sessionModule,
  getParentWindow = () => null,
  cacheDirectory,
  onAuthStateChange = () => undefined,
} = {}) {
  if (typeof BrowserWindow !== 'function') {
    throw new TypeError('BrowserWindow is required')
  }
  if (!sessionModule?.fromPartition) {
    throw new TypeError('Electron session module is required')
  }
  if (cacheDirectory !== undefined && cacheDirectory !== null) {
    if (typeof cacheDirectory !== 'string' || !path.isAbsolute(cacheDirectory)) {
      throw new TypeError('XinPianChang cover cache directory must be absolute')
    }
  }

  const sharedSession = sessionModule.fromPartition(
    XINPIANCHANG_PARTITION,
    { cache: true },
  )
  const normalizedCacheDirectory = cacheDirectory || null
  const coverTasks = new Map()
  let loginWindow = null
  let disposed = false
  let lastSignedIn = null
  let authCheckTimer = null
  let suppressAuthEmission = false

  const isAllowedFullscreenTarget = (value) => {
    const parsed = parseSecureUrl(value)
    if (!parsed) return false
    const hostname = parsed.hostname.toLowerCase()
    if (hostname === XINPIANCHANG_HOST) {
      return (
        (parsed.pathname === '/' && !parsed.search && !parsed.hash) ||
        Boolean(parseXinpianchangPlaybackUrl(value))
      )
    }
    if (hostname === XINPIANCHANG_PLAYER_HOST) {
      return (
        (parsed.pathname === '/' && !parsed.search && !parsed.hash) ||
        Boolean(parseXinpianchangPlayerNavigationUrl(value))
      )
    }
    return false
  }
  sharedSession.setPermissionCheckHandler?.((_, permission, origin) => (
    permission === 'fullscreen' && isAllowedFullscreenTarget(origin)
  ))
  sharedSession.setPermissionRequestHandler?.((contents, permission, callback) => {
    const allowed = permission === 'fullscreen' && isAllowedFullscreenTarget(
      contents?.getURL?.() ?? '',
    )
    callback(Boolean(allowed))
  })

  const handleDownload = (event, item) => {
    event.preventDefault?.()
    item?.cancel?.()
  }
  sharedSession.on?.('will-download', handleDownload)

  const flushSession = async () => {
    await Promise.allSettled([
      sharedSession.cookies?.flushStore?.(),
      sharedSession.flushStorageData?.(),
    ])
  }

  const getAuthState = async () => {
    try {
      const response = await sharedSession.fetch(XINPIANCHANG_AUTH_STATE_URL, {
        credentials: 'include',
        redirect: 'manual',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) return { signedIn: false }
      const contentType = String(response.headers?.get?.('content-type') ?? '')
        .split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json' && !contentType.endsWith('+json')) {
        return { signedIn: false }
      }
      const bytes = await readResponseBytes(response, 1024 * 1024)
      return parseXinpianchangAuthStatePayload(
        JSON.parse(new TextDecoder().decode(bytes)),
      )
    } catch {
      return { signedIn: false }
    }
  }

  const emitAuthState = async (force = false) => {
    if (disposed || suppressAuthEmission) return
    const state = await getAuthState()
    if (force || state.signedIn !== lastSignedIn) {
      lastSignedIn = state.signedIn
      onAuthStateChange(state)
    }
    if (state.signedIn && loginWindow && !loginWindow.isDestroyed?.()) {
      await flushSession()
      loginWindow.close()
    }
  }

  const scheduleAuthStateCheck = () => {
    if (disposed || suppressAuthEmission) return
    if (authCheckTimer) clearTimeout(authCheckTimer)
    authCheckTimer = setTimeout(() => {
      authCheckTimer = null
      void emitAuthState().catch(() => undefined)
    }, 120)
  }
  const handleCookieChanged = () => scheduleAuthStateCheck()
  sharedSession.cookies?.on?.('changed', handleCookieChanged)

  const focusWindow = (windowInstance) => {
    if (!windowInstance || windowInstance.isDestroyed?.()) return false
    if (windowInstance.isMinimized?.()) windowInstance.restore?.()
    windowInstance.show?.()
    windowInstance.focus?.()
    return true
  }

  const guardLoginContents = (contents) => {
    const guardNavigation = (event, value) => {
      if (!isAllowedXinpianchangAuthNavigationUrl(value)) event.preventDefault()
    }
    contents.on?.('will-navigate', guardNavigation)
    contents.on?.('will-redirect', guardNavigation)
    contents.on?.('did-finish-load', scheduleAuthStateCheck)
    contents.on?.('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler?.(({ url }) => {
      if (isAllowedXinpianchangAuthNavigationUrl(url)) {
        setImmediate(() => {
          if (!contents.isDestroyed?.()) {
            void contents.loadURL?.(url).catch?.(() => undefined)
          }
        })
      }
      return { action: 'deny' }
    })
  }

  const keepWindowed = (windowInstance) => {
    const forceWindowed = () => {
      if (windowInstance.isDestroyed?.()) return
      windowInstance.setKiosk?.(false)
      windowInstance.setSimpleFullScreen?.(false)
      windowInstance.setFullScreen?.(false)
    }
    windowInstance.setFullScreenable?.(false)
    forceWindowed()
    windowInstance.on?.('enter-full-screen', forceWindowed)
    windowInstance.webContents.on?.('enter-html-full-screen', forceWindowed)
  }

  const openLogin = async () => {
    if (disposed) throw new Error('XinPianChang session manager is disposed')
    if (focusWindow(loginWindow)) return getAuthState()
    const parent = getParentWindow?.()
    loginWindow = new BrowserWindow({
      width: 720,
      height: 560,
      minWidth: 655,
      minHeight: 470,
      parent: parent && !parent.isDestroyed?.() ? parent : undefined,
      modal: false,
      show: false,
      frame: true,
      closable: true,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      title: '登录新片场',
      backgroundColor: '#080b11',
      autoHideMenuBar: true,
      webPreferences: {
        session: sharedSession,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
      },
    })
    const target = loginWindow
    guardLoginContents(target.webContents)
    keepWindowed(target)
    target.once?.('ready-to-show', () => target.show?.())
    target.once?.('closed', () => {
      if (loginWindow === target) loginWindow = null
      void flushSession()
    })
    await target.loadURL(XINPIANCHANG_LOGIN_URL)
    target.show?.()
    return getAuthState()
  }

  const closeWindows = () => {
    if (loginWindow && !loginWindow.isDestroyed?.()) loginWindow.close()
    loginWindow = null
  }

  const logout = async () => {
    suppressAuthEmission = true
    try {
      closeWindows()
      await sharedSession.closeAllConnections?.()
      if (typeof sharedSession.clearData === 'function') {
        await sharedSession.clearData()
      } else {
        await sharedSession.clearStorageData?.()
        await sharedSession.clearCache?.()
      }
      await flushSession()
    } finally {
      suppressAuthEmission = false
    }
    lastSignedIn = false
    const state = { signedIn: false }
    onAuthStateChange(state)
    return state
  }

  const findCachedCover = async (key) => {
    if (!normalizedCacheDirectory) return null
    for (const extension of IMAGE_CONTENT_TYPES.values()) {
      const candidate = path.join(normalizedCacheDirectory, `${key}${extension}`)
      try {
        const stat = await fs.stat(candidate)
        if (stat.isFile() && stat.size > 0 && stat.size <= MAX_COVER_BYTES) {
          return candidate
        }
      } catch {
        // Cache miss.
      }
    }
    return null
  }

  const fetchCoverResponse = async (remoteUrl, signal) => {
    let target = remoteUrl
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      if (!normalizeCoverUrl(target)) return null
      const response = await sharedSession.fetch(target, {
        credentials: 'omit',
        redirect: 'manual',
        signal,
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location')
        if (!location || redirects === MAX_REDIRECTS) return null
        try { target = new URL(location, target).toString() } catch { return null }
        continue
      }
      return response.ok ? response : null
    }
    return null
  }

  const cacheManagedCover = async (input, signal) => {
    const normalizedInput = createXinpianchangManagedCoverInput(input)
    if (!normalizedInput || !normalizedCacheDirectory) return null
    const taskKey = `${normalizedInput.mediaId}:${normalizedInput.remoteUrl}`
    if (coverTasks.has(taskKey)) return coverTasks.get(taskKey)
    const task = (async () => {
      await fs.mkdir(normalizedCacheDirectory, { recursive: true, mode: 0o700 })
      const key = crypto.createHash('sha256')
        .update(taskKey)
        .digest('hex')
      const existing = await findCachedCover(key)
      if (existing) return existing
      const response = await fetchCoverResponse(normalizedInput.remoteUrl, signal)
      if (!response) return null
      const contentType = String(response.headers?.get?.('content-type') ?? '')
        .split(';', 1)[0].trim().toLowerCase()
      const bytes = await readResponseBytes(response, MAX_COVER_BYTES)
      if (bytes.byteLength === 0) return null
      const extension = resolveCoverExtension(contentType, bytes)
      if (!extension) return null
      const destination = path.join(normalizedCacheDirectory, `${key}${extension}`)
      const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
      try {
        await fs.writeFile(temporary, bytes, { mode: 0o600 })
        await fs.rename(temporary, destination)
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => undefined)
      }
      return destination
    })().catch(() => null).finally(() => coverTasks.delete(taskKey))
    coverTasks.set(taskKey, task)
    return task
  }

  const fetchSearchResponse = async (searchUrl, signal) => {
    let target = searchUrl
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      if (!isAllowedSearchResponseUrl(target)) {
        throw new XinpianchangSearchUnavailableError('unsafe-redirect')
      }
      const response = await sharedSession.fetch(target, {
        credentials: 'include',
        redirect: 'manual',
        signal,
        headers: { Accept: 'application/json' },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location')
        if (!location || redirects === MAX_REDIRECTS) {
          throw new XinpianchangSearchUnavailableError('redirect')
        }
        try { target = new URL(location, target).toString() } catch {
          throw new XinpianchangSearchUnavailableError('unsafe-redirect')
        }
        continue
      }
      const bytes = await readResponseBytes(response, MAX_RESPONSE_BYTES)
      const contentType = String(response.headers?.get?.('content-type') ?? '')
        .split(';', 1)[0].trim().toLowerCase()
      if (!response.ok) {
        const text = new TextDecoder().decode(bytes)
        throw new XinpianchangSearchUnavailableError(
          looksLikeWaf(response.status, text) ? 'waf' : 'rejected',
        )
      }
      if (!['text/html', 'application/xhtml+xml', 'application/json']
        .some((type) => contentType === type || contentType.endsWith('+json'))) {
        throw new XinpianchangSearchUnavailableError('invalid-response')
      }
      return { bytes, contentType, status: response.status }
    }
    throw new XinpianchangSearchUnavailableError('redirect')
  }

  const searchVideos = async (request) => {
    const allowedKeys = new Set(['query', 'page', 'limit'])
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('XinPianChang search request must be an object')
    }
    if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
      throw new TypeError('XinPianChang search request contains unsupported fields')
    }
    const query = boundedText(request.query, MAX_QUERY_LENGTH)
    if (!query) throw new TypeError('A non-empty XinPianChang search query is required')
    const page = normalizePage(request.page)
    const limit = normalizeLimit(request.limit)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
    try {
      const response = await fetchSearchResponse(
        createXinpianchangSearchUrl(query, page),
        controller.signal,
      )
      const normalized = normalizeXinpianchangSearchPayload(
        parseSearchResponse(response.bytes, response.contentType, response.status),
        { query, page, limit },
      )
      normalized.results = await Promise.all(normalized.results.map(async (descriptor) => ({
        ...descriptor,
        thumbnailPath: await cacheManagedCover({
          articleId: descriptor.articleId,
          coverUrl: descriptor.coverUrl,
        }, controller.signal),
      })))
      return normalized
    } catch (error) {
      if (error instanceof XinpianchangSearchUnavailableError) throw error
      if (error?.name === 'AbortError') {
        throw new XinpianchangSearchUnavailableError('timeout')
      }
      throw new XinpianchangSearchUnavailableError('network')
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    dispose() {
      if (disposed) return
      disposed = true
      if (authCheckTimer) clearTimeout(authCheckTimer)
      authCheckTimer = null
      closeWindows()
      sharedSession.cookies?.removeListener?.('changed', handleCookieChanged)
      sharedSession.removeListener?.('will-download', handleDownload)
      void flushSession()
    },
    closeWindows,
    flushSession,
    getAuthState,
    logout,
    openLogin,
    searchVideos,
  }
}

module.exports = {
  XINPIANCHANG_PARTITION,
  XINPIANCHANG_AUTH_STATE_URL,
  XINPIANCHANG_LOGIN_URL,
  XINPIANCHANG_SEARCH_UNAVAILABLE_CODE,
  XinpianchangSearchUnavailableError,
  captureXinpianchangEmbeddedFrame,
  createXinpianchangArticleUrl,
  createXinpianchangManagedCoverInput,
  createXinpianchangPlaybackTarget,
  createXinpianchangPlaybackUrl,
  createXinpianchangSearchUrl,
  createXinpianchangSessionManager,
  installXinpianchangPlayerWebviewGuard,
  normalizeXinpianchangSearchPayload,
  parseXinpianchangAuthStatePayload,
  parseXinpianchangArticleUrl,
  parseXinpianchangPlaybackUrl,
  parseXinpianchangPlayerNavigationUrl,
}
