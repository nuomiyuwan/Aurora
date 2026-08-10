const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const TENCENT_VIDEO_PARTITION = 'persist:aurora-tencent-v1'
const TENCENT_VIDEO_LOGIN_URL = 'https://v.qq.com/biu/u/history/'
const TENCENT_SEARCH_ENDPOINT =
  'https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch?vversion_platform=2'
const TENCENT_VIDEO_HOST = 'v.qq.com'
const TENCENT_SEARCH_HOST = 'pbaccess.video.qq.com'
const VIDEO_ID_PATTERN = /^[0-9A-Za-z]{11}$/
const COVER_ID_PATTERN = /^[0-9A-Za-z]{11,32}$/
const MAX_QUERY_LENGTH = 160
const DEFAULT_LIMIT = 12
const MAX_LIMIT = 18
const MAX_PAGE = 1_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_COVER_BYTES = 12 * 1024 * 1024
const SEARCH_TIMEOUT_MS = 12_000
const MAX_EMBEDDED_FRAME_EDGE = 480
const MAX_EMBEDDED_FRAME_DATA_URL_LENGTH = 3 * 1024 * 1024
const EMBEDDED_FRAME_READY_TIMEOUT_MS = 1_500
const EMBEDDED_FRAME_CAPTURE_TIMEOUT_MS = 2_500

// Tencent Video uses parallel cookie names for QQ and WeChat login.  The
// `main_login` discriminator and the matching user/session pair are the most
// stable signals exposed by the official web client; access-token fallbacks
// cover older and gradually rolled-out versions of the same login flow.
const TENCENT_AUTH_COOKIE_NAMES = new Set([
  'access_token',
  'main_login',
  'openid',
  'v_main_login',
  'v_t_access_token',
  'v_t_openid',
  'v_vusession',
  'v_vuserid',
  'vusession',
  'vuserid',
  'vqq_access_token',
  'vqq_openid',
  'vqq_vusession',
  'vqq_vuserid',
  'wxaccess_token',
  'wxopenid',
])

const TENCENT_EMBEDDED_GUESTS = new WeakMap()
const IMAGE_CONTENT_TYPES = new Map([
  ['image/avif', '.avif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])

const TENCENT_EMBEDDED_PLAYER_CSS = `
html:has(:is(#main-player, #player-component, [data-mvp-identifier="player"], #mod_player, #player-container, .txp_player, .txp-player)),
html:has(:is(#main-player, #player-component, [data-mvp-identifier="player"], #mod_player, #player-container, .txp_player, .txp-player)) body {
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  overflow: hidden !important;
  background: #03060a !important;
}

body:has(:is(#main-player, #player-component, [data-mvp-identifier="player"], #mod_player, #player-container, .txp_player, .txp-player)) > * {
  visibility: hidden !important;
}

body:has([data-mvp-identifier="player"]) :is([data-mvp-identifier="player"], [data-mvp-identifier="player"] *),
body:not(:has([data-mvp-identifier="player"])):has(#player-component) :is(#player-component, #player-component *),
body:not(:has([data-mvp-identifier="player"])):not(:has(#player-component)):has(#main-player) :is(#main-player, #main-player *),
body:has(#mod_player) :is(#mod_player, #mod_player *),
body:has(#player-container) :is(#player-container, #player-container *),
body:has(.txp_player) :is(.txp_player, .txp_player *),
body:has(.txp-player) :is(.txp-player, .txp-player *) {
  visibility: visible !important;
}

body:has([data-mvp-identifier="player"]) [data-mvp-identifier="player"],
body:not(:has([data-mvp-identifier="player"])):has(#player-component) #player-component,
body:not(:has([data-mvp-identifier="player"])):not(:has(#player-component)):has(#main-player) #main-player,
body:has(#mod_player) #mod_player,
body:has(#player-container) #player-container,
body:has(.txp_player) .txp_player,
body:has(.txp-player) .txp-player {
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

/* Tencent's official player can render a full-surface outbound-link affordance
   in the centre of the video. Aurora keeps the official playback controls but
   does not expose that page-navigation overlay inside its embedded frame. */
body:has(:is(#main-player, #player-component)) .txp_overlay_link,
body:has(:is(#main-player, #player-component)) .txp_icon_link {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`

const READ_VIDEO_FRAME_READY_SCRIPT = `
(() => new Promise((resolve) => {
  const video = Array.from(document.querySelectorAll('video')).find(
    (candidate) =>
      candidate.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      candidate.videoWidth > 0 && candidate.videoHeight > 0 && !candidate.seeking
  )
  if (!video) { resolve(false); return }
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    resolve(document.contains(video) &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0 && video.videoHeight > 0 && !video.seeking)
  }
  const timeout = window.setTimeout(finish, 280)
  const afterPaint = () => {
    window.clearTimeout(timeout)
    window.requestAnimationFrame(() => window.requestAnimationFrame(finish))
  }
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(afterPaint)
  } else afterPaint()
}))()
`

function boundedText(value, maximumLength) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength)
}

function decodeHtmlText(value, maximumLength = 500) {
  if (typeof value !== 'string') return ''
  return boundedText(
    value
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'"),
    maximumLength,
  )
}

function parseSecureUrl(value) {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed
      : null
  } catch {
    return null
  }
}

