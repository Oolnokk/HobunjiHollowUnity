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

  function canPlaceFromStorage(itemKey) {
    if (!deps?.hasFarmPermission('storage') || !deps.hasFarmPermission('placeFurniture')) return false;
    const area = deps.getCurrentArea(); // Storage can only place in the farm or farmhouse currently occupied by this player.
    if (area !== 'farm' && area !== 'interior') return false;
    const defs = deps.getDecorativeFurnitureDefs(); // Include extension-registered windows through the ordinary furniture registry.
    window.DaylightWindowRuntime?.registerDecorDefs?.(defs);
    const entry = Object.entries(defs).find(([, def]) => def.itemKey === itemKey); // Resolve only actual registered player furniture.
    if (entry) {
      const [key, def] = entry; // Wall/window restrictions match the normal selector.
      return !def.fixture && !def.customPlace && !def.playerFurnitureDisabled
        && (area === 'farm' || def.area === 'any' || def.area === area)
        && (area !== 'interior' || !window.HouseWindowLinkage?.isWindowKey?.(key));
    }
    return area === 'farm' && Object.values(deps.getProcessingFurnitureDefs()).some(def => def.itemKey === itemKey);
  }

  async function placeFromStorage(itemKey) {
    if (!canPlaceFromStorage(itemKey) || !(deps.furnitureStock(itemKey, 'storage') > 0)) return false;
    deps.closeMenu();
    const defs = deps.getDecorativeFurnitureDefs(); // Wall furniture keeps its authored wall-slot preview and validation.
    const key = Object.keys(defs).find(key => defs[key].itemKey === itemKey);
    if (key && window.WallOrnamentPlacement?.isWallOrnamentKey?.(key, defs[key])) {
      return window.WallOrnamentPlacement.armNewPlayerFurniture(itemKey, 'storage');
    }
    window.WallOrnamentPlacement?.finishPlayerAdjustment?.();
    deps.armFurniturePlacement(itemKey, 'storage');
    deps.showToast('Aim and press Action 1 to place from farm storage. Action 2 cancels.', true);
    return true;
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
    if (window.FarmworkUI?.isOpen?.() && !window.FarmworkUI.canOpen()) {
      window.FarmworkUI.close(); // Shared farm/house/zone refresh closes a stale Farmwork panel after travel or marriage reset.
    }
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
      if (deps.getArmedFurniturePlacementKey() || deps.getArmedFurnitureMoveId() || window.FarmhouseRoomPlanner?.isArmed?.()) {
        deps.armFurniturePlacement(null);
        deps.armFurnitureMove(null);
        window.FarmhouseRoomPlanner?.cancel?.(); // Leaving the farmhouse disarms its wall editor too.
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
      window.FarmhouseRoomPlanner?.cancel?.(); // Explicitly closing the menu cancels an unfinished wall.
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
    const roomPlanner = deps.getCurrentArea() === 'interior' ? window.FarmhouseRoomPlanner : null; // Farmhouse layout editing shares this furniture screen and reticle.
    if (hint && roomPlanner?.isArmed?.()) {
      hint.textContent = roomPlanner.stage() === 'second corner'
        ? 'First corner set. Aim at the opposite wall corner and press Action 1 (Action 2 cancels).'
        : 'Aim at an interior ground tile, then press Action 1 to confirm. Action 2 cancels.';
    } else if (hint) {
      hint.textContent = moveArmedId
        ? 'Aim and press Action 1 to move furniture; rugs use two opposite corners to resize.'
        : (owned.length || placed.length)
          ? 'Choose furniture once, aim with the reticle, and press Action 1. Windows are placed only outside and snap to fixed 2-tile wall slots.'
          : "You don't own or have any furniture placed here yet.";
    }
    list.innerHTML = '';
    if (roomPlanner) {
      const heading = document.createElement('div'); // Dedicated structural controls are not inventory consumables.
      heading.className = 'house-layout-section-title';
      heading.textContent = 'Walls & Room Doors';
      list.appendChild(heading);
      const wallRow = document.createElement('div');
      wallRow.className = 'farm-row';
      const wallLabel = document.createElement('span');
      wallLabel.className = 'farm-row-name'; wallLabel.textContent = 'Subdivide room';
      wallRow.appendChild(wallLabel);
      const wallButton = document.createElement('button');
      wallButton.className = 'settings-small-btn';
      wallButton.textContent = 'Place Wall';
      wallButton.onclick = () => {
        deps.armFurniturePlacement(null); deps.armFurnitureMove(null);
        if (roomPlanner.armWall()) close({ keepArmed: true });
        else deps.showToast('You cannot edit farmhouse walls here.', false);
      };
      wallRow.appendChild(wallButton);
      list.appendChild(wallRow);
      roomPlanner.segments().forEach(segment => {
        const row = document.createElement('div'); // Stable ID is preserved when a built room moves.
        row.className = 'farm-row';
        const name = document.createElement('span');
        name.className = 'farm-row-name';
        name.textContent = segment.builtIn ? 'Between house sections' : 'Room partition';
        const location = document.createElement('span');
        location.className = 'farm-note';
        location.textContent = 'Door: ' + segment.door.c + ', ' + segment.door.r;
        row.append(name, location);
        const move = document.createElement('button');
        move.className = 'settings-small-btn';
        move.textContent = 'Move Door';
        move.setAttribute('aria-label', 'Move room door at ' + location.textContent);
        move.onclick = () => {
          deps.armFurniturePlacement(null); deps.armFurnitureMove(null);
          if (roomPlanner.armDoor(segment.id)) close({ keepArmed: true });
          else deps.showToast('Cannot edit that doorway.', false);
        };
        row.appendChild(move);
        if (!segment.builtIn) {
          const remove = document.createElement('button');
          remove.className = 'settings-small-btn';
          remove.textContent = 'Remove Wall';
          remove.onclick = () => {
            const result = roomPlanner.removeWall(segment.id);
            deps.showToast(result.message, result.ok);
            render();
          };
          row.appendChild(remove);
        }
        list.appendChild(row);
      });
      const debug = document.createElement('button'); // Visible diagnostic for players without desktop developer tools.
      debug.className = 'settings-small-btn';
      debug.textContent = 'Show Wall Debug';
      debug.onclick = () => {
        const output = document.getElementById('farmhouseRoomDebug') || document.createElement('pre');
        output.id = 'farmhouseRoomDebug';
        output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;font-size:11px';
        output.textContent = JSON.stringify({ ...roomPlanner.debug(), furnitureRecovery: window.__farmhouseFurnitureRecovery || [] }, null, 2);
        if (!output.parentElement) list.insertBefore(output, debug.nextSibling);
        else output.hidden = !output.hidden;
      };
      list.appendChild(debug);
    }
    if (deps.getCurrentArea() === 'farm') {
      const fixtures = window.HousePieces?.getInteriorShiftableFeatures?.() || [];
      if (fixtures.length) {
        const heading = document.createElement('div');
        heading.className = 'house-layout-section-title';
        heading.textContent = 'House Fixtures · Interior Alignment';
        list.appendChild(heading);
        fixtures.forEach(feature => {
          const row = document.createElement('div');
          row.className = 'farm-row';
          const label = document.createElement('span');
          label.className = 'farm-row-name';
          label.textContent = feature.label + (feature.autoGenerated ? ' (Automatic)' : '');
          row.appendChild(label);
          const state = document.createElement('span'); // Makes the current interior-only offset visible without opening another editor.
          state.className = 'farm-note';
          state.textContent = feature.interiorShift < 0 ? 'Shifted left' : feature.interiorShift > 0 ? 'Shifted right' : 'Centered';
          row.appendChild(state);
          for (const [direction, text] of [[-1, 'Shift Interior Left'], [1, 'Shift Interior Right']]) {
            const button = document.createElement('button');
            button.className = 'settings-small-btn';
            button.textContent = text;
            button.setAttribute('aria-label', text + ' for ' + feature.label.toLowerCase());
            button.addEventListener('click', () => {
              const result = window.HousePieces.shiftInteriorFeature(feature.pieceId, feature.featureId, direction);
              deps.showToast(result.message, result.ok);
              render();
            });
            row.appendChild(button);
          }
          list.appendChild(row);
        });
      }
    }
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
      if (obj.area === 'interior' && (obj.key === 'wardrobe' || obj.key === 'chest')) {
        const owners = window.NpcFurnitureWardrobes?.familyOwners?.() || []; // Live spouse/child roster drives this instance's owner selector.
        const selectorLabel = document.createElement('label'); // Controller-friendly name ties the select to the specific furniture row.
        selectorLabel.className = 'farm-note';
        selectorLabel.textContent = 'Wardrobe for ';
        const select = document.createElement('select'); // One placed access point; it never creates a second clothing inventory.
        select.className = 'settings-small-btn';
        select.setAttribute('aria-label', def.name + ' at ' + locationLabel + ': wardrobe owner');
        const options = [{ id: '', label: 'Unassigned' }, ...owners.map(owner => ({ id: owner.id, label: owner.role + ': ' + owner.name }))];
        if (obj.npcWardrobeFor && !owners.some(owner => owner.id === obj.npcWardrobeFor)) {
          options.push({ id: obj.npcWardrobeFor, label: 'Unavailable: ' + obj.npcWardrobeFor }); // Keep an old assignment visible instead of silently discarding it after a family change.
        }
        for (const option of options) {
          const element = document.createElement('option'); // A native select remains usable with touch, keyboard and controller navigation.
          element.value = option.id;
          element.textContent = option.label;
          select.appendChild(element);
        }
        select.value = obj.npcWardrobeFor || '';
        select.addEventListener('change', () => {
          const result = deps.assignWardrobeOwner?.(obj.id, select.value) || { ok: false, message: 'Wardrobe assignment is unavailable.' };
          deps.showToast(result.message, result.ok);
          if (!result.ok) select.value = obj.npcWardrobeFor || '';
          else render(); // Refresh changed owner names while retaining every other furniture control.
        });
        selectorLabel.appendChild(select);
        row.appendChild(selectorLabel);
      }
      if (obj.key === 'rug') {
        const layerLabel = document.createElement('label'); // Each placed rug owns its independently saved overlap stack height.
        layerLabel.className = 'farm-note';
        layerLabel.textContent = 'Layer ';
        const layerInput = document.createElement('input'); // Touch/keyboard-friendly layer count editor, bounded to prevent runaway floating carpets.
        layerInput.type = 'number'; layerInput.min = '0'; layerInput.max = '32'; layerInput.step = '1';
        layerInput.value = String(Math.max(0, Math.min(32, Number(obj.rugLayer) || 0)));
        layerInput.style.width = '3.7em';
        layerInput.setAttribute('aria-label', 'Woven rug layer count at ' + locationLabel);
        layerInput.addEventListener('change', () => {
          const level = Number(layerInput.value); // Validation at the control boundary mirrors the authoritative setter.
          const result = deps.setRugLayer?.(obj.id, level) || { ok: false, message: 'Rug layering unavailable.' };
          deps.showToast(result.message, result.ok);
          render();
        });
        layerLabel.appendChild(layerInput);
        row.appendChild(layerLabel);
      }
      if (obj.area === 'farm' && window.HouseWindowLinkage?.isWindowKey?.(obj.key) && !obj.derivedLinkedWindow) {
        const alignment = document.createElement('span');
        alignment.className = 'farm-note';
        alignment.textContent = 'Interior only';
        row.appendChild(alignment);
        for (const [direction, label] of [[-1, 'Shift Interior Left'], [1, 'Shift Interior Right']]) {
          const shiftButton = document.createElement('button');
          shiftButton.className = 'settings-small-btn';
          shiftButton.textContent = label;
          shiftButton.setAttribute('aria-label', label + ' for window interior of ' + def.name);
          shiftButton.addEventListener('click', async () => {
            const result = await window.HouseWindowLinkage.shiftInteriorWindow(obj.id, direction);
            deps.showToast(result.message, result.ok);
            render();
          });
          row.appendChild(shiftButton);
        }
      }
      if (obj.key === 'rug' || obj.key === 'hangingBanner' || window.HouseWindowLinkage?.isWindowKey?.(obj.key)) {
        const patternBtn = document.createElement('button'); // Ordinary ownership/permission checks from this panel govern pattern edits too.
        patternBtn.className = 'settings-small-btn'; patternBtn.textContent = 'Color / Pattern';
        patternBtn.setAttribute('aria-label', 'Choose colors and pattern for ' + def.name);
        patternBtn.onclick = () => deps.editFurniturePattern?.(obj.id);
        row.appendChild(patternBtn);
      }
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

  window.FurniturePlacer = { canPlaceFromStorage, placeFromStorage, init, open, close, toggle, canOpen, refreshVisibility, render, isOpen: () => _open };
})();
