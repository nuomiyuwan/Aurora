import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface SceneCameraPose {
  yaw: number
  pitch: number
}

interface SceneCameraControllerOptions {
  initialPose?: SceneCameraPose
  yawRange?: readonly [number, number]
  pitchRange?: readonly [number, number]
  yawSensitivity?: number
  pitchSensitivity?: number
}

const CAMERA_GESTURE_BLOCK_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="dialog"]',
  '[data-camera-gesture="block"]',
  '.projectCard',
  '.videoClipCard',
  '.clipDetailPanel',
  '.frameRingCard',
  '.frameRingPreview',
  '.frameRingActionPanel',
  '.frameRingInfoPanel',
  '.pageIntro',
  '.statusBar',
  '.brandHeader',
  '.sideDock',
  '.topTools',
  '.videoLibraryBreadcrumb',
  '.videoLibrarySearch',
  '.videoLibraryHeader',
  '.videoLibraryToolbar',
  '.videoLibraryCount',
  '.frameRingBreadcrumb',
  '.frameRingSearch',
].join(',')

const CAMERA_GESTURE_ALLOW_SELECTOR = '[data-camera-gesture="allow"]'

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const DEFAULT_CAMERA_POSE: SceneCameraPose = { yaw: 0, pitch: 6 }

export const isSceneCameraGestureBlocked = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false

  /*
   * A non-scrollable single-card track still uses a real button as its flat
   * hit target so selection and keyboard access remain intact. Let that one
   * explicit target hand pointer drags through to the page camera; sibling
   * controls such as the three-dot menu keep the normal blocking contract.
   */
  if (target.closest(CAMERA_GESTURE_ALLOW_SELECTOR)) return false

  return Boolean(target.closest(CAMERA_GESTURE_BLOCK_SELECTOR))
}

export function useSceneCameraController({
  initialPose = DEFAULT_CAMERA_POSE,
  yawRange = [-10.5, 10.5],
  pitchRange = [-11, 10],
  yawSensitivity = 0.018,
  pitchSensitivity = 0.012,
}: SceneCameraControllerOptions = {}) {
  const [pose, setPose] = useState<SceneCameraPose>(initialPose)
  const [isDragging, setIsDragging] = useState(false)
  const gesture = useRef({
    active: false,
    dragging: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startYaw: initialPose.yaw,
    startPitch: initialPose.pitch,
  })
  const frame = useRef<number | undefined>(undefined)
  const pendingPose = useRef<SceneCameraPose>(initialPose)

  const schedulePose = (nextPose: SceneCameraPose) => {
    pendingPose.current = nextPose
    if (frame.current !== undefined) return
    frame.current = window.requestAnimationFrame(() => {
      frame.current = undefined
      setPose(pendingPose.current)
    })
  }

  const resetPose = useCallback(() => {
    if (frame.current !== undefined) {
      window.cancelAnimationFrame(frame.current)
      frame.current = undefined
    }
    gesture.current.active = false
    gesture.current.dragging = false
    gesture.current.startYaw = initialPose.yaw
    gesture.current.startPitch = initialPose.pitch
    pendingPose.current = initialPose
    setIsDragging(false)
    setPose(initialPose)
  }, [initialPose])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isSceneCameraGestureBlocked(event.target)) return
    gesture.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startYaw: pose.yaw,
      startPitch: pose.pitch,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = gesture.current
    if (!state.active || state.pointerId !== event.pointerId) return
    const deltaX = event.clientX - state.startX
    const deltaY = event.clientY - state.startY
    if (!state.dragging && Math.abs(deltaX) + Math.abs(deltaY) < 4) return

    if (!state.dragging && !event.currentTarget.hasPointerCapture(event.pointerId)) {
      /*
       * Single-card hit targets deliberately allow the page camera to start
       * from the card. Do not capture on pointerdown: doing so retargets the
       * matching pointerup away from the real button, which prevents its
       * click/double-click handlers from running. Capture only after the
       * gesture has crossed the drag threshold so a stationary pointer keeps
       * the exact same selection/open path as a multi-card project.
       */
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    state.dragging = true
    setIsDragging(true)
    schedulePose({
      yaw: clamp(state.startYaw + deltaX * yawSensitivity, yawRange[0], yawRange[1]),
      pitch: clamp(
        state.startPitch - deltaY * pitchSensitivity,
        pitchRange[0],
        pitchRange[1],
      ),
    })
    event.preventDefault()
  }

  const finishPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const state = gesture.current
    if (!state.active || state.pointerId !== event.pointerId) return
    state.active = false
    state.dragging = false
    setIsDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  useEffect(
    () => () => {
      if (frame.current !== undefined) window.cancelAnimationFrame(frame.current)
    },
    [],
  )

  return {
    pose,
    isDragging,
    resetPose,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer,
    },
  }
}
