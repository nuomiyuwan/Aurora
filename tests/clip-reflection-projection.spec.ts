import { expect, test } from '@playwright/test'
import { projectCssPoint } from '../src/features/project-gallery/reflection/domCardProjection'
import {
  sampleVideoClipReflections,
  VIDEO_CLIP_FALLBACK_REFLECTION_OPACITY,
  VIDEO_DETAIL_REFLECTION_OPACITY,
} from '../src/features/video-library/clipReflectionProjection'
import {
  DETAIL_PANEL_ALPHA_BOTTOM,
  SQUARE_CARD_ALPHA_BOTTOM,
} from '../src/features/video-library/videoClipGeometry'
import { VIDEO_DETAIL_REFLECTION_ID } from '../src/features/video-library/videoReflectionSource'

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }) as DOMRect

test('samples only the bottom clip row into one shared screen-space reflection plane', () => {
  const first = {
    dataset: { clipId: 'clip-a', reflectionIndex: '4' },
    getBoundingClientRect: () => rect(180, 560, 280, 264),
    __style: { opacity: '0.9', zIndex: '12' },
  } as unknown as HTMLElement
  const second = {
    dataset: { clipId: 'clip-b', reflectionIndex: '5' },
    getBoundingClientRect: () => rect(470, 560, 260, 264),
    __style: { opacity: '1', zIndex: '11' },
  } as unknown as HTMLElement
  const stage = {
    getBoundingClientRect: () => rect(0, 0, 1672, 941),
    querySelectorAll: (selector: string) =>
      selector === '.videoClipCard.clipRowBottom' ? [first, second] : [],
  } as unknown as HTMLElement
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle')
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: (element: HTMLElement) =>
      (element as unknown as { __style: CSSStyleDeclaration }).__style,
  })

  try {
    const snapshot = sampleVideoClipReflections(stage)
    expect(snapshot.width).toBe(1672)
    expect(snapshot.height).toBe(941)
    expect(snapshot.samples).toHaveLength(2)
    expect(snapshot.samples.map(({ projectIndex }) => projectIndex)).toEqual([4, 5])
    expect(snapshot.samples[0].reflectionOpacity).toBe(
      VIDEO_CLIP_FALLBACK_REFLECTION_OPACITY,
    )
    expect(snapshot.samples[0].paintOrder).toBe(12)

    const contactY = 560 + 264 * SQUARE_CARD_ALPHA_BOTTOM
    expect(
      projectCssPoint(
        snapshot.samples[0].reflectionMatrix,
        0,
        264 * SQUARE_CARD_ALPHA_BOTTOM,
      ).y,
    ).toBeCloseTo(contactY, 6)
    expect(projectCssPoint(snapshot.samples[0].reflectionMatrix, 0, 0).y).toBeGreaterThan(
      contactY,
    )
  } finally {
    if (previous) Object.defineProperty(globalThis, 'getComputedStyle', previous)
    else Reflect.deleteProperty(globalThis, 'getComputedStyle')
  }
})

test('locks the detail panel reflection to the panel bottom edge', () => {
  const clip = {
    dataset: { clipId: 'clip-a', reflectionIndex: '4' },
    getBoundingClientRect: () => rect(180, 560, 280, 264),
    __style: { opacity: '1', zIndex: '16' },
  } as unknown as HTMLElement
  const panel = {
    dataset: { clipId: 'clip-a', reflectionIndex: '8' },
    getBoundingClientRect: () => rect(1320, 180, 300, 650),
    __style: { opacity: '0.94', zIndex: '32' },
  } as unknown as HTMLElement
  const stage = {
    getBoundingClientRect: () => rect(0, 0, 1672, 941),
    querySelectorAll: () => [clip],
    querySelector: () => panel,
  } as unknown as HTMLElement
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle')
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: (element: HTMLElement) =>
      (element as unknown as { __style: CSSStyleDeclaration }).__style,
  })

  try {
    const snapshot = sampleVideoClipReflections(stage)
    const detail = snapshot.samples.find(
      (sample) => sample.projectId === VIDEO_DETAIL_REFLECTION_ID,
    )
    expect(detail).toBeDefined()
    expect(detail?.reflectionOpacity).toBe(VIDEO_DETAIL_REFLECTION_OPACITY)
    expect(detail?.height).toBeCloseTo(650, 6)
    expect(detail?.sourceAlphaBottom).toBe(DETAIL_PANEL_ALPHA_BOTTOM)
    expect(
      projectCssPoint(
        detail!.reflectionMatrix,
        0,
        detail!.height * DETAIL_PANEL_ALPHA_BOTTOM,
      ).y,
    ).toBeCloseTo(180 + 650 * DETAIL_PANEL_ALPHA_BOTTOM, 6)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'getComputedStyle', previous)
    else Reflect.deleteProperty(globalThis, 'getComputedStyle')
  }
})

