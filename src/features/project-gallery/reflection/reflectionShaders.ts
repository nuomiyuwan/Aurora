export const ICE_REFLECTION_SAMPLES = 6 as const
export const ICE_REFLECTION_VISIBLE_DISTANCE = 0.34
export const ICE_REFLECTION_FADE_START = 0.012
export const ICE_REFLECTION_MAX_BLUR_TEXELS = 5

export const reflectionSourceVertexShader = /* glsl */ `
uniform mat4 reflectionMatrix;
uniform vec2 viewport;
uniform vec2 cardSize;
uniform float sourceContactOverlapPixels;

varying vec2 vCardUv;
varying float vCardLocalY;

void main() {
  vec3 localPosition = vec3(
    position.x * cardSize.x,
    position.y * cardSize.y + sourceContactOverlapPixels,
    0.0
  );
  vec4 css = reflectionMatrix * vec4(localPosition, 1.0);

  gl_Position = vec4(
    2.0 * css.x / viewport.x - css.w,
    css.w - 2.0 * css.y / viewport.y,
    0.0,
    css.w
  );

  vCardUv = uv;
  vCardLocalY = position.y;
}
`

export const reflectionSourceFragmentShader = /* glsl */ `
uniform sampler2D cardTexture;
uniform sampler2D sourceLightTexture;
uniform float sourceOpacity;
uniform float sourceLightEnabled;
uniform float sourceLightOpacity;
uniform float sourceMaterialTintEnabled;
uniform vec3 sourceMaterialTintMidtone;
uniform float sourceAlphaBottom;
uniform float sourceVisibleDistance;
uniform float sourceFadeStart;
uniform float sourceBaseBlurTexels;
uniform float sourceMaxBlurTexels;
uniform float sourceEdgeFadeWidth;
uniform vec2 cardTexelSize;
uniform vec2 cardSize;

varying vec2 vCardUv;
varying float vCardLocalY;

vec3 sourceMaterialLinearToSrgb(vec3 color) {
  vec3 clampedColor = clamp(color, 0.0, 1.0);
  vec3 lower = clampedColor * 12.92;
  vec3 upper = 1.055 * pow(clampedColor, vec3(1.0 / 2.4)) - 0.055;
  return mix(
    lower,
    upper,
    step(vec3(0.0031308), clampedColor)
  );
}

vec3 sourceMaterialSrgbToLinear(vec3 color) {
  vec3 clampedColor = clamp(color, 0.0, 1.0);
  vec3 lower = clampedColor / 12.92;
  vec3 upper = pow((clampedColor + 0.055) / 1.055, vec3(2.4));
  return mix(
    lower,
    upper,
    step(vec3(0.04045), clampedColor)
  );
}

vec3 applySourceMaterialTintSrgb(vec3 sourceSrgb) {
  float luminance = dot(sourceSrgb, vec3(0.2126, 0.7152, 0.0722));
  return luminance <= 0.5
    ? mix(vec3(0.0), sourceMaterialTintMidtone, luminance * 2.0)
    : mix(
        sourceMaterialTintMidtone,
        vec3(1.0),
        (luminance - 0.5) * 2.0
      );
}

vec3 applySourceMaterialTint(vec3 color) {
  return sourceMaterialSrgbToLinear(
    applySourceMaterialTintSrgb(sourceMaterialLinearToSrgb(color))
  );
}

void main() {
  if (vCardLocalY > sourceAlphaBottom) discard;

  float contactDistance = clamp(
    (sourceAlphaBottom - vCardLocalY)
      / max(sourceAlphaBottom, 0.0001),
    0.0,
    1.0
  );
  if (contactDistance >= sourceVisibleDistance) discard;

  float normalizedDistance = clamp(
    contactDistance / max(sourceVisibleDistance, 0.0001),
    0.0,
    1.0
  );
  float blurRadius = sourceBaseBlurTexels
    + sourceMaxBlurTexels * smoothstep(0.0, 1.0, normalizedDistance);
  vec2 blurStep = cardTexelSize * blurRadius * vec2(0.65, 1.8);
  vec4 card = (
    texture2D(cardTexture, vCardUv) * 4.0
      + texture2D(cardTexture, vCardUv + vec2(blurStep.x, 0.0))
      + texture2D(cardTexture, vCardUv - vec2(blurStep.x, 0.0))
      + texture2D(cardTexture, vCardUv + vec2(0.0, blurStep.y))
      + texture2D(cardTexture, vCardUv - vec2(0.0, blurStep.y))
      + texture2D(cardTexture, vCardUv + blurStep)
      + texture2D(cardTexture, vCardUv - blurStep)
      + texture2D(cardTexture, vCardUv + vec2(blurStep.x, -blurStep.y))
      + texture2D(cardTexture, vCardUv + vec2(-blurStep.x, blurStep.y))
  ) / 12.0;
  vec4 light = texture2D(sourceLightTexture, vCardUv);
  vec3 lightColor = light.rgb;
  float lightAmount = clamp(
    sourceLightEnabled * sourceLightOpacity * light.a,
    0.0,
    1.0
  );
  if (sourceMaterialTintEnabled > 0.5) {
    if (lightAmount > 0.0001) {
      lightColor = applySourceMaterialTint(lightColor);
    }
  }
  vec3 screenedCard = vec3(1.0)
    - (vec3(1.0) - card.rgb) * (vec3(1.0) - lightColor);
  card.rgb = mix(card.rgb, screenedCard, lightAmount);
  float baseFade = 1.0 - smoothstep(
    sourceFadeStart,
    sourceVisibleDistance,
    contactDistance
  );
  float distanceFade = baseFade * baseFade * baseFade;
  float edgeFadeWidth = max(0.0001, sourceEdgeFadeWidth);
  float leftEdgeFade = smoothstep(0.0, edgeFadeWidth, vCardUv.x);
  float rightEdgeFade = 1.0 - smoothstep(1.0 - edgeFadeWidth, 1.0, vCardUv.x);
  float edgeFade = leftEdgeFade * rightEdgeFade;
  float contactLocalPixels =
    max(0.0, sourceAlphaBottom - vCardLocalY) * cardSize.y;
  float contactFeather = smoothstep(0.35, 1.8, contactLocalPixels);
  float alpha =
    card.a * sourceOpacity * distanceFade * edgeFade * contactFeather;
  if (alpha <= 0.001) discard;

  gl_FragColor = vec4(card.rgb * alpha, alpha);
}
`

