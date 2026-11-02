#!/usr/bin/env node
'use strict';
// Full game smoke for Hachutu's developer-only encounter composer, rendered
// player root grab, and paid-dodge release. Requires Playwright + Three.js.
// CI launches this after the docs server is ready.
const assert=require('node:assert/strict'),fs=require('node:fs');
let chromium;try{({chromium}=require('playwright'));}catch(error){if(error.code==='MODULE_NOT_FOUND'){console.log('skip: playwright unavailable');process.exit(0);}throw error;} // CI's browser job installs Playwright; plain Node regression runners do not.
const URL=process.env.HOBUNJI_TEST_URL||'http://127.0.0.1:8000/index.html?skipIntro=1';
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[],logs=[];
  try{
    for(const [url,file] of Object.entries({
      'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js':'three/build/three.min.js',
      'https://unpkg.com/three@0.128.0/build/three.min.js':'three/build/three.min.js',
      'https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js':'three/examples/js/controls/TransformControls.js',
      'https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js':'three/examples/js/controls/OrbitControls.js',
      'https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js':'three/examples/js/loaders/GLTFLoader.js',
      'https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js':'three/examples/js/exporters/GLTFExporter.js',
    }))await page.route(url,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(require.resolve(file))}));
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('console',entry=>{logs.push(entry.type()+': '+entry.text());if(logs.length>90)logs.shift();});
    await page.addInitScript(()=>{
      window.__hobunjiPlayerProfile={
        playerId:'hachutu-browser-player',characterId:'hachutu-browser-character',
        worldId:'hachutu-browser-world',worldLabel:'Hachutu Browser',
        worldOwnerCharacterId:'hachutu-browser-character',isWorldOwner:true,
        nickname:'Hachutu Browser',farmhandPermissions:{},
        appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{}},
        equippedCosmetics:[],appliedDyes:{},nonGearInventory:{},
        packClothing:[],npcRelationships:{},questProgress:{},isNewWorld:false,
      };
      localStorage.setItem('hobunjiOpeningStory.v1:hachutu-browser-world','complete');
      localStorage.setItem('hobunjiOpeningStory.v1:hachutu-browser-world:farm-tour','complete');
      localStorage.setItem('hobunjiDevMode','1');
      localStorage.removeItem('hobunji.devRandomRuinPuzzleOptions.v2');
    });
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.__hobunjiGameStarted===true
      &&window.DevRandomRuin?.generate&&window.DevHachutuRuin?.debugPreviewSnare
      &&window.RootSnarePlayerTear?.begin&&window.RootSnareHands?.create,
      null,{timeout:120000});
    await page.waitForFunction(()=>window.GridTileAccessors?.getCurrentArea?.()==='interior',
      null,{timeout:120000});
    await page.evaluate(()=>window.HobunjiTitleScreen?.start?.());
    await page.waitForFunction(()=>!window.HobunjiTitleScreen?.isActive?.(),null,{timeout:15000});
    const progressPoll=setInterval(()=>{
      page.evaluate(()=>({progress:window.DevRandomRuin?.getGenerationProgress?.(),
        audit:window.DevRandomRuin?.getLastSolvabilityAudit?.(),area:window.GridTileAccessors?.getCurrentArea?.()}))
        .then(data=>console.log('[Hachutu generation trace]',JSON.stringify(data))).catch(()=>{});
    },10000); // A hanging iframe/texture build is now assigned to a precise stage, not guessed from noisy portrait warnings.
    let generated;
    try{generated=await Promise.race([
      page.evaluate(async()=>{
        const ok=await window.DevRandomRuin.generate(0x6ac4b078,{hachutu:true,stoneAge:true,rootMechanisms:true,rootRecipe:{maxBindings:1}}); // One vestibule door keeps CI generation bounded; production binds up to six.
        return {ok,ruin:window.DevHachutuRuin?.debug?.(),area:window.GridTileAccessors.getCurrentArea()};
      }),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Hachutu generation did not finish within 150 seconds; possible stuck V50/root growth')),150000)),
    ]);}finally{clearInterval(progressPoll);} // Bound a hung generator without losing its last phase diagnostics.
    assert.equal(generated.ok,true,'Hachutu generator failed: '+JSON.stringify(generated)+"; "+logs.slice(-9).join(' | '));
    await page.waitForFunction(()=>window.GridTileAccessors?.getCurrentArea?.()==='map_i_dev_random_ruin',
      null,{timeout:30000});
    // Composer modules are initialized by DynamicSurfaces' *next before-render*
    // callback, not synchronously inside DevRandomRuin.generate(). Reading the
    // snapshot returned by generate() races the first actual gameplay frame.
    await page.waitForFunction(()=>window.DevHachutuRuin?.debug?.()?.active===true,
      null,{timeout:30000}).catch(async error=>{
      const state=await page.evaluate(()=>({
        composer:window.DevHachutuRuin?.debug?.(),
        simple:window.DevRandomRuinSimplePuzzles?.snapshot?.(),
        generation:window.DevRandomRuin?.getGenerationProgress?.(),
      }));
      throw new Error('Hachutu composer did not initialize after entering: '+JSON.stringify(state)+' '+logs.slice(-15).join(' | '),{cause:error});
    });
    const built=await page.evaluate(()=>window.DevHachutuRuin.debug());
    assert.equal(built.active,true,'Hachutu composer failed to build: '+JSON.stringify(built));
    assert.equal(built.rooms.length,5,'exact five-room Hachutu ruin was built in the live game');
    assert.equal(built.entered,true,'generating the Hachutu temple must arrive inside it, not in the stripped V50 vestibule');
    assert.equal(built.platforms,15,'root-grown platforms exist in the swing hall');
    assert.equal(built.platformState.moving,12);
    assert.equal(built.platformState.stationaryStone,3);
    assert.equal(built.platformState.movingBaseGeometry,0);
    assert.equal(built.ropes,15,'vine ropes exist in the swing hall');
    assert(built.mergedRootMeshes>0,'static roots must be baked into merged meshes, not ~1,000 individual draw calls');
    await page.waitForFunction(()=>window.DevHachutuRuin.debug().floorRootsReady===true||window.DevHachutuRuin.debug().errors.length>0,null,{timeout:240000});
    const floorRoots=await page.evaluate(()=>window.DevHachutuRuin.debug());
    assert.deepEqual(floorRoots.errors,[],'floor root growth reported errors: '+JSON.stringify(floorRoots.errors));
    assert.equal(floorRoots.floorRoots.filter(entry=>entry.kind==='floor').length,9,'author preview floor root mat grown for five rooms and four passages');
    assert.equal(floorRoots.floorRoots.filter(entry=>entry.kind==='walls').length,5,'author preview wall root weave grown in the five halls');
    assert(floorRoots.floorRoots.every(room=>room.tris>0),'every floor root group carries geometry');
    assert.deepEqual(floorRoots.gates.map(g=>[g.id,g.open,g.blocking]),[['swing',false,true],['labyrinth',false,true]],'both hall exits start sealed by root-grown gates');
    assert(floorRoots.gates.every(g=>g.grown===1),'gate roots are fully grown at the start');
    assert(floorRoots.gates.every(g=>g.onSubstrate),'gate roots grow out of the passage floor root mat, not a private patch');
    await page.evaluate(()=>{for(let i=0;i<3;i++)window.DevHachutuRuin.debugClearRing(0,i);for(let i=0;i<3;i++)window.DevHachutuRuin.debugSever(0);});
    await page.waitForFunction(()=>{const g=window.DevHachutuRuin.debug().gates;return g[0].open&&!g[0].blocking;},null,{timeout:30000});
    const gates=await page.evaluate(()=>window.DevHachutuRuin.debug().gates);
    assert.equal(gates[1].blocking,true,'severing the swing weed must not open the labyrinth gate');
    const vestibule=await page.evaluate(()=>window.DevRandomRuin.getVestibuleRoots());
    assert.deepEqual([vestibule.bindings,vestibule.rooted,vestibule.error],[1,true,null],'vestibule doors are bound to the Root Growth Author: '+JSON.stringify(vestibule));
    assert(vestibule.props>0,'vestibule plateau risers/ladders are rockified stone-age props: '+JSON.stringify(vestibule));
    assert.deepEqual(vestibule.stone?.errors,[],'unbound vestibule doors re-skinned without errors: '+JSON.stringify(vestibule.stone));
    assert(vestibule.stone.doors+vestibule.stone.skippedBound>0,'every vestibule door is either root-bound or stone-age re-skinned');
    assert(built.rockGeometries>0,'wing walls, menhirs, posts and pillars use rockified stone-age geometry');
    // Labyrinth puzzle: three ember seeds at maze dead ends feed the three rings; the weed stays unhittable until all are taken.
    assert.equal(built.seeds.length,3,'three ember seeds hidden in the labyrinth');
    assert.equal(built.plants[1].rings,3,'labyrinth weed starts protected by three fire rings');
    assert.equal(await page.evaluate(()=>window.DevHachutuRuin.debugSever(1)),false,'a ringed labyrinth weed cannot be severed');
    await page.evaluate(()=>{for(let i=0;i<3;i++)window.DevHachutuRuin.debugTakeSeed(i);});
    const afterSeeds=await page.evaluate(()=>window.DevHachutuRuin.debug());
    assert.equal(afterSeeds.plants[1].rings,0,'taking all seeds extinguishes every labyrinth ring');
    assert(afterSeeds.seeds.every(seed=>seed.taken),'every seed is spent');
    // Trial puzzle: all three sap bulbs lit at once, in addition to clearing the waves, exposes the weed.
    assert.equal(built.bulbs.length,3,'three sap bulbs in the trial hall');
    await page.evaluate(()=>{for(let i=0;i<3;i++)window.DevHachutuRuin.debugClearRing(2,i);});
    assert.equal(await page.evaluate(()=>window.DevHachutuRuin.debugSever(2)),false,'wave-cleared weed stays bare-proof until resonance');
    await page.evaluate(()=>{window.DevHachutuRuin.debugStrikeBulb(0);window.DevHachutuRuin.debugStrikeBulb(1);});
    assert.equal((await page.evaluate(()=>window.DevHachutuRuin.debug())).trial.resonance,false,'two bulbs are not enough');
    await page.evaluate(()=>window.DevHachutuRuin.debugStrikeBulb(2));
    assert.equal((await page.evaluate(()=>window.DevHachutuRuin.debug())).trial.resonance,true,'three lit bulbs resonate');
    await page.evaluate(()=>{for(let i=0;i<3;i++){window.DevHachutuRuin.debugSever(1);window.DevHachutuRuin.debugSever(2);}});
    const solved=await page.evaluate(()=>window.DevHachutuRuin.debug());
    assert.deepEqual(solved.plants.map(plant=>plant.dead),[true,true,true],'all three weeds severed once their puzzles are solved');
    assert.equal(solved.heart.open,true,'the Temple Heart seal opens after the three puzzles');
    assert.equal(built.rootHands,10,'ten authored root-hands instantiated in the labyrinth');
    assert(built.snare?.states?.length===10,'real root-hand authoring engine owns ten grasp sources');
    assert.deepEqual(built.errors,[],'Hachutu had hidden composer build errors');
    const grab=await page.evaluate(()=>{
      const triggered=window.DevHachutuRuin.debugPreviewSnare();
      return {triggered,tear:window.RootSnarePlayerTear.debug(),ruin:window.DevHachutuRuin.debug()};
    });
    assert.equal(grab.triggered,true,'real in-game two-grip preview did not start: '+JSON.stringify(grab));
    assert.equal(grab.tear.active,true,'live player snapshot/cinematic was not created: '+JSON.stringify(grab));
    assert.equal(grab.tear.actualPlayerHidden,true,'real character must be hidden while both visual halves animate');
    const unpaid=await page.evaluate(()=>{
      const player=window.Combat?.deps?.player;
      player._grappleEscapeDodgePaid=false;player.dodging=true;player.dodgeT=.3;
      return {paid:player._grappleEscapeDodgePaid,stage:window.RootSnarePlayerTear.debug().stage};
    });
    await page.waitForTimeout(110);
    const underfunded=await page.evaluate(()=>({
      active:window.RootSnarePlayerTear.active(),snapshot:window.DevHachutuRuin.debug().tear
    }));
    assert.equal(unpaid.paid,false);
    assert.equal(underfunded.active,true,'empty-stamina dodge unexpectedly canceled a live two-hand tear: '+JSON.stringify(underfunded));
    // Slow software-rendered CI can drop frames longer than the dodge window; keep the paid roll alive until the ruin update observes it.
    await page.waitForFunction(()=>{
      if(window.RootSnarePlayerTear?.active?.()===false)return true;
      const player=window.Combat?.deps?.player;
      if(player){player._grappleEscapeDodgePaid=true;player.dodging=true;player.dodgeT=.3;}
      return false;
    },null,{timeout:15000,polling:50});
    const cleared=await page.evaluate(()=>({
      tear:window.RootSnarePlayerTear.debug(),
      hands:window.DevHachutuRuin.debug().snare,
      area:window.GridTileAccessors.getCurrentArea(),
    }));
    assert.equal(cleared.tear.active,false,'paid dodge must cancel the cinematic');
    assert.equal(cleared.hands.dual,false,'paid dodge must release both root hands');
    assert.equal(cleared.area,'map_i_dev_random_ruin','dodge should not leave/respawn from the ruin');
    assert.equal(errors.length,0,'Game page errors: '+errors.slice(-8).join(' | '));
    console.log('PASS Hachutu live game: generated 5-room ruin, ten root hands, live player snapshot, zero-cost dodge denied, paid dodge releases');
  }catch(error){
    console.error('Hachutu live-game diagnostics:',logs.slice(-25).join('\n'));
    console.error('Hachutu pageerrors:',errors.slice(-12).join('\n'));
    throw error;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
