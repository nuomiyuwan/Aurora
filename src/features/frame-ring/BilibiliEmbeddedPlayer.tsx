import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import {
  installBilibiliWebviewLifecycle,
  type BilibiliWebviewElement,
  type BilibiliWebviewLifecycleController,
} from './bilibiliWebviewLifecycle'
import {
  createBilibiliOfficialPlaybackUrl,
  type BilibiliEmbeddedPlayback,
} from './bilibiliOfficialPlayback'

export type { BilibiliEmbeddedPlayback } from './bilibiliOfficialPlayback'

export interface BilibiliEmbeddedPlayerProps {
  active: boolean
  playback: BilibiliEmbeddedPlayback
  poster: string
  onWebviewReady?: (
    webview: BilibiliWebviewElement,
  ) => void | Promise<void>
  reflectionActive?: boolean
  onReflectionFrame?: (dataUrl: string | null) => void
}

const BILIBILI_PARTITION = 'persist:aurora-bilibili-v1'
const REFLECTION_FRAME_DECODE_TIMEOUT = 2_000
const BilibiliWebviewTag = 'webview' as 'div'

function decodeReflectionFrame(dataUrl: string | null) {
  if (!dataUrl?.startsWith('data:image/')) {
    return Promise.resolve<string | null>(null)
  }

  return new Promise<string | null>((resolve) => {
    const image = new Image()
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      resolve(value)
    }
    const timeout = window.setTimeout(
      () => finish(null),
      REFLECTION_FRAME_DECODE_TIMEOUT,
    )
    image.onload = () => {
      finish(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? dataUrl
          : null,
      )
    }
    image.onerror = () => finish(null)
    image.src = dataUrl
  })
}

export function BilibiliEmbeddedPlayer({
  active,
  playback,
  poster,
  onWebviewReady,
  reflectionActive = false,
  onReflectionFrame,
}: BilibiliEmbeddedPlayerProps) {
  const webviewRef = useRef<HTMLDivElement>(null)
  const lifecycleRef = useRef<BilibiliWebviewLifecycleController | null>(null)
  const onWebviewReadyRef = useRef(onWebviewReady)
  const onReflectionFrameRef = useRef(onReflectionFrame)
  const playerUrl = useMemo(
    () => createBilibiliOfficialPlaybackUrl(playback),
    [playback],
  )
  const desktopAvailable = Boolean(window.desktopBridge)
  const webviewAttributes = useMemo(
    () => ({
      src: playerUrl ?? 'about:blank',
      partition: BILIBILI_PARTITION,
      webpreferences:
        'contextIsolation=yes,sandbox=yes,nodeIntegration=no,webSecurity=yes',
    }),
    [playerUrl],
  )

  const publishReflectionFrame = useCallback((dataUrl: string | null) => {
    onReflectionFrameRef.current?.(dataUrl)
  }, [])

  const captureReflectionFrame = useCallback(async () => {
    const bridge = window.desktopBridge
    if (!bridge?.captureBilibiliEmbeddedFrame) return null
    const dataUrl = await bridge.captureBilibiliEmbeddedFrame({
      kind: playback.kind,
      mediaId: playback.mediaId,
    })
    return decodeReflectionFrame(dataUrl)
  }, [playback.kind, playback.mediaId])

  useLayoutEffect(() => {
    onWebviewReadyRef.current = onWebviewReady
    onReflectionFrameRef.current = onReflectionFrame
  }, [onReflectionFrame, onWebviewReady])

  useLayoutEffect(() => {
    const webview = webviewRef.current as BilibiliWebviewElement | null
    if (!webview) return
    const lifecycle = installBilibiliWebviewLifecycle(webview, {
      onReady: (readyWebview) => onWebviewReadyRef.current?.(readyWebview),
      active: false,
      reflectionActive: false,
    })
    lifecycleRef.current = lifecycle
    return () => {
      lifecycle.dispose()
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null
    }
  }, [active, playerUrl])

  useLayoutEffect(() => {
    lifecycleRef.current?.updateReflectionCapture({
      active,
      reflectionActive,
      onReflectionFrame: onReflectionFrame ? publishReflectionFrame : undefined,
      captureReflectionFrame: onReflectionFrame
        ? captureReflectionFrame
        : undefined,
    })
  }, [
    active,
    captureReflectionFrame,
    onReflectionFrame,
    publishReflectionFrame,
    reflectionActive,
  ])

  return (
    <span className="frameRingPreviewOnlinePlayer" data-camera-gesture="block">
      {active && desktopAvailable && playerUrl ? (
        <BilibiliWebviewTag
          ref={webviewRef}
          key={`${playback.kind}:${playback.mediaId}`}
          className="frameRingPreviewOnlineWebview"
          {...webviewAttributes}
        />
      ) : (
        <>
          <img src={poster} alt="" />
          <span>
            {playerUrl
              ? '请在 Aurora App 中播放 B站内容'
              : '这条 B站内容的播放地址无效'}
          </span>
        </>
      )}
    </span>
  )
}
