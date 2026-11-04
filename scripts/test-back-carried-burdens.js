// Regression for one real back-carried Burden, carrier-hit explosions, continuing witch-bomb fuses,
// and editable Furniture Author back-carry transforms.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); // Loads the actual production modules being tested.
class Vector3 {
  constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); }
  copy(v) { Object.assign(this,{x:v.x,y:v.y,z:v.z}); return this; }
  set(x,y,z) { return this.copy({x,y,z}); }
}
class Group {
  constructor() {
    this.isObject3D=true;this.userData={};this.position=new Vector3();this.children=[];this.parent=null;
  }
  add(child) { child.parent?.remove?.(child);this.children.push(child);child.parent=this; }
  remove(child) { this.children=this.children.filter(item=>item!==child);child.parent=null; }
  getWorldPosition(target) { return target.copy(this.position); }
  traverse(callback) { callback(this);for(const child of this.children)child.traverse?.(callback); }
  updateWorldMatrix() {}
}

function testEditorAuthoring() {
  const author=read('docs/tools/furniture-avatar-author/carryable-objects.js'); // The editor's exported normalization is tested directly.
  const begin=author.indexOf('  function normalized(value) {');
  const end=author.indexOf('\n  state.carryable=normalized(',begin);
  assert(begin>=0&&end>begin,'find the actual furniture author normalization function');
  const normalize=vm.runInNewContext(author.slice(begin,end)+'\nnormalized');
  const original={position:{x:.1,y:.5,z:.2},rotation:{x:5,y:20,z:7},posteriorOffset:{x:0,y:.1,z:.3},size:1.2};
  const defaultBack=normalize({billboardAnchor:original}).backCarry;
  assert.equal(defaultBack.position.x,.1);
  assert.equal(defaultBack.position.y,.5);
  assert.equal(defaultBack.rotation.x,5);
  assert.equal(defaultBack.rotation.y,200,'legacy furniture defaults to 180 degrees around portrait vertical');
  assert.equal(defaultBack.posteriorOffset.z,.3);
  assert.equal(defaultBack.size,1.2);
  const customBack=normalize({billboardAnchor:original,backCarry:{
    position:{x:-.4,y:.8,z:.7},rotation:{x:11,y:93,z:4},
    posteriorOffset:{x:.2,y:-.3,z:.4},size:.75,
  }}).backCarry;
  assert.equal(customBack.position.x,-.4,'back attachment position can be authored independently');
  assert.equal(customBack.rotation.y,93,'back rotation is stored without the fallback flip');
  assert.equal(customBack.posteriorOffset.y,-.3);
  assert.equal(customBack.size,.75);
}

