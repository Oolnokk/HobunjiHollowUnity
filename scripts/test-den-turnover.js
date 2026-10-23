#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Used by CI/local runs to resolve this checked-out branch.
const wildlifeSource = fs.readFileSync(path.join(ROOT, 'docs/js/wildlife-spawn.js'), 'utf8'); // Runtime under behavioral test below.
const gameSource = fs.readFileSync(path.join(ROOT, 'docs/game.js'), 'utf8'); // Guards combat-state filtering for den-hidden/displaced residents.
const debugSource = fs.readFileSync(path.join(ROOT, 'docs/js/wildlife-debug-panel.js'), 'utf8'); // Mobile-visible lifecycle diagnostics.

assert.match(gameSource, /function isPlayerInCombat\(\)[\s\S]{0,240}!c\._denHidden[\s\S]{0,120}!c\.denDisplacedPrey/, 'hidden residents/displaced prey do not keep combat music active');
assert.match(debugSource, /Den Turnover/, 'lifecycle diagnostics remain available on mobile');

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
let forceRelocationFallback = false; // Forces the 700 random placement samples to fail so the exhaustive fallback scan is behaviorally covered.
const rnd = () => forceRelocationFallback ? 0 : ((rngState = (Math.imul(rngState,1664525)+1013904223)>>>0) / 0x100000000);
const storage = new Map([['hobunjiSaveMeta', JSON.stringify({ worlds:[{ id:'world-den-test' }] })]]); // Portable world metadata stand-in used to verify same-year/cloud-save-compatible den persistence.
const toasts = [];
const banners = []; // Captures the large cinematic title-card message requested on Den-Mother clear.
const logs = [];
const visualSync = [];
const rebuiltChunks = [];
const hostiles = new Set();
const denNests = new Map();
const buildingScenes = new Map();
const creatureDeathCalls = [];
const resetCaves = []; // Records resets of the cave contents when its old incarnation expires.
const corpseObjects = new Set(); // Renewal must purge dead mothers and bodies too.
const forgottenDenMarkers = []; // Captures the exact stable den key invalidated when the old physical entrance collapses.

const localStorage = {
  getItem(key){ return storage.has(key) ? storage.get(key) : null; },
  setItem(key,value){ storage.set(key,String(value)); },
  removeItem(key){ storage.delete(key); },
};

