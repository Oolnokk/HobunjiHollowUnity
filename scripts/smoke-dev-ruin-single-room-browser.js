'use strict';
// Real Chromium smoke: the isolated V50 room must initialize its selected live
// puzzle, suppress all other floors/rewards, and cleanly reroll on the same map.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const URL=process.env.HOBUNJI_TEST_URL||'http://127.0.0.1:8000/index.html?skipIntro=1';

async function main(){
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:800,height:600}});
  const errors=[]; // Printed on a headless failure so mobile testers do not need a devtools console.
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  try{
    const deps={
      'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js':'three/build/three.min.js',
      'https://unpkg.com/three@0.128.0/build/three.min.js':'three/build/three.min.js',
      'https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js':'three/examples/js/controls/TransformControls.js',
      'https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js':'three/examples/js/controls/OrbitControls.js',
      'https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js':'three/examples/js/loaders/GLTFLoader.js',
      'https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js':'three/examples/js/exporters/GLTFExporter.js',
    };
    for(const [url,file] of Object.entries(deps))
      await page.route(url,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(require.resolve(file))}));
    await page.addInitScript(()=>{
      window.__hobunjiPlayerProfile={
        playerId:'solo-puzzle-test-player',characterId:'solo-puzzle-test-character',
        worldId:'solo-puzzle-test-world',worldLabel:'Solo Puzzle Test',
        worldOwnerCharacterId:'solo-puzzle-test-character',isWorldOwner:true,
        nickname:'Solo Puzzle Test',farmhandPermissions:{},
        appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{}},
        equippedCosmetics:[],appliedDyes:{},nonGearInventory:{},
        packClothing:[],npcRelationships:{},questProgress:{},isNewWorld:false,
      };
      localStorage.setItem('hobunjiOpeningStory.v1:solo-puzzle-test-world','complete');
      localStorage.setItem('hobunjiOpeningStory.v1:solo-puzzle-test-world:farm-tour','complete');
      localStorage.setItem('hobunjiDevMode','1');
      localStorage.removeItem('hobunji.devRandomRuinPuzzleOptions.v2');
    });
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.__hobunjiGameStarted===true&&!!window.DevRandomRuinSimplePuzzles
      &&!!window.DevRuinSingleRoomTrial&&!!window.RuinLayerChallenges,null,{timeout:120000});
    await page.waitForFunction(()=>window.GridTileAccessors?.getCurrentArea?.()==='interior',null,{timeout:120000});
    await page.evaluate(()=>window.HobunjiTitleScreen?.start?.());
    await page.waitForFunction(()=>!window.HobunjiTitleScreen?.isActive?.(),null,{timeout:20000});
    const ui=await page.evaluate(()=>({
      button:!!document.getElementById('devRandomRuinSingleRoomBtn'),
      options:[...document.querySelector('#devRandomRuinSinglePuzzleType')?.options||[]].map(o=>o.value),
    }));
    assert.equal(ui.button,true);
    assert.deepEqual(ui.options,['weighted','glyphObelisk','ceilingRailTargets','timedMelody','dungeonFire','ropeChain','statueDefense','nativeBrazier','nativeGlyphObelisk','nativeStackedObelisk','nativeLinkedCubePillars','nativePushBlock','findBlocks']);

    // One specific puzzle, and the genuine projectile-target runtime must link.
    const forced=await page.evaluate(seed=>window.DevRandomRuin.generate(seed,{
      singleRoomTrial:true,puzzleType:'glyphObelisk',
    }),0x51a7cafe);
    assert.equal(forced,true,'V50 glyph lab must enter successfully');
    await page.waitForFunction(()=>window.DevRandomRuinSimplePuzzles?.snapshot?.().singleRoomChallenge?.linked===true,null,{timeout:20000});
    let info=await page.evaluate(()=>({
      state:window.DevRandomRuin.getState(),runtime:window.DevRandomRuin.getRuntimeContext(),
      puzzle:window.DevRandomRuinSimplePuzzles.snapshot().singleRoomChallenge,
    }));
    assert.equal(info.state.rooms,1);
    assert.equal(info.state.shaftHub,false);
    assert.equal(info.runtime.sanctumPlan,null);
    assert.equal(info.runtime.noLoot,true);
    assert.equal(info.puzzle.kind,'glyphObelisk');
    assert.equal(info.puzzle.mode,'forced');
    assert.equal(info.puzzle.ready,true);

    // The weighted pick must match its actual planner draw and reroll into one room.
    const weighted=await page.evaluate(async()=>{
      const seed=2;
      const expected=window.DevRuinSingleRoomTrial.pick(seed,'weighted').kind;
      const ok=await window.DevRandomRuin.generate(seed,{singleRoomTrial:true,puzzleType:'weighted'});
      return {ok,expected};
    });
    assert.equal(weighted.ok,true,'weighted lab must enter');
    await page.waitForFunction(()=>window.DevRandomRuinSimplePuzzles?.snapshot?.().singleRoomChallenge?.ready===true,null,{timeout:20000});
    info=await page.evaluate(()=>({
      state:window.DevRandomRuin.getState(),runtime:window.DevRandomRuin.getRuntimeContext(),
      puzzle:window.DevRandomRuinSimplePuzzles.snapshot().singleRoomChallenge,
    }));
    assert.equal(info.state.rooms,1);
    assert.equal(info.runtime.noLoot,true);
    assert.equal(info.puzzle.kind,weighted.expected);
    assert.equal(info.puzzle.mode,'weighted');
    assert.notEqual(info.puzzle.kind,'pressurePlate','weighted mode must not select retired pressure plates');
    const removedPlate=await page.evaluate(()=>{
      try{window.DevRuinSingleRoomTrial.pick(2,'pressurePlate');return false;}
      catch(error){return /Unknown single-room puzzle/.test(String(error));}
    });
    assert.equal(removedPlate,true,'direct/API selection must also reject retired pressure plates');

    // Rope mode physically removes the central support and links the native
    // mid-air rope chain rather than displaying a cosmetic chasm.
    const rope=await page.evaluate(seed=>window.DevRandomRuin.generate(seed,{
      singleRoomTrial:true,puzzleType:'ropeChain',
    }),0x2468ace0);
    assert.equal(rope,true,'rope-chain lab must enter');
    await page.waitForFunction(()=>window.DevRandomRuinSimplePuzzles?.snapshot?.().singleRoomChallenge?.ropeLinked===true,null,{timeout:20000});
    const ropeInfo=await page.evaluate(()=>{
      const runtime=window.DevRandomRuin.getRuntimeContext();
      const simple=window.DevRandomRuinSimplePuzzles.snapshot();
      const state=window.DevRandomRuin.getState(); // Integration diagnostics expose visual floor-backing cutouts, independent of collision.
      const room=runtime.meta.rooms[0],cs=(Number(runtime.meta.cellSize)||.5)*2;
      const minX=2+room.col*cs,minZ=2+room.row*cs;
      const center={x:minX+room.w*cs/2,z:minZ+room.h*cs/2};
      return {
        rooms:runtime.meta.rooms.length,
        challenge:simple.singleRoomChallenge,
        chains:simple.ropeChains.length,
        voidAtCenter:!!window.DynamicSurfaces.pointInPit(center.x,center.z),
        centerSupport:window.DynamicSurfaces.sampleSupport(center.x,center.z,{scope:'dev-random-ruin-interior'})?.id||null,
        floorShellRepair:state.floorShellRepair, // Number of visual backing cells after the rope pit is punched through it.
        sourceFloorCells:runtime.meta.floorCells.length, // Original V50 source floor count, before any pit exclusions.
        floorShellCutouts:state.floorShellCutouts, // One cutout expected for the single-room rope abyss.
      };
    });
    assert.equal(ropeInfo.rooms,1);
    assert.equal(ropeInfo.chains,1);
    assert.equal(ropeInfo.voidAtCenter,true);
    assert.equal(ropeInfo.centerSupport,null,'the rope abyss must have no ordinary V50 floor support');
    assert.equal(ropeInfo.floorShellCutouts,1,'rope pit must request one visual seam-backing cutout');
    assert.ok(ropeInfo.floorShellRepair>0&&ropeInfo.floorShellRepair<ropeInfo.sourceFloorCells,
      'rope abyss must physically omit seam backing while preserving safe bank repairs: '+JSON.stringify(ropeInfo));

    // Native V50 mode must mount an original V50 obelisk and linked stone door.
    const native=await page.evaluate(seed=>window.DevRandomRuin.generate(seed,{
      singleRoomTrial:true,puzzleType:'nativeStackedObelisk',
    }),0x4ed17f2a);
    assert.equal(native,true,'native V50 obelisk lab must enter');
    await page.waitForFunction(()=>window.DevRandomRuinSimplePuzzles?.snapshot?.().singleRoomChallenge?.ready===true,null,{timeout:20000});
    const nativeInfo=await page.evaluate(()=>({
      state:window.DevRandomRuin.getState(),
      puzzle:window.DevRandomRuinSimplePuzzles.snapshot().singleRoomChallenge,
      mechanism:window.DevRandomRuin.mechanismInfo('single_room_native_v50_goal'),
    }));
    assert.equal(nativeInfo.state.rooms,1);
    assert.equal(nativeInfo.state.noLoot,true);
    assert.equal(nativeInfo.state.floorShellCutouts,0,'new puzzle lab scene cannot inherit the prior rope abyss seam mask');
    assert.equal(nativeInfo.puzzle.kind,'nativeStackedObelisk');
    assert.equal(nativeInfo.puzzle.linked,true);
    assert.equal(nativeInfo.state.puzzleGeneration.nativeLab.kind,'stackedObelisk');
    assert.equal(nativeInfo.mechanism?.gated,true);

    console.log('Browser puzzle lab: glyph, weighted, rope void, native V50 obelisk and real hooks passed.');
  }catch(error){
    console.error('Standalone puzzle lab smoke failure:',error);
    console.error('Recent browser errors:',errors.slice(-25).join('\n'));
    throw error;
  }finally{await browser.close();}
}
main().catch(()=>{process.exitCode=1;});
