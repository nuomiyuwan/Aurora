const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const YOUKU_PARTITION = 'persist:aurora-online-youku-v1'
const YOUKU_LOGIN_URL = 'https://account.youku.com/login.htm'
const YOUKU_AUTH_COOKIE_NAME = 'P_gck'
const YOUKU_SEARCH_HOST = 'so.youku.com'
const YOUKU_VIDEO_HOST = 'v.youku.com'
const SHOW_ID_PATTERN = /^[0-9A-Za-z_-]{6,64}$/
const VIDEO_ID_PATTERN = /^X[0-9A-Za-z_-]{8,80}={0,2}$/
const MAX_QUERY_LENGTH = 160
const DEFAULT_LIMIT = 12
const MAX_LIMIT = 20
const MAX_SEARCH_BYTES = 6 * 1024 * 1024
const MAX_COVER_BYTES = 12 * 1024 * 1024
const SEARCH_TIMEOUT_MS = 12_000
const OFFICIAL_SEARCH_TIMEOUT_MS = 28_000
const OFFICIAL_CLIENT_WAIT_MS = 4_000
const OFFICIAL_REQUEST_TIMEOUT_MS = 8_000
const OFFICIAL_SEARCH_MAX_ATTEMPTS = 2
const OFFICIAL_SEARCH_RETRY_DELAY_MS = 350
const OFFICIAL_SEARCH_IDLE_MS = 30_000
const COVER_FETCH_ATTEMPTS = 3
const COVER_FETCH_TIMEOUT_MS = 3_000
const IMAGE_CONTENT_TYPES = new Map([
  ['image/avif', '.avif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])
const GENERIC_BINARY_CONTENT_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
])

const YOUKU_EMBEDDED_GUESTS = new WeakMap()

const RETRYABLE_OFFICIAL_SEARCH_CODES = new Set([
  'YOUKU_SEARCH_CLIENT_NOT_READY',
  'YOUKU_SEARCH_PAGE_LOAD_FAILED',
  'YOUKU_SEARCH_REQUEST_FAILED',
  'YOUKU_SEARCH_REQUEST_TIMEOUT',
  'YOUKU_SEARCH_RESPONSE_TRANSIENT',
  'YOUKU_SEARCH_TOKEN_STALE',
])

// The official page remains the authority for playback, adverts, membership,
// DRM and region checks.  These rules only size the reviewed player roots to
// Aurora's media viewport.  In particular, never hide or remove sibling DOM:
// Youku uses page-owned advert surfaces and integrity checks outside different
// player roots during its rollout, and treating those nodes as decoration can
// both suppress an advert and make the official player report an ad blocker.
const YOUKU_EMBEDDED_PLAYER_CSS = `
html:has(:is(#ykPlayer, #player, #playerBox, .youku-player, .ykplayer, .kplayer)),
html:has(:is(#ykPlayer, #player, #playerBox, .youku-player, .ykplayer, .kplayer)) body {
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  overflow: hidden !important;
  background: #03060a !important;
}

body:has(:is(#ykPlayer, #player, #playerBox, .youku-player, .ykplayer, .kplayer))
  :is(#ykPlayer, #player, #playerBox, .youku-player, .ykplayer, .kplayer) {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  background: #03060a !important;
}
`

function parseSecureUrl(value) {
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) return null
    return parsed
  } catch {
    return null
  }
}

function normalizeShowId(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return SHOW_ID_PATTERN.test(text) ? text : null
}

function normalizeVideoId(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return VIDEO_ID_PATTERN.test(text) ? text : null
}

function createYoukuPlaybackUrl({ showId, videoId } = {}) {
  const safeShowId = normalizeShowId(showId)
  const safeVideoId = normalizeVideoId(videoId)
  if (safeShowId && safeVideoId) {
    return `https://${YOUKU_VIDEO_HOST}/video?s=${encodeURIComponent(safeShowId)}&vid=${encodeURIComponent(safeVideoId)}`
  }
  if (safeShowId) {
    return `https://${YOUKU_VIDEO_HOST}/video?s=${encodeURIComponent(safeShowId)}`
  }
  if (safeVideoId) {
    return `https://${YOUKU_VIDEO_HOST}/v_show/id_${safeVideoId}.html`
  }
  throw new TypeError('A valid Youku show or video ID is required')
}

function createYoukuSearchUrl(query) {
  const value = typeof query === 'string' ? query.trim() : ''
  if (!value || value.length > MAX_QUERY_LENGTH) {
    throw new TypeError('Youku search query is invalid')
  }
  return `https://${YOUKU_SEARCH_HOST}/search/q_${encodeURIComponent(value)}`
}

function parseYoukuOfficialPageUrl(value, allowTracking = false) {
  const parsed = parseSecureUrl(value)
  if (!parsed || parsed.hostname !== YOUKU_VIDEO_HOST || parsed.hash) return null
  if (parsed.pathname === '/video' || parsed.pathname === '/video/') {
    const allowed = new Set(['s', 'vid'])
    if (!allowTracking) {
      for (const key of parsed.searchParams.keys()) {
        if (!allowed.has(key)) return null
      }
    }
    const showValues = parsed.searchParams.getAll('s')
    const videoValues = parsed.searchParams.getAll('vid')
    if (showValues.length > 1 || videoValues.length > 1) return null
    const showId = showValues.length === 1
      ? normalizeShowId(showValues[0])
      : null
    const videoId = videoValues.length === 1
      ? normalizeVideoId(videoValues[0])
      : null
    if (
      (!showId && !videoId) ||
      (showValues.length === 1 && !showId) ||
      (videoValues.length === 1 && !videoId)
    ) return null
    if (!showId) {
      return {
        kind: 'video',
        mediaId: videoId,
        showId: null,
        videoId,
        url: createYoukuPlaybackUrl({ videoId }),
      }
    }
    return {
      kind: 'episode',
      mediaId: showId,
      showId,
      videoId,
      url: createYoukuPlaybackUrl({ showId, videoId }),
    }
  }
  const match = /^\/v_show\/id_(X[0-9A-Za-z_-]{8,80}={0,2})\.html$/.exec(
    parsed.pathname,
  )
  const videoId = normalizeVideoId(match?.[1])
  if (!videoId || (!allowTracking && parsed.search)) return null
  return {
    kind: 'video',
    mediaId: videoId,
    showId: null,
    videoId,
    url: createYoukuPlaybackUrl({ videoId }),
  }
}

function isSameYoukuMedia(left, right) {
  return Boolean(
    left && right && left.kind === right.kind && left.mediaId === right.mediaId,
  )
}

function isAllowedYoukuAuthNavigationUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.username || parsed.password || parsed.port) return false
  if (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'youku.com' || parsed.hostname === 'www.youku.com')
  ) return true
  if (parsed.protocol !== 'https:') return false
  return (
    parsed.hostname === 'youku.com' ||
    parsed.hostname === 'www.youku.com' ||
    parsed.hostname === 'account.youku.com' ||
    parsed.hostname === 'cnpassport.youku.com' ||
    parsed.hostname === 'cnpassport.youku.tv' ||
    parsed.hostname === 'passport.youku.com' ||
    parsed.hostname === 'login.youku.com'
  )
}

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function detectYoukuAuthCookieState(cookies) {
  const authCookie = Array.isArray(cookies)
    ? cookies.find((cookie) => cookie?.name === YOUKU_AUTH_COOKIE_NAME)
    : null
  const segments = typeof authCookie?.value === 'string'
    ? decodeCookieValue(authCookie.value).split('|')
    : []
  const accountMarker = segments[1]?.trim()
  return {
    signedIn: Boolean(accountMarker && accountMarker !== 'NA'),
  }
}

function hardenYoukuPlayerWebPreferences(webPreferences) {
  if (!webPreferences || typeof webPreferences !== 'object') return
  Object.assign(webPreferences, {
    partition: YOUKU_PARTITION,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    plugins: false,
    spellcheck: false,
    devTools: false,
    navigateOnDragDrop: false,
    disableHtmlFullscreenWindowResize: true,
  })
  delete webPreferences.preload
  delete webPreferences.preloadURL
  delete webPreferences.session
}

function guardYoukuGuestWebContents(contents, lockedPage, expectedSession) {
  const reportedPartition = contents?.session?.getPartition?.()
  if (
    !contents ||
    !lockedPage ||
    contents.isDestroyed?.() === true ||
    (expectedSession && contents.session !== expectedSession) ||
    (reportedPartition && reportedPartition !== YOUKU_PARTITION)
  ) return false
  let activePage = lockedPage
  const isPermitted = (value) =>
    isSameYoukuMedia(parseYoukuOfficialPageUrl(value, true), lockedPage)
  const guardTopLevelNavigation = (event, url) => {
    if (!isPermitted(url)) event.preventDefault()
  }
  const guardRedirect = (event, url, _inPlace, isMainFrame = true) => {
    // Subframe redirects are owned by the official player.  They include
    // advert delivery and playback services and must not be constrained to a
    // v.youku.com media-page URL.  Only the outer document is identity-locked.
    if (isMainFrame !== false && !isPermitted(url)) event.preventDefault()
  }
  const finishNavigation = (_event, url, isMainFrame = true) => {
    if (isMainFrame === false) return
    const page = parseYoukuOfficialPageUrl(url, true)
    if (isSameYoukuMedia(page, lockedPage)) {
      activePage = page
      return
    }
    void Promise.resolve(contents.loadURL?.(activePage.url)).catch(() => undefined)
  }
  let documentGeneration = 0
  let styledGeneration = -1
  const applyCss = (force = false) => {
    if (
      typeof contents.insertCSS !== 'function' ||
      !isPermitted(contents.getURL?.()) ||
      (!force && styledGeneration === documentGeneration)
    ) return
    const generation = documentGeneration
    styledGeneration = generation
    void Promise.resolve(contents.insertCSS(YOUKU_EMBEDDED_PLAYER_CSS)).catch(
      () => {
        if (styledGeneration === generation) styledGeneration = -1
      },
    )
  }
  contents.on('will-navigate', guardTopLevelNavigation)
  contents.on('will-redirect', guardRedirect)
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame !== false && !inPlace) {
      documentGeneration += 1
      styledGeneration = -1
    }
  })
  contents.on('did-navigate', finishNavigation)
  contents.on('did-navigate-in-page', finishNavigation)
  contents.on('dom-ready', () => applyCss(false))
  contents.on('did-finish-load', () => applyCss(false))
  contents.on('did-stop-loading', () => applyCss(false))
  contents.on('leave-html-full-screen', () => {
    applyCss(true)
    contents.invalidate?.()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler?.(() => ({ action: 'deny' }))
  applyCss(true)
  return true
}

function installYoukuPlayerWebviewGuard(hostContents, expectedSession = null) {
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
      parameterPartition !== YOUKU_PARTITION &&
      preferencePartition !== YOUKU_PARTITION
    ) {
      // Each provider owns only its reviewed partition. The central firewall
      // is responsible for unknown webviews.
      return
    }
    hardenYoukuPlayerWebPreferences(webPreferences)
    const page = parseYoukuOfficialPageUrl(params?.src)
    if (
      parameterPartition !== YOUKU_PARTITION ||
      webPreferences?.partition !== YOUKU_PARTITION ||
      !page
    ) {
      event.preventDefault()
      return
    }
    pendingPages.push(page)
  }
  const handleDidAttach = (_event, guestContents) => {
    if (expectedSession && guestContents?.session !== expectedSession) return
    const page = pendingPages.shift()
    if (!page || !guardYoukuGuestWebContents(guestContents, page, expectedSession)) {
      return
    }
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
    if (YOUKU_EMBEDDED_GUESTS.get(hostContents) === installation) {
      YOUKU_EMBEDDED_GUESTS.delete(hostContents)
    }
  }
  YOUKU_EMBEDDED_GUESTS.set(hostContents, installation)
  return dispose
}

function extractBalancedJson(source, startIndex) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') depth += 1
    if (character === '}' || character === ']') depth -= 1
    if (depth === 0) return source.slice(startIndex, index + 1)
    if (depth < 0) return null
  }
  return null
}

