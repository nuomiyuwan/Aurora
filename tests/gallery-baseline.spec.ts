import { expect, test } from '@playwright/test'

test('keeps the 5174 DOM gallery as the default visual baseline', async ({ page }, testInfo) => {
  await page.goto('/')

  await expect(page.locator('.projectCard')).toHaveCount(5)
  await expect(page.locator('.projectHitTarget:not([aria-hidden="true"])')).toHaveCount(5)
  const brandHeader = page.locator('.brandHeader')
  await expect(brandHeader).toBeVisible()
  await expect(brandHeader).toHaveAccessibleName('Aurora')
  await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeVisible()
  await expect(page.locator('canvas[data-aurora-renderer="v2"]')).toHaveCount(0)

  const metrics = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'))
    return {
      domElements: all.length,
      canvases: document.querySelectorAll('canvas').length,
      projectCards: document.querySelectorAll('.projectCard').length,
      filteredElements: all.filter((element) => getComputedStyle(element).filter !== 'none').length,
      backdropFilteredElements: all.filter((element) => {
        const style = getComputedStyle(element)
        const value = style.getPropertyValue('backdrop-filter') || style.getPropertyValue('-webkit-backdrop-filter')
        return Boolean(value && value !== 'none')
      }).length,
    }
  })

  await testInfo.attach('gallery-baseline-metrics', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  })
  await page.screenshot({ path: testInfo.outputPath('gallery-baseline.png') })
})

test('locks the live 5174 foreground', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await page.goto('/')

  await expect(page.locator('.projectCard')).toHaveCount(5)
  await expect(page.locator('.projectHitTarget:not([aria-hidden="true"])')).toHaveCount(5)

  const foreground = await page.locator('.projectCard').evaluateAll((cards) =>
    cards.map((card) => {
      const element = card as HTMLElement
      const style = element.style
      const rasterSurface = element.querySelector('.projectCardRasterSurface')!
      return {
        active: element.dataset.cardActive,
        left: style.getPropertyValue('--card-left'),
        top: style.getPropertyValue('--card-top'),
        width: style.getPropertyValue('--card-width'),
        rotate: style.getPropertyValue('--card-rotate'),
        depth: style.getPropertyValue('--card-depth'),
        layers: Array.from(rasterSurface.children)
          .filter((child) => !child.classList.contains('cardReflection'))
          .map((child) => child.className),
      }
    }),
  )

  expect(foreground.map(({ active }) => active)).toEqual([
    'false',
    'false',
    'true',
    'false',
    'false',
  ])
  expect(foreground.map(({ rotate }) => rotate)).toEqual([
    '50deg',
    '45deg',
    '30deg',
    '-30deg',
    '-35deg',
  ])
  const expectedLayers = [
    'projectGlassAnchor projectGlassAnchorTopLeft',
    'projectGlassAnchor projectGlassAnchorTopRight',
    'projectGlassAnchor projectGlassAnchorBottomRight',
    'projectGlassAnchor projectGlassAnchorBottomLeft',
    'cardLight',
    'cardImage',
    'cardFrame',
    'cardCopy',
    'projectCardMenuControl',
  ]
  expect(foreground.every(({ layers }) =>
    JSON.stringify(layers) === JSON.stringify(expectedLayers),
  )).toBe(true)

  const lefts = foreground.map(({ left }) => Number.parseFloat(left))
  const widths = foreground.map(({ width }) => Number.parseFloat(width))
  const depths = foreground.map(({ depth }) => Number.parseFloat(depth))
  expect(lefts).toEqual([...lefts].sort((left, right) => left - right))
  expect(widths[2]).toBe(Math.max(...widths))
  expect(depths[2]).toBe(Math.max(...depths))

  await expect(page.locator('.projectStage > .newProjectCard')).toHaveCount(0)

  const groundedBottoms = await page.locator('.projectCard').evaluateAll(
    (cards, alphaBottom) =>
      cards.map((card) => {
        const style = getComputedStyle(card)
        const top = Number.parseFloat(style.top)
        const height = Number.parseFloat(style.height)
        const renderScale = Number.parseFloat(
          style.getPropertyValue('--card-render-scale'),
        )
        return top + renderScale * height * (alphaBottom - 0.5)
      }),
    974 / 1080,
  )
  expect(Math.max(...groundedBottoms) - Math.min(...groundedBottoms)).toBeLessThan(0.01)
})

test('exposes the unchanged shared project data for both renderers', async ({ page }) => {
  await page.goto('/')

  const projectData = await page.evaluate(async () => {
    const module = await import('/src/data/projects.ts')
    return {
      titles: module.projects.map((project) => project.title),
      covers: module.projects.map((project) => project.cover),
      counts: module.projects.map((project) => ({
        video: project.videoCount,
        material: project.collectionCount,
      })),
      defaultActiveProjectId: module.DEFAULT_ACTIVE_PROJECT_ID,
    }
  })

  expect(projectData).toEqual({
    titles: ['冰川纪元', '远山之城', '极境之环', '林间絮语', '新境前线'],
    covers: [
      './aurora/project-glacier-age.png',
      './aurora/project-distant-city.png',
      './aurora/project-ring-of-horizon.png',
      './aurora/project-whisper-woods.png',
      './aurora/project-new-frontier.png',
    ],
    counts: Array.from({ length: 5 }, () => ({
      video: 0,
      material: 0,
    })),
    defaultActiveProjectId: 'ring',
  })
})
