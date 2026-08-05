function installOnlinePlayerWebviewFirewall(hostContents, partitions) {
  if (!hostContents || typeof hostContents.on !== 'function') {
    throw new TypeError('The main window webContents is required')
  }
  const allowedPartitions = new Set(
    Array.isArray(partitions)
      ? partitions.filter(
          (partition) =>
            typeof partition === 'string' &&
            partition.startsWith('persist:aurora-'),
        )
      : [],
  )
  if (allowedPartitions.size === 0) {
    throw new TypeError('At least one reviewed online partition is required')
  }

  const handleWillAttach = (event, webPreferences = {}, params = {}) => {
    const parameterPartition = params?.partition
    const preferencePartition = webPreferences?.partition
    if (
      parameterPartition !== preferencePartition ||
      !allowedPartitions.has(parameterPartition)
    ) {
      event.preventDefault()
    }
  }

  hostContents.prependListener?.('will-attach-webview', handleWillAttach)
  if (typeof hostContents.prependListener !== 'function') {
    hostContents.on('will-attach-webview', handleWillAttach)
  }
  return () => {
    hostContents.removeListener?.('will-attach-webview', handleWillAttach)
  }
}

module.exports = { installOnlinePlayerWebviewFirewall }
