'use strict';
const assert = require('node:assert/strict'); // Checks actual per-piece policy and state transitions.
const fs = require('node:fs'); // Loads the production module and editor handlers.
const vm = require('node:vm'); // Runs browser-independent policy without WebGL.
const window = {}; // Public API exported by the actual furniture module.
vm.runInNewContext(fs.readFileSync('docs/js/procedural-furniture.js', 'utf8'), { window, THREE: { TextureLoader: class {} } });
const api = window.ProceduralFurniture; // Same authority used by editor and gameplay builders.
const stretched = {kind:'box', materialTexture:'boards.png'}; // Full PNG mapped once over a hard primitive.
assert.equal(api.outlineDecision(stretched).enabled, false);
for (const kind of ['cylinder','legRound','disc','hoop','cup','barrel','sphere']) {
  assert.equal(api.outlineDecision({...stretched, kind}).enabled, true, kind + ' retains a rounded silhouette');
}
assert.equal(api.outlineDecision({kind:'box'}).enabled, true);
assert.equal(api.outlineDecision({...stretched,materialUvMapping:'connected-surface-stretch',materialTexture:null}).enabled, true);
assert.equal(api.outlineDecision(stretched,[{texture:{}}]).enabled, true, 'cleared editor textures override the original recipe texture');
assert.equal(api.outlineDecision({...stretched, materialRepeatU:2}).enabled, true);
assert.equal(api.outlineDecision({...stretched, shellOutline:'on'}).enabled, true);
assert.equal(api.outlineDecision({kind:'cylinder', shellOutline:'off'}).enabled, false);
assert.equal(api.outlineDecision({...stretched, shellOutline:'invalid'}).mode, 'auto');
assert.equal(api.outlineDecision({kind:'glb', modelPath:'models/HighlandLongshingle_boned.glb'}).enabled, false);
assert.equal(api.outlineDecision({kind:'glb', modelPath:'models/log.glb'}).enabled, true);
assert.equal(api.outlineDecision({kind:'liquidSurface'}).enabled, false);
const surfaces = [{texture:{source:'test.png', mapping:'stretch'}}, {texture:{source:'other.png', mapping:'stretch'}}]; // Per-face editor data overrides primitive defaults.
assert.equal(api.outlineDecision({kind:'box'}, surfaces).enabled, false);
assert.equal(api.outlineDecision({kind:'box'}, [...surfaces, {texture:{}}]).enabled, true);
assert.equal(api.outlineDecision({kind:'box'}, [{texture:{source:'test.png',mapping:'tile'}}]).enabled, true);
function mesh(data={}) { return {isMesh:true,userData:data,layers:{mask:1,enable(n){this.mask|=1<<n;},disable(n){this.mask&=~(1<<n);}},children:[],traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}}; }
const root = mesh(); // Simulates an independently authored furniture part.
const png = mesh({isPngPlane:true,noOutline:true}); // PNG child must never become a solid black shell card.
const pattern = mesh({furniturePattern:{mode:'cloth'}}); // Pattern overlays carry their outline ink and remain outside the hull pass.
root.children.push(png,pattern);
api.applyPartOutline(root, stretched);
assert.equal(root.userData.noOutline, true);
assert.equal(root.layers.mask & 2, 0);
api.applyPartOutline(root, {...stretched,shellOutline:'on'});
assert.equal(root.userData.noOutline, false, 'manual On reverses a previous policy opt-out');
assert.equal(root.layers.mask & 2, 2);
assert.equal(png.layers.mask & 2, 0);
assert.equal(png.userData.noOutline, true);
assert.equal(pattern.userData.noOutline, true);
assert.equal(pattern.layers.mask & 2, 0);
api.applyPartOutline(root, {...stretched,shellOutline:'auto'});
assert.equal(root.layers.mask & 2, 0, 'Auto recalculates after a manual override');
const driver = mesh({furnitureGlbPart:true,noOutline:true}); // Delayed imported children inherit policy while the invisible driver stays excluded.
driver.children.push(mesh());
api.applyPartOutline(driver, {kind:'glb',shellOutline:'off'});
assert.equal(driver.children[0].userData.noOutline, true);
api.applyPartOutline(driver, {kind:'glb',shellOutline:'on'});
assert.equal(driver.layers.mask & 2, 0);
assert.equal(driver.children[0].layers.mask & 2, 2);

