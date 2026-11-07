#!/usr/bin/env node
'use strict';
// Playwright integration: actual game scene + movement-support authority, not an isolated editor/VM.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const URL=process.env.HOBUNJI_TEST_URL||'http://127.0.0.1:8000/index.html?skipIntro=1';
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:800,height:600}});
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  const dependencyFiles={
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js':'three/build/three.min.js',
    'https://unpkg.com/three@0.128.0/build/three.min.js':'three/build/three.min.js',
    'https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js':'three/examples/js/controls/TransformControls.js',
    'https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js':'three/examples/js/controls/OrbitControls.js',
    'https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js':'three/examples/js/loaders/GLTFLoader.js',
    'https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js':'three/examples/js/exporters/GLTFExporter.js',
  };
  for(const [url,file] of Object.entries(dependencyFiles))await page.route(url,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(require.resolve(file))}));
  try{
    await page.addInitScript(()=>{
      window.__hobunjiPlayerProfile={
        playerId:'ruin-construction-browser-player',characterId:'ruin-construction-browser-character',
        worldId:'ruin-construction-browser-world',worldLabel:'Construction Browser',
        worldOwnerCharacterId:'ruin-construction-browser-character',isWorldOwner:true,
        nickname:'Construction Browser',farmhandPermissions:{},
        appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{}},
        equippedCosmetics:[],appliedDyes:{},nonGearInventory:{},
        packClothing:[],npcRelationships:{},questProgress:{},isNewWorld:false,
      };
      localStorage.setItem('hobunjiOpeningStory.v1:ruin-construction-browser-world','complete');
      localStorage.setItem('hobunjiOpeningStory.v1:ruin-construction-browser-world:farm-tour','complete');
      localStorage.setItem('hobunjiDevMode','1');
      localStorage.removeItem('hobunji.devRandomRuinPuzzleOptions.v2');
    });
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.__hobunjiGameStarted&&window.DevRandomRuin?.generate&&window.RuinLayerDefense?.create,null,{timeout:120000});
    await page.waitForFunction(()=>window.GridTileAccessors?.getCurrentArea?.()==='interior',null,{timeout:120000});
    await page.evaluate(()=>window.HobunjiTitleScreen?.start?.());
    await page.waitForFunction(()=>!window.HobunjiTitleScreen?.isActive?.(),null,{timeout:15000});
    const first=await page.evaluate(async()=>{
      const entered=await window.DevRandomRuin.generate(3,{composedTrial:true,theme:'hronal',rootMechanisms:false,stoneAge:false});
      const state=window.DevRandomRuin.getState();
      if(!entered)return {ok:false,audit:window.DevRandomRuin.getLastSolvabilityAudit()};
      const scene=window.DevRandomRuin.getRuntimeContext().scene;
      const trial=scene.getObjectByName('ruin-layer-defence-'+state.plinthTrialRoomId);
      const passage=window.DevRandomRuin.getInteractionControls().some(control=>control.kind==='composed-passage');
      return {ok:!!state.shaftConnection?.physical,roomId:state.plinthTrialRoomId,mounted:!!trial,passage};
    });
    assert(first.ok&&first.roomId&&first.mounted&&!first.passage,
      'the real scene must mount the trial in the physical wing network: '+JSON.stringify(first));
    await page.evaluate(async()=>window.DevRandomRuin.leave());
    assert.equal(await page.evaluate(()=>window.DevRandomRuin.getState()),null,'ruin exit must clear the active map');
    const seedInput=process.env.HOBUNJI_V50_PLAYTHROUGH_SEED; // Replay a failing V50 seed directly in this same browser test without changing its other gameplay fixtures.
    const nativeSeed=seedInput==null?4:Number(seedInput);
    assert(Number.isInteger(nativeSeed)&&nativeSeed>=0&&nativeSeed<=0xffffffff,
      'HOBUNJI_V50_PLAYTHROUGH_SEED must be an unsigned 32-bit integer');
    const shaft=await page.evaluate(async(seed)=>{
      const entered=await window.DevRandomRuin.generate(seed,{theme:'hronal',rootMechanisms:false,stoneAge:false}); // Normal native V50 generation: no test-only puzzle-family flags.
      if(!entered)return {ok:false,phase:window.DevRandomRuin.getGenerationProgress()};
      const state=window.DevRandomRuin.getState();
      const controls=window.DevRandomRuin.getInteractionControls(); // The actual in-game interaction resolver must own one native V50 brazier per upper story.
      const hasTeleport=controls.some(c=>c.kind==='shaft-passage'||c.label==='Enter Shaft Hub'); // The shaft must be a real corridor, not a warp.
      const surfaces=window.ClimbSurfaces.list().filter(s=>['shaft-hub','shaft-obelisks'].includes(String(s.scope)));
      const highest=surfaces.reduce((best,next)=>!best||next.y1>best.y1?next:best,null);
      const top=highest&&window.ClimbSurfaces.topExitPoint(highest,(highest.u0+highest.u1)/2);
      const support=top&&window.DynamicSurfaces.sampleSupport(top.x,top.z,{minY:highest.y1-.2,maxY:highest.y1+.4});
      const teleported=top&&support&&window.DevRandomRuin.setPlayerWorldPoint({x:top.x,y:support.y,z:top.z},{grounded:true});
      let nativeGates=0; // Count actual gated native meshes across all physical story roots, not just planner metadata.
      window.GridTileAccessors.getActiveScene()?.traverse(node=>{if(String(node.name||'').startsWith('v50-native-gate-'))nativeGates++;});
      const nativeRoots=window.DevRandomRuinHitPuzzles?.getNativeRoots?.()||[]; // Every story joins the real ranged-hit, torch and ladder runtime.
      const actualFamilies=new Set();let cubeSolversExpected=0; // The real V50 iframe must retain every linked-cube actor despite its per-generation registry clears.
      const scanV50=object=>{
        if(object.userData?.activatorType&&object.userData?.linkedMechanismId)
          actualFamilies.add(object.userData.activatorType);
        if(object.userData?.activatorType==='linkedCubePillars'
          &&object.userData?.previewMotion?.type==='linkedCubePair'
          &&object.userData?.interactive3D)cubeSolversExpected++;
      };
      window.DevRandomRuin.getRuntimeContext()?.root?.traverse?.(scanV50);
      for(const nativeRoot of nativeRoots)nativeRoot.traverse(scanV50);
      const cubeSolversLive=document.getElementById('devRandomRuinGeneratorFrame')?.contentWindow?.DebrisifierV50?.getState?.()?.linkedCubeSolverRoots??null; // Assert original V50 source registry, not a game-side approximation.
      return {native:{...state.nativeV50Runtime,
        brazierControls:controls.filter(control=>control.kind==='v50NativeBrazier').length,
        gateMeshes:nativeGates,registeredPuzzleRoots:nativeRoots.length,
        actualPuzzleFamilies:[...actualFamilies].sort(),cubeSolversExpected,cubeSolversLive},ok:!!state.shaftHub&&state.shaftConnection?.physical&&!hasTeleport&&state.shaftLayerPlan?.floorCount>=3&&!!state.shaftNavigation?.length,
        connection:state.shaftConnection,plannedFloors:state.shaftLayerPlan?.floorCount,wing:state.shaftNavigation?.[0],surfaces:surfaces.length,
        topLevel:highest?.y1??null,topSupport:support?.y??null,teleported:!!teleported,
        standing:window.DevRandomRuin.getPlayerSupportY?.()??null};
    },nativeSeed);
    assert(shaft.ok&&shaft.surfaces>=2&&shaft.topLevel>=8,'the live multi-floor shaft must expose its physical climb faces: '+JSON.stringify(shaft));
    await page.waitForFunction(()=>window.DevRandomRuinSanctum?.getState?.()?.built===true,null,{timeout:60000})
      .catch(async error=>{
        const diagnostics=await page.evaluate(()=>{
          const state=window.DevRandomRuinSanctum?.getState?.()||null;
          const simple=window.DevRandomRuinSimplePuzzles?.snapshot?.()||null;
          return {
            area:window.GridTileAccessors?.getCurrentArea?.()||null,
            sanctum:state?{built:!!state.built,rejects:state.rejects||[],door:!!state.door,
              shaftHub:!!state.context?.shaftHub}:null,
            simple:{active:!!simple,composers:Object.keys(simple?.composers||{})},
            shaftSite:window.DevRandomRuin?.getShaftSanctumDoorSite?.()||null,
            generation:window.DevRandomRuin?.getGenerationProgress?.()||null,
          }; // Print bounded diagnostics so a mobile reviewer can distinguish slow initialization from a missing composer.
        });
        throw new Error('Live Great Door failed to initialize: '+JSON.stringify(diagnostics)
          +' | page errors: '+pageErrors.slice(-8).join(' | '),{cause:error});
      });
    const sanctumDoor=await page.evaluate(()=>{
      const record=window.DevRandomRuinSanctum?.getState?.()?.door;
      const wall=window.DevRandomRuin?.getShaftSanctumDoorSite?.();
      const scene=window.GridTileAccessors?.getActiveScene?.();
      const door=scene?.getObjectByName?.('dev_ruin_great_door');
      const expected=wall&&{x:wall.x+wall.normal.x*.46,z:wall.z+wall.normal.z*.46};
      return {mounted:!!door&&!!record,shaft:record?.attachedToShaft===true,
        site:wall?{x:wall.x,z:wall.z,side:wall.side}:null,
        distance:expected&&door?Math.hypot(door.position.x-expected.x,door.position.z-expected.z):null,
        returnPoint:record?.front||null,entry:window.DevRandomRuinSanctum?.getState?.()?.entry||null,
      }; // Mobile-friendly evidence from the actual scene, not an unrelated test plan.
    });
    assert(sanctumDoor.mounted&&sanctumDoor.shaft&&sanctumDoor.distance<.05&&sanctumDoor.returnPoint&&sanctumDoor.entry,
      'the rendered Great Door must be on the physical shaft and teleport into the reserved sanctum: '+JSON.stringify(sanctumDoor));

    assert.equal(shaft.native.floors,shaft.plannedFloors-1,'each planned upper story must mount its real V50 floor in the live game');
    assert.equal(shaft.native.totalBraziers,shaft.native.floors,'every native V50 floor must have one objective brazier');
    assert.equal(shaft.native.brazierControls,shaft.native.floors,'each native brazier must be bound to the real interaction resolver');
    assert.equal(shaft.native.gateMeshes,shaft.native.stagesTotal,'every native V50 challenge stage must mount its physical stone gate');
    assert.equal(shaft.native.registeredPuzzleRoots,shaft.native.floors,'every actual upper-floor root must be registered for native torch, glyph and ladder gameplay');
    assert.equal(shaft.native.cubeSolversLive,shaft.native.cubeSolversExpected,
      'every entrance and upper story linked-cube puzzle must stay registered with original V50 solver after generation');
    assert(shaft.native.perFloor.every(floor=>floor.nativeMechanisms&&Array.isArray(floor.nativeMechanisms.families)),
      'live game must mount a separate authored V50 mechanism runtime for every upper floor: '+JSON.stringify(shaft.native));
    assert(shaft.native.stagesTotal>=shaft.native.floors*2
      &&shaft.native.perFloor.every(floor=>floor.reservationVerified&&floor.routeLength>0&&floor.routeWallSegments>0),
      'live native stories must have pre-reserved layouts, physical entrance corridors and staged gates: '+JSON.stringify(shaft.native));
    assert(shaft.teleported&&Math.abs(shaft.standing-shaft.topSupport)<.15,
      'upper balcony must be a real walkable support, not a visual-only ledge: '+JSON.stringify(shaft));
    const playthrough=await require('./v50-native-playthrough-browser.js')(page); // Reuse the already-mounted actual multi-floor dungeon, exercising native puzzle controls before teardown rather than generating a second test map.
    assert.equal(playthrough.braziers,playthrough.floors,'every physical native V50 story brazier must be reached by solving its stage gates');
    console.log('V50 native instrumented browser playthrough: '+JSON.stringify(playthrough));
    await page.evaluate(async()=>window.DevRandomRuin.leave());
    const afterExitCubes=await page.evaluate(()=>{
      const frame=document.getElementById('devRandomRuinGeneratorFrame');
      return {frameAttached:!!frame,count:frame?.contentWindow?.DebrisifierV50?.getState?.()?.linkedCubeSolverRoots??null};
    });
    assert(!afterExitCubes.frameAttached||afterExitCubes.count===0,
      'V50 solver registry must be empty if the generator iframe remains mounted; destroying the iframe releases the entire private V50 realm: '+JSON.stringify(afterExitCubes));
    assert.deepEqual(pageErrors,[],'no unhandled browser errors: '+pageErrors.join(' | '));
    console.log('Ruin construction browser smoke passed: '+JSON.stringify({trial:first,shaft}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
