(() => {
  'use strict';

  // Grass billboard tufts for a wilderness zone (mirrors the farm/town
  // grass billboard builders, sized to each zone's own grid) and rich
  // foliage patches' own tightly-packed, tall billboard clusters. Both obey
  // the Settings > Grass toggle so it is a truthful visual/performance switch.
  // Extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern as its sibling systems, alongside js/zone-plateau-mesa.js,
  // js/zone-terrain-features.js, and js/zone-den-totem-features.js.
  let deps = null;
  function init(injectedDeps) {
    deps = injectedDeps;
    window.GrassPlayerResponse?.init(injectedDeps);
  }

  // A single whole-zone InstancedMesh cannot be usefully frustum-culled while
  // the camera is standing inside the zone. Wilderness maps are much larger
  // than town and ordinary grass uses 28 crossed-blade instances PER grass
  // tile, so submitting one giant always-visible mesh made off-screen grass a
  // large steady-state GPU cost. Keep the exact same instance density and
  // placement, but split it into spatial chunks whose manually-authored
  // bounds cover their instance matrices. Three r128 can then frustum-cull
  // whole off-screen chunks without any per-frame JS visibility loop.
  const GRASS_CHUNK_TILES = 12;
  const GRASS_INSTANCE_CAPACITY_PER_TILE = 28;
  const RICH_BLADES_PER_TILE = 24;
  const BILLBOARD_VERTICAL_PAD = 1.5;

  function normalizedBounds(zcols, zrows, bounds) {
    return {
      colStart: Math.max(0, Math.floor(bounds?.colStart ?? 0)),
      rowStart: Math.max(0, Math.floor(bounds?.rowStart ?? 0)),
      colEnd: Math.min(zcols, Math.ceil(bounds?.colEnd ?? zcols)),
      rowEnd: Math.min(zrows, Math.ceil(bounds?.rowEnd ?? zrows)),
    };
  }

  function chunkBoundsGeometry(minCol, minRow, maxCol, maxRow, minBaseY, maxBaseY) {
    const geo = deps.grassBladeGeo.clone();
    const minX = minCol - 0.25;
    const maxX = maxCol + 1.25;
    const minZ = minRow - 0.25;
    const maxZ = maxRow + 1.25;
    const minY = minBaseY - 0.25;
    const maxY = maxBaseY + BILLBOARD_VERTICAL_PAD;
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ)
    );
    const center = geo.boundingBox.getCenter(new THREE.Vector3());
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    geo.boundingSphere = new THREE.Sphere(center, size.length() * 0.5);
    return geo;
  }

  function chunkTileBuckets(tiles) {
    const buckets = new Map();
    for (const tile of tiles) {
      const chunkCol = Math.floor(tile.col / GRASS_CHUNK_TILES);
      const chunkRow = Math.floor(tile.row / GRASS_CHUNK_TILES);
      const key = `${chunkCol},${chunkRow}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(tile);
    }
    return buckets;
  }

  function makeChunkMesh(material, tiles, capacityPerTile, fillTile) {
    if (!tiles.length) return null;
    let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
    let minBaseY = Infinity, maxBaseY = -Infinity;
    for (const tile of tiles) {
      minCol = Math.min(minCol, tile.col); maxCol = Math.max(maxCol, tile.col);
      minRow = Math.min(minRow, tile.row); maxRow = Math.max(maxRow, tile.row);
      minBaseY = Math.min(minBaseY, tile.baseY); maxBaseY = Math.max(maxBaseY, tile.baseY);
    }

    const geo = chunkBoundsGeometry(minCol, minRow, maxCol, maxRow, minBaseY, maxBaseY);
    const mesh = new THREE.InstancedMesh(geo, material, tiles.length * capacityPerTile);
    mesh.frustumCulled = true;
    mesh.visible = true;
    mesh.userData.isBillboard = true;
    mesh.userData.isWildernessGrassChunk = true;
    mesh.userData.wildernessChunkOwnsGeometry = true;
    mesh.userData.skipOcclusionFade = true;
    // Used by game.js's zone culler to reject entire grass chunks before draw submission.
    const bounds = geo.boundingBox;
    mesh.userData.cullSphere = {
      x: geo.boundingSphere.center.x,
      z: geo.boundingSphere.center.z,
      radius: geo.boundingSphere.radius,
      xzRadius: Math.hypot(
        (bounds.max.x - bounds.min.x) * 0.5,
        (bounds.max.z - bounds.min.z) * 0.5
      ),
    };
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (const tile of tiles) idx = fillTile(mesh, dummy, idx, tile);
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function buildZoneGrassBillboards(zScene, zGrid, zcols, zrows, zoneBaseElev = 0, bounds = null) {
    const grassBillboardMat = deps.getGrassBillboardMat();
    if (!grassBillboardMat) return null;

    const range = normalizedBounds(zcols, zrows, bounds);
    const tiles = [];
    for (let row = range.rowStart; row < range.rowEnd; row++) {
      for (let col = range.colStart; col < range.colEnd; col++) {
        const tile = zGrid[row]?.[col];
        if (tile?.type !== deps.TileType.GRASS) continue;
        const tierY = (tile.elevTier || 0) * deps.PLATEAU_UNIT;
        tiles.push({
          col,
          row,
          yOffset: zoneBaseElev + tierY,
          baseY: deps.tileSurfaceY(deps.TileType.GRASS) + zoneBaseElev + tierY,
        });
      }
    }
    if (!tiles.length) return null;

    const group = new THREE.Group();
    group.visible = deps.getGrassEnabled();
    group.userData.isBillboard = true;
    group.userData.isWildernessGrassChunkGroup = true;
    group.userData.wildernessChunkBounds = range;
    let instances = 0;
    const buckets = chunkTileBuckets(tiles);
    for (const bucketTiles of buckets.values()) {
      const mesh = makeChunkMesh(
        grassBillboardMat,
        bucketTiles,
        GRASS_INSTANCE_CAPACITY_PER_TILE,
        (chunkMesh, dummy, idx, tile) => deps.fillBillboardInstances(
          chunkMesh, dummy, idx, tile.col, tile.row, 1.0, tile.yOffset
        )
      );
      if (!mesh) continue;
      instances += mesh.count;
      group.add(mesh);
    }
    zScene.add(group);
    window.__farmLog?.(`[wilderness] grass: ${tiles.length} tile(s), ${instances} blade-plane instance(s), ${group.children.length} frustum-cullable ${GRASS_CHUNK_TILES}x${GRASS_CHUNK_TILES} chunk(s)`, 'info');
    return group;
  }

  // Rich foliage patches (see workspace.foliagePatches' `rich` flag —
  // the dense copse clusters the wildlife schedule AI's herbivores graze
  // in and predators patrol near) get their own tightly-packed, tall
  // billboard cluster instead of blending into the zone's ordinary grass
  // tufts. It remains visually distinct as a landmark, but obeys the same
  // Settings > Grass toggle so disabling grass removes every grass draw.
  // Reuses the same blade
  // geometry/shader as ordinary grass — the visual distinction is
  // entirely density (more blades, tighter spread) and height (roughly
  // 2x), not a texture/color swap.
  function fillDenseTallBillboardInstances(mesh, dummy, startIdx, col, row, yOffset = 0) {
    const rand = deps.mbRng(((col * 31337 + row * 1009) >>> 0) ^ 0x9e3779b9);
    const baseY = deps.tileSurfaceY(deps.TileType.GRASS) + yOffset;
    let idx = startIdx;
    const BLADES = RICH_BLADES_PER_TILE;
    for (let b = 0; b < BLADES; b++) {
      const ox = (rand() - 0.5) * 0.55; // tighter spread than the normal ±0.45 tile so blades overlap into a clump
      const oz = (rand() - 0.5) * 0.55;
      const w  = 0.16 + rand() * 0.10; // width matches ordinary grass
      const h  = 0.48 + rand() * 0.26; // roughly 2x a normal blade's height
      const rot = rand() * Math.PI;
      const px = col + 0.5 + ox, pz = row + 0.5 + oz;
      dummy.position.set(px, baseY, pz);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.set(w, h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
      dummy.rotation.set(0, rot + Math.PI * 0.5, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    }
    return idx;
  }

  function buildRichFoliageBillboards(zScene, zoneData, zGrid, zoneBaseElev = 0, bounds = null) {
    const grassBillboardMat = deps.getGrassBillboardMat();
    if (!grassBillboardMat) return null;
    const richPatches = (zoneData?.foliagePatches || []).filter(p => p.rich);
    if (!richPatches.length) return null;

    const zrows = zGrid?.length || 0;
    const zcols = zGrid?.[0]?.length || 0;
    const range = normalizedBounds(zcols, zrows, bounds);
    const tiles = [];
    for (const patch of richPatches) {
      for (const t of patch.tiles) {
        if (t.x < range.colStart || t.x >= range.colEnd || t.y < range.rowStart || t.y >= range.rowEnd) continue;
        const liveTile = zGrid?.[t.y]?.[t.x]; // Used to suppress stale rich-patch grass after runtime terrain edits.
        if (!liveTile || ![deps.TileType.GRASS, deps.TileType.SHRUB, deps.TileType.WEEDS].includes(liveTile.type)) continue;
        const tierY = (liveTile.elevTier || 0) * deps.PLATEAU_UNIT;
        tiles.push({
          col: t.x,
          row: t.y,
          yOffset: zoneBaseElev + tierY,
          baseY: deps.tileSurfaceY(deps.TileType.GRASS) + zoneBaseElev + tierY,
        });
      }
    }
    if (!tiles.length) return null;

    const group = new THREE.Group();
    group.visible = deps.getGrassEnabled();
    group.userData.isRichFoliageBillboard = true;
    group.userData.wildernessChunkBounds = range;
    let instances = 0;
    const buckets = chunkTileBuckets(tiles);
    for (const bucketTiles of buckets.values()) {
      const mesh = makeChunkMesh(
        grassBillboardMat,
        bucketTiles,
        RICH_BLADES_PER_TILE * 2,
        (chunkMesh, dummy, idx, tile) => fillDenseTallBillboardInstances(
          chunkMesh, dummy, idx, tile.col, tile.row, tile.yOffset
        )
      );
      if (!mesh) continue;
      mesh.userData.isRichFoliageBillboard = true;
      instances += mesh.count;
      group.add(mesh);
    }
    zScene.add(group);
    window.__farmLog?.(`[wilderness] rich foliage: ${tiles.length} tile(s), ${instances} blade-plane instance(s), ${group.children.length} frustum-cullable chunk(s)`, 'info');
    return group;
  }

  window.ZoneGrassBillboards = {
    init,
    buildZoneGrassBillboards,
    buildRichFoliageBillboards,
  };
})();

// Live player-to-grass response. This is deliberately isolated from grass
// generation: builders keep owning density/culling, while this module only
// adjusts nearby instance Y scales and restores them as the player leaves.
(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof THREE === 'undefined') return;

  let runtimeDeps = null; // Latest injected game deps; used to refresh player/renderer references on re-init.
  let playerMesh = null; // Current player root; its world X/Z position drives the response field.
  let renderer = null; // Active WebGL renderer; wrapped once so response updates happen immediately before drawing.
  let frameUpdated = false; // Per-browser-frame gate; prevents duplicate work across post-process render passes.
  let lastUpdateMs = 0; // Timestamp of the previous real response update; used to make lerping frame-rate independent.
  let lastDebug = null; // Most recent counters; exposed through debugSnapshot() for mobile-visible diagnostics.
  let loggedError = false; // One-shot guard; keeps a bad instance from spamming the in-game/browser log every frame.

  const meshRegistry = new Map(); // Instanced grass mesh -> spatial/index metadata, reused until that mesh is rebuilt.
  const sceneRegistry = new WeakMap(); // Scene -> responsive mesh metadata set, so only the rendered scene is touched.
  const matrix = new THREE.Matrix4(); // Scratch transform used when reading/writing one grass instance matrix.
  const position = new THREE.Vector3(); // Scratch local instance position used for bucket indexing and matrix writes.
  const quaternion = new THREE.Quaternion(); // Scratch instance rotation preserved while only Y scale changes.
  const scale = new THREE.Vector3(); // Scratch instance scale; X/Z are preserved and Y receives the response factor.
  const worldPosition = new THREE.Vector3(); // Scratch world point used to compare each blade against player world X/Z.
  const RESPONSE_EPSILON = 0.001; // Completion tolerance used to stop tracking fully regrown blades.

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function config() {
    const raw = window.HOBUNJI_CONFIG?.grassPlayerResponse || {}; // Authored tuning source; read live for debug/edit reloads.
    const innerRadiusTiles = Math.max(0, Number(raw.innerRadiusTiles) || 0); // Fully flattened radius in tile units.
    const requestedOuterRadius = Number(raw.outerRadiusTiles); // Raw transition-edge radius before ordering validation.
    const outerRadiusTiles = Math.max(innerRadiusTiles, Number.isFinite(requestedOuterRadius) ? requestedOuterRadius : innerRadiusTiles); // Normal-height edge radius.
    const rawMinimumScale = Number(raw.minimumYScale); // Raw authored minimum, sanitized before matrix use.
    const minimumYScale = clamp(Number.isFinite(rawMinimumScale) ? rawMinimumScale : 0, 0, 1); // Smallest allowed blade-height fraction.
    const flattenLerpRate = Math.max(0.01, Number(raw.flattenLerpRate) || 8); // Exponential shortening rate while target height decreases.
    const regrowLerpRate = Math.max(0.01, Number(raw.regrowLerpRate) || 3.5); // Exponential recovery rate while target height increases.
    const discoveryIntervalSeconds = Math.max(0.05, Number(raw.discoveryIntervalSeconds) || 0.5); // Scene-rescan cadence for streamed/rebuilt grass.
    return {
      enabled: raw.enabled !== false,
      innerRadiusTiles,
      outerRadiusTiles,
      minimumYScale,
      flattenLerpRate,
      regrowLerpRate,
      discoveryIntervalSeconds,
    };
  }

  function targetYScaleAtDistance(distance, cfg = config()) {
    const safeDistance = Math.max(0, Number(distance) || 0); // Sanitized radial distance used for the response curve.
    if (safeDistance <= cfg.innerRadiusTiles) return cfg.minimumYScale;
    if (safeDistance >= cfg.outerRadiusTiles) return 1;
    const span = cfg.outerRadiusTiles - cfg.innerRadiusTiles; // Width of the authored transition annulus.
    if (span <= 1e-6) return 1;
    const linearT = clamp((safeDistance - cfg.innerRadiusTiles) / span, 0, 1); // 0..1 position across the transition annulus.
    const smoothT = linearT * linearT * (3 - 2 * linearT); // Smoothstep avoids a visible slope kink at either configured radius.
    return cfg.minimumYScale + (1 - cfg.minimumYScale) * smoothT;
  }

  function grassMaterialMatches(mesh) {
    const canonicalMaterial = window.VegetationCropRendering?.getGrassBillboardMat?.(); // Shared normal grass shader when available.
    if (canonicalMaterial && mesh.material === canonicalMaterial) return true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; // Material list handles future multi-material instanced grass safely.
    return materials.some(material => material?.isShaderMaterial && material.uniforms?.uGrassTex && material.uniforms?.uDensity);
  }

  function isResponsiveGrassMesh(mesh) {
    return !!(mesh?.isInstancedMesh && mesh.instanceMatrix && mesh.count > 0 && grassMaterialMatches(mesh));
  }

  function meshSignature(mesh) {
    const count = Math.max(0, mesh.count | 0); // Current live instance count; part of the rebuild signature.
    if (!count) return '0';
    const sampleCount = Math.min(7, count); // Small fixed sample catches most same-count refills without scanning the whole mesh.
    const parts = [String(count)]; // Signature pieces are only X/Z positions, so our own Y scaling cannot invalidate the index.
    for (let sample = 0; sample < sampleCount; sample++) {
      const index = sampleCount === 1 ? 0 : Math.round(sample * (count - 1) / (sampleCount - 1)); // Evenly distributed instance index used for refill detection.
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, quaternion, scale);
      parts.push(`${position.x.toFixed(3)},${position.z.toFixed(3)}`);
    }
    return parts.join('|');
  }

  function restoreOldActiveScales(meta) {
    const mesh = meta?.mesh; // Existing mesh whose active instances may still contain response-scaled matrices.
    if (!mesh?.instanceMatrix || !meta.active.size) return;
    let changed = false; // Tracks whether the GPU matrix buffer needs a final restore upload.
    for (const index of meta.active) {
      if (index < 0 || index >= mesh.count) continue;
      const factor = meta.factors[index]; // Last factor applied by this module at this instance index.
      if (!(factor < 1 - RESPONSE_EPSILON)) continue;
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, quaternion, scale);
      const baseYScale = meta.baseYScales[index]; // Authored uncompressed blade height captured when the index was built.
      const expectedScaledY = baseYScale * factor; // Value we expect if this matrix still contains our old response.
      const tolerance = Math.max(0.002, Math.abs(baseYScale) * 0.06); // Allows float drift without mistaking an external refill for our matrix.
      if (Math.abs(scale.y - expectedScaledY) > tolerance) continue;
      scale.y = baseYScale;
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  function buildMeshMeta(mesh, previousMeta = null) {
    if (previousMeta) restoreOldActiveScales(previousMeta);
    mesh.updateMatrixWorld?.(true);
    const count = Math.max(0, mesh.count | 0); // Number of live blade-plane instances represented by this metadata object.
    const baseYScales = new Float32Array(count); // Authored per-instance Y scales used as the absolute regrowth baseline.
    const factors = new Float32Array(count); // Current 0..1 response factor per instance; starts fully grown.
    const worldX = new Float32Array(count); // Cached world X positions used for radial distance tests without matrix decomposes every frame.
    const worldZ = new Float32Array(count); // Cached world Z positions used for radial distance tests without matrix decomposes every frame.
    const buckets = new Map(); // Tile-coordinate bucket -> instance indices, bounding per-frame work to the configured outer radius.
    const active = new Set(); // Instances below full height; kept until they finish regrowing even after leaving the radius.
    factors.fill(1);

    for (let index = 0; index < count; index++) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, quaternion, scale);
      baseYScales[index] = Math.max(0, Number(scale.y) || 0);
      worldPosition.copy(position).applyMatrix4(mesh.matrixWorld);
      worldX[index] = worldPosition.x;
      worldZ[index] = worldPosition.z;
      const bucketKey = `${Math.floor(worldPosition.x)},${Math.floor(worldPosition.z)}`; // One gameplay tile per bucket keeps lookup directly tied to configured tile radii.
      let indices = buckets.get(bucketKey); // Existing instance list for this world tile, if this is not its first blade.
      if (!indices) {
        indices = [];
        buckets.set(bucketKey, indices);
      }
      indices.push(index);
    }

    return {
      mesh,
      count,
      signature: meshSignature(mesh),
      baseYScales,
      factors,
      worldX,
      worldZ,
      buckets,
      active,
    };
  }

  function getSceneState(scene) {
    let state = sceneRegistry.get(scene); // Existing responsive-mesh set for this rendered scene.
    if (!state) {
      state = { metas: new Set(), lastDiscoveryMs: -Infinity };
      sceneRegistry.set(scene, state);
    }
    return state;
  }

  function discoverGrass(scene, nowMs, cfg) {
    const state = getSceneState(scene); // Per-scene cache updated only at the configured discovery cadence.
    if (nowMs - state.lastDiscoveryMs < cfg.discoveryIntervalSeconds * 1000) return state;
    state.lastDiscoveryMs = nowMs;

    scene.updateMatrixWorld?.(true);
    scene.traverse?.(object => {
      if (!isResponsiveGrassMesh(object)) return;
      const signature = meshSignature(object); // Cheap refill signature used before deciding whether to rebuild the spatial index.
      let meta = meshRegistry.get(object); // Existing spatial metadata for this exact InstancedMesh object.
      if (!meta || meta.count !== object.count || meta.signature !== signature) {
        meta = buildMeshMeta(object, meta || null);
        meshRegistry.set(object, meta);
      }
      state.metas.add(meta);
    });

    for (const meta of [...state.metas]) {
      if (meta.mesh?.parent && meshRegistry.get(meta.mesh) === meta) continue;
      state.metas.delete(meta);
      if (meshRegistry.get(meta.mesh) === meta) meshRegistry.delete(meta.mesh);
    }
    return state;
  }

  function applyFactor(meta, index, targetFactor, dtSeconds, cfg) {
    const mesh = meta.mesh; // Owning InstancedMesh whose one blade-plane matrix is being updated.
    const currentFactor = meta.factors[index]; // Last response factor applied to this blade-plane.
    const responseRate = targetFactor < currentFactor ? cfg.flattenLerpRate : cfg.regrowLerpRate; // Shortening and recovery have independently authored rates.
    const alpha = 1 - Math.exp(-responseRate * dtSeconds); // Frame-rate-independent exponential interpolation amount.
    let nextFactor = currentFactor + (targetFactor - currentFactor) * alpha; // New response factor before completion snapping.
    if (Math.abs(nextFactor - targetFactor) < RESPONSE_EPSILON) nextFactor = targetFactor;
    if (Math.abs(nextFactor - currentFactor) < 1e-5) return false;

    mesh.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale);
    let baseYScale = meta.baseYScales[index]; // Absolute authored Y scale that must never accumulate our own previous compression.
    const expectedScaledY = baseYScale * currentFactor; // Matrix Y scale expected if nobody else rewrote this instance since our last frame.
    const tolerance = Math.max(0.002, Math.abs(baseYScale) * 0.06); // Change threshold distinguishing float noise from an external matrix rewrite.
    if (currentFactor < 1 - RESPONSE_EPSILON && Math.abs(scale.y - baseYScale) <= tolerance) {
      // A terrain/grass refresh restored the natural scale while this blade was
      // still logically flattened. Keep the known base and simply reapply the
      // current response instead of treating that reset as a new authored size.
    } else if (currentFactor > 0.05 && Math.abs(scale.y - expectedScaledY) > tolerance) {
      const inferredBase = scale.y / currentFactor; // Updated authored scale inferred after an external non-response rescale.
      if (Number.isFinite(inferredBase) && inferredBase >= 0) {
        baseYScale = inferredBase;
        meta.baseYScales[index] = inferredBase;
      }
    }

    scale.y = baseYScale * nextFactor;
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    meta.factors[index] = nextFactor;
    if (nextFactor < 1 - RESPONSE_EPSILON) meta.active.add(index);
    else meta.active.delete(index);
    return true;
  }

  function updateMesh(meta, playerX, playerZ, dtSeconds, cfg) {
    if (!meta.mesh?.parent || !meta.count) return 0;
    const processed = new Set(); // Candidate indices handled from nearby spatial buckets this frame.
    const bucketRadius = Math.ceil(cfg.outerRadiusTiles) + 1; // Bucket search extent derived from, rather than hardcoded beside, the authored outer radius.
    const centerCol = Math.floor(playerX); // Player tile-space column used to select nearby world buckets.
    const centerRow = Math.floor(playerZ); // Player tile-space row used to select nearby world buckets.
    let changed = 0; // Number of instance matrices actually rewritten for this mesh this frame.

    for (let row = centerRow - bucketRadius; row <= centerRow + bucketRadius; row++) {
      for (let col = centerCol - bucketRadius; col <= centerCol + bucketRadius; col++) {
        const indices = meta.buckets.get(`${col},${row}`); // Grass blade-plane indices whose roots lie in this nearby tile bucket.
        if (!indices) continue;
        for (const index of indices) {
          const dx = meta.worldX[index] - playerX; // Horizontal X separation used for radial falloff.
          const dz = meta.worldZ[index] - playerZ; // Horizontal Z separation used for radial falloff.
          const distance = Math.hypot(dx, dz); // Euclidean player-to-root distance in gameplay tile/world units.
          const targetFactor = targetYScaleAtDistance(distance, cfg); // Configured minimum/transition/normal target for this root.
          if (targetFactor >= 1 - RESPONSE_EPSILON && !meta.active.has(index)) continue;
          processed.add(index);
          if (applyFactor(meta, index, targetFactor, dtSeconds, cfg)) changed++;
        }
      }
    }

    for (const index of [...meta.active]) {
      if (processed.has(index)) continue;
      if (applyFactor(meta, index, 1, dtSeconds, cfg)) changed++;
    }
    if (changed) meta.mesh.instanceMatrix.needsUpdate = true;
    return changed;
  }

  function updateScene(scene, nowMs = performance.now()) {
    if (!scene?.traverse || !playerMesh?.position) return;
    const cfg = config(); // Current authored response tuning used for this entire frame update.
    const state = discoverGrass(scene, nowMs, cfg); // Responsive grass meshes currently belonging to the rendered scene.
    if (!state.metas.size) return;
    if (frameUpdated) return;
    frameUpdated = true;
    const resetFrameGate = () => { frameUpdated = false; }; // Releases the once-per-frame guard after all render passes complete.
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(resetFrameGate);
    else setTimeout(resetFrameGate, 0);

    const rawDt = lastUpdateMs > 0 ? (nowMs - lastUpdateMs) / 1000 : 1 / 60; // Real elapsed time since the previous grass response frame.
    const dtSeconds = clamp(rawDt, 0, 0.1); // Large tab/background gaps are clamped so grass never pops across its interpolation.
    lastUpdateMs = nowMs;
    const playerX = Number(playerMesh.position.x) || 0; // Player world X used as the radial response center.
    const playerZ = Number(playerMesh.position.z) || 0; // Player world Z used as the radial response center.
    let changedInstances = 0; // Aggregate matrix-write count exposed to the debug snapshot.
    let activeInstances = 0; // Aggregate not-yet-regrown blade count exposed to the debug snapshot.

    for (const meta of [...state.metas]) {
      if (!meta.mesh?.parent) {
        state.metas.delete(meta);
        meshRegistry.delete(meta.mesh);
        continue;
      }
      changedInstances += updateMesh(meta, playerX, playerZ, dtSeconds, cfg.enabled ? cfg : { ...cfg, innerRadiusTiles: 0, outerRadiusTiles: 0, minimumYScale: 1 });
      activeInstances += meta.active.size;
    }

    lastDebug = {
      playerX,
      playerZ,
      meshCount: state.metas.size,
      activeInstances,
      changedInstances,
      config: cfg,
      timestampMs: nowMs,
    };
  }

  function installRendererHook(nextRenderer) {
    if (!nextRenderer || nextRenderer.__hobunjiGrassPlayerResponseHook) return;
    const originalRender = nextRenderer.render; // Render function already containing any earlier compatibility wrappers.
    if (typeof originalRender !== 'function') return;
    nextRenderer.render = function (...args) {
      try {
        updateScene(args[0]);
      } catch (error) {
        if (!loggedError) {
          loggedError = true;
          window.__farmLog?.(`Grass player response disabled after runtime error: ${error?.message || error}`, 'error');
          console.error('GrassPlayerResponse update failed', error);
        }
      }
      return originalRender.apply(this, args);
    };
    nextRenderer.__hobunjiGrassPlayerResponseHook = true;
  }

  function init(injectedDeps) {
    runtimeDeps = injectedDeps || runtimeDeps; // Retained for debug parity and future dependency extension without touching builders.
    playerMesh = injectedDeps?.playerMesh || playerMesh; // Player dependency refreshed whenever the parent grass system is reinitialized.
    renderer = injectedDeps?.renderer || renderer; // Renderer dependency refreshed whenever the parent grass system is reinitialized.
    installRendererHook(renderer);
  }

  function debugSnapshot() {
    return lastDebug ? { ...lastDebug } : {
      playerX: Number(playerMesh?.position?.x) || 0,
      playerZ: Number(playerMesh?.position?.z) || 0,
      meshCount: meshRegistry.size,
      activeInstances: [...meshRegistry.values()].reduce((sum, meta) => sum + meta.active.size, 0),
      changedInstances: 0,
      config: config(),
      timestampMs: performance.now(),
    };
  }

  window.GrassPlayerResponse = {
    init,
    updateScene,
    targetYScaleAtDistance,
    debugSnapshot,
  };
})();

// Town subtle-height followers for instanced ground cover and paved roads.
// Town grass is one InstancedMesh; paved roads are WallBuilder instance groups
// compacted by the path-corridor filter. Work at those real matrix boundaries.
(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof THREE === 'undefined') return;

  let townDeps = null;
  let roadRefreshQueued = false;
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const surfaceNormal = new THREE.Vector3(0, 1, 0);
  const slopeQuat = new THREE.Quaternion();
  const SLOPE_SAMPLE_OFFSET = 0.20;
  const ROAD_NEIGHBOR_MULTIPLIER = 1.58;
  const ROAD_SOLVER_ITERATIONS = 8;
  const ROAD_SOLVER_STRENGTH = 0.72;
  const ROAD_MIN_PROJECTED_SPACING = 0.08;

  function sampleTownHeight(x, z) {
    const fn = window.HobunjiTownSubtleElevation?.sampleHeightAt;
    return typeof fn === 'function' ? (Number(fn(x, z)) || 0) : 0;
  }

  // Approximate the normal of the same bilinearly-sampled visual-height field
  // around this world point. This drives brick tilt only; brick scale is never
  // changed by the subtle-height follower.
  function sampleTownSurfaceNormal(x, z) {
    const d = SLOPE_SAMPLE_OFFSET;
    const hLeft = sampleTownHeight(x - d, z);
    const hRight = sampleTownHeight(x + d, z);
    const hBack = sampleTownHeight(x, z - d);
    const hFront = sampleTownHeight(x, z + d);
    const dx = (hRight - hLeft) / (2 * d);
    const dz = (hFront - hBack) / (2 * d);
    surfaceNormal.set(-dx, 1, -dz);
    if (surfaceNormal.lengthSq() < 1e-10) surfaceNormal.copy(worldUp);
    else surfaceNormal.normalize();
    return surfaceNormal;
  }

  // Path panels have an exact authored id. Tag the returned WallBuilder group
  // before game.js performs its corridor compaction; the tag survives it.
  function patchWallBuilderPathTag() {
    const proto = window.WallBuilder?.prototype;
    if (!proto || proto.__hobunjiPathSurfaceTagPatched || typeof proto.build !== 'function') return;
    const originalBuild = proto.build;
    proto.build = function (panels, opts) {
      const group = originalBuild.call(this, panels, opts);
      if (group && Array.isArray(panels) && panels.some(panel => panel?.id === 'path_surface_chunk')) {
        group.userData = group.userData || {};
        group.userData.hobunjiPathSurface = true;
      }
      return group;
    };
    proto.__hobunjiPathSurfaceTagPatched = true;
  }

  function isTownBillboardMesh(obj) {
    return !!(obj?.isInstancedMesh && obj.userData?.isBillboard === true && obj.count > 0);
  }

  function elevateBillboardMesh(mesh) {
    if (!isTownBillboardMesh(mesh)) return 0;
    const requiredLength = mesh.instanceMatrix?.array?.length || 0;
    if (!requiredLength) return 0;
    if (!mesh.userData.hobunjiTownSubtleBaseMatrices || mesh.userData.hobunjiTownSubtleBaseMatrices.length !== requiredLength) {
      mesh.userData.hobunjiTownSubtleBaseMatrices = new Float32Array(mesh.instanceMatrix.array);
    }
    const base = mesh.userData.hobunjiTownSubtleBaseMatrices;
    let moved = 0;
    for (let i = 0; i < mesh.count; i++) {
      matrix.fromArray(base, i * 16);
      matrix.decompose(pos, quat, scale);
      const lift = sampleTownHeight(pos.x, pos.z);
      pos.y += lift;
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
      if (Math.abs(lift) > 1e-7) moved++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox?.();
    mesh.computeBoundingSphere?.();
    mesh.userData.hobunjiTownSubtleElevated = true;
    return moved;
  }

  function isPathSurfaceGroup(obj) {
    return !!(obj?.isGroup && obj.userData?.hobunjiPathSurface === true);
  }

  function _roadNodeKey(x, y, z) {
    // WallBuilder may create several InstancedMesh children for one GLB. Merge
    // matching transforms into one logical brick-center node so every child of
    // that brick receives the same position solve rather than being mistaken
    // for zero-distance neighbors.
    return `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`;
  }

  function collectRoadNodes(scene) {
    const nodeMap = new Map();
    const touchedMeshes = new Set();
    for (const group of (scene?.children || [])) {
      if (!isPathSurfaceGroup(group)) continue;
      group.traverse(inst => {
        if (!inst?.isInstancedMesh || !inst.count) return;
        const requiredLength = inst.instanceMatrix?.array?.length || 0;
        if (!requiredLength) return;
        if (!inst.userData.hobunjiTownSubtleBaseMatrices || inst.userData.hobunjiTownSubtleBaseMatrices.length !== requiredLength) {
          // Capture after game.js's corridor compaction/elevTier work. All later
          // road solves start from this immutable flat-layout matrix array.
          inst.userData.hobunjiTownSubtleBaseMatrices = new Float32Array(inst.instanceMatrix.array);
        }
        const base = inst.userData.hobunjiTownSubtleBaseMatrices;
        touchedMeshes.add(inst);
        for (let i = 0; i < inst.count; i++) {
          matrix.fromArray(base, i * 16);
          matrix.decompose(pos, quat, scale);
          const key = _roadNodeKey(pos.x, pos.y, pos.z);
          let node = nodeMap.get(key);
          if (!node) {
            node = {
              baseX: pos.x, baseY: pos.y, baseZ: pos.z,
              x: pos.x, z: pos.z,
              y: pos.y + sampleTownHeight(pos.x, pos.z),
              records: [],
            };
            nodeMap.set(key, node);
          }
          node.records.push({ inst, index: i });
        }
      });
    }
    return { nodes: [...nodeMap.values()], touchedMeshes };
  }

  function buildRoadNeighborEdges(nodes) {
    if (nodes.length < 2) return [];

    // The path recipe already gives us the desired flat brick lattice. Infer
    // its nearest-neighbor spacing from those original X/Z centers, then keep
    // all local lattice links out through the first diagonal band. Using one
    // graph for every visible/culled chunk prevents a new gap at chunk seams.
    const bucketSize = 1.0;
    const buckets = new Map();
    const bucketKey = (x, z) => `${Math.floor(x / bucketSize)},${Math.floor(z / bucketSize)}`;
    for (let i = 0; i < nodes.length; i++) {
      const key = bucketKey(nodes[i].baseX, nodes[i].baseZ);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    }

    const nearest = [];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const bx = Math.floor(a.baseX / bucketSize), bz = Math.floor(a.baseZ / bucketSize);
      let bestSq = Infinity;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const j of (buckets.get(`${bx + dx},${bz + dz}`) || [])) {
            if (j === i) continue;
            const b = nodes[j];
            const ddx = b.baseX - a.baseX, ddz = b.baseZ - a.baseZ;
            const dsq = ddx * ddx + ddz * ddz;
            if (dsq > 1e-8 && dsq < bestSq) bestSq = dsq;
          }
        }
      }
      if (bestSq < Infinity) nearest.push(Math.sqrt(bestSq));
    }
    if (!nearest.length) return [];
    nearest.sort((a, b) => a - b);
    const nearestSpacing = nearest[Math.floor(nearest.length * 0.5)];
    const cutoff = nearestSpacing * ROAD_NEIGHBOR_MULTIPLIER;
    const cutoffSq = cutoff * cutoff;
    const minSq = nearestSpacing * nearestSpacing * 0.20;
    const edges = [];

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const bx = Math.floor(a.baseX / bucketSize), bz = Math.floor(a.baseZ / bucketSize);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const j of (buckets.get(`${bx + dx},${bz + dz}`) || [])) {
            if (j <= i) continue;
            const b = nodes[j];
            const ddx = b.baseX - a.baseX, ddz = b.baseZ - a.baseZ;
            const horizSq = ddx * ddx + ddz * ddz;
            if (horizSq < minSq || horizSq > cutoffSq) continue;
            const ddy = b.baseY - a.baseY;
            edges.push({
              a: i,
              b: j,
              baseHoriz: Math.sqrt(horizSq),
              target3d: Math.sqrt(horizSq + ddy * ddy),
            });
          }
        }
      }
    }
    return edges;
  }

  function solveRoadProjectedSpacing(nodes, edges) {
    if (!edges.length) return;
    for (const node of nodes) {
      node.x = node.baseX;
      node.z = node.baseZ;
      node.y = node.baseY + sampleTownHeight(node.x, node.z);
    }

    for (let iteration = 0; iteration < ROAD_SOLVER_ITERATIONS; iteration++) {
      // Heights change when the projected centers move, so refresh the surface
      // samples once per relaxation pass before satisfying the neighbor links.
      for (const node of nodes) node.y = node.baseY + sampleTownHeight(node.x, node.z);

      for (const edge of edges) {
        const a = nodes[edge.a], b = nodes[edge.b];
        const dx = b.x - a.x, dz = b.z - a.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz < 1e-7) continue;
        const dy = b.y - a.y;

        // Keep the original flat-layout 3D center distance. Once a height
        // difference appears, the horizontal component must shrink so
        // sqrt(dx^2 + dz^2 + dy^2) remains the same. This changes positions,
        // not brick dimensions.
        const remainingSq = edge.target3d * edge.target3d - dy * dy;
        const minProjected = edge.baseHoriz * ROAD_MIN_PROJECTED_SPACING;
        const desiredHoriz = Math.max(minProjected, Math.sqrt(Math.max(0, remainingSq)));
        const error = horiz - desiredHoriz;
        if (Math.abs(error) < 1e-5) continue;
        const correction = error * ROAD_SOLVER_STRENGTH * 0.5;
        const ux = dx / horiz, uz = dz / horiz;
        a.x += ux * correction;
        a.z += uz * correction;
        b.x -= ux * correction;
        b.z -= uz * correction;
      }
    }
  }

  function relayoutTownRoads() {
    const scene = townDeps?.getTownScene?.();
    if (!scene) return 0;
    const { nodes, touchedMeshes } = collectRoadNodes(scene);
    if (!nodes.length) return 0;
    const edges = buildRoadNeighborEdges(nodes);
    solveRoadProjectedSpacing(nodes, edges);

    let moved = 0;
    for (const node of nodes) {
      const lift = sampleTownHeight(node.x, node.z);
      const normal = sampleTownSurfaceNormal(node.x, node.z);
      const projectedShift = Math.hypot(node.x - node.baseX, node.z - node.baseZ);
      for (const record of node.records) {
        const inst = record.inst;
        const base = inst.userData.hobunjiTownSubtleBaseMatrices;
        matrix.fromArray(base, record.index * 16);
        matrix.decompose(pos, quat, scale);
        pos.x = node.x;
        pos.z = node.z;
        pos.y += lift;

        // Preserve WallBuilder's road/yaw/random rotation, then tip the whole
        // unchanged brick so its up axis follows the local surface normal.
        slopeQuat.setFromUnitVectors(worldUp, normal);
        quat.premultiply(slopeQuat);
        matrix.compose(pos, quat, scale);
        inst.setMatrixAt(record.index, matrix);
        if (projectedShift > 1e-6 || Math.abs(lift) > 1e-7 || normal.y < 0.999999) moved++;
      }
    }
    for (const inst of touchedMeshes) {
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingBox?.();
      inst.computeBoundingSphere?.();
    }
    return moved;
  }

  function queueTownRoadLayout() {
    if (roadRefreshQueued) return;
    roadRefreshQueued = true;
    const schedule = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (fn => setTimeout(fn, 0));
    schedule(() => {
      roadRefreshQueued = false;
      const moved = relayoutTownRoads();
      if (moved) townDeps?.debugLog?.(`Town subtle elevation: surface-spacing solve moved ${moved} road-brick instance(s)`);
    });
  }

  function elevateObject(obj) {
    if (!obj) return { grass: 0, road: 0 };
    const grass = elevateBillboardMesh(obj);
    if (isPathSurfaceGroup(obj)) queueTownRoadLayout();
    return { grass, road: 0 };
  }

  function patchTownSceneAdd() {
    const scene = townDeps?.getTownScene?.();
    if (!scene || scene.userData.hobunjiExactSubtleFollowersAddPatched) return;
    const originalAdd = scene.add;
    scene.add = function (...objects) {
      const result = originalAdd.apply(this, objects);
      for (const obj of objects) elevateObject(obj);
      return result;
    };
    scene.userData.hobunjiExactSubtleFollowersAddPatched = true;
  }

  function refreshTownFollowers() {
    const scene = townDeps?.getTownScene?.();
    if (!scene) return { grass: 0, road: 0 };
    patchTownSceneAdd();
    let grass = 0;
    for (const obj of scene.children || []) grass += elevateBillboardMesh(obj);
    const road = relayoutTownRoads();
    if (grass || road) {
      townDeps?.debugLog?.(`Town subtle elevation exact followers: moved ${grass} billboard instance(s), ${road} road-brick instance(s)`);
    }
    return { grass, road };
  }

  function patchTownZoneBuildings() {
    const api = window.TownZoneBuildings;
    if (!api || api.__hobunjiExactSubtleFollowersPatched) return;
    const originalInit = api.init;
    const originalSpawn = api.spawnTownBuildings;
    if (typeof originalInit !== 'function' || typeof originalSpawn !== 'function') return;

    api.init = function (injectedDeps) {
      townDeps = injectedDeps;
      return originalInit.call(this, injectedDeps);
    };
    api.spawnTownBuildings = function (...args) {
      const result = originalSpawn.apply(this, args);
      refreshTownFollowers();
      return result;
    };
    api.refreshTownSubtleHeightFollowersExact = refreshTownFollowers;
    api.__hobunjiExactSubtleFollowersPatched = true;
  }

  // config.js installs its own future-PixelProbe setter because this module is
  // loaded before game.js defines window.PixelProbe. Chain that setter rather
  // than returning early: otherwise this replacement never installs at all and
  // the older persistent player-Y hook remains active.
  function patchPlayerTownRenderHeight() {
    function install(api) {
      if (!api || api.__hobunjiTransientTownHeightRepair || typeof api.init !== 'function') return api;
      const compatibilityInit = api.init;
      api.init = function (injectedDeps) {
        const renderer = injectedDeps?.renderer;
        const baseRender = renderer?.render;
        const result = compatibilityInit.call(this, injectedDeps);
        if (!renderer || typeof baseRender !== 'function' || renderer.__hobunjiTransientTownHeightRepair) return result;

        renderer.render = function (...args) {
          const playerMesh = injectedDeps?.playerMesh;
          const sit = injectedDeps?.getSitInteraction?.();
          const townScene = townDeps?.getTownScene?.();
          const isTownScenePass = injectedDeps?.getCurrentArea?.() === 'town' && (!townScene || args[0] === townScene);
          if (!isTownScenePass || !playerMesh?.position || (sit && sit.phase !== 'out')) {
            return baseRender.apply(this, args);
          }

          const baseY = Number(playerMesh.position.y) || 0;
          const lift = sampleTownHeight(playerMesh.position.x, playerMesh.position.z);
          playerMesh.position.y = baseY + lift;
          try {
            return baseRender.apply(this, args);
          } finally {
            playerMesh.position.y = baseY;
          }
        };
        renderer.__hobunjiTransientTownHeightRepair = true;
        return result;
      };
      api.__hobunjiTransientTownHeightRepair = true;
      return api;
    }

    const existing = window.PixelProbe;
    if (existing) {
      install(existing);
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(window, 'PixelProbe');
    if (!descriptor?.configurable || typeof descriptor.set !== 'function') return;
    const priorGet = descriptor.get;
    const priorSet = descriptor.set;
    Object.defineProperty(window, 'PixelProbe', {
      configurable: true,
      enumerable: descriptor.enumerable !== false,
      get() { return priorGet ? priorGet.call(window) : undefined; },
      set(value) {
        priorSet.call(window, value);
        const patched = priorGet ? priorGet.call(window) : value;
        install(patched);
      },
    });
  }

  patchWallBuilderPathTag();
  patchTownZoneBuildings();
  patchPlayerTownRenderHeight();
})();
