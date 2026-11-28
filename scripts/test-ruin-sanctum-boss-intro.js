'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Run: node scripts/test-ruin-sanctum-boss-intro.js
const source=fs.readFileSync('docs/js/dev-random-ruin-sanctum.js','utf8');
let composer,clock=0,uid=0,active=null,created=0,disposed=0,locks=0,releases=0,effects=0,hazards=0,slowSpawn=null,discarded=0,skeletons=0,skeletonDisposals=0,warhammers=0,playerTeleports=0,stagedCancelled=0,telegraphsCancelled=0,weaponPoseUpdates=0;
const timers=new Map(),nodes=[],enemies=new Set(),introSounds=[],suppressedLichAlerts=[]; // Intro cue timing and the one combat-entry suppression are asserted against the fake clock.
const timeout=(fn,ms=0)=>{const id=++uid;timers.set(id,{at:clock+ms,fn});return id;};
const clear=id=>timers.delete(id);
async function settleMicrotasks(){
  // VM-created actors resolve across realms; two microtask turns are not reliably sufficient in real Node.
  for(let i=0;i<12;i++) await Promise.resolve();
}
async function advance(ms){
  const end=clock+ms;
  for(let n=0;n<100;n++){
    const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;
    clock=due[1].at;timers.delete(due[0]);due[1].fn();
    await settleMicrotasks(); // Drain the nested boss/portrait continuations before selecting the next fake timer.
  }
  clock=end;await settleMicrotasks(); // Avoid jumping past callbacks queued by a still-unsettled async spawn.
}
const document={
  createElement(tag){return {tag,style:{},offsetWidth:1,setAttribute(){},remove(){this.removed=true;}};},
  body:{appendChild(node){nodes.push(node);}},
};
function actor(options){
  return {name:'Imlao the Sightless',id:'lich'+(++created),x:options.x,y:options.y,health:100,maxHealth:100,
    facing:0,groupRot:0,pngRot:0,def:{aimAngleOffset:Math.PI/2}, // The production humanoid aims in combat-space, not raw group-yaw space.
    _banditToolHolder:{rotation:{y:999}}, // Authored warhammer is a world-space sibling; it cannot inherit its owner's yaw by parenting.
    avatarRef:{modelHeight:1.7,group:{rotation:{y:0}},dispose(){disposed++;}}};
}
const win={
  THREE:{},DynamicSurfaces:{},DevRandomRuinSimplePuzzles:{registerComposer:next=>composer=next},
  AudioSystem:{playObjectSfxKeyAt(key,x,z,area,y,opts){introSounds.push({key,x,z,area,y,opts,at:clock});}},
  CombatVocalizations:{suppressSkeletonCoffinSpawnAlert(entity){
    assert(!enemies.has(entity),'combat-entry suppression must happen before enrolling the lich in hostile AI');
    suppressedLichAlerts.push(entity);
    return true;
  }},
  DevRandomRuin:{setPlayerWorldPoint:()=>{playerTeleports++;return true;},getSeed:()=>77},
  BanditCombat:{discardEntity(entity){discarded++;entity.avatarRef?.dispose?.();},
    updateToolMesh(entity){weaponPoseUpdates++;entity._banditToolHolder.rotation.y=entity.groupRot;}}, // Verify the existing weapon-pose owner receives the turn as well as the actor group.
  Combat:{telegraph:{cancel(){telegraphsCancelled++;}},cancelStagedForAttacker(){stagedCancelled++;}}, // Use the canonical teardown path in the real encounter.
  MinionCombat:{makeEntity:async options=>({id:'skeleton'+(++skeletons),x:options.x,y:options.y,health:50,avatarRef:{dispose(){skeletonDisposals++;}}})},

  HarlyaoLichCombat:{allowArea(){},TYPE_DEFS:{kanthic:{label:'Kanthic Lich'}},
    makeEntity:options=>slowSpawn?slowSpawn(options):Promise.resolve(actor(options)),
    clearBossEffects(){effects++;}},
  SpecialHarlyaoLiches:{defFor:()=>({name:'Imlao the Sightless'}),applyPlasmSkin(){},releaseWarhammer(){warhammers++;},clear(){}}, 
  DevRandomRuinLichThemes:{resetBossHazards(){hazards++;}},
  CinematicCameraRuntime:{activate:(area,shot,options)=>active={area,shot,reason:options.reason},
    activeRecord:()=>active,deactivate(){active=null;}},
  CharacterActionLocks:{acquire(){locks++;return {};},release(){releases++;}},
};
vm.runInNewContext(source,{window:win,document,setTimeout:timeout,clearTimeout:clear,
  performance:{now:()=>clock},THREE:win.THREE,console},{filename:'dev-random-ruin-sanctum.js'});
