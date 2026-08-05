import { expect, test } from '@playwright/test'

const solidSvg = (color: string) =>
  [
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">',
    `<rect width="2" height="2" fill="${color}"/>`,
    '</svg>',
  ].join('')

test('reloads a background paint when its explicit resource revision changes', async ({
  page,
}) => {
  const versionedRequests: string[] = []
  await page.route('**/reflection-revision-source.svg*', async (route) => {
    const url = new URL(route.request().url())
    const revision = url.searchParams.get('aurora-reflection-revision')
    if (revision) versionedRequests.push(revision)
    const color =
      revision && new Set(versionedRequests).size > 1 ? '#0044ff' : '#ff2200'
    await route.fulfill({
      body: solidSvg(color),
      contentType: 'image/svg+xml',
      headers: { 'Cache-Control': 'no-store' },
    })
  })

  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { captureDomReflectionElement } = await import(
      '/src/features/video-library/drawVideoDomReflectionTexture.ts'
    )
    const source = document.createElement('div')
    source.style.width = '16px'
    source.style.height = '16px'
    source.style.backgroundImage = 'url("/reflection-revision-source.svg")'
    source.style.backgroundPosition = 'center'
    source.style.backgroundRepeat = 'no-repeat'
    source.style.backgroundSize = 'cover'
    document.body.append(source)

    const sample = async (resourceRevision: string) => {
      const canvas = await captureDomReflectionElement(source, 16, {
        resourceRevision,
      })
      const context = canvas.getContext('2d')
      if (!context) throw new Error('2D canvas is unavailable')
      return [...context.getImageData(8, 8, 1, 1).data]
    }

    const first = await sample('cover-revision-a')
    const repeated = await sample('cover-revision-a')
    const changed = await sample('cover-revision-b')
    source.remove()
    return { changed, first, repeated }
  })

  expect(result.first).toEqual(result.repeated)
  expect(result.first[0]).toBeGreaterThan(200)
  expect(result.first[2]).toBeLessThan(80)
  expect(result.changed[0]).toBeLessThan(80)
  expect(result.changed[2]).toBeGreaterThan(200)
  expect(versionedRequests).toHaveLength(2)
  expect(new Set(versionedRequests).size).toBe(2)
})

test('removes rejected background paint promises so the same revision can retry', async ({
  page,
}) => {
  let versionedAttempts = 0
  await page.route('**/reflection-retry-source.svg*', async (route) => {
    const url = new URL(route.request().url())
    if (!url.searchParams.has('aurora-reflection-revision')) {
      await route.fulfill({
        body: solidSvg('#22cc66'),
        contentType: 'image/svg+xml',
        headers: { 'Cache-Control': 'no-store' },
      })
      return
    }

    versionedAttempts += 1
    await route.fulfill({
      body:
        versionedAttempts === 1
          ? '<svg xmlns="http://www.w3.org/2000/svg"><broken'
          : solidSvg('#22cc66'),
      contentType: 'image/svg+xml',
      headers: { 'Cache-Control': 'no-store' },
    })
  })

  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { captureDomReflectionElement } = await import(
      '/src/features/video-library/drawVideoDomReflectionTexture.ts'
    )
    const source = document.createElement('div')
    source.style.width = '16px'
    source.style.height = '16px'
    source.style.backgroundImage = 'url("/reflection-retry-source.svg")'
    source.style.backgroundSize = 'cover'
    document.body.append(source)

    const capture = () =>
      captureDomReflectionElement(source, 16, {
        resourceRevision: 'retry-same-revision',
      })
    const firstFailed = await capture().then(
      () => false,
      () => true,
    )
    const recovered = await capture()
    const context = recovered.getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable')
    const pixel = [...context.getImageData(8, 8, 1, 1).data]
    source.remove()
    return { firstFailed, pixel }
  })

  expect(result.firstFailed).toBe(true)
  expect(result.pixel[1]).toBeGreaterThan(150)
  expect(versionedAttempts).toBe(2)
})

test('removes failed embedded-resource entries but keeps a successful retry', async ({
  page,
}) => {
  let fetchAttempts = 0
  await page.route('**/reflection-embedded-filter.svg*', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      fetchAttempts += 1
      if (fetchAttempts === 1) {
        await route.fulfill({
          body: 'temporary failure',
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        })
        return
      }
    }
    await route.fulfill({
      body: [
        '<svg xmlns="http://www.w3.org/2000/svg">',
        '<filter id="soft"><feGaussianBlur stdDeviation="0"/></filter>',
        '</svg>',
      ].join(''),
      contentType: 'image/svg+xml',
      headers: { 'Cache-Control': 'no-store' },
    })
  })

  await page.goto('/')
  await page.evaluate(async () => {
    const { captureDomReflectionElement } = await import(
      '/src/features/video-library/drawVideoDomReflectionTexture.ts'
    )
    const source = document.createElement('div')
    source.style.width = '16px'
    source.style.height = '16px'
    source.style.backgroundColor = '#ffffff'
    source.style.filter =
      'url("/reflection-embedded-filter.svg#soft")'
    document.body.append(source)

    const capture = () =>
      captureDomReflectionElement(source, 16, {
        resourceRevision: 'embedded-retry-revision',
      })
    await capture()
    await capture()
    await capture()
    source.remove()
  })

  expect(fetchAttempts).toBe(2)
})
