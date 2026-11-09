'use strict';
// Actual NPC creation/cleanup smoke for the Omgurku hybrid in the full game.
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
      window.__hobunjiPlayerProfile={playerId:'hybrid-test',characterId:'hybrid-test',worldId:'hybrid-test',worldLabel:'Hybrid QA',
        worldOwnerCharacterId:'hybrid-test',isWorldOwner:true,nickname:'Hybrid QA',farmhandPermissions:{},
        appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{}},equippedCosmetics:[],appliedDyes:{},nonGearInventory:{},
        packClothing:[],npcRelationships:{},questProgress:{},isNewWorld:false};
      localStorage.setItem('hobunjiOpeningStory.v1:hybrid-test','complete');
      localStorage.setItem('hobunjiOpeningStory.v1:hybrid-test:farm-tour','complete');
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
    const built=await page.evaluate(async()=>{
      const deps=window.RomanceSystem.helpers.deps(); // Calls the game's actual makeNpcWalker adapter, not the editor builder.
      const tile=deps.getPlayerTilePosition(),area=deps.getCurrentArea();
      const before=window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount;
      const rec={id:'omgurku-gameplay-qa',name:'Hybrid QA',species:'Omgurku',gender:'male',
        appearance:{speciesId:'omgurku',gender:'male',bodyColors:{A:{hex:'#d04070'}},cosmetics:{}},equippedCosmetics:[],appliedDyes:{}};
      const walker=await deps.spawnNpcRecord(rec,{area,c:Math.floor(tile.x)+1,r:Math.floor(tile.z)});
      window.__omgurkuGameWalker=walker;
      return {before,exists:!!walker,species:walker?.profile?.fighter?.speciesId,lift:walker?.avatarGroup.position.y,
        feet:!!walker?.legs,pants:walker?.rec.equippedCosmetics};
    });
    assert(built.exists&&built.species==='omgurku','authored Omgurku builds through the actual NPC path');
    assert.equal(built.lift,0,'floor-relative hybrid is not given the centered humanoid lift');
    assert.equal(built.feet,false,'hybrid does not grow humanoid legs');
    assert(!built.pants.includes('pants_basic'),'hybrid does not acquire automatic humanoid pants');
    await page.waitForFunction(()=>window.__omgurkuGameWalker.avatarGroup.userData.proceduralHandRig,null,{timeout:15000});
    const movement=await page.evaluate(async()=>{
      const walker=window.__omgurkuGameWalker,root=walker.root; // Exercise the real walker's movement and area-transfer methods.
      const start=root.position.x;
      walker.moveToward(root.position.x+.4,root.position.z,1/10);
      await new Promise(resolve=>setTimeout(resolve,120));
      const moved=root.position.x!==start;
      const join=walker.avatarGroup.userData.omgurkuJoin;
      const oldArea=walker.area,c=Math.floor(root.position.x),r=Math.floor(root.position.z);
      walker.transferToArea('farm',{c,r});
      const transferred=walker.area==='farm'&&!!root.parent;
      walker.transferToArea(oldArea,{c,r});
      return {moved,transferred,joinFinite:Object.values(join).every(Number.isFinite)};
    });
    assert(movement.moved&&movement.transferred&&movement.joinFinite,'hybrid moves and transfers through the ordinary NPC walker without invalid transforms');
    const chair=await page.evaluate(async()=>{
      await window.AuthoredFurniture.load('chairSimple');
      const deps=window.RomanceSystem.helpers.deps(),walker=window.__omgurkuGameWalker;
      const target={area:walker.area,c:Math.floor(walker.root.position.x),r:Math.floor(walker.root.position.z),pose:'sit',furnitureKey:'chairSimple'};
      const seat=deps.seatTransformForTarget(target);
      if(!seat)return {available:false};
      window.NpcScheduling.registerTargetOverride('omgurku-chair-qa',rec=>rec.id===walker.rec.id?target:null);
      walker.root.position.set(seat.x,0,seat.z);walker.state='idle';
      for(let i=0;i<60;i++)walker.update(1/60);
      const y=walker.root.position.y,station=walker._seatedStationKey;
      window.NpcScheduling.registerTargetOverride('omgurku-chair-qa',null);
      return {available:true,y,station};
    });
    assert(chair.available,'chair fixture uses a real authored seat anchor');
    assert(Math.abs(chair.y)<.02,'a resting hybrid never sinks its quadruped body below the floor to fit a humanoid chair');
    const legacy=await page.evaluate(async()=>{
      const deps=window.RomanceSystem.helpers.deps(),walker=window.__omgurkuGameWalker;
      const old=await deps.spawnNpcRecord({id:'omgurku-legacy-qa',name:'Legacy Hybrid',species:'Omgurku',gender:'female'},
        {area:walker.area,c:Math.floor(walker.root.position.x)+1,r:Math.floor(walker.root.position.z)});
      const species=old?.profile?.fighter?.speciesId;
      if(old)deps.despawnNpcWalker(old);
      return species;
    });
    assert.equal(legacy,'omgurku','legacy species-only NPC records keep their hybrid identity');
    await page.waitForFunction(()=>window.__omgurkuGameWalker.avatarGroup.userData.omgurkuComposite.lowerRefs
      .every(ref=>String(ref.frontPlane.material.map?.name||'').startsWith('omgurku-lower|')),null,{timeout:60000}); // Capture the shared coat only after asynchronous tinting replaces the raw frames.
    const shared=await page.evaluate(async()=>{
      const deps=window.RomanceSystem.helpers.deps(),walker=window.__omgurkuGameWalker;
      const refs=walker.avatarGroup.userData.omgurkuComposite.lowerRefs;
      let disposed=0; // A remaining actor must retain all three generated coat maps after another copy despawns.
      const maps=refs.map(ref=>ref.frontPlane.material.map),onDispose=()=>disposed++;
      for(const map of maps)map.addEventListener('dispose',onDispose);
      const copy=await deps.spawnNpcRecord({...JSON.parse(JSON.stringify(walker.rec)),id:'omgurku-roundtrip-qa'},
        {area:walker.area,c:Math.floor(walker.root.position.x)+1,r:Math.floor(walker.root.position.z)});
      await new Promise(resolve=>setTimeout(resolve,250));
      const same=copy.avatarGroup.userData.omgurkuComposite.lowerRefs.every((ref,i)=>ref.frontPlane.material.map===maps[i]);
      deps.despawnNpcWalker(copy);
      for(const map of maps)map.removeEventListener('dispose',onDispose);
      return {same,disposed,stillLive:refs.every(ref=>!window.CreatureTextureCache.isDisposed(ref))};
    });
    assert(shared.same&&shared.stillLive&&shared.disposed===0,'record round-trip shares coats safely and despawning one NPC preserves the other');
    const removed=await page.evaluate(()=>{
      const deps=window.RomanceSystem.helpers.deps(),walker=window.__omgurkuGameWalker;
      deps.despawnNpcWalker(walker);delete window.__omgurkuGameWalker;
      return window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount;
    });
    assert.equal(removed,built.before,'NPC despawn releases the hybrid registry and its visual resources');
    assert.deepEqual(errors.slice(baseline),[],'spawning and despawning hybrids does not raise gameplay exceptions');
    console.log('Omgurku gameplay browser smoke passed');
  }finally{await closeBounded(browser);server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;}).finally(exitWithResult);
