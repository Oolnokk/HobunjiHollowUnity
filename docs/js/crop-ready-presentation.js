// Presentation-only ripe-crop cue: stationary plants + one shared sparkle cloud.
//
// The crop updater still writes its legacy ripe-only Y bob and root spin. This
// module reads the authoritative tile.cropReady flag, removes that motion at draw
// time, and leaves the existing sparkle cue as the only visual readiness signal.
// Gameplay crop state, growth, harvesting, persistence, sizing, clustering, and
// flood/soil anchoring remain owned by their existing systems.
//
// Performance note: the renderer can execute several passes per displayed frame.
// Full scene discovery stays throttled, but the already-discovered crop roots are
// checked against tile.cropReady every JS turn so ripeness changes do not wait for
// the next scene scan before bob/spin are suppressed.
(() => {
  'use strict';

  if (window.HobunjiCropReadyPresentation) return;

  const THREE = window.THREE; // Used by the shared sparkle Points object and renderer hook below.
  if (!THREE?.WebGLRenderer?.prototype) return;

  const MIN_CROP_SCALE = 0.145; // Used by plausibleCropRoot to reject unrelated half-tile scene objects.
  const MAX_CROP_SCALE = 0.975; // Used with MIN_CROP_SCALE to match the crop renderer's growth-scale range.
  const SPARKLES_PER_CROP = 4; // Used by updateSparkles to keep the existing four-point ripe cue.
  const DISCOVERY_INTERVAL_MS = 100; // Used to rescan scene membership at 10 Hz while readiness itself is checked every render turn.
  const FOLIAGE_CROPS = new Set(['needlegrain', 'heftroot']); // Used to mirror the two crop types that use the foliage renderer's smaller legacy bob/spin profile.
  const FOLIAGE_READY_BOB = 0.025; // Used to exactly cancel vegetation-crop-rendering's ripe foliage Y amplitude.
  const GENERIC_READY_BOB = 0.03; // Used to exactly cancel vegetation-crop-rendering's ripe generic/PNG crop Y amplitude.
  const FOLIAGE_READY_ROTATION_MS = 2200; // Used to recover the foliage updater's source timestamp from its authored ripe rotation.
  const GENERIC_READY_ROTATION_MS = 1200; // Used to recover the generic updater's source timestamp from its authored ripe rotation.
  const sceneState = new WeakMap(); // Used to retain one sparkle buffer + cached crop-root list per rendered farm scene.
  let lastReadyCount = 0; // Used by mobile-readable diagnostics to report the current authoritative ripe-crop count.
  let lastNeutralizedCount = 0; // Used by diagnostics to confirm how many ripe roots had bob/spin removed on the last farm render.
  let farmDeps = null; // Captured from FarmPanel.init so readiness comes from the authoritative farm grid instead of inferred animation.

  function patchFarmPanel(api) {
    if (!api?.init || api.__hobunjiCropReadyPresentationPatched) return;
    const originalInit = api.init.bind(api); // Used to preserve normal FarmPanel initialization while retaining its live farm dependencies.
    api.init = function cropReadyPresentationFarmPanelInit(injectedDeps = {}, ...rest) {
      const result = originalInit(injectedDeps, ...rest);
      farmDeps = injectedDeps;
      return result;
    };
    api.__hobunjiCropReadyPresentationPatched = true;
  }

  function installFarmPanelHook() {
    if (window.FarmPanel) { patchFarmPanel(window.FarmPanel); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'FarmPanel'); // Used to chain with any earlier lazy FarmPanel global hook.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get; // Used to preserve a previously installed FarmPanel getter.
    const previousSet = descriptor?.set; // Used to preserve a previously installed FarmPanel setter.
    let value = descriptor?.value; // Used as local storage only when no earlier accessor owns the FarmPanel global.
    Object.defineProperty(window, 'FarmPanel', {
      configurable: true,
      get() { return previousGet ? previousGet.call(window) : value; },
      set(next) {
        if (previousSet) previousSet.call(window, next);
        else value = next;
        patchFarmPanel(previousGet ? previousGet.call(window) : value);
      },
    });
  }

  function halfTileCentered(value) {
    if (!Number.isFinite(value)) return false;
    return Math.abs((value - Math.floor(value)) - 0.5) < 0.012;
  }

  function uniformCropScale(root) {
    const sx = Number(root?.scale?.x); // Used with sy/sz to identify the crop renderer's uniform growth transform.
    const sy = Number(root?.scale?.y); // Used with sx/sz to reject non-crop scene objects.
    const sz = Number(root?.scale?.z); // Used with sx/sy to reject non-uniform transforms.
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) return null;
    if (Math.abs(sx - sy) > 0.0005 || Math.abs(sx - sz) > 0.0005) return null;
    return sx >= MIN_CROP_SCALE && sx <= MAX_CROP_SCALE ? sx : null;
  }

  function isGenericCropCube(root) {
    const p = root?.geometry?.parameters; // Used to recognize the unconverted generic BoxGeometry crop path.
    return root?.isMesh
      && root.geometry?.type === 'BoxGeometry'
      && root.material?.isMeshLambertMaterial
      && Math.abs(Number(p?.width) - 1) < 0.0001
      && Math.abs(Number(p?.height) - 1) < 0.0001
      && Math.abs(Number(p?.depth) - 1) < 0.0001;
  }

  function hasAuthoredCropSprite(root) {
    let found = Boolean(root?.userData?.hobunjiCropSpriteKey); // Used to recognize converted PNG crop roots or foliage wrappers containing authored crop planes.
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

  function tileForRoot(root) {
    const grid = farmDeps?.getGrid?.(); // Used as the authoritative cropReady source rather than animation-motion inference.
    if (!grid || !root?.position) return null;
    const col = Math.floor(Number(root.position.x)); // Used because crop roots are positioned at col + 0.5.
    const row = Math.floor(Number(root.position.z)); // Used because crop roots are positioned at row + 0.5.
    if (col < 0 || row < 0 || row >= grid.length || col >= (grid[row]?.length || 0)) return null;
    return { tile: grid[row][col], col, row };
  }

  function legacyMotionProfile(tile) {
    const foliage = FOLIAGE_CROPS.has(tile?.crop); // Used to select the exact legacy updater branch whose bob/spin must be cancelled.
    return foliage
      ? { bob: FOLIAGE_READY_BOB, rotationMs: FOLIAGE_READY_ROTATION_MS }
      : { bob: GENERIC_READY_BOB, rotationMs: GENERIC_READY_ROTATION_MS };
  }

  function sourceReadyTimestamp(root, col, rotationMs, fallbackNowMs) {
    const rotationY = Number(root?.rotation?.y); // Used to invert the legacy `now / rotationMs + col` assignment and recover the bob's source phase when available.
    if (!Number.isFinite(rotationY)) return fallbackNowMs;
    const recovered = (rotationY - col) * rotationMs; // Used by staticReadyY so cancellation remains exact even when render occurs a few ms after crop update.
    return Number.isFinite(recovered) && recovered >= 0 ? recovered : fallbackNowMs;
  }

  function staticReadyY(entry, fallbackNowMs) {
    const rawY = Number(entry?.root?.position?.y); // Used as the legacy bobbed Y that will be returned to its stationary baseline.
    if (!Number.isFinite(rawY)) return rawY;
    const profile = legacyMotionProfile(entry.tile); // Used to mirror the exact foliage or generic ripe-motion constants.
    const sourceNow = sourceReadyTimestamp(entry.root, entry.col, profile.rotationMs, fallbackNowMs); // Used to reconstruct the updater's original sine phase.
    const bobY = Math.sin(sourceNow / 500 + entry.col + entry.row) * profile.bob; // Used to remove only the ripe-only vertical bob, leaving terrain/flood offsets for the inner soil-grounding wrapper.
    return rawY - bobY;
  }

  function ensureSceneState(scene) {
    let record = sceneState.get(scene); // Used to reuse one shared sparkle cloud for this farm scene.
    if (record) return record;

    const geometry = new THREE.BufferGeometry(); // Used as the dynamically resized shared ripe-sparkle position buffer.
    const material = new THREE.PointsMaterial({
      color: 0xfff2b0,
      size: 0.075,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      sizeAttenuation: true,
    }); // Used to preserve the pre-existing warm sparkle appearance.
    const points = new THREE.Points(geometry, material); // Used as one draw call for every ripe crop's sparkle cue.
    points.frustumCulled = false;
    points.renderOrder = 4;
    points.userData.hobunjiReadyCropSparkles = true;
    scene.add(points);

    record = {
      geometry,
      material,
      points,
      cropRoots: [],
      readyRoots: [],
      capacityPoints: 0,
      positionArray: null,
      positionAttribute: null,
      scanValidThisTurn: false,
      scanResetQueued: false,
      lastDiscoveryAt: -Infinity,
      presentationNowMs: 0,
    }; // Holds cached crop roots, authoritative-ready roots, and one reusable GPU sparkle buffer.
    sceneState.set(scene, record);
    return record;
  }

  function ensurePointCapacity(record, requiredPoints) {
    if (requiredPoints <= record.capacityPoints && record.positionAttribute) return;
    let nextCapacity = Math.max(16, record.capacityPoints || 0); // Used to grow the shared sparkle buffer geometrically instead of reallocating per ripe crop.
    while (nextCapacity < requiredPoints) nextCapacity *= 2;
    const positions = new Float32Array(nextCapacity * 3); // Used as xyz storage for every active sparkle point.
    const attribute = new THREE.BufferAttribute(positions, 3); // Used as the geometry's dynamic position attribute.
    attribute.setUsage?.(THREE.DynamicDrawUsage);
    record.positionArray = positions;
    record.positionAttribute = attribute;
    record.capacityPoints = nextCapacity;
    record.geometry.setAttribute('position', attribute);
  }

  function updateSparkles(record, readyRoots, nowMs) {
    const pointCount = readyRoots.length * SPARKLES_PER_CROP; // Used to trim the shared buffer to only currently ripe crops.
    if (!pointCount) {
      record.geometry.setDrawRange(0, 0);
      record.points.visible = false;
      return;
    }

    ensurePointCapacity(record, pointCount);
    const positions = record.positionArray; // Used as the writable shared sparkle xyz buffer.
    let cursor = 0; // Used to append each ripe crop's four sparkle positions without allocations.
    for (const entry of readyRoots) {
      const root = entry.root; // Used as the ripe crop's world X/Z source.
      const scale = entry.scale; // Used to keep the sparkle cloud proportional to crop growth size.
      const baseY = staticReadyY(entry, nowMs); // Used so the sparkle cue stays stationary even though the legacy updater still writes a bobbed root before render.
      const phaseSeed = Number(root.position.x) * 1.71 + Number(root.position.z) * 2.37; // Used to desynchronize sparkle orbits between neighboring crops.
      for (let index = 0; index < SPARKLES_PER_CROP; index++) {
        const phase = nowMs * 0.0016 + phaseSeed + index * (Math.PI * 2 / SPARKLES_PER_CROP); // Used to animate the sparkle itself while the plant remains still.
        const radius = 0.18 + scale * 0.22 + Math.sin(phase * 1.7) * 0.035; // Used to make the points gently orbit instead of moving the crop.
        positions[cursor++] = Number(root.position.x) + Math.cos(phase) * radius;
        positions[cursor++] = baseY + 0.18 + scale * (0.35 + index * 0.08) + Math.sin(phase * 2.2) * 0.07;
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

  function discoverCropRoots(scene, record, nowMs) {
    const cropRoots = []; // Used to cache plausible planted crop roots without tying membership discovery to readiness state.
    scene?.children?.forEach?.(root => {
      if (!plausibleCropRoot(root, scene)) return;
      const located = tileForRoot(root); // Used to ensure the half-tile render root still corresponds to a live planted crop tile.
      if (!located?.tile?.crop) return;
      const scale = uniformCropScale(root); // Used by later sparkle radius/height calculations for this cached root.
      cropRoots.push({ root, col: located.col, row: located.row, scale });
    });
    record.cropRoots = cropRoots;
    record.lastDiscoveryAt = nowMs;
  }

  function refreshReadyRoots(record) {
    const readyRoots = []; // Used to derive current readiness cheaply from cached crop roots every render turn.
    for (const cached of record.cropRoots) {
      const root = cached.root; // Used to discard harvested/rebuilt roots before the next 10 Hz membership scan.
      if (!root || root.parent !== farmDeps?.scene) continue;
      const located = tileForRoot(root); // Used to read the current tile object even if the farm grid was replaced on load/reset.
      if (!located?.tile?.crop || !located.tile.cropReady) continue;
      const scale = uniformCropScale(root); // Used to track growth changes between slower scene-membership scans.
      if (scale === null) continue;
      readyRoots.push({ root, tile: located.tile, col: located.col, row: located.row, scale });
    }
    record.readyRoots = readyRoots;
    lastReadyCount = readyRoots.length;
  }

  function refreshSceneTurn(scene, record) {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(); // Used by sparkle animation and exact legacy-bob cancellation for this render turn.
    if (nowMs - record.lastDiscoveryAt >= DISCOVERY_INTERVAL_MS) {
      discoverCropRoots(scene, record, nowMs);
    }
    refreshReadyRoots(record);
    record.presentationNowMs = nowMs;
    updateSparkles(record, record.readyRoots, nowMs);
    record.scanValidThisTurn = true;
    queueTurnReset(record);
  }

  function prepare(scene) {
    lastNeutralizedCount = 0;
    if (!scene || !farmDeps?.scene || scene !== farmDeps.scene) return [];
    const record = ensureSceneState(scene); // Used to access the cached crop-root and authoritative-ready sets for this farm scene.
    if (!record.scanValidThisTurn) refreshSceneTurn(scene, record);

    const restore = []; // Used to restore simulation-owned legacy transforms immediately after this synchronous render pass.
    for (const entry of record.readyRoots) {
      const root = entry.root; // Used as the one game-owned crop transform that must stay stationary while drawn.
      if (!root || root.parent !== scene || !entry.tile?.cropReady) continue;
      restore.push({ root, y: root.position.y, rotationY: root.rotation.y });
      root.position.y = staticReadyY(entry, record.presentationNowMs);
      root.rotation.y = 0;
      lastNeutralizedCount++;
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
    const prototype = THREE.WebGLRenderer.prototype; // Used as the shared synchronous draw boundary after the renderer is made prototype-hookable.
    if (prototype.__hobunjiCropReadyPresentationHooked || typeof prototype.render !== 'function') return;
    const previousRender = prototype.render; // Used to preserve crop PNG/soil grounding and all earlier renderer wrappers.
    prototype.render = function cropReadyPresentationRender(scene, camera, ...rest) {
      const states = prepare(scene); // Used to remove only ripe bob/spin before every actual draw pass.
      try {
        return previousRender.call(this, scene, camera, ...rest);
      } finally {
        restoreTransforms(states);
      }
    };
    prototype.render.__hobunjiCropReadyPresentationOriginal = previousRender; // Used by held-object depth replay to unwrap back to the true renderer when needed.
    prototype.__hobunjiCropReadyPresentationHooked = true;
  }

  installFarmPanelHook();
  installRenderHook();

  window.HobunjiCropReadyPresentation = {
    getDebug: () => ({
      readyCrops: lastReadyCount,
      neutralizedReadyCrops: lastNeutralizedCount,
      sparklesPerCrop: SPARKLES_PER_CROP,
      readinessSource: 'tile.cropReady',
      ripePlantMotion: 'none',
      coalescedPerTurn: true,
      discoveryHz: 1000 / DISCOVERY_INTERVAL_MS,
      farmReady: Boolean(farmDeps?.scene && farmDeps?.getGrid),
      lastChange: 'Ripe crops stay stationary; the existing sparkle is the only readiness animation.',
    }),
  };
})();
