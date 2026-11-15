(() => {
  'use strict';

  // Dev Testing Arena extras: a pond to stand in front of (or wade into) and
  // spawnable dummy NPCs that stand still at a chosen offset from the player.
  // Built for checking x-ray / draw-order behavior between the player, other
  // actors and translucent water without hunting for a river in the world.
  // Wired from js/dev-spawner.js (init + teleportToDevArena); the UI section is
  // injected into the existing Creature Spawner panel.
  if (window.DevArenaPondDummy?.version >= 1) return;

  const ARENA_ID = 'map_dev_arena';
  const OWNER = 'dev-arena-dummy-npc'; // NpcScheduling target-override owner id.
  const POND = Object.freeze({ col: 4, row: 3, cols: 10, rows: 3 }); // North of the arena entry; the camera looks north, so the pond sits behind the player.
  const POND_SURFACE_LIFT = 0.04; // Water sheet sits just above the flat arena floor.
  const SPAWN_DISTANCE_TILES = 1.8; // Far enough that the dummy never overlaps the player's collision circle.
  const ARENA_MARGIN = 1.5; // Keep dummies inside the arena walls.
  const SPECIES = 'mao-ao';
  const CAMERA_PITCH_DEG = -20; // Camera pitch offset: lower the camera so the waterfall rises behind the player's portrait.
  const CAMERA_OFFSET_H = 0.02; // Shoulder-surf horizontal offset in tiles; the default is 0.35.

  let deps = null;
  let serial = 0;
  const dummies = new Map(); // npc id -> { rec, target }

  function arenaScene() {
    return deps?.zoneScenes?.get(ARENA_ID)?.scene || null;
  }

  function toast(message, ok = true) { deps?.showToast?.(message, ok); }

  // A rock ledge north of the pond with a waterfall curtain falling into it, so
  // vertical water, flat water and actors can all be lined up in one view.
  // Reuses the real waterfall curtain builder with a tiny synthetic grid: one
  // raised row of WATERFALL tiles whose only lower neighbour is the pond side.
  function buildWaterfall(scene) {
    const features = window.ZoneTerrainFeatures;
    if (!features?.buildWaterfallCurtainMeshes || !window.THREE) return null;
    const THREE = window.THREE;
    const cols = deps.EXTERIOR_ZONES[ARENA_ID].cols, rows = deps.EXTERIOR_ZONES[ARENA_ID].rows;
    const fallRow = POND.row - 1;
    const c0 = POND.col + Math.floor(POND.cols / 2) - 1, c1 = c0 + 2; // Three tiles wide, centred on the pond.
    const grid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({
      type: 'grass', elevTier: r <= fallRow && c >= POND.col && c < POND.col + POND.cols ? 1 : 0,
    })));
    for (let c = c0; c <= c1; c++) grid[fallRow][c].type = 'waterfall'; // Neighbours east/west/north share tier 1, so only the south curtain is emitted.
    const meshes = features.buildWaterfallCurtainMeshes(scene, grid, cols, rows, 'dev_arena_pond_fall');
    const curtain = meshes?.[0];
    if (!curtain) return null;
    curtain.geometry.computeBoundingBox();
    const lipY = curtain.geometry.boundingBox.max.y;
    const ledge = new THREE.Mesh(
      new THREE.BoxGeometry(POND.cols, lipY, fallRow + 1),
      new THREE.MeshLambertMaterial({ color: 0x6f6a62 }));
    ledge.position.set(POND.col + POND.cols / 2, lipY / 2, (fallRow + 1) / 2 - 0.02); // South face sits just behind the curtain.
    ledge.name = 'dev_arena_ledge';
    scene.add(ledge);
    deps.markOutline?.(ledge);
    return { curtain, ledge };
  }

  // Idempotent: a rebuilt arena scene (dirty-zone rebuild) simply gets a new pond.
  function ensurePond() {
    const scene = arenaScene();
    if (!scene || !window.WaterSystem?.buildMergedWaterMesh) return null;
    const existing = scene.userData?.devArenaPond;
    if (existing && existing.parent === scene) return existing;
    const grid = deps.getActiveGrid?.();
    const cells = [];
    for (let r = POND.row; r < POND.row + POND.rows; r++) {
      for (let c = POND.col; c < POND.col + POND.cols; c++) {
        const tile = grid?.[r]?.[c];
        const groundY = tile ? deps.tileSurfaceYInArea(tile, ARENA_ID) : 0;
        cells.push({ col: c, row: r, surfaceY: groundY + POND_SURFACE_LIFT, depth: 0.8, coverage: 1, flowX: 0, flowZ: 0 });
      }
    }
    const mesh = window.WaterSystem.buildMergedWaterMesh(scene, cells, {
      name: 'dev_arena_pond_water', statKey: 'dev arena pond', // "local" water: not a flood sheet, not a permanent river.
    });
    if (!mesh) return null;
    scene.userData = scene.userData || {};
    scene.userData.devArenaPond = mesh;
    scene.userData.devArenaWaterfall = buildWaterfall(scene);
    deps.zoneWaterMeshes?.get(ARENA_ID)?.push(mesh);
    return mesh;
  }

  function playerTile() {
    return { c: deps.player.x / deps.TILE, r: deps.player.y / deps.TILE };
  }

  // Camera-relative ground direction, so "front" really means farther from the
  // camera than the player, whichever way the camera is currently turned.
  function cameraBasis() {
    const camera = deps.getActiveCamera?.();
    const f = { x: 0, z: -1 };
    if (camera?.getWorldDirection && window.THREE) {
      const v = camera.getWorldDirection(new window.THREE.Vector3());
      const len = Math.hypot(v.x, v.z);
      if (len > 1e-3) { f.x = v.x / len; f.z = v.z / len; }
    }
    return { f, side: { x: -f.z, z: f.x } };
  }

  const OFFSETS = Object.freeze({
    front: [1, 0], behind: [-1, 0], left: [0, -1], right: [0, 1],
  });

  function clampTile(value, max) {
    return Math.min(max - ARENA_MARGIN, Math.max(ARENA_MARGIN, value));
  }

  async function spawnDummy(where) {
    if (deps.getCurrentArea() !== ARENA_ID) { toast('Dummy NPCs only spawn in the Testing Arena.', false); return null; }
    const [fwd, sideways] = OFFSETS[where] || OFFSETS.front;
    const { f, side } = cameraBasis();
    const p = playerTile();
    const zdef = deps.EXTERIOR_ZONES[ARENA_ID];
    const c = Math.floor(clampTile(p.c + (f.x * fwd + side.x * sideways) * SPAWN_DISTANCE_TILES, zdef.cols));
    const r = Math.floor(clampTile(p.r + (f.z * fwd + side.z * sideways) * SPAWN_DISTANCE_TILES, zdef.rows));
    const id = `dev_dummy_npc_${++serial}_${Date.now().toString(36)}`;
    const rec = {
      id, name: `Dummy ${serial}`, species: SPECIES, gender: 'male',
      appearance: { speciesId: SPECIES, gender: 'male', cosmetics: {} },
      equippedCosmetics: [], appliedDyes: {},
      role: 'dummy', tags: ['dev-dummy'], devDummy: true,
      relationship: { canBefriend: false, canDate: false, canMarry: false, maxHearts: 0 },
      scheduleHooks: { rules: [] }, ambientGreetings: false,
    };
    const target = { area: ARENA_ID, c, r, label: 'Dev dummy', activity: 'standing' };
    dummies.set(id, { rec, target });
    window.NpcScheduling?.registerTargetOverride?.(OWNER, provider); // Re-registering the same owner is a no-op replace.
    setStatus(`Spawning ${rec.name} (${where})…`);
    try {
      const walker = await deps.spawnNpcRecord(rec, target);
      if (!walker) throw new Error('avatar build returned no walker');
      walker.root?.position?.set?.(c + 0.5, walker.root.position.y, r + 0.5); // Appear at the tile instead of walking in from the origin.
      setStatus(`${rec.name} spawned ${where} of you at tile ${c},${r}.`);
      return walker;
    } catch (error) {
      dummies.delete(id);
      console.warn('[DevArenaPondDummy] spawn failed', error);
      setStatus(`Dummy spawn failed: ${error.message}`);
      return null;
    }
  }

  function provider(rec) {
    const entry = dummies.get(rec?.id);
    return entry ? entry.target : null;
  }

  function clearDummies() {
    let removed = 0;
    for (const [id] of dummies) {
      const walker = deps.npcWalkers.find(w => w.rec?.id === id);
      if (walker && deps.despawnNpcWalker(walker)) removed++;
    }
    dummies.clear();
    setStatus(`Removed ${removed} dummy NPC${removed === 1 ? '' : 's'}.`);
    return removed;
  }

  // Stands the player a couple of tiles south of the pond, facing it.
  function standAtPond(bankGapTiles = 1.5) {
    if (deps.getCurrentArea() !== ARENA_ID) { toast('Go to the Testing Arena first.', false); return false; }
    ensurePond();
    deps.player.x = (POND.col + Math.floor(POND.cols / 2) + 0.5) * deps.TILE; // Tile centre, so a dummy spawned dead ahead is exactly in line with the camera.
    deps.player.y = (POND.row + POND.rows + bankGapTiles) * deps.TILE; // 1.5 = a short way back; ~0.3 = on the bank with the water directly behind.
    deps.player.vx = 0; deps.player.vy = 0;
    deps._snapCameraTarget?.();
    setStatus('Standing in front of the pond.');
    return true;
  }

  // Female Kenkari (the smallest species) with the shoulder camera almost centred behind the
  // player. In-memory only: "Restore look" brings back the saved species and camera offset.
  async function applyTestLook(pitchDeg = CAMERA_PITCH_DEG) {
    if (!deps.devTestLook) return false;
    setStatus('Applying female Kenkari + centred camera…');
    const ok = await deps.devTestLook.apply('kenkari', 'female', CAMERA_OFFSET_H, pitchDeg);
    setStatus(ok ? 'Player is now a female Kenkari; camera centred and tilted up. Restore look before saving.' : 'Player appearance is not ready.');
    return ok;
  }

  async function restoreLook() {
    const ok = await deps.devTestLook?.restore();
    setStatus(ok ? 'Original species and camera offset restored.' : 'Nothing to restore.');
    return ok;
  }

  function setStatus(message) {
    const el = document.getElementById('devPondDummyStatus');
    if (el && el.textContent !== message) el.textContent = message;
  }

  function injectUi() {
    const scroll = document.querySelector('#devSpawnPanel .fed-scroll');
    if (!scroll || document.getElementById('devPondDummySection')) return;
    const section = document.createElement('div');
    section.className = 'fed-section';
    section.id = 'devPondDummySection';
    section.innerHTML = `
      <div class="fed-label">Pond &amp; dummy NPC — stand by the water and drop a stationary NPC next to you to check draw order / x-ray</div>
      <div class="fed-actions">
        <button type="button" class="fed-action-btn" id="devPondStandBtn">🏞️ Stand in front of pond</button>
        <button type="button" class="fed-action-btn" id="devPondBankBtn">🪵 Stand on the bank</button>
        <button type="button" class="fed-action-btn" id="devTestLookBtn">🧝 Female Kenkari + centred, tilted camera</button>
        <button type="button" class="fed-action-btn" id="devTestLookRestoreBtn">↩️ Restore look</button>
      </div>
      <div class="fed-actions">
        <button type="button" class="fed-action-btn" data-dummy="front">🧍 Dummy ahead</button>
        <button type="button" class="fed-action-btn" data-dummy="behind">🧍 Dummy nearer camera</button>
        <button type="button" class="fed-action-btn" data-dummy="left">🧍 Dummy left</button>
        <button type="button" class="fed-action-btn" data-dummy="right">🧍 Dummy right</button>
        <button type="button" class="fed-action-btn fed-danger" id="devDummyClearBtn">🗑️ Clear dummies</button>
      </div>
      <div class="fed-label" id="devPondDummyStatus" role="status">Ready.</div>`;
    scroll.appendChild(section);
    section.addEventListener('click', event => {
      const spawnBtn = event.target.closest('[data-dummy]');
      if (spawnBtn) { spawnDummy(spawnBtn.dataset.dummy); return; }
      if (event.target.closest('#devPondStandBtn')) standAtPond();
      else if (event.target.closest('#devPondBankBtn')) standAtPond(0.3);
      else if (event.target.closest('#devTestLookBtn')) applyTestLook();
      else if (event.target.closest('#devTestLookRestoreBtn')) restoreLook();
      else if (event.target.closest('#devDummyClearBtn')) clearDummies();
    });
  }

  function init(injected) {
    deps = injected;
    injectUi();
  }

  window.DevArenaPondDummy = {
    version: 1,
    init, ensurePond, standAtPond, applyTestLook, restoreLook, spawnDummy, clearDummies,
    snapshot: () => ({ pond: !!arenaScene()?.userData?.devArenaPond, waterfall: !!arenaScene()?.userData?.devArenaWaterfall, dummies: [...dummies.keys()] }),
  };
})();