const editor = fs.readFileSync('docs/tools/furniture-avatar-author/index.html','utf8'); // Execute the real multi-select handler and preview state restoration.
function editorFunction(name) { const start=editor.indexOf('function '+name+'('),end=editor.indexOf('\nfunction ',start+1);return editor.slice(start,end); }
const parts=[{id:'a',name:'Top',...stretched},{id:'b',name:'Leg',kind:'cylinder'}]; // Different geometry kinds remain independently configurable.
const controls={partShellOutline:{value:'off'},partOutlineReadout:{},previewShellOutlines:{checked:true}}; // DOM values used by production handlers.
const meshes=new Map(parts.map(part=>[part.id,mesh()])); // Mesh lookup rebuilt by the selection handler.
const context={state:{parts},meshes,$:id=>controls[id],activePartIds:()=>parts.map(part=>part.id),buildPartMesh:part=>api.applyPartOutline(meshes.get(part.id),part),queueUndoHistory(){},log(){},objectForSelection:()=>null}; // Minimal editor adapters.
vm.createContext(context);
vm.runInContext(editorFunction('refreshPartOutlineUI')+'\n'+editorFunction('setSelectedPartOutlines'),context);
vm.runInContext('setSelectedPartOutlines()',context);
assert(parts.every(part=>part.shellOutline==='off'));
controls.partShellOutline.value='on';
vm.runInContext('setSelectedPartOutlines()',context);
assert(parts.every(part=>part.shellOutline==='on'));
assert([...meshes.values()].every(part=>part.layers.mask&2));
parts[0].shellOutline='auto';
vm.runInContext('refreshPartOutlineUI()',context);
assert.equal(controls.partShellOutline.value,'mixed');
assert.deepEqual(JSON.parse(JSON.stringify(parts)).map(part=>part.shellOutline),['auto','on']);
const camera={layers:{mask:1,set(n){this.mask=1<<n;}}},scene={overrideMaterial:null,background:{isColor:true}}; // Selective preview must not leak layer/material state into normal rendering.
const renderer={autoClear:true,calls:[],pixels:[],render(){if(this.autoClear||scene.background?.isColor)this.pixels=[];this.pixels.push(scene.overrideMaterial?'shell':'colour');this.calls.push({mask:camera.layers.mask,override:scene.overrideMaterial,background:scene.background});}}; // Records normal and shell passes.
Object.assign(context,{camera,scene,renderer,furnitureShellMaterial:{shell:true}});
vm.runInContext(editorFunction('renderFurniturePreview'),context);
vm.runInContext('renderFurniturePreview()',context);
assert.equal(renderer.calls.length,2);
assert.deepEqual(renderer.pixels,['colour','shell'],'a Color background must not force-clear the original furniture or its occlusion depth');
assert.equal(scene.background.isColor,true,'preview restores its normal background after the shell pass');
assert.equal(renderer.calls[1].mask,2);
assert.equal(camera.layers.mask,1);
assert.equal(scene.overrideMaterial,null);
assert.equal(renderer.autoClear,true);
controls.previewShellOutlines.checked=false;
vm.runInContext('renderFurniturePreview()',context);
assert.equal(renderer.calls.length,3);
// Imported authoring files pass through the editor's actual normalizer.
Object.assign(context,{uid:()=> 'imported-id',clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),colorToHex:value=>value});
vm.runInContext(editorFunction('defaultPart')+'\n'+editorFunction('normalizePart'),context);
for(const mode of ['auto','on','off']) {
  context.importedPart=JSON.parse(JSON.stringify({id:'saved-piece',kind:'cylinder',shellOutline:mode,transform:{sx:1,sy:2,sz:3}}));
  const normalized=vm.runInContext('normalizePart(importedPart)',context); // Executes the same path used by file/database import.
  assert.equal(normalized.shellOutline,mode);
  assert.equal(normalized.id,'saved-piece');
  assert.equal(normalized.transform.sy,2);
}
for(const part of [{kind:'box'},{kind:'box',shellOutline:'invalid'}]) {
  context.importedPart=part;
  assert.equal(vm.runInContext('normalizePart(importedPart).shellOutline',context),'auto');
}
controls.previewShellOutlines.checked=true;
const savedBackground=scene.background,savedOverride={previous:true}; // A failed shell draw must not contaminate the following frame.
scene.overrideMaterial=savedOverride;camera.layers.mask=33;
renderer.render=()=>{if(scene.overrideMaterial===context.furnitureShellMaterial)throw new Error('shell draw failed');};
assert.throws(()=>vm.runInContext('renderFurniturePreview()',context),/shell draw failed/);
assert.equal(scene.background,savedBackground);
assert.equal(scene.overrideMaterial,savedOverride);
assert.equal(camera.layers.mask,33);
assert.equal(renderer.autoClear,true);
console.log('Furniture per-piece Auto/On/Off, safe transitions, rounded shapes, multi-selection and preview pass passed.');
