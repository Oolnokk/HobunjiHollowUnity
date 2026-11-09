#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'); // Production authoring paths are regression-tested without browser-only WebGL.
const fs=require('node:fs');
const vm=require('node:vm');
const read=path=>fs.readFileSync(path,'utf8');
const attack=read('docs/tools/attack-animation-editor/index.html');
const statue=read('docs/tools/statue-author/index.html');
const furniture=read('docs/tools/furniture-avatar-author/index.html');
const procedural=read('docs/js/procedural-furniture.js');
const hub=read('docs/tools/index.html');

function scriptBodies(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(m=>!/type\s*=\s*["']importmap["']/.test(m[1]) && m[2].trim())
    .map(m=>m[2].replace(/^\s*import\s+.*?\s+from\s+['"][^'"]+['"]\s*;/gm,''));
}
for(const [name,html] of [['attack',attack],['statue',statue],['furniture',furniture],['hub',hub]]) {
  const bodies=scriptBodies(html);
  assert(bodies.length>0,name+' has runnable JS');
  bodies.forEach(body=>assert.doesNotThrow(()=>new vm.Script(body),name+' JS must parse'));
}
assert(hub.includes('data-target="statue-author"')&&hub.includes('id="if-statue-author"'),'the reusable Statue Author is reachable from Tools Hub');
assert(statue.includes('src="../attack-animation-editor/index.html?statueAuthor=1"'),'statues reuse the actual Attack Animation Editor');
assert(attack.includes('window.HobunjiStatuePoseSource=Object.freeze({'),'statues use an explicit, narrow pose/capture API');
assert(attack.includes("window.FestivalAncestorFigures.carvedCanvas(original,stone)"),'the renderer reuses the Tzizkhanash stone mask');
assert(attack.includes('fromBufferAttribute(mesh.geometry.getAttribute'), 'skinned vertices must start from the original vertex');
assert(attack.includes('await new Promise(resolve=>requestAnimationFrame(resolve))'),'hands/weapon owners synchronize before freeze');
assert(attack.includes("if(includeWeapon)capture(toolPlaneMesh,true)"),'weapon geometry is included when selected');
assert(attack.includes('geometry.applyMatrix4(mesh.matrixWorld)'),'exported statue geometry is frozen in the preview pose');
assert(attack.includes("geometry.deleteAttribute('skinWeight')"),'baked geometry no longer needs runtime skeletal animation');
assert(attack.includes("statueSource:{schema:'hobunji_statue_source.v1'"),'statue remains reauthorable using original source metadata');
assert(attack.includes("texture.repeat.copy(source.repeat)")&&attack.includes("texture.offset.copy(source.offset)"),'carved texture preserves the authored sprite UVs');
assert(statue.includes("type:'hobunji-statue-piece-import'"),'Statue Author supports a direct furniture-editor transfer');
assert(furniture.includes("event.origin!==location.origin||event.source!==window.opener"),'direct imports reject unrelated windows/origins');
assert(procedural.includes('part.statueBaked === true && part.preserveMaterials === true'),'furniture does not erase embedded stone texture');
assert(procedural.includes('child.material.map(material => material.clone())'),'imported statue materials are cloned per piece');

// Execute the production furniture-piece import function with minimal editor UI seams.
const begin=furniture.indexOf('function importStatueFurniturePiece(payload) {');
const end=furniture.indexOf('\nfunction addPart(kind,overrides={})',begin);
assert(begin>0&&end>begin,'the statue part importer must remain a dedicated function');
const importer=furniture.slice(begin,end);
const state={parts:[{id:'existing',kind:'box',name:'Plinth'}]}; // Previous furniture must remain untouched by statue inserts.
let id=0,history=[],rebuilds=0,selected=null,mode=null;
const feedback={textContent:''};
const context={
  state,
  uid:prefix=>prefix+'_'+(++id),
  normalizePart:part=>JSON.parse(JSON.stringify(part)),
  setEditorMode:value=>{mode=value;},
  rebuildAll:()=>{rebuilds++;},
  selectObject:(_kind,value)=>{selected=value;},
  frameFurniture:()=>{},
  queueUndoHistory:value=>history.push(value),
  $:()=>feedback,
  log:()=>{},
};
vm.runInNewContext(importer,context);
const source={
  schema:'hobunji_statue_piece.v1',
  part:{
    id:'from_export',kind:'glb',name:'Ancestor with sword',
    modelPath:'data:model/gltf-binary;base64,AAAA',
    preserveMaterials:true,statueBaked:true,
    statueSource:{npc:{id:'ancestor'},poseKey:'strike'},
    transform:{x:0,y:.5,z:0,rx:0,ry:0,rz:0,sx:.9,sy:1.7,sz:.5}
  }
};
const first=context.importStatueFurniturePiece(source);
const second=context.importStatueFurniturePiece(source);
assert.equal(state.parts.length,3,'each statue import appends, not replaces, a furniture piece');
assert.equal(state.parts[0].name,'Plinth','the original furniture stays intact');
assert.notEqual(first.id,second.id,'repeated imports get independent part IDs');
assert.equal(state.parts[1].statueBaked,true);
assert.equal(state.parts[1].preserveMaterials,true);
assert.equal(state.parts[1].statueSource.poseKey,'strike','source rig metadata survives editor insertion');
assert.equal(source.part.id,'from_export','import does not mutate source JSON');
assert.equal(selected,second.id);
assert.equal(mode,'parts');
assert.equal(rebuilds,2);
assert.equal(history.length,2);
assert.match(feedback.textContent,/independent furniture piece/i);

for(const bad of [
  {},
  {schema:'hobunji_statue_piece.v1',part:{...source.part,kind:'box'}},
  {schema:'hobunji_statue_piece.v1',part:{...source.part,modelPath:'javascript:alert(1)'}},
  {schema:'hobunji_statue_piece.v1',part:{...source.part,modelPath:'../../outside.glb'}},
  {schema:'hobunji_statue_piece.v1',part:{...source.part,transform:{...source.part.transform,sz:0}}},
  {schema:'hobunji_statue_piece.v1',part:{...source.part,transform:{...source.part.transform,sx:Infinity}}}
]) assert.throws(()=>context.importStatueFurniturePiece(bad),'malformed statue pieces are rejected');
assert.equal(state.parts.length,3,'failed imports do not damage the existing furniture');
console.log('Statue Author browser script syntax, shared pose/stone path, safe piece insertion and source preservation passed.');
