import { expect, test, type Page } from '@playwright/test'

type DouyinSearchCall = {
  query: string
  page: number
}

declare global {
  interface Window {
    __auroraDouyinSearchCalls?: DouyinSearchCall[]
  }
}

async function enterAuroraFromStartupGate(page: Page) {
  await page.goto('/')
  const gate = page.getByRole('dialog', { name: 'Aurora 启动载入' })
  await expect(
    gate.getByRole('button', { name: '点击画面进入' }),
  ).toBeVisible({ timeout: 45_000 })
  await gate.click({ position: { x: 24, y: 24 } })
}

async function openDouyinSearch(page: Page) {
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await page.locator('.discoverySourceFilters button').filter({
    hasText: '抖音',
  }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click()
  })
}

test('抖音追加页短暂无新增时自动重试原页并继续追加', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const createDescriptor = (
      mediaId: string,
      title: string,
      query: string,
    ) => ({
      source: 'douyin' as const,
      kind: 'video' as const,
      mediaId,
      url: `https://www.douyin.com/video/${mediaId}`,
      canonicalUrl: `https://www.douyin.com/video/${mediaId}`,
      title,
      description: `${query} 的测试结果`,
      coverUrl: null,
      thumbnailPath: null,
      author: '抖音分页测试',
      duration: '00:15',
      publishedAt: '',
      tags: [query],
    })
    const calls: DouyinSearchCall[] = []
    let secondPageAttempts = 0
    window.__auroraDouyinSearchCalls = calls
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        notifyStartupVisualReady() {},
        loadAppData: async () => ({
          onlineProviders: {
            schemaVersion: 1,
            enabled: {
              bilibili: false,
              tencent: false,
              xinpianchang: false,
              youku: false,
              douyin: true,
            },
          },
        }),
        saveAppData: async () => true,
        getMediaUrl: () => null,
        searchOnlineProvider: async ({
          provider,
          query,
          page = 1,
          limit = 12,
        }: {
          provider: string
          query: string
          page?: number
          limit?: number
        }) => {
          if (provider !== 'douyin') throw new Error('unexpected provider')
          calls.push({ query, page })
          if (page === 2) secondPageAttempts += 1
          const resultPage = page === 2 && secondPageAttempts === 1 ? 1 : page
          const results = Array.from({ length: limit }, (_, index) => {
            const ordinal = (resultPage - 1) * limit + index + 1
            const mediaId = `75357240407612${String(ordinal).padStart(5, '0')}`
            return createDescriptor(
              mediaId,
              `${query} 第 ${ordinal} 条`,
              query,
            )
          })
          const temporaryNoProgress = page === 2 && secondPageAttempts === 1
          return {
            query,
            page,
            pageSize: limit,
            totalCount: temporaryNoProgress ? 12 : 120,
            hasMore: !temporaryNoProgress,
            nextPage: temporaryNoProgress ? null : page + 1,
            results,
          }
        },
      },
    })
  })

  await enterAuroraFromStartupGate(page)
  await openDouyinSearch(page)
  const input = page.getByLabel('搜索视频片段或关键帧')
  await input.fill('持续分页')
  await page.getByRole('button', { name: '开始搜索' }).click()

  const retryHint = page.locator('.discoverySearchHint')
  await expect(retryHint).toContainText('自动重试')
  await expect(retryHint).not.toContainText('已加载全部')
  await expect.poll(() => windowDouyinCalls(page)).toEqual([
    { query: '持续分页', page: 1 },
    { query: '持续分页', page: 2 },
    { query: '持续分页', page: 2 },
  ])
  await expect(page.locator('.discoveryFooter')).toContainText(
    '24 条已加载 / 共 120 条',
  )
})

