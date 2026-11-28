// Short-lived world-ground flame patches shared by fire flasks and flame Shattercasks.
// Fire remains in the world after impact and can ignite paired cave sconces.
(() => {
  'use strict';
  if (window.PersistentGroundFire) return;
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
  function dispose(zone) {
    for(const visual of zone.flameVisuals||[])visual?.dispose?.(); // Authored emitter disposes its own GPU buffers; never double-dispose shared assets.
    zone.flameVisuals=[];
    zone.mesh?.parent?.remove?.(zone.mesh);
    zone.mesh=null;
    zone.scene=null;
  }
  function buildVisual(zone) {
    const THREE=window.THREE,scene=deps?.getActiveScene?.();
    if(!THREE?.Group||!scene||zone.mesh)return;
    const group=new THREE.Group();
    group.name='persistent_ground_fire';
    group.position.set(zone.x,zone.y+.03,zone.z);
    const ring=Math.max(.12,zone.radius*.62); // Fire coverage matches the same radius used for damage and sconce ignition.
    const points=[[0,0],[.85,.08],[-.62,.5],[-.32,-.78],[.45,-.65],[-.95,-.1],[.15,1]];
    zone.flameVisuals=[]; // Per-patch emitters reuse the same authored particle shader instead of opaque cones and a flat disc.
    for(let i=0;i<points.length;i++){
      const anchor=new THREE.Group();
      anchor.position.set(points[i][0]*ring,0,points[i][1]*ring);
      group.add(anchor);
      const visual=attachCampfireFlame(anchor,{scale:i===0?1.1:.85,rateScale:i===0?.38:.23});
      if(visual)zone.flameVisuals.push(visual);
    }
    scene.add(group);zone.mesh=group;zone.scene=scene;
  }
  function ignite({area,x,z,y=0,radius=1.5,seconds=DEFAULT_DURATION,source='unknown'}={}) {
    const px=Number(x),pz=Number(z),floorY=Number(y);
    if(!String(area||'')||!Number.isFinite(px)||!Number.isFinite(pz)||!Number.isFinite(floorY)||
       String(area)!==String(deps?.getCurrentArea?.()||''))return false;
    const patch={area:String(area),x:px,z:pz,y:floorY,radius:Math.max(.3,Math.min(4,Number(radius)||1.5)),
      seconds:Math.max(.5,Math.min(25,Number(seconds)||DEFAULT_DURATION)),age:0,damageTimer:0,
      source:String(source)};
    // Neighboring splashes extend the fire but never grow unbounded or multiply damage on one tile.
    const old=zones.find(z=>z.area===patch.area&&Math.abs(z.y-floorY)<=FLOOR_TOLERANCE&&Math.hypot(z.x-px,z.z-pz)<.5);
    if(old){old.seconds=Math.max(old.seconds,old.age+patch.seconds);return true;}
    if(zones.length>=MAX_ZONES)dispose(zones.shift());
    zones.push(patch);buildVisual(patch);
    lastIgnition={area:patch.area,x:px,z:pz,radius:patch.radius,source:patch.source};
    return true;
  }
  const PLASM_FIRE_RADIUS=1.5; // Every ordinary flame clears a modest local area, not an entire dungeon.
  let fireScene=null,fireScanAt=-Infinity,fireFurniture=[]; // Scan only while plasm exists, amortized across calls.
  let firePosition=null; // Reuse the scratch world point for all physical fire sources.
  function plasmFireSources(area,scene,player,tile,feetY){
    const sources=[];
    if(window.AdventuringTools?.isLit?.()&&player&&Number(player.health)>0&&Number.isFinite(feetY))
      sources.push({x:player.x/tile,z:player.y/tile,y:feetY,radius:PLASM_FIRE_RADIUS}); // Same authoritative flame for held and belt-stowed torch.
    for(const fire of zones)if(fire.area===area&&fire.age<fire.seconds&&!/skeleton|magic|lich|enchant/i.test(fire.source))
      sources.push({x:fire.x,z:fire.z,y:fire.y,radius:Math.min(2,Math.max(1,fire.radius))});
    if(area==='map_i_dev_random_ruin')for(const light of window.DevRandomRuinSanctum?.ordinaryFireSources?.()||[])
      if(light.active!==false)sources.push({x:light.x,z:light.z,y:light.floorY,radius:PLASM_FIRE_RADIUS});
    const now=performance.now();
    if(scene!==fireScene||now-fireScanAt>=750){
      fireScene=scene;fireScanAt=now;fireFurniture=[];
      scene?.traverse?.(object=>{
        // Recognize conventional physical fire furniture, not magical seals, checkpoint flames or eye glow.
        const key=String(object.userData?.authoredFurnitureKey||object.userData?.ruinFurnitureKey||object.name||'');
        if(object.userData?.fireHazard===true&&!/ruin-(small|shaft)|lich|magic|blue|checkpoint/i.test(key)&&/campfire|fireplace|torch|fire.source|sconce|brazier/i.test(key))fireFurniture.push(object);
      });
    }
    for(const object of fireFurniture){
      if(object.userData?.fireHazard!==true)continue;
      let node=object;while(node&&node!==scene&&node.visible!==false)node=node.parent;
      if(node!==scene)continue;
      if(!object.getWorldPosition||!window.THREE?.Vector3)continue;
      firePosition ||= new window.THREE.Vector3();object.getWorldPosition(firePosition);
      if(!Number.isFinite(firePosition.x+firePosition.y+firePosition.z))continue;
      // Furniture anchors can be above their supporting floor; the 3D tolerance below prevents cross-story cleansing.
      sources.push({x:firePosition.x,z:firePosition.z,y:firePosition.y,radius:PLASM_FIRE_RADIUS});
    }
    return sources;
  }

  function intersects(area,x,z,distance=0,floorY=null) {
    const px=Number(x),pz=Number(z);
    if(!Number.isFinite(px)||!Number.isFinite(pz))return false;
    return zones.some(patch=>patch.area===String(area)&&patch.age<patch.seconds
      &&(!Number.isFinite(floorY)||Math.abs(patch.y-floorY)<=FLOOR_TOLERANCE)
      &&Math.hypot(px-patch.x,pz-patch.z)<=patch.radius+Math.max(0,Number(distance)||0));
  }
  function update(dt) {
    const elapsed=Number.isFinite(Number(dt)) ? Math.max(0,Number(dt)) : 0; // A slow/mobile frame still advances the real fire lifetime, not a 250ms-capped clock.
    if(!zones.length||!elapsed)return; // Idle worlds skip even the area/scene getters and entity scans.
    const area=String(deps?.getCurrentArea?.()||''),scene=deps?.getActiveScene?.();
    const tile=Number(deps?.TILE)||64;
    const ruin=area==='map_i_dev_random_ruin'?window.DevRandomRuin:null; // Only ruins stack multiple floors at the same coordinates.
    const player=ruin?deps?.getPlayer?.():null; // Used for the player's separate ruin support height.
    for(let index=zones.length-1;index>=0;index--){
      const patch=zones[index];
      if(patch.area!==area||(patch.scene&&patch.scene!==scene)||patch.age>=patch.seconds){
        dispose(patch);zones.splice(index,1);continue;
      }
      patch.age+=elapsed;
      if(patch.age>=patch.seconds){dispose(patch);zones.splice(index,1);continue;} // Expire before applying fresh damage on a frame after the fire is gone.
      patch.damageTimer+=elapsed;
      if(!patch.mesh)buildVisual(patch); // A patch created before the cave scene is ready still gains visible flames once mounted.
      for(const visual of patch.flameVisuals||[])visual?.update?.(Math.min(.05,elapsed));
      if(patch.damageTimer>=DAMAGE_INTERVAL) {
        patch.damageTimer=0;
        const nearby=deps?.getSplashEntities?.(area,patch.x*tile,patch.z*tile,patch.radius*tile)||[];
        for(const actor of nearby){
          if(!actor||Number(actor.health)<=0)continue;
          if(patch.source==='ruin-skeleton-lunge'&&actor.ruinSkeletonTheme==='hronal')continue; // Charred skeletons ignore their trails.
          if(Math.hypot(Number(actor.x)/tile-patch.x,Number(actor.y)/tile-patch.z)>patch.radius)continue;
          if(ruin){
            const feetY=actor.physicalFeetY??(actor===player?ruin.getPlayerSupportY?.()
              :actor.shaftSupportY??actor.surfaceYOverride?.()??actor.surfaceY??(actor.avatarRef?.group?.position?.y-(actor.halfHeight||0))); // Known feet height keeps fire damage on its own floor.
            if(Number.isFinite(feetY)&&Math.abs(feetY-patch.y)>.9)continue;
          }
          window.ResourceSystem?.addAffliction?.(actor,'burningHealth',5); // Uses ordinary water/roll extinguish behavior.
        }
      }
    }
  }
  function clear(area=null){
    for(let i=zones.length-1;i>=0;i--)if(area==null||zones[i].area===String(area)){
      dispose(zones[i]);zones.splice(i,1);
    }
  }
  window.PersistentGroundFire=Object.freeze({
    init(injected){deps=injected||null;},ignite,intersects,update,clear,attachCampfireFlame,plasmFireSources,
    debugSnapshot:()=>({count:zones.length,campfireTemplateReady:!!campfireTemplate,lastIgnition,zones:zones.map(z=>({
      area:z.area,x:z.x,y:z.y,z:z.z,remaining:+(z.seconds-z.age).toFixed(1),source:z.source
    }))}),
  });
})();
