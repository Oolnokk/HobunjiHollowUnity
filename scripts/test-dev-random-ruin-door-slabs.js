'use strict';
// Regression for js/dev-random-ruin-door-slabs.js: V50 hangs each door from the top of its 2.35 arch
// with a 1.9 slab, so a closed door hovers 0.45 above the floor on the stories the render proxy never
// normalises. The pass lowers the door root to arch base + slab height, exactly as the proxy does.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Obj {
  constructor(x = 0, y = 0, z = 0) { this.children = []; this.parent = null; this.position = { x, y, z }; this.userData = {}; }
  add(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
}
const slab = height => { const mesh = new Obj(); mesh.isMesh = true; mesh.geometry = { boundingBox:{ min:{ y:-height / 2 }, max:{ y:height / 2 } }, computeBoundingBox() {} }; return mesh; };
const window = {};
vm.runInContext(fs.readFileSync('docs/js/dev-random-ruin-door-slabs.js', 'utf8'), vm.createContext({ window }), { filename:'dev-random-ruin-door-slabs.js' });
const Slabs = window.DevRandomRuinDoorSlabs;
assert.ok(Slabs?.normalize);

const FLOOR = 4.06, ARCH_H = 2.35, SLAB = 1.9;
function makeStory() {
  const root = new Obj(), shell = new Obj(); root.add(shell);
  const stone = new Obj(10, FLOOR + ARCH_H, 5); stone.userData = { previewMotion:{ type:'stoneDoor' }, mechanismId:'door_a', motionName:'verticalStoneDoor' }; stone.add(slab(SLAB));
  const transit = new Obj(20, FLOOR + ARCH_H, 7); transit.userData = { transitDoor:true }; transit.add(slab(SLAB));
  const stoneArch = new Obj(10, FLOOR, 5), transitArch = new Obj(20, FLOOR, 7);
  stoneArch.userData.archFootprint = { width:2.5, depth:.5 }; transitArch.userData.archFootprint = { width:1.5, depth:.5 };
  const stray = new Obj(40, FLOOR + ARCH_H, 40); stray.userData = { previewMotion:{ type:'stoneDoor' }, mechanismId:'door_b', motionName:'verticalStoneDoor' }; stray.add(slab(SLAB)); // No arch beside it.
  shell.add(stone, transit, stoneArch, transitArch, stray);
  return { root, stone, transit, stray };
}

// Before: the slab bottom is 0.45 above the floor (door origin FLOOR + 2.35, slab hangs 1.9).
let { root, stone, transit, stray } = makeStory();
assert.ok(Math.abs((stone.position.y - SLAB) - (FLOOR + .45)) < 1e-9, 'fixture: V50 leaves a 0.45 gap');
assert.equal(Slabs.normalize(root), 2, 'both doors with an arch are lowered');
for (const door of [stone, transit]) {
  assert.ok(Math.abs(door.position.y - (FLOOR + SLAB)) < 1e-9, 'door origin at arch base + slab height');
  assert.ok(Math.abs((door.position.y - SLAB) - FLOOR) < 1e-9, 'slab bottom is exactly on the floor');
}
assert.ok(Math.abs(stray.position.y - (FLOOR + ARCH_H)) < 1e-9, 'a door with no arch beside it is left alone');
assert.equal(Slabs.normalize(root), 0, 'idempotent: a second pass changes nothing');

// Matches the render proxy's own arithmetic (door.position.y = arch.y + slab bbox height), so running both agrees.
({ root, stone } = makeStory());
const bbox = stone.children[0].geometry.boundingBox;
Slabs.normalize(root);
assert.ok(Math.abs(stone.position.y - (FLOOR + (bbox.max.y - bbox.min.y))) < 1e-9, 'same placement as normalizeDoorAssemblies');

// A taller slab (any generator variant) still ends on the floor.
({ root, stone } = makeStory());
stone.children[0].geometry = { boundingBox:{ min:{ y:-1.1 }, max:{ y:1.1 } }, computeBoundingBox() {} };
Slabs.normalize(root);
assert.ok(Math.abs((stone.position.y - 2.2) - FLOOR) < 1e-9, 'slab bottom on the floor for any slab height');

console.log('dev random ruin door slabs regression passed');
