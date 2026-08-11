import { expect, test } from '@playwright/test'

async function dispatchVerticalWheelBurst(
  target: import('@playwright/test').Locator,
  deltaY: number,
) {
  await target.evaluate((element, delta) => {
    for (let index = 0; index < 5; index += 1) {
      element.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaMode: 0,
        deltaY: delta,
      }))
    }
  }, deltaY)
}

test('switches exactly one homepage project for each vertical wheel gesture', async ({
  page,
}) => {
  await page.goto('/')

  const activeCard = page.locator('.projectCard[data-card-active="true"]')
  const activeHitTarget = page.locator(
    '.projectHitTarget[data-card-active="true"]',
  )
  await expect(activeCard).toHaveAttribute('data-project-id', 'ring')

  await dispatchVerticalWheelBurst(activeHitTarget, 120)
  await expect(activeCard).toHaveAttribute('data-project-id', 'woods')

  await dispatchVerticalWheelBurst(activeHitTarget, -120)
  await expect(activeCard).toHaveAttribute('data-project-id', 'ring')
})
