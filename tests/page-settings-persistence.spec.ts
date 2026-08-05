import { expect, test } from '@playwright/test'
import {
  APPEARANCE_PAGE_IDS,
  APPEARANCE_SETTINGS_SCHEMA_VERSION,
  createDefaultPageSettings,
  parseAppearanceSettings,
  serializeAppearanceSettings,
} from '../src/features/page-settings/pageSettingsPersistence'

const mediaUrl = (filePath: string) => `managed://${filePath}`

test('六个页面的视觉设置可完整持久化并恢复受管资源', () => {
  const settings = createDefaultPageSettings()
  APPEARANCE_PAGE_IDS.forEach((view, index) => {
    settings[view] = {
      ...settings[view],
      background: {
        kind: index % 2 === 0 ? 'image' : 'video',
        name: `${view}.${index % 2 === 0 ? 'png' : 'mp4'}`,
        url: `blob:${view}`,
        managedPath: `/managed/background-${view}`,
      },
      contrast: 70 + index,
      saturation: 120 + index,
      hue: -30 + index,
      uiBorderColor: '#112233',
      materialTint: '#445566',
      particles: {
        ...settings[view].particles,
        shape: 'snowflake',
        color: '#778899',
        speed: 1.2,
        size: 1.4,
        count: 72,
        rotationSpeed: -0.6,
      },
    }
  })
  settings.gallery.particles = {
    ...settings.gallery.particles,
    shape: 'custom',
    customMedia: {
      kind: 'image',
      name: 'custom.png',
      url: 'blob:particle',
      posterUrl: 'blob:particle',
      width: 512,
      height: 512,
      durationSeconds: null,
      sizeBytes: 1024,
      managedPath: '/managed/custom.png',
      posterPath: null,
    },
  }

  const serialized = serializeAppearanceSettings(settings)
  const restored = parseAppearanceSettings(serialized, mediaUrl)

  expect(serialized.schemaVersion).toBe(APPEARANCE_SETTINGS_SCHEMA_VERSION)
  expect(restored).not.toBeNull()
  APPEARANCE_PAGE_IDS.forEach((view) => {
    expect(restored?.[view]).toMatchObject({
      contrast: settings[view].contrast,
      saturation: settings[view].saturation,
      hue: settings[view].hue,
      uiBorderColor: settings[view].uiBorderColor,
      materialTint: settings[view].materialTint,
    })
    expect(restored?.[view].background).toMatchObject({
      kind: settings[view].background?.kind,
      name: settings[view].background?.name,
      managedPath: settings[view].background?.managedPath,
    })
  })
  expect(restored?.gallery.particles.customMedia).toMatchObject({
    name: 'custom.png',
    managedPath: '/managed/custom.png',
    url: 'managed:///managed/custom.png',
  })
})

test('schema v1 会迁移主页粒子，其余页面使用默认设置', () => {
  const restored = parseAppearanceSettings(
    {
      schemaVersion: 1,
      galleryParticles: {
        shape: 'maple-leaf',
        customMedia: null,
        color: '#123456',
        speed: 1.8,
        size: 0.7,
        count: 88,
        rotationSpeed: 1.1,
      },
    },
    mediaUrl,
  )

  expect(restored?.gallery.particles).toMatchObject({
    shape: 'maple-leaf',
    color: '#123456',
    speed: 1.8,
    size: 0.7,
    count: 88,
    rotationSpeed: 1.1,
  })
  expect(restored?.['video-library']).toEqual(
    createDefaultPageSettings()['video-library'],
  )
})

test('损坏字段会被限制或回退，临时 Blob 资源不会写入', () => {
  const settings = createDefaultPageSettings()
  settings.gallery.background = {
    kind: 'image',
    name: 'temporary.png',
    url: 'blob:temporary',
    managedPath: null,
  }
  const serialized = serializeAppearanceSettings(settings)
  const malformed = {
    ...serialized,
    pages: {
      ...serialized.pages,
      gallery: {
        ...serialized.pages.gallery,
        contrast: 999,
        saturation: -1,
        hue: 999,
        uiBorderColor: 'white',
        materialTint: '#abc',
      },
    },
  }

  const restored = parseAppearanceSettings(malformed, mediaUrl)

  expect(serialized.pages.gallery.background).toBeNull()
  expect(restored?.gallery).toMatchObject({
    contrast: 150,
    saturation: 0,
    hue: 180,
    uiBorderColor: '#dcdee4',
    materialTint: '#aec5ff',
  })
})
