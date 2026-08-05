import { expect, test } from '@playwright/test'
import {
  createCssPerspectiveMatrix,
  createFloorReflectionMatrix,
  createSampleSignature,
  projectCssPoint,
  sampleDomGallery,
} from '../src/features/project-gallery/reflection/domCardProjection'
import { ReflectionFrameLoop } from '../src/features/project-gallery/reflection/ReflectionFrameLoop'
import { HOME_CARD_ALPHA_BOTTOM } from '../src/features/project-gallery/galleryCardLayout'

interface RectState {
  left: number
  top: number
  width: number
  height: number
}

interface FakeElementHandle {
  element: HTMLElement
  rect: RectState
  style: CSSStyleDeclaration & Record<string, unknown>
}

const makeStyle = (
  overrides: Record<string, string> = {},
): CSSStyleDeclaration & Record<string, unknown> => {
  const style = {
    width: '0px',
    height: '0px',
    left: '0px',
    top: '0px',
    opacity: '1',
    zIndex: '0',
    transform: 'none',
    transformOrigin: '0px 0px 0px',
    perspective: 'none',
    perspectiveOrigin: '0px 0px',
    '--reflection-opacity': '1',
    ...overrides,
  } as unknown as CSSStyleDeclaration & Record<string, unknown>
  style.getPropertyValue = (property: string) => String(style[property] ?? '')
  return style
}

const toDomRect = (rect: RectState): DOMRect =>
  ({
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({ ...rect }),
  }) as DOMRect

const makeElement = ({
  classes = [],
  dataset = {},
  rect,
  style = {},
  forbidRect = false,
}: {
  classes?: string[]
  dataset?: Record<string, string>
  rect: RectState
  style?: Record<string, string>
  forbidRect?: boolean
}): FakeElementHandle => {
  const computedStyle = makeStyle(style)
  const classNames = new Set(classes)
  const element = {
    __computedStyle: computedStyle,
    children: [] as HTMLElement[],
    classList: { contains: (className: string) => classNames.has(className) },
    dataset,
    clientWidth: rect.width,
    clientHeight: rect.height,
    offsetWidth: rect.width,
    offsetHeight: rect.height,
    querySelector: () => null,
    getBoundingClientRect: () => {
      if (forbidRect) throw new Error('rect fallback entered for a parseable matrix')
      return toDomRect(rect)
    },
  } as unknown as HTMLElement
  return { element, rect, style: computedStyle }
}

const makeGallery = ({
  stageRect = { left: 0, top: 0, width: 1000, height: 600 },
  stageStyle = {},
  rigStyle = {},
  cards,
  forbidRect = false,
}: {
  stageRect?: RectState
  stageStyle?: Record<string, string>
  rigStyle?: Record<string, string>
  cards: FakeElementHandle[]
  forbidRect?: boolean
}) => {
  const stage = makeElement({
    classes: ['projectStage'],
    rect: stageRect,
    forbidRect,
    style: {
      width: `${stageRect.width}px`,
      height: `${stageRect.height}px`,
      ...stageStyle,
    },
  })
  const rig = makeElement({
    classes: ['projectCameraRig'],
    rect: stageRect,
    forbidRect,
    style: {
      width: `${stageRect.width}px`,
      height: `${stageRect.height}px`,
      ...rigStyle,
    },
  })
  ;(rig.element as unknown as { children: HTMLElement[] }).children = cards.map(
    ({ element }) => element,
  )
  ;(stage.element as unknown as { querySelector: (selector: string) => HTMLElement | null }).querySelector =
    (selector) => (selector === '.projectCameraRig' ? rig.element : null)
  return { stage, rig, cards }
}

const withComputedStyles = <T>(run: () => T): T => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle')
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: (element: HTMLElement) =>
      (element as unknown as { __computedStyle: CSSStyleDeclaration }).__computedStyle,
  })
  try {
    return run()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'getComputedStyle', descriptor)
    else Reflect.deleteProperty(globalThis, 'getComputedStyle')
  }
}

const drainFrames = (callbacks: FrameRequestCallback[], maximum = 20) => {
  let frames = 0
  while (callbacks.length && frames < maximum) {
    callbacks.shift()!(performance.now())
    frames += 1
  }
  return frames
}

