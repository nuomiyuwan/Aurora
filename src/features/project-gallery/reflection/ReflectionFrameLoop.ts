export interface ReflectionFrameResult {
  changed: boolean
}

export interface ReflectionFrameLoopOptions {
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
  sampleAndRender: (timestamp: number) => ReflectionFrameResult
  stableFrameLimit?: number
}

export class ReflectionFrameLoop {
  running = false

  private readonly requestFrame: (callback: FrameRequestCallback) => number
  private readonly cancelFrame: (handle: number) => void
  private readonly sampleAndRender: (timestamp: number) => ReflectionFrameResult
  private readonly stableFrameLimit: number
  private frameHandle: number | null = null
  private stableFrames = 0
  private disposed = false

  constructor(options: ReflectionFrameLoopOptions) {
    this.requestFrame =
      options.requestFrame ?? ((callback) => globalThis.requestAnimationFrame(callback))
    this.cancelFrame = options.cancelFrame ?? ((handle) => globalThis.cancelAnimationFrame(handle))
    this.sampleAndRender = options.sampleAndRender
    const requestedStableFrameLimit = options.stableFrameLimit ?? 3
    this.stableFrameLimit = Number.isFinite(requestedStableFrameLimit)
      ? Math.max(1, Math.floor(requestedStableFrameLimit))
      : 3
  }

  invalidate(): void {
    if (this.disposed) return
    this.stableFrames = 0
    this.scheduleFrame()
  }

  /**
   * Renders a newly uploaded dynamic texture without extending the usual
   * multi-frame settling window. Repeated video frames can therefore wake a
   * sleeping loop at their own cadence instead of pinning WebGL to display Hz.
   */
  wakeForTextureFrame(): void {
    if (this.disposed) return
    this.scheduleFrame()
  }

  pause(): void {
    if (this.disposed) return
    if (this.frameHandle !== null) this.cancelFrame(this.frameHandle)
    this.frameHandle = null
    this.running = false
    this.stableFrames = 0
  }

  dispose(): void {
    if (this.disposed) return
    this.pause()
    this.disposed = true
  }

  private readonly onFrame: FrameRequestCallback = (timestamp) => {
    this.frameHandle = null
    if (this.disposed) {
      this.running = false
      return
    }

    const { changed } = this.sampleAndRender(timestamp)
    this.stableFrames = changed ? 0 : this.stableFrames + 1
    if (this.stableFrames >= this.stableFrameLimit) {
      this.running = false
      return
    }
    this.scheduleFrame()
  }

  private scheduleFrame(): void {
    if (this.disposed || this.frameHandle !== null) return
    this.running = true
    this.frameHandle = this.requestFrame(this.onFrame)
  }
}
