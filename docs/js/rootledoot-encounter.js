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
  let deps = null; // Narrow game-owned adapters; no independent AI, combat or save loop.
  let active = null; // The one live locale, from bait through reward; each has its own async generation identity.
  let checkTime = 0; // Accumulated only in eligible zones or with an active locale.
  const rewardRetryAt = new Map(); // Failed visual reconstruction retries at most once per 10 real seconds per saved reward.
  const pendingRewards = new Map(); // Unclaimed boss harvests survive chunk unloads, area changes and save/load without retaining rigs.
  let ledger = new Map(); // Chunk-keyed last attempt day and cleared status, persisted with the member.
  let worldStamp = null; // World and Tothal cycle identity; regenerated wilderness resets locale positions.
  let artPromise = null; // Cache a single alpha-cropped image across all Rootledoots.
  const rootTextures = new Map(); // One full authored farm image and one cropped boss image, shared by all locales.
  let overkill = 0; // Damage beyond zero Health for the current Rootledoot-caused down.
  let downedByRoot = false; // Attribution is reset on every new down and on encounter cleanup.
  let lastEvent = 'idle'; // In-game diagnostic snapshot and mobile farm log.

  const rand = () => deps?.rnd?.() ?? Math.random();
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  function log(msg) { lastEvent=msg; window.__farmLog?.('[rootledoot] '+msg,'info'); }
  function init(injected) { if(deps)reset('reinitialized'); deps=injected; checkTime=0; }
  function area() { return deps?.getArea?.(); }
  function ownsScene(rec) { return active===rec&&area()===rec.zone&&deps.getScene?.()===rec.scene; } // Scene identity also detects a same-zone rebuild.
  function stamp() { return String(deps?.worldId?.() || '')+':'+String(deps?.cycle?.() ?? 0); }
  function chunkSize() { return Math.max(4,Math.floor(Number(deps?.chunkSize?.())||16)); }
  function chunkOf(c,r) { const n=chunkSize(); return {c:Math.floor(c/n),r:Math.floor(r/n)}; }
  function keyFor(zone,c,r) { return zone+':'+c+','+r; }
  function sameChunk(x,y,chunk) { const p=chunkOf(x,y);return p.c===chunk.c&&p.r===chunk.r; }
  function playerTile() { return {c:Math.floor(deps.player.x/deps.TILE),r:Math.floor(deps.player.y/deps.TILE)}; }
  function hash(text) { let h=2166136261; for(const c of String(text))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0; }
  function tileAt(c,r) { return deps?.getGrid?.()?.[r]?.[c]; }
  function tileEligible(c,r,terrainOnly=false) {
    const tile=tileAt(c,r);
    if(!tile||tile.mapBoundary||tile.incline||tile.water>0||!deps.walkable(c,r))return false;
    return !terrainOnly||deps.isBareGround(tile);
  }
  function flatFootprint(c,r) {
    const t=tileAt(c,r);if(!t)return false;
    const elev=Number(t.elevTier)||0;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++) {
      const v=tileAt(c+dc,r+dr);if(!tileEligible(c+dc,r+dr,true)||(Number(v.elevTier)||0)!==elev)return false;
    }
    return true;
  }
  function siteInChunk(zone,chunk) {
    const n=chunkSize(), grid=deps.getGrid(); // One deterministic 3x3 locale per chunk; never stamp over the original terrain.
    const minC=chunk.c*n+1,minR=chunk.r*n+1,maxC=Math.min((chunk.c+1)*n-2,(grid?.[0]?.length||0)-2),maxR=Math.min((chunk.r+1)*n-2,(grid?.length||0)-2);
    if(maxC<minC||maxR<minR)return null;
    const h=hash(worldStamp+':'+keyFor(zone,chunk.c,chunk.r));
    const centerC=clamp(Math.floor((minC+maxC)/2)+(h%5)-2,minC,maxC);
    const centerR=clamp(Math.floor((minR+maxR)/2)+((h>>>8)%5)-2,minR,maxR);
    // Start near the chunk center; expand in rings only if a cliff/rock/river occupies it.
    for(let d=0;d<n;d++)for(let dr=-d;dr<=d;dr++)for(let dc=-d;dc<=d;dc++) {
      if(Math.max(Math.abs(dc),Math.abs(dr))!==d)continue;
      const c=centerC+dc,r=centerR+dr;
      if(c>=minC&&c<=maxC&&r>=minR&&r<=maxR&&flatFootprint(c,r))return {c,r};
    }
    return null;
  }
  function npcInChunk(zone,chunk) {
    for(const w of deps.getNpcWalkers?.()||[]) {
      const p=w?.root?.position; // Named animals are NPC walkers but use the same animal presentation registry as wild creatures.
      if(w?.area!==zone||!p||w.isAnimal===true||w.rec?.isAnimal===true||w.avatarGroup?.userData?.namedAnimalNpc||w.root?.userData?.namedAnimalNpc||window.HobunjiNpcSpeciesRegistry?.isCreatureSpecies?.(w.rec?.appearance?.speciesId))continue;
      if(sameChunk(p.x,p.z,chunk))return true;
    }
    for(const collection of [deps.hostiles,deps.companions])for(const c of collection||[]) {
      if(c?.areaId!==zone||!(c.health>0)||c.rootledoot||!(c.isBandit||c.isMinion||c.isLich||c.isNpc||c.isPorakanekiHunter||c._familyBabyFollower))continue;
      if(sameChunk(c.x/deps.TILE,c.y/deps.TILE,chunk))return true;
    }
    return false;
  }
  function loadArt() {
    if(artPromise)return artPromise;
    artPromise=new Promise((resolve,reject)=>{
      const image=new Image();image.onload=()=>{
        try {
          const raw=document.createElement('canvas');raw.width=image.naturalWidth||image.width;raw.height=image.naturalHeight||image.height;
          const ctx=raw.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
          const pixels=ctx.getImageData(0,0,raw.width,raw.height).data;
          let l=raw.width,t=raw.height,r=-1,b=-1;
          for(let y=0;y<raw.height;y++)for(let x=0;x<raw.width;x++)if(pixels[(y*raw.width+x)*4+3]>0){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
          if(r<l||b<t)throw Error('Heftroot sprite is transparent');
          const crop=document.createElement('canvas');crop.width=r-l+1;crop.height=b-t+1;
          crop.getContext('2d').drawImage(raw,l,t,crop.width,crop.height,0,0,crop.width,crop.height);
          resolve({raw,crop});
        }catch(error){reject(error);}
      };image.onerror=()=>reject(Error('Heftroot sprite could not load'));image.src=ROOT_ASSET;
    }).catch(error=>{artPromise=null;throw error;});
    return artPromise;
  }
  async function paintPortrait(canvas,behind=false) {
    const {crop}=await loadArt(),ctx=canvas.getContext('2d');
    const scale=Math.min(canvas.width/crop.width,canvas.height/crop.height);
    const w=crop.width*scale,h=crop.height*scale;
    canvas.rootledootOpaqueHeightFraction=h/canvas.height; // The boss harvest visual must match the actual visible portion of this portrait.
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.imageSmoothingEnabled=false;
    if(behind){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
    ctx.drawImage(crop,(canvas.width-w)/2,canvas.height-h,w,h);ctx.restore();
  }
  function removeRoot(rec) {
    if(!rec?.mesh)return;rec.mesh.parent?.remove(rec.mesh);rec.mesh.material?.dispose();rec.mesh=null;
  }
  async function showRoot(rec,large=false) {
    const {raw,crop}=await loadArt();
    if(!ownsScene(rec))return false;
    if(!large&&(deps.canActivate?.()===false||!sameChunk(deps.player.x/deps.TILE,deps.player.y/deps.TILE,rec.chunk)||!flatFootprint(rec.site.c,rec.site.r)||npcInChunk(rec.zone,rec.chunk))){reset('bait suppressed during artwork load');return false;} // Recheck asynchronous activation without spending the successful daily roll.
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
    const rec=active;active=null;overkill=0;downedByRoot=false;
    if(!rec)return;removeRoot(rec);
    for(const c of rec.actors)disposeActor(c);
    rec.actors.clear();if(rec.boss)window.BanditCaptainArmaments?.discard?.(rec.boss);
    log(reason);
  }
  function syncWorld() {
    const next=stamp();
    if(next===worldStamp)return;
    reset('world/shift changed');ledger.clear();pendingRewards.clear();rewardRetryAt.clear();worldStamp=next;
  }
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
  function tryActivate() {
    const zone=area(),p=playerTile(),chunk=chunkOf(p.c,p.r),key=keyFor(zone,chunk.c,chunk.r);
    const day=Math.floor(Number(deps.day?.())||0),previous=ledger.get(key);
    if(pendingRewards.has(key)||previous?.cleared||(previous?.day===day&&!previous.ready))return; // Failed/used daily rolls perform no NPC scans on later ticks.
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
      if(saved.zone!==zone||!sameChunk(saved.site.c,saved.site.r,chunk)||(rewardRetryAt.get(key)||0)>performance.now())continue;
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
    const fail=reason=>{if(active===rec){rewardRetryAt.set(rec.key,performance.now()+10000);reset(reason);}};
    void showRoot(rec,true).then(ok=>{if(!ok)fail('reward unavailable');else rewardRetryAt.delete(rec.key);}).catch(error=>fail('reward failed: '+error.message));
  }
  function settleVictory(rec) {
    if(active!==rec||rec.phase!=='combat'||rec.actors.size||!rec.boss||rec.building||rec.wave<WAVES.length||window.PlayerDowned?.isDowned?.())return false;
    rec.phase='reward';
    pendingRewards.set(rec.key,{zone:rec.zone,site:{...rec.site},height:rec.bossRootHeight,armament:rec.boss._banditCaptainArmament});
    deps.save?.(); // Victory is a meaningful checkpoint; no per-tick save.
    revealReward(rec);
    return true;
  }
  function connectedSpawnTiles(rec) {
    // One bounded flood fill per wave, not one path search per candidate or per actor.
    const p=playerTile(),origin=sameChunk(p.c,p.r,rec.chunk)&&tileEligible(p.c,p.r)?p:rec.site;
    if(!tileEligible(origin.c,origin.r))return {near:[],far:[]};
    const elevation=Number(tileAt(origin.c,origin.r)?.elevTier)||0;
    const queue=[origin],seen=new Set([origin.c+','+origin.r]),near=[],far=[];
    for(let i=0;i<queue.length;i++){
      const point=queue[i],distance=Math.hypot(point.c-p.c,point.r-p.r);
      if(distance>=2)(Math.hypot(point.c-origin.c,point.r-origin.r)<=5?near:far).push(point);
      for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const c=point.c+dc,r=point.r+dr,key=c+','+r;
        if(seen.has(key)||!sameChunk(c,r,rec.chunk))continue;
        seen.add(key);
        if(!tileEligible(c,r)||(Number(tileAt(c,r)?.elevTier)||0)!==elevation)continue;
        queue.push({c,r});
      }
    }
    // Prefer emergence around the player/locale, with connected fallback sites.
    return {near,far};
  }
  function spawnPoint(pool) {
    const candidates=pool?.near?.length?pool.near:pool?.far;
    if(!candidates?.length)return null;
    return candidates.splice(Math.min(candidates.length-1,Math.floor(rand()*candidates.length)),1)[0];
  }
  async function spawnWave(rec) {
    if(!ownsScene(rec)||rec.building)return;
    rec.building=true;rec.phase='combat';let count=0;
    try {
      const cfg=await window.BanditCombat?.loadGangConfig?.();
      if(!cfg)throw Error('bandit config unavailable');
      if(!ownsScene(rec))return; // No terrain scan or RNG use against a replacement scene.
      const pool=connectedSpawnTiles(rec),zoneDef=deps.getZoneDef?.(rec.zone)||{}; // All members of this wave share a reachable, non-overlapping spawn pool.
      const firstAmbush=rec.wave===0; // NPC exclusion applies until the first actor is actually adopted, not to combat already in progress.
      const distance=Math.hypot(rec.site.c+.5-(zoneDef.entryCol||0),rec.site.r+.5-(zoneDef.entryRow||0));
      const per=Number(cfg.difficultyTiers?.tierDistanceTiles)||12; // Same distance/rank model and configured tier ceiling as ordinary bandit camps.
      const rawTier=per>0?Math.min(Math.floor(distance/per),Number(cfg.difficultyTiers?.maxTier??7)):0;
      const tier=window.EnemyTierProgression?.clampTier?.(rawTier)??0;
      if(pool.near.length+pool.far.length<WAVES[rec.wave].length){if(firstAmbush){cancelInitialAmbush(rec);return;}throw Error('insufficient connected spawn tiles');}
      for(const rank of WAVES[rec.wave]){
        if(!ownsScene(rec))return;
        if(firstAmbush&&!count&&!canBeginAmbush(rec)){cancelInitialAmbush(rec);return;}
        const point=spawnPoint(pool);if(!point)throw Error('no connected spawn for '+rank);
        const big=rank==='captain',name=big?'Big Rootledoot':'Rootledoot';
        const x=(point.c+.5)*deps.TILE,y=(point.r+.5)*deps.TILE;
        const roster={name,appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{},bodyColors:Object.fromEntries(['A','B','C'].map(k=>[k,{hex:ROOT_COLOR}]))},equippedCosmetics:[],cosmeticSlots:{},appliedDyes:{},rootledoot:true};
        const scale=big?1.35:rank==='lieutenant'?.82:.65;
        const c=await window.BanditCombat.makeEntity(cfg,rank,tier,x,y,{zoneId:rec.zone,enemyClass:'rootledoot',rosterOverride:roster,preserveRoster:true,
          avatarRigScale:{x:scale,y:scale,head:1,offsetY:0},defOverride:{label:name},
          extra:{rootledoot:true,rootledootBig:big,homeX:x,homeY:y,state:'chase'}});
        if(!c)throw Error('bandit avatar construction failed for '+rank);
        if(!ownsScene(rec)){disposeActor(c);return;}
        if(firstAmbush&&!count&&!canBeginAmbush(rec)){disposeActor(c);cancelInitialAmbush(rec);return;}
        if(!tileEligible(point.c,point.r)){disposeActor(c);throw Error('spawn blocked during avatar construction');}
        if(big&&!c._banditCaptainArmament){disposeActor(c);throw Error('Fey weapon construction failed');}
        rec.actors.add(c);deps.hostiles.add(c);count++;
        deps.dirt?.(point.c,point.r);
      }
      if(!count)throw Error('no valid wave spawn');
      rec.wave++;log('wave '+rec.wave+' spawned '+count);
    }catch(error){if(active===rec)reset('wave failed: '+error.message);}
    finally{rec.building=false;}
  }
  function canBeginAmbush(rec){
    return deps.player.health>0&&!window.PlayerDowned?.isDowned?.()&&deps.canActivate?.()!==false&&sameChunk(deps.player.x/deps.TILE,deps.player.y/deps.TILE,rec.chunk)&&!npcInChunk(rec.zone,rec.chunk);
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
    const previous=ledger.get(rec.key), previousReward=pendingRewards.get(rec.key); // Transaction rolls back the locale, pending harvest and buff alongside gear and bag.
    const cooking=window.CookingSystem, stacks=cooking?.getFoodEffectStacks?.('feySight')||0;
    const transaction=window.GearMemberTransaction?.run?.({inventoryKeys:['feyHeftroot'],mutate(){
      const weapon=window.BanditCaptainArmaments?.grantCorpseWeapon?.(rec.boss,{deferSave:true});
      if(!weapon)return {ok:false,reason:'weapon'};
      deps.giveRoot();cooking?.consumeFeySight?.();
      ledger.set(rec.key,{day:Math.floor(Number(deps.day?.())||0),cleared:true});
      pendingRewards.delete(rec.key); // Do not serialize an already-claimed reward in the same atomic save.
      return {ok:true,weapon};
    }});
    if(!transaction?.ok){
      if(previous)ledger.set(rec.key,previous);else ledger.delete(rec.key);
      if(previousReward)pendingRewards.set(rec.key,previousReward);
      cooking?.consumeFeySight?.();if(stacks>0)cooking?.grantFeySight?.(stacks);
      deps.toast?.('Could not save the Fey reward. Try again.',false);return false;
    }
    rewardRetryAt.delete(rec.key);
    reset('Fey Heftroot and weapon collected'); // Clears the unlooted enchantment state only after the durable transaction.
    deps.refreshRewards?.();window.FeyArmamentQuest?.maybeStart?.();deps.toast?.('Fey Heftroot and '+transaction.weapon+' collected!',true);return true;
  }
  function noteDown(attacker,damageBeyondHealth) {
    downedByRoot=!!(active&&active.phase==='combat'&&attacker?.rootledoot&&active.actors.has(attacker));
    overkill=downedByRoot?Math.max(0,Number(damageBeyondHealth)||0):0;
  }
  function noteDownedHit(attacker,damage) {
    if(downedByRoot&&active?.actors.has(attacker))overkill+=Math.max(0,Number(damage)||0);
  }
  function handleDefeat() {
    const rec=active;if(!rec||rec.phase!=='combat')return false;
    const rootDefeat=downedByRoot,deficit=overkill; // Preserve before reset invalidates all actor and wave state.
    ledger.set(rec.key,{day:Math.floor(Number(deps.day?.())||0),cleared:false,ready:false}); // A fight crossing midnight still cannot reroll on its actual defeat day.
    reset('defeat: locale reset, all actors despawned');
    window.CookingSystem?.grantFeySight?.(1);
    if(rootDefeat&&window.HobunjiAlcohol?.triggerFeyBlackout){
      const max=window.ResourceSystem?.getEffectiveMax?.(deps.player,'health')||deps.player.maxHealth||100;
      deps.player.health=Math.max(1,Math.round(max*.25));deps.player.vx=deps.player.vy=0;deps.player.invulnUntil=performance.now()+1000;
      window.HobunjiAlcohol.triggerFeyBlackout(deficit/max*100);
      deps.save?.();return true;
    }
    deps.save?.();return false;
  }
  function tick(dt) {
    const zone=area();
    if(!deps||(!active&&!ZONES.has(zone)))return;
    if(active&&!ownsScene(active))reset('left or rebuilt encounter scene');
    if(!ZONES.has(zone)){checkTime=0;return;}
    checkTime+=Math.max(0,Number(dt)||0);
    if(checkTime<CHECK_SECONDS)return;
    const elapsed=checkTime;checkTime=0;
    syncWorld(); // World/cycle strings and ledger maintenance are throttled too.
    const rec=active;
    if(!rec){
      if(!window.PlayerDowned?.isDowned?.()&&deps.player.health>0){const p=playerTile();if(!resumeReward(zone,chunkOf(p.c,p.r)))tryActivate();}
      return;
    }
    if(rec.phase==='combat'&&!window.PlayerDowned?.isDowned?.()&&Math.hypot(deps.player.x/deps.TILE-rec.site.c-.5,deps.player.y/deps.TILE-rec.site.r-.5)>chunkSize()*2){reset('player escaped locale');return;}
    if(rec.phase==='bait'){
      if(!sameChunk(deps.player.x/deps.TILE,deps.player.y/deps.TILE,rec.chunk)||npcInChunk(zone,rec.chunk)||!flatFootprint(rec.site.c,rec.site.r))reset('bait dormant');
      return;
    }
    if(rec.phase==='reward'){
      if(!sameChunk(deps.player.x/deps.TILE,deps.player.y/deps.TILE,chunkOf(rec.site.c,rec.site.r)))reset('unclaimed harvest dormant');
      return;
    }
    if(rec.phase!=='combat'||rec.building||window.PlayerDowned?.isDowned?.())return;
    for(const actor of rec.actors)if(!deps.hostiles.has(actor)){reset('encounter actor removed by zone teardown');return;}
    if(rec.actors.size)return;
    if(rec.wave>=WAVES.length){
      if(!rec.boss){reset('missing boss reward');return;}
      settleVictory(rec);return;
    }
    rec.delay+=elapsed;
    if(rec.delay>=WAVE_DELAY){rec.delay=0;void spawnWave(rec);}
  }
  function serialize(){
    // Capture is read-only; a save during a scene transition must not despawn actors or clear rewards.
    return {stamp:worldStamp??stamp(),ledger:[...ledger],pendingRewards:[...pendingRewards]};
  }
  function restore(raw){
    reset('restore');
    worldStamp=typeof raw?.stamp==='string'?raw.stamp:stamp();
    ledger=new Map(Array.isArray(raw?.ledger)?raw.ledger.filter(e=>Array.isArray(e)&&typeof e[0]==='string'&&Number.isFinite(e[1]?.day)):[]);
    pendingRewards.clear();rewardRetryAt.clear();
    for(const entry of Array.isArray(raw?.pendingRewards)?raw.pendingRewards:[]){
      if(!Array.isArray(entry)||typeof entry[0]!=='string')continue;
      const [key,reward]=entry;
      if(ledger.get(key)?.cleared||!ZONES.has(reward?.zone)||!Number.isInteger(reward.site?.c)||!Number.isInteger(reward.site?.r)||
        !Number.isFinite(reward.height)||reward.height<=0||reward.armament?.origin!=='Fey'||typeof reward.armament?.key!=='string')continue;
      pendingRewards.set(key,reward);
    }
    checkTime=0;
  } // First eligible tick validates the fully restored world/cycle.
  window.Rootledoots=Object.freeze({init,tick,action,pick,onDeath,noteDown,noteDownedHit,handleDefeat,paintPortrait,serialize,restore,reset,
    debugSnapshot:()=>({lastEvent,worldStamp,checkedChunks:ledger.size,pendingRewards:pendingRewards.size,active:active&&{zone:active.zone,site:active.site,phase:active.phase,wave:active.wave,actors:active.actors.size},downedByRoot,overkill}),
    __test:Object.freeze({chunkOf,siteInChunk,npcInChunk,connectedSpawnTiles,BASE_CHANCE,WAVES})});
  window.DevCompanion?.registerStateProvider?.('rootledoots',window.Rootledoots.debugSnapshot);
})();
