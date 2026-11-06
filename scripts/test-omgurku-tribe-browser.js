'use strict';
// Omgurku as an enemy tribe in the full game: compound hostile avatar, mounted
// weapon, Porakaneki-vs-Omgurku ecology fight, and the two tribes' camp networks.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const shots=process.env.OMGURKU_TRIBE_SHOTS; // Preserve the full viewport for optional visual review.
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
    const page=await browser.newPage({viewport:shots ? {width:1200,height:800} : {width:480,height:320}});
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
    console.log('Omgurku tribe: checking generated wilderness camps');
    // One real wilderness entry waits for the startup Tothal Shift, including its
    // final hostile wipe. Both networks place camps from layouts for all four
    // maps, so the other three maps do not need to build full 3D scenes.
    const wildernessZones=await page.evaluate(()=>window.WildernessMapGenerator.zoneMapIds());
    assert.equal(wildernessZones.length,4,'the fixture covers the four wilderness maps');
    const entryZone=wildernessZones[0]; // The single transition smoke also serves as the startup generation barrier.
    await page.evaluate(async id=>{
      window.__hobunjiPlayerProfile.isWorldOwner=false; // Bypass the opening-story travel gate in this fixture.
      await window.__hobunjiFurnitureDebug.enterZoneDebug(id);
    },entryZone);
    assert.equal(await page.evaluate(()=>window.GridTileAccessors.getCurrentArea()),entryZone,
      'zone transition completes after startup wilderness generation');
    await page.waitForFunction(()=>[window.PorakanekiCamps,window.OmgurkuCamps].every(api=>{
      const snapshot=api?.debugSnapshot(); // Camp initialization requires both locale definitions as well as config.
      return snapshot?.configReady&&snapshot.localesReady&&snapshot.combatDepsReady;
    }),null,{timeout:60000,polling:250});
    const camps=await page.evaluate(zones=>{
      const pora=window.PorakanekiCamps,omg=window.OmgurkuCamps; // Read the real networks against generated layouts.
      pora.ensureWorldCamps();
      omg.ensureWorldCamps();
      const poraState=pora.debugSnapshot(),omgState=omg.debugSnapshot();
      const missing=zones.filter(id=>!window.Combat.deps.zoneLayouts.has(id)||!poraState.zones[id]||!omgState.zones[id]);
      const overlap=zones.flatMap(id=>{
        const occupied=new Set(pora.reservedCampChunks(id)); // Compare reservations within each wilderness map.
        return omg.reservedCampChunks(id).filter(key=>occupied.has(key)).map(key=>id+':'+key);
      });
      return {tribes:window.TribeCamps.list().map(t=>t.tribeId),missing,overlap,
        omgSmall:omgState.totalSmallCamps,poraSmall:poraState.totalSmallCamps,
        chiefs:[poraState.chiefZoneId,omgState.chiefZoneId]};
    },wildernessZones);
    assert.deepEqual(camps.tribes,['porakaneki','omgurku']);
    assert.deepEqual(camps.missing,[],'both tribe camp networks initialize on all four generated wilderness maps');
    assert(camps.omgSmall>=4,'every wilderness map keeps at least one Omgurku hunting camp');
    assert(Math.abs(camps.omgSmall-camps.poraSmall)<=4,`rival tribes get comparable hunting camps (${camps.omgSmall} Omgurku / ${camps.poraSmall} Porakaneki)`);
    assert.deepEqual(camps.overlap,[],'Omgurku camps never share a stream chunk with Porakaneki camps');
    assert.notEqual(camps.chiefs[0],camps.chiefs[1],'the two chief camps are on different maps');

    console.log('Omgurku tribe: building the arena fighters');
    await page.evaluate(()=>window.DevSpawner.teleportToDevArena());
    await page.waitForFunction(()=>window.GridTileAccessors.getCurrentArea()==='map_dev_arena',null,{timeout:60000});
    const spawned=await page.evaluate(async()=>{ // Build each hostile once through the real combat factory.
      const deps=window.Combat.deps,cfg=await window.BanditCombat.loadGangConfig();
      const chunkSize=window.PorakanekiCamps.__test.streamChunkSizeTiles();
      const chunkCol=Math.floor(deps.player.x/deps.TILE/chunkSize),chunkRow=Math.floor(deps.player.y/deps.TILE/chunkSize);
      const centerCol=Math.max(chunkCol*chunkSize+1.5,Math.min(deps.player.x/deps.TILE,(chunkCol+1)*chunkSize-1.5));
      const centerRow=Math.max(chunkRow*chunkSize+1.5,Math.min(deps.player.y/deps.TILE,(chunkRow+1)*chunkSize-1.5));
      const spawn=async(tribeId,dx)=>{
        const x=(centerCol+dx)*deps.TILE,y=centerRow*deps.TILE;
        const entity=await window.BanditCombat.makeEntity({...cfg,speciesWeights:{[tribeId]:1},weaponShapePool:['hatchet'],rangedWeaponChanceByRank:{grunt:0}},'grunt',0,x,y,{
          zoneId:'map_dev_arena',nameOverride:tribeId+' QA',
          defOverride:{weaponKey:'hatchet',weaponShapeKey:'hatchet'},
          extra:{homeX:x,homeY:y,state:'idle',isTribeHunter:true,tribeId,isPorakanekiHunter:tribeId==='porakaneki',porakanekiCampId:tribeId+'_qa_camp',_porakanekiPlannerControlled:true}});
        if(!entity?._banditToolHolder)throw new Error(`${tribeId} spawned without its ${entity?.def?.weaponKey||'hatchet'} holder`);
        entity.def.aggroRangePx=0;deps.hostileObjects.add(entity);return entity;
      };
      const omg=await spawn('omgurku',-0.4),pora=await spawn('porakaneki',0.4); // Start within hatchet reach so the smoke tests attack dispatch, not arena navigation.
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
    });
    assert(spawned.omg&&spawned.pora,'both tribe hunters build through BanditCombat');
    assert.equal(spawned.species,'omgurku');
    assert(spawned.compound,'Omgurku hostile keeps a compound rider+quadruped avatar');
    assert.equal(spawned.enemyClass,'omgurku-hunter');
    assert.equal(spawned.backChildren,0,'no rigid back plane is extracted from the compound');
    assert(spawned.holderToRider<0.9,`Omgurku weapon stays at the mounted rider (${spawned.holderToRider})`);
    assert(Math.abs(spawned.holderAboveFloor-spawned.riderHandY)<0.3,`weapon sits at the mounted rider's hand height (hand ${spawned.riderHandY}, weapon ${spawned.holderAboveFloor})`);

    console.log('Omgurku tribe: waiting for rival targeting and damage');
    // After measuring the rendered pose, keep the real simulation ticking without
    // SwiftShader rasterization. Slow frames advance at most 0.04 s of game time.
    await page.evaluate(()=>{
      const renderer=window.__hobunjiGameRenderer; // Restore the actual renderer before the optional screenshot.
      window.__tribeRestoreRender=renderer.render;
      renderer.render=function(){};
    });
    let fight;
    try{
      const result=await page.waitForFunction(()=>{
        const {omg,pora}=window.__tribeQa,live=window.Combat.deps.hostileObjects;
        const engaged=omg._chunkCombatTarget===pora&&pora._chunkCombatTarget===omg;
        const hit=omg.health<omg.maxHealth||pora.health<pora.maxHealth;
        if(!live.has(omg)||!live.has(pora))return {despawned:true};
        return engaged&&hit&&{neutral:[omg._porakanekiPlannerControlled,pora._porakanekiPlannerControlled],health:[omg.health,pora.health]};
      },null,{timeout:30000,polling:100}); // Both targeting and damage must come from the live game loop.
      fight=await result.jsonValue();
    }catch(error){
      const state=await page.evaluate(()=>{
        const {omg,pora}=window.__tribeQa;
        const pick=e=>({state:e.state,hp:e.health+'/'+e.maxHealth,weapon:e.def.weaponKey,
          targetsRival:!!e._chunkCombatTarget,attackBusy:!!e._enemyAttackBusyLastFrame,x:e.x,y:e.y});
        return {omg:pick(omg),pora:pick(pora),area:window.GridTileAccessors.getCurrentArea()};
      }).catch(()=>null); // A crashed page may no longer be able to report fighter state.
      throw new Error(`Rival fight did not land a hit. Fighter state: ${JSON.stringify(state)}`,{cause:error});
    }finally{
      await page.evaluate(()=>{
        window.__hobunjiGameRenderer.render=window.__tribeRestoreRender;
        delete window.__tribeRestoreRender;
      });
    }
    assert(!fight.despawned,'both hunters stay live until the fight lands a hit');
    assert.deepEqual(fight.neutral,[true,true],'tribe-vs-tribe fighting keeps both neutral to the player');
    if(shots){
      await page.evaluate(()=>{for(const id of ['ob-overlay','save-startup-gate'])document.getElementById(id)?.style.setProperty('display','none');if(window.Combat.deps.playerMesh)window.Combat.deps.playerMesh.visible=false;}); // Review-only: reveal the fighters under the new-world overlay and behind the player.
      await page.screenshot({path:path.join(shots,'tribe-fight.png')});
    }
    const removed=await page.evaluate(()=>{
      const {omg,pora}=window.__tribeQa;
      const before=window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount; // Compare counts in one browser task around explicit disposal.
      for(const entity of [omg,pora]){window.Combat.deps.hostileObjects.delete(entity);window.BanditCombat.discardEntity(entity);}
      delete window.__tribeQa;
      return {before,after:window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount};
    });
    assert.equal(removed.after,removed.before-1,'discarding the hostile releases its compound avatar');
    assert.deepEqual(errors.slice(baseline),[],'tribe spawning, fighting and cleanup raise no exceptions');
    console.log('Omgurku tribe browser smoke passed',JSON.stringify({fight,camps}));
  }finally{await closeBounded(browser);server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;}).finally(exitWithResult);
