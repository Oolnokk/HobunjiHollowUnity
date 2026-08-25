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
assert.strictEqual(snap.loaded, 9, 'arrival should synchronously build a 3x3 neighborhood');
assert.strictEqual(snap.queued, 16, 'remaining 5x5 outer ring should stay queued');
assert.ok(builtBounds.every(bounds =>
  bounds.colEnd - bounds.colStart <= 16 &&
  bounds.rowEnd - bounds.rowStart <= 16
), 'every runtime build must stay inside a 16x16 tile chunk');

context.WildernessChunks.update(1 / 60);
snap = controller.snapshot();
assert.strictEqual(snap.loaded, 10, 'streaming budget should build one queued chunk per update');
assert.strictEqual(snap.queued, 15);

player.x = (8 * 16 + 1) * TILE;
player.y = (8 * 16 + 1) * TILE;
context.WildernessChunks.update(1 / 60);
snap = controller.snapshot();
assert.strictEqual(snap.center.x, 8);
assert.strictEqual(snap.center.z, 8);
assert.ok(snap.unloads >= 10, 'chunks beyond the hysteresis radius should unload');
assert.strictEqual(snap.loaded, 1, 'the new neighborhood should stream rather than build all at once');

context.WildernessChunks.primeZone(currentArea, 8 * 16 + 1, 8 * 16 + 1);
snap = controller.snapshot();
assert.strictEqual(snap.loaded, 9, 'explicit transitions/teleports should prime the safe 3x3 neighborhood');

const attached = new Node();
assert.strictEqual(context.WildernessChunks.attachObject(currentArea, 8 * 16 + 1, 8 * 16 + 1, attached), true);
assert.ok(attached.parent?.userData?.wildernessChunk, 'tile-owned runtime patches should attach to their chunk');

const rebuilt = context.WildernessChunks.rebuildZone(currentArea, 8 * 16 + 1, 8 * 16 + 1);
assert.strictEqual(rebuilt, 9, 'an edit should rebuild the resident chunk plus its one-chunk seam halo');
assert.strictEqual(controller.snapshot().loaded, 9);

currentArea = 'farm';
context.WildernessChunks.update(5);
assert.strictEqual(controller.snapshot().loaded, 0, 'inactive wilderness chunks should be released after the delay');
assert.ok(disposedChunks > 0, 'unloading must execute owned-resource cleanup');

context.WildernessChunks.destroyZone('map_northern_cliffs');
assert.strictEqual(context.WildernessChunks.snapshot().zones.length, 0);

console.log('Wilderness chunk lifecycle tests passed.');
