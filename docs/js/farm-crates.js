(() => {
  'use strict';

  // Shipping Box (daily midnight sale cutoff, resolved when the player leaves
  // the farm or explicitly passes time) and Supply Box (mail-order supplies,
  // arrive next day) — the farm's two service world objects.
  let deps = null;
  let farmPanelDeps = null; // Used by the Shipping Box row to share the Farm tab's existing building-move UI and world-object map.
  let shippingBoxInstance = null; // Used by midnight settlement and the Farm tab move integration to address the currently live box object.
  let shippingMoveArmed = false; // Used to route the next Farm overview click to Shipping Box placement instead of barn placement.
  let farmBuildingsObserver = null; // Used to restore the Shipping Box row whenever FarmPanel rerenders its Buildings list.
  let shippingLifecycleTimer = 0; // Used to notice farm-area exits and natural day rollovers without coupling shipping to travel code.
  let lastObservedDay = null; // Used as the midnight cutoff boundary; calendar.day increments exactly once per new game day.
  let lastKnownArea = null; // Used to detect the first transition out of the farm context after a pending midnight shipment exists.
  let lifecycleBusy = false; // Used to prevent a cutoff/settlement pulse from recursively resolving itself.
  const pendingSaleCounts = Object.create(null); // Used to snapshot only goods that were present at a midnight cutoff; post-midnight deposits remain for the next day.

  function init(injectedDeps) {
    deps = injectedDeps;
    lastObservedDay = currentCalendarDay();
    installFarmPanelShippingIntegration();
    installShippingLifecycle();
  }

  function currentCalendarDay() {
    return Math.max(1, Math.floor(Number(deps?.calendar?.day) || 1));
  }

  function pendingSaleTotal() {
    return Object.values(pendingSaleCounts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  }

  function clearPendingSales() {
    Object.keys(pendingSaleCounts).forEach(key => { delete pendingSaleCounts[key]; });
  }

  function currentArea() {
    const panelArea = farmPanelDeps?.getCurrentArea?.(); // Preferred when FarmPanel's dependency bundle exposes the game area's canonical getter.
    if (panelArea) return panelArea;
    const debugArea = window.__climbDebug?.getCurrentArea?.(); // Existing always-on game debug bridge; fallback avoids adding another game.js dependency solely for area reads.
    return debugArea || null;
  }

  function isFarmContext(area) {
    // The farmhouse interior is still "on the farm" for shipping purposes;
    // walking into the house must not count as handing the box off for sale.
    return area === 'farm' || area === 'interior';
  }

  function captureMidnightCutoff() {
    const day = currentCalendarDay();
    if (lastObservedDay == null) { lastObservedDay = day; return false; }
    if (day < lastObservedDay) {
      // Farm/world reset: old pending accounting must never leak into the new day-1 world.
      lastObservedDay = day;
      clearPendingSales();
      return false;
    }
    if (day === lastObservedDay) return false;

    const bin = shippingBoxInstance?.getContents?.() || {};
    Object.entries(bin).forEach(([key, count]) => {
      const available = Math.max(0, Number(count) || 0);
      const alreadyPending = Math.max(0, Number(pendingSaleCounts[key]) || 0);
      // Goods already pending remain physically visible in the box until the
      // deferred resolution. Only the unscheduled remainder is newly captured.
      const newlyEligible = Math.max(0, available - alreadyPending);
      if (newlyEligible > 0) pendingSaleCounts[key] = alreadyPending + newlyEligible;
    });
    lastObservedDay = day;
    return true;
  }

  function settlePendingShippingSale(reason = 'midnight settlement') {
    if (lifecycleBusy || !shippingBoxInstance) return { sold: 0, earned: 0 };
    lifecycleBusy = true;
    try {
      captureMidnightCutoff();
      if (pendingSaleTotal() < 1) return { sold: 0, earned: 0 };

      const bin = shippingBoxInstance.getContents();
      let sold = 0;
      let earned = 0;
      const soldParts = [];
      for (const [key, pending] of Object.entries(pendingSaleCounts)) {
        const qty = Math.max(0, Math.min(Number(pending) || 0, Number(bin[key]) || 0));
        delete pendingSaleCounts[key];
        if (qty < 1) continue;
        bin[key] -= qty;
        sold += qty;
        earned += qty * (deps.BASE_PRICES[key] || 0);
        soldParts.push((deps.itemIconForKey(key) || key) + '×' + qty);
      }
      if (sold < 1) return { sold: 0, earned: 0 };

      deps.inventory.gold = (deps.inventory.gold || 0) + earned;
      const line = 'Day ' + currentCalendarDay() + ' midnight shipment — ' + soldParts.join(' ') + ' = ' + earned + 'g (' + reason + ')';
      const deliveryLog = deps.getDeliveryLog();
      deliveryLog.unshift({ type: 'sale', text: line });
      if (deliveryLog.length > 12) deliveryLog.pop();
      deps.showToast('📦 Midnight shipment sold! +' + earned + 'g', true);
      shippingBoxInstance.refreshVisual?.();
      if (deps.getMenuOpen()) deps.buildInventoryGrid();
      if (window.ShippingPanel?.isOpen?.()) deps.buildShippingTransferUI();
      deps.saveMemberWorldData();
      return { sold, earned };
    } finally {
      lifecycleBusy = false;
    }
  }

  function shippingLifecyclePulse() {
    if (!deps) return;
    const crossedMidnight = captureMidnightCutoff();
    const area = currentArea();

    // If midnight arrives while the player is already away from the farm,
    // there is nothing to defer: resolve the shipment at the cutoff itself.
    if (crossedMidnight && area && !isFarmContext(area)) {
      settlePendingShippingSale('player already away from farm');
    }

    // If midnight already happened while the player remained on the farm,
    // the first actual departure is the deferred hand-off trigger.
    if (lastKnownArea && isFarmContext(lastKnownArea) && area && !isFarmContext(area)) {
      settlePendingShippingSale('left farm');
    }
    if (area) lastKnownArea = area;
  }

  function installShippingLifecycle() {
    if (shippingLifecycleTimer) return;
    window.addEventListener('hobunji-time-passage', event => {
      const kind = event?.detail?.kind;
      if (kind !== 'wait' && kind !== 'sleep') return;
      // Wait/Sleep is explicitly a resolution trigger. Capture a midnight
      // crossed by the time jump first, then settle whatever was eligible.
      captureMidnightCutoff();
      settlePendingShippingSale(kind);
    });
    shippingLifecycleTimer = window.setInterval(shippingLifecyclePulse, 500);
  }

  function installFarmPanelShippingIntegration() {
    const panel = window.FarmPanel;
    if (!panel) return;
    if (!panel.__shippingBoxFarmUiPatched) {
      const originalInit = panel.init; // Used to capture the same dependency bundle FarmPanel already receives from game.js.
      panel.init = function shippingAwareFarmPanelInit(injectedDeps) {
        farmPanelDeps = injectedDeps;
        const result = originalInit.apply(this, arguments);
        bindFarmBuildingUiHooks();
        return result;
      };
      panel.__shippingBoxFarmUiPatched = true;
    }
    bindFarmBuildingUiHooks();
  }

  function bindFarmBuildingUiHooks() {
    if (!document.body) return;
    const list = document.getElementById('farmBuildingsList');
    const canvas = document.getElementById('farmGlanceCanvas');
    if (list && !farmBuildingsObserver) {
      farmBuildingsObserver = new MutationObserver(() => ensureShippingFarmBuildingRow());
      farmBuildingsObserver.observe(list, { childList: true });
    }
    if (canvas && !canvas.dataset.shippingMoveBound) {
      canvas.dataset.shippingMoveBound = '1';
      canvas.addEventListener('click', event => {
        if (!shippingMoveArmed) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = canvas.getBoundingClientRect();
        const px = canvas.width / Math.max(1, farmPanelDeps?.getGrid?.()?.[0]?.length || 1); // Used to convert the same glance-canvas click into a farm column.
        const py = canvas.height / Math.max(1, farmPanelDeps?.getGrid?.()?.length || 1); // Used to convert the same glance-canvas click into a farm row.
        const col = Math.floor((event.clientX - rect.left) * (canvas.width / rect.width) / px);
        const row = Math.floor((event.clientY - rect.top) * (canvas.height / rect.height) / py);
        const result = moveShippingBoxFromFarmPanel(col, row);
        (farmPanelDeps?.showToast || deps.showToast)(result.message, result.ok);
        if (result.ok) shippingMoveArmed = false;
        window.FarmPanel?.render?.();
        ensureShippingFarmBuildingRow();
      }, true);
    }
    ensureShippingFarmBuildingRow();
  }

  function syncShippingMoveUi() {
    const canvas = document.getElementById('farmGlanceCanvas');
    const note = document.getElementById('farmBuildingsNote');
    const cancelBtn = document.getElementById('farmCancelPlacementBtn');
    if (shippingMoveArmed) {
      if (canvas) canvas.style.cursor = 'crosshair';
      if (note) note.textContent = 'Click a tile on the map above to move the Shipping Box there.';
      if (cancelBtn) {
        cancelBtn.hidden = false;
        cancelBtn.onclick = () => {
          shippingMoveArmed = false;
          window.FarmPanel?.render?.();
          ensureShippingFarmBuildingRow();
        };
      }
    } else if (note && note.textContent === 'Move a barn, or place an owned barn plan, by clicking the map above. Open House Layout to edit your house.') {
      note.textContent = 'Move a barn or the Shipping Box by clicking the map above. Place owned barn plans here, or open House Layout to edit your house.';
    }
  }

  function ensureShippingFarmBuildingRow() {
    const list = document.getElementById('farmBuildingsList');
    if (!list || !shippingBoxInstance) return;
    let row = list.querySelector('[data-farm-building-kind="shipping-box"]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'farm-row';
      row.dataset.farmBuildingKind = 'shipping-box';
      row.innerHTML = '<span class="farm-row-name">📦 Shipping Box</span><span class="farm-note">2×1</span>';
      const canAlter = !!farmPanelDeps?.hasFarmPermission?.('alterFarm');
      if (canAlter) {
        const btn = document.createElement('button');
        btn.className = 'settings-small-btn';
        btn.type = 'button';
        btn.dataset.shippingBoxMove = '1';
        btn.textContent = 'Move';
        btn.addEventListener('click', () => {
          const existingCancel = document.getElementById('farmCancelPlacementBtn');
          if (existingCancel && !existingCancel.hidden && !shippingMoveArmed) existingCancel.click();
          shippingMoveArmed = true;
          syncShippingMoveUi();
        });
        row.appendChild(btn);
      }
      const firstPlan = [...list.children].find(child => child.textContent?.trim?.().startsWith('📜'));
      list.insertBefore(row, firstPlan || null);
    }
    syncShippingMoveUi();
  }

  function moveShippingBoxFromFarmPanel(col, row) {
    const box = shippingBoxInstance;
    const worldObjects = farmPanelDeps?.worldObjects;
    if (!box || !worldObjects) return { ok: false, message: 'Shipping Box move system is not ready.' };
    if (!Number.isFinite(col) || !Number.isFinite(row)) return { ok: false, message: 'Choose a valid farm tile.' };
    const canPlace = window.FarmBuildings?.canPlaceAt?.(col, row, box.w || 2, box.h || 1, box.id);
    if (!canPlace) return { ok: false, message: 'The Shipping Box will not fit there.' };

    const oldKey = box.col + ',' + box.row;
    worldObjects.delete(oldKey);
    box.moveTo(col, row);
    worldObjects.set(box.col + ',' + box.row, box);
    window._farmEditor?.save?.();
    deps.saveMemberWorldData();
    return { ok: true, message: 'Shipping Box moved.' };
  }

  function makeSellCrate(col, row) {
    const bin = Object.fromEntries(Object.keys(deps.BASE_PRICES).map(key => [key, 0]));
    const position = { col, row }; // Used by farm-editor coordinate assignments and shipping-box visual syncing.

    // Reuse the exact procedural Storage Chest recipe and stretch it to two
    // tiles wide. Keeping the individual recipe parts as separate world meshes
    // preserves the old crate's body/lid interaction shape while replacing the
    // orange placeholder cube with the established furniture visual language.
    const furniture = window.ProceduralFurniture;
    const sourceRecipe = furniture?.CATALOG?.chest;
    const baseColor = 0x7b4c2b;
    const parts = [];
    if (sourceRecipe?.length >= 2 && furniture?.buildPartMesh) {
      sourceRecipe.forEach(part => {
        const stretched = {
          ...part,
          transform: {
            ...part.transform,
            x: (part.transform?.x || 0) * 2,
            sx: Math.max(0.001, (part.transform?.sx || 0.001) * 2),
          },
        };
        const partMesh = furniture.buildPartMesh(stretched, baseColor);
        partMesh.userData.shippingLocalPosition = partMesh.position.clone();
        parts.push(partMesh);
        deps.scene.add(partMesh);
      });
    } else {
      const bodyMat = new THREE.MeshLambertMaterial({ color: baseColor });
      const lidMat = new THREE.MeshLambertMaterial({ color: 0x915c35 });
      const latchMat = new THREE.MeshLambertMaterial({ color: 0x3d2a1d });
      const fallback = [
        new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.38, 0.5), bodyMat),
        new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.08, 0.52), lidMat),
        new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.03), latchMat),
      ];
      fallback[0].position.set(0, 0.19, 0);
      fallback[1].position.set(0, 0.42, 0);
      fallback[2].position.set(0, 0.39, 0.26);
      fallback.forEach(partMesh => {
        partMesh.castShadow = true;
        partMesh.receiveShadow = true;
        partMesh.userData.shippingLocalPosition = partMesh.position.clone();
        parts.push(partMesh);
        deps.scene.add(partMesh);
      });
    }

    const mesh = parts[0];
    const lid = parts[1] || null;
    const latch = parts[2] || null;
    const movableParts = [mesh, lid].filter(Boolean); // Used by the existing editor cleanup path, which removes only body + lid.
    if (latch && lid) {
      const latchLocal = latch.userData.shippingLocalPosition; // Used to preserve the chest recipe's latch offset after parenting it to the lid.
      const lidLocal = lid.userData.shippingLocalPosition; // Used as the relative-origin reference for the child latch.
      deps.scene.remove(latch);
      lid.add(latch);
      latch.position.set(latchLocal.x - lidLocal.x, latchLocal.y - lidLocal.y, latchLocal.z - lidLocal.z);
    }

    function syncVisualTransform(lidLift = 0) {
      const groundY = deps.tileSurfaceY(deps.TileType.GRASS);
      const centerX = position.col + 1;
      const centerZ = position.row + 0.5;
      movableParts.forEach((partMesh, index) => {
        const local = partMesh.userData.shippingLocalPosition;
        const lift = index > 0 ? lidLift : 0;
        partMesh.position.set(centerX + local.x, groundY + local.y + lift, centerZ + local.z);
      });
    }
    syncVisualTransform();

    function totalItems() {
      return Object.values(bin).reduce((sum, value) => sum + value, 0);
    }
    function contentsStr() {
      const contents = Object.entries(bin)
        .filter(([, value]) => value > 0)
        .map(([key, value]) => (deps.itemIconForKey(key) + '×' + value));
      return contents.length ? contents.join(' ') : 'Empty';
    }
    function moveTo(nextCol, nextRow) {
      if (Number.isFinite(Number(nextCol))) position.col = Math.round(Number(nextCol));
      if (Number.isFinite(Number(nextRow))) position.row = Math.round(Number(nextRow));
      syncVisualTransform(totalItems() > 0 ? 0.06 : 0);
      return { col: position.col, row: position.row };
    }

    const worldObject = {
      id: 'sell_crate', type: 'sell_crate', w: 2, h: 1, mesh, lid, latch, contentsStr,
      label: '📦 Shipping Box',
      get col() { return position.col; },
      set col(value) { moveTo(value, position.row); },
      get row() { return position.row; },
      set row(value) { moveTo(position.col, value); },
      moveTo,
      refreshVisual() { syncVisualTransform(totalItems() > 0 ? 0.06 : 0); },
      getPendingSaleTotal: pendingSaleTotal,
      getMidnightCutoffDay: () => lastObservedDay,
      getButtons() {
        const item = deps.getActiveInventoryItem();
        const btns = [];
        // Fast one-item deposit for the currently selected sellable item.
        if (item && deps.BASE_PRICES[item.key] !== undefined) {
          const count = deps.inventory[item.key] || 0;
          btns.push({
            icon: item.icon,
            label: count > 0 ? 'Ship ' + item.icon : 'None',
            action: 'obj_deposit',
            style: 'primary',
            allowed: count > 0,
          });
        }
        const total = totalItems();
        btns.push({ icon: '📦', label: total > 0 ? 'Open Box' : 'Shipping', action: 'obj_open_shipping', style: total > 0 ? 'secondary' : 'primary', allowed: true });
        return btns;
      },
      onAction(action) {
        if (action === 'obj_deposit') {
          const item = deps.getActiveInventoryItem();
          if (!item || deps.BASE_PRICES[item.key] === undefined) return { ok: false, message: 'Cannot deposit that.' };
          const qty = deps.inventory[item.key] || 0;
          if (qty < 1) return { ok: false, message: 'No ' + item.label + ' to deposit.' };
          deps.inventory[item.key]--;
          deps.clampInventoryStack(item.key);
          bin[item.key] = (bin[item.key] || 0) + 1;
          syncVisualTransform(0.06);
          return { ok: true, message: 'Deposited ' + item.icon + ' into shipping box.' };
        }
        if (action === 'obj_show_bin' || action === 'obj_open_shipping') {
          if (window.ShippingPanel?.open?.()) {
            return { ok: true, message: contentsStr() };
          }
          // Compatibility fallback for an unusually early/failed module load.
          deps.openMenu('shipping');
          return { ok: true, message: contentsStr() };
        }
        return { ok: false, message: 'Unknown action.' };
      },
      getContents() {
        return bin;
      },
      getTotalItems() {
        return totalItems();
      },
      depositItem(key, qty) {
        if (deps.BASE_PRICES[key] === undefined) return 0;
        const moved = Math.max(0, Math.min(qty, deps.inventory[key] || 0));
        if (moved < 1) return 0;
        deps.inventory[key] -= moved;
        bin[key] = (bin[key] || 0) + moved;
        syncVisualTransform(0.06);
        return moved;
      },
      withdrawItem(key, qty) {
        // Self-guarded (not just at the transfer UI call site) so future API
        // callers cannot bypass the farm's storage-withdraw permission.
        if (!deps.hasFarmPermission('storage')) return 0;
        const moved = Math.max(0, Math.min(qty, bin[key] || 0));
        if (moved < 1) return 0;
        bin[key] -= moved;
        // If midnight already made some of this stack eligible, taking it back
        // out cancels that many pending units before touching newer deposits.
        if ((pendingSaleCounts[key] || 0) > 0) {
          pendingSaleCounts[key] = Math.max(0, pendingSaleCounts[key] - moved);
          if (pendingSaleCounts[key] < 1) delete pendingSaleCounts[key];
        }
        deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + moved);
        syncVisualTransform(totalItems() > 0 ? 0.06 : 0);
        return moved;
      },
      tick() {
        // Midnight eligibility is keyed to calendar.day, never to a rolling
        // N-hour timer. tick() only observes the cutoff; it deliberately does
        // not empty the box while the player remains on the farm.
        shippingLifecyclePulse();
        syncVisualTransform(totalItems() > 0 ? 0.06 : 0);
      },
      reset() {
        Object.keys(bin).forEach(key => { bin[key] = 0; });
        clearPendingSales();
        lastObservedDay = currentCalendarDay();
        syncVisualTransform();
      },
    };
    shippingBoxInstance = worldObject;
    ensureShippingFarmBuildingRow();
    return worldObject;
  }

  function makeSupplyBox(col, row) {
    const mat  = new THREE.MeshLambertMaterial({ color: 0x2060c0 });
    const geo  = new THREE.BoxGeometry(0.7, 0.55, 0.7);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(col + 0.5, deps.tileSurfaceY(deps.TileType.GRASS) + 0.28, row + 0.5);
    deps.scene.add(mesh);

    const lidMat = new THREE.MeshLambertMaterial({ color: 0x4080e0 });
    const lid    = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.72), lidMat);
    lid.position.set(col + 0.5, deps.tileSurfaceY(deps.TileType.GRASS) + 0.56, row + 0.5);
    deps.scene.add(lid);

    // qty selections per catalog item
    const qtys = {};
    deps.SUPPLY_CATALOG.forEach(it => { qtys[it.key] = 0; });

    return {
      id: 'supply_box', type: 'supply_box', col, row, mesh, lid,
      label: '📦 Supply Box',
      getButtons() {
        return [
          { icon: '📦', label: 'Order', action: 'obj_open_shop', style: 'primary', allowed: true },
        ];
      },
      onAction(action) {
        if (action === 'obj_open_shop') {
          deps.openMenu('supplies');
          return { ok: true, message: 'Opened supply ordering.' };
        }
        if (action.startsWith('obj_buy_')) {
          const key = action.slice(8);
          const item = deps.SUPPLY_CATALOG.find(it => it.key === key);
          if (!item) return { ok: false, message: 'Unknown item.' };
          if (item.comingSoon) return { ok: false, message: item.name + ' purchases are coming soon.' };
          const qty = qtys[key] || 0;
          if (qty < 1) return { ok: false, message: 'Select a quantity first.' };
          const cost = item.price * qty;
          if (deps.inventory.gold < cost) return { ok: false, message: 'Not enough gold. Need ' + cost + 'g.' };
          deps.inventory.gold -= cost;
          deps.getPendingOrders().push({ key, qty, arrivalDay: deps.calendar.day + 1, item });
          qtys[key] = 0;
          return { ok: true, message: 'Ordered ' + qty + '× ' + item.name + ' for ' + cost + 'g. Arrives tomorrow.' };
        }
        return { ok: false, message: 'Unknown action.' };
      },
      getQtys() { return qtys; },
      reset() { Object.keys(qtys).forEach(k => { qtys[k] = 0; }); },
    };
  }

  window.FarmCrates = {
    init,
    makeSellCrate,
    makeSupplyBox,
    settlePendingShippingSale,
    getPendingShippingTotal: pendingSaleTotal,
  };
})();
