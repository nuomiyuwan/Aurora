import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

type ReflectionSnapshot = {
  sourceSignature: string | null
  projectionSignature: string | null
  reflectionSize: string | null
}

const readSettledReflection = async (
  page: Page,
): Promise<ReflectionSnapshot> => {
  const canvas = page.locator('canvas[data-aurora-renderer="reflection"]')
  await expect(canvas).toHaveAttribute('data-reflection-ready', 'true')
  await expect(canvas).toHaveAttribute('data-render-state', 'idle', { timeout: 5_000 })
  return {
    sourceSignature: await canvas.getAttribute('data-source-signature'),
    projectionSignature: await canvas.getAttribute('data-projection-signature'),
    reflectionSize: await canvas.getAttribute('data-reflection-size'),
  }
}

test('relocks the gallery floor after a live fullscreen-sized viewport change', async ({ page }) => {
  await page.setViewportSize({ width: 1706, height: 956 })
  await page.goto('/')
  await page.mouse.move(0, 0)
  await readSettledReflection(page)

  await page.setViewportSize({ width: 2048, height: 1152 })
  await page.mouse.move(0, 0)
  const resized = await readSettledReflection(page)

  await page.reload()
  await page.mouse.move(0, 0)
  const refreshed = await readSettledReflection(page)

  expect(resized).toEqual(refreshed)
})
