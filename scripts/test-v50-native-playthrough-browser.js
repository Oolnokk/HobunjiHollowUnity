#!/usr/bin/env node
'use strict';
// Standalone Playwright replay of the REAL V50 multi-floor game, using the
// instrumented solver in v50-native-playthrough-browser.js. This launches
// one browser, not the Hachutu or independent composed-trial fixtures.
// HOBUNJI_V50_PLAYTHROUGH_SEEDS=4,17 reproduces named seeds sequentially.
const assert=require('node:assert/strict');
const fs=require('node:fs'); // Serves exactly the same Three.js r128 dependencies as production and the parent test.
const {chromium}=require('playwright');
const autoplay=require('./v50-native-playthrough-browser.js');
const url=process.env.HOBUNJI_TEST_URL||'http://127.0.0.1:8000/index.html?skipIntro=1';
const supplied=process.env.HOBUNJI_V50_PLAYTHROUGH_SEEDS||'4'; // Used to reproduce bad V50 seeds without changing the committed test.
const seeds=supplied.split(',').map(text=>Number(text.trim()));
assert(seeds.length>0&&seeds.length<=4&&seeds.every(seed=>Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff),
  'HOBUNJI_V50_PLAYTHROUGH_SEEDS must contain one to four unsigned 32-bit integers');
