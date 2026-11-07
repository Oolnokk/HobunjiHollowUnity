// Wild Pingdort flocks and the trained companion's distinct bomber attack.
// Runs in the existing WildlifeSpawn and Combat.animalAttacks clocks, never a second RAF.
(() => {
  'use strict';
  if(window.PingdortFlocks)return;
  const KIND='pingdort'; // Shared creature key from PingdortRegistration.
  const FERTILE_EGG='fertilePingdortEgg'; // Canonical hatchable inventory item.
  const MAX_FLOCKS=3, FLOCK_SIZE=3, NEST_EGGS=3; // Each occupied nest shelters precisely three hunters and a fertile clutch.
  const NEST_NEAR_PLAYER_TILES=17, HUNT_DISTANCE=13, FLEE_DISTANCE=7; // Bounded territory and predator-sense scan.
  const BOULDER_KIND='pingdortBoulder'; // Physical burden registered with the existing Shattercasks factory.
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
  const unit=()=>Number(deps?.TILE)||64;
  const tilePos=a=>({x:(Number(a?.x)||0)/unit(),z:(Number(a?.y)||0)/unit()}); // Game actor X/Y pixels to THREE X/Z tiles.
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  const hash=str=>{let h=2166136261;for(const ch of String(str))h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return h}; // Stable region, nest and bird identities.
  const sessions=new Map(); // Per-active-zone flock/nest objects, invalidated by scene replacement or area transition.
  const pets=new WeakMap(); // Companion ongoing special is owned by Combat; WeakMap provides non-rendering debug state.
  const debug={flocks:0,spawned:0,dives:0,hits:0,flees:0,nestsHarvested:0,eggsCollected:0,
    bombingRuns:0,bouldersDropped:0,lowCeilingDives:0,lastError:null}; // Console-free finite counters for mobile.
  let deps=null; // WildlifeSpawn's factory, hostile/companion sets and current map.
  let registeredBomb=false,registeredAttack=false,serial=0; // Idempotent combat/burden registration and unique burden ids.

  function activeArea(){return String(deps?.getCurrentArea?.()||'')}
  function habitat(area){return window.PingdortRegistration?.ZONES?.includes(area)===true}
  function currentScene(area){
    const zs=deps?.zoneScenes||deps?._zoneScenes;
    return zs?.get?.(area)?.scene||zs?.[area]?.scene||deps?.getActiveScene?.()||window.GridTileAccessors?.getActiveScene?.();
  }
  function groundAt(x,z){
    const combat=window.Combat?.deps;
    const y=Number(combat?.getGroundYAtWorld?.(x,z)??combat?.getGroundY?.(x*unit(),z*unit()));
    return Number.isFinite(y)?y:0;
  }
  function alive(actor,area){
    return !!actor && actor.health>0 && !actor.prone && !actor._denHidden
      && actor.areaId===area && deps?.hostileObjects?.has?.(actor);
  }
  function nearestDrenkirra(area,at,max=HUNT_DISTANCE){
    let prey=null,best=max; // Scans only the preexisting hostile roster once per hunting decision.
    for(const c of deps?.hostileObjects||[]){
      if(!alive(c,area)||c.isCompanion||!String(c.creatureKey||'').startsWith('drenkirra'))continue;
      const width=Number(c.def?.modelWidth)||1;
      if(width>1.05)continue; // Specifically small prey, including ordinary Drenkirra, never grown medium/large targets.
      const size=window.CreatureGenetics?.creatureSizeClass?.(c.creatureKey,c.genotype)||c.def?.defaultSizeClass;
      if(size==='large'||size==='medium'&&width>.9)continue;
      const d=dist(tilePos(c),at);
      if(d<best){best=d;prey=c;}
    }
    return prey;
  }
  function predatorNear(area,at){
    let result=null,best=FLEE_DISTANCE;
    for(const other of deps?.hostileObjects||[]){
      if(!alive(other,area)||other.creatureKey===KIND||other.isCompanion)continue;
      const size=window.CreatureGenetics?.creatureSizeClass?.(other.creatureKey,other.genotype)||other.def?.defaultSizeClass;
      const width=Number(other.def?.modelWidth)||0;
      if(other.def?.diet!=='carnivore' || size==='small'&&width<1.1)continue;
      const d=dist(at,tilePos(other));if(d<best){result=other;best=d;}
    }
    return result; // Medium/large predators frighten the flock; nonpredatory medium/large animals do not.
  }
  function flight(actor,state,to,phase,speed=6.5){
    const from={...tilePos(actor),y:Number(actor.branchSurfaceY)||state.home.y};
    const line=window.PerchSupport?.line?.(state.id+':flight:'+state.serial++,
      {x:from.x*unit(),y:from.z*unit(),worldY:from.y},
      {x:to.x*unit(),y:to.z*unit(),worldY:to.y});
    if(!line||!window.PerchSupport.attach(actor,line,0))return false;
    const distance=Math.hypot(to.x-from.x,to.z-from.z,to.y-from.y);
    state.leg={from,to,elapsed:0,duration:Math.max(.28,distance/speed)};
    state.phase=phase;state.struck=false;actor.pingdortFlightPose='flap';
    actor.pingdortDivePitchRad=Math.atan2(to.y-from.y,Math.hypot(to.x-from.x,to.z-from.z))*.7;
    return true;
  }
  function hitTarget(actor,state,target,from,to){
    if(state.struck || !target||target.health<=0)return;
    const hitbox=window.RangedWeapons?.actorHitbox?.(target);
    const p=tilePos(target),base=groundAt(p.x,p.z);
    const box=hitbox?.box?.min && hitbox?.box?.max
      ?{min:{x:hitbox.box.min.x,y:hitbox.box.min.y,z:hitbox.box.min.z},
        max:{x:hitbox.box.max.x,y:hitbox.box.max.y,z:hitbox.box.max.z}}
      :{min:{x:p.x-.42,y:base,z:p.z-.42},max:{x:p.x+.42,y:base+1.1,z:p.z+.42}};
    const swept=window.TzatzulFlightRuntime?.sweptBodyHit; // Shared 3D body-only, frame-rate-independent dive collider.
    if(swept?.(from,to,{x:.22,y:.28,z:.22},box)===null)return;
    state.struck=true;debug.hits++;
    const amount=Math.max(2,Number(actor.def?.attackDamage)||6);
    const damage=window.Combat?.deps?.damageCreature;
    if(typeof damage==='function')damage(target,amount,actor.x,actor.y,35,{attacker:actor,tag:'sharp',aerialSwoop:true,impactCollider:'body'});
    else window.WildlifeSpawn?.applyWildlifeSkirmishDamage?.(actor,target,amount); // Existing ecology fallback for stripped-down sessions.
  }
  function advance(actor,state,dt,target=null){
    const leg=state.leg;
    if(!leg)return false;
    const start=tilePos(actor),before={x:start.x,z:start.z,y:(Number(actor.branchSurfaceY)||0)+.3};
    leg.elapsed=Math.min(leg.duration,leg.elapsed+dt);actor.branchT=leg.elapsed/leg.duration;
    if(!window.PerchSupport?.constrain?.(actor)){state.leg=null;return false;}
    actor.pingdortFlightPose=actor.branchT<.16||actor.branchT>.86?'flap':'glide';
    if(target && state.phase==='dive'){
      const end=tilePos(actor);
      hitTarget(actor,state,target,{x:before.x,y:before.y,z:before.z},
        {x:end.x,y:(Number(actor.branchSurfaceY)||0)+.3,z:end.z});
    }
    if(leg.elapsed<leg.duration)return false;
    state.leg=null;return true;
  }
  function cleanupSession(session){
    if(!session||session.disposed)return;
    session.disposed=true;
    for(const state of session.birds){
      const a=state.actor;window.TzatzulLiveVisuals?.release?.(a,'flock unloaded');
      window.PerchSupport?.forget?.(a);a.onBranch=null;
      deps?.hostileObjects?.delete?.(a);
      a.avatarRef?.group?.parent?.remove?.(a.avatarRef.group);
      a.groundShadow?.parent?.remove?.(a.groundShadow);
      a.avatarRef?.dispose?.();
    }
    for(const nest of session.nests){
      if(nest.worldKey && deps?.worldObjects?.get?.(nest.worldKey)===nest.interaction)
        deps.worldObjects.delete(nest.worldKey);
      nest.group?.parent?.remove?.(nest.group);
      nest.group?.traverse?.(node=>node.geometry?.dispose?.());
    }
    for(const material of session.materials)material.dispose?.();
    if(sessions.get(session.area)===session)sessions.delete(session.area);
  }
  function saveHarvestKey(session,nest){
    // A nest is collectable once per in-game day per world, including across re-entry/save.
    const day=Number(deps?.calendar?.day)||1,world=window.__hobunjiPlayerProfile?.worldId||'world';
    return 'pingdort:nest:'+world+':'+session.area+':'+day+':'+nest.id;
  }
  function collectNest(id){
    const area=activeArea(),session=sessions.get(area),nest=session?.nests.find(n=>n.id===id);
    if(!nest||nest.harvested)return {ok:false,message:'This Pingdort nest is empty.'};
    const player=tilePos(deps?.player);
    if(dist(player,nest)>2.5)return {ok:false,message:'Move closer to the nest.'};
    const inventory=deps?.inventory;if(!inventory)return {ok:false,message:'Inventory unavailable.'};
    const available=Math.max(0,(window.InventoryStacks?.MAX_TOTAL??99)-(Number(inventory[FERTILE_EGG])||0));
    if(!available)return {ok:false,message:'No room for fertile Pingdort eggs.'};
    const count=Math.min(available,NEST_EGGS);
    inventory[FERTILE_EGG]=(Number(inventory[FERTILE_EGG])||0)+count;
    nest.harvested=true;
    try{localStorage.setItem(saveHarvestKey(session,nest),'1')}catch(_){} // Tolerates privacy mode; live session still prevents repeats.
    for(let i=0;i<count;i++){
      const genotype=window.CreatureGenetics?.makeDefaultGenotype?.(KIND);
      if(genotype)window.FarmAnimals?.queueItemGenotype?.(FERTILE_EGG,genotype); // Persistence adapter stores lineage beside the saved bag stack.
    }
    nest.eggGroup.visible=false;
    debug.nestsHarvested++;debug.eggsCollected+=count;
    deps.saveMemberWorldData?.();deps.refreshItemScroll?.();deps.refreshActionBar?.();
    return {ok:true,message:'🥚 Found '+count+' fertile Pingdort egg'+(count===1?'':'s')+'!'};
  }
  function nestVisual(session,x,z,index){
    const THREE=window.THREE,group=new THREE.Group(); // Tiny low-poly twig nest; no walkable/perch surface added to collision.
    const y=groundAt(x,z)+.12;
    group.name='pingdort-flock-nest';group.position.set(x,y,z);
    const twig=new THREE.MeshBasicMaterial({color:0x584837});
    const shell=new THREE.MeshBasicMaterial({color:0xa8a487});
    session.materials.add(twig);session.materials.add(shell);
    for(let i=0;i<8;i++){
      const segment=new THREE.Mesh(new THREE.BoxGeometry(.66,.045,.12),twig);
      const angle=i*Math.PI/4;segment.position.set(Math.cos(angle)*.24,.04,Math.sin(angle)*.24);
      segment.rotation.y=angle;group.add(segment);
    }
    const eggGroup=new THREE.Group();eggGroup.name='pingdort-egg-clutch';
    for(let i=0;i<NEST_EGGS;i++){
      const egg=new THREE.Mesh(new THREE.SphereGeometry(.11,8,8),shell);
      egg.scale.y=1.3;egg.position.set((i-1)*.2,.16,.05);eggGroup.add(egg);
    }
    group.add(eggGroup);session.scene.add(group);
    const nest={id:session.area+':'+index,x,z,group,eggGroup,harvested:false,worldKey:null,interaction:null};
    try{nest.harvested=localStorage.getItem(saveHarvestKey(session,nest))==='1'}catch(_){}
    eggGroup.visible=!nest.harvested;
    // Ordinary world object buttons mirror berries/reagents; no special egg-inventory subsystem.
    const interaction={id:'pingdort_nest_'+nest.id,type:'pingdort_nest',col:Math.floor(x),row:Math.floor(z),
      mesh:group,label:'🥚 Pingdort Nest',getButtons:()=>nest.harvested?[]:[{
        icon:'🥚',label:'Take fertile Pingdort eggs',action:'obj_take_pingdort_eggs',style:'primary',allowed:true,
      }],onAction:action=>action==='obj_take_pingdort_eggs'?collectNest(nest.id):{ok:false,message:'Unknown nest action.'}};
    const key=interaction.col+','+interaction.row;
    if(deps?.worldObjects?.has && !deps.worldObjects.has(key)){
      deps.worldObjects.set(key,interaction);nest.worldKey=key;nest.interaction=interaction;
    }
    return nest;
  }
  function spawnBird(session,nest,index){
    const pos={x:nest.x+.4+(index-1)*.35,z:nest.z+.1+(index%2)*.25};
    const actor=deps.makeCreatureEntity?.(KIND,pos.x*unit(),pos.z*unit(),{
      homeX:pos.x*unit(),homeY:pos.z*unit(),state:'idle',wildlifeRole:'predator',streamVisuals:true,
      pingdortFlockId:nest.id,
    });
    if(!actor)return null;
    actor.areaId=session.area;actor.isWildPingdort=true;actor.pingdortFlightPose='perched';
    actor.def=Object.assign(Object.create(actor.def||null),{hostile:false,attacks:[]}); // Wild birds never choose the player/large prey in generic AI.
    const home={x:pos.x,z:pos.z,y:groundAt(pos.x,pos.z)+2.3};
    const perch=window.PerchSupport?.point?.(nest.id+':bird:'+index,actor.x,actor.y,home.y);
    if(!perch||!window.PerchSupport.attach(actor,perch)){actor.avatarRef?.dispose?.();return null;}
    deps.hostileObjects.add(actor);
    const state={id:nest.id+':'+index,actor,home,nest,phase:'rest',cooldown:1.5+index*.38,
      serial:0,leg:null,target:null,struck:false}; // Group hunters share a nest, but own staggered attack flights.
    session.birds.add(state);debug.spawned++;
    return state;
  }
  function validSite(session,x,z){
    const col=Math.floor(x),row=Math.floor(z),zone=deps?.zoneScenes?.get?.(session.area)||deps?._zoneScenes?.get?.(session.area);
    const tile=zone?.grid?.[row]?.[col];
    if(!tile)return !!session.scene; // Dev fixtures without a zone grid still exercise the flock runtime.
    const type=String(tile.type||'').toLowerCase();
    return !['water','river','stream','lake','pond','void','rock','cliff','lava'].includes(type);
  }
  function ensureZone(area=activeArea()){
    if(!habitat(area)||!deps?.makeCreatureEntity||!window.PerchSupport||!window.THREE)return 0;
    const scene=currentScene(area);
    if(!scene)return 0;
    const existing=sessions.get(area);
    if(existing && existing.scene===scene)return existing.nests.length;
    if(existing)cleanupSession(existing);
    const session={area,scene,nests:[],birds:new Set(),materials:new Set(),disposed:false}; // A streamed scene owns its twig meshes and encounter actors.
    sessions.set(area,session);
    const nearby=[...(deps.hostileObjects||[])].filter(c=>
      c.areaId===area&&c.health>0&&String(c.creatureKey||'').startsWith('drenkirra'));
    const player=tilePos(deps.player);
    const origins=nearby.length?nearby.map(tilePos):[player];
    let attempts=0;
    for(let i=0;i<MAX_FLOCKS&&attempts<32;attempts++){
      const base=origins[hash(area+':'+i)%origins.length];
      const angle=(hash(area+':nest-angle:'+i)%628)/100;
      const radius=5+(hash(area+':nest-radius:'+i)%5);
      const x=Math.floor(base.x+Math.cos(angle)*radius)+.5;
      const z=Math.floor(base.z+Math.sin(angle)*radius)+.5;
      if(!validSite(session,x,z)||session.nests.some(n=>dist(n,{x,z})<9))continue;
      // A far-away zone has no active virtual camera; defer nests beyond the current territory.
      if(dist(player,{x,z})>NEST_NEAR_PLAYER_TILES+9)continue;
      const nest=nestVisual(session,x,z,i);
      session.nests.push(nest);
      for(let j=0;j<FLOCK_SIZE;j++)spawnBird(session,nest,j);
      debug.flocks++;
    }
    return session.nests.length;
  }
  function updateWild(dt){
    const area=activeArea(),session=sessions.get(area);
    if(!session||session.disposed)return;
    for(const state of session.birds){
      const a=state.actor;
      if(!alive(a,area))continue;
      const at=tilePos(a),predator=predatorNear(area,at);
      if(predator&&state.phase!=='flee'){
        const away=tilePos(predator),length=Math.max(.001,dist(at,away));
        const to={x:at.x+(at.x-away.x)/length*5,z:at.z+(at.z-away.z)/length*5,
          y:Math.max(state.home.y,Number(a.branchSurfaceY)||0)+2};
        if(flight(a,state,to,'flee',8)){debug.flees++;state.target=null;}
      }
      if(state.leg){
        const done=advance(a,state,dt,state.phase==='dive'?state.target:null);
        if(!done)continue;
        if(state.phase==='dive'||state.phase==='flee'){
          flight(a,state,state.home,'return',7);continue;
        }
        state.phase='rest';state.cooldown=2.5+hash(state.id+debug.dives)%4;
        a.pingdortFlightPose='perched';a.pingdortDivePitchRad=0;
        continue;
      }
      if(state.phase!=='rest')continue;
      state.cooldown-=dt;if(state.cooldown>0)continue;
      const prey=nearestDrenkirra(area,state.home);
      if(!prey){state.cooldown=2.5;continue;}
      const p=tilePos(prey);
      state.target=prey;
      if(flight(a,state,{x:p.x,z:p.z,y:groundAt(p.x,p.z)+.4},'dive',6.5)){debug.dives++;}
    }
  }
  function boulderImpact(burden,cause){
    const p=burden?.group?.getWorldPosition?.(new window.THREE.Vector3());
    if(!p)return false;
    const now=performance.now();if(now-(burden.lastPingdortImpactMs||0)<700)return false;
    burden.lastPingdortImpactMs=now;
    const combat=window.Combat?.deps,t=Number(combat?.TILE)||64;
    for(const enemy of combat?.hostileObjects||[]){
      if(enemy.health<=0||enemy.areaId!==burden.mapId)continue;
      if(Math.hypot(enemy.x/t-p.x,enemy.y/t-p.z)>1.35)continue;
      combat.damageCreature?.(enemy,18,p.x*t,p.z*t,150,{tag:'blunt',source:'pingdort-boulder'});
    }
    return false; // The landed boulder remains a physical, pickable and throwable burden.
  }
  function ensureBoulderFactory(){
    if(registeredBomb||!window.Shattercasks?.registerBurdenFactory||!window.THREE)return false;
    const THREE=window.THREE;
    window.Shattercasks.registerBurdenFactory(BOULDER_KIND,()=>{
      const root=new THREE.Group(); // Inexplicably retrieved stone is a separate burden, not part of the animal's sprite.
      const stone=new THREE.Mesh(new THREE.IcosahedronGeometry(.36,1),
        window.ProceduralFurniture?.makePartMaterial?.({materialTexture:'cliff_stone.png',materialLighting:'unlit',materialFillMode:'never',color:'#736b60'})
          || new THREE.MeshBasicMaterial({color:0x736b60}));
      stone.name='pingdort_boulder';root.add(stone);
      return {group:root,displayName:'Boulder',onImpact:boulderImpact};
    });
    registeredBomb=true;return true;
  }
  function lowCeiling(actor){
    const area=actor?.areaId||activeArea(),THREE=window.THREE,scene=currentScene(area);
    if(!area.startsWith('map_i_')||!scene)return false; // All ordinary outdoor zones are open enough to fetch rocks.
    if(THREE?.Raycaster&&THREE?.Vector3){
      const p=tilePos(actor),from=new THREE.Vector3(p.x,groundAt(p.x,p.z)+.8,p.z);
      const ray=new THREE.Raycaster(from,new THREE.Vector3(0,1,0),.05,4);
      const ceilings=[]; // Only explicitly named overhead structure; ignore tree canopies and generic walls.
      scene.traverse?.(node=>{if(node.isMesh && /ceiling|roof|overhang|cavern-vault/i.test(node.name||''))ceilings.push(node);});
      if(ceilings.length)return ray.intersectObjects(ceilings,false).length>0;
    }
    return !window.DevRandomRuin?.hasShaftHub?.(); // Conservative interior fallback; a full-height shaft stays valid for bombing.
  }
  function bodySweep(actor,target,from,to){
    const p=tilePos(target),ground=groundAt(p.x,p.z);
    const box={min:{x:p.x-.42,y:ground,z:p.z-.42},max:{x:p.x+.42,y:ground+1.3,z:p.z+.42}};
    return window.TzatzulFlightRuntime?.sweptBodyHit?.(from,to,{x:.24,y:.3,z:.24},box)!==null;
  }
  function restoreCompanion(actor,state){
    if(state.boulder && state.phase!=='dropped'){
      window.Shattercasks?.discardBurden?.(state.boulder);state.boulder=null;
    }
    window.PerchSupport?.forget?.(actor);
    if(actor.onBranch?.perchSupport){actor.onBranch=null;actor.branchT=0;actor.branchSurfaceY=0;}
    if(state.originalGroupVisible!=null && actor.avatarRef?.group)actor.avatarRef.group.visible=state.originalGroupVisible;
    actor.pingdortFlightPose='perched';actor.pingdortDivePitchRad=0;
    pets.delete(actor);
  }
  function companionStart(actor,state,ctx){
    const target=ctx?.target,area=actor?.areaId||activeArea();
    state.phase='depart';state.target=target;state.area=area;state.t=0;state.serial=0;
    state.id='pingdort:companion:'+String(actor.id||'pet');
    state.home={...tilePos(actor),y:groundAt(actor.x/unit(),actor.y/unit())+.5}; // Ground recovery target after completing a bomber run.
    state.originalGroupVisible=actor.avatarRef?.group?.visible;
    state.boulder=null;state.leg=null;state.struck=false;state.cancelled=false;
    pets.set(actor,state);
    if(lowCeiling(actor)){state.phase='dive';state.low=true;debug.lowCeilingDives++;
      const p=tilePos(target||actor);
      flight(actor,state,{...p,y:groundAt(p.x,p.z)+.5},'dive',7.2);
    }else{
      const p=tilePos(actor),player=tilePos(deps?.player);
      const dx=p.x-player.x,dz=p.z-player.z,length=Math.max(.01,Math.hypot(dx,dz));
      const off={x:p.x+dx/length*12,z:p.z+dz/length*12,y:state.home.y+6};
      flight(actor,state,off,'depart',10); // Moves beyond the camera, rather than summoning a rock in front of the player.
    }
  }
  async function fetchBoulder(actor,state){
    if(state.pendingRock||state.cancelled)return;
    ensureBoulderFactory();
    const scene=currentScene(state.area),p=tilePos(actor),Shatter=window.Shattercasks;
    if(!scene||!Shatter?.createHangingBurden){state.phase='return';return;}
    state.pendingRock=true;
    try{
      const rock=await Shatter.createHangingBurden({
        kind:BOULDER_KIND,id:'pingdort_boulder_'+(++serial),mapId:state.area,scene,
        x:p.x,y:state.home.y+5,z:p.z,hanging:true,
        fallGroundY:({x,z})=>groundAt(x,z)+.36,
      });
      if(!rock)return;
      if(state.cancelled||actor._animalAttack?.state!==state||activeArea()!==state.area){
        Shatter.discardBurden?.(rock);return;
      }
      state.boulder=rock;
    }catch(error){debug.lastError=String(error);}
    finally{state.pendingRock=false;if(!state.cancelled&&state.phase==='fetch')state.phase='return';}
  }
  function companionUpdate(actor,state,dt,combat){
    if(state.cancelled||!(actor.health>0)||activeArea()!==state.area){restoreCompanion(actor,state);return false;}
    const step=clamp(dt,0,.15);
    if(state.phase==='dive'){
      const old=tilePos(actor),oldY=Number(actor.branchSurfaceY)||state.home.y;
      const ended=advance(actor,state,step);
      const now=tilePos(actor),newY=Number(actor.branchSurfaceY)||state.home.y;
      if(!state.struck&&state.target?.health>0&&bodySweep(actor,state.target,
        {x:old.x,y:oldY+.3,z:old.z},{x:now.x,y:newY+.3,z:now.z})){
        state.struck=true;
        combat?.damageCreature?.(state.target,actor.def?.attackDamage||6,actor.x,actor.y,40,
          {tag:'sharp',attacker:actor,aerialSwoop:true,impactCollider:'body'});
      }
      if(ended)flight(actor,state,state.home,'land',7);
      return true;
    }
    if(state.phase==='depart'){
      if(advance(actor,state,step)){
        state.phase='fetch';state.t=0;
        if(actor.avatarRef?.group)actor.avatarRef.group.visible=false; // Invisible off-camera retrieval; no invented quarry prop.
        fetchBoulder(actor,state);
      }
      return true;
    }
    if(state.phase==='fetch')return true;
    if(state.phase==='return'){
      if(!state.leg){
        const p=tilePos(state.target?.health>0?state.target:deps?.player),ground=groundAt(p.x,p.z);
        flight(actor,state,{x:p.x+1,z:p.z,y:ground+3.6},'return',10);
        if(actor.avatarRef?.group)actor.avatarRef.group.visible=state.originalGroupVisible!==false;
      }
      if(state.boulder?.group && !state.boulder.flying){
        const p=tilePos(actor);
        state.boulder.group.position.set(p.x,Number(actor.branchSurfaceY)-.32,p.z); // World-space carried payload tracks the real bird until release.
      }
      if(advance(actor,state,step)){
        if(state.boulder){
          if(window.Shattercasks?.releaseBurdenDownward?.(state.boulder,'pingdort-bomber'))debug.bouldersDropped++;
          else window.Shattercasks?.discardBurden?.(state.boulder);
          state.boulder=null;
        }
        debug.bombingRuns++;
        const p=tilePos(deps?.player),to={x:p.x+1.1,z:p.z+.8,y:groundAt(p.x,p.z)+.5};
        flight(actor,state,to,'land',10);
      }
      return true;
    }
    if(state.phase==='land'){
      if(advance(actor,state,step)){restoreCompanion(actor,{...state,phase:'dropped'});return false;}
      return true;
    }
    restoreCompanion(actor,state);return false;
  }
  function registerCompanionAttack(){
    const attacks=window.Combat?.animalAttacks;if(registeredAttack||!attacks?.register)return false;
    attacks.register('pingdortBoulderBomb',{label:'Boulder Drop',ownsApproach:true,
      start:companionStart,update:companionUpdate,
      cancel:(actor,state)=>{state.cancelled=true;restoreCompanion(actor,state);},
      isWindingUp:state=>['depart','fetch'].includes(state.phase),
      isStriking:state=>['return','dive'].includes(state.phase),
    });
    registeredAttack=true;return true;
  }
  function init(injected={}){
    for(const session of [...sessions.values()])cleanupSession(session);
    deps=injected; // Same shared wildlife and combat roster; never install a global interval.
    ensureBoulderFactory();registerCompanionAttack();return true;
  }
  function update(dt=0){
    if(!deps)return;
    if(!registeredAttack)registerCompanionAttack();
    updateWild(clamp(dt,0,.1));
  }
  const debugSnapshot=()=>({...debug,habitats:[...sessions].map(([area,s])=>({
    area,nests:s.nests.map(n=>({id:n.id,x:n.x,z:n.z,harvested:n.harvested})),
    liveBirds:[...s.birds].filter(v=>v.actor.health>0).length,
  }))});
  window.PingdortFlocks=Object.freeze({KIND,BOULDER_KIND,init,ensureZone,update,collectNest,lowCeiling,debugSnapshot,
    getNest: id=>[...sessions.values()].flatMap(s=>s.nests).find(n=>n.id===id)||null});
})();
