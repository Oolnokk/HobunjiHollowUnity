(() => {
  'use strict';

  // A discoverable, inventory-scoped alternative to the hidden "scroll the
  // hotbar to a decor item, then aim and interact" flow that's the only way
  // to place furniture today. Deliberately NOT a spawn-for-free cheat tool
  // (unlike the farm editor/dev spawner, which are now dev-mode-gated) —
  // picking a row here just calls selectItemForPlacement(itemKey), the
  // exact same "hold item, aim reticle, interact" pipeline the action bar
  // already drives for a manually-scrolled-to item. All placement
  // validation (area, tile clearance) and inventory consumption stays
  // exactly where it already lived (placeDecorativeFurniture/
  // canPlaceDecorativeFurnitureAt in game.js) — this module only decides
  // which owned items are worth listing and arms the existing flow.
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
  // the farm editor/dev spawner buttons in the same top-right UI row.
  // Hidden while the game is paused (the main menu overlay is open) since
  // the button sits in the same fixed top-right corner the menu panel
  // covers — a button you can still see/click behind the open menu is
  // confusing, not useful.
  function refreshVisibility() {
    const btn = document.getElementById('furniturePlacerBtn');
    if (!btn || !deps) return;
    const area = deps.getCurrentArea();
    const show = !deps.isPaused() && (area === 'farm' || area === 'interior') && deps.hasFarmPermission('placeFurniture');
    btn.style.display = show ? '' : 'none';
    if (!show && _open) toggle();
  }

  function toggle() {
    const panel = document.getElementById('furniturePlacerPanel');
    const btn = document.getElementById('furniturePlacerBtn');
    _open = panel?.style.display !== 'flex';
    if (panel) panel.style.display = _open ? 'flex' : 'none';
    if (btn) btn.classList.toggle('fed-open', _open);
    if (_open) render();
  }

  function render() {
    const hint = document.getElementById('furniturePlacerHint');
    const list = document.getElementById('furniturePlacerList');
    if (!list) return;
    const owned = _ownedPlaceableHere();
    if (hint) {
      hint.textContent = owned.length
        ? 'Pick a piece, then aim at a clear tile and interact to place it.'
        : "You don't own any furniture yet — buy some from the General Store.";
    }
    list.innerHTML = '';
    owned.forEach(def => {
      const count = deps.inventory[def.itemKey] || 0;
      const row = document.createElement('div');
      row.className = 'farm-row';
      row.innerHTML = `<span class="farm-row-icon">${def.icon}</span><span class="farm-row-name">${deps.esc(def.name)}</span><span class="farm-note">${count} owned</span>`;
      const btn = document.createElement('button');
      btn.className = 'settings-small-btn';
      btn.textContent = 'Select';
      btn.addEventListener('click', () => {
        if (deps.selectItemForPlacement(def.itemKey)) {
          deps.showToast(`${def.name} ready — aim and interact to place it.`, true);
          toggle();
        }
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  window.FurniturePlacer = { init, toggle, refreshVisibility };
})();
