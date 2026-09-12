const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('docs/js/farm-buildings.js', 'utf8');
const worldObjects = new Map();
const farmBuildings = [{ id: 'barn_test', kind: 'barn', tier: 'small', col: 4, row: 5, w: 4, h: 3, stage: 'built' }];
let onRoof = true;
let enteredMap = null;

const context = {
  console,
  fetch: async () => ({ ok: false, status: 404, statusText: 'not needed', json: async () => null }),
  window: {
    HobunjiRoofClimb: { isPlayerOnRoof: () => onRoof },
    HousePieces: { rebuildStructureMeshes() {} },
    FarmAnimals: { canSpawnAt: () => false },
  },
  THREE: {},
  HousePieceGen: undefined,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'farm-buildings.js' });

const deps = {
  TileType: { TRENCH:1, TILLED:2, RAISED:3, PADDY:4, RIVER:5, STREAM:6, WATERFALL:7, RAMP:8, ROCK:9, SHRUB:10, WEEDS:11, GRASS:12 },
  COLS: 60,
  ROWS: 50,
  worldObjects,
  inventory: {},
  animalObjects: new Set(),
  UUMKAOII_DEW_COOLDOWN_DAYS: 3,
  houseWallBuilder: null,
  getGrid: () => Array.from({ length: 50 }, () => Array.from({ length: 60 }, () => ({ type: 12 }))),
  getHousePieceRects: () => [],
  getFarmBuildings: () => farmBuildings,
  setFarmBuildings() {},
  getBarnTiers: () => ({ small: { label: 'Small Barn', slots: 4, planItem: 'small_barn_plan' } }),
  loadWorldLivestock: () => [],
  saveWorldLivestock() {},
  hasFarmPermission: () => true,
  loadHousePieceFaceTexture() { return null; },
  scene: { add() {}, remove() {} },
  debugLog() {},
  saveFarmLayout() {},
  saveMemberWorldData() {},
  recomputeWater() {},
  markTileDirty() {},
  clampInventoryStack() {},
  setFarmLivestockFocusBarnId() {},
  openMenu() {},
  enterBuilding(mapId) { enteredMap = mapId; },
};

context.window.FarmBuildings.init(deps);
context.window.FarmBuildings.spawnEntry(farmBuildings[0]);
const barn = worldObjects.get('4,5');
assert.ok(barn, 'built barn registers a world interaction object');

let enter = barn.getButtons().find(button => button.action === 'obj_barn_enter_barn_test');
assert.ok(enter, 'barn exposes its normal enter action');
assert.equal(enter.allowed, false, 'Enter Barn is disabled while the player is on a structural roof');
let result = barn.onAction('obj_barn_enter_barn_test');
assert.equal(result.ok, false, 'direct enter action is rejected from the roof as a second line of defense');
assert.match(result.message, /climb down/i);
assert.equal(enteredMap, null, 'roof entry never transitions into the barn interior');

onRoof = false;
enter = barn.getButtons().find(button => button.action === 'obj_barn_enter_barn_test');
assert.equal(enter.allowed, true, 'Enter Barn becomes available again after climbing down');
result = barn.onAction('obj_barn_enter_barn_test');
assert.equal(result.ok, true, 'ground-level barn entry still works');
assert.equal(enteredMap, 'map_i_barn_barn_test');

console.log('roof barn entry guard tests passed');
