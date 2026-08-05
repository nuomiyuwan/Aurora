export interface BilibiliWebviewElement extends HTMLElement {
  executeJavaScript(
    code: string,
    userGesture?: boolean,
  ): Promise<unknown>
}

interface BilibiliVisibilityDocument {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: EventListener): void
  removeEventListener(type: 'visibilitychange', listener: EventListener): void
}

export interface BilibiliReflectionCaptureOptions {
  active: boolean
  reflectionActive: boolean
  onReflectionFrame?: (dataUrl: string | null) => void
  captureReflectionFrame?: () => Promise<string | null>
}

export interface BilibiliWebviewLifecycleOptions {
  onReady?: (webview: BilibiliWebviewElement) => void | Promise<void>
  active?: boolean
  reflectionActive?: boolean
  onReflectionFrame?: (dataUrl: string | null) => void
  captureReflectionFrame?: () => Promise<string | null>
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
  setTimer?: (callback: () => void, delayMs: number) => number
  clearTimer?: (handle: number) => void
  visibilityDocument?: BilibiliVisibilityDocument | null
  reflectionIntervalMs?: number
}

export interface BilibiliWebviewLifecycleController {
  dispose(): void
  updateReflectionCapture(options: BilibiliReflectionCaptureOptions): void
}

const GUEST_RESIZE_SCRIPT = `(() => {
  window.dispatchEvent(new Event('resize'))
  return true
})()`

