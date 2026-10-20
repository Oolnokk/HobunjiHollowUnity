// Shattercasks: physical two-necked explosive pottery. Authored mesh is in
// config/furniture-authored/shattercaskBlasting.json; effects reuse Hronal's
// single-draw-call instanced shrapnel simulation with a white (not fiery) flash.
(() => {
  'use strict';
  const RADIUS = 5; // Blast radius in logical tiles; also bounds environmental work to at most 121 cells.
  const DAMAGE = 34; // Direct blast damage before armor; existing resource afflictions represent flying shards and shock.
  const DEBRIS_COUNT = 72; // One instanced draw call for pottery shards.
  const POLL_S = .14; // Limits interaction/area scans on mobile.
  const records = new Map(); // Area -> {scene, vases:Map, piles:Map}, reused until its rendered scene is destroyed.
  const burstEffects = []; // Short-lived instanced pottery shards and flashes ticked by Combat.update.
  let sharedBurstArt = null; // Source textures/materials/geometries cached across all explosions to avoid GPU uploads during combat.
  let sharedPileArt = null; // Rock/wood pile geometry and material shared by per-area instanced render batches.
  const spawnPromises = new Set(); // Suppresses duplicate async furniture loads per area.
  let devArenaSpawnSerial = 0; // Explicit arena-only spawns; never part of static procedural placements.
  let devArenaSpawnPending = false; // Avoid overlapping model loads and accidental repeated taps.
  const placementCache = new Map(); // Area -> per-scene static placements; never regenerate the ruin's sorted occupancy on each frame.
  let resolvedWorldId = null; // World ID memoized after authoritative save metadata first becomes available.
  let ruinSnapshotReads = 0; // Diagnostic count confirms that expensive ruin occupancy is sampled once per scene.
  let textureBatchesCreated = 0; // Diagnostic count of GPU-backed instanced debris effects allocated since boot.
  const persisted = new Set(); // Already shattered/looted IDs, saved per player world.
  const terrainHistory = new Map(); // Area -> Map(tile -> original resource kind), preserves blasted openings on reload.
  const pileHistory = new Map(); // Area -> Map(pile id -> unlooted debris), restores one-input collectible piles.
  const lastEquipment = { weapon:null, tool:null, item:null }; // Pickup-time equipment snapshot used to drop carried vases on selection changes.
  let held = null; // The one intact vase held in front of the local player.
  let audioDeps = null; // Captured DevSpawner.grantLoot so rubble uses ordinary inventory/loot handling.
  let elapsed = 0, lastArea = '', lastEvent = 'not started';
  let promptRoot = null; // Same WorldPopupText prompts as other world interactions.
  let promptClaim = ''; // Stable current input claim; avoids rewriting global input policy every 140ms.
  let storeIdentity = null; // Per-world persistence partition; regenerated sites have distinct vase IDs.
  const THREE = window.THREE;
  if (!THREE) return;
  const emitterFrustum = THREE.Frustum && new THREE.Frustum();
  const emitterMatrix = THREE.Matrix4 && new THREE.Matrix4();
  const emitterSphere = THREE.Sphere && THREE.Vector3 && new THREE.Sphere(new THREE.Vector3(),1);
  const carriedWorldPosition = THREE.Vector3 && new THREE.Vector3();
  const heldAnchorOffset = THREE.Vector3 && new THREE.Vector3();
  const heldAnchorQuat = THREE.Quaternion && new THREE.Quaternion();
  const heldAnchorEuler = THREE.Euler && new THREE.Euler();
  let emitterVisibilityElapsed = 0; // Cull only on the 140ms poll cadence, not every frame.

  function deps() { return window.Combat?.deps; }
  function area() { return String(deps()?.getCurrentArea?.() || window.GridTileAccessors?.getCurrentArea?.() || ''); }
  function scene() { return window.GridTileAccessors?.getActiveScene?.() || deps()?.getActiveScene?.(); }
  function grid() { return window.GridTileAccessors?.getActiveGrid?.(); }
  function tileSize() { return Number(deps()?.TILE) || 64; }
  function key(c,r) { return c+','+r; }
  function distance(a,b) { return Math.hypot(a.x-b.x,a.z-b.z); }
  function playerPosition() {
    const p=deps()?.player, t=tileSize();
    return p ? {x:p.x/t,z:p.y/t,angle:Number(p.angle ?? p.facing)||0} : null;
  }
  function worldId() {
    if (!resolvedWorldId) {
      const profileId=window.__hobunjiPlayerProfile?.worldId;
      // FarmWorldSettings resolves the same selected-world id as the game's save system;
      // unlike __hobunjiPlayerProfile it is present on ordinary production saves.
      const selected=profileId || window.FarmWorldSettings?.read?.()?.world?.id;
      if (selected) resolvedWorldId=String(selected);
    }
    const id=resolvedWorldId || 'session';
    let cycle='1'; // A Tothal Shift regenerates cave partitions and loose charges.
    try{cycle=String(window.CalendarSystem?.tothalCycle?.()||1);}catch(_){/* Calendar may not be initialized during boot. */}
    return id+'|'+cycle;
  }
  function loadPersistence() {
    const identity=worldId();
    if (storeIdentity===identity) return;
    storeIdentity=identity;persisted.clear();terrainHistory.clear();pileHistory.clear();records.clear();placementCache.clear();
    held=null; // A different world must never inherit another world's held charge.
    promptClaim='';
    if (identity.startsWith('session|')) return;
    try {
      for(const id of JSON.parse(localStorage.getItem('hobunji.shattercasks.v1:'+identity)||'[]')) persisted.add(id);
      const savedTerrain=JSON.parse(localStorage.getItem('hobunji.shattercasks.terrain.v1:'+identity)||'{}');
      for(const [area,tiles] of Object.entries(savedTerrain))terrainHistory.set(area,new Map(Object.entries(tiles)));
      const savedPiles=JSON.parse(localStorage.getItem('hobunji.shattercasks.piles.v1:'+identity)||'{}');
      for(const [area,piles] of Object.entries(savedPiles))pileHistory.set(area,new Map(Object.entries(piles)));
    }catch(error){window.__farmLog?.('[shattercask] partial persistence recovery: '+error.message,'warn');}
  }
  function persistWorld() {
    if(!storeIdentity || storeIdentity.startsWith('session|'))return;
    try{
      localStorage.setItem('hobunji.shattercasks.v1:'+storeIdentity,JSON.stringify([...persisted]));
      localStorage.setItem('hobunji.shattercasks.terrain.v1:'+storeIdentity,
        JSON.stringify(Object.fromEntries([...terrainHistory].map(([area,tiles])=>[area,Object.fromEntries(tiles)]))));
      localStorage.setItem('hobunji.shattercasks.piles.v1:'+storeIdentity,
        JSON.stringify(Object.fromEntries([...pileHistory].map(([area,piles])=>[area,Object.fromEntries(piles)]))));
    }catch(error){window.__farmLog?.('[shattercask] failed to persist blast/loot history: '+error.message,'warn');}
  }
  function saveConsumed(id) {
    loadPersistence();persisted.add(id);persistWorld();
  }
  function recordFor(mapId, targetScene) {
    const existing=records.get(mapId);
    if(existing?.scene===targetScene)return existing;
    placementCache.delete(mapId); // Generated geometry changed; only then may the expensive placements be sampled again.
    const rec={scene:targetScene,vases:new Map(),piles:new Map(),pileVisuals:new Map()}; // At most two debris draw calls per area, no matter how many tiles blast.
    records.set(mapId,rec);
    restoreSceneHistory(mapId,rec); // Scene reconstruction must retain both opened cave barriers and unlooted rubble.
    return rec;
  }
  function validTile(g,c,r) {
    const t=g?.[r]?.[c], type=String(t?.type||'').toLowerCase();
    return !!t && type!=='rock' && type!=='tree' && type!=='river' && type!=='stream'
      && type!=='water' && !t.caveSeparator && !t.building;
  }
  function nearestOpen(g,col,row,radius=3) {
    let best=null,bestSq=Infinity;
    for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++) {
      const x=col+dx,z=row+dz,d=dx*dx+dz*dz;
      if(d>=bestSq || !validTile(g,x,z))continue;
      best={col:x,row:z}; bestSq=d;
    }
    return best;
  }
  function eligiblePlacements(mapId,g,targetScene) {
    let cached=placementCache.get(mapId);
    if(cached?.scene!==targetScene) {
      cached={scene:targetScene,static:[],ready:false};
      placementCache.set(mapId,cached);
    }
    // Camps are dynamic: new camps may be generated after the zone scene loads.
    const result=[];
    if(!cached.ready) {
      const cave=window.CaveSiteSystem?.__test?.plansByMapId?.get?.(mapId);
      if(cave)for(const entry of cave.shattercasks||[]) cached.static.push({
        id:entry.id+'_'+entry.col+'_'+entry.row,col:entry.col,row:entry.row
      });
    const camps=window.BanditCamps?.campInstances?.get?.(mapId)||[];
    camps.forEach((camp,index)=>{
      const x=Math.floor(Number(camp.homeX)/tileSize()),z=Math.floor(Number(camp.homeY)/tileSize());
      const spot=nearestOpen(g,x,z,4);
      if(spot)result.push({id:'bandit_'+(camp.discoveryKey||index),...spot});
    });
      // Generated ruin occupancy sorts every floor cell when snapshotted:
      // sample it once per generated scene, never once every 140ms.
      if(mapId==='map_i_dev_random_ruin') {
        ruinSnapshotReads++; // Visible on mobile without devtools; should remain constant while one ruin scene is active.
        const snapshot=window.DevRandomRuinTileOccupancy?.getSnapshot?.();
        const floor=Array.isArray(snapshot?.floor)?snapshot.floor:[];
        if(floor.length) {
          for(let i=0;i<Math.min(2,Math.floor(floor.length/24));i++) {
            const value=floor[Math.floor((i+.3)*floor.length/2)];
            const pair=Array.isArray(value)?value:String(value).split(',').map(Number);
            const spot=nearestOpen(g,Number(pair[0]),Number(pair[1]),2);
            if(spot)cached.static.push({id:'ruin_'+i,...spot});
          }
        } else return result; // Ruin still building; retry once layout is available.
      }
      if(mapId.startsWith('map_i_town_mine_f_')) {
        const p=playerPosition();
        if(p) {
          const spot=nearestOpen(g,Math.floor(p.x)+6,Math.floor(p.z)+3,5);
          if(spot)cached.static.push({id:'mine_charge',...spot});
        }
      }
      cached.ready=true;
    }
    result.push(...cached.static);
    return result;
  }
  // Authoring-space bounds, computed once per vase. Enlarged around tilted
  // necks rather than assuming an arbitrary .37-radius cylinder.
  function authoredBounds(data) {
    const b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
    for(const part of data.parts||[]){
      const t=part.transform||{},w=Math.hypot(
        (Number(t.sx)||.001)*Math.max(1,part.topScaleX||0,part.bottomScaleX||0)/2,
        (Number(t.sy)||.001)/2,
        (Number(t.sz)||.001)*Math.max(1,part.topScaleZ||0,part.bottomScaleZ||0)/2);
      for(const [axis,center] of [['X',t.x],['Y',t.y],['Z',t.z]]){
        const c=Number(center)||0;
        b['min'+axis]=Math.min(b['min'+axis],c-w);
        b['max'+axis]=Math.max(b['max'+axis],c+w);
      }
    }
    return Number.isFinite(b.minX)?b:{minX:-.4,maxX:.4,minY:0,maxY:1,minZ:-.4,maxZ:.4};
  }
  function disposeEmitters(vase) {
    for(const fx of vase.emitters||[])fx.dispose?.();
    vase.emitters=null;
  }
  function carryDeps() { return window.ProceduralHandAttachments?.gameDeps || deps() || {}; }
  function heldItemHolder(){
    const d=carryDeps();
    return d?.getHeldItemHandTarget?.()?.holder
      ||d?.playerMesh?.children?.find(o=>o?.type==='Group'&&o.userData?.isPngPlane&&!String(o.name||'').trim())||null;
  }
  function alignHeldVase(vase) {
    const body=carryDeps()?.playerMesh,holder=heldItemHolder();
    if(!body||!holder||!heldAnchorQuat||!heldAnchorOffset||!vase?.group?.quaternion)return false;
    if(vase.group.parent!==body)body.add(vase.group);
    const cfg=vase.data?.carryable?.billboardAnchor||{},a=cfg.position||{},r=cfg.rotation||{};
    heldAnchorEuler.set((Number(r.x)||0)*Math.PI/180,(Number(r.y)||0)*Math.PI/180,(Number(r.z)||0)*Math.PI/180);
    heldAnchorQuat.setFromEuler(heldAnchorEuler).invert();
    vase.group.quaternion.copy(holder.quaternion).multiply(heldAnchorQuat);
    heldAnchorOffset.set(Number(a.x)||0,Number(a.y)||0,Number(a.z)||0)
      .applyQuaternion(vase.group.quaternion);
    vase.group.position.copy(holder.position).sub(heldAnchorOffset);
    vase.group.scale.setScalar((holder.scale?.x||1)/Math.max(.1,Number(cfg.size)||1));
    return true;
  }
  function heldHandTarget(){
    return held?.group?.parent&&held.group.parent===carryDeps()?.playerMesh
      ?{holder:held.group,mode:'authored-world',handTargets:held.data?.carryable?.handTargets||{}}:null;
  }
  function updateEmitters(dt,mapId,targetScene){
    const rec=records.get(mapId);
    if(rec?.scene!==targetScene||!targetScene)return;
    const player=playerPosition(),cd=carryDeps();
    const cam=cd?.camera||cd?.getActiveCamera?.()||cd?.getCamera?.();
    // Visibility is sampled at 7 Hz, never doing a camera-matrix update,
    // distance calculation and culling for every Shattercask each frame.
    emitterVisibilityElapsed+=dt;
    const recull=emitterVisibilityElapsed>=POLL_S;
    if(recull) {
      emitterVisibilityElapsed=0;
      const frustum=cam?.projectionMatrix&&cam.matrixWorldInverse&&emitterFrustum&&emitterMatrix&&emitterSphere
        ?emitterFrustum.setFromProjectionMatrix(emitterMatrix.multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse)):null;
      for(const vase of rec.vases.values()){
        const pos=vase.carried?player:vase.group.position;
        const near=player&&pos&&Math.hypot(pos.x-player.x,pos.z-player.z)<18;
        vase._emitterVisible=!!near&&(!frustum||frustum.intersectsSphere(
          emitterSphere.set(emitterSphere.center.set(pos.x,
            vase.carried ? 0.9 : vase.group.position.y+.55,pos.z),1)));
        if(!vase._emitterVisible)for(const fx of vase.emitters||[])fx.points.visible=false;
      }
    }
    for(const vase of rec.vases.values()){
      if(vase.exploded||!vase._emitterVisible)continue;
      if(!vase.emitters&&window.AuthoredFurniture?.createEmitterVisual)
        vase.emitters=(vase.data?.particleEmitters||[]).filter(e=>e.enabled!==false)
          .map(e=>window.AuthoredFurniture.createEmitterVisual(vase.group,e,24));
      for(const fx of vase.emitters||[])fx.update(dt,true);
    }
  }
  function createVase(rec,p,data) {
    // Shared construction for procedural and dev-spawned charges: identical model,
    // hit detection, pickup/drop, blast, and cleanup behavior.
    const group=window.AuthoredFurniture.buildGroup(data);
    group.name='shattercask_'+p.id;
    group.position.set(p.col+.5,baseHeight(p.col,p.row),p.row+.5);
    group.userData.shattercaskId=p.id;
    group.userData.shattercaskMap=p.mapId;
    rec.scene.add(group);
    const vase={...p,group,data,hitBounds:authoredBounds(data),emitters:null,exploded:false,carried:false};
    rec.vases.set(p.id,vase);
    return vase;
  }
  async function spawnRandomInDevArena() {
    const mapId='map_dev_arena';
    if(area()!==mapId)throw new Error('Enter the Testing Arena to spawn a Shattercask.');
    if(devArenaSpawnPending)throw new Error('A Shattercask is already being spawned.');
    loadPersistence();
    const targetScene=scene(),g=grid();
    if(!targetScene||!Array.isArray(g)||!g.length)throw new Error('Testing Arena grid is not ready.');
    const rec=recordFor(mapId,targetScene);
    const player=playerPosition();
    const occupied=new Set([...rec.vases.values()].filter(v=>!v.exploded&&!v.carried)
      .map(v=>key(v.col,v.row)));
    let spot=null,eligible=0;
    // One bounded arena-grid scan per button press; reservoir sampling yields
    // a uniform random tile without allocating/shuffling a tile list.
    for(let row=1;row<g.length-1;row++)for(let col=1;col<(g[row]?.length||0)-1;col++) {
      const tile=g[row][col],type=String(tile?.type||'').toLowerCase();
      if(!validTile(g,col,row)||tile.blocked||tile.solid||tile.walkable===false||Number(tile.water)>0
          ||['wall','cliff','lava','void','boundary','solid'].includes(type)
          ||window.GridTileAccessors?.isTownBuildingCollisionTile?.(col,row,mapId)
          ||occupied.has(key(col,row)))continue;
      // Don't spawn inside the player's standing/interaction footprint.
      if(player&&Math.abs(col+.5-player.x)<1.5&&Math.abs(row+.5-player.z)<1.5)continue;
      if(Math.random()<1/++eligible)spot={col,row};
    }
    if(!spot)throw new Error('No unoccupied walkable tile in the Testing Arena.');
    devArenaSpawnPending=true;
    try {
      const data=await window.AuthoredFurniture?.load?.('shattercaskBlasting');
      if(!data||typeof window.AuthoredFurniture?.buildGroup!=='function')
        throw new Error('Shattercask furniture art failed to load.');
      // Never add a late async spawn to an arena scene the player has left.
      if(area()!==mapId||scene()!==targetScene||records.get(mapId)!==rec)
        throw new Error('Shattercask spawn canceled after leaving the arena.');
      const id='dev_'+(++devArenaSpawnSerial);
      createVase(rec,{id,mapId,...spot},data);
      lastEvent='arena spawned '+id+' at '+spot.col+','+spot.row+' (from '+eligible+' open tiles)';
      window.__farmLog?.('[shattercask] '+lastEvent,'world');
      return {id,...spot,eligible};
    } finally {devArenaSpawnPending=false;}
  }
  async function ensureArea(mapId,targetScene,g) {
    if(!mapId||!targetScene||!g)return;
    const rec=recordFor(mapId,targetScene);
    const placements=eligiblePlacements(mapId,g,targetScene).filter(p=>Number.isInteger(p.col)&&Number.isInteger(p.row)
      &&!persisted.has(mapId+':'+p.id)&&!rec.vases.has(p.id)&&validTile(g,p.col,p.row));
    if(!placements.length||spawnPromises.has(mapId))return;
    spawnPromises.add(mapId);
    try {
      const data=await window.AuthoredFurniture?.load?.('shattercaskBlasting');
      if(!data || records.get(mapId)!==rec || scene()!==targetScene)return; // No scene creation or history replay in a stale async load callback.
      for(const p of placements) {
        if(persisted.has(mapId+':'+p.id)||rec.vases.has(p.id))continue;
        createVase(rec,{...p,mapId},data);
      }
      lastEvent='placed '+placements.length+' in '+mapId;
    } catch(error) {lastEvent='model load failed: '+error.message;console.warn('[shattercask]',error);}
    finally{spawnPromises.delete(mapId);}
  }
  function allActive() {return records.get(area())?.vases || new Map();}
  function senseTargets(targetScene) {
    const out=[];
    for(const rec of records.values())if(rec.scene===targetScene)for(const cask of rec.vases.values())
      if(!cask.exploded)out.push(cask.group);
    return out;
  }
  function switchEquipment() {
    const d=deps();
    return {
      weapon:d?.getEquippedWeaponKey?.() ?? window.RangedWeapons?.equippedRangedKey?.() ?? null,
      tool:d?.getEquippedToolKey?.() ?? null,
      item:d?.getActiveInventoryItem?.()?.key ?? null,
    };
  }
  function pickUp(cask) {
    if(!cask||cask.exploded||held||cask.mapId!==area())return false;
    held=cask;cask.carried=true;
    alignHeldVase(cask);
    Object.assign(lastEquipment,switchEquipment());
    lastEvent='picked up '+cask.id;
    deps()?.showToast?.('Carrying Shattercask — interact to set it down.',false);
    return true;
  }
  function drop() {
    if(!held)return false;
    const cask=held,p=playerPosition(),g=grid();
    const origin=p?nearestOpen(g,Math.round(p.x-.5),Math.round(p.z-.5),2):null;
    if(origin){cask.col=origin.col;cask.row=origin.row;}
    records.get(cask.mapId)?.scene.add(cask.group);
    cask.group.quaternion?.identity?.();
    cask.group.scale?.setScalar?.(1);
    cask.group.position.set(cask.col+.5,baseHeight(cask.col,cask.row),cask.row+.5);
    cask.carried=false;held=null;
    lastEvent='dropped '+cask.id;
    return true;
  }
  function nearInteraction() {
    const p=playerPosition(),rec=records.get(area());
    if(!p||!rec)return null;
    let choice=null,smallest=1.65;
    for(const vase of rec.vases.values()) {
      if(vase.exploded||vase.carried)continue;
      const d=distance(p,{x:vase.col+.5,z:vase.row+.5});
      if(d<smallest){smallest=d;choice={type:'vase',obj:vase};}
    }
    for(const pile of rec.piles.values()) {
      const d=distance(p,{x:pile.col+.5,z:pile.row+.5});
      if(d<smallest){smallest=d;choice={type:'pile',obj:pile};}
    }
    return choice;
  }
  function grantLoot(items) {
    if(typeof audioDeps?.grantLoot==='function')return audioDeps.grantLoot(items);
    const inv=deps()?.inventory;
    if(!inv)return [];
    const gained=[];
    for(const [item,count] of Object.entries(items)) {
      if(!(count>0))continue;
      inv[item]=(Number(inv[item])||0)+count;
      gained.push(item+' x'+count);
    }
    return gained;
  }
  function collectPile(pile) {
    if(!pile||!records.get(pile.mapId)?.piles.has(pile.id))return false;
    grantLoot(pile.kind==='tree'?{[pile.woodKey||'pineLog']:2}:{stone:3,pebble:2}); // Canonical inventory keys, not descriptive stick/wood pseudo-items.
    records.get(pile.mapId).piles.delete(pile.id);
    pileHistory.get(pile.mapId)?.delete(pile.id);
    persistWorld();
    syncPileVisuals(records.get(pile.mapId)); // Rebuild one instanced matrix batch on looting, never remove four separate meshes.
    lastEvent='looted '+pile.id;
    deps()?.showToast?.('Collected '+(pile.kind==='tree'?'wood and sticks':'stone and pebbles')+'.',true);
    return true;
  }
  function interact() {
    if(held)return drop();
    const target=nearInteraction();
    if(target?.type==='vase')return pickUp(target.obj);
    if(target?.type==='pile')return collectPile(target.obj);
    return false;
  }
  function prompt() {
    // Native action-claim input + world-space interaction prompt. No extra
    // button or direct keyboard event that bypasses rebinds and controllers.
    const target=held?{type:'held',obj:held}:nearInteraction();
    const label=target?.type==='held'?'Set down Shattercask':target?.type==='pile'
      ?'Collect '+(target.obj.kind==='tree'?'sticks':'rubble'):'Pick up Shattercask';
    const claim=target?target.type+':'+(target.obj?.id||''):'';
    if(claim!==promptClaim){
      if(target)window.WorldActionInputClaims?.setClaims?.('shattercask',
        [{actionId:'interact',label,priority:410,onPress:interact}]);
      else window.WorldActionInputClaims?.clearClaims?.('shattercask');
      promptClaim=claim;
    }
    if(!target){
      if(promptRoot)window.WorldPopupText?.clearInteractionPrompts?.();
      promptRoot=null;return;
    }
    if(window.WorldActionInputClaims?.claimFor?.('interact')?.ownerId!=='shattercask')return;
    const obj=target.obj;
    const root=obj.group||obj.promptAnchor||(obj.promptAnchor=new THREE.Object3D());
    if(!obj.group){
      root.position.set(obj.col+.5,obj.y+.25,obj.row+.5);
      if(!root.parent)records.get(obj.mapId)?.scene.add(root);
    }
    promptRoot=root;
    window.WorldPopupText?.setInteractionPrompts?.(root,
      [{label,worldInteraction:true,inputActionId:'interact',inputHint:'E'}],{scene:scene()});
  }
  function baseHeight(col,row) {
    const d=deps(),t=tileSize();
    return Number(d?.worldSurfaceY?.((col+.5)*t,(row+.5)*t)) || 0;
  }
  function shatterVisual(targetScene,x,z,y) {
    // Hronal pillar's gold-angle instancing and gravity-driven shard spray,
    // remapped to the vase's own pottery textures and colors, not fire colors.
    const bodyCount=54,neckCount=DEBRIS_COUNT-bodyCount; // Separate textured shard batches preserve BOTH supplied material treatments.
    if(!sharedBurstArt) {
      const loader=new THREE.TextureLoader(); // One texture upload per source material per page, never per explosion.
      const bodyTexture=loader.load('assets/textures/boards.png'); // The user's original brown pottery surface.
      const neckTexture=loader.load('assets/textures/carved_smooth.png'); // Separate lighter neck material.
      textureBatchesCreated++; // Asset creation, not explosion count; stays at one during repeated blasts.
      sharedBurstArt={
        geometries:[new THREE.TetrahedronGeometry(.11),new THREE.TetrahedronGeometry(.08)],
        materials:[
          new THREE.MeshBasicMaterial({color:0x7a4924,map:bodyTexture,side:THREE.DoubleSide,transparent:true}),
          new THREE.MeshBasicMaterial({color:0x8a6a3a,map:neckTexture,side:THREE.DoubleSide,transparent:true}),
        ],
        flashGeometry:new THREE.SphereGeometry(1,16,12),
      }; // Shared draw assets are intentionally retained for subsequent charge blasts.
    }
    const shardMeshes=[
      new THREE.InstancedMesh(sharedBurstArt.geometries[0],sharedBurstArt.materials[0],bodyCount),
      new THREE.InstancedMesh(sharedBurstArt.geometries[1],sharedBurstArt.materials[1],neckCount),
    ];
    const group=new THREE.Group();group.position.set(x,y,z);
    for(const mesh of shardMeshes){mesh.frustumCulled=false;group.add(mesh);}
    targetScene.add(group);
    const parts=[];
    for(let i=0;i<DEBRIS_COUNT;i++) {
      const angle=i*2.399963, speed=RADIUS*(.45+(i%8)/13);
      parts.push({x:(i%7/6-.5)*.68,y:((i%17)/17)*.6,z:(Math.floor(i/7)%7/6-.5)*.63,
        vx:Math.cos(angle)*speed,vz:Math.sin(angle)*speed,vy:2+(i%7)*.32,
        batch:i<bodyCount?0:1,index:i<bodyCount?i:i-bodyCount});
    }
    const flash=new THREE.Mesh(sharedBurstArt.flashGeometry,
      new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.82,depthWrite:false,blending:THREE.AdditiveBlending}));
    flash.position.set(x,y,z);flash.scale.setScalar(.15);targetScene.add(flash);
    burstEffects.push({group,shardMeshes,parts,flash,age:0,duration:1.25,scene:targetScene,
      dummy:new THREE.Object3D()}); // Two instanced meshes share the cached original body and neck surface textures.
    window.AudioSystem?.playWeaponHitSfx?.('blunt',x*tileSize(),z*tileSize(),area(),undefined,'heavy');
  }
  function syncPileVisuals(rec) {
    if(!rec)return;
    if(!sharedPileArt)sharedPileArt={
      rock:{geometry:new THREE.DodecahedronGeometry(.18,0),
        material:new THREE.MeshLambertMaterial({color:0x817b74})},
      tree:{geometry:new THREE.CylinderGeometry(.045,.065,.55,5),
        material:new THREE.MeshLambertMaterial({color:0x7b5936})},
    }; // Shared geometries/materials are never disposed with an individual pile.
    const transform=new THREE.Object3D(); // Reused scratch for the complete rebuild, two GPU instance buffers maximum per area.
    for(const kind of ['rock','tree']){
      const piles=[];
      for(const pile of rec.piles.values())if(pile.kind===kind)piles.push(pile);
      const needed=piles.length*4;
      let state=rec.pileVisuals.get(kind);
      if(!state&&needed===0)continue;
      if(!state||needed>state.capacity){
        const capacity=Math.max(16,needed,state?.capacity*2||0); // Doubles only on rare high-count blasts.
        const mesh=new THREE.InstancedMesh(sharedPileArt[kind].geometry,sharedPileArt[kind].material,capacity);
        mesh.count=0;
        mesh.name='shattercask_'+kind+'_piles_instanced';
        if(state)state.mesh.parent?.remove(state.mesh);
        rec.scene.add(mesh);
        state={mesh,capacity}; // One persistent mesh per debris type instead of four meshes per destroyed tile.
        rec.pileVisuals.set(kind,state);
      }
      for(let p=0;p<piles.length;p++){
        const pile=piles[p];
        for(let i=0;i<4;i++){
          transform.position.set(pile.col+.5+Math.cos(i*1.8)*.15,
            pile.y+.09,pile.row+.5+Math.sin(i*1.8)*.15);
          transform.rotation.set(0,0,kind==='tree'?1.2+i*.08:0);
          transform.scale.set(1,1,1);
          transform.updateMatrix();
          state.mesh.setMatrixAt(p*4+i,transform.matrix);
        }
      }
      state.mesh.count=needed;
      state.mesh.instanceMatrix.needsUpdate=true;
      state.mesh.computeBoundingSphere?.(); // Keep normal camera frustum culling after matrix changes.
    }
  }
  function spawnPile(mapId,rec,col,row,kind,y,woodKey='pineLog') {
    const id=kind+'_'+col+'_'+row;
    if(rec.piles.has(id))return;
    rec.piles.set(id,{id,col,row,kind,woodKey,y,mapId}); // Logical loot records are distinct from the pooled GPU instance geometry.
    if(!pileHistory.has(mapId))pileHistory.set(mapId,new Map());
    pileHistory.get(mapId).set(id,{col,row,kind,woodKey}); // Persist once after the full blast, not once per pile.
  }
  function destroyTerrain(mapId,rec,x,z) {
    const g=grid(),types=deps()?.TileType || {};
    if(!g)return 0;
    let count=0;
    const changedChunks=new Map(); // One zone visual refresh per affected 16x16 chunk rather than rebuilding 81 cells independently.
    for(let row=Math.floor(z-RADIUS);row<=Math.ceil(z+RADIUS);row++)
    for(let col=Math.floor(x-RADIUS);col<=Math.ceil(x+RADIUS);col++) {
      if(Math.hypot(col+.5-x,row+.5-z)>RADIUS)continue;
      const tile=g[row]?.[col];
      if(!tile)continue;
      const kind=tile.rockKind==='diggableRockOre'||tile.caveSeparator||String(tile.type).toLowerCase()==='rock'
        ?'rock':String(tile.type).toLowerCase()==='tree'?'tree':null;
      if(!kind)continue;
      // Cave rim/solid cavern shell is immutable; only generated diggable ore
      // nodes, explodable separators, and harvestable trees may be destroyed.
      if(kind==='rock'&&tile.rockKind!=='diggableRockOre'&&!tile.caveSeparator)continue;
      const floor=baseHeight(col,row);
      const priorType=tile.type;
      tile.type=types.GRASS||'grass';
      if(kind==='rock') {
        window.CavernOreRocks?.removeVisual?.(mapId,col,row); // O(1) tile-index removal, never a full THREE.Scene traversal per rock.
        deps()?.removeZoneMineableRockVisual?.(mapId,col,row);
      } else {
        window.ZoneRegrowth?.updateClearedZoneVegetationVisual?.(mapId,col,row,priorType);
        deps()?.removeZoneVegetationVisual?.(mapId,col,row);
      }
      delete tile.rockKind;delete tile.oreKind;delete tile.oreKey;delete tile.caveSeparator;
      const woodKey=String(tile.treeKind||tile.generatedObjectType||'').toLowerCase().includes('shadewood')?'shadewoodLog':'pineLog';
      spawnPile(mapId,rec,col,row,kind,floor,woodKey);
      if(!terrainHistory.has(mapId))terrainHistory.set(mapId,new Map());
      terrainHistory.get(mapId).set(key(col,row),{kind,woodKey});
      changedChunks.set(Math.floor(col/16)+','+Math.floor(row/16),{col,row});
      count++;
    }
    if(count&&!(mapId.startsWith('map_i_den_')||mapId.startsWith('map_i_town_mine_'))) {
      const chunked=!!window.WildernessChunks; // Chunk rebuild refreshes only one 16x16 region and its seam halo.
      if(chunked) for(const cell of changedChunks.values())window.ZoneRegrowth?.refreshZoneGroundVisuals?.(mapId,cell.col,cell.row);
      else window.ZoneRegrowth?.refreshZoneGroundVisuals?.(mapId,Math.floor(x),Math.floor(z));
    }
    if(count){syncPileVisuals(rec);persistWorld();} // Two debris draw calls, one batched persistence write per explosion.
    return count;
  }
  function restoreSceneHistory(mapId,rec) {
    const savedTerrain=terrainHistory.get(mapId),savedPiles=pileHistory.get(mapId);
    if(!savedTerrain?.size&&!savedPiles?.size)return;
    const g=grid(),types=deps()?.TileType||{},chunks=new Map();
    for(const [tileKey,info] of savedTerrain||[]) {
      const [col,row]=tileKey.split(',').map(Number),tile=g?.[row]?.[col];
      if(!tile)continue;
      const previousType=tile.type;
      tile.type=types.GRASS||'grass';
      if(info.kind==='rock'){
        window.CavernOreRocks?.removeVisual?.(mapId,col,row);
        deps()?.removeZoneMineableRockVisual?.(mapId,col,row);
      }else {
        window.ZoneRegrowth?.updateClearedZoneVegetationVisual?.(mapId,col,row,previousType);
        deps()?.removeZoneVegetationVisual?.(mapId,col,row);
      }
      delete tile.rockKind;delete tile.oreKind;delete tile.oreKey;delete tile.caveSeparator;
      chunks.set(Math.floor(col/16)+','+Math.floor(row/16),{col,row});
    }
    for(const [id,info] of savedPiles||[])if(!rec.piles.has(id))
      spawnPile(mapId,rec,info.col,info.row,info.kind,baseHeight(info.col,info.row),info.woodKey);
    if(rec.piles.size)syncPileVisuals(rec);
    if(chunks.size&&!(mapId.startsWith('map_i_den_')||mapId.startsWith('map_i_town_mine_'))) {
      if(window.WildernessChunks)for(const cell of chunks.values())
        window.ZoneRegrowth?.refreshZoneGroundVisuals?.(mapId,cell.col,cell.row);
      else window.ZoneRegrowth?.refreshZoneGroundVisuals?.(mapId);
    }
  }
  function applyBlast(mapId,x,z) {
    const d=deps(),t=tileSize(),players=d?.player,targets=[];
    if(players)targets.push(players);
    for(const actor of d?.hostileObjects||[])targets.push(actor);
    for(const actor of d?.npcWalkers||[])targets.push(actor);
    const seen=new Set();
    for(const actor of targets) {
      if(!actor||seen.has(actor)||actor.health<=0||actor.areaId && actor.areaId!==mapId||actor.area&&actor.area!==mapId)continue;
      seen.add(actor);
      const ax=Number(actor.x)/t, az=Number(actor.y)/t;
      if(!Number.isFinite(ax)||!Number.isFinite(az))continue;
      const dist=Math.hypot(ax-x,az-z);
      if(dist>RADIUS)continue;
      const damage=Math.max(8,DAMAGE*(1-.55*dist/RADIUS));
      const effects={bleedingHealth:.24,bruisedHealth:.18,woundedStamina:.22,shatteredStamina:.20};
      const opts={tag:'blunt',environmental:true,reason:'Shattercask blast',afflictionBonuses:effects,footingDamageMultiplier:1.5};
      if(actor===players)d?.damagePlayer?.(damage,x*t,z*t,220,opts);
      else if(d?.hostileObjects?.has?.(actor))d?.damageCreature?.(actor,damage,x*t,z*t,220,opts);
      else window.ResourceSystem?.applyDamage?.(actor,damage,opts);
      window.ResourceSystem?.spendFooting?.(actor,Math.max(8,24*(1-dist/RADIUS)),'Shattercask blast');
    }
  }
  function detonate(cask,cause='weapon') {
    if(!cask||cask.exploded)return false;
    cask.exploded=true;
    if(held===cask)held=null;
    const rec=records.get(cask.mapId);
    const impact={x:cask.group.position.x,y:cask.group.position.y,z:cask.group.position.z};
    if(cask.carried&&cask.group.getWorldPosition&&carriedWorldPosition){
      const world=cask.group.getWorldPosition(carriedWorldPosition);
      impact.x=world.x;impact.y=world.y;impact.z=world.z;
    }
    cask.group.parent?.remove(cask.group);
    disposeEmitters(cask);
    rec?.vases.delete(cask.id);
    saveConsumed(cask.mapId+':'+cask.id);
    const x=impact.x,z=impact.z;
    const y=cask.carried?impact.y:baseHeight(cask.col,cask.row)+.30; // A charge shot out of someone's hands explodes where it is actually held.
    shatterVisual(rec?.scene||scene(),x,z,y);
    applyBlast(cask.mapId,x,z);
    const cleared=destroyTerrain(cask.mapId,rec,x,z);
    lastEvent='blast '+cask.id+' via '+cause+', terrain='+cleared;
    window.__farmLog?.('[shattercask] '+lastEvent,'world');
    return true;
  }
  function sweepMelee(opts={}) {
    if(!opts.actor||!(opts.rangePx>0))return;
    if(held && opts.actor===deps()?.player)drop();
    const collider=window.Combat?.meleeColliderVolume?.(opts.actor,opts);
    if(!collider)return;
    for(const vase of allActive().values()) {
      if(vase.exploded||vase.carried)continue;
      const dx=vase.col+.5-collider.origin.x,dz=vase.row+.5-collider.origin.z;
      const radial=Math.hypot(dx,dz);
      if(radial>collider.horizontalRangeWorld+.3)continue;
      const delta=Math.abs(Math.atan2(Math.sin(Math.atan2(dz,dx)-collider.yaw),Math.cos(Math.atan2(dz,dx)-collider.yaw)));
      if(delta>(collider.halfConeRad||.5)+.10)continue;
      const expectedY=collider.origin.y+collider.verticalRiseWorld*radial/Math.max(.1,collider.horizontalRangeWorld);
      if(Math.abs(expectedY-(baseHeight(vase.col,vase.row)+.35))>collider.halfHeightWorld+.40)continue;
      detonate(vase,'melee');break;
    }
  }
  function projectileHit(start,end,radius,limit,mapId) {
    let result=null;
    const cap=Math.max(0,Math.min(1,Number(limit)??1)),pad=Math.max(0,Number(radius)||0);
    for(const vase of records.get(mapId)?.vases.values()||[]){
      if(vase.exploded)continue;
      const b=vase.hitBounds||{minX:-.4,maxX:.4,minY:0,maxY:1,minZ:-.4,maxZ:.4};
      let center=vase.group.position;
      if(vase.carried&&vase.group.getWorldPosition&&carriedWorldPosition)
        center=vase.group.getWorldPosition(carriedWorldPosition);
      // World objects use their authored bounds; carried billboard-rotated
      // models use an enclosing volume in world coordinates.
      const min=vase.carried?{x:center.x-.8,y:center.y-.8,z:center.z-.8}
        :{x:center.x+b.minX,y:center.y+b.minY,z:center.z+b.minZ};
      const max=vase.carried?{x:center.x+.8,y:center.y+.8,z:center.z+.8}
        :{x:center.x+b.maxX,y:center.y+b.maxY,z:center.z+b.maxZ};
      let enter=0,exit=cap;
      for(const axis of ['x','y','z']){
        const a=start[axis],d=end[axis]-a;
        if(Math.abs(d)<1e-9){if(a<min[axis]-pad||a>max[axis]+pad){enter=Infinity;break;}continue;}
        const t0=(min[axis]-pad-a)/d,t1=(max[axis]+pad-a)/d;
        enter=Math.max(enter,Math.min(t0,t1));exit=Math.min(exit,Math.max(t0,t1));
        if(enter>exit)break;
      }
      if(enter<=exit&&(!result||enter<result.t))result={t:enter,vase};
    }
    return result;
  }
  function hitProjectile(candidate) {
    return candidate?.vase ? detonate(candidate.vase,'projectile') : false;
  }
  function updateBursts(dt) {
    for(let i=burstEffects.length-1;i>=0;i--) {
      const fx=burstEffects[i];fx.age+=dt;
      if(fx.age>=fx.duration) {
        fx.group.parent?.remove(fx.group);fx.flash.parent?.remove(fx.flash);
        // Geometry, materials and texture maps belong to sharedBurstArt, not to one burst.
        // Disposing them here would force a GPU texture rebuild on every blast.
        fx.flash.material.dispose();burstEffects.splice(i,1);continue;
      }
      const f=fx.age/fx.duration;
      fx.flash.scale.setScalar(.15+RADIUS*Math.min(1,fx.age/.16));
      fx.flash.material.opacity=.82*Math.max(0,1-fx.age/.22);
      fx.flash.visible=fx.age<.22;
      for(let j=0;j<fx.parts.length;j++) {
        const part=fx.parts[j];
        part.x+=part.vx*dt;part.z+=part.vz*dt;part.y+=part.vy*dt;part.vy-=7.5*dt;
        fx.dummy.position.set(part.x,part.y,part.z);
        fx.dummy.rotation.set(f*(j%3+1)*6,f*10,0);
        fx.dummy.scale.setScalar(Math.max(.001,1-f));
        fx.dummy.updateMatrix();
        fx.shardMeshes[part.batch].setMatrixAt(part.index,fx.dummy.matrix);
      }
      for(const mesh of fx.shardMeshes)mesh.instanceMatrix.needsUpdate=true;
    }
  }
  function tick(dt=0) {
    const mapId=area();
    if(held && held.mapId!==mapId)drop();
    updateBursts(Math.min(.1,Math.max(0,Number(dt)||0)));
    // Held objects must track the player every rendered frame, not every 140ms.
    if(held&&!alignHeldVase(held)) {
      const p=playerPosition();
      if(p)held.group.position.set(p.x+Math.cos(p.angle)*.60,
        baseHeight(Math.floor(p.x),Math.floor(p.z))+.75,p.z+Math.sin(p.angle)*.60);
    }
    updateEmitters(Math.min(.1,Math.max(0,Number(dt)||0)),mapId,records.get(mapId)?.scene);
    elapsed+=Math.min(.2,Math.max(0,Number(dt)||0));
    if(elapsed<POLL_S)return;
    elapsed=0;
    loadPersistence();
    const targetScene=scene(); // Resolve lazy zone scenes at most 7 times/second, not every rendered frame.
    if(mapId!==lastArea) {
      lastArea=mapId;
      window.WorldActionInputClaims?.clearClaims?.('shattercask');
      promptClaim='';
    }
    if(targetScene)ensureArea(mapId,targetScene,grid());
    if(held) {
      const p=playerPosition(),equipment=switchEquipment();
      if(equipment.weapon!==lastEquipment.weapon||equipment.tool!==lastEquipment.tool||equipment.item!==lastEquipment.item)drop();
      // The held visual already follows the player at full frame rate above.
    }
    prompt();
  }
  function attachRuntime() {
    const combat=window.Combat;
    if(combat?.init&&!combat.init.__shattercaskMeleeSetup) {
      const original=combat.init.bind(combat);
      const wrapped=function shattercaskCombatInit(injected) {
        const result=original(injected);
        if(typeof injected?.clearVegetationInAttackCone==='function'
          &&!injected.clearVegetationInAttackCone.__shattercaskStrike) {
          const clear= injected.clearVegetationInAttackCone;
          const strike=function shattercaskVegetationStrike(x,y,yaw,rangePx,halfConeRad,...rest) {
            // Every real player melee strike, including ordinary swings, combos,
            // quick attacks, and charged breakers, calls this shared vegetation
            // hit pass even when there are no enemies in the cone.
            sweepMelee({actor:injected.player,yaw,rangePx,halfConeRad,
              pitch:injected.getPlayerMeleeAimPitch?.()||0});
            return clear(x,y,yaw,rangePx,halfConeRad,...rest);
          };
          strike.__shattercaskStrike=true;
          injected.clearVegetationInAttackCone=strike;
        }
        return result;
      };
      wrapped.__shattercaskMeleeSetup=true;combat.init=wrapped;
    }
    if(combat?.update&&!combat.update.__shattercaskTick) {
      const original=combat.update.bind(combat);
      const wrapped=function shattercaskUpdate(dt){const result=original(dt);tick(dt);return result;};
      wrapped.__shattercaskTick=true;combat.update=wrapped;
    }
    if(combat?.beginStagedAction&&!combat.beginStagedAction.__shattercaskStrike) {
      const original=combat.beginStagedAction.bind(combat);
      const wrapped=function shattercaskStagedStrike(options) {
        const threat=options?.data?.meleeThreat; // Real authored combo/quick/charged attacks publish the same active hit cone.
        if(!threat||options.data?.isBandit)return original(options);
        const onStrike=options.onStrike;
        return original({...options,onStrike:function shattercaskCommittedStrike(...args){
          const actor=deps()?.player;
          if(actor)sweepMelee({actor,rangePx:threat.rangePx,halfConeRad:threat.halfConeRad,
            yaw:threat.yaw??actor.angle,pitch:deps()?.getPlayerMeleeAimPitch?.()||0});
          return onStrike?.(...args);
        }});
      };
      wrapped.__shattercaskStrike=true;combat.beginStagedAction=wrapped;
    }
    if(combat?.spawnMeleeTrail&&!combat.spawnMeleeTrail.__shattercaskStrike) {
      const original=combat.spawnMeleeTrail.bind(combat);
      const wrapped=function shattercaskStrike(opts){const result=original(opts);sweepMelee(opts);return result;};
      wrapped.__shattercaskStrike=true;combat.spawnMeleeTrail=wrapped;
    }
    const spawner=window.DevSpawner;
    if(spawner?.init&&!spawner.init.__shattercaskLoot) {
      const original=spawner.init.bind(spawner);
      const wrapped=function shattercaskSpawnerInit(injected){audioDeps=injected;return original(injected);};
      wrapped.__shattercaskLoot=true;spawner.init=wrapped;
    }
  }
  if(typeof window.addEventListener==='function') {
    window.addEventListener('pointerdown',event=>{
      if(!held)return;
      const id=event.target?.closest?.('button')?.id||'';
      if(/(?:weapon|tool|item|dequip|swap)/i.test(id))drop();
    },true);
  }
  window.Shattercasks=Object.freeze({
    RADIUS,spawn:ensureArea,spawnRandomInDevArena,pickUp,drop,interact,detonate,heldHandTarget,
    projectileHit,hitProjectile,senseTargets,sweepMelee,tick,attachRuntime,
    debugSnapshot:()=>({lastEvent,area:area(),held:held?.id||null,emittingVases:[...allActive().values()].filter(v=>v.emitters?.length).length,
      vases:[...allActive().values()].map(v=>({id:v.id,col:v.col,row:v.row,carried:v.carried})),
      rubble:[...(records.get(area())?.piles.values()||[])].map(p=>({id:p.id,col:p.col,row:p.row})),
      effects:burstEffects.length,loadedWorld:storeIdentity,devArenaSpawnPending,
      performance:{ruinSnapshotReads,textureBatchesCreated,
        activePileDrawCalls:records.get(area())?.pileVisuals.size||0,
        activeDebrisInstances:[...(records.get(area())?.pileVisuals.values()||[])].reduce((sum,state)=>sum+state.mesh.count,0),
        cachedPlacementAreas:placementCache.size},
      interactionClaim:window.WorldActionInputClaims?.claimFor?.('interact')?.ownerId||null}),
  });
  attachRuntime();
})();
