'use strict';
const assert = require('node:assert/strict'); // Checks live bed builders and actual map collision adaptation.
const fs = require('node:fs'); // Reads shipped maps and source authorities.
const vm = require('node:vm'); // Executes production helpers without booting the game.
const game = fs.readFileSync('docs/game.js', 'utf8'); // The existing furniture factory is the authority for player-placed beds.
const defsStart = game.indexOf('const DECORATIVE_FURNITURE_DEFS ='); // Locate the complete literal definition block for evaluation.
const defsEnd = game.indexOf('\n      };', defsStart) + 9; // Keep all definitions intact rather than reconstructing the tested beds.
const builderStart = game.indexOf('function makeDecorativeFurnitureMesh('); // Isolate the real factory, whose game services are injected below.
const builderEnd = game.indexOf('\n      }', builderStart) + 8;
let refreshes = 0; // Each newly placed bed must refresh the shared geometry support registry.
const context = vm.createContext({ window: { HobunjiWalkableElevation: { refreshFurniture: () => refreshes++ } },
  currentArea: 'interior', decorativeFurnitureSize: () => ({ fw: 1, fd: 2 }), furnitureSurfaceYAtWorld: () => 0,
  buildFurnitureVisual: () => ({ userData: {}, position: { set() {} }, rotation: {} }), _markOutline() {}, _markFurnitureEdgeId() {} }); // Minimal ordinary game services, with no duplicated placement implementation.
vm.runInContext(game.slice(defsStart, defsEnd) + '\n' + game.slice(builderStart, builderEnd), context);
for (const key of ['basicBed', 'doubleBed', 'bedroll']) {
  assert(vm.runInContext(`DECORATIVE_FURNITURE_DEFS.${key}.walkable`, context), 'player furniture movement must allow bed footprints');
  const result = context.makeDecorativeFurnitureMesh(2, 3, key, { add() {} }, 'interior', 0); // Execute the real player-placement factory.
  assert.equal(result.mesh.userData.walkableElevation, true);
  assert.equal(result.mesh.userData.walkableElevationArea, 'interior');
}
assert.equal(refreshes, 3);
vm.runInContext(fs.readFileSync('docs/js/interior-furniture-grid.js', 'utf8'), context);
let beds = 0; // Every existing authored bed should carry the stage's actual tags.
for (const file of fs.readdirSync('docs/config/maps').filter(file => file.endsWith('.json'))) {
  const data = JSON.parse(fs.readFileSync('docs/config/maps/' + file, 'utf8')); // Real authored map fixtures.
  for (const record of data.furniture || []) {
    if (!['basicBedFurniture', 'doubleBedFurniture', 'bedrollFurniture'].includes(record.itemKey)) continue;
    beds++;
    assert.equal(record.walkableElevation, true, `${file}: stage elevation tag`);
    assert.equal(record.nonColliding, true, `${file}: stage collision tag`);
    const adapted = context.window.InteriorFurnitureGrid.adaptEffectiveMap({ schema: 'hobunji_building_interior.v1', furniture: [record], colliders: [] }); // Bed alone must not bake any solid floor tiles.
    assert.equal(adapted.colliders.length, 0);
  }
}
assert(beds >= 27);
console.log('walkable beds: authored stage tags, collision-free footprints, and player-placement support registration pass');
