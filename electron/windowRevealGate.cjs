function createWindowRevealGate({
  reveal,
  isDestroyed,
  timeoutMs,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let nativeReady = false
  let rendererReady = false
  let revealed = false
  let disposed = false
  let fallbackTimer = null

  const dispose = () => {
    if (disposed) return
    disposed = true
    if (fallbackTimer !== null) {
      cancel(fallbackTimer)
      fallbackTimer = null
    }
  }

  const revealOnce = () => {
    if (disposed || revealed) return false
    if (isDestroyed()) {
      dispose()
      return false
    }

    revealed = true
    if (fallbackTimer !== null) {
      cancel(fallbackTimer)
      fallbackTimer = null
    }
    reveal()
    return true
  }

  const revealWhenReady = () => {
    if (nativeReady && rendererReady) revealOnce()
  }

  fallbackTimer = schedule(revealOnce, timeoutMs)

  return {
    markNativeReady() {
      if (disposed) return
      nativeReady = true
      revealWhenReady()
    },
    markRendererReady() {
      if (disposed) return
      rendererReady = true
      revealWhenReady()
    },
    dispose,
    isRevealed() {
      return revealed
    },
  }
}

module.exports = {
  createWindowRevealGate,
}
