import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')
const inputPath = path.join(
  projectDirectory,
  'public/aurora/home-kuang-light-2k.png',
)
const outputPath = path.join(
  projectDirectory,
  'public/aurora/favorites-pedestal-edge-light.png',
)

const source = PNG.sync.read(fs.readFileSync(inputPath))
const alphaThreshold = 4
const horizontalPadding = 24
const verticalPadding = 18
let minimumX = source.width
let minimumY = source.height
let maximumX = -1
let maximumY = -1

for (let y = 0; y < source.height; y += 1) {
  for (let x = 0; x < source.width; x += 1) {
    const alpha = source.data[(y * source.width + x) * 4 + 3]
    if (alpha < alphaThreshold) continue
    minimumX = Math.min(minimumX, x)
    minimumY = Math.min(minimumY, y)
    maximumX = Math.max(maximumX, x)
    maximumY = Math.max(maximumY, y)
  }
}

if (maximumX < minimumX || maximumY < minimumY) {
  throw new Error('The source light asset has no visible alpha content')
}

minimumX = Math.max(0, minimumX - horizontalPadding)
minimumY = Math.max(0, minimumY - verticalPadding)
maximumX = Math.min(source.width - 1, maximumX + horizontalPadding)
maximumY = Math.min(source.height - 1, maximumY + verticalPadding)

const output = new PNG({
  width: maximumX - minimumX + 1,
  height: maximumY - minimumY + 1,
})

PNG.bitblt(
  source,
  output,
  minimumX,
  minimumY,
  output.width,
  output.height,
  0,
  0,
)

fs.writeFileSync(outputPath, PNG.sync.write(output))
console.log(
  `Created ${path.relative(projectDirectory, outputPath)} (${output.width}x${output.height})`,
)
