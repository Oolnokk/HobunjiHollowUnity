#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Used by CI/local runs to resolve this checked-out branch.
const wildlifeSource = fs.readFileSync(path.join(ROOT, 'docs/js/wildlife-spawn.js'), 'utf8'); // Runtime under behavioral test below.
const denVisualSource = fs.readFileSync(path.join(ROOT, 'docs/js/zone-den-totem-features.js'), 'utf8'); // Guards the requested one-third collapsed cave presentation.
const gridSource = fs.readFileSync(path.join(ROOT, 'docs/js/grid-tile-accessors.js'), 'utf8'); // Guards removal of the usable collapsed doorway.
const porakanekiSource = fs.readFileSync(path.join(ROOT, 'docs/js/porakaneki-camps-runtime.js'), 'utf8'); // Guards den-hunting AI against stale/moved sites.
const debugSource = fs.readFileSync(path.join(ROOT, 'docs/js/wildlife-debug-panel.js'), 'utf8'); // Mobile-visible lifecycle diagnostics.

assert.match(denVisualSource, /den\.collapsed \? scaleY \/ 3 : scaleY/, 'collapsed cave facade must render at one-third normal Y scale');
assert.match(denVisualSource, /function syncAnimalDenVisual\(/, 'den facade/furniture must have a runtime relocation synchronizer');
assert.match(gridSource, /if \(den\.collapsed\)[\s\S]*?return true/, 'collapsed den footprint must close its former doorway gap');
assert.match(porakanekiSource, /filter\(den => den && den\.id != null && !den\.collapsed\)/, 'Porakaneki hunting routes must exclude collapsed dens');
assert.match(porakanekiSource, /const liveTarget = denExteriorPoint\(camp, liveDen\)/, 'Porakaneki active parties must refresh a relocated den target');
assert.match(debugSource, /Den Turnover/, 'Wildlife debug panel must expose den turnover on mobile');

const zoneId = 'map_northern_cliffs';
const den = { id:'animalDen_0', x:5, y:5, w:3, h:3, mouthAnchor:{x:6,y:8} };
const tiles = [];
for (let r=0;r<60;r++) for (let c=0;c<60;c++) tiles.push({ c, r, type:'grass', elevTier:0 });
const tileAt = (c,r) => tiles.find(tile => tile.c===c && tile.r===r);
for (let r=den.y;r<den.y+den.h;r++) for (let c=den.x;c<den.x+den.w;c++) {
  const tile=tileAt(c,r); tile.type='rock'; tile.generatedObjectId=den.id; tile.generatedObjectType='animalDen';
}
const layout = {
  cols:60, rows:60, tiles,
  dens:[den], rootTotems:[], localeInstances:[], buildings:[],
  foliagePatches:[], ambushStations:[],
  transitions:[{ id:'den_animalDen_0_enter', label:'A dark burrow', col:6, row:8, target:'building', targetMapId:'map_i_den_map_northern_cliffs_animalDen_0' }],
};

let currentArea = 'map_i_den_map_northern_cliffs_animalDen_0'; // Starts inside the den so collapse must wait for exit.
let genotypeRoll = 0; // Used to prove a relocated bloodline survives cache invalidation/reload-style restoration.
let rngState = 0x12345678; // Deterministic relocation sampling gives this regression stable behavior.
const rnd = () => ((rngState = (Math.imul(rngState,1664525)+1013904223)>>>0) / 0x100000000);
const storage = new Map(); // Browser localStorage stand-in used to verify same-year den persistence.
const toasts = [];
const logs = [];
const visualSync = [];
const rebuiltChunks = [];
const hostiles = new Set();
const denNests = new Map();
const buildingScenes = new Map();
const creatureDeathCalls = [];

const localStorage = {
  getItem(key){ return storage.has(key) ? storage.get(key) : null; },
  setItem(key,value){ storage.set(key,String(value)); },
  removeItem(key){ storage.delete(key); },
};

const windowStub = {
  __hobunjiPlayerProfile:{ worldId:'world-den-test', playerId:'player-den-test' },
  CalendarSystem:{ yearNumber:()=>3 },
  SCRATCHBONES_CONFIG:{ game:{ wildlife:{ nestClutch:{ min:2,max:4 } } } },
  CreatureGenetics:{
    SPECIES_ALIAS:{ 'gar-wolf':'gar-wolf', 'gar-wolf-den-mother':'gar-wolf' },
    makeDefaultGenotype(){
      genotypeRoll++;
      return { sizeClass:'medium', base:{ color:'#'+String(genotypeRoll).padStart(6,'0'), copies:2, inheritance:'dominant' } };
    },
  },
  CreatureGeneticsRender:{ SPECIES:{ 'gar-wolf':{} } },
  WildernessMapGenerator:{
    makeRng(seed){
      let h=2166136261;
      for(const ch of String(seed)) h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;
      return ()=>((h=(Math.imul(h,1664525)+1013904223)>>>0)/0x100000000);
    },
  },
  VoorgAssRegistration:{
    KIND:'voorg-ass', HERD_MOTHER_KIND:'voorg-ass-herd-mother',
    ensureCreatureDefs(){}, ensureRendererSpecies(){},
    ensureNorthernCliffsHerds(){ return { ready:true, zone:null, roaming:[] }; },
  },
  CreatureDeath:{
    begin(creature){ creatureDeathCalls.push(['begin',creature.id]); return true; },
    recover(creature){ creatureDeathCalls.push(['recover',creature.id]); return true; },
  },
  ZoneDenTotemFeatures:{
    syncAnimalDenVisual(scene, grid, liveDen, mapId){
      visualSync.push({ mapId, collapsed:!!liveDen.collapsed, x:liveDen.x, y:liveDen.y });
      return true;
    },
  },
  WildernessChunks:{
    rebuildZone(mapId,col,row){ rebuiltChunks.push({mapId,col,row}); },
  },
  BanditCamps:{ ensureCurrentZoneCamps(){} },
  ClimbSystem:{ debugBranchesFor(){ return []; } },
  __farmLog(message,channel){ logs.push({message,channel}); },
};

const creatureDb = {
  'gar-wolf':{ label:'Gar-wolf', hostile:true, diet:'carnivore', defaultSizeClass:'medium' },
};
const deps = {
  CREATURE_DB:creatureDb,
  EXTERIOR_ZONES:{ [zoneId]:{ packSpecies:['gar-wolf'], herbivoreSpecies:[], cols:60, rows:60 } },
  DEN_MOTHER_DEFS:{ 'gar-wolf':{ creatureKey:'gar-wolf-den-mother', nestItemKey:'garWolfBaby' } },
  DEN_MOTHER_ITEM_KEYS:new Set(['garWolfBaby']),
  TILE:32,
  TileType:{ RIVER:'river', STREAM:'stream' },
  zoneLayouts:new Map([[zoneId,layout]]),
  zoneScenes:new Map([[zoneId,{scene:{}}]]),
  hostileObjects:hostiles,
  denNests,
  buildingScenes,
  rnd,
  makeCreatureEntity(){ return null; },
  getCurrentArea:()=>currentArea,
  getCutscenePreviewActive:()=>false,
  _isZoneArea:id=>id===zoneId,
  buildZoneScene:id=>id===zoneId,
  showToast(message,danger){ toasts.push({message,danger}); },
  player:{ x:30*32, y:30*32 },
  calendar:{ day:14 },
};

const context = vm.createContext({
  window:windowStub, localStorage, console, Math, Map, Set, WeakSet, JSON,
  performance:{ now:()=>1000 },
});
vm.runInContext(wildlifeSource, context, { filename:'wildlife-spawn.js' });
windowStub.WildlifeSpawn.init(deps);

const cavernMapId = windowStub.WildlifeSpawn.denCavernMapId(zoneId,den.id);
assert.equal(cavernMapId,'map_i_den_map_northern_cliffs_animalDen_0');
layout.transitions[0].targetMapId=cavernMapId;
denNests.set(cavernMapId,{ remaining:2 });

const mother = { id:'mother', isDenMother:true, areaId:cavernMapId, health:0, def:{hostile:true,diet:'carnivore'} };
const cavernAdd = { id:'inside-add', isDenMother:false, areaId:cavernMapId, health:20, def:{hostile:true,diet:'carnivore'}, denKey:windowStub.WildlifeSpawn.denKeyFor(zoneId,den), state:'chase' };
const exteriorAdd = { id:'outside-add', isDenMother:false, areaId:zoneId, health:20, def:{hostile:true,diet:'carnivore'}, denKey:windowStub.WildlifeSpawn.denKeyFor(zoneId,den), state:'chase' };
hostiles.add(cavernAdd); hostiles.add(exteriorAdd);

windowStub.CreatureDeath.begin(mother);
assert.equal(creatureDeathCalls.length,1,'ordinary CreatureDeath.begin still executes');
let debug = windowStub.WildlifeSpawn.denTurnoverDebug(zoneId);
assert.equal(debug.length,1);
assert.equal(debug[0].stage,'cleared','Den-Mother death starts cleared stage without collapsing while player is inside');
assert.equal(debug[0].clutchLostOnExit,2,'debug state exposes uncollected clutch before exit');
assert.match(toasts.at(-1).message,/Collect the eggs or babies before you leave/i,'player gets explicit clutch warning');
for(const survivor of [cavernAdd,exteriorAdd]){
  assert.equal(survivor.wildlifeRole,'prey');
  assert.equal(survivor.denDisplacedPrey,true);
  assert.equal(survivor.def.hostile,false);
  assert.equal(survivor.def.diet,'herbivore');
  assert.equal(survivor.denKey,null,'displaced survivors no longer count as the replacement den population');
  assert.equal(survivor.state,'fleeing-low-health');
}

currentArea=zoneId;
windowStub.WildlifeSpawn.updateHostileSpawning(3);
debug=windowStub.WildlifeSpawn.denTurnoverDebug(zoneId);
assert.equal(debug[0].stage,'collapsed','first exterior wildlife tick collapses a cleared den');
assert.equal(debug[0].daysRemaining,2);
assert.equal(den.collapsed,true);
assert.equal(layout.transitions.some(t=>t.targetMapId===cavernMapId),false,'collapsed den removes its entrance transition');
assert.equal(denNests.has(cavernMapId),false,'uncollected clutch is discarded once collapse executes');
assert(visualSync.some(call=>call.collapsed),'collapse updates the existing cave visual');
assert.equal(genotypeRoll,0,'collapse itself does not invent a replacement bloodline');

windowStub.WildlifeSpawn.clearPendingDenRespawn();
debug=windowStub.WildlifeSpawn.denTurnoverDebug(zoneId);
assert.equal(debug[0].daysRemaining,1,'first new day advances collapse countdown once');
assert.equal(den.collapsed,true);

currentArea='map_hobunji_town';
windowStub.WildlifeSpawn.clearPendingDenRespawn();
debug=windowStub.WildlifeSpawn.denTurnoverDebug(zoneId);
assert.equal(debug[0].stage,'active','second new day relocates the den while its zone is safely inactive');
assert.equal(debug[0].generation,1);
assert.equal(den.collapsed,false);
assert(Math.hypot(den.x-5,den.y-5)>=12,'replacement den visibly relocates away from the cleared site');
assert.equal(tileAt(5,5).type,'grass','old den rock overlay is restored to ordinary terrain');
assert.equal(tileAt(den.x,den.y).generatedObjectType,'animalDen','new den site receives the normal generated den overlay');
assert(layout.transitions.some(t=>t.targetMapId===cavernMapId && t.col===den.mouthAnchor.x && t.row===den.mouthAnchor.y),'relocated den restores its cavern transition at the new mouth');
assert(visualSync.some(call=>!call.collapsed && call.x===den.x && call.y===den.y),'relocation restores full-height cave visual at the new site');
assert(rebuiltChunks.length>=2,'old and new streamed terrain regions are rebuilt after relocation');

const firstGenotype = windowStub.WildlifeSpawn.getOrMakeDenGenotype(cavernMapId,'gar-wolf');
assert.equal(genotypeRoll,1,'newly relocated population rolls one fresh family genotype');
windowStub.WildlifeSpawn.forgetZoneDenState(zoneId);
const restoredGenotype = windowStub.WildlifeSpawn.getOrMakeDenGenotype(cavernMapId,'gar-wolf');
assert.deepEqual(restoredGenotype,firstGenotype,'relocated family genotype persists through cache invalidation/reload-style restoration');
assert.equal(genotypeRoll,1,'restoring relocated family does not reroll it');

assert(storage.size>0,'den turnover state is persisted per world');
assert(logs.some(entry=>/\[den-turnover\] collapsed/.test(entry.message)));
assert(logs.some(entry=>/\[den-turnover\] relocated/.test(entry.message)));

console.log('PASS Den-Mother clear -> loot warning -> prey survivors -> collapsed den -> two-day relocation -> persistent fresh bloodline');
