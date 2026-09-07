// Clears the `wall` tag from authored house-face fragments that sit entirely
// inside an entry-tunnel volume. Geometry stays in place; only WallBuilder's
// wall classification is suppressed so tunnel interiors do not get a second
// layer of house-wall bricks/material on top of the tunnel itself.
(() => {
  'use strict';

  const EPS = 1e-4; // Used for inclusive tunnel-boundary checks on authored grid-aligned faces.
  const REGULAR_TUNNEL_HEIGHT = 1.058; // Fallback used only when an authored tunnel ceiling face is missing.
  const TALL_TUNNEL_HEIGHT = REGULAR_TUNNEL_HEIGHT * 1.5; // Mirrors the House Editor's 150% tall-entry tunnel option.

  function normalizePiece(piece) {
    return piece?.currentPiece || piece || null;
  }

  function tileKey(cell) {
    return `${Number(cell?.x)},${Number(cell?.y)}`;
  }

  function tunnelCellRecords(piece) {
    const src = normalizePiece(piece);
    if (!src) return [];
    const ext = src.footprint?.extensions || {};
    const regular = Array.isArray(ext.entryTunnels) ? ext.entryTunnels : [];
    const tall = Array.isArray(ext.tallEntryTunnels) ? ext.tallEntryTunnels : [];
    const byKey = new Map(); // Used to de-duplicate cells while preserving whether any declaration is tall.
    regular.forEach(cell => {
      const x = Number(cell?.x), y = Number(cell?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) byKey.set(`${x},${y}`, { x, y, tall: false });
    });
    tall.forEach(cell => {
      const x = Number(cell?.x), y = Number(cell?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) byKey.set(`${x},${y}`, { x, y, tall: true });
    });
    if (!byKey.size) return [];

    const tile = Math.max(EPS, Number(src.tileSize) || 1); // Used to convert authored grid cells into the face-local coordinate system.
    const gc = Math.floor((Number(src.gridSize) || 18) / 2); // Used by HousePieceGen and the House Editor as the local-grid origin.
    const groundY = Number(src.base?.groundY) || 0;
    const ceilingByTile = new Map(); // Used to prefer the exact generated tunnel height over a hardcoded fallback.
    for (const face of (src.base?.faces || [])) {
      if (face?.tag !== 'entryTunnel' || !face?.sourceTile || !Array.isArray(face.v) || !face.v.length) continue;
      const extensionFace = String(face.extensionFace || '').toLowerCase();
      if (extensionFace !== 'ceiling' && extensionFace !== 'top') continue;
      const maxY = Math.max(...face.v.map(vertex => Number(vertex?.[1])).filter(Number.isFinite));
      if (!Number.isFinite(maxY)) continue;
      const key = tileKey(face.sourceTile);
      ceilingByTile.set(key, Math.max(ceilingByTile.get(key) ?? -Infinity, maxY));
    }

    return [...byKey.values()].map(cell => {
      const minX = (cell.x - gc) * tile;
      const minZ = (cell.y - gc) * tile;
      const fallbackTop = groundY + (cell.tall ? TALL_TUNNEL_HEIGHT : REGULAR_TUNNEL_HEIGHT) * tile;
      return {
        key: `${cell.x},${cell.y}`,
        minX,
        maxX: minX + tile,
        minZ,
        maxZ: minZ + tile,
        minY: groundY - EPS,
        maxY: ceilingByTile.get(`${cell.x},${cell.y}`) ?? fallbackTop,
      };
    });
  }

  function pointInsideAnyTunnel(x, y, z, tunnels) {
    return tunnels.some(tunnel =>
      x >= tunnel.minX - EPS && x <= tunnel.maxX + EPS &&
      z >= tunnel.minZ - EPS && z <= tunnel.maxZ + EPS &&
      y >= tunnel.minY - EPS && y <= tunnel.maxY + EPS
    );
  }

  function wallFaceFullyInsideTunnel(face, tunnels) {
    if (face?.tag !== 'wall' || !Array.isArray(face.v) || face.v.length < 3 || !tunnels.length) return false;
    const points = face.v.map(vertex => ({ x: Number(vertex?.[0]), y: Number(vertex?.[1]), z: Number(vertex?.[2]) }));
    if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z))) return false;

    // Every authored wall vertex must lie inside the tunnel union. This keeps
    // a large wall quad that only crosses one tunnel tile marked as a wall;
    // generated per-tile/portal-split fragments are cleared independently.
    if (!points.every(point => pointInsideAnyTunnel(point.x, point.y, point.z, tunnels))) return false;

    // Also sample the face center so two endpoints living on separate tunnel
    // cells cannot make us clear a face that bridges a gap between them.
    const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }), { x: 0, y: 0, z: 0 });
    center.x /= points.length;
    center.y /= points.length;
    center.z /= points.length;
    return pointInsideAnyTunnel(center.x, center.y, center.z, tunnels);
  }

  function preparePiece(piece) {
    const src = normalizePiece(piece);
    const faces = src?.base?.faces;
    const tunnels = tunnelCellRecords(src);
    if (!src || !Array.isArray(faces) || !faces.length || !tunnels.length) return { piece, clearedCount: 0 };

    let clearedCount = 0;
    const nextFaces = faces.map(face => {
      if (!wallFaceFullyInsideTunnel(face, tunnels)) return face;
      clearedCount++;
      return {
        ...face,
        tag: '',
        tunnelInteriorWallCleared: true,
        tunnelInteriorWallOriginalTag: 'wall',
      };
    });
    if (!clearedCount) return { piece, clearedCount: 0 };

    const nextSrc = { ...src, base: { ...src.base, faces: nextFaces } }; // Used to avoid mutating cached piece JSON shared by other systems/tools.
    const nextPiece = piece?.currentPiece ? { ...piece, currentPiece: nextSrc } : nextSrc;
    return { piece: nextPiece, clearedCount };
  }

  function install() {
    const generator = window.HousePieceGen; // Used to wrap the single authored-piece render boundary before WallBuilder sees face tags.
    const original = generator?.buildGroupFromPiece;
    if (typeof original !== 'function') return false;
    if (original.__entryTunnelWallUnmarkWrapped) return true;

    function buildGroupFromPieceWithoutTunnelInteriorWalls(THREE, piece, bldgMinC, bldgMinR, opts) {
      const prepared = preparePiece(piece); // Used to suppress only fully tunnel-contained wall fragments for this render.
      const group = original.call(this, THREE, prepared.piece, bldgMinC, bldgMinR, opts);
      if (group) {
        group.userData = group.userData || {};
        group.userData.entryTunnelWallFacesUnmarked = prepared.clearedCount; // Used by mobile-safe runtime inspection/debugging.
      }
      return group;
    }

    buildGroupFromPieceWithoutTunnelInteriorWalls.__entryTunnelWallUnmarkWrapped = true;
    buildGroupFromPieceWithoutTunnelInteriorWalls.__entryTunnelWallUnmarkOriginal = original;
    generator.buildGroupFromPiece = buildGroupFromPieceWithoutTunnelInteriorWalls;
    return true;
  }

  function debugInfo(group) {
    return {
      installed: !!window.HousePieceGen?.buildGroupFromPiece?.__entryTunnelWallUnmarkWrapped,
      clearedCount: Number(group?.userData?.entryTunnelWallFacesUnmarked) || 0,
    };
  }

  window.EntryTunnelWallUnmark = Object.freeze({
    preparePiece,
    tunnelCellRecords,
    debugInfo,
    install,
  });

  install();
})();
