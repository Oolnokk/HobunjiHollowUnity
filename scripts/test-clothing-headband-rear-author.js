#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'../docs/tools/clothing-species-fit'); // Use shipped browser modules rather than reimplementing spline math.
const read=filename=>fs.readFileSync(path.join(root,filename),'utf8');
const seven={window:{}};
vm.runInNewContext(read('headband-spline-fit.js'),seven);
const spline=seven.window.ClothingHeadbandSpline;
const nodes=Array.from({length:7},(_,i)=>({x:.2+i*.1,y:.3+.01*i*i})); // Deliberately asymmetrical curve detects mirror mistakes.
const mirrored=spline.flipNodes(nodes,'horizontal'),upsideDown=spline.flipNodes(nodes,'vertical');
assert(spline.valid(mirrored)&&spline.valid(upsideDown),'Both reflections retain seven ordered spline points');
assert(Math.abs(mirrored[0].y-nodes[6].y)<1e-8,'Horizontal reflection reverses the curve in place');
assert(Math.abs(upsideDown[0].y-nodes[6].y)<1e-8,'Vertical reflection changes curvature relative to its local bounds');
assert(spline.flipNodes(mirrored,'horizontal').every((p,i)=>Math.abs(p.x-nodes[i].x)<1e-8&&Math.abs(p.y-nodes[i].y)<1e-8),
  'Two horizontal flips restore the original control points');
assert(spline.flipNodes(upsideDown,'vertical').every((p,i)=>Math.abs(p.y-nodes[i].y)<1e-8),
  'Two vertical flips restore the original curve');
assert.throws(()=>spline.flipNodes(nodes,'diagonal'),/Flip requires/,'Unsupported reflections fail explicitly');
assert.deepEqual(nodes[0],{x:.2,y:.3},'Flipping must not mutate the stored source points');

const core=Array.from({length:12},(_,i)=>read('app.part'+(i+1)+'.txt')).join('');
new vm.Script(core);
const html=read('index.html');
for(const id of ['headbandView','headbandFlipH','headbandFlipV','headbandRearFromFront','headbandRearFromExisting',
  'headbandRearBlank','headbandRearImport','headbandRearExport','headbandRearColor','headbandRearBrush','headbandRearFullPlane']){
  assert(html.includes('id="'+id+'"'),'Authoring control must be present: '+id);
}
assert(core.includes('R.headReferenceBack=canonicalHeadReference(avatar.headOnlyBack)'),
  'Backplane editing must use the game-rendered rear head rather than mirroring its front');
assert(core.includes('R.headbandRearCanvas=copyHeadbandCanvas(canvas)'),
  'Painted rear pixels remain separate from the front source PNG');
assert(core.includes('record.rearArtPng=R.headbandRearCanvas?.toDataURL('),
  'Rear PNG persists in the saved per-species authoring record');
assert(core.includes("const authoredRear=fitRegion()==='headwear'"),
  'Canonical runtime preview must override behindImage with painted rear art');
assert(core.includes("const rearPath=[...front.path,'behindImage']"),
  'New rear sprite must become the canonical behindImage layer');
assert(core.includes('const exportLayers=fittedLayerOutputs(fit)'),
  'Single-layer front headbands must be promoted to ZIP when a new back image is painted');

function extract(first,last){
  const a=core.indexOf(first),b=core.indexOf(last,a);
  assert(a>=0&&b>a,'Missing shipped editor function '+first);
  return core.slice(a,b);
}
const fitted=new Function('R','targetGridFromFitState','layerMatchesRoutedClothingPatch',
  'fittedSourceCanvasForLayer','warpClothing','fitRegion','headbandRearDisplay','flipCanvasX',
  extract('function fittedLayerOutputs(', 'function archiveAssetPath(')+'\nreturn fittedLayerOutputs;')(
  {body:{width:234,height:173},cloth:{_layers:[{
    path:['parts','head','layers','front'],name:'head.layers.front',view:'front',
    url:'./assets/cosmetics/clothes/hat/headband.png',role:'base',canvas:{id:'front'}
  }]}},
  ()=>[],()=>false,layer=>layer.canvas,source=>({id:'fitted '+source.id}),()=> 'headwear',
  state=>state.rearCanvas,art=>({id:'game-flipped '+art.id})
);
const fit={headband:{rearCanvas:{id:'painted rear'}}};
const layers=fitted(fit);
assert.equal(layers.length,2,'Painting an independent back image produces a second layer');
assert.deepEqual(layers[1].path,['parts','head','layers','front','behindImage'],
  'Back image config path points at front.behindImage');
assert.equal(layers[1].canvas.id,'game-flipped painted rear','Rear pixels are flipped exactly once for the game');
assert.equal(layers[0].canvas.id,'fitted front','The existing front headband remains untouched');
assert.equal(fitted({headband:null}).length,1,'Without painted back art, legacy single-layer exports remain unchanged');

console.log('OK: reversible seven-point curve flips, canonical backplane reference, persistent rear PNG and behindImage export');
