// Boney Shinjimi: world-scoped, repeatable full-moon wilderness hermit.
// Leverages SlagothimTraders' game adapters/save seam, NPC pathfinding,
// real Highland HousePieceGen geometry and shared movement blockers.
(() => {
  'use strict';
  if (window.BoneyShinjimiWilderness) return;
  const NPC_ID = 'boney_shinjimi'; // Distinct from ordinary skeletons and temporary traders.
  const BLOCKER_ID = 'boney-shinjimi-magic-house'; // Installed in the game's shared player/NPC/projectile blocker registry.
  const ZONES = Object.freeze(['map_northern_cliffs', 'map_western_slope',
    'map_eastern_mire', 'map_southern_cloud_forest']); // Eligible generated wilderness maps.
  const SECTORS = Object.freeze([ // Compass names for the same nine equal map sectors used by wilderness locale placement.
    Object.freeze(['Northwest', 'North', 'Northeast']),
    Object.freeze(['West', 'Center', 'East']),
    Object.freeze(['Southwest', 'South', 'Southeast']),
  ]);
  const HOUSE_FILE = 'config/pieces/house-section-3x3.json'; // Reuses an authored three-by-three Highland roof and wall assembly.
  const HAT_ID = 'appearance::hat::old_highlands_kasa'; // Boney's actual authored two-sided kasa, also granted to the player.
  const SIGHT_TILES = 10; // LOS range; existing RangedWeapons rays handle trees, rocks, terrain and cover.
  const WORK_RADIUS_TILES = 13; // Keeps his chores in the neighboring chunks around the magical house.
  const FLEE_BOOST_SECONDS = 0.58; // Contact gives a strong but short burst, never an indefinite movement buff.
  const FLEE_BOOST_FACTOR = 2.7; // Boost affects his existing collision-aware walker route, not a direct teleport.
  const SCAN_SECONDS = 0.24; // Throttles bidirectional sight tests and population scans.
  const SAVE_VERSION = 1; // Compatible additive field inside SlagothimTraders' existing saved record.
  const MAX_MILK_GIFTS = 3; // Secret encounter limit, independent of ordinary daily gift eligibility.
  const runtime=window.WildernessEncounterRuntime; // Uses the same encounter lifecycle/eligibility helpers as Rootledoots.
  let deps = null; // SlagothimTraders' existing injected, game-owned NPC, calendar, inventory and map adapters.
  let walker = null; // The one materialized NPC in the active exterior zone.
  const walkerBuild=runtime.createBuildSlot(); // Prevents asynchronous duplicate walker construction.
  let houseMesh = null; // Loaded Highland piece; renderer visibility is separate from collisions.
  let encounterScene = null; // Active scene identity, including same-area rebuilds.
  let houseScene = null; // Tracks the scene that owns the piece when zones are streamed/recreated.
  const houseBuild=runtime.createBuildSlot(); // Prevents repeated fetches during an in-flight build.
  let houseUnregister = null; // Shared hard-wall collision registration, active even when invisible.
  let generation = 0; // Invalidates pending asynchronous builders after map/world/encounter changes.
  const feyApproachClock=runtime.createInterval(20); // Rare nearby-arrival rolls run at most once every 20 active-zone seconds.
  let scanTimer = 0; // LOS and NPC scans are not repeated every animation frame.
  let planTimer = 0; // Chore route choices are throttled separately from body updates.
  let debugTimer = 0; // Mobile in-page diagnostics repaint at most twice per second.
  let debugElement = null; // Only created when ?boneyDebug=1 is requested.
  let lastWeaponColliderAt = 0; // Prevents a single held melee hitbox from repeatedly triggering escape boosts.
  const sightProxies = new WeakMap(); // Stable walker-to-actor proxies retain RangedWeapons' LOS/hitbox caches instead of forcing a fresh raycast on every throttled Boney scan.
  let sceneRunning = false; // Prevents overlapping choice cutscenes.
  const state = initialState(); // Saved moon cycle, location, phase, rewards and chase/chores counters.
  let spoilersRevealed = false; // Controls only the Dev Companion's opt-in location readout; never saved with the world.

  function initialState() {
    return { phase:'waiting', cycle:-1, completedCycle:-1, zone:null, home:null, target:null,
      activity:'wander', resourceTarget:null, workLeft:0, fleeTime:0, boostedFor:0, boostCooldown:0,
      catches:0, weaponContacts:0, escaped:0, chores:0, lastSight:'unobserved', lastEvent:'awaiting full moon',
      reward:null, hatTaken:false, milksGiven:0 };
  }
  function rnd() { return window.GameRandom?.random?.() ?? Math.random(); }
  function finite(value, fallback=0) { const n=Number(value); return Number.isFinite(n) ? n : fallback; }
  function clamp(n,a,b) { return Math.max(a,Math.min(b,n)); }
  function activeScene() { return window.GridTileAccessors?.getActiveScene?.() || null; }
  function area() { return String(deps?.getCurrentArea?.() || ''); }
  function ownsActiveScene() { return !!encounterScene && area()===state.zone && activeScene()===encounterScene; } // Synchronous guard for input/callbacks between scheduler ticks.
  function tileSize() { return Math.max(1, finite(deps?.TILE,64)); }
  function layout() { return state.zone ? deps?.getZoneLayout?.(state.zone) : null; }
  function houseSector(home, map) {
    if (!home || !(map?.cols > 0) || !(map?.rows > 0)) return null;
    const col = clamp(Math.floor((home.c + 1.5) / map.cols * 3), 0, 2); // House centre determines its west/centre/east third.
    const row = clamp(Math.floor((home.r + 1.5) / map.rows * 3), 0, 2); // Increasing map rows point south, matching the house's south doorway.
    return SECTORS[row][col];
  }
  function position() { return walker?.root?.position || null; }
  function playerTile() {
    const p=deps?.player;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return {x:p.x/tileSize(),z:p.y/tileSize()};
  }
  function dist(a,b) { return a&&b ? Math.hypot(a.x-b.x,a.z-b.z) : Infinity; }
  function homeCenter() { return state.home ? {x:state.home.c+1.5,z:state.home.r+1.5} : null; }
  function moonCycle(day) { return Math.floor((day-1)/28); }
  function lunarDay(day) { return ((day-1)%28+28)%28+1; }
  function numberHash(seed) {
    let h=2166136261; // Deterministic FNV-1a keeps a chosen monthly location stable across reloads.
    for(let i=0;i<seed.length;i++) h=Math.imul(h^seed.charCodeAt(i),16777619);
    return h>>>0;
  }
  function seeded(seed) {
    let s=numberHash(seed);
    return () => {s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  }
  function zoneEligible(zone) { return ZONES.includes(zone) && !!deps?.EXTERIOR_ZONES?.[zone]; }
  function currentDay() { return Math.floor(finite(deps?.calendar?.day,0)); }
  function worldSeed() { return String(deps?.tothalWorldId?.() || 'new-world'); }

  function bumpEvent(message) { state.lastEvent=message;window.__farmLog?.('[boney] '+message,'info'); }
  function save() { deps?.save?.(); }
  function validTile(c,r,zone=state.zone) {
    if(!Number.isInteger(c)||!Number.isInteger(r)||!zone) return false;
    const map=deps?.getZoneLayout?.(zone);
    if(!map?.tiles?.length||c<3||r<3||c>=map.cols-3||r>=map.rows-3) return false;
    return window.NpcPathfinding?.isNpcTileWalkable?.(zone,c,r)===true;
  }
  function chooseHouseSite(zone,cycle) {
    const map=deps?.getZoneLayout?.(zone);
    if(!map?.tiles?.length||map.cols<14||map.rows<14) return null;
    const random=seeded(worldSeed()+':boney:'+cycle+':'+zone);
    const p=playerTile();
    for(let trial=0;trial<420;trial++) {
      const c=3+Math.floor(random()*(map.cols-9));
      const r=3+Math.floor(random()*(map.rows-9));
      if(zone===area()&&p&&dist({x:c+1.5,z:r+1.5},p)<15) continue;
      const centerTile=map.tiles?.[(r+1)*map.cols+c+1]||map.tiles?.[r+1]?.[c+1]||null; // Flat three-by-three footprint must not span a cliff/mesa height seam.
      const foundationTier=finite(centerTile?.elevTier,0); // Used only for the house's actual 3×3 cells; surrounding apron may contain cliffs for Boney to escape down.
      let clear=true;
      for(let dr=-1;dr<=3&&clear;dr++) for(let dc=-1;dc<=3;dc++) {
        if(!validTile(c+dc,r+dr,zone)){clear=false;break;}
        if(dc>=0&&dc<3&&dr>=0&&dr<3) {
          const tile=map.tiles?.[(r+dr)*map.cols+c+dc]||map.tiles?.[r+dr]?.[c+dc]||null;
          if(finite(tile?.elevTier,0)!==foundationTier) {clear=false;break;}
        }
      }
      if(!clear) continue;
      if((map.buildings||[]).some(b=>Math.abs(finite(b.gridX,c+100)-c)<6&&Math.abs(finite(b.gridZ,r+100)-r)<6))continue;
      return {c,r};
    }
    return null; // Never replace an occupied generated tile blindly.
  }
  function newMoonEncounter() {
    const day=currentDay();
    if(day<1||lunarDay(day)!==14)return;
    const cycle=moonCycle(day);
    if(cycle===state.completedCycle)return; // One reward per moon even if the player time-skips repeatedly.
    if(state.phase!=='waiting'&&state.phase!=='complete')return; // Unfinished encounter stays until resolved, including across moons.
    const available=ZONES.filter(zoneEligible);
    if(!available.length)return;
    const choose=seeded(worldSeed()+':boney-zone:'+cycle);
    state.phase='planned';state.cycle=cycle;
    state.zone=available[Math.min(available.length-1,Math.floor(choose()*available.length))];
    state.home=null;state.target=null;state.reward=null;state.hatTaken=false;state.milksGiven=0;
    bumpEvent('Full moon: magic home planned in '+state.zone);save();
  }
  function ensureSite() {
    if(state.phase!=='planned'||!state.zone)return;
    const site=chooseHouseSite(state.zone,state.cycle);
    if(!site)return;
    state.home={...site,sector:houseSector(site,layout())}; // Preserve the sector across reloads even if the zone layout is not loaded yet.
    state.target={c:site.c+1,r:site.r+3};
    state.phase='roam';
    ensureCollision();
    bumpEvent('Three-by-three Highland house settled at '+site.c+','+site.r);
    save();
  }

  // Real wall footprint. Front wall has a one-tile-wide opening, so actors
  // can enter while the invisible walls still physically stop passage.
  function wallHit(x,z,half=0) {
    const h=state.home;
    if(!h||!['roam','flee','home','leaving','scene'].includes(state.phase))return false;
    const left=h.c,right=h.c+3,top=h.r,bottom=h.r+3;
    const intersects=(a,b,c,d)=>x+half>a&&x-half<b&&z+half>c&&z-half<d;
    const wall=0.20;
    return intersects(left,right,top,top+wall)
      ||intersects(left,left+wall,top,bottom)
      ||intersects(right-wall,right,top,bottom)
      ||intersects(left,h.c+1, bottom-wall,bottom)
      ||intersects(h.c+2,right,bottom-wall,bottom);
  }
  function ensureCollision() {
    if(!state.home||houseUnregister||!window.AreaFootprintBlockers?.register)return;
    const zone=state.zone; // Provider stays area-scoped so other wilderness maps are unaffected.
    houseUnregister=window.AreaFootprintBlockers.register(BLOCKER_ID,{
      area:zone,blocksBox:(x,z,half)=>wallHit(x,z,half),
    });
  }
  function clearHouse() {
    generation++;
    if(houseMesh?.parent)houseMesh.parent.remove(houseMesh);
    houseMesh=null;houseScene=null;houseBuild.cancel();
    houseUnregister?.();houseUnregister=null;
  }
  function releaseWalker() {
    generation++;
    // Invalidated cutscenes cannot finish against the old encounter. Return to the last valid phase and release only their own lock.
    if(sceneRunning){sceneRunning=false;if(state.phase==='scene')state.phase=state.reward?'leaving':'home';}
    if(walker) {
      const old=walker;walker=null;
      if(!deps?.despawnNpcWalker?.(old)) old.root?.parent?.remove?.(old.root);
    }
    walkerBuild.cancel();
  }
  function cutSouthDoorway(piece) {
    const faces=piece?.base?.faces;
    if(!Array.isArray(faces))return piece;
    // The authored bare 3x3 section has no entrance: split its south-facing
    // frustum wall into left/right jambs and a lintel, retaining its roof.
    const wall=faces.find(face=>face.tag==='wall'&&Array.isArray(face.v)
      &&face.v[0]?.[2]>0.9&&face.v[3]?.[2]>0.9);
    if(!wall)return piece;
    const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
    const p=(u,v)=>mix(mix(wall.v[3],wall.v[0],u),mix(wall.v[2],wall.v[1],u),v);
    const quad=(u0,u1,v0,v1,index)=>({...wall,id:String(wall.id)+'_boneyDoor_'+index,
      v:[p(u1,v0),p(u1,v1),p(u0,v1),p(u0,v0)]});
    const newFaces=faces.filter(face=>face!==wall);
    newFaces.push(quad(0,1/3,0,1,'left'),quad(2/3,1,0,1,'right'),quad(1/3,2/3,0.82,1,'lintel'));
    return {...piece,base:{...piece.base,faces:newFaces}}; // Authoring JSON stays unchanged.
  }
  async function ensureHouse() {
    const scene=activeScene();
    if(!state.home||area()!==state.zone||!scene||houseBuild.busy)return;
    if(houseMesh&&scene===houseScene)return;
    if(houseMesh?.parent)houseMesh.parent.remove(houseMesh);
    houseMesh=null;houseScene=null;
    if(!window.HousePieceGen?.buildGroupFromPiece||!window.THREE)return;
    const buildToken=houseBuild.begin(); // Only this async request owns its loading flag.
    const serial=generation;
    try {
      const response=await fetch(HOUSE_FILE);
      if(!response.ok)throw new Error('HTTP '+response.status+' for Highland house piece');
      const piece=await response.json();
      if(serial!==generation||area()!==state.zone||!state.home||scene!==activeScene()||!houseBuild.owns(buildToken))return; // Do not construct stale house geometry or dereference a removed home.
      const base=piece.currentPiece||piece;
      if(!Array.isArray(base.footprint?.cells)||base.footprint.cells.length!==9)
        throw new Error('Highland 3x3 footprint no longer matches its authored asset');
      const authored=cutSouthDoorway({...base,footprint:{...base.footprint,door:{x:8,y:9}}}); // Real geometric doorway cut, not a fake collision-only entrance.
      const h=state.home;
      const y=finite(deps?.npcSurfaceY?.(state.zone,h.c+1,h.r+1),0);
      const group=window.HousePieceGen.buildGroupFromPiece(window.THREE,authored,h.c,h.r,{
        shingleVariant:'town',wallBuilder:window.WallBuilder||null,
        wbUsePlaceholder:true,elevationY:y,rotationDeg:0,
      });
      if(serial!==generation||area()!==state.zone||state.phase==='waiting'||state.phase==='complete'||!group)return;
      group.name='boney_shinjimi_highland_house';
      group.userData.boneyShinjimiMagicHouse=true;
      group.visible=false; // Collision registry stays active when mesh is invisible.
      scene.add(group);houseMesh=group;houseScene=scene;
      bumpEvent('Authored Highland house geometry loaded');
    } catch(err) {
      if(serial===generation)bumpEvent('House geometry unavailable: '+(err?.message||err)); // Mobile diagnostics: no silent cube substitute.
    } finally {houseBuild.finish(buildToken);}
  }
  function updateHouseVisibility() {
    if(!houseMesh)return;
    const w=position();
    const close=w&&walker?.area===state.zone&&dist({x:w.x,z:w.z},homeCenter())<=5.2;
    houseMesh.visible=!!close&&state.phase!=='complete';
  }
  function record() {
    return {
      id:NPC_ID,name:'Boney Shinjimi',species:"Mao'ao",gender:'male',relationship:false,
      appearance:{speciesId:'boney-shinjimi-skeleton',gender:'male',
        cosmetics:{facialHair:'appearance::Mao-ao_M::mao-ao_grandbeard'}},
      equippedCosmetics:state.hatTaken?[]:[HAT_ID],appliedDyes:{},
      schedule:[],schedules:[],scheduleHooks:{},wildernessRoaming:true,
      dialogueTrees:[],
    };
  }
  function targetFor(rec) {
    if(rec?.id!==NPC_ID||!state.zone||!state.target)return null;
    const work=state.phase==='roam'&&state.workLeft>0&&nearTarget(1.3);
    return {area:state.zone,c:state.target.c,r:state.target.r,
      label:state.phase==='flee'?'Fleeing to the hermitage':'A wandering Highland woodcutter',
      activity:state.phase==='flee'?'taking cover':state.phase==='roam'?(state.activity==='rock'?'breaking rocks':'cutting trees'):'hiding at home',
      run:state.phase==='flee'||state.boostedFor>0,
      ...(work?{toolKey:state.activity==='rock'?'pickaxe':'axe',toolActivity:state.activity==='rock'?'mine':'chop'}:{}),
    };
  }
  function nearTarget(radius=0.7) {
    const w=position(),t=state.target;
    return !!w&&!!t&&dist({x:w.x,z:w.z},{x:t.c+0.5,z:t.r+0.5})<=radius;
  }
  function setTarget(c,r,activity=state.activity) {
    if(!validTile(c,r))return false;
    if(!state.target||state.target.c!==c||state.target.r!==r||state.activity!==activity) {
      state.target={c,r};state.activity=activity;walker?.resetRouteState?.();
    }
    return true;
  }
  async function ensureWalker() {
    const scene=activeScene(); // The constructor may finish after a same-zone scene swap.
    if(walker||walkerBuild.busy||!deps?.makeNpcWalker||!state.home||area()!==state.zone||!scene)return;
    const buildToken=walkerBuild.begin(); // A superseded builder cannot unlock a newer asynchronous walker request.
    const serial=generation,spot=state.target||{c:state.home.c+1,r:state.home.r+3};
    try {
      const w=await deps.makeNpcWalker(record(),{area:state.zone,c:spot.c,r:spot.r});
      if(!w)return;
      if(serial!==generation||area()!==state.zone||scene!==activeScene()||!walkerBuild.owns(buildToken)||!state.home||state.phase==='complete'||state.phase==='waiting') {
        deps?.despawnNpcWalker?.(w,true);return; // This constructor owns the unadopted result; the canonical visitor disposer may retire it.
      }
      walker=w;
      if(!deps.npcWalkers?.includes(w))deps.npcWalkers?.push(w);
      const original=w.update;
      if(typeof original==='function') {
        w.update=function boneyCollisionAwareUpdate(dt) {
          // The normal walker owns climbing, corners, facing, equipment and collision.
          return original.call(this,Math.max(0,finite(dt))*(state.boostedFor>0?FLEE_BOOST_FACTOR:1));
        };
      }
      bumpEvent('Boney entered '+state.zone);
    }catch(err){if(serial===generation)bumpEvent('NPC build failed: '+(err?.message||err));}
    finally{walkerBuild.finish(buildToken);}
  }
  function sightProxy(w) {
    let proxy=sightProxies.get(w); // Stable actor identity lets RangedWeapons reuse its existing 80 ms LOS and one-frame portrait-hitbox caches.
    if(!proxy) {
      proxy={x:0,y:0,root:w.root,avatarGroup:w.avatarGroup,health:1,areaId:state.zone,walker:w};
      sightProxies.set(w,proxy);
    }
    proxy.x=w.root.position.x*tileSize();
    proxy.y=w.root.position.z*tileSize();
    proxy.areaId=w.area||state.zone;
    return proxy;
  }
  function sees(observer,target) {
    const los=window.RangedWeapons?.hasLineOfSight;
    if(typeof los!=='function')return false; // Missing LOS must never mean x-ray vision.
    return los(observer,target)===true&&los(target,observer)===true;
  }
  function visiblePlayer() {
    const w=walker,p=deps?.player;
    if(!w||!p||p.health<=0||area()!==state.zone)return false;
    if(dist({x:w.root.position.x,z:w.root.position.z},playerTile())>SIGHT_TILES)return false;
    const ok=sees(sightProxy(w),p);
    state.lastSight=ok?'player in mutual LOS':'player hidden by cover';
    return ok;
  }
  function nearbyOtherNpc() {
    if(!walker)return null;
    let closest=null,range=8; // The existing perception clock owns this scan.
    const here=walker.root.position;
    for(const point of runtime.peopleInArea({zone:state.zone,walkers:deps?.npcWalkers,actors:[deps?.hostileObjects],tileSize:tileSize(),exclude:actor=>actor===walker})){
      const d=dist(here,point);
      if(d<range){closest={x:point.x,z:point.z};range=d;}
    }
    return closest;
  }
  function candidateRoute(c,r) {
    if(!validTile(c,r)||!walker?.root)return false;
    const x=walker.root.position.x,z=walker.root.position.z;
    return !!window.NpcPathfinding?.findNpcPath?.(state.zone,x,z,c,r)
      ||window.NpcPathfinding?.canNpcBeeline?.(state.zone,x,z,c,r)===true;
  }
  function pickChore(avoid=null) {
    const h=homeCenter(),p=position();
    if(!h||!p)return;
    const resources=window.ZoneRegrowth?.npcResourceTargets?.(state.zone,h.x,h.z,WORK_RADIUS_TILES)||[];
    let result=null,best=-Infinity;
    for(const resource of resources) {
      // Trees and ores are often solid: target a navigable adjacent work station.
      for(const [dc,dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const c=resource.col+dc,r=resource.row+dr;
        if(!candidateRoute(c,r)||Math.abs(c-state.home.c)<4&&Math.abs(r-state.home.r)<4)continue;
        const separation=avoid?dist({x:c,z:r},avoid):5;
        const score=Math.min(separation,10)-0.075*dist({x:c,z:r},{x:p.x,z:p.z})+rnd()*2;
        if(score>best){best=score;result={c,r,work:resource.kind,resource};}
      }
    }
    if(!result) {
      // A temporarily exhausted local resource patch leaves him wandering,
      // not pretending to cut nonexistent trees/rocks.
      for(let attempt=0;attempt<35;attempt++) {
        const angle=rnd()*Math.PI*2,rad=3+rnd()*WORK_RADIUS_TILES;
        const c=Math.floor(h.x+Math.cos(angle)*rad),r=Math.floor(h.z+Math.sin(angle)*rad);
        if(!candidateRoute(c,r))continue;
        result={c,r,work:'wander',resource:null};break;
      }
    }
    if(!result)return;
    state.resourceTarget=result.resource;
    state.workLeft=result.resource?2.5+rnd()*6.5:1.5+rnd()*3;
    setTarget(result.c,result.r,result.work);
    bumpEvent(result.resource?'Working on '+result.work+' at '+result.resource.col+','+result.resource.row
      :'Searching for more wilderness timber and rocks');
  }
  function beginFlight() {
    if(state.phase==='flee'||!walker)return;
    state.phase='flee';state.fleeTime=0;state.workLeft=0;state.resourceTarget=null;state.escaped++;
    setTarget(state.home.c+1,state.home.r+3,'flee');
    bumpEvent('Spotted player; sprinting home and breaking line of sight');
  }
  function escapeAroundCover() {
    const p=position(),home=homeCenter(),player=playerTile();
    if(!p||!home||!player)return;
    let best=null,bestScore=-Infinity;
    const map=layout(); // Local terrain tiers and vegetation blockers determine cover and descent opportunities.
    const tileAt=(c,r)=>map?.tiles?.[r*map.cols+c]||map?.tiles?.[r]?.[c]||null;
    const currentTier=finite(tileAt(Math.floor(p.x),Math.floor(p.z))?.elevTier);
    for(let i=0;i<25;i++) {
      const angle=rnd()*Math.PI*2;
      const len=2+rnd()*6;
      const c=Math.floor(p.x+Math.cos(angle)*len),r=Math.floor(p.z+Math.sin(angle)*len);
      if(!candidateRoute(c,r)||wallHit(c+0.5,r+0.5,0.2))continue;
      const dx=dist({x:c,z:r},home),dp=dist({x:c,z:r},player);
      const currentHome=dist({x:p.x,z:p.z},home);
      // Pick a route that advances home, dodges the pursuer and bends around cover.
      const angleToHome=Math.atan2(home.z-p.z,home.x-p.x),angleToPoint=Math.atan2(r-p.z,c-p.x);
      const turn=Math.abs(Math.atan2(Math.sin(angleToHome-angleToPoint),Math.cos(angleToHome-angleToPoint)));
      const lowerTier=Math.max(0,currentTier-finite(tileAt(c,r)?.elevTier)); // Safe NPC pathfinders decide whether a drop/hop is traversable.
      let blockedAround=0;
      for(const [ox,oz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const tile=tileAt(c+ox,r+oz);
        if(!tile||tile.type==='rock'||tile.rockKind==='diggableRockOre'||tile.floraKind==='copse')blockedAround++;
      }
      const cover=Math.min(3,blockedAround)*0.55; // Prefer path turns around real boulders/trees.
      const score=(currentHome-dx)*1.8+Math.min(dp,10)*0.28+turn*0.42
        +Math.min(lowerTier,2)*1.2+cover+rnd()*0.3;
      if(score>bestScore){bestScore=score;best={c,r};}
    }
    if(best&&bestScore>0)setTarget(best.c,best.r,'flee'); // Existing pathfinder handles tree/rock corners and safe cliff hops.
    else setTarget(state.home.c+1,state.home.r+3,'flee');
  }
  function insideHome(point,margin=0) {
    const h=state.home;
    return !!point&&!!h&&point.x>=h.c+margin&&point.x<h.c+3-margin
      &&point.z>=h.r+margin&&point.z<h.r+3-margin;
  }
  function updateFlee(dt) {
    if(!position()||!state.home)return;
    state.fleeTime+=dt;planTimer+=dt;
    const h=homeCenter(),p={x:position().x,z:position().z};
    if(dist(p,h)<3.8) {
      const headedInside=state.target?.c===state.home.c+1&&state.target?.r===state.home.r+1;
      if(!headedInside)setTarget(state.home.c+1,state.home.r+3,'flee'); // First approach the real south opening.
      if(dist(p,{x:state.home.c+1.5,z:state.home.r+3.5})<1.1||headedInside)
        setTarget(state.home.c+1,state.home.r+1,'flee'); // Never oscillate back outside on the next tick.
    } else if(planTimer>=1.8) {
      planTimer=0;escapeAroundCover();
    }
    if(insideHome(p,0.4)) {
      state.phase='home';state.fleeTime=0;
      setTarget(state.home.c+1,state.home.r+1,'hide');
      bumpEvent('Boney reached his house');
    }
    if(state.fleeTime>35&&dist(p,h)<5) {
      state.phase='home';setTarget(state.home.c+1,state.home.r+1,'hide');
    }
  }
  function weaponHitboxTouches(w) {
    const colliders=window.Combat?.debugMeleeColliders?.()||[]; // Real active swing pie-prisms; never infer an attack from movement input.
    const now=Date.now();
    if(!colliders.length)return false;
    const target=window.RangedWeapons?.actorHitbox?.(sightProxy(walker))?.center
      ||{x:w.x,y:w.y+0.5,z:w.z};
    for(const hit of colliders) {
      if(hit.actor!==deps?.player||hit.recordedAt<=lastWeaponColliderAt||now-hit.recordedAt>260)continue;
      const dx=target.x-hit.origin?.x,dz=target.z-hit.origin?.z;
      const horizontal=Math.hypot(dx,dz);
      if(horizontal>finite(hit.horizontalRangeWorld)+0.34)continue;
      const yaw=Math.atan2(dz,dx);
      const delta=Math.abs(Math.atan2(Math.sin(yaw-hit.yaw),Math.cos(yaw-hit.yaw)));
      const reachAngle=finite(hit.halfConeRad)+Math.atan2(0.34,Math.max(0.1,horizontal));
      if(delta>reachAngle)continue;
      const rise=horizontal/Math.max(0.01,finite(hit.horizontalRangeWorld))*finite(hit.verticalRiseWorld);
      if(Math.abs(target.y-(hit.origin.y+rise))>finite(hit.halfHeightWorld,0.4)+0.5)continue;
      lastWeaponColliderAt=hit.recordedAt;
      return true;
    }
    return false;
  }
  function contactBoost(dt) {
    const p=playerTile(),w=position();
    state.boostedFor=Math.max(0,state.boostedFor-dt);
    state.boostCooldown=Math.max(0,state.boostCooldown-dt);
    if(!p||!w||state.boostCooldown>0||state.phase==='scene'||state.phase==='leaving')return;
    const bodyHit=dist(p,{x:w.x,z:w.z})<=0.80;
    const weaponHit=!bodyHit&&dist(p,{x:w.x,z:w.z})<4.5&&weaponHitboxTouches(w);
    if(!bodyHit&&!weaponHit)return;
    state.boostedFor=FLEE_BOOST_SECONDS;state.boostCooldown=0.9;
    state.catches++;
    if(weaponHit)state.weaponContacts++;
    if(state.phase==='roam')beginFlight();
    bumpEvent((weaponHit?'Weapon contact':'Body contact')+': Boney lunged away with a momentary speed boost');
  }
  function sceneDefinition() {
    const h=state.home,profile=window.__hobunjiPlayerProfile;
    const talk=(id,text,next='__next__')=>({id,type:'talk',speakerId:'boney',addressedActorId:'player',text,next});
    return {
      version:6,title:'Boney Shinjimi',mapId:state.zone,
      actors:[
        {id:'player',name:String(profile?.nickname||'Farmer'),isPlayer:true,worldC:h.c+1,worldR:h.r+2,rotation:180,pose:'standing'},
        {id:'boney',name:'Boney Shinjimi',npcRecord:walker?.rec||record(),worldC:h.c+1,worldR:h.r+1,rotation:0,pose:'standing'},
      ],
      stages:[
        talk('beg','Please! Mercy! I mean no harm! I can give you anything you want, if only you let me live.'),
        {id:'demand',type:'choice',speakerId:'player',text:'What do you say?',options:[
          {text:'Something valuable!',next:'valuable_grant'},
          {text:'Something useful!',next:'useful_grant'},
          {text:'-apologize-',next:'apologize_grant'},
          {text:'Your hat!',next:'hat_confusion'},
        ]},
        talk('valuable_grant','An heirloom, then! Take this, please. I beg you.', 'dismiss'),
        talk('useful_grant','This has helped me survive. Perhaps it will serve you better.', 'dismiss'),
        talk('apologize_grant',"You... you're apologizing? Oh! Thank you. Please, have this anyway.",'dismiss'),
        talk('hat_confusion','My hat?...','hat_sure'),
        talk('hat_sure','Sure, here you go.','dismiss'),
        talk('dismiss',"Now, if you don't mind... please leave my house. I'd very much like to be alone.",'__end__'),
      ],
    };
  }
  function isMilkGift(held, giftingDeps) {
    if (!held?.key || held.kind === 'clothing' || !/Milk$/.test(held.key)) return false;
    const def = held.def || giftingDeps?.getItemDefs?.()?.[held.key] || deps?.ITEM_DEFS?.[held.key]; // Item definitions distinguish actual milk from cooked food containing milk.
    return /milk$/i.test(String(def?.label || ''));
  }
  function canAcceptMilkGift(held, giftingDeps) {
    const inv = giftingDeps?.inventory;
    return state.phase === 'leaving' && !!state.reward && !sceneRunning
      && state.milksGiven < MAX_MILK_GIFTS && !!window.AuthoredCutsceneRuntime?.run
      && ownsActiveScene() && !!walker && insideHome(playerTile(), 0.1)
      && insideHome(position() && { x:position().x, z:position().z }, 0.1)
      && isMilkGift(held, giftingDeps) && (Number(inv?.[held.key]) || 0) > 0;
  }
  function milkSceneDefinition(count) {
    const greetings = [
      "Milk? For me? Oh, marvelous! Milk is good for my bones, you know. Even these old ones!",
      "More milk? Why, my bones are positively singing!",
      "A third milk? You're too kind! But that's quite enough for one old skeleton.",
    ]; // The secret is revealed only in this in-house dialogue, never in tips or the compendium.
    const talk = (id, text, next='__next__') => ({ id, type:'talk', speakerId:'boney', addressedActorId:'player', text, next });
    return {
      version:6, title:'Boney Shinjimi', mapId:state.zone,
      actors:sceneDefinition().actors,
      stages:[
        talk('milk_welcome', greetings[Math.min(count, 2)]),
        talk('milk_reward', count === 0
          ? "Please, take this Fey-enchanted weapon in return. It's the least I can do for my poor bones."
          : "And here's another Fey-enchanted weapon for you. A fair trade, I'd say!"),
        talk('milk_farewell', count === 2
          ? "My bones thank you, truly. Now I must be on my way once you've left."
          : "If you've more milk, I certainly won't turn it down! At least, not just yet.", '__end__'),
      ],
    };
  }
  function grantFeyReward(kind,rewardDeps) {
    const cooking=window.CookingSystem;
    return runtime.withConditionalReward({
      consume:()=>cooking?.consumeFeySight?.()||0,restore:stacks=>cooking?.grantFeySight?.(stacks),
      grant:()=>window.BoneyShinjimiRewards?.grant?.(kind,rewardDeps),
      accept:prize=>!!prize&&(kind!=='milk'||(prize.kind==='boundRelic'&&prize.origin==='Fey')),
    });
  }
  function offerMilk(held, giftingDeps) {
    if (!canAcceptMilkGift(held, giftingDeps)) return false;
    const milkKey = held.key; // Captures the offered stack while the asynchronously presented dialogue is open.
    const count = state.milksGiven; // Selects first, second, or third dialogue without changing the limit early.
    const encounterGeneration = generation; // Invalidates stale dialogue continuations after world reload, house teardown or encounter replacement.
    const dialogueScene=encounterScene; // A scene swap can precede the next scheduled teardown.
    let handled = false; // A double Continue or an unsuccessful grant cannot retry the same milk handover mid-dialogue.
    sceneRunning = true; // Locks the action synchronously, before the cutscene promise yields.
    void (async () => {
      try {
        await window.AuthoredCutsceneRuntime.run(milkSceneDefinition(count), {
          onDialogueContinue(stage) {
            if (stage?.id !== 'milk_reward' || handled || generation !== encounterGeneration || state.phase !== 'leaving'
              || state.milksGiven !== count || !ownsActiveScene() || dialogueScene!==encounterScene
              || !insideHome(playerTile(), 0.1) || (Number(giftingDeps.inventory?.[milkKey]) || 0) <= 0) return;
            handled = true;
            const previousMilk = Number(giftingDeps.inventory[milkKey]); // Rollback value if the Fey weapon could not be granted.
            giftingDeps.inventory[milkKey] = previousMilk - 1;
            state.milksGiven = count + 1; // HarlyaoRelics.grantBoundRelic saves immediately, so the first save must already include the exchanged milk and count.
            let prize = null;
            try {
              prize = grantFeyReward('milk', giftingDeps);
            } catch (err) {
              bumpEvent('Fey weapon grant failed: ' + (err?.message || err));
            }
            if (!prize || prize.kind !== 'boundRelic' || prize.origin !== 'Fey') {
              giftingDeps.inventory[milkKey] = previousMilk;
              state.milksGiven = count;
              giftingDeps.showToast?.('Boney could not find a Fey weapon to offer. Keep your milk.', false);
              bumpEvent('Milk offer unavailable; item and exchange count restored');
              return;
            }
            giftingDeps.clampInventoryStack?.(milkKey);
            giftingDeps.refreshItemScroll?.();
            giftingDeps.buildInventoryGrid?.();
            giftingDeps.buildEquipmentSlots?.();
            giftingDeps.refreshActionBar?.();
            bumpEvent('Milk exchanged for Fey weapon (' + state.milksGiven + '/' + MAX_MILK_GIFTS + ')');
            save(); // World encounter persistence follows the relic owner's already-consistent inventory save.
          },
        });
      } catch(err) {
        if(generation===encounterGeneration&&ownsActiveScene())bumpEvent('Milk dialogue interrupted: ' + (err?.message || err));
      } finally {
        if(generation===encounterGeneration){sceneRunning = false;giftingDeps.refreshActionBar?.();} // A stale cutscene cannot unlock a newer dialogue.
      }
    })();
    return true; // The existing gift dispatcher is synchronous; the cutscene owns the actual handover.
  }
  async function enterScene() {
    if(sceneRunning||state.phase!=='home'||!ownsActiveScene()||!window.AuthoredCutsceneRuntime?.run)return;
    sceneRunning=true;state.phase='scene';
    const encounterGeneration=generation; // Restore/area unload must invalidate old choice callbacks just like milk callbacks.
    const dialogueScene=encounterScene; // Compare live scene identity even before the update loop runs.
    let granted=false; // Reward must be granted once upon continuing the chosen response, not when the choice menu merely opens.
    const rewards={valuable_grant:'valuable',useful_grant:'useful',apologize_grant:'apologize',hat_sure:'hat'};
    try {
      await window.AuthoredCutsceneRuntime.run(sceneDefinition(),{
        onDialogueContinue(stage) {
          const kind=rewards[stage?.id];
          if(!kind||granted||generation!==encounterGeneration||state.phase!=='scene'||!ownsActiveScene()||dialogueScene!==encounterScene)return;
          const prize=grantFeyReward(kind,deps);
          if(!prize){bumpEvent('Reward not available; encounter remains retriable');return;}
          granted=true;state.reward=prize;state.hatTaken=kind==='hat';
          if(state.hatTaken&&walker?.rec) {
            walker.rec.equippedCosmetics=walker.rec.equippedCosmetics.filter(id=>id!==HAT_ID);
            void window.NpcWardrobe?.refreshWalkerAppearance?.(walker);
          }
          save(); // Item grant and logical reward use the existing member/world save seam.
        },
      });
      if(generation!==encounterGeneration)return;
      state.phase=granted?'leaving':'home';
      if(granted)bumpEvent('Reward claimed; house vanishes when the player leaves');
    }catch(err) {
      if(generation===encounterGeneration){state.phase=granted?'leaving':'home';bumpEvent('Cutscene interrupted: '+(err?.message||err));}
    }finally{if(generation===encounterGeneration)sceneRunning=false;}
  }
  function finishEncounter() {
    if(state.phase!=='leaving'||!state.home)return;
    const p=playerTile();
    if(area()===state.zone&&insideHome(p,-0.20))return; // Vanish just beyond the house threshold, not several tiles down the trail.
    state.completedCycle=state.cycle;
    state.phase='complete';
    clearHouse();releaseWalker();
    state.home=null;state.target=null;state.zone=null;
    bumpEvent('Magic house vanished; encounter complete until next full moon');
    save();
  }
  function syncZone() {
    const active=area()===state.zone;
    const scene=active?activeScene():null; // Both pending and materialized objects belong to this scene.
    if(encounterScene!==scene){
      if(houseMesh||houseBuild.busy)clearHouse();
      if(walker||walkerBuild.busy)releaseWalker();
      encounterScene=scene;feyApproachClock.reset();
      ensureCollision();
    }
    if(!active||!scene) {
      if(houseMesh||houseBuild.busy){clearHouse();ensureCollision();}
      if(walker||walkerBuild.busy)releaseWalker(); // Pending builders must be invalidated even before their first mesh is attached.
      feyApproachClock.reset();
      return;
    }
    if(!state.home)return;
    ensureCollision();
    if(!houseMesh&&!houseBuild.busy)void ensureHouse();
    if(!walker&&!walkerBuild.busy)void ensureWalker();
    updateHouseVisibility();
  }
  function tryFeyApproach(dt) {
    if (state.phase !== 'roam' || !walker || area() !== state.zone || !(deps.player?.health>0) || window.PlayerDowned?.isDowned?.()) { feyApproachClock.reset(); return; }
    if(!feyApproachClock.advance(dt))return;
    const player = playerTile(), current = position(); // Only move a distant, unobserved wanderer, never interrupt a chase.
    if (!player || !current || dist(current, player) < SIGHT_TILES * 2) return; // Already outside mutual sight; avoid a redundant LOS query.
    const chance = window.CookingSystem?.feyEncounterChance?.(0.005) ?? 0.005; // Tunable baseline: one half-percent per eligible interval.
    if (rnd() >= chance) return;
    const h = homeCenter();
    const routes=runtime.createRouteBudget(4); // Shared duplicate rejection and A* ceiling per approach roll.
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = rnd() * Math.PI * 2, radius = 7 + rnd() * 2;
      const c = Math.floor(player.x + Math.cos(angle) * radius), r = Math.floor(player.z + Math.sin(angle) * radius);
      if(!routes.visit(c,r))continue;
      if (!validTile(c, r) || !h || dist({x:c+.5,z:r+.5},h) < 4) continue;
      if (window.NpcPathfinding?.isNpcPositionWalkable?.(state.zone,c+.5,r+.5) === false) continue; // Reject narrow prop and furniture collisions too.
      if(!routes.reachable(
        ()=>window.NpcPathfinding?.canNpcBeeline?.(state.zone,c+.5,r+.5,state.home.c+1,state.home.r+3),
        ()=>window.NpcPathfinding?.findNpcPath?.(state.zone,c+.5,r+.5,state.home.c+1,state.home.r+3)))continue;
      releaseWalker(); // The existing async walker constructor places the new avatar on a validated surface.
      state.target={c,r}; state.activity='wander'; state.resourceTarget=null; state.workLeft=0;
      planTimer=0; scanTimer=SCAN_SECONDS; // Give the newly arrived walker its ordinary chase check before choosing a new chore.
      void ensureWalker();
      bumpEvent('Fey encounter: Boney materialized near the player');
      return;
    }
  }

  function update(dt) {
    if(!deps||window.__hobunjiGameStarted!==true)return;
    dt=clamp(finite(dt),0,0.1);
    newMoonEncounter();
    ensureSite();
    if(state.phase==='waiting'||state.phase==='complete'||state.phase==='planned')return;
    syncZone();
    if(state.phase==='leaving') {if(!sceneRunning)finishEncounter();return;} // Never despawn the house during milk dialogue.
    if(area()!==state.zone||!walker)return;
    if(state.phase==='scene')return;
    tryFeyApproach(dt);
    if (!walker) return;
    contactBoost(dt);
    scanTimer+=dt;
    if(scanTimer>=SCAN_SECONDS) {
      scanTimer=0;
      if(state.phase==='roam'&&visiblePlayer())beginFlight();
      else if(state.phase==='roam') {
        const other=nearbyOtherNpc();
        if(other&&planTimer>=1.2) { // Avoidance route replans must not perform dozens of NPC path searches every 240 ms while another NPC stays nearby.
          planTimer=0;
          pickChore(other); // Already normalized to tile coordinates for either a resident NPC or a bandit/barbarian.
        }
      }
    }
    if(state.phase==='flee')updateFlee(dt);
    else if(state.phase==='roam') {
      planTimer+=dt;
      if(!state.target||planTimer>18) {
        planTimer=0;pickChore();
      }else if(nearTarget(1.2)) {
        state.workLeft-=dt;
        if(state.workLeft<=0){
          if(state.resourceTarget&&window.ZoneRegrowth?.npcCompleteResourceWork?.(state.zone,state.resourceTarget))state.chores++;
          state.resourceTarget=null;pickChore();
        }
      }
    }else if(state.phase==='home') {
      setTarget(state.home.c+1,state.home.r+1,'hide');
      if(insideHome(playerTile(),0.3)&&insideHome(position()&&{x:position().x,z:position().z},0.2))
        void enterScene();
    }
    updateHouseVisibility();
    if(new URLSearchParams(window.location?.search||'').has('boneyDebug'))paintDebug();
  }
  function paintDebug() {
    if(!window.document?.body)return;
    debugTimer++;
    if(debugTimer%24!==0)return; // Avoid reflowing diagnostics every gameplay frame.
    if(!debugElement) {
      debugElement=document.createElement('pre');
      debugElement.id='boneyShinjimiDebug';
      debugElement.style.cssText='position:fixed;top:8px;right:8px;max-width:72vw;z-index:100000;background:#15191de0;color:#fff;border:1px solid #abc;padding:8px;font:11px/1.4 monospace;white-space:pre-wrap;pointer-events:none';
      document.body.appendChild(debugElement);
    }
    const d=debugSnapshot();
    debugElement.textContent='Boney Shinjimi\n'+d.phase+' / moon '+d.cycle+'\n'+(d.zone||'no zone')
      +' '+JSON.stringify(d.home)+'\nLOS '+d.lastSight+'\n'+d.lastEvent+'\n'
      +'house '+d.houseVisible+'/'+d.collision+' NPC '+d.walker+' boosts '+d.catches+' milk '+d.milksGiven+'/'+MAX_MILK_GIFTS;
  }
  function serialize() {
    return {version:SAVE_VERSION,phase:state.phase==='scene'?(state.reward?'leaving':'home'):state.phase, // Persist reward-claimed cutscenes as departure, never as retriable gift prompts.
      cycle:state.cycle,completedCycle:state.completedCycle,zone:state.zone,
      home:state.home&&{...state.home},target:state.target&&{...state.target},
      activity:state.activity,resourceTarget:state.resourceTarget,workLeft:state.workLeft,chores:state.chores,
      escaped:state.escaped,catches:state.catches,weaponContacts:state.weaponContacts,
      reward:state.reward,hatTaken:state.hatTaken,milksGiven:state.milksGiven};
  }
  function restore(raw) {
    clearHouse();releaseWalker();encounterScene=null;
    feyApproachClock.reset();sceneRunning=false;
    Object.assign(state,initialState());
    if(raw?.version!==SAVE_VERSION)return;
    state.cycle=Number.isInteger(raw.cycle)?raw.cycle:-1;
    state.completedCycle=Number.isInteger(raw.completedCycle)?raw.completedCycle:-1;
    state.zone=zoneEligible(raw.zone)?raw.zone:null;
    const goodCoord=p=>Number.isInteger(p?.c)&&Number.isInteger(p?.r);
    state.home=goodCoord(raw.home)?{c:raw.home.c,r:raw.home.r,
      sector:SECTORS.some(row=>row.includes(raw.home.sector))?raw.home.sector:null}:null; // Older saves without sector use the loaded layout if available.
    state.target=goodCoord(raw.target)?{c:raw.target.c,r:raw.target.r}:null;
    state.phase=['planned','roam','flee','home','leaving','complete'].includes(raw.phase)?raw.phase:'waiting';
    if(!state.zone||!state.home&&state.phase!=='planned')state.phase='waiting';
    state.activity=['tree','rock','wander','flee','hide'].includes(raw.activity)?raw.activity:'wander';
    state.workLeft=clamp(finite(raw.workLeft),0,30);
    const t=raw.resourceTarget; // A resumed chore must still point at the same authored tree/rock tile.
    state.resourceTarget=Number.isInteger(t?.col)&&Number.isInteger(t?.row)&&['tree','rock'].includes(t?.kind)
      ?{col:t.col,row:t.row,kind:t.kind}:null;
    state.chores=Math.max(0,Math.floor(finite(raw.chores)));
    state.escaped=Math.max(0,Math.floor(finite(raw.escaped)));
    state.catches=Math.max(0,Math.floor(finite(raw.catches)));
    state.weaponContacts=Math.max(0,Math.floor(finite(raw.weaponContacts)));
    state.reward=raw.reward||null;state.hatTaken=raw.hatTaken===true;
    state.milksGiven=clamp(Math.floor(finite(raw.milksGiven)),0,MAX_MILK_GIFTS); // Older saves default to zero milk gifts.
    if(state.reward && state.phase==='home') state.phase='leaving'; // Legacy/interrupted cutscene saves with an already-granted prize must never duplicate rewards.
    if(state.phase==='flee') {
      state.target={c:state.home.c+1,r:state.home.r+3}; // Interrupted chase resumes toward the real house.
    }
    ensureCollision();
    bumpEvent('Restored moonlit encounter from existing world save');
  }
  function debugSnapshot() {
    return {phase:state.phase,cycle:state.cycle,completedCycle:state.completedCycle,
      zone:state.zone,home:state.home,target:state.target,activity:state.activity,
      lastSight:state.lastSight,lastEvent:state.lastEvent,houseVisible:!!houseMesh?.visible,
      collision:!!houseUnregister,walker:!!walker,catches:state.catches,
      weaponContacts:state.weaponContacts,escaped:state.escaped,
      chores:state.chores,reward:state.reward,hatTaken:state.hatTaken,milksGiven:state.milksGiven};
  }
  function registerSpoilerPanel() {
    window.DevCompanion?.registerCheatPanel?.({ // Already gated to an active game with Dev Mode enabled.
      id:'boney-shinjimi-house-spoilers',title:'🌕 Boney Shinjimi’s house',order:41,
      render:()=>{
        const sector=state.home?(houseSector(state.home,layout())||state.home.sector):null;
        const zoneLabel=state.zone
          ? (deps?.EXTERIOR_ZONES?.[state.zone]?.label || ({
              map_northern_cliffs:'Northern Cliffs',map_western_slope:'Western Slope',
              map_eastern_mire:'Eastern Mire',map_southern_cloud_forest:'Southern Cloud Forest',
            })[state.zone] || state.zone)
          : 'Not selected';
        return {
          summary:spoilersRevealed?'Location revealed':'Location hidden',
          rows:spoilersRevealed?[
            ['Encounter',state.phase],
            ['Zone',zoneLabel],
            ['Sector',sector || (state.phase==='planned'?'Pending house placement':'Not available')],
          ]:[],
          note:spoilersRevealed
            ? (state.phase==='planned'
              ? 'The zone is selected; its nine-sector location is not known until the terrain supports a 3×3 house.'
              : !state.zone
                ? 'No current house. A new zone is selected on lunar day 14 when the next encounter is eligible.'
                : 'Sector is the house centre within a 3×3 compass grid of the whole wilderness zone.')
            : 'Press Show spoilers to reveal the house’s current zone and sector.',
          actions:[{id:'toggle',label:spoilersRevealed?'🙈 Hide spoilers':'👁 Show spoilers',active:spoilersRevealed}],
        };
      },
      onAction:action=>{
        if(action!=='toggle')return {ok:false,error:'Unknown Boney spoiler action.'};
        spoilersRevealed=!spoilersRevealed;
        return {ok:true}; // Read-only: never rolls a site, reveals the world map, or touches the save.
      },
    });
  }
  function init(injectedDeps) {
    deps=injectedDeps;scanTimer=0;planTimer=0;spoilersRevealed=false;
    window.NpcScheduling?.registerTargetOverride?.('boney-shinjimi-moon',targetFor);
    window.DevCompanion?.registerStateProvider?.('boneyShinjimi',debugSnapshot);
    registerSpoilerPanel();
  }
  window.BoneyShinjimiWilderness=Object.freeze({
    init,update,serialize,restore,debugSnapshot,sceneDefinition,canAcceptMilkGift,offerMilk,
    __test:Object.freeze({lunarDay,moonCycle,chooseHouseSite,wallHit,targetFor,record,finishEncounter,beginFlight,nearbyOtherNpc,sightProxy}),
  });
})();
