'use strict';

const assert = require('node:assert/strict'); // Behavioral regression assertions.
const fs = require('node:fs'); // Loads the actual map and runtime owners.
const vm = require('node:vm'); // Runs browser modules without a WebGL context.
const read = file => fs.readFileSync(file, 'utf8'); // Shared fixture reader.
const temple = JSON.parse(read('docs/config/maps/map_i_temple.json')); // Current authored temple, including its alternate layout.
const window = {}; // Browser globals shared by map resolution and station registration.
vm.runInNewContext(read('docs/js/map-layout-system.js'), { window });
const effective = window.MapLayoutSystem.getEffectiveMapData(temple, { minutes: 60, weekday: 'Anan', dateOrdinal: 1 }); // Midnight service variant.
assert.equal(effective.activeLayoutId, 'spirit_communion');
assert.deepEqual(effective.ceiling, temple.ceiling, 'service preserves both gables and the carved roof');
const roomWindows = temple.furniture.filter(piece => piece.wallOrnamentKey); // Shared permanent architecture across all temple layouts.
assert.equal(roomWindows.length, 5, 'temple has all five authored stained-glass windows');
const rug = temple.furniture.find(piece => piece.itemKey === 'rugFurniture'); // Default room's newly authored carpet dimensions and pattern.
assert(rug, 'temple carpet remains installed');
assert.equal(rug.gridW, 4);
assert.equal(rug.gridD, 11);
assert.equal(rug.gridRot, 90);
assert.equal(rug.nonColliding, true);
const rugDefinition = JSON.parse(read('docs/config/furniture-authored/rug.json')); // Ensures the carpet override targets a real exported part.
assert(rugDefinition.parts.some(part => part.id === 'part_msc11atv_br5pr'));
assert.equal(rug.patternOverrides?.part_msc11atv_br5pr?.[0]?.patternId, 'winding_roots');
const windowDefinition = JSON.parse(read('docs/config/furniture-authored/crossbarWindow.json')); // Ensures the glass override targets an existing pane part.
assert(windowDefinition.parts.some(part => part.id === 'crossbar_window_pane'));
for (const pane of roomWindows) {
  const glass = pane.patternOverrides?.crossbar_window_pane?.[0]; // Per-window palette, motif stack, and separate non-tiling overpass.
  assert(glass, `window ${pane.id} retains its glass override`);
  assert.equal(glass.patternId, 'winding_roots');
  assert.equal(glass.patterns?.[1]?.repoPatternId, glass.overpassPatternId);
  assert.equal(glass.layerTransforms?.[1]?.tiling, false);
  assert.deepEqual(effective.furniture.find(piece => piece.id === pane.id), pane, 'Spirit Communion retains every stained-glass setting and placement');
}
window.MapLayoutSystem.setFlag('templeWedding', true);
const wedding = window.MapLayoutSystem.getEffectiveMapData(temple, { minutes: 570, weekday: 'Anan', dateOrdinal: 1 }); // Ceremony replaces furniture wholesale.
assert.equal(wedding.activeLayoutId, 'wedding');
for (const pane of roomWindows) {
  assert.deepEqual(wedding.furniture.find(piece => piece.id === pane.id), pane, 'wedding keeps all five mounted stained-glass windows and their patterns');
}
window.MapLayoutSystem.setFlag('templeWedding', false);
vm.runInNewContext(read('docs/js/npc-scheduling.js'), { window });
window.NpcScheduling.init({
  normalizeNpcArea: area => area,
  getDecorativeFurnitureKeyByItemKey: key => ({ benchFurniture: 'bench', stoolFurniture: 'stool' })[key] || '',
  decorativeFurnitureDefs: { bench: { sit: true }, stool: { sit: true } },
});
const ordinary = window.MapLayoutSystem.getEffectiveMapData(temple, { minutes: 570, weekday: 'Anan', dateOrdinal: 1 }); // Morning service uses the regular pews.
window.NpcScheduling.registerNpcStations(ordinary.npcStations, 'map_i_temple');
for (let i = 1; i <= 11; i++) {
  const station = window.NpcScheduling.resolveNpcStationTarget(`station_temple_pew_${i}`); // Must bind to a real bench, not an inventory key.
  const authored = ordinary.npcStations.find(piece => piece.id === station.id); // Source binding after effective layout resolution.
  const bench = ordinary.furniture.find(piece => piece.id === authored.sourceFurnitureId); // Actual pew instance.
  assert(bench, `pew ${i} has a real bench`);
  assert.equal(station.furnitureKey, 'bench');
  assert.equal(station.c, bench.col + (bench.postX || 0));
  assert.equal(station.rotY, bench.rotY);
}

