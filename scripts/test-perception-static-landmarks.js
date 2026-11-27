'use strict';

// Execute Perception's real stationary-landmark cache against tiny fake scene owners.
// Dynamic actors remain refreshed on the original 150-ms cadence.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Vector3 {
  constructor() { this.x = 0; this.z = 0; }
}
const scene = { isScene: true, children: [], name: 'zone' }; // First visible scene used to test root ownership and provider invalidation.
let activeScene = scene; // Simulates a scene being retired or replaced without toggling Sense off.
const player = { x: 0.1, z: 0.5 }; // Continuous tile-space position used for exact sense-range checks.
let banditProviderCalls = 0; // Counts scans of static landmark owners to detect redundant work.
let staticRoot = makeRoot(24.5, 0.5); // A borderline camp only becomes visible as the player moves within the same tile.
let creatureRoot = makeRoot(50, 0.5); // An independently moving creature must never be held in the stationary cache.
let boostStacks = 0; // Tests that a range-changing buff invalidates the static candidate window.

function makeRoot(x, z) {
  const root = { x, z, parent: scene, visible: true, isMesh: true, renderOrder: 0,
    material: { visible: true }, name: 'stub',
    getWorldPosition(out) { out.x = this.x; out.z = this.z; return out; },
    traverse(visit) { visit(this); },
  };
  return root;
}
const ctx = {
  console,
  performance: { now: () => 0 },
  document: { getElementById: () => null }, // Tests do not need the overlay or gamepad DOM.
  THREE: { Vector3 },
  CookingSystem: { getFoodEffectStacks: () => boostStacks },
  BanditCamps: { senseTargets() { banditProviderCalls++; return [{ root: staticRoot }]; } },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('docs/js/player-tile-events.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('docs/js/perception-mask-renderer.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('docs/js/perception-info-lists.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('docs/js/perception-mode.js', 'utf8'), ctx);
ctx.PerceptionMode.init({
  THREE: ctx.THREE,
  getActiveScene: () => activeScene,
  getPlayerTile: () => player,
  getSources: () => ({ creatures: [{ root: creatureRoot, health: 10, def: { hostile: false } }] }),
});
ctx.PerceptionMode.setActive(true);
ctx.PlayerTileEvents.update('zone', player.x * 64, player.z * 64, 64);
ctx.PerceptionMode.update(0);
assert.strictEqual(banditProviderCalls, 1);
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().byCategory.landmark || 0, 0, 'out-of-range camp must not glow');
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().byCategory.neutral || 0, 0);

player.x = 0.9; // Still tile 0; the camp should now glow without rescanning owners.
creatureRoot.x = 1; // Moving actors must react immediately on the next ordinary collection tick.
ctx.PlayerTileEvents.update('zone', player.x * 64, player.z * 64, 64);
ctx.PerceptionMode.update(200);
assert.strictEqual(banditProviderCalls, 1, 'stationary providers are reused without a tile change');
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().byCategory.landmark, 1, 'precise distance still tracks sub-tile movement');
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().byCategory.neutral, 1, 'moving actors still refresh within the original 150-ms cadence');
assert.ok(ctx.PerceptionMode.debugSnapshot().landmarkCache.reuses >= 1);

player.x = 1.1; // Tile changed, but its enclosing wilderness chunk has not.
ctx.PlayerTileEvents.update('zone', player.x * 64, player.z * 64, 64);
ctx.PerceptionMode.update(400);
assert.strictEqual(banditProviderCalls, 2, 'tile transition invalidates static provider candidates');

staticRoot.visible = false;
ctx.PerceptionMode.update(600);
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().byCategory.landmark || 0, 0,
  'landmarks hidden or detached while stationary are rejected on live checks');

const oldRoot = staticRoot; // Represents a harvested/retired root replaced by the real scene owner.
oldRoot.parent = null;
staticRoot = makeRoot(2, 0.5);
ctx.PerceptionMode.update(800);
assert.strictEqual(banditProviderCalls, 2, 'static owner membership is cached briefly while standing still');
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().byCategory.landmark || 0, 0,
  'detached roots do not linger in the silhouette even before provider TTL expiry');
ctx.PerceptionMode.update(1600);
assert.strictEqual(banditProviderCalls, 3, 'stationary owner membership is refreshed after the safety TTL');
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().byCategory.landmark, 1, 'new stationary geometry appears without requiring player motion');

boostStacks = 1;
ctx.PerceptionMode.update(1800);
assert.strictEqual(banditProviderCalls, 4, 'range-changing buffs invalidate the cached landmark radius');
ctx.PerceptionMode.setActive(false);
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().landmarkCache.holdingScene, false,
  'disabled Sense must release the old scene and all its attached wilderness geometry');
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().landmarkCache.candidates, 0,
  'disabled Sense must not retain any landmark roots after a zone is unloaded');
ctx.PerceptionMode.setActive(true);
ctx.PerceptionMode.update(2000);
assert.strictEqual(banditProviderCalls, 5, 'reopening Sense Mode forces a fresh static provider scan');
assert.ok(ctx.PerceptionMode.debugSnapshot().landmarkCache.rebuilds >= 5);

// Area loading can temporarily have no current THREE.Scene while Sense stays
// enabled; the old zone must be released without waiting for another toggle.
activeScene = null;
ctx.PerceptionMode.update(2200);
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().landmarkCache.holdingScene, false,
  'missing active scene immediately releases the previously cached wilderness');
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().byCategory.landmark || 0, 0,
  'no stale landmark targets remain visible while the scene is absent');
activeScene = scene;
ctx.PerceptionMode.update(2400);
assert.strictEqual(ctx.PerceptionMode.debugSnapshot().byCategory.landmark, 1,
  'Sense re-collects stationary landmarks after a temporary scene transition');

console.log('Stationary Perception landmark caching and moving-actor tests passed.');
