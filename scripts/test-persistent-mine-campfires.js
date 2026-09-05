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
const inventory = { campfireKitFurniture: 3 };

const context = {
  console,
  Promise,
  window: {
    PerkSystem: { rank: () => 1 },
    CookingSystem: { openAtHearth() {} },
    AlchemySystem: { setCampfireBrewing() {} },
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
assert.equal(inventory.campfireKitFurniture, 2, 'placing underground consumes exactly one kit');
assert.equal(camp.serialize().mapId, 'map_i_town_mine_f_005', 'underground placement is serializable world state');
const savedMineCamp = camp.serialize();

area = 'farm';
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
assert.equal(camp.placeFromKit(2, 3).ok, true, 'wilderness camp still works');
assert.equal(camp.clearMineCampfireOnDeath(), false, 'mine death cleanup does not destroy a wilderness camp');
assert.equal(camp.serialize().mapId, 'map_northern_cliffs');

area = 'map_i_town_mine_f_012';
assert.equal(camp.placeFromKit(4, 4).ok, true, 'placing a new camp replaces the previous global camp');
assert.equal(camp.serialize().mapId, 'map_i_town_mine_f_012');
assert.ok(persistCount >= 4, 'placement/death changes are persisted immediately');

assert.match(game, /member\.wildernessCampfireState = window\.WildernessCampfire\?\.serialize/, 'game saves campfire world state');
assert.match(game, /WildernessCampfire\?\.restore\(playerData\.wildernessCampfireState\)/, 'game restores campfire world state');
assert.match(game, /clearMineCampfireOnDeath/, 'mine player death clears underground camp');
assert.match(game, /supportsArea\?\.\(currentArea\)/, 'placement and nearby interaction gates accept supported mine areas');
assert.match(arcUi, /requestReturnToCampfire[\s\S]{0,180}enterBuilding\(campfire\.mapId\)/, 'Return to Camp can travel back to a mine floor');
assert.match(game, /isMineArea: area => !!window\.TownMine\?\.floorFromMapId/, 'mine-area classification is injected into campfire system');
assert.match(mine, /relocateForGeneratedMineFloor/, 'regenerated mine floors preserve underground camp placement');
assert.match(mine, /persistedCampfire[\s\S]{0,180}excluded\.add/, 'mine content scatter reserves the persistent camp tile');
assert.match(index, /survives map changes\/saves and also works on Town/, 'index documentation no longer claims campfires clear on map change');

console.log('Persistent mine campfire tests passed');
