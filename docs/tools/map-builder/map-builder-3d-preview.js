(() => {
  'use strict';
  const root = document.getElementById('threeWrap');
  const ui = () => window.HobunjiMapBuilderUI;
  const THREE = window.THREE;
  if (!root || !THREE) return;

  const HIGHLAND_BODY_TOP_SCALE = 0.85;
  const BASE_HEIGHT = 2.0;
  const MIN_RIDGE = 0.08;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071018);
  scene.fog = new THREE.Fog(0x071018, 38, 110);
  const cameraConfig = window.SCRATCHBONES_CONFIG?.game?.mapBuilder?.previewCamera || {};
  const angleConfig = cameraConfig.gameplayAngle || {};
  const distanceConfig = cameraConfig.distance || {};
  const focusConfig = cameraConfig.focus || {};
  const touchConfig = cameraConfig.touch || {};
  const camera = new THREE.PerspectiveCamera(
    Number(cameraConfig.fovDegrees) || 48,
    1,
    Number(cameraConfig.nearClip) || 0.1,
    Number(cameraConfig.farClip) || 220
  );
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
    ground: new THREE.MeshLambertMaterial({ color: 0x28402d }),
    floor: new THREE.MeshLambertMaterial({ color: 0x6d5137 }),
    plaster: new THREE.MeshLambertMaterial({ color: 0xbda579 }),
    roof: new THREE.MeshLambertMaterial({ color: 0x5a3725 }),
    ridgeCap: new THREE.MeshLambertMaterial({ color: 0x3c2418 }),
    gable: new THREE.MeshLambertMaterial({ color: 0x846344 }),
    door: new THREE.MeshLambertMaterial({ color: 0x4a2d1d }),
    glass: new THREE.MeshLambertMaterial({ color: 0x8fbcd4, transparent: true, opacity: 0.55 }),
    path: new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    shingleFallback: new THREE.MeshLambertMaterial({ color: 0x4b2d1e }),
    brick: new THREE.MeshLambertMaterial({ color: 0x9b6b48 })
  };

  scene.add(new THREE.HemisphereLight(0xddeeff, 0x22331f, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(12, 28, 10);
  sun.castShadow = true;
  scene.add(sun);

  let shingleSource = null;
  const npcModels = new Map();
  const pointerState = new Map();
  let lastSignature = '';
  let selectedNpcId = '';
  let pinchStart = null;
  const controls = {
    panning: false,
    lastX: 0,
    lastY: 0,
    yaw: Number(angleConfig.yawRadians ?? -0.72),
    pitch: Number(angleConfig.pitchRadians ?? 0.72),
    dist: Number(distanceConfig.default ?? 48),
    target: new THREE.Vector3(24, 0, 16)
  };
  const npcFocusSelect = document.getElementById('npcFocusSelect');

  function log(message, level = 'info') { ui()?.log?.(`[3D] ${message}`, level); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function cameraDistanceMin() { return Number(distanceConfig.min ?? 12); }
  function cameraDistanceMax() { return Number(distanceConfig.max ?? 95); }
  function focusDistance() { return clamp(Number(focusConfig.distance ?? 20), cameraDistanceMin(), cameraDistanceMax()); }
  function activeNpcIds(runtime) { return [...new Set((runtime?.state?.npcPaths || []).map(path => path.npcId).filter(Boolean))]; }
  function npcLabel(runtime, id) {
    const npc = (runtime?.npcDb?.npcs || []).find(item => item.id === id);
    return npc?.name || npc?.label || id;
  }
  function syncFocusSelect(runtime) {
    if (!npcFocusSelect) return;
    const ids = activeNpcIds(runtime);
    const current = selectedNpcId;
    npcFocusSelect.innerHTML = ['<option value="">Focus: free camera</option>'].concat(ids.map(id => `<option value="${id}">Focus: ${npcLabel(runtime, id)}</option>`)).join('');
    if (current && ids.includes(current)) npcFocusSelect.value = current;
    else { selectedNpcId = ''; npcFocusSelect.value = ''; }
  }
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
  function topRectFromBottom(rect, scale = HIGHLAND_BODY_TOP_SCALE) {
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
    const targetLongLen = longAxis === 'x' ? Math.max(MIN_RIDGE, esW * HIGHLAND_BODY_TOP_SCALE) : Math.max(MIN_RIDGE, esD * HIGHLAND_BODY_TOP_SCALE);
    const longShrinkPerSide = longAxis === 'x' ? Math.max(0, (esW - targetLongLen) / 2) : Math.max(0, (esD - targetLongLen) / 2);
    const insetXPerHeight = Math.max(0, (bsW - esW) / 2) / BASE_HEIGHT;
    const insetZPerHeight = Math.max(0, (bsD - esD) / 2) / BASE_HEIGHT;
    const longInsetPerHeight = longAxis === 'x' ? insetXPerHeight : insetZPerHeight;
    let roofHeight = 1.18;
    if (longInsetPerHeight > 1e-7 && longShrinkPerSide > 1e-7) roofHeight = Math.max(0.2, longShrinkPerSide / longInsetPerHeight);
    if (longAxis === 'x') return { rect: { minX: cx - targetLongLen / 2, maxX: cx + targetLongLen / 2, minZ: cz - MIN_RIDGE / 2, maxZ: cz + MIN_RIDGE / 2 }, roofHeight };
    return { rect: { minX: cx - MIN_RIDGE / 2, maxX: cx + MIN_RIDGE / 2, minZ: cz - targetLongLen / 2, maxZ: cz + targetLongLen / 2 }, roofHeight };
  }

  async function initAssets() {
    if (!shingleSource) {
      const loader = new THREE.GLTFLoader();
      const candidates = [
        '../../assets/models/HighlandLongshingle_boned.glb',
        '../../assets/models/highlandlongshingle_boned.glb',
        '../../assets/HighlandLongshingle_boned.glb'
      ];
      for (const url of candidates) {
        try { shingleSource = await new Promise((res, rej) => loader.load(url, g => res(g.scene), undefined, rej)); log('HighlandLongshingle_boned.glb loaded.'); break; } catch (_e) {}
      }
      if (!shingleSource) log('HighlandLongshingle_boned.glb not found; using procedural shingles.', 'warn');
    }
  }

  function addHighlandBody(group, bottomRect, eaveRect) {
    const bottom = rectCorners(bottomRect, 0);
    const top = rectCorners(eaveRect, BASE_HEIGHT);
    group.add(quadMesh(bottom.a, bottom.b, bottom.c, bottom.d, mats.floor, 'highland_frustum_floor'));
    group.add(quadMesh(top.d, top.c, top.b, top.a, mats.plaster, 'highland_frustum_ceiling'));
    group.add(quadMesh(bottom.a, top.a, top.b, bottom.b, mats.plaster, 'highland_frustum_wall_north'));
    group.add(quadMesh(bottom.b, top.b, top.c, bottom.c, mats.plaster, 'highland_frustum_wall_east'));
    group.add(quadMesh(bottom.c, top.c, top.d, bottom.d, mats.plaster, 'highland_frustum_wall_south'));
    group.add(quadMesh(bottom.d, top.d, top.a, bottom.a, mats.plaster, 'highland_frustum_wall_west'));
    addBrickFace(group, bottom.a, top.a, top.b, bottom.b, bottomRect.maxX - bottomRect.minX, BASE_HEIGHT, 'north');
    addBrickFace(group, bottom.b, top.b, top.c, bottom.c, bottomRect.maxZ - bottomRect.minZ, BASE_HEIGHT, 'east');
    addBrickFace(group, bottom.c, top.c, top.d, bottom.d, bottomRect.maxX - bottomRect.minX, BASE_HEIGHT, 'south');
    addBrickFace(group, bottom.d, top.d, top.a, bottom.a, bottomRect.maxZ - bottomRect.minZ, BASE_HEIGHT, 'west');
  }
  function addBrickFace(group, bl, tl, tr, br, width, height, name) {
    const cols = Math.max(3, Math.floor(width / 0.32));
    const rows = Math.max(3, Math.floor(height / 0.24));
    const geo = new THREE.BoxGeometry(0.24, 0.14, 0.08);
    const inst = new THREE.InstancedMesh(geo, mats.brick, cols * rows);
    inst.name = 'highland_wall_units_' + name;
    const u = br.clone().sub(bl).normalize();
    const v = tl.clone().sub(bl).normalize();
    const n = new THREE.Vector3().crossVectors(u, v).normalize().multiplyScalar(0.035);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n.clone().normalize()));
    let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = (c + 0.5 + (r % 2) * 0.5) / cols;
      const t = (r + 0.5) / rows;
      const p0 = bl.clone().lerp(br, s);
      const p1 = tl.clone().lerp(tr, s);
      const p = p0.lerp(p1, t).add(n);
      const scale = new THREE.Vector3(width / cols * 0.78, height / rows * 0.58, 0.08);
      inst.setMatrixAt(k++, new THREE.Matrix4().compose(p, q, scale));
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }

  function addHighlandRoof(group, bottomRect, eaveRect, axis) {
    const base = rectCorners(eaveRect, BASE_HEIGHT);
    const solved = continuousFrustumRidgeRect(bottomRect, eaveRect, axis);
    const top = rectCorners(solved.rect, BASE_HEIGHT + solved.roofHeight);
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
    const cols = Math.max(4, Math.ceil(longLen * 1.25));
    const rows = Math.max(3, Math.ceil(acrossLen * 1.8));
    const u = e1.clone().sub(e0).normalize();
    const v = r0.clone().sub(e0).normalize();
    const n = new THREE.Vector3().crossVectors(u, v).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = (c + 0.5) / cols;
      const t = (r + 0.35) / rows;
      const a = e0.clone().lerp(e1, s);
      const b = r0.clone().lerp(r1, s);
      const p = a.lerp(b, t).addScaledVector(n, 0.025 + (r % 2) * 0.006);
      let obj;
      if (shingleSource) obj = shingleSource.clone(true); else obj = makeBox(0.62, 0.05, 0.28, mats.shingleFallback, 0, 0, 0);
      obj.name = 'highland_shingle_' + sideName;
      obj.position.copy(p);
      obj.quaternion.copy(q);
      obj.rotateX(-0.08);
      obj.rotateZ((Math.sin((r + 1) * (c + 3)) * 0.035));
      obj.scale.setScalar(shingleSource ? 0.42 : 1);
      group.add(obj);
    }
  }

  function buildHouse(house) {
    const group = new THREE.Group(); group.name = 'HighlandArchitecturePreset_' + house.id;
    const bottomRect = { minX: house.x, maxX: house.x + house.width, minZ: house.y, maxZ: house.y + house.depth };
    const eaveRect = topRectFromBottom(bottomRect, HIGHLAND_BODY_TOP_SCALE);
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
  function signature(runtime) { const s = runtime?.state || {}; return JSON.stringify({ houses: s.houses, paths: s.npcPaths }); }

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
    const pathIds = new Set(activeNpcIds(runtime));
    for (const [id, model] of npcModels.entries()) if (!pathIds.has(id)) {
      npcModels.delete(id);
      npcLayer.remove(model);
      disposeObject(model);
    }
    for (const id of pathIds) if (!npcModels.has(id)) {
      const npc = npcs.find(item => item.id === id) || { id, name: id };
      const model = await makeNpcAvatar(npc); npcModels.set(id, model); npcLayer.add(model);
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
    followSelectedNpc();
  }
  function followSelectedNpc() {
    const model = selectedNpcId ? npcModels.get(selectedNpcId) : null;
    if (!model) return;
    const desired = new THREE.Vector3(model.position.x, Number(focusConfig.targetYOffset ?? 1), model.position.z);
    controls.target.lerp(desired, clamp(Number(focusConfig.followLerp ?? 0.18), 0.01, 1));
    controls.dist = Math.min(controls.dist, focusDistance());
  }
  function resize() { const r = root.getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); camera.aspect = Math.max(1, r.width) / Math.max(1, r.height); camera.updateProjectionMatrix(); }
  function updateCamera() {
    controls.yaw = Number(angleConfig.yawRadians ?? controls.yaw);
    controls.pitch = Number(angleConfig.pitchRadians ?? controls.pitch);
    camera.position.set(controls.target.x + Math.sin(controls.yaw) * Math.cos(controls.pitch) * controls.dist, controls.target.y + Math.sin(controls.pitch) * controls.dist, controls.target.z + Math.cos(controls.yaw) * Math.cos(controls.pitch) * controls.dist); camera.lookAt(controls.target);
  }
  function setZoomDistance(next) { controls.dist = clamp(next, cameraDistanceMin(), cameraDistanceMax()); updateCamera(); }
  function pointerDistance(points) { return Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY); }
  function updatePinchStart() { const points = [...pointerState.values()]; pinchStart = points.length === 2 ? { dist: pointerDistance(points), cameraDist: controls.dist } : null; }
  root.addEventListener('pointerdown', e => {
    pointerState.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    root.setPointerCapture?.(e.pointerId);
    if (pointerState.size === 2) { controls.panning = false; updatePinchStart(); return; }
    controls.panning = !selectedNpcId;
    controls.lastX = e.clientX; controls.lastY = e.clientY;
  });
  root.addEventListener('pointermove', e => {
    if (!pointerState.has(e.pointerId)) return;
    pointerState.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    if (pointerState.size === 2 && pinchStart) {
      const points = [...pointerState.values()];
      const delta = pointerDistance(points) - pinchStart.dist;
      if (Math.abs(delta) >= Number(touchConfig.pinchEpsilonPx ?? 2)) setZoomDistance(pinchStart.cameraDist * (pinchStart.dist / Math.max(1, pointerDistance(points))));
      return;
    }
    if (!controls.panning) return;
    const dx = e.clientX - controls.lastX, dy = e.clientY - controls.lastY;
    controls.lastX = e.clientX; controls.lastY = e.clientY;
    const panScale = controls.dist * 0.0018;
    const right = new THREE.Vector3(Math.cos(controls.yaw), 0, -Math.sin(controls.yaw));
    const forward = new THREE.Vector3(Math.sin(controls.yaw), 0, Math.cos(controls.yaw));
    controls.target.addScaledVector(right, -dx * panScale).addScaledVector(forward, dy * panScale);
    updateCamera();
  });
  function endPointer(e) { pointerState.delete(e.pointerId); root.releasePointerCapture?.(e.pointerId); controls.panning = false; updatePinchStart(); }
  root.addEventListener('pointerup', endPointer);
  root.addEventListener('pointercancel', endPointer);
  root.addEventListener('wheel', e => { e.preventDefault(); setZoomDistance(controls.dist + Math.sign(e.deltaY) * Number(distanceConfig.wheelStep ?? 3)); }, { passive: false });
  npcFocusSelect?.addEventListener('change', () => {
    selectedNpcId = npcFocusSelect.value;
    if (selectedNpcId) { setZoomDistance(focusDistance()); log(`Camera following NPC ${selectedNpcId}.`); }
    else log('Camera focus released.');
  });

  async function handleUpdate(ev) {
    const runtime = ev.detail; await initAssets(); if (signature(runtime) !== lastSignature) rebuildWorld(runtime); syncFocusSelect(runtime); await ensureNpcModels(runtime); updateNpcPositions(runtime);
  }
  function animate() { resize(); updateCamera(); renderer.render(scene, camera); requestAnimationFrame(animate); }
  window.addEventListener('hobunji-map-builder:update', handleUpdate);
  initAssets().then(() => { const rt = window.HobunjiMapBuilderRuntime; if (rt) handleUpdate({ detail: rt }); });
  animate();
})();
