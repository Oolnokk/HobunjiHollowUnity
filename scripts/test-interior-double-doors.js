'use strict';
// Paired-door geometry, mechanism ownership, interactions, and shipped map parity.
const assert = require('node:assert/strict'); // Behavioral assertions below.
const fs = require('node:fs'); // Loads the shipped door and all authored maps.
const vm = require('node:vm'); // Executes the shared browser authority.
const window = {}; // Runtime APIs injected below.
vm.runInNewContext(fs.readFileSync('docs/js/interior-door-tiles.js', 'utf8'), { window, console });
const Doors = window.InteriorDoorTiles; // Shared runtime and editor API.
const data = JSON.parse(fs.readFileSync('docs/config/furniture-authored/woodenDoor.json', 'utf8')); // Actual authored transforms, materials, and swing endpoints.
const original = JSON.stringify(data); // Proves pair generation cannot mutate shared furniture.
const pair = Doors.doubleDoorData(data); // Derived geometry registered as one mechanism.
assert.equal(JSON.stringify(data), original);
assert.equal(pair.parts.length, 7, 'two panels, two latches, two outer posts, one header');
assert.equal(new Set(pair.parts.map(part => part.id)).size, 7);
for (const part of pair.parts) {
  assert.equal(part.materialTexture, 'carved_smooth.png', `${part.name}: matching wood texture`);
  assert.ok(pair.puzzle.motion.parts[part.id], `${part.name}: registered animation`);
  assert.deepEqual(pair.puzzle.motion.parts[part.id].off, part.transform);
}
const leaves = pair.parts.filter(part => part.name.endsWith('Door Slab')); // Opposite leaves must meet at the seam and swing from opposite sides.
assert.equal(leaves.length, 2);
assert.equal(leaves[0].transform.x, -leaves[1].transform.x);
assert.ok(Math.abs(leaves[1].transform.x * 2 - leaves[1].transform.sx) < 1e-9, 'closed panels meet at centre');
for (const state of ['off', 'on']) {
  assert.equal(pair.puzzle.motion.parts[leaves[0].id][state].rz, -pair.puzzle.motion.parts[leaves[1].id][state].rz);
}
for (const direction of ['north', 'south', 'east', 'west']) {
  const vertical = direction === 'east' || direction === 'west'; // Door width lies perpendicular to its inward direction.
  const tiles = vertical ? [[3, 3], [3, 4]] : [[3, 3], [4, 3]]; // Two adjacent leaves in each orientation.
  const map = { exits: [{ id: 'pair', tiles, generateDoor: true, direction }] }; // Mirrors effective game transitions.
  const floor = new Set(tiles.map(tile => tile.join(','))); // Only painted tiles receive meshes.
  const groups = Doors.doorGroupsOf(map, floor); // Same grouping used in build().
  assert.equal(groups.length, 1, direction);
  assert.equal(groups[0].tiles.length, 2);
  assert.equal(Doors.recordOrientation(floor, groups[0]).facing, direction);
}
// Automatic orientation must ignore neighbouring door tiles when finding the room.
for (const painted of [true, false]) {
  const tiles = [[3, 3], [3, 4]]; // A vertical pair on a west wall, with the room to its east.
  const map = painted ? { doorTiles: tiles } : { exits: [{ id: 'automatic', tiles, generateDoor: true }] }; // Both authoring paths allow Automatic direction.
  const floor = new Set(['3,3', '3,4', '4,3', '4,4']); // Neighbouring leaves are not inward room space.
  const groups = Doors.doorGroupsOf(map, floor); // Vertical pairs used to infer north/south and remain separate.
  assert.equal(groups.length, 1, 'automatic vertical pair has one frame');
  assert.equal(groups[0].direction, 'east');
  if (!painted) {
    for (const [col, row] of tiles) assert.equal(Doors.exitSettings(map, { exitId: 'automatic', col, row, direction: '' }, floor).direction, 'east', 'effective gameplay transitions agree with automatic preview orientation');
  }
}

