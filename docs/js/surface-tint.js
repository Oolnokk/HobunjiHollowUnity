(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE || window.SurfaceTint?.installed) return;

  const TREATMENT = 'grass-luminance-v2';
  const stats = {
    materialsPatched: 0,
    shaderCompiles: 0,
    shaderPatchMisses: 0,
  };

  function colorFrom(value, fallback = 0xffffff) {
    if (value?.isColor) return value.clone();
    try {
      return new THREE.Color(value ?? fallback);
    } catch (_) {
      return new THREE.Color(fallback);
    }
  }

  function normalizeHueOnly(value) {
    const color = colorFrom(value);
    const maxChannel = Math.max(color.r, color.g, color.b);
    if (maxChannel > 1e-5 && maxChannel < 0.999) color.multiplyScalar(1 / maxChannel);
    return color;
  }

  // Exact color treatment used by the grass billboard fragment:
  // sample the texture in its stored RGB space, derive luminance from those
  // raw channels, let luminance carry the authored value/shading, and let the
  // tint carry hue/color. Do NOT run mapTexelToLinear here: the grass
  // ShaderMaterial does not do that conversion before this luminance step.
  function grassLuminanceMapFragment(uniformName = 'hobunjiSurfaceTint') {
    return `
#ifdef USE_MAP
  vec4 texelColor = texture2D( map, vUv );
  float hobunjiLum = dot(texelColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 hobunjiTinted = ${uniformName} * (0.7 + hobunjiLum * 0.8);
  vec3 hobunjiCol = mix(vec3(0.0), hobunjiTinted, smoothstep(0.0, 0.15, hobunjiLum));
  diffuseColor.rgb = hobunjiCol;
  diffuseColor.a *= texelColor.a;
#endif
`;
  }

  function applyGrassLuminance(material, tint = null) {
    if (!material || typeof material.onBeforeCompile !== 'function') return false;
    if (!material.map) return false;

    const tintColor = colorFrom(tint || material.color || 0xffffff);
    material.userData = Object.assign({}, material.userData);

    if (material.userData.surfaceTintTreatment === TREATMENT) {
      const existing = material.userData.surfaceTintColor;
      if (existing?.isColor) existing.copy(tintColor);
      return true;
    }

    material.userData.surfaceTintTreatment = TREATMENT;
    material.userData.surfaceTintColor = tintColor;

    const previousOnBeforeCompile = material.onBeforeCompile;
    const previousProgramCacheKey = material.customProgramCacheKey?.bind(material);

    material.onBeforeCompile = function (shader, renderer) {
      previousOnBeforeCompile?.call(this, shader, renderer);
      shader.uniforms.hobunjiSurfaceTint = {
        value: material.userData.surfaceTintColor,
      };

      const include = '#include <map_fragment>';
      if (shader.fragmentShader.includes(include)) {
        shader.fragmentShader = shader.fragmentShader.replace(
          include,
          grassLuminanceMapFragment('hobunjiSurfaceTint')
        );
        stats.shaderCompiles++;
      } else {
        stats.shaderPatchMisses++;
        console.warn('[surface-tint] map_fragment not found; leaving source material shader intact');
      }
    };

    material.customProgramCacheKey = function () {
      const prior = previousProgramCacheKey ? previousProgramCacheKey() : '';
      return `${prior}|hobunji-${TREATMENT}`;
    };

    material.needsUpdate = true;
    stats.materialsPatched++;
    return true;
  }

  window.SurfaceTint = {
    installed: true,
    treatment: TREATMENT,
    normalizeHueOnly,
    grassLuminanceMapFragment,
    applyGrassLuminance,
    snapshot() {
      return Object.assign({}, stats);
    },
  };
})();
