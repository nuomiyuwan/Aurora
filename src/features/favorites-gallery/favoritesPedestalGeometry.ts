import * as THREE from 'three'

export const FAVORITES_PEDESTAL_MODEL_SIZE = {
  width: 7,
  height: 1,
  depth: 1,
} as const

export const FAVORITES_PEDESTAL_AXIS_THICKNESS = {
  y: 1.2,
  z: 1.5,
} as const

export type FavoritesPedestalModelMetrics = {
  center: THREE.Vector3
  size: THREE.Vector3
}

export const measureFavoritesPedestalModel = (
  root: THREE.Object3D,
): FavoritesPedestalModelMetrics => {
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())

  if (
    !Number.isFinite(size.x) ||
    !Number.isFinite(size.y) ||
    !Number.isFinite(size.z) ||
    size.x <= 0 ||
    size.y <= 0 ||
    size.z <= 0
  ) {
    return {
      center: new THREE.Vector3(),
      size: new THREE.Vector3(
        FAVORITES_PEDESTAL_MODEL_SIZE.width,
        FAVORITES_PEDESTAL_MODEL_SIZE.height,
        FAVORITES_PEDESTAL_MODEL_SIZE.depth,
      ),
    }
  }

  return { center, size }
}

export const centerFavoritesPedestalModel = (
  root: THREE.Object3D,
  metrics = measureFavoritesPedestalModel(root),
) => {
  root.position.sub(metrics.center)
  root.updateMatrixWorld(true)
  return metrics
}
