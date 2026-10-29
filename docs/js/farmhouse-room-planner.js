// Player farmhouse room partitions. Door locations and custom wall segments are
// world-scoped through FarmEditor, while seams are derived from built house pieces.
(() => {
  'use strict';
  const key = (c, r) => c + ',' + r;
  const cell = (c, r) => ({ c, r });
  let customWalls = []; // Authored walls kept in each world's farm layout.
  let joinDoors = {}; // Per-join door positions override their midpoint defaults.
  let mode = null; // Current two-corner wall or one-tile door editing session.
  let firstCorner = null; // First selected wall endpoint, used for the second Action 1.
  let deps = null; // Game adapters for rebuilding, permission and persistence.
  let latest = null; // Most recent base-floor / entrance / generated-seam snapshot.
  let roomOrigins = new Map(); // Stable per-piece interior origins, with inter-room gaps only in the indoor scene.
  let legacyWallSpace = false; // Old branch saves used exterior×2 absolute wall coordinates.

  function init(adapters) { deps = adapters; }
  function clone(w) { return JSON.parse(JSON.stringify(w)); }
  function isCell(p) { return !!p && Number.isInteger(p.c) && Number.isInteger(p.r); }
  function points(a, b) {
    if (!isCell(a) || !isCell(b) || (a.c !== b.c && a.r !== b.r)) return [];
    const n = Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
    if (n < 2 || n > 100) return [];
    return Array.from({ length: n + 1 }, (_, i) => cell(a.c + Math.sign(b.c - a.c) * i, a.r + Math.sign(b.r - a.r) * i));
  }
  function layoutBuiltRooms(pieces) {
    const built = pieces.filter(p => p.stage === 'built');
    const verticalCuts = new Set(); // Global indoor X separation lines; count monotonically so sections can never overlap after shifting.
    const horizontalCuts = new Set(); // Same for Z separation: outdoor geometry is unaffected by either list.
    for (const a of built) for (const b of built) {
      if (a === b) continue;
      if (a.col + a.w === b.col
        && Math.min(a.row + a.h, b.row + b.h) > Math.max(a.row, b.row)) verticalCuts.add(b.col);
      if (a.row + a.h === b.row
        && Math.min(a.col + a.w, b.col + b.w) > Math.max(a.col, b.col)) horizontalCuts.add(b.row);
    }
    const xs = [...verticalCuts].sort((a, b) => a - b), zs = [...horizontalCuts].sort((a, b) => a - b);
    roomOrigins = new Map(built.map(piece => [piece.id, {
      col: piece.col * 2 + xs.filter(x => x <= piece.col).length,
      row: piece.row * 2 + zs.filter(z => z <= piece.row).length,
      w: piece.w * 2, h: piece.h * 2,
    }])); // Every room keeps its full area; all original non-overlap relations remain valid.
    return roomOrigins;
  }
  function roomRect(pieceOrId) {
    const id = typeof pieceOrId === 'string' ? pieceOrId : pieceOrId?.id;
    const rect = roomOrigins.get(id);
    if (rect) return { ...rect };
    const piece = typeof pieceOrId === 'object' ? pieceOrId : null;
    return piece ? { col: piece.col * 2, row: piece.row * 2, w: piece.w * 2, h: piece.h * 2 } : null;
  }
  function seamRecords(pieces) {
    const built = pieces.filter(p => p.stage === 'built');
    const result = [];
    for (let i = 0; i < built.length; i++) for (let j = i + 1; j < built.length; j++) {
      const a = built[i], b = built[j], ar = roomRect(a), br = roomRect(b);
      const zOverlap = Math.min(a.row + a.h, b.row + b.h) - Math.max(a.row, b.row);
      const xOverlap = Math.min(a.col + a.w, b.col + b.w) - Math.max(a.col, b.col);
      let strip = [], edge = null;
      if ((a.col + a.w === b.col || b.col + b.w === a.col) && zOverlap > 0) {
        const left = a.col < b.col ? ar : br, right = a.col < b.col ? br : ar;
        const start = Math.max(left.row, right.row), end = Math.min(left.row + left.h, right.row + right.h);
        const gapStart = left.col + left.w, gapEnd = right.col - 1;
        if (gapStart > gapEnd) continue;
        if (end > start) for (let r = start; r < end; r++) strip.push(cell(gapStart, r));
        else strip.push(cell(gapStart, Math.max(left.row, Math.min(left.row + left.h - 1, right.row + Math.floor(right.h / 2)))));
        edge = { axis: 'x', first: left, second: right, gapStart, gapEnd }; // A dogleg corridor can bridge unequal perpendicular origins.
      } else if ((a.row + a.h === b.row || b.row + b.h === a.row) && xOverlap > 0) {
        const top = a.row < b.row ? ar : br, bottom = a.row < b.row ? br : ar;
        const start = Math.max(top.col, bottom.col), end = Math.min(top.col + top.w, bottom.col + bottom.w);
        const gapStart = top.row + top.h, gapEnd = bottom.row - 1;
        if (gapStart > gapEnd) continue;
        if (end > start) for (let c = start; c < end; c++) strip.push(cell(c, gapStart));
        else strip.push(cell(Math.max(top.col, Math.min(top.col + top.w - 1, bottom.col + Math.floor(bottom.w / 2))), gapStart));
        edge = { axis: 'z', first: top, second: bottom, gapStart, gapEnd };
      }
      if (!strip.length || !edge) continue;
      result.push({ id: 'join:' + [a.id, b.id].sort().join(':'), strip, edge, builtIn: true });
    }
    return result;
  }
  function corridorForJoin(segment, door, blockedFloor) {
    const e = segment.edge;
    if (!e) return null;
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const start = e.axis === 'x'
      ? cell(e.gapStart, clamp(door.r, e.first.row, e.first.row + e.first.h - 1))
      : cell(clamp(door.c, e.first.col, e.first.col + e.first.w - 1), e.gapStart);
    const end = e.axis === 'x'
      ? cell(e.gapEnd, clamp(door.r, e.second.row, e.second.row + e.second.h - 1))
      : cell(clamp(door.c, e.second.col, e.second.col + e.second.w - 1), e.gapEnd);
    const path = (from, to, margin) => {
      const minC = Math.min(from.c, to.c, door.c) - margin, maxC = Math.max(from.c, to.c, door.c) + margin;
      const minR = Math.min(from.r, to.r, door.r) - margin, maxR = Math.max(from.r, to.r, door.r) + margin;
      const queue = [from], visited = new Set([key(from.c, from.r)]), parents = new Map();
      for (let index = 0; index < queue.length; index++) {
        const now = queue[index];
        if (now.c === to.c && now.r === to.r) {
          const result = [now];
          while (parents.has(key(result[0].c, result[0].r))) result.unshift(parents.get(key(result[0].c, result[0].r)));
          return result;
        }
        const neighbors = [[1,0],[-1,0],[0,1],[0,-1]]
          .map(([dc,dr]) => cell(now.c+dc, now.r+dr))
          .sort((x,y) => (Math.abs(x.c-to.c)+Math.abs(x.r-to.r)) - (Math.abs(y.c-to.c)+Math.abs(y.r-to.r)));
        for (const next of neighbors) {
          const k = key(next.c, next.r);
          if (next.c < minC || next.c > maxC || next.r < minR || next.r > maxR || visited.has(k) || blockedFloor.has(k)) continue;
          visited.add(k); parents.set(k, now); queue.push(next);
        }
      }
      return null;
    };
    for (const margin of [2, 8]) {
      const a = path(start, door, margin), b = path(door, end, margin);
      if (a && b) return a.concat(b.slice(1));
    }
    return null; // A blocked layout is reported in debug rather than generating overlapping rooms or floors.
  }
  function protectedInteriorCells(base) {
    const entrances = new Set((base.doors || []).filter(door => isCell(door.enter))
      .map(door => key(door.enter.c, door.enter.r))); // A cut-through wall must never strand the player at the farmhouse entrance.
    const hearths = new Set(); // Existing two-by-one chimney hearth footprints stay usable at section corners.
    for (const hearth of (base.hearths || [])) {
      const cx = Number(hearth.cx), cz = Number(hearth.cz), yaw = Number(hearth.yaw) || 0;
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      for (let r = Math.floor(cz - 1.5); r <= Math.ceil(cz + 1.5); r++) {
        for (let c = Math.floor(cx - 1.5); c <= Math.ceil(cx + 1.5); c++) {
          const dx = c + 0.5 - cx, dz = r + 0.5 - cz;
          const x = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
          const z = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
          if (Math.abs(x) < 1 && Math.abs(z) < 0.5) hearths.add(key(c, r));
        }
      }
    }
    return { entrances, hearths };
  }
  function apply(base, pieces) {
    const built = pieces.filter(p => p.stage === 'built');
    layoutBuiltRooms(built); // Fresh room coordinates supersede the old exterior×2 floor union.
    if (legacyWallSpace) {
      let pending = false; // Additional saved deed rooms may not exist until the final restore pass.
      customWalls.forEach(w => {
        if (w.roomLocalV2) return;
        const owner = built.find(p => p.id === w.ownerPieceId)
          || built.find(p => points(w.a, w.b).every(q => q.c >= p.col * 2 && q.c < (p.col + p.w) * 2 && q.r >= p.row * 2 && q.r < (p.row + p.h) * 2));
        if (!owner) { pending = true; return; }
        w.ownerPieceId = owner.id;
        w.a = cell(w.a.c - owner.col * 2, w.a.r - owner.row * 2);
        w.b = cell(w.b.c - owner.col * 2, w.b.r - owner.row * 2);
        if (isCell(w.door)) w.door = cell(w.door.c - owner.col * 2, w.door.r - owner.row * 2);
        w.roomLocalV2 = true; // Defer other walls without double-converting successfully restored sections.
      });
      legacyWallSpace = pending;
    }
    const floorSet = new Set(base.floorSet);
    const exitSet = new Set(base.exitSet);
    const { entrances, hearths: protectedHearths } = protectedInteriorCells(base);
    const joins = seamRecords(built);
    const manual = customWalls.filter(w => !legacyWallSpace || w.roomLocalV2).map(w => {
      const rect = roomRect(w.ownerPieceId);
      return { ...w, builtIn: false, strip: rect ? points(
        cell(rect.col + w.a.c, rect.row + w.a.r),
        cell(rect.col + w.b.c, rect.row + w.b.r)) : [] };
    });
    const blocked = new Set();
    const doorTiles = [], resolved = [], skipped = [];
    for (const segment of [...joins, ...manual]) {
      const inGap = segment.builtIn; // Join walls occupy NEW space; manual subdivisions intentionally split existing rooms.
      const allowed = segment.strip.filter(p => inGap ? !floorSet.has(key(p.c, p.r)) : floorSet.has(key(p.c, p.r)) && !exitSet.has(key(p.c, p.r)));
      if (allowed.length < (inGap ? 1 : 3) || allowed.length !== segment.strip.length) {
        skipped.push({ id: segment.id, reason: inGap ? 'Joined room boundaries overlap or do not align' : 'Not a continuous interior floor strip' });
        continue;
      }
      const forcedDoorways = inGap ? [] : allowed.filter(p => entrances.has(key(p.c, p.r)));
      if (forcedDoorways.length > 1 || (!inGap && allowed.some(p => protectedHearths.has(key(p.c, p.r))))) {
        skipped.push({ id: segment.id, reason: forcedDoorways.length > 1 ? 'Multiple exterior entrances' : 'Chimney hearth overlaps the wall' });
        continue;
      }
      const savedDoor = inGap ? joinDoors[segment.id] : segment.door;
      const savedSlot = Number.isInteger(savedDoor?.slot) ? savedDoor.slot : -1;
      const rect = inGap ? null : roomRect(segment.ownerPieceId);
      const door = forcedDoorways[0]
        || (savedSlot >= 0 && savedSlot < allowed.length ? allowed[savedSlot] : null)
        || allowed.find(p => isCell(savedDoor) && p.c === savedDoor.c + (rect?.col || 0) && p.r === savedDoor.r + (rect?.row || 0))
        || allowed[Math.floor(allowed.length / 2)];
      if (inGap) {
        const corridor = corridorForJoin(segment, door, base.floorSet); // One full-size-room-to-room walkway; never excavate a room's own tiles.
        if (!corridor) {
          skipped.push({ id: segment.id, reason: 'No unobstructed route through the indoor-only gap' });
          continue;
        }
        corridor.forEach(p => floorSet.add(key(p.c, p.r)));
      } else for (const p of allowed) if (p !== door) blocked.add(key(p.c, p.r));
      doorTiles.push([door.c, door.r]);
      resolved.push({ id: segment.id, builtIn: inGap, strip: allowed, door });
    }
    for (const k of blocked) floorSet.delete(k);
    latest = { originalFloor: new Set(base.floorSet), exitSet, segments: resolved, floorSet, blocked, skipped, entrances, protectedHearths,
      pieces: built.map(p => ({ id:p.id, ...roomRect(p) })) }; // Every owner's bounds now use its indoor offset.
    return { ...base, floorSet, exitSet, doorTiles, wallCells: blocked, partitions: resolved, roomRects: [...roomOrigins.entries()].map(([id, rect]) => ({ id, ...rect })) };
  }
  function ownerForCell(p) {
    return latest?.pieces?.find(piece => p.c >= piece.col && p.c < piece.col + piece.w
      && p.r >= piece.row && p.r < piece.row + piece.h) || null;
  }
  function canWall(a, b) {
    if (!deps?.canEdit?.() || !latest) return false;
    const run = points(a, b);
    if (run.length < 3 || run.some(p => !latest.originalFloor.has(key(p.c, p.r)) || latest.exitSet.has(key(p.c, p.r)))) return false;
    const occupied = new Set(latest.segments.flatMap(s => s.strip.map(p => key(p.c, p.r))));
    const owner = ownerForCell(a); // Manually subdivided rooms keep their walls when their owning section moves.
    return !!owner && run.every(p => ownerForCell(p)?.id === owner.id && !occupied.has(key(p.c, p.r))
      && !latest.protectedHearths.has(key(p.c, p.r)) && deps.canBlockCell?.(p.c, p.r) !== false)
      && run.filter(p => latest.entrances.has(key(p.c, p.r))).length <= 1; // One protected arrival can become the automatic door, never an impassable wall.
  }
  function canMoveDoor(id, col, row) {
    if (!deps?.canEdit?.() || !latest) return false;
    const segment = latest.segments.find(s => s.id === id);
    return !!segment && segment.strip.some(p => p.c === col && p.r === row)
      && !latest.exitSet.has(key(col, row))
      && (!segment.strip.some(p => latest.entrances.has(key(p.c, p.r))) || latest.entrances.has(key(col, row)))
      && deps.canHostDoor?.(col, row) !== false; // Neither a saved furniture footprint nor a person can be displaced by moving a door.
  }
  function armWall() { if (!deps?.canEdit?.()) return false; mode = { type: 'wall' }; firstCorner = null; deps.refresh?.(); return true; }
  function armDoor(id) { if (!deps?.canEdit?.() || !latest?.segments.some(s => s.id === id)) return false; mode = { type: 'door', id }; firstCorner = null; deps.refresh?.(); return true; }
  function cancel() { const hadMode = !!mode; mode = null; firstCorner = null; deps?.refresh?.(); return hadMode; }
  function canTarget(col, row) {
    if (!mode) return false;
    if (mode.type === 'door') return canMoveDoor(mode.id, col, row);
    const p = cell(col, row);
    return firstCorner ? canWall(firstCorner, p) : !!latest?.originalFloor.has(key(col, row))
      && !latest?.exitSet.has(key(col, row)) && !latest?.protectedHearths.has(key(col, row))
      && deps.canBlockCell?.(col, row) !== false;
  }
  function confirm(col, row) {
    if (!mode || !canTarget(col, row)) return { ok: false, message: 'Choose a clear floor tile on the selected wall.' };
    if (mode.type === 'wall' && !firstCorner) {
      firstCorner = cell(col, row);
      deps?.refresh?.();
      return { ok: true, message: 'First wall corner selected. Aim at the second corner and press Action 1.' };
    }
    if (mode.type === 'wall') {
      const a = firstCorner, b = cell(col, row);
      const owner = ownerForCell(a), origin = roomRect(owner?.id);
      customWalls.push({ id: 'wall_' + Math.random().toString(36).slice(2, 11),
        a: cell(a.c - origin.col, a.r - origin.row), b: cell(b.c - origin.col, b.r - origin.row), ownerPieceId: owner.id,
        door: cell(a.c + Math.sign(b.c - a.c) * Math.floor(points(a, b).length / 2) - origin.col,
          a.r + Math.sign(b.r - a.r) * Math.floor(points(a, b).length / 2) - origin.row) });
    } else {
      const segment = latest.segments.find(s => s.id === mode.id);
      if (segment.builtIn) joinDoors[segment.id] = { slot: segment.strip.findIndex(p => p.c === col && p.r === row) }; // Saved index, not a world coordinate.
      else {
        const wall = customWalls.find(w => w.id === segment.id);
        if (wall) { const origin = roomRect(wall.ownerPieceId); wall.door = cell(col - origin.col, row - origin.row); }
      }
    }
    mode = null; firstCorner = null;
    deps?.rebuild?.();
    deps?.save?.();
    deps?.refresh?.();
    return { ok: true, message: 'Farmhouse partition updated.' };
  }
  function removeWall(id) {
    if (!deps?.canEdit?.()) return { ok: false, message: 'Furniture placement permission required.' };
    const index = customWalls.findIndex(w => w.id === id);
    if (index < 0) return { ok: false, message: 'Built-in room walls cannot be removed.' };
    customWalls.splice(index, 1);
    cancel(); deps?.rebuild?.(); deps?.save?.();
    return { ok: true, message: 'Partition removed.' };
  }
  function transformWithPiece(pieceId, oldRect, newRect, clockwise = false) {
    if (!clockwise) return; // Local coordinates follow translation automatically; only rotation rewrites them.
    customWalls.forEach(w => {
      if (w.ownerPieceId !== pieceId) return;
      const rotated = p => isCell(p) ? cell(oldRect.h * 2 - 1 - p.r, p.c) : p;
      w.a = rotated(w.a); w.b = rotated(w.b); w.door = rotated(w.door);
    });
  }
  function onPieceRemoved(pieceId) {
    customWalls = customWalls.filter(w => w.ownerPieceId !== pieceId); // Demolishing a wing also removes its custom partitions.
    for (const id of Object.keys(joinDoors)) if (id.split(':').includes(pieceId)) delete joinDoors[id];
  }
  function serialize() { return { roomSpaceVersion: 2, walls: clone(customWalls), joinDoors: clone(joinDoors) }; }
  function restore(saved) {
    legacyWallSpace = !!saved && saved.roomSpaceVersion !== 2; // One-time migration for walls authored before separate indoor room origins.
    customWalls = Array.isArray(saved?.walls) ? saved.walls.filter(w => typeof w.id === 'string' && points(w.a, w.b).length >= 3).slice(0, 100).map(clone) : [];
    joinDoors = saved?.joinDoors && typeof saved.joinDoors === 'object' && !Array.isArray(saved.joinDoors) ? clone(saved.joinDoors) : {};
    cancel();
  }
  function debug() {
    return { mode: clone(mode), firstCorner: clone(firstCorner), walls: clone(customWalls), joins: clone(joinDoors),
      segments: latest?.segments.map(s => ({ id: s.id, builtIn: s.builtIn, length: s.strip.length, door: s.door })) || [],
      skipped: latest?.skipped || [], protectedEntries: latest?.entrances?.size || 0, protectedHearthTiles: latest?.protectedHearths?.size || 0,
      wallTiles: latest?.blocked.size || 0, roomRects: [...roomOrigins.entries()].map(([id, rect]) => ({ id, ...rect })) };
  }
  window.FarmhouseRoomPlanner = { init, apply, seamRecords, points, armWall, armDoor, cancel, canTarget, confirm, removeWall,
    transformWithPiece, onPieceRemoved, serialize, restore, debug, layoutBuiltRooms, roomRect,
    isArmed: () => !!mode, stage: () => firstCorner ? 'second corner' : mode?.type || '',
    segments: () => latest?.segments || [] };
})();
