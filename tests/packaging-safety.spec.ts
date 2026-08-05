import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const publicDirectory = path.join(projectRoot, 'public')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const entryPath = path.join(directory, entry)
    return statSync(entryPath).isDirectory()
      ? sourceFiles(entryPath)
      : /\.tsx?$/.test(entry)
        ? [entryPath]
        : []
  })
}

function rootAbsoluteAuroraLiterals(filePath: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const findings: string[] = []

  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !ts.isLiteralTypeNode(node.parent) &&
      node.text.startsWith('/aurora/')
    ) {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
      findings.push(`${path.relative(projectRoot, filePath)}:${line + 1}:${character + 1} ${node.getText(source)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return findings
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp("\\b" + name + "\\s*=\\s*(?:([\"'])(.*?)\\1|([^\\s\"'=<>`]+))", 'i'),
  )
  return match?.[2] ?? match?.[3]
}

function isRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

test('uses packaged-relative Aurora runtime assets', () => {
  const packagedIndex = new URL(
    'file:///Applications/Aurora.app/Contents/Resources/app.asar/dist/index.html',
  )
  const asset = new URL('./aurora/project-ring-of-horizon.png', packagedIndex)

  expect(asset.pathname).toContain(
    '/app.asar/dist/aurora/project-ring-of-horizon.png',
  )
  expect(
    isRegularFile(path.join(publicDirectory, 'aurora/project-ring-of-horizon.png')),
  ).toBe(true)

  const findings = sourceFiles(path.join(projectRoot, 'src')).flatMap(
    rootAbsoluteAuroraLiterals,
  )
  expect(findings, 'runtime asset literals must not start with /aurora/').toEqual([])
})

test('preloads the packaged startup poster and video with relative high-priority URLs', () => {
  const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8')
  const preloadTags = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => attribute(tag, 'rel')?.toLowerCase() === 'preload',
  )
  const startupPreload = preloadTags.find(
    ([tag]) =>
      attribute(tag, 'as')?.toLowerCase() === 'image' &&
      attribute(tag, 'href')?.includes('startup-ice-valley-v1.png'),
  )

  expect(startupPreload, 'startup backdrop must have an image preload').toBeTruthy()
  if (!startupPreload) return

  const href = attribute(startupPreload[0], 'href')
  expect(href).toBe('./aurora/startup-ice-valley-v1.png')
  expect(attribute(startupPreload[0], 'fetchpriority')).toBe('high')
  expect(
    isRegularFile(path.join(publicDirectory, 'aurora/startup-ice-valley-v1.png')),
  ).toBe(true)

  const startupVideoPreload = preloadTags.find(
    ([tag]) =>
      attribute(tag, 'as')?.toLowerCase() === 'video' &&
      attribute(tag, 'href')?.includes('startup-ice-valley-v1.webm'),
  )
  expect(startupVideoPreload, 'startup video must have a video preload').toBeTruthy()
  if (startupVideoPreload) {
    expect(attribute(startupVideoPreload[0], 'href')).toBe(
      './aurora/startup-ice-valley-v1.webm',
    )
    expect(attribute(startupVideoPreload[0], 'type')).toBe('video/webm')
    expect(attribute(startupVideoPreload[0], 'fetchpriority')).toBe('high')
  }
  expect(
    isRegularFile(path.join(publicDirectory, 'aurora/startup-ice-valley-v1.webm')),
  ).toBe(true)
  expect(
    isRegularFile(path.join(publicDirectory, 'aurora/startup-ice-valley-v1.mp4')),
  ).toBe(true)

  const logoPosterPreload = preloadTags.find(
    ([tag]) =>
      attribute(tag, 'as')?.toLowerCase() === 'image' &&
      attribute(tag, 'href')?.includes('startup-logo-mark-loop-poster.png'),
  )
  expect(logoPosterPreload, 'animated logo poster must be preloaded').toBeTruthy()
  if (logoPosterPreload) {
    expect(attribute(logoPosterPreload[0], 'href')).toBe(
      './aurora/startup-logo-mark-loop-poster.png',
    )
    expect(attribute(logoPosterPreload[0], 'fetchpriority')).toBe('high')
  }
  expect(
    isRegularFile(path.join(publicDirectory, 'aurora/startup-logo-mark-loop.webm')),
  ).toBe(true)
  expect(
    isRegularFile(
      path.join(publicDirectory, 'aurora/startup-logo-mark-loop-poster.png'),
    ),
  ).toBe(true)

})

test('uses a packaged-safe favicon when one is declared', () => {
  const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8')
  const faviconTags = [...html.matchAll(/<link\b[^>]*>/gi)].filter((match) =>
    /\bicon\b/i.test(attribute(match[0], 'rel') ?? ''),
  )

  for (const [tag] of faviconTags) {
    const href = attribute(tag, 'href')
    expect(href, 'declared favicon must include an href').toBeTruthy()
    if (!href || href.startsWith('data:')) continue

    expect(href, `favicon must not be root-absolute: ${href}`).not.toMatch(/^\//)
    const faviconUrl = new URL(
      href,
      pathToFileURL(`${publicDirectory}${path.sep}`),
    )
    expect(faviconUrl.protocol, `favicon must resolve to a public file URL: ${href}`).toBe(
      'file:',
    )
    if (faviconUrl.protocol !== 'file:') continue

    const publicFile = fileURLToPath(faviconUrl)
    const relativePublicPath = path.relative(publicDirectory, publicFile)
    expect(
      relativePublicPath,
      `favicon must remain beneath public: ${href}`,
    ).not.toMatch(/^(?:\.\.(?:[\\/]|$)|[\\/])/)
    expect(
      isRegularFile(publicFile),
      `favicon must exist under public: ${href}`,
    ).toBe(true)
  }
})

test('uses a real explicitly configured macOS packaging icon', () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
  ) as {
    build?: { directories?: { buildResources?: string }; mac?: Record<string, unknown> }
  }
  const mac = packageJson.build?.mac
  if (!mac || !Object.hasOwn(mac, 'icon')) return

  const configuredIcon = mac.icon
  expect(
    typeof configuredIcon,
    'explicit build.mac.icon must be a non-empty string',
  ).toBe('string')
  if (typeof configuredIcon !== 'string') return

  const icon = configuredIcon.trim()
  expect(icon, 'explicit build.mac.icon must be a non-empty string').not.toBe('')
  if (!icon) return

  const buildResources = packageJson.build?.directories?.buildResources ?? 'build'
  const candidates = path.isAbsolute(icon)
    ? [icon]
    : [
        path.resolve(projectRoot, buildResources, icon),
        path.resolve(projectRoot, icon),
      ]

  expect(
    candidates.some(isRegularFile),
    `build.mac.icon must resolve to a file: ${icon} (${candidates.join(', ')})`,
  ).toBe(true)
})
