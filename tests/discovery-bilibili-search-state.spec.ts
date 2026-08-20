import { expect, test } from '@playwright/test'

test('连续 B站搜索只展示当前响应并保持准确的结果数量', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await expect(page.locator('.auroraApp')).toHaveClass(/view-online-search/)
  await page.evaluate(() => {
    const createDescriptor = (
      mediaId: string,
      title: string,
      query: string,
    ) => ({
      source: 'bilibili' as const,
      kind: 'episode' as const,
      mediaId,
      bvid: null,
      episodeId: mediaId,
      url: `https://www.bilibili.com/bangumi/play/ep${mediaId}`,
      canonicalUrl: `https://www.bilibili.com/bangumi/play/ep${mediaId}`,
      title,
      description: `${query} 的测试结果`,
      coverUrl: null,
      thumbnailPath: null,
      author: 'B站番剧',
      duration: '1 集',
      publishedAt: '',
      tags: [query],
    })

    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        searchBilibiliVideos: async ({ query }: { query: string }) => {
          if (query === '凡人修仙传') {
            return {
              query,
              results: [createDescriptor('100001', '凡人修仙传', query)],
            }
          }
          if (query === '延迟凡人') {
            await new Promise((resolve) => window.setTimeout(resolve, 350))
            return {
              query,
              results: [createDescriptor('300003', '延迟的凡人结果', query)],
            }
          }
          if (query === '星海') {
            return {
              query,
              results: [createDescriptor('400004', '星海当前结果', query)],
            }
          }
          return {
            query,
            results: [createDescriptor('200002', '冰川纪元', query)],
          }
        },
      },
    })
  })
  const input = page.getByLabel('搜索视频片段或关键帧')
  await input.fill('凡人修仙传')
  await page.getByRole('button', { name: '开始搜索' }).click()
  await expect(
    page.locator(
      '.discoveryResultHit[data-discovery-result-id="bilibili:episode:100001"]',
    ),
  ).toBeVisible()

  await input.fill('冰川')
  await page.getByRole('button', { name: '开始搜索' }).click()
  await expect(
    page.locator(
      '.discoveryResultHit[data-discovery-result-id="bilibili:episode:200002"]',
    ),
  ).toBeVisible()
  await expect(
    page.locator(
      '.discoveryResultHit[data-discovery-result-id="bilibili:episode:100001"]',
    ),
  ).toHaveCount(0)
  await expect(page.locator('.discoveryFooter')).toContainText('1条结果')
  await expect(page.locator('.discoveryFooter')).toContainText('查询：冰川')

  await input.fill('延迟凡人')
  await page.getByRole('button', { name: '开始搜索' }).click()
  await input.fill('星海')
  await page.locator('.discoverySearchBar').evaluate((form) => {
    if (form instanceof HTMLFormElement) form.requestSubmit()
  })
  await expect(
    page.locator(
      '.discoveryResultHit[data-discovery-result-id="bilibili:episode:400004"]',
    ),
  ).toBeVisible()
  await expect(
    page.locator(
      '.discoveryResultHit[data-discovery-result-id="bilibili:episode:300003"]',
    ),
  ).toHaveCount(0)
  await expect(page.locator('.discoveryFooter')).toContainText('查询：星海')

  await page.locator('.sideDock button[aria-label="项目库"]').click()
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await expect(
    page.locator(
      '.discoveryResultHit[data-discovery-result-id="bilibili:episode:400004"]',
    ),
  ).toBeVisible()
  await expect(
    page.locator(
      '.discoveryResultHit[data-discovery-result-id="bilibili:episode:100001"]',
    ),
  ).toHaveCount(0)
})

test('B站全部类型每页八条时会在十六条边界提前追加第三页', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await page.evaluate(() => {
    const calls: number[] = []
    Object.defineProperty(window, '__auroraBilibiliPages', {
      configurable: true,
      value: calls,
    })
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        searchBilibiliVideos: async ({
          query,
          page = 1,
          limit = 12,
        }: {
          query: string
          page?: number
          limit?: number
        }) => {
          calls.push(page)
          const resultCount = Math.max(1, Math.floor(limit * 2 / 3))
          const results = Array.from({ length: resultCount }, (_, index) => {
            const mediaId = `BV${String((page - 1) * resultCount + index + 1).padStart(10, '0')}`
            return {
              source: 'bilibili' as const,
              kind: 'video' as const,
              mediaId,
              bvid: mediaId,
              episodeId: null,
              url: `https://www.bilibili.com/video/${mediaId}`,
              canonicalUrl: `https://www.bilibili.com/video/${mediaId}`,
              title: `${query} 第 ${(page - 1) * resultCount + index + 1} 条`,
              description: '',
              coverUrl: null,
              thumbnailPath: null,
              author: '分页测试',
              duration: '01:00',
              publishedAt: '',
              tags: [query],
            }
          })
          return {
            query,
            page,
            pageSize: limit,
            totalCount: 120,
            hasMore: true,
            nextPage: page + 1,
            results,
          }
        },
      },
    })
  })

  await page.locator('.discoverySourceFilters button').filter({
    hasText: 'B站',
  }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click()
  })
  const input = page.getByLabel('搜索视频片段或关键帧')
  await input.fill('分页内容')
  await page.getByRole('button', { name: '开始搜索' }).click()

  await expect(page.locator('.discoveryFooter')).toContainText(
    '24 条已加载 / 共 120 条',
  )
  await expect.poll(() =>
    page.evaluate(() =>
      (window as typeof window & { __auroraBilibiliPages?: number[] })
        .__auroraBilibiliPages ?? [],
    ),
  ).toEqual([1, 2, 3])
})