function isAllowedTencentAuthNavigationUrl(value) {
  const parsed = parseSecureUrl(value)
  if (!parsed || (parsed.port && parsed.port !== '443')) return false
  const hostname = parsed.hostname.toLowerCase()
  return (
    hostname === 'qq.com' ||
    hostname.endsWith('.qq.com') ||
    hostname === 'weixin.qq.com' ||
    hostname.endsWith('.weixin.qq.com')
  )
}

function detectTencentAuthCookieState(cookies) {
  const values = new Map()
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    const name = typeof cookie?.name === 'string'
      ? cookie.name.trim().toLowerCase()
      : ''
    const value = typeof cookie?.value === 'string' ? cookie.value.trim() : ''
    if (TENCENT_AUTH_COOKIE_NAMES.has(name) && value) values.set(name, value)
  }
  const has = (...names) => names.some((name) => values.has(name))
  // Tencent's current web runtime deliberately reads the new `v_*` family
  // first, then treats both prefixed and unprefixed legacy names as fallbacks
  // for the same fields.  In particular, a QQ flow can legitimately expose
  // `main_login=qq` together with `vuserid` / `vusession`, so do not use
  // `main_login` to force one prefix family.  A user identifier AND a session
  // credential are still required, preventing a stale discriminator or ID
  // cookie from being reported as signed in.
  const hasUserIdentifier = has(
    'v_vuserid',
    'v_t_openid',
    'vqq_vuserid',
    'vqq_openid',
    'vuserid',
    'wxopenid',
    'openid',
  )
  const hasSessionCredential = has(
    'v_vusession',
    'v_t_access_token',
    'vqq_vusession',
    'vqq_access_token',
    'vusession',
    'access_token',
    'wxaccess_token',
  )
  return { signedIn: hasUserIdentifier && hasSessionCredential }
}

function isTencentAuthCookie(cookie) {
  const name = typeof cookie?.name === 'string'
    ? cookie.name.toLowerCase()
    : ''
  const domain = typeof cookie?.domain === 'string'
    ? cookie.domain.replace(/^\./, '').toLowerCase()
    : ''
  return (
    TENCENT_AUTH_COOKIE_NAMES.has(name) &&
    (domain === 'qq.com' || domain.endsWith('.qq.com'))
  )
}

function parseTencentEmbeddedPageUrl(value, allowTracking = false) {
  const parsed = parseSecureUrl(value)
  if (!parsed || parsed.hostname !== TENCENT_VIDEO_HOST) return null
  if (!allowTracking && (parsed.search || parsed.hash)) return null
  const videoMatch = /^\/x\/page\/([0-9A-Za-z]{11})\.html$/.exec(
    parsed.pathname,
  )
  if (videoMatch) {
    return {
      kind: 'video',
      mediaId: videoMatch[1],
      videoId: videoMatch[1],
      url: `https://${TENCENT_VIDEO_HOST}/x/page/${videoMatch[1]}.html`,
    }
  }
  const coverMatch =
    /^\/x\/cover\/([0-9A-Za-z]{11,32})(?:\/([0-9A-Za-z]{11}))?\.html$/.exec(
      parsed.pathname,
    )
  if (!coverMatch) return null
  const videoSuffix = coverMatch[2] ? `/${coverMatch[2]}` : ''
  return {
    kind: 'episode',
    mediaId: coverMatch[1],
    videoId: coverMatch[2] ?? '',
    url: `https://${TENCENT_VIDEO_HOST}/x/cover/${coverMatch[1]}${videoSuffix}.html`,
  }
}

