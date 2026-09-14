const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('docs/js/npc-held-equipment.js', 'utf8'); // Runtime source exercised in an isolated browser-like context below.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Confirms the bridge is parser-loaded before game.js setup.
const intervals = []; // Captures the low-frequency walker scanner without starting a real timer in this smoke test.
const window = {
  setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
  __farmDebugTools: {},
};
window.window = window;
const context = vm.createContext({ window, console, Math, Object, Set, WeakSet, WeakMap, Number, String, Promise, performance: { now: () => 0 } }); // Minimal globals needed before walkers/Three are introduced.
vm.runInContext(source, context, { filename: 'npc-held-equipment.js' });

assert.strictEqual(window.NpcHeldEquipment.version, 2);
assert.match(source, /oddclaw_unumanuk:[\s\S]*toolKey: 'hatchet'[\s\S]*mastery: 3[\s\S]*verdigris: \.5/);
assert.match(source, /spearhead_unumanuk:[\s\S]*toolKey: 'fishingspear'[\s\S]*mastery: 5[\s\S]*verdigris: 1/);
assert.match(source, /function desiredWatchmanParent\(walker\)[\s\S]*walker\?\.root\?\.parent/, 'watchman holders must live at scene-root level like BanditCombat/player holders');
assert.match(source, /npcHeldClaimAwareSetSideIdle[\s\S]*if \(claims\[side\]\) return false/, 'claimed NPC hands must reject the global fallback idle write');
assert.match(source, /npcHeldClaimAwareUseIdlePose[\s\S]*!claims\.left[\s\S]*!claims\.right/, 'whole-rig fallback must preserve any claimed held-tool side');
assert.match(source, /setHandClaims\(walker, owner, !!secondary\)[\s\S]*placeHandWorld\('right'/, 'the grip claim must be established before the held hand is placed');
assert.match(source, /buildWatchman\(state, loadout\)[\s\S]*desiredWatchmanParent\(state\.walker\)/, 'watchman construction must use the scene-root holder parent');
assert.match(loader, /js\/npc-held-equipment\.js\?v=20260914b/);
assert.match(loader, /NpcHeldEquipment\?\.version\) >= 2/);

let receivedDeps = null; // Verifies the future NpcScheduling assignment is intercepted without changing its init contract.
window.NpcScheduling = { init(deps) { receivedDeps = deps; return 'scheduler-result'; } };
const deps = { npcWalkers: [] }; // Empty walker array is enough to exercise setup/debug wiring without Three.js.
assert.strictEqual(window.NpcScheduling.init(deps), 'scheduler-result');
assert.strictEqual(receivedDeps, deps);
assert.strictEqual(typeof window.__farmDebugTools.npcHeldEquipmentSnapshot, 'function');
assert.strictEqual(typeof window.__farmDebugTools.rescanNpcHeldEquipment, 'function');
assert.deepStrictEqual(Array.from(window.NpcHeldEquipment.debugSnapshot()), []);
assert.strictEqual(intervals.length, 1);
assert.strictEqual(intervals[0].ms, 250);

console.log('npc-held-equipment v2 smoke test: ok');
