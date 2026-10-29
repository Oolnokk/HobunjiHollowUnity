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

  function init(adapters) { deps = adapters; }
  function clone(w) { return JSON.parse(JSON.stringify(w)); }
  function isCell(p) { return !!p && Number.isInteger(p.c) && Number.isInteger(p.r); }
  function points(a, b) {
    if (!isCell(a) || !isCell(b) || (a.c !== b.c && a.r !== b.r)) return [];
    const n = Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
    if (n < 2 || n > 100) return [];
    return Array.from({ length: n + 1 }, (_, i) => cell(a.c + Math.sign(b.c - a.c) * i, a.r + Math.sign(b.r - a.r) * i));
  }
  function seamRecords(pieces) {
    const built = pieces.filter(p => p.stage === 'built');
    const result = [];
    for (let i = 0; i < built.length; i++) for (let j = i + 1; j < built.length; j++) {
      const a = built[i], b = built[j];
      let strip = [];
      if (a.col + a.w === b.col || b.col + b.w === a.col) {
        const right = a.col > b.col ? a : b;
        const start = Math.max(a.row, b.row) * 2, end = Math.min(a.row + a.h, b.row + b.h) * 2;
        for (let r = start; r < end; r++) strip.push(cell(right.col * 2, r));
      } else if (a.row + a.h === b.row || b.row + b.h === a.row) {
        const bottom = a.row > b.row ? a : b;
        const start = Math.max(a.col, b.col) * 2, end = Math.min(a.col + a.w, b.col + b.w) * 2;
        for (let c = start; c < end; c++) strip.push(cell(c, bottom.row * 2));
      }
      if (strip.length < 2) continue; // A one-exterior-tile wing still has two interior cells: one wall cell and one doorway.
      const id = 'join:' + [a.id, b.id].sort().join(':');
      result.push({ id, strip, builtIn: true });
    }
    return result;
  }
  function apply(base, pieces) {
    const floorSet = new Set(base.floorSet);
    const exitSet = new Set(base.exitSet);
    const joins = seamRecords(pieces);
    const segments = [...joins, ...customWalls.map(w => ({ ...w, strip: points(w.a, w.b), builtIn: false }))];
    const blocked = new Set();
    const doorTiles = [];
    const resolved = [];
    for (const segment of segments) {
      const allowed = segment.strip.filter(p => floorSet.has(key(p.c, p.r)) && !exitSet.has(key(p.c, p.r)));
      if (allowed.length < (segment.builtIn ? 2 : 3) || allowed.length !== segment.strip.length) continue;
      const savedDoor = segment.builtIn ? joinDoors[segment.id] : segment.door;
      const savedSlot = Number.isInteger(savedDoor?.slot) ? savedDoor.slot : -1; // Section doors retain their offset when either entire room moves.
      const door = (savedSlot >= 0 && savedSlot < allowed.length ? allowed[savedSlot] : null)
        || allowed.find(p => isCell(savedDoor) && p.c === savedDoor.c && p.r === savedDoor.r)
        || allowed[Math.floor(allowed.length / 2)];
      // A single floor cell is retained as the doorway. The rest of the
      // one-tile strip becomes a genuine wall gap in the walkability grid.
      for (const p of allowed) if (p !== door) blocked.add(key(p.c, p.r));
      doorTiles.push([door.c, door.r]);
      resolved.push({ id: segment.id, builtIn: segment.builtIn, strip: allowed, door });
    }
    for (const k of blocked) floorSet.delete(k);
    latest = { originalFloor: new Set(base.floorSet), exitSet, segments: resolved, floorSet, blocked,
      pieces: pieces.filter(p => p.stage === 'built').map(p => ({ id:p.id, col:p.col, row:p.row, w:p.w, h:p.h })) }; // Room bounds link added walls to the correct movable house section.
    return { ...base, floorSet, exitSet, doorTiles, wallCells: blocked, partitions: resolved };
  }
  function ownerForCell(p) {
    return latest?.pieces?.find(piece => p.c >= piece.col * 2 && p.c < (piece.col + piece.w) * 2
      && p.r >= piece.row * 2 && p.r < (piece.row + piece.h) * 2) || null;
  }
  function canWall(a, b) {
    if (!deps?.canEdit?.() || !latest) return false;
    const run = points(a, b);
    if (run.length < 3 || run.some(p => !latest.originalFloor.has(key(p.c, p.r)) || latest.exitSet.has(key(p.c, p.r)))) return false;
    const occupied = new Set(latest.segments.flatMap(s => s.strip.map(p => key(p.c, p.r))));
    const owner = ownerForCell(a); // Manually subdivided rooms keep their walls when their owning section moves.
    return !!owner && run.every(p => ownerForCell(p)?.id === owner.id && !occupied.has(key(p.c, p.r))
      && deps.canBlockCell?.(p.c, p.r) !== false);
  }
  function canMoveDoor(id, col, row) {
    if (!deps?.canEdit?.() || !latest) return false;
    const segment = latest.segments.find(s => s.id === id);
    return !!segment && segment.strip.some(p => p.c === col && p.r === row)
      && !latest.exitSet.has(key(col, row));
  }
  function armWall() { if (!deps?.canEdit?.()) return false; mode = { type: 'wall' }; firstCorner = null; deps.refresh?.(); return true; }
  function armDoor(id) { if (!deps?.canEdit?.() || !latest?.segments.some(s => s.id === id)) return false; mode = { type: 'door', id }; firstCorner = null; deps.refresh?.(); return true; }
  function cancel() { const hadMode = !!mode; mode = null; firstCorner = null; deps?.refresh?.(); return hadMode; }
  function canTarget(col, row) {
    if (!mode) return false;
    if (mode.type === 'door') return canMoveDoor(mode.id, col, row);
    const p = cell(col, row);
    return firstCorner ? canWall(firstCorner, p) : !!latest?.originalFloor.has(key(col, row))
      && !latest?.exitSet.has(key(col, row)) && deps.canBlockCell?.(col, row) !== false;
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
      customWalls.push({ id: 'wall_' + Math.random().toString(36).slice(2, 11), a, b, ownerPieceId: ownerForCell(a)?.id,
        door: points(a, b)[Math.floor(points(a, b).length / 2)] });
    } else {
      const segment = latest.segments.find(s => s.id === mode.id);
      if (segment.builtIn) joinDoors[segment.id] = { slot: segment.strip.findIndex(p => p.c === col && p.r === row) }; // Saved index, not a world coordinate.
      else {
        const wall = customWalls.find(w => w.id === segment.id);
        if (wall) wall.door = cell(col, row);
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
    const insideOld = p => isCell(p) && p.c >= oldRect.col * 2 && p.c < (oldRect.col + oldRect.w) * 2
      && p.r >= oldRect.row * 2 && p.r < (oldRect.row + oldRect.h) * 2;
    const moved = p => {
      if (!isCell(p)) return p;
      const localC = p.c - oldRect.col * 2, localR = p.r - oldRect.row * 2;
      return clockwise ? cell(newRect.col * 2 + oldRect.h * 2 - 1 - localR, newRect.row * 2 + localC)
        : cell(newRect.col * 2 + localC, newRect.row * 2 + localR);
    }; // Same 2x cell transform as the room's furniture, without changing wall length.
    customWalls.forEach(w => {
      if (w.ownerPieceId !== pieceId && !(w.ownerPieceId == null && insideOld(w.a) && insideOld(w.b))) return;
      w.ownerPieceId = pieceId;
      w.a = moved(w.a); w.b = moved(w.b); w.door = moved(w.door);
    });
  }
  function onPieceRemoved(pieceId) {
    customWalls = customWalls.filter(w => w.ownerPieceId !== pieceId); // Demolishing a wing also removes its custom partitions.
    for (const id of Object.keys(joinDoors)) if (id.split(':').includes(pieceId)) delete joinDoors[id];
  }
  function serialize() { return { walls: clone(customWalls), joinDoors: clone(joinDoors) }; }
  function restore(saved) {
    customWalls = Array.isArray(saved?.walls) ? saved.walls.filter(w => typeof w.id === 'string' && points(w.a, w.b).length >= 3).slice(0, 100).map(clone) : [];
    joinDoors = saved?.joinDoors && typeof saved.joinDoors === 'object' && !Array.isArray(saved.joinDoors) ? clone(saved.joinDoors) : {};
    cancel();
  }
  function debug() {
    return { mode: clone(mode), firstCorner: clone(firstCorner), walls: clone(customWalls), joins: clone(joinDoors),
      segments: latest?.segments.map(s => ({ id: s.id, builtIn: s.builtIn, length: s.strip.length, door: s.door })) || [],
      wallTiles: latest?.blocked.size || 0 };
  }
  window.FarmhouseRoomPlanner = { init, apply, seamRecords, points, armWall, armDoor, cancel, canTarget, confirm, removeWall,
    transformWithPiece, onPieceRemoved, serialize, restore, debug,
    isArmed: () => !!mode, stage: () => firstCorner ? 'second corner' : mode?.type || '',
    segments: () => latest?.segments || [] };
})();
