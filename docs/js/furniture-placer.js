(() => {
  'use strict';

  // A discoverable, inventory-scoped furniture/portable-object placer. Normal
  // furniture still delegates to game.js's authoritative placement machinery;
  // Campfire is a special portable campsite because it must work in wilderness
  // maps and deliberately must NOT enter the persistent farm-layout system.
  let deps = null;
  let _open = false;

  function init(injectedDeps) {
    deps = injectedDeps;
    window.CampfireSystem?.attachFurnitureDeps?.({ ...injectedDeps, render });
  }

  function _ownedPlaceableHere() {
    const area = deps.getCurrentArea();
    if (area !== 'farm' && area !== 'interior') return [];
    const decorative = Object.values(deps.getDecorativeFurnitureDefs())
      .filter(def => !def.fixture)
      .filter(def => def.area === 'any' || def.area === area)
      .filter(def => (deps.inventory[def.itemKey] || 0) > 0);
    const processing = area === 'farm'
      ? Object.values(deps.getProcessingFurnitureDefs())
        .filter(def => (deps.inventory[def.itemKey] || 0) > 0)
      : [];
    return decorative.concat(processing);
  }

  function _campfireAvailableHere() {
    const system = window.CampfireSystem;
    return !!system?.canPlaceHere?.() && (system.ownedCount?.() || 0) > 0;
  }

  function _campfirePlacedHere() {
    const rec = window.CampfireSystem?.current?.();
    return rec && rec.area === deps.getCurrentArea() ? rec : null;
  }

  // Normal furniture retains the farm permission gate. A portable campfire is
  // also available on wilderness maps, where farm permissions are irrelevant.
  function refreshVisibility() {
    const btn = document.getElementById('furniturePlacerBtn');
    if (!btn || !deps) return;
    const area = deps.getCurrentArea();
    const normalArea = area === 'farm' || area === 'interior';
    const normalAllowed = normalArea && deps.hasFarmPermission('placeFurniture');
    const campfireRelevant = _campfireAvailableHere() || !!_campfirePlacedHere();
    const show = !deps.isPaused() && (normalAllowed || campfireRelevant);
    btn.style.display = show ? '' : 'none';
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
      window.CampfireSystem?.armPlacement?.(false);
    }
    if (_open) render();
  }

  function appendCampfireOwnedRow(list) {
    const system = window.CampfireSystem;
    if (!system?.canPlaceHere?.() || (system.ownedCount?.() || 0) <= 0) return false;
    const count = system.ownedCount();
    const isArmed = !!system.armed;
    const row = document.createElement('div');
    row.className = 'farm-row' + (isArmed ? ' selected' : '');
    row.innerHTML = `<span class="farm-row-icon">🔥</span><span class="farm-row-name">Campfire</span><span class="farm-note">${count} owned · portable</span>`;
    const btn = document.createElement('button');
    btn.className = 'settings-small-btn';
    btn.textContent = isArmed ? 'Cancel' : 'Place';
    btn.addEventListener('click', () => {
      deps.armFurniturePlacement(null);
      deps.armFurnitureMove(null);
      system.armPlacement(!isArmed);
      render();
    });
    row.appendChild(btn);
    list.appendChild(row);
    return true;
  }

  function appendCampfirePlacedRow(list, rec) {
    if (!rec) return false;
    const row = document.createElement('div');
    row.className = 'farm-row';
    row.innerHTML = `<span class="farm-row-icon">🔥</span><span class="farm-row-name">Campfire</span><span class="farm-note">${rec.col}, ${rec.row} · checkpoint</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'settings-small-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      window.CampfireSystem?.remove?.(true);
      render();
    });
    row.appendChild(removeBtn);
    list.appendChild(row);
    return true;
  }

  function render() {
    const hint = document.getElementById('furniturePlacerHint');
    const list = document.getElementById('furniturePlacerList');
    if (!list || !deps) return;
    const owned = _ownedPlaceableHere();
    const placed = deps.getPlacedFurniture();
    const campfirePlaced = _campfirePlacedHere();
    const campfireOwned = _campfireAvailableHere();
    const armed = deps.getArmedFurniturePlacementKey();
    const moveArmedId = deps.getArmedFurnitureMoveId();
    if (hint) {
      hint.textContent = window.CampfireSystem?.armed
        ? 'Tap a clear tile in the game view to place the campfire. The previous campfire will be destroyed.'
        : moveArmedId
          ? 'Tap a clear tile to move the selected furniture there.'
          : (owned.length || placed.length || campfireOwned || campfirePlaced)
            ? 'Place owned furniture or your portable campfire; campfires are limited to one per map visit.'
            : "You don't own or have any placeable objects here yet.";
    }
    list.innerHTML = '';

    appendCampfireOwnedRow(list);

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
        window.CampfireSystem?.armPlacement?.(false);
        deps.armFurniturePlacement(isArmed ? null : def.itemKey);
        render();
      });
      row.appendChild(btn);
      list.appendChild(row);
    });

    if (placed.length || campfirePlaced) {
      const title = document.createElement('div');
      title.className = 'house-layout-section-title';
      title.textContent = 'Placed Here';
      list.appendChild(title);
    }

    appendCampfirePlacedRow(list, campfirePlaced);

    placed.forEach(obj => {
      const def = obj.placementKind === 'processing'
        ? deps.getProcessingFurnitureDefs()[obj.key]
        : deps.getDecorativeFurnitureDefs()[obj.key];
      if (!def) return;
      const isMoveArmed = moveArmedId === obj.id;
      const row = document.createElement('div');
      row.className = 'farm-row' + (isMoveArmed ? ' selected' : '');
      row.innerHTML = `<span class="farm-row-icon">${def.icon}</span><span class="farm-row-name">${deps.esc(def.name)}</span><span class="farm-note">${obj.col}, ${obj.row}</span>`;
      const moveBtn = document.createElement('button');
      moveBtn.className = 'settings-small-btn';
      moveBtn.textContent = isMoveArmed ? 'Cancel' : 'Move';
      moveBtn.addEventListener('click', () => deps.armFurnitureMove(isMoveArmed ? null : obj.id));
      const rotateBtn = document.createElement('button');
      rotateBtn.className = 'settings-small-btn';
      rotateBtn.textContent = 'Rotate 45°';
      rotateBtn.addEventListener('click', () => {
        const result = deps.rotateFurniture(obj.id, 45);
        deps.showToast(result.message, result.ok);
        render();
      });
      const removeBtn = document.createElement('button');
      removeBtn.className = 'settings-small-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        const result = deps.removeFurniture(obj.id);
        deps.showToast(result.message, result.ok);
        render();
      });
      row.append(moveBtn, rotateBtn, removeBtn);
      list.appendChild(row);
    });
  }

  window.FurniturePlacer = { init, toggle, refreshVisibility, render };
})();
