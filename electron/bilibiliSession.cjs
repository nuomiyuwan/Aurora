const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const BILIBILI_PARTITION = 'persist:aurora-bilibili-v1'
const BILIBILI_LOGIN_URL = 'https://passport.bilibili.com/login'
const BILIBILI_EMBEDDED_PAGE_HOST = 'www.bilibili.com'
const BILIBILI_OFFICIAL_PLAYER_FRAME_HOST = 'player.bilibili.com'
const BILIBILI_SEASON_API_HOST = 'api.bilibili.com'
const BILIBILI_SEASON_API_PATH = '/pgc/view/web/season'
const BILIBILI_WBI_NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'
const BILIBILI_AUTH_COOKIE_NAME = 'SESSDATA'
const MAX_SEARCH_QUERY_LENGTH = 160
const DEFAULT_SEARCH_RESULT_LIMIT = 12
const MAX_SEARCH_RESULT_LIMIT = 18
const MAX_SEARCH_PAGE = 1_000
const MAX_SEARCH_REMOTE_PAGE_SIZE = 1_000
const MAX_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024
const SEARCH_REQUEST_TIMEOUT_MS = 10_000
const WBI_KEY_CACHE_MS = 10 * 60 * 1_000
const MAX_SEARCH_REDIRECTS = 2
const MAX_COVER_BYTES = 12 * 1024 * 1024
const MAX_SEASON_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_SEASON_EPISODE_IDS = 2_000
const SEASON_REQUEST_TIMEOUT_MS = 10_000
const MAX_EMBEDDED_FRAME_EDGE = 480
const MAX_EMBEDDED_FRAME_SOURCE_EDGE = 16_384
const MAX_EMBEDDED_FRAME_SOURCE_PIXELS = 100_000_000
const MAX_EMBEDDED_FRAME_DATA_URL_LENGTH = 3 * 1024 * 1024
const EMBEDDED_FRAME_READY_TIMEOUT_MS = 1_500
const EMBEDDED_FRAME_CAPTURE_TIMEOUT_MS = 2_500

const BILIBILI_EMBEDDED_GUESTS = new WeakMap()

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

const BILIBILI_NAVIGATION_HOSTS = new Set([
  'account.bilibili.com',
  'bilibili.com',
  'm.bilibili.com',
  'passport.bilibili.com',
  'search.bilibili.com',
  'space.bilibili.com',
  'www.bilibili.com',
])

const BILIBILI_IMAGE_HOSTS = new Set([
  'archive.biliimg.com',
  'i0.hdslb.com',
  'i1.hdslb.com',
  'i2.hdslb.com',
  'static.hdslb.com',
])