const windowStub = {
  __hobunjiPlayerProfile:{ worldId:'world-den-test', playerId:'player-den-test' },
  CalendarSystem:{ yearNumber:()=>3, tothalCycle:()=>3 },
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
  CaveSiteSystem:{ resetCave(mapId){ resetCaves.push(mapId); }, applyWorkspaceProfiles(){} },
  CreatureDeath:{
    begin(creature){ creatureDeathCalls.push(['begin',creature.id]); return true; },
    recover(creature){ creatureDeathCalls.push(['recover',creature.id]); return true; },
  },
  ZoneDenTotemFeatures:{
    syncAnimalDenVisual(scene, grid, liveDen, mapId){
      visualSync.push({ mapId, collapsed:!!liveDen.collapsed, pending:!!liveDen._collapsePresentationPending, x:liveDen.x, y:liveDen.y });
      return true;
    },
  },
  WildernessChunks:{
    rebuildZone(mapId,col,row){ rebuiltChunks.push({mapId,col,row}); },
  },
  BanditCamps:{
    ensureCurrentZoneCamps(){},
    forgetDenPerception(denKey){ forgottenDenMarkers.push(denKey); return true; },
    campInstances:new Map([[zoneId,[{ instance:{ site:{ x:20, y:20, w:7, h:7 } } }]]]),
  },
  PorakanekiCamps:{ occupiedSites(id){ return id === zoneId ? [{ x:31, y:18, w:7, h:7 }] : []; } },
  WildernessCampfire:{ serialize(){ return { mapId:zoneId, x:42.5, z:24.5 }; } },
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
  corpseObjects,
  denNests,
  buildingScenes,
  rnd,
  makeCreatureEntity(){ return null; },
  getCurrentArea:()=>currentArea,
  getCutscenePreviewActive:()=>false,
  _isZoneArea:id=>id===zoneId,
  buildZoneScene:id=>id===zoneId,
  showToast(message,danger){ toasts.push({message,danger}); },
  showZoneBanner(message){ banners.push(message); },
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
// Mirror buildZoneScene: the cached scene owns a COPIED transitions array
// (the pool checkTransitionSpots reads) plus a gold ring marker per spot.
const zoneSceneInfo = deps.zoneScenes.get(zoneId);
const denRing = { visible:true, position:{ set(x,y,z){ Object.assign(this,{x,y,z}); } }, userData:{ mapEditorRef:{ mapId:zoneId, kind:'spot', id:layout.transitions[0].id, col:6, row:8 } } };
zoneSceneInfo.transitions = [{ id:zoneId+'_exit', col:1, row:1, target:'town' }, ...layout.transitions];
zoneSceneInfo.scene.children = [denRing];
zoneSceneInfo.grid = [];
const initialGenotype = windowStub.WildlifeSpawn.getOrMakeDenGenotype(cavernMapId,'gar-wolf');
assert.equal(genotypeRoll,1,'first generation rolls one family genotype');
windowStub.WildlifeSpawn.forgetZoneDenState(zoneId);
const restoredInitialGenotype = windowStub.WildlifeSpawn.getOrMakeDenGenotype(cavernMapId,'gar-wolf');
assert.deepEqual(restoredInitialGenotype,initialGenotype,'an untouched generation-zero den keeps the same bloodline across cache invalidation/reload-style reconstruction');
assert.equal(genotypeRoll,1,'generation-zero restoration does not reroll the family');
denNests.set(cavernMapId,{ remaining:2, itemKey:'garWolfBaby', liveBirth:false, genotype:initialGenotype }); // Eggs remain real nest items until collapse; the exterior presentation intentionally shows their hatched baby forms.

const mother = { id:'mother', isDenMother:true, areaId:cavernMapId, health:0, def:{hostile:true,diet:'carnivore'} };
const cavernAdd = { id:'inside-add', creatureKey:'gar-wolf', isDenMother:false, areaId:cavernMapId, x:210, y:220, health:20, def:{hostile:true,diet:'carnivore'}, denKey:windowStub.WildlifeSpawn.denKeyFor(zoneId,den), state:'chase' };
const exteriorAdd = { id:'outside-add', creatureKey:'gar-wolf', isDenMother:false, areaId:zoneId, x:260, y:250, health:20, def:{hostile:true,diet:'carnivore'}, denKey:windowStub.WildlifeSpawn.denKeyFor(zoneId,den), state:'chase', _denHidden:true };
const malformedAdd = { id:'broken-add', isDenMother:false, areaId:zoneId, x:280, y:250, health:20, def:{}, denKey:windowStub.WildlifeSpawn.denKeyFor(zoneId,den), state:'chase' }; // Reproduces the identity-less survivor that previously surfaced as "undefined".
hostiles.add(cavernAdd); hostiles.add(exteriorAdd); hostiles.add(malformedAdd);

windowStub.CreatureDeath.begin(mother);
assert.equal(creatureDeathCalls.length,1,'ordinary CreatureDeath.begin still executes');
let debug = windowStub.WildlifeSpawn.denTurnoverDebug(zoneId);
assert.equal(debug.length,1);
assert.equal(debug[0].stage,'active','mother death does not start collapse or change discovery stage');
assert.equal(debug[0].motherDefeated,true,'killed mother is remembered independently of timer');
assert.equal(windowStub.WildlifeSpawn.denTurnoverStateForCavern(cavernMapId).motherDefeated,true,'cold reload can suppress only the defeated mother');
assert.equal(debug[0].entered,false,'killing alone does not start a cave timer');
assert.doesNotMatch(toasts.at(-1).message,/collapse after you leave|before you leave/,'obsolete exit warning is removed');
assert.equal(banners.at(-1),'DEN CLEARED');
for(const survivor of [cavernAdd,exteriorAdd]){
  assert.equal(survivor.wildlifeRole,'prey');
  assert.equal(survivor.denDisplacedPrey,true);
  assert.equal(survivor.def.hostile,false);
  assert.equal(survivor.def.diet,'herbivore');
  assert.equal(survivor.denKey,null,'displaced survivors no longer count as the replacement den population');
  assert.equal(survivor.denTurnoverOriginKey,windowStub.WildlifeSpawn.denKeyFor(zoneId,den));
  assert.equal(survivor.state,'idle','displaced prey cannot inherit a hostile chase\/search state');
  assert.equal(survivor._denHidden,false,'a resident displaced from an asleep den is made visible again');
  assert.equal(survivor.def.label,'Gar-wolf','canonical creature identity survives the displacement overlay');
  assert(survivor.genotype,'displaced resident keeps\/repairs a drawable family genotype');
}
assert.equal(hostiles.has(malformedAdd),false,'identity-less stale resident is discarded instead of becoming an undefined attacker');

// Unentered cave slots never acquire deadlines, even when midnight passes.
windowStub.WildlifeSpawn.advanceCaveMidnight(14);
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].daysRemaining,null);
const entry = windowStub.WildlifeSpawn.enterCave(cavernMapId,'Whispering Stone Cave');
assert.equal(entry.name,'Whispering Stone Cave');
assert.equal(entry.daysRemaining,2);
assert.equal(windowStub.WildlifeSpawn.enterCave(cavernMapId,'Changed Name').name,entry.name,'repeat entry preserves name/deadline');
denNests.get(cavernMapId).remaining = 1;
assert.equal(windowStub.WildlifeSpawn.updateDenClutchState(cavernMapId,denNests.get(cavernMapId)),true);
assert.equal(windowStub.WildlifeSpawn.denTurnoverStateForCavern(cavernMapId).clutch.remaining,1,'remaining clutch is persisted after collection');
currentArea=zoneId;
windowStub.WildlifeSpawn.onZoneEntered(zoneId);
assert.equal(den.collapsed,false,'exiting a killed den never collapses the entrance');
assert(layout.transitions.some(t=>t.targetMapId===cavernMapId),'entrance stays usable');
assert(denNests.has(cavernMapId),'remaining nest stays available after exit');
assert(hostiles.has(cavernAdd),'interior survivors remain until the timed reset');
assert.equal(resetCaves.length,0);
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.WildlifeSpawn.advanceCaveMidnight(15))),['Whispering Stone Cave will collapse in 2 days'],'first midnight STARTS the full two-day countdown');
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.WildlifeSpawn.advanceCaveMidnight(15))),['Whispering Stone Cave will collapse in 2 days'],'repeat calls cannot tick twice');
windowStub.WildlifeSpawn.clearPendingDenRespawn();
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].daysRemaining,2,'06:00 daily ecology does not charge a cave day');
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.WildlifeSpawn.advanceCaveMidnight(16))),['Whispering Stone Cave will collapse in 1 days']);
currentArea=cavernMapId;
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.WildlifeSpawn.advanceCaveMidnight(17))),['Whispering Stone Cave is about to collapse'],'deadline queues while inside the cave');
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].generation,0);
const siblingMapId=windowStub.WildlifeSpawn.denCavernMapId(zoneId,'animalDen_sibling'); // Any other cave on the same wilderness protects the pending cave too.
currentArea=siblingMapId;
windowStub.WildlifeSpawn.clearPendingDenRespawn();
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].generation,0);
currentArea=zoneId;
windowStub.WildlifeSpawn.onZoneEntered(zoneId);
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].generation,0,'walking on the wilderness keeps the expired cave accessible');
assert(layout.transitions.some(t=>t.targetMapId===cavernMapId));
currentArea='map_hobunji_town';
forceRelocationFallback=true;
corpseObjects.add(mother);
windowStub.WildlifeSpawn.onZoneEntered(currentArea);
debug=windowStub.WildlifeSpawn.denTurnoverDebug(zoneId);
assert.equal(debug[0].generation,1,'leaving the wilderness immediately collapses and relocates the queued cave');
assert.equal(debug[0].stage,'active');
assert.equal(debug[0].entered,false,'replacement is unexplored and has no timer');
assert.equal(debug[0].name,'Unexplored cave');
assert.equal(den.collapsed,false,'replacement is open immediately');
assert.equal(resetCaves.length,1,'cave contents reset exactly once');
assert.equal(hostiles.has(cavernAdd),false,'old interior residents are removed on reset');
assert.equal(corpseObjects.has(mother),false,'old mother corpse is removed on reset');
assert.equal(hostiles.has(exteriorAdd),true,'displaced exterior prey stays ordinary wildlife');
assert.deepEqual(forgottenDenMarkers,[windowStub.WildlifeSpawn.denKeyFor(zoneId,den)],'relocation forgets the old map marker and waypoint');
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.WildlifeSpawn.advanceCaveMidnight(18))),['Whispering Stone Cave has collapsed'],'next review reports an offscreen queued collapse by its old name');
assert.equal(windowStub.WildlifeSpawn.advanceCaveMidnight(19).length,0,'collapse report is not repeated on following days');
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].generation,1,'unexplored replacement never globally resets');
assert(Math.hypot(den.x-5,den.y-5)>=12,'replacement moves away from the old cave');
const relocatedRect = { x:den.x, y:den.y, w:den.w, h:den.h + 1 }; // Includes the new mouth row when checking live runtime occupancy clearance.
const overlaps = (a,b,margin=0) => a.x-margin < b.x+b.w && a.x+a.w+margin > b.x && a.y-margin < b.y+b.h && a.y+a.h+margin > b.y;
assert.equal(overlaps(relocatedRect,{x:20,y:20,w:7,h:7},3),false,'fallback relocation avoids a live bandit camp footprint');
assert.equal(overlaps(relocatedRect,{x:31,y:18,w:7,h:7},3),false,'fallback relocation avoids a live Porakaneki camp footprint');
assert.equal(overlaps(relocatedRect,{x:42,y:24,w:1,h:1},4),false,'fallback relocation avoids the persistent wilderness campfire');
assert.equal(tileAt(5,5).type,'grass','old den rock overlay is restored to ordinary terrain');
assert.equal(tileAt(den.x,den.y).generatedObjectType,'animalDen','new den site receives the normal generated den overlay');
assert(layout.transitions.some(t=>t.targetMapId===cavernMapId && t.col===den.mouthAnchor.x && t.row===den.mouthAnchor.y),'relocated den restores its cavern transition at the new mouth');
assert.equal(zoneSceneInfo.transitions.filter(t=>t.targetMapId===cavernMapId && t.col===den.mouthAnchor.x && t.row===den.mouthAnchor.y).length,1,'relocated entrance is live in the cached zone scene pool exactly once');
assert.equal(denRing.visible,true,'relocated den shows its entrance ring again');
assert.equal(denRing.position.x,den.mouthAnchor.x+0.5,'entrance ring moves to the relocated mouth');
assert(visualSync.some(call=>!call.collapsed && call.x===den.x && call.y===den.y),'relocation restores full-height cave visual at the new site');
assert(rebuiltChunks.length>=2,'old and new streamed terrain regions are rebuilt after relocation');

