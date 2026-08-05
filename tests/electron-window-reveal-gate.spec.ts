import { expect, test } from '@playwright/test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createWindowRevealGate } = require(
  '../electron/windowRevealGate.cjs',
) as {
  createWindowRevealGate(options: {
    reveal: () => void
    isDestroyed: () => boolean
    timeoutMs: number
    schedule: (callback: () => boolean, timeoutMs: number) => number
    cancel: (timer: number) => void
  }): {
    markNativeReady(): void
    markRendererReady(): void
    dispose(): void
    isRevealed(): boolean
  }
}

function createHarness() {
  let fallback: (() => boolean) | null = null
  let showCount = 0
  let destroyed = false
  const canceledTimers: number[] = []
  const gate = createWindowRevealGate({
    reveal: () => {
      showCount += 1
    },
    isDestroyed: () => destroyed,
    timeoutMs: 8_000,
    schedule: (callback) => {
      fallback = callback
      return 42
    },
    cancel: (timer) => canceledTimers.push(timer),
  })

  return {
    gate,
    get showCount() {
      return showCount
    },
    get canceledTimers() {
      return canceledTimers
    },
    runFallback() {
      return fallback?.() ?? false
    },
    destroy() {
      destroyed = true
    },
  }
}

test('reveals only after native and renderer startup frames are both ready', () => {
  const nativeFirst = createHarness()
  nativeFirst.gate.markNativeReady()
  expect(nativeFirst.showCount).toBe(0)
  nativeFirst.gate.markRendererReady()
  expect(nativeFirst.showCount).toBe(1)
  expect(nativeFirst.gate.isRevealed()).toBe(true)
  expect(nativeFirst.canceledTimers).toEqual([42])

  const rendererFirst = createHarness()
  rendererFirst.gate.markRendererReady()
  expect(rendererFirst.showCount).toBe(0)
  rendererFirst.gate.markNativeReady()
  expect(rendererFirst.showCount).toBe(1)
  rendererFirst.gate.markNativeReady()
  rendererFirst.gate.markRendererReady()
  expect(rendererFirst.showCount).toBe(1)
})

test('uses one absolute fallback reveal and never reveals a destroyed window', () => {
  const timedOut = createHarness()
  expect(timedOut.runFallback()).toBe(true)
  expect(timedOut.showCount).toBe(1)
  timedOut.gate.markNativeReady()
  timedOut.gate.markRendererReady()
  expect(timedOut.showCount).toBe(1)

  const destroyed = createHarness()
  destroyed.destroy()
  expect(destroyed.runFallback()).toBe(false)
  destroyed.gate.markNativeReady()
  destroyed.gate.markRendererReady()
  expect(destroyed.showCount).toBe(0)
  expect(destroyed.canceledTimers).toEqual([42])
})
