'use strict';
const assert = require('node:assert/strict'); // Verifies world transforms and fixed attachment origins through real owner code.
const fs = require('node:fs'); // Loads the authored defaults and production transform installer.
const vm = require('node:vm'); // Executes the exported transform function with a small independent matrix fixture.
class Matrix4 {
  constructor() { this.identity(); }
  identity() { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; return this; }
  copy(other) { this.elements = [...other.elements]; return this; }
  makeScale(x,y,z) { this.identity(); this.elements[0]=x; this.elements[5]=y; this.elements[10]=z; return this; }
  setPosition(x,y,z) { if (typeof x === 'object') ({x,y,z}=x); this.elements[12]=x; this.elements[13]=y; this.elements[14]=z; return this; }
  multiply(other) { return this.product(this, other); }
  premultiply(other) { return this.product(other, this); }
  product(left,right) {
    const a=left.elements, b=right.elements, out=Array(16).fill(0); // Independent column-major multiplication.
    for(let col=0;col<4;col++) for(let row=0;row<4;row++) for(let k=0;k<4;k++) out[col*4+row]+=a[k*4+row]*b[col*4+k];
    this.elements=out; return this;
  }
  invert() {
    const rows=Array.from({length:4},(_,row)=>[...Array.from({length:4},(_,col)=>this.elements[col*4+row]),...Array.from({length:4},(_,col)=>Number(row===col))]); // Independent Gauss-Jordan inverse.
    for(let col=0;col<4;col++) {
      const pivot=rows.findIndex((row,index)=>index>=col && Math.abs(row[col])>1e-10); // Selects a nonzero pivot, including quarter-turn rotations.
      assert(pivot>=0);
      [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
      const divisor=rows[col][col]; // Normalizes this pivot row.
      rows[col]=rows[col].map(value=>value/divisor);
      for(let row=0;row<4;row++) if(row!==col) {
        const factor=rows[row][col]; // Eliminates this column from every other row.
        rows[row]=rows[row].map((value,index)=>value-factor*rows[col][index]);
      }
    }
    this.elements=Array.from({length:16},(_,index)=>rows[index%4][4+Math.floor(index/4)]); return this;
  }
}
function rotation(axis,angle) {
  const matrix=new Matrix4(), c=Math.cos(angle), s=Math.sin(angle); // Builds rotations independently of the production method.
  const pairs=axis==='x'?[1,2]:axis==='y'?[2,0]:[0,1]; // Cyclic coordinate pair for each axis.
  const [a,b]=pairs;
  matrix.elements[a*4+a]=c; matrix.elements[b*4+b]=c;
  matrix.elements[a*4+b]=s; matrix.elements[b*4+a]=-s;
  return matrix;
}
function node(parent, angle=0, axis='y') {
  return {parent, matrixAutoUpdate:true, position:{x:0.2,y:-0.3,z:0.1}, pose:rotation(axis,angle), matrix:new Matrix4(), updateMatrix(){this.matrix.copy(this.pose).setPosition(this.position);} };
}
function world(part) {
  part.updateMatrix();
  const result=new Matrix4().copy(part.matrix); // Accumulates real ancestor transforms, including reference body scale.
  for(let parent=part.parent;parent;parent=parent.parent){parent.updateMatrix();result.premultiply(parent.matrix);}
  return result;
}
const windowObject={}; // Defaults and optional neutral calibration flag.
vm.runInNewContext(fs.readFileSync('docs/config/character-rig-scale-defaults.js','utf8'),{window:windowObject});
const source=fs.readFileSync('docs/js/character-rig-scale.js','utf8'); // Actual owner function, including its per-node updateMatrix implementation.
const context={window:windowObject};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  function characterScaleOwnerFor('),source.indexOf('  const api = Object.freeze(')),context);
const axes=windowObject.HobunjiCharacterRigScaleDefaults.nuhonganPartScaleAxes; // Nuhongan's donor-size offset is now one uniform factor.
assert.equal(axes.x, axes.y);
assert.equal(axes.y, axes.z);
for(const gender of ['male','female']) for(const angle of [0,0.4,Math.PI/2,-1.8]) {
  const smallScale=windowObject.HobunjiCharacterRigScaleDefaults.scaleFor('nuhongan',gender);
  const expectedUniform=(smallScale.x+smallScale.y)*0.5*axes.x;
  const donor=node(null), small=node(null);
  donor.pose=rotation('y',0.7).multiply(new Matrix4().makeScale(expectedUniform,expectedUniform,expectedUniform));
  small.pose=rotation('y',0.7).multiply(new Matrix4().makeScale(smallScale.x,smallScale.y,smallScale.x));
  small.userData={hobunjiCharacterRigScaleState:{factor:{x:smallScale.x,y:smallScale.y}}};
  const donorJoint=node(donor,angle,'x'), smallJoint=node(small,angle,'x');
  const donorPart=node(donorJoint,0.6,'z'), smallPart=node(smallJoint,0.6,'z');
  const before=world(smallPart).elements;
  assert.equal(context.installPartScaleAxes({Matrix4},smallPart,small,axes,true),true);
  const expected=world(donorPart).elements, actual=world(smallPart).elements;
  for(const index of [0,1,2,4,5,6,8,9,10]) assert.ok(Math.abs(actual[index]-expected[index])<1e-9,`${gender} joint ${angle}: geometry axis ${index}`);
  for(const index of [12,13,14]) assert.ok(Math.abs(actual[index]-before[index])<1e-9,'attachment origin/arm reach must not move');
  windowObject.HobunjiAttackEditorHandCalibrationMode={active:true};
  const neutral=world(smallPart).elements;
  for(let index=0;index<16;index++) assert.ok(Math.abs(neutral[index]-before[index])<1e-9);
  windowObject.HobunjiAttackEditorHandCalibrationMode=null;
}
for(const species of ['longoran','mao-ao','mammakhbuur','engh-sho','kenkari']) for(const gender of ['male','female']) {
  const body=windowObject.HobunjiCharacterRigScaleDefaults.scaleFor(species,gender);
  const parent=node(null); parent.pose=rotation('y',0.37).multiply(new Matrix4().makeScale(body.x,body.y,body.x));
  parent.userData={hobunjiCharacterRigScaleState:{factor:{x:body.x,y:body.y}}};
  const joint=node(parent,-0.6,'x'), part=node(joint,0.7,'z');
  const before=world(part).elements; // Record unchanged grip and ankle origins in the currently stretched body.
  assert.equal(context.installPartScaleAxes({Matrix4},part,joint,()=>null,true),true, 'even species without authored per-part axes need mean-size compensation');
  const actual=world(part).elements;
  const mean=(body.x+body.y)*0.5;
  const owner=node(null); owner.pose=rotation('y',0.37).multiply(new Matrix4().makeScale(mean,mean,mean));
  const referencePart=node(node(owner,-0.6,'x'),0.7,'z');
  const expected=world(referencePart).elements;
  for(const index of [0,1,2,4,5,6,8,9,10]) assert.ok(Math.abs(actual[index]-expected[index])<1e-9,`${species}/${gender}: all-world-axis geometry must be uniform`);
  for(const index of [12,13,14]) assert.ok(Math.abs(actual[index]-before[index])<1e-9,`${species}/${gender}: grip/ankle origin must be unchanged`);
}
const late=node(null), lateJoint=node(late,0.8,'x'), latePart=node(lateJoint,-0.3,'z');
late.pose=new Matrix4().makeScale(0.75,1.5,0.75);
assert.equal(context.installPartScaleAxes({Matrix4},latePart,lateJoint,()=>null,true),true);
const beforeLate=world(latePart).elements;
late.userData={hobunjiCharacterPartScaleFactors:{x:0.75,y:1.5}}; // Enemies receive authoritative scale after asynchronous rig construction.
const afterLate=world(latePart).elements;
assert.notDeepEqual(afterLate.slice(0,12),beforeLate.slice(0,12),'late-authored hostile scales activate on the next update');
for(let i=12;i<=14;i++)assert.ok(Math.abs(afterLate[i]-beforeLate[i])<1e-9,'late hostile scale still keeps the ankle/grip origin fixed');
console.log('Part scale averaging verified for all species, moving joints, original attachment coordinates and late hostile scales.');
const editorSource=fs.readFileSync('docs/tools/animation-author/index.html','utf8'); // Executes the actual import/export anatomy normalizer.
windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES={characters:{'nuhongan::male':{anatomy:{handScaleAxes:axes,footScaleAxes:axes,handScale:0.95,footScale:0.95,armLengthHeightPercentOffset:6}}}};
const editorContext={window:windowObject,CHARACTER_ANATOMY_VERSION_V1530:1}; // Minimal dependencies of the editor owner.
vm.createContext(editorContext);
vm.runInContext(editorSource.slice(editorSource.indexOf('function clampCharacterAnatomyV1530('),editorSource.indexOf('const baseNormalizedRigProfileLibraryV1530')),editorContext);
const imported=editorContext.configuredCharacterAnatomyV1530('nuhongan','male',{}); // Older saves recover built-in axes.
assert.equal(JSON.stringify(imported.handScaleAxes),JSON.stringify(axes));
assert.equal(imported.armLengthHeightPercentOffset,6);
const exported=JSON.parse(JSON.stringify(imported)); // Persisted anatomy survives the next editor import.
assert.equal(JSON.stringify(editorContext.configuredCharacterAnatomyV1530('nuhongan','male',{anatomy:exported}).footScaleAxes),JSON.stringify(axes));
