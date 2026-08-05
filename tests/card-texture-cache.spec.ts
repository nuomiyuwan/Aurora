import { expect, test } from '@playwright/test'

test('caches data-driven project textures by content version and disposes them', async ({ page }) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const [{ CardTextureCache, createCardTextureKey }, { projects }] = await Promise.all([
      import('/src/features/project-gallery/reflection/cardTextureCache.ts'),
      import('/src/data/projects.ts'),
    ])
    let drawCount = 0
    const drawCard = async (_project: unknown, width = 1024) => {
      drawCount += 1
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = Math.round((width * 1080) / 1448)
      return canvas
    }
    const cache = new CardTextureCache({ assetVersion: 'test-v1', drawCard })
    const first = await cache.get(projects[0])
    const second = await cache.get(projects[0])
    const changedProject = { ...projects[0], title: `${projects[0].title} V2` }
    const localSplit = {
      ...projects[0],
      localVideoCount: 1,
      onlineVideoCount: 0,
      videoCount: 1,
    }
    const onlineSplit = {
      ...localSplit,
      localVideoCount: 0,
      onlineVideoCount: 1,
    }

    const result = {
      sameTexture: first === second,
      changedKey:
        createCardTextureKey(projects[0], 'test-v1') !==
        createCardTextureKey(changedProject, 'test-v1'),
      changedOnlineSplitKey:
        createCardTextureKey(localSplit, 'test-v1') !==
        createCardTextureKey(onlineSplit, 'test-v1'),
      cacheSize: cache.size,
      textureWidth: (first.image as HTMLCanvasElement).width,
      textureHeight: (first.image as HTMLCanvasElement).height,
    }
    cache.dispose()
    const secondCache = new CardTextureCache({ assetVersion: 'test-v1', drawCard })
    await secondCache.get(projects[0])
    secondCache.dispose()
    return { ...result, disposedSize: cache.size, crossInstanceDrawCount: drawCount }
  })

  expect(result.sameTexture).toBe(true)
  expect(result.changedKey).toBe(true)
  expect(result.changedOnlineSplitKey).toBe(true)
  expect(result.cacheSize).toBe(1)
  expect(result.textureWidth).toBeLessThanOrEqual(1024)
  expect(result.textureHeight).toBeLessThan(result.textureWidth)
  expect(result.disposedSize).toBe(0)
  expect(result.crossInstanceDrawCount).toBe(1)
})

test('keeps a recreated same-key texture authoritative after pending eviction', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const [{ CardTextureCache }, { projects }] = await Promise.all([
      import('/src/features/project-gallery/reflection/cardTextureCache.ts'),
      import('/src/data/projects.ts'),
    ])

    let releaseRaster = () => undefined
    const rasterGate = new Promise<void>((resolve) => {
      releaseRaster = resolve
    })
    let drawCount = 0
    const drawCard = async (_project: unknown, width = 1024) => {
      drawCount += 1
      await rasterGate
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = Math.round((width * 1080) / 1448)
      return canvas
    }
    const cache = new CardTextureCache({
      assetVersion: 'pending-eviction-v1',
      drawCard,
    })
    const firstPromise = cache.get(projects[0])
    const evictedPending = cache.evictProject(projects[0].id)
    const secondPromise = cache.get(projects[0])
    releaseRaster()
    const [firstResult, second] = await Promise.all([
      firstPromise.then(
        () => 'resolved',
        (error: Error) => error.name,
      ),
      secondPromise,
    ])
    let secondDisposeCount = 0
    second.addEventListener('dispose', () => {
      secondDisposeCount += 1
    })
    const winningTexture = await cache.get(projects[0])
    cache.retainProjectIds(new Set())
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )

    return {
      drawCount,
      evictedPending,
      firstResult,
      retainedRecreationWon: winningTexture === second,
      secondDisposeCount,
      sizeAfterRetain: cache.size,
    }
  })

  expect(result.evictedPending).toBe(true)
  expect(result.drawCount).toBe(1)
  expect(result.firstResult).toBe('CardTextureEvictedError')
  expect(result.retainedRecreationWon).toBe(true)
  expect(result.secondDisposeCount).toBe(1)
  expect(result.sizeAfterRetain).toBe(0)
})

