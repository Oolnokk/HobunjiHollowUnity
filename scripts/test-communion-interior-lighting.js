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
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  sub(other) { this.x -= other.x; this.y -= other.y; this.z -= other.z; return this; }
  dot(other) { return this.x * other.x + this.y * other.y + this.z * other.z; }
  setFromMatrixColumn(_matrix, index = 0) {
    this.x = index === 0 ? Math.cos(cameraAngle) : 0;
    this.y = index === 1 ? 1 : 0;
    this.z = index === 0 ? -Math.sin(cameraAngle) : 0;
    return this;
  }
}
const gradients = []; // Captures actual radial stop positions and radii from compositor draws.
const fills = []; // Captures the room's darkness independently of light pools.
const ctx = { // Minimal Canvas2D draw recorder.
  clearRect() {}, beginPath() {}, arc() {}, fill() {},
  fillRect() { fills.push(this.fillStyle); },
  createRadialGradient(x, y, inner, outerX, outerY, radius) {
    const gradient = { radius, mode: this.globalCompositeOperation, stops: [], addColorStop(at, color) { this.stops.push([at, color]); } }; // Records light-compositing mode as well as the palette, so glass tints cannot revert to floor decals.
    gradients.push(gradient);
    return gradient;
  },
};
let area = 'map_i_temple'; // Switches between interior, mine and outdoor policies.
let activeScene = {}; // Test the live scene independently of the player-area value.
let now = 1000; // Advances past the overlay's existing redraw throttle.
let cameraAngle = 0; // Orbits the test camera around the player to verify farmhouse light projection across a quarter turn.
let cameraDistance = 10; // Preserves the original far-plane fixture while allowing a close third-person orbit test.
let localLights = []; // Opt-in local light fixtures.
let sources = []; // Active daylight windows only.
const lightingWindow = { // Loads the complete lighting module, without initializing unrelated mist geometry.
  THREE: { Vector3 },
  WeatherFX: { init() {}, getLightingState: () => ({ r: 255, g: 255, b: 255, a: 0.04 }) },
  DaylightWindowRuntime: { getActiveSources: () => sources, drawProjectedLight() { throw new Error('legacy stained-glass floor projection must not run'); } },
};
vm.runInNewContext(read('docs/js/cloud-forest-fog.js'), { window: lightingWindow, performance: { now: () => now }, console });
lightingWindow.WeatherFX.init({
  lctx: ctx, camera: {
    matrixWorld: {}, near: 0.1, far: 110,
    getWorldPosition(target) { return target.set(-cameraDistance * Math.sin(cameraAngle), 0, -cameraDistance * Math.cos(cameraAngle)); },
    getWorldDirection(target) { return target.set(Math.sin(cameraAngle), 0, Math.cos(cameraAngle)); },
  },
  player: { x: 0, y: 0 }, TILE: 1, npcWalkers: [], getPlayerWorldY: () => 0,
  getCurrentArea: () => area, _isBuildingArea: id => id.startsWith('map_i_'),
  getActiveScene: () => activeScene, getThreeRect: () => ({ width: 100, height: 100 }),
  worldToOverlay: (x, y, z) => ({ x: x * Math.cos(cameraAngle) - z * Math.sin(cameraAngle), y: 50 + y, visible: z + 10 > 0.1 && z + 10 < 110 }),
  getFurnitureLightSources: () => localLights, getLightningAlpha: () => 0, getSceneTransAlpha: () => 0,
});
function draw(stepMs = 100) { // Allows a short-interval redraw assertion without weakening the existing scene-transition coverage.
  gradients.length = 0;
  fills.length = 0;
  now += stepMs;
  lightingWindow.WeatherFX.drawLightingOverlay();
}
draw();
assert.equal(fills[0], 'rgba(0,0,0,0.8)', 'windowless rooms are 80% dark outside local light pools');
draw(17);
assert.equal(fills.length, 1, 'camera-following lighting redraws at approximately 60 Hz');
assert.equal(gradients[0].radius, 6, 'carried interior lantern radius doubles');
assert.deepEqual(gradients[0].stops.map(stop => stop[0]), [0, 0.36, 0.72, 1], 'interior lantern fades linearly across its whole radius');
localLights = [{ x: 3, y: 1, z: 2, distance: 3, intensity: 1, color: { r: 255, g: 180, b: 80 } }];
draw();
assert.equal(gradients[1].radius, 7.5, 'furniture light reaches twice its former radius');
assert.deepEqual(gradients[1].stops.map(stop => stop[0]), [0, 0.36, 0.72, 1], 'lamp reveal has no bright plateau or abrupt knee');
assert.deepEqual(gradients[2].stops.map(stop => stop[0]), [0, 0.36, 0.72, 1], 'lamp color glow fades linearly too');

