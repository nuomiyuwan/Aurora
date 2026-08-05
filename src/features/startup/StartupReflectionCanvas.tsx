import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'

interface StartupReflectionCanvasProps {
  progress: number
  sourceLogoVideoRef: RefObject<HTMLVideoElement | null>
}

const STARTUP_LOGO_FALLBACK_ASSET = './aurora/startup-logo-mark.png'
const STARTUP_LOGO_POSTER_ASSET =
  './aurora/startup-logo-mark-loop-poster.png'
const STARTUP_LOGO_VIDEO_ASSET =
  './aurora/startup-logo-mark-loop.webm'
const STARTUP_WORDMARK_ASSET =
  './aurora/startup-aurora-wordmark.png'
const STARTUP_ICE_SURFACE_ASSET =
  './aurora/reflection-ice-surface-generated-2048.png'
const STARTUP_ICE_FILTER_ID = 'startup-ice-reflection-distortion'

export function StartupReflectionCanvas({
  progress,
  sourceLogoVideoRef,
}: StartupReflectionCanvasProps) {
  const reflectionLogoVideoRef = useRef<HTMLVideoElement>(null)
  const [logoPosterFailed, setLogoPosterFailed] = useState(false)
  const [logoVideoReady, setLogoVideoReady] = useState(false)
  const prefersReducedMotionRef = useRef(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const synchronizeLogoPlayback = useCallback(() => {
    const source = sourceLogoVideoRef.current
    const reflection = reflectionLogoVideoRef.current
    if (!source || !reflection || reflection.readyState < 1) return

    if (prefersReducedMotionRef.current) {
      reflection.pause()
      reflection.currentTime = 0
      return
    }

    if (source.readyState >= 1) {
      const duration = Number.isFinite(reflection.duration)
        ? reflection.duration
        : 15
      const sourceTime = duration > 0
        ? source.currentTime % duration
        : source.currentTime
      if (Math.abs(reflection.currentTime - sourceTime) > 0.08) {
        reflection.currentTime = sourceTime
      }
    }

    if (source.paused) {
      reflection.pause()
    } else {
      reflection.playbackRate = source.playbackRate
      void reflection.play().catch(() => undefined)
    }
  }, [sourceLogoVideoRef])

  useEffect(() => {
    const source = sourceLogoVideoRef.current
    if (!source) return
    const events = ['play', 'pause', 'seeking', 'timeupdate', 'ratechange'] as const
    for (const eventName of events) {
      source.addEventListener(eventName, synchronizeLogoPlayback)
    }
    synchronizeLogoPlayback()
    return () => {
      for (const eventName of events) {
        source.removeEventListener(eventName, synchronizeLogoPlayback)
      }
    }
  }, [sourceLogoVideoRef, synchronizeLogoPlayback])

  return (
    <>
      <svg
        className="startupReflectionFilterDefs"
        width="0"
        height="0"
        aria-hidden="true"
      >
        <defs>
          <filter
            id={STARTUP_ICE_FILTER_ID}
            x="-8%"
            y="-8%"
            width="116%"
            height="116%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={resolveDocumentAssetUrl(STARTUP_ICE_SURFACE_ASSET)}
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="iceSurface"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="iceSurface"
              scale="12"
              xChannelSelector="G"
              yChannelSelector="B"
              result="warpedReflection"
            />
            <feGaussianBlur
              in="warpedReflection"
              stdDeviation="0.45 0.9"
            />
          </filter>
        </defs>
      </svg>

      <div
        className="startupReflectionCanvas"
        data-reflection-active="true"
        data-aurora-renderer="startup-css-3d-reflection"
        data-render-state="idle"
        data-renderer-count="1"
        data-reflection-render-count="1"
        data-reflection-targets="1"
        data-source-count="3"
        data-visible-source-count="3"
        data-reflection-ready="true"
        data-context-lost="false"
        aria-hidden="true"
      >
        <div className="startupReflectionLayer">
          <div className="startupGateContent startupReflectionContent">
            <div className="startupBrand">
              <span
                className="startupLogoMark"
                data-logo-poster-state={logoPosterFailed ? 'fallback' : 'ready'}
                data-logo-video-ready={logoVideoReady}
              >
                <img
                  className="startupLogoFallback"
                  src={resolveDocumentAssetUrl(STARTUP_LOGO_FALLBACK_ASSET)}
                  alt=""
                  draggable={false}
                  decoding="sync"
                />
                <img
                  className="startupLogoPoster"
                  src={resolveDocumentAssetUrl(STARTUP_LOGO_POSTER_ASSET)}
                  alt=""
                  draggable={false}
                  decoding="sync"
                  onError={() => setLogoPosterFailed(true)}
                />
                <video
                  ref={reflectionLogoVideoRef}
                  className="startupLogoVideo"
                  src={resolveDocumentAssetUrl(STARTUP_LOGO_VIDEO_ASSET)}
                  poster={resolveDocumentAssetUrl(STARTUP_LOGO_POSTER_ASSET)}
                  muted
                  loop
                  playsInline
                  preload="auto"
                  disablePictureInPicture
                  tabIndex={-1}
                  onLoadedData={() => {
                    setLogoVideoReady(true)
                    synchronizeLogoPlayback()
                  }}
                  onError={() => setLogoVideoReady(false)}
                />
              </span>
              <span className="startupWordmark">
                <img
                  src={resolveDocumentAssetUrl(STARTUP_WORDMARK_ASSET)}
                  alt=""
                  draggable={false}
                  decoding="sync"
                />
              </span>
            </div>

            <div className="startupGateAction">
              <div className="startupProgressTrack">
                <span />
              </div>
              <output className="startupProgressValue">
                {String(progress).padStart(2, '0')}%
              </output>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
