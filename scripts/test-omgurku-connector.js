// Two-spline Omgurku connector regression: genuine pants spline contract,
 // optional asset behavior, normalized export and local storage round-trip.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const cfg=JSON.parse(read('docs/config/species/omgurku.json'));
const html=read('docs/tools/omgurku-calibration/index.html');
const runtime=read('docs/js/omgurku-connector-rig.js');
const editor=read('docs/tools/omgurku-calibration/connector-author.js');
const boot=read('docs/js/attachment-rig-latest-authored-snapshot.js');
assert.equal(cfg.connector.schema,'hobunji.omgurku-connector.v1');
assert.equal(cfg.connector.enabled,false,'missing PNG must not show placeholders or throw');
assert.equal(cfg.connector.assetPath,'assets/portraitsprites/omgurku-connector.png');
assert(!fs.existsSync(path.join(root,'docs',cfg.connector.assetPath)),
  'the connector starts as an optional user-provided PNG');
const coreSrc=read('docs/js/pants-rig-core.js');
assert(coreSrc.includes('validateFivePointSpline'));
for(const k of ['sourceTop','sourceBottom','animalNeck'])
  assert.equal(cfg.connector[k].length,5,k+' is exactly five pants-style normalized points');
for(const id of ['connectorFile','connectorSourceCanvas','connectorRiderCanvas','connectorAnimalCanvas',
 'connectorSave','connectorClear','connectorExport','connectorDownloadPng','connectorImport'])
  assert(html.includes('id="'+id+'"'),'connector editor control '+id);
assert(html.includes('pants-rig-core.js'),'pants rig core is loaded by nested editor');
assert(boot.indexOf('omgurku-connector-rig.js')<boot.indexOf('omgurku-species-runtime.js'),
  'connector rig bootstrapped ahead of hybrid NPC');
assert(editor.includes('HobunjiOmgurkuConnectorAuthor'));
assert(read('docs/js/omgurku-species-runtime.js').includes('c.connector?.update?.()'),
  'connector geometry updates in the same callback as the separate facing deadzones');
new vm.Script(runtime,{filename:'omgurku-connector-rig.js'});
new vm.Script(editor,{filename:'connector-author.js'});
const mem=new Map();
const serializedImages=[]; // Track accidental copies of uploaded artwork during live rig edits.
const world={
 HOBUNJI_PANTS_RIGS:{characters:{'engh-sho::male':{
    portraitBeltSpline:[
     {x:.3,y:.9},{x:.4,y:.91},{x:.5,y:.92},{x:.6,y:.91},{x:.7,y:.9}
    ]}}},
 HobunjiPantsRig:{validateFivePointSpline:points=>Array.isArray(points)&&points.length===5
  &&points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)
   &&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)},
};
vm.runInNewContext(runtime,{
 window:world,document:{currentScript:{src:'https://example.com/docs/js/omgurku-connector-rig.js'}},
 location:{href:'https://example.com/docs/index.html'},
 localStorage:{
  getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v),
  removeItem:k=>mem.delete(k)
 },
 console,URL,JSON:{parse:JSON.parse,stringify(value,...args){
  if(value?.imageDataUrl)serializedImages.push(value.imageDataUrl.length);
  return JSON.stringify(value,...args);
 }},
});
const mod=world.HobunjiOmgurkuConnector;
assert.deepEqual(Array.from(mod.belt(),p=>p.x),[.3,.4,.5,.6,.7],
  'the exact canonical pants waistband comes from the Engh-Sho character fit');
assert.equal(mod.live.size,0,'no mesh allocated before an NPC is built');
const invalid=mod.normalize({...cfg.connector,enabled:true,sourceTop:[{x:2,y:2}]});
assert.equal(invalid.sourceTop.length,5,'invalid source seams are replaced with safe defaults');
assert.equal(invalid.sourceTop[0].x,.32);
assert.doesNotThrow(()=>mod.normalize({sourceTop:[null,null,null,null,null]}),
 'malformed external JSON falls back without crashing');
assert.equal(mod.splineAt(cfg.connector.animalNeck,.5).x,.30,
 'five point middle control is an exact interpolation landmark');
const saved=mod.set({...cfg.connector,enabled:true,opacity:.8,
 imageDataUrl:'data:image/png;base64,iVBORw0KGgo='},{persist:true});
