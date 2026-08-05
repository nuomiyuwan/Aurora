import path from 'node:path'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(
    page.getByRole('complementary', { name: '主页页面设置' }),
  ).toBeVisible()
})

test('offers the retained dot plus five image presets without adding nested glass', async ({
  page,
}) => {
  const presets = page.getByRole('group', { name: '粒子素材预设' })
  await expect(presets.getByRole('button')).toHaveCount(6)
  await expect(presets.getByRole('button')).toHaveText([
    '圆点',
    '尘埃',
    '竹叶',
    '树叶',
    '雪花',
    '枫叶',
  ])

  await presets.getByRole('button', { name: '竹叶' }).click()
  await expect(page.locator('.ambientParticleLayer')).toHaveAttribute(
    'data-particle-shape',
    'bamboo-leaf',
  )

  const nestedBackdropOwners = await page
    .locator('#page-settings-panel .pageSettingsParticlePresetGrid button')
    .evaluateAll((elements) =>
      elements.filter((element) => {
        const style = getComputedStyle(element)
        const backdrop =
          style.getPropertyValue('backdrop-filter') ||
          style.getPropertyValue('-webkit-backdrop-filter')
        return Boolean(backdrop && backdrop !== 'none')
      }).length,
    )
  expect(nestedBackdropOwners).toBe(0)
})

test('imports a transparent PNG, keeps it selectable, and exposes rotation control', async ({
  page,
}) => {
  const particleInput = page.locator(
    'input[type="file"][accept*="image/png"][accept*="video/webm"]',
  )
  await particleInput.setInputFiles(
    path.resolve(process.cwd(), 'public/aurora/particles/dust.png'),
  )

  await expect(page.locator('.ambientParticleLayer')).toHaveAttribute(
    'data-particle-shape',
    'custom',
  )
  await expect(page.getByText('dust.png', { exact: true })).toBeVisible()

  const rotation = page
    .getByText('旋转速率', { exact: true })
    .locator('..')
    .locator('input[type="range"]')
  await rotation.evaluate((element) => {
    const input = element as HTMLInputElement
    input.value = '-1.2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(
    page.locator('.ambientParticleLayer .ambientParticleVisual').first(),
  ).toHaveCSS('animation-direction', 'reverse')

  await page.getByRole('button', { name: '雪花' }).click()
  await expect(page.locator('.ambientParticleLayer')).toHaveAttribute(
    'data-particle-shape',
    'snowflake',
  )
  await page.getByRole('button', { name: /dust\.png/ }).click()
  await expect(page.locator('.ambientParticleLayer')).toHaveAttribute(
    'data-particle-shape',
    'custom',
  )
})
