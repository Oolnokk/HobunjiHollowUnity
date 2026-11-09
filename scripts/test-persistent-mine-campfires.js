#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/wilderness-campfire.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const mine = fs.readFileSync('docs/js/town-mine.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const arcUi = fs.readFileSync('docs/js/action-arc-ui.js', 'utf8'); // Return to Camp travel now lives in the modularized utilities-wheel handler, not inline in game.js.

const scene = {
  add(object) { object.parent = this; },
  remove(object) { if (object?.parent === this) object.parent = null; },
};
const furniture = { particleEmitters: [] };
const player = { x: 0, y: 0, vx: 0, vy: 0 };
let area = 'map_i_town_mine_f_005';
let persistCount = 0;
let tothalYear = 7; // Used to distinguish a same-year boot replay from a genuine new-year shift.
const inventory = { campfireKitFurniture: 3 };
const saveMeta = { worlds: [{ id: 'world_test', lastTothalYear: 7 }] }; // Used by campfire clearIfZone() to classify Tothal rebuilds.

const context = {
  console,
  Promise,
  window: {
    PerkSystem: { rank: () => 1 },
    CookingSystem: { openAtHearth() {} },
    AlchemySystem: { setCampfireBrewing() {} },
    CalendarSystem: { yearNumber: () => tothalYear, tothalCycle: () => tothalYear },
    __hobunjiPlayerProfile: { worldId: 'world_test' },
    localStorage: { getItem: key => key === 'hobunjiSaveMeta' ? JSON.stringify(saveMeta) : null },
    __farmLog() {},
  },
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'wilderness-campfire.js' });
const camp = context.window.WildernessCampfire;
camp.init({
  getCurrentArea: () => area,
  isZoneArea: value => value === 'map_northern_cliffs',
  isMineArea: value => /^map_i_town_mine_f_/.test(value),
  isAreaSceneReady: () => true,
  getActiveScene: () => scene,
  getPlayer: () => player,
  getFacingAngle: () => 0.75,
  surfaceYAt: () => 0.2,
  TILE: 16,
  AuthoredFurniture: {
    load: async () => furniture,
    peek: () => furniture,
    buildGroup: () => ({ position: { set() {} }, rotation: { y: 0 }, parent: null }),
    createEmitterVisual: () => ({ update() {}, dispose() {} }),
  },
  persist: () => { persistCount += 1; },
  showToast() {},
  openMenu() {},
  inventory,
  clampInventoryStack() {},
  buildInventoryGrid() {},
  refreshItemScroll() {},
});

assert.equal(camp.supportsArea(area), true, 'mine floor is a valid campfire area');
assert.equal(camp.placeFromKit(5, 7).ok, true, 'campfire can be placed underground');
assert.equal(inventory.campfireKitFurniture, 3, 'legacy item placement is free and never consumes a kit');
assert.equal(camp.serialize().mapId, 'map_i_town_mine_f_005', 'underground placement is serializable world state');
inventory.campfireKitFurniture = 0;
inventory.wood = 0;
inventory.stone = 0;
inventory.gold = 0;
player.x = 9.5 * 16;
player.y = 10.5 * 16;
const freeSetupInventory = JSON.stringify(inventory); // Verifies free utility setup leaves all resources untouched.
const beforeFreeSetupPersist = persistCount; // Confirms the direct setup persists its replacement camp.
assert.equal(camp.placeAtPlayer().ok, true, 'utilities can set up a mine camp with no kit, materials, or gold');
assert.equal(camp.serialize().x, 9.5, 'free setup snaps to the player tile, not to an arbitrary old camp location');
assert.equal(camp.serialize().z, 10.5, 'free setup uses the player row');
assert.equal(JSON.stringify(inventory), freeSetupInventory, 'free setup consumes no items or currency');
assert.equal(persistCount, beforeFreeSetupPersist + 1, 'free setup saves the replacement camp');
const savedMineCamp = camp.serialize();

area = 'farm';
assert.equal(camp.placeAtPlayer().ok, false, 'free setup is unavailable on the farm');
assert.deepEqual(camp.serialize(), savedMineCamp, 'invalid area cannot replace a saved camp');
camp.updateVfx(0.016);
assert.deepEqual(camp.serialize(), savedMineCamp, 'leaving the placement map does not delete persistent camp state');

camp.restore(savedMineCamp);
area = 'map_i_town_mine_f_005';
camp.updateVfx(0.016);
player.x = savedMineCamp.x * 16;
player.y = savedMineCamp.z * 16;
assert.equal(camp.getNearbyActions().length, 3, 'mine camp exposes normal Save/Cook/Brew actions');

