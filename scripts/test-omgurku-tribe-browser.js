'use strict';
// Omgurku as an enemy tribe in the full game: compound hostile avatar, mounted
// weapon, Porakaneki-vs-Omgurku ecology fight, and the two tribes' camp networks.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed (browser-only test)');
  process.exit(0);
}
const root=path.resolve(__dirname,'..');
const types={'.js':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.css':'text/css'};
const server=http.createServer((req,res)=>{
  const relative=decodeURIComponent((req.url||'/').split('?')[0]).replace(/^\/+/,'');
  const absolute=path.resolve(root,relative);
  if(!absolute.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(absolute,(error,data)=>{
    if(error){res.writeHead(404);return res.end('Missing '+relative);}
    res.setHeader('Content-Type',types[path.extname(absolute)]||'application/octet-stream');
    res.end(data);
  });
});
// A wedged Chromium (software WebGL under load) must not keep this process alive after the result is known: the test printed
// "passed" and then hung until the CI step was killed. Bound the close, then exit explicitly with the real result code.
async function closeBounded(browser){
  try{await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,20000))]);}catch(_){/* already closed */}
}
function exitWithResult(){setImmediate(()=>process.exit(process.exitCode||0));}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:800}});
    // Optional installed Three.js package makes this smoke test independent of CDN access.
    if(process.env.HOBUNJI_THREE_TEST_ROOT)await page.route('https://esm.sh/**',async route=>{
      const suffix=new URL(route.request().url()).pathname.replace(/^\/three@[^/]+\/?/,'');
      const relative=suffix||'build/three.module.js'; // Use the same version as the game's configured CDN module.
      const base=path.resolve(process.env.HOBUNJI_THREE_TEST_ROOT);
      const file=path.resolve(base,relative);
      if(!file.startsWith(base+path.sep))return route.abort();
      try{await route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8').replace(/from ['"']three['"']/g,"from 'https://esm.sh/three@0.128.0'")});}
      catch(error){await route.abort();}
    });
    if(process.env.HOBUNJI_THREE_TEST_ROOT)await page.route('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(process.env.HOBUNJI_THREE_TEST_ROOT,'build/three.min.js'))}));
    await page.route('https://unpkg.com/three@0.128.0/**',async route=>{
      const relative=new URL(route.request().url()).pathname.replace('/three@0.128.0/',''); // Serve the game dependencies without a CDN dependency.
      const base=process.env.HOBUNJI_THREE_TEST_ROOT;
      if(!base)return route.continue();
      try{await route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(base,relative))});}catch(_){await route.abort();}
    });
    await page.addInitScript(()=>{
      window.__hobunjiPlayerProfile={playerId:'tribe-test',characterId:'tribe-test',worldId:'tribe-test',worldLabel:'Tribe QA',
        worldOwnerCharacterId:'tribe-test',isWorldOwner:true,nickname:'Tribe QA',farmhandPermissions:{},
        appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{}},equippedCosmetics:[],appliedDyes:{},nonGearInventory:{},
        packClothing:[],npcRelationships:{},questProgress:{},isNewWorld:false};
      localStorage.setItem('hobunjiOpeningStory.v1:tribe-test','complete');
      localStorage.setItem('hobunjiOpeningStory.v1:tribe-test:farm-tour','complete');
    });
    await page.route('**/config/npcs/hobunji-starter-npc-database.json*',route=>{
      const database=JSON.parse(fs.readFileSync(path.join(root,'docs/config/npcs/hobunji-starter-npc-database.json'),'utf8')); // Keep this full-game fixture focused on the actors it creates.
      database.npcs=[];return route.fulfill({contentType:'application/json',body:JSON.stringify(database)});
    });
    const errors=[]; // Report newly raised exceptions during actor creation separately from baseline game initialization.
    page.on('pageerror',error=>{errors.push(String(error));console.error('game page error:',String(error));});
    await page.goto('http://127.0.0.1:'+server.address().port+'/docs/index.html?skipIntro=1&skipRescue=1&skipMeeting=1',
      {waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>window.__hobunjiGameStarted&&window.RomanceSystem?.helpers.deps(),null,{timeout:180000});
    await page.evaluate(()=>window.HobunjiTitleScreen?.start?.());
    await page.waitForFunction(()=>window.GridTileAccessors.getCurrentArea()==='interior',null,{timeout:120000});
    const baseline=errors.length;
    const SHOTS=process.env.OMGURKU_TRIBE_SHOTS||''; // Optional directory for visual review screenshots.
    await page.evaluate(()=>window.DevSpawner.teleportToDevArena());
    await page.waitForFunction(()=>window.GridTileAccessors.getCurrentArea()==='map_dev_arena',null,{timeout:60000});
    await page.waitForFunction(()=>window.OmgurkuCamps?.debugSnapshot().configReady&&window.PorakanekiCamps?.debugSnapshot().configReady,null,{timeout:60000});
    await page.evaluate(()=>{window.__spawnTribeQa=async()=>{
      const deps=window.Combat.deps,cfg=await window.BanditCombat.loadGangConfig();
      const chunkSize=window.PorakanekiCamps.__test.streamChunkSizeTiles();
      const chunkCol=Math.floor(deps.player.x/deps.TILE/chunkSize),chunkRow=Math.floor(deps.player.y/deps.TILE/chunkSize);
      const centerCol=Math.max(chunkCol*chunkSize+1.5,Math.min(deps.player.x/deps.TILE,(chunkCol+1)*chunkSize-1.5));
      const centerRow=Math.max(chunkRow*chunkSize+1.5,Math.min(deps.player.y/deps.TILE,(chunkRow+1)*chunkSize-1.5));
      const spawn=async(tribeId,dx)=>{
        const x=(centerCol+dx)*deps.TILE,y=centerRow*deps.TILE;
        const make=()=>window.BanditCombat.makeEntity({...cfg,speciesWeights:{[tribeId]:1},rangedWeaponChanceByRank:{grunt:0,lieutenant:0,captain:0}},'grunt',0,x,y,{
          zoneId:'map_dev_arena',nameOverride:tribeId+' QA',
          defOverride:{weaponKey:'hatchet',weaponShapeKey:'hatchet'},
          extra:{homeX:x,homeY:y,state:'idle',isTribeHunter:true,tribeId,isPorakanekiHunter:tribeId==='porakaneki',porakanekiCampId:tribeId+'_qa_camp',_porakanekiPlannerControlled:true}});
        // The weapon holder is built at spawn and stays null (the hostile is unarmed for good) if the weapon's texture is still loading;
        // the first attempt starts that load. Respawn until it is armed instead of racing the load (bounded).
        const armedDeadline=performance.now()+150000; // Texture loads can take minutes on a loaded CI runner.
        let entity;
        for(;;){
          entity=await make();
          if(entity._banditToolHolder)break;
          window.BanditCombat.discardEntity(entity);
          if(performance.now()>armedDeadline)throw new Error('The hatchet tool texture never loaded, so the '+tribeId+' hostile could not be armed');
          await new Promise(resolve=>setTimeout(resolve,500));
        }
        entity.def.aggroRangePx=0;deps.hostileObjects.add(entity);return entity;
      };
      const omg=await spawn('omgurku',-0.25),pora=await spawn('porakaneki',0.25);
      window.__tribeQa={omg,pora};
      const ref=omg.avatarRef;
      for(let i=0;i<3;i++)await new Promise(resolve=>requestAnimationFrame(resolve)); // Let the hostile loop pose the weapon once.
      const rider=new THREE.Vector3();ref.riderMount.riderFrame.getWorldPosition(rider);
      const holder=omg._banditToolHolder?.position;
      const floorY=ref.group.position.y-omg.halfHeight;
      return {omg:!!omg,pora:!!pora,species:omg.rosterRecord?.appearance?.speciesId,compound:!!ref.riderMount,
        enemyClass:omg.enemyClass,backChildren:ref.backPlane.children.length,
        holderToRider:holder?Math.hypot(holder.x-rider.x,holder.z-rider.z):null,
        holderAboveFloor:holder?holder.y-floorY:null,riderFloorY:rider.y-floorY,
        riderHandY:rider.y-floorY+(ref.riderMount.upper.scale.x||1)*(Number(ref.handAttachY)||0),groundHandY:Number(ref.handAttachY)||0,
        live:window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount};
    };});
    // The yearly Tothal Shift finishes some time after a world starts and ends with clearHostileObjects(), which despawns EVERY hostile,
    // including these two. When that lands after the spawn their weapon holders are disposed (null) and they keep stale target flags but
    // are never simulated again, so no amount of waiting can produce a fight. That one cause made this smoke fail on main some runs at
    // the weapon-holder check and others at the first-hit wait. Detect the wipe at each stage and respawn the pair (bounded).
    const explainStall=async(stage,error)=>{ // A bare "Timeout exceeded" says nothing about WHY the fighters never fought.
      const state=await page.evaluate(()=>{const {omg,pora}=window.__tribeQa||{},live=window.Combat.deps.hostileObjects,T=window.Combat.deps.TILE;
        const pick=e=>e?{state:e.state,hp:e.health+'/'+e.maxHealth,inHostileSet:live.has(e),avatarAttached:!!e.avatarRef?.group?.parent,hasWeaponHolder:!!e._banditToolHolder,targetsRival:!!e._chunkCombatTarget,attackBusy:!!e._enemyAttackBusyLastFrame,x:+(e.x/T).toFixed(2),y:+(e.y/T).toFixed(2)}:null;
        return {omg:pick(omg),pora:pick(pora),area:window.GridTileAccessors.getCurrentArea(),hostiles:live.size};}).catch(()=>null);
      return new Error(`${error.message}\n[${stage}] fighter state at timeout: ${JSON.stringify(state)}`); // New Error: a mutated message would not show in the already-captured stack that console.error prints.
    };
    let fought=false,spawned=null;
    for(let attempt=0;attempt<3&&!fought;attempt++){
      spawned=await page.evaluate(()=>window.__spawnTribeQa());
      if(spawned.holderToRider==null)continue; // Wiped between spawn and measurement.
      assert(spawned.omg&&spawned.pora,'both tribe hunters build through BanditCombat');
      assert.equal(spawned.species,'omgurku');
      assert(spawned.compound,'Omgurku hostile keeps a compound rider+quadruped avatar');
      assert.equal(spawned.enemyClass,'omgurku-hunter');
      assert.equal(spawned.backChildren,0,'no rigid back plane is extracted from the compound');
      assert(spawned.holderToRider<0.9,`Omgurku weapon stays at the mounted rider (${spawned.holderToRider})`);
      assert(Math.abs(spawned.holderAboveFloor-spawned.riderHandY)<0.3,`weapon sits at the mounted rider's hand height (hand ${spawned.riderHandY}, weapon ${spawned.holderAboveFloor})`);
      // Let the shared hostile loop and the 5 Hz tribe ecology pass run.
      const engaged=await page.waitForFunction(()=>{const {omg,pora}=window.__tribeQa,live=window.Combat.deps.hostileObjects;
        if(!live.has(omg)||!live.has(pora))return 'wiped';
        return omg._chunkCombatTarget===pora&&pora._chunkCombatTarget===omg?'engaged':false;},null,{timeout:90000}).then(handle=>handle.jsonValue()).catch(async error=>{throw await explainStall('waiting for the tribes to target each other',error);}); // Software-rendered CI frames are slow, so the 5 Hz ecology pass needs generous headroom.
      if(engaged==='wiped')continue;
      // The fight is pure simulation, and the game loop caps each frame at 0.04 s of simulated time. With software-rendered 3D, CI frames
      // can take seconds, so a wall-clock wait bought only a few seconds of combat. Skip rasterization while the fight plays out so simulated
      // time tracks wall time instead of runner speed; the renderer is restored immediately after, before any screenshot or later check.
      await page.evaluate(()=>{const renderer=window.__hobunjiGameRenderer;window.__tribeRestoreRender=renderer.render;renderer.render=function(){};});
      let outcome;
      try{
        outcome=await page.waitForFunction(()=>{const {omg,pora}=window.__tribeQa,live=window.Combat.deps.hostileObjects;
          if(!live.has(omg)||!live.has(pora))return 'wiped';
          return omg.health<omg.maxHealth||pora.health<pora.maxHealth?'hit':false;},null,{timeout:180000}).then(handle=>handle.jsonValue()).catch(async error=>{throw await explainStall('waiting for the first hit',error);}); // Allow several attack cycles.
      }finally{
        await page.evaluate(()=>{if(window.__tribeRestoreRender){window.__hobunjiGameRenderer.render=window.__tribeRestoreRender;window.__tribeRestoreRender=null;}});
      }
      fought=outcome==='hit';
    }
    assert(fought,'the two tribe hunters spawn armed, engage and trade a hit within three spawn attempts');
    if(SHOTS){
      await page.evaluate(()=>{for(const id of ['ob-overlay','save-startup-gate'])document.getElementById(id)?.style.setProperty('display','none');if(window.Combat.deps.playerMesh)window.Combat.deps.playerMesh.visible=false;}); // Review-only: reveal the fighters under the new-world overlay and behind the player.
      await page.screenshot({path:path.join(SHOTS,'tribe-fight.png')});
    }
    const fight=await page.evaluate(()=>{const {omg,pora}=window.__tribeQa;
      return {neutral:[omg._porakanekiPlannerControlled,pora._porakanekiPlannerControlled],health:[omg.health,pora.health]};});
    assert.deepEqual(fight.neutral,[true,true],'tribe-vs-tribe fighting keeps both neutral to the player');
    const wildernessZones=await page.evaluate(()=>window.WildernessMapGenerator.zoneMapIds());
    await page.evaluate(()=>{window.__hobunjiPlayerProfile.isWorldOwner=false;}); // This test uses the debug travel seam, not the owner's opening-story gate.
    for(const zoneId of wildernessZones){
      const zone=await page.evaluate(async id=>{
        await window.__hobunjiFurnitureDebug.enterZoneDebug(id);
        const entered=window.GridTileAccessors.getCurrentArea()===id&&window.Combat.deps.zoneLayouts.has(id);
        if(!entered)return {entered:false,porakaneki:false,omgurku:false};
        window.PorakanekiCamps.ensureWorldCamps();
        window.OmgurkuCamps.ensureWorldCamps();
        return {entered:true,
          porakaneki:!!window.PorakanekiCamps.debugSnapshot().zones[id],
          omgurku:!!window.OmgurkuCamps.debugSnapshot().zones[id]};
      },zoneId);
      assert(zone.entered,`zone transition completes with its layout loaded (${zoneId})`);
      assert(zone.porakaneki&&zone.omgurku,`both tribe camp networks initialize in ${zoneId}`);
    }
    await page.evaluate(()=>window.DevSpawner.teleportToDevArena());
    await page.waitForFunction(()=>window.GridTileAccessors.getCurrentArea()==='map_dev_arena',null,{timeout:60000});
    const camps=await page.evaluate(()=>{
      const chunks=api=>Object.keys(api.debugSnapshot().zones).flatMap(zone=>api.reservedCampChunks(zone).map(key=>zone+':'+key));
      const pora=window.PorakanekiCamps.debugSnapshot(),omg=window.OmgurkuCamps.debugSnapshot();
      const poraChunks=new Set(chunks(window.PorakanekiCamps));
      return {tribes:window.TribeCamps.list().map(t=>t.tribeId),omgZones:Object.keys(omg.zones).length,
        omgSmall:omg.totalSmallCamps,poraSmall:pora.totalSmallCamps,
        overlap:chunks(window.OmgurkuCamps).filter(key=>poraChunks.has(key)),
        chiefs:[pora.chiefZoneId,omg.chiefZoneId],omgFavor:omg.favor};
    });
    assert.deepEqual(camps.tribes,['porakaneki','omgurku']);
    assert.equal(camps.omgZones,4,'Omgurku camps exist on all four wilderness maps');
    assert(camps.omgSmall>=4,'every wilderness map keeps at least one Omgurku hunting camp');
    assert(Math.abs(camps.omgSmall-camps.poraSmall)<=4,`rival tribes get comparable hunting camps (${camps.omgSmall} Omgurku / ${camps.poraSmall} Porakaneki)`);
    assert.deepEqual(camps.overlap,[],'Omgurku camps never share a stream chunk with Porakaneki camps');
    assert.notEqual(camps.chiefs[0],camps.chiefs[1],'the two chief camps are on different maps');
    const removed=await page.evaluate(()=>{
      const {omg,pora}=window.__tribeQa;
      const wasAttached=!!omg.avatarRef?.group?.parent; // Camp ecology may already have released this hostile on a slow runner.
      const before=window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount; // Camp ecology may spawn other live Omgurku since the first count.
      for(const entity of [omg,pora]){window.Combat.deps.hostileObjects.delete(entity);window.BanditCombat.discardEntity(entity);}
      delete window.__tribeQa;
      return {before,wasAttached,after:window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount};
    });
    assert.equal(removed.after,removed.before-(removed.wasAttached?1:0),'discarding the hostile releases its compound avatar');
    assert.deepEqual(errors.slice(baseline),[],'tribe spawning, fighting and cleanup raise no exceptions');
    console.log('Omgurku tribe browser smoke passed',JSON.stringify({fight,camps}));
  }finally{await closeBounded(browser);server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;}).finally(exitWithResult);
