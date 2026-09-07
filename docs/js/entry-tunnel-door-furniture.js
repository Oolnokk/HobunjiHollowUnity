// Adds the authored door furniture to every HousePieceGen entry-tunnel tile.
// Supports both the live-generated 1x1 tunnel path used by modular farm-house
// entrances and the baked footprint.extensions.entryTunnels path used by town
// buildings, barns, and other authored house pieces.
(() => {
  'use strict';

  const FURNITURE_KEY = 'door'; // Used to load the uploaded door through AuthoredFurniture.
  const DOOR_OBJECT_NAME = 'entry_tunnel_door'; // Used as the stable name/prefix for generated and authored entry-tunnel doors.
  const SIDE_ROTATION_DEG = Object.freeze({ south: 0, west: 90, north: 180, east: 270 }); // Mirrors HousePieceGen's entry-tunnel orientation map.
  const PLACEMENT = Object.freeze({ x: 0.5, y: 0, z: 0.5 }); // Used to center the authored 1x1 door inside each entry-tunnel tile.
  const CARDINAL_SIDES = new Set(Object.keys(SIDE_ROTATION_DEG)); // Used to reject non-wall extensionFace metadata while resolving authored tunnel direction.

  function ensureUserData(object) {
    if (!object) return null;
    object.userData = object.userData || {};
    return object.userData;
  }

  function status(target, value, details = null) {
    const data = ensureUserData(target); // Used to expose attachment state to the in-game debug inspector.
    if (!data) return;
    data.entryTunnelDoorKey = FURNITURE_KEY;
    data.entryTunnelDoorStatus = value;
    if (details) Object.assign(data, details);
  }

  function sideRotationDeg(side) {
    return SIDE_ROTATION_DEG[String(side || 'south').toLowerCase()] ?? 0;
  }

  function normalizePiece(piece) {
    return piece?.currentPiece || piece || null;
  }

  function tileKey(cell) {
    return `${Number(cell?.x)},${Number(cell?.y)}`;
  }

  function entryTunnelCells(piece) {
    const src = normalizePiece(piece);
    const ext = src?.footprint?.extensions || {};
    const seen = new Set(); // Used to avoid duplicate door placement when a tile appears in both regular/tall extension arrays.
    const cells = [];
    for (const cell of [...(Array.isArray(ext.entryTunnels) ? ext.entryTunnels : []), ...(Array.isArray(ext.tallEntryTunnels) ? ext.tallEntryTunnels : [])]) {
      const x = Number(cell?.x), y = Number(cell?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ x, y });
    }
    return cells;
  }

  function connectedComponents(cells) {
    const byKey = new Map(cells.map(cell => [tileKey(cell), cell])); // Used to group multi-tile authored tunnels so every tile inherits the same doorway-facing side.
    const unseen = new Set(byKey.keys());
    const components = [];
    while (unseen.size) {
      const first = unseen.values().next().value;
      unseen.delete(first);
      const queue = [byKey.get(first)];
      const component = [];
      while (queue.length) {
        const cell = queue.shift();
        component.push(cell);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const key = `${cell.x + dx},${cell.y + dy}`;
          if (!unseen.has(key)) continue;
          unseen.delete(key);
          queue.push(byKey.get(key));
        }
      }
      components.push(component);
    }
    return components;
  }

  function fallbackComponentSide(piece, component) {
    const core = normalizePiece(piece)?.footprint?.cells || [];
    if (!core.length || !component.length) return 'south';
    const minX = Math.min(...core.map(cell => Number(cell.x)));
    const maxX = Math.max(...core.map(cell => Number(cell.x)));
    const minY = Math.min(...core.map(cell => Number(cell.y)));
    const maxY = Math.max(...core.map(cell => Number(cell.y)));
    const scores = { north: 0, south: 0, west: 0, east: 0 }; // Used when older authored pieces lack exteriorEntryOpening metadata.
    for (const cell of component) {
      if (cell.y < minY) scores.north += minY - cell.y;
      if (cell.y > maxY) scores.south += cell.y - maxY;
      if (cell.x < minX) scores.west += minX - cell.x;
      if (cell.x > maxX) scores.east += cell.x - maxX;
    }
    return Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0] || 'south';
  }

  function componentSide(piece, component) {
    const src = normalizePiece(piece);
    const componentKeys = new Set(component.map(tileKey)); // Used to associate generated opening-frame face metadata with its authored extension run.
    for (const face of (src?.base?.faces || [])) {
      const side = String(face?.extensionFace || '').toLowerCase();
      if (face?.tag !== 'entryTunnel' || !face?.exteriorEntryOpening || !CARDINAL_SIDES.has(side)) continue;
      if (!face.sourceTile || componentKeys.has(tileKey(face.sourceTile))) return side;
    }
    return fallbackComponentSide(src, component);
  }

  function rotateAuthoredTileCenter(piece, bldgMinC, bldgMinR, cell, opts = {}) {
    const src = normalizePiece(piece);
    const core = src?.footprint?.cells || [];
    const gc = Math.floor((Number(src?.gridSize) || 18) / 2);
    const minCX = core.length ? Math.min(...core.map(item => Number(item.x))) : gc;
    const minCZ = core.length ? Math.min(...core.map(item => Number(item.y))) : gc;
    const maxCX = core.length ? Math.max(...core.map(item => Number(item.x))) : gc;
    const maxCZ = core.length ? Math.max(...core.map(item => Number(item.y))) : gc;
    let x = Number(bldgMinC) + (Number(cell.x) - minCX) + PLACEMENT.x;
    let z = Number(bldgMinR) + (Number(cell.y) - minCZ) + PLACEMENT.z;
    const rotationDeg = Number(opts?.rotationDeg) || 0; // Used to match HousePieceGen.buildGroupFromPiece's authored-building rotation.
    if (rotationDeg) {
      const rotationRad = -rotationDeg * Math.PI / 180;
      const cosR = Math.cos(rotationRad), sinR = Math.sin(rotationRad);
      const footprintW = maxCX - minCX + 1, footprintD = maxCZ - minCZ + 1;
      const pivotX = Number(bldgMinC) + footprintW / 2;
      const pivotZ = Number(bldgMinR) + footprintD / 2;
      const txAdj = rotationDeg === 90 || rotationDeg === 270 ? (footprintD - footprintW) / 2 : 0;
      const tzAdj = rotationDeg === 90 || rotationDeg === 270 ? (footprintW - footprintD) / 2 : 0;
      const px = x - pivotX, pz = z - pivotZ;
      x = px * cosR - pz * sinR + pivotX + txAdj;
      z = px * sinR + pz * cosR + pivotZ + tzAdj;
    }
    return { x, z, rotationDeg };
  }

  function authoredPlacements(piece, bldgMinC, bldgMinR, opts = {}) {
    const cells = entryTunnelCells(piece);
    if (!cells.length) return [];
    const sideByTile = new Map(); // Used to preserve separate facing directions when one authored piece contains multiple disconnected entry tunnels.
    for (const component of connectedComponents(cells)) {
      const side = componentSide(piece, component);
      component.forEach(cell => sideByTile.set(tileKey(cell), side));
    }
    const elevationY = Number.isFinite(Number(opts?.elevationY)) ? Number(opts.elevationY) : 0;
    return cells.map(cell => {
      const side = sideByTile.get(tileKey(cell)) || 'south';
      const transformed = rotateAuthoredTileCenter(piece, bldgMinC, bldgMinR, cell, opts);
      const worldRotationDeg = (sideRotationDeg(side) + transformed.rotationDeg) % 360; // Used to rotate the door with both its tunnel direction and the whole authored building.
      return {
        key: `authored:${cell.x},${cell.y}`,
        name: `${DOOR_OBJECT_NAME}_${cell.x}_${cell.y}`,
        x: transformed.x,
        y: elevationY + PLACEMENT.y,
        z: transformed.z,
        rotationDeg: worldRotationDeg,
        side,
        localTile: { x: cell.x, y: cell.y },
        worldTile: { col: Math.floor(transformed.x), row: Math.floor(transformed.z) },
      };
    });
  }

  function findDoors(target) {
    return (target?.children || []).filter(child => child?.userData?.entryTunnelDoorFurniture === true);
  }

  function findDoor(target, placementKey = null) {
    if (!target) return null;
    if (placementKey) return findDoors(target).find(child => child.userData?.entryTunnelDoorPlacementKey === placementKey) || null;
    if (typeof target.getObjectByName === 'function') return target.getObjectByName(DOOR_OBJECT_NAME) || findDoors(target)[0] || null;
    return findDoors(target)[0] || null;
  }

  function attachResolvedPlacement(target, authoredData, placement) {
    const existing = findDoor(target, placement.key); // Used to make async/cached attachment idempotent per authored tunnel tile.
    if (existing) return existing;

    const runtime = window.AuthoredFurniture; // Used to build the authored door mesh group.
    if (!target || !runtime?.buildGroup || !authoredData?.parts?.length) {
      status(target, authoredData ? 'runtime-unavailable' : 'missing-data');
      return null;
    }

    const door = runtime.buildGroup(authoredData, 0x8b6540); // Used as the visible authored door inside this tunnel tile.
    if (!door) {
      status(target, 'build-failed');
      return null;
    }

    door.name = placement.name || DOOR_OBJECT_NAME;
    door.position.set(Number(placement.x), Number(placement.y), Number(placement.z));
    door.rotation.y = -(Number(placement.rotationDeg) || 0) * Math.PI / 180;
    Object.assign(ensureUserData(door), {
      entryTunnelDoorFurniture: true,
      entryTunnelDoorPlacementKey: placement.key,
      furnitureKey: FURNITURE_KEY,
      entryTunnelSide: placement.side,
      entryTunnelTile: placement.worldTile || null,
      entryTunnelLocalTile: placement.localTile || null,
    });
    target.add(door);
    const doors = findDoors(target); // Used by mobile-safe debug output to prove multi-tile authored tunnels received every requested door.
    status(target, 'attached', {
      entryTunnelDoorAttached: true,
      entryTunnelDoorCount: doors.length,
      entryTunnelDoorSide: placement.side,
      entryTunnelDoorTile: placement.worldTile || null,
      entryTunnelDoorRotationDeg: Number(placement.rotationDeg) || 0,
    });
    return door;
  }

  function attachPlacement(target, placement) {
    const existing = findDoor(target, placement.key); // Used to avoid duplicate doors when a cached load resolves after a rebuild.
    if (existing) return existing;

    const runtime = window.AuthoredFurniture; // Used for cached or asynchronous authored-furniture loading.
    if (!runtime) {
      status(target, 'waiting-runtime');
      if (typeof document !== 'undefined' && document.readyState === 'loading') {
        const data = ensureUserData(target); // Used to ensure each authored tunnel tile gets exactly one deferred retry.
        data.entryTunnelDoorDeferredKeys ||= {};
        if (!data.entryTunnelDoorDeferredKeys[placement.key]) {
          data.entryTunnelDoorDeferredKeys[placement.key] = true;
          document.addEventListener('DOMContentLoaded', () => {
            delete data.entryTunnelDoorDeferredKeys[placement.key];
            attachPlacement(target, placement);
          }, { once: true });
        }
      } else {
        status(target, 'runtime-unavailable');
      }
      return null;
    }

    const cached = runtime.peek?.(FURNITURE_KEY); // Used for zero-delay attachment when the door JSON is already cached.
    if (cached) return attachResolvedPlacement(target, cached, placement);
    if (typeof runtime.load !== 'function') {
      status(target, 'loader-unavailable');
      return null;
    }

    status(target, 'loading');
    return runtime.load(FURNITURE_KEY)
      .then(authoredData => attachResolvedPlacement(target, authoredData, placement))
      .catch(error => {
        status(target, 'error', { entryTunnelDoorError: String(error?.message || error || 'unknown error') });
        console.warn('[EntryTunnelDoorFurniture] failed to load door furniture:', error);
        return null;
      });
  }

  function attach(target, col, row, side, opts = {}) {
    const normalizedSide = String(side || 'south').toLowerCase();
    return attachPlacement(target, {
      key: `generated:${Number(col)},${Number(row)}:${normalizedSide}`,
      name: DOOR_OBJECT_NAME,
      x: Number(col) + PLACEMENT.x,
      y: (Number.isFinite(Number(opts?.elevationY)) ? Number(opts.elevationY) : 0) + PLACEMENT.y,
      z: Number(row) + PLACEMENT.z,
      rotationDeg: sideRotationDeg(normalizedSide),
      side: normalizedSide,
      worldTile: { col: Number(col), row: Number(row) },
      localTile: null,
    });
  }

  function attachAuthoredPieceDoors(group, piece, bldgMinC, bldgMinR, opts = {}) {
    const placements = authoredPlacements(piece, bldgMinC, bldgMinR, opts); // Used by town buildings/barns whose tunnel geometry is baked into the authored piece instead of built through buildEntryTunnelGroup().
    if (!placements.length || !group) return group;
    status(group, 'pending', { entryTunnelDoorExpectedCount: placements.length });
    placements.forEach(placement => attachPlacement(group, placement));
    return group;
  }

  function install() {
    const generator = window.HousePieceGen; // Used to wrap both live-generated and authored entry-tunnel construction paths.
    if (!generator) return false;
    let installed = false;

    const originalTunnelBuilder = generator.buildEntryTunnelGroup; // Used by modular farm-house architectural features.
    if (typeof originalTunnelBuilder === 'function') {
      if (originalTunnelBuilder.__entryTunnelDoorFurnitureWrapped) {
        installed = true;
      } else {
        function buildEntryTunnelGroupWithDoor(THREE, col, row, side, opts) {
          const tunnel = originalTunnelBuilder.apply(this, arguments); // Used as the untouched generated tunnel receiving the authored door.
          status(tunnel, 'pending', {
            entryTunnelDoorExpectedCount: 1,
            entryTunnelDoorSide: String(side || 'south').toLowerCase(),
            entryTunnelDoorTile: { col: Number(col), row: Number(row) },
          });
          attach(tunnel, col, row, side, opts || {});
          return tunnel;
        }
        buildEntryTunnelGroupWithDoor.__entryTunnelDoorFurnitureWrapped = true;
        buildEntryTunnelGroupWithDoor.__entryTunnelDoorFurnitureOriginal = originalTunnelBuilder;
        generator.buildEntryTunnelGroup = buildEntryTunnelGroupWithDoor;
        installed = true;
      }
    }

    const originalPieceBuilder = generator.buildGroupFromPiece; // Used by authored town buildings, barns, and authored mine entrances.
    if (typeof originalPieceBuilder === 'function') {
      if (originalPieceBuilder.__entryTunnelDoorFurnitureWrapped) {
        installed = true;
      } else {
        function buildGroupFromPieceWithDoors(THREE, piece, bldgMinC, bldgMinR, opts) {
          const group = originalPieceBuilder.apply(this, arguments); // Used as the untouched authored building receiving door furniture after geometry placement.
          attachAuthoredPieceDoors(group, piece, bldgMinC, bldgMinR, opts || {});
          return group;
        }
        buildGroupFromPieceWithDoors.__entryTunnelDoorFurnitureWrapped = true;
        buildGroupFromPieceWithDoors.__entryTunnelDoorFurnitureOriginal = originalPieceBuilder;
        generator.buildGroupFromPiece = buildGroupFromPieceWithDoors;
        installed = true;
      }
    }

    return installed;
  }

  function debugInfo(target) {
    const doors = findDoors(target); // Used to report every currently attached visual for multi-tile authored tunnels.
    const door = findDoor(target);
    const data = target?.userData || {}; // Used to expose loader/placement state without requiring a console.
    return {
      key: FURNITURE_KEY,
      status: data.entryTunnelDoorStatus || 'unknown',
      attached: doors.length > 0,
      count: doors.length,
      expectedCount: data.entryTunnelDoorExpectedCount ?? null,
      side: data.entryTunnelDoorSide || door?.userData?.entryTunnelSide || null,
      tile: data.entryTunnelDoorTile || door?.userData?.entryTunnelTile || null,
      position: door ? { x: door.position.x, y: door.position.y, z: door.position.z } : null,
      rotationYDeg: door ? door.rotation.y * 180 / Math.PI : null,
      doors: doors.map(item => ({
        tile: item.userData?.entryTunnelTile || null,
        localTile: item.userData?.entryTunnelLocalTile || null,
        position: { x: item.position.x, y: item.position.y, z: item.position.z },
        rotationYDeg: item.rotation.y * 180 / Math.PI,
      })),
    };
  }

  window.EntryTunnelDoorFurniture = Object.freeze({
    FURNITURE_KEY,
    DOOR_OBJECT_NAME,
    PLACEMENT,
    SIDE_ROTATION_DEG,
    attach,
    attachAuthoredPieceDoors,
    authoredPlacements,
    debugInfo,
    install,
  });

  install();
})();
