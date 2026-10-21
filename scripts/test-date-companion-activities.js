#!/usr/bin/env node
'use strict';

// Executes js/tool-activity-stages.js (the player's chop / mine / fish timelines NPCs now play) and
// js/date-companion-activities.js (a date joining your fishing, chopping, mining and plant picking)
// against stubbed game state — no browser.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'docs');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

process.on('unhandledRejection', () => {}); // held-action-animations.js kicks off an image bootstrap this test never needs.
const intervals = [];
const win = {
  SCRATCHBONES_CONFIG: { game: {} },
  setInterval: fn => { intervals.push(fn); return intervals.length; },
};
win.window = win;
const context = vm.createContext({ window: win, document: { currentScript: null, addEventListener() {} }, location: { href: 'http://localhost/' }, fetch: () => new Promise(() => {}), URL, Promise, Error, setTimeout: () => 0, clearTimeout() {}, parseFloat, isFinite, console, performance: { now: () => Date.now() }, setInterval: win.setInterval, Math, Date, Number, JSON, Set, Map, Object, Array });
const load = file => vm.runInContext(read(file), context, { filename: file });
['js/combat/shared-attack-pose.js', 'js/combat/attack-pose-templates.js', 'js/held-action-animations.js', 'config/romance-config.js', 'js/tool-activity-stages.js', 'js/date-companion-activities.js'].forEach(load);

// ── Stages: the same tables the player uses ─────────────────────────────
const TAS = win.ToolActivityStages;
assert.equal(TAS.CHOP_TREE_STAGES.length, 3);
assert.equal(JSON.stringify(TAS.CHOP_TREE_STAGES.map(s => s.dirSign)), '[1,-1,1]');
assert.equal(TAS.MINE_ROCK_STAGES.length, 3);
const out = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, bodyYaw: 0 };
for (const activity of ['chop', 'mine', 'dig', 'fish']) {
  const seen = new Set();
  for (let t = 0; t < TAS.loopSeconds(activity) * 1.5; t += 0.05) {
    const pose = TAS.poseAt(activity, t, out);
    assert.ok(pose, `${activity} pose at ${t}`);
    for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw']) assert.ok(Number.isFinite(pose[key]), `${activity}.${key} finite`);
    seen.add([pose.x, pose.z, pose.pitch, pose.yaw, pose.roll, pose.bodyYaw].map(v => v.toFixed(2)).join());
  }
  assert.ok(seen.size > 5, `${activity} actually animates`);
}
assert.equal(TAS.poseAt('chop', 0.55 + 0.3, out).dirSign, -1, 'second chop stage is the backhand');
assert.equal(TAS.poseAt('chop', 0.1, out).sweep, true);
assert.equal(TAS.poseAt('mine', 0.1, out).sweep, false);
assert.equal(TAS.poseAt('nope', 0, out), null);
// Speed scales the clock like the player's skill multiplier.
const slow = TAS.poseAt('mine', 0.2, { ...out }, 1).z;
const fast = TAS.poseAt('mine', 0.1, { ...out }, 2).z;
assert.ok(Math.abs(slow - fast) < 1e-9);

// ── DateCompanion ───────────────────────────────────────────────────────
const likes = { aliri_ginju: ['herb_picked'], tooth_hatayap: ['fish_caught'], nashka_khibu: ['tree_felled', 'rock_broken'] };
let date = null;
const scored = [];
const walker = { rec: { id: 'tooth_hatayap' }, area: 'town', root: { position: { x: 10.5, z: 10.5 } }, catchup: 1 };
win.RomanceSystem = {
  activeDate: () => date,
  likesFor: id => likes[id] || [],
  scoreCompanionLike: (id, opts) => { scored.push([id, opts?.line]); return 5; },
  helpers: { findWalker: () => walker, npcName: () => 'Tester', say() {} },
};
win.NpcPathfinding = { isNpcTileWalkable: (area, c, r) => !(c === 5 && r === 4) };
let player = { x: 5.5, z: 6.5 };
let fishing = null;
const picked = [];
win.Fishing = { get state() { return fishing; } };
win.HobunjiActivityEvents = { on() {} };
const api = win.DateCompanion;
api.init({
  getCurrentArea: () => 'town', normalizeNpcArea: a => a, getPlayerTilePosition: () => player, showToast() {},
  listPickables: () => [{ col: 8, row: 8, pick: () => { picked.push('herb'); return { ok: true }; } }, { col: 40, row: 40, pick: () => ({ ok: true }) }],
});
const tick = intervals[0];
const startDate = npcId => { date = { npcId, mode: 'follow', startHour: 100 }; walker.rec.id = npcId; };

// No date → nothing happens and buffs are zero.
tick(); api.onChargeStart({ tool: 'axe', col: 5, row: 5 });
assert.equal(api.snapshot().task, null);
assert.equal(api.buffStacks('foraging'), 0);

