import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const {
  TENCENT_VIDEO_LOGIN_URL,
  TENCENT_VIDEO_PARTITION,
  createTencentVideoSessionManager,
  detectTencentAuthCookieState,
  installTencentPlayerWebviewGuard,
  isAllowedTencentAuthNavigationUrl,
  normalizeTencentSearchPayload,
  parseTencentEmbeddedPageUrl,
} = require('../electron/tencentVideoSession.cjs') as {
  TENCENT_VIDEO_LOGIN_URL: string
  TENCENT_VIDEO_PARTITION: string
  createTencentVideoSessionManager(options: Record<string, unknown>): {
    closeWindows(): void
    dispose(): void
    getAuthState(): Promise<{ signedIn: boolean }>
    logout(): Promise<{ signedIn: boolean }>
    openLogin(): Promise<{ signedIn: boolean }>
  }
  detectTencentAuthCookieState(
    cookies: Array<{ name: string; value: string }>,
  ): { signedIn: boolean }
  installTencentPlayerWebviewGuard(
    hostContents: EventEmitter,
    expectedSession?: object,
  ): () => void
  isAllowedTencentAuthNavigationUrl(url: string): boolean
  normalizeTencentSearchPayload(
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
  parseTencentEmbeddedPageUrl(url: string): {
    kind: 'video' | 'episode'
    mediaId: string
    videoId: string
    url: string
  } | null
}
const {
  installBilibiliPlayerWebviewGuard,
} = require('../electron/bilibiliSession.cjs') as {
  installBilibiliPlayerWebviewGuard(
    hostContents: EventEmitter,
    expectedSession?: object,
  ): () => void
}

class FakeTencentGuest extends EventEmitter {
  destroyed = false
  insertedCss: string[] = []
  currentUrl: string
  session: object

  constructor(
    url: string,
    session: object = { getPartition: () => TENCENT_VIDEO_PARTITION },
  ) {
    super()
    this.currentUrl = url
    this.session = session
  }

  destroy() { this.destroyed = true }
  getURL() { return this.currentUrl }
  isDestroyed() { return this.destroyed }
  loadURL(url: string) { this.currentUrl = url; return Promise.resolve() }
  insertCSS(css: string) { this.insertedCss.push(css); return Promise.resolve('css') }
  invalidate() { return undefined }
  setWindowOpenHandler() { return undefined }
}

class FakeTencentCookies extends EventEmitter {
  values: Array<{ name: string; value: string; domain?: string }> = []
  flushCount = 0

  get() { return Promise.resolve([...this.values]) }
  flushStore() { this.flushCount += 1; return Promise.resolve() }
}

class FakeTencentSession extends EventEmitter {
  cookies = new FakeTencentCookies()
  clearDataCount = 0
  closeAllConnectionsCount = 0
  flushStorageDataCount = 0
  permissionCheckHandler: ((...args: unknown[]) => boolean) | null = null
  permissionRequestHandler: ((...args: unknown[]) => void) | null = null

  setPermissionCheckHandler(handler: (...args: unknown[]) => boolean) {
    this.permissionCheckHandler = handler
  }

  setPermissionRequestHandler(handler: (...args: unknown[]) => void) {
    this.permissionRequestHandler = handler
  }

  clearData() {
    this.clearDataCount += 1
    this.cookies.values = []
    return Promise.resolve()
  }

  closeAllConnections() {
    this.closeAllConnectionsCount += 1
    return Promise.resolve()
  }

  flushStorageData() {
    this.flushStorageDataCount += 1
    return Promise.resolve()
  }
}

class FakeTencentLoginContents extends EventEmitter {
  currentUrl = ''
  destroyed = false
  executedScripts: string[] = []
  windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null

  getURL() { return this.currentUrl }
  isDestroyed() { return this.destroyed }
  loadURL(url: string) { this.currentUrl = url; return Promise.resolve() }
  executeJavaScript(script: string) {
    this.executedScripts.push(script)
    return Promise.resolve(true)
  }
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
    this.windowOpenHandler = handler
  }
}

class FakeTencentLoginWindow extends EventEmitter {
  static instances: FakeTencentLoginWindow[] = []
  destroyed = false
  fullScreen = false
  fullScreenable = true
  fullScreenCalls: boolean[] = []
  fullScreenableCalls: boolean[] = []
  loadedUrl = ''
  options: Record<string, any>
  webContents = new FakeTencentLoginContents()

  constructor(options: Record<string, any>) {
    super()
    this.options = options
    FakeTencentLoginWindow.instances.push(this)
  }

  close() {
    if (this.destroyed) return
    this.destroyed = true
    this.webContents.destroyed = true
    this.emit('closed')
  }