const DEFAULT_REFLECTION_CAPTURE_DELAY_MS = 800
export function installBilibiliWebviewLifecycle(
  webview: BilibiliWebviewElement,
  options: BilibiliWebviewLifecycleOptions = {},
): BilibiliWebviewLifecycleController {
  const requestFrame =
    options.requestFrame ?? window.requestAnimationFrame.bind(window)
  const cancelFrame =
    options.cancelFrame ?? window.cancelAnimationFrame.bind(window)
  const setTimer = options.setTimer ?? ((callback, delayMs) => (
    window.setTimeout(callback, delayMs)
  ))
  const clearTimer = options.clearTimer ?? ((handle) => {
    window.clearTimeout(handle)
  })
  const visibilityDocument = options.visibilityDocument === undefined
    ? (typeof document === 'undefined' ? null : document)
    : options.visibilityDocument
  const reflectionIntervalMs = Math.max(
    250,
    Math.round(
      options.reflectionIntervalMs ?? DEFAULT_REFLECTION_CAPTURE_DELAY_MS,
    ),
  )
  let firstRecoveryFrame: number | null = null
  let secondRecoveryFrame: number | null = null
  let thirdRecoveryFrame: number | null = null
  let originalInlineGeometry: {
    display: string
    width: string
    height: string
  } | null = null
  let captureTimer: number | null = null
  let captureInFlight = false
  let captureGeneration = 0
  // Start optimistically so a cached guest that finishes before React installs
  // its listeners can still be captured. The main-process bridge returns null
  // until the protected guest is actually ready, so the existing retry path is
  // the authority here.
  let guestReady = true
  let htmlFullscreen = false
  let reflectionFrameComplete = false
  let disposed = false
  let captureOptions: BilibiliReflectionCaptureOptions = {
    active: options.active ?? true,
    reflectionActive: options.reflectionActive ?? false,
    onReflectionFrame: options.onReflectionFrame,
    captureReflectionFrame: options.captureReflectionFrame,
  }

  const emitReflectionFrame = (dataUrl: string | null) => {
    try {
      captureOptions.onReflectionFrame?.(dataUrl)
    } catch {
      // Reflection is best-effort and must never interrupt playback.
    }
  }

  const clearCaptureTimer = () => {
    if (captureTimer === null) return
    clearTimer(captureTimer)
    captureTimer = null
  }

  const canCaptureReflection = () => (
    !disposed &&
    webview.isConnected !== false &&
    guestReady &&
    !htmlFullscreen &&
    !reflectionFrameComplete &&
    captureOptions.active &&
    captureOptions.reflectionActive &&
    Boolean(captureOptions.onReflectionFrame) &&
    Boolean(captureOptions.captureReflectionFrame) &&
    visibilityDocument?.hidden !== true
  )

  const pausePendingReflectionCapture = () => {
    if (reflectionFrameComplete) return
    captureGeneration += 1
    clearCaptureTimer()
  }

  let scheduleReflectionCapture = (_delayMs = 0) => undefined

  const captureReflectionFrame = async () => {
    captureTimer = null
    if (!canCaptureReflection()) return
    if (captureInFlight) {
      scheduleReflectionCapture(reflectionIntervalMs)
      return
    }

    captureInFlight = true
    const generation = captureGeneration
    try {
      const dataUrl = await captureOptions.captureReflectionFrame?.()
      if (generation !== captureGeneration || !canCaptureReflection()) return
      if (!dataUrl?.startsWith('data:image/')) return
      reflectionFrameComplete = true
      emitReflectionFrame(dataUrl)
    } catch {
      // Empty and transiently failed captures retry at the same low frequency.
    } finally {
      captureInFlight = false
      if (canCaptureReflection()) {
        scheduleReflectionCapture(reflectionIntervalMs)
      }
    }
  }

  scheduleReflectionCapture = (delayMs = 0) => {
    if (!canCaptureReflection() || captureTimer !== null || captureInFlight) {
      return
    }
    captureTimer = setTimer(() => {
      void captureReflectionFrame()
    }, delayMs)
  }

  const restoreGeometry = () => {
    if (!originalInlineGeometry) return
    webview.style.display = originalInlineGeometry.display
    webview.style.width = originalInlineGeometry.width
    webview.style.height = originalInlineGeometry.height
    originalInlineGeometry = null
  }

  const cancelRecovery = () => {
    if (firstRecoveryFrame !== null) {
      cancelFrame(firstRecoveryFrame)
      firstRecoveryFrame = null
    }
    if (secondRecoveryFrame !== null) {
      cancelFrame(secondRecoveryFrame)
      secondRecoveryFrame = null
    }
    if (thirdRecoveryFrame !== null) {
      cancelFrame(thirdRecoveryFrame)
      thirdRecoveryFrame = null
    }
    restoreGeometry()
    delete webview.dataset.geometryRecovering
  }

  const handleReady = () => {
    guestReady = true
    if (options.onReady) {
      try {
        void Promise.resolve(options.onReady(webview)).catch(() => undefined)
      } catch {
        // A failed optional enhancement must not take down official playback.
      }
    }
    scheduleReflectionCapture(reflectionIntervalMs)
  }

  const handleLoading = () => {
    guestReady = false
    pausePendingReflectionCapture()
  }

  const handleLoadingSettled = () => {
    guestReady = true
    scheduleReflectionCapture(reflectionIntervalMs)
  }

  const handleEnterFullscreen = () => {
    cancelRecovery()
    htmlFullscreen = true
    webview.dataset.htmlFullscreen = 'true'
    pausePendingReflectionCapture()
  }

  const handleLeaveFullscreen = () => {
    delete webview.dataset.htmlFullscreen
    cancelRecovery()
    htmlFullscreen = true
    pausePendingReflectionCapture()
    originalInlineGeometry = {
      display: webview.style.display,
      width: webview.style.width,
      height: webview.style.height,
    }
    webview.dataset.geometryRecovering = 'true'

    firstRecoveryFrame = requestFrame(() => {
      firstRecoveryFrame = null
      if (disposed || webview.isConnected === false) {
        restoreGeometry()
        delete webview.dataset.geometryRecovering
        return
      }

      // Electron's <webview> is backed by an out-of-process iframe. After a
      // guest exits HTML fullscreen its native input surface can retain the
      // fullscreen bounds even though the DOM is painted at the right size.
      // Detach that surface for one frame before rebuilding both axes.
      webview.style.display = 'none'
      void webview.getBoundingClientRect()

      secondRecoveryFrame = requestFrame(() => {
        secondRecoveryFrame = null
        if (disposed || webview.isConnected === false) {
          restoreGeometry()
          delete webview.dataset.geometryRecovering
          return
        }

        webview.style.display = 'flex'
        webview.style.width = 'calc(100% - 1px)'
        webview.style.height = 'calc(100% - 1px)'
        void webview.getBoundingClientRect()

        thirdRecoveryFrame = requestFrame(() => {
          thirdRecoveryFrame = null
          restoreGeometry()
          if (disposed || webview.isConnected === false) {
            delete webview.dataset.geometryRecovering
            return
          }
          void webview.getBoundingClientRect()

          try {
            void webview.executeJavaScript(GUEST_RESIZE_SCRIPT).catch(() => undefined)
          } catch {
            // The guest may have navigated or closed during recovery.
          }

          try {
            webview.focus({ preventScroll: true })
          } catch {
            try {
              webview.focus()
            } catch {
              // The guest may have detached after the connectivity check.
            }
          }

          delete webview.dataset.geometryRecovering
          htmlFullscreen = false
          scheduleReflectionCapture(reflectionIntervalMs)
        })
      })
    })
  }

  const handleVisibilityChange = () => {
    if (visibilityDocument?.hidden) {
      pausePendingReflectionCapture()
      return
    }
    scheduleReflectionCapture(reflectionIntervalMs)
  }

  webview.addEventListener('did-start-loading', handleLoading)
  webview.addEventListener('dom-ready', handleReady)
  webview.addEventListener('did-stop-loading', handleLoadingSettled)
  webview.addEventListener('did-fail-load', handleLoadingSettled)
  webview.addEventListener('enter-html-full-screen', handleEnterFullscreen)
  webview.addEventListener('leave-html-full-screen', handleLeaveFullscreen)
  visibilityDocument?.addEventListener(
    'visibilitychange',
    handleVisibilityChange,
  )

  return {
    dispose() {
      if (disposed) return
      pausePendingReflectionCapture()
      disposed = true
      webview.removeEventListener('did-start-loading', handleLoading)
      webview.removeEventListener('dom-ready', handleReady)
      webview.removeEventListener('did-stop-loading', handleLoadingSettled)
      webview.removeEventListener('did-fail-load', handleLoadingSettled)
      webview.removeEventListener(
        'enter-html-full-screen',
        handleEnterFullscreen,
      )
      webview.removeEventListener(
        'leave-html-full-screen',
        handleLeaveFullscreen,
      )
      visibilityDocument?.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
      )
      cancelRecovery()
      delete webview.dataset.htmlFullscreen
    },
    updateReflectionCapture(nextOptions) {
      const wasEnabled = (
        captureOptions.active &&
        captureOptions.reflectionActive &&
        Boolean(captureOptions.onReflectionFrame) &&
        Boolean(captureOptions.captureReflectionFrame)
      )
      captureOptions = nextOptions
      const enabled = (
        captureOptions.active &&
        captureOptions.reflectionActive &&
        Boolean(captureOptions.onReflectionFrame) &&
        Boolean(captureOptions.captureReflectionFrame)
      )
      if (!enabled) {
        pausePendingReflectionCapture()
        return
      }
      if (!wasEnabled) {
        pausePendingReflectionCapture()
      }
      scheduleReflectionCapture(reflectionIntervalMs)
    },
  }
}