// Signed-in Youku search pages currently serialize a small number of Date
// values as `new Date(...)` inside the otherwise JSON-compatible
// `window.__INITIAL_DATA__` object.  Never evaluate that page source in the
// main process.  Instead, normalize only this tightly constrained constructor
// form and let JSON.parse continue to reject every other JavaScript expression.
function normalizeYoukuInitialDataJson(source) {
  let output = ''
  let index = 0
  while (index < source.length) {
    if (source[index] === '"') {
      const start = index
      index += 1
      let escaped = false
      while (index < source.length) {
        const character = source[index]
        index += 1
        if (escaped) {
          escaped = false
          continue
        }
        if (character === '\\') {
          escaped = true
          continue
        }
        if (character === '"') break
      }
      output += source.slice(start, index)
      continue
    }

    const previous = source[index - 1] ?? ''
    if (
      source.startsWith('new Date', index) &&
      !/[0-9A-Z_$]/i.test(previous)
    ) {
      let cursor = index + 'new Date'.length
      while (/\s/.test(source[cursor] ?? '')) cursor += 1
      if (source[cursor] !== '(') {
        output += source[index]
        index += 1
        continue
      }
      cursor += 1
      while (/\s/.test(source[cursor] ?? '')) cursor += 1

      let replacement = 'null'
      if (source[cursor] === '"') {
        const valueStart = cursor
        cursor += 1
        let escaped = false
        while (cursor < source.length) {
          const character = source[cursor]
          cursor += 1
          if (escaped) {
            escaped = false
            continue
          }
          if (character === '\\') {
            escaped = true
            continue
          }
          if (character === '"') break
        }
        replacement = source.slice(valueStart, cursor)
        // Validate the literal independently before accepting it.
        JSON.parse(replacement)
      } else {
        const numericMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
          source.slice(cursor),
        )
        if (numericMatch) {
          replacement = numericMatch[0]
          cursor += numericMatch[0].length
        } else if (source.startsWith('null', cursor)) {
          cursor += 4
        }
      }

      while (/\s/.test(source[cursor] ?? '')) cursor += 1
      if (source[cursor] !== ')') {
        throw new Error('Youku search data is malformed')
      }
      output += replacement
      index = cursor + 1
      continue
    }

    output += source[index]
    index += 1
  }
  return output
}

function extractYoukuInitialData(html) {
  if (typeof html !== 'string' || html.length > MAX_SEARCH_BYTES) {
    throw new TypeError('Youku search document is invalid')
  }
  const marker = /window\.__INITIAL_DATA__\s*=\s*/g
  const match = marker.exec(html)
  if (!match) throw new Error('Youku search data was not found')
  let start = marker.lastIndex
  while (/\s/.test(html[start] ?? '')) start += 1
  if (html[start] !== '{') throw new Error('Youku search data is malformed')
  const json = extractBalancedJson(html, start)
  if (!json) throw new Error('Youku search data is incomplete')
  try {
    const payload = JSON.parse(normalizeYoukuInitialDataJson(json))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('invalid root')
    }
    return payload
  } catch {
    throw new Error('Youku search data is malformed')
  }
}

const HTML_ENTITIES = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['nbsp', ' '],
  ['quot', '"'],
])

function decodeHtmlEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return HTML_ENTITIES.get(entity.toLowerCase()) ?? whole
  })
}

function boundedText(value, maxLength = 240) {
  if (typeof value !== 'string') return ''
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function safeCoverUrl(value) {
  if (typeof value !== 'string') return ''
  let candidate = value.trim()
  if (candidate.startsWith('//')) candidate = `https:${candidate}`
  if (candidate.startsWith('http://')) candidate = `https://${candidate.slice(7)}`
  const parsed = parseSecureUrl(candidate)
  if (
    !parsed ||
    !(
      parsed.hostname === 'ykimg.com' ||
      parsed.hostname.endsWith('.ykimg.com') ||
      parsed.hostname === 'ykimg.alicdn.com'
    )
  ) return ''
  return parsed.href
}

function firstSafeCoverUrl(...values) {
  for (const value of values) {
    const coverUrl = safeCoverUrl(value)
    if (coverUrl) return coverUrl
  }
  return ''
}

function detectImageExtension(data) {
  if (!Buffer.isBuffer(data)) return null
  if (
    data.byteLength >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) return '.jpg'
  if (
    data.byteLength >= 8 &&
    data.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) return '.png'
  if (
    data.byteLength >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return '.webp'
  if (
    data.byteLength >= 12 &&
    data.subarray(4, 8).toString('ascii') === 'ftyp' &&
    ['avif', 'avis'].includes(data.subarray(8, 12).toString('ascii'))
  ) return '.avif'
  return null
}

function isRetryableCoverStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function waitForCoverRetry(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)))
}

function collectNestedData(root, predicate) {
  const queue = [{ value: root, depth: 0 }]
  const visited = new Set()
  let count = 0
  while (queue.length > 0 && count < 2_000) {
    const { value, depth } = queue.shift()
    if (!value || typeof value !== 'object' || visited.has(value)) continue
    visited.add(value)
    count += 1
    if (value.data && typeof value.data === 'object' && predicate(value.data)) {
      return value.data
    }
    if (predicate(value)) return value
    if (depth >= 8) continue
    const children = Array.isArray(value) ? value : value.nodes
    if (Array.isArray(children)) {
      children.slice(0, 200).forEach((child) => {
        queue.push({ value: child, depth: depth + 1 })
      })
    }
  }
  return null
}

function uniqueTags(values) {
  const result = []
  const seen = new Set()
  values.flatMap((value) => {
    const text = boundedText(value, 80)
    return text.includes('·') ? text.split('·') : [text]
  }).forEach((value) => {
    const tag = boundedText(value, 24)
    if (tag && !seen.has(tag) && result.length < 12) {
      seen.add(tag)
      result.push(tag)
    }
  })
  return result
}

function stripLabel(value) {
  return boundedText(value, 120).replace(/^[^：:]{1,12}[：:]\s*/, '')
}

function normalizeProgram(data) {
  if (!data || typeof data !== 'object') return null
  const showId = normalizeShowId(data.realShowId || data.showId)
  if (!showId) return null
  const title = boundedText(
    data.titleDTO?.displayName || data.tempTitle || data.title,
    180,
  )
  if (!title) return null
  const screenshot = data.screenShotDTO || {}
  const coverUrl = firstSafeCoverUrl(
    data.thumbUrl,
    data.posterDTO?.vThumbUrl,
    data.posterDTO?.thumbUrl,
    data.posterDTO?.newImgInfo?.thumbUrl,
    screenshot.thumbUrl,
    screenshot.newImgInfo?.thumbUrl,
    data.newImgInfo?.thumbUrl,
    data.sourceImg,
  )
  const episodeCount = Number(data.episodeTotal || data.episodeCollect)
  const duration = boundedText(data.stripeBottom, 48) || (
    Number.isFinite(episodeCount) && episodeCount > 0
      ? `共 ${Math.round(episodeCount)} 集`
      : ''
  )
  return {
    source: 'youku',
    kind: 'episode',
    mediaId: showId,
    showId,
    videoId: null,
    title,
    description: boundedText(data.info || data.subTitle, 480).replace(/^简介[：:]\s*/, ''),
    coverUrl,
    thumbnailPath: null,
    author: stripLabel(data.director) || '优酷',
    url: createYoukuPlaybackUrl({ showId }),
    canonicalUrl: createYoukuPlaybackUrl({ showId }),
    duration,
    publishedAt: '',
    tags: uniqueTags([
      data.featureDTO?.text,
      ...(Array.isArray(data.showMediaTag)
        ? data.showMediaTag.map((tag) => tag?.tagText)
        : []),
      ...(Array.isArray(data.cats) ? data.cats : []),
    ]),
  }
}

