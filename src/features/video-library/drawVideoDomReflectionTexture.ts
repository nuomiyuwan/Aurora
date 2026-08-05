import type { Project } from '../../data/projects'
import { VIDEO_DETAIL_REFLECTION_ID } from './videoReflectionSource'

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
const embeddedResourcePromises = new Map<string, Promise<string>>()
const paintImagePromises = new Map<string, Promise<HTMLImageElement>>()

type StyledElement = HTMLElement | SVGElement

const SNAPSHOT_STYLE_PROPERTIES = [
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'display',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'box-sizing',
  'aspect-ratio',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'overflow',
  'overflow-x',
  'overflow-y',
  'z-index',
  'opacity',
  'visibility',
  'background-color',
  'background-image',
  'background-position',
  'background-size',
  'background-repeat',
  'background-origin',
  'background-clip',
  'background-blend-mode',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'box-shadow',
  'color',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'text-overflow',
  'text-shadow',
  'text-transform',
  'white-space',
  'word-break',
  'writing-mode',
  'text-orientation',
  'gap',
  'row-gap',
  'column-gap',
  'align-items',
  'align-content',
  'align-self',
  'justify-items',
  'justify-content',
  'justify-self',
  'place-items',
  'place-content',
  'place-self',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-flow',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'grid',
  'grid-template',
  'grid-template-columns',
  'grid-template-rows',
  'grid-auto-columns',
  'grid-auto-rows',
  'grid-auto-flow',
  'grid-column',
  'grid-row',
  'transform',
  'transform-origin',
  'translate',
  'rotate',
  'scale',
  'filter',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  'mix-blend-mode',
  'isolation',
  'clip-path',
  'mask-image',
  'mask-position',
  'mask-repeat',
  'mask-size',
  '-webkit-mask-image',
  '-webkit-mask-position',
  '-webkit-mask-repeat',
  '-webkit-mask-size',
  'object-fit',
  'object-position',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
] as const

const isStyledElement = (element: Element): element is StyledElement =>
  element instanceof HTMLElement || element instanceof SVGElement

type BackgroundPaint = {
  source: string
  maskSource: string | null
  resourceRevision: string
  x: number
  y: number
  width: number
  height: number
  radii: [number, number, number, number]
  size: string
  opacity: number
  filter: string
  blendMode: GlobalCompositeOperation
  zIndex: number
  overlay: boolean
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Unable to encode reflection asset'))
    reader.readAsDataURL(blob)
  })

const createResourceCacheKey = (source: string, revision: string) =>
  JSON.stringify([source, revision])

const hashResourceRevision = (revision: string) => {
  let hash = 0x811c9dc5
  for (let index = 0; index < revision.length; index += 1) {
    hash ^= revision.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${revision.length.toString(36)}-${(hash >>> 0).toString(36)}`
}

const versionResourceSource = (source: string, revision: string) => {
  if (!revision) return source
  try {
    const url = new URL(source, document.baseURI)
    if (url.protocol === 'blob:' || url.protocol === 'data:') return url.href
    url.searchParams.set(
      'aurora-reflection-revision',
      hashResourceRevision(revision),
    )
    return url.href
  } catch {
    return source
  }
}

const embedResource = (source: string, revision = '') => {
  const trimmed = source.trim()
  if (!trimmed || trimmed.startsWith('data:')) return Promise.resolve(trimmed)

  const absoluteSource = new URL(trimmed, document.baseURI).href
  const cacheKey = createResourceCacheKey(absoluteSource, revision)
  const cached = embeddedResourcePromises.get(cacheKey)
  if (cached) return cached

  const requestedSource = versionResourceSource(absoluteSource, revision)
  let promise: Promise<string>
  promise = fetch(requestedSource, revision ? { cache: 'no-store' } : undefined)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to load reflection asset: ${requestedSource}`)
      }
      return response.blob()
    })
    .then(blobToDataUrl)
    .catch(() => {
      if (embeddedResourcePromises.get(cacheKey) === promise) {
        embeddedResourcePromises.delete(cacheKey)
      }
      return requestedSource
    })
  embeddedResourcePromises.set(cacheKey, promise)
  return promise
}

