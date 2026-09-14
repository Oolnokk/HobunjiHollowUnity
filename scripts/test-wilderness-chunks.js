'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

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
class DisposableGeometry {
  constructor() { this.disposed = false; }
  dispose() { this.disposed = true; }
}
class DisposableMaterial {
  constructor() { this.disposed = false; }
  dispose() { this.disposed = true; }
}

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
const context = {
  console,
  document,
  navigator: { deviceMemory: 4 },
  matchMedia: query => ({ matches: query === '(pointer: coarse)' }),
  performance: { now: () => ++now },
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
vm.runInContext(fs.readFileSync('docs/js/wilderness-chunks.js', 'utf8'), context);

let currentArea = 'map_northern_cliffs';
const TILE = 22;
const player = { x: 56.5 * TILE, y: 56.5 * TILE };
const builtBounds = [];
let disposedChunks = 0;
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
  buildChunk({ group, bounds }) {
    builtBounds.push({ ...bounds });
    const mesh = new Node();
    mesh.geometry = new DisposableGeometry();
    mesh.material = new DisposableMaterial();
    mesh.userData.wildernessChunkOwnsGeometry = true;
    mesh.userData.wildernessChunkOwnsMaterial = true;
    group.add(mesh);
    return { floorMeshes: [mesh] };
  },
  disposeChunk(record) {
    disposedChunks++;
    record.group.traverse(object => {
      if (object.userData.wildernessChunkOwnsGeometry) object.geometry.dispose();
      if (object.userData.wildernessChunkOwnsMaterial) object.material.dispose();
    });
  },
});

let snap = controller.snapshot();
assert.strictEqual(snap.center.x, 3);
assert.strictEqual(snap.center.z, 3);
assert.strictEqual(snap.lowMemoryStreaming, true, 'coarse-pointer/4 GB test context should use low-memory streaming');
assert.strictEqual(snap.loadRadius, 1, 'low-memory streaming should request only a 3x3 neighborhood');
assert.strictEqual(snap.unloadRadius, 2, 'low-memory streaming should release the trailing ring sooner');
assert.strictEqual(snap.streamBuildIntervalMs, 200, 'low-memory builds should be paced so GC gets time between allocations');
assert.strictEqual(snap.immediateRadius, 0, 'arrival priming should only build the player chunk synchronously');
assert.strictEqual(snap.loaded, 1, 'arrival should synchronously build only the player chunk');
assert.strictEqual(snap.queued, 8, 'the rest of the mobile 3x3 neighborhood should stay queued for paced loading');
assert.ok(builtBounds.every(bounds =>
  bounds.colEnd - bounds.colStart <= 16 &&
  bounds.rowEnd - bounds.rowStart <= 16
), 'every runtime build must stay inside a 16x16 tile chunk');

context.WildernessChunks.update(1 / 60);
snap = controller.snapshot();
assert.strictEqual(snap.loaded, 1, 'the first post-arrival frame should not immediately allocate another chunk');
assert.strictEqual(snap.queued, 8);

context.WildernessChunks.update(0.2);
snap = controller.snapshot();
assert.strictEqual(snap.loaded, 2, 'one queued chunk should build after the low-memory cooldown elapses');
assert.strictEqual(snap.queued, 7);

player.x = (8 * 16 + 1) * TILE;
player.y = (8 * 16 + 1) * TILE;
context.WildernessChunks.update(0.2);
snap = controller.snapshot();
assert.strictEqual(snap.center.x, 8);
assert.strictEqual(snap.center.z, 8);
assert.ok(snap.unloads >= 2, 'distant chunks should unload before the moved-to neighborhood allocates replacements');
assert.strictEqual(snap.loaded, 1, 'the new player chunk should stream without rebuilding a whole neighborhood at once');
assert.strictEqual(snap.queued, 8, 'the moved-to mobile neighborhood should keep its eight surrounding chunks queued');

context.WildernessChunks.primeZone(currentArea, 8 * 16 + 1, 8 * 16 + 1);
snap = controller.snapshot();
assert.strictEqual(snap.loaded, 1, 'explicit transitions/teleports should synchronously keep only the player chunk resident');
assert.strictEqual(snap.queued, 8, 'explicit low-memory priming should leave surrounding chunks paced');

const attached = new Node();
assert.strictEqual(context.WildernessChunks.attachObject(currentArea, 8 * 16 + 1, 8 * 16 + 1, attached), true);
assert.ok(attached.parent?.userData?.wildernessChunk, 'tile-owned runtime patches should attach to their chunk');

const rebuilt = context.WildernessChunks.rebuildZone(currentArea, 8 * 16 + 1, 8 * 16 + 1);
assert.strictEqual(rebuilt, 1, 'an edit with only the player chunk resident should rebuild only that chunk immediately');
assert.strictEqual(controller.snapshot().loaded, 1);

currentArea = 'farm';
context.WildernessChunks.update(5);
assert.strictEqual(controller.snapshot().loaded, 0, 'inactive wilderness chunks should be released after the delay');
assert.ok(disposedChunks > 0, 'unloading must execute owned-resource cleanup');

context.WildernessChunks.destroyZone('map_northern_cliffs');
assert.strictEqual(context.WildernessChunks.snapshot().zones.length, 0);

console.log('Wilderness low-memory chunk lifecycle tests passed.');