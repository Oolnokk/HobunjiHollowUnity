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
//     custom onBeforeRender hooks, morph/skinned/instanced meshes, partial
//     draw ranges, and material arrays with more than one distinct material
//     (an array that repeats ONE material over groups that cover the whole
//     geometry, like the natural rocks' ridge-isolated top/side slots, draws
//     the same as that material alone);
//   - ShaderMaterials and onBeforeCompile shaders, unless the material is
//     marked userData.hobunjiWorldBakeSafe (its vertex stage reads nothing
//     per-object from modelMatrix beyond the vertex position, so baking the
//     vertices into world space draws the same pixels), or its compile hook
//     declares itself bake-safe (onBeforeCompile.__hobunjiWorldBakeSafe; the
//     held-object x-ray elevation shader does when what it wraps is).
// Cells are chosen by each mesh's world-space geometry centre, not its origin:
// ore rocks (faceted-rocks.js) are built with world-space vertices under an
// identity transform, so their origins all sit at 0,0.
// A batch is rebuilt only when its member set, a member's world matrix or its
// geometry/attribute versions change. Dirty groups repair independently between timed discoveries. ZonePropRenderBatches.setEnabled(false)
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
    ['facetedOreRock', 'oreRock'], // faceted-rocks.js ore rock groups (wilderness loose ore).
  ];
  const OWNER_NAME_PREFIXES = [['puzzle-cave-cliff-door-puzzle', 'cliffDoorPuzzle']];
  const RESCAN_MS = 1000; // Owner roots are found by a full scene walk at most this often; each frame walks only their subtrees.
  const STABLE_COLLECT_MS = 300; // Full owner/group discovery is spaced out only while existing batch members remain valid.
  // Ancestor flags copied onto a batch so the held-object/x-ray classifiers treat it like its members.
  const CARRIED_FLAG_PATTERN = /^(hobunji|is|surface|ground|background|noOutline|skipOcclusionFade|terrain|cameraObstacle)/;

  let enabled = true;
  const records = new WeakMap(); // scene -> { holder, batches: Map<key, batch> }
  const motion = new WeakMap(); // mesh -> last matrix, geometry/attribute references, versions and stillSince.
  const stats = { frames: 0, sources: 0, batches: 0, rebuilds: 0, moving: 0, drawsSaved: 0, fastReuseFrames: 0, fullCollects: 0, partialRepairFrames: 0, repairedGroups: 0, emptyReuseFrames: 0 };
  const rejectReasons = {};
  const defaultBeforeRender = window.THREE?.Object3D?.prototype?.onBeforeRender;
  const defaultAfterRender = window.THREE?.Object3D?.prototype?.onAfterRender;
  const defaultBeforeCompile = window.THREE?.Material?.prototype?.onBeforeCompile;
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let currentKind = '';
  function reject(reason) { const key = currentKind ? currentKind + ':' + reason : reason; rejectReasons[key] = (rejectReasons[key] || 0) + 1; return false; }
  function noRaycast() {}

  // Memoize nearest ownership for this collection only. Shared parents
  // (furniture and vegetation assemblies) no longer repeat tag/name scans
  // for every member. The next collection observes any reparent or tag edit.
  function ownerOf(mesh, owners) {
    if (!mesh || mesh.isScene) return null;
    if (owners.has(mesh)) return owners.get(mesh);
    const kind = ownerKindOf(mesh); // Nearest tagged ancestor still wins.
    const owner = kind ? { root: mesh, kind } : ownerOf(mesh.parent, owners);
    owners.set(mesh, owner);
    return owner;
  }

  // Combine the attachment and effective-visibility checks in a single
  // ancestor walk. This is called for every settled batch member each frame.
  function visibleInScene(object, scene) {
    for (let o = object; o; o = o.parent) {
      if (o.visible === false) return false;
      if (!o.parent) return o === scene;
    }
    return false;
  }

  // The one material a mesh draws with: itself, or the single material an array repeats over groups that tile the whole
  // geometry (each group would be one more draw of the same program and state). Anything else: null.
  function drawnMaterial(mesh) {
    const material = mesh.material;
    if (!Array.isArray(material)) return material || null;
    const first = material[0];
    if (!first) return null;
    for (let i = 1; i < material.length; i++) if (material[i] !== first) return null;
    const geometry = mesh.geometry, groups = geometry?.groups;
    if (!groups?.length) return null; // three draws nothing for an array material without groups.
    const fullCount = geometry.index ? geometry.index.count : geometry.attributes?.position?.count;
    let end = 0;
    for (const group of groups) { // Contiguous, in order, every slot real: the merged draw covers exactly these triangles.
      if (group.start !== end || !(group.count > 0) || material[group.materialIndex] !== first) return null;
      end += group.count;
    }
    return end === fullCount ? first : null;
  }

  function isCustomShader(material) {
    return material.isShaderMaterial || material.isRawShaderMaterial || (!!defaultBeforeCompile && material.onBeforeCompile !== defaultBeforeCompile);
  }

  function bakeSafe(material) {
    if (material.userData?.hobunjiWorldBakeSafe === true) return true;
    if (material.isShaderMaterial || material.isRawShaderMaterial) return false; // A whole custom program: only its owner can vouch for it.
    return material.onBeforeCompile?.__hobunjiWorldBakeSafe === true;
  }

  // Immutable shared authored images are tested once at native resolution.
  // Run small readback slices off the render path; unknown/tainted alpha
  // always leaves the original transparent material in place.
  const furnitureAlphaProof = new WeakMap(); // Image -> pending/opaque/transparent.
  const furnitureProofQueue = []; // Serial, bounded alpha-proof jobs.
  let furnitureProofScheduled = false;
  function queueFurnitureProof() {
    if (furnitureProofScheduled || !furnitureProofQueue.length) return;
    furnitureProofScheduled = true;
    setTimeout(runFurnitureProof, 16);
  }
  function runFurnitureProof() {
    furnitureProofScheduled = false;
    const job = furnitureProofQueue[0];
    if (!job) return;
    let done = false;
    try {
      const rows = Math.min(32, job.height - job.y);
      if (!job.canvas) {
        job.canvas = document.createElement('canvas');
        job.canvas.width = job.width;
        job.canvas.height = 32;
        job.ctx = job.canvas.getContext('2d', { willReadFrequently: true });
      }
      job.ctx.clearRect(0, 0, job.width, rows);
      job.ctx.drawImage(job.image, 0, job.y, job.width, rows, 0, 0, job.width, rows);
      const rgba = job.ctx.getImageData(0, 0, job.width, rows).data;
      for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] !== 255) { done = true; break; }
      }
      if (done) furnitureAlphaProof.set(job.image, 'transparent');
      else {
        job.y += rows;
        if (job.y >= job.height) { furnitureAlphaProof.set(job.image, 'opaque'); done = true; }
      }
    } catch (_) { furnitureAlphaProof.set(job.image, 'transparent'); done = true; }
    if (done) {
      if (job.canvas) job.canvas.width = job.canvas.height = 0;
      furnitureProofQueue.shift();
    }
    queueFurnitureProof();
  }
  function furnitureTextureOpaque(texture) {
    if (!texture) return true;
    if (texture.userData?.furnitureShared !== true) return false;
    const image = texture.image;
    const width = Number(image?.naturalWidth || image?.width);
    const height = Number(image?.naturalHeight || image?.height);
    if (!image || !(width > 0 && height > 0) || image.complete === false) return false;
    const proof = furnitureAlphaProof.get(image);
    if (proof) return proof === 'opaque';
    if (typeof document === 'undefined' || furnitureProofQueue.length >= 24) return false;
    furnitureAlphaProof.set(image, 'pending');
    furnitureProofQueue.push({ image, width, height, y: 0 });
    queueFurnitureProof();
    return false;
  }

  // No source material sharing: puzzle emissions, liquids, and interactive
  // furniture retain independent materials. Only compatible leaf parts get
  // a render-only clone; live edits invalidate the material key immediately.
  const FURNITURE_STATE_FIELDS = ['type', 'emissiveIntensity', 'side', 'shadowSide',
    'depthFunc', 'alphaTest', 'fog', 'toneMapped', 'dithering', 'flatShading',
    'transparent', 'reflectivity', 'refractionRatio', 'combine']; // Used by full key and allocation-free fast matching.
  function furnitureMaterialEligible(mesh, material = drawnMaterial(mesh)) {
    const part = mesh.userData?.authoredPart;
    const T = window.THREE;
    if (!part || !mesh.parent?.userData?.authoredFurnitureKey
      || part.kind === 'liquidSurface' || part.kind === 'banner'
      || part.kind === 'transparentBillboardSurface' || mesh.children?.length
      || mesh.customDepthMaterial || mesh.customDistanceMaterial
      || mesh.onAfterRender !== defaultAfterRender
      || (T.Material?.prototype?.customProgramCacheKey && material?.customProgramCacheKey !== T.Material.prototype.customProgramCacheKey)
      || !material || !(material.isMeshBasicMaterial || material.isMeshLambertMaterial)
      || isCustomShader(material) || material.visible === false
      || material.opacity !== 1 || !material.depthWrite || !material.depthTest || !material.colorWrite
      || material.blending !== T.NormalBlending || material.wireframe || material.vertexColors
      || material.premultipliedAlpha || material.stencilWrite || material.clippingPlanes?.length
      || material.alphaToCoverage || material.polygonOffset || material.alphaMap
      || material.lightMap || material.aoMap || material.envMap || material.emissiveMap
      || material.specularMap || material.map && material.map.userData?.furnitureShared !== true
      || material.transparent && !furnitureTextureOpaque(material.map)) return null;
    return !!material.color;
  }
  function furnitureMaterialKey(mesh, material = drawnMaterial(mesh)) {
    if (!furnitureMaterialEligible(mesh, material)) return null;
    const color = material.color, emissive = material.emissive;
    return ['furniture', material.map?.id ?? '-', material.map?.version ?? '-',
      color.r, color.g, color.b, emissive?.r, emissive?.g, emissive?.b,
      ...FURNITURE_STATE_FIELDS.map(field => material[field])].join('|');
  }
  function carriedLeafFlag(key, value) {
    return CARRIED_FLAG_PATTERN.test(key) && (value === true || typeof value === 'string' || typeof value === 'number');
  }
  function captureFurnitureState(mesh, material) {
    const flags = Object.create(null); // Leaf flags affecting replay classifications.
    for (const key in mesh.userData) if (carriedLeafFlag(key, mesh.userData[key])) flags[key] = mesh.userData[key];
    return { parent: mesh.parent, map: material.map, mapVersion: material.map?.version,
      color: [material.color.r, material.color.g, material.color.b],
      emissive: [material.emissive?.r, material.emissive?.g, material.emissive?.b],
      values: FURNITURE_STATE_FIELDS.map(field => material[field]), flags,
      flagCount: Object.keys(flags).length };
  }
  function furnitureStateMatches(mesh, state) {
    const material = drawnMaterial(mesh);
    if (mesh.parent !== state.parent || !furnitureMaterialEligible(mesh, material)
      || material.map !== state.map || material.map?.version !== state.mapVersion
      || material.color.r !== state.color[0] || material.color.g !== state.color[1] || material.color.b !== state.color[2]
      || material.emissive?.r !== state.emissive[0] || material.emissive?.g !== state.emissive[1] || material.emissive?.b !== state.emissive[2]) return false;
    for (let i = 0; i < FURNITURE_STATE_FIELDS.length; i++) if (material[FURNITURE_STATE_FIELDS[i]] !== state.values[i]) return false;
    let count = 0;
    for (const key in mesh.userData) {
      const value = mesh.userData[key];
      if (!carriedLeafFlag(key, value)) continue;
      if (state.flags[key] !== value) return false;
      count++;
    }
    return count === state.flagCount;
  }

  function materialEligible(material) {
    if (!material) return reject('multiMaterial');
    if (material.transparent) return reject('transparent');
    if (isCustomShader(material) && !bakeSafe(material)) return reject('customShader');
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
    const material = drawnMaterial(mesh);
    if (!(currentKind === 'furniture' && furnitureMaterialKey(mesh, material)) && !materialEligible(material)) return false;
    return geometryEligible(mesh.geometry, !isCustomShader(material));
  }

  // Compare live references/versions and matrices directly. The old path
  // wrote 27 scratch slots and resolved five WeakMap attribute IDs on every
  // settled member, only to discover that none of those values changed.
  function sameMotion(entry, mesh) {
    const g = mesh.geometry, a = g.attributes;
    if (entry.geometry !== g || entry.position !== a.position || entry.normal !== a.normal
      || entry.uv !== a.uv || entry.color !== a.color || entry.index !== g.index
      || entry.positionVersion !== a.position.version || entry.normalVersion !== a.normal?.version
      || entry.uvVersion !== a.uv?.version || entry.colorVersion !== a.color?.version
      || entry.indexVersion !== g.index?.version) return false;
    const e = mesh.matrixWorld.elements, previous = entry.matrix;
    for (let i = 0; i < 16; i++) if (previous[i] !== e[i]) return false;
    return true;
  }

  function captureMotion(entry, mesh, t) {
    const g = mesh.geometry, a = g.attributes;
    entry.geometry = g;
    entry.position = a.position; entry.positionVersion = a.position.version;
    entry.normal = a.normal; entry.normalVersion = a.normal?.version;
    entry.uv = a.uv; entry.uvVersion = a.uv?.version;
    entry.color = a.color; entry.colorVersion = a.color?.version;
    entry.index = g.index; entry.indexVersion = g.index?.version;
    entry.matrix.set(mesh.matrixWorld.elements);
    entry.stillSince = t;
  }

  function isStill(mesh, t) {
    let entry = motion.get(mesh);
    if (!entry) {
      entry = { matrix: new Float64Array(16), stillSince: t }; // Used only by this source's motion/geometry invalidation.
      motion.set(mesh, entry);
      captureMotion(entry, mesh, t);
      return false;
    }
    if (!sameMotion(entry, mesh)) captureMotion(entry, mesh, t);
    return t - entry.stillSince >= STILL_MS;
  }

  function vertexLayoutKey(geometry) {
    const a = geometry.attributes;
    return (a.normal ? 'n' : '') + (a.uv ? 'u' : '') + (a.color ? 'c' + a.color.itemSize : '');
  }

  function groupKey(mesh, owner) {
    const e = mesh.matrixWorld.elements, geometry = mesh.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere(); // Three computes it for frustum culling anyway.
    const c = geometry.boundingSphere.center;
    const wx = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12], wz = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
    const cx = Math.floor(wx / CELL_TILES), cz = Math.floor(wz / CELL_TILES);
    const furnitureKey = owner.kind === 'furniture' ? furnitureMaterialKey(mesh) : null;
    // Limit equivalent materials to direct siblings of the same placement.
    // All flags copied by the replay classifier must also agree.
    const materialKey = furnitureKey ? owner.root.id + '|' + furnitureKey + '|' +
      Object.keys(mesh.userData || {}).filter(k => carriedLeafFlag(k, mesh.userData[k])).sort()
        .map(k => k + ':' + String(mesh.userData[k])).join(',') : drawnMaterial(mesh).id;
    return cx + ',' + cz + '|' + owner.kind + '|' + materialKey + '|' + (mesh.layers.mask >>> 0) + '|' + (mesh.castShadow ? 1 : 0) + (mesh.receiveShadow ? 1 : 0)
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
    data.hobunjiRenderProxy = true; // A render-only copy of final member vertices: add-time surface passes must not re-unwrap it (natural-surface-stretch-runtime.js, natural-surface-runtime-fixes.js).
    return data;
  }

  function markBatchMembershipChanged(scene) {
    const data = scene.userData; // Consumed by WildernessDistanceCull before this frame's world render.
    data.hobunjiZonePropBatchRevision = (data.hobunjiZonePropBatchRevision || 0) + 1;
  }

  function buildBatch(THREE, record, batch, members, owner, t) {
    const first = members[0];
    const furnitureKey = owner.kind === 'furniture' ? furnitureMaterialKey(first) : null;
    const geometry = mergeWorldGeometry(THREE, members);
    if (!batch.mesh) {
      const material = furnitureKey ? drawnMaterial(first).clone() : drawnMaterial(first);
      if (furnitureKey) material.transparent = false; // Original source never changes.
      batch.furnitureKey = furnitureKey;
      batch.furnitureState = furnitureKey ? captureFurnitureState(first, drawnMaterial(first)) : null;
      batch.mesh = new THREE.Mesh(geometry, material);
      batch.mesh.name = 'zone_prop_render_batch';
      batch.mesh.matrixAutoUpdate = false; // World-space geometry under an identity holder.
      batch.mesh.raycast = noRaycast; // The props themselves keep answering raycasts.
      batch.mesh.userData = carriedUserData(members, owner); // Before add(): add-time classifiers read it.
      record.holder.add(batch.mesh);
    } else {
      batch.mesh.geometry.dispose();
      batch.mesh.geometry = geometry;
    }
    const mesh = batch.mesh;
    if (!batch.furnitureKey) mesh.material = drawnMaterial(first);
    mesh.layers.mask = first.layers.mask;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.userData = carriedUserData(members, owner);
    batch.members = members.slice();
    batch.builtAt = t;
    markBatchMembershipChanged(record.holder.parent); // New/rebuilt mesh must enter distance culling immediately.
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
      record = { holder, batches: new Map(), roots: null, scannedAt: 0, collectedAt: -Infinity };
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

  function collect(scene, record, t, groups) {
    if (!record.roots || t - record.scannedAt >= RESCAN_MS) { record.roots = scanOwnerRoots(scene); record.scannedAt = t; }
    let sources = 0;
    const owners = new Map(); // Shared nearest-owner lookups during this collection.
    const stack = [];
    for (const root of record.roots) if (visibleInScene(root, scene)) stack.push(root);
    while (stack.length) {
      const object = stack.pop();
      if (object.visible === false) continue; // A hidden subtree draws nothing.
      if (object.isMesh) {
        const owner = ownerOf(object, owners);
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

  // A material or geometry can become unbatchable without changing its
  // matrix or buffer version (for example a drawRange edit or shader hook).
  // Recheck those small render contracts on the fast path, without constructing
  // owner groups or allocating attribute-name arrays per frame.
  function settledMemberEligible(mesh, material) {
    const geometry = mesh.geometry;
    if (!material || material.transparent || !geometry?.attributes?.position) return false;
    const custom = isCustomShader(material);
    if (custom && !bakeSafe(material)) return false;
    const fullCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    const drawRange = geometry.drawRange;
    if (drawRange && (drawRange.start !== 0 || (Number.isFinite(drawRange.count) && drawRange.count !== fullCount))) return false;
    for (const name in geometry.morphAttributes) return false; // Any added morph channel makes the old bake invalid.
    if (custom) for (const name in geometry.attributes) if (!ATTRIBUTE_NAMES.includes(name)) return false;
    return true;
  }

  function settledMemberMatches(member, batch, scene, t) {
    const drawn = batch.mesh; // Fast comparison against the existing proxy's state.
    return visibleInScene(member, scene)
      && member.isMesh && !member.isInstancedMesh && !member.isSkinnedMesh
      && member.onBeforeRender === defaultBeforeRender
      && (batch.furnitureState ? furnitureStateMatches(member, batch.furnitureState)
        : (Array.isArray(member.material) ? drawnMaterial(member) : member.material) === drawn.material)
      && member.layers.mask === drawn.layers.mask
      && member.castShadow === drawn.castShadow && member.receiveShadow === drawn.receiveShadow
      && member.renderOrder === drawn.renderOrder && settledMemberEligible(member, drawn.material)
      && isStill(member, t);
  }

  // A dirty cell/material group can be repaired from its own original members.
  // New members and migrations into other groups wait for normal discovery,
  // drawing as originals until then. Unrelated groups never need recollection.
  function repairSettledBatch(scene, record, key, batch, t) {
    const owners = new Map(); // Nearest-owner cache scoped to this dirty group.
    const members = []; // Only still-eligible members with the original group key.
    let owner = null;
    for (const member of batch.members) {
      if (!visibleInScene(member, scene)) continue;
      const candidateOwner = ownerOf(member, owners);
      if (!candidateOwner) continue;
      currentKind = candidateOwner.kind;
      if (!eligible(member)) continue;
      if (!isStill(member, t)) { stats.moving++; continue; }
      if (groupKey(member, candidateOwner) !== key) continue;
      owner ||= candidateOwner;
      members.push(member);
    }
    record.holder.remove(batch.mesh);
    disposeBatch(batch);
    record.batches.delete(key);
    markBatchMembershipChanged(scene);
    stats.repairedGroups++;
    if (members.length < 2) return null;
    const replacement = { mesh: null, members: [], builtAt: 0 }; // Fresh clone for any changed furniture state.
    buildBatch(window.THREE, record, replacement, members, owner, t);
    record.batches.set(key, replacement);
    return replacement;
  }

  // undefined requests a full timed collection; null means no draw swap.
  // Empty collections also observe the discovery cadence, avoiding repeated
  // traversal in scenes that currently have no eligible settled groups.
  function reuseSettledBatches(scene, record, t) {
    if (t - record.collectedAt >= STABLE_COLLECT_MS) return undefined;
    if (!record.batches.size) { stats.emptyReuseFrames++; return null; }
    const hidden = []; // Validate/repair every group before hiding any originals.
    let repaired = false;
    // Snapshot only the keys requiring repair: replacing a Map entry during
    // iteration would otherwise revisit the replacement in the same frame.
    const dirty = [];
    for (const [key, batch] of record.batches) {
      let valid = !!batch.mesh && batch.members.length >= 2;
      if (valid) for (const member of batch.members) {
        if (!settledMemberMatches(member, batch, scene, t)) { valid = false; break; }
      }
      if (!valid) dirty.push([key, batch]);
      else for (const member of batch.members) hidden.push(member);
    }
    for (const [key, batch] of dirty) {
      repaired = true;
      const replacement = repairSettledBatch(scene, record, key, batch, t);
      if (replacement) for (const member of replacement.members) hidden.push(member);
    }
    if (repaired) stats.partialRepairFrames++;
    else stats.fastReuseFrames++;
    if (!hidden.length) return null;
    for (const member of hidden) member.visible = false;
    record.holder.visible = true;
    stats.sources = hidden.length; stats.batches = record.batches.size;
    stats.drawsSaved = hidden.length - record.batches.size;
    return function restoreStableBatches() {
      for (const member of hidden) member.visible = true;
      record.holder.visible = false;
    };
  }

  function disposeBatch(batch) {
    batch.mesh.geometry.dispose();
    if (batch.furnitureKey) batch.mesh.material.dispose(); // Only the proxy owns this clone.
  }

  // Returns a restore function, or null when nothing was swapped.
  function suspendForRender(scene, { isZone = false } = {}) {
    if (!enabled || !isZone || !scene?.isScene || window.THREE == null) return null;
    stats.frames++;
    stats.moving = 0;
    stats.sources = stats.batches = stats.drawsSaved = 0;
    for (const key of Object.keys(rejectReasons)) delete rejectReasons[key];
    const t = now();
    // World matrices are last render's (no extra scene-wide update): a prop that starts moving this frame is drawn one frame
    // at its previous pose, then its changed matrix drops it out of the batch until it settles again.
    const record = recordFor(scene);
    const fastRestore = reuseSettledBatches(scene, record, t); // Skips per-frame owner scans and grouping when unchanged.
    if (fastRestore !== undefined) return fastRestore;
    record.collectedAt = t;
    stats.fullCollects++;
    const groups = new Map();
    if (!collect(scene, record, t, groups)) {
      if (record.batches.size) markBatchMembershipChanged(scene); // Deleted candidate meshes must leave the culler list too.
      for (const batch of record.batches.values()) { record.holder.remove(batch.mesh); disposeBatch(batch); }
      record.batches.clear();
      return null;
    }
    const THREE = window.THREE;
    for (const [key, batch] of record.batches) {
      if ((groups.get(key)?.members.length || 0) >= 2) continue;
      record.holder.remove(batch.mesh);
      disposeBatch(batch); // Never dispose a source material or its shared texture.
      record.batches.delete(key);
      markBatchMembershipChanged(scene);
    }
    const hidden = [];
    for (const [key, group] of groups) {
      const members = group.members;
      if (members.length < 2) continue; // A lone mesh gains nothing; leave it as it is.
      let batch = record.batches.get(key);
      if (!batch) { batch = { mesh: null, members: [], builtAt: 0 }; record.batches.set(key, batch); }
      if (!isCurrent(batch, members)) buildBatch(THREE, record, batch, members, group.owner, t);
      batch.mesh.visible = true;
      for (const member of members) hidden.push(member);
    }
    if (!hidden.length) return null;
    for (const member of hidden) member.visible = false; // Commit visibility only after every proxy build succeeds.
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
    snapshot: () => ({ enabled, cellTiles: CELL_TILES, stillMs: STILL_MS, stableCollectMs: STABLE_COLLECT_MS, ...stats, furnitureAlphaProofPending: furnitureProofQueue.length, rejectReasons: { ...rejectReasons } }),
  };
})();
