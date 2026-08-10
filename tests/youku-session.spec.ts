import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const {
  ENTER_YOUKU_WEB_FULLSCREEN_SCRIPT,
  YOUKU_EMBEDDED_PLAYER_CSS,
  YOUKU_LOGIN_URL,
  YOUKU_PARTITION,
  captureYoukuEmbeddedFrame,
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
} = require('../electron/youkuSession.cjs') as {
  ENTER_YOUKU_WEB_FULLSCREEN_SCRIPT: string
  YOUKU_EMBEDDED_PLAYER_CSS: string
  YOUKU_LOGIN_URL: string
  YOUKU_PARTITION: string
  captureYoukuEmbeddedFrame(
    hostContents: EventEmitter,
    request: { kind: 'video' | 'episode'; mediaId: string },
  ): Promise<string | null>
  createYoukuPlaybackUrl(request: {
    showId?: string
    videoId?: string
  }): string
  createYoukuSearchUrl(query: string): string
  createYoukuSessionManager(options: Record<string, unknown>): {
    cancelSearches(): void
    closeWindows(): void
    dispose(): void
    getAuthState(): Promise<{ signedIn: boolean }>
    logout(): Promise<{ signedIn: boolean }>
    openLogin(): Promise<{ signedIn: boolean }>
    searchVideos(request: {
      query: string
      page?: number
      limit?: number
    }): Promise<{
      hasMore: boolean
      nextPage: number | null
      results: Array<Record<string, unknown>>
    }>
  }
  detectYoukuAuthCookieState(
    cookies: Array<{ name: string; value: string }>,
  ): { signedIn: boolean }
  extractYoukuInitialData(html: string): Record<string, unknown>
  hardenYoukuPlayerWebPreferences(preferences: Record<string, unknown>): void
  installYoukuPlayerWebviewGuard(
    hostContents: EventEmitter,
    expectedSession?: object,
  ): () => void
  isAllowedYoukuAuthNavigationUrl(url: string): boolean
  normalizeYoukuSearchPayload(
    payload: Record<string, unknown>,
    request: { query: string; page: number; limit: number },
  ): {
    query: string
    page: number
    pageSize: number
    totalCount: number
    hasMore: boolean
    nextPage: number | null
    results: Array<Record<string, unknown>>
  }
  parseYoukuOfficialPageUrl(url: string, allowTracking?: boolean): {
    kind: 'video' | 'episode'
    mediaId: string
    showId: string | null
    videoId: string | null
    url: string
  } | null
}

const SHOW_ID = 'cbff984c962411de83b1'
const VIDEO_ID = 'XNjUwMDYyNjk4MA=='

function makePayload() {
  return {
    data: {
      data: {
        status: 'success',
        rstate: 0,
        total: 383,
      },
      more: true,
      nodes: [
        {
          nodes: [
            {
              data: {
                type: 1027,
                realShowId: SHOW_ID,
                titleDTO: {
                  displayName: '<em>甄嬛传</em>&amp;特别篇',
                },
                info: '简介：后宫故事',
                director: '导演：郑晓龙',
                episodeTotal: 76,
                featureDTO: { text: '电视剧 · 2011 · 中国' },
                showMediaTag: [{ tagText: '古装' }],
                thumbUrl: 'http://m.ykimg.com/0510000067.jpg',
              },
            },
            {
              data: {
                type: 1503,
                videoId: 'XMTIzNDU2Nzg5MA==',
                titleDTO: { displayName: '第 1 集' },
              },
            },
          ],
        },
        {
          nodes: [
            {
              data: {
                type: 8005,
                videoId: VIDEO_ID,
                titleDTO: { displayName: '幕后花絮' },
                userName: '优酷用户',
                publishTime: '2026-08-01',
                logCate: 'ugc',
                screenShotDTO: {
                  thumbUrl: 'https://vthumb.ykimg.com/054106015.jpg',
                  rightBottomText: '10:04',
                },
              },
            },
          ],
        },
      ],
    },
  }
}

class FakeCookies extends EventEmitter {
  values: Array<{ name: string; value: string }> = []
  flushCount = 0

  get() { return Promise.resolve([...this.values]) }
  flushStore() { this.flushCount += 1; return Promise.resolve() }
}

class FakeSession extends EventEmitter {
  cookies = new FakeCookies()
  clearDataCount = 0
  flushCount = 0
  fetchImplementation: (url: string, init?: RequestInit) => Promise<Response>

  constructor(fetchImplementation?: (url: string, init?: RequestInit) => Promise<Response>) {
    super()
    this.fetchImplementation = fetchImplementation ?? (() => Promise.reject(new Error('unexpected fetch')))
  }

  fetch(url: string, init?: RequestInit) {
    return this.fetchImplementation(url, init)
  }

  setPermissionCheckHandler() { return undefined }
  setPermissionRequestHandler() { return undefined }
  closeAllConnections() { return Promise.resolve() }
  flushStorageData() { this.flushCount += 1; return Promise.resolve() }
  clearData() {
    this.clearDataCount += 1
    this.cookies.values = []
    return Promise.resolve()
  }
}

class FakeWebContents extends EventEmitter {
  static executeJavaScriptResult: unknown = undefined
  destroyed = false
  currentUrl = ''
  executedScripts: string[] = []
  windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null