test('isolates video and model reflection samples by explicit source scope', () => {
  const createCard = (
    clipId: string,
    reflectionIndex: number,
    left: number,
  ) => ({
    dataset: { clipId, reflectionIndex: String(reflectionIndex) },
    getBoundingClientRect: () => rect(left, 560, 280, 264),
    querySelector: () => null,
    __style: { opacity: '1', zIndex: String(reflectionIndex) },
  }) as unknown as HTMLElement
  const createPanel = (clipId: string, reflectionIndex: number, left: number) => ({
    dataset: { clipId, reflectionIndex: String(reflectionIndex) },
    getBoundingClientRect: () => rect(left, 180, 300, 650),
    querySelector: () => null,
    __style: { opacity: '1', zIndex: '32' },
  }) as unknown as HTMLElement

  const videoCard = createCard('video-card', 4, 180)
  const modelCard = createCard('model-card', 14, 680)
  const videoPanel = createPanel('video-card', 8, 1320)
  const modelPanel = createPanel('model-card', 18, 980)
  const createScope = (card: HTMLElement, panel: HTMLElement) => ({
    querySelectorAll: (selector: string) =>
      selector === '.reflection-source' ? [card] : [],
    querySelector: (selector: string) =>
      selector === '.clipDetailPanel[data-detail-reflection]' ? panel : null,
  }) as unknown as HTMLElement
  const videoScope = createScope(videoCard, videoPanel)
  const modelScope = createScope(modelCard, modelPanel)
  const stage = {
    getBoundingClientRect: () => rect(0, 0, 1672, 941),
    querySelector: (selector: string) => {
      if (selector === '.video-scope') return videoScope
      if (selector === '.model-scope') return modelScope
      if (selector === '.clipDetailPanel[data-detail-reflection]') return videoPanel
      return null
    },
    querySelectorAll: (selector: string) =>
      selector === '.reflection-source' ? [videoCard, modelCard] : [],
  } as unknown as HTMLElement
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle')
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: (element: HTMLElement) =>
      (element as unknown as { __style: CSSStyleDeclaration }).__style,
  })

  try {
    const videoSnapshot = sampleVideoClipReflections(stage, {
      sourceScopeSelector: '.video-scope',
      cardSelector: '.reflection-source',
    })
    const modelSnapshot = sampleVideoClipReflections(stage, {
      sourceScopeSelector: '.model-scope',
      cardSelector: '.reflection-source',
    })

    expect(videoSnapshot.samples.map(({ projectId }) => projectId)).toEqual([
      'video-card',
      VIDEO_DETAIL_REFLECTION_ID,
    ])
    expect(videoSnapshot.samples.map(({ projectIndex }) => projectIndex)).toEqual([
      4,
      8,
    ])
    expect(modelSnapshot.samples.map(({ projectId }) => projectId)).toEqual([
      'model-card',
      VIDEO_DETAIL_REFLECTION_ID,
    ])
    expect(modelSnapshot.samples.map(({ projectIndex }) => projectIndex)).toEqual([
      14,
      18,
    ])

    const missingScopeSnapshot = sampleVideoClipReflections(stage, {
      sourceScopeSelector: '.missing-scope',
      cardSelector: '.reflection-source',
    })
    expect(missingScopeSnapshot).toMatchObject({
      width: 1672,
      height: 941,
      samples: [],
      signature: '',
    })
  } finally {
    if (previous) Object.defineProperty(globalThis, 'getComputedStyle', previous)
    else Reflect.deleteProperty(globalThis, 'getComputedStyle')
  }
})
