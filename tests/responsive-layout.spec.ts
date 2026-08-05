import { expect, test } from '@playwright/test'
import {
  AURORA_LAYOUT_REFERENCE,
  AURORA_TOPBAR_CENTER_Y,
  clampLayoutValue,
  cssPx,
  resolveResponsiveMetrics,
  resolveSafeRect,
  roundLayoutValue,
} from '../src/features/responsive-layout/responsiveLayout'
import {
  VIDEO_LIBRARY_BASE_LAYOUT,
  VIDEO_LIBRARY_LAYOUT_REFERENCE,
  getClipColumnTravel,
  getVideoClipVisualStyle,
  getVideoLibraryCssVariables,
  resolveVideoLibraryLayout,
} from '../src/features/video-library/videoLibraryLayout'

test('uses 1706 × 956 as the only identity viewport', () => {
  expect(AURORA_LAYOUT_REFERENCE).toEqual({ width: 1706, height: 956 })
  expect(resolveResponsiveMetrics(AURORA_LAYOUT_REFERENCE)).toMatchObject({
    layoutScale: 1,
    planeLeft: 0,
    planeTop: 0,
    planeRight: 1706,
    planeBottom: 956,
    planeWidth: 1706,
    planeHeight: 956,
  })
})

test('scales UI and scene together without clamping the design plane', () => {
  const large = resolveResponsiveMetrics({ width: 3840, height: 2160 })
  const small = resolveResponsiveMetrics({ width: 1280, height: 720 })
  expect(large.layoutScale).toBeCloseTo(
    Math.min(3840 / AURORA_LAYOUT_REFERENCE.width, 2160 / AURORA_LAYOUT_REFERENCE.height),
    9,
  )
  expect(small.layoutScale).toBeCloseTo(1280 / 1706, 9)
})

test('normalizes non-finite and sub-one viewport dimensions', () => {
  const expected = {
    width: 1,
    height: 1,
    layoutScale: 1 / AURORA_LAYOUT_REFERENCE.width,
    planeLeft: 0,
    planeTop: (1 - AURORA_LAYOUT_REFERENCE.height / AURORA_LAYOUT_REFERENCE.width) / 2,
    planeRight: 1,
    planeBottom:
      (1 + AURORA_LAYOUT_REFERENCE.height / AURORA_LAYOUT_REFERENCE.width) / 2,
    planeWidth: 1,
    planeHeight: AURORA_LAYOUT_REFERENCE.height / AURORA_LAYOUT_REFERENCE.width,
    rightInset: 0,
    bottomInset: (1 - AURORA_LAYOUT_REFERENCE.height / AURORA_LAYOUT_REFERENCE.width) / 2,
  }

  expect(resolveResponsiveMetrics({ width: Number.NaN, height: -720 })).toEqual(expected)
  expect(resolveResponsiveMetrics({ width: Number.POSITIVE_INFINITY, height: 0.5 })).toEqual(expected)
})

test('derives a valid content rectangle from page-owned insets', () => {
  expect(resolveSafeRect(
    { width: 1644, height: 1002 },
    { top: 96, right: 340, bottom: 64, left: 116 },
  )).toEqual({ left: 116, top: 96, right: 1304, bottom: 938, width: 1188, height: 842 })
})

test('normalizes invalid safe-rectangle inputs and collapses crossed insets', () => {
  expect(resolveSafeRect(
    { width: Number.NaN, height: -80 },
    { top: 0, right: 0, bottom: 0, left: 0 },
  )).toEqual({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 })

  expect(resolveSafeRect(
    { width: 100, height: 80 },
    { top: Number.NaN, right: -20, bottom: Number.POSITIVE_INFINITY, left: -10 },
  )).toEqual({ left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 })

  expect(resolveSafeRect(
    { width: 100, height: 80 },
    { top: 200, right: 200, bottom: 200, left: 200 },
  )).toEqual({ left: 100, top: 80, right: 100, bottom: 80, width: 0, height: 0 })
})

