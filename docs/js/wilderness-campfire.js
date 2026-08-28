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
  // and it survives an ordinary save/reload as long as the player is still
  // on the same map, but is destroyed outright the moment the player leaves
  // that map (see update(), called every frame with the live current area).
  const KIT_ITEM_KEY = 'campfireKitFurniture';

  let deps = null;
  let group = null; // Live THREE.Group in the scene, or null when not spawned/visible.
  let state = null; // { mapId, x, y, z, ry } in tile-units, or null when no campfire is placed.
  let campfireDataPromise = null;

  function init(injectedDeps) { deps = injectedDeps; }

  function ensureLoaded() {
    if (!campfireDataPromise) campfireDataPromise = deps.AuthoredFurniture.load('campfire');
    return campfireDataPromise;
  }

  function removeVisual() {
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

  // Called every frame with the live current area — destroys the campfire
  // the instant the player leaves the map it was placed on.
  function update(currentArea) {
    if (state && state.mapId !== currentArea) clear();
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

  // ── Small corner button + panel, same pattern as FurniturePlacer ─────
  let _open = false;

  function refreshVisibility() {
    const btn = document.getElementById('wildernessCampfireBtn');
    if (!btn) return;
    const show = !deps.isPaused() && deps.isZoneArea(deps.getCurrentArea());
    btn.style.display = show ? '' : 'none';
    if (!show && _open) toggle();
  }

  function toggle() {
    const panel = document.getElementById('wildernessCampfirePanel');
    const btn = document.getElementById('wildernessCampfireBtn');
    _open = panel?.style.display !== 'flex';
    if (panel) panel.style.display = _open ? 'flex' : 'none';
    if (btn) btn.classList.toggle('fed-open', _open);
    if (_open) render();
  }

  function close() {
    if (_open) toggle();
  }

  function doSave() {
    deps.persist?.();
    deps.showToast('💾 Game saved.', true);
    render();
  }

  function doReturn() {
    const result = returnToCampfire();
    deps.showToast(result.message, result.ok);
    if (result.ok) close();
  }

  function doCook() {
    const rank = window.PerkSystem?.rank('foraging', 'survivalist') || 0;
    if (!rank) { deps.showToast('You need the Foraging Survivalist perk to cook at a campfire.', false); return; }
    close();
    window.CookingSystem?.openAtHearth({ maxIngredients: rank });
  }

  function doBrew() {
    const rank = window.PerkSystem?.rank('alchemy', 'herbalist') || 0;
    if (!rank) { deps.showToast('You need the Alchemy Herbalist perk to mix potions at a campfire.', false); return; }
    close();
    window.AlchemySystem?.setCampfireBrewing(true);
    deps.openMenu('alchemy');
  }

  function render() {
    const list = document.getElementById('wildernessCampfireList');
    if (!list) return;
    const nearby = distanceToPlayerTiles() < 1.75;
    const cookRank = window.PerkSystem?.rank('foraging', 'survivalist') || 0;
    const brewRank = window.PerkSystem?.rank('alchemy', 'herbalist') || 0;
    list.innerHTML = '';
    const row = (label, note, fn, disabled) => {
      const wrap = document.createElement('div');
      wrap.className = 'farm-row';
      wrap.innerHTML = `<span class="farm-row-name">${label}</span>${note ? `<span class="farm-note">${note}</span>` : ''}`;
      const btn = document.createElement('button');
      btn.className = 'settings-small-btn';
      btn.textContent = 'Use';
      btn.disabled = !!disabled;
      btn.addEventListener('click', fn);
      wrap.appendChild(btn);
      list.appendChild(wrap);
    };
    if (isHere()) {
      row('↩️ Return to Campfire', nearby ? 'already here' : '', doReturn, nearby);
      row('💾 Save Game', '', doSave, false);
      row('🍲 Cook Here', cookRank ? `up to ${cookRank} ingredients` : 'needs Survivalist perk', doCook, !cookRank);
      row('⚗️ Mix Potions Here', brewRank ? `${brewRank * 20}% precision` : 'needs Herbalist perk', doBrew, !brewRank);
    } else {
      const hint = document.createElement('div');
      hint.className = 'farm-note';
      hint.style.padding = '4px 2px';
      hint.textContent = 'Select a Campfire Kit (crafted in the Inventory\'s Crafting tab), aim at open ground, and use Action 1 to make camp.';
      list.appendChild(hint);
    }
  }

  window.WildernessCampfire = {
    init, place, placeFromKit, clear, update, onZoneEntered, isHere, distanceToPlayerTiles, returnToCampfire,
    serialize, restore, ensureLoaded, refreshVisibility, toggle,
  };
})();