test('restores the latest ready revision when a replacement raster fails', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const [{ CardTextureCache }, { projects }] = await Promise.all([
      import('/src/features/project-gallery/reflection/cardTextureCache.ts'),
      import('/src/data/projects.ts'),
    ])
    const baseProject = projects[0]
    const failedProject = {
      ...baseProject,
      title: `${baseProject.title} failed replacement`,
    }
    const drawCard = async (project: typeof baseProject, width = 1024) => {
      if (project.title === failedProject.title) {
        throw new Error('intentional replacement failure')
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = Math.round((width * 1080) / 1448)
      return canvas
    }
    const cache = new CardTextureCache({
      assetVersion: 'replacement-fallback-v1',
      drawCard,
    })
    const readyTexture = await cache.get(baseProject)
    let readyTextureDisposeCount = 0
    readyTexture.addEventListener('dispose', () => {
      readyTextureDisposeCount += 1
    })
    const replacementResult = await cache.get(failedProject).then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const restoredTexture = await cache.get(baseProject)
    const sizeAfterFailure = cache.size
    cache.dispose()

    return {
      readyTextureDisposeCount,
      replacementResult,
      restoredReadyTexture: restoredTexture === readyTexture,
      sizeAfterFailure,
      sizeAfterDispose: cache.size,
    }
  })

  expect(result.replacementResult).toBe('intentional replacement failure')
  expect(result.restoredReadyTexture).toBe(true)
  expect(result.sizeAfterFailure).toBe(1)
  expect(result.readyTextureDisposeCount).toBe(1)
  expect(result.sizeAfterDispose).toBe(0)
})

test('never repopulates after disposal while a raster request is pending', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const [{ CardTextureCache }, { projects }] = await Promise.all([
      import('/src/features/project-gallery/reflection/cardTextureCache.ts'),
      import('/src/data/projects.ts'),
    ])
    let releaseRaster = () => undefined
    const rasterGate = new Promise<void>((resolve) => {
      releaseRaster = resolve
    })
    const cache = new CardTextureCache({
      assetVersion: 'dispose-pending-v1',
      drawCard: async (_project, width = 1024) => {
        await rasterGate
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = Math.round((width * 1080) / 1448)
        return canvas
      },
    })
    const pendingTexture = cache.get(projects[0]).then(
      () => 'resolved',
      (error: Error) => error.name,
    )
    cache.dispose()
    releaseRaster()
    const pendingResult = await pendingTexture
    const getAfterDisposeResult = await cache.get(projects[0]).then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )

    return {
      getAfterDisposeResult,
      pendingResult,
      size: cache.size,
    }
  })

  expect(result.pendingResult).toBe('CardTextureEvictedError')
  expect(result.getAfterDisposeResult).toBe('Card texture cache is disposed')
  expect(result.size).toBe(0)
})

