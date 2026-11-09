// Witch-bombs — timer-driven physical Burdens with reusable ceiling-tube dispensers.
//
// Three variants share one fuse/dispenser/carry pipeline; a bomb's variant follows the
// tradition of the ruin it appears in (every other area stays Hronal):
//   hronal   fire burst, burning Health                                       (original)
//   tothal   icy burst, enormous knockback, the existing Frostbitten Stamina  (frost)
//   kanthic  violet burst, leaves ~5 s of temporary plasm, and explodeable props
//            are covered in plasm and shrunk away instead of detonating; the
//            blast recording plays reversed.
// (The module and global keep their original Hronal names for existing callers.)
(() => {
  'use strict';
  if (window.HronalWitchBombs?.installed || !window.Shattercasks || !window.THREE) return;

  const THREE = window.THREE;
  const KIND = 'hronalWitchBomb'; // Original/default kind; see VARIANTS below.
  const DEFAULT_FUSE_SECONDS = 10;
  const BLAST_RADIUS = 4.4;
  const BLAST_SFX_KEY = 'witchBombBlast'; // Used once for every successful Witch-bomb detonation.
  const RUIN_MAP_ID = 'map_i_dev_random_ruin';
  const VARIANTS = Object.freeze({
    hronal: Object.freeze({ id:'hronal', kind:'hronalWitchBomb', furnitureKey:'hronalWitchBomb', displayName:'Hronal Witch-bomb', glow:'#ff7417',
      tag:'fire', damage:42, minimumDamage:5, knockbackPxS:860, footingDamage:38, burningHealth:6.5, afflictionBonuses:{bruisedHealth:.25,bleedingHealth:.18},
      effect:{ flash:0xff6b17, tongue:0xff7a1b, gravity:2.3, name:'fire' } }),
    tothal: Object.freeze({ id:'tothal', kind:'tothalWitchBomb', furnitureKey:'tothalWitchBomb', displayName:'Tothal Witch-bomb', glow:'#7fd8ff',
      tag:'ice', damage:20, minimumDamage:4, knockbackPxS:4400, footingDamage:60, frostbittenStamina:58, afflictionBonuses:{bruisedHealth:.3,woundedStamina:.2},
      effect:{ flash:0xaee6ff, tongue:0xdff6ff, gravity:3.4, name:'ice' } }),
    kanthic: Object.freeze({ id:'kanthic', kind:'kanthicWitchBomb', furnitureKey:'kanthicWitchBomb', displayName:'Kanthic Witch-bomb', glow:'#b07dff',
      tag:'plasm', damage:12, minimumDamage:3, knockbackPxS:320, footingDamage:30, afflictionBonuses:{bruisedHealth:.1}, plasm:{ radius:3.4, ttl:5 }, reverseSfx:true,
      effect:{ flash:0x8a55d6, tongue:0xb98cff, gravity:1.4, name:'plasm' } }),
  });
  const KINDS = new Set(Object.values(VARIANTS).map(variant => variant.kind));
  const variantOfKind = kind => Object.values(VARIANTS).find(variant => variant.kind === kind) || VARIANTS.hronal;
  function ruinVariantId(mapId) {
    if (String(mapId) !== RUIN_MAP_ID) return 'hronal'; // Tradition bombs exist only in their own ruins.
    const theme = window.DevRandomRuin?.getRuntimeContext?.()?.theme;
    return VARIANTS[theme] ? theme : 'hronal';
  }
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
  function groundY({x,z,mapId,y:fromY}) {
    if (String(mapId)===RUIN_MAP_ID && Number.isFinite(Number(fromY))) { // Ruin stories and shaft platforms are dynamic supports, not tile heights.
      const support=window.DynamicSurfaces?.sampleSupport?.(x,z,{minY:Number(fromY)-40,maxY:Number(fromY)+.3,pad:.02});
      if (support) return support.y+.45;
    }
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
  function clearEnemyGrip(bomb) {
    const enemy=bomb?.enemyCarrier;
    if(!enemy)return false;
    const handRoot=enemy.avatarRef?.handRigAvatarRoot;
    if(handRoot?.userData?.proceduralHeldItemTarget?.holder===bomb.group)
      handRoot.userData.proceduralHeldItemTarget=null;
    bomb.enemyCarrier=null;
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
  function buildEffect(targetScene,x,y,z,variant=VARIANTS.hronal) {
    if (!targetScene) return;
    const palette=variant.effect;
    const group=new THREE.Group(); // One scene root owns the expanding flash and instanced flame tongues.
    group.name='witch_bomb_'+palette.name+'_burst';
    group.position.set(x,y,z);
    targetScene.add(group);
    const flash=new THREE.Mesh(
      new THREE.SphereGeometry(.22,12,8),
      new THREE.MeshBasicMaterial({color:palette.flash,transparent:true,opacity:.92,depthWrite:false,blending:THREE.AdditiveBlending})
    );
    flash.name='witch_bomb_'+palette.name+'_flash';
    flash.renderOrder=12;
    group.add(flash);
    // Icy bursts throw sharp crystalline shards instead of flame tongues; plasm throws fat droplets.
    const count=palette.name==='ice'?44:32;
    const geometry=palette.name==='ice'?new THREE.ConeGeometry(.055,.42,4,1):palette.name==='plasm'?new THREE.SphereGeometry(.11,8,6):new THREE.ConeGeometry(.075,.34,5,1);
    const material=new THREE.MeshBasicMaterial({color:palette.tongue,transparent:true,opacity:.94,depthWrite:false,blending:palette.name==='ice'?THREE.NormalBlending:THREE.AdditiveBlending,side:THREE.DoubleSide});
    const flames=new THREE.InstancedMesh(geometry,material,count);
    flames.name='witch_bomb_'+palette.name+'_particles';
    flames.frustumCulled=false;
    group.add(flames);
    const parts=[];
    for(let i=0;i<count;i++){
      const angle=i*2.399963229728653,speed=1.15+(i%6)*.28;
      parts.push({x:0,y:0,z:0,vx:Math.cos(angle)*speed,vz:Math.sin(angle)*speed,vy:1.0+(i%5)*.34});
    }
    const dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),direction=new THREE.Vector3();
    for(let i=0;i<count;i++){
      const part=parts[i];
      direction.set(part.vx,part.vy,part.vz).normalize();
      dummy.position.set(0,0,0);
      dummy.quaternion.setFromUnitVectors(up,direction);
      dummy.scale.setScalar(.72+(i%4)*.12);
      dummy.updateMatrix();
      flames.setMatrixAt(i,dummy.matrix);
    }
    flames.instanceMatrix.needsUpdate=true;
    bursts.push({group,flash,flames,geometry,material,parts,dummy,up,direction,age:0,duration:.72,gravity:palette.gravity});
  }
  // Kanthic: instead of detonating, an explodeable is wrapped in plasm (SubstanceCoverShell,
  // the shared outline-layer covering) and shrunk to nothing; `done` then runs the removal /
  // break callback exactly as a normal detonation would have.
  const dissolving=new Set();
  function dissolveWithPlasm(object,done,coverMs=450,shrinkMs=800) {
    if (!object?.isObject3D || object.userData?.witchBombDissolving) {done?.();return false;}
    object.userData.witchBombDissolving=true;
    let cover=null;
    try {
      const shell=window.SubstanceCoverShell;
      if (shell?.available) {
        const map=window.DevRandomRuinLichThemes?.plasmTexture?.()||null;
        cover=shell.create(object,{thickness:.05,opacity:0,map,color:map?0x6a3fa8:0x4b2f78});
      }
    } catch(error) {console.warn('[WitchBombs] plasm cover failed',error);}
    dissolving.add({object,cover,done,age:0,coverMs,shrinkMs,base:object.scale.clone()});
    return true;
  }
  function tickDissolve(step) {
    for (const entry of [...dissolving]) {
      entry.age+=step*1000;
      if (!entry.object.parent && entry.age<entry.coverMs+entry.shrinkMs) {entry.cover?.dispose?.();dissolving.delete(entry);continue;} // Removed by something else mid-fade.
      if (entry.age<entry.coverMs) entry.cover?.setOpacity?.(.95*entry.age/entry.coverMs);
      else {
        entry.cover?.setOpacity?.(.95);
        const t=clamp((entry.age-entry.coverMs)/entry.shrinkMs,0,1);
        entry.object.scale.copy(entry.base).multiplyScalar(Math.max(.001,1-t*t*(3-2*t)));
      }
      if (entry.age>=entry.coverMs+entry.shrinkMs) {
        entry.cover?.dispose?.();
        dissolving.delete(entry);
        try {entry.done?.();} catch(error) {console.warn('[WitchBombs] dissolve completion failed',error);}
      }
    }
  }
  // The detonation recording played backwards (Kanthic): decoded once, reversed in place.
  let reversedBlast=null,reversedLoading=null,reverseContext=null;
  function playReversedBlast() {
    const audio=window.AudioSystem,cfg=audio?.objectSfxConfig?.()?.[BLAST_SFX_KEY],settings=audio?.gameAudioConfig?.()||{};
    if (!cfg?.url || settings.enabled===false) return false;
    const volume=clamp(Number(cfg.volume)||.95,0,1)*clamp(Number(settings.sfxVolume??1),0,1.5);
    const Context=window.AudioContext||window.webkitAudioContext;
    if (!Context || volume<=.002) return false;
    try {
      reverseContext||=new Context();
      reverseContext.resume?.().catch?.(()=>{});
      const play=()=>{
        const source=reverseContext.createBufferSource(),gain=reverseContext.createGain();
        source.buffer=reversedBlast;gain.gain.value=volume;
        source.connect(gain).connect(reverseContext.destination);source.start();
      };
      if (reversedBlast) {play();return true;}
      if (!reversedLoading) reversedLoading=window.fetch(cfg.url).then(r=>{if(!r.ok)throw new Error('blast sample unavailable');return r.arrayBuffer();})
        .then(data=>reverseContext.decodeAudioData(data)).then(buffer=>{
          for (let c=0;c<buffer.numberOfChannels;c++) buffer.getChannelData(c).reverse();
          reversedBlast=buffer;
        }).catch(()=>{reversedLoading=null;});
      reversedLoading.then(()=>{if(reversedBlast)play();else audio.playObjectSfxKey?.(BLAST_SFX_KEY);}); // First blast waits for the decode; a failed decode falls back to the forward cue.
      return true;
    } catch(_) {return false;}
  }
  function breakNearby(mapId,x,z,radius,variant=VARIANTS.hronal) {
    for (const [id,record] of [...breakables]) {
      if (record.mapId!==mapId || !record.object?.parent) continue;
      record.object.updateWorldMatrix?.(true,true);
      const p=record.object.getWorldPosition?.(new THREE.Vector3()) || record.object.position;
      if (!p || Math.hypot(p.x-x,p.z-z)>Math.min(radius,Number(record.radius)||radius)) continue;
      const finish=()=>{
        let removed=true;
        try { if (typeof record.onBreak==='function') removed=record.onBreak(record.object,{mapId,x,y:p.y,z,radius})!==false; }
        catch(error){removed=false;console.warn('[HronalWitchBombs] breakable callback failed',error);}
        if (removed) {record.object.parent?.remove(record.object);breakables.delete(id);}
        else record.object.scale.set(1,1,1);
      };
      if (variant.plasm) {breakables.delete(id);dissolveWithPlasm(record.object,()=>{record.object.scale.set(1,1,1);finish();breakables.delete(id);});continue;} // Covered and shrunk, then removed.
      finish();
    }
    const markedProps=[]; // Collect scene nodes before callbacks or removals can change the traversal.
    currentScene()?.traverse?.(node=>{
      if (node.userData?.hronalBombBreakable!==true || node.userData?.hronalBombBreakQueued) return;
      node.updateWorldMatrix?.(true,false);
      const p=node.getWorldPosition?.(new THREE.Vector3());
      if (!p || Math.hypot(p.x-x,p.z-z)>radius) return;
      markedProps.push({node,y:p.y});
    });
    for (const {node,y} of markedProps) {
      if (!node.parent || node.userData.hronalBombBreakQueued) continue;
      node.userData.hronalBombBreakQueued=true;
      const finish=()=>{
        try { node.userData.onHronalBombBreak?.({mapId,x,y,z,radius}); }
        catch(error){console.warn('[HronalWitchBombs] breakable callback failed',error);}
        finally { node.parent?.remove(node); }
      };
      if (variant.plasm) dissolveWithPlasm(node,finish); else finish();
    }
  }
  function actorsWithin(mapId,x,z,radius) {
    const deps=window.Combat?.deps,TILE=Number(deps?.TILE)||64,list=[];
    const consider=actor=>{
      if (!actor||actor.health<=0) return;
      if ((actor.areaId&&actor.areaId!==mapId)||(actor.area&&actor.area!==mapId)) return;
      if (Math.hypot(Number(actor.x)/TILE-x,Number(actor.y)/TILE-z)<=radius) list.push(actor);
    };
    consider(deps?.player);
    for (const actor of deps?.hostileObjects||[]) consider(actor);
    return list;
  }
  function dissolveNearbyExplosives(mapId,x,z,radius,sourceId) { // Kanthic: casks and the like are removed, not detonated.
    let count=0;
    for (const burden of window.Shattercasks?.activeBurdenRecords?.(mapId)||[]) {
      if (!burden||burden.id===sourceId||burden.exploded||burden.carried||burden.flying||!burden.group?.parent||KINDS.has(burden.kind)) continue;
      if (burden.kind!=='shattercask'&&burden.kind!=='flameShattercask'&&burden.kind!=='soursap') continue;
      burden.group.updateWorldMatrix?.(true,true);
      const world=burden.group.getWorldPosition?.(new THREE.Vector3())||burden.group.position;
      if (!world||Math.hypot(world.x-x,world.z-z)>radius) continue;
      burden.exploded=true; // Never detonate while it dissolves (a later hit must not pop it).
      if (dissolveWithPlasm(burden.group,()=>window.Shattercasks?.discardBurden?.(burden))) count++;
    }
    return count;
  }
  function explode(bomb,cause='fuse') {
    if (!bomb || bomb.exploded || bomb._witchBombExploding) return false;
    bomb._witchBombExploding=true;
    const variant=variantOfKind(bomb.kind);
    bomb.group?.updateWorldMatrix?.(true,true);
    const position=bomb.group?.getWorldPosition?.(new THREE.Vector3()) || bomb.group?.position;
    if (!position) {window.Shattercasks?.discardBurden?.(bomb);return false;}
    const carrier=window.Shattercasks?.backCarrierPosition?.(bomb); // An expired back-carried fuse explodes exactly at the carrier, not the art offset.
    const x=carrier?.x??position.x,z=carrier?.z??position.z,y=carrier?.y??position.y,mapId=bomb.mapId;
    const scene=bomb.group.parent?.isScene?bomb.group.parent:currentScene();
    window.Shattercasks?.applyBlast?.(mapId,x,z,{
      y,sourceId:bomb.id,
      radius:BLAST_RADIUS,damage:variant.damage,minimumDamage:variant.minimumDamage,
      knockbackPxS:variant.knockbackPxS,tag:variant.tag,
      reason:variant.displayName,burningHealth:variant.burningHealth||0,
      footingDamage:variant.footingDamage,footingDamageMultiplier:1.5,
      afflictionBonuses:variant.afflictionBonuses,
    });
    if (variant.frostbittenStamina) for (const actor of actorsWithin(mapId,x,z,BLAST_RADIUS)) window.ResourceSystem?.addAffliction?.(actor,'frostbittenStamina',variant.frostbittenStamina); // The existing Tothal frost affliction.
    if (variant.plasm) {
      dissolveNearbyExplosives(mapId,x,z,BLAST_RADIUS,bomb.id);
      window.DevRandomRuinLichThemes?.createPlasmPuddle?.(x,z,{radius:variant.plasm.radius,ttl:variant.plasm.ttl,y});
    } else window.Shattercasks?.triggerBurdenBlastAt?.(mapId,x,z,BLAST_RADIUS,bomb.id);
    breakNearby(mapId,x,z,BLAST_RADIUS,variant);
    buildEffect(scene,x,y,z,variant);
    if (!(variant.reverseSfx&&playReversedBlast())) window.AudioSystem?.playObjectSfxKey?.(BLAST_SFX_KEY); // Same recording for every variant; Kanthic plays it backwards.
    clearEnemyGrip(bomb); // An explosion must release the carrier's procedural two-hand target before its mesh is removed.
    window.Shattercasks?.discardBurden?.(bomb);
    window.__farmLog?.('[witch-bomb:'+variant.id+'] '+bomb.id+' exploded via '+cause,'world');
    return true;
  }
  function createGroupFactory() {
    for (const variant of Object.values(VARIANTS)) window.Shattercasks.registerBurdenFactory(variant.kind,async()=>{
      const data=await window.AuthoredFurniture?.load?.(variant.furnitureKey);
      if (!data || !window.AuthoredFurniture?.buildGroup) throw new Error(variant.displayName+' authored sphere failed to load.');
      return {group:window.AuthoredFurniture.buildGroup(data),data,displayName:variant.displayName,onImpact:impact};
    });
  }
  async function spawn(options={}) {
    const mapId=String(options.mapId||currentArea()),scene=options.scene||currentScene();
    if (!mapId||!scene) return null;
    const variant=VARIANTS[options.variant]||VARIANTS[ruinVariantId(mapId)]; // A bomb's tradition follows the ruin it appears in.
    const id=String(options.id||(variant.kind+'_'+(++spawnSerial)));
    const bomb=await window.Shattercasks.createHangingBurden({
      ...options,id,mapId,scene,kind:variant.kind,displayName:variant.displayName,
      furnitureKey:variant.furnitureKey,hanging:options.hanging===true,
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
    if (dispensers.get(key)!==dispenser) {
      window.Shattercasks.discardBurden?.(bomb); // The room or dispenser was removed while its payload loaded.
      return false;
    }
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
    if (!body.parent || (Number(enemy.health)||0)<=0) {
      window.Shattercasks?.discardBurden?.(bomb); // A late async load must not attach an item to an already-despawned/dead enemy.
      return null;
    }
    const previousPickup=bomb.onPickup,previousLost=bomb.onLost;
    bomb.onPickup=record=>{try{previousPickup?.(record);}finally{clearEnemyGrip(record);}}; // Player pickup transfers ownership away from the enemy hand rig.
    bomb.onLost=(record,cause)=>{try{previousLost?.(record,cause);}finally{clearEnemyGrip(record);}}; // Hazard loss/disposal also releases the hand target.
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
    clearEnemyGrip(bomb);
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
      if (!KINDS.has(bomb.kind)||bomb.exploded) continue;
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
      const elapsed=Math.max(0,(now()-bomb.spawnedAtMs)/1000); // Absolute fuse age keeps the pulse synchronized after dropped frames.
      const remaining=Math.max(0,fuse-elapsed);
      const urgency=clamp(elapsed/fuse,0,1);
      const phase=2*Math.PI*(.9*elapsed+6.6*fuse*Math.pow(urgency,4)/4); // Integral of the accelerating frequency, so the glow never jumps phase.
      window.FurniturePatternSurfaces?.setGlowState?.(bomb.group,{
        intensity:1.05+.65*urgency,
        pulseSpeed:.9+6.6*Math.pow(urgency,3),
        pulseDepth:.68+.24*urgency,
        phase,
        color:variantOfKind(bomb.kind).glow,
      });
      bomb.group.userData.hronalFuse={remainingSeconds:remaining,totalSeconds:fuse,progress:1-remaining/fuse};
      if (remaining<=0) explode(bomb,'fuse');
    }
    tickDissolve(step);
    for(let i=bursts.length-1;i>=0;i--) {
      const state=bursts[i];state.age+=step;
      const t=clamp(state.age/state.duration,0,1);
      state.flash.scale.setScalar(.22+BLAST_RADIUS*.22*Math.min(1,t/.35));
      state.flash.material.opacity=.92*Math.max(0,1-t/.34);
      for(let j=0;j<state.parts.length;j++){
        const part=state.parts[j];
        part.x+=part.vx*step;part.y+=part.vy*step;part.z+=part.vz*step;
        part.vy-=(state.gravity??2.3)*step;
        state.dummy.position.set(part.x,part.y,part.z);
        state.direction.set(part.vx,part.vy,part.vz).normalize();
        state.dummy.quaternion.setFromUnitVectors(state.up,state.direction);
        state.dummy.scale.setScalar(Math.max(.001,(1-t)*(.72+(j%4)*.12)));
        state.dummy.updateMatrix();
        state.flames.setMatrixAt(j,state.dummy.matrix);
      }
      state.flames.instanceMatrix.needsUpdate=true;
      state.material.opacity=.94*(1-t);
      if(t>=1){
        state.group.parent?.remove(state.group);
        state.geometry.dispose();state.material.dispose();
        state.flash.geometry.dispose();state.flash.material.dispose();
        bursts.splice(i,1);
      }
    }
  }
  function debugSnapshot() {
    return {
      latestChange:'Witch-bomb detonation uses the lowblast SFX; the spawn-time fuse, glyph acceleration and dispenser recycle behavior are unchanged.',
      blastSfxKey:BLAST_SFX_KEY,
      dispensers:[...dispensers.values()].map(item=>({id:item.id,mapId:item.mapId,activeBombId:item.activeBombId,dispensing:item.dispensing,fuseSeconds:item.fuseSeconds})),
      variants:Object.keys(VARIANTS),ruinVariant:ruinVariantId(currentArea()),dissolving:dissolving.size,
      activeBombs:(window.Shattercasks.activeBurdenRecords?.(currentArea())||[]).filter(item=>KINDS.has(item.kind)).map(item=>({
        kind:item.kind,
        id:item.id,remainingSeconds:Math.max(0,(Number(item.fuseSeconds)||DEFAULT_FUSE_SECONDS)-(now()-Number(item.spawnedAtMs||now()))/1000),
        carrier:item.enemyCarrier?.id||null,hanging:!!item.hanging,flying:!!item.flying,
      })),
      breakables:breakables.size,activeFlashes:bursts.length,
    };
  }
  createGroupFactory();
  window.HronalWitchBombs=Object.freeze({
    installed:true,KIND,KINDS,VARIANTS,DEFAULT_FUSE_SECONDS,BLAST_RADIUS,isWitchBombKind:kind=>KINDS.has(kind),variantFor:ruinVariantId,dissolveWithPlasm,
    spawn,registerDispenser,unregisterDispenser,dispenseFromMechanism,spawnCarriedByEnemy,
    registerBreakable,dropEnemyBomb,tick,debugSnapshot,
  });
})();
