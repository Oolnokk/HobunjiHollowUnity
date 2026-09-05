// Renders authored subtle terrain lift plus opt-in walkable porch/furniture
// support surfaces without handing permanent ownership of actor Y to a second
// movement system.
//
// Porches are derived from House Piece Author extension geometry. Furniture
// uses a THREE.Box3 calculated from the complete rendered object and is enabled
// per placed instance with `walkableElevation: true` in the map JSON.
//
// The player receives the support lift through the existing
// PlayerBodyTransformComposer channel. Other systems can use
// HobunjiWalkableElevation.surfaceLiftAt/worldSurfaceTopAt so the same support
// registry remains the single source of truth.
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

  function registerBox(bounds, options = {}) {
    const normalized = normalizeBounds(bounds);
    if (!normalized) return null;
    const id = String(options.id || `walk_support_${nextSupportId++}`); // Used to replace/reuse the same authored support deterministically.
    supports.set(id, {
      id,
      kind: options.kind || 'surface',
      area: options.area || null,
      sourceKey: options.sourceKey || null,
      sourceId: options.sourceId || null,
      owner: options.owner || null,
      bounds: normalized,
    });
    return id;
  }

  function registerObject(object, options = {}) {
    if (!object || !window.THREE?.Box3) return null;
    try {
      object.updateWorldMatrix?.(true, true);
      const box = new THREE.Box3().setFromObject(object); // Full rendered geometry is intentionally the collider source.
      if (box.isEmpty()) return null;
      const baseY = finite(box.min.y, NaN);
      const topY = finite(box.max.y, NaN);
      return registerBox({
        minX: box.min.x,
        maxX: box.max.x,
        minZ: box.min.z,
        maxZ: box.max.z,
        baseY,
        topY,
      }, { ...options, owner: object });
    } catch (error) {
      console.warn('[walkable-elevation] furniture bounds failed:', error);
      return null;
    }
  }

  function unregister(id) {
    return supports.delete(String(id || ''));
  }

  function clearKind(kind) {
    for (const [id, entry] of supports) {
      if (entry.kind === kind) supports.delete(id);
    }
  }

  function matchingSupports(worldX, worldZ, area = activeArea()) {
    const x = finite(worldX, NaN);
    const z = finite(worldZ, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
    const matches = [];
    for (const entry of supports.values()) {
      if (entry.area && area && entry.area !== area) continue;
      if (entry.owner && !objectInActiveScene(entry.owner)) continue;
      const b = entry.bounds;
      if (x < b.minX - SUPPORT_EDGE_EPSILON || x > b.maxX + SUPPORT_EDGE_EPSILON
          || z < b.minZ - SUPPORT_EDGE_EPSILON || z > b.maxZ + SUPPORT_EDGE_EPSILON) continue;
      matches.push(entry);
    }
    return matches;
  }

  function supportAt(worldX, worldZ, area = activeArea()) {
    const matches = matchingSupports(worldX, worldZ, area);
    return matches.sort((a, b) => (b.bounds.topY - b.bounds.baseY) - (a.bounds.topY - a.bounds.baseY))[0] || null;
  }

  function surfaceLiftAt(worldX, worldZ, area = activeArea()) {
    const entry = supportAt(worldX, worldZ, area);
    return entry ? Math.max(0, entry.bounds.topY - entry.bounds.baseY) : 0;
  }

  function worldSurfaceTopAt(worldX, worldZ, fallbackY = 0, area = activeArea()) {
    const entry = supportAt(worldX, worldZ, area);
    return entry ? entry.bounds.topY : finite(fallbackY, 0);
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
      if (String(face?.extensionType || face?.tag || '') !== extensionType) continue;
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

  function patchHousePieceGen() {
    const api = window.HousePieceGen;
    if (!api?.buildGroupFromPiece || api.buildGroupFromPiece.__walkableElevationPatched) return false;
    const originalBuild = api.buildGroupFromPiece;
    const wrappedBuild = function walkablePorchAwareBuild(THREEArg, piece, gridX, gridZ, options) {
      const group = originalBuild.apply(this, arguments);
      try { registerPiecePorches(group, piece, gridX, gridZ, options || {}); }
      catch (error) { console.warn('[walkable-elevation] porch registration failed:', error); }
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
      const distance = Math.hypot(p.x - position.x, p.z - position.z);
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
      if (entry.kind === 'furniture' && (!entry.area || entry.area === area)) supports.delete(id);
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

  function scheduleFurnitureSync(area = activeArea()) {
    if (!area || (lastFurnitureSyncArea === area && !activeFurnitureSync)) return;
    if (activeFurnitureSync) return activeFurnitureSync;
    activeFurnitureSync = Promise.resolve(syncFurnitureSupports(area))
      .finally(() => { activeFurnitureSync = null; });
    return activeFurnitureSync;
  }

  function npcWalkersFromDeps(injectedDeps) {
    const direct = injectedDeps?.getNpcWalkers?.()
      || injectedDeps?.npcWalkers
      || window.__hobunjiFurnitureDebug?.getNpcWalkers?.()
      || null;
    if (!direct) return [];
    if (Array.isArray(direct)) return direct;
    try { return [...direct]; } catch (_) { return [];
    }
  }

  function syncNpcSupportLift(injectedDeps, area) {
    const walkers = npcWalkersFromDeps(injectedDeps); // Reuses the live NPC walker roots rather than maintaining a parallel NPC registry.
    for (const walker of walkers) {
      const root = walker?.root || walker?.avatarRef?.group;
      if (!root?.position || (walker.area && area && walker.area !== area)) continue;
      if (walker.pose === 'sit' || walker.state === 'sit' || walker.seated === true) continue;
      const debug = root.userData = root.userData || {};
      const previousFinalY = finite(debug.walkableElevationFinalY, NaN); // Used to distinguish an untouched prior visual lift from a fresh movement-system Y write.
      const previousBaseY = finite(debug.walkableElevationBaseY, NaN);
      const currentY = finite(root.position.y, 0);
      const baseY = Number.isFinite(previousFinalY) && Math.abs(currentY - previousFinalY) <= 1e-5 && Number.isFinite(previousBaseY)
        ? previousBaseY
        : currentY;
      const world = new THREE.Vector3(); // Used to sample support at the NPC walker's actual rendered X/Z position.
      root.getWorldPosition?.(world);
      if (!Number.isFinite(world.x) || !Number.isFinite(world.z)) {
        world.x = finite(root.position.x, 0);
        world.z = finite(root.position.z, 0);
      }
      const lift = surfaceLiftAt(world.x, world.z, area);
      root.position.y = baseY + lift;
      debug.walkableElevationBaseY = baseY;
      debug.walkableElevationFinalY = root.position.y;
      debug.walkableElevationLift = lift;
    }
  }

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
    syncNpcSupportLift(injectedDeps, area);

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

    if (Math.abs(lift) > EPSILON) {
      composer.setChannel(CHANNEL, {
        priority: CHANNEL_PRIORITY,
        mode: 'additive',
        translationMode: 'additive',
        translation: { x: 0, y: lift, z: 0 },
      });
      lastDebug = {
        active: true,
        lift,
        terrainLift,
        supportLift,
        supportId: support?.id || null,
        x,
        z,
        movementOwnedBaseY: baseY,
        reason: support ? `${support.kind}-support` : 'town-subtle-height',
      };
    } else {
      clearChannel('zero-lift', playerMesh);
    }
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
      }));
    return {
      ...lastDebug,
      area,
      supportCount: entries.length,
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
    unregister,
    clearKind,
    matchingSupports,
    supportAt,
    surfaceLiftAt,
    worldSurfaceTopAt,
    syncFurnitureSupports,
    refreshFurniture: () => {
      lastFurnitureSyncArea = null;
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
