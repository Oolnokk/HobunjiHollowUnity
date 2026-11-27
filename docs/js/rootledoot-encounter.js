// Rootledoot fey locales. Only the current chunk can materialize a bait root;
// ordinary terrain and inactive locales require no meshes, NPCs or frame scans.
(() => {
  'use strict';
  const ZONES = new Set(['map_northern_cliffs','map_southern_cloud_forest']); // Only these wilderness zones contain Rootledoot sites.
  const BASE_CHANCE = 0.005; // Per eligible chunk per in-game day; tune without touching spawn/AI.
  const CHECK_SECONDS = 0.5; // Dormant work is throttled; active wave completion uses owned actors only.
  const WAVE_DELAY = 1.5; // Breathing room between waves.
  const WAVES = Object.freeze([['grunt','grunt'],['grunt','lieutenant','grunt'],['captain']]); // Final wave has exactly one Big Rootledoot.
  const ROOT_COLOR = '#AAA07C'; // Sampled ingredient color shared by ordinary Heftroot and extremities.
  const ROOT_ASSET = 'assets/objectsprites/heftroot.png'; // Same sprite as the farm's ready crop.
  const ROOT_SCALE = .5625 * .68 * .96; // Farm billboard × per-plant cluster scale × mature crop scale.
  const runtime=window.WildernessEncounterRuntime; // Shared terrain, scheduling, reward and portrait helpers.
  let deps = null; // Narrow game-owned adapters; no independent AI, combat or save loop.
  let active = null; // The one live locale, from bait through reward; each has its own async generation identity.
  let lastZone=null; // Reset partial decision time on direct exterior transitions too.
  const clock=runtime.createInterval(CHECK_SECONDS); // Throttles only this encounter's own decisions.
  const journal=runtime.createJournal({getStamp:stamp,validReward:reward=>ZONES.has(reward?.zone)&&Number.isInteger(reward.site?.c)&&Number.isInteger(reward.site?.r)&&
    Number.isFinite(reward.height)&&reward.height>0&&reward.armament?.origin==='Fey'&&typeof reward.armament?.key==='string'});
  const {ledger,pendingRewards}=journal; // Preserve the existing on-disk ledger and pending-reward format.
  const loadArt=runtime.createSpriteSource(ROOT_ASSET); // Shared alpha crop, cached lazily for the root source.
  const rootTextures = new Map(); // One full authored farm image and one cropped boss image, shared by all locales.
  const defeat=runtime.createDefeatTracker(attacker=>!!(active?.phase==='combat'&&attacker?.rootledoot&&active.actors.has(attacker))); // Only this locale's attackers contribute to its defeat.
  let lastEvent = 'idle'; // In-game diagnostic snapshot and mobile farm log.

  const rand = () => deps?.rnd?.() ?? Math.random();
  function log(msg) { lastEvent=msg; window.__farmLog?.('[rootledoot] '+msg,'info'); }
  function init(injected) { if(deps)reset('reinitialized'); deps=injected; clock.reset(); }
  function area() { return deps?.getArea?.(); }
  function ownsScene(rec) { return active===rec&&runtime.sceneMatches(rec,area(),deps.getScene?.()); } // Scene identity also detects a same-zone rebuild.
  function stamp() { return String(deps?.worldId?.() || '')+':'+String(deps?.cycle?.() ?? 0); }
  function chunkSize() { return Math.max(4,Math.floor(Number(deps?.chunkSize?.())||16)); }
  function chunkOf(c,r) { return runtime.chunkOf(c,r,chunkSize()); }
  function keyFor(zone,c,r) { return zone+':'+c+','+r; }
  function sameChunk(x,y,chunk) { return runtime.sameChunk(x,y,chunk,chunkSize()); }
  function playerTile(p=deps.player) { return {c:Math.floor(p.x/deps.TILE),r:Math.floor(p.y/deps.TILE)}; }
  // Participants: every player in this zone (the local avatar always counts; a remote one only when ActorRegistry
  // places it here). Single-player: exactly [deps.player], so every check below reduces to the old local-player test.
  function playersHere() {
    const reg=window.ActorRegistry;
    if(!reg||reg.playerCount()<2)return [deps.player];
    const zone=area();
    return reg.getPlayers().filter(p=>p===deps.player||reg.areaOf(p)===zone);
  }
  function downed(p) { return p===deps.player?window.PlayerDowned?.isDowned?.()===true:p._downed===true; }
  function standing(p) { return p.health>0&&!downed(p); }
  function allDown() { return playersHere().every(downed); }
  function anyInChunk(chunk) { return playersHere().some(p=>sameChunk(p.x/deps.TILE,p.y/deps.TILE,chunk)); } // Presence, not health: matches the old dormancy rule.
  function anyStandingInChunk(chunk) { return playersHere().some(p=>standing(p)&&sameChunk(p.x/deps.TILE,p.y/deps.TILE,chunk)); }
  function tileAt(c,r) { return deps?.getGrid?.()?.[r]?.[c]; }
  function tileEligible(c,r,terrainOnly=false) {
    const tile=tileAt(c,r);
    if(!tile||tile.mapBoundary||tile.incline||tile.water>0||!deps.walkable(c,r))return false;
    return !terrainOnly||deps.isBareGround(tile);
  }
  function flatFootprint(c,r) {
    return runtime.flatFootprint(c,r,{tileAt,eligible:(x,y)=>tileEligible(x,y,true)});
  }
  function siteInChunk(zone,chunk) {
    const grid=deps.getGrid();
    return runtime.siteInChunk({chunk,size:chunkSize(),cols:grid?.[0]?.length||0,rows:grid?.length||0,
      seed:journal.stamp+':'+keyFor(zone,chunk.c,chunk.r),eligible:flatFootprint});
  }
  function npcInChunk(zone,chunk) {
    for(const p of runtime.peopleInArea({zone,walkers:deps.getNpcWalkers?.(),actors:[deps.hostiles,deps.companions],tileSize:deps.TILE,exclude:c=>!!c.rootledoot})){
      if(sameChunk(p.x,p.z,chunk))return true;
    }
    return false;
  }
  async function paintPortrait(canvas,behind=false) {
    const {crop}=await loadArt();
    canvas.rootledootOpaqueHeightFraction=runtime.paintPortrait(canvas,crop,{mirror:behind}); // Boss reward uses actual visible height.
  }
  function removeRoot(rec) {
    if(!rec?.mesh)return;rec.mesh.parent?.remove(rec.mesh);rec.mesh.material?.dispose();rec.mesh=null;
  }
  async function showRoot(rec,large=false) {
    const {raw,crop}=await loadArt();
    if(!ownsScene(rec))return false;
    if(!large&&(deps.canActivate?.()===false||!anyInChunk(rec.chunk)||!flatFootprint(rec.site.c,rec.site.r)||npcInChunk(rec.zone,rec.chunk))){reset('bait suppressed during artwork load');return false;} // Recheck asynchronous activation without spending the successful daily roll.
    const THREE=window.THREE;if(!THREE)return false;
    const art=large?crop:raw; // The bait preserves the farm PNG's authored padding; only NPC portraits and the boss reward use the opaque crop.
    if(!rootTextures.has(art)){const texture=new THREE.CanvasTexture(art);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;if(THREE.sRGBEncoding!==undefined)texture.encoding=THREE.sRGBEncoding;rootTextures.set(art,texture);}
    removeRoot(rec);
    const root=new THREE.Sprite(new THREE.SpriteMaterial({map:rootTextures.get(art),transparent:true,alphaTest:.04,depthWrite:true}));
    const height=large?(rec.bossRootHeight||1.2):ROOT_SCALE;
    root.scale.set(height*art.width/art.height,height,1);
    // A centered sprite at soil level is half buried, like a ripe farm Heftroot.
    root.position.set(rec.site.c+.5,deps.surfaceY(rec.site.c+.5,rec.site.r+.5)+.01,rec.site.r+.5);
    root.userData.noOutline=true;root.name=large?'fey_heftroot_reward':'heftroot_bait';
    rec.scene.add(root);rec.mesh=root;return true;
  }
  function disposeActor(c) {
    const live = deps.hostiles.has(c) || deps.corpses?.has(c) || c.avatarRef?.group?.parent; // World teardown may already have disposed this actor.
    deps.hostiles.delete(c);deps.corpses?.delete(c);deps.companions?.delete(c);
    window.Combat?.cancelStagedForAttacker?.(c);window.Combat?.telegraph?.cancel?.(c);
    window.RangedWeapons?.cancelBanditAction?.(c);window.RangedWeapons?.retireOwnerProjectiles?.(c);window.BanditCombat?.cancelLunge?.(c);
    window.EnemyDodge?.cancel?.(c);window.Combat?.animalAttacks?.cancel?.(c);
    c.health=0;c._deathTransitionStarted=true;c._banditAction=null; // Prevent stale staged callbacks from treating a removed actor as alive.
    if(live)deps.despawn(c);
    window.BanditCaptainArmaments?.discard?.(c); // Release a unique weapon texture only after its holder has been disposed.
  }
  function reset(reason='reset') {
    const rec=active;active=null;defeat.reset();
    if(!rec)return;removeRoot(rec);
    for(const c of rec.actors)disposeActor(c);
    rec.actors.clear();if(rec.boss)window.BanditCaptainArmaments?.discard?.(rec.boss);
    log(reason);
  }
  function syncWorld() { journal.sync(()=>reset('world/shift changed')); }
  function activate(zone,chunk,site,key) {
    const scene=deps.getScene?.();if(!scene)return;
    const rec={zone,chunk,site,key,scene,phase:'bait',actors:new Set(),wave:0,delay:0,mesh:null,boss:null,building:false};
    active=rec;
    void showRoot(rec).then(ok=>{if(!ok&&active===rec)failBait(rec,'bait unavailable');}).catch(error=>{if(active===rec)failBait(rec,'bait failed: '+error.message);});
    log('bait activated at '+zone+' '+site.c+','+site.r);
  }
  function failBait(rec,reason){
    ledger.set(rec.key,{day:Math.floor(Number(deps.day?.())||0),cleared:false,ready:false}); // Missing art or invalidated terrain must not create a retry storm every half-second.
    reset(reason);
  }
  function tryActivate(who=deps.player) {
    const zone=area(),p=playerTile(who),chunk=chunkOf(p.c,p.r),key=keyFor(zone,chunk.c,chunk.r);
    const day=Math.floor(Number(deps.day?.())||0),previous=ledger.get(key);
    if(journal.blocked(key,day))return; // Failed/used daily rolls perform no NPC scans on later ticks.
    if(deps.canActivate?.()===false||npcInChunk(zone,chunk))return; // Check combat and population only after cheap daily ledger rejection.
    if(previous?.day===day){
      if(previous.ready){const site=siteInChunk(zone,chunk);if(site)activate(zone,chunk,site,key);else ledger.set(key,{day,cleared:false,ready:false});}
      return;
    }
    // Each eligible chunk rolls once per day, not every frame or every boundary crossing.
    ledger.set(key,{day,cleared:false});
    const chance=window.CookingSystem?.feyEncounterChance?.(BASE_CHANCE)??BASE_CHANCE;
    if(rand()>=chance)return;
    const site=siteInChunk(zone,chunk);if(site){ledger.set(key,{day,cleared:false,ready:true});activate(zone,chunk,site,key);}
  }
  function resumeReward(zone,chunk) {
    if(!pendingRewards.size)return false;
    for(const [key,saved] of pendingRewards) {
      if(saved.zone!==zone||!sameChunk(saved.site.c,saved.site.r,chunk)||!journal.canRetry(key))continue;
      if(deps.canActivate?.()===false)return false; // Avoid scanning combat for rewards in distant chunks.
      if(!tileEligible(saved.site.c,saved.site.r))continue; // Keep the reward data if the scene is not yet available.
      const scene=deps.getScene?.();if(!scene)return false;
      const rec={zone,chunk,site:{...saved.site},key,scene,phase:'reward',actors:new Set(),wave:WAVES.length,delay:0,mesh:null,
        boss:{_banditCaptainArmament:saved.armament},bossRootHeight:saved.height,building:false};
      active=rec;
      revealReward(rec);
      log('unclaimed boss harvest restored');
      return true;
    }
    return false;
  }
  function revealReward(rec) {
    const fail=reason=>{if(active===rec){journal.delayRetry(rec.key);reset(reason);}};
    void showRoot(rec,true).then(ok=>{if(!ok)fail('reward unavailable');else journal.clearRetry(rec.key);}).catch(error=>fail('reward failed: '+error.message));
  }
  function settleVictory(rec) {
    if(active!==rec||rec.phase!=='combat'||rec.actors.size||!rec.boss||rec.building||rec.wave<WAVES.length||allDown())return false;
    rec.phase='reward';
    pendingRewards.set(rec.key,{zone:rec.zone,site:{...rec.site},height:rec.bossRootHeight,armament:rec.boss._banditCaptainArmament});
    deps.save?.(); // Victory is a meaningful checkpoint; no per-tick save.
    revealReward(rec);
    return true;
  }
  function connectedSpawnTiles(rec) {
    const anchor=playersHere().find(q=>standing(q)&&sameChunk(q.x/deps.TILE,q.y/deps.TILE,rec.chunk))||deps.player; // The participant who is actually in the chunk anchors spawns.
    const p=playerTile(anchor),origin=sameChunk(p.c,p.r,rec.chunk)&&tileEligible(p.c,p.r)?p:rec.site;
    const elevation=Number(tileAt(origin.c,origin.r)?.elevTier)||0;
    return runtime.connectedSpawnTiles({origin,reference:p,contains:(c,r)=>sameChunk(c,r,rec.chunk),
      eligible:(c,r)=>tileEligible(c,r)&&(Number(tileAt(c,r)?.elevTier)||0)===elevation});
  }
  function ensureRig(){
    const profiles=window.HobunjiHandModelProfiles,feet=window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet;
    // Same primate extremities as Nohuknuk, but never his grey material override or sideways creature card.
    if(profiles?.mutate&&profiles.data?.speciesModels?.rootledoot!=='primate'){
      profiles.mutate(data=>{
        const donor=data.models?.sloth||data.models?.feline;
        if(!data.models.primate&&donor)data.models.primate={...JSON.parse(JSON.stringify(donor)),glb:'assets/models/hands/hand_primate.glb',materialRoles:{MAT_EyeSurface_0c0c0c:'body',MAT_None_7a4e2e:'bone'}};
        if(data.models.primate)data.speciesModels.rootledoot='primate';
      });
    }
    if(feet?.species&&!feet.species.rootledoot)feet.species.rootledoot={...(feet.species.nohuknuk||{glb:'assets/models/feet/foot_primate.glb',materialRoles:{MAT_EyeSurface_0c0c0c:'body',MAT_None_7a4e2e:'bone'},uvMode:'stretch-fit'})};
  }
  function makeCombatant(cfg,rank,tier,x,y,opts={}) {
    const big=rank==='captain',name=big?'Big Rootledoot':'Rootledoot'; // Shared by live waves and the Workshop.
    const roster={...opts.rosterOverride,name,appearance:{...opts.rosterOverride?.appearance,speciesId:'mao-ao',gender:'male',cosmetics:{},bodyColors:Object.fromEntries(['A','B','C'].map(k=>[k,{hex:ROOT_COLOR}]))},equippedCosmetics:[],cosmeticSlots:{},appliedDyes:{},rootledoot:true}; // Profile loader uses a known cosmetic species; the actual independent rig identity is rootledoot.
    const scale=big?1.35:rank==='lieutenant'?.82:.65;
    ensureRig(); // Spawn-only setup, shared by live waves and Workshop.
    return window.BanditCombat.makeEntity({...cfg,_rootledootWeaponPool:true},rank,tier,x,y,{...opts,enemyClass:'rootledoot',rosterOverride:roster,preserveRoster:true,
      avatarRigScale:opts.avatarRigScale||{x:scale,y:scale,head:1,offsetY:0},defOverride:{label:name,...opts.defOverride,rangedWeaponKey:null},
      extra:{...opts.extra,rootledoot:true,rootledootBig:big,homeX:x,homeY:y,state:'chase'}});
  }
  async function spawnWave(rec) {
    if(!ownsScene(rec)||rec.building)return;
    rec.phase='combat';
    return runtime.runWave(rec,{
      owns:()=>ownsScene(rec),
      async prepare(){
        const cfg=await window.BanditCombat?.loadGangConfig?.();
        if(!cfg)throw Error('bandit config unavailable');
        if(!ownsScene(rec))return null;
        const zoneDef=deps.getZoneDef?.(rec.zone)||{};
        const distance=Math.hypot(rec.site.c+.5-(zoneDef.entryCol||0),rec.site.r+.5-(zoneDef.entryRow||0));
        const per=Number(cfg.difficultyTiers?.tierDistanceTiles)||12;
        const rawTier=per>0?Math.min(Math.floor(distance/per),Number(cfg.difficultyTiers?.maxTier??7)):0;
        const tier=window.EnemyTierProgression?.clampTier?.(rawTier)??0;
        return {cfg,tier,pool:connectedSpawnTiles(rec),members:WAVES[rec.wave]};
      },
      canBegin:()=>canBeginAmbush(rec),
      create(rank,point,{cfg,tier}){
        const x=(point.c+.5)*deps.TILE,y=(point.r+.5)*deps.TILE;
        return makeCombatant(cfg,rank,tier,x,y,{zoneId:rec.zone});
      },
      validate:(actor,rank,point)=>tileEligible(point.c,point.r)&&(rank!=='captain'||!!actor._banditCaptainArmament),
      adopt(actor){rec.actors.add(actor);deps.hostiles.add(actor);},
      onAdopted:(_actor,_rank,point)=>deps.dirt?.(point.c,point.r),
      dispose:disposeActor,random:rand,
      onSuppressed:()=>cancelInitialAmbush(rec),
      onFailure:error=>reset('wave failed: '+error.message),
      onComplete:count=>log('wave '+rec.wave+' spawned '+count),
    });
  }
  function canBeginAmbush(rec){
    return anyStandingInChunk(rec.chunk)&&deps.canActivate?.()!==false&&!npcInChunk(rec.zone,rec.chunk);
  }
  function cancelInitialAmbush(rec){
    ledger.set(rec.key,{day:Math.floor(Number(deps.day?.())||0),cleared:false,ready:true}); // No actor was adopted; the ambush may reappear after the NPC leaves.
    reset('initial ambush suppressed before first actor adoption');
  }
  function onDeath(c) {
    const rec=active;
    if(!c?.rootledoot||!rec||!rec.actors.has(c))return false;
    rec.actors.delete(c);
    if(c.rootledootBig) {
      // Retain only the weapon record; the real combat avatar is removed immediately.
      rec.boss={_banditCaptainArmament:c._banditCaptainArmament};
      const col=Math.floor(c.x/deps.TILE),row=Math.floor(c.y/deps.TILE); // The Big Rootledoot becomes the root where it actually fell.
      if(tileEligible(col,row))rec.site={c:col,r:row};
      rec.bossRootHeight=Math.max(.1,Number(c.avatarRef?.modelHeight||.9)*(Number(c.avatarRef?.frontCanvas?.rootledootOpaqueHeightFraction)||1));
      c._banditCaptainArmament=null;c._captainEnchantmentFx?.dispose?.();c._captainEnchantmentFx=null;
    }
    disposeActor(c);
    if(c.rootledootBig)settleVictory(rec); // Record an earned harvest before any immediate zone departure or save capture.
    return true;
  }
  function eligibleTarget(c,r) {
    const rec=active;if(!rec?.mesh||!ownsScene(rec)||!['bait','reward'].includes(rec.phase))return false;
    if(c!==rec.site.c||r!==rec.site.r||Math.hypot(deps.player.x/deps.TILE-c-.5,deps.player.y/deps.TILE-r-.5)>2.5)return false;
    return deps.player.health>0&&!window.PlayerDowned?.isDowned?.()&&deps.canActivate?.()!==false&&!deps.isInCombat?.(); // Combat scans only for a genuinely aimed and reachable root.
  }
  function action(c,r) {
    if(!eligibleTarget(c,r))return null;
    // The throttled locale tick and pick() check chunk occupancy; action-bar refreshes never scan the NPC population.
    return {icon:'🌱',label:'Pick Heftroot',action:'rootledoot_pick',style:'primary',allowed:true,worldInteraction:true,promptRoot:active.mesh};
  }
  function pick(c,r) {
    if(!eligibleTarget(c,r))return false;
    const rec=active;
    if(rec.phase==='bait'){
      if(!canBeginAmbush(rec)||!flatFootprint(rec.site.c,rec.site.r)){reset('bait suppressed before interaction');return false;}
      ledger.set(rec.key,{day:Math.floor(Number(deps.day?.())||0),cleared:false,ready:false}); // A triggered ambush is not rerolled again today after defeat or escape.
      removeRoot(rec);rec.phase='combat';rec.delay=0;void spawnWave(rec);return true;
    }
    if(!rec.boss||!deps.canReceiveRoot?.()){deps.toast?.('No room for Fey Heftroot.',false);return false;}
    const previous=journal.capture(rec.key); // Transaction rolls back the locale, pending harvest and buff alongside gear and bag.
    const cooking=window.CookingSystem, stacks=cooking?.getFoodEffectStacks?.('feySight')||0;
    const boundKey=window.BanditCaptainArmaments?.boundKeyFor?.(rec.boss); // Roll back the unique bound reward along with the root.
    const transaction=window.GearMemberTransaction?.run?.({inventoryKeys:['feyHeftroot',boundKey].filter(Boolean),mutate(){
      const weapon=window.BanditCaptainArmaments?.grantCorpseWeapon?.(rec.boss,{deferSave:true});
      if(!weapon)return {ok:false,reason:'weapon'};
      deps.giveRoot();cooking?.consumeFeySight?.();
      ledger.set(rec.key,{day:Math.floor(Number(deps.day?.())||0),cleared:true});
      pendingRewards.delete(rec.key); // Do not serialize an already-claimed reward in the same atomic save.
      return {ok:true,weapon};
    }});
    if(!transaction?.ok){
      journal.rollback(rec.key,previous);
      cooking?.consumeFeySight?.();if(stacks>0)cooking?.grantFeySight?.(stacks);
      deps.toast?.('Could not save the Fey reward. Try again.',false);return false;
    }
    journal.clearRetry(rec.key);
    reset('Fey Heftroot and weapon collected'); // Clears the unlooted enchantment state only after the durable transaction.
    deps.refreshRewards?.();window.FeyArmamentQuest?.maybeStart?.();deps.toast?.('Fey Heftroot and '+transaction.weapon+' collected!',true);return true;
  }
  function noteDown(attacker,damageBeyondHealth){defeat.noteDown(attacker,damageBeyondHealth);}
  function noteDownedHit(attacker,damage){defeat.noteHit(attacker,damage);}
  function handleDefeat() {
    const rec=active;if(!rec||rec.phase!=='combat')return false;
    const {attributed:rootDefeat,deficit}=defeat.snapshot(); // Preserve before reset invalidates all actor and wave state.
    ledger.set(rec.key,{day:Math.floor(Number(deps.day?.())||0),cleared:false,ready:false}); // A fight crossing midnight still cannot reroll on its actual defeat day.
    if(!playersHere().some(p=>p!==deps.player&&standing(p)))reset('defeat: locale reset, all actors despawned'); // Another standing participant keeps the fight going.
    window.CookingSystem?.grantFeySight?.(1);
    if(rootDefeat&&window.HobunjiAlcohol?.triggerFeyBlackout){
      const max=window.ResourceSystem?.getEffectiveMax?.(deps.player,'health')||deps.player.maxHealth||100;
      runtime.recoverNonlethal({player:deps.player,maxHealth:max,deficit,blackout:percent=>window.HobunjiAlcohol.triggerFeyBlackout(percent)});
      deps.save?.();return true;
    }
    deps.save?.();return false;
  }
  function tick(dt) {
    const zone=area();
    if(!deps)return;
    if(lastZone!==zone){lastZone=zone;clock.reset();}
    if(!active&&!ZONES.has(zone)){clock.reset();return;}
    if(active&&!ownsScene(active))reset('left or rebuilt encounter scene');
    if(!ZONES.has(zone)){clock.reset();return;}
    const elapsed=clock.advance(dt);if(!elapsed)return;
    syncWorld(); // World/cycle strings and ledger maintenance are throttled too.
    const rec=active;
    if(!rec){
      for(const who of playersHere()){if(!standing(who))continue;const p=playerTile(who);if(resumeReward(zone,chunkOf(p.c,p.r)))break;tryActivate(who);if(active)break;}
      return;
    }
    if(rec.phase==='combat'&&!allDown()&&playersHere().every(p=>Math.hypot(p.x/deps.TILE-rec.site.c-.5,p.y/deps.TILE-rec.site.r-.5)>chunkSize()*2)){reset('player escaped locale');return;} // Abandoned only when every participant has left.
    if(rec.phase==='bait'){
      if(!anyInChunk(rec.chunk)||npcInChunk(zone,rec.chunk)||!flatFootprint(rec.site.c,rec.site.r))reset('bait dormant');
      return;
    }
    if(rec.phase==='reward'){
      if(!anyInChunk(chunkOf(rec.site.c,rec.site.r)))reset('unclaimed harvest dormant');
      return;
    }
    if(rec.phase!=='combat'||rec.building||allDown())return;
    for(const actor of rec.actors)if(!deps.hostiles.has(actor)){reset('encounter actor removed by zone teardown');return;}
    if(rec.actors.size)return;
    if(rec.wave>=WAVES.length){
      if(!rec.boss){reset('missing boss reward');return;}
      settleVictory(rec);return;
    }
    rec.delay+=elapsed;
    if(rec.delay>=WAVE_DELAY){rec.delay=0;void spawnWave(rec);}
  }
  function serialize(){return journal.serialize();}
  function restore(raw){reset('restore');journal.restore(raw);clock.reset();}
  window.Rootledoots=Object.freeze({init,tick,action,pick,onDeath,noteDown,noteDownedHit,handleDefeat,paintPortrait,makeCombatant,ensureRig,serialize,restore,reset,
    debugSnapshot:()=>({lastEvent,worldStamp:journal.stamp,checkedChunks:ledger.size,pendingRewards:pendingRewards.size,active:active&&{zone:active.zone,site:active.site,phase:active.phase,wave:active.wave,actors:active.actors.size},downedByRoot:defeat.snapshot().attributed,overkill:defeat.snapshot().deficit}),
    __test:Object.freeze({chunkOf,siteInChunk,npcInChunk,connectedSpawnTiles,BASE_CHANCE,WAVES})});
  window.DevCompanion?.registerStateProvider?.('rootledoots',window.Rootledoots.debugSnapshot);
})();
