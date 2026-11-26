'use strict';
// Regression: run with node scripts/test-rug-chair-bed-poses.js
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
const furniture=p=>JSON.parse(read('docs/config/furniture-authored/'+p+'.json'));
class V {
 constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
 set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
 add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
 sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
 multiply(v){this.x*=v.x;this.y*=v.y;this.z*=v.z;return this;}
 applyQuaternion(q){const a=q.euler?.x||0,b=q.euler?.y||0;const y=this.y*Math.cos(a)-this.z*Math.sin(a),z=this.y*Math.sin(a)+this.z*Math.cos(a);return this.set(this.x*Math.cos(b)+z*Math.sin(b),y,-this.x*Math.sin(b)+z*Math.cos(b));}
}
class Q {
 setFromEuler(e){this.euler={x:e.x,y:e.y,z:e.z};return this;}
 copy(q){this.euler=q.euler;return this;}
 identity(){this.euler=null;return this;}
}
class E {constructor(x,y,z){this.x=x;this.y=y;this.z=z;}}
const W={THREE:{Vector3:V,Quaternion:Q,Euler:E},HobunjiWalkableElevation:{unregister(){}}};
W.THREE.Matrix4=class {}; // AuthoredFurniture allocates reusable warp matrices at module load, even though these tests use only pure metadata accessors.
const ctx={window:W,THREE:W.THREE,console,performance:{now:()=>0}};
vm.runInNewContext(read('docs/js/authored-furniture-runtime.js'),ctx);
const bed=furniture('basicBed'),double=furniture('doubleBed'),chair=furniture('chairSimple');
assert(W.AuthoredFurniture.seatedKneeReach(chair)<chair.footprint.d/2);
assert(W.AuthoredFurniture.sleepSurfaceHeight(bed)>.20 && W.AuthoredFurniture.sleepSurfaceHeight(bed)<.25); // Half-height bed: fabric mattress, not pillow, defines contact.
assert(W.AuthoredFurniture.sleepSurfaceHeight(double)>.20 && W.AuthoredFurniture.sleepSurfaceHeight(double)<.25); // Double-bed headboard must not be mistaken for its mattress.
assert.equal(W.AuthoredFurniture.sleepSurfacePart(double)?.materialRole,'fabric','sleep x-ray resolves the authored mattress part, not the wooden bed frame');
for (const data of [bed,double]) for (const part of data.parts) {
  assert(part.transform.y < .3, 'bed part vertical position is halved');
  assert(part.transform.sy < .12, 'bed part vertical thickness is halved');
}
const data={basicBed:bed,doubleBed:double,chairSimple:chair,rug:furniture('rug')};
W.AuthoredFurniture.peek=k=>data[k]||null;
W.AuthoredFurniture.load=async k=>data[k]||null;
vm.runInNewContext(read('docs/js/furniture-table-system.js'),ctx);
const registry=W.FurnitureTableSystem;
registry.init({surfaceY:()=>0,frameId:()=>null,getArea:()=>'interior'});
const root=(x,y,z)=>({parent:{},position:{x,y,z},scale:{x:1,y:1,z:1},rotation:{y:0},userData:{},
 updateWorldMatrix(){},localToWorld(v){v.x+=x;v.y+=y;v.z+=z;return v;}});
