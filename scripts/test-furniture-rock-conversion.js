'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/tools/furniture-avatar-author/index.html','utf8'); // Execute the editor's actual action without its WebGL/portrait startup.
const start=source.indexOf('function convertFurnitureToRocks('),end=source.indexOf('\nfunction setupEvents',start);
const controls={rockRoughness:{value:'.35'},rockConversionStatus:{textContent:''}}; // Minimal form state used by the batch conversion.
const parts=[{id:'top',kind:'box',transform:{x:1,y:2,z:3,sx:2,sy:.2,sz:1},color:'#ab7634'},
  {id:'post',kind:'glb',modelPath:'models/example.glb',transform:{x:0,y:1,z:0,sx:.2,sy:2,sz:.2}},
  {id:'liquid',kind:'liquidSurface',liquidContainerId:'top',transform:{x:0,y:0,z:0,sx:1,sy:.01,sz:1}}];
const state={id:'fixture-furniture',parts,pieceAnimations:[{id:'swing',drivenPartId:'top',anchorPartId:'post'}],
  processingWarps:[{id:'stomp',partIds:['top','liquid']}],particleEmitters:[{id:'sparks',attachedPartId:'top'}]}; // Existing animation/effect identity must survive conversion.
const original=JSON.stringify(state);let rebuilds=0;const history=[];
const context={state,$:id=>controls[id],clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),num:(id,fallback)=>Number(controls[id].value)||fallback,
  rebuildFurnitureMeshes:()=>{rebuilds++;},queueUndoHistory:message=>history.push(message),log:()=>{}};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
vm.runInContext('convertFurnitureToRocks(true)',context);
assert.equal(rebuilds,1);
assert(state.parts.every(part=>part.rockShape?.enabled),'every component, including imported GLBs, must be converted');
assert(state.parts.every(part=>part.rockShape.roughness===.35));
const saved=JSON.parse(JSON.stringify(state)); // Per-component settings must survive ordinary furniture serialization.
assert(saved.parts.every(part=>part.rockShape.seed===`${state.id}:${part.id}`));
const seeds=state.parts.map(part=>part.rockShape.seed);
controls.rockRoughness.value='.8';vm.runInContext('convertFurnitureToRocks(true)',context);
assert.deepEqual(state.parts.map(part=>part.rockShape.seed),seeds,'adjusting roughness must keep each existing seeded rock');
assert(state.parts.every(part=>part.rockShape.roughness===.8));
vm.runInContext('convertFurnitureToRocks(false)',context);
assert.equal(JSON.stringify(state),original,'restore must recover all original shapes, IDs, transforms, materials, animations and emitters');
assert.equal(history.length,3);
state.parts=[];vm.runInContext('convertFurnitureToRocks(true)',context);
assert.match(controls.rockConversionStatus.textContent,/first/);
assert.equal(history.length,3,'empty furniture must not create an undo entry');
console.log('Rock furniture conversion: all-component coverage, stable seeds, serialization, full restoration and animation/effect identity passed.');
