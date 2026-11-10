#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=path=>fs.readFileSync(path,'utf8'); // Tests real committed editor/runtime source.
const tool=read('docs/tools/statue-author/index.html');
const furnitureEditor=read('docs/tools/furniture-avatar-author/index.html');
const runtime=read('docs/js/authored-furniture-runtime.js');
const geometry=read('docs/js/procedural-furniture.js');
const hub=read('docs/tools/index.html');
const game=read('docs/index.html');
const inlineScripts=[...tool.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match=>match[1]).filter(Boolean); // Guards against syntax regressions in mobile-only tools.
for(const script of inlineScripts)new vm.Script(script,{filename:'statue-author/index.html'});
new vm.Script(geometry,{filename:'procedural-furniture.js'});
new vm.Script(runtime,{filename:'authored-furniture-runtime.js'});
assert.match(tool,/NpcAvatarPreview\.buildProfileFromNpcExport/,'NPC appearance is composed by the real portrait pipeline');
assert.match(tool,/renderProfileToCanvas/,'Head and body are sourced from real NPC art');
assert.match(tool,/animation\?\.poses\?\.\[phase\]/,'Attack Animation Editor JSON drives the frozen key pose');
assert.match(tool,/statueMaskDataUrl/,'Portrait body and head export independent silhouette pieces');
assert.match(tool,/assets\/toolsprites/,'Weapon layer inputs use existing PNG sprite paths');
assert.match(tool,/materialTexture:finish/,'Weapon and limbs share the selected furniture material');
assert.match(tool,/HobunjiFurnitureStatueImport/,'Standalone Statue Author offers direct Furniture Editor transfer');
assert.match(furnitureEditor,/window\.HobunjiFurnitureStatueImport/,'Furniture Editor exposes the direct transfer endpoint');
assert.match(furnitureEditor,/id="statueParentPart"/,'Furniture Editor can edit parent relationships');
assert.match(furnitureEditor,/reparentSelectedStatuePiece\(''/,'Furniture Editor can detach child pieces');
assert.match(geometry,/applyStatueSpriteFinish/,'Game and author use the same alpha-masked furniture finish');
assert.match(hub,/id="if-statue-author"/,'Tools Hub exposes the Statue Author');
assert.match(game,/js\/procedural-furniture\.js/,'Game loads the shared furniture renderer');

class Group { // Minimal scene graph tests parent linking without requiring browser/WebGL.
  constructor(){this.children=[];this.parent=null;this.userData={};this.position={};this.quaternion={};this.scale={};}
  add(child){child.parent?.remove(child);child.parent=this;this.children.push(child);return this;}
  remove(child){const index=this.children.indexOf(child);if(index>=0)this.children.splice(index,1);if(child.parent===this)child.parent=null;return this;}
}
class Matrix4 {compose(){return this;}}
class Vector3 {}
class Quaternion {}
const context={window:{FoliageGenerator:null,ProceduralFurniture:{buildPartMesh:()=>new Group()}},
  THREE:{Group,Matrix4,Vector3,Quaternion},fetch:()=>{throw Error('No fetch in furniture graph test');}};
vm.runInNewContext(runtime,context,{filename:'authored-furniture-runtime.js'});
const build=context.window.AuthoredFurniture.buildGroup;
const records=[
  {id:'torso',kind:'statueSprite',transform:{x:0,y:0,z:0}},
  {id:'head',parentPartId:'torso',kind:'statueSprite',transform:{x:0,y:.4,z:0}},
  {id:'hand',parentPartId:'torso',kind:'glb',transform:{x:.3,y:0,z:0}},
  {id:'weapon',parentPartId:'hand',kind:'statueSprite',transform:{x:0,y:-.1,z:0}}
];
const group=build({key:'testStatue',parts:records});
const nodes=group.userData.meshById;
assert.equal(nodes.get('head').parent,nodes.get('torso'),'Head follows torso');
assert.equal(nodes.get('weapon').parent,nodes.get('hand'),'Weapon follows hand');
assert.equal(nodes.get('hand').parent,nodes.get('torso'),'Hand follows torso');
assert.equal(nodes.get('torso').parent,group,'Torso is the furniture root');
const legacy=build({key:'plainFurniture',parts:[{id:'a',kind:'box',transform:{}}]});
assert.equal(legacy.userData.meshById.get('a').parent,legacy,'Ordinary furniture remains flat');
const cyclic=build({key:'badLinks',parts:[
  {id:'a',parentPartId:'b',kind:'box',transform:{}},
  {id:'b',parentPartId:'a',kind:'box',transform:{}}
]});
assert.notEqual(cyclic.userData.meshById.get('a').parent,cyclic.userData.meshById.get('b').parent?.parent,
  'Impossible parent cycle is not created');
console.log('Statue Author scripts, material sharing, direct furniture import, parent chains and cycle guard passed.');
