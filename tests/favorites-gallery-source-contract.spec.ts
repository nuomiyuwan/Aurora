import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('favorites gallery avoids the retired flattened pedestal reflection path', async () => {
  const [
    viewSource,
    pedestalSource,
    reflectionSource,
    reflectionShaderSource,
    reflectionAppearanceSource,
    cssSource,
  ] =
    await Promise.all([
      readFile('src/features/favorites-gallery/FavoritesGalleryView.tsx', 'utf8'),
      readFile('src/features/favorites-gallery/FavoritesPedestalCanvas.tsx', 'utf8'),
      readFile('src/features/project-gallery/GalleryReflectionCanvas.tsx', 'utf8'),
      readFile(
        'src/features/project-gallery/reflection/reflectionShaders.ts',
        'utf8',
      ),
      readFile(
        'src/features/favorites-gallery/favoritesReflectionAppearance.ts',
        'utf8',
      ),
      readFile('src/features/favorites-gallery/FavoritesGalleryView.css', 'utf8'),
    ])

  expect(viewSource).toContain('<FavoritesPedestalCanvas')
  expect(viewSource).not.toContain('FavoritesPedestalWithReflection')
  expect(viewSource).not.toContain('FavoritesPedestalReflectionCanvas')
  expect(pedestalSource).toContain('iceCompositeFragmentShader')
  expect(pedestalSource).toContain('createFloorReflectionMatrix')
  expect(pedestalSource).toContain('reflectionScene')
  expect(viewSource).toContain('lockReflectionToSourceCoverage')
  expect(reflectionSource).toContain('lockCompositeToSourceCoverage')
  expect(reflectionShaderSource).toContain('sourceCoverageLock')
  expect(reflectionShaderSource).toContain('anchoredTap.a')
  expect(reflectionAppearanceSource).toContain(
    'FAVORITES_REFLECTION_OPACITY_SCALE = 0.7',
  )
  expect(pedestalSource).toContain('FAVORITES_REFLECTION_OPACITY_SCALE')
  expect(reflectionSource).not.toContain('GALLERY_REFLECTION_LIVE_CANVAS_EVENT')
  expect(cssSource).not.toContain('.favoritesPedestalReflectionCanvas')
  expect(cssSource).not.toContain('.favoritesGalleryStage::before')
})

test('favorites gallery uses shared wheel constants and alpha-bound hit targets', async () => {
  const [source, appSource] = await Promise.all([
    readFile('src/features/favorites-gallery/FavoritesGalleryView.tsx', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
  ])
  expect(source).toContain('readWheelDragSample')
  expect(source).toContain('resolveTrackpadSnapTarget')
  expect(source).toContain('WHEEL_DRAG_END_DELAY')
  expect(source).toContain('TRACKPAD_SNAP_COMMIT_PROGRESS')
  expect(source).toContain('HOME_CARD_ALPHA_BOUNDS')
  expect(source).toContain('favoritesGalleryCardHitTarget')
  expect(appSource).toContain('onOpenItem={openFavoriteGalleryItem}')
})

test('favorites cards reserve one top-right action row and reuse frame-ring naming', async () => {
  const [viewSource, appSource, cssSource] = await Promise.all([
    readFile('src/features/favorites-gallery/FavoritesGalleryView.tsx', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
    readFile('src/features/favorites-gallery/FavoritesGalleryView.css', 'utf8'),
  ])

  expect(viewSource).toContain('favoritesCardTopActions')
  expect(viewSource).toContain('favoritesCardRating')
  expect(viewSource).toContain('favoritesCardTitleSuffix')
  expect(cssSource).toContain('.favoritesCardTopActions')
  expect(appSource).toContain('formatFrameRingTimecode(')
  expect(appSource).toContain("const compactFrameTimecode = frameTimecode.startsWith('00:')")
  expect(appSource).toContain("title: clip.filename.replace(/\\.[^.]+$/, '')")
  expect(appSource).toContain('titleSuffix: `帧 ${compactFrameTimecode}`')
  expect(appSource).toContain('meta: `索引帧 ${String(frameOrdinal)')
  expect(appSource).toContain('second.rating - first.rating')
})

test('favorites pedestal edge light follows the page material tint in both passes', async () => {
  const [viewSource, pedestalSource, edgeLightSource] = await Promise.all([
    readFile('src/features/favorites-gallery/FavoritesGalleryView.tsx', 'utf8'),
    readFile('src/features/favorites-gallery/FavoritesPedestalCanvas.tsx', 'utf8'),
    readFile(
      'src/features/favorites-gallery/favoritesPedestalEdgeLight.ts',
      'utf8',
    ),
  ])

  expect(viewSource).toContain('materialTint={materialTint}')
  expect(pedestalSource).toContain(
    'applyFavoritesPedestalEdgeLightTint(slot.root, nextTint)',
  )
  expect(pedestalSource).toContain(
    'applyFavoritesPedestalEdgeLightTint(slot.reflectionRoot, nextTint)',
  )
  expect(edgeLightSource).toContain('materialTintEnabled')
  expect(edgeLightSource).toContain('applyEdgeLightTint')
  expect(edgeLightSource).toContain('blendSrc: THREE.OneMinusDstColorFactor')
})

test('favorites pedestal tint remains separate and follows true 3d reflection geometry', async () => {
  const [appSource, panelSource, viewSource, pedestalSource, materialSource] =
    await Promise.all([
      readFile('src/App.tsx', 'utf8'),
      readFile('src/features/page-settings/PageSettingsPanel.tsx', 'utf8'),
      readFile('src/features/favorites-gallery/FavoritesGalleryView.tsx', 'utf8'),
      readFile('src/features/favorites-gallery/FavoritesPedestalCanvas.tsx', 'utf8'),
      readFile(
        'src/features/favorites-gallery/favoritesPedestalMaterial.ts',
        'utf8',
      ),
    ])

  expect(appSource).toContain('showPedestalTint={currentView === \'favorites\'}')
  expect(panelSource).toContain('aria-label="底座染色"')
  expect(viewSource).toContain('pedestalTint={pedestalTint}')
  expect(pedestalSource).toContain(
    'applyFavoritesPedestalMaterialTint(slot.root, nextTint)',
  )
  expect(pedestalSource).toContain(
    'applyFavoritesPedestalMaterialTint(slot.reflectionRoot, nextTint)',
  )
  expect(materialSource).toContain('applyAuroraPedestalTint(outgoingLight)')
})
