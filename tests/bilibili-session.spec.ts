import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const {
  BILIBILI_EMBEDDED_PLAYER_CSS,
  BILIBILI_PARTITION,
  captureBilibiliEmbeddedFrame,
  createBilibiliBangumiSearchApiUrl,
  createBilibiliSearchApiUrl,
  createBilibiliSearchUrl,
  createBilibiliSessionManager,
  createBilibiliVideoUrl,
  createMixinKey,
  installBilibiliPlayerWebviewGuard,
  isAllowedBilibiliEmbeddedPageUrl,
  isAllowedBilibiliNavigationUrl,
  isAllowedBilibiliPlayerUrl,
  normalizeBilibiliBangumiSearchResponse,
  normalizeBilibiliSearchPagination,
  normalizeBilibiliSelectionDescriptor,
  parseBilibiliEmbeddedPageUrl,
  parseBilibiliVideoPage,
} = require('../electron/bilibiliSession.cjs') as {
  BILIBILI_EMBEDDED_PLAYER_CSS: string
  BILIBILI_PARTITION: string
  captureBilibiliEmbeddedFrame(
    hostContents: EventEmitter,
    request: { kind: 'video' | 'episode'; mediaId: string },
  ): Promise<string | null>
  createBilibiliBangumiSearchApiUrl(
    query: string,
    limit: number,
    mixinKey: string,
    timestampSeconds: number,
    page?: number,
  ): string
  createMixinKey(imgKey: string, subKey: string): string
  createBilibiliSearchApiUrl(
    query: string,
    limit: number,
    mixinKey: string,
    timestampSeconds: number,
    searchType?: 'video' | 'media_bangumi',
    page?: number,
  ): string
  createBilibiliSearchUrl(query: string): string
  createBilibiliVideoUrl(request: {
    bvid?: string
    episodeId?: string | number
  }): string
  parseBilibiliVideoPage(url: string): {
    kind: 'video' | 'episode'
    bvid: string | null
    episodeId: string | null
    url: string
  } | null
  isAllowedBilibiliNavigationUrl(url: string): boolean
  isAllowedBilibiliEmbeddedPageUrl(url: string): boolean
  isAllowedBilibiliPlayerUrl(url: string): boolean
  installBilibiliPlayerWebviewGuard(
    hostContents: EventEmitter,
    expectedSession?: object,
  ): () => void
  normalizeBilibiliBangumiSearchResponse(
    payload: Record<string, unknown>,
    limit: number,
  ): Array<Record<string, unknown>>
  normalizeBilibiliSearchPagination(
    payload: Record<string, unknown>,
    requestedPage?: number,
    requestedPageSize?: number,
    normalizedResultCount?: number,
  ): {
    page: number
    totalCount: number
    numPages: number
    hasMore: boolean
  }
  normalizeBilibiliSelectionDescriptor(raw: Record<string, unknown>):
    | Record<string, unknown>
    | null
  parseBilibiliEmbeddedPageUrl(url: string): {
    kind: 'video' | 'episode'
    bvid: string | null
    episodeId: string | null
    mediaId: string
    url: string
  } | null
  createBilibiliSessionManager(options: Record<string, unknown>): {
    getAuthState(): Promise<{ signedIn: boolean }>
    logout(): Promise<{ signedIn: boolean }>
    openLogin(): Promise<{ signedIn: boolean }>
    searchVideos(request: { query: string; limit?: number; page?: number }): Promise<{
      query: string
      page: number
      pageSize: number
      totalCount: number
      hasMore: boolean
      nextPage: number | null
      results: Array<Record<string, unknown>>
    }>
    openVideo(request: { bvid?: string; episodeId?: string | number }): Promise<boolean>
    dispose(): void
  }
}

class FakeCookies extends EventEmitter {
  values: Array<{ name: string; value: string; domain: string }> = []
  flushCount = 0

  async get() {
    return this.values
  }

  async flushStore() {
    this.flushCount += 1
  }
}

class FakeSession extends EventEmitter {
  cookies = new FakeCookies()
  permissionCheckHandler: null | ((...args: unknown[]) => boolean) = null
  permissionRequestHandler:
    | null
    | ((...args: [...unknown[], (allowed: boolean) => void, Record<string, unknown>]) => void) = null
  clearDataCount = 0
  closeConnectionsCount = 0
  flushStorageCount = 0
  fetchedUrls: string[] = []
  fetchHandler: null | ((url: string, options?: Record<string, unknown>) => Promise<Response>) = null

  setPermissionCheckHandler(handler: (...args: unknown[]) => boolean) {
    this.permissionCheckHandler = handler
  }

  setPermissionRequestHandler(handler: (...args: unknown[]) => void) {
    this.permissionRequestHandler = handler as typeof this.permissionRequestHandler
  }

  async closeAllConnections() {
    this.closeConnectionsCount += 1
  }

  async clearData() {
    this.clearDataCount += 1
    this.cookies.values = []
  }

  async flushStorageData() {
    this.flushStorageCount += 1
  }

  async fetch(url: string, options?: Record<string, unknown>) {
    this.fetchedUrls.push(url)
    if (this.fetchHandler) return this.fetchHandler(url, options)
    return {
      ok: true,
      url,
      headers: new Headers({
        'content-length': '12',
        'content-type': 'image/png',
      }),
      body: new Response(Buffer.from('png-cover-12')).body,
    }
  }
}

class FakeWebContents extends EventEmitter {
  currentUrl = ''
  destroyed = false
  embeddedVideoFrameReady = true
  executedScripts: string[] = []
  loadedUrls: string[] = []
  openHandler: null | ((details: { url: string }) => { action: string }) = null
  publicMeta: Record<string, string> = {}

  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
    this.openHandler = handler
  }

  async loadURL(url: string) {
    this.currentUrl = url
    this.loadedUrls.push(url)
  }

  getURL() {
    return this.currentUrl
  }

  isDestroyed() {
    return this.destroyed
  }

  async executeJavaScript(script = '') {
    this.executedScripts.push(script)
    if (script.includes('document.fullscreenElement')) return true
    if (script.includes('aurora-embedded-video-frame-ready')) {
      return this.embeddedVideoFrameReady
    }
    return this.publicMeta
  }
}

class FakeNativeImage {
  dataUrl: string
  empty: boolean
  height: number
  resizeOptions: Array<Record<string, unknown>> = []
  width: number

  constructor(
    width: number,
    height: number,
    dataUrl = 'data:image/png;base64,ZmFrZS1mcmFtZQ==',
    empty = false,
  ) {
    this.width = width
    this.height = height
    this.dataUrl = dataUrl
    this.empty = empty
  }

  getSize() {
    return { width: this.width, height: this.height }
  }

  isEmpty() {
    return this.empty
  }

  resize(options: { width?: number; height?: number; quality?: string }) {
    this.resizeOptions.push(options)
    const width = options.width ?? Math.round(
      this.width * ((options.height ?? this.height) / this.height),
    )
    const height = options.height ?? Math.round(
      this.height * ((options.width ?? this.width) / this.width),
    )
    return new FakeNativeImage(width, height, this.dataUrl, this.empty)
  }

  toDataURL() {
    return this.dataUrl
  }
}

