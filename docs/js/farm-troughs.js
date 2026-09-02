(() => {
  'use strict';

  // Barn trough system: barn-interior map synthesis, the live fill-level
  // mesh registry, and the "open trough" bag/slot panel. Split out of
  // game.js (which used to own all three inline) so this feature follows
  // the same self-contained module shape as FarmAnimals/FarmBuildings/
  // FarmPanel — game.js just wires deps and delegates.

  let deps = null;

  function init(injectedDeps) { deps = injectedDeps; }

  function troughSlotCount(trough) {
    return Array.isArray(trough?.slots) ? trough.slots.filter(Boolean).length : 0;
  }

  // Barn interiors: 2 interior cells per exterior tile (matching the
  // player's own house ratio — see house-pieces-core.js's
  // computeInteriorLayout). One Feed Grinder goes in the back-right corner
  // (against the top wall, one cell shy of the right wall so it doesn't
  // touch it — see feedGrinder.json's own baked orientation for why it's
  // *placed* rather than rotated to face that way), and one trough per barn
  // tier slot lines the west wall, spilling onto the east wall (below the
  // grinder) if a tier has more slots than the west wall has rows for.
  function synthesizeBarnInteriorMapData(mapId) {
    const barnId = mapId.slice('map_i_barn_'.length);
    const farmBuildings = deps.getFarmBuildings();
    const barn = farmBuildings.find(b => b.id === barnId && b.kind === 'barn');
    if (!barn) return null;
    const BARN_TIERS = deps.getBarnTiers();
    const cols = Math.max(4, barn.w * 2), rows = Math.max(4, barn.h * 2);
    const floor = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) floor.push([c, r]);
    const doorCenter = Math.floor(cols / 2);
    const doorCols = [doorCenter - 1, doorCenter, doorCenter + 1].filter(c => c > 0 && c < cols - 1);
    const exits = [{ id: 'exit_barn_front', label: 'Barn Door', tiles: doorCols.map(c => [c, rows - 1]), targetMap: '', spawnCol: 0, spawnRow: 0 }];
    const furniture = [{ id: 'f_barn_grinder', itemKey: 'feedGrinderFurniture', col: cols - 2, row: 0, rotY: 0, barnId, postX: 0, postY: 0, postZ: 0, postSX: 1, postSY: 1, postSZ: 1 }];
    const slots = BARN_TIERS[barn.tier]?.slots || 0;
    const troughPositions = [];
    for (let r = 1; r <= rows - 2 && troughPositions.length < slots; r++) troughPositions.push({ col: 1, row: r });
    for (let r = 1; r <= rows - 2 && troughPositions.length < slots; r++) troughPositions.push({ col: cols - 2, row: r });
    troughPositions.forEach((pos, i) => {
      // Rotated 90° from the trough's authored orientation (trough.json's
      // basin runs long along local X) so it sits flush along the wall it's
      // placed against instead of sticking out into the room.
      furniture.push({ id: 'f_barn_trough_' + i, itemKey: 'troughFurniture', col: pos.col, row: pos.row, rotY: 90, barnId, troughIndex: i, postX: 0, postY: 0, postZ: 0, postSX: 1, postSY: 1, postSZ: 1 });
    });
    return { schema: 'hobunji_building_interior.v1', id: mapId, name: (BARN_TIERS[barn.tier]?.label || 'Barn') + ' Interior', cols, rows, exits, colliders: [], vendorZones: [], floor, furniture, npcStations: [] };
  }

  // "barnId,troughIndex" -> { group, authoredData } for every trough mesh
  // currently built into a loaded barn interior scene — lets
  // depositFeedToTrough/withdrawFeedFromTrough/tickHearts (farm-animals.js,
  // via deps.refreshTroughVisual) update a trough's fill-level liquid
  // surface live, without needing to rebuild (or even be standing in) that
  // barn's interior.
  const _meshRegistry = new Map();

  // Recomputes and applies a trough's "Fodder Fill Level" liquidSurface
  // part (see trough.json) from its live contents — level = filled slots /
  // TROUGH_CAPACITY, colored green (plant-only), pink (meat-only), or brown
  // (mixed/empty). Reuses AuthoredFurniture's existing process-timeline
  // liquid machinery (see squeezer.json's Collected Substance part) with a
  // one-shot, entirely in-memory "timeline" — there's no real processing
  // job here, just a fill-level readout.
  function _applyTroughLiquidVisual(group, authoredData, trough) {
    if (!group || !authoredData || !trough) return;
    const total = troughSlotCount(trough);
    const level = Math.max(0, Math.min(1, total / window.FarmAnimals.TROUGH_CAPACITY));
    const hasPlant = trough.slots?.includes('plantFodder');
    const hasMeat = trough.slots?.includes('meatFodder');
    const color = hasPlant && hasMeat ? '#8a6a3a' // mixed -> brown
      : hasMeat ? '#e685b5' // meat-only -> pink
      : hasPlant ? '#6fae52' // plant-only -> green
      : '#8a6a3a'; // empty (invisible at level 0, color is moot)
    const virtualTimeline = {
      substanceColor: color,
      liquidTracks: [{ partId: 'part_trough_fill', useSubstanceColor: true, colorFromSubstance: true, keyframes: [{ time: 0, value: { level } }] }],
    };
    window.AuthoredFurniture.applyProcessTimeline(group, authoredData, virtualTimeline, 0);
  }

  // Called once, when a trough's furniture mesh is first built into a
  // loaded barn interior scene.
  function registerMesh(barnId, troughIndex, group, authoredData) {
    _meshRegistry.set(barnId + ',' + troughIndex, { group, authoredData });
    const farmBuildings = deps.getFarmBuildings();
    const barn = farmBuildings.find(b => b.id === barnId && b.kind === 'barn');
    const trough = barn && window.FarmAnimals.ensureBarnTroughs(barn)[troughIndex];
    if (trough) _applyTroughLiquidVisual(group, authoredData, trough);
  }

  // Safe to call from anywhere (farm-animals.js's deposit/withdraw/
  // tickHearts) even if nobody's ever entered that barn — it's just a
  // no-op then.
  function refreshVisual(barnId, troughIndex) {
    const entry = _meshRegistry.get(barnId + ',' + troughIndex);
    if (!entry) return;
    const farmBuildings = deps.getFarmBuildings();
    const barn = farmBuildings.find(b => b.id === barnId && b.kind === 'barn');
    const trough = barn && window.FarmAnimals.ensureBarnTroughs(barn)[troughIndex];
    if (!trough) return;
    _applyTroughLiquidVisual(entry.group, entry.authoredData, trough);
  }

  // ── Trough panel — "akin to farm storage" (see renderFarmStoragePane in
  // farm-panel.js), but a trough's 7 slots never stack: each slot holds
  // exactly one Plant/Meat Fodder unit, so it's built as its own small
  // overlay instead of reusing the Farm tab's single shared-pool count-map
  // UI. Built once, lazily, and reused/repositioned rather than a whole
  // top-level menu tab, since any of many troughs across many barns can
  // open it.
  let _panelEl = null, _panelCtx = null;

  function open(barnId, troughIndex) {
    _panelCtx = { barnId, troughIndex };
    if (!_panelEl) {
      _panelEl = document.createElement('div');
      _panelEl.id = 'troughPanelOverlay';
      _panelEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center;';
      _panelEl.innerHTML = `<div id="troughPanelBox" style="background:#1c1a16;border:1px solid var(--border,#444);border-radius:10px;padding:16px;max-width:440px;width:92%;max-height:80vh;overflow:auto;color:#eee;font-size:13px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong id="troughPanelTitle">Trough</strong>
          <button id="troughPanelClose" class="settings-small-btn">Close</button>
        </div>
        <div id="troughPanelStatus" class="farm-note" style="margin-bottom:10px;"></div>
        <div style="display:flex;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;color:var(--muted,#999);margin-bottom:4px;">Your Bag</div>
            <div id="troughPanelBagList" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;color:var(--muted,#999);margin-bottom:4px;">Trough Slots</div>
            <div id="troughPanelSlotList" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>
        </div>
      </div>`;
      document.body.appendChild(_panelEl);
      _panelEl.addEventListener('click', (e) => { if (e.target === _panelEl) close(); });
      _panelEl.querySelector('#troughPanelClose').addEventListener('click', close);
    }
    _panelEl.style.display = 'flex';
    render();
  }

  function close() {
    if (_panelEl) _panelEl.style.display = 'none';
    _panelCtx = null;
  }

  function render() {
    if (!_panelCtx || !_panelEl || _panelEl.style.display === 'none') return;
    const { barnId, troughIndex } = _panelCtx;
    const farmBuildings = deps.getFarmBuildings();
    const barn = farmBuildings.find(b => b.id === barnId && b.kind === 'barn');
    const trough = barn && window.FarmAnimals.ensureBarnTroughs(barn)[troughIndex];
    if (!barn || !trough) { close(); return; }
    const list = deps.loadWorldLivestock();
    const assigned = list.find(l => l.barnId === barnId && l.troughIndex === troughIndex);
    const cap = window.FarmAnimals.TROUGH_CAPACITY;
    document.getElementById('troughPanelTitle').textContent = `🪣 Trough${assigned ? ' — ' + assigned.name : ' (Unassigned)'}`;
    document.getElementById('troughPanelStatus').textContent = `${troughSlotCount(trough)}/${cap} slots full${assigned ? ` — ${assigned.name} eats ${window.FarmAnimals.feedKeysForDiet(window.FarmAnimals.dietFor(assigned.kind)).map(k => deps.ITEM_DEFS[k]?.label || k).join(' or ')}` : ''}`;

    const bagList = document.getElementById('troughPanelBagList');
    bagList.innerHTML = '';
    ['plantFodder', 'meatFodder'].forEach(key => {
      const n = deps.inventory[key] || 0;
      if (n <= 0) return;
      const def = deps.ITEM_DEFS[key];
      const row = document.createElement('div');
      row.className = 'farm-storage-row';
      row.innerHTML = `<span class="farm-row-icon">${def.icon}</span><span class="farm-row-value">${deps.esc(def.label)} ×${n}</span><button class="settings-small-btn">Store</button>`;
      row.querySelector('button').addEventListener('click', () => {
        const res = window.FarmAnimals.depositFeedToTrough(barnId, troughIndex, key, 1);
        deps.showToast(res.message, res.ok !== false);
        if (res.ok) { render(); deps.buildInventoryGrid(); deps.refreshActionBar(); deps.saveMemberWorldData(); }
      });
      bagList.appendChild(row);
    });
    if (!bagList.children.length) bagList.innerHTML = '<div class="farm-note">No fodder in your bag.</div>';

    const slotList = document.getElementById('troughPanelSlotList');
    slotList.innerHTML = '';
    trough.slots.forEach((itemKey, i) => {
      const row = document.createElement('div');
      row.className = 'farm-storage-row';
      if (itemKey) {
        const def = deps.ITEM_DEFS[itemKey];
        row.innerHTML = `<span class="farm-row-icon">${def.icon}</span><span class="farm-row-value">${deps.esc(def.label)}</span><button class="settings-small-btn">Take</button>`;
        row.querySelector('button').addEventListener('click', () => {
          const res = window.FarmAnimals.withdrawFeedFromTrough(barnId, troughIndex, i);
          deps.showToast(res.message, res.ok !== false);
          if (res.ok) { render(); deps.buildInventoryGrid(); deps.refreshActionBar(); deps.saveMemberWorldData(); }
        });
      } else {
        row.innerHTML = `<span class="farm-row-icon">·</span><span class="farm-row-value" style="color:var(--muted,#999)">Empty slot</span>`;
      }
      slotList.appendChild(row);
    });
  }

  window.FarmTroughs = { init, synthesizeBarnInteriorMapData, registerMesh, refreshVisual, troughSlotCount, open, close };
})();