const BILIBILI_IMAGE_CONTENT_TYPES = new Map([
  ['image/avif', '.avif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/
const EPISODE_ID_PATTERN = /^(?:ep)?([1-9][0-9]{0,15})$/i

const READ_EMBEDDED_VIDEO_FRAME_READY_SCRIPT = `
(() => new Promise((resolve) => {
  /* aurora-embedded-video-frame-ready */
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

// The official page remains the authority for playback, membership, adverts,
// region checks, and copyright notices. These rules only isolate its player
// root inside Aurora's existing frame. The :has() guard is intentional: if
// Bilibili changes the root selector, the full page remains visible instead of
// the guest turning into an unhelpful blank surface.
const BILIBILI_EMBEDDED_PLAYER_CSS = `
html:has(:is(#bilibili-player-wrap, #playerWrap, #bilibili-player)),
html:has(:is(#bilibili-player-wrap, #playerWrap, #bilibili-player)) body {
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  overflow: hidden !important;
  background: #03060a !important;
}

body:has(:is(#bilibili-player-wrap, #playerWrap, #bilibili-player)) > * {
  visibility: hidden !important;
}

body:has(#bilibili-player-wrap) #bilibili-player-wrap,
body:has(#playerWrap) #playerWrap,
body:has(#bilibili-player) #bilibili-player {
  visibility: visible !important;
  position: fixed !important;
  z-index: 2147483647 !important;
  inset: 0 !important;
  box-sizing: border-box !important;
  width: 100vw !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 100vh !important;
  min-height: 0 !important;
  max-height: none !important;
  margin: 0 !important;
  transform: none !important;
}

body:has(:is(#bilibili-player-wrap, #playerWrap, #bilibili-player))
  :is(#bilibili-player, .bpx-player-container) {
  box-sizing: border-box !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 100% !important;
  min-height: 0 !important;
  max-height: none !important;
  margin: 0 !important;
}

/* Bilibili collapses its own episode control at Aurora's compact player
   width. Keep the official control and menu; Aurora does not recreate or
   intercept episode selection. */
body:has(:is(#bilibili-player-wrap, #bilibili-player))
  .bpx-player-ctrl-eplist {
  display: block !important;
  visibility: visible !important;
  width: auto !important;
  min-width: 36px !important;
}
`

const READ_PUBLIC_VIDEO_META_SCRIPT = `(() => {
  const firstContent = (selectors) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector)
      const value = node?.getAttribute?.('content') ?? node?.getAttribute?.('href')
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
  }
  return {
    pageUrl: location.href,
    canonicalUrl: firstContent(['link[rel="canonical"]']),
    title: firstContent([
      'meta[property="og:title"]',
      'meta[name="title"]',
      'meta[itemprop="name"]',
    ]) || document.title || '',
    description: firstContent([
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[itemprop="description"]',
    ]),
    coverUrl: firstContent([
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[itemprop="thumbnailUrl"]',
    ]),
    author: firstContent([
      'meta[name="author"]',
      'meta[property="video:author"]',
      'meta[itemprop="author"]',
    ]),
  }
})()`

function boundedText(value, maximumLength) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength)
}

function decodeHtmlText(value, maximumLength) {
  if (typeof value !== 'string') return ''
  const withoutMarkup = value.replace(/<[^>]*>/g, '')
  const decoded = withoutMarkup.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, token) => {
      const normalized = String(token).toLowerCase()
      if (normalized === 'amp') return '&'
      if (normalized === 'apos') return "'"
      if (normalized === 'gt') return '>'
      if (normalized === 'lt') return '<'
      if (normalized === 'nbsp') return ' '
      if (normalized === 'quot') return '"'
      const radix = normalized.startsWith('#x') ? 16 : 10
      const digits = normalized.slice(radix === 16 ? 2 : 1)
      const codePoint = Number.parseInt(digits, radix)
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ' '
    },
  )
  return boundedText(decoded, maximumLength)
}

function parseSecureUrl(value) {
  if (typeof value !== 'string' || value.length > 4_096) return null
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== '443')
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function isAllowedBilibiliNavigationUrl(value) {
  const parsed = parseSecureUrl(value)
  return parsed !== null && BILIBILI_NAVIGATION_HOSTS.has(parsed.hostname)
}

function normalizeBvid(value) {
  const normalized = boundedText(value, 32)
  return BVID_PATTERN.test(normalized) ? normalized : null
}

function normalizeEpisodeId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  const normalized = boundedText(value, 32)
  const match = EPISODE_ID_PATTERN.exec(normalized)
  return match ? match[1] : null
}

function parseBilibiliEmbeddedPageUrl(value) {
  const parsed = parseSecureUrl(value)
  if (
    !parsed ||
    parsed.hostname !== BILIBILI_EMBEDDED_PAGE_HOST ||
    parsed.hash
  ) {
    return null
  }

  const bvidMatch = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(parsed.pathname)
  if (bvidMatch) {
    if ([...parsed.searchParams].length > 0) return null
    return {
      kind: 'video',
      bvid: bvidMatch[1],
      episodeId: null,
      mediaId: bvidMatch[1],
      url: `https://${BILIBILI_EMBEDDED_PAGE_HOST}/video/${bvidMatch[1]}/`,
    }
  }

  const episodeMatch = /^\/bangumi\/play\/ep([1-9][0-9]{0,15})\/?$/i.exec(
    parsed.pathname,
  )
  if (!episodeMatch) return null
  const episodeQuery = [...parsed.searchParams]
  if (
    episodeQuery.length > 1 ||
    episodeQuery.some(
      ([name, queryValue]) =>
        name !== 'from_spmid' ||
        !/^[0-9A-Za-z._-]{1,128}$/.test(queryValue),
    )
  ) {
    return null
  }
  return {
    kind: 'episode',
    bvid: null,
    episodeId: episodeMatch[1],
    mediaId: episodeMatch[1],
    url: `https://${BILIBILI_EMBEDDED_PAGE_HOST}/bangumi/play/ep${episodeMatch[1]}`,
  }
}

// Bilibili's SPA may decorate the current official page with tracking/query
// state through history.pushState/replaceState. That is a same-document URL
// change, not a request to grant a broader navigation target. Resolve only the
// existing HTTPS host + media pathname back to its canonical identity here;
// initial attachment and full-document navigation continue to use the strict
// parser above.
function parseBilibiliEmbeddedSameDocumentPageUrl(value) {
  const parsed = parseSecureUrl(value)
  if (!parsed || parsed.hostname !== BILIBILI_EMBEDDED_PAGE_HOST) return null
  parsed.search = ''
  parsed.hash = ''
  return parseBilibiliEmbeddedPageUrl(parsed.toString())
}

function isAllowedBilibiliEmbeddedPageUrl(value) {
  return parseBilibiliEmbeddedPageUrl(value) !== null
}

// Retain the existing exported name while the renderer migrates from the
// outside player. Its meaning is now deliberately the official embedded page.
function isAllowedBilibiliPlayerUrl(value) {
  return isAllowedBilibiliEmbeddedPageUrl(value)
}

function isSameBilibiliEmbeddedPage(left, right) {
  return Boolean(
    left &&
      right &&
      left.kind === right.kind &&
      left.mediaId === right.mediaId,
  )
}

function createBilibiliSeasonApiUrl(episodeIdValue) {
  const episodeId = normalizeEpisodeId(episodeIdValue)
  if (!episodeId) throw new TypeError('A valid Bilibili episode ID is required')
  const url = new URL(
    `https://${BILIBILI_SEASON_API_HOST}${BILIBILI_SEASON_API_PATH}`,
  )
  url.searchParams.set('ep_id', episodeId)
  return url.toString()
}

function isExpectedBilibiliSeasonApiUrl(value, episodeIdValue) {
  const episodeId = normalizeEpisodeId(episodeIdValue)
  const parsed = parseSecureUrl(value)
  if (
    !episodeId ||
    !parsed ||
    parsed.hostname !== BILIBILI_SEASON_API_HOST ||
    parsed.pathname !== BILIBILI_SEASON_API_PATH ||
    parsed.hash ||
    [...parsed.searchParams].length !== 1
  ) {
    return false
  }
  return parsed.searchParams.get('ep_id') === episodeId
}

function normalizeBilibiliSeasonContext(payload, currentEpisodeIdValue) {
  const currentEpisodeId = normalizeEpisodeId(currentEpisodeIdValue)
  const result = payload?.code === 0 ? payload?.result : null
  const seasonId = normalizeEpisodeId(result?.season_id)
  if (!currentEpisodeId || !seasonId || !result || typeof result !== 'object') {
    return null
  }

  // Only the episode collections owned by this exact season response are
  // trusted. In particular, result.seasons describes neighbouring seasons and
  // must never widen the webview's navigation allowlist.
  const episodeCollections = []
  if (Array.isArray(result.episodes)) episodeCollections.push(result.episodes)
  if (Array.isArray(result.section)) {
    for (const section of result.section) {
      if (Array.isArray(section?.episodes)) {
        episodeCollections.push(section.episodes)
      }
    }
  }

  const episodeIds = new Set()
  for (const collection of episodeCollections) {
    for (const episode of collection) {
      const episodeId = normalizeEpisodeId(episode?.id)
      if (!episodeId) continue
      episodeIds.add(episodeId)
      if (episodeIds.size > MAX_SEASON_EPISODE_IDS) return null
    }
  }
  if (!episodeIds.has(currentEpisodeId)) return null
  return { seasonId, episodeIds: [...episodeIds] }
}

async function readBoundedSeasonResponse(response) {
  const declaredLength = Number(response?.headers?.get?.('content-length'))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SEASON_RESPONSE_BYTES
  ) {
    throw new Error('Bilibili season response exceeds the size limit')
  }

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks = []
    let totalBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        totalBytes += chunk.byteLength
        if (totalBytes > MAX_SEASON_RESPONSE_BYTES) {
          await reader.cancel?.()
          throw new Error('Bilibili season response exceeds the size limit')
        }
        chunks.push(chunk)
      }
    } finally {
      reader.releaseLock?.()
    }
    if (totalBytes === 0) throw new Error('Bilibili season response is empty')
    return Buffer.concat(chunks, totalBytes)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_SEASON_RESPONSE_BYTES
  ) {
    throw new Error('Bilibili season response has an invalid size')
  }
  return bytes
}

async function fetchBilibiliSeasonContext(contents, episodeIdValue) {
  const episodeId = normalizeEpisodeId(episodeIdValue)
  const session = contents?.session
  if (!episodeId || typeof session?.fetch !== 'function') return null

  const url = createBilibiliSeasonApiUrl(episodeId)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SEASON_REQUEST_TIMEOUT_MS)
  try {
    const response = await session.fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response?.ok) return null
    if (
      typeof response.url === 'string' &&
      response.url &&
      !isExpectedBilibiliSeasonApiUrl(response.url, episodeId)
    ) {
      return null
    }
    const bytes = await readBoundedSeasonResponse(response)
    return normalizeBilibiliSeasonContext(
      JSON.parse(bytes.toString('utf8')),
      episodeId,
    )
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function hardenBilibiliPlayerWebPreferences(webPreferences) {
  if (!webPreferences || typeof webPreferences !== 'object') return false

  delete webPreferences.preload
  delete webPreferences.preloadURL
  delete webPreferences.session
  webPreferences.partition = BILIBILI_PARTITION
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
  webPreferences.webviewTag = false
  webPreferences.plugins = false
  webPreferences.spellcheck = false
  webPreferences.devTools = false
  webPreferences.navigateOnDragDrop = false
  webPreferences.disableHtmlFullscreenWindowResize = true
  return true
}

function guardBilibiliPlayerGuestWebContents(
  contents,
  lockedPageValue = null,
  expectedSession = null,
) {
  if (!contents || typeof contents.on !== 'function') return false

  const reportedPartition = contents.session?.getPartition?.()
  if (expectedSession && contents.session !== expectedSession) {
    return false
  }
  if (reportedPartition && reportedPartition !== BILIBILI_PARTITION) {
    // The Tencent guard owns its reviewed partition and receives the same
    // host-level did-attach event. Do not destroy its guest while discarding a
    // stale Bilibili ownership entry.
    if (reportedPartition === 'persist:aurora-tencent-v1') return false
    contents.destroy?.()
    return false
  }

  const lockedPage =
    typeof lockedPageValue === 'string'
      ? parseBilibiliEmbeddedPageUrl(lockedPageValue)
      : lockedPageValue && typeof lockedPageValue === 'object'
        ? parseBilibiliEmbeddedPageUrl(lockedPageValue.url)
        : null
  if (!lockedPage) {
    contents.destroy?.()
    return false
  }

  const currentUrl = contents.getURL?.()
  if (currentUrl && currentUrl !== 'about:blank') {
    const currentPage =
      parseBilibiliEmbeddedPageUrl(currentUrl) ??
      parseBilibiliEmbeddedSameDocumentPageUrl(currentUrl)
    if (!isSameBilibiliEmbeddedPage(currentPage, lockedPage)) {
      contents.destroy?.()
      return false
    }
  }

  let activePage = lockedPage
  let verifiedSeasonId = null
  let verifiedEpisodeIds = null
  let seasonContextPromise = null

  const isPermittedNavigationPage = (page) => {
    if (!page || page.kind !== lockedPage.kind) return false
    if (lockedPage.kind === 'video') {
      return isSameBilibiliEmbeddedPage(page, lockedPage)
    }
    return Boolean(
      isSameBilibiliEmbeddedPage(page, activePage) ||
        verifiedEpisodeIds?.has(page.episodeId),
    )
  }
  const isPermittedNavigation = (url) =>
    isPermittedNavigationPage(parseBilibiliEmbeddedPageUrl(url))

  const refreshSeasonContext = () => {
    if (activePage.kind !== 'episode' || seasonContextPromise) return
    const requestedPage = activePage
    const request = fetchBilibiliSeasonContext(contents, requestedPage.episodeId)
      .then((context) => {
        if (
          !context ||
          (verifiedSeasonId && context.seasonId !== verifiedSeasonId) ||
          !context.episodeIds.includes(requestedPage.episodeId)
        ) {
          return
        }
        verifiedSeasonId = context.seasonId
        verifiedEpisodeIds = new Set(context.episodeIds)
      })
      .finally(() => {
        if (seasonContextPromise === request) seasonContextPromise = null
      })
    seasonContextPromise = request
  }

  const guardNavigation = (event, url) => {
    if (!isPermittedNavigation(url)) event.preventDefault()
  }
  const finishNavigation = (
    url,
    isMainFrame = true,
    parsePage = parseBilibiliEmbeddedPageUrl,
  ) => {
    if (isMainFrame === false) return
    const navigatedPage = parsePage(url)
    if (isPermittedNavigationPage(navigatedPage)) {
      activePage = navigatedPage
      return
    }
    void Promise.resolve(contents.loadURL?.(activePage.url)).catch(() => undefined)
  }
  const handleDidNavigate = (_event, url) => finishNavigation(url, true)
  const handleDidNavigateInPage = (_event, url, isMainFrame = true) =>
    finishNavigation(
      url,
      isMainFrame,
      parseBilibiliEmbeddedSameDocumentPageUrl,
    )

  let documentGeneration = 0
  let styledGeneration = -1
  const handleNavigationStart = (
    _event,
    _url,
    isInPlace = false,
    isMainFrame = true,
  ) => {
    if (isMainFrame !== false && !isInPlace) {
      documentGeneration += 1
      styledGeneration = -1
    }
  }
  const applyEmbeddedPlayerCss = (force = false) => {
    if (typeof contents.insertCSS !== 'function') return
    const currentUrl = contents.getURL?.()
    const page =
      parseBilibiliEmbeddedPageUrl(currentUrl) ??
      parseBilibiliEmbeddedSameDocumentPageUrl(currentUrl)
    if (!isPermittedNavigationPage(page)) return
    if (!force && styledGeneration === documentGeneration) return
    const generation = documentGeneration
    styledGeneration = generation
    void Promise.resolve(contents.insertCSS(BILIBILI_EMBEDDED_PLAYER_CSS)).catch(
      () => {
        if (styledGeneration === generation) styledGeneration = -1
      },
    )
  }
  const handleEmbeddedPlayerDocumentReady = () => {
    applyEmbeddedPlayerCss(false)
    refreshSeasonContext()
  }

  contents.on('will-navigate', guardNavigation)
  contents.on('will-redirect', guardNavigation)
  contents.on('did-start-navigation', handleNavigationStart)
  contents.on('did-navigate', handleDidNavigate)
  contents.on('did-navigate-in-page', handleDidNavigateInPage)
  contents.on('dom-ready', handleEmbeddedPlayerDocumentReady)
  contents.on('did-finish-load', handleEmbeddedPlayerDocumentReady)
  contents.on('did-stop-loading', handleEmbeddedPlayerDocumentReady)
  contents.on('leave-html-full-screen', () => {
    applyEmbeddedPlayerCss(true)
    contents.invalidate?.()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler?.(() => ({ action: 'deny' }))
  // A cached official page can finish before the host receives
  // `did-attach-webview`. Apply once immediately, then retain the document
  // events above as the fallback for later navigations.
  applyEmbeddedPlayerCss(true)
  refreshSeasonContext()
  return true
}

function installBilibiliPlayerWebviewGuard(hostContents, expectedSession = null) {
  if (!hostContents || typeof hostContents.on !== 'function') {
    throw new TypeError('The main window webContents is required')
  }

  const existingInstallation = BILIBILI_EMBEDDED_GUESTS.get(hostContents)
  if (existingInstallation && !existingInstallation.disposed) {
    return existingInstallation.dispose
  }

  const pendingLockedPages = []
  const guestCleanupHandlers = new Map()
  const installation = {
    activeGuest: null,
    activeLockedPage: null,
    disposed: false,
    dispose: null,
  }
  const handleWillAttach = (event, webPreferences, params = {}) => {
    const parameterPartition = params?.partition
    const preferencePartition = webPreferences?.partition
    if (
      parameterPartition !== BILIBILI_PARTITION &&
      preferencePartition !== BILIBILI_PARTITION
    ) {
      // The central online-player firewall rejects unknown partitions. Each
      // provider guard owns only its own exact partition so reviewed adapters
      // cannot accidentally block one another as new sources are added.
      return
    }
    hardenBilibiliPlayerWebPreferences(webPreferences)
    const hardenedPreferencePartition = webPreferences?.partition
    const embeddedPage = parseBilibiliEmbeddedPageUrl(params?.src)
    if (
      parameterPartition !== BILIBILI_PARTITION ||
      hardenedPreferencePartition !== BILIBILI_PARTITION ||
      !embeddedPage
    ) {
      event.preventDefault()
      return
    }
    pendingLockedPages.push(embeddedPage)
  }
  const handleDidAttach = (_event, guestContents) => {
    if (expectedSession && guestContents?.session !== expectedSession) return
    if (pendingLockedPages.length === 0) return
    const lockedPage = pendingLockedPages.shift() ?? null
    if (
      !guardBilibiliPlayerGuestWebContents(
        guestContents,
        lockedPage,
        expectedSession,
      )
    ) return

    installation.activeGuest = guestContents
    installation.activeLockedPage = lockedPage
    const handleDestroyed = () => {
      guestCleanupHandlers.delete(guestContents)
      if (installation.activeGuest === guestContents) {
        installation.activeGuest = null
        installation.activeLockedPage = null
      }
    }
    guestCleanupHandlers.set(guestContents, handleDestroyed)
    guestContents.once?.('destroyed', handleDestroyed)
  }

  hostContents.on('will-attach-webview', handleWillAttach)
  hostContents.on('did-attach-webview', handleDidAttach)
  const dispose = () => {
    if (installation.disposed) return
    installation.disposed = true
    pendingLockedPages.length = 0
    installation.activeGuest = null
    installation.activeLockedPage = null
    for (const [guestContents, handleDestroyed] of guestCleanupHandlers) {
      guestContents.removeListener?.('destroyed', handleDestroyed)
    }
    guestCleanupHandlers.clear()
    hostContents.removeListener?.('will-attach-webview', handleWillAttach)
    hostContents.removeListener?.('did-attach-webview', handleDidAttach)
    if (BILIBILI_EMBEDDED_GUESTS.get(hostContents) === installation) {
      BILIBILI_EMBEDDED_GUESTS.delete(hostContents)
    }
  }
  installation.dispose = dispose
  BILIBILI_EMBEDDED_GUESTS.set(hostContents, installation)
  return dispose
}

function normalizeEmbeddedFrameCaptureRequest(request) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).sort().join(',') !== 'kind,mediaId' ||
    typeof request.mediaId !== 'string'
  ) {
    return null
  }

  if (request.kind === 'video' && BVID_PATTERN.test(request.mediaId)) {
    return { kind: 'video', mediaId: request.mediaId }
  }
  const episodeMatch = /^([1-9][0-9]{0,15})$/.exec(request.mediaId)
  if (request.kind === 'episode' && episodeMatch) {
    return { kind: 'episode', mediaId: episodeMatch[1] }
  }
  return null
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
  ) {
    return null
  }
  return { width, height }
}

function isAllowedEmbeddedFrameDataUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_EMBEDDED_FRAME_DATA_URL_LENGTH
  ) {
    return false
  }
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  )
  return Boolean(match?.[1])
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

