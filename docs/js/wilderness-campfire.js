(() => {
  'use strict';

  // A player-craftable campfire that can be set up anywhere in the wilderness
  // (any zone area — not farm/town/interior). Reuses the "campfire" authored
  // furniture piece (docs/config/furniture-authored/campfire.json). Only one
  // can exist at a time — placing a new one silently replaces the old one —
  // and it survives an ordinary save/reload as long as the player is still
  // on the same map, but is destroyed outright the moment the player leaves
  // that map (see update(), called every frame with the live current area).
  const CRAFT_COST = { wood: 5, stone: 3 }; // Consumed from any log type (see craftAndPlace) + stone.

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

  function place() {
    const area = deps.getCurrentArea();
    if (!deps.isZoneArea(area)) return { ok: false, message: "You can only set up a campfire out in the wilderness." };
    const player = deps.getPlayer();
    const wx = player.x / deps.TILE, wz = player.y / deps.TILE;
    state = { mapId: area, x: wx, y: deps.surfaceYAt(wx, wz), z: wz, ry: deps.getFacingAngle() };
    ensureLoaded().then(spawnVisual);
    deps.persist?.();
    return { ok: true, message: "🔥 Campfire set up. You can save, cook, mix potions, and return here." };
  }

  function ownedWood() { return (deps.inventory.pineLog || 0) + (deps.inventory.shadewoodLog || 0); }

  function craftAndPlace() {
    const area = deps.getCurrentArea();
    if (!deps.isZoneArea(area)) return { ok: false, message: "You can only craft a campfire out in the wilderness." };
    if (ownedWood() < CRAFT_COST.wood || (deps.inventory.stone || 0) < CRAFT_COST.stone) {
      return { ok: false, message: `Need ${CRAFT_COST.wood} Wood (Pine/Shadewood Log) and ${CRAFT_COST.stone} Stone to craft a campfire.` };
    }
    let remainingWood = CRAFT_COST.wood;
    for (const key of ['pineLog', 'shadewoodLog']) {
      if (remainingWood <= 0) break;
      const have = deps.inventory[key] || 0;
      const take = Math.min(have, remainingWood);
      deps.inventory[key] = have - take;
      deps.clampInventoryStack?.(key);
      remainingWood -= take;
    }
    deps.inventory.stone -= CRAFT_COST.stone;
    deps.clampInventoryStack?.('stone');
    deps.buildInventoryGrid?.();
    return place();
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

  function doCraft() {
    const result = craftAndPlace();
    deps.showToast(result.message, result.ok);
    render();
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
    const canCraft = ownedWood() >= CRAFT_COST.wood && (deps.inventory.stone || 0) >= CRAFT_COST.stone;
    row(state ? '🔥 Craft a New Campfire' : '🔥 Craft Campfire Here', `${CRAFT_COST.wood} Wood, ${CRAFT_COST.stone} Stone${state ? ' — replaces the current one' : ''}`, doCraft, !canCraft);
    if (isHere()) {
      row('↩️ Return to Campfire', nearby ? 'already here' : '', doReturn, nearby);
      row('💾 Save Game', '', doSave, false);
      row('🍲 Cook Here', cookRank ? `up to ${cookRank} ingredients` : 'needs Survivalist perk', doCook, !cookRank);
      row('⚗️ Mix Potions Here', brewRank ? `${brewRank * 20}% precision` : 'needs Herbalist perk', doBrew, !brewRank);
    }
  }

  window.WildernessCampfire = {
    init, place, clear, update, onZoneEntered, isHere, distanceToPlayerTiles, returnToCampfire,
    serialize, restore, ensureLoaded, refreshVisibility, toggle,
  };
})();
