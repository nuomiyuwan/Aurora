import { expect, test } from '@playwright/test'

test('only captures a stable paused frame and keeps playback frozen', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const {
      canCaptureFrameRingReflectionSnapshot,
      canUpdateFrameRingLiveReflection,
      FRAME_RING_REFLECTION_SNAPSHOT_RETRY_DELAYS_MS,
      getFrameRingReflectionSnapshotRetryDelay,
      getFrameRingVideoCrossOrigin,
    } = await import(
      '/src/features/frame-ring/frameRingLiveReflection.ts'
    )
    const lifecycle = {
      active: true,
      suspended: false,
      fullscreen: false,
      documentHidden: false,
    }
    const ready = {
      lifecycle,
      blocked: false,
      paused: true,
      ended: false,
      seeking: false,
      readyState: 4,
      currentTime: 12,
      expectedTime: 12,
      timeTolerance: 1 / 25,
    }

    return {
      ready: canCaptureFrameRingReflectionSnapshot(ready),
      playing: canCaptureFrameRingReflectionSnapshot({
        ...ready,
        paused: false,
      }),
      blocked: canCaptureFrameRingReflectionSnapshot({
        ...ready,
        blocked: true,
      }),
      seeking: canCaptureFrameRingReflectionSnapshot({
        ...ready,
        seeking: true,
      }),
      staleTime: canCaptureFrameRingReflectionSnapshot({
        ...ready,
        currentTime: 11.8,
      }),
      hidden: canCaptureFrameRingReflectionSnapshot({
        ...ready,
        lifecycle: { ...lifecycle, documentHidden: true },
      }),
      lifecycleActive: canUpdateFrameRingLiveReflection(lifecycle),
      localCors: getFrameRingVideoCrossOrigin('aurora-media://local/video'),
      remoteCors: getFrameRingVideoCrossOrigin('https://example.com/video.mp4'),
      retryDelays: FRAME_RING_REFLECTION_SNAPSHOT_RETRY_DELAYS_MS,
      firstRetry: getFrameRingReflectionSnapshotRetryDelay(0),
      lastRetry: getFrameRingReflectionSnapshotRetryDelay(
        FRAME_RING_REFLECTION_SNAPSHOT_RETRY_DELAYS_MS.length - 1,
      ),
      exhaustedRetry: getFrameRingReflectionSnapshotRetryDelay(
        FRAME_RING_REFLECTION_SNAPSHOT_RETRY_DELAYS_MS.length,
      ),
      invalidRetry: getFrameRingReflectionSnapshotRetryDelay(-1),
    }
  })

  expect(result.ready).toBe(true)
  expect(result.playing).toBe(false)
  expect(result.blocked).toBe(false)
  expect(result.seeking).toBe(false)
  expect(result.staleTime).toBe(false)
  expect(result.hidden).toBe(false)
  expect(result.lifecycleActive).toBe(true)
  expect(result.localCors).toBe('anonymous')
  expect(result.remoteCors).toBeUndefined()
  expect(result.retryDelays).toEqual([40, 80, 120, 180, 260, 360])
  expect(result.firstRetry).toBe(40)
  expect(result.lastRetry).toBe(360)
  expect(result.exhaustedRetry).toBeNull()
  expect(result.invalidRetry).toBeNull()
})

test('composites the decoded frame below the cached preview chrome', async ({
  page,
}) => {
  await page.goto('/')

  const pixels = await page.evaluate(async () => {
    const { drawFrameRingLiveReflectionFrame } = await import(
      '/src/features/frame-ring/frameRingLiveReflection.ts'
    )
    const createCanvas = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 100
      canvas.height = 50
      return canvas
    }
    const frame = createCanvas()
    const frameContext = frame.getContext('2d')!
    frameContext.fillStyle = 'rgb(220, 20, 30)'
    frameContext.fillRect(0, 0, frame.width, frame.height)

    const chrome = createCanvas()
    const chromeContext = chrome.getContext('2d')!
    chromeContext.fillStyle = 'rgb(20, 40, 230)'
    chromeContext.fillRect(0, 0, 20, 20)

    const target = createCanvas()
    const media = createCanvas()
    drawFrameRingLiveReflectionFrame({
      targetCanvas: target,
      mediaCanvas: media,
      chromeCanvas: chrome,
      frame,
      frameWidth: frame.width,
      frameHeight: frame.height,
      mediaRect: { x: 0, y: 0, width: 100, height: 50 },
      objectFit: 'contain',
      objectPosition: '50% 50%',
    })

    const context = target.getContext('2d')!
    return {
      chrome: Array.from(context.getImageData(5, 5, 1, 1).data),
      video: Array.from(context.getImageData(70, 25, 1, 1).data),
    }
  })

  expect(pixels.chrome).toEqual([20, 40, 230, 255])
  expect(pixels.video).toEqual([220, 20, 30, 255])
})

test('restores the cached reflection texture after clearing a live canvas override', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const { createIceReflectionRenderer } = await import(
      '/src/features/project-gallery/reflection/IceReflectionRenderer.ts'
    )
    const rendererCanvas = document.createElement('canvas')
    rendererCanvas.width = 64
    rendererCanvas.height = 64
    document.body.append(rendererCanvas)
    const renderer = createIceReflectionRenderer(rendererCanvas, [], {
      textureCache: {
        drawCard: async () => document.createElement('canvas'),
      },
    })
    if (!renderer) return { installed: false, cleared: false }
    await renderer.whenReady()
    const liveCanvas = document.createElement('canvas')
    liveCanvas.width = 32
    liveCanvas.height = 18
    renderer.setProjectCanvasTexture('frame-ring-preview', liveCanvas)
    const installed = renderer.hasProjectTexture('frame-ring-preview')
    renderer.setProjectCanvasTexture('frame-ring-preview', null)
    const cleared = !renderer.hasProjectTexture('frame-ring-preview')
    renderer.dispose()
    rendererCanvas.remove()
    return { installed, cleared }
  })

  expect(result).toEqual({ installed: true, cleared: true })
})
