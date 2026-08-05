import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const {
  XINPIANCHANG_AUTH_STATE_URL,
  XINPIANCHANG_LOGIN_URL,
  XINPIANCHANG_PARTITION,
  XINPIANCHANG_SEARCH_UNAVAILABLE_CODE,
  XinpianchangSearchUnavailableError,
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
} = require('../electron/xinpianchangSession.cjs') as {
  XINPIANCHANG_AUTH_STATE_URL: string
  XINPIANCHANG_LOGIN_URL: string
  XINPIANCHANG_PARTITION: string
  XINPIANCHANG_SEARCH_UNAVAILABLE_CODE: string
  XinpianchangSearchUnavailableError: new (reason?: string) => Error & {
    code: string
    reason: string
    retryable: boolean
  }
  createXinpianchangArticleUrl(articleId: string | number): string
  createXinpianchangManagedCoverInput(value: Record<string, unknown>): {
    provider: string
    kind: string
    mediaId: string
    remoteUrl: string
  } | null
  createXinpianchangPlaybackTarget(articleId: string | number): Record<string, unknown>
  createXinpianchangPlaybackUrl(articleId: string | number): string
  createXinpianchangSearchUrl(query: string, page?: number): string
  createXinpianchangSessionManager(options: Record<string, unknown>): {
    closeWindows(): void
    dispose(): void
    flushSession(): Promise<void>
    getAuthState(): Promise<{ signedIn: boolean }>
    logout(): Promise<{ signedIn: boolean }>
    openLogin(): Promise<{ signedIn: boolean }>
    searchVideos(request: { query: string; page?: number; limit?: number }): Promise<{
      query: string
      page: number
      pageSize: number
      totalCount: number
      hasMore: boolean
      nextPage: number | null
      results: Array<Record<string, unknown>>
    }>
  }
  installXinpianchangPlayerWebviewGuard(
    hostContents: EventEmitter,
    expectedSession?: object,
  ): () => void
  normalizeXinpianchangSearchPayload(
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
  parseXinpianchangAuthStatePayload(payload: Record<string, unknown>): {
    signedIn: boolean
  }
  parseXinpianchangArticleUrl(url: string): Record<string, unknown> | null
  parseXinpianchangPlaybackUrl(url: string): Record<string, unknown> | null
  parseXinpianchangPlayerNavigationUrl(url: string): Record<string, unknown> | null
}

class FakeXinpianchangCookies extends EventEmitter {
  flushCount = 0

  async flushStore() {
    this.flushCount += 1
  }
}

class FakeXinpianchangSession extends EventEmitter {
  cookies = new FakeXinpianchangCookies()
  fetchedUrls: string[] = []
  fetchOptions: Array<Record<string, unknown> | undefined> = []
  flushStorageCount = 0
  clearDataCount = 0
  permissionCheckHandler: null | ((...args: unknown[]) => boolean) = null
  permissionRequestHandler: null | ((...args: unknown[]) => void) = null
  fetchHandler: null | (
    (url: string, options?: Record<string, unknown>) => Promise<Response>
  ) = null

  getPartition() {
    return XINPIANCHANG_PARTITION
  }

  setPermissionCheckHandler(handler: (...args: unknown[]) => boolean) {
    this.permissionCheckHandler = handler
  }

  setPermissionRequestHandler(handler: (...args: unknown[]) => void) {
    this.permissionRequestHandler = handler
  }

  async flushStorageData() {
    this.flushStorageCount += 1
  }

  async closeAllConnections() { return undefined }

  async clearData() { this.clearDataCount += 1 }

  async fetch(url: string, options?: Record<string, unknown>) {
    this.fetchedUrls.push(url)
    this.fetchOptions.push(options)
    if (!this.fetchHandler) throw new Error(`Unexpected URL: ${url}`)
    return this.fetchHandler(url, options)
  }
}

class FakeXinpianchangWebContents extends EventEmitter {
  destroyed = false
  currentUrl = ''
  openHandler: null | ((details: { url: string }) => { action: string }) = null

  isDestroyed() { return this.destroyed }
  loadURL(url: string) { this.currentUrl = url; return Promise.resolve() }
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: string },
  ) { this.openHandler = handler }
}

class FakeXinpianchangWindow extends EventEmitter {
  static instances: FakeXinpianchangWindow[] = []
  options: Record<string, unknown>
  webContents = new FakeXinpianchangWebContents()
  destroyed = false
  loadUrl = ''