async function captureBilibiliEmbeddedFrame(hostContents, request) {
  let normalizedRequest = null
  try {
    normalizedRequest = normalizeEmbeddedFrameCaptureRequest(request)
  } catch {
    return null
  }
  const installation =
    hostContents && typeof hostContents === 'object'
      ? BILIBILI_EMBEDDED_GUESTS.get(hostContents)
      : null
  if (!normalizedRequest || !installation || installation.disposed) return null

  const guestContents = installation.activeGuest
  const lockedPage = installation.activeLockedPage
  if (
    !guestContents ||
    guestContents.isDestroyed?.() === true ||
    !lockedPage ||
    lockedPage.kind !== normalizedRequest.kind ||
    lockedPage.mediaId !== normalizedRequest.mediaId ||
    typeof guestContents.executeJavaScript !== 'function' ||
    typeof guestContents.capturePage !== 'function'
  ) {
    return null
  }

  try {
    const frameReady = await settleEmbeddedFrameOperation(
      guestContents.executeJavaScript(
        READ_EMBEDDED_VIDEO_FRAME_READY_SCRIPT,
        true,
      ),
      EMBEDDED_FRAME_READY_TIMEOUT_MS,
    )
    if (
      frameReady !== true ||
      installation.activeGuest !== guestContents ||
      guestContents.isDestroyed?.() === true
    ) {
      return null
    }

    let image = await settleEmbeddedFrameOperation(
      guestContents.capturePage(),
      EMBEDDED_FRAME_CAPTURE_TIMEOUT_MS,
    )
    if (
      installation.activeGuest !== guestContents ||
      guestContents.isDestroyed?.() === true
    ) {
      return null
    }
    if (!image || image.isEmpty?.() !== false) return null
    let size = readEmbeddedFrameImageSize(image)
    if (!size) return null

    if (Math.max(size.width, size.height) > MAX_EMBEDDED_FRAME_EDGE) {
      const resizeOptions =
        size.width >= size.height
          ? { width: MAX_EMBEDDED_FRAME_EDGE, quality: 'good' }
          : { height: MAX_EMBEDDED_FRAME_EDGE, quality: 'good' }
      image = image.resize?.(resizeOptions)
      if (!image || image.isEmpty?.() !== false) return null
      size = readEmbeddedFrameImageSize(image)
      if (!size || Math.max(size.width, size.height) > MAX_EMBEDDED_FRAME_EDGE) {
        return null
      }
    }

    const dataUrl = image.toDataURL?.()
    return isAllowedEmbeddedFrameDataUrl(dataUrl) ? dataUrl : null
  } catch {
    return null
  }
}