test('追加页瞬时失败后停止自动请求，并可从原页手动重试', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await page.evaluate(() => {
    const calls: number[] = []
    let secondPageAttempts = 0
    Object.defineProperty(window, '__auroraBilibiliPages', {
      configurable: true,
      value: calls,
    })
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        searchBilibiliVideos: async ({
          query,
          page = 1,
          limit = 12,
        }: {
          query: string
          page?: number
          limit?: number
        }) => {
          calls.push(page)
          if (page === 2) {
            secondPageAttempts += 1
            if (secondPageAttempts === 1) {
              throw new Error('temporary provider failure')
            }
          }
          const results = Array.from({ length: limit }, (_, index) => {
            const mediaId = `BV${String((page - 1) * limit + index + 1).padStart(10, '0')}`
            return {
              source: 'bilibili' as const,
              kind: 'video' as const,
              mediaId,
              bvid: mediaId,
              episodeId: null,
              url: `https://www.bilibili.com/video/${mediaId}`,
              canonicalUrl: `https://www.bilibili.com/video/${mediaId}`,
              title: `${query} 第 ${(page - 1) * limit + index + 1} 条`,
              description: '',
              coverUrl: null,
              thumbnailPath: null,
              author: '分页重试测试',
              duration: '01:00',
              publishedAt: '',
              tags: [query],
            }
          })
          return {
            query,
            page,
            pageSize: limit,
            totalCount: 120,
            hasMore: true,
            nextPage: page + 1,
            results,
          }
        },
      },
    })
  })

  await page.locator('.discoverySourceFilters button').filter({
    hasText: 'B站',
  }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click()
  })
  const input = page.getByLabel('搜索视频片段或关键帧')
  await input.fill('分页重试')
  await page.getByRole('button', { name: '开始搜索' }).click()

  const retryHint = page.locator('.discoverySearchHint')
  await expect(retryHint).toContainText('加载更多B站结果失败')
  await page.waitForTimeout(350)
  await expect.poll(() =>
    page.evaluate(() =>
      (window as typeof window & { __auroraBilibiliPages?: number[] })
        .__auroraBilibiliPages ?? [],
    ),
  ).toEqual([1, 2])

  await retryHint.click()
  await expect(page.locator('.discoveryFooter')).toContainText(
    '24 条已加载 / 共 120 条',
  )
  await expect.poll(() =>
    page.evaluate(() =>
      (window as typeof window & { __auroraBilibiliPages?: number[] })
        .__auroraBilibiliPages ?? [],
    ),
  ).toEqual([1, 2, 2])
})

test('追加页没有新增结果时停止继续翻页', async ({ page }) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await page.evaluate(() => {
    const calls: number[] = []
    Object.defineProperty(window, '__auroraBilibiliPages', {
      configurable: true,
      value: calls,
    })
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        searchBilibiliVideos: async ({
          query,
          page = 1,
          limit = 12,
        }: {
          query: string
          page?: number
          limit?: number
        }) => {
          calls.push(page)
          // 模拟提供方翻页游标仍然前进，但第二页意外重复首屏数据。
          const results = Array.from({ length: limit }, (_, index) => {
            const mediaId = `BV${String(index + 1).padStart(10, '0')}`
            return {
              source: 'bilibili' as const,
              kind: 'video' as const,
              mediaId,
              bvid: mediaId,
              episodeId: null,
              url: `https://www.bilibili.com/video/${mediaId}`,
              canonicalUrl: `https://www.bilibili.com/video/${mediaId}`,
              title: `${query} 第 ${index + 1} 条`,
              description: '',
              coverUrl: null,
              thumbnailPath: null,
              author: '分页去重测试',
              duration: '01:00',
              publishedAt: '',
              tags: [query],
            }
          })
          return {
            query,
            page,
            pageSize: limit,
            totalCount: 120,
            hasMore: !(query === '正常末页' && page >= 2),
            nextPage: query === '正常末页' && page >= 2
              ? null
              : page + 1,
            results,
          }
        },
      },
    })
  })

  await page.locator('.discoverySourceFilters button').filter({
    hasText: 'B站',
  }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click()
  })
  const input = page.getByLabel('搜索视频片段或关键帧')
  await input.fill('重复分页')
  await page.getByRole('button', { name: '开始搜索' }).click()

  await expect(page.locator('.discoverySearchHint')).toContainText(
    '本页没有新增结果',
  )
  await page.waitForTimeout(350)
  await expect.poll(() =>
    page.evaluate(() =>
      (window as typeof window & { __auroraBilibiliPages?: number[] })
        .__auroraBilibiliPages ?? [],
    ),
  ).toEqual([1, 2])

  await input.fill('正常末页')
  await page.getByRole('button', { name: '开始搜索' }).click()
  await expect(page.locator('.discoverySearchHint')).toContainText(
    '已加载全部 12 个B站结果',
  )
  await expect(page.locator('.discoverySearchHint')).not.toHaveAttribute(
    'role',
    'button',
  )
  await page.waitForTimeout(350)
  await expect.poll(() =>
    page.evaluate(() =>
      (window as typeof window & { __auroraBilibiliPages?: number[] })
        .__auroraBilibiliPages ?? [],
    ),
  ).toEqual([1, 2, 1, 2])
})
