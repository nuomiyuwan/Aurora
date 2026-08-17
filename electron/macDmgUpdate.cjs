const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MAC_DMG_QUIT_DELAY_MS = 350
const TRUSTED_GITCODE_BASE_URL =
  'https://gitcode.com/nuomiyuwan/Aurora-Updates/releases/download/latest/'
const TRUSTED_GITHUB_OWNER = 'nuomiyuwan'
const TRUSTED_GITHUB_REPO = 'Aurora'

function updateFileName(file) {
  if (typeof file?.url !== 'string') return ''
  try {
    const pathname = new URL(file.url, 'https://aurora.invalid/').pathname
    return path.basename(decodeURIComponent(pathname))
  } catch {
    return path.basename(file.url.split(/[?#]/, 1)[0])
  }
}

function resolveTrustedDownloadUrl(feedConfiguration, version, fileName) {
  if (feedConfiguration?.provider === 'generic') {
    const configuredUrl = new URL(feedConfiguration.url)
    const trustedUrl = new URL(TRUSTED_GITCODE_BASE_URL)
    if (
      configuredUrl.protocol !== trustedUrl.protocol ||
      configuredUrl.host !== trustedUrl.host ||
      configuredUrl.pathname !== trustedUrl.pathname
    ) {
      throw new Error('Untrusted GitCode update source')
    }
    return new URL(encodeURIComponent(fileName), trustedUrl).toString()
  }

  if (
    feedConfiguration?.provider === 'github' &&
    feedConfiguration.owner === TRUSTED_GITHUB_OWNER &&
    feedConfiguration.repo === TRUSTED_GITHUB_REPO
  ) {
    return `https://github.com/${TRUSTED_GITHUB_OWNER}/${TRUSTED_GITHUB_REPO}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(fileName)}`
  }

  throw new Error('Untrusted macOS update source')
}

function createMacDmgDescriptor(updateInfo, feedConfiguration, architecture) {
  const version = typeof updateInfo?.version === 'string'
    ? updateInfo.version.trim()
    : ''
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
    throw new Error('Invalid update version')
  }
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error('Unsupported macOS architecture')
  }

  const fileName = `Aurora-macOS-${version}-${architecture}.dmg`
  const file = Array.isArray(updateInfo?.files)
    ? updateInfo.files.find((candidate) => updateFileName(candidate) === fileName)
    : null
  if (!file) throw new Error('The macOS installer is missing')

  const size = Number(file.size)
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error('The macOS installer size is invalid')
  }
  const expectedHash = Buffer.from(String(file.sha512 ?? ''), 'base64')
  if (expectedHash.length !== 64) {
    throw new Error('The macOS installer checksum is invalid')
  }

  return {
    fileName,
    size,
    sha512: expectedHash,
    url: resolveTrustedDownloadUrl(
      feedConfiguration,
      version,
      fileName,
    ),
  }
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha512')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest()
}

async function isValidInstaller(filePath, descriptor) {
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile() || stat.size !== descriptor.size) return false
    const actualHash = await hashFile(filePath)
    return crypto.timingSafeEqual(actualHash, descriptor.sha512)
  } catch {
    return false
  }
}

async function writeChunk(file, chunk) {
  let offset = 0
  while (offset < chunk.length) {
    const { bytesWritten } = await file.write(
      chunk,
      offset,
      chunk.length - offset,
      null,
    )
    if (bytesWritten <= 0) throw new Error('Unable to write macOS installer')
    offset += bytesWritten
  }
}

function createMacDmgInstaller({
  userDataPath,
  architecture,
  fetchImpl = globalThis.fetch,
  openPath,
  quitApp,
  schedule = setTimeout,
}) {
  if (typeof userDataPath !== 'string' || userDataPath.length === 0) {
    throw new Error('A user data path is required')
  }
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable')
  if (typeof openPath !== 'function') throw new Error('openPath is unavailable')
  if (typeof quitApp !== 'function') throw new Error('quitApp is unavailable')

  const downloadAndOpen = async ({
    updateInfo,
    feedConfiguration,
    onProgress = () => {},
    onReadyToOpen = () => {},
  }) => {
    const descriptor = createMacDmgDescriptor(
      updateInfo,
      feedConfiguration,
      architecture,
    )
    const updateDirectory = path.join(userDataPath, 'updates')
    const targetPath = path.join(updateDirectory, descriptor.fileName)
    const temporaryPath = `${targetPath}.download`
    await fs.promises.mkdir(updateDirectory, { recursive: true })

    if (!(await isValidInstaller(targetPath, descriptor))) {
      await fs.promises.rm(temporaryPath, { force: true })
      let file = null
      try {
        const response = await fetchImpl(descriptor.url)
        if (!response?.ok || !response.body) {
          throw new Error(`Installer download failed: ${response?.status ?? 0}`)
        }

        const hash = crypto.createHash('sha512')
        let downloadedBytes = 0
        file = await fs.promises.open(temporaryPath, 'wx')
        for await (const value of response.body) {
          const chunk = Buffer.from(value)
          downloadedBytes += chunk.length
          if (downloadedBytes > descriptor.size) {
            throw new Error('The macOS installer is larger than expected')
          }
          await writeChunk(file, chunk)
          hash.update(chunk)
          onProgress((downloadedBytes / descriptor.size) * 100)
        }
        await file.sync()
        await file.close()
        file = null

        if (downloadedBytes !== descriptor.size) {
          throw new Error('The macOS installer size does not match')
        }
        const actualHash = hash.digest()
        if (!crypto.timingSafeEqual(actualHash, descriptor.sha512)) {
          throw new Error('The macOS installer checksum does not match')
        }

        await fs.promises.rm(targetPath, { force: true })
        await fs.promises.rename(temporaryPath, targetPath)
      } catch (error) {
        if (file) await file.close().catch(() => undefined)
        await fs.promises.rm(temporaryPath, { force: true })
        throw error
      }
    }

    onProgress(100)
    onReadyToOpen(targetPath)
    const openError = await openPath(targetPath)
    if (openError) throw new Error('Unable to open the macOS installer')
    schedule(quitApp, MAC_DMG_QUIT_DELAY_MS)
    return { filePath: targetPath }
  }

  return { downloadAndOpen }
}

module.exports = {
  MAC_DMG_QUIT_DELAY_MS,
  createMacDmgDescriptor,
  createMacDmgInstaller,
}
