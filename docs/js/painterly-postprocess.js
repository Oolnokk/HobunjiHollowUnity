(() => {
  'use strict';

  // Experimental world-only paint stack. This patches the game's existing
  // fullscreen outline composite, so HUD/menus and the separately redrawn
  // world-space dialogue/chat text remain crisp and outside the effect.
  const STORAGE_KEY = 'hobunjiPainterlyPostprocessMode';
  const MODE_TO_VALUE = Object.freeze({ off: 0, low: 1, medium: 2, high: 3 });
  const MODE_SAMPLE_COUNT = Object.freeze({ off: 0, low: 10, medium: 14, high: 22 });

  let mode = loadMode(); // Read by the settings control and shader uniforms.
  let rendererAttached = false; // Reported by the in-game status/debug API.
  let compositeSeenAt = 0; // Reported so mobile testing can confirm the post scene was found.
  let lastError = ''; // Shown in Settings when shader patching/attachment fails.
  let attachAttempts = 0; // Limits startup polling if the gameplay renderer never appears.
  const patchedMaterials = new Set(); // Updated by setMode() when the quality dropdown changes.

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

  const GLSL_HELPERS = `
    uniform float uHobunjiPaintMode;

    float hobunjiPaintLuma(vec3 c) {
      return dot(c, vec3(0.2126, 0.7152, 0.0722));
    }

    float hobunjiPaintVariance4(vec3 a, vec3 b, vec3 c, vec3 d, vec3 meanColor) {
      vec3 da = a - meanColor;
      vec3 db = b - meanColor;
      vec3 dc = c - meanColor;
      vec3 dd = d - meanColor;
      return dot(da, da) + dot(db, db) + dot(dc, dc) + dot(dd, dd);
    }

    float hobunjiPaintHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    vec2 hobunjiPaintSafeUv(vec2 uv) {
      vec2 halfTexel = max(uTexel * 0.5, vec2(0.000001));
      return clamp(uv, halfTexel, vec2(1.0) - halfTexel);
    }

    vec3 hobunjiPaintSample(vec2 uv) {
      return texture2D(tColor, hobunjiPaintSafeUv(uv)).rgb;
    }

    vec3 hobunjiPaintPosterize(vec3 color, float levels, float amount) {
      vec3 stepped = floor(color * levels + 0.5) / levels;
      return mix(color, stepped, amount);
    }

    vec3 hobunjiPaintSoftenInk(vec3 paintedColor, vec2 uv) {
      // The shell-outline pass is already baked into tColor before this
      // composite. Treat near-black high-contrast pixels as pigment to be
      // carried into their neighboring cel colors instead of preserving them
      // as razor-thin dividers.
      vec2 texel = max(uTexel, vec2(0.000001));
      float spreadPx = uHobunjiPaintMode < 1.5 ? 1.25
        : (uHobunjiPaintMode < 2.5 ? 1.75 : 2.25);
      vec2 o = texel * spreadPx;

      vec3 raw = hobunjiPaintSample(uv);
      vec3 nL = hobunjiPaintSample(uv - vec2(o.x, 0.0));
      vec3 nR = hobunjiPaintSample(uv + vec2(o.x, 0.0));
      vec3 nU = hobunjiPaintSample(uv + vec2(0.0, o.y));
      vec3 nD = hobunjiPaintSample(uv - vec2(0.0, o.y));

      float rawL = hobunjiPaintLuma(raw);
      float lL = hobunjiPaintLuma(nL);
      float lR = hobunjiPaintLuma(nR);
      float lU = hobunjiPaintLuma(nU);
      float lD = hobunjiPaintLuma(nD);
      float maxNeighborL = max(max(lL, lR), max(lU, lD));
      float minNeighborL = min(min(lL, lR), min(lU, lD));
      vec3 neighborMean = (nL + nR + nU + nD) * 0.25;

      // Favor the brightest adjacent cel as the color carried across a black
      // ink core. This keeps a thin outline from surviving as a black comb of
      // pixels after the oil-region quantization.
      vec3 carrier = nL;
      float carrierL = lL;
      if (lR > carrierL) { carrier = nR; carrierL = lR; }
      if (lU > carrierL) { carrier = nU; carrierL = lU; }
      if (lD > carrierL) { carrier = nD; carrierL = lD; }
      carrier = mix(neighborMean, carrier, 0.58);

      float inkCore = smoothstep(0.10, 0.40, maxNeighborL - rawL)
        * (1.0 - smoothstep(0.20, 0.40, rawL));
      float inkBeside = smoothstep(0.08, 0.34, rawL - minNeighborL)
        * (1.0 - smoothstep(0.20, 0.44, minNeighborL));

      float coreLift = uHobunjiPaintMode < 1.5 ? 0.44
        : (uHobunjiPaintMode < 2.5 ? 0.58 : 0.68);
      float sideSpread = uHobunjiPaintMode < 1.5 ? 0.12
        : (uHobunjiPaintMode < 2.5 ? 0.18 : 0.24);

      // Lift the black center toward the adjacent cel color, then drag a much
      // smaller amount of that darkness outward into nearby colored pixels.
      // Together these turn the outline into a soft shape accent rather than
      // a hard separator.
      vec3 liftedCore = mix(paintedColor, carrier, 0.78);
      paintedColor = mix(paintedColor, liftedCore, inkCore * coreLift);

      vec3 spreadTone = mix(paintedColor, neighborMean * 0.64, 0.46);
      paintedColor = mix(paintedColor, spreadTone, inkBeside * sideSpread);
      return clamp(paintedColor, 0.0, 1.0);
    }

    vec3 hobunjiPainterlyCompositeEdge(vec3 color, float edge) {
      if (uHobunjiPaintMode < 0.5) return mix(color, vec3(0.0), edge);

      // Furniture/material seam outlines are generated here in the final
      // composite rather than baked into tColor, so they need their own
      // treatment: dark local pigment, never a fresh pure-black line.
      float edgeOpacity = uHobunjiPaintMode < 1.5 ? 0.72
        : (uHobunjiPaintMode < 2.5 ? 0.62 : 0.54);
      vec3 accentPigment = color * 0.20;
      return mix(color, accentPigment, edge * edgeOpacity);
    }

    vec3 hobunjiPainterlyColor(vec2 uv) {
      vec3 source = hobunjiPaintSample(uv);
      if (uHobunjiPaintMode < 0.5) return source;

      // Keep the paint structure on a coarse, deterministic screen grid. The
      // shader never uses time-varying noise, so motion can move through the
      // brush cells without the filter itself boiling frame-to-frame.
      float cellPx = uHobunjiPaintMode < 1.5 ? 1.5
        : (uHobunjiPaintMode < 2.5 ? 2.0 : 2.5);
      vec2 texel = max(uTexel, vec2(0.000001));
      vec2 pixel = uv / texel;
      vec2 cellPixel = (floor(pixel / cellPx) + 0.5) * cellPx;
      vec2 paintUv = hobunjiPaintSafeUv(cellPixel * texel);
      vec3 center = hobunjiPaintSample(paintUv);

      float radiusPx = uHobunjiPaintMode < 1.5 ? 2.75
        : (uHobunjiPaintMode < 2.5 ? 4.75 : 7.0);
      vec2 stepUv = texel * radiusPx;

      vec3 left  = hobunjiPaintSample(paintUv - vec2(stepUv.x, 0.0));
      vec3 right = hobunjiPaintSample(paintUv + vec2(stepUv.x, 0.0));
      vec3 up    = hobunjiPaintSample(paintUv + vec2(0.0, stepUv.y));
      vec3 down  = hobunjiPaintSample(paintUv - vec2(0.0, stepUv.y));
      vec3 crossWash = (center * 2.0 + left + right + up + down) / 6.0;

      float crossEdge = clamp(
        (abs(hobunjiPaintLuma(left) - hobunjiPaintLuma(right))
        + abs(hobunjiPaintLuma(up) - hobunjiPaintLuma(down))) * 1.35,
        0.0, 1.0
      );

      // LOW: still unmistakably painterly, but limited to source + coarse
      // center + four cardinal taps. The soft posterization is what pushes it
      // out of the old "weak blur" middle ground.
      if (uHobunjiPaintMode < 1.5) {
        vec3 oil = mix(crossWash, center, crossEdge * 0.30);
        oil = hobunjiPaintPosterize(oil, 15.0, 0.42);

        vec3 watercolor = mix(crossWash, oil, 0.32);
        vec3 color = mix(source, oil, 0.80);
        color = mix(color, watercolor, 0.18);

        float stain = clamp(crossEdge + length(center - crossWash) * 1.8, 0.0, 1.0);
        color -= vec3(0.028, 0.026, 0.022) * stain;

        // Tiny third-stage correction: sharpen against the local wash, undo
        // some warm/brown drift, and revive chroma without restoring the raw
        // frame strongly enough to erase the painted grouping.
        color *= vec3(1.020, 0.995, 0.965);
        color += (source - crossWash) * 0.11;
        float warmMud = clamp((color.r - color.b) * 1.7 - max(color.g - color.r, 0.0), 0.0, 1.0);
        color += vec3(-0.038, 0.008, 0.046) * warmMud;
        float grey = hobunjiPaintLuma(color);
        color = mix(vec3(grey), color, 1.08);

        vec2 grainCell = floor(pixel / 5.0);
        float grain = (hobunjiPaintHash(grainCell) - 0.5) * 0.012;
        color *= 1.0 + grain;
        return hobunjiPaintSoftenInk(clamp(color, 0.0, 1.0), uv);
      }

      vec3 ul = hobunjiPaintSample(paintUv + vec2(-stepUv.x,  stepUv.y));
      vec3 ur = hobunjiPaintSample(paintUv + vec2( stepUv.x,  stepUv.y));
      vec3 dl = hobunjiPaintSample(paintUv + vec2(-stepUv.x, -stepUv.y));
      vec3 dr = hobunjiPaintSample(paintUv + vec2( stepUv.x, -stepUv.y));

      // MEDIUM/HIGH oil stage: a deliberately broad Kuwahara region choice.
      // The old pass used the same idea timidly; larger radii plus soft color
      // stepping make neighboring shading collapse into obvious painted masses.
      vec3 m0 = (center + left  + up   + ul) * 0.25;
      vec3 m1 = (center + right + up   + ur) * 0.25;
      vec3 m2 = (center + left  + down + dl) * 0.25;
      vec3 m3 = (center + right + down + dr) * 0.25;
      float v0 = hobunjiPaintVariance4(center, left,  up,   ul, m0);
      float v1 = hobunjiPaintVariance4(center, right, up,   ur, m1);
      float v2 = hobunjiPaintVariance4(center, left,  down, dl, m2);
      float v3 = hobunjiPaintVariance4(center, right, down, dr, m3);
      vec3 oil = m0;
      float bestVariance = v0;
      if (v1 < bestVariance) { bestVariance = v1; oil = m1; }
      if (v2 < bestVariance) { bestVariance = v2; oil = m2; }
      if (v3 < bestVariance) { bestVariance = v3; oil = m3; }

      float posterLevels = uHobunjiPaintMode > 2.5 ? 11.0 : 14.0;
      float posterAmount = uHobunjiPaintMode > 2.5 ? 0.50 : 0.38;
      oil = hobunjiPaintPosterize(oil, posterLevels, posterAmount);

      vec3 nineWash = (
        center + left + right + up + down + ul + ur + dl + dr
      ) / 9.0;
      vec3 watercolor = nineWash;

      // HIGH spends eight additional wider taps on the wash stage. This is
      // intentionally the expensive screenshot-first tier: broad pigment
      // pooling matters more here than minimizing texture reads.
      if (uHobunjiPaintMode > 2.5) {
        vec2 outer = stepUv * 1.85;
        vec3 l2  = hobunjiPaintSample(paintUv - vec2(outer.x, 0.0));
        vec3 r2  = hobunjiPaintSample(paintUv + vec2(outer.x, 0.0));
        vec3 u2  = hobunjiPaintSample(paintUv + vec2(0.0, outer.y));
        vec3 d2  = hobunjiPaintSample(paintUv - vec2(0.0, outer.y));
        vec3 ul2 = hobunjiPaintSample(paintUv + vec2(-outer.x,  outer.y));
        vec3 ur2 = hobunjiPaintSample(paintUv + vec2( outer.x,  outer.y));
        vec3 dl2 = hobunjiPaintSample(paintUv + vec2(-outer.x, -outer.y));
        vec3 dr2 = hobunjiPaintSample(paintUv + vec2( outer.x, -outer.y));
        watercolor = (
          nineWash * 9.0 + l2 + r2 + u2 + d2 + ul2 + ur2 + dl2 + dr2
        ) / 17.0;
      }

      float oilStrength = uHobunjiPaintMode > 2.5 ? 0.98 : 0.93;
      float waterStrength = uHobunjiPaintMode > 2.5 ? 0.36 : 0.28;
      vec3 color = mix(source, oil, oilStrength);
      color = mix(color, watercolor, waterStrength);

      // Watercolor pooling/stain: accumulate pigment where neighboring values
      // disagree. It is intentionally broad and low-frequency, not noisy.
      float regionDifference = length(center - watercolor);
      float pigmentEdge = clamp(crossEdge + regionDifference * 2.2, 0.0, 1.0);
      float stainStrength = uHobunjiPaintMode > 2.5 ? 0.085 : 0.060;
      color -= vec3(0.050, 0.046, 0.040) * pigmentEdge * stainStrength * 12.0;

      // Let the oil/wash stack go a little warm first so the remembered third
      // filter has something meaningful to correct instead of just saturating.
      color *= uHobunjiPaintMode > 2.5
        ? vec3(1.040, 0.990, 0.940)
        : vec3(1.030, 0.994, 0.952);

      // Corrective pass: small unsharp-mask style detail return, explicit
      // anti-brown cooling, then chroma revival. This is deliberately much
      // weaker than the oil stage so silhouettes stay painterly.
      float correction = uHobunjiPaintMode > 2.5 ? 0.18 : 0.145;
      color += (source - nineWash) * correction;
      float warmMud = clamp(
        (color.r - color.b) * 1.8 - max(color.g - color.r, 0.0) * 0.6,
        0.0, 1.0
      );
      color += vec3(-0.058, 0.012, 0.072) * warmMud;
      float grey = hobunjiPaintLuma(color);
      float saturation = uHobunjiPaintMode > 2.5 ? 1.18 : 1.12;
      color = mix(vec3(grey), color, saturation);

      // Stable coarse pigment granulation. The cell is screen-locked and
      // several pixels wide, avoiding the crawling "TV noise" failure mode.
      float grainPx = uHobunjiPaintMode > 2.5 ? 7.0 : 6.0;
      vec2 grainCell = floor(pixel / grainPx);
      float grain = (hobunjiPaintHash(grainCell) - 0.5)
        * (uHobunjiPaintMode > 2.5 ? 0.020 : 0.014);
      color *= 1.0 + grain;

      return hobunjiPaintSoftenInk(clamp(color, 0.0, 1.0), uv);
    }
  `;
  function patchCompositeMaterial(material) {
    if (!material || material.userData?.hobunjiPainterlyPatched) return true;

    const source = String(material.fragmentShader || '');
    const colorLine = 'vec3 color = texture2D(tColor, vUv).rgb;';
    const varyingLine = 'varying vec2 vUv;';
    if (!source.includes(colorLine) || !source.includes(varyingLine)) {
      lastError = 'Paint shader patch skipped: outline composite signature changed.';
      updateStatus();
      return false;
    }

    material.uniforms.uHobunjiPaintMode = { value: modeValue() };
    const finalCompositeLine = 'gl_FragColor = vec4(mix(color, vec3(0.0), edge), 1.0);';
    if (!source.includes(finalCompositeLine)) {
      lastError = 'Paint shader patch skipped: outline output signature changed.';
      updateStatus();
      return false;
    }

    material.fragmentShader = source
      .replace(varyingLine, `${varyingLine}\n${GLSL_HELPERS}`)
      .replace(colorLine, 'vec3 color = hobunjiPainterlyColor(vUv);')
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
    return `${mode[0].toUpperCase() + mode.slice(1)} active — about ${MODE_SAMPLE_COUNT[mode]} world-color samples/pixel; black shell ink is softened into neighboring cel color and final seam ink is tinted/diffused instead of pure black; HUD and dialogue overlays stay crisp.`;
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

    renderer.render = function hobunjiPainterlyRender(scene, camera) {
      // Only inspect canvas-bound calls until the one static composite material
      // is found. Once patched, this wrapper is just one branch + function call.
      if (!patchedMaterials.size && !this.getRenderTarget?.()) {
        const material = findCompositeMaterial(scene);
        if (material) patchCompositeMaterial(material);
      }
      return originalRender.call(this, scene, camera);
    };
    // Renderer-unwrapping diagnostics/replay systems follow __hobunji*Original
    // markers to reach the next inner render function.
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
      latestChange: 'Painterly outlines now behave as smeared dark pigment: shell ink softens into neighboring cel colors and final seam ink no longer redraws as hard pure black.',
      mode,
      sampleCount: MODE_SAMPLE_COUNT[mode],
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
