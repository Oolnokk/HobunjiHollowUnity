// Render-time batches for the wilderness's static props.
//
// A wilderness zone spawns many small props that each draw as several separate
// meshes: bandit and Porakaneki tents (8 two-triangle panels each), root
// totems, reagent herbs (two blade quads each), wild berry bushes, camp
// furniture (campfires, crate stacks, pedestals), cliff-door puzzle caves and
// Tzatzul nests. A headless draw census of Northern Cliffs counted ~1,700 draws
// in one frame, several hundred of them these props, and the game is CPU-bound
// on draw submission on players' machines (GPU 8-17% busy; see
// docs/architecture/performance-investigation-log.md).
//
// Same contract as js/farm-tile-render-batches.js: the props stay the single
// authority for gameplay, picking, raycasts, editors and every other system.
// For the synchronous world render only (game.js renderWorldPasses), still,
// eligible prop meshes are hidden and drawn instead as one world-space merged
// mesh per 8x8-tile cell and identical render state (material, layers, shadow
// flags, render order, vertex layout, owner kind). Anything that cannot be
// reproduced exactly by a merged copy is left alone:
//   - moving meshes: a prop whose world matrix or geometry changed within the
//     last STILL_MS is drawn normally until it settles (flames, billboards that
//     turn to the camera, doors mid-swing, a harvest animation);
//   - transparent materials (a merged copy would lose per-object depth sort),
//     custom onBeforeRender hooks, array materials, morph/skinned/instanced
//     meshes, partial draw ranges;
//   - ShaderMaterials and onBeforeCompile shaders, unless the material is
//     marked userData.hobunjiWorldBakeSafe (its vertex stage reads nothing
//     per-object from modelMatrix beyond the vertex position, so baking the
//     vertices into world space draws the same pixels).
// A batch is rebuilt only when its member set, a member's world matrix or its
// geometry/attribute versions change. ZonePropRenderBatches.setEnabled(false)
// is the A/B switch; snapshot() reports counts and per-reason rejections.
(() => {
  'use strict';
  if (window.ZonePropRenderBatches) return;

  const CELL_TILES = 8;
  const STILL_MS = 1000; // A prop must hold still this long before it joins a batch.
  const ATTRIBUTE_NAMES = ['position', 'normal', 'uv', 'color'];
  // Owner tags: the nearest ancestor carrying one of these userData keys decides whether a mesh is a batchable prop, and its kind.
  const OWNER_TAGS = [
    ['projectileCoverKind', 'tent'], // bandit-camps.js / porakaneki-camps-runtime.js tents.
    ['berryKey', 'berry'], // wild-berries.js bushes.
    ['reagentKey', 'reagent'], // reagent-plants.js herbs.
    ['rootTotemWorldVisual', 'rootTotem'], // zone-den-totem-features.js world totems.
    ['authoredFurnitureKey', 'furniture'], // Authored camp/locale furniture placed in a zone.
    ['tzatzulNest', 'tzatzulNest'],
  ];
  const OWNER_NAME_PREFIXES = [['puzzle-cave-cliff-door-puzzle', 'cliffDoorPuzzle']];
  const RESCAN_MS = 1000; // Owner roots are found by a full scene walk at most this often; each frame walks only their subtrees.
  // Ancestor flags copied onto a batch so the held-object/x-ray classifiers treat it like its members.
  const CARRIED_FLAG_PATTERN = /^(hobunji|is|surface|ground|background|noOutline|skipOcclusionFade|terrain|cameraObstacle)/;

  let enabled = true;
  const records = new WeakMap(); // scene -> { holder, batches: Map<key, batch> }
  const motion = new WeakMap(); // mesh -> { sig: Float64Array, stillSince }
  const stats = { frames: 0, sources: 0, batches: 0, rebuilds: 0, moving: 0, drawsSaved: 0 };
  const rejectReasons = {};
  const defaultBeforeRender = window.THREE?.Object3D?.prototype?.onBeforeRender;
  const defaultBeforeCompile = window.THREE?.Material?.prototype?.onBeforeCompile;
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let currentKind = '';
  function reject(reason) { const key = currentKind ? currentKind + ':' + reason : reason; rejectReasons[key] = (rejectReasons[key] || 0) + 1; return false; }
  function noRaycast() {}

  function ownerOf(mesh) {
    for (let o = mesh; o && !o.isScene; o = o.parent) {
      const data = o.userData;
      if (data) for (const [tag, kind] of OWNER_TAGS) if (data[tag] !== undefined && data[tag] !== null && data[tag] !== false) return { root: o, kind };
      const name = o.name;
      if (name) for (const [prefix, kind] of OWNER_NAME_PREFIXES) if (name.startsWith(prefix)) return { root: o, kind };
    }
    return null;
  }

  function effectivelyVisible(object) {
    for (let o = object; o; o = o.parent) if (o.visible === false) return false;
    return true;
  }

  function materialEligible(material) {
    if (!material || Array.isArray(material)) return reject('multiMaterial');
    if (material.transparent) return reject('transparent');
    const custom = material.isShaderMaterial || material.isRawShaderMaterial || (defaultBeforeCompile && material.onBeforeCompile !== defaultBeforeCompile);
    if (custom && material.userData?.hobunjiWorldBakeSafe !== true) return reject('customShader');
    return true;
  }

  // A built-in material's shader reads only the standard attributes, so any other attribute (e.g. a rock's rockSourceFace
  // bookkeeping) is simply not carried into the batch. A custom (bake-safe) shader might read it, so it must not have one.
  function geometryEligible(geometry, builtInMaterial) {
    const a = geometry?.attributes;
    if (!a?.position) return reject('noPosition');
    for (const name of ATTRIBUTE_NAMES) if (a[name]?.isInterleavedBufferAttribute) return reject('interleaved');
    if (!builtInMaterial) for (const name of Object.keys(a)) if (!ATTRIBUTE_NAMES.includes(name)) return reject('attribute:' + name);
    if (a.position.itemSize !== 3 || (a.normal && a.normal.itemSize !== 3) || (a.uv && a.uv.itemSize !== 2) || (a.color && a.color.itemSize !== 3 && a.color.itemSize !== 4)) return reject('itemSize');
    if (Object.keys(geometry.morphAttributes || {}).length) return reject('morph');
    const fullCount = geometry.index ? geometry.index.count : a.position.count;
    if (geometry.drawRange && (geometry.drawRange.start !== 0 || (Number.isFinite(geometry.drawRange.count) && geometry.drawRange.count !== fullCount))) return reject('drawRange');
    return true;
  }

  function eligible(mesh) {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh) return false;
    if (mesh.userData?.hobunjiZonePropBatch) return false;
    if (mesh.onBeforeRender !== defaultBeforeRender) return reject('hook');
    if (!materialEligible(mesh.material)) return false;
    const material = mesh.material, builtIn = !material.isShaderMaterial && !material.isRawShaderMaterial && (!defaultBeforeCompile || material.onBeforeCompile === defaultBeforeCompile);
    return geometryEligible(mesh.geometry, builtIn);
  }

  // Per-mesh motion signature: world matrix + geometry identity/versions. Any change restarts the still timer.
  const SIG = 22;
  function writeSignature(out, mesh) {
    const e = mesh.matrixWorld.elements, g = mesh.geometry, a = g.attributes;
    for (let i = 0; i < 16; i++) out[i] = e[i];
    out[16] = g.id;
    out[17] = a.position.version;
    out[18] = a.normal ? a.normal.version : -1;
    out[19] = a.uv ? a.uv.version : -1;
    out[20] = a.color ? a.color.version : -1;
    out[21] = g.index ? g.index.version : -1;
  }
  const scratchSig = new Float64Array(SIG);
  function isStill(mesh, t) {
    writeSignature(scratchSig, mesh);
    let entry = motion.get(mesh);
    if (!entry) { entry = { sig: new Float64Array(SIG), stillSince: t }; entry.sig.set(scratchSig); motion.set(mesh, entry); return false; } // First sight: a fresh spawn's world matrix may not be computed yet, so it waits out STILL_MS like a moving prop.
    let changed = false;
    for (let i = 0; i < SIG; i++) if (entry.sig[i] !== scratchSig[i]) { changed = true; break; }
    if (changed) { entry.sig.set(scratchSig); entry.stillSince = t; }
    return t - entry.stillSince >= STILL_MS;
  }

  function vertexLayoutKey(geometry) {
    const a = geometry.attributes;
    return (a.normal ? 'n' : '') + (a.uv ? 'u' : '') + (a.color ? 'c' + a.color.itemSize : '');
  }

  function groupKey(mesh, owner) {
    const e = mesh.matrixWorld.elements;
    const cx = Math.floor(e[12] / CELL_TILES), cz = Math.floor(e[14] / CELL_TILES);
    return cx + ',' + cz + '|' + owner.kind + '|' + mesh.material.id + '|' + (mesh.layers.mask >>> 0) + '|' + (mesh.castShadow ? 1 : 0) + (mesh.receiveShadow ? 1 : 0)
      + '|' + mesh.renderOrder + '|' + vertexLayoutKey(mesh.geometry);
  }

  function isCurrent(batch, members) {
    if (!batch.mesh || batch.members.length !== members.length) return false;
    for (let i = 0; i < members.length; i++) {
      const mesh = members[i];
      if (batch.members[i] !== mesh) return false;
      const entry = motion.get(mesh);
      if (!entry || entry.stillSince > batch.builtAt) return false;
    }
    return true;
  }

  // Bakes each member into world space. Normals use the inverse-transpose so non-uniform scale stays lit correctly, and a
  // mirrored member (negative determinant) has its triangle winding flipped so face culling keeps the same side.
  function mergeWorldGeometry(THREE, members) {
    const layout = members[0].geometry.attributes;
    const hasNormal = !!layout.normal, hasUv = !!layout.uv, colorSize = layout.color ? layout.color.itemSize : 0;
    let vertexCount = 0, indexCount = 0;
    for (const mesh of members) {
      const g = mesh.geometry;
      vertexCount += g.attributes.position.count;
      indexCount += g.index ? g.index.count : g.attributes.position.count;
    }
    const position = new Float32Array(vertexCount * 3);
    const normal = hasNormal ? new Float32Array(vertexCount * 3) : null;
    const uv = hasUv ? new Float32Array(vertexCount * 2) : null;
    const color = colorSize ? new Float32Array(vertexCount * colorSize) : null;
    const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    const normalMatrix = new THREE.Matrix3();
    let v = 0, ix = 0;
    for (const mesh of members) {
      const g = mesh.geometry, a = g.attributes, e = mesh.matrixWorld.elements;
      const p = a.position;
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      const n3 = normalMatrix.elements;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), o = (v + i) * 3;
        position[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
        position[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        position[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        if (normal) {
          const nx = a.normal.getX(i), ny = a.normal.getY(i), nz = a.normal.getZ(i);
          const wx = n3[0] * nx + n3[3] * ny + n3[6] * nz, wy = n3[1] * nx + n3[4] * ny + n3[7] * nz, wz = n3[2] * nx + n3[5] * ny + n3[8] * nz;
          const len = Math.hypot(wx, wy, wz) || 1;
          normal[o] = wx / len; normal[o + 1] = wy / len; normal[o + 2] = wz / len;
        }
        if (uv) { uv[(v + i) * 2] = a.uv.getX(i); uv[(v + i) * 2 + 1] = a.uv.getY(i); }
        if (color) for (let k = 0; k < colorSize; k++) color[(v + i) * colorSize + k] = a.color.array[i * colorSize + k];
      }
      const det = e[0] * (e[5] * e[10] - e[6] * e[9]) - e[4] * (e[1] * e[10] - e[2] * e[9]) + e[8] * (e[1] * e[6] - e[2] * e[5]);
      const count = g.index ? g.index.count : p.count;
      const at = g.index ? (i => g.index.getX(i)) : (i => i);
      for (let i = 0; i + 2 < count; i += 3) {
        const i0 = at(i), i1 = at(i + 1), i2 = at(i + 2);
        index[ix++] = i0 + v;
        if (det < 0) { index[ix++] = i2 + v; index[ix++] = i1 + v; } else { index[ix++] = i1 + v; index[ix++] = i2 + v; }
      }
      v += p.count;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    if (normal) geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    if (uv) geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (color) geometry.setAttribute('color', new THREE.BufferAttribute(color, colorSize));
    geometry.setIndex(new THREE.BufferAttribute(index.subarray(0, ix), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function carriedUserData(members, owner) {
    const data = {};
    const copy = source => { for (const key of Object.keys(source || {})) { const value = source[key]; if (CARRIED_FLAG_PATTERN.test(key) && (value === true || typeof value === 'string' || typeof value === 'number')) data[key] = value; } };
    for (let o = owner.root; o && !o.isScene; o = o.parent) copy(o.userData); // Owner and its containers (e.g. backgroundScenery on a group).
    copy(members[0].userData);
    data.hobunjiZonePropBatch = true;
    data.hobunjiZonePropKind = owner.kind;
    return data;
  }

  function buildBatch(THREE, record, batch, members, owner, t) {
    const first = members[0];
    const geometry = mergeWorldGeometry(THREE, members);
    if (!batch.mesh) {
      batch.mesh = new THREE.Mesh(geometry, first.material);
      batch.mesh.name = 'zone_prop_render_batch';
      batch.mesh.matrixAutoUpdate = false; // World-space geometry under an identity holder.
      batch.mesh.raycast = noRaycast; // The props themselves keep answering raycasts.
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
    mesh.userData = carriedUserData(members, owner);
    batch.members = members.slice();
    batch.builtAt = t;
    stats.rebuilds++;
  }

  function recordFor(scene) {
    let record = records.get(scene);
    if (!record) {
      const holder = new window.THREE.Group();
      holder.name = 'zone_prop_render_batches';
      holder.visible = false; // Shown only inside renderWorldPasses.
      holder.matrixAutoUpdate = false;
      holder.userData.hobunjiZonePropBatchHolder = true;
      record = { holder, batches: new Map(), roots: null, scannedAt: 0 };
      records.set(scene, record);
    }
    if (record.holder.parent !== scene) scene.add(record.holder);
    return record;
  }

  function ownerKindOf(object) {
    const data = object.userData;
    if (data) for (const [tag, kind] of OWNER_TAGS) if (data[tag] !== undefined && data[tag] !== null && data[tag] !== false) return kind;
    const name = object.name;
    if (name) for (const [prefix, kind] of OWNER_NAME_PREFIXES) if (name.startsWith(prefix)) return kind;
    return null;
  }

  // Outermost owner roots in the scene (an owner nested inside another owner is walked as part of it).
  function scanOwnerRoots(scene) {
    const roots = [];
    const stack = scene.children.slice();
    while (stack.length) {
      const object = stack.pop();
      if (object.userData?.hobunjiZonePropBatchHolder || object.isMesh && !object.children.length && !ownerKindOf(object)) continue;
      if (ownerKindOf(object)) { roots.push(object); continue; }
      const children = object.children;
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
    return roots;
  }

  function attachedTo(object, scene) {
    let o = object;
    while (o.parent) o = o.parent;
    return o === scene;
  }

  function collect(scene, record, t, groups) {
    if (!record.roots || t - record.scannedAt >= RESCAN_MS) { record.roots = scanOwnerRoots(scene); record.scannedAt = t; }
    let sources = 0;
    const stack = [];
    for (const root of record.roots) if (effectivelyVisible(root) && attachedTo(root, scene)) stack.push(root);
    while (stack.length) {
      const object = stack.pop();
      if (object.visible === false) continue; // A hidden subtree draws nothing.
      if (object.isMesh) {
        const owner = ownerOf(object);
        if (owner) currentKind = owner.kind;
        if (owner && eligible(object)) {
          if (!isStill(object, t)) { stats.moving++; }
          else {
            const key = groupKey(object, owner);
            let group = groups.get(key);
            if (!group) { group = { owner, members: [] }; groups.set(key, group); }
            group.members.push(object);
            sources++;
          }
        }
      }
      const children = object.children;
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
    return sources;
  }

  // Returns a restore function, or null when nothing was swapped.
  function suspendForRender(scene, { isZone = false } = {}) {
    if (!enabled || !isZone || !scene?.isScene || window.THREE == null) return null;
    stats.frames++;
    stats.moving = 0;
    for (const key of Object.keys(rejectReasons)) delete rejectReasons[key];
    const t = now();
    // World matrices are last render's (no extra scene-wide update): a prop that starts moving this frame is drawn one frame
    // at its previous pose, then its changed matrix drops it out of the batch until it settles again.
    const record = recordFor(scene);
    const groups = new Map();
    if (!collect(scene, record, t, groups)) {
      for (const batch of record.batches.values()) { record.holder.remove(batch.mesh); batch.mesh.geometry.dispose(); }
      record.batches.clear();
      return null;
    }
    const THREE = window.THREE;
    for (const [key, batch] of record.batches) {
      if ((groups.get(key)?.members.length || 0) >= 2) continue;
      record.holder.remove(batch.mesh);
      batch.mesh.geometry.dispose(); // The material belongs to the props.
      record.batches.delete(key);
    }
    const hidden = [];
    for (const [key, group] of groups) {
      const members = group.members;
      if (members.length < 2) continue; // A lone mesh gains nothing; leave it as it is.
      let batch = record.batches.get(key);
      if (!batch) { batch = { mesh: null, members: [], builtAt: 0 }; record.batches.set(key, batch); }
      if (!isCurrent(batch, members)) buildBatch(THREE, record, batch, members, group.owner, t);
      batch.mesh.visible = true;
      for (const member of members) { member.visible = false; hidden.push(member); }
    }
    if (!hidden.length) return null;
    record.holder.visible = true;
    stats.sources = hidden.length;
    stats.batches = record.batches.size;
    stats.drawsSaved = hidden.length - record.batches.size;
    return function restoreZonePropBatches() {
      for (const mesh of hidden) mesh.visible = true;
      record.holder.visible = false;
    };
  }

  function setEnabled(value) {
    enabled = value !== false;
    return enabled;
  }

  window.ZonePropRenderBatches = {
    suspendForRender,
    setEnabled,
    snapshot: () => ({ enabled, cellTiles: CELL_TILES, stillMs: STILL_MS, ...stats, rejectReasons: { ...rejectReasons } }),
  };
})();
