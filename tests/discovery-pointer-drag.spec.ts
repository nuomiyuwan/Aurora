import { expect, test } from '@playwright/test'

test('left-button drag follows the Discovery corridor and snaps on release', async ({
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
          provider: string
          query: string
          page?: number
          limit?: number
        }) => ({
          query,
          page,
          pageSize: limit,
          totalCount: 12,
          hasMore: false,
          nextPage: null,
          results: Array.from({ length: 12 }, (_, index) => {
            const ordinal = index + 1
            const mediaId = `BV1POINTER${String(ordinal).padStart(2, '0')}`
            return {
              source: provider,
              kind: 'video' as const,
              mediaId,
              bvid: mediaId,
              episodeId: null,
              url: `https://example.com/${mediaId}`,
              canonicalUrl: `https://example.com/${mediaId}`,
              title: `${query} 第 ${ordinal} 条`,
              description: '',
              coverUrl: null,
              thumbnailPath: null,
              author: '拖动测试',
              duration: '01:00',
              publishedAt: '',
              tags: [query],
            }
          }),
        }),
      },
    })
  })

  await page.locator('.discoverySourceFilters button').filter({
    hasText: 'B站',
  }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click()
  })
  await page.getByLabel('搜索视频片段或关键帧').fill('鼠标拖动')
  await page.getByRole('button', { name: '开始搜索' }).click()

  const discoveryView = page.locator('.discoveryView')
  await expect(discoveryView).toHaveAttribute(
    'data-result-pointer-drag-enabled',
    'true',
  )
  const selectedHit = page.locator(
    '.discoveryResultCard.selected .discoveryResultHit',
  )
  await expect(selectedHit).toBeVisible()
  const initialId = await selectedHit.getAttribute('data-discovery-result-id')
  const box = await selectedHit.boundingBox()
  expect(box).not.toBeNull()

  await page.mouse.move(
    box!.x + box!.width / 2,
    box!.y + box!.height / 2,
  )
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(
    box!.x + box!.width / 2 - 72,
    box!.y + box!.height / 2,
    { steps: 6 },
  )
  await expect(discoveryView).toHaveClass(/isResultPointerDragging/)
  await page.mouse.up({ button: 'left' })

  await expect(discoveryView).not.toHaveClass(/isResultPointerDragging/)
  await expect(selectedHit).not.toHaveAttribute(
    'data-discovery-result-id',
    initialId ?? '',
  )
})
