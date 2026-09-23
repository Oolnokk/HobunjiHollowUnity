(() => {
  'use strict';

  // Experimental world-only paint stack. This patches the game's existing
  // fullscreen outline composite, so HUD/menus and the separately redrawn
  // world-space dialogue/chat text remain crisp and outside the effect.
  const STORAGE_KEY = 'hobunjiPainterlyPostprocessMode';
  const MODE_TO_VALUE = Object.freeze({ off: 0, low: 1, medium: 2, high: 3 });
  const MODE_SAMPLE_COUNT = Object.freeze({ off: 0, low: 76, medium: 76, high: 76 });

  let mode = loadMode(); // Read by the settings control and shader uniforms.
  let rendererAttached = false; // Reported by the in-game status/debug API.
  let compositeSeenAt = 0; // Reported so mobile testing can confirm the post scene was found.
  let lastError = ''; // Shown in Settings when shader patching/attachment fails.
  let attachAttempts = 0; // Limits startup polling if the gameplay renderer never appears.
  const patchedMaterials = new Set(); // Updated by setMode() when the quality dropdown changes.

  let rendererRef = null; // Used by the multi-pass painterly pipeline when the final world composite is presented.
  let pipeline = null; // Reused low-resolution render targets/scenes; avoids per-frame GPU allocation.
  let pipelineFrames = 0; // Reported by Pixel Probe to prove the screenshot-faithful stack is actually running.
  let lastPipelineSize = ''; // Reported by Pixel Probe so mobile can verify the internal preview-sized buffer.
  let lastPipelineMode = 'off'; // Reported by Pixel Probe to distinguish selected mode from the last completed paint pass.
  const SHARED_OIL_OFFSETS = Object.freeze([-10, -6.67, -3.33, 0, 3.33, 6.67, 10]); // Used by every active tier; spans the reference radius-10 neighborhood at fixed 7x7 live cost.
  const MODE_PROFILE = Object.freeze({
    low:    Object.freeze({ oilOffsets: SHARED_OIL_OFFSETS, waterRadius: 2, waterMix: 0.16, edgeStain: 1.00 }),
    medium: Object.freeze({ oilOffsets: SHARED_OIL_OFFSETS, waterRadius: 3, waterMix: 0.23, edgeStain: 1.00 }),
    high:   Object.freeze({ oilOffsets: SHARED_OIL_OFFSETS, waterRadius: 4, waterMix: 0.30, edgeStain: 1.00 }),
  });
  const DISTANCE_NEAR = 18.0; // World-distance where the stronger atmospheric paint ramp begins.
  const DISTANCE_FAR = 55.0; // World-distance where the older intense paint preset is fully applied.
  const FAR_WATER_RADIUS = 4; // Older intense watercolor radius; all tiers converge here in the far field.
  const FAR_OIL_RADIUS_SCALE = 0.60; // Current radius-10 sample footprint contracts to the older radius-6 footprint at distance.
  const SKY_DEPTH_MIN = 170.0; // Cloud shells begin at 176u; sun/moon/base sky resolve behind them near the 200u far plane.


  function normalizeMode(value) {
    return Object.prototype.hasOwnProperty.call(MODE_TO_VALUE, value) ? value : 'off';
  }

  function loadMode() {
    try { return normalizeMode(localStorage.getItem(STORAGE_KEY) || 'off'); }
    catch (_) { return 'off'; }
  }

  function persistMode() {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) {}
  }

  function modeValue() {
    return MODE_TO_VALUE[mode] || 0;
  }

  function findCompositeMaterial(scene) {
    for (const child of scene?.children || []) {
      const materials = Array.isArray(child?.material) ? child.material : [child?.material];
      for (const material of materials) {
        const uniforms = material?.uniforms;
        if (
          material?.isShaderMaterial
          && uniforms?.tColor
          && uniforms?.tEdgeId
          && uniforms?.uTexel
          && uniforms?.uSeamOutlinesOn
        ) return material;
      }
    }
    return null;
  }

  const FULLSCREEN_VERTEX = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const FINAL_GLSL_HELPERS = `
    uniform float uHobunjiPaintMode;
    uniform sampler2D tHobunjiPaint;
    uniform vec2 uHobunjiPaintTexel;

    float hobunjiPaintLuma(vec3 c) {
      return dot(c, vec3(0.2126, 0.7152, 0.0722));
    }

    float hobunjiLinearSceneDepth(vec2 uv) {
      float z = texture2D(tSceneDepth, uv).r;
      float zNdc = z * 2.0 - 1.0;
      return (2.0 * uCameraNear * uCameraFar)
        / (uCameraFar + uCameraNear - zNdc * (uCameraFar - uCameraNear));
    }

    float hobunjiDepthCompatibility(float centerDepth, float sampleDepth) {
      float tolerance = max(1.5, centerDepth * 0.06);
      float ordinary = step(abs(sampleDepth - centerDepth), tolerance);
      float centerSky = step(170.0, centerDepth);
      float sampleSky = step(170.0, sampleDepth);
      return mix(ordinary, sampleSky, centerSky);
    }

    float hobunjiDistancePaintFactor(vec2 uv) {
      float depth = hobunjiLinearSceneDepth(uv);
      return depth >= 170.0 ? 1.0 : smoothstep(18.0, 55.0, depth);
    }

    vec2 hobunjiPaintSafeUv(vec2 uv) {
      vec2 h = max(uHobunjiPaintTexel * 0.5, vec2(0.000001));
      return clamp(uv, h, vec2(1.0) - h);
    }

    vec3 hobunjiPaintRead(vec2 uv) {
      return texture2D(tHobunjiPaint, hobunjiPaintSafeUv(uv)).rgb;
    }

    vec3 hobunjiFinishReferenceStack(vec2 uv) {
      vec3 c = hobunjiPaintRead(uv);
      if (uHobunjiPaintMode < 0.5) return texture2D(tColor, uv).rgb;

      vec2 t = uHobunjiPaintTexel;
      vec2 uvTL = uv + vec2(-t.x,  t.y);
      vec2 uvTC = uv + vec2( 0.0,  t.y);
      vec2 uvTR = uv + vec2( t.x,  t.y);
      vec2 uvML = uv + vec2(-t.x,  0.0);
      vec2 uvMR = uv + vec2( t.x,  0.0);
      vec2 uvBL = uv + vec2(-t.x, -t.y);
      vec2 uvBC = uv + vec2( 0.0, -t.y);
      vec2 uvBR = uv + vec2( t.x, -t.y);
      vec3 tl = hobunjiPaintRead(uvTL);
      vec3 tc = hobunjiPaintRead(uvTC);
      vec3 tr = hobunjiPaintRead(uvTR);
      vec3 ml = hobunjiPaintRead(uvML);
      vec3 mr = hobunjiPaintRead(uvMR);
      vec3 bl = hobunjiPaintRead(uvBL);
      vec3 bc = hobunjiPaintRead(uvBC);
      vec3 br = hobunjiPaintRead(uvBR);

      float centerDepthForFinish = hobunjiLinearSceneDepth(uv);
      tl = mix(c, tl, hobunjiDepthCompatibility(centerDepthForFinish, hobunjiLinearSceneDepth(uvTL)));
      tc = mix(c, tc, hobunjiDepthCompatibility(centerDepthForFinish, hobunjiLinearSceneDepth(uvTC)));
      tr = mix(c, tr, hobunjiDepthCompatibility(centerDepthForFinish, hobunjiLinearSceneDepth(uvTR)));
      ml = mix(c, ml, hobunjiDepthCompatibility(centerDepthForFinish, hobunjiLinearSceneDepth(uvML)));
      mr = mix(c, mr, hobunjiDepthCompatibility(centerDepthForFinish, hobunjiLinearSceneDepth(uvMR)));
      bl = mix(c, bl, hobunjiDepthCompatibility(centerDepthForFinish, hobunjiLinearSceneDepth(uvBL)));
      bc = mix(c, bc, hobunjiDepthCompatibility(centerDepthForFinish, hobunjiLinearSceneDepth(uvBC)));
      br = mix(c, br, hobunjiDepthCompatibility(centerDepthForFinish, hobunjiLinearSceneDepth(uvBR)));

      float lTL = hobunjiPaintLuma(tl);
      float lTC = hobunjiPaintLuma(tc);
      float lTR = hobunjiPaintLuma(tr);
      float lML = hobunjiPaintLuma(ml);
      float lC = hobunjiPaintLuma(c);
      float lMR = hobunjiPaintLuma(mr);
      float lBL = hobunjiPaintLuma(bl);
      float lBC = hobunjiPaintLuma(bc);
      float lBR = hobunjiPaintLuma(br);

      float gx = -lTL + lTR - 2.0 * lML + 2.0 * lMR - lBL + lBR;
      float gy = -lTL - 2.0 * lTC - lTR + lBL + 2.0 * lBC + lBR;
      float distancePaint = hobunjiDistancePaintFactor(uv);
      float edge = min(1.0, length(vec2(gx, gy)) / 1.647058824);
      float edgeMul = 1.0 - edge * 0.76;

      vec3 blur3 = (tl + tc + tr + ml + c + mr + bl + bc + br) / 9.0;
      float detailStrength = mix(1.00, 0.86, distancePaint);
      float detail = (lC - hobunjiPaintLuma(blur3)) * detailStrength;
      vec3 color = c * edgeMul + vec3(detail);
      color += c - blur3;

      // The older far preset used a small anti-brown correction (.14).
      float deBrown = 0.14 * distancePaint;
      float warm = clamp((color.r - color.b) * ((color.r + color.g) * 0.5), 0.0, 1.0);
      color.r -= (16.0 / 255.0) * deBrown * warm;
      color.g += (10.0 / 255.0) * deBrown * warm;
      color.b += (18.0 / 255.0) * deBrown * warm;

      float maxc = max(color.r, max(color.g, color.b));
      float minc = min(color.r, min(color.g, color.b));
      float sat = maxc <= 0.000001 ? 0.0 : (maxc - minc) / maxc;
      float grey = dot(color, vec3(0.299, 0.587, 0.114));
      float revive = 0.80 * (1.0 - sat) * 0.90;
      color = vec3(grey) + (color - vec3(grey)) * (1.0 + revive);
      return clamp(color, 0.0, 1.0);
    }

    vec3 hobunjiPainterlyCompositeEdge(vec3 color, float edge) {
      if (uHobunjiPaintMode < 0.5) return mix(color, vec3(0.0), edge);
      return mix(color, color * 0.24, edge * 0.58);
    }
  `;

  function glslSafeUv(texelName = 'uWorkTexel') {
    return `
      vec2 safeUv(vec2 uv) {
        vec2 h = max(${texelName} * 0.5, vec2(0.000001));
        return clamp(uv, h, vec2(1.0) - h);
      }
    `;
  }

  function oilFragment(profile) {
    const calls = [];
    for (const y of profile.oilOffsets) {
      for (const x of profile.oilOffsets) {
        calls.push(`addOilSample(vec2(${x.toFixed(2)}, ${y.toFixed(2)}), distancePaint, centerDepth, sum0, sum1, sum2, count0, count1, count2);`);
      }
    }
    return `
      uniform sampler2D tSource;
      uniform sampler2D tSceneDepth;
      uniform vec2 uWorkTexel;
      uniform float uCameraNear;
      uniform float uCameraFar;
      varying vec2 vUv;
      ${glslSafeUv()}
      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      float linearDepthAt(vec2 uv) {
        float z = texture2D(tSceneDepth, safeUv(uv)).r;
        float zNdc = z * 2.0 - 1.0;
        return (2.0 * uCameraNear * uCameraFar)
          / (uCameraFar + uCameraNear - zNdc * (uCameraFar - uCameraNear));
      }
      float paintFactorForDepth(float depth) {
        return depth >= 170.0 ? 1.0 : smoothstep(18.0, 55.0, depth);
      }
      float depthCompatibility(float centerDepth, float sampleDepth) {
        float tolerance = max(1.5, centerDepth * 0.06);
        float ordinary = step(abs(sampleDepth - centerDepth), tolerance);
        float centerSky = step(170.0, centerDepth);
        float sampleSky = step(170.0, sampleDepth);
        return mix(ordinary, sampleSky, centerSky);
      }
      void addOilSample(
        vec2 nearPixelOffset,
        float distancePaint,
        float centerDepth,
        inout vec3 sum0, inout vec3 sum1, inout vec3 sum2,
        inout float count0, inout float count1, inout float count2
      ) {
        vec2 sampleOffset = nearPixelOffset * mix(1.0, 0.60, distancePaint);
        vec2 sampleUv = safeUv(vUv + sampleOffset * uWorkTexel);
        float sampleDepth = linearDepthAt(sampleUv);
        if (depthCompatibility(centerDepth, sampleDepth) < 0.5) return;
        vec3 c = texture2D(tSource, sampleUv).rgb;
        float bin = min(2.0, floor(clamp(luma(c), 0.0, 0.999999) * 3.0));
        if (bin < 0.5) { sum0 += c; count0 += 1.0; }
        else if (bin < 1.5) { sum1 += c; count1 += 1.0; }
        else { sum2 += c; count2 += 1.0; }
      }
      void main() {
        float centerDepth = linearDepthAt(vUv);
        float distancePaint = paintFactorForDepth(centerDepth);
        vec3 sum0 = vec3(0.0), sum1 = vec3(0.0), sum2 = vec3(0.0);
        float count0 = 0.0, count1 = 0.0, count2 = 0.0;
        ${calls.join('\n        ')}
        vec3 source = texture2D(tSource, safeUv(vUv)).rgb;
        vec3 oil = source;
        float best = count0;
        if (count0 > 0.0) oil = sum0 / count0;
        if (count1 > best) { best = count1; oil = sum1 / max(count1, 1.0); }
        if (count2 > best) { oil = sum2 / max(count2, 1.0); }
        float oilMix = mix(0.27, 0.32, distancePaint);
        gl_FragColor = vec4(mix(source, oil, oilMix), 1.0);
      }
    `;
  }

  function horizontalWashFragment(profile) {
    const radius = 4;
    const taps = [];
    for (let x = -radius; x <= radius; x++) {
      const nearEnabled = Math.abs(x) <= profile.waterRadius ? '1.0' : '0.0';
      taps.push(`
        {
          vec2 sampleUv = safeUv(vUv + vec2(${x.toFixed(1)} * uWorkTexel.x, 0.0));
          float sampleDepth = linearDepthAt(sampleUv);
          float depthOkay = depthCompatibility(centerDepth, sampleDepth);
          float radiusWeight = mix(${nearEnabled}, 1.0, distancePaint);
          float w = radiusWeight * depthOkay;
          sum += texture2D(tOil, sampleUv).rgb * w;
          weight += w;
        }`);
    }
    return `
      uniform sampler2D tOil;
      uniform sampler2D tSceneDepth;
      uniform vec2 uWorkTexel;
      uniform float uCameraNear;
      uniform float uCameraFar;
      varying vec2 vUv;
      ${glslSafeUv()}
      float linearDepthAt(vec2 uv) {
        float z = texture2D(tSceneDepth, safeUv(uv)).r;
        float zNdc = z * 2.0 - 1.0;
        return (2.0 * uCameraNear * uCameraFar)
          / (uCameraFar + uCameraNear - zNdc * (uCameraFar - uCameraNear));
      }
      float paintFactorForDepth(float depth) {
        return depth >= 170.0 ? 1.0 : smoothstep(18.0, 55.0, depth);
      }
      float depthCompatibility(float centerDepth, float sampleDepth) {
        float tolerance = max(1.5, centerDepth * 0.06);
        float ordinary = step(abs(sampleDepth - centerDepth), tolerance);
        float centerSky = step(170.0, centerDepth);
        float sampleSky = step(170.0, sampleDepth);
        return mix(ordinary, sampleSky, centerSky);
      }
      void main() {
        float centerDepth = linearDepthAt(vUv);
        float distancePaint = paintFactorForDepth(centerDepth);
        vec3 sum = vec3(0.0);
        float weight = 0.0;
        ${taps.join('\n        ')}
        vec3 fallback = texture2D(tOil, safeUv(vUv)).rgb;
        gl_FragColor = vec4(weight > 0.0 ? sum / weight : fallback, 1.0);
      }
    `;
  }

  function verticalWashToneFragment(profile) {
    const radius = 4;
    const taps = [];
    for (let y = -radius; y <= radius; y++) {
      const nearEnabled = Math.abs(y) <= profile.waterRadius ? '1.0' : '0.0';
      taps.push(`
        {
          vec2 sampleUv = safeUv(vUv + vec2(0.0, ${y.toFixed(1)} * uWorkTexel.y));
          float sampleDepth = linearDepthAt(sampleUv);
          float depthOkay = depthCompatibility(centerDepth, sampleDepth);
          float radiusWeight = mix(${nearEnabled}, 1.0, distancePaint);
          float w = radiusWeight * depthOkay;
          sum += texture2D(tWashH, sampleUv).rgb * w;
          weight += w;
        }`);
    }
    return `
      uniform sampler2D tOil;
      uniform sampler2D tWashH;
      uniform sampler2D tSceneDepth;
      uniform vec2 uWorkTexel;
      uniform float uCameraNear;
      uniform float uCameraFar;
      varying vec2 vUv;
      ${glslSafeUv()}
      float linearDepthAt(vec2 uv) {
        float z = texture2D(tSceneDepth, safeUv(uv)).r;
        float zNdc = z * 2.0 - 1.0;
        return (2.0 * uCameraNear * uCameraFar)
          / (uCameraFar + uCameraNear - zNdc * (uCameraFar - uCameraNear));
      }
      float paintFactorForDepth(float depth) {
        return depth >= 170.0 ? 1.0 : smoothstep(18.0, 55.0, depth);
      }
      float depthCompatibility(float centerDepth, float sampleDepth) {
        float tolerance = max(1.5, centerDepth * 0.06);
        float ordinary = step(abs(sampleDepth - centerDepth), tolerance);
        float centerSky = step(170.0, centerDepth);
        float sampleSky = step(170.0, sampleDepth);
        return mix(ordinary, sampleSky, centerSky);
      }
      void main() {
        float centerDepth = linearDepthAt(vUv);
        float distancePaint = paintFactorForDepth(centerDepth);
        vec3 sum = vec3(0.0);
        float weight = 0.0;
        ${taps.join('\n        ')}
        vec3 src = texture2D(tOil, safeUv(vUv)).rgb;
        vec3 wash = weight > 0.0 ? sum / weight : src;

        float waterMix = mix(${profile.waterMix.toFixed(2)}, 0.51, distancePaint);
        float edgeStain = mix(${profile.edgeStain.toFixed(2)}, 0.32, distancePaint);
        vec3 color = mix(src, wash, waterMix);
        float diff = abs(src.r - wash.r) + abs(src.g - wash.g) + abs(src.b - wash.b);
        float edge = clamp(diff / 0.705882353, 0.0, 1.0);
        color *= 1.0 - (edgeStain * edge) * 0.18;

        float gammaValue = mix(0.81, 0.84, distancePaint);
        color = pow(max(color, vec3(0.0)), vec3(gammaValue));
        float avg = (color.r + color.g + color.b) / 3.0;
        float shadowGate = clamp((0.46 - avg) / 0.46, 0.0, 1.0);
        float crush = mix(0.18, 0.13, distancePaint);
        color = max(vec3(0.0), color - vec3(crush * shadowGate));
        float contrast = mix(0.80, 1.60, distancePaint);
        color = clamp((color - vec3(0.5)) * contrast + vec3(0.5), 0.0, 1.0);

        float grey = dot(color, vec3(0.299, 0.587, 0.114));
        float saturation = mix(0.68, 1.62, distancePaint);
        color = vec3(grey) + (color - vec3(grey)) * saturation;

        vec3 paletteBase = color;
        float paletteMax = max(color.r, max(color.g, color.b));
        float paletteMin = min(color.r, min(color.g, color.b));
        float paletteChroma = paletteMax - paletteMin;
        float blueDeficit = clamp((min(color.r, color.g) - color.b) * 2.5, 0.0, 1.0);
        float greenLead = smoothstep(-0.015, 0.075, color.g - color.r);
        float vividGate = smoothstep(0.085, 0.22, paletteChroma);
        float yellowGreenGate = blueDeficit * greenLead * vividGate;

        // Preserve the tan-safe family split while interpolating toward the
        // older vivid far-palette values.
        float yellowLift = mix(0.08, 0.36, distancePaint);
        float blueSuppress = mix(0.67, 0.00, distancePaint);
        color.r += yellowLift * yellowGreenGate * 0.75;
        color.g += yellowLift * yellowGreenGate;
        color.b -= blueSuppress * yellowGreenGate;

        float tanProtection = blueDeficit * (1.0 - greenLead * vividGate);
        color = mix(color, paletteBase, tanProtection * 0.86);

        // Older far preset adds a small teal bias only to dark green-led color.
        float lum = (color.r + color.g + color.b) / 3.0;
        float greenGate = max(0.0, color.g - max(color.r * 0.7, color.b * 0.8));
        float tealGate = greenGate * max(0.0, 1.0 - lum * 1.35);
        float tealStrength = 0.10 * distancePaint;
        color.g += tealStrength * tealGate * 0.45;
        color.b += tealStrength * tealGate;
        color.r -= tealStrength * tealGate * 0.25;

        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }
    `;
  }

  function makeFullscreenPass(THREE, fragmentShader, uniforms) {
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);
    return { scene, camera, mesh, material };
  }

  function ensurePipeline(renderer) {
    if (pipeline) return pipeline;
    const THREE = window.THREE;
    if (!THREE?.WebGLRenderTarget || !THREE?.ShaderMaterial) {
      lastError = 'Paint pipeline could not find THREE render-target/shader APIs.';
      updateStatus();
      return null;
    }

    const makeTarget = () => {
      const target = new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      target.texture.generateMipmaps = false;
      return target;
    };

    pipeline = {
      oilRT: makeTarget(),
      washHRT: makeTarget(),
      toneRT: makeTarget(),
      profiles: Object.create(null),
      width: 1,
      height: 1,
      rawRender: null,
    };
    return pipeline;
  }

  function ensureProfilePasses(modeName) {
    const p = pipeline;
    if (!p) return null;
    if (p.profiles[modeName]) return p.profiles[modeName];
    const THREE = window.THREE;
    const profile = MODE_PROFILE[modeName];
    if (!profile) return null;

    const oil = makeFullscreenPass(THREE, oilFragment(profile), {
      tSource: { value: null },
      tSceneDepth: { value: null },
      uWorkTexel: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 200 },
    });
    const washH = makeFullscreenPass(THREE, horizontalWashFragment(profile), {
      tOil: { value: p.oilRT.texture },
      tSceneDepth: { value: null },
      uWorkTexel: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 200 },
    });
    const tone = makeFullscreenPass(THREE, verticalWashToneFragment(profile), {
      tOil: { value: p.oilRT.texture },
      tWashH: { value: p.washHRT.texture },
      tSceneDepth: { value: null },
      uWorkTexel: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 200 },
    });
    p.profiles[modeName] = { oil, washH, tone };
    return p.profiles[modeName];
  }

  function sourceDimensions(renderer, texture) {
    const image = texture?.image;
    let width = Number(image?.width) || 0;
    let height = Number(image?.height) || 0;
    if ((!width || !height) && renderer?.getDrawingBufferSize && window.THREE?.Vector2) {
      const size = renderer.getDrawingBufferSize(new window.THREE.Vector2());
      width = Number(size?.x) || width;
      height = Number(size?.y) || height;
    }
    return { width: Math.max(1, width || 1), height: Math.max(1, height || 1) };
  }

  function pipelineSize(renderer, texture) {
    const srcSize = sourceDimensions(renderer, texture);
    return {
      width: srcSize.width,
      height: srcSize.height,
    };
  }

  function runReferencePipeline(renderer, compositeMaterial) {
    if (mode === 'off') return null;
    const p = ensurePipeline(renderer);
    if (!p?.rawRender) return null;
    const passes = ensureProfilePasses(mode);
    const profile = MODE_PROFILE[mode];
    const sourceTexture = compositeMaterial?.uniforms?.tColor?.value;
    const sceneDepthTexture = compositeMaterial?.uniforms?.tSceneDepth?.value;
    const cameraNear = Number(compositeMaterial?.uniforms?.uCameraNear?.value) || 0.1;
    const cameraFar = Number(compositeMaterial?.uniforms?.uCameraFar?.value) || 200;
    if (!passes || !profile || !sourceTexture || !sceneDepthTexture) return null;

    const size = pipelineSize(renderer, sourceTexture);
    if (p.width !== size.width || p.height !== size.height) {
      p.width = size.width;
      p.height = size.height;
      p.oilRT.setSize(size.width, size.height);
      p.washHRT.setSize(size.width, size.height);
      p.toneRT.setSize(size.width, size.height);
    }

    const texelX = 1 / size.width;
    const texelY = 1 / size.height;
    passes.oil.material.uniforms.tSource.value = sourceTexture;
    passes.oil.material.uniforms.tSceneDepth.value = sceneDepthTexture;
    passes.oil.material.uniforms.uCameraNear.value = cameraNear;
    passes.oil.material.uniforms.uCameraFar.value = cameraFar;
    passes.oil.material.uniforms.uWorkTexel.value.set(texelX, texelY);

    passes.washH.material.uniforms.tSceneDepth.value = sceneDepthTexture;
    passes.washH.material.uniforms.uCameraNear.value = cameraNear;
    passes.washH.material.uniforms.uCameraFar.value = cameraFar;
    passes.washH.material.uniforms.uWorkTexel.value.set(texelX, texelY);

    passes.tone.material.uniforms.tSceneDepth.value = sceneDepthTexture;
    passes.tone.material.uniforms.uCameraNear.value = cameraNear;
    passes.tone.material.uniforms.uCameraFar.value = cameraFar;
    passes.tone.material.uniforms.uWorkTexel.value.set(texelX, texelY);

    const previousTarget = renderer.getRenderTarget?.() || null;
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(p.oilRT);
      renderer.clear?.(true, false, false);
      p.rawRender.call(renderer, passes.oil.scene, passes.oil.camera);

      renderer.setRenderTarget(p.washHRT);
      renderer.clear?.(true, false, false);
      p.rawRender.call(renderer, passes.washH.scene, passes.washH.camera);

      renderer.setRenderTarget(p.toneRT);
      renderer.clear?.(true, false, false);
      p.rawRender.call(renderer, passes.tone.scene, passes.tone.camera);
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget);
    }

    compositeMaterial.uniforms.tHobunjiPaint.value = p.toneRT.texture;
    compositeMaterial.uniforms.uHobunjiPaintTexel.value.set(texelX, texelY);
    pipelineFrames += 1;
    lastPipelineSize = `${size.width}x${size.height}`;
    lastPipelineMode = mode;
    return p.toneRT.texture;
  }

  function patchCompositeMaterial(material) {
    if (!material) return false;
    if (material.userData?.hobunjiPainterlyPatched) {
      patchedMaterials.add(material);
      return true;
    }

    const source = String(material.fragmentShader || '');
    const colorLine = 'vec3 color = texture2D(tColor, vUv).rgb;';
    const varyingLine = 'varying vec2 vUv;';
    const finalCompositeLine = 'gl_FragColor = vec4(mix(color, vec3(0.0), edge), 1.0);';
    if (!source.includes(colorLine) || !source.includes(varyingLine) || !source.includes(finalCompositeLine)) {
      lastError = 'Paint shader patch skipped: outline composite signature changed.';
      updateStatus();
      return false;
    }

    const THREE = window.THREE;
    material.uniforms.uHobunjiPaintMode = { value: modeValue() };
    material.uniforms.tHobunjiPaint = { value: material.uniforms.tColor.value };
    material.uniforms.uHobunjiPaintTexel = { value: new THREE.Vector2(1, 1) };
    material.fragmentShader = source
      .replace(varyingLine, `${varyingLine}\n${FINAL_GLSL_HELPERS}`)
      .replace(colorLine, 'vec3 color = hobunjiFinishReferenceStack(vUv);')
      .replace(finalCompositeLine, 'gl_FragColor = vec4(hobunjiPainterlyCompositeEdge(color, edge), 1.0);');

    material.userData ||= {};
    material.userData.hobunjiPainterlyPatched = true;
    material.needsUpdate = true;
    patchedMaterials.add(material);
    compositeSeenAt = performance.now();
    lastError = '';
    updateStatus();
    return true;
  }

  function setMode(nextMode) {
    mode = normalizeMode(nextMode);
    persistMode();
    const value = modeValue();
    for (const material of patchedMaterials) {
      if (material?.uniforms?.uHobunjiPaintMode) material.uniforms.uHobunjiPaintMode.value = value;
    }
    const select = document.getElementById('settingPainterlyPostprocess');
    if (select && select.value !== mode) select.value = mode;
    updateStatus();
  }

  function outlinesEnabled() {
    try {
      const value = window.__climbDebug?.outlinesSetting;
      return typeof value === 'boolean' ? value : null;
    } catch (_) {
      return null;
    }
  }

  function statusText() {
    if (lastError) return `Paint filter error: ${lastError}`;
    if (mode === 'off') return 'Off — no extra texture samples are executed.';
    if (!rendererAttached) return `${mode} selected — waiting for the gameplay renderer.`;
    if (!patchedMaterials.size) return `${mode} selected — waiting for the outline composite's first frame.`;
    if (outlinesEnabled() === false) return `${mode} selected, but Outlines are off; this experiment currently reuses the outline composite and is inactive.`;
    return `${mode[0].toUpperCase() + mode.slice(1)} active — current paint through ${DISTANCE_NEAR}u, smoothly stronger to old intense preset by ${DISTANCE_FAR}u; full-res + depth-edge guarded; internal=${lastPipelineSize || 'waiting'}; HUD/dialogue stay crisp.`;
  }

  function updateStatus() {
    const status = document.getElementById('painterlyPostprocessStatus');
    if (status) status.textContent = statusText();
  }

  function bindOutlineStatus() {
    const outlineInput = document.getElementById('settingOutlines'); // Refreshes the visible warning when the shared outline composite is toggled.
    if (!outlineInput || outlineInput.dataset.hobunjiPainterlyStatusBound === '1') return false;
    outlineInput.dataset.hobunjiPainterlyStatusBound = '1';
    outlineInput.addEventListener('change', () => setTimeout(updateStatus, 0));
    return true;
  }

  function bindSettingsControl() {
    const select = document.getElementById('settingPainterlyPostprocess');
    if (!select || select.dataset.hobunjiPainterlyBound === '1') return false;
    select.dataset.hobunjiPainterlyBound = '1';
    select.value = mode;
    select.addEventListener('change', () => setMode(select.value));
    updateStatus();
    return true;
  }

  function attachRenderer(renderer) {
    if (!renderer || renderer.__hobunjiPainterlyPostprocessWrapped) return false;
    const originalRender = renderer.render;
    if (typeof originalRender !== 'function') {
      lastError = 'Gameplay renderer has no callable render() method.';
      updateStatus();
      return false;
    }

    rendererRef = renderer;
    renderer.render = function hobunjiPainterlyRender(scene, camera) {
      const material = !this.getRenderTarget?.() ? findCompositeMaterial(scene) : null;
      if (material) {
        patchCompositeMaterial(material);
        const p = ensurePipeline(this);
        if (p) p.rawRender = originalRender;
        if (mode !== 'off' && material.userData?.hobunjiPainterlyPatched) runReferencePipeline(this, material);
      }
      return originalRender.call(this, scene, camera);
    };
    renderer.render.__hobunjiPainterlyOriginal = originalRender;
    renderer.__hobunjiPainterlyPostprocessWrapped = true;
    rendererAttached = true;
    updateStatus();
    return true;
  }

  function tryAttachRenderer() {
    bindSettingsControl();
    const renderer = window.__hobunjiGameRenderer;
    if (renderer) {
      attachRenderer(renderer);
      return true;
    }
    attachAttempts += 1;
    if (attachAttempts >= 80) {
      lastError = 'Gameplay renderer was not found during startup.';
      updateStatus();
      return true;
    }
    return false;
  }

  window.PainterlyPostprocess = {
    setMode,
    getMode: () => mode,
    snapshot: () => ({
      latestChange: 'Sky-integrated atmospheric paint: clouds, procedural stars, moon, sun/glows, and base sky are one far paint band while foreground/world depth edges stay protected.',
      mode,
      sampleCount: MODE_SAMPLE_COUNT[mode],
      internalSize: lastPipelineSize || null,
      pipelineFrames,
      pipelineMode: lastPipelineMode,
      referenceSettings: `near=current oil 10/3/.27, watercolor ${MODE_PROFILE[mode]?.waterRadius || 0}/${MODE_PROFILE[mode]?.waterMix?.toFixed(2) || '0'}/1.00; far=old intense oil 6/3/.32, watercolor 4/.51/.32; distance 18-55u; tan protection .86 retained; full-res`,
      distanceNear: DISTANCE_NEAR,
      distanceFar: DISTANCE_FAR,
      depthGuarded: true,
      skyIntegrated: true,
      skyDepthMin: SKY_DEPTH_MIN,
      rendererAttached,
      compositePatched: patchedMaterials.size > 0,
      compositeSeenAt,
      outlinesEnabled: outlinesEnabled(),
      lastError: lastError || null,
    }),
  };

  bindSettingsControl();
  bindOutlineStatus();
  if (!tryAttachRenderer()) {
    const attachTimer = setInterval(() => {
      if (tryAttachRenderer()) clearInterval(attachTimer);
    }, 100);
  }
})();
