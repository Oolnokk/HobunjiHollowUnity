// Precise combat projectile cover against nearby rendered world geometry.
(() => {
  'use strict';

  const COMBAT_RADIUS_TILES = 12; // Bounds the combat-only cover broad phase so scene traversal stays local.
  const CACHE_MOVE_TILES = 1.25; // Used to avoid rebuilding the local mesh list until the player moves materially.
  const CACHE_MAX_AGE_MS = 450; // Used to pick up newly spawned/burned props without traversing the scene every frame.
  const IGNORE_HINT = /avatar|portrait|player|creature|npc|projectile|trail|reticle|shadow|water|ground|terrain|tile|mist|rain|particle|flame|fireeffect|held/i;

  let deps = null;
  let cachedScene = null;
  let cachedCombat = null;
  let cachedFocusX = NaN;
  let cachedFocusY = NaN;
  let cacheBuiltAt = 0;
  let candidates = [];
  let raycaster = null;
  let refreshCount = 0;
  let testedRayCount = 0;
  let lastBlock = null;
  let options = { enabled: true, projectiles: true, textureAlpha: true }; // Controls combat cover from the mobile-accessible Settings toggles.
  const textureAlphaCache = new WeakMap(); // Stores decoded texture alpha so repeated precise hits never reread the same image pixels.

  function init(injectedDeps) {
    deps = injectedDeps;
    raycaster = new deps.THREE.Raycaster();
    options = { ...options, ...(injectedDeps.options || {}) };
    invalidate();
    deps.debugLog?.('Nearby volume collision: precise combat projectile cover enabled; player movement remains tile-only.');
  }

  function setOptions(next = {}) {
    options = { ...options, ...next };
    invalidate();
    return { ...options };
  }

  function invalidate() {
    cachedScene = null;
    cacheBuiltAt = 0;
    candidates = [];
  }

  function hasActorAncestor(object) {
    let node = object;
    for (let depth = 0; node && depth < 7; depth++, node = node.parent) {
      const data = node.userData || {};
      if (Number.isFinite(data.portraitModelHeight) || data.actor || data.creature || data.isPlayerAvatar) return true;
    }
    return false;
  }

  function materialCanBlock(material) {
    const list = Array.isArray(material) ? material : [material];
    return list.some(entry => entry && entry.visible !== false && Number(entry.opacity ?? 1) > 0.12);
  }

  function isCandidateMesh(object) {
    if (!object?.isMesh || object.visible === false || !object.geometry?.attributes?.position) return false;
    if (!materialCanBlock(object.material) || hasActorAncestor(object)) return false;
    const data = object.userData || {};
    if (data.nonVolumeCollision || data.noCollision || data.isBillboard || data.isGround || data.isWater ||
        data.isShadow || data.isParticle || data.isProjectile) return false;
    const dataText = ' ' + (object.name || '') + ' ' + (data.kind || '') + ' ' + (data.type || '') + ' ' +
      (data.objectType || '') + ' ' + (data.floraKind || '') + ' ' + (data.furnitureKey || '');
    if (IGNORE_HINT.test(dataText)) return false;
    return true;
  }

  function focusWorld(wx, wy) {
    return new deps.THREE.Vector3(
      wx / deps.TILE,
      deps.worldSurfaceY(wx, wy) + 0.45,
      wy / deps.TILE,
    );
  }

  function rebuild(wx, wy) {
    const scene = deps.getActiveScene?.();
    if (!scene) {
      candidates = [];
      cachedScene = null;
      return;
    }
    scene.updateMatrixWorld?.(true);
    const focus = focusWorld(wx, wy);
    const radiusTiles = COMBAT_RADIUS_TILES;
    const radiusSq = (radiusTiles + 2) * (radiusTiles + 2);
    const next = [];
    scene.traverse(object => {
      if (!isCandidateMesh(object)) return;
      if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere?.();
      const sphere = object.geometry.boundingSphere;
      if (!sphere) return;
      const center = sphere.center.clone().applyMatrix4(object.matrixWorld);
      const scale = object.getWorldScale(new deps.THREE.Vector3());
      const radius = sphere.radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
      if (center.distanceToSquared(focus) > Math.pow(radiusTiles + radius + 1, 2) && center.distanceToSquared(focus) > radiusSq) return;
      next.push(object);
    });
    candidates = next;
    cachedScene = scene;
    cachedCombat = true;
    cachedFocusX = wx;
    cachedFocusY = wy;
    cacheBuiltAt = performance.now();
    refreshCount++;
  }

  function ensureCandidates(wx, wy) {
    if (!deps || !options.enabled || !options.projectiles) return false;
    const combat = !!deps.isCombatActive?.();
    if (!combat) return false;
    const scene = deps.getActiveScene?.();
    const movedPx = Math.hypot(wx - cachedFocusX, wy - cachedFocusY);
    if (scene !== cachedScene || combat !== cachedCombat || !Number.isFinite(movedPx) ||
        movedPx > CACHE_MOVE_TILES * deps.TILE || performance.now() - cacheBuiltAt > CACHE_MAX_AGE_MS) {
      rebuild(wx, wy);
    }
    return true;
  }

  function materialForHit(hit) {
    const material = hit.object?.material;
    if (!Array.isArray(material)) return material;
    return material[hit.face?.materialIndex || 0] || material[0];
  }

  function textureAlphaAt(texture, uv) {
    const image = texture?.image;
    if (!image || !uv) return null;
    let cached = textureAlphaCache.get(texture);
    if (!cached) {
      const width = image.naturalWidth || image.videoWidth || image.width;
      const height = image.naturalHeight || image.videoHeight || image.height;
      if (!(width > 0 && height > 0)) return null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, width, height);
        cached = { width, height, pixels: context.getImageData(0, 0, width, height).data };
      } catch (_) {
        cached = { unavailable: true };
      }
      textureAlphaCache.set(texture, cached);
    }
    if (cached.unavailable) return null;
    const sampleUv = uv.clone();
    texture.transformUv?.(sampleUv);
    const x = Math.max(0, Math.min(cached.width - 1, Math.floor(sampleUv.x * cached.width)));
    const y = Math.max(0, Math.min(cached.height - 1, Math.floor((1 - sampleUv.y) * cached.height)));
    return cached.pixels[(y * cached.width + x) * 4 + 3] / 255;
  }

  function hitCanBlock(hit) {
    const material = materialForHit(hit);
    if (!material || material.visible === false || Number(material.opacity ?? 1) <= 0.12) return false;
    if (!material.map || !hit.uv) return true;
    if (!options.textureAlpha) return true;
    const alpha = textureAlphaAt(material.map, hit.uv);
    if (alpha == null) return true;
    const threshold = Math.max(0.08, Number(material.alphaTest) || 0);
    return alpha * Number(material.opacity ?? 1) > threshold;
  }

  function raycast(origin, direction, far) {
    if (!candidates.length || far <= 0.0001) return null;
    testedRayCount++;
    raycaster.set(origin, direction);
    raycaster.near = 0.002;
    raycaster.far = far;
    const hits = raycaster.intersectObjects(candidates, false);
    return hits.find(hit => hit.distance <= far + 0.0001 && hitCanBlock(hit)) || null;
  }

  function segmentHit(start, end, radiusWorld = 0) {
    if (!deps || !ensureCandidates(deps.player.x, deps.player.y)) return null;
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 0.0001) return null;
    direction.divideScalar(length);
    const offsets = [new deps.THREE.Vector3()];
    if (radiusWorld > 0.0001) {
      const up = Math.abs(direction.y) < 0.92
        ? new deps.THREE.Vector3(0, 1, 0)
        : new deps.THREE.Vector3(1, 0, 0);
      const side = new deps.THREE.Vector3().crossVectors(direction, up).normalize().multiplyScalar(radiusWorld);
      const other = new deps.THREE.Vector3().crossVectors(direction, side).normalize().multiplyScalar(radiusWorld);
      offsets.push(side, side.clone().negate(), other, other.clone().negate());
    }
    let nearest = null;
    for (const offset of offsets) {
      const hit = raycast(start.clone().add(offset), direction, length);
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
    }
    if (!nearest) return null;
    lastBlock = {
      kind: 'projectile',
      object: nearest.object?.name || nearest.object?.parent?.name || '(unnamed mesh)',
      distanceWorld: Number(nearest.distance.toFixed(3)),
      at: performance.now(),
    };
    return { t: Math.max(0, Math.min(1, nearest.distance / length)), distanceWorld: nearest.distance, object: nearest.object, point: nearest.point };
  }

  function debugSnapshot() {
    return {
      mode: deps?.isCombatActive?.() ? 'combat-projectile-cover' : 'inactive',
      candidates: candidates.length,
      radiusTiles: COMBAT_RADIUS_TILES,
      refreshCount,
      testedRayCount,
      cacheAgeMs: cacheBuiltAt ? Math.round(performance.now() - cacheBuiltAt) : null,
      options: { ...options },
      lastBlock: lastBlock ? { ...lastBlock, ageMs: Math.round(performance.now() - lastBlock.at) } : null,
    };
  }

  window.NearbyVolumeCollision = {
    init,
    setOptions,
    invalidate,
    segmentHit,
    debugSnapshot,
    constants: { COMBAT_RADIUS_TILES, CACHE_MOVE_TILES, CACHE_MAX_AGE_MS },
  };
})();