const firstGenotype = windowStub.WildlifeSpawn.getOrMakeDenGenotype(cavernMapId,'gar-wolf');
assert.equal(genotypeRoll,2,'newly relocated population rolls exactly one fresh family genotype');
assert.notDeepEqual(firstGenotype,initialGenotype,'relocation is the event that changes the den bloodline');
windowStub.WildlifeSpawn.forgetZoneDenState(zoneId);
const restoredGenotype = windowStub.WildlifeSpawn.getOrMakeDenGenotype(cavernMapId,'gar-wolf');
assert.deepEqual(restoredGenotype,firstGenotype,'relocated family genotype persists through cache invalidation/reload-style restoration');
assert.equal(genotypeRoll,2,'restoring relocated family does not reroll it');

const savedMeta = JSON.parse(storage.get('hobunjiSaveMeta'));
const savedTurnover = savedMeta.worlds.find(world=>world.id==='world-den-test')?.denTurnover;
assert.equal(savedTurnover?.year,3,'den turnover is stored inside the portable active-world save metadata');
assert(savedTurnover?.records?.length===1,'portable world metadata retains the den generation record');
assert(![...storage.keys()].some(key=>key.startsWith('hobunjiDenTurnoverV1:')),'den turnover must not escape the cloud/local-folder snapshot boundary into a device-only storage key');
assert(!logs.some(entry=>/\[den-turnover\] collapsed/.test(entry.message)),'no kill-triggered collapse path remains');
assert(logs.some(entry=>/\[den-turnover\] relocated/.test(entry.message)));

