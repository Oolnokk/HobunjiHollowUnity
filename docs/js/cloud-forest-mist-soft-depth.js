(() => {
  'use strict';

  const THREE = window.THREE;
  const OriginalWebGLRenderer = THREE?.WebGLRenderer;
  if (typeof OriginalWebGLRenderer !== 'function') return;
  if (window.CloudForestMistSoftDepth?.installed) return;

  // r128's WebGLRenderer assigns `render` as an own instance property inside
  // the constructor closure (over private per-instance state, e.g. the
  // active render list/target) rather than on the shared prototype, so
  // WebGLRenderer.prototype.render is undefined and there is nothing there
  // to patch. Wrap the constructor instead: every instance gets its own
  // wrapped render that closes over that same instance's original render.
  const MASK_ALL = 0xFFFFFFFF;
  const OVERLAY_LAYER = 7; // Reserved only during the final mist overlay draw; the mist keeps its normal layer membership during ordinary/direct renders.
  const DEFAULTS = Object.freeze({
    featherPixels: 2.25, // Screen-space depth-mask feather radius used to prevent bright one-pixel mist rims around foreground silhouettes.
    coveragePower: 2.0, // Shapes the 5-tap depth coverage so partially occluded edge pixels fade more aggressively than a linear average.
    depthBias: 0.000015, // Small normalized-depth tolerance used only for the mist-vs-scene comparison to avoid precision chatter on coincident surfaces.
  });
  const config = {
    featherPixels: DEFAULTS.featherPixels,
    coveragePower: DEFAULTS.coveragePower,
    depthBias: DEFAULTS.depthBias,
  };

  const pendingByRenderer = new WeakMap();
  const originalRenderByRenderer = new WeakMap();
  const materialState = new WeakMap();
  const stats = {
    installed: true,
    baseDepthCaptures: 0,
    overlayDraws: 0,
    patchedMaterials: 0,
    shaderCompiles: 0,
    skippedNoDepthTexture: 0,
    skippedPostMismatch: 0,
    lastTargetWidth: 0,
    lastTargetHeight: 0,
  }; // Exposed through snapshot() so the mobile Debug panel / console can verify the path without devtools inspection.
  let loggedFirstOverlay = false;

  function finitePositive(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function applyConfig(next = {}) {
    config.featherPixels = finitePositive(next.featherPixels, config.featherPixels);
    config.coveragePower = finitePositive(next.coveragePower, config.coveragePower);
    const depthBias = Number(next.depthBias);
    if (Number.isFinite(depthBias) && depthBias >= 0) config.depthBias = depthBias;
    for (const state of materialState.values?.() || []) syncShaderState(state); // WeakMap is not iterable in normal engines; kept harmless for alternate implementations.
    return { ...config };
  }

  function isMistMesh(object) {
    return !!(object?.isMesh && /^cloud_forest_mist_\d+$/.test(String(object.name || '')));
  }

  function findMistGroup(scene) {
    const group = scene?.getObjectByName?.('cloud_forest_mist_cylinders') || null;
    if (!group || group.visible === false) return null;
    return group;
  }

  function collectMistMeshes(group) {
    const meshes = [];
    group?.traverse?.(object => {
      if (isMistMesh(object) && object.visible !== false) meshes.push(object);
    });
    return meshes;
  }

  function stateForMaterial(material) {
    let state = materialState.get(material);
    if (state) return state;
    state = {
      material,
      shader: null,
      depthTexture: null,
      invViewportX: 1,
      invViewportY: 1,
      enabled: 0,
    };
    materialState.set(material, state);
    return state;
  }

  function syncShaderState(state) {
    const shader = state?.shader;
    if (!shader?.uniforms) return;
    shader.uniforms.uHobunjiMistSceneDepth.value = state.depthTexture;
    shader.uniforms.uHobunjiMistInvViewport.value.set(state.invViewportX, state.invViewportY);
    shader.uniforms.uHobunjiMistSoftDepthEnabled.value = state.enabled;
    shader.uniforms.uHobunjiMistFeatherPixels.value = config.featherPixels;
    shader.uniforms.uHobunjiMistCoveragePower.value = config.coveragePower;
    shader.uniforms.uHobunjiMistDepthBias.value = config.depthBias;
  }

  function patchMistMaterial(material) {
    if (!material || material.userData?.hobunjiCloudForestSoftDepthPatched) return material;
    const state = stateForMaterial(material);
    const previousCompile = material.onBeforeCompile;
    const previousProgramKey = material.customProgramCacheKey;

    material.onBeforeCompile = function hobunjiCloudForestMistSoftDepthCompile(shader, renderer) {
      previousCompile?.call(this, shader, renderer);
      const commonMarker = '#include <common>';
      const outputMarker = '#include <output_fragment>';
      if (!shader.fragmentShader.includes(commonMarker) || !shader.fragmentShader.includes(outputMarker)) return;

      shader.uniforms.uHobunjiMistSceneDepth = { value: state.depthTexture };
      shader.uniforms.uHobunjiMistInvViewport = { value: new THREE.Vector2(state.invViewportX, state.invViewportY) };
      shader.uniforms.uHobunjiMistSoftDepthEnabled = { value: state.enabled };
      shader.uniforms.uHobunjiMistFeatherPixels = { value: config.featherPixels };
      shader.uniforms.uHobunjiMistCoveragePower = { value: config.coveragePower };
      shader.uniforms.uHobunjiMistDepthBias = { value: config.depthBias };

      shader.fragmentShader = shader.fragmentShader.replace(commonMarker, `${commonMarker}\n\n        uniform sampler2D uHobunjiMistSceneDepth;\n        uniform vec2 uHobunjiMistInvViewport;\n        uniform float uHobunjiMistSoftDepthEnabled;\n        uniform float uHobunjiMistFeatherPixels;\n        uniform float uHobunjiMistCoveragePower;\n        uniform float uHobunjiMistDepthBias;\n\n        float hobunjiMistDepthVisibility(vec2 uv, float mistDepth) {\n          float sceneDepth = texture2D(uHobunjiMistSceneDepth, clamp(uv, vec2(0.0), vec2(1.0))).x;\n          return step(mistDepth - uHobunjiMistDepthBias, sceneDepth);\n        }\n      `);

      shader.fragmentShader = shader.fragmentShader.replace(outputMarker, `
        if (uHobunjiMistSoftDepthEnabled > 0.5) {
          vec2 mistUv = gl_FragCoord.xy * uHobunjiMistInvViewport;
          vec2 dx = vec2(uHobunjiMistInvViewport.x * uHobunjiMistFeatherPixels, 0.0);
          vec2 dy = vec2(0.0, uHobunjiMistInvViewport.y * uHobunjiMistFeatherPixels);
          float mistDepth = gl_FragCoord.z;
          float coverage = (
            hobunjiMistDepthVisibility(mistUv, mistDepth)
            + hobunjiMistDepthVisibility(mistUv + dx, mistDepth)
            + hobunjiMistDepthVisibility(mistUv - dx, mistDepth)
            + hobunjiMistDepthVisibility(mistUv + dy, mistDepth)
            + hobunjiMistDepthVisibility(mistUv - dy, mistDepth)
          ) * 0.2;
          coverage = pow(clamp(coverage, 0.0, 1.0), uHobunjiMistCoveragePower);
          diffuseColor.a *= coverage;
          if (diffuseColor.a <= 0.001) discard;
        }
        ${outputMarker}
      `);

      state.shader = shader;
      stats.shaderCompiles++;
      syncShaderState(state);
    };

    material.customProgramCacheKey = function hobunjiCloudForestMistSoftDepthProgramKey() {
      const prior = typeof previousProgramKey === 'function' ? previousProgramKey.call(this) : '';
      return `${prior}|hobunji-cloud-forest-soft-depth-v1`;
    };
    material.userData = Object.assign({}, material.userData, { hobunjiCloudForestSoftDepthPatched: true });
    material.needsUpdate = true;
    stats.patchedMaterials++;
    return material;
  }

  function patchMistMeshes(meshes) {
    for (const mesh of meshes || []) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) patchMistMaterial(material);
    }
  }

  function setOverlayState(meshes, depthTexture, width, height, enabled) {
    const invX = 1 / Math.max(1, Number(width) || 1);
    const invY = 1 / Math.max(1, Number(height) || 1);
    for (const mesh of meshes || []) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const state = stateForMaterial(material);
        state.depthTexture = depthTexture || null;
        state.invViewportX = invX;
        state.invViewportY = invY;
        state.enabled = enabled ? 1 : 0;
        syncShaderState(state);
      }
    }
  }

  function isMainBasePass(renderer, scene, camera) {
    const target = renderer.getRenderTarget?.() || null;
    const mask = Number(camera?.layers?.mask ?? 0) >>> 0;
    return !!(
      target?.depthTexture
      && target?.texture
      && mask === MASK_ALL
      && !scene?.overrideMaterial
      && findMistGroup(scene)
    );
  }

  function findPostMaterial(scene) {
    for (const child of scene?.children || []) {
      const materials = Array.isArray(child?.material) ? child.material : [child?.material];
      for (const material of materials) {
        const uniforms = material?.uniforms;
        if (uniforms?.tColor && uniforms?.tSceneDepth && uniforms?.uTexel) return material;
      }
    }
    return null;
  }

  function isMatchingPostPass(renderer, scene, pending) {
    if (!pending || renderer.getRenderTarget?.()) return false;
    const postMaterial = findPostMaterial(scene);
    if (!postMaterial) return false;
    const uniforms = postMaterial.uniforms;
    return uniforms.tColor.value === pending.targetTexture
      && uniforms.tSceneDepth.value === pending.depthTexture;
  }

  function drawSoftMistOverlay(renderer, pending) {
    const { scene, camera, meshes, depthTexture, targetWidth, targetHeight } = pending;
    if (!meshes?.length || !depthTexture) return false;

    patchMistMeshes(meshes);
    setOverlayState(meshes, depthTexture, targetWidth, targetHeight, true);

    const previousCameraMask = camera.layers.mask;
    const previousOverride = scene.overrideMaterial;
    const previousBackground = scene.background;
    const previousAutoClear = renderer.autoClear;
    const previousTarget = renderer.getRenderTarget?.() || null;
    const shadowMap = renderer.shadowMap;
    const previousShadowAutoUpdate = !!shadowMap?.autoUpdate;
    const meshStates = meshes.map(mesh => ({
      mesh,
      layerMask: mesh.layers.mask,
      materials: (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => ({
        material,
        depthTest: material?.depthTest,
      })),
    }));

    try {
      renderer.setRenderTarget(null);
      scene.overrideMaterial = null;
      scene.background = null;
      renderer.autoClear = false;
      camera.layers.set(OVERLAY_LAYER);
      if (shadowMap?.enabled) shadowMap.autoUpdate = false;

      for (const entry of meshStates) {
        entry.mesh.layers.set(OVERLAY_LAYER);
        for (const matState of entry.materials) {
          if (!matState.material) continue;
          matState.material.depthTest = false; // The sampled offscreen scene depth is authoritative during this post-composite overlay.
        }
      }

      originalRenderByRenderer.get(renderer).call(renderer, scene, camera);
      stats.overlayDraws++;
      if (!loggedFirstOverlay) {
        loggedFirstOverlay = true;
        const message = `[cloud-forest-mist] soft depth overlay active: ${meshes.length} layer(s), ${targetWidth}x${targetHeight}, feather=${config.featherPixels}px`;
        if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
        else console.debug(message);
      }
      return true;
    } finally {
      for (const entry of meshStates) {
        entry.mesh.layers.mask = entry.layerMask;
        for (const matState of entry.materials) {
          if (!matState.material) continue;
          matState.material.depthTest = matState.depthTest;
        }
      }
      setOverlayState(meshes, depthTexture, targetWidth, targetHeight, false);
      if (shadowMap?.enabled) shadowMap.autoUpdate = previousShadowAutoUpdate;
      camera.layers.mask = previousCameraMask;
      renderer.autoClear = previousAutoClear;
      scene.background = previousBackground;
      scene.overrideMaterial = previousOverride;
      renderer.setRenderTarget(previousTarget);
    }
  }

  function wrappedRender(scene, camera) {
    const renderer = this;

    if (isMainBasePass(renderer, scene, camera)) {
      const target = renderer.getRenderTarget?.();
      const group = findMistGroup(scene);
      const meshes = collectMistMeshes(group);
      if (meshes.length) {
        patchMistMeshes(meshes);
        const wasVisible = group.visible;
        group.visible = false; // Keep mist out of the colour pass while preserving the target's real world/player depth for the later soft overlay.
        let result;
        try {
          result = originalRenderByRenderer.get(renderer).call(renderer, scene, camera);
        } finally {
          group.visible = wasVisible;
        }
        const width = Number(target.width) || renderer.domElement?.width || 1;
        const height = Number(target.height) || renderer.domElement?.height || 1;
        pendingByRenderer.set(renderer, {
          scene,
          camera,
          meshes,
          depthTexture: target.depthTexture,
          targetTexture: target.texture,
          targetWidth: width,
          targetHeight: height,
        });
        stats.baseDepthCaptures++;
        stats.lastTargetWidth = width;
        stats.lastTargetHeight = height;
        return result;
      }
    }

    const pending = pendingByRenderer.get(renderer);
    if (pending && !renderer.getRenderTarget?.()) {
      const postMaterial = findPostMaterial(scene);
      if (postMaterial) {
        const result = originalRenderByRenderer.get(renderer).call(renderer, scene, camera);
        if (isMatchingPostPass(renderer, scene, pending)) {
          drawSoftMistOverlay(renderer, pending);
          pendingByRenderer.delete(renderer);
        } else {
          stats.skippedPostMismatch++;
          pendingByRenderer.delete(renderer);
        }
        return result;
      }
    }

    return originalRenderByRenderer.get(renderer).call(renderer, scene, camera);
  }

  wrappedRender.__hobunjiCloudForestMistSoftDepthWrapped = true;

  // Wrap the constructor (not the prototype) so each renderer instance gets
  // its own render patched over its own original — see the comment at the
  // top of this file for why prototype patching doesn't reach anything here.
  THREE.WebGLRenderer = function HobunjiCloudForestMistSoftDepthRenderer(...args) {
    const instance = new OriginalWebGLRenderer(...args);
    originalRenderByRenderer.set(instance, instance.render);
    instance.render = wrappedRender;
    return instance;
  };
  THREE.WebGLRenderer.prototype = OriginalWebGLRenderer.prototype;
  THREE.WebGLRenderer.__hobunjiCloudForestMistSoftDepthOriginal = OriginalWebGLRenderer;

  window.CloudForestMistSoftDepth = {
    installed: true,
    config,
    configure: applyConfig,
    snapshot() {
      return {
        ...stats,
        config: { ...config },
        mode: 'offscreen-scene-depth + 5-tap silhouette feather + post-composite mist overlay',
        fallback: 'ordinary depth-tested mist when the main offscreen outline/depth pass is disabled',
      };
    },
  };
})();
