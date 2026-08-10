import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const {
  DOUYIN_AUTH_COOKIE_NAMES,
  DOUYIN_LOGIN_URL,
  DOUYIN_PARTITION,
  DOUYIN_PLAYER_AUTOPLAY_SCRIPT,
  DOUYIN_PLAYER_CONTAIN_CSS,
  DouyinSearchError,
  createDouyinInteractionUrl,
  createDouyinOfficialPlayerUrl,
  createDouyinPageSearchScript,
  createDouyinSearchUrl,
  createDouyinSessionManager,
  createDouyinVideoUrl,
  hardenDouyinPlayerWebPreferences,
  installDouyinPlayerWebviewGuard,
  isAllowedDouyinAuthNavigationUrl,
  normalizeDouyinCoverUrl,
  normalizeDouyinSearchPayload,
  parseDouyinInteractionPopupUrl,
  parseDouyinOfficialPlayerUrl,
  parseDouyinVideoUrl,
} = require('../electron/douyinSession.cjs') as {
  DOUYIN_AUTH_COOKIE_NAMES: string[]
  DOUYIN_LOGIN_URL: string
  DOUYIN_PARTITION: string
  DOUYIN_PLAYER_AUTOPLAY_SCRIPT: string
  DOUYIN_PLAYER_CONTAIN_CSS: string
  DouyinSearchError: new (...args: unknown[]) => Error & {
    code: string
    retryable: boolean
  }
  createDouyinInteractionUrl(videoId: string): string
  createDouyinOfficialPlayerUrl(videoId: string): string
  createDouyinPageSearchScript(request: {
    page: number
    limit: number
    offset?: number
  }): string
  createDouyinSearchUrl(query: string): string
  createDouyinSessionManager(options: Record<string, unknown>): {
    closeWindows(): void
    dispose(): void
    flushSession(): Promise<void>
    getAuthState(): Promise<{ signedIn: boolean }>
    logout(): Promise<{ signedIn: boolean }>
    openInteraction(request: {
      kind: 'video'
      mediaId: string
    }): Promise<{ opened: boolean; reason: string | null }>
    openLogin(): Promise<{ signedIn: boolean }>
    searchVideos(request: {
      query: string
      page?: number
      limit?: number
      searchType?: string
    }): Promise<{
      query: string
      page: number
      pageSize: number
      totalCount: number
      hasMore: boolean
      nextPage: number | null
      results: Array<Record<string, unknown>>
    }>
  }
  createDouyinVideoUrl(videoId: string): string
  hardenDouyinPlayerWebPreferences(
    preferences: Record<string, unknown>,
    expectedSession?: object,
  ): void
  installDouyinPlayerWebviewGuard(
    hostContents: EventEmitter,
    expectedSession?: object,
    options?: {
      onOpenInteraction?: (target: Record<string, unknown>) => unknown
    },
  ): () => void
  isAllowedDouyinAuthNavigationUrl(url: string): boolean
  normalizeDouyinCoverUrl(url: string): string | null
  normalizeDouyinSearchPayload(
    payload: Record<string, unknown>,
    request: {
      query: string
      page: number
      limit: number
      offset?: number
      allowPartial?: boolean
    },
  ): {
    query: string
    page: number
    pageSize: number
    totalCount: number
    hasMore: boolean
    nextPage: number | null
    results: Array<Record<string, unknown>>
  }
  parseDouyinInteractionPopupUrl(
    url: string,
    expectedVideoId: string,
  ): Record<string, unknown> | null
  parseDouyinOfficialPlayerUrl(url: string): Record<string, unknown> | null
  parseDouyinVideoUrl(url: string): Record<string, unknown> | null
}

const VIDEO_IDS = [
  '7612634681493802267',
  '7612634681493802268',
  '7612634681493802269',
  '7612634681493802270',
  '7612634681493802271',
]
const CONTINUOUS_VIDEO_IDS = Array.from({ length: 8 }, (_value, index) => (
  7612634681493802267n + BigInt(index)
).toString())
const DEEP_VIDEO_IDS = Array.from({ length: 60 }, (_value, index) => (
  8612634681493802200n + BigInt(index)
).toString())

class FakeCookies extends EventEmitter {
  values: Array<Record<string, string>> = []
  flushCount = 0

  async get() {
    return this.values
  }

  async flushStore() {
    this.flushCount += 1
  }
}

class FakeDouyinSession extends EventEmitter {
  cookies = new FakeCookies()
  flushStorageCount = 0
  clearDataCount = 0
  fetchCalls: Array<{ url: string; options?: Record<string, unknown> }> = []
  fetchHandler: null | (
    (url: string, options?: Record<string, unknown>) => Promise<Response>
  ) = null

  async flushStorageData() {
    this.flushStorageCount += 1
  }

  async clearData() {
    this.clearDataCount += 1
    this.cookies.values = []
  }

  async closeAllConnections() {}

  async fetch(url: string, options?: Record<string, unknown>) {
    this.fetchCalls.push({ url, options })
    if (!this.fetchHandler) throw new Error('Unexpected fetch')
    return this.fetchHandler(url, options)
  }
}

class FakeWebContents extends EventEmitter {
  executedScripts: string[] = []
  executePayload: Record<string, unknown> = {
    loginRequired: false,
    verificationRequired: false,
    hasMore: false,
    items: [],
  }
  loadedUrls: string[] = []
  destroyed = false
  windowOpenHandler: null | ((details: { url: string }) => { action: string }) = null

  async executeJavaScript(script: string) {
    this.executedScripts.push(script)
    return this.executePayload
  }

  async loadURL(url: string) {
    this.loadedUrls.push(url)
  }

  isDestroyed() {
    return this.destroyed
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
    this.windowOpenHandler = handler
  }
}

class FakeBrowserWindow extends EventEmitter {
  static instances: FakeBrowserWindow[] = []
  static nextExecutePayload: Record<string, unknown> | null = null
  webContents = new FakeWebContents()
  loadedUrls: string[] = []
  options: Record<string, unknown>
  destroyed = false
  closed = false
  shown = false

  constructor(options: Record<string, unknown>) {
    super()
    this.options = options
    if (FakeBrowserWindow.nextExecutePayload) {
      this.webContents.executePayload = FakeBrowserWindow.nextExecutePayload
      FakeBrowserWindow.nextExecutePayload = null
    }
    FakeBrowserWindow.instances.push(this)
  }

