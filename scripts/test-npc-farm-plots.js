#!/usr/bin/env node
'use strict';

// Executes js/npc-farm-plots.js against stubbed game state (no browser): managed-tile detection, the lineup + backup rules,
// till → seed → grow → harvest and dig upkeep, rain filling dug tiles, silting, hours, targets and save/restore.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'docs');
const intervals = [];
const overrides = {};
const hour = { value: 10 };
const date = { npcId: null };
let spouse = null;
const companions = new Set();
const win = {
  SCRATCHBONES_CONFIG: { game: {} },
  CalendarSystem: { getHour: () => hour.value },
  NpcScheduling: { registerTargetOverride: (id, fn) => { overrides[id] = fn; return true; } },
  RomanceSystem: { isOnDateWith: id => date.npcId === id, getSpouse: () => spouse },
  NpcFollowing: { isCompanion: id => companions.has(id) },
  NpcPathfinding: { isNpcTileWalkable: () => true },
  ToolActivityStages: { toolKeyFor: () => 'pickshovel' },
};
win.window = win;
const context = vm.createContext({ window: win, console, setInterval: fn => { intervals.push(fn); return intervals.length; }, setTimeout: () => 0, Math, Date, Number, JSON, Set, Map, Object, Array, Infinity, performance: { now: () => Date.now() } });
vm.runInContext(fs.readFileSync(path.join(root, 'js/npc-farm-plots.js'), 'utf8'), context, { filename: 'npc-farm-plots.js' });

const walkers = {};
let raining = false;
let saves = 0;
const api = win.NpcFarmPlots;
api.init({
  findWalker: id => walkers[id] || null, getCurrentArea: () => 'town', normalizeNpcArea: id => id === 'map_hobunji_town' ? 'town' : id,
  cropData: { needlegrain: { growDays: 3 } }, isRaining: () => raining, surfaceY: () => 0, getAreaScene: () => null, buildCropMesh: () => null,
  saveMemberWorldData: () => { saves += 1; },
});
const tick = intervals[0];

const field = { id: 'plot_a', label: 'Field', kind: 'till', tiles: [[5, 5], [6, 5]], crop: 'needlegrain', tillers: ['aliri', 'backup'], seeders: ['seedy'], harvesters: ['reaper'], hours: [8, 16], startWorked: false };
const trench = { id: 'plot_b', label: 'Trench', kind: 'dig', tiles: [[10, 10]], diggers: ['digger'], startWorked: false };
const plain = { id: 'plot_c', label: 'Plain', kind: 'till', tiles: [[20, 20]], tillers: [] };
api.registerMap('map_hobunji_town', [field, trench, plain]);

// Plots authored as already worked start that way (the painted look) until upkeep lapses.
api.registerMap('map_x', [{ id: 'plot_w', kind: 'till', tiles: [[1, 1]], crop: 'needlegrain', tillers: ['w'], hours: [0, 24] }]);
assert.equal(api._test.jobsFor(api.plots().find(p => p.id === 'plot_w'), 'w').length, 0, 'painted tiles start tilled');
api.registerMap('map_x', []);
api.registerMap('map_hobunji_town', [field, trench, plain]);
// Managed tiles start as grass; unassigned plots stay plain painted tiles.
assert.equal(api.isManagedTile('map_hobunji_town', 5, 5), true);
assert.equal(api.isManagedTile('map_hobunji_town', 10, 10), true);
assert.equal(api.isManagedTile('map_hobunji_town', 20, 20), false);
assert.equal(api.isManagedTile('map_hobunji_town', 1, 1), false);
api.registerMap('map_seed_only', [{ id: 'seeder_only', kind: 'till', crop: 'needlegrain', tiles: [[22, 22]], tillers: [], seeders: ['seedy'] }]);
assert.equal(api.isManagedTile('map_seed_only', 22, 22), true, 'plots with seeders but no tillers remain managed');
api.registerMap('map_seed_only', []);

const rec = id => ({ id });
const target = id => overrides['farm-plots'](rec(id));
walkers.aliri = { area: 'town', rec: rec('aliri'), root: { position: { x: 5.5, z: 7.5 } } };

// Only lineup NPCs get work, and only inside the plot's hours.
assert.equal(target('stranger'), null);
hour.value = 7; assert.equal(target('aliri'), null, 'before farming hours');
hour.value = 10;
let t = target('aliri');
assert.equal(t.area, 'town');
assert.equal(t.toolKey, 'bronzehoe');
assert.match(t.activity, /tilling/);
assert.ok(Math.abs(t.c - 5) <= 1 && Math.abs(t.r - 5) <= 1);
assert.equal(target('aliri').id, t.id, 'the claim is sticky between planner ticks');

// Do the till job (NPC stands at the spot).
walkers.aliri.root.position.x = t.c + 0.5; walkers.aliri.root.position.z = t.r + 0.5;
for (let i = 0; i < 12; i += 1) tick();
assert.equal(api.snapshot().debug.jobsDone, 1);
assert.ok(saves === 0, 'saves are debounced');

