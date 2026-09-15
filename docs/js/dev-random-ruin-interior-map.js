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
  if (!DS || !DevSpawner || !GridTileAccessors || !TileOccupancy) return;

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

  let deps = null;
  let buildingScenes = null;
  let gridDeps = null;
  let ruin = null;
  let returnAnchor = null;
  let generatorFrame = null;
  let generatorApi = null;
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
  function detach(object) { if (object?.parent) object.parent.remove(object); }

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
    ruin.mechanisms = new Map(); ruin.controls = []; ruin.activators = []; ruin.pushBlocks = [];
    const walls = []; // V50 wall meshes become boundary tiles instead of broad object AABBs.
    const furnitureBlockers = []; // Solid authored objects are rasterized child-mesh by child-mesh.
    ruin.localeRoot.traverse(object => {
      const d = object.userData || {}, motion = d.previewMotion?.type;
      if (d.mechanismId && ['bridge','bridgeSequence','stoneDoor','movingDais','collapsingStairs'].includes(motion))
        ruin.mechanisms.set(d.mechanismId,{id:d.mechanismId,root:object,type:motion,progress:0,target:0});
      if (d.linkedMechanismId && d.activatorType) ruin.activators.push(object);
      if (d.pushable && motion === 'pushPuzzleBlock') ruin.pushBlocks.push(object);
      if (d.ruinInteriorWall) walls.push(object);
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
      for (const e of object.userData.rotatingSegments||[]) if (e?.segment) ruin.controls.push({kind:'linkedCube',object:e.segment,label:`Rotate Cube ${labels[e.controlIndex]||e.controlIndex+1}`,onPress:()=>ruin.api.rotateLinkedCube(object,e.controlIndex,1)});
    });
    for (const a of ruin.activators) {
      const type=a.userData.activatorType, m=ruin.mechanisms.get(a.userData.linkedMechanismId);
      if (!m || ['linkedCubePillars','pressurePlate'].includes(type)) continue;
      ruin.controls.push({kind:type,object:a,label:type==='stackedObelisk'?'Turn Obelisk':type==='brazier'?'DEV Ignite Brazier':type==='glyphObelisk'?'DEV Trigger Glyph':`Activate ${type}`,
        onPress:()=>{m.target=m.target>.5?0:1;}});
    }
    for (const block of ruin.pushBlocks) ruin.controls.push({kind:'pushBlock',object:block,label:'Push Stone Block',onPress:()=>pushBlock(block)});
    ruin.controls.push({kind:'exit',object:null,label:'Leave Test Ruin',point:ruin.spawn,onPress:leaveRuin});
    ruin.occupancy = TileOccupancy.create({
      mapId:MAP_ID, scope:SCOPE, cols:ruin.cols, rows:ruin.rows, floorSet:ruin.floorSet,
      walls, staticSolids:furnitureBlockers, mechanisms:ruin.mechanisms,
      activators:ruin.activators, pushBlocks:ruin.pushBlocks,
      getPlayerPosition:() => ({ x:deps.player.x / deps.TILE, z:deps.player.y / deps.TILE }),
    });
  }

  function pushBlock(block) {
    const p=centerFor(block), px=deps.player.x/deps.TILE, pz=deps.player.y/deps.TILE;
    const dx=p.x-px,dz=p.z-pz, localStep=localCellSize(ruin.meta), worldStep=worldCellSize(ruin.meta); let sx=0,sz=0;
    if (Math.abs(dx)>=Math.abs(dz)) sx=Math.sign(dx)||1; else sz=Math.sign(dz)||1;
    const nx=p.x+sx*worldStep,nz=p.z+sz*worldStep;
    if (!DS.sampleSupport(nx,nz,{minY:-4,maxY:5,pad:.02})) return deps.showToast?.('The block cannot be pushed there.',false);
    const hit=DS.blockerAt(nx,nz,{radius:.06,actorHeight:1,ignoreRuinSource:block.userData.__devRuinOccupancySource});
    if (hit) return deps.showToast?.('Something blocks the stone block.',false);
    // The locale root carries the 2x horizontal scale, so child transforms remain in V50's original local cell units.
    block.position.x+=sx*localStep; block.position.z+=sz*localStep; block.updateMatrixWorld?.(true); ruin.api.syncPressurePlates(ruin.localeRoot); ruin.occupancy?.refresh(); updateBadge();
  }

  function makeMapRecord(seed, generated, roots, meta) {
    const projected=floorProjection(meta), scene=new THREE.Scene();
    scene.name=MAP_ID; scene.background=new THREE.Color(0x080b09);
    const ambient=new THREE.AmbientLight(0xffffff,.62); scene.add(ambient);
    const key=new THREE.DirectionalLight(0xfff1cf,.72); key.position.set(projected.cols*.35,8,projected.rows*.3); scene.add(key);
    // Scale only the horizontal plane: V50's half-unit cell becomes one full game-world unit while floor/elevation heights stay authored.
    roots.localeRoot.scale.x*=RUIN_TILE_SCALE; roots.localeRoot.scale.z*=RUIN_TILE_SCALE;
    roots.localeRoot.position.set(PAD+scaledWorldWidth(meta)/2,0,PAD+scaledWorldDepth(meta)/2);
    roots.localeRoot.name=`dev_v50_ruin_${seed}`; scene.add(roots.localeRoot);
    roots.particleRoot.position.set(0,0,0); scene.add(roots.particleRoot);
    const spawn=spawnInsideEntrance(meta);
    const exitTile=[clamp(Math.floor(spawn.x),0,projected.cols-1),clamp(Math.floor(spawn.z),0,projected.rows-1)];
    const mapData={schema:'hobunji_building_interior.v1',id:MAP_ID,name:`Random Test Ruin #${seed}`,cols:projected.cols,rows:projected.rows,
      floor:projected.floor,colliders:[],furniture:[],vendorZones:[],exits:[{id:'exit_dev_random_ruin',label:'Leave Test Ruin',tiles:[exitTile],targetMap:'',spawnCol:0,spawnRow:0}],
      devSessionOnly:true,devSeed:seed,devRuinTileScale:RUIN_TILE_SCALE,sourceGenerator:'HobunjiDebrisifierV50'};
    return {scene,grid:projected.grid,cols:projected.cols,rows:projected.rows,mapData,floorSet:projected.walkable,exits:mapData.exits,spawn,localeRoot:roots.localeRoot,particleRoot:roots.particleRoot};
  }

  async function generate(seed=randomSeed()) {
    if (!devModeEnabled() || !deps || !buildingScenes) return false;
    const button=document.getElementById('devRandomTestRuinBtn'); if(button){button.disabled=true;button.textContent='Generating…';}
    try {
      if (deps.getCurrentArea?.() !== MAP_ID) returnAnchor={area:deps.getCurrentArea?.(),x:deps.player.x,y:deps.player.y};
      clearRuntime(false);
      const api=await ensureGeneratorFrame();
      const generated=await api.generateInteriorLocale({seed:`dev-${seed.toString(36)}`,size:'medium',density:62,roomMin:3,roomMax:6});
      const meta=generated.locale?.meta?.interiorShell; if(!meta) throw new Error('V50 generated no interiorShell metadata.');
      api.snapMechanismState(0); api.pausePreviewLoop(); const roots=api.takePreviewRoots();
      const rec=makeMapRecord(seed,generated,roots,meta); buildingScenes.set(MAP_ID,rec);
      ruin={seed,sourceSeed:generated.seed,api,locale:generated.locale,meta,...rec,mechanisms:new Map(),controls:[],activators:[],pushBlocks:[],supportId:null,supportY:0,falling:null};
      registerFloor(meta); discoverRuntimeObjects();
      await enterRuin(); updateBadge();
      deps.showToast?.(`Entered Random Test Ruin #${seed} as ${MAP_ID}.`,true);
      return true;
    } catch(error) { console.error('[Random Test Ruin interior]',error); deps.showToast?.(`Random Test Ruin failed: ${error.message}`,false); clearRuntime(true); return false; }
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
  function reconcilePlayer(now){if(ruin.falling){const f=ruin.falling,t=clamp((now-f.startedAt)/FALL_MS,0,1);deps.player.x=f.x;deps.player.y=f.y;if(deps.playerMesh?.position)deps.playerMesh.position.y=ruin.supportY-1.8*t;if(t>=1){deps.player.x=f.safe.x;deps.player.y=f.safe.y;ruin.falling=null;}return;}
    let info=positionInfo(deps.player.x,deps.player.y);if(info.blocker){deps.player.x=ruin.lastAcceptedPx.x;deps.player.y=ruin.lastAcceptedPx.y;info=positionInfo(deps.player.x,deps.player.y);} if(info.pit&&!info.support){ruin.falling={startedAt:now,x:deps.player.x,y:deps.player.y,safe:{...ruin.lastSafePx}};window.ResourceSystem?.spendFooting?.(deps.player,35,'test ruin fall');return;}
    const ny=info.support?.y??0,same=info.support?.id===ruin.supportId;if(!same&&ny-ruin.supportY>MAX_STEP_HEIGHT){deps.player.x=ruin.lastAcceptedPx.x;deps.player.y=ruin.lastAcceptedPx.y;return;} ruin.lastAcceptedPx={x:deps.player.x,y:deps.player.y};if(!info.pit||info.support)ruin.lastSafePx={...ruin.lastAcceptedPx};ruin.supportId=info.support?.id||null;ruin.supportY=ny;if(info.support&&deps.playerMesh?.position)deps.playerMesh.position.y=ny;}

  function updateMechanisms(dt){ruin.api.syncPressurePlates(ruin.localeRoot);ruin.api.tickRuntime(dt);for(const m of ruin.mechanisms.values()){const linked=m.root.userData?.linkedPressurePlateRoot||m.root.userData?.linkedCubePuzzleRoot;if(!linked)m.progress+=clamp(m.target-m.progress,-dt*1.55,dt*1.55);ruin.api.applyProgress(m.root,m.progress);}for(const a of ruin.activators){const m=ruin.mechanisms.get(a.userData?.linkedMechanismId);if(m&&!['pressurePlate','linkedCubePillars'].includes(a.userData?.activatorType))ruin.api.applyProgress(a,m.progress);}if(ruin.occupancy?.refresh())updateBadge();}
  DS.addBeforeRenderClient(()=>{if(!ruin)return;if(deps.getCurrentArea?.()!==MAP_ID)return;const now=performance.now(),dt=clamp((now-frameLastMs)/1000,0,.05);frameLastMs=now;updateMechanisms(dt);reconcilePlayer(now);});

  function updateBadge(){if(!ruin)return;let b=document.getElementById('devRandomRuinBadge');if(!b){b=document.createElement('div');b.id='devRandomRuinBadge';b.style.cssText='position:fixed;left:10px;bottom:10px;z-index:65;padding:6px 9px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(12,14,12,.82);color:#ddd;font:11px monospace;pointer-events:none';document.body.appendChild(b);}const occupancy=ruin.occupancy?.snapshot?.();b.textContent=`${MAP_ID} · seed ${ruin.seed} · ${ruin.meta.rooms?.length||0} rooms · tiles R${occupancy?.blocked.length||0} G${occupancy?.causes.length||0} B${occupancy?.effects.length||0} · rev ${occupancy?.revision||0}`;b.style.display='';}
  function installSettingsButton(){if(!devModeEnabled())return;const arena=document.getElementById('devTeleportArenaBtn');if(!arena||document.getElementById('devRandomTestRuinBtn'))return;const row=document.createElement('div');row.className='settings-row';row.innerHTML='<div class="settings-label"><div class="settings-name">Random Test Ruin</div><div class="settings-desc">Generate a session-only V50 ruin as a real interior map with 2x horizontal tiles and enter it. Nothing is saved.</div></div><button type="button" id="devRandomTestRuinBtn" class="settings-small-btn">Generate</button>';arena.closest('.settings-row')?.insertAdjacentElement('afterend',row);row.querySelector('button')?.addEventListener('click',()=>generate(randomSeed()));}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installSettingsButton,{once:true});else installSettingsButton();

  window.DevRandomRuin=Object.freeze({generate,reroll:()=>generate(randomSeed()),clear:()=>{if(deps?.getCurrentArea?.()===MAP_ID)leaveRuin();else clearRuntime(true);},leave:leaveRuin,getInteractionControls:()=>ruin?ruin.controls.map(control=>({...control,range:CONTROL_RANGE})):[],getOccupancySnapshot:()=>ruin?.occupancy?.snapshot?.()||null,getState:()=>ruin?{mapId:MAP_ID,seed:ruin.seed,sourceSeed:ruin.sourceSeed,tileScale:RUIN_TILE_SCALE,rooms:ruin.meta.rooms?.length||0,controls:ruin.controls.length,mechanisms:[...ruin.mechanisms.values()].map(m=>({id:m.id,type:m.type,progress:m.progress,target:m.target})),occupancy:ruin.occupancy?.snapshot?.(),dynamic:DS.debugSnapshot()}:null});
})();
