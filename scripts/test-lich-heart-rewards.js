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
window.EquipmentPanel = {buildEquipmentSlots(){throw Error('Simulated Gear display failure');}}; // Presentation failure must not lose a character-owned reward.
window.Combat.deps.showToast = () => {throw Error('Simulated HUD toast failure');};
assert.equal(hearts.collect('tothal').granted, true,'saved ownership must succeed even when optional UI callbacks throw');
window.EquipmentPanel = null;
window.Combat.deps.showToast = text => messages.push(text);
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
// Drive the REAL sanctum composer through its defeated-boss pickup lifecycle with minimal Three.js stubs.
let composer = null; // Captures the shipped sanctum composer without constructing an entire procedural ruin.
let allowClaim = true; // Simulates persistence success/failure for a world pickup.
const collectedThemes = new Set(); // Distinct character-owned rewards drive removal and repeat-spawn gating.
const sceneGroups = []; // Tracks spawned authored furniture and parent cleanup in the fake scene.
let disposedHalos = 0; // Confirms per-instance GPU halo materials are released on collection and teardown.
let disposedDecals = 0; // Confirms per-instance decal mesh and material resources are released without touching shared textures.
const testRoot = { // Real THREE.Group's add/remove ownership contract used by the sanctum.
  children: [],
  add(child) { child.parent = this; this.children.push(child); },
  remove(child) { this.children = this.children.filter(item => item !== child); child.parent = null; },
};
const sceneWindow = {
  THREE: {}, DynamicSurfaces: {},
  DevRandomRuinSimplePuzzles: { registerComposer: value => { composer = value; } },
  DevRandomRuinConfig: { get:(_key, fallback)=>fallback },
  DevRandomRuin: { getSeed:()=>44 },
  RuinSites: { isActiveRuinBossDefeated:()=>true },
  DevRandomRuinFurniturePieces: {
    solid(key) {
      const group = {
        name:'', userData:{}, parent:null,
        position:{set(x,y,z){this.x=x;this.y=y;this.z=z;}},
        traverse(callback){callback(this);},
      }; // Full authored furniture construction is separately covered by test-lich-heart-furniture.js.
      group.userData.ruinFurnitureKey = key;
      group.userData.staticGlowEmitterVisuals = [{dispose(){disposedHalos++;}}];
      group.userData.authoredDecalMeshes = [{geometry:{dispose(){disposedDecals++;}},material:{dispose(){disposedDecals++;}}}];
      sceneGroups.push(group);
      return group;
    },
  },
  LichHeartSystem: {
    forType:theme=>hearts.forType(theme),
    has:theme=>collectedThemes.has(theme),
    collect:theme=>{
      if(!allowClaim) return {ok:false,granted:false,message:'Save failed'};
      const granted = !collectedThemes.has(theme);
      collectedThemes.add(theme);
      return {ok:true,granted};
    },
  },
};
vm.runInNewContext(sanctum, {window:sceneWindow, THREE:sceneWindow.THREE, console, document:{}}, {filename:'dev-random-ruin-sanctum.js'});
assert(composer, 'real sanctum composer registers');
const sanctumContext = { // Saved defeated authored tomb from the actual ruin progress adapter.
  specialBoss:true, hachutu:false, theme:'hronal', meta:{floorSurfaceY:2},
  sanctumPlan:{
    arena:{minX:10,maxX:24,minZ:10,maxZ:24},
    vault:{minX:26,maxX:33,minZ:14,maxZ:20},
  },
};
function loadSanctum(type='hronal', special=true) {
  composer.buildRooms({deps:{}},{...sanctumContext, theme:type, specialBoss:special},()=>.5,[],{});
  const state = sceneWindow.DevRandomRuinSanctum.getState();
  state.built = true; // Skip structural meshes and exercise only the fully shipped reward lifecycle.
  state.sanctumRoot = testRoot;
  state.bossType = type;
  return state;
}
let sanctumState = loadSanctum();
assert.equal(sanctumState.bossDefeated,true,'saved defeated boss restores when the tomb reloads');
composer.update({deps:{}},100,0.016);
assert.equal(testRoot.children.length,1,'saved victory spawns exactly one heart');
assert.equal(sanctumState.heart.furnitureKey,'flamingLichHeart');
assert.equal(sanctumState.heart.group.position.x,17,'heart is at the arena center X');
assert.equal(sanctumState.heart.group.position.y,2,'heart uses the sanctum floor elevation');
assert.equal(sanctumState.heart.group.position.z,17,'heart is at the arena center Z');
const control = composer.controls({}).find(item=>item.kind==='lichHeart');
assert(control && control.claimAction1 && control.promptRoot === sanctumState.heart.group,'heart uses the real in-world Action 1 interaction pipeline');
assert.equal(control.floorY,2,'the relic prompt is floor-gated in stacked ruins');
composer.update({deps:{}},101,0.016);
assert.equal(sceneGroups.length,1,'per-frame updates cannot duplicate pickups');
allowClaim = false;
assert.equal(control.onPress(),false,'a failed save never claims the relic');
assert.equal(testRoot.children.length,1,'failed save leaves the original heart in the world');
assert.equal(disposedHalos,0,'failed pickup leaves its glowing furniture resources intact');
allowClaim = true;
assert.equal(control.onPress(),true,'successful interaction claims the heart');
assert.equal(testRoot.children.length,0,'claimed heart is removed from the world');
assert.equal(disposedHalos,1,'claim releases its authored glow halo without touching shared textures');
assert.equal(disposedDecals,2,'claim releases its per-instance decal material and geometry');
assert.equal(composer.controls({}).some(item=>item.kind==='lichHeart'),false,'collected heart interaction disappears');
assert.equal(control.onPress(),false,'stale input cannot duplicate a collected reward');
composer.update({deps:{}},102,0.016);
assert.equal(testRoot.children.length,0,'owned heart does not respawn on later updates');
sanctumState = loadSanctum();
composer.update({deps:{}},103,0.016);
assert.equal(testRoot.children.length,0,'owned heart does not return after reentering the saved tomb');
sanctumState = loadSanctum('tothal');
composer.update({deps:{}},104,0.016);
assert.equal(sanctumState.heart?.furnitureKey,'unsleepingLichHeart','Nanahi receives the distinct authored reward');
composer.clear();
assert.equal(disposedHalos,2,'ruin teardown releases the unclaimed heart halo');
sanctumState = loadSanctum('kanthic');
composer.update({deps:{}},105,0.016);
assert.equal(sanctumState.heart?.furnitureKey,'sightlessLichHeart','Imlao receives the distinct authored reward');
composer.clear();
assert.equal(disposedHalos,3,'all three named heart effects are cleaned up on exit');
sanctumState = loadSanctum('tothal',false);
composer.update({deps:{}},106,0.016);
assert.equal(sanctumState.heart,undefined,'ordinary liches must not spawn authored hearts');

console.log('Lich-heart character save, collection, Attunement, failed writes and sanctum integration: PASS');
