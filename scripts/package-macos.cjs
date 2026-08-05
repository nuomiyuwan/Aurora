#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const projectDir = resolve(__dirname, '..')
const electronBuilder = join(projectDir, 'node_modules', '.bin', 'electron-builder')
const packageMetadata = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))

const arch = process.argv[2]
const targetMode = process.argv[3]

if (!['arm64', 'x64'].includes(arch) || !['dir', 'installer'].includes(targetMode)) {
  console.error('Usage: node scripts/package-macos.cjs <arm64|x64> <dir|installer>')
  process.exit(2)
}

if (process.platform !== 'darwin') {
  console.error('macOS packages must be built and signed on macOS.')
  process.exit(2)
}

const outputDir = resolve(projectDir, process.env.AURORA_MAC_OUTPUT || 'release')
const hasSigningIdentity = hasDeveloperIdSigningIdentity()
const builderArgs = ['--mac']

if (targetMode === 'installer') builderArgs.push('dmg')
else builderArgs.push('--dir')

builderArgs.push(
  `--${arch}`,
  `--config.directories.output=${outputDir}`,
)

if (!hasSigningIdentity) {
  // Electron Builder intentionally skips signing when no certificate is found.
  // Electron's own executables then retain only their linker signatures while
  // the app bundle has no sealed resources, which macOS reports as a damaged
  // application. Ad-hoc signing preserves bundle integrity for internal builds.
  builderArgs.push(
    '--config.mac.identity=-',
    '--config.mac.hardenedRuntime=false',
  )
  console.warn(
    'No Apple signing identity was supplied; creating a valid ad-hoc signed internal build. ' +
      'Public downloads still require a Developer ID certificate and Apple notarization.',
  )
}

run(electronBuilder, builderArgs)

const appDirName = arch === 'arm64' ? 'mac-arm64' : 'mac'
const appPath = join(outputDir, appDirName, 'Aurora.app')
verifyApp(appPath)

if (targetMode === 'installer') {
  const artifactBase = `Aurora-macOS-${packageMetadata.version}-${arch}`
  const dmgPath = join(outputDir, `${artifactBase}.dmg`)

  run('hdiutil', ['verify', dmgPath])
}

console.log(`Verified ${arch} macOS package output: ${outputDir}`)

function hasDeveloperIdSigningIdentity() {
  if (process.env.CSC_LINK) return true
  if (process.env.CSC_NAME && process.env.CSC_NAME !== '-') return true

  const identityResult = spawnSync(
    'security',
    ['find-identity', '-v', '-p', 'codesigning'],
    { encoding: 'utf8' },
  )

  if (identityResult.error || identityResult.status !== 0) return false
  return identityResult.stdout.includes('Developer ID Application:')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function verifyApp(candidatePath) {
  if (!existsSync(candidatePath)) {
    console.error(`Expected packaged app was not created: ${candidatePath}`)
    process.exit(1)
  }

  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', candidatePath])

  const executablePath = join(candidatePath, 'Contents', 'MacOS', 'Aurora')
  const fileResult = spawnSync('file', [executablePath], { encoding: 'utf8' })
  if (fileResult.error || fileResult.status !== 0) {
    console.error(fileResult.stderr || `Unable to inspect ${executablePath}`)
    process.exit(fileResult.status ?? 1)
  }

  const expectedArchitecture = arch === 'arm64' ? 'arm64' : 'x86_64'
  if (!fileResult.stdout.includes(expectedArchitecture)) {
    console.error(
      `Packaged executable architecture mismatch: expected ${expectedArchitecture}, got ${fileResult.stdout.trim()}`,
    )
    process.exit(1)
  }
}
