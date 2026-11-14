// Registers authored subtle terrain and walkable porch/furniture supports.
// Normal walking, jumping and NPC footing consume these surfaces as physical
// ground; the visual composer must NOT reapply that lift after movement.
//
// Porches are derived from House Piece Author extension geometry. Furniture
// uses a THREE.Box3 calculated from the rendered object (or explicitly marked
// authored support parts) and is enabled per placed instance with
// `walkableElevation: true` in the map JSON.
//
// HobunjiWalkableElevation.surfaceLiftAt/worldSurfaceTopAt are the shared
// support authority; player and NPC movement use absolute worldSurfaceTopAt,
// while the existing terrain sampler owns smooth town ground displacement.
(() => {
  'use strict';

  const composer = window.PlayerBodyTransformComposer;
  const terrain = window.HobunjiTownSubtleElevation;
  if (!composer || !terrain?.sampleHeightAt || window.__hobunjiTownBodyElevationBridgeInstalled) return;
  window.__hobunjiTownBodyElevationBridgeInstalled = true;

  const CHANNEL = 'townSubtleElevation';
  const CHANNEL_PRIORITY = 50;
  const EPSILON = 1e-8;
  const FURNITURE_METADATA_KEY = 'walkableElevation'; // Used by both map editors and runtime scene matching.
  const SUPPORT_EDGE_EPSILON = 0.025; // Used to keep exact box-edge floating-point noise from flickering support selection.
  const supports = new Map(); // Used by per-frame support sampling and mobile diagnostics.
  const authoredMapCache = new Map(); // Used to avoid refetching the active map's furniture metadata every render.
  let nextSupportId = 1; // Used to assign stable diagnostic ids to generated porch/furniture support surfaces.
  let activeFurnitureSync = null; // Used to collapse duplicate asynchronous scene scans for the same active area.
  let lastFurnitureSyncArea = null; // Used to avoid rescanning static furniture on every render.
  let runtimeDeps = null; // Captured from PixelProbe.init so area/sit state stays aligned with the live game.
  let lastDebug = {
    active: false,
    lift: 0,
    terrainLift: 0,
    supportLift: 0,
    supportId: null,
    x: null,
    z: null,
    movementOwnedBaseY: null,
    reason: 'not-initialized',
  };

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function activeArea() {
    return runtimeDeps?.getCurrentArea?.()
      || window.__hobunjiFurnitureDebug?.getCurrentArea?.()
      || null;
  }

  function activeScene() {
    try { return window.GridTileAccessors?.getActiveScene?.() || null; }
    catch (_) { return null; }
  }

  function objectInActiveScene(object) {
    if (!object) return true;
    const scene = activeScene();
    if (!scene) return true;
    let root = object;
    while (root?.parent) root = root.parent;
    return root === scene;
  }

  function normalizeBounds(bounds) {
    if (!bounds) return null;
    const minX = finite(bounds.minX, NaN);
    const maxX = finite(bounds.maxX, NaN);
    const minZ = finite(bounds.minZ, NaN);
    const maxZ = finite(bounds.maxZ, NaN);
    const baseY = finite(bounds.baseY, NaN);
    const topY = finite(bounds.topY, NaN);
    if (![minX, maxX, minZ, maxZ, baseY, topY].every(Number.isFinite)) return null;
    if (maxX <= minX || maxZ <= minZ || topY <= baseY + EPSILON) return null;
    return { minX, maxX, minZ, maxZ, baseY, topY };
  }

  // Tile-cell spatial index over `supports`, so matchingSupports only checks
  // the handful of supports actually near a query point instead of scanning
  // every registered porch/furniture box in the area on every call (this
  // backs npcSurfaceY, called for every NPC/player every frame). Supports
  // are authored in the same 1-world-unit-per-tile space as the tile grid,
  // so a support box is indexed under every integer tile cell it overlaps —
  // expanded by SUPPORT_EDGE_EPSILON so the existing edge-tolerance in the
  // exact bounds check below can never see a point whose cell the box wasn't
  // also indexed into.
  const supportCells = new Map(); // "cx,cz" -> Set<supportId>

  function cellKey(cx, cz) {
    return `${cx},${cz}`;
  }

  function cellsForBounds(bounds) {
    const minCx = Math.floor(bounds.minX - SUPPORT_EDGE_EPSILON);
    const maxCx = Math.floor(bounds.maxX + SUPPORT_EDGE_EPSILON);
    const minCz = Math.floor(bounds.minZ - SUPPORT_EDGE_EPSILON);
    const maxCz = Math.floor(bounds.maxZ + SUPPORT_EDGE_EPSILON);
    const cells = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) cells.push(cellKey(cx, cz));
    }
    return cells;
  }

  function indexEntry(entry) {
    for (const key of cellsForBounds(entry.bounds)) {
      let set = supportCells.get(key);
      if (!set) supportCells.set(key, set = new Set());
      set.add(entry.id);
    }
  }

  function unindexEntry(entry) {
    if (!entry) return;
    for (const key of cellsForBounds(entry.bounds)) {
      const set = supportCells.get(key);
      if (!set) continue;
      set.delete(entry.id);
      if (!set.size) supportCells.delete(key);
    }
  }

  function registerBox(bounds, options = {}) {
    const normalized = normalizeBounds(bounds);
    if (!normalized) return null;
    const id = String(options.id || `walk_support_${nextSupportId++}`); // Used to replace/reuse the same authored support deterministically.
    const existing = supports.get(id);
    if (existing) unindexEntry(existing); // Re-registering the same id (e.g. a re-authored porch) must not leave stale cell entries behind.
    const entry = {
      id,
      kind: options.kind || 'surface',
      area: options.area || null,
      sourceKey: options.sourceKey || null,
      sourceId: options.sourceId || null,
      owner: options.owner || null,
      bounds: normalized,
      bridgeFootprints: Array.isArray(options.bridgeFootprints) ? options.bridgeFootprints : null, // Exact angled walkable faces for the one authored town bridge.
      bridgeBaseY: Number.isFinite(options.bridgeBaseY) ? options.bridgeBaseY : null, // Ground datum for each stair/deck surface height.
    };
    supports.set(id, entry);
    indexEntry(entry);
    return id;
  }

  function bridgeFootprintFromPart(mesh) {
    const geometry = mesh.geometry; // Deformed geometry already includes the bridge's expanded middle.
    if (!geometry) return null;
    if (!geometry.boundingBox) geometry.computeBoundingBox?.();
    const bounds = geometry.boundingBox; // Mesh-local top plane, before the bridge's world yaw.
    if (!bounds || !mesh.matrixWorld) return null;
    const corner = (x, z) => new THREE.Vector3(x, bounds.max.y, z).applyMatrix4(mesh.matrixWorld);
    const a = corner(bounds.min.x, bounds.min.z); // First top corner anchors the oriented rectangle.
    const b = corner(bounds.max.x, bounds.min.z); // Longitudinal top edge.
    const c = corner(bounds.min.x, bounds.max.z); // Transverse top edge.
    const d = corner(bounds.max.x, bounds.max.z); // Last corner supplies conservative deck-top height.
    const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - a.x, vz = c.z - a.z;
    const det = ux * vz - uz * vx; // Nonzero projected area permits a cheap inverse 2D transform.
    if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null;
    return { ax: a.x, az: a.z, ux, uz, vx, vz, det, topY: Math.max(a.y, b.y, c.y, d.y) };
  }

  function containsBridgeFootprint(surface, x, z) {
    const dx = x - surface.ax, dz = z - surface.az; // Offset from the authored top-plane corner.
    const u = (dx * surface.vz - dz * surface.vx) / surface.det; // Position along the stair/deck.
    const v = (surface.ux * dz - surface.uz * dx) / surface.det; // Position across the stair/deck.
    const edge = SUPPORT_EDGE_EPSILON / Math.max(0.1, Math.min(Math.hypot(surface.ux, surface.uz), Math.hypot(surface.vx, surface.vz)));
    return u >= -edge && u <= 1 + edge && v >= -edge && v <= 1 + edge;
  }

  function registerObject(object, options = {}) {
    if (!object || !window.THREE?.Box3) return null;
    try {
      object.updateWorldMatrix?.(true, true);
      const supportParts = [...(object.userData?.meshById?.values?.() || [])].filter(mesh => mesh.userData?.authoredPart?.walkableElevation === true); // Authored stage platform excludes its taller decorative rail/posts from standing height.
      const box = new THREE.Box3().setFromObject(object); // Complete rendered geometry remains the default for existing furniture.
      if (supportParts.length) {
        box.makeEmpty();
        for (const mesh of supportParts) box.expandByObject(mesh);
      }
      if (box.isEmpty()) return null;
      const baseY = finite(box.min.y, NaN);
      const topY = finite(box.max.y, NaN);
      const bridgeFootprints = object.userData?.townBridgeCrossing
        ? supportParts.map(bridgeFootprintFromPart).filter(Boolean) : null; // Stairs keep individual heights; neither railings nor water beside the deck support a character.
      if (object.userData?.townBridgeCrossing && !bridgeFootprints?.length) return null;
      const bridgeBaseY = bridgeFootprints ? object.getWorldPosition(new THREE.Vector3()).y : null; // Terrain height below the bridge, not the first tread's bounding-box minimum.
      return registerBox({
        minX: box.min.x,
        maxX: box.max.x,
        minZ: box.min.z,
        maxZ: box.max.z,
        baseY,
        topY,
      }, { ...options, owner: object, bridgeFootprints, bridgeBaseY });
    } catch (error) {
      console.warn('[walkable-elevation] furniture bounds failed:', error);
      return null;
    }
  }

  function unregister(id) {
    const key = String(id || '');
    const entry = supports.get(key);
    if (!entry) return false;
    unindexEntry(entry);
    supports.delete(key);
    return true;
  }

  function clearKind(kind) {
    for (const [id, entry] of supports) {
      if (entry.kind === kind) {
        unindexEntry(entry);
        supports.delete(id);
      }
    }
  }

  function matchingSupports(worldX, worldZ, area = activeArea()) {
    const x = finite(worldX, NaN);
    const z = finite(worldZ, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
    const ids = supportCells.get(cellKey(Math.floor(x), Math.floor(z)));
    if (!ids || !ids.size) return [];
    const matches = [];
    for (const id of ids) {
      const entry = supports.get(id);
      if (!entry) continue;
      if (entry.area && area && entry.area !== area) continue;
      if (entry.owner && !objectInActiveScene(entry.owner)) continue;
      const b = entry.bounds;
      if (x < b.minX - SUPPORT_EDGE_EPSILON || x > b.maxX + SUPPORT_EDGE_EPSILON
          || z < b.minZ - SUPPORT_EDGE_EPSILON || z > b.maxZ + SUPPORT_EDGE_EPSILON) continue;
      if (entry.bridgeFootprints?.length) {
        const supported = entry.bridgeFootprints.filter(surface => containsBridgeFootprint(surface, x, z)); // Reject points in the rotated bridge's AABB but outside its true deck.
        if (!supported.length) continue;
        const topY = Math.max(...supported.map(surface => surface.topY)); // Neighboring tread edges favor the higher surface.
        matches.push({ ...entry, bounds: { ...b, baseY: entry.bridgeBaseY, topY } });
      } else matches.push(entry);
    }
    return matches;
  }

  function supportAt(worldX, worldZ, area = activeArea()) {
    const matches = matchingSupports(worldX, worldZ, area);
    return matches.sort((a, b) => b.bounds.topY - a.bounds.topY)[0] || null; // The highest real walking surface wins when staggered treads overlap.
  }

  function surfaceLiftAt(worldX, worldZ, area = activeArea()) {
    const entry = supportAt(worldX, worldZ, area);
    return entry ? Math.max(0, entry.bounds.topY - entry.bounds.baseY) : 0;
  }

  function worldSurfaceTopAt(worldX, worldZ, fallbackY = 0, area = activeArea()) {
    const entry = supportAt(worldX, worldZ, area);
    return entry ? Math.max(finite(fallbackY, 0), entry.bounds.topY) : finite(fallbackY, 0); // Never sink an actor below existing raised terrain.
  }

  function normalizePiece(pieceData) {
    return pieceData?.currentPiece && typeof pieceData.currentPiece === 'object'
      ? pieceData.currentPiece
      : pieceData;
  }

  function allPieceCells(piece) {
    return []
      .concat(piece?.footprint?.cells || [])
      .concat(piece?.footprint?.extensions?.entryTunnels || [])
      .concat(piece?.footprint?.extensions?.chimneys || [])
      .concat(piece?.footprint?.extensions?.porches || [])
      .concat(piece?.footprint?.extensions?.porchStairs || [])
      .concat(piece?.footprint?.extensions?.railings || []);
  }

  function rotateCell(localX, localY, width, depth, rotationDeg) {
    if (window.BuildingDoor?.rotateCell) return window.BuildingDoor.rotateCell(localX, localY, width, depth, rotationDeg);
    const rot = ((Math.round(finite(rotationDeg, 0) / 90) * 90) % 360 + 360) % 360;
    if (rot === 90) return { x: localY, y: width - 1 - localX };
    if (rot === 180) return { x: width - 1 - localX, y: depth - 1 - localY };
    if (rot === 270) return { x: depth - 1 - localY, y: localX };
    return { x: localX, y: localY };
  }

  function topForExtensionCell(piece, cell, extensionType) {
    const faces = piece?.base?.faces || [];
    let top = -Infinity;
    for (const face of faces) {
      if (String(face?.extensionType || face?.tag || '') !== extensionType
          || face?.extensionFace !== 'top') continue; // Roofs/tunnel ceilings, railings and vertical skirting are NOT walkable porch treads.
      if (finite(face?.sourceTile?.x, NaN) !== finite(cell?.x, NaN)
          || finite(face?.sourceTile?.y, NaN) !== finite(cell?.y, NaN)) continue;
      for (const vertex of (face.v || [])) {
        if (Array.isArray(vertex) && Number.isFinite(Number(vertex[1]))) top = Math.max(top, Number(vertex[1]));
      }
    }
    if (Number.isFinite(top)) return top;
    const groundY = finite(piece?.base?.groundY, 0);
    if (extensionType === 'porch') {
      const tile = Math.max(0.001, finite(piece?.tileSize, 1));
      return groundY + Math.max(0.08, tile * 0.18);
    }
    return groundY + Math.max(0.08, finite(piece?.tileSize, 1) * 0.18);
  }

  function registerPiecePorches(group, pieceData, gridX, gridZ, options = {}) {
    const piece = normalizePiece(pieceData);
    const porches = piece?.footprint?.extensions?.porches || [];
    const stairs = piece?.footprint?.extensions?.porchStairs || [];
    if (!porches.length && !stairs.length) return [];
    const allCells = allPieceCells(piece);
    if (!allCells.length) return [];
    const minX = Math.min(...allCells.map(cell => finite(cell.x, 0)));
    const minY = Math.min(...allCells.map(cell => finite(cell.y, 0)));
    const maxX = Math.max(...allCells.map(cell => finite(cell.x, 0)));
    const maxY = Math.max(...allCells.map(cell => finite(cell.y, 0)));
    const width = maxX - minX + 1;
    const depth = maxY - minY + 1;
    const elevationY = finite(options.elevationY, 0);
    const groundLocalY = finite(piece?.base?.groundY, 0);
    const ids = [];

    const addCells = (cells, kind, extensionType) => {
      for (const cell of cells) {
        const localX = finite(cell.x, 0) - minX;
        const localY = finite(cell.y, 0) - minY;
        const rotated = rotateCell(localX, localY, width, depth, options.rotationDeg || 0);
        const topLocalY = topForExtensionCell(piece, cell, extensionType);
        const id = registerBox({
          minX: finite(gridX, 0) + rotated.x,
          maxX: finite(gridX, 0) + rotated.x + 1,
          minZ: finite(gridZ, 0) + rotated.y,
          maxZ: finite(gridZ, 0) + rotated.y + 1,
          baseY: elevationY + groundLocalY,
          topY: elevationY + topLocalY,
        }, {
          id: `${kind}:${piece.id || piece.name || 'piece'}:${gridX},${gridZ}:${rotated.x},${rotated.y}:${options.rotationDeg || 0}`,
          kind,
          sourceKey: piece.id || piece.name || null,
          owner: group,
        });
        if (id) ids.push(id);
      }
    };
    addCells(porches, 'porch', 'porch');
    addCells(stairs, 'porchStair', 'porchStair');
    return ids;
  }

  const railCollisionCells = new Map(); // Grid cell -> railing face boxes, so normal walking/NPC collision does not scan every placed building.
  const railCollidersByPiece = new Map(); // Stable piece placement -> live railing boxes; replacing a house does not leave ghost blockers.
  let railCollisionProviderInstalled = false; // The shared AreaFootprintBlockers provider is registered once.
  let railCollisionQuery = 0; // Deduplicates a face reached through multiple neighboring grid cells in a single query.

  function indexRailCollider(collider, add) {
    for (const key of cellsForBounds(collider.bounds)) {
      let entries = railCollisionCells.get(key);
      if (add) {
        if (!entries) railCollisionCells.set(key, entries = new Set());
        entries.add(collider);
      } else if (entries) {
        entries.delete(collider);
        if (!entries.size) railCollisionCells.delete(key);
      }
    }
  }

  function railBlocksBox(x, z, half = 0, worldY = null) {
    if (!railCollisionCells.size) return false;
    const query = ++railCollisionQuery; // A wide actor box can overlap a rail's indexed cells more than once.
    const edge = Math.max(0, Number(half) || 0);
    for (let row = Math.floor(z - edge); row <= Math.floor(z + edge); row++) {
      for (let col = Math.floor(x - edge); col <= Math.floor(x + edge); col++) {
        const colliders = railCollisionCells.get(cellKey(col, row));
        if (!colliders) continue;
        for (const collider of colliders) {
          if (collider.lastQuery === query) continue;
          collider.lastQuery = query;
          if (!objectInActiveScene(collider.owner)) continue;
          const b = collider.bounds;
          if (x + edge < b.minX || x - edge > b.maxX || z + edge < b.minZ || z - edge > b.maxZ) continue;
          if (Number.isFinite(worldY) && (worldY < b.minY - 0.05 || worldY > b.maxY + 0.05)) continue;
          return true;
        }
      }
    }
    return false;
  }

  function ensureRailCollisionProvider() {
    if (railCollisionProviderInstalled || !window.AreaFootprintBlockers?.register) return;
    window.AreaFootprintBlockers.register('hobunji-porch-railing-faces', {
      blocksBox: railBlocksBox, // Thin modeled railings block movement without claiming an entire walkable porch tile.
    });
    railCollisionProviderInstalled = true;
  }

  function registerPieceRails(group, pieceData, gridX, gridZ, options = {}) {
    if (!group?.traverse || !window.THREE?.Box3) return 0;
    const piece = normalizePiece(pieceData);
    const id = `${piece?.id || piece?.name || 'house'}:${gridX},${gridZ}:${options.rotationDeg || 0}`; // Same authored placement always replaces its old railing boxes.
    const previous = railCollidersByPiece.get(id);
    if (previous) for (const entry of previous) indexRailCollider(entry, false);
    const next = [];
    group.traverse(mesh => {
      if (!mesh?.isMesh || mesh.userData?.housePieceFaceTag !== 'railing') return;
      const box = new window.THREE.Box3().setFromObject(mesh); // Rendered authored face geometry has already applied the house rotation/placement.
      if (box.isEmpty?.() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.z)) return;
      const bounds = {
        minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z,
        minY: box.min.y, maxY: box.max.y,
      }; // Narrow physical railing boundary, not the full 1x1 source tile.
      const entry = { owner: group, bounds, lastQuery: 0 }; // Reused by every subsequent movement probe until the piece is rebuilt.
      next.push(entry);
      indexRailCollider(entry, true);
    });
    if (next.length) railCollidersByPiece.set(id, next);
    else railCollidersByPiece.delete(id);
    ensureRailCollisionProvider();
    return next.length;
  }

  function patchHousePieceGen() {
    const api = window.HousePieceGen;
    if (!api?.buildGroupFromPiece || api.buildGroupFromPiece.__walkableElevationPatched) return false;
    const originalBuild = api.buildGroupFromPiece;
    const wrappedBuild = function walkablePorchAwareBuild(THREEArg, piece, gridX, gridZ, options) {
      const group = originalBuild.apply(this, arguments);
      try {
        registerPiecePorches(group, piece, gridX, gridZ, options || {});
        registerPieceRails(group, piece, gridX, gridZ, options || {});
      } catch (error) { console.warn('[walkable-elevation] porch/railing registration failed:', error); }
      return group;
    };
    wrappedBuild.__walkableElevationPatched = true;
    wrappedBuild.__originalBuildGroupFromPiece = originalBuild;
    api.buildGroupFromPiece = wrappedBuild;
    return true;
  }

  function normalizedFurnitureKey(record) {
    return String(record?.itemKey || record?.key || record?.kind || record?.type || '')
      .trim()
      .replace(/Furniture$/i, '')
      .toLowerCase();
  }

  function walkableFurnitureRecords(mapData) {
    const lists = [];
    if (Array.isArray(mapData?.decor)) lists.push(mapData.decor);
    if (Array.isArray(mapData?.furniture)) lists.push(mapData.furniture);
    if (Array.isArray(mapData?.buildingInteriorBase?.furniture)) lists.push(mapData.buildingInteriorBase.furniture);
    const out = [];
    for (const list of lists) {
      for (const record of list) {
        if (record?.[FURNITURE_METADATA_KEY]) out.push(record);
      }
    }
    return out;
  }

  async function loadAuthoredMap(area) {
    const key = String(area || '');
    if (!key) return null;
    if (authoredMapCache.has(key)) return authoredMapCache.get(key);
    const promise = (async () => {
      if (/^map_i_/.test(key) && window.NpcFurnitureWardrobes?.loadMap) {
        return window.NpcFurnitureWardrobes.loadMap(key);
      }
      const workspace = window.LocalDBOverrides?.loadDatabase
        ? await window.LocalDBOverrides.loadDatabase('townWorkspace')
        : await fetch('config/town-workspace-v1.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : null);
      const maps = Array.isArray(workspace?.maps) ? workspace.maps : [];
      if (key === 'town') {
        return maps.find(map => map?.id === 'map_hobunji_town')
          || maps.find(map => map?.category === 'town')
          || null;
      }
      return maps.find(map => String(map?.id || '') === key) || null;
    })().catch(error => {
      console.warn('[walkable-elevation] map metadata load failed:', error);
      return null;
    });
    authoredMapCache.set(key, promise);
    return promise;
  }

  function candidateFurnitureRoots(scene) {
    const roots = [];
    scene?.traverse?.(node => {
      if (!node || node === scene) return;
      const name = String(node.name || '').toLowerCase();
      const userData = node.userData || {};
      if (name.startsWith('procedural_furniture_')
          || name.startsWith('authored_furniture_')
          || userData.authoredFurnitureKey
          || userData.furnitureKey) {
        roots.push(node);
      }
    });
    return roots;
  }

  function recordPosition(record) {
    const col = finite(record?.col ?? record?.c ?? record?.x, NaN);
    const row = finite(record?.row ?? record?.r ?? record?.y, NaN);
    return Number.isFinite(col) && Number.isFinite(row) ? { x: col + 0.5, z: row + 0.5 } : null;
  }

  // Multi-tile furniture (the inn stage is a 5x3 long table) is authored at its
  // top-left tile but its rendered root can sit at the footprint centre, which
  // is further than the match radius from the anchor tile alone.
  function recordFootprintCenter(record) {
    const position = recordPosition(record);
    const w = finite(record?.gridW, 1), d = finite(record?.gridD, 1);
    if (!position || (w <= 1 && d <= 1)) return null;
    const quarterTurn = Math.abs(Math.round(finite(record?.gridRot, 0) / 90)) % 2 === 1;
    return { x: position.x - 0.5 + (quarterTurn ? d : w) / 2, z: position.z - 0.5 + (quarterTurn ? w : d) / 2 };
  }

  function rootKey(root) {
    return String(root?.userData?.authoredFurnitureKey || root?.userData?.furnitureKey || root?.name || '')
      .replace(/^procedural_furniture_/i, '')
      .replace(/^authored_furniture_/i, '')
      .replace(/Furniture$/i, '')
      .toLowerCase();
  }

  function matchFurnitureRoot(record, roots) {
    const position = recordPosition(record);
    if (!position) return null;
    const expectedKey = normalizedFurnitureKey(record);
    let best = null;
    for (const root of roots) {
      root.updateWorldMatrix?.(true, false);
      const p = new THREE.Vector3();
      root.getWorldPosition?.(p);
      const center = recordFootprintCenter(record);
      const distance = Math.min(
        Math.hypot(p.x - position.x, p.z - position.z),
        center ? Math.hypot(p.x - center.x, p.z - center.z) : Infinity,
      );
      const key = rootKey(root);
      const keyPenalty = expectedKey && key && !key.includes(expectedKey) && !expectedKey.includes(key) ? 2 : 0;
      const score = distance + keyPenalty;
      if (!best || score < best.score) best = { root, distance, score };
    }
    return best && best.distance <= 1.6 ? best.root : null;
  }

  async function syncFurnitureSupports(area = activeArea()) {
    const scene = activeScene();
    if (!area || !scene) return { area, registered: 0, missing: 0 };
    const mapData = await loadAuthoredMap(area);
    const records = walkableFurnitureRecords(mapData);
    for (const [id, entry] of supports) {
      if (entry.kind === 'furniture' && (!entry.area || entry.area === area)) {
        unindexEntry(entry);
        supports.delete(id);
      }
    }
    const roots = candidateFurnitureRoots(scene);
    let registered = 0;
    let missing = 0;
    records.forEach((record, index) => {
      const root = matchFurnitureRoot(record, roots);
      if (!root) {
        missing += 1;
        return;
      }
      const id = registerObject(root, {
        id: `furniture:${area}:${record.id || normalizedFurnitureKey(record) || 'piece'}:${index}`,
        kind: 'furniture',
        area,
        sourceId: record.id || null,
        sourceKey: record.itemKey || record.key || null,
      });
      if (id) registered += 1;
    });
    lastFurnitureSyncArea = records.length && missing > 0 ? null : area;
    return { area, registered, missing, authored: records.length };
  }

  let lastFurnitureSyncAttemptAt = 0; // A sync that left furniture unmatched stays "dirty", so retries are spaced out instead of rescanning the scene every render.
  let lastFurnitureSyncAttemptArea = null;
  const FURNITURE_SYNC_RETRY_MS = 2000;

  function scheduleFurnitureSync(area = activeArea()) {
    if (!area || (lastFurnitureSyncArea === area && !activeFurnitureSync)) return;
    if (activeFurnitureSync) return activeFurnitureSync;
    const now = Date.now();
    if (lastFurnitureSyncAttemptArea === area && now - lastFurnitureSyncAttemptAt < FURNITURE_SYNC_RETRY_MS) return;
    lastFurnitureSyncAttemptArea = area;
    lastFurnitureSyncAttemptAt = now;
    activeFurnitureSync = Promise.resolve(syncFurnitureSupports(area))
      .finally(() => { activeFurnitureSync = null; });
    return activeFurnitureSync;
  }

  // NPCs no longer get their support lift stomped onto root.position.y here.
  // game.js's npcSurfaceY() folds surfaceLiftAt() straight into the height
  // every NPC movement/idle branch already targets, so the existing
  // absolute-set and lerp-toward-ground code paths track furniture "stages"
  // correctly on their own — see npcSurfaceY's own comment. A separate
  // post-hoc rewrite here couldn't tell an idle NPC's fresh absolute Y write
  // apart from a walking NPC's incremental lerp toward its own last lifted
  // Y, so it re-added lift on top of lift it had already baked in during the
  // walking case, compounding every frame into runaway upward drift.

  function clearChannel(reason, playerMesh = null) {
    composer.clearChannel(CHANNEL);
    lastDebug = {
      active: false,
      lift: 0,
      terrainLift: 0,
      supportLift: 0,
      supportId: null,
      x: Number.isFinite(Number(playerMesh?.position?.x)) ? Number(playerMesh.position.x) : null,
      z: Number.isFinite(Number(playerMesh?.position?.z)) ? Number(playerMesh.position.z) : null,
      movementOwnedBaseY: Number.isFinite(Number(playerMesh?.position?.y)) ? Number(playerMesh.position.y) : null,
      reason,
    };
  }

  function syncChannel(injectedDeps) {
    runtimeDeps = injectedDeps || runtimeDeps;
    patchHousePieceGen();
    const playerMesh = injectedDeps?.playerMesh || composer.getPlayerMesh?.();
    const area = injectedDeps?.getCurrentArea?.() || activeArea();
    if (!playerMesh?.position) {
      clearChannel('no-player-root');
      return;
    }

    scheduleFurnitureSync(area);

    const sit = injectedDeps?.getSitInteraction?.();
    if (sit && sit.phase !== 'out') {
      clearChannel('seated', playerMesh);
      return;
    }

    const x = finite(playerMesh.position.x, 0);
    const z = finite(playerMesh.position.z, 0);
    const baseY = finite(playerMesh.position.y, 0);
    const terrainLift = area === 'town' ? finite(terrain.sampleHeightAt(x, z), 0) : 0;
    const support = supportAt(x, z, area);
    const supportLift = support ? Math.max(0, support.bounds.topY - support.bounds.baseY) : 0;
    const lift = terrainLift + supportLift;

    // Movement now owns the player's actual world Y, including town visual
    // ground and registered walkable surfaces. The old extra composer lift
    // made the avatar appear raised while its standing physics remained on the
    // flat tile, and would now double-apply the actual floor displacement.
    composer.clearChannel(CHANNEL);
    lastDebug = {
      active: Math.abs(lift) > EPSILON,
      lift,
      terrainLift,
      supportLift,
      supportId: support?.id || null,
      x,
      z,
      movementOwnedBaseY: baseY,
      reason: support ? `${support.kind}-physical-ground` : 'terrain-physical-ground',
    };
  }

  function patchPixelProbe(api) {
    if (!api || api.__hobunjiTownBodyElevationBridge || typeof api.init !== 'function') return api;
    const compatibilityInit = api.init;

    api.init = function townBodyElevationAwarePixelProbeInit(injectedDeps) {
      runtimeDeps = injectedDeps || runtimeDeps;
      const renderer = injectedDeps?.renderer;

      if (renderer) renderer.__hobunjiTownHeightRenderHook = true;

      const result = compatibilityInit.call(this, injectedDeps);
      if (!renderer || typeof renderer.render !== 'function' || renderer.__hobunjiTownBodyElevationRenderHook) return result;

      const baseRender = renderer.render;
      renderer.render = function townBodyElevationRender(...args) {
        syncChannel(injectedDeps);
        return baseRender.apply(this, args);
      };
      renderer.__hobunjiTownBodyElevationRenderHook = true;
      renderer.__hobunjiTransientTownHeightRepair = true;
      return result;
    };

    api.__hobunjiTownBodyElevationBridge = true;
    api.__hobunjiTransientTownHeightRepair = true;
    return api;
  }

  function installPixelProbeHook() {
    if (window.PixelProbe) {
      patchPixelProbe(window.PixelProbe);
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(window, 'PixelProbe');
    if (!descriptor?.configurable || typeof descriptor.set !== 'function') return;
    const priorGet = descriptor.get;
    const priorSet = descriptor.set;
    Object.defineProperty(window, 'PixelProbe', {
      configurable: true,
      enumerable: descriptor.enumerable !== false,
      get() { return priorGet ? priorGet.call(window) : undefined; },
      set(value) {
        priorSet.call(window, value);
        patchPixelProbe(priorGet ? priorGet.call(window) : value);
      },
    });
  }

  function debugSnapshot() {
    const area = activeArea();
    const entries = [...supports.values()]
      .filter(entry => !entry.area || !area || entry.area === area)
      .map(entry => ({
        id: entry.id,
        kind: entry.kind,
        sourceId: entry.sourceId,
        sourceKey: entry.sourceKey,
        activeScene: !entry.owner || objectInActiveScene(entry.owner),
        bounds: { ...entry.bounds },
        bridgeTreads: entry.bridgeFootprints?.length || 0, // Mobile diagnostics show whether oriented bridge support was installed.
      }));
    return {
      ...lastDebug,
      area,
      supportCount: entries.length,
      railingFaceColliders: [...railCollidersByPiece.values()].reduce((total, faces) => total + faces.length, 0), // Mobile elevation debug shows whether narrow railing blockers were registered.
      furnitureSyncArea: lastFurnitureSyncArea,
      furnitureSyncPending: !!activeFurnitureSync,
      supports: entries,
    };
  }

  function installMobileDebugButton() {
    if (!/[?&]walkElevDebug=1(?:&|$)/.test(location.search) || document.getElementById('walkableElevationDebugButton')) return;
    const button = document.createElement('button'); // Used by mobile builds where devtools/console are unavailable.
    button.id = 'walkableElevationDebugButton';
    button.type = 'button';
    button.textContent = 'Elevation Debug';
    button.style.cssText = 'position:fixed;right:8px;top:86px;z-index:100000;padding:8px 10px;font:12px monospace';
    button.addEventListener('click', () => {
      const snapshot = debugSnapshot();
      const text = JSON.stringify(snapshot, null, 2);
      navigator.clipboard?.writeText(text).catch(() => {});
      alert(text);
    });
    document.body.appendChild(button);
  }

  patchHousePieceGen();
  installPixelProbeHook();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMobileDebugButton, { once: true });
  else installMobileDebugButton();

  window.HobunjiWalkableElevation = Object.freeze({
    metadataKey: FURNITURE_METADATA_KEY,
    registerBox,
    registerObject,
    registerPiecePorches,
    registerPieceRails, // Test hooks and building reauthoring can refresh exact railing footprints without rescanning the world.
    railBlocksBox, // Mobile diagnostics can compare a failed move with the visual railing geometry.
    unregister,
    clearKind,
    matchingSupports,
    supportAt,
    surfaceLiftAt,
    worldSurfaceTopAt,
    hasSupports: () => supports.size > 0,
    syncFurnitureSupports,
    refreshFurniture: () => {
      lastFurnitureSyncArea = null;
      lastFurnitureSyncAttemptAt = 0;
      authoredMapCache.clear();
      return scheduleFurnitureSync(activeArea());
    },
    debugSnapshot,
  });
  window.__walkableElevationDebug = debugSnapshot;

  window.HobunjiTownBodyElevationBridge = {
    channel: CHANNEL,
    getDebug() {
      const attachmentDebug = window.PlayerBodyAttachmentBridge?.getDebug?.() || null;
      return {
        ...debugSnapshot(),
        visualRoots: composer.getVisualRoots?.().map(root => root?.name || root?.type || 'Object3D') || [],
        hasToolHolder: attachmentDebug?.hasToolHolder ?? null,
        activeShoulderPets: attachmentDebug?.activeShoulderPets ?? null,
      };
    },
  };
})();
