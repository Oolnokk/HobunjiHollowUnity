#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Checks that the two-tile gate faithfully extends the existing one-tile door.
const fs = require('node:fs'); // Loads the authored assets and manifest directly from this checkout.
const path = require('node:path'); // Makes fixture paths independent of the current shell directory.
const root = path.resolve(__dirname, '..'); // Repository root used by all asset reads.
const read = name => fs.readFileSync(path.join(root, name), 'utf8'); // Shared source-file reader.
const directory = 'docs/config/furniture-authored/'; // Both gate and reference door are authored furniture.
const door = JSON.parse(read(directory + 'cliffDoor.json')); // Author-approved narrow-door geometry and animation source.
const gate = JSON.parse(read(directory + 'cliffGate.json')); // Two-tile gate being verified.
const index = JSON.parse(read(directory + 'index.json')); // Runtime furniture catalog.
const originalParts = new Map(door.parts.map(part => [part.id, part])); // Source part IDs used for one-to-one comparisons.
const gateParts = new Map(gate.parts.map(part => [part.id, part])); // Wider part IDs used for assembly comparisons.
const sourceMotion = door.puzzle.motion.parts.cliff_door_slab; // Author's compressed OPEN state must be retained.
const gateMotion = gate.puzzle.motion.parts.cliff_gate_slab; // Gate-only transition that animates independently from Cliff Door.

assert.equal(gate.key, 'cliffGate');
assert.equal(gate.id, 'cliffGate');
assert.equal(gate.name, 'Cliff Gate');
assert.equal(gate.schema, door.schema);
assert.deepEqual(gate.footprint, { w:2, d:1 });
assert.equal(gate.parts.length, door.parts.length - 1, 'walk-through gate omits the exterior teleport door backing');
assert.equal(gateParts.size, gate.parts.length, 'every gate part requires a unique authored ID');

for (const original of door.parts) {
  if (original.id === 'cliff_door_darkness') continue; // The exterior teleport door alone needs a black backing.
  const id = original.id.replace('cliff_door_', 'cliff_gate_'); // Each source part maps to one distinct gate piece.
  const part = gateParts.get(id); // Target part retains the original role and material.
  assert.ok(part, 'missing Cliff Gate part: ' + id);
  assert.equal(part.kind, original.kind, id + ' must keep its mesh type');
  assert.equal(part.color, original.color, id + ' must keep its original color');
  assert.equal(part.materialRole, original.materialRole, id + ' must keep its material role');
  assert.equal(part.materialTexture, original.materialTexture, id + ' must keep its texture');
  assert.equal(part.materialLighting, original.materialLighting, id + ' must keep its light response');
  const transform = { ...original.transform, x:original.transform.x * 2 }; // The wider version spreads all components horizontally.
  if (id === 'cliff_gate_slab') transform.sx *= 2; // The vertical slab uses local X for width.
  if (id === 'cliff_gate_header') transform.sy *= 2; // The 90-degree-rotated lintel uses local Y for world X.
  assert.deepEqual(part.transform, transform, id + ' must scale only its world-X position and width');
  if (original.rockShape) {
    assert.deepEqual({ ...part.rockShape, seed:null }, { ...original.rockShape, seed:null }, id + ' must retain the rock surface settings');
    assert.equal(part.rockShape.seed, original.rockShape.seed, id + ' must preserve the same rock pattern while stretching');
  } else {
    assert.equal(part.rockShape, undefined, 'only stone pieces remain in the cave-facing gate');
  }
}

assert.equal(gateParts.has('cliff_gate_darkness'), false, 'the walk-through gate must not construct a black portal');
assert.equal(gateParts.get('cliff_gate_right_post').transform.sy, originalParts.get('cliff_door_right_post').transform.sy);
assert.equal(gateParts.get('cliff_gate_left_post').transform.sy, originalParts.get('cliff_door_left_post').transform.sy);
assert.equal(gateParts.get('cliff_gate_header').transform.sy, originalParts.get('cliff_door_header').transform.sy * 2);

assert.equal(gate.puzzle.role, door.puzzle.role);
assert.equal(gate.puzzle.behavior, door.puzzle.behavior);
assert.equal(gate.puzzle.blocksMovement, true);
assert.equal(gate.puzzle.channel, 'cliffGate', 'a separate mechanism channel must not move Cliff Door');
assert.notEqual(gate.puzzle.channel, door.puzzle.channel);
assert.equal(gate.puzzle.motion.durationSeconds, door.puzzle.motion.durationSeconds);
assert.equal(gate.puzzle.motion.reversalSeconds, door.puzzle.motion.reversalSeconds);
assert.equal(gate.puzzle.motion.collisionOpenProgress, door.puzzle.motion.collisionOpenProgress);
assert.deepEqual(Object.keys(gate.puzzle.motion.parts), ['cliff_gate_slab'], 'only the slab moves; the stone frame stays fixed');
assert.deepEqual(gateMotion.off, gateParts.get('cliff_gate_slab').transform);
assert.deepEqual(gateMotion.on, { ...sourceMotion.on, x:sourceMotion.on.x * 2, sx:sourceMotion.on.sx * 2 });
assert.equal(gateMotion.on.y, 1.0851, 'use the author-approved raised center');
assert.equal(gateMotion.on.sz, 0.001, 'use the author-approved near-flat opening height');

assert.equal(index.furniture.filter(item => item.key === gate.key && item.file === 'config/furniture-authored/cliffGate.json').length, 1);
assert.equal(index.furniture.filter(item => item.key === door.key && item.file === 'config/furniture-authored/cliffDoor.json').length, 1);
assert.ok(read('docs/tools/furniture-avatar-author/index.html').includes("'docs/config/furniture-authored/cliffGate.json'"), 'the Furniture Author must load the gate');
console.log('Cliff Gate: 2x width, 2x1 tile footprint, retained author animation, no black passage backing and catalog OK.');