  constructor(options: Record<string, unknown>) {
    super()
    this.options = options
    FakeXinpianchangWindow.instances.push(this)
  }

  isDestroyed() { return this.destroyed }
  isMinimized() { return false }
  loadURL(url: string) {
    this.loadUrl = url
    this.webContents.currentUrl = url
    return Promise.resolve()
  }
  show() { return undefined }
  focus() { return undefined }
  close() { this.destroyed = true; this.emit('closed') }
  setFullScreen() { return undefined }
  setFullScreenable() { return undefined }
  setSimpleFullScreen() { return undefined }
  setKiosk() { return undefined }
}

class FakeXinpianchangGuest extends EventEmitter {
  currentUrl: string
  destroyed = false
  loadedUrls: string[] = []
  openHandler: null | (() => { action: string }) = null
  session: FakeXinpianchangSession

  constructor(url: string, session: FakeXinpianchangSession) {
    super()
    this.currentUrl = url
    this.session = session
  }

  destroy() { this.destroyed = true }
  getURL() { return this.currentUrl }
  isDestroyed() { return this.destroyed }
  async loadURL(url: string) {
    this.currentUrl = url
    this.loadedUrls.push(url)
  }
  setWindowOpenHandler(handler: () => { action: string }) {
    this.openHandler = handler
  }
}

function createFixture(cacheDirectory?: string) {
  const dedicatedSession = new FakeXinpianchangSession()
  const partitions: Array<{ partition: string; options: Record<string, unknown> }> = []
  const manager = createXinpianchangSessionManager({
    BrowserWindow: FakeXinpianchangWindow,
    cacheDirectory,
    sessionModule: {
      fromPartition(partition: string, options: Record<string, unknown>) {
        partitions.push({ partition, options })
        return dedicatedSession
      },
    },
  })
  return { dedicatedSession, manager, partitions }
}

test('canonical article and iframe targets only accept stable numeric article IDs', () => {
  expect(createXinpianchangArticleUrl('13772048')).toBe(
    'https://www.xinpianchang.com/a13772048',
  )
  expect(createXinpianchangPlaybackUrl('13772048')).toBe(
    'https://www.xinpianchang.com/iframe/a13772048',
  )
  expect(createXinpianchangPlaybackTarget('13772048')).toEqual({
    source: 'xinpianchang',
    kind: 'video',
    mediaId: '13772048',
    articleId: '13772048',
    url: 'https://www.xinpianchang.com/iframe/a13772048',
    canonicalUrl: 'https://www.xinpianchang.com/a13772048',
  })
  expect(parseXinpianchangArticleUrl(
    'https://www.xinpianchang.com/a13772048',
  )).toEqual(expect.objectContaining({ articleId: '13772048' }))
  expect(parseXinpianchangPlaybackUrl(
    'https://www.xinpianchang.com/iframe/a13772048',
  )).toEqual(expect.objectContaining({ articleId: '13772048' }))

  for (const unsafe of [
    'http://www.xinpianchang.com/a13772048',
    'https://xinpianchang.com/a13772048',
    'https://www.xinpianchang.com.evil.example/a13772048',
    'https://user@www.xinpianchang.com/a13772048',
    'https://www.xinpianchang.com:444/a13772048',
    'https://www.xinpianchang.com/a13772048?mid=secret',
    'https://www.xinpianchang.com/iframe/a0',
    'https://www.xinpianchang.com/iframe/a13772048#player',
  ]) {
    expect(parseXinpianchangArticleUrl(unsafe)).toBeNull()
    expect(parseXinpianchangPlaybackUrl(unsafe)).toBeNull()
  }
  expect(() => createXinpianchangPlaybackUrl('not-an-id')).toThrow()
})

test('official player redirect is validated without exposing or retaining mid', () => {
  const parsed = parseXinpianchangPlayerNavigationUrl(
    'https://player.xinpianchang.com/?aid=13772048&mid=Mnp8_token-01',
  )
  expect(parsed).toEqual(createXinpianchangPlaybackTarget('13772048'))
  expect(JSON.stringify(parsed)).not.toContain('Mnp8_token-01')
  expect(JSON.stringify(parsed)).not.toContain('mid')
  for (const unsafe of [
    'https://player.xinpianchang.com/?aid=13772048',
    'https://player.xinpianchang.com/?aid=13772048&mid=a&extra=1',
    'https://player.xinpianchang.com/?aid=13772048&aid=2&mid=a',
    'https://player.xinpianchang.com/player?aid=13772048&mid=a',
    'https://player.xinpianchang.com/?aid=13772048&mid=%2Fetc%2Fpasswd',
    'https://evil.example/?aid=13772048&mid=safe',
  ]) {
    expect(parseXinpianchangPlayerNavigationUrl(unsafe)).toBeNull()
  }
})

