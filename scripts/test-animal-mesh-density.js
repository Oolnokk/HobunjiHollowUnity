#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const avatar = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Real game builder and mesh-budget authority under test.
const shoulder = fs.readFileSync('docs/js/animal-shoulder-spline.js', 'utf8'); // Actual shoulder deformation and split-frame repair hooks.
const response = fs.readFileSync('docs/js/animal-head-material-response.js', 'utf8'); // Actual head material-weight resampling hooks.
const flying = fs.readFileSync('docs/js/flying-animal-rig.js', 'utf8'); // Real flying/perch mesh creation and layer-sharing code.
const perf = fs.readFileSync('docs/js/performance-debug.js', 'utf8'); // Mobile-readable slider/diagnostics.
class Attribute {
  constructor(array, size) { this.array = array; this.itemSize = size; this.count = array.length / size; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  setX(i, value) { this.array[i * this.itemSize] = value; } // Fold columns keep positions and UVs together.
  setY(i, value) { this.array[i * this.itemSize + 1] = value; } // Fold rows keep the neck cut crisp at low mesh density.
}
class PlaneGeometry {
  constructor(width, height, nx = 1, ny = 1) {
    this.parameters = { width, height, widthSegments: nx, heightSegments: ny };
    this.userData = {};
    this.index = { count: nx * ny * 6 }; // Three.js animal PlaneGeometry is indexed; diagnostics count triangles, not vertices.
    const uv = [], position = [];
    for (let r=0;r<=ny;r++) for (let c=0;c<=nx;c++) {
      const u=c/nx, v=1-r/ny;
      uv.push(u,v); position.push((u-.5)*width,(v-.5)*height,0);
    }
    this.attributes = { uv: new Attribute(new Float32Array(uv),2), position: new Attribute(new Float32Array(position),3) };
  }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, attribute) { this.attributes[name]=attribute; }
  computeBoundingBox() {}
  computeBoundingSphere() {}
  dispose() { this.disposed=true; }
}
class WireMaterial { constructor(options) { Object.assign(this,options); } dispose() { this.disposed=true; } }
const THREE = { PlaneGeometry, Uint16BufferAttribute:Attribute, Float32BufferAttribute:Attribute, MeshBasicMaterial:WireMaterial, DoubleSide:2 };
const windowStub = { localStorage:{getItem:()=>null,setItem(){}}, dispatchEvent(){} };
class Weak { constructor(value){this.value=value;} deref(){return this.value;} }
const start=avatar.indexOf('  // Mesh budgets:'), end=avatar.indexOf('  function buildSkinnedPlaneGeometry(',start);
assert(start>0 && end>start);
const {meshBudget}=vm.runInNewContext('(() => {'+avatar.slice(start,end)+' return {meshBudget};})()', {
  window:windowStub, WeakRef:Weak, FinalizationRegistry:undefined, Event:class{constructor(type){this.type=type;}}, console,
});
windowStub.PNGPlaneAvatar={meshBudget};
const weightStart=avatar.indexOf('  function sampleWeight('), weightEnd=avatar.indexOf('  function upgradeAnimalPlaneToWeightedSkin(',weightStart);
assert(weightStart>0 && weightEnd>weightStart);
const makeWeighted=vm.runInNewContext('(() => {'+avatar.slice(weightStart,weightEnd)+' return buildAnimalWeightedGeometry;})()', {
  window:windowStub, UNSET_WEIGHT:256,
  clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
  finite:(v,f)=>Number.isFinite(Number(v))?Number(v):f,
});
const map=new Uint16Array(128*75); // Synthetic irregular head cutout; bottom-right body must never follow a head yaw.
for(let r=0;r<37;r++)for(let c=64;c<128;c++)map[r*128+c]=255; // Only the upper-right quadrant is head-owned.
const rig={meshResolution:48,pivot:{x:.5,y:.4},weightMap:{width:128,height:75,values:map}};
const original=new PlaneGeometry(2.1,.95);
const build=(mirror,grid)=>makeWeighted(THREE,original,rig,mirror,{width:2.1,height:.95},grid);
const front=build(false), back=build(true);
assert.equal(front.userData.segmentsX,12,'default animal grid is 40% of 30');
assert.equal(front.userData.segmentsY,7,'map aspect preserved at low density');
assert.equal(front.getAttribute('uv').count,13*8,'actual GPU vertex grid is reduced');
assert.equal(back.userData.segmentsY,7);
assert.equal(front.parameters.width,2.1,'source silhouette width unchanged');
assert.equal(front.parameters.height,.95,'source silhouette height unchanged');
const frontWeights=front.getAttribute('skinWeight'), backWeights=back.getAttribute('skinWeight');
assert.equal(frontWeights.getY(0)+frontWeights.array[3],0,'front samples original body pitch Influence');
assert.equal(backWeights.getY(0)+backWeights.array[3],1,'rear samples mirrored head pitch Influence');
for(const geo of [front,back]) {
  assert.equal(geo.userData.hobunjiAnimalYawFold,true,'four-bone paper fold survives mesh budget');
  assert.equal(geo.userData.hobunjiAnimalYawMask,'neck-bounded-head','yaw ownership uses geometry rather than Influence paint');
  const weights=geo.getAttribute('skinWeight'), stride=weights.itemSize;
  const width=geo.userData.segmentsX+1;
  for(let i=0;i<weights.count;i++){
    const k=i*stride, a=weights.array;
    const headInfluence=a[k+1]+a[k+3]; // Original authored pitch weights restored from both pitch-bearing bones.
    const gate=a[k+2]+a[k+3]; // Only head-owned vertices may participate in 3D yaw.
    assert(Math.abs(a[k]+a[k+1]+a[k+2]+a[k+3]-1)<1e-6,'all four skin weights normalize at every cell');
    assert(Math.abs(gate-Math.round(gate))<1e-6,'yaw uses no graded irregular skin weights');
    const uv=geo.getAttribute('uv'); // Original geometry coordinates, not painted Influence, own head yaw.
    const sourceU=geo===back?1-uv.getX(i):uv.getX(i); // Back card mirrors the same authored neck.
    const topV=1-uv.getY(i); // Head/leg seam is measured from the top of the sprite.
    const expectedGate=+(sourceU<rig.pivot.x&&topV<rig.pivot.y+.035); // Independent of any head paint value.
    assert(Math.abs(gate-expectedGate)<1e-6,'3D yaw follows only the geometric neck, even where pitch Influence disagrees');
  }
  const uv=geo.getAttribute('uv'), columns=geo.userData.segmentsX;
  const columnGaps=[];
  for(let col=0;col<columns;col++) columnGaps.push(Math.abs(uv.getX(col+1)-uv.getX(col)));
  assert(Math.min(...columnGaps)<.0061,'mesh still has nearby hinge columns even at low density');
  const rowGaps=[]; // The small lower-head cut must not stretch one coarse triangle all the way into the foreleg.
  for(let row=0;row<geo.userData.segmentsY;row++) rowGaps.push(Math.abs(uv.getY(row*width)-uv.getY((row+1)*width)));
  assert(Math.min(...rowGaps)<.0061,'neck-bounded head uses a narrow horizontal fold at low density');
  const faceCol=geo===front?0:columns; // Geometric head lies left of the neck on both mirrored sprite faces.
  const upperIndex=faceCol*stride, lowerIndex=(geo.userData.segmentsY*width+faceCol)*stride;
  assert(Math.abs(weights.array[upperIndex+2]+weights.array[upperIndex+3]-1)<1e-6,'head pixels rotate as a rigid cutout');
  assert(Math.abs(weights.array[lowerIndex+2]+weights.array[lowerIndex+3])<1e-6,'chest/legs beneath the head stay still even at the same X');
}
const frontUv = front.getAttribute('uv'); // Compare the two faces in shared sprite space.
const backUv = back.getAttribute('uv'); // The back face traverses the sprite columns in reverse.
const lastColumn = front.userData.segmentsX;
for (let col = 0; col <= lastColumn; col++) {
  assert(Math.abs(frontUv.getX(col) + backUv.getX(lastColumn - col) - 1) < 1e-6,
    'front and back hinge geometry must mirror exactly, even when the centered pivot rounds halfway between columns');
}
// Nelk's pitch painting extends down the front silhouette. It must NEVER choose
// which part yaws, and editing the painter must not change the rigid head cut.
const nelkAuthoredSource=fs.readFileSync('docs/js/animal-head-rig-authored.js','utf8'); // The same authored Nelk rig the game installs.
const nelkMarker='const EXPORTED_HEAD_RIGS = Object.freeze('; // Extract the already committed painter export, not a duplicated fixture.
const nelkStart=nelkAuthoredSource.indexOf(nelkMarker); // Game's published Nelk map is embedded in this literal.
assert(nelkStart>=0,'authored Nelk map is available');
const nelkExport=JSON.parse(nelkAuthoredSource.slice(nelkStart+nelkMarker.length,nelkAuthoredSource.indexOf(');',nelkStart))).nelk; // Original published Nelk data.
const nelkPixels=new Uint16Array(nelkExport.weightMap.width*nelkExport.weightMap.height); // Decoded pitch Influence, intentionally covering lower-body pixels.
let nelkOffset=0; // Cursor through Nelk's RLE map.
for(let i=0;i<nelkExport.weightMap.data.length;i+=2){
  nelkPixels.fill(nelkExport.weightMap.data[i+1],nelkOffset,nelkOffset+nelkExport.weightMap.data[i]);
  nelkOffset+=nelkExport.weightMap.data[i];
}
assert.equal(nelkOffset,nelkPixels.length,'Nelk author map decodes completely');
const nelkRig={...nelkExport,weightMap:{...nelkExport.weightMap,values:nelkPixels}}; // Live-equivalent head rig input to the production geometry builder.
const blankRig={...nelkRig,weightMap:{...nelkRig.weightMap,values:new Uint16Array(nelkPixels.length)}}; // Changing every Influence pixel tests yaw independence.
const nelkSource=new PlaneGeometry(.89,.89*.65625); // Actual Nelk sprite/model proportions from the bestiary.
for(const mirror of [false,true]){
  const painted=makeWeighted(THREE,nelkSource,nelkRig,mirror); // Nelk as the game currently renders it.
  const unpainted=makeWeighted(THREE,nelkSource,blankRig,mirror); // Same neck, radically different pitch paint.
  const pw=painted.getAttribute('skinWeight').array,uw=unpainted.getAttribute('skinWeight').array;
  const uv=painted.getAttribute('uv'); // Locates lower-head/leg vertices in the actual Nelk skin.
  let paintedLegVertices=0,headVertices=0; // Regression counters exposed in failure messages.
  for(let i=0;i<uv.count;i++){
    const j=i*4, paintedYaw=pw[j+2]+pw[j+3], blankYaw=uw[j+2]+uw[j+3];
    assert.equal(paintedYaw,blankYaw,'Nelk head yaw must remain identical after completely repainting Influence');
    const sourceU=mirror?1-uv.getX(i):uv.getX(i), topV=1-uv.getY(i); // Paint is sampled independently of this neck boundary.
    if(sourceU<nelkRig.pivot.x&&topV>nelkRig.pivot.y+.035&&pw[j+1]+pw[j+3]>.5){
      paintedLegVertices++;
      assert.equal(paintedYaw,0,'Nelk front leg with strong head pitch paint never turns in yaw');
    }
    if(sourceU<nelkRig.pivot.x&&topV<nelkRig.pivot.y+.035){headVertices++;assert.equal(paintedYaw,1,'Nelk head yaw remains rigid');}
  }
  assert(paintedLegVertices>0,'Nelk regression must sample its actual painted lower front leg');
  assert(headVertices>0,'Nelk regression must sample a turning head region');
}
const babyWarp={
  destinationFor(p){return {x:.65,y:p.y};},
  sourceAt(x,y,out){out.x=x;out.y=y;},
};
const warped=makeWeighted(THREE,original,rig,false,{width:2.1,height:.95},null,babyWarp);
assert.equal(warped.userData.hobunjiAnimalYawFoldPivotX,.65,'the vertical fold follows the warped head rather than the adult neck');
const frontTexture={map:'genotype-front'}, backTexture={map:'genotype-back'};
const frontMesh={isSkinnedMesh:true,geometry:front,material:frontTexture,skeleton:{id:'head-front'}};
const backMesh={isSkinnedMesh:true,geometry:back,material:backTexture,skeleton:{id:'head-back'}};
const bones=frontMesh.skeleton, oldFront=frontMesh.geometry;
let refreshed=0; // One paired dependent refresh per slider change, after both mirrored faces have swapped.
const resolveGrid=()=>meshBudget.animalGrid(rig.meshResolution,128/75);
meshBudget.registerExternalSkinnedPortrait(frontMesh,{THREE,animal:true,resolveGrid,buildGeometry:grid=>build(false,grid),
  afterGeometryChange(){ assert.equal(backMesh.geometry.userData.segmentsX,frontMesh.geometry.userData.segmentsX,'both faces swap before dependent hooks'); refreshed++; }});
