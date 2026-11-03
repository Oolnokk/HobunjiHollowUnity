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
    await page.waitForFunction(()=>window.__hobunjiGameStarted&&window.DevRandomRuin?.generate&&window.RuinComposerPlayable?.mount,null,{timeout:120000});
    await page.waitForFunction(()=>window.GridTileAccessors?.getCurrentArea?.()==='interior',null,{timeout:120000});
    await page.evaluate(()=>window.HobunjiTitleScreen?.start?.());
    await page.waitForFunction(()=>!window.HobunjiTitleScreen?.isActive?.(),null,{timeout:15000});
    const first=await page.evaluate(async()=>{
      const entered=await window.DevRandomRuin.generate(3,{composedTrial:true,theme:'hronal',rootMechanisms:false,stoneAge:false});
      if(!entered)return {ok:false,phase:window.DevRandomRuin.getGenerationProgress(),audit:window.DevRandomRuin.getLastSolvabilityAudit()};
      const state=window.DevRandomRuin.getState(),context=window.DevRandomRuin.getRuntimeContext();
      const plan=window.RuinComposerPlayable.plan(state.seed).composition;
      const pillar=plan.records.find(record=>record.piece==='crackedPillar');
      const node=window.FurniturePuzzleRuntime.getNode('map_i_dev_random_ruin',pillar.id);
      const controls=window.DevRandomRuin.getInteractionControls();
      const passage=controls.find(control=>control.label==='Enter Ruin Trial');
      const wing=context.scene.getObjectByName('ruin_composed_trial_wing');
      const before={x:window.Combat.deps.player.x/window.Combat.deps.TILE,z:window.Combat.deps.player.y/window.Combat.deps.TILE};
      if(passage)await passage.onPress();
      const after={x:window.Combat.deps.player.x/window.Combat.deps.TILE,z:window.Combat.deps.player.y/window.Combat.deps.TILE};
      const gapX=state.composedTrial.entry.x-1.7+11.2,gapZ=state.composedTrial.entry.z;
      const supportBefore=window.DynamicSurfaces.sampleSupport(gapX,gapZ,{minY:-.5,maxY:2});
      return {ok:true,state:state.composedTrial,wing:!!wing,controls:controls.filter(control=>String(control.kind).startsWith('composed-')).map(control=>control.kind),
        pillar:!!node,hasBlastInput:!!node?.userData.furniturePuzzle?.inputs?.some(input=>input.event==='blast'),
        before,after,gapX,gapZ,supportBefore:supportBefore?.y??null,pit:!!window.DynamicSurfaces.pointInPit(gapX,gapZ),
        activeRopes:window.HangingRopes?.ropes?.filter(rope=>String(rope.id).startsWith('composed_')).length||0};
    });
    assert(first.ok,'composed trial generation failed: '+JSON.stringify(first));
    assert(first.wing&&first.pillar&&first.hasBlastInput&&first.activeRopes>0,'the real scene must include authored puzzle + rope: '+JSON.stringify(first));
    assert(first.controls.includes('composed-passage')&&first.controls.includes('composed-plinth')&&first.controls.includes('composed-bombDispenser'),'ordinary world interaction controls must exist: '+JSON.stringify(first));
    assert(Math.hypot(first.before.x-first.after.x,first.before.z-first.after.z)>3,'the in-game passage must move the player to the trial wing');
    assert.equal(first.supportBefore,null,'a closed bridge cannot grant support in the gap');
    assert(first.pit,'the chasm must remain a physical fall volume until a bridge opens');
    const blast=await page.evaluate(()=>{
      const state=window.DevRandomRuin.getState(),composition=window.RuinComposerPlayable.plan(state.seed).composition;
      const pillar=composition.records.find(record=>record.piece==='crackedPillar');
      const node=window.FurniturePuzzleRuntime.getNode('map_i_dev_random_ruin',pillar.id);
      const pos=node.getWorldPosition(new THREE.Vector3());
      return {delivered:window.WorldEvents.emit('blast',{scope:'map_i_dev_random_ruin',x:pos.x,z:pos.z,radius:4.4,tag:'fire'}),
        pillarId:pillar.id};
    });
    assert(blast.delivered>0,'the genuine event stream must reach the authored pillar input');
    await page.waitForFunction(id=>{
      const node=window.FurniturePuzzleRuntime?.getNode?.('map_i_dev_random_ruin',id);
      return node?.userData?.puzzleProgress>=.99;
    },blast.pillarId,{timeout:25000,polling:100});
    const afterBlast=await page.evaluate(({x,z})=>{
      const support=window.DynamicSurfaces.sampleSupport(x,z,{minY:-.5,maxY:2});
      const entered=support&&window.DevRandomRuin.setPlayerWorldPoint({x,y:support.y,z},{grounded:true});
      const puzzleNode=window.FurniturePuzzleRuntime.debug().flatMap(graph=>graph.nodes).find(n=>n.id.includes('crackedPillar'));
      const node=puzzleNode&&window.FurniturePuzzleRuntime.getNode('map_i_dev_random_ruin',puzzleNode.id);
      const part=node?.userData.puzzlePartMeshes?.get?.(node.userData.furniturePuzzle.standingSurface?.partId);
      const box=part&&new THREE.Box3().setFromObject(part);
      const ray=new THREE.Raycaster(new THREE.Vector3(x,(box?.max.y??0)+.2,z),new THREE.Vector3(0,-1,0));
      const hits=part?ray.intersectObject(part,true):[];
      return {supportY:support?.y??null,source:support?.id||null,entered,
        standing:window.DevRandomRuin.getPlayerSupportY?.()??null,
        pillar:puzzleNode?.progress??null,standingSurface:puzzleNode?.standingSurface,
        mesh:part?{visible:part.visible,kind:part.type,box:{min:box.min.toArray(),max:box.max.toArray()},hits:hits.length,
          materialSide:part.material?.side,world:part.getWorldPosition(new THREE.Vector3()).toArray()}:null,
        candidates:window.DynamicSurfaces.debugSnapshot().surfaces.filter(s=>String(s.id).includes('furniture-puzzle-standing'))};
    },{x:first.gapX,z:first.gapZ});
    assert(afterBlast.source?.startsWith('furniture-puzzle-standing-')&&afterBlast.supportY>.05,
      'the fallen shaft must provide real raycast support across the gap: '+JSON.stringify(afterBlast));
    assert(afterBlast.entered&&Math.abs(afterBlast.standing-afterBlast.supportY)<.2,
      'the actual player must be able to stand on the new bridge surface: '+JSON.stringify(afterBlast));
    await page.evaluate(async()=>window.DevRandomRuin.leave());
    const cleared=await page.evaluate(()=>({
      state:window.DevRandomRuin.getState(),
      ropes:window.HangingRopes.ropes.filter(rope=>String(rope.id).startsWith('composed_')).length,
      puzzleNodes:window.FurniturePuzzleRuntime.debug().filter(graph=>graph.mapId==='map_i_dev_random_ruin').flatMap(g=>g.nodes).length,
    }));
    assert.equal(cleared.state,null,'ruin exit must clear the active map');
    assert.equal(cleared.ropes,0,'ruin exit must dispose the rope');
    assert.equal(cleared.puzzleNodes,0,'ruin exit must discard the authored puzzle graph');
    const shaft=await page.evaluate(async()=>{
      const entered=await window.DevRandomRuin.generate(4,{shaftWing:true,theme:'hronal',rootMechanisms:false,stoneAge:false});
      if(!entered)return {ok:false,phase:window.DevRandomRuin.getGenerationProgress()};
      const state=window.DevRandomRuin.getState();
      const door=window.DevRandomRuin.getInteractionControls().find(c=>c.label==='Enter Shaft Wing');
      if(door)await door.onPress();
      const surfaces=window.ClimbSurfaces.list().filter(s=>String(s.scope)==='shaft-hub');
      const highest=surfaces.reduce((best,next)=>!best||next.y1>best.y1?next:best,null);
      const top=highest&&window.ClimbSurfaces.topExitPoint(highest,(highest.u0+highest.u1)/2);
      const support=top&&window.DynamicSurfaces.sampleSupport(top.x,top.z,{minY:highest.y1-.2,maxY:highest.y1+.4});
      const teleported=top&&support&&window.DevRandomRuin.setPlayerWorldPoint({x:top.x,y:support.y,z:top.z},{grounded:true});
      return {ok:!!door&&!!state.shaftNavigation?.length,wing:state.shaftNavigation?.[0],surfaces:surfaces.length,
        topLevel:highest?.y1??null,topSupport:support?.y??null,teleported:!!teleported,
        standing:window.DevRandomRuin.getPlayerSupportY?.()??null};
    });
    assert(shaft.ok&&shaft.surfaces>=3&&shaft.topLevel>=12,'the live shaft wing must expose all climb faces: '+JSON.stringify(shaft));
    assert(shaft.teleported&&Math.abs(shaft.standing-shaft.topSupport)<.15,
      'upper balcony must be a real walkable support, not a visual-only ledge: '+JSON.stringify(shaft));
    await page.evaluate(async()=>window.DevRandomRuin.leave());
    assert.deepEqual(pageErrors,[],'no unhandled browser errors: '+pageErrors.join(' | '));
    console.log('Ruin construction browser smoke passed: '+JSON.stringify({trial:first.state,blast:afterBlast,shaft}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
