'use strict';
// Exercise the real KeyItemSystem, TrinketSystem and LichHeartSystem together, including interrupted save writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scripts = [
  'docs/js/key-item-system.js',
  'docs/js/trinket-system.js',
  'docs/js/lich-heart-system.js',
]; // Load-order contract from index.html and the Guild group manifest.
const profile = { characterId:'heroA', worldId:'worldA', gearInventory:{keyItems:[]} }; // Character and world identities change independently.
let meta = {
  characters:[{id:'heroA',gearInventory:{keyItems:[]}},{id:'heroB',gearInventory:{keyItems:[]}}],
  worlds:[{id:'worldA',keyItems:[]},{id:'worldB',keyItems:[]}],
}; // Canonical hobunjiSaveMeta schema, with two isolated save owners.
let writes = 0; // Repeated interactions must never rewrite the entire save unnecessarily.
let failSave = false; // Simulates storage failure to ensure that the physical pickup remains claimable.
const storage = {
  getItem:key => key === 'hobunjiSaveMeta' ? JSON.stringify(meta) : null,
  setItem:(key, value) => {
    if (failSave) throw Error('Simulated save failure');
    if (key === 'hobunjiSaveMeta') { meta = JSON.parse(value); writes++; }
  },
};
const document = { addEventListener(){}, getElementById:()=>null };
const messages = []; // Immediate HUD feedback is important for testers on mobile.
const window = {
  document, localStorage:storage, __hobunjiPlayerProfile:profile,
  Combat:{ deps:{ getGearInventory:()=>profile.gearInventory, saveGearInventory(){}, showToast:text=>messages.push(text) } },
}; // Production modules own all reward, save, and capacity behavior.
const context = vm.createContext({ window, document, console });
for (const path of scripts) vm.runInContext(fs.readFileSync(path,'utf8'), context, {filename:path});

const hearts = window.LichHeartSystem, keys = window.KeyItemSystem, trinkets = window.TrinketSystem;
assert.deepEqual(Object.values(hearts.HEARTS).map(heart=>heart.furnitureKey), ['flamingLichHeart','unsleepingLichHeart','sightlessLichHeart']);
assert.equal(trinkets.capacity(), 8);
assert.equal(hearts.count(), 0);
assert.equal(keys.definitionFor('azgarlu_lich_heart').scope, 'character');
assert.equal(keys.definitionFor('nanahi_lich_heart').scope, 'character');
assert.equal(keys.definitionFor('imlao_lich_heart').scope, 'character');
assert.equal(hearts.collect('unknown').ok, false);
assert.equal(hearts.collect('hronal').granted, true);
assert.equal(trinkets.capacity(), 9);
assert.equal(hearts.count(), 1);
assert.equal(meta.characters[0].gearInventory.keyItems.length, 1);
assert.equal(meta.worlds[0].keyItems.length, 0, 'hearts must never use world-key ownership');
const beforeRepeat = writes;
assert.equal(hearts.collect('hronal').granted, false);
assert.equal(writes, beforeRepeat, 'repeated pickups do not duplicate save writes or Attunement');
assert.equal(trinkets.capacity(), 9);
profile.worldId = 'worldB';
assert.equal(hearts.has('hronal'), true, 'heart follows the character between worlds');
assert.equal(trinkets.capacity(), 9);
profile.characterId = 'heroB';
profile.gearInventory = {keyItems:[]};
assert.equal(hearts.has('hronal'), false, 'a different character has its own Attunement');
assert.equal(trinkets.capacity(), 8);
failSave = true;
assert.equal(hearts.collect('kanthic').ok, false);
assert.equal(hearts.has('kanthic'), false, 'failed save leaves the heart unclaimed');
failSave = false;
assert.equal(hearts.collect('tothal').granted, true);
assert.equal(trinkets.capacity(), 9);
profile.characterId = 'heroA';
profile.gearInventory = {keyItems:[...meta.characters[0].gearInventory.keyItems]};
assert.equal(hearts.collect('tothal').granted, true);
assert.equal(hearts.collect('kanthic').granted, true);
assert.equal(trinkets.capacity(), 11);
assert.equal(hearts.count(), 3);
assert.equal(meta.worlds[0].keyItems.length, 0);
assert.equal(meta.worlds[1].keyItems.length, 0);
assert(messages.some(line=>line.includes('Attunement capacity +1')), 'pickup reports the permanent gain in game');

const guild = fs.readFileSync('docs/js/bootstrap/classic-groups/guild.js','utf8');
const bootstrap = fs.readFileSync('docs/js/dev-random-ruin-bootstrap.js','utf8');
const sanctum = fs.readFileSync('docs/js/dev-random-ruin-sanctum.js','utf8');
const sites = fs.readFileSync('docs/js/ruin-sites.js','utf8');
const furniture = fs.readFileSync('docs/js/dev-random-ruin-furniture-pieces.js','utf8');
assert(guild.includes('js/lich-heart-system.js?'), 'character reward registry must load in the actual game');
assert(bootstrap.includes('dev-random-ruin-sanctum.js?'), 'the reward composer must load in the actual game');
for (const heart of Object.values(hearts.HEARTS)) assert(furniture.includes("'" + heart.furnitureKey + "'"), heart.furnitureKey + ' should preload');
assert(sanctum.includes('syncLichHeart();'), 'the sanctum restores unclaimed hearts on boss victory and re-entry');
assert(sanctum.includes('s.heart?.control'), 'reward must be interactable through the existing prompt system');
assert(sanctum.includes('const result = window.LichHeartSystem?.collect?.(owner.bossType)'), 'save before removing the prop');
assert(sites.includes('unclaimedHeart&&!completeActiveRuinProgress'), 'uncollected hearts cannot permanently complete their tombs');
console.log('Lich-heart character save, collection, Attunement, failed writes and sanctum integration: PASS');
