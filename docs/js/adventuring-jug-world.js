// Runtime bridge: the isolated jug rules own liquid units; this owns world traces and temporary presentation.
(() => {
  'use strict';
  const ACTIONS=Object.freeze(['jug_pour','jug_splash','jug_empty']); // Stable physical action IDs.
  const MAX_FLIGHTS=4, GRAVITY=9.8, STEP=.05, MAX_STEPS=48; // Bounded trace work per release.
  let deps=null,rules=null,area=null,scene=null,lastTrace=null; // Injected game authority and active-scene lifetime.
  const flights=[], receivers=new Set(), surfaces=new Map(); // Temporary flight visuals, authored puzzle receivers, and consecrated decals.
  let simulationMs=0; // Advances only with gameplay dt; menus do not consume consecration duration.
  let surfaceGeometry=null,surfaceMaterial=null; // Shared by every consecrated tile, never cloned per tick.
  const key=t=>t.x+','+t.z+','+t.y;
  const local=()=>window.ActorRegistry?.getLocalPlayer?.()||deps?.getPlayer?.();
  const getArea=()=>deps?.getArea?.();
  const getScene=()=>deps?.getScene?.();
  const finite=p=>p&&[p.x,p.y,p.z].every(Number.isFinite);
  const isUndead=a=>!!(a?.isHarlyaoLich||a?.isMinion||a?.isHarlyaoDemolitionist||a?.ruinSkeletonTheme||a?.isUndead||a?.def?.undead||a?.def?.isUndead||/skeleton|ghoul|lich|undead|revenant/i.test(String(a?.creatureKey||a?.enemyClass||a?.def?.id||'')));
  function held(){return !!deps?.isHolding?.();}
  function showSurface(t){
    const THREE=window.THREE, active=getScene();
    if(!THREE||!active||t.area!==getArea())return;
    const k=key(t);
    if(surfaces.has(k))return;
    surfaceGeometry ||= new THREE.PlaneGeometry(.96,.96);
    surfaceMaterial ||= new THREE.MeshBasicMaterial({color:0x7df4ae,transparent:true,opacity:.28,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const mesh=new THREE.Mesh(surfaceGeometry,surfaceMaterial);
    mesh.name='life_water_consecrated_tile';mesh.rotation.x=-Math.PI/2;mesh.position.set(t.x+.5,t.y+.035,t.z+.5);
    active.add(mesh);surfaces.set(k,mesh);
  }
  function removeSurface(t){const mesh=surfaces.get(key(t));if(mesh){mesh.parent?.remove(mesh);surfaces.delete(key(t));}}
  function disposeFlight(f){f.points?.parent?.remove(f.points);f.points?.geometry?.dispose();f.points?.material?.dispose();}
  function clear(){
    if(area)rules?.clearArea(area);
    for(const f of flights){rules?.cancelImpact(f.ticket);disposeFlight(f);}
    flights.length=0;
    for(const mesh of surfaces.values())mesh.parent?.remove(mesh);
    surfaces.clear();rules?.endDodge(local());
  }
  function init(injected){
    clear();deps=injected;area=getArea();scene=getScene();simulationMs=0;
    rules=window.HobunjiCreateJugRuntime({
      nowMs:()=>simulationMs,
      onStateChanged:(actor,state)=>{if(actor===local()){deps.saveState?.(state);deps.refresh?.();}},
      extinguishTile:(t,owner)=>window.PersistentGroundFire?.extinguishTile?.(t),
      clearPlasmTile:t=>t.area==='map_i_dev_random_ruin'?window.DevRandomRuinLichThemes?.clearPlasmTile?.(t):window.HarlyaoLichCombat?.clearPlasmTile?.(t),
      fillReceptacle:(receiver,liquid,units,owner)=>receiver.accept(liquid,units,owner),
      onConsecrated:showSurface,onConsecrationExpired:removeSurface,
      actorsInArea:deps.actorsInArea,actorTile:deps.actorTile,
      isAlive:a=>Number(a?.health)>0&&!a._downed&&!a._deathTransitionStarted&&!a._denHidden&&!a._timeKnockedOut,
      isUndead,
      healLiving:a=>window.ResourceSystem?.applyHealthRecovery?.(a,Math.max(1,(window.ResourceSystem?.getEffectiveMax?.(a,'health')||100)*.01)),
      damageUndead:a=>window.DamageAuthority?.hit?.(a,Math.max(1,(window.ResourceSystem?.getEffectiveMax?.(a,'health')||100)*.01),a.x,a.y,0,{tag:'life-water',environmentalImpact:true,ignoreDodge:true,noStagger:true,friendlyFire:true,afflictionBonuses:{}}),
    });
  }
  function ensureArea(){
    const a=getArea(),s=getScene();
    if(a!==area||s!==scene){clear();area=a;scene=s;}
  }
  // Puzzle composers register the physical receiving opening and their existing progress authority.
  function registerReceptacle(receiver){
    if(!receiver?.root||typeof receiver.accept!=='function')return ()=>{};
    receivers.add(receiver);return ()=>receivers.delete(receiver);
  }
  function visibleInScene(root){
    for(let node=root;node;node=node.parent){if(node.visible===false)return false;if(node===scene)return true;}
    return false;
  }
  function targetCandidates(includeSources){
    const result=[];
    const registered=window.FurniturePuzzleRuntime?.liquidReceivers?.(area)||[];
    for(const receiver of [...receivers,...registered]){
      if(receiver.area!==area||!visibleInScene(receiver.root)||receiver.available?.()===false)continue;
      result.push({root:receiver.root,receiver});
    }
    // Only on a release, never in HUD refresh or idle frames. Use the authored liquid surface, not the whole tree/basin.
    if(includeSources)scene?.traverse?.(root=>{
      if(root.userData?.lifeTotemAuthoritativeLiquidMaterial&&visibleInScene(root))result.push({root,liquid:'lifeWater'});
    });
    return result;
  }
  function trace(origin,direction,speed,candidates){
    const THREE=window.THREE;
    const points=[{x:origin.x,y:origin.y,z:origin.z}]; // Physical trajectory used for both droplets and first-hit resolution.
    const from=new THREE.Vector3(origin.x,origin.y,origin.z),to=new THREE.Vector3(),delta=new THREE.Vector3();
    const raycaster=new THREE.Raycaster();
    let vy=direction.y*speed;
    const vx=direction.x*speed,vz=direction.z*speed;
    for(let i=0;i<MAX_STEPS;i++){
      to.set(from.x+vx*STEP,from.y+vy*STEP-.5*GRAVITY*STEP*STEP,from.z+vz*STEP);
      vy-=GRAVITY*STEP;
      const ground=window.RangedWeapons?.traceLiquidSegment?.(from,to);
      let fraction=ground?.t??Infinity,hit=ground?{kind:ground.kind,y:ground.y}:null;
      delta.copy(to).sub(from);const distance=delta.length();
      if(distance>1e-7&&candidates.length){
        raycaster.set(from,delta.multiplyScalar(1/distance));raycaster.near=0;raycaster.far=distance;
        for(const candidate of candidates){
          const intersection=raycaster.intersectObject(candidate.root,true)[0];
          const t=intersection?intersection.distance/distance:Infinity;
          // The lip of a vessel and its opening can be nearly coplanar; do not accept a receiver behind a wall.
          if(t<=fraction+1e-5&&t<=1){fraction=t;hit={kind:candidate.receiver?'receptacle':'source',...candidate};}
        }
      }
      if(hit){
        from.lerp(to,Math.max(0,Math.min(1,fraction)));
        points.push({x:from.x,y:from.y,z:from.z});
        const tile=(hit.kind==='ground'||hit.kind==='floor')&&Number.isFinite(hit.y)?{area,x:Math.floor(from.x),z:Math.floor(from.z),y:hit.y}:null;
        return {points,duration:(i+Math.max(.05,Math.min(1,fraction)))*STEP,tile,receiver:hit.receiver,liquid:hit.liquid||(tile&&deps.isWaterTile?.(tile)?'water':null),kind:hit.kind};
      }
      from.copy(to);points.push({x:from.x,y:from.y,z:from.z});
    }
    return {points,duration:MAX_STEPS*STEP,tile:null,kind:'miss'};
  }
  function makeFlight(ticket,paths){
    const THREE=window.THREE;
    const count=paths.length*5; // Five small motes per stream, one GPU draw per action.
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));
    const material=new THREE.PointsMaterial({color:ticket.liquid==='lifeWater'?0x8affb7:0x89c9ff,size:.075,transparent:true,opacity:.85,depthWrite:false});
    const points=new THREE.Points(geometry,material);points.name='adventuring_jug_droplets';points.frustumCulled=false;
    scene.add(points);
    const f={ticket,paths,points,age:0,duration:Math.max(...paths.map(p=>p.duration))};
    flights.push(f);animate(f);return f;
  }
  function animate(f){
    const attr=f.points.geometry.attributes.position;let index=0;
    for(const path of f.paths)for(let n=0;n<5;n++){
      const age=f.age-n*.025;
      if(age<0||age>path.duration){attr.setXYZ(index++,0,-10000,0);continue;}
      const frame=Math.min(path.points.length-1,age/STEP),i=Math.floor(frame),a=path.points[i],b=path.points[Math.min(i+1,path.points.length-1)],t=frame-i;
      attr.setXYZ(index++,a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);
    }
    attr.needsUpdate=true;
  }
  function finish(f){
    const primary=f.paths[0];
    const impact={area:f.ticket.area,tile:primary.tile,tiles:f.paths.map(p=>p.tile).filter(Boolean),receptacle:f.ticket.action!=='splash'?primary.receiver:null};
    const result=rules.resolveImpact(f.ticket,impact);lastTrace={action:f.ticket.action,kind:primary.kind,point:primary.points.at(-1),...result};
  }
  function use(action){
    if(!rules||!held()||!ACTIONS.includes(action))return false;
    ensureArea();
    if(flights.length>=MAX_FLIGHTS)return false;
    const actor=local(),origin=deps.getMouth?.(),direction=deps.getAim?.(origin);
    if(!actor||!scene||!finite(origin)||!finite(direction)||!window.RangedWeapons?.traceLiquidSegment)return false;
    const state=rules.getState(actor), candidates=action==='jug_splash'?[]:targetCandidates(action==='jug_pour');
    const primary=action==='jug_splash'?null:trace(origin,direction,3,candidates);
    // Action 1 doubles as fill when the first hit is a liquid source in reach; no charge is spent.
    if(action==='jug_pour'&&primary?.liquid){
      const p=primary.points.at(-1);
      if(Math.hypot(p.x-origin.x,p.y-origin.y,p.z-origin.z)<=2.7){
        if(rules.fill(actor,primary.liquid)){
          deps.toast?.(primary.liquid==='lifeWater'?'Filled with Life Water (6/6).':'Filled with Water (12/12).',true);return true;
        }
        deps.toast?.(state.liquid===primary.liquid?'The jug is already full.':'Empty the jug before changing liquids.',false);
        return false; // A failed refill never releases liquid accidentally.
      }
    }
    if(!state.units){deps.toast?.('Aim at water or a Life Totem basin to fill the jug.',false);return false;}
    let paths;
    if(action==='jug_pour'||action==='jug_empty'&&primary?.receiver)paths=[primary];
    else{
      const ring=action==='jug_empty',angle=Math.atan2(direction.z,direction.x),count=ring?12:9;
      paths=[];
      for(let i=0;i<count;i++){
        const yaw=angle+(ring?i*Math.PI*2/count:(i/(count-1)-.5)*Math.PI/2);
        // An outer ring or a forward fan, never a perfect continuous damaging disc.
        const speed=ring?3.4:(i%2?2.5:4);
        paths.push(trace(origin,{x:Math.cos(yaw)*.96,y:.28,z:Math.sin(yaw)*.96},speed,[]));
      }
    }
    const ticket=rules.beginAction(actor,area,action.slice(4));
    if(!ticket)return false;
    makeFlight(ticket,paths);return true;
  }
  function buttons(){
    const s=rules?.getState(local())||{units:0},name=s.liquid==='lifeWater'?'Life Water':'Water';
    return [
      {action:ACTIONS[0],icon:'💧',label:s.units?'Pour / Fill ('+s.units+' '+name+')':'Fill Jug',inputAction:'action1',style:'primary',allowed:true},
      {action:ACTIONS[1],icon:'💦',label:'Splash',inputAction:'action2',style:'secondary',allowed:s.units>0},
      {action:ACTIONS[2],icon:'🏺',label:'Empty ('+s.units+')',inputAction:'action3',style:'secondary',allowed:s.units>0},
    ];
  }
  function beginDodge(actor){
    ensureArea();
    if(!rules?.beginDodge(actor,area,!held()))return false;
    window.KnockbackCollisionImpact?.extinguishInWater?.(actor); // Belt water also clears existing Burning and Kindling at roll start.
    return true; // Duplicate start notifications cannot spend another unit.
  }
  function dodgeStep(actor,x0,z0,x1,z1){
    if(!rules?.dodgeProtected(actor,area))return;
    const tile=deps.tileSize,steps=Math.max(1,Math.ceil(Math.hypot(x1-x0,z1-z0)/(tile*.2))),cells=[];
    for(let i=0;i<=steps;i++){
      const x=(x0+(x1-x0)*i/steps)/tile,z=(z0+(z1-z0)*i/steps)/tile;
      const y=deps.dodgeSupportY?.(actor,x,z);
      if(Number.isFinite(y))cells.push({area,x,z,y});
    }
    rules.dodgeTiles(actor,area,cells);
  }
  function update(dt){
    if(!rules)return;
    ensureArea();
    const elapsed=Number.isFinite(dt)?Math.max(0,dt):0;
    simulationMs+=elapsed*1000;
    const actor=local();
    if(!actor?.dodging||actor.health<=0||actor._downed||actor.prone)rules.endDodge(actor);
    for(let i=flights.length-1;i>=0;i--){
      const f=flights[i];f.age+=elapsed;
      if(!f.resolved&&f.age>=f.duration){finish(f);f.resolved=true;} // Apply liquid as soon as the first-impact trajectory arrives, not after its visual tail.
      if(f.age>=f.duration+.12){disposeFlight(f);flights.splice(i,1);}
      else animate(f);
    }
    if(elapsed>0)rules.update();
  }
  function escapeTarget(actor){
    if(!rules?.hasArea(area)||!isUndead(actor)||deps.actorArea?.(actor)!==area)return null; // Idle undead do no surface sampling.
    const t=deps.actorTile(actor,area);
    if(!t||!rules.isConsecrated(t))return null;
    const tile=deps.tileSize;
    // Find the nearest reachable dry tile; deterministic tie-breaking, no searches when not consecrated.
    for(let radius=1;radius<=3;radius++)for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
      const x=Math.floor(t.x)+dx+.5,z=Math.floor(t.z)+dz+.5;
      if(rules.isConsecrated({area,x,z,y:t.y})||!deps.canEscape?.(actor,x*tile,z*tile,t.y))continue;
      return {x:x*tile,y:z*tile};
    }
    return null;
  }
  window.AdventuringJug=Object.freeze({
    init,held,buttons,use,registerReceptacle,beginDodge,dodgeStep,update,escapeTarget,isUndead,
    onBelt:()=>!held()&&!!rules?.hasLiquid(local()),
    restore:(actor,state)=>{clear();return rules?.restore(actor,state);},
    isConsecrated:t=>rules?.isConsecrated(t)||false,
    dodgeProtected:(actor,a)=>rules?.dodgeProtected(actor,a)||false,
    debug:()=>({...rules?.debug(local()),held:held(),flights:flights.length,lastTrace}),
  });
})();
