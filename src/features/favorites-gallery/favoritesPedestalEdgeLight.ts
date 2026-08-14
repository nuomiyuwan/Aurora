import * as THREE from 'three'
import { resolveDocumentAssetUrl } from '../../documentAssetUrl'
import { DEFAULT_MATERIAL_TINT } from '../page-settings/pageSettingsPersistence'
import type { FavoritesPedestalModelMetrics } from './favoritesPedestalGeometry'

const PEDESTAL_EDGE_LIGHT_ASSET =
  './aurora/favorites-pedestal-edge-light.png'

export const FAVORITES_PEDESTAL_EDGE_LIGHT = {
  lengthToPedestal: 1,
  planeHeightToPedestal: 1,
  frontSurfaceOffsetToPedestalDepth: 0.012,
  opacity: 0.76,
} as const

type EdgeLightTintUniforms = {
  map: { value: THREE.Texture }
  opacity: { value: number }
  baseColor: { value: THREE.Color }
  materialTintEnabled: { value: number }
  materialTintMidtone: { value: THREE.Vector3 }
}

const normalizeMaterialTint = (value?: string) => {
  const trimmed = value?.trim().toLowerCase() ?? ''
  const shortMatch = /^#([0-9a-f]{3})$/.exec(trimmed)
  if (shortMatch) {
    const [red, green, blue] = shortMatch[1].split('')
    return `#${red}${red}${green}${green}${blue}${blue}`
  }
  return /^#[0-9a-f]{6}$/.test(trimmed)
    ? trimmed
    : DEFAULT_MATERIAL_TINT
}

const materialTintToSrgb = (value: string) =>
  new THREE.Vector3(
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  )

const createEdgeLightMaterial = (
  texture: THREE.Texture,
  appearance: {
    opacity?: number
    color?: string
    materialTint?: string
  },
) => {
  const normalizedTint = normalizeMaterialTint(appearance.materialTint)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      opacity: {
        value: appearance.opacity ?? FAVORITES_PEDESTAL_EDGE_LIGHT.opacity,
      },
      baseColor: { value: new THREE.Color(appearance.color ?? 0xffffff) },
      materialTintEnabled: {
        value: normalizedTint === DEFAULT_MATERIAL_TINT ? 0 : 1,
      },
      materialTintMidtone: { value: materialTintToSrgb(normalizedTint) },
    } satisfies EdgeLightTintUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float opacity;
      uniform vec3 baseColor;
      uniform float materialTintEnabled;
      uniform vec3 materialTintMidtone;

      varying vec2 vUv;

      vec3 edgeLightLinearToSrgb(vec3 color) {
        vec3 clampedColor = clamp(color, 0.0, 1.0);
        vec3 lower = clampedColor * 12.92;
        vec3 upper = 1.055 * pow(clampedColor, vec3(1.0 / 2.4)) - 0.055;
        return mix(lower, upper, step(vec3(0.0031308), clampedColor));
      }

      vec3 edgeLightSrgbToLinear(vec3 color) {
        vec3 clampedColor = clamp(color, 0.0, 1.0);
        vec3 lower = clampedColor / 12.92;
        vec3 upper = pow((clampedColor + 0.055) / 1.055, vec3(2.4));
        return mix(lower, upper, step(vec3(0.04045), clampedColor));
      }

      vec3 applyEdgeLightTint(vec3 sourceLinear) {
        vec3 sourceSrgb = edgeLightLinearToSrgb(sourceLinear);
        float luminance = dot(sourceSrgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 tintedSrgb = luminance <= 0.5
          ? mix(vec3(0.0), materialTintMidtone, luminance * 2.0)
          : mix(
              materialTintMidtone,
              vec3(1.0),
              (luminance - 0.5) * 2.0
            );
        return edgeLightSrgbToLinear(tintedSrgb);
      }

      void main() {
        vec4 sampledLight = texture2D(map, vUv);
        float alpha = sampledLight.a * opacity;
        if (alpha <= 0.001) discard;

        vec3 lightColor = sampledLight.rgb * baseColor;
        if (materialTintEnabled > 0.5) {
          lightColor = applyEdgeLightTint(lightColor);
        }

        gl_FragColor = vec4(lightColor, alpha);
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneMinusDstColorFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    premultipliedAlpha: true,
    toneMapped: false,
  })
  material.name = 'Aurora_Favorites_Pedestal_Edge_Light'
  return material
}

export const loadFavoritesPedestalEdgeLightTexture = async (
  maximumAnisotropy = 1,
) => {
  const texture = await new THREE.TextureLoader().loadAsync(
    resolveDocumentAssetUrl(PEDESTAL_EDGE_LIGHT_ASSET),
  )
  texture.name = 'Aurora_Favorites_Pedestal_Edge_Light'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = Math.min(8, Math.max(1, maximumAnisotropy))
  texture.needsUpdate = true
  return texture
}

export const addFavoritesPedestalEdgeLight = (
  root: THREE.Object3D,
  metrics: FavoritesPedestalModelMetrics,
  texture: THREE.Texture,
  appearance: {
    opacity?: number
    color?: string
    materialTint?: string
  } = {},
) => {
  const planeHeight =
    metrics.size.y * FAVORITES_PEDESTAL_EDGE_LIGHT.planeHeightToPedestal
  const geometry = new THREE.PlaneGeometry(
    metrics.size.x * FAVORITES_PEDESTAL_EDGE_LIGHT.lengthToPedestal,
    planeHeight,
  )
  const material = createEdgeLightMaterial(texture, appearance)

  const light = new THREE.Mesh(geometry, material)
  light.name = 'Aurora_Favorites_Pedestal_Front_Top_Edge_Light'
  light.position.set(
    metrics.center.x,
    // Model Y is projected into CSS Y before screenToThree flips the axis,
    // so the visible top edge is the model bounds' minimum Y.
    metrics.center.y - metrics.size.y / 2,
    metrics.center.z +
      metrics.size.z *
        (0.5 +
          FAVORITES_PEDESTAL_EDGE_LIGHT.frontSurfaceOffsetToPedestalDepth),
  )
  light.frustumCulled = false
  light.userData.auroraPedestalEdgeLight = true
  root.add(light)
  return light
}

export const applyFavoritesPedestalEdgeLightTint = (
  root: THREE.Object3D,
  materialTint?: string,
) => {
  const normalizedTint = normalizeMaterialTint(materialTint)
  const enabled = normalizedTint === DEFAULT_MATERIAL_TINT ? 0 : 1
  const midtone = materialTintToSrgb(normalizedTint)

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (!object.userData.auroraPedestalEdgeLight) return
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    materials.forEach((material) => {
      if (!(material instanceof THREE.ShaderMaterial)) return
      const uniforms = material.uniforms as EdgeLightTintUniforms
      uniforms.materialTintEnabled.value = enabled
      uniforms.materialTintMidtone.value.copy(midtone)
      material.uniformsNeedUpdate = true
    })
  })

  return normalizedTint
}