  isDestroyed() { return this.destroyed }
  loadURL(url: string) { this.currentUrl = url; return Promise.resolve() }
  executeJavaScript(script: string) {
    this.executedScripts.push(script)
    const result = FakeWebContents.executeJavaScriptResult
    return Promise.resolve(
      typeof result === 'function'
        ? (result as (value: string) => unknown)(script)
        : result,
    )
  }
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
    this.windowOpenHandler = handler
  }
}

class FakeWindow extends EventEmitter {
  static instances: FakeWindow[] = []
  options: Record<string, unknown>
  webContents = new FakeWebContents()
  destroyed = false
  loadUrl = ''
  showCount = 0
  hideCount = 0
  focusCount = 0
  fullscreenValues: boolean[] = []
  skipTaskbarValues: boolean[] = []

  constructor(options: Record<string, unknown>) {
    super()
    this.options = options
    FakeWindow.instances.push(this)
  }

  isDestroyed() { return this.destroyed }
  isMinimized() { return false }
  loadURL(url: string) { this.loadUrl = url; this.webContents.currentUrl = url; return Promise.resolve() }
  show() { this.showCount += 1 }
  hide() { this.hideCount += 1 }
  focus() { this.focusCount += 1 }
  close() { this.destroyed = true; this.emit('closed') }
  setMenuBarVisibility() { return undefined }
  setSkipTaskbar(value: boolean) { this.skipTaskbarValues.push(value) }
  setFullScreen(value: boolean) { this.fullscreenValues.push(value) }
  setFullScreenable() { return undefined }
  setSimpleFullScreen() { return undefined }
  setKiosk() { return undefined }
}

class FakeGuest extends EventEmitter {
  session: object
  currentUrl: string
  destroyed = false
  insertedCss: string[] = []
  executedScripts: Array<{ script: string; userGesture: boolean }> = []
  windowOpenHandler: (() => { action: string }) | null = null
  frameReady = true
  capturedImage: unknown = null
  webFullscreenResults: Array<string | Error | Promise<string>> = ['clicked']

  constructor(url: string, session: object) {
    super()
    this.currentUrl = url
    this.session = session
  }

  getURL() { return this.currentUrl }
  isDestroyed() { return this.destroyed }
  loadURL(url: string) { this.currentUrl = url; return Promise.resolve() }
  insertCSS(css: string) { this.insertedCss.push(css); return Promise.resolve('key') }
  executeJavaScript(script: string, userGesture = false) {
    this.executedScripts.push({ script, userGesture })
    if (script.includes('aurora-youku-enter-web-fullscreen')) {
      const result = this.webFullscreenResults.length > 0
        ? this.webFullscreenResults.shift()
        : 'clicked'
      if (result instanceof Error) return Promise.reject(result)
      return Promise.resolve(result)
    }
    return Promise.resolve(this.frameReady)
  }
  capturePage() { return Promise.resolve(this.capturedImage) }
  invalidate() { return undefined }
  setWindowOpenHandler(handler: () => { action: string }) { this.windowOpenHandler = handler }
}

test('detects only a valid Youku P_gck account marker', () => {
  expect(detectYoukuAuthCookieState([])).toEqual({ signedIn: false })
  expect(detectYoukuAuthCookieState([
    { name: 'P_gck', value: encodeURIComponent('token|NA|more') },
  ])).toEqual({ signedIn: false })
  expect(detectYoukuAuthCookieState([
    { name: 'P_gck', value: encodeURIComponent('token|user-42|more') },
  ])).toEqual({ signedIn: true })
})

test('creates and parses only canonical official Youku playback URLs', () => {
  expect(createYoukuPlaybackUrl({ showId: SHOW_ID })).toBe(
    `https://v.youku.com/video?s=${SHOW_ID}`,
  )
  expect(createYoukuPlaybackUrl({ videoId: VIDEO_ID })).toBe(
    `https://v.youku.com/v_show/id_${VIDEO_ID}.html`,
  )
  expect(parseYoukuOfficialPageUrl(
    `https://v.youku.com/video?s=${SHOW_ID}`,
  )).toMatchObject({ kind: 'episode', mediaId: SHOW_ID })
  expect(parseYoukuOfficialPageUrl(
    `https://v.youku.com/v_show/id_${VIDEO_ID}.html`,
  )).toMatchObject({ kind: 'video', mediaId: VIDEO_ID })
  expect(parseYoukuOfficialPageUrl(
    `https://v.youku.com/video?vid=${encodeURIComponent(VIDEO_ID)}`,
  )).toMatchObject({ kind: 'video', mediaId: VIDEO_ID })
  expect(parseYoukuOfficialPageUrl(
    `https://v.youku.com/video?s=${SHOW_ID}&from=evil`,
  )).toBeNull()
  expect(parseYoukuOfficialPageUrl(
    `https://v.youku.com/video?s=${SHOW_ID}&from=official`,
    true,
  )).toMatchObject({ mediaId: SHOW_ID })
  expect(parseYoukuOfficialPageUrl(
    `https://evil.example/video?s=${SHOW_ID}`,
  )).toBeNull()
})

test('builds a first-page official search URL without leaking URL syntax', () => {
  expect(createYoukuSearchUrl('甄嬛传')).toBe(
    'https://so.youku.com/search/q_%E7%94%84%E5%AC%9B%E4%BC%A0',
  )
  expect(() => createYoukuSearchUrl('')).toThrow()
})

test('extracts JSON without evaluating adjacent page script', () => {
  const payload = makePayload()
  const html = `<script>window.__INITIAL_DATA__ = ${JSON.stringify(payload)};globalThis.__youkuEvil = true</script>`
  expect(extractYoukuInitialData(html)).toEqual(payload)
  expect((globalThis as Record<string, unknown>).__youkuEvil).toBeUndefined()
  expect(() => extractYoukuInitialData(
    '<script>window.__INITIAL_DATA__ = alert(1)</script>',
  )).toThrow('malformed')
})

