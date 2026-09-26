const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/wilderness-boat.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/vehicles/vehicles.json'), 'utf8'));
const editor = fs.readFileSync(path.join(root, 'docs/tools/vehicle-editor/index.html'), 'utf8');
const glb = fs.readFileSync(path.join(root, 'docs/assets/models/vehicles/kenkari-rivership.glb'));
const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8'); // Verifies canonical save/restore/update integration.
const actionArc = fs.readFileSync(path.join(root, 'docs/js/action-arc-ui.js'), 'utf8'); // Verifies the shared Utilities extension point.
const onboarding = fs.readFileSync(path.join(root, 'docs/onboarding-core.js'), 'utf8'); // Verifies world-member vehicle state reaches runtime.
const index = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Verifies the vehicle runtime loads directly before game.js.

function glbDocument(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'asset is a binary glTF');
  assert.equal(buffer.readUInt32LE(4), 2, 'asset uses glTF 2.0');
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  assert.equal(jsonType, 0x4E4F534A, 'first GLB chunk is JSON');
  return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).replace(/\u0000+$/g, '').trim());
}

function glbTriangleCount(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'asset is a binary glTF');
  assert.equal(buffer.readUInt32LE(4), 2, 'asset uses glTF 2.0');
  const doc = glbDocument(buffer);
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
const glbDoc = glbDocument(glb); // Used to lock the texture mapping to the material names actually exported by the ship GLB.
assert.ok(preset, 'Kenkari rivership preset exists');
assert.deepEqual(preset.surfaceDetection.walkableTriangleIds, [426, 427, 438, 439, 450, 451, 462, 463, 474, 475, 486, 487, 498, 499, 510, 511, 582, 583], 'preset keeps the editor-authored walkable deck faces');
assert.equal(preset.surfaceDetection.splitAngleDeg, 24, 'preset shares the 24-degree furniture surface rule');
assert.deepEqual(preset.steerTrigger.center, [-0.031, 0.509, 0.455], 'preset keeps the editor-authored helm trigger center');
assert.equal(preset.modelYOffset, 0, 'preset carries an independent model Y offset authored relative to the waterline origin');
assert.equal(config.future.wagonsAndChariots.status, 'placeholder', 'wagon/chariot category remains placeholder-only');
assert.equal(glbTriangleCount(glb), 600, 'published rivership GLB remains exactly 600 triangles');
assert.equal((glbDoc.images || []).length, 0, 'published rivership GLB has no embedded texture images, so preset mappings remain required');
const glbMaterialNames = new Set((glbDoc.materials || []).map(material => material.name)); // Material names are the stable join between the GLB and vehicle preset.
for (const materialName of Object.keys(preset.materialTextures || {})) assert.ok(glbMaterialNames.has(materialName), `configured material exists in GLB: ${materialName}`);
assert.equal(preset.materialTextures['Canvas (canvas.png)'], 'assets/textures/carved_smooth.png', 'currently visible former-canvas group uses carved-smooth wood until a real canvas part exists');
assert.equal(preset.materialTextures['Planks (Planks.png)'], 'assets/textures/carved_smooth.png', 'currently visible planks group uses the same carved-smooth wood surface');
assert.equal(preset.materialColors['Canvas (canvas.png)'], '#8b6540', 'former-canvas group uses the shared furniture wood tint');
assert.equal(preset.materialColors['Planks (Planks.png)'], '#8b6540', 'planks group uses the shared furniture wood tint');
for (const texturePath of Object.values(preset.materialTextures)) assert.ok(fs.existsSync(path.join(root, 'docs', texturePath)), `configured vehicle texture exists: ${texturePath}`);
assert.ok(Math.max(...preset.surfaceDetection.walkableTriangleIds) < 600, 'authored walkable face ids remain valid for the published GLB');
assert.match(editor, /real shared edges/i, 'editor documents real shared-edge topology');
assert.match(editor, /current face is within the split angle of its neighbor/i, 'editor uses current-face to neighbor normal continuity');
assert.match(editor, /No seed-normal or growing-average veto/i, 'editor does not reintroduce seed/average-normal vetoes');
assert.match(editor, /Wagons \/ Chariots — placeholder only/i, 'editor exposes land vehicles as placeholder-only');
assert.match(editor, /applyMaterialTextures\(modelRoot\)/, 'editor applies configured material textures to the loaded GLB preview');
assert.match(editor, /material textures=\$\{materialTextureStats\.matched\}\/\$\{materialTextureStats\.configured\}/, 'editor diagnostics expose material mapping success');
assert.match(editor, /id="waterLevelBadge">Water level Y = 0\.00/, 'editor makes the preview water level explicit');
assert.match(editor, /id="modelYOffset"/, 'editor exposes independent model Y offset authoring');
assert.match(editor, /surface-stretch-uv-furniture\.js\?v=20260924edgepreserve2/, 'editor loads the same surface mapper used by cliffs');
assert.match(editor, /mapper\.mapMesh\(mesh,[\s\S]{0,320}edgeReferenceWorldSize:SURFACE_REFERENCE_WORLD_SIZE \/ scale/, 'editor maps each detected hull surface with cliff-parity physical scaling');
assert.match(source, /applyMaterialTextures\(root, record\)/, 'runtime applies the same configured material textures as the editor');
assert.match(source, /applySurfaceStretch\(root, record, fit\.scale\)/, 'runtime applies connected-surface stretch-to-fit after fitting the imported hull');
assert.match(source, /edgeReferenceWorldSize:SURFACE_REFERENCE_WORLD_SIZE \/ scale/, 'runtime compensates cliff UV physical scale for the imported GLB scale');
assert.match(source, /finite\(record\?\.modelYOffset, 0\)/, 'runtime applies the authored model Y offset independently of waterline placement');
assert.match(source, /texture\.flipY = false/, 'runtime preserves glTF UV orientation for repo-loaded replacement textures');
assert.match(editor, /material\.color\?\.set\?\.\(record\?\.materialColors/, 'editor applies the authored vehicle material tint');
assert.match(source, /material\.color\?\.set\?\.\(record\?\.materialColors/, 'runtime applies the same authored vehicle material tint');
assert.doesNotMatch(source, /doCook|doBrew|getNearbyActions/, 'boat runtime does not inherit campfire cooking/alchemy interactions');
assert.match(source, /shoreline bounce reverse impulse/, 'runtime contains shoreline reverse-impulse behavior');
assert.match(source, /state\.speed = state\.speed >= 0 \? -bounce : bounce/, 'shoreline collision reverses the boat impulse');

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
  ActionArcUI: {
    registerUtilityEntries(id, provider) { window.__vehicleUtilityProvider = { id, provider }; return true; },
  },
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
  refreshActionBar() {},
  startSceneTransition(callback) { return callback?.(); },
  enterZone() {},
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

  assert.equal(window.__vehicleUtilityProvider?.id, 'wilderness-boat', 'boat registers through the shared Utilities extension point');
  assert.doesNotMatch(source, /hobunjiSaveMeta|localStorage/, 'boat runtime never writes the save blob directly');
  assert.doesNotMatch(source, /navigator\.getGamepads/, 'boat steering never bypasses the shared controller authority');
  assert.match(source, /ControllerInput\?\.frame/, 'boat steering reads the shared per-frame controller snapshot');
  assert.match(game, /member\.wildernessBoatState = window\.WildernessBoat\?\.serialize/, 'canonical member save captures vehicle state');
  assert.match(game, /WildernessBoat\?\.restore\?\.\(playerData\.wildernessBoatState\)/, 'game restores the active member vehicle');
  assert.match(game, /WildernessBoat\?\.update\?\.\(dt\)/, 'boat updates as a peer world system');
  assert.match(actionArc, /registerUtilityEntries\(id, provider\)/, 'ActionArcUI exposes one shared Utilities extension API');
  assert.match(actionArc, /entries\.splice\(2, 0, \.\.\._extensionUtilityEntries\(\)\)/, 'extension entries use the normal Utilities builder for every input path');
  assert.match(onboarding, /wildernessBoatState: memberState\.wildernessBoatState \|\| null/, 'returning member vehicle state reaches playerData');
  assert.match(index, /surface-stretch-uv-furniture\.js\?v=20260924edgepreserve2[\s\S]{0,260}wilderness-boat\.js\?v=20260926vehicle6/, 'shared cliff mapper is guaranteed before the boat runtime loads');

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

  currentArea = 'town';
  player.x = 6.5 * 16;
  player.y = 6.5 * 16;
  assert.equal(boat.supportsArea(), true, 'Hobunji town is a supported boat area for its permanent river');
  assert.equal(boat.canSummonHere(), true, 'town river tile allows boat summon');
  const townBoat = await boat.summonAtPlayer();
  assert.equal(townBoat.ok, true, 'boat can be summoned directly on the town river');
  assert.equal(boat.serialize().mapId, 'town', 'town-river boat persists against the canonical runtime town area id');
  grid[6][6] = { type: 'grass' };
  assert.equal(boat.canSummonHere(), false, 'ordinary town ground still cannot summon a boat');
  grid[6][6] = { type: 'river' };

  currentArea = 'farm';
  assert.equal(boat.canSummonHere(), false, 'farm remains unsupported even when the active test grid contains river tiles');
  currentArea = 'zone_river';
  player.x = 7.5 * 16;
  player.y = 7.5 * 16;

  assert.equal(boat.footprintIsWater(6, 6, 0, preset), true, 'fully waterborne authored footprint is accepted');
  grid[3][4] = { type: 'grass' };
  assert.equal(boat.footprintIsWater(6, 6, 0, preset), false, 'shore overlap rejects forward hull placement');
  grid[3][4] = { type: 'river' };

  const restored = boat.restore({ presetId: 'kenkari_rivership', mapId: 'zone_river', x: 4.5, y: 0.42, z: 6.5, ry: 0.25, speed: 0 });
  assert.equal(restored.x, 4.5, 'canonical restore hydrates the owned boat without consulting storage');
  assert.equal(restored.z, 6.5);
  assert.equal(boat.clear('test'), true);
  assert.equal(boat.serialize(), null, 'clearing removes the in-memory vehicle state before the canonical save runs');
  assert.ok(persistCount >= 3, 'summon/relocate/clear request the canonical member save path');

  console.log('PASS wilderness boat/editor regression checks');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
