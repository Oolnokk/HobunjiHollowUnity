'use strict';

// Hand-operating an interior door tile must drive its authored open/close
// motion: InteriorDoorTiles has to address FurniturePuzzleRuntime by the same
// map id it registered the door under (the interaction used to flip its own
// flag and prompt while the mechanism never moved or stopped blocking).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const calls = [];
const registered = [];
const window = {
  AuthoredFurniture: {
    peek: () => ({ key: 'woodenDoor' }),
    buildGroup: () => ({ name: '', position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, rotation: {}, userData: {} }),
  },
  FurniturePuzzleRuntime: {
    registerMap: (mapId, records) => registered.push({ mapId, ids: records.map(record => record.id) }),
    setMechanism: (mapId, id, active) => { calls.push({ mapId, id, active }); return true; },
  },
};
const context = vm.createContext({ window, console, Math, Number, Object, Array, Map, Set, Promise });
vm.runInContext(fs.readFileSync('docs/js/interior-door-tiles.js', 'utf8'), context, { filename: 'interior-door-tiles.js' });

(async () => {
  const interactables = new Map();
  const scene = { add(object) { this.door = object; } };
  await window.InteriorDoorTiles.build({
    THREE: {}, scene, mapId: 'map_i_test', mapData: { doorTiles: [[3, 3]] },
    floorSet: new Set(['3,3', '3,2']), surfaceYAt: () => 0,
    registerInteractable: (c, r, interactable) => interactables.set(`${c},${r}`, interactable),
  });

  assert.equal(registered.length, 1);
  assert.equal(registered[0].mapId, 'interiorDoors:map_i_test');
  const door = interactables.get('3,3');
  assert.ok(door, 'door interaction is filed on its tile');
  assert.equal(door.getButtons()[0].label, 'Open Door');
  scene.door.userData.puzzleProgress = 0.5; // Mirrors the in-flight eased mechanism value written by FurniturePuzzleRuntime.
  const blockers = window.InteriorDoorTiles.getLightBlockers('map_i_test', scene);
  assert.equal(blockers.length, 1, 'active scene exposes its interior doorway to the lighting compositor');
  assert.equal(blockers[0].x, 3.5);
  assert.equal(blockers[0].z, 3.5);
  assert.equal(blockers[0].openProgress, 0.5, 'light transmission reads the same intermediate door animation progress');
  assert.equal(window.InteriorDoorTiles.getLightBlockers('map_i_test', {}).length, 0, 'stale map ids cannot return blockers from another active scene');
  scene.door.userData.puzzleProgress = 0.25;
  const refreshed = window.InteriorDoorTiles.getLightBlockers('map_i_test', scene);
  assert.equal(refreshed[0], blockers[0], 'light blockers are refreshed in place so the per-frame lighting pass allocates nothing');
  assert.equal(refreshed[0].openProgress, 0.25, 'the reused record carries the current door progress');

  assert.equal(door.onAction('obj_door_toggle').ok, true);
  assert.deepEqual(calls.pop(), { mapId: 'interiorDoors:map_i_test', id: 'door_3_3', active: true }, 'opening drives the registered mechanism');
  assert.equal(door.getButtons()[0].label, 'Close Door');

  assert.equal(door.onAction('obj_door_toggle').ok, true);
  assert.deepEqual(calls.pop(), { mapId: 'interiorDoors:map_i_test', id: 'door_3_3', active: false }, 'closing drives the registered mechanism');
  console.log('interior door mechanism ok');
})().catch(error => { console.error(error); process.exit(1); });