assert.equal(camp.relocateForGeneratedMineFloor(area, [[1, 1], [8, 8]]), true, 'regenerated floor can relocate a persisted camp to safe geometry');
assert.equal(camp.serialize().x, 8.5, 'mine camp chooses nearest safe floor tile');
assert.equal(camp.clearMineCampfireOnDeath(), true, 'mine death destroys an underground camp');
assert.equal(camp.serialize(), null, 'mine death clears persistent camp state');

area = 'map_northern_cliffs';
assert.equal(camp.placeFromKit(2, 3).ok, true, 'legacy wilderness kit action works even with no kits in inventory');
assert.equal(inventory.campfireKitFurniture, 0, 'the legacy action never takes or grants a kit');
assert.equal(camp.clearMineCampfireOnDeath(), false, 'mine death cleanup does not destroy a wilderness camp');
assert.equal(camp.serialize().mapId, 'map_northern_cliffs');
const savedWildernessCamp = camp.serialize();
const beforeReplayPersistCount = persistCount;
assert.equal(camp.clearIfZone('map_northern_cliffs'), true, 'same-year zone reconstruction invalidates only the old visual');
assert.deepEqual(camp.serialize(), savedWildernessCamp, 'same-year boot reconstruction preserves the restored wilderness camp');
assert.equal(persistCount, beforeReplayPersistCount, 'same-year boot reconstruction does not overwrite the saved camp with null');
assert.ok(camp.getDebugState().history.some(entry => entry.event === 'same-year-rebuild-preserved'), 'debug trace records the preserved same-year reconstruction');

tothalYear = 8;
const beforeRealShiftPersistCount = persistCount;
assert.equal(camp.clearIfZone('map_northern_cliffs'), true, 'genuine new-year Tothal Shift still clears a wilderness camp');
assert.equal(camp.serialize(), null, 'genuine new-year terrain replacement invalidates the old camp coordinates');
assert.equal(persistCount, beforeRealShiftPersistCount + 1, 'genuine new-year camp removal is persisted immediately');
assert.ok(camp.getDebugState().history.some(entry => entry.event === 'clear' && entry.details.reason === 'tothal-shift'), 'debug trace identifies genuine Tothal deletion');

area = 'map_i_town_mine_f_012';
assert.equal(camp.placeFromKit(4, 4).ok, true, 'placing a new camp replaces the previous global camp');
assert.equal(camp.serialize().mapId, 'map_i_town_mine_f_012');
player.x = NaN;
assert.equal(camp.placeAtPlayer().ok, false, 'non-finite player positions cannot create corrupt saved camp coordinates');
assert.equal(camp.serialize().mapId, 'map_i_town_mine_f_012', 'invalid positions do not erase a saved camp');
assert.ok(persistCount >= 4, 'placement/death changes are persisted immediately');

assert.match(source, /HobunjiSaveCheckpoints[\s\S]{0,320}saveCampfire/, 'campfire Save Game prefers the guarded dedicated campfire checkpoint API');
assert.match(source, /saveCampfire \|\| checkpoints\?\.saveManual/, 'campfire keeps a narrow old-cache compatibility fallback without making Manual Save its normal slot');
assert.match(game, /member\.wildernessCampfireState = window\.WildernessCampfire\?\.serialize/, 'game saves campfire world state');
assert.match(game, /WildernessCampfire\?\.restore\(playerData\.wildernessCampfireState\)/, 'game restores campfire world state');
assert.match(game, /clearMineCampfireOnDeath/, 'mine player death clears underground camp');
assert.match(game, /supportsArea\?\.\(currentArea\)/, 'placement and nearby interaction gates accept supported mine areas');
assert.match(arcUi, /requestReturnToCampfire[\s\S]{0,180}enterBuilding\(campfire\.mapId\)/, 'Return to Camp can travel back to a mine floor');
assert.match(arcUi, /id: 'set-up-camp'[\s\S]{0,130}label: 'Set Up Campfire \(Free\)'/, 'utility wheel offers free campfire setup instead of requiring inventory');
assert.match(arcUi, /disabled: !canSetUpCampfire/, 'utility action is disabled in unsupported areas');
assert.match(arcUi, /WildernessCampfire\?\.placeAtPlayer\?\.\(\)/, 'utility action invokes direct placement without a kit');
assert.doesNotMatch(arcUi, /id: 'select-kit'/, 'utility wheel no longer disables setup for an empty inventory');
assert.match(game, /isMineArea: area => !!window\.TownMine\?\.floorFromMapId/, 'mine-area classification is injected into campfire system');
assert.match(mine, /relocateForGeneratedMineFloor/, 'regenerated mine floors preserve underground camp placement');
assert.match(mine, /persistedCampfire[\s\S]{0,180}excluded\.add/, 'mine content scatter reserves the persistent camp tile');
assert.match(index, /survives map changes\/saves and also works on Town/, 'index documentation no longer claims campfires clear on map change');

console.log('Persistent mine campfire tests passed');