function createBilibiliSearchUrl(query) {
  const normalized = boundedText(query, MAX_SEARCH_QUERY_LENGTH)
  if (!normalized) {
    throw new TypeError('A non-empty Bilibili search query is required')
  }
  const url = new URL('https://search.bilibili.com/all')
  url.searchParams.set('keyword', normalized)
  return url.toString()
}

function normalizeSearchLimit(value) {
  if (value === undefined || value === null) return DEFAULT_SEARCH_RESULT_LIMIT
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SEARCH_RESULT_LIMIT) {
    throw new TypeError(
      `Bilibili search limit must be between 1 and ${MAX_SEARCH_RESULT_LIMIT}`,
    )
  }
  return value
}

function normalizeSearchPage(value) {
  if (value === undefined || value === null) return 1
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SEARCH_PAGE) {
    throw new TypeError(
      `Bilibili search page must be between 1 and ${MAX_SEARCH_PAGE}`,
    )
  }
  return value
}

function readSearchPaginationInteger(value, minimum, maximum) {
  let normalized = value
  if (typeof normalized === 'string') {
    const trimmed = normalized.trim()
    if (!/^(?:0|[1-9][0-9]{0,15})$/.test(trimmed)) return null
    normalized = Number(trimmed)
  }
  return Number.isSafeInteger(normalized) &&
    normalized >= minimum &&
    normalized <= maximum
    ? normalized
    : null
}

/**
 * Treat Bilibili's pagination metadata as untrusted input while retaining a
 * conservative next-page signal if an otherwise valid response omits it.
 * The requested page remains authoritative so a mismatched remote `page`
 * value cannot move Aurora's cursor forwards or backwards.
 */
function normalizeBilibiliSearchPagination(
  payload,
  requestedPage = 1,
  requestedPageSize = DEFAULT_SEARCH_RESULT_LIMIT,
  normalizedResultCount = 0,
) {
  const page = normalizeSearchPage(requestedPage)
  const requestedSize = normalizeSearchLimit(requestedPageSize)
  const resultCount = readSearchPaginationInteger(
    normalizedResultCount,
    0,
    requestedSize,
  ) ?? 0
  const data =
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    payload.data &&
    typeof payload.data === 'object' &&
    !Array.isArray(payload.data)
      ? payload.data
      : null

  const responsePage = readSearchPaginationInteger(
    data?.page,
    1,
    MAX_SEARCH_PAGE,
  )
  const responsePageSize = readSearchPaginationInteger(
    data?.pagesize ?? data?.page_size,
    1,
    MAX_SEARCH_REMOTE_PAGE_SIZE,
  )
  const responseTotalCount = readSearchPaginationInteger(
    data?.numResults,
    0,
    Number.MAX_SAFE_INTEGER,
  )
  const responseNumPages = readSearchPaginationInteger(
    data?.numPages,
    0,
    MAX_SEARCH_PAGE,
  )

  // Only pagination metadata belonging to the page Aurora requested may
  // influence navigation. A missing page field is accepted for compatibility
  // with older search responses.
  const metadataMatchesRequest = responsePage === null || responsePage === page
  const effectivePageSize =
    metadataMatchesRequest && responsePageSize !== null
      ? responsePageSize
      : requestedSize
  const trustedTotalCount = metadataMatchesRequest ? responseTotalCount : null
  const trustedNumPages = metadataMatchesRequest ? responseNumPages : null
  const visibleResultFloor = (page - 1) * requestedSize + resultCount
  const pagesFromTotal =
    trustedTotalCount === null
      ? null
      : trustedTotalCount === 0
        ? 0
        : Math.min(
            MAX_SEARCH_PAGE,
            Math.ceil(trustedTotalCount / effectivePageSize),
          )

  let numPages
  if (trustedNumPages !== null || pagesFromTotal !== null) {
    numPages = Math.max(trustedNumPages ?? 0, pagesFromTotal ?? 0)
  } else if (resultCount === requestedSize && page < MAX_SEARCH_PAGE) {
    // A full page without metadata is not proof of exhaustion. Permit one
    // additional request; its shorter/empty result will terminate pagination.
    numPages = page + 1
  } else {
    numPages = resultCount > 0 ? page : Math.max(0, page - 1)
  }
  numPages = Math.min(
    MAX_SEARCH_PAGE,
    Math.max(numPages, resultCount > 0 ? page : 0),
  )
  const hasMore = page < numPages
  const totalCount = Math.max(
    trustedTotalCount ?? 0,
    visibleResultFloor + (hasMore ? 1 : 0),
  )

  return { page, totalCount, numPages, hasMore }
}

function createMixinKey(imgKey, subKey) {
  const source = `${boundedText(imgKey, 64)}${boundedText(subKey, 64)}`
  if (!/^[0-9a-f]{64}$/i.test(source)) {
    throw new TypeError('Bilibili returned an invalid WBI signing key')
  }
  return MIXIN_KEY_ENC_TAB.map((index) => source[index]).join('').slice(0, 32)
}