  focus() { return undefined }
  isDestroyed() { return this.destroyed }
  isMinimized() { return false }
  loadURL(url: string) {
    this.loadedUrl = url
    this.webContents.currentUrl = url
    return Promise.resolve()
  }
  setFullScreen(value: boolean) {
    this.fullScreen = value
    this.fullScreenCalls.push(value)
  }
  setFullScreenable(value: boolean) {
    this.fullScreenable = value
    this.fullScreenableCalls.push(value)
  }
  setMenuBarVisibility() { return undefined }
  show() { return undefined }
}

test('recognizes paired Tencent Video QQ and WeChat login cookies', () => {
  expect(detectTencentAuthCookieState([
    { name: 'main_login', value: 'qq' },
    { name: 'vqq_vuserid', value: '10001' },
    { name: 'vqq_vusession', value: 'session' },
  ])).toEqual({ signedIn: true })
  expect(detectTencentAuthCookieState([
    { name: 'main_login', value: 'wx' },
    { name: 'vuserid', value: '20002' },
    { name: 'access_token', value: 'token' },
  ])).toEqual({ signedIn: true })
  expect(detectTencentAuthCookieState([
    { name: 'vqq_vuserid', value: '10001' },
    { name: 'vqq_access_token', value: 'token' },
  ])).toEqual({ signedIn: true })
  expect(detectTencentAuthCookieState([
    { name: 'main_login', value: 'qq' },
    { name: 'vqq_vuserid', value: '10001' },
  ])).toEqual({ signedIn: false })
  expect(detectTencentAuthCookieState([
    { name: 'main_login', value: 'qq' },
    { name: 'vuserid', value: '20002' },
    { name: 'vusession', value: 'session' },
  ])).toEqual({ signedIn: true })
  expect(detectTencentAuthCookieState([
    { name: 'v_main_login', value: 'qq' },
    { name: 'v_vuserid', value: '30003' },
    { name: 'v_vusession', value: 'new-session' },
  ])).toEqual({ signedIn: true })
  expect(detectTencentAuthCookieState([
    { name: 'main_login', value: 'qq' },
    { name: 'vusession', value: 'session-without-user' },
  ])).toEqual({ signedIn: false })
})

