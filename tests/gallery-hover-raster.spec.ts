import { expect, test } from '@playwright/test'

test('keeps homepage card raster content unchanged while hovered', async ({
  page,
}) => {
  await page.goto('/')

  const card = page.locator('.projectCard[data-card-active="true"]')
  const hitTarget = page.locator(
    '.projectHitTarget[data-card-active="true"]',
  )
  await expect(card).toBeVisible()
  await expect(hitTarget).toBeVisible()

  const readRasterState = () =>
    card.evaluate((element) => {
      const image = element.querySelector<HTMLElement>('.cardImage')!
      const frame = element.querySelector<HTMLElement>('.cardFrame')!
      const light = element.querySelector<HTMLElement>('.cardLight')!
      const raster = element.querySelector<HTMLElement>(
        '.projectCardRasterSurface',
      )!
      const cardStyle = getComputedStyle(element)

      return {
        cover: getComputedStyle(image).backgroundImage,
        imageFilter: getComputedStyle(image).filter,
        frameFilter: getComputedStyle(frame).filter,
        lightFilter: getComputedStyle(light).filter,
        rasterTransform: getComputedStyle(raster).transform,
        hoverLift: cardStyle.translate,
      }
    })

  const before = await readRasterState()
  await hitTarget.hover()
  await expect(card).toHaveClass(/isHitHovered/)
  await page.waitForTimeout(260)
  const after = await readRasterState()

  expect(after.cover).toBe(before.cover)
  expect(after.imageFilter).toBe(before.imageFilter)
  expect(after.frameFilter).toBe(before.frameFilter)
  expect(after.lightFilter).toBe(before.lightFilter)
  expect(after.rasterTransform).toBe(before.rasterTransform)
  expect(after.imageFilter).not.toContain('drop-shadow')
  expect(after.frameFilter).not.toContain('drop-shadow')
  expect(after.hoverLift).not.toBe(before.hoverLift)
})
