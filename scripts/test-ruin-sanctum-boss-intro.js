'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Run: node scripts/test-ruin-sanctum-boss-intro.js
const source=fs.readFileSync('docs/js/dev-random-ruin-sanctum.js','utf8');
let composer,clock=0,uid=0,active=null,created=0,disposed=0,locks=0,releases=0,effects=0,hazards=0,slowSpawn=null,discarded=0,skeletons=0,skeletonDisposals=0,warhammers=0,playerTeleports=0,stagedCancelled=0,telegraphsCancelled=0;
const timers=new Map(),nodes=[],enemies=new Set();
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
    avatarRef:{modelHeight:1.7,dispose(){disposed++;}}};
}
const win={
  THREE:{},DynamicSurfaces:{},DevRandomRuinSimplePuzzles:{registerComposer:next=>composer=next},
  DevRandomRuin:{setPlayerWorldPoint:()=>{playerTeleports++;return true;},getSeed:()=>77},
  BanditCombat:{discardEntity(entity){discarded++;entity.avatarRef?.dispose?.();}},
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
async function run(){
  win.DevRandomRuinSanctum.enter();
  await advance(1750);
  assert(state.intro,'reveal must run before the fight');
  assert.equal(enemies.size,0,'boss cannot simulate during the reveal');
  assert.equal(state.boss.x/64,18.5,'one-and-a-half tiles behind arena center');
  assert.equal(state.coffins[0].open,false,'coffins must remain closed during reveal');
  assert.equal(skeletons,0,'intro may not summon coffin skeletons');
  assert.equal(active.reason,'ruin-sanctum-boss-intro');
  assert.equal(active.shot.blendSeconds,.95);
  await advance(850);
  const title=nodes.find(node=>node.id==='ruin-sanctum-boss-title');
  assert(title,'name banner appears after camera begins zooming');
  assert.equal(title.textContent,'IMLAO THE SIGHTLESS');
  assert.match(title.style.cssText,/top:75%/);
  assert.match(title.style.cssText,/KhymeryyanRomanLetters\+Numbers/);
  assert.match(title.style.cssText,/-webkit-text-stroke:2\.5px #000/);
  await advance(2750);
  assert.equal(state.intro,null);
  assert(enemies.has(state.boss),'hostile simulation begins after reveal');
  assert.equal(state.coffins[0].open,true);
  assert.equal(skeletons,1,'the first coffin guard spawns only when combat starts');
  assert(enemies.has(state.coffins[0].skeleton),'coffin guard participates in real combat');
  assert.equal(active,null);
  composer.onPlayerDeath();
  assert.equal(state.boss,null);
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
  assert.equal(state.intro,null,'death during the reveal cancels camera ownership');
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
  console.log('PASS: reveal, outline, timed combat, canonical cleanup, death/exit, fade cancellation, stale spawns, persistent victory');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
