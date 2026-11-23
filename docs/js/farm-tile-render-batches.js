// Render-time batches for the farm's per-tile ground meshes.
//
// The farm builds one Mesh per tile (floor slabs, trench/raised/path/rock
// ground; vegetation-crop-rendering.js), about a thousand direct scene
// children on a 36x26 farm. A draw census on the farm found 1,103 real draw
// calls per frame, ~500 of them these slabs, on a player machine that was
// CPU-bound on draw submission (GPU 8-17% busy). Town and the wilderness
// already merge their ground; the farm did not.
//
// The per-tile meshes stay the single authority: hoe/shovel/seed refreshes,
// raycasts, editors and every other renderer keep using them exactly as
// before. For the synchronous world render only (game.js renderWorldPasses),
// tiles that game.js marked as terrain (_markTerrainEdgeId: material-ID layer
// plus a known edge-ID hook) are hidden and replaced by one merged mesh per
// 8x8-tile cell and identical render state (material, layers, shadow flags,
// render order, edge-ID colour, ground tags). A batch is rebuilt only when
// one of its member meshes, their geometry/attribute versions or their world
// position changes. Batches are tagged as terrain render chunks, so the
// held-object ground x-ray treats them like the tiles and the terrain jigsaw /
// chunker leave them alone. FarmTileRenderBatches.setEnabled(false) is the
// A/B switch; snapshot() reports counts.
//
// Tagged static groups (any area except wilderness zones, whose props
// zone-prop-render-batches.js already merges). A direct scene child tagged
// userData.hobunjiStaticBatchGroup holds many small static meshes that are not
// terrain-marked: the town's NPC farm plots (js/npc-farm-plots.js: one soil,
// trench or water mesh per tile, 258 of ~520 draws looking at the plots) and
// authored houses (js/HousePieceGen.js: one mesh per wall/roof/porch quad,
// ~1,070 in town and the largest main-pass draw source there). Its children
// tagged userData.hobunjiStaticBatchable merge the same way, per 8x8 cell and
// render state, if they keep the default draw hook. A transparent child also
// needs userData.hobunjiStaticBatchFlat (it never overlaps its batch-mates, so
// one draw needs no back-to-front order between them). A tagged batch sits at
// its members' centroid, so Three sorts it where they are. Tagged batches are
// render proxies only: they do NOT get the terrain tags (the sources were never
// terrain to the ground x-ray), so every classifier sees what it saw before.
(() => {
  'use strict';
  if (window.FarmTileRenderBatches) return;

  const CELL_TILES = 8;
  const MATERIAL_ID_LAYER = globalThis.HobunjiRenderLayers?.MATERIAL_SEAM_ID ?? 3; // game.js _markTerrainEdgeId / TerrainRenderChunks.
  const GROUND_TAGS = ['mapEditorTerrain', 'hobunjiGroundSurface', 'hobunjiGroundXray', 'hachutuGroundRoot', 'cavernWalkableFloor'];
  let enabled = true;
  const records = new WeakMap(); // scene -> { holder, batches: Map<key, batch> }
  const colorIds = new WeakMap(); // edge-ID Color -> small int for keys
  let nextColorId = 1;
  const stats = { frames: 0, sources: 0, batches: 0, rebuilds: 0, skippedIneligible: 0, groupFullScans: 0, groupCachedScans: 0 };
  // Tagged groups are static, and a town holds ~1,300 of their members:
  // re-deriving eligibility, keys and signatures for all of them every frame
  // cost ~2 ms of JS headless. A group's member list is reused while its
  // children are unchanged (same count, every cached member still its child,
  // visible, with the same material and geometry objects, the group not moved,
  // same userData.hobunjiStaticBatchRevision if the owner keeps one); a full
  // rescan, including the geometry/matrix signature check, still runs at least
  // every TAGGED_RESCAN_MS for changes those checks cannot see (an in-place
  // attribute edit, a member's own transform or draw hook changing).
  const TAGGED_RESCAN_MS = 1000;
  const groupScans = new WeakMap(); // group -> { revision, childCount, scannedAt, pose, members, materials, geometries, buckets: Map<key, meshes> }
  function readPose(group, out) { // Local transform of a scene-level group (= its world transform).
    const p = group.position, q = group.quaternion, k = group.scale;
    out[0] = p.x; out[1] = p.y; out[2] = p.z;
    out[3] = q ? q.x : 0; out[4] = q ? q.y : 0; out[5] = q ? q.z : 0; out[6] = q ? q.w : 1;
    out[7] = k ? k.x : 1; out[8] = k ? k.y : 1; out[9] = k ? k.z : 1;
    return out;
  }
  const poseScratch = new Float64Array(10);
  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  function scanTaggedGroup(group, time) {
    const revision = group.userData.hobunjiStaticBatchRevision || 0;
    let scan = groupScans.get(group);
    if (scan && scan.revision === revision && scan.childCount === group.children.length && time - scan.scannedAt < TAGGED_RESCAN_MS) {
      const members = scan.members, materials = scan.materials, geometries = scan.geometries;
      let unchanged = true;
      readPose(group, poseScratch);
      for (let i = 0; i < 10; i++) if (poseScratch[i] !== scan.pose[i]) { unchanged = false; break; }
      for (let i = 0; unchanged && i < members.length; i++) {
        const mesh = members[i];
        if (mesh.parent !== group || mesh.visible === false || mesh.material !== materials[i] || mesh.geometry !== geometries[i]) unchanged = false;
      }
      if (unchanged) { scan.cached = true; stats.groupCachedScans++; return scan; }
    }
    group.updateMatrixWorld(); // Group plus its members: one added since the last render has no world matrix yet.
    const members = [], materials = [], geometries = [], buckets = new Map();
    for (const mesh of group.children) {
      if (mesh.userData?.hobunjiStaticBatchable !== true) continue;
      if (!eligible(mesh, true)) { stats.skippedIneligible++; continue; }
      members.push(mesh); materials.push(mesh.material); geometries.push(mesh.geometry);
      const key = groupKey(mesh, true);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(mesh); else buckets.set(key, [mesh]);
    }
    scan = { revision, childCount: group.children.length, scannedAt: time, pose: readPose(group, new Float64Array(10)), members, materials, geometries, buckets, cached: false };
    groupScans.set(group, scan);
    stats.groupFullScans++;
    return scan;
  }
  function sameMembers(batch, members) {
    if (!batch.mesh || batch.members.length !== members.length) return false;
    for (let i = 0; i < members.length; i++) if (batch.members[i] !== members[i]) return false;
    return true;
  }
  const rejectReasons = {}; // Last frame's ineligible tile counts by reason (snapshot()).
  function reject(reason) { rejectReasons[reason] = (rejectReasons[reason] || 0) + 1; return false; }
  const defaultBeforeRender = window.THREE?.Object3D?.prototype?.onBeforeRender;

  function noRaycast() {}

  function colorKey(color) {
    if (!color) return 0;
    let id = colorIds.get(color);
    if (!id) { id = nextColorId++; colorIds.set(color, id); }
    return id;
  }

  // tagged: a hobunjiStaticBatchable child of a tagged source group (see header).
  function eligible(mesh, tagged = false) {
    if (!mesh?.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh) return false;
    if (mesh.visible === false) return reject('hidden');
    if (mesh.children.length) return reject('children');
    if (!mesh.frustumCulled) return reject('notFrustumCulled');
    const data = mesh.userData || {};
    if (data.terrainRenderChunk || data.hobunjiFarmTileBatch || data.isBillboard || data.hobunjiHeldObjectPlane || data.hobunjiWaterOccludedBySurface) return reject('excludedTag');
    if (!tagged && !(((mesh.layers.mask >>> 0) >>> MATERIAL_ID_LAYER) & 1)) return reject('notTerrainLayer'); // Only tiles game.js marked as terrain.
    const material = mesh.material;
    if (!material || Array.isArray(material)) return reject('multiMaterial');
    // Transparent tagged meshes must be declared flat (non-overlapping, e.g. plot
    // irrigation water): one draw cannot order overlapping layers back to front.
    if (tagged && material.transparent && data.hobunjiStaticBatchFlat !== true) return reject('transparent');
    // The only hook a batch can reproduce is game.js's edge-ID hook, identified
    // by the shared per-category colour it records next to it. Tagged tiles have none.
    if (mesh.onBeforeRender !== defaultBeforeRender && (tagged || !data.hobunjiTerrainEdgeIdColor)) return reject('unknownHook');
    const g = mesh.geometry;
    const a = g?.attributes;
    if (!a?.position || !a.normal || !a.uv || Object.keys(a).length !== 3) return reject('attributes:' + Object.keys(a || {}).sort().join(','));
    if (a.position.isInterleavedBufferAttribute || a.normal.isInterleavedBufferAttribute || a.uv.isInterleavedBufferAttribute) return reject('interleaved');
    if (a.position.itemSize !== 3 || a.normal.itemSize !== 3 || a.uv.itemSize !== 2) return reject('itemSize');
    if (Object.keys(g.morphAttributes || {}).length) return reject('morph'); // Geometry groups are fine: with one (non-array) material Three draws the whole index range once, exactly like the merged copy.
    if (g.drawRange && (g.drawRange.start !== 0 || (Number.isFinite(g.drawRange.count) && g.drawRange.count !== (g.index ? g.index.count : a.position.count)))) return reject('drawRange');
    return true;
  }

  function groupKey(mesh, tagged = false) {
    const e = mesh.matrixWorld.elements;
    const cx = Math.floor(e[12] / CELL_TILES), cz = Math.floor(e[14] / CELL_TILES);
    const data = mesh.userData;
    let tags = '';
    for (const tag of GROUND_TAGS) if (data[tag] !== undefined) tags += tag + '=' + String(data[tag]) + ';';
    return (tagged ? 'g|' : '') + cx + ',' + cz + '|' + mesh.material.id + '|' + (mesh.layers.mask >>> 0) + '|' + (mesh.castShadow ? 1 : 0) + (mesh.receiveShadow ? 1 : 0)
      + '|' + mesh.renderOrder + '|' + colorKey(data.hobunjiTerrainEdgeIdColor) + '|' + tags;
  }

  // Per-member state the merged geometry was built from; compared every frame
  // without allocating. An attribute is identified by object AND version: a
  // replaced attribute (setAttribute after a porch/UV re-bake) starts again at
  // version 0 and would otherwise read as unchanged.
  const SIG = 10;
  const attrIds = new WeakMap();
  let nextAttrId = 1;
  function attrStamp(attribute) {
    let id = attrIds.get(attribute);
    if (!id) { id = nextAttrId++; attrIds.set(attribute, id); }
    return id * 1e9 + attribute.version;
  }
  function writeSignature(out, offset, mesh) {
    const g = mesh.geometry, a = g.attributes, e = mesh.matrixWorld.elements;
    out[offset] = g.id;
    out[offset + 1] = attrStamp(a.position);
    out[offset + 2] = attrStamp(a.normal);
    out[offset + 3] = attrStamp(a.uv);
    out[offset + 4] = g.index ? attrStamp(g.index) + 1 : 0;
    out[offset + 5] = e[12]; out[offset + 6] = e[13]; out[offset + 7] = e[14];
    out[offset + 8] = e[0] + e[5] * 3 + e[10] * 7; out[offset + 9] = e[1] + e[2] * 3 + e[4] * 7 + e[6] * 11 + e[8] * 13 + e[9] * 17;
  }
  function isCurrent(batch, members) {
    if (!batch.mesh || batch.members.length !== members.length) return false;
    const sig = batch.signature;
    for (let i = 0; i < members.length; i++) {
      const mesh = members[i];
      if (batch.members[i] !== mesh) return false;
      const g = mesh.geometry, a = g.attributes, e = mesh.matrixWorld.elements, o = i * SIG;
      if (sig[o] !== g.id || sig[o + 1] !== attrStamp(a.position) || sig[o + 2] !== attrStamp(a.normal) || sig[o + 3] !== attrStamp(a.uv)
        || sig[o + 4] !== (g.index ? attrStamp(g.index) + 1 : 0) || sig[o + 5] !== e[12] || sig[o + 6] !== e[13] || sig[o + 7] !== e[14]
        || sig[o + 8] !== e[0] + e[5] * 3 + e[10] * 7 || sig[o + 9] !== e[1] + e[2] * 3 + e[4] * 7 + e[6] * 11 + e[8] * 13 + e[9] * 17) return false;
    }
    return true;
  }

  // origin: world point subtracted from every vertex (the batch mesh sits there).
  function mergeWorldGeometry(THREE, members, origin = null) {
    const ox = origin ? origin.x : 0, oy = origin ? origin.y : 0, oz = origin ? origin.z : 0;
    let vertexCount = 0, indexCount = 0;
    for (const mesh of members) {
      const g = mesh.geometry;
      vertexCount += g.attributes.position.count;
      indexCount += g.index ? g.index.count : g.attributes.position.count;
    }
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const uv = new Float32Array(vertexCount * 2);
    const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let v = 0, ix = 0;
    for (const mesh of members) {
      const g = mesh.geometry, a = g.attributes, e = mesh.matrixWorld.elements;
      const p = a.position, n = a.normal, t = a.uv;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const o = (v + i) * 3;
        position[o] = e[0] * x + e[4] * y + e[8] * z + e[12] - ox;
        position[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13] - oy;
        position[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14] - oz;
        const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
        let wx = e[0] * nx + e[4] * ny + e[8] * nz, wy = e[1] * nx + e[5] * ny + e[9] * nz, wz = e[2] * nx + e[6] * ny + e[10] * nz;
        const len = Math.hypot(wx, wy, wz) || 1; // Tiles are translated only; normalising also covers a uniform scale.
        normal[o] = wx / len; normal[o + 1] = wy / len; normal[o + 2] = wz / len;
        uv[(v + i) * 2] = t.getX(i); uv[(v + i) * 2 + 1] = t.getY(i);
      }
      if (g.index) { const src = g.index; for (let i = 0; i < src.count; i++) index[ix++] = src.getX(i) + v; }
      else for (let i = 0; i < p.count; i++) index[ix++] = v + i;
      v += p.count;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function buildBatch(THREE, record, batch, members, tagged = false) {
    const first = members[0];
    // Tagged batches sit at their members' centroid so Three's per-object sort
    // (back-to-front for transparent tiles) keys them where the tiles are,
    // not at the holder origin. Farm terrain batches keep world-space geometry.
    let origin = null;
    if (tagged) {
      origin = { x: 0, y: 0, z: 0 };
      for (const member of members) { const e = member.matrixWorld.elements; origin.x += e[12]; origin.y += e[13]; origin.z += e[14]; }
      origin.x /= members.length; origin.y /= members.length; origin.z /= members.length;
    }
    const geometry = mergeWorldGeometry(THREE, members, origin);
    if (!batch.mesh) {
      batch.mesh = new THREE.Mesh(geometry, first.material);
      batch.mesh.name = 'farm_tile_render_batch';
      batch.mesh.matrixAutoUpdate = false; // World-space geometry (or a tagged batch's centroid offset) under an identity holder.
      batch.mesh.raycast = noRaycast; // The per-tile sources keep answering raycasts.
      record.holder.add(batch.mesh);
    } else {
      batch.mesh.geometry.dispose();
      batch.mesh.geometry = geometry;
    }
    const mesh = batch.mesh;
    if (origin) { // A key never changes kind ('g|' prefix), so farm batches stay at the identity origin.
      mesh.position.set(origin.x, origin.y, origin.z);
      mesh.updateMatrix(); // matrixAutoUpdate is off: compose once per rebuild.
      mesh.matrixWorldNeedsUpdate = true;
    }
    mesh.material = first.material;
    mesh.layers.mask = first.layers.mask;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.onBeforeRender = first.onBeforeRender; // game.js edge-ID hook (same colour for the whole group) or the default no-op.
    const data = tagged
      // Render copy only; no terrain identity the sources lacked. Opt-in AutoLOD
      // never simplified the 2-triangle sources, so it must not decimate their merge.
      ? { hobunjiFarmTileBatch: true, hobunjiRenderProxy: true, terrainJigsawIgnore: true, geometryAutoLODExclude: true }
      : { hobunjiFarmTileBatch: true, terrainRenderChunk: true, terrainJigsawBaked: true, terrainJigsawIgnore: true };
    for (const tag of GROUND_TAGS) if (first.userData[tag] !== undefined) data[tag] = first.userData[tag];
    if (first.userData.hobunjiTerrainEdgeIdColor) data.hobunjiTerrainEdgeIdColor = first.userData.hobunjiTerrainEdgeIdColor;
    mesh.userData = data;
    batch.members = members.slice();
    batch.signature = new Float64Array(members.length * SIG);
    members.forEach((member, i) => writeSignature(batch.signature, i * SIG, member));
    stats.rebuilds++;
  }

  let lastRecord = null; // Diagnostics only.
  function recordFor(scene) {
    let record = records.get(scene);
    if (!record) {
      const holder = new window.THREE.Group();
      holder.name = 'farm_tile_render_batches';
      holder.visible = false; // Shown only inside renderWorldPasses.
      holder.matrixAutoUpdate = false;
      holder.userData.noOutline = true;
      holder.userData.hobunjiFarmTileBatchHolder = true;
      record = { holder, batches: new Map() };
      records.set(scene, record);
    }
    if (record.holder.parent !== scene) scene.add(record.holder);
    lastRecord = record;
    return record;
  }

  // Returns a restore function, or null when nothing was swapped.
  // isZone: wilderness zones already merge their static props (zone-prop-render-batches.js),
  // so tagged groups there (bandit tents, zone buildings) are left to that owner.
  function suspendForRender(scene, { isZone = false } = {}) {
    if (!enabled || !scene?.isScene || window.THREE == null) return null;
    const farm = window.GridTileAccessors?.getCurrentArea?.() === 'farm';
    let sourceGroups = 0;
    if (!isZone) for (const child of scene.children) if (child.userData?.hobunjiStaticBatchGroup === true && child.visible !== false) sourceGroups++;
    if (!farm && !sourceGroups) return null;
    stats.frames++;
    for (const key of Object.keys(rejectReasons)) delete rejectReasons[key];
    const groups = new Map();
    let sources = 0;
    const addSource = (mesh, tagged) => {
      const key = groupKey(mesh, tagged);
      let list = groups.get(key);
      if (!list) { list = []; list.tagged = tagged; groups.set(key, list); }
      list.push(mesh);
      sources++;
    };
    const addBucket = (key, meshes, cached) => { // A tagged group's members already grouped by key.
      const list = groups.get(key);
      if (!list) {
        const copy = meshes.slice(); copy.tagged = true; copy.cached = cached; groups.set(key, copy);
      } else { // Another tagged group in the same cell shares this render state.
        for (let i = 0; i < meshes.length; i++) list.push(meshes[i]);
        if (!cached) list.cached = false; // Any freshly scanned member re-checks the batch signature.
      }
      sources += meshes.length;
    };
    const time = now();
    for (const child of scene.children) {
      if (child.userData?.hobunjiStaticBatchGroup === true) {
        if (isZone || child.visible === false) continue;
        const scan = scanTaggedGroup(child, time);
        for (const [key, meshes] of scan.buckets) addBucket(key, meshes, scan.cached);
        continue;
      }
      if (!farm || !child.isMesh) continue;
      if (!eligible(child)) { stats.skippedIneligible++; continue; }
      child.updateMatrixWorld(); // A tile rebuilt since the last render has not had its world matrix computed yet.
      addSource(child, false);
    }
    if (!sources) return null;
    const record = recordFor(scene);
    const THREE = window.THREE;
    for (const [key, batch] of record.batches) {
      if (!groups.has(key)) {
        record.holder.remove(batch.mesh);
        batch.mesh.geometry.dispose(); // Material belongs to the source tiles.
        record.batches.delete(key);
      }
    }
    const hidden = [];
    for (const [key, members] of groups) {
      if (members.length < 2) continue; // A lone tile gains nothing; leave it as it is.
      let batch = record.batches.get(key);
      if (!batch) { batch = { mesh: null, members: [], signature: null }; record.batches.set(key, batch); }
      // Members from an unchanged cached group scan only need the same identities;
      // their signatures are re-checked on the group's next full scan.
      const current = members.tagged && members.cached ? sameMembers(batch, members) : isCurrent(batch, members);
      if (!current) buildBatch(THREE, record, batch, members, members.tagged === true);
      batch.mesh.visible = true;
      for (const member of members) { member.visible = false; hidden.push(member); }
    }
    for (const [key, batch] of record.batches) if ((groups.get(key)?.length || 0) < 2) batch.mesh.visible = false;
    if (!hidden.length) return null;
    record.holder.visible = true;
    stats.sources = hidden.length;
    stats.batches = record.batches.size;
    return function restoreFarmTileBatches() {
      for (const mesh of hidden) mesh.visible = true;
      record.holder.visible = false;
    };
  }

  function setEnabled(value) {
    enabled = value !== false;
    return enabled;
  }

  window.FarmTileRenderBatches = {
    suspendForRender,
    setEnabled,
    snapshot: () => ({ enabled, cellTiles: CELL_TILES, ...stats, rejectReasons: { ...rejectReasons }, batchSizes: (() => { const out = []; for (const r of [lastRecord]) if (r) for (const b of r.batches.values()) out.push(b.members.length); return out; })() }),
  };
})();