test('mirrors complete card coordinates across one horizontal ice plane', () => {
  const reflection = createFloorReflectionMatrix(100)
  expect(projectCssPoint(reflection, 20, 80)).toEqual({ x: 20, y: 120 })
  expect(projectCssPoint(reflection, 20, 100)).toEqual({ x: 20, y: 100 })
})

test('CSS perspective preserves the homogeneous view response', () => {
  const perspective = createCssPerspectiveMatrix(1000, 500, 300)
  const near = projectCssPoint(perspective, 600, 300, 200)
  const flat = projectCssPoint(perspective, 600, 300, 0)
  expect(near.x).toBeGreaterThan(flat.x)
})

test('samples live computed transforms in Pcss * Mrig * Rfloor * Mcard order', () => {
  const card = makeElement({
    classes: ['projectCard', 'active'],
    dataset: { carouselKey: 'aurora', projectId: 'ring', projectIndex: '7' },
    rect: { left: 0, top: 0, width: 30, height: 50 },
    forbidRect: true,
    style: {
      width: '30px',
      height: '50px',
      left: '100px',
      top: '200px',
      transform: 'matrix3d(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 5, 7, 100, 1)',
      transformOrigin: '10px 20px 0px',
      opacity: '0.8',
      zIndex: '102',
      '--reflection-opacity': '0.35',
    },
  })
  const gallery = makeGallery({
    cards: [card],
    forbidRect: true,
    stageStyle: { perspective: '1000px', perspectiveOrigin: '500px 300px' },
    rigStyle: {
      transform: 'matrix(1.5, 0, 0, 1.5, 10, 20)',
      transformOrigin: '100px 50px 0px',
    },
  })

  const first = withComputedStyles(() => sampleDomGallery(gallery.stage.element))
  expect(first.floorLock.coordinateSpace).toBe('rig-local')
  expect(first.floorLock.floorY).toBeCloseTo(277.185185, 6)
  expect(first.coordinateSpace).toBe('rig-local')
  expect(first.samples[0].usedRectFallback).toBe(false)
  expect(first.samples[0].projectId).toBe('ring')
  expect(first.samples[0].opacity).toBe(0.8)
  expect(first.samples[0].reflectionOpacity).toBe(0.35)
  expect(first.samples[0].paintOrder).toBe(102)
  const reflectedAlphaBottom = projectCssPoint(
    first.samples[0].reflectionMatrix,
    0,
    50 * HOME_CARD_ALPHA_BOTTOM,
  )
  const reflectedTop = projectCssPoint(first.samples[0].reflectionMatrix, 0, 0)
  expect(reflectedAlphaBottom.y).toBeLessThan(reflectedTop.y)

  card.style.transform =
    'matrix3d(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 25, 7, 100, 1)'
  card.style.opacity = '0.45'
  card.style['--reflection-opacity'] = '0.2'
  const live = withComputedStyles(() => sampleDomGallery(gallery.stage.element, first.floorLock))
  expect(live.floorLock).toEqual(first.floorLock)
  expect(live.samples[0].opacity).toBe(0.45)
  expect(live.samples[0].reflectionOpacity).toBe(0.2)
  expect(
    projectCssPoint(
      live.samples[0].reflectionMatrix,
      0,
      50 * HOME_CARD_ALPHA_BOTTOM,
    ).x,
  ).not.toBeCloseTo(reflectedAlphaBottom.x)
  expect(live.signature).not.toBe(first.signature)
  expect(live.signature).toBe(createSampleSignature(live.samples))
})

