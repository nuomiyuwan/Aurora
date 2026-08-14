import * as THREE from 'three'
import { DEFAULT_PEDESTAL_TINT } from '../page-settings/pageSettingsPersistence'

export type FavoritesPedestalLookId = 'frosted-alloy'

type FavoritesPedestalLight = {
  color: string
  intensity: number
  position: readonly [number, number, number]
}

export type FavoritesPedestalLook = {
  id: FavoritesPedestalLookId
  label: string
  description: string
  environmentAsset: string
  environmentIntensity: number
  /** HDR environment rotation around each scene axis, in degrees. */
  environmentRotationDegrees: {
    x: number
    y: number
    z: number
  }
  /** Additional PMREM mip bias used as an overall reflection blur. */
  environmentBlur: number
  rendererExposure: number
  edgeLightOpacity: number
  edgeLightColor: string
  material: {
    color: string
    metalness: number
    roughness: number
    environmentIntensity: number
    clearcoat: number
    clearcoatRoughness: number
    emissive: string
    emissiveIntensity: number
    anisotropy: number
  }
  lights: {
    hemisphere: {
      skyColor: string
      groundColor: string
      intensity: number
    }
    key: FavoritesPedestalLight
    fill: FavoritesPedestalLight
    rim: FavoritesPedestalLight
    edge: FavoritesPedestalLight
  }
}

type FavoritesPedestalShaderState = {
  environmentBlur: number
  normalizedTint: string
  tintEnabled: { value: number }
  tintMidtone: { value: THREE.Vector3 }
}

const pedestalShaderStates = new WeakMap<
  THREE.MeshPhysicalMaterial,
  FavoritesPedestalShaderState
>()

export const normalizeFavoritesPedestalTint = (value?: string) => {
  const trimmed = value?.trim().toLowerCase() ?? ''
  const shortMatch = /^#([0-9a-f]{3})$/.exec(trimmed)
  if (shortMatch) {
    const [red, green, blue] = shortMatch[1].split('')
    return `#${red}${red}${green}${green}${blue}${blue}`
  }
  return /^#[0-9a-f]{6}$/.test(trimmed)
    ? trimmed
    : DEFAULT_PEDESTAL_TINT
}

const pedestalTintToSrgb = (value: string) =>
  new THREE.Vector3(
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  )

const configureFavoritesPedestalShader = (
  material: THREE.MeshPhysicalMaterial,
  environmentBlur: number,
  pedestalTint?: string,
) => {
  const normalizedTint = normalizeFavoritesPedestalTint(pedestalTint)
  const state: FavoritesPedestalShaderState = {
    environmentBlur,
    normalizedTint,
    tintEnabled: {
      value: normalizedTint === DEFAULT_PEDESTAL_TINT ? 0 : 1,
    },
    tintMidtone: { value: pedestalTintToSrgb(normalizedTint) },
  }
  pedestalShaderStates.set(material, state)
  material.userData.auroraFavoritesPedestalBody = true
  material.userData.auroraEnvironmentBlur = environmentBlur
  material.userData.auroraPedestalTint = normalizedTint
  material.onBeforeCompile = (shader) => {
    shader.uniforms.auroraEnvironmentBlur = { value: environmentBlur }
    shader.uniforms.auroraPedestalTintEnabled = state.tintEnabled
    shader.uniforms.auroraPedestalTintMidtone = state.tintMidtone
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>

uniform float auroraPedestalTintEnabled;
uniform vec3 auroraPedestalTintMidtone;

vec3 auroraPedestalLinearToSrgb(vec3 color) {
  vec3 clampedColor = clamp(color, 0.0, 1.0);
  vec3 lower = clampedColor * 12.92;
  vec3 upper = 1.055 * pow(clampedColor, vec3(1.0 / 2.4)) - 0.055;
  return mix(lower, upper, step(vec3(0.0031308), clampedColor));
}

vec3 auroraPedestalSrgbToLinear(vec3 color) {
  vec3 clampedColor = clamp(color, 0.0, 1.0);
  vec3 lower = clampedColor / 12.92;
  vec3 upper = pow((clampedColor + 0.055) / 1.055, vec3(2.4));
  return mix(lower, upper, step(vec3(0.04045), clampedColor));
}

vec3 applyAuroraPedestalTint(vec3 sourceLinear) {
  vec3 sourceSrgb = auroraPedestalLinearToSrgb(sourceLinear);
  float luminance = dot(sourceSrgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 tintedSrgb = luminance <= 0.5
    ? mix(vec3(0.0), auroraPedestalTintMidtone, luminance * 2.0)
    : mix(
        auroraPedestalTintMidtone,
        vec3(1.0),
        (luminance - 0.5) * 2.0
      );
  return auroraPedestalSrgbToLinear(tintedSrgb);
}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `if (auroraPedestalTintEnabled > 0.5) {
  outgoingLight = applyAuroraPedestalTint(outgoingLight);
}
#include <opaque_fragment>`,
      )

    if (environmentBlur > 0) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#ifdef USE_ENVMAP\n\n\tvec3 getIBLIrradiance',
          '#ifdef USE_ENVMAP\n\n\tuniform float auroraEnvironmentBlur;\n\n\tvec3 getIBLIrradiance',
        )
        .replace(
          'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );',
          'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, clamp( roughness + auroraEnvironmentBlur, 0.0, 1.0 ) );',
        )
    }
  }
  material.customProgramCacheKey = () =>
    `aurora-favorites-pedestal:${environmentBlur}`
  material.needsUpdate = true
  return material
}

