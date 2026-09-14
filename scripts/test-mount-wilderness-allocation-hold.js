'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Node {
  constructor() {
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.name = '';
  }
  add(child) {
    if (child.parent) child.parent.remove(child);
    this.children.push(child);
    child.parent = this;
  }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child.parent === this) child.parent = null;
  }
  clear() {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
  }
  traverse(visitor) {
    visitor(this);
    for (const child of this.children) child.traverse ? child.traverse(visitor) : visitor(child);
  }
}
class Group extends Node {}
class DisposableGeometry { dispose() {} }
class DisposableMaterial { dispose() {} }

let now = 0;
const elements = new Map();
const document = {
  getElementById(id) { return elements.get(id) || null; },
  createElement() {
    return {
      id: '',
      style: {},
      dataset: {},
      textContent: '',
      addEventListener() {},
    };
  },
  body: { appendChild(element) { if (element.id) elements.set(element.id, element); } },
};

let rideState = 'none';
let summonAllowed = true;
const rideEntity = { def: { mountSpeed: 100 } };
const Mounts = {
  init(deps) { this.deps = deps; },
  toggleMount() {
    if (rideState === 'none') {
      if (summonAllowed) rideState = 'rushingIn';
    } else if (rideState === 'rushingIn') {
      rideState = 'dismountingDown';
    }
  },
  updateMountRide() {
    if (rideState === 'rushingIn') rideState = 'mountingUp';
  },
  updateMountedMovement() {},
  get rideState() { return rideState; },
  get rideEntity() { return rideEntity; },
};

const progression = {
  trees: { companion: [], mount: [], shoulderPet: [] },
  activeEntryForRole() { return null; },
  perkRank() { return 0; },
};

const context = {
  console,
  document,
  navigator: { deviceMemory: 4 },
  matchMedia: query => ({ matches: query === '(pointer: coarse)' }),
  performance: { now: () => ++now },
  Date,
  StableAnimalProgression: progression,
  Mounts,
  THREE: {
    Group,
    BoxGeometry: class extends DisposableGeometry {},
    EdgesGeometry: class extends DisposableGeometry {},
    LineBasicMaterial: class extends DisposableMaterial {
      constructor(options) {
        super();
        this.opacity = options.opacity;
        this.color = { setHex() {} };
      }
    },
    LineSegments: class extends Node {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        this.position = { set() {} };
      }
    },
  },
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/wilderness-chunks.js', 'utf8'), context, { filename: 'wilderness-chunks.js' });

let currentArea = 'map_northern_cliffs';
const TILE = 22;
const player = { x: 56.5 * TILE, y: 56.5 * TILE };
let buildCount = 0;
context.WildernessChunks.init({
  getCurrentArea: () => currentArea,
  isZoneArea: area => String(area).startsWith('map_') && !String(area).startsWith('map_i_'),
  player,
  TILE,
});
const scene = new Group();
const controller = context.WildernessChunks.createZone({
  mapId: currentArea,
  scene,
  cols: 200,
  rows: 200,
  focusCol: 56,
  focusRow: 56,
  buildChunk({ group }) {
    buildCount++;
    const mesh = new Node();
    mesh.geometry = new DisposableGeometry();
    mesh.material = new DisposableMaterial();
    mesh.userData.wildernessChunkOwnsGeometry = true;
    mesh.userData.wildernessChunkOwnsMaterial = true;
    group.add(mesh);
    return {};
  },
});

vm.runInContext(fs.readFileSync('docs/js/stable-animal-perk-adjustments.js', 'utf8'), context, { filename: 'stable-animal-perk-adjustments.js' });
context.Mounts.init({ ACCEL: 10, clamp(value, min, max) { return Math.max(min, Math.min(max, value)); } });

let snap = context.WildernessChunks.snapshot();
assert.equal(buildCount, 1, 'arrival still builds only the player chunk synchronously');
assert.equal(snap.allocationHeld, false);

// The mount wrapper must acquire before the real toggle starts constructing
// the summoned actor, and the resulting rushingIn state keeps the hold alive.
context.Mounts.toggleMount();
snap = context.WildernessChunks.snapshot();
assert.equal(rideState, 'rushingIn');
assert.equal(snap.allocationHeld, true, 'mount rush-in owns the wilderness allocation budget');
assert.deepEqual(Array.from(snap.allocationHoldReasons), ['mount-rush-in']);
let debug = context.StableAnimalPerkAdjustments.getDebug().mountWildernessAllocation;
assert.equal(debug.held, true);
assert.equal(debug.acquires, 1);

context.WildernessChunks.update(1);
assert.equal(buildCount, 1, 'queued terrain must not allocate while the mount rush-in is allocating/rendering');
assert.equal(controller.snapshot().queued, 8, 'the neighborhood remains queued rather than being discarded');

// Recenter still runs during the hold; only the expensive load() phase stops.
player.x = (4 * 16 + 1) * TILE;
context.WildernessChunks.update(1);
assert.equal(controller.snapshot().center.x, 4, 'chunk ownership still follows the player during a hold');
assert.equal(buildCount, 1, 'recenter must not sneak in a queued allocation');

// The mock ride update models the real rushingIn -> mountingUp transition.
context.Mounts.updateMountRide(0.1);
snap = context.WildernessChunks.snapshot();
assert.equal(rideState, 'mountingUp');
assert.equal(snap.allocationHeld, false, 'arrival releases the wilderness allocation budget immediately');
debug = context.StableAnimalPerkAdjustments.getDebug().mountWildernessAllocation;
assert.equal(debug.releases, 1);

context.WildernessChunks.update(0.19);
assert.equal(buildCount, 1, 'release restores the normal low-memory cooldown instead of allocating on the same frame');
context.WildernessChunks.update(0.02);
assert.equal(buildCount, 2, 'streaming resumes after the post-mount 200 ms breathing interval');

// A rejected summon must not leak its pre-acquired hold.
rideState = 'none';
summonAllowed = false;
context.Mounts.toggleMount();
snap = context.WildernessChunks.snapshot();
assert.equal(rideState, 'none');
assert.equal(snap.allocationHeld, false, 'failed summon releases its speculative hold in finally');

// Cancelling while the mount is still rushing in also releases immediately.
summonAllowed = true;
context.Mounts.toggleMount();
assert.equal(rideState, 'rushingIn');
assert.equal(context.WildernessChunks.snapshot().allocationHeld, true);
context.Mounts.toggleMount();
assert.equal(rideState, 'dismountingDown');
assert.equal(context.WildernessChunks.snapshot().allocationHeld, false, 'rush-in cancellation cannot strand streaming in a held state');

// Holds are reason-keyed: releasing mount-rush-in must never clear another
// subsystem's independent claim on the same allocation budget.
context.WildernessChunks.setAllocationHold('synthetic-other-work', true);
rideState = 'none';
context.Mounts.toggleMount();
assert.equal(context.WildernessChunks.snapshot().allocationHoldReasons.length, 2);
context.Mounts.updateMountRide(0.1);
snap = context.WildernessChunks.snapshot();
assert.equal(snap.allocationHeld, true);
assert.deepEqual(Array.from(snap.allocationHoldReasons), ['synthetic-other-work']);
context.WildernessChunks.setAllocationHold('synthetic-other-work', false);
assert.equal(context.WildernessChunks.snapshot().allocationHeld, false);

debug = context.StableAnimalPerkAdjustments.getDebug().mountWildernessAllocation;
assert.equal(debug.acquires, debug.releases, 'all completed/failed/cancelled summon attempts must balance their holds');
assert.equal(debug.chunkApiReady, true);

console.log('Mount/wilderness allocation serialization tests passed.');
