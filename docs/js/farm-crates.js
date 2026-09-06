(() => {
  'use strict';

  // Shipping Box (daily cutoff + deferred settlement) and Supply Box. All
  // Shipping Box-specific tuning lives in shipping-box-config.js; this module
  // owns mutable shipping inventory/accounting state and the farm service API.
  let deps = null;
  let farmPanelDeps = null;
  let shippingBoxInstance = null;
  let shippingMoveArmed = false;
  let farmBuildingsObserver = null;
  let shippingLifecycleTimer = 0;
  let lastObservedDay = null;
  let lastKnownArea = null;
  let lifecycleBusy = false;
  const pendingSaleCounts = Object.create(null);

  function config() {
    if (!window.ShippingBoxConfig) throw new Error('ShippingBoxConfig must load before FarmCrates.init');
    return window.ShippingBoxConfig;
  }
  const objectCfg = () => config().object;
  const lifecycleCfg = () => config().lifecycle;
  const inventoryCfg = () => config().inventory;
  const farmUiCfg = () => config().farmUi;
  const actionCfg = () => config().actions;
  const interactionCfg = () => config().interactionUi;

  // The Shipping Box originally only recognized raw crops (deps.BASE_PRICES).
  // Every processed good (jam, wine, butter, cheese, flour…) also gets a
  // sellPrice registered onto ITEM_DEFS when its recipe first fires (see
  // ItemProcessing.ensureProcessedItemDef), so this falls back to that once
  // BASE_PRICES doesn't recognize the key — letting a factory's actual
  // products auto-sell through the same deposit/midnight-settle pipeline
  // raw crops already use, instead of only ever being sellable one at a
  // time through the Inventory grid's manual Sell buttons. Returns
  // undefined (not 0) for anything genuinely unsellable, so callers can
  // still tell "no price" apart from "sells for 0".
  function sellPriceFor(key) {
    const basePrice = deps.BASE_PRICES[key];
    if (basePrice !== undefined) return basePrice;
    const processedPrice = deps.ITEM_DEFS?.[key]?.sellPrice;
    return Number.isFinite(processedPrice) ? processedPrice : undefined;
  }

  function footprintSize() {
    const fp = objectCfg().footprint;
    return {
      width: Math.max(1, Math.round(Number(fp.width))),
      height: Math.max(1, Math.round(Number(fp.height))),
    };
  }

  function footprintKeys(col, row) {
    const { width, height } = footprintSize();
    const keys = [];
    for (let dz = 0; dz < height; dz++) for (let dx = 0; dx < width; dx++) keys.push(`${col + dx},${row + dz}`);
    return keys;
  }

  function init(injectedDeps) {
    config();
    deps = injectedDeps;
    lastObservedDay = currentCalendarDay();
    installFarmPanelShippingIntegration();
    installShippingPlacementGuard();
    installShippingLifecycle();
  }

  function currentCalendarDay() {
    const life = lifecycleCfg();
    return Math.max(Number(life.minCalendarDay), Math.floor(Number(deps?.calendar?.day) || Number(life.minCalendarDay)));
  }

  function pendingSaleTotal() {
    return Object.values(pendingSaleCounts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  }

  function clearPendingSales() {
    Object.keys(pendingSaleCounts).forEach(key => { delete pendingSaleCounts[key]; });
  }

  function currentArea() {
    const panelArea = farmPanelDeps?.getCurrentArea?.();
    if (panelArea) return panelArea;
    return window.__climbDebug?.getCurrentArea?.() || null;
  }

  function isFarmContext(area) {
    return lifecycleCfg().farmContextAreas.includes(area);
  }

  function captureMidnightCutoff() {
    const day = currentCalendarDay();
    if (lastObservedDay == null) { lastObservedDay = day; return false; }
    if (day < lastObservedDay) {
      lastObservedDay = day;
      clearPendingSales();
      return false;
    }
    if (day === lastObservedDay) return false;

    const bin = shippingBoxInstance?.getContents?.() || {};
    Object.entries(bin).forEach(([key, count]) => {
      const available = Math.max(0, Number(count) || 0);
      const alreadyPending = Math.max(0, Number(pendingSaleCounts[key]) || 0);
      const newlyEligible = Math.max(0, available - alreadyPending);
      if (newlyEligible > 0) pendingSaleCounts[key] = alreadyPending + newlyEligible;
    });
    lastObservedDay = day;
    return true;
  }

  function settlePendingShippingSale(reason = lifecycleCfg().reasons.default) {
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
        earned += qty * (sellPriceFor(key) || 0);
        soldParts.push((deps.itemIconForKey(key) || key) + '×' + qty);
      }
      if (sold < 1) return { sold: 0, earned: 0 };

      deps.inventory.gold = (deps.inventory.gold || 0) + earned;
      const ui = interactionCfg();
      const line = `Day ${currentCalendarDay()} ${ui.deliveryLogLabel} — ${soldParts.join(' ')} = ${earned}g (${reason})`;
      const deliveryLog = deps.getDeliveryLog();
      deliveryLog.unshift({ type: ui.deliveryLogType, text: line });
      while (deliveryLog.length > Number(lifecycleCfg().deliveryLogLimit)) deliveryLog.pop();
      deps.showToast(`${objectCfg().icon} ${ui.saleToastPrefix}${earned}g`, true);
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
    const life = lifecycleCfg();
    const crossedMidnight = captureMidnightCutoff();
    const area = currentArea();

    if (life.resolveIfAlreadyAwayAtMidnight && crossedMidnight && area && !isFarmContext(area)) {
      settlePendingShippingSale(life.reasons.alreadyAway);
    }
    if (lastKnownArea && isFarmContext(lastKnownArea) && area && !isFarmContext(area)) {
      settlePendingShippingSale(life.reasons.leftFarm);
    }
    if (area) lastKnownArea = area;
  }

  function installShippingLifecycle() {
    if (shippingLifecycleTimer) return;
    const life = lifecycleCfg();
    window.addEventListener(life.timePassageEvent, event => {
      const kind = event?.detail?.kind;
      if (!life.resolveOnTimePassageKinds.includes(kind)) return;
      captureMidnightCutoff();
      settlePendingShippingSale(kind);
    });
    shippingLifecycleTimer = window.setInterval(shippingLifecyclePulse, Number(life.pollMs));
  }

  function patchFarmPanel(panel) {
    if (!panel?.init || panel.__shippingBoxFarmUiPatched) return;
    const originalInit = panel.init.bind(panel);
    panel.init = function shippingAwareFarmPanelInit(injectedDeps, ...rest) {
      farmPanelDeps = injectedDeps;
      const result = originalInit(injectedDeps, ...rest);
      bindFarmBuildingUiHooks();
      return result;
    };
    panel.__shippingBoxFarmUiPatched = true;
  }

  function installFarmPanelShippingIntegration() {
    if (window.FarmPanel) {
      patchFarmPanel(window.FarmPanel);
      if (window.ShippingBoxConfig) bindFarmBuildingUiHooks();
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'FarmPanel');
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    let value = descriptor?.value;
    Object.defineProperty(window, 'FarmPanel', {
      configurable: true,
      get() { return previousGet ? previousGet.call(window) : value; },
      set(next) {
        if (previousSet) previousSet.call(window, next);
        else value = next;
        patchFarmPanel(previousGet ? previousGet.call(window) : value);
      },
    });
  }

  function rectsOverlap(aCol, aRow, aW, aH, bCol, bRow, bW, bH) {
    return aCol < bCol + bW && aCol + aW > bCol && aRow < bRow + bH && aRow + aH > bRow;
  }

  function installShippingPlacementGuard() {
    const buildings = window.FarmBuildings;
    if (!buildings?.canPlaceAt || buildings.__shippingBoxPlacementGuarded) return;
    const originalCanPlaceAt = buildings.canPlaceAt.bind(buildings);
    buildings.canPlaceAt = function shippingAwareCanPlaceAt(col, row, w, h, excludeId) {
      if (!originalCanPlaceAt(col, row, w, h, excludeId)) return false;
      const box = shippingBoxInstance;
      if (!box || excludeId === box.id) return true;
      const fp = footprintSize();
      return !rectsOverlap(col, row, w, h, box.col, box.row, fp.width, fp.height);
    };
    buildings.__shippingBoxPlacementGuarded = true;
  }

  function bindFarmBuildingUiHooks() {
    if (!window.ShippingBoxConfig || !document.body) return;
    const ui = farmUiCfg();
    const list = document.getElementById(ui.listId);
    const canvas = document.getElementById(ui.canvasId);
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
        const grid = farmPanelDeps?.getGrid?.() || [];
        const px = canvas.width / Math.max(1, grid?.[0]?.length || 1);
        const py = canvas.height / Math.max(1, grid.length || 1);
        const col = Math.floor((event.clientX - rect.left) * (canvas.width / rect.width) / px);
        const row = Math.floor((event.clientY - rect.top) * (canvas.height / rect.height) / py);
        const result = moveShippingBoxFromFarmPanel(col, row);
        (farmPanelDeps?.showToast || deps?.showToast)?.(result.message, result.ok);
        if (result.ok) shippingMoveArmed = false;
        window.FarmPanel?.render?.();
        ensureShippingFarmBuildingRow();
      }, true);
    }
    ensureShippingFarmBuildingRow();
  }

  function syncShippingMoveUi() {
    const ui = farmUiCfg();
    const canvas = document.getElementById(ui.canvasId);
    const note = document.getElementById(ui.noteId);
    const cancelBtn = document.getElementById(ui.cancelButtonId);
    if (shippingMoveArmed) {
      if (canvas) canvas.style.cursor = ui.cursor;
      if (note) note.textContent = ui.placementPrompt;
      if (cancelBtn) {
        cancelBtn.hidden = false;
        cancelBtn.onclick = () => {
          shippingMoveArmed = false;
          window.FarmPanel?.render?.();
          ensureShippingFarmBuildingRow();
        };
      }
    } else {
      if (canvas) canvas.style.cursor = '';
      if (note && note.textContent === ui.defaultBuildingNote) note.textContent = ui.combinedBuildingNote;
    }
  }

  function ensureShippingFarmBuildingRow() {
    if (!window.ShippingBoxConfig) return;
    const ui = farmUiCfg();
    const object = objectCfg();
    const list = document.getElementById(ui.listId);
    if (!list || !shippingBoxInstance) return;
    let row = list.querySelector(`[data-farm-building-kind="${ui.rowKind}"]`);
    if (!row) {
      const fp = footprintSize();
      row = document.createElement('div');
      row.className = ui.rowClass;
      row.dataset.farmBuildingKind = ui.rowKind;
      row.innerHTML = `<span class="${ui.nameClass}">${object.icon} ${object.label}</span><span class="${ui.noteClass}">${fp.width}×${fp.height}</span>`;
      if (farmPanelDeps?.hasFarmPermission?.(inventoryCfg().permissions.alterFarm)) {
        const btn = document.createElement('button');
        btn.className = ui.moveButtonClass;
        btn.type = 'button';
        btn.dataset[ui.moveButtonDataKey] = '1';
        btn.textContent = ui.moveButtonText;
        btn.addEventListener('click', () => {
          const existingCancel = document.getElementById(ui.cancelButtonId);
          if (existingCancel && !existingCancel.hidden && !shippingMoveArmed) existingCancel.click();
          shippingMoveArmed = true;
          syncShippingMoveUi();
        });
        row.appendChild(btn);
      }
      const firstPlan = [...list.children].find(child => child.textContent?.trim?.().startsWith(ui.planPrefix));
      list.insertBefore(row, firstPlan || null);
    }
    syncShippingMoveUi();
  }

  function moveShippingBoxFromFarmPanel(col, row) {
    const ui = farmUiCfg();
    const box = shippingBoxInstance;
    const worldObjects = farmPanelDeps?.worldObjects;
    if (!box || !worldObjects) return { ok: false, message: ui.messages.notReady };
    if (!Number.isFinite(col) || !Number.isFinite(row)) return { ok: false, message: ui.messages.invalidTile };
    installShippingPlacementGuard();
    const fp = footprintSize();
    if (!window.FarmBuildings?.canPlaceAt?.(col, row, fp.width, fp.height, box.id)) return { ok: false, message: ui.messages.noFit };

    footprintKeys(box.col, box.row).forEach(key => { if (worldObjects.get(key) === box) worldObjects.delete(key); });
    box.moveTo(col, row);
    footprintKeys(box.col, box.row).forEach(key => worldObjects.set(key, box));
    window._farmEditor?.save?.();
    deps.saveMemberWorldData();
    return { ok: true, message: ui.messages.moved };
  }

  function colorValue(value) {
    if (typeof value === 'number') return value;
    return parseInt(String(value).replace('#', ''), 16);
  }

  function makeFallbackPart(definition) {
    const [sx, sy, sz] = definition.size;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Number(sx), Number(sy), Number(sz)),
      new THREE.MeshLambertMaterial({ color: colorValue(definition.color) }),
    );
    mesh.position.set(...definition.position.map(Number));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.shippingLocalPosition = mesh.position.clone();
    deps.scene.add(mesh);
    return mesh;
  }

  function makeSellCrate(col, row) {
    const object = objectCfg();
    const fallbackCfg = object.fallback;
    const bin = Object.fromEntries(Object.keys(deps.BASE_PRICES).map(key => [key, 0]));
    const position = { col, row };
    const furniture = window.ProceduralFurniture;
    const sourceRecipe = furniture?.CATALOG?.[fallbackCfg.sourceCatalogKey];
    const parts = [];

    if (sourceRecipe?.length >= 2 && furniture?.buildPartMesh) {
      sourceRecipe.forEach(part => {
        const stretched = {
          ...part,
          transform: {
            ...part.transform,
            x: (Number(part.transform?.x) || 0) * Number(fallbackCfg.stretchX),
            sx: Math.max(Number(fallbackCfg.minScale), (Number(part.transform?.sx) || Number(fallbackCfg.minScale)) * Number(fallbackCfg.stretchX)),
          },
        };
        const partMesh = furniture.buildPartMesh(stretched, colorValue(fallbackCfg.baseColor));
        partMesh.userData.shippingLocalPosition = partMesh.position.clone();
        parts.push(partMesh);
        deps.scene.add(partMesh);
      });
    } else {
      parts.push(makeFallbackPart(fallbackCfg.body), makeFallbackPart(fallbackCfg.lid), makeFallbackPart(fallbackCfg.lock));
    }

    const mesh = parts[0];
    const lid = parts[1] || null;
    const latch = parts[2] || null;
    const movableParts = [mesh, lid].filter(Boolean);
    if (latch && lid) {
      const latchLocal = latch.userData.shippingLocalPosition;
      const lidLocal = lid.userData.shippingLocalPosition;
      deps.scene.remove(latch);
      lid.add(latch);
      latch.position.set(latchLocal.x - lidLocal.x, latchLocal.y - lidLocal.y, latchLocal.z - lidLocal.z);
    }

    function syncVisualTransform(lidLift = 0) {
      const surfaceType = deps.TileType[object.surfaceTileTypeKey];
      const groundY = deps.tileSurfaceY(surfaceType);
      const center = object.centerOffset;
      const centerX = position.col + Number(center.x);
      const centerZ = position.row + Number(center.z);
      movableParts.forEach((partMesh, index) => {
        const local = partMesh.userData.shippingLocalPosition;
        const lift = index > 0 ? lidLift : 0;
        partMesh.position.set(centerX + local.x, groundY + local.y + lift, centerZ + local.z);
      });
    }

    function occupiedLift() {
      return totalItems() > 0 ? Number(object.lidLiftWhenOccupied) : 0;
    }

    function totalItems() {
      return Object.values(bin).reduce((sum, value) => sum + value, 0);
    }

    function contentsStr() {
      const contents = Object.entries(bin)
        .filter(([, value]) => value > 0)
        .map(([key, value]) => deps.itemIconForKey(key) + '×' + value);
      return contents.length ? contents.join(' ') : interactionCfg().labels.emptyContents;
    }

    function moveTo(nextCol, nextRow) {
      if (Number.isFinite(Number(nextCol))) position.col = Math.round(Number(nextCol));
      if (Number.isFinite(Number(nextRow))) position.row = Math.round(Number(nextRow));
      syncVisualTransform(occupiedLift());
      return { col: position.col, row: position.row };
    }

    syncVisualTransform();
    const fp = footprintSize();
    const actions = actionCfg();
    const interaction = interactionCfg();
    const labels = interaction.labels;
    const messages = interaction.messages;
    const styles = interaction.styles;

    const worldObject = {
      id: object.id,
      type: object.type,
      w: fp.width,
      h: fp.height,
      mesh,
      lid,
      latch,
      contentsStr,
      label: `${object.icon} ${object.label}`,
      get col() { return position.col; },
      set col(value) { moveTo(value, position.row); },
      get row() { return position.row; },
      set row(value) { moveTo(position.col, value); },
      moveTo,
      refreshVisual() { syncVisualTransform(occupiedLift()); },
      getPendingSaleTotal: pendingSaleTotal,
      getMidnightCutoffDay: () => lastObservedDay,
      getButtons() {
        const item = deps.getActiveInventoryItem();
        const btns = [];
        if (item && sellPriceFor(item.key) !== undefined) {
          const count = deps.inventory[item.key] || 0;
          btns.push({
            icon: item.icon,
            label: count > 0 ? interaction.shipVerb + item.icon : labels.emptyFastAction,
            action: actions.deposit,
            style: styles.primary,
            allowed: count > 0,
          });
        }
        const total = totalItems();
        btns.push({
          icon: object.icon,
          label: total > 0 ? labels.openOccupied : labels.openEmpty,
          action: actions.open,
          style: total > 0 ? styles.secondary : styles.primary,
          allowed: true,
        });
        return btns;
      },
      onAction(action) {
        if (action === actions.deposit) {
          const item = deps.getActiveInventoryItem();
          if (!item || sellPriceFor(item.key) === undefined) return { ok: false, message: labels.cannotDeposit };
          const qty = deps.inventory[item.key] || 0;
          if (qty < 1) return { ok: false, message: messages.noItemPrefix + item.label + messages.noItemSuffix };
          deps.inventory[item.key]--;
          deps.clampInventoryStack(item.key);
          bin[item.key] = (bin[item.key] || 0) + 1;
          syncVisualTransform(Number(object.lidLiftWhenOccupied));
          return { ok: true, message: messages.depositedPrefix + item.icon + messages.depositedSuffix };
        }
        if (action === actions.legacyOpen || action === actions.open) {
          if (window.ShippingPanel?.open?.()) return { ok: true, message: contentsStr() };
          deps.openMenu(actions.fallbackMenu);
          return { ok: true, message: contentsStr() };
        }
        return { ok: false, message: labels.unknownAction };
      },
      getContents() { return bin; },
      getTotalItems() { return totalItems(); },
      depositItem(key, qty) {
        if (sellPriceFor(key) === undefined) return 0;
        const moved = Math.max(0, Math.min(qty, deps.inventory[key] || 0));
        if (moved < 1) return 0;
        deps.inventory[key] -= moved;
        bin[key] = (bin[key] || 0) + moved;
        syncVisualTransform(Number(object.lidLiftWhenOccupied));
        return moved;
      },
      withdrawItem(key, qty) {
        if (!deps.hasFarmPermission(inventoryCfg().permissions.withdraw)) return 0;
        // Bound the move by how much room is actually left in the pack stack
        // (not just how much is in the box) — moved is what's both taken out
        // of the box AND added to the pack below. Clamping only the deposit
        // side (inventory[key] to maxStack) after already removing the full
        // qty from bin used to vanish the overflow: it left the box, but the
        // pack stack was already at/near its cap, so it never arrived there.
        const maxStack = Number(inventoryCfg().maxStack);
        const room = Math.max(0, maxStack - (deps.inventory[key] || 0));
        const moved = Math.max(0, Math.min(qty, bin[key] || 0, room));
        if (moved < 1) return 0;
        bin[key] -= moved;
        if ((pendingSaleCounts[key] || 0) > 0) {
          pendingSaleCounts[key] = Math.max(0, pendingSaleCounts[key] - moved);
          if (pendingSaleCounts[key] < 1) delete pendingSaleCounts[key];
        }
        deps.inventory[key] = (deps.inventory[key] || 0) + moved;
        syncVisualTransform(occupiedLift());
        return moved;
      },
      tick() {
        shippingLifecyclePulse();
        syncVisualTransform(occupiedLift());
      },
      reset() {
        Object.keys(bin).forEach(key => { bin[key] = 0; });
        clearPendingSales();
        lastObservedDay = currentCalendarDay();
        syncVisualTransform();
      },
    };

    shippingBoxInstance = worldObject;
    installShippingPlacementGuard();
    ensureShippingFarmBuildingRow();
    return worldObject;
  }

  // Supply Box is an older, separate farm service and intentionally keeps its
  // existing values here; ShippingBoxConfig only owns the new Shipping system.
  function makeSupplyBox(col, row) {
    const mat  = new THREE.MeshLambertMaterial({ color: 0x2060c0 });
    const geo  = new THREE.BoxGeometry(0.7, 0.55, 0.7);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(col + 0.5, deps.tileSurfaceY(deps.TileType.GRASS) + 0.28, row + 0.5);
    deps.scene.add(mesh);

    const lidMat = new THREE.MeshLambertMaterial({ color: 0x4080e0 });
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.72), lidMat);
    lid.position.set(col + 0.5, deps.tileSurfaceY(deps.TileType.GRASS) + 0.56, row + 0.5);
    deps.scene.add(lid);

    const qtys = {};
    deps.SUPPLY_CATALOG.forEach(it => { qtys[it.key] = 0; });
    return {
      id: 'supply_box', type: 'supply_box', col, row, mesh, lid,
      label: '📦 Supply Box',
      getButtons() { return [{ icon: '📦', label: 'Order', action: 'obj_open_shop', style: 'primary', allowed: true }]; },
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

  installFarmPanelShippingIntegration();

  window.FarmCrates = {
    init,
    makeSellCrate,
    makeSupplyBox,
    settlePendingShippingSale,
    getPendingShippingTotal: pendingSaleTotal,
    getShippingConfig: config,
  };
})();