const embedCssUrls = async (value: string, revision = '') => {
  const matches = [
    ...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g),
  ]
  if (matches.length === 0) return value

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const source = match[1] ?? match[2] ?? match[3] ?? ''
      return [
        match[0],
        `url("${await embedResource(source, revision)}")`,
      ] as const
    }),
  )
  return replacements.reduce(
    (resolved, [source, replacement]) => resolved.replace(source, replacement),
    value,
  )
}

const clearCssUrls = (value: string) =>
  value.replace(
    /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*?)\s*\)/g,
    'linear-gradient(transparent, transparent)',
  )

const extractCssUrls = (value: string) =>
  [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  )

const parsePixels = (value: string) => Number.parseFloat(value) || 0

const getLocalOffset = (element: HTMLElement, ancestor: HTMLElement) => {
  let x = 0
  let y = 0
  let current: HTMLElement | null = element
  while (current && current !== ancestor) {
    x += current.offsetLeft
    y += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }
  return { x, y }
}

const toCanvasBlendMode = (value: string): GlobalCompositeOperation =>
  value === 'screen' ? 'screen' : 'source-over'

export type DomReflectionCaptureOptions = {
  resourceRevision?: string
  respectBackgroundMasks?: boolean
  excludePageGrade?: boolean
  excludeBackgroundSelectors?: readonly string[]
  excludeSelectors?: readonly string[]
  filterOverrides?: readonly {
    selector: string
    value: string
  }[]
  styleOverrides?: readonly {
    selector: string
    properties: Readonly<Record<string, string>>
  }[]
}

const resolveSnapshotFilter = (
  element: StyledElement,
  computed: CSSStyleDeclaration,
  options: DomReflectionCaptureOptions,
) =>
  options.filterOverrides?.find(({ selector }) => element.matches(selector))?.value ??
  (options.excludePageGrade && element.matches('[data-page-grade="true"]')
    ? computed.getPropertyValue('--page-local-filter').trim() || 'none'
    : computed.filter)

const collectBackgroundPaints = (
  source: HTMLElement,
  options: DomReflectionCaptureOptions,
) =>
  [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))].flatMap(
    (element): BackgroundPaint[] => {
      if (
        [...(options.excludeBackgroundSelectors ?? []), ...(options.excludeSelectors ?? [])]
          .some((selector) => element.matches(selector))
      ) {
        return []
      }
      const computed = getComputedStyle(element)
      const backgroundSources = extractCssUrls(computed.backgroundImage)
      if (backgroundSources.length === 0) return []
      const maskSources = options.respectBackgroundMasks
        ? extractCssUrls(
            computed.getPropertyValue('mask-image') ||
              computed.getPropertyValue('-webkit-mask-image'),
          )
        : []
      const { x, y } = getLocalOffset(element, source)
      const width = Math.max(1, element.offsetWidth || parsePixels(computed.width))
      const height = Math.max(1, element.offsetHeight || parsePixels(computed.height))
      const overlay = element.matches(
        '.cardFrame, .cardLight, .videoClipFrame, .videoClipLight, .detailPanelChrome',
      )
      return backgroundSources.map((backgroundSource) => ({
        source: new URL(backgroundSource, document.baseURI).href,
        maskSource: maskSources[0]
          ? new URL(maskSources[0], document.baseURI).href
          : null,
        resourceRevision: options.resourceRevision ?? '',
        x,
        y,
        width,
        height,
        radii: [
          parsePixels(computed.borderTopLeftRadius),
          parsePixels(computed.borderTopRightRadius),
          parsePixels(computed.borderBottomRightRadius),
          parsePixels(computed.borderBottomLeftRadius),
        ],
        size: computed.backgroundSize,
        opacity: Number.parseFloat(computed.opacity) || 0,
        filter: resolveSnapshotFilter(element, computed, options),
        blendMode: toCanvasBlendMode(computed.mixBlendMode),
        zIndex: Number.parseInt(computed.zIndex, 10) || 0,
        overlay,
      }))
    },
  )

