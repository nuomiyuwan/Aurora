import type { MediaColorPresetId } from '../../data/mediaColorPresets'

export const VIDEO_DETAIL_REFLECTION_ID = 'video-detail-panel'

export interface ClipReflectionSource {
  id: string
  filename: string
  thumbnail: string
  duration: string
  resolution: string
  fps: string
  frameCount: string
  sampleCount: number
  size: string
  codec: string
  camera: string
  capturedAt: string
  tags: readonly string[]
  annotated: boolean
  note: string
  favorite?: boolean
  colorPreset?: MediaColorPresetId
}
