(() => {
  'use strict';

  // A discoverable, inventory-scoped alternative to the hidden "scroll the
  // hotbar to a furniture item, then aim and interact" flow that's the only way
  // to place furniture otherwise. Deliberately NOT a spawn-for-free cheat
  // tool (unlike the farm editor/dev spawner, which are dev-mode-gated) —
  // works exactly like the farm editor's own paint brush: pick a piece here,
  // then tap/click a tile on the actual game view and it's placed
  // immediately, taken out of inventory. All placement validation (area,
  // tile clearance) and inventory consumption stays exactly where it
  // already lived (the decorative/processing placement functions
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
    const decorativeDefs = deps.getDecorativeFurnitureDefs();
    // Window furniture comes from the daylight-window extension rather than
    // the giant base furniture catalog. Re-register it at the point of use
    // so owned window items can never exist without an Available Furniture row
    // just because an init wrapper lost a load-order race.
    window.DaylightWindowRuntime?.registerDecorDefs?.(decorativeDefs);
    const decorative = Object.entries(decorativeDefs)
      .filter(([key, def]) => !def.fixture && !def.customPlace && !def.playerFurnitureDisabled) // Disabled legacy/dev furniture definitions can still restore placed saves without appearing as player-placeable inventory.
      .filter(([key, def]) => area === 'farm' || def.area === 'any' || def.area === area)
      .filter(([key]) => area !== 'interior' || !window.HouseWindowLinkage?.isWindowKey?.(key)) // Player windows are exterior-only; their interior copies are generated automatically.
      .map(([, def]) => def)
      .filter(def => (deps.inventory[def.itemKey] || 0) > 0);
    // Processing stations use the outdoor farm grid and world-object map;
    // list the same owned catalog here without pretending they are decor.
    const processing = area === 'farm'
      ? Object.values(deps.getProcessingFurnitureDefs())
        .filter(def => (deps.inventory[def.itemKey] || 0) > 0)
      : [];
    return decorative.concat(processing);
  }

  // Only a normal ownership/permission check — NOT dev-mode gated, unlike
  // the farm editor/dev spawner buttons that share this same top-right UI
  // slot by default (see .fp-shifted below). Hidden while the game is
  // paused (the main menu overlay is open) since the button sits in the
  // same fixed top-right corner the menu panel covers.
  function canOpen() {
    if (!deps) return false;
    const area = deps.getCurrentArea();
    return !deps.isPaused() && (area === 'farm' || area === 'interior') && deps.hasFarmPermission('placeFurniture');
  }

  function refreshVisibility() {
    const btn = document.getElementById('furniturePlacerBtn');
    if (!btn || !deps) return;
    const area = deps.getCurrentArea();
    const show = canOpen();
    btn.style.display = show ? '' : 'none';
    // Takes the farm editor pencil's own slot by default (empty for
    // virtually every player, since dev mode is off) — only shifts one
    // slot over while dev mode is on and that slot is actually occupied.
    const devSlotOccupied = deps.isDevMode() && (area === 'farm' || document.getElementById('mapEditBtn')?.style.display !== 'none'); // Keeps normal furniture UI clear of either contextual dev editor button.
    btn.classList.toggle('fp-shifted', devSlotOccupied);
    if (!show && _open) close();
    if (!show) {
      if (deps.getArmedFurniturePlacementKey() || deps.getArmedFurnitureMoveId()) {
        deps.armFurniturePlacement(null);
        deps.armFurnitureMove(null);
      }
      window.WallOrnamentPlacement?.finishPlayerAdjustment?.(); // Reticle-only wall placement also cancels if the player leaves a valid furniture area.
    }
  }

  function open() {
    if (!canOpen()) {
      deps?.showToast?.('Furniture placement is only available on your farm or inside your house.', false);
      return false;
    }
    const panel = document.getElementById('furniturePlacerPanel');
    const btn = document.getElementById('furniturePlacerBtn');
    window.WallOrnamentPlacement?.finishPlayerAdjustment?.();
    _open = true;
    window.__furniturePlacerPanelOpen = true;
    deps.suspendMouseCameraForUi?.();
    if (panel) panel.style.display = 'flex';
    if (btn) btn.classList.add('fed-open');
    render();
    return true;
  }

  function close({ keepArmed = false } = {}) {
    const panel = document.getElementById('furniturePlacerPanel');
    const btn = document.getElementById('furniturePlacerBtn');
    _open = false;
    window.__furniturePlacerPanelOpen = false;
    if (panel) panel.style.display = 'none';
    if (btn) btn.classList.remove('fed-open');
    if (!keepArmed) {
      deps.armFurniturePlacement(null);
      deps.armFurnitureMove(null);
    }
    deps.resumeMouseCameraAfterUi?.();
    return true;
  }

  function toggle() {
    return _open ? close() : open();
  }

  function render() {
    const hint = document.getElementById('furniturePlacerHint');
    const list = document.getElementById('furniturePlacerList');
    if (!list) return;
    const owned = _ownedPlaceableHere();
    const placed = deps.getPlacedFurniture().filter(obj => !obj?.derivedLinkedWindow); // Synthetic interior window copies are display-only and never get Move/Remove controls.
    const armed = deps.getArmedFurniturePlacementKey();
    const moveArmedId = deps.getArmedFurnitureMoveId();
    if (hint) {
      hint.textContent = moveArmedId
        ? 'Tap a clear tile to move the selected furniture there.'
        : (owned.length || placed.length)
          ? 'Choose furniture once, aim with the reticle, and press Action 1. Windows are placed only outside and snap to fixed 2-tile wall slots.'
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
        const wallApi = window.WallOrnamentPlacement;
        const defs = deps.getDecorativeFurnitureDefs();
        const wallKey = Object.keys(defs).find(key => defs[key] === def);
        const wallCapable = !!wallApi?.isWallOrnamentKey?.(wallKey, def);
        if (wallCapable) {
          const pending = wallApi.armNewPlayerFurniture(def.itemKey);
          close({ keepArmed: true });
          Promise.resolve(pending).then(started => {
            if (!started) open();
            deps.refreshActionBar?.(); // Async wall metadata load has now changed which Action 1/2 buttons touch must see.
          });
          return;
        }
        if (isArmed) {
          deps.armFurniturePlacement(null);
          render();
          return;
        }
        deps.armFurniturePlacement(def.itemKey);
        close({ keepArmed: true });
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
      const def = obj.placementKind === 'processing'
        ? deps.getProcessingFurnitureDefs()[obj.key]
        : deps.getDecorativeFurnitureDefs()[obj.key];
      if (!def) return;
      const wallApi = window.WallOrnamentPlacement; // Optional shared wall-placement bridge; absent builds retain the old floor-furniture controls unchanged.
      const wallCapable = obj.placementKind !== 'processing' && !!wallApi?.isWallOrnamentKey?.(obj.key, def); // Only decorative pieces with authored attachment metadata receive wall controls.
      const wallMounted = wallCapable && !!wallApi?.isPlayerMounted?.(obj.id); // Mounted pieces are managed in wall-space instead of tile move/45° rotation controls.
      const isMoveArmed = !wallMounted && moveArmedId === obj.id;
      const row = document.createElement('div');
      row.className = 'farm-row' + (isMoveArmed ? ' selected' : '');
      const locationLabel = wallMounted ? 'Wall mounted' : `${obj.col}, ${obj.row}`; // Keeps the list meaningful after a wall gizmo moves the visual away from the source tile center.
      row.innerHTML = `<span class="farm-row-icon">${def.icon}</span><span class="farm-row-name">${deps.esc(def.name)}</span><span class="farm-note">${locationLabel}</span>`;
      if (wallCapable) {
        const moveBtn = document.createElement('button');
        moveBtn.className = 'settings-small-btn';
        moveBtn.textContent = 'Move';
        moveBtn.addEventListener('click', () => {
          deps.armFurnitureMove(null);
          const pending = wallApi.adjustPlayerObject(obj.id);
          close({ keepArmed: true });
          Promise.resolve(pending).then(started => {
            if (!started) open();
            deps.refreshActionBar?.(); // Moving an existing wall mount enters the same Place/Cancel mobile arch.
          });
        });
        row.appendChild(moveBtn);
      } else if (!wallMounted) {
        const moveBtn = document.createElement('button');
        moveBtn.className = 'settings-small-btn';
        moveBtn.textContent = isMoveArmed ? 'Cancel' : 'Move';
        moveBtn.addEventListener('click', () => {
          if (isMoveArmed) { deps.armFurnitureMove(null); render(); return; }
          deps.armFurnitureMove(obj.id);
          close({ keepArmed: true });
        });
        row.appendChild(moveBtn);
        const rotateBtn = document.createElement('button');
        rotateBtn.className = 'settings-small-btn';
        rotateBtn.textContent = 'Rotate 45°';
        rotateBtn.addEventListener('click', () => {
          const result = deps.rotateFurniture(obj.id, 45);
          deps.showToast(result.message, result.ok);
          render();
        });
        row.appendChild(rotateBtn);
      }
      const removeBtn = document.createElement('button');
      removeBtn.className = 'settings-small-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        if (wallMounted) wallApi.unmountPlayerObject(obj.id); // Clear sidecar wall metadata before the ordinary furniture record/id is removed.
        const result = deps.removeFurniture(obj.id);
        deps.showToast(result.message, result.ok);
        render();
      });
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointerlockchange', () => {
      if (_open && document.pointerLockElement && typeof document.exitPointerLock === 'function') {
        try { document.exitPointerLock(); } catch (_) {} // A click-required Furniture menu can never reacquire camera capture while open.
      }
    });
  }

  window.FurniturePlacer = { init, open, close, toggle, canOpen, refreshVisibility, render, isOpen: () => _open };
})();