class FakeGuestWebContents extends FakeWebContents {
  captureCalls = 0
  captureImage: FakeNativeImage | null = null
  insertedCss: string[] = []
  invalidated = 0
  partition: string
  seasonFetches: Array<{ url: string; options?: Record<string, unknown> }> = []
  seasonPayload: Record<string, unknown> | null
  session: {
    getPartition: () => string
    fetch: (url: string, options?: Record<string, unknown>) => Promise<Response>
  }

  constructor(
    partition = BILIBILI_PARTITION,
    initialUrl = '',
    seasonPayload: Record<string, unknown> | null = null,
  ) {
    super()
    this.partition = partition
    this.seasonPayload = seasonPayload
    this.session = {
      getPartition: () => this.partition,
      fetch: async (url, options) => {
        this.seasonFetches.push({ url, options })
        const body = JSON.stringify(this.seasonPayload ?? { code: -1 })
        return new Response(body, {
          status: 200,
          headers: {
            'content-length': String(Buffer.byteLength(body)),
            'content-type': 'application/json',
          },
        })
      },
    }
    this.currentUrl = initialUrl
  }

  async insertCSS(css: string) {
    this.insertedCss.push(css)
    return `css-${this.insertedCss.length}`
  }

  invalidate() {
    this.invalidated += 1
  }

  async capturePage() {
    this.captureCalls += 1
    return this.captureImage
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('destroyed')
  }
}

class FakeBrowserWindow extends EventEmitter {
  static instances: FakeBrowserWindow[] = []

  options: Record<string, any>
  webContents = new FakeWebContents()
  destroyed = false
  shown = false
  focused = false
  fullScreen = false
  fullScreenable = true
  fullScreenCalls: boolean[] = []
  fullScreenableCalls: boolean[] = []

  constructor(options: Record<string, unknown>) {
    super()
    this.options = options
    FakeBrowserWindow.instances.push(this)
  }

  async loadURL(url: string) {
    await this.webContents.loadURL(url)
  }

  setMenuBarVisibility() {}

  setFullScreen(value: boolean) {
    this.fullScreen = value
    this.fullScreenCalls.push(value)
  }

  setFullScreenable(value: boolean) {
    this.fullScreenable = value
    this.fullScreenableCalls.push(value)
  }

  isDestroyed() {
    return this.destroyed
  }

  isMinimized() {
    return false
  }

  show() {
    this.shown = true
  }

  focus() {
    this.focused = true
  }

  close() {
    if (this.destroyed) return
    this.destroyed = true
    this.webContents.destroyed = true
    this.emit('closed')
  }
}

function createFixture(cacheDirectory: string) {
  FakeBrowserWindow.instances = []
  const dedicatedSession = new FakeSession()
  const partitionCalls: Array<[string, Record<string, unknown>]> = []
  const selections: Array<Record<string, unknown>> = []
  const authStates: Array<{ signedIn: boolean }> = []
  const manager = createBilibiliSessionManager({
    BrowserWindow: FakeBrowserWindow,
    sessionModule: {
      fromPartition(partition: string, options: Record<string, unknown>) {
        partitionCalls.push([partition, options])
        return dedicatedSession
      },
    },
    getParentWindow: () => ({ isDestroyed: () => false }),
    cacheDirectory,
    onSelection: (selection: Record<string, unknown>) => selections.push(selection),
    onAuthStateChange: (state: { signedIn: boolean }) => authStates.push(state),
  })
  return { authStates, dedicatedSession, manager, partitionCalls, selections }
}

test('builds only canonical Bilibili search and video URLs from structured input', () => {
  expect(createBilibiliSearchUrl(' 冰川 光影 ')).toBe(
    'https://search.bilibili.com/all?keyword=%E5%86%B0%E5%B7%9D+%E5%85%89%E5%BD%B1',
  )
  expect(() => createBilibiliSearchUrl(' \n ')).toThrow()

  expect(createBilibiliVideoUrl({ bvid: 'BV1xx411c7mD' })).toBe(
    'https://www.bilibili.com/video/BV1xx411c7mD',
  )
  expect(createBilibiliVideoUrl({ episodeId: 'ep12345' })).toBe(
    'https://www.bilibili.com/bangumi/play/ep12345',
  )
  expect(() => createBilibiliVideoUrl({ bvid: 'https://www.bilibili.com/video/BV1xx411c7mD' })).toThrow()
  expect(() => createBilibiliVideoUrl({
    bvid: 'BV1xx411c7mD',
    url: 'https://attacker.example',
  } as { bvid: string })).toThrow()
  expect(() => createBilibiliVideoUrl({ bvid: 'BV1xx411c7mD', episodeId: 1 })).toThrow()
  expect(() => createBilibiliVideoUrl({ episodeId: '../123' })).toThrow()
})

test('creates a deterministic WBI-signed public search URL', () => {
  const mixinKey = createMixinKey(
    '7cd084941338484aae1ad9425b84077c',
    '4932caff0ff746eab6f01bf08b70ac45',
  )
  expect(mixinKey).toBe('ea1db124af3c7062474693fa704f4ff8')
  expect(
    createBilibiliSearchApiUrl(' 冰川 ', 12, mixinKey, 1_722_680_000),
  ).toBe(
    'https://api.bilibili.com/x/web-interface/wbi/search/type?keyword=%E5%86%B0%E5%B7%9D&page=1&page_size=12&search_type=video&wts=1722680000&w_rid=1b5effe813c5fb31472406961f299667',
  )
  expect(() =>
    createBilibiliSearchApiUrl('test', 19, mixinKey, 1_722_680_000),
  ).toThrow()
  expect(
    createBilibiliSearchApiUrl(
      '冰川',
      12,
      mixinKey,
      1_722_680_000,
      'video',
      2,
    ),
  ).toBe(
    'https://api.bilibili.com/x/web-interface/wbi/search/type?keyword=%E5%86%B0%E5%B7%9D&page=2&page_size=12&search_type=video&wts=1722680000&w_rid=e045b354b77b0b7b41478154f4b46c58',
  )
  expect(() =>
    createBilibiliSearchApiUrl(
      'test',
      12,
      mixinKey,
      1_722_680_000,
      'video',
      0,
    ),
  ).toThrow()
})

test('creates a deterministic WBI-signed official bangumi search URL', () => {
  const mixinKey = createMixinKey(
    '7cd084941338484aae1ad9425b84077c',
    '4932caff0ff746eab6f01bf08b70ac45',
  )
  const url = createBilibiliBangumiSearchApiUrl(
    ' 间谍 过家家 ',
    12,
    mixinKey,
    1_722_680_000,
  )
  expect(url).toBe(
    'https://api.bilibili.com/x/web-interface/wbi/search/type?keyword=%E9%97%B4%E8%B0%8D%20%E8%BF%87%E5%AE%B6%E5%AE%B6&page=1&page_size=12&search_type=media_bangumi&wts=1722680000&w_rid=decadcf7f8076de35792f81bcc0464f0',
  )
  expect(() =>
    createBilibiliBangumiSearchApiUrl(' \n ', 12, mixinKey, 1_722_680_000),
  ).toThrow()
  expect(() =>
    createBilibiliBangumiSearchApiUrl('test', 19, mixinKey, 1_722_680_000),
  ).toThrow()
})

