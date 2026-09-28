// Shared occupancy for the Random Test Ruin. Walls, doors and push blocks are
// tile-aligned and are stamped into the ordinary interior grid; every other
// solid prop is an exact oriented footprint (js/dev-random-ruin-solid-footprints.js)
// served to game.js movement through window.AreaFootprintBlockers. Gameplay
// collision, traversal modules, the solvability audit and the Map tab all
// read this one model.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const BLOCKER_ID = 'devruin-tile-occupancy';
  const DS = window.DynamicSurfaces;
  const GridTileAccessors = window.GridTileAccessors;
  const WildernessMap = window.WildernessMap;
  const SolidFootprints = window.DevRandomRuinSolidFootprints;
  const FootprintBlockers = window.AreaFootprintBlockers;
  if (!DS || !GridTileAccessors || !WildernessMap || !window.THREE || !SolidFootprints) return;

  let activeModel = null; // The session-only ruin snapshot currently used by collision and Map.
  let originalLegendHtml = null; // Wilderness legend restored after leaving the diagnostic ruin.
  const nativeRenderMapPanel = WildernessMap.renderMapPanel.bind(WildernessMap);

  const keyFor = (col, row) => `${col},${row}`;
  const sortedKeys = keys => [...keys].sort((a, b) => {
    const [ac, ar] = a.split(',').map(Number), [bc, br] = b.split(',').map(Number);
    return ar - br || ac - bc;
  });

  function worldBox(object) {
    if (!object) return null;
    object.updateWorldMatrix?.(true, true);
    object.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(object);
    return box.isEmpty() ? null : box;
  }

  function numericWorldMatrix(object) {
    object?.updateWorldMatrix?.(true, false);
    object?.updateMatrixWorld?.(true);
    const elements = object?.matrixWorld?.elements;
    return elements?.length >= 16 ? new THREE.Matrix4().fromArray(Array.from(elements, Number)) : null;
  }

  function localGeometryBox(mesh) {
    const geometry = mesh?.geometry;
    if (!geometry) return null;
    try { geometry.computeBoundingBox?.(); } catch (_) {}
    const box = geometry.boundingBox;
    if (!box?.min || !box?.max) return null;
    return new THREE.Box3(
      new THREE.Vector3(Number(box.min.x) || 0, Number(box.min.y) || 0, Number(box.min.z) || 0),
      new THREE.Vector3(Number(box.max.x) || 0, Number(box.max.y) || 0, Number(box.max.z) || 0),
    );
  }

  function addSource(target, tileKey, sourceId) {
    let sources = target.get(tileKey);
    if (!sources) target.set(tileKey, (sources = new Set()));
    sources.add(sourceId);
  }

  function meshTiles(mesh, model) {
    if (!mesh?.isMesh || mesh.userData?.devRuinWallRenderProxy || mesh.visible === false) return [];
    const localBox = localGeometryBox(mesh), matrix = numericWorldMatrix(mesh);
    if (!localBox || !matrix) return [];
    const inverse = matrix.clone().invert();
    const localCenter = localBox.getCenter(new THREE.Vector3());
    const worldCenter = localCenter.clone().applyMatrix4(matrix);
    const worldBounds = localBox.clone().applyMatrix4(matrix);
    const minCol = Math.max(0, Math.floor(worldBounds.min.x));
    const maxCol = Math.min(model.cols - 1, Math.floor(worldBounds.max.x - 1e-6));
    const minRow = Math.max(0, Math.floor(worldBounds.min.z));
    const maxRow = Math.min(model.rows - 1, Math.floor(worldBounds.max.z - 1e-6));
    const result = new Set();
    for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
      const tileKey = keyFor(col, row);
      if (!model.floorSet.has(tileKey)) continue;
      const localPoint = new THREE.Vector3(col + .5, worldCenter.y, row + .5).applyMatrix4(inverse);
      if (localPoint.x >= localBox.min.x && localPoint.x <= localBox.max.x
        && localPoint.z >= localBox.min.z && localPoint.z <= localBox.max.z) result.add(tileKey);
    }
    // Narrow pillars and thin doors may miss every tile center; their own center
    // tile is still occupied, while broad parent-Group AABBs are never used.
    const centerKey = keyFor(Math.floor(worldCenter.x), Math.floor(worldCenter.z));
    if (model.floorSet.has(centerKey)) result.add(centerKey);
    return [...result];
  }

  function objectTiles(object, model) {
    const result = new Set();
    const visit = mesh => { for (const tileKey of meshTiles(mesh, model)) result.add(tileKey); };
    if (object?.traverse) object.traverse(visit); else visit(object);
    return result;
  }

  function doorTiles(door, model) {
    const box = worldBox(door);
    if (!box) return objectTiles(door, model);
    const widthX = box.max.x - box.min.x, widthZ = box.max.z - box.min.z;
    const alongX = widthX >= widthZ; // Generated doors are axis-aligned doorway slabs; keep their full visible run but only one tile deep.
    const center = box.getCenter(new THREE.Vector3());
    const runMin = alongX ? box.min.x : box.min.z;
    const runMax = alongX ? box.max.x : box.max.z;
    const cross = Math.floor(alongX ? center.z : center.x);
    const first = Math.max(0, Math.floor(runMin + 1e-5));
    const last = Math.min((alongX ? model.cols : model.rows) - 1, Math.floor(runMax - 1e-5));
    const result = new Set();
    for (let along = first; along <= last; along++) {
      const col = alongX ? along : cross, row = alongX ? cross : along;
      const tileKey = keyFor(col, row);
      if (model.floorSet.has(tileKey)) result.add(tileKey);
    }
    if (result.size) return result;
    return objectTiles(door, model);
  }

  const isGridSource = sourceId => !/^(transit-)?door:/.test(sourceId);

  function syncGridCollision(model) {
    const grid = model.grid;
    if (!Array.isArray(grid)) return;
    for (let row = 0; row < model.rows; row++) for (let col = 0; col < model.cols; col++) {
      const tile = grid[row]?.[col];
      if (!tile) continue;
      const tileKey = keyFor(col, row);
      if (!model.baseGridTypes.has(tileKey)) model.baseGridTypes.set(tileKey, tile.type);
      const baseType = model.baseGridTypes.get(tileKey);
      const blocked = model.floorSet.has(tileKey) && [...(model.sources.get(tileKey) || [])].some(isGridSource); // Doors keep their tile sources for reachability, but their physical collision is the exact panel footprint.
      tile.type = blocked ? model.solidType : baseType; // Makes ruin solids ordinary interior ROCK cells, so walking, AI, dodge/lunge, and swept knockback all use the game's existing collision authority.
      if (blocked) tile._devRuinCollisionSources = [...(model.sources.get(tileKey) || [])];
      else delete tile._devRuinCollisionSources;
    }
  }

  function restoreGridCollision(model) {
    const grid = model.grid;
    if (!Array.isArray(grid)) return;
    for (const [tileKey, type] of model.baseGridTypes) {
      const [col,row] = tileKey.split(',').map(Number);
      const tile = grid[row]?.[col];
      if (!tile) continue;
      tile.type = type;
      delete tile._devRuinCollisionSources;
    }
    model.baseGridTypes.clear();
  }

  function nearestFloorAnchor(object, model) {
    const matrix = numericWorldMatrix(object);
    const box = worldBox(object);
    const center = matrix
      ? new THREE.Vector3().setFromMatrixPosition(matrix)
      : box?.getCenter?.(new THREE.Vector3());
    if (!center) return null;
    const direct = keyFor(Math.floor(center.x), Math.floor(center.z));
    if (model.floorSet.has(direct)) return direct;
    let nearest = null, best = Infinity;
    for (const tileKey of objectTiles(object, model)) {
      if (!model.floorSet.has(tileKey)) continue;
      const [col, row] = tileKey.split(',').map(Number);
      const distance = (col + .5 - center.x) ** 2 + (row + .5 - center.z) ** 2;
      if (distance < best) { best = distance; nearest = tileKey; }
    }
    if (nearest) return nearest;
    for (let radius = 1; radius <= 3; radius++) {
      for (let row = Math.floor(center.z) - radius; row <= Math.floor(center.z) + radius; row++) {
        for (let col = Math.floor(center.x) - radius; col <= Math.floor(center.x) + radius; col++) {
          const tileKey = keyFor(col, row);
          if (!model.floorSet.has(tileKey)) continue;
          const distance = (col + .5 - center.x) ** 2 + (row + .5 - center.z) ** 2;
          if (distance < best) { best = distance; nearest = tileKey; }
        }
      }
      if (nearest) break;
    }
    return nearest;
  }

  function doorIsClosed(door) {
    const transit = door?.userData?.__devRuinTransitDoorState;
    if (transit) return Number(transit.open) < .78;
    const motion = door?.userData?.previewMotion || {};
    const minScale = Number.isFinite(Number(motion.minScale)) ? Number(motion.minScale) : .06;
    const fullScale = Number(door?.userData?.__devRuinOccupancyFullScaleY) || Number(door?.scale?.y) || 1;
    door.userData.__devRuinOccupancyFullScaleY = Math.max(fullScale, Number(door?.scale?.y) || 0, 1e-5);
    const ratio = (Number(door?.scale?.y) || 0) / door.userData.__devRuinOccupancyFullScaleY;
    return ratio > minScale + .18;
  }

  function wallTiles(wall, model) {
    const box = worldBox(wall);
    if (!box) return new Set();
    const result = new Set();
    const alongX = (box.max.x - box.min.x) >= (box.max.z - box.min.z);
    const boundary = alongX ? (box.min.z + box.max.z) * .5 : (box.min.x + box.max.x) * .5;
    const runMin = alongX ? box.min.x : box.min.z;
    const runMax = alongX ? box.max.x : box.max.z;
    const first = Math.max(0, Math.floor(runMin + 1e-5));
    const last = Math.min((alongX ? model.cols : model.rows) - 1, Math.floor(runMax - 1e-5));
    for (let along = first; along <= last; along++) {
      const before = Math.floor(boundary - 1e-4), after = Math.floor(boundary + 1e-4);
      for (const cross of new Set([before, after])) {
        const col = alongX ? along : cross, row = alongX ? cross : along;
        if (col < 0 || row < 0 || col >= model.cols || row >= model.rows) continue;
        const tileKey = keyFor(col, row);
        // V50 panels sit on floor/void boundaries. Only the void side is solid;
        // this is what prevents a merged wall AABB from blocking hallway floor.
        if (!model.floorSet.has(tileKey)) result.add(tileKey);
      }
    }
    return result;
  }

  function sourcesSignature(sources) {
    return [...sources.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tileKey, ids]) => `${tileKey}:${[...ids].sort().join(',')}`)
      .join('|');
  }

  function copySources(staticSources) {
    return new Map([...staticSources].map(([tileKey, ids]) => [tileKey, new Set(ids)]));
  }

  function cheapStateKey(model) {
    // Only the fields that can actually change tile occupancy: door open/closed
    // state and push-block position. Reading these is O(mechanisms) with no
    // geometry traversal, unlike the full rebuild below.
    const parts = [];
    for (const mechanism of model.mechanisms.values()) {
      if (mechanism.type !== 'stoneDoor') continue;
      parts.push(`d:${mechanism.id}:${doorIsClosed(mechanism.root) ? 1 : 0}`);
    }
    for (const door of model.transitDoors) parts.push(`t:${door.id}:${doorIsClosed(door) ? 1 : 0}`);
    for (const block of model.pushBlocks) {
      parts.push(`p:${block.id}:${(block.position?.x || 0).toFixed(3)},${(block.position?.z || 0).toFixed(3)}`);
    }
    return parts.join('|');
  }

  function rebuild(model) {
    const cheapKey = cheapStateKey(model);
    if (cheapKey === model.cheapKey) return false; // No door/block state has changed since the last check; skip the expensive traversal/signature work below.
    model.cheapKey = cheapKey;
    const sources = copySources(model.staticSources);
    for (const mechanism of model.mechanisms.values()) {
      if (mechanism.type !== 'stoneDoor') continue;
      if (!doorIsClosed(mechanism.root)) continue;
      for (const tileKey of doorTiles(mechanism.root, model)) addSource(sources, tileKey, `door:${mechanism.id}`);
    }
    for (const door of model.transitDoors) {
      if (!doorIsClosed(door)) continue;
      for (const tileKey of doorTiles(door, model)) addSource(sources, tileKey, `transit-door:${door.id}`);
    }
    for (const block of model.pushBlocks) {
      const sourceId = block.userData.__devRuinOccupancySource || `push:${block.id}`;
      block.userData.__devRuinOccupancySource = sourceId;
      for (const tileKey of objectTiles(block, model)) addSource(sources, tileKey, sourceId);
    }
    const signature = sourcesSignature(sources);
    if (signature === model.signature) return false;
    model.sources = sources;
    model.blocked = new Set(sources.keys());
    model.signature = signature;
    syncGridCollision(model);
    model.revision++;
    if (document.getElementById('mpMap')?.classList.contains('active')) renderRuinMapPanel();
    return true;
  }

  function discTouchesTile(x, z, radius, col, row) {
    const closestX = Math.max(col, Math.min(col + 1, x));
    const closestZ = Math.max(row, Math.min(row + 1, z));
    return (x - closestX) ** 2 + (z - closestZ) ** 2 <= radius ** 2;
  }

  function blocksAt(model, x, z, radius, options = {}) {
    const ignoreSource = options.ignoreRuinSource || '';
    if (model.footprints.blocksBox(x, z, radius, Number.isFinite(Number(options.worldY)) ? Number(options.worldY) : null)) return true; // worldY: height-aware callers (rope riders) clear props below/above them.
    const minCol = Math.floor(x - radius), maxCol = Math.floor(x + radius);
    const minRow = Math.floor(z - radius), maxRow = Math.floor(z + radius);
    for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
      const tileKey = keyFor(col, row), sources = model.sources.get(tileKey);
      if (!sources || !discTouchesTile(x, z, radius, col, row)) continue;
      if ([...sources].some(sourceId => sourceId !== ignoreSource)) return true;
    }
    return false;
  }

  function mergedSources(model) {
    const merged = new Map([...model.sources].map(([tileKey, ids]) => [tileKey, new Set(ids)]));
    for (const [tileKey, ids] of model.footprints.centerCoveredTiles(model.floorSet)) {
      let set = merged.get(tileKey);
      if (!set) merged.set(tileKey, set = new Set());
      for (const id of ids) set.add(id);
    }
    return merged;
  }

  function snapshot(model = activeModel) {
    if (!model) return null;
    const sources = mergedSources(model); // Footprint-covered tile centres are reported (for reachability/Map) but never stamped into the grid.
    return {
      mapId:model.mapId,
      revision:model.revision,
      cols:model.cols,
      rows:model.rows,
      floor:sortedKeys(model.floorSet),
      blocked:sortedKeys(sources.keys()),
      footprints:model.footprints.count(),
      gridBlocked:sortedKeys([...model.blocked].filter(tileKey=>{const [col,row]=tileKey.split(',').map(Number);return model.grid?.[row]?.[col]?.type===model.solidType;})), // Mobile-readable proof of which logical blockers are also active in the ordinary interior physics grid.
      causes:sortedKeys(model.causes),
      effects:sortedKeys(model.effects),
      sources:Object.fromEntries(sortedKeys(sources.keys()).map(tileKey => [tileKey, [...sources.get(tileKey)].sort()])),
    };
  }

  function fillInset(ctx, col, row, scaleX, scaleY, color, inset) {
    ctx.fillStyle = color;
    ctx.fillRect(col * scaleX + inset, row * scaleY + inset,
      Math.max(1, scaleX - inset * 2), Math.max(1, scaleY - inset * 2));
  }

  function renderRuinMapPanel() {
    const model = activeModel;
    const tabs = document.getElementById('wmapZoneTabs');
    const canvas = document.getElementById('wildernessMapCanvas');
    if (!model || !tabs || !canvas) return;
    const ctx = canvas.getContext('2d');
    const scaleX = canvas.width / model.cols, scaleY = canvas.height / model.rows;
    ctx.fillStyle = '#090b0d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < model.rows; row++) for (let col = 0; col < model.cols; col++) {
      const tileKey = keyFor(col, row);
      ctx.fillStyle = model.floorSet.has(tileKey) ? '#5d625d' : '#171b1d';
      ctx.fillRect(col * scaleX, row * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
    }
    for (const tileKey of model.blocked) {
      const [col, row] = tileKey.split(',').map(Number);
      fillInset(ctx, col, row, scaleX, scaleY, '#e74c3c', Math.max(1, Math.min(scaleX, scaleY) * .14));
    }
    ctx.fillStyle = '#e74c3c';
    for (const fp of model.footprints.list()) { // Exact prop outlines, so the Map shows the same collision the player feels.
      const corners = [[1,1],[1,-1],[-1,-1],[-1,1]].map(([a,b]) => [
        (fp.cx + fp.ux * fp.halfU * a + fp.vx * fp.halfV * b) * scaleX,
        (fp.cz + fp.uz * fp.halfU * a + fp.vz * fp.halfV * b) * scaleY,
      ]);
      ctx.beginPath(); ctx.moveTo(...corners[0]); for (const c of corners.slice(1)) ctx.lineTo(...c); ctx.closePath(); ctx.fill();
    }
    for (const tileKey of model.effects) {
      const [col, row] = tileKey.split(',').map(Number);
      fillInset(ctx, col, row, scaleX, scaleY, '#3498db', Math.max(2, Math.min(scaleX, scaleY) * .27));
    }
    for (const tileKey of model.causes) {
      const [col, row] = tileKey.split(',').map(Number);
      fillInset(ctx, col, row, scaleX, scaleY, '#35c96f', Math.max(3, Math.min(scaleX, scaleY) * .38));
    }
    const player = model.getPlayerPosition?.();
    if (player) {
      ctx.beginPath(); ctx.arc(player.x * scaleX, player.z * scaleY, Math.max(3, Math.min(scaleX, scaleY) * .25), 0, Math.PI * 2);
      ctx.fillStyle = '#ffe082'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
    }
    tabs.innerHTML = '<button type="button" class="wmap-zone-tab active">Test Ruin</button>';
    const legend = document.querySelector('#mpMap .wmap-legend');
    if (legend) {
      if (originalLegendHtml == null) originalLegendHtml = legend.innerHTML;
      legend.innerHTML = '<span><i style="background:#e74c3c;border-radius:2px"></i>Blocked</span><span><i style="background:#35c96f;border-radius:2px"></i>Activator</span><span><i style="background:#3498db;border-radius:2px"></i>Mechanism</span><span><i style="background:#ffe082"></i>Player</span>';
    }
    const status = document.getElementById('wmapWaypointStatusText');
    const clear = document.getElementById('wmapWaypointClearBtn');
    const list = document.getElementById('wmapLandmarkList');
    const render = window.DevRandomRuinWallRenderProxy?.snapshot?.() || null; // Shown beside occupancy so mobile testing can distinguish collision from direct-source visibility.
    if (status) status.textContent = `Full interior · occupancy revision ${model.revision} · no fog of war`;
    if (clear) clear.hidden = true;
    if (list) list.innerHTML = `<div class="wmap-gathering-empty">${model.blocked.size} blocked tiles · ${model.footprints.count()} prop footprints · ${model.causes.size} activator · ${model.effects.size} mechanism tiles${render ? `<br>${render.visibleDoorSources}/${render.sourceDoorMeshes} door panels · ${render.visibleDoorArchSources}/${render.sourceDoorArchMeshes} arch pieces · ${render.visibleActivatorSources}/${render.sourceActivatorMeshes} activator meshes visible · 0 proxy meshes` : ''}</div>`;
    canvas.setAttribute('aria-label', 'Random Test Ruin occupancy map: red blocked, green activator, blue mechanism; entire interior revealed');
    canvas.dataset.ruinOccupancyRevision = String(model.revision);
    canvas.dataset.ruinFog = 'disabled';
  }

  function restoreWildernessLegend() {
    const legend = document.querySelector('#mpMap .wmap-legend');
    if (legend && originalLegendHtml != null) legend.innerHTML = originalLegendHtml;
  }

  WildernessMap.renderMapPanel = function renderMapPanelWithRuinOccupancy() {
    if (activeModel && GridTileAccessors.getCurrentArea?.() === MAP_ID) return renderRuinMapPanel();
    restoreWildernessLegend();
    return nativeRenderMapPanel();
  };

  function create(config) {
    activeModel?.destroy();
    const model = {
      mapId:config.mapId || MAP_ID,
      scope:config.scope,
      cols:config.cols,
      rows:config.rows,
      floorSet:new Set(config.floorSet || []),
      mechanisms:config.mechanisms || new Map(),
      transitDoors:config.transitDoors || [],
      activators:config.activators || [],
      pushBlocks:config.pushBlocks || [],
      getPlayerPosition:config.getPlayerPosition,
      grid:config.grid || null, // Exact generated building grid registered in _buildingScenes; collision stamps mutate this rather than maintaining a parallel physics-only map.
      solidType:config.solidType ?? 'rock', // Same solid tile type ordinary interior movement/AI already treats as impassable.
      baseGridTypes:new Map(), // Restores generated floor types when doors open and when the session-only ruin is destroyed.
      staticSources:new Map(),
      footprints:SolidFootprints.createSet({
        floorY:(x, z) => DS.sampleSupport(x, z, { minY:-4, maxY:6 })?.y ?? 0,
        playerBox:() => { const p = config.getPlayerPosition?.(); return p ? { x:p.x, z:p.z, half:.2 } : null; }, // Player square used by game.js canOccupyAt (PLAYER_RADIUS*0.72 = 0.196u).
      }),
      sources:new Map(),
      blocked:new Set(),
      causes:new Set(),
      effects:new Set(),
      signature:'',
      revision:0,
      refresh:() => rebuild(model),
      blocksAt:(x, z, radius = 0, options = {}) => blocksAt(model, x, z, radius, options),
      snapshot:() => snapshot(model),
      scanSolids:(root, tag) => model.footprints.scan(root, tag),
      clearSolids:tag => model.footprints.removeTag(tag),
      addSolidBox:(id, box, enabled, tag) => model.footprints.addBox(id, box, enabled, tag),
      solidAt:(x, z, half = 0, worldY = null) => model.footprints.blocksBox(x, z, half, worldY),
      destroy:() => {
        restoreGridCollision(model);
        DS.remove(BLOCKER_ID);
        FootprintBlockers?.remove(BLOCKER_ID);
        if (activeModel === model) activeModel = null;
      },
    };
    for (const wall of config.walls || []) for (const tileKey of wallTiles(wall, model)) addSource(model.staticSources, tileKey, `wall:${wall.id}`);
    for (const root of config.solidRoots || []) model.footprints.scan(root, 'static');
    // Door panels collide exactly while closed; the rest of the door assembly
    // (frame/arch parts) is ordinary static geometry.
    const scanDoor = (door, closed) => {
      const panel = (door.children || []).find(child => child?.isMesh && child.geometry) || door;
      model.footprints.scan(panel, 'door', { force:true, enabled:closed });
      for (const child of door.children || []) if (child !== panel) model.footprints.scan(child, 'door-frame', { force:true });
    };
    for (const mechanism of model.mechanisms.values()) if (mechanism.type === 'stoneDoor') scanDoor(mechanism.root, () => doorIsClosed(mechanism.root));
    for (const door of model.transitDoors) scanDoor(door, () => doorIsClosed(door));
    for (const activator of model.activators) {
      const tileKey = nearestFloorAnchor(activator, model);
      if (tileKey) model.causes.add(tileKey);
    }
    for (const mechanism of model.mechanisms.values()) {
      const tileKey = nearestFloorAnchor(mechanism.root, model);
      if (tileKey) model.effects.add(tileKey);
    }
    activeModel = model;
    rebuild(model);
    DS.registerBlocker({
      id:BLOCKER_ID,
      scope:model.scope,
      bounds:{ minX:0, maxX:model.cols, minZ:0, maxZ:model.rows },
      enabled:() => activeModel === model && GridTileAccessors.getCurrentArea?.() === model.mapId,
      blocksAt:(x, z, _actorHeight, _record, radius, options) => model.blocksAt(x, z, radius, options),
    });
    FootprintBlockers?.register(BLOCKER_ID, {
      area:model.mapId,
      enabled:() => activeModel === model,
      blocksBox:(x, z, half, worldY) => !!model.footprints.blocksBox(x, z, half, worldY),
    });
    return model;
  }

  window.DevRandomRuinTileOccupancy = Object.freeze({
    create,
    getSnapshot:() => snapshot(),
    refresh:() => activeModel?.refresh?.() || false,
    blocksAt:(x,z,radius=.22,options={}) => activeModel?.blocksAt?.(x,z,radius,options) === true, // Traversal modules use the exact same generated occupancy that is stamped into the ordinary interior grid.
    scanSolids:(root, tag = 'dynamic-scan') => activeModel?.scanSolids?.(root, tag) || 0, // Later-built puzzle modules add their visible solids to the same footprint set.
    clearSolids:tag => activeModel?.clearSolids?.(tag),
    addSolidBox:(id, box, enabled = null, tag = 'dynamic') => activeModel?.addSolidBox?.(id, box, enabled, tag) || null,
    solidAt:(x, z, half = 0, worldY = null) => activeModel?.solidAt?.(x, z, half, worldY) || null, // worldY: only solids spanning that height.
    getFootprints:() => activeModel?.footprints?.list?.().map(fp => ({ source:fp.source, cx:+fp.cx.toFixed(3), cz:+fp.cz.toFixed(3), halfU:+fp.halfU.toFixed(3), halfV:+fp.halfV.toFixed(3), yaw:+Math.atan2(-fp.uz, fp.ux).toFixed(3) })) || [],
    renderMapPanel:renderRuinMapPanel,
    blockerId:BLOCKER_ID,
  });
})();
