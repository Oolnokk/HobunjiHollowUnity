'use strict';
// The ruin's hallway gates are authored doors (frame + leaf + one seal) cut to the gate width,
// not plain boxes. Runs the real builder in docs/js/dev-random-ruin-furniture-pieces.js against
// the real authored JSON, with a small THREE stub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); } }
class Obj {
  constructor() { this.children = []; this.parent = null; this.position = new V(); this.rotation = new V(); this.scale = new V(1, 1, 1); this.userData = {}; this.visible = true; this.name = ''; }
  add(...items) { for (const item of items) { item.parent?.remove?.(item); item.parent = this; this.children.push(item); } }
  remove(item) { this.children = this.children.filter(child => child !== item); item.parent = null; }
  traverse(fn) { fn(this); for (const child of [...this.children]) child.traverse(fn); }
}
const THREE = { Vector3: V, Group: Obj, Color: class {} };

const read = rel => fs.readFileSync(rel, 'utf8');
const data = {};
for (const key of ['ruinPassageDoorSlim', 'ruinPassageDoorNarrow', 'ruinPassageDoor', 'ruinPassageDoorWide'])
  data[key] = JSON.parse(read(`docs/config/furniture-authored/${key}.json`));

const loaded = [];
const window = {
  THREE,
  AuthoredFurniture: {
    load: key => loaded.push(key),
    peek: key => data[key] || null,
    buildGroup: record => { // One mesh per authored part, indexed by id, like the real runtime.
      const group = new Obj(), meshById = new Map();
      for (const part of record.parts) { const mesh = new Obj(); mesh.name = 'authored_' + record.key + '_' + part.name; group.add(mesh); meshById.set(part.id, mesh); }
      group.userData.meshById = meshById;
      return group;
    },
  },
  DynamicSurfaces: { addBeforeRenderClient() {} },
};
vm.createContext(window);
window.window = window;
window.performance = { now: () => 0 };
vm.runInContext(read('docs/js/dev-random-ruin-furniture-pieces.js'), window, { filename: 'dev-random-ruin-furniture-pieces.js' });
const Pieces = window.DevRandomRuinFurniturePieces;
assert.ok(Pieces?.buildPassageGate, 'gate builder is exported');

// Every variant loads, is registered for the author, and has one seal on its leaf.
const index = JSON.parse(read('docs/config/furniture-authored/index.json'));
for (const [key, record] of Object.entries(data)) {
  assert.ok(loaded.includes(key), `${key} is loaded with the other ruin pieces`);
  assert.ok(index.furniture.some(entry => entry.key === key), `${key} is listed in index.json`);
  assert.equal(record.decals.length, 1, `${key} carries exactly one seal`);
  assert(!record.parts.some(part => part.id === 'recess'), `${key} must expose real hallway geometry, not a black backing block`);
  assert.equal(record.decals[0].surfacePartId, 'leaf', `${key} seal sits on the leaf`);
  const leaf = record.parts.find(part => part.id === 'leaf').transform;
  assert.ok(Math.abs(record.decals[0].width * leaf.sx - record.decals[0].height * leaf.sy) < 1e-3, `${key} seal is a circle, not an oval`);
}

// The nearest variant is chosen by span: the ruin builds 3-wide wing gates and 5-6 wide native gates.
const pick = span => Pieces.passageVariantFor(span).key;
assert.equal(pick(1), 'ruinPassageDoorSlim');
assert.equal(pick(2), 'ruinPassageDoorNarrow');
assert.equal(pick(3), 'ruinPassageDoor');
assert.equal(pick(5), 'ruinPassageDoorWide');
assert.equal(pick(6), 'ruinPassageDoorWide');

// A gate is placed, oriented, and stretched to its span and height; only the leaf toggles.
const parent = new Obj();
const gate = Pieces.buildPassageGate({ span: 6, height: 3, normalAxis: 'x', parent, name: 'test-gate', position: { x: 10.5, y: 4, z: 7.5 } });
assert.ok(gate, 'gate builds once its JSON is loaded');
assert.equal(gate.key, 'ruinPassageDoorWide');
assert.equal(gate.root.parent, parent);
assert.equal(gate.root.name, 'test-gate');
assert.ok(Math.abs(gate.root.scale.x - 6 / 5) < 1e-9 && Math.abs(gate.root.scale.y - 3 / 2.4) < 1e-9, 'stretched to span x height');
assert.ok(Math.abs(gate.root.rotation.y - Math.PI / 2) < 1e-9, "normalAxis 'x' faces +X");
assert.deepEqual([gate.root.position.x, gate.root.position.y, gate.root.position.z], [10.5, 4, 7.5]);
assert.ok(gate.object.name.startsWith('leaf:'), 'the leaf pivot is the toggled object');
assert.equal(gate.object.parent, gate.root);
assert.equal(gate.object.children.length, 1, 'the pivot holds the leaf mesh');
assert(!gate.root.userData.meshById.has('recess'), 'the built gate has no opaque fake passage geometry');
gate.object.visible = false;
const frame = gate.root.children.filter(child => child !== gate.object);
assert.ok(frame.length >= 4 && frame.every(child => child.visible), 'frame stays up when the gate opens');
assert.equal(Pieces.buildPassageGate({ span: 3, normalAxis: 'z' }).root.rotation.y, 0, "normalAxis 'z' keeps the authored +Z facing");

// An older cached furniture profile must not recreate the black mesh during generation.
const previous = data.ruinPassageDoor.parts; // Restored after the runtime sanitizer regression.
data.ruinPassageDoor.parts = [...previous, { id:'recess', name:'Legacy Black Backing', kind:'box' }];
const cachedGate = Pieces.buildPassageGate({ span:3 }); // The same builder handles stale cache and fresh authored JSON.
assert(cachedGate && !cachedGate.root.userData.meshById.has('recess'), 'cached old passage data cannot recreate the black plane');
assert(data.ruinPassageDoor.parts.some(part => part.id === 'recess'), 'sanitizing the runtime copy must not mutate editor-authoring data');
data.ruinPassageDoor.parts = previous;

// Transition doors intentionally retain their darkness; only walk-through gates lose the backing.
assert(JSON.parse(read('docs/config/furniture-authored/cliffDoor.json')).parts.some(part => part.id === 'cliff_door_darkness'));
assert(JSON.parse(read('docs/config/furniture-authored/ruinEntranceDoor.json')).parts.some(part => part.id === 'recess'));

// Until the JSON has loaded the builder returns null, so callers keep their plain box.
delete data.ruinPassageDoor;
assert.equal(Pieces.buildPassageGate({ span: 3 }), null);

console.log('ruin passage gate regression passed');