export const iceCompositeVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const iceCompositeFragmentShader = /* glsl */ `
uniform sampler2D sourceMap;
uniform sampler2D surfaceDataMap;
uniform vec2 texelSize;
uniform float cameraYaw;
uniform float cameraPitch;

varying vec2 vUv;

void main() {
  float yawRadians = radians(cameraYaw);
  vec2 mapUv = mix(vec2(0.045), vec2(0.955), vUv);
  vec3 surfaceData = texture2D(surfaceDataMap, mapUv).rgb;
  float displacementHeight = surfaceData.r * 2.0 - 1.0;
  vec2 normalIce = surfaceData.gb * 2.0 - 1.0;

  float basisAngle = yawRadians * 0.35;
  vec2 tangent = vec2(cos(basisAngle), sin(basisAngle));
  vec2 away = vec2(-tangent.y, tangent.x);
  float pitchStretch = 1.0 + 0.55 * smoothstep(8.0, 65.0, abs(cameraPitch));
  vec2 minimumUv = texelSize * 0.5;
  vec2 maximumUv = vec2(1.0) - minimumUv;
  vec4 anchoredTap = texture2D(
    sourceMap,
    clamp(vUv, minimumUv, maximumUv)
  );
  float contactLock = pow(smoothstep(0.72, 0.96, anchoredTap.a), 2.0);
  float warpGain = mix(1.0, 0.52, contactLock);
  float blurGain = mix(1.0, 0.38, contactLock);

  vec2 slopePixels =
    tangent * dot(normalIce, tangent) * 12.0
    + away * dot(normalIce, away) * 22.0 * pitchStretch;
  vec2 macroPixels = away * displacementHeight * 3.0;
  vec2 displacement = texelSize * (slopePixels + macroPixels) * warpGain;

  float roughness = clamp(
    0.18 + abs(displacementHeight) * 0.55 + length(normalIce) * 0.95,
    0.0,
    1.0
  );
  vec2 longStep = texelSize
    * away
    * (1.2 + roughness * 8.0)
    * blurGain
    * pitchStretch;
  vec2 shortStep = texelSize
    * tangent
    * (0.55 + roughness * 2.6)
    * blurGain;
  vec2 sampleUv = clamp(vUv + displacement, minimumUv, maximumUv);

  vec4 longTapA = texture2D(
    sourceMap,
    clamp(sampleUv - longStep, minimumUv, maximumUv)
  );
  vec4 longTapB = texture2D(
    sourceMap,
    clamp(sampleUv + longStep, minimumUv, maximumUv)
  );
  vec4 centerTap = texture2D(
    sourceMap,
    sampleUv
  );
  vec4 shortTapA = texture2D(
    sourceMap,
    clamp(sampleUv - shortStep, minimumUv, maximumUv)
  );
  vec4 shortTapB = texture2D(
    sourceMap,
    clamp(sampleUv + shortStep, minimumUv, maximumUv)
  );

  vec4 reflected = (
    centerTap * 4.0
      + longTapA * 1.35
      + longTapB * 1.35
      + shortTapA * 0.65
      + shortTapB * 0.65
  ) / 8.0;
  float contact = smoothstep(0.12, 0.78, centerTap.a);
  vec3 reflectedColor = reflected.rgb / max(reflected.a, 0.00001);
  vec3 centerColor = centerTap.rgb / max(centerTap.a, 0.00001);
  vec3 contactSharpened = mix(reflectedColor, centerColor, contact * 0.44);
  float luminance = dot(contactSharpened, vec3(0.2126, 0.7152, 0.0722));
  float colorRetention = mix(0.84, 0.94, contact);
  vec3 neutralColor = mix(vec3(luminance), contactSharpened, colorRetention);
  vec3 iceBalance = mix(
    vec3(0.99, 1.01, 1.045),
    vec3(1.0, 1.008, 1.025),
    contact
  );
  neutralColor = pow(max(neutralColor, vec3(0.0)), vec3(0.96));
  neutralColor = min(neutralColor * iceBalance, vec3(1.0));

  float pitchAttenuation = mix(
    0.42,
    1.0,
    1.0 - smoothstep(18.0, 65.0, abs(cameraPitch))
  );
  float yawAttenuation = 0.84 + 0.16 * abs(cos(yawRadians));
  float alpha = mix(reflected.a, centerTap.a, contact * 0.5)
    * pitchAttenuation
    * yawAttenuation;
  float surfaceReflectivity = mix(0.50, 0.70, contact);
  alpha *= surfaceReflectivity;
  float warpedCoverage = max(
    centerTap.a,
    max(
      max(longTapA.a, longTapB.a),
      max(shortTapA.a, shortTapB.a)
    )
  );
  alpha *= smoothstep(0.002, 0.05, warpedCoverage);

  gl_FragColor = vec4(neutralColor, alpha);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= alpha;
}
`

// Keep both naming orders available while sharing the exact same shader definitions.
export const sourceReflectionVertexShader = reflectionSourceVertexShader
export const sourceReflectionFragmentShader = reflectionSourceFragmentShader