const loadPaintImage = (source: string, revision = '') => {
  const cacheKey = createResourceCacheKey(source, revision)
  const cached = paintImagePromises.get(cacheKey)
  if (cached) return cached
  let promise: Promise<HTMLImageElement>
  promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Unable to load DOM reflection paint: ${source}`))
    image.src = versionResourceSource(source, revision)
  })
  paintImagePromises.set(cacheKey, promise)
  void promise.catch(() => {
    if (paintImagePromises.get(cacheKey) === promise) {
      paintImagePromises.delete(cacheKey)
    }
  })
  return promise
}

const drawBackgroundPaint = async (
  context: CanvasRenderingContext2D,
  paint: BackgroundPaint,
) => {
  if (paint.opacity <= 0) return
  const image = await loadPaintImage(paint.source, paint.resourceRevision)
  const maskImage = paint.maskSource
    ? await loadPaintImage(paint.maskSource, paint.resourceRevision)
    : null
  context.save()
  context.globalAlpha = paint.opacity
  context.globalCompositeOperation = paint.blendMode
  context.filter = paint.filter === 'none' ? 'none' : paint.filter

  if (maskImage) {
    const layer = document.createElement('canvas')
    layer.width = Math.max(1, Math.ceil(paint.width))
    layer.height = Math.max(1, Math.ceil(paint.height))
    const layerContext = layer.getContext('2d')
    if (!layerContext) {
      context.restore()
      throw new Error('2D mask canvas is unavailable')
    }
    layerContext.beginPath()
    layerContext.roundRect(0, 0, layer.width, layer.height, paint.radii)
    layerContext.clip()
    if (paint.size.includes('cover')) {
      const sourceRatio = image.naturalWidth / image.naturalHeight
      const targetRatio = layer.width / layer.height
      const sourceWidth =
        sourceRatio > targetRatio
          ? image.naturalHeight * targetRatio
          : image.naturalWidth
      const sourceHeight =
        sourceRatio > targetRatio
          ? image.naturalHeight
          : image.naturalWidth / targetRatio
      const sourceX = (image.naturalWidth - sourceWidth) / 2
      const sourceY = (image.naturalHeight - sourceHeight) / 2
      layerContext.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        layer.width,
        layer.height,
      )
    } else {
      layerContext.drawImage(image, 0, 0, layer.width, layer.height)
    }
    layerContext.globalCompositeOperation = 'destination-in'
    layerContext.drawImage(maskImage, 0, 0, layer.width, layer.height)
    context.drawImage(layer, paint.x, paint.y, paint.width, paint.height)
    context.restore()
    return
  }

  context.beginPath()
  context.roundRect(paint.x, paint.y, paint.width, paint.height, paint.radii)
  context.clip()

  if (paint.size.includes('cover')) {
    const sourceRatio = image.naturalWidth / image.naturalHeight
    const targetRatio = paint.width / paint.height
    const sourceWidth =
      sourceRatio > targetRatio ? image.naturalHeight * targetRatio : image.naturalWidth
    const sourceHeight =
      sourceRatio > targetRatio ? image.naturalHeight : image.naturalWidth / targetRatio
    const sourceX = (image.naturalWidth - sourceWidth) / 2
    const sourceY = (image.naturalHeight - sourceHeight) / 2
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      paint.x,
      paint.y,
      paint.width,
      paint.height,
    )
  } else {
    context.drawImage(image, paint.x, paint.y, paint.width, paint.height)
  }
  context.restore()
}

const drawBackgroundPaints = async (
  context: CanvasRenderingContext2D,
  paints: readonly BackgroundPaint[],
) => {
  const orderedPaints = [...paints].sort((first, second) => first.zIndex - second.zIndex)
  await Promise.all(
    orderedPaints.flatMap((paint) => [
      loadPaintImage(paint.source, paint.resourceRevision),
      ...(paint.maskSource
        ? [loadPaintImage(paint.maskSource, paint.resourceRevision)]
        : []),
    ]),
  )
  for (const paint of orderedPaints) {
    await drawBackgroundPaint(context, paint)
  }
}

const copyComputedStyles = async (
  source: HTMLElement,
  clone: HTMLElement,
  options: DomReflectionCaptureOptions,
) => {
  const sourceNodes = [source, ...Array.from(source.querySelectorAll('*'))].filter(
    isStyledElement,
  )
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))].filter(
    isStyledElement,
  )

  await Promise.all(
    sourceNodes.map(async (sourceNode, index) => {
      const cloneNode = cloneNodes[index]
      if (!cloneNode) return
      const computed = getComputedStyle(sourceNode)
      const properties = SNAPSHOT_STYLE_PROPERTIES.map((property) => ({
        property,
        value: computed.getPropertyValue(property),
        priority: computed.getPropertyPriority(property),
      })).filter(({ value }) => value !== '')
      const resolvedValues = await Promise.all(
        properties.map(({ property, value }) =>
          property === 'background-image'
            ? clearCssUrls(value)
            : embedCssUrls(value, options.resourceRevision),
        ),
      )
      properties.forEach(({ property, priority }, propertyIndex) => {
        cloneNode.style.setProperty(property, resolvedValues[propertyIndex], priority)
      })
      const snapshotFilter = resolveSnapshotFilter(sourceNode, computed, options)
      if (snapshotFilter !== computed.filter) {
        cloneNode.style.setProperty('filter', snapshotFilter, 'important')
      }
      cloneNode.style.setProperty('animation', 'none', 'important')
      cloneNode.style.setProperty('transition', 'none', 'important')
      if (
        sourceNode instanceof HTMLElement &&
        sourceNode.matches(
          '.clipTagList em, .detailTagCloud span, .detailTagCloud button',
        )
      ) {
        cloneNode.style.setProperty('white-space', 'nowrap', 'important')
        cloneNode.style.setProperty('word-break', 'keep-all', 'important')
        cloneNode.style.setProperty('flex-shrink', '0', 'important')
        cloneNode.style.setProperty('width', `${sourceNode.offsetWidth}px`, 'important')
        cloneNode.style.setProperty('height', `${sourceNode.offsetHeight}px`, 'important')
      }

      if (sourceNode instanceof HTMLImageElement && cloneNode instanceof HTMLImageElement) {
        const imageSource = sourceNode.currentSrc || sourceNode.src
        if (imageSource) {
          cloneNode.src = await embedResource(
            imageSource,
            options.resourceRevision,
          )
        }
      }
      if (sourceNode instanceof HTMLVideoElement && cloneNode instanceof HTMLVideoElement) {
        const poster = sourceNode.poster
        if (poster) {
          cloneNode.poster = await embedResource(
            poster,
            options.resourceRevision,
          )
        }
      }
    }),
  )
}

const loadSerializedImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to rasterize DOM reflection source'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
  })

export const captureDomReflectionElement = async (
  source: HTMLElement,
  targetWidth: number,
  options: DomReflectionCaptureOptions = {},
) => {
  const computed = getComputedStyle(source)
  const sourceWidth = Math.max(1, Number.parseFloat(computed.width) || source.offsetWidth)
  const sourceHeight = Math.max(1, Number.parseFloat(computed.height) || source.offsetHeight)
  const backgroundPaints = collectBackgroundPaints(source, options)
  const clone = source.cloneNode(true) as HTMLElement
  await copyComputedStyles(source, clone, options)

  options.excludeSelectors?.forEach((selector) => {
    if (clone.matches(selector)) {
      clone.style.setProperty('visibility', 'hidden', 'important')
    }
    clone.querySelectorAll(selector).forEach((element) => element.remove())
  })

  options.styleOverrides?.forEach(({ selector, properties }) => {
    const matchingElements = [
      ...(clone.matches(selector) ? [clone] : []),
      ...Array.from(clone.querySelectorAll<HTMLElement>(selector)),
    ]
    matchingElements.forEach((element) => {
      Object.entries(properties).forEach(([property, value]) => {
        element.style.setProperty(property, value, 'important')
      })
    })
  })

  clone.setAttribute('xmlns', XHTML_NAMESPACE)
  clone.style.setProperty('position', 'relative', 'important')
  clone.style.setProperty('inset', 'auto', 'important')
  clone.style.setProperty('top', '0', 'important')
  clone.style.setProperty('left', '0', 'important')
  clone.style.setProperty('width', `${sourceWidth}px`, 'important')
  clone.style.setProperty('height', `${sourceHeight}px`, 'important')
  clone.style.setProperty('margin', '0', 'important')
  clone.style.setProperty('transform', 'none', 'important')
  clone.style.setProperty('translate', 'none', 'important')
  clone.style.setProperty('rotate', 'none', 'important')
  clone.style.setProperty('scale', 'none', 'important')
  clone.style.setProperty('opacity', '1', 'important')

  const serializedClone = new XMLSerializer().serializeToString(clone)
  const serializedSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}" viewBox="0 0 ${sourceWidth} ${sourceHeight}">`,
    `<foreignObject x="0" y="0" width="100%" height="100%">`,
    serializedClone,
    '</foreignObject>',
    '</svg>',
  ].join('')
  const image = await loadSerializedImage(serializedSvg)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(targetWidth))
  canvas.height = Math.max(1, Math.round((targetWidth * sourceHeight) / sourceWidth))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.save()
  context.scale(canvas.width / sourceWidth, canvas.height / sourceHeight)
  await drawBackgroundPaints(
    context,
    backgroundPaints.filter((paint) => !paint.overlay),
  )
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight)
  await drawBackgroundPaints(
    context,
    backgroundPaints.filter((paint) => paint.overlay),
  )
  context.restore()
  return canvas
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const findReflectionSource = (
  projectId: string,
  sourceScopeSelector?: string,
) => {
  const sourceRoot = sourceScopeSelector
    ? document.querySelector<HTMLElement>(sourceScopeSelector)
    : document
  if (!sourceRoot) return null
  if (projectId === VIDEO_DETAIL_REFLECTION_ID) {
    return sourceRoot.querySelector<HTMLElement>(
      '.clipDetailPanel[data-detail-reflection]',
    )
  }
  const escapedId = CSS.escape(projectId)
  return (
    sourceRoot.querySelector<HTMLElement>(
      `.videoClipCard[data-clip-id="${escapedId}"] .videoClipVisual`,
    ) ??
    sourceRoot.querySelector<HTMLElement>(
      `.videoReflectionPreloadSource[data-clip-id="${escapedId}"] .videoClipVisual`,
    )
  )
}

