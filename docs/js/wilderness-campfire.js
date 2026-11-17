(() => {
  'use strict';

  // One player-owned portable campfire may exist at a time. It can be placed
  // in a wilderness zone or on a procedural Town Mine floor, persists as
  // world-member state across map changes and game sessions, and silently
  // replaces the previous campfire whenever another is set up for free.
  // Same-year Tothal reconstruction only replays the saved terrain,
  // so it must not delete the restored camp. A genuine new-year Tothal Shift
  // still clears a wilderness camp because the terrain under its coordinates
  // has actually changed. Mine-floor camps are also cleared by mine death.
  // Reuses the authored campfire furniture + its existing
  // Save/Cook/Brew/Return-to-Camp interactions.
  const DEBUG_HISTORY_LIMIT = 24; // Caps the in-module persistence trace exposed by getDebugState().
  const CAMPFIRE_HOLD_MS = 500; // Authored base hold duration; the player's global tap/hold adjustment applies at press time.
  const POINTER_DRAG_THRESHOLD_PX = 12; // Suppresses touch/mouse jitter before an intentional held campfire arch selection.
  function campfireHoldMs() {
    return window.InputHoldTiming?.thresholdMs?.(CAMPFIRE_HOLD_MS) ?? CAMPFIRE_HOLD_MS; // Shares the player setting without requiring that optional module in older saves/tests.
  }

  let deps = null;
  let group = null; // Live campfire THREE.Group in whichever scene currently owns the saved campfire map.
  let visualArea = null; // Map id whose scene currently owns group; kept separate from persistent state.
  let visualSpawnPending = false; // Prevents repeated promise callbacks while authored furniture is still loading.
  let emitterVisuals = []; // Live fire/smoke THREE.Points, one per authored particle emitter.
  let state = null; // Persistent { mapId, x, y, z, ry } placement in tile units.
  let returnPending = false; // Used when Return to Camp must first load/regenerate another map (notably a mine floor).
  let campfireDataPromise = null;
  let debugHistory = []; // Recent state-changing events for mobile-friendly debug dumps without relying on console access.
  let interactionHold = null; // Current Action 2 owner/timer; exposed in mobile debug and canceled on any scene transition.
  let lastPointerDown = null; // Captured once at pointerdown so a held HUD button's later pointer moves have a true drag origin.

  function init(injectedDeps) {
    deps = injectedDeps;
    recordDebug('init');
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
    const currentYear = Number(window.CalendarSystem?.tothalCycle?.());
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
    cancelInteractionHold('campfire visual removed');
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
  }

  function place(col, row) {
    const area = deps.getCurrentArea();
    if (!supportsArea(area)) return { ok: false, message: 'You can only set up a campfire in the wilderness or on a mine floor.' };
    if (!Number.isInteger(col) || !Number.isInteger(row)) return { ok: false, message: 'Choose a valid tile to set up your campfire.' };
    const wx = col + 0.5;
    const wz = row + 0.5;
    const height = Number(deps.surfaceYAt(wx, wz)); // Protects saved camp coordinates if the destination terrain has no valid surface.
    if (!Number.isFinite(height)) return { ok: false, message: 'Cannot set up a campfire without solid ground.' };
    removeVisual(); // Placing one new fire destroys the old visual globally before replacing its persistent record.
    state = { mapId: area, x: wx, y: height, z: wz, ry: deps.getFacingAngle() };
    returnPending = false;
    recordDebug('place');
    ensureVisualForCurrentArea();
    deps.persist?.();
    return { ok: true, message: '🔥 Campfire set up. You can save, cook, mix potions, and return here.' };
  }

  // Existing saved kits and held-item actions still work, but never require or
  // consume an inventory item now that setting up camp is free.
  function placeFromKit(col, row) {
    return place(col, row);
  }

  // The utilities wheel sets up camp on the player's own walkable tile, so it
  // needs neither a held kit nor the item-only action-bar placement workflow.
  function placeAtPlayer() {
    const player = deps?.getPlayer?.(); // Supplies the player's feet position for the utility-wheel camp setup.
    const tileSize = Number(deps?.TILE); // Converts the position into the tile coordinates expected by place().
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)
      || !Number.isFinite(tileSize) || tileSize <= 0) {
      return { ok: false, message: 'Cannot find a safe place for your campfire right now.' };
    }
    return place(Math.floor(player.x / tileSize), Math.floor(player.y / tileSize));
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
        tothalYear: Number(window.CalendarSystem?.tothalCycle?.()),
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

  // The inactive zone cache tears a zone's scene down while the player is
  // elsewhere. The saved campfire stays; only its visual belonged to that
  // scene, and onZoneEntered re-attaches it when the zone is rebuilt.
  function releaseVisualIfZone(mapId) {
    if (!state || state.mapId !== mapId || visualArea !== mapId) return false;
    removeVisual();
    recordDebug('zone-cache-visual-released', { mapId });
    return true;
  }

  function distanceToPlayerTiles() {
    if (!state) return Infinity;
    const player = deps.getPlayer();
    return Math.hypot(player.x / deps.TILE - state.x, player.y / deps.TILE - state.z);
  }

  const NEARBY_TILES = 1.75; // Used by both the campfire prompt and every menu-choice validity check.

  function withinInteractionRange() {
    return isHere() && !!group && distanceToPlayerTiles() <= NEARBY_TILES
      && window.GameplayInputRouter?.isInCombat?.() !== true;
  }

  function campfireMenuEntries() {
    const cookRank = window.PerkSystem?.rank('foraging', 'survivalist') || 0; // Controls the Cook choice without replacing tool inputs.
    const brewRank = window.PerkSystem?.rank('alchemy', 'herbalist') || 0; // Controls the Brew choice without replacing tool inputs.
    const nearby = action => { // Re-check player distance when the menu choice is committed, not only when the hold started.
      if (!withinInteractionRange()) { deps?.showToast?.('Move closer to the campfire.', false); return; }
      recordDebug('campfire-action-selected', { action }); // Mobile diagnostics identify which option actually fired, not just that the arch released.
      if (action === 'save') doSave();
      else if (action === 'cook') doCook();
      else if (action === 'brew') doBrew();
    };
    return [
      { id:'save', icon:'💾', label:'Save Game', onSelect:()=>nearby('save') },
      { id:'cook', icon:'🍲', label:cookRank?'Cook Here':'Cook Here (needs Survivalist)', disabled:!cookRank, onSelect:()=>nearby('cook') },
      { id:'brew', icon:'⚗️', label:brewRank?'Make Potions Here':'Make Potions Here (needs Herbalist)', disabled:!brewRank, onSelect:()=>nearby('brew') },
      { id:'cancel', icon:'✕', label:'Cancel', initial:true, onSelect:()=>{} }, // Releasing an untouched hold must never accidentally save or open a work menu.
    ];
  }

  function trackHeldCampfirePointer(hold) {
    if (typeof document === 'undefined') return;
    const pointerId = hold.pointerStart?.pointerId ?? (hold.owner.startsWith('touch-arch:')
      ? Number(hold.owner.slice('touch-arch:'.length)) : null); // The original touch or mouse pointer owns the drag; synthetic touch hosts can still recover by ID.
    if (!Number.isInteger(pointerId) || pointerId < 0 || typeof document.addEventListener !== 'function') return;
    const start = hold.pointerStart?.pointerId === pointerId ? hold.pointerStart : null; // Snapshot the original HUD press, not a different finger's later pointerdown.
    let dragOrigin = start && { x:start.x, y:start.y }; // Retained for the lifetime of this held gesture, even if another finger lands later.
    const move = event => {
      if (interactionHold !== hold || event.pointerId !== pointerId) return;
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      if (!dragOrigin) { dragOrigin = { x:event.clientX, y:event.clientY }; return; } // Graceful fallback for hosts that bypass document pointerdown.
      const nearStart = Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) <= POINTER_DRAG_THRESHOLD_PX; // Used to distinguish unintentional jitter from a deliberate drag returning to its origin.
      if (nearStart && !hold.opened) {
        hold.dragPoint = null; hold.didDrag = false; // A pre-open drag that returned to the button is not an active choice.
        return;
      }
      if (nearStart && !hold.didDrag) return; // Don't choose anything from minor finger tremors on a newly opened wheel.
      hold.didDrag = true;
      hold.dragPoint = { x:event.clientX, y:event.clientY }; // After dragging starts, follow all later moves—including returning toward the original button.
      if (hold.opened && window._desktopSelectionArc?.currentMode?.() === 'entries:campfire')
        window._desktopSelectionArc?.movePointer?.(event.clientX, event.clientY);
    }; // The HUD button retains pointer capture throughout the hold, so its drag never reaches the arch backdrop directly.
    document.addEventListener('pointermove', move, true);
    hold.pointerCleanup = () => document.removeEventListener('pointermove', move, true); // Released, canceled, or scene-changed holds remove their own listener.
  }

  function beginInteractionHold(source = 'action2') {
    if (interactionHold || !withinInteractionRange()) return false;
    const owner = String(source); // Pairs this exact keyboard/controller or touch pointer with its eventual release.
    const hold = { owner, timer:null, opened:false, pointerCleanup:null, pointerStart:null, dragPoint:null, didDrag:false, durationMs:campfireHoldMs() }; // Captures the press threshold, touch/mouse origin and any deliberate pre-open drag.
    const touchPointerId = owner.startsWith('touch-arch:') ? Number(owner.slice('touch-arch:'.length)) : null; // Touch-arch ownership encodes its physical pointer ID.
    const recentMousePress = owner.startsWith('desktop-mouse:') && lastPointerDown?.pointerType === 'mouse'
      && Date.now() - lastPointerDown.at <= 1000; // A desktop mouse hold must follow its own fresh pointerdown, not an old touch.
    const pointerId = recentMousePress ? lastPointerDown.pointerId : touchPointerId; // Used to pair held drag movement with the actual owner.
    if (Number.isInteger(pointerId) && pointerId >= 0 && lastPointerDown?.pointerId === pointerId)
      hold.pointerStart = { ...lastPointerDown }; // Other fingers/buttons cannot change the captured origin later.
    interactionHold = hold;
    trackHeldCampfirePointer(hold); // Observe the original touch/mouse pointer from press onward, including the interval before the arch opens.
    hold.timer = setTimeout(() => {
      hold.timer = null;
      if (interactionHold !== hold) return;
      if (!withinInteractionRange() || !window._desktopSelectionArc?.openEntries) {
        endInteractionHold(owner, true);
        return;
      }
      window._desktopSelectionArc.openEntries('campfire', campfireMenuEntries());
      hold.opened = true;
      if (hold.dragPoint) window._desktopSelectionArc?.movePointer?.(hold.dragPoint.x, hold.dragPoint.y); // Honor a drag that already reached its choice before the menu became visible.
      recordDebug('campfire-hold-menu-open', { owner });
    }, hold.durationMs);
    recordDebug('campfire-hold-start', { owner });
    return true;
  }

  function endInteractionHold(source = 'action2', canceled = false) {
    const hold = interactionHold; // Original owner is checked so one input cannot cancel another's hold.
    if (!hold || hold.owner !== String(source)) return false;
    interactionHold = null;
    if (hold.timer !== null) clearTimeout(hold.timer);
    hold.pointerCleanup?.();
    const ownsMenu = hold.opened && window._desktopSelectionArc?.currentMode?.() === 'entries:campfire'; // A different selector must never be committed by a late campfire release.
    const canCommit = ownsMenu && !canceled && withinInteractionRange(); // Recheck range/combat exactly as the ruin shaft brazier does on release.
    let selectionReleased = false; // Mobile debug distinguishes a valid release handled by the arch from a canceled or unavailable release.
    if (ownsMenu) {
      if (canCommit && typeof window._desktopSelectionArc?.releaseSelection === 'function') {
        selectionReleased = true;
        window._desktopSelectionArc.releaseSelection();
      } else window._desktopSelectionArc?.close?.(); // A canceled or stale hold must not activate any choice.
    }
    recordDebug(canceled ? 'campfire-hold-canceled' : 'campfire-hold-released',
      { owner:hold.owner, opened:hold.opened, selectionReleased, dragged:hold.didDrag });
    return true;
  }

  function cancelInteractionHold(reason = 'cancel') {
    if (interactionHold) endInteractionHold(interactionHold.owner, true);
  }

  function getNearbyActions() {
    if (!withinInteractionRange()) return null;
    return [{
      icon:'🔥', label:'Hold for Campfire', action:'campfire_menu', inputAction:'action2',
      style:'secondary', allowed:true, worldInteraction:true, promptRoot:group,
      requiresHold:true, holdSeconds:campfireHoldMs() / 1000,
    }]; // One contextual Action 2 replaces Throw, never the primary tool swing or a held item's own input.
  }

  async function doSave() {
    recordDebug('campfire-save');
    const checkpoints = window.HobunjiSaveCheckpoints; // Campfire saves share the integrity guard/canonical write path but own a distinct recovery checkpoint from pause-menu Manual Save.
    const saveCheckpoint = checkpoints?.saveCampfire || checkpoints?.saveManual; // Compatibility fallback only matters if an old cached checkpoint module is somehow paired with this campfire module.
    if (typeof saveCheckpoint === 'function') {
      let result = await saveCheckpoint.call(checkpoints, { reason: 'campfire-save' });
      if (!result.ok && result.needsConfirmation) {
        const warning = result.warning || result.error || 'This save looks destructive.';
        if (confirm(`This campfire save was blocked because ${warning}. Save it anyway?`)) {
          result = await saveCheckpoint.call(checkpoints, { reason: 'campfire-save-confirmed', force: true });
        }
      }
      if (result.ok) deps.showToast('💾 Game saved.', true);
      else deps.showToast('Save blocked: ' + (result.error || result.warning || 'unknown save error'), false);
      return result;
    }
    deps.persist?.();
    deps.showToast('💾 Game saved.', true);
    return { ok: true, legacyFallback: true };
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
      interactionHold: interactionHold ? { owner:interactionHold.owner, opened:interactionHold.opened,
        durationMs:interactionHold.durationMs, dragged:interactionHold.didDrag, pointerCaptured:!!interactionHold.pointerCleanup } : null,
      state: serialize(),
      visualArea,
      hasVisual: !!group,
      visualSpawnPending,
      returnPending,
      history: debugHistory.map(entry => ({ ...entry, state: entry.state ? { ...entry.state } : null })),
    };
  }

  if (typeof document !== 'undefined') document.addEventListener?.('pointerdown', event => {
    if (Number.isInteger(event.pointerId) && Number.isFinite(event.clientX) && Number.isFinite(event.clientY))
      lastPointerDown = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, pointerType:event.pointerType || '', at:Date.now() };
  }, true); // Capture the original HUD press before the button's own pointerdown handler starts the hold.
  window.addEventListener?.('blur', () => cancelInteractionHold('window-blur')); // A lost mobile/desktop release must not open a stale menu.
  if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', () => {
    if (document.hidden) cancelInteractionHold('page-hidden');
  });

  window.WildernessCampfire = {
    init, supportsArea, place, placeFromKit, placeAtPlayer, clear, clearIfZone, clearMineCampfireOnDeath,
    relocateForGeneratedMineFloor, updateVfx, onZoneEntered, isHere, distanceToPlayerTiles,
    getNearbyActions, beginInteractionHold, endInteractionHold, cancelInteractionHold,
    returnToCampfire, requestReturnToCampfire, doSave, doCook, doBrew,
    serialize, restore, ensureLoaded, getDebugState, releaseVisualIfZone,
  };
})();
