'use strict';
// Isolated catalog audit: the isolated V50 room must initialize its selected live
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
    // The injected player profile starts the game without going through the
    // independent save/creator UI. Hide that unrelated overlay in this harness.
    await page.addStyleTag({content:'#ob-overlay{display:none!important}'});

    const releaseCameraForHud=async()=>{
      // The programmatic arena entry closes the game menu, which can
      // acquire shoulder-camera pointer lock in Chromium's test context.
      await page.evaluate(()=>window.ShoulderCamPointerLock?.release());
      await page.waitForFunction(()=>!document.pointerLockElement,null,{timeout:10000});
    };
    const expected=()=>[...window.DevRuinSingleRoomTrial.TYPES,...window.DevRuinSingleRoomTrial.MECHANISMS].map(([key])=>key);
    const kinds=await page.evaluate(expected);
    const labTab=page.locator('#devRuinLabBtn'); // The in-arena route is covered separately from direct fixture generation.
    if(await labTab.isVisible())throw new Error('Puzzle Lab tab appeared before entering the arena');
    const report=[]; // Per-choice verification survives later generator failures and supplies mobile-friendly CI diagnostics.
    const seeds={glyphObelisk:0x51a7cafe,ceilingRailTargets:0x17a31,timedMelody:0x17a32,
      dungeonFire:0x17a33,ropeChain:0x2468ace0,statueDefense:0x17a35,
      nativeBrazier:0x17a36,nativeGlyphObelisk:0x17a37,
      nativeStackedObelisk:0x4ed17f2a,nativeLinkedCubePillars:0x17a39,nativePushBlock:0x17a3a,findBlocks:0x17a3b};
    for(const kind of kinds){
      const row={kind,seed:seeds[kind]||12,ok:false,ready:false,linked:false};
      report.push(row);
      try{
        if(kind==='stoneDoor'){
          await releaseCameraForHud();
          await labTab.click({timeout:10000});
          await page.locator('#devRuinLabPanel').waitFor({state:'visible',timeout:10000});
          await page.selectOption('#devRuinLabChoice',kind);
          assert.match(await page.locator('#devRuinLabHint').textContent(),/raise or lower/);
          await page.locator('#devRuinLabLoad').click({timeout:10000});
          await page.waitForFunction(()=>window.DevRandomRuin?.getState?.()?.singleRoomTrial?.kind==='stoneDoor'
            &&window.DevRandomRuin?.getGenerationProgress?.()?.phase==='entered',null,{timeout:60000});
          if(!await labTab.isVisible())throw new Error('Puzzle Lab tab disappeared after switching fixtures');
          if(await page.locator('#devRuinLabPanel').isVisible())throw new Error('Puzzle Lab panel stayed open after switching fixtures');
          await releaseCameraForHud();
          await labTab.click({timeout:10000});
          await page.waitForFunction(()=>document.getElementById('devRuinLabFeedback')?.dataset.phase==='ready');
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#devRuinLabPanel').isVisible(),false,'Escape closes the panel after switching fixtures');
          row.generated=true;
        }else{
        row.generated=await page.evaluate(async ({kind,seed})=>window.DevRandomRuin.generate(seed,{
          singleRoomTrial:true,puzzleType:kind,
        }),{kind,seed:row.seed});
        }
        if(!row.generated){row.error='Generation returned false';continue;}
        for(let attempt=0;attempt<35;attempt++){
          const s=await page.evaluate(()=>{
            const runtime=window.DevRandomRuin?.getRuntimeContext?.();
            const simple=window.DevRandomRuinSimplePuzzles?.snapshot?.()||{};
            const trial=simple.singleRoomChallenge||{};
            const state=window.DevRandomRuin?.getState?.()||{};
            const meta=runtime?.meta||{};
            const fixture=meta.singleRoomNative||null;
            const mechanism=fixture?.mechanismId?window.DevRandomRuin?.mechanismInfo?.(fixture.mechanismId):null;
            const counts={};
            runtime?.root?.traverse?.(object=>{
              const d=object.userData||{},kind=d.activatorType;
              if(kind)counts[kind]=(counts[kind]||0)+1;
              if(d.pushable)counts.pushable=(counts.pushable||0)+1;
              if(d.pushPuzzle?.totalPushes>=6&&d.pushPuzzle?.directionChanges>=2)counts.routedPush=(counts.routedPush||0)+1; // Must be the deliberate multi-turn push course, not a trivial pressure plate.
              if(d.requiresCarriedTorch)counts.requiresCarriedTorch=(counts.requiresCarriedTorch||0)+1;
            });
            return {area:window.GridTileAccessors?.getCurrentArea?.(),trial,
              rooms:meta.rooms?.length,noLoot:runtime?.noLoot===true,shaftHub:!!runtime?.shaftHub,
              counts,fixture,mechanism:mechanism?{gated:mechanism.gated,progress:mechanism.progress,
                rootPresent:!!mechanism.root,signalLinked:mechanism.signalLinked}:null,
              ropes:simple.ropeChains?.length||0,targets:window.DevRandomRuinSimplePuzzles?.listProjectileTargets?.().length||0,
              controls:window.DevRandomRuinSimplePuzzles?.getInteractionControls?.().length||0,
              generation:state.puzzleGeneration?.nativeLab||null};
          });
          row.snapshot=s;row.ready=s.trial.ready===true;
          row.linked=s.trial.linked===true;row.ropeLinked=s.trial.ropeLinked===true;
          row.error=s.trial.error||s.trial.ropeError||null;
          const needsLink=['glyphObelisk','ceilingRailTargets'].includes(kind);
          const native=kind.startsWith('native');
          const expectedNative={nativeBrazier:'brazier',nativeGlyphObelisk:'glyphObelisk',
            nativeStackedObelisk:'stackedObelisk',nativeLinkedCubePillars:'linkedCubePillars',
            nativePushBlock:'pressurePlate'}[kind];
          row.ok=s.rooms===1&&s.noLoot&&!s.trial.error&&s.trial.kind===kind&&s.trial.ready===true
            &&(!needsLink||(s.trial.linked===true&&s.targets>0))
            &&(kind!=='dungeonFire'||(s.trial.fireLinked===true&&s.controls>0))
            &&(kind!=='timedMelody'||s.trial.noteCount>=2)
            &&(kind!=='ropeChain'||(s.trial.ropeLinked===true&&s.ropes>0))
            &&(!native||(s.mechanism?.gated===true&&s.mechanism.rootPresent===true
              &&s.fixture?.kind===expectedNative&&(s.counts[expectedNative]||0)>0))
            &&(kind!=='nativePushBlock'||((s.counts.pushable||0)>0&&(s.counts.routedPush||0)>0&&s.mechanism.signalLinked===true))
            &&(kind!=='nativeBrazier'||(s.counts.requiresCarriedTorch||0)>0)
            &&(kind!=='statueDefense'||s.controls>=2)
            &&(kind!=='findBlocks'||(s.trial.findBlocks?.blocks?.length===4
              &&s.trial.findBlocks?.weighted===0&&s.trial.findBlocks?.blocks?.[2]?.available===true
              &&s.trial.findBlocks?.fireReady===true&&s.trial.findBlocks?.witchBombReady===true));
          if(row.ok||(!row.ready&&row.error&&!/Rope controller declined/.test(row.error)))break;
          await page.waitForTimeout(350);
        }
        if(!row.ok&&!row.error)row.error='Puzzle failed its readiness/linkage/geometry checks';
      }catch(e){row.error=String(e?.stack||e);}
      // Do not abort on one failed puzzle: the remaining variants still need verification.
      console.log('Solo puzzle audit:',JSON.stringify({kind:row.kind,ok:row.ok,error:row.error||null,
        snapshot:row.snapshot?.trial||null,fixture:row.snapshot?.fixture||null}));
    }
    fs.mkdirSync('test-artifacts',{recursive:true});
    fs.writeFileSync('test-artifacts/solo-puzzle-audit.json',JSON.stringify({report,errors:errors.slice(-40)},null,2));
    const failures=report.filter(row=>!row.ok);
    console.log('Single-room catalog audit:',report.length-failures.length+'/'+report.length,'passed');
    if(failures.length)throw new Error('Broken puzzle choices: '+failures.map(row=>row.kind+': '+row.error).join(' | '));
  }catch(error){console.error('Single-room catalog audit failed:',error);
    console.error('Browser errors:',errors.slice(-15).join('\n'));throw error;
  }finally{await browser.close();}
}
main().catch(()=>{process.exitCode=1;});
