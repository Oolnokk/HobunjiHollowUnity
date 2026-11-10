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
const animationSource=fs.readFileSync(path.join(root,'docs/js/held-action-animations.js'),'utf8');
const animationBoundary=animationSource.indexOf('  // Shared direct-hand bootstrap.');
assert.ok(animationBoundary>0,'HeldActionAnimations public registry boundary missing');
const sourceContext={window:{}};
require('node:vm').runInNewContext(animationSource.slice(0,animationBoundary)+'\n})();',sourceContext);
const animationPresets=Object.entries(sourceContext.window.HeldActionAnimations||{})
  .filter(([,entry])=>entry?.poses)
  .map(([id,entry])=>({id,label:entry.name||id,animation:{
    kind:entry.kind||'hobunji_held_action_animation',
    name:entry.name||id,style:entry.style||'sweep',poses:entry.poses
  }}));
assert.ok(animationPresets.length>=5,'HeldActionAnimations registry unexpectedly empty');
const names=list=>list.map(v=>v.name).sort();
const diff=(expected,actual)=>expected.length===actual.length&&expected.every((x,i)=>x===actual[i]);
if(process.argv.includes('--write')){
  const roles=new Map(data.textures.map(t=>[t.name,t.role]));
  data.textures=materials.map(name=>({name,role:roles.get(name)||'other'}));
  data.toolSprites=sprites.map(name=>({name,path:'assets/toolsprites/'+name}));
  data.animationPresets=animationPresets;
  fs.writeFileSync(assetIndex,JSON.stringify(data,null,2)+'\n');
}else{
  assert.ok(diff(materials,names(data.textures)),
    'Statue material index is out of date. Run node scripts/generate-statue-author-index.js --write.');
  assert.ok(diff(sprites,names(data.toolSprites)),
    'Statue weapon PNG index is out of date. Run node scripts/generate-statue-author-index.js --write.');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(data.animationPresets)),JSON.parse(JSON.stringify(animationPresets)),
    'Statue animations out of date. Run node scripts/generate-statue-author-index.js --write.');
}
const spriteSet=new Set(data.toolSprites.map(sprite=>sprite.path));
for(const [shape,files] of Object.entries(data.shapeSprites)){
  assert.ok(files.length,shape+' needs a visible sprite');
  for(const file of files)assert.ok(spriteSet.has(file),'Missing indexed sprite for '+shape+': '+file);
}
console.log('PASS Statue Author repository indexes ('+materials.length+' textures, '+sprites.length+' sprites, '+Object.keys(data.shapeSprites).length+' bandit-shape mappings).');