// A replacement gets its own first-entry timer and may expire without any mother kill.
deps.calendar.day=19;
windowStub.WildlifeSpawn.enterCave(cavernMapId,'Hidden Moon Cave');
currentArea='map_hobunji_town';
const deadline=windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].collapseMidnight;
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].motherDefeated,false);
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.WildlifeSpawn.advanceCaveMidnight(deadline))),['Hidden Moon Cave has collapsed'],'uncleared caves collapse and relocate at midnight offscreen');
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].generation,2);
// Reload the real owner against the portable save, then enter after civil midnight.
const reloadContext = vm.createContext({ window:windowStub, localStorage, console, Math, Map, Set, WeakSet, JSON, performance:{now:()=>1000} });
vm.runInContext(wildlifeSource, reloadContext);
windowStub.WildlifeSpawn.init(deps);
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].generation,2,'cold reload preserves the renewed generation');

const beforeColdCalendar = storage.get('hobunjiSaveMeta'); // Folder-transferred cave coordinates/genotypes must survive reads before calendar hydration.
const relocatedPosition = { x:den.x, y:den.y, mouthAnchor:{ ...den.mouthAnchor } }; // Physical entrance location expected beside a separately restored campfire.
windowStub.CalendarSystem.tothalCycle = () => 1;
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId).length,0,'default startup cycle does not expose a later cycle\'s cave records');
assert.equal(storage.get('hobunjiSaveMeta'),beforeColdCalendar,'early ecology/debug reads must not delete portable cave relocation records');
windowStub.CalendarSystem.tothalCycle = () => 3;
// Fresh generation on another device starts from the original seed's anchor.
den.x=5; den.y=5; den.mouthAnchor={x:6,y:8};
windowStub.WildlifeSpawn.forgetZoneDenState(zoneId);
assert.equal(den.x,relocatedPosition.x,'restored folder state moves the physical cave back to its saved x');
assert.equal(den.y,relocatedPosition.y,'restored folder state moves the physical cave back to its saved y');
assert.deepEqual(JSON.parse(JSON.stringify(den.mouthAnchor)),relocatedPosition.mouthAnchor,'restored physical entrance keeps its saved relationship to the campfire');
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].generation,2,'calendar hydration restores the relocated cave generation');
windowStub.CalendarSystem.getHour=()=>25;
deps.calendar.day=24;
windowStub.WildlifeSpawn.enterCave(cavernMapId,'After Midnight Cave');
assert.equal(windowStub.WildlifeSpawn.denTurnoverDebug(zoneId)[0].collapseMidnight,28,'01:00 entry waits until the following civil midnight to start');
windowStub.WildlifeSpawn.advanceCaveMidnight(26);
const reloadAgain = vm.createContext({ window:windowStub, localStorage, console, Math, Map, Set, WeakSet, JSON, performance:{now:()=>1000} });
vm.runInContext(wildlifeSource, reloadAgain);
windowStub.WildlifeSpawn.init(deps);
assert.equal(windowStub.WildlifeSpawn.denTurnoverStateForCavern(cavernMapId).name,'After Midnight Cave','cold reload keeps the discovered name');
assert.deepEqual(JSON.parse(JSON.stringify(windowStub.WildlifeSpawn.advanceCaveMidnight(26))),['After Midnight Cave will collapse in 2 days'],'cold reload cannot charge the same midnight twice');