function isSameTencentMedia(left, right) {
  return Boolean(
    left && right && left.kind === right.kind && left.mediaId === right.mediaId,
  )
}

function hardenTencentWebPreferences(webPreferences) {
  if (!webPreferences || typeof webPreferences !== 'object') return
  Object.assign(webPreferences, {
    partition: TENCENT_VIDEO_PARTITION,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    disableHtmlFullscreenWindowResize: true,
  })
  delete webPreferences.preload
  delete webPreferences.preloadURL
}

function guardTencentGuestWebContents(
  contents,
  lockedPage,
  expectedSession = null,
) {
  const reportedPartition = contents?.session?.getPartition?.()
  if (
    !contents ||
    !lockedPage ||
    contents.isDestroyed?.() === true ||
    (expectedSession && contents.session !== expectedSession) ||
    (reportedPartition && reportedPartition !== TENCENT_VIDEO_PARTITION)
  ) {
    return false
  }
  let activePage = lockedPage
  const isPermitted = (value) => {
    const page = parseTencentEmbeddedPageUrl(value, true)
    return isSameTencentMedia(page, lockedPage)
  }
  const guardNavigation = (event, url) => {
    if (!isPermitted(url)) event.preventDefault()
  }
  const finishNavigation = (_event, url, isMainFrame = true) => {
    if (isMainFrame === false) return
    const page = parseTencentEmbeddedPageUrl(url, true)
    if (isSameTencentMedia(page, lockedPage)) {
      activePage = page
      return
    }
    void Promise.resolve(contents.loadURL?.(activePage.url)).catch(() => undefined)
  }
  let documentGeneration = 0
  let styledGeneration = -1
  const applyPlayerCss = (force = false) => {
    if (typeof contents.insertCSS !== 'function' || !isPermitted(contents.getURL?.())) {
      return
    }
    if (!force && styledGeneration === documentGeneration) return
    const generation = documentGeneration
    styledGeneration = generation
    void Promise.resolve(contents.insertCSS(TENCENT_EMBEDDED_PLAYER_CSS)).catch(
      () => {
        if (styledGeneration === generation) styledGeneration = -1
      },
    )
  }
  contents.on('will-navigate', guardNavigation)
  contents.on('will-redirect', guardNavigation)
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame !== false && !inPlace) {
      documentGeneration += 1
      styledGeneration = -1
    }
  })
  contents.on('did-navigate', finishNavigation)
  contents.on('did-navigate-in-page', finishNavigation)
  contents.on('dom-ready', () => applyPlayerCss(false))
  contents.on('did-finish-load', () => applyPlayerCss(false))
  contents.on('did-stop-loading', () => applyPlayerCss(false))
  contents.on('leave-html-full-screen', () => {
    applyPlayerCss(true)
    contents.invalidate?.()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler?.(() => ({ action: 'deny' }))
  // A cached official page can finish before the host receives
  // `did-attach-webview`, so do not rely solely on document-ready events.
  applyPlayerCss(true)
  return true
}

function installTencentPlayerWebviewGuard(hostContents, expectedSession = null) {
  const pendingPages = []
  const installation = {
    activeGuest: null,
    activeLockedPage: null,
    disposed: false,
  }
  const handleWillAttach = (event, webPreferences, params = {}) => {
    const parameterPartition = params?.partition
    const preferencePartition = webPreferences?.partition
    if (
      parameterPartition !== TENCENT_VIDEO_PARTITION &&
      preferencePartition !== TENCENT_VIDEO_PARTITION
    ) {
      // The central online-player firewall rejects unknown partitions. This
      // guard only validates and styles Tencent's reviewed guest.
      return
    }
    hardenTencentWebPreferences(webPreferences)
    const hardenedPreferencePartition = webPreferences?.partition
    const page = parseTencentEmbeddedPageUrl(params?.src)
    if (
      parameterPartition !== TENCENT_VIDEO_PARTITION ||
      hardenedPreferencePartition !== TENCENT_VIDEO_PARTITION ||
      !page
    ) {
      event.preventDefault()
      return
    }
    pendingPages.push(page)
  }
  const handleDidAttach = (_event, guestContents) => {
    if (expectedSession && guestContents?.session !== expectedSession) return
    if (pendingPages.length === 0) return
    const page = pendingPages.shift()
    if (
      !page ||
      !guardTencentGuestWebContents(guestContents, page, expectedSession)
    ) return
    installation.activeGuest = guestContents
    installation.activeLockedPage = page
    guestContents.once?.('destroyed', () => {
      if (installation.activeGuest === guestContents) {
        installation.activeGuest = null
        installation.activeLockedPage = null
      }
    })
  }
  hostContents.on('will-attach-webview', handleWillAttach)
  hostContents.on('did-attach-webview', handleDidAttach)
  const dispose = () => {
    if (installation.disposed) return
    installation.disposed = true
    pendingPages.length = 0
    installation.activeGuest = null
    installation.activeLockedPage = null
    hostContents.removeListener?.('will-attach-webview', handleWillAttach)
    hostContents.removeListener?.('did-attach-webview', handleDidAttach)
    if (TENCENT_EMBEDDED_GUESTS.get(hostContents) === installation) {
      TENCENT_EMBEDDED_GUESTS.delete(hostContents)
    }
  }
  TENCENT_EMBEDDED_GUESTS.set(hostContents, installation)
  return dispose
}

function settleOperation(operation, timeoutMs) {
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

async function captureTencentEmbeddedFrame(hostContents, request) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    typeof request.mediaId !== 'string' ||
    !['video', 'episode'].includes(request.kind)
  ) {
    return null
  }
  const validId = request.kind === 'video'
    ? VIDEO_ID_PATTERN.test(request.mediaId)
    : COVER_ID_PATTERN.test(request.mediaId)
  const installation = TENCENT_EMBEDDED_GUESTS.get(hostContents)
  const guest = installation?.activeGuest
  const lockedPage = installation?.activeLockedPage
  if (
    !validId || !installation || installation.disposed || !guest ||
    guest.isDestroyed?.() === true || !lockedPage ||
    lockedPage.kind !== request.kind || lockedPage.mediaId !== request.mediaId
  ) {
    return null
  }
  try {
    const ready = await settleOperation(
      guest.executeJavaScript(READ_VIDEO_FRAME_READY_SCRIPT, true),
      EMBEDDED_FRAME_READY_TIMEOUT_MS,
    )
    if (ready !== true || installation.activeGuest !== guest) return null
    let image = await settleOperation(
      guest.capturePage(),
      EMBEDDED_FRAME_CAPTURE_TIMEOUT_MS,
    )
    if (!image || image.isEmpty?.() !== false) return null
    const size = image.getSize?.()
    if (!size?.width || !size?.height) return null
    if (Math.max(size.width, size.height) > MAX_EMBEDDED_FRAME_EDGE) {
      image = image.resize?.(
        size.width >= size.height
          ? { width: MAX_EMBEDDED_FRAME_EDGE, quality: 'good' }
          : { height: MAX_EMBEDDED_FRAME_EDGE, quality: 'good' },
      )
    }
    const dataUrl = image?.toDataURL?.()
    return typeof dataUrl === 'string' &&
      dataUrl.length <= MAX_EMBEDDED_FRAME_DATA_URL_LENGTH &&
      /^data:image\/(?:png|jpeg);base64,/.test(dataUrl)
      ? dataUrl
      : null
  } catch {
    return null
  }
}

function normalizeLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new TypeError('Tencent search result limit is invalid')
  }
  return value
}

function normalizePage(value) {
  if (value === undefined) return 1
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE) {
    throw new TypeError('Tencent search page is invalid')
  }
  return value
}

const TENCENT_SEARCH_TYPE_TERMS = Object.freeze({
  kids: ['少儿', '儿童', '亲子'],
  documentary: ['纪录片', '纪录'],
  anime: ['动漫', '动画', '国漫'],
  variety: ['综艺'],
  tv: ['电视剧', '电视'],
})

function normalizeTencentSearchType(value) {
  const searchType = value ?? 'all'
  if (searchType !== 'all' && !TENCENT_SEARCH_TYPE_TERMS[searchType]) {
    throw new TypeError('Tencent search type is invalid')
  }
  return searchType
}

function matchesTencentSearchType(descriptor, searchType) {
  if (searchType === 'all') return true
  const searchable = descriptor.tags.join(' ').toLowerCase()
  return TENCENT_SEARCH_TYPE_TERMS[searchType].some((term) =>
    searchable.includes(term.toLowerCase()),
  )
}

function formatDuration(secondsValue) {
  const seconds = Number(secondsValue)
  if (!Number.isFinite(seconds) || seconds <= 0) return '由腾讯视频页面提供'
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const rest = rounded % 60
  return hours > 0
    ? [hours, minutes, rest].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, rest].map((value) => String(value).padStart(2, '0')).join(':')
}

