import { requiresKnownVideoPreviewProxy } from '../videoPlaybackCompatibility'
import './player.css'

type PlayerState = {
  id: number
  name: string
  status: 'loading' | 'ready' | 'preparing' | 'error'
  sourceUrl: string | null
  codec: string
  durationSeconds: number | null
  fps: number | null
  usesPreviewProxy: boolean
  progress: number | null
  message: string
}

declare global {
  interface Window {
    auroraPlayer: {
      onState(listener: (state: PlayerState) => void): () => void
      ready(): void
      preparePreview(id: number): Promise<void>
      retry(id: number): void
    }
  }
}

const host = document.querySelector<HTMLElement>('#player')!
const status = document.querySelector<HTMLElement>('#status')!
const message = document.querySelector<HTMLElement>('#message')!
const retry = document.querySelector<HTMLButtonElement>('#retry')!
let state: PlayerState | null = null
let video: HTMLVideoElement | null = null
let sourceUrl: string | null = null
let previewRequestedId = 0
let resumeTime = 0
let resumePlaying = true
let resumeVolume = 1
let resumeMuted = false
let playbackReady = false
let clearVideoListeners = () => {}

function showStatus(text: string, canRetry = false) {
  message.textContent = text
  retry.hidden = !canRetry
  status.dataset.busy = String(!canRetry)
  status.hidden = false
}

function removeVideo() {
  clearVideoListeners()
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
    video = null
  }
  sourceUrl = null
  playbackReady = false
}

function requestPreview() {
  if (!state) return
  if (state.usesPreviewProxy) {
    removeVideo()
    showStatus('无法播放该视频，请重试或检查原文件。', true)
    return
  }
  if (previewRequestedId === state.id) return
  const id = state.id
  previewRequestedId = id
  if (video && playbackReady) {
    const decoded = video.getVideoPlaybackQuality().totalVideoFrames
    resumeTime = decoded > 0 ? video.currentTime : 0
    resumePlaying = !video.paused || video.ended || video.readyState === 0
    resumeVolume = video.volume
    resumeMuted = video.muted
  }
  removeVideo()
  showStatus('正在准备兼容播放…')
  void window.auroraPlayer.preparePreview(id).catch(() => {
    if (state?.id === id) showStatus('兼容播放准备失败，请重试。', true)
  })
}

