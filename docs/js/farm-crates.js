(() => {
  'use strict';

  // Shipping Box (deposit sellable items, auto-sells every SELL_INTERVAL_HOURS)
  // and Supply Box (mail-order supplies, arrive next day) — the farm's two
  // fixed service world objects.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function makeSellCrate(col, row) {
    const bin = Object.fromEntries(Object.keys(deps.BASE_PRICES).map(key => [key, 0]));
    let lastSellHour = deps.getHour();
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

    function syncVisualTransform(lidLift = 0) {
      const groundY = deps.tileSurfaceY(deps.TileType.GRASS);
      const centerX = position.col + 1;
      const centerZ = position.row + 0.5;
      parts.forEach((partMesh, index) => {
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
        deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + moved);
        syncVisualTransform(totalItems() > 0 ? 0.06 : 0);
        return moved;
      },
      tick(gameHour) {
        // Sell everything every SELL_INTERVAL_HOURS.
        if (gameHour - lastSellHour >= deps.SELL_INTERVAL_HOURS && totalItems() > 0) {
          let earned = 0;
          const soldParts = [];
          for (const [key, value] of Object.entries(bin)) {
            if (value > 0) {
              earned += value * (deps.BASE_PRICES[key] || 0);
              soldParts.push((deps.itemIconForKey(key) || key) + '×' + value);
              bin[key] = 0;
            }
          }
          deps.inventory.gold += earned;
          lastSellHour = gameHour;
          const line = 'Day ' + deps.calendar.day + ' — ' + soldParts.join(' ') + ' = ' + earned + 'g';
          const deliveryLog = deps.getDeliveryLog();
          deliveryLog.unshift({ type: 'sale', text: line });
          if (deliveryLog.length > 12) deliveryLog.pop();
          deps.showToast('📦 Sold! +' + earned + 'g', true);
          if (deps.getMenuOpen()) deps.buildInventoryGrid();
          if (window.ShippingPanel?.isOpen?.()) deps.buildShippingTransferUI();
          deps.saveMemberWorldData();
        }
        syncVisualTransform(totalItems() > 0 ? 0.06 : 0);
      },
      reset() {
        Object.keys(bin).forEach(key => { bin[key] = 0; });
        lastSellHour = deps.MORNING_HOUR;
        syncVisualTransform();
      },
    };
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
  };
})();