test('extracts signed-in SSR data without evaluating Youku Date expressions', () => {
  const payload = makePayload()
  const serialized = JSON.stringify(payload).replace(
    '"status":"success"',
    '"ticketTime":new Date("2026-08-05T00:00:00.000Z"),"status":"success"',
  )
  const html = `<script>window.__INITIAL_DATA__ = ${serialized};</script>`
  expect(extractYoukuInitialData(html)).toMatchObject({
    data: {
      data: {
        ticketTime: '2026-08-05T00:00:00.000Z',
        status: 'success',
      },
    },
  })
  expect(() => extractYoukuInitialData(
    '<script>window.__INITIAL_DATA__ = {"value":new Date(globalThis.__evil = true)};</script>',
  )).toThrow('malformed')
  expect((globalThis as Record<string, unknown>).__evil).toBeUndefined()
})

test('normalizes one series root and one UGC root without leaking episode nodes', () => {
  const normalized = normalizeYoukuSearchPayload(makePayload(), {
    query: '甄嬛传',
    page: 1,
    limit: 12,
  })
  expect(normalized.hasMore).toBe(true)
  expect(normalized.nextPage).toBe(2)
  expect(normalized.totalCount).toBe(383)
  expect(normalized.results).toHaveLength(2)
  expect(normalized.results[0]).toMatchObject({
    source: 'youku',
    kind: 'episode',
    mediaId: SHOW_ID,
    title: '甄嬛传&特别篇',
    description: '后宫故事',
    author: '郑晓龙',
    duration: '共 76 集',
    coverUrl: 'https://m.ykimg.com/0510000067.jpg',
  })
  expect(normalized.results[0].tags).toEqual([
    '电视剧', '2011', '中国', '古装',
  ])
  expect(normalized.results[1]).toMatchObject({
    kind: 'video',
    mediaId: VIDEO_ID,
    duration: '10:04',
  })
  expect(normalized.results.some((item) => item.mediaId === 'XMTIzNDU2Nzg5MA==')).toBe(false)
  expect(normalizeYoukuSearchPayload(makePayload(), {
    query: '甄嬛传', page: 2, limit: 12,
  })).toMatchObject({ page: 2, hasMore: true, nextPage: 3 })
})

test('filters Youku official and user result identities without changing all results', () => {
  const request = { query: '甄嬛传', page: 1, limit: 12 }
  expect(normalizeYoukuSearchPayload(makePayload(), {
    ...request,
    searchType: 'official',
  }).results).toEqual([
    expect.objectContaining({ kind: 'episode', mediaId: SHOW_ID }),
  ])
  expect(normalizeYoukuSearchPayload(makePayload(), {
    ...request,
    searchType: 'user',
  }).results).toEqual([
    expect.objectContaining({ kind: 'video', mediaId: VIDEO_ID }),
  ])
  expect(() => normalizeYoukuSearchPayload(makePayload(), {
    ...request,
    searchType: 'advertisement',
  })).toThrow('search type')
})

test('uses reviewed screenshot and nested poster fallbacks when Youku nodes mix IDs', () => {
  const payload = makePayload()
  const program = payload.data.nodes[0].nodes[0].data
  delete program.thumbUrl
  program.screenShotDTO = {
    thumbUrl: 'https://vthumb.ykimg.com/0541010163A7B1CF36596EAE1C64417E',
    newImgInfo: {
      thumbUrl: 'https://vthumb.ykimg.com/0541010163A7B1CF36596EAE1C64417F',
    },
  }
  const directVideo = payload.data.nodes[1].nodes[0].data
  directVideo.screenShotDTO = {
    rightBottomText: '10:04',
  }
  directVideo.posterDTO = {
    newImgInfo: {
      thumbUrl: 'https://ykimg.alicdn.com/develop/image/poster.png',
    },
  }
  const normalized = normalizeYoukuSearchPayload(payload, {
    query: '甄嬛传',
    page: 1,
    limit: 12,
  })
  expect(normalized.results[0].coverUrl).toBe(
    'https://vthumb.ykimg.com/0541010163A7B1CF36596EAE1C64417E',
  )
  expect(normalized.results[1].coverUrl).toBe(
    'https://ykimg.alicdn.com/develop/image/poster.png',
  )

  program.screenShotDTO.thumbUrl = 'https://ykimg.alicdn.com.evil.example/cover.jpg'
  expect(normalizeYoukuSearchPayload(payload, {
    query: '甄嬛传', page: 1, limit: 12,
  }).results[0].coverUrl).toBe(
    'https://vthumb.ykimg.com/0541010163A7B1CF36596EAE1C64417F',
  )
})

test('accepts only reviewed authentication navigation origins', () => {
  expect(isAllowedYoukuAuthNavigationUrl(YOUKU_LOGIN_URL)).toBe(true)
  expect(isAllowedYoukuAuthNavigationUrl('https://cnpassport.youku.com/login')).toBe(true)
  expect(isAllowedYoukuAuthNavigationUrl('http://youku.com')).toBe(true)
  expect(isAllowedYoukuAuthNavigationUrl('https://youku.com.evil.example')).toBe(false)
  expect(isAllowedYoukuAuthNavigationUrl('file:///tmp/login.html')).toBe(false)
})