test('normalizes bounded Bilibili search pagination metadata', () => {
  expect(normalizeBilibiliSearchPagination({
    data: {
      page: '2',
      pagesize: '12',
      numResults: '61',
      numPages: '6',
    },
  }, 2, 12, 12)).toEqual({
    page: 2,
    totalCount: 61,
    numPages: 6,
    hasMore: true,
  })

  expect(normalizeBilibiliSearchPagination({
    data: {
      page: 6,
      page_size: 12,
      numResults: 61,
      numPages: 6,
    },
  }, 6, 12, 1)).toEqual({
    page: 6,
    totalCount: 61,
    numPages: 6,
    hasMore: false,
  })
})

test('keeps pagination conservative when Bilibili omits metadata', () => {
  expect(normalizeBilibiliSearchPagination({ data: {} }, 1, 12, 12)).toEqual({
    page: 1,
    totalCount: 13,
    numPages: 2,
    hasMore: true,
  })
  expect(normalizeBilibiliSearchPagination({ data: {} }, 1, 12, 5)).toEqual({
    page: 1,
    totalCount: 5,
    numPages: 1,
    hasMore: false,
  })
  expect(normalizeBilibiliSearchPagination({ data: {} }, 1, 12, 0)).toEqual({
    page: 1,
    totalCount: 0,
    numPages: 0,
    hasMore: false,
  })

  // Explicit exhaustion wins over the full-page fallback.
  expect(normalizeBilibiliSearchPagination({
    data: { page: 1, numPages: 1 },
  }, 1, 12, 12)).toEqual({
    page: 1,
    totalCount: 12,
    numPages: 1,
    hasMore: false,
  })
})

test('rejects mismatched and malicious Bilibili pagination values', () => {
  expect(normalizeBilibiliSearchPagination({
    data: {
      page: 999,
      pagesize: 1,
      numResults: Number.MAX_SAFE_INTEGER,
      numPages: 999,
    },
  }, 2, 12, 3)).toEqual({
    page: 2,
    totalCount: 15,
    numPages: 2,
    hasMore: false,
  })

  expect(normalizeBilibiliSearchPagination({
    data: {
      page: 1,
      pagesize: { valueOf: () => 1 },
      numResults: Number.MAX_SAFE_INTEGER + 1,
      numPages: '1e9',
    },
  }, 1, 12, 12)).toEqual({
    page: 1,
    totalCount: 13,
    numPages: 2,
    hasMore: true,
  })
})

test('uses a strict HTTPS hostname and public-video-page allowlist', () => {
  expect(isAllowedBilibiliNavigationUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true)
  expect(isAllowedBilibiliNavigationUrl('https://search.bilibili.com/all?keyword=test')).toBe(true)
  expect(isAllowedBilibiliNavigationUrl('http://www.bilibili.com/video/BV1xx411c7mD')).toBe(false)
  expect(isAllowedBilibiliNavigationUrl('https://www.bilibili.com.evil.test/video/BV1xx411c7mD')).toBe(false)
  expect(isAllowedBilibiliNavigationUrl('https://user@www.bilibili.com/video/BV1xx411c7mD')).toBe(false)
  expect(isAllowedBilibiliNavigationUrl('javascript:alert(1)')).toBe(false)

  expect(parseBilibiliVideoPage('https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333')).toEqual({
    kind: 'video',
    bvid: 'BV1xx411c7mD',
    episodeId: null,
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  })
  expect(parseBilibiliVideoPage('https://search.bilibili.com/all?keyword=BV1xx411c7mD')).toBeNull()
})

test('allows only canonical Bilibili official video and episode pages for embedding', () => {
  const videoUrl = 'https://www.bilibili.com/video/BV1xx411c7mD/'
  const episodeUrl = 'https://www.bilibili.com/bangumi/play/ep12345'

  expect(parseBilibiliEmbeddedPageUrl(videoUrl)).toEqual({
    kind: 'video',
    bvid: 'BV1xx411c7mD',
    episodeId: null,
    mediaId: 'BV1xx411c7mD',
    url: videoUrl,
  })
  expect(parseBilibiliEmbeddedPageUrl(
    'https://www.bilibili.com/video/BV1xx411c7mD',
  )).toEqual(parseBilibiliEmbeddedPageUrl(videoUrl))
  expect(parseBilibiliEmbeddedPageUrl(episodeUrl)).toEqual({
    kind: 'episode',
    bvid: null,
    episodeId: '12345',
    mediaId: '12345',
    url: episodeUrl,
  })
  expect(parseBilibiliEmbeddedPageUrl(
    `${episodeUrl}?from_spmid=666.25.episode.0`,
  )).toEqual(parseBilibiliEmbeddedPageUrl(episodeUrl))
  expect(isAllowedBilibiliEmbeddedPageUrl(videoUrl)).toBe(true)
  expect(isAllowedBilibiliEmbeddedPageUrl(episodeUrl)).toBe(true)
  expect(isAllowedBilibiliEmbeddedPageUrl(
    `${episodeUrl}?from_spmid=666.25.episode.0`,
  )).toBe(true)
  expect(isAllowedBilibiliPlayerUrl(videoUrl)).toBe(true)

  for (const rejectedUrl of [
    'http://www.bilibili.com/video/BV1xx411c7mD/',
    'https://www.bilibili.com.evil.test/video/BV1xx411c7mD/',
    'https://user@www.bilibili.com/video/BV1xx411c7mD/',
    'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333',
    'https://www.bilibili.com/video/BV1xx411c7mD/#reply',
    'https://www.bilibili.com/video/not-a-bvid/',
    'https://www.bilibili.com/bangumi/play/ss12345',
    'https://www.bilibili.com/',
    'https://search.bilibili.com/all?keyword=test',
    'https://player.bilibili.com/player.html?isOutside=true&bvid=BV1xx411c7mD',
  ]) {
    expect(isAllowedBilibiliEmbeddedPageUrl(rejectedUrl), rejectedUrl).toBe(false)
    expect(isAllowedBilibiliPlayerUrl(rejectedUrl), rejectedUrl).toBe(false)
  }
})