test('keeps direct card DOM order and untransformed dimensions', () => {
  const second = makeElement({
    classes: ['projectCard', 'active'],
    dataset: { carouselKey: 'second', projectId: 'woods', projectIndex: '9' },
    rect: { left: 0, top: 0, width: 80, height: 40 },
    forbidRect: true,
    style: {
      width: '80px',
      height: '40px',
      zIndex: '80',
      transform: 'matrix(1, 0, 0, 1, 0, 0)',
    },
  })
  const first = makeElement({
    classes: ['projectCard'],
    dataset: { carouselKey: 'first', projectId: 'ring', projectIndex: '2' },
    rect: { left: 0, top: 0, width: 120, height: 70 },
    forbidRect: true,
    style: {
      width: '120px',
      height: '70px',
      zIndex: '40',
      transform: 'matrix(1, 0, 0, 1, 0, 0)',
    },
  })
  const gallery = makeGallery({ cards: [second, first], forbidRect: true })

  const snapshot = withComputedStyles(() => sampleDomGallery(gallery.stage.element))
  expect(snapshot.width).toBe(1000)
  expect(snapshot.height).toBe(600)
  expect(snapshot.samples.map(({ carouselKey }) => carouselKey)).toEqual(['second', 'first'])
  expect(snapshot.samples.map(({ projectIndex }) => projectIndex)).toEqual([9, 2])
  expect(snapshot.samples.map(({ projectId }) => projectId)).toEqual(['woods', 'ring'])
  expect(snapshot.samples.map(({ paintOrder }) => paintOrder)).toEqual([80, 40])
  expect(snapshot.samples.map(({ width, height }) => [width, height])).toEqual([
    [80, 40],
    [120, 70],
  ])
})

test('uses one stage-screen rect path for every card and rejects a mismatched floor lock', () => {
  const active = makeElement({
    classes: ['projectCard', 'active'],
    dataset: { carouselKey: 'active', projectIndex: '0' },
    rect: { left: 150, top: 350, width: 100, height: 60 },
    style: {
      width: '100px',
      height: '60px',
      left: '20px',
      top: '30px',
      transform: 'matrix(1, 0, 0, 1, 0, 0)',
    },
  })
  const unavailable = makeElement({
    classes: ['projectCard'],
    dataset: { carouselKey: 'fallback', projectIndex: '1' },
    rect: { left: 400, top: 300, width: 80, height: 40 },
    style: { width: '80px', height: '40px', transform: 'translateX(1px)' },
  })
  const gallery = makeGallery({
    stageRect: { left: 100, top: 200, width: 800, height: 600 },
    cards: [active, unavailable],
    rigStyle: { transform: 'matrix(1, 0, 0, 1, 0, 0)' },
  })

  const fallback = withComputedStyles(() =>
    sampleDomGallery(gallery.stage.element, {
      floorY: 999,
      coordinateSpace: 'rig-local',
    }),
  )
  expect(fallback.coordinateSpace).toBe('stage-screen')
  const expectedFallbackFloor = 150 + 60 * HOME_CARD_ALPHA_BOTTOM
  expect(fallback.floorLock.coordinateSpace).toBe('stage-screen')
  expect(fallback.floorLock.floorY).toBeCloseTo(expectedFallbackFloor, 6)
  expect(fallback.samples.every(({ usedRectFallback }) => usedRectFallback)).toBe(true)
  expect(projectCssPoint(fallback.samples[0].cardMatrix, 0, 0)).toEqual({ x: 50, y: 150 })
  expect(
    projectCssPoint(
      fallback.samples[0].reflectionMatrix,
      0,
      60 * HOME_CARD_ALPHA_BOTTOM,
    ).y,
  ).toBeCloseTo(expectedFallbackFloor, 6)
  expect(projectCssPoint(fallback.samples[0].reflectionMatrix, 0, 0).y).toBeCloseTo(
    expectedFallbackFloor * 2 - 150,
    6,
  )

  active.rect.top = 430
  unavailable.rect.left = 430
  const lockedFallback = withComputedStyles(() =>
    sampleDomGallery(gallery.stage.element, fallback.floorLock),
  )
  expect(lockedFallback.floorLock).toEqual(fallback.floorLock)
  expect(lockedFallback.signature).not.toBe(fallback.signature)

  unavailable.style.transform = 'matrix(1, 0, 0, 1, 0, 0)'
  const restoredComputedPath = withComputedStyles(() =>
    sampleDomGallery(gallery.stage.element, lockedFallback.floorLock),
  )
  expect(restoredComputedPath.coordinateSpace).toBe('rig-local')
  expect(restoredComputedPath.floorLock.coordinateSpace).toBe('rig-local')
  expect(restoredComputedPath.floorLock.floorY).toBeCloseTo(
    30 + 60 * HOME_CARD_ALPHA_BOTTOM,
    6,
  )
  expect(restoredComputedPath.samples.every(({ usedRectFallback }) => !usedRectFallback)).toBe(true)
})

