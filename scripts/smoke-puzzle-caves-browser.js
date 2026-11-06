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
    const result=await page.evaluate(()=>{
      const THREE=window.THREE;
      if(!THREE?.Group||!window.RuinLayerChallenges?.compose)throw Error('Real Three/ruin composer missing');
      const group=new THREE.Group(); // Detached 3D test scene never interferes with the saved player's world.
      const area='puzzle_cave_browser_test';
      const room={x:3,z:5,w:9,d:9};
      const gateX=room.x+room.w/2,gateZ=room.z+room.d-1.05;
      const collision=window.AreaFootprintBlockers;
      const countBefore=collision.providerIds().length; // Ensure the test frees only its own colliders, not cached game systems.
      const state={phase:'fire',solved:0,lit:0};
      const hot=new Set(); // Sconce contact is driven by actual authored coordinates, not a hard-coded gate location.
      let fire=null,music=null;
      try{
        fire=window.RuinLayerChallenges.compose({
          THREE,parent:group,room,id:'browser-fire-test',kind:'fireSconces',area,y:0,
          isActive:()=>state.phase==='fire',onSolved:()=>state.solved++,
          groundFire:{intersects:(map,x,z)=>map===area&&hot.has(x+','+z)},
          onSconceLit:()=>state.lit++,getPlayerY:()=>0,getPlayerPosition:()=>({x:0,z:0}),
        });
        if(!collision.blocksBox(area,gateX,gateZ,.18))throw Error('Closed fire slab is not physically collidable');
        if(collision.blocksBox('other-map',gateX,gateZ,.18))throw Error('Interior slab leaked into another area');
        for(const sconce of fire.sconces){hot.add(sconce.x+','+sconce.z);fire.tick(.016);hot.clear();}
        if(!fire.solved||state.solved!==1||state.lit!==2)throw Error('Two real sconces did not unlock the stone door');
        fire.animate(1);
        if(collision.blocksBox(area,gateX,gateZ,.18))throw Error('Raised fire gate still blocks player');
        fire.dispose();fire=null;
        if(collision.providerIds().length!==countBefore)throw Error('Fire cave leaked collision provider on disposal');

        state.phase='music';
        let opened=0,closed=0,player={x:room.x+room.w/2,z:room.z+room.d/2-1.6};
        music=window.RuinLayerChallenges.compose({
          THREE,parent:group,room,id:'browser-music-test',kind:'timedMelody',area,y:0,
          isActive:()=>state.phase==='music',onSolved:()=>state.solved++,
          music:{beginPlayerSession:()=>{opened++;return true;},close:()=>{closed++;}},
          puzzleCaveMelody:window.PuzzleCaveMelody,songOptions:{difficulty:5},
          getPlayerY:()=>0,getPlayerPosition:()=>player,
        });
        if(music.song.bpm>100||music.song.measures!==2)throw Error('Generated score violates requested tempo/length');
        if(!collision.blocksBox(area,gateX,gateZ,.18))throw Error('Closed melody slab is not collidable');
        music.tick(0);
        if(opened!==1)throw Error('Stepping onto a real plate did not enter the instrument session');
        let elapsed=0;
        for(let index=0;index<music.song.notes.length;index++){
          const note=music.song.notes[index],target=(note.startTick+.10)*music.song.secondsPerTick;
          while(elapsed<target-1e-8){const dt=Math.min(.04,target-elapsed);music.tick(dt);elapsed+=dt;}
          if(music.session.activeIndex()!==index)throw Error('Glyph beat/tick diverged from the authored melody');
          window.dispatchEvent(new CustomEvent('hobunji-kurraya-puzzle-note',{
            detail:{area,noteIndex:note.index}
          }));
        }
        if(!music.solved||state.solved!==2)throw Error('Written melody did not unlock the real stone door');
        music.animate(1);
        if(collision.blocksBox(area,gateX,gateZ,.18))throw Error('Raised melody slab still blocks player');
        music.dispose();music=null;
        if(collision.providerIds().length!==countBefore||group.children.length!==0)
          throw Error('Composed cave mechanisms leaked scene geometry or collision providers');
        return {passed:true,notes:opened,songsSolved:state.solved,sconces:state.lit,tempo:music?.song?.bpm};
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
