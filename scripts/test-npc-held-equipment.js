const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('docs/js/npc-held-equipment-v4.js', 'utf8'); // Player-parity civilian held-equipment runtime.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Confirms v4 is the parser-loaded implementation.
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
let banditInitDeps = null;
const window = {
  setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
  __farmDebugTools: {},
  __hobunjiFurnitureDebug: { getNpcWalkers: () => [walker] },
  BanditCombat: {
    init(deps) { banditInitDeps = deps; return 'bandit-init-result'; },
  },
};
window.window = window;
const context = vm.createContext({ window, console, Math, Object, Set, WeakSet, WeakMap, Number, String, Promise, performance: { now: () => 100 } });
vm.runInContext(source, context, { filename: 'npc-held-equipment-v4.js' });

assert.strictEqual(window.NpcHeldEquipment.version, 4);
assert.deepStrictEqual(Array.from(window.NpcHeldEquipment.liveWalkers()), [walker]);
assert.match(source, /oddclaw_unumanuk:[\s\S]*toolKey: 'hatchet'[\s\S]*mastery: 3[\s\S]*verdigris: \.5/);
assert.match(source, /spearhead_unumanuk:[\s\S]*toolKey: 'fishingspear'[\s\S]*mastery: 5[\s\S]*verdigris: 1/);
assert.match(source, /__hobunjiFurnitureDebug\?\.getNpcWalkers/, 'v4 must discover the actual live game walkers without relying on NpcScheduling init capture');
assert.match(source, /root\?\.traverse[\s\S]*proceduralHandRig/, 'rig lookup must search the walker hierarchy instead of assuming avatarGroup owns the hand rig');
assert.doesNotMatch(source, /Object\.defineProperty\(window, ['"]NpcScheduling['"]/, 'v4 must not compete with other NpcScheduling namespace watchers');

// The player's idle fishing spear reports secondary=no. Civilian idle watchmen must not turn the raw authored span into an always-on left-hand grip.
assert.doesNotMatch(source, /secondaryGripSpanForTool/, 'persistent civilian idle must not consume the raw secondary-grip span directly');
assert.match(source, /claims\.right = owner;[\s\S]*claims\.left = null/, 'watchman idle owns only the primary/right hand');

// Player WeaponToolStances applies pitch/yaw/roll to the holder while WeaponIdleBodyYawRuntime rotates the body separately.
assert.match(source, /function ensureBodyYawWrapper[\s\S]*held_stance_body_yaw/, 'civilian rigs need a dedicated body-yaw presentation wrapper');
assert.match(source, /applyBodyYaw\(state, pose\?\.bodyYaw\)/, 'authored bodyYaw must be applied to the NPC body presentation');
assert.match(source, /function poseQuaternion\(pose, foldBodyYaw = false\)/, 'held-item quaternion must support bodyYaw-separated parity');

// Watchmen should use the exact player/bandit plane factory, preserving material/texture conventions; recolor swaps pixels on a clone of that texture.
assert.match(source, /banditDeps\?\.makeToolPlaneMesh/, 'v4 must capture the shared player\/bandit tool-plane factory');
assert.match(source, /factory\(loadout\.toolKey\)/, 'watchman construction must request the shared shape from that factory');
assert.match(source, /const texture = source\?\.clone\?\.\(\)[\s\S]*texture\.image = canvas/, 'verdigris should replace only the cloned shared texture image');
assert.match(source, /alphaTest: \.08, side: three\.DoubleSide/, 'fallback construction must match the player/editor alpha-cutout convention');

assert.match(loader, /js\/npc-held-equipment-v4\.js\?v=20260914d/);
assert.match(loader, /NpcHeldEquipment\?\.version\) >= 4/);
assert.doesNotMatch(loader, /npc-held-equipment-v3\.js/, 'v3 must no longer be loaded');

const sharedDeps = { makeToolPlaneMesh() {} };
assert.strictEqual(window.BanditCombat.init(sharedDeps), 'bandit-init-result', 'capturing BanditCombat deps must preserve the original init contract');
assert.strictEqual(banditInitDeps, sharedDeps);

const snap = window.NpcHeldEquipment.debugSnapshot('spearhead_unumanuk');
assert.ok(snap, 'initial direct scan must wrap an already-live walker immediately');
assert.strictEqual(snap.version, 4);
assert.strictEqual(snap.toolKey, 'fishingspear');
assert.strictEqual(snap.mastery, 5);
assert.strictEqual(snap.verdigris, 1);
assert.strictEqual(snap.rigReady, true, 'hierarchy traversal must resolve the existing procedural hand rig');
assert.strictEqual(snap.secondaryGripActive, false, 'idle watchman secondary grip must stay off like the player');
assert.strictEqual(snap.sharedPlaneFactoryReady, true, 'BanditCombat init capture must expose the shared tool-plane factory');
assert.strictEqual(typeof window.__farmDebugTools.npcHeldEquipmentSnapshot, 'function');
assert.strictEqual(typeof window.__farmDebugTools.rescanNpcHeldEquipment, 'function');
assert.strictEqual(intervals.length, 1);
assert.strictEqual(intervals[0].ms, 100);

console.log('npc-held-equipment v4 player-parity smoke test: ok');