test('coalesces invalidations and sleeps after stable frames', () => {
  const callbacks: FrameRequestCallback[] = []
  let samples = 0
  const loop = new ReflectionFrameLoop({
    requestFrame: (callback) => (callbacks.push(callback), callbacks.length),
    cancelFrame: () => undefined,
    sampleAndRender: () => {
      samples += 1
      return { changed: false }
    },
    stableFrameLimit: 3,
  })
  loop.invalidate()
  loop.invalidate()
  expect(callbacks).toHaveLength(1)
  drainFrames(callbacks)
  expect(loop.running).toBe(false)
  expect(samples).toBe(3)
})

test('wakes after idle when invalidated again', () => {
  const callbacks: FrameRequestCallback[] = []
  let samples = 0
  const loop = new ReflectionFrameLoop({
    requestFrame: (callback) => (callbacks.push(callback), callbacks.length),
    cancelFrame: () => undefined,
    sampleAndRender: () => {
      samples += 1
      return { changed: false }
    },
    stableFrameLimit: 2,
  })

  loop.invalidate()
  expect(drainFrames(callbacks)).toBe(2)
  expect(loop.running).toBe(false)
  loop.invalidate()
  expect(callbacks).toHaveLength(1)
  expect(drainFrames(callbacks)).toBe(2)
  expect(samples).toBe(4)
  expect(loop.running).toBe(false)
})

test('renders one dynamic texture frame without reopening the settle window', () => {
  const callbacks: FrameRequestCallback[] = []
  let samples = 0
  const loop = new ReflectionFrameLoop({
    requestFrame: (callback) => (callbacks.push(callback), callbacks.length),
    cancelFrame: () => undefined,
    sampleAndRender: () => {
      samples += 1
      return { changed: false }
    },
    stableFrameLimit: 3,
  })

  loop.invalidate()
  expect(drainFrames(callbacks)).toBe(3)
  expect(loop.running).toBe(false)

  loop.wakeForTextureFrame()
  loop.wakeForTextureFrame()
  expect(callbacks).toHaveLength(1)
  expect(drainFrames(callbacks)).toBe(1)
  expect(samples).toBe(4)
  expect(loop.running).toBe(false)
})

test('pauses a cached reflection loop and resumes on the next invalidation', () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  const cancelled: number[] = []
  let nextHandle = 0
  let samples = 0
  const loop = new ReflectionFrameLoop({
    requestFrame: (callback) => {
      nextHandle += 1
      callbacks.set(nextHandle, callback)
      return nextHandle
    },
    cancelFrame: (handle) => {
      cancelled.push(handle)
      callbacks.delete(handle)
    },
    sampleAndRender: () => {
      samples += 1
      return { changed: false }
    },
  })

  loop.invalidate()
  expect(loop.running).toBe(true)
  loop.pause()
  expect(cancelled).toEqual([1])
  expect(callbacks.size).toBe(0)
  expect(loop.running).toBe(false)

  loop.invalidate()
  expect(callbacks.size).toBe(1)
  const resumedFrame = callbacks.get(2)
  callbacks.delete(2)
  resumedFrame?.(performance.now())
  expect(samples).toBe(1)
  expect(loop.running).toBe(true)
  loop.pause()
})

test('cancels pending work and ignores the callback after disposal', () => {
  const callbacks: FrameRequestCallback[] = []
  const cancelled: number[] = []
  let samples = 0
  const loop = new ReflectionFrameLoop({
    requestFrame: (callback) => (callbacks.push(callback), 42),
    cancelFrame: (handle) => cancelled.push(handle),
    sampleAndRender: () => {
      samples += 1
      return { changed: false }
    },
  })

  loop.invalidate()
  loop.dispose()
  expect(cancelled).toEqual([42])
  expect(loop.running).toBe(false)
  callbacks[0](performance.now())
  expect(samples).toBe(0)
  loop.invalidate()
  expect(callbacks).toHaveLength(1)
})