// Chopping: only dates who like trees/foraging join; they take another side and speed the hold once in position.
startDate('tooth_hatayap');
api.onChargeStart({ tool: 'axe', col: 5, row: 5 });
assert.equal(api.snapshot().task, null, 'a date who does not like woodcutting stays out');
startDate('nashka_khibu');
api.onChargeStart({ tool: 'axe', col: 5, row: 5 });
let task = api.snapshot().task;
assert.equal(task.kind, 'help');
assert.equal(task.target.toolActivity, 'chop');
assert.equal(task.target.toolKey, 'hatchet');
assert.ok(Math.abs(task.target.c - 5) <= 1 && Math.abs(task.target.r - 5) <= 1);
const approach = Math.atan2(player.z - 5.5, player.x - 5.5);
const spotAngle = Math.atan2(task.target.r + 0.5 - 5.5, task.target.c + 0.5 - 5.5);
let apart = Math.abs(spotAngle - approach); if (apart > Math.PI) apart = 2 * Math.PI - apart;
assert.ok(apart > Math.PI / 2, 'helper works the far side of the tree');
assert.ok(!(task.target.c === 5 && task.target.r === 4), 'never an unwalkable tile');
assert.equal(api.helpSpeedMultiplier('axe', 5, 5), 1, 'no speed-up until they arrive');
walker.root.position.x = task.target.c + 0.5; walker.root.position.z = task.target.r + 0.5;
tick();
assert.ok(api.helpSpeedMultiplier('axe', 5, 5) > 1, 'in position → faster hold');
assert.equal(api.helpSpeedMultiplier('pick', 5, 5), 1);
assert.ok(api.buffStacks('foraging') > 0, 'woodcutting date grants the foraging buff');
assert.equal(api.targetFor({ id: 'nashka_khibu' }, date).toolActivity, 'chop');
api.onChargeEnd({ tool: 'axe', col: 5, row: 5, completed: true });
assert.equal(scored[0].join(), 'tree_felled,Timber!', 'credited as helping even if they never arrived');
assert.equal(api.snapshot().task, null);

// One-shot: felled before the helper reached the tree still credits them.
walker.root.position.x = 30.5; walker.root.position.z = 30.5;
api.onChargeStart({ tool: 'pick', col: 12, row: 12 });
api.onChargeEnd({ tool: 'pick', col: 12, row: 12, completed: true });
assert.equal(scored[1][0], 'rock_broken');
// A cancelled hold scores nothing.
api.onChargeStart({ tool: 'pick', col: 12, row: 12 });
api.onChargeEnd({ tool: 'pick', col: 12, row: 12, completed: false });
assert.equal(scored.length, 2);

// Fishing: the date finds a bank spot near the player facing the water, and lands a catch now and then.
startDate('tooth_hatayap');
walker.root.position.x = 20.5; walker.root.position.z = 20.5;
fishing = { active: true, anchorWorld: { x: 3.5, z: 6.5 } };
tick();
task = api.snapshot().task;
assert.equal(task.kind, 'fish');
assert.equal(task.target.toolActivity, 'fish');
assert.equal(task.target.toolKey, 'fishingspear');
const d = Math.hypot(task.target.c + 0.5 - player.x, task.target.r + 0.5 - player.z);
assert.ok(d >= 1.4 && d <= 4, `fishing spot ${d.toFixed(2)} tiles from the player`);
assert.ok(api.luckStacks() > 0, 'fishing luck buff while joined');
walker.root.position.x = task.target.c + 0.5; walker.root.position.z = task.target.r + 0.5;
const realNow = Date.now;
Date.now = () => realNow() + 120000; win.performance = { now: () => realNow() + 120000 };
context.performance = win.performance;
tick();
Date.now = realNow;
assert.ok(scored.some(s => s[0] === 'fish_caught'), 'visual catch scores romance');
fishing = null; tick();
assert.equal(api.snapshot().task, null, 'stops when you stop fishing');

// Picking: a date who likes herbs runs to the nearest plant in sight and picks it for you.
startDate('aliri_ginju');
walker.root.position.x = 12.5; walker.root.position.z = 12.5;
tick();
task = api.snapshot().task;
assert.equal(task.kind, 'pick');
assert.equal(`${task.target.c},${task.target.r}`, '8,8', 'the far plant out of sight is ignored');
assert.ok(walker.catchup > 1.5, 'runs ahead faster than a normal follow');
assert.ok(api.ownsPace('aliri_ginju'));
walker.root.position.x = 8.5; walker.root.position.z = 8.5;
tick();
assert.equal(picked.join(), 'herb');
assert.equal(api.snapshot().task, null);

// Dating someone else, or waiting mode, never runs anything.
date = { npcId: 'aliri_ginju', mode: 'wait', startHour: 100 };
tick();
assert.equal(api.snapshot().task, null);

console.log('ok - date companion activities');
process.exit(0);
