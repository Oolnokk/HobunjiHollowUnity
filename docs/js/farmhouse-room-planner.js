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
    const offsets = new Map(built.map(p => [p.id, { x: 0, z: 0 }])); // Room-local offsets separate physically joined exterior pieces.
    // Adjacent sections impose a one-cell gap on the axis of their shared
    // exterior wall. Longest-path relaxation is deterministic (positive,
    // monotonic constraints), unlike dependence on house-piece array order.
    for (let pass = 0; pass < built.length; pass++) {
      let changed = false;
      for (const left of built) for (const right of built) {
        if (left === right) continue;
        const xOverlap = Math.min(left.col + left.w, right.col + right.w) - Math.max(left.col, right.col);
        const zOverlap = Math.min(left.row + left.h, right.row + right.h) - Math.max(left.row, right.row);
        if (left.col + left.w === right.col && zOverlap > 0) {
          const dest = offsets.get(right.id), candidate = offsets.get(left.id).x + 1;
          if (candidate > dest.x) { dest.x = candidate; changed = true; }
        }
        if (left.row + left.h === right.row && xOverlap > 0) {
          const dest = offsets.get(right.id), candidate = offsets.get(left.id).z + 1;
          if (candidate > dest.z) { dest.z = candidate; changed = true; }
        }
      }
      if (!changed) break;
    }
    roomOrigins = new Map(built.map(piece => [piece.id, {
      col: piece.col * 2 + offsets.get(piece.id).x,
      row: piece.row * 2 + offsets.get(piece.id).z,
      w: piece.w * 2, h: piece.h * 2,
    }])); // Exterior coordinates and footprints remain untouched.
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
      const a = built[i], b = built[j];
      const ar = roomRect(a), br = roomRect(b);
      let strip = [], bridge = [];
      const zOverlap = Math.min(a.row + a.h, b.row + b.h) - Math.max(a.row, b.row);
      const xOverlap = Math.min(a.col + a.w, b.col + b.w) - Math.max(a.col, b.col);
      if ((a.col + a.w === b.col || b.col + b.w === a.col) && zOverlap > 0) {
        const left = a.col < b.col ? ar : br, right = a.col < b.col ? br : ar;
        const start = Math.max(left.row, right.row), end = Math.min(left.row + left.h, right.row + right.h);
        const gapStart = left.col + left.w, gapEnd = right.col - 1;
        if (gapStart > gapEnd) continue;
        for (let r = start; r < end; r++) strip.push(cell(gapStart, r));
        for (let c = gapStart; c <= gapEnd; c++) bridge.push(cell(c, start + Math.floor((end - start) / 2)));
      } else if ((a.row + a.h === b.row || b.row + b.h === a.row) && xOverlap > 0) {
        const top = a.row < b.row ? ar : br, bottom = a.row < b.row ? br : ar;
        const start = Math.max(top.col, bottom.col), end = Math.min(top.col + top.w, bottom.col + bottom.w);
        const gapStart = top.row + top.h, gapEnd = bottom.row - 1;
        if (gapStart > gapEnd) continue;
        for (let c = start; c < end; c++) strip.push(cell(c, gapStart));
        for (let r = gapStart; r <= gapEnd; r++) bridge.push(cell(start + Math.floor((end - start) / 2), r));
      }
      if (!strip.length) continue;
      const id = 'join:' + [a.id, b.id].sort().join(':');
      result.push({ id, strip, bridge, builtIn: true });
    }
    return result;
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
      customWalls.forEach(w => {
        const owner = built.find(p => p.id === w.ownerPieceId)
          || built.find(p => points(w.a, w.b).every(q => q.c >= p.col * 2 && q.c < (p.col + p.w) * 2 && q.r >= p.row * 2 && q.r < (p.row + p.h) * 2));
        if (!owner) return;
        w.ownerPieceId = owner.id;
        w.a = cell(w.a.c - owner.col * 2, w.a.r - owner.row * 2);
        w.b = cell(w.b.c - owner.col * 2, w.b.r - owner.row * 2);
        if (isCell(w.door)) w.door = cell(w.door.c - owner.col * 2, w.door.r - owner.row * 2);
      });
      legacyWallSpace = false; // Migration happens once; future saves use room-local wall coordinates.
    }
    const floorSet = new Set(base.floorSet);
    const exitSet = new Set(base.exitSet);
    const { entrances, hearths: protectedHearths } = protectedInteriorCells(base);
    const joins = seamRecords(built);
    const manual = customWalls.map(w => {
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
        const doorSlot = allowed.findIndex(p => p === door);
        // The only floor in the one-tile separation is the door threshold.
        // A wider fallback gap receives a single-tile-wide corridor, never
        // a duplicate doorway or a reduced room footprint.
        for (const p of segment.bridge || []) {
          const bridgePoint = segment.strip[0].c === segment.strip[segment.strip.length - 1].c
            ? cell(p.c, door.r) : cell(door.c, p.r);
          floorSet.add(key(bridgePoint.c, bridgePoint.r));
        }
        floorSet.add(key(door.c, door.r));
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