for (const invalidLimit of [Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`normalizes ${String(invalidLimit)} stable frame limit to the safe default`, () => {
    const callbacks: FrameRequestCallback[] = []
    let samples = 0
    const loop = new ReflectionFrameLoop({
      requestFrame: (callback) => (callbacks.push(callback), callbacks.length),
      cancelFrame: () => undefined,
      sampleAndRender: () => {
        samples += 1
        return { changed: false }
      },
      stableFrameLimit: invalidLimit,
    })

    loop.invalidate()
    expect(drainFrames(callbacks, 10)).toBe(3)
    expect(callbacks).toHaveLength(0)
    expect(samples).toBe(3)
    expect(loop.running).toBe(false)
  })
}

test('uses a full-resolution reflection target capped at 1536 pixels', async () => {
  const { getDomReflectionTargetSize } = await import(
    '../src/features/project-gallery/reflection/IceReflectionRenderer'
  )
  expect(getDomReflectionTargetSize(3200, 1800)).toEqual({ width: 1536, height: 864 })
  expect(getDomReflectionTargetSize(3201, 1800)).toEqual({ width: 1536, height: 864 })
  expect(getDomReflectionTargetSize(1000, 600)).toEqual({ width: 1000, height: 600 })
})

test('keeps six reflection sources by default and accepts a safe per-instance capacity', async () => {
  const {
    DOM_REFLECTION_MAX_SOURCES,
    normalizeDomReflectionSourceCapacity,
  } = await import('../src/features/project-gallery/reflection/IceReflectionRenderer')

  expect(DOM_REFLECTION_MAX_SOURCES).toBe(6)
  expect(normalizeDomReflectionSourceCapacity()).toBe(6)
  expect(normalizeDomReflectionSourceCapacity(11)).toBe(11)
  expect(normalizeDomReflectionSourceCapacity(0)).toBe(1)
  expect(normalizeDomReflectionSourceCapacity(Number.POSITIVE_INFINITY)).toBe(6)
})

test('orders reflection sources from back to front without changing equal-layer DOM order', async () => {
  const { orderDomReflectionSamples } = await import(
    '../src/features/project-gallery/reflection/IceReflectionRenderer'
  )
  const samples = [
    { carouselKey: 'front-a', paintOrder: 80 },
    { carouselKey: 'back', paintOrder: 20 },
    { carouselKey: 'front-b', paintOrder: 80 },
  ] as unknown as Parameters<typeof orderDomReflectionSamples>[0]

  expect(
    orderDomReflectionSamples(samples).map(({ carouselKey }) => carouselKey),
  ).toEqual(['back', 'front-a', 'front-b'])
})

