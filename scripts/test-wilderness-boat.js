const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/wilderness-boat.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/vehicles/vehicles.json'), 'utf8'));
const editor = fs.readFileSync(path.join(root, 'docs/tools/vehicle-editor/index.html'), 'utf8');
const glb = fs.readFileSync(path.join(root, 'docs/assets/models/vehicles/kenkari-rivership.glb'));

function glbTriangleCount(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'asset is a binary glTF');
  assert.equal(buffer.readUInt32LE(4), 2, 'asset uses glTF 2.0');
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  assert.equal(jsonType, 0x4E4F534A, 'first GLB chunk is JSON');
  const doc = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).replace(/\u0000+$/g, '').trim());
  let triangles = 0;
  for (const mesh of doc.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      assert.equal(primitive.mode ?? 4, 4, 'rivership mesh primitives are triangles');
      const accessor = doc.accessors?.[primitive.indices];
      assert.ok(accessor, 'triangle primitive has an index accessor');
      triangles += accessor.count / 3;
    }
  }
  return triangles;
}

const preset = config.presets.find(record => record.id === 'kenkari_rivership');
assert.ok(preset, 'Kenkari rivership preset exists');
assert.deepEqual(preset.surfaceDetection.walkableTriangleIds, [598, 599], 'preset seeds authored broad deck faces');
assert.equal(preset.surfaceDetection.splitAngleDeg, 24, 'preset shares the 24-degree furniture surface rule');
assert.equal(config.future.wagonsAndChariots.status, 'placeholder', 'wagon/chariot category remains placeholder-only');
assert.equal(glbTriangleCount(glb), 600, 'published rivership GLB remains exactly 600 triangles');
assert.ok(Math.max(...preset.surfaceDetection.walkableTriangleIds) < 600, 'authored walkable face ids remain valid for the published GLB');
assert.match(editor, /real shared edges/i, 'editor documents real shared-edge topology');
assert.match(editor, /current face is within the split angle of its neighbor/i, 'editor uses current-face to neighbor normal continuity');
assert.match(editor, /No seed-normal or growing-average veto/i, 'editor does not reintroduce seed/average-normal vetoes');
assert.match(editor, /Wagons \/ Chariots — placeholder only/i, 'editor exposes land vehicles as placeholder-only');
assert.doesNotMatch(source, /doCook|doBrew|getNearbyActions/, 'boat runtime does not inherit campfire cooking/alchemy interactions');
assert.match(source, /shoreline bounce reverse impulse/, 'runtime contains shoreline reverse-impulse behavior');
assert.match(source, /state\.speed = state\.speed >= 0 \? -bounce : bounce/, 'shoreline collision reverses the boat impulse');

const saveMeta = {
  worlds: [{ id: 'world_1', members: { char_1: { nonGearInventory: {} } } }],
};
const storage = new Map([['hobunjiSaveMeta', JSON.stringify(saveMeta)]]);
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

let currentArea = 'zone_river';
let player = { x: 5.5 * 16, y: 5.5 * 16, vx: 0, vy: 0, angle: Math.PI / 4 };
let persistCount = 0;
const grid = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ type: 'river' })));

const noopElement = {
  addEventListener() {},
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 120 }; },
};
const document = {
  addEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; },
  createElement() { return { ...noopElement, dataset: {}, addEventListener() {} }; },
  head: { appendChild() {} },
};
const window = {
  __hobunjiPlayerProfile: { worldId: 'world_1', characterId: 'char_1' },
  localStorage,
  GridTileAccessors: {
    getActiveGrid: () => grid,
    getActiveCols: () => grid[0].length,
    getActiveRows: () => grid.length,
  },
  __farmLog() {},
};
window.window = window;

const context = vm.createContext({
  console,
  Date,
  Math,
  Set,
  Map,
  JSON,
  Promise,
  document,
  navigator: { getGamepads: () => [] },
  localStorage,
  window,
  setTimeout() { return 1; },
  clearTimeout() {},
  fetch: async () => ({ ok: true, json: async () => config }),
});
vm.runInContext(source, context, { filename: 'wilderness-boat.js' });
const boat = window.WildernessBoat;
boat.init({
  getCurrentArea: () => currentArea,
  isZoneArea: area => String(area).startsWith('zone_'),
  getPlayer: () => player,
  TILE: 16,
  getFacingAngle: () => player.angle,
  getActiveScene: () => null,
  surfaceYAt: () => 0,
  persist: () => { persistCount += 1; },
  showToast() {},
});

assert.equal(boat.canSummonHere(), true, 'player can summon while standing on permanent wilderness water');
assert.equal(boat.__test.isPermanentWaterTile({ type: 'river' }), true);
assert.equal(boat.__test.isPermanentWaterTile({ type: 'stream' }), true);
assert.equal(boat.__test.isPermanentWaterTile({ type: 'waterfall' }), true);
assert.equal(boat.__test.isPermanentWaterTile({ type: 'pond' }), false, 'only existing permanent wilderness water types qualify');

(async () => {
  const first = await boat.summonAtPlayer();
  assert.equal(first.ok, true, 'free water summon succeeds');
  assert.equal(boat.serialize().mapId, 'zone_river');
  assert.equal(boat.serialize().presetId, 'kenkari_rivership');
  assert.equal(boat.serialize().x, 5.5);
  assert.equal(boat.serialize().z, 5.5);
  assert.ok(persistCount >= 1, 'discrete summon requests the existing full save path');

  let saved = JSON.parse(storage.get('hobunjiSaveMeta'));
  assert.equal(saved.worlds[0].members.char_1.wildernessBoatState.presetId, 'kenkari_rivership', 'boat state is stored on the active world member');

  player.x = 7.5 * 16;
  player.y = 7.5 * 16;
  const second = await boat.summonAtPlayer();
  assert.equal(second.ok, true);
  assert.equal(boat.serialize().x, 7.5, 'resummoning relocates the one persistent boat');
  assert.equal(boat.serialize().z, 7.5);

  player.x = 0;
  player.y = 0;
  const returned = boat.returnToBoat();
  assert.equal(returned.ok, true);
  assert.equal(player.x, 7.5 * 16, 'return teleports to the saved boat even when no GLB visual is loaded');
  assert.equal(player.y, 7.5 * 16);

  grid[7][7] = { type: 'grass' };
  assert.equal(boat.canSummonHere(), false, 'ground tile cannot summon a boat');
  grid[7][7] = { type: 'river' };

  currentArea = 'farm';
  assert.equal(boat.canSummonHere(), false, 'boat summon remains wilderness-only');
  currentArea = 'zone_river';

  assert.equal(boat.footprintIsWater(6, 6, 0, preset), true, 'fully waterborne authored footprint is accepted');
  grid[3][4] = { type: 'grass' };
  assert.equal(boat.footprintIsWater(6, 6, 0, preset), false, 'shore overlap rejects forward hull placement');
  grid[3][4] = { type: 'river' };

  assert.equal(boat.clear('test'), true);
  saved = JSON.parse(storage.get('hobunjiSaveMeta'));
  assert.equal(saved.worlds[0].members.char_1.wildernessBoatState, undefined, 'clearing removes boat state from the world member');

  console.log('PASS wilderness boat/editor regression checks');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
