import { expect, test } from '@playwright/test'

async function openFrameRing(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '极境之环 打开项目', exact: true }).click()
  await expect(page.getByRole('region', { name: '极境之环 视频片段库' })).toBeVisible()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '打开帧环浏览' }).click()
  await expect(page.getByRole('region', { name: 'A001_C012.mov 帧环浏览' })).toBeVisible()
}

test('opens the selected clip and keeps the resting center frame exactly front-facing', async ({ page }) => {
  await openFrameRing(page)

  const cards = page.locator('.frameRingStage .frameRingCard')
  const selected = page.locator('.frameRingStage .frameRingCard.selected')
  await expect(cards).toHaveCount(13)
  await expect(selected).toHaveCount(1)
  await expect(selected).toHaveAttribute('data-frame-offset', '0.000')
  await expect(selected).toHaveAttribute('data-frame-rotation', '0.000')
  await expect(selected).toHaveAttribute('data-frame-ordinal', '7')
  const frameTotal = await selected.getAttribute('data-frame-total')
  expect(Number(frameTotal)).toBeGreaterThan(7)
  const indexReadout = page.locator('.frameRingIndexReadout')
  await expect(indexReadout).toHaveCount(1)
  await expect(indexReadout).toHaveAttribute('data-frame-ordinal', '7')
  await expect(indexReadout).toHaveAttribute('data-frame-total', frameTotal ?? '')
  await expect(indexReadout).toHaveText(
    `索引帧${'7'.padStart(frameTotal?.length ?? 1, '0')} / ${frameTotal}`,
  )
  await expect(selected.locator('.frameRingIndexReadout')).toHaveCount(0)

  const selectedId = await selected.getAttribute('data-frame-id')
  await expect(page.locator('.frameRingPreview')).toHaveAttribute('data-frame-id', selectedId ?? '')
})

test('drags through real frame bounds and snaps the incoming center card back to zero rotation', async ({ page }) => {
  await openFrameRing(page)

  const stage = page.locator('.frameRingStage')
  const selected = page.locator('.frameRingStage .frameRingCard.selected')
  const dragCard = page.locator('.frameRingStage .frameRingCard.selected')
  const indexReadout = page.locator('.frameRingIndexReadout')
  const initialId = await selected.getAttribute('data-frame-id')
  const initialOrdinal = await indexReadout.getAttribute('data-frame-ordinal')
  const initialReadoutBox = await indexReadout.boundingBox()
  await stage.evaluate((element) => {
    element.setPointerCapture = () => undefined
    element.releasePointerCapture = () => undefined
    element.hasPointerCapture = () => false
  })

  await dragCard.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 7,
    clientX: 980,
    clientY: 760,
  })
  await dragCard.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 7,
    clientX: 720,
    clientY: 760,
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
  await expect(stage).toHaveClass(/isDragging/)
  await expect(indexReadout).not.toHaveAttribute('data-frame-ordinal', initialOrdinal ?? '')
  const draggingReadoutBox = await indexReadout.boundingBox()
  expect(draggingReadoutBox?.x).toBeCloseTo(initialReadoutBox?.x ?? 0, 0)
  expect(draggingReadoutBox?.y).toBeCloseTo(initialReadoutBox?.y ?? 0, 0)
  await dragCard.dispatchEvent('pointerup', {
    button: 0,
    pointerId: 7,
    clientX: 720,
    clientY: 760,
  })
  await expect(stage).toHaveClass(/isSettling/)
  await page.waitForTimeout(540)

  await expect(selected).not.toHaveAttribute('data-frame-id', initialId ?? '')
  await expect(selected).toHaveAttribute('data-frame-offset', '0.000')
  await expect(selected).toHaveAttribute('data-frame-rotation', '0.000')
})