function normalizeCoverUrl(value) {
  if (typeof value !== 'string') return null
  const secureValue = value.startsWith('//')
    ? `https:${value}`
    : value.replace(/^http:\/\//i, 'https://')
  const parsed = parseSecureUrl(secureValue)
  if (!parsed || !/(?:^|\.)qpic\.cn$/.test(parsed.hostname)) return null
  return parsed.toString()
}

function normalizeTencentSearchPayload(
  payload,
  { query, page, limit, searchType: rawSearchType },
) {
  const searchType = normalizeTencentSearchType(rawSearchType)
  const albumItems = (payload?.data?.areaBoxList ?? []).flatMap((box) =>
    Array.isArray(box?.itemList) ? box.itemList : [],
  )
  const normalList = payload?.data?.normalList
  const normalItems = Array.isArray(normalList?.itemList)
    ? normalList.itemList
    : []
  const results = []
  const seen = new Set()

  const appendAlbum = (item) => {
    const info = item?.videoInfo
    const mediaId = boundedText(item?.doc?.id, 64)
    if (item?.doc?.dataType !== 2 || !COVER_ID_PATTERN.test(mediaId)) return
    const site = Array.isArray(info?.playSites)
      ? info.playSites.find((entry) => entry?.enName === 'qq')
      : null
    const episode = site?.episodeInfoList?.find((entry) => {
      const videoId = boundedText(entry?.id, 32)
      if (!VIDEO_ID_PATTERN.test(videoId)) return false
      const suppliedUrl = boundedText(entry?.url, 2_048)
      if (!suppliedUrl) return true
      const suppliedPage = parseTencentEmbeddedPageUrl(suppliedUrl)
      return suppliedPage?.kind === 'episode' &&
        suppliedPage.mediaId === mediaId &&
        suppliedPage.videoId === videoId
    })
    if (!episode || seen.has(`episode:${mediaId}`)) return
    seen.add(`episode:${mediaId}`)
    const videoId = boundedText(episode.id, 32)
    const suppliedPage = episode.url
      ? parseTencentEmbeddedPageUrl(episode.url)
      : null
    const canonicalUrl = suppliedPage?.url ??
      `https://${TENCENT_VIDEO_HOST}/x/cover/${mediaId}/${videoId}.html`
    const title = decodeHtmlText(info?.title, 300)
    results.push({
      source: 'tencent',
      kind: 'episode',
      mediaId,
      videoId,
      title: title || mediaId,
      description: boundedText(info?.descrip, 2_000),
      coverUrl: normalizeCoverUrl(info?.imgUrl),
      thumbnailPath: null,
      author: boundedText(info?.directors?.join('、'), 300) || '腾讯视频',
      url: canonicalUrl,
      canonicalUrl,
      duration: `共 ${Number(site.totalEpisode) || 0} 集`,
      publishedAt: boundedText(info?.checkupTime, 80),
      tags: [info?.typeName, info?.area, ...(info?.language ?? [])]
        .map((value) => boundedText(value, 80))
        .filter(Boolean),
    })
  }
  const appendVideo = (item) => {
    const info = item?.videoInfo
    const mediaId = boundedText(item?.doc?.id, 32)
    if (item?.doc?.dataType !== 1 || !VIDEO_ID_PATTERN.test(mediaId) || !info) return
    if (seen.has(`video:${mediaId}`)) return
    seen.add(`video:${mediaId}`)
    const url = `https://${TENCENT_VIDEO_HOST}/x/page/${mediaId}.html`
    results.push({
      source: 'tencent',
      kind: 'video',
      mediaId,
      videoId: mediaId,
      title: decodeHtmlText(info.title, 300) || mediaId,
      description: boundedText(info.descrip, 2_000),
      coverUrl: normalizeCoverUrl(info.imgUrl),
      thumbnailPath: null,
      author: boundedText(info?.videoDoc?.uploader, 300) || '未公开',
      url,
      canonicalUrl: url,
      duration: formatDuration(info?.videoDoc?.timeLong),
      publishedAt: boundedText(info.checkupTime, 80),
      tags: [info.typeName, info.views]
        .map((value) => boundedText(value, 80))
        .filter(Boolean),
    })
  }

  albumItems.forEach(appendAlbum)
  // Tencent currently returns official series inside normalList as dataType 2
  // for many common queries. Treat each normal item by its declared type;
  // `seen` keeps area-box duplicates from appearing twice.
  normalItems.forEach((item) => {
    appendAlbum(item)
    appendVideo(item)
  })
  const boundedResults = results
    .filter((descriptor) => matchesTencentSearchType(descriptor, searchType))
    .slice(0, limit)
  const normalTotal = Number(normalList?.totalNum)
  const totalCount = Math.max(
    boundedResults.length,
    (Number.isFinite(normalTotal) ? Math.max(0, Math.round(normalTotal)) : 0) +
      albumItems.filter((item) => item?.doc?.dataType === 2).length,
  )
  return {
    query,
    page,
    pageSize: limit,
    totalCount,
    hasMore: page * limit < totalCount,
    nextPage: page * limit < totalCount ? page + 1 : null,
    results: boundedResults,
  }
}

function createTencentVideoSessionManager({
  BrowserWindow,
  sessionModule,
  getParentWindow = () => null,
  cacheDirectory,
  isDev = false,
  onAuthStateChange = () => undefined,
} = {}) {
  if (typeof BrowserWindow !== 'function') {
    throw new TypeError('BrowserWindow is required')
  }
  if (!sessionModule || typeof sessionModule.fromPartition !== 'function') {
    throw new TypeError('Electron session is required')
  }
  const sharedSession = sessionModule.fromPartition(TENCENT_VIDEO_PARTITION, {
    cache: true,
  })
  const requestUuid = crypto.randomUUID().toUpperCase()
  const coverTasks = new Map()
  let loginWindow = null
  let lastSignedIn = null
  let disposed = false
  let authStateEmissionSuppressed = false
  let loginCompletion = null

  const isLoginWebContents = (contents) =>
    Boolean(
      contents &&
      loginWindow &&
      !loginWindow.isDestroyed?.() &&
      contents === loginWindow.webContents,
    )

  const permissionAllowed = (contents, permission, origin) => {
    const parsed = parseSecureUrl(origin)
    return (
      permission === 'fullscreen' &&
      !isLoginWebContents(contents) &&
      parsed?.hostname === TENCENT_VIDEO_HOST
    )
  }
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
      url: `https://${TENCENT_VIDEO_HOST}`,
    })
    return detectTencentAuthCookieState(cookies)
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
    if (isTencentAuthCookie(cookie)) {
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

  function focusWindow(windowInstance) {
    if (!windowInstance || windowInstance.isDestroyed()) return false
    if (windowInstance.isMinimized?.()) windowInstance.restore?.()
    windowInstance.show?.()
    windowInstance.focus?.()
    return true
  }

  function guardLoginWebContents(contents) {
    const guardNavigation = (event, url) => {
      if (!isAllowedTencentAuthNavigationUrl(url)) event.preventDefault()
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler?.(({ url }) => {
      if (isAllowedTencentAuthNavigationUrl(url)) {
        setImmediate(() => {
          if (!contents.isDestroyed?.()) {
            void contents.loadURL(url).catch(() => undefined)
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
      secureWindowOptions('登录腾讯视频（官方网页）', {
        width: 1120,
        height: 780,
        minWidth: 820,
        minHeight: 640,
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
    guardLoginWebContents(windowInstance.webContents)
    windowInstance.once('ready-to-show', () => focusWindow(windowInstance))
    windowInstance.once('closed', () => {
      removeWindowModeGuard()
      if (loginWindow === windowInstance) loginWindow = null
      void flushSession()
        .then(() => emitAuthState())
        .catch(() => undefined)
    })
    try {
      await windowInstance.loadURL(TENCENT_VIDEO_LOGIN_URL)
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

  function closeWindows() {
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
    loginWindow = null
  }

  const readJson = async (response) => {
    const declared = Number(response.headers?.get?.('content-length'))
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new Error('Tencent search response exceeds the size limit')
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('Tencent search response exceeds the size limit')
    }
    return JSON.parse(new TextDecoder().decode(bytes))
  }

  const cacheCover = async (coverUrl) => {
    if (!coverUrl) return null
    if (coverTasks.has(coverUrl)) return coverTasks.get(coverUrl)
    const task = (async () => {
      await fs.mkdir(cacheDirectory, { recursive: true, mode: 0o700 })
      const key = crypto.createHash('sha256').update(coverUrl).digest('hex')
      // Electron's session.fetch applies Chromium's forbidden-header rules.
      // Supplying a synthetic Referer from Aurora's file:// renderer causes
      // net::ERR_BLOCKED_BY_CLIENT before the request reaches qpic.cn.
      const response = await sharedSession.fetch(coverUrl)
      if (!response.ok) return null
      const contentType = String(response.headers?.get?.('content-type') ?? '')
        .split(';', 1)[0].trim().toLowerCase()
      const extension = IMAGE_CONTENT_TYPES.get(contentType)
      if (!extension) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_COVER_BYTES) return null
      const destination = path.join(cacheDirectory, `${key}${extension}`)
      const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
      try {
        await fs.writeFile(temporary, bytes, { mode: 0o600 })
        await fs.rename(temporary, destination)
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => undefined)
      }
      return destination
    })().catch(() => null).finally(() => coverTasks.delete(coverUrl))
    coverTasks.set(coverUrl, task)
    return task
  }

  const searchVideos = async (request) => {
    const query = boundedText(request?.query, MAX_QUERY_LENGTH)
    if (!query) throw new TypeError('A non-empty Tencent search query is required')
    const limit = normalizeLimit(request?.limit)
    const page = normalizePage(request?.page)
    const searchType = normalizeTencentSearchType(request?.searchType)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
    try {
      const body = {
        version: '26022601',
        clientType: 1,
        filterValue: '',
        uuid: requestUuid,
        retry: 0,
        query,
        pagenum: page - 1,
        isPrefetch: page === 1,
        pagesize: limit,
        queryFrom: 0,
        searchDatakey: '',
        transInfo: '',
        isneedQc: true,
        preQid: '',
        adClientInfo: '',
        extraInfo: {
          isNewMarkLabel: '1',
          multi_terminal_pc: '1',
          themeType: '1',
          sugRelatedIds: '{}',
          appVersion: '',
          frontVersion: '26060108',
        },
        featureList: [
          'DEFAULT_FEFEATURE',
          'PC_SHORT_VIDEOS_WATERFALL',
          'PC_WANT_EPISODE_V2',
          'PC_WANT_EPISODE',
        ],
      }
      // Use Node's fetch for this JSON endpoint. Electron's session.fetch
      // rejects the official Tencent Referer as a forbidden synthetic header,
      // while omitting it makes the endpoint return an empty result set.
      const response = await globalThis.fetch(TENCENT_SEARCH_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://v.qq.com',
          Referer: `https://v.qq.com/x/search/?q=${encodeURIComponent(query)}`,
        },
        body: JSON.stringify(body),
      })
      if (
        !response.ok ||
        new URL(response.url).hostname !== TENCENT_SEARCH_HOST
      ) {
        throw new Error('Tencent search request was rejected')
      }
      const normalized = normalizeTencentSearchPayload(
        await readJson(response),
        { query, page, limit, searchType },
      )
      normalized.results = await Promise.all(
        normalized.results.map(async (descriptor) => ({
          ...descriptor,
          thumbnailPath: await cacheCover(descriptor.coverUrl),
        })),
      )
      return normalized
    } finally {
      clearTimeout(timer)
    }
  }

  async function logout() {
    authStateEmissionSuppressed = true
    try {
      closeWindows()
      await sharedSession.closeAllConnections?.()
      if (typeof sharedSession.clearData === 'function') {
        // `sharedSession` is the dedicated persist:aurora-tencent-v1
        // partition, so this cannot remove Bilibili or Aurora app data.
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

  return {
    closeWindows,
    dispose() {
      if (disposed) return
      disposed = true
      sharedSession.removeListener?.('will-download', handleDownload)
      sharedSession.cookies.removeListener?.('changed', handleCookieChanged)
      closeWindows()
      void flushSession()
    },
    flushSession,
    getAuthState,
    logout,
    openLogin,
    searchVideos,
  }
}

module.exports = {
  TENCENT_EMBEDDED_PLAYER_CSS,
  TENCENT_VIDEO_LOGIN_URL,
  TENCENT_VIDEO_PARTITION,
  captureTencentEmbeddedFrame,
  createTencentVideoSessionManager,
  detectTencentAuthCookieState,
  installTencentPlayerWebviewGuard,
  isAllowedTencentAuthNavigationUrl,
  normalizeTencentSearchPayload,
  parseTencentEmbeddedPageUrl,
}