test('returns stable fallbacks for non-finite layout values', () => {
  expect(clampLayoutValue(Number.NaN, 2, 5)).toBe(2)
  expect(roundLayoutValue(Number.NaN)).toBe(0)
  expect(roundLayoutValue(Number.POSITIVE_INFINITY)).toBe(0)
  expect(roundLayoutValue(Number.NEGATIVE_INFINITY)).toBe(0)
  expect(cssPx(Number.NaN)).toBe('0px')
})

test('preserves the tuned 1706 x 956 video-library composition', () => {
  const layout = resolveVideoLibraryLayout(VIDEO_LIBRARY_LAYOUT_REFERENCE)
  expect(VIDEO_LIBRARY_BASE_LAYOUT.contentScale).toBe(0.938114)
  expect(layout.header).toEqual({ top: 98.502, left: 153.851 })
  expect(layout.toolbar).toEqual({ top: 118.202, left: 750.491 })
  expect(layout.grid.left).toBeCloseTo(VIDEO_LIBRARY_BASE_LAYOUT.grid.left, 3)
  expect(layout.grid.top).toBeCloseTo(VIDEO_LIBRARY_BASE_LAYOUT.grid.top, 3)
  expect(layout.grid.width).toBeCloseTo(VIDEO_LIBRARY_BASE_LAYOUT.grid.width, 3)
  expect(layout.card.size).toBeCloseTo(VIDEO_LIBRARY_BASE_LAYOUT.card.size, 3)
  expect(layout.card.anchorOffsetX).toBeCloseTo(
    VIDEO_LIBRARY_BASE_LAYOUT.card.anchorOffsetX,
    3,
  )
  expect(layout.panel.right).toBe(VIDEO_LIBRARY_LAYOUT_REFERENCE.width)
  expect(layout.layoutScale).toBe(1)
  expect(layout.sceneScale).toBe(1)
  expect(layout.uiContentScale).toBe(VIDEO_LIBRARY_BASE_LAYOUT.contentScale)
  expect(layout.cardContentScale).toBe(VIDEO_LIBRARY_BASE_LAYOUT.contentScale)
  expect(layout.panelContentScale).toBe(VIDEO_LIBRARY_BASE_LAYOUT.contentScale)
  expect(layout.search.top + layout.search.height / 2).toBeCloseTo(
    AURORA_TOPBAR_CENTER_Y,
    3,
  )
})

test('calibrates small-window content without scaling resolved geometry twice', () => {
  const layout = resolveVideoLibraryLayout({ width: 1280, height: 720 })
  const expectedScale = 1280 / VIDEO_LIBRARY_LAYOUT_REFERENCE.width
  expect(layout.uiScale).toBeCloseTo(expectedScale, 3)
  expect(layout.sceneScale).toBe(layout.uiScale)
  expect(layout.uiContentScale).toBeCloseTo(
    layout.uiScale * VIDEO_LIBRARY_BASE_LAYOUT.contentScale,
    9,
  )
  expect(layout.cardContentScale).toBe(layout.uiContentScale)
  expect(layout.panelContentScale).toBe(layout.uiContentScale)
  expect(layout.search.width).toBe(
    roundLayoutValue(VIDEO_LIBRARY_BASE_LAYOUT.search.width * layout.uiScale),
  )
  expect(layout.card.size).toBe(
    roundLayoutValue(VIDEO_LIBRARY_BASE_LAYOUT.card.size * layout.sceneScale),
  )
  expect(layout.panel.width).toBe(
    roundLayoutValue(VIDEO_LIBRARY_BASE_LAYOUT.panel.width * layout.sceneScale),
  )
  expect(getVideoLibraryCssVariables(layout)['--detail-ui-scale']).toBe(
    String(roundLayoutValue(expectedScale * VIDEO_LIBRARY_BASE_LAYOUT.contentScale)),
  )
})