test('新搜索会取消旧查询等待中的抖音恢复重试', async ({ page }) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const createDescriptor = (
      mediaId: string,
      title: string,
      query: string,
    ) => ({
      source: 'douyin' as const,
      kind: 'video' as const,
      mediaId,
      url: `https://www.douyin.com/video/${mediaId}`,
      canonicalUrl: `https://www.douyin.com/video/${mediaId}`,
      title,
      description: `${query} 的测试结果`,
      coverUrl: null,
      thumbnailPath: null,
      author: '抖音分页测试',
      duration: '00:15',
      publishedAt: '',
      tags: [query],
    })
    const calls: DouyinSearchCall[] = []
    window.__auroraDouyinSearchCalls = calls
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        notifyStartupVisualReady() {},
        loadAppData: async () => ({
          onlineProviders: {
            schemaVersion: 1,
            enabled: {
              bilibili: false,
              tencent: false,
              xinpianchang: false,
              youku: false,
              douyin: true,
            },
          },
        }),
        saveAppData: async () => true,
        getMediaUrl: () => null,
        searchOnlineProvider: async ({
          provider,
          query,
          page = 1,
          limit = 12,
        }: {
          provider: string
          query: string
          page?: number
          limit?: number
        }) => {
          if (provider !== 'douyin') throw new Error('unexpected provider')
          calls.push({ query, page })
          if (query === '新查询') {
            return {
              query,
              page,
              pageSize: limit,
              totalCount: 1,
              hasMore: false,
              nextPage: null,
              results: [
                createDescriptor(
                  '7535724040761299999',
                  '新查询唯一结果',
                  query,
                ),
              ],
            }
          }
          const results = Array.from({ length: limit }, (_, index) => {
            const mediaId = `75357240407611${String(index + 1).padStart(5, '0')}`
            return createDescriptor(
              mediaId,
              `${query} 第 ${index + 1} 条`,
              query,
            )
          })
          return {
            query,
            page,
            pageSize: limit,
            totalCount: page === 1 ? 120 : 12,
            hasMore: page === 1,
            nextPage: page === 1 ? 2 : null,
            results,
          }
        },
      },
    })
  })

  await enterAuroraFromStartupGate(page)
  await openDouyinSearch(page)
  const input = page.getByLabel('搜索视频片段或关键帧')
  await input.fill('旧查询')
  await page.getByRole('button', { name: '开始搜索' }).click()
  await expect(page.locator('.discoverySearchHint')).toContainText('自动重试')

  await input.fill('新查询')
  await page.getByRole('button', { name: '开始搜索' }).click()
  await expect(
    page.locator(
      '.discoveryResultHit[data-discovery-result-id="douyin:video:7535724040761299999"]',
    ),
  ).toBeAttached()
  await page.waitForTimeout(1_200)
  await expect.poll(() => windowDouyinCalls(page)).toEqual([
    { query: '旧查询', page: 1 },
    { query: '旧查询', page: 2 },
    { query: '新查询', page: 1 },
  ])
  await expect(page.locator('.discoveryFooter')).toContainText('查询：新查询')
})

test('抖音追加页丢失响应时会退出永久加载态并保留原页重试', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      nativeSetTimeout(
        handler,
        delay === 45_000 ? 80 : delay,
        ...args,
      )) as typeof window.setTimeout

    const calls: DouyinSearchCall[] = []
    window.__auroraDouyinSearchCalls = calls
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        notifyStartupVisualReady() {},
        loadAppData: async () => ({
          onlineProviders: {
            schemaVersion: 1,
            enabled: {
              bilibili: false,
              tencent: false,
              xinpianchang: false,
              youku: false,
              douyin: true,
            },
          },
        }),
        saveAppData: async () => true,
        getMediaUrl: () => null,
        searchOnlineProvider: ({
          provider,
          query,
          page = 1,
          limit = 12,
        }: {
          provider: string
          query: string
          page?: number
          limit?: number
        }) => {
          if (provider !== 'douyin') {
            return Promise.reject(new Error('unexpected provider'))
          }
          calls.push({ query, page })
          if (page === 2) return new Promise(() => undefined)
          const results = Array.from({ length: limit }, (_, index) => {
            const mediaId = `75357240407613${String(index + 1).padStart(5, '0')}`
            return {
              source: 'douyin' as const,
              kind: 'video' as const,
              mediaId,
              url: `https://www.douyin.com/video/${mediaId}`,
              canonicalUrl: `https://www.douyin.com/video/${mediaId}`,
              title: `${query} 第 ${index + 1} 条`,
              description: `${query} 的超时测试结果`,
              coverUrl: null,
              thumbnailPath: null,
              author: '抖音超时测试',
              duration: '00:15',
              publishedAt: '',
              tags: [query],
            }
          })
          return Promise.resolve({
            query,
            page,
            pageSize: limit,
            totalCount: 120,
            hasMore: true,
            nextPage: 2,
            results,
          })
        },
      },
    })
  })

  await enterAuroraFromStartupGate(page)
  await openDouyinSearch(page)
  const input = page.getByLabel('搜索视频片段或关键帧')
  await input.fill('响应丢失')
  await page.getByRole('button', { name: '开始搜索' }).click()

  const retryHint = page.locator('.discoverySearchHint')
  await expect(retryHint).toContainText('自动重试')
  await expect(retryHint).not.toContainText('正在加载更多')
  await expect(retryHint).toHaveAttribute('role', 'button')
  await expect.poll(() => windowDouyinCalls(page)).toEqual([
    { query: '响应丢失', page: 1 },
    { query: '响应丢失', page: 2 },
  ])
  await expect(page.locator('.discoveryFooter')).toContainText(
    '12 条已加载 / 共 120 条',
  )
})

const windowDouyinCalls = (page: Page) =>
  page.evaluate(() => window.__auroraDouyinSearchCalls ?? [])