export type VideoDomReflectionFilters = {
  materialTintFilter?: string
  pageColorGradeFilter?: string
  resourceRevision?: string
  sourceScopeSelector?: string
}

export async function drawVideoDomReflectionTexture(
  project: Project,
  width = 1024,
  filters: VideoDomReflectionFilters = {},
) {
  let source = findReflectionSource(project.id, filters.sourceScopeSelector)
  if (!source) {
    await nextFrame()
    source = findReflectionSource(project.id, filters.sourceScopeSelector)
  }
  if (!source) throw new Error(`Unable to find DOM reflection source: ${project.id}`)
  const isDetailPanel = project.id === VIDEO_DETAIL_REFLECTION_ID
  const materialTintFilter =
    filters.materialTintFilter ??
    getComputedStyle(source)
      .getPropertyValue('--asset-ui-tint-filter')
      .trim()
  const pageColorGradeFilter = filters.pageColorGradeFilter?.trim() || 'none'
  return captureDomReflectionElement(source, width, {
    resourceRevision: filters.resourceRevision,
    excludeBackgroundSelectors: ['.videoClipLight'],
    filterOverrides:
      isDetailPanel
        ? [
            {
              selector: '.detailPanelChrome',
              value: [materialTintFilter, pageColorGradeFilter]
                .filter((value) => value && value !== 'none')
                .join(' ') || 'none',
            },
            {
              selector: '.detailPanelContent',
              value: pageColorGradeFilter,
            },
          ]
        : [
            {
              selector: '.videoClipVisual',
              value: pageColorGradeFilter,
            },
            {
              selector: '.videoClipFrame',
              value: materialTintFilter || 'none',
            },
          ],
  })
}