const deps={TILE:64,hostileObjects:enemies,corpseObjects:new Set(),player:{x:0,y:0},
  getCurrentArea:()=> 'map_i_dev_random_ruin',_snapCameraTarget(){},showToast(){}};
const context={theme:'kanthic',specialBoss:true,meta:{floorSurfaceY:0},
  sanctumPlan:{arena:{minX:10,maxX:24,minZ:5,maxZ:19},
    vault:{minX:26,maxX:33,minZ:9,maxZ:15},zc:12}};
composer.buildRooms({deps},context,()=>.5,[],{sanctum:true});
const state=win.DevRandomRuinSanctum.getState();
Object.assign(state,{entry:{x:12,z:12},door:{front:{x:3,z:12}},bossType:'kanthic',
  coffins:[{index:0,open:false,lidT:0,rise:{x:20,z:10}}],arenaFires:[]});
const arenaLight={x:12,y:1.4,z:12,active:false}; // Source follows ignition, cancellation and reset.
state.arenaFires=[{lit:false,anchor:{visible:false},lightSource:arenaLight}];
state.sanctumLights=[arenaLight];
function assertProjectedRevealLight(lights, spotlight) {
  // Exercise the production darkness-cutout compositor; an active light record alone does not make the lich visible.
  class Vec {
    constructor(x=0,y=0,z=0){this.set(x,y,z);}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
    sub(other){this.x-=other.x;this.y-=other.y;this.z-=other.z;return this;}
    dot(other){return this.x*other.x+this.y*other.y+this.z*other.z;}
    setFromMatrixColumn(){return this.set(0,0,1);}
  }
  const fogSource=fs.readFileSync('docs/js/cloud-forest-fog.js','utf8'); // Real lighting implementation is instrumented without copying its drawing algorithm.
  const probeSource=fogSource.replace('  function ordinaryBuildingInterior(area) {',
    '  window.__probeRevealLight=(sources,deps)=>{lightingDeps=deps;drawRuinTraditionLightMasks(sources);return {...ruinFireMaskStats};};\n  function ordinaryBuildingInterior(area) {');
  assert.notEqual(probeSource,fogSource,'the production lighting probe must be installed');
  const fogWindow={THREE:{Vector3:Vec},WeatherFX:{init(){}}}; // Minimal host for the unchanged 2D overlay module.
  vm.runInNewContext(probeSource,{window:fogWindow,performance:{now:()=>clock},console},{filename:'cloud-forest-fog.js'});
  const draws={cutouts:0,glows:0}; // Records whether the renderer punches out blackness and paints the reveal glow.
  const ctx={canvas:{width:1000,height:600},globalCompositeOperation:'source-over',
    createRadialGradient:()=>({addColorStop(){}}),beginPath(){},arc(){},
    fill(){if(this.globalCompositeOperation==='destination-out')draws.cutouts++;
      else if(this.globalCompositeOperation==='source-over')draws.glows++;}};
  const camera={matrixWorld:{},near:.01,far:200,
    getWorldPosition:vector=>vector.set(spotlight.x-5,spotlight.y,spotlight.z),
    getWorldDirection:vector=>vector.set(1,0,0)};
  const lighting={lctx:ctx,camera,player:{x:spotlight.x*64,y:spotlight.z*64},TILE:64,
    getCurrentArea:()=> 'map_i_dev_random_ruin',getPlayerWorldY:()=>spotlight.floorY,
    getActiveScene:()=>({}),getThreeRect:()=>({width:1000,height:600}),
    worldToOverlay:(x,y,z)=>({x:500+(z-spotlight.z)*25,y:300-(y-spotlight.y)*25})};
  assert.equal(fogWindow.__probeRevealLight([{...spotlight,active:false}],lighting).drawn,0,
    'a switched-off spotlight must not clear Kanthic darkness');
  const projected=fogWindow.__probeRevealLight(lights,lighting); // The real sanctum source array is the one the game supplies each frame.
  assert(projected.projected>=1&&projected.drawn>=1,'the active lich spotlight must survive viewport/floor/room filtering');
  assert(draws.cutouts>=1&&draws.glows>=1,'the spotlight must actually draw a darkness cutout and colored halo');
}
async function run(){
  win.DevRandomRuinSanctum.enter();
  await advance(1750);
  assert(state.intro,'reveal must run before the fight');
  assert.equal(arenaLight.active,true,'entering ignites the arena light');
  assert.equal(win.DevRandomRuinSanctum.lightSources().length,2,'reveal adds a boss light alongside the arena brazier');
  assert.equal(state.introLight?.active,true,'the lich has a dedicated reveal light');
  assert.equal(state.introLight.x,state.boss.x/64,'temporary light follows the actual boss position');
  assertProjectedRevealLight(win.DevRandomRuinSanctum.lightSources(),state.introLight); // Verify actual projection, not only the source's active flag.
  assert.equal(enemies.size,0,'boss cannot simulate during the reveal');
  assert.equal(state.boss.x/64,18.5,'one-and-a-half tiles behind arena center');
  assert.equal(state.coffins[0].open,false,'coffins must remain closed during reveal');
  assert.equal(skeletons,0,'intro may not summon coffin skeletons');
  assert.equal(active.reason,'ruin-sanctum-boss-intro');
  assert.equal(active.shot.blendSeconds,.95);
  const initialFacing=state.boss.facing; // The boss starts mostly turned away before the reveal's face-to-face beat.
  const initialYaw=state.boss.avatarRef.group.rotation.y;
  const initialWeaponPoseUpdates=weaponPoseUpdates;
  const bearingToPlayer=Math.atan2(deps.player.y-state.boss.y,deps.player.x-state.boss.x); // Facing angles are world-relative; starting angle itself need not be large.
  assert(Math.abs(initialFacing-bearingToPlayer)>2,'lich should enter the shot turned away from the player');
  await advance(850);
  const title=nodes.find(node=>node.id==='ruin-sanctum-boss-title');
  assert(title,'name banner appears after camera begins zooming');
  assert.equal(title.textContent,'IMLAO THE SIGHTLESS');
  assert.match(title.style.cssText,/top:75%/);
  assert.match(title.style.cssText,/KhymeryyanRomanLetters\+Numbers/);
  assert.match(title.style.cssText,/-webkit-text-stroke:\.5px #000/);
  assert.match(title.style.cssText,/font-weight:400/,'authored glyphs must not be synthetically emboldened beneath the outline');
  assert.equal(introSounds.length,0,'the title enters just before the face-to-face shriek');
  win.DevRandomRuinSanctum.debugUpdateIntro(clock); // Exercise the production pose tick directly without rebuilding the minimal fake arena.
  assert.notEqual(state.boss.facing,initialFacing,'the boss visibly turns during the camera zoom');
  assert.notEqual(state.boss.avatarRef.group.rotation.y,initialYaw,'the rendered rig turns, not just the combat aim');
  assert.equal(state.boss.pngRot,state.boss.groupRot,'both portrait sides and the underlying rig agree on yaw');
  assert(weaponPoseUpdates>initialWeaponPoseUpdates,'the shared hostile weapon renderer must update while the boss turns');
  assert.equal(state.boss._banditToolHolder.rotation.y,state.boss.groupRot,'the independent warhammer follows the boss yaw');
  await advance(100);
  win.DevRandomRuinSanctum.debugUpdateIntro(clock);
  assert.equal(introSounds.length,1,'scream fires once when the turn finishes');
  assert.equal(introSounds[0].key,'ruinCoffinShriek','the sound reuses the existing skeleton recording');
  assert.equal(introSounds[0].area,'map_i_dev_random_ruin','the scream is spatial, not a UI/global audio cue');
  assert.equal(introSounds[0].x,state.boss.x/64);
  assert.equal(introSounds[0].opts.earshotTiles,24,'sanctum shriek carries across the chamber');
  assert.equal(state.boss.groupRot,state.boss.avatarRef.group.rotation.y,'rendered yaw does not drift at the end of the turn');
  assert.equal(state.boss._banditToolHolder.rotation.y,state.boss.groupRot,'low-FPS scream timer poses the weapon and body together');
  assert.equal(state.boss.facing,state.intro.turnTo,'scream cannot begin before a lagging render tick completes the face-to-face turn');
  const settledPoseCount=weaponPoseUpdates; // The shot holds for seconds after turning; idle frames must not repeatedly rebuild the warhammer stance.
  for(let i=0;i<60;i++)win.DevRandomRuinSanctum.debugUpdateIntro(clock+16*i);
  assert.equal(weaponPoseUpdates,settledPoseCount,'settled cinematic consumes no extra weapon-pose work');
  assert.equal(state.intro.shriekPlayed,true,'mobile debug records the shriek');
  await advance(2650);
  assert.equal(state.intro,null);
  assert.equal(introSounds.length,5,'one original shriek plus four extraordinary echoes, never a second attack shriek');
  assert.deepEqual(Array.from(introSounds,entry=>Math.round(entry.at)),[2700,3100,3570,4150,4770],'echoes keep their distinct long-delay pattern');
  assert.deepEqual(Array.from(introSounds,entry=>entry.opts.volumeScale),[1,.55,.32,.18,.09],'echo falls away without raising the master SFX volume');
  assert.equal(state.introLight,null,'reveal-only lighting stops with its shot');
  assert.equal(win.DevRandomRuinSanctum.lightSources().length,1,'only permanent arena lighting survives the reveal');
  assert(enemies.has(state.boss),'hostile simulation begins after reveal');
  assert.equal(suppressedLichAlerts.length,1,'intro shriek suppresses exactly one immediate combat-alert duplicate');
  assert.equal(suppressedLichAlerts[0],state.boss,'suppression applies to the lich, not its coffin guard');
  assert.equal(state.coffins[0].open,true);
  assert.equal(skeletons,1,'the first coffin guard spawns only when combat starts');
  assert(enemies.has(state.coffins[0].skeleton),'coffin guard participates in real combat');
  assert.equal(active,null);
  composer.onPlayerDeath();
  assert.equal(state.boss,null);
  assert.equal(arenaLight.active,false,'death resets arena lighting rather than leaking light to an empty room');
  assert.equal(state.coffins[0].open,false);
  assert.equal(state.coffins[0].skeleton,null);
  assert.equal(skeletonDisposals,1,'the existing coffin skeleton avatar must be retired');
  assert.equal(discarded,2,'boss and skeleton must use canonical entity teardown');
  assert.equal(stagedCancelled,2,'both boss and coffin guard must lose queued staged attacks');
  assert.equal(telegraphsCancelled,2,'combat telegraphs cannot survive encounter retirement');
  assert.equal(warhammers,1,'boss weapon-specific textures need an explicit reset');
  assert.equal(enemies.size,0);
  assert.equal(title.removed,true);
  assert.equal(effects,1);assert.equal(hazards,1);
  win.DevRandomRuinSanctum.enter();
  await advance(1750);
  assert(state.intro,'re-entry starts a new reveal');
  assert.equal(created,2);
  win.DevRandomRuinSanctum.leave();
  assert.equal(state.intro,null);
  assert.equal(state.boss,null);
  assert.equal(active,null);
  assert.equal(locks,releases,'intro locks must be returned after exits');
  const soundsBeforeExit=introSounds.length;
  await advance(3500); // Delayed shriek/echo timers belong to the cancelled intro and must stay silent.
  assert.equal(introSounds.length,soundsBeforeExit,'leaving before the scream cancels every queued echo');
  await advance(350); // Finish the physical return fade before interacting with the Great Door again.
  assert.equal(state.leavingSanctum,false);
  let resolveSpawn;
  slowSpawn=()=>new Promise(resolve=>{resolveSpawn=resolve;});
  win.DevRandomRuinSanctum.enter();
  await advance(1750);
  assert.equal(typeof resolveSpawn,'function');
  const before=disposed;
  win.DevRandomRuinSanctum.resetEncounter('stale-spawn-test');
  resolveSpawn(actor({x:1184,y:768}));
  await Promise.resolve();await Promise.resolve();
  assert.equal(state.boss,null,'delayed spawn cannot resurrect a reset boss');
  assert.equal(enemies.size,0);
  assert.equal(disposed,before+1,'delayed avatars must be disposed');
  assert.equal(discarded,4,'stale async spawns also use the canonical entity disposer');
  slowSpawn=null;
  win.DevRandomRuinSanctum.enter();
  await advance(1750);
  assert(state.intro,'re-entered sanctum must begin a fresh cinematic after the cancelled spawn');
  await advance(850);
  const dyingTitle=state.intro?.title; // Read the active cinematic owner, not a previously removed DOM title.
  assert(dyingTitle&&!dyingTitle.removed,'new title appears before death during a cinematic');
  composer.onPlayerDeath();
  assert.equal(dyingTitle.removed,true,'death in the reveal removes the banner');
  assert.equal(state.introLight,null,'death clears the temporary boss light');
  assert.equal(win.DevRandomRuinSanctum.lightSources().length,1,'death retains no temporary light source');
  assert.equal(state.intro,null,'death during the reveal cancels camera ownership');
  const soundsBeforeDeath=introSounds.length;
  await advance(3500);
  assert.equal(introSounds.length,soundsBeforeDeath,'death during reveal cancels every delayed shriek and echo');
  assert.equal(active,null);
  assert.equal(locks,releases,'death during reveal releases player controls');
  assert.equal(enemies.size,0);
  state.bossDefeated=true;
  state.rearDoor={open:true,progress:1,closedY:1,panel:{position:{y:0},visible:true}};
  win.DevRandomRuinSanctum.resetEncounter('completed-tomb');
  assert.equal(state.bossDefeated,true,'permanent authored-victory progress cannot be undone');
  assert.equal(state.rearDoor.open,true,'defeated guardian keeps vault accessible');
  state.bossDefeated=false; // A fresh unfinished tomb exercises the still-fading entrance boundary.
  win.DevRandomRuinSanctum.enter();
  assert.equal(state.enteringSanctum,true,'Great Door fade is tracked before the scene teleports');
  const teleportsBeforeEntryDeath=playerTeleports;
  composer.onPlayerDeath();
  await advance(400);
  assert.equal(playerTeleports,teleportsBeforeEntryDeath,'a delayed entrance may not teleport the player after death');
  assert.equal(state.inSanctum,false);
  assert.equal(state.enteringSanctum,false);
  win.DevRandomRuinSanctum.enter();
  await advance(350);
  assert.equal(state.inSanctum,true);
  win.DevRandomRuinSanctum.leave();
  assert.equal(state.leavingSanctum,true,'the return fade remains cancellable until its callback');
  const teleportsBeforeExitDeath=playerTeleports;
  composer.onPlayerDeath();
  await advance(400);
  assert.equal(playerTeleports,teleportsBeforeExitDeath,'a delayed exit may not move the player after their checkpoint respawn');
  assert.equal(state.leavingSanctum,false);
  assert.equal(state.intro,null);
  const fogSource=fs.readFileSync('docs/js/cloud-forest-fog.js','utf8'); // Both darkness paths must draw sanctum sources.
  assert.equal(fogSource.split('DevRandomRuinSanctum?.lightSources?.()').length-1,2,'fog and enclosed lighting both use the sanctum mask');
  const roomSource=fs.readFileSync('docs/js/ruin-room-system.js','utf8'); // Occupied-room illumination uses the same authoritative source.
  assert.ok(roomSource.includes('DevRandomRuinSanctum?.lightSources?.()'),'room ambient uses the sanctum light source');
  const rotateCode=fs.readFileSync('docs/js/dev-random-ruin-sanctum.js','utf8');
  const rotation=vm.runInNewContext(rotateCode.slice(rotateCode.indexOf('  function igniteFire('),rotateCode.indexOf('  function updateFire('))+'\nrotateKanthicFires;', {window:{}});
  const fires=Array.from({length:4},()=>({lit:false,ordinaryFire:true,contact:{userData:{}},anchor:{visible:false},lightSource:{active:false}}));
  const fireOwner={inSanctum:true,context:{theme:'kanthic'},arenaFires:fires};
  for(const [step,wanted] of [[0,0],[29,0],[1,1],[30,2],[30,3],[30,0]]){
    rotation(fireOwner,step);
    assert.deepEqual(fires.map(f=>f.lit),fires.map((_,i)=>i===wanted));
    assert.deepEqual(fires.map(f=>f.contact.userData.fireHazard),fires.map((_,i)=>i===wanted));
  }
  console.log('PASS: readable reveal, authored lights, intro lighting, timed combat, canonical cleanup, death/exit, fade cancellation, stale spawns, persistent victory');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