// Seeders / harvesters have their own jobs; a tilled tile with no seeder is simply left tilled.
assert.equal(target('seedy').activity, 'sowing seeds');
const tile = (id, c, r) => api._test.states()[id][`${c},${r}`];
const tilledKey = Object.entries(api._test.states().plot_a)[0][0].split(',').map(Number);
assert.equal(tile('plot_a', tilledKey[0], tilledKey[1]).tilled, true);

// Complete the seeding of that tile, then growth over days until ready, then harvest.
const plotObj = api.plots().find(p => p.id === 'plot_a');
const seedJob = api.snapshot().claims.find(c => c.npc === 'seedy'); // Claimed by the target() call above.
assert.equal(seedJob.job, 'seed');
api._test.applyJob(plotObj, { c: seedJob.c, r: seedJob.r, job: 'seed' });
assert.equal(tile('plot_a', seedJob.c, seedJob.r).crop, 'needlegrain');
assert.ok(target('seedy') === null || target('seedy').id !== `farm-seed-plot_a-${seedJob.c},${seedJob.r}`, 'the finished job is not re-issued'); // Also drops the stale claim.
assert.equal(api._test.pickJob('reaper', null), null, 'nothing to harvest yet');
win.__x = 0;
for (let d = 0; d < 3; d += 1) api.onNewDay();
assert.equal(tile('plot_a', seedJob.c, seedJob.r).ready, true);
const harvest = api._test.pickJob('reaper', null);
assert.equal(harvest.job, 'harvest');
api._test.applyJob(plotObj, { c: harvest.c, r: harvest.r, job: 'harvest' });
assert.equal(tile('plot_a', seedJob.c, seedJob.r).crop, '');

// Bare tilled soil that nobody sows overgrows after two days.
const other = [[5, 5], [6, 5]].find(([c, r]) => !(c === seedJob.c && r === seedJob.r));
api._test.applyJob(plotObj, { c: other[0], r: other[1], job: 'till' });
api.onNewDay(); api.onNewDay();
assert.equal(tile('plot_a', other[0], other[1]).tilled, false);

// Backups: the primary tiller is skipped while on a date, following you, or married to you.
const claimant = id => api._test.pickJob(id, null);
api.registerMap('map_hobunji_town', [field, trench, plain]); // fresh claims/state keep the same ids
assert.equal(api.snapshot().claims.some(c => c.plotId === 'plot_a'), false, 'reloading a map releases its old plot work claims');
assert.ok(claimant('aliri'));
assert.equal(claimant('backup'), null, 'backup idle while the primary is free');
date.npcId = 'aliri'; assert.ok(claimant('backup')); assert.equal(claimant('aliri'), null); date.npcId = null;
companions.add('aliri'); assert.ok(claimant('backup')); companions.clear();
spouse = { npcId: 'aliri' }; assert.ok(claimant('backup'), 'married town worker yields to backup outside visit window');
win.RomanceSystem.spouseTownVisitNow = id => id === 'aliri';
assert.ok(claimant('aliri'), 'married Ginju can work their original plot during an authorized town visit');
win.RomanceSystem.spouseTownVisitNow = () => false;
spouse = null;

// Dig plots: the player's dig animation; rain fills the trench and the water stays; rain can silt it back in.
walkers.digger = { area: 'town', rec: rec('digger'), root: { position: { x: 10.5, z: 12.5 } } };
const digTarget = target('digger');
assert.equal(digTarget.toolActivity, 'dig');
assert.equal(digTarget.toolFlip, true);
const digPlot = api.plots().find(p => p.id === 'plot_b');
api._test.applyJob(digPlot, { c: 10, r: 10, job: 'dig' });
assert.equal(tile('plot_b', 10, 10).dug, true);
assert.ok(!tile('plot_b', 10, 10).water);
raining = true; tick(); raining = false;
assert.equal(tile('plot_b', 10, 10).water, 1);
for (let i = 0; i < 5; i += 1) tick();
assert.equal(tile('plot_b', 10, 10).water, 1, 'the water stays after the rain stops');
const realRandom = Math.random; Math.random = () => 0; // Always silts.
api.onNewDay();
Math.random = realRandom;
assert.equal(tile('plot_b', 10, 10).dug, false, 'a rained-on trench silted in and needs redigging');
assert.equal(target('digger').toolActivity, 'dig', 'the digger gets the redig job');

// Save / restore round-trips tile state.
const saved = JSON.parse(JSON.stringify(api.serialize()));
api.restore(null);
assert.equal(Object.keys(api._test.states()).length, 0);
api.restore(saved);
assert.ok(tile('plot_a', seedJob.c, seedJob.r));