test('uniformly scales the complete video-library design plane', () => {
  const baseline = resolveVideoLibraryLayout(VIDEO_LIBRARY_LAYOUT_REFERENCE)
  const large = resolveVideoLibraryLayout({ width: 2560, height: 1440 })
  const ultra = resolveVideoLibraryLayout({ width: 3440, height: 1440 })
  for (const layout of [baseline, large, ultra]) {
    expect(layout.grid.right).toBeLessThanOrEqual(layout.safeRect.right)
    expect(layout.safeRect.right).toBeLessThanOrEqual(
      roundLayoutValue(layout.panel.left - layout.panelGap),
    )
    expect(layout.panel.right).toBeLessThanOrEqual(layout.viewport.width)
  }
  const scale = large.layoutScale
  expect(large.uiScale).toBe(scale)
  expect(large.sceneScale).toBe(scale)
  expect(large.cardScale).toBe(scale)
  expect(large.panelScale).toBe(scale)
  expect(large.card.size).toBe(
    roundLayoutValue(VIDEO_LIBRARY_BASE_LAYOUT.card.size * scale),
  )
  expect(large.grid.width).toBe(
    roundLayoutValue(VIDEO_LIBRARY_BASE_LAYOUT.grid.width * scale),
  )
  expect(large.panel.width).toBe(
    roundLayoutValue(VIDEO_LIBRARY_BASE_LAYOUT.panel.width * scale),
  )
  expect(ultra.layoutScale).toBeCloseTo(1440 / VIDEO_LIBRARY_LAYOUT_REFERENCE.height, 3)
  expect(ultra.grid.left).toBeGreaterThan(large.grid.left)
})

test('keeps grid and panel geometry valid at every acceptance viewport', () => {
  const viewports = [
    { width: 1644, height: 1002 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 3440, height: 1440 },
    { width: 3840, height: 2160 },
  ]

  for (const viewport of viewports) {
    const layout = resolveVideoLibraryLayout(viewport)
    expect(layout.safeRect.width).toBeGreaterThan(0)
    expect(layout.safeRect.height).toBeGreaterThan(0)
    expect(layout.safeRect.right).toBeLessThanOrEqual(
      roundLayoutValue(layout.panel.left - layout.panelGap),
    )
    expect(layout.safeRect.bottom).toBeLessThanOrEqual(layout.viewport.height)
    expect(layout.grid.left).toBe(layout.safeRect.left)
    expect(layout.grid.top).toBe(layout.safeRect.top)
    expect(layout.grid.bottom).toBe(layout.safeRect.bottom)
    expect(layout.grid.right).toBeLessThanOrEqual(layout.safeRect.right)
    expect(layout.grid.width).toBeLessThanOrEqual(layout.safeRect.width)
    expect(layout.panel.left).toBeGreaterThanOrEqual(0)
    expect(layout.panel.right).toBeLessThanOrEqual(layout.viewport.width)
    expect(layout.panel.bottom).toBeLessThanOrEqual(layout.viewport.height)
  }
})

test('clamps every video-library rectangle for invalid viewports', () => {
  for (const viewport of [
    { width: Number.NaN, height: -100 },
    { width: Number.POSITIVE_INFINITY, height: Number.NEGATIVE_INFINITY },
  ]) {
    const layout = resolveVideoLibraryLayout(viewport)
    expect(layout.viewport).toEqual({ width: 1, height: 1 })

    for (const value of [
      layout.panel.left,
      layout.panel.top,
      layout.panel.right,
      layout.panel.bottom,
      layout.panel.width,
      layout.panel.height,
      layout.safeRect.left,
      layout.safeRect.top,
      layout.safeRect.right,
      layout.safeRect.bottom,
      layout.safeRect.width,
      layout.safeRect.height,
      layout.grid.left,
      layout.grid.top,
      layout.grid.right,
      layout.grid.bottom,
      layout.grid.width,
      layout.grid.height,
    ]) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }

    expect(layout.panel.left).toBeLessThanOrEqual(layout.panel.right)
    expect(layout.panel.top).toBeLessThanOrEqual(layout.panel.bottom)
    expect(layout.safeRect.left).toBeLessThanOrEqual(layout.safeRect.right)
    expect(layout.safeRect.top).toBeLessThanOrEqual(layout.safeRect.bottom)
    expect(layout.grid.right).toBeLessThanOrEqual(layout.safeRect.right)
  }
})

