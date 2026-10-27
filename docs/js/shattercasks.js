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
  const looseFruitHistory = new Map(); // Area -> Map(burden id -> intact safely dropped fruit); restores unthrown fruit after reload.
  const lastEquipment = { weapon:null, tool:null, item:null }; // Pickup-time equipment snapshot used to drop carried vases on selection changes.
  // All physical carryables share this record and Shattercask's pickup/drop/throw state machine.
  // 'kind' chooses the impact payload, not a different input or animation system.
  class Burden {
    constructor(props) { Object.assign(this, props); this.kind = props.kind || 'shattercask'; }
    get displayName() { return this.kind === 'soursap' ? 'Soursap Fruit' : 'Shattercask'; }
  }
  const fallingFruits = new Map(); // Active airborne tree fruit; separate from the player's one thrown burden.
  const FRUIT_RADIUS = 2.6; // Soursap impact AOE, smaller than a Shattercask's destructive blast.
  const FRUIT_DAMAGE = 12; // Raw blunt icicle-style impact damage before defensive mitigation.
  let held = null; // The one intact Burden held in front of the local player.
  let aimingThrow=null,flight=null,throwRing=null;
  const MAX_THROW_RADIUS=14;
  const SHATTER_RELEASE_FALLBACK=.28;
  const throwAnimation=()=>window.HeldActionAnimations?.throwFlask||null;
  function authoredReleaseDelay(){
    const anim=throwAnimation();
    const duration=Number(anim?.durationS)||1.04;
    return Math.max(.01,duration*Math.max(0,(Number(anim?.strikeFrac)||.57)-(Number(anim?.windupFrac)||.49)));
  }
  function beginSharedThrowVisual(){
    const anim=throwAnimation(),ranged=window.RangedWeapons;
    if(!anim?.poses || !ranged?.triggerPlayerVisual)return false;
    ranged.triggerPlayerVisual(Number(anim.durationS)||1.04,{
      sequence:'attack',pose:anim.poses,gripMode:anim.gripMode||'palm-parallel',
      held:true,alignToReticle:true,
      windupFrac:anim.windupFrac,strikeFrac:anim.strikeFrac,holdFrac:anim.holdFrac,
    });
    return true;
  }
  function releaseSharedThrowVisual(){
    const ranged=window.RangedWeapons;
    if(!ranged?.releasePlayerHold)return false;
    // The throw is physical furniture, not ammunition; resume the existing
    // authored spin-throw pose without creating a fake weapon projectile.
    ranged.releasePlayerHold({poseProgress:Math.max(.01,Number(ranged.playerWindupPoseProgress?.())||1)});
    return true;
  }
  function cancelSharedThrowVisual(){
    window.RangedWeapons?.cancelPlayerHold?.();
  }
  const throwPoses=()=>window.HeldActionAnimations?.throwFlask?.poses||null;
  let audioDeps = null; // Captured DevSpawner.grantLoot so rubble uses ordinary inventory/loot handling.
  let gameDeps = null; // game.js-owned inventory, resource-visual and mine-descent helpers (see init()); Combat.deps carries none of them.
  let elapsed = 0, lastArea = '', lastEvent = 'not started';
  let promptClaim = ''; // Stable current input claim; avoids rewriting global input policy every 140ms.
  let offeredPileId = null; // Sticky aimed rubble pile so the arch does not blink as the reticle crosses a tile edge.
  const PILE_REACH = 1.65; // Same reach as Shattercask pickup.
  // Blast rubble pays out more than breaking the same tile by hand (2-3 stone / 2-3 logs).
  const RUBBLE_YIELD = Object.freeze({ rockStone:[4,5], pebble:2, oreMultiplier:2, treeLogs:[4,5], mulch:2 });
  let storeIdentity = null; // Per-world persistence partition; regenerated sites have distinct vase IDs.
  const THREE = window.THREE;
  if (!THREE) return;
  const emitterFrustum = THREE.Frustum && new THREE.Frustum();
  const emitterMatrix = THREE.Matrix4 && new THREE.Matrix4();
  const emitterSphere = THREE.Sphere && THREE.Vector3 && new THREE.Sphere(new THREE.Vector3(),1);
  const carriedWorldPosition = THREE.Vector3 && new THREE.Vector3();
  const heldAnchorOffset = THREE.Vector3 && new THREE.Vector3();
  const authoredAnchorQuat = THREE.Quaternion && new THREE.Quaternion(); // Reused each frame; no Quaternion allocation in carried update.
  const heldAnchorEuler = THREE.Euler && new THREE.Euler();
  const posteriorLocal = THREE.Vector3 && new THREE.Vector3();
  const posteriorOffset = THREE.Vector3 && new THREE.Vector3();
  const defaultPosteriorY = .42;
  function finite(v, defaultValue=0){const n=Number(v);return Number.isFinite(n)?n:defaultValue;}
  let emitterVisibilityElapsed = 0; // Cull only on the 140ms poll cadence, not every frame.

  function deps() { return window.Combat?.deps; }
  function init(injected) { gameDeps = injected || null; }
  // Town-mine floors are re-carved on every visit (TownMine.synthesizeFloorMapData),
  // so blast openings, rubble and the consumed floor charge must not be
  // replayed onto the next visit's unrelated layout.
  function isRegeneratedArea(mapId) { return String(mapId||'').startsWith('map_i_town_mine_f_'); }
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
    storeIdentity=identity;persisted.clear();terrainHistory.clear();pileHistory.clear();looseFruitHistory.clear();records.clear();placementCache.clear();
    if(held||backXray.size)setHeldRearXray(null); // Never leak held portrait depth state into the next world.
    held=null; // A different world must never inherit another world's held charge.
    promptClaim='';
    if (identity.startsWith('session|')) return;
    try {
      for(const id of JSON.parse(localStorage.getItem('hobunji.shattercasks.v1:'+identity)||'[]')) persisted.add(id);
      const savedTerrain=JSON.parse(localStorage.getItem('hobunji.shattercasks.terrain.v1:'+identity)||'{}');
      for(const [area,tiles] of Object.entries(savedTerrain))terrainHistory.set(area,new Map(Object.entries(tiles)));
      const savedPiles=JSON.parse(localStorage.getItem('hobunji.shattercasks.piles.v1:'+identity)||'{}');
      for(const [area,piles] of Object.entries(savedPiles))pileHistory.set(area,new Map(Object.entries(piles)));
      const savedFruit=JSON.parse(localStorage.getItem('hobunji.burdens.looseFruit.v1:'+identity)||'{}');
      for(const [area,fruits] of Object.entries(savedFruit))looseFruitHistory.set(area,new Map(Object.entries(fruits)));
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
      localStorage.setItem('hobunji.burdens.looseFruit.v1:'+storeIdentity,
        JSON.stringify(Object.fromEntries([...looseFruitHistory].map(([area,fruits])=>[area,Object.fromEntries(fruits)]))));
    }catch(error){window.__farmLog?.('[shattercask] failed to persist blast/loot history: '+error.message,'warn');}
  }
  function saveConsumed(id) {
    loadPersistence();persisted.add(id);persistWorld();
  }
  function recordFor(mapId, targetScene) {
    const existing=records.get(mapId);
    if(existing?.scene===targetScene)return existing;
    placementCache.delete(mapId); // Generated geometry changed; only then may the expensive placements be sampled again.
    if(isRegeneratedArea(mapId)){
      terrainHistory.delete(mapId);pileHistory.delete(mapId);
      for(const id of [...persisted])if(id.startsWith(mapId+':'))persisted.delete(id);
      persistWorld();
    }
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
    // Camps are dynamic: new camps may be generated after the zone scene loads,
    // so they are re-read on every poll instead of joining the static cache.
    const result=[];
    const camps=window.BanditCamps?.campInstances?.get?.(mapId)||[];
    camps.forEach((camp,index)=>{
      const x=Math.floor(Number(camp.homeX)/tileSize()),z=Math.floor(Number(camp.homeY)/tileSize());
      const spot=nearestOpen(g,x,z,4);
      if(spot)result.push({id:'bandit_'+(camp.discoveryKey||index),...spot});
    });
    if(!cached.ready) {
      const cave=window.CaveSiteSystem?.__test?.plansByMapId?.get?.(mapId);
      if(cave)for(const entry of cave.shattercasks||[]) cached.static.push({
        id:entry.id+'_'+entry.col+'_'+entry.row,col:entry.col,row:entry.row
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
  // Collision reads the meshes built from the authored furniture parts, not a
  // broad cylinder or the enclosing art box. The box is only a cheap rejection
  // test before THREE.Mesh.raycast checks the actual triangles.
  const shatterRaycaster = THREE.Raycaster ? new THREE.Raycaster() : null;
  const shatterRayStart = THREE.Vector3 && new THREE.Vector3();
  const shatterRayDirection = THREE.Vector3 && new THREE.Vector3();
  const shatterRayOffset = THREE.Vector3 && new THREE.Vector3();
  const shatterRayAcross = THREE.Vector3 && new THREE.Vector3();
  const shatterRayUp = THREE.Vector3 && new THREE.Vector3();
  const shatterRayBox = THREE.Box3 && new THREE.Box3();
  const shatterRayBoxPoint = THREE.Vector3 && new THREE.Vector3();
  const shatterRayHits = [];
  let meshRaycastQueries = 0,meshRaycastBroadphaseRejects = 0,meshRaycastTriangleQueries=0;
  const RAY_SAMPLES = [[0,0],[1,0],[-1,0],[0,1],[0,-1],
    [.70710678,.70710678],[.70710678,-.70710678],[-.70710678,.70710678],[-.70710678,-.70710678]];
  function collectMeshColliders(group) {
    // Only real modeled parts are targets: do not raycast bubble particles,
    // item sprites, invisible anchor guides, or explosion effects.
    const authored = group.userData?.meshById;
    const meshes = authored?.values ? [...authored.values()] : [];
    if (!meshes.length) group.traverse?.(part => { if (part.isMesh) meshes.push(part); }); // Soursap spheres use ordinary geometry, not Furniture Author mesh IDs.
    return meshes.filter(mesh => mesh?.isMesh && mesh.visible !== false
      && mesh.material?.visible !== false && mesh.geometry?.attributes?.position?.count > 0);
  }
  const authoredHitboxWorld = THREE.Box3 && new THREE.Box3();
  const hitboxMin = THREE.Vector3 && new THREE.Vector3(), hitboxMax = THREE.Vector3 && new THREE.Vector3();
  function worldHitbox(vase) {
    const h=vase?.data?.carryable?.hitbox;
    if(!h?.enabled || !authoredHitboxWorld || !hitboxMin || !hitboxMax)return null;
    const c=h.center||{},size=h.size||{};
    const cx=Number(c.x)||0,cy=Number(c.y)||0,cz=Number(c.z)||0;
    const hx=Math.max(.005,Number(size.x)||.43)/2,hy=Math.max(.005,Number(size.y)||.49)/2,hz=Math.max(.005,Number(size.z)||.31)/2;
    vase.group.updateWorldMatrix?.(true,true);
    return authoredHitboxWorld.set(hitboxMin.set(cx-hx,cy-hy,cz-hz),
      hitboxMax.set(cx+hx,cy+hy,cz+hz)).applyMatrix4(vase.group.matrixWorld);
  }
  function refreshMeshBounds(vase) {
    if(!vase?.meshBounds || !vase.meshColliders?.length)return;
    vase.group.updateWorldMatrix?.(true,true);
    vase.meshBounds.makeEmpty();
    // Bounds are refreshed once at spawn/drop, or for an actively moving charge.
    // The visible authored hitbox can supersede mesh triangles for impacts.
    for(const mesh of vase.meshColliders){
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox?.();
      if(mesh.geometry.boundingBox) {
        mesh.updateWorldMatrix?.(true,false);
        vase.meshBounds.union(shatterRayBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
      }
    }
    const hitbox=worldHitbox(vase);
    if(hitbox)vase.meshBounds.union(hitbox);
  }
  function disposeEmitters(vase) {
    for(const fx of vase.emitters||[])fx.dispose?.();
    vase.emitters=null;
  }
  const backXray=new Map(),heldRenderOrders=new Map();
  const skinnedRearOverlays=new Map(); // One back-only skinned draw per currently held player's neck-rigged portrait.
  const rearHeadwearXray=new Map(); // Separate skinned rear HEAD and its headwear pass were missing from the vessel x-ray.
  const CARRIED_VESSEL_RENDER_ORDER=1.4; // Used by held parts; 1.5 is reserved for weapon/tool PNG overlay classification.
  const CARRIED_REAR_RENDER_ORDER=2.4; // After carried vessel parts, before existing hat x-ray (2.5).
  const CARRIED_REAR_HEAD_RENDER_ORDER=2.6; // Head's back-only hat/hair pass over the held vessel and hat-front pass.
  function restoreRearHeadwear() {
    for(const [mesh,stored] of rearHeadwearXray){
      mesh.renderOrder=stored.order;
      for(const [material,flags] of stored.materials)if(material){
        material.depthTest=flags.depthTest;
        material.depthWrite=flags.depthWrite;
        material.needsUpdate=true;
      }
    }
    rearHeadwearXray.clear();
  }
  function removeSkinnedRearOverlay(source) {
    const record=skinnedRearOverlays.get(source);
    if(!record)return;
    record.overlay.parent?.remove(record.overlay);
    for(const material of record.overlay.material)material?.dispose?.();
    // Only restore the material we disabled; a rebuilt avatar can replace its
    // material array without having an old overlay overwrite new state.
    if(source.material?.[1]===record.backMaterial)
      record.backMaterial.visible=record.wasVisible;
    skinnedRearOverlays.delete(source);
  }
  function syncCarrierRearPortrait(body) {
    // PNGPlaneAvatar has TWO layouts: rigid front/back Mesh planes, or ONE
    // SkinnedMesh with separate front/back material groups. The latter has no
    // npc_avatar_back_plane at all, so a rigid-only x-ray silently did nothing
    // on the normal player neck rig.
    const rigidSeen=new Set(),skinnedSeen=new Set(),headwearSeen=new Set();
    body?.traverse?.(mesh=>{
      if(!mesh?.isMesh||mesh.userData?.shattercaskRearOverlay)return;
      // Skinned rear headwear is an independent surface. A skinned torso-only
      // rear overlay never brings it forward through the held Shattercask.
      if(/player_avatar_back_hat_xray_plane$/i.test(String(mesh.name||''))){
        headwearSeen.add(mesh);
        if(!rearHeadwearXray.has(mesh)){
          const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).filter(Boolean);
          rearHeadwearXray.set(mesh,{order:mesh.renderOrder,materials:materials.map(material=>
            [material,{depthTest:material.depthTest,depthWrite:material.depthWrite}])});
        }
        mesh.renderOrder=CARRIED_REAR_HEAD_RENDER_ORDER;
        for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material]))
          if(material){material.depthTest=true;material.depthWrite=true;}
        return;
      }
      if(mesh.name==='npc_avatar_back_plane') {
        rigidSeen.add(mesh);
        const material=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
        if(!material)return;
        if(!backXray.has(mesh))backXray.set(mesh,{
          material,depthTest:material.depthTest,depthWrite:material.depthWrite,order:mesh.renderOrder});
        mesh.renderOrder=CARRIED_REAR_RENDER_ORDER;
        // Depth test stays ON: only the held vessel is transparent to the
        // rear portrait, not the walls/terrain between the camera and player.
        material.depthTest=true;
        return;
      }
      if(!mesh.isSkinnedMesh||!Array.isArray(mesh.material)
        ||mesh.material[1]?.name!=='npc_avatar_skinned_back_material'||!mesh.parent)return;
      skinnedSeen.add(mesh);
      if(skinnedRearOverlays.has(mesh))return;
      const backMaterial=mesh.material[1];
      const hiddenFront=new THREE.MeshBasicMaterial({visible:false}); // Back-only overlay: never re-render the opposite face.
      const rearMaterial=backMaterial.clone(); // Same PNG, alpha test, and skinning; independent depth/layer state.
      rearMaterial.visible=true;
      rearMaterial.depthTest=true;
      rearMaterial.depthWrite=true; // Preserve world occlusion and subsequent portrait depth behavior.
      rearMaterial.needsUpdate=true;
      const overlay=new THREE.SkinnedMesh(mesh.geometry,[hiddenFront,rearMaterial]);
      overlay.name='shattercask_carrier_rear_only_xray';
      overlay.userData.shattercaskRearOverlay=true;
      overlay.frustumCulled=false;
      overlay.renderOrder=CARRIED_REAR_RENDER_ORDER;
      overlay.bindMode=mesh.bindMode;
      overlay.bind(mesh.skeleton,mesh.bindMatrix); // Share animated bones: no new skinning rig or geometry.
      overlay.matrixAutoUpdate=false;
      overlay.onBeforeRender=()=>{
        overlay.matrix.copy(mesh.matrix);
        overlay.matrixWorld.copy(mesh.matrixWorld); // Follow live body/neck motion, not a frozen pickup pose.
      };
      mesh.parent.add(overlay);
      skinnedRearOverlays.set(mesh,{overlay,backMaterial,wasVisible:backMaterial.visible});
      backMaterial.visible=false; // Original rear pass must not double-blend under the overlaid rear.
    });
    // The player can rebuild its portrait asynchronously while carrying.
    // Prune stale references and attach the newly generated rear every poll.
    for(const mesh of [...backXray.keys()])if(!rigidSeen.has(mesh)){
      const snapshot=backXray.get(mesh);
      mesh.renderOrder=snapshot.order;
      if(mesh.material===snapshot.material){
        snapshot.material.depthTest=snapshot.depthTest;
        snapshot.material.depthWrite=snapshot.depthWrite;
      }
      backXray.delete(mesh);
    }
    for(const source of [...skinnedRearOverlays.keys()])
      if(!skinnedSeen.has(source))removeSkinnedRearOverlay(source);
    // The avatar can also replace its head plane independently of the torso.
    for(const [mesh,original] of [...rearHeadwearXray])
      if(!headwearSeen.has(mesh)){
        mesh.renderOrder=original.order;
        for(const [material,flags] of original.materials)if(material){
          material.depthTest=flags.depthTest;material.depthWrite=flags.depthWrite;
          material.needsUpdate=true;
        }
        rearHeadwearXray.delete(mesh);
      }
  }
  function setHeldRearXray(cask) {
    if(!cask) {
      for(const [mesh,v] of backXray) {
        mesh.renderOrder=v.order;
        if(mesh.material===v.material) {
          v.material.depthTest=v.depthTest;
          v.material.depthWrite=v.depthWrite;
          v.material.needsUpdate=true;
        }
      }
      backXray.clear();
      for(const source of [...skinnedRearOverlays.keys()])removeSkinnedRearOverlay(source);
      restoreRearHeadwear();
      for(const [mesh,snap] of heldRenderOrders) {
        mesh.renderOrder=snap.order;
        for(const [material,depthWrite] of snap.materials){
          material.depthWrite=depthWrite;
          material.needsUpdate=true;
        }
      }
      heldRenderOrders.clear();
      return;
    }
    // The held furniture is still fully visible and depth-tested against the
    // world; it simply stops writing depth over the character's rear PNG.
    for(const mesh of cask.meshColliders||[]) {
      if(!heldRenderOrders.has(mesh))heldRenderOrders.set(mesh,{
        order:mesh.renderOrder,
        materials:(Array.isArray(mesh.material)?mesh.material:[mesh.material])
          .filter(Boolean).map(material=>[material,material.depthWrite])
      });
      // Keep physical furniture in the normal colour pass. The held-object
      // renderer treats 1.5 as a legacy PNG marker and would replay this
      // vessel over the rear portrait, regardless of its depthWrite setting.
      mesh.renderOrder=CARRIED_VESSEL_RENDER_ORDER;
      for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material]))
        if(material&&material.depthWrite!==false){
          material.depthWrite=false;
          material.needsUpdate=true;
        }
    }
    syncCarrierRearPortrait(carryDeps()?.playerMesh);
  }
  function carryDeps() { return window.ProceduralHandAttachments?.gameDeps || deps() || {}; }
  function heldItemHolder(){
    const d=carryDeps();
    return d?.getHeldItemHandTarget?.()?.holder
      ||d?.playerMesh?.children?.find(o=>o?.type==='Group'&&o.userData?.isPngPlane&&!String(o.name||'').trim())||null;
  }
  // "billboardAnchor.position" is the exact point on the authored furniture
  // which mounts to the character's posterior, plus optional posteriorOffset.
  // Solve in playerMesh-local coordinates: world placement of the dropped item
  // must never leak into X/Z while carrying. Both position and scale are
  // transformed before subtraction (old code omitted the scale).
  // Capture the actual held-item animation socket in player portrait space.
  // No hardcoded lateral/forward offsets or duplicated attack-pose samples:
  // the animation driver is the sole owner of the throw sweep.
  function currentThrowSocketPose(){
    const body=carryDeps()?.playerMesh,holder=heldItemHolder();
    if(!body?.worldToLocal||!holder?.getWorldPosition||!holder?.quaternion)return null;
    let cursor=holder;
    const chain=[];
    while(cursor&&cursor!==body){chain.unshift(cursor);cursor=cursor.parent;}
    if(cursor!==body)return null;
    body.updateWorldMatrix?.(true,false);
    holder.updateWorldMatrix?.(true,false);
    const position=body.worldToLocal(holder.getWorldPosition(new THREE.Vector3()));
    const quaternion=new THREE.Quaternion();
    for(const part of chain)quaternion.multiply(part.quaternion);
    return{holder,position,quaternion};
  }
  function alignHeldVase(vase) {
    const body=carryDeps()?.playerMesh;
    if(!body||!vase?.group?.quaternion||!posteriorLocal)return false;
    if(vase.group.parent!==body)body.add(vase.group);
    const cfg=vase.data?.carryable?.billboardAnchor||{},a=cfg.position||{},r=cfg.rotation||{},o=cfg.posteriorOffset||{};
    const playerSpecies=String(body.userData?.speciesId||body.userData?.species||'mao-ao').toLowerCase();
    const playerGender=String(body.userData?.gender||'male').toLowerCase();
    const profile=window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${playerSpecies}::${playerGender}`]
      ||window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.['mao-ao::male'];
    const posteriorY=window.PlayerBodyTransformComposer?.getPosteriorY?.();
    // A live composer value is authoritative; the profile is a safe startup
    // fallback while player avatar/hand meshes load asynchronously.
    const modelHeight=finite(body?.userData?.portraitModelHeight,.9);
    const computed=window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(
      profile?.posteriorRule,modelHeight,finite(body?.userData?.handAttachY,modelHeight/2));
    const y=Number.isFinite(posteriorY)&&posteriorY!==0?posteriorY
      :Number.isFinite(computed)?computed:defaultPosteriorY;
    const origin=profile?.anchors?.posterior?.position||{};
    posteriorLocal.set(finite(origin.x),y,finite(origin.z));
    // The playerMesh is the actual character/posterior frame. The renderer
    // already applies body yaw and camera deadzone to that whole hierarchy.
    // Never inherit the *generic held-item holder's* extra bottle/tool rotation
    // or its world position: doing so rotates authored Z clearance into a
    // different axis and makes authoring disagree with gameplay.
    heldAnchorEuler.set(finite(r.x)*Math.PI/180,finite(r.y)*Math.PI/180,finite(r.z)*Math.PI/180);
    authoredAnchorQuat.setFromEuler(heldAnchorEuler).invert();
    vase.group.quaternion.copy(authoredAnchorQuat);
    const size=Math.max(.1,finite(cfg.size,1));
    vase.group.scale.setScalar(1/size);
    // posteriorOffset is defined in portrait/body local coordinates, not in
    // original world-tile coordinates or the furniture's rotating local frame.
    posteriorOffset.set(finite(o.x),finite(o.y),finite(o.z));
    heldAnchorOffset.set(finite(a.x),finite(a.y),finite(a.z))
      .multiplyScalar(vase.group.scale.x).applyQuaternion(vase.group.quaternion);
    vase.group.position.copy(posteriorLocal).add(posteriorOffset).sub(heldAnchorOffset);
    const base=aimingThrow?.socketBase;
    if(aimingThrow?.vase===vase&&base){
      const live=currentThrowSocketPose();
      if(live?.holder===base.holder){
        // Rigidly carry the assembled furniture along the same animated tool
        // socket used by thrown weapons. Both authored hand targets now follow
        // the real windup/strike rotation right up to the projectile release.
        const delta=live.quaternion.clone().multiply(base.quaternion.clone().invert());
        vase.group.position.sub(base.position).applyQuaternion(delta).add(live.position);
        vase.group.quaternion.premultiply(delta);
      }
    }
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
    const vase=new Burden({...p,group,data,meshColliders:collectMeshColliders(group),
      meshBounds:THREE.Box3?new THREE.Box3():null,
      emitters:null,exploded:false,carried:false});
    if(vase.meshBounds)refreshMeshBounds(vase);
    rec.vases.set(p.id,vase);
    return vase;
  }
  // Branch fruit is the same physical Burden as pottery, with a different
  // impact strategy. The gameplay module owns its mesh after registration.
  function registerFruit(mapId, branch, mesh) {
    if (!branch?.fruit?.available || !mesh || !mapId) return null;
    const targetScene = mesh.parent || scene();
    if (!targetScene) return null;
    const rec = recordFor(mapId, targetScene);
    const stem = 'soursap_' + branch.col + '_' + branch.row; // Branch identity is stable; detached fruits need unique physical IDs.
    let id = stem, serial = 2; // Enables the same tree to regrow while its previous fruit is still intact nearby.
    while (rec.vases.has(id) && !rec.vases.get(id).hanging) id = stem + '_' + serial++;
    const existing = rec.vases.get(id);
    if (existing && !existing.exploded) {
      existing.fruitBranch = branch; // Chunk regeneration replaces branch objects while preserving coordinates.
      return existing.group;
    }
    const group = new THREE.Group();
    group.name = 'soursap_fruit_' + id;
    group.position.copy(mesh.position);
    mesh.position.set(0, 0, 0);
    group.add(mesh);
    targetScene.add(group);
    const carryable = {
      billboardAnchor: { position: { x: 0, y: 0, z: 0 }, posteriorOffset: { x: 0, y: 0, z: 0 }, size: 1 },
      handTargets: {
        left: { x: .11, y: .02, z: 0, rotation: { x: 0, y: 0, z: -80 } },
        right: { x: -.11, y: .02, z: 0, rotation: { x: 0, y: 0, z: 80 } },
      },
      hitbox: { enabled: true, center: { x: 0, y: 0, z: 0 }, size: { x: .32, y: .32, z: .32 } },
    }; // Shared authored-world hand alignment, with a fruit-sized grip and collider.
    const burden = new Burden({
      id, mapId, col: Math.floor(group.position.x), row: Math.floor(group.position.z),
      group, data: { carryable }, kind: 'soursap', fruitBranch: branch, hanging: true,
      meshColliders: collectMeshColliders(group), meshBounds: new THREE.Box3(),
      emitters: null, exploded: false, carried: false, flying: false,
    });
    refreshMeshBounds(burden);
    rec.vases.set(id, burden);
    return group;
  }
  function fruitForBranch(branch, mapId=area()) {
    if (!branch) return null;
    const rec = records.get(mapId);
    return [...(rec?.vases.values() || [])].find(fruit => fruit.kind === 'soursap' && fruit.hanging
      && fruit.fruitBranch?.col === branch.col && fruit.fruitBranch?.row === branch.row) || null;
  }
  function markFruitHarvested(burden) {
    if (!burden?.fruitBranch) return;
    const branch = burden.fruitBranch;
    if (window.HobunjiCloudForestWildlife?.markFruitHarvested)
      window.HobunjiCloudForestWildlife.markFruitHarvested(branch);
    else if (branch.fruit) {
      branch.fruit.available = false;
      branch.fruit.reserved = false;
      branch.fruit.eatenAtHours = Infinity; // Without the biome clock, never duplicate a detached fruit.
    }
    burden.fruitBranch = null;
    burden.hanging = false;
  }
  function discardFruit(branch, mapId=area()) {
    const fruit = fruitForBranch(branch, mapId);
    if (!fruit || !fruit.hanging) return false;
    records.get(mapId)?.vases.delete(fruit.id);
    fruit.group.parent?.remove(fruit.group);
    fruit.exploded = true;
    return true;
  }
  function pickUpFruit(branch, mapId=area()) {
    const fruit = fruitForBranch(branch, mapId);
    if (!fruit || !fruit.hanging || !branch?.fruit?.available) return false;
    if (!pickUp(fruit)) return false;
    markFruitHarvested(fruit); // A detached branch cannot grow a duplicate while one is carried.
    return true;
  }
  function startFruitFall(fruit, cause='shot') {
    if (!fruit || fruit.exploded || fruit.flying) return false;
    const rec = records.get(fruit.mapId);
    if (!rec) return false;
    fruit.group.updateWorldMatrix?.(true, true);
    const world = fruit.group.getWorldPosition(new THREE.Vector3());
    if (held === fruit) {
      cancelShatterAim(); setHeldRearXray(null); held = null;
      prompt(); deps()?.refreshActionBar?.();
    }
    rec.scene.add(fruit.group);
    fruit.group.position.copy(world);
    fruit.group.quaternion.identity();
    fruit.group.scale.setScalar(1);
    markFruitHarvested(fruit);
    fruit.carried = false;
    fruit.flying = true;
    fruit.hanging = false;
    fruit.col = Math.floor(world.x); fruit.row = Math.floor(world.z);
    fallingFruits.set(fruit.id, { fruit, velocity: 0, cause }); // Gravity and collision resolved once per frame in tick().
    lastEvent = 'falling Soursap Fruit ' + fruit.id + ' via ' + cause;
    return true;
  }
  function releaseFruitFromTree(mapId, col, row) {
    const rec = records.get(mapId);
    const fruit = [...(rec?.vases.values() || [])].find(obj => obj.kind === 'soursap'
      && obj.hanging && obj.fruitBranch?.col === col && obj.fruitBranch?.row === row);
    if (!fruit) return false;
    const spot = nearestOpen(grid(), col, row, 3) || { col, row };
    markFruitHarvested(fruit);
    fruit.col = spot.col; fruit.row = spot.row;
    fruit.group.position.set(spot.col + .5, baseHeight(spot.col, spot.row) + .16, spot.row + .5);
    fruit.hanging = false; fruit.flying = false;
    refreshMeshBounds(fruit);
    if(!looseFruitHistory.has(mapId))looseFruitHistory.set(mapId,new Map());
    looseFruitHistory.get(mapId).set(fruit.id,{col:spot.col,row:spot.row,treeCol:col,treeRow:row});
    persistWorld(); // Safe fruit survives departure/return without exploding or respawning in the tree.
    lastEvent = 'tree-felled safe Soursap Fruit ' + fruit.id;
    return true;
  }
  function updateFruitFalls(dt) {
    for (const [id, state] of fallingFruits) {
      const fruit = state.fruit;
      if (!fruit || fruit.exploded || fruit.mapId !== area()) { fallingFruits.delete(id); continue; }
      state.velocity -= 13 * dt;
      const y = thrownGround(fruit.group.position.x, fruit.group.position.z) + .15;
      fruit.group.position.y = Math.max(y, fruit.group.position.y + state.velocity * dt);
      fruit.group.rotation.z += dt * 5;
      if (fruit.group.position.y <= y + .002) {
        fallingFruits.delete(id);
        detonate(fruit, state.cause + '-ground-impact');
      }
    }
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
    if(!cask||cask.exploded||cask.flying||held||cask.mapId!==area())return false;
    // The contextual Tool Select press stows whatever is held automatically.
    window.ActionArcUI?.stowForCarry?.();
    held=cask;cask.carried=true;
    alignHeldVase(cask);
    setHeldRearXray(cask);
    Object.assign(lastEquipment,switchEquipment());
    lastEvent='picked up '+cask.id;
    prompt(); // Claim Action 1/2 immediately after the Tool Select pickup.
    deps()?.refreshActionBar?.(); // Rebuild native tool/item slots on every input device.
    deps()?.showToast?.('Carrying ' + cask.displayName + ' — Action 1: hold and release to throw; Action 2: drop.',false);
    return true;
  }
  function drop() {
    if(!held)return false;
    if (held.kind === 'soursap') return startFruitFall(held, 'drop'); // Fruit bursts when physically dropped; chopping its tree is the safe release.
    cancelShatterAim();setHeldRearXray(null);
    const cask=held,p=playerPosition(),g=grid();
    const origin=p?nearestOpen(g,Math.round(p.x-.5),Math.round(p.z-.5),2):null;
    if(origin){cask.col=origin.col;cask.row=origin.row;}
    records.get(cask.mapId)?.scene.add(cask.group);
    cask.group.quaternion?.identity?.();
    cask.group.scale?.setScalar?.(1);
    cask.group.position.set(cask.col+.5,baseHeight(cask.col,cask.row),cask.row+.5);
    refreshMeshBounds(cask);
    cask.carried=false;held=null;
    prompt(); // Immediately restore nearby normal world interactions.
    deps()?.refreshActionBar?.();
    lastEvent='dropped '+cask.id;
    return true;
  }
  function nearInteraction() {
    const p=playerPosition(),rec=records.get(area());
    if(!p||!rec)return null;
    let choice=null,smallest=1.65;
    for(const vase of rec.vases.values()) {
      if(vase.exploded||vase.carried||vase.flying||vase.hanging)continue;
      const d=distance(p,{x:vase.col+.5,z:vase.row+.5});
      if(d<smallest){smallest=d;choice={type:'vase',obj:vase};}
    }
    for(const pile of rec.piles.values()) {
      const d=distance(p,{x:pile.col+.5,z:pile.row+.5});
      if(d<smallest){smallest=d;choice={type:'pile',obj:pile};}
    }
    return choice;
  }
  // Shares AlchemyFlasks' camera-ground projection, maximum throw radius,
  // ballistic duration, and sinusoidal height. This is the *physical* furniture.
  function thrownGround(x,z){
    const d=deps(),t=tileSize();
    return Number(d?.getGroundYAtWorld?.(x,z)??d?.getGroundY?.(x*t,z*t)
      ??d?.worldSurfaceY?.(x*t,z*t))||0;
  }
  // Camera-aligned ground heading, in the same X/Z frame as AlchemyFlasks
  // and RangedCameraRayAuthority. Screen drag must never be assumed to be
  // fixed world +X/-Z: the camera rotates around the player.
  function throwHeading(){
    const p=playerPosition(),d=deps();
    const ray=d?.getPlayerInteractionRay?.()||carryDeps()?.getPlayerInteractionRay?.()
      ||window.__hitboxDebug?.interactionRay;
    const dx=Number(ray?.direction?.x),dz=Number(ray?.direction?.z);
    const len=Math.hypot(dx,dz);
    if(Number.isFinite(len)&&len>1e-5)return {x:dx/len,z:dz/len,source:'camera-ray'};
    const angle=Number(d?.getAimAngle?.()??p?.angle??0);
    return {x:Math.cos(angle),z:Math.sin(angle),source:'player-aim'};
  }
  function throwTarget(){
    const p=playerPosition(),d=deps();
    if(!p)return null;
    if(aimingThrow?.manualTarget)return aimingThrow.manualTarget;
    const heading=throwHeading();
    let x=p.x+heading.x*3,z=p.z+heading.z*3;
    const ray=d?.getPlayerInteractionRay?.()||carryDeps()?.getPlayerInteractionRay?.()
      ||window.__hitboxDebug?.interactionRay;
    if(ray?.origin&&ray?.direction){
      let prev=null,found=false;
      for(let t=0;t<=36;t+=.22){
        const px=ray.origin.x+ray.direction.x*t,pz=ray.origin.z+ray.direction.z*t;
        const gap=ray.origin.y+ray.direction.y*t-thrownGround(px,pz);
        if(gap<=.035&&prev?.gap>.035){
          const ratio=prev.gap/(prev.gap-gap||1);
          x=prev.x+(px-prev.x)*ratio;z=prev.z+(pz-prev.z)*ratio;
          found=true;break;
        }
        prev={x:px,z:pz,gap};
      }
      if(!found){
        const h=Math.hypot(ray.direction.x,ray.direction.z)||1;
        x=p.x+MAX_THROW_RADIUS*ray.direction.x/h;
        z=p.z+MAX_THROW_RADIUS*ray.direction.z/h;
      }
    }
    let dx=x-p.x,dz=z-p.z,len=Math.hypot(dx,dz);
    // At a steep camera pitch the ray can hit terrain BETWEEN the camera and
    // player, i.e. BEHIND the hand. Reject that surface rather than launching
    // backward toward the camera (the old low-crosshair failure).
    if(dx*heading.x+dz*heading.z<.5){
      x=p.x+heading.x*3;z=p.z+heading.z*3;
      dx=x-p.x;dz=z-p.z;len=Math.hypot(dx,dz);
    }
    if(len>MAX_THROW_RADIUS){x=p.x+dx*MAX_THROW_RADIUS/len;z=p.z+dz*MAX_THROW_RADIUS/len;}
    return {x,y:thrownGround(x,z),z};
  }
  function showThrowRing(target){
    if(!target||!THREE.RingGeometry||!THREE.MeshBasicMaterial)return;
    if(!throwRing){
      // Match the flask's filled, radially subdivided ground preview so the
      // entire blast footprint follows terrain rather than cutting into it.
      throwRing=new THREE.Mesh(new THREE.RingGeometry(0,1,48,6),
        new THREE.MeshBasicMaterial({color:0xffb45e,side:THREE.DoubleSide,transparent:true,
          opacity:.24,depthWrite:false}));
      window.EnvironmentSurfaceMicroPlateau?.bindGroundProjection(throwRing);
      throwRing.rotation.x=-Math.PI/2;
      throwRing.renderOrder=40;
      throwRing.name='shattercask_ground_projected_throw_reticle';
    }
    const active=scene();if(!active)return;
    if(throwRing.parent!==active)active.add(throwRing);
    const groundY=thrownGround(target.x,target.z); // Same landing surface used by the physical throw.
    const changed=throwRing.userData.targetX!==target.x||throwRing.userData.targetZ!==target.z
      ||throwRing.userData.groundY!==groundY
      ||throwRing.userData.radius!==(held?.kind === 'soursap' ? FRUIT_RADIUS : RADIUS); // Resample only when the target or its terrain height changes.
    throwRing.position.set(target.x,groundY+.035,target.z);
    const previewRadius = held?.kind === 'soursap' ? FRUIT_RADIUS : RADIUS; // Burden-specific AOE on the same projected reticle.
    throwRing.scale.setScalar(previewRadius);
    if(changed){
      const positions=throwRing.geometry.attributes?.position; // Local Z becomes height after the ground-plane rotation.
      if(positions){
        for(let index=0;index<positions.count;index++){
          positions.setZ(index,(thrownGround(target.x+positions.getX(index)*previewRadius,
            target.z-positions.getY(index)*previewRadius)-groundY)/previewRadius);
        }
        positions.needsUpdate=true;
        throwRing.geometry.computeBoundingSphere?.();
      }
      Object.assign(throwRing.userData,{targetX:target.x,targetZ:target.z,groundY,radius:previewRadius});
    }
    throwRing.visible=true;
  }
  function cancelShatterAim(){
    if(aimingThrow?.phase==='aim'&&aimingThrow.sharedPose)cancelSharedThrowVisual();
    aimingThrow=null;
    if(throwRing)throwRing.visible=false;
  }
  function pointThrowFromDrag(dx,dy){
    if(aimingThrow?.phase!=='aim')return;
    const p=playerPosition(),mag=Math.hypot(dx,dy);
    if(!p||mag<7)return;
    const range=Math.min(MAX_THROW_RADIUS,mag/240*MAX_THROW_RADIUS);
    const forward=throwHeading(),right={x:-forward.z,z:forward.x};
    const vx=right.x*dx-forward.x*dy,vz=right.z*dx-forward.z*dy;
    const length=Math.hypot(vx,vz)||1;
    const x=p.x+vx/length*range,z=p.z+vz/length*range;
    aimingThrow.manualTarget={x,y:thrownGround(x,z),z};
    aimingThrow.target=aimingThrow.manualTarget;
    showThrowRing(aimingThrow.target);
  }
  function startShatterAim(){
    if(!held||aimingThrow)return false;
    const socketBase=currentThrowSocketPose(); // Capture before the shared pose starts moving the holder.
    const sharedPose=beginSharedThrowVisual();
    aimingThrow={vase:held,phase:'aim',elapsed:0,target:throwTarget(),rayElapsed:0,sharedPose,
      socketBase:sharedPose?socketBase:null};
    showThrowRing(aimingThrow.target);
    lastEvent='started ' + held.displayName + ' throw aim';
    return true;
  }
  function releaseShatterAim(){
    if(!held||aimingThrow?.phase!=='aim')return false;
    aimingThrow.target=throwTarget()||aimingThrow.target;
    showThrowRing(aimingThrow.target); // Release can land between the 75ms aim samples.
    if(aimingThrow.sharedPose)releaseSharedThrowVisual();
    aimingThrow.phase='releasing';aimingThrow.elapsed=0;
    return true;
  }
  function launchShattercask(){
    if(!held||!aimingThrow?.target)return false;
    const c=held;
    let target=aimingThrow.target;
    c.group.updateWorldMatrix?.(true,true);
    const origin=c.group.getWorldPosition?.(new THREE.Vector3())||c.group.position.clone();
    const quat=c.group.getWorldQuaternion?.(new THREE.Quaternion())||c.group.quaternion.clone();
    const scale=c.group.getWorldScale?.(new THREE.Vector3())||c.group.scale.clone();
    // The held mesh starts a little IN FRONT of the player's posterior. A
    // target just beyond the player's feet can thus be behind its actual
    // release point even if it was ahead of the player. Guarantee forward
    // travel from the physical release position, not only from player center.
    const heading=throwHeading();
    const deltaX=target.x-origin.x,deltaZ=target.z-origin.z;
    if(deltaX*heading.x+deltaZ*heading.z<.4){
      const distance=Math.min(MAX_THROW_RADIUS,Math.max(3,Math.hypot(deltaX,deltaZ)));
      target={x:origin.x+heading.x*distance,z:origin.z+heading.z*distance};
      target.y=thrownGround(target.x,target.z);
    }
    const active=records.get(c.mapId)?.scene||scene();
    if(!active)return false;
    setHeldRearXray(null);
    active.add(c.group);c.group.position.copy(origin);
    c.group.quaternion.copy(quat);c.group.scale.copy(scale);
    c.carried=false;c.flying=true;held=null;cancelShatterAim();
    prompt();deps()?.refreshActionBar?.(); // Return the ordinary actions when the thrown cask leaves the hand.
    const distanceTiles=Math.hypot(target.x-origin.x,target.z-origin.z);
    flight={vase:c,origin,target,distanceTiles,
      duration:window.AlchemyFlasks?.flightDuration?.(distanceTiles)
        ??Math.min(.9,Math.max(.42,.42+distanceTiles*.034)),t:0};
    lastEvent='launched ' + c.displayName + ' ' + c.id;
    return true;
  }
  function updateShatterThrow(dt){
    dt=Math.min(.1,Math.max(0,Number(dt)||0));
    if(aimingThrow){
      aimingThrow.elapsed+=dt;
      if(aimingThrow.phase==='aim'){
        aimingThrow.rayElapsed+=dt;
        if(aimingThrow.rayElapsed>.075){
          aimingThrow.rayElapsed=0;aimingThrow.target=throwTarget()||aimingThrow.target;
          showThrowRing(aimingThrow.target);
        }
      }else if(aimingThrow.elapsed>=(aimingThrow.sharedPose?authoredReleaseDelay():SHATTER_RELEASE_FALLBACK))launchShattercask();
    }
    if(flight){
      const f=flight,c=f.vase;
      f.t+=dt;
      const ratio=Math.min(1,f.t/f.duration);
      if(window.AlchemyFlasks?.flightPosition)
        window.AlchemyFlasks.flightPosition(f.origin,f.target,ratio,f.distanceTiles,c.group.position);
      else{
        const arc=Math.sin(Math.PI*ratio)*Math.min(1.65,.72+f.distanceTiles*.065);
        c.group.position.set(f.origin.x+(f.target.x-f.origin.x)*ratio,
          f.origin.y+(f.target.y-f.origin.y)*ratio+arc,
          f.origin.z+(f.target.z-f.origin.z)*ratio);
      }
      c.group.rotation.set(f.t*8,0,f.t*5);
      // There is no heldHandTarget after launch: hands stay on the player.
      if(ratio>=1){flight=null;detonate(c,'throw-impact');}
    }
  }
  // Existing tool/item Action 1 and 2 slots are the only carried controls.
  // The native action-bar renderer positions them, avoiding extra mobile buttons.
  const CARRIED_ACTION_BUTTONS=Object.freeze([
    Object.freeze({icon:'↗',label:'Throw Shattercask',action:'shattercask_throw',inputAction:'action1',style:'primary',allowed:true}),
    Object.freeze({icon:'⬇',label:'Drop Shattercask',action:'shattercask_drop',inputAction:'action2',style:'secondary',allowed:true}),
  ]); // Shared by computeActionButtonsImpl while carrying; no per-frame allocations.
  const CARRIED_FRUIT_ACTION_BUTTONS=Object.freeze([
    Object.freeze({icon:'↗',label:'Throw Soursap Fruit',action:'shattercask_throw',inputAction:'action1',style:'primary',allowed:true}),
    Object.freeze({icon:'⬇',label:'Drop Soursap Fruit',action:'shattercask_drop',inputAction:'action2',style:'secondary',allowed:true}),
  ]); // Shares action IDs; only burden-specific labels and impact payload change.
  function actionButtons(){return held?(held.kind==='soursap'?CARRIED_FRUIT_ACTION_BUTTONS:CARRIED_ACTION_BUTTONS):null;}
  function grantLoot(items) {
    if(typeof audioDeps?.grantLoot==='function')return audioDeps.grantLoot(items);
    const inv=gameDeps?.inventory||deps()?.inventory;
    if(!inv)return [];
    const gained=[];
    for(const [item,count] of Object.entries(items)) {
      if(!(count>0))continue;
      inv[item]=(Number(inv[item])||0)+count;
      gained.push(item+' x'+count);
    }
    return gained;
  }
  function rollRange([min,max]) { return min+Math.floor(Math.random()*(max-min+1)); }
  function rubbleLoot(pile) {
    if(pile.kind==='fruit')return {soursapFruitFlesh:1};
    if(pile.kind==='tree')return {[pile.woodKey||'pineLog']:rollRange(RUBBLE_YIELD.treeLogs),mulch:RUBBLE_YIELD.mulch};
    const items={stone:rollRange(RUBBLE_YIELD.rockStone),pebble:RUBBLE_YIELD.pebble};
    const oreItemKey=pile.oreKey?gameDeps?.oreItemKey?.(pile.oreKey):null;
    if(oreItemKey){
      const ore=Number(window.TownMine?.rollOreYield?.(Math.random,0))||1;
      items[oreItemKey]=ore*RUBBLE_YIELD.oreMultiplier;
      window.TownMine?.recordHeldOres?.([pile.oreKey]);
    }
    return items;
  }
  function collectPile(pile) {
    if(!pile||!records.get(pile.mapId)?.piles.has(pile.id))return false;
    const items=rubbleLoot(pile); // Canonical inventory keys, not descriptive stick/wood pseudo-items.
    grantLoot(items);
    records.get(pile.mapId).piles.delete(pile.id);
    pileHistory.get(pile.mapId)?.delete(pile.id);
    if(offeredPileId===pile.id)offeredPileId=null;
    persistWorld();
    syncPileVisuals(records.get(pile.mapId)); // Rebuild one instanced matrix batch on looting, never remove four separate meshes.
    lastEvent='looted '+pile.id;
    // Each blasted mine rock becomes exactly one rock pile, so collecting it
    // stands in for breaking that rock: it counts down the floor's remaining
    // rocks and rolls the (much higher) rubble descent chance.
    const revealed=pile.kind==='rock'&&!!gameDeps?.tryRevealMineDescent?.(pile.mapId,pile.col,pile.row,'rubble');
    const summary=Object.entries(items).map(([item,count])=>count+' '+(gameDeps?.itemLabel?.(item)||item)).join(', ');
    deps()?.showToast?.('Collected '+summary+'.'+(revealed?' A hole leading deeper has been revealed!':''),true);
    deps()?.refreshActionBar?.();
    return true;
  }
  // Aimed rubble is an ordinary action-arch context button (touch arch,
  // desktop Interact, controller Interact and the floating prompt all read
  // computeActionButtons), like an aimed corpse. Intact casks are not: an
  // arch button would replace the weapon slot that melee-detonates them, so
  // they keep Tool Select pickup plus the Interact claim in prompt().
  function aimedPile(reticle) {
    if(held||!reticle)return null;
    const p=playerPosition(),rec=records.get(area());
    if(!p||!rec?.piles.size)return null;
    let sticky=null;
    for(const pile of rec.piles.values()){
      if(distance(p,{x:pile.col+.5,z:pile.row+.5})>=PILE_REACH)continue;
      if(pile.col===reticle.col&&pile.row===reticle.row)return pile;
      if(pile.id===offeredPileId)sticky=pile;
    }
    return sticky;
  }
  function contextButtons(reticle) {
    const pile=aimedPile(reticle);
    offeredPileId=pile?.id||null;
    if(!pile)return null;
    if(!pile.contextButtons){
      const anchor=pile.promptAnchor||(pile.promptAnchor=new THREE.Object3D());
      anchor.position.set(pile.col+.5,pile.y+.25,pile.row+.5);
      if(!anchor.parent)records.get(pile.mapId)?.scene.add(anchor);
      pile.contextButtons=Object.freeze([Object.freeze({
        icon:pile.kind==='fruit'?'🍈':pile.kind==='tree'?'🪵':'🪨',
        label:pile.kind==='fruit'?'Collect Soursap Fruit Flesh':pile.kind==='tree'?'Collect Sticks':'Collect Rubble',
        action:'shattercask_collect',style:'primary',allowed:true,worldInteraction:true,
        inputAction:'interact',promptRoot:anchor,
      })]); // Cached per pile: computeActionButtons runs every frame.
    }
    return pile.contextButtons;
  }
  function collectAimedPile(reticle) {
    const pile=aimedPile(reticle);
    return pile?collectPile(pile):false;
  }
  function interact() {
    if(held)return drop();
    const target=nearInteraction();
    if(target?.type==='vase')return pickUp(target.obj);
    if(target?.type==='pile')return collectPile(target.obj);
    return false;
  }
  // Choose a live physical Shattercask in the look cone; closer rubble
  // must not steal the context action from the object under the reticle.
  function facedShattercask() {
    const p=playerPosition(),rec=records.get(area());
    if(!p||!rec)return null;
    const ray=deps()?.getPlayerInteractionRay?.()||carryDeps()?.getPlayerInteractionRay?.();
    const forward=ray?.direction
      ?{x:Number(ray.direction.x)||0,z:Number(ray.direction.z)||0}
      :{x:Math.cos(p.angle),z:Math.sin(p.angle)};
    const origin=ray?.origin||{x:p.x,z:p.z};
    const mag=Math.hypot(forward.x,forward.z)||1;
    let result=null,closest=1.65;
    for(const cask of rec.vases.values()){
      if(cask.exploded||cask.carried||cask.flying||cask.hanging)continue;
      const dx=cask.col+.5-p.x,dz=cask.row+.5-p.z,d=Math.hypot(dx,dz);
      if(d>=closest)continue;
      const vx=cask.col+.5-origin.x,vz=cask.row+.5-origin.z;
      const toward=Math.hypot(vx,vz)||1;
      const cosine=(forward.x*vx+forward.z*vz)/(mag*toward);
      if(d>.3 && cosine < (ray?.direction?.x != null ? .75 : .25))continue;
      result=cask;closest=d;
    }
    return result;
  }
  function toolArchAction(){return !held&&facedShattercask()?'pickup':null;}
  function toolArchTap(){return toolArchAction()==='pickup'&&pickUp(facedShattercask());}
  let lastToolArchAction=null;
  function syncToolArchPickup() {
    if(typeof document==='undefined')return;
    const btn=document.getElementById?.('toolBtn');
    if(!btn)return;
    const action=toolArchAction();
    if(action===lastToolArchAction)return;
    lastToolArchAction=action;
    btn.classList?.toggle?.('shattercask-context',!!action);
    if(action){
      btn.dataset.shattercaskIcon='✋';
      btn.setAttribute?.('aria-label','Pick up ' + facedShattercask().displayName);
      btn.title='Pick up ' + facedShattercask().displayName;
    }else{
      btn.removeAttribute?.('data-shattercask-icon');
      btn.setAttribute?.('aria-label','Select tool, or dequip if a tool is already out');
      btn.title='';
    }
  }
  function nearVase() {
    const target=held?null:nearInteraction();
    return target?.type==='vase'?target.obj:null;
  }
  function prompt() {
    // Carried furniture uses normal press/release Action 1 and 2, not
    // Interact or the optional, normally unbound Action 4/5 inputs. A nearby
    // intact cask claims Interact; rubble is an ordinary arch button instead
    // (see contextButtons) so touch players can collect it too.
    const vase=nearVase();
    const claim=held?'carried:'+held.id:vase?'vase:'+vase.id:'';
    if(claim!==promptClaim){
      if(held)window.WorldActionInputClaims?.setClaims?.('shattercask',[
        {actionId:'action1',label:'Throw ' + held.displayName,priority:810,
          onPress:startShatterAim,onRelease:detail=>detail?.canceled?cancelShatterAim():releaseShatterAim()},
        {actionId:'action2',label:'Drop ' + held.displayName,priority:810,onPress:drop},
      ]);
      else if(vase)window.WorldActionInputClaims?.setClaims?.('shattercask',
        [{actionId:'interact',label:'Pick up ' + vase.displayName,priority:410,onPress:interact}]);
      else window.WorldActionInputClaims?.clearClaims?.('shattercask');
      promptClaim=claim;
      if(vase&&!vase.promptButtons)vase.promptButtons=Object.freeze([Object.freeze({
        icon:'✋',label:'Pick up ' + vase.displayName,action:'shattercask_pickup_prompt',allowed:true,
        worldInteraction:true,inputAction:'interact',promptRoot:vase.group,
      })]);
    }
  }
  // Prompt-only rows merged into game.js's single floating-prompt pass. The
  // module used to draw its own WorldPopupText list, which game.js's
  // per-frame sync cleared ~120ms later: the visible prompt flicker.
  function promptButtons() {
    if(held||!promptClaim.startsWith('vase:'))return null;
    if(window.WorldActionInputClaims?.claimFor?.('interact')?.ownerId!=='shattercask')return null;
    const vase=records.get(area())?.vases.get(promptClaim.slice(5));
    return vase&&!vase.exploded&&!vase.carried?vase.promptButtons||null:null;
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
    if(!sharedPileArt?.rock)sharedPileArt={...sharedPileArt,
      rock:{geometry:new THREE.DodecahedronGeometry(.18,0),
        material:new THREE.MeshLambertMaterial({color:0x817b74})},
      tree:{geometry:new THREE.CylinderGeometry(.045,.065,.55,5),
        material:new THREE.MeshLambertMaterial({color:0x7b5936})},
      fruit:{geometry:new THREE.DodecahedronGeometry(.10,0),
        material:new THREE.MeshLambertMaterial({color:0xd98e3b})},
    }; // Shared geometries/materials are never disposed with an individual pile.
    const transform=new THREE.Object3D(); // Reused scratch for the complete rebuild, two GPU instance buffers maximum per area.
    for(const kind of ['rock','tree','fruit']){
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
  function spawnPile(mapId,rec,col,row,kind,y,woodKey='pineLog',oreKey=null,sourceId=null,restoredId=null) {
    const baseId=kind+'_'+col+'_'+row+(sourceId?'_'+sourceId:''); // Unique source keeps nearby fruit piles distinct.
    let id=restoredId||baseId;
    if(!restoredId && kind==='fruit'){
      let serial=2;
      while(rec.piles.has(id))id=baseId+'_'+serial++;
    } else if(rec.piles.has(id))return;
    rec.piles.set(id,{id,col,row,kind,woodKey,oreKey,y,mapId}); // Logical loot records are distinct from the pooled GPU instance geometry.
    if(!pileHistory.has(mapId))pileHistory.set(mapId,new Map());
    pileHistory.get(mapId).set(id,{col,row,kind,woodKey,oreKey}); // Persist once after the full blast, not once per pile.
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
      const oreKey=kind==='rock'?tile.oreKey||null:null; // Mine/zone ore nodes keep their ore in the rubble instead of vanishing.
      tile.type=types.GRASS||'grass';
      if(kind==='rock') {
        window.CavernOreRocks?.removeVisual?.(mapId,col,row); // O(1) tile-index removal, never a full THREE.Scene traversal per rock.
        gameDeps?.removeZoneMineableRockVisual?.(mapId,col,row); // Zone and town-mine rock mounds.
      } else {
        window.ZoneRegrowth?.updateClearedZoneVegetationVisual?.(mapId,col,row,priorType);
        gameDeps?.removeZoneVegetationVisual?.(mapId,col,row);
      }
      delete tile.rockKind;delete tile.oreKind;delete tile.oreKey;delete tile.caveSeparator;
      const woodKey=String(tile.treeKind||tile.generatedObjectType||'').toLowerCase().includes('shadewood')?'shadewoodLog':'pineLog';
      spawnPile(mapId,rec,col,row,kind,floor,woodKey,oreKey);
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
  function restoreLooseFruit(mapId, rec) {
    const history=looseFruitHistory.get(mapId);
    if(!history?.size)return;
    for(const [id,info] of history) {
      if(rec.vases.has(id)||!Number.isFinite(info?.col)||!Number.isFinite(info?.row))continue;
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(.15,8,6),
        new THREE.MeshStandardMaterial({color:0xd9542b,roughness:.6,metalness:.05}));
      mesh.position.set(info.col+.5,baseHeight(info.col,info.row)+.16,info.row+.5);
      const branch={col:info.treeCol??info.col,row:info.treeRow??info.row,
        fruit:{available:true,reserved:false}}; // Constructor-only stand-in; never registered as a climbable branch.
      registerFruit(mapId,branch,mesh); // Reuse the same collider, Burden, world grip and throw setup.
      const fruit=fruitForBranch(branch,mapId);
      if(!fruit)continue;
      rec.vases.delete(fruit.id);
      fruit.id=id;fruit.group.name='soursap_fruit_'+id;
      fruit.fruitBranch=null;fruit.hanging=false;
      fruit.col=info.col;fruit.row=info.row;
      rec.vases.set(id,fruit);
    }
  }
  function restoreSceneHistory(mapId,rec) {
    const savedTerrain=terrainHistory.get(mapId),savedPiles=pileHistory.get(mapId),savedFruit=looseFruitHistory.get(mapId);
    if(!savedTerrain?.size&&!savedPiles?.size&&!savedFruit?.size)return;
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
      spawnPile(mapId,rec,info.col,info.row,info.kind,baseHeight(info.col,info.row),info.woodKey,info.oreKey||null,null,id);
    if(rec.piles.size)syncPileVisuals(rec);
    restoreLooseFruit(mapId,rec);
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
  function applyFruitBlast(mapId,x,z) {
    const d=deps(),tile=tileSize(),player=d?.player;
    const targets=[player,...(d?.hostileObjects||[]),...(d?.npcWalkers||[])];
    const seen=new Set();
    for(const actor of targets) {
      if(!actor||seen.has(actor)||actor.health<=0||(actor.areaId&&actor.areaId!==mapId)||(actor.area&&actor.area!==mapId))continue;
      seen.add(actor);
      const dist=Math.hypot(Number(actor.x)/tile-x,Number(actor.y)/tile-z);
      if(!Number.isFinite(dist)||dist>FRUIT_RADIUS)continue;
      const damage=Math.max(2,FRUIT_DAMAGE*(1-.65*dist/FRUIT_RADIUS));
      const opts={tag:'blunt',environmental:true,reason:'Soursap Fruit impact'};
      if(actor===player)d?.damagePlayer?.(damage,x*tile,z*tile,125,opts);
      else if(d?.hostileObjects?.has?.(actor))d?.damageCreature?.(actor,damage,x*tile,z*tile,125,opts);
      else window.ResourceSystem?.applyDamage?.(actor,damage,opts);
      window.ResourceSystem?.spendFooting?.(actor,Math.max(5,15*(1-dist/FRUIT_RADIUS)),'Soursap impact');
      window.RangedWeapons?.applySpecialAmmoDebuff?.(actor,'concussive'); // Reuse exact reversed-input Disorient effect.
      window.RangedWeapons?.applySticky?.(actor,2200); // Sticky: 20% movement for 2.2 seconds.
    }
  }
  function fruitBurstVisual(targetScene,x,z,y) {
    if(!targetScene)return;
    // Same cheap instanced spray update as Shattercask debris, but amber flesh rather than pottery.
    if(!sharedPileArt)sharedPileArt={};
    if(!sharedPileArt.fruitBurst)sharedPileArt.fruitBurst={
      geometry:new THREE.DodecahedronGeometry(.10,0),
      material:new THREE.MeshLambertMaterial({color:0xd98e3b}),
      flashGeometry:new THREE.SphereGeometry(1,12,8),
    };
    const count=24,art=sharedPileArt.fruitBurst;
    const spray=new THREE.InstancedMesh(art.geometry,art.material,count);
    const group=new THREE.Group();group.position.set(x,y,z);group.add(spray);targetScene.add(group);
    const flash=new THREE.Mesh(art.flashGeometry,new THREE.MeshBasicMaterial({
      color:0xd4d96b,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending}));
    flash.position.set(x,y,z);flash.scale.setScalar(.15);targetScene.add(flash);
    const parts=[];
    for(let i=0;i<count;i++){
      const angle=i*2.399963;
      parts.push({x:0,y:0,z:0,vx:Math.cos(angle)*(1.5+i%5*.28),
        vz:Math.sin(angle)*(1.5+i%5*.28),vy:1.4+(i%7)*.18,batch:0,index:i});
    }
    burstEffects.push({group,shardMeshes:[spray],parts,flash,age:0,duration:.90,radius:FRUIT_RADIUS,
      dummy:new THREE.Object3D()});
    window.AudioSystem?.playWeaponHitSfx?.('blunt',x*tileSize(),z*tileSize(),area(),undefined,'medium');
  }
  function detonateFruit(fruit,cause) {
    if(!fruit||fruit.exploded)return false;
    fruit.group.updateWorldMatrix?.(true,true);
    const world=fruit.group.getWorldPosition(new THREE.Vector3());
    if(held===fruit){held=null;cancelShatterAim();setHeldRearXray(null);prompt();deps()?.refreshActionBar?.();}
    fallingFruits.delete(fruit.id);
    looseFruitHistory.get(fruit.mapId)?.delete(fruit.id);
    const rec=records.get(fruit.mapId);
    fruit.exploded=true;fruit.flying=false;
    markFruitHarvested(fruit);
    fruit.group.parent?.remove(fruit.group);
    rec?.vases.delete(fruit.id);
    const x=world.x,z=world.z,y=thrownGround(x,z)+.16;
    fruitBurstVisual(rec?.scene||scene(),x,z,y);
    applyFruitBlast(fruit.mapId,x,z);
    if(rec){
      const col=Math.floor(x),row=Math.floor(z);
      spawnPile(fruit.mapId,rec,col,row,'fruit',baseHeight(col,row),'pineLog',null,fruit.id);
      syncPileVisuals(rec);persistWorld();
    }
    lastEvent='Soursap burst ' + fruit.id + ' via ' + cause;
    window.__farmLog?.('[burden] '+lastEvent,'world');
    return true;
  }
  function detonate(cask,cause='weapon') {
    if(!cask||cask.exploded)return false;
    if(cask.kind==='soursap')return detonateFruit(cask,cause);
    cask.exploded=true;
    if(held===cask){cancelShatterAim();held=null;setHeldRearXray(null);prompt();deps()?.refreshActionBar?.();}
    if(flight?.vase===cask)flight=null;
    const rec=records.get(cask.mapId);
    const impact={x:cask.group.position.x,y:cask.group.position.y,z:cask.group.position.z};
    if((cask.carried||cask.flying)&&cask.group.getWorldPosition&&carriedWorldPosition){
      const world=cask.group.getWorldPosition(carriedWorldPosition);
      impact.x=world.x;impact.y=world.y;impact.z=world.z;
    }
    cask.group.parent?.remove(cask.group);
    disposeEmitters(cask);
    rec?.vases.delete(cask.id);
    saveConsumed(cask.mapId+':'+cask.id);
    const x=impact.x,z=impact.z;
    const y=(cask.carried||cask.flying)?impact.y:baseHeight(cask.col,cask.row)+.30; // A charge shot out of someone's hands explodes where it is actually held.
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
      const box=worldHitbox(vase);
      const cx=box?(box.min.x+box.max.x)/2:vase.col+.5;
      const cz=box?(box.min.z+box.max.z)/2:vase.row+.5;
      const centerY=box?(box.min.y+box.max.y)/2:baseHeight(vase.col,vase.row)+.35;
      const radius=box?Math.hypot(box.max.x-box.min.x,box.max.z-box.min.z)/2:.3;
      const height=box?(box.max.y-box.min.y)/2:.40;
      const dx=cx-collider.origin.x,dz=cz-collider.origin.z;
      const radial=Math.hypot(dx,dz);
      if(radial>collider.horizontalRangeWorld+radius)continue;
      const delta=Math.abs(Math.atan2(Math.sin(Math.atan2(dz,dx)-collider.yaw),Math.cos(Math.atan2(dz,dx)-collider.yaw)));
      if(delta>(collider.halfConeRad||.5)+.10)continue;
      const expectedY=collider.origin.y+collider.verticalRiseWorld*radial/Math.max(.1,collider.horizontalRangeWorld);
      if(Math.abs(expectedY-centerY)>collider.halfHeightWorld+height)continue;
      detonate(vase,'melee');break;
    }
  }
  function projectileHit(start,end,radius,limit,mapId) {
    const rec=records.get(mapId);
    if(!rec?.vases.size || !shatterRaycaster || !shatterRayStart)return null;
    const fraction=Number(limit),cap=Number.isFinite(fraction)?Math.max(0,Math.min(1,fraction)):1;
    if(cap<=0)return null;
    shatterRayStart.set(start.x,start.y,start.z);
    shatterRayDirection.set(end.x-start.x,end.y-start.y,end.z-start.z);
    const length=shatterRayDirection.length();
    if(length<=1e-7)return null;
    shatterRayDirection.multiplyScalar(1/length);
    const pad=Math.max(0,Number(radius)||0),maxDistance=length*cap;
    // Perpendicular offsets approximate the finite projectile radius while
    // every accepted contact still intersects real mesh triangles.
    shatterRayAcross.set(-shatterRayDirection.z,0,shatterRayDirection.x);
    if(shatterRayAcross.lengthSq()<1e-8)shatterRayAcross.set(1,0,0);
    shatterRayAcross.normalize();
    shatterRayUp.crossVectors(shatterRayDirection,shatterRayAcross).normalize();
    shatterRaycaster.near=0;
    shatterRaycaster.far=maxDistance;
    shatterRaycaster.ray.direction.copy(shatterRayDirection);
    let result=null;
    meshRaycastQueries++;
    for(const vase of rec.vases.values()){
      if(vase.exploded || vase.flying || !vase.meshColliders?.length)continue;
      if(vase.carried)refreshMeshBounds(vase);
      else vase.group.updateWorldMatrix?.(true,true);
      if(vase.meshBounds && shatterRayBox && shatterRayBoxPoint) {
        shatterRayBox.copy(vase.meshBounds).expandByScalar(pad);
        shatterRaycaster.ray.origin.copy(shatterRayStart);
        const broadHit=shatterRaycaster.ray.intersectBox(shatterRayBox,shatterRayBoxPoint);
        if(!broadHit || shatterRayStart.distanceTo(broadHit)>maxDistance+pad) {
          meshRaycastBroadphaseRejects++;continue;
        }
      }
      // Explicit authored collision is decisive when enabled; the old exact
      // triangle raycast remains available for legacy furniture without a box.
      const hitbox=worldHitbox(vase);
      if(hitbox && shatterRayBoxPoint){
        for(const [sx,sy] of (pad>0?RAY_SAMPLES:[RAY_SAMPLES[0]])){
          shatterRayOffset.copy(shatterRayAcross).multiplyScalar(sx*pad).addScaledVector(shatterRayUp,sy*pad);
          shatterRaycaster.ray.origin.copy(shatterRayStart).add(shatterRayOffset);
          const hit=shatterRaycaster.ray.intersectBox(hitbox,shatterRayBoxPoint);
          if(hit){
            const d=shatterRaycaster.ray.origin.distanceTo(hit);
            if(d<=maxDistance && (!result||d<result.t*length))result={t:d/length,vase};
          }
        }
        continue;
      }
      for(const [sx,sy] of (pad>0?RAY_SAMPLES:[RAY_SAMPLES[0]])) {
        shatterRayOffset.copy(shatterRayAcross).multiplyScalar(sx*pad)
          .addScaledVector(shatterRayUp,sy*pad);
        shatterRaycaster.ray.origin.copy(shatterRayStart).add(shatterRayOffset);
        shatterRayHits.length=0;
        meshRaycastTriangleQueries++;
        shatterRaycaster.intersectObjects(vase.meshColliders,false,shatterRayHits);
        if(shatterRayHits.length) {
          const distance=shatterRayHits[0].distance;
          if(Number.isFinite(distance)&&distance<=maxDistance
            &&(!result||distance<result.t*length))
              result={t:distance/length,vase};
        }
      }
    }
    return result;
  }
  function hitProjectile(candidate) {
    if(!candidate?.vase)return false;
    if(candidate.vase.kind==='soursap' && candidate.vase.hanging)
      return startFruitFall(candidate.vase,'projectile'); // Shot branch fruit falls before exploding at terrain contact.
    return detonate(candidate.vase,'projectile');
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
      fx.flash.scale.setScalar(.15+(fx.radius||RADIUS)*Math.min(1,fx.age/.16));
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
    if(flight&&flight.vase.mapId!==mapId){flight.vase.flying=false;flight=null;}
    updateShatterThrow(dt);
    updateFruitFalls(Math.min(.1,Math.max(0,Number(dt)||0)));
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
      setHeldRearXray(held); // Recheck both rigid/skinned rear portraits after async avatar rebuilds (7 Hz).
      const p=playerPosition(),equipment=switchEquipment();
      if(equipment.weapon!==lastEquipment.weapon||equipment.tool!==lastEquipment.tool||equipment.item!==lastEquipment.item)drop();
      // The held visual already follows the player at full frame rate above.
    }
    prompt();
    syncToolArchPickup();

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
    const throwPointers=new Map(),dropPointers=new Set(),capturedToolKeys=new Set();
    const actionButton=event=>event.target?.closest?.('button')?.id||'';
    // Native action-arch buttons are also targeted by desktop synthetic input
    // and controller bridges. Capture them before ordinary held-item handlers.
    window.addEventListener('pointerdown',event=>{
      if(!held)return;
      const id=actionButton(event);
      if(id!=='btnAction1'&&id!=='btnAction2')return;
      event.preventDefault?.();event.stopImmediatePropagation?.();
      if(id==='btnAction2'){dropPointers.add(event.pointerId);drop();return;}
      throwPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      startShatterAim();
    },true);
    window.addEventListener('pointermove',event=>{
      const origin=throwPointers.get(event.pointerId);
      if(!origin)return;
      pointThrowFromDrag(event.clientX-origin.x,event.clientY-origin.y);
      event.preventDefault?.();event.stopImmediatePropagation?.();
    },true);
    window.addEventListener('pointerup',event=>{
      if(dropPointers.delete(event.pointerId)){
        event.preventDefault?.();event.stopImmediatePropagation?.();return;
      }
      if(!throwPointers.delete(event.pointerId))return;
      event.preventDefault?.();event.stopImmediatePropagation?.();
      releaseShatterAim();
    },true);
    window.addEventListener('pointercancel',event=>{
      if(dropPointers.delete(event.pointerId)){
        event.preventDefault?.();event.stopImmediatePropagation?.();return;
      }
      if(!throwPointers.delete(event.pointerId))return;
      event.preventDefault?.();event.stopImmediatePropagation?.();
      cancelShatterAim();
    },true);
    const toolBinding=()=>window.InputBindings?.getCurrentBindings?.()?.desktop?.toolSelect
      ||window.InputBindings?.getDefaultBindings?.('desktop')?.toolSelect;
    window.addEventListener('keydown',event=>{
      const binding=toolBinding();
      if(event.repeat||toolArchAction()!=='pickup'||!binding
        ||![event.code,event.key].includes(binding))return;
      event.preventDefault();event.stopImmediatePropagation?.();
      capturedToolKeys.add(event.code);toolArchTap();
    },true);
    window.addEventListener('keyup',event=>{
      if(!capturedToolKeys.delete(event.code))return;
      event.preventDefault();event.stopImmediatePropagation?.();
    },true);
    window.addEventListener('blur',()=>{
      throwPointers.clear();dropPointers.clear();capturedToolKeys.clear();cancelShatterAim();
    });
    window.addEventListener('pointerdown',event=>{
      if(!held)return;
      const id=event.target?.closest?.('button')?.id||'';
      // Do not intercept existing Tool Select or native carried-action buttons;
      // equipment changes elsewhere can still release the carried vase.
      if(id==='toolBtn'||id==='btnAction1'||id==='btnAction2')return;
      if(/(?:weapon|tool|item|dequip|swap)/i.test(id))drop();
    },true);
  }
  // Tool Select pickup is processed by game.js's canonical controller
  // dispatcher, while ControllerSelectionUI suppresses the entire held
  // selector gesture. A separate frame subscriber here would race that
  // dispatcher and accidentally recall equipment after pickup.
  window.Shattercasks=Object.freeze({
    init,RADIUS,FRUIT_RADIUS,Burden,registerFruit,pickUpFruit,discardFruit,releaseFruitFromTree,
    spawn:ensureArea,spawnRandomInDevArena,pickUp,drop,interact,toolArchAction,toolArchTap,actionButtons,
    contextButtons,collectAimedPile,promptButtons,RUBBLE_YIELD,
    startShatterAim,releaseShatterAim,cancelShatterAim,detonate,heldHandTarget,
    projectileHit,hitProjectile,senseTargets,sweepMelee,tick,attachRuntime,
    debugSnapshot:()=>({lastEvent,latestChange:'Soursap and Shattercasks share Burden interactions; tree fruit falls on shot, safe-drops on felling, and applies Disorient+Sticky on impact.',area:area(),held:held?.id||null,emittingVases:[...allActive().values()].filter(v=>v.emitters?.length).length,
      vases:[...allActive().values()].map(v=>({id:v.id,kind:v.kind,col:v.col,row:v.row,carried:v.carried,hanging:!!v.hanging,flying:!!v.flying})),
      fruitFalls:[...fallingFruits.values()].map(f=>({id:f.fruit.id,y:f.fruit.group.position.y,cause:f.cause})),
      savedLooseFruit:[...(looseFruitHistory.get(area())?.keys()||[])],
      rubble:[...(records.get(area())?.piles.values()||[])].map(p=>({id:p.id,col:p.col,row:p.row})),
      effects:burstEffects.length,loadedWorld:storeIdentity,devArenaSpawnPending,
      rearPortraitXray:{rigidPlanes:backXray.size,skinnedBackOnlyPasses:skinnedRearOverlays.size,
        rearHeadwearOverlays:rearHeadwearXray.size,
        heldPartsWithoutDepthWrite:heldRenderOrders.size,
        heldPartsInWeaponReplay:[...heldRenderOrders.keys()].filter(mesh=>mesh.userData?.hobunjiHeldObjectPlane===true).length,
        skinnedNames:[...skinnedRearOverlays.keys()].map(mesh=>mesh.name)},
      performance:{ruinSnapshotReads,textureBatchesCreated,
        meshRaycastQueries,meshRaycastBroadphaseRejects,meshRaycastTriangleQueries,
        activePileDrawCalls:records.get(area())?.pileVisuals.size||0,
        activeDebrisInstances:[...(records.get(area())?.pileVisuals.values()||[])].reduce((sum,state)=>sum+state.mesh.count,0),
        cachedPlacementAreas:placementCache.size},
      throwPreview:{visible:!!throwRing?.visible,radius:RADIUS,terrainProjected:!!throwRing?.userData.environmentGroundProjection},
      throwAim:aimingThrow?{phase:aimingThrow.phase,target:aimingThrow.target,manual:!!aimingThrow.manualTarget,
        heading:throwHeading(),sharedPose:aimingThrow.sharedPose}:null,
      throwFlight:flight?{origin:{x:flight.origin.x,y:flight.origin.y,z:flight.origin.z},target:flight.target,
        progress:flight.t/flight.duration,distance:flight.distanceTiles}:null,
      interactionClaim:window.WorldActionInputClaims?.claimFor?.('interact')?.ownerId||null}),
  });
  attachRuntime();
})();
