(() => {
  'use strict';

  // Render-time spatial chunks for the farm and town grass billboards.
  //
  // Farm grass, farm weeds, town grass and the town border grass are each ONE
  // InstancedMesh spanning the whole map (tens of thousands of crossed blade
  // planes), with frustumCulled=false because r128 cannot bound instances. So
  // every blade was submitted in the world draw and again in each held/shell
  // depth replay, wherever the camera looked.
  //
  // Those source meshes stay the single authority: hoe/seed/shovel refills,
  // building-footprint compaction (BuildingGrassSuppression), town height
  // followers and the Settings > Grass toggle all keep writing to them exactly
  // as before. For the synchronous world render only, a registered source is
  // hidden and a holder of per-chunk InstancedMeshes (sharing its geometry and
  // material) is shown in its place. The chunks are tagged by
  // InstancedMeshBounds, so InstancedMeshViewCull drops off-camera chunks and
  // HeldObjectRenderOrder drops chunks outside a replay's scissor. Chunks are
  // rebuilt only when the source's instance matrices, count, geometry or
  // material change. Outside renderWorldPasses (previews, other renderers)
  // the holder is hidden and the source draws as it always did.
  const CHUNK_TILES = 8; // World units per chunk side; farm/town grass uses one unit per tile.
  let enabled = true; // Debug A/B switch: GrassBillboardRenderChunks.setEnabled(false).
  const records = []; // { ref: WeakRef<source>, holder, chunks: Map<cell, chunk>, built + the source state they were built from }
  const active = []; // Records swapped by the current suspend call.
  const stats = { sources: 0, swapped: 0, chunks: 0, instances: 0, rebuilds: 0, enabled: true };

  function noRaycast() {} // Chunks are render copies; the source keeps answering raycasts.

  // Chunks are current while the source's instance buffer, count and geometry
  // are the ones they were built from. Compared field by field: this runs
  // every frame and must not allocate.
  function isCurrent(record, source) {
    return record.built === true && record.version === source.instanceMatrix.version && record.count === source.count
      && record.geometry === source.geometry && record.capacity === source.instanceMatrix.array.length;
  }
  function markCurrent(record, source) {
    record.built = true; record.version = source.instanceMatrix.version; record.count = source.count;
    record.geometry = source.geometry; record.capacity = source.instanceMatrix.array.length;
  }

  function drawnRoot(object) {
    let node = object;
    for (;;) {
      if (node.visible === false) return null;
      if (!node.parent) return node;
      node = node.parent;
    }
  }

  function makeHolder(THREE) {
    const holder = new THREE.Group();
    holder.name = 'grass_billboard_render_chunks';
    holder.visible = false; // Shown only inside renderWorldPasses.
    holder.matrixAutoUpdate = false; // Copied from the source each render.
    holder.userData.noOutline = true;
    holder.userData.hobunjiGrassRenderChunkHolder = true;
    return holder;
  }

  function makeChunk(THREE, source, capacity) {
    const chunk = new THREE.InstancedMesh(source.geometry, source.material, capacity);
    chunk.name = 'grass_billboard_render_chunk';
    chunk.frustumCulled = false; // InstancedMeshViewCull is authoritative.
    chunk.raycast = noRaycast;
    chunk.matrixAutoUpdate = false; // Identity under the holder.
    chunk.userData.noOutline = true; // Never an inverted-hull outline source.
    chunk.userData.hobunjiGrassRenderChunk = true; // Deliberately NOT isBillboard: footprint/height writers must only touch the source.
    window.InstancedMeshBounds?.tag(chunk);
    return chunk;
  }

  function disposeChunk(holder, chunk) {
    holder.remove(chunk);
    chunk.dispose?.(); // Frees the instance buffer only; geometry and material belong to the source.
  }

  // Partition the source's live instances into CHUNK_TILES x CHUNK_TILES cells
  // of its local XZ, preserving their order inside each cell.
  function rebuild(record, source) {
    const THREE = window.THREE;
    const src = source.instanceMatrix.array;
    const count = Math.min(source.count, Math.floor(src.length / 16));
    const cellOf = new Float64Array(count); // Cell keys reach 2^32; an Int32Array would wrap them negative.
    const sizes = new Map();
    for (let i = 0; i < count; i++) {
      const x = src[i * 16 + 12], z = src[i * 16 + 14];
      const cell = Number.isFinite(x + z)
        ? ((Math.floor(x / CHUNK_TILES) + 32768) & 0xffff) * 65536 + ((Math.floor(z / CHUNK_TILES) + 32768) & 0xffff)
        : -1; // Non-finite instances never draw; drop them from every chunk.
      cellOf[i] = cell;
      if (cell >= 0) sizes.set(cell, (sizes.get(cell) || 0) + 1);
    }
    for (const [cell, chunk] of record.chunks) {
      const need = sizes.get(cell) || 0;
      if (!need || chunk.instanceMatrix.array.length < need * 16 || chunk.geometry !== source.geometry) {
        disposeChunk(record.holder, chunk);
        record.chunks.delete(cell);
      }
    }
    const fill = new Map();
    for (const [cell, need] of sizes) {
      let chunk = record.chunks.get(cell);
      if (!chunk) {
        chunk = makeChunk(THREE, source, Math.max(need, Math.ceil(need * 1.25))); // Headroom so small refills reuse the buffer.
        record.chunks.set(cell, chunk);
        record.holder.add(chunk);
      }
      fill.set(cell, { chunk, write: 0 });
    }
    for (let i = 0; i < count; i++) {
      const cell = cellOf[i];
      if (cell < 0) continue;
      const slot = fill.get(cell);
      slot.chunk.instanceMatrix.array.set(src.subarray(i * 16, i * 16 + 16), slot.write * 16);
      slot.write++;
    }
    for (const { chunk, write } of fill.values()) {
      chunk.count = write;
      chunk.instanceMatrix.needsUpdate = true; // New version also invalidates InstancedMeshBounds' cached sphere.
    }
    markCurrent(record, source);
    stats.rebuilds++;
  }

  function syncPresentation(record, source) {
    const holder = record.holder;
    if (holder.parent !== source.parent) {
      holder.parent?.remove(holder);
      source.parent.add(holder);
    }
    if (source.matrixAutoUpdate) source.updateMatrix();
    holder.matrix.copy(source.matrix);
    holder.updateMatrixWorld(true); // Parent world matrices are current: Three resolved them on the previous render.
    for (const chunk of record.chunks.values()) {
      chunk.material = source.material;
      chunk.layers.mask = source.layers.mask;
      chunk.renderOrder = source.renderOrder;
      chunk.castShadow = source.castShadow;
      chunk.receiveShadow = source.receiveShadow;
    }
  }

  function release(record) {
    for (const chunk of record.chunks.values()) disposeChunk(record.holder, chunk);
    record.chunks.clear();
    record.holder.parent?.remove(record.holder);
    record.built = false; record.geometry = null;
  }

  function register(source) {
    if (!source?.isInstancedMesh || !window.THREE?.Group) return source;
    for (const record of records) if (record.ref.deref() === source) return source;
    if (typeof WeakRef !== 'function') return source;
    records.push({ ref: new WeakRef(source), holder: makeHolder(window.THREE), chunks: new Map(), built: false,
      version: -1, count: -1, geometry: null, capacity: -1, live: null });
    return source;
  }

  function restore() {
    for (let i = 0; i < active.length; i++) {
      const record = active[i];
      record.holder.visible = false;
      record.live.visible = true;
      record.live = null; // Strong reference only for the duration of the render.
    }
    active.length = 0;
  }

  // Returns a restore closure (or null). The caller MUST invoke it in a
  // finally block around all world passes, before any gameplay code runs.
  function suspendForRender(activeScene) {
    if (!enabled || !activeScene?.isScene || !window.InstancedMeshBounds) return null;
    if (active.length) restore(); // Never leave a source hidden after a missed restore.
    let kept = 0, chunks = 0, instances = 0;
    for (let i = 0; i < records.length; i++) {
      const record = records[i], source = record.ref.deref();
      if (!source) { release(record); continue; }
      records[kept++] = record;
      if (!source.parent) { if (record.built) release(record); continue; } // Replaced or evicted mesh: drop its copies.
      if (!(source.count > 0) || drawnRoot(source) !== activeScene) continue;
      if (!isCurrent(record, source)) rebuild(record, source);
      syncPresentation(record, source);
      record.holder.visible = true;
      source.visible = false;
      record.live = source;
      active.push(record);
      chunks += record.chunks.size;
      instances += source.count;
    }
    records.length = kept;
    stats.sources = kept; stats.swapped = active.length; stats.chunks = chunks; stats.instances = instances;
    return active.length ? restore : null;
  }

  window.GrassBillboardRenderChunks = Object.freeze({
    register,
    suspendForRender,
    setEnabled(value) {
      enabled = value !== false;
      stats.enabled = enabled;
      if (!enabled) { restore(); for (const record of records) release(record); }
      return enabled;
    },
    get enabled() { return enabled; },
    snapshot: () => ({ ...stats, chunkTiles: CHUNK_TILES }),
  });
})();
