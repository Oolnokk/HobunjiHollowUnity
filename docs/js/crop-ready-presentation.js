// Presentation-only ripe-crop cue: stationary plants + one shared sparkle cloud.
//
// game.js marks a ready crop by bobbing its crop root on Y and continuously
// rotating that root. This module recognizes that ripe-only motion immediately
// before render, neutralizes just the visual bob/spin, and draws one shared
// THREE.Points sparkle cue over every detected ready crop. Gameplay crop state,
// growth, harvesting, persistence, sizing, clustering, and flood anchoring stay
// owned by their existing systems.
(() => {
  'use strict';

  if (window.HobunjiCropReadyPresentation) return;

  const THREE = window.THREE; // Used for the one shared Points cue and the renderer hook already made safe by combat-config-loader.
  if (!THREE?.WebGLRenderer?.prototype) return;

  const MIN_CROP_SCALE = 0.145; // Used to include game.js's 0.16 minimum crop growth scale with a small floating-point margin.
  const MAX_CROP_SCALE = 0.975; // Used to include game.js's 0.96 maximum crop scale while excluding ordinary scale-1 world groups.
  const MAX_READY_ROTATION_STEP = 0.18; // Used to recognize the slow game.js ripe spin while rejecting unrelated snap rotations.
  const SPARKLES_PER_CROP = 4; // Used to keep the ready cue readable while remaining much cheaper than one particle object per crop.
  const candidateState = new WeakMap(); // Used to compare each possible crop root's raw game.js rotation/Y across frames without retaining harvested roots.
  const sceneSparkles = new WeakMap(); // Used to keep exactly one shared Points object per rendered scene.
  let lastReadyCount = 0; // Used by diagnostics to report the most recent number of detected ready crop roots.

  function halfTileCentered(value) {
    if (!Number.isFinite(value)) return false;
    return Math.abs((value - Math.floor(value)) - 0.5) < 0.012;
  }

  function uniformCropScale(root) {
    const sx = Number(root?.scale?.x); // Used with Y/Z to match the scalar growth transform game.js applies to every crop root.
    const sy = Number(root?.scale?.y); // Used to reject arbitrary scene groups that only happen to sit on a half-tile center.
    const sz = Number(root?.scale?.z); // Used to constrain crop-root discovery without needing access to game.js's private cropMeshes array.
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) return null;
    if (Math.abs(sx - sy) > 0.0005 || Math.abs(sx - sz) > 0.0005) return null;
    return sx >= MIN_CROP_SCALE && sx <= MAX_CROP_SCALE ? sx : null;
  }

  function isGenericCropCube(root) {
    const p = root?.geometry?.parameters;
    return root?.isMesh
      && root.geometry?.type === 'BoxGeometry'
      && root.material?.isMeshLambertMaterial
      && Math.abs(Number(p?.width) - 1) < 0.0001
      && Math.abs(Number(p?.height) - 1) < 0.0001
      && Math.abs(Number(p?.depth) - 1) < 0.0001;
  }

  function hasAuthoredCropSprite(root) {
    let found = Boolean(root?.userData?.hobunjiCropSpriteKey); // Used for converted garlink/ongyums and heftroot billboard crops.
    if (found || !root?.traverse) return found;
    root.traverse(child => {
      if (!found && child?.userData?.hobunjiCropSpriteKey) found = true;
    });
    return found;
  }

  function plausibleCropRoot(root, scene) {
    if (!root || root.parent !== scene || root.userData?.hobunjiReadyCropSparkles) return false;
    if (!halfTileCentered(Number(root.position?.x)) || !halfTileCentered(Number(root.position?.z))) return false;
    if (uniformCropScale(root) === null) return false;
    if (isGenericCropCube(root) || hasAuthoredCropSprite(root)) return true;
    // Current crop presentation modules explicitly tag procedural roots such as
    // needlegrain/heftroot. Trust that tag instead of guessing among arbitrary
    // animated Groups (players/NPCs can occupy half-tile centers too).
    return Boolean(root.userData?.hobunjiCropRootKey);
  }

  function observeReadyCrop(root, nowMs) {
    const rawRotation = Number(root.rotation?.y) || 0; // Used to detect game.js's continuous ripe-only Y rotation before this presentation layer neutralizes it.
    const rawY = Number(root.position?.y) || 0; // Used to learn the center of game.js's small ripe-only vertical bob.
    let state = candidateState.get(root);
    if (!state) {
      state = { lastRawRotation: rawRotation, minY: rawY, maxY: rawY, stableY: rawY, lastMotionAt: -Infinity, ready: false };
      candidateState.set(root, state);
      return state;
    }

    const rotationStep = Math.abs(rawRotation - state.lastRawRotation); // Used to distinguish the slow ready spin from a static authored orientation.
    state.lastRawRotation = rawRotation;
    state.minY = Math.min(state.minY, rawY);
    state.maxY = Math.max(state.maxY, rawY);
    state.stableY = (state.minY + state.maxY) * 0.5;
    if (rotationStep > 0.00001 && rotationStep < MAX_READY_ROTATION_STEP) state.lastMotionAt = nowMs;
    state.ready = nowMs - state.lastMotionAt < 250; // Preserve readiness across multiple render passes between game.js animation updates.
    return state;
  }

  function ensureSparklePoints(scene) {
    let record = sceneSparkles.get(scene);
    if (record?.points?.parent === scene) return record;

    const geometry = new THREE.BufferGeometry(); // Used as the single mutable position buffer for every ready crop in this scene.
    const material = new THREE.PointsMaterial({
      color: 0xfff2b0,
      size: 0.075,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      sizeAttenuation: true,
    }); // Used by all ripe-crop sparkles instead of allocating one material/object per plant.
    const points = new THREE.Points(geometry, material); // Used as the one shared sparkle draw call for the current scene.
    points.frustumCulled = false;
    points.renderOrder = 4;
    points.userData.hobunjiReadyCropSparkles = true;
    scene.add(points);
    record = { geometry, material, points };
    sceneSparkles.set(scene, record);
    return record;
  }

  function updateSparkles(scene, readyRoots, nowMs) {
    const record = ensureSparklePoints(scene);
    if (!readyRoots.length) {
      record.points.visible = false;
      return;
    }

    const positions = new Float32Array(readyRoots.length * SPARKLES_PER_CROP * 3); // Used to rebuild one compact world-space point buffer from the currently attached ready roots.
    let cursor = 0;
    for (const { root, state, scale } of readyRoots) {
      const phaseSeed = Number(root.position.x) * 1.71 + Number(root.position.z) * 2.37; // Used to desynchronize neighboring crop twinkles without gameplay RNG.
      for (let index = 0; index < SPARKLES_PER_CROP; index++) {
        const phase = nowMs * 0.0016 + phaseSeed + index * (Math.PI * 2 / SPARKLES_PER_CROP);
        const radius = 0.18 + scale * 0.22 + Math.sin(phase * 1.7) * 0.035;
        positions[cursor++] = Number(root.position.x) + Math.cos(phase) * radius;
        positions[cursor++] = state.stableY + 0.18 + scale * (0.35 + index * 0.08) + Math.sin(phase * 2.2) * 0.07;
        positions[cursor++] = Number(root.position.z) + Math.sin(phase) * radius;
      }
    }

    record.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    record.geometry.computeBoundingSphere?.();
    record.material.opacity = 0.72 + (Math.sin(nowMs * 0.006) + 1) * 0.11;
    record.points.visible = true;
  }

  function prepare(scene) {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(); // Used once per render pass for motion classification and sparkle animation.
    const restore = []; // Used to return every game.js-owned crop transform immediately after the synchronous draw completes.
    const readyRoots = []; // Used to feed the one shared sparkle buffer only crops whose ripe-spin signature is active this frame.
    scene?.children?.forEach?.(root => {
      if (!plausibleCropRoot(root, scene)) return;
      const scale = uniformCropScale(root);
      const state = observeReadyCrop(root, nowMs);
      if (!state.ready) return;

      restore.push({ root, y: root.position.y, rotationY: root.rotation.y });
      root.position.y = state.stableY;
      root.rotation.y = 0;
      readyRoots.push({ root, state, scale });
    });
    lastReadyCount = readyRoots.length;
    updateSparkles(scene, readyRoots, nowMs);
    return restore;
  }

  function restoreTransforms(states) {
    for (const state of states) {
      if (!state.root) continue;
      state.root.position.y = state.y;
      state.root.rotation.y = state.rotationY;
    }
  }

  function installRenderHook() {
    const prototype = THREE.WebGLRenderer.prototype; // Used as the shared synchronous presentation boundary already used by the crop billboard adapters.
    if (prototype.__hobunjiCropReadyPresentationHooked || typeof prototype.render !== 'function') return;
    const previousRender = prototype.render; // Used to preserve crop flood anchoring, billboard facing, player composition, and every earlier render wrapper.
    prototype.render = function cropReadyPresentationRender(scene, camera, ...rest) {
      const states = prepare(scene);
      try {
        return previousRender.call(this, scene, camera, ...rest);
      } finally {
        restoreTransforms(states);
      }
    };
    prototype.__hobunjiCropReadyPresentationHooked = true;
  }

  installRenderHook();

  window.HobunjiCropReadyPresentation = {
    getDebug: () => ({ readyCrops: lastReadyCount, sparklesPerCrop: SPARKLES_PER_CROP }),
  };
})();
