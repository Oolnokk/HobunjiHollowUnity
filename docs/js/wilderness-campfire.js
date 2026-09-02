(() => {
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
