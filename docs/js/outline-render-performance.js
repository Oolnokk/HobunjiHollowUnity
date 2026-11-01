(() => {
  'use strict';

  // Keeps the existing inverted-shell look while avoiding repeated scene-wide
  // matrix/shadow bookkeeping on the immediately-adjacent outline passes.
  // Reuse is sequence-bound: a secondary pass may reuse only the same scene's
  // most recent base render on the same renderer, with no unrelated render in
  // between. This is intentionally stricter than the old one-second time window.
  // Secondary passes are the PNG-depth, shell, target and material-ID outline
  // passes, the cloud-forest mist redraw, and the final world-text overlay draw.
  // The held-object depth replays are renders of their own that run right after
  // the base render and would otherwise end the sequence before any of these;
  // held-object-render-order.js re-arms it through markSceneMatricesCurrent().
  //
  // Runtime outline policy: shell outlines are the only general-purpose outline
  // style. The older screen-space material-ID seam pass is forcibly suppressed
  // here so town wall bricks and other solid geometry cannot acquire a second/
  // internal border even if stale UI/runtime state enables it. (The screen-space
  // depth-edge pass this used to also suppress was removed outright from
  // game.js -- see its composite shader/render loop -- rather than left dead
  // and merely blocked here.)
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
  const MASK_TARGET = (1 << 2) >>> 0;
  const MASK_MATERIAL_ID = (1 << 3) >>> 0;
  const MASK_PNG_OCCLUDER = (1 << 4) >>> 0;
  const MASK_MIST = (1 << 5) >>> 0; // cloud-forest-fog.js mist cylinders: game.js redraws just this layer over the outline passes.
  const TARGET_ALPHA_FILL_LAYER = 30; // Temporary per-draw layer used only to render flat alpha-cutout target cards as filled billboard silhouettes.
  const WORLD_TEXT_OVERLAY_LAYER = 6; // Reserved here to carry depth-disabled world text outside the shell/post-process passes.
  const WORLD_TEXT_RENDER_ORDER_MIN = 1200; // WorldPopupText is 1200/1201; AmbientDialogue text/chatheads are 1210/1211.
  const BASE_REUSE_MAX_AGE_MS = 250; // Safety guard only; sequence adjacency is the primary gate.
  const LOG_INTERVAL_MS = 5000;

  const reuseSequenceByRenderer = new WeakMap();
  // Counts renders that will really recompute a scene's matrices (scene.autoUpdate on and not
  // reusing). The final world-text overlay draw compares it with the value at its base render: equal
  // means nothing re-walked the scene since, whatever unrelated scenes were rendered in between.
  const sceneMatrixEpochs = new WeakMap();
  const matrixEpochOf = scene => sceneMatrixEpochs.get(scene) || 0;
  const pendingWorldTextOverlayByRenderer = new WeakMap(); // Carries active-scene text from the offscreen base pass to the final composite draw.
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
  let finalWorldTextOverlayPasses = 0; // Debug counter: final canvas draws containing only popup/dialogue text planes.
  let withheldWorldTextBasePasses = 0; // Debug counter: offscreen base draws where text was intentionally reserved for the final overlay.
  let abandonedWorldTextOverlays = 0; // Debug counter: stale pending overlays restored by the next base pass instead of reaching presentation.
  let targetAlphaCutoutPasses = 0; // Target-outline passes where alpha-cutout parity preparation ran.
  let targetAlphaCutoutMeshesPrepared = 0; // Alpha-tested meshes given the per-draw target-mask hook.
  let targetAlphaShaderPatches = 0; // Target ShaderMaterials upgraded to sample source alpha before painting red/green.
  let targetAlphaFillPasses = 0; // Billboard-style fill draws used for flat alpha-cutout targets such as foliage leaf cards.
  let targetAlphaFillMeshesDrawn = 0; // Flat target cards included in those fill draws; exposed in mobile render diagnostics.

  function makeBucket() {
    return { renders: 0, calls: 0, triangles: 0, points: 0, lines: 0, cpuMs: 0 };
  }

  function bucket(store, name) {
    return store[name] || (store[name] = makeBucket());
  }

  function isOutlineCompositeMaterial(material) {
    const uniforms = material?.uniforms;
    return !!(
      uniforms?.tColor
      && uniforms?.tEdgeId
      && uniforms?.uTexel
      && uniforms?.uSeamOutlinesOn
    );
  }

  // game.js renders its final outline composite with a separate fixed _postCamera,
  // whose layer mask is unrelated to the gameplay camera. Identify that pass by
  // the composite material itself rather than requiring the post camera to have
  // every gameplay layer enabled.
  function findOutlineCompositeMaterial(scene) {
    const children = Array.isArray(scene?.children) ? scene.children : [];
    for (const child of children) {
      const materials = Array.isArray(child?.material) ? child.material : [child?.material];
      for (const material of materials) {
        if (isOutlineCompositeMaterial(material)) return material;
      }
    }
    return null;
  }

  function classifyPass(renderer, scene, camera) {
    const mask = Number(camera?.layers?.mask ?? 0) >>> 0;
    const override = scene?.overrideMaterial || null;
    const target = renderer.getRenderTarget?.() || null;

    if (
      mask === MASK_SHELL
      && override?.isShaderMaterial
      && override.side === THREE.BackSide
      && override.uniforms?.uThickness
    ) return 'shell';

    if (
      mask === MASK_TARGET
      && override?.isShaderMaterial
      && override.side === THREE.BackSide
      && override.uniforms?.uThickness
      && override.uniforms?.uColor
    ) return 'target';

    if (
      mask === MASK_MATERIAL_ID
      && override?.isShaderMaterial
      && override.uniforms?.uIdColor
    ) return 'materialId';

    if (mask === MASK_PNG_OCCLUDER && !override) return 'pngDepth';
    if (mask === MASK_MIST && !override) return 'mist';

    // The final outline composite is a fullscreen post scene. Its camera normally
    // uses only the default layer, so camera.layers === MASK_ALL is not a valid
    // requirement for recognizing the presentation pass.
    if (!target && !override && findOutlineCompositeMaterial(scene)) return 'postOrDirect';

    if (mask === MASK_ALL && !override) {
      return target ? 'base' : 'postOrDirect';
    }
    return 'other';
  }

  function isSecondaryOutlinePass(pass) {
    return pass === 'shell' || pass === 'target' || pass === 'materialId' || pass === 'pngDepth' || pass === 'mist';
  }

  function materialForGroup(mesh, group) {
    const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material];
    const materialIndex = Number.isInteger(group?.materialIndex) ? group.materialIndex : 0;
    return materials[materialIndex] || materials[0] || null;
  }

  function isAlphaCutoutMaterial(material) {
    return !!(
      material?.map?.isTexture
      && Number.isFinite(Number(material.alphaTest))
      && Number(material.alphaTest) > 0
    );
  }

  const targetAlphaFillMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xff2a1f) },
      uAlpha: { value: 0.42 },
      uTargetAlphaMap: { value: null },
      uTargetAlphaCutoff: { value: 0.5 },
      uTargetUsesAlphaMap: { value: 0 },
      uTargetUvTransform: { value: new THREE.Matrix3() },
    },
    vertexShader: `
      uniform mat3 uTargetUvTransform;
      varying vec2 vTargetUv;
      void main() {
        vTargetUv = (uTargetUvTransform * vec3(uv, 1.0)).xy;
        #ifdef USE_INSTANCING
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #endif
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform sampler2D uTargetAlphaMap;
      uniform float uTargetAlphaCutoff;
      uniform float uTargetUsesAlphaMap;
      varying vec2 vTargetUv;
      void main() {
        if (uTargetUsesAlphaMap < 0.5) discard;
        float sourceAlpha = texture2D(uTargetAlphaMap, vTargetUv).a;
        if (sourceAlpha < uTargetAlphaCutoff) discard;
        gl_FragColor = vec4(uColor, uAlpha * sourceAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  targetAlphaFillMaterial.userData.hobunjiTargetAlphaAware = true;
  targetAlphaFillMaterial.userData.hobunjiTargetAlphaFill = true;

  function ensureTargetAlphaAwareShader(material) {
    if (!material?.isShaderMaterial || !material.uniforms?.uColor || !material.uniforms?.uThickness) return false;
    material.userData ||= {};
    if (material.userData.hobunjiTargetAlphaAware === true) return true;

    const thicknessMarker = 'uniform float uThickness;';
    const mainMarker = 'void main() {';
    if (!String(material.vertexShader || '').includes(thicknessMarker) || !String(material.vertexShader || '').includes(mainMarker)) return false;

    material.uniforms.uTargetAlphaMap = { value: null };
    material.uniforms.uTargetAlphaCutoff = { value: 0.5 };
    material.uniforms.uTargetUsesAlphaMap = { value: 0 };
    material.uniforms.uTargetUvTransform = { value: new THREE.Matrix3() };

    material.vertexShader = String(material.vertexShader)
      .replace(
        thicknessMarker,
        `${thicknessMarker}\n        uniform mat3 uTargetUvTransform;\n        varying vec2 vTargetUv;`
      )
      .replace(
        mainMarker,
        `${mainMarker}\n          vTargetUv = (uTargetUvTransform * vec3(uv, 1.0)).xy;`
      );
    material.fragmentShader = `
        uniform vec3 uColor;
        uniform sampler2D uTargetAlphaMap;
        uniform float uTargetAlphaCutoff;
        uniform float uTargetUsesAlphaMap;
        varying vec2 vTargetUv;
        void main() {
          if (uTargetUsesAlphaMap > 0.5) {
            float sourceAlpha = texture2D(uTargetAlphaMap, vTargetUv).a;
            if (sourceAlpha < uTargetAlphaCutoff) discard;
          }
          gl_FragColor = vec4(uColor, 1.0);
        }
      `;
    material.userData.hobunjiTargetAlphaAware = true;
    material.needsUpdate = true;
    targetAlphaShaderPatches++;
    return true;
  }

  function installTargetAlphaCutoutHook(mesh) {
    if (!mesh?.isMesh) return false;
    mesh.userData ||= {};
    if (mesh.userData.hobunjiTargetAlphaCutoutHook === true) return false;

    const previousBeforeRender = mesh.onBeforeRender;
    const previousAfterRender = mesh.onAfterRender;

    mesh.onBeforeRender = function targetAlphaCutoutBeforeRender(...args) {
      previousBeforeRender?.apply(this, args);
      const scene = args[1];
      const overrideMaterial = args[4];
      const group = args[5];
      if (!scene?.overrideMaterial || overrideMaterial?.userData?.hobunjiTargetAlphaAware !== true) return;

      const sourceMaterial = materialForGroup(this, group);
      const alphaMap = sourceMaterial?.map;
      const alphaCutoff = Number(sourceMaterial?.alphaTest);
      const useAlphaMap = !!(alphaMap?.isTexture && Number.isFinite(alphaCutoff) && alphaCutoff > 0);
      const uniforms = overrideMaterial.uniforms;
      uniforms.uTargetUsesAlphaMap.value = useAlphaMap ? 1 : 0;
      if (!useAlphaMap) return;

      if (alphaMap.matrixAutoUpdate !== false) alphaMap.updateMatrix?.();
      uniforms.uTargetAlphaMap.value = alphaMap;
      uniforms.uTargetAlphaCutoff.value = alphaCutoff;
      if (alphaMap.matrix?.isMatrix3) uniforms.uTargetUvTransform.value.copy(alphaMap.matrix);
      else uniforms.uTargetUvTransform.value.identity();
    };

    mesh.onAfterRender = function targetAlphaCutoutAfterRender(...args) {
      try {
        previousAfterRender?.apply(this, args);
      } finally {
        const overrideMaterial = args[4];
        if (overrideMaterial?.userData?.hobunjiTargetAlphaAware === true) {
          overrideMaterial.uniforms.uTargetUsesAlphaMap.value = 0;
        }
      }
    };

    mesh.userData.hobunjiTargetAlphaCutoutHook = true;
    return true;
  }

  function prepareTargetAlphaCutouts(scene, camera) {
    const targetMaterial = scene?.overrideMaterial;
    if (!ensureTargetAlphaAwareShader(targetMaterial)) return [];

    let prepared = 0;
    const fillEntries = [];
    scene?.traverse?.(object => {
      if (!object?.isMesh || !object.layers?.test?.(camera.layers)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (!materials.some(isAlphaCutoutMaterial)) return;
      if (installTargetAlphaCutoutHook(object)) prepared++;
      // FoliageGenerator marks its flat leaf cards noOutline because the
      // inverted shell is not meaningful on non-volumetric planes. Those are
      // precisely the target meshes that need the weed-billboard-style fill.
      if (object.userData?.noOutline === true) {
        fillEntries.push({ object, originalLayerMask: object.layers.mask });
      }
    });
    targetAlphaCutoutPasses++;
    targetAlphaCutoutMeshesPrepared += prepared;
    return fillEntries;
  }

  function suppressTargetAlphaFillFromShell(entries) {
    for (const entry of entries || []) entry.object?.layers?.disable?.(2);
  }

  function restoreTargetAlphaFillLayers(entries) {
    for (const entry of entries || []) {
      if (entry.object?.layers) entry.object.layers.mask = entry.originalLayerMask;
    }
  }

  function configuredTargetAlphaFillOpacity() {
    try {
      const configured = Number(window.Combat?.deps?.combatConfig?.()?.cuttableTargetGlow?.alpha);
      if (Number.isFinite(configured)) return Math.max(0, Math.min(1, configured));
    } catch (_) {}
    return 0.42;
  }

  function drawTargetAlphaFill(renderer, scene, camera, entries, targetMaterial) {
    if (!entries?.length) return false;
    const previousCameraMask = camera.layers.mask; // Restored after selecting only the temporary fill layer.
    const previousOverride = scene.overrideMaterial; // Restored to the regular red/green target shell material.
    const previousBackground = scene.background; // Suppressed so an auxiliary fill draw cannot clear or repaint the scene background.
    const previousAutoClear = renderer.autoClear; // Fill overlays must accumulate over the already-rendered target pass.
    const shadowMap = renderer.shadowMap;
    const previousShadowAutoUpdate = !!shadowMap?.autoUpdate;
    const color = targetMaterial?.uniforms?.uColor?.value;

    try {
      if (color?.isColor) targetAlphaFillMaterial.uniforms.uColor.value.copy(color);
      else if (color != null) targetAlphaFillMaterial.uniforms.uColor.value.set(color);
      targetAlphaFillMaterial.uniforms.uAlpha.value = configuredTargetAlphaFillOpacity();
      targetAlphaFillMaterial.uniforms.uTargetUsesAlphaMap.value = 0;

      for (const entry of entries) entry.object.layers.set(TARGET_ALPHA_FILL_LAYER);
      scene.overrideMaterial = targetAlphaFillMaterial;
      scene.background = null;
      camera.layers.set(TARGET_ALPHA_FILL_LAYER);
      renderer.autoClear = false;
      if (shadowMap?.enabled) shadowMap.autoUpdate = false;
      originalRender.call(renderer, scene, camera);
      targetAlphaFillPasses++;
      targetAlphaFillMeshesDrawn += entries.length;
      return true;
    } finally {
      targetAlphaFillMaterial.uniforms.uTargetUsesAlphaMap.value = 0;
      if (shadowMap?.enabled) shadowMap.autoUpdate = previousShadowAutoUpdate;
      renderer.autoClear = previousAutoClear;
      camera.layers.mask = previousCameraMask;
      scene.background = previousBackground;
      scene.overrideMaterial = previousOverride;
      restoreTargetAlphaFillLayers(entries);
    }
  }

  // Both WorldPopupText and AmbientDialogue use CanvasTexture planes with depth
  // testing/writes disabled and renderOrder >= 1200. renderOrder only sorts inside
  // ONE renderer.render() call; the shell is a later call, so these planes must be
  // excluded from the offscreen outlined frame and drawn once after the final
  // composite. This predicate deliberately uses render/material behavior instead
  // of a module-specific name so nested ambient chatheads are covered too.
  // Runs against every object in the scene on every outlined frame, so the
  // cheap mesh/renderOrder rejection comes first and no per-object material
  // array is allocated for the (overwhelmingly common) non-overlay case.
  function isWorldTextOverlayMaterial(material) {
    return !!(material?.map?.isCanvasTexture && material.depthTest === false && material.depthWrite === false);
  }

  function isWorldTextOverlayMesh(object) {
    if (!object?.isMesh || !(Number(object.renderOrder) >= WORLD_TEXT_RENDER_ORDER_MIN)) return false;
    const material = object.material;
    return Array.isArray(material) ? material.some(isWorldTextOverlayMaterial) : isWorldTextOverlayMaterial(material);
  }

  // This used to traverse the whole scene on EVERY base pass (thousands of nodes in a
  // wilderness zone) to find the handful of popup/dialogue planes. The set of candidate meshes
  // only changes when the scene graph changes, so it is cached per scene and re-derived when an
  // add()/remove()/clear() happened anywhere since the last scan, plus a periodic safety rescan
  // for a mesh whose renderOrder/material changed after it was attached. Each frame still
  // re-checks the predicate and re-reads layer mask/visibility of the cached candidates.
  const WORLD_TEXT_RESCAN_MS = 1000;
  const worldTextCandidates = new WeakMap(); // scene -> { epoch, at, meshes }
  let structureEpoch = 0;

  function installStructureEpoch() {
    for (const proto of [THREE.Object3D?.prototype, THREE.Scene?.prototype]) {
      if (!proto) continue;
      for (const method of ['add', 'remove', 'clear']) {
        const previous = proto[method];
        if (typeof previous !== 'function' || previous.__hobunjiStructureEpochWrapped) continue;
        const wrapped = function structureEpochWrapped(...args) { structureEpoch++; return previous.apply(this, args); };
        Object.assign(wrapped, previous); // Other modules recognise their own wrapper on proto.add by marker properties; keep those visible.
        wrapped.__hobunjiStructureEpochWrapped = true;
        proto[method] = wrapped;
      }
    }
  }
  installStructureEpoch();

  function collectWorldTextOverlayEntries(scene) {
    if (!scene?.traverse) return [];
    const now = performance.now();
    let cached = worldTextCandidates.get(scene);
    if (!cached || cached.epoch !== structureEpoch || now - cached.at > WORLD_TEXT_RESCAN_MS) {
      const meshes = [];
      scene.traverse(object => { if (isWorldTextOverlayMesh(object)) meshes.push(object); });
      cached = { epoch: structureEpoch, at: now, meshes };
      worldTextCandidates.set(scene, cached);
    }
    const entries = [];
    for (const object of cached.meshes) {
      if (!isWorldTextOverlayMesh(object)) continue;
      entries.push({ object, originalLayerMask: object.layers.mask, originalVisible: object.visible !== false });
    }
    return entries;
  }

  function reserveWorldTextOverlayLayer(entries) {
    for (const entry of entries || []) entry.object.layers.set(WORLD_TEXT_OVERLAY_LAYER);
  }

  function hideWorldTextDuringBase(entries) {
    for (const entry of entries || []) entry.object.visible = false;
  }

  function restoreWorldTextBaseVisibility(entries) {
    for (const entry of entries || []) entry.object.visible = entry.originalVisible;
  }

  function restoreWorldTextOverlayLayers(pending) {
    for (const entry of pending?.entries || []) {
      if (entry.object?.layers) entry.object.layers.mask = entry.originalLayerMask;
    }
  }

  function invalidatePendingWorldTextOverlay(renderer) {
    const pending = pendingWorldTextOverlayByRenderer.get(renderer);
    if (pending) {
      restoreWorldTextBaseVisibility(pending.entries);
      restoreWorldTextOverlayLayers(pending);
      abandonedWorldTextOverlays++;
    }
    pendingWorldTextOverlayByRenderer.delete(renderer);
  }

  // Render only reserved layer 6 onto the already-composited canvas. Parent Groups
  // may remain on layer 0; three.js still traverses their children and applies the
  // camera layer test to each renderable child. Removing the scene background is
  // essential because a THREE.Color background can force a clear even with
  // renderer.autoClear=false, which would erase the frame under the text.
  function drawWorldTextOverlayToCanvas(renderer, pending) {
    if (!pending?.entries?.length) return false;
    const { scene, camera } = pending;
    const previousMask = camera.layers.mask; // Restored so gameplay camera layer selection remains unchanged.
    const previousOverride = scene.overrideMaterial; // Restored in case a caller temporarily owns an override material.
    const previousBackground = scene.background; // Restored after suppressing the background's forced clear.
    const previousAutoClear = renderer.autoClear; // Restored after forcing additive/no-clear overlay behavior.
    const previousTarget = renderer.getRenderTarget?.() || null; // Restored so an unexpected caller target is never leaked.
    const shadowMap = renderer.shadowMap;
    const previousShadowAutoUpdate = !!shadowMap?.autoUpdate; // Restored so normal shadow scheduling is unaffected.
    const previousSceneAutoUpdate = !!scene.autoUpdate;
    const drawAt = performance.now();
    const reuseSceneMatrices = previousSceneAutoUpdate && pending.matrixEpoch === matrixEpochOf(scene)
      && drawAt >= pending.baseAt && drawAt - pending.baseAt <= BASE_REUSE_MAX_AGE_MS; // Nothing re-walked the scene since the base render that withheld this text, so its matrices are current.
    if (reuseSceneMatrices) {
      scene.autoUpdate = false;
      reusedSceneMatrixPasses++;
      windowReusedSceneMatrixPasses++;
    }

    try {
      renderer.setRenderTarget(null);
      scene.overrideMaterial = null;
      scene.background = null;
      camera.layers.set(WORLD_TEXT_OVERLAY_LAYER);
      renderer.autoClear = false;
      if (shadowMap?.enabled) shadowMap.autoUpdate = false;
      originalRender.call(renderer, scene, camera);
      finalWorldTextOverlayPasses++;
      return true;
    } finally {
      if (reuseSceneMatrices) scene.autoUpdate = true;
      if (shadowMap?.enabled) shadowMap.autoUpdate = previousShadowAutoUpdate;
      renderer.autoClear = previousAutoClear;
      camera.layers.mask = previousMask;
      scene.background = previousBackground;
      scene.overrideMaterial = previousOverride;
      renderer.setRenderTarget(previousTarget);
    }
  }

  function finalizeWorldTextOverlay(renderer, pending) {
    if (!pending) return false;
    try {
      return drawWorldTextOverlayToCanvas(renderer, pending);
    } finally {
      restoreWorldTextBaseVisibility(pending.entries);
      restoreWorldTextOverlayLayers(pending);
      pendingWorldTextOverlayByRenderer.delete(renderer);
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
        if (!isOutlineCompositeMaterial(material)) continue;
        const uniforms = material.uniforms;
        if (Number(uniforms.uSeamOutlinesOn.value) !== 0) changed = true;
        uniforms.uSeamOutlinesOn.value = 0;
      }
    }
    return changed;
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
      const order = ['base', 'pngDepth', 'shell', 'target', 'mist', 'materialId', 'postOrDirect'];
      const parts = order.map(passSummary).filter(Boolean);
      parts.push(`matrix-reuse ${windowReusedSceneMatrixPasses}x`);
      if (windowSkippedShadowAutoUpdates) parts.push(`shadow-reuse ${windowSkippedShadowAutoUpdates}x`);
      if (withheldWorldTextBasePasses) parts.push(`world-text-withheld ${withheldWorldTextBasePasses}x`);
      if (finalWorldTextOverlayPasses) parts.push(`world-text-final-overlay ${finalWorldTextOverlayPasses}x`);
      if (abandonedWorldTextOverlays) parts.push(`world-text-abandoned ${abandonedWorldTextOverlays}x`);
      if (suppressedMaterialIdPasses) parts.push(`material-seam-blocked ${suppressedMaterialIdPasses}x`);
      if (suppressedCompositeActivations) parts.push(`non-shell-composite-blocked ${suppressedCompositeActivations}x`);
      if (targetAlphaCutoutPasses) parts.push(`target-alpha ${targetAlphaCutoutPasses}x/${targetAlphaCutoutMeshesPrepared} mesh-hooks/${targetAlphaShaderPatches} shader-patches`);
      if (targetAlphaFillPasses) parts.push(`target-alpha-fill ${targetAlphaFillPasses}x/${targetAlphaFillMeshesDrawn} meshes`);
      const message = `[outline-perf] ${parts.join(' | ')}`;
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }

    windowStats = Object.create(null);
    windowReusedSceneMatrixPasses = 0;
    windowSkippedShadowAutoUpdates = 0;
  }

  // True while `scene`'s matrices were brought up to date by the most recent base
  // render on this renderer (or re-armed after the held-object replays) and no
  // unrelated render has happened since.
  function sequenceIsFresh(renderer, scene, now) {
    const seq = reuseSequenceByRenderer.get(renderer);
    return !!(
      seq
      && seq.scene === scene
      && now >= seq.baseAt
      && now - seq.baseAt <= BASE_REUSE_MAX_AGE_MS
    );
  }

  function canReuseSequence(renderer, scene, pass, now) {
    return isSecondaryOutlinePass(pass) && sequenceIsFresh(renderer, scene, now);
  }

  function updateSequence(renderer, scene, pass, endedAt, reused) {
    if (pass === 'base') {
      reuseSequenceByRenderer.set(renderer, { scene, baseAt: endedAt });
      return;
    }
    if (isSecondaryOutlinePass(pass) && reused) {
      // Keep the sequence open across PNG-depth -> shell -> target -> material-ID.
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

    let targetAlphaFillEntries = [];
    let targetMaterial = null;
    if (pass === 'target') {
      // Solid branches/trunks keep the existing inverted target shell. Flat
      // alpha-cutout cards are removed from that shell draw and repainted below
      // as a double-sided additive alpha-tested overlay, matching the farm weed
      // billboard highlight rather than trying to make a volumetric hull out of
      // a plane.
      targetMaterial = scene?.overrideMaterial || null;
      targetAlphaFillEntries = prepareTargetAlphaCutouts(scene, camera);
      suppressTargetAlphaFillFromShell(targetAlphaFillEntries);
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
    } else if (hadSceneAutoUpdate && scene) {
      sceneMatrixEpochs.set(scene, matrixEpochOf(scene) + 1); // three.js is about to re-walk this scene's matrices.
    }
    if (canReuseBaseState && shadowMap?.enabled && hadShadowAutoUpdate) {
      shadowMap.autoUpdate = false;
      skippedShadowAutoUpdates++;
      windowSkippedShadowAutoUpdates++;
    }

    const startedAt = performance.now();
    let result;
    try {
      if (pass === 'base') {
        // A still-pending overlay means the prior frame never reached the known
        // presentation pass. Restore those layers before collecting this frame so
        // a bad/alternate render sequence cannot strand popup meshes indefinitely.
        invalidatePendingWorldTextOverlay(renderer);
        const entries = collectWorldTextOverlayEntries(scene);
        if (entries.length) {
          reserveWorldTextOverlayLayer(entries);
          hideWorldTextDuringBase(entries);
          try {
            // Keep the gameplay camera mask unchanged here. Render wrappers loaded
            // beneath this one (notably CloudForestMistSoftDepth) use MASK_ALL to
            // identify the real base pass and must still see the authoritative mask.
            result = originalRender.call(renderer, scene, camera);
          } finally {
            restoreWorldTextBaseVisibility(entries);
          }
          pendingWorldTextOverlayByRenderer.set(renderer, { scene, camera, entries, matrixEpoch: matrixEpochOf(scene), baseAt: performance.now() });
          withheldWorldTextBasePasses++;
        } else {
          result = originalRender.call(renderer, scene, camera);
        }
      } else {
        result = originalRender.call(renderer, scene, camera);
      }

      if (pass === 'target' && targetAlphaFillEntries.length) {
        // Restore the target bit before the temporary layer-30 fill draw so the
        // mesh returns to exactly the caller-owned layer state when this pass ends.
        restoreTargetAlphaFillLayers(targetAlphaFillEntries);
        drawTargetAlphaFill(renderer, scene, camera, targetAlphaFillEntries, targetMaterial);
      }

      const pending = pendingWorldTextOverlayByRenderer.get(renderer);
      if (pass === 'postOrDirect' && pending && !renderer.getRenderTarget?.()) {
        const isOutlineComposite = !!findOutlineCompositeMaterial(scene);
        const isDirectGameplayPresentation = pending.scene === scene && pending.camera === camera;
        if (isOutlineComposite || isDirectGameplayPresentation) {
          // Text was withheld from the offscreen base regardless of whether a shell
          // happened to run, so always draw it once on the recognized presentation
          // pass. This keeps outlines-off and partial-outline paths visible too.
          finalizeWorldTextOverlay(renderer, pending);
        }
      }
      // Do not invalidate a pending overlay merely because an unrelated renderer
      // call occurred between base and presentation. Several runtime systems wrap
      // renderer.render(), and auxiliary passes must not be able to delete popup
      // text before the real _postScene/_postCamera composite arrives.
    } finally {
      restoreTargetAlphaFillLayers(targetAlphaFillEntries);
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
    worldTextAboveShell: true,
    targetAlphaCutoutParity: true,
    targetAlphaBillboardFill: true,
    worldTextOverlayLayer: WORLD_TEXT_OVERLAY_LAYER,
    snapshot() {
      return {
        lifetime: JSON.parse(JSON.stringify(lifetime)),
        currentWindow: JSON.parse(JSON.stringify(windowStats)),
        reusedSceneMatrixPasses,
        skippedShadowAutoUpdates,
        sequenceInvalidations,
        suppressedMaterialIdPasses,
        suppressedCompositeActivations,
        withheldWorldTextBasePasses,
        finalWorldTextOverlayPasses,
        abandonedWorldTextOverlays,
        targetAlphaCutoutPasses,
        targetAlphaCutoutMeshesPrepared,
        targetAlphaShaderPatches,
        targetAlphaFillPasses,
        targetAlphaFillMeshesDrawn,
        nonShellOutlinesSuppressed: true,
        worldTextAboveShell: true,
        targetAlphaCutoutParity: true,
        targetAlphaBillboardFill: true,
        targetAlphaFillLayer: TARGET_ALPHA_FILL_LAYER,
        worldTextOverlayLayer: WORLD_TEXT_OVERLAY_LAYER,
        maxReuseAgeMs: BASE_REUSE_MAX_AGE_MS,
        worldTextRescanMs: WORLD_TEXT_RESCAN_MS,
      };
    },
    classifyPass,
    // For renders that run between the base pass and the outline passes without
    // moving anything (the held-object depth replays): declares that `scene`'s
    // matrices are still the ones the base render just computed, so the secondary
    // passes may keep skipping their own scene-wide updateMatrixWorld().
    markSceneMatricesCurrent(renderer, scene) {
      if (!renderer || !scene?.isScene) return false;
      reuseSequenceByRenderer.set(renderer, { scene, baseAt: performance.now() });
      return true;
    },
  };

  wrappedRender.__hobunjiOutlineRenderPerfWrapped = true;
  wrappedRender.__hobunjiOutlineRenderPerfOriginal = originalRender;
  wrappedRender.__hobunjiOutlineRenderPerfApi = api;
  rendererProto.render = wrappedRender;
  window.OutlineRenderPerformance = api;
})();