function encodeWbiParameter(value) {
  return encodeURIComponent(String(value).replace(/[!'()*]/g, ''))
}

function createBilibiliSearchApiUrl(
  query,
  limit,
  mixinKey,
  timestampSeconds = Math.floor(Date.now() / 1_000),
  searchType = 'video',
  page = 1,
) {
  const normalizedQuery = boundedText(query, MAX_SEARCH_QUERY_LENGTH)
  const normalizedLimit = normalizeSearchLimit(limit)
  const normalizedPage = normalizeSearchPage(page)
  if (!normalizedQuery) {
    throw new TypeError('A non-empty Bilibili search query is required')
  }
  if (!/^[0-9a-f]{32}$/i.test(mixinKey)) {
    throw new TypeError('A valid Bilibili WBI mixin key is required')
  }
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    throw new TypeError('A valid Bilibili WBI timestamp is required')
  }
  if (
    searchType !== 'video' &&
    searchType !== 'media_bangumi' &&
    searchType !== 'media_ft'
  ) {
    throw new TypeError('An unsupported Bilibili search type was requested')
  }

  const parameters = {
    keyword: normalizedQuery,
    page: normalizedPage,
    page_size: normalizedLimit,
    search_type: searchType,
    wts: timestampSeconds,
  }
  const signedQuery = Object.keys(parameters)
    .sort()
    .map(
      (key) =>
        `${encodeWbiParameter(key)}=${encodeWbiParameter(parameters[key])}`,
    )
    .join('&')
  const signature = crypto
    .createHash('md5')
    .update(`${signedQuery}${mixinKey}`)
    .digest('hex')
  return `https://api.bilibili.com/x/web-interface/wbi/search/type?${signedQuery}&w_rid=${signature}`
}

function createBilibiliBangumiSearchApiUrl(
  query,
  limit,
  mixinKey,
  timestampSeconds = Math.floor(Date.now() / 1_000),
  page = 1,
) {
  return createBilibiliSearchApiUrl(
    query,
    limit,
    mixinKey,
    timestampSeconds,
    'media_bangumi',
    page,
  )
}

function isAllowedBilibiliApiUrl(value, expectedPath) {
  const parsed = parseSecureUrl(value)
  return (
    parsed !== null &&
    parsed.hostname === 'api.bilibili.com' &&
    parsed.pathname === expectedPath
  )
}

function extractWbiImageKey(value) {
  const parsed = parseSecureUrl(value)
  if (!parsed || !BILIBILI_IMAGE_HOSTS.has(parsed.hostname)) return null
  const filename = parsed.pathname.split('/').at(-1) ?? ''
  const match = /^([0-9a-f]{32})\.[a-z0-9]{2,5}$/i.exec(filename)
  return match ? match[1] : null
}

function createBilibiliVideoUrl(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('A Bilibili video request is required')
  }
  if (
    Object.keys(request).some(
      (key) => key !== 'bvid' && key !== 'episodeId',
    )
  ) {
    throw new TypeError('Only a Bilibili bvid or episodeId is accepted')
  }
  const hasBvid = request.bvid !== undefined && request.bvid !== null
  const hasEpisodeId =
    request.episodeId !== undefined && request.episodeId !== null
  if (hasBvid === hasEpisodeId) {
    throw new TypeError('Specify exactly one Bilibili bvid or episodeId')
  }

  if (hasBvid) {
    const bvid = normalizeBvid(request.bvid)
    if (!bvid) throw new TypeError('The Bilibili bvid is invalid')
    return `https://www.bilibili.com/video/${bvid}`
  }

  const episodeId = normalizeEpisodeId(request.episodeId)
  if (!episodeId) throw new TypeError('The Bilibili episodeId is invalid')
  return `https://www.bilibili.com/bangumi/play/ep${episodeId}`
}

function parseBilibiliVideoPage(value) {
  const parsed = parseSecureUrl(value)
  if (!parsed || parsed.hostname !== 'www.bilibili.com') return null

  const bvidMatch = /^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/.exec(
    parsed.pathname,
  )
  if (bvidMatch) {
    return {
      kind: 'video',
      bvid: bvidMatch[1],
      episodeId: null,
      url: `https://www.bilibili.com/video/${bvidMatch[1]}`,
    }
  }

  const episodeMatch = /^\/bangumi\/play\/ep([1-9][0-9]{0,15})(?:\/|$)/i.exec(
    parsed.pathname,
  )
  if (episodeMatch) {
    return {
      kind: 'episode',
      bvid: null,
      episodeId: episodeMatch[1],
      url: `https://www.bilibili.com/bangumi/play/ep${episodeMatch[1]}`,
    }
  }

  return null
}

function normalizeCoverUrl(value) {
  const candidate =
    typeof value === 'string' && value.startsWith('//')
      ? `https:${value}`
      : typeof value === 'string' && value.startsWith('http://')
        ? `https://${value.slice('http://'.length)}`
        : value
  const parsed = parseSecureUrl(candidate)
  if (!parsed || !BILIBILI_IMAGE_HOSTS.has(parsed.hostname)) return null
  parsed.hash = ''
  return parsed.toString()
}

function normalizeBilibiliSelectionDescriptor(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const video =
    parseBilibiliVideoPage(raw.pageUrl) ??
    parseBilibiliVideoPage(raw.canonicalUrl)
  if (!video) return null

  return {
    source: 'bilibili',
    kind: video.kind,
    mediaId: video.bvid ?? video.episodeId,
    bvid: video.bvid,
    episodeId: video.episodeId,
    url: video.url,
    canonicalUrl: video.url,
    title: boundedText(raw.title, 300),
    description: boundedText(raw.description, 2_000),
    coverUrl: normalizeCoverUrl(raw.coverUrl),
    thumbnailPath: null,
    author: boundedText(raw.author, 160),
    duration: '',
    publishedAt: '',
    tags: [],
  }
}

function normalizeBilibiliSearchItem(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const bvid = normalizeBvid(raw.bvid)
  if (!bvid) return null
  const canonicalUrl = createBilibiliVideoUrl({ bvid })
  const publishedAtSeconds = Number(raw.pubdate)
  const publishedDate =
    Number.isSafeInteger(publishedAtSeconds) && publishedAtSeconds > 0
      ? new Date(publishedAtSeconds * 1_000)
      : null
  const publishedAt =
    publishedDate && Number.isFinite(publishedDate.getTime())
      ? publishedDate.toISOString()
      : ''
  const tags = boundedText(raw.tag, 1_000)
    .split(',')
    .map((tag) => boundedText(tag, 48))
    .filter(Boolean)
    .slice(0, 12)

  return {
    source: 'bilibili',
    kind: 'video',
    mediaId: bvid,
    bvid,
    episodeId: null,
    url: canonicalUrl,
    canonicalUrl,
    title: decodeHtmlText(raw.title, 300) || bvid,
    description: decodeHtmlText(raw.description, 2_000),
    coverUrl: normalizeCoverUrl(raw.pic),
    thumbnailPath: null,
    author: decodeHtmlText(raw.author, 160),
    duration: boundedText(raw.duration, 32),
    publishedAt,
    tags,
  }
}

function normalizeBilibiliSearchResponse(payload, limit) {
  const normalizedLimit = normalizeSearchLimit(limit)
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.code !== 0 ||
    !payload.data ||
    typeof payload.data !== 'object' ||
    !Array.isArray(payload.data.result)
  ) {
    throw new Error('Bilibili returned an invalid search response')
  }

  const results = []
  const seenMediaIds = new Set()
  for (const raw of payload.data.result) {
    const descriptor = normalizeBilibiliSearchItem(raw)
    if (!descriptor || seenMediaIds.has(descriptor.mediaId)) continue
    seenMediaIds.add(descriptor.mediaId)
    results.push(descriptor)
    if (results.length >= normalizedLimit) break
  }
  return results
}

function normalizeBangumiEpisodeId(raw = {}) {
  const hitEpisodeIds = raw.hit_epids
  const hitCandidates = Array.isArray(hitEpisodeIds)
    ? hitEpisodeIds
    : [hitEpisodeIds]
  for (const candidate of hitCandidates) {
    const direct = normalizeEpisodeId(candidate)
    if (direct) return direct
    if (typeof candidate !== 'string') continue
    const match = /(?:^|[^0-9])(?:ep)?([1-9][0-9]{0,15})(?=$|[^0-9])/i.exec(
      candidate,
    )
    if (match) return match[1]
  }

  const firstEpisode = Array.isArray(raw.eps) ? raw.eps[0] : null
  if (!firstEpisode || typeof firstEpisode !== 'object') return null
  return (
    normalizeEpisodeId(firstEpisode.id) ??
    parseBilibiliVideoPage(firstEpisode.url)?.episodeId ??
    null
  )
}

function normalizeBangumiPublishedAt(value) {
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return ''
  const publishedDate = new Date(seconds * 1_000)
  return Number.isFinite(publishedDate.getTime())
    ? publishedDate.toISOString()
    : ''
}

function collectBangumiTags(raw) {
  const values = []
  const append = (value) => {
    const entries = Array.isArray(value) ? value : [value]
    for (const entry of entries) {
      if (typeof entry === 'string') {
        values.push(...entry.split(/[,/|\u00b7]+/))
      } else if (entry && typeof entry === 'object') {
        values.push(entry.name, entry.text)
      }
    }
  }
  append(raw.season_type_name)
  append(raw.areas)
  append(raw.styles)
  append(raw.labels)

  const score = Number(raw.media_score?.score)
  if (Number.isFinite(score) && score > 0 && score <= 10) {
    values.push(`评分 ${score.toFixed(1).replace(/\.0$/, '')}`)
  }

  const tags = []
  const seen = new Set()
  for (const value of values) {
    const tag = decodeHtmlText(value, 48)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= 12) break
  }
  return tags
}

function normalizeBilibiliBangumiSearchItem(raw = {}, expectedType = 'media_bangumi') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (boundedText(raw.type, 32) !== expectedType) return null
  const episodeId = normalizeBangumiEpisodeId(raw)
  if (!episodeId) return null
  const canonicalUrl = createBilibiliVideoUrl({ episodeId })
  const episodeCount = Number(raw.ep_size)

  return {
    source: 'bilibili',
    kind: 'episode',
    mediaId: episodeId,
    bvid: null,
    episodeId,
    url: canonicalUrl,
    canonicalUrl,
    title: decodeHtmlText(raw.title, 300) || `番剧 ep${episodeId}`,
    description: decodeHtmlText(raw.desc, 2_000),
    coverUrl: normalizeCoverUrl(raw.cover),
    thumbnailPath: null,
    author: decodeHtmlText(raw.season_type_name, 160) ||
      (expectedType === 'media_ft' ? 'B站影视' : 'B站番剧'),
    duration:
      Number.isSafeInteger(episodeCount) && episodeCount > 0
        ? `${episodeCount} 集`
        : '',
    publishedAt: normalizeBangumiPublishedAt(raw.pubtime),
    tags: collectBangumiTags(raw),
  }
}

