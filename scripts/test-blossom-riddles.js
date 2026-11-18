'use strict';
const assert = require('node:assert/strict'); // Checks the shipped module and quest flow without an actual WebGL scene.
const fs = require('node:fs'); // Reads the authored locale definitions and unmodified production scripts.
const path = require('node:path'); // Builds paths relative to this test for CI and local npm scripts.
const vm = require('node:vm'); // Runs browser-only seasonal quest code in an isolated fake window.

const ROOT = path.join(__dirname, '..'); // Used to resolve the same files served by the game.
const Scenery = require('../docs/js/wilderness-landmark-scenery.js'); // Shared, independent year-round landmark plan used by both renderer and riddle clues.
const Riddles = require('../docs/js/locale-riddle-generator.js'); // Reusable UMD source is also valid CommonJS.
const locales = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/locales/index.json'), 'utf8')).locales; // All five authored targets must be indexed for Tothal Shift placement.
const ids = ['cyan', 'white', 'gold', 'amber', 'rose']; // Each target has its own standalone locale JSON and unique temple color.
function layoutFor(id, x = 23, y = 22) {
  const tiles = Array.from({ length: 70 }, () => Array.from({ length: 70 }, () => ({ type: 'grass' }))); // Seed-independent deterministic test terrain.
  const localeId = 'locale_five_blossoms_' + id; // Matches the generated instance key from production placement.
  const instance = { localeId, name: id + ' Blossom Tree', x: x - 1, y: y - 1, objects: [{ key: 'blossom-tree', x, y }] }; // Object coordinates, rather than origin, define the target location.
  return { cols: 70, rows: 70, tiles, localeInstances: [instance] };
}
for (const id of ids) {
  const entry = locales.find(x => x.id === 'locale_five_blossoms_' + id);
  assert.ok(entry, id + ' is indexed as a locale');
  const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/' + entry.file), 'utf8'));
  assert.equal(def.category, 'story_poi');
  assert.equal(def.objects[0].key, 'blossom-tree');
  assert.equal(def.objects[0].collision.mode, 'custom', 'tree trunk has a solid collision footprint');
  assert.ok(def.objects[0].collision.w > 0 && def.objects[0].collision.w <= 0.5, 'trunk collider stays narrower than the authored tree locale');
  assert.ok(def.placement.allowedZones.length === 1);
  assert.ok(!def.placement.allowedZones.includes('map_eastern_mire'), 'Feast blossoms must not stamp into the Eastern Mire');
  if (id === 'gold') assert.deepEqual(def.placement.allowedZones, ['map_western_slope'], 'Gold Blossom moved west but remains the third quest target');
  assert.equal(def.placement.shiftGeneratedSecret, true, 'new Tothal year hides the newly relocated target until rediscovery');
  assert.ok(Object.values(def.terrainAnchors).every(rule => rule.strength === 'preferred'), 'terrain is preferential, never mandatory');
}
let poems = 0; // Counts tested deterministic rhyme variants for regression output.
for (let i = 0; i < 400; i++) {
  const map = layoutFor('cyan', 20 + i % 28, 19 + i % 30);
  if (i % 2 === 0) map.tiles[24 + i % 20][20 + i % 28] = { type: 'river' };
  if (i % 3 === 0) map.tiles[23 + i % 20][23 + i % 28] = { type: 'path' };
  if (i % 5 === 0) map.rootTotems = [{ x: map.localeInstances[0].objects[0].x + 8, y: map.localeInstances[0].objects[0].y + 4 }];
  const options = { zoneId: 'map_northern_cliffs', layout: map, instance: map.localeInstances[0], blossomName: 'Cyan Blossom', seed: String(i) };
  const output = Riddles.generate(options);
  assert.equal(output.ok, true, 'riddle succeeds without relying on requested terrain: ' + i);
  assert.equal(Riddles.validate(output), true);
  assert.ok(output.stanzas.length <= 2, 'new poems avoid repetitive three-stanza scavenger verses');
  assert.ok(output.text.includes('Cyan Blossom'), 'final stanza names the tree');
  assert.ok(output.text.includes('Northern Cliffs'), 'first stanza names the broad zone');
  assert.equal(output.text, Riddles.generate(options).text, 'riddles stay deterministic after save/reload');
  assert.ok(output.facts.every(fact => fact.source !== 'requested-terrain'), 'poem only states verified facts');
  poems++;
}
// Riddles describe real places only: never imply a sunrise, moon phase, specific hour or countable map coordinates.
const forbiddenTiming = /\\b(?:night|tonight|daylight|morning|evening|sunrise|sunset|dusk|dawn|midnight|noon|stars|moonlight|shadows|fading light|final light)\\b/i; // The quest calendar owns the deadline; a poem never owns an hour.
const forbiddenCounting = /\\b\\d+\\s+(?:map\\s+)?tiles?\\b|\\b(?:count|measure)\\s+\\d+\\b/i; // Walking exact map-tile distances is not a treasure riddle.
for (let seed = 0; seed < 400; seed++) {
  const candidate = Riddles.generate({ zoneId:'map_northern_cliffs', layout:layoutFor('cyan'), instance:layoutFor('cyan').localeInstances[0], blossomName:'Cyan Blossom', seed:'timing-audit-'+seed });
  assert.equal(candidate.ok, true);
  assert.doesNotMatch(candidate.text, forbiddenTiming, 'random poems contain no false time-of-day conditions');
  assert.doesNotMatch(candidate.text, forbiddenCounting, 'random poems contain no numeric grid-instruction clues');
}
// Expanded ABAB bank: phonetic variety and registered-landmark specificity.
const coveredFamilies = new Set(); // Tracks exercised terminal sounds.
const coveredLandmarks = new Set(); // Tracks independently sourced scenery categories.
for (let seed = 0; seed < 1200; seed++) {
  const layout = layoutFor('cyan');
  layout.tiles[24][25] = { type:'stream' };
  layout.tiles[24][26] = { type:'path' };
  layout.tiles[25][27] = { type:'rock', rockKind:'undiggableBoulder', boulderId:'verified-rock' };
  const sample = [
    { name:'a stone cairn', kind:'stoneCairn', point:{col:30,row:25}, source:'generated-year-round-scenery' },
    { name:'a broken stone pillar', kind:'brokenPillar', point:{col:30,row:29}, source:'generated-year-round-scenery' },
    { name:'a dead tree', kind:'deadTree', point:{col:25,row:31}, source:'generated-year-round-scenery' },
    { name:'a cliff door', kind:'cliffDoor', point:{col:16,row:24}, source:'registered-cliff-door' },
    { name:'the root totem', kind:'rootTotem', point:{col:21,row:32}, source:'generated-root-totem' },
    { name:'a wild animal den', kind:'animalDen', point:{col:34,row:20}, source:'generated-animal-den' }
  ];
  const offset = seed % sample.length;
  const poem = Riddles.generate({zoneId:'map_northern_cliffs',layout,instance:layout.localeInstances[0],targetName:'Cyan Blossom',targetKind:'blossom',
    landmarks:[sample[offset],sample[(offset+1)%sample.length]],seed:'expanded-'+seed});
  assert.equal(poem.ok,true,'all expanded seeded poems rhyme: '+seed);
  assert.equal(poem.evidence.landmarkCount,2,'two distinct real landmarks can triangulate the target');
  for(const landmark of poem.facts.filter(f=>f.kind==='landmark'))coveredLandmarks.add(landmark.flavor);
  assert.ok(poem.stanzas.length<=2);
  for(const stanza of poem.stanzas){
    const endings=stanza.map(line=>line.replace(/[.,;!?]+$/,'').trim().split(/\s+/).pop().toLowerCase());
    if(stanza.length===2){
      assert.notEqual(endings[0],endings[1],'closing couplet changes its ending word');
      assert.ok(Object.values(Riddles.RHYMES).some(bank=>bank.includes(endings[0])&&bank.includes(endings[1])),'closing couplet rhymes');
    } else {
      assert.notEqual(endings[0],endings[2],'A rhyme changes its ending word');
      assert.notEqual(endings[1],endings[3],'B rhyme changes its ending word');
    }
    for(const word of endings){
      const family=Object.keys(Riddles.RHYMES).find(name=>Riddles.RHYMES[name].includes(word));
      assert.ok(family,'every terminal must be in the sound bank');
      coveredFamilies.add(family);
    }
  }
  assert.doesNotMatch(poem.text,forbiddenTiming);
  assert.doesNotMatch(poem.text,forbiddenCounting);
}
assert.equal(coveredFamilies.size,10,'all ten phonetic families exercised');
assert.ok(['stoneCairn','brokenPillar','deadTree','cliffDoor','rootTotem','animalDen'].every(kind=>coveredLandmarks.has(kind)),'all registered landmark types represented');
// Anaphora is based on physical site identity, not merely on its noun or stanza position.
const twoCairns = layoutFor('cyan', 23, 22); // Two distinct locations of one landmark type expose article ambiguity.
const cairnSites = [
  {kind:'stoneCairn',name:'a stone cairn',point:{col:15,row:20},source:'generated-year-round-scenery'},
  {kind:'stoneCairn',name:'a stone cairn',point:{col:31,row:27},source:'generated-year-round-scenery'}
]; // Both are within the genuine nearby-scene search range.
for(let seed = 0; seed < 300; seed++){
  const options={zoneId:'map_northern_cliffs',layout:twoCairns,instance:twoCairns.localeInstances[0],
    targetKind:'blossom',targetName:'Cyan Blossom',landmarks:cairnSites,seed:'cairn-articles-'+seed};
  const output=Riddles.generate(options);
  assert.equal(output.ok,true,'same-type landmarks remain rhymable');
  const references=output.facts.filter(f=>f.kind==='landmark');
  assert.equal(references.length,2,'two distinct cairns are eligible as references');
  assert.equal(references[0].flavor,'stoneCairn');
  assert.equal(references[1].flavor,'stoneCairn');
  assert.notEqual(references[0].coordinate.col,references[1].coordinate.col,'distinct sites retain distinct coordinates');
  assert.match(output.stanzas[0][2],/\b(?:a|an) (?:stone cairn|crown of stacked stones|little tower of stones|pile of weathered stones)\b/,'first cairn gets an indefinite mention');
  assert.match(output.stanzas[0][3],/\banother (?:stone cairn|crown of stacked stones|little tower of stones|pile of weathered stones)\b/,'second separate cairn uses another');
  assert.match(output.stanzas[1][0],/\b(?:the|that) (?:stone cairn|crown of stacked stones|little tower of stones|pile of weathered stones)\b/,'return to the same first or second cairn uses a definite reference');
  assert.equal(output.text,Riddles.generate(options).text,'metaphors and articles remain deterministic across reloading');
  assert.equal(Riddles.validate(output),true,'anaphora does not disturb terminal rhyme words');
}
const mixedTypes = layoutFor('cyan', 23, 22); // A second kind should not be misidentified as another of the first.
const mixedVerse = Riddles.generate({zoneId:'map_northern_cliffs',layout:mixedTypes,instance:mixedTypes.localeInstances[0],
  targetName:'Cyan Blossom',targetKind:'blossom',landmarks:[
    {kind:'stoneCairn',name:'a stone cairn',point:{col:15,row:20},source:'generated-year-round-scenery'},
    {kind:'deadTree',name:'a dead tree',point:{col:31,row:27},source:'generated-year-round-scenery'}
  ],seed:'two-distinct-types'});
