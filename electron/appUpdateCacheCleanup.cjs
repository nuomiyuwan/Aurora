const fs = require('fs')
const os = require('os')
const path = require('path')

const WINDOWS_UPDATER_CACHE_DIR_NAME =
  'aurora-project-library-prototype-updater'

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(
    String(value ?? '').trim(),
  )
  return match
    ? match.slice(1, 4).map((part) => Number.parseInt(part, 10))
    : null
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  if (!left || !right) return null
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function installedVersionIncludes(candidateVersion, currentVersion) {
  const comparison = compareVersions(candidateVersion, currentVersion)
  return comparison !== null && comparison <= 0
}

function macInstallerVersion(fileName) {
  return /^Aurora-macOS-(.+)-(?:arm64|x64)\.dmg$/i.exec(fileName)?.[1] ?? null
}

function windowsInstallerVersion(fileName) {
  return /^Aurora-Windows-(.+)-(?:arm64|x64)-Setup\.exe$/i.exec(fileName)?.[1] ?? null
}

function isTemporaryUpdateFile(fileName) {
  return (
    /\.download$/i.test(fileName) ||
    /\.tmp$/i.test(fileName) ||
    /^(?:\d+-)?temp-/i.test(fileName)
  )
}

async function readDirectory(directoryPath) {
  try {
    return await fs.promises.readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function removeEmptyDirectory(directoryPath) {
  try {
    await fs.promises.rmdir(directoryPath)
    return 1
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTEMPTY') return 0
    throw error
  }
}

async function cleanupMacUpdateCache({ userDataPath, currentVersion }) {
  const updateDirectory = path.join(userDataPath, 'updates')
  const entries = await readDirectory(updateDirectory)
  let removedFiles = 0

  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    const installerVersion = macInstallerVersion(entry.name)
    if (
      !isTemporaryUpdateFile(entry.name) &&
      !(
        installerVersion &&
        installedVersionIncludes(installerVersion, currentVersion)
      )
    ) {
      continue
    }
    await fs.promises.rm(path.join(updateDirectory, entry.name), {
      force: true,
    })
    removedFiles += 1
  }

  const removedDirectories = await removeEmptyDirectory(updateDirectory)
  return { removedFiles, removedDirectories }
}

async function readPendingInstallerName(pendingDirectory) {
  try {
    const content = await fs.promises.readFile(
      path.join(pendingDirectory, 'update-info.json'),
      'utf8',
    )
    const parsed = JSON.parse(content)
    return typeof parsed?.fileName === 'string' ? parsed.fileName : null
  } catch {
    return null
  }
}

async function cleanupWindowsUpdateCache({
  currentVersion,
  windowsCacheRoot,
  updaterCacheDirName,
}) {
  const cacheDirectory = path.join(windowsCacheRoot, updaterCacheDirName)
  const pendingDirectory = path.join(cacheDirectory, 'pending')
  const entries = await readDirectory(pendingDirectory)
  if (entries.length === 0) {
    return { removedFiles: 0, removedDirectories: 0 }
  }

  const metadataInstallerName = await readPendingInstallerName(pendingDirectory)
  const candidateNames = new Set([
    ...entries.map((entry) => entry.name),
    ...(metadataInstallerName ? [metadataInstallerName] : []),
  ])
  const installerVersions = [...candidateNames]
    .map(windowsInstallerVersion)
    .filter(Boolean)
  const hasInstalledInstaller = installerVersions.some((version) =>
    installedVersionIncludes(version, currentVersion),
  )
  const hasFutureInstaller = installerVersions.some((version) => {
    const comparison = compareVersions(version, currentVersion)
    return comparison !== null && comparison > 0
  })

  if (hasInstalledInstaller && !hasFutureInstaller) {
    await fs.promises.rm(pendingDirectory, { recursive: true, force: true })
    return { removedFiles: entries.length, removedDirectories: 1 }
  }

  let removedFiles = 0
  for (const entry of entries) {
    if (
      (!entry.isFile() && !entry.isSymbolicLink()) ||
      !isTemporaryUpdateFile(entry.name)
    ) {
      continue
    }
    await fs.promises.rm(path.join(pendingDirectory, entry.name), {
      force: true,
    })
    removedFiles += 1
  }
  const removedDirectories = await removeEmptyDirectory(pendingDirectory)
  return { removedFiles, removedDirectories }
}

async function cleanupAppUpdateCache({
  platform,
  currentVersion,
  userDataPath,
  windowsCacheRoot =
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), 'AppData', 'Local'),
  updaterCacheDirName = WINDOWS_UPDATER_CACHE_DIR_NAME,
}) {
  if (platform === 'darwin') {
    return cleanupMacUpdateCache({ userDataPath, currentVersion })
  }
  if (platform === 'win32') {
    return cleanupWindowsUpdateCache({
      currentVersion,
      windowsCacheRoot,
      updaterCacheDirName,
    })
  }
  return { removedFiles: 0, removedDirectories: 0 }
}

module.exports = {
  WINDOWS_UPDATER_CACHE_DIR_NAME,
  cleanupAppUpdateCache,
  compareVersions,
}
