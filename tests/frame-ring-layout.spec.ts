import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import {
  clampFramePosition,
  createFrameRingFrames,
  findNearestFrameIndexByTime,
  getDefaultFrameIndex,
  getFrameRingVisual,
  getVisibleFrameRange,
  type FrameRingClipSource,
} from '../src/features/frame-ring/frameRingData'
import {
  createFrameRingReflectionMatrix,
  FRAME_RING_CARD_REFLECTION_CAPACITY,
  FRAME_RING_REFLECTION_SOURCE_CAPACITY,
  sampleFrameRingReflections,
} from '../src/features/frame-ring/frameRingReflectionProjection'
import {
  createCssPerspectiveMatrix,
  projectCssPoint,
} from '../src/features/project-gallery/reflection/domCardProjection'
import {
  FRAME_RING_BASE_LAYOUT,
  getFrameRingCssVariables,
  resolveFrameRingLayout,
} from '../src/features/frame-ring/frameRingLayout'
import { AURORA_TOPBAR_CENTER_Y } from '../src/features/responsive-layout/responsiveLayout'

const clip: FrameRingClipSource = {
  id: 'ring-A001_C012.mov',
  filename: 'A001_C012.mov',
  thumbnail: '/aurora/project-ring-of-horizon.png',
  duration: '02:14',
  resolution: '3840 x 2160',
  fps: '24 fps',
  frameCount: '96',
  sampleCount: 96,
  codec: 'ProRes 4444',
  capturedAt: '2024-05-12 14:35',
  tags: ['环形建筑'],
  note: '测试帧环',
}

test('creates one draggable frame position per sampled material frame', () => {
  const frames = createFrameRingFrames(clip, [clip.thumbnail])

  expect(frames).toHaveLength(96)
  expect(frames[0].timecode).toBe('00:00:00:00')
  expect(frames.at(-1)?.timecode).toBe('00:02:14:00')
  expect(new Set(frames.map((frame) => frame.id)).size).toBe(96)
})

test('keeps an unindexed clip frame ring empty while preview remains independent', () => {
  const frames = createFrameRingFrames(
    {
      ...clip,
      id: 'unindexed-clip',
      sampleCount: 0,
      indexedFrames: [],
    },
    [clip.thumbnail],
  )

  expect(frames).toEqual([])
  expect(getDefaultFrameIndex(frames.length)).toBe(0)
  expect(getVisibleFrameRange(0, frames.length)).toEqual({ start: 0, end: 0 })
})

test('uses actual indexed timestamps instead of assuming even spacing', () => {
  const indexedTimes = [
    { timeSeconds: 0.291667 },
    { timeSeconds: 0.958333 },
    { timeSeconds: 1.625 },
  ]

  expect(findNearestFrameIndexByTime(indexedTimes, 0)).toBe(0)
  expect(findNearestFrameIndexByTime(indexedTimes, 0.7)).toBe(1)
  expect(findNearestFrameIndexByTime(indexedTimes, 1.4)).toBe(2)
})

test('opens the frame ring with its first sampled frame in the leftmost slot', () => {
  const defaultIndex = getDefaultFrameIndex(96)
  const range = getVisibleFrameRange(defaultIndex, 96)

  expect(defaultIndex).toBe(6)
  expect(range).toEqual({ start: 0, end: 13 })
  expect(getDefaultFrameIndex(5)).toBe(4)
  expect(getDefaultFrameIndex(1)).toBe(0)
})

test('keeps the exact center frame front-facing and virtualizes the ring', () => {
  const fullHdLayout = resolveFrameRingLayout({ width: 1920, height: 1080 })
  const compactLayout = resolveFrameRingLayout({ width: 1280, height: 720 })
  const center = getFrameRingVisual(0, fullHdLayout)
  const incoming = getFrameRingVisual(0.4, fullHdLayout)
  const side = getFrameRingVisual(1, fullHdLayout)
  const range = getVisibleFrameRange(48.2, 96)

  expect(center.x).toBe(0)
  expect(center.rotateY).toBe(0)
  expect(Math.abs(incoming.rotateY)).toBeLessThan(Math.abs(side.rotateY))
  expect(center.scale).toBeGreaterThan(side.scale)
  expect(Number.isFinite(getFrameRingVisual(5, compactLayout).scaleX)).toBe(true)
  expect(side.y).toBeLessThan(0)
  expect(getFrameRingVisual(-3, fullHdLayout).x).toBeCloseTo(
    -getFrameRingVisual(3, fullHdLayout).x,
  )
  expect(getFrameRingVisual(-5, compactLayout).rotateY).toBeCloseTo(
    -getFrameRingVisual(5, compactLayout).rotateY,
  )
  expect(range.end - range.start).toBeLessThanOrEqual(13)
  expect(getFrameRingVisual(6, fullHdLayout).opacity).toBe(0)
  expect(clampFramePosition(-4, 96)).toBe(0)
  expect(clampFramePosition(140, 96)).toBe(95)
})

test('aligns frame-ring breadcrumb and search to the Aurora logo center line', () => {
  const layout = resolveFrameRingLayout({ width: 1706, height: 956 })

  expect(FRAME_RING_BASE_LAYOUT.breadcrumb.top).toBe(AURORA_TOPBAR_CENTER_Y)
  expect(layout.breadcrumb.top).toBe(AURORA_TOPBAR_CENTER_Y)
  expect(layout.search.top + layout.search.height / 2).toBe(AURORA_TOPBAR_CENTER_Y)
})