assert.equal(mixedVerse.ok,true);
assert.doesNotMatch(mixedVerse.stanzas[0][3],/\banother\b/,'a different landmark category starts its own first mention');
const oneDen = layoutFor('cyan', 23, 22); // Previously duplicated "a wild animal den" incorrectly implied two dens.
const denPoem = Riddles.generate({zoneId:'map_northern_cliffs',layout:oneDen,instance:oneDen.localeInstances[0],
  targetName:'Cyan Blossom',targetKind:'blossom',landmarks:[
    {kind:'animalDen',name:'a wild animal den',point:{col:30,row:28},source:'generated-animal-den'},
    {kind:'deadTree',name:'a dead tree',point:{col:29,row:23},source:'generated-year-round-scenery'}
  ],seed:'single-den-anaphora'});
assert.equal(denPoem.ok,true);
const denLine=denPoem.stanzas[0].find(line=>/\b(?:den|hollow|refuge|shelter)\b/i.test(line));
assert.ok(denLine,'animal den is present in the generated clue');
assert.match(denPoem.stanzas[1][0],/\b(?:the|that) (?:wild animal den|beast’s hollow|creature’s refuge|animal shelter)\b/,'revisiting a previously identified den never implies a second den');

// Empty landscapes must never borrow a physical landmark simply to finish a rhyme.
for (let seed = 0; seed < 400; seed++) {
  const zone = layoutFor('cyan');
  const verse = Riddles.generate({zoneId:'map_northern_cliffs',layout:zone,instance:zone.localeInstances[0],
    targetKind:'blossom',targetName:'Cyan Blossom',seed:'empty-landscape-'+seed});
  assert.equal(verse.ok,true);
  assert.doesNotMatch(verse.text,/\b(?:cairn|pillar|cliff door|landmark|boulder|river|trail|animal den|root totem)\b/i,
    'no terrain-specific nouns may appear when no such feature was inspected');
}
const conciseLayout = layoutFor('cyan'); // Verified landmark-only poems should end without duplicated filler.
const concisePoem = Riddles.generate({zoneId:'map_northern_cliffs',layout:conciseLayout,instance:conciseLayout.localeInstances[0],
  targetKind:'blossom',targetName:'Cyan Blossom',landmarks:[
    {name:'a dead tree',kind:'deadTree',point:{col:30,row:28}},
    {name:'a stone cairn',kind:'stoneCairn',point:{col:15,row:26}}
  ],seed:'short-tail-regression'});
