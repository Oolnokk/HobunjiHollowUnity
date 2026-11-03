// Hronal Witch-bombs — timer-driven physical Burdens with reusable ceiling-tube dispensers.
(() => {
  'use strict';
  if (window.HronalWitchBombs?.installed || !window.Shattercasks || !window.THREE) return;

  const THREE = window.THREE;
  const KIND = 'hronalWitchBomb';
  const DEFAULT_FUSE_SECONDS = 10;
  const BLAST_RADIUS = 4.4;
  const BLAST_DAMAGE = 42;
  const BLAST_KNOCKBACK_PX_S = 860;
  const BURNING_HEALTH = 6.5;
  const dispensers = new Map(); // Stable furniture id -> one live bomb slot.
  const breakables = new Map(); // Explicitly registered destructible props; ordinary furniture is never implicitly removed.
  const bursts = []; // One small additive flash per active explosion.
  let spawnSerial = 0;
  let breakableSerial = 0;

  const clamp = (value,min,max) => Math.max(min,Math.min(max,Number(value)||0));
  const now = () => performance.now();
  const currentArea = () => String(window.GridTileAccessors?.getCurrentArea?.() || window.Combat?.deps?.getCurrentArea?.() || '');
  const currentScene = () => window.GridTileAccessors?.getActiveScene?.() || window.Combat?.deps?.getActiveScene?.() || null;
  const currentGrid = () => window.GridTileAccessors?.getActiveGrid?.() || null;
  const tileAt = (mapId,x,z) => {
    if (String(mapId)!==currentArea()) return null;
    const grid=currentGrid(),col=Math.floor(x),row=Math.floor(z);
    return grid?.[row]?.[col] || null;
  };
  function tileHazard(tile) {
    if (!currentGrid()) return ''; // Scene entry can precede the active tile-grid handoff; do not misclassify that brief gap as a bottomless pit.
    if (!tile) return 'void';
    const type=String(tile.type||'').toLowerCase();
    if (type==='lava'||Number(tile.lava)>0) return 'lava';
    if (['water','river','stream','lake','pond'].includes(type)||Number(tile.water)>0) return 'water';
    if (['void','boundary','bottomless','pit'].includes(type)||tile.bottomless===true) return 'void';
    return '';
  }
  function groundY({x,z,mapId}) {
    const tile=tileAt(mapId,x,z),hazard=tileHazard(tile);
    if (hazard==='void') return -8; // Keep falling visibly through a bottomless tile before retiring the burden.
    if (hazard) {
      const deps=window.Combat?.deps,TILE=Number(deps?.TILE)||64;
      const y=Number(deps?.getGroundYAtWorld?.(x,z) ?? deps?.getGroundY?.(x*TILE,z*TILE));
      return (Number.isFinite(y)?y:0)+.45;
    }
    const deps=window.Combat?.deps,TILE=Number(deps?.TILE)||64;
    const y=Number(deps?.getGroundYAtWorld?.(x,z) ?? deps?.getGroundY?.(x*TILE,z*TILE));
    return (Number.isFinite(y)?y:0)+.45; // Sphere center rests one radius above the sampled support.
  }
  function clearDispenserSlot(dispenserId,bomb) {
    const dispenser=dispensers.get(String(dispenserId));
    if (!dispenser || (bomb && dispenser.activeBombId!==bomb.id)) return false;
    dispenser.activeBombId=null;
    dispenser.dispensing=false;
    dispenser.lastReleasedAt=now();
    return true;
  }
  function impact(bomb,cause='impact') {
    if (!bomb || bomb.exploded) return false;
    if (String(cause).includes('witch-bomb-chain')) {
      explode(bomb,'chain-reaction');
      return true;
    }
    const world=bomb.group?.getWorldPosition?.(new THREE.Vector3()) || bomb.group?.position;
    const hazard=world?tileHazard(tileAt(bomb.mapId,world.x,world.z)):'void';
    if (hazard) {
      window.Shattercasks?.discardBurden?.(bomb);
      return true;
    }
    return false; // Solid ordinary surfaces catch the bomb intact; its spawn-time fuse keeps running.
  }
  function buildEffect(targetScene,x,y,z) {
    if (!targetScene) return;
    const flash=new THREE.Mesh(
      new THREE.SphereGeometry(.22,12,8),
      new THREE.MeshBasicMaterial({color:0xff6b17,transparent:true,opacity:.92,depthWrite:false,blending:THREE.AdditiveBlending})
    );
    flash.name='hronal_witch_bomb_fire_flash';
    flash.position.set(x,y,z);
    flash.renderOrder=12;
    targetScene.add(flash);
    bursts.push({flash,age:0,duration:.42});
  }
  function breakNearby(mapId,x,z,radius) {
    for (const [id,record] of [...breakables]) {
      if (record.mapId!==mapId || !record.object?.parent) continue;
      record.object.updateWorldMatrix?.(true,true);
      const p=record.object.getWorldPosition?.(new THREE.Vector3()) || record.object.position;
      if (!p || Math.hypot(p.x-x,p.z-z)>Math.min(radius,Number(record.radius)||radius)) continue;
      let removed=true;
      try { if (typeof record.onBreak==='function') removed=record.onBreak(record.object,{mapId,x,y:p.y,z,radius})!==false; }
      catch(error){removed=false;console.warn('[HronalWitchBombs] breakable callback failed',error);}
      if (removed) {record.object.parent?.remove(record.object);breakables.delete(id);}
    }
    const scene=currentScene();
    scene?.traverse?.(node=>{
      if (node.userData?.hronalBombBreakable!==true || node.userData?.hronalBombBreakQueued) return;
      node.updateWorldMatrix?.(true,false);
      const p=node.getWorldPosition?.(new THREE.Vector3());
      if (!p || Math.hypot(p.x-x,p.z-z)>radius) return;
      node.userData.hronalBombBreakQueued=true;
      try { node.userData.onHronalBombBreak?.({mapId,x,y:p.y,z,radius}); }
      finally { node.parent?.remove(node); }
    });
  }
  function explode(bomb,cause='fuse') {
    if (!bomb || bomb.exploded || bomb._witchBombExploding) return false;
    bomb._witchBombExploding=true;
    bomb.group?.updateWorldMatrix?.(true,true);
    const position=bomb.group?.getWorldPosition?.(new THREE.Vector3()) || bomb.group?.position;
    if (!position) {window.Shattercasks?.discardBurden?.(bomb);return false;}
    const x=position.x,z=position.z,y=position.y,mapId=bomb.mapId;
    const scene=bomb.group.parent?.isScene?bomb.group.parent:currentScene();
    window.Shattercasks?.applyBlast?.(mapId,x,z,{
      radius:BLAST_RADIUS,damage:BLAST_DAMAGE,minimumDamage:5,
      knockbackPxS:BLAST_KNOCKBACK_PX_S,tag:'fire',
      reason:'Hronal Witch-bomb',burningHealth:BURNING_HEALTH,
      footingDamage:38,footingDamageMultiplier:1.5,
      afflictionBonuses:{bruisedHealth:.25,bleedingHealth:.18},
    });
    window.Shattercasks?.triggerBurdenBlastAt?.(mapId,x,z,BLAST_RADIUS,bomb.id);
    breakNearby(mapId,x,z,BLAST_RADIUS);
    buildEffect(scene,x,y,z);
    window.AudioSystem?.playObjectSfxKey?.('shattercaskBlast'); // Reuses the existing positional explosive cue until a dedicated fire-bomb clip is authored.
    window.Shattercasks?.discardBurden?.(bomb);
    window.__farmLog?.('[hronal-witch-bomb] '+bomb.id+' exploded via '+cause,'world');
    return true;
  }
  function createGroupFactory() {
    return window.Shattercasks.registerBurdenFactory(KIND,async()=>{
      const data=await window.AuthoredFurniture?.load?.('hronalWitchBomb');
      if (!data || !window.AuthoredFurniture?.buildGroup) throw new Error('Hronal Witch-bomb authored sphere failed to load.');
      return {group:window.AuthoredFurniture.buildGroup(data),data,displayName:'Hronal Witch-bomb',onImpact:impact};
    });
  }
  async function spawn(options={}) {
    const mapId=String(options.mapId||currentArea()),scene=options.scene||currentScene();
    if (!mapId||!scene) return null;
    const id=String(options.id||('hronal_witch_bomb_'+(++spawnSerial)));
    const bomb=await window.Shattercasks.createHangingBurden({
      ...options,id,mapId,scene,kind:KIND,displayName:'Hronal Witch-bomb',
      furnitureKey:'hronalWitchBomb',hanging:options.hanging===true,
      fuseSeconds:clamp(options.fuseSeconds??DEFAULT_FUSE_SECONDS,1,120),
      fallGroundY:groundY,onImpact:impact,
    });
    if (!bomb) return null;
    bomb.fuseSeconds=clamp(options.fuseSeconds??DEFAULT_FUSE_SECONDS,1,120);
    bomb.spawnedAtMs=now(); // Fuse starts when the physical sphere is first registered in the world.
    bomb.impactRadius=.22;
    return bomb; // createHangingBurden already installed the exact onLost callback; wrapping it again would release a tube twice.
  }
  function registerDispenser(mapId,id,root,puzzle={}) {
    if (!root?.isObject3D) return false;
    const key=String(id||root.userData?.puzzleInstanceId||root.id);
    const old=dispensers.get(key);
    if (old?.root===root) {
      old.mapId=String(mapId||old.mapId);
      old.fuseSeconds=clamp(puzzle.bombFuseSeconds??old.fuseSeconds,1,120);
      return true;
    }
    dispensers.set(key,{
      id:key,mapId:String(mapId||currentArea()),root,
      fuseSeconds:clamp(puzzle.bombFuseSeconds??DEFAULT_FUSE_SECONDS,1,120),
      activeBombId:null,dispensing:false,lastReleasedAt:0,
    });
    return true;
  }
  function unregisterDispenser(mapId,id) {
    const dispenser=dispensers.get(String(id));
    if(!dispenser||dispenser.mapId!==String(mapId))return false;
    dispensers.delete(String(id));
    return true; // A released bomb remains independent after its ceiling tube is removed.
  }
  async function dispenseFromMechanism(root) {
    if (!root?.isObject3D) return false;
    const key=String(root.userData?.puzzleInstanceId||root.userData?.authoredFurnitureKey||root.id);
    const dispenser=dispensers.get(key);
    if (!dispenser || dispenser.dispensing) return false;
    const active=dispenser.activeBombId&&window.Shattercasks.getBurden?.(dispenser.activeBombId,dispenser.mapId);
    if (active&&!active.exploded) return false; // One active sphere per ceiling tube, regardless of repeated activator signals.
    dispenser.activeBombId=null;
    dispenser.dispensing=true;
    const data=root.userData?.authoredFurnitureData||{};
    const exit=data.bombTubeExit||{x:0,y:-.88,z:0};
    root.updateWorldMatrix?.(true,true);
    const point=new THREE.Vector3(Number(exit.x)||0,Number(exit.y)||-.88,Number(exit.z)||0);
    if (root.localToWorld) root.localToWorld(point);
    else {const p=root.getWorldPosition(new THREE.Vector3());point.copy(p).add(new THREE.Vector3(0,-.88,0));}
    const id='witch_bomb_dispenser_'+key+'_'+(++spawnSerial);
    const bomb=await spawn({
      id,mapId:dispenser.mapId,scene:root.parent?.isScene?root.parent:currentScene(),
      x:point.x,y:point.y,z:point.z,fuseSeconds:dispenser.fuseSeconds,hanging:false,
      onLost:record=>clearDispenserSlot(key,record),
    });
    if (!bomb) {dispenser.dispensing=false;return false;}
    dispenser.activeBombId=bomb.id;
    if (!window.Shattercasks.releaseBurdenDownward(bomb,'ceiling-witch-bomb')) {
      window.Shattercasks.discardBurden(bomb);
      clearDispenserSlot(key,bomb);
      return false;
    }
    dispenser.dispensing=false;
    return bomb;
  }
  async function spawnCarriedByEnemy(enemy,options={}) {
    const body=enemy?.avatarRef?.group||enemy?.group;
    const handRoot=enemy?.avatarRef?.handRigAvatarRoot;
    const scene=enemy?.scene||body?.parent||currentScene();
    const mapId=String(options.mapId||enemy?.areaId||currentArea());
    if (!body?.isObject3D||!handRoot?.userData||!scene) return null;
    const bomb=await spawn({
      mapId,scene,id:options.id||('hronal_witch_bomb_carrier_'+(++spawnSerial)),
      x:0,y:0,z:0,fuseSeconds:options.fuseSeconds??DEFAULT_FUSE_SECONDS,hanging:false,
      onLost:options.onLost,
    });
    if (!bomb) return null;
    const profile=bomb.data?.carryable?.enemyHoldAnchor||{};
    const anchor=profile.position||{};
    body.add(bomb.group);
    bomb.group.position.set(Number(anchor.x)||0,Number(anchor.y)||.02,Number(anchor.z)||-.18);
    bomb.group.quaternion.identity();
    bomb.group.scale.setScalar(clamp(profile.scale??.82,.3,1.5));
    bomb.group.updateWorldMatrix?.(true,true);
    bomb.carried=true;
    bomb.enemyCarrier=enemy;
    handRoot.userData.proceduralHeldItemTarget={
      holder:bomb.group,mode:'authored-world',
      handTargets:bomb.data?.carryable?.handTargets||{},
    };
    return bomb;
  }
  function dropEnemyBomb(bomb) {
    const enemy=bomb?.enemyCarrier;
    if (!enemy || !bomb.group?.parent) return false;
    const handRoot=enemy.avatarRef?.handRigAvatarRoot;
    if (handRoot?.userData?.proceduralHeldItemTarget?.holder===bomb.group)
      handRoot.userData.proceduralHeldItemTarget=null;
    bomb.group.updateWorldMatrix?.(true,true);
    const p=bomb.group.getWorldPosition(new THREE.Vector3());
    const q=bomb.group.getWorldQuaternion(new THREE.Quaternion());
    const scale=bomb.group.getWorldScale(new THREE.Vector3());
    const scene=enemy.scene||currentScene();
    if (!scene) return false;
    scene.add(bomb.group);
    bomb.group.position.copy(p);
    bomb.group.quaternion.identity();
    bomb.group.scale.setScalar(1); // Restore the normal world scale after detaching from the enemy's scaled body rig.
    const deps=window.Combat?.deps,TILE=Number(deps?.TILE)||64;
    const y=Number(deps?.getGroundYAtWorld?.(p.x,p.z)??deps?.getGroundY?.(p.x*TILE,p.z*TILE));
    bomb.group.position.y=(Number.isFinite(y)?y:0)+.45;
    bomb.carried=false;bomb.enemyCarrier=null;
    bomb.col=Math.floor(p.x);bomb.row=Math.floor(p.z);
    return true;
  }
  function registerBreakable(object,options={}) {
    if (!object?.isObject3D) return null;
    const id=String(options.id||('hronal_breakable_'+(++breakableSerial)));
    breakables.set(id,{id,object,mapId:String(options.mapId||currentArea()),radius:options.radius,onBreak:options.onBreak});
    return ()=>breakables.delete(id);
  }
  function tick(dt=0) {
    const step=clamp(dt,0,.1),mapId=currentArea(),records=window.Shattercasks.activeBurdenRecords?.(mapId)||[];
    for (const bomb of records) {
      if (bomb.kind!==KIND||bomb.exploded) continue;
      if (bomb.carried && bomb.enemyCarrier) {
        const carrier=bomb.enemyCarrier;
        if ((Number(carrier.health)||0)<=0 || !carrier.avatarRef?.group?.parent) dropEnemyBomb(bomb);
      }
      if (!bomb.group?.parent) {window.Shattercasks.discardBurden(bomb);continue;}
      if (!bomb.carried && !bomb.flying) {
        const position=bomb.group.getWorldPosition(new THREE.Vector3());
        if (tileHazard(tileAt(mapId,position.x,position.z))) {
          window.Shattercasks.discardBurden(bomb); // A dropped bomb is destroyed by water/lava/void even when it did not arrive through a ceiling fall.
          continue;
        }
      }
      const fuse=Math.max(1,Number(bomb.fuseSeconds)||DEFAULT_FUSE_SECONDS);
      const remaining=Math.max(0,fuse-(now()-Number(bomb.spawnedAtMs||now()))/1000);
      const urgency=clamp((1-remaining/fuse-.52)/.48,0,1);
      window.FurniturePatternSurfaces?.setGlowState?.(bomb.group,{
        intensity:.68+.88*urgency,
        pulseSpeed:1.25+10*Math.pow(urgency,2.1),
        pulseDepth:.22+.72*urgency,
        color:'#ff7417',
      });
      bomb.group.userData.hronalFuse={remainingSeconds:remaining,totalSeconds:fuse,progress:1-remaining/fuse};
      if (remaining<=0) explode(bomb,'fuse');
    }
    for(let i=bursts.length-1;i>=0;i--) {
      const state=bursts[i];state.age+=step;
      const t=clamp(state.age/state.duration,0,1);
      state.flash.scale.setScalar(.22+BLAST_RADIUS*.22*t);
      state.flash.material.opacity=.92*(1-t);
      if(t>=1){state.flash.parent?.remove(state.flash);state.flash.geometry.dispose();state.flash.material.dispose();bursts.splice(i,1);}
    }
  }
  function debugSnapshot() {
    return {
      latestChange:'Hronal Witch-bombs fuse from physical spawn; glyph glow accelerates near detonation; ceiling tubes hold one live payload.',
      dispensers:[...dispensers.values()].map(item=>({id:item.id,mapId:item.mapId,activeBombId:item.activeBombId,dispensing:item.dispensing,fuseSeconds:item.fuseSeconds})),
      activeBombs:(window.Shattercasks.activeBurdenRecords?.(currentArea())||[]).filter(item=>item.kind===KIND).map(item=>({
        id:item.id,remainingSeconds:Math.max(0,(Number(item.fuseSeconds)||DEFAULT_FUSE_SECONDS)-(now()-Number(item.spawnedAtMs||now()))/1000),
        carrier:item.enemyCarrier?.id||null,hanging:!!item.hanging,flying:!!item.flying,
      })),
      breakables:breakables.size,activeFlashes:bursts.length,
    };
  }
  createGroupFactory();
  window.HronalWitchBombs=Object.freeze({
    installed:true,KIND,DEFAULT_FUSE_SECONDS,BLAST_RADIUS,
    spawn,registerDispenser,unregisterDispenser,dispenseFromMechanism,spawnCarriedByEnemy,
    registerBreakable,dropEnemyBomb,tick,debugSnapshot,
  });
})();
