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
  assert.ok(def.placement.allowedZones.length === 1);
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

let festival = true, civilYear = 1156, shiftYear = 1156, currentZone = 'town', tileListener = null, saveCalls = 0; // Test calendar and movement are controlled without real-time timers.
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
  LocaleRiddleGenerator: Riddles, // The festival adapter consumes the same generator loaded by the browser script group.
  CalendarSystem: { aotYearNumber: () => civilYear },
  FestivalCalendar: { current: () => festival ? { id: 'five_blossoms' } : null },
  QuestProgressStore: { snapshot: () => progress, setStatus(id, status, fields) { saveCalls++; progress[id] = { status, progress: { ...progress[id]?.progress, ...fields } }; return true; } },
  PlayerTileEvents: { subscribe(listener) { tileListener = listener; return () => { if (tileListener === listener) tileListener = null; }; } },
  DevCompanion: { registerStateProvider() {} },
  GridTileAccessors: { getActiveScene: () => scene },
  FoliageGenerator: { buildPottedBlossomTreeMesh() { return { userData: {}, position: { set() {} }, scale: { multiplyScalar() {} } }; } },
  ClimbSystem: { groundYAt: () => 0 }
};
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/festival-blossom-hunt.js'), 'utf8'), vm.createContext({ window: world, console }));
const hunt = world.FestivalBlossomHunt; // Real browser namespace under test.
const deps = { _zoneLayouts: zones, getCurrentArea: () => currentZone, currentTothalYear: () => shiftYear, tothalWorldId: () => 'unit-world', showToast() {} }; // Same injection shape as WildernessMap.init.
hunt.bindQuestDeps({ getQuestProgress: () => progress });
hunt.init(deps);
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
festival = false;
hunt.update();
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].status, 'expired', 'unfinished hunt ends after festival week');
currentZone = 'map_northern_cliffs';
hunt.update();
assert.ok(hunt.debugSnapshot().displayedTrees.includes('locale_five_blossoms_cyan'), 'the tree remains a physical wilderness locale outside the festival');
assert.ok(saveCalls >= 8, 'every discovery and calendar transition saved progress');
assert.ok(hunt.debugSnapshot().present.every(item => item.stamped), 'all five quest locales are visible to runtime diagnostics');
console.log('Five Blossoms hunt: ' + poems + ' seeded riddles; five stamped locales; saved progress, reward lockout and expiry checked.');