assert.equal(saved.enabled,true);
assert.equal(saved.opacity,.8);
assert.equal(saved.imageDataUrl,undefined,'export never embeds uploaded PNG');
assert(mem.get(mod.storageKey).includes('imageDataUrl'),'browser keeps real uploaded PNG');
const serializedBefore=serializedImages.length;
mod.snapshot();
const uploaded=mod.snapshot({includeImage:true});
assert.equal(uploaded.imageDataUrl,'data:image/png;base64,iVBORw0KGgo=');
mod.set({...uploaded,opacity:.7});
assert.equal(serializedImages.length,serializedBefore,'live rig edits and snapshots never serialize PNG bytes');
assert(!mod.reset().enabled,'reset disables optional connector and frees no-NPC preview');
assert.equal(mem.has(mod.storageKey),false,'reset clears local override');
// Execute the shared authoring math against synthetic alpha grids in every direction.
const mathWorld = {}; // Isolated shared-core instance, without a browser or renderer.
vm.runInNewContext(coreSrc, mathWorld);
const core = mathWorld.HobunjiPantsRig; // Public math used by the actual toolbar buttons.
const line = [.3,.4,.5,.6,.7].map(x => ({x,y:.05})); // Starts above a known opaque rectangle.
const pixels = {width:40,height:20,data:new Uint8ClampedArray(40*20*4)}; // Pixel-perfect test silhouette.
for(let y=5;y<15;y++)for(let x=10;x<30;x++)pixels.data[(y*40+x)*4+3]=255;
for(const [angle,points,axis,expected] of [
 [90,line,'y',.25],[270,line.map(p=>({...p,y:.95})),'y',.75],
 [0,line.map(p=>({x:.05,y:p.x})),'x',.25],[180,line.map(p=>({x:.95,y:p.x})),'x',.75],
]){
 const result=core.shrinkwrapSplineToAlpha(points,pixels,angle); // First incoming solid pixels for each cardinal direction.
 assert.equal(result.hits,5);
 for(const point of result.points){
  assert(Math.abs(point[axis]-expected)<1e-6,'lands on the incoming silhouette edge');
  assert(pixels.data[(Math.floor(point.y*20)*40+Math.floor(point.x*40))*4+3]>=128,
   'landed coordinate is actually inside an opaque pixel');
 }
}
const inner=line.map(p=>({...p,y:.5})); // Nodes already on solid artwork must never move against the chosen direction.
const settled=core.shrinkwrapSplineToAlpha(inner,pixels,90);
assert.equal(JSON.stringify(settled.points),JSON.stringify(inner),'already-solid nodes stay in place');
const repeated=core.shrinkwrapSplineToAlpha(settled.points,pixels,90);
assert(repeated.points.every((p,i)=>Math.abs(p.y-settled.points[i].y)<1e-10),'repeated shrinkwrap is stable');
const missed=core.shrinkwrapSplineToAlpha(line.map(p=>({...p,x:0})),pixels,90);
assert.equal(missed.hits,0);
assert(missed.points.every(p=>p.x===0&&p.y===.05),'misses keep their original positions');
const diagonal={width:20,height:20,data:new Uint8ClampedArray(20*20*4)}; // A single pixel tests diagonal traversal without step-skipping.
diagonal.data[(10*20+10)*4+3]=255;
const angled=core.shrinkwrapSplineToAlpha(line.map(()=>({x:.1,y:.1})),diagonal,45);
assert.equal(angled.hits,5);
assert(angled.points.every(p=>Math.abs(p.x-p.y)<1e-12&&Math.abs(p.x-.5)<1e-6),'diagonal hits remain on the requested ray');
const before=JSON.stringify(line); // Transforms return new points and preserve original editor history.
const shifted=core.transformSpline(line,{dx:-.9});
assert.equal(shifted[0].x,0);
assert(Math.abs(shifted[4].x-shifted[0].x-.4)<1e-12,'edge clamping moves the group without squashing it');
assert.equal(JSON.stringify(line),before);
const rotated=core.transformSpline([.4,.45,.5,.55,.6].map(x=>({x,y:.5})),{rotateDeg:90},{width:200,height:100});
assert(rotated.every(p=>Math.abs(p.x-.5)<1e-12));
assert(Math.abs(rotated[0].y-.3)<1e-12&&Math.abs(rotated[4].y-.7)<1e-12,'rotation respects non-square image pixels');
assert.throws(()=>core.transformSpline(line,{scaleX:100}),/exceed/,'oversized transforms do not destroy the spline');
assert.throws(()=>core.shrinkwrapSplineToAlpha(line,{width:1,height:1,data:[]},90),/Readable/);
const edited=mod.normalize({...cfg.connector,riderWaist:line,shrinkwrapDirections:{sourceTop:-90,animalNeck:450}});
assert.equal(edited.shrinkwrapDirections.sourceTop,270);
assert.equal(edited.shrinkwrapDirections.animalNeck,90);
assert.equal(edited.riderWaist[0].x,.3);
console.log('Omgurku two-spline connector rig authoring contract passed');