meshBudget.registerExternalSkinnedPortrait(backMesh,{THREE,animal:true,resolveGrid,buildGeometry:grid=>build(true,grid)});
assert.equal(meshBudget.portraitDensityDebug().animalFaces,2);
assert.equal(meshBudget.portraitDensityDebug().triangles,2*12*7*2,'indexed animal triangle total uses the real index buffer');
assert.equal(meshBudget.setPortraitDensityPercent(100),true);
assert.equal(frontMesh.geometry.userData.segmentsX,30);
assert.equal(frontMesh.geometry.userData.segmentsY,18);
assert.equal(meshBudget.portraitDensityDebug().triangles,2*30*18*2,'indexed animal triangle total remains exact after retessellation');
assert.equal(backMesh.geometry.userData.segmentsX,30);
assert.equal(refreshed,1,'dependent rigs refresh just once per density change');
assert.equal(oldFront.disposed,true,'retired GPU buffer disposed');
assert.strictEqual(frontMesh.skeleton,bones,'existing head skeleton remains attached');
assert.strictEqual(frontMesh.material,frontTexture,'genotype materials are never regenerated');
assert.equal(meshBudget.setPortraitWireframeEnabled(true),true);
assert.equal(frontMesh.material.wireframe,true,'animal portrait wireframe supports GPU inspection');
assert.equal(meshBudget.setPortraitWireframeEnabled(false),true);
assert.strictEqual(frontMesh.material,frontTexture,'wireframe restoration is lossless');
assert.equal(meshBudget.setPortraitDensityPercent(meshBudget.defaultPortraitDensityPercent),true);
assert.equal(frontMesh.geometry.userData.segmentsX,12);
assert.equal(backMesh.geometry.userData.segmentsY,7);
assert.equal(refreshed,2);
assert.equal(meshBudget.setPortraitDensityPercent(40),false,'an unchanged slider value must not rebuild');
assert.equal(meshBudget.unregisterSkinnedPortrait(frontMesh),true);
assert.equal(meshBudget.unregisterSkinnedPortrait(backMesh),true);
assert.equal(meshBudget.portraitDensityDebug().animalFaces,0,'despawn must unregister both live faces');

