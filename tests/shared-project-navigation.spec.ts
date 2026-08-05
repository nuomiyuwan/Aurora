import { expect, test } from '@playwright/test'
import { projects } from '../src/data/projects'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('region', { name: '项目轮播' })).toBeVisible()
  await page.waitForTimeout(1_100)
})

test('opens the current main project from the grid nav and keeps one sidebar geometry', async ({ page }) => {
  const mainNav = page.getByRole('complementary', { name: '主导航' })
  const homeDock = await mainNav.boundingBox()

  await mainNav.getByRole('button', { name: '项目详情' }).click()

  await expect(page.locator('.videoLibraryHeader h1')).toHaveText('极境之环')
  await expect(mainNav.getByRole('button', { name: '项目详情' })).toHaveClass(/active/)
  const detailDock = await mainNav.boundingBox()

  expect(homeDock).not.toBeNull()
  expect(detailDock).not.toBeNull()
  expect(detailDock?.x).toBeCloseTo(homeDock?.x ?? 0, 4)
  expect(detailDock?.y).toBeCloseTo(homeDock?.y ?? 0, 4)
  expect(detailDock?.width).toBeCloseTo(homeDock?.width ?? 0, 4)
  expect(detailDock?.height).toBeCloseTo(homeDock?.height ?? 0, 4)
})

test('keeps five covered default project shells with empty import-ready details', async ({ page }) => {
  const mainNav = page.getByRole('complementary', { name: '主导航' })

  for (const project of projects) {
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '搜索项目' })
    await dialog.getByPlaceholder('搜索项目名称').fill(project.title)
    const result = dialog.getByRole('button').filter({ hasText: project.title })
    await expect(result).toHaveCount(1)
    await result.click()

    await expect(page.locator('.videoLibraryHeader h1')).toHaveText(project.title)
    await expect(page.locator('.videoClipCard')).toHaveCount(0)
    await expect(page.locator('.clipDetailPanel')).toHaveCount(0)
    await expect(page.locator('.videoProjectEmptyState')).toBeVisible()
    await expect(
      page.getByRole('button', { name: '导入视频素材' }),
    ).toBeVisible()

    await mainNav.getByRole('button', { name: '项目库', exact: true }).click()
  }
})

test('keeps card copy in the exact 3D cover transform and gives particles broad motion variance', async ({ page }) => {
  await expect(page.locator('.projectCard .cardCopy')).toHaveCount(projects.length)
  await expect(page.locator('.projectCopyPlane, .cardCopyOverlay')).toHaveCount(0)
  await expect(page.locator('.cardStatusOverlay, .cardMenuOverlay')).toHaveCount(0)
  expect(
    await page.locator('.projectCard').evaluateAll((elements) =>
      elements.every((element) => /matrix3d|matrix/.test(getComputedStyle(element).transform)),
    ),
  ).toBe(true)

  const particleMotion = await page.locator('.ambientParticleLayer i').evaluateAll((particles) =>
    particles.map((particle) => {
      const style = getComputedStyle(particle)
      const trail = getComputedStyle(particle, '::after')
      return {
        duration: Number.parseFloat(style.animationDuration),
        offsetPath: style.offsetPath,
        trailWidth: Number.parseFloat(trail.width),
        trailFilter: trail.filter,
      }
    }),
  )
  const durations = particleMotion.map(({ duration }) => duration)

  expect(particleMotion.length).toBeGreaterThan(0)
  expect(
    new Set(durations.map((duration) => duration.toFixed(3))).size,
  ).toBeGreaterThan(particleMotion.length * 0.8)
  expect(Math.max(...durations) / Math.min(...durations)).toBeGreaterThan(2.2)
  expect(particleMotion.every(({ offsetPath }) => offsetPath.startsWith('path('))).toBe(true)
  expect(particleMotion.some(({ trailWidth }) => trailWidth > 0)).toBe(true)
  expect(particleMotion.some(({ trailFilter }) => trailFilter.includes('blur'))).toBe(true)
})

test('keeps a visible cover through the entire project-card handoff', async ({ page }) => {
  const samples = await page.evaluate(async () => {
    const readCard = (projectId: string) => {
      const card = document.querySelector<HTMLElement>(`.projectCard[data-project-id="${projectId}"]`)
      if (!card) return null
      const style = getComputedStyle(card)
      const matrix = new DOMMatrixReadOnly(style.transform)
      return {
        depth: matrix.m43,
        width: card.getBoundingClientRect().width,
        opacity: Number.parseFloat(style.opacity),
      }
    }
    const next = document.querySelector<HTMLElement>('.projectCard[data-project-id="woods"]')
    next?.click()

    const frames: Array<{
      ring: ReturnType<typeof readCard>
      woods: ReturnType<typeof readCard>
      uniqueKeys: boolean
    }> = []
    for (let frame = 0; frame < 42; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const keys = [...document.querySelectorAll<HTMLElement>('.projectCard')].map(
        (card) => card.dataset.carouselKey,
      )
      frames.push({
        ring: readCard('ring'),
        woods: readCard('woods'),
        uniqueKeys: new Set(keys).size === keys.length,
      })
    }
    return frames
  })

  expect(samples.every(({ uniqueKeys }) => uniqueKeys)).toBe(true)
  expect(
    samples.every(
      ({ ring, woods }) => (ring?.opacity ?? 0) > 0.05 || (woods?.opacity ?? 0) > 0.05,
    ),
  ).toBe(true)
  expect(samples.some(({ woods }) => (woods?.opacity ?? 0) > 0.5)).toBe(true)
})
