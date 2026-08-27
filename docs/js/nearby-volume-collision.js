// Cheap combat projectile cover using authored object height/footprint metadata only.
(() => {
  'use strict';

  const SPATIAL_CELL_TILES = 2; // Buckets static cover so each projectile only checks nearby semantic objects.
  const TREE_HALF_TILE = 0.5; // Native tree trunks already occupy one centered solid tile.
  const HEAD_CACHE_MS = 50; // Reuse the portrait-derived player head clearance across projectiles in the same few frames.
  const HEIGHT_EPSILON = 0.01;
  const EXPLICIT_HEIGHT_FIELDS = ['projectileCoverHeightTiles', 'coverHeightTiles', 'heightTiles'];
  const EXPLICIT_RADIUS_FIELDS = ['projectileCoverRadiusTiles', 'coverRadiusTiles', 'footprintRadiusTiles'];

  let deps = null;
  let cachedScene = null;
  let cachedCombat = false;
  let candidates = [];
  let spatial = new Map();
  let refreshCount = 0;
  let lastSegmentCandidateCount = 0;
  let maxSegmentCandidateCount = 0;
  let lastSegmentMs = 0;
  let maxSegmentMs = 0;
  let lastRebuildMs = 0;
  let lastBlock = null;
  let playerHeadCache = { at: -Infinity, value: 1 };
  let options = { enabled: true, projectiles: true, textureAlpha: false }; // Legacy alpha option is permanently ignored; there is no texture sampling path.

  const proceduralRecipeBounds = new Map(); // Cached once per furniture key; recipes are expressed in tile-relative authored units.
  const authoredRecipeBounds = new Map(); // Cached once per authored furniture key from its runtime part metadata.

  function init(injectedDeps) {
    deps = injectedDeps;
    options = { ...options, ...(injectedDeps.options || {}), textureAlpha: false };
    invalidate();
    deps.debugLog?.('Nearby cover: height-only semantic projectile cover enabled; mesh, UV, triangle, and raycast collision are disabled.');
  }

  function setOptions(next = {}) {
    options = { ...options, ...next, textureAlpha: false };
    return { ...options };
  }

  function invalidate() {
    cachedScene = null;
    cachedCombat = false;
    candidates = [];
    spatial = new Map();
    playerHeadCache = { at: -Infinity, value: playerHeadCache.value || 1 };
  }

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positive(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
  }

  function partExtents(part) {
    const transform = part?.transform || {};
    let sx = Math.abs(finite(transform.sx, 0));
    let sy = Math.abs(finite(transform.sy, 0));
    let sz = Math.abs(finite(transform.sz, 0));
    if (part?.kind === 'sphere') {
      const diameter = Math.max(sx, sy, sz);
      sx = sy = sz = diameter;
    }
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const rx = finite(transform.rx) * Math.PI / 180;
    const ry = finite(transform.ry) * Math.PI / 180;
    const rz = finite(transform.rz) * Math.PI / 180;
    const a = Math.cos(rx), b = Math.sin(rx);
    const c = Math.cos(ry), d = Math.sin(ry);
    const e = Math.cos(rz), f = Math.sin(rz);
    const ae = a * e, af = a * f, be = b * e, bf = b * f;
    const m00 = c * e, m01 = -c * f, m02 = d;
    const m10 = af + be * d, m11 = ae - bf * d, m12 = -b * c;
    const m20 = bf - ae * d, m21 = be + af * d, m22 = a * c;
    return {
      x: Math.abs(m00) * hx + Math.abs(m01) * hy + Math.abs(m02) * hz,
      y: Math.abs(m10) * hx + Math.abs(m11) * hy + Math.abs(m12) * hz,
      z: Math.abs(m20) * hx + Math.abs(m21) * hy + Math.abs(m22) * hz,
    };
  }

  function boundsFromParts(parts) {
    if (!parts?.length) return null;
    let topTiles = 0;
    let radiusTiles = 0;
    let valid = false;
    for (const part of parts) {
      const transform = part?.transform;
      if (!transform) continue;
      const extents = partExtents(part);
      const x = finite(transform.x), y = finite(transform.y), z = finite(transform.z);
      topTiles = Math.max(topTiles, y + extents.y);
      radiusTiles = Math.max(radiusTiles, Math.hypot(x, z) + Math.hypot(extents.x, extents.z));
      valid = true;
    }
    if (!valid || !(topTiles > 0)) return null;
    return {
      heightTiles: topTiles,
      radiusTiles: Math.max(0.08, radiusTiles),
    };
  }

  function proceduralFurnitureBounds(node) {
    const prefix = 'procedural_furniture_';
    if (!node?.name?.startsWith(prefix)) return null;
    const key = node.name.slice(prefix.length);
    if (!key) return null;
    if (!proceduralRecipeBounds.has(key)) {
      proceduralRecipeBounds.set(key, boundsFromParts(window.ProceduralFurniture?.CATALOG?.[key]) || null);
    }
    const bounds = proceduralRecipeBounds.get(key);
    return bounds ? { ...bounds, kind: 'furniture', key, source: 'procedural-recipe' } : null;
  }

  function authoredFurnitureBoundsFor(node) {
    const key = node?.userData?.authoredFurnitureKey;
    if (!key) return null;
    if (!authoredRecipeBounds.has(key)) {
      const partById = node.userData?.partById;
      const parts = partById instanceof Map ? [...partById.values()] : [];
      authoredRecipeBounds.set(key, boundsFromParts(parts) || null);
    }
    const bounds = authoredRecipeBounds.get(key);
    return bounds ? { ...bounds, kind: 'furniture', key, source: 'authored-parts' } : null;
  }

  function explicitCoverBounds(node) {
    const data = node?.userData || {};
    let heightTiles = null;
    for (const field of EXPLICIT_HEIGHT_FIELDS) {
      heightTiles = positive(data[field]);
      if (heightTiles != null) break;
    }
    if (heightTiles == null) return null;
    let radiusTiles = null;
    for (const field of EXPLICIT_RADIUS_FIELDS) {
      radiusTiles = positive(data[field]);
      if (radiusTiles != null) break;
    }
    if (radiusTiles == null) {
      const width = positive(data.coverWidthTiles ?? data.widthTiles);
      const depth = positive(data.coverDepthTiles ?? data.depthTiles);
      if (width != null || depth != null) radiusTiles = Math.hypot((width || depth || 0.5) * 0.5, (depth || width || 0.5) * 0.5);
    }
    return {
      heightTiles,
      radiusTiles: Math.max(0.08, radiusTiles || 0.5),
      kind: data.projectileCoverKind || data.kind || data.type || 'object',
      key: data.furnitureKey || data.objectType || node.name || '(semantic cover)',
      source: 'explicit-metadata',
    };
  }

  function semanticCoverFor(node) {
    if (!node || node.visible === false) return null;
    const data = node.userData || {};
    if (data.actor || data.creature || data.isPlayerAvatar || Number.isFinite(data.portraitModelHeight)) return null;
    if (data.projectileCoverUsesTile) {
      return {
        kind: 'tree',
        key: node.name || 'tree',
        source: 'solid-tree-tile',
        heightTiles: Infinity,
        halfTileX: TREE_HALF_TILE,
        halfTileZ: TREE_HALF_TILE,
      };
    }
    return authoredFurnitureBoundsFor(node) || proceduralFurnitureBounds(node) || explicitCoverBounds(node);
  }

  function transformSnapshot(node) {
    const elements = node?.matrixWorld?.elements;
    if (elements?.length >= 16) {
      return {
        x: finite(elements[12]),
        z: finite(elements[14]),
        sx: Math.hypot(elements[0], elements[1], elements[2]) || 1,
        sy: Math.hypot(elements[4], elements[5], elements[6]) || 1,
        sz: Math.hypot(elements[8], elements[9], elements[10]) || 1,
      };
    }
    return {
      x: finite(node?.position?.x),
      z: finite(node?.position?.z),
      sx: Math.abs(finite(node?.scale?.x, 1)) || 1,
      sy: Math.abs(finite(node?.scale?.y, 1)) || 1,
      sz: Math.abs(finite(node?.scale?.z, 1)) || 1,
    };
  }

  function candidateFrom(node, semantic) {
    const transform = transformSnapshot(node);
    const heightWorld = semantic.heightTiles === Infinity ? Infinity : semantic.heightTiles * Math.abs(transform.sy);
    if (!(heightWorld > 0)) return null;
    // Rooted at the real terrain surface under the object, not tile-local
    // y=0 — a footprint sat on elevated ground gets its cover span anchored
    // where it actually stands. topY === Infinity for tile-cover trees
    // (their trunk is solid the entire authored height and beyond); every
    // other candidate gets a real, finite top so a shot arcing above it
    // (e.g. toward a player up a tree) is free to clear it instead of
    // being blocked by an object nowhere near that height.
    const bottomY = finite(deps?.worldSurfaceY?.(transform.x * (deps.TILE || 1), transform.z * (deps.TILE || 1)), 0);
    const topY = heightWorld === Infinity ? Infinity : bottomY + heightWorld;
    if (semantic.halfTileX != null || semantic.halfTileZ != null) {
      return {
        node,
        kind: semantic.kind,
        key: semantic.key,
        source: semantic.source,
        x: transform.x,
        z: transform.z,
        heightWorld,
        bottomY,
        topY,
        shape: 'aabb',
        halfX: Math.max(0.02, finite(semantic.halfTileX, 0.5) * Math.abs(transform.sx)),
        halfZ: Math.max(0.02, finite(semantic.halfTileZ, 0.5) * Math.abs(transform.sz)),
      };
    }
    return {
      node,
      kind: semantic.kind,
      key: semantic.key,
      source: semantic.source,
      x: transform.x,
      z: transform.z,
      heightWorld,
      bottomY,
      topY,
      shape: 'circle',
      radius: Math.max(0.02, semantic.radiusTiles * Math.max(Math.abs(transform.sx), Math.abs(transform.sz))),
    };
  }

  function indexCandidate(candidate) {
    candidates.push(candidate);
    const radiusX = candidate.shape === 'aabb' ? candidate.halfX : candidate.radius;
    const radiusZ = candidate.shape === 'aabb' ? candidate.halfZ : candidate.radius;
    const minCellX = Math.floor((candidate.x - radiusX) / SPATIAL_CELL_TILES);
    const maxCellX = Math.floor((candidate.x + radiusX) / SPATIAL_CELL_TILES);
    const minCellZ = Math.floor((candidate.z - radiusZ) / SPATIAL_CELL_TILES);
    const maxCellZ = Math.floor((candidate.z + radiusZ) / SPATIAL_CELL_TILES);
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        const key = `${cx},${cz}`;
        let bucket = spatial.get(key);
        if (!bucket) spatial.set(key, bucket = []);
        bucket.push(candidate);
      }
    }
  }

  function rebuild() {
    const startedAt = performance.now();
    const scene = deps?.getActiveScene?.();
    candidates = [];
    spatial = new Map();
    cachedScene = scene || null;
    if (!scene) {
      lastRebuildMs = Number((performance.now() - startedAt).toFixed(2));
      return;
    }

    const stack = [...(scene.children || [])];
    while (stack.length) {
      const node = stack.pop();
      if (!node || node.visible === false) continue;
      const semantic = semanticCoverFor(node);
      if (semantic) {
        const candidate = candidateFrom(node, semantic);
        if (candidate) indexCandidate(candidate);
        continue;
      }
      const children = node.children;
      if (children?.length) for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
    refreshCount++;
    lastRebuildMs = Number((performance.now() - startedAt).toFixed(2));
  }

  function ensureCandidates() {
    if (!deps || !options.enabled || !options.projectiles) return false;
    const combat = !!deps.isCombatActive?.();
    if (!combat) {
      cachedCombat = false;
      return false;
    }
    const scene = deps.getActiveScene?.();
    if (scene !== cachedScene || !cachedCombat) rebuild();
    cachedCombat = true;
    return true;
  }

  function playerHeadClearanceWorld() {
    const now = performance.now();
    if (now - playerHeadCache.at < HEAD_CACHE_MS && playerHeadCache.value > 0) return playerHeadCache.value;
    const ground = deps?.worldSurfaceY?.(deps.player.x, deps.player.y);
    const hitbox = window.RangedWeapons?.actorHitbox?.(deps.player);
    const headY = hitbox?.box?.max?.y;
    let clearance = Number.isFinite(headY) && Number.isFinite(ground) ? headY - ground : NaN;
    if (!(clearance > 0)) {
      const portraitHeight = positive(hitbox?.height, hitbox?.portraitHeight);
      clearance = portraitHeight || playerHeadCache.value || 1;
    }
    playerHeadCache = { at: now, value: Math.max(0.1, clearance) };
    return playerHeadCache.value;
  }

  function querySegmentCandidates(start, end, projectileRadius) {
    const minX = Math.min(start.x, end.x) - projectileRadius;
    const maxX = Math.max(start.x, end.x) + projectileRadius;
    const minZ = Math.min(start.z, end.z) - projectileRadius;
    const maxZ = Math.max(start.z, end.z) + projectileRadius;
    const minCellX = Math.floor(minX / SPATIAL_CELL_TILES);
    const maxCellX = Math.floor(maxX / SPATIAL_CELL_TILES);
    const minCellZ = Math.floor(minZ / SPATIAL_CELL_TILES);
    const maxCellZ = Math.floor(maxZ / SPATIAL_CELL_TILES);
    const found = [];
    const seen = new Set();
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        for (const candidate of spatial.get(`${cx},${cz}`) || []) {
          if (seen.has(candidate)) continue;
          seen.add(candidate);
          found.push(candidate);
        }
      }
    }
    return found;
  }

  function segmentCircleEntry(start, end, x, z, radius) {
    const dx = end.x - start.x, dz = end.z - start.z;
    const fx = start.x - x, fz = start.z - z;
    const a = dx * dx + dz * dz;
    if (a <= 1e-10) return null;
    const b = 2 * (fx * dx + fz * dz);
    const c = fx * fx + fz * fz - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const t0 = (-b - root) / (2 * a);
    const t1 = (-b + root) / (2 * a);
    if (t1 < 0 || t0 > 1) return null;
    return { enter: Math.max(0, t0), exit: Math.min(1, t1) };
  }

  function segmentAabbEntry(start, end, minX, maxX, minZ, maxZ) {
    let enter = 0, exit = 1;
    for (const [s, e, min, max] of [[start.x, end.x, minX, maxX], [start.z, end.z, minZ, maxZ]]) {
      const delta = e - s;
      if (Math.abs(delta) < 1e-10) {
        if (s < min || s > max) return null;
        continue;
      }
      let a = (min - s) / delta;
      let b = (max - s) / delta;
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, b);
      if (enter > exit) return null;
    }
    return exit >= 0 && enter <= 1 ? { enter: Math.max(0, enter), exit: Math.min(1, exit) } : null;
  }

  // Clips an already-found horizontal (X/Z) entry/exit range down to the
  // sub-range where the segment's own Y also sits within [minY, maxY] — the
  // real per-shot vertical intersection this cover system was missing. A
  // fence that only reaches ankle height no longer blocks a shot arcing
  // toward a player up a tree just because its footprint happens to be in
  // the way; only cover whose actual vertical span the ray passes through
  // still counts. Cheap: one more linear range clip per candidate already
  // being tested, no new per-frame data structures.
  function clipRangeByY(start, end, range, minY, maxY) {
    if (!range) return null;
    if (minY === -Infinity && maxY === Infinity) return range;
    const deltaY = end.y - start.y;
    if (Math.abs(deltaY) < 1e-10) {
      return start.y >= minY && start.y <= maxY ? range : null;
    }
    let a = (minY - start.y) / deltaY;
    let b = (maxY - start.y) / deltaY;
    if (a > b) [a, b] = [b, a];
    const enter = Math.max(range.enter, a);
    const exit = Math.min(range.exit, b);
    return enter <= exit ? { enter: Math.max(0, enter), exit: Math.min(1, exit) } : null;
  }

  function candidateEntry(candidate, start, end, projectileRadius) {
    const horizontal = candidate.shape === 'aabb'
      ? segmentAabbEntry(
        start,
        end,
        candidate.x - candidate.halfX - projectileRadius,
        candidate.x + candidate.halfX + projectileRadius,
        candidate.z - candidate.halfZ - projectileRadius,
        candidate.z + candidate.halfZ + projectileRadius,
      )
      : segmentCircleEntry(start, end, candidate.x, candidate.z, candidate.radius + projectileRadius);
    const vertical = clipRangeByY(start, end, horizontal, candidate.bottomY - projectileRadius - HEIGHT_EPSILON, candidate.topY + projectileRadius + HEIGHT_EPSILON);
    return vertical ? vertical.enter : null;
  }

  function segmentHit(start, end, radiusWorld = 0) {
    if (!deps || !ensureCandidates()) return null;
    const startedAt = performance.now();
    const projectileRadius = Math.max(0, finite(radiusWorld));
    const nearby = querySegmentCandidates(start, end, projectileRadius);
    lastSegmentCandidateCount = nearby.length;
    maxSegmentCandidateCount = Math.max(maxSegmentCandidateCount, nearby.length);

    let nearest = null;
    for (const candidate of nearby) {
      if (candidate.node?.visible === false || !candidate.node?.parent) continue;
      const t = candidateEntry(candidate, start, end, projectileRadius);
      if (t == null || (nearest && t >= nearest.t)) continue;
      nearest = { candidate, t };
    }

    lastSegmentMs = Number((performance.now() - startedAt).toFixed(3));
    maxSegmentMs = Math.max(maxSegmentMs, lastSegmentMs);
    if (!nearest) return null;

    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const distanceWorld = nearest.t * length;
    const candidate = nearest.candidate;
    lastBlock = {
      kind: candidate.kind || 'object',
      object: candidate.key || candidate.node?.name || '(semantic cover)',
      source: candidate.source,
      heightWorld: candidate.heightWorld === Infinity ? 'inf' : Number(candidate.heightWorld.toFixed(3)),
      headClearanceWorld: Number(playerHeadClearanceWorld().toFixed(3)),
      distanceWorld: Number(distanceWorld.toFixed(3)),
      at: performance.now(),
    };
    return {
      t: nearest.t,
      distanceWorld,
      object: candidate.node,
      kind: candidate.kind,
      key: candidate.key,
      point: start.clone?.().lerp ? start.clone().lerp(end, nearest.t) : null,
    };
  }

  function debugSnapshot() {
    return {
      mode: deps?.isCombatActive?.() ? 'combat-height-cover' : 'inactive',
      algorithm: 'semantic-height',
      candidates: candidates.length,
      spatialCells: spatial.size,
      radiusTiles: null,
      refreshCount,
      testedRayCount: 0,
      skippedLeafCardCount: 0,
      skippedTileCoverCount: 0,
      lastSegmentCandidateCount,
      maxSegmentCandidateCount,
      lastSegmentMs,
      maxSegmentMs: Number(maxSegmentMs.toFixed(3)),
      lastRebuildMs,
      cacheAgeMs: null,
      playerHeadClearanceWorld: deps ? Number(playerHeadClearanceWorld().toFixed(3)) : null,
      options: { ...options, textureAlphaIgnored: true },
      lastBlock: lastBlock ? { ...lastBlock, ageMs: Math.round(performance.now() - lastBlock.at) } : null,
    };
  }

  window.NearbyVolumeCollision = {
    init,
    setOptions,
    invalidate,
    segmentHit,
    debugSnapshot,
    constants: { SPATIAL_CELL_TILES, TREE_HALF_TILE, HEAD_CACHE_MS },
  };
})();
