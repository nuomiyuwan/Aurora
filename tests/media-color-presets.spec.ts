import { expect, test } from '@playwright/test'
import {
  MEDIA_COLOR_PRESETS,
  combineMediaColorFilters,
  getMediaColorPreset,
  getNextMediaColorPresetId,
  normalizeMediaColorPresetId,
} from '../src/data/mediaColorPresets'
import {
  parsePersistentLibrary,
  serializePersistentLibrary,
} from '../src/data/libraryPersistence'
import type { MediaAsset } from '../src/data/mediaLibraryTypes'

test('颜色预设按固定顺序循环并回到原始', () => {
  expect(MEDIA_COLOR_PRESETS.map(({ id, label }) => ({ id, label }))).toEqual([
    { id: 'original', label: '原始' },
    { id: 'rec709-standard', label: '709 标准' },
    { id: 'rec709-soft', label: '709 柔和' },
    { id: 'rec709-warm', label: '709 暖调' },
    { id: 'rec709-cool', label: '709 冷调' },
  ])

  const sequence = ['original']
  for (let index = 0; index < MEDIA_COLOR_PRESETS.length; index += 1) {
    sequence.push(getNextMediaColorPresetId(sequence.at(-1)))
  }
  expect(sequence).toEqual([
    'original',
    'rec709-standard',
    'rec709-soft',
    'rec709-warm',
    'rec709-cool',
    'original',
  ])
})

test('无效旧值恢复为原始，各预设有独立显示效果', () => {
  expect(normalizeMediaColorPresetId(undefined)).toBe('original')
  expect(normalizeMediaColorPresetId('unknown-look')).toBe('original')
  expect(getMediaColorPreset('unknown-look').label).toBe('原始')

  const filters = MEDIA_COLOR_PRESETS.map((preset) => preset.cssFilter)
  expect(new Set(filters).size).toBe(MEDIA_COLOR_PRESETS.length)
  expect(combineMediaColorFilters(undefined, 'none', ' contrast(1.2) ')).toBe(
    'contrast(1.2)',
  )
  expect(combineMediaColorFilters(null, 'none')).toBe('none')
})

test('素材颜色预设可保存并在重启后恢复', () => {
  const project = {
    id: 'color-preset-project',
    title: '颜色预设项目',
    subtitle: '',
    description: '',
    cover: '',
    videoCount: 1,
    collectionCount: 0,
    updatedAt: '2026-08-11 10:00',
  }
  const asset: MediaAsset = {
    id: 'color-preset-asset',
    filename: 'log-footage.mov',
    thumbnail: '/managed/color-preset/poster.jpg',
    duration: '00:04',
    resolution: '3840 x 2160',
    fps: '59.94 fps',
    frameCount: '240',
    sampleCount: 0,
    size: '57.1 MB',
    codec: 'HEVC',
    camera: '未写入',
    capturedAt: '2026-08-11 10:00',
    sourceFingerprint: 'local:/Volumes/Media/log-footage.mov:59873690',
    sourcePath: '/Volumes/Media/log-footage.mov',
    favorite: false,
    indexTask: 'idle',
    durationSeconds: 4,
    width: 3840,
    height: 2160,
    fpsValue: 59.94,
    sizeBytes: 59_873_690,
    indexError: null,
    colorPreset: 'rec709-warm',
  }
  const reference = {
    id: 'color-preset-reference',
    projectId: project.id,
    assetId: asset.id,
    order: 0,
    thumbnailFollowsProject: false,
    tags: [],
    annotated: false,
    note: '',
  }
  const serialized = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [asset],
    projectAssetRefs: [reference],
    projectTitles: {},
    selectedProjectId: project.id,
  })

  expect(
    parsePersistentLibrary({ library: serialized })?.mediaAssets[0]
      .colorPreset,
  ).toBe('rec709-warm')

  const originalPresetLibrary = serializePersistentLibrary({
    projects: [project],
    mediaAssets: [{ ...asset, colorPreset: 'original' }],
    projectAssetRefs: [reference],
    projectTitles: {},
    selectedProjectId: project.id,
  })
  expect(Object.hasOwn(originalPresetLibrary.mediaAssets[0], 'colorPreset')).toBe(
    false,
  )

  const invalidPresetLibrary = structuredClone(serialized)
  invalidPresetLibrary.mediaAssets[0].colorPreset = 'unknown-look' as never
  expect(
    normalizeMediaColorPresetId(
      parsePersistentLibrary({ library: invalidPresetLibrary })?.mediaAssets[0]
        .colorPreset,
    ),
  ).toBe('original')
})