// Legacy kill-triggered collapse saves retain the defeated mother without arming a timer.
const legacyMeta=JSON.parse(storage.get('hobunjiSaveMeta'));
const legacyTurnover=legacyMeta.worlds[0].denTurnover;
legacyTurnover.version=1;
Object.assign(legacyTurnover.records[0],{stage:'cleared',collapseEscapeVisual:{count:2}});
for (const key of ['name','enteredCivilDay','firstMidnight','collapseMidnight','reviewMidnight','reviewText']) delete legacyTurnover.records[0][key];
storage.set('hobunjiSaveMeta',JSON.stringify(legacyMeta));
const legacyContext=vm.createContext({window:windowStub,localStorage,console,Math,Map,Set,WeakSet,JSON,performance:{now:()=>1000}});
vm.runInContext(wildlifeSource,legacyContext);
windowStub.WildlifeSpawn.init(deps);
const migrated=windowStub.WildlifeSpawn.denTurnoverStateForCavern(cavernMapId);
assert.equal(migrated.stage,'active');
assert.equal(migrated.motherDefeated,true);
assert.equal(migrated.daysRemaining,null,'old kill-triggered timers are discarded');
assert.equal(migrated.clutch.remaining,2,'old uncollected clutch remains available');
assert.equal(windowStub.WildlifeSpawn.advanceCaveMidnight(40).length,0,'legacy mother defeat cannot expire an unentered cave');

console.log('PASS individual entry -> first midnight -> two full days -> protected cave/zone -> immediate relocation -> one-time report; uncleared expiry and persistent bloodlines');
