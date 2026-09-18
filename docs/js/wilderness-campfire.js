(() => {
  'use strict';

  // One player-owned portable campfire may exist at a time. It can be placed
  // in a wilderness zone or on a procedural Town Mine floor, persists as
  // world-member state across map changes and game sessions, and silently
  // replaces the previous campfire when a new kit is used. Same-year Tothal
  // reconstruction is only an in-memory replay of the already-saved terrain,
  // so it must not delete the restored camp. A genuine new-year Tothal Shift
  // still clears a wilderness camp because the terrain under its coordinates
  // has actually changed. Mine-floor camps are also cleared by mine death.
  // Reuses the authored campfire furniture + its existing
  // Save/Cook/Brew/Return-to-Camp interactions.
  const KIT_ITEM_KEY = 'campfireKitFurniture';
  const DEBUG_HISTORY_LIMIT = 24; // Caps the in-module persistence trace exposed by getDebugState().
  const BOAT_SCRIPT_URL = 'js/wilderness-boat.js?v=20260906vehicle1'; // Used to lazy-load the separate wilderness boat runtime without adding another game.js dependency block.

  let deps = null;
  let group = null; // Live campfire THREE.Group in whichever scene currently owns the saved campfire map.
  let visualArea = null; // Map id whose scene currently owns group; kept separate from persistent state.
  let visualSpawnPending = false; // Prevents repeated promise callbacks while authored furniture is still loading.
  let emitterVisuals = []; // Live fire/smoke THREE.Points, one per authored particle emitter.
  let state = null; // Persistent { mapId, x, y, z, ry } placement in tile units.
  let returnPending = false; // Used when Return to Camp must first load/regenerate another map (notably a mine floor).
  let campfireDataPromise = null;
  let boatScriptPromise = null; // Shared loader promise so repeated init/update calls can never append duplicate boat scripts.
  let debugHistory = []; // Recent state-changing events for mobile-friendly debug dumps without relying on console access.

  // ActionArcUI loads before this file and is initialized later from game.js.
  // Capture that exact dependency bag once, so wilderness-boat.js can add its
  // utility entries without copying the utility wheel's private game globals.
  const originalActionArcInit = window.ActionArcUI?.init; // Used to preserve the existing selector initialization while exposing its already-curated deps to the boat module.
  if (typeof originalActionArcInit === 'function' && !window.ActionArcUI.__wildernessBoatDepsBridge) {
    window.ActionArcUI.init = function (injectedDeps) {
      window.__hobunjiVehicleArcDeps = injectedDeps;
      return originalActionArcInit.call(this, injectedDeps);
    };
    window.ActionArcUI.__wildernessBoatDepsBridge = true;
  }

  function ensureBoatRuntime() {
    if (window.WildernessBoat) {
      window.WildernessBoat.init?.(deps);
      return Promise.resolve(window.WildernessBoat);
    }
    if (!boatScriptPromise) {
      boatScriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-hobunji-wilderness-boat="1"]`); // Used to adopt an in-flight loader if another caller installed it first.
        const script = existing || document.createElement('script'); // Runtime script element appended only when needed.
        const onReady = () => {
          const api = window.WildernessBoat;
          if (!api) { reject(new Error('wilderness-boat.js loaded without window.WildernessBoat')); return; }
          api.init?.(deps);
          resolve(api);
        };
        const onError = () => reject(new Error('Failed to load wilderness-boat.js'));
        if (existing) {
          if (window.WildernessBoat) onReady();
          else { existing.addEventListener('load', onReady, { once: true }); existing.addEventListener('error', onError, { once: true }); }
          return;
        }
        script.src = BOAT_SCRIPT_URL;
        script.async = false;
        script.dataset.hobunjiWildernessBoat = '1';
        script.addEventListener('load', onReady, { once: true });
        script.addEventListener('error', onError, { once: true });
        document.head.appendChild(script);
      }).catch(error => {
        boatScriptPromise = null;
        window.__farmLog?.(`[boat] runtime loader failed: ${error?.message || error}`, 'warn', 'world');
        throw error;
      });
    }
    return boatScriptPromise;
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    recordDebug('init');
    ensureBoatRuntime().catch(() => {});
  }

  function recordDebug(event, details = {}) {
    const entry = { // Appended to debugHistory so persistence loss can be traced after it happens.
      at: Date.now(),
      event,
      area: deps?.getCurrentArea?.() || null,
      state: state ? { ...state } : null,
      details: { ...details },
    };
    debugHistory.push(entry);
    if (debugHistory.length > DEBUG_HISTORY_LIMIT) debugHistory.splice(0, debugHistory.length - DEBUG_HISTORY_LIMIT);
    const stateLabel = entry.state
      ? `${entry.state.mapId}@${Number(entry.state.x).toFixed(1)},${Number(entry.state.z).toFixed(1)}`
      : 'none'; // Used by the existing mobile-visible Debug log so console access is not required.
    window.__farmLog?.(`[campfire] ${event} area=${entry.area || 'none'} state=${stateLabel}`);
  }

  // performTothalShift() also runs once on every fresh page load to rebuild
  // this session's deterministic same-year zone layouts. During that replay,
  // world.lastTothalYear already equals CalendarSystem.yearNumber(); during a
  // real new-year shift it does not get updated until after all zones finish.
  // Keep the legacy clearIfZone() call safe by proving which case we are in
  // here, without requiring game.js to maintain a second campfire-specific
  // lifecycle flag.
  function isSameYearTothalReplay() {
    const worldId = window.__hobunjiPlayerProfile?.worldId;
    const currentYear = Number(window.CalendarSystem?.yearNumber?.());
    if (!worldId || !Number.isFinite(currentYear)) return false;
    try {
      const meta = JSON.parse(window.localStorage?.getItem('hobunjiSaveMeta') || 'null');
      const savedYear = (meta?.worlds || []).find(world => world.id === worldId)?.lastTothalYear;
      return savedYear != null && Number(savedYear) === currentYear;
    } catch {
      return false;
    }
  }

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
    const surfaceY = Number(deps.surfaceYAt?.(state.x, state.z)); // Re-sampled after map regeneration so restored fires sit on the rebuilt surface.
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
    window.WildernessBoat?.update?.(dt); // Separate boat runtime piggybacks on this already-guaranteed world-frame hook without inheriting campfire behavior.
  }

  function place(col, row) {
    const area = deps.getCurrentArea();
    if (!supportsArea(area)) return { ok: false, message: 'You can only set up a campfire in the wilderness or on a mine floor.' };
    const wx = col + 0.5;
    const wz = row + 0.5;
    removeVisual(); // Placing one new fire destroys the old visual globally before replacing its persistent record.
    state = { mapId: area, x: wx, y: deps.surfaceYAt(wx, wz), z: wz, ry: deps.getFacingAngle() };
    returnPending = false;
    recordDebug('place');
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

  function clear(reason = 'explicit') {
    if (!state) return false;
    const previousState = { ...state }; // Included in the debug trace so the deleted placement can be identified later.
    state = null;
    returnPending = false;
    removeVisual();
    recordDebug('clear', { reason, previousState });
    deps.persist?.();
    return true;
  }

  // Legacy name retained because game.js calls this from both a real Tothal
  // Shift and the same-year boot reconstruction. Only the real shift destroys
  // the camp. The boot replay is rebuilding identical deterministic terrain,
  // so deleting here would erase a correctly restored save moments after load.
  function clearIfZone(mapId) {
    if (!state || state.mapId !== mapId || !deps.isZoneArea?.(mapId)) return false;
    if (isSameYearTothalReplay()) {
      removeVisual();
      recordDebug('same-year-rebuild-preserved', {
        mapId,
        tothalYear: Number(window.CalendarSystem?.yearNumber?.()),
      });
      return true;
    }
    return clear('tothal-shift');
  }

  // A death anywhere on a Town Mine floor ends the underground camp. A
  // wilderness camp remains untouched by a mine death.
  function clearMineCampfireOnDeath() {
    if (state && deps.isMineArea?.(state.mapId)) return clear('mine-death');
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
    const previousPosition = { x: state.x, z: state.z }; // Captured for the relocation debug trace below.
    state.x = nextX;
    state.z = nextZ;
    state.y = 0; // Re-sampled from the active regenerated scene by spawnVisual().
    recordDebug('mine-relocated', { mapId, previousPosition, nextPosition: { x: nextX, z: nextZ } });
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
    recordDebug('manual-save');
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
    recordDebug('restore', { suppliedState: !!(saved && saved.mapId) });
  }

  function getDebugState() {
    return {
      state: serialize(),
      visualArea,
      hasVisual: !!group,
      visualSpawnPending,
      returnPending,
      history: debugHistory.map(entry => ({ ...entry, state: entry.state ? { ...entry.state } : null })),
    };
  }

  window.WildernessCampfire = {
    init, supportsArea, place, placeFromKit, clear, clearIfZone, clearMineCampfireOnDeath,
    relocateForGeneratedMineFloor, updateVfx, onZoneEntered, isHere, distanceToPlayerTiles,
    getNearbyActions, returnToCampfire, requestReturnToCampfire, doSave, doCook, doBrew,
    serialize, restore, ensureLoaded, getDebugState,
  };
})();