  async loadURL(url: string) {
    this.loadedUrls.push(url)
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

  focus() {}
  setFullScreenable() {}
  setKiosk() {}
  setSimpleFullScreen() {}
  setFullScreen() {}
  setMenuBarVisibility() {}

  close() {
    this.closed = true
    this.destroyed = true
    this.emit('closed')
  }

  destroy() {
    this.close()
  }
}

function createManager(
  session: FakeDouyinSession,
  options: Record<string, unknown> = {},
) {
  FakeBrowserWindow.instances = []
  FakeBrowserWindow.nextExecutePayload = null
  return createDouyinSessionManager({
    BrowserWindow: FakeBrowserWindow,
    sessionModule: {
      fromPartition(partition: string, sessionOptions: Record<string, unknown>) {
        expect(partition).toBe(DOUYIN_PARTITION)
        expect(sessionOptions).toEqual({ cache: true })
        return session
      },
    },
    ...options,
  })
}

function searchPayload() {
  return {
    loginRequired: false,
    verificationRequired: false,
    hasMore: false,
    items: VIDEO_IDS.map((mediaId, index) => ({
      href: `https://www.douyin.com/video/${mediaId}?previous_page=search_result`,
      title: `第 ${index + 1} 条 #冰川 视频`,
      description: `描述 ${index + 1}`,
      author: `作者 ${index + 1}`,
      coverUrl: `https://p3-sign.douyinpic.com/tos-cn-i/demo-${index}.webp`,
      duration: `00:0${index + 1}`,
      publishedAt: '1天前',
    })),
  }
}

test('抖音来源使用独立持久会话并生成官方地址', () => {
  expect(DOUYIN_PARTITION).toBe('persist:aurora-online-douyin-v1')
  expect(DOUYIN_LOGIN_URL).toBe('https://www.douyin.com/')
  expect(DOUYIN_AUTH_COOKIE_NAMES).toContain('sessionid_ss')
  expect(createDouyinVideoUrl(VIDEO_IDS[0])).toBe(
    `https://www.douyin.com/video/${VIDEO_IDS[0]}`,
  )
  expect(createDouyinOfficialPlayerUrl(VIDEO_IDS[0])).toBe(
    `https://open.douyin.com/player/video?vid=${VIDEO_IDS[0]}&autoplay=1`,
  )
  expect(createDouyinInteractionUrl(VIDEO_IDS[0])).toBe(
    `https://www.douyin.com/jingxuan?modal_id=${VIDEO_IDS[0]}`,
  )
  expect(() => createDouyinVideoUrl('bad')).toThrow()
})

test('视频地址会删除跟踪参数并只接受抖音公开详情页', () => {
  expect(parseDouyinVideoUrl(
    `https://www.douyin.com/video/${VIDEO_IDS[0]}?previous_page=search_result`,
  )).toMatchObject({
    source: 'douyin',
    kind: 'video',
    mediaId: VIDEO_IDS[0],
    canonicalUrl: `https://www.douyin.com/video/${VIDEO_IDS[0]}`,
  })
  expect(parseDouyinVideoUrl(`https://evil.test/video/${VIDEO_IDS[0]}`)).toBeNull()
  expect(parseDouyinVideoUrl('https://www.douyin.com/live/123')).toBeNull()
})

test('官方播放器地址只接受精确的公开播放器参数', () => {
  const officialUrl = createDouyinOfficialPlayerUrl(VIDEO_IDS[0])
  expect(parseDouyinOfficialPlayerUrl(officialUrl)).toMatchObject({
    source: 'douyin',
    kind: 'video',
    mediaId: VIDEO_IDS[0],
    canonicalUrl: createDouyinVideoUrl(VIDEO_IDS[0]),
  })
  expect(parseDouyinOfficialPlayerUrl(
    `${officialUrl}&download=1`,
  )).toBeNull()
  expect(parseDouyinOfficialPlayerUrl(
    `https://www.douyin.com/player/video?vid=${VIDEO_IDS[0]}&autoplay=0`,
  )).toBeNull()
})

test('播放器互动弹窗只接受同一视频的官方详情入口', () => {
  const desktopUrl = `https://www.douyin.com/?previous_page=web_code_link&vid=${VIDEO_IDS[0]}`
  const currentDesktopUrl = `https://www.douyin.com/jingxuan?modal_id=${VIDEO_IDS[0]}&previous_page=web_code_link`
  const mobileUrl = `https://m.douyin.com/share/video/${VIDEO_IDS[0]}`
  for (const url of [desktopUrl, currentDesktopUrl, mobileUrl]) {
    expect(parseDouyinInteractionPopupUrl(url, VIDEO_IDS[0])).toMatchObject({
      source: 'douyin',
      kind: 'video',
      mediaId: VIDEO_IDS[0],
      url: createDouyinInteractionUrl(VIDEO_IDS[0]),
      canonicalUrl: createDouyinVideoUrl(VIDEO_IDS[0]),
    })
  }
  expect(parseDouyinInteractionPopupUrl(
    `${desktopUrl}&download=1`,
    VIDEO_IDS[0],
  )).toBeNull()
  expect(parseDouyinInteractionPopupUrl(
    `${currentDesktopUrl}&download=1`,
    VIDEO_IDS[0],
  )).toBeNull()
  expect(parseDouyinInteractionPopupUrl(
    `https://www.douyin.com/?previous_page=web_code_link&vid=${VIDEO_IDS[1]}`,
    VIDEO_IDS[0],
  )).toBeNull()
  expect(parseDouyinInteractionPopupUrl(
    `https://evil.test/?previous_page=web_code_link&vid=${VIDEO_IDS[0]}`,
    VIDEO_IDS[0],
  )).toBeNull()
})

test('搜索链接固定到官方视频分类', () => {
  expect(createDouyinSearchUrl(' 冰川 时代 ')).toBe(
    'https://www.douyin.com/search/%E5%86%B0%E5%B7%9D%20%E6%97%B6%E4%BB%A3?type=video',
  )
  expect(() => createDouyinSearchUrl('')).toThrow()
})

test('登录导航和封面只允许经审核的 HTTPS 域名', () => {
  expect(isAllowedDouyinAuthNavigationUrl('https://www.douyin.com/')).toBe(true)
  expect(isAllowedDouyinAuthNavigationUrl('https://sso.douyin.com/login')).toBe(true)
  expect(isAllowedDouyinAuthNavigationUrl('https://evil.test/')).toBe(false)
  expect(isAllowedDouyinAuthNavigationUrl('http://www.douyin.com/')).toBe(false)

  expect(normalizeDouyinCoverUrl(
    'https://p3-sign.douyinpic.com/tos-cn-i/demo.webp?x=1',
  )).toContain('douyinpic.com')
  expect(normalizeDouyinCoverUrl('https://p3.byteimg.com/demo.jpg')).toContain(
    'byteimg.com',
  )
  expect(normalizeDouyinCoverUrl('https://evil.test/demo.jpg')).toBeNull()
})

test('网页搜索结果会规范化、去重并正确切第二页', () => {
  const payload = searchPayload()
  payload.items.push(payload.items[0])
  const normalized = normalizeDouyinSearchPayload(payload, {
    query: '冰川',
    page: 2,
    limit: 2,
  })
  expect(normalized).toMatchObject({
    query: '冰川',
    page: 2,
    pageSize: 2,
    totalCount: 5,
    hasMore: true,
    nextPage: 3,
  })
  expect(normalized.results.map((item) => item.mediaId)).toEqual(VIDEO_IDS.slice(2, 4))
  expect(normalized.results[0]).toMatchObject({
    title: '第 3 条 #冰川 视频',
    author: '作者 3',
    tags: ['冰川'],
    canonicalUrl: `https://www.douyin.com/video/${VIDEO_IDS[2]}`,
  })
})

test('登录和验证提示使用可区分的错误码', () => {
  for (const [key, code] of [
    ['loginRequired', 'DOUYIN_LOGIN_REQUIRED'],
    ['verificationRequired', 'DOUYIN_VERIFICATION_REQUIRED'],
  ] as const) {
    let caught: unknown
    try {
      normalizeDouyinSearchPayload({ [key]: true }, {
        query: '冰川', page: 1, limit: 12,
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DouyinSearchError)
    expect((caught as { code: string }).code).toBe(code)
  }
})

test('解析器结构失配和未完成滚动使用可重试错误', () => {
  for (const [payload, code] of [
    [{ parserMismatch: true, items: [] }, 'DOUYIN_SEARCH_PARSE_FAILED'],
    [{ incomplete: true, items: [] }, 'DOUYIN_SEARCH_INCOMPLETE'],
  ] as const) {
    expect(() => normalizeDouyinSearchPayload(payload, {
      query: 'vibecoding', page: 1, limit: 12,
    })).toThrow(expect.objectContaining({ code }))
  }
})

test('当前页已满但下一条仍在加载时保留后续分页', () => {
  const payload = searchPayload()
  payload.items = payload.items.slice(0, 4)
  const normalized = normalizeDouyinSearchPayload({
    ...payload,
    incomplete: true,
    exhausted: false,
    hasMore: true,
  }, {
    query: '冰川',
    page: 2,
    limit: 2,
  })
  expect(normalized.results.map((item) => item.mediaId)).toEqual(VIDEO_IDS.slice(2, 4))
  expect(normalized.hasMore).toBe(true)
  expect(normalized.nextPage).toBe(3)

  expect(() => normalizeDouyinSearchPayload({
    ...payload,
    items: payload.items.slice(0, 3),
    incomplete: true,
  }, {
    query: '冰川',
    page: 2,
    limit: 2,
  })).toThrow(expect.objectContaining({ code: 'DOUYIN_SEARCH_INCOMPLETE' }))
})

test('深页可提交不足一页的新批次并从实际偏移继续', () => {
  const items = DEEP_VIDEO_IDS.slice(0, 46).map((id, index) => ({
    href: `https://www.douyin.com/video/${id}`,
    title: `深页视频 ${index + 1}`,
  }))
  const partial = normalizeDouyinSearchPayload({
    loginRequired: false,
    verificationRequired: false,
    incomplete: true,
    exhausted: false,
    hasMore: true,
    items,
  }, {
    query: 'vibecoding',
    page: 4,
    limit: 12,
    offset: 36,
    allowPartial: true,
  })
  expect(partial.results).toHaveLength(10)
  expect(partial.results[0].mediaId).toBe(DEEP_VIDEO_IDS[36])
  expect(partial.results[9].mediaId).toBe(DEEP_VIDEO_IDS[45])
  expect(partial.hasMore).toBe(true)
  expect(partial.nextPage).toBe(5)

  const terminalTail = normalizeDouyinSearchPayload({
    loginRequired: false,
    verificationRequired: false,
    incomplete: false,
    exhausted: true,
    hasMore: false,
    items,
  }, {
    query: 'vibecoding',
    page: 4,
    limit: 12,
    offset: 36,
    allowPartial: true,
  })
  expect(terminalTail.results).toHaveLength(10)
  expect(terminalTail.hasMore).toBe(false)
  expect(terminalTail.nextPage).toBeNull()

  const resumedScript = createDouyinPageSearchScript({
    page: 5,
    limit: 12,
    offset: 46,
  })
  expect(resumedScript).toContain('targetCount = 58')
})

test('连续流穷尽后即使只剩重复项也会正确结束', () => {
  const payload = searchPayload()
  payload.items = [
    payload.items[0],
    payload.items[1],
    payload.items[0],
  ]
  const normalized = normalizeDouyinSearchPayload({
    ...payload,
    exhausted: true,
    hasMore: false,
  }, {
    query: '冰川',
    page: 2,
    limit: 2,
  })
  expect(normalized.results).toEqual([])
  expect(normalized.hasMore).toBe(false)
  expect(normalized.nextPage).toBeNull()
  expect(normalized.totalCount).toBe(2)
})

test('页面脚本只读取公开卡片，不请求或解析媒体流', () => {
  const script = createDouyinPageSearchScript({ page: 3, limit: 12 })
  expect(script).toContain('a[href*="/video/"]')
  expect(script).toContain('targetCount = 36')
  expect(script).toContain('requestOffset = 24')
  expect(script).toContain('__auroraDouyinSearchResults')
  expect(script).toContain('MutationObserver')
  expect(script).toContain('scrollIntoView')
  expect(script).toContain('stimulateContinuousLoad')
  expect(script).toContain('modal_id')
  expect(script).toContain('script#RENDER_DATA')
  expect(script).not.toContain('.m3u8')
  expect(script).not.toContain('playAddr')
  expect(script).not.toContain('downloadAddr')
  expect(script).not.toContain('rounds <')
})

test('精确一页结果不再为了探测额外一条而等待', async ({ page }) => {
  await page.setContent(`
    <main>
      <iframe id="nocaptcha-container" style="display:none" src="about:blank"></iframe>
      ${VIDEO_IDS.slice(0, 2).map((id, index) => `
        <a href="https://www.douyin.com/video/${id}">
          <img src="https://p3-sign.douyinpic.com/exact-${index}.webp">
          <span>精确分页视频 ${index + 1}</span>
        </a>
      `).join('')}
    </main>
  `)
  const startedAt = Date.now()
  const payload = await page.evaluate(createDouyinPageSearchScript({
    page: 1,
    limit: 2,
  })) as {
    incomplete: boolean
    items: unknown[]
    rounds: number
  }
  expect(Date.now() - startedAt).toBeLessThan(1_000)
  expect(payload.items).toHaveLength(2)
  expect(payload.incomplete).toBe(false)
  expect(payload.rounds).toBe(0)
})

test('连续加载期间动态出现浏览器验证会立即中止搜索', async ({ page }) => {
  await page.setContent(`
    <main style="height:100px;overflow-y:auto">
      ${VIDEO_IDS.slice(0, 2).map((id) => `
        <a href="https://www.douyin.com/video/${id}">初始视频</a>
      `).join('')}
      <div id="dynamic-verification-sentinel" data-e2e="search-load-more">加载更多</div>
    </main>
  `)
  await page.evaluate(() => {
    const sentinel = document.querySelector('#dynamic-verification-sentinel') as HTMLElement | null
    let scheduled = false
    if (!sentinel) return
    sentinel.scrollIntoView = () => {
      if (scheduled) return
      scheduled = true
      window.setTimeout(() => {
        const challenge = document.createElement('div')
        challenge.dataset.e2e = 'verify-captcha'
        challenge.textContent = '请完成安全验证'
        document.body.append(challenge)
      }, 100)
    }
  })
  const startedAt = Date.now()
  const payload = await page.evaluate(createDouyinPageSearchScript({
    page: 2,
    limit: 2,
  })) as {
    loginRequired: boolean
    verificationRequired: boolean
    hasMore: boolean
  }
  expect(Date.now() - startedAt).toBeLessThan(2_000)
  expect(payload.loginRequired).toBe(false)
  expect(payload.verificationRequired).toBe(true)
  expect(payload.hasMore).toBe(false)
})

test('抖音只作为视频搜索源，不开放个人作品内容类型', async () => {
  const session = new FakeDouyinSession()
  session.cookies.values = [{ name: 'sessionid', value: 'ok', domain: '.douyin.com' }]
  const manager = createManager(session)
  expect(() => manager.searchVideos({
    query: 'vibecoding',
    searchType: 'works',
  })).toThrow('Douyin currently supports video search only')
  expect(FakeBrowserWindow.instances).toHaveLength(0)
  manager.dispose()
})

test('连续流会跨越重复批次并多次触发底部哨兵', async ({ page }) => {
  const ids = CONTINUOUS_VIDEO_IDS
  await page.setContent(`
    <style>
      main { height: 120px; overflow-y: auto; }
      li { display: block; min-height: 64px; }
    </style>
    <main id="continuous-stream">
      <ul id="continuous-results">
        ${ids.slice(0, 4).map((id, index) => `
          <li><a href="https://www.douyin.com/video/${id}">
            <img src="https://p3-sign.douyinpic.com/initial-${index}.webp">
            <span>vibecoding 初始视频 ${index + 1}</span>
          </a></li>
        `).join('')}
        <li id="load-sentinel" data-e2e="search-load-more">加载更多</li>
      </ul>
    </main>
  `)
  await page.evaluate(({ fixtureIds }) => {
    const results = document.querySelector('#continuous-results')
    const sentinel = document.querySelector('#load-sentinel') as HTMLElement | null
    let triggers = 0
    if (!results || !sentinel) return
    sentinel.scrollIntoView = () => {
      triggers += 1
      ;(window as typeof window & { __douyinSentinelTriggers?: number })
        .__douyinSentinelTriggers = triggers
      if (triggers === 1) {
        window.setTimeout(() => {
          sentinel.insertAdjacentHTML('beforebegin', `
            <li style="min-height:160px">
              <a href="https://www.douyin.com/video/${fixtureIds[0]}">重复 1</a>
              <a href="https://www.douyin.com/video/${fixtureIds[1]}">重复 2</a>
            </li>
          `)
        }, 100)
      } else if (triggers === 2) {
        window.setTimeout(() => {
          sentinel.insertAdjacentHTML('beforebegin', `
            <li><a href="https://www.douyin.com/video/${fixtureIds[4]}">vibecoding 第二批 1</a></li>
            <li><a href="https://www.douyin.com/video/${fixtureIds[5]}">vibecoding 第二批 2</a></li>
          `)
        }, 1_100)
      } else if (triggers === 3) {
        window.setTimeout(() => {
          sentinel.insertAdjacentHTML('beforebegin', `
            <li><a href="https://www.douyin.com/video/${fixtureIds[6]}">vibecoding 第三批 1</a></li>
            <li><a href="https://www.douyin.com/video/${fixtureIds[7]}">vibecoding 第三批 2</a></li>
          `)
        }, 100)
      }
    }
  }, { fixtureIds: ids })

  const payload = await page.evaluate(createDouyinPageSearchScript({
    page: 4,
    limit: 2,
  })) as {
    exhausted: boolean
    hasMore: boolean
    incomplete: boolean
    items: Array<Record<string, string>>
  }
  const sentinelTriggers = await page.evaluate(() => (
    window as typeof window & { __douyinSentinelTriggers?: number }
  ).__douyinSentinelTriggers)
  expect(sentinelTriggers).toBeGreaterThanOrEqual(3)
  expect(payload.items.map((item) => item.href)).toEqual(ids.map(
    (id) => `https://www.douyin.com/video/${id}`,
  ))
  expect(payload.hasMore).toBe(true)
  expect(payload.exhausted).toBe(false)
  expect(payload.incomplete).toBe(false)
})

test('vibecoding 风格卡片会持续滚动、去重并保留公开字段', async ({ page }) => {
  const ids = VIDEO_IDS
  await page.setContent(`
    <style>
      main { height: 120px; overflow-y: auto; }
      li { min-height: 90px; }
      span { display: block; }
    </style>
    <main id="stream">
      <ul id="results">
        <li>
          <a href="https://www.douyin.com/video/${ids[0]}">
            <img src="https://p3-sign.douyinpic.com/one.webp">
            <span>03:15</span><span>10.0万</span>
            <span>vibecoding大赏｜可视化音乐播放器 #vibecoding</span>
            <span>@Mineradio</span><span>1周前</span>
          </a>
        </li>
        <li>
          <a href="https://www.douyin.com/video/${ids[1]}">
            <div style="background-image:url('https://p3-sign.douyinpic.com/two.webp')"></div>
            <span>00:41</span><span>882</span>
            <span>Vibe Coding 任务看板</span>
            <span>@大师的AI小灶</span><span>3天前</span>
          </a>
        </li>
      </ul>
    </main>
  `)
  await page.evaluate(({ fixtureIds }) => {
    const stream = document.querySelector('#stream')
    const results = document.querySelector('#results')
    let appended = false
    stream?.addEventListener('scroll', () => {
      if (appended || !results) return
      appended = true
      results.insertAdjacentHTML('beforeend', `
        <li><a href="https://www.douyin.com/video/${fixtureIds[0]}">重复卡片</a></li>
        <li><a href="/search/vibecoding?modal_id=${fixtureIds[2]}">
          <img src="https://p3-sign.douyinpic.com/three.webp">
          <span>01:20</span><span>滚动追加的公开视频</span><span>@作者三</span><span>2天前</span>
        </a></li>
        <li><a href="#" data-video-id="${fixtureIds[3]}">
          <img src="https://p3-sign.douyinpic.com/four.webp">
          <span>00:55</span><span>数据属性视频</span><span>@作者四</span><span>1天前</span>
        </a></li>
      `)
      const hydration = document.createElement('script')
      hydration.type = 'application/json'
      hydration.textContent = JSON.stringify({
        aweme_list: [{
          aweme_id: fixtureIds[4],
          desc: '嵌入 JSON 公开视频',
          author: { nickname: '作者五' },
          video: {
            duration: 91_000,
            cover: { url_list: ['https://p3-sign.douyinpic.com/five.webp'] },
          },
        }],
      })
      document.body.append(hydration)
    })
  }, { fixtureIds: ids })

  const payload = await page.evaluate(createDouyinPageSearchScript({
    page: 2,
    limit: 2,
  })) as {
    exhausted: boolean
    hasMore: boolean
    items: Array<Record<string, string>>
  }
  expect(payload.hasMore).toBe(true)
  expect(payload.items).toHaveLength(5)
  expect(payload.items.map((item) => item.href)).toEqual(ids.map(
    (id) => `https://www.douyin.com/video/${id}`,
  ))
  expect(payload.items[0]).toMatchObject({
    title: 'vibecoding大赏｜可视化音乐播放器 #vibecoding',
    author: 'Mineradio',
    duration: '03:15',
    publishedAt: '1周前',
  })
  expect(payload.items[1].coverUrl).toContain('two.webp')
  expect(payload.items[4]).toMatchObject({
    title: '嵌入 JSON 公开视频',
    author: '作者五',
    duration: '01:31',
  })
})

test('连续流短尾页在无官方加载提示时快速收口', async ({ page }) => {
  await page.setContent(`
    <main style="height:100px;overflow-y:auto">
      <div style="height:500px">
        ${VIDEO_IDS.slice(0, 3).map((id, index) => `
          <a href="https://www.douyin.com/video/${id}">
            <img src="https://p3-sign.douyinpic.com/${index}.webp">
            <span>视频 ${index + 1}</span>
          </a>
        `).join('')}
        <a href="https://www.douyin.com/video/${VIDEO_IDS[0]}">重复</a>
        <div class="load-end" style="display:none">没有更多了</div>
      </div>
    </main>
  `)
  const shortDeadlineScript = createDouyinPageSearchScript({
    page: 2,
    limit: 2,
  })
    .replace('Date.now() + 36000', 'Date.now() + 1500')
    .replace('Math.min(6000, 2200 + idleRounds * 650, remainingMs)',
      'Math.min(600, 250 + idleRounds * 100, remainingMs)')
  const payload = await page.evaluate(shortDeadlineScript) as {
    exhausted: boolean
    hasMore: boolean
    incomplete: boolean
    items: unknown[]
  }
  expect(payload.items).toHaveLength(3)
  expect(payload.exhausted).toBe(true)
  expect(payload.incomplete).toBe(false)
  expect(payload.hasMore).toBe(false)
})

test('连续流只在官方明确结束标记后收口分页', async ({ page }) => {
  await page.setContent(`
    <main style="height:100px;overflow-y:auto">
      ${VIDEO_IDS.slice(0, 3).map((id) => `
        <a href="https://www.douyin.com/video/${id}">视频</a>
      `).join('')}
      <div data-e2e="search-load-end">没有更多了</div>
    </main>
  `)
  const payload = await page.evaluate(createDouyinPageSearchScript({
    page: 2,
    limit: 2,
  })) as {
    exhausted: boolean
    hasMore: boolean
    incomplete: boolean
  }
  expect(payload.exhausted).toBe(true)
  expect(payload.incomplete).toBe(false)
  expect(payload.hasMore).toBe(false)
})

test('连续流在超过旧等待窗口后仍能恢复加载', async ({ page }) => {
  await page.setContent(`
    <style>main { height: 100px; overflow-y: auto; } li { min-height: 70px; }</style>
    <main><ul id="delayed-results">
      ${VIDEO_IDS.slice(0, 2).map((id) => `
        <li><a href="https://www.douyin.com/video/${id}">初始视频</a></li>
      `).join('')}
      <li id="delayed-sentinel" data-e2e="search-load-more">加载更多</li>
    </ul></main>
  `)
  await page.evaluate(({ nextId }) => {
    const sentinel = document.querySelector('#delayed-sentinel') as HTMLElement | null
    let scheduled = false
    if (!sentinel) return
    sentinel.scrollIntoView = () => {
      if (scheduled) return
      scheduled = true
      window.setTimeout(() => {
        sentinel.insertAdjacentHTML(
          'beforebegin',
          `<li><a href="https://www.douyin.com/video/${nextId}">延迟视频</a></li>`,
        )
      }, 3_200)
    }
  }, { nextId: VIDEO_IDS[2] })
  const payload = await page.evaluate(createDouyinPageSearchScript({
    page: 3,
    limit: 1,
  })) as {
    exhausted: boolean
    hasMore: boolean
    incomplete: boolean
    items: unknown[]
  }
  expect(payload.items).toHaveLength(3)
  expect(payload.exhausted).toBe(false)
  expect(payload.incomplete).toBe(false)
  expect(payload.hasMore).toBe(true)
})

test('播放器 webview 在同一 guest 内切换严格同 ID 互动页并可返回', async () => {
  const expectedSession = { getPartition: () => DOUYIN_PARTITION }
  const interactionTargets: Array<Record<string, unknown>> = []
  const preferences: Record<string, unknown> = {
    partition: DOUYIN_PARTITION,
    preload: '/tmp/untrusted.cjs',
    nodeIntegration: true,
  }
  hardenDouyinPlayerWebPreferences(preferences, expectedSession)
  expect(preferences).toMatchObject({
    partition: DOUYIN_PARTITION,
    session: expectedSession,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    devTools: false,
  })
  expect(preferences).not.toHaveProperty('preload')

  const host = new EventEmitter()
  const dispose = installDouyinPlayerWebviewGuard(host, expectedSession, {
    onOpenInteraction: (target) => interactionTargets.push(target),
  })
  const rejected = { prevented: false, preventDefault() { this.prevented = true } }
  host.emit(
    'will-attach-webview',
    rejected,
    { partition: DOUYIN_PARTITION },
    {
      partition: DOUYIN_PARTITION,
      src: `https://open.douyin.com/player/video?vid=${VIDEO_IDS[0]}&autoplay=0`,
    },
  )
  expect(rejected.prevented).toBe(true)

  const accepted = { prevented: false, preventDefault() { this.prevented = true } }
  const acceptedPreferences: Record<string, unknown> = {
    partition: DOUYIN_PARTITION,
  }
  host.emit(
    'will-attach-webview',
    accepted,
    acceptedPreferences,
    {
      partition: DOUYIN_PARTITION,
      src: createDouyinOfficialPlayerUrl(VIDEO_IDS[0]),
    },
  )
  expect(accepted.prevented).toBe(false)
  expect(acceptedPreferences.session).toBe(expectedSession)

  const guest = new EventEmitter() as EventEmitter & {
    session: object
    setWindowOpenHandler(
      handler: (details: { url: string }) => { action: string },
    ): void
    isDestroyed(): boolean
    getURL(): string
    loadURL(url: string): Promise<void>
    insertCSS(css: string): Promise<string>
    removeInsertedCSS(key: string): Promise<void>
    executeJavaScript(script: string, userGesture?: boolean): Promise<boolean>
  }
  guest.session = expectedSession
  let windowOpenHandler: null | ((details: { url: string }) => { action: string }) = null
  guest.setWindowOpenHandler = (handler) => { windowOpenHandler = handler }
  guest.isDestroyed = () => false
  let currentUrl = createDouyinOfficialPlayerUrl(VIDEO_IDS[0])
  const insertedCss: string[] = []
  const removedCssKeys: string[] = []
  const loadedUrls: string[] = []
  const executedScripts: Array<{ script: string; userGesture?: boolean }> = []
  Object.assign(guest, {
    getURL: () => currentUrl,
    insertCSS: async (css: string) => {
      insertedCss.push(css)
      return `contained-player-layout-${insertedCss.length}`
    },
    removeInsertedCSS: async (key: string) => {
      removedCssKeys.push(key)
    },
    executeJavaScript: async (script: string, userGesture?: boolean) => {
      executedScripts.push({ script, userGesture })
      return true
    },
  })
  guest.loadURL = async (url: string) => {
    currentUrl = url
    loadedUrls.push(url)
  }
  host.emit('did-attach-webview', {}, guest)
  guest.emit('dom-ready')
  guest.emit('did-finish-load')
  await Promise.resolve()
  expect(insertedCss).toHaveLength(1)
  expect(insertedCss.every((css) => css === DOUYIN_PLAYER_CONTAIN_CSS)).toBe(true)
  expect(DOUYIN_PLAYER_CONTAIN_CSS).toContain('.container-pc')
  expect(DOUYIN_PLAYER_CONTAIN_CSS).toContain('width: 100%')
  expect(DOUYIN_PLAYER_CONTAIN_CSS).not.toContain('.xgplayer')
  expect(DOUYIN_PLAYER_CONTAIN_CSS).not.toContain('object-fit')
  expect(DOUYIN_PLAYER_CONTAIN_CSS).not.toContain('background-size')
  const navigation = {
    prevented: false,
    preventDefault() { this.prevented = true },
  }
  guest.emit('will-navigate', navigation, 'https://evil.test/', false, true)
  expect(navigation.prevented).toBe(true)
  guest.emit('did-navigate', {}, 'https://evil.test/', true)
  expect(loadedUrls.at(-1)).toBe(createDouyinOfficialPlayerUrl(VIDEO_IDS[0]))

  const loadedBeforeWrongPopup = loadedUrls.length
  expect(windowOpenHandler?.({
    url: `https://www.douyin.com/?previous_page=web_code_link&vid=${VIDEO_IDS[1]}`,
  })).toEqual({ action: 'deny' })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(loadedUrls).toHaveLength(loadedBeforeWrongPopup)

  expect(windowOpenHandler?.({
    url: `https://www.douyin.com/jingxuan?modal_id=${VIDEO_IDS[0]}&previous_page=web_code_link`,
  })).toEqual({ action: 'deny' })
  await new Promise<void>((resolve) => setImmediate(resolve))
  const interactionUrl = createDouyinInteractionUrl(VIDEO_IDS[0])
  expect(loadedUrls.at(-1)).toBe(interactionUrl)
  expect(currentUrl).toBe(interactionUrl)
  expect(removedCssKeys).toEqual(['contained-player-layout-1'])
  expect(interactionTargets).toEqual([expect.objectContaining({
    kind: 'video',
    mediaId: VIDEO_IDS[0],
    url: interactionUrl,
  })])

  const allowedInteractionNavigation = {
    prevented: false,
    preventDefault() { this.prevented = true },
  }
  guest.emit(
    'will-navigate',
    allowedInteractionNavigation,
    interactionUrl,
    false,
    true,
  )
  expect(allowedInteractionNavigation.prevented).toBe(false)

  for (const illegalUrl of [
    createDouyinInteractionUrl(VIDEO_IDS[1]),
    `${interactionUrl}&download=1`,
    `https://evil.test/jingxuan?modal_id=${VIDEO_IDS[0]}`,
  ]) {
    const illegalNavigation = {
      prevented: false,
      preventDefault() { this.prevented = true },
    }
    guest.emit('will-navigate', illegalNavigation, illegalUrl, false, true)
    expect(illegalNavigation.prevented).toBe(true)
  }

  const loadedBeforeRepeatedPopup = loadedUrls.length
  expect(windowOpenHandler?.({
    url: `https://www.douyin.com/?previous_page=web_code_link&vid=${VIDEO_IDS[0]}`,
  })).toEqual({ action: 'deny' })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(loadedUrls).toHaveLength(loadedBeforeRepeatedPopup)

  guest.emit('did-navigate', {}, createDouyinInteractionUrl(VIDEO_IDS[1]), true)
  expect(loadedUrls.at(-1)).toBe(interactionUrl)

  const returnNavigation = {
    prevented: false,
    preventDefault() { this.prevented = true },
  }
  guest.emit(
    'will-navigate',
    returnNavigation,
    'https://www.douyin.com/jingxuan',
    false,
    true,
  )
  expect(returnNavigation.prevented).toBe(true)
  const playerUrl = createDouyinOfficialPlayerUrl(VIDEO_IDS[0])
  expect(loadedUrls.at(-1)).toBe(playerUrl)
  expect(currentUrl).toBe(playerUrl)

  guest.emit('did-start-navigation', {}, playerUrl, false, true)
  guest.emit('dom-ready')
  await Promise.resolve()
  expect(insertedCss).toHaveLength(2)
  expect(insertedCss[1]).toBe(DOUYIN_PLAYER_CONTAIN_CSS)
  expect(executedScripts.length).toBeGreaterThan(0)
  expect(executedScripts.every(({ script, userGesture }) => (
    script === DOUYIN_PLAYER_AUTOPLAY_SCRIPT && userGesture === true
  ))).toBe(true)

  dispose()
})

test('登录态来自共享会话，登录成功后自动关闭窗口', async () => {
  const session = new FakeDouyinSession()
  const authEvents: boolean[] = []
  const manager = createManager(session, {
    onAuthStateChange: (state: { signedIn: boolean }) => authEvents.push(state.signedIn),
  })
  expect(await manager.getAuthState()).toEqual({ signedIn: false })
  expect(await manager.openLogin()).toEqual({ signedIn: false })
  const loginWindow = FakeBrowserWindow.instances[0]
  expect(loginWindow.options.title).toBe('登录抖音')
  expect(loginWindow.options.fullscreenable).toBe(false)
  expect(loginWindow.loadedUrls).toEqual([DOUYIN_LOGIN_URL])

  session.cookies.values = [{
    name: 'sessionid_ss',
    value: 'signed-in',
    domain: '.douyin.com',
  }]
  session.cookies.emit('changed', {}, session.cookies.values[0])
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(authEvents).toContain(true)
  expect(loginWindow.closed).toBe(true)
  manager.dispose()
})

test('官方互动页复用同一抖音会话并保持单一受管窗口', async () => {
  const session = new FakeDouyinSession()
  session.cookies.values = [{
    name: 'sessionid_ss',
    value: 'signed-in',
    domain: '.douyin.com',
  }]
  const manager = createManager(session)
  expect(await manager.openInteraction({
    kind: 'video',
    mediaId: VIDEO_IDS[0],
  })).toEqual({ opened: true, reason: null })
  const firstWindow = FakeBrowserWindow.instances[0]
  expect(firstWindow.options).toMatchObject({
    title: '抖音互动',
    frame: true,
    closable: true,
    maximizable: false,
    fullscreenable: false,
  })
  expect(firstWindow.options.webPreferences).toMatchObject({
    session,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  })
  expect(firstWindow.loadedUrls).toEqual([createDouyinInteractionUrl(VIDEO_IDS[0])])

  expect(await manager.openInteraction({
    kind: 'video',
    mediaId: VIDEO_IDS[0],
  })).toEqual({ opened: true, reason: null })
  expect(FakeBrowserWindow.instances).toHaveLength(1)

  const deniedNavigation = {
    prevented: false,
    preventDefault() { this.prevented = true },
  }
  firstWindow.webContents.emit(
    'will-navigate',
    deniedNavigation,
    'https://evil.test/',
  )
  expect(deniedNavigation.prevented).toBe(true)
  expect(firstWindow.webContents.windowOpenHandler?.({
    url: 'https://evil.test/',
  })).toEqual({ action: 'deny' })

  await manager.openInteraction({ kind: 'video', mediaId: VIDEO_IDS[1] })
  expect(firstWindow.closed).toBe(true)
  expect(FakeBrowserWindow.instances).toHaveLength(2)
  expect(FakeBrowserWindow.instances[1].loadedUrls).toEqual([
    createDouyinInteractionUrl(VIDEO_IDS[1]),
  ])
  manager.closeWindows()
  expect(FakeBrowserWindow.instances[1].closed).toBe(true)
  manager.dispose()
})

test('未登录点击抖音互动也保留当前视频并由官方详情页处理登录', async () => {
  const session = new FakeDouyinSession()
  const manager = createManager(session)
  expect(await manager.openInteraction({
    kind: 'video',
    mediaId: VIDEO_IDS[0],
  })).toEqual({ opened: true, reason: null })
  expect(FakeBrowserWindow.instances).toHaveLength(1)
  expect(FakeBrowserWindow.instances[0].options.title).toBe('抖音互动')
  expect(FakeBrowserWindow.instances[0].loadedUrls).toEqual([
    createDouyinInteractionUrl(VIDEO_IDS[0]),
  ])
  manager.dispose()
})

test('搜索复用同一官方页面并由归一化层完成分页', async () => {
  const session = new FakeDouyinSession()
  session.cookies.values = [{ name: 'sessionid', value: 'ok', domain: '.douyin.com' }]
  const manager = createManager(session)

  FakeBrowserWindow.nextExecutePayload = searchPayload()
  const firstPromise = manager.searchVideos({ query: '冰川', page: 1, limit: 2 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const searchWindow = FakeBrowserWindow.instances[0]
  expect((searchWindow.options.webPreferences as Record<string, unknown>)
    .backgroundThrottling).toBe(false)
  const first = await firstPromise
  expect(searchWindow.loadedUrls).toEqual([createDouyinSearchUrl('冰川')])
  expect(first.results.map((item) => item.mediaId)).toEqual(VIDEO_IDS.slice(0, 2))

  const second = await manager.searchVideos({ query: '冰川', page: 2, limit: 2 })
  expect(searchWindow.loadedUrls).toHaveLength(1)
  expect(second.results.map((item) => item.mediaId)).toEqual(VIDEO_IDS.slice(2, 4))
  manager.dispose()
})

test('追加页暂停后可在同一官方页面重试同一游标', async () => {
  const session = new FakeDouyinSession()
  session.cookies.values = [{ name: 'sessionid', value: 'ok', domain: '.douyin.com' }]
  const manager = createManager(session)
  const partial = searchPayload()
  partial.items = partial.items.slice(0, 2)
  FakeBrowserWindow.nextExecutePayload = {
    ...partial,
    incomplete: true,
    exhausted: false,
    hasMore: true,
  }

  const firstAttempt = manager.searchVideos({ query: 'vibecoding', page: 2, limit: 2 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const searchWindow = FakeBrowserWindow.instances[0]
  await expect(firstAttempt).rejects.toMatchObject({
    code: 'DOUYIN_SEARCH_INCOMPLETE',
    retryable: true,
  })
  searchWindow.webContents.executePayload = searchPayload()
  const recovered = await manager.searchVideos({
    query: 'vibecoding',
    page: 2,
    limit: 2,
  })
  expect(searchWindow.loadedUrls).toEqual([createDouyinSearchUrl('vibecoding')])
  expect(recovered.results.map((item) => item.mediaId)).toEqual(VIDEO_IDS.slice(2, 4))
  expect(recovered.hasMore).toBe(true)
  expect(recovered.nextPage).toBe(3)
  manager.dispose()
})

test('不足一页的批次提交后下一页从实际交付位置继续', async () => {
  const session = new FakeDouyinSession()
  session.cookies.values = [{ name: 'sessionid', value: 'ok', domain: '.douyin.com' }]
  const manager = createManager(session)
  const partial = searchPayload()
  partial.items = partial.items.slice(0, 3)
  FakeBrowserWindow.nextExecutePayload = {
    ...partial,
    incomplete: true,
    exhausted: false,
    hasMore: true,
  }

  const firstBatch = await manager.searchVideos({
    query: 'vibecoding',
    page: 2,
    limit: 2,
  })
  const searchWindow = FakeBrowserWindow.instances[0]
  expect(firstBatch.results.map((item) => item.mediaId)).toEqual([VIDEO_IDS[2]])
  expect(firstBatch.hasMore).toBe(true)
  expect(firstBatch.nextPage).toBe(3)

  searchWindow.webContents.executePayload = searchPayload()
  const nextBatch = await manager.searchVideos({
    query: 'vibecoding',
    page: 3,
    limit: 2,
  })
  expect(nextBatch.results.map((item) => item.mediaId)).toEqual(VIDEO_IDS.slice(3, 5))
  expect(searchWindow.webContents.executedScripts.at(-1)).toContain('targetCount = 5')
  expect(searchWindow.loadedUrls).toEqual([createDouyinSearchUrl('vibecoding')])
  manager.dispose()
})

test('浏览器验证只在普通可关闭窗口中展示', async () => {
  const session = new FakeDouyinSession()
  session.cookies.values = [{ name: 'sessionid', value: 'ok', domain: '.douyin.com' }]
  const manager = createManager(session)
  FakeBrowserWindow.nextExecutePayload = {
    loginRequired: false,
    verificationRequired: true,
    hasMore: false,
    items: [],
  }
  await expect(manager.searchVideos({ query: '冰川' })).rejects.toMatchObject({
    code: 'DOUYIN_VERIFICATION_REQUIRED',
  })
  expect(FakeBrowserWindow.instances).toHaveLength(2)
  const [hiddenSearch, verification] = FakeBrowserWindow.instances
  expect(hiddenSearch.options).toMatchObject({ show: false, frame: false })
  expect(hiddenSearch.closed).toBe(true)
  expect(verification.options).toMatchObject({
    show: false,
    frame: true,
    closable: true,
    fullscreenable: false,
    title: '完成抖音浏览器验证',
  })
  expect(verification.loadedUrls).toEqual([createDouyinSearchUrl('冰川')])
  manager.dispose()
})

test('封面通过受管缓存写入本地且不携带登录凭据', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aurora-douyin-cover-'))
  try {
    const session = new FakeDouyinSession()
    session.cookies.values = [{ name: 'sessionid', value: 'ok', domain: '.douyin.com' }]
    const png = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0,
    ])
    session.fetchHandler = async () => new Response(png, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
    const manager = createManager(session, { cacheDirectory: directory })
    FakeBrowserWindow.nextExecutePayload = searchPayload()
    const promise = manager.searchVideos({ query: '冰川', page: 1, limit: 1 })
    const response = await promise
    const thumbnailPath = response.results[0].thumbnailPath as string
    expect(path.dirname(thumbnailPath)).toBe(directory)
    expect(await readFile(thumbnailPath)).toEqual(png)
    expect(session.fetchCalls[0].options).toMatchObject({
      credentials: 'omit',
      redirect: 'manual',
    })
    manager.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('未登录搜索不会打开隐藏页面，退出会清除独立会话', async () => {
  const session = new FakeDouyinSession()
  const manager = createManager(session)
  await expect(manager.searchVideos({ query: '冰川' })).rejects.toMatchObject({
    code: 'DOUYIN_LOGIN_REQUIRED',
  })
  expect(FakeBrowserWindow.instances).toHaveLength(0)
  expect(await manager.logout()).toEqual({ signedIn: false })
  expect(session.clearDataCount).toBe(1)
  manager.dispose()
})
