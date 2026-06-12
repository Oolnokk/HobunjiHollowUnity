(() => {
  'use strict';
  const root = document.getElementById('threeWrap');
  const ui = () => window.HobunjiMapBuilderUI;
  const THREE = window.THREE;
  if (!root || !THREE) return;

  const cfg = () => window.HOBUNJI_MAP_BUILDER_CONFIG?.preview3d || {};
  const highlandCfg = () => cfg().architecture?.highland || {};
  const shingleCfg = () => highlandCfg().shingle || {};
  const roughbrickCfg = () => highlandCfg().roughbrick || {};
  const matColor = (name, fallback) => cfg().materials?.[name] ?? fallback;
  const bodyTopScale = () => Number(highlandCfg().bodyTopScale) || 0.85;
  const baseHeight = () => Number(highlandCfg().baseHeight) || 2;
  const minRidge = () => Number(highlandCfg().minRidge) || 0.08;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071018);
  scene.fog = new THREE.Fog(0x071018, 38, 110);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 220);
  camera.position.set(26, 26, 34);
  camera.lookAt(24, 0, 16);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  root.appendChild(renderer.domElement);

  const world = new THREE.Group();
  world.name = 'Hobunji_3D_Map_Preview_World';
  scene.add(world);
  const buildingLayer = new THREE.Group();
  const npcLayer = new THREE.Group();
  const pathLayer = new THREE.Group();
  const landscapeLayer = new THREE.Group();
  world.add(landscapeLayer, buildingLayer, pathLayer, npcLayer);

  const mats = {
    ground: new THREE.MeshLambertMaterial({ color: matColor('ground', 0x28402d) }),
    floor: new THREE.MeshLambertMaterial({ color: matColor('floor', 0x6d5137) }),
    plaster: new THREE.MeshLambertMaterial({ color: matColor('plaster', 0xbda579) }),
    roof: new THREE.MeshLambertMaterial({ color: matColor('roof', 0x5a3725) }),
    ridgeCap: new THREE.MeshLambertMaterial({ color: matColor('ridgeCap', 0x3c2418) }),
    gable: new THREE.MeshLambertMaterial({ color: matColor('gable', 0x846344) }),
    door: new THREE.MeshLambertMaterial({ color: matColor('door', 0x4a2d1d) }),
    glass: new THREE.MeshLambertMaterial({ color: matColor('glass', 0x8fbcd4), transparent: true, opacity: 0.55 }),
    path: new THREE.MeshBasicMaterial({ color: matColor('path', 0x38bdf8) }),
    shingleFallback: new THREE.MeshLambertMaterial({ color: matColor('shingleFallback', 0x4b2d1e) }),
    brick: new THREE.MeshLambertMaterial({ color: matColor('brickFallback', 0x9b6b48) })
  };

  scene.add(new THREE.HemisphereLight(0xddeeff, 0x22331f, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(12, 28, 10);
  sun.castShadow = true;
  scene.add(sun);

  let shingleModel = null;
  let roughbrickModel = null;
  let loadedRoughbrickUrl = '';
  const npcModels = new Map();
  let lastSignature = '';
  let controls = { dragging: false, lastX: 0, lastY: 0, yaw: -0.72, pitch: 0.72, dist: 48, target: new THREE.Vector3(24, 0, 16) };

  function log(message, level = 'info') { ui()?.log?.(`[3D] ${message}`, level); }
  function clearGroup(g) { while (g.children.length) { const c = g.children.pop(); disposeObject(c); } }
  function disposeObject(o) { o.traverse?.(c => { if (c.geometry) c.geometry.dispose?.(); const ms = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : []; ms.forEach(m => { if (!Object.values(mats).includes(m)) { m.map?.dispose?.(); m.dispose?.(); } }); }); }
  function tileToWorld(x, y) { return new THREE.Vector3(x + 0.5, 0, y + 0.5); }
  function makeBox(w, h, d, mat, x, y, z) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }
  function rectCorners(rect, y) {
    return {
      a: new THREE.Vector3(rect.minX, y, rect.minZ),
      b: new THREE.Vector3(rect.maxX, y, rect.minZ),
      c: new THREE.Vector3(rect.maxX, y, rect.maxZ),
      d: new THREE.Vector3(rect.minX, y, rect.maxZ)
    };
  }
  function topRectFromBottom(rect, scale = bodyTopScale()) {
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    const hw = (rect.maxX - rect.minX) * scale / 2;
    const hd = (rect.maxZ - rect.minZ) * scale / 2;
    return { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd };
  }
  function quadMesh(a, b, c, d, mat, name) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z,
      a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z
    ], 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name || 'quad';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  function continuousFrustumRidgeRect(bottomRect, eaveRect, axis) {
    const bsW = bottomRect.maxX - bottomRect.minX, bsD = bottomRect.maxZ - bottomRect.minZ;
    const esW = eaveRect.maxX - eaveRect.minX, esD = eaveRect.maxZ - eaveRect.minZ;
    const cx = (eaveRect.minX + eaveRect.maxX) / 2, cz = (eaveRect.minZ + eaveRect.maxZ) / 2;
    const longAxis = axis === 'z' ? 'z' : 'x';
    const ridgeMin = minRidge();
    const topScale = bodyTopScale();
    const targetLongLen = longAxis === 'x' ? Math.max(ridgeMin, esW * topScale) : Math.max(ridgeMin, esD * topScale);
    const longShrinkPerSide = longAxis === 'x' ? Math.max(0, (esW - targetLongLen) / 2) : Math.max(0, (esD - targetLongLen) / 2);
    const insetXPerHeight = Math.max(0, (bsW - esW) / 2) / baseHeight();
    const insetZPerHeight = Math.max(0, (bsD - esD) / 2) / baseHeight();
    const longInsetPerHeight = longAxis === 'x' ? insetXPerHeight : insetZPerHeight;
    let roofHeight = Number(highlandCfg().defaultRoofHeight) || 1.18;
    if (longInsetPerHeight > 1e-7 && longShrinkPerSide > 1e-7) roofHeight = Math.max(0.2, longShrinkPerSide / longInsetPerHeight);
    if (longAxis === 'x') return { rect: { minX: cx - targetLongLen / 2, maxX: cx + targetLongLen / 2, minZ: cz - ridgeMin / 2, maxZ: cz + ridgeMin / 2 }, roofHeight };
    return { rect: { minX: cx - ridgeMin / 2, maxX: cx + ridgeMin / 2, minZ: cz - targetLongLen / 2, maxZ: cz + targetLongLen / 2 }, roofHeight };
  }

  function firstMesh(rootObject) {
    let found = null;
    rootObject?.traverse?.(obj => { if (!found && obj?.isMesh) found = obj; });
    return found;
  }
  function cloneMaterial(material) {
    if (Array.isArray(material)) return material.map(m => m.clone());
    return material?.clone?.() || mats.brick.clone();
  }
  function meshAsset(mesh, name) {
    const cloned = mesh.clone();
    cloned.geometry = mesh.geometry.clone();
    cloned.material = cloneMaterial(mesh.material);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);
    return {
      name,
      geometry: cloned.geometry,
      material: cloned.material,
      perUnitScale: new THREE.Vector3(
        size.x > 1e-6 ? 1 / size.x : 1,
        size.y > 1e-6 ? 1 / size.y : 1,
        size.z > 1e-6 ? 1 / size.z : 1
      )
    };
  }
  function loadGltf(url) {
    const loader = new THREE.GLTFLoader();
    return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
  }
  async function loadFirstMeshAsset(url, name) {
    const gltf = await loadGltf(url);
    const mesh = firstMesh(gltf.scene);
    if (!mesh) throw new Error(`No mesh found in ${url}`);
    return meshAsset(mesh, name || url.split('/').pop() || 'model.glb');
  }
  function selectedWallRecipe(runtime) {
    const recipes = runtime?.index?.wallRecipes || [];
    const selectedId = runtime?.state?.houses?.find(h => h?.wallRecipeId)?.wallRecipeId;
    return recipes.find(recipe => recipe.id === selectedId) || recipes[0] || null;
  }
  async function initAssets(runtime = window.HobunjiMapBuilderRuntime) {
    if (!shingleModel) {
      const candidates = shingleCfg().candidateUrls || [];
      for (const url of candidates) {
        try {
          shingleModel = await loadFirstMeshAsset(url, url.split('/').pop());
          log(`${shingleModel.name} loaded for highland shingles.`);
          break;
        } catch (_e) {}
      }
      if (!shingleModel) log('HighlandLongshingle_boned.glb not found; using procedural shingles.', 'warn');
    }

    const recipe = selectedWallRecipe(runtime);
    const modelUrl = recipe?.modelUrl || roughbrickCfg().fallbackModelUrl;
    const modelName = recipe?.modelUrl?.split('/').pop() || roughbrickCfg().fallbackModelName || 'Roughbrick1.glb';
    if (modelUrl && (!roughbrickModel || loadedRoughbrickUrl !== modelUrl)) {
      try {
        roughbrickModel = await loadFirstMeshAsset(modelUrl, modelName);
        loadedRoughbrickUrl = modelUrl;
        log(`${roughbrickModel.name} loaded for roughbrick house walls.`);
      } catch (err) {
        roughbrickModel = null;
        loadedRoughbrickUrl = '';
        log(`Roughbrick wall GLB failed to load from ${modelUrl}: ${err.message}; using procedural bricks.`, 'warn');
      }
    }
  }

  function addHighlandBody(group, bottomRect, eaveRect) {
    const bottom = rectCorners(bottomRect, 0);
    const top = rectCorners(eaveRect, baseHeight());
    group.add(quadMesh(bottom.a, bottom.b, bottom.c, bottom.d, mats.floor, 'highland_frustum_floor'));
    group.add(quadMesh(top.d, top.c, top.b, top.a, mats.plaster, 'highland_frustum_ceiling'));
    group.add(quadMesh(bottom.a, top.a, top.b, bottom.b, mats.plaster, 'highland_frustum_wall_north'));
    group.add(quadMesh(bottom.b, top.b, top.c, bottom.c, mats.plaster, 'highland_frustum_wall_east'));
    group.add(quadMesh(bottom.c, top.c, top.d, bottom.d, mats.plaster, 'highland_frustum_wall_south'));
    group.add(quadMesh(bottom.d, top.d, top.a, bottom.a, mats.plaster, 'highland_frustum_wall_west'));
    addBrickFace(group, bottom.a, top.a, top.b, bottom.b, bottomRect.maxX - bottomRect.minX, baseHeight(), 'north');
    addBrickFace(group, bottom.b, top.b, top.c, bottom.c, bottomRect.maxZ - bottomRect.minZ, baseHeight(), 'east');
    addBrickFace(group, bottom.c, top.c, top.d, bottom.d, bottomRect.maxX - bottomRect.minX, baseHeight(), 'south');
    addBrickFace(group, bottom.d, top.d, top.a, bottom.a, bottomRect.maxZ - bottomRect.minZ, baseHeight(), 'west');
  }
  function addBrickFace(group, bl, tl, tr, br, width, height, name) {
    const brick = roughbrickCfg();
    const cols = Math.max(brick.minColumns || 3, Math.floor(width * (brick.columnsPerUnit || 3.125)));
    const rows = Math.max(brick.minRows || 3, Math.floor(height * (brick.rowsPerUnit || 4.1667)));
    const size = brick.fallbackSize || [0.24, 0.14, 0.08];
    const geometry = roughbrickModel ? roughbrickModel.geometry.clone() : new THREE.BoxGeometry(size[0], size[1], size[2]);
    const material = roughbrickModel ? cloneMaterial(roughbrickModel.material) : mats.brick;
    const inst = new THREE.InstancedMesh(geometry, material, cols * rows);
    inst.name = roughbrickModel ? `highland_roughbrick_glb_${name}` : `highland_wall_units_${name}`;
    const u = br.clone().sub(bl).normalize();
    const v = tl.clone().sub(bl).normalize();
    const normal = new THREE.Vector3().crossVectors(u, v).normalize();
    const n = normal.clone().multiplyScalar(brick.surfaceOffset ?? 0.035);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));
    let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = (c + 0.5 + (r % 2) * 0.5) / cols;
      const t = (r + 0.5) / rows;
      const p0 = bl.clone().lerp(br, s);
      const p1 = tl.clone().lerp(tr, s);
      const p = p0.lerp(p1, t).add(n);
      const targetScale = new THREE.Vector3(
        width / cols * (brick.widthFill ?? 0.78),
        height / rows * (brick.heightFill ?? 0.58),
        brick.depth ?? 0.08
      );
      const assetScale = roughbrickModel ? roughbrickModel.perUnitScale : new THREE.Vector3(1, 1, 1);
      const scale = targetScale.multiply(assetScale);
      inst.setMatrixAt(k++, new THREE.Matrix4().compose(p, q, scale));
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }

  function addHighlandRoof(group, bottomRect, eaveRect, axis) {
    const base = rectCorners(eaveRect, baseHeight());
    const solved = continuousFrustumRidgeRect(bottomRect, eaveRect, axis);
    const top = rectCorners(solved.rect, baseHeight() + solved.roofHeight);
    group.add(quadMesh(top.d, top.c, top.b, top.a, mats.ridgeCap, 'highland_roof_ridge_cap'));
    if (axis === 'x') {
      group.add(quadMesh(base.a, top.a, top.b, base.b, mats.roof, 'highland_roof_slope_north'));
      group.add(quadMesh(base.c, top.c, top.d, base.d, mats.roof, 'highland_roof_slope_south'));
      group.add(quadMesh(base.b, top.b, top.c, base.c, mats.gable, 'highland_gable_east'));
      group.add(quadMesh(base.d, top.d, top.a, base.a, mats.gable, 'highland_gable_west'));
      addShinglesOnQuad(group, base.a, top.a, top.b, base.b, eaveRect.maxX - eaveRect.minX, eaveRect.maxZ - eaveRect.minZ, 'north');
      addShinglesOnQuad(group, base.c, top.c, top.d, base.d, eaveRect.maxX - eaveRect.minX, eaveRect.maxZ - eaveRect.minZ, 'south');
    } else {
      group.add(quadMesh(base.b, top.b, top.c, base.c, mats.roof, 'highland_roof_slope_east'));
      group.add(quadMesh(base.d, top.d, top.a, base.a, mats.roof, 'highland_roof_slope_west'));
      group.add(quadMesh(base.a, top.a, top.b, base.b, mats.gable, 'highland_gable_north'));
      group.add(quadMesh(base.c, top.c, top.d, base.d, mats.gable, 'highland_gable_south'));
      addShinglesOnQuad(group, base.b, top.b, top.c, base.c, eaveRect.maxZ - eaveRect.minZ, eaveRect.maxX - eaveRect.minX, 'east');
      addShinglesOnQuad(group, base.d, top.d, top.a, base.a, eaveRect.maxZ - eaveRect.minZ, eaveRect.maxX - eaveRect.minX, 'west');
    }
  }
  function addShinglesOnQuad(group, e0, r0, r1, e1, longLen, acrossLen, sideName) {
    const shingle = shingleCfg();
    const cols = Math.max(shingle.minColumns || 4, Math.ceil(longLen * (shingle.columnsPerUnit || 1.25)));
    const rows = Math.max(shingle.minRows || 3, Math.ceil(acrossLen * (shingle.rowsPerUnit || 1.8)));
    const u = e1.clone().sub(e0).normalize();
    const v = r0.clone().sub(e0).normalize();
    const n = new THREE.Vector3().crossVectors(u, v).normalize();
    const baseQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
    const size = shingle.fallbackSize || [0.62, 0.05, 0.28];
    const geometry = shingleModel ? shingleModel.geometry.clone() : new THREE.BoxGeometry(size[0], size[1], size[2]);
    const material = shingleModel ? cloneMaterial(shingleModel.material) : mats.shingleFallback;
    const inst = new THREE.InstancedMesh(geometry, material, cols * rows);
    inst.name = shingleModel ? `highland_shingle_glb_${sideName}` : `highland_shingle_fallback_${sideName}`;
    const assetScale = shingleModel ? shingleModel.perUnitScale : new THREE.Vector3(1, 1, 1);
    const scaleScalar = shingleModel ? (shingle.scale || 0.42) : 1;
    let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = (c + 0.5) / cols;
      const t = (r + 0.35) / rows;
      const a = e0.clone().lerp(e1, s);
      const b = r0.clone().lerp(r1, s);
      const p = a.lerp(b, t).addScaledVector(n, (shingle.surfaceOffset ?? 0.025) + (r % 2) * (shingle.staggeredSurfaceOffset ?? 0.006));
      const q = baseQ.clone();
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(shingle.pitchRadians ?? -0.08, 0, Math.sin((r + 1) * (c + 3)) * (shingle.randomRollRadians ?? 0.035), 'XYZ')));
      const scale = new THREE.Vector3(scaleScalar, scaleScalar, scaleScalar).multiply(assetScale);
      inst.setMatrixAt(k++, new THREE.Matrix4().compose(p, q, scale));
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }

  function buildHouse(house) {
    const group = new THREE.Group(); group.name = 'HighlandArchitecturePreset_' + house.id;
    const bottomRect = { minX: house.x, maxX: house.x + house.width, minZ: house.y, maxZ: house.y + house.depth };
    const eaveRect = topRectFromBottom(bottomRect, bodyTopScale());
    const axis = house.width >= house.depth ? 'x' : 'z';
    addHighlandBody(group, bottomRect, eaveRect);
    addHighlandRoof(group, bottomRect, eaveRect, axis);
    const door = window.HobunjiMapBuilder.deriveDoorTile(house);
    group.add(makeBox(0.8, 1.25, 0.08, mats.door, door.x + .5, .72, door.y + .05));
    group.add(makeBox(0.52, 0.42, 0.06, mats.glass, house.x + house.width * .27, 1.25, house.y + house.depth + .04));
    group.add(makeBox(0.52, 0.42, 0.06, mats.glass, house.x + house.width * .73, 1.25, house.y + house.depth + .04));
    return group;
  }

  function rebuildWorld(runtime) {
    const state = runtime?.state; if (!state) return;
    clearGroup(buildingLayer); clearGroup(pathLayer); clearGroup(landscapeLayer);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(state.map.cols, state.map.rows), mats.ground);
    ground.rotation.x = -Math.PI / 2; ground.position.set(state.map.cols / 2, 0, state.map.rows / 2); ground.receiveShadow = true; landscapeLayer.add(ground);
    const grid = new THREE.GridHelper(Math.max(state.map.cols, state.map.rows), Math.max(state.map.cols, state.map.rows), 0x31516b, 0x1b2e3f);
    grid.position.set(state.map.cols / 2, 0.012, state.map.rows / 2); landscapeLayer.add(grid);
    (state.houses || []).forEach(h => buildingLayer.add(buildHouse(h)));
    (state.npcPaths || []).forEach(path => {
      if (!path.nodes || path.nodes.length < 2) return;
      const pts = path.nodes.map(n => tileToWorld(n.x, n.y).add(new THREE.Vector3(0, 0.06, 0)));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      pathLayer.add(new THREE.Line(geo, mats.path));
    });
    lastSignature = signature(runtime);
  }
  function signature(runtime) { const s = runtime?.state || {}; return JSON.stringify({ houses: s.houses, paths: s.npcPaths, shingleAsset: shingleModel?.name || 'fallback', roughbrickAsset: loadedRoughbrickUrl || 'fallback' }); }

  function normalizeSpecies(species) { const s = String(species || '').toLowerCase(); if (s.includes('kenkari')) return 'kenkari'; if (s.includes('engh')) return 'engh-sho'; if (s.includes('mashtzarr')) return 'engh-sho'; return 'mao-ao'; }
  function normalizeGender(gender) { const g = String(gender || '').toLowerCase(); return g.includes('female') || g === 'f' ? 'female' : 'male'; }
  async function makeNpcAvatar(npc) {
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 200;
    try {
      await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: '../../assets/', configBase: '../../config/' });
      const appearance = npc.appearance || { speciesId: normalizeSpecies(npc.species), gender: normalizeGender(npc.gender), cosmetics: {} };
      const exportNpc = { ...npc, appearance, equippedCosmetics: npc.equippedCosmetics || [], appliedDyes: npc.appliedDyes || {} };
      const profile = window.NpcAvatarPreview.buildProfileFromNpcExport(exportNpc) || window.NpcAvatarPreview.randomProfile(npc.id, appearance);
      if (profile) await window.NpcAvatarPreview.renderProfileToCanvas(canvas, profile, { seatId: npc.id });
    } catch (e) {
      const c = canvas.getContext('2d'); c.fillStyle = '#111827'; c.fillRect(0,0,200,200); c.fillStyle = '#fff'; c.font = '22px sans-serif'; c.fillText((npc.name || npc.id || '?').slice(0,2), 82, 105); log('NPC portrait fallback: ' + e.message, 'warn');
    }
    const model = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE, canvas, { name: 'npc_png_plane_' + npc.id, modelWidth: 0.88 });
    model.position.y = 1.02; model.userData.npcId = npc.id;
    return model;
  }
  async function ensureNpcModels(runtime) {
    const npcs = runtime?.npcDb?.npcs || [];
    const pathIds = new Set((runtime?.state?.npcPaths || []).map(p => p.npcId));
    for (const npc of npcs) if (pathIds.has(npc.id) && !npcModels.has(npc.id)) {
      const model = await makeNpcAvatar(npc); npcModels.set(npc.id, model); npcLayer.add(model);
    }
  }
  function pathPosition(path, mins) {
    const nodes = path.nodes || []; if (!nodes.length) return null; if (nodes.length === 1) return tileToWorld(nodes[0].x, nodes[0].y);
    const start = Number(path.startMinute ?? 0), end = Number(path.endMinute ?? 1440); const duration = Math.max(1, end - start);
    let local = (mins - start) / duration;
    if (mins < start || mins > end) local = 0;
    if (path.loop !== false) local = ((local % 1) + 1) % 1; else local = Math.max(0, Math.min(1, local));
    const segCount = nodes.length - 1; const f = local * segCount; const i = Math.min(segCount - 1, Math.floor(f)); const t = f - i;
    const a = tileToWorld(nodes[i].x, nodes[i].y), b = tileToWorld(nodes[i + 1].x, nodes[i + 1].y);
    return a.lerp(b, t);
  }
  function updateNpcPositions(runtime) {
    const mins = runtime?.clockMinutes ?? 0;
    const paths = runtime?.state?.npcPaths || [];
    paths.forEach(path => {
      const model = npcModels.get(path.npcId); if (!model) return;
      const p = pathPosition(path, mins); if (!p) return;
      const old = model.position.clone(); model.position.set(p.x, 1.02, p.z);
      const dx = model.position.x - old.x, dz = model.position.z - old.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.0001) model.rotation.y = Math.atan2(dx, dz);
    });
  }
  function resize() { const r = root.getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); camera.aspect = Math.max(1, r.width) / Math.max(1, r.height); camera.updateProjectionMatrix(); }
  function updateCamera() { camera.position.set(controls.target.x + Math.sin(controls.yaw) * Math.cos(controls.pitch) * controls.dist, controls.target.y + Math.sin(controls.pitch) * controls.dist, controls.target.z + Math.cos(controls.yaw) * Math.cos(controls.pitch) * controls.dist); camera.lookAt(controls.target); }
  root.addEventListener('pointerdown', e => { controls.dragging = true; controls.lastX = e.clientX; controls.lastY = e.clientY; root.setPointerCapture?.(e.pointerId); });
  root.addEventListener('pointermove', e => { if (!controls.dragging) return; const dx = e.clientX - controls.lastX, dy = e.clientY - controls.lastY; controls.lastX = e.clientX; controls.lastY = e.clientY; controls.yaw -= dx * 0.006; controls.pitch = Math.max(0.18, Math.min(1.25, controls.pitch + dy * 0.004)); updateCamera(); });
  root.addEventListener('pointerup', e => { controls.dragging = false; root.releasePointerCapture?.(e.pointerId); });
  root.addEventListener('wheel', e => { e.preventDefault(); controls.dist = Math.max(12, Math.min(95, controls.dist + Math.sign(e.deltaY) * 3)); updateCamera(); }, { passive: false });

  async function handleUpdate(ev) {
    const runtime = ev.detail; await initAssets(runtime); if (signature(runtime) !== lastSignature) rebuildWorld(runtime); await ensureNpcModels(runtime); updateNpcPositions(runtime);
  }
  function animate() { resize(); updateCamera(); renderer.render(scene, camera); requestAnimationFrame(animate); }
  window.addEventListener('hobunji-map-builder:update', handleUpdate);
  initAssets().then(() => { const rt = window.HobunjiMapBuilderRuntime; if (rt) handleUpdate({ detail: rt }); });
  animate();
})();
