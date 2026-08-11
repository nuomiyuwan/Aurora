function toggleWindowFullscreen(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed?.()) return false
  const nextFullscreen = !windowInstance.isFullScreen()
  windowInstance.setFullScreenable?.(true)
  windowInstance.setFullScreen(nextFullscreen)
  return nextFullscreen
}

module.exports = {
  toggleWindowFullscreen,
}