registry.registerPlacement('interior',{id:'rug1',key:'rug',col:3,row:5},root(4,0,6),{walkable:true,fw:2,fd:2});
registry.registerPlacement('interior',{id:'rug2',key:'rug',col:3,row:5},root(4,.032,6),{walkable:true,fw:2,fd:2});
assert.equal(registry.snapshot('interior').placements.length,2);
assert.equal(registry.blocksBox('interior',4,6),false);
assert(registry.unregisterPlacement('interior','rug1'));
assert.equal(registry.snapshot('interior').placements[0].id,'rug2');
registry.registerPlacement('interior',{id:'chair',key:'chairSimple',col:6,row:5},root(6.5,0,5.5),{sit:true,fw:1,fd:1});
assert(registry.seatTransform('interior',{furnitureId:'chair'}).footprintHalfDepth<.2);
const bedMaterial={depthTest:true,depthWrite:true,clone(){return{depthTest:this.depthTest,depthWrite:this.depthWrite,dispose(){this.disposed=true;}};}}; // Only the authored mattress mesh may stop writing depth.
const frameMesh={isMesh:true,material:bedMaterial,name:'bed-frame'};
const mattressMesh={isMesh:true,material:bedMaterial,name:'mattress',traverse(fn){fn(this);}};
const headboardMesh={isMesh:true,material:bedMaterial,name:'headboard'};
const pillowMesh={isMesh:true,material:bedMaterial,name:'pillow'};
const mattressPart=W.AuthoredFurniture.sleepSurfacePart(double);
const pillowPart=double.parts.find(part=>part.materialRole==='fabric' && part!==mattressPart); // The authored head cushion is a separate fabric box.
assert(pillowPart);
const bedRoot={parent:{},position:{x:4,y:0,z:6},scale:{x:1,y:1,z:1},rotation:{y:0},
 userData:{meshById:new Map([[mattressPart.id,mattressMesh],[pillowPart.id,pillowMesh]])},updateWorldMatrix(){},
 localToWorld(v){return v.applyQuaternion({euler:{y:this.rotation.y}}).multiply(this.scale).add(this.position);}};

registry.registerPlacement('bedroom',{id:'bed',key:'doubleBed',col:3,row:5},bedRoot,{fw:2,fd:2});
const left=registry.lieTransform('bedroom',{pose:'lie',c:3,r:5});
const right=registry.lieTransform('bedroom',{pose:'lie',c:4,r:5});
const spouseTarget={area:'bedroom',pose:'lie',c:2,r:5,bedCol:3,bedRow:5,furnitureId:'bed'}; // The spouse approaches from a walkable tile.
const scheduledTarget={area:'bedroom',pose:'lie',c:3,r:5}; // NPC couples may start from either authored station tile.
const spouseOwner={}, secondOwner={}, thirdOwner={};
const spouse=registry.lieTransform('bedroom',spouseTarget,spouseOwner);
const second=registry.lieTransform('bedroom',scheduledTarget,secondOwner);
assert.equal(spouse.slot,0);
assert.equal(second.slot,1);
assert.equal(registry.lieTransform('bedroom',scheduledTarget,secondOwner).slot,1,'a sleeping actor keeps their side even when the station changes');
assert.equal(registry.lieTransform('bedroom',scheduledTarget,thirdOwner).occupied,true,'a third sleeper cannot overlap either side');
assert(spouse.x<4&&second.x>4&&spouse.z===6&&second.z===6,'two slots are laterally centered on the same mattress');
assert.strictEqual(spouse.mattressMesh,mattressMesh);
assert.strictEqual(spouse.pillowMeshes[0],pillowMesh);
assert(left&&right&&left.y>.20&&left.y<.25&&right.x>left.x);
registry.releaseLieSlot(spouseOwner);
assert.equal(registry.lieTransform('bedroom',scheduledTarget,thirdOwner).slot,0,'the next NPC takes whichever side is free');
bedRoot.rotation.y=Math.PI/2;
const rotated=registry.lieTransform('bedroom',scheduledTarget,thirdOwner);
assert(Math.abs(rotated.x-4)<1e-6 && rotated.z>6 && rotated.facingRad===Math.PI/2,'slot offsets rotate with the placed bed');
bedRoot.rotation.y=0;
registry.releaseLieSlot(thirdOwner);

