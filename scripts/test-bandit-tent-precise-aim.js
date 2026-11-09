#!/usr/bin/env node
'use strict';

// Precise bandit tent targeting without a browser: execute the actual private
// focus functions with a fake Three.js raycaster that distinguishes surface
// intersections from broad tent bounding boxes.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/bandit-camps.js', 'utf8');
const marker = '  window.BanditCamps = {';
assert(source.includes(marker), 'bandit camp module exposes its public interface');
const instrumented = source.replace(marker, `
  window.__tentAimTest = {
    setDeps: value => { deps = value; },
    camps: _banditCampInstances,
    meshes: _banditCampMeshes,
    aim: aimedBanditTent,
    nearby: hasNearbyTent,
    action: getNearbyTentAction,
    update: updateBanditTentInteraction,
    hold: () => ({ time: _banditTentHoldT, id: _banditTentHoldId, interrupted: _banditTentHoldInterrupted }),
  };
${marker}`);

class Vector3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() {
    const length = Math.sqrt(this.lengthSq());
    this.x /= length; this.y /= length; this.z /= length;
    return this;
  }
}
class Raycaster {
  set(origin, direction) { this.origin = origin; this.direction = direction; }
  intersectObject(surface, recursive) {
    assert.equal(recursive, true, 'raycast includes the authored tent child meshes');
    const hit = surface.intersect?.(this);
    return hit && hit.distance >= this.near && hit.distance <= this.far ? [hit] : [];
  }
}

let ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 } };
let hostileDistance = null;
let focusedCount = 0;
const gameWindow = {
  RangedWeapons: {
    focusCandidates: () => null, // Targeting must NOT substitute the old broad AABB hit.
    focusedHostile: () => hostileDistance == null ? null : { distanceWorld: hostileDistance },
  },
  DebugHitboxes: { noteInteractionFocus: () => { focusedCount++; } },
};
const hudNodes = new Map(); // Mutable DOM fakes let the real hold-progress UI run in this headless test.
const document = {
  getElementById: id => {
    if (!hudNodes.has(id)) {
      const classes = new Set();
      hudNodes.set(id, {
        style: {}, textContent: '',
        setAttribute() {},
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      });
    }
    return hudNodes.get(id);
  },
};
const context = { THREE: { Vector3, Raycaster }, window: gameWindow, document, performance: { now: () => 0 } };
vm.createContext(context);
vm.runInContext(instrumented, context, { filename: 'bandit-camps.js' });
const api = gameWindow.__tentAimTest;
const zone = 'wilderness';
const tentA = { id: 'tent-a', type: 'tent', x: 2, y: 1, w: 2, h: 3, interactable: { lootable: true, burnable: true } };
const tentB = { id: 'tent-b', type: 'tent', x: 3, y: 1, w: 2, h: 3, interactable: { lootable: true, burnable: true } };
const player = { x: 35, y: 25 };
let held = false; // Shared held-input state consumed by the real tent interaction updater.
const inventory = {}; // Loot grants mutate this shared pack so the test can detect accidental repeats.
const toasts = []; // Records completed loot/burn outcomes to detect unintended actions.
api.setDeps({
  TILE: 10, player,
  getCurrentArea: () => zone,
  isZoneArea: area => area === zone,
  getPlayerInteractionRay: () => ray,
  getPlayerAimRay: () => null,
  getActiveAction: () => 'bandit_tent_interact',
  getActionHeldDown: () => held,
  hostileObjects: new Set(),
  inventory,
  rollLootPool: () => ({ gold: 3 }),
  refreshItemScroll() {}, buildInventoryGrid() {}, refreshActionBar() {}, saveMemberWorldData() {},
  showToast: message => toasts.push(message),
});
api.camps.set(zone, [{ props: [tentA, tentB], instance: { id: 'test-camp' } }]);
tentA.temporaryLocaleInstanceId = 'test-camp';
tentB.temporaryLocaleInstanceId = 'test-camp';

const hitFor = distance => raycaster =>
  raycaster.direction.x > 0.99
    ? { distance, point: { x: distance, y: 1, z: 0 } }
    : null;
const surfaceA = { userData: { banditTentAimSurface: true }, visible: true, intersect: hitFor(6) };
const surfaceB = { userData: { banditTentAimSurface: true }, visible: true, intersect: hitFor(3) };
const makeRoot = surface => ({
  visible: true,
  children: [
    surface,
    { userData: { banditFireEffect: true }, visible: true, intersect: hitFor(0.1) },
  ],
  updateWorldMatrix() {},
});
api.meshes.set(zone, new Map([
  [tentA.id, { mesh: makeRoot(surfaceA) }],
  [tentB.id, { mesh: makeRoot(surfaceB) }],
]));

