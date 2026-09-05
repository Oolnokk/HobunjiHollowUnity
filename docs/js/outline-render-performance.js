(() => {
  'use strict';

  // Keeps the existing inverted-shell look while avoiding repeated scene-wide
  // matrix/shadow bookkeeping on the immediately-adjacent outline passes.
  // Reuse is sequence-bound: a secondary pass may reuse only the same scene's
  // most recent base render on the same renderer, with no unrelated render in
  // between. This is intentionally stricter than the old one-second time window.
  //
  // Runtime outline policy: shell outlines are the only general-purpose outline
  // style. The older screen-space depth-edge and material-ID seam passes are
  // forcibly suppressed here so town wall bricks and other solid geometry cannot
  // acquire a second/internal border even if stale UI/runtime state enables them.
  const THREE = window.THREE;
  const rendererProto = THREE?.WebGLRenderer?.prototype;
  if (!rendererProto || typeof rendererProto.render !== 'function') return;

  const existing = window.OutlineRenderPerformance;
  if (existing?.installed) return;

  const originalRender = rendererProto.render;
  if (originalRender.__hobunjiOutlineRenderPerfWrapped) {
    window.OutlineRenderPerformance = originalRender.__hobunjiOutlineRenderPerfApi || existing || { installed: true };
    return;
  }

  const MASK_ALL = 0xFFFFFFFF;
  const MASK_SHELL = (1 << 1) >>> 0;
  const MASK_MATERIAL_ID = (1 << 3) >>> 0;
  const MASK_PNG_OCCLUDER = (1 << 4) >>> 0;
  const WORLD_POPUP_RENDER_ORDER_MIN = 1200; // Used to identify WorldPopupText's always-on-top billboard planes for the post-shell replay.
  const BASE_REUSE_MAX_AGE_MS = 250; // Safety guard only; sequence adjacency is the primary gate.
  const LOG_INTERVAL_MS = 5000;

  const reuseSequenceByRenderer = new WeakMap();
  const lifetime = Object.create(null);
  let windowStats = Object.create(null);
  let lastLogAt = performance.now();
  let reusedSceneMatrixPasses = 0;
  let skippedShadowAutoUpdates = 0;
  let windowReusedSceneMatrixPasses = 0;
  let windowSkippedShadowAutoUpdates = 0;
  let sequenceInvalidations = 0;
  let suppressedMaterialIdPasses = 0; // Debug counter: material-seam source draws blocked by wrappedRender().
  let suppressedCompositeActivations = 0; // Debug counter: post composites whose non-shell uniforms were zeroed.
  let replayedPopupOverlayPasses = 0; // Debug counter: shell passes followed by a WorldPopupText-only color replay.

  function makeBucket() {
    return { renders: 0, calls: 0, triangles: 0, points: 0, lines: 0, cpuMs: 0 };
  }

  function bucket(store, name) {
    return store[name] || (store[name] = makeBucket());
  }

  function classifyPass(renderer, scene, camera) {
    const mask = Number(camera?.layers?.mask ?? 0) >>> 0;
    const override = scene?.overrideMaterial || null;

    if (
      mask === MASK_SHELL
      && override?.isShaderMaterial
      && override.side === THREE.BackSide
      && override.uniforms?.uThickness
    ) return 'shell';

    if (
      mask === MASK_MATERIAL_ID
      && override?.isShaderMaterial
      && override.uniforms?.uIdColor
    ) return 'materialId';

    if (mask === MASK_PNG_OCCLUDER && !override) return 'pngDepth';

    if (mask === MASK_ALL && !override) {
      return renderer.getRenderTarget?.() ? 'base' : 'postOrDirect';
    }
    return 'other';
  }

  function isSecondaryOutlinePass(pass) {
    return pass === 'shell' || pass === 'materialId' || pass === 'pngDepth';
  }

  // WorldPopupText adds its planes directly to the active scene with a CanvasTexture,
  // depth testing/writes disabled, billboard tagging, and renderOrder 1200/1201.
  // renderOrder only sorts objects INSIDE one renderer.render() call; the shell is a
  // later render call, so without this replay the shell can still paint over text.
  function isWorldPopupOverlayMesh(object) {
    const materials = Array.isArray(object?.material) ? object.material : [object?.material];
    return !!(
      object?.isMesh
      && object.userData?.isBillboard
      && Number(object.renderOrder) >= WORLD_POPUP_RENDER_ORDER_MIN
      && materials.some(material => material?.map?.isCanvasTexture && material.depthTest === false && material.depthWrite === false)
    );
  }

  // Repaint only direct WorldPopupText planes into the SAME target immediately
  // after the shell pass. Popups are direct scene children by design. Temporarily
  // removing the scene background is essential: THREE's Color background forces a
  // clear even when renderer.autoClear=false, which would otherwise erase the frame.
  function replayWorldPopupOverlay(renderer, scene, camera) {
    const popups = Array.isArray(scene?.children) ? scene.children.filter(isWorldPopupOverlayMesh) : [];
    if (!popups.length) return false;

    const popupSet = new Set(popups); // Used to keep only popup planes visible during the replay.
    const hidden = []; // Used to restore top-level gameplay objects after the popup-only replay.
    for (const child of scene.children) {
      if (!popupSet.has(child) && child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    }

    const previousMask = camera.layers.mask; // Restored so caller-owned outline layer selection remains unchanged.
    const previousOverride = scene.overrideMaterial; // Restored to the shell material until game.js clears it after this wrapper returns.
    const previousBackground = scene.background; // Restored after suppressing the background's forced clear for the overlay draw.
    const previousAutoClear = renderer.autoClear; // Restored after forcing additive/no-clear replay behavior.
    const shadowMap = renderer.shadowMap;
    const previousShadowAutoUpdate = !!shadowMap?.autoUpdate; // Restored so normal shadow scheduling is unaffected.

    try {
      scene.overrideMaterial = null;
      scene.background = null;
      camera.layers.enableAll();
      renderer.autoClear = false;
      if (shadowMap?.enabled) shadowMap.autoUpdate = false;
      originalRender.call(renderer, scene, camera);
      replayedPopupOverlayPasses++;
      return true;
    } finally {
      if (shadowMap?.enabled) shadowMap.autoUpdate = previousShadowAutoUpdate;
      renderer.autoClear = previousAutoClear;
      camera.layers.mask = previousMask;
      scene.background = previousBackground;
      scene.overrideMaterial = previousOverride;
      hidden.forEach(child => { child.visible = true; });
    }
  }

  // Called immediately before a canvas/direct render. The real outline composite
  // is a tiny scene whose top-level quad owns all of these uniforms; requiring
  // the sampler/texel signature avoids touching ordinary gameplay ShaderMaterials.
  function suppressNonShellComposite(scene) {
    const children = Array.isArray(scene?.children) ? scene.children : [];
    let changed = false;
    for (const child of children) {
      const materials = Array.isArray(child?.material) ? child.material : [child?.material];
      for (const material of materials) {
        const uniforms = material?.uniforms;
        const isOutlineComposite = !!(
          uniforms?.tColor
          && uniforms?.tEdgeId
          && uniforms?.uTexel
          && uniforms?.uDepthOutlinesOn
          && uniforms?.uSeamOutlinesOn
        );
        if (!isOutlineComposite) continue;
        if (Number(uniforms.uDepthOutlinesOn.value) !== 0 || Number(uniforms.uSeamOutlinesOn.value) !== 0) changed = true;
        uniforms.uDepthOutlinesOn.value = 0;
        uniforms.uSeamOutlinesOn.value = 0;
      }
    }
    return changed;
  }

  // game.js owns the private s_depthOutlines variable, so use its existing
  // Settings change handler once the page is fully parsed to hard-reset it,
  // then remove the obsolete controls from normal play. The renderer guard above
  // remains authoritative even if another script later flips the private flag.
  function disableDepthOutlineControls() {
    const toggle = document.getElementById('settingDepthOutlines'); // Used here to drive game.js's existing change listener to false.
    if (toggle) {
      toggle.checked = false;
      toggle.disabled = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      const row = toggle.closest?.('.settings-row'); // Used here to hide the now-disabled depth-outline setting row.
      if (row) row.hidden = true;
    }

    const sensitivity = document.getElementById('settingDepthOutlineSensitivity'); // Used here to hide the depth-only sensitivity control with its toggle.
    if (sensitivity) {
      sensitivity.disabled = true;
      const row = sensitivity.closest?.('.settings-row'); // Used here to hide the now-inapplicable sensitivity row.
      if (row) row.hidden = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', disableDepthOutlineControls, { once: true });
  } else {
    disableDepthOutlineControls();
  }

  function record(pass, renderer, cpuMs) {
    const info = renderer.info?.render || {};
    for (const store of [windowStats, lifetime]) {
      const b = bucket(store, pass);
      b.renders++;
      b.calls += Number(info.calls) || 0;
      b.triangles += Number(info.triangles) || 0;
      b.points += Number(info.points) || 0;
      b.lines += Number(info.lines) || 0;
      b.cpuMs += cpuMs;
    }
  }

  function compactNumber(value) {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
    return String(Math.round(value));
  }

  function passSummary(name) {
    const b = windowStats[name];
    if (!b?.renders) return null;
    const n = b.renders;
    return `${name} ${n}x avg ${Math.round(b.calls / n)}c/${compactNumber(b.triangles / n)}tri/${(b.cpuMs / n).toFixed(2)}ms`;
  }

  function maybeLog(now) {
    if (now - lastLogAt < LOG_INTERVAL_MS) return;
    lastLogAt = now;

    if (windowStats.shell?.renders) {
      const order = ['base', 'pngDepth', 'shell', 'materialId', 'postOrDirect'];
      const parts = order.map(passSummary).filter(Boolean);
      parts.push(`matrix-reuse ${windowReusedSceneMatrixPasses}x`);
      if (windowSkippedShadowAutoUpdates) parts.push(`shadow-reuse ${windowSkippedShadowAutoUpdates}x`);
      if (replayedPopupOverlayPasses) parts.push(`popup-over-shell ${replayedPopupOverlayPasses}x`);
      if (suppressedMaterialIdPasses) parts.push(`material-seam-blocked ${suppressedMaterialIdPasses}x`);
      if (suppressedCompositeActivations) parts.push(`non-shell-composite-blocked ${suppressedCompositeActivations}x`);
      const message = `[outline-perf] ${parts.join(' | ')}`;
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }

    windowStats = Object.create(null);
    windowReusedSceneMatrixPasses = 0;
    windowSkippedShadowAutoUpdates = 0;
  }

  function canReuseSequence(renderer, scene, pass, now) {
    if (!isSecondaryOutlinePass(pass)) return false;
    const seq = reuseSequenceByRenderer.get(renderer);
    return !!(
      seq
      && seq.scene === scene
      && now >= seq.baseAt
      && now - seq.baseAt <= BASE_REUSE_MAX_AGE_MS
    );
  }

  function updateSequence(renderer, scene, pass, endedAt, reused) {
    if (pass === 'base') {
      reuseSequenceByRenderer.set(renderer, { scene, baseAt: endedAt });
      return;
    }
    if (isSecondaryOutlinePass(pass) && reused) {
      // Keep the sequence open across PNG-depth -> shell -> material-ID.
      return;
    }
    if (reuseSequenceByRenderer.has(renderer)) {
      reuseSequenceByRenderer.delete(renderer);
      sequenceInvalidations++;
    }
  }

  function wrappedRender(scene, camera) {
    const renderer = this;
    const pass = classifyPass(renderer, scene, camera);

    // Material-ID is solely the old screen-space internal/material seam source.
    // Returning before WebGLRenderer.render() guarantees it cannot contribute a
    // town/building seam and also avoids paying for the otherwise-useless pass.
    if (pass === 'materialId') {
      suppressedMaterialIdPasses++;
      return undefined;
    }

    if (pass === 'postOrDirect' && suppressNonShellComposite(scene)) {
      suppressedCompositeActivations++;
    }

    const now = performance.now();
    const canReuseBaseState = canReuseSequence(renderer, scene, pass, now);

    const hadSceneAutoUpdate = !!scene?.autoUpdate;
    const shadowMap = renderer.shadowMap;
    const hadShadowAutoUpdate = !!shadowMap?.autoUpdate;

    if (canReuseBaseState && hadSceneAutoUpdate) {
      scene.autoUpdate = false;
      reusedSceneMatrixPasses++;
      windowReusedSceneMatrixPasses++;
    }
    if (canReuseBaseState && shadowMap?.enabled && hadShadowAutoUpdate) {
      shadowMap.autoUpdate = false;
      skippedShadowAutoUpdates++;
      windowSkippedShadowAutoUpdates++;
    }

    const startedAt = performance.now();
    let result;
    try {
      result = originalRender.call(renderer, scene, camera);
      if (pass === 'shell') replayWorldPopupOverlay(renderer, scene, camera);
    } finally {
      if (canReuseBaseState && hadSceneAutoUpdate) scene.autoUpdate = true;
      if (canReuseBaseState && shadowMap?.enabled && hadShadowAutoUpdate) shadowMap.autoUpdate = true;
    }
    const endedAt = performance.now();

    updateSequence(renderer, scene, pass, endedAt, canReuseBaseState);
    record(pass, renderer, endedAt - startedAt);
    maybeLog(endedAt);
    return result;
  }

  const api = {
    installed: true,
    nonShellOutlinesSuppressed: true,
    popupTextAboveShell: true,
    snapshot() {
      return {
        lifetime: JSON.parse(JSON.stringify(lifetime)),
        currentWindow: JSON.parse(JSON.stringify(windowStats)),
        reusedSceneMatrixPasses,
        skippedShadowAutoUpdates,
        sequenceInvalidations,
        suppressedMaterialIdPasses,
        suppressedCompositeActivations,
        replayedPopupOverlayPasses,
        nonShellOutlinesSuppressed: true,
        popupTextAboveShell: true,
        maxReuseAgeMs: BASE_REUSE_MAX_AGE_MS,
      };
    },
    classifyPass,
  };

  wrappedRender.__hobunjiOutlineRenderPerfWrapped = true;
  wrappedRender.__hobunjiOutlineRenderPerfOriginal = originalRender;
  wrappedRender.__hobunjiOutlineRenderPerfApi = api;
  rendererProto.render = wrappedRender;
  window.OutlineRenderPerformance = api;
})();