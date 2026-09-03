(() => {
  'use strict';

  // Barn trough system: barn-interior map synthesis, the live fill-level
  // mesh registry, sleeping-livestock visuals, and the "open trough"
  // bag/slot panel. Split out of game.js (which used to own all three
  // inline) so this feature follows the same self-contained module shape
  // as FarmAnimals/FarmBuildings/FarmPanel — game.js just wires deps and
  // delegates.

  let deps = null;
  let _sleepSyncTimer = null; // Used to keep already-loaded barn interiors in sync when day/night changes in place.

  const LIVESTOCK_SLEEP_SCALE_Y = 0.5; // Used by barn sleepers; matches wild Drenkirra's existing simplistic sleep pose exactly.
  const LIVESTOCK_SLEEP_SYNC_MS = 750; // Used by the low-cost barn-interior sleeper refresh timer.
  const _meshRegistry = new Map(); // Used to find the live trough group/scene for each barnId,troughIndex.
  const _sleepingLivestock = new Map(); // Used to own/dispose the temporary sleeping avatar for each livestock record.

  function init(injectedDeps) {
    deps = injectedDeps;
    if (_sleepSyncTimer == null && typeof window.setInterval === 'function') {
      _sleepSyncTimer = window.setInterval(syncSleepingLivestock, LIVESTOCK_SLEEP_SYNC_MS);
    }
  }

  function troughSlotCount(trough) {
    return Array.isArray(trough?.slots) ? trough.slots.filter(Boolean).length : 0;
  }

  function _barnInteriorLayout(barn) {
    const BARN_TIERS = deps.getBarnTiers();
    const cols = Math.max(4, barn.w * 2);
    const rows = Math.max(4, barn.h * 2);
    const slots = BARN_TIERS[barn.tier]?.slots || 0;
    const troughPositions = [];
    for (let r = 1; r <= rows - 2 && troughPositions.length < slots; r++) troughPositions.push({ col: 1, row: r, wall: 'west' });
    for (let r = 1; r <= rows - 2 && troughPositions.length < slots; r++) troughPositions.push({ col: cols - 2, row: r, wall: 'east' });
    return { BARN_TIERS, cols, rows, troughPositions };
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
    const { BARN_TIERS, cols, rows, troughPositions } = _barnInteriorLayout(barn);
    const floor = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) floor.push([c, r]);
    const doorCenter = Math.floor(cols / 2);
    const doorCols = [doorCenter - 1, doorCenter, doorCenter + 1].filter(c => c > 0 && c < cols - 1);
    const exits = [{ id: 'exit_barn_front', label: 'Barn Door', tiles: doorCols.map(c => [c, rows - 1]), targetMap: '', spawnCol: 0, spawnRow: 0 }];
    const furniture = [{ id: 'f_barn_grinder', itemKey: 'feedGrinderFurniture', col: cols - 2, row: 0, rotY: 0, barnId, postX: 0, postY: 0, postZ: 0, postSX: 1, postSY: 1, postSZ: 1 }];
    troughPositions.forEach((pos, i) => {
      // Rotated 90° from the trough's authored orientation (trough.json's
      // basin runs long along local X) so it sits flush along the wall it's
      // placed against instead of sticking out into the room.
      furniture.push({ id: 'f_barn_trough_' + i, itemKey: 'troughFurniture', col: pos.col, row: pos.row, rotY: 90, barnId, troughIndex: i, postX: 0, postY: 0, postZ: 0, postSX: 1, postSY: 1, postSZ: 1 });
    });
    return { schema: 'hobunji_building_interior.v1', id: mapId, name: (BARN_TIERS[barn.tier]?.label || 'Barn') + ' Interior', cols, rows, exits, colliders: [], vendorZones: [], floor, furniture, npcStations: [] };
  }

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

  function _sleepModelMetrics(kind, genotype) {
    const widthByKind = window.SCRATCHBONES_CONFIG?.game?.livestock?.animalWidths || {};
    const modelWidth = kind === 'uumkaoii' ? 1.275 : (Number(widthByKind[kind]) || 1.7);
    const modelHeight = kind === 'uumkaoii' ? modelWidth * (451 / 641) : modelWidth * (600 / 1375);
    const sizeScale = window.CreatureGenetics?.creatureSizeScale?.(kind, genotype) || { x: 1, y: 1 };
    const authoredGroundOffset = window.CreatureGenetics?.creatureGroundOffset?.(kind, genotype);
    const groundLift = Number.isFinite(authoredGroundOffset) ? authoredGroundOffset : modelHeight * (Number(sizeScale.y) || 1) / 2;
    return { modelWidth, modelHeight, sizeScale, groundLift };
  }

  function _sleepBaseUrl(kind) {
    if (kind === 'uumkaoii') return "assets/creaturesprites/uumkao'ii.png";
    return window.CreatureGeneticsRender?.SPECIES?.[kind]?.base?.idle || `assets/creaturesprites/${kind}_idle.png`;
  }

  function _applySleepingComposite(avatarRef, rec) {
    if (!avatarRef || !rec?.genotype || !window.CreatureGeneticsRender?.composeFrame || typeof THREE === 'undefined') return;
    window.CreatureGeneticsRender.composeFrame(rec.kind, 'idle', rec.genotype, false).then(canvas => {
      if (!canvas || !avatarRef.group?.parent) return;
      const frontTex = new THREE.CanvasTexture(canvas);
      frontTex.colorSpace = THREE.SRGBColorSpace;
      const backTex = new THREE.CanvasTexture(canvas);
      backTex.colorSpace = THREE.SRGBColorSpace;
      backTex.wrapS = THREE.RepeatWrapping;
      backTex.repeat.set(-1, 1);
      backTex.offset.set(1, 0);
      for (const child of avatarRef.group.children) {
        if (!child.material) continue;
        if (child.name.endsWith('_front_plane')) { child.material.map = frontTex; child.material.needsUpdate = true; }
        else if (child.name.endsWith('_back_plane')) { child.material.map = backTex; child.material.needsUpdate = true; }
      }
    }).catch(() => {});
  }

  function _sleepSpotFor(barn, troughIndex) {
    const { cols, troughPositions } = _barnInteriorLayout(barn);
    const troughPos = troughPositions[troughIndex];
    if (!troughPos) return null;
    const inward = troughPos.wall === 'west' ? 1 : -1;
    const x = troughPos.col + 0.5 + inward * 1.05;
    const z = troughPos.row + 0.5;
    const rotationY = troughPos.wall === 'west' ? Math.PI / 2 : -Math.PI / 2;
    return { x: Math.max(0.75, Math.min(cols - 0.75, x)), z, rotationY };
  }

  function _disposeSleepingLivestock(livestockId, reason = 'removed') {
    const sleeper = _sleepingLivestock.get(livestockId);
    if (!sleeper) return;
    sleeper.avatarRef?.group?.parent?.remove(sleeper.avatarRef.group);
    sleeper.avatarRef?.dispose?.();
    _sleepingLivestock.delete(livestockId);
    window.__farmLog?.(`[barn-sleep] ${sleeper.name || livestockId}: ${reason}`, 'livestock');
  }

  function _createSleepingLivestock(rec, barn, troughIndex, troughEntry) {
    if (!rec || !barn || !troughEntry?.group?.parent || !window.PNGPlaneAvatar?.buildAnimalPlaneAvatarModel || typeof THREE === 'undefined') return null;
    const spot = _sleepSpotFor(barn, troughIndex);
    if (!spot) return null;
    const { modelWidth, modelHeight, sizeScale, groundLift } = _sleepModelMetrics(rec.kind, rec.genotype);
    const avatarRef = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, _sleepBaseUrl(rec.kind), {
      modelWidth,
      modelHeight,
      name: `barn_sleep_${rec.kind}_${rec.id}`,
      creatureId: rec.kind,
      headRig: window.CreatureGeneticsRender?.headRigForKind?.(rec.kind) || undefined,
    });
    const group = avatarRef.group;
    group.position.set(spot.x, (Number(troughEntry.group.position.y) || 0) + groundLift, spot.z);
    group.rotation.y = spot.rotationY;
    group.userData.barnSleepingLivestockId = rec.id;
    group.userData.barnSleepingLivestockName = rec.name || rec.kind;
    if (window.CreatureGenetics?.applyCreatureBillboardScale) {
      window.CreatureGenetics.applyCreatureBillboardScale(group, sizeScale, LIVESTOCK_SLEEP_SCALE_Y);
    } else {
      group.scale.set(Number(sizeScale.x) || 1, (Number(sizeScale.y) || 1) * LIVESTOCK_SLEEP_SCALE_Y, 1);
    }
    troughEntry.group.parent.add(group);
    _applySleepingComposite(avatarRef, rec);
    const sleeper = { livestockId: rec.id, name: rec.name, barnId: barn.id, troughIndex, sceneParent: troughEntry.group.parent, avatarRef };
    _sleepingLivestock.set(rec.id, sleeper);
    window.__farmLog?.(`[barn-sleep] ${rec.name || rec.id}: sleeping beside trough ${troughIndex + 1} in ${barn.id}`, 'livestock');
    return sleeper;
  }

  // Mirrors the wild Drenkirra night pose instead of introducing a second
  // livestock animation system: while a barn interior is actually loaded,
  // each housed animal with an assigned, real trough gets a temporary idle
  // avatar beside that trough with the same 50%-Y sleep flattening. The
  // exterior animal remains owned by FarmAnimals; this is only the interior
  // representation, so location/save/AI state cannot diverge.
  function syncSleepingLivestock() {
    if (!deps || !window.FarmAnimals) return;
    const night = !!window.Music?.isNightTime?.();
    if (!night) {
      for (const livestockId of [..._sleepingLivestock.keys()]) _disposeSleepingLivestock(livestockId, 'woke for daytime');
      return;
    }

    const farmBuildings = deps.getFarmBuildings();
    const barnsById = new Map(farmBuildings.filter(b => b.kind === 'barn').map(b => [b.id, b]));
    const livestock = deps.loadWorldLivestock();
    const desired = new Set();

    for (const rec of livestock) {
      if (!rec?.barnId || rec.troughIndex == null) continue;
      const barn = barnsById.get(rec.barnId);
      if (!barn) continue;
      const troughs = window.FarmAnimals.ensureBarnTroughs?.(barn);
      if (!troughs?.[rec.troughIndex]) continue;
      const troughEntry = _meshRegistry.get(`${rec.barnId},${rec.troughIndex}`);
      if (!troughEntry?.group?.parent) continue;
      desired.add(rec.id);
      const existing = _sleepingLivestock.get(rec.id);
      if (!existing || existing.sceneParent !== troughEntry.group.parent || existing.troughIndex !== rec.troughIndex) {
        if (existing) _disposeSleepingLivestock(rec.id, 'moved to another trough/scene');
        _createSleepingLivestock(rec, barn, rec.troughIndex, troughEntry);
      }
    }

    for (const livestockId of [..._sleepingLivestock.keys()]) {
      if (!desired.has(livestockId)) _disposeSleepingLivestock(livestockId, 'no loaded assigned trough');
    }
  }

  // Called once, when a trough's furniture mesh is first built into a
  // loaded barn interior scene.
  function registerMesh(barnId, troughIndex, group, authoredData) {
    _meshRegistry.set(barnId + ',' + troughIndex, { group, authoredData });
    const farmBuildings = deps.getFarmBuildings();
    const barn = farmBuildings.find(b => b.id === barnId && b.kind === 'barn');
    const trough = barn && window.FarmAnimals.ensureBarnTroughs(barn)[troughIndex];
    if (trough) _applyTroughLiquidVisual(group, authoredData, trough);
    syncSleepingLivestock();
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
    syncSleepingLivestock();
  }

  // Mobile-friendly diagnostic data for the existing in-game debug/log
  // tooling: callers can inspect exactly which livestock sleeper is bound
  // to which barn/trough without needing DevTools or console access.
  function debugSleepingLivestock() {
    return [..._sleepingLivestock.values()].map(sleeper => ({
      livestockId: sleeper.livestockId,
      name: sleeper.name,
      barnId: sleeper.barnId,
      troughIndex: sleeper.troughIndex,
      visible: sleeper.avatarRef?.group?.visible !== false,
      sceneAttached: !!sleeper.avatarRef?.group?.parent,
    }));
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

  window.FarmTroughs = {
    init,
    synthesizeBarnInteriorMapData,
    registerMesh,
    refreshVisual,
    troughSlotCount,
    syncSleepingLivestock,
    debugSleepingLivestock,
    open,
    close,
    LIVESTOCK_SLEEP_SCALE_Y,
  };
})();

// Parser-time bootstrap for the standalone Nursery integration. This is the
// only Nursery-specific code kept in the trough module: lifecycle, UI, building
// rules, and baby rendering all live in livestock-nursery.js. During ordinary
// index.html parsing document.write keeps both helper scripts synchronous, so
// their public wrappers are installed before game.js initializes farm systems.
(() => {
  'use strict';
  if (window.LivestockNursery) return;
  const nurserySrc = 'js/livestock-nursery.js?v=20260902mainrebuild1';
  const bridgeSrc = 'js/livestock-nursery-install-bridge.js?v=20260902mainrebuild1';

  if (document.readyState === 'loading') {
    document.write(`<script src="${nurserySrc}"><\/script>`);
    document.write(`<script src="${bridgeSrc}"><\/script>`);
    return;
  }

  // Dynamic-loader fallback for tools/tests that inject farm-troughs.js after
  // parsing has already finished; normal gameplay uses the synchronous path.
  const load = src => new Promise(resolve => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
  });
  load(nurserySrc).then(() => load(bridgeSrc));
})();
