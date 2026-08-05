import { expect, test } from '@playwright/test'

test('restores a reflection surface from a URL and reuses its stable cache key', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const reflection = await import(
      '/src/features/reflection/createBackgroundReflectionSurface.ts'
    )
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    for (let y = 0; y < canvas.height; y += 8) {
      for (let x = 0; x < canvas.width; x += 8) {
        const shade = (x / 8 + y / 8) % 2 === 0 ? 32 : 224
        context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`
        context.fillRect(x, y, 8, 8)
      }
    }

    const cacheKey = `restored-image-${crypto.randomUUID()}`
    const first = await reflection.createBackgroundReflectionSurfaceFromUrl(
      {
        url: canvas.toDataURL('image/png'),
        name: 'restored-background.png',
        cacheKey,
      },
      'image',
    )
    const second = await reflection.createBackgroundReflectionSurfaceFromUrl(
      {
        url: 'invalid://the-cache-hit-must-not-decode-this-url',
        name: 'moved-background.png',
        cacheKey,
      },
      'image',
    )

    reflection.disposeBackgroundReflectionSurfaceWorker()
    return {
      sameObject: first === second,
      key: first.key,
      width: first.width,
      height: first.height,
      pixels: first.pixels.byteLength,
    }
  })

  expect(result.sameObject).toBe(true)
  expect(result.key).toContain(':image:url:restored-image-')
  expect(result.width).toBe(1024)
  expect(result.height).toBe(576)
  expect(result.pixels).toBe(1024 * 576 * 4)
})

test('samples a managed video URL without fetching the whole file into JavaScript', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const reflection = await import(
      '/src/features/reflection/createBackgroundReflectionSurface.ts'
    )
    const originalFetch = window.fetch
    const fetchedUrls: string[] = []
    window.fetch = (...args) => {
      const input = args[0]
      fetchedUrls.push(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      )
      return originalFetch(...args)
    }

    try {
      const surface = await reflection.createBackgroundReflectionSurfaceFromUrl(
        {
          url: new URL(
            '/aurora/startup-ice-valley-v1.webm',
            document.baseURI,
          ).href,
          name: 'startup-ice-valley-v1.webm',
          cacheKey: `restored-video-${crypto.randomUUID()}`,
        },
        'video',
      )
      return {
        fetchedUrls,
        width: surface.width,
        height: surface.height,
      }
    } finally {
      window.fetch = originalFetch
      reflection.disposeBackgroundReflectionSurfaceWorker()
    }
  })

  expect(
    result.fetchedUrls.some((url) =>
      url.includes('/aurora/startup-ice-valley-v1.webm'),
    ),
  ).toBe(false)
  expect(result.width).toBe(1024)
  expect(result.height).toBe(576)
})
