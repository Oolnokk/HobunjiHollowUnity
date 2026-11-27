// Wild Pingdort flocks and size-specific trained flying companion attacks.
// Runs in the existing WildlifeSpawn and Combat.animalAttacks clocks, never a second RAF.
(() => {
  'use strict';
  if(window.PingdortFlocks)return;
  const KIND='pingdort'; // Shared creature key from PingdortRegistration.
  const FERTILE_EGG='fertilePingdortEgg'; // Canonical hatchable inventory item.
  const MAX_FLOCKS=8, FLOCK_SIZE=3, NEST_EGGS=3; // A limited set of permanent minicliff nests, with three hunters per nearby flock.
  const NEST_NEAR_PLAYER_TILES=17, HUNT_DISTANCE=13, FLEE_DISTANCE=7; // Bounded territory and predator-sense scan.
  const BOULDER_KIND='pingdortBoulder'; // Physical burden registered with the existing Shattercasks factory.
  const BOULDER_RADIUS=.36; // Shared visible size, collision radius and landing clearance.
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
  const unit=()=>Number(deps?.TILE)||64;
  const tilePos=a=>({x:(Number(a?.x)||0)/unit(),z:(Number(a?.y)||0)/unit()}); // Game actor X/Y pixels to THREE X/Z tiles.
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  const hash=str=>{let h=2166136261;for(const ch of String(str))h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return h}; // Stable region, nest and bird identities.
  const sessions=new Map(); // Per-active-zone flock/nest objects, invalidated by scene replacement or area transition.
  const pets=new WeakMap(); // Companion ongoing special is owned by Combat; WeakMap provides non-rendering debug state.
  const debug={flocks:0,spawned:0,unloaded:0,flockDeaths:0,missingShelves:0,dives:0,hits:0,flees:0,nestsHarvested:0,eggsCollected:0,
    bombingRuns:0,bouldersDropped:0,boulderImpacts:0,companionDives:0,companionDiveHits:0,lowCeilingDives:0,lastCompanionAttack:null,lastError:null}; // Console-free finite counters for mobile.
  let deps=null; // WildlifeSpawn's factory, hostile/companion sets and current map.
  const FLOCK_UNLOAD_TILES=34; // Wild birds outside this radius retire without wasting off-screen AI and renderer time.
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
    const from={...tilePos(actor),y:Number.isFinite(actor.branchSurfaceY)&&actor.onBranch?actor.branchSurfaceY:state.home.y};
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
    if(!swept || swept(from,to,{x:.22,y:.28,z:.22},box)===null)return; // If the shared swept-body provider isn't loaded, never award automatic contact.
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
  function retireBird(state){
    const a=state.actor;
    window.TzatzulLiveVisuals?.release?.(a,'flock streamed out');
    window.PerchSupport?.forget?.(a);a.onBranch=null;
    deps?.hostileObjects?.delete?.(a);
    a.avatarRef?.group?.parent?.remove?.(a.avatarRef.group);
    a.groundShadow?.parent?.remove?.(a.groundShadow);
    a.avatarRef?.dispose?.();
    debug.unloaded++;
  }
  function cleanupSession(session){
    if(!session||session.disposed)return;
    session.disposed=true;
    for(const state of session.birds){
      if(state.actor.health<=0)rememberBirdDeath(session,state.nest,state.slot);
      retireBird(state);
    }
    session.birds.clear();
    for(const nest of session.nests){
      nest.mesh?.parent?.remove?.(nest.mesh);
      if(nest.fallbackArt)nest.mesh?.traverse?.(node=>node.geometry?.dispose?.());
    }
    for(const material of session.materials)material.dispose?.();
    if(sessions.get(session.area)===session)sessions.delete(session.area);
  }
  function saveHarvestKey(session,nest){
    // A nest is collectable once per in-game day per world, including across re-entry/save.
    const calendar=deps?.calendar||{}; // Harvests reset by full civil date, not just the day number shared by every month.
    const date=[Number(calendar.year)||0,String(calendar.month??'unknown'),Number(calendar.day)||1].join('-');
    const world=window.__hobunjiPlayerProfile?.worldId||'world';
    return 'pingdort:nest:'+world+':'+session.area+':'+date+':'+nest.id;
  }
  function flockLossKey(session,nest){
    return saveHarvestKey(session,nest).replace('pingdort:nest:','pingdort:wildlife:'); // Day-scoped losses persist independently from fertile eggs.
  }
  function readDeadSlots(session,nest){
    try{
      const saved=JSON.parse(localStorage.getItem(flockLossKey(session,nest))||'[]');
      if(Array.isArray(saved))return new Set(saved.filter(x=>Number.isInteger(x)&&x>=0&&x<FLOCK_SIZE));
    }catch(_){} // Damaged/disabled storage must not crash wildlife spawning.
    return new Set();
  }
  function rememberBirdDeath(session,nest,slot){
    if(!nest||!Number.isInteger(slot)||slot<0||slot>=FLOCK_SIZE||nest.deadBirdSlots.has(slot))return;
    nest.deadBirdSlots.add(slot);debug.flockDeaths++;
    try{localStorage.setItem(flockLossKey(session,nest),JSON.stringify([...nest.deadBirdSlots].sort()))}catch(_){}
  }
  function readRemaining(session,nest) {
    let stored=null;
    try{stored=localStorage.getItem(saveHarvestKey(session,nest))}catch(_){} // Private browsers still get live-session clutch state.
    if(stored==='1')return 0; // Migrate older one-click/three-egg harvested nests.
    if(typeof stored==='string'&&stored.startsWith('n:'))return Math.floor(clamp(Number(stored.slice(2)),0,NEST_EGGS));
    return NEST_EGGS;
  }
  function eggCollected(session,nest){
    try{localStorage.setItem(saveHarvestKey(session,nest),'n:'+nest.remaining)}catch(_){}
    debug.eggsCollected++;
    if(nest.remaining===0)debug.nestsHarvested++;
  }
  function collectNest(id){
    // Headless/test adapter only. The player holds the normal nest_take input
    // while aiming at an individual egg through DenNestSystem, not this method.
    const session=sessions.get(activeArea()),nest=session?.nests.find(n=>n.id===id);
    if(!nest||nest.remaining<=0)return {ok:false,message:'This Pingdort nest is empty.'};
    const player=tilePos(deps?.player);
    if(dist(player,tilePos(nest))>1.6)return {ok:false,message:'Move closer to the nest.'};
    const jumpFeet=deps?.player?.physicalFeetY;
    const feetY=typeof jumpFeet==='number'&&Number.isFinite(jumpFeet)?jumpFeet:Number(deps?.playerMesh?.position?.y);
    if(Number.isFinite(feetY)&&Math.abs(feetY-nest.worldY)>1.25)
      return {ok:false,message:'Reach the minicliff shelf first.'};
    const inventory=deps?.inventory;if(!inventory)return {ok:false,message:'Inventory unavailable.'};
    if((Number(inventory[FERTILE_EGG])||0)>=(window.InventoryStacks?.MAX_TOTAL??99))
      return {ok:false,message:'No room for fertile Pingdort eggs.'};
    inventory[FERTILE_EGG]=(Number(inventory[FERTILE_EGG])||0)+1;
    nest.remaining--;eggCollected(session,nest);
    window.FarmAnimals?.queueItemGenotype?.(FERTILE_EGG,nest.genotype);
    deps.saveMemberWorldData?.();deps.refreshItemScroll?.();deps.refreshActionBar?.();
    return {ok:true,message:'🥚 Took a fertile Pingdort egg.'};
  }
  const NEST_CAP_INSET=.2, NEST_ROCK_CLEARANCE=.4; // Keep the actual cup on the cap and away from the parent rock wall.
  const NEST_SUBTILE_OFFSETS=[.125,.375,.625,.875]; // Sample exposed quarter-tile positions when no safely spaced tile centre exists.
  function clearNestTile(shelf){
    if(!shelf||!Array.isArray(shelf.footprint)||!shelf.footprint.length)return null; // Defensive entry check for the read-only wildlife diagnostic seam.
    const solidBase=[...(shelf?.base?.footprint||[]),...(shelf?.base?.boundaryCells||[])]; // Both the parent plateau and painted stone face obstruct the cup.
    const reward=shelf.reward==='herbCluster'&&shelf.herbTile
      ?{x:shelf.herbTile.c+.5,z:shelf.herbTile.r+.5}:shelf;
    const gap=shelf.reward==='oreRock'?1.05:.88; // Preserve access to the authored ore/chest/herb reward.
    const candidateSpots=offsets=>{
      const spots=[]; // Reused cap candidate buffer for this one-time wilderness nest selection, never per frame.
      for(const cell of shelf?.footprint||[])for(const dx of offsets)for(const dz of offsets){
        const p={x:cell.c+dx,z:cell.r+dz}; // Actual sub-tile position shared by the nest, its eggs and guarding flock.
        if(!window.CliffRouteNetwork?.shelfContains?.(shelf,p.x,p.z,-NEST_CAP_INSET)
          ||(shelf.reward&&dist(p,reward)<=gap))continue;
        if(solidBase.some(rock=>{
          const rx=Math.max(rock.c-p.x,0,p.x-(rock.c+1)),rz=Math.max(rock.r-p.z,0,p.z-(rock.r+1));
          return Math.hypot(rx,rz)<NEST_ROCK_CLEARANCE;
        }))continue;
        spots.push(p);
      }
      return spots;
    };
    const centers=candidateSpots([.5]); // Keep stable historic tile-centre sites when their cliff clearance is actually valid.
    const safe=centers.length?centers:candidateSpots(NEST_SUBTILE_OFFSETS); // Recover narrow but reachable ledges before omitting the site.
    const normal=shelf.normal||{x:0,z:0}; // Rank surviving sites toward the exposed front, away from the embedded cliff.
    const front=p=>(p.x-shelf.x)*(Number(normal.x)||0)+(p.z-shelf.z)*(Number(normal.z)||0);
    return safe.sort((a,b)=>front(b)-front(a)||dist(a,reward)-dist(b,reward))[0]||null;
  }
  const nestLineages = new Map(); // World+site -> saved flock genotype; reconnects offspring and parents after streaming or reload.
  function nestFamilyGenotype(session, nestId) {
    const worldId = window.__hobunjiPlayerProfile?.worldId || 'world'; // Existing world key prevents cross-save coat inheritance.
    const key = 'pingdort:family:' + worldId + ':' + session.area + ':' + nestId; // One bloodline for all eggs and the three home-point birds.
    if (nestLineages.has(key)) return nestLineages.get(key);
    let genotype = null;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved?.base?.color && saved?.sizeClass) genotype = saved;
    } catch (_) {} // Storage may be disabled or contain an older malformed genotype.
    if (!genotype) {
      genotype = window.CreatureGenetics?.makeDefaultGenotype?.(KIND) || null;
      if (genotype) try { localStorage.setItem(key, JSON.stringify(genotype)); } catch (_) {}
    }
    nestLineages.set(key, genotype);
    return genotype;
  }
  function nestVisual(session,shelf,index) {
    const THREE=window.THREE,spot=clearNestTile(shelf);
    if(!spot||![spot.x,spot.z,shelf.y].every(Number.isFinite))return null;
    const x=spot.x,z=spot.z,worldY=shelf.y;
    let group=window.DenNestSystem?.createExteriorNestFurniture?.(session.scene,x,worldY,z);
    let fallbackArt=false;
    if(!group){
      group=new THREE.Group();fallbackArt=true; // Stripped test worlds keep a small nest, never a floating opaque egg marker.
      const twig=new THREE.MeshBasicMaterial({color:0x584837});
      session.materials.add(twig);
      for(let i=0;i<8;i++){
        const branch=new THREE.Mesh(new THREE.BoxGeometry(.5,.045,.10),twig);
        const a=i*Math.PI/4;branch.position.set(Math.cos(a)*.2,.035,Math.sin(a)*.2);
        branch.rotation.y=a;group.add(branch);
      }
      group.position.set(x,worldY+.02,z);
      session.scene.add(group);
    }
    group.name='pingdort-minicliff-nest';
    group.userData=group.userData||{};
    group.userData.pingdortNest=true;
    const nest={id:session.area+':'+shelf.id,x,z,worldY,shelfId:shelf.id,
      areaId:session.area,remaining:NEST_EGGS,itemKey:FERTILE_EGG,
      genotype:nestFamilyGenotype(session,session.area+':'+shelf.id), // Same stored bloodline as its guarding flock, including after re-entry.
      col:Math.floor(x),row:Math.floor(z),w:1,h:1,
      exteriorCliffNest:true, // DenNestSystem measures interaction reach from the exact sub-tile cup position.
      mesh:group,group,fallbackArt,flockLoaded:false,deadBirdSlots:new Set()};
    nest.x=x*unit();nest.y=z*unit(); // Native DenNestSystem uses pixel-space nest coordinates like branch nests.
    nest.onEggCollected=()=>eggCollected(session,nest); // Shares the normal hold-to-take and one-item inventory path.
    nest.remaining=readRemaining(session,nest);
    nest.deadBirdSlots=readDeadSlots(session,nest); // One death per flock member per game day, not per scene visit.
    return nest;
  }
  function spawnBird(session,nest,index){
    const at=tilePos(nest); // Actual sub-tile nest coordinates keep the guarding flock out of cliff rock.
    const shelf=session.network?.balconies?.find(s=>s.id===nest.shelfId); // Only checked when the birds initially spawn, not per frame.
    const tangent=shelf?.tangent||{x:1,z:0}; // Spread perched birds sideways along the cap instead of outward into its face.
    const candidate={x:at.x+(index-1)*.16*tangent.x,z:at.z+(index-1)*.16*tangent.z};
    const pos=shelf&&!window.CliffRouteNetwork?.shelfContains?.(shelf,candidate.x,candidate.z,-.02)?at:candidate; // Never perch past a narrow shelf edge.
    const genotype=nest.genotype ? JSON.parse(JSON.stringify(nest.genotype)) : null; // Identical inherited colors and Size; no independent guardian reroll.
    const actor=deps.makeCreatureEntity?.(KIND,pos.x*unit(),pos.z*unit(),{
      genotype,
      homeX:pos.x*unit(),homeY:pos.z*unit(),state:'idle',wildlifeRole:'predator',streamVisuals:true,
      pingdortFlockId:nest.id,
    });
    if(!actor)return null;
    actor.areaId=session.area;actor.isWildPingdort=true;actor.pingdortFlightPose='perched';
    actor.def=Object.assign(Object.create(actor.def||null),{hostile:false,attacks:[]}); // Wild birds never choose the player/large prey in generic AI.
    const home={x:pos.x,z:pos.z,y:nest.worldY}; // The shelf is the actual perch surface; native groundLift determines each bird's foot height, not an extra invisible air gap.
    const perch=window.PerchSupport?.point?.(nest.id+':bird:'+index,actor.x,actor.y,home.y);
    if(!perch||!window.PerchSupport.attach(actor,perch)){actor.avatarRef?.dispose?.();return null;}
    deps.hostileObjects.add(actor);
    const state={id:nest.id+':'+index,slot:index,actor,home,nest,phase:'rest',cooldown:1.5+index*.38,
      serial:0,leg:null,target:null,struck:false}; // Group hunters share a nest, but own staggered attack flights.
    session.birds.add(state);debug.spawned++;
    return state;
  }
  function chooseShelves(network){
    const towers=network?.area==='map_southern_cloud_forest'
      ? window.CloudForestRuntimeV2?.lastKarstReport?.sites||[] : []; // Prefer the newly raised karst shelves without forbidding older natural minicliffs.
    const towerDistance=s=>towers.length?Math.min(...towers.map(t=>Math.hypot(s.x-t.x,s.z-t.z))):Infinity;
    return (network?.balconies||[]).filter(s=>!s.puzzleCavePortal&&s.base?.footprint?.length
      && Number.isFinite(s.y)&&s.y>0&&Array.isArray(s.footprint)&&s.footprint.length
      &&clearNestTile(s))
      .sort((a,b)=>(towerDistance(a)<=9?0:1)-(towerDistance(b)<=9?0:1)
        ||hash(a.id)-hash(b.id))
      .reduce((selected,s)=>{
        if(selected.length<MAX_FLOCKS&&selected.every(other=>dist(other,s)>7))selected.push(s);
        return selected;
      },[]); // Distinct climbing-connected shelves, with new limestone pillars as the first nesting preference.
  }
  function syncNearbyFlocks(session){
    const player=tilePos(deps?.player);
    const canSpawn = !window.TothalBlizzard?.isShelteringFor?.(session.area); // Only creation is storm-gated; distant flocks must continue unloading for performance.
    for(const nest of session.nests){
      const distance=dist(player,tilePos(nest));
      if(canSpawn&&distance<=NEST_NEAR_PLAYER_TILES+9&&!nest.flockLoaded){
        let spawned=0;
        for(let i=0;i<FLOCK_SIZE;i++){
          if(nest.deadBirdSlots.has(i))continue; // Previously killed individuals remain absent after unloading/re-entering.
          if(spawnBird(session,nest,i))spawned++;
        }
        nest.flockLoaded=spawned>0||nest.deadBirdSlots.size===FLOCK_SIZE;
      } else if(distance>FLOCK_UNLOAD_TILES&&nest.flockLoaded){
        for(const state of [...session.birds])if(state.nest===nest){
          session.birds.delete(state);
          if(state.actor.health<=0)rememberBirdDeath(session,nest,state.slot);
          retireBird(state);
        }
        nest.flockLoaded=false;
      }
    }
  }
  function ensureZone(area=activeArea()){
    if(!habitat(area)||!deps?.makeCreatureEntity||!window.PerchSupport||!window.THREE)return 0;
    const scene=currentScene(area),network=window.CliffRouteNetwork?.forArea?.(area);
    if(!scene||!network?.balconies?.length){debug.missingShelves++;return 0;} // Never fall back to birds embedded in terrain.
    const existing=sessions.get(area);
    if(existing&&existing.scene===scene&&existing.network===network){
      const day=String(deps?.calendar?.year??0)+':'+String(deps?.calendar?.month??'unknown')+':'+String(deps?.calendar?.day??1);
      if(existing.harvestDay!==day){
        existing.harvestDay=day;
        for(const nest of existing.nests){
          nest.remaining=readRemaining(existing,nest);
          for(const state of [...existing.birds])if(state.nest===nest){
            existing.birds.delete(state);
            if(state.actor.health>0)retireBird(state); // Live flocks turn over once per civil day, not at every scene reload.
          }
          nest.flockLoaded=false;
          nest.deadBirdSlots=readDeadSlots(existing,nest); // A new civil day creates a new wildlife population.
        }
      }
      syncNearbyFlocks(existing); // Nearby creation is storm-gated inside; distant birds still retire.
      return existing.nests.length;
    }
    if(existing)cleanupSession(existing);
    const session={area,scene,network,nests:[],birds:new Set(),materials:new Set(),disposed:false,
      harvestDay:String(deps?.calendar?.year??0)+':'+String(deps?.calendar?.month??'unknown')+':'+String(deps?.calendar?.day??1),
      flockSyncTimer:0}; // Per-scene minicliff nests; only nearby wild birds enter the canonical roster.
    sessions.set(area,session);
    for(const shelf of chooseShelves(network)){
      const nest=nestVisual(session,shelf,session.nests.length);
      if(!nest)continue;
      session.nests.push(nest);
      debug.flocks++;
    }
    syncNearbyFlocks(session); // Keep nest furniture and distant-bird cleanup; defer only new hunters during storms.
    return session.nests.length;
  }
  function updateWild(dt){
    const area=activeArea();
    for(const old of [...sessions.values()])if(old.area!==area)cleanupSession(old); // Release unloaded flocks and nest visuals without leaking another area's actors.
    const session=sessions.get(area);
    if(!session||session.disposed)return;
    const stormShelter = !!window.TothalBlizzard?.isShelteringFor?.(area); // Wild flocks retreat to their native nests; trained companions stay player-directed.
    session.flockSyncTimer-=dt;
    if(session.flockSyncTimer<=0){session.flockSyncTimer=2;syncNearbyFlocks(session);} // The shared synchronizer can still retire distant birds during storms.
    for(const state of session.birds){
      const a=state.actor;
      if(!alive(a,area)){
        if(a?.health<=0)rememberBirdDeath(session,state.nest,state.slot);
        continue;
      }
      if (stormShelter) {
        if (state.leg) {
          if (state.phase !== 'return') flight(a, state, state.home, 'return', 7); // Abort a hunt and follow the normal flight path home.
          else if (advance(a, state, dt)) { state.phase = 'rest'; a.pingdortFlightPose = 'perched'; }
        }
        if (!state.leg) {
          if (!state._tothalNestShelter) {
            state._tothalNestShelter = true; // Hidden at the authored nesting ledge, not a despawn.
            state._tothalNestVisibility = {
              avatar: a.avatarRef?.group?.visible, shadow: a.groundShadow?.visible,
            }; // Restore independent prior LOD visibility, including birds already hidden for unrelated reasons.
            if (a.avatarRef?.group) a.avatarRef.group.visible = false;
            if (a.groundShadow) a.groundShadow.visible = false;
          }
          state.phase = 'rest'; state.target = null;
        }
        continue;
      }
      if (state._tothalNestShelter) {
        state._tothalNestShelter = false;
        const wasVisible = state._tothalNestVisibility || {}; // Each render object had its own pre-storm visibility.
        delete state._tothalNestVisibility;
        if (a.avatarRef?.group) a.avatarRef.group.visible = wasVisible.avatar ?? true;
        if (a.groundShadow) a.groundShadow.visible = wasVisible.shadow ?? true;
        state.cooldown = Math.max(2.5, state.cooldown); // Resume hunting from the real perch after the storm ends.
      }
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
  // Keep saved Pingdort bomber IDs compatible while resolving the actual attack from live Size.
  function canBomb(kind,genotype,def){
    if(def?.isFlyingSpecies!==true)return false;
    const size=window.CreatureGenetics?.creatureSizeClass?.(kind,genotype)||genotype?.sizeClass||def?.defaultSizeClass;
    return size==='large';
  }
  let boulderArt=null; // A single closed, faceted wilderness-stone asset is shared by all temporary payloads.
  function boulderImpact(burden,cause){
    if(!burden||burden.exploded||burden.pingdortImpactResolved||burden.hanging)return false; // Carried payloads cannot be prematurely detonated by a stray strike.
    const p=burden.group?.getWorldPosition?.(new window.THREE.Vector3());
    if(!p)return false;
    burden.pingdortImpactResolved=true; // Exactly one impact, including simultaneous ground and obstacle contact.
    const pendingHypedRatio=burden.pendingFeyHypedImpactRatio;
    const isHypedReplay=pendingHypedRatio!=null&&Number.isFinite(Number(pendingHypedRatio));
    const feyScale=isHypedReplay?Math.max(0,Number(pendingHypedRatio)):1;
    const attacker=burden.pingdortBomber; // Attribute delayed blunt damage to the actual trained bird.
    delete burden.pendingFeyHypedImpactRatio;
    delete burden.pingdortBomber;
    window.Shattercasks?.discardBurden?.(burden); // Destroy on contact, not a timed fuse or a reusable landed prop.
    debug.boulderImpacts++;
    if(window.AudioSystem?.playObjectSfxKeyAt)window.AudioSystem.playObjectSfxKeyAt('breakRock',p.x,p.z,burden.mapId,p.y,{earshotTiles:14});
    else window.AudioSystem?.playObjectSfxKey?.('breakRock');
    const combat=window.Combat?.deps,t=Number(combat?.TILE)||64;
    for(const enemy of combat?.hostileObjects||[]){
      if(enemy.health<=0||enemy.areaId!==burden.mapId||enemy.isCompanion||enemy===attacker)continue;
      if(Math.hypot(enemy.x/t-p.x,enemy.y/t-p.z)>1.35)continue;
      const box=window.TzatzulFlightRuntime?.flightTargetBox?.(enemy); // Prevent blast damage through a different floor.
      if(box&&(p.y<box.min.y-1.35||p.y>box.max.y+1.35))continue;
      combat.damageCreature?.(enemy,18*feyScale,p.x*t,p.z*t,150*feyScale,{tag:'blunt',source:'pingdort-boulder',
        attacker,feyHypedReplay:isHypedReplay});
    }
    return true;
  }
  function ensureBoulderFactory(){
    if(registeredBomb||!window.Shattercasks?.registerBurdenFactory||!window.THREE)return false;
    const THREE=window.THREE;
    window.Shattercasks.registerBurdenFactory(BOULDER_KIND,()=>{
      if(!boulderArt){
        const geometry=new (THREE.DodecahedronGeometry||THREE.IcosahedronGeometry)(BOULDER_RADIUS,0); // Closed low-poly stone with no grass rim or terrain anchoring.
        geometry.scale?.(1.06,.94,1.02);
        const template=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x808080}));
        template.name='pingdort_boulder';
        const initial=template.material;
        window.FacetedRocks?.surfaceStone?.(template,{label:template.name}); // Same inked PNG and UV pipeline as wilderness rocks.
        if(template.material!==initial)initial.dispose?.();
        if(template.geometry!==geometry)geometry.dispose?.(); // The stretch mapper may replace the source geometry.
        boulderArt={geometry:template.geometry,material:template.material,userData:{...template.userData}};
      }
      const root=new THREE.Group();
      const stone=new THREE.Mesh(boulderArt.geometry,boulderArt.material);
      stone.name='pingdort_boulder';Object.assign(stone.userData,boulderArt.userData);
      window.FacetedRocks?.styleMesh?.(stone);
      root.add(stone);
      return {group:root,displayName:'Boulder',onImpact:boulderImpact,noHang:true};
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
    return window.DevRandomRuin?.getRuntimeContext?.()?.shaftHub!==true; // Interior fallback; an actual full-height shaft still allows bombing.
  }
  function companionPose(actor){
    // The shared flight renderer reads the species-specific pose fields.
    actor.tzatzulFlightPose=actor.skeeriFlightPose=actor.pingdortFlightPose;
    actor.tzatzulDivePitchRad=actor.skeeriDivePitchRad=actor.pingdortDivePitchRad;
  }
  function companionFlight(actor,state,to,phase,speed){
    const from=tilePos(actor);
    const fromY=Number.isFinite(actor.branchSurfaceY)&&actor.onBranch?actor.branchSurfaceY:state.home.y; // Actual support, including zero elevation.
    if(state.area==='map_i_dev_random_ruin'&&window.DevRandomRuin?.flightClear?.(from.x,fromY,from.z,to.x,to.y,to.z)===false){state.phase='failed';return false;}
    if(!flight(actor,state,to,phase,speed)){state.phase='failed';return false;}
    if(dist(from,to)>.001)actor.facing=Math.atan2(to.z-from.z,to.x-from.x);
    companionPose(actor);
    return true;
  }
  function companionAdvance(actor,state,step){
    const ended=advance(actor,state,step);
    companionPose(actor);
    if(!ended&&!state.leg)state.phase='failed'; // A lost perch cannot strand a companion indefinitely.
    return ended;
  }
  function diveBox(target){
    const shared=window.TzatzulFlightRuntime?.flightTargetBox?.(target);
    if(shared)return shared;
    const p=tilePos(target),ground=groundAt(p.x,p.z);
    return {min:{x:p.x-.42,y:ground,z:p.z-.42},max:{x:p.x+.42,y:ground+1.1,z:p.z+.42}};
  }
  function beginDive(actor,state){
    if(!(state.target?.health>0)||state.target.areaId&&state.target.areaId!==state.area){state.phase='failed';return false;}
    const p=tilePos(state.target),box=diveBox(state.target);
    const half=state.bodyHalf; // Same body-only collider used by the Tzatzul arena attack.
    const aim=Math.max(box.min.y,(box.min.y+box.max.y)/2-half.y);
    return companionFlight(actor,state,{...p,y:aim},'dive',7.2);
  }
  function bodySweep(target,from,to,half){
    const sweep=window.TzatzulFlightRuntime?.sweptBodyHit;
    return typeof sweep==='function'&&sweep(from,to,half,diveBox(target))!==null;
  }
  function restoreCompanion(actor,state){
    if(state.boulder && state.phase!=='dropped'){
      window.Shattercasks?.discardBurden?.(state.boulder);state.boulder=null;
    }
    window.PerchSupport?.forget?.(actor);
    if(actor.onBranch?.perchSupport){actor.onBranch=null;actor.branchT=0;actor.branchSurfaceY=0;}
    if(state.originalGroupVisible!=null && actor.avatarRef?.group)actor.avatarRef.group.visible=state.originalGroupVisible;
    actor.pingdortFlightPose='perched';actor.pingdortDivePitchRad=0;companionPose(actor);
    pets.delete(actor);
  }
  function companionStart(actor,state,ctx,allowBomb=true){
    const target=ctx?.target,area=actor?.areaId||activeArea();
    state.phase='depart';state.target=target;state.area=area;state.t=0;state.serial=0;
    state.id='pingdort:companion:'+String(actor.id||'pet');
    const at=tilePos(actor); // Keep elevated supports and real terrain at the start of a dive.
    const supportY=actor.onBranch&&Number.isFinite(actor.branchSurfaceY)?actor.branchSurfaceY:groundAt(at.x,at.z);
    state.home={...at,y:supportY+.5};
    state.originalGroupVisible=actor.avatarRef?.group?.visible;
    state.boulder=null;state.leg=null;state.struck=false;state.cancelled=false;
    pets.set(actor,state);
    if(!actor.isCompanion||actor.stableRole!=='companion'||!actor.def?.isFlyingSpecies||!(target?.health>0)){state.phase='failed';return;}
    const bomber=allowBomb&&canBomb(actor.creatureKey,actor.genotype,actor.def);
    const low=lowCeiling(actor); // Only bomb-capable birds may fetch payloads; interiors keep the existing dive fallback.
    state.bodyHalf=window.TzatzulFlightRuntime?.flightBodyHalf?.(actor)||{x:.24,y:.3,z:.24};
    debug.lastCompanionAttack={id:actor.id||null,kind:actor.creatureKey||KIND,mode:bomber&&!low?'boulder':'dive'};
    if(!bomber||low){
      debug.companionDives++;
      if(low){debug.lowCeilingDives++;beginDive(actor,state);}
      else companionFlight(actor,state,{...tilePos(actor),y:state.home.y+2.3},'rise',7);
    }else{
      const p=tilePos(actor),player=tilePos(deps?.player);
      const dx=p.x-player.x,dz=p.z-player.z,length=Math.max(.01,Math.hypot(dx,dz));
      const off={x:p.x+dx/length*12,z:p.z+dz/length*12,y:state.home.y+6};
      companionFlight(actor,state,off,'depart',10); // Moves beyond the camera, rather than summoning a rock in front of the player.
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
        mechanismId:'flying-companion-payload', // Exclude an attached payload from the shared projectile raycast until release.
        fallGroundY:({x,y,z,mapId})=>{
          const support=mapId==='map_i_dev_random_ruin'&&Number.isFinite(y)?window.DynamicSurfaces?.sampleSupport?.(x,z,{minY:y-40,maxY:y+.3,pad:.02}):null;
          return (support?.y??groundAt(x,z))+BOULDER_RADIUS;
        },
      });
      if(!rock)return;
      if(state.cancelled||actor._animalAttack?.state!==state||activeArea()!==state.area){
        Shatter.discardBurden?.(rock);return;
      }
      rock.pingdortBomber=actor;rock.impactRadius=BOULDER_RADIUS;
      state.boulder=rock;
    }catch(error){debug.lastError=String(error);}
    finally{state.pendingRock=false;if(!state.cancelled&&state.phase==='fetch')state.phase='return';}
  }
  function companionUpdate(actor,state,dt,combat){
    if(state.cancelled||!(actor.health>0)||activeArea()!==state.area||actor.areaId!==state.area){state.cancelled=true;restoreCompanion(actor,state);return false;}
    const step=clamp(dt,0,.15);
    if(state.phase==='rise'){
      if(companionAdvance(actor,state,step))beginDive(actor,state);
      return true;
    }
    if(state.phase==='dive'){
      const old=tilePos(actor),oldY=Number.isFinite(actor.branchSurfaceY)?actor.branchSurfaceY:state.home.y;
      const ended=companionAdvance(actor,state,step);
      const now=tilePos(actor),newY=Number.isFinite(actor.branchSurfaceY)?actor.branchSurfaceY:state.home.y;
      const half=state.bodyHalf;
      if(state.phase==='dive'&&!state.struck&&state.target?.health>0&&(!state.target.areaId||state.target.areaId===state.area)&&bodySweep(state.target,
        {x:old.x,y:oldY+half.y,z:old.z},{x:now.x,y:newY+half.y,z:now.z},half)){
        state.struck=true;debug.companionDiveHits++;
        combat?.damageCreature?.(state.target,actor.def?.attackDamage||6,actor.x,actor.y,40,
          {tag:'sharp',attacker:actor,aerialSwoop:true,impactCollider:'body'});
      }
      if(ended)companionFlight(actor,state,state.home,'land',7);
      return true;
    }
    if(state.phase==='depart'){
      if(companionAdvance(actor,state,step)){
        state.phase='fetch';state.t=0;
        if(actor.avatarRef?.group)actor.avatarRef.group.visible=false; // Invisible off-camera retrieval; no invented quarry prop.
        fetchBoulder(actor,state);
      }
      return true;
    }
    if(state.phase==='fetch')return true;
    if(state.phase==='return'){
      if(!state.leg){
        if(!(state.target?.health>0)||state.target.areaId&&state.target.areaId!==state.area){state.phase='failed';return true;}
        const p=tilePos(state.target),ground=Math.max(groundAt(p.x,p.z),diveBox(state.target).min.y);
        if(!companionFlight(actor,state,{x:p.x,z:p.z,y:ground+3.6},'return',10))return true;
        if(actor.avatarRef?.group)actor.avatarRef.group.visible=state.originalGroupVisible!==false;
      }
      const arrived=companionAdvance(actor,state,step);
      if(state.boulder?.group&&!state.boulder.flying){
        const p=tilePos(actor);
        state.boulder.group.position.set(p.x,Number(actor.branchSurfaceY)-.32,p.z); // Move AFTER advancing, including the exact release frame.
      }
      if(arrived){
        if(state.boulder){
          const echoScale = Number(state.feyHypedEchoRatio); // The second authored bombing run may land after the special itself finishes.
          if(Number.isFinite(echoScale) && echoScale>=0) state.boulder.pendingFeyHypedImpactRatio=echoScale;
          if(window.Shattercasks?.releaseBurdenDownward?.(state.boulder,'pingdort-bomber'))debug.bouldersDropped++;
          else window.Shattercasks?.discardBurden?.(state.boulder);
          state.boulder=null;
        }
        debug.bombingRuns++;
        const p=tilePos(deps?.player),to={x:p.x+1.1,z:p.z+.8,y:groundAt(p.x,p.z)+.5};
        companionFlight(actor,state,to,'land',10);
      }
      return true;
    }
    if(state.phase==='land'){
      if(companionAdvance(actor,state,step)){restoreCompanion(actor,state);return false;}
      return true;
    }
    restoreCompanion(actor,state);return false;
  }
  function registerCompanionAttack(){
    const attacks=window.Combat?.animalAttacks;if(registeredAttack||!attacks?.register)return false;
    const shared={ownsApproach:true,update:companionUpdate,
      cancel:(actor,state)=>{state.cancelled=true;restoreCompanion(actor,state);},
      isWindingUp:state=>['depart','fetch','rise'].includes(state.phase),
      isStriking:state=>['return','dive'].includes(state.phase)};
    attacks.register('pingdortBoulderBomb',{...shared,label:'Boulder Drop',start:(actor,state,ctx)=>companionStart(actor,state,ctx,true)});
    attacks.register('flyingCompanionDive',{...shared,label:'Dive Attack',start:(actor,state,ctx)=>companionStart(actor,state,ctx,false)});
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
  const nestRecords=area=>sessions.get(area)?.nests||[]; // DenNestSystem reads this as the authoritative real-egg list.
  const debugSnapshot=()=>({...debug,habitats:[...sessions].map(([area,s])=>({
    area,networkShelves:s.network?.balconies?.length||0,
    nests:s.nests.map(n=>({id:n.id,x:n.x/unit(),z:n.y/unit(),y:n.worldY,shelfId:n.shelfId,
      remaining:n.remaining,flockLoaded:n.flockLoaded,deadSlots:[...n.deadBirdSlots].sort()})),
    liveBirds:[...s.birds].filter(v=>v.actor.health>0).length,
  }))});
  window.PingdortFlocks=Object.freeze({KIND,BOULDER_KIND,init,ensureZone,update,collectNest,nestRecords,siteForShelf:clearNestTile,lowCeiling,canBomb,debugSnapshot,
    getNest: id=>[...sessions.values()].flatMap(s=>s.nests).find(n=>n.id===id)||null});
})();
