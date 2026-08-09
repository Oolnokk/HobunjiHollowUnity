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
    if (!_open) {
      deps.armFurniturePlacement(null);
      deps.armFurnitureMove(null);
    }
    if (_open) render();
  }

  function render() {
    const hint = document.getElementById('furniturePlacerHint');
    const list = document.getElementById('furniturePlacerList');
    if (!list) return;
    const owned = _ownedPlaceableHere();
    const placed = deps.getPlacedFurniture();
    const armed = deps.getArmedFurniturePlacementKey();
    const moveArmedId = deps.getArmedFurnitureMoveId();
    if (hint) {
      hint.textContent = moveArmedId
        ? 'Tap a clear tile to move the selected furniture there.'
        : (owned.length || placed.length)
          ? 'Place owned furniture, or move/remove furniture already in this area.'
          : "You don't own or have any furniture placed here yet.";
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
    if (placed.length) {
      const title = document.createElement('div');
      title.className = 'house-layout-section-title';
      title.textContent = 'Placed Here';
      list.appendChild(title);
    }
    placed.forEach(obj => {
      const def = deps.getDecorativeFurnitureDefs()[obj.key];
      if (!def) return;
      const isMoveArmed = moveArmedId === obj.id;
      const row = document.createElement('div');
      row.className = 'farm-row' + (isMoveArmed ? ' selected' : '');
      row.innerHTML = `<span class="farm-row-icon">${def.icon}</span><span class="farm-row-name">${deps.esc(def.name)}</span><span class="farm-note">${obj.col}, ${obj.row}</span>`;
      const moveBtn = document.createElement('button');
      moveBtn.className = 'settings-small-btn';
      moveBtn.textContent = isMoveArmed ? 'Cancel' : 'Move';
      moveBtn.addEventListener('click', () => deps.armFurnitureMove(isMoveArmed ? null : obj.id));
      const removeBtn = document.createElement('button');
      removeBtn.className = 'settings-small-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        const result = deps.removeFurniture(obj.id);
        deps.showToast(result.message, result.ok);
        render();
      });
      row.append(moveBtn, removeBtn);
      list.appendChild(row);
    });
  }

  window.FurniturePlacer = { init, toggle, refreshVisibility, render };
})();