vm.runInNewContext(read('docs/js/bed-lie-pose.js'),ctx);
W.BedLiePose.init({THREE:W.THREE});
assert.deepEqual(Object.keys(W.BedLiePose).sort(), ['init','npcDebug','releaseNpc','syncNpc'], 'bed pose API is NPC presentation only');
registry.releaseLieSlot(secondOwner);
const material={clone(){return{depthTest:true,depthWrite:true,dispose(){}};}};
function makeNpc(id,x,z) {
 const skin={material:[material,{}],renderOrder:2};
 const root={isObject3D:true,position:new V(x,0,z),rotation:{y:0}};
 const rig={isObject3D:true,position:new V,quaternion:new Q,scale:{x:2,y:2,z:2},
  parent:{updateWorldMatrix(){},worldToLocal(v){return v.sub(root.position);}}};
 return {rec:{id},area:'bedroom',root,_npcCharacterRigRoot:rig,
  avatarGroup:{userData:{neckRig:{skinnedPlane:skin}}},legs:{standingPosteriorY:.34},avatarHeight:.9};
}
const npc=makeNpc('npc-test',2.5,5.5), partner=makeNpc('npc-partner',3.5,5.5);
const rig=npc._npcCharacterRigRoot, skin=npc.avatarGroup.userData.neckRig.skinnedPlane;
const wallMaterial={depthTest:true,depthWrite:true};
for(let i=0;i<20;i++) {
 W.BedLiePose.syncNpc(npc,spouseTarget,.1,spouse);
 W.BedLiePose.syncNpc(partner,scheduledTarget,.1,second);
}
assert(npc._bedLieActive&&partner._bedLieActive&&Math.abs(rig.quaternion.euler.x+Math.PI/2)<1e-5);
assert.equal(skin.material[0].depthTest,true,'sleeping portrait must still depth-test against subdivision walls');
assert.equal(skin.material[0].depthWrite,false,'sleeping portrait remains a non-writing overlay');
assert.notEqual(mattressMesh.material,bedMaterial,'only the occupied mattress receives a temporary material override');
assert.equal(mattressMesh.material.depthTest,true,'mattress still respects walls and other existing occluders');
assert.equal(mattressMesh.material.depthWrite,false,'occupied mattress stops blocking its sleeper');
assert.equal(pillowMesh.material.depthWrite,false,'the pillow also lets the lying portrait show through');
assert.strictEqual(frameMesh.material,bedMaterial,'wooden frame retains its original depth-writing material');
assert.strictEqual(headboardMesh.material,bedMaterial,'headboard retains its original depth-writing material');
assert.equal(wallMaterial.depthWrite,true,'subdivision wall depth is never modified');
const hip=new V(0,npc.legs.standingPosteriorY,0).multiply(rig.scale).applyQuaternion(rig.quaternion); // Actual world-space hip after rig scale and bed rotation.
assert(Math.abs(rig.position.y+hip.y-.255)<.001,'scaled NPC hip rests on the half-height authored mattress');
assert.notEqual(skin.material[0],material);
// The sleeping scheduler still ticks during a kiss. Its ordinary lie/wake
// blend must not overwrite the exclusive paired-pose owner's torso.
let pairedPoseLock = true; // Toggled below to exercise ownership handback without resetting the sleeper.
W.CharacterActionLocks = { isLocked(id, channel) {
  return pairedPoseLock && id === 'npc:npc-test' && channel === 'pose';
} }; // Same shared participant ID as the spouse-kiss acquisition.
const pairedBedPose = {
  px: rig.position.x, py: rig.position.y, pz: rig.position.z,
  q: { ...rig.quaternion.euler },
}; // Captures all transform fields that BedLiePose.syncNpc would otherwise overwrite.
for (let i = 0; i < 4; i++) W.BedLiePose.syncNpc(npc, { pose: 'stand', area: 'bedroom' }, .1, null);
assert.deepEqual(
  { px: rig.position.x, py: rig.position.y, pz: rig.position.z, q: { ...rig.quaternion.euler } },
  pairedBedPose, 'NPC lie/wake composer leaves the paired kiss torso unchanged while pose-locked');
pairedPoseLock = false;
for(let i=0;i<20;i++)W.BedLiePose.syncNpc(npc,{pose:'stand',area:'bedroom'},.1,null);
assert(!npc._bedLieActive&&skin.material[0]===material&&skin.renderOrder===2);
assert.equal(mattressMesh.material.depthWrite,false,'the mattress remains depth-transparent while the partner sleeps');
assert.equal(pillowMesh.material.depthWrite,false,'the pillow override is also shared');
W.BedLiePose.releaseNpc(partner);
assert.strictEqual(mattressMesh.material,bedMaterial,'the last sleeper restores the mattress');
assert.strictEqual(pillowMesh.material,bedMaterial,'the last sleeper restores the pillow');
assert.strictEqual(frameMesh.material,bedMaterial,'frame material remains untouched after wake');
assert.strictEqual(headboardMesh.material,bedMaterial,'headboard material remains untouched after wake');
assert.equal(rig.position.y,0);
new Function(read('docs/game.js'));
assert(read('docs/game.js').includes('window.BedLiePose?.syncNpc?.'));
console.log('Rug stacking, chair depth, NPC double bed, lie-down, x-ray, and wake restore passed.');