class Vector3 { // Only the projection operations used by the real overlay compositor.
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  setFromMatrixColumn() { this.x = 1; this.y = 0; this.z = 0; return this; }
}
const gradients = []; // Captures actual radial stop positions and radii from compositor draws.
const fills = []; // Captures the room's darkness independently of light pools.
const ctx = { // Minimal Canvas2D draw recorder.
  clearRect() {}, beginPath() {}, arc() {}, fill() {},
  fillRect() { fills.push(this.fillStyle); },
  createRadialGradient(x, y, inner, outerX, outerY, radius) {
    const gradient = { radius, stops: [], addColorStop(at, color) { this.stops.push([at, color]); } }; // Inspectable CanvasGradient substitute.
    gradients.push(gradient);
    return gradient;
  },
};
let area = 'map_i_temple'; // Switches between interior, mine and outdoor policies.
let now = 1000; // Advances past the overlay's existing redraw throttle.
let localLights = []; // Opt-in local light fixtures.
let sources = []; // Active daylight windows only.
const lightingWindow = { // Loads the complete lighting module, without initializing unrelated mist geometry.
  THREE: { Vector3 },
  WeatherFX: { init() {}, getLightingState: () => ({ r: 255, g: 255, b: 255, a: 0.04 }) },
  DaylightWindowRuntime: { getActiveSources: () => sources },
};
vm.runInNewContext(read('docs/js/cloud-forest-fog.js'), { window: lightingWindow, performance: { now: () => now }, console });
lightingWindow.WeatherFX.init({
  lctx: ctx, camera: { matrixWorld: {} },
  player: { x: 0, y: 0 }, TILE: 1, npcWalkers: [], getPlayerWorldY: () => 0,
  getCurrentArea: () => area, _isBuildingArea: id => id.startsWith('map_i_'),
  getActiveScene: () => ({}), getThreeRect: () => ({ width: 100, height: 100 }),
  worldToOverlay: (x, y, z) => ({ x, y: z, visible: true }),
  getFurnitureLightSources: () => localLights, getLightningAlpha: () => 0, getSceneTransAlpha: () => 0,
});
function draw() {
  gradients.length = 0;
  fills.length = 0;
  now += 100;
  lightingWindow.WeatherFX.drawLightingOverlay();
}
draw();
assert.equal(fills[0], 'rgba(0,0,0,0.8)', 'windowless rooms are 80% dark outside local light pools');
assert.equal(gradients[0].radius, 4.8, 'carried interior lantern radius doubles');
assert.deepEqual(gradients[0].stops.map(stop => stop[0]), [0, 1], 'interior lantern fades linearly across its whole radius');
localLights = [{ x: 3, y: 1, z: 2, distance: 3, intensity: 1, color: { r: 255, g: 180, b: 80 } }];
draw();
assert.equal(gradients[1].radius, 6, 'furniture light reaches twice its former radius');
assert.deepEqual(gradients[1].stops.map(stop => stop[0]), [0, 1], 'lamp reveal has no bright plateau or abrupt knee');
assert.deepEqual(gradients[2].stops.map(stop => stop[0]), [0, 1], 'lamp color glow fades linearly too');
sources = [{ radiusTiles: 3, strength: 1, mesh: { getWorldPosition(point) { point.x = 3; point.y = 1; point.z = 2; } } }];
draw();
assert.equal(gradients.at(-1).radius, 6, 'window daylight has a broad pool');
assert.deepEqual(gradients.at(-1).stops.map(stop => stop[0]), [0, 1], 'window daylight pool uses linear falloff');
area = 'map_i_town_mine_f_1';
draw();
assert.equal(fills[0], 'rgba(0,0,0,0.99)', 'mine darkness is preserved');
assert.equal(gradients[0].radius, 2.4, 'mine lantern radius keeps its existing tuning');
assert.equal(gradients[0].stops.length, 4, 'mine lantern profile remains unchanged');
area = 'farm';
draw();
assert.equal(gradients[0].radius, 2.4, 'outdoor lantern radius is preserved');
assert.equal(gradients[0].stops.length, 4, 'outdoor lantern profile remains unchanged');
console.log('Communion structure, pew bindings and interior linear lighting tests passed');

