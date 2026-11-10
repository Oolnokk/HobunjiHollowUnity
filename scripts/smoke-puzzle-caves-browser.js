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
      let fire=null,music=null;
      const waitFor=async(check,label)=>{
        for(let count=0;count<120;count++){ // Asset/font availability remains bounded on mobile CI.
          if(check())return;
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        throw Error('Timed out waiting for '+label);
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
          THREE,parent:group,room,id:'browser-fire-test',kind:'fireSconces',area,y:0,authoredCliffDoor:true,
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
        await assertAuthoredGate(fire,'fire'); // Verify the async authored asset contains no black backing geometry.
        fire.dispose();fire=null;
        if(collision.providerIds().length!==countBefore)throw Error('Fire cave leaked collision provider on disposal');

        state.phase='music';
        let opened=0,closed=0,player={x:room.x+room.w/2,z:room.z+room.d/2-1.6};
        let scoreClockMs=performance.now(); // The browser smoke advances an authored score without waiting through its full real-time duration.
        music=window.RuinLayerChallenges.compose({
          THREE,parent:group,room,id:'browser-music-test',kind:'timedMelody',area,y:0,authoredCliffDoor:true,
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
        if(!music.solved||state.solved!==2)throw Error('Written melody did not unlock the real stone door');
        music.animate(1);
        if(collision.blocksBox(area,gateX,gateZ,.18))throw Error('Raised melody slab still blocks player');
        if(!collision.blocksBox(area,room.x+room.w-.65,gateZ,.18))throw Error('Right rock flank bypasses melody puzzle');
        await assertAuthoredGate(music,'melody'); // The actual loaded gate must still have no black plane after the solve.
        music.dispose();music=null;
        group.remove(caveShell);caveShell.geometry.dispose();caveShell.material.dispose();
        if(collision.providerIds().length!==countBefore||group.children.length!==0)
          throw Error('Composed cave mechanisms leaked scene geometry or collision providers');
        return {passed:true,automaticInstrumentSessions:opened,songsSolved:state.solved,sconces:state.lit,bpm:songBpm,tankanPixels:visiblePixels};
      }finally{
        fire?.dispose?.();music?.dispose?.();
      }
    });
    assert.equal(result.passed,true);
    assert.equal(result.songsSolved,2);
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