test('hardens the main-window webview, locks one official page, and isolates its player root', async () => {
  const hostContents = new EventEmitter()
  const dispose = installBilibiliPlayerWebviewGuard(hostContents)
  const playerUrl = 'https://www.bilibili.com/video/BV1xx411c7mD/'
  const webPreferences: Record<string, unknown> = {
    allowRunningInsecureContent: true,
    contextIsolation: false,
    devTools: true,
    nodeIntegration: true,
    nodeIntegrationInSubFrames: true,
    partition: 'persist:attacker',
    plugins: true,
    preload: '/tmp/attacker-preload.cjs',
    preloadURL: 'file:///tmp/attacker-preload.cjs',
    sandbox: false,
    session: { partition: 'persist:attacker' },
    spellcheck: true,
    webSecurity: false,
    webviewTag: true,
  }
  let validPrevented = false
  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => { validPrevented = true } },
    webPreferences,
    { partition: BILIBILI_PARTITION, src: playerUrl },
  )

  expect(validPrevented).toBe(false)
  expect(webPreferences).toMatchObject({
    allowRunningInsecureContent: false,
    contextIsolation: true,
    devTools: false,
    disableHtmlFullscreenWindowResize: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    navigateOnDragDrop: false,
    partition: BILIBILI_PARTITION,
    plugins: false,
    sandbox: true,
    spellcheck: false,
    webSecurity: true,
    webviewTag: false,
  })
  expect(webPreferences.preload).toBeUndefined()
  expect(webPreferences.preloadURL).toBeUndefined()
  expect(webPreferences.session).toBeUndefined()

  // The provider guard now owns only its own reviewed partition. The central
  // online-player firewall is responsible for rejecting unknown partitions.
  let foreignPartitionPrevented = false
  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => { foreignPartitionPrevented = true } },
    {},
    { partition: 'persist:attacker', src: playerUrl },
  )
  expect(foreignPartitionPrevented).toBe(false)
  let missingPartitionPrevented = false
  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => { missingPartitionPrevented = true } },
    {},
    { src: playerUrl },
  )
  expect(missingPartitionPrevented).toBe(false)

  for (const params of [
    {
      partition: BILIBILI_PARTITION,
      src: 'https://player.bilibili.com/player.html?isOutside=true&bvid=BV1xx411c7mD',
    },
    {
      partition: BILIBILI_PARTITION,
      src: 'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333',
    },
  ]) {
    let prevented = false
    hostContents.emit(
      'will-attach-webview',
      { preventDefault: () => { prevented = true } },
      {},
      params,
    )
    expect(prevented, JSON.stringify(params)).toBe(true)
  }

  const guest = new FakeGuestWebContents(BILIBILI_PARTITION, playerUrl)
  hostContents.emit('did-attach-webview', {}, guest)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(guest.insertedCss).toHaveLength(1)

  let allowedNavigationPrevented = false
  guest.emit(
    'will-navigate',
    { preventDefault: () => { allowedNavigationPrevented = true } },
    playerUrl,
  )
  expect(allowedNavigationPrevented).toBe(false)

  let canonicalNavigationPrevented = false
  guest.emit(
    'will-navigate',
    { preventDefault: () => { canonicalNavigationPrevented = true } },
    'https://www.bilibili.com/video/BV1xx411c7mD',
  )
  expect(canonicalNavigationPrevented).toBe(false)

  let blockedNavigation = false
  guest.emit(
    'will-redirect',
    { preventDefault: () => { blockedNavigation = true } },
    'https://www.bilibili.com/video/BV1ab411c7mE/',
  )
  expect(blockedNavigation).toBe(true)
  expect(guest.openHandler?.({ url: playerUrl })).toEqual({ action: 'deny' })

  guest.emit('dom-ready')
  guest.emit('did-finish-load')
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(guest.insertedCss).toHaveLength(1)
  expect(guest.insertedCss[0]).toBe(BILIBILI_EMBEDDED_PLAYER_CSS)
  expect(guest.insertedCss[0]).toContain('#bilibili-player-wrap')
  expect(guest.insertedCss[0]).toContain('#playerWrap')
  expect(guest.insertedCss[0]).toContain('body:has(#bilibili-player) #bilibili-player')
  expect(guest.insertedCss[0]).toContain('.bpx-player-container')
  expect(guest.insertedCss[0]).toContain('.bpx-player-ctrl-eplist')
  expect(guest.insertedCss[0]).toContain('visibility: visible !important')
  expect(guest.insertedCss[0]).not.toContain('body > *')

  guest.emit('leave-html-full-screen')
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(guest.insertedCss).toHaveLength(2)
  expect(guest.invalidated).toBe(1)

  const loadsBeforeSameDocumentVariants = guest.loadedUrls.length
  for (const sameDocumentUrl of [
    `${playerUrl}?spm_id_from=333.1007.0.0&p=2`,
    `${playerUrl}#reply`,
    `${playerUrl}?vd_source=aurora#player`,
  ]) {
    guest.emit('did-navigate-in-page', {}, sameDocumentUrl, true)
  }
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(guest.loadedUrls).toHaveLength(loadsBeforeSameDocumentVariants)

  guest.emit('did-navigate-in-page', {}, 'https://www.bilibili.com/video/BV1ab411c7mE/', true)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(guest.loadedUrls.at(-1)).toBe(playerUrl)

  let nestedWebviewPrevented = false
  guest.emit('will-attach-webview', {
    preventDefault: () => { nestedWebviewPrevented = true },
  })
  expect(nestedWebviewPrevented).toBe(true)

  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    {},
    { partition: BILIBILI_PARTITION, src: playerUrl },
  )
  const wrongPartitionGuest = new FakeGuestWebContents(
    'persist:attacker',
    playerUrl,
  )
  hostContents.emit('did-attach-webview', {}, wrongPartitionGuest)
  expect(wrongPartitionGuest.destroyed).toBe(true)

  dispose()
  expect(hostContents.listenerCount('will-attach-webview')).toBe(0)
  expect(hostContents.listenerCount('did-attach-webview')).toBe(0)
})

test('matches a Bilibili guest by real Electron Session identity', async () => {
  const hostContents = new EventEmitter()
  const playerUrl = 'https://www.bilibili.com/video/BV1xx411c7mD/'
  const guest = new FakeGuestWebContents(BILIBILI_PARTITION, playerUrl)
  const expectedSession = guest.session
  delete (expectedSession as { getPartition?: () => string }).getPartition
  const dispose = installBilibiliPlayerWebviewGuard(
    hostContents,
    expectedSession,
  )

  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    {},
    { partition: BILIBILI_PARTITION, src: playerUrl },
  )
  hostContents.emit('did-attach-webview', {}, guest)

  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(guest.destroyed).toBe(false)
  expect(guest.insertedCss).toHaveLength(1)
  dispose()
})

test('does not rewrite same-document Bilibili state after autoplay starts', async () => {
  const hostContents = new EventEmitter()
  const dispose = installBilibiliPlayerWebviewGuard(hostContents)
  const playerUrl = 'https://www.bilibili.com/video/BV1xx411c7mD/'

  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    {},
    { partition: BILIBILI_PARTITION, src: playerUrl },
  )
  const guest = new FakeGuestWebContents(BILIBILI_PARTITION, playerUrl)
  hostContents.emit('did-attach-webview', {}, guest)

  const loadsBeforeAutoplay = guest.loadedUrls.length
  guest.emit('media-started-playing')
  guest.emit(
    'did-navigate-in-page',
    {},
    `${playerUrl}?autoplay=1&spm_id_from=333.1007.0.0#player`,
    true,
  )
  await new Promise<void>((resolve) => setImmediate(resolve))

  expect(guest.loadedUrls).toHaveLength(loadsBeforeAutoplay)
  expect(guest.destroyed).toBe(false)
  dispose()
})

