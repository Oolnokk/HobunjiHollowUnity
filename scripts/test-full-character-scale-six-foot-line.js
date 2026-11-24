'use strict';
// Six-foot camera-following height guide must stay floor-anchored, centered, behind characters and excluded from lineup framing.
const assert = require('node:assert/strict'); // Tests calibrated geometry, zoom/orbit updates and cleanup invariants.
const fs = require('node:fs'); // Reads the shipped author module and chair JSON, not separately implemented scene logic.
const vm = require('node:vm'); // Runs the real guide-installer function with lightweight Three.js substitutes.
const author = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Production Full Character Scale implementation.
const chair = JSON.parse(fs.readFileSync('docs/config/furniture-authored/chairSimple.json', 'utf8')); // Same authored chair loaded in the editor.
const actualTop = Math.max(...chair.parts.map(part => Number(part.transform.y) + Number(part.transform.sy) / 2));
const actualBottom = Math.min(...chair.parts.map(part => Number(part.transform.y) - Number(part.transform.sy) / 2));
assert(Math.abs(actualBottom) < 1e-9, 'the authored chair actually stands on game floor Y=0');
assert(actualTop > .6 && actualTop < .8, 'chair model height remains the 3-ft calibration reference');
class Vec3 {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; }
  copy(v) { return this.set(v.x,v.y,v.z); }
  lengthSq() { return this.x*this.x+this.y*this.y+this.z*this.z; }
  normalize() { const n=Math.sqrt(this.lengthSq()); this.x/=n; this.y/=n; this.z/=n; return this; }
  project(camera) { // Synthetic orthographic viewport with sidebar-induced horizontal projection offset.
    return this.set((this.x-camera.centerX)*2/camera.width+camera.screenShift,
      (this.y-camera.centerY)*2/camera.height, (this.z-camera.centerZ)/camera.depth);
  }
  unproject(camera) {
    return this.set((this.x-camera.screenShift)*camera.width/2+camera.centerX,
      this.y*camera.height/2+camera.centerY,this.z*camera.depth+camera.centerZ);
  }
  distanceTo(v) { return Math.hypot(v.x-this.x,v.y-this.y,v.z-this.z); }
}
class FakeBox3 {
  setFromObject(o) { this.min=new Vec3(-.26, o.minY, -.22); this.max=new Vec3(.26,o.maxY,.22); return this; }
  isEmpty() { return this.max.y<this.min.y; }
}
class FakeGeometry { constructor(w,h) { this.width=w;this.height=h;this.disposed=false; } dispose() { this.disposed=true; } }
class FakeMaterial { constructor(options) { Object.assign(this,options);this.disposed=false; } dispose() { this.disposed=true; } }
class FakeQuaternion { copy(o) { this.x=o.x;this.y=o.y;this.z=o.z;this.w=o.w;return this; } }
class FakeMesh {
  constructor(geometry,material) { this.geometry=geometry;this.material=material;this.position=new Vec3();this.quaternion=new FakeQuaternion();this.scale=new Vec3(1,1,1);this.userData={};this.matrixUpdates=0; }
  updateMatrixWorld() { this.matrixUpdates++; }
}
const THREE={Box3:FakeBox3,Vector3:Vec3,Quaternion:FakeQuaternion,Mesh:FakeMesh,PlaneGeometry:FakeGeometry,MeshBasicMaterial:FakeMaterial,DoubleSide:2};
const controls={target:new Vec3(0,1,0)}; // Camera orbit pivot can move to selected characters.
const window={HobunjiGameplayBackdrop:{getCameraControls:()=>controls}};
const document={getElementById:id=>id==='view3d'?{clientHeight:480}:null};
const scene={children:[],add(o){this.children.push(o);o.parent=this;},remove(o){this.children=this.children.filter(x=>x!==o);o.parent=null;}};
const start=author.indexOf('  function installSixFootGuide('),end=author.indexOf('  function layout()',start);
assert(start>=0 && end>start,'production scene guide function remains findable');
const setup=author.slice(start,end);
const context={THREE,window,document,active:true,building:false,previewRoot:{children:[]},
  sixFootHeight:null,sixFootGuide:null,sixFootGuideDepth:2};
