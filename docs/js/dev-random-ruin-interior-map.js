// Dev Random Test Ruin — proper session-only building interior backed by the exact
// Debris-ifier V50 generator. Unlike the earlier arena harness, this registers a
// real map_i_* record in the game's existing _buildingScenes map and enters it
// through the normal area/scene lifecycle. No generated seed/state is saved.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  const DevSpawner = window.DevSpawner;
  const GridTileAccessors = window.GridTileAccessors;
  const TileOccupancy = window.DevRandomRuinTileOccupancy;
  const Solvability = window.DevRandomRuinSolvability;
  if (!DS || !DevSpawner || !GridTileAccessors || !TileOccupancy || !Solvability) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const SCOPE = 'dev-random-ruin-interior';
  const SOURCE_SHA = '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40';
  const RUIN_TILE_SCALE = 2; // V50 authors 0.5-world-unit cells; runtime expands them to 1.0 so entrances/corridors have player-safe clearance.
  const PAD = 2;
  const PLAYER_RADIUS = 0.28;
  const CONTROL_RANGE = 1.65;
  const MAX_STEP_HEIGHT = 0.42;
  const FALL_MS = 650;
  const TRANSITION_FALLBACK_MS = 1600; // Dev-only escape hatch when the normal fade lifecycle is unavailable (e.g. title/dev harness state).
  const GENERATOR_FRAME_TIMEOUT_MS = 30000; // Gives the hidden V50 iframe enough time to finish parser/startup work on slower browsers and CI before reporting a real bootstrap failure.
  const MAX_SOLVABILITY_ATTEMPTS = 6; // Rejects impossible candidates before entry while keeping generation bounded.
  const PUZZLE_OPTIONS_STORAGE_KEY = 'hobunji.devRandomRuinPuzzleOptions.v2'; // v2 intentionally drops the fragile first-pass mechanisms from the shipped simple-puzzle defaults.
  const DARKNESS_SETTINGS_STORAGE_KEY = 'hobunji.devRandomRuinDarkness.v1'; // Used to persist the test-only darkness toggle and severity without changing real den lighting.
  const DEFAULT_DARKNESS_SETTINGS = Object.freeze({ enabled:false, severity:1 }); // Theme darkness is always active; enabling the dev toggle only permits a severity override.
  const DEFAULT_PUZZLE_OPTIONS = Object.freeze({ pressurePlate:false, brazier:false, glyphObelisk:true, stackedObelisk:false, linkedCubePillars:false, nestedRoom:false, safePath:true, ropeSwing:true, hallwayTraps:true, lavaBasin:true, sanctum:true, maxPerRoom:0 }); // First playable pass keeps only the proven projectile activator from V50; the three parent-runtime families below are intentionally simple and non-locking.
  const PUZZLE_OPTION_ROWS = Object.freeze([ // Only the simple-mode families are user-facing; disabled V50 families remain false in the normalized payload.
    ['glyphObelisk','Projectile glyph targets'],
    ['safePath','Safe-path pressure grids'],
    ['ropeSwing','Rope swing traversal'],
    ['hallwayTraps','Alternating hallway fire / poison traps'],
    ['lavaBasin','Deep lava basin rope rooms'],
    ['sanctum','Blue braziers, Great Door and lich sanctum'],
  ]);

  let deps = null;
  let buildingScenes = null;
  let gridDeps = null;
  let ruin = null;
  let returnAnchor = null;
  let generatorFrame = null;
  let generatorApi = null;
  let lastGenerationAudit = null; // Retains rejected-seed diagnostics even when no ruin is ultimately entered.
  let darknessSettings = null; // Cached test-only lighting controls read by CloudForestFog at overlay draw time.
  let frameLastMs = performance.now();
  let lastPresentationElevation = null; // Used as the ruin's authoritative stand height consumed by the normal game.js player/body/attachment render path.

  function clearRuinPresentationHeight() {
    lastPresentationElevation = null;
  }

  function syncRuinPresentationHeight(worldY) {
    const elevation = Number(worldY); // Used to publish one dynamic-floor height without directly repositioning any player presentation object.
    if (!Number.isFinite(elevation)) return false;
    lastPresentationElevation = elevation;
    return true;
  }

  function getPlayerSupportY() {
    if (!ruin || deps?.getCurrentArea?.() !== MAP_ID) return null;
    return Number.isFinite(lastPresentationElevation) ? lastPresentationElevation : null;
  }
  function getPlayerGroundSupportY() {
    if (!ruin || deps?.getCurrentArea?.() !== MAP_ID) return null;
    return Number.isFinite(ruin.supportY) ? ruin.supportY : null; // Physical support used for hazard contact, unaffected by the cosmetic sinking offset.
  }
  function getGroundSupportYAt(x, z) {
    if (!ruin || deps?.getCurrentArea?.() !== MAP_ID || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const ground=DS.sampleSupport?.(x,z,{minY:-60,maxY:60,pad:.02}); // Spell impacts sample the actual ruined terrain, including lower/sunken floors.
    return Number.isFinite(ground?.y) ? ground.y : null;
  }

  function setPlayerWorldPoint(point, options = {}) {
    if (!point || !deps?.player || !deps?.TILE) return false;
    const x = Number(point.x);
    const z = Number(point.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const suppliedY = Number(point.y);
    const grounded = options.grounded !== false;
    let support = null;
    if (grounded) {
      const centerY = Number.isFinite(suppliedY) ? suppliedY : 0;
      support = DS.sampleSupport?.(x, z, { minY:centerY - .45, maxY:centerY + .45, pad:.02 })
        || DS.sampleSupport?.(x, z, { minY:-8, maxY:12, pad:.02 })
        || null;
    }
    const y = Number.isFinite(suppliedY) ? suppliedY : Number(support?.y) || 0;
    deps.player.x = x * deps.TILE;
    deps.player.y = z * deps.TILE;
    deps.player.vx = 0;
    deps.player.vy = 0;
    if (ruin && grounded) {
      ruin.supportId = support?.id || null;
      ruin.supportY = y;
      ruin.lastAcceptedPx = { x:deps.player.x, y:deps.player.y };
      ruin.lastSafePx = { ...ruin.lastAcceptedPx };
      ruin.falling = null;
    }
    syncRuinPresentationHeight(y);
    if (options.snapCamera !== false) deps._snapCameraTarget?.();
    return true;
  }

  function setMechanismTarget(mechanismId, target = 1) {
    const mechanism=ruin?.mechanisms?.get?.(String(mechanismId||'')); // Lets modular puzzle composers emit an authoritative mechanism signal without reaching into the ruin runtime's private map.
    if(!mechanism)return false;
    const normalized=clamp(Number(target)||0,0,1);
    mechanism.target=normalized;
    mechanism.externalTarget=normalized; // Explicit composer signals override stale V50 plate/glyph solveProgress so the visible door/platform actually follows the requested state.
    return true;
  }

  // Seals a mechanism shut until unlockMechanism(); its manual prompt reports
  // why. Used by puzzle composers (e.g. a rope-platform pressure plate).
  function lockMechanism(mechanismId, reason = 'Sealed.') {
    const mechanism=ruin?.mechanisms?.get?.(String(mechanismId||''));
    if(!mechanism)return false;
    mechanism.lockReason=String(reason||'Sealed.');
    mechanism.target=0;
    mechanism.externalTarget=0;
    return true;
  }

  function unlockMechanism(mechanismId, open = true) {
    const mechanism=ruin?.mechanisms?.get?.(String(mechanismId||''));
    if(!mechanism)return false;
    mechanism.lockReason=null;
    mechanism.target=open?1:0;
    mechanism.externalTarget=open?1:0;
    return true;
  }

  function mechanismInfo(mechanismId) {
    const mechanism=ruin?.mechanisms?.get?.(String(mechanismId||''));
    if(!mechanism)return null;
    const data=mechanism.root?.userData||{};
    return { id:mechanism.id, type:mechanism.type, root:mechanism.root, progress:mechanism.progress, locked:!!mechanism.lockReason, gated:!!mechanism.gated, externalTarget:mechanism.externalTarget??null, target:mechanism.target, signalLinked:!!(data.linkedCubePuzzleRoot||data.linkedPressurePlateRoot) };
  }

  function presentationSnapshot() {
    const ring = deps?.player?._ringHud || null; // Used to expose resource-ring parity in the existing mobile/debug ruin snapshot.
    return {
      elevation:lastPresentationElevation,
      bodyY:Number(deps?.playerMesh?.position?.y) || 0,
      shadowY:Number(deps?.playerGroundShadow?.position?.y) || 0,
      resourceRingY:ring?.position ? Number(ring.position.y) || 0 : null,
      resourceRingVisible:ring?.visible ?? null,
      renderAuthority:'game-updatePlayerMesh',
    };
  }

  let requestedRuinType=null; // The projection selects one exclusive extra wing: Hachutu OR Harlyao, never both.
  let generationLabel=null; // Player-facing ruin name when a wilderness site generated it (null = dev Random Test Ruin).
  function devModeEnabled() {
    try { return localStorage.getItem('hobunjiDevMode') === '1'; } catch (_) { return false; }
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const localCellSize = meta => Number(meta?.cellSize) || 0.5;
  const worldCellSize = meta => localCellSize(meta) * RUIN_TILE_SCALE;
  const scaledWorldWidth = (meta, fallback = 0) => (Number(meta?.worldWidth) || fallback) * RUIN_TILE_SCALE;
  const scaledWorldDepth = (meta, fallback = 0) => (Number(meta?.worldDepth) || fallback) * RUIN_TILE_SCALE;
  function randomSeed() {
    try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0; }
    catch (_) { return ((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0); }
  }
  function generationCandidateSeed(seed, attempt) {
    const base = Number(seed) >>> 0; // Base seed remains the first attempted candidate for reproducible debugging.
    return attempt <= 0 ? base : (base + Math.imul(attempt, 0x9e3779b9)) >>> 0;
  }
  function detach(object) { if (object?.parent) object.parent.remove(object); }

  function normalizePuzzleGenerationOptions(raw = {}) {
    const normalized = { ...DEFAULT_PUZZLE_OPTIONS }; // Used as the complete generator-facing puzzle option object.
    for (const [key] of PUZZLE_OPTION_ROWS) normalized[key] = raw?.[key] !== false;
    normalized.maxPerRoom = clamp(Math.floor(Number(raw?.maxPerRoom) || 0), 0, 12);
    return normalized;
  }

  function readPuzzleGenerationOptions() {
    let saved = null; // Used to hold the parsed persisted Settings value when available.
    try { saved = JSON.parse(localStorage.getItem(PUZZLE_OPTIONS_STORAGE_KEY) || 'null'); } catch (_) {}
    return normalizePuzzleGenerationOptions(saved || {});
  }

  function savePuzzleGenerationOptions(options) {
    const normalized = normalizePuzzleGenerationOptions(options); // Used both for persistence and to keep malformed mobile number input out of generator state.
    try { localStorage.setItem(PUZZLE_OPTIONS_STORAGE_KEY, JSON.stringify(normalized)); } catch (_) {}
    return normalized;
  }

  function normalizeDarknessSettings(raw = {}) {
    const rawSeverity = Number(raw?.severity); // Slider value is stored as normalized 0..1 so the lighting module never needs UI-specific percent math.
    return {
      enabled: raw?.enabled === true,
      severity: Number.isFinite(rawSeverity) ? clamp(rawSeverity, 0, 1) : DEFAULT_DARKNESS_SETTINGS.severity,
    };
  }

  function getDarknessSettings() {
    if (!darknessSettings) {
      let saved = null; // Read once, then keep the hot lighting path off localStorage.
      try { saved = JSON.parse(localStorage.getItem(DARKNESS_SETTINGS_STORAGE_KEY) || 'null'); } catch (_) {}
      darknessSettings = normalizeDarknessSettings(saved || DEFAULT_DARKNESS_SETTINGS);
    }
    return { ...darknessSettings };
  }

  function saveDarknessSettings(next) {
    darknessSettings = normalizeDarknessSettings(next);
    try { localStorage.setItem(DARKNESS_SETTINGS_STORAGE_KEY, JSON.stringify(darknessSettings)); } catch (_) {}
    window.CloudForestFog?.refreshLightingOverlay?.(); // Redraw immediately while dragging/toggling instead of waiting for the normal 100ms overlay cadence.
    updateBadge();
    return { ...darknessSettings };
  }

  function bindDarknessControls(row) {
    if (!row || row.dataset.bound === '1') return;
    row.dataset.bound = '1';
    const enabled = row.querySelector('#devRandomRuinDarknessEnabled'); // Toggle that restores the authored den overlay for visual checks.
    const severity = row.querySelector('#devRandomRuinDarknessSeverity'); // 0..100 UI mapped to normalized overlay severity.
    const output = row.querySelector('#devRandomRuinDarknessSeverityValue'); // Mobile-visible live severity readout.
    const render = settings => {
      if (enabled) enabled.checked = settings.enabled;
      if (severity) severity.value = String(Math.round(settings.severity * 100));
      if (output) output.textContent = Math.round(settings.severity * 100) + '%';
    };
    const commit = () => {
      const next = saveDarknessSettings({
        enabled: !!enabled?.checked,
        severity: clamp((Number(severity?.value) || 0) / 100, 0, 1),
      });
      if (output) output.textContent = Math.round(next.severity * 100) + '%';
    };
    render(getDarknessSettings());
    enabled?.addEventListener('change', commit);
    severity?.addEventListener('input', commit);
  }

  function puzzleOptionsFromPanel(panel) {
    const next = readPuzzleGenerationOptions(); // Used as a fallback for controls that are absent from an older/cached Settings DOM.
    for (const checkbox of panel?.querySelectorAll?.('[data-ruin-puzzle-option]') || []) next[checkbox.dataset.ruinPuzzleOption] = !!checkbox.checked;
    const maxInput = panel?.querySelector?.('#devRandomRuinMaxPuzzlesPerRoom'); // Used to read the room puzzle cap from the collapsed panel.
    if (maxInput) next.maxPerRoom = clamp(Math.floor(Number(maxInput.value) || 0), 0, 12);
    return savePuzzleGenerationOptions(next);
  }

  function bindPuzzleOptionsPanel(panel) {
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';
    const current = readPuzzleGenerationOptions(); // Used to initialize every generated checkbox and the numeric cap.
    for (const checkbox of panel.querySelectorAll('[data-ruin-puzzle-option]')) {
      checkbox.checked = current[checkbox.dataset.ruinPuzzleOption] !== false;
      checkbox.addEventListener('change', () => puzzleOptionsFromPanel(panel)); // Direct binding avoids unrelated Settings capture/delegation from swallowing dev-only programmatic or touch changes.
    }
    const maxInput = panel.querySelector('#devRandomRuinMaxPuzzlesPerRoom'); // Used to show the persisted room cap without requiring devtools.
    if (maxInput) {
      maxInput.value = String(current.maxPerRoom);
      maxInput.addEventListener('input', () => puzzleOptionsFromPanel(panel));
      maxInput.addEventListener('change', () => puzzleOptionsFromPanel(panel));
    }
  }

  function captureBuildingScenes(injectedDeps) {
    gridDeps = injectedDeps;
    buildingScenes = injectedDeps?._buildingScenes || buildingScenes;
  }
  const nativeGridInit = GridTileAccessors.init;
  GridTileAccessors.init = function (injectedDeps) {
    captureBuildingScenes(injectedDeps);
    return nativeGridInit.call(this, injectedDeps);
  };

  function captureDeps(injectedDeps) { deps = injectedDeps; installSettingsButton(); }
  window.AreaFootprintBlockers?.registerSurface?.('dev-random-ruin-floor', {
    area:MAP_ID,
    enabled:() => !!ruin && floorHeights.size > 0,
    // Shots fired up out of a basin used the flat tile height and stopped at
    // an invisible floor at rim level; this returns the cell's true floor.
    surfaceYAt:(x, z) => { const y = floorHeights.get(`${Math.floor((x - PAD) / floorCellSize)},${Math.floor((z - PAD) / floorCellSize)}`); return Number.isFinite(y) ? y : null; },
  });
  const nativeDevInit = DevSpawner.init;
  DevSpawner.init = function (injectedDeps) {
    captureDeps(injectedDeps);
    return nativeDevInit.call(this, injectedDeps);
  };

  function playerSceneObjects() {
    return [deps?.playerMesh, deps?.playerGroundShadow, deps?.player?._ringHud, deps?.toolHolder, deps?.reticleMesh,
      deps?.reticleCircleMesh, deps?.reticleRingMesh, deps?.reticleWavyGroup].filter(Boolean);
  }
  function movePlayerObjectsTo(scene) {
    for (const object of playerSceneObjects()) { detach(object); scene?.add(object); }
  }

  // Resolve only after the transition midpoint has actually applied the scene
  // switch. Reroll callers can then safely start another generation without a
  // stale midpoint callback acting on a later `ruin` instance.
  function runSceneTransition(callback) {
    return new Promise((resolve, reject) => {
      let fired = false;
      let fallbackTimer = 0;
      const once = () => {
        if (fired) return;
        fired = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        try { callback(); resolve(); }
        catch (error) { reject(error); }
      };
      fallbackTimer = setTimeout(() => {
        if (!fired) {
          console.warn('[Random Test Ruin] normal scene-transition midpoint did not fire; using dev direct-switch fallback.');
          once();
        }
      }, TRANSITION_FALLBACK_MS);
      try {
        if (typeof deps?.startSceneTransition === 'function') deps.startSceneTransition(once);
        else once();
      } catch (error) {
        console.warn('[Random Test Ruin] scene transition failed; using direct-switch fallback.', error);
        once();
      }
    });
  }

  function removeGeneratorFrame() {
    generatorApi = null;
    generatorFrame?.remove();
    generatorFrame = null;
  }
  async function ensureGeneratorFrame() {
    if (generatorApi && generatorFrame?.isConnected) return generatorApi;
    removeGeneratorFrame();
    const frame = document.createElement('iframe');
    frame.id = 'devRandomRuinGeneratorFrame';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:16px;height:16px;opacity:0;pointer-events:none;border:0;z-index:-1';
    frame.src = `tools/debris-ifier/index.html?devRuntime=1&t=${Date.now()}`;
    document.body.appendChild(frame);
    generatorFrame = frame;
    const started = performance.now();
    while (performance.now() - started < GENERATOR_FRAME_TIMEOUT_MS) {
      const api = frame.contentWindow?.DebrisifierV50;
      if (api?.sourceSha256 === SOURCE_SHA) return (generatorApi = api);
      const debug = frame.contentDocument?.getElementById('debug')?.textContent || '';
      if (/FAILED/i.test(debug)) throw new Error(debug);
      await wait(25);
    }
    const child = frame.contentWindow;
    const lateApi = child?.DebrisifierV50; // Used to close the deadline race where V50 becomes ready during the final polling await but before timeout diagnostics are captured.
    if (lateApi?.sourceSha256 === SOURCE_SHA) return (generatorApi = lateApi);
    const scripts = [...(frame.contentDocument?.scripts || [])].map(script => script.src || '[inline]').slice(-12);
    const diagnostics = {
      readyState:frame.contentDocument?.readyState || null,
      apiPresent:!!child?.DebrisifierV50,
      apiSha:child?.DebrisifierV50?.sourceSha256 || null,
      three:!!child?.THREE,
      gltf:!!child?.THREE?.GLTFLoader,
      usedParentThree:child?.__debrisUsedParentThree===true, // Distinguishes the intended local hidden-runtime path from an accidental CDN fallback in mobile/CI reports.
      deps:[...(child?.__debrisDeps || [])],
      bootErrors:[...(child?.__debrisBootErrors || [])],
      debug:(frame.contentDocument?.getElementById('debug')?.textContent || '').slice(-900),
      scripts,
    };
    throw new Error('Timed out loading Debris-ifier V50. '+JSON.stringify(diagnostics));
  }

  function makeTile(walkable) {
    const TileType = gridDeps?.TileType || deps?.TileType || {};
    const CropType = gridDeps?.CropType || deps?.CropType || {};
    return {
      type: walkable ? (TileType.GRASS ?? 'grass') : (TileType.ROCK ?? 'rock'),
      water: 0, crop: CropType.NONE ?? 'none', cropAge: 0, cropReady: false,
      stress: '', variation: 0,
    };
  }

  function floorProjection(meta) {
    const worldW = scaledWorldWidth(meta, 8);
    const worldD = scaledWorldDepth(meta, 8);
    const cs = worldCellSize(meta);
    let cols = Math.max(6, Math.ceil(worldW) + PAD * 2);
    let rows = Math.max(6, Math.ceil(worldD) + PAD * 2);
    const walkable = new Set();
    // The boss sanctum wing (js/dev-random-ruin-sanctum.js) lives east of the
    // V50 layout in the same grid, reached through the ruin's Great Door.
    const sanctum = requestedRuinType==='hachutu' ? window.DevHachutuRuin?.reserve?.(cols,rows) : window.DevRandomRuinSanctum?.reserve?.(cols, rows) || null;
    if (sanctum) { cols = sanctum.cols; rows = sanctum.rows; for (const key of sanctum.tiles) walkable.add(key); }
    for (const [c0, r0] of (meta.floorCells || [])) {
      const x0 = PAD + Number(c0) * cs, x1 = PAD + (Number(c0) + 1) * cs - 1e-6;
      const z0 = PAD + Number(r0) * cs, z1 = PAD + (Number(r0) + 1) * cs - 1e-6;
      for (let c = Math.floor(x0); c <= Math.floor(x1); c++)
        for (let r = Math.floor(z0); r <= Math.floor(z1); r++)
          if (c >= 0 && r >= 0 && c < cols && r < rows) walkable.add(`${c},${r}`);
    }
    const floor = [...walkable].map(key => key.split(',').map(Number));
    const grid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => makeTile(walkable.has(`${c},${r}`))));
    return { cols, rows, floor, grid, walkable };
  }

  function entranceLocalPoint(meta) {
    const e = meta.entrance;
    if (!e) return { x: 0, z: 0, side: 'south' };
    const cs = worldCellSize(meta);
    const ox = -scaledWorldWidth(meta) / 2;
    const oz = -scaledWorldDepth(meta) / 2;
    if (e.axis === 'x') return { x: Number(e.boundary) * cs + ox, z: Number(e.center) * cs + oz, side: e.side };
    return { x: Number(e.center) * cs + ox, z: Number(e.boundary) * cs + oz, side: e.side };
  }
  function spawnInsideEntrance(meta) {
    const p = entranceLocalPoint(meta);
    const inward = { north:[0,1], south:[0,-1], west:[1,0], east:[-1,0] }[p.side] || [0,1];
    const inset = Math.max(0.7, worldCellSize(meta) * 1.5);
    return { x: PAD + scaledWorldWidth(meta) / 2 + p.x + inward[0] * inset,
      z: PAD + scaledWorldDepth(meta) / 2 + p.z + inward[1] * inset };
  }

  function boxFor(object) {
    if (!object) return null;
    object.updateWorldMatrix?.(true, true); object.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(object);
    return box.isEmpty() ? null : box;
  }
  function centerFor(object) { return boxFor(object)?.getCenter(new THREE.Vector3()) || new THREE.Vector3(); }
  function boundsFor(object) {
    const b = boxFor(object); return b ? { minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z } : {minX:0,maxX:0,minZ:0,maxZ:0};
  }
  function registerSurface(id, object, priority = 5) {
    DS.registerSurface({ id, scope:SCOPE, bounds:() => boundsFor(object), topY:() => boxFor(object)?.max.y ?? 0,
      enabled:() => object.visible !== false&&!object.userData?.rootGrowthSurfaceSuppressed, priority });
  }
  // A moving dais deck without whatever V50 grounded on it (the goal
  // pedestal/coffin and its brazier): measuring the whole subtree put the
  // walkable top at the pedestal's height, so a lowered dais could not be
  // stepped onto.
  const deckBox = new THREE.Box3(), deckPart = new THREE.Box3();
  function deckBoxFor(platform) {
    platform.updateWorldMatrix(true, true);
    deckBox.makeEmpty();
    const visit = node => {
      if (node !== platform && node.userData?.groundedToMovingPlatform) return;
      if (node.isMesh && node.geometry) {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        deckPart.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
        deckBox.union(deckPart);
      }
      for (const child of node.children || []) visit(child);
    };
    visit(platform);
    return deckBox.isEmpty() ? boxFor(platform) : deckBox;
  }
  function registerDaisSurface(id, platform, priority) {
    DS.registerSurface({ id, scope:SCOPE, bounds:() => { const b = deckBoxFor(platform); return b ? { minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z } : {minX:0,maxX:0,minZ:0,maxZ:0}; },
      topY:() => deckBoxFor(platform)?.max.y ?? 0, enabled:() => platform.visible !== false&&!platform.userData?.rootGrowthSurfaceSuppressed, priority });
  }
  // Real floor height per V50 cell (basins, plateaus). Grid tiles stay flat
  // (camera/presentation assume that), so this is published separately for
  // projectile ground hits through AreaFootprintBlockers.surfaceYAt.
  const floorHeights = new Map();
  let floorCellSize = 1;
  function registerFloor(meta) {
    floorHeights.clear();
    floorCellSize = worldCellSize(meta);
    let floorMesh = null;
    ruin.localeRoot.traverse(o => { if (!floorMesh && o.userData?.wallBuilderRecipe === 'wallrecipe2.json') floorMesh = o; });
    const levels = floorMesh?.userData?.plateauModel?.levelByCell || {};
    const step = Number(floorMesh?.userData?.plateauModel?.stepHeight ?? meta.plateauModel?.stepHeight ?? 0.42);
    const cs = worldCellSize(meta);
    const originX = PAD, originZ = PAD;
    const floorKeys = new Set((meta.floorCells || []).map(([c,r]) => `${c},${r}`));
    for (const [c0,r0] of (meta.floorCells || [])) {
      const c=Number(c0), r=Number(r0), key=`${c},${r}`;
      const topY=(Number(meta.floorSurfaceY)||0) + Number(levels[key]||0)*step;
      DS.registerSurface({ id:`devruin-floor-${key}`, scope:SCOPE,
        bounds:{minX:originX+c*cs,maxX:originX+(c+1)*cs,minZ:originZ+r*cs,maxZ:originZ+(r+1)*cs},
        topY, priority:1 });
      floorHeights.set(key, topY);
    }
    for (let c=0;c<(Number(meta.gridCols)||0);c++) for (let r=0;r<(Number(meta.gridRows)||0);r++) {
      if (floorKeys.has(`${c},${r}`)) continue;
      DS.registerPit({ id:`devruin-void-${c},${r}`, scope:SCOPE,
        bounds:{minX:originX+c*cs,maxX:originX+(c+1)*cs,minZ:originZ+r*cs,maxZ:originZ+(r+1)*cs} });
    }
  }

  function discoverRuntimeObjects() {
    ruin.mechanisms = new Map(); ruin.controls = []; ruin.activators = []; ruin.pushBlocks = []; ruin.transitDoors = []; ruin.transitDoorStates = [];
    const walls = []; // V50 wall meshes become boundary tiles instead of broad object AABBs.
    ruin.localeRoot.traverse(object => {
      const d = object.userData || {}, motion = d.previewMotion?.type;
      if (d.mechanismId && ['bridge','bridgeSequence','stoneDoor','movingDais','collapsingStairs'].includes(motion))
        ruin.mechanisms.set(d.mechanismId,{id:d.mechanismId,root:object,type:motion,progress:0,target:0,externalTarget:null}); // externalTarget is reserved for modular composers that must visibly drive an existing V50 mechanism regardless of its original puzzle signal.
      if (d.linkedMechanismId && d.activatorType) {
        ruin.activators.push(object);
        if (d.squarePillarHousing || d.hiddenActivatorMount === 'pillarNiche') {
          object.userData.blockerPurpose = object.userData.blockerPurpose || 'puzzle_target_pillar'; // A projectile target carved into a pillar does not make the pillar intangible.
        }
        if (d.activatorType === 'stackedObelisk' || d.activatorType === 'linkedCubePillars') {
          object.userData.interactive3D = true; // Tower activators are ordinary nearby world interactions, not click-only editor props.
          object.userData.devRuinInteractionType = d.activatorType; // Used by prompt diagnostics / semantic owner resolution.
          object.userData.blockerPurpose = 'puzzle_tower_' + d.activatorType; // Makes their authoritative occupancy source visible in Pixel Probe.
        }
      }
      if (d.pushable && (motion === 'pushPuzzleBlock' || motion === 'elevatorPushBlock')) ruin.pushBlocks.push(object);
      if (d.transitDoor) ruin.transitDoors.push(object);
      if (d.ruinInteriorWall) walls.push(object);
    });
    for (const m of ruin.mechanisms.values()) {
      if (m.type === 'bridge' || m.type === 'bridgeSequence') registerSurface(`devruin-mech-${m.id}`,m.root,10);
      else if (m.type === 'movingDais') registerDaisSurface(`devruin-mech-${m.id}`,m.root.userData.movingDaisPlatform||m.root,12);
      else if (m.type === 'collapsingStairs') for (const tread of (m.root.userData.stairTreads||[])) registerSurface(`devruin-stair-${m.id}-${tread.id}`,tread,12);
    }

    for(const door of ruin.transitDoors){
      const panel=(door.children||[]).find(child=>child?.isMesh&&child.geometry)||door; // Hallway transit doors are authored as a fixed root plus one retracting stone panel.
      panel.geometry?.computeBoundingBox?.();
      const panelHeight=Math.max(.6,Math.abs((panel.geometry?.boundingBox?.max?.y||.95)-(panel.geometry?.boundingBox?.min?.y||-.95))*(Math.abs(Number(panel.scale?.y))||1));
      const state={
        door,panel,open:0,target:0,closedY:Number(panel.position?.y)||0,openY:(Number(panel.position?.y)||0)+panelHeight+.12,
        crossingAxis:null,openingSide:0,openedAt:0,
      }; // Runtime state makes the authored interact-to-open door authoritative for both animation and occupancy.
      door.userData.__devRuinTransitDoorState=state;
      door.userData.interactive3D=true;
      door.userData.devRuinInteractionType='transitDoor';
      const box=boxFor(panel),size=box?.getSize?.(new THREE.Vector3())||new THREE.Vector3(1,1,1),center=centerFor(door);
      state.crossingAxis=size.x<=size.z?'x':'z'; // Thin world axis is the direction a player crosses through the doorway.
      state.center={x:center.x,z:center.z}; // Exposed in mobile/browser diagnostics so closed-door collision and popup range can be verified without devtools.
      ruin.transitDoorStates.push(state);
      // No separate DynamicSurfaces blocker here: DevRandomRuinTileOccupancy reads state.open and folds this panel into the ruin's one aggregate gameplay blocker.
      ruin.controls.push({
        kind:'transitDoor',object:door,promptRoot:door,range:1.9,touchIcon:'✋',priority:24,claimAction1:true,
        label:()=>state.target>.5?'Close Hallway Door':'Open Hallway Door',
        onPress:()=>{
          const opening=state.target<=.5;
          state.target=opening?1:0;
          if(opening){
            const p={x:deps.player.x/deps.TILE,z:deps.player.y/deps.TILE},center=centerFor(door),axis=state.crossingAxis;
            state.openingSide=Math.sign((axis==='x'?p.x-center.x:p.z-center.z))||1;
            state.openedAt=performance.now();
          }
        },
      });
    }

    const linkedMechanismIds=new Set(ruin.activators.map(object=>String(object.userData?.linkedMechanismId||'')).filter(Boolean)); // Distinguishes puzzle-gated mechanisms from simplified manual doors/lifts.
    for(const m of ruin.mechanisms.values()){
      if(m.type==='stoneDoor'){
        const panel=(m.root.children||[]).find(child=>child?.isMesh&&child.geometry)||m.root; // Physical panel only; avoids blocking the whole doorway arch assembly.
        m.root.userData.__devRuinPhysicalDoorBlocker=false; // The shared tile-occupancy blocker is the single collision authority for moving stone doors; progress only changes its door source state.
      }
      const gated=linkedMechanismIds.has(String(m.id))&&!m.root.userData?.runtimePuzzleBypass;
      m.gated=gated; // Door seals: a puzzle-gated door shows locked (red) until its puzzle opens it.
      if(m.type==='movingDais'){
        const platform=m.root.userData?.movingDaisPlatform||m.root;
        // A dais wired to a puzzle (glyphs, braziers, obelisks, cubes, plates)
        // moves only through that puzzle: a direct Raise/Lower prompt let
        // players skip it. Glyph targets are visible now, so the old manual
        // fallback is kept only for daises with no puzzle at all.
        if(gated)continue;
        m.manualFallback=true;
        platform.userData.interactive3D=true;
        platform.userData.devRuinInteractionType='movingDais';
        ruin.controls.push({
          kind:'movingDais',object:platform,promptRoot:platform,range:2.1,touchIcon:'↕',priority:16,claimAction1:true,
          label:()=>{const raised=m.root.userData?.previewMotion?.startsRaised?m.progress<.5:m.progress>.5;return raised?'Lower Stone Platform':'Raise Stone Platform';}, // V50 daises that start raised run activation 1 = lowered.
          onPress:()=>{m.target=m.target>.5?0:1;},
        });
        continue;
      }
      if(gated)continue;
      if(m.type==='stoneDoor'){
        m.root.userData.interactive3D=true;
        m.root.userData.devRuinInteractionType='stoneDoor';
        ruin.controls.push({
          kind:'stoneDoor',object:m.root,promptRoot:m.root,range:1.9,touchIcon:'✋',priority:18,claimAction1:true,
          label:()=>m.lockReason?'Stone Door (Sealed)':m.target>.5?'Close Stone Door':'Open Stone Door',
          onPress:()=>{if(m.lockReason){deps.showToast?.(m.lockReason,false);return;}m.target=m.target>.5?0:1;},
        });
      }
    }

    ruin.localeRoot.traverse(object => {
      if (object.userData?.activatorType !== 'linkedCubePillars' || !object.userData?.interactive3D) return;
      const labels=object.userData.labels||['A','B','C','D'];
      for (const e of object.userData.rotatingSegments||[]) if (e?.segment) {
        e.segment.userData.interactive3D = true; // Each marked cube is its own semantic prompt anchor even though the pair shares one puzzle root.
        e.segment.userData.devRuinInteractionType = 'linkedCubeControl';
        ruin.controls.push({kind:'linkedCube',object:e.segment,promptRoot:e.segment,range:2.05,touchIcon:'↻',label:'Rotate Cube '+(labels[e.controlIndex]||e.controlIndex+1),onPress:()=>ruin.api.rotateLinkedCube(object,e.controlIndex,1)});
      }
    });
    for (const a of ruin.activators) {
      const type=a.userData.activatorType, m=ruin.mechanisms.get(a.userData.linkedMechanismId);
      if (!m || ['linkedCubePillars','pressurePlate','glyphObelisk'].includes(type)) continue; // Glyphs are solved by shooting their glowing rune markers (js/dev-random-ruin-glyph-circuits.js); a 'DEV Trigger Glyph' prompt on every glyph gave the puzzle away and cluttered the interaction list.
      const topSegment = type === 'stackedObelisk' ? (a.userData?.rotatingSegments||[]).at(-1)?.segment : null; // Places the floating prompt above the cube stack instead of at its floor-level Group origin.
      ruin.controls.push({kind:type,object:a,promptRoot:topSegment||a,range:type==='stackedObelisk'?2.05:CONTROL_RANGE,touchIcon:type==='stackedObelisk'?'↻':'✋',label:type==='stackedObelisk'?'Turn Obelisk':type==='brazier'?'DEV Ignite Brazier':type==='glyphObelisk'?'DEV Trigger Glyph':'Activate '+type,
        onPress:()=>{m.target=m.target>.5?0:1;}});
    }
    for (const block of ruin.pushBlocks) {
      if (block.userData?.previewMotion?.type !== 'pushPuzzleBlock') continue; // Elevator blocks retain their height-aware motion-runtime control.
      ruin.controls.push({kind:'pushBlock',object:block,label:'Push Stone Block',onPress:()=>pushBlock(block)});
    }
    ruin.controls.push({kind:'exit',object:null,label:'Leave Test Ruin',point:ruin.spawn,onPress:leaveRuin});
    ruin.occupancy = TileOccupancy.create({
      mapId:MAP_ID, scope:SCOPE, cols:ruin.cols, rows:ruin.rows, floorSet:ruin.floorSet,
      grid:ruin.grid, solidType:(gridDeps?.TileType||deps?.TileType||{}).ROCK??'rock', // Stamps generated blockers into the same interior grid ordinary movement/AI/knockback already query.
      walls, solidRoots:[ruin.localeRoot], mechanisms:ruin.mechanisms, transitDoors:ruin.transitDoors,
      activators:ruin.activators, pushBlocks:ruin.pushBlocks,
      getPlayerPosition:() => ({ x:deps.player.x / deps.TILE, z:deps.player.y / deps.TILE }),
    });
    // The pedestal/coffin riding a dais is excluded from the static scan
    // (its ancestors are named as dais parts), so give it its own footprint:
    // it stands on the deck and must not be walked through once up there.
    for (const m of ruin.mechanisms.values()) {
      if (m.type !== 'movingDais') continue;
      for (const child of (m.root.userData?.movingDaisPlatform || m.root).children || []) {
        if (child.userData?.groundedToMovingPlatform) ruin.occupancy.scanSolids(child, 'dais-feature');
      }
    }
  }

  function pushBlock(block) {
    const p=centerFor(block), px=deps.player.x/deps.TILE, pz=deps.player.y/deps.TILE;
    const route=Array.isArray(block.userData?.pushPath)?block.userData.pushPath:[]; // Authored V50 route defines the intended per-push spacing for pressure puzzles.
    let authoredStep=0;
    for(let i=1;i<route.length&&!authoredStep;i++){const dx=Number(route[i]?.x)-Number(route[i-1]?.x),dz=Number(route[i]?.z)-Number(route[i-1]?.z),distance=Math.hypot(dx,dz);if(distance>.05)authoredStep=distance;}
    const localStep=authoredStep||localCellSize(ruin.meta), worldStep=localStep*RUIN_TILE_SCALE; // Keep runtime pushes on the same lattice the generator validated.
    const dx=p.x-px,dz=p.z-pz; let sx=0,sz=0;
    if (Math.abs(dx)>=Math.abs(dz)) sx=Math.sign(dx)||1; else sz=Math.sign(dz)||1;
    const nx=p.x+sx*worldStep,nz=p.z+sz*worldStep;
    if (!DS.sampleSupport(nx,nz,{minY:-4,maxY:5,pad:.02})) return deps.showToast?.('The block cannot be pushed there.',false);
    const hit=DS.blockerAt(nx,nz,{radius:.06,actorHeight:1,ignoreRuinSource:block.userData.__devRuinOccupancySource});
    if (hit) return deps.showToast?.('Something blocks the stone block.',false);
    // The locale root carries the 2x horizontal scale, so child transforms remain in V50's original local units.
    block.position.x+=sx*localStep; block.position.z+=sz*localStep; block.updateMatrixWorld?.(true); ruin.api.syncPressurePlates(ruin.localeRoot); ruin.occupancy?.refresh(); updateBadge();
  }

  function isLitMaterial(material) {
    return !!material && (material.lights === true || material.isMeshLambertMaterial || material.isMeshPhongMaterial || material.isMeshToonMaterial || material.isMeshStandardMaterial || material.isMeshPhysicalMaterial); // Covers every ordinary Three light-reactive material V50 can hand back.
  }

  function materialTextureIdentity(material) {
    const map=material?.map;
    return [
      map?.name,
      map?.image?.currentSrc,
      map?.image?.src,
      map?.source?.data?.currentSrc,
      map?.source?.data?.src,
    ].filter(Boolean).join(' ').toLowerCase(); // Identifies V50's pre-tinted carved_smooth stone even after its texture was cloned/processed.
  }

  function isLegacyV50StoneMaterial(material, sharedStoneMaterial) {
    if(!material)return false;
    if(material===sharedStoneMaterial)return true;
    if(materialTextureIdentity(material).includes('fill_b08d57'))return false;
    if(materialTextureIdentity(material).includes('carved_smooth'))return true;
    return material.color?.isColor && material.color.getHex?.()===0x545039; // V50's authored RUIN_STONE_FILL fallback when the texture identity is unavailable.
  }

  function makeUnlitMaterial(source, label) {
    if(!source||!isLitMaterial(source))return source;
    const spritePngSurface=window.HobunjiSpritePngSurface||window.HobunjiPngPlaneUnlit; // Same canonical unlit PNG factory NaturalSurfaceMaterials/cliffs use.
    const overrides={
      color:source.color?.isColor?new THREE.Color(source.color.getHex()):new THREE.Color(0xffffff),
      side:source.side??THREE.FrontSide,
      transparent:source.transparent===true,
      opacity:Number.isFinite(Number(source.opacity))?Number(source.opacity):1,
      alphaTest:Number.isFinite(Number(source.alphaTest))?Number(source.alphaTest):0,
      depthTest:source.depthTest!==false,
      depthWrite:source.depthWrite!==false,
      vertexColors:source.vertexColors===true,
      alphaMap:source.alphaMap||null,
      polygonOffset:!!source.polygonOffset,
      polygonOffsetFactor:Number(source.polygonOffsetFactor)||0,
      polygonOffsetUnits:Number(source.polygonOffsetUnits)||0,
    };
    const material=typeof spritePngSurface?.makeMaterial==='function'
      ? spritePngSurface.makeMaterial(THREE,source.map||null,label,overrides)
      : new THREE.MeshBasicMaterial({map:source.map||null,...overrides});
    material.name=label;
    material.userData=Object.assign({},source.userData,material.userData,{devRandomRuinUnlitMaterial:true,naturalSurfaceLightModel:'character-png-unlit'});
    return material;
  }

  function applyUnlitRuinMaterials(root) {
    const natural=window.NaturalSurfaceMaterials; // Stone uses the exact unfilled authored brazier/door PNG through the shared furniture material factory.
    if(!root?.traverse)return {stoneMeshes:0,convertedMaterials:0,remainingLitMaterials:0,legacyStoneMaterials:0,totalMeshes:0};
    let sourceStoneMaterial=null;
    root.traverse(object=>{if(sourceStoneMaterial||!object?.isMesh||!object.userData?.ruinInteriorWall)return;sourceStoneMaterial=Array.isArray(object.material)?object.material[0]:object.material;});

    let stoneMeshes=0,convertedMaterials=0,totalMeshes=0;
    if(typeof natural?.naturalizeMesh==='function'){
      root.traverse(object=>{
        if(!object?.isMesh)return;
        const materials=Array.isArray(object.material)?object.material:[object.material];
        if(!materials.length||!materials.every(material=>isLegacyV50StoneMaterial(material,sourceStoneMaterial)))return;
        object.material=window.ProceduralFurniture.makePartMaterial({materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#7a746b'});
        window.HobunjiSurfaceStretchUV?.mapMesh?.(object,{label:'ruin-stone',maxPatchWorldSize:6});
        object.userData=Object.assign({},object.userData,{devRandomRuinDenMaterial:true,devRandomRuinStoneMaterial:true,devRandomRuinUnlitMaterial:true});
        stoneMeshes++;
      });
    }

    const replaced=new Map(); // Original V50 material -> its unlit replacement, so userData.decalMaterials keeps pointing at what actually renders.
    root.traverse(object=>{
      if(!object?.isMesh)return;
      totalMeshes++;
      const list=Array.isArray(object.material)?object.material:[object.material];
      const next=list.map((material,index)=>{
        if(isLegacyV50StoneMaterial(material,sourceStoneMaterial) && typeof natural?.naturalizeMesh==='function') {
          object.userData.devRandomRuinStoneMaterial=true;
          return window.ProceduralFurniture.makePartMaterial({materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#7a746b'});
        }
        if(!isLitMaterial(material))return material;
        convertedMaterials++;
        if(replaced.has(material))return replaced.get(material);
        const unlit=makeUnlitMaterial(material,`dev_random_ruin_unlit_${object.name||'mesh'}_${index}`);
        replaced.set(material,unlit);
        return unlit;
      });
      if(Array.isArray(object.material))object.material=next;
      else if(next[0])object.material=next[0];
      if(next.some(material=>material?.userData?.devRandomRuinUnlitMaterial||material?.userData?.naturalSurfaceUnlit))object.userData=Object.assign({},object.userData,{devRandomRuinUnlitMaterial:true});
      object.castShadow=false; object.receiveShadow=false; // There are deliberately no real light/shadow semantics in this test scene.
    });

    root.traverse(object=>{ // V50's prepareRuntimeWallPlanes makes walls double-sided so both faces render; the stone/unlit swap above must not undo that.
      if(!object?.isMesh||!object.userData?.ruinInteriorWall)return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(material&&material.side!==THREE.DoubleSide){material.side=THREE.DoubleSide;material.needsUpdate=true;}
      }
    });

    root.traverse(node=>{ // V50 glyph/obelisk decal lists referenced the pre-conversion materials, so recolouring them changed nothing visible (decals rendered black).
      const list=node.userData?.decalMaterials;
      if(Array.isArray(list))node.userData.decalMaterials=list.map(material=>replaced.get(material)||material);
    });

    let remainingLitMaterials=0,legacyStoneMaterials=0;
    root.traverse(object=>{
      if(!object?.isMesh)return;
      for(const material of (Array.isArray(object.material)?object.material:[object.material])){
        if(isLitMaterial(material))remainingLitMaterials++;
        if(isLegacyV50StoneMaterial(material,sourceStoneMaterial) && !object.userData?.devRandomRuinStoneMaterial)legacyStoneMaterials++;
      }
    });
    return {stoneMeshes,convertedMaterials,remainingLitMaterials,legacyStoneMaterials,totalMeshes};
  }

  function buildTexturedCeiling(meta) {
    const walkableCells=Array.isArray(meta?.floorCells)?meta.floorCells:[]; // Hallways and ordinary traversable surfaces.
    const ceilingCells=new Map(); // Includes the full room footprint, even above sunken elevator/basin openings without walkable floor cells.
    for(const pair of walkableCells)if(Array.isArray(pair)&&pair.length>=2&&Number.isFinite(Number(pair[0]))&&Number.isFinite(Number(pair[1])))ceilingCells.set(Number(pair[0])+','+Number(pair[1]),[Number(pair[0]),Number(pair[1])]);
    for(const room of meta?.rooms||[]) {
      const col=Number(room.col),row=Number(room.row),w=Math.floor(Number(room.w)),h=Math.floor(Number(room.h));
      if(![col,row,w,h].every(Number.isFinite)||w<1||h<1||w>128||h>128)continue;
      for(let dx=0;dx<w;dx++)for(let dz=0;dz<h;dz++)ceilingCells.set((col+dx)+','+(row+dz),[col+dx,row+dz]);
    }
    const cells=ceilingCells.values(); // A single ceiling mesh, not separate floating patches above each target.
    if(!ceilingCells.size)return null;
    const cs=worldCellSize(meta); // Converts V50's half-cell layout into the same 2x game-world scale used by the floor and walls.
    const ceilingY=(Number(meta.floorSurfaceY)||0)+(Number(meta.wallHeight)||3); // Shared wall-top datum; sunken rooms keep the same structural ceiling height and longer support pillars.
    const positions=[]; // Downward-wound cell quads make the ceiling visible from inside but invisible from the overhead camera.
    const indices=[];
    for(const [c0,r0] of cells){
      const col=Number(c0),row=Number(r0),base=positions.length/3;
      const minX=PAD+col*cs,maxX=minX+cs,minZ=PAD+row*cs,maxZ=minZ+cs;
      positions.push(minX,ceilingY,minZ, maxX,ceilingY,minZ, maxX,ceilingY,maxZ, minX,ceilingY,maxZ);
      indices.push(base,base+1,base+2, base,base+2,base+3);
    }
    const geometry=new THREE.BufferGeometry(); // One mesh keeps hundreds of ceiling cells inexpensive while NaturalSurfaceMaterials supplies the connected stone UV treatment.
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const fallback=new THREE.MeshBasicMaterial({color:0x808080,side:THREE.FrontSide}); // Remains unlit even if the optional natural-surface stack is unavailable.
    const mesh=new THREE.Mesh(geometry,fallback);
    mesh.name='dev_random_ruin_textured_ceiling';
    mesh.userData.devRandomRuinCeiling=true;
    mesh.userData.devRandomRuinCeilingCells=ceilingCells.size;
    mesh.userData.devRandomRuinCeilingY=ceilingY;
    mesh.material=window.ProceduralFurniture.makePartMaterial({materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#7a746b'});
    window.HobunjiSurfaceStretchUV?.mapMesh?.(mesh,{label:'ruin-ceiling',maxPatchWorldSize:6});
    if(Array.isArray(mesh.material))mesh.material=mesh.material.map(material=>material?.clone?.()||material);
    else if(mesh.material?.clone)mesh.material=mesh.material.clone(); // NaturalSurfaceMaterials caches cliff materials; isolate this ceiling before changing culling so ordinary cliffs stay untouched.
    for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material])){
      if(!material)continue;
      material.side=THREE.FrontSide; // The geometry normals face downward, so the roof does not occlude the third-person camera when viewed from above.
      material.needsUpdate=true;
    }
    mesh.castShadow=false;
    mesh.receiveShadow=false;
    return mesh;
  }

  function makeMapRecord(seed, generated, roots, meta) {
    const projected=floorProjection(meta), scene=new THREE.Scene();
    // Like cliffs and other authored PNG surfaces, Random Test Ruin geometry is
    // intentionally unlit. Darkness is exclusively the shared 2D overlay below,
    // so removing that overlay really does reveal the untouched material art.
    scene.name=MAP_ID; scene.background=new THREE.Color(0x2a1a0a);
    // Scale only the horizontal plane: V50's half-unit cell becomes one full game-world unit while floor/elevation heights stay authored.
    roots.localeRoot.scale.x*=RUIN_TILE_SCALE; roots.localeRoot.scale.z*=RUIN_TILE_SCALE;
    roots.localeRoot.position.set(PAD+scaledWorldWidth(meta)/2,0,PAD+scaledWorldDepth(meta)/2);
    const materialStats=applyUnlitRuinMaterials(roots.localeRoot); // Stone uses the authored furniture PNG; remaining V50 lit materials use the canonical unlit factory.
    roots.localeRoot.name=`dev_v50_ruin_${seed}`; scene.add(roots.localeRoot);
    const ceilingMesh=buildTexturedCeiling(meta); // Gives the rope mounts and support pillars a real visible stone ceiling at the exact wall-top datum they already target.
    if(ceilingMesh)scene.add(ceilingMesh);
    roots.particleRoot.position.set(0,0,0); scene.add(roots.particleRoot);

    const spawn=spawnInsideEntrance(meta);
    const exitTile=[clamp(Math.floor(spawn.x),0,projected.cols-1),clamp(Math.floor(spawn.z),0,projected.rows-1)];
    const mapData={schema:'hobunji_building_interior.v1',id:MAP_ID,name:generationLabel||`Random Test Ruin #${seed}`,cols:projected.cols,rows:projected.rows,
      floor:projected.floor,colliders:[],furniture:[],vendorZones:[],exits:[{id:'exit_dev_random_ruin',label:generationLabel?'Leave the Ruin':'Leave Test Ruin',tiles:[exitTile],targetMap:'',spawnCol:0,spawnRow:0}],
      wallStyle:'cavern', // Opts the session ruin into the game's existing combat-interior path so mobile receives Fire/Ammo/Potions and combat/reticle updates exactly like a den.
      devSessionOnly:true,devSeed:seed,devRuinTileScale:RUIN_TILE_SCALE,sourceGenerator:'HobunjiDebrisifierV50'};
    const occlusionMeshes=[]; // Normal map_i_* camera boom reads this array from _buildingScenes; generated walls must participate exactly like authored den/shop walls.
    roots.localeRoot.traverse(mesh=>{
      if(!mesh?.isMesh)return;
      let structural=false;
      for(let node=mesh;node;node=node.parent){
        const d=node.userData||{},role=String(d.interiorRuinRole||'');
        if(d.ruinInteriorWall||d.archFootprint||d.transitDoor||d.squarePillarHousing||/ceiling support pillar|doorway flank pillar/i.test(role)){structural=true;break;}
        if(node===roots.localeRoot)break;
      }
      if(structural)occlusionMeshes.push(mesh);
    });
    return {scene,grid:projected.grid,cols:projected.cols,rows:projected.rows,mapData,wallStyle:'cavern',floorSet:projected.walkable,exits:mapData.exits,spawn,localeRoot:roots.localeRoot,particleRoot:roots.particleRoot,ceilingMesh,occlusionMeshes,ceilingCellCount:Number(ceilingMesh?.userData?.devRandomRuinCeilingCells)||0,ceilingY:Number(ceilingMesh?.userData?.devRandomRuinCeilingY)||null,denMaterialMeshCount:materialStats.stoneMeshes,unlitConvertedMaterialCount:materialStats.convertedMaterials,remainingLitMaterialCount:materialStats.remainingLitMaterials,legacyStoneMaterialCount:materialStats.legacyStoneMaterials,totalRuinMeshCount:materialStats.totalMeshes};
  }

  // opts.site: a wilderness ruin site (js/ruin-sites.js) is generating this
  // ruin for ordinary play, so Dev Mode is not required; opts.returnAnchor is
  // where the entrance exit puts the player back.
  let stoneAgeDependencies=null; // Single-flight lazy loader; normal Harlyao ruins never install additional stone-surface hooks.
  async function ensureStoneAgeSceneryDependencies(){
    if(window.NaturalSurfaceMaterials?.naturalizeMesh&&window.HobunjiSurfaceStretchUV?.mapMesh)return;
    if(!stoneAgeDependencies)stoneAgeDependencies=(async()=>{
      const libraries=[ // Shared preview versions; preserve ordering so the UV patch can wrap the natural material factory.
        ['config/natural-surface-materials.js?v=20261027h1fb8ced',()=>!!window.NaturalSurfaceMaterialConfig],
        ['js/natural-surface-materials.js?v=20261027h1fb8ced',()=>!!window.NaturalSurfaceMaterials?.naturalizeMesh],
        ['js/surface-stretch-uv-furniture.js?v=20261031h5856d5a',()=>!!window.HobunjiSurfaceStretchUV?.mapMesh],
      ];
      for(const [path,ready] of libraries){
        if(ready())continue;
        await new Promise((resolve,reject)=>{
          const element=document.createElement('script'); // Loaded only for this opt-in ruin, keeping default worlds free of extra surface hooks.
          const timeout=setTimeout(()=>{element.remove();reject(new Error('Timed out loading '+path));},30000);
          element.src=new URL(path,document.baseURI).href;
          element.onload=()=>{clearTimeout(timeout);ready()?resolve():reject(new Error('Stone surface module did not initialize: '+path));};
          element.onerror=()=>{clearTimeout(timeout);element.remove();reject(new Error('Stone surface module unavailable: '+path));};
          document.head.appendChild(element);
        });
      }
    })().catch(error=>{stoneAgeDependencies=null;throw error;});
    await stoneAgeDependencies;
  }

  async function prepareStoneAgeScenery(owner){
    await ensureStoneAgeSceneryDependencies(); // The real game does not normally load author-only natural stone UV tools.
    const builder=window.StoneAgeRuinScenery; // Shared with the preview: authored rock walls/pillars, quarter-scale wilderness floor, Temple cover.
    if(!builder?.buildRoom||!builder?.prepareCover)throw new Error('Stone Age ruin scenery module is unavailable.');
    owner.stoneAgeAbort=new AbortController(); // Cancels Temple downloads and long vegetation builds when a generation is replaced.
    const signal=owner.stoneAgeAbort.signal;
    const response=await fetch(new URL('config/pieces/temple.json',document.baseURI),{signal});
    if(!response.ok)throw new Error('Temple vegetation settings HTTP '+response.status);
    const temple=await response.json();
    const layers=temple.surfaceGrowth?.filter(item=>item.kind==='roots'||item.kind==='vines'); // Reuse actual Life Temple authoring rather than approximating its foliage.
    if(!layers?.some(item=>item.kind==='roots')||!layers.some(item=>item.kind==='vines'))throw new Error('Temple roots and vines are required for a Stone Age ruin.');
    if(ruin!==owner||signal.aborted)throw Object.assign(new Error('Stone Age ruin build cancelled.'),{name:'AbortError'});
    const scenery=builder.buildRoom({root:owner.localeRoot,meta:owner.meta,seed:owner.sourceSeed,roughness:.3,color:'#363733',floorHeights}); // The existing collision/support map owns every cell's elevation and missing-floor footprint.
    owner.stoneAgeScenery=scenery; // Cleanup owns all original visibility, stone buffers, cloned materials and prepared root/vine geometry.
    const button=document.getElementById('devRandomTestRuinBtn');
    const cover=await builder.prepareCover({room:scenery.room,templeRecipes:layers,rootColor:'#24211d',signal,
      onProgress:step=>{if(ruin===owner&&button)button.textContent='Growing '+step.part+' '+step.layer+'/'+step.layers+'…';}});
    scenery.cover=cover;
    if(ruin!==owner||signal.aborted)throw Object.assign(new Error('Stone Age ruin build cancelled.'),{name:'AbortError'});
    cover.attach();scenery.activate();
    // The native geometry remains authoritative for navigation and puzzle collision, but only the visible roughened walls occlude the camera.
    const occlusion=owner.occlusionMeshes; // This is the same mutable array referenced by the registered building scene.
    const replaced=new Set(scenery.nativeMeshes.map(item=>item.mesh)); // Remove visually suppressed V50 walls, but keep protected native puzzle objects.
    for(let i=occlusion.length-1;i>=0;i--)if(replaced.has(occlusion[i]))occlusion.splice(i,1);
    scenery.room.model.traverse(mesh=>{if(mesh.isMesh&&mesh.userData?.ruinPreviewRole==='wall')occlusion.push(mesh);});
    owner.stoneAge=true;
    owner.stoneAgeStats={pieceSet:'stoneAge',rooms:owner.meta?.rooms?.length||0,walls:scenery.room.walls,pillars:scenery.room.pillars,
      floorStones:scenery.room.floorStones,floorTileScale:scenery.room.floorLayout?.scale||scenery.room.floorStats?.featureScale||.25,
      floorTileCopies:scenery.room.floorLayout?.offsets.length||1,maskedFloorCells:scenery.room.floorStats?.floorCells||0,
      floorLevels:scenery.room.floorStats?.levelCount||1,floorVoids:scenery.room.floorStats?.voidCells||0,
      floorBuildMs:scenery.room.floorBuildMs, // On-device measurement of the optimized geometry and texture build.
      cover:cover.stats}; // On-device debug badge exposes actual geometry and decorative cover counts.
  }

  async function prepareRootMechanisms(owner,options={}){
    if(!window.LiveRootMechanisms||!owner.api.captureRootMechanismKeyframes)throw new Error('Root mechanism runtime is unavailable.');
    owner.rootGrowthAbort=new AbortController();owner.rootGrowthBindings=[];
    const entries=[...owner.mechanisms.values()].map(mechanism=>({id:mechanism.id,type:mechanism.type,source:mechanism.root}));
    for(const state of owner.transitDoorStates)entries.push({id:'transit-'+state.door.id,type:'transitDoor',source:state.door,applyPose:progress=>{const eased=progress*progress*(3-2*progress);state.panel.position.y=state.closedY+(state.openY-state.closedY)*eased;}});
    for(const entry of entries){
      if(ruin!==owner)throw Object.assign(new Error('Rooted ruin build cancelled.'),{name:'AbortError'});
      const specification=owner.api.captureRootMechanismKeyframes(entry.source,{applyPose:entry.applyPose}),anchor=specification.anchor;
      const closedBounds=new THREE.Box3().setFromObject(entry.source),cellKey=Math.floor((anchor.x-PAD)/floorCellSize)+','+Math.floor((anchor.z-PAD)/floorCellSize);
      let groundY=floorHeights.get(cellKey);
      if(!Number.isFinite(groundY)){let nearest=Infinity;groundY=Number(owner.meta?.floorSurfaceY)||0;for(const [key,height] of floorHeights){const [col,row]=key.split(',').map(Number),distance=(PAD+(col+.5)*floorCellSize-anchor.x)**2+(PAD+(row+.5)*floorCellSize-anchor.z)**2;if(distance<nearest){nearest=distance;groundY=height;}}} // Source vegetation belongs to real terrain, never the moving deck or bridge being replaced.
      const isDoor=entry.type==='stoneDoor'||entry.type==='transitDoor';
      const binding=await window.LiveRootMechanisms.bindRuntimeAsync({THREE,foliage:window.FoliageGenerator,specification,source:entry.source,scene:owner.scene,surfaces:DS,scope:SCOPE,id:'devruin-'+entry.id,type:entry.type,
        isOccupied:isDoor?()=>{const x=deps.player.x/deps.TILE,z=deps.player.y/deps.TILE;return x+PLAYER_RADIUS>closedBounds.min.x&&x-PLAYER_RADIUS<closedBounds.max.x&&z+PLAYER_RADIUS>closedBounds.min.z&&z-PLAYER_RADIUS<closedBounds.max.z;}:null,
        signal:owner.rootGrowthAbort.signal,recipe:{...options,seed:owner.sourceSeed+':'+entry.id,floorY:groundY-anchor.y,floorWidth:6,floorDepth:6,showGuide:false},rootFinish:{color:'#24211d',texture:'assets/textures/wibbly_surface.png'}});
      if(ruin!==owner){binding.dispose();throw Object.assign(new Error('Rooted ruin build cancelled.'),{name:'AbortError'});}owner.rootGrowthBindings.push(binding);
    }
    const occlusion=owner.occlusionMeshes; // Keep the same array referenced by the building map record.
    for(let index=occlusion.length-1;index>=0;index--)if(occlusion[index].userData?.rootGrowthSurfaceSuppressed)occlusion.splice(index,1);
    for(const binding of owner.rootGrowthBindings){const controller=binding.controller,guides=new Set();for(const state of [...(controller.commonState?[controller.commonState]:[]),...controller.states])for(const part of state.partPlan)guides.add(part.mesh);controller.group.traverse(mesh=>{if(mesh.isMesh&&!guides.has(mesh))occlusion.push(mesh);});}
    owner.rootedMechanisms=true;owner.occupancy?.refresh();
  }

  async function generate(seed=randomSeed(),opts={}) {
    if ((!devModeEnabled()&&!opts.site) || !deps || !buildingScenes) return false;
    const specialDef = opts.specialBoss === true ? window.SpecialHarlyaoLiches?.defFor?.(opts.theme) : null; // Named guardian is explicit per wilderness site.
    if(opts.hachutu===true && (opts.site===true || !devModeEnabled()))return false; // Never let a wilderness entry select the experimental temple.
    requestedRuinType=opts.hachutu===true?'hachutu':null;
    generationLabel = requestedRuinType==='hachutu' ? 'Hachutu Root Temple (Dev)' : specialDef?.tomb || opts.label || null; // Reuses one title for generated map and location arrival.
    const requestedSeed=Number(seed)>>>0; // Seed the user/test requested before solvability-driven retries derive alternates.
    const button=document.getElementById('devRandomTestRuinBtn'); if(button){button.disabled=true;button.textContent='Generating…';}
    try {
      if (deps.getCurrentArea?.() !== MAP_ID) returnAnchor=opts.returnAnchor||{area:deps.getCurrentArea?.(),x:deps.player.x,y:deps.player.y};
      clearRuntime(false);
      const puzzleOptions=readPuzzleGenerationOptions(); // Capture the user's simple-mode selection before booting the same-origin hidden tool; generation must not be able to fall back to defaults during iframe startup.
      await window.DevRandomRuinConfig?.reload?.(); // docs/config/random-ruin/ruin-config.json; edits apply to the next ruin.
      const cfg=(path,fallback)=>window.DevRandomRuinConfig?.get?.(path,fallback)??fallback;
      const themeTypes = cfg('sanctum.boss.types', ['tothal', 'hronal', 'kanthic']).filter(type => ['tothal', 'hronal', 'kanthic'].includes(type)); // One seeded tradition owns this ruin's lich, loot and future themed features.
      const theme = ['tothal', 'hronal', 'kanthic'].includes(opts.theme) ? opts.theme : (themeTypes.length ? themeTypes : ['tothal', 'hronal', 'kanthic'])[requestedSeed % (themeTypes.length || 3)]; // Requested site seed keeps the theme stable across solvability retries.
      puzzleOptions.lavaBasin = theme === 'hronal' && puzzleOptions.lavaBasin; // Only Hronal sites contain lava, including rope-basin set pieces.
      const rootMechanismsRequested=requestedRuinType==='hachutu'||(typeof opts.rootMechanisms==='boolean'?opts.rootMechanisms:cfg('generation.rootMechanisms',false)===true); // Frozen for rerolls and this specific generation.
      const stoneAgeRequested=requestedRuinType==='hachutu'||opts.stoneAge===true||(opts.stoneAge!==false&&!opts.site&&rootMechanismsRequested); // The Dev checkbox builds a whole Stone Age ruin; external legacy site generation is unchanged.
       const maxAttempts=Math.max(1,Math.round(cfg('generation.maxSolvabilityAttempts',MAX_SOLVABILITY_ATTEMPTS)));
      const api=await ensureGeneratorFrame();
      lastGenerationAudit={requestedSeed,acceptedSeed:null,attempts:[]};

      for(let attempt=0;attempt<maxAttempts;attempt++){
        if(attempt>0) clearRuntime(false);
        const candidateSeed=generationCandidateSeed(requestedSeed,attempt); // Deterministic retry seed so rejected layouts can be reproduced from diagnostics.
        if(button) button.textContent=attempt?'Retrying '+(attempt+1)+'/'+maxAttempts+'…':'Generating…';
        const generated=await api.generateInteriorLocale({seed:'dev-'+candidateSeed.toString(36),
          size:cfg('generation.size','medium'),density:cfg('generation.density',62),
          roomMin:cfg('generation.roomMin',3),roomMax:cfg('generation.roomMax',6),puzzles:requestedRuinType==='hachutu'?{...puzzleOptions,pressurePlate:false,brazier:false,glyphObelisk:false,stackedObelisk:false,linkedCubePillars:false,nestedRoom:false}:puzzleOptions,
          ...(stoneAgeRequested?{pieceSet:'stoneAge',floorProps:'pillarsOnly'}:{})}); // V50 retains the configured multi-room/hallway topology; the quarter-scale stone skin uses its exact walkable/elevation cells.
        const meta=generated.locale?.meta?.interiorShell; if(!meta) throw new Error('V50 generated no interiorShell metadata.');
        api.snapMechanismState(0); api.pausePreviewLoop(); const roots=api.takePreviewRoots();
        const rec=makeMapRecord(candidateSeed,generated,roots,meta); buildingScenes.set(MAP_ID,rec);
        ruin={seed:candidateSeed,hachutu:requestedRuinType==='hachutu',theme,specialBoss:!!specialDef,ruinName:generationLabel,requestedSeed,sourceSeed:generated.seed,api,locale:generated.locale,meta,puzzleOptions:{...puzzleOptions},puzzleGeneration:generated.puzzleGeneration,...rec,mechanisms:new Map(),controls:[],activators:[],pushBlocks:[],supportId:null,supportY:0,falling:null,generationAttempt:attempt+1,stoneAgeRequested,stoneAge:false}; // Keep parent-runtime safe-path/rope/trap flags that the V50 API correctly ignores.
        registerFloor(meta); discoverRuntimeObjects();

        const solvability=Solvability.audit(ruin,{scope:SCOPE,pad:PAD,tileScale:RUIN_TILE_SCALE,controlRange:CONTROL_RANGE,playerRadius:PLAYER_RADIUS,maxStepHeight:MAX_STEP_HEIGHT}); // Runs before entry against the same collision/support runtime the player will use.
        ruin.solvability=solvability;
        lastGenerationAudit.attempts.push({seed:candidateSeed,ok:!!solvability.ok,failures:(solvability.failures||[]).slice(),rooms:solvability.rooms||[],unsolvedMechanisms:solvability.unsolvedMechanisms||[]});
        if(!solvability.ok){
          console.warn('[Random Test Ruin solvability] rejected candidate',candidateSeed,solvability);
          continue;
        }

        await window.RepoPatternLibrary?.load?.(); // Author-exported collectible definitions must be ready before deterministic ruin selection.
        await window.RuinPatternSurfaceRules?.ready; await window.RuinPatternSurfaceRules?.preloadPieces?.(ruin.localeRoot); // Per-piece enable/scale rules (Dev Companion + Furniture Author patternScale).
        const bossBodyColor3 = specialDef ? window.SpecialHarlyaoLiches?.specialRoster?.(theme)?.appearance?.bodyColors?.C?.hex : null; // Read the named lich's actual Body Color 3, never an independent wall-ink constant.
        ruin.specialBodyColor3 = bossBodyColor3; // Mobile dungeon diagnostics can compare wall glow against the eventual guardian portrait.
        if(!ruin.hachutu)window.FurniturePatternSurfaces?.decorateRuin?.(ruin.localeRoot, candidateSeed, specialDef ? { specialBoss:true, patternId:specialDef.glyph, ink:bossBodyColor3 } : undefined); // No Harlyao wall glyphs inside the Hachutu temple. // The same C hex colors both emissive wall motifs and the boss's dyed eyes.
        if(stoneAgeRequested)await prepareStoneAgeScenery(ruin);
        if(rootMechanismsRequested)await prepareRootMechanisms(ruin,opts.rootRecipe||{});
        lastGenerationAudit.acceptedSeed=candidateSeed;
        await enterRuin(); updateBadge();
        const retryCount=attempt;
        if(opts.site) deps.showToast?.('You enter the '+(opts.label||'ruin').toLowerCase()+'.',true);
        else deps.showToast?.(retryCount?('Rejected '+retryCount+' unsolvable ruin'+(retryCount===1?'':'s')+'; entered #'+candidateSeed+'.'):('Entered Random Test Ruin #'+candidateSeed+' as '+MAP_ID+'.'),true);
        return true;
      }

      const last=lastGenerationAudit.attempts[lastGenerationAudit.attempts.length-1];
      throw new Error('No solvable ruin found in '+maxAttempts+' attempts'+(last?.failures?.length?': '+last.failures[0]:'')+'.');
    } catch(error) { console.error('[Random Test Ruin interior]',error); deps.showToast?.('Random Test Ruin failed: '+error.message,false); clearRuntime(true); return false; }
    finally { if(button){button.disabled=false;button.textContent='Generate';} }
  }

  // Fixed story ruin: intentionally bypass V50 generation and all puzzle/boss composers.
  // It still uses this module's normal _buildingScenes, scene transition, floor support,
  // player-mesh ownership and exit lifecycle, so it is a real playable interior.
  async function generateStoryVault(options = {}) {
    if (!deps || !buildingScenes || !window.DelversGuild?.hasTalisman?.()) return false;
    if (!['search','report'].includes(window.DelversGuild?.vaultPhase?.())) return false;
    try {
      if (deps.getCurrentArea?.() !== MAP_ID) returnAnchor = options.returnAnchor || {
        area:deps.getCurrentArea?.(), x:deps.player.x, y:deps.player.y,
      };
      clearRuntime(false);
      generationLabel = 'Forgotten Harlyao Vault';
      const cols = 13, rows = 30; // Fixed hall-to-chamber geometry, used by grid, collision, camera, and authored footprint paths.
      const walkable = new Set(); // Exactly the hallway and one end chamber; no side rooms, puzzles, or randomness.
      for (let z = 13; z <= 27; z++) for (let x = 5; x <= 7; x++) walkable.add(x + ',' + z);
      for (let z = 3; z <= 12; z++) for (let x = 2; x <= 10; x++) walkable.add(x + ',' + z);
      const grid = Array.from({length:rows}, (_,z) => Array.from({length:cols}, (_,x) => makeTile(walkable.has(x + ',' + z))));
      const scene = new THREE.Scene(), root = new THREE.Group(), particles = new THREE.Group(); // Reuses the existing ruin's map record and teardown structure.
      scene.name = MAP_ID;
      scene.background = new THREE.Color('#171614');
      root.name = 'fixed_harlyao_story_vault';
      scene.add(root, particles);
      const stone = new THREE.MeshBasicMaterial({color:0x504a43}); // Shared flat Harlyao masonry surface for this small authored interior.
      const wallStone = new THREE.MeshBasicMaterial({color:0x3d3a36}); // Wall and archstone contrast without a new texture generator.
      const brokenStone = new THREE.MeshBasicMaterial({color:0x6a645d}); // Clearly visible, non-colliding shattered door fragments.
      const gold = new THREE.MeshBasicMaterial({color:0x8b8060}); // Subtle detailing for the now-empty legendary-item altar.
      const floorGeometry = new THREE.BoxGeometry(1,0.14,1); // One reusable tile mesh source keeps the static geometry simple.
      const wallGeometry = new THREE.BoxGeometry(1,2.9,1); // Only boundary tiles receive actual walls.
      const occlusionMeshes = []; // Existing game camera handles normal occlusion around these fixed walls.
      const addBox = (name,x,y,z,w,h,d,mat,parent=root) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
        mesh.name=name;mesh.position.set(x,y,z);parent.add(mesh);return mesh;
      }; // Used for door fragments and pedestal; intentionally none of these register blockers.
      floorHeights.clear(); floorCellSize = 1;
      DS.clearScope(SCOPE);
      for (const key of walkable) {
        const [x,z] = key.split(',').map(Number);
        const floor = new THREE.Mesh(floorGeometry,stone);
        floor.name = 'story_vault_floor_' + key;
        floor.position.set(x+.5,-.08,z+.5); root.add(floor);
        floorHeights.set((x-PAD)+','+(z-PAD),0);
        DS.registerSurface({id:'story-vault-floor-'+key,scope:SCOPE,
          bounds:{minX:x,maxX:x+1,minZ:z,maxZ:z+1},topY:0,priority:2});
        for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          if (walkable.has((x+dx)+','+(z+dz))) continue;
          // Hall entrance at z=27 has one open exit tile; no scripted collision is put across it.
          if (z === 27 && dz === 1 && x === 6) continue;
          const wall = new THREE.Mesh(wallGeometry,wallStone);
          wall.name='story_vault_wall_'+x+'_'+z+'_'+dx+'_'+dz;
          wall.scale.set(Math.abs(dx) ? .20 : 1,1,Math.abs(dz) ? .20 : 1);
          wall.position.set(x+.5+dx*.5,1.38,z+.5+dz*.5);
          root.add(wall);occlusionMeshes.push(wall);
        }
      }
      // The great door was broken from the *outside*: fragments lie on both sides
      // of the threshold, but neither the geometry nor the grid blocks passage.
      const doorZ = 12.95; // Threshold between the 3-wide straight hallway and the large altar chamber.
      addBox('shattered_great_door_left_jamb',4.55,.95,doorZ,.48,1.9,.75,brokenStone);
      addBox('shattered_great_door_right_jamb',8.45,.91,doorZ,.48,1.82,.75,brokenStone);
      for (let i=0;i<18;i++) {
        const along = (i%6)-2.5, across = Math.floor(i/6)-1;
        const block=addBox('noncolliding_great_door_fragment_'+i,6.5+along*.47,.10,doorZ+across*.58,
          .23+(i%3)*.09,.16+(i%2)*.12,.26+(i%4)*.07,brokenStone);
        block.rotation.y=(i*0.67)%Math.PI;block.rotation.z=((i%5)-2)*.19;
      }
      const pedestal = new THREE.Group(); // Named reticle target, not a pickup: the legendary-item mount is visibly empty.
      pedestal.name='story_vault_empty_altar';
      root.add(pedestal);
      addBox('altar_base',6.5,.17,5.4,1.65,.34,1.45,wallStone,pedestal);
      addBox('altar_plinth',6.5,.52,5.4,1.0,.45,.96,stone,pedestal);
      addBox('empty_legendary_relic_rest',6.5,.81,5.4,.84,.14,.76,gold,pedestal);
      // A slightly raised back wall silhouettes the empty rest without inventing the missing relic.
      addBox('altar_rear_inscription',6.5,1.03,4.88,.95,.38,.16,wallStone,pedestal);

      const footprintOwners = []; // PNG-projected floor planes are updated together when the async decal mask finishes loading.
      const footprintMaterial = new THREE.MeshBasicMaterial({color:0x080808,transparent:true,opacity:0,
        depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3}); // Keep the planes invisible until the black-on-white authored mask is loaded; otherwise they appear as solid rectangles.
      const footprintGeometry = new THREE.PlaneGeometry(.28,.42);
      function addPrint(x,z,yaw,index) {
        const pivot = new THREE.Group(); // World-yaw parent; the child image's top/toes naturally point toward -Z at yaw zero.
        pivot.name='hachutu_bird_footprint_'+index;pivot.position.set(x,.025,z);pivot.rotation.y=yaw;
        const decal = new THREE.Mesh(footprintGeometry,footprintMaterial);
        decal.rotation.x=-Math.PI/2;decal.renderOrder=3;pivot.add(decal);root.add(pivot);
        footprintOwners.push(pivot);
      }
      let footIndex=0;
      for (let z=26.9;z>=5.8;z-=.65) {
        const step=footIndex++%2===0 ? -.14 : .14; // Opposite feet stagger left/right while traveling toward the empty altar.
        addPrint(6.04+step,z,0,footIndex);
      }
      for (let z=5.9;z<=26.9;z+=.65) {
        const step=footIndex++%2===0 ? -.14 : .14;
        addPrint(6.95+step,z,Math.PI,footIndex);
      }
      // The author's PNG has toes pointing UP. Turning black pixels opaque and
      // white pixels transparent prevents a white rectangular mask on the floor.
      const decalImage = new Image();
      decalImage.onload = () => {
        if (ruin?.localeRoot !== root) return; // Async loads from an exited ruin cannot decorate the next visit.
        const canvas=document.createElement('canvas');
        canvas.width=decalImage.naturalWidth;canvas.height=decalImage.naturalHeight;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(decalImage,0,0);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
        for (let i=0;i<pixels.data.length;i+=4) {
          const gray=(pixels.data[i]+pixels.data[i+1]+pixels.data[i+2])/765;
          pixels.data[i]=0;pixels.data[i+1]=0;pixels.data[i+2]=0;
          pixels.data[i+3]=Math.round(pixels.data[i+3]*Math.max(0,Math.min(1,(.90-gray)*3)));
        }
        ctx.putImageData(pixels,0,0);
        const texture=new THREE.CanvasTexture(canvas);
        texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
        footprintMaterial.map=texture;footprintMaterial.opacity=.92;footprintMaterial.needsUpdate=true;
        ruin.storyVaultDecalReady=true; // Exposed in the existing mobile diagnostics; not an assumed asset.
      };
      decalImage.onerror=()=>{if(ruin?.localeRoot===root)ruin.storyVaultDecalError='footprint_hachutu.png failed to load';}; // Missing assets never paint solid black boxes.
      const spawn={x:6.5,z:26.6}; // Same playable entrance as the fixed map exit.
      const floor=[...walkable].map(key=>key.split(',').map(Number));
      const exits=[{id:'exit_story_harlyao_vault',label:'Climb out of the vault',tiles:[[6,27]],targetMap:'',spawnCol:0,spawnRow:0}];
      const mapData={schema:'hobunji_building_interior.v1',id:MAP_ID,name:generationLabel,cols,rows,
        floor,exits,colliders:[],furniture:[],vendorZones:[],wallStyle:'cavern',devSessionOnly:true,storyVault:true};
      const rec={scene,grid,cols,rows,mapData,wallStyle:'cavern',floorSet:walkable,exits,
        spawn,localeRoot:root,particleRoot:particles,occlusionMeshes};
      buildingScenes.set(MAP_ID,rec);
      const controls=[{kind:'story-vault-pedestal',label:'Investigate the empty pedestal',touchIcon:'🔎',
        object:pedestal,promptRoot:pedestal,point:{x:6.5,y:.8,z:5.4},range:1.8,priority:110,
        onPress:()=>window.DelversGuild?.playVaultInvestigation?.()}]; // Reuses the ordinary aimed ruin interaction prompt.
      const noPuzzles={syncPressurePlates(){},tickRuntime(){},applyProgress(){}}; // Parent frame's mechanism scheduler expects a V50-like adapter.
      ruin={seed:0,theme:'hronal',specialBoss:false,storyVault:true,ruinName:generationLabel,
        sourceSeed:'story-vault-fixed',requestedSeed:0,meta:{rooms:[{name:'hallway'},{name:'empty vault'}]},
        puzzleOptions:{},puzzleGeneration:{},api:noPuzzles,...rec,controls,mechanisms:new Map(),activators:[],
        pressurePlateRoots:[],mechanismSignalRoots:[],pushBlocks:[],transitDoors:[],transitDoorStates:[],
        supportY:0,supportId:null,falling:null,solvability:{ok:true,story:true},storyVaultDecalReady:false,
        storyVaultFootprintCount:footprintOwners.length, // Mobile diagnostics prove the authored texture is instanced along the entire return trail.
        lastAcceptedPx:{x:spawn.x*deps.TILE,y:spawn.z*deps.TILE},
        lastSafePx:{x:spawn.x*deps.TILE,y:spawn.z*deps.TILE}};
      decalImage.src='assets/textures/decals/footprint_hachutu.png';
      await enterRuin();
      deps.showToast?.('A ruined entrance leads to a silent, empty Harlyao vault.', true);
      return true;
    } catch(error) {
      console.error('[Harlyao story vault]',error);
      deps.showToast?.('Could not enter the hidden vault: '+error.message,false);
      clearRuntime(true);
      return false;
    }
  }

  function enterRuin() {
    const entering=ruin;
    return runSceneTransition(()=>{
      // A completed generate now awaits this callback, but keep the identity guard
      // so an explicit clear/leave during a transition cannot warp into stale data.
      if(!entering||ruin!==entering)return;
      for(const o of playerSceneObjects()) detach(o);
      deps.setCurrentArea(MAP_ID); deps.setCurrentBuildingMapId?.(MAP_ID);
       if (entering.specialBoss) window.LocationArrival?.announce?.(entering.ruinName, {area:MAP_ID}); // Existing cave/camp arrival banner fires with the loading transition.
      deps.player.x=entering.spawn.x*deps.TILE; deps.player.y=entering.spawn.z*deps.TILE; deps.player.vx=0;deps.player.vy=0;
      movePlayerObjectsTo(entering.scene);
      const s=DS.sampleSupport(entering.spawn.x,entering.spawn.z,{minY:-4,maxY:5,pad:.02}); entering.supportId=s?.id||null;entering.supportY=s?.y||0;
      entering.lastAcceptedPx={x:deps.player.x,y:deps.player.y}; entering.lastSafePx={...entering.lastAcceptedPx};
      syncRuinPresentationHeight(entering.supportY);
      deps._snapCameraTarget?.(); deps.refreshActionBar?.(); deps.closeMenu?.();
    });
  }

  function leaveRuin() {
    if (!ruin || deps.getCurrentArea?.()!==MAP_ID) return;
    const leaving=ruin;
    const relocated=leaving.storyVault ? window.RuinSites?.storyVaultSite?.('map_western_slope') : null; // A Tothal Shift may move the unique quest burrow while the player is underground.
    const back=relocated
      ? {area:relocated.zoneId,x:(relocated.col+.5)*deps.TILE,y:(relocated.row+1.5)*deps.TILE}
      : returnAnchor||{area:'farm',x:(deps.COLS/2)*deps.TILE,y:(deps.ROWS/2)*deps.TILE};
    return runSceneTransition(()=>{
      if(!leaving||ruin!==leaving)return;
      for(const o of playerSceneObjects()) detach(o);
      deps.setCurrentArea(back.area); deps.setCurrentBuildingMapId?.(deps._isBuildingArea?.(back.area)?back.area:null);
      deps.player.x=back.x; deps.player.y=back.y; deps.player.vx=0;deps.player.vy=0;
      let target=deps.getActiveScene?.(); if(!target&&deps._isZoneArea?.(back.area)) target=deps.buildZoneScene?.(back.area)?.scene;
      clearRuinPresentationHeight();
      movePlayerObjectsTo(target); deps._snapCameraTarget?.(); deps.refreshActionBar?.();
      clearRuntime(true); returnAnchor=null; deps.showToast?.(generationLabel?'You step back out of the ruin.':'Left Random Test Ruin.',true);
      window.RuinSites?.onRuinLeft?.();
    });
  }

  // Leaves through a caller-supplied destination instead of the entrance
  // anchor (js/ruin-sites.js: the exit ladder surfaces somewhere random).
  // `enter` must put the player into a built zone (game.js enterZone).
  function exitTo(enter) {
    if (!ruin || deps.getCurrentArea?.()!==MAP_ID) return;
    const leaving=ruin;
    return runSceneTransition(()=>{
      if(!leaving||ruin!==leaving)return;
      clearRuinPresentationHeight();
      Promise.resolve(enter()).finally(()=>{ // enterZone may wait on an in-flight Tothal Shift; keep the ruin intact until the player has actually left it.
        if(ruin===leaving)clearRuntime(true);
        returnAnchor=null;
        deps._snapCameraTarget?.(); deps.refreshActionBar?.();
      });
    });
  }

  function clearRuntime(removeMap=true) {
    ruin?.rootGrowthAbort?.abort();for(const binding of ruin?.rootGrowthBindings||[])binding.dispose();
    ruin?.stoneAgeAbort?.abort();ruin?.stoneAgeScenery?.cover?.dispose();ruin?.stoneAgeScenery?.dispose(); // Restore native V50 visibility before the hidden generator reclaims its preview roots.
    ruin?.occupancy?.destroy?.();
    if(ruin?.storyVault && ruin.localeRoot) {
      const geometries=new Set(),materials=new Set(); // Static story rooms are rebuilt on each visit; release their owned GPU resources exactly once.
      ruin.localeRoot.traverse(node=>{
        if(node.geometry) geometries.add(node.geometry);
        const mats=Array.isArray(node.material)?node.material:[node.material];
        for(const material of mats) if(material) materials.add(material);
      });
      for(const geo of geometries) geo.dispose?.();
      for(const material of materials) {
        material.map?.dispose?.();
        material.dispose?.();
      }
    }
    DS.clearScope(SCOPE);
    if(ruin){detach(ruin.localeRoot);detach(ruin.particleRoot);detach(ruin.ceilingMesh);ruin.ceilingMesh?.geometry?.dispose?.();} if(removeMap) buildingScenes?.delete(MAP_ID);
    ruin=null;
    clearRuinPresentationHeight();
    // A reroll deliberately keeps the hidden V50 realm alive. Its API's
    // restorePreviewRoots() reclaims these detached roots before rebuilding,
    // preserving exact prototype caches and preventing repeated iframe/CDN boot.
    if(removeMap) removeGeneratorFrame();
    const badge=document.getElementById('devRandomRuinBadge');
    if(badge){
      badge.style.display='none';
      badge._ruinDebugBadgeParts=null; // A reroll starts fresh; no old subsystem diagnostics survive into a new map.
      badge.textContent='';
      badge.dataset.ruinBadgeExpanded='0';
      badge.style.maxHeight='3.8em';
      badge.style.overflowY='hidden';
      badge.setAttribute('aria-expanded','false');
    }
  }

  function positionInfo(px,py){const x=px/deps.TILE,z=py/deps.TILE;return{x,z,pit:DS.pointInPit(x,z,PLAYER_RADIUS*.25),support:DS.sampleSupport(x,z,{minY:-4,maxY:5,pad:.02})};} // Horizontal collision is already resolved by the ordinary registered interior grid; this helper owns only ruin-specific vertical support/pit state.
  function reconcilePlayer(now){
    if(window.DevRandomRuinSimplePuzzles?.ownsPlayerMotion?.())return;
    if(deps.player?.climbing){
      const climbY=Number(deps.player.climbSurfaceY); // Used to advance the ruin's accepted-height baseline during the shared ladder animation so landing is not rejected as an oversized step.
      if(Number.isFinite(climbY)){
        ruin.supportY=climbY;
        ruin.lastAcceptedPx={x:deps.player.x,y:deps.player.y};
        syncRuinPresentationHeight(climbY);
      }
      return;
    }
    if(ruin.falling){
      const f=ruin.falling,t=clamp((now-f.startedAt)/FALL_MS,0,1);
      deps.player.x=f.x;deps.player.y=f.y;
      syncRuinPresentationHeight(ruin.supportY-1.8*t);
      if(t>=1){
        deps.player.x=f.safe.x;deps.player.y=f.safe.y;ruin.falling=null;
        const landed=positionInfo(deps.player.x,deps.player.y);
        ruin.supportId=landed.support?.id||null;
        ruin.supportY=landed.support?.y??0;
        ruin.lastAcceptedPx={x:deps.player.x,y:deps.player.y};
        ruin.lastSafePx={...ruin.lastAcceptedPx};
        syncRuinPresentationHeight(ruin.supportY);
      }
      return;
    }
    let info=positionInfo(deps.player.x,deps.player.y);
    if(info.pit&&!info.support){
      if(ruin.hachutu&&window.DevHachutuRuin?.isDeadlyPit?.(info.x,info.z)){
        ruin.falling={startedAt:now,x:deps.player.x,y:deps.player.y,safe:{...ruin.lastSafePx}};
        if(window.PlayerDowned?.dieImmediately?.('hachutu-temple-abyss')!==true)deps.damagePlayer?.(999999);
        return;
      }
      ruin.falling={startedAt:now,x:deps.player.x,y:deps.player.y,safe:{...ruin.lastSafePx}};
      window.ResourceSystem?.spendFooting?.(deps.player,35,'test ruin fall');
      return;
    }
    const ny=info.support?.y??0,same=info.support?.id===ruin.supportId;
    if(!same&&ny-ruin.supportY>MAX_STEP_HEIGHT){
      deps.player.x=ruin.lastAcceptedPx.x;deps.player.y=ruin.lastAcceptedPx.y;
      syncRuinPresentationHeight(ruin.supportY);
      return;
    }
    ruin.lastAcceptedPx={x:deps.player.x,y:deps.player.y};
    if(!info.pit||info.support)ruin.lastSafePx={...ruin.lastAcceptedPx};
    ruin.supportId=info.support?.id||null;
    ruin.supportY=ny;
    if(info.support)syncRuinPresentationHeight(ny);
  }

  function updateTransitDoors(dt){
    const player=deps?.player&&deps?.TILE?{x:deps.player.x/deps.TILE,z:deps.player.y/deps.TILE}:null;
    for(const state of ruin.transitDoorStates||[]){
      state.open+=clamp(state.target-state.open,-dt*2.4,dt*2.4);
      if(Math.abs(state.open-state.target)<.001)state.open=state.target;
      const eased=state.open*state.open*(3-2*state.open);
      if(state.door.rootGrowthBinding)state.door.rootGrowthBinding.setProgress(state.open);
      else state.panel.position.y=state.closedY+(state.openY-state.closedY)*eased;
      if(state.target>.5&&state.open>.9&&player&&state.openingSide){
        const center=centerFor(state.door),signed=(state.crossingAxis==='x'?player.x-center.x:player.z-center.z);
        if(Math.sign(signed)===-state.openingSide&&Math.abs(signed)>.48){
          state.target=0; // Authored transit behavior: once the player has crossed the threshold, the plain hallway door retracts back closed behind them.
          state.openingSide=0;
        }
      }
    }
  }

  // Plates and the linked signal roots mechanisms read are fixed at generation;
  // collecting them once replaces a whole-ruin traversal every frame.
  function mechanismSignalRoots(){
    if(ruin.pressurePlateRoots)return;
    const plates=[],signals=new Set();
    ruin.localeRoot.traverse(o=>{const u=o.userData;if(!u)return;if(u.previewMotion?.type==='pressurePlate')plates.push(o);if(u.linkedCubePuzzleRoot)signals.add(u.linkedCubePuzzleRoot);if(u.linkedPressurePlateRoot)signals.add(u.linkedPressurePlateRoot);});
    for(const plate of plates)signals.add(plate);
    ruin.pressurePlateRoots=plates;ruin.mechanismSignalRoots=[...signals];
  }
  const MECHANISM_REAPPLY_MS=1000; // Safety net: unchanged mechanisms are still re-posed once a second.
  function updateMechanisms(dt){
    mechanismSignalRoots();
    for(const plate of ruin.pressurePlateRoots)ruin.api.syncPressurePlates(plate);
    ruin.api.tickRuntime(dt);
    for(const m of ruin.mechanisms.values()){
      const linkedPlate=m.root.userData?.linkedPressurePlateRoot;
      const linkedSignal=m.root.userData?.linkedCubePuzzleRoot;
      const signalProgress=Number(linkedSignal?.userData?.solveProgress);
      const plateProgress=Number(linkedPlate?.userData?.weightProgress);
      const hasExternalTarget=m.externalTarget!==null&&m.externalTarget!==undefined&&Number.isFinite(Number(m.externalTarget)); // Modular composition may deliberately take ownership of an already-authored V50 mechanism.
      if(hasExternalTarget){
        const desired=clamp(Number(m.externalTarget),0,1);
        m.progress+=clamp(desired-m.progress,-dt*1.55,dt*1.55); // Uses the same smooth progress cadence as ordinary wide stone doors instead of snapping collision while leaving the render signal at zero.
        if(Math.abs(m.progress-desired)<.001)m.progress=desired;
      }else if(m.manualFallback){
        const linkedTarget=Math.max(Number.isFinite(signalProgress)?signalProgress:0,Number.isFinite(plateProgress)?plateProgress:0);
        const desired=Math.max(m.target,linkedTarget); // Either the nearby lift control or its projectile activator can raise it; neither can strand the player.
        m.progress+=clamp(desired-m.progress,-dt*1.55,dt*1.55);
      }else if(Number.isFinite(signalProgress)) m.progress=clamp(signalProgress,0,1); // Projectile glyph runtime publishes a smooth solveProgress here; applying it closes the missing signal→animation bridge.
      else if(Number.isFinite(plateProgress)) m.progress=clamp(plateProgress,0,1);
      else m.progress+=clamp(m.target-m.progress,-dt*1.55,dt*1.55); // Ungated/manual doors use the same authored V50 progress animation.
      if(Math.abs(m.progress-m.target)<.001&&!linkedPlate&&!linkedSignal&&!hasExternalTarget)m.progress=m.target;
      if(hasExternalTarget||m.manualFallback){ // V50's applyMechanismProgress animates from the linked signal/plate whenever one exists and ignores the progress passed in, so an external override (hallway glyph gate, ossuary chord) or a manual lift control must be written into that signal, or the mechanism never visibly moves and its collision stays put.
        if(linkedSignal)linkedSignal.userData.solveProgress=m.progress;
        else if(linkedPlate)linkedPlate.userData.weightProgress=m.progress;
      }
    }
    // applyProgress re-traverses each mechanism; it is a pure function of its
    // progress and the plate/glyph signals, so it only runs when those change.
    let signals='';for(const root of ruin.mechanismSignalRoots)signals+=(root.userData.weightProgress??'')+','+(root.userData.solveProgress??'')+';';
    const now=performance.now();
    const due=(owner,progress)=>{const st=owner.userData;if(st.__appliedProgress===progress&&st.__appliedSignals===signals&&now-st.__appliedAt<MECHANISM_REAPPLY_MS)return false;st.__appliedProgress=progress;st.__appliedSignals=signals;st.__appliedAt=now;return true;};
    for(const m of ruin.mechanisms.values())if(due(m.root,m.progress))ruin.api.applyProgress(m.root,m.progress);
    for(const a of ruin.activators){
      const m=ruin.mechanisms.get(a.userData?.linkedMechanismId);
      if(m&&!['pressurePlate','linkedCubePillars'].includes(a.userData?.activatorType)&&due(a,m.progress))ruin.api.applyProgress(a,m.progress);
    }
    if(ruin.occupancy?.refresh())updateBadge();
  }
  DS.addBeforeRenderClient(()=>{if(!ruin)return;if(deps.getCurrentArea?.()!==MAP_ID)return;const now=performance.now(),dt=clamp((now-frameLastMs)/1000,0,.05);frameLastMs=now;updateTransitDoors(dt);updateMechanisms(dt);reconcilePlayer(now);});

  const BADGE_PART_ORDER=['base','hooks','motion','simple','hachutu','lich','coverage'];
  function setDebugBadgePart(part,text){
    // All ruin diagnostics write a *named segment* instead of caching/appending the entire
    // shared badge text. This makes frame-client order irrelevant and prevents runaway growth.
    if(!ruin||!devModeEnabled()||!BADGE_PART_ORDER.includes(part))return false;
    const badge=document.getElementById('devRandomRuinBadge');
    if(!badge)return false;
    const parts=badge._ruinDebugBadgeParts||(badge._ruinDebugBadgeParts=Object.create(null));
    const value=String(text||'');
    if(parts[part]===value)return true;
    parts[part]=value;
    const composed=BADGE_PART_ORDER.map(key=>parts[key]||'').join('');
    if(badge.textContent!==composed)badge.textContent=composed;
    return true;
  }
  function updateBadge(){
    if(!ruin||!devModeEnabled())return; // Diagnostics badge is for Dev Mode only; wilderness-site ruins are ordinary play.
    let b=document.getElementById('devRandomRuinBadge'); // Used as the existing mobile-visible Random Test Ruin diagnostic badge.
    if(!b){
      b=document.createElement('div');
      b.id='devRandomRuinBadge';
      b.style.cssText='position:fixed;left:10px;bottom:10px;z-index:65;box-sizing:border-box;max-width:calc(100vw - 20px);max-height:3.8em;overflow:hidden;white-space:normal;overflow-wrap:anywhere;line-height:1.25;padding:6px 9px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(12,14,12,.82);color:#ddd;font:11px monospace;pointer-events:auto;cursor:pointer;touch-action:pan-y';
      b.title='Tap or click to expand/collapse the ruin diagnostics';
      b.tabIndex=0;b.setAttribute('role','button');
      b.setAttribute('aria-label','Expand or collapse ruin diagnostics');
      const toggle=()=>{
        const expanded=b.dataset.ruinBadgeExpanded!=='1';
        b.dataset.ruinBadgeExpanded=expanded?'1':'0';
        b.style.maxHeight=expanded?'min(35vh, 250px)':'3.8em';
        b.style.overflowY=expanded?'auto':'hidden';
        b.setAttribute('aria-expanded',String(expanded));
      };
      b.addEventListener('click',toggle);
      b.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}});
      document.body.appendChild(b);
    }
    const occupancy=ruin.occupancy?.snapshot?.(); // Used to retain the existing red/green/blue occupancy counts in the badge.
    const roomPuzzleCounts=Object.values(ruin.puzzleGeneration?.countsByRoom||{}).map(Number); // Used to verify the configured room cap without opening devtools.
    const maxRoomPuzzles=roomPuzzleCounts.length?Math.max(...roomPuzzleCounts):0; // Used to report the busiest generated room.
    const capLabel=ruin.puzzleOptions?.maxPerRoom?String(ruin.puzzleOptions.maxPerRoom):'∞'; // Used to distinguish a finite cap from the default unlimited setting.
    const solvabilityLabel=ruin.solvability?.ok?('solvable ✓'+(ruin.generationAttempt>1?' after '+ruin.generationAttempt+' tries':'')):'solvability ?'; // Mobile-visible proof that this accepted seed passed the pre-entry audit.
    const darkness=getDarknessSettings(); // Shows whether the test-only darkness override is active without requiring desktop devtools.
    const darknessLabel=darkness.enabled?(Math.round(darkness.severity*100)+'% override'):'themed';
    const hachutu=ruin.hachutu?window.DevHachutuRuin?.debug?.():null; // A compact mobile-facing meter; full detailed snapshot remains accessible on the Dev Ruin API.
    setDebugBadgePart('hachutu',hachutu?.active?(' · Hachutu weeds '+hachutu.plants.filter(p=>p.dead).length+'/3, wave '+(hachutu.trial?.wave||0)+'/3, boss '+(hachutu.heart?.boss||'-')):'');
    setDebugBadgePart('base',MAP_ID+' · seed '+ruin.seed+' · '+(ruin.meta.rooms?.length||0)+' rooms · '+solvabilityLabel+' · puzzles '+maxRoomPuzzles+'/'+capLabel+' max-room · tiles R'+(occupancy?.blocked.length||0)+' G'+(occupancy?.causes.length||0)+' B'+(occupancy?.effects.length||0)+' · cliff '+(ruin.denMaterialMeshCount||0)+' · oldstone '+(ruin.legacyStoneMaterialCount||0)+' · unlit +'+(ruin.unlitConvertedMaterialCount||0)+'/lit '+(ruin.remainingLitMaterialCount||0)+' · combat '+(ruin.wallStyle==='cavern'?'✓':'?')+' · '+ruin.theme+' · dark '+darknessLabel+' · rev '+(occupancy?.revision||0));
    b.style.display='';
  }
  function installSettingsButton(){
    if(!devModeEnabled())return;
    const arena=document.getElementById('devTeleportArenaBtn'); // Used as the stable Settings anchor for the Random Test Ruin controls.
    if(!arena||document.getElementById('devRandomTestRuinBtn'))return;
    const row=document.createElement('div'); // Used for the existing Generate action.
    row.className='settings-row';
    row.setAttribute('data-dev-only','');
    row.innerHTML='<div class="settings-label"><div class="settings-name">Random Test Ruin</div><div class="settings-desc">Generate a session-only playable V50 ruin. Rooted Stone Age mode uses the new rockified architecture, tiled boulder floor, Temple vegetation and growing puzzle mechanisms.</div></div><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="devRandomRuinRootMechanisms">Rooted Stone Age ruin</label><button type="button" id="devRandomTestRuinBtn" class="settings-small-btn">Generate</button>';
    arena.closest('.settings-row')?.insertAdjacentElement('afterend',row);
    const hachutuButton=document.createElement('button');hachutuButton.type='button';hachutuButton.className='settings-small-btn';hachutuButton.textContent='Hachutu Temple';hachutuButton.title='Developer-only Maskbound / live-root challenge test ruin';
    hachutuButton.addEventListener('click',()=>generate(randomSeed(),{hachutu:true,stoneAge:true,rootMechanisms:true}));
    row.appendChild(hachutuButton);
    row.querySelector('#devRandomTestRuinBtn')?.addEventListener('click',()=>{
      const selected=document.getElementById('devRandomRuinRootMechanisms')?.checked===true; // Single switch enables both the complete Stone Age environment and rooted mechanisms.
      generate(randomSeed(),{rootMechanisms:selected,stoneAge:selected});
    });

    const optionsRow=document.createElement('div'); // Used to host the collapsed per-generator puzzle controls directly beneath Generate.
    optionsRow.className='settings-row';
    optionsRow.setAttribute('data-dev-only','');
    optionsRow.style.display='block';
    const optionMarkup=PUZZLE_OPTION_ROWS.map(([key,label])=>`<label style="display:flex;align-items:center;gap:7px;min-height:28px"><input type="checkbox" data-ruin-puzzle-option="${key}"><span>${label}</span></label>`).join(''); // Used to keep the checkbox list data-driven and mobile-wrappable.
    optionsRow.innerHTML=`<details id="devRandomRuinPuzzleOptions" style="width:100%"><summary class="settings-name" style="cursor:pointer;user-select:none">Puzzle Generation</summary><div class="settings-desc" style="margin-top:4px">Simple-mode puzzle families. Projectile targets use V50's proven hit runtime; the other three are independent hazards/traversal and never lock the room graph.</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:4px 12px;margin-top:8px">${optionMarkup}</div><label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px"><span>Max projectile puzzles per room <small style="opacity:.72">(0 = unlimited)</small></span><input id="devRandomRuinMaxPuzzlesPerRoom" type="number" min="0" max="12" step="1" inputmode="numeric" style="width:74px"></label></details>`;
    row.insertAdjacentElement('afterend',optionsRow);
    bindPuzzleOptionsPanel(optionsRow.querySelector('#devRandomRuinPuzzleOptions'));

    const darknessRow=document.createElement('div'); // Test-only lighting control kept separate from puzzle-generation options.
    darknessRow.className='settings-row';
    darknessRow.setAttribute('data-dev-only','');
    darknessRow.innerHTML='<div class="settings-label"><div class="settings-name">Test Ruin Darkness</div><div class="settings-desc">Lich-themed darkness is always active. Enable the severity override for easier puzzle inspection.</div></div><div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px 12px"><label style="display:flex;align-items:center;gap:6px"><input id="devRandomRuinDarknessEnabled" type="checkbox"><span>Darkness</span></label><label style="display:flex;align-items:center;gap:6px"><span>Severity</span><input id="devRandomRuinDarknessSeverity" type="range" min="0" max="100" step="1" value="100" style="width:min(180px,32vw)"><output id="devRandomRuinDarknessSeverityValue">100%</output></label></div>';
    optionsRow.insertAdjacentElement('afterend',darknessRow);
    bindDarknessControls(darknessRow);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installSettingsButton,{once:true});else installSettingsButton();

  window.DevRandomRuin=Object.freeze({generate,generateStoryVault,reroll:()=>generate(randomSeed(),{hachutu:ruin?.hachutu===true,rootMechanisms:ruin?.rootedMechanisms===true,stoneAge:ruin?.stoneAgeRequested===true}),clear:()=>{if(deps?.getCurrentArea?.()===MAP_ID)leaveRuin();else clearRuntime(true);},leave:leaveRuin,exitTo,getInteractionControls:()=>ruin?ruin.controls.filter(control=>control.kind!=='story-vault-pedestal'||window.DelversGuild?.vaultPhase?.()==='search').map(control=>({...control,range:Number.isFinite(Number(control.range))?Number(control.range):CONTROL_RANGE})):[],getRuntimeContext:()=>ruin?{scene:ruin.scene,grid:ruin.grid,root:ruin.localeRoot,meta:ruin.meta,floorSet:ruin.floorSet,ceilingY:ruin.ceilingY,spawn:{...ruin.spawn},cols:ruin.cols,rows:ruin.rows,seed:ruin.seed,theme:ruin.theme,specialBoss:ruin.specialBoss,ruinName:ruin.ruinName,hachutu:!!ruin.hachutu,stoneAge:!!ruin.stoneAge,stoneAgeStats:ruin.stoneAgeStats||null,puzzleOptions:{...ruin.puzzleOptions}}:null,getPuzzleGenerationOptions:()=>readPuzzleGenerationOptions(),setPuzzleGenerationOptions:options=>savePuzzleGenerationOptions(options),getOccupancySnapshot:()=>ruin?.occupancy?.snapshot?.()||null,getLastSolvabilityAudit:()=>lastGenerationAudit?JSON.parse(JSON.stringify(lastGenerationAudit)):null,getDarknessSettings,setDebugBadgePart,getOcclusionMeshes:()=>ruin?.occlusionMeshes||null,setPlayerWorldPoint,getPlayerSupportY,getPlayerGroundSupportY,getGroundSupportYAt,setMechanismTarget,lockMechanism,unlockMechanism,mechanismInfo,syncPlayerPresentationHeight:syncRuinPresentationHeight,getState:()=>ruin?{mapId:MAP_ID,storyVault:ruin.storyVault ? {footprints:ruin.storyVaultFootprintCount,doorBlocks:false,puzzles:0,decalReady:ruin.storyVaultDecalReady,decalError:ruin.storyVaultDecalError||null} : null,seed:ruin.seed,theme:ruin.theme,specialBoss:ruin.specialBoss,ruinName:ruin.ruinName,hachutu:!!ruin.hachutu,requestedSeed:ruin.requestedSeed,sourceSeed:ruin.sourceSeed,tileScale:RUIN_TILE_SCALE,wallStyle:ruin.wallStyle||null,stoneAge:!!ruin.stoneAge,stoneAgeRequested:!!ruin.stoneAgeRequested,stoneAgeStats:ruin.stoneAgeStats||null,rootedMechanisms:!!ruin.rootedMechanisms,rootedMechanismCount:ruin.rootGrowthBindings?.length||0,darkness:getDarknessSettings(),materialStats:{stoneMeshes:ruin.denMaterialMeshCount||0,cliffMeshes:ruin.denMaterialMeshCount||0,converted:ruin.unlitConvertedMaterialCount||0,remainingLit:ruin.remainingLitMaterialCount||0,legacyStone:ruin.legacyStoneMaterialCount||0,totalMeshes:ruin.totalRuinMeshCount||0,ceilingCells:ruin.ceilingCellCount||0,ceilingY:ruin.ceilingY??null,ceilingTextured:!!(Array.isArray(ruin.ceilingMesh?.material)?ruin.ceilingMesh.material:ruin.ceilingMesh?.material)?.map,ceilingMaterialTexture:ruin.ceilingMesh?.material?.map?.userData?.furnitureTexture||null,ceilingNaturalSurface:(Array.isArray(ruin.ceilingMesh?.material)?ruin.ceilingMesh.material[0]:ruin.ceilingMesh?.material)?.userData?.naturalSurface||null,occlusionMeshes:ruin.occlusionMeshes?.length||0},rooms:ruin.meta.rooms?.length||0,controls:ruin.controls.length,mechanisms:[...ruin.mechanisms.values()].map(m=>({id:m.id,type:m.type,progress:m.progress,target:m.target,externalTarget:m.externalTarget??null})),transitDoors:(ruin.transitDoorStates||[]).map(state=>({id:state.door?.id||null,open:+state.open.toFixed(3),target:state.target,axis:state.crossingAxis,center:state.center?{x:+state.center.x.toFixed(3),z:+state.center.z.toFixed(3)}:null})),puzzleOptions:ruin.puzzleOptions,puzzleGeneration:ruin.puzzleGeneration,solvability:ruin.solvability,generationAttempt:ruin.generationAttempt,presentation:presentationSnapshot(),occupancy:ruin.occupancy?.snapshot?.(),dynamic:DS.debugSnapshot()}:null});
})();
