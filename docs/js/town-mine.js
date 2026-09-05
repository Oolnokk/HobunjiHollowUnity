(() => {
  'use strict';

  const CONFIG_URL = 'config/town-mine.json'; // Used to keep mine balance, entrance placement, ore tiers, and ladder costs outside game.js.
  const FLOOR_PREFIX = 'map_i_town_mine_f_'; // Used to recognize procedural mine areas without confusing them with animal dens.
  const SAFE_ROOM_ID = 'map_i_town_mine_safe'; // Used as the permanent hub between town and unlocked tier shortcuts.
  let configPromise = null; // Used to share the single mine-config request among map loading, loot gating, and diagnostics.
  let deps = null; // Used by runtime progression helpers while pure generation remains independently testable.
  let progression = { deepestFloor: 0, unlockedShortcutTiers: [], townValue: 0, discoveredOreKeys: [] }; // Used as the world-member mine progression and permanent ore-recipe discovery saved alongside inventory and quests.
  const floorVisitCounts = new Map(); // Used to give every entry a fresh layout/content seed instead of treating a numbered floor as a permanent map.
  const ghoulBgmFloorIds = new Set(); // Generated floors whose actual spawn plan contains at least one Ghoul.
  const GHOUL_BGM_TRACK = { url: 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg', volumeMultiplier: 2 }; // Ghoul-floor music deliberately plays at twice the ordinary BGM base level.

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

  function placementSafeTiles(floorTiles) {
    const floorSet = new Set(floorTiles.map(([col, row]) => `${col},${row}`)); // Used to reject wall-edge tiles where organic cavern triangles can visually overlap a spawned rock.
    return floorTiles.filter(([col, row]) => {
      for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
        for (let colOffset = -1; colOffset <= 1; colOffset++) {
          if (!floorSet.has(`${col + colOffset},${row + rowOffset}`)) return false;
        }
      }
      return true;
    });
  }

  function enemyPlan(floor, rng) {
    if (floor <= 3) return rng() < 0.2 ? ['grehlr'] : [];
    if (floor <= 10) return [];
    const ghoulCount = Math.min(12, 2 + Math.floor((floor - 11) / 10)); // Used to grow pairs into trios and eventually large surrounding groups.
    return Array.from({ length: ghoulCount }, () => 'ghoul');
  }

  function hasReturnLadder(floor) {
    return floor === 1; // Shortcut destinations deliberately do not provide a return route; the utility menu remains the run escape.
  }

  async function synthesizeFloorMapData(mapId) {
    const floorNumber = floorFromMapId(mapId); // Used as the authoritative progression number for this procedural floor.
    if (!floorNumber) return null;
    const config = await loadConfig();
    if (!config) return null;

    const visit = (floorVisitCounts.get(mapId) || 0) + 1;
    floorVisitCounts.set(mapId, visit);
    const visitSeed = `${mapId}_visit_${visit}_${Date.now()}_${Math.floor(Math.random() * 0x7fffffff)}`; // Used so revisiting the same numbered floor rebuilds both geometry and encounters.
    window.CavernGenerator.setGenerationLabel?.(`FLOOR ${floorNumber}`, true); // Used to replace the den-specific loading copy with the current mine floor in huge centered type before the synchronous carve begins.
    const generated = window.CavernGenerator.generateCavernFloor(`${visitSeed}_layout`, { fast: true, cache: false }); // Uses Mine Fast without retaining every regenerated visit in the Den cache.
    const rng = seededRng(`${visitSeed}_content`);
    const tier = tierForFloor(floorNumber); // Used to select ore identity and enemy progression in ten-floor bands.
    const excluded = new Set(generated.exitTiles.map(([col, row]) => `${col},${row}`)); // Used to keep the entrance clear of rocks and enemies.
    const safePlacementFloor = placementSafeTiles(generated.floor); // Used for content only; every generated floor tile remains walkable, but edge-adjacent cells no longer hide rocks inside sculpted geometry.
    window.WildernessCampfire?.relocateForGeneratedMineFloor?.(mapId, safePlacementFloor); // Keeps a persistent underground camp on this regenerated floor, snapping only when its old tile no longer exists.
    const persistedCampfire = window.WildernessCampfire?.serialize?.(); // Used to reserve the restored camp tile from this visit's rocks and enemies.
    if (persistedCampfire?.mapId === mapId) excluded.add(`${Math.floor(persistedCampfire.x)},${Math.floor(persistedCampfire.z)}`);
    const ordinaryRockCount = Math.min(safePlacementFloor.length, Math.max(8, Math.min(24, Math.round(generated.floor.length / 7)))); // Used to make searching for a weak patch a real mining process without sealing the cave.
    const ordinaryTiles = pickSeparatedTiles(rng, safePlacementFloor, excluded, ordinaryRockCount);
    const tierOreKeys = config.oreTierOreKeys?.[tier - 1] || ['copper']; // Used to provide elemental ores rather than impossible alloy-bearing rocks.
    const oreRocks = ordinaryTiles.map(([col, row], index) => {
      const oreKey = index % 3 === 0 ? tierOreKeys[Math.floor(rng() * tierOreKeys.length)] : null; // Used by drops and the masked rock-texture recolor; null denotes an ordinary Stone node.
      return { col, row, oreKind: oreKey || 'stone', oreKey, mineFloor: floorNumber };
    });
    const enemyKinds = enemyPlan(floorNumber, rng); // Used to apply the requested quiet opening followed by increasingly large ghoul groups.
    const enemyExcluded = new Set([...excluded, ...ordinaryTiles.map(([col, row]) => `${col},${row}`)]); // Used to keep a creature from being obscured by a rock even when both choose from the same geometry-safe floor pool.
    const enemyTiles = pickSeparatedTiles(rng, safePlacementFloor, enemyExcluded, enemyKinds.length);
    const mineEnemySpawns = enemyTiles.map(([col, row], index) => ({ col, row, kind: enemyKinds[index] }));
    if (mineEnemySpawns.some(spawn => spawn.kind === 'ghoul')) ghoulBgmFloorIds.add(mapId);
    else ghoulBgmFloorIds.delete(mapId);

    const returnLadder = hasReturnLadder(floorNumber);
    const exits = returnLadder
      ? [{ id: `mine_floor_${floorNumber}_retreat`, label: 'Climb to the ladder room', tiles: [[generated.exitCol, generated.exitRow]], targetMap: SAFE_ROOM_ID, spawnCol: 4, spawnRow: 3 }]
      : []; // Only Floor 1 provides an upward escape; deeper and shortcut-entry floors rely on the utility-menu farm teleport.

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
      mineOreKeys: [...tierOreKeys],
      oreRocks,
      mineEnemySpawns,
      minePlacementSafeTileCount: safePlacementFloor.length,
      disconnectedFloorTilesRemoved: generated.disconnectedFloorTilesRemoved || 0,
      mineCanDescend: floorNumber < config.floorCount,
      mineReturnLadder: returnLadder ? { col: generated.exitCol, row: generated.exitRow } : null,
    };
  }

  async function decorateTownMap(mapData) {
    if (!mapData || mapData.id !== 'map_hobunji_town') return mapData;
    const config = await loadConfig();
    if (!config) return mapData;
    const entrance = config.townEntrance; // Used to place both the visual house-system entryway and its matching transition from one record.
    mapData.buildings ||= [];
    mapData.transitions ||= [];
    let entranceBuilding = mapData.buildings.find(building => building.id === entrance.buildingId); // Used to upgrade pre-existing saves/workspaces from the temporary entrance piece to the supplied authored one.
    if (!entranceBuilding) {
      entranceBuilding = {
        id: entrance.buildingId,
        label: 'Town Mine',
        pieceFile: 'config/pieces/mine_entrance.json',
        gridX: entrance.gridX,
        gridZ: entrance.gridZ,
        footprintW: entrance.footprintW,
        footprintD: entrance.footprintD,
        rotationDeg: entrance.rotationDeg,
        rotation: entrance.rotationDeg,
        doorEntrance: { bboxW: entrance.footprintW, bboxD: entrance.footprintD, cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }], psCells: [] },
      };
      mapData.buildings.push(entranceBuilding);
    }
    entranceBuilding.pieceFile = 'config/pieces/mine_entrance.json';
    entranceBuilding.doorEntrance = { bboxW: entrance.footprintW, bboxD: entrance.footprintD, cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }], psCells: [] };
    if (!mapData.transitions.some(transition => transition.id === 'spot_town_mine')) {
      mapData.transitions.push({ id: 'spot_town_mine', label: 'Enter Town Mine', col: entrance.doorCol, row: entrance.doorRow, targetMapId: SAFE_ROOM_ID, targetSpotId: '', buildingId: entrance.buildingId });
    }
    return mapData;
  }

  function maximumMetalTierForTownValue(townValue) {
    return Math.max(1, Math.min(10, Math.floor(Number(townValue) || 0) + 1));
  }

  function recordFloorReached(floor) {
    const reachedFloor = Math.max(0, Math.min(100, Math.floor(Number(floor) || 0))); // Normalized before comparing so malformed map data can never lower/corrupt progression.
    if (reachedFloor <= progression.deepestFloor) return false;
    progression.deepestFloor = reachedFloor;
    deps?.save?.(); // Reaching a new personal best is progression itself, so persist immediately instead of waiting for an unrelated later save.
    return true;
  }

  function serialize() {
    return { deepestFloor: progression.deepestFloor, unlockedShortcutTiers: [...progression.unlockedShortcutTiers], townValue: progression.townValue, discoveredOreKeys: [...progression.discoveredOreKeys] };
  }

  function restore(saved) {
    const shortcutTiers = Array.isArray(saved?.unlockedShortcutTiers) ? saved.unlockedShortcutTiers : []; // Used to reject malformed save data without losing valid progression.
    progression = {
      deepestFloor: Math.max(0, Math.min(100, Math.floor(Number(saved?.deepestFloor) || 0))),
      unlockedShortcutTiers: [...new Set(shortcutTiers.map(Number).filter(tier => Number.isInteger(tier) && tier >= 1 && tier <= 9))].sort((a, b) => a - b),
      townValue: Math.max(0, Math.floor(Number(saved?.townValue) || 0)),
      discoveredOreKeys: [...new Set((Array.isArray(saved?.discoveredOreKeys) ? saved.discoveredOreKeys : []).filter(key => typeof key === 'string'))],
    };
  }

  function recordHeldOres(oreKeys) {
    let changed = false; // Used to avoid rewriting the member save whenever the Crafting pane merely rerenders.
    for (const oreKey of (oreKeys || [])) {
      if (typeof oreKey !== 'string' || progression.discoveredOreKeys.includes(oreKey)) continue;
      progression.discoveredOreKeys.push(oreKey);
      changed = true;
    }
    if (changed) {
      progression.discoveredOreKeys.sort();
      deps?.save?.();
    }
    return changed;
  }

  function hasDiscoveredOre(oreKey) {
    return progression.discoveredOreKeys.includes(oreKey);
  }

  function rollOreYield(rng = Math.random, bonus = 0) {
    return 1 + (rng() < 0.5 ? 1 : 0) + Math.max(0, Math.floor(Number(bonus) || 0)); // One/two ore at equal odds gives exactly 1.5 base yield before additive Mining bonuses.
  }

  function getTownValue() { return progression.townValue; }

  function bgmTracksForArea(mapId) {
    if (!floorFromMapId(mapId)) return null;
    return ghoulBgmFloorIds.has(mapId) ? [GHOUL_BGM_TRACK] : [];
  }

  function descentChance(source) {
    const enemySource = source === 'enemy'; // Used to select the separately balanced kill roll and its matching Mining perk.
    const perkId = enemySource ? 'collapsingBlows' : 'weakRockSense'; // Used to keep the two discovery upgrades independent.
    const perkRank = window.PerkSystem?.rank?.('mining', perkId) || 0; // Used by mine-floor runtime rolls and mobile-readable diagnostics.
    return enemySource ? 0.16 + perkRank * 0.03 : 0.08 + perkRank * 0.015;
  }

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
      const metalKey = config.ladderMetalKeys[upgrade.tier - 1];
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
    const sceneInfo = floor ? deps?.buildingScenes?.get?.(area) : null; // Used to expose placement-clearance counts without requiring desktop developer tools.
    const snapshot = { area, floor, tier: floor ? tierForFloor(floor) : null, isMine: !!floor, safeRoom: area === SAFE_ROOM_ID, placementSafeTiles: sceneInfo?.minePlacementSafeTileCount ?? null, disconnectedFloorTilesRemoved: sceneInfo?.disconnectedFloorTilesRemoved ?? null, discoveredOreKeys: [...progression.discoveredOreKeys], descentChance: { rock: descentChance('rock'), enemy: descentChance('enemy') } };
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
    bgmTracksForArea,
    descentChance,
    recordHeldOres,
    hasDiscoveredOre,
    rollOreYield,
    hasReturnLadder,
    ladderRows,
    buildLadderTier,
    openLadderPanel,
    makeLadderInteractable,
    farmRootTotem,
    debugSnapshot,
    SAFE_ROOM_ID,
  };
})();