test('keeps a guest that decorates its URL before attach and rejects another media item', async () => {
  const hostContents = new EventEmitter()
  const dispose = installBilibiliPlayerWebviewGuard(hostContents)
  const playerUrl = 'https://www.bilibili.com/video/BV1xx411c7mD/'

  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    {},
    { partition: BILIBILI_PARTITION, src: playerUrl },
  )
  const decoratedGuest = new FakeGuestWebContents(
    BILIBILI_PARTITION,
    `${playerUrl}?autoplay=1&spm_id_from=333.1007.0.0#player`,
  )
  decoratedGuest.captureImage = new FakeNativeImage(1920, 1080)
  hostContents.emit('did-attach-webview', {}, decoratedGuest)

  expect(decoratedGuest.destroyed).toBe(false)
  decoratedGuest.emit('dom-ready')
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(decoratedGuest.insertedCss).toHaveLength(1)
  await expect(
    captureBilibiliEmbeddedFrame(hostContents, {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
    }),
  ).resolves.toBe('data:image/png;base64,ZmFrZS1mcmFtZQ==')
  dispose()

  const otherHostContents = new EventEmitter()
  const disposeOther = installBilibiliPlayerWebviewGuard(otherHostContents)
  otherHostContents.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    {},
    { partition: BILIBILI_PARTITION, src: playerUrl },
  )
  const otherGuest = new FakeGuestWebContents(
    BILIBILI_PARTITION,
    'https://www.bilibili.com/video/BV1ab411c7mE/?autoplay=1#player',
  )
  otherHostContents.emit('did-attach-webview', {}, otherGuest)
  expect(otherGuest.destroyed).toBe(true)
  await expect(
    captureBilibiliEmbeddedFrame(otherHostContents, {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
    }),
  ).resolves.toBeNull()
  disposeOther()
})

test('captures one bounded frame only from the matching protected guest', async () => {
  const hostContents = new EventEmitter()
  const dispose = installBilibiliPlayerWebviewGuard(hostContents)
  const playerUrl = 'https://www.bilibili.com/video/BV1xx411c7mD/'

  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    {},
    { partition: BILIBILI_PARTITION, src: playerUrl },
  )
  const guest = new FakeGuestWebContents(BILIBILI_PARTITION, playerUrl)
  guest.captureImage = new FakeNativeImage(1920, 1080)
  hostContents.emit('did-attach-webview', {}, guest)

  guest.embeddedVideoFrameReady = false
  await expect(
    captureBilibiliEmbeddedFrame(hostContents, {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
    }),
  ).resolves.toBeNull()
  expect(guest.captureCalls).toBe(0)

  guest.embeddedVideoFrameReady = true
  await expect(
    captureBilibiliEmbeddedFrame(hostContents, {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
    }),
  ).resolves.toBe('data:image/png;base64,ZmFrZS1mcmFtZQ==')
  expect(guest.captureCalls).toBe(1)
  expect(guest.captureImage.resizeOptions).toEqual([
    { quality: 'good', width: 480 },
  ])

  await expect(
    captureBilibiliEmbeddedFrame(hostContents, {
      kind: 'video',
      mediaId: 'BV1ab411c7mE',
    }),
  ).resolves.toBeNull()
  await expect(
    captureBilibiliEmbeddedFrame(new EventEmitter(), {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
    }),
  ).resolves.toBeNull()
  await expect(
    captureBilibiliEmbeddedFrame(hostContents, {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
      extra: true,
    } as unknown as { kind: 'video'; mediaId: string }),
  ).resolves.toBeNull()
  expect(guest.captureCalls).toBe(1)

  dispose()
  await expect(
    captureBilibiliEmbeddedFrame(hostContents, {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
    }),
  ).resolves.toBeNull()
  expect(guest.captureCalls).toBe(1)
})

test('rejects capture without a live guest and caps portrait frames by height', async () => {
  const hostContents = new EventEmitter()
  const dispose = installBilibiliPlayerWebviewGuard(hostContents)
  const playerUrl = 'https://www.bilibili.com/video/BV1xx411c7mD/'

  await expect(
    captureBilibiliEmbeddedFrame(hostContents, {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
    }),
  ).resolves.toBeNull()

  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    {},
    { partition: BILIBILI_PARTITION, src: playerUrl },
  )
  const guest = new FakeGuestWebContents(BILIBILI_PARTITION, playerUrl)
  guest.captureImage = new FakeNativeImage(
    600,
    1200,
    'data:image/jpeg;base64,anBlZy1mcmFtZQ==',
  )
  hostContents.emit('did-attach-webview', {}, guest)

  await expect(
    captureBilibiliEmbeddedFrame(hostContents, {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
    }),
  ).resolves.toBe('data:image/jpeg;base64,anBlZy1mcmFtZQ==')
  expect(guest.captureImage.resizeOptions).toEqual([
    { height: 480, quality: 'good' },
  ])

  guest.destroy()
  await expect(
    captureBilibiliEmbeddedFrame(hostContents, {
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
    }),
  ).resolves.toBeNull()

  dispose()
})

test('allows episode navigation only inside the season proven by official metadata', async () => {
  const hostContents = new EventEmitter()
  const dispose = installBilibiliPlayerWebviewGuard(hostContents)
  const firstEpisodeUrl = 'https://www.bilibili.com/bangumi/play/ep733316'
  const nextEpisodeUrl = 'https://www.bilibili.com/bangumi/play/ep733317'
  const sectionEpisodeUrl = 'https://www.bilibili.com/bangumi/play/ep900001'
  const unrelatedEpisodeUrl = 'https://www.bilibili.com/bangumi/play/ep888888'

  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    {},
    { partition: BILIBILI_PARTITION, src: firstEpisodeUrl },
  )
  const guest = new FakeGuestWebContents(
    BILIBILI_PARTITION,
    firstEpisodeUrl,
    {
      code: 0,
      result: {
        season_id: 28747,
        episodes: [{ id: 733316 }, { id: 733317 }],
        section: [{ episodes: [{ id: 900001 }] }],
        // This neighbouring-season collection is deliberately ignored.
        seasons: [{ episodes: [{ id: 888888 }] }],
      },
    },
  )
  hostContents.emit('did-attach-webview', {}, guest)

  await expect.poll(() => guest.seasonFetches.length).toBe(1)
  expect(guest.seasonFetches[0]).toMatchObject({
    url: 'https://api.bilibili.com/pgc/view/web/season?ep_id=733316',
    options: {
      credentials: 'include',
      method: 'GET',
      redirect: 'error',
    },
  })

  for (const allowedUrl of [nextEpisodeUrl, sectionEpisodeUrl]) {
    let prevented = false
    guest.emit(
      'will-navigate',
      { preventDefault: () => { prevented = true } },
      allowedUrl,
    )
    expect(prevented, allowedUrl).toBe(false)
  }

  let trackedEpisodeNavigationPrevented = false
  guest.emit(
    'will-navigate',
    { preventDefault: () => { trackedEpisodeNavigationPrevented = true } },
    `${nextEpisodeUrl}?from_spmid=666.25.episode.0`,
  )
  expect(trackedEpisodeNavigationPrevented).toBe(false)

  guest.currentUrl = `${nextEpisodeUrl}?from_spmid=666.25.episode.0`
  guest.emit(
    'did-navigate-in-page',
    {},
    guest.currentUrl,
    true,
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(guest.loadedUrls).toHaveLength(0)

  for (const rejectedUrl of [
    unrelatedEpisodeUrl,
    'https://www.bilibili.com/video/BV1xx411c7mD/',
    `${nextEpisodeUrl}?from_spmid=666.25&untrusted=1`,
  ]) {
    let prevented = false
    guest.emit(
      'will-navigate',
      { preventDefault: () => { prevented = true } },
      rejectedUrl,
    )
    expect(prevented, rejectedUrl).toBe(true)
  }

  guest.emit('did-start-navigation', {}, nextEpisodeUrl, false, true)
  guest.currentUrl = nextEpisodeUrl
  guest.emit('did-navigate', {}, nextEpisodeUrl)
  guest.emit('dom-ready')
  await expect.poll(() => guest.insertedCss.length).toBe(2)
  await expect.poll(() => guest.seasonFetches.length).toBe(2)
  expect(guest.seasonFetches[1].url).toBe(
    'https://api.bilibili.com/pgc/view/web/season?ep_id=733317',
  )

  guest.emit('did-navigate-in-page', {}, unrelatedEpisodeUrl, true)
  await expect.poll(() => guest.loadedUrls.at(-1)).toBe(nextEpisodeUrl)

  dispose()
})

