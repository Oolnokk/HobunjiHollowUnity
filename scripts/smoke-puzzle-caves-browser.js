'use strict';
// Actual Chromium + Three.js integration: game startup, carved Puzzle Cave
// music/fire mechanisms, collision and scene teardown, with mobile-sized UI.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const URL=process.env.HOBUNJI_TEST_URL||'http://127.0.0.1:8000/index.html?skipIntro=1';

async function main(){
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:800,height:600},hasTouch:true,isMobile:true});
  const errors=[]; // Browser errors are surfaced in CI output, since this must be testable without desktop DevTools.
  page.on('pageerror',error=>errors.push(String(error)));
  try{
    const modules={
      'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js':'three/build/three.min.js',
      'https://unpkg.com/three@0.128.0/build/three.min.js':'three/build/three.min.js',
      'https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js':'three/examples/js/controls/TransformControls.js',
      'https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js':'three/examples/js/controls/OrbitControls.js',
      'https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js':'three/examples/js/loaders/GLTFLoader.js',
      'https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js':'three/examples/js/exporters/GLTFExporter.js',
    }; // Established local substitutes for the game's externally hosted Three r128 modules.
    for(const [url,file] of Object.entries(modules))
      await page.route(url,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(require.resolve(file))}));
    await page.addInitScript(()=>{
      window.__hobunjiPlayerProfile={
        playerId:'puzzle-cave-browser-player',characterId:'puzzle-cave-browser-character',
        worldId:'puzzle-cave-browser-world',worldLabel:'Puzzle Cave Browser Fixture',
        worldOwnerCharacterId:'puzzle-cave-browser-character',isWorldOwner:true,nickname:'Puzzle Cave Test',
        farmhandPermissions:{},appearance:{speciesId:'mao-ao',gender:'male',cosmetics:{}},
        equippedCosmetics:[],appliedDyes:{},nonGearInventory:{},packClothing:[],
        npcRelationships:{},questProgress:{},isNewWorld:false,
      };
      localStorage.setItem('hobunjiOpeningStory.v1:puzzle-cave-browser-world','complete');
      localStorage.setItem('hobunjiOpeningStory.v1:puzzle-cave-browser-world:farm-tour','complete');
    });
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.__hobunjiGameStarted===true
      &&!!window.RuinLayerChallenges?.compose &&!!window.PuzzleCaveMelody?.generate
      &&!!window.AreaFootprintBlockers?.blocksBox &&!!window.PersistentGroundFire
      &&!!window.CaveSiteSystem?.tickPuzzleRuntime &&!!window.PuzzleCaveEntrances,
      null,{timeout:120000});
    const result=await page.evaluate(async()=>{
      const THREE=window.THREE;
      if(!THREE?.Group||!window.RuinLayerChallenges?.compose)throw Error('Real Three/ruin composer missing');
      const group=new THREE.Group(); // Detached 3D test scene never interferes with the saved player's world.
      const caveShell=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0x514c44}));
      caveShell.userData.interiorCavernMaterialParity='farm-cliffs'; // Model the already-built native shell as the authoritative wall texture.
      group.add(caveShell);
      const area='puzzle_cave_browser_test';
      const room={x:3,z:5,w:9,d:9};
      const gateX=room.x+room.w/2,gateZ=room.z+room.d-2.8; // The center opening connects the chamber to an actual walkable treasure alcove.
      const collision=window.AreaFootprintBlockers;
      const countBefore=collision.providerIds().length; // Ensure the test frees only its own colliders, not cached game systems.
      const state={phase:'fire',solved:0,lit:0};
      const hot=new Set(); // Sconce contact is driven by actual authored coordinates, not a hard-coded gate location.
      let fire=null,music=null,simple=null; // Each real authored cave challenge is disposed independently after its collision test.
      const waitFor=async(check,label)=>{
        for(let count=0;count<120;count++){ // Asset/font availability remains bounded on mobile CI.
          if(check())return;
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        throw Error('Timed out waiting for '+label);
      };
      const roofHeight=12; // Test a cave whose carved puzzle ceiling rises above the old nine-tile permanent wall.
      const assertTallSideWalls=(challenge,label)=>{
        const wall=challenge.rockSurround; // The actual fused rock shoulder geometry (not merely the collision proxy).
        if(!wall?.geometry?.getAttribute?.('position'))throw Error(label+' has no sculpted gate side walls');
        wall.geometry.computeBoundingBox();
        if(wall.userData?.caveSeparatorHeight<roofHeight||wall.geometry.boundingBox?.max?.y<roofHeight-.5)
          throw Error(label+' rock shoulders stop below the raised cavern roof');
        if(!collision.blocksBox(area,room.x+.65,gateZ,.18,roofHeight-1.5)
          ||!collision.blocksBox(area,room.x+room.w-.65,gateZ,.18,roofHeight-1.5))
          throw Error(label+' left/right stone flank collision stops below the raised roof');
        if(collision.blocksBox(area,gateX,gateZ,.18,roofHeight-1.5))
          throw Error(label+' elevated central passage is blocked by the permanent stone shoulders');
      };
      const assertAuthoredGate=async(challenge,kind)=>{
        await waitFor(()=>challenge.authoredGate || challenge.disposed,kind+' authored cliffGate model');
        if(!challenge.authoredGate)throw Error(kind+' authored gate was disposed before it loaded');
        if(challenge.authoredGate.userData?.meshById?.has?.('cliff_gate_darkness'))
          throw Error(kind+' authored gate still contains black backing geometry');
        if(challenge.door.visible)throw Error(kind+' authored gate did not replace the placeholder slab');
      };
      try{
        fire=window.RuinLayerChallenges.compose({
          THREE,parent:group,room,id:'browser-fire-test',kind:'fireSconces',area,y:0,authoredCliffDoor:true,caveRoofHeight:roofHeight,
          isActive:()=>state.phase==='fire',onSolved:()=>state.solved++,
          groundFire:{intersects:(map,x,z)=>map===area&&hot.has(x+','+z)},
          onSconceLit:()=>state.lit++,getPlayerY:()=>0,getPlayerPosition:()=>({x:0,z:0}),
        });
        if(!collision.blocksBox(area,gateX,gateZ,.18))throw Error('Closed fire slab is not physically collidable');
        if(collision.blocksBox('other-map',gateX,gateZ,.18))throw Error('Interior slab leaked into another area');
        if(!collision.blocksBox(area,room.x+.65,gateZ,.18)||!collision.blocksBox(area,room.x+room.w-.65,gateZ,.18))
          throw Error('Rock flanks do not seal the full cave room width');
        for(const sconce of fire.sconces){hot.add(sconce.x+','+sconce.z);fire.tick(.016);hot.clear();}
        if(!fire.solved||state.solved!==1||state.lit!==2)throw Error('Two real sconces did not unlock the stone door');
        fire.animate(1);
        if(collision.blocksBox(area,gateX,gateZ,.18))throw Error('Raised fire gate still blocks player');
        if(!collision.blocksBox(area,room.x+.65,gateZ,.18))throw Error('Player can bypass opened door through unbreakable rock');
        if(!fire.rockSurround?.geometry?.getAttribute?.('position'))throw Error('Sculpted permanent cave wall is missing from the real Three scene');
        if(fire.rockSurround.material!==caveShell.material||!fire.rockSurround.userData.caveSharedWallMaterial)
          throw Error('Carved rock wall did not inherit the exact surrounding cave-shell material');
        if(fire.rockSurround.userData.naturalSurfaceUvOwner==='legacy-continuous-rock-uv')
          throw Error('Cave wall was mislabeled as a legacy ore texture, overriding natural surface metadata');
        if(fire.backdrop!==null)throw Error('Fire gate should not construct any fake black passage');
        assertTallSideWalls(fire,'fire gate');
        await assertAuthoredGate(fire,'fire'); // Verify the async authored asset contains no black backing geometry.
        fire.dispose();fire=null;
        if(collision.providerIds().length!==countBefore)throw Error('Fire cave leaked collision provider on disposal');

        // Exercise the real DungeonFire contact owner with authored Three.js stone cups, not direct onBurn callbacks.
        const dungeonFire=window.DungeonFire;
        if(!dungeonFire?.contactMelee||!dungeonFire?.contactProjectile||!dungeonFire?.hasTarget)
          throw Error('Shared lit-torch contact runtime is unavailable in the running game');
        state.phase='torch-fire';
        let torchLit=0,torchSolved=0; // Independent fire-mechanism outcome verifies melee and thrown contact without changing the older ground-fire counts.
        fire=window.RuinLayerChallenges.compose({
          THREE,parent:group,room,id:'browser-torch-fire-test',kind:'fireSconces',area,y:0,authoredCliffDoor:true,
          isActive:()=>state.phase==='torch-fire',onSolved:()=>torchSolved++,
          groundFire:{intersects:()=>false},onSconceLit:()=>torchLit++,
          getPlayerY:()=>0,getPlayerPosition:()=>({x:0,z:0}),
        });
        fire.tick(.016); // One game tick registers both real stone vessels with DungeonFire.
        const [first,second]=fire.sconces;
        const idFor=index=>'puzzle-cave-fire-'+area+'-browser-torch-fire-test-'+index;
        if(!dungeonFire.hasTarget(idFor(0))||!dungeonFire.hasTarget(idFor(1)))
          throw Error('Live cave sconces were not registered as fire-contact targets');
        const struck=dungeonFire.contactMelee(object=>object===first.bracket
          ?new THREE.Vector3(first.x,1.2,first.z):null);
        if(!struck||torchLit!==1||torchSolved!==0||!first.lit)
          throw Error('A lit swung torch did not ignite exactly one sconce through melee fire contact');
        const sweepFrom=new THREE.Vector3(second.x,1.1,second.z-2);
        const sweepTo=new THREE.Vector3(second.x,1.1,second.z+.2);
        const thrown={team:'player',dungeonFire:true}; // DungeonFire accepts the same flame-bearing projectile fields produced by RangedWeapons.
        dungeonFire.contactProjectile(thrown,sweepFrom,sweepTo,.15,.05);
        if(second.lit)throw Error('Thrown torch flame ignited a sconce behind a clipped cover sweep');
        if(!dungeonFire.contactProjectile(thrown,sweepFrom,sweepTo,1,.05)
          ||!second.lit||torchLit!==2||torchSolved!==1||!fire.solved)
          throw Error('Lit thrown torch failed to ignite the second sconce and unlock the cave');
        fire.dispose();fire=null;
        if(dungeonFire.hasTarget(idFor(0))||dungeonFire.hasTarget(idFor(1)))
          throw Error('Detached puzzle cave left orphaned shared torch contact targets');
        if(collision.providerIds().length!==countBefore)
          throw Error('Thrown-torch cave leaked movement collision providers');

        state.phase='simple';
        const stepper={x:room.x,z:room.z}; // Live player position is moved onto the fallback plate only after checking the closed gate.
        simple=window.RuinLayerChallenges.compose({
          THREE,parent:group,room,id:'browser-simple-plate-test',kind:'cavePressurePlate',area,y:0,authoredCliffDoor:true,caveRoofHeight:roofHeight,
          isActive:()=>state.phase==='simple',onSolved:()=>state.solved++,
          getPlayerY:()=>0,getPlayerPosition:()=>stepper,
        });
        if(!collision.blocksBox(area,gateX,gateZ,.18))throw Error('Closed fallback pressure-plate gate is not collidable');
        simple.tick(.016);
        if(simple.solved)throw Error('The fallback plate opened without a player standing on it');
        stepper.x=room.x+room.w/2;stepper.z=room.z+room.d/2-1.6;
        const surfaces=window.DynamicSurfaces;
        const plateAt=(x,z,testArea=area)=>surfaces.samplePressurePlate(testArea,x,z,0,.25);
        const initialSupport=plateAt(stepper.x,stepper.z);
        if(!simple.plate.userData.walkableElevation||Math.abs((initialSupport?.y??0)-.155)>1e-5)
          throw Error('Pressure plate support must match the stone top, excluding the engraved decal');
        if(plateAt(stepper.x+.4,stepper.z+.4)||plateAt(stepper.x,stepper.z,'other-map'))
          throw Error('Circular plate support leaked outside the slab or cave');
        simple.plate.position.y-=.04;
        if(Math.abs((plateAt(stepper.x,stepper.z)?.y??0)-.115)>1e-5)
          throw Error('Plate support did not follow a depressed slab');
        simple.plate.position.y+=.04;
        simple.tick(.016);
        if(!simple.solved||state.solved!==2)throw Error('A single plate step did not latch the indoor cave gate open');
        simple.animate(1);
        if(collision.blocksBox(area,gateX,gateZ,.18))throw Error('Solved fallback plate still blocks the treasure alcove');
        if(!collision.blocksBox(area,room.x+.65,gateZ,.18))throw Error('Fallback bypasses the permanent cave wall');
        assertTallSideWalls(simple,'pressure-plate gate');
        await assertAuthoredGate(simple,'pressure plate');
        if(!plateAt(stepper.x,stepper.z))throw Error('A solved plate stopped supporting the player');
        simple.dispose();simple=null;
        if(plateAt(stepper.x,stepper.z))throw Error('Cave teardown left an invisible pressure plate');
        if(collision.providerIds().length!==countBefore)throw Error('Fallback cave leaked collision providers');

        state.phase='music';
        let opened=0,closed=0,player={x:room.x+room.w/2,z:room.z+room.d/2-1.6};
        let scoreClockMs=performance.now(); // The browser smoke advances an authored score without waiting through its full real-time duration.
        music=window.RuinLayerChallenges.compose({
          THREE,parent:group,room,id:'browser-music-test',kind:'timedMelody',area,y:0,authoredCliffDoor:true,caveRoofHeight:roofHeight,
          isActive:()=>state.phase==='music',onSolved:()=>state.solved++,
          music:{beginPlayerSession:()=>{opened++;return true;},close:()=>{closed++;}},
          puzzleCaveMelody:window.PuzzleCaveMelody,songOptions:{difficulty:5},
          getPlayerY:()=>0,getPlayerPosition:()=>player,
          clockMs:()=>scoreClockMs, // Keeps the real score/judge on the same deterministic monotonic clock during manual tick(dt) tests.
        });
        if(music.song.bpm>88||music.song.bpm<60||music.song.measures!==4||music.song.notes.some(note=>note.lengthTicks<2))throw Error('Generated score violates slower eighth-note/four-measure constraints');
        const songBpm=music.song.bpm; // Preserved after teardown for the mobile Chromium smoke result.
        if(!collision.blocksBox(area,gateX,gateZ,.18))throw Error('Closed melody slab is not collidable');
        music.tick(0);
        if(opened!==0||closed!==0)throw Error('Stepping on a song plate must never open or close the player instrument');
        if(music.backdrop!==null)throw Error('Melody gate should not construct any fake black passage');
        if(music.plate.userData.puzzleCavePlateTexture!=='carved_smooth.png'||
          music.plate.userData.puzzleCaveTankanText!=="Hao'uun")
          throw Error('Melody plate is missing authored carved_smooth material or Tankan hao\'uun inscription');
        await waitFor(()=>music.plate.userData.puzzleCaveTankanReady||music.plate.userData.puzzleCaveTankanError,
          'Tankan glyph canvas and actual furniture font');
        if(music.plate.userData.puzzleCaveTankanError)
          throw Error('Real Tankan lettering failed: '+music.plate.userData.puzzleCaveTankanError);
        const label=music.plate.children.find(child=>child.name==='puzzle-cave-tankan-hao-uun');
        const canvas=label?.material?.map?.image;
        if(!label?.visible||!canvas?.getContext)
          throw Error('The Tankan inscription exists only as metadata; no rendered lettering is visible');
        const up=new THREE.Vector3(0,0,1).applyQuaternion(label.quaternion); // The top-facing decal must point up, not through the plate.
        const readTop=new THREE.Vector3(0,1,0).applyQuaternion(label.quaternion); // Canvas top must aim toward the locked doorway.
        if(up.y<.99||readTop.z<.99)
          throw Error('Tankan plate lettering is upside down from the cave approach or faces through the floor');
        const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
        let visiblePixels=0;
        for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)visiblePixels++;
        if(!visiblePixels)throw Error('The Tankan font loaded but the inscription canvas is blank');
        await waitFor(()=>music.plate.material?.map?.image?.width>0,
          'carved_smooth.png plate texture');
        if(music.plate.material.map.userData?.furnitureTexture!=='carved_smooth.png')
          throw Error('Plate does not use the furniture material texture pipeline');
        if(music.glyphs.length!==music.song.notes.length||
          !(music.inscription?.group.visible||music.scorePanel?.visible))
          throw Error('The full glowing Scratchbone clue did not appear on the fixed wall while standing on the plate');
        const scoreDiagnostics=music.inscription?.diagnostics(); // The cave gate scores two freestanding pillars, each with one upright note column.
        if(scoreDiagnostics?.kind!=='pillarPair'||scoreDiagnostics.columns.length!==2||!scoreDiagnostics.columns.every(column=>column?.vertical))
          throw Error('The production melody decal system failed to mount the score on an upright stone face');
        for(const post of scoreDiagnostics.posts)
          if(post.x<room.x+.5||post.x>room.x+room.w-.5)
            throw Error('A score pillar sits outside the cave room and may clip out of the rock');
        let elapsed=0;
        for(let index=0;index<music.song.notes.length;index++){
          const note=music.song.notes[index],target=(note.startTick+.10)*music.song.secondsPerTick;
          while(elapsed<target-1e-8){const dt=Math.min(.04,target-elapsed);scoreClockMs+=dt*1000;music.tick(dt);elapsed+=dt;}
          if(music.session.activeIndex()!==index)throw Error('Glyph beat/tick diverged from the authored melody');
          window.dispatchEvent(new CustomEvent('hobunji-kurraya-puzzle-note',{
            detail:{area,noteIndex:note.index}
          }));
        }
        if(!music.solved||state.solved!==3)throw Error('Written melody did not unlock the real stone door');
        music.animate(1);
        if(collision.blocksBox(area,gateX,gateZ,.18))throw Error('Raised melody slab still blocks player');
        if(!collision.blocksBox(area,room.x+room.w-.65,gateZ,.18))throw Error('Right rock flank bypasses melody puzzle');
        assertTallSideWalls(music,'melody gate');
        await assertAuthoredGate(music,'melody'); // The actual loaded gate must still have no black plane after the solve.
        music.dispose();music=null;
        group.remove(caveShell);caveShell.geometry.dispose();caveShell.material.dispose();
        if(collision.providerIds().length!==countBefore||group.children.length!==0)
          throw Error('Composed cave mechanisms leaked scene geometry or collision providers');
        // Exercise the actual cave-site scene constructor: the direct challenge tests
        // above do not enter buildPuzzleCaveChallenge, where fireAvailable used to throw.
        const caveSystem=window.CaveSiteSystem;
        const legacyId='map_i_den_browser_legacy_music'; // Isolated test map, never a player's cave.
        const caveSignature=Array.from({length:64},(_,i)=>'browser-legacy-cave-'+i)
          .find(value=>caveSystem.__test.hashSeed(value+':outdoor-song')%2===0);
        if(!caveSignature)throw Error('Could not prepare a deterministic exterior-music legacy fixture');
        const legacyProfile={
          mapId:legacyId,signature:caveSignature,source:'independent_cliff',
          zoneId:'map_test_wilds',denId:'browser-legacy',contents:'puzzle_cave',inhabitant:'none',
        }; // The same real profile shape used for save identity and exterior melody selection.
        const legacyPlan={profile:legacyProfile,puzzleCave:{
          id:'puzzle-cave:'+legacyId,col:room.x+4,row:room.z+4,
          kind:'fireSconces',difficulty:2,
        },puzzleTreasure:null,mushrooms:[]}; // Modern regenerated interior, even when the saved original was music.
        const legacyMap={id:legacyId,mesh:{vaultCeiling:{topY:roofHeight}},
          caveTraps:[],caveMushrooms:[],caveProps:[]}; // Real builder needs no fake furniture or extra generated rocks.
        const legacyScene=new THREE.Group(); // Separate from the direct mechanism test's now-disposed scene.
        const registry=caveSystem.__test;
        registry.ensureStateLoaded();
        registry.sitesByMapId.set(legacyId,legacyProfile);
        registry.plansByMapId.set(legacyId,legacyPlan);
        registry.runtimeStateBySignature.set(caveSignature,{
          discovered:true,outdoorPuzzleSolved:true,puzzleSolved:true,
          puzzleRewardTier:2,puzzleRewardClaimed:false,
        }); // A prior solve must reopen the physical slab without consuming the reward.
        try{
          await caveSystem.buildInteriorProps(legacyId,legacyMap,legacyScene);
          const fireInterior=registry.puzzleChallengesByMapId.get(legacyId)?.challenge;
          if(fireInterior?.kind!=='fireSconces'||!fireInterior.solved||fireInterior.doorRise!==1)
            throw Error('Real cave-site builder failed to restore a solved exterior-music cave with fire interior');
          legacyPlan.puzzleCave.kind='timedMelody'; // Simulate the old interior selection behind the same exterior music gate.
          await caveSystem.buildInteriorProps(legacyId,legacyMap,legacyScene);
          const adapted=registry.puzzleChallengesByMapId.get(legacyId)?.challenge;
          if(adapted?.kind!=='cavePressurePlate'||!adapted.solved||adapted.doorRise!==1)
            throw Error('Real cave-site builder failed to migrate a saved legacy melody to a solved pressure plate');
          if(!fireInterior.disposed)throw Error('Legacy scene rebuild retained its previous fire challenge');
          if(!adapted.rockSurround?.geometry?.getAttribute?.('position'))
            throw Error('Migrated interior lost the permanent stone gate surround');

          // Enter through the real game loader with a deterministic carved-floor sample.
          const floorY=.28, plateRow=legacyPlan.puzzleCave.row-2;
          const floor=[]; // Clear tiles around the plate, including an adjacent bare tile.
          for(let row=room.z;row<room.z+room.d;row++)
            for(let col=room.x;col<room.x+room.w;col++)floor.push([col,row]);
          const generator=window.CavernGenerator;
          const originalGenerate=generator.generateCavernFloorAsync;
          const originalSynthesize=generator.synthesizeCavernMapData;
          try{
            generator.generateCavernFloorAsync=(id,...args)=>id===legacyId?Promise.resolve(null):originalGenerate(id,...args);
            generator.synthesizeCavernMapData=(id,...args)=>id===legacyId?{
              ...legacyMap,schema:'hobunji_building_interior.v1',wallStyle:'cavern',cols:15,rows:17,floor,exits:[],
              floorSurfaceY:.24,floorSurfaceByTile:{[legacyPlan.puzzleCave.col+','+plateRow]:floorY},
              mesh:{...legacyMap.mesh,positions:[3,.24,5,3,.24,14,12,.24,5,12,.24,14],indices:[0,1,2,2,1,3]},
            }:originalSynthesize(id,...args);
            const debug=window.__hobunjiFurnitureDebug;
            await debug.loadBuildingScene(legacyId);
            debug.enterBuilding(legacyId,legacyPlan.puzzleCave.col-1,plateRow);
            const live=registry.puzzleChallengesByMapId.get(legacyId)?.challenge;
            const actor=window.ActorRegistry.getLocalPlayer();
            const avatar=window.PlayerBodyTransformComposer.getPlayerMesh();
            if(!live?.plate||live===adapted||!actor||!avatar)throw Error('Live cave or local player did not mount');
            const tileSize=actor.x/(legacyPlan.puzzleCave.col-.5); // Use the live game's actor coordinates to derive its grid scale.
            await waitFor(()=>Math.abs(actor.physicalFeetY-.24)<.002,'bare cave floor footing');
            actor.x=live.plate.position.x*tileSize;
            actor.y=live.plate.position.z*tileSize;
            const center=live.plate.position;
            const expectedTop=floorY+.155;
            const support=window.DynamicSurfaces.samplePressurePlate(legacyId,center.x,center.z,floorY,floorY+.25);
            if(!support||Math.abs(support.y-expectedTop)>1e-5)
              throw Error('Live plate support must rise above its sampled cave floor: floor='+floorY+' support='+support?.y);
            await waitFor(()=>Math.abs(actor.physicalFeetY-expectedTop)<.002
              &&Math.abs(avatar.position.y-expectedTop)<.025,'live feet and avatar on the plate');
            actor.x=(legacyPlan.puzzleCave.col-.5)*tileSize;
            await waitFor(()=>Math.abs(actor.physicalFeetY-.24)<.002,'stepping back down onto the bare cave floor');
          }finally{
            generator.generateCavernFloorAsync=originalGenerate;
            generator.synthesizeCavernMapData=originalSynthesize;
          }
        }finally{
          registry.puzzleChallengesByMapId.get(legacyId)?.challenge?.dispose?.();
          registry.puzzleChallengesByMapId.delete(legacyId);
          registry.plansByMapId.delete(legacyId);
          registry.sitesByMapId.delete(legacyId);
          registry.runtimeStateBySignature.delete(caveSignature);
          window.CaveTripwireTraps?.dispose?.(legacyId);
          legacyScene.clear();
        }
        if(collision.providerIds().length!==countBefore)
          throw Error('Real cave-site builder leaked a collider after legacy cave reconstruction');
        return {passed:true,automaticInstrumentSessions:opened,gatesSolved:state.solved,sconces:state.lit,bpm:songBpm,tankanPixels:visiblePixels};
      }finally{
        fire?.dispose?.();simple?.dispose?.();music?.dispose?.();
      }
    });
    assert.equal(result.passed,true);
    assert.equal(result.gatesSolved,3);
    assert.equal(result.sconces,2);
    assert(!errors.some(error=>/climb-system|BARN_TIERS|Cannot read properties of null \(reading 'getHour'\)|puzzle-cave-melody|ruin-layer-challenges/i.test(error)),
      'No startup errors from previously broken climbing, shop stock, music or Puzzle Cave modules: '+errors.slice(-20).join(' | '));
    console.log('PASS real mobile-sized Chromium Puzzle Caves: startup, Three.js music/fire, physical gates and cleanup',JSON.stringify(result));
  }catch(error){
    console.error('Puzzle Cave browser failure:',error);
    console.error('Recent browser errors:',errors.slice(-30).join('\n'));
    throw error;
  }finally{await browser.close();}
}
main().catch(()=>{process.exitCode=1;});