test('prefers the official Youku web-fullscreen API and keeps strict control fallbacks', () => {
  const executeScript = new Function(
    'window',
    'document',
    `return (${ENTER_YOUKU_WEB_FULLSCREEN_SCRIPT.trim()})`,
  ) as (windowValue: object, documentValue: object) => string
  let documentQueryCount = 0
  const unavailableDocument = {
    querySelector() {
      documentQueryCount += 1
      throw new Error('the official API path must not query fallback controls')
    },
  }
  const apiCalls: boolean[] = []
  expect(executeScript({
    videoPlayer: {
      getPlayerState: () => ({ webFullscreen: false }),
      webFullscreen: (enabled: boolean) => apiCalls.push(enabled),
    },
  }, unavailableDocument)).toBe('clicked')
  expect(apiCalls).toEqual([true])
  expect(documentQueryCount).toBe(0)

  expect(executeScript({
    videoPlayer: {
      getPlayerState: () => ({ webFullscreen: true }),
      webFullscreen: () => { throw new Error('already active') },
    },
  }, unavailableDocument)).toBe('already')
  expect(documentQueryCount).toBe(0)

  let clicked = 0
  let fallbackSelector = ''
  const neutralNode = {
    getAttribute: () => '',
  }
  const fallbackControl = {
    textContent: '',
    getAttribute: (name: string) => name === 'title' ? '网页全屏' : '',
    closest: () => fallbackControl,
    getClientRects: () => [{}],
    click: () => { clicked += 1 },
  }
  const player = {
    ...neutralNode,
    querySelectorAll(selector: string) {
      fallbackSelector = selector
      return [fallbackControl]
    },
    contains: (value: unknown) => value === fallbackControl,
  }
  expect(executeScript({}, {
    body: neutralNode,
    documentElement: neutralNode,
    fullscreenElement: null,
    querySelector: () => player,
  })).toBe('clicked')
  expect(clicked).toBe(1)
  expect(fallbackSelector).toBe('#webfullscreen-icon, #webfullscreen2-icon')
  expect(fallbackSelector).not.toMatch(/^#fullscreen(?:2)?-icon/)
})

test('hardens Youku webview preferences and owns no other provider partition', async () => {
  const preferences: Record<string, unknown> = {
    partition: YOUKU_PARTITION,
    preload: '/tmp/evil.js',
    session: {},
    nodeIntegration: true,
    sandbox: false,
  }
  hardenYoukuPlayerWebPreferences(preferences)
  expect(preferences).toMatchObject({
    partition: YOUKU_PARTITION,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    devTools: false,
  })
  expect(preferences.preload).toBeUndefined()
  expect(preferences.session).toBeUndefined()

  const host = new EventEmitter()
  const expectedSession = { getPartition: () => YOUKU_PARTITION }
  const dispose = installYoukuPlayerWebviewGuard(host, expectedSession)
  let otherPrevented = false
  host.emit(
    'will-attach-webview',
    { preventDefault: () => { otherPrevented = true } },
    { partition: 'persist:aurora-online-bilibili-v1' },
    {
      partition: 'persist:aurora-online-bilibili-v1',
      src: 'https://www.bilibili.com/video/BV1234567890',
    },
  )
  expect(otherPrevented).toBe(false)

  let prevented = false
  const ownPreferences: Record<string, unknown> = { partition: YOUKU_PARTITION }
  host.emit(
    'will-attach-webview',
    { preventDefault: () => { prevented = true } },
    ownPreferences,
    {
      partition: YOUKU_PARTITION,
      src: `https://v.youku.com/video?s=${SHOW_ID}`,
    },
  )
  expect(prevented).toBe(false)
  const guest = new FakeGuest(
    `https://v.youku.com/video?s=${SHOW_ID}`,
    expectedSession,
  )
  host.emit('did-attach-webview', {}, guest)
  await Promise.resolve()
  expect(guest.insertedCss).toContain(YOUKU_EMBEDDED_PLAYER_CSS)
  expect(YOUKU_EMBEDDED_PLAYER_CSS).not.toMatch(
    /(?:visibility\s*:\s*hidden|display\s*:\s*none)/i,
  )
  expect(YOUKU_EMBEDDED_PLAYER_CSS).not.toContain('2147483647')
  expect(ENTER_YOUKU_WEB_FULLSCREEN_SCRIPT).toContain(
    'aurora-youku-enter-web-fullscreen',
  )
  expect(ENTER_YOUKU_WEB_FULLSCREEN_SCRIPT).toContain(
    "'#webfullscreen-icon, #webfullscreen2-icon'",
  )
  expect(ENTER_YOUKU_WEB_FULLSCREEN_SCRIPT).not.toMatch(
    /querySelector(?:All)?\(\s*['"]#fullscreen(?:2)?-icon/,
  )
  expect(ENTER_YOUKU_WEB_FULLSCREEN_SCRIPT).not.toContain('requestFullscreen')
  const fullscreenExecutions = guest.executedScripts.filter(({ script }) =>
    script.includes('aurora-youku-enter-web-fullscreen')
  )
  expect(fullscreenExecutions).toHaveLength(1)
  expect(fullscreenExecutions[0].userGesture).toBe(true)
  guest.emit('dom-ready')
  guest.emit('did-finish-load')
  guest.emit('did-stop-loading')
  await Promise.resolve()
  expect(guest.executedScripts.filter(({ script }) =>
    script.includes('aurora-youku-enter-web-fullscreen')
  )).toHaveLength(1)
  expect(guest.windowOpenHandler?.()).toEqual({ action: 'deny' })

  const capturedDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
  const resizedImage = {
    isEmpty: () => false,
    getSize: () => ({ width: 480, height: 270 }),
    toDataURL: () => capturedDataUrl,
  }
  guest.capturedImage = {
    isEmpty: () => false,
    getSize: () => ({ width: 1_280, height: 720 }),
    resize: () => resizedImage,
  }
  await expect(captureYoukuEmbeddedFrame(host, {
    kind: 'episode',
    mediaId: SHOW_ID,
  })).resolves.toBe(capturedDataUrl)
  await expect(captureYoukuEmbeddedFrame(host, {
    kind: 'video',
    mediaId: VIDEO_ID,
  })).resolves.toBeNull()
  guest.frameReady = false
  await expect(captureYoukuEmbeddedFrame(host, {
    kind: 'episode',
    mediaId: SHOW_ID,
  })).resolves.toBeNull()

  let subframeRedirectPrevented = false
  guest.emit(
    'will-redirect',
    { preventDefault: () => { subframeRedirectPrevented = true } },
    'https://official-ad-service.example/redirect',
    false,
    false,
  )
  expect(subframeRedirectPrevented).toBe(false)

  let topLevelRedirectPrevented = false
  guest.emit(
    'will-redirect',
    { preventDefault: () => { topLevelRedirectPrevented = true } },
    'https://evil.example/redirect',
    false,
    true,
  )
  expect(topLevelRedirectPrevented).toBe(true)

  let invalidPrevented = false
  host.emit(
    'will-attach-webview',
    { preventDefault: () => { invalidPrevented = true } },
    { partition: YOUKU_PARTITION },
    { partition: YOUKU_PARTITION, src: 'https://evil.example/video' },
  )
  expect(invalidPrevented).toBe(true)
  dispose()
})

test('enters Youku web fullscreen once per document and ignores stale completion', async () => {
  const host = new EventEmitter()
  const expectedSession = { getPartition: () => YOUKU_PARTITION }
  const dispose = installYoukuPlayerWebviewGuard(host, expectedSession)
  const url = `https://v.youku.com/video?s=${SHOW_ID}`
  let resolveStaleAttempt: ((value: string) => void) | null = null
  const guest = new FakeGuest(url, expectedSession)
  guest.webFullscreenResults = [
    new Promise<string>((resolve) => { resolveStaleAttempt = resolve }),
    'clicked',
  ]
  host.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    { partition: YOUKU_PARTITION },
    { partition: YOUKU_PARTITION, src: url },
  )
  host.emit('did-attach-webview', {}, guest)
  expect(guest.executedScripts.filter(({ script }) =>
    script.includes('aurora-youku-enter-web-fullscreen')
  )).toHaveLength(1)

  guest.emit('did-start-navigation', {}, url, false, true)
  guest.currentUrl = url
  guest.emit('dom-ready')
  await Promise.resolve()
  expect(guest.executedScripts.filter(({ script }) =>
    script.includes('aurora-youku-enter-web-fullscreen')
  )).toHaveLength(2)

  resolveStaleAttempt?.('clicked')
  await Promise.resolve()
  guest.emit('did-finish-load')
  guest.emit('did-stop-loading')
  await Promise.resolve()
  expect(guest.executedScripts.filter(({ script }) =>
    script.includes('aurora-youku-enter-web-fullscreen')
  )).toHaveLength(2)
  expect(guest.executedScripts.every(({ userGesture }) => userGesture)).toBe(true)
  guest.destroyed = true
  guest.emit('destroyed')
  dispose()
})

test('bounds Youku web-fullscreen retries and cancels them on guest destruction', async () => {
  const host = new EventEmitter()
  const expectedSession = { getPartition: () => YOUKU_PARTITION }
  const dispose = installYoukuPlayerWebviewGuard(host, expectedSession)
  const url = `https://v.youku.com/video?s=${SHOW_ID}`
  const guest = new FakeGuest(url, expectedSession)
  guest.webFullscreenResults = ['not-ready', 'clicked']
  host.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    { partition: YOUKU_PARTITION },
    { partition: YOUKU_PARTITION, src: url },
  )
  host.emit('did-attach-webview', {}, guest)
  await expect.poll(() => guest.executedScripts.filter(({ script }) =>
    script.includes('aurora-youku-enter-web-fullscreen')
  ).length).toBe(2)
  guest.emit('dom-ready')
  guest.emit('did-finish-load')
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(guest.executedScripts.filter(({ script }) =>
    script.includes('aurora-youku-enter-web-fullscreen')
  )).toHaveLength(2)

  guest.webFullscreenResults = ['not-ready', 'clicked']
  guest.emit('did-start-navigation', {}, url, false, true)
  guest.currentUrl = url
  guest.emit('dom-ready')
  await Promise.resolve()
  guest.destroyed = true
  guest.emit('destroyed')
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(guest.executedScripts.filter(({ script }) =>
    script.includes('aurora-youku-enter-web-fullscreen')
  )).toHaveLength(3)
  dispose()
})

test('opens isolated ordinary login window and closes it after auth cookie changes', async () => {
  FakeWindow.instances = []
  const fakeSession = new FakeSession()
  const authEvents: Array<{ signedIn: boolean }> = []
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: {
      fromPartition(partition: string) {
        expect(partition).toBe(YOUKU_PARTITION)
        return fakeSession
      },
    },
    onAuthStateChange: (state: { signedIn: boolean }) => authEvents.push(state),
  })
  await manager.openLogin()
  const login = FakeWindow.instances[0]
  expect(login.loadUrl).toBe(YOUKU_LOGIN_URL)
  expect(login.options).toMatchObject({
    frame: true,
    modal: false,
    maximizable: false,
    fullscreenable: false,
  })
  expect((login.options.webPreferences as Record<string, unknown>)).toMatchObject({
    session: fakeSession,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
  })
  fakeSession.cookies.values = [
    { name: 'P_gck', value: encodeURIComponent('token|signed-in-user') },
  ]
  fakeSession.cookies.emit('changed', {}, fakeSession.cookies.values[0])
  await expect.poll(() => login.destroyed).toBe(true)
  expect(authEvents.at(-1)).toEqual({ signedIn: true })
  manager.dispose()
})