test('keeps an episode locked when official metadata cannot prove its season', async () => {
  const hostContents = new EventEmitter()
  const dispose = installBilibiliPlayerWebviewGuard(hostContents)
  const lockedUrl = 'https://www.bilibili.com/bangumi/play/ep100001'

  hostContents.emit(
    'will-attach-webview',
    { preventDefault: () => undefined },
    {},
    { partition: BILIBILI_PARTITION, src: lockedUrl },
  )
  const guest = new FakeGuestWebContents(BILIBILI_PARTITION, lockedUrl, {
    code: 0,
    result: {
      season_id: 123,
      // The response does not contain the page being guarded, so it cannot be
      // used as proof even though it contains another syntactically valid ep.
      episodes: [{ id: 100002 }],
    },
  })
  hostContents.emit('did-attach-webview', {}, guest)
  await expect.poll(() => guest.seasonFetches.length).toBe(1)

  let prevented = false
  guest.emit(
    'will-navigate',
    { preventDefault: () => { prevented = true } },
    'https://www.bilibili.com/bangumi/play/ep100002',
  )
  expect(prevented).toBe(true)

  dispose()
})

test('normalizes only public page metadata and rejects an untrusted cover host', () => {
  expect(normalizeBilibiliSelectionDescriptor({
    pageUrl: 'https://www.bilibili.com/video/BV1xx411c7mD?share_source=copy_web',
    title: '  冰川\n  光影  ',
    description: '公开简介',
    coverUrl: 'https://attacker.example/cover.png',
    author: '创作者',
    cookie: 'must-not-pass',
  })).toEqual({
    source: 'bilibili',
    kind: 'video',
    mediaId: 'BV1xx411c7mD',
    bvid: 'BV1xx411c7mD',
    episodeId: null,
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    canonicalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    title: '冰川 光影',
    description: '公开简介',
    coverUrl: null,
    thumbnailPath: null,
    author: '创作者',
    duration: '',
    publishedAt: '',
    tags: [],
  })
})

test('normalizes official bangumi results to canonical numeric episode descriptors', () => {
  const results = normalizeBilibiliBangumiSearchResponse({
    code: 0,
    data: {
      numResults: 3,
      result: [
        {
          type: 'media_bangumi',
          media_id: 27_709_925,
          title: '<em class="keyword">间谍过家家</em> &amp; 第三季',
          desc: '间谍、杀手与超能力者组成了一个临时家庭。',
          cover: 'http://i0.hdslb.com/bfs/bangumi/cover.png',
          season_type_name: '番剧',
          areas: '日本',
          styles: '漫画改,喜剧',
          labels: [{ name: '独家' }],
          media_score: { score: 9.8 },
          ep_size: 12,
          pubtime: 1_722_680_000,
          hit_epids: 'ep2243599,ep2243598',
          eps: [{ id: 111, url: 'https://attacker.example/episode' }],
          url: 'https://attacker.example/season',
        },
        {
          type: 'media_bangumi',
          title: '第二季',
          desc: '从 eps 第一项建立可播放入口。',
          cover: '//i1.hdslb.com/bfs/bangumi/cover-2.webp',
          season_type_name: '国创',
          areas: '中国大陆',
          styles: ['奇幻', '冒险'],
          hit_epids: '',
          eps: [
            { id: 334455, url: 'https://evil.test/ignored' },
            { id: 556677 },
          ],
        },
        {
          type: 'media_bangumi',
          title: '没有可播放剧集',
          hit_epids: '',
          eps: [],
        },
      ],
    },
  }, 12)

  expect(results).toHaveLength(2)
  expect(results[0]).toEqual({
    source: 'bilibili',
    kind: 'episode',
    mediaId: '2243599',
    bvid: null,
    episodeId: '2243599',
    url: 'https://www.bilibili.com/bangumi/play/ep2243599',
    canonicalUrl: 'https://www.bilibili.com/bangumi/play/ep2243599',
    title: '间谍过家家 & 第三季',
    description: '间谍、杀手与超能力者组成了一个临时家庭。',
    coverUrl: 'https://i0.hdslb.com/bfs/bangumi/cover.png',
    thumbnailPath: null,
    author: '番剧',
    duration: '12 集',
    publishedAt: '2024-08-03T10:13:20.000Z',
    tags: ['番剧', '日本', '漫画改', '喜剧', '独家', '评分 9.8'],
  })
  expect(results[1]).toMatchObject({
    kind: 'episode',
    mediaId: '334455',
    episodeId: '334455',
    canonicalUrl: 'https://www.bilibili.com/bangumi/play/ep334455',
    tags: ['国创', '中国大陆', '奇幻', '冒险'],
  })
  expect(JSON.stringify(results)).not.toContain('attacker.example')
  expect(JSON.stringify(results)).not.toContain('evil.test')
  expect(normalizeBilibiliBangumiSearchResponse({
    code: 0,
    data: { numResults: 0 },
  }, 12)).toEqual([])
})