test('normalizer keeps works, excludes materials, and uses real page metadata', () => {
  const response = normalizeXinpianchangSearchPayload({
    pageProps: {
      searchData: {
        current_page: 2,
        last_page: 4,
        total: { article: 31, stock: 900 },
        next_page_url: 'https://app.xinpianchang.com/search?kw=%E5%86%B0%E5%B7%9D&page=3&type=article',
        list: [
          {
            resource_type: 1,
            id: 13772048,
            media_id: 'must-never-leave-the-provider',
            title: '<b>冰川</b> 光影',
            content: '来自新片场的公开视频作品',
            web_url: 'https://www.xinpianchang.com/a13772048',
            cover: 'https://oss-xpc0.xpccdn.com/uploadfile/article/cover.png?x-oss-process=image/resize,w_800',
            duration: 134,
            publish_time: 1_722_680_000,
            author: { userinfo: { username: '创作者 A' } },
            categories: [
              { category_name: '广告', sub: { category_name: '汽车' } },
            ],
          },
          {
            resource_type: 2,
            id: 13772049,
            title: '素材商品必须过滤',
            web_url: 'https://www.xinpianchang.com/a13772049',
          },
          {
            type: 'stock',
            id: 13772050,
            title: '库存素材必须过滤',
            web_url: 'https://www.xinpianchang.com/a13772050',
          },
          {
            resource_type: 1,
            id: 13772048,
            title: '重复作品',
          },
          {
            resource_type: 1,
            id: 13772051,
            title: '恶意 canonical URL',
            web_url: 'https://evil.example/a13772051',
          },
        ],
      },
    },
  }, { query: ' 冰川 ', page: 2, limit: 12 })

  expect(response).toMatchObject({
    query: '冰川',
    page: 2,
    pageSize: 12,
    totalCount: 31,
    hasMore: true,
    nextPage: 3,
  })
  expect(response.results).toHaveLength(1)
  expect(response.results[0]).toMatchObject({
    source: 'xinpianchang',
    kind: 'video',
    mediaId: '13772048',
    articleId: '13772048',
    title: '冰川 光影',
    author: '创作者 A',
    canonicalUrl: 'https://www.xinpianchang.com/a13772048',
    playbackUrl: 'https://www.xinpianchang.com/iframe/a13772048',
    durationSeconds: 134,
    publishedAt: '2024-08-03T10:13:20.000Z',
    tags: ['广告', '汽车'],
  })
  expect(JSON.stringify(response)).not.toContain('must-never-leave-the-provider')
  expect(JSON.stringify(response)).not.toContain('media_id')
})

test('normalizer accepts the public official app search response shape', () => {
  expect(normalizeXinpianchangSearchPayload({
    status: 0,
    code: '_200',
    data: {
      total: 3000,
      page_size: 10,
      next_page_url: '/search?kw=%E6%B1%BD%E8%BD%A6&page=2&type=article',
      list: [{
        id: 13751103,
        web_url: 'https://www.xinpianchang.com/a13751103',
        title: '天地舞步，自由真好 乐道L60',
        cover: 'https://oss-xpc0.xpccdn.com/Upload/edu/2026/07/cover.jpeg',
        duration: 289,
        publish_time: 1784117231,
        author: { userinfo: { username: '陈立言' } },
        categories: [{
          category_name: '广告片',
          sub: { category_name: '汽车' },
        }],
      }],
    },
  }, { query: '汽车', page: 1, limit: 12 })).toMatchObject({
    query: '汽车',
    page: 1,
    pageSize: 12,
    totalCount: 3000,
    hasMore: true,
    nextPage: 2,
    results: [{
      articleId: '13751103',
      title: '天地舞步，自由真好 乐道L60',
      author: '陈立言',
      tags: ['广告片', '汽车'],
    }],
  })
})

