import * as THREE from 'three'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'
import type { FavoritesPedestalLook } from './favoritesPedestalMaterial'

/** Load a true HDR for broad, readable metal reflections. */
export const createFavoritesPedestalEnvironmentTarget = async (
  generator: THREE.PMREMGenerator,
  look: FavoritesPedestalLook,
) => {
  const source = await new RGBELoader().loadAsync(
    resolveDocumentAssetUrl(look.environmentAsset),
  )
  source.mapping = THREE.EquirectangularReflectionMapping
  try {
    return generator.fromEquirectangular(source)
  } finally {
    source.dispose()
  }
}