test('uses one conditional preview geometry without changing the ready frame-ring layout', () => {
  const layout = resolveFrameRingLayout({ width: 1706, height: 956 })
  const legacyReadyVariables = getFrameRingCssVariables(layout)
  const readyVariables = getFrameRingCssVariables(layout, { hasFrameRing: true })
  const emptyVariables = getFrameRingCssVariables(layout, { hasFrameRing: false })

  expect(readyVariables).toEqual(legacyReadyVariables)
  expect(readyVariables['--frame-ring-preview-x']).toBe('860px')
  expect(readyVariables['--frame-ring-preview-y']).toBe('68.832px')
  expect(readyVariables['--frame-ring-preview-scale']).toBe('1.4')
  expect(readyVariables['--frame-ring-floating-floor-y']).toBe('625px')

  expect(emptyVariables['--frame-ring-preview-x']).toBe(
    `${layout.plane.left + layout.plane.width / 2}px`,
  )
  expect(emptyVariables['--frame-ring-preview-y']).toBe('120px')
  expect(emptyVariables['--frame-ring-preview-scale']).toBe('1.5')
  expect(emptyVariables['--frame-ring-floating-floor-y']).toBe('696.307px')

  const conditionalVariables = new Set([
    '--frame-ring-preview-x',
    '--frame-ring-preview-y',
    '--frame-ring-preview-scale',
    '--frame-ring-floating-floor-y',
  ])
  for (const [name, value] of Object.entries(readyVariables)) {
    if (conditionalVariables.has(name)) continue
    expect(emptyVariables[name as keyof typeof emptyVariables]).toBe(value)
  }
})

test('keeps reflected side-card perspective on the same horizontal projection', () => {
  const stageOffset = new THREE.Matrix4().makeTranslation(88, 338, 0)
  const perspective = createCssPerspectiveMatrix(1180, 557, 130)
  const cardMatrix = new THREE.Matrix4()
    .makeTranslation(470, 180, 105)
    .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(56)))
  const floorY = 280
  const foreground = stageOffset.clone().multiply(perspective).multiply(cardMatrix)
  const reflection = createFrameRingReflectionMatrix(
    stageOffset,
    perspective,
    floorY,
    cardMatrix,
  )

  const foregroundLeft = projectCssPoint(foreground, 0, 0)
  const foregroundRight = projectCssPoint(foreground, 170, 0)
  const reflectedLeft = projectCssPoint(reflection, 0, 0)
  const reflectedRight = projectCssPoint(reflection, 170, 0)

  expect(reflectedLeft.x).toBeCloseTo(foregroundLeft.x, 6)
  expect(reflectedRight.x).toBeCloseTo(foregroundRight.x, 6)
  expect(Math.sign(reflectedRight.x - reflectedLeft.x)).toBe(
    Math.sign(foregroundRight.x - foregroundLeft.x),
  )
})

test('caps frame-ring reflection sampling at its eleven-source renderer capacity', () => {
  const originalGetComputedStyle = globalThis.getComputedStyle
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: (element: HTMLElement) =>
      ({
        opacity: '1',
        zIndex: element.dataset.paintOrder ?? '0',
      }) as CSSStyleDeclaration,
  })

  try {
    const elements = Array.from({ length: 13 }, (_, index) => {
      const offset = index - 6
      return {
        classList: { contains: () => offset === 0 },
        dataset: {
          frameId: `frame-${index}`,
          frameOffset: String(offset),
          paintOrder: String(100 - Math.abs(offset)),
          reflectionIndex: String(index),
        },
        getBoundingClientRect: () =>
          ({
            left: 500 + offset * 80,
            right: 620 + offset * 80,
            top: 200 + Math.abs(offset) * 2,
            bottom: 275 + Math.abs(offset) * 2,
            width: 120,
            height: 75,
            x: 500 + offset * 80,
            y: 200 + Math.abs(offset) * 2,
            toJSON: () => ({}),
          }) as DOMRect,
        querySelector: () => null,
      } as unknown as HTMLElement
    })
    const stage = {
      getBoundingClientRect: () =>
        ({
          left: 0,
          right: 1200,
          top: 0,
          bottom: 700,
          width: 1200,
          height: 700,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
      querySelectorAll: () => elements,
      querySelector: () => null,
    } as unknown as HTMLElement

    const snapshot = sampleFrameRingReflections(stage)
    const reflectedIds = new Set(snapshot.samples.map((sample) => sample.projectId))

    expect(FRAME_RING_CARD_REFLECTION_CAPACITY).toBe(11)
    expect(FRAME_RING_REFLECTION_SOURCE_CAPACITY).toBe(14)
    expect(snapshot.samples).toHaveLength(11)
    expect(reflectedIds.has('frame-0')).toBe(false)
    expect(reflectedIds.has('frame-12')).toBe(false)
    expect(reflectedIds.has('frame-6')).toBe(true)
  } finally {
    if (originalGetComputedStyle) {
      Object.defineProperty(globalThis, 'getComputedStyle', {
        configurable: true,
        value: originalGetComputedStyle,
      })
    } else {
      Reflect.deleteProperty(globalThis, 'getComputedStyle')
    }
  }
})
