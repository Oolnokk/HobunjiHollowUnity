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
  const MAX_SOLVABILITY_ATTEMPTS = 6; // Rejects impossible candidates before entry while keeping generation bounded.
  const PUZZLE_OPTIONS_STORAGE_KEY = 'hobunji.devRandomRuinPuzzleOptions.v2'; // v2 intentionally drops the fragile first-pass mechanisms from the shipped simple-puzzle defaults.
  const DARKNESS_SETTINGS_STORAGE_KEY = 'hobunji.devRandomRuinDarkness.v1'; // Used to persist the test-only darkness toggle and severity without changing real den lighting.
  const DEFAULT_DARKNESS_SETTINGS = Object.freeze({ enabled:false, severity:1 }); // Tests are bright by default; 1.0 restores the full authored den darkness when enabled.
  const DEFAULT_PUZZLE_OPTIONS = Object.freeze({ pressurePlate:false, brazier:false, glyphObelisk:true, stackedObelisk:false, linkedCubePillars:false, nestedRoom:false, safePath:true, ropeSwing:true, hallwayTraps:true, maxPerRoom:0 }); // First playable pass keeps only the proven projectile activator from V50; the three parent-runtime families below are intentionally simple and non-locking.
  const PUZZLE_OPTION_ROWS = Object.freeze([ // Only the simple-mode families are user-facing; disabled V50 families remain false in the normalized payload.
    ['glyphObelisk','Projectile glyph targets'],
    ['safePath','Safe-path pressure grids'],
    ['ropeSwing','Rope swing traversal'],
    ['hallwayTraps','Alternating hallway fire / poison traps'],
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
    for (const checkbox of panel.querySelectorAll('[data-ruin-puzzle-option]')) checkbox.checked = current[checkbox.dataset.ruinPuzzleOption] !== false;
    const maxInput = panel.querySelector('#devRandomRuinMaxPuzzlesPerRoom'); // Used to show the persisted room cap without requiring devtools.
    if (maxInput) maxInput.value = String(current.maxPerRoom);
    panel.addEventListener('change', () => puzzleOptionsFromPanel(panel));
    panel.addEventListener('input', event => {
      if (event.target?.id === 'devRandomRuinMaxPuzzlesPerRoom') puzzleOptionsFromPanel(panel);
    });
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
  const nativeDevInit = DevSpawner.init;
  DevSpawner.init = function (injectedDeps) {
    captureDeps(injectedDeps);
    return nativeDevInit.call(this, injectedDeps);
  };

  function playerSceneObjects() {
    return [deps?.playerMesh, deps?.playerGroundShadow, deps?.toolHolder, deps?.reticleMesh,
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
    while (performance.now() - started < 15000) {
      const api = frame.contentWindow?.DebrisifierV50;
      if (api?.sourceSha256 === SOURCE_SHA) return (generatorApi = api);
      const debug = frame.contentDocument?.getElementById('debug')?.textContent || '';
      if (/FAILED/i.test(debug)) throw new Error(debug);
      await wait(25);
    }
    throw new Error('Timed out loading Debris-ifier V50.');
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
    const cols = Math.max(6, Math.ceil(worldW) + PAD * 2);
    const rows = Math.max(6, Math.ceil(worldD) + PAD * 2);
    const walkable = new Set();
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
      enabled:() => object.visible !== false, priority });
  }
  function registerFloor(meta) {
    let floorMesh = null;
    ruin.localeRoot.traverse(o => { if (!floorMesh && o.userData?.wallBuilderRecipe === 'wallrecipe2.json') floorMesh = o; });
    const levels = floorMesh?.userData?.plateauModel?.levelByCell || {};
    const step = Number(floorMesh?.userData?.plateauModel?.stepHeight ?? meta.plateauModel?.stepHeight ?? 0.42);
    const cs = worldCellSize(meta);
    const originX = PAD, originZ = PAD;
    const floorKeys = new Set((meta.floorCells || []).map(([c,r]) => `${c},${r}`));
    for (const [c0,r0] of (meta.floorCells || [])) {
      const c=Number(c0), r=Number(r0), key=`${c},${r}`;
      DS.registerSurface({ id:`devruin-floor-${key}`, scope:SCOPE,
        bounds:{minX:originX+c*cs,maxX:originX+(c+1)*cs,minZ:originZ+r*cs,maxZ:originZ+(r+1)*cs},
        topY:(Number(meta.floorSurfaceY)||0) + Number(levels[key]||0)*step, priority:1 });
    }
    for (let c=0;c<(Number(meta.gridCols)||0);c++) for (let r=0;r<(Number(meta.gridRows)||0);r++) {
      if (floorKeys.has(`${c},${r}`)) continue;
      DS.registerPit({ id:`devruin-void-${c},${r}`, scope:SCOPE,
        bounds:{minX:originX+c*cs,maxX:originX+(c+1)*cs,minZ:originZ+r*cs,maxZ:originZ+(r+1)*cs} });
    }
  }

  function discoverRuntimeObjects() {
    ruin.mechanisms = new Map(); ruin.controls = []; ruin.activators = []; ruin.pushBlocks = []; ruin.transitDoors = [];
    const walls = []; // V50 wall meshes become boundary tiles instead of broad object AABBs.
    const furnitureBlockers = []; // Solid authored objects are rasterized child-mesh by child-mesh.
    ruin.localeRoot.traverse(object => {
      const d = object.userData || {}, motion = d.previewMotion?.type;
      if (d.mechanismId && ['bridge','bridgeSequence','stoneDoor','movingDais','collapsingStairs'].includes(motion))
        ruin.mechanisms.set(d.mechanismId,{id:d.mechanismId,root:object,type:motion,progress:0,target:0});
      if (d.linkedMechanismId && d.activatorType) {
        ruin.activators.push(object);
        if (d.activatorType === 'stackedObelisk' || d.activatorType === 'linkedCubePillars') {
          object.userData.interactive3D = true; // Tower activators are ordinary nearby world interactions, not click-only editor props.
          object.userData.devRuinInteractionType = d.activatorType; // Used by prompt diagnostics / semantic owner resolution.
          object.userData.blockerPurpose = 'puzzle_tower_' + d.activatorType; // Makes their authoritative occupancy source visible in Pixel Probe.
          furnitureBlockers.push(object); // Rasterizes the actual child cubes/caps into the shared 2D collision snapshot; the Group AABB itself is never used.
        }
      }
      if (d.pushable && (motion === 'pushPuzzleBlock' || motion === 'elevatorPushBlock')) ruin.pushBlocks.push(object);
      if (d.transitDoor) ruin.transitDoors.push(object);
      if (d.ruinInteriorWall) walls.push(object);
      if (d.elevatorWellSocket) furnitureBlockers.push(object);
      if (/ceiling support pillar|doorway flank pillar|sunken centerpiece|wall display artifice/i.test(String(d.interiorRuinRole||''))) furnitureBlockers.push(object);
    });
    for (const m of ruin.mechanisms.values()) {
      if (m.type === 'bridge' || m.type === 'bridgeSequence') registerSurface(`devruin-mech-${m.id}`,m.root,10);
      else if (m.type === 'movingDais') registerSurface(`devruin-mech-${m.id}`,m.root.userData.movingDaisPlatform||m.root,12);
      else if (m.type === 'collapsingStairs') for (const tread of (m.root.userData.stairTreads||[])) registerSurface(`devruin-stair-${m.id}-${tread.id}`,tread,12);
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
      if (!m || ['linkedCubePillars','pressurePlate'].includes(type)) continue;
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
      walls, staticSolids:furnitureBlockers, mechanisms:ruin.mechanisms, transitDoors:ruin.transitDoors,
      activators:ruin.activators, pushBlocks:ruin.pushBlocks,
      getPlayerPosition:() => ({ x:deps.player.x / deps.TILE, z:deps.player.y / deps.TILE }),
    });
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
    const natural=window.NaturalSurfaceMaterials; // Stone takes the exact cliffs path: fresh carved_smooth PNG body-tinted to the canonical #808080, then rendered white/unlit.
    if(!root?.traverse)return {stoneMeshes:0,convertedMaterials:0,remainingLitMaterials:0,legacyStoneMaterials:0,totalMeshes:0};
    let sourceStoneMaterial=null;
    root.traverse(object=>{if(sourceStoneMaterial||!object?.isMesh||!object.userData?.ruinInteriorWall)return;sourceStoneMaterial=Array.isArray(object.material)?object.material[0]:object.material;});

    let stoneMeshes=0,convertedMaterials=0,totalMeshes=0;
    if(typeof natural?.naturalizeMesh==='function'){
      root.traverse(object=>{
        if(!object?.isMesh)return;
        const materials=Array.isArray(object.material)?object.material:[object.material];
        if(!materials.length||!materials.every(material=>isLegacyV50StoneMaterial(material,sourceStoneMaterial)))return;
        natural.naturalizeMesh(object,'cliffs'); // Do not reuse V50's dark carved_smooth.png_fill_545039 texture; rebuild through the same config/tint path as world cliffs.
        object.userData=Object.assign({},object.userData,{devRandomRuinDenMaterial:true,devRandomRuinCliffMaterial:true,devRandomRuinUnlitMaterial:true});
        stoneMeshes++;
      });
    }

    root.traverse(object=>{
      if(!object?.isMesh)return;
      totalMeshes++;
      const list=Array.isArray(object.material)?object.material:[object.material];
      const next=list.map((material,index)=>{
        if(isLegacyV50StoneMaterial(material,sourceStoneMaterial) && typeof natural?.naturalizeMesh==='function') {
          // Multi-material stone slots cannot use naturalizeMesh without replacing sibling slots.
          // Preserve those rare mixed meshes as unlit below; all ordinary single-material V50 stone has already been rebuilt as cliffs above.
        }
        if(!isLitMaterial(material))return material;
        convertedMaterials++;
        return makeUnlitMaterial(material,`dev_random_ruin_unlit_${object.name||'mesh'}_${index}`);
      });
      if(Array.isArray(object.material))object.material=next;
      else if(next[0])object.material=next[0];
      if(next.some(material=>material?.userData?.devRandomRuinUnlitMaterial||material?.userData?.naturalSurfaceUnlit))object.userData=Object.assign({},object.userData,{devRandomRuinUnlitMaterial:true});
      object.castShadow=false; object.receiveShadow=false; // There are deliberately no real light/shadow semantics in this test scene.
    });

    let remainingLitMaterials=0,legacyStoneMaterials=0;
    root.traverse(object=>{
      if(!object?.isMesh)return;
      for(const material of (Array.isArray(object.material)?object.material:[object.material])){
        if(isLitMaterial(material))remainingLitMaterials++;
        if(isLegacyV50StoneMaterial(material,sourceStoneMaterial) && material?.userData?.naturalSurface!=='cliffs')legacyStoneMaterials++;
      }
    });
    return {stoneMeshes,convertedMaterials,remainingLitMaterials,legacyStoneMaterials,totalMeshes};
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
    const materialStats=applyUnlitRuinMaterials(roots.localeRoot); // Stone uses NaturalSurfaceMaterials('cliffs'); any remaining V50 lit material is demoted through the same character-PNG unlit factory.
    roots.localeRoot.name=`dev_v50_ruin_${seed}`; scene.add(roots.localeRoot);
    roots.particleRoot.position.set(0,0,0); scene.add(roots.particleRoot);

    const spawn=spawnInsideEntrance(meta);
    const exitTile=[clamp(Math.floor(spawn.x),0,projected.cols-1),clamp(Math.floor(spawn.z),0,projected.rows-1)];
    const mapData={schema:'hobunji_building_interior.v1',id:MAP_ID,name:`Random Test Ruin #${seed}`,cols:projected.cols,rows:projected.rows,
      floor:projected.floor,colliders:[],furniture:[],vendorZones:[],exits:[{id:'exit_dev_random_ruin',label:'Leave Test Ruin',tiles:[exitTile],targetMap:'',spawnCol:0,spawnRow:0}],
      wallStyle:'cavern', // Opts the session ruin into the game's existing combat-interior path so mobile receives Fire/Ammo/Potions and combat/reticle updates exactly like a den.
      devSessionOnly:true,devSeed:seed,devRuinTileScale:RUIN_TILE_SCALE,sourceGenerator:'HobunjiDebrisifierV50'};
    return {scene,grid:projected.grid,cols:projected.cols,rows:projected.rows,mapData,wallStyle:'cavern',floorSet:projected.walkable,exits:mapData.exits,spawn,localeRoot:roots.localeRoot,particleRoot:roots.particleRoot,denMaterialMeshCount:materialStats.stoneMeshes,unlitConvertedMaterialCount:materialStats.convertedMaterials,remainingLitMaterialCount:materialStats.remainingLitMaterials,legacyStoneMaterialCount:materialStats.legacyStoneMaterials,totalRuinMeshCount:materialStats.totalMeshes};
  }

  async function generate(seed=randomSeed()) {
    if (!devModeEnabled() || !deps || !buildingScenes) return false;
    const requestedSeed=Number(seed)>>>0; // Seed the user/test requested before solvability-driven retries derive alternates.
    const button=document.getElementById('devRandomTestRuinBtn'); if(button){button.disabled=true;button.textContent='Generating…';}
    try {
      if (deps.getCurrentArea?.() !== MAP_ID) returnAnchor={area:deps.getCurrentArea?.(),x:deps.player.x,y:deps.player.y};
      clearRuntime(false);
      const api=await ensureGeneratorFrame();
      const puzzleOptions=readPuzzleGenerationOptions(); // Keep one option snapshot across all candidate retries for this Generate action.
      lastGenerationAudit={requestedSeed,acceptedSeed:null,attempts:[]};

      for(let attempt=0;attempt<MAX_SOLVABILITY_ATTEMPTS;attempt++){
        if(attempt>0) clearRuntime(false);
        const candidateSeed=generationCandidateSeed(requestedSeed,attempt); // Deterministic retry seed so rejected layouts can be reproduced from diagnostics.
        if(button) button.textContent=attempt?'Retrying '+(attempt+1)+'/'+MAX_SOLVABILITY_ATTEMPTS+'…':'Generating…';
        const generated=await api.generateInteriorLocale({seed:'dev-'+candidateSeed.toString(36),size:'medium',density:62,roomMin:3,roomMax:6,puzzles:puzzleOptions});
        const meta=generated.locale?.meta?.interiorShell; if(!meta) throw new Error('V50 generated no interiorShell metadata.');
        api.snapMechanismState(0); api.pausePreviewLoop(); const roots=api.takePreviewRoots();
        const rec=makeMapRecord(candidateSeed,generated,roots,meta); buildingScenes.set(MAP_ID,rec);
        ruin={seed:candidateSeed,requestedSeed,sourceSeed:generated.seed,api,locale:generated.locale,meta,puzzleOptions:{...puzzleOptions},puzzleGeneration:generated.puzzleGeneration,...rec,mechanisms:new Map(),controls:[],activators:[],pushBlocks:[],supportId:null,supportY:0,falling:null,generationAttempt:attempt+1}; // Keep parent-runtime safe-path/rope/trap flags that the V50 API correctly ignores.
        registerFloor(meta); discoverRuntimeObjects();

        const solvability=Solvability.audit(ruin,{scope:SCOPE,pad:PAD,tileScale:RUIN_TILE_SCALE,controlRange:CONTROL_RANGE,playerRadius:PLAYER_RADIUS,maxStepHeight:MAX_STEP_HEIGHT}); // Runs before entry against the same collision/support runtime the player will use.
        ruin.solvability=solvability;
        lastGenerationAudit.attempts.push({seed:candidateSeed,ok:!!solvability.ok,failures:(solvability.failures||[]).slice(),rooms:solvability.rooms||[],unsolvedMechanisms:solvability.unsolvedMechanisms||[]});
        if(!solvability.ok){
          console.warn('[Random Test Ruin solvability] rejected candidate',candidateSeed,solvability);
          continue;
        }

        lastGenerationAudit.acceptedSeed=candidateSeed;
        await enterRuin(); updateBadge();
        const retryCount=attempt;
        deps.showToast?.(retryCount?('Rejected '+retryCount+' unsolvable ruin'+(retryCount===1?'':'s')+'; entered #'+candidateSeed+'.'):('Entered Random Test Ruin #'+candidateSeed+' as '+MAP_ID+'.'),true);
        return true;
      }

      const last=lastGenerationAudit.attempts[lastGenerationAudit.attempts.length-1];
      throw new Error('No solvable ruin found in '+MAX_SOLVABILITY_ATTEMPTS+' attempts'+(last?.failures?.length?': '+last.failures[0]:'')+'.');
    } catch(error) { console.error('[Random Test Ruin interior]',error); deps.showToast?.('Random Test Ruin failed: '+error.message,false); clearRuntime(true); return false; }
    finally { if(button){button.disabled=false;button.textContent='Generate';} }
  }

  function enterRuin() {
    const entering=ruin;
    return runSceneTransition(()=>{
      // A completed generate now awaits this callback, but keep the identity guard
      // so an explicit clear/leave during a transition cannot warp into stale data.
      if(!entering||ruin!==entering)return;
      for(const o of playerSceneObjects()) detach(o);
      deps.setCurrentArea(MAP_ID); deps.setCurrentBuildingMapId?.(MAP_ID);
      deps.player.x=entering.spawn.x*deps.TILE; deps.player.y=entering.spawn.z*deps.TILE; deps.player.vx=0;deps.player.vy=0;
      movePlayerObjectsTo(entering.scene);
      const s=DS.sampleSupport(entering.spawn.x,entering.spawn.z,{minY:-4,maxY:5,pad:.02}); entering.supportId=s?.id||null;entering.supportY=s?.y||0;
      entering.lastAcceptedPx={x:deps.player.x,y:deps.player.y}; entering.lastSafePx={...entering.lastAcceptedPx};
      if(deps.playerMesh?.position) deps.playerMesh.position.y=entering.supportY;
      deps._snapCameraTarget?.(); deps.refreshActionBar?.(); deps.closeMenu?.();
    });
  }

  function leaveRuin() {
    if (!ruin || deps.getCurrentArea?.()!==MAP_ID) return;
    const leaving=ruin;
    const back=returnAnchor||{area:'farm',x:(deps.COLS/2)*deps.TILE,y:(deps.ROWS/2)*deps.TILE};
    return runSceneTransition(()=>{
      if(!leaving||ruin!==leaving)return;
      for(const o of playerSceneObjects()) detach(o);
      deps.setCurrentArea(back.area); deps.setCurrentBuildingMapId?.(deps._isBuildingArea?.(back.area)?back.area:null);
      deps.player.x=back.x; deps.player.y=back.y; deps.player.vx=0;deps.player.vy=0;
      let target=deps.getActiveScene?.(); if(!target&&deps._isZoneArea?.(back.area)) target=deps.buildZoneScene?.(back.area)?.scene;
      movePlayerObjectsTo(target); deps._snapCameraTarget?.(); deps.refreshActionBar?.();
      clearRuntime(true); returnAnchor=null; deps.showToast?.('Left Random Test Ruin.',true);
    });
  }

  function clearRuntime(removeMap=true) {
    ruin?.occupancy?.destroy?.();
    DS.clearScope(SCOPE);
    if(ruin){detach(ruin.localeRoot);detach(ruin.particleRoot);} if(removeMap) buildingScenes?.delete(MAP_ID);
    ruin=null;
    // A reroll deliberately keeps the hidden V50 realm alive. Its API's
    // restorePreviewRoots() reclaims these detached roots before rebuilding,
    // preserving exact prototype caches and preventing repeated iframe/CDN boot.
    if(removeMap) removeGeneratorFrame();
    const badge=document.getElementById('devRandomRuinBadge'); if(badge) badge.style.display='none';
  }

  function positionInfo(px,py){const x=px/deps.TILE,z=py/deps.TILE;return{x,z,blocker:DS.blockerAt(x,z,{radius:PLAYER_RADIUS,actorHeight:1.25}),pit:DS.pointInPit(x,z,PLAYER_RADIUS*.25),support:DS.sampleSupport(x,z,{minY:-4,maxY:5,pad:.02})};}
  function reconcilePlayer(now){if(window.DevRandomRuinSimplePuzzles?.ownsPlayerMotion?.())return;if(ruin.falling){const f=ruin.falling,t=clamp((now-f.startedAt)/FALL_MS,0,1);deps.player.x=f.x;deps.player.y=f.y;if(deps.playerMesh?.position)deps.playerMesh.position.y=ruin.supportY-1.8*t;if(t>=1){deps.player.x=f.safe.x;deps.player.y=f.safe.y;ruin.falling=null;}return;}
    let info=positionInfo(deps.player.x,deps.player.y);if(info.blocker){deps.player.x=ruin.lastAcceptedPx.x;deps.player.y=ruin.lastAcceptedPx.y;info=positionInfo(deps.player.x,deps.player.y);} if(info.pit&&!info.support){ruin.falling={startedAt:now,x:deps.player.x,y:deps.player.y,safe:{...ruin.lastSafePx}};window.ResourceSystem?.spendFooting?.(deps.player,35,'test ruin fall');return;}
    const ny=info.support?.y??0,same=info.support?.id===ruin.supportId;if(!same&&ny-ruin.supportY>MAX_STEP_HEIGHT){deps.player.x=ruin.lastAcceptedPx.x;deps.player.y=ruin.lastAcceptedPx.y;return;} ruin.lastAcceptedPx={x:deps.player.x,y:deps.player.y};if(!info.pit||info.support)ruin.lastSafePx={...ruin.lastAcceptedPx};ruin.supportId=info.support?.id||null;ruin.supportY=ny;if(info.support&&deps.playerMesh?.position)deps.playerMesh.position.y=ny;}

  function updateMechanisms(dt){ruin.api.syncPressurePlates(ruin.localeRoot);ruin.api.tickRuntime(dt);for(const m of ruin.mechanisms.values()){const linked=m.root.userData?.linkedPressurePlateRoot||m.root.userData?.linkedCubePuzzleRoot;if(!linked)m.progress+=clamp(m.target-m.progress,-dt*1.55,dt*1.55);ruin.api.applyProgress(m.root,m.progress);}for(const a of ruin.activators){const m=ruin.mechanisms.get(a.userData?.linkedMechanismId);if(m&&!['pressurePlate','linkedCubePillars'].includes(a.userData?.activatorType))ruin.api.applyProgress(a,m.progress);}if(ruin.occupancy?.refresh())updateBadge();}
  DS.addBeforeRenderClient(()=>{if(!ruin)return;if(deps.getCurrentArea?.()!==MAP_ID)return;const now=performance.now(),dt=clamp((now-frameLastMs)/1000,0,.05);frameLastMs=now;updateMechanisms(dt);reconcilePlayer(now);});

  function updateBadge(){
    if(!ruin)return;
    let b=document.getElementById('devRandomRuinBadge'); // Used as the existing mobile-visible Random Test Ruin diagnostic badge.
    if(!b){b=document.createElement('div');b.id='devRandomRuinBadge';b.style.cssText='position:fixed;left:10px;bottom:10px;z-index:65;padding:6px 9px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(12,14,12,.82);color:#ddd;font:11px monospace;pointer-events:none';document.body.appendChild(b);}
    const occupancy=ruin.occupancy?.snapshot?.(); // Used to retain the existing red/green/blue occupancy counts in the badge.
    const roomPuzzleCounts=Object.values(ruin.puzzleGeneration?.countsByRoom||{}).map(Number); // Used to verify the configured room cap without opening devtools.
    const maxRoomPuzzles=roomPuzzleCounts.length?Math.max(...roomPuzzleCounts):0; // Used to report the busiest generated room.
    const capLabel=ruin.puzzleOptions?.maxPerRoom?String(ruin.puzzleOptions.maxPerRoom):'∞'; // Used to distinguish a finite cap from the default unlimited setting.
    const solvabilityLabel=ruin.solvability?.ok?('solvable ✓'+(ruin.generationAttempt>1?' after '+ruin.generationAttempt+' tries':'')):'solvability ?'; // Mobile-visible proof that this accepted seed passed the pre-entry audit.
    const darkness=getDarknessSettings(); // Shows whether the test-only darkness override is active without requiring desktop devtools.
    const darknessLabel=darkness.enabled?(Math.round(darkness.severity*100)+'%'):'off';
    b.textContent=MAP_ID+' · seed '+ruin.seed+' · '+(ruin.meta.rooms?.length||0)+' rooms · '+solvabilityLabel+' · puzzles '+maxRoomPuzzles+'/'+capLabel+' max-room · tiles R'+(occupancy?.blocked.length||0)+' G'+(occupancy?.causes.length||0)+' B'+(occupancy?.effects.length||0)+' · cliff '+(ruin.denMaterialMeshCount||0)+' · oldstone '+(ruin.legacyStoneMaterialCount||0)+' · unlit +'+(ruin.unlitConvertedMaterialCount||0)+'/lit '+(ruin.remainingLitMaterialCount||0)+' · combat '+(ruin.wallStyle==='cavern'?'✓':'?')+' · dark '+darknessLabel+' · rev '+(occupancy?.revision||0);
    b.style.display='';
  }
  function installSettingsButton(){
    if(!devModeEnabled())return;
    const arena=document.getElementById('devTeleportArenaBtn'); // Used as the stable Settings anchor for the Random Test Ruin controls.
    if(!arena||document.getElementById('devRandomTestRuinBtn'))return;
    const row=document.createElement('div'); // Used for the existing Generate action.
    row.className='settings-row';
    row.innerHTML='<div class="settings-label"><div class="settings-name">Random Test Ruin</div><div class="settings-desc">Generate a session-only V50 ruin as a real interior map with 2x horizontal tiles and enter it. Nothing is saved.</div></div><button type="button" id="devRandomTestRuinBtn" class="settings-small-btn">Generate</button>';
    arena.closest('.settings-row')?.insertAdjacentElement('afterend',row);
    row.querySelector('button')?.addEventListener('click',()=>generate(randomSeed()));

    const optionsRow=document.createElement('div'); // Used to host the collapsed per-generator puzzle controls directly beneath Generate.
    optionsRow.className='settings-row';
    optionsRow.style.display='block';
    const optionMarkup=PUZZLE_OPTION_ROWS.map(([key,label])=>`<label style="display:flex;align-items:center;gap:7px;min-height:28px"><input type="checkbox" data-ruin-puzzle-option="${key}"><span>${label}</span></label>`).join(''); // Used to keep the checkbox list data-driven and mobile-wrappable.
    optionsRow.innerHTML=`<details id="devRandomRuinPuzzleOptions" style="width:100%"><summary class="settings-name" style="cursor:pointer;user-select:none">Puzzle Generation</summary><div class="settings-desc" style="margin-top:4px">Simple-mode puzzle families. Projectile targets use V50's proven hit runtime; the other three are independent hazards/traversal and never lock the room graph.</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:4px 12px;margin-top:8px">${optionMarkup}</div><label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px"><span>Max projectile puzzles per room <small style="opacity:.72">(0 = unlimited)</small></span><input id="devRandomRuinMaxPuzzlesPerRoom" type="number" min="0" max="12" step="1" inputmode="numeric" style="width:74px"></label></details>`;
    row.insertAdjacentElement('afterend',optionsRow);
    bindPuzzleOptionsPanel(optionsRow.querySelector('#devRandomRuinPuzzleOptions'));

    const darknessRow=document.createElement('div'); // Test-only lighting control kept separate from puzzle-generation options.
    darknessRow.className='settings-row';
    darknessRow.innerHTML='<div class="settings-label"><div class="settings-name">Test Ruin Darkness</div><div class="settings-desc">Off by default for puzzle inspection. Enable to preview the normal den darkness; severity scales the authored darkness level.</div></div><div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px 12px"><label style="display:flex;align-items:center;gap:6px"><input id="devRandomRuinDarknessEnabled" type="checkbox"><span>Darkness</span></label><label style="display:flex;align-items:center;gap:6px"><span>Severity</span><input id="devRandomRuinDarknessSeverity" type="range" min="0" max="100" step="1" value="100" style="width:min(180px,32vw)"><output id="devRandomRuinDarknessSeverityValue">100%</output></label></div>';
    optionsRow.insertAdjacentElement('afterend',darknessRow);
    bindDarknessControls(darknessRow);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installSettingsButton,{once:true});else installSettingsButton();

  window.DevRandomRuin=Object.freeze({generate,reroll:()=>generate(randomSeed()),clear:()=>{if(deps?.getCurrentArea?.()===MAP_ID)leaveRuin();else clearRuntime(true);},leave:leaveRuin,getInteractionControls:()=>ruin?ruin.controls.map(control=>({...control,range:Number.isFinite(Number(control.range))?Number(control.range):CONTROL_RANGE})):[],getRuntimeContext:()=>ruin?{scene:ruin.scene,root:ruin.localeRoot,meta:ruin.meta,spawn:{...ruin.spawn},cols:ruin.cols,rows:ruin.rows,seed:ruin.seed,puzzleOptions:{...ruin.puzzleOptions}}:null,getOccupancySnapshot:()=>ruin?.occupancy?.snapshot?.()||null,getLastSolvabilityAudit:()=>lastGenerationAudit?JSON.parse(JSON.stringify(lastGenerationAudit)):null,getDarknessSettings,getState:()=>ruin?{mapId:MAP_ID,seed:ruin.seed,requestedSeed:ruin.requestedSeed,sourceSeed:ruin.sourceSeed,tileScale:RUIN_TILE_SCALE,wallStyle:ruin.wallStyle||null,darkness:getDarknessSettings(),materialStats:{cliffMeshes:ruin.denMaterialMeshCount||0,converted:ruin.unlitConvertedMaterialCount||0,remainingLit:ruin.remainingLitMaterialCount||0,legacyStone:ruin.legacyStoneMaterialCount||0,totalMeshes:ruin.totalRuinMeshCount||0},rooms:ruin.meta.rooms?.length||0,controls:ruin.controls.length,mechanisms:[...ruin.mechanisms.values()].map(m=>({id:m.id,type:m.type,progress:m.progress,target:m.target})),puzzleOptions:ruin.puzzleOptions,puzzleGeneration:ruin.puzzleGeneration,solvability:ruin.solvability,generationAttempt:ruin.generationAttempt,occupancy:ruin.occupancy?.snapshot?.(),dynamic:DS.debugSnapshot()}:null});
})();
