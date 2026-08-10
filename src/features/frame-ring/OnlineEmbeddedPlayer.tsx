import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
  getOnlineEmbeddedPlayerLayout,
  shouldUseOnlinePlayerAmbientFallback,
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
  douyin: getOnlineProviderManifest('douyin').sessionPartition,
} satisfies Record<OnlineMediaProvider, string>
const CAPTURED_REFLECTION_PROVIDERS = new Set<OnlineMediaProvider>([
  'bilibili',
  'tencent',
  'xinpianchang',
  'youku',
])
const REFLECTION_FRAME_DECODE_TIMEOUT = 2_000
const DOUYIN_AMBIENT_FALLBACK_READY_DELAY = 450
const DOUYIN_AMBIENT_FALLBACK_MAXIMUM_DELAY = 2_000
const OnlineWebviewTag = 'webview' as 'div'

export function createOnlineEmbeddedWebviewAttributes(
  provider: OnlineMediaProvider,
  playerUrl: string | null,
) {
  return {
    src: playerUrl ?? 'about:blank',
    partition: ONLINE_PARTITIONS[provider],
    webpreferences:
      'contextIsolation=yes,sandbox=yes,nodeIntegration=no,webSecurity=yes',
    // React omits unknown boolean attributes when passed `true`. Electron's
    // WebView only forwards window.open requests when this attribute is
    // physically present, so use the explicit string form for Douyin only.
    ...(provider === 'douyin' ? { allowpopups: 'true' as const } : {}),
  }
}

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
  const onWebviewReadyRef = useRef(onWebviewReady)
  const onReflectionFrameRef = useRef(onReflectionFrame)
  const playerUrl = useMemo(
    () => createOnlineOfficialPlaybackUrl(playback),
    [playback],
  )
  const desktopAvailable = Boolean(window.desktopBridge)
  const layout = getOnlineEmbeddedPlayerLayout(playback.provider)
  const useAmbientFallback = shouldUseOnlinePlayerAmbientFallback(
    playback.provider,
  )
  const [playerVisualReady, setPlayerVisualReady] = useState(
    !useAmbientFallback,
  )
  const webviewAttributes = useMemo(
    () => createOnlineEmbeddedWebviewAttributes(
      playback.provider,
      playerUrl,
    ),
    [playback.provider, playerUrl],
  )

  const publishReflectionFrame = useCallback((dataUrl: string | null) => {
    onReflectionFrameRef.current?.(dataUrl)
  }, [])

  const captureReflectionFrame = useCallback(async () => {
    if (!CAPTURED_REFLECTION_PROVIDERS.has(playback.provider)) return null
    const bridge = window.desktopBridge
    let dataUrl: string | null | undefined = null
    if (playback.provider === 'bilibili') {
      dataUrl = await bridge?.captureBilibiliEmbeddedFrame?.({
        kind: playback.kind,
        mediaId: playback.mediaId,
      })
    } else if (playback.provider === 'tencent') {
      dataUrl = await bridge?.captureTencentEmbeddedFrame?.({
        kind: playback.kind,
        mediaId: playback.mediaId,
      })
    } else if (
      playback.provider === 'xinpianchang' &&
      playback.kind === 'video'
    ) {
      dataUrl = await bridge?.captureXinpianchangEmbeddedFrame?.({
        kind: 'video',
        mediaId: playback.mediaId,
      })
    } else if (playback.provider === 'youku') {
      dataUrl = await bridge?.captureYoukuEmbeddedFrame?.({
        kind: playback.kind,
        mediaId: playback.mediaId,
      })
    }
    return decodeReflectionFrame(dataUrl ?? null)
  }, [playback.kind, playback.mediaId, playback.provider])

  useLayoutEffect(() => {
    onWebviewReadyRef.current = onWebviewReady
    onReflectionFrameRef.current = onReflectionFrame
  }, [onReflectionFrame, onWebviewReady])

  useLayoutEffect(() => {
    const webview = webviewRef.current as BilibiliWebviewElement | null
    if (!webview) return
    let readyTimer: number | null = null
    let maximumTimer: number | null = null
    const clearReadyTimer = () => {
      if (readyTimer === null) return
      window.clearTimeout(readyTimer)
      readyTimer = null
    }
    const showAmbientFallback = () => {
      if (!useAmbientFallback) return
      clearReadyTimer()
      setPlayerVisualReady(false)
    }
    const revealOfficialPlayer = (delay = 0) => {
      if (!useAmbientFallback) return
      clearReadyTimer()
      readyTimer = window.setTimeout(() => {
        readyTimer = null
        setPlayerVisualReady(true)
      }, delay)
    }
    const handlePlayerReady = () => {
      revealOfficialPlayer(DOUYIN_AMBIENT_FALLBACK_READY_DELAY)
    }
    const handlePlayerFailure = () => {
      revealOfficialPlayer(0)
    }
    if (useAmbientFallback) {
      showAmbientFallback()
      webview.addEventListener('did-start-loading', showAmbientFallback)
      webview.addEventListener('dom-ready', handlePlayerReady)
      webview.addEventListener('did-stop-loading', handlePlayerReady)
      webview.addEventListener('did-fail-load', handlePlayerFailure)
      maximumTimer = window.setTimeout(() => {
        maximumTimer = null
        setPlayerVisualReady(true)
      }, DOUYIN_AMBIENT_FALLBACK_MAXIMUM_DELAY)
    } else {
      setPlayerVisualReady(true)
    }
    const lifecycle = installBilibiliWebviewLifecycle(webview, {
      onReady: (readyWebview) => onWebviewReadyRef.current?.(readyWebview),
      active: false,
      reflectionActive: false,
    })
    lifecycleRef.current = lifecycle
    return () => {
      clearReadyTimer()
      if (maximumTimer !== null) window.clearTimeout(maximumTimer)
      webview.removeEventListener('did-start-loading', showAmbientFallback)
      webview.removeEventListener('dom-ready', handlePlayerReady)
      webview.removeEventListener('did-stop-loading', handlePlayerReady)
      webview.removeEventListener('did-fail-load', handlePlayerFailure)
      lifecycle.dispose()
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null
    }
  }, [active, playerUrl, useAmbientFallback])

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
    <span
      className="frameRingPreviewOnlinePlayer"
      data-camera-gesture="block"
      data-online-player-layout={layout}
      data-online-player-ready={playerVisualReady ? 'true' : 'false'}
    >
      {active && desktopAvailable && playerUrl ? (
        <>
          <OnlineWebviewTag
            ref={webviewRef}
            key={`${playback.provider}:${playback.kind}:${playback.mediaId}`}
            className="frameRingPreviewOnlineWebview"
            data-online-player-layout={layout}
            {...webviewAttributes}
          />
          {useAmbientFallback && poster && (
            <span
              className="frameRingPreviewOnlineAmbientFallback"
              aria-hidden="true"
            >
              <img
                className="frameRingPreviewOnlineAmbientBackdrop"
                src={poster}
                alt=""
              />
              <span className="frameRingPreviewOnlineAmbientShade" />
              <img
                className="frameRingPreviewOnlineAmbientSubject"
                src={poster}
                alt=""
              />
            </span>
          )}
        </>
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
