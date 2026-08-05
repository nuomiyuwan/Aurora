export const BACKGROUND_REFLECTION_SURFACE_VERSION = 'background-reflection-surface-v1'
export const BACKGROUND_REFLECTION_SURFACE_WIDTH = 1024
export const BACKGROUND_REFLECTION_SURFACE_HEIGHT = 576

export type BackgroundReflectionSurface = {
  key: string
  width: number
  height: number
  pixels: Uint8Array
  generationMs: number
}

export type BackgroundReflectionSurfaceWorkerRequest = {
  id: number
  bitmap: ImageBitmap
}

export type BackgroundReflectionSurfaceWorkerResponse = {
  id: number
  ok: boolean
  pixels?: ArrayBuffer
  width?: number
  height?: number
  generationMs?: number
  error?: string
}