test('auth state requires the official user endpoint to return a real user', () => {
  expect(parseXinpianchangAuthStatePayload({
    status: -1,
    code: 'NO_LOGIN',
    data: null,
  })).toEqual({ signedIn: false })
  expect(parseXinpianchangAuthStatePayload({
    status: 0,
    data: { id: 10425231, username: '新片场用户' },
  })).toEqual({ signedIn: true })
  expect(parseXinpianchangAuthStatePayload({
    status: 0,
    data: {},
  })).toEqual({ signedIn: false })
})

test('pagination never invents a next page when official metadata is absent or mismatched', () => {
  const payload = {
    searchData: {
      list: [
        { resource_type: 1, id: 1001, title: '作品一' },
        { resource_type: 1, id: 1002, title: '作品二' },
      ],
    },
  }
  expect(normalizeXinpianchangSearchPayload(
    payload,
    { query: '作品', page: 1, limit: 2 },
  )).toMatchObject({ hasMore: false, nextPage: null, totalCount: 2 })
  expect(normalizeXinpianchangSearchPayload({
    searchData: { ...payload.searchData, current_page: 9, last_page: 20 },
  }, { query: '作品', page: 1, limit: 2 })).toMatchObject({
    hasMore: false,
    nextPage: null,
  })
})

test('managed cover input accepts only stable IDs and trusted image hosts', () => {
  expect(createXinpianchangManagedCoverInput({
    articleId: '13772048',
    coverUrl: 'https://oss-xpc0.xpccdn.com/uploadfile/article/cover.png',
  })).toEqual({
    provider: 'xinpianchang',
    kind: 'video',
    mediaId: '13772048',
    remoteUrl: 'https://oss-xpc0.xpccdn.com/uploadfile/article/cover.png',
  })
  expect(createXinpianchangManagedCoverInput({
    articleId: '13772048',
    coverUrl: 'https://xpccdn.com.evil.example/cover.png',
  })).toBeNull()
  expect(createXinpianchangManagedCoverInput({
    articleId: '13772048',
    coverUrl: 'http://oss-xpc0.xpccdn.com/cover.png',
  })).toBeNull()
})

