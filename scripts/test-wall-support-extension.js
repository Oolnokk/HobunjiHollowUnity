// node scripts/test-wall-support-extension.js
// Ensure authored signs and banners move outward while the correct END of
// their support beam stays fixed at the wall. No panel/fabric deformation.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const w={};vm.runInNewContext(read('docs/js/house-wall-fixtures.js'),{window:w});
const api=w.HouseWallFixtures;
const sign=JSON.parse(read('docs/config/furniture-authored/generalStoreSign.json'));
const inn=JSON.parse(read('docs/config/furniture-authored/innSign.json'));
const store=JSON.parse(read('docs/config/pieces/general-store.json'));
const eps=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-7, `${message}: ${a} != ${b}`);

function makeModel(data){
  const meshById=new Map(data.parts.map(part=>[part.id,{
    position:{x:part.transform.x||0,y:part.transform.y||0,z:part.transform.z||0},
    scale:{x:1,y:1,z:1},
    userData:{authoredPartId:part.id},
    updateMatrix() {}
  }]));
  return {userData:{meshById},traverse() {}};
}
const generalFixture=store.wallFixtures.find(f=>f.authoredFurnitureKey==='generalStoreSign');
assert.ok(generalFixture);
assert.equal(generalFixture.depth,0);
eps(generalFixture.bodyOutset,.383147429,'preserved original outward reach');

for(const [label,data,scale,side,axis,normal] of [
  ['General Store sign',sign,[.393,.563,.557],1,'x',[1,0,0]],
  ['Inn sign',inn,[.8,.8,.8],1,'x',[1,0,0]]
]){
  const support=data.wallOrnament.extendableSupport;
  assert.equal(support.axis,axis);
  assert.equal(support.anchorEnd,'positive');
  const fixture={authoredAttachmentNormal:normal,authoredScale:scale};
  const model=makeModel(data);
  const beam=model.userData.meshById.get(support.partId);
  const board=model.userData.meshById.get('hanging_sign_board');
  const boardPosition={...board.position},boardScale={...board.scale};
  const baselineBeam=beam.position[axis],baselineLength=data.parts.find(p=>p.id===support.partId).transform['s'+axis];
  for(const d of [0,.383147429,.75,2.5,6,.125,0]){
    fixture.bodyOutset=d;
    assert.ok(api.extendAuthoredSupport(model,data,fixture,scale),label+' support extends');
    eps(beam.scale[axis],1+d/scale[0]/baselineLength,label+' beam scale');
    eps(beam.position[axis],baselineBeam+side*d/(2*scale[0]),label+' beam midpoint');
    // Source +X beam end is at +.5 when body is flush. Translating the
    // furniture outward by d and lengthening toward +X must cancel exactly.
    const faceAtWall=beam.position[axis]+beam.scale[axis]*baselineLength*.5;
    eps(d-(faceAtWall-.5)*scale[0],0,label+' beam end fixed');
    assert.deepEqual(board.position,boardPosition,label+' signboard position unchanged');
    assert.deepEqual(board.scale,boardScale,label+' signboard scale unchanged');
  }
  assert.equal(data.parts.find(p=>p.id===support.partId).transform.sx,baselineLength,
    label+' authored source geometry unchanged');
}
// General-purpose banner support running down local -Z toward its wall:
// support metadata is authoritative; code must extend that end, not its fabric.
const banner={wallOrnament:{normal:[0,0,-1],extendableSupport:{
    partId:'banner_rod',axis:'z',anchorEnd:'negative',maxOutset:3}},
  parts:[{id:'banner_rod',kind:'beam',transform:{sx:.1,sy:.1,sz:1}},
    {id:'banner_fabric',kind:'banner',transform:{sx:.8,sy:1.4,sz:.01}}]};
const bannerModel=makeModel(banner);
const bannerFixture={authoredAttachmentNormal:[0,0,-1],bodyOutset:2.4};
assert.ok(api.extendAuthoredSupport(bannerModel,banner,bannerFixture,[.8,.8,.5]));
const rod=bannerModel.userData.meshById.get('banner_rod');
eps(rod.position.z,-2.4,'negative-side banner rod center');
eps(rod.scale.z,5.8,'negative-side banner rod length');
eps(2.4+(rod.position.z-rod.scale.z*.5+.5)*.5,0,'banner wall end still fixed');
assert.deepEqual(bannerModel.userData.meshById.get('banner_fabric').scale,{x:1,y:1,z:1});
const broken={...banner,wallOrnament:{...banner.wallOrnament,extendableSupport:{
  ...banner.wallOrnament.extendableSupport,anchorEnd:'positive'}}};
assert.equal(api.extendAuthoredSupport(makeModel(broken),broken,bannerFixture,[1,1,1]),false,
  'never lengthen a support away from its actual attached end');

