'use strict';
const assert = require('node:assert/strict'); // Regression assertions for repository-published starter motifs and collectible gates.
const fs = require('node:fs'); // Loads the actual runtime library rather than a mock reimplementation.
const vm = require('node:vm'); // Emulates the normal game globals without requiring a browser.
const path = require('node:path');
const docs = path.resolve(__dirname, '../docs'); // Authoritative manifest and library root.
const ids = ['blessed_blossom_balance','blessed_blossom_potential','blessed_blossom_rebirth','blessed_blossom_windswept','winding_roots']; // Only the new decorative presets should be free.
const index = JSON.parse(fs.readFileSync(path.join(docs,'config/patterns/index.json'),'utf8')); // Real repository index.
const repoEntries = index.patterns.map(entry => {
  const config = JSON.parse(fs.readFileSync(path.join(docs,entry.file),'utf8')); // Actual authored metadata including collectible/default status.
  return { id: config.id, label: config.name, collectible: config.collectible === true, availableByDefault: config.availableByDefault === true };
});
const pattern = id => ({ repoPatternId: id, motifUrl: 'https://example.invalid/' + id + '.png' }); // Minimal portable pattern fixture for cached URL lookups.
const context = { console, window: null, document: {createElement() {
  return { width:0,height:0,toDataURL:()=> 'data:image/png;base64,AA==',getContext:()=>({
    beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},closePath(){},
  }) }; // Built-in unlockable rune catalog is canvas-generated but does not require real pixels for this access test.
}}};
context.window = context;
context.RepoPatternLibrary = { listCached:()=>repoEntries, getCachedById:id=>repoEntries.some(e=>e.id===id)?pattern(id):null, load:async()=>repoEntries }; // Mirrors the cached repository API.
const gear = {patternLibrary:[],unlockedPatternIds:[]}; // Real mutable Gear inventory fixture for progression rules.
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(docs,'js/pattern-library.js'),'utf8'),context);
context.PatternLibrary.init({ getGearInventory:()=>gear, saveGearInventory(){} });
for(const id of ids){
  const entries=context.PatternLibrary.listAvailable().filter(entry=>entry.id===id);
  assert.equal(entries.length,1,id+': one entry immediately available');
  assert.equal(entries[0].source,'repo-default');
  assert.equal(context.PatternLibrary.getById(id).repoPatternId,id,id+': gameplay resolves motif geometry');
  assert.equal(context.PatternLibrary.owns(id),true,id+': existing ownership gate accepts defaults');
  assert.equal(context.PatternLibrary.unlock(id),false,id+': cannot create a fake collectible unlock');
  assert.equal(gear.unlockedPatternIds.length,0,id+': default does not write Gear progression');
}
const collectible=repoEntries.find(entry=>entry.collectible&&!entry.availableByDefault); // Existing ruin collectibles must stay hidden until obtained.
if(collectible){
  assert.equal(context.PatternLibrary.getById(collectible.id),null,'collectible repo pattern remains locked');
  assert(!context.PatternLibrary.listAvailable().some(e=>e.id===collectible.id));
  assert.equal(context.PatternLibrary.unlock(collectible.id),true,'ruin collectible can still unlock');
  assert(context.PatternLibrary.listAvailable().some(e=>e.id===collectible.id),'unlock grants access');
}
assert(!context.PatternLibrary.listAvailable().some(e=>e.id==='chevron'),'built-in reward rune is still locked');
assert.equal(context.PatternLibrary.unlock('chevron'),true,'old rune unlock remains functional');
assert(context.PatternLibrary.getById('chevron')?.motifDataUrl,'old builtin reward returns its image');
console.log('Default pattern access, save isolation, and collectible gates passed');