function testRuntime() {
  const scene=new Group(),player={x:4.5*64,y:3.5*64,health:100,angle:0,lastAttackReceivedAt:100};
  const grid=Array.from({length:10},()=>Array.from({length:10},()=>({type:'grass'})));
  let activeScene=scene; // Simulates area unload during bomb detonation without creating WebGL art.
  let clock=1000; // Deterministic fuse clock for the witch-bomb behavior.
  const deps={player,TILE:64,getCurrentArea:()=> 'map_back_test',getActiveScene:()=>activeScene,
    worldSurfaceY:()=>0,refreshActionBar(){},showToast(){},hostileObjects:new Set(),npcWalkers:new Set()};
  const window={
    THREE:{Vector3,Group},Combat:{deps,update(){},init(){}},
    GridTileAccessors:{getActiveScene:()=>activeScene,getCurrentArea:()=> 'map_back_test',getActiveGrid:()=>grid},
    __farmLog(){},WorldEvents:{emit(){}},AudioSystem:{playObjectSfxKey(){}},
    ResourceSystem:{spendFooting(){}},ActionArcUI:{stowForCarry(){}},
  };
  const context={window,console,performance:{now:()=>clock},localStorage:{getItem:()=>null,setItem(){}}};
  vm.runInNewContext(read('docs/js/shattercasks.js'),context,{filename:'shattercasks.js'});
  window.Shattercasks.tick(.2); // Completes initial world-id loading before creating the test Burden.
  const causes=[]; // Tracks the custom impact callback invoked by the real carrier-damage path.
  const charge=window.Shattercasks.registerBurden({mapId:'map_back_test',scene,group:new Group(),
    id:'test-carrier-charge',kind:'otherExplosive',hanging:false,
    data:{carryable:{explodeOnHit:true}},
    onImpact:(burden,cause)=>{
      causes.push(cause);
      window.Shattercasks.discardBurden(burden);
      return true;
    },
  });
  assert(charge);
  assert(window.Shattercasks.pickUp(charge));
  assert.equal(window.Shattercasks.toolArchAction(),'pickup','Tool Select owns the context before back stow');
  assert(window.Shattercasks.toolArchTap(),'Tool Select stows an actual physical Burden');
  assert.equal(window.Shattercasks.debugSnapshot().held,null);
  assert.equal(window.Shattercasks.backCarriedInfo()?.id,charge.id);
  assert(!window.Shattercasks.stowOnBack(),'only one Burden can occupy the back slot');
  assert(window.Shattercasks.takeFromBack(),'tool-arch selection retrieves the same instance');
  assert.equal(window.Shattercasks.debugSnapshot().held,charge.id);
  assert(window.Shattercasks.stowOnBack());
  player.health-=10; // Affliction damage alone must never trigger a back-mounted collision.
  window.Shattercasks.tick(.02);
  assert.equal(causes.length,0,'health loss without a physical hit does not detonate the burden');
  player.lastAttackReceivedAt+=500; // Same marker written by ResourceSystem.applyDamage on real impacts.
  window.Shattercasks.tick(.02);
  assert.equal(causes.length,1,'a direct impact triggers even if enhanced Health absorbs damage');
  assert.equal(causes[0],'carrier-direct-hit');
  assert.equal(window.Shattercasks.backCarriedInfo(),null,'hit-triggered explosion clears the back slot');
  assert.equal(window.Shattercasks.getBurden(charge.id),null,'the original physical item is consumed');

  const bomb=window.Shattercasks.registerBurden({mapId:'map_back_test',scene,group:new Group(),
    id:'test-back-witch-bomb',kind:'hronalWitchBomb',hanging:false,data:{carryable:{}}});
  bomb.fuseSeconds=2;bomb.spawnedAtMs=clock;
  assert(window.Shattercasks.pickUp(bomb));
  assert(window.Shattercasks.stowOnBack());
  const blasts=[]; // Captures the original witch-bomb blast options without requiring Three.js geometry rendering.
  window.Shattercasks={...window.Shattercasks,
    applyBlast:(mapId,x,z,options)=>blasts.push({mapId,x,z,options}),
    triggerBurdenBlastAt:()=>0,
  };
  vm.runInNewContext(read('docs/js/hronal-witch-bombs.js'),context,{filename:'hronal-witch-bombs.js'});
  clock+=1500;
  window.HronalWitchBombs.tick(.02);
  assert.equal(blasts.length,0,'stowing a witch-bomb does not pause or prematurely trigger its fuse');
  assert(window.HronalWitchBombs.debugSnapshot().activeBombs[0].remainingSeconds>0);
  activeScene=null; // The fuse explosion's world logic must work even if the rendered scene is unavailable.
  clock+=800;
  window.HronalWitchBombs.tick(.02);
  assert.equal(blasts.length,1,'fuse triggers exactly once while the bomb is back-carried');
  assert.equal(blasts[0].x,player.x/64,'blast is centered exactly on the carrier X coordinate');
  assert.equal(blasts[0].z,player.y/64,'blast is centered exactly on the carrier Z coordinate');
  assert.equal(window.Shattercasks.backCarriedInfo(),null,'expired bomb is removed from the back');
}

testEditorAuthoring();
testRuntime();
console.log('PASS back-carried burdens: tool arch, one-slot limit, hit reactions, timer, editor anchors');
