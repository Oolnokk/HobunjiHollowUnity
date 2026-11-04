#!/usr/bin/env node
'use strict';

// Real-game/browser regression: a rope-only abyss replaces the retired memory-grid hall.
// The dev-only impulse probe uses RopeCore release physics; catches, floor collision,
// checkpoint updates, and immediate death all run through normal gameplay.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const URL=process.env.HOBUNJI_TEST_URL||'http://127.0.0.1:8000/index.html?skipIntro=1';
const SEEDS=[0x5eed1234,0x13579bdf,0x2468ace0,0x51a7cafe]; // Deterministic fallback seeds for finding a valid wide, flat V50 hallway.

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:800,height:600}});
  const errors=[]; // Captures uncaught game errors for the CI report, usable without browser devtools.
  const logs=[]; // Keeps the latest console lines to diagnose a failed live-physics hop.
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',entry=>{logs.push(entry.type()+': '+entry.text());if(logs.length>50)logs.shift();});
  const dependencyFiles={ // Pinned Three.js loads stay independent of CDN timing in CI.
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js':'three/build/three.min.js',
    'https://unpkg.com/three@0.128.0/build/three.min.js':'three/build/three.min.js',
    'https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js':'three/examples/js/controls/TransformControls.js',
    'https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js':'three/examples/js/controls/OrbitControls.js',
    'https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js':'three/examples/js/loaders/GLTFLoader.js',
    'https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js':'three/examples/js/exporters/GLTFExporter.js',
  };
  try{
    for(const [url,file] of Object.entries(dependencyFiles))
      await page.route(url,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(require.resolve(file))}));
    await page.addInitScript(()=>{
      window.__hobunjiPlayerProfile={
        playerId:'rope-chain-browser-player',characterId:'rope-chain-browser-character',
        worldId:'rope-chain-browser-world',worldLabel:'Rope Chain Browser',
        worldOwnerCharacterId:'rope-chain-browser-character',isWorldOwner:true,
        nickname:'Rope Chain Browser',farmhandPermissions:{},
        appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{}},
        equippedCosmetics:[],appliedDyes:{},nonGearInventory:{},
        packClothing:[],npcRelationships:{},questProgress:{},isNewWorld:false,
      };
      localStorage.setItem('hobunjiOpeningStory.v1:rope-chain-browser-world','complete');
      localStorage.setItem('hobunjiOpeningStory.v1:rope-chain-browser-world:farm-tour','complete');
      localStorage.setItem('hobunjiDevMode','1');
      localStorage.removeItem('hobunji.devRandomRuinPuzzleOptions.v2');
    });
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.__hobunjiGameStarted===true
      &&window.DevRandomRuin?.generate&&window.DevRandomRuinSimplePuzzles?.debugRopeChainHop,
      null,{timeout:120000});
    await page.waitForFunction(()=>window.GridTileAccessors?.getCurrentArea?.()==='interior',
      null,{timeout:120000});
    await page.evaluate(()=>window.HobunjiTitleScreen?.start?.());
    await page.waitForFunction(()=>!window.HobunjiTitleScreen?.isActive?.(),null,{timeout:15000});
    await page.evaluate(()=>{
      window.DevRandomRuin.setPuzzleGenerationOptions({
        glyphObelisk:false,ropeSwing:false,ropeChain:true,hallwayTraps:false,lavaBasin:false,sanctum:true,
        safePath:true, // An old saved value must never resurrect pressure-grid challenges.
      });
    });
    const settings=await page.evaluate(()=>window.DevRandomRuin.getPuzzleGenerationOptions());
    assert.equal(settings.safePath,false,'legacy safePath:true must normalize to disabled');
    assert.equal(settings.ropeChain,true,'rope-to-rope hallways must remain enabled');

    let selected=null;
    for(const seed of SEEDS){
      const result=await page.evaluate(async requestedSeed=>{
        const ok=await window.DevRandomRuin.generate(requestedSeed,{theme:'hronal',stoneAge:false,rootMechanisms:false,composedTrial:false});
        return {ok,phase:window.DevRandomRuin.getGenerationProgress(),audit:window.DevRandomRuin.getLastSolvabilityAudit()};
      },seed);
      assert.equal(result.ok,true,'ruin generation failed for seed '+seed+': '+JSON.stringify(result));
      await page.waitForFunction(()=>window.DevRandomRuinSimplePuzzles?.snapshot?.()?.active===true,
        null,{timeout:30000});
      const summary=await page.evaluate(()=>{
        const snap=window.DevRandomRuinSimplePuzzles.snapshot();
        return {chain:snap.ropeChains.find(chain=>chain.mandatoryTraversal)||null,
          chains:snap.ropeChains.length,rejects:snap.ropeChainRejects||[],modules:snap.modules.filter(module=>module.slotKind==='hallway').map(module=>module.type)};
      });
      console.log('[rope-chain candidate]',JSON.stringify({seed,...summary}));
      if(summary.chain){selected={seed,chain:summary.chain};break;}
    }
    assert(selected,'no valid replacement rope chain in tested seeds; examine geometry/rejections before merging');

    const chain=selected.chain;
    assert(chain.ropeCount>=3&&chain.ropeIds.length===chain.ropeCount,
      'rope-only abyss must contain a complete ordered chain: '+JSON.stringify(chain));
    assert(chain.entry&&chain.exit&&chain.checkpoints.start&&chain.checkpoints.end,
      'both original-floor banks need independent checkpoints: '+JSON.stringify(chain));
    const physical=await page.evaluate(hallId=>{
      const s=window.DevRandomRuinSimplePuzzles.snapshot();
      const c=s.ropeChains.find(v=>v.hallId===hallId);
      const x=(c.bounds.minX+c.bounds.maxX)*.5,z=(c.bounds.minZ+c.bounds.maxZ)*.5;
      const support=window.DynamicSurfaces.sampleSupport(x,z,{minY:c.floorY-.25,maxY:c.floorY+.25,pad:.02});
      const braziers=window.DevRandomRuinSanctum?.getState?.()?.braziers||[];
      const reward=braziers.find(b=>b.id==='brazier-rope-chain-'+hallId);
      return {pit:window.DynamicSurfaces.pointInPit(x,z),support:support?.id||null,
        memory:s.modules.filter(m=>m.type==='safePathGrid'),reward:reward?{id:reward.id,at:{x:reward.holder.position.x,z:reward.holder.position.z}}:null,
        center:{x,z,y:c.floorY},area:window.GridTileAccessors.getCurrentArea()};
    },chain.hallId);
    assert(physical.pit&&!physical.support&&physical.memory.length===0,
      'the chain must have a real unsupported bottomless floor, not decorative darkness or a memory grid: '+JSON.stringify(physical));
    assert(physical.reward,'rope-chain completion must retain the Great Door blue-brazier objective: '+JSON.stringify(physical));

    const checkpoint=async(id,point)=>{
      await page.evaluate(p=>window.DevRandomRuin.setPlayerWorldPoint(p,{grounded:true}),point);
      await page.waitForFunction(expected=>window.DevRandomRuinSimplePuzzles?.snapshot?.()?.checkpoints?.activeId===expected,
        id,{timeout:12000,polling:100});
    };
    const failIntoPit=async(side)=>{
      const before=await page.evaluate(()=>window.DevRandomRuinSimplePuzzles.snapshot().checkpoints.respawnCount);
      await page.evaluate(point=>window.DevRandomRuin.setPlayerWorldPoint(point,{grounded:false}),physical.center);
      await page.waitForFunction(count=>window.DevRandomRuinSimplePuzzles?.snapshot?.()?.checkpoints?.respawnCount>count,
        before,{timeout:12000,polling:100});
      const death=await page.evaluate(()=>{
        const cp=window.DevRandomRuinSimplePuzzles.snapshot().checkpoints,deps=window.Combat.deps;
        return {checkpoint:cp.activeId,reason:cp.lastReason,respawns:cp.respawnCount,
          downed:window.PlayerDowned.isDowned(),area:window.GridTileAccessors.getCurrentArea(),
          x:deps.player.x/deps.TILE,z:deps.player.y/deps.TILE,activePoint:cp.activePoint};
      });
      assert.equal(death.checkpoint,chain.checkpoints[side],'fall must preserve the active bank checkpoint');
      assert.equal(death.reason,'rope-chain-abyss','abyss fall must take immediate-death path');
      assert.equal(death.downed,false,'no downed / Second Wind state is permitted over the abyss');
      assert.equal(death.area,'map_i_dev_random_ruin','death must respawn inside the same ruin');
      assert(Math.hypot(death.x-death.activePoint.x,death.z-death.activePoint.z)<.05,
        'respawn must land on the active bank checkpoint: '+JSON.stringify(death));
      return death;
    };
    const grabBankRope=async(side)=>{
      const result=await page.evaluate(({hallId,bankSide})=>{
        const snap=window.DevRandomRuinSimplePuzzles.snapshot();
        const c=snap.ropeChains.find(chain=>chain.hallId===hallId),id=c.ropeIds[bankSide==='start'?0:c.ropeIds.length-1];
        const rope=snap.ropes.find(candidate=>candidate.id===id);
        window.DevRandomRuin.setPlayerWorldPoint(c[bankSide],{grounded:true});
        const control=window.DevRandomRuinSimplePuzzles.getInteractionControls()
          .find(candidate=>candidate.kind==='ropeGrab'&&Math.hypot(candidate.point.x-rope.grabPoint.x,candidate.point.z-rope.grabPoint.z)<.01);
        return {id,available:!!control,grabbed:control?.onPress?.()===true};
      },{hallId:chain.hallId,bankSide:side});
      assert(result.available&&result.grabbed,'bank Grab Rope action must attach: '+JSON.stringify(result));
      await page.waitForFunction(id=>window.DevRandomRuinSimplePuzzles.snapshot().ropes.some(rope=>rope.id===id&&rope.attached),result.id,
        {timeout:10000,polling:100});
    };
    const cross=async(direction)=>{
      const reverse=direction==='reverse',destination=reverse?'start':'end';
      const ids=reverse?[...chain.ropeIds].reverse():chain.ropeIds;
      const hops=[];
      for(let i=0;i<ids.length;i++){
        const pre=await page.evaluate(()=>window.DevRandomRuinSimplePuzzles.snapshot());
        assert(pre.ropes.some(rope=>rope.id===ids[i]&&rope.attached),'expected active rope '+ids[i]);
        const launched=await page.evaluate(({hallId,dir})=>window.DevRandomRuinSimplePuzzles.debugRopeChainHop(hallId,dir),
          {hallId:chain.hallId,dir:direction});
        assert(launched.ok,'physically predicted jump failed: '+JSON.stringify({launched,direction,index:i}));
        const next=ids[i+1]||null;
        await page.waitForFunction(({id,bank})=>{
          const s=window.DevRandomRuinSimplePuzzles.snapshot();
          return id?s.ropes.some(rope=>rope.id===id&&rope.attached):s.checkpoints.activeId===bank;
        },{id:next,bank:chain.checkpoints[destination]},{timeout:16000,polling:70});
        const post=await page.evaluate(()=>window.DevRandomRuinSimplePuzzles.snapshot());
        if(next)assert(post.ropes.find(rope=>rope.id===next)?.airCatchCount>0,
          'next chain rope must actually catch the flying player');
        hops.push({from:ids[i],to:next||destination,flight:launched,active:post.checkpoints.activeId});
      }
      return hops;
    };

    await checkpoint(chain.checkpoints.start,chain.entry);
    const startDeath=await failIntoPit('start');
    await grabBankRope('start');
    const forward=await cross('forward');
    const afterForward=await page.evaluate(()=>window.DevRandomRuinSimplePuzzles.snapshot().checkpoints);
    assert.equal(afterForward.activeId,chain.checkpoints.end,'far bank replaces the entry checkpoint');
    const endDeath=await failIntoPit('end');
    await grabBankRope('end');
    const reverse=await cross('reverse');
    const afterReverse=await page.evaluate(()=>window.DevRandomRuinSimplePuzzles.snapshot().checkpoints);
    assert.equal(afterReverse.activeId,chain.checkpoints.start,'return traversal restores the opposite checkpoint');

    const summary={seed:selected.seed,hallId:chain.hallId,ropes:chain.ropeCount,
      forwardHops:forward.length,reverseHops:reverse.length,
      startDeath:startDeath.reason,endDeath:endDeath.reason,bankCheckpoints:[chain.checkpoints.start,chain.checkpoints.end],
      brazier:physical.reward.id,errors:errors.length};
    assert.deepEqual(errors,[],'live game must have no uncaught JS errors: '+errors.join(' | '));
    console.log('PASS rope-chain real-game browser traversal',JSON.stringify(summary));
  }catch(error){
    const debug=await page.evaluate(()=>({
      area:window.GridTileAccessors?.getCurrentArea?.(),
      generation:window.DevRandomRuin?.getGenerationProgress?.(),
      simple:window.DevRandomRuinSimplePuzzles?.snapshot?.()?.ropeChains,
      rejects:window.DevRandomRuinSimplePuzzles?.snapshot?.()?.ropeChainRejects,
      checkpoints:window.DevRandomRuinSimplePuzzles?.snapshot?.()?.checkpoints,
      playerDowned:window.PlayerDowned?.isDowned?.(),
    })).catch(()=>null);
    console.error('[rope-chain browser failure]',JSON.stringify({debug,errors,logs:logs.slice(-15)}));
    throw error;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