test('searches official SSR first page and caches supported covers', async () => {
  FakeWindow.instances = []
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'aurora-youku-'))
  const signedInPayload = JSON.stringify(makePayload()).replace(
    '"status":"success"',
    '"ticketTime":new Date("2026-08-05T00:00:00.000Z"),"status":"success"',
  )
  const html = `<script>window.__INITIAL_DATA__=${signedInPayload};</script>`
  const fetches: string[] = []
  const fakeSession = new FakeSession(async (url) => {
    fetches.push(url)
    if (url.startsWith('https://so.youku.com/')) {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })
  })
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
    cacheDirectory,
  })
  try {
    FakeWebContents.executeJavaScriptResult = { data: makePayload().data }
    const result = await manager.searchVideos({ query: '甄嬛传', limit: 12 })
    expect(result.hasMore).toBe(true)
    expect(result.nextPage).toBe(2)
    expect(result.results).toHaveLength(2)
    for (const item of result.results) {
      expect(item.thumbnailPath).toEqual(expect.any(String))
      expect((await readFile(item.thumbnailPath as string)).byteLength).toBe(4)
    }
    expect(fetches[0]).toBe(createYoukuSearchUrl('甄嬛传'))
    const nextPage = await manager.searchVideos({ query: '甄嬛传', page: 2 })
    expect(nextPage).toMatchObject({
      page: 2,
      hasMore: true,
      nextPage: 3,
      totalCount: 383,
    })
    expect(nextPage.results).toHaveLength(2)
    const searchWindow = FakeWindow.instances.at(-1)
    expect(searchWindow?.loadUrl).toBe(createYoukuSearchUrl('甄嬛传'))
    expect(searchWindow?.options).toMatchObject({
      show: false,
      skipTaskbar: true,
      webPreferences: {
        session: fakeSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    const encodedRequest = Buffer.from(JSON.stringify({
      query: '甄嬛传',
      page: 2,
      limit: 12,
    })).toString('base64')
    const secondPageScript = searchWindow?.webContents.executedScripts[0] ?? ''
    expect(secondPageScript).toContain(encodedRequest)
    expect(() => new Function(`return (${secondPageScript})`)).not.toThrow()
    expect(searchWindow?.destroyed).toBe(false)

    const windowCount = FakeWindow.instances.length
    const thirdPage = await manager.searchVideos({ query: '甄嬛传', page: 3 })
    expect(thirdPage).toMatchObject({ page: 3, nextPage: 4 })
    expect(FakeWindow.instances).toHaveLength(windowCount)
    expect(searchWindow?.webContents.executedScripts).toHaveLength(2)
    expect(searchWindow?.webContents.executedScripts[1]).toContain(
      Buffer.from(JSON.stringify({
        query: '甄嬛传',
        page: 3,
        limit: 12,
      })).toString('base64'),
    )
    manager.dispose()
    expect(searchWindow?.destroyed).toBe(true)
  } finally {
    FakeWebContents.executeJavaScriptResult = undefined
    manager.dispose()
    await rm(cacheDirectory, { recursive: true, force: true })
  }
})

test('retries transient cover failures and accepts valid magic from a binary CDN response', async () => {
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'aurora-youku-cover-retry-'))
  const html = `<script>window.__INITIAL_DATA__=${JSON.stringify(makePayload())};</script>`
  const attempts = new Map<string, number>()
  const fakeSession = new FakeSession(async (url) => {
    if (url.startsWith('https://so.youku.com/')) {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    const attempt = (attempts.get(url) ?? 0) + 1
    attempts.set(url, attempt)
    if (attempt === 1) return new Response(null, { status: 503 })
    return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    })
  })
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
    cacheDirectory,
  })
  try {
    const result = await manager.searchVideos({ query: '甄嬛传', limit: 12 })
    expect(result.results).toHaveLength(2)
    for (const item of result.results) {
      expect(item.thumbnailPath).toMatch(/\.jpg$/)
      expect(attempts.get(item.coverUrl as string)).toBe(2)
    }
  } finally {
    manager.dispose()
    await rm(cacheDirectory, { recursive: true, force: true })
  }
})

