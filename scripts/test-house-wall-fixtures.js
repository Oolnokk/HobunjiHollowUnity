// Run with: node scripts/test-house-wall-fixtures.js
// Uses the production face-cut module without WebGL/browser dependencies.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../docs/js/house-wall-fixtures.js'),'utf8');
const context={window:{}};vm.runInNewContext(source,context,{filename:'house-wall-fixtures.js'});
const fixtures=context.window.HouseWallFixtures;

const a={id:'north-wall',tag:'wall',v:[[0,0,0],[0,2,0],[4,2,0],[4,0,0]]};
const b={id:'east-wall',tag:'wall',v:[[4,0,0],[4,2,0],[4,2,4],[4,0,4]]};
const windowAt=(id,faceId,u=.5,v=.5,w=1,h=1)=>({id,key:'simpleWindow',faceId,u,v,width:w,height:h});
const area=face=>Math.abs((face.v[3][0]-face.v[0][0])*(face.v[1][1]-face.v[0][1])
  +(face.v[3][2]-face.v[0][2])*(face.v[1][1]-face.v[0][1]));
const near=(value,expected)=>assert.ok(Math.abs(value-expected)<.00001,`expected ${expected}; got ${value}`);

const untouched=fixtures.cutFaces([a,b],[]);
assert.strictEqual(untouched.faces[0],a);
assert.strictEqual(untouched.faces[1],b);
assert.strictEqual(untouched.openingQuads.length,0);

const single=fixtures.cutFaces([a,b],[windowAt('window-1','north-wall')]);
assert.strictEqual(single.openingQuads.length,1);
assert.strictEqual(single.faces.filter(f=>f.sourceWallFaceId==='north-wall').length,4);
near(single.faces.filter(f=>f.sourceWallFaceId==='north-wall').reduce((total,f)=>total+area(f),0),7);
assert.strictEqual(single.faces.find(f=>f.id==='east-wall'),b);
assert.ok(single.faces.every(f=>f.sourceWallFaceId==='north-wall'||f===b));

const double=fixtures.cutFaces([a],[windowAt('w1','north-wall',.25),windowAt('w2','north-wall',.75)]);
near(double.faces.reduce((total,f)=>total+area(f),0),6);
assert.strictEqual(double.openingQuads.length,2);

const overlap=fixtures.cutFaces([a],[windowAt('w1','north-wall',.5),windowAt('w2','north-wall',.52)]);
near(overlap.faces.reduce((total,f)=>total+area(f),0),6.92);

const edge=fixtures.fitToFace(a,windowAt('near-edge','north-wall',0,0,30,30));
assert.ok(edge.width<=3.84 && edge.height<=1.92);
assert.ok(edge.u>=edge.width/8 && edge.v>=edge.height/4);
const clipped=fixtures.cutFaces([a],[edge]);
assert.strictEqual(clipped.openingQuads.length,1);
assert.ok(clipped.openingQuads[0].every(p=>p[0]>=0&&p[0]<=4&&p[1]>=0&&p[1]<=2));
assert.strictEqual(fixtures.cutFaces([a],[windowAt('missing','deleted-wall')]).faces[0],a);
assert.strictEqual(fixtures.normalize({key:'unknown'}).key,'simpleWindow');
assert.strictEqual(fixtures.isWindow({key:'sign'}),false);
assert.strictEqual(fixtures.defaultPattern().mode,'glass');

// Real HobunjiHouse1 gable: face top tapers almost to a point and its raw
// side edges are diagonal, previously shearing and rotating attached windows.
const gable={id:480,tag:'wall',gableEnd:true,v:[
  [2.55,1.4,-1.7],[2.1675,2.59,-.04],[2.1675,2.59,.04],[2.55,1.4,1.7]]};
const tapered={id:'taper',tag:'wall',v:[
  [0,0,0],[.5,2,-.3],[3.5,2,-.3],[4,0,0]]};
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const minus=(a,b)=>a.map((v,i)=>v-b[i]);
const magnitude=a=>Math.hypot(...a);
const tri=(a,b,c)=>{
  const u=minus(b,a),v=minus(c,a);
  return magnitude([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],
    u[0]*v[1]-u[1]*v[0]])*.5;
};
const quadArea=f=>tri(f.v[0],f.v[1],f.v[2])+tri(f.v[0],f.v[2],f.v[3]);
for(const face of [a,gable,tapered]){
  const frame=fixtures.faceFrame(face);
  assert.ok(frame,'wall must resolve a fixture frame');
  for(const direction of ['right','up','outward'])near(magnitude(frame[direction]),1);
  near(dot(frame.right,frame.up),0);
  near(dot(frame.right,frame.outward),0);
  near(dot(frame.up,frame.outward),0);
  assert.ok(frame.up[1]>.9,'gable window must not roll sideways');

  const unrotated=fixtures.fitToFace(face,windowAt('level',face.id,.5,.5,.76,.88));
  const corners=fixtures.paneCornersUV(face,unrotated);
  assert.strictEqual(corners.length,4);
  for(const corner of corners)
    assert.ok(corner.u>=.014&&corner.u<=.986&&corner.v>=.014&&corner.v<=.986,
      'window must fit sloped wall boundaries');
  const positions=fixtures.paneCornersWorld(face,unrotated);
  near(magnitude(minus(positions[0],positions[1])),unrotated.width);
  near(magnitude(minus(positions[1],positions[2])),unrotated.height);
  const rotated=fixtures.fitToFace(face,{...unrotated,rotationDeg:37});
  const cut=fixtures.cutFaces([face],[rotated]);
  assert.strictEqual(cut.openingQuads.length,1);
  assert.ok(cut.faces.every(f=>f.v.every(p=>p.every(Number.isFinite))));
  const solid=cut.faces.reduce((total,f)=>total+quadArea(f),0);
  const expected=quadArea(face)-rotated.width*rotated.height;
  assert.ok(Math.abs(solid-expected)<.001,'rotated aperture area mismatch on '+face.id);
}
const moved=fixtures.faceFrame(gable,p=>[-p[2]+10,p[1]+1,p[0]-4]);
assert.ok(moved.up[1]>.9);
near(dot(moved.right,moved.up),0);
near(dot(moved.right,moved.outward),0);
near(dot(moved.up,moved.outward),0);
const nearEdge=fixtures.fitToFace(a,windowAt('near','north-wall',0,0,.76,.88));
near(nearEdge.width,.76);
near(nearEdge.height,.88);
assert.ok(nearEdge.u>0&&nearEdge.v>0,'near-wall-edge tap should slide window inside');
const spun=fixtures.cutFaces([a],[{...windowAt('rotated','north-wall'),rotationDeg:45,width:1,height:1}]);
near(spun.faces.reduce((total,f)=>total+quadArea(f),0),7);
assert.ok(spun.faces.length>4,'angled aperture must be exact rather than a bounding box');
const angledPair=fixtures.cutFaces([a],[
  {...windowAt('one','north-wall',.48),rotationDeg:30},
  {...windowAt('two','north-wall',.52),rotationDeg:75}
]);
const remaining=angledPair.faces.reduce((total,f)=>total+quadArea(f),0);
assert.ok(remaining<8-.88*.76,'two overlapping windows remove at least one area');
assert.ok(remaining>8-2*.88*.76,'overlap should not double-remove the same area');

console.log('House wall fixture geometry: all assertions passed');
