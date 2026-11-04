#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Assertions protect the Cliff Door's authored geometry and movement contract.
const fs = require('node:fs'); // Reads the shipped JSON and Furniture Author library, not duplicate fixtures.
const path = require('node:path'); // Resolves project-relative paths from any invocation directory.
const root = path.resolve(__dirname, '..'); // Base path shared by all authored data reads.
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Loads the current repository artifact.
const base = 'docs/config/furniture-authored/'; // Directory containing the reference door and the new Cliff Door.
const door = JSON.parse(read(base + 'cliffDoor.json')); // New furniture definition under test.
const wooden = JSON.parse(read(base + 'woodenDoor.json')); // Existing reference for exact dimensions and frame positions.
const catalog = JSON.parse(read(base + 'index.json')); // Confirms runtime/editor manifest registration.
const parts = new Map(door.parts.map(part => [part.id, part])); // Looks up each independently authored moving or static component.
const original = new Map(wooden.parts.map(part => [part.name, part])); // Finds the corresponding original door geometry.

assert.equal(door.schema, wooden.schema);
assert.equal(door.key, 'cliffDoor');
assert.deepEqual(door.footprint, wooden.footprint);
assert.equal(parts.size, 5, 'darkness, stone leaf, two posts and lintel must have unique IDs');
for (const [id, originalName] of [
  ['cliff_door_slab', 'Wooden Door Slab'],
  ['cliff_door_left_post', 'Left Door Post'],
  ['cliff_door_right_post', 'Right Door Post'],
  ['cliff_door_header', 'Doorway Header'],
]) {
  const part = parts.get(id); // Target rockified component inspected on this iteration.
  const reference = original.get(originalName); // Unmodified matching reference piece.
  assert.ok(part && reference, id + ' must exist alongside its reference');
  assert.deepEqual(part.transform, reference.transform, id + ' must retain the regular door dimensions');
  assert.equal(part.materialRole, 'stone');
  assert.equal(part.materialTexture, 'carved_smooth.png');
  assert.equal(part.rockShape?.enabled, true);
  assert.ok(part.rockShape.roughness > 0 && part.rockShape.roughness < .2, 'stone should be only lightly rockified');
}
const backing = parts.get('cliff_door_darkness'); // Static unlit plane behind the rising slab.
assert.ok(backing && backing.color === '#000000');
assert.equal(backing.materialLighting, 'unlit');
assert.equal(backing.materialTexture, null);
assert.equal(backing.rockShape, undefined, 'the black plane is not a rock');
assert.ok(backing.transform.z < parts.get('cliff_door_slab').transform.z, 'darkness belongs behind the door');
assert.equal(backing.transform.sx, parts.get('cliff_door_slab').transform.sx);
assert.equal(backing.transform.sy, parts.get('cliff_door_slab').transform.sz, 'slab is rotated to stand upright');
const motion = door.puzzle.motion; // Only the door slab may move when raised/lowered.
assert.equal(door.puzzle.behavior, 'toggle');
assert.equal(door.puzzle.blocksMovement, true);
assert.equal(motion.collisionOpenProgress, 1, 'door collision must clear only when fully raised');
assert.deepEqual(Object.keys(motion.parts), ['cliff_door_slab']);
assert.deepEqual(motion.parts.cliff_door_slab.off, parts.get('cliff_door_slab').transform);
assert.ok(motion.parts.cliff_door_slab.on.y - motion.parts.cliff_door_slab.off.y > 1.08);
assert.equal(motion.parts.cliff_door_slab.on.x, motion.parts.cliff_door_slab.off.x);
assert.equal(motion.parts.cliff_door_slab.on.z, motion.parts.cliff_door_slab.off.z);
assert.equal(catalog.furniture.filter(item => item.key === door.key && item.file === 'config/furniture-authored/cliffDoor.json').length, 1);
assert.match(read('docs/tools/furniture-avatar-author/index.html'), /docs\\/config\\/furniture-authored\\/cliffDoor\\.json/);
console.log('Cliff Door authored geometry, stationary backing, vertical motion and catalog registration OK.');
