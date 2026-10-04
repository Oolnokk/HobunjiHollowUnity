(() => {
  'use strict';
  const catalog = window.FARM_SPECIALIZATIONS_CONFIG.buildings; // One plan/asset/processor definition per family and tier.
  let deps = null; // Injected farm scene, inventory, calendar, placement and persistence authorities.
  let buildings = []; // Live production entries; serialized alongside the existing farm layout.
  let placement = null; // Farm-map placement or move request owned by this module.
  let timer = null; // One low-frequency queue timer; no additional animation frame loop.
  let loaded = false; // Prevents pre-restore farm saves from erasing an existing world's production buildings.
  let lastError = ''; // Mobile diagnostics expose the latest load/save/asset failure.
  const copy = value => JSON.parse(JSON.stringify(value)); // Snapshots contain data only, never Three.js meshes.
  const now = () => (Number(deps?.calendar.day) || 1) + (Number(deps?.calendar.time01) || 0); // World time, including sleeping/time-passage transitions.
  function init(injectedDeps) {
    deps = injectedDeps;
    for (const definition of Object.values(catalog)) deps.ITEM_DEFS[definition.planItem] = { label: definition.label + ' Plan', icon: '📜', cat: 'building', sellPrice: 0, desc: 'Place from the Farm map. Persistent queue; slower processing with enhanced yield.' };
    deps.ITEM_DEFS.mootBaby = { label: 'Baby Moot', icon: '🐾', cat: 'material', sellPrice: 0, desc: 'A baby Moot. Kept safely as an item until Moot animals are available.' };
    deps.ITEM_DEFS.voorgAssBaby = { label: 'Baby Voorg-ass', icon: '🫏', cat: 'livestock', sellPrice: 0, tags: ['Livestock', 'Baby'], desc: 'A baby Voorg-ass for the farm Nursery.' };
    if (deps.ITEM_DEFS.uumkaoiiEgg) { deps.ITEM_DEFS.uumkaoiiEgg.label = "Fertile Uumkao'ii Egg"; deps.ITEM_DEFS.uumkaoiiEgg.tags = [...new Set([...(deps.ITEM_DEFS.uumkaoiiEgg.tags || []), 'Fertile'])]; }
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 1000);
  }
  function serialize() {
    if (!loaded) return null;
    return buildings.map(entry => ({ id: entry.id, key: entry.key, col: entry.col, row: entry.row,
      queue: copy(entry.queue), ready: copy(entry.ready), nextAt: entry.nextAt, water: entry.water }));
  }
  function clear() {
    for (const entry of buildings) removeVisual(entry);
    buildings = []; placement = null; loaded = false;
  }
  function removeVisual(entry) {
    for (let row = entry.row; row < entry.row + catalog[entry.key].h; row++) for (let col = entry.col; col < entry.col + catalog[entry.key].w; col++) {
      if (deps.worldObjects.get(col + ',' + row) === entry.object) deps.worldObjects.delete(col + ',' + row);
    }
    if (entry.mesh) {
      deps.scene.remove(entry.mesh);
      entry.mesh.traverse(child => { child.userData.glbDisposed = true; child.geometry?.dispose?.(); if (Array.isArray(child.material)) child.material.forEach(material => material.dispose()); else child.material?.dispose?.(); });
      entry.mesh = null;
    }
    entry.visualGeneration = (entry.visualGeneration || 0) + 1;
  }
  function tintData(data) {
    const colors = window.FarmWorldSettings.current(); // Per-world natural finishes, applied before allocating materials.
    const result = copy(data); // Authored source/cache remains immutable.
    result.parts.forEach(part => { if (colors[part.materialRole]) part.color = colors[part.materialRole]; });
    return result;
  }
  function spawn(entry) {
    const definition = catalog[entry.key]; // Supplies footprint and live interaction label.
    const generation = entry.visualGeneration = (entry.visualGeneration || 0) + 1; // Invalidates stale async builds after moving/resetting worlds.
    entry.object = { id: entry.id, type: 'farm_production', col: entry.col, row: entry.row, label: definition.icon + ' ' + definition.label,
      getButtons: () => [{ icon: definition.icon, label: 'Manage ' + definition.label, action: 'obj_farmproduction_' + entry.id, style: 'primary', allowed: deps.hasFarmPermission('storage') }],
      onAction: action => { if (action !== 'obj_farmproduction_' + entry.id) return { ok: false, message: 'Unknown action.' }; open(entry.id); return { ok: true, message: 'Opened building.' }; } };
    for (let row = entry.row; row < entry.row + definition.h; row++) for (let col = entry.col; col < entry.col + definition.w; col++) deps.worldObjects.set(col + ',' + row, entry.object);
    window.AuthoredFurniture.load(entry.key).then(data => {
      if (generation !== entry.visualGeneration || !buildings.includes(entry)) return;
      if (!data) { lastError = 'Missing authored building: ' + entry.key; deps.debugLog(lastError, 'warn'); return; }
      entry.mesh = window.AuthoredFurniture.buildGroup(tintData(data), 0x8b6540);
      entry.mesh.position.set(entry.col + definition.w / 2, deps.surfaceY(entry.col + definition.w / 2, entry.row + definition.h / 2), entry.row + definition.h / 2);
      entry.object.mesh = entry.mesh;
      deps.markOutline?.(entry.mesh);
      // AuthoredFurniture installs the existing rigid-piece animation controllers during buildGroup.
      deps.scene.add(entry.mesh);
    }).catch(error => { lastError = String(error); deps.debugLog(lastError, 'warn'); });
  }
  function load(records = []) {
    clear();
    for (const record of records) {
      if (!catalog[record.key] || !Number.isInteger(record.col) || !Number.isInteger(record.row)) continue;
      const definition = catalog[record.key]; // Reject malformed footprints before touching occupancy.
      if (record.col < 0 || record.row < 0 || record.col + definition.w > deps.COLS || record.row + definition.h > deps.ROWS) continue;
      const entry = { id: String(record.id || 'production_' + record.key + '_' + record.col + '_' + record.row), key: record.key, col: record.col, row: record.row,
        queue: (record.queue || []).filter(batch => Number.isSafeInteger(batch.count) && batch.count > 0 && Array.isArray(batch.outputs)).map(copy),
        ready: (record.ready || []).filter(batch => Number.isSafeInteger(batch.count) && batch.count > 0).map(copy),
        nextAt: Number.isFinite(record.nextAt) ? record.nextAt : null, water: Math.min(definition.waterCapacity, Math.max(0, Number(record.water) || 0)) }; // World-scoped durable queue and tank state.
      buildings.push(entry); spawn(entry);
    }
    loaded = true;
    for (const entry of buildings) for (const result of entry.ready) window.ItemProcessing.ensureProcessedItemDef(result); // Saved finished goods remain registered even when their input queue is empty.
    ensureStarters(); tick();
  }
  function ensureStarters() {
    const { meta, world } = window.FarmWorldSettings.read(); // Pending starter list acts as the once-only grant marker.
    if (!world?.farmStarterBuildings?.length) return;
    const pending = []; // Failed placements remain pending; never silently discard starter buildings.
    for (const key of world.farmStarterBuildings) {
      if (buildings.some(entry => entry.id === 'starter_' + key)) continue;
      const definition = catalog[key]; // Authored starter building chosen at world creation.
      let location = null; // First clear rectangle discovered near the farmhouse.
      for (let row = 7; row < deps.ROWS - definition.h && !location; row++) for (let col = 20; col < deps.COLS - definition.w; col++) {
        if (canPlace(key, col, row)) { location = { col, row }; break; }
      }
      if (!location) { pending.push(key); continue; }
      const entry = { id: 'starter_' + key, key, ...location, queue: [], ready: [], nextAt: null, water: 0 }; // Supplied completed structure, with an empty rainwater tank.
      buildings.push(entry); window.FarmBuildings.clearFootprint(entry.col, entry.row, definition.w, definition.h); spawn(entry);
    }
    if (!deps.saveFarmLayout()) { lastError = 'Starter building save failed.'; return; }
    world.farmStarterBuildings = pending;
    try { localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta)); } catch (error) { lastError = String(error); }
  }
  function canPlace(key, col, row, excludeId) {
    const definition = catalog[key]; // All occupied tiles share the established farm collision/placement authority.
    return !!definition && Number.isInteger(col) && Number.isInteger(row) && window.FarmBuildings.canPlaceAt(col, row, definition.w, definition.h, excludeId);
  }
  function arm(key, id = null) { window.FarmPanel?.cancelBarnPlacement?.(); placement = { key, id }; window.FarmPanel?.render?.(); deps.showToast('Tap the Farm map to ' + (id ? 'move' : 'place') + ' ' + catalog[key].label + '.'); }
  function placeAt(col, row) {
    if (!placement) return null;
    if (!deps.hasFarmPermission('alterFarm')) return { ok: false, message: 'Building permission required.' };
    const { key, id } = placement; // Request captured before clearing successful placement.
    const definition = catalog[key]; // Full multi-tile footprint and inventory plan.
    if (!canPlace(key, col, row, id)) return { ok: false, message: 'Needs clear ground over the entire building footprint.' };
    if (id) {
      const entry = buildings.find(candidate => candidate.id === id); // Moving preserves every queued input/output and tank water.
      if (!entry) return { ok: false, message: 'Building no longer exists.' };
      removeVisual(entry); entry.col = col; entry.row = row; spawn(entry);
    } else {
      if ((deps.inventory[definition.planItem] || 0) < 1) return { ok: false, message: 'Withdraw the plan from storage first.' };
      deps.inventory[definition.planItem]--;
      const entry = { id: 'production_' + Math.random().toString(36).slice(2), key, col, row, queue: [], ready: [], nextAt: null, water: 0 }; // Completed production building purchased via its plan.
      buildings.push(entry); spawn(entry);
    }
    window.FarmBuildings.clearFootprint(col, row, definition.w, definition.h);
    placement = null; deps.saveFarmLayout(); deps.saveMemberWorldData();
    return { ok: true, message: definition.label + ' placed.' };
  }
  function outputsFor(key, itemKey) {
    const definition = catalog[key]; // Rejects processed preservation products to prevent recursive yield amplification.
    const input = deps.ITEM_DEFS[itemKey]; // Live item database includes asynchronously registered fish and cooked foods.
    if (!definition?.method || !input || (definition.inputTag && (!input.tags?.includes(definition.inputTag) || input.tags?.includes('Processed')))) return null;
    return window.ItemProcessing.getProcessingOutputs(definition.method, itemKey);
  }
  function enqueue(id, itemKey, count, source = 'bag') {
    if (!deps.hasFarmPermission('storage')) return { ok: false, message: 'Storage permission required.' };
    const entry = buildings.find(candidate => candidate.id === id); // Current building is resolved again at mutation time.
    if (!entry) return { ok: false, message: 'Building not found.' };
    const outputs = outputsFor(entry.key, itemKey); // Same recipe resolver used by furniture stations and UI eligibility.
    if (!outputs) return { ok: false, message: 'That ingredient cannot be processed here.' };
    const stock = source === 'storage' ? deps.loadStorage() : deps.inventory; // Queue takes custody of raw input before it starts processing.
    if (!Number.isSafeInteger(count) || count < 1 || count > (Number(stock[itemKey]) || 0)) return { ok: false, message: 'Enter a quantity you own.' };
    for (let index = 0; index < count; index++) {
      const stars = source === 'bag' ? deps.consumeInput(itemKey) : 3; // Shared storage currently has no quality buckets; bag inputs retain actual quality.
      if (source === 'storage') stock[itemKey]--;
      const previous = entry.queue[entry.queue.length - 1]; // Coalesces identical quality batches without limiting queue capacity.
      if (previous?.itemKey === itemKey && previous.stars === stars) previous.count++;
      else entry.queue.push({ itemKey, count: 1, stars, outputs: copy(outputs) });
    }
    if (source === 'storage') deps.saveStorage(stock);
    if (entry.nextAt == null) entry.nextAt = now() + catalog[entry.key].daysPerInput;
    deps.saveMemberWorldData(); deps.saveFarmLayout();
    return { ok: true, message: 'Queued ' + count + ' ingredients.' };
  }
  function tick() {
    if (!deps || !buildings.length) return;
    let changed = false; // Writes only when a queued batch actually completes.
    for (const entry of buildings) {
      const definition = catalog[entry.key]; // Tier output multiplier and processing duration.
      while (entry.queue.length && entry.nextAt != null && entry.nextAt <= now()) {
        const batch = entry.queue[0]; // Only the front batch runs; subsequent batches start automatically.
        const completed = Math.min(batch.count, 1 + Math.floor((now() - entry.nextAt) / definition.daysPerInput)); // Aggregates time-passage catch-up without one loop per item.
        for (const output of batch.outputs) {
          window.ItemProcessing.ensureProcessedItemDef(output);
          const previous = entry.ready.find(result => result.key === output.key && result.stars === batch.stars); // Output quality remains tied to its actual input quality.
          if (previous) previous.count += completed * definition.yield;
          else entry.ready.push({ ...copy(output), stars: batch.stars, count: completed * definition.yield });
        }
        batch.count -= completed; entry.nextAt += completed * definition.daysPerInput;
        if (!batch.count) entry.queue.shift();
        if (!entry.queue.length) entry.nextAt = null;
        changed = true;
      }
    }
    if (changed) { deps.saveFarmLayout(); deps.debugLog('Farm production finished queued batches.'); }
  }
  function collect(id) {
    if (!deps.hasFarmPermission('storage')) return { ok: false, message: 'Storage permission required.' };
    tick();
    const entry = buildings.find(candidate => candidate.id === id); // Resolves the live output buffer.
    if (!entry) return { ok: false, message: 'Building not found.' };
    let collected = 0; // No result disappears when the personal stack limit is reached.
    for (const result of entry.ready) {
      const amount = Math.min(result.count, Math.max(0, 99 - (Number(deps.inventory[result.key]) || 0))); // Per-item bag capacity.
      deps.inventory[result.key] = (Number(deps.inventory[result.key]) || 0) + amount;
      window.CookingSystem?.recordItemQuality?.(result.key, result.stars, amount);
      result.count -= amount; collected += amount;
    }
    entry.ready = entry.ready.filter(result => result.count > 0);
    deps.saveMemberWorldData(); deps.saveFarmLayout();
    return { ok: collected > 0, message: collected ? 'Collected ' + collected + ' goods; excess stays here.' : 'Nothing fits in your bag, or no goods are ready.' };
  }
  function open(id) {
    if (!deps.hasFarmPermission('storage')) return;
    tick();
    const entry = buildings.find(candidate => candidate.id === id); // Modal reads actual persisted queue and output buffer.
    if (!entry) return;
    const definition = catalog[entry.key]; // Label/tier and silo capacity for this building.
    document.getElementById('farmProductionModal')?.remove();
    const modal = document.createElement('div'); // Touch-friendly in-file management and diagnostics.
    modal.id = 'farmProductionModal'; modal.style.cssText = 'position:fixed;inset:0;background:#000b;z-index:11000;display:grid;place-items:center;padding:12px';
    const panel = document.createElement('div'); // Scrollable compact panel fits mobile screens.
    panel.style.cssText = 'background:#27231e;color:#eee;padding:18px;border:1px solid #89785d;border-radius:12px;max-height:85vh;overflow:auto;width:min(520px,90vw)';
    const title = document.createElement('h3'); // Authored labels are assigned as text.
    title.textContent = definition.label; panel.append(title);
    const summary = document.createElement('p'); // Clear player-facing status, without implementation details.
    summary.textContent = definition.family === 'waterSilo' ? `Rainwater: ${Math.round(entry.water)} / ${definition.waterCapacity}. ${entry.irrigationWarning || ''} Connect a trench to the building edge; crops beside that network receive water in Deadgrass.`
      : `${definition.yield}× yield · ${definition.daysPerInput} day per ingredient · ${entry.queue.reduce((total, batch) => total + batch.count, 0)} queued · ${entry.ready.reduce((total, batch) => total + batch.count, 0)} goods ready.`;
    panel.append(summary);
    const button = (label, action) => { const element = document.createElement('button'); element.textContent = label; element.className = 'settings-small-btn'; element.onclick = action; panel.append(element); return element; }; // Shared touch action builder.
    if (definition.method) {
      const select = document.createElement('select'); // Lists only legal bag/storage input stacks through the recipe authority.
      select.style.cssText = 'width:100%;margin:8px 0';
      for (const [source, stock] of [['bag', deps.inventory], ['storage', deps.loadStorage()]]) for (const [itemKey, count] of Object.entries(stock)) {
        if (!(count > 0) || !outputsFor(entry.key, itemKey)) continue;
        const option = document.createElement('option'); // Item names cannot inject HTML into the menu.
        option.value = JSON.stringify({ source, itemKey }); option.textContent = `${deps.ITEM_DEFS[itemKey].label} · ${count} · ${source === 'bag' ? 'Bag' : 'Farm storage'}`; select.append(option);
      }
      panel.append(select);
      const quantity = document.createElement('input'); // Explicit batch size; no arbitrary queue capacity.
      quantity.type = 'number'; quantity.min = '1'; quantity.step = '1'; quantity.value = '1'; quantity.style.width = '90px'; panel.append(quantity);
      button('Queue', () => { if (!select.value) return; const choice = JSON.parse(select.value); const result = enqueue(id, choice.itemKey, Number(quantity.value), choice.source); deps.showToast(result.message, result.ok); open(id); });
      button('Queue entire stack', () => { if (!select.value) return; const choice = JSON.parse(select.value); const stock = choice.source === 'bag' ? deps.inventory : deps.loadStorage(); const result = enqueue(id, choice.itemKey, Number(stock[choice.itemKey]), choice.source); deps.showToast(result.message, result.ok); open(id); });
      if (definition.family === 'compostBin') button('Fertilize planted crops', () => { const result = fertilize(); deps.showToast(result.message, result.ok); });
      button('Collect goods', () => { const result = collect(id); deps.showToast(result.message, result.ok); open(id); });
      for (const batch of entry.ready) { const line = document.createElement('div'); line.textContent = `${batch.label} · ${batch.count} · ${batch.stars}★`; panel.append(line); }
    }
    button('Close', () => modal.remove());
    const debug = document.createElement('details'); // Mobile-readable state; contains the most recent feature change.
    const heading = document.createElement('summary'); heading.textContent = 'Production diagnostics'; debug.append(heading);
    const text = document.createElement('pre'); text.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'; text.textContent = JSON.stringify({ mostRecentChange: 'World farm specializations, tiered persistent production queues and natural building colors.', worldTime: now(), building: serialize().find(record => record.id === id), lastError }, null, 2); debug.append(text); panel.append(debug);
    modal.append(panel); document.body.append(modal);
  }
  function connectedCrops(entry, grid) {
    const definition = catalog[entry.key]; // Tank perimeter provides all possible trench inlets.
    const queue = [], seen = new Set(), crops = new Map(); // Flood-fill only the live adjacent trench network; topology is never stale.
    const add = (col, row) => { const key = col + ',' + row; if (!seen.has(key) && grid[row]?.[col]?.type === deps.TileType.TRENCH) { seen.add(key); queue.push({ col, row }); } }; // Traverses cardinal trench connections only.
    for (let col = entry.col; col < entry.col + definition.w; col++) { add(col, entry.row - 1); add(col, entry.row + definition.h); }
    for (let row = entry.row; row < entry.row + definition.h; row++) { add(entry.col - 1, row); add(entry.col + definition.w, row); }
    for (let index = 0; index < queue.length; index++) {
      const point = queue[index]; // Neighboring crop identity and current ideal range come from cropData.
      for (const [col, row] of [[point.col - 1, point.row], [point.col + 1, point.row], [point.col, point.row - 1], [point.col, point.row + 1]]) {
        add(col, row);
        const tile = grid[row]?.[col], data = deps.cropData[tile?.crop]; // Raised/normal crop beds retain their existing ideal water definitions.
        if (data && !tile.cropReady) crops.set(col + ',' + row, { tile, data, col, row });
      }
    }
    return { trenches: queue, crops: [...crops.values()] };
  }
  function irrigate(grid, calendar, rainRate = 0, daily = false) {
    if (!deps || grid !== deps.getGrid()) return; // Never modifies town/wilderness water or another world's grid.
    const season = window.CalendarSystem?.currentSeason?.()?.name || window.CalendarSystem?.seasonForDay?.(calendar.day)?.name; // Uses the existing regional calendar authority.
    let changed = false; // Tank persistence is batched by elapsed world time below.
    for (const entry of buildings) {
      const definition = catalog[entry.key]; // Tank size scales independently of recipe output.
      if (definition.family !== 'waterSilo') continue;
      if (calendar.isRaining && (season === 'Stormtide' || season === 'Longpour')) {
        const collected = daily ? definition.waterCapacity / 12 : Math.max(0, rainRate) * (Number(calendar.rainStrength) || 1) * definition.w * definition.h * 12; // Catchment fills over wet-season rain, including day transitions.
        entry.water = Math.min(definition.waterCapacity, entry.water + collected); changed = true;
      }
      if (season !== 'Deadgrass' || entry.water <= 0) continue;
      const network = connectedCrops(entry, grid); // Only crops adjoining this connected network can request irrigation.
      if (!network.crops.length) continue;
      const min = Math.max(...network.crops.map(crop => crop.data.idealMin)); // Compatible crop bands share one trench water head.
      const max = Math.min(...network.crops.map(crop => crop.data.idealMax)); // Never knowingly floods a lower-water crop to satisfy a higher-water one.
      if (min > max) { entry.irrigationWarning = 'Connected crops have incompatible ideal water ranges; use separate trench networks.'; continue; }
      entry.irrigationWarning = '';
      const target = (min + max) / 2 * deps.MAX_WATER; // Mid-band level prevents cycling at the too-dry threshold.
      if (daily) {
        for (const crop of network.crops) {
          if (crop.tile.water >= target) continue;
          const cost = window.FARM_SPECIALIZATIONS_CONFIG.siloReference.waterUnitsPerCropDay * ((crop.data.idealMin + crop.data.idealMax) / 2 / .35); // Small silo supports the declared low-water 24-crop harvest before external multipliers.
          if (entry.water < cost) break;
          entry.water -= cost; crop.tile.water = target; changed = true; // Analytic network delivery when a full day passes without running its individual simulation ticks.
        }
      } else {
        for (const point of network.trenches) {
          const tile = grid[point.row][point.col]; // Pump supplies trench head; the existing cross-tile flow delivers it to crop beds.
          const elevation = network.crops.some(crop => crop.tile.type === deps.TileType.RAISED) ? 1 : 0; // Raised beds require the existing +1-slab head.
          const desired = Math.min(deps.MAX_WATER * (tile.depth ?? 1), target + Math.min(.3, (max - min) * deps.MAX_WATER / 4) + (tile.depth ?? 1) + elevation); // Trench water depth includes its excavated floor offset.
          const amount = Math.min(entry.water, Math.max(0, desired - (Number(tile.water) || 0))); // Slow metered release instead of dumping the full tank.
          if (amount > 0) { entry.water -= amount; tile.water = (Number(tile.water) || 0) + amount; changed = true; }
        }
      }
    }
    if (changed && (daily || now() - (deps.lastTankSaveAt || 0) >= .05)) { deps.lastTankSaveAt = now(); deps.saveFarmLayout(); } // Checkpoint tank water on world-time cadence; never serialize per frame/tile.
  }
  function fertilize() {
    if (!deps.hasFarmPermission('plant')) return { ok: false, message: 'Planting permission required.' };
    let used = 0; // Compost is consumed once per planted, previously unfertilized crop.
    for (const row of deps.getGrid()) for (const tile of row) {
      if (!tile.crop || tile.cropReady || tile.fertilized || !(deps.inventory.compostFertilizer > 0)) continue;
      deps.inventory.compostFertilizer--; tile.fertilized = true; used++;
    }
    deps.saveMemberWorldData(); deps.saveFarmLayout();
    return { ok: used > 0, message: used ? 'Fertilized ' + used + ' crops for this harvest.' : 'Withdraw compost fertilizer and plant unfertilized crops first.' };
  }
  function renderRows(list) {
    if (!deps || !list) return;
    const button = (row, label, action) => { const element = document.createElement('button'); element.className = 'settings-small-btn'; element.textContent = label; element.onclick = action; row.append(element); }; // Farm menu row actions reuse existing small button styling.
    for (const entry of buildings) {
      const row = document.createElement('div'); row.className = 'farm-row'; row.style.flexWrap = 'wrap'; // Multi-tile production appears beside other farm buildings.
      const name = document.createElement('span'); name.className = 'farm-row-name'; name.textContent = catalog[entry.key].icon + ' ' + catalog[entry.key].label; row.append(name);
      button(row, 'Manage', () => open(entry.id));
      if (deps.hasFarmPermission('alterFarm')) button(row, 'Move', () => arm(entry.key, entry.id));
      list.append(row);
    }
    if (deps.hasFarmPermission('alterFarm')) for (const definition of Object.values(catalog)) {
      if (!(deps.inventory[definition.planItem] > 0)) continue;
      const row = document.createElement('div'); row.className = 'farm-row'; // Plans are placed through the farm map, never furniture placement.
      row.textContent = definition.label + ' Plan · ' + deps.inventory[definition.planItem]; button(row, 'Place', () => arm(definition.key)); list.append(row);
    }
    if (placement) { const row = document.createElement('div'); row.className = 'farm-row'; row.textContent = 'Tap the map to place ' + catalog[placement.key].label; button(row, 'Cancel', () => { placement = null; window.FarmPanel.render(); }); list.append(row); }
  }
  function renderShop(list, shopDeps) {
    for (const definition of Object.values(catalog)) {
      const row = document.createElement('div'); row.className = 'shop-row'; // Every tier remains available independently of starting specialization.
      const label = document.createElement('div'); label.className = 'sh-info'; label.textContent = definition.label + ' Plan · ' + definition.price + 'g'; row.append(label);
      const buy = document.createElement('button'); buy.className = 'shop-buy-btn'; buy.textContent = 'Buy'; // Purchase follows the existing carpenter transaction.
      buy.onclick = () => { if ((shopDeps.inventory.gold || 0) < definition.price || (shopDeps.inventory[definition.planItem] || 0) >= 9) { shopDeps.showToast('Not enough ganang or plan stack is full.', false); return; } shopDeps.inventory.gold -= definition.price; shopDeps.inventory[definition.planItem] = (shopDeps.inventory[definition.planItem] || 0) + 1; shopDeps.saveMemberWorldData(); shopDeps.buildInventoryGrid(); shopDeps.showToast('Bought ' + definition.label + ' Plan.', true); };
      row.append(buy); list.append(row);
    }
  }
  function refreshColors() { for (const entry of buildings) { removeVisual(entry); spawn(entry); } }
  window.FarmProduction = { init, serialize, load, clear, arm, placeAt, enqueue, collect, tick, open, renderRows, renderShop, refreshColors,
    hasPlacement: () => !!placement, cancelPlacement: () => { placement = null; }, outputsFor, canPlace, irrigate, connectedCrops, fertilize, entries: () => buildings, now };
})();
