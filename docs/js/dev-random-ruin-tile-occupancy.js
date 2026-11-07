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
  let originalLegendHtml = null;
  let selectedRuinFloor=null; // Null selects the player's actual story on first map opening; a chosen tab is retained until reroll.
  const nativeRenderMapPanel = WildernessMap.renderMapPanel.bind(WildernessMap);

  const keyFor = (col, row) => `${col},${row}`;
  const sortedKeys = keys => [...keys].map(k => { const i = k.indexOf(','); return [k, +k.slice(0, i), +k.slice(i + 1)]; })
    .sort((a, b) => a[2] - b[2] || a[1] - b[1]).map(e => e[0]); // Parse each key once, not per comparison.

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
      // Only undo tiles this model stamped solid. baseGridTypes holds every tile as first seen, so
      // blindly reverting all of them would turn tiles stamped walkable since then (the shaft
      // connector's corridor, restamped just before create() destroys the previous model) back into rock.
      if (!tile || !tile._devRuinCollisionSources) continue;
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
    if(door?.rootGrowthBinding)return door.rootGrowthBinding.isDoorClosed();
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
    for (const block of model.tilePushBlocks) {
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
    for (const block of model.tilePushBlocks) {
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
    const worldY = Number.isFinite(options.worldY) ? options.worldY : null; // Height-aware callers clear props below or above them.
    if (model.footprints.blocksBox(x, z, radius, worldY) || pushBlocksBox(model, x, z, radius, worldY, ignoreSource)) return true;
    const minCol = Math.floor(x - radius), maxCol = Math.floor(x + radius);
    const minRow = Math.floor(z - radius), maxRow = Math.floor(z + radius);
    for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
      const tileKey = keyFor(col, row), sources = model.sources.get(tileKey);
      if (!sources || !discTouchesTile(x, z, radius, col, row)) continue;
      if ([...sources].some(sourceId => sourceId !== ignoreSource)) return true;
    }
    return false;
  }

  function pushBlockBox(model, block) {
    const pose = model.slidingPushBlocks.get(block); // Cached until the actual block transform moves.
    if (!pose) return null;
    const {x, y, z} = block.position;
    if (x !== pose.x || y !== pose.y || z !== pose.z) Object.assign(pose, {x, y, z, box:worldBox(block)});
    return pose.box;
  }

  function pushBlocksBox(model, x, z, half, worldY, ignoreSource) {
    for (const block of model.slidingPushBlocks.keys()) {
      if (block.userData.__devRuinOccupancySource === ignoreSource) continue;
      const box = pushBlockBox(model, block);
      if (!box || (worldY != null && (worldY + half < box.min.y || worldY - half > box.max.y))) continue;
      if (x + half > box.min.x && x - half < box.max.x && z + half > box.min.z && z - half < box.max.z) return true;
    }
    return false;
  }

  function mergedSources(model) {
    const merged = new Map([...model.sources].map(([tileKey, ids]) => [tileKey, new Set(ids)]));
    for (const block of model.slidingPushBlocks.keys()) {
      for (const tileKey of objectTiles(block, model)) addSource(merged, tileKey, block.userData.__devRuinOccupancySource);
    }
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
    const scaleX=canvas.width/model.cols,scaleY=canvas.height/model.rows;
    const playerY=Number(window.DevRandomRuin?.getPlayerSupportY?.());
    const currentStory=Number.isFinite(playerY)?Math.round(playerY/4):0; // Map defaults to the story underneath the player instead of always showing the entrance.
    const requestedStory=selectedRuinFloor===null?currentStory:selectedRuinFloor;
    const layer=window.DevRandomRuin?.getShaftCollisionMap?.(requestedStory)||null; // The 3D voxel grid owns collision on each story.
    const floorTiles=layer?(layer.floor===0?layer.entryFloor:[]):[...model.floorSet]; // Never draw upper-floor projected tiles as walkable ground.
    ctx.fillStyle=layer&&layer.floor>0?'#090b0d':'#171b1d';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    for(const tileKey of floorTiles){
      const [col,row]=tileKey.split(',').map(Number);
      ctx.fillStyle='#5d625d';
      ctx.fillRect(col*scaleX,row*scaleY,Math.ceil(scaleX),Math.ceil(scaleY));
    }
    if(layer) {
      for(const tileKey of layer.open){
        const [col,row]=tileKey.split(',').map(Number);
        ctx.fillStyle='#5d625d';
        ctx.fillRect(col*scaleX,row*scaleY,Math.ceil(scaleX),Math.ceil(scaleY));
      }
      for(const tileKey of layer.blocked){
        const [col,row]=tileKey.split(',').map(Number);
        fillInset(ctx,col,row,scaleX,scaleY,'#e67e22',Math.max(1,Math.min(scaleX,scaleY)*.12));
      }
    }
    if(!layer||layer.floor===0){
    for (const tileKey of model.blocked) {
      const [col,row]=tileKey.split(',').map(Number);
      fillInset(ctx,col,row,scaleX,scaleY,'#e74c3c',Math.max(1,Math.min(scaleX,scaleY)*.14));
    }
    ctx.fillStyle = '#e74c3c';
    for (const block of model.slidingPushBlocks.keys()) {
      const box = pushBlockBox(model, block); // Draw the true moving footprint when the entrance map is inspected.
      if (box) ctx.fillRect(box.min.x*scaleX,box.min.z*scaleY,(box.max.x-box.min.x)*scaleX,(box.max.z-box.min.z)*scaleY);
    }
    for (const fp of model.footprints.list()) { // Exact prop outlines, so the Map shows the same collision the player feels.
      const corners = [[1,1],[1,-1],[-1,-1],[-1,1]].map(([a,b]) => [
        (fp.cx + fp.ux * fp.halfU * a + fp.vx * fp.halfV * b) * scaleX,
        (fp.cz + fp.uz * fp.halfU * a + fp.vz * fp.halfV * b) * scaleY,
      ]);
      ctx.beginPath(); ctx.moveTo(...corners[0]); for (const c of corners.slice(1)) ctx.lineTo(...c); ctx.closePath(); ctx.fill();
    }
    }
    if(!layer||layer.floor===0)for (const tileKey of model.effects) {
      const [col, row] = tileKey.split(',').map(Number);
      fillInset(ctx, col, row, scaleX, scaleY, '#3498db', Math.max(2, Math.min(scaleX, scaleY) * .27));
    }
    if(!layer||layer.floor===0)for (const tileKey of model.causes) {
      const [col, row] = tileKey.split(',').map(Number);
      fillInset(ctx, col, row, scaleX, scaleY, '#35c96f', Math.max(3, Math.min(scaleX, scaleY) * .38));
    }
    const player=model.getPlayerPosition?.();
    const playerFloor=layer?Math.max(0,Math.min(layer.floorCount-1,
      Math.round((Number.isFinite(playerY)?playerY:0)/layer.floorHeight))):0;
    if(player&&(!layer||layer.floor===playerFloor)) {
      ctx.beginPath(); ctx.arc(player.x * scaleX, player.z * scaleY, Math.max(3, Math.min(scaleX, scaleY) * .25), 0, Math.PI * 2);
      ctx.fillStyle = '#ffe082'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
    }
    if(layer){
      // Rebuild only when the number of floors changes: replacing focused
      // buttons on every click breaks controller navigation and screen readers.
      let buttons=[...tabs.querySelectorAll('[data-ruin-floor]')];
      if(buttons.length!==layer.floorCount||buttons.some((button,i)=>Number(button.dataset.ruinFloor)!==i)){
        tabs.innerHTML=Array.from({length:layer.floorCount},(_,floor)=>
          '<button type="button" class="wmap-zone-tab" data-ruin-floor="'+floor+
          '" aria-label="'+(floor===0?'Entrance floor':'Dungeon floor '+(floor+1))+'">'+
          (floor===0?'F1 · Entry':'F'+(floor+1))+'</button>').join('');
        buttons=[...tabs.querySelectorAll('[data-ruin-floor]')];
        for(const button of buttons)button.addEventListener('click',()=>{
          selectedRuinFloor=Number(button.dataset.ruinFloor);
          renderRuinMapPanel();
        });
      }
      for(const button of buttons){
        const active=Number(button.dataset.ruinFloor)===layer.floor;
        button.classList.toggle('active',active);
        button.setAttribute('aria-pressed',String(active));
      }
    }else if(tabs.querySelector('[data-ruin-floor]')||tabs.textContent!=='Test Ruin')
      tabs.innerHTML='<button type="button" class="wmap-zone-tab active">Test Ruin</button>';
    const legend = document.querySelector('#mpMap .wmap-legend');
    if (legend) {
      if (originalLegendHtml == null) originalLegendHtml = legend.innerHTML;
      legend.innerHTML = (!layer||layer.floor===0?'<span><i style="background:#e74c3c;border-radius:2px"></i>V50 blocked</span>':'')+
        (layer?'<span><i style="background:#e67e22;border-radius:2px"></i>3D wall · F'+(layer.floor+1)+'</span>':'')+
        (!layer||layer.floor===0?'<span><i style="background:#35c96f;border-radius:2px"></i>Activator</span><span><i style="background:#3498db;border-radius:2px"></i>Mechanism</span>':'')+
        (player&&(!layer||layer.floor===playerFloor)?'<span><i style="background:#ffe082"></i>Player</span>':'');
    }
    const status = document.getElementById('wmapWaypointStatusText');
    const clear = document.getElementById('wmapWaypointClearBtn');
    const list = document.getElementById('wmapLandmarkList');
    const render = window.DevRandomRuinWallRenderProxy?.snapshot?.() || null; // Shown beside occupancy so mobile testing can distinguish collision from direct-source visibility.
    if(status)status.textContent=`Full interior · ${layer?'Floor '+(layer.floor+1)+' of '+layer.floorCount:'Ground floor'} · collision revision ${model.revision} · no fog of war`;
    if (clear) clear.hidden = true;
    if(list){
      const ground=!layer||layer.floor===0;
      const original=ground?`${model.blocked.size} V50 blockers · ${model.footprints.count()} prop footprints · ${model.causes.size} activators · ${model.effects.size} mechanisms`:'';
      const voxel=layer?`${layer.blocked.length} F${layer.floor+1} voxel blockers`:'';
      list.innerHTML=`<div class="wmap-gathering-empty">${[original,voxel].filter(Boolean).join(' · ')}${ground&&render?`<br>${render.visibleDoorSources}/${render.sourceDoorMeshes} door panels · ${render.visibleDoorArchSources}/${render.sourceDoorArchMeshes} arches · ${render.visibleActivatorSources}/${render.sourceActivatorMeshes} activators visible · ${render.totalProxyCount} proxy meshes`:''}</div>`;
    }
    canvas.setAttribute('aria-label', 'Random Test Ruin occupancy map: red V50 blocked, orange level-specific 3D walls, green activator, blue mechanism; floor '+(layer?layer.floor+1:1));
    canvas.dataset.ruinOccupancyRevision=String(model.revision);
    canvas.dataset.ruinFloor=String(layer?.floor??0); // Mobile Pixel Probe can distinguish the selected story without a console.
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
    selectedRuinFloor=null; // Every new ruin begins by following the player's floor instead of reusing the last seed's tab.
    const model = {
      mapId:config.mapId || MAP_ID,
      scope:config.scope,
      cols:config.cols,
      rows:config.rows,
      floorSet:new Set(config.floorSet || []),
      mechanisms:config.mechanisms || new Map(),
      transitDoors:config.transitDoors || [],
      activators:config.activators || [],
      tilePushBlocks:[], // Lift blocks retain their existing stamped collision.
      slidingPushBlocks:new Map(), // Ordinary blocks collide at their current visual position without restamping the grid.
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
      // Lab-only movable blocks join the same runtime collision map as V50-authored push blocks.
      registerSlidingPushBlock:block=>{
        if(!block?.isObject3D||!block.userData?.previewMotion||block.userData.previewMotion.type!=='pushPuzzleBlock')return false;
        block.userData.__devRuinOccupancySource ||= 'push:'+block.id; // Used by swept pushes to ignore only their own collider.
        if(!model.slidingPushBlocks.has(block))model.slidingPushBlocks.set(block,{});
        return true;
      },
      unregisterSlidingPushBlock:block=>model.slidingPushBlocks.delete(block), // Used when a compound chamber is discarded independently of the whole V50 ruin.
      pushBlockBox:block => pushBlockBox(model, block),
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
    for (const block of config.pushBlocks || []) {
      if (block.userData?.previewMotion?.type === 'pushPuzzleBlock') {
        block.userData.__devRuinOccupancySource ||= `push:${block.id}`;
        model.slidingPushBlocks.set(block, {});
      } else model.tilePushBlocks.push(block);
    }
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
      blocksBox:(x, z, half, worldY) => !!model.footprints.blocksBox(x, z, half, worldY) || pushBlocksBox(model, x, z, half, worldY),
    });
    return model;
  }

  window.DevRandomRuinTileOccupancy = Object.freeze({
    create,
    getSnapshot:() => snapshot(),
    refresh:() => activeModel?.refresh?.() || false,
    blocksAt:(x,z,radius=.22,options={}) => activeModel?.blocksAt?.(x,z,radius,options) === true, // Traversal modules use the exact same generated occupancy that is stamped into the ordinary interior grid.
    registerSlidingPushBlock:block=>activeModel?.registerSlidingPushBlock?.(block)===true, // Late-built lab blocks move with the native V50 pusher and still block player/world movement.
    unregisterSlidingPushBlock:block=>activeModel?.unregisterSlidingPushBlock?.(block)===true, // A discarded room must not leave a ghost block collider in the active map.
    scanSolids:(root, tag = 'dynamic-scan') => activeModel?.scanSolids?.(root, tag) || 0, // Later-built puzzle modules add their visible solids to the same footprint set.
    clearSolids:tag => activeModel?.clearSolids?.(tag),
    addSolidBox:(id, box, enabled = null, tag = 'dynamic') => activeModel?.addSolidBox?.(id, box, enabled, tag) || null,
    solidAt:(x, z, half = 0, worldY = null) => activeModel?.solidAt?.(x, z, half, worldY) || null, // worldY: only solids spanning that height.
    getFootprints:() => activeModel?.footprints?.list?.().map(fp => ({ source:fp.source, cx:+fp.cx.toFixed(3), cz:+fp.cz.toFixed(3), halfU:+fp.halfU.toFixed(3), halfV:+fp.halfV.toFixed(3), yaw:+Math.atan2(-fp.uz, fp.ux).toFixed(3) })) || [],
    renderMapPanel:renderRuinMapPanel,
    blockerId:BLOCKER_ID,
  });
})();