function mountVideo(next: PlayerState) {
  if (!next.sourceUrl || sourceUrl === next.sourceUrl) return
  removeVideo()
  sourceUrl = next.sourceUrl
  const element = document.createElement('video')
  video = element
  element.controls = false
  element.autoplay = true
  element.muted = true
  element.volume = resumeVolume
  element.playsInline = true
  element.preload = 'auto'
  element.setAttribute('aria-label', next.name)
  element.setAttribute('controlsList', 'nodownload')
  element.tabIndex = 0
  const listeners = new AbortController()
  const options = { signal: listeners.signal }
  let timer: number | undefined
  let frameCallback: number | undefined
  let settling = false
  let startTime = resumeTime
  const clearTimer = () => window.clearTimeout(timer)
  clearVideoListeners = () => {
    clearTimer()
    if (frameCallback !== undefined) element.cancelVideoFrameCallback(frameCallback)
    listeners.abort()
  }

  const revealVideo = () => {
    if (video !== element) return
    playbackReady = true
    element.controls = true
    element.muted = resumeMuted
    status.hidden = true
    if (resumePlaying) {
      void element.play().catch((error: unknown) => {
        if (video !== element || (error instanceof DOMException && error.name === 'AbortError')) return
        requestPreview()
      })
    }
  }
  const finishPreparation = () => {
    if (video !== element || playbackReady || settling || element.seeking) return
    if (element.videoWidth === 0 || element.readyState < 2) return
    settling = true
    clearTimer()
    element.pause()
    if (Math.abs(element.currentTime - startTime) > 0.001) {
      element.addEventListener('seeked', revealVideo, { ...options, once: true })
      element.currentTime = startTime
    } else {
      revealVideo()
    }
  }
  const waitForVideoFrame = () => {
    frameCallback = element.requestVideoFrameCallback(() => {
      frameCallback = undefined
      finishPreparation()
      if (video === element && !playbackReady && !settling) waitForVideoFrame()
    })
  }
  waitForVideoFrame()

  element.addEventListener('loadedmetadata', () => {
    const duration = next.durationSeconds ?? element.duration
    if (Number.isFinite(duration)) {
      startTime = Math.min(resumeTime, Math.max(0, duration - 0.01))
      if (startTime > 0) element.currentTime = startTime
    }
  }, options)
  element.addEventListener('loadeddata', () => {
    if (element.videoWidth === 0) requestPreview()
  }, options)
  element.addEventListener('playing', () => {
    clearTimer()
    if (next.usesPreviewProxy && playbackReady) return
    const startedAt = element.currentTime
    const framesBefore = element.getVideoPlaybackQuality().totalVideoFrames
    timer = window.setTimeout(() => {
      if (video !== element || element.paused || document.hidden) return
      const quality = element.getVideoPlaybackQuality()
      const framesAfter = quality.totalVideoFrames
      if (!playbackReady && framesAfter > quality.droppedVideoFrames) {
        finishPreparation()
      }
      if (
        element.currentTime > startedAt + 0.2 &&
        (element.videoWidth === 0 || framesAfter <= framesBefore)
      ) {
        requestPreview()
      }
    }, Math.max(1800, Math.min(5000, 2500 / Math.max(0.5, next.fps ?? 25))))
  }, options)
  element.addEventListener('pause', clearTimer, options)
  element.addEventListener('ended', () => {
    clearTimer()
    const quality = element.getVideoPlaybackQuality()
    if (element.videoWidth === 0 || quality.totalVideoFrames <= quality.droppedVideoFrames) {
      requestPreview()
    } else if (!playbackReady) {
      finishPreparation()
    }
  }, options)
  element.addEventListener('error', requestPreview, options)
  element.addEventListener('dblclick', (event) => {
    if (event.offsetY < element.clientHeight - 64) void toggleFullscreen()
  }, options)
  element.src = next.sourceUrl
  host.append(element)
  element.focus()
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else if (video) await video.requestFullscreen()
  } catch {
    return
  }
}

window.auroraPlayer.onState((next) => {
  if (state?.id !== next.id) {
    removeVideo()
    previewRequestedId = 0
    resumeTime = 0
    resumePlaying = true
    resumeVolume = 1
    resumeMuted = false
  }
  state = next
  document.title = `${next.name} — Aurora 播放器`
  if (next.status === 'loading' || next.status === 'preparing') {
    const progress = next.progress === null
      ? ''
      : ` ${Math.round(Math.max(0, Math.min(1, next.progress)) * 100)}%`
    showStatus(`${next.message}${progress}`)
  } else if (next.status === 'error') {
    removeVideo()
    showStatus(next.message, true)
  } else if (!next.usesPreviewProxy && requiresKnownVideoPreviewProxy(next.codec)) {
    requestPreview()
  } else {
    if (sourceUrl !== next.sourceUrl || !video || !playbackReady) {
      showStatus('正在加载视频…')
    } else {
      status.hidden = true
    }
    mountVideo(next)
  }
})

retry.addEventListener('click', () => {
  if (state) window.auroraPlayer.retry(state.id)
})
window.addEventListener('keydown', (event) => {
  if (!video || !playbackReady || event.metaKey || event.ctrlKey || event.altKey) return
  if (event.target instanceof HTMLButtonElement) return
  const duration = state?.durationSeconds ?? video.duration
  switch (event.key.toLowerCase()) {
    case ' ':
      event.preventDefault()
      if (video.paused) void video.play().catch(requestPreview)
      else video.pause()
      break
    case 'arrowleft':
    case 'arrowright':
      event.preventDefault()
      if (Number.isFinite(duration)) {
        video.currentTime = Math.max(0, Math.min(duration, video.currentTime + (event.key === 'ArrowRight' ? 5 : -5)))
      }
      break
    case 'arrowup':
    case 'arrowdown':
      event.preventDefault()
      video.volume = Math.max(0, Math.min(1, video.volume + (event.key === 'ArrowUp' ? 0.05 : -0.05)))
      break
    case 'f':
      event.preventDefault()
      void toggleFullscreen()
      break
  }
})
window.addEventListener('beforeunload', removeVideo)
window.auroraPlayer.ready()
