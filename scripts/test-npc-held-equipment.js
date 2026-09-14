const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('docs/js/npc-held-equipment-v3.js', 'utf8'); // Runtime source now uses the game's live walker seam instead of scheduler namespace interception.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Confirms v3 is the parser-loaded implementation.
const intervals = [];
const rig = { speciesId: 'engh-sho', gender: 'male' };
const avatarNode = { userData: { proceduralHandRig: rig } };
const walker = {
  rec: { id: 'spearhead_unumanuk', name: 'Spearhead Unumanuk' },
  area: 'town', state: 'on-route', avatarGroup: { userData: {} }, avatarHeight: 0.9,
  root: {
    visible: true, parent: null,
    traverse(fn) { fn(this); fn(avatarNode); },
  },
  update() { return 'walker-update'; },
};
const window = {
  setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
  __farmDebugTools: {},
  __hobunjiFurnitureDebug: { getNpcWalkers: () => [walker] },
};
window.window = window;
const context = vm.createContext({ window, console, Math, Object, Set, WeakSet, WeakMap, Number, String, Promise, performance: { now: () => 100 } });
vm.runInContext(source, context, { filename: 'npc-held-equipment-v3.js' });

assert.strictEqual(window.NpcHeldEquipment.version, 3);
assert.deepStrictEqual(Array.from(window.NpcHeldEquipment.liveWalkers()), [walker]);
assert.match(source, /oddclaw_unumanuk:[\s\S]*toolKey: 'hatchet'[\s\S]*mastery: 3[\s\S]*verdigris: \.5/);
assert.match(source, /spearhead_unumanuk:[\s\S]*toolKey: 'fishingspear'[\s\S]*mastery: 5[\s\S]*verdigris: 1/);
assert.match(source, /__hobunjiFurnitureDebug\?\.getNpcWalkers/, 'v3 must discover the actual live game walkers without relying on NpcScheduling init capture');
assert.match(source, /root\?\.traverse[\s\S]*proceduralHandRig/, 'rig lookup must search the walker hierarchy instead of assuming avatarGroup owns the hand rig');
assert.doesNotMatch(source, /Object\.defineProperty\(window, ['"]NpcScheduling['"]/, 'v3 must not compete with other NpcScheduling namespace watchers');
assert.match(loader, /js\/npc-held-equipment-v3\.js\?v=20260914c/);
assert.match(loader, /NpcHeldEquipment\?\.version\) >= 3/);

const snap = window.NpcHeldEquipment.debugSnapshot('spearhead_unumanuk');
assert.ok(snap, 'initial direct scan must wrap an already-live walker immediately');
assert.strictEqual(snap.version, 3);
assert.strictEqual(snap.toolKey, 'fishingspear');
assert.strictEqual(snap.mastery, 5);
assert.strictEqual(snap.verdigris, 1);
assert.strictEqual(snap.rigReady, true, 'hierarchy traversal must resolve the existing procedural hand rig');
assert.strictEqual(typeof window.__farmDebugTools.npcHeldEquipmentSnapshot, 'function');
assert.strictEqual(typeof window.__farmDebugTools.rescanNpcHeldEquipment, 'function');
assert.strictEqual(intervals.length, 1);
assert.strictEqual(intervals[0].ms, 100);

console.log('npc-held-equipment v3 live-walker smoke test: ok');
