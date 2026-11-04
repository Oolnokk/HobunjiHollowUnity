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
  add(v) { this.x+=v.x;this.y+=v.y;this.z+=v.z;return this; }
  sub(v) { this.x-=v.x;this.y-=v.y;this.z-=v.z;return this; }
  multiplyScalar(s) { this.x*=s;this.y*=s;this.z*=s;return this; }
  multiply(v) { this.x*=v.x;this.y*=v.y;this.z*=v.z;return this; }
  divide(v) { this.x/=v.x||1;this.y/=v.y||1;this.z/=v.z||1;return this; }
  clone() { return new Vector3(this.x,this.y,this.z); }
  applyQuaternion(q) {
    const yaw=Number(q?.yaw)||0,c=Math.cos(yaw),s=Math.sin(yaw),x=this.x,z=this.z;
    this.x=x*c+z*s;this.z=z*c-x*s;return this; // Yaw is sufficient for root-vs-neck parentage regression.
  }
}
class Euler {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { Object.assign(this,{x,y,z});return this; }
}
class Quaternion {
  constructor() { this.yaw=0; }
  setFromEuler(euler) { this.yaw=euler.y;return this; }
  invert() { this.yaw=-this.yaw;return this; }
  copy(other) { this.yaw=other.yaw;return this; }
  multiply(other) { this.yaw+=other.yaw;return this; }
  clone() { const result=new Quaternion();return result.copy(this); }
}
class Group {
  constructor() {
    this.isObject3D=true;this.userData={};this.position=new Vector3();this.children=[];this.parent=null;
    this.quaternion=new Quaternion(); // Used to verify back mounting ignores head/neck yaw but inherits body yaw.
    this.scale=new Vector3(1,1,1); // Transform tests cover portrait-local scale preservation when mounting to the skinned mesh.
    this.scale.setScalar=function(v){this.set(v,v,v);return this;};
  }
  add(child) { child.parent?.remove?.(child);this.children.push(child);child.parent=this; }
  remove(child) { this.children=this.children.filter(item=>item!==child);child.parent=null; }
  localToWorld(point) {
    for(let node=this;node;node=node.parent)point.multiply(node.scale).applyQuaternion(node.quaternion).add(node.position);
    return point;
  }
  worldToLocal(point) {
    const chain=[];for(let node=this;node;node=node.parent)chain.unshift(node);
    for(const node of chain)point.sub(node.position).applyQuaternion(node.quaternion.clone().invert()).divide(node.scale);
    return point;
  }
  getWorldPosition(target) { return this.localToWorld(target.set(0,0,0)); }
  getWorldScale(target) {
    target.set(1,1,1);
    for(let node=this;node;node=node.parent)target.multiply(node.scale);
    return target;
  }
  traverse(callback) { callback(this);for(const child of this.children)child.traverse?.(callback); }
  updateWorldMatrix() {}
}
class MeshBasicMaterial {
  constructor(options={}) { Object.assign(this,{visible:true,depthTest:true,depthWrite:true,...options}); }
  clone() { return new MeshBasicMaterial({...this}); }
  dispose() {}
}
class SkinnedMesh extends Group {
  constructor(geometry,material) {
    super();this.isMesh=this.isSkinnedMesh=true;this.geometry=geometry;
    this.material=material;this.skeleton={};this.bindMatrix={};
  }
  bind(skeleton,matrix) { this.skeleton=skeleton;this.bindMatrix=matrix; }
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
  let currentArea='map_back_test'; // Mutable map identity exercises moving one physical burden between populated zones.
  let clock=1000; // Deterministic fuse clock for the witch-bomb behavior.
  const deps={player,TILE:64,getCurrentArea:()=>currentArea,getActiveScene:()=>activeScene,
    worldSurfaceY:()=>0,refreshActionBar(){},showToast(){},hostileObjects:new Set(),npcWalkers:new Set()};
  const bodyRoot=new Group();bodyRoot.name='player_body_root'; // Canonical composer root for back attachment.
  const headJoint=new Group();headJoint.name='player_neck_joint'; // Held burden continues to use this preexisting dependency unchanged.
  bodyRoot.add(headJoint);
  headJoint.position.set(.25,.3,.15);
  const portrait=new SkinnedMesh(null,[
    new MeshBasicMaterial({name:'npc_avatar_skinned_front_material'}),
    new MeshBasicMaterial({name:'npc_avatar_skinned_back_material'})]);
  portrait.name='player_avatar_skinned_plane_assembly'; // Active skinned portrait and its back-only x-ray clone.
  portrait.position.set(.08,.2,-.12);portrait.scale.setScalar(1.2);
  const firstAvatar=new Group();firstAvatar.name='original_player_avatar'; // Live avatar instance can be swapped without removing its predecessor immediately.
  firstAvatar.userData.neckRig={skinnedPlane:portrait};
  bodyRoot.add(firstAvatar);firstAvatar.add(portrait);
  let activeAvatar=firstAvatar; // Canonical WorldPortraitLife instance used to distinguish current portrait from stale ancestors.
  let currentBodyRoot=bodyRoot; // Simulates an asynchronously rebuilt avatar root.
  deps.playerMesh=headJoint;
  const window={
    THREE:{Vector3,Group,Euler,Quaternion,MeshBasicMaterial,SkinnedMesh},Combat:{deps,update(){},init(){}},
    ProceduralHandAttachments:{gameDeps:deps},
    PlayerBodyTransformComposer:{getPlayerMesh:()=>currentBodyRoot,getPosteriorY:()=>.42},
    WorldPortraitLife:{getPlayerAvatar:()=>({group:activeAvatar})},
    GridTileAccessors:{getActiveScene:()=>activeScene,getCurrentArea:()=>currentArea,getActiveGrid:()=>grid},
    __farmLog(){},WorldEvents:{emit(){}},AudioSystem:{playObjectSfxKey(){}},
    ResourceSystem:{spendFooting(){}},ActionArcUI:{stowForCarry(){}},
  };
  const context={window,console,performance:{now:()=>clock},localStorage:{getItem:()=>null,setItem(){}}};
  vm.runInNewContext(read('docs/js/shattercasks.js'),context,{filename:'shattercasks.js'});
  window.Shattercasks.tick(.2); // Completes initial world-id loading before creating the test Burden.
  const causes=[]; // Tracks the custom impact callback invoked by the real carrier-damage path.
  const charge=window.Shattercasks.registerBurden({mapId:'map_back_test',scene,group:new Group(),
    id:'test-carrier-charge',kind:'otherExplosive',hanging:false,
    data:{carryable:{explodeOnHit:true,backCarry:{
      position:{x:.13,y:.22,z:-.16},rotation:{x:0,y:12,z:0},
      posteriorOffset:{x:.08,y:0,z:.18},size:1,
    }}},
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
  assert.equal(charge.group.parent,portrait,'stowed burden is a DIRECT child of the live skinned portrait plane');
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.portraitAttached,true);
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.collision,'carrier-hitbox');
  assert(!window.Shattercasks.senseTargets(scene).includes(charge.group),
    'back Burden disappears from world-raycast targets while the carrier is exposed');
  assert.equal(window.Shattercasks.hitProjectile({vase:charge}),false,
    'stale separate-burden projectile contacts cannot trigger the stowed charge');
  const originalWorld=charge.group.getWorldPosition(new Vector3()); // Baseline for independent head motion.
  headJoint.position.set(-1,.9,.75);
  headJoint.quaternion.setFromEuler(new Euler(0,Math.PI*.7,0));
  window.Shattercasks.tick(.02);
  const afterHeadMotion=charge.group.getWorldPosition(new Vector3());
  for(const axis of ['x','y','z'])assert(Math.abs(afterHeadMotion[axis]-originalWorld[axis])<1e-8,
    'neck pose must not move the stowed burden along '+axis);
  const savedLocal=charge.group.position.clone(); // Must not be rewritten to counter independent portrait deadzone yaw.
  const savedQuaternion=charge.group.quaternion.yaw; // Verifies the item's authored orientation remains fixed in portrait space.
  portrait.quaternion.setFromEuler(new Euler(0,Math.PI*.65,0)); // Simulates the portrait plane's independent camera deadzone turn.
  window.Shattercasks.tick(.02);
  assert.equal(charge.group.parent,portrait);
  assert(Math.hypot(charge.group.getWorldPosition(new Vector3()).x-originalWorld.x,
    charge.group.getWorldPosition(new Vector3()).z-originalWorld.z)>.01,
    'stowed burden rotates WITH the portrait plane on camera deadzone changes');
  for(const axis of ['x','y','z'])assert(Math.abs(charge.group.position[axis]-savedLocal[axis])<1e-8,
    'portrait-relative position is not reset each tick along '+axis);
  assert.equal(charge.group.quaternion.yaw,savedQuaternion,'portrait-relative rotation remains fixed when the plane turns');
  bodyRoot.position.set(2,.5,-1);
  bodyRoot.quaternion.setFromEuler(new Euler(0,Math.PI/2,0));
  window.Shattercasks.tick(.02);
  const afterBodyMotion=charge.group.getWorldPosition(new Vector3());
  const expectedBodyMotion=portrait.localToWorld(charge.group.position.clone()); // Nested body rotation still reaches plane and burden once.
  for(const axis of ['x','y','z'])assert(Math.abs(afterBodyMotion[axis]-expectedBodyMotion[axis])<1e-8,
    'the burden follows the rotated/moved character root along '+axis);
  const nextPortrait=new SkinnedMesh(null,[
    new MeshBasicMaterial({name:'npc_avatar_skinned_front_material'}),
    new MeshBasicMaterial({name:'npc_avatar_skinned_back_material'})]); // A same-root cosmetic rebuild gives the old portrait time to linger.
  nextPortrait.name='replaced_player_skinned_plane';
  const nextAvatar=new Group();nextAvatar.name='replacement_player_avatar';
  nextAvatar.userData.neckRig={skinnedPlane:nextPortrait};
  bodyRoot.add(nextAvatar);nextAvatar.add(nextPortrait);
  activeAvatar=nextAvatar; // The previous, fully mounted avatar remains in the scene graph to expose a stale-cache bug.
  window.Shattercasks.tick(.02);
  assert.equal(firstAvatar.parent,bodyRoot,'old portrait remains attached during asynchronous rebuild');
  assert.equal(charge.group.parent,nextPortrait,'stowed burden follows the canonical live portrait, not the stale cached plane');
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.portraitAttached,true);
  currentBodyRoot=new Group();currentBodyRoot.name='player_rebuilt_body_root';
  activeAvatar=new Group();activeAvatar.name='loading_player_avatar';currentBodyRoot.add(activeAvatar);
  window.Shattercasks.tick(.02);
  assert.equal(charge.group.parent,currentBodyRoot,'missing portrait temporarily falls back to the rebuilt character root');
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.rootFallback,true);
  const rigidPortrait=new Group();rigidPortrait.name='npc_avatar_front_plane';rigidPortrait.isMesh=true; // Rebuilt legacy avatar lacks the skinned plane.
  rigidPortrait.position.set(0,.14,.02);activeAvatar.add(rigidPortrait);
  window.Shattercasks.tick(.02);
  assert.equal(charge.group.parent,rigidPortrait,'late-loaded rigid portrait replaces the root fallback automatically');
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.portraitAttached,true);
  const second=window.Shattercasks.registerBurden({mapId:currentArea,scene,group:new Group(),
    id:'test-hand-burden',kind:'inertStatue',hanging:false,data:{carryable:{}}});
  assert(window.Shattercasks.pickUp(second),'hands can still carry a different burden while the back is occupied');
  assert(!window.Shattercasks.stowOnBack(),'a second held burden cannot overwrite the occupied back slot');
  assert.equal(window.Shattercasks.backCarriedInfo()?.id,charge.id,'the first back burden remains untouched');
  assert(window.Shattercasks.discardBurden(second),'clear the extra hand burden before retrieving from back');
  assert(window.Shattercasks.takeFromBack(),'tool-arch selection retrieves the same instance');
  assert.equal(window.Shattercasks.debugSnapshot().held,charge.id);
  assert.equal(charge.group.parent,headJoint,'retrieval restores the ORIGINAL held-object mount');
  assert(window.Shattercasks.stowOnBack());
  assert.equal(charge.group.parent,rigidPortrait,'restowing reattaches directly to the rebuilt portrait');
  player.health-=10; // Affliction damage alone must never trigger a back-mounted collision.
  window.Shattercasks.tick(.02);
  assert.equal(causes.length,0,'health loss without a physical hit does not detonate the burden');
  player.lastAttackReceivedAt+=500; // Same marker written by ResourceSystem.applyDamage on real impacts.
  window.Shattercasks.tick(.02);
  assert.equal(causes.length,1,'a direct impact triggers even if enhanced Health absorbs damage');
  assert.equal(causes[0],'carrier-direct-hit');
  assert.equal(window.Shattercasks.backCarriedInfo(),null,'hit-triggered explosion clears the back slot');
  assert.equal(window.Shattercasks.getBurden(charge.id),null,'the original physical item is consumed');

  // A carried shattercask moving between rooms must never replace a static
  // shattercask with the same area-local ID, or respawn at its original source.
  const travel=window.Shattercasks.registerBurden({mapId:currentArea,scene,group:new Group(),
    id:'same-room-local-id',kind:'shattercask',hanging:false,data:{carryable:{}}});
  assert(window.Shattercasks.pickUp(travel));
  assert(window.Shattercasks.stowOnBack());
  const secondScene=new Group(); // Mimics a destination ruin with a static object using the same local ID.
  currentArea='map_back_destination';
  activeScene=secondScene;
  const incumbent=window.Shattercasks.registerBurden({mapId:currentArea,scene:secondScene,group:new Group(),
    id:'same-room-local-id',kind:'shattercask',hanging:false,data:{carryable:{}}});
  window.Shattercasks.tick(.2);
  assert.equal(window.Shattercasks.getBurden(incumbent.id,currentArea),incumbent,
    'incoming back burden may not overwrite destination static furniture');
  assert.equal(window.Shattercasks.getBurden(travel.id,currentArea),travel,
    'the back burden has its own live identity at its destination');
  assert.notEqual(travel.id,incumbent.id,'conflicting area-local IDs must be disambiguated');
  assert.equal(window.Shattercasks.getBurden('same-room-local-id','map_back_test'),null,
    'the original room no longer owns the carried object');
  assert.equal(window.Shattercasks.backCarriedInfo()?.id,travel.id);
  // The next room has not generated its static furniture yet. It must still
  // be free to generate an original Shattercask using the ordinary room ID.
  const thirdScene=new Group(); // Simulates the async load order used by authored ruin placements.
  currentArea='map_back_destination_late';
  activeScene=thirdScene;
  window.Shattercasks.tick(.2);
  assert(window.Shattercasks.getBurden(travel.id,currentArea)===travel);
  const lateStatic=window.Shattercasks.registerBurden({mapId:currentArea,scene:thirdScene,group:new Group(),
    id:'same-room-local-id',kind:'shattercask',hanging:false,data:{carryable:{}}});
  assert(lateStatic,'late static registration must remain possible');
  assert.equal(window.Shattercasks.getBurden(lateStatic.id,currentArea),lateStatic);
  assert.notEqual(travel.id,lateStatic.id,'traveling ID is independent of unspawned static ID');
  window.Shattercasks.discardBurden(travel);
  currentArea='map_back_test';
  activeScene=scene;

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
console.log('PASS back-carried burdens: live portrait selection, deadzone parenting, carrier collision, transitions, rebuilds, explosions, editor');
