// Destructible wilderness supplies, built on the shared authored furniture and Burden systems.
(() => {
  'use strict';
  if (window.CratePiles?.installed || !window.THREE) return;
  const THREE = window.THREE;
  const piles = new Map(); // Qualified area/id -> a wild, developer-authored crate pile.
  const junk = new Map(); // Qualified area/id -> live, uncollected supply drop.
  const savedDrops = new Map(); // Uncollected junk surviving scene reconstruction and world reload.
  const savedCounts = new Map(); // Wilderness camp supplies survive reentry and reload.
  const restoredScenes = new Map(); // Track one rehydration pass per active area scene.
  let persistenceIdentity = null; // World and Tothal cycle, partitioned like Shattercasks.
  let identityPollSeconds = 0; // Avoid repeatedly reading world-settings storage on every combat frame.
  const bursts = []; // Active crate-textured wood shard effects.
  const spareBursts = []; // At most ten reusable instanced meshes and matrices; no per-shatter GPU buffer churn.
  const shardCount = 42; // Instanced crate-textured debris per individual crate.
  const maxBursts = 10; // GPU/CPU cap for chain reactions in combat.
  let serial = 0; // Identity used by detached burdens and one-time loot drops.
  let lastEvent = 'ready'; // Shown in the mobile Pixel Probe debug snapshot.
  let shardArt = null; // Single crate-texture upload reused by every broken box.
  let decalPlane = null; // Shared square mesh geometry for all rotated, ground-hugging loot decals.
  const decalMaterials = new Map(); // One reusable item-sprite material per inventory key.

  const key = (mapId,id) => String(mapId) + '::' + String(id);
  const currentArea = () => String(window.GridTileAccessors?.getCurrentArea?.() || window.Combat?.deps?.getCurrentArea?.() || '');
  const tileSize = () => Number(window.Combat?.deps?.TILE) || 64;
  function worldIdentity() {
    const id=window.__hobunjiPlayerProfile?.worldId || window.FarmWorldSettings?.read?.()?.world?.id;
    if (!id) return null; // A preview or unselected save must not write into a shared global slot.
    let cycle=1;
    try { cycle=window.CalendarSystem?.tothalCycle?.()||1; } catch(_) { /* Boot may precede calendar init. */ }
    return String(id)+'|'+String(cycle);
  }
  function ensurePersistence() {
    const identity=worldIdentity();
    if (!identity || identity===persistenceIdentity) return;
    if (persistenceIdentity && persistenceIdentity!==identity) {
      for(const drop of junk.values())drop.group.parent?.remove(drop.group);
      junk.clear();piles.clear();restoredScenes.clear();savedDrops.clear();savedCounts.clear();
    }
    persistenceIdentity=identity;
    if(typeof localStorage==='undefined')return;
    try{
      const raw=JSON.parse(localStorage.getItem('hobunji.crate-supplies.v1:'+identity)||'null');
      for(const [id,count] of Object.entries(raw?.counts||{}))
        if(Number.isFinite(Number(count)))savedCounts.set(id,Math.max(0,Math.min(3,Math.floor(Number(count)))));
      for(const item of raw?.drops||[])
        if(item && typeof item.id==='string' && typeof item.mapId==='string'
          && [item.x,item.z,item.y].every(n=>Number.isFinite(Number(n)))
          && item.loot && typeof item.loot==='object' && !Array.isArray(item.loot))
          savedDrops.set(key(item.mapId,item.id),item);
    }catch(error){window.__farmLog?.('[crates] supply restore failed: '+error.message,'warn');}
  }
  function persistSupplies() {
    if(!persistenceIdentity || typeof localStorage==='undefined')return;
    try{
      localStorage.setItem('hobunji.crate-supplies.v1:'+persistenceIdentity,
        JSON.stringify({counts:Object.fromEntries(savedCounts),drops:[...savedDrops.values()]}));
    }catch(error){window.__farmLog?.('[crates] supply save failed: '+error.message,'warn');}
  }
  function playerTiles() {
    const player = window.Combat?.deps?.player;
    return player ? { x: Number(player.x) / tileSize(), z: Number(player.y) / tileSize() } : null;
  }
  function positionOf(group) {
    if (!group) return null;
    group.updateWorldMatrix?.(true, true);
    const position = group.getWorldPosition?.(new THREE.Vector3()) || group.position;
    return position ? { x: Number(position.x)||0, y: Number(position.y)||0, z: Number(position.z)||0 } : null;
  }
  function validPile(pile) {
    return !!(pile && pile.lootable && pile.count > 0 && !pile.busy
      && pile.scene && pile.group?.parent === pile.scene);
  }
  function registerPile(options = {}) {
    // Town scenery and user-placed furniture never call this explicit registration gate.
    if (!options.lootable || !options.group?.isObject3D || !options.scene || !options.id || !options.mapId) return null;
    ensurePersistence();
    const id = key(options.mapId,options.id);
    const existing = piles.get(id);
    if (existing?.scene === options.scene && existing.group === options.group) return existing;
    const rawCount=Number(options.count ?? 3); // Runtime variants accept only finite, bounded integral crate counts.
    const count=options.persistViaParent!==true && savedCounts.has(id)
      ?savedCounts.get(id)
      :Number.isFinite(rawCount)?Math.max(0,Math.min(3,Math.floor(rawCount))):3;
    const pile = { id:String(options.id),mapId:String(options.mapId),scene:options.scene,
      group:options.group,count,lootable:true,busy:false,persistViaParent:options.persistViaParent===true,onChange:options.onChange||null };
    if(existing?.scene!==options.scene){
      for(const [dropId,drop] of junk)if(drop.mapId===pile.mapId && drop.scene!==pile.scene){
        drop.group.parent?.remove(drop.group);junk.delete(dropId);
      }
    }
    piles.set(id,pile);
    window.AuthoredFurniture?.setRuntimeValues?.(pile.group,{crateCount:count});
    if(count!==rawCount)options.onChange?.(count); // Sync the camp prop snapshot with restored counts.
    return pile;
  }
  function unregisterPile(mapId,id) { return piles.delete(key(mapId,id)); }
  function forgetPile(mapId,id) {
    unregisterPile(mapId,id);
    const changed=savedCounts.delete(key(mapId,id)); // A rerolled camp must start with fresh crates.
    if(changed)persistSupplies();
    return changed;
  }
  function nearestInteractable(mapId,x,z) {
    let best = null, distance = 1.65;
    for (const pile of piles.values()) {
      if (pile.mapId !== mapId || !validPile(pile)) continue;
      const p = positionOf(pile.group);
      if (!p) continue;
      const d = Math.hypot(p.x-x,p.z-z);
      if (d < distance) {best=pile;distance=d;}
    }
    return best;
  }
  function reducePile(pile) {
    if (!validPile(pile)) return false;
    pile.count = Math.max(0,pile.count-1);
    window.AuthoredFurniture?.setRuntimeValues?.(pile.group,{crateCount:pile.count});
    pile.onChange?.(pile.count);
    if(!pile.persistViaParent){savedCounts.set(key(pile.mapId,pile.id),pile.count);persistSupplies();}
    return true;
  }
  async function takeCrate(pile) {
    if (!validPile(pile) || pile.mapId !== currentArea() || !window.Shattercasks) return false;
    pile.busy = true;
    try {
      const furniture = await window.AuthoredFurniture?.load?.('looseCrate');
      if (!furniture || piles.get(key(pile.mapId,pile.id)) !== pile || pile.count<=0
          || pile.group?.parent !== pile.scene || currentArea() !== pile.mapId) return false;
      const p = positionOf(pile.group);
      const group = window.AuthoredFurniture.buildGroup(furniture);
      group.position.set(p.x,p.y,p.z);
      const burden = window.Shattercasks.registerBurden({
        id:'loose_crate_'+(++serial),kind:'looseCrate',mapId:pile.mapId,scene:pile.scene,
        group,data:furniture,displayName:'Wooden Crate',hanging:false,onImpact:shatterBurden,
      });
      if (!burden) {group.parent?.remove(group);return false;}
      if (!window.Shattercasks.pickUp(burden)) {window.Shattercasks.discardBurden(burden);return false;}
      // Only consume a crate AFTER pickup actually succeeded (e.g. hands not occupied).
      pile.busy = false;
      reducePile(pile);
      lastEvent = 'removed crate from '+pile.id+' ('+pile.count+' remaining)';
    window.__farmLog?.('[crates] '+lastEvent,'world');
      return true;
    } catch(error) {
      console.warn('[crate-piles] pickup failed',error);
      lastEvent = 'pickup error: '+error.message;
      return false;
    } finally {pile.busy = false;}
  }
  function rollJunk() {
    const result = window.LootRolling?.rollLootPool?.('crateJunk') || {};
    // Independent roll-table chances may all fail. A broken crate is never empty.
    if (Object.values(result).some(qty=>Number(qty)>0)) return result;
    const mundane = ['needlegrain','garlink','cloudHerbs','puktukWool','uumkaoiiEgg'];
    return { [mundane[Math.floor(Math.random()*mundane.length)]]:1 };
  }
  function itemDecalSource(item) {
    const sprites = {
      needlegrain:'assets/objectsprites/pile_needlegrain.png',
      garlink:'assets/objectsprites/garlink_bunch.png',
      heftroot:'assets/objectsprites/heftroot.png',
      ongyums:'assets/objectsprites/ongyum.png',
      whiteDewMilk:'assets/objectsprites/pile_dew.png',
      greenDewMilk:'assets/objectsprites/pile_dew.png',
    }; // Actual inventory-item object sprites, reused where they exist.
    return sprites[item] || null;
  }
  function decalMaterial(item) {
    if(decalMaterials.has(item))return decalMaterials.get(item);
    const file=itemDecalSource(item);
    if (file) {
      const loader = decalMaterial.loader ||= new THREE.TextureLoader(); // Shared loader for item decals only.
      const cache = decalMaterial.cache ||= new Map(); // One GPU texture per concrete inventory sprite path.
      if (!cache.has(file)) cache.set(file,loader.load(file));
      const material=new THREE.MeshBasicMaterial({map:cache.get(file),transparent:true,side:THREE.DoubleSide,depthWrite:false});
      decalMaterials.set(item,material);
      return material;
    }
    // Generic item-index icon fallback is rendered into a genuine transparent PNG-style decal plane.
    const icons = {puktukWool:'🧶',uumkaoiiEgg:'🥚',cloudHerbs:'🌿',mireHerbs:'🌿',blackberries:'🫐'};
    const icon = icons[item] || '📦';
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,96,96);ctx.font='66px sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(icon,48,48);
    const texture=new THREE.CanvasTexture(canvas);texture.needsUpdate=true;
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide,depthWrite:false});
    decalMaterials.set(item,material);
    return material;
  }
  function scatterJunk(mapId,scene,x,z,y,loot,restoreId=null) {
    if (!scene || !THREE.PlaneGeometry || !THREE.Mesh) return null;
    const id=restoreId||'crate_junk_'+Date.now().toString(36)+'_'+(++serial);
    const group=new THREE.Group();
    const entry=Object.entries(loot).filter(([,amount])=>Number(amount)>0);
    let index=0;
    decalPlane ||= new THREE.PlaneGeometry(1,1);
    for (const [item,count] of entry) {
      const decals=Math.min(6,Math.max(2,Number(count)||1));
      const material=decalMaterial(item);
      for(let i=0;i<decals;i++) {
        const mesh=new THREE.Mesh(decalPlane,material);
        const size=.19+Math.random()*.10;
        mesh.scale.set(size,size,1);
        const a=(index++*2.399963),distance=.05+(index%6)*.042;
        mesh.position.set(Math.cos(a)*distance,.01+index*.0015,Math.sin(a)*distance);
        mesh.rotation.x=-Math.PI/2+(5+Math.random()*10)*Math.PI/180;
        mesh.rotation.z=a;
        group.add(mesh);
      }
    }
    group.position.set(x,y+.015,z);
    group.userData.crateJunkId=id;
    scene.add(group);
    const record={id,mapId,scene,group,loot};
    junk.set(key(mapId,id),record);
    if(!restoreId){
      ensurePersistence();
      savedDrops.set(key(mapId,id),{id,mapId,x,z,y,loot});
      persistSupplies();
    }
    return record;
  }
  function woodBurst(scene,x,y,z) {
    if (!scene || !THREE.InstancedMesh) return;
    if (bursts.length >= maxBursts) {
      const old=bursts.shift();
      old.mesh.parent?.remove(old.mesh);
      spareBursts.push(old); // Recycle the oldest blast instead of discarding its GPU instance buffer.
    }
    if (!shardArt) {
      const texture=new THREE.TextureLoader().load('assets/textures/crate_side.png');
      // Crop the four-times-stretched central area rather than shrinking its pattern to fit.
      texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.RepeatWrapping;
      texture.repeat.set(.25,.25);texture.offset.set(.375,.375);
      shardArt={geometry:new THREE.TetrahedronGeometry(.055,0),
        material:new THREE.MeshBasicMaterial({map:texture,color:0xffffff,side:THREE.DoubleSide,
          transparent:false,depthWrite:true})};
    }
    let burst=spareBursts.pop(); // Reuse the same 42 instance transforms after a previous burst finishes.
    if(!burst){
      const mesh=new THREE.InstancedMesh(shardArt.geometry,shardArt.material,shardCount);
      mesh.frustumCulled=false;
      burst={mesh,particles:Array.from({length:shardCount},()=>({x:0,y:0,z:0,vx:0,vy:0,vz:0})),
        dummy:new THREE.Object3D(),elapsed:0};
    }
    burst.elapsed=0;
    burst.mesh.position.set(x,y,z);
    scene.add(burst.mesh);
    for(let i=0;i<shardCount;i++){
      const angle=i*2.399963,velocity=1.3+(i%9)*.27,part=burst.particles[i];
      Object.assign(part,{x:0,y:0,z:0,vx:Math.cos(angle)*velocity,
        vy:1+(i%7)*.36,vz:Math.sin(angle)*velocity});
      burst.dummy.position.set(0,0,0);burst.dummy.rotation.set(0,0,0);
      burst.dummy.scale.setScalar(0);burst.dummy.updateMatrix();
      burst.mesh.setMatrixAt(i,burst.dummy.matrix); // No stale shard flash during the one frame before the first tick.
    }
    burst.mesh.instanceMatrix.needsUpdate=true;
    bursts.push(burst);
  }
  function breakAt(mapId,scene,x,y,z,source='melee',attacker=null) {
    woodBurst(scene,x,y,z);
    window.Shattercasks?.applyBlast?.(mapId,x,z,{
      radius:1,damage:7,minimumDamage:1,knockbackPxS:65,
      tag:'blunt',reason:'Smashed crate',afflictionBonuses:{bleedingHealth:.35},
      footingDamage:90,footingDamageMultiplier:0,
      excludeActor:source==='melee'?attacker:null, // Don't knock down the character smashing it by hand.
    });
    const groundY=window.Combat?.deps?.getGroundYAtWorld?.(x,z)
      ?? window.Combat?.deps?.worldSurfaceY?.(x*tileSize(),z*tileSize())
      ?? (source==='melee'?y-.32:y);
    scatterJunk(mapId,scene,x,z,groundY,rollJunk()); // Never bury thrown drops below the landing surface.
    window.AudioSystem?.playWeaponHitSfx?.('blunt',x*tileSize(),z*tileSize(),mapId,undefined,'heavy');
    lastEvent='crate shattered by '+source+' in '+mapId;
    window.__farmLog?.('[crates] '+lastEvent,'combat');
    return true;
  }
  function shatterBurden(burden,cause='impact',attacker=null) {
    if (!burden || burden.exploded) return false;
    const p=positionOf(burden.group);
    if (!p) return false;
    const activeScene=window.GridTileAccessors?.getActiveScene?.(); // Use the live area before any cached camp scene.
    const scene=burden.group?.parent?.isScene?burden.group.parent
      :(currentArea()===burden.mapId?activeScene:null)
      || [...piles.values()].find(v=>v.mapId===burden.mapId&&v.group.parent===v.scene)?.scene
      || null;
    if (!window.Shattercasks?.discardBurden?.(burden)) return false;
    return breakAt(burden.mapId,scene,p.x,p.y,p.z,cause,attacker);
  }
  function sweepMelee(collider,opts={}) {
    if (!collider) return false;
    let hit=false;
    const mapId=currentArea();
    for(const pile of piles.values()) {
      if (pile.mapId!==mapId || !validPile(pile)) continue;
      const p=positionOf(pile.group);
      const dx=p.x-collider.origin.x,dz=p.z-collider.origin.z;
      const radial=Math.hypot(dx,dz);
      if (radial>collider.horizontalRangeWorld+.40) continue;
      const angle=Math.atan2(Math.sin(Math.atan2(dz,dx)-collider.yaw),
        Math.cos(Math.atan2(dz,dx)-collider.yaw));
      if (Math.abs(angle)>(collider.halfConeRad||.5)+.17) continue;
      const expectedY=collider.origin.y+collider.verticalRiseWorld*radial/
        Math.max(.1,collider.horizontalRangeWorld);
      if (Math.abs(expectedY-(p.y+.35))>collider.halfHeightWorld+.32) continue;
      // The melee sweep strikes one crate at a time; ordinary decorative furniture has no registration.
      reducePile(pile);hit=true;
      breakAt(mapId,pile.scene,p.x,p.y+.32,p.z,'melee',opts.actor||null);
      break;
    }
    return hit;
  }
  function restoreAreaDrops(mapId,scene) {
    if(!mapId||!scene||restoredScenes.get(mapId)===scene)return;
    restoredScenes.set(mapId,scene);
    for(const [id,drop] of junk)if(drop.mapId===mapId){
      drop.group.parent?.remove(drop.group);junk.delete(id);
    }
    for(const record of savedDrops.values())
      if(record.mapId===mapId)scatterJunk(mapId,scene,record.x,record.z,record.y,record.loot,record.id);
  }
  function tick(dt=0) {
    identityPollSeconds+=Math.max(0,Math.min(.2,Number(dt)||0));
    if(!persistenceIdentity||identityPollSeconds>=2){identityPollSeconds=0;ensurePersistence();}
    const area=currentArea();
    restoreAreaDrops(area,window.GridTileAccessors?.getActiveScene?.());

    const step=Math.min(.1,Math.max(0,Number(dt)||0));
    for(let i=bursts.length-1;i>=0;i--) {
      const burst=bursts[i];burst.elapsed+=step;
      const age=burst.elapsed,done=age>=.75;
      if(done){burst.mesh.parent?.remove(burst.mesh);bursts.splice(i,1);spareBursts.push(burst);continue;}
      burst.particles.forEach((part,index)=>{
        part.x+=part.vx*step;part.y+=part.vy*step;part.z+=part.vz*step;part.vy-=9*step;
        burst.dummy.position.set(part.x,part.y,part.z);
        burst.dummy.rotation.set(age*(index%5+1)*8,age*9,age*(index%3+1)*7);
        burst.dummy.scale.setScalar(Math.max(.001,1-age/.75));
        burst.dummy.updateMatrix();burst.mesh.setMatrixAt(index,burst.dummy.matrix);
      });
      burst.mesh.instanceMatrix.needsUpdate=true;
    }
    const p=playerTiles();if(!p)return;
    for (const [id,drop] of junk) {
      if (drop.mapId!==area || drop.group.parent!==drop.scene) continue;
      const q=positionOf(drop.group);
      if (Math.hypot(p.x-q.x,p.z-q.z)>.65) continue;
      // Grant first: a missing inventory service must not silently destroy a pickup.
      const awarded=window.Shattercasks?.grantBurdenLoot?.(drop.loot);
      if (!awarded || (Array.isArray(awarded)&&awarded.length===0)) continue;
      junk.delete(id);drop.group.parent?.remove(drop.group);
      savedDrops.delete(id);persistSupplies();
      const summary=Object.keys(drop.loot).slice(0,3).join(', ');
      window.Combat?.deps?.showToast?.('Collected crate junk: '+summary,false);
      lastEvent='collected '+drop.id+': '+summary;
      window.__farmLog?.('[crates] '+lastEvent,'world');
    }
  }
  const debugSnapshot=()=>({
    latestChange:'Physical crate burdens, dynamic three-to-zero furniture states and walk-over mundane drops',
    lastEvent,activePileCount:[...piles.values()].filter(validPile).length,
    piles:[...piles.values()].filter(p=>p.mapId===currentArea()).map(p=>({id:p.id,count:p.count,lootable:p.lootable,busy:p.busy})),
    looseJunk:[...junk.values()].filter(d=>d.mapId===currentArea()).length,
    activeDebrisBursts:bursts.length,reusableDebrisBuffers:spareBursts.length,
    savedUncollectedDrops:savedDrops.size,savedCountOverrides:savedCounts.size,
  });
  window.CratePiles={installed:true,registerPile,unregisterPile,nearestInteractable,takeCrate,
    shatterBurden,sweepMelee,tick,forgetPile,debugSnapshot};
})();
