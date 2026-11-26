// Pure collision math plus integration contracts; browser parity needs an actual avatar.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const windowStub={};
new Function('window',fs.readFileSync('docs/js/shoulder-pet-rotation-limits.js','utf8'))(windowStub);
const overlap=windowStub.ShoulderPetRotationLimits.trianglesOverlap;
const t=[0,0,0, 1,0,0, 0,1,0], ix=[0,3,6];
assert.equal(overlap(t,ix,[.2,.2,-1,.2,.2,1,.8,.2,0],ix,0),true,'intersecting cards');
assert.equal(overlap(t,ix,[2,0,0,3,0,0,2,1,0],ix,0),false,'coplanar separated cards');
assert.equal(overlap(t,ix,[.2,.2,1,.8,.2,1,.2,.8,1],ix,0),false,'parallel separated cards');
assert.equal(overlap(t,ix,[.2,.2,0,.8,.2,0,.2,.8,0],ix,0),true,'coplanar overlap');
assert.equal(overlap(t,ix,[.2,.2,.001,.8,.2,.001,.2,.8,.001],ix,.002),true,'clearance');
const runtime=fs.readFileSync('docs/js/shoulder-pet-attachment-runtime.js','utf8');
assert.match(runtime,/rotationLimits\?\.constrain/);
assert.match(runtime,/geometryConstraint/);
const game=fs.readFileSync('docs/game.js','utf8');
assert.match(game,/getOwnerPortraitMeshes: \(\) => \[_playerAvatarFrontMesh, _playerAvatarBackMesh\]/);
assert.match(game,/geometricDepth: true/);
console.log('shoulder pet geometry collision math and wiring passed');

const doc={createElement(){return {getContext(){return {drawImage(){},getImageData(x,y,w,h){return {data:new Uint8Array(w*h*4).fill(255)};}};}};}};
class V2 {set(x,y){this.x=x;this.y=y;return this;}}
class V3 {constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}applyMatrix4(){return this;}}
class Q {constructor(yaw){this.setFromAxisAngle(null,yaw);}setFromAxisAngle(axis,yaw){this.x=0;this.y=Math.sin(yaw/2);this.z=0;this.w=Math.cos(yaw/2);return this;}}
const uv={getX:i=>[0,1,0,1][i],getY:i=>[0,0,1,1][i]};
const index={count:6,getX:i=>[0,1,2,1,3,2][i]};
const map={image:{width:16,height:16},version:1,transformUv(v){return v;}};
function mesh(points, deform) {
  return {geometry:{index,getAttribute(k){return k==='uv'?uv:{count:4};}},material:{map},matrix:{},matrixWorld:{},
    updateWorldMatrix(){},updateMatrixWorld(){},getVertexPosition(i,out){return out.set(...(deform?deform(points[i],i):points[i]));}};
}
const owner=mesh([[-.6,.2,0],[.4,.2,0],[-.6,.8,0],[.4,.8,0]]);
const petPoints=[[0,0,-.25],[0,0,.25],[0,.4,-.25],[0,.4,.25]];
const g={isObject3D:true,children:[],updateWorldMatrix(){},updateMatrixWorld(){}};
const pet={avatarRef:{group:g,frontPlane:mesh(petPoints)}};
const args={ownerMeshes:[owner],pet,perch:{x:.45,y:.3,z:0},grip:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},quaternion:new Q(Math.PI/2)};
const actual={};
new Function('window','document',fs.readFileSync('docs/js/shoulder-pet-rotation-limits.js','utf8'))(actual,doc);
const solver=actual.ShoulderPetRotationLimits.create({Vector2:V2,Vector3:V3});
let result=solver.constrain(args);
assert.equal(result.mode,'geometric-depth','rotate off a colliding body heading');
assert.ok(Math.abs(result.bodyOffsetDeg)>1);
assert.ok(result.checks>1);
args.quaternion=new Q(0);
result=solver.constrain(args);
assert.equal(result.bodyOffsetDeg,0,'already separated body heading is preserved');
pet.avatarRef.headRig={currentYawDeg:24};
pet.avatarRef.updateHeadYaw=deg=>{pet.avatarRef.headRig.currentYawDeg=deg;};
pet.avatarRef.frontPlane=mesh(petPoints,(point,i)=>[point[0]-(i>=2?.25*pet.avatarRef.headRig.currentYawDeg/24:0),point[1],point[2]]);
args.quaternion=new Q(0);
result=solver.constrain(args);
assert.equal(result.mode,'geometric-depth','head can be clamped independently');
assert.equal(result.bodyOffsetDeg,0);
assert.ok(result.headYawDeg<24 && result.headYawDeg>=0);
assert.equal(pet.avatarRef.headRig.currentYawDeg,result.headYawDeg);
