import type { Project } from '../../data/projects'

const updateHash = (hash: number, value: string) => {
  let nextHash = hash
  for (let index = 0; index < value.length; index += 1) {
    nextHash ^= value.charCodeAt(index)
    nextHash = Math.imul(nextHash, 0x01000193)
  }
  return nextHash >>> 0
}

export const createReflectionContentRevision = (
  projects: readonly Project[],
  revisions: ReadonlyMap<string, string>,
) => {
  let hash = 0x811c9dc5
  projects.forEach((project, index) => {
    hash = updateHash(hash, `${index}:${project.id}\u0000`)
    hash = updateHash(
      hash,
      `${revisions.get(project.id) ?? project.cover}\u0001`,
    )
  })
  return `${projects.length}-${hash.toString(36)}`
}

export const waitForReflectionDomFrames = (count = 2) =>
  new Promise<void>((resolve) => {
    const wait = (remaining: number) => {
      if (remaining <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => wait(remaining - 1))
    }
    wait(count)
  })