function normalizeBilibiliBangumiSearchResponse(
  payload,
  limit,
  expectedType = 'media_bangumi',
) {
  const normalizedLimit = normalizeSearchLimit(limit)
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.code !== 0 ||
    !payload.data ||
    typeof payload.data !== 'object' ||
    Array.isArray(payload.data)
  ) {
    throw new Error('Bilibili returned an invalid bangumi search response')
  }
  if (payload.data.result === undefined && Number(payload.data.numResults) === 0) {
    return []
  }
  if (!Array.isArray(payload.data.result)) {
    throw new Error('Bilibili returned an invalid bangumi search response')
  }

  const results = []
  const seenMediaIds = new Set()
  for (const raw of payload.data.result) {
    const descriptor = normalizeBilibiliBangumiSearchItem(raw, expectedType)
    if (!descriptor || seenMediaIds.has(descriptor.mediaId)) continue
    seenMediaIds.add(descriptor.mediaId)
    results.push(descriptor)
    if (results.length >= normalizedLimit) break
  }
  return results
}

function mergeBilibiliSearchResults(videoResults, bangumiResults, limit) {
  const normalizedLimit = normalizeSearchLimit(limit)
  if (bangumiResults.length === 0) return videoResults.slice(0, normalizedLimit)
  if (videoResults.length === 0) return bangumiResults.slice(0, normalizedLimit)

  const bangumiQuota = Math.min(
    bangumiResults.length,
    Math.max(1, Math.floor(normalizedLimit / 3)),
  )
  const videoQuota = normalizedLimit - bangumiQuota
  const results = [
    ...bangumiResults.slice(0, bangumiQuota),
    ...videoResults.slice(0, videoQuota),
  ]
  const remaining = [
    ...videoResults.slice(videoQuota),
    ...bangumiResults.slice(bangumiQuota),
  ]
  for (const descriptor of remaining) {
    if (results.length >= normalizedLimit) break
    results.push(descriptor)
  }
  return results
}

function isAllowedFullscreenOrigin(value) {
  const parsed = parseSecureUrl(value)
  return (
    parsed !== null &&
    (parsed.hostname === 'www.bilibili.com' ||
      parsed.hostname === 'passport.bilibili.com' ||
      parsed.hostname === BILIBILI_OFFICIAL_PLAYER_FRAME_HOST)
  )
}