test('keeps the ice composite to a fixed small sample kernel', async () => {
  const shader = await import('../src/features/project-gallery/reflection/reflectionShaders')
  const sourceMapTaps =
    shader.iceCompositeFragmentShader.match(/texture2D\(\s*sourceMap\s*,/g) ?? []
  expect(shader.ICE_REFLECTION_SAMPLES).toBe(6)
  expect(sourceMapTaps).toHaveLength(shader.ICE_REFLECTION_SAMPLES)
  expect(shader.iceCompositeFragmentShader).toContain('surfaceDataMap')
  expect(shader.iceCompositeFragmentShader).toContain('cameraYaw')
  expect(shader.iceCompositeFragmentShader).toContain('cameraPitch')
})

test('preserves homogeneous card projection and uses target texels for a static transparent composite', async () => {
  const shader = await import('../src/features/project-gallery/reflection/reflectionShaders')
  expect(shader.reflectionSourceVertexShader).toContain('reflectionMatrix')
  expect(shader.reflectionSourceVertexShader).toContain('css.w')
  expect(shader.reflectionSourceFragmentShader).toContain('vec4(card.rgb * alpha, alpha)')
  expect(shader.reflectionSourceFragmentShader).toContain('uniform float sourceAlphaBottom')
  expect(shader.reflectionSourceFragmentShader).toContain(
    'vCardLocalY > sourceAlphaBottom',
  )
  expect(shader.ICE_REFLECTION_VISIBLE_DISTANCE).toBe(0.34)
  expect(shader.ICE_REFLECTION_FADE_START).toBe(0.012)
  expect(shader.ICE_REFLECTION_MAX_BLUR_TEXELS).toBe(5)
  expect(shader.reflectionSourceFragmentShader).toContain('uniform float sourceVisibleDistance')
  expect(shader.reflectionSourceFragmentShader).toContain('uniform float sourceFadeStart')
  expect(shader.reflectionSourceFragmentShader).toContain('uniform float sourceMaxBlurTexels')
  expect(shader.reflectionSourceFragmentShader).toContain('contactDistance >= sourceVisibleDistance')
  expect(shader.reflectionSourceFragmentShader).toContain('float blurRadius = sourceBaseBlurTexels')
  expect(shader.reflectionSourceFragmentShader).toContain('+ sourceMaxBlurTexels')
  expect(shader.reflectionSourceFragmentShader).toContain('uniform vec2 cardTexelSize')
  expect(shader.reflectionSourceFragmentShader).toContain('cardTexelSize * blurRadius')
  expect(shader.reflectionSourceFragmentShader).toContain('if (alpha <= 0.001) discard')
  expect(shader.iceCompositeFragmentShader).toContain('texelSize')
  expect(shader.iceCompositeFragmentShader).toContain(
    'reflected.rgb / max(reflected.a',
  )
  expect(shader.iceCompositeFragmentShader).not.toContain('uniform float time')
  expect(shader.iceCompositeFragmentShader).toContain(
    'vec4(neutralColor, alpha)',
  )
  expect(shader.iceCompositeFragmentShader).not.toContain('coolColor')
})

test('treats synchronized camera angles as degrees before shader trigonometry', async () => {
  const { iceCompositeFragmentShader } = await import(
    '../src/features/project-gallery/reflection/reflectionShaders'
  )
  expect(iceCompositeFragmentShader).toContain('radians(cameraYaw)')
  expect(iceCompositeFragmentShader).not.toContain('radians(cameraPitch)')
  expect(iceCompositeFragmentShader).not.toMatch(/(?:sin|cos)\(camera(?:Yaw|Pitch)\)/)
  expect(iceCompositeFragmentShader).toContain('abs(cameraPitch)')
})

test('runs one bounded reflection runtime through readiness and WebGL context lifecycle', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [runtimeModule, projectModule] = await Promise.all([
      import('/src/features/project-gallery/reflection/IceReflectionRenderer.ts'),
      import('/src/data/projects.ts'),
    ])
    const runtimeProjects = projectModule.projects.slice(0, 7)
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    canvas.style.width = '320px'
    canvas.style.height = '180px'
    document.body.append(canvas)

    let invalidations = 0
    const drawCard = async (_project: unknown, width = 1024) => {
      const textureCanvas = document.createElement('canvas')
      textureCanvas.width = width
      textureCanvas.height = Math.round((width * 1080) / 1448)
      return textureCanvas
    }
    const renderer = Reflect.construct(runtimeModule.IceReflectionRenderer, [
      canvas,
      runtimeProjects,
      {
        onInvalidate: () => (invalidations += 1),
        textureCache: { drawCard },
      },
    ]) as InstanceType<typeof runtimeModule.IceReflectionRenderer>
    const matrixElements = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      80, 30, 0, 1,
    ]
    const samples = Array.from({ length: 7 }, (_, index) => ({
      carouselKey: `runtime-${index}`,
      projectIndex: index % runtimeProjects.length,
      width: 160,
      height: 110,
      opacity: 1,
      reflectionOpacity: 0.7,
      paintOrder: index,
      cardMatrix: { elements: [...matrixElements] },
      reflectionMatrix: { elements: [...matrixElements] },
      usedRectFallback: false,
    }))
    renderer.sync(
      samples as unknown as Parameters<typeof renderer.sync>[0],
      30,
      -20,
    )
    const beforeReady = { ...renderer.diagnostics }
    renderer.render(0)
    const afterEarlyRender = { ...renderer.diagnostics }

    await renderer.whenReady()
    const afterReady = { ...renderer.diagnostics }
    const readyInvalidations = invalidations
    const contextAttributes = canvas
      .getContext('webgl2')
      ?.getContextAttributes()
    renderer.render(1)
    const afterRender = { ...renderer.diagnostics }

    renderer.resize(3201, 1800)
    const afterResize = { ...renderer.diagnostics }
    const lostEvent = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(lostEvent)
    const afterLost = { ...renderer.diagnostics }
    renderer.render(2)
    const afterLostRender = { ...renderer.diagnostics }
    const invalidationsBeforeRestore = invalidations

    canvas.dispatchEvent(new Event('webglcontextrestored'))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const afterRestored = { ...renderer.diagnostics }
    const restoreInvalidations = invalidations - invalidationsBeforeRestore
    renderer.render(3)
    const afterRestoredRender = { ...renderer.diagnostics }

    const runtimeRecord = runtimeModule as unknown as Record<string, unknown>
    const factory = runtimeRecord.createIceReflectionRenderer
    const failingCanvas = document.createElement('canvas')
    Object.defineProperty(failingCanvas, 'getContext', {
      configurable: true,
      value: () => {
        throw new Error('intentional WebGL construction failure')
      },
    })
    let safeFactoryCaughtFailure = false
    if (typeof factory === 'function') {
      try {
        safeFactoryCaughtFailure =
          Reflect.apply(factory, undefined, [
            failingCanvas,
            [],
            { textureCache: { drawCard } },
          ]) === null
      } catch {
        safeFactoryCaughtFailure = false
      }
    }

    const invalidationsBeforeDispose = invalidations
    renderer.dispose()
    const afterDispose = { ...renderer.diagnostics }
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    renderer.render(4)
    const afterDisposedEvents = { ...renderer.diagnostics }
    const disposeInvalidations = invalidations - invalidationsBeforeDispose
    canvas.remove()

    return {
      beforeReady,
      afterEarlyRender,
      afterReady,
      afterRender,
      afterResize,
      afterLost,
      afterLostRender,
      afterRestored,
      afterRestoredRender,
      afterDispose,
      afterDisposedEvents,
      readyInvalidations,
      restoreInvalidations,
      disposeInvalidations,
      lostDefaultPrevented: lostEvent.defaultPrevented,
      contextPremultipliedAlpha: contextAttributes?.premultipliedAlpha,
      safeFactoryCaughtFailure,
    }
  })

  expect(result.beforeReady).toMatchObject({
    rendererCount: 1,
    targetCount: 1,
    sourceCapacity: 6,
    sourceCount: 6,
    visibleSourceCount: 0,
    ready: false,
    contextLost: false,
    renderCount: 0,
  })
  expect(result.afterEarlyRender).toMatchObject({ renderCount: 0, visibleSourceCount: 0 })
  expect(result.afterReady).toMatchObject({
    ready: true,
    sourceCount: 6,
    visibleSourceCount: 6,
  })
  expect(result.readyInvalidations).toBe(1)
  expect(result.contextPremultipliedAlpha).toBe(true)
  expect(result.afterRender.renderCount).toBe(1)
  expect(result.afterResize).toMatchObject({ targetWidth: 1536, targetHeight: 864 })
  expect(result.lostDefaultPrevented).toBe(true)
  expect(result.afterLost).toMatchObject({ contextLost: true, visibleSourceCount: 0 })
  expect(result.afterLostRender.renderCount).toBe(result.afterRender.renderCount)
  expect(result.afterRestored).toMatchObject({
    contextLost: false,
    visibleSourceCount: 6,
  })
  expect(result.restoreInvalidations).toBe(1)
  expect(result.afterRestoredRender.renderCount).toBe(result.afterRender.renderCount + 1)
  expect(result.safeFactoryCaughtFailure).toBe(true)
  expect(result.afterDispose).toMatchObject({
    rendererCount: 0,
    targetCount: 0,
    sourceCapacity: 0,
    visibleSourceCount: 0,
    textureCount: 0,
  })
  expect(result.afterDisposedEvents).toEqual(result.afterDispose)
  expect(result.disposeInvalidations).toBe(0)
})
