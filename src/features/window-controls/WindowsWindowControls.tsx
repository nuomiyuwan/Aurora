import { useEffect, useState } from 'react'

export function WindowsWindowControls() {
  const bridge = window.desktopBridge
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (bridge?.platform !== 'win32') return

    let active = true
    void Promise.all([
      bridge.getWindowMaximizedState(),
      bridge.getWindowFullscreenState(),
    ]).then(([nextMaximized, nextFullscreen]) => {
      if (!active) return
      setMaximized(nextMaximized)
      setFullscreen(nextFullscreen)
    })
    const unsubscribeMaximized = bridge.onWindowMaximizedStateChange(setMaximized)
    const unsubscribeFullscreen = bridge.onWindowFullscreenStateChange(setFullscreen)
    return () => {
      active = false
      unsubscribeMaximized()
      unsubscribeFullscreen()
    }
  }, [bridge])

  const expanded = maximized || fullscreen

  if (bridge?.platform !== 'win32') return null

  return (
    <>
      <span
        className="windowsWindowDragStrip"
        data-camera-gesture="block"
        aria-hidden="true"
      />
      <div
        className="windowsWindowControlsRegion"
        data-expanded={expanded || undefined}
        data-camera-gesture="block"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="windowsWindowControls"
          data-concealed={expanded || undefined}
          role="group"
          aria-label="窗口控制"
        >
          <button
            className="windowsWindowControl windowsWindowControlClose"
            type="button"
            aria-label="关闭窗口"
            onClick={() => bridge.closeWindow()}
          />
          <button
            className="windowsWindowControl windowsWindowControlMinimize"
            type="button"
            aria-label="最小化窗口"
            onClick={() => bridge.minimizeWindow()}
          />
          <button
            className="windowsWindowControl windowsWindowControlMaximize"
            type="button"
            aria-label={maximized ? '还原窗口' : '最大化窗口'}
            data-maximized={maximized || undefined}
            onClick={() => {
              void bridge.toggleMaximizeWindow().then(setMaximized)
            }}
          />
        </div>
      </div>
    </>
  )
}
