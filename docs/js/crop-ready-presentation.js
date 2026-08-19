// Presentation-only ripe-crop cue: stationary plants + one shared sparkle cloud.
//
// game.js marks a ready crop by bobbing its crop root on Y and continuously
// rotating that root. This module recognizes that ripe-only motion immediately
// before render, neutralizes just the visual bob/spin, and draws one shared
// THREE.Points sparkle cue over every detected ready crop. Gameplay crop state,
// growth, harvesting, persistence, sizing, clustering, and flood anchoring stay
// owned by their existing systems.
//
// Performance note: the renderer can execute several passes per displayed frame.
// Crop discovery/sparkle-buffer work is therefore coalesced to once per JS turn;
// later render passes only apply/restore the already-known ready transforms.
(() => {
  'use strict';

  if (window.HobunjiCropReadyPresentation) return;

  const THREE = window.THREE;
  if (!THREE?.WebGLRenderer?.prototype) return;

  const MIN_CROP_SCALE = 0.145;
  const MAX_CROP_SCALE = 0.975;
  const MAX_READY_ROTATION_STEP = 0.18;
  const SPARKLES_PER_CROP = 4;
  const candidateState = new WeakMap();
  const sceneState = new WeakMap();
  let lastReadyCount = 0;

  function halfTileCentered(value) {
    if (!Number.isFinite(value)) return false;
    return Math.abs((value - Math.floor(value)) - 0.5) < 0.012;
  }

  function uniformCropScale(root) {
    const sx = Number(root?.scale?.x);
    const sy = Number(root?.scale?.y);
    const sz = Number(root?.scale?.z);
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
    let found = Boolean(root?.userData?.hobunjiCropSpriteKey);
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
    return Boolean(root.userData?.hobunjiCropRootKey);
  }

  function observeReadyCrop(root, nowMs) {
    const rawRotation = Number(root.rotation?.y) || 0;
    const rawY = Number(root.position?.y) || 0;
    let state = candidateState.get(root);
    if (!state) {
      state = {
        lastRawRotation: rawRotation,
        minY: rawY,
        maxY: rawY,
        stableY: rawY,
        lastMotionAt: -Infinity,
        ready: false,
      };
      candidateState.set(root, state);
      return state;
    }

    const rotationStep = Math.abs(rawRotation - state.lastRawRotation);
    state.lastRawRotation = rawRotation;
    state.minY = Math.min(state.minY, rawY);
    state.maxY = Math.max(state.maxY, rawY);
    state.stableY = (state.minY + state.maxY) * 0.5;
    if (rotationStep > 0.00001 && rotationStep < MAX_READY_ROTATION_STEP) state.lastMotionAt = nowMs;
    state.ready = nowMs - state.lastMotionAt < 250;
    return state;
  }

  function ensureSceneState(scene) {
    let record = sceneState.get(scene);
    if (record) return record;

    const geometry = new THREE.BufferGeometry();
    const material = new THREE.PointsMaterial({
      color: 0xfff2b0,
      size: 0.075,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    points.userData.hobunjiReadyCropSparkles = true;
    scene.add(points);

    record = {
      geometry,
      material,
      points,
      readyRoots: [],
      capacityPoints: 0,
      positionArray: null,
      positionAttribute: null,
      scanValidThisTurn: false,
      scanResetQueued: false,
    };
    sceneState.set(scene, record);
    return record;
  }

  function ensurePointCapacity(record, requiredPoints) {
    if (requiredPoints <= record.capacityPoints && record.positionAttribute) return;
    let nextCapacity = Math.max(16, record.capacityPoints || 0);
    while (nextCapacity < requiredPoints) nextCapacity *= 2;
    const positions = new Float32Array(nextCapacity * 3);
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.setUsage?.(THREE.DynamicDrawUsage);
    record.positionArray = positions;
    record.positionAttribute = attribute;
    record.capacityPoints = nextCapacity;
    record.geometry.setAttribute('position', attribute);
  }

  function updateSparkles(record, readyRoots, nowMs) {
    const pointCount = readyRoots.length * SPARKLES_PER_CROP;
    if (!pointCount) {
      record.geometry.setDrawRange(0, 0);
      record.points.visible = false;
      return;
    }

    ensurePointCapacity(record, pointCount);
    const positions = record.positionArray;
    let cursor = 0;
    for (const { root, state, scale } of readyRoots) {
      const phaseSeed = Number(root.position.x) * 1.71 + Number(root.position.z) * 2.37;
      for (let index = 0; index < SPARKLES_PER_CROP; index++) {
        const phase = nowMs * 0.0016 + phaseSeed + index * (Math.PI * 2 / SPARKLES_PER_CROP);
        const radius = 0.18 + scale * 0.22 + Math.sin(phase * 1.7) * 0.035;
        positions[cursor++] = Number(root.position.x) + Math.cos(phase) * radius;
        positions[cursor++] = state.stableY + 0.18 + scale * (0.35 + index * 0.08) + Math.sin(phase * 2.2) * 0.07;
        positions[cursor++] = Number(root.position.z) + Math.sin(phase) * radius;
      }
    }

    record.positionAttribute.needsUpdate = true;
    record.geometry.setDrawRange(0, pointCount);
    record.material.opacity = 0.72 + (Math.sin(nowMs * 0.006) + 1) * 0.11;
    record.points.visible = true;
  }

  function queueTurnReset(record) {
    if (record.scanResetQueued) return;
    record.scanResetQueued = true;
    queueMicrotask(() => {
      record.scanValidThisTurn = false;
      record.scanResetQueued = false;
    });
  }

  function scanScene(scene, record) {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const readyRoots = [];
    scene?.children?.forEach?.(root => {
      if (!plausibleCropRoot(root, scene)) return;
      const scale = uniformCropScale(root);
      const state = observeReadyCrop(root, nowMs);
      if (!state.ready) return;
      readyRoots.push({ root, state, scale });
    });
    record.readyRoots = readyRoots;
    record.scanValidThisTurn = true;
    lastReadyCount = readyRoots.length;
    updateSparkles(record, readyRoots, nowMs);
    queueTurnReset(record);
  }

  function prepare(scene) {
    if (!scene) return [];
    const record = ensureSceneState(scene);
    if (!record.scanValidThisTurn) scanScene(scene, record);

    const restore = [];
    for (const entry of record.readyRoots) {
      const root = entry.root;
      if (!root || root.parent !== scene) continue;
      restore.push({ root, y: root.position.y, rotationY: root.rotation.y });
      root.position.y = entry.state.stableY;
      root.rotation.y = 0;
    }
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
    const prototype = THREE.WebGLRenderer.prototype;
    if (prototype.__hobunjiCropReadyPresentationHooked || typeof prototype.render !== 'function') return;
    const previousRender = prototype.render;
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
    getDebug: () => ({
      readyCrops: lastReadyCount,
      sparklesPerCrop: SPARKLES_PER_CROP,
      coalescedPerTurn: true,
    }),
  };
})();