vm.runInNewContext('let { THREE, window, document, active, building, previewRoot, sixFootHeight, sixFootGuide, sixFootGuideDepth } = env;\n'
  + setup + '\nthis.fixture={ installSixFootGuide, getGuide:()=>sixFootGuide, getHeight:()=>sixFootHeight };',
  {env:context,console});
const api=context.fixture; // Fixture directly calls the production function, without adding test hooks to the game.
api.installSixFootGuide({maxY:actualTop,minY:actualBottom},scene);
const line=api.getGuide(); // Scene-owned mesh must not alter the lineup's camera-frame bounds.
assert(line,'six-foot reference gets installed');
assert.equal(scene.children.length,1,'exactly one persistent mesh is installed');
assert.equal(context.previewRoot.children.length,0,'ruler is excluded from previewRoot, so orthographic framing ignores it');
assert.equal(line.name,'FullScaleReference_sixFootLine');
assert.equal(line.frustumCulled,false,'render hook still works as camera moves the ruler into view');
assert.equal(line.renderOrder,-1000,'ruler renders beneath the character portrait planes');
assert.equal(line.material.depthTest,true,'character meshes must be able to occlude the ruler');
assert.equal(line.material.depthWrite,false,'the ruler must never occlude a character');
assert(Math.abs(api.getHeight()-2*actualTop)<1e-12,'six feet uses twice the authored chair back calibrated as three feet');

const camera={
  centerX:0,centerY:.6,centerZ:0,width:12,height:8,depth:10,screenShift:.3,
  direction:new Vec3(0,-.1,-1),q:{x:0,y:0,z:0,w:1},
  getWorldDirection(out) { return out.copy(this.direction); },
  getWorldQuaternion(out) { return out.copy(this.q); },
};
function check(label) {
  line.onBeforeRender(null,null,camera);
  const y=line.position.y;
  assert(Math.abs(y-2*actualTop)<1e-12,label+' marker remains exactly six feet from floor');
  const projected=new Vec3().copy(line.position).project(camera);
  assert(Math.abs(projected.x)<1e-9,label+' line is centered horizontally in viewport');
  assert(Math.abs(line.scale.x-camera.width*1.04)<1e-9,label+' ruler covers the active viewport width');
  assert(Math.abs(line.scale.y-camera.height/480*1.5)<1e-9,label+' ruler stays 1.5 pixels thick');
}
check('initial');
const first=line.matrixUpdates;
controls.target.set(8,1,-6); // Camera pans to another species.
camera.centerX=5;camera.centerZ=-4;camera.screenShift=-.25;camera.width=5;camera.height=4; // Pinch zoom + sidebar shift.
check('pan/zoom');
assert(line.matrixUpdates>first,'render hook updates the existing mesh rather than generating more geometry');
assert.equal(scene.children.length,1,'orbit/zoom creates no additional reference objects');
camera.direction.set(.8,-.4,-.6); // Camera orbits around lineup.
controls.target.set(-3,1,4);camera.centerX=-5;camera.centerZ=3;
check('orbit');
assert(line.position.z !== 0,'line responds to orbit depth change');
assert.match(author,/sixFootGuide\.geometry\.dispose\(\);[\s\S]*sixFootGuide\.material\.dispose\(\)/,'editor exit disposes both GPU resources');
assert.match(author,/sixFootReference: \{ visible:/,'mobile debug snapshot exposes ruler state and calibrated height');
assert.match(author,/minDepth = Math\.min\(minDepth, box\.min\.z\)/,'depth range comes from cached layout rather than per-frame world searches');
assert.match(author,/installSixFootGuide\(chair, scene\)/,'reference installs only after authored chair is available');
console.log('PASS six-foot ruler: chair calibration, floor Y, camera-follow centering, orbit/zoom, behind-layering, one mesh and teardown');
