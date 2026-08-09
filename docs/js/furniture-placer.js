(() => {
  'use strict';

  // A discoverable, inventory-scoped alternative to the hidden "scroll the
  // hotbar to a decor item, then aim and interact" flow that's the only way
  // to place furniture otherwise. Deliberately NOT a spawn-for-free cheat
  // tool (unlike the farm editor/dev spawner, which are dev-mode-gated) —
  // works exactly like the farm editor's own paint brush: pick a piece here,
  // then tap/click a tile on the actual game view and it's placed
  // immediately, taken out of inventory. All placement validation (area,
  // tile clearance) and inventory consumption stays exactly where it
  // already lived (placeDecorativeFurniture/canPlaceDecorativeFurnitureAt
  // in game.js) — this module only decides which owned items are worth
  // listing and arms/disarms deps.armFurniturePlacement, the same "which
  // item is the next click-to-place tile for" state the farm editor's own
  // brush toggle uses.
  let deps = null;
  let _open = false;

  function init(injectedDeps) {
    deps = injectedDeps;
  }

  function _ownedPlaceableHere() {
    const area = deps.getCurrentArea();
    if (area !== 'farm' && area !== 'interior') return [];
    return Object.values(deps.getDecorativeFurnitureDefs())
      .filter(def => !def.fixture)
      .filter(def => def.area === 'any' || def.area === area)
      .filter(def => (deps.inventory[def.itemKey] || 0) > 0);
  }

  // Only a normal ownership/permission check — NOT dev-mode gated, unlike
  // the farm editor/dev spawner buttons that share this same top-right UI
  // slot by default (see .fp-shifted below). Hidden while the game is
  // paused (the main menu overlay is open) since the button sits in the
  // same fixed top-right corner the menu panel covers.
  function refreshVisibility() {
    const btn = document.getElementById('furniturePlacerBtn');
    if (!btn || !deps) return;
    const area = deps.getCurrentArea();
    const show = !deps.isPaused() && (area === 'farm' || area === 'interior') && deps.hasFarmPermission('placeFurniture');
    btn.style.display = show ? '' : 'none';
    // Takes the farm editor pencil's own slot by default (empty for
    // virtually every player, since dev mode is off) — only shifts one
    // slot over while dev mode is on and that slot is actually occupied.
    btn.classList.toggle('fp-shifted', deps.isDevMode());
    if (!show && _open) toggle();
  }

  function toggle() {
    const panel = document.getElementById('furniturePlacerPanel');
    const btn = document.getElementById('furniturePlacerBtn');
    _open = panel?.style.display !== 'flex';
    if (panel) panel.style.display = _open ? 'flex' : 'none';
    if (btn) btn.classList.toggle('fed-open', _open);
    if (!_open) deps.armFurniturePlacement(null); // closing the panel also cancels any armed placement
    if (_open) render();
  }

  function render() {
    const hint = document.getElementById('furniturePlacerHint');
    const list = document.getElementById('furniturePlacerList');
    if (!list) return;
    const owned = _ownedPlaceableHere();
    const armed = deps.getArmedFurniturePlacementKey();
    if (hint) {
      hint.textContent = owned.length
        ? 'Pick a piece, then tap a clear tile to place it.'
        : "You don't own any furniture yet — buy some from the General Store.";
    }
    list.innerHTML = '';
    owned.forEach(def => {
      const count = deps.inventory[def.itemKey] || 0;
      const isArmed = armed === def.itemKey;
      const row = document.createElement('div');
      row.className = 'farm-row' + (isArmed ? ' selected' : '');
      row.innerHTML = `<span class="farm-row-icon">${def.icon}</span><span class="farm-row-name">${deps.esc(def.name)}</span><span class="farm-note">${count} owned</span>`;
      const btn = document.createElement('button');
      btn.className = 'settings-small-btn';
      btn.textContent = isArmed ? 'Cancel' : 'Place';
      btn.addEventListener('click', () => {
        deps.armFurniturePlacement(isArmed ? null : def.itemKey);
        render();
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  window.FurniturePlacer = { init, toggle, refreshVisibility, render };
})();
