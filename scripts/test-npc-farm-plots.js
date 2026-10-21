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

const field = { id: 'plot_a', label: 'Field', kind: 'till', tiles: [[5, 5], [6, 5]], crop: 'needlegrain', tillers: ['aliri', 'backup'], seeders: ['seedy'], harvesters: ['reaper'], hours: [8, 16] };
const trench = { id: 'plot_b', label: 'Trench', kind: 'dig', tiles: [[10, 10]], diggers: ['digger'] };
const plain = { id: 'plot_c', label: 'Plain', kind: 'till', tiles: [[20, 20]], tillers: [] };
api.registerMap('map_hobunji_town', [field, trench, plain]);

// Managed tiles start as grass; unassigned plots stay plain painted tiles.
assert.equal(api.isManagedTile('map_hobunji_town', 5, 5), true);
assert.equal(api.isManagedTile('map_hobunji_town', 10, 10), true);
assert.equal(api.isManagedTile('map_hobunji_town', 20, 20), false);
assert.equal(api.isManagedTile('map_hobunji_town', 1, 1), false);

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
assert.ok(claimant('aliri'));
assert.equal(claimant('backup'), null, 'backup idle while the primary is free');
date.npcId = 'aliri'; assert.ok(claimant('backup')); assert.equal(claimant('aliri'), null); date.npcId = null;
companions.add('aliri'); assert.ok(claimant('backup')); companions.clear();
spouse = { npcId: 'aliri' }; assert.ok(claimant('backup')); spouse = null;

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
process.exit(0);
