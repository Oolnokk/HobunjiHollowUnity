(() => {
  'use strict';

  const CONFIG_URL = 'config/town-mine.json'; // Used to keep mine balance, entrance placement, ore tiers, and ladder costs outside game.js.
  const FLOOR_PREFIX = 'map_i_town_mine_f_'; // Used to recognize procedural mine areas without confusing them with animal dens.
  const SAFE_ROOM_ID = 'map_i_town_mine_safe'; // Used as the permanent hub between town and unlocked tier shortcuts.
  let configPromise = null; // Used to share the single mine-config request among map loading, loot gating, and diagnostics.
  let deps = null; // Used by runtime progression helpers while pure generation remains independently testable.
  let progression = { deepestFloor: 0, unlockedShortcutTiers: [], townValue: 0 }; // Used as the world-member mine progression saved alongside inventory and quests.

  function init(injectedDeps) { deps = injectedDeps; }

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch(CONFIG_URL)
        .then(response => {
          if (!response.ok) throw new Error(`Town mine config HTTP ${response.status}`);
          return response.json();
        })
        .catch(error => {
          console.error('[town-mine] config load failed', error);
          return null;
        });
    }
    return configPromise;
  }

  function floorFromMapId(mapId) {
    if (typeof mapId !== 'string' || !mapId.startsWith(FLOOR_PREFIX)) return null;
    const floor = Number(mapId.slice(FLOOR_PREFIX.length)); // Used to derive tier/content rules from the stable floor map id.
    return Number.isInteger(floor) && floor >= 1 && floor <= 100 ? floor : null;
  }

  function mapIdForFloor(floor) {
    const safeFloor = Math.max(1, Math.min(100, Math.floor(Number(floor) || 1))); // Used to prevent malformed transitions from escaping the authored 100-floor range.
    return FLOOR_PREFIX + String(safeFloor).padStart(3, '0');
  }

  function tierForFloor(floor) {
    return Math.max(1, Math.min(10, Math.floor((Math.max(1, floor) - 1) / 10) + 1));
  }

  function seededRng(seedText) {
    if (window.WildernessMapGenerator?.makeRng) return window.WildernessMapGenerator.makeRng(seedText);
    let state = 2166136261; // Used as the deterministic fallback seed when the wilderness generator has not loaded yet.
    for (let index = 0; index < seedText.length; index++) state = Math.imul(state ^ seedText.charCodeAt(index), 16777619) >>> 0;
    return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  }

  function pickSeparatedTiles(rng, floorTiles, excluded, count) {
    const candidates = floorTiles.filter(([col, row]) => !excluded.has(`${col},${row}`)); // Used as the remaining legal scatter area for rocks and enemies.
    const picks = [];
    while (picks.length < count && candidates.length) {
      const index = Math.floor(rng() * candidates.length); // Used to remove each selected tile so a floor never double-stacks content.
      const tile = candidates.splice(index, 1)[0];
      if (picks.some(([col, row]) => Math.hypot(col - tile[0], row - tile[1]) < 2.2)) continue;
      picks.push(tile);
    }
    return picks;
  }

  function enemyPlan(floor, rng) {
    if (floor <= 3) return rng() < 0.2 ? ['grehlr'] : [];
    if (floor <= 10) return [];
    const ghoulCount = Math.min(12, 2 + Math.floor((floor - 11) / 10)); // Used to grow pairs into trios and eventually large surrounding groups.
    return Array.from({ length: ghoulCount }, () => 'ghoul');
  }

  async function synthesizeFloorMapData(mapId) {
    const floorNumber = floorFromMapId(mapId); // Used as the authoritative progression number for this procedural floor.
    if (!floorNumber) return null;
    const config = await loadConfig();
    if (!config) return null;

    const generated = window.CavernGenerator.generateCavernFloor(`${mapId}_layout`, { fast: true }); // Uses the player-approved Mine Fast sculpt preset.
    const rng = seededRng(`${mapId}_content`); // Used to keep a floor stable throughout a run while allowing every numbered floor to differ.
    const tier = tierForFloor(floorNumber); // Used to select ore identity and enemy progression in ten-floor bands.
    const excluded = new Set(generated.exitTiles.map(([col, row]) => `${col},${row}`)); // Used to keep the entrance clear of rocks and enemies.
    const distantTiles = generated.floor.filter(([col, row]) => Math.hypot(col - generated.exitCol, row - generated.exitRow) >= 5); // Used to prevent the hidden descent from appearing beside the entrance.
    const descentCandidates = distantTiles.length ? distantTiles : generated.floor;
    const descentTile = descentCandidates[Math.floor(rng() * descentCandidates.length)]; // Used as the rock whose removal reveals the next-floor hole.
    excluded.add(`${descentTile[0]},${descentTile[1]}`);

    const ordinaryRockCount = Math.max(8, Math.min(24, Math.round(generated.floor.length / 7))); // Used to make searching for the descent a real mining process without sealing the cave.
    const ordinaryTiles = pickSeparatedTiles(rng, generated.floor, excluded, ordinaryRockCount);
    const tierMetalKey = config.oreTierMetalKeys[tier - 1]; // Used by rewards and verdigris-colored seam rendering for this floor tier.
    const oreRocks = ordinaryTiles.map(([col, row], index) => ({
      col,
      row,
      oreKind: index % 3 === 0 ? tierMetalKey : 'stone',
      metalKey: index % 3 === 0 ? tierMetalKey : null,
      mineFloor: floorNumber,
    }));
    oreRocks.push({ col: descentTile[0], row: descentTile[1], oreKind: 'stone', hiddenDescent: floorNumber < config.floorCount });

    const enemyKinds = enemyPlan(floorNumber, rng); // Used to apply the requested quiet opening followed by increasingly large ghoul groups.
    const enemyTiles = pickSeparatedTiles(rng, generated.floor, excluded, enemyKinds.length);
    const mineEnemySpawns = enemyTiles.map(([col, row], index) => ({ col, row, kind: enemyKinds[index] }));

    const exits = [{ id: `mine_floor_${floorNumber}_retreat`, label: 'Retreat to the ladder room', tiles: generated.exitTiles, targetMap: SAFE_ROOM_ID, spawnCol: 4, spawnRow: 3 }]; // Used to let players deliberately bank a run instead of requiring death.
    if (floorNumber < config.floorCount) {
      exits.push({ id: `mine_floor_${floorNumber}_descent`, label: `Descend to Floor ${floorNumber + 1}`, tiles: [descentTile], targetMap: mapIdForFloor(floorNumber + 1), spawnCol: 0, spawnRow: 0, hiddenUnderRock: true });
    }

    return {
      schema: 'hobunji_building_interior.v1',
      id: mapId,
      name: `Town Mine — Floor ${floorNumber}`,
      cols: generated.cols,
      rows: generated.rows,
      floor: generated.floor,
      colliders: [],
      furniture: [],
      exits,
      exitCol: generated.exitCol,
      exitRow: generated.exitRow,
      mesh: generated.mesh,
      wallStyle: 'mine',
      mineFloor: floorNumber,
      mineTier: tier,
      mineMetalKey: tierMetalKey,
      oreRocks,
      mineEnemySpawns,
      descentRock: floorNumber < config.floorCount ? { col: descentTile[0], row: descentTile[1] } : null,
    };
  }

  async function decorateTownMap(mapData) {
    if (!mapData || mapData.id !== 'map_hobunji_town') return mapData;
    const config = await loadConfig();
    if (!config) return mapData;
    const entrance = config.townEntrance; // Used to place both the visual house-system entryway and its matching transition from one record.
    mapData.buildings ||= [];
    mapData.transitions ||= [];
    if (!mapData.buildings.some(building => building.id === entrance.buildingId)) {
      mapData.buildings.push({
        id: entrance.buildingId,
        label: 'Town Mine',
        pieceFile: 'config/pieces/town-mine-entry.json',
        gridX: entrance.gridX,
        gridZ: entrance.gridZ,
        footprintW: entrance.footprintW,
        footprintD: entrance.footprintD,
        rotationDeg: entrance.rotationDeg,
        rotation: entrance.rotationDeg,
        doorEntrance: { bboxW: entrance.footprintW, bboxD: entrance.footprintD, cells: [{ x: 0, y: 1 }], psCells: [{ x: 1, y: 1 }] },
      });
    }
    if (!mapData.transitions.some(transition => transition.id === 'spot_town_mine')) {
      mapData.transitions.push({ id: 'spot_town_mine', label: 'Enter Town Mine', col: entrance.doorCol, row: entrance.doorRow, targetMapId: SAFE_ROOM_ID, targetSpotId: '', buildingId: entrance.buildingId });
    }
    return mapData;
  }

  function maximumMetalTierForTownValue(townValue) {
    return Math.max(1, Math.min(10, Math.floor(Number(townValue) || 0) + 1));
  }

  function recordFloorReached(floor) {
    progression.deepestFloor = Math.max(progression.deepestFloor, Math.max(0, Math.min(100, Math.floor(Number(floor) || 0))));
  }

  function serialize() {
    return { deepestFloor: progression.deepestFloor, unlockedShortcutTiers: [...progression.unlockedShortcutTiers], townValue: progression.townValue };
  }

  function restore(saved) {
    const shortcutTiers = Array.isArray(saved?.unlockedShortcutTiers) ? saved.unlockedShortcutTiers : []; // Used to reject malformed save data without losing valid progression.
    progression = {
      deepestFloor: Math.max(0, Math.min(100, Math.floor(Number(saved?.deepestFloor) || 0))),
      unlockedShortcutTiers: [...new Set(shortcutTiers.map(Number).filter(tier => Number.isInteger(tier) && tier >= 1 && tier <= 9))].sort((a, b) => a - b),
      townValue: Math.max(0, Math.floor(Number(saved?.townValue) || 0)),
    };
  }

  function getTownValue() { return progression.townValue; }

  function completedTier(tier) {
    return progression.deepestFloor >= Math.max(1, Math.min(9, Number(tier) || 1)) * 10;
  }

  function woodCount() {
    return (deps?.woodItemKeys || []).reduce((total, key) => total + Math.max(0, Number(deps.inventory?.[key]) || 0), 0);
  }

  function spendWood(amount) {
    let remaining = amount;
    for (const key of (deps?.woodItemKeys || [])) {
      const take = Math.min(remaining, Math.max(0, Number(deps.inventory?.[key]) || 0));
      deps.inventory[key] -= take;
      remaining -= take;
      if (!remaining) break;
    }
  }

  async function ladderRows() {
    const config = await loadConfig();
    if (!config) return [];
    return config.ladderUpgrades.map(upgrade => {
      const metalKey = config.oreTierMetalKeys[upgrade.tier - 1];
      const barKey = deps?.metalBarItemKey?.(metalKey) || `bar_${metalKey}`;
      const unlocked = progression.unlockedShortcutTiers.includes(upgrade.tier);
      const reached = completedTier(upgrade.tier);
      const inventory = deps?.inventory || {};
      const resources = {
        gold: Math.max(0, Number(inventory.gold) || 0),
        stone: Math.max(0, Number(inventory.stone) || 0),
        wood: woodCount(),
        metalBars: Math.max(0, Number(inventory[barKey]) || 0),
      };
      const affordable = Object.keys(resources).every(key => resources[key] >= upgrade[key]);
      return { ...upgrade, metalKey, barKey, metalLabel: deps?.metalLabel?.(metalKey) || metalKey, unlocked, reached, affordable, resources };
    });
  }

  async function buildLadderTier(tier) {
    const row = (await ladderRows()).find(entry => entry.tier === Number(tier));
    if (!row) return { ok: false, message: 'That ladder extension does not exist.' };
    if (row.unlocked) return { ok: false, message: `The shortcut to Floor ${row.targetFloor} is already built.` };
    if (row.tier > 1 && !progression.unlockedShortcutTiers.includes(row.tier - 1)) return { ok: false, message: 'Build the preceding ladder extension first.' };
    if (!row.reached) return { ok: false, message: `Reach Floor ${row.tier * 10} before extending the ladder.` };
    if (!row.affordable) return { ok: false, message: 'You do not have all of the required materials.' };
    deps.inventory.gold -= row.gold;
    deps.inventory.stone -= row.stone;
    spendWood(row.wood);
    deps.inventory[row.barKey] -= row.metalBars;
    progression.unlockedShortcutTiers.push(row.tier);
    progression.unlockedShortcutTiers.sort((a, b) => a - b);
    progression.townValue += 1;
    deps?.refreshInventory?.();
    deps?.save?.();
    return { ok: true, message: `Ladder extended to Floor ${row.targetFloor}. Town Value is now ${progression.townValue}.` };
  }

  function ensureLadderPanel() {
    let panel = document.getElementById('townMineLadderPanel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'townMineLadderPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.style.cssText = 'position:fixed;inset:0;z-index:18000;background:rgba(8,10,13,.82);display:none;align-items:center;justify-content:center;padding:18px;font:14px system-ui;color:#eee';
    panel.innerHTML = '<section style="width:min(760px,96vw);max-height:88vh;overflow:auto;background:#24272b;border:2px solid #777;border-radius:12px;padding:18px;box-shadow:0 18px 60px #000"><div style="display:flex;align-items:center;gap:12px"><h2 style="margin:0;flex:1">Mine Ladder</h2><button data-close style="font-size:20px">Close</button></div><p data-summary></p><div data-shortcuts></div><hr style="border-color:#555"><div data-upgrades></div></section>';
    panel.querySelector('[data-close]').addEventListener('click', () => { panel.style.display = 'none'; });
    panel.addEventListener('click', event => { if (event.target === panel) panel.style.display = 'none'; });
    document.body.appendChild(panel);
    return panel;
  }

  async function openLadderPanel() {
    const panel = ensureLadderPanel();
    panel.style.display = 'flex';
    const rows = await ladderRows();
    panel.querySelector('[data-summary]').textContent = `Deepest floor: ${progression.deepestFloor} · Town Value: ${progression.townValue}. Completed tiers permit costly permanent shortcuts.`;
    const shortcuts = panel.querySelector('[data-shortcuts]');
    shortcuts.innerHTML = '<h3>Descend</h3>';
    const destinations = [{ floor: 1, label: 'Floor 1' }, ...rows.filter(row => row.unlocked).map(row => ({ floor: row.targetFloor, label: `Floor ${row.targetFloor}` }))];
    for (const destination of destinations) {
      const button = document.createElement('button');
      button.textContent = `🪜 ${destination.label}`;
      button.style.cssText = 'margin:0 8px 8px 0;padding:9px 13px';
      button.addEventListener('click', () => { panel.style.display = 'none'; deps?.travelToFloor?.(destination.floor); });
      shortcuts.appendChild(button);
    }
    const upgrades = panel.querySelector('[data-upgrades]');
    upgrades.innerHTML = '<h3>Extensions</h3>';
    for (const row of rows) {
      const card = document.createElement('div');
      card.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px;margin:8px 0;padding:12px;background:#181a1d;border:1px solid #555;border-radius:8px';
      const status = row.unlocked ? 'Built' : !row.reached ? `Locked — reach Floor ${row.tier * 10}` : row.affordable ? 'Ready to build' : 'Missing materials';
      card.innerHTML = `<div><strong>Tier ${row.tier} → Floor ${row.targetFloor}</strong><div style="color:#bbb;margin-top:5px">${row.gold}g (${row.resources.gold}) · ${row.stone} Stone (${row.resources.stone}) · ${row.wood} raw wood (${row.resources.wood}) · ${row.metalBars} ${row.metalLabel} Bars (${row.resources.metalBars})</div><div style="margin-top:5px">${status}</div></div>`;
      const button = document.createElement('button');
      button.textContent = row.unlocked ? 'Built' : 'Construct';
      button.disabled = row.unlocked || !row.reached || !row.affordable || (row.tier > 1 && !progression.unlockedShortcutTiers.includes(row.tier - 1));
      button.addEventListener('click', async () => {
        const result = await buildLadderTier(row.tier);
        deps?.showToast?.(result.message, result.ok);
        await openLadderPanel();
      });
      card.appendChild(button);
      upgrades.appendChild(card);
    }
  }

  function makeLadderInteractable() {
    return {
      getButtons: () => [{ icon: '🪜', label: 'Mine Ladder', action: 'obj_mine_ladder', style: 'primary', allowed: true }],
      onAction(action) {
        if (action !== 'obj_mine_ladder') return { ok: false, message: 'Unknown action.' };
        openLadderPanel();
        return { ok: true, message: 'Opened the mine ladder plans.' };
      },
    };
  }

  function filterMetalKeysForTownValue(metalKeys, townValue) {
    const maximumTier = maximumMetalTierForTownValue(townValue); // Used to keep chest and Gullet metals aligned with the first ten Town Value levels.
    return (metalKeys || []).filter((metalKey, index) => index < maximumTier);
  }

  function farmRootTotem(cols, rows) {
    const x = Math.max(2, Math.min(cols - 3, Math.floor(cols * 0.5) + 2));
    const y = Math.max(2, Math.min(rows - 3, Math.floor(rows * 0.72)));
    return { x, y, spawnX: x - 1, spawnY: y };
  }

  function debugSnapshot() {
    const area = deps?.getCurrentArea?.(); // Used by the mobile-safe diagnostic report to identify the active mine context.
    const floor = floorFromMapId(area);
    const snapshot = { area, floor, tier: floor ? tierForFloor(floor) : null, isMine: !!floor, safeRoom: area === SAFE_ROOM_ID };
    window.__farmLog?.(`[town-mine] ${JSON.stringify(snapshot)}`, 'info', 'mine');
    return snapshot;
  }

  window.TownMine = {
    init,
    loadConfig,
    floorFromMapId,
    mapIdForFloor,
    tierForFloor,
    synthesizeFloorMapData,
    decorateTownMap,
    maximumMetalTierForTownValue,
    filterMetalKeysForTownValue,
    recordFloorReached,
    serialize,
    restore,
    getTownValue,
    ladderRows,
    buildLadderTier,
    openLadderPanel,
    makeLadderInteractable,
    farmRootTotem,
    debugSnapshot,
    SAFE_ROOM_ID,
  };
})();
