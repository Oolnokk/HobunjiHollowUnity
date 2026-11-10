#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const assetIndex=path.join(root,'docs/config/statue-author-asset-index.json');
const data=JSON.parse(fs.readFileSync(assetIndex,'utf8'));
assert.equal(data.schema,'hobunji_statue_asset_index.v1');
const pngs=folder=>fs.readdirSync(path.join(root,'docs/assets',folder),{withFileTypes:true})
  .filter(entry=>entry.isFile()&&entry.name.toLowerCase().endsWith('.png'))
  .map(entry=>entry.name).sort();
const materials=pngs('textures');
const sprites=pngs('toolsprites');
const names=list=>list.map(v=>v.name).sort();
const diff=(expected,actual)=>expected.length===actual.length&&expected.every((x,i)=>x===actual[i]);
if(process.argv.includes('--write')){
  const roles=new Map(data.textures.map(t=>[t.name,t.role]));
  data.textures=materials.map(name=>({name,role:roles.get(name)||'other'}));
  data.toolSprites=sprites.map(name=>({name,path:'assets/toolsprites/'+name}));
  fs.writeFileSync(assetIndex,JSON.stringify(data,null,2)+'\n');
}else{
  assert.ok(diff(materials,names(data.textures)),
    'Statue material index is out of date. Run node scripts/generate-statue-author-index.js --write.');
  assert.ok(diff(sprites,names(data.toolSprites)),
    'Statue weapon PNG index is out of date. Run node scripts/generate-statue-author-index.js --write.');
}
const spriteSet=new Set(data.toolSprites.map(sprite=>sprite.path));
for(const [shape,files] of Object.entries(data.shapeSprites)){
  assert.ok(files.length,shape+' needs a visible sprite');
  for(const file of files)assert.ok(spriteSet.has(file),'Missing indexed sprite for '+shape+': '+file);
}
console.log('PASS Statue Author repository indexes ('+materials.length+' textures, '+sprites.length+' sprites, '+Object.keys(data.shapeSprites).length+' bandit-shape mappings).');
