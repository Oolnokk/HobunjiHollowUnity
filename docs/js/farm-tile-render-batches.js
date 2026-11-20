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
  const stats = { frames: 0, sources: 0, batches: 0, rebuilds: 0, skippedIneligible: 0 };
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

  function eligible(mesh) {
    if (!mesh?.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh) return false;
    if (mesh.visible === false) return reject('hidden');
    if (mesh.children.length) return reject('children');
    if (!mesh.frustumCulled) return reject('notFrustumCulled');
    const data = mesh.userData || {};
    if (data.terrainRenderChunk || data.hobunjiFarmTileBatch || data.isBillboard || data.hobunjiHeldObjectPlane || data.hobunjiWaterOccludedBySurface) return reject('excludedTag');
    if (!(((mesh.layers.mask >>> 0) >>> MATERIAL_ID_LAYER) & 1)) return reject('notTerrainLayer'); // Only tiles game.js marked as terrain.
    const material = mesh.material;
    if (!material || Array.isArray(material)) return reject('multiMaterial');
    // The only hook a batch can reproduce is game.js's edge-ID hook, identified
    // by the shared per-category colour it records next to it.
    if (mesh.onBeforeRender !== defaultBeforeRender && !data.hobunjiTerrainEdgeIdColor) return reject('unknownHook');
    const g = mesh.geometry;
    const a = g?.attributes;
    if (!a?.position || !a.normal || !a.uv || Object.keys(a).length !== 3) return reject('attributes:' + Object.keys(a || {}).sort().join(','));
    if (a.position.isInterleavedBufferAttribute || a.normal.isInterleavedBufferAttribute || a.uv.isInterleavedBufferAttribute) return reject('interleaved');
    if (a.position.itemSize !== 3 || a.normal.itemSize !== 3 || a.uv.itemSize !== 2) return reject('itemSize');
    if (Object.keys(g.morphAttributes || {}).length) return reject('morph'); // Geometry groups are fine: with one (non-array) material Three draws the whole index range once, exactly like the merged copy.
    if (g.drawRange && (g.drawRange.start !== 0 || (Number.isFinite(g.drawRange.count) && g.drawRange.count !== (g.index ? g.index.count : a.position.count)))) return reject('drawRange');
    return true;
  }

  function groupKey(mesh) {
    const e = mesh.matrixWorld.elements;
    const cx = Math.floor(e[12] / CELL_TILES), cz = Math.floor(e[14] / CELL_TILES);
    const data = mesh.userData;
    let tags = '';
    for (const tag of GROUND_TAGS) if (data[tag] !== undefined) tags += tag + '=' + String(data[tag]) + ';';
    return cx + ',' + cz + '|' + mesh.material.id + '|' + (mesh.layers.mask >>> 0) + '|' + (mesh.castShadow ? 1 : 0) + (mesh.receiveShadow ? 1 : 0)
      + '|' + mesh.renderOrder + '|' + colorKey(data.hobunjiTerrainEdgeIdColor) + '|' + tags;
  }

  // Per-member state the merged geometry was built from; compared every frame
  // without allocating.
  const SIG = 10;
  function writeSignature(out, offset, mesh) {
    const g = mesh.geometry, a = g.attributes, e = mesh.matrixWorld.elements;
    out[offset] = g.id;
    out[offset + 1] = a.position.version;
    out[offset + 2] = a.normal.version;
    out[offset + 3] = a.uv.version;
    out[offset + 4] = g.index ? g.index.version + 1 : 0;
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
      if (sig[o] !== g.id || sig[o + 1] !== a.position.version || sig[o + 2] !== a.normal.version || sig[o + 3] !== a.uv.version
        || sig[o + 4] !== (g.index ? g.index.version + 1 : 0) || sig[o + 5] !== e[12] || sig[o + 6] !== e[13] || sig[o + 7] !== e[14]
        || sig[o + 8] !== e[0] + e[5] * 3 + e[10] * 7 || sig[o + 9] !== e[1] + e[2] * 3 + e[4] * 7 + e[6] * 11 + e[8] * 13 + e[9] * 17) return false;
    }
    return true;
  }

  function mergeWorldGeometry(THREE, members) {
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
        position[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
        position[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        position[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
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

  function buildBatch(THREE, record, batch, members) {
    const first = members[0];
    const geometry = mergeWorldGeometry(THREE, members);
    if (!batch.mesh) {
      batch.mesh = new THREE.Mesh(geometry, first.material);
      batch.mesh.name = 'farm_tile_render_batch';
      batch.mesh.matrixAutoUpdate = false; // World-space geometry under an identity holder.
      batch.mesh.raycast = noRaycast; // The per-tile sources keep answering raycasts.
      record.holder.add(batch.mesh);
    } else {
      batch.mesh.geometry.dispose();
      batch.mesh.geometry = geometry;
    }
    const mesh = batch.mesh;
    mesh.material = first.material;
    mesh.layers.mask = first.layers.mask;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.onBeforeRender = first.onBeforeRender; // game.js edge-ID hook (same colour for the whole group) or the default no-op.
    const data = { hobunjiFarmTileBatch: true, terrainRenderChunk: true, terrainJigsawBaked: true, terrainJigsawIgnore: true };
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
  function suspendForRender(scene) {
    if (!enabled || !scene?.isScene || window.THREE == null) return null;
    if (window.GridTileAccessors?.getCurrentArea?.() !== 'farm') return null;
    stats.frames++;
    for (const key of Object.keys(rejectReasons)) delete rejectReasons[key];
    const groups = new Map();
    let sources = 0;
    for (const child of scene.children) {
      if (!child.isMesh) continue;
      if (!eligible(child)) { stats.skippedIneligible++; continue; }
      child.updateMatrixWorld(); // A tile rebuilt since the last render has not had its world matrix computed yet.
      const key = groupKey(child);
      let list = groups.get(key);
      if (!list) { list = []; groups.set(key, list); }
      list.push(child);
      sources++;
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
      if (!isCurrent(batch, members)) buildBatch(THREE, record, batch, members);
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