test('derives clip variables and travel from the single video-library configuration', () => {
  const baseline = resolveVideoLibraryLayout(VIDEO_LIBRARY_LAYOUT_REFERENCE)
  expect(baseline.columns).toEqual(VIDEO_LIBRARY_BASE_LAYOUT.columns)
  expect(baseline.rows).toEqual({ top: 0, bottom: 50 })
  expect(getVideoClipVisualStyle(1, 2, baseline)).toEqual({
    '--clip-x': `${VIDEO_LIBRARY_BASE_LAYOUT.columns.x[2]}%`,
    '--clip-y': '50%',
    '--clip-depth': '-76.327px',
    '--clip-rotate-y': '3deg',
    '--clip-rotate-x': '0deg',
    '--clip-rotate-z': '0deg',
    '--clip-scale': '1',
    '--clip-scale-y': '1',
    '--clip-opacity': '1',
    '--clip-z-index': '16',
    '--clip-reflection-opacity': '0',
  })
  expect(getClipColumnTravel(baseline.grid.width, baseline.columns)).toBe(baseline.columnTravel)
  expect(baseline.columnTravel).toBeCloseTo(
    baseline.grid.width *
      ((VIDEO_LIBRARY_BASE_LAYOUT.columns.x[1] - VIDEO_LIBRARY_BASE_LAYOUT.columns.x[0]) / 100),
    3,
  )

  const customColumns = {
    x: [0, 10, 40, 100],
    rotateY: [0, 0, 0, 0],
    depth: [0, 0, 0, 0],
    scale: [1, 1, 1, 1],
  } as const
  expect(getClipColumnTravel(500, customColumns)).toBe(50)

  const wide = resolveVideoLibraryLayout({ width: 2560, height: 1440 })
  expect(wide.rows).toEqual({ top: 0, bottom: 50 })
  expect(getVideoClipVisualStyle(0, 2, wide)['--clip-y']).toBe('0%')
  expect(getVideoClipVisualStyle(1, 2, wide)['--clip-y']).toBe('50%')
  const wideDepth = `${roundLayoutValue(
    VIDEO_LIBRARY_BASE_LAYOUT.columns.depth[2] * wide.sceneScale,
  )}px`
  expect(getVideoClipVisualStyle(0, 2, wide)['--clip-depth']).toBe(wideDepth)
  expect(
    getVideoClipVisualStyle(0, 2, {
      ...wide,
      cardScale: wide.cardContentScale,
    })['--clip-depth'],
  ).toBe(wideDepth)
})

test('keeps clip motion continuous across column boundaries', () => {
  const layout = resolveVideoLibraryLayout(VIDEO_LIBRARY_LAYOUT_REFERENCE)
  const before = getVideoClipVisualStyle(0, 0.99, layout)
  const after = getVideoClipVisualStyle(0, 1.01, layout)

  expect(parseFloat(before['--clip-x'])).toBeLessThan(VIDEO_LIBRARY_BASE_LAYOUT.columns.x[1])
  expect(parseFloat(after['--clip-x'])).toBeGreaterThan(VIDEO_LIBRARY_BASE_LAYOUT.columns.x[1])
  for (const property of ['--clip-depth', '--clip-rotate-y', '--clip-scale'] as const) {
    expect(Math.abs(parseFloat(before[property]) - parseFloat(after[property]))).toBeLessThan(0.1)
  }
  expect(before['--clip-opacity']).toBe('1')
  expect(after['--clip-opacity']).toBe('1')
})