assert.strictEqual(api.aim(zone), tentB, 'the closest real tent canvas hit wins, not a large proxy or the fire effect');
assert.equal(api.action().label, 'Loot Tent', 'looking at canvas offers the held loot action');
assert.equal(focusedCount, 2, 'both aim and prompt expose focused tent surfaces to hitbox debugging');

ray.direction = { x: 0, y: 0, z: 1 };
assert.equal(api.aim(zone), null, 'mere proximity cannot target a tent when aim misses the surface');
assert.equal(api.nearby(), false, 'off-target tents are not considered available interactions');
assert.equal(api.action(), null, 'off-target tents show neither Loot nor Burn prompts');

ray.direction = { x: 1, y: 0, z: 0 };
surfaceB.intersect = () => null;
assert.strictEqual(api.aim(zone), tentA, 'a missed front tent does not prevent aiming at another visible tent behind it');
surfaceB.intersect = hitFor(3);
hostileDistance = 2;
assert.equal(api.aim(zone), null, 'nearer enemies retain attack priority over tent interaction');
hostileDistance = 8;
assert.strictEqual(api.aim(zone), tentB, 'an enemy behind the tent does not steal its interaction');
hostileDistance = null;

tentB.interactable.lootable = false;
assert.equal(api.action().label, 'Burn Tent', 'ransacked tents offer burning while aimed');
tentA.destroyed = false;
tentB.burning = true;
assert.equal(api.aim(zone), null, 'the foreground burning tent blocks interaction with an actionable tent behind it');
tentB.burning = false;
tentB.interactable.burnable = false;
assert.equal(api.action(), null, 'the foreground non-interactable tent blocks burning the tent behind it');
tentA.destroyed = true;
tentB.interactable.burnable = true;
api.meshes.get(zone).delete(tentB.id);
assert.equal(api.aim(zone), null, 'unloaded meshes must not fall back to invisible bounding boxes');
api.meshes.get(zone).set(tentB.id, { mesh: makeRoot(surfaceB) });
ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 0 } };
assert.equal(api.aim(zone), null, 'degenerate aim rays never interact');
ray = null;
assert.equal(api.aim(zone), null, 'missing rays never interact');

// Run the real hold updater: aim loss, switching, release-to-rearm and loot -> burn.
ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 } };
tentA.destroyed = false;
tentB.interactable.lootable = true;
tentB.interactable.burnable = true;
tentB.burning = false;
held = true;
api.update(1.5);
assert.equal(api.hold().time, 1.5, 'holding while aiming advances the tent timer');
assert.equal(api.hold().id, tentB.id, 'held action is bound to the aimed tent');
assert.equal(inventory.gold || 0, 0, 'partial holds never loot');
surfaceB.intersect = () => null;
api.update(0.25);
assert.equal(api.hold().id, tentA.id, 'switching aim switches held tent ownership');
assert.equal(api.hold().time, 0.25, 'switching tents restarts hold progress');
surfaceB.intersect = hitFor(3);
api.update(0.5);
assert.equal(api.hold().time, 0.5, 'switching back restarts the new hold');
ray.direction = { x: 0, y: 0, z: 1 };
api.update(0.25);
assert.equal(api.hold().time, 0, 'looking away cancels accumulated hold time');
assert.equal(api.hold().id, null, 'looking away clears the held tent');
ray.direction = { x: 1, y: 0, z: 0 };
api.update(2);
assert.equal(inventory.gold || 0, 0, 're-aiming requires a fresh full hold');
api.update(2.1);
assert.equal(inventory.gold, 3, 'a complete aimed hold loots once');
assert.equal(tentB.interactable.lootable, false, 'completed loot transitions the tent into its burnable state');
assert.equal(api.hold().interrupted, true, 'a completed action locks out further hold progress until release');
api.update(8);
assert.equal(tentB.burning, false, 'continuing to hold after looting does not burn the tent');
assert.equal(inventory.gold, 3, 'continuing to hold cannot grant loot twice');
held = false;
api.update(0.016);
assert.equal(api.hold().interrupted, false, 'releasing the input rearms the interaction');
held = true;
api.update(4.1);
assert.equal(tentB.burning, true, 'releasing and holding again burns the aimed, looted tent');
assert.equal(toasts.length, 2, 'the two separate holds cause exactly one loot and one burn');

assert(source.includes('_banditTentHoldInterrupted = true; // One press performs one action;'),
  'a completed loot/burn requires release before the next tent action');
assert(source.includes("if (_banditTentHoldId !== null) { _banditTentHoldT = 0; _banditTentHoldId = null; }"),
  'losing focus clears the held tent and its progress');
assert(source.includes('authored.userData.banditTentAimSurface = true;'),
  'the runtime marks the authored canvas as the raycast target');

console.log('bandit tent precise-aim and continuous-hold contracts passed');
