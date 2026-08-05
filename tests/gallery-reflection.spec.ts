import { expect, test } from '@playwright/test'

test('replaces DOM copies with one noninteractive reflection renderer', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.projectCard')).toHaveCount(5)
  await expect(
    page.locator('.projectHitTarget:not([aria-hidden="true"])'),
  ).toHaveCount(5)
  await expect(page.locator('.cardReflection, .cardReflectionSurface')).toHaveCount(0)
  const canvas = page.locator('canvas[data-aurora-renderer="reflection"]')
  await expect(canvas).toHaveCount(1)
  await expect(canvas).toHaveCSS('pointer-events', 'none')
  await expect(canvas).toHaveAttribute('data-renderer-count', '1')
  await expect(canvas).toHaveAttribute('data-reflection-targets', '1')
  await expect(canvas).toHaveAttribute('data-card-source', 'full')
  await expect(canvas).toHaveAttribute('data-reflection-ready', 'true')
  await expect(canvas).toHaveAttribute('data-source-count', '5')
  await expect(canvas).toHaveAttribute('data-visible-source-count', '5')
  await expect(canvas).toHaveAttribute('data-texture-count', '5')
  await expect(canvas).toHaveAttribute(
    'data-reflection-source-count',
    '5',
  )
  await expect(canvas).toHaveAttribute(
    'data-missing-texture-project-ids',
    '[]',
  )
  await expect(canvas).toHaveAttribute(
    'data-texture-error-project-ids',
    '[]',
  )
  await expect(canvas).toHaveAttribute(
    'data-reflection-content-ready',
    'true',
  )
  const revisions = await canvas.evaluate((element) => ({
    source: element.getAttribute('data-reflection-source-revision'),
    prepared: element.getAttribute('data-reflection-prepared-revision'),
    rendered: element.getAttribute('data-reflection-rendered-revision'),
  }))
  expect(revisions.source).not.toBe('')
  expect(revisions.prepared).toBe(revisions.source)
  expect(revisions.rendered).toBe(revisions.source)
})

test('reports context loss without rendering and wakes after restoration', async ({ page }) => {
  await page.goto('/')

  const canvas = page.locator('canvas[data-aurora-renderer="reflection"]')
  await expect(canvas).toHaveAttribute('data-reflection-ready', 'true')
  await expect(canvas).toHaveAttribute('data-render-state', 'idle')
  const renderCountBeforeLoss = Number(
    await canvas.getAttribute('data-reflection-render-count'),
  )

  const lossWasCanceled = await canvas.evaluate((element) => {
    const event = new Event('webglcontextlost', { cancelable: true })
    const dispatched = element.dispatchEvent(event)
    return !dispatched && event.defaultPrevented
  })

  expect(lossWasCanceled).toBe(true)
  await expect(canvas).toHaveAttribute('data-context-lost', 'true', { timeout: 1000 })
  await expect(canvas).toHaveAttribute('data-render-state', 'idle')
  expect(Number(await canvas.getAttribute('data-reflection-render-count'))).toBe(
    renderCountBeforeLoss,
  )

  await canvas.dispatchEvent('webglcontextrestored')

  await expect(canvas).toHaveAttribute('data-context-lost', 'false', { timeout: 1000 })
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute('data-reflection-render-count')),
    )
    .toBeGreaterThan(renderCountBeforeLoss)
  await expect(canvas).toHaveAttribute('data-render-state', 'idle')
})

test('prepares a newly added sixth project before declaring the gallery complete', async ({
  page,
}) => {
  await page.goto('/')

  const canvas = page.locator('canvas[data-aurora-renderer="reflection"]')
  await expect(canvas).toHaveAttribute('data-reflection-content-ready', 'true')
  const initialRevision = await canvas.getAttribute(
    'data-reflection-source-revision',
  )

  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: '新建项目' })
  await createDialog
    .locator('input[name="projectName"]')
    .fill('第六项目倒影回归')
  await createDialog.getByRole('button', {
    name: '创建项目',
    exact: true,
  }).click()
  await expect(
    page.getByRole('dialog', { name: '第六项目倒影回归 尚未导入素材' }),
  ).toHaveCount(0)

  await expect(
    page.locator('.projectCard[data-project-id^="project-"]'),
  ).toHaveCount(1)
  await expect(canvas).toHaveAttribute('data-source-count', '5')
  await expect(canvas).toHaveAttribute('data-visible-source-count', '5')
  await expect(canvas).toHaveAttribute(
    'data-missing-texture-project-ids',
    '[]',
  )
  await expect(canvas).toHaveAttribute(
    'data-texture-error-project-ids',
    '[]',
  )
  await expect(canvas).toHaveAttribute(
    'data-reflection-content-ready',
    'true',
  )

  const revisions = await canvas.evaluate((element) => ({
    source: element.getAttribute('data-reflection-source-revision'),
    prepared: element.getAttribute('data-reflection-prepared-revision'),
    rendered: element.getAttribute('data-reflection-rendered-revision'),
  }))
  expect(revisions.source).not.toBe(initialRevision)
  expect(revisions.prepared).toBe(revisions.source)
  expect(revisions.rendered).toBe(revisions.source)
})