test('prewarms the directional reflection halo and keeps every sampled source textured while dragging', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await openFrameRing(page)

  const canvas = page.locator('.frameRingReflectionCanvas')
  const preloadLayer = page.locator('.frameRingPreloadSourceLayer')
  const preloadCards = preloadLayer.locator('.frameRingPreloadSourceCard')
  await expect(preloadCards).toHaveCount(4)
  await expect(preloadCards.locator('[data-frame-reflection]')).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-reflection-preload-source-count', '4')
  await expect(canvas).toHaveAttribute('data-reflection-retained-source-count', '20')
  await expect(canvas).toHaveAttribute('data-reflection-texture-limit', '20')
  await expect(canvas).toHaveAttribute('data-reflection-preload-state', 'ready', {
    timeout: 30_000,
  })
  await expect(canvas).toHaveAttribute('data-reflection-preload-ready-count', '4')
  await expect(canvas).toHaveAttribute('data-visible-source-count', '14')

  await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement
    const runtime = window as typeof window & {
      __auroraReflectionMinimumVisibleCount?: number
      __auroraReflectionMinimumState?: {
        inactiveSourceIds: string
        missingSourceIds: string
        retainedSourceCount: number
        sampledSourceCount: number
        textureCount: number
        visibleSourceCount: number
      }
      __auroraReflectionMissingSourceHistory?: string[]
      __auroraReflectionObserver?: MutationObserver
    }
    runtime.__auroraReflectionMinimumVisibleCount = Number(
      canvasElement.dataset.visibleSourceCount ?? 0,
    )
    runtime.__auroraReflectionMinimumState = {
      inactiveSourceIds: canvasElement.dataset.reflectionInactiveSourceIds ?? '',
      missingSourceIds: canvasElement.dataset.reflectionMissingSourceIds ?? '',
      retainedSourceCount: Number(
        canvasElement.dataset.reflectionRetainedSourceCount ?? 0,
      ),
      sampledSourceCount: Number(
        canvasElement.dataset.reflectionSampledSourceCount ?? 0,
      ),
      textureCount: Number(canvasElement.dataset.textureCount ?? 0),
      visibleSourceCount: runtime.__auroraReflectionMinimumVisibleCount,
    }
    runtime.__auroraReflectionMissingSourceHistory = []
    runtime.__auroraReflectionObserver?.disconnect()
    runtime.__auroraReflectionObserver = new MutationObserver(() => {
      const missingSourceIds =
        canvasElement.dataset.reflectionMissingSourceIds ?? ''
      if (
        missingSourceIds &&
        !runtime.__auroraReflectionMissingSourceHistory?.includes(
          missingSourceIds,
        )
      ) {
        runtime.__auroraReflectionMissingSourceHistory?.push(missingSourceIds)
      }
      const visibleSourceCount = Number(
        canvasElement.dataset.visibleSourceCount ?? 0,
      )
      if (
        visibleSourceCount <
        (runtime.__auroraReflectionMinimumVisibleCount ??
          Number.POSITIVE_INFINITY)
      ) {
        runtime.__auroraReflectionMinimumVisibleCount = visibleSourceCount
        runtime.__auroraReflectionMinimumState = {
          inactiveSourceIds:
            canvasElement.dataset.reflectionInactiveSourceIds ?? '',
          missingSourceIds:
            canvasElement.dataset.reflectionMissingSourceIds ?? '',
          retainedSourceCount: Number(
            canvasElement.dataset.reflectionRetainedSourceCount ?? 0,
          ),
          sampledSourceCount: Number(
            canvasElement.dataset.reflectionSampledSourceCount ?? 0,
          ),
          textureCount: Number(canvasElement.dataset.textureCount ?? 0),
          visibleSourceCount,
        }
      }
    })
    runtime.__auroraReflectionObserver.observe(canvasElement, {
      attributes: true,
      attributeFilter: [
        'data-reflection-missing-source-ids',
        'data-visible-source-count',
      ],
    })
  })

  const stage = page.locator('.frameRingStage')
  const dragCard = page.locator('.frameRingStage .frameRingCard.selected')
  await stage.evaluate((element) => {
    element.setPointerCapture = () => undefined
    element.releasePointerCapture = () => undefined
    element.hasPointerCapture = () => false
  })
  await dragCard.dispatchEvent('pointerdown', {
    button: 0,
    pointerId: 19,
    clientX: 980,
    clientY: 760,
  })
  await dragCard.dispatchEvent('pointermove', {
    button: 0,
    pointerId: 19,
    clientX: 660,
    clientY: 760,
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
  await expect(stage).toHaveClass(/isDragging/)
  await dragCard.dispatchEvent('pointerup', {
    button: 0,
    pointerId: 19,
    clientX: 660,
    clientY: 760,
  })
  await expect(stage).toHaveClass(/isSettling/)
  await page.waitForTimeout(540)

  const minimumState = await page.evaluate(() => {
    const runtime = window as typeof window & {
      __auroraReflectionMinimumState?: {
        inactiveSourceIds: string
        missingSourceIds: string
        retainedSourceCount: number
        sampledSourceCount: number
        textureCount: number
        visibleSourceCount: number
      }
      __auroraReflectionMissingSourceHistory?: string[]
      __auroraReflectionObserver?: MutationObserver
    }
    runtime.__auroraReflectionObserver?.disconnect()
    return {
      minimumState: runtime.__auroraReflectionMinimumState,
      missingSourceHistory:
        runtime.__auroraReflectionMissingSourceHistory ?? [],
    }
  })
  expect(minimumState.missingSourceHistory).toEqual([])
  expect(minimumState.minimumState?.missingSourceIds).toBe('')
  expect(minimumState.minimumState?.sampledSourceCount).toBe(14)
  expect(minimumState.minimumState?.visibleSourceCount).toBeGreaterThanOrEqual(13)

  await expect(canvas).toHaveAttribute('data-reflection-preload-state', 'ready', {
    timeout: 30_000,
  })
  await expect
    .poll(async () => {
      const [textureCount, textureLimit, preloadReady, preloadCount] =
        await canvas.evaluate((element) => [
          Number(element.getAttribute('data-texture-count') ?? 0),
          Number(element.getAttribute('data-reflection-texture-limit') ?? 0),
          Number(element.getAttribute('data-reflection-preload-ready-count') ?? 0),
          Number(element.getAttribute('data-reflection-preload-source-count') ?? 0),
        ])
      return textureCount <= textureLimit && preloadReady === preloadCount
    })
    .toBe(true)
})
