// Precise local collision against rendered world geometry.
(() => {
  'use strict';

  const COMBAT_RADIUS_TILES = 12; // Used to bound projectile cover and player-volume collision while a fight is active.
  const TREE_RADIUS_TILES = 2.25; // Used outside combat so only trees immediately touching the player receive precise collision.
  const CACHE_MOVE_TILES = 1.25; // Used to avoid rebuilding the local mesh list until the player moves materially.
  const CACHE_MAX_AGE_MS = 450; // Used to pick up newly spawned/burned props without traversing the scene every frame.
  const MOVEMENT_RAYS = 12;
  const MOVEMENT_HEIGHTS = [0.10, 0.48, 0.88];
  const TREE_HINT = /tree|trunk|shadewood|canopy|branch|foliage/i;
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

  function init(injectedDeps) {
    deps = injectedDeps;
    raycaster = new deps.THREE.Raycaster();
    invalidate();
    deps.debugLog?.('Nearby volume collision: precise combat cover/player collision enabled; out-of-combat checks are tree-only and local.');
  }

  function invalidate() {
    cachedScene = null;
    cacheBuiltAt = 0;
    candidates = [];
  }

  function objectDescriptor(object) {
    let text = '';
    let node = object;
    for (let depth = 0; node && depth < 5; depth++, node = node.parent) {
      const data = node.userData || {};
      text += ' ' + (node.name || '') + ' ' + (data.kind || '') + ' ' + (data.type || '') + ' ' +
        (data.objectType || '') + ' ' + (data.floraKind || '') + ' ' + (data.furnitureKey || '');
    }
    return text;
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

  function isCandidateMesh(object, treeOnly) {
    if (!object?.isMesh || object.visible === false || !object.geometry?.attributes?.position) return false;
    if (!materialCanBlock(object.material) || hasActorAncestor(object)) return false;
    const data = object.userData || {};
    if (data.nonVolumeCollision || data.noCollision || data.isBillboard || data.isGround || data.isWater ||
        data.isShadow || data.isParticle || data.isProjectile) return false;
    const dataText = ' ' + (object.name || '') + ' ' + (data.kind || '') + ' ' + (data.type || '') + ' ' +
      (data.objectType || '') + ' ' + (data.floraKind || '') + ' ' + (data.furnitureKey || '');
    if (IGNORE_HINT.test(dataText)) return false;
    return !treeOnly || TREE_HINT.test(objectDescriptor(object));
  }

  function focusWorld(wx, wy) {
    return new deps.THREE.Vector3(
      wx / deps.TILE,
      deps.worldSurfaceY(wx, wy) + 0.45,
      wy / deps.TILE,
    );
  }

  function rebuild(wx, wy, combat) {
    const scene = deps.getActiveScene?.();
    if (!scene) {
      candidates = [];
      cachedScene = null;
      return;
    }
    scene.updateMatrixWorld?.(true);
    const focus = focusWorld(wx, wy);
    const radiusTiles = combat ? COMBAT_RADIUS_TILES : TREE_RADIUS_TILES;
    const radiusSq = (radiusTiles + 2) * (radiusTiles + 2);
    const treeOnly = !combat;
    const next = [];
    scene.traverse(object => {
      if (!isCandidateMesh(object, treeOnly)) return;
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
    cachedCombat = combat;
    cachedFocusX = wx;
    cachedFocusY = wy;
    cacheBuiltAt = performance.now();
    refreshCount++;
  }

  function ensureCandidates(wx, wy, requireCombat = false) {
    if (!deps) return false;
    const combat = !!deps.isCombatActive?.();
    if (requireCombat && !combat) return false;
    const scene = deps.getActiveScene?.();
    const movedPx = Math.hypot(wx - cachedFocusX, wy - cachedFocusY);
    if (scene !== cachedScene || combat !== cachedCombat || !Number.isFinite(movedPx) ||
        movedPx > CACHE_MOVE_TILES * deps.TILE || performance.now() - cacheBuiltAt > CACHE_MAX_AGE_MS) {
      rebuild(wx, wy, combat);
    }
    return true;
  }

  function raycast(origin, direction, far) {
    if (!candidates.length || far <= 0.0001) return null;
    testedRayCount++;
    raycaster.set(origin, direction);
    raycaster.near = 0.002;
    raycaster.far = far;
    const hits = raycaster.intersectObjects(candidates, false);
    return hits.find(hit => hit.distance <= far + 0.0001) || null;
  }

  function segmentHit(start, end, radiusWorld = 0) {
    if (!deps || !ensureCandidates(deps.player.x, deps.player.y, true)) return null;
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

  function canPlayerOccupy(wx, wy, radiusPx) {
    if (!deps || !ensureCandidates(wx, wy, false) || !candidates.length) return true;
    const center = focusWorld(wx, wy);
    const radiusWorld = Math.max(0.04, radiusPx / deps.TILE);
    const baseY = deps.worldSurfaceY(wx, wy);
    for (const height of MOVEMENT_HEIGHTS) {
      center.y = baseY + height;
      for (let index = 0; index < MOVEMENT_RAYS; index++) {
        const angle = index * Math.PI * 2 / MOVEMENT_RAYS;
        const direction = new deps.THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const hit = raycast(center, direction, radiusWorld);
        if (!hit) continue;
        lastBlock = {
          kind: cachedCombat ? 'combat movement' : 'tree movement',
          object: hit.object?.name || hit.object?.parent?.name || '(unnamed mesh)',
          distanceWorld: Number(hit.distance.toFixed(3)),
          at: performance.now(),
        };
        return false;
      }
    }
    return true;
  }

  function debugSnapshot() {
    return {
      mode: cachedCombat ? 'combat-all-volumes' : 'nearby-trees-only',
      candidates: candidates.length,
      radiusTiles: cachedCombat ? COMBAT_RADIUS_TILES : TREE_RADIUS_TILES,
      refreshCount,
      testedRayCount,
      cacheAgeMs: cacheBuiltAt ? Math.round(performance.now() - cacheBuiltAt) : null,
      lastBlock: lastBlock ? { ...lastBlock, ageMs: Math.round(performance.now() - lastBlock.at) } : null,
    };
  }

  window.NearbyVolumeCollision = {
    init,
    invalidate,
    segmentHit,
    canPlayerOccupy,
    debugSnapshot,
    constants: { COMBAT_RADIUS_TILES, TREE_RADIUS_TILES, CACHE_MOVE_TILES, CACHE_MAX_AGE_MS },
  };
})();