for (const count of [1, 3, 4, 5]) {
  const tiles = Array.from({ length: count }, (_, i) => [i, 1]); // Longer connected runs must never be partially paired.
  assert.equal(Doors.doorGroupsOf({ doorTiles: tiles }, new Set(tiles.map(tile => tile.join(',')))).length, count);
}
assert.equal(Doors.doorGroupsOf({ exits: [
  { id: 'a', tiles: [[1, 1]], direction: 'north', generateDoor: true },
  { id: 'b', tiles: [[2, 1]], direction: 'north', generateDoor: true },
] }, new Set(['1,1', '2,1'])).length, 2, 'unrelated destinations never merge');

// Every checked-in authored room and its reciprocal opening must agree in width.
const maps = new Map(fs.readdirSync('docs/config/maps').filter(file => /^map_i_.*\.json$/.test(file)).map(file => [file.slice(0, -5), JSON.parse(fs.readFileSync(`docs/config/maps/${file}`, 'utf8'))])); // Filenames are canonical IDs (the temple has an older internal ID).
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json', 'utf8')); // Canonical exterior swap tiles.
const workspace = JSON.parse(fs.readFileSync('docs/config/town-workspace-v1.json', 'utf8')); // Editor workspace can override interior transitions.
for (const [id, map] of maps) {
  for (const exit of map.exits || []) {
    if (!exit.tiles?.length) continue;
    if (!exit.targetMap) {
      const exterior = town.transitions.filter(t => t.targetMapId === id); // Generated wilderness locales have their own single entrance.
      if (exterior.length) assert.equal(exit.tiles.length, exterior.length, `${id}: exterior/interior swap width`);
      assert.equal(exit.tiles.length, 1, `${id}: single exterior entry`);
    } else {
      const reciprocal = maps.get(exit.targetMap)?.exits?.filter(e => e.targetMap === id); // Orphan legacy rooms do not have an active reciprocal route.
      if (reciprocal?.length === 1) assert.equal(exit.tiles.length, reciprocal[0].tiles.length, `${id}: reciprocal width`);
    }
    const bundled = workspace.maps.find(m => m.id === id); // Existing workspace mirrors must not restore removed tiles.
    if (bundled) assert.deepEqual(bundled.transitions.filter(t => t.exitId === exit.id).map(t => [t.col, t.row]).sort(), [...exit.tiles].sort(), `${id}: workspace tiles`);
  }
}

(async () => {
  const groups = []; // Captures the exact furniture recipe passed by the runtime builder.
  const interactions = new Map(); // Both halves must share the same mechanism state.
  const objects = new Map(); // Mechanisms keyed by registered instance ID.
  window.AuthoredFurniture = { peek: () => data, buildGroup: recipe => {
    const group = { recipe, position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, rotation: {}, userData: { blocksMovement: true } }; // Minimal rendered object.
    groups.push(group); return group;
  } };
  window.FurniturePuzzleRuntime = {
    registerMap(id, records, byId) { for (const [key, object] of byId) objects.set(key, object); },
    setMechanism(id, key, open) { objects.get(key).userData.blocksMovement = !open; },
  };
  await Doors.build({ scene: { add() {} }, mapId: 'test', mapData: { doorTiles: [[3, 3], [4, 3]] }, floorSet: new Set(['3,3', '4,3', '3,2', '4,2']), registerInteractable: (c, r, obj) => interactions.set(`${c},${r}`, obj) });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].recipe.parts.length, 7);
  assert.equal(groups[0].position.x, 4);
  assert.equal(interactions.size, 2);
  assert.equal(Doors.blocksBox('test', 3.5, 3.5), true);
  assert.equal(Doors.blocksBox('test', 4.5, 3.5), true);
  interactions.get('4,3').onAction('obj_door_toggle');
  assert.equal(interactions.get('3,3').getButtons()[0].label, 'Close Door');
  assert.equal(Doors.blocksBox('test', 3.5, 3.5), false);
  Doors.tick('test', 1, [], [4.9, 3.5]);
  assert.equal(Doors.debug()[0].doors[0].open, true, 'right edge keeps both leaves open');
  Doors.tick('test', 1, [], [8, 8]);
  assert.equal(Doors.debug()[0].doors[0].open, false);
  Doors.tick('test', .1, [[5.5, 3.5]], null);
  assert.equal(Doors.debug()[0].doors[0].open, true, 'NPC next to second leaf opens the pair');
  assert.equal(Doors.debug()[0].doors[0].width, 2, 'mobile diagnostics expose doorway width');
  console.log(`Paired doors and swap parity across ${maps.size} authored maps passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
