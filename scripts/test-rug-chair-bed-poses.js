'use strict';
// Regression: run with node scripts/test-rug-chair-bed-poses.js
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
const furniture=p=>JSON.parse(read('docs/config/furniture-authored/'+p+'.json'));
class V {
 constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
 set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
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
registry.registerPlacement('bedroom',{id:'bed',key:'doubleBed',col:3,row:5},root(4,0,6),{fw:2,fd:2});
const left=registry.lieTransform('bedroom',{pose:'lie',c:3,r:5});
const right=registry.lieTransform('bedroom',{pose:'lie',c:4,r:5});
assert(left&&right&&left.y>.4&&right.x>left.x);
vm.runInNewContext(read('docs/js/bed-lie-pose.js'),ctx);
W.BedLiePose.init({THREE:W.THREE,player:()=>({}),playerRoot:()=>({}),tileSize:()=>32,area:()=>'interior'});
const material={clone(){return{depthTest:true,depthWrite:true,dispose(){}};}};
const skin={material:[material,{}],renderOrder:2};
const rig={isObject3D:true,position:new V,quaternion:new Q,scale:{x:2,y:2,z:2},
 parent:{updateWorldMatrix(){},worldToLocal(v){return v.sub(npc.root.position);}}}; // Scaled anatomical rig and actual bed-parent frame.
const npc={rec:{id:'npc-test'},animalDef:null,area:'interior',
 root:{isObject3D:true,position:new V(3.5,0,5.5),rotation:{y:0}},
 _npcCharacterRigRoot:rig,avatarGroup:{userData:{neckRig:{skinnedPlane:skin}}},
 legs:{standingPosteriorY:.34},avatarHeight:.9};
for(let i=0;i<20;i++)W.BedLiePose.syncNpc(npc,{pose:'lie'},.1,{x:3.5,z:5.5,y:.58,facingRad:0}); // Spouse activity targets may omit area even while correctly scheduled in this room.
assert(npc._bedLieActive&&Math.abs(rig.quaternion.euler.x+Math.PI/2)<1e-5);
const hip=new V(0,npc.legs.standingPosteriorY,0).multiply(rig.scale).applyQuaternion(rig.quaternion); // Actual world-space hip after rig scale and bed rotation.
assert(Math.abs(rig.position.y+hip.y-.615)<.001,'scaled NPC hip rests on authored mattress top');
assert.notEqual(skin.material[0],material);
for(let i=0;i<20;i++)W.BedLiePose.syncNpc(npc,{pose:'stand',area:'interior'},.1,null);
assert(!npc._bedLieActive&&skin.material[0]===material&&skin.renderOrder===2);
assert.equal(rig.position.y,0);
new Function(read('docs/game.js'));
assert(read('docs/game.js').includes('window.BedLiePose?.syncNpc?.'));
console.log('Rug stacking, chair depth, NPC double bed, lie-down, x-ray, and wake restore passed.');
