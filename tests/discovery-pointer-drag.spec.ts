import { expect, test, type Page } from '@playwright/test'

async function prepareDiscoveryResults(page: Page) {
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
  return discoveryView
}

test('left-button drag follows the Discovery corridor and snaps on release', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const discoveryView = await prepareDiscoveryResults(page)
  const selectedHit = page.locator(
    '.discoveryResultCard.selected .discoveryResultHit',
  )
  await expect(selectedHit).toBeVisible()
  const initialId = await selectedHit.getAttribute('data-discovery-result-id')
  const followingCard = page.locator('.discoveryResultCard').nth(1)
  const box = await selectedHit.boundingBox()
  const followingBox = await followingCard.boundingBox()
  expect(box).not.toBeNull()
  expect(followingBox).not.toBeNull()

  await page.mouse.move(
    box!.x + box!.width / 2,
    box!.y + box!.height / 2,
  )
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(
    box!.x + box!.width / 2 - 96,
    box!.y + box!.height / 2,
    { steps: 6 },
  )
  await expect(discoveryView).toHaveClass(/isResultPointerDragging/)
  const followingDragBox = await followingCard.boundingBox()
  expect(followingDragBox).not.toBeNull()
  expect(followingDragBox!.x).toBeLessThan(followingBox!.x)
  await page.mouse.up({ button: 'left' })

  await expect(discoveryView).not.toHaveClass(/isResultPointerDragging/)
  await expect(selectedHit).not.toHaveAttribute(
    'data-discovery-result-id',
    initialId ?? '',
  )
})

test('macOS-style two-finger scrolling follows the gesture direction', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await prepareDiscoveryResults(page)
  const selectedCard = page.locator('.discoveryResultCard.selected')
  const selectedHit = selectedCard.locator('.discoveryResultHit')
  const followingCard = page.locator('.discoveryResultCard').nth(1)
  const corridorCards = page.locator('.discoveryResultCards')
  const initialId = await selectedHit.getAttribute('data-discovery-result-id')
  const initialBox = await selectedCard.boundingBox()
  const followingBox = await followingCard.boundingBox()
  expect(initialBox).not.toBeNull()
  expect(followingBox).not.toBeNull()

  await page.mouse.move(
    initialBox!.x + initialBox!.width / 2,
    initialBox!.y + initialBox!.height / 2,
  )
  await page.mouse.wheel(96, 0)
  await expect(corridorCards).toHaveClass(/isCorridorMoving/)
  await expect
    .poll(async () => (await followingCard.boundingBox())?.x ?? Infinity)
    .toBeLessThan(followingBox!.x - 4)
  await expect(corridorCards).not.toHaveClass(/isCorridorMoving/)
  await expect(selectedHit).not.toHaveAttribute(
    'data-discovery-result-id',
    initialId ?? '',
  )
})

test('two-finger navigation stops only after the final result reaches the primary slot', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await prepareDiscoveryResults(page)
  const selectedCard = page.locator('.discoveryResultCard.selected')
  const selectedHit = selectedCard.locator('.discoveryResultHit')
  const selectedTitle = selectedCard.locator('.discoveryCardCaption strong')
  const box = await selectedCard.boundingBox()
  expect(box).not.toBeNull()

  await page.mouse.move(
    box!.x + box!.width / 2,
    box!.y + box!.height / 2,
  )
  for (let ordinal = 2; ordinal <= 12; ordinal += 1) {
    await page.mouse.wheel(96, 0)
    await expect(selectedTitle).toHaveText(`鼠标拖动 第 ${ordinal} 条`)
  }

  const finalId = await selectedHit.getAttribute('data-discovery-result-id')
  await page.mouse.wheel(192, 0)
  await expect(selectedHit).toHaveAttribute(
    'data-discovery-result-id',
    finalId ?? '',
  )
  await expect(selectedTitle).toHaveText('鼠标拖动 第 12 条')
})
