import * as THREE from 'three'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'

const FAVORITES_CARD_DEPTH_MASK_ASSET =
  './aurora/home-kuang-alpha-2k.png'

/**
 * A depth-only proxy for one DOM card.
 *
 * The five pedestals share one transparent WebGL canvas, while the cards are
 * DOM elements. This invisible plane lets the shared depth buffer reproduce
 * the same per-card ordering without painting a duplicate card into WebGL.
 */
export const loadFavoritesCardDepthMaskTexture = async (
  maximumAnisotropy = 1,
) => {
  const texture = await new THREE.TextureLoader().loadAsync(
    resolveDocumentAssetUrl(FAVORITES_CARD_DEPTH_MASK_ASSET),
  )
  texture.name = 'Aurora_Favorites_Card_Depth_Mask'
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = Math.min(8, Math.max(1, maximumAnisotropy))
  texture.needsUpdate = true
  return texture
}

export const createFavoritesCardDepthOccluder = (
  depthMask: THREE.Texture,
) => {
  const material = new THREE.MeshBasicMaterial({
    alphaMap: depthMask,
    alphaTest: 0.03,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
  })
  material.name = 'Aurora_Favorites_Card_Depth_Only'
  material.colorWrite = false
  material.blending = THREE.NoBlending
  material.toneMapped = false

  const occluder = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    material,
  )
  occluder.name = 'Aurora_Favorites_Card_Depth_Occluder'
  occluder.frustumCulled = false
  occluder.matrixAutoUpdate = false
  occluder.renderOrder = -1_000_000
  return occluder
}

/**
 * A color mask used by the pedestal-reflection composite.
 *
 * The pedestal canvas is intentionally layered above the DOM cards so the
 * physical base can cover the inserted card edge. The reflected pedestal is
 * composited by a full-screen pass, though, so the depth-only proxy above
 * cannot stop that pass from painting over the DOM card. This companion mask
 * marks the card silhouette in screen space and lets the composite reject
 * those pixels while leaving the visible pedestal pass untouched.
 */
export const createFavoritesCardReflectionOcclusionMask = (
  depthMask: THREE.Texture,
) => {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    alphaMap: depthMask,
    alphaTest: 0.03,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  })
  material.name = 'Aurora_Favorites_Card_Reflection_Occlusion_Mask'
  material.blending = THREE.NoBlending
  material.toneMapped = false

  const mask = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    material,
  )
  mask.name = 'Aurora_Favorites_Card_Reflection_Occlusion'
  mask.frustumCulled = false
  mask.matrixAutoUpdate = false
  return mask
}