test('search returns bounded sanitized descriptors without opening a remote search window', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-bilibili-search-'))
  try {
    const { dedicatedSession, manager } = createFixture(sandbox)
    const requestOptions: Array<Record<string, unknown> | undefined> = []
    dedicatedSession.fetchHandler = async (url, options) => {
      requestOptions.push(options)
      if (url === 'https://api.bilibili.com/x/web-interface/nav') {
        return new Response(JSON.stringify({
          code: -101,
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      }
      if (url.startsWith('https://api.bilibili.com/x/web-interface/wbi/search/type?')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            result: [
              {
                bvid: 'BV1xx411c7mD',
                title: '<em class="keyword">冰川</em> &amp; 光影',
                description: '公开视频描述',
                author: '创作者 A',
                pic: '//i0.hdslb.com/bfs/archive/cover-a.png',
                duration: '02:14',
                pubdate: 1_722_680_000,
                tag: '冰川,光影',
              },
              {
                bvid: 'BV1ab411c7mE',
                title: '第二条',
                description: '封面失败也保留结果',
                author: '创作者 B',
                pic: 'https://i1.hdslb.com/bfs/archive/cover-b.png',
              },
              {
                bvid: 'not-a-bvid',
                title: '必须过滤',
                cookie: 'must-not-pass',
              },
            ],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/cover-a.png')) {
        return new Response(Buffer.from('cover-a'), {
          status: 200,
          headers: {
            'content-length': '7',
            'content-type': 'image/png',
          },
        })
      }
      if (url.endsWith('/cover-b.png')) {
        return new Response('unavailable', { status: 503 })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    const response = await manager.searchVideos({ query: ' 冰川 ', limit: 5 })
    expect(FakeBrowserWindow.instances).toHaveLength(0)
    expect(response.query).toBe('冰川')
    expect(response.results).toHaveLength(2)
    expect(response.results[0]).toMatchObject({
      source: 'bilibili',
      kind: 'video',
      mediaId: 'BV1xx411c7mD',
      bvid: 'BV1xx411c7mD',
      title: '冰川 & 光影',
      author: '创作者 A',
      canonicalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      coverUrl: 'https://i0.hdslb.com/bfs/archive/cover-a.png',
      duration: '02:14',
      tags: ['冰川', '光影'],
    })
    expect(response.results[0].thumbnailPath).toEqual(expect.any(String))
    expect(response.results[1].thumbnailPath).toBeNull()
    expect(JSON.stringify(response)).not.toContain('must-not-pass')
    expect(requestOptions.every((options) => options?.credentials === 'omit')).toBe(true)
    expect(requestOptions.every((options) => options?.redirect === 'manual')).toBe(true)
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('search rejects an untrusted API redirect before following it', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-bilibili-redirect-'))
  try {
    const { dedicatedSession, manager } = createFixture(sandbox)
    dedicatedSession.fetchHandler = async (url) => {
      if (url === 'https://api.bilibili.com/x/web-interface/nav') {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
            },
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response('', {
        status: 302,
        headers: { location: 'https://attacker.example/steal' },
      })
    }
    await expect(
      manager.searchVideos({ query: 'test' }),
    ).rejects.toThrow(/untrusted URL/)
    expect(dedicatedSession.fetchedUrls).toContain(
      'https://api.bilibili.com/x/web-interface/nav',
    )
    expect(dedicatedSession.fetchedUrls.some((url) =>
      url.startsWith('https://api.bilibili.com/x/web-interface/wbi/search/type?'),
    )).toBe(true)
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('search merges video and bangumi results without allowing videos to crowd out bangumi', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-bilibili-merge-'))
  try {
    const { dedicatedSession, manager } = createFixture(sandbox)
    dedicatedSession.fetchHandler = async (url) => {
      if (url === 'https://api.bilibili.com/x/web-interface/nav') {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
            },
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('search_type=media_bangumi')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            numResults: 2,
            result: [
              {
                type: 'media_bangumi',
                title: '官方番剧一',
                hit_epids: '900001',
                eps: [],
              },
              {
                type: 'media_bangumi',
                title: '官方番剧二',
                hit_epids: '',
                eps: [{ id: 900002 }],
              },
            ],
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (url.startsWith('https://api.bilibili.com/x/web-interface/wbi/search/type?')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            result: [
              { bvid: 'BV1xx411c7mD', title: '普通视频一' },
              { bvid: 'BV1ab411c7mE', title: '普通视频二' },
              { bvid: 'BV1cd411c7mF', title: '普通视频三' },
            ],
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    const response = await manager.searchVideos({ query: '测试', limit: 3 })
    expect(response.results).toHaveLength(3)
    expect(response.results[0]).toEqual(
      expect.objectContaining({ kind: 'episode', mediaId: '900001' }),
    )
    expect(response.results.filter((result) => result.kind === 'video')).toHaveLength(2)
    expect(response.results.filter((result) => result.kind === 'episode')).toEqual([
      expect.objectContaining({
        mediaId: '900001',
        canonicalUrl: 'https://www.bilibili.com/bangumi/play/ep900001',
      }),
    ])
    expect(dedicatedSession.fetchedUrls[0]).toBe(
      'https://api.bilibili.com/x/web-interface/nav',
    )
    expect(dedicatedSession.fetchedUrls.some((url) =>
      url.includes('search_type=media_bangumi'),
    )).toBe(true)
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('search requests a bounded page without dropping pagination metadata', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-bilibili-page-'))
  try {
    const { dedicatedSession, manager } = createFixture(sandbox)
    dedicatedSession.fetchHandler = async (url) => {
      if (url === 'https://api.bilibili.com/x/web-interface/nav') {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
            },
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      const requestUrl = new URL(url)
      expect(requestUrl.searchParams.get('page')).toBe('2')
      if (requestUrl.searchParams.get('search_type') === 'media_bangumi') {
        expect(requestUrl.searchParams.get('page_size')).toBe('2')
        return new Response(JSON.stringify({
          code: 0,
          data: {
            page: 2,
            pagesize: 2,
            numResults: 2,
            numPages: 1,
            result: [],
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      expect(requestUrl.searchParams.get('page_size')).toBe('4')
      return new Response(JSON.stringify({
        code: 0,
        data: {
          page: 2,
          pagesize: 4,
          numResults: 40,
          numPages: 10,
          result: [
            { bvid: 'BV1xx411c7mD', title: '第二页一' },
            { bvid: 'BV1ab411c7mE', title: '第二页二' },
            { bvid: 'BV1cd411c7mF', title: '第二页三' },
            { bvid: 'BV1ef411c7mG', title: '第二页四' },
          ],
        },
      }), { headers: { 'content-type': 'application/json' } })
    }

    const response = await manager.searchVideos({
      query: '冰川',
      limit: 6,
      page: 2,
    })
    expect(response).toMatchObject({
      query: '冰川',
      page: 2,
      pageSize: 6,
      totalCount: 42,
      hasMore: true,
      nextPage: 3,
    })
    expect(response.results).toHaveLength(4)
    await expect(
      manager.searchVideos({ query: '冰川', page: 1_001 }),
    ).rejects.toThrow(/page must be between 1 and 1000/)
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('search still returns bangumi when the video search branch fails', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-bilibili-fallback-'))
  try {
    const { dedicatedSession, manager } = createFixture(sandbox)
    dedicatedSession.fetchHandler = async (url) => {
      if (url === 'https://api.bilibili.com/x/web-interface/nav') {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            wbi_img: {
              img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
              sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
            },
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('search_type=media_bangumi')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            numResults: 1,
            result: [{
              type: 'media_bangumi',
              title: '仍可播放的官方番剧',
              hit_epids: '',
              eps: [{ id: 778899 }],
            }],
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('search_type=video')) {
        return new Response('unavailable', { status: 503 })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    await expect(manager.searchVideos({ query: '番剧', limit: 6 })).resolves.toMatchObject({
      query: '番剧',
      results: [expect.objectContaining({ kind: 'episode', mediaId: '778899' })],
    })
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('desktop bridge exposes direct search through sender-validated IPC only', async () => {
  const [mainSource, preloadSource] = await Promise.all([
    readFile(path.resolve('electron/main.cjs'), 'utf8'),
    readFile(path.resolve('electron/preload.cjs'), 'utf8'),
  ])
  expect(mainSource).toContain("ipcMain.handle('bilibili:search'")
  expect(mainSource).toMatch(
    /ipcMain\.handle\('bilibili:search',[\s\S]{0,180}requireMainWindowSender\(event\)[\s\S]{0,180}searchVideos\(request\)/,
  )
  expect(preloadSource).toContain('searchBilibiliVideos: (request) =>')
  expect(preloadSource).toContain("ipcRenderer.invoke('bilibili:search', request)")
  expect(preloadSource).not.toContain('openBilibiliSearch:')
  expect(preloadSource).not.toContain('bilibili:search:open')
})

test('enables the main-window webview tag only behind the Bilibili attachment guard', async () => {
  const mainSource = await readFile(path.resolve('electron/main.cjs'), 'utf8')
  expect(mainSource).toContain('webviewTag: true')
  expect(mainSource).toContain('installBilibiliPlayerWebviewGuard(')
  expect(mainSource).toContain('session.fromPartition(BILIBILI_PARTITION)')
  expect(mainSource.indexOf('installBilibiliPlayerWebviewGuard('))
    .toBeLessThan(mainSource.indexOf("windowInstance.loadURL('http://127.0.0.1:5174')"))
})

test('login and playback windows share one hardened persistent session', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-bilibili-'))
  try {
    const { dedicatedSession, manager, partitionCalls } = createFixture(sandbox)
    await manager.openLogin()
    await manager.openVideo({ bvid: 'BV1xx411c7mD' })

    expect(partitionCalls).toEqual([[BILIBILI_PARTITION, { cache: true }]])
    expect(FakeBrowserWindow.instances).toHaveLength(2)
    for (const windowInstance of FakeBrowserWindow.instances) {
      expect(windowInstance.options.webPreferences).toMatchObject({
        session: dedicatedSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
      })
      expect(windowInstance.options.webPreferences.preload).toBeUndefined()
    }

    const loginContents = FakeBrowserWindow.instances[0].webContents
    const playbackContents = FakeBrowserWindow.instances[1].webContents
    const loginWindow = FakeBrowserWindow.instances[0]
    expect(loginWindow.options).toMatchObject({
      frame: true,
      closable: true,
      maximizable: false,
      fullscreen: false,
      fullscreenable: false,
    })
    expect(loginWindow.fullScreenable).toBe(false)
    let blockedNavigation = false
    playbackContents.emit(
      'will-navigate',
      { preventDefault: () => { blockedNavigation = true } },
      'https://evil.example/phishing',
    )
    expect(blockedNavigation).toBe(true)

    let allowedNavigationPrevented = false
    playbackContents.emit(
      'will-navigate',
      { preventDefault: () => { allowedNavigationPrevented = true } },
      'https://www.bilibili.com/video/BV1xx411c7mD',
    )
    expect(allowedNavigationPrevented).toBe(false)

    expect(loginContents.openHandler?.({
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    })).toEqual({ action: 'deny' })
    expect(playbackContents.openHandler?.({
      url: 'https://www.bilibili.com/video/BV1xx411c7mD?from=search',
    })).toEqual({ action: 'deny' })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(playbackContents.loadedUrls.at(-1)).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    )

    let downloadPrevented = false
    dedicatedSession.emit('will-download', {
      preventDefault: () => { downloadPrevented = true },
    })
    expect(downloadPrevented).toBe(true)
    expect(dedicatedSession.permissionCheckHandler?.(
      null,
      'camera',
      'https://www.bilibili.com',
      {},
    )).toBe(false)
    expect(dedicatedSession.permissionCheckHandler?.(
      null,
      'fullscreen',
      'https://www.bilibili.com',
      {},
    )).toBe(true)
    expect(dedicatedSession.permissionCheckHandler?.(
      loginContents,
      'fullscreen',
      'https://passport.bilibili.com',
      {},
    )).toBe(false)
    expect(dedicatedSession.permissionCheckHandler?.(
      playbackContents,
      'fullscreen',
      'https://www.bilibili.com',
      {},
    )).toBe(true)
    expect(dedicatedSession.permissionCheckHandler?.(
      null,
      'fullscreen',
      'https://player.bilibili.com',
      {},
    )).toBe(true)
    expect(dedicatedSession.permissionCheckHandler?.(
      null,
      'microphone',
      'https://player.bilibili.com',
      {},
    )).toBe(false)

    let loginFullscreenRequestAllowed: boolean | null = null
    dedicatedSession.permissionRequestHandler?.(
      loginContents,
      'fullscreen',
      (allowed: boolean) => { loginFullscreenRequestAllowed = allowed },
      { requestingUrl: 'https://passport.bilibili.com/login' },
    )
    expect(loginFullscreenRequestAllowed).toBe(false)

    const fullScreenCallCount = loginWindow.fullScreenCalls.length
    loginContents.emit('enter-html-full-screen')
    loginWindow.emit('enter-full-screen')
    expect(loginWindow.fullScreenCalls.slice(fullScreenCallCount)).toEqual([
      false,
      false,
    ])
    expect(loginContents.executedScripts.filter((script) =>
      script.includes('document.fullscreenElement'),
    )).toHaveLength(2)

    manager.dispose()
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('persists a completed Bilibili login and closes only its login window', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-bilibili-login-'))
  try {
    const { authStates, dedicatedSession, manager } = createFixture(sandbox)
    await expect(manager.openLogin()).resolves.toEqual({ signedIn: false })
    const loginWindow = FakeBrowserWindow.instances[0]
    expect(loginWindow.destroyed).toBe(false)

    dedicatedSession.cookies.values = [{
      name: 'SESSDATA',
      value: 'completed-login',
      domain: '.bilibili.com',
    }]
    dedicatedSession.cookies.emit('changed', {}, {
      name: 'SESSDATA',
      value: 'completed-login',
      domain: '.bilibili.com',
    })

    await expect.poll(() => loginWindow.destroyed).toBe(true)
    expect(authStates).toEqual([{ signedIn: true }])
    expect(dedicatedSession.cookies.flushCount).toBeGreaterThan(0)
    expect(dedicatedSession.flushStorageCount).toBeGreaterThan(0)
    manager.dispose()
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('reports only signed-in state, caches a trusted cover, and clears only its partition on logout', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-bilibili-cover-'))
  try {
    const { authStates, dedicatedSession, manager, selections } = createFixture(sandbox)
    dedicatedSession.cookies.values = [{
      name: 'SESSDATA',
      value: 'secret-cookie-value',
      domain: '.bilibili.com',
    }]
    await expect(manager.getAuthState()).resolves.toEqual({ signedIn: true })

    await manager.openVideo({ bvid: 'BV1xx411c7mD' })
    const contents = FakeBrowserWindow.instances[0].webContents
    contents.currentUrl = 'https://www.bilibili.com/video/BV1xx411c7mD'
    contents.publicMeta = {
      pageUrl: contents.currentUrl,
      canonicalUrl: contents.currentUrl,
      title: '测试视频',
      description: '公开视频描述',
      coverUrl: 'https://i0.hdslb.com/bfs/archive/test-cover.png',
      author: 'Aurora Tester',
    }
    contents.emit('did-finish-load')

    await expect.poll(() => selections.length).toBe(1)
    const descriptor = selections[0] as {
      thumbnailPath: string | null
      coverUrl: string | null
      cookie?: string
    }
    expect(descriptor.cookie).toBeUndefined()
    expect(descriptor.coverUrl).toBe(
      'https://i0.hdslb.com/bfs/archive/test-cover.png',
    )
    expect(descriptor.thumbnailPath).not.toBeNull()
    expect(path.dirname(descriptor.thumbnailPath!)).toBe(sandbox)
    await expect(readFile(descriptor.thumbnailPath!)).resolves.toEqual(
      Buffer.from('png-cover-12'),
    )

    const serializedAuth = JSON.stringify(await manager.getAuthState())
    expect(serializedAuth).toBe('{"signedIn":true}')
    expect(serializedAuth).not.toContain('secret-cookie-value')

    await expect(manager.logout()).resolves.toEqual({ signedIn: false })
    expect(dedicatedSession.closeConnectionsCount).toBe(1)
    expect(dedicatedSession.clearDataCount).toBe(1)
    expect(authStates.at(-1)).toEqual({ signedIn: false })
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