// Map Editor / player placement use the SAME fixed-end stretch contract, but
// their mesh root can have an arbitrary nonuniform furniture scale.
const runtimeWindow={HouseWallFixtures:api,AuthoredFurniture:{
  peek:key=>key==='generalStoreSign'?sign:null,
  load:key=>Promise.resolve(key==='generalStoreSign'?sign:null)
}};
vm.runInNewContext(read('docs/js/wall-ornament-placement.js'),{window:runtimeWindow});
const placer=runtimeWindow.WallOrnamentPlacement;
assert.ok(placer,'wall-ornament bridge should expose shared beam extension');
const authoredScale=[.393,.563,.557],worldWall=[10,1.365688,5];
const placement={wallPoint:worldWall,wallNormal:[0,0,1],offsetU:0,offsetV:0,normalOffset:1.25};
const rootPose=placer.deriveTransform(sign.wallOrnament,placement,null,authoredScale);
{
  const beamAttachmentScaled=sign.wallOrnament.anchor.map((v,i)=>v*authoredScale[i]);
  const yaw=rootPose.rotY*Math.PI/180;
  const rotated=[beamAttachmentScaled[0]*Math.cos(yaw)+beamAttachmentScaled[2]*Math.sin(yaw),
    beamAttachmentScaled[1],-beamAttachmentScaled[0]*Math.sin(yaw)+beamAttachmentScaled[2]*Math.cos(yaw)];
  eps(rootPose.position[0]+rotated[0],worldWall[0],'map/personal horizontal wall alignment');
  eps(rootPose.position[1]+rotated[1],worldWall[1],'map/personal vertical wall alignment');
  eps(rootPose.position[2]+rotated[2],worldWall[2]+placement.normalOffset,'outward body shift');
}
const tooFar=placer.deriveTransform(sign.wallOrnament,
  {...placement,normalOffset:100},null,authoredScale);
const maxReach=placer.deriveTransform(sign.wallOrnament,
  {...placement,normalOffset:6},null,authoredScale);
eps(tooFar.position[2],maxReach.position[2],
  'map/player furniture cannot travel beyond finite beam reach');
assert.equal(api.normalize({authoredFurnitureKey:'innSign',bodyOutset:5,
  supportExtension:{partId:'hanging_sign_post',axis:'x',maxOutset:2}}).bodyOutset,2);
const mapModel=makeModel(sign);
mapModel.scale={x:authoredScale[0],y:authoredScale[1],z:authoredScale[2]};
assert.ok(placer.stretchWallSupport(mapModel,sign.wallOrnament,placement,'generalStoreSign'));
const mapBeam=mapModel.userData.meshById.get('hanging_sign_post');
const worldBeamEnd=rootPose.position[2]-
  (mapBeam.position.x+mapBeam.scale.x*.5)*authoredScale[0]; // +90° yaw, local +X points -Z
eps(worldBeamEnd,worldWall[2],'Map Editor beam tip stays on actual wall despite scaled body travel');


// Exercise the actual HousePieceGen-facing THREE group constructor, not only
// the pure mesh stretcher: wall anchor + sign body offset must recompose
// into the exact pre-migration General Store sign origin.
class Vec {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  fromArray(v){[this.x,this.y,this.z]=v;return this;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  clone(){return new Vec(this.x,this.y,this.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
  multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  normalize(){return this.multiplyScalar(1/(Math.hypot(this.x,this.y,this.z)||1));}
  negate(){return this.multiplyScalar(-1);}
  applyAxisAngle(a,angle){
    const c=Math.cos(angle),s=Math.sin(angle),d=this.x*a.x+this.y*a.y+this.z*a.z;
    const cross=[a.y*this.z-a.z*this.y,a.z*this.x-a.x*this.z,a.x*this.y-a.y*this.x];
    return this.set(this.x*c+cross[0]*s+a.x*d*(1-c),
      this.y*c+cross[1]*s+a.y*d*(1-c),this.z*c+cross[2]*s+a.z*d*(1-c));
  }
}
class Group {
  constructor(){this.children=[];this.userData={};this.position=new Vec();
    this.scale=new Vec(1,1,1);this.rotation={y:0};
    this.quaternion={setFromRotationMatrix(){}};}
  add(obj){this.children.push(obj);obj.parent=this;}
  clear(){this.children=[];}
  rotateZ(deg){this.localZRotation=deg;}
  traverse(fn){fn(this);this.children.forEach(child=>child.traverse?.(fn));}
}
class Mesh extends Group {
  constructor(geom,mat){super();this.geometry=geom;this.material=mat;this.isMesh=true;}
  updateMatrix(){}
}
class Material {constructor(config){this.config=config;}}
const TH={
  Vector3:Vec,Group,Mesh,Matrix4:class{makeBasis(){return this;}},
  BoxGeometry:class{constructor(...size){this.size=size;}},
  MeshLambertMaterial:Material,MeshBasicMaterial:Material,DoubleSide:2
};
const cachedAuthoredWindow={AuthoredFurniture:{
  peek:key=>key===sign.key?sign:null,
  buildGroup:data=>{
    const group=new Group();
    group.userData.meshById=new Map();
    for(const part of data.parts){
      const mesh=new Mesh(null,null);mesh.position.set(part.transform.x||0,part.transform.y||0,part.transform.z||0);
      mesh.userData.authoredPartId=part.id;group.userData.meshById.set(part.id,mesh);group.add(mesh);
    }
    return group;
  }
}};
vm.runInNewContext(read('docs/js/house-wall-fixtures.js'),{window:cachedAuthoredWindow});
const houseFixtureApi=cachedAuthoredWindow.HouseWallFixtures;
const house=houseFixtureApi.createGroup(TH,store);
assert.equal(house.children.length,1);
const mount=house.children[0],holder=mount.children[0],model=holder.children[0];
const beamAtEnd=model.userData.meshById.get('hanging_sign_post');
const endX=beamAtEnd.position.x+beamAtEnd.scale.x*.5;
const tipZ=mount.position.z+holder.position.z-endX*generalFixture.authoredScale[0];
eps(tipZ,mount.position.z,'actual House Editor scene beam tip fixed exactly at wall');
const furnitureRootZ=mount.position.z+holder.position.z;
eps(furnitureRootZ,2.287,'actual House Editor sign body stays at prior world-relative Z');
eps(mount.position.x+holder.position.x,-.043,'sign body X unchanged');
eps(mount.position.y+holder.position.y,.591,'sign body Y unchanged');

console.log('Extendable sign and banner supports: all assertions passed');
