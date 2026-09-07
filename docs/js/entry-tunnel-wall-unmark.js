// Prevents authored entry-tunnel geometry from being misclassified as house walls.
// Crossing house-wall quads are carved at tunnel-cell boundaries so only the
// wall portions beside/above the tunnel reach WallBuilder. Tunnel floors,
// ceilings and caps are also reclassified away from `entryTunnel`; actual
// vertical tunnel shell/frame faces keep their tunnel brick treatment.
(() => {
  'use strict';

  const EPS = 1e-4; // Used for tolerant grid/face intersection checks.
  const REGULAR_TUNNEL_HEIGHT = 1.058; // Fallback used only when an authored tunnel ceiling face is missing.
  const TALL_TUNNEL_HEIGHT = REGULAR_TUNNEL_HEIGHT * 1.5; // Mirrors the House Editor's 150% tall-entry tunnel option.
  const TUNNEL_SURFACE_TAG = 'entryTunnelSurface'; // Keeps non-wall tunnel geometry visible without sending it to WallBuilder.

  function normalizePiece(piece) {
    return piece?.currentPiece || piece || null;
  }

  function tileKey(cell) {
    return `${Number(cell?.x)},${Number(cell?.y)}`;
  }

  function lerp3(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }

  function tunnelCellRecords(piece) {
    const src = normalizePiece(piece);
    if (!src) return [];
    const ext = src.footprint?.extensions || {};
    const regular = Array.isArray(ext.entryTunnels) ? ext.entryTunnels : [];
    const tall = Array.isArray(ext.tallEntryTunnels) ? ext.tallEntryTunnels : [];
    const byKey = new Map(); // De-duplicates cells while preserving whether any declaration is tall.
    regular.forEach(cell => {
      const x = Number(cell?.x), y = Number(cell?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) byKey.set(`${x},${y}`, { x, y, tall: false });
    });
    tall.forEach(cell => {
      const x = Number(cell?.x), y = Number(cell?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) byKey.set(`${x},${y}`, { x, y, tall: true });
    });
    if (!byKey.size) return [];

    const tile = Math.max(EPS, Number(src.tileSize) || 1); // Converts authored grid cells into face-local coordinates.
    const gc = Math.floor((Number(src.gridSize) || 18) / 2); // Same local-grid origin used by HousePieceGen/House Editor.
    const groundY = Number(src.base?.groundY) || 0;
    const ceilingByTile = new Map(); // Prefers exact generated tunnel height over the fallback constant.
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

  function isVerticalTunnelWallFace(face) {
    if (face?.tag !== 'entryTunnel') return false;
    // The author marks actual vertical shell/frame box faces with singular
    // `solidifiedWall`; floor/ceiling bookkeeping uses plural `solidifiedWalls`.
    return face.solidifiedWall === true || face.doorwayFrame === true;
  }

  function faceHorizontalAxis(face) {
    if (!Array.isArray(face?.v) || face.v.length !== 4) return null;
    const bottomSpanX = Math.abs(Number(face.v[3][0]) - Number(face.v[0][0]));
    const bottomSpanZ = Math.abs(Number(face.v[3][2]) - Number(face.v[0][2]));
    const topSpanX = Math.abs(Number(face.v[2][0]) - Number(face.v[1][0]));
    const topSpanZ = Math.abs(Number(face.v[2][2]) - Number(face.v[1][2]));
    const spanX = Math.max(bottomSpanX, topSpanX);
    const spanZ = Math.max(bottomSpanZ, topSpanZ);
    if (Math.max(spanX, spanZ) < EPS) return null;
    return spanX >= spanZ ? 'x' : 'z';
  }

  function cloneWallFragment(face, vertices, suffix) {
    return {
      ...face,
      id: `${face.id ?? 'wall'}__tunnel_${suffix}`,
      v: vertices,
      tunnelWallCarvedFragment: true,
      tunnelWallOriginalId: face.tunnelWallOriginalId ?? face.id ?? null,
    };
  }

  // Splits one authored wall quad around one tunnel cell. Wall faces use the
  // Highland ordering [bottom-left, top-left, top-right, bottom-right]. The
  // lower overlapping strip is omitted entirely; side fragments and the
  // lintel/top strip remain tagged `wall`, so WallBuilder only bricks those.
  function carveWallFaceAgainstTunnel(face, tunnel, suffixBase) {
    if (face?.tag !== 'wall' || !Array.isArray(face.v) || face.v.length !== 4) return { faces: [face], carved: false };
    const axis = faceHorizontalAxis(face);
    if (!axis) return { faces: [face], carved: false };

    const points = face.v.map(v => [Number(v?.[0]), Number(v?.[1]), Number(v?.[2])]);
    if (points.some(v => v.some(n => !Number.isFinite(n)))) return { faces: [face], carved: false };

    const perpendicular = axis === 'x' ? 'z' : 'x';
    const axisIndex = axis === 'x' ? 0 : 2;
    const perpIndex = perpendicular === 'x' ? 0 : 2;
    const tunnelAxisMin = axis === 'x' ? tunnel.minX : tunnel.minZ;
    const tunnelAxisMax = axis === 'x' ? tunnel.maxX : tunnel.maxZ;
    const tunnelPerpMin = perpendicular === 'x' ? tunnel.minX : tunnel.minZ;
    const tunnelPerpMax = perpendicular === 'x' ? tunnel.maxX : tunnel.maxZ;

    const perpMin = Math.min(...points.map(v => v[perpIndex]));
    const perpMax = Math.max(...points.map(v => v[perpIndex]));
    // A wall commonly lies exactly on a tunnel-cell boundary, so touching the
    // tunnel in the perpendicular axis is enough to count as an intersection.
    if (tunnelPerpMax < perpMin - EPS || tunnelPerpMin > perpMax + EPS) return { faces: [face], carved: false };

    const b0 = points[0], t0 = points[1], t1 = points[2], b1 = points[3];
    const c0 = b0[axisIndex], c1 = b1[axisIndex];
    const axisDelta = c1 - c0;
    if (Math.abs(axisDelta) < EPS) return { faces: [face], carved: false };

    const faceAxisMin = Math.min(c0, c1), faceAxisMax = Math.max(c0, c1);
    const overlapMin = Math.max(faceAxisMin, tunnelAxisMin);
    const overlapMax = Math.min(faceAxisMax, tunnelAxisMax);
    if (overlapMax - overlapMin <= EPS) return { faces: [face], carved: false };

    let u0 = (overlapMin - c0) / axisDelta;
    let u1 = (overlapMax - c0) / axisDelta;
    if (u0 > u1) { const swap = u0; u0 = u1; u1 = swap; }
    u0 = Math.max(0, Math.min(1, u0));
    u1 = Math.max(0, Math.min(1, u1));
    if (u1 - u0 <= EPS) return { faces: [face], carved: false };

    const bottomAt = u => lerp3(b0, b1, u);
    const topAt = u => lerp3(t0, t1, u);
    const bl = bottomAt(u0), br = bottomAt(u1), tl = topAt(u0), tr = topAt(u1);
    const overlapBottom = Math.min(bl[1], br[1]);
    const overlapTop = Math.max(tl[1], tr[1]);
    if (tunnel.maxY <= overlapBottom + EPS || tunnel.minY >= overlapTop - EPS) return { faces: [face], carved: false };

    const fragments = [];
    if (u0 > EPS) fragments.push(cloneWallFragment(face, [bottomAt(0), topAt(0), topAt(u0), bottomAt(u0)], `${suffixBase}_before`));

    // Preserve the portion above the tunnel ceiling. Highland body-wall tops
    // are level, but the per-edge interpolation also handles tapered/sloped
    // quads without assuming an exact authored height.
    const cutY = tunnel.maxY;
    if (tl[1] > cutY + EPS && tr[1] > cutY + EPS) {
      const leftRatio = Math.max(0, Math.min(1, (cutY - bl[1]) / Math.max(EPS, tl[1] - bl[1])));
      const rightRatio = Math.max(0, Math.min(1, (cutY - br[1]) / Math.max(EPS, tr[1] - br[1])));
      const cl = lerp3(bl, tl, leftRatio);
      const cr = lerp3(br, tr, rightRatio);
      fragments.push(cloneWallFragment(face, [cl, tl, tr, cr], `${suffixBase}_above`));
    }

    if (u1 < 1 - EPS) fragments.push(cloneWallFragment(face, [bottomAt(u1), topAt(u1), topAt(1), bottomAt(1)], `${suffixBase}_after`));
    return { faces: fragments, carved: true };
  }

  function carveWallFaceThroughTunnels(face, tunnels) {
    let fragments = [face];
    let carvedCount = 0;
    tunnels.forEach((tunnel, tunnelIndex) => {
      const next = [];
      fragments.forEach((fragment, fragmentIndex) => {
        const result = carveWallFaceAgainstTunnel(fragment, tunnel, `${tunnelIndex}_${fragmentIndex}`);
        if (result.carved) carvedCount++;
        next.push(...result.faces);
      });
      fragments = next;
    });
    return { faces: fragments, carvedCount };
  }

  function preparePiece(piece) {
    const src = normalizePiece(piece);
    const faces = src?.base?.faces;
    const tunnels = tunnelCellRecords(src);
    if (!src || !Array.isArray(faces) || !faces.length || !tunnels.length) {
      return { piece, clearedCount: 0, carvedCount: 0, suppressedTunnelPanelCount: 0 };
    }

    let carvedCount = 0;
    let suppressedTunnelPanelCount = 0;
    const nextFaces = [];
    for (const face of faces) {
      if (face?.tag === 'entryTunnel' && !isVerticalTunnelWallFace(face)) {
        suppressedTunnelPanelCount++;
        nextFaces.push({
          ...face,
          tag: TUNNEL_SURFACE_TAG,
          tunnelWallBuilderSuppressed: true,
          tunnelWallBuilderOriginalTag: 'entryTunnel',
        });
        continue;
      }
      if (face?.tag === 'wall') {
        const carved = carveWallFaceThroughTunnels(face, tunnels);
        carvedCount += carved.carvedCount;
        nextFaces.push(...carved.faces);
        continue;
      }
      nextFaces.push(face);
    }

    if (!carvedCount && !suppressedTunnelPanelCount) {
      return { piece, clearedCount: 0, carvedCount: 0, suppressedTunnelPanelCount: 0 };
    }

    const nextSrc = { ...src, base: { ...src.base, faces: nextFaces } }; // Avoids mutating cached piece JSON shared by other systems/tools.
    const nextPiece = piece?.currentPiece ? { ...piece, currentPiece: nextSrc } : nextSrc;
    return { piece: nextPiece, clearedCount: carvedCount, carvedCount, suppressedTunnelPanelCount };
  }

  function install() {
    const generator = window.HousePieceGen; // Wraps the authored-piece render boundary before WallBuilder sees face tags.
    const original = generator?.buildGroupFromPiece;
    if (typeof original !== 'function') return false;
    if (original.__entryTunnelWallUnmarkWrapped) return true;

    function buildGroupFromPieceWithoutTunnelInteriorWalls(THREE, piece, bldgMinC, bldgMinR, opts) {
      const prepared = preparePiece(piece); // Carves crossing house walls and suppresses non-wall tunnel surfaces for this render.
      const group = original.call(this, THREE, prepared.piece, bldgMinC, bldgMinR, opts);
      if (group) {
        group.userData = group.userData || {};
        group.userData.entryTunnelWallFacesUnmarked = prepared.carvedCount; // Backward-compatible mobile debug counter.
        group.userData.entryTunnelWallSectionsCarved = prepared.carvedCount; // Explicit count for crossing town-house quads.
        group.userData.entryTunnelNonWallPanelsSuppressed = prepared.suppressedTunnelPanelCount; // Proves floors/ceilings stopped reaching WallBuilder.
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
      carvedCount: Number(group?.userData?.entryTunnelWallSectionsCarved) || 0,
      suppressedTunnelPanelCount: Number(group?.userData?.entryTunnelNonWallPanelsSuppressed) || 0,
    };
  }

  window.EntryTunnelWallUnmark = Object.freeze({
    preparePiece,
    tunnelCellRecords,
    isVerticalTunnelWallFace,
    carveWallFaceAgainstTunnel,
    debugInfo,
    install,
  });

  install();
})();