const cdn={
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js':'three/build/three.min.js',
  'https://unpkg.com/three@0.128.0/build/three.min.js':'three/build/three.min.js',
  'https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js':'three/examples/js/controls/TransformControls.js',
  'https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js':'three/examples/js/controls/OrbitControls.js',
  'https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js':'three/examples/js/loaders/GLTFLoader.js',
  'https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js':'three/examples/js/exporters/GLTFExporter.js',
};
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1024,height:768}});
  const pageErrors=[],results=[]; // Aggregate page crashes and every reproduced seed for one CI summary.
  page.on('pageerror',error=>pageErrors.push(String(error?.stack||error)));
  for(const [external,file] of Object.entries(cdn))
    await page.route(external,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(require.resolve(file))}));
  try{
    await page.addInitScript(()=>{
      window.__hobunjiPlayerProfile={
        playerId:'v50-autoplay-player',characterId:'v50-autoplay-character',
        worldId:'v50-autoplay-world',worldLabel:'V50 Puzzle Playthrough',
        worldOwnerCharacterId:'v50-autoplay-character',isWorldOwner:true,
        nickname:'V50 Autoplay',farmhandPermissions:{},
        appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{}},
        equippedCosmetics:[],appliedDyes:{},nonGearInventory:{},
        packClothing:[],npcRelationships:{},questProgress:{},isNewWorld:false,
      };
      localStorage.setItem('hobunjiOpeningStory.v1:v50-autoplay-world','complete');
      localStorage.setItem('hobunjiOpeningStory.v1:v50-autoplay-world:farm-tour','complete');
      localStorage.setItem('hobunjiDevMode','1'); // Required for read-only authored record inspection and guarded torch test callbacks.
    });
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForFunction(()=>window.__hobunjiGameStarted&&window.DevRandomRuin?.generate&&window.DevRandomRuin?.getNativeV50TestRuntime,
      null,{timeout:120000});
    await page.waitForFunction(()=>window.GridTileAccessors?.getCurrentArea?.()==='interior',
      null,{timeout:120000});
    await page.evaluate(()=>window.HobunjiTitleScreen?.start?.());
    await page.waitForFunction(()=>!window.HobunjiTitleScreen?.isActive?.(),null,{timeout:15000});
    for(const seed of seeds){
      const start=Date.now(); // Per-seed generation + puzzle runtime budget is visible in CI failure logs.
      const built=await page.evaluate(async selectedSeed=>{
        const ok=await window.DevRandomRuin.generate(selectedSeed,
          {theme:'hronal',rootMechanisms:false,stoneAge:false});
        return {ok,area:window.GridTileAccessors.getCurrentArea?.(),
          progress:window.DevRandomRuin.getGenerationProgress?.(),
          state:window.DevRandomRuin.getState?.()?.nativeV50Runtime||null};
      },seed);
      assert(built.ok&&built.area==='map_i_dev_random_ruin'&&built.state?.floors>=2,
        'A complete real native V50 multi-story dungeon must generate before autoplay: '+JSON.stringify({seed,built}));
      const readiness=await page.evaluate(()=>{
        const native=window.DevRandomRuin.getNativeV50TestRuntime?.(),hit=window.DevRandomRuinHitPuzzles;
        const initialized=hit?.debugEnsureRuntimeReady?.(); // This is exactly the production before-render callback; software Chromium may not have compiled its first heavy dungeon frame yet.
        return {initialized,storyCount:native?.records?.length||0,
          area:window.GridTileAccessors?.getCurrentArea?.()||null,
          playerGroundY:window.DevRandomRuin.getPlayerGroundSupportY?.()??null,
          hit:hit?.snapshot?.()||null,
          gameStarted:window.__hobunjiGameStarted===true};
      });
      console.log('V50_AUTOPLAY_RUNTIME_READY '+JSON.stringify({seed,readiness}));
      if(!readiness.initialized||readiness.storyCount<2){
        await page.waitForFunction(()=>{
          const hit=window.DevRandomRuinHitPuzzles;
          return hit?.debugEnsureRuntimeReady?.()===true&&
            (window.DevRandomRuin.getNativeV50TestRuntime?.()?.records?.length||0)>=2;
        },null,{timeout:90000,polling:200}).catch(async error=>{
          const diagnostics=await page.evaluate(()=>({
            area:window.GridTileAccessors?.getCurrentArea?.()||null,
            gameStarted:!!window.__hobunjiGameStarted,
            native:window.DevRandomRuin.getState?.()?.nativeV50Runtime||null,
            devMode:localStorage.getItem('hobunjiDevMode'),
            liveTestRecords:window.DevRandomRuin.getNativeV50TestRuntime?.()?.records?.length||null,
            scene:window.GridTileAccessors?.getActiveScene?.()?.children?.filter(object=>/^dev_v50_ruin_/.test(object.name||'')).map(object=>object.name)||[],
            hit:window.DevRandomRuinHitPuzzles?.snapshot?.()||null,
          }));
          throw new Error('Native V50 hit runtime failed to attach to the real map: '+JSON.stringify({seed,readiness,diagnostics}),{cause:error});
        });
      }
      const illegalTeleport=await page.evaluate(()=>window.DevRandomRuin.getInteractionControls()
        .some(control=>control.kind==='shaft-passage'||control.label==='Enter Shaft Hub'));
      assert.equal(illegalTeleport,false,'physical V50 shaft must not contain an escape teleport');
      const report=await autoplay(page);
      assert.equal(report.floors,report.braziers,'the game must light every authentic V50 floor brazier');
      assert(report.stages>=report.floors*2,'a puzzle-less multi-story ruin cannot satisfy this test');
      const exit=await page.evaluate(async()=>{
        await window.DevRandomRuin.leave();
        const dynamic=window.DynamicSurfaces.debugSnapshot();
        const leaked=[...dynamic.surfaces,...dynamic.blockers,...dynamic.pits]
          .filter(record=>String(record.scope).startsWith('ruin-native-v50-story-'));
        return {map:window.DevRandomRuin.getState(),leaked,
          controls:window.DevRandomRuin.getInteractionControls().filter(control=>String(control.kind).startsWith('v50Native')).length,
          hitRoots:window.DevRandomRuinHitPuzzles?.getNativeRoots?.().length||0};
      });
      assert.equal(exit.map,null,'leaving V50 dungeon must free the generated native floor runtime');
      assert.equal(exit.controls,0,'no native V50 interaction controls may survive map exit');
      assert.equal(exit.hitRoots,0,'no stale original V50 glyph/torch roots may survive map exit');
      assert.equal(exit.leaked.length,0,'all V50 native dynamic collision and support records must be released: '+JSON.stringify(exit.leaked));
      results.push({seed,ms:Date.now()-start,floors:report.floors,
        stages:report.stages,braziers:report.braziers,
        events:report.steps,limitations:report.limitations});
      console.log('V50_AUTOPLAY_SEED_PASS '+JSON.stringify(results.at(-1)));
    }
    assert.deepEqual(pageErrors,[],'browser raised unhandled errors: '+JSON.stringify(pageErrors.slice(-10)));
    console.log('V50_NATIVE_AUTOPLAY_COMPLETE '+JSON.stringify({seeds:results.map(row=>row.seed),
      floors:results.reduce((n,row)=>n+row.floors,0),
      stages:results.reduce((n,row)=>n+row.stages,0),
      braziers:results.reduce((n,row)=>n+row.braziers,0)}));
  }catch(error){
    console.error('V50_NATIVE_AUTOPLAY_FAILURE '+String(error?.stack||error));
    try{await page.screenshot({path:'/tmp/v50-native-playthrough-failure.png',fullPage:true,timeout:15000});}
    catch(_){/* Retain the explicit failure trace even when software-WebGL cannot screenshot. */}
    throw error;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