function normalizeDirectVideo(data) {
  if (!data || typeof data !== 'object') return null
  const videoId = normalizeVideoId(data.videoId)
  if (!videoId) return null
  const title = boundedText(data.titleDTO?.displayName || data.title, 180)
  if (!title) return null
  const screenshot = data.screenShotDTO || {}
  return {
    source: 'youku',
    kind: 'video',
    mediaId: videoId,
    showId: null,
    videoId,
    title,
    description: boundedText(data.subTitle || data.summary || data.info, 480),
    coverUrl: firstSafeCoverUrl(
      screenshot.thumbUrl,
      screenshot.newImgInfo?.thumbUrl,
      data.thumbUrl,
      data.posterDTO?.vThumbUrl,
      data.posterDTO?.thumbUrl,
      data.posterDTO?.newImgInfo?.thumbUrl,
      data.newImgInfo?.thumbUrl,
      data.sourceImg,
    ),
    thumbnailPath: null,
    author: boundedText(data.userName || data.userDTO?.userName, 120) || '优酷',
    url: createYoukuPlaybackUrl({ videoId }),
    canonicalUrl: createYoukuPlaybackUrl({ videoId }),
    duration: boundedText(screenshot.rightBottomText || data.duration, 48),
    publishedAt: boundedText(data.publishTime, 80),
    tags: uniqueTags([
      data.logCate === 'ugc' ? '用户视频' : '',
      ...(Array.isArray(data.tags) ? data.tags : []),
    ]),
  }
}

function normalizeLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new TypeError('Youku search result limit is invalid')
  }
  return value
}

function normalizeYoukuSearchPayload(payload, options = {}) {
  const query = boundedText(options.query, MAX_QUERY_LENGTH)
  const page = options.page === undefined ? 1 : options.page
  const limit = normalizeLimit(options.limit)
  if (!query) throw new TypeError('Youku search query is invalid')
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new TypeError('Youku search page is invalid')
  }
  const searchData = payload?.data?.data
  const roots = payload?.data?.nodes
  if (
    !Array.isArray(roots) ||
    searchData?.status && searchData.status !== 'success' ||
    Number(searchData?.rstate ?? 0) !== 0
  ) throw new Error('Youku search payload is invalid')
  const results = []
  const seen = new Set()
  roots.slice(0, 200).forEach((root) => {
    const programData = collectNestedData(root, (data) =>
      Boolean(normalizeShowId(data?.realShowId || data?.showId)),
    )
    const descriptor = programData
      ? normalizeProgram(programData)
      : normalizeDirectVideo(
        collectNestedData(root, (data) => Boolean(normalizeVideoId(data?.videoId))),
      )
    if (!descriptor) return
    const key = `${descriptor.kind}:${descriptor.mediaId}`
    if (seen.has(key)) return
    seen.add(key)
    results.push(descriptor)
  })
  const boundedResults = results.slice(0, limit)
  const remoteTotal = Number(searchData?.total)
  const totalCount = Number.isFinite(remoteTotal)
    ? Math.max(boundedResults.length, Math.round(Math.max(0, remoteTotal)))
    : boundedResults.length
  const remoteHasMore = payload?.data?.more === true || (
    Number.isFinite(Number(searchData?.isEnd)) && Number(searchData.isEnd) === 0
  )
  const hasMore = boundedResults.length > 0 && remoteHasMore && (
    !Number.isFinite(remoteTotal) || page * limit < totalCount
  )
  return {
    query,
    page,
    pageSize: limit,
    totalCount,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    results: boundedResults,
  }
}

async function readBoundedBody(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Youku response is too large')
  }
  const reader = response.body?.getReader?.()
  if (!reader) throw new Error('Youku response body is not streamable')
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      totalBytes += chunk.byteLength
      if (totalBytes > maxBytes) {
        await Promise.resolve(reader.cancel?.()).catch(() => undefined)
        throw new Error('Youku response is too large')
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks, totalBytes)
}

