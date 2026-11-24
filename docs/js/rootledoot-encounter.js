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
  const ROOT_SCALE = .5625; // Matches HobunjiHeftrootBillboardBridge.
  let deps = null; // Narrow game-owned adapters; no independent AI, combat or save loop.
  let active = null; // The one live locale, from bait through reward; each has its own async generation identity.
  let checkTime = 0; // Accumulated only in eligible zones or with an active locale.
  let ledger = new Map(); // Chunk-keyed last attempt day and cleared status, persisted with the member.
  let worldStamp = null; // World and Tothal cycle identity; regenerated wilderness resets locale positions.
  let artPromise = null; // Cache a single alpha-cropped image across all Rootledoots.
  let rootTexture = null; // Shared immutable texture; individual bait materials are disposed on removal.
  let overkill = 0; // Damage beyond zero Health for the current Rootledoot-caused down.
  let downedByRoot = false; // Attribution is reset on every new down and on encounter cleanup.
  let lastEvent = 'idle'; // In-game diagnostic snapshot and mobile farm log.

  const rand = () => deps?.rnd?.() ?? Math.random();
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  function log(msg) { lastEvent=msg; window.__farmLog?.('[rootledoot] '+msg,'info'); }
  function init(injected) { if(deps)reset('reinitialized'); deps=injected; checkTime=0; }
  function area() { return deps?.getArea?.(); }
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
      const p=w?.root?.position;if(w?.area!==zone||!p||w.isAnimal===true||w.rec?.isAnimal===true)continue;
      if(sameChunk(p.x,p.z,chunk))return true;
    }
    for(const c of deps.hostiles||[]) {
      if(c?.areaId!==zone||!(c.health>0)||c.rootledoot||!(c.isBandit||c.isMinion||c.isLich||c.isNpc))continue;
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
          resolve(crop);
        }catch(error){reject(error);}
      };image.onerror=()=>reject(Error('Heftroot sprite could not load'));image.src=ROOT_ASSET;
    }).catch(error=>{artPromise=null;throw error;});
    return artPromise;
  }
  async function paintPortrait(canvas,behind=false) {
    const crop=await loadArt(),ctx=canvas.getContext('2d');
    const scale=Math.min(canvas.width/crop.width,canvas.height/crop.height);
    const w=crop.width*scale,h=crop.height*scale;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.imageSmoothingEnabled=false;
    if(behind){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
    ctx.drawImage(crop,(canvas.width-w)/2,canvas.height-h,w,h);ctx.restore();
  }
  function removeRoot(rec) {
    if(!rec?.mesh)return;rec.mesh.parent?.remove(rec.mesh);rec.mesh.material?.dispose();rec.mesh=null;
  }
  async function showRoot(rec,large=false) {
    const crop=await loadArt();
    if(active!==rec||area()!==rec.zone)return false;
    const THREE=window.THREE;if(!THREE)return false;
    if(!rootTexture){rootTexture=new THREE.CanvasTexture(crop);rootTexture.magFilter=THREE.NearestFilter;rootTexture.minFilter=THREE.NearestFilter;if(THREE.sRGBEncoding!==undefined)rootTexture.encoding=THREE.sRGBEncoding;}
    removeRoot(rec);
    const root=new THREE.Sprite(new THREE.SpriteMaterial({map:rootTexture,transparent:true,alphaTest:.04,depthWrite:true}));
    const height=large?(rec.bossRootHeight||1.2):ROOT_SCALE;
    root.scale.set(height*crop.width/crop.height,height,1);
    // A centered sprite at soil level is half buried, like a ripe farm Heftroot.
    root.position.set(rec.site.c+.5,deps.surfaceY(rec.site.c+.5,rec.site.r+.5),rec.site.r+.5);
    root.userData.noOutline=true;root.name=large?'fey_heftroot_reward':'heftroot_bait';
    deps.getScene().add(root);rec.mesh=root;return true;
  }
  function disposeActor(c) {
    const live = deps.hostiles.has(c) || deps.corpses?.has(c) || c.avatarRef?.group?.parent; // World teardown may already have disposed this actor.
    deps.hostiles.delete(c);deps.corpses?.delete(c);deps.companions?.delete(c);
    window.Combat?.cancelStagedForAttacker?.(c);window.Combat?.telegraph?.cancel?.(c);
    window.RangedWeapons?.cancelBanditAction?.(c);window.BanditCombat?.cancelLunge?.(c);
    window.BanditCaptainArmaments?.discard?.(c);
    if(live)deps.despawn(c);
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
    reset('world/shift changed');ledger.clear();worldStamp=next;
  }
  function activate(zone,chunk,site,key) {
    const rec={zone,chunk,site,key,phase:'bait',actors:new Set(),wave:0,delay:0,mesh:null,boss:null,building:false};
    active=rec;
    void showRoot(rec).then(ok=>{if(!ok&&active===rec)reset('bait unavailable');}).catch(error=>{if(active===rec)reset('bait failed: '+error.message);});
    log('bait activated at '+zone+' '+site.c+','+site.r);
  }
  function tryActivate() {
    const zone=area(),p=playerTile(),chunk=chunkOf(p.c,p.r),key=keyFor(zone,chunk.c,chunk.r);
    const day=Math.floor(Number(deps.day?.())||0),previous=ledger.get(key);
    if(previous?.cleared||(previous?.day===day&&!previous.ready))return; // Failed/used daily rolls perform no NPC scans on later ticks.
    if(npcInChunk(zone,chunk))return;
    if(previous?.day===day){
      if(previous.ready){const site=siteInChunk(zone,chunk);if(site)activate(zone,chunk,site,key);}
      return;
    }
    // Each eligible chunk rolls once per day, not every frame or every boundary crossing.
    ledger.set(key,{day,cleared:false});
    const chance=window.CookingSystem?.feyEncounterChance?.(BASE_CHANCE)??BASE_CHANCE;
    if(rand()>=chance)return;
    const site=siteInChunk(zone,chunk);if(site){ledger.set(key,{day,cleared:false,ready:true});activate(zone,chunk,site,key);}
  }
  function spawnPoint(rec,used) {
    const p=playerTile(),n=chunkSize();
    const origin=sameChunk(p.c,p.r,rec.chunk)?p:rec.site; // If the player retreats across the chunk edge, reinforcements still emerge from the locale.
    for(let attempt=0;attempt<40;attempt++){
      const a=rand()*Math.PI*2,d=2+rand()*3;
      const c=Math.floor(origin.c+.5+Math.cos(a)*d),r=Math.floor(origin.r+.5+Math.sin(a)*d);
      const k=c+','+r;if(used.has(k)||!tileEligible(c,r))continue;
      if(c<rec.chunk.c*n||r<rec.chunk.r*n||c>=(rec.chunk.c+1)*n||r>=(rec.chunk.r+1)*n)continue;
      if(Math.abs((Number(tileAt(c,r)?.elevTier)||0)-(Number(tileAt(origin.c,origin.r)?.elevTier)||0))>0)continue;
      if(Math.hypot(c-p.c,r-p.r)<2)continue;
      used.add(k);return {c,r};
    }
    // Deterministic fallback avoids failing an entire wave on an unlucky random sample.
    for(let radius=2;radius<=n;radius++)for(let dr=-radius;dr<=radius;dr++)for(let dc=-radius;dc<=radius;dc++){
      if(Math.max(Math.abs(dc),Math.abs(dr))!==radius)continue;
      const c=origin.c+dc,r=origin.r+dr,k=c+','+r;
      if(!sameChunk(c,r,rec.chunk)||used.has(k)||!tileEligible(c,r)||Math.hypot(c-p.c,r-p.r)<2)continue;
      if((Number(tileAt(c,r)?.elevTier)||0)!==(Number(tileAt(origin.c,origin.r)?.elevTier)||0))continue;
      used.add(k);return {c,r};
    }
    return null;
  }
  async function spawnWave(rec) {
    if(active!==rec||rec.building||area()!==rec.zone)return;
    rec.building=true;rec.phase='combat';let count=0;
    try {
      const cfg=await window.BanditCombat?.loadGangConfig?.();
      if(!cfg)throw Error('bandit config unavailable');
      const used=new Set(),zoneDef=deps.getZoneDef?.(rec.zone)||{};
      const distance=Math.hypot(rec.site.c-(zoneDef.entryCol||0),rec.site.r-(zoneDef.entryRow||0));
      const tier=window.EnemyTierProgression?.clampTier?.(Math.floor(distance/(Number(cfg.difficultyTiers?.tierDistanceTiles)||12)))??0;
      for(const rank of WAVES[rec.wave]){
        if(active!==rec||area()!==rec.zone)return;
        const point=spawnPoint(rec,used);if(!point)throw Error('no valid spawn for '+rank);
        const big=rank==='captain',name=big?'Big Rootledoot':'Rootledoot';
        const x=(point.c+.5)*deps.TILE,y=(point.r+.5)*deps.TILE;
        const roster={name,appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{},bodyColors:Object.fromEntries(['A','B','C'].map(k=>[k,{hex:ROOT_COLOR}]))},equippedCosmetics:[],cosmeticSlots:{},appliedDyes:{},rootledoot:true};
        const scale=big?1.35:rank==='lieutenant'?.82:.65;
        const c=await window.BanditCombat.makeEntity(cfg,rank,tier,x,y,{zoneId:rec.zone,enemyClass:'rootledoot',rosterOverride:roster,preserveRoster:true,
          avatarRigScale:{x:scale,y:scale,head:1,offsetY:0},defOverride:{label:name},
          extra:{rootledoot:true,rootledootBig:big,homeX:x,homeY:y,state:'chase'}});
        if(!c)throw Error('bandit avatar construction failed for '+rank);
        if(active!==rec||area()!==rec.zone){disposeActor(c);return;}
        if(big&&!c._banditCaptainArmament){disposeActor(c);throw Error('Fey weapon construction failed');}
        rec.actors.add(c);deps.hostiles.add(c);count++;
        deps.dirt?.(point.c,point.r);
      }
      if(!count)throw Error('no valid wave spawn');
      rec.wave++;log('wave '+rec.wave+' spawned '+count);
    }catch(error){if(active===rec)reset('wave failed: '+error.message);}
    finally{rec.building=false;}
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
      rec.bossRootHeight=Math.max(.8,Number(c.avatarRef?.modelHeight||.9));
      c._banditCaptainArmament=null;c._captainEnchantmentFx?.dispose?.();c._captainEnchantmentFx=null;
    }
    disposeActor(c);return true;
  }
  function eligibleTarget(c,r) {
    const rec=active;if(!rec?.mesh||area()!==rec.zone||!['bait','reward'].includes(rec.phase))return false;
    if(c!==rec.site.c||r!==rec.site.r)return false;
    return Math.hypot(deps.player.x/deps.TILE-c-.5,deps.player.y/deps.TILE-r-.5)<=2.5;
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
      if(npcInChunk(rec.zone,rec.chunk)){reset('bait suppressed by nearby NPC');return false;}
      ledger.set(rec.key,{day:Math.floor(Number(deps.day?.())||0),cleared:false,ready:false}); // A triggered ambush is not rerolled again today after defeat or escape.
      removeRoot(rec);rec.phase='combat';rec.delay=0;void spawnWave(rec);return true;
    }
    if(!rec.boss||!deps.canReceiveRoot?.()){deps.toast?.('No room for Fey Heftroot.',false);return false;}
    const previous=ledger.get(rec.key); // Transaction rolls back the locale and buff alongside the bag and character gear.
    const cooking=window.CookingSystem, stacks=cooking?.getFoodEffectStacks?.('feySight')||0;
    const transaction=window.GearMemberTransaction?.run?.({inventoryKeys:['feyHeftroot'],mutate(){
      const weapon=window.BanditCaptainArmaments?.grantCorpseWeapon?.(rec.boss,{deferSave:true});
      if(!weapon)return {ok:false,reason:'weapon'};
      deps.giveRoot();cooking?.consumeFeySight?.();
      ledger.set(rec.key,{day:Math.floor(Number(deps.day?.())||0),cleared:true});
      return {ok:true,weapon};
    }});
    if(!transaction?.ok){
      if(previous)ledger.set(rec.key,previous);else ledger.delete(rec.key);
      cooking?.consumeFeySight?.();if(stacks>0)cooking?.grantFeySight?.(stacks);
      deps.toast?.('Could not save the Fey reward. Try again.',false);return false;
    }
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
    syncWorld();
    if(active&&active.zone!==zone)reset('left encounter zone');
    if(!ZONES.has(zone))return;
    checkTime+=Math.max(0,Number(dt)||0);
    if(checkTime<CHECK_SECONDS)return;
    const elapsed=checkTime;checkTime=0;
    const rec=active;
    if(!rec){if(!window.PlayerDowned?.isDowned?.()&&deps.player.health>0)tryActivate();return;}
    if(rec.phase==='combat'&&!window.PlayerDowned?.isDowned?.()&&Math.hypot(deps.player.x/deps.TILE-rec.site.c-.5,deps.player.y/deps.TILE-rec.site.r-.5)>chunkSize()*2){reset('player escaped locale');return;}
    if(rec.phase==='bait'){
      if(!sameChunk(deps.player.x/deps.TILE,deps.player.y/deps.TILE,rec.chunk)||npcInChunk(zone,rec.chunk))reset('bait dormant');
      return;
    }
    if(rec.phase!=='combat'||rec.building||window.PlayerDowned?.isDowned?.())return;
    for(const actor of rec.actors)if(!deps.hostiles.has(actor)){reset('encounter actor removed by zone teardown');return;}
    if(rec.actors.size)return;
    if(rec.wave>=WAVES.length){
      if(!rec.boss){reset('missing boss reward');return;}
      rec.phase='reward';void showRoot(rec,true).then(ok=>{if(!ok&&active===rec)reset('reward unavailable');}).catch(error=>{if(active===rec)reset('reward failed: '+error.message);});return;
    }
    rec.delay+=elapsed;
    if(rec.delay>=WAVE_DELAY){rec.delay=0;void spawnWave(rec);}
  }
  function serialize(){syncWorld();return {stamp:worldStamp,ledger:[...ledger]};}
  function restore(raw){reset('restore');worldStamp=typeof raw?.stamp==='string'?raw.stamp:stamp();ledger=new Map(Array.isArray(raw?.ledger)?raw.ledger.filter(e=>Array.isArray(e)&&typeof e[0]==='string'&&Number.isFinite(e[1]?.day)):[]);checkTime=0;} // First eligible tick validates the fully restored world/cycle.
  window.Rootledoots=Object.freeze({init,tick,action,pick,onDeath,noteDown,noteDownedHit,handleDefeat,paintPortrait,serialize,restore,reset,
    debugSnapshot:()=>({lastEvent,worldStamp,checkedChunks:ledger.size,active:active&&{zone:active.zone,site:active.site,phase:active.phase,wave:active.wave,actors:active.actors.size},downedByRoot,overkill}),
    __test:Object.freeze({chunkOf,siteInChunk,npcInChunk,BASE_CHANCE,WAVES})});
  window.DevCompanion?.registerStateProvider?.('rootledoots',window.Rootledoots.debugSnapshot);
})();
