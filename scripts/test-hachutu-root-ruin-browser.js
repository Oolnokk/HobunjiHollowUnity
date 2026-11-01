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
    const generated=await page.evaluate(async()=>{
      const ok=await window.DevRandomRuin.generate(0x6ac4b078,{hachutu:true,stoneAge:true,rootMechanisms:true});
      return {ok,ruin:window.DevHachutuRuin?.debug?.(),area:window.GridTileAccessors.getCurrentArea()};
    });
    assert.equal(generated.ok,true,'Hachutu generator failed: '+JSON.stringify(generated)+"; "+logs.slice(-9).join(' | '));
    await page.waitForFunction(()=>window.GridTileAccessors?.getCurrentArea?.()==='map_i_dev_random_ruin',
      null,{timeout:30000});
    assert.equal(generated.ruin.active,true,'Hachutu composer failed to build: '+JSON.stringify(generated.ruin));
    assert.equal(generated.ruin.rooms.length,5,'exact five-room Hachutu ruin was built in the live game');
    assert.equal(generated.ruin.rootHands,10,'ten authored root-hands instantiated in the labyrinth');
    assert(generated.ruin.snare?.states?.length===10,'real root-hand authoring engine owns ten grasp sources');
    assert.deepEqual(generated.ruin.errors,[],'Hachutu had hidden composer build errors');
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
    await page.evaluate(()=>{
      const player=window.Combat?.deps?.player;player._grappleEscapeDodgePaid=true;
      player.dodging=true;player.dodgeT=.3;
    });
    await page.waitForFunction(()=>window.RootSnarePlayerTear?.active?.()===false,null,{timeout:4000});
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
