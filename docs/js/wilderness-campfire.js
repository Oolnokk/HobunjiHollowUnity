(() => {
  'use strict';

  // A player-craftable campfire that can be set up anywhere in the wilderness
  // (any zone area — not farm/town/interior). Reuses the "campfire" authored
  // furniture piece (docs/config/furniture-authored/campfire.json). Crafted
  // as an ordinary "Campfire Kit" item (DECORATIVE_FURNITURE_DEFS.campfire
  // in game.js — buy the blueprint from the carpenter, build it from Wood
  // + Stone in the Inventory's Crafting tab), then placed by selecting it,
  // aiming at a tile, and using Action 1 (see computeActionButtons' campfire
  // branch and useActiveAction's own place_campfire_kit case in game.js,
  // which calls placeFromKit(col, row) below immediately rather than through
  // the generic pendingAction path — see that case's own comment for why).
  // Only one can exist at a time — placing a new one silently replaces it —
  // and it now persists indefinitely once placed, across leaving its map,
  // other zones, the farm, and an ordinary save/reload (see serialize/
  // restore), until the player either places a new one or a Tothal Shift
  // reshapes its own zone's terrain out from under it (see clearIfZone,
  // called from the shift loop for exactly that reason). The utilities
  // wheel's Return to Camp travels there from anywhere via game.js's
  // enterZone when it isn't the current area (see _openUtilitiesArc).
  const KIT_ITEM_KEY = 'campfireKitFurniture';

  let deps = null;
  let group = null; // Live THREE.Group in the scene, or null when not spawned/visible.
  let emitterVisuals = []; // Live fire/smoke THREE.Points, one per campfire.json particleEmitters entry — see updateVfx.
  let state = null; // { mapId, x, y, z, ry } in tile-units, or null when no campfire is placed.
  let campfireDataPromise = null;

  function init(injectedDeps) { deps = injectedDeps; }

  function ensureLoaded() {
    if (!campfireDataPromise) campfireDataPromise = deps.AuthoredFurniture.load('campfire');
    return campfireDataPromise;
  }

  function removeVisual() {
    emitterVisuals.forEach(visual => visual?.dispose?.());
    emitterVisuals = [];
    if (group) { group.parent?.remove(group); group = null; }
  }

  function spawnVisual() {
    removeVisual();
    if (!state) return;
    const data = deps.AuthoredFurniture.peek('campfire');
    if (!data) { ensureLoaded().then(spawnVisual); return; }
    const built = deps.AuthoredFurniture.buildGroup(data);
    built.position.set(state.x, state.y, state.z);
    built.rotation.y = state.ry || 0;
    deps.getActiveScene().add(built);
    group = built;
    // buildGroup only builds the geometry (data.parts) — the fire/smoke
    // particle systems are a separate live THREE.Points each, driven every
    // frame by updateVfx below (see makeProcessingFurniture's identical
    // pattern in game.js, which this mirrors for an always-on, never-job-
    // gated campfire instead of a processing station's burst/timed VFX).
    emitterVisuals = (data.particleEmitters || []).map(record => deps.AuthoredFurniture.createEmitterVisual(built, record));
  }

  // Called every frame (see game.js's main loop) so the fire/smoke keep
  // animating regardless of area — always "active" (unlike a processing
  // station's job-gated burst) since a lit campfire has no on/off state.
  function updateVfx(dt) {
    for (const visual of emitterVisuals) visual?.update?.(dt, true);
  }

  // Places the campfire at an explicit tile (col, row — the aimed reticle
  // tile, same tile-unit convention docs/js/reagent-plants.js uses: world
  // x/z is col+0.5/row+0.5, no TILE division). Internal — callers go
  // through placeFromKit(), which also consumes the held item.
  function place(col, row) {
    const area = deps.getCurrentArea();
    if (!deps.isZoneArea(area)) return { ok: false, message: "You can only set up a campfire out in the wilderness." };
    const wx = col + 0.5, wz = row + 0.5;
    state = { mapId: area, x: wx, y: deps.surfaceYAt(wx, wz), z: wz, ry: deps.getFacingAngle() };
    ensureLoaded().then(spawnVisual);
    deps.persist?.();
    return { ok: true, message: "🔥 Campfire set up. You can save, cook, mix potions, and return here." };
  }

  // Consumes one Campfire Kit from inventory and places it at (col, row) —
  // called from game.js's useActiveAction when the player aims at a tile
  // and uses Action 1 while holding the kit.
  function placeFromKit(col, row) {
    const area = deps.getCurrentArea();
    if (!deps.isZoneArea(area)) return { ok: false, message: "You can only set up a campfire out in the wilderness." };
    if ((deps.inventory[KIT_ITEM_KEY] || 0) < 1) return { ok: false, message: 'No Campfire Kit to use.' };
    deps.inventory[KIT_ITEM_KEY] -= 1;
    deps.clampInventoryStack?.(KIT_ITEM_KEY);
    deps.buildInventoryGrid?.();
    deps.refreshItemScroll?.();
    return place(col, row);
  }

  function clear() {
    if (!state) return;
    state = null;
    removeVisual();
    deps.persist?.();
  }

  // Called from the Tothal Shift reshape loop for whichever zoneId just got
  // regenerated, regardless of whether the player is standing in it right
  // now — a still-active campfire's exact (x,z) is only meaningful against
  // the terrain it was placed on, and that terrain no longer exists once
  // this fires. Losing the campfire here (rather than leaving a stale
  // reference to it) matches how bandit camps/wildlife dens already handle
  // the same event (see their own forgetZoneState/forgetZoneDenState calls
  // right next to this one in the shift loop).
  function clearIfZone(mapId) {
    if (state && state.mapId === mapId) clear();
  }

  // Called once a wilderness zone scene finishes building, to re-attach a
  // surviving campfire's visual (e.g. after a same-session save/reload that
  // lands the player back on the same map they camped on).
  function onZoneEntered(mapId) {
    if (state && state.mapId === mapId && !group) ensureLoaded().then(spawnVisual);
  }

  function isHere() { return !!(state && state.mapId === deps.getCurrentArea()); }

  function distanceToPlayerTiles() {
    if (!state) return Infinity;
    const player = deps.getPlayer();
    return Math.hypot(player.x / deps.TILE - state.x, player.y / deps.TILE - state.z);
  }

  const NEARBY_TILES = 1.75; // "at the campfire" radius for the interact-list actions below.

  // Walk-up interact buttons — mirrors bandit-camps.js's getNearbyTentAction
  // (the established pattern for a wilderness-zone proximity interactable),
  // but returns up to three buttons at once instead of one, so Save/Cook/
  // Brew each land on their own action-bar slot (see useActiveAction's
  // campfire_save/campfire_cook/campfire_brew cases in game.js) instead of
  // behind a single button that used to open a floating panel.
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

  // Repositions the player onto the campfire's exact tile — only valid
  // while already standing in its zone (isHere()). Traveling there from a
  // different zone/the farm is a separate concern the utility wheel handles
  // itself (see _openUtilitiesArc's return-camp entry in game.js): it reads
  // serialize() to get the mapId, calls game.js's own enterZone to actually
  // travel, and only falls back to this function once already there.
  function returnToCampfire() {
    if (!isHere()) return { ok: false, message: "No campfire here to return to." };
    const player = deps.getPlayer();
    player.x = state.x * deps.TILE;
    player.y = state.z * deps.TILE;
    player.vx = 0; player.vy = 0;
    return { ok: true, message: "You return to your campfire." };
  }

  function serialize() { return state ? { ...state } : null; }

  function restore(saved) {
    state = saved && saved.mapId ? { ...saved } : null;
    removeVisual(); // The visual spawns lazily the next time onZoneEntered fires for this map.
  }

  window.WildernessCampfire = {
    init, place, placeFromKit, clear, clearIfZone, updateVfx, onZoneEntered, isHere, distanceToPlayerTiles,
    getNearbyActions, returnToCampfire, doSave, doCook, doBrew,
    serialize, restore, ensureLoaded,
  };
})();
