(() => {
  'use strict';

  // Sell Crate (deposit sellable items, auto-sells every SELL_INTERVAL_HOURS)
  // and Supply Box (mail-order supplies, arrive next day) — the farm's two
  // fixed shipping/ordering world objects.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/creature-death.js and
  // js/farm-buildings.js. deliveryLog/pendingOrders/menuOpen are all
  // reassigned wholesale elsewhere in game.js (daily delivery-log
  // trimming, order-arrival filtering, menu open/close), so they're
  // threaded through as getters rather than captured references.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function makeSellCrate(col, row) {
    const bin = Object.fromEntries(Object.keys(deps.BASE_PRICES).map(key => [key, 0]));
    let lastSellHour = deps.getHour();

    const mat  = new THREE.MeshLambertMaterial({ color: 0xe06820 });
    const geo  = new THREE.BoxGeometry(0.7, 0.55, 0.7);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(col + 0.5, deps.tileSurfaceY(deps.TileType.GRASS) + 0.28, row + 0.5);
    deps.scene.add(mesh);

    // Lid — slightly lighter, floats above when contents > 0
    const lidMat  = new THREE.MeshLambertMaterial({ color: 0xf08830 });
    const lidGeo  = new THREE.BoxGeometry(0.72, 0.08, 0.72);
    const lid     = new THREE.Mesh(lidGeo, lidMat);
    lid.castShadow = true;
    deps.scene.add(lid);

    function totalItems() {
      return Object.values(bin).reduce((s, v) => s + v, 0);
    }
    function contentsStr() {
      const parts = Object.entries(bin)
        .filter(([,v]) => v > 0)
        .map(([k,v]) => (deps.itemIconForKey(k) + '×' + v));
      return parts.length ? parts.join(' ') : 'Empty';
    }

    return {
      id: 'sell_crate', type: 'sell_crate', col, row, mesh, lid, contentsStr,
      label: '🟧 Shipping Box',
      getButtons(reticle) {
        const item = deps.getActiveInventoryItem();
        const btns = [];
        // Deposit button for any sellable item in scroll
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
        // Deposit all
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
          return { ok: true, message: 'Deposited ' + item.icon + ' into sell crate.' };
        }
        if (action === 'obj_show_bin' || action === 'obj_open_shipping') {
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
        return moved;
      },
      withdrawItem(key, qty) {
        // Self-guarded (not just at the transferShippingAmount() UI call site)
        // so any future caller of this object's API can't bypass the farm's
        // storage-withdraw permission.
        if (!deps.hasFarmPermission('storage')) return 0;
        const moved = Math.max(0, Math.min(qty, bin[key] || 0));
        if (moved < 1) return 0;
        bin[key] -= moved;
        deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + moved);
        return moved;
      },
      tick(gameHour) {
        // Sell everything every SELL_INTERVAL_HOURS
        if (gameHour - lastSellHour >= deps.SELL_INTERVAL_HOURS && totalItems() > 0) {
          let earned = 0;
          const parts = [];
          for (const [k, v] of Object.entries(bin)) {
            if (v > 0) {
              earned += v * (deps.BASE_PRICES[k] || 0);
              parts.push((deps.itemIconForKey(k) || k) + '×' + v);
              bin[k] = 0;
            }
          }
          deps.inventory.gold += earned;
          lastSellHour = gameHour;
          const line = 'Day ' + deps.calendar.day + ' — ' + parts.join(' ') + ' = ' + earned + 'g';
          const deliveryLog = deps.getDeliveryLog();
          deliveryLog.unshift({ type: 'sale', text: line });
          if (deliveryLog.length > 12) deliveryLog.pop();
          deps.showToast('🟧 Sold! +' + earned + 'g', true);
          if (deps.getMenuOpen()) { deps.buildInventoryGrid(); deps.buildShippingTransferUI(); }
          deps.saveMemberWorldData();
        }
        // Animate lid
        const h = deps.tileSurfaceY(deps.TileType.GRASS) + 0.56 + (totalItems() > 0 ? 0.06 : 0);
        lid.position.set(col + 0.5, h, row + 0.5);
      },
      reset() {
        Object.keys(bin).forEach(k => { bin[k] = 0; });
        lastSellHour = deps.MORNING_HOUR;
      },
    };
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
