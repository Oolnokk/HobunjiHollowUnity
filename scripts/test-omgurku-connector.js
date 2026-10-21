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
 console,
});
const mod=world.HobunjiOmgurkuConnector;
assert.deepEqual(Array.from(mod.belt(),p=>p.x),[.3,.4,.5,.6,.7],
  'the exact canonical pants waistband comes from the Engh-Sho character fit');
assert.equal(mod.live.size,0,'no mesh allocated before an NPC is built');
const invalid=mod.normalize({...cfg.connector,enabled:true,sourceTop:[{x:2,y:2}]});
assert.equal(invalid.sourceTop.length,5,'invalid source seams are replaced with safe defaults');
assert.equal(invalid.sourceTop[0].x,.32);
assert.equal(mod.splineAt(cfg.connector.animalNeck,.5).x,.30,
 'five point middle control is an exact interpolation landmark');
const saved=mod.set({...cfg.connector,enabled:true,opacity:.8,
 imageDataUrl:'data:image/png;base64,iVBORw0KGgo='},{persist:true});
assert.equal(saved.enabled,true);
assert.equal(saved.opacity,.8);
assert.equal(saved.imageDataUrl,undefined,'export never embeds uploaded PNG');
assert(mem.get(mod.storageKey).includes('imageDataUrl'),'browser keeps real uploaded PNG');
assert(!mod.reset().enabled,'reset disables optional connector and frees no-NPC preview');
assert.equal(mem.has(mod.storageKey),false,'reset clears local override');
console.log('Omgurku two-spline connector rig authoring contract passed');