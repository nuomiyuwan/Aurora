import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SRGBColorSpace,
} from 'three'
import type { ViewHelper } from 'three/addons/helpers/ViewHelper.js'

type AxisStyle = {
  line: string
  node: string
  label: string
}

const AXIS_STYLES: Record<'X' | 'Y' | 'Z', AxisStyle> = {
  X: { line: '#91add8', node: '#adc8ef', label: '#07101d' },
  Y: { line: '#b3c8da', node: '#d6e4ef', label: '#07101d' },
  Z: { line: '#6f8fd3', node: '#83a5ef', label: '#06101f' },
}

function createAxisNodeTexture(style: AxisStyle, label: string | null) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return new CanvasTexture(canvas)

  context.scale(2, 2)
  const center = 32
  const radius = label ? 13.5 : 7.5
  const glow = context.createRadialGradient(
    center - 3,
    center - 4,
    1,
    center,
    center,
    radius + 5,
  )
  glow.addColorStop(0, style.node)
  glow.addColorStop(0.72, style.node)
  glow.addColorStop(1, 'rgba(100, 143, 212, 0)')

  context.save()
  context.shadowColor = 'rgba(132, 178, 244, 0.58)'
  context.shadowBlur = label ? 9 : 4
  context.beginPath()
  context.arc(center, center, radius + 3, 0, Math.PI * 2)
  context.fillStyle = glow
  context.fill()
  context.restore()

  context.beginPath()
  context.arc(center, center, radius, 0, Math.PI * 2)
  context.fillStyle = label ? style.node : 'rgba(50, 70, 101, 0.78)'
  context.fill()
  context.lineWidth = label ? 1 : 0.75
  context.strokeStyle = label
    ? 'rgba(239, 246, 255, 0.72)'
    : 'rgba(153, 181, 222, 0.42)'
  context.stroke()

  if (label) {
    context.fillStyle = style.label
    context.font = '600 17px -apple-system, BlinkMacSystemFont, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label, center, center + 0.5)
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function styleAxisLine(object: unknown, color: string) {
  if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return
  object.material.color.set(color)
  object.material.opacity = 0.72
  object.material.transparent = true
  object.material.depthWrite = false
  object.material.needsUpdate = true
}

/**
 * Keeps Three's proven ViewHelper camera interaction, replacing only its
 * high-saturation editor colors with Aurora's silver-blue instrument styling.
 */
export function styleAuroraViewHelper(viewHelper: ViewHelper) {
  // ViewHelper adds its axis meshes in X, Z, Y order before the six nodes.
  styleAxisLine(viewHelper.children[0], AXIS_STYLES.X.line)
  styleAxisLine(viewHelper.children[1], AXIS_STYLES.Z.line)
  styleAxisLine(viewHelper.children[2], AXIS_STYLES.Y.line)

  viewHelper.children.forEach((child) => {
    if (!(child instanceof Sprite)) return
    const type = String(child.userData.type ?? '')
    const axis = type.endsWith('X') ? 'X' : type.endsWith('Y') ? 'Y' : 'Z'
    const positive = type.startsWith('pos')
    const material = child.material
    material.map?.dispose()
    material.map = createAxisNodeTexture(
      AXIS_STYLES[axis],
      positive ? axis : null,
    )
    material.color.set('#ffffff')
    material.opacity = positive ? 0.96 : 0.34
    material.transparent = true
    material.needsUpdate = true
  })
}