vm.runInNewContext(read('docs/js/interior-furniture-grid.js'), { window });
const gameSource = read('docs/game.js'); // Execute the actual scene grid-construction block against a collision fixture.
const gridBuild = gameSource.slice(gameSource.indexOf('          const bGrid = Array.from({ length: rows }'), gameSource.indexOf('          // Build transitions from exits array', gameSource.indexOf('          const bGrid = Array.from({ length: rows }'))); // Keeps furniture tagging wired to gameplay, not just a synthetic tile property.
const fixture = window.InteriorFurnitureGrid.adaptEffectiveMap({ // Solid chair and an independently authored wall on a second furniture tile.
  schema: 'hobunji_building_interior.v1', cols: 8, rows: 8,
  floor: Array.from({ length: 64 }, (_, i) => [i % 8, Math.floor(i / 8)]),
  colliders: [[5, 4]],
  furniture: [
    { id: 'seat', itemKey: 'stoolFurniture', col: 4, row: 4 },
    { id: 'wall-seat', itemKey: 'stoolFurniture', col: 5, row: 4 },
  ],
});
const gridContext = { mapData: fixture, cols: 8, rows: 8, TileType: { ROCK: 1, GRASS: 0 }, CropType: { NONE: 0 } }; // Same inputs used by loadBuildingScene.
vm.runInNewContext(gridBuild + '\nglobalThis.result = bGrid;', gridContext);
const grid = gridContext.result; // Real game-generated fixture grid.
assert.equal(grid[4][4].npcFurnitureCollider, true, 'furniture occupancy remains distinguishable from a wall');
assert.equal(grid[4][5].npcFurnitureCollider, false, 'manual wall under furniture remains structural');
vm.runInNewContext(read('docs/js/npc-pathfinding.js'), { window, console });
window.NpcPathfinding.init({
  isBuildingArea: () => true,
  npcGridForArea: () => grid,
  isSolid: type => type === 1,
  furnitureBlocksMovementAt: () => false,
  npcMovementConfig: () => ({ collisionRadiusTiles: 0.22 }),
  npcSeatTransformForTarget: target => target.furnitureKey ? { x: 4.6, y: 0.25, z: 4.5 } : null,
});
assert.equal(window.NpcPathfinding.isNpcTileWalkable('map_i_temple', 4, 4), false, 'ordinary movement cannot cross a baked furniture tile');
assert.equal(window.NpcPathfinding.canNpcBeeline('map_i_temple', 4.6, 3.5, 4.1, 4, true), true, 'seat approach may enter its baked furniture cell');
assert.equal(window.NpcPathfinding.canNpcBeeline('map_i_temple', 5.5, 3.5, 5, 4, true), false, 'seat approach cannot override structural wall collision');
const walker = { // Furniture origin is deliberately far from its transformed seat anchor.
  area: 'map_i_temple', rec: { id: 'shifted-seat-regression' },
  currentScheduleTarget: { area: 'map_i_temple', c: 2.25, r: 4, pose: 'sit', furnitureKey: 'bench' },
  root: { position: { x: 4.6, z: 3.5 } },
  moveToward(x, z) { this.root.position.x = x; this.root.position.z = z; return true; },
  _tryStartGridPath() {},
};
window.NpcPathfinding.decorateWalkerCollision(walker);
assert.equal(walker._tryStartGridPath(walker.currentScheduleTarget), true, 'shifted seats resolve a grid path');
assert.equal(walker._gridPath.at(-1).col, 4, 'grid path ends at actual seat cell instead of furniture origin');
assert.equal(walker.moveToward(4.6, 4.5, 1), true, 'runtime walker can reach the shifted physical seat');
assert.equal(walker.root.position.x, 4.6);
assert.equal(walker.root.position.z, 4.5);
console.log('Baked furniture collisions and transformed NPC seat approaches passed');
