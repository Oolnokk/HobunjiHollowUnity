// Dev Map Furniture — place any furniture in the repo into the town and
// building interiors from inside the running game, with the same feel as the
// player's own Furniture Placer (pick a piece, aim with the reticle, a
// green/red ghost shows validity, Action 1 places / Action 2 cancels, placed
// pieces can be moved, rotated 45° and removed) plus wall mounting for any
// piece (authored wallOrnament metadata when it exists, the piece's back face
// otherwise).
//
// Authored maps are repo files the browser cannot write, so edits live in a
// dev overlay (localStorage) that is merged into a map's furniture whenever
// the game builds it: building interiors via mergeBuildingFurniture() in
// loadBuildingScene, the town via mergeTownLists() in TownZoneBuildings.
// exportChanges() produces patch-ready JSON for config/maps/<map>.json and
// the town workspace. Driven from the Dev Companion's Map tab.
(() => {
  'use strict';

  if (window.DevMapFurniture) return;

  const STORE_KEY = 'hobunji_dev_map_furniture_v1';
  const TOWN_ID = 'map_hobunji_town';
  const DEG = Math.PI / 180;
  const WALL_PREVIEW_INTERVAL_MS = 100; // Wall raycasts are throttled; floor previews only update when the reticle tile changes.
  const WALL_MAX_DISTANCE = 14;
  const DEFAULT_WALL_ATTACHMENT = Object.freeze({ version: 1, anchor: [0, 0, 0], normal: [0, 0, -1], defaultNormalOffset: 0.02, generic: true }); // Back face of the piece flush to the wall, origin at the aimed point.

  let deps = null;
  const authoredByMap = new Map(); // mapId → { kind:'building'|'town', furniture?, decor? } captured from the last merge (the as-authored lists).
  let session = null; // { mode:'floor'|'wall', key, kind, itemKey, moveId?, ghost, attachment, preview:{valid,col,row,rotY,post,wall,position} }
  let freePlacement = false; // Dev override: skip walkability/overlap checks.
  let wallCandidates = null; // { scene, meshes } cached per scene for wall raycasts.
  let lastWallPreviewAt = 0;
  let lastFloorTileKey = '';
  const claimedActions = new Set();
  let lastResult = null;
  let raycaster = null;
  let ndcCenter = null;

  // ── Store ───────────────────────────────────────────────────────────
  function readStore() {
    try {
      const store = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (store?.version === 1 && store.maps) return store;
    } catch (_) {}
    return { version: 1, maps: {} };
  }
  function writeStore(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return true; } catch (error) {
      lastResult = { ok: false, message: `Could not save the dev furniture overlay: ${error?.message || error}` };
      return false;
    }
  }
  function mapEntry(store, mapId) {
    return store.maps[mapId] || (store.maps[mapId] = { added: [], removed: [], edits: {} });
  }
  function newId() {
    return `devf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  const round = (value, places = 3) => { const p = 10 ** places; return Math.round((Number(value) || 0) * p) / p; };

  // Authored records may not carry ids; this signature is stable for them.
  function authoredRef(record) {
    return record?.id ? String(record.id) : `${record?.itemKey || record?.key || '?'}@${record?.col},${record?.row}`;
  }

  // ── Catalog ─────────────────────────────────────────────────────────
  function decorDefs() { return deps?.getDecorativeFurnitureDefs?.() || {}; }
  function processingDefs() { return deps?.getProcessingFurnitureDefs?.() || {}; }

  function resolveKey(keyOrItemKey) {
    const decor = decorDefs();
    const processing = processingDefs();
    if (decor[keyOrItemKey]) return { key: keyOrItemKey, kind: 'decorative', def: decor[keyOrItemKey] };
    if (processing[keyOrItemKey]) return { key: keyOrItemKey, kind: 'processing', def: processing[keyOrItemKey] };
    for (const [key, def] of Object.entries(decor)) if (def?.itemKey === keyOrItemKey) return { key, kind: 'decorative', def };
    for (const [key, def] of Object.entries(processing)) if (def?.itemKey === keyOrItemKey) return { key, kind: 'processing', def };
    return null;
  }

  function hasWallMetadata(key, def) {
    return !!window.WallOrnamentPlacement?.isWallOrnamentKey?.(key, def);
  }

  function catalog() {
    window.DaylightWindowRuntime?.registerDecorDefs?.(decorDefs());
    const entries = [];
    const decor = decorDefs();
    for (const [key, def] of Object.entries(decor)) {
      if (!def || key.startsWith('__')) continue; // Internal runtime-generated helper defs (seat-surface transforms).
      if (def.procKey && def.procKey !== key && decor[def.procKey]) continue; // Inventory alias of a canonical piece already listed.
      entries.push({ key, kind: 'decorative', itemKey: def.itemKey || null, name: def.name || key, icon: def.icon || '🪑', fw: def.fw || 1, fd: def.fd || 1, wall: hasWallMetadata(key, def), fixture: !!def.fixture, light: !!def.light, sit: !!def.sit });
    }
    for (const [key, def] of Object.entries(processingDefs())) {
      if (!def || key.startsWith('__')) continue;
      entries.push({ key, kind: 'processing', itemKey: def.itemKey || null, name: def.name || key, icon: def.icon || '⚙️', fw: 1, fd: 1, wall: false, fixture: false, light: false, sit: false });
    }
    return entries.sort((a, b) => (b.wall - a.wall) || a.name.localeCompare(b.name));
  }

  // ── Context ─────────────────────────────────────────────────────────
  function currentMapId() {
    const area = deps?.getCurrentArea?.();
    if (area === 'town') return TOWN_ID;
    if (deps?.isBuildingArea?.(area)) return area;
    return null;
  }

  function areaForMap(mapId) {
    return mapId === TOWN_ID ? 'town' : mapId;
  }

  function contextReason() {
    if (!deps) return 'The game has not finished loading.';
    if (!deps.isDevMode?.()) return 'Turn on Dev Mode to place map furniture.';
    const area = deps.getCurrentArea?.();
    if (area === 'farm' || area === 'interior') return 'On your own farm/house, use the normal Furniture menu.';
    if (!currentMapId()) return 'Walk into the town or a building to place furniture there.';
    return null;
  }

  // ── Merge (called while scenes build) ───────────────────────────────
  function applyEdits(record, entry) {
    const edit = entry?.edits?.[authoredRef(record)];
    return edit ? { ...record, ...edit } : record;
  }

  function buildingRecord(record) {
    const resolved = resolveKey(record.key || record.itemKey);
    return {
      id: record.id,
      itemKey: resolved?.def?.itemKey || record.itemKey,
      col: record.col, row: record.row,
      rotY: record.rotY || 0,
      postX: record.postX || 0, postY: record.postY || 0, postZ: record.postZ || 0,
      ...(record.wall ? { devWall: record.wall } : {}),
      devOverlay: true,
    };
  }

  function townRecord(record) {
    return {
      id: record.id, key: record.key, col: record.col, row: record.row,
      rotY: record.rotY || 0, postX: record.postX || 0, postY: record.postY || 0, postZ: record.postZ || 0,
      ...(record.wall ? { devWall: record.wall } : {}),
      devOverlay: true,
    };
  }

  function mergeBuildingFurniture(mapId, authored) {
    const list = Array.isArray(authored) ? authored : [];
    authoredByMap.set(mapId, { kind: 'building', furniture: list.map(item => ({ ...item })) });
    const entry = readStore().maps[mapId];
    if (!entry) return list;
    const removed = new Set(entry.removed || []);
    return list
      .filter(record => !removed.has(authoredRef(record)))
      .map(record => applyEdits(record, entry))
      .concat((entry.added || []).map(buildingRecord));
  }

  function mergeTownLists(townMap) {
    const decor = Array.isArray(townMap?.decor) ? townMap.decor : [];
    const furniture = Array.isArray(townMap?.furniture) ? townMap.furniture : [];
    authoredByMap.set(TOWN_ID, { kind: 'town', decor: decor.map(item => ({ ...item })), furniture: furniture.map(item => ({ ...item })) });
    const entry = readStore().maps[TOWN_ID];
    if (!entry) return { decor, furniture };
    const removed = new Set(entry.removed || []);
    const keep = list => list.filter(record => !removed.has(authoredRef(record))).map(record => applyEdits(record, entry));
    const added = entry.added || [];
    return {
      decor: keep(decor).concat(added.filter(record => record.kind !== 'processing').map(townRecord)),
      furniture: keep(furniture).concat(added.filter(record => record.kind === 'processing').map(townRecord)),
    };
  }

  // ── Placed pieces (authored + overlay) for the current map ──────────
  function placedHere() {
    const mapId = currentMapId();
    if (!mapId) return [];
    const entry = readStore().maps[mapId] || { added: [], removed: [], edits: {} };
    const authored = authoredByMap.get(mapId);
    const removed = new Set(entry.removed || []);
    const out = [];
    const pushAuthored = (record, listName) => {
      const ref = authoredRef(record);
      const merged = applyEdits(record, entry);
      const resolved = resolveKey(record.key || record.itemKey);
      out.push({ ref, source: 'authored', list: listName, key: resolved?.key || record.key || record.itemKey, name: resolved?.def?.name || record.key || record.itemKey, icon: resolved?.def?.icon || '🪑',
        col: merged.col, row: merged.row, rotY: merged.rotY || 0, wall: !!merged.devWall || !!merged.wall, edited: !!entry.edits?.[ref], removed: removed.has(ref) });
    };
    if (authored?.kind === 'building') authored.furniture.forEach(record => pushAuthored(record, 'furniture'));
    if (authored?.kind === 'town') { authored.decor.forEach(record => pushAuthored(record, 'decor')); authored.furniture.forEach(record => pushAuthored(record, 'furniture')); }
    for (const record of entry.added || []) {
      const resolved = resolveKey(record.key);
      out.push({ ref: record.id, source: 'overlay', key: record.key, name: resolved?.def?.name || record.key, icon: resolved?.def?.icon || '🪑', col: record.col, row: record.row, rotY: record.rotY || 0, wall: !!record.wall, edited: false, removed: false });
    }
    return out;
  }

  // Footprint tiles occupied by every live piece except `ignoreRef`.
  function occupiedTiles(ignoreRef) {
    const tiles = new Set();
    for (const piece of placedHere()) {
      if (piece.removed || piece.wall || piece.ref === ignoreRef) continue;
      const { fw, fd } = sizeFor(piece.key, piece.rotY);
      for (let dc = 0; dc < fw; dc++) for (let dr = 0; dr < fd; dr++) tiles.add(`${piece.col + dc},${piece.row + dr}`);
    }
    return tiles;
  }

  function sizeFor(key, rotY = 0) {
    const resolved = resolveKey(key);
    if (resolved?.kind === 'decorative' && deps?.decorativeFurnitureSize) return deps.decorativeFurnitureSize(resolved.key, rotY || 0);
    return { fw: 1, fd: 1 };
  }

  function floorValid(key, col, row, rotY, ignoreRef, ignoreTiles = null) {
    if (freePlacement) return true;
    const area = deps.getCurrentArea();
    const { fw, fd } = sizeFor(key, rotY);
    const occupied = occupiedTiles(ignoreRef);
    for (let dc = 0; dc < fw; dc++) {
      for (let dr = 0; dr < fd; dr++) {
        const c = col + dc, r = row + dr;
        if (occupied.has(`${c},${r}`)) return false;
        if (ignoreTiles?.has(`${c},${r}`)) continue; // A piece's own collider tiles never block moving/rotating it in place.
        if (!deps.isTileWalkable(area, c, r)) return false;
      }
    }
    return true;
  }

  // Root position the spawn code uses before post offsets, so overlay post
  // fields reproduce an exact world transform (see loadBuildingScene /
  // spawnTownDecorFurniture).
  function spawnBase(mapId, key, col, row) {
    const resolved = resolveKey(key);
    const def = resolved?.def || {};
    const processingInTown = mapId === TOWN_ID && resolved?.kind === 'processing';
    return {
      x: col + (processingInTown ? 0.5 : (def.fw || 1) * 0.5),
      y: deps.furnitureBaseY(areaForMap(mapId), col, row),
      z: row + (processingInTown ? 0.5 : (def.fd || 1) * 0.5),
    };
  }

  // ── Wall picking ────────────────────────────────────────────────────
  function isFurnitureOrActor(node) {
    let current = node;
    while (current) {
      if (current === session?.ghost || current === deps.playerMesh) return true;
      const name = String(current.name || '');
      if (/^(authored|procedural)_furniture_/i.test(name) || current.userData?.mapEditorRef || current.userData?.wallOrnamentProxy) return true;
      if (deps.isActorRoot?.(current)) return true;
      current = current.parent;
    }
    return false;
  }

  // Surfaces the game itself marks as walls (same tags the player's wall
  // placer trusts, plus WallBuilder brick instances used by building rooms).
  function isTaggedWall(node) {
    let current = node;
    while (current) {
      const data = current.userData || {};
      if (data.isWallBricks || data.interiorWallSurfaceGroup || data.interiorWallPanelId || data.interiorWallPlane || data.housePieceWallSurface) return true;
      if (/^Wall[:_]|WallBuilder/i.test(String(current.name || ''))) return true;
      current = current.parent;
    }
    return false;
  }

  function ensureWallCandidates() {
    const scene = deps.getActiveScene?.();
    if (wallCandidates?.scene === scene) return wallCandidates.meshes;
    const tagged = [];
    const generic = [];
    scene?.traverse?.(node => { // Once per scene (and after rebuilds), never per frame.
      if (!node?.isMesh || node.visible === false) return;
      if (/TransformControls|Gizmo|Helper|skydome|cloud/i.test(String(node.name || ''))) return;
      if (isFurnitureOrActor(node)) return;
      if (isTaggedWall(node)) tagged.push(node);
      else if (node.geometry?.type !== 'PlaneGeometry') generic.push(node); // Sprite billboards (creatures, NPC parts) are planes; never wall targets.
    });
    const meshes = tagged.length ? tagged : generic; // Untagged scenes (rare) fall back to any solid vertical surface.
    wallCandidates = { scene, meshes, tagged: tagged.length > 0 };
    return meshes;
  }

  function wallHit() {
    const THREE = window.THREE;
    if (!THREE || !deps.camera) return null;
    raycaster = raycaster || new THREE.Raycaster();
    ndcCenter = ndcCenter || new THREE.Vector2(0, 0);
    raycaster.setFromCamera(ndcCenter, deps.camera);
    raycaster.far = 60;
    const hits = raycaster.intersectObjects(ensureWallCandidates(), false);
    const playerPos = deps.playerMesh?.position;
    for (const hit of hits) {
      if (!hit?.face?.normal || !hit.point || hit.object?.visible === false) continue;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (Math.abs(normal.y) > 0.72) continue;
      normal.y = 0;
      if (normal.lengthSq() < 1e-6) continue;
      normal.normalize();
      if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
      if (playerPos && Math.hypot(hit.point.x - playerPos.x, hit.point.z - playerPos.z) > WALL_MAX_DISTANCE) return null;
      return { point: hit.point, normal };
    }
    return null;
  }

  // Diagnostics: what the center ray hits and why a wall isn't accepted.
  function debugWallProbe() {
    const THREE = window.THREE;
    if (!THREE || !deps?.camera) return null;
    const meshes = ensureWallCandidates();
    const probe = new THREE.Raycaster();
    probe.setFromCamera(new THREE.Vector2(0, 0), deps.camera);
    const all = [];
    deps.getActiveScene?.()?.traverse?.(node => { if (node.isMesh) all.push(node); });
    const describe = hit => {
      const normal = hit.face?.normal ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
      let chain = [], current = hit.object;
      while (current && chain.length < 4) { chain.push(current.name || current.type); current = current.parent; }
      return { chain: chain.join(' < '), distance: round(hit.distance, 2), normalY: normal ? round(normal.y, 2) : null, candidate: meshes.includes(hit.object) };
    };
    return { candidates: meshes.length, sceneMeshes: all.length, hits: probe.intersectObjects(all, false).slice(0, 6).map(describe) };
  }

  function wallPlacementFromHit(hit, attachment) {
    return {
      version: 5,
      wallPoint: [round(hit.point.x), round(hit.point.y), round(hit.point.z)],
      wallNormal: [round(hit.normal.x, 6), 0, round(hit.normal.z, 6)],
      offsetU: 0, offsetV: 0,
      normalOffset: round(Number(attachment?.defaultNormalOffset) || 0.01),
      space: 'wall-surface-uvn',
    };
  }

  // Wall placement → the ordinary col/row/rotY/post fields the spawners read.
  function wallRecordFields(mapId, key, attachment, placement) {
    const api = window.WallOrnamentPlacement;
    const solved = api?.deriveTransform?.(attachment, placement);
    if (!solved) return null;
    const [px, py, pz] = solved.position;
    const inward = 0.5; // Anchor on the walkable tile in front of the wall: its floor height is fixed, unlike the solid wall-edge tile whose surface changes once colliders are tagged.
    const col = Math.floor(placement.wallPoint[0] + placement.wallNormal[0] * inward);
    const row = Math.floor(placement.wallPoint[2] + placement.wallNormal[2] * inward);
    const base = spawnBase(mapId, key, col, row);
    return {
      col, row,
      rotY: round(solved.rotY, 2),
      postX: round(px - base.x), postY: round(py - base.y), postZ: round(pz - base.z),
      wall: placement,
      position: { x: px, y: py, z: pz },
    };
  }

  async function attachmentFor(key) {
    const resolved = resolveKey(key);
    if (!resolved) return null;
    if (hasWallMetadata(resolved.key, resolved.def)) {
      const authored = await window.WallOrnamentPlacement?.loadAttachment?.(resolved.key, resolved.def);
      if (authored) return authored;
    }
    return DEFAULT_WALL_ATTACHMENT;
  }

  // ── Ghost ───────────────────────────────────────────────────────────
  function disposeGhost() {
    const ghost = session?.ghost;
    if (!ghost) return;
    ghost.parent?.remove(ghost);
    ghost.traverse?.(child => {
      if (child.geometry) child.geometry.dispose?.();
      if (child.material) child.material.dispose?.();
    });
    session.ghost = null;
  }

  function ensureGhost() {
    const scene = deps.getActiveScene?.();
    if (!session || !scene) return null;
    if (session.ghost && session.ghost.parent === scene) return session.ghost;
    disposeGhost();
    const THREE = window.THREE;
    const group = deps.buildFurnitureVisual(session.key, 0x5cff7a);
    const material = new THREE.MeshBasicMaterial({ color: 0x5cff7a, transparent: true, opacity: 0.58, depthWrite: false });
    group.traverse(child => { if (child.isMesh) child.material = material.clone(); });
    group.renderOrder = 1000;
    group.name = 'dev_map_furniture_ghost';
    scene.add(group);
    session.ghost = group;
    session.ghostColor = null;
    return group;
  }

  function tintGhost(valid) {
    const color = valid ? 0x5cff7a : 0xff5555;
    if (!session?.ghost || session.ghostColor === color) return;
    session.ghostColor = color;
    session.ghost.traverse(child => { if (child.isMesh) child.material.color.set(color); });
  }

  // ── Session ─────────────────────────────────────────────────────────
  function isActive() {
    return !!session && !!currentMapId();
  }

  async function arm({ key, mode = 'floor', moveRef = null } = {}) {
    const reason = contextReason();
    if (reason) return { ok: false, error: reason };
    const piece = moveRef ? placedHere().find(entry => entry.ref === moveRef) : null;
    const resolved = resolveKey(piece?.key || key);
    if (!resolved) return { ok: false, error: `Unknown furniture "${key}".` };
    if (mode === 'wall' && resolved.kind === 'processing') return { ok: false, error: 'Processing stations stand on the floor.' };
    if (currentMapId() !== TOWN_ID && !resolved.def?.itemKey) return { ok: false, error: `${resolved.def?.name || resolved.key} has no item key, so building interiors can't store it.` };
    cancel(false);
    session = { mode, key: resolved.key, kind: resolved.kind, itemKey: resolved.def?.itemKey || null, moveRef: piece?.ref || null, rotY: piece?.rotY || 0, ghost: null, attachment: null, preview: null };
    if (mode === 'wall') session.attachment = await attachmentFor(resolved.key);
    if (!session) return { ok: false, error: 'Cancelled.' };
    window.__devMapFurniturePlacementActive = true;
    lastFloorTileKey = '';
    lastWallPreviewAt = 0;
    update(true);
    deps.refreshActionBar?.();
    const verb = piece ? 'Move' : 'Place';
    deps.showToast?.(mode === 'wall'
      ? `${verb} ${resolved.def?.name || resolved.key}: aim at a wall, Action 1 mounts it, Action 2 cancels.${session.attachment?.generic ? ' (No authored wall face — mounting by its back.)' : ''}`
      : `${verb} ${resolved.def?.name || resolved.key}: aim at a tile, Action 1 places, Action 2 cancels.`, true);
    return { ok: true };
  }

  function cancel(showMessage = true) {
    const was = !!session;
    disposeGhost();
    session = null;
    window.__devMapFurniturePlacementActive = false;
    claimedActions.clear();
    if (was) deps?.refreshActionBar?.();
    if (was && showMessage) deps?.showToast?.('Map furniture placement cancelled.', true);
    return was;
  }

  function rotateArmed(degrees = 45) {
    if (!session || session.mode !== 'floor') return { ok: false, error: 'Nothing armed for floor placement.' };
    session.rotY = ((session.rotY || 0) + degrees + 360) % 360;
    lastFloorTileKey = '';
    update(true);
    return { ok: true, rotY: session.rotY };
  }

  // Per-frame from game.js's loop while active: floor previews follow the
  // reticle tile (recomputed only when it changes); wall previews raycast at
  // WALL_PREVIEW_INTERVAL_MS.
  function update(force = false) {
    if (!session) return;
    const mapId = currentMapId();
    if (!mapId) { cancel(false); return; }
    const ghost = ensureGhost();
    if (!ghost) return;
    if (session.mode === 'floor') {
      const tile = deps.getReticleTile();
      const tileKey = `${tile.col},${tile.row},${session.rotY}`;
      if (!force && tileKey === lastFloorTileKey) return;
      lastFloorTileKey = tileKey;
      const ownTiles = session.moveRef ? ownColliderTiles(session.moveRef) : null;
      const valid = floorValid(session.key, tile.col, tile.row, session.rotY, session.moveRef, ownTiles);
      const base = spawnBase(mapId, session.key, tile.col, tile.row);
      ghost.position.set(base.x, base.y + 0.04, base.z);
      ghost.rotation.set(0, session.rotY * DEG, 0);
      ghost.visible = true;
      tintGhost(valid);
      session.preview = { valid, col: tile.col, row: tile.row, rotY: session.rotY, postX: 0, postY: 0, postZ: 0, wall: null };
      deps.refreshActionBar?.();
      return;
    }
    const now = performance.now();
    if (!force && now - lastWallPreviewAt < WALL_PREVIEW_INTERVAL_MS) return;
    lastWallPreviewAt = now;
    const hit = wallHit();
    const wasValid = !!session.preview?.valid;
    if (!hit || !session.attachment) {
      ghost.visible = false;
      session.preview = { valid: false };
    } else {
      const fields = wallRecordFields(mapId, session.key, session.attachment, wallPlacementFromHit(hit, session.attachment));
      if (!fields) { ghost.visible = false; session.preview = { valid: false }; }
      else {
        ghost.position.set(fields.position.x, fields.position.y, fields.position.z);
        ghost.rotation.set(0, fields.rotY * DEG, 0);
        ghost.visible = true;
        tintGhost(true);
        session.preview = { valid: true, ...fields };
      }
    }
    if (wasValid !== !!session.preview.valid) deps.refreshActionBar?.();
  }

  function ownColliderTiles(ref) {
    const piece = placedHere().find(entry => entry.ref === ref);
    if (!piece) return null;
    const { fw, fd } = sizeFor(piece.key, piece.rotY);
    const tiles = new Set();
    for (let dc = 0; dc < fw; dc++) for (let dr = 0; dr < fd; dr++) tiles.add(`${piece.col + dc},${piece.row + dr}`);
    return tiles;
  }

  function canConfirm() {
    return !!session?.preview?.valid;
  }

  async function confirm() {
    if (!session) return { ok: false, error: 'Nothing armed.' };
    update(true);
    const preview = session.preview;
    if (!preview?.valid) {
      const message = session.mode === 'wall' ? 'Aim at a wall surface within reach first.' : 'Cannot place furniture here.';
      deps.showToast?.(message, false);
      return { ok: false, error: message };
    }
    const mapId = currentMapId();
    const fields = { col: preview.col, row: preview.row, rotY: preview.rotY || 0, postX: preview.postX || 0, postY: preview.postY || 0, postZ: preview.postZ || 0, wall: preview.wall || null };
    const store = readStore();
    const entry = mapEntry(store, mapId);
    const resolved = resolveKey(session.key);
    if (session.moveRef) {
      const added = entry.added.find(record => record.id === session.moveRef);
      if (added) Object.assign(added, fields);
      else entry.edits[session.moveRef] = { ...(entry.edits[session.moveRef] || {}), ...stripForEdit(fields) };
    } else {
      entry.added.push({ id: newId(), key: session.key, kind: session.kind, itemKey: session.itemKey, ...fields, placedAt: Date.now() });
    }
    if (!writeStore(store)) return { ok: false, error: lastResult?.message };
    const moved = !!session.moveRef;
    if (moved) cancel(false);
    else lastFloorTileKey = ''; // Stays armed for repeated placement, like an unlimited stack in the Furniture menu.
    await refreshScene();
    const message = `${resolved?.def?.icon || '🪑'} ${resolved?.def?.name || session?.key || 'Furniture'} ${moved ? 'moved' : (fields.wall ? 'mounted' : 'placed')} (dev overlay).`;
    lastResult = { ok: true, message, at: Date.now() };
    deps.showToast?.(message, true);
    return { ok: true, message };
  }

  // Authored edits store wall placement under devWall so the original
  // authored `wall` field (if any) is never confused with overlay data.
  function stripForEdit(fields) {
    const { wall, ...rest } = fields;
    return wall ? { ...rest, devWall: wall } : { ...rest, devWall: null };
  }

  async function refreshScene() {
    const mapId = currentMapId();
    wallCandidates = null;
    if (!mapId) return;
    try {
      if (mapId === TOWN_ID) deps.respawnTownFurniture();
      else await deps.rebuildBuildingInPlace(mapId);
    } catch (error) {
      lastResult = { ok: false, message: `Scene refresh failed: ${error?.message || error}`, at: Date.now() };
      deps.showToast?.(lastResult.message, false);
    }
    if (session) { disposeGhost(); lastFloorTileKey = ''; update(true); }
  }

  // ── Placed-piece actions ────────────────────────────────────────────
  async function rotatePiece(ref, degrees = 45) {
    const mapId = currentMapId();
    const piece = placedHere().find(entry => entry.ref === ref);
    if (!mapId || !piece) return { ok: false, error: 'Furniture not found.' };
    if (piece.wall) return { ok: false, error: 'Wall-mounted pieces follow their wall; use Move to remount.' };
    const nextRot = ((piece.rotY || 0) + degrees + 360) % 360;
    if (!floorValid(piece.key, piece.col, piece.row, nextRot, ref, ownColliderTiles(ref))) return { ok: false, error: 'Cannot rotate here — the turned furniture would overlap a wall or another item.' };
    const store = readStore();
    const entry = mapEntry(store, mapId);
    const added = entry.added.find(record => record.id === ref);
    if (added) added.rotY = nextRot;
    else entry.edits[ref] = { ...(entry.edits[ref] || {}), rotY: nextRot };
    writeStore(store);
    await refreshScene();
    return { ok: true, message: `${piece.icon} ${piece.name} rotated 45°.` };
  }

  async function removePiece(ref) {
    const mapId = currentMapId();
    const piece = placedHere().find(entry => entry.ref === ref);
    if (!mapId || !piece) return { ok: false, error: 'Furniture not found.' };
    const store = readStore();
    const entry = mapEntry(store, mapId);
    if (piece.source === 'overlay') entry.added = entry.added.filter(record => record.id !== ref);
    else if (!entry.removed.includes(ref)) entry.removed.push(ref);
    writeStore(store);
    await refreshScene();
    return { ok: true, message: `${piece.icon} ${piece.name} removed (dev overlay).` };
  }

  async function restorePiece(ref) {
    const mapId = currentMapId();
    if (!mapId) return { ok: false, error: 'Not on an authored map.' };
    const store = readStore();
    const entry = mapEntry(store, mapId);
    entry.removed = entry.removed.filter(item => item !== ref);
    delete entry.edits[ref];
    writeStore(store);
    await refreshScene();
    return { ok: true, message: 'Restored to its authored placement.' };
  }

  // Small wall-space nudges (U along the wall, V up, N away from it) for a
  // mounted piece; applied to the live mesh without rebuilding the room.
  async function nudgeWall(ref, { du = 0, dv = 0, dn = 0 } = {}) {
    const mapId = currentMapId();
    const piece = placedHere().find(entry => entry.ref === ref);
    if (!mapId || !piece?.wall) return { ok: false, error: 'Select a wall-mounted piece.' };
    const store = readStore();
    const entry = mapEntry(store, mapId);
    const added = entry.added.find(record => record.id === ref);
    const placement = { ...(added ? added.wall : entry.edits[ref]?.devWall) };
    if (!placement?.wallPoint) return { ok: false, error: 'This piece was mounted outside the dev overlay; use Move to remount it here first.' };
    placement.offsetU = round((Number(placement.offsetU) || 0) + du);
    placement.offsetV = round((Number(placement.offsetV) || 0) + dv);
    placement.normalOffset = round((Number(placement.normalOffset) || 0) + dn);
    const attachment = await attachmentFor(piece.key);
    const fields = wallRecordFields(mapId, piece.key, attachment, placement);
    if (!fields) return { ok: false, error: 'Could not solve the wall transform.' };
    const { position, ...record } = fields;
    if (added) Object.assign(added, record);
    else entry.edits[ref] = { ...(entry.edits[ref] || {}), ...stripForEdit(record) };
    writeStore(store);
    const mesh = findMesh(ref);
    if (mesh) {
      mesh.position.set(position.x, position.y, position.z);
      mesh.rotation.y = fields.rotY * DEG;
      return { ok: true };
    }
    await refreshScene();
    return { ok: true };
  }

  function findMesh(ref) {
    let found = null;
    deps.getActiveScene?.()?.traverse?.(node => { // Explicit user action only.
      if (found) return;
      const editorRef = node.userData?.mapEditorRef;
      if (editorRef && (editorRef.id === ref || `${editorRef.itemKey || editorRef.key}@${editorRef.col},${editorRef.row}` === ref)) found = node;
    });
    return found;
  }

  // Map Edit gizmo drags on an overlay piece land here instead of the
  // standalone Map Editor (which has never heard of it).
  function applyGizmoTransform(ref, transform) {
    const mapId = currentMapId();
    if (!mapId || !ref || !transform) return false;
    const store = readStore();
    const entry = mapEntry(store, mapId);
    const added = entry.added.find(record => record.id === ref);
    if (!added) return false;
    Object.assign(added, {
      postX: transform.postX ?? added.postX, postY: transform.postY ?? added.postY, postZ: transform.postZ ?? added.postZ,
      rotY: transform.rotY ?? added.rotY,
    });
    writeStore(store);
    return true;
  }

  async function discardMap(mapId = currentMapId()) {
    const store = readStore();
    delete store.maps[mapId];
    writeStore(store);
    if (mapId === currentMapId()) await refreshScene();
    return { ok: true };
  }

  // Patch-ready output per map: the overlay itself plus the merged list(s)
  // that can replace the authored arrays in the repo file.
  function exportChanges() {
    const store = readStore();
    const maps = [];
    for (const [mapId, entry] of Object.entries(store.maps)) {
      if (!entry.added?.length && !entry.removed?.length && !Object.keys(entry.edits || {}).length) continue;
      const authored = authoredByMap.get(mapId);
      const cleanBuilding = record => { const { devOverlay, devWall, ...rest } = record; return rest; };
      const result = {
        mapId,
        target: mapId === TOWN_ID ? 'config/town-workspace-v1.json → maps[map_hobunji_town].decor / .furniture (or the Map Editor)' : `config/maps/${mapId}.json → furniture (or the Building Interior Editor)`,
        added: entry.added, removed: entry.removed, edits: entry.edits,
      };
      if (authored?.kind === 'building') result.mergedFurniture = mergeBuildingFurniture(mapId, authored.furniture).map(cleanBuilding);
      else if (authored?.kind === 'town') {
        const merged = mergeTownLists({ decor: authored.decor, furniture: authored.furniture });
        result.mergedDecor = merged.decor.map(cleanBuilding);
        result.mergedFurniture = merged.furniture.map(cleanBuilding);
      } else result.note = 'Visit this map once in this session to include its merged authored list.';
      maps.push(result);
    }
    return { schema: 'hobunji_dev_map_furniture_export.v1', exportedAt: new Date().toISOString(), maps };
  }

  function changeCounts(mapId = currentMapId()) {
    const entry = readStore().maps[mapId];
    return { added: entry?.added?.length || 0, removed: entry?.removed?.length || 0, edited: Object.keys(entry?.edits || {}).length };
  }

  // ── Input (same claim pattern as WallOrnamentPlacement) ─────────────
  function handleGameplayAction(actionId, phase = 'press') {
    const id = String(actionId || '');
    if (phase === 'release' && claimedActions.has(id)) { claimedActions.delete(id); return true; }
    if (!isActive() || phase !== 'press' || (id !== 'action1' && id !== 'action2')) return false;
    claimedActions.add(id);
    if (id === 'action1') confirm(); else cancel(true);
    return true;
  }

  function actionButtons() {
    if (!isActive()) return null;
    return [
      { icon: '✓', label: session.moveRef ? 'Move Here' : (session.mode === 'wall' ? 'Mount' : 'Place'), action: 'dev_furniture_confirm', style: 'primary', allowed: canConfirm() },
      { icon: '✕', label: 'Cancel', action: 'dev_furniture_cancel', style: 'secondary', allowed: true },
    ];
  }

  function handleArchAction(action) {
    if (action === 'dev_furniture_confirm') { confirm(); return true; }
    if (action === 'dev_furniture_cancel') { cancel(true); return true; }
    return false;
  }

  // ── Dev Companion ───────────────────────────────────────────────────
  function companionState() {
    const reason = contextReason();
    const mapId = currentMapId();
    return {
      available: !reason,
      reason,
      mapId,
      freePlacement,
      counts: mapId ? changeCounts(mapId) : null,
      totalMapsChanged: Object.keys(readStore().maps).length,
      armed: session ? { key: session.key, mode: session.mode, moveRef: session.moveRef, rotY: session.rotY, valid: !!session.preview?.valid, generic: !!session.attachment?.generic } : null,
      placed: reason ? [] : placedHere(),
      lastResult,
    };
  }

  function registerCompanion() {
    const companion = window.DevCompanion;
    if (!companion) return;
    companion.registerStateProvider('furniture', companionState);
    companion.registerCommand('furniture-catalog', () => ({ ok: true, items: catalog() }));
    companion.registerCommand('furniture', async args => {
      switch (String(args.action || '')) {
        case 'arm': return arm({ key: args.key, mode: args.mode === 'wall' ? 'wall' : 'floor' });
        case 'move': return arm({ moveRef: args.ref, mode: args.wall ? 'wall' : 'floor' });
        case 'confirm': return confirm();
        case 'cancel': cancel(true); return { ok: true };
        case 'rotate-armed': return rotateArmed(Number(args.degrees) || 45);
        case 'rotate': return rotatePiece(args.ref, Number(args.degrees) || 45);
        case 'remove': return removePiece(args.ref);
        case 'restore': return restorePiece(args.ref);
        case 'nudge-wall': return nudgeWall(args.ref, args);
        case 'free': freePlacement = !!args.enabled; if (session) { lastFloorTileKey = ''; update(true); } return { ok: true };
        case 'export': return { ok: true, text: JSON.stringify(exportChanges(), null, 2) };
        case 'discard': return discardMap();
        default: return { ok: false, error: `Unknown furniture action "${args.action}".` };
      }
    });
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    registerCompanion();
  }

  window.DevMapFurniture = {
    init,
    mergeBuildingFurniture,
    mergeTownLists,
    catalog,
    arm,
    cancel,
    confirm,
    update,
    isActive,
    canConfirm,
    handleGameplayAction,
    actionButtons,
    handleArchAction,
    applyGizmoTransform,
    rotatePiece,
    removePiece,
    restorePiece,
    nudgeWall,
    exportChanges,
    discardMap,
    placedHere,
    debugState: companionState,
    debugWallProbe,
  };
})();
