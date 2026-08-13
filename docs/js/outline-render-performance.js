(() => {
  'use strict';

  // Keeps Hobunji Hollow's existing inverted-shell look intact while making
  // the extra outline passes cheaper. The normal scene render has already
  // updated every world matrix (and shadow state) immediately before the
  // PNG-occluder, shell, and material-ID passes. Three r128 otherwise repeats
  // that scene-wide bookkeeping on every renderer.render() call, which is
  // particularly expensive in foliage-heavy wilderness scenes.
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
  const BASE_REUSE_MAX_AGE_MS = 1000;
  const LOG_INTERVAL_MS = 5000;

  const lastBaseRenderAt = new WeakMap();
  const lifetime = Object.create(null);
  let windowStats = Object.create(null);
  let lastLogAt = performance.now();
  let reusedSceneMatrixPasses = 0;
  let skippedShadowAutoUpdates = 0;
  let windowReusedSceneMatrixPasses = 0;
  let windowSkippedShadowAutoUpdates = 0;

  function makeBucket() {
    return { renders: 0, calls: 0, triangles: 0, points: 0, lines: 0, cpuMs: 0 };
  }

  function bucket(store, name) {
    return store[name] || (store[name] = makeBucket());
  }

  function classifyPass(renderer, scene, camera) {
    const mask = Number(camera?.layers?.mask ?? 0) >>> 0;
    const override = scene?.overrideMaterial || null;

    if (mask === MASK_SHELL && override?.isShaderMaterial && override.side === THREE.BackSide && override.uniforms?.uThickness) {
      return 'shell';
    }
    if (mask === MASK_MATERIAL_ID && override?.isShaderMaterial && override.uniforms?.uIdColor) {
      return 'materialId';
    }
    if (mask === MASK_PNG_OCCLUDER && !override) return 'pngDepth';

    // The outlined main scene renders into _mainRT; the fullscreen composite
    // renders to the default framebuffer. These labels are diagnostics only.
    if (mask === MASK_ALL && !override) return renderer.getRenderTarget?.() ? 'base' : 'postOrDirect';
    return 'other';
  }

  function isSecondaryOutlinePass(pass) {
    return pass === 'shell' || pass === 'materialId' || pass === 'pngDepth';
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

    // No shell render means outlines were off (or this renderer was not the
    // gameplay renderer), so don't fill the mobile debug log with noise.
    if (windowStats.shell?.renders) {
      const order = ['base', 'pngDepth', 'shell', 'materialId', 'postOrDirect'];
      const parts = order.map(passSummary).filter(Boolean);
      parts.push(`matrix-reuse ${windowReusedSceneMatrixPasses}x`);
      if (windowSkippedShadowAutoUpdates) parts.push(`shadow-reuse ${windowSkippedShadowAutoUpdates}x`);
      const message = `[outline-perf] ${parts.join(' | ')}`;
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }

    windowStats = Object.create(null);
    windowReusedSceneMatrixPasses = 0;
    windowSkippedShadowAutoUpdates = 0;
  }

  function wrappedRender(scene, camera) {
    const renderer = this;
    const pass = classifyPass(renderer, scene, camera);
    const now = performance.now();
    const lastBaseAt = lastBaseRenderAt.get(scene);
    const canReuseBaseState = isSecondaryOutlinePass(pass)
      && Number.isFinite(lastBaseAt)
      && now - lastBaseAt >= 0
      && now - lastBaseAt <= BASE_REUSE_MAX_AGE_MS;

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
    } finally {
      if (canReuseBaseState && hadSceneAutoUpdate) scene.autoUpdate = true;
      if (canReuseBaseState && shadowMap?.enabled && hadShadowAutoUpdate) shadowMap.autoUpdate = true;
    }
    const endedAt = performance.now();

    if (pass === 'base') lastBaseRenderAt.set(scene, endedAt);
    record(pass, renderer, endedAt - startedAt);
    maybeLog(endedAt);
    return result;
  }

  const api = {
    installed: true,
    snapshot() {
      return {
        lifetime: JSON.parse(JSON.stringify(lifetime)),
        currentWindow: JSON.parse(JSON.stringify(windowStats)),
        reusedSceneMatrixPasses,
        skippedShadowAutoUpdates,
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