console.log('ok - npc farm plots');
// ── The player's farm: family plots work the real grid, seeds come from Farm Storage ────────────────────────────
const farm = { tiles: {}, storage: { needlegrainSeed: 1 }, jobs: [] };
const key = (c, r) => `${c},${r}`;
const farmTile = (c, r) => farm.tiles[key(c, r)] || (farm.tiles[key(c, r)] = { type: 'grass', crop: '', depth: 0 });
const farmApi = {
  farmTileInfo: (c, r) => {
    const t = farmTile(c, r);
    return { tilled: t.type === 'tilled', crop: t.crop, ready: false, dug: t.type === 'trench' && t.depth >= 0.6, canTill: t.type === 'grass' && !t.crop, canDig: !t.crop && (t.type === 'trench' ? t.depth < 1 : true) };
  },
  seedAvailable: crop => crop === 'needlegrain' && farm.storage.needlegrainSeed > 0,
  applyFarmJob: (job, c, r, crop) => {
    const t = farmTile(c, r);
    if (job === 'till') t.type = 'tilled';
    else if (job === 'dig') { t.type = 'trench'; t.depth = 1; }
    else if (job === 'seed') { if (!(farm.storage.needlegrainSeed > 0) || t.type !== 'tilled') return false; farm.storage.needlegrainSeed -= 1; t.crop = crop; }
    farm.jobs.push(job);
    return true;
  },
};
api.init({
  findWalker: id => walkers[id] || null, getCurrentArea: () => 'farm', normalizeNpcArea: id => id, cropData: { needlegrain: { growDays: 3 } }, isRaining: () => false,
  surfaceY: () => 0, getAreaScene: () => null, buildCropMesh: () => null, saveMemberWorldData() {}, ...farmApi,
});
api.registerFarmPlots([
  { id: 'fam_field', kind: 'till', tiles: [[2, 2], [3, 2]], crop: 'needlegrain', workers: ['spouse1', 'kid1'], hours: [8, 17] },
  { id: 'fam_trench', kind: 'dig', tiles: [[6, 6]], workers: ['kid1'], hours: [8, 17] },
  { id: 'fam_none', kind: 'till', tiles: [[9, 9]], workers: [] },
]);
spouse = { npcId: 'spouse1' };
hour.value = 10;
walkers.spouse1 = { area: 'farm', rec: rec('spouse1'), root: { position: { x: 2.5, z: 4.5 } } };
walkers.kid1 = { area: 'farm', rec: rec('kid1'), root: { position: { x: 6.5, z: 8.5 } } };
assert.equal(target('spouse1'), null, 'global plot override must not preempt family scheduling');
let fam = api.targetFor(rec('spouse1'), { familyOnly: true });
assert.ok(fam, 'a married spouse still works the family plots (unlike town hands)');
assert.equal(fam.area, 'farm');
assert.equal(api.targetFor(rec('stranger')), null);
assert.equal(target('kid1'), null, 'global plot override must not preempt child sleeping or vat work');
assert.equal(api.targetFor(rec('kid1'), { familyOnly: true }).toolActivity, 'dig', 'the child digs the trench group');
// Tick through: spouse tills both tiles, then seeds one (only one seed in storage), then has nothing more to do.
const claimFam = id => api.snapshot().claims.find(c => c.npc === id);
for (let step = 0; step < 6; step += 1) {
  const c = claimFam('spouse1') || (api.targetFor(rec('spouse1'), { familyOnly: true }), claimFam('spouse1'));
  if (!c) break;
  walkers.spouse1.root.position.x = c.standC + 0.5; walkers.spouse1.root.position.z = c.standR + 0.5;
  for (let i = 0; i < 10; i += 1) tick();
  api.targetFor(rec('spouse1'), { familyOnly: true });
}
assert.equal(farm.jobs.filter(j => j === 'till').length, 2);
assert.equal(farm.jobs.filter(j => j === 'seed').length, 1, 'only the one seed in storage is sown');
assert.equal(farm.storage.needlegrainSeed, 0);
assert.equal(api.targetFor(rec('spouse1'), { familyOnly: true }), null, 'no seeds left: nothing more to do');
// The spouse yields to a backup only while on a date / following you.
date.npcId = 'spouse1';
assert.equal(api.targetFor(rec('spouse1'), { familyOnly: true }), null);
date.npcId = null;
// Trenches silted below the threshold get redug.
farmTile(6, 6).type = 'trench'; farmTile(6, 6).depth = 0.3;
assert.equal(api.targetFor(rec('kid1'), { familyOnly: true }).toolActivity, 'dig');
assert.equal(api.targetFor(rec('stranger')), null);
console.log('ok - farm family plots');

// The player's farm editor must release assignments immediately when painting over a group.
context.document = { getElementById: () => null };
vm.runInContext(fs.readFileSync(path.join(root, 'js/farm-plot-editor.js'), 'utf8'), context, { filename: 'farm-plot-editor.js' });
const editor = win.FarmPlotEditor;
editor.init({ save() {}, cropLabel: crop => crop });
editor.restore([{ id: 'painted', kind: 'till', tiles: [[12, 12]], crop: 'needlegrain', workers: ['spouse1'], hours: [8, 17] }]);
assert.ok(api.plots().some(p => p.id === 'painted'), 'restored family plot exists in runtime');
editor.onTerrainPaint(12, 12, 'grass');
assert.equal(api.plots().some(p => p.id === 'painted'), false, 'erasing the last plot tile unassigns the live worker immediately');
console.log('ok - family plot editor live erase');
process.exit(0);
