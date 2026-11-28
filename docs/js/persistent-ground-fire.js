// Short-lived world-ground flame patches shared by fire flasks and flame Shattercasks.
// Fire remains in the world after impact and can ignite paired cave sconces.
(() => {
  'use strict';
  if (window.PersistentGroundFire) return;
  const MAX_TILES=160; // Hard cap on live tile emitters, including overlapping bursts.
  const MAX_ZONES=14; // Strict scene cap keeps simultaneous fire cheap on mobile.
  const DEFAULT_DURATION=11; // Seconds a thrown flask leaves a live patch after shattering.
  const FLOOR_TOLERANCE=.45; // Ground patches at different heights must stay separate in stacked rooms.
  const DAMAGE_INTERVAL=.35; // Periodic player/enemy Burn application, not a per-frame entity sweep.
  let deps=null; // AlchemyFlasks.init supplies the established combat/terrain entity adapters.
  const zones=[]; // One scene-owned patch per recent impact; removed on expiry or area transition.
  let lastIgnition=null; // Mobile-accessible impact diagnostic, no console required.
  let campfireTemplatePromise=null; // One async load of the authored campfire flame emitter, shared by patches and cave sconces.
  let campfireTemplate=null; // Cached original campfire particle settings; every instance receives an independent copy.

  function ensureCampfireTemplate() {
    const authored=window.AuthoredFurniture; // The ordinary campfire's furniture emitter remains the sole visual authority for all puzzle flames.
    const pick=data=>data?.particleEmitters?.find(record=>record?.enabled!==false&&record.type==='fire')||null;
    if(campfireTemplate)return Promise.resolve(campfireTemplate);
    const cached=pick(authored?.peek?.('campfire'));
    if(cached){campfireTemplate=cached;return Promise.resolve(cached);}
    if(!campfireTemplatePromise){
      campfireTemplatePromise=Promise.resolve().then(()=>authored?.load?.('campfire')).then(data=>{
        campfireTemplate=pick(data);
        if(!campfireTemplate){
          campfireTemplatePromise=null; // Retry if the first ignition preceded authored-furniture initialization.
          window.__farmLog?.('[puzzle-fire] authored campfire flame unavailable','warn');
        }
        return campfireTemplate;
      }).catch(error=>{
        campfireTemplatePromise=null; // A late furniture-loader recovery can retry rather than leave invisible fires permanently.
        window.__farmLog?.('[puzzle-fire] campfire flame load failed: '+String(error?.message||error),'warn');
        return null;
      });
    }
    return campfireTemplatePromise;
  }
  function attachCampfireFlame(anchor,{scale=1,rateScale=1,colorA=null,colorB=null}={}) {
    if(!anchor?.add)return null;
    const state={anchor,visual:null,disposed:false}; // One independent renderer for each attached patch location or stone sconce.
    ensureCampfireTemplate().then(source=>{
      if(state.disposed||!source||!window.AuthoredFurniture?.createEmitterVisual)return;
      const emitter=JSON.parse(JSON.stringify(source)); // Do not mutate the campfire authoring shared with the player's campfire.
      delete emitter.attachedPartId; // An independent fire anchor does not contain the campfire ash furniture part.
      emitter.id='puzzle_campfire_flame';
      if(typeof colorA==='string'&&/^#[0-9a-f]{6}$/i.test(colorA))emitter.colorA=colorA; // Theme-only tint; particle motion is still the player's authored campfire.
      if(typeof colorB==='string'&&/^#[0-9a-f]{6}$/i.test(colorB))emitter.colorB=colorB; // Keep optional blue/green variant on the same shared fire template.
      emitter.position={x:0,y:0,z:0};
      emitter.radius=Math.max(.025,Number(source.radius||.13)*scale);
      emitter.size=Math.max(.04,Number(source.size||.19)*scale);
      emitter.speed=Math.max(.05,Number(source.speed||.7)*scale);
      emitter.spread=Number(source.spread||.3)*scale;
      emitter.rate=Math.max(3,Math.round(Number(source.rate||38)*rateScale));
      const capacity=Math.max(8,Math.ceil(emitter.rate*Number(source.lifetime||.72))+3);
      state.visual=window.AuthoredFurniture.createEmitterVisual(anchor,emitter,capacity);
      const points=state.visual?.points; // Optional conservative bound for the Kanthic depth replay, not a new emitter.
      if(points?.userData){
        const lifetime=Number(emitter.lifetime)||.72;
        const travel=(Math.abs(emitter.speed)+Math.sqrt(3)*Math.abs(emitter.spread)*.5)*lifetime;
        points.userData.hobunjiFlameBoundsRadius=Math.abs(emitter.radius)+travel+Math.abs(emitter.gravity||0)*lifetime*lifetime+2*Math.abs(emitter.size);
      }
      state.visual?.update?.(Math.min(.05,1/emitter.rate),true); // Show particles promptly even immediately after the torch is lit.
    }).catch(error=>window.__farmLog?.('[puzzle-fire] flame renderer failed: '+String(error?.message||error),'warn'));
    return {
      update(dt,lit=true){if(!state.disposed)state.visual?.update?.(dt,lit!==false&&anchor.visible!==false);}, // Outdoor wall torches and festival fires must honor their ambient scheduler's rain-extinguish state.
      dispose(){state.disposed=true;state.visual?.dispose?.();state.visual=null;},
    };
  }
  const tileKey=(x,z)=>Math.floor(x)+','+Math.floor(z); // One independent surface cell per tile and floor.
  function disposeCell(cell) {
    cell.visual?.dispose?.();
    cell.anchor?.parent?.remove?.(cell.anchor);
    cell.anchor=null;cell.visual=null;
  }
  function dispose(zone) {
    for(const cell of zone.cells.values())disposeCell(cell);
    zone.cells.clear();
    zone.mesh?.parent?.remove?.(zone.mesh);zone.mesh=null;zone.scene=null;
  }
  function buildCell(zone,cell) {
    if(!zone.mesh||cell.anchor)return;
    const anchor=new window.THREE.Group();
    anchor.position.set(cell.x+.5,cell.y+.03,cell.z+.5);
    zone.mesh.add(anchor);cell.anchor=anchor;
    cell.visual=attachCampfireFlame(anchor,{scale:.85,rateScale:.23});
  }
  function buildVisual(zone) {
    const THREE=window.THREE,scene=deps?.getActiveScene?.();
    if(!THREE?.Group||!scene||zone.mesh)return;
    const group=new THREE.Group();group.name='persistent_ground_fire';
    scene.add(group);zone.mesh=group;zone.scene=scene;
    for(const cell of zone.cells.values())buildCell(zone,cell);
  }
  function ordinaryGroundFire(source){return !/skeleton|magic|lich|enchant/i.test(String(source));}
  function supportY(area,x,z,y){
    const support=window.DynamicSurfaces?.sampleSupport?.(x+.5,z+.5,{area,minY:y-FLOOR_TOLERANCE,maxY:y+FLOOR_TOLERANCE,pad:.02});
    if(Number.isFinite(support?.y)&&Math.abs(support.y-y)<=FLOOR_TOLERANCE)return support.y;
    // The injected terrain owner is authoritative for ground and does not invent platforms above it.
    if(typeof deps?.getGroundYAtWorld!=='function')return y;
    const ground=deps.getGroundYAtWorld(x+.5,z+.5);
    if(!Number.isFinite(ground)||Math.abs(ground-y)>FLOOR_TOLERANCE)return null;
    if(area==='map_i_dev_random_ruin'){
      const floorSet=window.DevRandomRuin?.getRuntimeContext?.()?.floorSet;
      if(floorSet&&!floorSet.has(tileKey(x,z)))return null;
    }
    return ground;
  }
  function lookupCell(area,x,z,y){
    const key=tileKey(x,z);
    for(const zone of zones){
      if(zone.area!==area)continue;
      const cell=zone.cells.get(key);
      if(cell&&Math.abs(cell.y-y)<=FLOOR_TOLERANCE)return cell;
    }
    return null;
  }
  function tileCount(){let count=0;for(const zone of zones)count+=zone.cells.size;return count;}
  function ignite({area,x,z,y=0,radius=1.5,seconds=DEFAULT_DURATION,source='unknown',square3x3=false}={}) {
    const px=Number(x),pz=Number(z),floorY=Number(y);
    if(!String(area||'')||![px,pz,floorY].every(Number.isFinite)||String(area)!==String(deps?.getCurrentArea?.()||''))return false;
    area=String(area);source=String(source);
    const range=Math.max(.3,Math.min(4,Number(radius)||1.5)),ttl=Math.max(.5,Math.min(25,Number(seconds)||DEFAULT_DURATION));
    const centerX=Math.floor(px),centerZ=Math.floor(pz);
    const extent=square3x3?1:Math.ceil(range);
    const patch={area,x:px,z:pz,y:floorY,radius:square3x3?2.2:range,source,cells:new Map(),damageTimer:0};
    let touched=0;
    for(let tz=centerZ-extent;tz<=centerZ+extent;tz++)for(let tx=centerX-extent;tx<=centerX+extent;tx++){
      if(!square3x3&&(tx!==centerX||tz!==centerZ)&&Math.hypot(tx+.5-px,tz+.5-pz)>range)continue;
      const sy=supportY(area,tx,tz,floorY);
      if(!Number.isFinite(sy)||area==='map_i_dev_random_ruin'&&window.DevRandomRuinTileOccupancy?.solidAt?.(tx+.5,tz+.5,.05,sy+.35))continue;
      const old=lookupCell(area,tx,tz,sy);
      if(old){
        old.remaining=Math.max(old.remaining,ttl);
        if(ordinaryGroundFire(source))old.ordinaryRemaining=Math.max(old.ordinaryRemaining,ttl);
        if(source!=='ruin-skeleton-lunge')old.source=source;
      }else patch.cells.set(tileKey(tx,tz),{x:tx,z:tz,y:sy,remaining:ttl,ordinaryRemaining:ordinaryGroundFire(source)?ttl:0,source,anchor:null,visual:null});
      touched++;
    }
    if(patch.cells.size){
      while(zones.length&&(zones.length>=MAX_ZONES||tileCount()+patch.cells.size>MAX_TILES))dispose(zones.shift());
      zones.push(patch);buildVisual(patch);
    }
    if(touched)lastIgnition={area,x:px,z:pz,radius:patch.radius,source,tiles:touched,square3x3};
    return touched>0;
  }
  function extinguishTile({area,x,z,y}={}){
    if(![x,z,y].every(Number.isFinite))return false;
    const key=tileKey(x,z);let removed=false;
    for(let i=zones.length-1;i>=0;i--){
      const zone=zones[i],cell=zone.cells.get(key);
      if(zone.area!==area||!cell||Math.abs(cell.y-y)>FLOOR_TOLERANCE)continue;
      disposeCell(cell);zone.cells.delete(key);removed=true;
      if(!zone.cells.size){dispose(zone);zones.splice(i,1);}
    }
    return removed;
  }
  function isBurningTile({area,x,z,y}={}){
    if(![x,z,y].every(Number.isFinite))return false;
    return !!lookupCell(area,x,z,y);
  }
  const PLASM_FIRE_RADIUS=1.5; // Every ordinary flame clears a modest local area, not an entire dungeon.
  let fireScene=null,fireScanAt=-Infinity,fireFurniture=[]; // Scan only while plasm exists, amortized across calls.
  let firePosition=null; // Reuse the scratch world point for all physical fire sources.
  function plasmFireSources(area,scene,player,tile,feetY){
    const sources=[];
    if(window.AdventuringTools?.isLit?.()&&player&&Number(player.health)>0&&Number.isFinite(feetY))
      sources.push({x:player.x/tile,z:player.y/tile,y:feetY,radius:PLASM_FIRE_RADIUS}); // Same authoritative flame for held and belt-stowed torch.
    for(const fire of zones)if(fire.area===area)for(const cell of fire.cells.values())
      if(cell.ordinaryRemaining>0)sources.push({x:cell.x+.5,z:cell.z+.5,y:cell.y,radius:PLASM_FIRE_RADIUS});
    if(area==='map_i_dev_random_ruin')for(const light of window.DevRandomRuinSanctum?.ordinaryFireSources?.()||[])
      if(light.active!==false)sources.push({x:light.x,z:light.z,y:light.floorY,radius:PLASM_FIRE_RADIUS});
    const now=typeof performance!=='undefined'?performance.now():Date.now();
    if(scene!==fireScene||now-fireScanAt>=750){
      fireScene=scene;fireScanAt=now;fireFurniture=[];
      scene?.traverse?.(object=>{
        // Recognize conventional physical fire furniture, not magical seals, checkpoint flames or eye glow.
        const key=String(object.userData?.authoredFurnitureKey||object.userData?.ruinFurnitureKey||object.name||'');
        if(object.userData?.ordinaryFire===true)return; // Explicit sanctum sources already entered above; never double-count.
        if(Object.prototype.hasOwnProperty.call(object.userData||{},'fireHazard')&&!/ruin-(small|shaft)|lich|magic|blue|checkpoint|rune/i.test(key)&&/campfire|bonfire|fireplace|torch|fire.source|sconce|brazier|candle/i.test(key))fireFurniture.push(object);
      });
    }
    for(const object of fireFurniture){
      if(object.userData?.fireHazard!==true)continue;
      let node=object,extinguished=false;
      while(node&&node!==scene&&node.visible!==false){
        if(node.userData?.festivalWeatherFire&&window.WeatherFX?.isRaining?.()){extinguished=true;break;}
        node=node.parent;
      }
      if(node!==scene||extinguished)continue;
      if(!object.getWorldPosition||!window.THREE?.Vector3)continue;
      firePosition ||= new window.THREE.Vector3();object.getWorldPosition(firePosition);
      if(!Number.isFinite(firePosition.x+firePosition.y+firePosition.z))continue;
      // Furniture anchors can be above their supporting floor; the 3D tolerance below prevents cross-story cleansing.
      sources.push({x:firePosition.x,z:firePosition.z,y:firePosition.y,radius:PLASM_FIRE_RADIUS});
    }
    return sources;
  }

  function intersects(area,x,z,distance=0,floorY=null) {
    const px=Number(x),pz=Number(z),range=Math.max(0,Number(distance)||0);
    if(!Number.isFinite(px)||!Number.isFinite(pz))return false;
    for(const zone of zones)if(zone.area===String(area))for(const cell of zone.cells.values()){
      if(Number.isFinite(floorY)&&Math.abs(cell.y-floorY)>FLOOR_TOLERANCE)continue;
      if(!range){if(Math.floor(px)===cell.x&&Math.floor(pz)===cell.z)return true;continue;}
      const dx=Math.max(0,cell.x-px,px-cell.x-1),dz=Math.max(0,cell.z-pz,pz-cell.z-1);
      if(dx*dx+dz*dz<=range*range)return true;
    }
    return false;
  }
  function update(dt) {
    const elapsed=Number.isFinite(Number(dt))?Math.max(0,Number(dt)):0;
    if(!zones.length||!elapsed)return;
    const area=String(deps?.getCurrentArea?.()||''),scene=deps?.getActiveScene?.(),tile=Number(deps?.TILE)||64;
    const ruin=area==='map_i_dev_random_ruin'?window.DevRandomRuin:null;
    const player=ruin?deps?.getPlayer?.():null;
    const burned=new Set(); // No duplicate applications when multiple patch queries see one actor.
    for(let i=zones.length-1;i>=0;i--){
      const patch=zones[i];
      if(patch.area!==area||(patch.scene&&patch.scene!==scene)){dispose(patch);zones.splice(i,1);continue;}
      if(!patch.mesh)buildVisual(patch);
      for(const [key,cell] of patch.cells){
        cell.remaining-=elapsed;cell.ordinaryRemaining-=elapsed;
        if(cell.remaining<=0){disposeCell(cell);patch.cells.delete(key);continue;}
        cell.visual?.update?.(Math.min(.05,elapsed));
      }
      if(!patch.cells.size){dispose(patch);zones.splice(i,1);continue;}
      patch.damageTimer+=elapsed;
      if(patch.damageTimer<DAMAGE_INTERVAL)continue;
      patch.damageTimer=0;
      // Query once per patch, not once per burning tile. The extra tile covers snapped footprint edges.
      const nearby=deps?.getSplashEntities?.(area,patch.x*tile,patch.z*tile,(patch.radius+1.5)*tile)||[];
      for(const actor of nearby){
        if(!actor||Number(actor.health)<=0||burned.has(actor))continue;
        const cell=patch.cells.get(tileKey(actor.x/tile,actor.y/tile));
        if(!cell)continue;
        if(cell.source==='ruin-skeleton-lunge'&&actor.ruinSkeletonTheme==='hronal')continue;
        if(window.AdventuringJug?.dodgeProtected?.(actor,area))continue;
        const feetY=actor.physicalFeetY??(actor===player?ruin?.getPlayerSupportY?.():actor.shaftSupportY??actor.surfaceYOverride?.()??actor.surfaceY??(actor.avatarRef?.group?.position?.y-(actor.halfHeight||0)));
        if(Number.isFinite(feetY)&&Math.abs(feetY-cell.y)>.9)continue;
        burned.add(actor);window.ResourceSystem?.addAffliction?.(actor,'burningHealth',5);
      }
    }
  }
  function clear(area=null){
    fireScene=null;fireScanAt=-Infinity;fireFurniture.length=0; // A retired world must not be retained by the fire-source cache.
    for(let i=zones.length-1;i>=0;i--)if(area==null||zones[i].area===String(area)){
      dispose(zones[i]);zones.splice(i,1);
    }
  }
  window.PersistentGroundFire=Object.freeze({
    init(injected){deps=injected||null;},ignite,intersects,extinguishTile,isBurningTile,update,clear,attachCampfireFlame,plasmFireSources,
    debugSnapshot:()=>({count:zones.length,tileCount:tileCount(),campfireTemplateReady:!!campfireTemplate,lastIgnition,zones:zones.map(z=>({
      area:z.area,x:z.x,y:z.y,z:z.z,remaining:+Math.max(...[...z.cells.values()].map(c=>c.remaining)).toFixed(1),source:z.source,
      tiles:[...z.cells.values()].map(c=>({x:c.x,y:c.y,z:c.z,remaining:+c.remaining.toFixed(1)}))
    }))}),
  });
})();
