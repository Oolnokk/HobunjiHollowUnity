(() => {
  'use strict';

  // Experimental Dungeon Test — a single procedurally-generated room+corridor
  // floor (see dungeon-generator.js), reachable from town like any other
  // building interior and playable with a normal character save: real
  // furniture (docs/config/furniture-authored/*.json, same pipeline every
  // house uses), real brick/stone walls (InteriorSceneBuilder's default
  // WallBuilder path — see wallStyle 'dungeon' in interior-scene-builder.js),
  // real bandit enemies (window.BanditCombat, the same system wilderness
  // camps use), and the game's already-global ranged/melee combat (unlocked
  // for this map via game.js's _isCavernBuildingArea). Follows the same
  // window.<Namespace> + init(deps)-free pure-data-plus-config pattern as
  // town-mine.js, minus that module's persistent floor/ladder progression —
  // this is a single test floor, freshly regenerated every visit, with no
  // save state of its own.
  const CONFIG_URL = 'config/dungeon-test.json';
  const MAP_ID = 'map_i_dungeon_test';
  const DUNGEON_BGM_TRACK = { url: 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg' };
  let configPromise = null;
  let visitCount = 0;

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch(CONFIG_URL)
        .then(response => (response.ok ? response.json() : null))
        .catch(error => { console.error('[dungeon-test] config load failed', error); return null; });
    }
    return configPromise;
  }

  function floorFromMapId(mapId) { return mapId === MAP_ID; }

  function seededRng(seedText) {
    if (window.WildernessMapGenerator?.makeRng) return window.WildernessMapGenerator.makeRng(seedText);
    let state = 2166136261;
    for (let index = 0; index < seedText.length; index++) state = Math.imul(state ^ seedText.charCodeAt(index), 16777619) >>> 0;
    return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  }

  function roomTileList(room) {
    const out = [];
    for (let r = room.y; r < room.y + room.h; r++) for (let c = room.x; c < room.x + room.w; c++) out.push([c, r]);
    return out;
  }

  // A tile is safe for placed content only when every neighbor (incl.
  // diagonals) is also floor — keeps chests/lamps/spawns out of corridor
  // mouths and doorway gaps, same reasoning as town-mine.js's own
  // placementSafeTiles.
  function placementSafeTiles(floorSet, tiles) {
    return tiles.filter(([c, r]) => {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!floorSet.has(`${c + dc},${r + dr}`)) return false;
      }
      return true;
    });
  }

  function pickSeparatedTiles(rng, tiles, excluded, count, minSeparation) {
    const candidates = tiles.filter(([c, r]) => !excluded.has(`${c},${r}`));
    const picks = [];
    while (picks.length < count && candidates.length) {
      const index = Math.floor(rng() * candidates.length);
      const tile = candidates.splice(index, 1)[0];
      if (picks.some(([c, r]) => Math.hypot(c - tile[0], r - tile[1]) < (minSeparation ?? 1.6))) continue;
      picks.push(tile);
    }
    return picks;
  }

  async function synthesizeFloorMapData(mapId) {
    if (!floorFromMapId(mapId)) return null;
    visitCount += 1;
    const seed = `${mapId}_visit_${visitCount}_${Date.now()}_${Math.floor(Math.random() * 0x7fffffff)}`;
    const generated = window.DungeonGenerator.generateDungeonFloor(seed);
    const rng = seededRng(seed + '_content');
    const floorSet = new Set(generated.floor.map(([c, r]) => `${c},${r}`));

    const furniture = [];
    let furnId = 0;
    const addFurniture = (itemKey, col, row, rotY) => furniture.push({ id: `f_dtest_${furnId++}`, itemKey, col, row, rotY: rotY || 0 });

    const enemySpawns = [];
    const usedTiles = new Set(generated.exitTiles.map(([c, r]) => `${c},${r}`));
    // itemKey values here must match DECORATIVE_FURNITURE_DEFS[key].itemKey
    // in game.js exactly (the furniture placement/interactable-lookup keys
    // off f.itemKey, not the recipe/def object key).
    const DRESS_ITEM_KEYS = ['crateStackFurniture', 'copperBarrelFurniture'];

    for (const room of generated.rooms) {
      const isEntrance = room === generated.entranceRoom;
      const isTreasure = room === generated.treasureRoom;
      let safe = placementSafeTiles(floorSet, roomTileList(room)).filter(([c, r]) => !usedTiles.has(`${c},${r}`));
      if (!safe.length) continue;

      // A torch in every non-entrance room so the crawl reads clearly —
      // real furniture light (see DECORATIVE_FURNITURE_DEFS.standingLamp's
      // `light` field), not a bespoke lighting rig.
      if (!isEntrance) {
        const [lampTile] = pickSeparatedTiles(rng, safe, new Set(), 1);
        if (lampTile) {
          addFurniture('standingLampFurniture', lampTile[0], lampTile[1]);
          usedTiles.add(`${lampTile[0]},${lampTile[1]}`);
          safe = safe.filter(([c, r]) => !(c === lampTile[0] && r === lampTile[1]));
        }
      }

      if (isTreasure) {
        const chestCount = room.w * room.h >= 30 ? 2 : 1;
        const chestSpots = pickSeparatedTiles(rng, safe, new Set(), chestCount, 2.5);
        for (const [c, r] of chestSpots) {
          addFurniture('dungeonChestFurniture', c, r, Math.floor(rng() * 4) * 90);
          usedTiles.add(`${c},${r}`);
        }
        safe = safe.filter(([c, r]) => !usedTiles.has(`${c},${r}`));
        const [guardSpot] = pickSeparatedTiles(rng, safe, new Set(), 1);
        if (guardSpot) {
          enemySpawns.push({ col: guardSpot[0], row: guardSpot[1], rank: 'lieutenant' });
          usedTiles.add(`${guardSpot[0]},${guardSpot[1]}`);
        }
      } else if (!isEntrance) {
        if (rng() < 0.6) {
          const [dressSpot] = pickSeparatedTiles(rng, safe, new Set(), 1);
          if (dressSpot) {
            addFurniture(DRESS_ITEM_KEYS[Math.floor(rng() * DRESS_ITEM_KEYS.length)], dressSpot[0], dressSpot[1], Math.floor(rng() * 4) * 90);
            usedTiles.add(`${dressSpot[0]},${dressSpot[1]}`);
            safe = safe.filter(([c, r]) => !(c === dressSpot[0] && r === dressSpot[1]));
          }
        }
        const enemyCount = 1 + (rng() < 0.35 ? 1 : 0);
        const enemySpots = pickSeparatedTiles(rng, safe, new Set(), enemyCount, 2);
        for (const [c, r] of enemySpots) {
          enemySpawns.push({ col: c, row: r, rank: 'grunt' });
          usedTiles.add(`${c},${r}`);
        }
      }
    }

    // A very small dungeon (few rooms, or a cramped treasure room whose
    // lamp/chest tiles ate its only safe spots) can otherwise roll zero
    // enemies — guarantee at least one grunt somewhere non-entrance so
    // there's always real combat to test ranged/melee weapons against.
    if (!enemySpawns.length) {
      const fallbackRoom = generated.rooms.find(room => room !== generated.entranceRoom) || generated.entranceRoom;
      const fallbackTiles = roomTileList(fallbackRoom).filter(([c, r]) => floorSet.has(`${c},${r}`) && !usedTiles.has(`${c},${r}`));
      const [spot] = pickSeparatedTiles(rng, fallbackTiles, new Set(), 1);
      if (spot) enemySpawns.push({ col: spot[0], row: spot[1], rank: 'grunt' });
    }

    // Same reasoning for the treasure chest — a cramped treasure room can
    // burn its only safe tile on the torch and leave none for the chest
    // itself. The whole point of this map is a chest to open, so fall back
    // to any unused floor tile in the treasure room (loosening the strict
    // "safe" neighbor check) before giving up.
    if (!furniture.some(f => f.itemKey === 'dungeonChestFurniture')) {
      const fallbackTiles = roomTileList(generated.treasureRoom).filter(([c, r]) => floorSet.has(`${c},${r}`) && !usedTiles.has(`${c},${r}`));
      const [spot] = pickSeparatedTiles(rng, fallbackTiles, new Set(), 1);
      if (spot) {
        addFurniture('dungeonChestFurniture', spot[0], spot[1], Math.floor(rng() * 4) * 90);
        usedTiles.add(`${spot[0]},${spot[1]}`);
      }
    }

    return {
      schema: 'hobunji_building_interior.v1',
      id: mapId,
      name: 'Dungeon Test',
      cols: generated.cols, rows: generated.rows,
      floor: generated.floor,
      colliders: [],
      furniture,
      exits: [{ id: 'dungeon_test_exit', label: 'Back to Town', tiles: generated.exitTiles, targetMap: '', spawnCol: 0, spawnRow: 0 }],
      wallStyle: 'dungeon',
      dungeonEnemySpawns: enemySpawns,
    };
  }

  async function decorateTownMap(mapData) {
    if (!mapData || mapData.id !== 'map_hobunji_town') return mapData;
    const config = await loadConfig();
    if (!config) return mapData;
    const entrance = config.townEntrance;
    mapData.buildings ||= [];
    mapData.transitions ||= [];
    let entranceBuilding = mapData.buildings.find(building => building.id === entrance.buildingId);
    if (!entranceBuilding) {
      entranceBuilding = {
        id: entrance.buildingId,
        label: 'Dungeon Test',
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
    if (!mapData.transitions.some(transition => transition.id === 'spot_dungeon_test')) {
      mapData.transitions.push({ id: 'spot_dungeon_test', label: 'Enter the Dungeon Test', col: entrance.doorCol, row: entrance.doorRow, targetMapId: MAP_ID, targetSpotId: '', buildingId: entrance.buildingId });
    }
    return mapData;
  }

  function bgmTracksForArea(mapId) {
    return floorFromMapId(mapId) ? [DUNGEON_BGM_TRACK] : null;
  }

  window.DungeonTest = {
    loadConfig,
    floorFromMapId,
    synthesizeFloorMapData,
    decorateTownMap,
    bgmTracksForArea,
    MAP_ID,
  };
})();