assert.equal(concisePoem.ok,true);
assert.equal(concisePoem.stanzas.length,2);
assert.equal(concisePoem.stanzas[1].length,2,'the short ending is a rhymed couplet');
assert.equal((concisePoem.text.match(/Cyan Blossom/g)||[]).length,1,'do not repeat the target in a sparse ending');
const noWater = layoutFor('cyan'); // Missing preferred river may never produce a river clue.
const missing = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: noWater, instance: noWater.localeInstances[0], blossomName: 'Cyan Blossom' });
assert.equal(missing.ok, true);
assert.equal(missing.evidence.waterFound, false);
assert.equal(missing.facts.filter(f => f.kind === 'distance').length, 0, 'missing landmarks must not lead to numeric tile-count instructions');
// Year-round scenery must be deterministic, terrain-safe, distinct and visible to treasure riddles.
const sceneryWorld = layoutFor('cyan', 30, 30);
const landmarks = Scenery.planForLayout('map_northern_cliffs', sceneryWorld, 'unit-world:1156');
assert.ok(landmarks.length >= 6, 'dense year-round landmarks exist across a simple exterior zone');
assert.equal(landmarks, Scenery.planForLayout('map_northern_cliffs', sceneryWorld, 'unit-world:1156'), 'zone plan is cached and unchanged on revisit');
assert.notDeepEqual(landmarks, Scenery.planForLayout('map_northern_cliffs', sceneryWorld, 'unit-world:1157'), 'new Tothal cycle moves the scenery');
for (const landmark of landmarks) {
  assert.equal(sceneryWorld.tiles[landmark.point.row][landmark.point.col].type, 'grass');
  assert.ok(Math.hypot(landmark.point.col - 30, landmark.point.row - 30) >= 6, 'authored locale clearance remains intact');
  assert.ok(['stoneCairn','brokenPillar','deadTree'].includes(landmark.kind));
}
const cliffDoorClue = Riddles.generate({
  zoneId:'map_northern_cliffs', layout:layoutFor('cyan'), instance:layoutFor('cyan').localeInstances[0],
  targetObjectKey:'blossom-tree', targetKind:'blossom', targetName:'Cyan Blossom',
  landmarks:[{name:'a cliff door', point:{col:28,row:26}, source:'registered-cliff-door'}], seed:'cliff-door-example'
});
assert.equal(cliffDoorClue.ok, true);
assert.ok(cliffDoorClue.facts.some(f=>f.source==='registered-cliff-door'), 'only a registered, physically present cliff door becomes a clue');
assert.doesNotMatch(cliffDoorClue.text, forbiddenTiming);
assert.doesNotMatch(cliffDoorClue.text, forbiddenCounting);
const withBoulder = layoutFor('cyan');
withBoulder.tiles[25][27] = { type:'rock', rockKind:'undiggableBoulder', boulderId:'rockformation1' };
const boulderClue = Riddles.generate({zoneId:'map_northern_cliffs',layout:withBoulder,instance:withBoulder.localeInstances[0],blossomName:'Cyan Blossom',seed:'rock-clue'});
assert.equal(boulderClue.ok,true);
assert.equal(boulderClue.evidence.boulderFound,true,'solid boulder silhouette is eligible as a real terrain landmark');
assert.ok(boulderClue.facts.some(f=>f.source==='post-generation-boulder-tile'));
assert.doesNotMatch(boulderClue.text, forbiddenTiming);
const withWater = layoutFor('cyan');
withWater.tiles[23][26] = { type: 'stream' };
const present = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: withWater, instance: withWater.localeInstances[0], blossomName: 'Cyan Blossom' });
assert.equal(present.ok, true);
assert.equal(present.evidence.waterFound, true);
assert.ok(present.facts.some(f => f.kind === 'water'));
// The real Tothal zone fold stores tiles in a Map, not an object or 2D array.
const flat = layoutFor('cyan');
flat.tiles[22][26] = { type:'stream' };
flat.tiles = flat.tiles.flatMap((line,row)=>line.map((tile,col)=>({c:col,r:row,...tile}))); // Actual runtime _zoneLayouts also permits flat {c,r} records.
const fromFlat = Riddles.generate({zoneId:'map_northern_cliffs',layout:flat,instance:flat.localeInstances[0],blossomName:'Cyan Blossom'});
assert.equal(fromFlat.ok,true);
assert.equal(fromFlat.evidence.waterFound,true,'flat runtime tile records must expose real terrain');
const merged = layoutFor('cyan');
const target = merged.localeInstances[0];
merged.tiles[23][26] = { type: 'river' };
merged.tiles[24][25] = { type: 'path' };
merged.tiles = new Map(merged.tiles.flatMap((row, y) => row.map((tile, x) => [x + ',' + y, tile])));
const fromMap = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: merged, instance: target, targetObjectKey: 'blossom-tree', blossomName: 'Cyan Blossom' });
assert.ok(fromMap.ok, 'real folded Map layout produces a clue');
assert.ok(fromMap.facts.some(f => f.kind === 'water'), 'Map-based river is not silently omitted');
assert.ok(fromMap.facts.some(f => f.kind === 'path'), 'Map-based path is not silently omitted');
const riverFact = fromMap.facts.find(f => f.kind === 'water');
assert.match(riverFact.value, /west of the river/, 'direction is expressed relative to the visible river, not the hidden tree');
const generic = { x: 1, y: 1, objects: [{ key: 'ornament', x: 2, y: 2 }, { key: 'quest-symbol', x: 20, y: 21 }] };
assert.equal(Riddles.positionOf(generic, 'quest-symbol').col, 20, 'another quest can select its own target object');
assert.equal(Riddles.positionOf(generic).col, 2, 'generic fallback does not depend on blossom-tree naming');
const genericPoem = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: layoutFor('cyan'), instance: layoutFor('cyan').localeInstances[0], targetName: 'the ancient obelisk', targetKind: 'target' });
assert.equal(genericPoem.ok, true, 'a completely unrelated quest can reuse the composer');
assert.match(genericPoem.text, /the ancient obelisk/);
assert.ok(genericPoem.stanzas.length <= 2, 'nonfestival quests use the same concise stanza grouping');
assert.doesNotMatch(genericPoem.text, /blossom|petals|flower|tree/i, 'unrelated quests do not inherit festival flavor text');