test('bounds hanging cover requests with an independent timeout and degrades to no thumbnail', async () => {
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'aurora-youku-cover-timeout-'))
  const html = `<script>window.__INITIAL_DATA__=${JSON.stringify(makePayload())};</script>`
  const attempts = new Map<string, number>()
  const abortedSignals: AbortSignal[] = []
  const fakeSession = new FakeSession(async (url, init) => {
    if (url.startsWith('https://so.youku.com/')) {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    attempts.set(url, (attempts.get(url) ?? 0) + 1)
    const signal = init?.signal
    if (signal) abortedSignals.push(signal)
    return new Promise<Response>(() => undefined)
  })
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
    cacheDirectory,
    coverFetchTimeoutMs: 20,
  })
  try {
    const result = await manager.searchVideos({ query: '甄嬛传', limit: 12 })
    expect(result.results).toHaveLength(2)
    expect(result.results.every((item) => item.thumbnailPath === null)).toBe(true)
    expect([...attempts.values()]).toEqual([3, 3])
    expect(abortedSignals).toHaveLength(6)
    expect(abortedSignals.every((signal) => signal.aborted)).toBe(true)
  } finally {
    manager.dispose()
    await rm(cacheDirectory, { recursive: true, force: true })
  }
})

test('cancels a streamed response without Content-Length as soon as it exceeds the limit', async () => {
  let streamCancelled = false
  const oversizedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024))
      controller.enqueue(new Uint8Array(3 * 1024 * 1024))
    },
    cancel() {
      streamCancelled = true
    },
  })
  const fakeSession = new FakeSession(async () => new Response(oversizedBody, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  }))
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
  })
  try {
    await expect(manager.searchVideos({ query: '超大响应' })).rejects.toThrow(
      'response is too large',
    )
    expect(streamCancelled).toBe(true)
  } finally {
    manager.dispose()
  }
})