test('extrapolates clip x while bounding motion and fading outside edges', () => {
  const layout = resolveVideoLibraryLayout(VIDEO_LIBRARY_LAYOUT_REFERENCE)
  const before = getVideoClipVisualStyle(0, -0.25, layout)
  const after = getVideoClipVisualStyle(1, 3.25, layout)

  expect(before).toMatchObject({
    '--clip-x': `${roundLayoutValue(
      VIDEO_LIBRARY_BASE_LAYOUT.columns.x[0]
        - (VIDEO_LIBRARY_BASE_LAYOUT.columns.x[1] - VIDEO_LIBRARY_BASE_LAYOUT.columns.x[0]) * 0.25,
    )}%`,
    '--clip-y': '0%',
    '--clip-depth': '0px',
    '--clip-rotate-y': '12deg',
    '--clip-scale': '1',
    '--clip-opacity': '0.5',
    '--clip-z-index': '18',
  })
  expect(after).toMatchObject({
    '--clip-x': `${roundLayoutValue(
      VIDEO_LIBRARY_BASE_LAYOUT.columns.x[2]
        + (VIDEO_LIBRARY_BASE_LAYOUT.columns.x[3] - VIDEO_LIBRARY_BASE_LAYOUT.columns.x[2]) * 1.25,
    )}%`,
    '--clip-y': '50%',
    '--clip-depth': '-38.164px',
    '--clip-rotate-y': '-28deg',
    '--clip-scale': '1',
    '--clip-opacity': '0.5',
    '--clip-z-index': '16',
  })
})

test('falls back to the first visual slot for non-finite clip positions', () => {
  const layout = resolveVideoLibraryLayout(VIDEO_LIBRARY_LAYOUT_REFERENCE)
  const fallback = getVideoClipVisualStyle(0, 0, layout)
  expect(getVideoClipVisualStyle(0, Number.NaN, layout)).toEqual(fallback)
  expect(getVideoClipVisualStyle(0, Number.POSITIVE_INFINITY, layout)).toEqual(fallback)
  expect(getVideoClipVisualStyle(0, Number.NEGATIVE_INFINITY, layout)).toEqual(fallback)
})

test('serializes one shared video-library scale', () => {
  const layout = resolveVideoLibraryLayout({ width: 2560, height: 1440 })
  const variables = getVideoLibraryCssVariables(layout)
  expect(layout.uiScale).toBe(layout.sceneScale)
  expect(layout.cardScale).toBe(layout.sceneScale)
  expect(layout.panelScale).toBe(layout.sceneScale)
  expect(layout.uiContentScale).toBeCloseTo(
    layout.layoutScale * VIDEO_LIBRARY_BASE_LAYOUT.contentScale,
    9,
  )
  expect(layout.cardContentScale).toBeCloseTo(
    layout.sceneScale * VIDEO_LIBRARY_BASE_LAYOUT.contentScale,
    9,
  )
  expect(layout.panelContentScale).toBe(layout.cardContentScale)
  expect(variables['--detail-ui-scale']).toBe(
    String(roundLayoutValue(layout.uiContentScale)),
  )
  expect(variables['--detail-scene-scale']).toBe(String(roundLayoutValue(layout.sceneScale)))
  expect(variables['--detail-card-scale']).toBe(
    String(roundLayoutValue(layout.cardContentScale)),
  )
  expect(variables['--detail-panel-scale']).toBe(
    String(roundLayoutValue(layout.panelContentScale)),
  )
  expect(variables['--detail-grid-left']).toBe(cssPx(layout.grid.left))
  expect(variables['--detail-panel-left']).toBe(cssPx(layout.panel.left))
  expect(variables['--detail-search-right-inset']).toBe(cssPx(layout.search.right))
  expect(variables['--detail-panel-right-edge']).toBe(cssPx(layout.panel.right))
  expect(variables['--detail-panel-bottom-edge']).toBe(cssPx(layout.panel.bottom))
  expect(variables['--detail-column-travel']).toBe(cssPx(layout.columnTravel))
  expect(variables).not.toHaveProperty('--detail-search-right')
  expect(variables).not.toHaveProperty('--detail-panel-right')
  expect(variables).not.toHaveProperty('--detail-panel-bottom')
})