function createYoukuSearchError(message, code, cause) {
  const error = new Error(message)
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

function isRetryableOfficialSearchError(error) {
  return RETRYABLE_OFFICIAL_SEARCH_CODES.has(error?.code)
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function createYoukuOfficialPageSearchScript({ query, page, limit }) {
  const encodedRequest = Buffer.from(JSON.stringify({ query, page, limit }))
    .toString('base64')
  return String.raw`
(async () => {
  const request = JSON.parse(new TextDecoder().decode(
    Uint8Array.from(atob('${encodedRequest}'), (character) => character.charCodeAt(0)),
  ));
  const verificationIsVisible = () => Boolean(
    window._config_?.action === 'captcha' ||
    document.querySelector('iframe[src*="_____tmd_____/punish"]')
  );
  if (verificationIsVisible()) {
    return { verificationRequired: true };
  }
  const hydrationMarker = '__auroraYoukuSearchHydratedV1';
  if (window[hydrationMarker] !== true) {
    const hydrationDeadline = Date.now() + 1_600;
    while (Date.now() < hydrationDeadline && !verificationIsVisible()) {
      const initialSearchSettled = performance.getEntriesByType('resource').some(
        (entry) => /\/mtop\.youku\.soku\.yksearch\/2\.0\//i.test(entry.name)
          && Number(entry.responseEnd) > 0,
      );
      if (initialSearchSettled) break;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (verificationIsVisible()) {
      return { verificationRequired: true };
    }
    // Let the official page finish its own initial request before asking for
    // the next page. Overlapping those two requests is one trigger for its
    // validation flow, especially on a signed-in session.
    await new Promise((resolve) => setTimeout(resolve, 240));
    window[hydrationMarker] = true;
  }
  const clientDeadline = Date.now() + ${OFFICIAL_CLIENT_WAIT_MS};
  while (
    typeof window.lib?.mtop?.request !== 'function' &&
    Date.now() < clientDeadline &&
    !verificationIsVisible()
  ) {
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  if (verificationIsVisible()) {
    return { verificationRequired: true };
  }
  const mtop = window.lib?.mtop;
  if (!mtop || typeof mtop.request !== 'function') {
    return { transientFailure: 'client-not-ready' };
  }
  const initial = window.__INITIAL_DATA__ || {};
  const dailyExp = initial.vipinfo?.exp?.dailyExp;
  const userType = dailyExp === 0
    ? 'vip'
    : (typeof dailyExp === 'number' && dailyExp < 0 ? 'common' : 'guest');
  const systemInfo = {
    osVer: '1.0.0',
    zx: 0,
    appPackageKey: initial.checkIku ? 'com.youku.iku' : 'com.youku.pcweb',
    appPackageId: initial.checkIku ? 'com.youku.iku' : 'com.youku.pcweb',
    os: initial.checkIku ? 'iku' : 'pcweb',
    ver: initial.checkIku ? (initial.IKUBuildVersion || '9.0.0.0') : '1.0.0.0',
    pid: initial.pid || '',
  };
  mtop.config.prefix = 'acs';
  mtop.config.subDomain = '';
  mtop.config.mainDomain = 'youku.com';
  let timeoutId;
  let verificationInterval;
  let response;
  try {
    const officialRequest = Promise.resolve(mtop.request({
      api: 'mtop.youku.soku.yksearch',
      type: 'GET',
      v: '2.0',
      ecode: 1,
      dataType: 'json',
      data: {
        searchType: 1,
        keyword: request.query,
        pg: request.page,
        pz: request.limit,
        site: 1,
        appCaller: initial.checkIku ? 'iku' : 'pc',
        appScene: 'mobile_multi',
        userTerminal: 2,
        sdkver: 313,
        pcKuFlixMode: 1,
        userFrom: 1,
        noqc: 0,
        aaid: initial.aaid || '',
        ftype: 0,
        duration: '',
        categories: '',
        ob: '',
        utdId: window.apiArgumentsAttr?.cna || 'homepage_empty_cna',
        userType,
        userNumId: initial.userinfo?.content?.[0]?.ytid || 0,
        searchFrom: window.__searchFrom__ || initial.searchfrom || 1,
        sourceFrom: window.__sourceFrom__ || 'home',
        ykPid: initial.pid || '',
        appKey: '24679788',
        system_info: JSON.stringify(systemInfo),
      },
      appKey: 23774304,
      jsonpIncPrefix: 'headerSearch',
    }));
    response = await Promise.race([
      officialRequest,
      new Promise((resolve) => {
        timeoutId = setTimeout(
          () => resolve({ __auroraRequestTimedOut: true }),
          ${OFFICIAL_REQUEST_TIMEOUT_MS},
        );
      }),
      new Promise((resolve) => {
        verificationInterval = setInterval(() => {
          if (verificationIsVisible()) {
            resolve({ __auroraVerificationRequired: true });
          }
        }, 100);
      }),
    ]);
  } catch {
    return { transientFailure: 'request-failed' };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (verificationInterval !== undefined) clearInterval(verificationInterval);
  }
  if (response?.__auroraVerificationRequired) {
    return { verificationRequired: true };
  }
  if (response?.__auroraRequestTimedOut) {
    return { transientFailure: 'request-timeout' };
  }
  const ret = Array.isArray(response?.ret) ? response.ret.join(',') : '';
  if (/FAIL_SYS_USER_VALIDATE|RGV587_ERROR/i.test(ret)) {
    return { verificationRequired: true };
  }
  if (/FAIL_SYS_(?:TOKEN_(?:EXOIRED|EXPIRED|EMPTY)|ILLEGAL_ACCESS|SESSION_EXPIRED)/i.test(ret)) {
    return { transientFailure: 'token-stale' };
  }
  if (!response?.data || typeof response.data !== 'object') {
    return {
      transientFailure: /(?:TIMEOUT|NETWORK|SERVICE_UNAVAILABLE|SYSTEM_ERROR)/i.test(ret)
        ? 'response-transient'
        : null,
      officialFailure: true,
    };
  }
  return { data: response.data };
})()
  `.trim()
}

function createYoukuSessionManager({
  BrowserWindow,
  sessionModule,
  getParentWindow = () => null,
  cacheDirectory,
  coverFetchTimeoutMs = COVER_FETCH_TIMEOUT_MS,
  onAuthStateChange = () => undefined,
} = {}) {
  if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow is required')
  if (!sessionModule || typeof sessionModule.fromPartition !== 'function') {
    throw new TypeError('Electron session is required')
  }
  if (cacheDirectory !== undefined && !path.isAbsolute(cacheDirectory)) {
    throw new TypeError('Youku cache directory must be absolute')
  }
  if (
    !Number.isSafeInteger(coverFetchTimeoutMs) ||
    coverFetchTimeoutMs < 1 ||
    coverFetchTimeoutMs > 60_000
  ) {
    throw new TypeError('Youku cover fetch timeout is invalid')
  }
  const sharedSession = sessionModule.fromPartition(YOUKU_PARTITION, { cache: true })
  const coverTasks = new Map()
  const activeCoverControllers = new Set()
  const activeSearches = new Set()
  let officialSearchContext = null
  let officialSearchGeneration = 0
  let officialSearchQuery = ''
  let loginWindow = null
  let disposed = false
  let lastSignedIn = null
  let suppressAuthEmission = false

  const isLoginContents = (contents) => Boolean(
    loginWindow && !loginWindow.isDestroyed?.() && loginWindow.webContents === contents,
  )
  const permissionAllowed = (contents, permission, origin) => {
    const parsed = parseSecureUrl(origin)
    return permission === 'fullscreen' && !isLoginContents(contents) &&
      parsed?.hostname === YOUKU_VIDEO_HOST
  }
  sharedSession.setPermissionCheckHandler?.(
    (contents, permission, requestingOrigin, details = {}) =>
      permissionAllowed(
        contents,
        permission,
        requestingOrigin || details.requestingUrl || details.embeddingOrigin,
      ),
  )
  sharedSession.setPermissionRequestHandler?.(
    (contents, permission, callback, details = {}) => callback(
      permissionAllowed(
        contents,
        permission,
        details.requestingUrl || details.embeddingOrigin,
      ),
    ),
  )
  const preventDownload = (event) => event.preventDefault()
  sharedSession.on?.('will-download', preventDownload)

  async function flushSession() {
    await Promise.allSettled([
      sharedSession.cookies.flushStore?.(),
      sharedSession.flushStorageData?.(),
    ])
  }

  async function getAuthState() {
    const cookies = await sharedSession.cookies.get({ url: 'https://youku.com' })
    return detectYoukuAuthCookieState(cookies)
  }

  async function emitAuthState(force = false) {
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

  const handleCookieChanged = (_event, cookie) => {
    if (cookie?.name === YOUKU_AUTH_COOKIE_NAME) {
      void emitAuthState().catch(() => undefined)
    }
  }
  sharedSession.cookies.on?.('changed', handleCookieChanged)

  function focusWindow(windowInstance) {
    if (!windowInstance || windowInstance.isDestroyed?.()) return false
    if (windowInstance.isMinimized?.()) windowInstance.restore?.()
    windowInstance.show?.()
    windowInstance.focus?.()
    return true
  }

  function guardLoginContents(contents) {
    const navigate = (event, value) => {
      if (!isAllowedYoukuAuthNavigationUrl(value)) {
        event.preventDefault()
        return
      }
      const parsed = new URL(value)
      if (parsed.protocol === 'http:') {
        event.preventDefault()
        void contents.loadURL(`https://${parsed.hostname}/`).catch(() => undefined)
      }
    }
    contents.on('will-navigate', navigate)
    contents.on('will-redirect', navigate)
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler?.(({ url }) => {
      if (isAllowedYoukuAuthNavigationUrl(url)) {
        setImmediate(() => {
          if (!contents.isDestroyed?.()) void contents.loadURL(url).catch(() => undefined)
        })
      }
      return { action: 'deny' }
    })
  }

  function keepWindowed(windowInstance) {
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

  async function openLogin() {
    if (disposed) throw new Error('Youku session manager is disposed')
    if (focusWindow(loginWindow)) return getAuthState()
    const parent = getParentWindow?.()
    loginWindow = new BrowserWindow({
      width: 520,
      height: 720,
      minWidth: 440,
      minHeight: 600,
      parent: parent && !parent.isDestroyed?.() ? parent : undefined,
      modal: false,
      show: false,
      frame: true,
      closable: true,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      title: '登录优酷',
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
    await target.loadURL(YOUKU_LOGIN_URL)
    target.show?.()
    return getAuthState()
  }

  function closeWindows() {
    if (loginWindow && !loginWindow.isDestroyed?.()) loginWindow.close()
    loginWindow = null
  }

  async function logout() {
    suppressAuthEmission = true
    try {
      cancelSearches()
      closeWindows()
      await sharedSession.closeAllConnections?.()
      if (typeof sharedSession.clearData === 'function') await sharedSession.clearData()
      else {
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

  async function cacheCover(value) {
    const coverUrl = safeCoverUrl(value)
    if (!coverUrl || !cacheDirectory) return null
    if (coverTasks.has(coverUrl)) return coverTasks.get(coverUrl)
    const task = (async () => {
      await fs.mkdir(cacheDirectory, { recursive: true })
      const key = crypto.createHash('sha256').update(coverUrl).digest('hex')
      for (const extension of IMAGE_CONTENT_TYPES.values()) {
        const existing = path.join(cacheDirectory, `${key}${extension}`)
        try {
          await fs.access(existing)
          return existing
        } catch {
          // Try the other supported content types before downloading.
        }
      }
      let lastError = null
      for (let attempt = 0; attempt < COVER_FETCH_ATTEMPTS; attempt += 1) {
        let currentUrl = coverUrl
        try {
          for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
            const controller = new AbortController()
            activeCoverControllers.add(controller)
            const timeoutError = new Error('Youku cover request timed out')
            timeoutError.retryable = true
            let timeoutId
            let abortListener
            const aborted = new Promise((_resolve, reject) => {
              abortListener = () => reject(
                controller.signal.reason instanceof Error
                  ? controller.signal.reason
                  : new Error('Youku cover request was cancelled'),
              )
              controller.signal.addEventListener('abort', abortListener, { once: true })
            })
            timeoutId = setTimeout(() => controller.abort(timeoutError), coverFetchTimeoutMs)
            timeoutId.unref?.()
            let fetched
            try {
              fetched = await Promise.race([
                (async () => {
                  const response = await sharedSession.fetch(currentUrl, {
                    method: 'GET',
                    credentials: 'omit',
                    redirect: 'manual',
                    signal: controller.signal,
                    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
                  })
                  if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get('location')
                    const next = location
                      ? safeCoverUrl(new URL(location, currentUrl).href)
                      : ''
                    if (!next) throw new Error('Youku cover redirect was rejected')
                    return { next, data: null }
                  }
                  if (!response.ok) {
                    const error = new Error('Youku cover request failed')
                    error.retryable = isRetryableCoverStatus(response.status)
                    throw error
                  }
                  const contentType = (
                    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
                  )
                  if (
                    !IMAGE_CONTENT_TYPES.has(contentType) &&
                    !GENERIC_BINARY_CONTENT_TYPES.has(contentType)
                  ) throw new Error('Youku cover type is invalid')
                  return {
                    next: '',
                    data: await readBoundedBody(response, MAX_COVER_BYTES),
                  }
                })(),
                aborted,
              ])
            } finally {
              clearTimeout(timeoutId)
              if (abortListener) {
                controller.signal.removeEventListener('abort', abortListener)
              }
              activeCoverControllers.delete(controller)
            }
            if (fetched.next) {
              currentUrl = fetched.next
              continue
            }
            const data = fetched.data
            const extension = detectImageExtension(data)
            if (!extension) throw new Error('Youku cover signature is invalid')
            const destination = path.join(cacheDirectory, `${key}${extension}`)
            const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`
            await fs.writeFile(temporary, data, { flag: 'wx' })
            try {
              await fs.rename(temporary, destination)
            } catch (error) {
              await fs.rm(temporary, { force: true })
              if (error?.code !== 'EEXIST') throw error
            }
            return destination
          }
          throw new Error('Youku cover redirected too many times')
        } catch (error) {
          lastError = error
          const retryable = error?.retryable === true || error?.name === 'TypeError'
          if (!retryable || attempt + 1 >= COVER_FETCH_ATTEMPTS) throw error
          await waitForCoverRetry(attempt)
        }
      }
      throw lastError ?? new Error('Youku cover request failed')
    })().catch(() => null).finally(() => coverTasks.delete(coverUrl))
    coverTasks.set(coverUrl, task)
    return task
  }

  function destroySearchWindow(target) {
    if (!target || target.isDestroyed?.()) return
    if (typeof target.destroy === 'function') target.destroy()
    else target.close?.()
  }

  function clearOfficialSearchIdleTimer(context) {
    if (!context?.idleTimer) return
    clearTimeout(context.idleTimer)
    context.idleTimer = null
  }

  function closeOfficialSearchWindow(expectedContext = null) {
    const context = officialSearchContext
    if (!context || (expectedContext && context !== expectedContext)) return
    officialSearchContext = null
    clearOfficialSearchIdleTimer(context)
    if (context.owner) context.owner.searchWindow = null
    context.owner = null
    destroySearchWindow(context.window)
  }

  function releaseOperationSearchWindow(operation) {
    const context = officialSearchContext
    operation.searchWindow = null
    if (!context || context.owner !== operation) return
    context.owner = null
    clearOfficialSearchIdleTimer(context)
    context.idleTimer = setTimeout(() => {
      if (officialSearchContext === context && !context.owner) {
        closeOfficialSearchWindow(context)
      }
    }, OFFICIAL_SEARCH_IDLE_MS)
    context.idleTimer.unref?.()
  }

  function closeOperationSearchWindow(operation) {
    const context = officialSearchContext
    operation.searchWindow = null
    if (context?.owner === operation) closeOfficialSearchWindow(context)
  }

  function createOfficialSearchWindow(query, generation) {
    const searchWindow = new BrowserWindow({
      width: 1024,
      height: 720,
      show: false,
      frame: false,
      skipTaskbar: true,
      fullscreenable: false,
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
        backgroundThrottling: false,
      },
    })
    const context = {
      window: searchWindow,
      query,
      generation,
      owner: null,
      loaded: false,
      idleTimer: null,
    }
    const contents = searchWindow.webContents
    const allowSearchPage = (value) => {
      const parsed = parseSecureUrl(value)
      return Boolean(
        parsed &&
        parsed.hostname === YOUKU_SEARCH_HOST &&
        /^\/search\/q_[^/]{1,600}$/.test(parsed.pathname),
      )
    }
    const guardNavigation = (event, value) => {
      if (!allowSearchPage(value)) event.preventDefault()
    }
    contents.on?.('will-navigate', guardNavigation)
    contents.on?.('will-redirect', guardNavigation)
    contents.on?.('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler?.(() => ({ action: 'deny' }))
    searchWindow.once?.('closed', () => {
      if (officialSearchContext === context) {
        officialSearchContext = null
      }
      clearOfficialSearchIdleTimer(context)
      if (context.owner) context.owner.searchWindow = null
      context.owner = null
    })
    officialSearchContext = context
    return context
  }

  async function acquireOfficialSearchWindow(query, operation) {
    if (
      operation.cancelled ||
      operation.timedOut ||
      operation.generation !== officialSearchGeneration
    ) {
      throw createYoukuSearchError(
        'Youku search was cancelled',
        'YOUKU_SEARCH_CANCELLED',
      )
    }
    let context = officialSearchContext
    if (
      context &&
      (
        context.window.isDestroyed?.() ||
        context.query !== query ||
        context.generation !== operation.generation
      )
    ) {
      closeOfficialSearchWindow(context)
      context = null
    }
    if (context?.owner && context.owner !== operation) {
      throw createYoukuSearchError(
        'Youku search page is already in use',
        'YOUKU_SEARCH_PAGE_BUSY',
      )
    }
    if (!context) {
      context = createOfficialSearchWindow(query, operation.generation)
    }
    clearOfficialSearchIdleTimer(context)
    context.owner = operation
    operation.searchWindow = context.window
    if (!context.loaded) {
      try {
        await context.window.loadURL(createYoukuSearchUrl(query))
        context.loaded = true
      } catch (error) {
        closeOfficialSearchWindow(context)
        throw createYoukuSearchError(
          'Youku official search page failed to load',
          'YOUKU_SEARCH_PAGE_LOAD_FAILED',
          error,
        )
      }
    }
    if (
      operation.cancelled ||
      operation.timedOut ||
      operation.generation !== officialSearchGeneration ||
      context.window.isDestroyed?.()
    ) {
      closeOfficialSearchWindow(context)
      throw createYoukuSearchError(
        'Youku search was cancelled',
        'YOUKU_SEARCH_CANCELLED',
      )
    }
    return context
  }

  async function searchOfficialPage({ query, page, limit, operation }) {
    const context = await acquireOfficialSearchWindow(query, operation)
    try {
      const payload = await context.window.webContents.executeJavaScript(
        createYoukuOfficialPageSearchScript({ query, page, limit }),
        true,
      )
      if (payload?.verificationRequired) {
        throw createYoukuSearchError(
          'Youku search requires official verification',
          'YOUKU_SEARCH_VERIFICATION_REQUIRED',
        )
      }
      const transientCode = {
        'client-not-ready': 'YOUKU_SEARCH_CLIENT_NOT_READY',
        'request-failed': 'YOUKU_SEARCH_REQUEST_FAILED',
        'request-timeout': 'YOUKU_SEARCH_REQUEST_TIMEOUT',
        'response-transient': 'YOUKU_SEARCH_RESPONSE_TRANSIENT',
        'token-stale': 'YOUKU_SEARCH_TOKEN_STALE',
      }[payload?.transientFailure]
      if (transientCode) {
        throw createYoukuSearchError(
          'Youku official search request was temporarily unavailable',
          transientCode,
        )
      }
      if (payload?.officialFailure) {
        throw createYoukuSearchError(
          'Youku official search service rejected the request',
          'YOUKU_SEARCH_OFFICIAL_FAILURE',
        )
      }
      if (!payload?.data || typeof payload.data !== 'object') {
        throw createYoukuSearchError(
          'Youku official search response is invalid',
          'YOUKU_SEARCH_RESPONSE_INVALID',
        )
      }
      return payload
    } finally {
      releaseOperationSearchWindow(operation)
    }
  }

  async function searchVideos({ query, page = 1, limit } = {}) {
    if (disposed) throw new Error('Youku session manager is disposed')
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new TypeError('Youku search page is invalid')
    }
    const safeQuery = typeof query === 'string' ? query.trim() : ''
    const searchUrl = createYoukuSearchUrl(safeQuery)
    const safeLimit = normalizeLimit(limit)
    if (page === 1 || officialSearchQuery !== safeQuery) {
      officialSearchGeneration += 1
      officialSearchQuery = safeQuery
      activeSearches.forEach((existingOperation) => {
        if (!existingOperation.usesOfficialPage) return
        existingOperation.cancelled = true
        existingOperation.controller.abort()
        closeOperationSearchWindow(existingOperation)
        existingOperation.rejectOfficialPage?.(createYoukuSearchError(
          'Youku search was cancelled',
          'YOUKU_SEARCH_CANCELLED',
        ))
      })
      closeOfficialSearchWindow()
    }
    const controller = new AbortController()
    const operation = {
      controller,
      generation: officialSearchGeneration,
      rejectOfficialPage: null,
      searchWindow: null,
      searchCompleted: false,
      timedOut: false,
      cancelled: false,
      usesOfficialPage: page > 1,
    }
    activeSearches.add(operation)
    const timer = setTimeout(() => {
      if (operation.searchCompleted) return
      operation.timedOut = true
      controller.abort()
      closeOperationSearchWindow(operation)
      operation.rejectOfficialPage?.(createYoukuSearchError(
        page > 1
          ? 'Youku official search page timed out'
          : 'Youku search timed out',
        page > 1
          ? 'YOUKU_SEARCH_OFFICIAL_TIMEOUT'
          : 'YOUKU_SEARCH_TIMEOUT',
      ))
    }, page > 1 ? OFFICIAL_SEARCH_TIMEOUT_MS : SEARCH_TIMEOUT_MS)
    try {
      if (page > 1) {
        const officialPageTermination = new Promise((_resolve, reject) => {
          operation.rejectOfficialPage = reject
        })
        let officialPayload = null
        let lastOfficialError = null
        for (
          let attempt = 1;
          attempt <= OFFICIAL_SEARCH_MAX_ATTEMPTS;
          attempt += 1
        ) {
          try {
            officialPayload = await Promise.race([
              searchOfficialPage({
                query: safeQuery,
                page,
                limit: safeLimit,
                operation,
              }),
              officialPageTermination,
            ])
            break
          } catch (error) {
            lastOfficialError = error
            if (officialSearchContext?.generation === operation.generation) {
              closeOfficialSearchWindow(officialSearchContext)
            }
            if (
              attempt >= OFFICIAL_SEARCH_MAX_ATTEMPTS ||
              !isRetryableOfficialSearchError(error) ||
              operation.cancelled ||
              operation.timedOut ||
              operation.generation !== officialSearchGeneration
            ) throw error
            await delay(OFFICIAL_SEARCH_RETRY_DELAY_MS)
          }
        }
        if (!officialPayload) throw lastOfficialError ?? createYoukuSearchError(
          'Youku official search response is invalid',
          'YOUKU_SEARCH_RESPONSE_INVALID',
        )
        const normalized = normalizeYoukuSearchPayload(
          officialPayload,
          { query: safeQuery, page, limit: safeLimit },
        )
        operation.searchCompleted = true
        operation.rejectOfficialPage = null
        clearTimeout(timer)
        normalized.results = await Promise.all(normalized.results.map(async (item) => ({
          ...item,
          thumbnailPath: await cacheCover(item.coverUrl),
        })))
        return normalized
      }
      let currentUrl = searchUrl
      let response
      for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
        response = await sharedSession.fetch(currentUrl, {
          method: 'GET',
          credentials: 'include',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9',
          },
        })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          const nextUrl = location ? new URL(location, currentUrl) : null
          if (
            !nextUrl ||
            nextUrl.protocol !== 'https:' ||
            nextUrl.hostname !== YOUKU_SEARCH_HOST ||
            nextUrl.username || nextUrl.password || nextUrl.port ||
            !/^\/search\/q_[^/]{1,600}$/.test(nextUrl.pathname)
          ) throw new Error('Youku search redirect was rejected')
          currentUrl = nextUrl.href
          continue
        }
        break
      }
      if (!response?.ok) throw new Error('Youku search request was rejected')
      const responseUrl = response.url || currentUrl
      const finalUrl = parseSecureUrl(responseUrl)
      if (!finalUrl || finalUrl.hostname !== YOUKU_SEARCH_HOST) {
        throw new Error('Youku search response origin is invalid')
      }
      if (!/^\/search\/q_[^/]{1,600}$/.test(finalUrl.pathname)) {
        throw new Error('Youku search response path is invalid')
      }
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.toLowerCase().includes('text/html')) {
        throw new Error('Youku search response type is invalid')
      }
      const html = (await readBoundedBody(response, MAX_SEARCH_BYTES)).toString('utf8')
      if (/FAIL_SYS_USER_VALIDATE|RGV587_ERROR/i.test(html)) {
        throw new Error('Youku search requires official verification')
      }
      const normalized = normalizeYoukuSearchPayload(
        extractYoukuInitialData(html),
        { query: safeQuery, page, limit: safeLimit },
      )
      operation.searchCompleted = true
      clearTimeout(timer)
      normalized.results = await Promise.all(normalized.results.map(async (item) => ({
        ...item,
        thumbnailPath: await cacheCover(item.coverUrl),
      })))
      return normalized
    } catch (error) {
      if (operation.timedOut) throw createYoukuSearchError(
        page > 1
          ? 'Youku official search page timed out'
          : 'Youku search timed out',
        page > 1
          ? 'YOUKU_SEARCH_OFFICIAL_TIMEOUT'
          : 'YOUKU_SEARCH_TIMEOUT',
      )
      if (operation.cancelled) throw createYoukuSearchError(
        'Youku search was cancelled',
        'YOUKU_SEARCH_CANCELLED',
      )
      throw error
    } finally {
      clearTimeout(timer)
      operation.rejectOfficialPage = null
      closeOperationSearchWindow(operation)
      activeSearches.delete(operation)
    }
  }

  function cancelSearches() {
    activeSearches.forEach((operation) => {
      operation.cancelled = true
      operation.controller.abort()
      closeOperationSearchWindow(operation)
      operation.rejectOfficialPage?.(createYoukuSearchError(
        'Youku search was cancelled',
        'YOUKU_SEARCH_CANCELLED',
      ))
    })
    const cancellationError = new Error('Youku cover request was cancelled')
    activeCoverControllers.forEach((controller) => controller.abort(cancellationError))
    closeOfficialSearchWindow()
  }

  return {
    cancelSearches,
    closeWindows,
    dispose() {
      if (disposed) return
      disposed = true
      cancelSearches()
      sharedSession.removeListener?.('will-download', preventDownload)
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
  YOUKU_AUTH_COOKIE_NAME,
  YOUKU_EMBEDDED_PLAYER_CSS,
  YOUKU_LOGIN_URL,
  YOUKU_PARTITION,
  createYoukuPlaybackUrl,
  createYoukuSearchUrl,
  createYoukuSessionManager,
  detectYoukuAuthCookieState,
  extractYoukuInitialData,
  hardenYoukuPlayerWebPreferences,
  installYoukuPlayerWebviewGuard,
  isAllowedYoukuAuthNavigationUrl,
  normalizeYoukuSearchPayload,
  parseYoukuOfficialPageUrl,
}