let festival = true, civilYear = 1156, calendarReady = false, shiftYear = 1156, currentZone = 'town', tileListener = null, saveCalls = 0, treeBuilds = 0, protectedMeshCount = 0;
const sampledHeights = []; // Checks the live tree altitude sampler's pixel-space contract, including plateau elevation. // Integration tracks world-scene foliage's shared-geometry protection. // Test calendar and movement are controlled without real-time timers.
const progress = {}; // Member-owned quest records, just like QuestProgressStore.snapshot().
const zones = new Map(); // Generated zone layouts, each already containing its own real blossom locale.
const assignedZones = { cyan: 'map_northern_cliffs', white: 'map_western_slope', gold: 'map_western_slope', amber: 'map_southern_cloud_forest', rose: 'map_southern_cloud_forest' }; // Mirrors the quest adapter's five targets.
for (let i = 0; i < ids.length; i++) {
  const id = ids[i], zone = assignedZones[id];
  if (!zones.has(zone)) zones.set(zone, layoutFor(id, 15 + 14 * (i % 2), 16 + 14 * (i % 2)));
  else zones.get(zone).localeInstances.push(layoutFor(id, 48, 44).localeInstances[0]);
}
const scene = { children: [], add(obj) { obj.parent = this; this.children.push(obj); }, remove(obj) { this.children = this.children.filter(x => x !== obj); obj.parent = null; } }; // Tracks visible foliage ownership/cleanup.
const world = {
  FestivalProps: { blossomWindowSwatches: [{ color:'#00ffff' }, { color:'#ff8000' }, { color:'#ffffff' }, { color:'#ffbf00' }, { color:'#ffb3b3' }] },
  LocaleRiddleGenerator: Riddles, // The festival adapter consumes the same generator loaded by the browser script group.
  CalendarSystem: { aotYearNumber: () => civilYear, isInitialized: () => calendarReady },
  FestivalCalendar: { current: () => festival ? { id: 'five_blossoms' } : null },
  QuestProgressStore: { snapshot: () => progress, setStatus(id, status, fields) { saveCalls++; progress[id] = { status, progress: { ...progress[id]?.progress, ...fields } }; return true; } },
  PlayerTileEvents: { subscribe(listener) { tileListener = listener; return () => { if (tileListener === listener) tileListener = null; }; } },
  DevCompanion: { registerStateProvider() {} },
  GridTileAccessors: { getActiveScene: () => scene },
  FoliageGenerator: { buildPottedBlossomTreeMesh() { treeBuilds++; return { userData: {}, position: { set() {} }, scale: { multiplyScalar() {} }, traverse(fn) { const mesh={geometry:{},userData:{}}; fn(mesh); if(mesh.userData.festivalSharedFoliage) protectedMeshCount++; } }; } },
  ClimbSystem: { groundYAt: (x,y) => { sampledHeights.push({x,y}); return 0; } }
};
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/festival-blossom-hunt.js'), 'utf8'), vm.createContext({ window: world, console }));
const hunt = world.FestivalBlossomHunt; // Real browser namespace under test.
const deps = { TILE: 64, _zoneLayouts: zones, getCurrentArea: () => currentZone, currentTothalYear: () => shiftYear, tothalWorldId: () => 'unit-world', showToast() {} }; // Same injection shape as WildernessMap.init.
hunt.bindQuestDeps({ getQuestProgress: () => progress });
hunt.init(deps);
hunt.update();
assert.equal(Object.keys(progress).length, 0, 'calendar initialization must precede quest writes and expirations');
calendarReady = true;
hunt.update();
const questId = 'five_blossoms_wilderness_hunt:1156';
assert.equal(progress[questId]?.status, 'active', 'festival automatically starts the world-member quest');
for (const id of ids) {
  currentZone = assignedZones[id];
  const instance = zones.get(currentZone).localeInstances.find(x => x.localeId.endsWith(id));
  const target = Riddles.positionOf(instance);
  assert.ok(tileListener, 'quest subscribes to player tile changes');
  tileListener({ to: { area: currentZone, col: target.col, row: target.row } });
  assert.ok(progress[questId].progress.found.includes(id), id + ' is found by walking to the actual locale tree');
}
assert.equal(progress[questId].status, 'completed');
assert.equal(progress[questId].progress.found.length, 5);
hunt.update();
assert.equal(progress[questId].status, 'completed', 'cannot claim the same annual five trees twice');
civilYear = 1157;
festival = true;
hunt.update();
assert.equal(progress['five_blossoms_wilderness_hunt:1157']?.status, 'active');
currentZone = 'map_southern_cloud_forest';
const roseInstance = zones.get(currentZone).localeInstances.find(item => item.localeId.endsWith('rose'));
const rosePoint = Riddles.positionOf(roseInstance, 'blossom-tree');
tileListener({ to: { area: currentZone, col: rosePoint.col, row: rosePoint.row } });
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].progress.found.join(','), 'rose', 'a tree found out of riddle order still counts');
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].progress.target, 'cyan', 'the active riddle remains the first still-unfound blossom');
tileListener({ to: { area: currentZone, col: rosePoint.col, row: rosePoint.row } });
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].progress.found.length, 1, 'the same tree cannot be awarded twice');
festival = false;
hunt.update();
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].status, 'expired', 'unfinished hunt ends after festival week');
currentZone = 'map_northern_cliffs';
hunt.update();
assert.ok(hunt.debugSnapshot().displayedTrees.includes('locale_five_blossoms_cyan'), 'the tree remains a physical wilderness locale outside the festival');
assert.equal(treeBuilds, 6, 'a revisited zone receives a fresh tree instance while shared source geometry remains cached by FoliageGenerator');
const northTree = Riddles.positionOf(zones.get('map_northern_cliffs').localeInstances[0], 'blossom-tree');
assert.ok(sampledHeights.some(p => p.x === (northTree.col + .5) * deps.TILE && p.y === (northTree.row + .5) * deps.TILE), 'tree floor is sampled in pixel-space, not map-tile coordinates');
assert.equal(protectedMeshCount, treeBuilds, 'every scene-local blossom clone protects shared GPU buffers during zone disposal');
assert.ok(saveCalls >= 8, 'every discovery and calendar transition saved progress');
assert.ok(hunt.debugSnapshot().present.every(item => item.stamped), 'all five quest locales are visible to runtime diagnostics');
const missingZone = zones.get('map_northern_cliffs');
zones.delete('map_northern_cliffs');
festival = true;
civilYear = 1158;
hunt.update();
assert.match(hunt.menuStatus().detail, /Northern Cliffs/, 'when a zone is not generated, the quest still names the zone to search');
zones.set('map_northern_cliffs', missingZone);

// The parser must not import a second unversioned terrain matcher after its versioned script has already installed.
const temporarySource = fs.readFileSync(path.join(ROOT, 'docs/js/temporary-locales.js'), 'utf8');
const writes = []; // Captures the actual browser parser-time loader output without a DOM.
const loaderContext = { window: { LocaleTerrainPlacement: {} }, document: { currentScript: { src: 'https://example.test/js/temporary-locales.js' }, write: html => writes.push(html) }, URL };
vm.runInNewContext(temporarySource, loaderContext);
assert.equal(writes.join('').includes('locale-terrain-placement.js'), false, 'existing terrain matcher is never overwritten by an unversioned duplicate');
assert.ok(writes.join('').includes('cloud-forest-runtime.js'), 'other parser-time locale dependencies still load');

console.log('Five Blossoms hunt: ' + poems + ' seeded riddles; five stamped locales; saved progress, reward lockout and expiry checked.');