test('shares the Tencent player partition with a guarded official login window', async () => {
  FakeTencentLoginWindow.instances = []
  const sharedSession = new FakeTencentSession()
  const partitions: Array<{ partition: string; options: unknown }> = []
  const emittedStates: Array<{ signedIn: boolean }> = []
  const manager = createTencentVideoSessionManager({
    BrowserWindow: FakeTencentLoginWindow,
    sessionModule: {
      fromPartition(partition: string, options: unknown) {
        partitions.push({ partition, options })
        return sharedSession
      },
    },
    cacheDirectory: '/tmp/aurora-tencent-test-covers',
    onAuthStateChange(state: { signedIn: boolean }) {
      emittedStates.push(state)
    },
  })

  expect(partitions).toEqual([{
    partition: TENCENT_VIDEO_PARTITION,
    options: { cache: true },
  }])
  expect(await manager.getAuthState()).toEqual({ signedIn: false })

  expect(await manager.openLogin()).toEqual({ signedIn: false })
  const loginWindow = FakeTencentLoginWindow.instances[0]
  expect(loginWindow.loadedUrl).toBe(TENCENT_VIDEO_LOGIN_URL)
  expect(loginWindow.options).toMatchObject({
    frame: true,
    closable: true,
    maximizable: false,
    fullscreen: false,
    fullscreenable: false,
  })
  expect(loginWindow.fullScreenable).toBe(false)
  expect(loginWindow.options.webPreferences).toMatchObject({
    session: sharedSession,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  })

  const deniedNavigation = {
    prevented: false,
    preventDefault() { this.prevented = true },
  }
  loginWindow.webContents.emit(
    'will-navigate',
    deniedNavigation,
    'https://attacker.example/login',
  )
  expect(deniedNavigation.prevented).toBe(true)
  const allowedNavigation = {
    prevented: false,
    preventDefault() { this.prevented = true },
  }
  loginWindow.webContents.emit(
    'will-navigate',
    allowedNavigation,
    'https://xui.ptlogin2.qq.com/cgi-bin/xlogin',
  )
  expect(allowedNavigation.prevented).toBe(false)
  expect(isAllowedTencentAuthNavigationUrl(
    'https://open.weixin.qq.com/connect/qrconnect',
  )).toBe(true)
  expect(isAllowedTencentAuthNavigationUrl(
    'https://qq.com.attacker.example/login',
  )).toBe(false)

  expect(sharedSession.permissionCheckHandler?.(
    loginWindow.webContents,
    'fullscreen',
    'https://v.qq.com/biu/u/history/',
    {},
  )).toBe(false)
  expect(sharedSession.permissionCheckHandler?.(
    {},
    'fullscreen',
    'https://v.qq.com/x/page/n3291n3bkwr.html',
    {},
  )).toBe(true)
  let loginFullscreenRequestAllowed: boolean | null = null
  sharedSession.permissionRequestHandler?.(
    loginWindow.webContents,
    'fullscreen',
    (allowed: boolean) => { loginFullscreenRequestAllowed = allowed },
    { requestingUrl: 'https://v.qq.com/biu/u/history/' },
  )
  expect(loginFullscreenRequestAllowed).toBe(false)

  const fullScreenCallCount = loginWindow.fullScreenCalls.length
  loginWindow.webContents.emit('enter-html-full-screen')
  loginWindow.emit('enter-full-screen')
  expect(loginWindow.fullScreenCalls.slice(fullScreenCallCount)).toEqual([
    false,
    false,
  ])
  expect(loginWindow.webContents.executedScripts).toHaveLength(2)

  sharedSession.cookies.values = [
    { name: 'main_login', value: 'qq', domain: '.qq.com' },
    { name: 'vqq_vuserid', value: '10001', domain: '.qq.com' },
  ]
  sharedSession.cookies.emit('changed', {}, {
    name: 'vqq_vuserid',
    value: '10001',
    domain: '.qq.com',
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(loginWindow.destroyed).toBe(false)

  sharedSession.cookies.values.push({
    name: 'vqq_vusession',
    value: 'session',
    domain: '.qq.com',
  })
  sharedSession.cookies.emit('changed', {}, {
    name: 'vqq_vusession',
    value: 'session',
    domain: '.qq.com',
  })
  await expect.poll(() => loginWindow.destroyed).toBe(true)
  expect(emittedStates.at(-1)).toEqual({ signedIn: true })
  expect(sharedSession.cookies.flushCount).toBeGreaterThan(0)
  expect(sharedSession.flushStorageDataCount).toBeGreaterThan(0)

  expect(await manager.logout()).toEqual({ signedIn: false })
  expect(sharedSession.clearDataCount).toBe(1)
  expect(sharedSession.closeAllConnectionsCount).toBe(1)
  expect(await manager.getAuthState()).toEqual({ signedIn: false })
  expect(emittedStates.at(-1)).toEqual({ signedIn: false })
  manager.dispose()
})

test('accepts only canonical Tencent Video playback pages', () => {
  expect(
    parseTencentEmbeddedPageUrl(
      'https://v.qq.com/x/page/n3291n3bkwr.html',
    ),
  ).toEqual({
    kind: 'video',
    mediaId: 'n3291n3bkwr',
    videoId: 'n3291n3bkwr',
    url: 'https://v.qq.com/x/page/n3291n3bkwr.html',
  })
  expect(
    parseTencentEmbeddedPageUrl(
      'https://v.qq.com/x/cover/mzc0033x2b7ys57/z3171ldqt0c.html',
    ),
  ).toEqual({
    kind: 'episode',
    mediaId: 'mzc0033x2b7ys57',
    videoId: 'z3171ldqt0c',
    url: 'https://v.qq.com/x/cover/mzc0033x2b7ys57/z3171ldqt0c.html',
  })
  expect(
    parseTencentEmbeddedPageUrl(
      'https://v.qq.com/x/page/n3291n3bkwr.html?redirect=https://attacker.example',
    ),
  ).toBeNull()
  expect(
    parseTencentEmbeddedPageUrl(
      'https://attacker.example/x/page/n3291n3bkwr.html',
    ),
  ).toBeNull()
})

test('normalizes Tencent-owned series and ordinary video results only', () => {
  const response = normalizeTencentSearchPayload(
    {
      data: {
        areaBoxList: [{
          itemList: [
            {
              doc: { dataType: 2, id: 'mzc0033x2b7ys57' },
              videoInfo: {
                title: '<em>测试</em>剧集',
                descrip: '官方剧集',
                imgUrl: 'http://puui.qpic.cn/vcover_vt_pic/0/test.jpg',
                directors: ['导演甲'],
                typeName: '电视剧',
                area: '中国大陆',
                language: ['普通话'],
                checkupTime: '2026-08-04',
                playSites: [{
                  enName: 'qq',
                  totalEpisode: 12,
                  episodeInfoList: [{
                    id: 'z3171ldqt0c',
                    url: 'https://v.qq.com/x/cover/mzc0033x2b7ys57/z3171ldqt0c.html',
                  }],
                }],
              },
            },
            {
              doc: { dataType: 2, id: 'mzc0033x2b7ys57' },
              videoInfo: {
                title: '<em>测试</em>剧集',
                descrip: '官方剧集',
                imgUrl: '//puui.qpic.cn/vcover_vt_pic/0/test.jpg',
                directors: ['导演甲'],
                typeName: '电视剧',
                area: '中国大陆',
                language: ['普通话'],
                checkupTime: '2026-08-04',
                playSites: [{
                  enName: 'qq',
                  totalEpisode: 12,
                  episodeInfoList: [{
                    id: 'z3171ldqt0c',
                    url: 'https://v.qq.com/x/cover/mzc0033x2b7ys57/z3171ldqt0c.html',
                  }],
                }],
              },
            },
            {
              doc: { dataType: 2, id: 'mzc0044outside' },
              videoInfo: {
                title: '外站聚合内容',
                playSites: [{
                  enName: 'external',
                  episodeInfoList: [{
                    id: 'z3171ldqt0x',
                    url: 'https://attacker.example/watch',
                  }],
                }],
              },
            },
          ],
        }],
        normalList: {
          totalNum: 30,
          itemList: [
            {
              doc: { dataType: 2, id: 'mzc0033x2b7ys57' },
              videoInfo: {
                title: '<em>测试</em>剧集',
                descrip: '官方剧集',
                imgUrl: '//puui.qpic.cn/vcover_vt_pic/0/test.jpg',
                directors: ['导演甲'],
                typeName: '电视剧',
                area: '中国大陆',
                language: ['普通话'],
                checkupTime: '2026-08-04',
                playSites: [{
                  enName: 'qq',
                  totalEpisode: 12,
                  episodeInfoList: [{
                    id: 'z3171ldqt0c',
                    url: 'https://v.qq.com/x/cover/mzc0033x2b7ys57/z3171ldqt0c.html',
                  }],
                }],
              },
            },
            {
              doc: { dataType: 1, id: 'n3291n3bkwr' },
              videoInfo: {
                title: '普通视频',
                descrip: '公开视频描述',
                imgUrl: 'https://puui.qpic.cn/qqvideo_ori/0/test.jpg',
                checkupTime: '2026-08-03',
                typeName: '短视频',
                views: '100万次观看',
                videoDoc: { uploader: '腾讯视频用户', timeLong: 125 },
              },
            },
          ],
        },
      },
    },
    { query: '测试', page: 1, limit: 12 },
  )

  expect(response.query).toBe('测试')
  expect(response.results).toHaveLength(2)
  expect(response.results.map((result) => result.kind)).toEqual([
    'episode',
    'video',
  ])
  expect(response.results[0]).toMatchObject({
    source: 'tencent',
    title: '测试剧集',
    mediaId: 'mzc0033x2b7ys57',
    duration: '共 12 集',
    coverUrl: 'https://puui.qpic.cn/vcover_vt_pic/0/test.jpg',
  })
  expect(response.results[1]).toMatchObject({
    source: 'tencent',
    mediaId: 'n3291n3bkwr',
    duration: '02:05',
    coverUrl: 'https://puui.qpic.cn/qqvideo_ori/0/test.jpg',
  })
  expect(response.hasMore).toBe(true)
  expect(response.nextPage).toBe(2)
})

test('keeps current Tencent vfiles series covers for managed caching', () => {
  const coverUrl =
    'https://vfiles.gtimg.cn/wuji_dashboard/xy/starter/tencent-series.png'
  const response = normalizeTencentSearchPayload(
    {
      data: {
        areaBoxList: [{
          itemList: [{
            doc: { dataType: 2, id: 'mzc00200nc1cbum' },
            videoInfo: {
              title: '火影忍者疾风传',
              imgUrl: coverUrl,
              playSites: [{
                enName: 'qq',
                totalEpisode: 720,
                episodeInfoList: [{
                  id: 'z3171ldqt0c',
                  url: 'https://v.qq.com/x/cover/mzc00200nc1cbum/z3171ldqt0c.html',
                }],
              }],
            },
          }],
        }],
        normalList: { totalNum: 1, itemList: [] },
      },
    },
    { query: '热血', page: 1, limit: 12 },
  )

  expect(response.results[0]).toMatchObject({
    mediaId: 'mzc00200nc1cbum',
    coverUrl,
  })
})

test('filters Tencent categories from reviewed type names and tags', () => {
  const makeItem = (id: string, typeName: string) => ({
    doc: { dataType: 2, id },
    videoInfo: {
      title: `${typeName}内容`,
      typeName,
      playSites: [{
        enName: 'qq',
        totalEpisode: 1,
        episodeInfoList: [{
          id: 'z3171ldqt0c',
          url: `https://v.qq.com/x/cover/${id}/z3171ldqt0c.html`,
        }],
      }],
    },
  })
  const payload = {
    data: {
      areaBoxList: [{
        itemList: [
          makeItem('mzc0033x2b7ys57', '动漫'),
          makeItem('mzc0033x2b7ys58', '纪录片'),
        ],
      }],
      normalList: { totalNum: 2, itemList: [] },
    },
  }
  const request = { query: '测试', page: 1, limit: 12 }
  expect(normalizeTencentSearchPayload(payload, {
    ...request,
    searchType: 'anime',
  }).results).toEqual([
    expect.objectContaining({ mediaId: 'mzc0033x2b7ys57' }),
  ])
  expect(normalizeTencentSearchPayload(payload, {
    ...request,
    searchType: 'documentary',
  }).results).toEqual([
    expect.objectContaining({ mediaId: 'mzc0033x2b7ys58' }),
  ])
  expect(() => normalizeTencentSearchPayload(payload, {
    ...request,
    searchType: 'sports',
  })).toThrow('search type')
})

test('isolates Tencent webviews while coexisting with other provider guards', async () => {
  const host = new EventEmitter()
  // Real Electron Session instances do not expose getPartition(). The main
  // process passes their object identities to the two guards instead.
  const bilibiliSession = {}
  const tencentSession = {}
  const disposeBilibili = installBilibiliPlayerWebviewGuard(
    host,
    bilibiliSession,
  )
  const disposeTencent = installTencentPlayerWebviewGuard(
    host,
    tencentSession,
  )

  const unknownEvent = { prevented: false, preventDefault() { this.prevented = true } }
  host.emit(
    'will-attach-webview',
    unknownEvent,
    { partition: 'persist:attacker', preload: '/tmp/attacker.js' },
    { partition: 'persist:attacker', src: 'https://attacker.example' },
  )
  // Individual provider guards ignore foreign partitions. The central online
  // player firewall owns the unknown-partition rejection policy.
  expect(unknownEvent.prevented).toBe(false)

  const bilibiliEvent = { prevented: false, preventDefault() { this.prevented = true } }
  host.emit(
    'will-attach-webview',
    bilibiliEvent,
    { partition: 'persist:aurora-bilibili-v1' },
    { partition: 'persist:aurora-bilibili-v1', src: 'https://www.bilibili.com/video/BV1xx411c7mD' },
  )
  expect(bilibiliEvent.prevented).toBe(false)

  const webPreferences: Record<string, unknown> = {
    partition: TENCENT_VIDEO_PARTITION,
    preload: '/tmp/attacker.js',
    nodeIntegration: true,
  }
  const tencentEvent = { prevented: false, preventDefault() { this.prevented = true } }
  host.emit(
    'will-attach-webview',
    tencentEvent,
    webPreferences,
    {
      partition: TENCENT_VIDEO_PARTITION,
      src: 'https://v.qq.com/x/page/n3291n3bkwr.html',
    },
  )
  expect(tencentEvent.prevented).toBe(false)
  expect(webPreferences).toMatchObject({
    partition: TENCENT_VIDEO_PARTITION,
    nodeIntegration: false,
    contextIsolation: true,
    disableHtmlFullscreenWindowResize: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  })
  expect(webPreferences.preload).toBeUndefined()

  const guest = new FakeTencentGuest(
    'https://v.qq.com/x/page/n3291n3bkwr.html',
    tencentSession,
  )
  host.emit('did-attach-webview', {}, guest)
  expect(guest.destroyed).toBe(false)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(guest.insertedCss).toHaveLength(1)
  guest.emit('dom-ready')
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(guest.insertedCss).toHaveLength(1)
  expect(guest.insertedCss[0]).toContain('#main-player')
  expect(guest.insertedCss[0]).toContain('#player-component')
  expect(guest.insertedCss[0]).toContain('.txp_overlay_link')
  expect(guest.insertedCss[0]).toContain('.txp_icon_link')

  const bilibiliGuest = new FakeTencentGuest(
    'https://www.bilibili.com/video/BV1xx411c7mD',
    bilibiliSession,
  )
  host.emit('did-attach-webview', {}, bilibiliGuest)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(bilibiliGuest.destroyed).toBe(false)
  expect(bilibiliGuest.insertedCss).toHaveLength(1)
  expect(bilibiliGuest.insertedCss[0]).toContain('#bilibili-player')

  disposeTencent()
  disposeBilibili()
})
