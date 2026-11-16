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
  const HOUSE_FILE = 'config/pieces/house-section-3x3.json'; // Reuses an authored three-by-three Highland roof and wall assembly.
  const HAT_ID = 'appearance::hat::riverlandskasa_wide'; // Explicit temporary art stand-in for absent Old Highlands kasa.
  const SIGHT_TILES = 10; // LOS range; existing RangedWeapons rays handle trees, rocks, terrain and cover.
  const WORK_RADIUS_TILES = 13; // Keeps his chores in the neighboring chunks around the magical house.
  const FLEE_BOOST_SECONDS = 0.58; // Contact gives a strong but short burst, never an indefinite movement buff.
  const FLEE_BOOST_FACTOR = 2.7; // Boost affects his existing collision-aware walker route, not a direct teleport.
  const SCAN_SECONDS = 0.24; // Throttles bidirectional sight tests and population scans.
  const SAVE_VERSION = 1; // Compatible additive field inside SlagothimTraders' existing saved record.
  let deps = null; // SlagothimTraders' existing injected, game-owned NPC, calendar, inventory and map adapters.
  let walker = null; // The one materialized NPC in the active exterior zone.
  let walkerBuilding = false; // Prevents asynchronous duplicate walker construction.
  let houseMesh = null; // Loaded Highland piece; renderer visibility is separate from collisions.
  let houseScene = null; // Tracks the scene that owns the piece when zones are streamed/recreated.
  let houseBuilding = false; // Prevents repeated fetches during an in-flight build.
  let houseUnregister = null; // Shared hard-wall collision registration, active even when invisible.
  let generation = 0; // Invalidates pending asynchronous builders after map/world/encounter changes.
  let scanTimer = 0; // LOS and NPC scans are not repeated every animation frame.
  let planTimer = 0; // Chore route choices are throttled separately from body updates.
  let debugTimer = 0; // Mobile in-page diagnostics repaint at most twice per second.
  let debugElement = null; // Only created when ?boneyDebug=1 is requested.
  let sceneRunning = false; // Prevents overlapping choice cutscenes.
  const state = initialState(); // Saved moon cycle, location, phase, rewards and chase/chores counters.

  function initialState() {
    return { phase:'waiting', cycle:-1, completedCycle:-1, zone:null, home:null, target:null,
      activity:'wander', workLeft:0, fleeTime:0, boostedFor:0, boostCooldown:0,
      catches:0, escaped:0, chores:0, lastSight:'unobserved', lastEvent:'awaiting full moon',
      reward:null, hatTaken:false };
  }
  function rnd() { return window.GameRandom?.random?.() ?? Math.random(); }
  function finite(value, fallback=0) { const n=Number(value); return Number.isFinite(n) ? n : fallback; }
  function clamp(n,a,b) { return Math.max(a,Math.min(b,n)); }
  function area() { return String(deps?.getCurrentArea?.() || ''); }
  function tileSize() { return Math.max(1, finite(deps?.TILE,64)); }
  function layout() { return state.zone ? deps?.getZoneLayout?.(state.zone) : null; }
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
      let clear=true;
      for(let dr=-1;dr<=3&&clear;dr++) for(let dc=-1;dc<=3;dc++) {
        if(!validTile(c+dc,r+dr,zone)){clear=false;break;}
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
    state.home=null;state.target=null;state.reward=null;state.hatTaken=false;
    bumpEvent('Full moon: magic home planned in '+state.zone);save();
  }
  function ensureSite() {
    if(state.phase!=='planned'||!state.zone)return;
    const site=chooseHouseSite(state.zone,state.cycle);
    if(!site)return;
    state.home=site;
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
    houseMesh=null;houseScene=null;houseBuilding=false;
    houseUnregister?.();houseUnregister=null;
  }
  function releaseWalker() {
    generation++;
    if(walker) {
      const old=walker;walker=null;
      if(!deps?.despawnNpcWalker?.(old)) old.root?.parent?.remove?.(old.root);
    }
    walkerBuilding=false;
  }
  async function ensureHouse() {
    const scene=window.GridTileAccessors?.getActiveScene?.();
    if(!state.home||area()!==state.zone||!scene||houseBuilding)return;
    if(houseMesh&&scene===houseScene)return;
    if(houseMesh?.parent)houseMesh.parent.remove(houseMesh);
    houseMesh=null;houseScene=null;
    if(!window.HousePieceGen?.buildGroupFromPiece||!window.THREE)return;
    houseBuilding=true;
    const serial=generation;
    try {
      const response=await fetch(HOUSE_FILE);
      if(!response.ok)throw new Error('HTTP '+response.status+' for Highland house piece');
      const piece=await response.json();
      const base=piece.currentPiece||piece;
      if(!Array.isArray(base.footprint?.cells)||base.footprint.cells.length!==9)
        throw new Error('Highland 3x3 footprint no longer matches its authored asset');
      const authored={...base,footprint:{...base.footprint,door:{x:8,y:9}}}; // A south-facing door added to a clone, never to the authored source.
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
      bumpEvent('House geometry unavailable: '+(err?.message||err)); // Mobile diagnostics: no silent cube substitute.
    } finally {houseBuilding=false;}
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
    if(walker||walkerBuilding||!deps?.makeNpcWalker||!state.home||area()!==state.zone)return;
    walkerBuilding=true;
    const serial=generation,spot=state.target||{c:state.home.c+1,r:state.home.r+3};
    try {
      const w=await deps.makeNpcWalker(record(),{area:state.zone,c:spot.c,r:spot.r});
      if(!w)return;
      if(serial!==generation||area()!==state.zone||!state.home||state.phase==='complete'||state.phase==='waiting') {
        deps?.despawnNpcWalker?.(w);return;
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
    }catch(err){bumpEvent('NPC build failed: '+(err?.message||err));}
    finally{walkerBuilding=false;}
  }
  function sightProxy(w) {
    return {x:w.root.position.x*tileSize(),y:w.root.position.z*tileSize(),
      root:w.root,avatarGroup:w.avatarGroup,health:1,areaId:state.zone,walker:w};
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
    let closest=null,range=8;
    const here={x:walker.root.position.x,z:walker.root.position.z};
    for(const other of (deps?.npcWalkers||[])) {
      if(!other?.root||other===walker||other.area!==state.zone||other.animalKind||other.rec?.kind==='animal')continue;
      const d=dist(here,{x:other.root.position.x,z:other.root.position.z});
      if(d<range){closest=other;range=d;}
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
    const h=homeCenter(),p=position(),map=layout();
    if(!h||!p||!map)return;
    let result=null,best=-Infinity;
    for(let attempt=0;attempt<50;attempt++) {
      const angle=rnd()*Math.PI*2,rad=3+rnd()*WORK_RADIUS_TILES;
      const c=Math.floor(h.x+Math.cos(angle)*rad),r=Math.floor(h.z+Math.sin(angle)*rad);
      if(!candidateRoute(c,r)||Math.abs(c-state.home.c)<4&&Math.abs(r-state.home.r)<4)continue;
      const tile=map.tiles?.[r*map.cols+c]||map.tiles?.[r]?.[c]||null;
      const tag=String(tile?.type||tile?.feature||tile?.kind||'').toLowerCase();
      const work=/rock|ore|stone|boulder/.test(tag)?'rock':'tree';
      const separation=avoid?dist({x:c,z:r},avoid):5;
      const score=Math.min(separation,10)-0.06*dist({x:c,z:r},{x:p.x,z:p.z})+rnd();
      if(score>best){best=score;result={c,r,work};}
    }
    if(result) {
      state.workLeft=2.5+rnd()*6.5;
      setTarget(result.c,result.r,result.work);
      bumpEvent('Working near '+result.c+','+result.r+' ('+result.work+')');
    }
  }
  function beginFlight() {
    if(state.phase==='flee'||!walker)return;
    state.phase='flee';state.fleeTime=0;state.workLeft=0;state.escaped++;
    setTarget(state.home.c+1,state.home.r+3,'flee');
    bumpEvent('Spotted player; sprinting home and breaking line of sight');
  }
  function escapeAroundCover() {
    const p=position(),home=homeCenter(),player=playerTile();
    if(!p||!home||!player)return;
    let best=null,bestScore=-Infinity;
    const observer=sightProxy(walker);
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
      const score=(currentHome-dx)*1.8+Math.min(dp,10)*0.28+turn*0.42+rnd()*0.3;
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
      setTarget(state.home.c+1,state.home.r+3,'flee'); // Approach south door before routing inside.
      if(dist(p,{x:state.home.c+1.5,z:state.home.r+3.5})<1.1)
        setTarget(state.home.c+1,state.home.r+1,'flee');
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
  function contactBoost(dt) {
    const p=playerTile(),w=position();
    state.boostedFor=Math.max(0,state.boostedFor-dt);
    state.boostCooldown=Math.max(0,state.boostCooldown-dt);
    if(!p||!w||state.boostCooldown>0||state.phase==='scene'||state.phase==='leaving')return;
    if(dist(p,{x:w.x,z:w.z})>0.80)return; // Player body hitbox overlap, including when the fleeing NPC runs past.
    state.boostedFor=FLEE_BOOST_SECONDS;state.boostCooldown=0.9;
    state.catches++;
    if(state.phase==='roam')beginFlight();
    bumpEvent('Contact: Boney lunged away with a momentary speed boost');
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
  async function enterScene() {
    if(sceneRunning||state.phase!=='home'||!window.AuthoredCutsceneRuntime?.run)return;
    sceneRunning=true;state.phase='scene';
    let granted=false; // Reward must be granted once upon continuing the chosen response, not when the choice menu merely opens.
    const rewards={valuable_grant:'valuable',useful_grant:'useful',apologize_grant:'apologize',hat_sure:'hat'};
    try {
      await window.AuthoredCutsceneRuntime.run(sceneDefinition(),{
        onDialogueContinue(stage) {
          const kind=rewards[stage?.id];
          if(!kind||granted)return;
          const prize=window.BoneyShinjimiRewards?.grant?.(kind,deps);
          if(!prize){bumpEvent('Reward not available; encounter remains retriable');return;}
          granted=true;state.reward=prize;state.hatTaken=kind==='hat';
          if(state.hatTaken&&walker?.rec) {
            walker.rec.equippedCosmetics=walker.rec.equippedCosmetics.filter(id=>id!==HAT_ID);
            void window.NpcWardrobe?.refreshWalkerAppearance?.(walker);
          }
          save(); // Item grant and logical reward use the existing member/world save seam.
        },
      });
      state.phase=granted?'leaving':'home';
      if(granted)bumpEvent('Reward claimed; house vanishes when the player leaves');
    }catch(err) {
      state.phase=granted?'leaving':'home';
      bumpEvent('Cutscene interrupted: '+(err?.message||err));
    }finally{sceneRunning=false;}
  }
  function finishEncounter() {
    if(state.phase!=='leaving'||!state.home)return;
    const p=playerTile();
    if(area()===state.zone&&insideHome(p,-0.4))return;
    if(area()===state.zone&&p&&dist(p,homeCenter())<3.5)return;
    state.completedCycle=state.cycle;
    state.phase='complete';
    clearHouse();releaseWalker();
    state.home=null;state.target=null;state.zone=null;
    bumpEvent('Magic house vanished; encounter complete until next full moon');
    save();
  }
  function syncZone() {
    const active=area()===state.zone;
    if(!active) {
      if(houseMesh){clearHouse();ensureCollision();}
      if(walker)releaseWalker();
      return;
    }
    if(!state.home)return;
    ensureCollision();
    if(!houseMesh&&!houseBuilding)void ensureHouse();
    if(!walker&&!walkerBuilding)void ensureWalker();
    updateHouseVisibility();
  }
  function update(dt) {
    if(!deps||window.__hobunjiGameStarted!==true)return;
    dt=clamp(finite(dt),0,0.1);
    newMoonEncounter();
    ensureSite();
    if(state.phase==='waiting'||state.phase==='complete'||state.phase==='planned')return;
    syncZone();
    if(area()!==state.zone||!walker)return;
    if(state.phase==='leaving') {finishEncounter();return;}
    if(state.phase==='scene')return;
    contactBoost(dt);
    scanTimer+=dt;
    if(scanTimer>=SCAN_SECONDS) {
      scanTimer=0;
      if(state.phase==='roam'&&visiblePlayer())beginFlight();
      else if(state.phase==='roam') {
        const other=nearbyOtherNpc();
        if(other)pickChore({x:other.root.position.x,z:other.root.position.z});
      }
    }
    if(state.phase==='flee')updateFlee(dt);
    else if(state.phase==='roam') {
      planTimer+=dt;
      if(!state.target||planTimer>18) {
        planTimer=0;pickChore();
      }else if(nearTarget(1.2)) {
        state.workLeft-=dt;
        if(state.workLeft<=0){state.chores++;pickChore();}
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
      +'house '+d.houseVisible+'/'+d.collision+' NPC '+d.walker+' boosts '+d.catches;
  }
  function serialize() {
    return {version:SAVE_VERSION,phase:state.phase==='scene'?'home':state.phase,
      cycle:state.cycle,completedCycle:state.completedCycle,zone:state.zone,
      home:state.home&&{...state.home},target:state.target&&{...state.target},
      activity:state.activity,workLeft:state.workLeft,chores:state.chores,
      escaped:state.escaped,catches:state.catches,reward:state.reward,hatTaken:state.hatTaken};
  }
  function restore(raw) {
    clearHouse();releaseWalker();
    Object.assign(state,initialState());
    if(raw?.version!==SAVE_VERSION)return;
    state.cycle=Number.isInteger(raw.cycle)?raw.cycle:-1;
    state.completedCycle=Number.isInteger(raw.completedCycle)?raw.completedCycle:-1;
    state.zone=zoneEligible(raw.zone)?raw.zone:null;
    const goodCoord=p=>Number.isInteger(p?.c)&&Number.isInteger(p?.r);
    state.home=goodCoord(raw.home)?{c:raw.home.c,r:raw.home.r}:null;
    state.target=goodCoord(raw.target)?{c:raw.target.c,r:raw.target.r}:null;
    state.phase=['planned','roam','flee','home','leaving','complete'].includes(raw.phase)?raw.phase:'waiting';
    if(!state.zone||!state.home&&state.phase!=='planned')state.phase='waiting';
    state.activity=['tree','rock','wander','flee','hide'].includes(raw.activity)?raw.activity:'wander';
    state.workLeft=clamp(finite(raw.workLeft),0,30);
    state.chores=Math.max(0,Math.floor(finite(raw.chores)));
    state.escaped=Math.max(0,Math.floor(finite(raw.escaped)));
    state.catches=Math.max(0,Math.floor(finite(raw.catches)));
    state.reward=raw.reward||null;state.hatTaken=raw.hatTaken===true;
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
      collision:!!houseUnregister,walker:!!walker,catches:state.catches,escaped:state.escaped,
      chores:state.chores,reward:state.reward,hatTaken:state.hatTaken};
  }
  function init(injectedDeps) {
    deps=injectedDeps;scanTimer=0;planTimer=0;
    window.NpcScheduling?.registerTargetOverride?.('boney-shinjimi-moon',targetFor);
    window.DevCompanion?.registerStateProvider?.('boneyShinjimi',debugSnapshot);
  }
  window.BoneyShinjimiWilderness=Object.freeze({
    init,update,serialize,restore,debugSnapshot,sceneDefinition,
    __test:Object.freeze({lunarDay,moonCycle,chooseHouseSite,wallHit,targetFor,record,finishEncounter,beginFlight}),
  });
})();