assert.match(avatar,/front\.mesh\.geometry\.dispose\(\)/,'dispose live geometry after any density changes');
assert.match(avatar,/avatarRef\.refreshShoulderRestGeometry\?\.\(\);[\s\S]{0,100}avatarRef\.refreshHeadMaterialGeometry\?\.\(\)/,'rebuild shoulder then material states');
assert.match(shoulder,/avatarRef\.refreshShoulderRestGeometry =/);
assert.match(shoulder,/refreshOverlayGeometry\(frontOverlay, frontMesh\)/,'split-frame geometry follows resized base');
assert.match(response,/avatarRef\.refreshHeadMaterialGeometry =/,'head material UV/weight arrays are resampled');
assert.match(flying,/for \(const mesh of \[perched, eyePerched, rearEyePerched, glowPerched, patternPerched, detailPerched\]\)/,'flying overlays share retessellated perch geometry');
assert.match(flying,/window\.removeEventListener\?\.\('hobunji:portrait-density-changed', onPortraitDensityChanged\)/,'flying listener released on dispose');
assert(perf.includes('painted animal head rigs') && perf.includes('flying-animal perches'),'mobile slider describes updated animal scope');
console.log('OK: painted animal 40%/100% topology, mirrored weights, live swap, wireframe, dependencies, and cleanup');
