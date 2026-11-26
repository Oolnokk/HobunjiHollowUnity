'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const win={};
new Function('window',fs.readFileSync('docs/js/shoulder-pet-deformation-envelope.js','utf8'))(win);
const {create,solveBodyYaw,diskMetrics}=win.ShoulderPetDeformationEnvelope;
const disk=(x,z,r,y0=.2,y1=.4)=>diskMetrics({x,z,r,y0,y1});
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-6,m+': '+a+' vs '+b);
const a=disk(.3,0,.025),b=disk(.3,0,.025);
const expected=2*Math.asin(.052/.6);
const angle=solveBodyYaw([a],[b],0);
near(Math.abs(angle),expected+1e-6,'continuous body limit is derived from the circle intersection');
near(solveBodyYaw([a],[b],.5),.5,'already safe rotation is not quantized');
near(solveBodyYaw([a],[disk(.3,0,.025,.8,1)],0),0,'vertical movement reopens the limit');
near(solveBodyYaw([disk(0,0,.002,0,.005)],[disk(0,0,.002,0,.005)],0),0,'authored grip contact is exempt');
assert.equal(solveBodyYaw([disk(0,0,.5)],[b],0),null,'no angular solution when the entire orbit is blocked');
const seam=solveBodyYaw([disk(0,-.3,.025)],[disk(0,.3,.025)],Math.PI);
near(Math.abs(wrap(seam-Math.PI)),expected+1e-6,'wraparound interval is handled');
const pairSafe=(owners,pets,yaw)=>{
  const c=Math.cos(yaw),s=Math.sin(yaw);
  return pets.every(p=>owners.every(o=>o.y0>p.y1+.002 || p.y0>o.y1+.002 ||
    (c*p.x+s*p.z-o.x)**2+(-s*p.x+c*p.z-o.z)**2>(o.r+p.r+.002)**2));
};
let seed=12345;
const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<100;i++){
  const make=()=>Array.from({length:4},()=>disk((rand()-.5)*.8,(rand()-.5)*.8,.015+rand()*.06,.2+rand()*.1,.35+rand()*.1));
  const owners=make(),pets=make(),request=rand()*2*Math.PI-Math.PI;
  const resolved=solveBodyYaw(owners,pets,request);
  if(resolved!==null)assert.ok(pairSafe(owners,pets,resolved),'every resolved angle is separated');
  // An analytic answer cannot be farther than any safe half-degree sample.
  for(let j=0;j<720;j++){
    const sample=j*Math.PI/360;
    if(!pairSafe(owners,pets,sample))continue;
    assert.ok(resolved!==null && Math.abs(wrap(resolved-request))<=Math.abs(wrap(sample-request))+1e-5,'nearest permitted angle is not missed');
  }
}
// Small Three-compatible affine fixtures exercise the actual cached-control
// path, including a live bone and alternate yaw without touching mesh vertices.
class V {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}
class E {set(x,y,z,order='XYZ'){Object.assign(this,{x,y,z,order});return this;}}
class Q {
  constructor(yaw=0){this.setFromAxisAngle(null,yaw);}
  setFromAxisAngle(_,yaw){Object.assign(this,{x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)});return this;}
  setFromEuler(e){return this.setFromAxisAngle(null,e.y);}
}
class M {
  constructor(){this.makeTranslation(0,0,0);}
  makeTranslation(x,y,z){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1];return this;}
  copy(m){this.elements=m.elements.slice();return this;}
  multiplyMatrices(a,b){
    const x=a.elements,y=b.elements,r=[];
    for(let c=0;c<4;c++)for(let row=0;row<4;row++){
      let v=0;for(let k=0;k<4;k++)v+=x[k*4+row]*y[c*4+k];r.push(v);
    }
    this.elements=r;return this;
  }
  multiply(b){return this.multiplyMatrices(this,b);}
  invert(){const a=this.elements; // Fixture matrices use rigid yaw and translation.
    const x=a[12],y=a[13],z=a[14];
    this.elements=[a[0],a[4],a[8],0,a[1],a[5],a[9],0,a[2],a[6],a[10],0,
      -a[0]*x-a[1]*y-a[2]*z,-a[4]*x-a[5]*y-a[6]*z,-a[8]*x-a[9]*y-a[10]*z,1];return this;
  }
  compose(p,q,s){
    const c=1-2*q.y*q.y,v=2*q.w*q.y;
    this.elements=[c*s.x,0,-v*s.x,0,0,s.y,0,0,v*s.z,0,c*s.z,0,p.x,p.y,p.z,1];return this;
  }
}
const rotation=()=>Object.assign(new E().set(0,0,0),{});
const bone=()=>({matrixWorld:new M(),position:new V(),rotation:rotation(),scale:new V(1,1,1),parent:{matrixWorld:new M()},updateWorldMatrix(){
  this.matrixWorld.compose(this.position,new Q(this.rotation.y),this.scale);
}});
let positionReads=0,proxyBuilds=0,headWrites=0;
const proxy={sourceIndices:[0,1,2,3],samples:[[0,0,0,1,0,0],[3,3,3,1,0,0],[6,6,6,1,0,0],[9,9,9,1,0,0]],tris:[[0,3,6],[3,9,6]]};
function mesh(points,bones=null){
  const position={array:points.flat(),version:0,getX:i=>{positionReads++;return points[i][0];},getY:i=>{positionReads++;return points[i][1];},getZ:i=>{positionReads++;return points[i][2];}};
  const skinIndex={array:new Uint16Array(16),itemSize:4,version:0};
  const skinWeight={array:new Float32Array(16),itemSize:4,version:0};
  for(let i=0;i<4;i++){skinIndex.array[i*4+1]=bones?.length>1?1:0;skinWeight.array[i*4]=1;}
  return {geometry:{getAttribute:k=>k==='position'?position:k==='skinIndex'?skinIndex:k==='skinWeight'?skinWeight:null},
    material:{map:{image:{},version:1}},matrixWorld:new M(),rotation:rotation(),matrixAutoUpdate:true,
    isSkinnedMesh:!!bones,bindMatrix:new M(),bindMatrixInverse:new M(),bindMode:'attached',
    skeleton:bones?{bones,boneInverses:bones.map(()=>new M())}:null,updateWorldMatrix(){},updateMatrix(){},skinWeight};
}
const rectangle=(x,z)=>[[x-.02,.2,z],[x+.02,.2,z],[x-.02,.4,z],[x+.02,.4,z]];
const neck=bone(),alternate=bone();neck.position.x=.4;
const owner=mesh(rectangle(.3,0),[neck,alternate]);
const group={isObject3D:true,children:[],matrixWorld:new M(),updateWorldMatrix(){}};
const pet={avatarRef:{group,frontPlane:mesh(rectangle(.3,0))}};
const solver=create({Matrix4:M,Quaternion:Q,Euler:E,Vector3:V},()=>{proxyBuilds++;return proxy;});
const args={ownerMeshes:[owner],pet,perch:new V(),grip:new V(),scale:new V(1,1,1),quaternion:new Q()};
let result=solver.constrain(args);
assert.equal(result.mode,'geometric-depth');near(result.bodyOffsetDeg,0,'neutral neck permits requested rotation');
assert.equal(result.preparations,2);
const reads=positionReads,builds=proxyBuilds;
neck.position.x=0;args.quaternion=new Q();result=solver.constrain(args);
assert.equal(result.mode,'geometric-depth');assert.ok(Math.abs(result.bodyOffsetDeg)>1,'neck deformation closes previously safe angles');
assert.equal(result.preparations,0);assert.equal(result.checks,0);assert.equal(positionReads,reads);assert.equal(proxyBuilds,builds);
neck.position.y=1;args.quaternion=new Q();result=solver.constrain(args);
near(result.bodyOffsetDeg,0,'neck moving away reopens the requested angle');
assert.equal(positionReads,reads);
for(let i=0;i<4;i++){owner.skinWeight.array[i*4]=0;owner.skinWeight.array[i*4+1]=1;}
owner.skinWeight.version++;
args.quaternion=new Q();result=solver.constrain(args);
assert.ok(Math.abs(result.bodyOffsetDeg)>1,'painted weight changes update the live envelope');
assert.equal(result.weightRefreshes,1);assert.equal(positionReads,reads);
const yawBone=bone();yawBone.rotation.y=Math.PI/6;
pet.avatarRef.frontPlane=mesh(rectangle(.3*Math.cos(Math.PI/6),.3*Math.sin(Math.PI/6)),[yawBone]);
pet.avatarRef.headRig={currentYawDeg:30,frontYawBone:yawBone,rig:{minDeg:-40,maxDeg:40}};
pet.avatarRef.updateHeadYaw=deg=>{headWrites++;pet.avatarRef.headRig.currentYawDeg=deg;yawBone.rotation.y=deg*Math.PI/180;};
args.quaternion=new Q();result=solver.constrain(args);
assert.equal(result.mode,'geometric-depth');near(result.bodyOffsetDeg,0,'head turn yields before body heading');
assert.ok(result.headYawDeg<30 && result.headYawDeg>=0);assert.equal(headWrites,1,'only the chosen head yaw is applied to the live rig');
assert.equal(result.checks,0);
const after=positionReads;
args.quaternion=new Q();result=solver.constrain(args);
assert.equal(result.preparations,0);assert.equal(positionReads,after);
assert.equal(headWrites,1,'already safe head angle is not rewritten');
console.log('live shoulder bone envelopes: continuous yaw, deformation, weight changes and head clamp passed');

const render=fs.readFileSync('docs/js/bootstrap/classic-groups/render.js','utf8');
assert.ok(render.indexOf('shoulder-pet-deformation-envelope.js')>=0 && render.indexOf('shoulder-pet-deformation-envelope.js')<render.indexOf('shoulder-pet-rotation-limits.js'),'live envelope module loads before its consumer');
const integration=fs.readFileSync('docs/js/shoulder-pet-rotation-limits.js','utf8');
assert.ok(integration.includes('if(liveEnvelope)return liveEnvelope.constrain(args);'),'real Three.js attachment uses the deformation-aware path');


// Even when an inward yaw could open clearance, passive curiosity may
// only yield toward neutral. Candidate headings must obey the live side.
pet.avatarRef.headRig.currentYawDeg=30;yawBone.rotation.y=Math.PI/6;
args.quaternion=new Q();args.passiveAwayLimit=()=>0;
const restricted=solver.constrain(args);
assert.ok(restricted.headYawDeg===0 || restricted.mode==='no-safe-rotation','passive constraint never selects a forbidden yaw');
if(restricted.mode==='geometric-depth')assert.equal(pet.avatarRef.headRig.currentYawDeg,0);
console.log('passive geometry candidates respect permitted direction');
