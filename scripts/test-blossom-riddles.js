'use strict';
const assert = require('node:assert/strict'); // Checks the shipped module and quest flow without an actual WebGL scene.
const fs = require('node:fs'); // Reads the authored locale definitions and unmodified production scripts.
const path = require('node:path'); // Builds paths relative to this test for CI and local npm scripts.
const vm = require('node:vm'); // Runs browser-only seasonal quest code in an isolated fake window.

const ROOT = path.join(__dirname, '..'); // Used to resolve the same files served by the game.
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
const noWater = layoutFor('cyan'); // Missing preferred river may never produce a river clue.
const missing = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: noWater, instance: noWater.localeInstances[0], blossomName: 'Cyan Blossom' });
assert.equal(missing.ok, true);
assert.equal(missing.evidence.waterFound, false);
assert.equal(missing.facts.filter(f => f.kind === 'distance').length, 2, 'missing optional landmarks produce two measured map-boundary offsets');
const withWater = layoutFor('cyan');
withWater.tiles[23][26] = { type: 'stream' };
const present = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: withWater, instance: withWater.localeInstances[0], blossomName: 'Cyan Blossom' });
assert.equal(present.ok, true);
assert.equal(present.evidence.waterFound, true);
assert.ok(present.facts.some(f => f.kind === 'water'));
// The real Tothal zone fold stores tiles in a Map, not an object or 2D array.
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

let festival = true, civilYear = 1156, calendarReady = false, shiftYear = 1156, currentZone = 'town', tileListener = null, saveCalls = 0, treeBuilds = 0, protectedMeshCount = 0; // Integration tracks world-scene foliage's shared-geometry protection. // Test calendar and movement are controlled without real-time timers.
const progress = {}; // Member-owned quest records, just like QuestProgressStore.snapshot().
const zones = new Map(); // Generated zone layouts, each already containing its own real blossom locale.
const assignedZones = { cyan: 'map_northern_cliffs', white: 'map_western_slope', gold: 'map_eastern_mire', amber: 'map_southern_cloud_forest', rose: 'map_southern_cloud_forest' }; // Mirrors the quest adapter's five targets.
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
  ClimbSystem: { groundYAt: () => 0 }
};
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/festival-blossom-hunt.js'), 'utf8'), vm.createContext({ window: world, console }));
const hunt = world.FestivalBlossomHunt; // Real browser namespace under test.
const deps = { _zoneLayouts: zones, getCurrentArea: () => currentZone, currentTothalYear: () => shiftYear, tothalWorldId: () => 'unit-world', showToast() {} }; // Same injection shape as WildernessMap.init.
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