test('recovers a visible source when a failed project texture is ensured again', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const [runtimeModule, projectionModule, projectModule] = await Promise.all([
      import('/src/features/project-gallery/reflection/IceReflectionRenderer.ts'),
      import('/src/features/project-gallery/reflection/domCardProjection.ts'),
      import('/src/data/projects.ts'),
    ])
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    canvas.style.width = '128px'
    canvas.style.height = '128px'
    document.body.append(canvas)

    const project = projectModule.projects[0]
    let drawCount = 0
    const renderer = new runtimeModule.IceReflectionRenderer(canvas, [], {
      sourceLightAsset:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwMtmQAAAABJRU5ErkJggg==',
      textureCache: {
        assetVersion: 'visible-source-retry-v1',
        drawCard: async (_project, width = 1024) => {
          drawCount += 1
          if (drawCount === 1) {
            throw new Error('reflection source is not mounted yet')
          }
          const textureCanvas = document.createElement('canvas')
          textureCanvas.width = width
          textureCanvas.height = Math.round((width * 1080) / 1448)
          const context = textureCanvas.getContext('2d')
          if (!context) throw new Error('2D canvas is unavailable')
          context.fillStyle = '#f2f6ff'
          context.fillRect(0, 0, textureCanvas.width, textureCanvas.height)
          return textureCanvas
        },
      },
    })
    await renderer.whenReady()

    const cardMatrix = projectionModule.createFloorReflectionMatrix(0)
    const reflectionMatrix =
      projectionModule.createFloorReflectionMatrix(96)
    const sample = {
      carouselKey: 'retry-slot',
      projectId: project.id,
      projectIndex: 0,
      width: 80,
      height: 60,
      opacity: 1,
      reflectionOpacity: 1,
      paintOrder: 0,
      cardMatrix,
      reflectionMatrix,
      usedRectFallback: false,
    }
    renderer.sync([sample], 0, 0)
    const missingDiagnostics = renderer.diagnostics

    renderer.ensureProjects([project])
    for (let frame = 0; frame < 10 && drawCount < 1; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const failedTexturePresent = renderer.hasProjectTexture(project.id)
    const failedDiagnostics = renderer.diagnostics

    renderer.ensureProjects([project])
    for (
      let frame = 0;
      frame < 60 && !renderer.hasProjectTexture(project.id);
      frame += 1
    ) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    renderer.sync([sample], 0, 0)
    const recoveredDiagnostics = renderer.diagnostics
    const recoveredTexturePresent = renderer.hasProjectTexture(project.id)

    renderer.dispose()
    canvas.remove()

    return {
      drawCount,
      failedTexturePresent,
      recoveredTexturePresent,
      missingSourceCount: missingDiagnostics.sourceCount,
      missingVisibleSourceCount: missingDiagnostics.visibleSourceCount,
      missingTextureProjectIds:
        missingDiagnostics.missingTextureProjectIds,
      initialTextureErrorProjectIds:
        missingDiagnostics.textureErrorProjectIds,
      failedTextureCount: failedDiagnostics.textureCount,
      failedMissingTextureProjectIds:
        failedDiagnostics.missingTextureProjectIds,
      failedTextureErrorProjectIds:
        failedDiagnostics.textureErrorProjectIds,
      recoveredSourceCount: recoveredDiagnostics.sourceCount,
      recoveredVisibleSourceCount: recoveredDiagnostics.visibleSourceCount,
      recoveredTextureCount: recoveredDiagnostics.textureCount,
      recoveredMissingTextureProjectIds:
        recoveredDiagnostics.missingTextureProjectIds,
      recoveredTextureErrorProjectIds:
        recoveredDiagnostics.textureErrorProjectIds,
    }
  })

  expect(result.drawCount).toBe(2)
  expect(result.failedTexturePresent).toBe(false)
  expect(result.recoveredTexturePresent).toBe(true)
  expect(result.missingSourceCount).toBe(1)
  expect(result.missingVisibleSourceCount).toBe(0)
  expect(result.missingTextureProjectIds).toEqual(['glacier'])
  expect(result.initialTextureErrorProjectIds).toEqual([])
  expect(result.failedTextureCount).toBe(0)
  expect(result.failedMissingTextureProjectIds).toEqual(['glacier'])
  expect(result.failedTextureErrorProjectIds).toEqual(['glacier'])
  expect(result.recoveredSourceCount).toBe(1)
  expect(result.recoveredVisibleSourceCount).toBe(1)
  expect(result.recoveredTextureCount).toBe(1)
  expect(result.recoveredMissingTextureProjectIds).toEqual([])
  expect(result.recoveredTextureErrorProjectIds).toEqual([])
})

test('does not resurrect constructor textures evicted while their raster is pending', async ({
  page,
}) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const [runtimeModule, projectModule] = await Promise.all([
      import('/src/features/project-gallery/reflection/IceReflectionRenderer.ts'),
      import('/src/data/projects.ts'),
    ])
    let releaseRaster = () => undefined
    const rasterGate = new Promise<void>((resolve) => {
      releaseRaster = resolve
    })
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    canvas.style.width = '64px'
    canvas.style.height = '64px'
    document.body.append(canvas)
    const project = projectModule.projects[0]
    const renderer = new runtimeModule.IceReflectionRenderer(
      canvas,
      [project],
      {
        sourceLightAsset:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwMtmQAAAABJRU5ErkJggg==',
        textureCache: {
          assetVersion: 'renderer-constructor-eviction-v1',
          drawCard: async (_project, width = 1024) => {
            await rasterGate
            const textureCanvas = document.createElement('canvas')
            textureCanvas.width = width
            textureCanvas.height = Math.round((width * 1080) / 1448)
            return textureCanvas
          },
        },
      },
    )
    renderer.retainProjects([])
    releaseRaster()
    await renderer.whenReady()
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const retainedTexture = renderer.hasProjectTexture(project.id)
    const textureCount = renderer.diagnostics.textureCount
    renderer.dispose()
    canvas.remove()

    return { retainedTexture, textureCount }
  })

  expect(result.retainedTexture).toBe(false)
  expect(result.textureCount).toBe(0)
})