(() => {
  'use strict';

  // Livestock Nursery integration lives beside the dynamic barn-interior
  // synthesizer so it can hook FarmAnimals/FarmBuildings synchronously before
  // game.js injects their private world/save dependencies. This deliberately
  // reuses the existing livestock records, factories, barn movement, and save
  // pipeline rather than creating a parallel animal database.
  const NURSERY_ID = 'farm_nursery'; // Stable building id used by save migration, UI, and the generated interior map.
  const NURSERY_VISIBLE_LIMIT = 12; // Caps visual-only baby sprites inside the nursery; storage itself has no cap.
  const BABY_SCALE = 0.25; // Multiplies the same species + size-class scale used by adult livestock.
  const OUTDOOR_SENTINEL_BARN = '__livestock_outdoors__'; // Temporary truthy housing id used only while existing nightly/resource ticks run.
  const BABY_ICONS = { uumkaoii: '🐛', 'gar-wolf': '🐺', 'dabinggi-hound': '🐕', grehlr: '🦨', drenkirra: '🦎' }; // Compact Nursery-list icons.

  let animalDeps = null; // Captured FarmAnimals dependencies; used for authoritative livestock/save/entity access.
  let buildingDeps = null; // Captured FarmBuildings dependencies; used to seed/protect/move the free Nursery.
  let troughDeps = null; // Captured FarmTroughs dependencies; used to synthesize the Nursery interior.
  let originalAssignToBarn = null; // Original housing transition reused by Grow Up after life-stage validation.
  let selectedBabyId = null; // Nursery-list selection whose actions render below the compact stack.
  let panelHookInstalled = false; // Prevents wrapping FarmPanel.render more than once.
  let uiObserver = null; // Watches FarmPanel's internal partial rerenders so Nursery decoration is restored automatically.
  let uiDecorating = false; // Prevents MutationObserver feedback while Nursery DOM is being rebuilt.
  let swarmInside = false; // Tracks nursery entry/exit so each re-entry rerolls the visible sample.
  let swarmBuilding = false; // Prevents duplicate async sprite-composition passes.
  let swarmBuildToken = 0; // Invalidates async sprite work when the player leaves before it completes.
  let swarmAgents = []; // Visual-only baby meshes currently following the player inside the Nursery.

  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function isNurseryBuilding(entry) {
    return !!entry && (entry.nursery === true || entry.id === NURSERY_ID);
  }

  function livestockList() {
    return animalDeps?.loadWorldLivestock?.() || [];
  }

  function isBaby(entry) {
    if (!entry) return false;
    if (entry.lifeStage === 'baby') return true;
    if (entry.lifeStage === 'adult') return false;
    // Existing explicit `barnId:null` records are exactly the retired
    // "stasis" population, so they migrate into the Nursery. Pre-barn legacy
    // records omitted barnId entirely and were genuinely free-roaming adults.
    return hasOwn(entry, 'barnId') && entry.barnId == null;
  }

  function saveLivestock(list = livestockList()) {
    animalDeps?.saveWorldLivestock?.(list);
  }

  function normalizeLifeStages() {
    if (!animalDeps) return false;
    const list = livestockList();
    let changed = false;
    for (const entry of list) {
      if (entry.lifeStage !== 'baby' && entry.lifeStage !== 'adult') {
        entry.lifeStage = isBaby(entry) ? 'baby' : 'adult';
        changed = true;
      }
      if (entry.lifeStage === 'baby') {
        if (entry.barnId != null) { entry.barnId = null; changed = true; }
        if (entry.troughIndex != null) { entry.troughIndex = null; changed = true; }
        if (entry.assignedVatId != null) { entry.assignedVatId = null; changed = true; }
      }
    }
    if (changed) {
      saveLivestock(list);
      debugLog(`Migrated livestock life stages: ${list.filter(isBaby).length} baby, ${list.filter(entry => !isBaby(entry)).length} adult.`);
    }
    return changed;
  }

  function regularBuiltBarns() {
    if (!buildingDeps) return [];
    return buildingDeps.getFarmBuildings().filter(entry => entry.kind === 'barn' && !isNurseryBuilding(entry) && entry.stage === 'built');
  }

  function adultCapacity() {
    const tiers = buildingDeps?.getBarnTiers?.() || {};
    return regularBuiltBarns().reduce((sum, barn) => sum + Math.max(0, Number(tiers[barn.tier]?.slots) || 0), 0);
  }

  function adultCount() {
    normalizeLifeStages();
    return livestockList().filter(entry => !isBaby(entry)).length;
  }

  function firstOpenBarn() {
    const list = livestockList();
    const tiers = buildingDeps?.getBarnTiers?.() || {};
    return regularBuiltBarns().find(barn => {
      const occupied = list.filter(entry => !isBaby(entry) && entry.barnId === barn.id).length;
      return occupied < (Number(tiers[barn.tier]?.slots) || 0);
    }) || null;
  }

  function findAnyOpenFarmTile(preferredBuilding = null) {
    if (!animalDeps || !buildingDeps) return null;
    if (preferredBuilding) {
      const near = window.FarmBuildings?.findOpenTileNear?.(preferredBuilding);
      if (near) return near;
    }
    const cols = Number(buildingDeps.COLS) || 0;
    const rows = Number(buildingDeps.ROWS) || 0;
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        if (window.FarmAnimals?.canSpawnAt?.(col, row)) return { col, row };
      }
    }
    return null;
  }

  function placeLiveAnimalOutside(animal, preferredBuilding) {
    if (!animal || !animalDeps) return false;
    const spot = findAnyOpenFarmTile(preferredBuilding);
    if (!spot) return false;
    if (Number.isFinite(animal.col) && Number.isFinite(animal.row)) {
      const oldKey = `${animal.col},${animal.row}`;
      if (animalDeps.worldObjects?.get?.(oldKey) === animal) animalDeps.worldObjects.delete(oldKey);
    }
    animal.col = spot.col; animal.row = spot.row;
    animal.targetCol = spot.col; animal.targetRow = spot.row;
    animal.homeCol = spot.col; animal.homeRow = spot.row;
    animal.wx = spot.col + 0.5; animal.wz = spot.row + 0.5;
    animal._barnHome = false;
    if (animal.avatarRef?.group) {
      animal.avatarRef.group.visible = true;
      animal.avatarRef.group.position.x = animal.wx;
      animal.avatarRef.group.position.z = animal.wz;
    }
    animalDeps.worldObjects?.set?.(`${spot.col},${spot.row}`, animal);
    return true;
  }

  function patchNurseryWorldObject(entry) {
    const obj = entry?._worldObj;
    if (!obj || obj.__livestockNurseryPatched) return;
    obj.__livestockNurseryPatched = true;
    obj.kind = 'nursery';
    Object.defineProperty(obj, 'label', { configurable: true, get: () => '🍼 Nursery' });
    obj.getButtons = () => [
      { icon: '🚪', label: 'Enter Nursery', action: `obj_nursery_enter_${entry.id}`, style: 'primary', allowed: true },
      { icon: '🐣', label: `Manage Babies (${livestockList().filter(isBaby).length})`, action: `obj_nursery_manage_${entry.id}`, style: 'secondary', allowed: buildingDeps?.hasFarmPermission?.('livestock') !== false },
    ];
    obj.onAction = action => {
      if (action === `obj_nursery_enter_${entry.id}`) {
        buildingDeps?.enterBuilding?.(`map_i_barn_${entry.id}`);
        return { ok: true, message: 'Entered the Nursery.' };
      }
      if (action === `obj_nursery_manage_${entry.id}`) {
        if (buildingDeps?.hasFarmPermission?.('livestock') === false) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
        buildingDeps?.setFarmLivestockFocusBarnId?.(null);
        buildingDeps?.openMenu?.('farm');
        return { ok: true, message: 'Opened the Nursery list in the Farm tab.' };
      }
      return { ok: false, message: 'Unknown Nursery action.' };
    };
  }

  function nurseryBuilding() {
    return buildingDeps?.getFarmBuildings?.().find(isNurseryBuilding) || null;
  }

  function nurseryPlacement() {
    if (!buildingDeps) return null;
    const w = 4, h = 3; // Matches the existing smallest barn piece reused by the free Nursery.
    const cols = Number(buildingDeps.COLS) || 0;
    const rows = Number(buildingDeps.ROWS) || 0;
    const preferredCol = Math.max(1, Math.floor(cols * 0.12));
    const preferredRow = Math.max(1, Math.floor(rows * 0.12));
    const candidates = [];
    for (let row = 1; row <= rows - h - 1; row++) {
      for (let col = 1; col <= cols - w - 1; col++) candidates.push({ col, row, score: Math.abs(col - preferredCol) + Math.abs(row - preferredRow) });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.find(pos => window.FarmBuildings?.canPlaceAt?.(pos.col, pos.row, w, h)) || null;
  }

  function ensureNurseryBuilding() {
    if (!buildingDeps || !window.FarmBuildings) return null;
    const existing = nurseryBuilding();
    if (existing) { patchNurseryWorldObject(existing); return existing; }
    const pos = nurseryPlacement();
    if (!pos) {
      debugLog('Could not seed the free Nursery: no clear 4x3 farm footprint was available.', 'warn');
      return null;
    }
    const entry = {
      id: NURSERY_ID, kind: 'barn', nursery: true, protected: true, tier: 'small',
      col: pos.col, row: pos.row, w: 4, h: 3, stage: 'built',
    };
    buildingDeps.getFarmBuildings().push(entry);
    window.FarmBuildings.spawnEntry(entry);
    window.FarmBuildings.clearFootprint?.(entry.col, entry.row, entry.w, entry.h);
    buildingDeps.saveFarmLayout?.();
    buildingDeps.saveMemberWorldData?.();
    debugLog(`Seeded free Nursery at (${entry.col}, ${entry.row}).`);
    return entry;
  }

  function sanitizeBreedingPairs() {
    if (!animalDeps?._loadWorldBreedingPairs || !animalDeps?._saveWorldBreedingPairs) return;
    const babyIds = new Set(livestockList().filter(isBaby).map(entry => entry.id));
    const pairs = animalDeps._loadWorldBreedingPairs();
    const filtered = pairs.filter(pair => ![pair.parentA, pair.parentB].some(ref => ref?.source === 'world' && babyIds.has(ref.id)));
    if (filtered.length !== pairs.length) {
      animalDeps._saveWorldBreedingPairs(filtered);
      debugLog(`Removed ${pairs.length - filtered.length} breeding pair(s) that referenced Nursery babies.`);
    }
  }

  function growBaby(livestockId) {
    normalizeLifeStages();
    if (animalDeps?.hasFarmPermission?.('livestock') === false) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    const list = livestockList();
    const entry = list.find(item => item.id === livestockId);
    if (!entry || !isBaby(entry)) return { ok: false, message: 'That animal is no longer a baby in the Nursery.' };
    const capacity = adultCapacity();
    const adults = list.filter(item => !isBaby(item)).length;
    if (adults >= capacity) return { ok: false, message: `No adult barn space is available (${adults}/${capacity}). Build or upgrade a barn first.` };
    const barn = firstOpenBarn();
    if (!barn) return { ok: false, message: 'No built barn has an open stall right now.' };

    entry.lifeStage = 'adult';
    entry.barnId = null;
    entry.troughIndex = null;
    saveLivestock(list);
    const result = window.FarmAnimals.assignToBarn(entry.id, barn.id);
    if (!result?.ok) {
      entry.lifeStage = 'baby';
      entry.barnId = null;
      entry.troughIndex = null;
      saveLivestock(list);
      return result || { ok: false, message: 'Could not grow that baby up.' };
    }
    const barnLabel = buildingDeps?.getBarnTiers?.()[barn.tier]?.label || 'barn';
    return { ok: true, message: `${entry.name || 'The baby'} grew up and moved into the ${barnLabel}.`, entry };
  }

  function withOutdoorAdultsActive(original, thisArg, args) {
    normalizeLifeStages();
    const list = livestockList();
    const backups = [];
    for (const entry of list) {
      if (isBaby(entry) || entry.barnId) continue;
      backups.push({ entry, hadBarnId: hasOwn(entry, 'barnId'), barnId: entry.barnId });
      entry.barnId = OUTDOOR_SENTINEL_BARN;
    }
    const originalSave = animalDeps.saveWorldLivestock;
    if (typeof originalSave === 'function') animalDeps.saveWorldLivestock = () => {}; // Prevents the temporary sentinel from ever reaching disk.
    try {
      return original.apply(thisArg, args);
    } finally {
      if (typeof originalSave === 'function') animalDeps.saveWorldLivestock = originalSave;
      for (const backup of backups) {
        if (backup.hadBarnId) backup.entry.barnId = backup.barnId;
        else delete backup.entry.barnId;
      }
      originalSave?.(list);
    }
  }

  function rewriteStasisMessage(message) {
    return String(message || '')
      .replace(/waiting in stasis until you assign it to a barn/gi, 'waiting in the Nursery until you grow it up')
      .replace(/back in stasis/gi, 'now roaming outside without a barn')
      .replace(/stasis/gi, 'the Nursery');
  }

  function installAnimalHooks() {
    const api = window.FarmAnimals;
    if (!api || api.__livestockNurseryHooksInstalled || !animalDeps) return;
    api.__livestockNurseryHooksInstalled = true;
    originalAssignToBarn = api.assignToBarn.bind(api);

    const originalAddFromItem = api.addFromItem.bind(api);
    api.addFromItem = function nurseryAddFromItem(itemKey) {
      const before = new Set(livestockList().map(entry => entry.id));
      const result = originalAddFromItem(itemKey);
      if (!result?.ok) return result;
      const list = livestockList();
      const entry = result.entry || list.find(item => !before.has(item.id));
      if (entry) {
        entry.lifeStage = 'baby';
        entry.barnId = null;
        entry.troughIndex = null;
        entry.assignedVatId = null;
        saveLivestock(list);
        result.entry = entry;
        result.message = `${entry.name || 'Baby animal'} moved into the Nursery. It will stay a baby until you choose Grow Up.`;
      } else result.message = rewriteStasisMessage(result.message);
      return result;
    };

    api.assignToBarn = function nurseryAssignToBarn(livestockId, barnId) {
      normalizeLifeStages();
      const entry = livestockList().find(item => item.id === livestockId);
      if (entry && isBaby(entry)) return { ok: false, message: 'Babies cannot leave the Nursery as livestock until you choose Grow Up.' };
      const target = buildingDeps?.getFarmBuildings?.().find(building => building.id === barnId);
      if (isNurseryBuilding(target)) return { ok: false, message: 'The Nursery only stores babies; adults cannot be put back into it.' };
      return originalAssignToBarn(livestockId, barnId);
    };

    api.unassignFromBarn = function nurseryUnassignFromBarn(livestockId) {
      normalizeLifeStages();
      if (animalDeps.hasFarmPermission?.('livestock') === false) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
      const list = livestockList();
      const entry = list.find(item => item.id === livestockId);
      if (!entry) return { ok: false, message: 'Animal not found.' };
      if (isBaby(entry)) return { ok: false, message: 'Babies are already kept in the Nursery.' };
      if (!entry.barnId) return { ok: true, message: `${entry.name || 'Animal'} is already roaming outside without a barn.` };
      const oldBarn = buildingDeps?.getFarmBuildings?.().find(building => building.id === entry.barnId) || null;
      const vatId = entry.assignedVatId;
      if (vatId) api.clearVatWorkerPose?.(vatId);
      entry.lifeStage = 'adult';
      entry.barnId = null;
      entry.troughIndex = null;
      entry.assignedVatId = null;
      const animal = [...(animalDeps.animalObjects || [])].find(candidate => candidate.livestockId === entry.id);
      if (animal) {
        if (animal._barnHome || animal.avatarRef?.group?.visible === false) placeLiveAnimalOutside(animal, oldBarn);
        entry.col = animal.col;
        entry.row = animal.row;
      }
      saveLivestock(list);
      return { ok: true, message: `${entry.name || 'Animal'} is now roaming outside. It will lose happiness each night until it has a barn.` };
    };

    const originalRespawn = api.respawnWorldLivestock.bind(api);
    api.respawnWorldLivestock = function nurseryRespawnWorldLivestock(...args) {
      ensureNurseryBuilding();
      normalizeLifeStages();
      const list = livestockList();
      const nursery = nurseryBuilding();
      const temporarilyLegacy = [];
      for (const entry of list) {
        if (isBaby(entry) || entry.barnId || !hasOwn(entry, 'barnId')) continue;
        if (!Number.isFinite(entry.col) || !Number.isFinite(entry.row) || !api.canSpawnAt(entry.col, entry.row)) {
          const spot = findAnyOpenFarmTile(nursery);
          if (spot) { entry.col = spot.col; entry.row = spot.row; }
        }
        temporarilyLegacy.push(entry);
        delete entry.barnId; // Reuses the original legacy-roaming factory path without changing persistent life stage.
      }
      try {
        return originalRespawn(...args);
      } finally {
        for (const entry of temporarilyLegacy) entry.barnId = null;
        saveLivestock(list);
      }
    };

    const originalTickHearts = api.tickHearts.bind(api);
    api.tickHearts = function nurseryTickHearts(...args) {
      return withOutdoorAdultsActive(originalTickHearts, api, args);
    };

    const originalTickResources = api.tickResources.bind(api);
    api.tickResources = function nurseryTickResources(...args) {
      return withOutdoorAdultsActive(originalTickResources, api, args);
    };

    const originalTickBreedingProgress = api.tickBreedingProgress.bind(api);
    api.tickBreedingProgress = function nurseryTickBreedingProgress(...args) {
      normalizeLifeStages();
      sanitizeBreedingPairs();
      const originalToast = animalDeps.showToast;
      if (typeof originalToast === 'function') animalDeps.showToast = (message, ok) => originalToast(rewriteStasisMessage(message), ok);
      try {
        return originalTickBreedingProgress(...args);
      } finally {
        if (typeof originalToast === 'function') animalDeps.showToast = originalToast;
        normalizeLifeStages(); // Any newborn explicit barnId:null record becomes a Nursery baby immediately.
      }
    };

    const originalResolveBreedingParent = api.resolveBreedingParent.bind(api);
    api.resolveBreedingParent = function nurseryResolveBreedingParent(ref, worldLivestock, stableCache) {
      const result = originalResolveBreedingParent(ref, worldLivestock, stableCache);
      return ref?.source === 'world' && isBaby(result) ? null : result;
    };

    const originalUpdateAnimalMeshes = api.updateAnimalMeshes.bind(api);
    api.updateAnimalMeshes = function nurseryUpdateAnimalMeshes(dt) {
      const result = originalUpdateAnimalMeshes(dt);
      updateNurserySwarm(Number(dt) || 0);
      return result;
    };

    api.isNurseryBaby = isBaby;
    api.growNurseryBaby = growBaby;
    api.getAdultLivestockCapacity = adultCapacity;
    api.getAdultLivestockCount = adultCount;
    debugLog('Livestock Nursery hooks installed.');
  }

  function installBuildingHooks() {
    const api = window.FarmBuildings;
    if (!api || api.__livestockNurseryHooksInstalled || !buildingDeps) return;
    api.__livestockNurseryHooksInstalled = true;

    const originalSpawnEntry = api.spawnEntry.bind(api);
    api.spawnEntry = function nurserySpawnEntry(entry) {
      const result = originalSpawnEntry(entry);
      if (isNurseryBuilding(entry)) patchNurseryWorldObject(entry);
      return result;
    };

    const originalDemolish = api.demolish.bind(api);
    api.demolish = function nurseryProtectedDemolish(id) {
      const entry = buildingDeps.getFarmBuildings().find(building => building.id === id);
      if (isNurseryBuilding(entry)) return { ok: false, message: 'The Nursery comes with the farm and cannot be demolished. You can move it instead.' };
      if (entry?.kind === 'barn') {
        const occupants = livestockList().filter(animal => !isBaby(animal) && animal.barnId === id).map(animal => animal.id);
        for (const livestockId of occupants) window.FarmAnimals?.unassignFromBarn?.(livestockId);
      }
      const result = originalDemolish(id);
      if (result?.ok) result.message = 'Barn demolished. Any adults that lived there are now roaming outside and will lose happiness nightly.';
      return result;
    };

    api.ensureNursery = ensureNurseryBuilding;
    debugLog('Farm building Nursery protection hooks installed.');
  }

  function synthesizeNurseryInterior(mapId) {
    if (!troughDeps || !mapId.startsWith('map_i_barn_')) return null;
    const barnId = mapId.slice('map_i_barn_'.length);
    const nursery = buildingDeps?.getFarmBuildings?.().find(building => building.id === barnId && isNurseryBuilding(building));
    if (!nursery) return null;
    const cols = Math.max(6, (Number(nursery.w) || 4) * 2);
    const rows = Math.max(5, (Number(nursery.h) || 3) * 2);
    const floor = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) floor.push([col, row]);
    const center = Math.floor(cols / 2);
    const doorCols = [center - 1, center, center + 1].filter(col => col > 0 && col < cols - 1);
    return {
      schema: 'hobunji_building_interior.v1', id: mapId, name: 'Nursery Interior', cols, rows,
      exits: [{ id: 'exit_nursery_front', label: 'Nursery Door', tiles: doorCols.map(col => [col, rows - 1]), targetMap: '', spawnCol: 0, spawnRow: 0 }],
      colliders: [], vendorZones: [], floor, furniture: [], npcStations: [], nursery: true,
    };
  }

  function installTroughHooks() {
    const api = window.FarmTroughs;
    if (!api || api.__livestockNurseryHooksInstalled) return;
    api.__livestockNurseryHooksInstalled = true;
    const originalSynthesize = api.synthesizeBarnInteriorMapData.bind(api);
    api.synthesizeBarnInteriorMapData = function nurseryInteriorRouter(mapId) {
      return synthesizeNurseryInterior(mapId) || originalSynthesize(mapId);
    };
  }

  function safeColor(value) {
    const normalized = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : '#777777';
  }

  function babyTraitSummary(entry) {
    const traits = window.CreatureGenetics?.genotypeTraits?.(entry.kind, entry.genotype);
    if (!traits) return { size: 'Unknown size', colors: [], special: ['Traits unavailable'] };
    const colors = (traits.colors || []).map(trait => ({ name: trait.colorName || trait.label, color: safeColor(trait.color) }));
    const special = [];
    for (const pattern of traits.patterns || []) special.push(pattern.carrier ? `Carries ${pattern.label}` : pattern.label);
    if (traits.size?.isNonDefault) special.unshift('Rare size');
    if (!special.length) special.push('No special traits');
    return { size: traits.size?.label || traits.size?.sizeClass || 'Unknown size', colors, special };
  }

  function showToast(message, ok = true) {
    const fn = animalDeps?.showToast || buildingDeps?.showToast || troughDeps?.showToast;
    fn?.(message, ok);
  }

  function copyNurseryDebug() {
    const text = JSON.stringify(debugSnapshot(), null, 2);
    window.__lastNurseryDebug = text;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => showToast('Nursery debug copied.', true)).catch(() => showToast('Nursery debug saved to window.__lastNurseryDebug.', true));
    else showToast('Nursery debug saved to window.__lastNurseryDebug.', true);
  }

  function decorateLivestockUi(force = false) {
    const listEl = document.getElementById('farmLivestockList');
    if (!listEl || !animalDeps) return;
    if (!force && listEl.querySelector(':scope > [data-nursery-ui="1"]')) return;
    normalizeLifeStages();
    sanitizeBreedingPairs();
    const records = livestockList();
    const babies = records.filter(isBaby);
    const adults = records.filter(entry => !isBaby(entry));

    const worldRows = [...listEl.querySelectorAll(':scope > .farm-row.livestock-trait-row')];
    for (let index = Math.min(records.length, worldRows.length) - 1; index >= 0; index--) {
      if (isBaby(records[index])) worldRows[index].remove();
    }

    for (const select of listEl.querySelectorAll('.farm-barn-select')) {
      const nurseryOption = [...select.options].find(option => option.value === NURSERY_ID);
      nurseryOption?.remove();
      if (select.value === '') {
        const first = select.options[0];
        if (first && /stasis/i.test(first.textContent || '')) first.textContent = '🌿 Outdoors (no barn)';
        select.title = 'Adults without a barn roam outside and lose happiness each night until housed.';
      }
    }

    const existing = listEl.querySelector(':scope > [data-nursery-ui="1"]');
    existing?.remove();
    if (selectedBabyId && !babies.some(entry => entry.id === selectedBabyId)) selectedBabyId = null;
    if (!selectedBabyId && babies.length) selectedBabyId = babies[0].id;

    const wrapper = document.createElement('div');
    wrapper.dataset.nurseryUi = '1';
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:7px;margin:0 0 10px;padding:9px;border:1px solid var(--border,#444);border-radius:9px;background:rgba(255,255,255,.025);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
    const title = document.createElement('strong');
    title.textContent = `🍼 Nursery · ${babies.length} bab${babies.length === 1 ? 'y' : 'ies'}`;
    const capacity = adultCapacity();
    const count = adults.length;
    const capacityNote = document.createElement('span');
    capacityNote.className = 'farm-note';
    capacityNote.style.cssText = `margin-left:auto;${count > capacity ? 'color:#ff9b78;font-weight:700;' : ''}`;
    capacityNote.textContent = `Adults ${count}/${capacity} barn spaces`;
    const debugBtn = document.createElement('button');
    debugBtn.className = 'settings-small-btn';
    debugBtn.textContent = 'Debug';
    debugBtn.title = 'Copy Nursery state for mobile bug reports';
    debugBtn.addEventListener('click', copyNurseryDebug);
    header.append(title, capacityNote, debugBtn);
    wrapper.appendChild(header);

    const help = document.createElement('div');
    help.className = 'farm-note';
    help.textContent = 'Babies stay babies here indefinitely. Grow Up is one-way: adults can never be put back into the Nursery.';
    wrapper.appendChild(help);

    const stack = document.createElement('div');
    stack.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:230px;overflow:auto;';
    if (!babies.length) {
      const empty = document.createElement('div');
      empty.className = 'farm-note';
      empty.textContent = 'The Nursery is empty.';
      stack.appendChild(empty);
    }
    for (const baby of babies) {
      const summary = babyTraitSummary(baby);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'settings-small-btn';
      row.dataset.babyId = baby.id;
      row.style.cssText = `display:grid;grid-template-columns:auto minmax(80px,1fr) auto;gap:7px;align-items:center;text-align:left;padding:6px 8px;width:100%;${baby.id === selectedBabyId ? 'outline:2px solid rgba(255,210,122,.65);' : ''}`;
      const icon = document.createElement('span');
      icon.textContent = BABY_ICONS[baby.kind] || '🐣';
      const middle = document.createElement('span');
      middle.style.cssText = 'min-width:0;display:flex;flex-direction:column;gap:2px;';
      const name = document.createElement('strong');
      name.textContent = baby.name || window.CreatureGenetics?.defaultLivestockName?.(baby.kind) || 'Baby';
      const details = document.createElement('small');
      details.style.cssText = 'white-space:normal;opacity:.82;';
      details.textContent = `${summary.size} · ${summary.colors.map(color => color.name).join(', ') || 'Default colors'} · ${summary.special.join(', ')}`;
      middle.append(name, details);
      const swatches = document.createElement('span');
      swatches.style.cssText = 'display:flex;gap:2px;';
      for (const color of summary.colors.slice(0, 4)) {
        const swatch = document.createElement('i');
        swatch.title = color.name;
        swatch.style.cssText = `display:block;width:10px;height:10px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:${color.color};`;
        swatches.appendChild(swatch);
      }
      row.append(icon, middle, swatches);
      row.addEventListener('click', () => { selectedBabyId = baby.id; decorateLivestockUi(true); });
      stack.appendChild(row);
    }
    wrapper.appendChild(stack);

    const selected = babies.find(entry => entry.id === selectedBabyId);
    if (selected) {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding-top:4px;border-top:1px solid rgba(255,255,255,.08);';
      const rename = document.createElement('input');
      rename.className = 'farm-row-name';
      rename.maxLength = 30;
      rename.value = selected.name || '';
      rename.style.cssText = 'min-width:120px;flex:1;';
      const saveName = document.createElement('button');
      saveName.className = 'settings-small-btn';
      saveName.textContent = 'Rename';
      saveName.addEventListener('click', () => {
        const trimmed = rename.value.trim().slice(0, 30);
        if (!trimmed) { showToast('Give the baby a name first.', false); return; }
        selected.name = trimmed;
        saveLivestock(records);
        showToast('Baby renamed.', true);
        decorateLivestockUi(true);
      });
      const grow = document.createElement('button');
      grow.className = 'settings-small-btn';
      grow.textContent = 'Grow Up';
      grow.disabled = adults.length >= capacity;
      grow.title = grow.disabled ? `Adult capacity is full (${adults.length}/${capacity}).` : 'Make this baby an adult and move it into the first barn with an open stall.';
      grow.addEventListener('click', () => {
        const result = growBaby(selected.id);
        showToast(result.message, result.ok);
        if (result.ok) selectedBabyId = null;
        window.FarmPanel?.render?.();
      });
      actions.append(rename, saveName, grow);
      wrapper.appendChild(actions);
    }

    if (!adults.length) {
      const adultEmpty = document.createElement('div');
      adultEmpty.className = 'farm-note';
      adultEmpty.dataset.nurseryAdultEmpty = '1';
      adultEmpty.textContent = 'No adult livestock on the farm yet.';
      wrapper.appendChild(adultEmpty);
    }
    listEl.prepend(wrapper);
  }

  function decorateBuildingsUi() {
    const listEl = document.getElementById('farmBuildingsList');
    if (!listEl || !buildingDeps) return;
    const barns = buildingDeps.getFarmBuildings().filter(entry => entry.kind === 'barn');
    const rows = [...listEl.querySelectorAll(':scope > .farm-row')].filter(row => /^🏚/.test(row.querySelector('.farm-row-name')?.textContent || ''));
    for (let index = 0; index < Math.min(barns.length, rows.length); index++) {
      if (!isNurseryBuilding(barns[index])) continue;
      const row = rows[index];
      row.dataset.nurseryBuildingRow = '1';
      const name = row.querySelector('.farm-row-name');
      if (name) name.textContent = '🍼 Nursery (free · permanent)';
    }
  }

  function observeFarmUi() {
    if (uiObserver || typeof MutationObserver === 'undefined') return;
    const livestockEl = document.getElementById('farmLivestockList');
    const buildingsEl = document.getElementById('farmBuildingsList');
    if (!livestockEl && !buildingsEl) return;
    uiObserver = new MutationObserver(() => {
      if (uiDecorating) return;
      queueMicrotask(() => decorateFarmUi(false));
    });
    if (livestockEl) uiObserver.observe(livestockEl, { childList: true });
    if (buildingsEl) uiObserver.observe(buildingsEl, { childList: true });
  }

  function decorateFarmUi(force = false) {
    if (uiDecorating) return;
    const livestockEl = document.getElementById('farmLivestockList');
    const buildingsEl = document.getElementById('farmBuildingsList');
    const needsLivestock = force || (livestockEl && !livestockEl.querySelector(':scope > [data-nursery-ui="1"]'));
    const needsBuildings = force || (buildingsEl && nurseryBuilding() && !buildingsEl.querySelector('[data-nursery-building-row="1"]'));
    if (!needsLivestock && !needsBuildings) return;
    uiDecorating = true;
    uiObserver?.disconnect();
    try {
      if (needsLivestock) decorateLivestockUi(force);
      if (needsBuildings) decorateBuildingsUi();
    } finally {
      uiDecorating = false;
      if (uiObserver) {
        if (livestockEl) uiObserver.observe(livestockEl, { childList: true });
        if (buildingsEl) uiObserver.observe(buildingsEl, { childList: true });
      }
    }
  }

  function installPanelHook() {
    const api = window.FarmPanel;
    if (!api || panelHookInstalled || typeof api.render !== 'function') return;
    panelHookInstalled = true;
    const originalRender = api.render.bind(api);
    api.render = function nurseryFarmPanelRender(...args) {
      ensureNurseryBuilding();
      normalizeLifeStages();
      sanitizeBreedingPairs();
      const result = originalRender(...args);
      observeFarmUi();
      decorateFarmUi(true);
      return result;
    };
    observeFarmUi();
  }

  function disposeAgent(agent) {
    const mesh = agent?.mesh;
    if (!mesh) return;
    mesh.parent?.remove?.(mesh);
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) { material?.map?.dispose?.(); material?.dispose?.(); }
  }

  function clearSwarm() {
    swarmBuildToken++;
    swarmBuilding = false;
    for (const agent of swarmAgents) disposeAgent(agent);
    swarmAgents = [];
  }

  function activeScene() {
    return window.Combat?.deps?.getActiveScene?.() || null;
  }

  function currentNurseryMapId() {
    const nursery = nurseryBuilding();
    return nursery ? `map_i_barn_${nursery.id}` : null;
  }

  function shuffledSample(entries, count) {
    const copy = entries.slice();
    for (let index = copy.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy.slice(0, count);
  }

  async function createBabyAgent(entry, scene, cols, rows, token) {
    const THREE_NS = typeof THREE !== 'undefined' ? THREE : window.THREE;
    if (!THREE_NS || !scene || token !== swarmBuildToken) return null;
    let canvas = null;
    try { canvas = await window.CreatureGeneticsRender?.composeFrame?.(entry.kind, 'idle', entry.genotype, false); } catch (error) { debugLog(`Nursery sprite compose failed for ${entry.kind}: ${error?.message || error}`, 'warn'); }
    if (token !== swarmBuildToken || !scene.parent && activeScene() !== scene) return null;

    const speciesDef = animalDeps?.CREATURE_DB?.[entry.kind] || {};
    const configuredWidths = window.SCRATCHBONES_CONFIG?.game?.livestock?.animalWidths || {};
    const adultWidth = entry.kind === 'uumkaoii' ? 1.275 : (Number(configuredWidths[entry.kind]) || 1.7);
    const canvasAspect = canvas?.width > 0 ? canvas.height / canvas.width : null;
    const spriteAspect = Number(speciesDef.spriteAspect) || canvasAspect || (600 / 1375);
    const sizeScale = window.CreatureGenetics?.creatureSizeScale?.(entry.kind, entry.genotype) || { x: 1, y: 1 };
    const width = adultWidth * (Number(sizeScale.x) || 1) * BABY_SCALE;
    const height = adultWidth * spriteAspect * (Number(sizeScale.y) || 1) * BABY_SCALE;
    const geometry = new THREE_NS.PlaneGeometry(width, height);
    let material;
    if (canvas) {
      const texture = new THREE_NS.CanvasTexture(canvas);
      if ('colorSpace' in texture && THREE_NS.SRGBColorSpace) texture.colorSpace = THREE_NS.SRGBColorSpace;
      texture.needsUpdate = true;
      material = new THREE_NS.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.04, depthWrite: false, side: THREE_NS.DoubleSide });
    } else {
      material = new THREE_NS.MeshBasicMaterial({ color: 0xd8c49e, transparent: true, opacity: 0.9, depthWrite: false, side: THREE_NS.DoubleSide });
    }
    const mesh = new THREE_NS.Mesh(geometry, material);
    mesh.name = `nursery_baby_${entry.id}`;
    mesh.frustumCulled = false;
    mesh.position.set(0.65 + Math.random() * Math.max(0.2, cols - 1.3), height / 2 + 0.03, 0.65 + Math.random() * Math.max(0.2, rows - 1.3));
    scene.add(mesh);
    return {
      id: entry.id, mesh, height,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitRadius: 0.34 + Math.random() * 0.7,
      orbitSpeed: (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.75),
      moveSpeed: 1.15 + Math.random() * 0.85,
    };
  }

  async function buildSwarm() {
    if (swarmBuilding) return;
    const scene = activeScene();
    const nursery = nurseryBuilding();
    if (!scene || !nursery) return;
    normalizeLifeStages();
    const babies = livestockList().filter(isBaby);
    if (!babies.length) return;
    swarmBuilding = true;
    const token = ++swarmBuildToken;
    const cols = Math.max(6, (Number(nursery.w) || 4) * 2);
    const rows = Math.max(5, (Number(nursery.h) || 3) * 2);
    const sample = shuffledSample(babies, Math.min(NURSERY_VISIBLE_LIMIT, babies.length));
    let made = [];
    try {
      made = await Promise.all(sample.map(entry => createBabyAgent(entry, scene, cols, rows, token)));
    } catch (error) {
      swarmBuilding = false;
      debugLog(`Nursery swarm build failed: ${error?.message || error}`, 'warn');
      return;
    }
    if (token !== swarmBuildToken || !swarmInside) {
      for (const agent of made) disposeAgent(agent);
      swarmBuilding = false;
      return;
    }
    swarmAgents = made.filter(Boolean);
    swarmBuilding = false;
    debugLog(`Nursery swarm rolled ${swarmAgents.length}/${babies.length} visible babies.`);
  }

  function updateNurserySwarm(dt) {
    if (!animalDeps || !buildingDeps) return;
    const mapId = currentNurseryMapId();
    const currentArea = animalDeps.getCurrentArea?.();
    const inside = !!mapId && currentArea === mapId;
    if (!inside) {
      if (swarmInside || swarmAgents.length || swarmBuilding) clearSwarm();
      swarmInside = false;
      return;
    }
    if (!swarmInside) {
      swarmInside = true;
      clearSwarm(); // Clears stale meshes and increments token; this entry gets a fresh random sample.
      swarmInside = true;
      buildSwarm();
    } else if (!swarmAgents.length && !swarmBuilding && livestockList().some(isBaby)) buildSwarm();

    const nursery = nurseryBuilding();
    const cols = Math.max(6, (Number(nursery?.w) || 4) * 2);
    const rows = Math.max(5, (Number(nursery?.h) || 3) * 2);
    const playerX = (Number(animalDeps.player?.x) || 0) / (Number(animalDeps.TILE) || 1);
    const playerZ = (Number(animalDeps.player?.y) || 0) / (Number(animalDeps.TILE) || 1);
    const babyIds = new Set(livestockList().filter(isBaby).map(entry => entry.id));
    const survivors = [];
    for (const agent of swarmAgents) {
      if (!babyIds.has(agent.id)) { disposeAgent(agent); continue; }
      const mesh = agent.mesh;
      agent.orbitAngle += agent.orbitSpeed * dt;
      const targetX = clamp(playerX + Math.cos(agent.orbitAngle) * agent.orbitRadius, 0.45, cols - 0.45);
      const targetZ = clamp(playerZ + Math.sin(agent.orbitAngle) * agent.orbitRadius, 0.45, rows - 0.45);
      const dx = targetX - mesh.position.x;
      const dz = targetZ - mesh.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.001) {
        const step = Math.min(distance, agent.moveSpeed * dt);
        mesh.position.x += dx / distance * step;
        mesh.position.z += dz / distance * step;
      }
      mesh.rotation.y = Math.atan2(playerX - mesh.position.x, playerZ - mesh.position.z);
      survivors.push(agent);
    }
    swarmAgents = survivors;
  }

  function debugSnapshot() {
    normalizeLifeStages();
    const list = livestockList();
    const nursery = nurseryBuilding();
    return {
      mostRecentChange: 'Stasis replaced by a one-way livestock Nursery with baby storage, growth gating, and outdoor unhoused adults.',
      nursery: nursery ? { id: nursery.id, col: nursery.col, row: nursery.row, w: nursery.w, h: nursery.h, protected: true } : null,
      babies: list.filter(isBaby).map(entry => ({ id: entry.id, name: entry.name, kind: entry.kind, sizeClass: entry.genotype?.sizeClass || null })),
      adults: list.filter(entry => !isBaby(entry)).map(entry => ({ id: entry.id, name: entry.name, kind: entry.kind, barnId: entry.barnId || null, happiness: entry.heartLevel })),
      adultCount: list.filter(entry => !isBaby(entry)).length,
      adultCapacity: adultCapacity(),
      overCapacityBy: Math.max(0, list.filter(entry => !isBaby(entry)).length - adultCapacity()),
      visibleLimit: NURSERY_VISIBLE_LIMIT,
      visibleBabyIds: swarmAgents.map(agent => agent.id),
      currentArea: animalDeps?.getCurrentArea?.() || null,
    };
  }

  function debugLog(message, level = 'info') {
    const text = `[Nursery] ${message}`;
    try { window.__farmLog?.(text, 'livestock'); } catch (_) {}
    try { (buildingDeps?.debugLog || animalDeps?.debugLog)?.(text, level); } catch (_) {}
    if (level === 'warn') console.warn(text); else console.debug(text);
  }

  function hookInitializer(api, capture, install) {
    if (!api?.init || api.init.__livestockNurseryInitHook) return;
    const originalInit = api.init;
    const wrapped = function livestockNurseryInitHook(injectedDeps) {
      capture(injectedDeps);
      const result = originalInit.call(this, injectedDeps);
      install();
      installPanelHook();
      return result;
    };
    wrapped.__livestockNurseryInitHook = true;
    api.init = wrapped;
  }

  hookInitializer(window.FarmAnimals, injected => { animalDeps = injected; }, installAnimalHooks);
  hookInitializer(window.FarmBuildings, injected => { buildingDeps = injected; }, installBuildingHooks);
  hookInitializer(window.FarmTroughs, injected => { troughDeps = injected; }, installTroughHooks);
  installPanelHook();

  window.LivestockNursery = {
    NURSERY_ID,
    NURSERY_VISIBLE_LIMIT,
    BABY_SCALE,
    isBaby,
    growBaby,
    ensureBuilding: ensureNurseryBuilding,
    adultCapacity,
    adultCount,
    debugSnapshot,
    rerollVisibleSwarm() { if (!swarmInside) return false; clearSwarm(); swarmInside = true; buildSwarm(); return true; },
  };
  window.__nurseryDebug = { snapshot: debugSnapshot, reroll: () => window.LivestockNursery.rerollVisibleSwarm(), ensureBuilding: ensureNurseryBuilding };
})();
