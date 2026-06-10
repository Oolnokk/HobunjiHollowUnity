(() => {
  'use strict';
  const root = document.getElementById('threeWrap');
  const ui = () => window.HobunjiMapBuilderUI;
  const THREE = window.THREE;
  if (!root || !THREE) return;

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
    ground: new THREE.MeshLambertMaterial({ color: 0x28402d }),
    floor: new THREE.MeshLambertMaterial({ color: 0x6d5137 }),
    plaster: new THREE.MeshLambertMaterial({ color: 0xbda579 }),
    roof: new THREE.MeshLambertMaterial({ color: 0x5a3725 }),
    gable: new THREE.MeshLambertMaterial({ color: 0x846344 }),
    door: new THREE.MeshLambertMaterial({ color: 0x4a2d1d }),
    glass: new THREE.MeshLambertMaterial({ color: 0x8fbcd4, transparent: true, opacity: 0.55 }),
    path: new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    shingleFallback: new THREE.MeshLambertMaterial({ color: 0x4b2d1e })
  };

  scene.add(new THREE.HemisphereLight(0xddeeff, 0x22331f, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(12, 28, 10);
  sun.castShadow = true;
  scene.add(sun);

  let wallBuilder = null;
  let shingleSource = null;
  const npcModels = new Map();
  let lastSignature = '';
  let controls = { dragging: false, lastX: 0, lastY: 0, yaw: -0.72, pitch: 0.72, dist: 48, target: new THREE.Vector3(24, 0, 16) };

  function log(message, level = 'info') { ui()?.log?.(`[3D] ${message}`, level); }
  function clearGroup(g) { while (g.children.length) { const c = g.children.pop(); disposeObject(c); } }
  function disposeObject(o) { o.traverse?.(c => { if (c.geometry) c.geometry.dispose?.(); const ms = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : []; ms.forEach(m => { if (!Object.values(mats).includes(m)) { m.map?.dispose?.(); m.dispose?.(); } }); }); }
  function tileToWorld(x, y) { return new THREE.Vector3(x + 0.5, 0, y + 0.5); }
  function makeBox(w, h, d, mat, x, y, z) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }
  function makeTriPrism(width, depth, height, lengthAlongX, mat) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0); shape.lineTo(width / 2, 0); shape.lineTo(0, height); shape.lineTo(-width / 2, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: lengthAlongX ? depth : width, bevelEnabled: false });
    geo.center();
    const mesh = new THREE.Mesh(geo, mat);
    if (lengthAlongX) mesh.rotation.y = Math.PI / 2;
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  function makeWallPanels(house) {
    const x = house.x, z = house.y, w = house.width, d = house.depth, h = 2.2;
    return [
      { id: house.id + '_north', width: w, height: h, position: [x + w / 2, 0, z], rotationDeg: [0, 0, 0], wallRecipeId: house.wallRecipeId },
      { id: house.id + '_south', width: w, height: h, position: [x + w / 2, 0, z + d], rotationDeg: [0, 180, 0], wallRecipeId: house.wallRecipeId },
      { id: house.id + '_west', width: d, height: h, position: [x, 0, z + d / 2], rotationDeg: [0, 90, 0], wallRecipeId: house.wallRecipeId },
      { id: house.id + '_east', width: d, height: h, position: [x + w, 0, z + d / 2], rotationDeg: [0, -90, 0], wallRecipeId: house.wallRecipeId }
    ];
  }
  async function initAssets() {
    if (!wallBuilder && window.WallBuilder) {
      wallBuilder = new window.WallBuilder({ glbBasePath: '../../assets/models/' });
      try { await wallBuilder.loadDefaultGlb(); log('Wall GLB loaded.'); } catch (e) { wallBuilder.ensurePlaceholderGlb(); log('Wall GLB missing; using placeholder wall units.', 'warn'); }
    }
    if (!shingleSource) {
      const loader = new THREE.GLTFLoader();
      const candidates = ['../../assets/models/highlandlongshingle_boned.glb','../../assets/highlandlongshingle_boned.glb','../../../assets/models/highlandlongshingle_boned.glb'];
      for (const url of candidates) {
        try { shingleSource = await new Promise((res, rej) => loader.load(url, g => res(g.scene), undefined, rej)); log('Highland shingle GLB loaded.'); break; } catch (_e) {}
      }
      if (!shingleSource) log('highlandlongshingle_boned.glb not found; using procedural shingles.', 'warn');
    }
  }
  function addShingles(group, house) {
    const w = house.width, d = house.depth, x0 = house.x, z0 = house.y;
    const rows = Math.max(3, Math.ceil(d * 1.7));
    const cols = Math.max(4, Math.ceil(w * 1.2));
    for (let side = -1; side <= 1; side += 2) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let obj;
        if (shingleSource) obj = shingleSource.clone(true); else obj = makeBox(0.72, 0.055, 0.34, mats.shingleFallback, 0, 0, 0);
        obj.scale.setScalar(shingleSource ? 0.42 : 1);
        obj.position.set(x0 + 0.35 + c * (w - 0.7) / Math.max(1, cols - 1), 2.55 + r * 0.07, z0 + d / 2 + side * (0.12 + r * d / (rows * 2.15)));
        obj.rotation.x = side * -0.72; obj.rotation.y = 0; obj.rotation.z = (Math.sin((r + 1) * (c + 3)) * 0.035);
        group.add(obj);
      }
    }
  }
  function buildHouse(house) {
    const group = new THREE.Group(); group.name = 'HighlandFootprint_' + house.id;
    const x = house.x, z = house.y, w = house.width, d = house.depth;
    group.add(makeBox(w, 0.16, d, mats.floor, x + w / 2, 0.08, z + d / 2));
    group.add(makeBox(w * 0.88, 2.0, d * 0.88, mats.plaster, x + w / 2, 1.08, z + d / 2));
    const gableA = makeTriPrism(d * 0.92, w * 0.92, 1.15, true, mats.gable); gableA.position.set(x + w / 2, 2.2, z + d / 2); group.add(gableA);
    const roofA = makeBox(w * 1.08, 0.18, d * 0.64, mats.roof, x + w / 2, 2.62, z + d * 0.33); roofA.rotation.x = -0.62; group.add(roofA);
    const roofB = makeBox(w * 1.08, 0.18, d * 0.64, mats.roof, x + w / 2, 2.62, z + d * 0.67); roofB.rotation.x = 0.62; group.add(roofB);
    addShingles(group, house);
    const door = window.HobunjiMapBuilder.deriveDoorTile(house);
    group.add(makeBox(0.8, 1.25, 0.08, mats.door, door.x + .5, .72, door.y + .05));
    group.add(makeBox(0.56, 0.45, 0.06, mats.glass, x + w * .27, 1.28, z + d + .04));
    group.add(makeBox(0.56, 0.45, 0.06, mats.glass, x + w * .73, 1.28, z + d + .04));
    if (wallBuilder) {
      const walls = wallBuilder.build(makeWallPanels(house), { preScale: [0.25, 0.25, 0.1], rockScale: 1, usePlaceholder: true, brickJitter: { rotYDeg: 4, shiftU: 0.015, shiftV: 0.015 } });
      walls.name = 'WallBuilder_shell_' + house.id;
      group.add(walls);
    }
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
    const runtime = ev.detail; await initAssets(); if (signature(runtime) !== lastSignature) rebuildWorld(runtime); await ensureNpcModels(runtime); updateNpcPositions(runtime);
  }
  function animate() { resize(); updateCamera(); renderer.render(scene, camera); requestAnimationFrame(animate); }
  window.addEventListener('hobunji-map-builder:update', handleUpdate);
  initAssets().then(() => { const rt = window.HobunjiMapBuilderRuntime; if (rt) handleUpdate({ detail: rt }); });
  animate();
})();
