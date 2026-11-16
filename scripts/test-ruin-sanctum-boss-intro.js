'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Run: node scripts/test-ruin-sanctum-boss-intro.js
const source=fs.readFileSync('docs/js/dev-random-ruin-sanctum.js','utf8');
let composer,clock=0,uid=0,active=null,created=0,disposed=0,locks=0,releases=0,effects=0,hazards=0,slowSpawn=null;
const timers=new Map(),nodes=[],enemies=new Set();
const timeout=(fn,ms=0)=>{const id=++uid;timers.set(id,{at:clock+ms,fn});return id;};
const clear=id=>timers.delete(id);
async function advance(ms){
  const end=clock+ms;
  for(let n=0;n<100;n++){
    const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;
    clock=due[1].at;timers.delete(due[0]);due[1].fn();
    await Promise.resolve();await Promise.resolve();
  }
  clock=end;await Promise.resolve();await Promise.resolve();
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
  DevRandomRuin:{setPlayerWorldPoint:()=>true,getSeed:()=>77},
  HarlyaoLichCombat:{allowArea(){},TYPE_DEFS:{kanthic:{label:'Kanthic Lich'}},
    makeEntity:options=>slowSpawn?slowSpawn(options):Promise.resolve(actor(options)),
    clearBossEffects(){effects++;}},
  SpecialHarlyaoLiches:{defFor:()=>({name:'Imlao the Sightless'}),applyPlasmSkin(){},clear(){}},
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
  assert.equal(active,null);
  composer.onPlayerDeath();
  assert.equal(state.boss,null);
  assert.equal(state.coffins[0].open,false);
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
  console.log('PASS: cinematic, title, deferred combat, death/exit, async cancellation');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
