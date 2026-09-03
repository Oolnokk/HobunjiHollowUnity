// Procedural room+corridor generation for the experimental Dungeon Test
// (see dungeon-test.js's synthesizeFloorMapData). Deliberately the opposite
// shape from cavern-generator.js's organic SDF-carved tunnels: a classic
// binary-space-partition floorplan of rectangular rooms joined by 1-wide
// corridors, so the resulting floor set renders through the SAME flat
// per-tile floor + buildWallPanelsFromFloorSet/WallBuilder brick-wall path
// every ordinary building interior already uses (see game.js's
// loadBuildingScene, "hobunji_building_interior.v1" branch) instead of the
// carved-cavern-mesh path 'cavern'/'mine' wallStyles take. Pure data
// generation — no THREE.js/scene-graph calls — same discipline as
// cavern-generator.js, deterministic per seed string.
(() => {
  'use strict';

  const AREA_W = 34, AREA_H = 26;
  const MIN_LEAF = 7;   // A leaf never splits smaller than this, so every leaf can still fit a real room with margin.
  const MAX_DEPTH = 3;  // Up to 2^3 = 8 leaf rooms.
  const ROOM_MARGIN = 1; // Tiles of leaf border a carved room always leaves clear, so sibling rooms never share a wall.
  const MIN_ROOM = 4;

  function seededRng(seedText) {
    if (window.WildernessMapGenerator?.makeRng) return window.WildernessMapGenerator.makeRng(seedText);
    let state = 2166136261; // FNV-ish deterministic fallback, mirrors town-mine.js's own seededRng.
    for (let index = 0; index < seedText.length; index++) state = Math.imul(state ^ seedText.charCodeAt(index), 16777619) >>> 0;
    return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  }

  function makeNode(x, y, w, h) { return { x, y, w, h, room: null, left: null, right: null }; }

  function splitNode(node, rng, depth) {
    if (depth <= 0) return;
    const canH = node.h > MIN_LEAF * 2;
    const canV = node.w > MIN_LEAF * 2;
    if (!canH && !canV) return;
    const splitH = canH && canV ? rng() < 0.5 : canH;
    if (splitH) {
      const splitY = MIN_LEAF + Math.floor(rng() * (node.h - MIN_LEAF * 2));
      node.left = makeNode(node.x, node.y, node.w, splitY);
      node.right = makeNode(node.x, node.y + splitY, node.w, node.h - splitY);
    } else {
      const splitX = MIN_LEAF + Math.floor(rng() * (node.w - MIN_LEAF * 2));
      node.left = makeNode(node.x, node.y, splitX, node.h);
      node.right = makeNode(node.x + splitX, node.y, node.w - splitX, node.h);
    }
    splitNode(node.left, rng, depth - 1);
    splitNode(node.right, rng, depth - 1);
  }

  function carveRooms(node, rng, rooms) {
    if (node.left || node.right) {
      if (node.left) carveRooms(node.left, rng, rooms);
      if (node.right) carveRooms(node.right, rng, rooms);
      return;
    }
    const maxW = node.w - ROOM_MARGIN * 2, maxH = node.h - ROOM_MARGIN * 2;
    const rw = Math.max(MIN_ROOM, Math.min(maxW, maxW - Math.floor(rng() * 3)));
    const rh = Math.max(MIN_ROOM, Math.min(maxH, maxH - Math.floor(rng() * 3)));
    const rx = node.x + ROOM_MARGIN + Math.floor(rng() * Math.max(1, maxW - rw + 1));
    const ry = node.y + ROOM_MARGIN + Math.floor(rng() * Math.max(1, maxH - rh + 1));
    node.room = { x: rx, y: ry, w: rw, h: rh };
    rooms.push(node.room);
  }

  function centerOf(room) { return [room.x + (room.w >> 1), room.y + (room.h >> 1)]; }

  function carveH(x0, x1, y, tiles) { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) tiles.add(`${x},${y}`); }
  function carveV(y0, y1, x, tiles) { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) tiles.add(`${x},${y}`); }

  function carveCorridor([ax, ay], [bx, by], rng, tiles) {
    if (rng() < 0.5) { carveH(ax, bx, ay, tiles); carveV(ay, by, bx, tiles); }
    else { carveV(ay, by, ax, tiles); carveH(ax, bx, by, tiles); }
  }

  // Connects siblings while walking back up the BSP tree, guaranteeing the
  // whole floorplan is one connected component (a spanning tree over the
  // rooms) — unlike an organic cavern carve, there is no "isolated pocket"
  // case to detect/strip afterward.
  function connect(node, rng, corridorTiles) {
    if (!node.left && !node.right) return node.room ? centerOf(node.room) : null;
    const a = node.left ? connect(node.left, rng, corridorTiles) : null;
    const b = node.right ? connect(node.right, rng, corridorTiles) : null;
    if (a && b) carveCorridor(a, b, rng, corridorTiles);
    return a || b;
  }

  function generateDungeonFloor(seedText, options = {}) {
    const rng = seededRng(seedText + '_dungeon');
    const root = makeNode(1, 1, AREA_W - 2, AREA_H - 2);
    splitNode(root, rng, options.depth || MAX_DEPTH);
    const rooms = [];
    carveRooms(root, rng, rooms);
    const corridorTiles = new Set();
    connect(root, rng, corridorTiles);

    const roomTileSet = new Set();
    for (const room of rooms) {
      for (let r = room.y; r < room.y + room.h; r++) {
        for (let c = room.x; c < room.x + room.w; c++) roomTileSet.add(`${c},${r}`);
      }
    }
    const floorSet = new Set([...roomTileSet, ...corridorTiles]);

    // Entrance room: topmost-leftmost room (stable, seed-independent tie-break).
    let entranceRoom = rooms[0];
    for (const room of rooms) {
      if (room.x + room.y < entranceRoom.x + entranceRoom.y) entranceRoom = room;
    }

    // Treasure/boss room: the room whose center is farthest (BFS graph
    // distance over the actual floor, not straight-line) from the entrance —
    // guarantees a real crawl through the dungeon before the payoff room,
    // the same "far chamber" shape the mine's Den-Mother nest placement uses.
    const [ecx, ecy] = centerOf(entranceRoom);
    const dist = new Map([[`${ecx},${ecy}`, 0]]);
    const queue = [[ecx, ecy]];
    for (let index = 0; index < queue.length; index++) {
      const [col, row] = queue[index];
      const d = dist.get(`${col},${row}`);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${col + dc},${row + dr}`;
        if (!floorSet.has(nk) || dist.has(nk)) continue;
        dist.set(nk, d + 1);
        queue.push([col + dc, row + dr]);
      }
    }
    let treasureRoom = entranceRoom;
    let bestDist = -1;
    for (const room of rooms) {
      const [cx, cy] = centerOf(room);
      const d = dist.get(`${cx},${cy}`) ?? -1;
      if (d > bestDist) { bestDist = d; treasureRoom = room; }
    }

    // Exit tiles: the entrance room's own BOTTOM edge — always real floor
    // tiles of that room regardless of where its corridor stub ended up
    // landing, same "a few floor tiles near an edge, marked as exit"
    // convention the authored mine safe room uses. Bottom edge specifically
    // (not top) because game.js's buildingSpawnFromExit always re-enters one
    // tile NORTH of the exit tiles' row — a south-edge door puts that
    // "one tile north" square back inside the room instead of outside it.
    const midX = entranceRoom.x + (entranceRoom.w >> 1);
    const exitRow = entranceRoom.y + entranceRoom.h - 1;
    const exitTiles = [[midX - 1, exitRow], [midX, exitRow], [midX + 1, exitRow]]
      .filter(([c, r]) => floorSet.has(`${c},${r}`));
    if (!exitTiles.length) exitTiles.push([midX, exitRow]);

    return {
      cols: AREA_W, rows: AREA_H,
      floor: [...floorSet].map(key => key.split(',').map(Number)),
      roomTileSet, corridorTiles,
      rooms: rooms.map(room => ({ ...room, cx: room.x + (room.w >> 1), cy: room.y + (room.h >> 1) })),
      entranceRoom, treasureRoom,
      exitTiles,
    };
  }

  window.DungeonGenerator = { generateDungeonFloor };
})();
