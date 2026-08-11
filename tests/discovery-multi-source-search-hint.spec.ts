import { expect, test } from '@playwright/test'

test('全部来源开启多个在线接口时显示聚合摘要并保留完整详情', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.locator('.sideDock button[aria-label="探索"]').click()
  await page.evaluate(() => {
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: {
        searchOnlineProvider: async ({
          provider,
          query,
          page = 1,
          limit = 12,
        }: {
          provider: 'bilibili' | 'tencent'
          query: string
          page?: number
          limit?: number
        }) => {
          const mediaId = provider === 'bilibili'
            ? 'BV1MULTISOURCE'
            : 'tencent-multi-source'
          return {
            query,
            page,
            pageSize: limit,
            totalCount: 1,
            hasMore: false,
            nextPage: null,
            results: [
              {
                source: provider,
                kind: 'video' as const,
                mediaId,
                bvid: provider === 'bilibili' ? mediaId : null,
                episodeId: null,
                url: `https://example.com/${provider}/${mediaId}`,
                canonicalUrl: `https://example.com/${provider}/${mediaId}`,
                title: `${query} ${provider}`,
                description: '',
                coverUrl: null,
                thumbnailPath: null,
                author: provider,
                duration: '01:00',
                publishedAt: '',
                tags: [query],
              },
            ],
          }
        },
      },
    })
  })

  const input = page.getByLabel('搜索视频片段或关键帧')
  await input.fill('多源聚合提示测试')
  await page.getByRole('button', { name: '开始搜索' }).click()

  const hint = page.locator('.discoverySearchHint')
  await expect(hint).toContainText('在线结果 2 条 · 2 个来源')
  await expect(hint).not.toContainText('B站')
  await expect(hint).not.toContainText('腾讯视频')
  await expect(hint).toHaveClass(/isCompact/)
  await expect(hint).toHaveAttribute(
    'title',
    /B站：已找到 1 个B站结果 · 腾讯视频：已找到 1 个腾讯视频结果/,
  )

  await page.locator('.discoverySourceFilters button').filter({
    hasText: 'B站',
  }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click()
  })
  await expect(hint).toContainText('已找到 1 个B站结果')
  await expect(hint).not.toHaveClass(/isCompact/)
  await expect(hint).not.toHaveAttribute('title')
})