test('rejects a non-image body even when the CDN labels it as JPEG', async () => {
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'aurora-youku-cover-magic-'))
  const html = `<script>window.__INITIAL_DATA__=${JSON.stringify(makePayload())};</script>`
  const fakeSession = new FakeSession(async (url) => {
    if (url.startsWith('https://so.youku.com/')) {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    return new Response('<html>not an image</html>', {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })
  })
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
    cacheDirectory,
  })
  try {
    const result = await manager.searchVideos({ query: '甄嬛传', limit: 12 })
    expect(result.results).toHaveLength(2)
    expect(result.results.every((item) => item.thumbnailPath === null)).toBe(true)
  } finally {
    manager.dispose()
    await rm(cacheDirectory, { recursive: true, force: true })
  }
})

test('does not turn an official verification page into an empty result', async () => {
  const fakeSession = new FakeSession(async () => new Response(
    '<html>FAIL_SYS_USER_VALIDATE RGV587_ERROR</html>',
    { status: 200, headers: { 'content-type': 'text/html' } },
  ))
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
  })
  await expect(manager.searchVideos({ query: '测试' })).rejects.toThrow(
    'requires official verification',
  )
  manager.dispose()
})

test('shows official verification and resumes the requested later page', async () => {
  FakeWindow.instances = []
  let searchExecutionCount = 0
  let verificationPollCount = 0
  FakeWebContents.executeJavaScriptResult = (script: string) => {
    if (script.includes('aurora-youku-verification-state')) {
      verificationPollCount += 1
      return verificationPollCount === 1
        ? { verificationRequired: true, readyState: 'complete' }
        : { verificationRequired: false, readyState: 'complete' }
    }
    searchExecutionCount += 1
    if (searchExecutionCount === 2) {
      const verificationWindow = FakeWindow.instances.at(-1)!
      expect(verificationWindow.showCount).toBe(1)
      expect(verificationWindow.destroyed).toBe(false)
    }
    return searchExecutionCount === 1
      ? { verificationRequired: true }
      : { data: makePayload().data }
  }
  const fakeSession = new FakeSession()
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
    verificationPollMs: 1,
    verificationTimeoutMs: 100,
  })
  try {
    const result = await manager.searchVideos({
      query: '汽车',
      page: 2,
      limit: 12,
    })
    expect(result.page).toBe(2)
    expect(result.nextPage).toBe(3)
    expect(FakeWindow.instances).toHaveLength(1)
    const verificationWindow = FakeWindow.instances.at(-1)!
    expect(verificationWindow.options.frame).toBe(true)
    expect(verificationWindow.showCount).toBe(1)
    expect(verificationWindow.focusCount).toBe(1)
    expect(verificationWindow.hideCount).toBe(0)
    expect(verificationWindow.destroyed).toBe(true)
    expect(searchExecutionCount).toBe(2)
    expect(verificationPollCount).toBe(3)
  } finally {
    FakeWebContents.executeJavaScriptResult = undefined
    manager.dispose()
  }
})

test('closing provider windows cancels an in-progress verification', async () => {
  FakeWindow.instances = []
  FakeWebContents.executeJavaScriptResult = (script: string) => (
    script.includes('aurora-youku-verification-state')
      ? { verificationRequired: true, readyState: 'complete' }
      : { verificationRequired: true }
  )
  const fakeSession = new FakeSession()
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
    verificationPollMs: 1,
    verificationTimeoutMs: 1_000,
  })
  try {
    const search = manager.searchVideos({
      query: '汽车',
      page: 2,
      limit: 12,
    })
    await expect.poll(() => FakeWindow.instances.at(-1)?.showCount ?? 0).toBe(1)
    manager.closeWindows()
    await expect(search).rejects.toThrow('cancelled')
    expect(FakeWindow.instances.at(-1)?.destroyed).toBe(true)
  } finally {
    FakeWebContents.executeJavaScriptResult = undefined
    manager.dispose()
  }
})

