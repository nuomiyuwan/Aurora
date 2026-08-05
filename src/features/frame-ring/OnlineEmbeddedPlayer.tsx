import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import {
  getOnlineProviderManifest,
  type OnlineMediaProvider,
} from '../../data/onlineProviderRegistry'
import {
  installBilibiliWebviewLifecycle,
  type BilibiliWebviewElement,
  type BilibiliWebviewLifecycleController,
} from './bilibiliWebviewLifecycle'
import {
  createOnlineOfficialPlaybackUrl,
  type OnlineEmbeddedPlayback,
} from './onlineOfficialPlayback'

export type { OnlineEmbeddedPlayback } from './onlineOfficialPlayback'

export interface OnlineEmbeddedPlayerProps {
  active: boolean
  playback: OnlineEmbeddedPlayback
  poster: string
  onWebviewReady?: (
    webview: BilibiliWebviewElement,
  ) => void | Promise<void>
  reflectionActive?: boolean
  onReflectionFrame?: (dataUrl: string | null) => void
}

const ONLINE_PARTITIONS = {
  bilibili: getOnlineProviderManifest('bilibili').sessionPartition,
  tencent: getOnlineProviderManifest('tencent').sessionPartition,
  xinpianchang: getOnlineProviderManifest('xinpianchang').sessionPartition,
  youku: getOnlineProviderManifest('youku').sessionPartition,
} satisfies Record<OnlineMediaProvider, string>
const CAPTURED_REFLECTION_PROVIDERS = new Set<OnlineMediaProvider>([
  'bilibili',
  'tencent',
])
const REFLECTION_FRAME_DECODE_TIMEOUT = 2_000
const OnlineWebviewTag = 'webview' as 'div'

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
    image.onload = () => finish(
      image.naturalWidth > 0 && image.naturalHeight > 0 ? dataUrl : null,
    )
    image.onerror = () => finish(null)
    image.src = dataUrl
  })
}

export function OnlineEmbeddedPlayer({
  active,
  playback,
  poster,
  onWebviewReady,
  reflectionActive = false,
  onReflectionFrame,
}: OnlineEmbeddedPlayerProps) {
  const webviewRef = useRef<HTMLDivElement>(null)
  const lifecycleRef = useRef<BilibiliWebviewLifecycleController | null>(null)
  const posterReflectionKeyRef = useRef('')
  const onWebviewReadyRef = useRef(onWebviewReady)
  const onReflectionFrameRef = useRef(onReflectionFrame)
  const playerUrl = useMemo(
    () => createOnlineOfficialPlaybackUrl(playback),
    [playback],
  )
  const desktopAvailable = Boolean(window.desktopBridge)
  const webviewAttributes = useMemo(
    () => ({
      src: playerUrl ?? 'about:blank',
      partition: ONLINE_PARTITIONS[playback.provider],
      webpreferences:
        'contextIsolation=yes,sandbox=yes,nodeIntegration=no,webSecurity=yes',
    }),
    [playback.provider, playerUrl],
  )

  const publishReflectionFrame = useCallback((dataUrl: string | null) => {
    onReflectionFrameRef.current?.(dataUrl)
  }, [])

  const captureReflectionFrame = useCallback(async () => {
    if (!CAPTURED_REFLECTION_PROVIDERS.has(playback.provider)) return null
    const bridge = window.desktopBridge
    const dataUrl = playback.provider === 'bilibili'
      ? await bridge?.captureBilibiliEmbeddedFrame?.({
          kind: playback.kind,
          mediaId: playback.mediaId,
        })
      : playback.provider === 'tencent'
        ? await bridge?.captureTencentEmbeddedFrame?.({
            kind: playback.kind,
            mediaId: playback.mediaId,
          })
        : null
    return decodeReflectionFrame(dataUrl ?? null)
  }, [playback.kind, playback.mediaId, playback.provider])

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
  }, [playerUrl])

  useLayoutEffect(() => {
    if (CAPTURED_REFLECTION_PROVIDERS.has(playback.provider)) return
    const reflectionKey = [
      playback.provider,
      playback.kind,
      playback.mediaId,
      poster,
    ].join(':')
    if (
      !active ||
      !reflectionActive ||
      !poster ||
      !onReflectionFrame ||
      posterReflectionKeyRef.current === reflectionKey
    ) {
      return
    }
    posterReflectionKeyRef.current = reflectionKey
    publishReflectionFrame(poster)
  }, [
    active,
    onReflectionFrame,
    playback.kind,
    playback.mediaId,
    playback.provider,
    poster,
    publishReflectionFrame,
    reflectionActive,
  ])

  useLayoutEffect(() => {
    if (!CAPTURED_REFLECTION_PROVIDERS.has(playback.provider)) return
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
    playback.provider,
  ])

  const providerLabel = getOnlineProviderManifest(playback.provider).displayName
  return (
    <span className="frameRingPreviewOnlinePlayer" data-camera-gesture="block">
      {active && desktopAvailable && playerUrl ? (
        <OnlineWebviewTag
          ref={webviewRef}
          key={`${playback.provider}:${playback.kind}:${playback.mediaId}`}
          className="frameRingPreviewOnlineWebview"
          {...webviewAttributes}
        />
      ) : (
        <>
          <img src={poster} alt="" />
          <span>
            {playerUrl
              ? `请在 Aurora App 中播放${providerLabel}内容`
              : `这条${providerLabel}内容的播放地址无效`}
          </span>
        </>
      )}
    </span>
  )
}
