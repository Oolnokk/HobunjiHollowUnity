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