test('retries a transient official client failure once on the same page only', async () => {
  FakeWindow.instances = []
  let executionCount = 0
  FakeWebContents.executeJavaScriptResult = () => {
    executionCount += 1
    return executionCount === 1
      ? { transientFailure: 'client-not-ready' }
      : { data: makePayload().data }
  }
  const fakeSession = new FakeSession()
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
  })
  try {
    const result = await manager.searchVideos({
      query: '汽车',
      page: 2,
      limit: 12,
    })
    expect(result).toMatchObject({ page: 2, nextPage: 3 })
    expect(executionCount).toBe(2)
    expect(FakeWindow.instances).toHaveLength(2)
    expect(FakeWindow.instances[0].destroyed).toBe(true)
    const encodedSecondPage = Buffer.from(JSON.stringify({
      query: '汽车',
      page: 2,
      limit: 12,
    })).toString('base64')
    for (const searchWindow of FakeWindow.instances) {
      expect(searchWindow.webContents.executedScripts[0]).toContain(encodedSecondPage)
      expect(searchWindow.webContents.executedScripts[0]).toContain('client-not-ready')
      expect(searchWindow.webContents.executedScripts[0]).toContain('request-timeout')
    }
  } finally {
    FakeWebContents.executeJavaScriptResult = undefined
    manager.dispose()
  }
})

test('retries an official request timeout once on the same page only', async () => {
  FakeWindow.instances = []
  let executionCount = 0
  FakeWebContents.executeJavaScriptResult = () => {
    executionCount += 1
    return executionCount === 1
      ? { transientFailure: 'request-timeout' }
      : { data: makePayload().data }
  }
  const fakeSession = new FakeSession()
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
  })
  try {
    const result = await manager.searchVideos({
      query: '汽车',
      page: 2,
      limit: 12,
    })
    expect(result).toMatchObject({ page: 2, nextPage: 3 })
    expect(executionCount).toBe(2)
    expect(FakeWindow.instances).toHaveLength(2)
    expect(FakeWindow.instances[0].destroyed).toBe(true)
  } finally {
    FakeWebContents.executeJavaScriptResult = undefined
    manager.dispose()
  }
})

test('retries a transient official page load failure with a fresh hidden page', async () => {
  class FlakySearchWindow extends FakeWindow {
    static failuresRemaining = 1

    loadURL(url: string) {
      this.loadUrl = url
      this.webContents.currentUrl = url
      if (FlakySearchWindow.failuresRemaining > 0) {
        FlakySearchWindow.failuresRemaining -= 1
        return Promise.reject(new Error('ERR_FAILED (-2)'))
      }
      return Promise.resolve()
    }
  }

  FakeWindow.instances = []
  FakeWebContents.executeJavaScriptResult = { data: makePayload().data }
  const fakeSession = new FakeSession()
  const manager = createYoukuSessionManager({
    BrowserWindow: FlakySearchWindow,
    sessionModule: { fromPartition: () => fakeSession },
  })
  try {
    const result = await manager.searchVideos({
      query: '汽车',
      page: 2,
      limit: 12,
    })
    expect(result).toMatchObject({ page: 2, nextPage: 3 })
    expect(FakeWindow.instances).toHaveLength(2)
    expect(FakeWindow.instances[0].destroyed).toBe(true)
    expect(FakeWindow.instances[1].loadUrl).toBe(createYoukuSearchUrl('汽车'))
  } finally {
    FakeWebContents.executeJavaScriptResult = undefined
    manager.dispose()
  }
})

test('does not retry an official rejection and exposes a distinct reason', async () => {
  FakeWindow.instances = []
  FakeWebContents.executeJavaScriptResult = { officialFailure: true }
  const fakeSession = new FakeSession()
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
  })
  try {
    let rejection: unknown
    try {
      await manager.searchVideos({ query: '汽车', page: 2, limit: 12 })
    } catch (error) {
      rejection = error
    }
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).toContain('official search service rejected')
    expect((rejection as Error & { code?: string }).code).toBe(
      'YOUKU_SEARCH_OFFICIAL_FAILURE',
    )
    expect(FakeWindow.instances).toHaveLength(1)
  } finally {
    FakeWebContents.executeJavaScriptResult = undefined
    manager.dispose()
  }
})

test('changing query replaces the reusable official search page', async () => {
  FakeWindow.instances = []
  FakeWebContents.executeJavaScriptResult = { data: makePayload().data }
  const fakeSession = new FakeSession()
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
  })
  try {
    await manager.searchVideos({ query: '汽车', page: 2, limit: 12 })
    const firstWindow = FakeWindow.instances.at(-1)
    await manager.searchVideos({ query: '电影', page: 2, limit: 12 })
    expect(firstWindow?.destroyed).toBe(true)
    expect(FakeWindow.instances).toHaveLength(2)
    expect(FakeWindow.instances.at(-1)?.loadUrl).toBe(createYoukuSearchUrl('电影'))
  } finally {
    FakeWebContents.executeJavaScriptResult = undefined
    manager.dispose()
  }
})

test('logging out closes the reusable official search page before clearing the session', async () => {
  FakeWindow.instances = []
  FakeWebContents.executeJavaScriptResult = { data: makePayload().data }
  const fakeSession = new FakeSession()
  const manager = createYoukuSessionManager({
    BrowserWindow: FakeWindow,
    sessionModule: { fromPartition: () => fakeSession },
  })
  try {
    await manager.searchVideos({ query: '汽车', page: 2, limit: 12 })
    const searchWindow = FakeWindow.instances.at(-1)

    await manager.logout()

    expect(searchWindow?.destroyed).toBe(true)
    expect(fakeSession.clearDataCount).toBe(1)
  } finally {
    FakeWebContents.executeJavaScriptResult = undefined
    manager.dispose()
  }
})