/** 收藏展馆最终底座材质：霜银合金。 */
export const FAVORITES_PEDESTAL_LOOKS: readonly FavoritesPedestalLook[] = [
  {
    id: 'frosted-alloy',
    label: '霜银合金',
    description: '更明亮中性，轮廓与厚度最清楚',
    environmentAsset:
      './aurora/hdr-environments/studio-neutral-selective-soft-1k.hdr?v=4',
    environmentIntensity: 0.328,
    environmentRotationDegrees: {
      x: 90,
      y: 60,
      z: 90,
    },
    environmentBlur: 0.38,
    rendererExposure: 0.66,
    edgeLightOpacity: 1,
    edgeLightColor: '#DCE9F7',
    material: {
      color: '#555d66',
      metalness: 0.082,
      roughness: 0.37,
      environmentIntensity: 1,
      clearcoat: 0.24,
      clearcoatRoughness: 0.83,
      emissive: '#12171d',
      emissiveIntensity: 0.35,
      anisotropy: 0.18,
    },
    lights: {
      hemisphere: {
        skyColor: '#e4e9ef',
        groundColor: '#303943',
        intensity: 0.18,
      },
      key: {
        color: '#f1f4f7',
        intensity: 0.2,
        position: [-5, 7, 7],
      },
      fill: {
        color: '#bcc8d4',
        intensity: 0.07,
        position: [5, 2, 6],
      },
      rim: {
        color: '#d8e1ea',
        intensity: 0.1,
        position: [6, 2, -7],
      },
      edge: {
        color: '#edf3f8',
        intensity: 0.045,
        position: [0, -3, 6],
      },
    },
  },
] as const

export const DEFAULT_FAVORITES_PEDESTAL_LOOK_ID: FavoritesPedestalLookId =
  'frosted-alloy'

export const getFavoritesPedestalLook = (
  _lookId: FavoritesPedestalLookId = DEFAULT_FAVORITES_PEDESTAL_LOOK_ID,
) => FAVORITES_PEDESTAL_LOOKS[0]

export const createFavoritesPedestalMatteMetalMaterial = (
  look: FavoritesPedestalLook,
  pedestalTint?: string,
) => {
  const settings = look.material
  const environmentBlur = look.environmentBlur
  const material = new THREE.MeshPhysicalMaterial({
    color: settings.color,
    metalness: settings.metalness,
    roughness: settings.roughness,
    clearcoat: settings.clearcoat,
    clearcoatRoughness: settings.clearcoatRoughness,
    emissive: settings.emissive,
    emissiveIntensity: settings.emissiveIntensity,
    anisotropy: settings.anisotropy,
    anisotropyRotation: Math.PI / 2,
  })
  material.name = `Aurora_Favorites_Matte_Metal_${look.id}`
  material.envMapIntensity = settings.environmentIntensity
  /* Slot opacity follows the DOM card during carousel edge fades. Keeping the
   * material in the transparent render path makes that per-slot opacity real;
   * at opacity 1 the pedestal retains its original fully opaque appearance. */
  material.transparent = true
  material.opacity = 1
  material.depthTest = true
  material.depthWrite = true
  material.side = THREE.DoubleSide
  return configureFavoritesPedestalShader(
    material,
    environmentBlur,
    pedestalTint,
  )
}

export const cloneFavoritesPedestalMaterial = (source: THREE.Material) => {
  const cloned = source.clone()
  if (
    !(source instanceof THREE.MeshPhysicalMaterial) ||
    !(cloned instanceof THREE.MeshPhysicalMaterial) ||
    !source.userData.auroraFavoritesPedestalBody
  ) {
    return cloned
  }
  const sourceState = pedestalShaderStates.get(source)
  return configureFavoritesPedestalShader(
    cloned,
    sourceState?.environmentBlur ??
      Number(source.userData.auroraEnvironmentBlur ?? 0),
    sourceState?.normalizedTint ??
      String(source.userData.auroraPedestalTint ?? DEFAULT_PEDESTAL_TINT),
  )
}

export const applyFavoritesPedestalMaterialTint = (
  root: THREE.Object3D,
  pedestalTint?: string,
) => {
  const normalizedTint = normalizeFavoritesPedestalTint(pedestalTint)
  const tintEnabled = normalizedTint === DEFAULT_PEDESTAL_TINT ? 0 : 1
  const tintMidtone = pedestalTintToSrgb(normalizedTint)

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    materials.forEach((material) => {
      if (
        !(material instanceof THREE.MeshPhysicalMaterial) ||
        !material.userData.auroraFavoritesPedestalBody
      ) return
      let state = pedestalShaderStates.get(material)
      if (!state) {
        configureFavoritesPedestalShader(
          material,
          Number(material.userData.auroraEnvironmentBlur ?? 0),
          normalizedTint,
        )
        state = pedestalShaderStates.get(material)
      }
      if (!state) return
      state.normalizedTint = normalizedTint
      state.tintEnabled.value = tintEnabled
      state.tintMidtone.value.copy(tintMidtone)
      material.userData.auroraPedestalTint = normalizedTint
    })
  })

  return normalizedTint
}

const createDirectionalLight = (settings: FavoritesPedestalLight) => {
  const light = new THREE.DirectionalLight(
    settings.color,
    settings.intensity,
  )
  light.position.set(...settings.position)
  return light
}

export const createFavoritesPedestalLights = (
  look: FavoritesPedestalLook,
) => {
  const hemisphere = new THREE.HemisphereLight(
    look.lights.hemisphere.skyColor,
    look.lights.hemisphere.groundColor,
    look.lights.hemisphere.intensity,
  )
  return [
    hemisphere,
    createDirectionalLight(look.lights.key),
    createDirectionalLight(look.lights.fill),
    createDirectionalLight(look.lights.rim),
    createDirectionalLight(look.lights.edge),
  ] as const
}
