export type ProjectedPoint = { x: number; y: number }
export type ProjectedCornerRadii = readonly [number, number, number, number]

const PROJECTED_CORNER_BEZIER = 0.5522847498

const interpolatePoint = (
  from: ProjectedPoint,
  to: ProjectedPoint,
  progress: number,
): ProjectedPoint => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
})

const pointDistance = (from: ProjectedPoint, to: ProjectedPoint) =>
  Math.hypot(to.x - from.x, to.y - from.y)

const formatPathPoint = (point: ProjectedPoint) =>
  `${point.x.toFixed(3)} ${point.y.toFixed(3)}`

export function createProjectedRoundedPath(
  localCorners: readonly ProjectedPoint[],
  projectedCorners: readonly ProjectedPoint[],
  cornerRadii: ProjectedCornerRadii,
) {
  const incoming: ProjectedPoint[] = []
  const outgoing: ProjectedPoint[] = []

  for (let index = 0; index < projectedCorners.length; index += 1) {
    const previousIndex = (index + projectedCorners.length - 1) % projectedCorners.length
    const nextIndex = (index + 1) % projectedCorners.length
    const localCorner = localCorners[index]
    const radius = Math.max(0, cornerRadii[index])
    const incomingProgress = Math.min(
      0.5,
      radius /
        Math.max(0.0001, pointDistance(localCorner, localCorners[previousIndex])),
    )
    const outgoingProgress = Math.min(
      0.5,
      radius / Math.max(0.0001, pointDistance(localCorner, localCorners[nextIndex])),
    )

    incoming.push(
      interpolatePoint(
        projectedCorners[index],
        projectedCorners[previousIndex],
        incomingProgress,
      ),
    )
    outgoing.push(
      interpolatePoint(projectedCorners[index], projectedCorners[nextIndex], outgoingProgress),
    )
  }

  let path = `M ${formatPathPoint(outgoing[0])}`
  for (let step = 1; step <= projectedCorners.length; step += 1) {
    const index = step % projectedCorners.length
    const corner = projectedCorners[index]
    path += ` L ${formatPathPoint(incoming[index])}`
    if (cornerRadii[index] > 0) {
      const controlIn = interpolatePoint(incoming[index], corner, PROJECTED_CORNER_BEZIER)
      const controlOut = interpolatePoint(outgoing[index], corner, PROJECTED_CORNER_BEZIER)
      path +=
        ` C ${formatPathPoint(controlIn)} ${formatPathPoint(controlOut)}` +
        ` ${formatPathPoint(outgoing[index])}`
    }
  }
  return `${path} Z`
}

export function syncProjectedGlass(
  glass: HTMLElement | null | undefined,
  anchors: readonly HTMLElement[],
  layerRect: DOMRect,
  opacity: number,
  cornerRadii: ProjectedCornerRadii,
) {
  if (!glass) return false
  if (anchors.length !== 4 || opacity <= 0.02) {
    glass.style.visibility = 'hidden'
    return false
  }

  const projectedCorners = anchors.map((anchor) => {
    const rect = anchor.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2 - layerRect.left,
      y: rect.top + rect.height / 2 - layerRect.top,
    }
  })
  const localCorners = anchors.map((anchor) => ({
    x: anchor.offsetLeft + anchor.offsetWidth / 2,
    y: anchor.offsetTop + anchor.offsetHeight / 2,
  }))
  const left = Math.min(...projectedCorners.map((corner) => corner.x))
  const top = Math.min(...projectedCorners.map((corner) => corner.y))
  const right = Math.max(...projectedCorners.map((corner) => corner.x))
  const bottom = Math.max(...projectedCorners.map((corner) => corner.y))
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)

  glass.style.left = `${left}px`
  glass.style.top = `${top}px`
  glass.style.width = `${width}px`
  glass.style.height = `${height}px`
  glass.style.clipPath = `path("${createProjectedRoundedPath(
    localCorners,
    projectedCorners.map((corner) => ({ x: corner.x - left, y: corner.y - top })),
    cornerRadii,
  )}")`
  glass.style.removeProperty('opacity')
  glass.style.setProperty('--projected-glass-opacity', String(opacity))
  glass.style.visibility = 'visible'
  return true
}
