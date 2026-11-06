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
  assert.equal(defaultBack.portraitAnchor.x,0);
  assert.equal(defaultBack.portraitAnchor.y,0);
  assert.equal(defaultBack.portraitAnchor.z,0);
  const customBack=normalize({billboardAnchor:original,backCarry:{
    position:{x:-.4,y:.8,z:.7},rotation:{x:11,y:93,z:4},
    posteriorOffset:{x:.2,y:-.3,z:.4},portraitAnchor:{x:.1,y:.15,z:-.2},size:.75,
  }}).backCarry;
  assert.equal(customBack.position.x,-.4,'back attachment position can be authored independently');
  assert.equal(customBack.rotation.y,93,'back rotation is stored without the fallback flip');
  assert.equal(customBack.posteriorOffset.y,-.3);
  assert.equal(customBack.size,.75);
  assert.equal(customBack.portraitAnchor.y,.15);
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
  portrait.renderOrder=2; // The native PNG draw order must be restored after back carry or avatar rebuild.
  portrait.position.set(.08,.2,-.12);portrait.scale.setScalar(1.2);
  const firstAvatar=new Group();firstAvatar.name='original_player_avatar'; // Live avatar instance can be swapped without removing its predecessor immediately.
  firstAvatar.userData.neckRig={skinnedPlane:portrait};
  bodyRoot.add(firstAvatar);firstAvatar.add(portrait);
  let activeAvatar=firstAvatar; // Canonical WorldPortraitLife instance used to distinguish current portrait from stale ancestors.
  let currentBodyRoot=bodyRoot; // Simulates an asynchronously rebuilt avatar root.
  deps.playerMesh=headJoint;
  const targetSources=new Map(); // Holds actual Targetables source functions so stale entries can be tested after state transitions.
  const window={
    THREE:{Vector3,Group,Euler,Quaternion,MeshBasicMaterial,SkinnedMesh},Combat:{deps,update(){},init(){}},
    Targetables:{addSource:(key,fn)=>targetSources.set(key,fn),makeActor:entry=>({entry})},
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
      posteriorOffset:{x:.08,y:0,z:.18},portraitAnchor:{x:.12,y:-.08,z:.04},size:1,
    }}},
    onImpact:(burden,cause)=>{
      causes.push(cause);
      window.Shattercasks.discardBurden(burden);
      return true;
    },
  });
  assert(charge);
  const chargePart={renderOrder:0,material:new MeshBasicMaterial({transparent:false,depthTest:true,depthWrite:true})}; // Physical part used to verify held/back layer transitions.
  charge.meshColliders=[chargePart];
  const decal=new Group();decal.isMesh=true;decal.visible=true;decal.renderOrder=0; // Authored decals are visible but deliberately not collider meshes.
  decal.userData.furnitureDecal=true;
  decal.material=new MeshBasicMaterial({transparent:true,depthTest:true,depthWrite:false});
  charge.group.add(decal);
  charge.meshBounds={isEmpty:()=>false,getCenter:target=>target.set(4,.5,3)}; // Legacy cached geometric target, not a carrier-hitbox proxy.
  const originalTarget=targetSources.get('shattercasks')('map_back_test').find(entry=>entry.owner===charge);
  assert(originalTarget?.hitbox(),'the same physical Burden is independently targetable before being carried');
  assert(window.Shattercasks.pickUp(charge));
  assert.equal(window.Shattercasks.toolArchAction(),'pickup','Tool Select owns the context before back stow');
  assert(window.Shattercasks.toolArchTap(),'Tool Select stows an actual physical Burden');
  assert.equal(window.Shattercasks.debugSnapshot().held,null);
  assert.equal(window.Shattercasks.backCarriedInfo()?.id,charge.id);
  assert.equal(charge.group.parent,portrait,'stowed burden is a DIRECT child of the live skinned portrait plane');
  assert.equal(chargePart.renderOrder,2.15,'the back Burden renders after the rear PNG');
  assert.equal(chargePart.material.transparent,true,'opaque furniture joins the transparent PNG sort queue while stowed');
  assert.equal(chargePart.material.depthTest,true,'world terrain can still occlude the back Burden');
  assert.equal(chargePart.material.depthWrite,false,'back furniture cannot hide the front PNG by writing depth');
  assert.equal(decal.renderOrder,2.15,'non-colliding furniture decal must x-ray through the back PNG alongside its parent');
  assert.equal(portrait.renderOrder,2.25,'the real skinned front PNG renders after the stowed Burden');
  const rearPass=firstAvatar.children.find(child=>child.userData?.shattercaskRearOverlay);
  assert.equal(rearPass?.renderOrder,2.05,'the isolated skinned back PNG renders before the Burden');
  assert.equal(rearPass?.material[1].depthWrite,false,'rear pixels do not prevent the stowed Burden from rendering');
  assert.equal(portrait.material[0].visible,true,'front PNG remains visible');
  assert.equal(portrait.material[1].visible,false,'the original skinned back pass is not drawn twice');
  const lateDetail=new Group();lateDetail.isMesh=true;lateDetail.visible=true;lateDetail.renderOrder=0; // Simulates an asynchronous authored GLB child after pickup.
  lateDetail.material=new MeshBasicMaterial({transparent:false,depthWrite:true,depthTest:true});
  charge.group.add(lateDetail);
  const priorMaterial=chargePart.material;
  chargePart.material=new MeshBasicMaterial({transparent:false,depthWrite:true,depthTest:true}); // Recolored furniture can replace its original material while carried.
  window.Shattercasks.tick(.2); // Force the normal 7 Hz render-state reconciliation.
  assert.equal(lateDetail.renderOrder,2.15,'late-loaded furniture detail enters the correct stowed layer');
  assert.equal(lateDetail.material.transparent,true,'late-loaded opaque detail enters the PNG sorting queue');
  assert.equal(lateDetail.material.depthWrite,false,'late-loaded furniture cannot cover the front PNG');
  assert.equal(chargePart.material.transparent,true,'replacement material inherits the stowed render flags');
  assert.equal(chargePart.material.depthWrite,false,'replacement material cannot mask the front PNG');
  assert.equal(priorMaterial.depthWrite,true,'detached original material is restored on replacement');
  const authoredBurdenPoint=new Vector3(.13,.22,-.16).multiply(charge.group.scale).applyQuaternion(charge.group.quaternion);
  const actualAttachment=charge.group.position.clone().add(authoredBurdenPoint);
  for(const [axis,expected] of Object.entries({x:.12,y:-.08,z:.04}))
    assert(Math.abs(actualAttachment[axis]-expected)<1e-8,'back burden anchor follows portrait-local author coordinate on '+axis);
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.portraitAttached,true);
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.collision,'carrier-hitbox');
  assert.equal(originalTarget.hitbox(),null,'stowing also invalidates hitboxes exposed by previously cached Targetables entries');
  assert(!targetSources.get('shattercasks')('map_back_test').some(entry=>entry.owner===charge),
    'the targetables source cannot serve a separately hittable stowed burden');
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
  window.Shattercasks.tick(.2); // Let the rear-only pass prune the previous avatar while its source hierarchy is still attached.
  assert.equal(firstAvatar.children.filter(node=>node.userData?.shattercaskRearOverlay).length,0,
    'previous avatar loses its rear overlay even while its original portrait still exists in the body');
  assert.equal(portrait.material[1].visible,true,'old avatar back material is restored after a canonical avatar swap');
  assert.equal(nextAvatar.children.filter(node=>node.userData?.shattercaskRearOverlay).length,1,
    'only the canonical new avatar owns an x-ray overlay');
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.portraitAttached,true);
  const newRigPlane=new SkinnedMesh(null,[
    new MeshBasicMaterial({name:'npc_avatar_skinned_front_material'}),
    new MeshBasicMaterial({name:'npc_avatar_skinned_back_material'})]); // A later head/skin rebuild may replace the skinned mesh without replacing its avatar root.
  nextAvatar.add(newRigPlane);
  nextAvatar.userData.neckRig.skinnedPlane=newRigPlane;
  window.Shattercasks.tick(.02);
  assert.equal(nextPortrait.parent,nextAvatar,'previous skinned plane is still in the active avatar hierarchy');
  assert.equal(charge.group.parent,newRigPlane,'live rig metadata overrides the cached portrait mesh during in-place rebuild');
  window.Shattercasks.tick(.2); // Same-root skinned replacement should also clean up stale material and overlay state.
  assert.equal(nextAvatar.children.filter(node=>node.userData?.shattercaskRearOverlay).length,1,
    'same-avatar skinned rebuild does not create a duplicate rear pass');
  assert.equal(nextPortrait.material[1].visible,true,
    'replaced skinned plane restores its native rear material while it remains in the active avatar group');
  currentBodyRoot=new Group();currentBodyRoot.name='player_rebuilt_body_root';
  activeAvatar=new Group();activeAvatar.name='loading_player_avatar';currentBodyRoot.add(activeAvatar);
  window.Shattercasks.tick(.02);
  assert.equal(charge.group.parent,currentBodyRoot,'missing portrait temporarily falls back to the rebuilt character root');
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.rootFallback,true);
  const rigidPortrait=new Group();rigidPortrait.name='npc_avatar_front_plane';rigidPortrait.isMesh=true; // Rebuilt legacy avatar lacks the skinned plane.
  rigidPortrait.position.set(0,.14,.02);
  rigidPortrait.renderOrder=2;
  rigidPortrait.material=new MeshBasicMaterial({depthTest:true,depthWrite:true,transparent:true}); // Native rigid front face must obscure the stowed geometry.
  activeAvatar.add(rigidPortrait);
  const rigidBack=new Group();rigidBack.name='npc_avatar_back_plane';rigidBack.isMesh=true; // Separate legacy back face has independent depth state.
  rigidBack.renderOrder=2;
  rigidBack.material=new MeshBasicMaterial({depthTest:true,depthWrite:true,transparent:true});
  activeAvatar.add(rigidBack);
  window.Shattercasks.tick(.02);
  assert.equal(charge.group.parent,rigidPortrait,'late-loaded rigid portrait replaces the root fallback automatically');
  assert.equal(window.Shattercasks.debugSnapshot().backCarryMount.portraitAttached,true);
  const second=window.Shattercasks.registerBurden({mapId:currentArea,scene,group:new Group(),
    id:'test-hand-burden',kind:'inertStatue',hanging:false,data:{carryable:{}}});
  const secondPart={renderOrder:0,material:new MeshBasicMaterial({transparent:false,depthTest:true,depthWrite:true})}; // Checks that held and stowed materials remain independently classified.
  second.meshColliders=[secondPart];
  assert(window.Shattercasks.pickUp(second),'hands can still carry a different burden while the back is occupied');
  assert.equal(chargePart.renderOrder,2.15,'picking up a second burden does not remove the back object x-ray');
  assert.equal(chargePart.material.transparent,true,'the back object keeps the transparent PNG queue while hands are occupied');
  assert.equal(secondPart.renderOrder,1.4,'the additional hand burden keeps its ordinary held-order layer');
  assert.equal(secondPart.material.transparent,false,'hand burden does not inherit the back object blend mode');
  assert.equal(rigidBack.renderOrder,2.05,'rigid rear plane precedes the stowed burden even with another item held');
  assert.equal(rigidBack.material.depthWrite,false,'rigid rear PNG does not block the stowed burden depth');
  assert.equal(rigidPortrait.renderOrder,2.25,'rigid front PNG follows the stowed burden and remains opaque to it');
  assert.equal(rigidPortrait.material.depthWrite,true,'rigid front PNG retains its occluding depth');
  assert(!window.Shattercasks.stowOnBack(),'a second held burden cannot overwrite the occupied back slot');
  assert.equal(window.Shattercasks.backCarriedInfo()?.id,charge.id,'the first back burden remains untouched');
  assert(window.Shattercasks.discardBurden(second),'clear the extra hand burden before retrieving from back');
  assert.equal(secondPart.renderOrder,0,'discard restores the second Burden original render order');
  assert.equal(secondPart.material.depthWrite,true,'discard restores the second Burden depth writing');
  assert(window.Shattercasks.takeFromBack(),'tool-arch selection retrieves the same instance');
  assert.equal(rigidBack.renderOrder,2,'retrieving from the back restores the native rigid rear order');
  assert.equal(rigidBack.material.depthWrite,true,'retrieving from the back restores rear PNG depth writing');
  assert.equal(rigidPortrait.renderOrder,2,'retrieving from the back restores the native rigid front order');
  assert.equal(window.Shattercasks.debugSnapshot().held,charge.id);
  assert(originalTarget.hitbox(),'retrieval restores the held burden own hitbox, separate from stowed carrier hits');
  assert.equal(charge.group.parent,headJoint,'retrieval restores the ORIGINAL held-object mount');
  assert.equal(chargePart.renderOrder,1.4,'retrieved furniture returns to the existing held-order layer');
  assert.equal(chargePart.material.transparent,false,'retrieval restores the authored opaque material');
  assert.equal(chargePart.material.depthWrite,false,'hand-held furniture retains the established rear-PNG behavior');
  assert.equal(decal.renderOrder,0,'the authored decal regains its native drawing order when retrieved into the hands');
  assert.equal(lateDetail.renderOrder,0,'late-loaded decorative geometry regains its authored drawing order on retrieval');
  assert.equal(lateDetail.material.depthWrite,true,'late-loaded decorative geometry regains its original depth mode');
  assert(window.Shattercasks.stowOnBack());
  assert.equal(charge.group.parent,rigidPortrait,'restowing reattaches directly to the rebuilt portrait');
  player.health-=10; // Affliction damage alone must never trigger a back-mounted collision.
  window.Shattercasks.tick(.02);
  assert.equal(causes.length,0,'health loss without a physical hit does not detonate the burden');
  player.lastAttackReceivedAt+=500; // Same marker written by ResourceSystem.applyDamage on real impacts.
  window.Shattercasks.tick(.02);
  assert.equal(causes.length,1,'a direct impact triggers even if enhanced Health absorbs damage');
  assert.equal(causes[0],'carrier-direct-hit');
  assert.equal(chargePart.renderOrder,0,'explosion restores the stowed Burden original order');
  assert.equal(chargePart.material.transparent,false,'explosion restores the stowed Burden original material mode');
  assert.equal(chargePart.material.depthWrite,true,'explosion restores the stowed Burden original depth state');
  assert.equal(decal.renderOrder,0,'explosion restores the decal original drawing order');
  assert.equal(lateDetail.renderOrder,0,'explosion restores asynchronously loaded details');
  assert.equal(window.Shattercasks.backCarriedInfo(),null,'hit-triggered explosion clears the back slot');
  assert.equal(window.Shattercasks.getBurden(charge.id),null,'the original physical item is consumed');

  // A carried shattercask moving between rooms must never replace a static
  // shattercask with the same area-local ID, or respawn at its original source.
  const travel=window.Shattercasks.registerBurden({mapId:currentArea,scene,group:new Group(),
    id:'same-room-local-id',kind:'shattercask',hanging:false,data:{carryable:{}}});
  assert(window.Shattercasks.pickUp(travel));
  assert(window.Shattercasks.stowOnBack());
  assert.equal(travel.group.parent,rigidPortrait,'default back stow mounts to the available rigid portrait');
  for(const axis of ['x','y','z'])assert(Math.abs(travel.group.position[axis])<1e-8,
    'a burden without authored back coordinates defaults to the exact portrait center on '+axis);
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