function createBilibiliSessionManager({
  BrowserWindow,
  sessionModule,
  getParentWindow = () => null,
  cacheDirectory = null,
  isDev = false,
  onSelection = () => undefined,
  onAuthStateChange = () => undefined,
} = {}) {
  if (typeof BrowserWindow !== 'function') {
    throw new TypeError('BrowserWindow is required')
  }
  if (!sessionModule || typeof sessionModule.fromPartition !== 'function') {
    throw new TypeError('Electron session is required')
  }

  const sharedSession = sessionModule.fromPartition(BILIBILI_PARTITION, {
    cache: true,
  })
  let loginWindow = null
  let contentWindow = null
  let lastSignedIn = null
  let lastSelectionFingerprint = ''
  let disposed = false
  let authStateEmissionSuppressed = false
  let cachedWbiKey = null
  let cachedWbiKeyExpiresAt = 0
  const coverCacheTasks = new Map()
  let loginCompletion = null

  const normalizedCacheDirectory =
    typeof cacheDirectory === 'string' && path.isAbsolute(cacheDirectory)
      ? cacheDirectory
      : null

  const isLoginWebContents = (contents) =>
    Boolean(
      contents &&
      loginWindow &&
      !loginWindow.isDestroyed?.() &&
      contents === loginWindow.webContents,
    )

  const permissionAllowed = (contents, permission, origin) =>
    permission === 'fullscreen' &&
    !isLoginWebContents(contents) &&
    isAllowedFullscreenOrigin(origin)

  sharedSession.setPermissionCheckHandler?.(
    (webContents, permission, requestingOrigin, details = {}) =>
      permissionAllowed(
        webContents,
        permission,
        requestingOrigin || details.requestingUrl || details.embeddingOrigin,
      ),
  )
  sharedSession.setPermissionRequestHandler?.(
    (webContents, permission, callback, details = {}) => {
      callback(
        permissionAllowed(
          webContents,
          permission,
          details.requestingUrl || details.embeddingOrigin,
        ),
      )
    },
  )
  const handleDownload = (event) => event.preventDefault()
  sharedSession.on?.('will-download', handleDownload)

  async function getAuthState() {
    const cookies = await sharedSession.cookies.get({
      url: 'https://www.bilibili.com',
      name: BILIBILI_AUTH_COOKIE_NAME,
    })
    return {
      signedIn: cookies.some(
        (cookie) =>
          cookie?.name === BILIBILI_AUTH_COOKIE_NAME &&
          typeof cookie?.value === 'string' &&
          cookie.value.length > 0,
      ),
    }
  }

  async function emitAuthState(force = false) {
    if (disposed || authStateEmissionSuppressed) return
    const state = await getAuthState()
    if (force || state.signedIn !== lastSignedIn) {
      lastSignedIn = state.signedIn
      onAuthStateChange(state)
    }
    if (state.signedIn) await completeAuthenticatedLogin()
  }

  const handleCookieChanged = (_event, cookie) => {
    if (
      cookie?.name === BILIBILI_AUTH_COOKIE_NAME &&
      typeof cookie?.domain === 'string' &&
      /(^|\.)bilibili\.com$/i.test(cookie.domain)
    ) {
      void emitAuthState().catch(() => undefined)
    }
  }
  sharedSession.cookies.on?.('changed', handleCookieChanged)

  async function flushSession() {
    await Promise.allSettled([
      sharedSession.cookies.flushStore?.(),
      sharedSession.flushStorageData?.(),
    ])
  }

  async function completeAuthenticatedLogin() {
    const targetWindow = loginWindow
    if (!targetWindow || targetWindow.isDestroyed?.()) return
    if (
      !loginCompletion ||
      loginCompletion.windowInstance !== targetWindow
    ) {
      const completion = {
        windowInstance: targetWindow,
        task: null,
      }
      completion.task = (async () => {
        await flushSession()
        if (
          loginWindow === targetWindow &&
          !targetWindow.isDestroyed?.()
        ) {
          targetWindow.close()
        }
      })().finally(() => {
        if (loginCompletion === completion) loginCompletion = null
      })
      loginCompletion = completion
    }
    await loginCompletion.task
  }

  async function readResponseBytes(response, maximumBytes = MAX_COVER_BYTES) {
    const declaredLength = Number(response.headers?.get?.('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new Error('Bilibili response exceeds the size limit')
    }

    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader()
      const chunks = []
      let totalBytes = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = Buffer.from(value)
          totalBytes += chunk.byteLength
          if (totalBytes > maximumBytes) {
            await reader.cancel?.()
            throw new Error('Bilibili response exceeds the size limit')
          }
          chunks.push(chunk)
        }
      } finally {
        reader.releaseLock?.()
      }
      if (totalBytes === 0) throw new Error('Bilibili cover is empty')
      return Buffer.concat(chunks, totalBytes)
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
      throw new Error('Bilibili cover has an invalid size')
    }
    return bytes
  }

  async function fetchBoundedJson(
    initialUrl,
    expectedPath,
    signal,
    urlValidator = (value) => isAllowedBilibiliApiUrl(value, expectedPath),
  ) {
    if (typeof sharedSession.fetch !== 'function') {
      throw new Error('Bilibili search is unavailable in this Electron version')
    }
    let currentUrl = initialUrl
    for (let redirectCount = 0; redirectCount <= MAX_SEARCH_REDIRECTS; redirectCount += 1) {
      if (!urlValidator(currentUrl)) {
        throw new Error('Bilibili redirected search to an untrusted URL')
      }
      const response = await sharedSession.fetch(currentUrl, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'manual',
        signal,
        headers: {
          Accept: 'application/json',
          Referer: 'https://search.bilibili.com/',
        },
      })
      const responseUrl = response.url || currentUrl
      if (!urlValidator(responseUrl)) {
        throw new Error('Bilibili returned an untrusted response URL')
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location')
        if (!location || redirectCount === MAX_SEARCH_REDIRECTS) {
          throw new Error('Bilibili returned too many search redirects')
        }
        currentUrl = new URL(location, responseUrl).toString()
        continue
      }
      if (!response.ok) {
        throw new Error(`Bilibili search failed with status ${response.status}`)
      }
      const contentType = String(response.headers?.get?.('content-type') ?? '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase()
      if (contentType !== 'application/json') {
        throw new Error('Bilibili returned a non-JSON search response')
      }
      const bytes = await readResponseBytes(response, MAX_SEARCH_RESPONSE_BYTES)
      try {
        return JSON.parse(bytes.toString('utf8'))
      } catch {
        throw new Error('Bilibili returned malformed search data')
      }
    }
    throw new Error('Bilibili search redirect validation failed')
  }

  async function getWbiMixinKey(signal) {
    if (cachedWbiKey && Date.now() < cachedWbiKeyExpiresAt) {
      return cachedWbiKey
    }
    const payload = await fetchBoundedJson(
      BILIBILI_WBI_NAV_URL,
      '/x/web-interface/nav',
      signal,
    )
    const imgKey = extractWbiImageKey(payload?.data?.wbi_img?.img_url)
    const subKey = extractWbiImageKey(payload?.data?.wbi_img?.sub_url)
    // The anonymous nav response uses code -101 while still exposing the same
    // public WBI key pair. Only the validated key URLs are authoritative here.
    if (!imgKey || !subKey) {
      throw new Error('Bilibili did not provide a valid WBI signing key')
    }
    cachedWbiKey = createMixinKey(imgKey, subKey)
    cachedWbiKeyExpiresAt = Date.now() + WBI_KEY_CACHE_MS
    return cachedWbiKey
  }

  async function searchVideos(request = {}) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('A Bilibili search request is required')
    }
    if (
      Object.keys(request).some(
        (key) =>
          key !== 'query' &&
          key !== 'limit' &&
          key !== 'page' &&
          key !== 'searchType',
      )
    ) {
      throw new TypeError(
        'Only a Bilibili search query, limit, page, and search type are accepted',
      )
    }
    const query = boundedText(request.query, MAX_SEARCH_QUERY_LENGTH)
    const limit = normalizeSearchLimit(request.limit)
    const page = normalizeSearchPage(request.page)
    const searchType = request.searchType ?? 'all'
    if (!['all', 'video', 'bangumi', 'film', 'live'].includes(searchType)) {
      throw new TypeError('An unsupported Bilibili search type was requested')
    }
    if (!query) throw new TypeError('A non-empty Bilibili search query is required')

    if (searchType === 'live') {
      return {
        query,
        page,
        pageSize: limit,
        totalCount: 0,
        hasMore: false,
        nextPage: null,
        results: [],
      }
    }

    // Keep a stable per-source page size so advancing the combined page never
    // skips the ordinary-video results displaced by promoted bangumi entries.
    const bangumiPageSize = searchType === 'all'
      ? (limit === 1 ? 0 : Math.max(1, Math.floor(limit / 3)))
      : (searchType === 'bangumi' || searchType === 'film' ? limit : 0)
    const videoPageSize = searchType === 'all'
      ? limit - bangumiPageSize
      : (searchType === 'video' ? limit : 0)
    const officialSearchType = searchType === 'film'
      ? 'media_ft'
      : 'media_bangumi'

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT_MS)
    try {
      const mixinKey = await getWbiMixinKey(controller.signal)
      const videoSearchTask = videoPageSize === 0
        ? Promise.resolve({
            results: [],
            pagination: { page, totalCount: 0, numPages: 0, hasMore: false },
          })
        : (async () => {
            const searchUrl = createBilibiliSearchApiUrl(
              query,
              videoPageSize,
              mixinKey,
              Math.floor(Date.now() / 1_000),
              'video',
              page,
            )
            const payload = await fetchBoundedJson(
              searchUrl,
              '/x/web-interface/wbi/search/type',
              controller.signal,
            )
            const results = normalizeBilibiliSearchResponse(
              payload,
              videoPageSize,
            )
            return {
              results,
              pagination: normalizeBilibiliSearchPagination(
                payload,
                page,
                videoPageSize,
                results.length,
              ),
            }
          })()
      const bangumiSearchTask = bangumiPageSize === 0
        ? Promise.resolve({
            results: [],
            pagination: {
              page,
              totalCount: 0,
              numPages: 0,
              hasMore: false,
            },
          })
        : (async () => {
            const searchUrl = createBilibiliSearchApiUrl(
              query,
              bangumiPageSize,
              mixinKey,
              Math.floor(Date.now() / 1_000),
              officialSearchType,
              page,
            )
            const payload = await fetchBoundedJson(
              searchUrl,
              '/x/web-interface/wbi/search/type',
              controller.signal,
            )
            const results = normalizeBilibiliBangumiSearchResponse(
              payload,
              bangumiPageSize,
              officialSearchType,
            )
            return {
              results,
              pagination: normalizeBilibiliSearchPagination(
                payload,
                page,
                bangumiPageSize,
                results.length,
              ),
            }
          })()
      const [videoOutcome, bangumiOutcome] = await Promise.allSettled([
        videoSearchTask,
        bangumiSearchTask,
      ])
      if (videoOutcome.status === 'rejected' && bangumiOutcome.status === 'rejected') {
        throw videoOutcome.reason instanceof Error
          ? videoOutcome.reason
          : bangumiOutcome.reason
      }
      const descriptors = mergeBilibiliSearchResults(
        videoOutcome.status === 'fulfilled' ? videoOutcome.value.results : [],
        bangumiOutcome.status === 'fulfilled' ? bangumiOutcome.value.results : [],
        limit,
      )
      const results = await Promise.all(
        descriptors.map(async (descriptor) => ({
          ...descriptor,
          thumbnailPath: await cacheBilibiliCover(
            descriptor.coverUrl,
            controller.signal,
          ),
        })),
      )
      const videoPagination =
        videoOutcome.status === 'fulfilled'
          ? videoOutcome.value.pagination
          : { totalCount: 0, hasMore: false }
      const bangumiPagination =
        bangumiOutcome.status === 'fulfilled'
          ? bangumiOutcome.value.pagination
          : { totalCount: 0, hasMore: false }
      const hasMore =
        videoPagination.hasMore || bangumiPagination.hasMore
      return {
        query,
        page,
        pageSize: limit,
        totalCount:
          videoPagination.totalCount + bangumiPagination.totalCount,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
        results,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Bilibili search timed out')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async function findCachedCover(basePath) {
    for (const extension of BILIBILI_IMAGE_CONTENT_TYPES.values()) {
      const candidate = `${basePath}${extension}`
      try {
        const stat = await fs.stat(candidate)
        if (
          stat.isFile() &&
          stat.size > 0 &&
          stat.size <= MAX_COVER_BYTES
        ) {
          return candidate
        }
      } catch {
        // A missing or stale cache entry is fetched again below.
      }
    }
    return null
  }

  async function cacheBilibiliCover(value, signal) {
    const coverUrl = normalizeCoverUrl(value)
    if (
      !coverUrl ||
      !normalizedCacheDirectory ||
      typeof sharedSession.fetch !== 'function'
    ) {
      return null
    }

    const activeTask = coverCacheTasks.get(coverUrl)
    if (activeTask) return activeTask

    const task = (async () => {
      await fs.mkdir(normalizedCacheDirectory, {
        recursive: true,
        mode: 0o700,
      })
      const cacheKey = crypto
        .createHash('sha256')
        .update(coverUrl)
        .digest('hex')
      const basePath = path.join(normalizedCacheDirectory, cacheKey)
      const existingPath = await findCachedCover(basePath)
      if (existingPath) return existingPath

      let currentUrl = coverUrl
      let response = null
      for (
        let redirectCount = 0;
        redirectCount <= MAX_SEARCH_REDIRECTS;
        redirectCount += 1
      ) {
        response = await sharedSession.fetch(currentUrl, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'manual',
          signal,
        })
        const responseUrl = normalizeCoverUrl(response.url || currentUrl)
        if (!responseUrl) {
          throw new Error('Bilibili cover returned an untrusted URL')
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers?.get?.('location')
          const redirectUrl = location
            ? normalizeCoverUrl(new URL(location, responseUrl).toString())
            : null
          if (!redirectUrl || redirectCount === MAX_SEARCH_REDIRECTS) {
            throw new Error('Bilibili cover returned an invalid redirect')
          }
          currentUrl = redirectUrl
          continue
        }
        break
      }
      const finalUrl = normalizeCoverUrl(response?.url || currentUrl)
      if (!response.ok || !finalUrl) {
        throw new Error('Bilibili cover request was rejected')
      }
      const contentType = String(response.headers?.get?.('content-type') ?? '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase()
      const extension = BILIBILI_IMAGE_CONTENT_TYPES.get(contentType)
      if (!extension) {
        throw new Error('Bilibili cover has an unsupported image type')
      }

      const destinationPath = `${basePath}${extension}`
      const bytes = await readResponseBytes(response)
      const temporaryPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`
      try {
        await fs.writeFile(temporaryPath, bytes, { mode: 0o600 })
        await fs.rename(temporaryPath, destinationPath)
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      }
      return destinationPath
    })()
      .catch(() => null)
      .finally(() => coverCacheTasks.delete(coverUrl))

    coverCacheTasks.set(coverUrl, task)
    return task
  }

  function focusWindow(windowInstance) {
    if (!windowInstance || windowInstance.isDestroyed()) return false
    if (windowInstance.isMinimized?.()) windowInstance.restore?.()
    windowInstance.show?.()
    windowInstance.focus?.()
    return true
  }

  function guardRemoteWebContents(contents, { allowVideoPopup = false } = {}) {
    const guardNavigation = (event, url) => {
      if (!isAllowedBilibiliNavigationUrl(url)) event.preventDefault()
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      const video = allowVideoPopup ? parseBilibiliVideoPage(url) : null
      if (video) {
        setImmediate(() => {
          if (!contents.isDestroyed()) {
            void contents.loadURL(video.url).catch(() => undefined)
          }
        })
      }
      return { action: 'deny' }
    })
  }

  function keepLoginWindowWindowed(windowInstance) {
    const contents = windowInstance.webContents
    const forceWindowed = () => {
      if (windowInstance.isDestroyed?.()) return
      windowInstance.setKiosk?.(false)
      windowInstance.setSimpleFullScreen?.(false)
      windowInstance.setFullScreen?.(false)
      if (contents.isDestroyed?.()) return
      try {
        const exitRequest = contents.executeJavaScript?.(
          `(() => {
            const request = document.fullscreenElement && document.exitFullscreen
              ? document.exitFullscreen()
              : null;
            if (request && typeof request.catch === 'function') request.catch(() => undefined);
            return true;
          })()`,
          true,
        )
        exitRequest?.catch?.(() => undefined)
      } catch {
        // The document can disappear while an authentication redirect finishes.
      }
    }
    windowInstance.setFullScreenable?.(false)
    windowInstance.setKiosk?.(false)
    windowInstance.setSimpleFullScreen?.(false)
    windowInstance.setFullScreen?.(false)
    windowInstance.on?.('enter-full-screen', forceWindowed)
    contents.on?.('enter-html-full-screen', forceWindowed)
    return () => {
      windowInstance.removeListener?.('enter-full-screen', forceWindowed)
      contents.removeListener?.('enter-html-full-screen', forceWindowed)
    }
  }

  function secureWindowOptions(title, dimensions) {
    const parent = getParentWindow?.()
    return {
      ...dimensions,
      parent: parent && !parent.isDestroyed?.() ? parent : undefined,
      modal: false,
      show: false,
      title,
      backgroundColor: '#080b11',
      autoHideMenuBar: true,
      webPreferences: {
        session: sharedSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: Boolean(isDev),
        spellcheck: false,
      },
    }
  }

  async function createLoginWindow() {
    const windowInstance = new BrowserWindow(
      secureWindowOptions('登录 Bilibili（官方网页）', {
        width: 980,
        height: 760,
        minWidth: 760,
        minHeight: 620,
        center: true,
        frame: true,
        titleBarStyle: 'default',
        closable: true,
        minimizable: true,
        maximizable: false,
        fullscreen: false,
        fullscreenable: false,
      }),
    )
    loginWindow = windowInstance
    windowInstance.setMenuBarVisibility?.(false)
    const removeWindowModeGuard = keepLoginWindowWindowed(windowInstance)
    guardRemoteWebContents(windowInstance.webContents)
    windowInstance.once('ready-to-show', () => focusWindow(windowInstance))
    windowInstance.once('closed', () => {
      removeWindowModeGuard()
      if (loginWindow === windowInstance) loginWindow = null
      void flushSession()
        .then(() => emitAuthState())
        .catch(() => undefined)
    })
    try {
      await windowInstance.loadURL(BILIBILI_LOGIN_URL)
      return true
    } catch (error) {
      if (!windowInstance.isDestroyed()) windowInstance.close()
      throw error
    }
  }

  async function openLogin() {
    if (!focusWindow(loginWindow)) await createLoginWindow()
    const state = await getAuthState()
    if (state.signedIn) await completeAuthenticatedLogin()
    return state
  }

  async function extractSelection(contents) {
    if (contents.isDestroyed()) return
    const currentVideo = parseBilibiliVideoPage(contents.getURL())
    if (!currentVideo) return
    try {
      const raw = await contents.executeJavaScript(
        READ_PUBLIC_VIDEO_META_SCRIPT,
        true,
      )
      if (contents.isDestroyed()) return
      const descriptor = normalizeBilibiliSelectionDescriptor(raw)
      if (!descriptor) return
      descriptor.thumbnailPath = await cacheBilibiliCover(descriptor.coverUrl)
      if (contents.isDestroyed()) return
      const fingerprint = JSON.stringify(descriptor)
      if (fingerprint === lastSelectionFingerprint) return
      lastSelectionFingerprint = fingerprint
      onSelection(descriptor)
    } catch {
      // A navigation can replace the document while metadata is being read.
    }
  }

  async function createContentWindow(initialUrl) {
    const windowInstance = new BrowserWindow(
      secureWindowOptions('Bilibili 官方播放', {
        width: 1280,
        height: 820,
        minWidth: 900,
        minHeight: 640,
      }),
    )
    contentWindow = windowInstance
    lastSelectionFingerprint = ''
    windowInstance.setMenuBarVisibility?.(false)
    const contents = windowInstance.webContents
    guardRemoteWebContents(contents, { allowVideoPopup: true })
    contents.on('did-finish-load', () => {
      void extractSelection(contents)
    })
    contents.on('did-navigate-in-page', () => {
      setTimeout(() => void extractSelection(contents), 250)
    })
    windowInstance.once('ready-to-show', () => focusWindow(windowInstance))
    windowInstance.once('closed', () => {
      if (contentWindow === windowInstance) contentWindow = null
      lastSelectionFingerprint = ''
      void flushSession().catch(() => undefined)
    })
    try {
      await windowInstance.loadURL(initialUrl)
      return true
    } catch (error) {
      if (!windowInstance.isDestroyed()) windowInstance.close()
      throw error
    }
  }

  async function navigateContentWindow(url) {
    if (!isAllowedBilibiliNavigationUrl(url)) {
      throw new TypeError('The Bilibili navigation URL is invalid')
    }
    if (!contentWindow || contentWindow.isDestroyed()) {
      return createContentWindow(url)
    }
    lastSelectionFingerprint = ''
    focusWindow(contentWindow)
    await contentWindow.loadURL(url)
    return true
  }

  function openVideo(request) {
    return navigateContentWindow(createBilibiliVideoUrl(request))
  }

  function closeWindows() {
    for (const windowInstance of [loginWindow, contentWindow]) {
      if (windowInstance && !windowInstance.isDestroyed()) {
        windowInstance.close()
      }
    }
    loginWindow = null
    contentWindow = null
  }

  async function logout() {
    authStateEmissionSuppressed = true
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
      authStateEmissionSuppressed = false
    }
    lastSignedIn = false
    const state = { signedIn: false }
    onAuthStateChange(state)
    return state
  }

  function dispose() {
    if (disposed) return
    disposed = true
    sharedSession.removeListener?.('will-download', handleDownload)
    sharedSession.cookies.removeListener?.('changed', handleCookieChanged)
    closeWindows()
    void flushSession()
  }

  return {
    closeWindows,
    dispose,
    flushSession,
    getAuthState,
    logout,
    openLogin,
    openVideo,
    searchVideos,
  }
}

module.exports = {
  BILIBILI_AUTH_COOKIE_NAME,
  BILIBILI_EMBEDDED_PLAYER_CSS,
  BILIBILI_LOGIN_URL,
  BILIBILI_NAVIGATION_HOSTS,
  BILIBILI_PARTITION,
  captureBilibiliEmbeddedFrame,
  createBilibiliSearchApiUrl,
  createBilibiliBangumiSearchApiUrl,
  createBilibiliSearchUrl,
  createBilibiliSessionManager,
  createBilibiliVideoUrl,
  createMixinKey,
  guardBilibiliPlayerGuestWebContents,
  hardenBilibiliPlayerWebPreferences,
  installBilibiliPlayerWebviewGuard,
  isAllowedBilibiliEmbeddedPageUrl,
  isAllowedBilibiliNavigationUrl,
  isAllowedBilibiliPlayerUrl,
  normalizeBilibiliSearchResponse,
  normalizeBilibiliSearchPagination,
  normalizeBilibiliBangumiSearchResponse,
  normalizeBilibiliSelectionDescriptor,
  parseBilibiliEmbeddedPageUrl,
  parseBilibiliVideoPage,
}