test('manager uses an independent persistent session and caches managed covers', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-xinpianchang-'))
  try {
    const { dedicatedSession, manager, partitions } = createFixture(sandbox)
    dedicatedSession.fetchHandler = async (url) => {
      if (url.startsWith('https://app.xinpianchang.com/search?')) {
        const page = new URL(url).searchParams.get('page')
        expect(page).toBe('1')
        const searchData = {
          status: 0,
          data: {
            total: 1,
            page_size: 10,
            next_page_url: null,
            list: [{
              id: 13772048,
              title: '测试作品',
              web_url: 'https://www.xinpianchang.com/a13772048',
              cover: 'https://oss-xpc0.xpccdn.com/covers/test.webp',
            }],
          },
        }
        return new Response(JSON.stringify(searchData), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      }
      if (url === 'https://oss-xpc0.xpccdn.com/covers/test.webp') {
        return new Response(Buffer.from('managed-cover'), {
          status: 200,
          headers: { 'content-type': 'image/webp', 'content-length': '13' },
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    expect(partitions).toEqual([{
      partition: XINPIANCHANG_PARTITION,
      options: { cache: true },
    }])
    expect(await manager.getAuthState()).toEqual({ signedIn: false })
    const result = await manager.searchVideos({ query: ' 测试 ', page: 1, limit: 12 })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].thumbnailPath).toEqual(expect.any(String))
    expect(await readFile(result.results[0].thumbnailPath as string, 'utf8'))
      .toBe('managed-cover')
    expect(dedicatedSession.fetchOptions.some((options) => (
      options?.credentials === 'include' && options?.redirect === 'manual'
    ))).toBe(true)
    expect(dedicatedSession.fetchOptions.some((options) => (
      options?.credentials === 'omit' && options?.redirect === 'manual'
    ))).toBe(true)
    expect(dedicatedSession.permissionCheckHandler?.(
      null,
      'fullscreen',
      'https://player.xinpianchang.com/',
    )).toBe(true)
    expect(dedicatedSession.permissionCheckHandler?.(
      null,
      'media',
      'https://player.xinpianchang.com/',
    )).toBe(false)
    await manager.flushSession()
    expect(dedicatedSession.cookies.flushCount).toBe(1)
    expect(dedicatedSession.flushStorageCount).toBe(1)
    manager.dispose()
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('caches official CDN JPEG covers that are served as generic binary data', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'aurora-xinpianchang-binary-cover-'))
  try {
    const { dedicatedSession, manager } = createFixture(sandbox)
    const officialBinaryCover =
      'https://us-xpc5-a.xpccdn.com/fde57595-be07-4d53-8435-5514949b2cf1/cover.jpg'
    const invalidBinaryCover =
      'https://us-xpc5-a.xpccdn.com/fde57595-be07-4d53-8435-5514949b2cf1/not-an-image.jpg'
    const jpegBytes = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
      0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
    ])
    dedicatedSession.fetchHandler = async (url) => {
      if (url.startsWith('https://app.xinpianchang.com/search?')) {
        return new Response(JSON.stringify({
          status: 0,
          data: {
            total: 2,
            page_size: 10,
            next_page_url: null,
            list: [
              {
                id: 13766873,
                resource_type: 1,
                title: '官方二进制 JPEG 封面',
                web_url: 'https://www.xinpianchang.com/a13766873',
                cover: officialBinaryCover,
              },
              {
                id: 13766874,
                resource_type: 1,
                title: '无效二进制内容',
                web_url: 'https://www.xinpianchang.com/a13766874',
                cover: invalidBinaryCover,
              },
            ],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      }
      if (url === officialBinaryCover) {
        return new Response(jpegBytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        })
      }
      if (url === invalidBinaryCover) {
        return new Response(Buffer.from('not an image'), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await manager.searchVideos({ query: '汽车', page: 1, limit: 12 })
    expect(result.results).toHaveLength(2)
    expect(result.results[0].thumbnailPath).toEqual(expect.stringMatching(/\.jpg$/))
    expect(await readFile(result.results[0].thumbnailPath as string))
      .toEqual(jpegBytes)
    expect(result.results[1].thumbnailPath).toBeNull()
    manager.dispose()
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('opens an isolated windowed login and closes it after official auth succeeds', async () => {
  FakeXinpianchangWindow.instances = []
  const authEvents: Array<{ signedIn: boolean }> = []
  let signedIn = false
  const dedicatedSession = new FakeXinpianchangSession()
  dedicatedSession.fetchHandler = async (url) => {
    expect(url).toBe(XINPIANCHANG_AUTH_STATE_URL)
    return new Response(JSON.stringify(
      signedIn
        ? { status: 0, data: { id: 10425231, username: '测试用户' } }
        : { status: -1, code: 'NO_LOGIN', data: null },
    ), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const manager = createXinpianchangSessionManager({
    BrowserWindow: FakeXinpianchangWindow,
    sessionModule: { fromPartition: () => dedicatedSession },
    onAuthStateChange: (state: { signedIn: boolean }) => authEvents.push(state),
  })
  await expect(manager.getAuthState()).resolves.toEqual({ signedIn: false })
  await manager.openLogin()
  const login = FakeXinpianchangWindow.instances[0]
  expect(login.loadUrl).toBe(XINPIANCHANG_LOGIN_URL)
  expect(login.options).toMatchObject({
    frame: true,
    modal: false,
    maximizable: false,
    fullscreenable: false,
  })
  expect(login.options.webPreferences).toMatchObject({
    session: dedicatedSession,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
  })

  signedIn = true
  dedicatedSession.cookies.emit('changed', {}, {
    domain: '.xinpianchang.com',
    name: 'login-session',
    value: 'opaque',
  })
  await expect.poll(() => login.destroyed).toBe(true)
  expect(authEvents.at(-1)).toEqual({ signedIn: true })

  await expect(manager.logout()).resolves.toEqual({ signedIn: false })
  expect(dedicatedSession.clearDataCount).toBe(1)
  expect(authEvents.at(-1)).toEqual({ signedIn: false })
  manager.dispose()
})

test('official WAF challenge returns a typed unavailable error without fallback requests', async () => {
  const { dedicatedSession, manager } = createFixture()
  dedicatedSession.fetchHandler = async () => new Response(
    '<html><title>安全验证</title><div>captcha challenge</div></html>',
    { status: 403, headers: { 'content-type': 'text/html' } },
  )
  let caught: unknown
  try {
    await manager.searchVideos({ query: '广告' })
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(XinpianchangSearchUnavailableError)
  expect(caught).toMatchObject({
    code: XINPIANCHANG_SEARCH_UNAVAILABLE_CODE,
    reason: 'waf',
    retryable: true,
  })
  expect((caught as Error).message).toContain('浏览器验证')
  expect(dedicatedSession.fetchedUrls).toHaveLength(1)
  manager.dispose()
})

test('search validates its public route and request surface', async () => {
  expect(createXinpianchangSearchUrl('冰川', 3)).toBe(
    'https://app.xinpianchang.com/search?type=article&kw=%E5%86%B0%E5%B7%9D&page=3',
  )
  const { dedicatedSession, manager } = createFixture()
  dedicatedSession.fetchHandler = async () => new Response('', {
    status: 302,
    headers: { location: 'https://evil.example/collect?cookie=1' },
  })
  await expect(manager.searchVideos({ query: '冰川' }))
    .rejects.toMatchObject({
      code: XINPIANCHANG_SEARCH_UNAVAILABLE_CODE,
      reason: 'unsafe-redirect',
    })
  await expect(manager.searchVideos({
    query: '冰川',
    // @ts-expect-error Deliberately exercise the runtime allowlist.
    cookie: 'must-not-be-forwarded',
  })).rejects.toThrow(/unsupported fields/)
  expect(dedicatedSession.fetchedUrls).toHaveLength(1)
  manager.dispose()
})

test('webview guard owns only its partition and locks the stable article identity', async () => {
  const host = new EventEmitter()
  const dedicatedSession = new FakeXinpianchangSession()
  const dispose = installXinpianchangPlayerWebviewGuard(host, dedicatedSession)

  let otherPrevented = false
  host.emit(
    'will-attach-webview',
    { preventDefault: () => { otherPrevented = true } },
    { partition: 'persist:aurora-bilibili-v1' },
    { partition: 'persist:aurora-bilibili-v1', src: 'https://www.bilibili.com/' },
  )
  expect(otherPrevented).toBe(false)

  let prevented = false
  const preferences: Record<string, unknown> = {
    partition: XINPIANCHANG_PARTITION,
    session: dedicatedSession,
    preload: '/tmp/unsafe.cjs',
    nodeIntegration: true,
    sandbox: false,
  }
  host.emit(
    'will-attach-webview',
    { preventDefault: () => { prevented = true } },
    preferences,
    {
      partition: XINPIANCHANG_PARTITION,
      src: 'https://www.xinpianchang.com/iframe/a13772048',
    },
  )
  expect(prevented).toBe(false)
  expect(preferences).toMatchObject({
    partition: XINPIANCHANG_PARTITION,
    session: dedicatedSession,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  })
  expect(preferences).not.toHaveProperty('preload')

  const guest = new FakeXinpianchangGuest(
    'https://www.xinpianchang.com/iframe/a13772048',
    dedicatedSession,
  )
  host.emit('did-attach-webview', {}, guest)
  let allowedRedirectPrevented = false
  guest.emit(
    'will-redirect',
    { preventDefault: () => { allowedRedirectPrevented = true } },
    'https://player.xinpianchang.com/?aid=13772048&mid=Mnp8_stable-memory-only',
  )
  expect(allowedRedirectPrevented).toBe(false)
  let wrongArticlePrevented = false
  guest.emit(
    'will-redirect',
    { preventDefault: () => { wrongArticlePrevented = true } },
    'https://player.xinpianchang.com/?aid=13772049&mid=Mnp8_other',
  )
  expect(wrongArticlePrevented).toBe(true)
  expect(guest.openHandler?.()).toEqual({ action: 'deny' })

  guest.emit('did-navigate', {}, 'https://evil.example/player')
  await Promise.resolve()
  expect(guest.loadedUrls).toEqual([
    'https://www.xinpianchang.com/iframe/a13772048',
  ])
  dispose()
})

test('webview guard rejects malformed iframe targets for its partition', () => {
  const host = new EventEmitter()
  const dedicatedSession = new FakeXinpianchangSession()
  const dispose = installXinpianchangPlayerWebviewGuard(host, dedicatedSession)
  let prevented = false
  host.emit(
    'will-attach-webview',
    { preventDefault: () => { prevented = true } },
    { partition: XINPIANCHANG_PARTITION, session: dedicatedSession },
    {
      partition: XINPIANCHANG_PARTITION,
      src: 'https://www.xinpianchang.com/iframe/a13772048?mid=leak',
    },
  )
  expect(prevented).toBe(true)
  dispose()
})
