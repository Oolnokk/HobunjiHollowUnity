#!/usr/bin/env python3
from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count} for {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


campfire_source = r'''(() => {
  'use strict';

  // One player-owned portable campfire may exist at a time. It can be placed
  // in a wilderness zone or on a procedural Town Mine floor, persists as
  // world-member state across map changes and game sessions, and silently
  // replaces the previous campfire when a new kit is used. Mine-floor camps
  // are the one exception to indefinite persistence: dying anywhere in the
  // Town Mine destroys the currently placed campfire if that campfire is
  // underground. Reuses the authored campfire furniture + its existing
  // Save/Cook/Brew/Return-to-Camp interactions rather than creating a second
  // underground-only camp system.
  const KIT_ITEM_KEY = 'campfireKitFurniture';

  let deps = null;
  let group = null; // Live campfire THREE.Group in whichever scene currently owns the saved campfire map.
  let visualArea = null; // Map id whose scene currently owns group; kept separate from persistent state.
  let visualSpawnPending = false; // Prevents repeated promise callbacks while authored furniture is still loading.
  let emitterVisuals = []; // Live fire/smoke THREE.Points, one per authored particle emitter.
  let state = null; // Persistent { mapId, x, y, z, ry } placement in tile units.
  let returnPending = false; // Used when Return to Camp must first load/regenerate another map (notably a mine floor).
  let campfireDataPromise = null;

  function init(injectedDeps) { deps = injectedDeps; }

  function supportsArea(area = deps?.getCurrentArea?.()) {
    return !!(area && (deps?.isZoneArea?.(area) || deps?.isMineArea?.(area)));
  }

  function ensureLoaded() {
    if (!campfireDataPromise) campfireDataPromise = deps.AuthoredFurniture.load('campfire');
    return campfireDataPromise;
  }

  function removeVisual() {
    emitterVisuals.forEach(visual => visual?.dispose?.());
    emitterVisuals = [];
    if (group) group.parent?.remove?.(group);
    group = null;
    visualArea = null;
  }

  function isHere() { return !!(state && state.mapId === deps?.getCurrentArea?.()); }

  function returnToCampfire() {
    if (!isHere()) return { ok: false, message: 'No campfire here to return to.' };
    const player = deps.getPlayer();
    player.x = state.x * deps.TILE;
    player.y = state.z * deps.TILE;
    player.vx = 0;
    player.vy = 0;
    returnPending = false;
    return { ok: true, message: 'You return to your campfire.' };
  }

  function spawnVisual() {
    removeVisual();
    if (!state || state.mapId !== deps.getCurrentArea()) return;
    if (deps.isAreaSceneReady?.(state.mapId) === false) return;
    const data = deps.AuthoredFurniture.peek('campfire');
    if (!data) return;
    const targetScene = deps.getActiveScene?.();
    if (!targetScene?.add) return;
    const surfaceY = Number(deps.surfaceYAt?.(state.x, state.z)); // Re-sampled after map regeneration so restored mine fires sit on the rebuilt floor.
    if (Number.isFinite(surfaceY)) state.y = surfaceY;
    const built = deps.AuthoredFurniture.buildGroup(data);
    built.position.set(state.x, state.y, state.z);
    built.rotation.y = state.ry || 0;
    targetScene.add(built);
    group = built;
    visualArea = state.mapId;
    emitterVisuals = (data.particleEmitters || []).map(record => deps.AuthoredFurniture.createEmitterVisual(built, record));
    if (returnPending) returnToCampfire(); // Deferred until the destination scene actually exists, so generated mine entry does not overwrite the teleport.
  }

  function ensureVisualForCurrentArea() {
    const area = deps?.getCurrentArea?.();
    if (!state || state.mapId !== area) {
      if (group) removeVisual(); // Remove only the scene object; persistent placement survives leaving its map.
      return;
    }
    if (deps.isAreaSceneReady?.(area) === false) return;
    const targetScene = deps.getActiveScene?.();
    if (group && visualArea === area && group.parent === targetScene) return;
    if (group) removeVisual();
    if (deps.AuthoredFurniture.peek('campfire')) {
      spawnVisual();
      return;
    }
    if (visualSpawnPending) return;
    visualSpawnPending = true;
    ensureLoaded().then(() => {
      visualSpawnPending = false;
      if (state?.mapId === deps?.getCurrentArea?.()) spawnVisual();
    }).catch(() => { visualSpawnPending = false; });
  }

  // Called every frame so a saved fire automatically reattaches after any
  // scene/map change, including a cold-session restore followed by returning
  // to its old map. This removes the old wilderness-only entry dependency.
  function updateVfx(dt) {
    ensureVisualForCurrentArea();
    for (const visual of emitterVisuals) visual?.update?.(dt, true);
  }

  function place(col, row) {
    const area = deps.getCurrentArea();
    if (!supportsArea(area)) return { ok: false, message: 'You can only set up a campfire in the wilderness or on a mine floor.' };
    const wx = col + 0.5;
    const wz = row + 0.5;
    removeVisual(); // Placing one new fire destroys the old visual globally before replacing its persistent record.
    state = { mapId: area, x: wx, y: deps.surfaceYAt(wx, wz), z: wz, ry: deps.getFacingAngle() };
    returnPending = false;
    ensureVisualForCurrentArea();
    deps.persist?.();
    return { ok: true, message: '🔥 Campfire set up. You can save, cook, mix potions, and return here.' };
  }

  function placeFromKit(col, row) {
    const area = deps.getCurrentArea();
    if (!supportsArea(area)) return { ok: false, message: 'You can only set up a campfire in the wilderness or on a mine floor.' };
    if ((deps.inventory[KIT_ITEM_KEY] || 0) < 1) return { ok: false, message: 'No Campfire Kit to use.' };
    deps.inventory[KIT_ITEM_KEY] -= 1;
    deps.clampInventoryStack?.(KIT_ITEM_KEY);
    deps.buildInventoryGrid?.();
    deps.refreshItemScroll?.();
    return place(col, row);
  }

  function clear() {
    if (!state) return false;
    state = null;
    returnPending = false;
    removeVisual();
    deps.persist?.();
    return true;
  }

  // Tothal Shift only passes wilderness zone ids. The persistent record is
  // destroyed when that specific terrain is replaced, just as before.
  function clearIfZone(mapId) {
    if (state && state.mapId === mapId && deps.isZoneArea?.(mapId)) return clear();
    return false;
  }

  // A death anywhere on a Town Mine floor ends the underground camp. A
  // wilderness camp remains untouched by a mine death.
  function clearMineCampfireOnDeath() {
    if (state && deps.isMineArea?.(state.mapId)) return clear();
    return false;
  }

  // Town Mine floors regenerate their cavern layout on re-entry. Keep the
  // persistent campfire on the same floor, but if its exact old tile no
  // longer exists, move it to the nearest geometry-safe floor tile. The mine
  // generator separately excludes that resulting tile from rocks/enemies.
  function relocateForGeneratedMineFloor(mapId, floorTiles) {
    if (!state || state.mapId !== mapId || !deps.isMineArea?.(mapId) || !Array.isArray(floorTiles) || !floorTiles.length) return false;
    const targetCol = Math.floor(state.x);
    const targetRow = Math.floor(state.z);
    let best = floorTiles[0];
    let bestDistance = Infinity;
    for (const tile of floorTiles) {
      const distance = (tile[0] - targetCol) ** 2 + (tile[1] - targetRow) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = tile; }
      if (distance === 0) break;
    }
    const nextX = best[0] + 0.5;
    const nextZ = best[1] + 0.5;
    if (nextX === state.x && nextZ === state.z) return false;
    state.x = nextX;
    state.z = nextZ;
    state.y = 0; // Re-sampled from the active regenerated scene by spawnVisual().
    return true;
  }

  // Existing wilderness entry callers can keep using this hook, while the
  // per-frame scene reconciliation above also covers mines and cold restores.
  function onZoneEntered(mapId) {
    if (state?.mapId === mapId) ensureVisualForCurrentArea();
  }

  function distanceToPlayerTiles() {
    if (!state) return Infinity;
    const player = deps.getPlayer();
    return Math.hypot(player.x / deps.TILE - state.x, player.y / deps.TILE - state.z);
  }

  const NEARBY_TILES = 1.75;

  function getNearbyActions() {
    if (!isHere() || distanceToPlayerTiles() > NEARBY_TILES) return null;
    const cookRank = window.PerkSystem?.rank('foraging', 'survivalist') || 0;
    const brewRank = window.PerkSystem?.rank('alchemy', 'herbalist') || 0;
    return [
      { icon: '💾', label: 'Save Game', action: 'campfire_save', style: 'primary', allowed: true, worldInteraction: true, promptRoot: group },
      { icon: '🍲', label: cookRank ? 'Cook Here' : 'Cook Here (needs Survivalist)', action: 'campfire_cook', style: 'secondary', allowed: !!cookRank, worldInteraction: true, promptRoot: group },
      { icon: '⚗️', label: brewRank ? 'Make Potions Here' : 'Make Potions Here (needs Herbalist)', action: 'campfire_brew', style: 'secondary', allowed: !!brewRank, worldInteraction: true, promptRoot: group },
    ];
  }

  function doSave() {
    deps.persist?.();
    deps.showToast('💾 Game saved.', true);
  }

  function doCook() {
    const rank = window.PerkSystem?.rank('foraging', 'survivalist') || 0;
    if (!rank) { deps.showToast('You need the Foraging Survivalist perk to cook at a campfire.', false); return; }
    window.CookingSystem?.openAtHearth({ maxIngredients: rank });
  }

  function doBrew() {
    const rank = window.PerkSystem?.rank('alchemy', 'herbalist') || 0;
    if (!rank) { deps.showToast('You need the Alchemy Herbalist perk to mix potions at a campfire.', false); return; }
    window.AlchemySystem?.setCampfireBrewing(true);
    deps.openMenu('alchemy');
  }

  function requestReturnToCampfire() {
    if (!state) return null;
    returnPending = true;
    return { ...state };
  }

  function serialize() { return state ? { ...state } : null; }

  function restore(saved) {
    state = saved && saved.mapId ? { ...saved } : null;
    returnPending = false;
    removeVisual();
  }

  window.WildernessCampfire = {
    init, supportsArea, place, placeFromKit, clear, clearIfZone, clearMineCampfireOnDeath,
    relocateForGeneratedMineFloor, updateVfx, onZoneEntered, isHere, distanceToPlayerTiles,
    getNearbyActions, returnToCampfire, requestReturnToCampfire, doSave, doCook, doBrew,
    serialize, restore, ensureLoaded,
  };
})();
'''
Path('docs/js/wilderness-campfire.js').write_text(campfire_source, encoding='utf-8')

# Let the existing action bar offer placement and interaction on mine floors too.
game = 'docs/game.js'
replace_once(
    game,
    "else if (heldItem && heldItem.key === 'campfireKitFurniture') btns.unshift({ icon: '🔥', label: 'Set Up Campfire', action: 'place_campfire_kit', style: 'primary', allowed: _isZoneArea(currentArea) && (inventory[heldItem.key] || 0) > 0 });",
    "else if (heldItem && heldItem.key === 'campfireKitFurniture') btns.unshift({ icon: '🔥', label: 'Set Up Campfire', action: 'place_campfire_kit', style: 'primary', allowed: !!window.WildernessCampfire?.supportsArea?.(currentArea) && (inventory[heldItem.key] || 0) > 0 });"
)
replace_once(
    game,
    "        const campfireActions = _isZoneArea(currentArea)\n          ? window.WildernessCampfire?.getNearbyActions?.()\n          : null;",
    "        const campfireActions = window.WildernessCampfire?.supportsArea?.(currentArea)\n          ? window.WildernessCampfire?.getNearbyActions?.()\n          : null;"
)

# Destroy only an underground camp when the player dies anywhere in the mine run.
replace_once(
    game,
    "      function respawnPlayer() {\n        if (window.TownMine?.floorFromMapId?.(currentArea)) {\n          _returnToFarmMeshes();",
    "      function respawnPlayer() {\n        if (window.TownMine?.floorFromMapId?.(currentArea)) {\n          window.WildernessCampfire?.clearMineCampfireOnDeath?.(); // Mine death ends the one underground camp, while wilderness camps survive.\n          _returnToFarmMeshes();"
)

# Inject map classification/readiness instead of hard-coding Town Mine ids inside the campfire module.
replace_once(
    game,
    "        getCurrentArea: () => currentArea,\n        isZoneArea: _isZoneArea,\n        getActiveScene,",
    "        getCurrentArea: () => currentArea,\n        isZoneArea: _isZoneArea,\n        isMineArea: area => !!window.TownMine?.floorFromMapId?.(area),\n        isAreaSceneReady: area => !_isBuildingArea(area) || !!_buildingScenes.get(area)?.scene,\n        getActiveScene,"
)

# Return to Camp can now load a procedural mine floor; the campfire module
# defers the exact player snap until the regenerated destination scene exists.
replace_once(
    game,
    "                  startSceneTransition(() => enterZone(campfire.mapId, Math.floor(campfire.x), Math.floor(campfire.z)));",
    "                  if (window.TownMine?.floorFromMapId?.(campfire.mapId)) {\n                    window.WildernessCampfire?.requestReturnToCampfire?.();\n                    startSceneTransition(() => enterBuilding(campfire.mapId));\n                  } else {\n                    startSceneTransition(() => enterZone(campfire.mapId, Math.floor(campfire.x), Math.floor(campfire.z)));\n                  }"
)

# A regenerated mine floor keeps the camp on the same floor, relocates it to
# the nearest safe floor tile if necessary, and never scatters a rock/enemy on it.
town_mine = 'docs/js/town-mine.js'
replace_once(
    town_mine,
    "    const safePlacementFloor = placementSafeTiles(generated.floor); // Used for content only; every generated floor tile remains walkable, but edge-adjacent cells no longer hide rocks inside sculpted geometry.\n    const ordinaryRockCount = Math.min(safePlacementFloor.length, Math.max(8, Math.min(24, Math.round(generated.floor.length / 7))));",
    "    const safePlacementFloor = placementSafeTiles(generated.floor); // Used for content only; every generated floor tile remains walkable, but edge-adjacent cells no longer hide rocks inside sculpted geometry.\n    window.WildernessCampfire?.relocateForGeneratedMineFloor?.(mapId, safePlacementFloor); // Keeps a persistent underground camp on this regenerated floor, snapping only when its old tile no longer exists.\n    const persistedCampfire = window.WildernessCampfire?.serialize?.(); // Used to reserve the restored camp tile from this visit's rocks and enemies.\n    if (persistedCampfire?.mapId === mapId) excluded.add(`${Math.floor(persistedCampfire.x)},${Math.floor(persistedCampfire.z)}`);\n    const ordinaryRockCount = Math.min(safePlacementFloor.length, Math.max(8, Math.min(24, Math.round(generated.floor.length / 7))));"
)

# Remove the stale documentation claim that map changes clear campfires.
index = 'docs/index.html'
replace_once(
    index,
    "  <!-- Player-craftable wilderness campfire (window.WildernessCampfire) —\n       only one at a time, cleared on any map change. Self-contained aside\n       from deps injected via init(); must load before game.js, which calls",
    "  <!-- Player-craftable persistent campfire (window.WildernessCampfire) —\n       only one at a time; survives map changes/saves and also works on Town\n       Mine floors, where player death destroys an underground camp.\n       Self-contained aside from deps injected via init(); must load before game.js, which calls"
)

Path('scripts/test-persistent-mine-campfires.js').write_text(r'''#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/wilderness-campfire.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const mine = fs.readFileSync('docs/js/town-mine.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

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
assert.match(game, /requestReturnToCampfire[\s\S]{0,180}enterBuilding\(campfire\.mapId\)/, 'Return to Camp can travel back to a mine floor');
assert.match(game, /isMineArea: area => !!window\.TownMine\?\.floorFromMapId/, 'mine-area classification is injected into campfire system');
assert.match(mine, /relocateForGeneratedMineFloor/, 'regenerated mine floors preserve underground camp placement');
assert.match(mine, /persistedCampfire[\s\S]{0,180}excluded\.add/, 'mine content scatter reserves the persistent camp tile');
assert.match(index, /survives map changes\/saves and also works on Town/, 'index documentation no longer claims campfires clear on map change');

console.log('Persistent mine campfire tests passed');
''', encoding='utf-8')

print('Applied persistent wilderness/mine campfire changes.')
