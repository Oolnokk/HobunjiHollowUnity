(() => {
  'use strict';

  // Experimental Dungeon Test — a single procedurally-generated room+corridor
  // floor (see dungeon-generator.js), playable with a normal character save:
  // real furniture (docs/config/furniture-authored/*.json, same pipeline
  // every house uses), real brick/stone walls (InteriorSceneBuilder's
  // default WallBuilder path — see wallStyle 'dungeon' in
  // interior-scene-builder.js), and the game's already-global ranged/melee
  // combat (unlocked for this map via game.js's _isCavernBuildingArea).
  // Follows the same window.<Namespace> + init(deps)-free pure-data pattern
  // as town-mine.js, minus that module's persistent floor/ladder
  // progression — this is a single test floor, freshly regenerated every
  // visit, with no save state of its own.
  //
  // The puzzle structure: a critical path from the entrance room to the
  // treasure room is computed over dungeon-generator.js's room graph, a
  // short chasm is carved into one of that path's corridor legs (the
  // "disruption"), and the "solution" is a wall rune that must be shot with
  // a ranged weapon (not walked up to and pressed — see game.js's
  // dungeonRuneFurniture wiring into window.RangedWeapons.registerWorldTarget)
  // from the near side, which then drops a real climbable rope (see the
  // Dungeon Test's use of window.ClimbSystem's new rope target type) across
  // the gap. A second, visually identical decoy rune sits elsewhere off the
  // path — shooting it instead summons a couple of ghostly, semi-transparent
  // Ghouls next to the player rather than solving anything, so the
  // supernatural threat here is never pre-placed, only ever triggered by the
  // player's own wrong guess.
  //
  // A second, independent puzzle room (the "pit chamber") sits elsewhere on
  // the critical path: its whole floor (minus a safe landing tile on each
  // side) is animated stepping-stone pillars, each rising and sinking on
  // its own phase offset — a real fall (dungeons are small, enclosed
  // spaces, so this can afford genuine per-frame Z-axis gravity the open
  // overworld never could) drops the player onto a lower sublevel the
  // instant they're standing on a sunk pillar, from which a fall-recovery
  // ladder (game.js wires this up as an omnidirectional, endsFall-flagged
  // window.ClimbSystem rope) climbs them back to the entry side to try
  // again. See findPitChamber below and game.js's pit chamber wiring
  // (updateDungeonFalling, the sublevel floor patch, the pillar meshes).
  //
  // No set in-world location yet — eventually this will be found out in the
  // wilderness or roll in as a mine-floor replacement, but that placement
  // isn't decided. Until then it's reached only via the Dev Mode settings
  // panel's "Enter Dungeon Test" button (game.js wires
  // #devEnterDungeonTestBtn straight to enterBuilding(MAP_ID)/exitBuilding())
  // for fast iteration — no decorateTownMap/entrance-building step here.
  const MAP_ID = 'map_i_dungeon_test';
  const DUNGEON_BGM_TRACK = { url: 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg' };
  let visitCount = 0;

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

  // BFS over dungeon-generator.js's room adjacency graph (a spanning tree —
  // there is exactly one simple path between any two rooms) to find the
  // critical path from the entrance to the treasure room, as both the
  // ordered room sequence and the ordered edges connecting them.
  function findCriticalPath(generated) {
    const { entranceRoom, treasureRoom, rooms, edges } = generated;
    const adjacency = new Map(rooms.map(room => [room, []]));
    for (const edge of edges) {
      adjacency.get(edge.roomA)?.push({ to: edge.roomB, edge });
      adjacency.get(edge.roomB)?.push({ to: edge.roomA, edge });
    }
    const cameFrom = new Map([[entranceRoom, null]]);
    const queue = [entranceRoom];
    for (let index = 0; index < queue.length; index++) {
      const room = queue[index];
      if (room === treasureRoom) break;
      for (const { to, edge } of adjacency.get(room) || []) {
        if (cameFrom.has(to)) continue;
        cameFrom.set(to, { from: room, edge });
        queue.push(to);
      }
    }
    const pathRooms = [];
    const pathEdges = [];
    let current = treasureRoom;
    while (current) {
      pathRooms.push(current);
      const step = cameFrom.get(current);
      if (!step) break;
      pathEdges.push(step.edge);
      current = step.from;
    }
    pathRooms.reverse();
    pathEdges.reverse();
    return { pathRooms, pathEdges };
  }

  // A leg runs from one room's center to another's, so its own two ends
  // (index 0 and index length-1) always sit inside a room — leg[0] in
  // whichever room "point" the corridor started from, leg[length-1] in the
  // other. The chasm goes in whatever pure-corridor (non-room) island sits
  // between those two room interiors: 2 gap tiles when the island is long
  // enough, fewer (down to a single tile) when it's short, or no chasm at
  // all when two rooms turn out to sit directly against each other with no
  // real corridor between them (island length 0). The tiles flanking the
  // gap (ropeBase/ropeTip) are just whatever comes right before/after it on
  // the leg — ordinary floor, room-interior or corridor either way.
  function findChasmOnLeg(leg, roomTileSet) {
    let islandStart = -1, islandEnd = -1;
    for (let i = 0; i < leg.length; i++) {
      if (roomTileSet.has(`${leg[i][0]},${leg[i][1]}`)) continue;
      if (islandStart === -1) islandStart = i;
      islandEnd = i;
    }
    if (islandStart === -1) return null;
    const islandLen = islandEnd - islandStart + 1;
    const gapLen = Math.min(2, islandLen);
    const gapStart = islandStart + Math.floor((islandLen - gapLen) / 2);
    const ropeBaseIndex = gapStart - 1;
    const ropeTipIndex = gapStart + gapLen;
    if (ropeBaseIndex < 0 || ropeTipIndex >= leg.length) return null;
    return {
      gapTiles: leg.slice(gapStart, gapStart + gapLen),
      ropeBase: leg[ropeBaseIndex],
      ropeTip: leg[ropeTipIndex],
    };
  }

  // Tries an edge's two corridor legs (whichever is long enough first),
  // then the whole path's edges middle-out — a disruption roughly halfway
  // along the crawl reads better than one immediately at the entrance or
  // immediately before the treasure room, but any valid edge is fine.
  function pickChasm(pathEdges, roomTileSet) {
    const mid = (pathEdges.length - 1) / 2;
    const ordered = pathEdges
      .map((edge, index) => ({ edge, distanceFromMid: Math.abs(index - mid) }))
      .sort((a, b) => a.distanceFromMid - b.distanceFromMid)
      .map(entry => entry.edge);
    for (const edge of ordered) {
      for (const leg of edge.legs) {
        const found = findChasmOnLeg(leg, roomTileSet);
        if (found) return found;
      }
    }
    return null;
  }

  function roomContainsTile(room, [c, r]) {
    return c >= room.x && c < room.x + room.w && r >= room.y && r < room.y + room.h;
  }

  function manhattan([c1, r1], [c2, r2]) {
    return Math.abs(c1 - c2) + Math.abs(r1 - r2);
  }

  // Picks the largest path room not already spoken for by the chasm/rune
  // puzzle (or the entrance/treasure rooms), lays a safe landing tile on
  // the side facing each of its path neighbors, and turns every other
  // interior tile into an oscillating pillar. Needs real floor space to be
  // worth it — a cramped room would leave no meaningful gap between the two
  // landings — so this can legitimately come back null on a small layout,
  // same graceful-degradation shape as pickChasm.
  function findPitChamber(generated, pathRooms, excludedTiles, rng) {
    const excludedRooms = new Set([generated.entranceRoom, generated.treasureRoom]);
    for (const tile of excludedTiles) {
      for (const room of pathRooms) { if (roomContainsTile(room, tile)) excludedRooms.add(room); }
    }
    let best = null, bestArea = 0, bestIndex = -1;
    for (let index = 0; index < pathRooms.length; index++) {
      const room = pathRooms[index];
      if (excludedRooms.has(room)) continue;
      const area = room.w * room.h;
      if (room.w < 4 || room.h < 4 || area < 16 || area <= bestArea) continue;
      best = room; bestArea = area; bestIndex = index;
    }
    if (!best) return null;

    const prevRoom = pathRooms[bestIndex - 1];
    const nextRoom = pathRooms[bestIndex + 1];
    const interior = roomTileList(best);
    const nearestTo = (targetRoom) => {
      if (!targetRoom) return interior[0];
      const target = [targetRoom.cx, targetRoom.cy];
      return interior.reduce((closest, tile) => manhattan(tile, target) < manhattan(closest, target) ? tile : closest, interior[0]);
    };
    const entryLanding = nearestTo(prevRoom);
    let exitLanding = nearestTo(nextRoom);
    if (exitLanding[0] === entryLanding[0] && exitLanding[1] === entryLanding[1]) {
      // Degenerate case (e.g. this room has no "next" neighbor because it's
      // adjacent to the treasure room itself) — fall back to the tile
      // farthest from the entry landing so there's still a real crossing.
      exitLanding = interior.reduce((farthest, tile) => manhattan(tile, entryLanding) > manhattan(farthest, entryLanding) ? tile : farthest, interior[0]);
    }
    const landingKeys = new Set([`${entryLanding[0]},${entryLanding[1]}`, `${exitLanding[0]},${exitLanding[1]}`]);
    const pillars = interior
      .filter(([c, r]) => !landingKeys.has(`${c},${r}`))
      .map(([col, row]) => ({ col, row, phase: rng() * Math.PI * 2 }));
    if (!pillars.length) return null;

    return { room: best, entryLanding, exitLanding, pillars };
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
    const addFurniture = (itemKey, col, row, rotY, extra) => {
      const record = { id: `f_dtest_${furnId++}`, itemKey, col, row, rotY: rotY || 0 };
      if (extra) Object.assign(record, extra);
      furniture.push(record);
      return record;
    };

    const usedTiles = new Set(generated.exitTiles.map(([c, r]) => `${c},${r}`));
    let colliders = [];
    const puzzleTiles = []; // Rooms touching any of these are off-limits to findPitChamber below.

    // ── The chasm/rune/rope puzzle (disruption -> solution) ──────────────
    const { pathRooms, pathEdges } = findCriticalPath(generated);
    const chasm = pathEdges.length ? pickChasm(pathEdges, generated.roomTileSet) : null;
    if (chasm) {
      // Gap tiles stay real floor (mapData.floor) on purpose — removing
      // them would make the wall-panel builder treat the gap's edges as
      // exterior boundaries and seal it behind brick walls, which would
      // block both sightline and shots across it. Impassable-but-visible
      // is done the same way an authored map blocks a tile without a wall:
      // mapData.colliders (see game.js's collider pass right after the
      // floor fill) — game.js also drops a dark pit overlay mesh on each
      // one when it places the real rune, and removes both the collider
      // and the overlay once that rune is shot.
      colliders = chasm.gapTiles.map(([c, r]) => [c, r]);
      for (const [c, r] of chasm.gapTiles) usedTiles.add(`${c},${r}`);
      usedTiles.add(`${chasm.ropeBase[0]},${chasm.ropeBase[1]}`);
      usedTiles.add(`${chasm.ropeTip[0]},${chasm.ropeTip[1]}`);

      // The real rune sits a couple of tiles past the rope's far anchor,
      // still colinear with the corridor's own axis, so a shot fired
      // straight down the hallway from the near side clears the gap and
      // lands on it — see game.js's dungeonRuneFurniture wiring.
      const axisX = Math.sign(chasm.ropeTip[0] - chasm.ropeBase[0]);
      const axisY = Math.sign(chasm.ropeTip[1] - chasm.ropeBase[1]);
      let realRuneTile = [chasm.ropeTip[0] + axisX * 2, chasm.ropeTip[1] + axisY * 2];
      if (!floorSet.has(`${realRuneTile[0]},${realRuneTile[1]}`)) realRuneTile = [chasm.ropeTip[0] + axisX, chasm.ropeTip[1] + axisY];
      if (!floorSet.has(`${realRuneTile[0]},${realRuneTile[1]}`)) realRuneTile = chasm.ropeTip;
      usedTiles.add(`${realRuneTile[0]},${realRuneTile[1]}`);
      addFurniture('dungeonRuneFurniture', realRuneTile[0], realRuneTile[1], Math.atan2(-axisY, -axisX) * 180 / Math.PI, {
        isDecoy: false,
        gateTiles: chasm.gapTiles,
        ropeBase: chasm.ropeBase,
        ropeTip: chasm.ropeTip,
      });
      puzzleTiles.push(...chasm.gapTiles, chasm.ropeBase, chasm.ropeTip, realRuneTile);

      // The decoy lives off the critical path entirely when a real branch
      // room exists (the "wrong side room" a curious player wanders into),
      // falling back to the entrance room — still visible early, still a
      // real wrong guess — when the layout has no branch at all.
      const offPathRooms = generated.rooms.filter(room => !pathRooms.includes(room) && room !== generated.entranceRoom);
      const decoyRoom = offPathRooms.length ? offPathRooms[Math.floor(rng() * offPathRooms.length)] : generated.entranceRoom;
      const decoySafe = placementSafeTiles(floorSet, roomTileList(decoyRoom)).filter(([c, r]) => !usedTiles.has(`${c},${r}`));
      const decoyPool = decoySafe.length ? decoySafe : roomTileList(decoyRoom).filter(([c, r]) => floorSet.has(`${c},${r}`) && !usedTiles.has(`${c},${r}`));
      const [decoyTile] = pickSeparatedTiles(rng, decoyPool, new Set(), 1);
      if (decoyTile) {
        usedTiles.add(`${decoyTile[0]},${decoyTile[1]}`);
        addFurniture('dungeonRuneFurniture', decoyTile[0], decoyTile[1], Math.floor(rng() * 4) * 90, { isDecoy: true });
        puzzleTiles.push(decoyTile);
      }
    }

    // ── The pit chamber puzzle (independent of the chasm/rune above) ────
    const pitChamber = findPitChamber(generated, pathRooms, puzzleTiles, rng);
    let pitChamberData = null;
    if (pitChamber) {
      usedTiles.add(`${pitChamber.entryLanding[0]},${pitChamber.entryLanding[1]}`);
      usedTiles.add(`${pitChamber.exitLanding[0]},${pitChamber.exitLanding[1]}`);
      for (const pillar of pitChamber.pillars) usedTiles.add(`${pillar.col},${pillar.row}`);
      pitChamberData = {
        sublevelY: -2.0,
        entryLanding: pitChamber.entryLanding,
        exitLanding: pitChamber.exitLanding,
        pillars: pitChamber.pillars,
      };
    }

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
      } else if (!isEntrance && rng() < 0.6) {
        const [dressSpot] = pickSeparatedTiles(rng, safe, new Set(), 1);
        if (dressSpot) {
          addFurniture(DRESS_ITEM_KEYS[Math.floor(rng() * DRESS_ITEM_KEYS.length)], dressSpot[0], dressSpot[1], Math.floor(rng() * 4) * 90);
          usedTiles.add(`${dressSpot[0]},${dressSpot[1]}`);
        }
      }
    }

    // Same reasoning as the puzzle placements above — a cramped treasure
    // room can burn its only safe tile on the torch and leave none for the
    // chest itself. The whole point of this map is a chest to open, so
    // fall back to any unused floor tile in the treasure room (loosening
    // the strict "safe" neighbor check) before giving up.
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
      colliders,
      furniture,
      exits: [{ id: 'dungeon_test_exit', label: 'Back to Town', tiles: generated.exitTiles, targetMap: '', spawnCol: 0, spawnRow: 0 }],
      wallStyle: 'dungeon',
      pitChamber: pitChamberData,
    };
  }

  function bgmTracksForArea(mapId) {
    return floorFromMapId(mapId) ? [DUNGEON_BGM_TRACK] : null;
  }

  window.DungeonTest = {
    floorFromMapId,
    synthesizeFloorMapData,
    bgmTracksForArea,
    MAP_ID,
  };
})();
