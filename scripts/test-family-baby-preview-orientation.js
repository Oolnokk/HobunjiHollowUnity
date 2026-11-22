#!/usr/bin/env node
'use strict';
// Regression: gameplay's inverse anchor must rotate the CHILD, not its fixed adult preview.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('docs/tools/furniture-avatar-author/carryable-objects.js','utf8');
const html=fs.readFileSync('docs/tools/furniture-avatar-author/index.html','utf8');
const start=source.indexOf('  function babyPoseIsBack() {'),end=source.indexOf('  function frameHoldingPreview(){',start);
assert(start>=0&&end>start,'the runtime baby preview solver is separately testable');
const portion=source.slice(start,end);
assert.match(source,/id="carryBabyRotate">Rotate Baby<\/button>/,'baby orientation is a mobile button');
assert.match(source,/babyPoseFrame\.add\(babyReference\)/,'baby portrait is parented to gameplay-space pose');
assert.match(source,/babyPoseFrame\.add\(guideRoot\)/,'grip markers share the exact baby-local frame');
assert.match(source,/el\('carryBabyRotate'\)\.onclick=\(\)=>select\('baby'\)/,'Rotate Baby is actually wired');
assert.match(source,/if\(id==='baby'\)setTransformMode\('rotate'\)/,'direct manipulation uses rotation mode');
assert.match(source,/babyPoseFrame\.position\.copy\(babyMountWorld\)\.sub\(babyAnchorWorld\)/,'baby group follows gameplay posterior mount');
assert.match(source,/if\(editingBaby\)q\.premultiply\(babyPoseFrame\.quaternion\)/,'preview hands rotate with child pose');
assert.match(source,/if\(id==='baby'\)\{[\s\S]*?authorBabyRotation\(babyRotateProxy\.quaternion\)/,
  'gizmo sends rotation into existing gameplay anchors, without separate baby rotation data');
assert.match(source,/editingBaby=true;root\.visible=false;babyReference\.visible=activeEditorMode==='carry';[\s\S]*?select\('baby'\)/,
  'opening baby editor selects the infant itself');
assert.match(html,/carryable-objects\.js\?v=[^"']+/,'editor includes a cache-busted carryable module');

const near=(a,b,epsilon=1e-5)=>Math.abs(a-b)<epsilon;
class Euler{
  constructor(x=0,y=0,z=0,order='XYZ'){this.set(x,y,z,order);}
  set(x,y,z,order='XYZ'){Object.assign(this,{x,y,z,order});return this;}
  setFromQuaternion(q,order='XYZ'){
    assert.equal(order,'XYZ');
    const {x,y,z,w}=q;
    const m11=1-2*(y*y+z*z),m12=2*(x*y-z*w),m13=2*(x*z+y*w),
      m22=1-2*(x*x+z*z),m23=2*(y*z-x*w),m32=2*(y*z+x*w),m33=1-2*(x*x+y*y);
    this.y=Math.asin(Math.max(-1,Math.min(1,m13)));
    if(Math.abs(m13)<.9999999){this.x=Math.atan2(-m23,m33);this.z=Math.atan2(-m12,m11);}
    else{this.x=Math.atan2(m32,m22);this.z=0;}
    this.order=order;return this;
  }
}
class Quaternion{
  constructor(x=0,y=0,z=0,w=1){Object.assign(this,{x,y,z,w});}
  setFromEuler(e){
    const c1=Math.cos(e.x/2),c2=Math.cos(e.y/2),c3=Math.cos(e.z/2),
      s1=Math.sin(e.x/2),s2=Math.sin(e.y/2),s3=Math.sin(e.z/2);
    this.x=s1*c2*c3+c1*s2*s3;
    this.y=c1*s2*c3-s1*c2*s3;
    this.z=c1*c2*s3+s1*s2*c3;
    this.w=c1*c2*c3-s1*s2*s3;return this;
  }
  copy(q){Object.assign(this,{x:q.x,y:q.y,z:q.z,w:q.w});return this;}
  identity(){Object.assign(this,{x:0,y:0,z:0,w:1});return this;}
  invert(){this.x=-this.x;this.y=-this.y;this.z=-this.z;return this;}
  multiply(q){
    const a=this,b=q,x=a.x,y=a.y,z=a.z,w=a.w;
    return Object.assign(this,{x:x*b.w+w*b.x+y*b.z-z*b.y,
      y:y*b.w+w*b.y+z*b.x-x*b.z,z:z*b.w+w*b.z+x*b.y-y*b.x,
      w:w*b.w-x*b.x-y*b.y-z*b.z});
  }
  premultiply(q){return this.copy(new Quaternion().copy(q).multiply(this));}
  toArray(){return [this.x,this.y,this.z,this.w];}
}
class Vector3{
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  multiplyScalar(v){this.x*=v;this.y*=v;this.z*=v;return this;}
  applyQuaternion(q){
    const v=new Quaternion(this.x,this.y,this.z,0);
    const rot=new Quaternion().copy(q).multiply(v).multiply(new Quaternion().copy(q).invert());
    return this.set(rot.x,rot.y,rot.z);
  }
  toArray(){return [this.x,this.y,this.z];}
}
const T={Euler,Quaternion,Vector3};
const vec=()=>new Vector3(),quat=()=>new Quaternion();
const pose=()=>({
  position:vec(),quaternion:quat(),scale:{x:1,setScalar(v){this.x=v;}},
  updateWorldMatrix(){},
  localToWorld(point){return point.multiplyScalar(this.scale.x).applyQuaternion(this.quaternion).add(this.position);},
});
const previewActor=pose(),babyPoseFrame=pose(),babyRotateProxy=pose();
const previewPosterior=new Vector3(.07,.43,-.04);
const state={selectedType:'carry',selectedId:'baby',carryable:{
  billboardAnchor:{position:{x:.05,y:.017,z:-.14},rotation:{x:0,y:55,z:-20},size:1.25,
    posteriorOffset:{x:.015,y:.025,z:.03}},
  backCarry:{position:{x:.02,y:.04,z:-.14},rotation:{x:0,y:180,z:0},size:.8,
    posteriorOffset:{x:-.02,y:.03,z:0},portraitAnchor:{x:.03,y:-.015,z:.04}},
  handTargets:{
    left:{x:-.11,y:.18,z:.04,rotation:{x:0,y:0,z:0}},
    right:{x:.11,y:.17,z:.04,rotation:{x:0,y:0,z:0}},
  },
}};
const previewPositions=[],visible=[],logged=[];
const previewHands={
  setSideVisible(side,show){visible.push([side,show]);},
  placeHandWorld(side,point,rotation){previewPositions.push({side,position:point.toArray(),quat:rotation.toArray()});},
};
const root=pose();
const window={ProceduralHandAttachments:{modelCalibrationForSpecies:()=>null}};
const flags={editingBaby:true,previewEnabled:true,activeEditorMode:'carry',transformDragging:false};
const make=new Function('THREE','ctx',`
  const {state,previewActor,babyPoseFrame,babyRotateProxy,previewPosterior,previewHands,root,window,flags,logged}=ctx;
  const DEG=Math.PI/180;
  const tempRotation=new THREE.Quaternion(),tempOffset=new THREE.Vector3();
  const babyMountWorld=new THREE.Vector3(),babyAnchorWorld=new THREE.Vector3();
  const babyEulerScratch=new THREE.Euler(0,0,0,'XYZ'),babyRotationScratch=new THREE.Quaternion();
  const handLocalEuler=new THREE.Euler(),handLocalQuat=new THREE.Quaternion();
  const handTurn={left:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,Math.PI/2,0)),
    right:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-Math.PI/2,0))};
  const heldPreview={visible:false},status=s=>logged.push(s),previewActive=()=>flags.previewEnabled&&flags.activeEditorMode==='carry';
  const posteriorMarker={position:new THREE.Vector3()},attachmentMarker={position:new THREE.Vector3()};
  const attachmentLine={geometry:{setFromPoints:()=>{}}};
  let modelH=.9,babyPoseView='anchor';
  let editingBaby=true,transformDragging=false;
  ${portion}
  return {syncHoldingPreview,babyOrientation,authorBabyRotation,babyPoseIsBack,heldPreview,
    setEdit(value){editingBaby=value;},setView(value){babyPoseView=value;},setDragging(value){transformDragging=value;}};
`)(T,{state,previewActor,babyPoseFrame,babyRotateProxy,previewPosterior,previewHands,root,window,flags,logged});

function closeVec(actual,expected,label){
  for(const axis of ['x','y','z'])assert(near(actual[axis],expected[axis],1e-4),label+' '+axis+': '+actual[axis]+' vs '+expected[axis]);
}
function sameRotation(actual,expected,label){
  const dot=Math.abs(actual.x*expected.x+actual.y*expected.y+actual.z*expected.z+actual.w*expected.w);
  assert(near(dot,1,1e-5),label+': quaternion dot='+dot);
}
// Held pose: physically position and rotate baby while adult stays put.
make.syncHoldingPreview();
closeVec(previewActor.position,new Vector3(), 'held adult remains at local origin');
sameRotation(previewActor.quaternion,new Quaternion(),'held adult has identity orientation');
const held=state.carryable.billboardAnchor;
sameRotation(babyPoseFrame.quaternion,new Quaternion().setFromEuler(new Euler(0,55*Math.PI/180,-20*Math.PI/180)).invert(),
  'actual baby rotation is the inverse authored mount');
assert(near(babyPoseFrame.scale.x,1/held.size),'baby scale matches gameplay inverse size');
const heldMount=babyPoseFrame.localToWorld(new Vector3(held.position.x,held.position.y,held.position.z));
closeVec(heldMount,new Vector3(previewPosterior.x+.015,previewPosterior.y+.025,previewPosterior.z+.03),
  'baby anchor stays on adult posterior + offset');
assert.equal(previewPositions.length,2,'the infant hand guides drive both preview hands');
const expectedLeft=babyPoseFrame.localToWorld(new Vector3(...['x','y','z'].map(a=>state.carryable.handTargets.left[a])));
assert(previewPositions.some(item=>item.side==='left'&&item.position.every((v,i)=>near(v,expectedLeft.toArray()[i]))),
  'hand follows physical baby-local coordinate frame');

// Direct authored baby quaternion round-trips into gameplay's inverse anchor and back.
const desired=new Quaternion().setFromEuler(new Euler(.23,-.4,.51));
make.authorBabyRotation(desired);
make.syncHoldingPreview();
sameRotation(babyPoseFrame.quaternion,desired,'direct baby gizmo round trips to actual gameplay pose');
closeVec(babyPoseFrame.localToWorld(new Vector3(held.position.x,held.position.y,held.position.z)),
  new Vector3(previewPosterior.x+.015,previewPosterior.y+.025,previewPosterior.z+.03),
  'rotation preserves handoff mount position');
assert.equal(babyRotateProxy.position.y,previewPosterior.y+.025,'gizmo pivot remains on posterior offset');

// Back pose uses back-only fine offsets; held pose must not change.
const heldSaved=JSON.stringify(state.carryable.billboardAnchor.rotation);
state.selectedId='back';make.setView('back');previewPositions.length=0;visible.length=0;
make.syncHoldingPreview();
assert.equal(make.babyPoseIsBack(),true);
assert.equal(previewPositions.length,0,'back carried baby hides front-hand grasp targets');
assert(visible.some(item=>item[1]===false),'back-carry mode hides hand GLBs');
const back=state.carryable.backCarry;
closeVec(babyPoseFrame.localToWorld(new Vector3(back.position.x,back.position.y,back.position.z)),
  new Vector3(previewPosterior.x-.02+.03,previewPosterior.y+.03-.015,previewPosterior.z+.04),
  'back pose uses both offset and portraitAnchor just like gameplay');
state.selectedId='baby';make.authorBabyRotation(new Quaternion().setFromEuler(new Euler(-.35,.8,.15)));
assert.equal(JSON.stringify(state.carryable.billboardAnchor.rotation),heldSaved,'back rotation does not change held orientation');

// Furniture mode must preserve the legacy preview where the object stays still.
make.setEdit(false);state.selectedId='anchor';
const beforePosition=new Vector3(...[held.position.x,held.position.y,held.position.z])
  .sub(new Vector3(previewPosterior.x+.015,previewPosterior.y+.025,previewPosterior.z+.03)
    .multiplyScalar(held.size)
    .applyQuaternion(new Quaternion().setFromEuler(new Euler(held.rotation.x*Math.PI/180,
      held.rotation.y*Math.PI/180,held.rotation.z*Math.PI/180))));
make.syncHoldingPreview();
closeVec(babyPoseFrame.position,new Vector3(),'non-baby editing restores identity guide frame');
closeVec(previewActor.position,beforePosition,'furniture editing retains original adult around stationary furniture');
assert(near(previewActor.scale.x,held.size),'furniture held preview retains scale');
console.log('PASS inverse gameplay baby rotation, stationary adult, mount pivot, hands, back pose and furniture mode');