// Farmhouse lights remain present when their sources rotate behind the camera.
// Both the candle and window retain their full range while the camera turns a quarter-circle.
activeScene = { userData: { hobunjiPlayerFarmhouseInterior: true } };
cameraDistance = 3;
cameraAngle = 0;
localLights = [{ x: 3, y: 1, z: -4, distance: 3, intensity: 1, color: { r: 255, g: 180, b: 80 } }];
sources = [{ radiusTiles: 3, strength: 1, mesh: { getWorldPosition(point) { point.x = 0; point.y = 1; point.z = -4; } } }];
draw();
assert.equal(gradients.filter(entry => Math.abs(entry.radius - 7.5) < 0.001).length, 3, 'farmhouse candle and window both illuminate the room when behind the camera');
assert(gradients.some(entry => Math.abs(entry.radius - 0.55) < 0.001), 'window pane glow remains visible when the player is within the window light range but farther than the pane radius');
cameraAngle = Math.PI / 2;
draw();
assert.equal(gradients.filter(entry => Math.abs(entry.radius - 7.5) < 0.001).length, 3, 'both farmhouse lights remain active after a 90-degree camera turn');
assert(gradients.some(entry => Math.abs(entry.radius - 0.55) < 0.001), 'window pane glow also survives the 90-degree camera turn');
localLights = [{ x: 0, y: 1, z: -20, distance: 3, intensity: 1, color: { r: 255, g: 180, b: 80 } }];
sources = [];
draw();
assert.equal(gradients.length, 0, 'a farmhouse light outside its world-space range does not illuminate the player view');
activeScene = {};
sources = [];
localLights = [];
cameraDistance = 10;
cameraAngle = 0;

// A light just beyond the camera far plane must keep its soft edge while its world-space radius overlaps the clip range.
localLights = [{ x: 95, y: 1, z: 102, distance: 5, intensity: 1, color: { r: 255, g: 180, b: 80 } }];
draw();
assert(gradients.some(entry => Math.abs(entry.radius - 10) < 0.001), 'off-screen light center remains active while its influence sphere overlaps the far clip plane');

// Once the entire light volume is beyond the far plane, it must not leak into the scene.
localLights = [{ x: 95, y: 1, z: 112, distance: 5, intensity: 1, color: { r: 255, g: 180, b: 80 } }];
draw();
assert(!gradients.some(entry => Math.abs(entry.radius - 10) < 0.001), 'light is clipped after its entire influence sphere passes the far plane');

localLights = [];
sources = [{ radiusTiles: 3, strength: 1, mesh: { getWorldPosition(point) { point.x = 3; point.y = 1; point.z = 2; } } }];
draw();
assert.equal(gradients.at(-1).radius, 7.5, 'window daylight has a broad pool');
assert.deepEqual(gradients.at(-1).stops.map(stop => stop[0]), [0, 0.36, 0.72, 1], 'window daylight pool uses linear falloff');

sources = [{ radiusTiles: 3, strength: 1, projectionPalette: ['#ff2040', '#20a0ff', '#ffe060'], mesh: { getWorldPosition(point) { point.x = 3; point.y = 1; point.z = 2; } } }]; // A patterned Life Temple pane supplies dye colors, not a screen-projected texture.
draw();
for (const rgb of ['255,32,64', '32,160,255', '255,224,96']) {
  const aura = gradients.find(entry => entry.stops.some(([, color]) => color.startsWith(`rgba(${rgb},`)));
  assert(aura, `diffuse daylight keeps glass dye ${rgb} rather than losing all color to white light`);
  assert.equal(aura.mode, 'screen', 'glass dye is a light wash over the existing fake-daylight compositor');
  assert(aura.radius > 6, 'window colors spread beyond the existing daylight reveal, rather than outlining the window motif');
  assert.deepEqual(aura.stops.map(([at]) => at), [0, 0.45, 1], 'glass dye glows have broad overlapping gradients, not hard-edged panes');
}
assert.equal(gradients.filter(entry => entry.mode === 'screen' && entry.stops.length === 3).length, 3,
  'one stained pane softly blends its three palette colors without a separate floor-projection draw');

area = 'interior'; // Live player farmhouse, rather than a map_i_* authored building.
sources = [];
localLights = [];
draw();
assert.equal(fills[0], 'rgba(0,0,0,0.8)', 'farmhouse receives the same 80% shared interior darkness as authored rooms');
assert.equal(gradients[0].radius, 6, 'farmhouse carried light uses the same doubled, linear indoor radius');
activeScene = { userData: { hobunjiPlayerFarmhouseInterior: true } }; // Real player farmhouse scene suppresses the old unconditional player-lit circle.
draw();
assert.equal(fills[0], 'rgba(0,0,0,0.8)', 'ordinary farmhouse base darkness is painted even without any local light source');
assert.equal(gradients.length, 0, 'unlit farmhouse no longer draws an always-on player lantern hole through the darkness');
area = 'farm'; // Scene wins over a stale farm area id.
draw();
assert.equal(fills[0], 'rgba(0,0,0,0.8)', 'active farmhouse scene always paints ordinary interior base darkness');
assert.equal(lightingWindow.CloudForestFog.getDebugState().lastInteriorDarknessDraw?.alpha, 0.8,
  'mobile diagnostics report a real farmhouse darkness fill');
assert.equal(gradients.length, 0, 'scene fallback does not re-enable the phantom lantern');
activeScene = {};
draw();
assert.notEqual(fills[0], 'rgba(0,0,0,0.8)', 'returning to the farm restores outdoor lighting');
area = 'map_i_town_mine_f_1';
draw();
assert.equal(gradients.filter(entry => entry.mode === 'screen' && entry.stops.length === 3).length, 0,
  'a stray glass source never tints underground mine darkness (the building-area selector includes mines)');
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
