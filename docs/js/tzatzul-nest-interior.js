// High-altitude Tzatzul roosts reuse CavernGenerator's existing cave shell,
// CaveSiteSystem's interior-prop hook, and the normal world action/loot tables.
// The future puzzle-cave pool is referenced but intentionally has no invented contents.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TzatzulNestInterior = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const EGG = 'tzatzulEggs'; // Nonfertile cooking ingredient; no incubator/livestock classification.
  const PUZZLE_CAVE_POOL = 'puzzleCave'; // Reserved for a future authored puzzle-cave loot table, not populated here.
  const EXISTING_POOLS = Object.freeze(['crateJunk', 'treasureChest']); // Canonical crate/chest pool ids in loot-pools.json.
  const INTERACT_RADIUS = 1.35; // World-action targeting distance, in tile units.
  const plans = new Map(); // Cave map id -> immutable-in-practice deterministic eggs/corpses/hatchlings.
  const nests = new Map(); // Cave map id -> exterior spire/zone anchor, including return spawn.
  const progress = new Map(); // Map id -> claimed egg/body IDs, serialized through CaveSiteSystem's world save.
  const visualRecords = new Map(); // Map id -> {scene, eggs, bodies}, reused across cached building visits.
  const hatchlingResidents = new Map(); // Map id -> live native creature references, never spawned twice per entry.
  const pendingPrey = new Map(); // Map id -> delivered NPC/animal metadata for new corpse piles on first entrance.
  const debug = { decorated: 0, generated: 0, eggsPicked: 0, victimsLooted: 0, visitors: 0, lastError: null, lastEvent: null };
  let wildlifeDeps = null; // Shared native wildlife/health/zone/inventory dependencies from WildlifeSpawn.init.
  let rewards = null; // Canonical DevSpawner grantLoot injects inventory and gold without duplicating mutations.
  let lastClaimKey = ''; // Only re-register world input claims on a nearby target change.
  let registeredItem = false; // ShippingPanel receives the egg's ordinary definition/price exactly once.

  const randHash = text => {
    let h = 2166136261 >>> 0;
    for (const char of String(text)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  function rngFor(text) {
    let h = randHash(text) || 1;
    return () => {
      h = (h + 0x6D2B79F5) >>> 0;
      let t = Math.imul(h ^ h >>> 15, h | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function isNestMap(mapId) {
    return nests.has(String(mapId)) || /^map_i_den_.+_tzatzul-\d+-\d+$/.test(String(mapId || ''));
  }
  function registerSpire(zoneId, spire) {
    if (!spire?.nest?.caveMapId || !zoneId) return null;
    const key = String(spire.nest.caveMapId);
    nests.set(key, { spire, zoneId: String(zoneId), mapId: key });
    return key;
  }
  function initWildlife(injectedDeps) { wildlifeDeps = injectedDeps; }
  function initRewards(injectedDeps) { rewards = injectedDeps; ensureItemRegistered(); }
  function ensureItemRegistered() {
    if (registeredItem) return true;
    registeredItem = !!root.ShippingPanel?.registerItemDefinitions?.({
      [EGG]: { key: EGG, label: 'Tzatzul Egg', icon: '🥚', cat: 'ingredient', sellPrice: 4800 },
    }, { [EGG]: 4800 });
    return registeredItem;
  }
  function claimed(mapId) {
    const id = String(mapId);
    if (!progress.has(id)) progress.set(id, { eggs: [], victims: [] });
    return progress.get(id);
  }
  function makePlan(mapId, mapData) {
    const floor = (mapData.floor || []).map(([col,row]) => ({ col,row }));
    const rng = rngFor('tzatzul-roost:' + mapId);
    const exitC = Number(mapData.exitCol) || 0, exitR = Number(mapData.exitRow) || 0;
    const candidates = floor.filter(tile => Math.hypot(tile.col-exitC,tile.row-exitR) > 6);
    const spaced = (count, minDistance, reserved = []) => {
      const selected = [];
      for (let attempt = 0; attempt < candidates.length * 4 && selected.length < count; attempt++) {
        if (!candidates.length) break;
        const tile = candidates[Math.floor(rng() * candidates.length)];
        if ([...selected,...reserved].some(item => Math.hypot(item.col-tile.col,item.row-tile.row) < minDistance)) continue;
        selected.push(tile);
      }
      return selected;
    };
    const eggSites = spaced(2 + Math.floor(rng()*3), 2.0);
    const pileCenters = spaced(1 + Math.floor(rng() * 2), 3.4, eggSites); // A few dense victim heaps rather than corpses scattered singly around the cave.
    const bodies = pileCenters.flatMap((center,group) => Array.from({length:3+Math.floor(rng()*3)}, (_,i)=>({
      col:center.col+(rng()-.5)*1.5,row:center.row+(rng()-.5)*1.5,
      stack:i, pile:group,
    })));
    const hatchlings = spaced(2 + Math.floor(rng()*2), 2.0, bodies);
    return {
      mapId, eggSites: eggSites.map((site,i)=>({ ...site, id:'egg-'+i })),
      bodies: bodies.map((site,i)=>({ ...site,id:'victim-'+i, yaw:rng()*Math.PI*2, stack: Math.floor(rng()*3) })),
      hatchlings: hatchlings.map((site,i)=>({ ...site,id:'hatchling-'+i })),
      lootPools: [...EXISTING_POOLS, PUZZLE_CAVE_POOL],
    };
  }
  function decorateMapData(mapId, mapData) {
    if (!isNestMap(mapId) || !mapData) return mapData;
    const id = String(mapId), nest = nests.get(id);
    const plan = makePlan(id, mapData);
    plans.set(id, plan);
    mapData.name = 'Tzatzul Roost';
    mapData.denMotherKind = null; // The nest is guarded by hatchlings, NOT an arbitrary wild Den-Mother.
    mapData.denMotherDefeated = true;
    mapData.nestCol = null; mapData.nestRow = null; mapData.nestState = null;
    mapData.creatureSpawns = []; // Native cave population is replaced by actual perched hatchlings on entry.
    mapData.tzatzulNest = { eggs: plan.eggSites, hatchlings: plan.hatchlings,
      victimPile: plan.bodies, lootPools: plan.lootPools };
    if (nest && mapData.exits?.length) {
      const exit = mapData.exits[0]; // Reuse the original carved cave exit, returning safely at the spire foot.
      exit.targetMap = nest.zoneId;
      exit.targetMapId = nest.zoneId;
      exit.spawnCol = Math.floor(nest.spire.x);
      exit.spawnRow = Math.floor(nest.spire.z);
      exit.label = 'Descend from the roost';
    }
    debug.decorated++;
    return mapData;
  }
  function addBlob(THREE, group, x, y, z, sx, sy, sz, color) {
    const material = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), material);
    mesh.position.set(x,y,z);
    mesh.scale.set(sx,sy,sz);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  function renderHeadlessBody(THREE, corpse) {
    const group = new THREE.Group();
    const dark = 0x352e2a, cloth = 0x514338; // Worn fabric and exposed skin, no head geometry by design.
    // Torso/arms/legs follow the collapsed, sideways Headtaker victim pose:
    // the neck terminates at the shoulders; there is no attached cranium.
    addBlob(THREE,group,0,0.16,0,0.28,0.15,0.47,cloth);
    addBlob(THREE,group,-.34,.11,-.05,.11,.09,.33,dark);
    addBlob(THREE,group,.34,.10,.03,.11,.08,.34,dark);
    addBlob(THREE,group,-.14,.07,.52,.13,.075,.37,dark);
    addBlob(THREE,group,.17,.08,.53,.13,.075,.37,dark);
    group.rotation.y = corpse.yaw;
    group.position.set(corpse.col+.5, corpse.stack*.14, corpse.row+.5);
    group.name = 'tzatzul_headless_victim_' + corpse.id;
    group.userData.tzatzulHeadlessCorpse = true;
    return group;
  }
  function renderEgg(THREE, egg) {
    const group = new THREE.Group();
    addBlob(THREE,group,0,.32,0,.33,.39,.30,0xefe5c8);
    addBlob(THREE,group,-.1,.54,.1,.055,.045,.045,0x9b8168);
    addBlob(THREE,group,.13,.34,-.15,.04,.055,.045,0xb39f7c);
    group.position.set(egg.col+.5,0,egg.row+.5);
    group.name='tzatzul_nonfertile_egg_'+egg.id;
    group.userData.tzatzulEgg = egg.id;
    return group;
  }
  function buildInteriorProps(mapId, mapData, scene) {
    const id=String(mapId);
    if (!isNestMap(id) || !scene || !root.THREE) return false;
    if (visualRecords.get(id)?.scene === scene) return true;
    const plan=plans.get(id) || makePlan(id,mapData);
    plans.set(id,plan);
    const THREE = root.THREE, eggs=new Map(), bodies=new Map();
    const state=claimed(id);
    for(const egg of plan.eggSites) {
      const mesh=renderEgg(THREE,egg);
      if(state.eggs.includes(egg.id))mesh.visible=false;
      scene.add(mesh);
      eggs.set(egg.id,mesh);
    }
    for(const body of plan.bodies) {
      const mesh=renderHeadlessBody(THREE,body);
      scene.add(mesh);
      bodies.set(body.id,mesh);
    }
    visualRecords.set(id,{scene,eggs,bodies});
    debug.generated++;
    return true;
  }
  function directGrant(gained) {
    if (!rewards?.grantLoot) return false;
    const entries=Object.entries(gained).filter(([,qty])=>Number(qty)>0);
    if(!entries.length) return false;
    rewards.grantLoot(gained);
    return true;
  }
  function rewardEgg(mapId, id) {
    ensureItemRegistered();
    const state=claimed(mapId), plan=plans.get(mapId);
    if(state.eggs.includes(id) || !plan?.eggSites.some(egg=>egg.id===id))return false;
    if(!ensureItemRegistered() || !directGrant({[EGG]:1}))return false; // Never consume a finite treasure if inventory grant is unavailable.
    state.eggs.push(id);
    const mesh=visualRecords.get(mapId)?.eggs.get(id);
    if(mesh)mesh.visible=false;
    debug.eggsPicked++;
    root.CaveSiteSystem?.persistAuxiliaryState?.();
    wildlifeDeps?.showToast?.('Collected a valuable nonfertile Tzatzul egg.',true);
    return true;
  }
  function rolledCorpseLoot(mapId) {
    const out={};
    for(const poolId of EXISTING_POOLS) {
      const roll=root.LootRolling?.rollLootPool?.(poolId,{zoneId:nests.get(mapId)?.zoneId}) || {};
      for(const [item,qty] of Object.entries(roll))out[item]=(out[item]||0)+qty;
    }
    // Add puzzle-cave rewards if/when the actual authored pool exists; until
    // then this reference is inert, never a fabricated item table.
    if(root.LootRolling?.getLootPools?.()?.[PUZZLE_CAVE_POOL]) {
      const roll=root.LootRolling.rollLootPool(PUZZLE_CAVE_POOL,{zoneId:nests.get(mapId)?.zoneId}) || {};
      for(const [item,qty] of Object.entries(roll))out[item]=(out[item]||0)+qty;
    }
    return out;
  }
  function lootVictim(mapId,id) {
    const state=claimed(mapId),plan=plans.get(mapId);
    if(state.victims.includes(id)||!plan?.bodies.some(body=>body.id===id))return false;
    const items=rolledCorpseLoot(mapId);
    if(!directGrant(items))return false;
    state.victims.push(id);
    debug.victimsLooted++;
    root.CaveSiteSystem?.persistAuxiliaryState?.();
    wildlifeDeps?.showToast?.('Searched a headless victim: recovered provisions and treasure.',true);
    return true;
  }
  function nearestAction(mapId) {
    const player=wildlifeDeps?.player,plan=plans.get(mapId);
    if(!player || !plan)return null;
    const T=Number(wildlifeDeps.TILE)||32, x=player.x/T,z=player.y/T;
    const claimedIds=claimed(mapId);
    let nearest=null, distance=INTERACT_RADIUS;
    for(const egg of plan.eggSites) {
      if(claimedIds.eggs.includes(egg.id))continue;
      const dist=Math.hypot(egg.col+.5-x,egg.row+.5-z);
      if(dist<distance){distance=dist;nearest={type:'egg',id:egg.id,label:'Collect Tzatzul egg'};}
    }
    for(const body of plan.bodies){
      if(claimedIds.victims.includes(body.id))continue;
      const dist=Math.hypot(body.col+.5-x,body.row+.5-z);
      if(dist<distance){distance=dist;nearest={type:'victim',id:body.id,label:'Search headless victim'};}
    }
    return nearest;
  }
  function ensureHatchlings(mapId) {
    if(hatchlingResidents.has(mapId)||!wildlifeDeps?.makeCreatureEntity)return;
    const plan=plans.get(mapId);
    if(!plan)return;
    const T=Number(wildlifeDeps.TILE)||32;
    const entities=[];
    for(const child of plan.hatchlings) {
      const c=wildlifeDeps.makeCreatureEntity('tzatzul-hatchling',(child.col+.5)*T,(child.row+.5)*T,{
        areaId:mapId,homeX:(child.col+.5)*T,homeY:(child.row+.5)*T,
        state:'idle',streamVisuals:false,wildlifeRole:'predator',tzatzulHatchling:true,
      });
      if(!c)continue;
      c._tzatzulHatchling=true;
      c.areaId=mapId;
      wildlifeDeps.hostileObjects?.add?.(c);
      entities.push(c);
    }
    hatchlingResidents.set(mapId,entities);
  }
  function update(dt=0) {
    const mapId=String(wildlifeDeps?.getCurrentArea?.()||'');
    if(!isNestMap(mapId)||!plans.has(mapId)){
      if(lastClaimKey){root.WorldActionInputClaims?.clearClaims?.('tzatzul-nest');lastClaimKey='';}
      return false;
    }
    ensureItemRegistered();
    ensureHatchlings(mapId);
    const action=nearestAction(mapId);
    const identity=action?mapId+':'+action.type+':'+action.id:'';
    if(identity !== lastClaimKey){
      lastClaimKey=identity;
      if(action){
        root.WorldActionInputClaims?.setClaims?.('tzatzul-nest',[{
          actionId:'interact',priority:175,label:action.label,
          onPress:() => action.type==='egg'?rewardEgg(mapId,action.id):lootVictim(mapId,action.id),
        }]);
      }else root.WorldActionInputClaims?.clearClaims?.('tzatzul-nest');
    }
    return true;
  }
  function deliverPrey(spire,target) {
    if(!spire?.nest?.caveMapId||!target)return false;
    const mapId=spire.nest.caveMapId;
    const pile=pendingPrey.get(mapId)||[];
    pile.push({species:target.speciesId||target.kind||target.creatureKey||target.def?.label||'unknown',
      humanoid:!!(target.isBandit||target.isTribeHunter||target.isPorakanekiHunter||target.isBarbarian||target.isNpcWalker)});
    pendingPrey.set(mapId,pile);
    debug.lastEvent='Tzatzul delivered prey to '+mapId;
    // A transported victim is NOT duplicated/deleted by changing its origin-area
    // identity here; native Health/death and persistence remain authoritative.
    return true;
  }
  function serialize() {
    return Object.fromEntries([...progress.entries()].map(([id,value])=>[id,{
      eggs:[...value.eggs],victims:[...value.victims],
    }]));
  }
  function restore(data) {
    progress.clear();
    for(const [id,saved] of Object.entries(data||{}))if(isNestMap(id))progress.set(id,{
      eggs:Array.isArray(saved?.eggs)?saved.eggs.filter(x=>typeof x==='string'):[],
      victims:Array.isArray(saved?.victims)?saved.victims.filter(x=>typeof x==='string'):[],
    });
    for(const [id,visual] of visualRecords)for(const [eggId,mesh] of visual.eggs)mesh.visible=!claimed(id).eggs.includes(eggId);
  }
  function placePlayerInScene(toScene,deps) {
    if(!toScene)return;
    for(const part of [deps.playerMesh,deps.playerGroundShadow,deps.toolHolder,
      deps.reticleMesh,deps.reticleCircleMesh,deps.reticleRingMesh,deps.reticleWavyGroup]) {
      if(part)toScene.add(part);
    }
  }
  async function enter(spire, transitionDeps, pathfindingDeps) {
    const mapId=spire?.nest?.caveMapId, zone=spire?.area;
    if(!mapId||!transitionDeps?.startSceneTransition||!pathfindingDeps?.loadBuildingScene)return false;
    registerSpire(zone,spire);
    try{
      await pathfindingDeps.loadBuildingScene(mapId); // Existing building loader generates shell, hatchlings and reward props.
      const info=pathfindingDeps.buildingScenes?.get?.(mapId);
      if(!info?.scene)throw new Error('Tzatzul cavern scene was not available after loadBuildingScene');
      const data=info.mapData||info.data||{};
      const floorX=Number(data.exitCol ?? info.exitCol ?? 8);
      const floorZ=Number(data.exitRow ?? info.exitRow ?? 8);
      transitionDeps.startSceneTransition(()=>{
        const from=transitionDeps.getActiveScene?.();
        const rootParts=[transitionDeps.playerMesh,transitionDeps.playerGroundShadow,transitionDeps.toolHolder,
          transitionDeps.reticleMesh,transitionDeps.reticleCircleMesh,transitionDeps.reticleRingMesh,transitionDeps.reticleWavyGroup];
        for(const part of rootParts)if(part)from?.remove(part);
        transitionDeps.setCurrentBuildingMapId(mapId);
        transitionDeps.setCurrentArea(mapId);
        transitionDeps.player.x=(floorX+.5)*(transitionDeps.TILE||32);
        transitionDeps.player.y=(floorZ+.5)*(transitionDeps.TILE||32);
        transitionDeps.player.vx=0;transitionDeps.player.vy=0;
        transitionDeps._snapCameraTarget?.();
        placePlayerInScene(info.scene,transitionDeps);
        transitionDeps.refreshActionBar?.();
      });
      debug.visitors++;
      wildlifeDeps?.showToast?.('You arrive inside the Tzatzul roost.',true);
      return true;
    }catch(error){
      debug.lastError=String(error?.message||error);
      wildlifeDeps?.showToast?.('The cliff nest entrance is not ready: '+debug.lastError,false);
      root.__farmLog?.('[tzatzul] cave entry: '+debug.lastError,'warn');
      return false;
    }
  }
  function debugSnapshot(){
    return {...debug,eggKey:EGG,puzzlePoolReference:PUZZLE_CAVE_POOL,
      nests:[...nests.values()].map(n=>({mapId:n.mapId,zone:n.zoneId,eggsClaimed:claimed(n.mapId).eggs.length,
        victimsSearched:claimed(n.mapId).victims.length,hatchlings:hatchlingResidents.get(n.mapId)?.length||0}))};
  }
  return Object.freeze({
    EGG,PUZZLE_CAVE_POOL,EXISTING_POOLS,isNestMap,registerSpire,initWildlife,initRewards,
    ensureItemRegistered,makePlan,decorateMapData,buildInteriorProps,rewardEgg,lootVictim,
    rolledCorpseLoot,update,deliverPrey,enter,serialize,restore,debugSnapshot,
  });
});
