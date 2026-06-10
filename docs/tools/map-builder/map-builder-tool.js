(() => {
  'use strict';
  const H = window.HobunjiMapBuilder;
  const $ = id => document.getElementById(id);
  const canvas = $('mapCanvas');
  const ctx = canvas.getContext('2d');
  const logger = H.makeLogger($('logBody'));
  const DEFAULT_NPC_DB_ENTRY = {
    id: 'hobunji_starter_npc_database',
    label: 'Hobunji Starter NPC Database',
    kind: 'npcDatabase',
    jsonUrl: '../../config/npcs/hobunji-starter-npc-database.json',
    tags: ['npc', 'starter', 'hobunji', 'fallback']
  };
  let index = null;
  let npcDb = { npcs: [], npcById: {} };
  let mode = 'house';
  let activePathId = null;
  let cam = { x: 0, y: 0, zoom: 22 };
  const state = H.normalizeTownMap({
    map: { id: 'hobunji_main_town', name: 'Hobunji Main Town', cols: 48, rows: 32, tileSize: 1 },
    houses: [], npcPaths: [], npcSchedules: [], furniture: [], distantLandscape: []
  });

  function log(message, level = 'info') { logger.log(message, level); $('statusPill').textContent = message; }
  function norm(value, fallback) { return H.normalizeId(value, fallback); }
  function number(id, fallback = 0) { const value = Number($(id).value); return Number.isFinite(value) ? value : fallback; }
  function text(id) { return String($(id).value || '').trim(); }
  function optionRows(items, emptyLabel) {
    return [`<option value="">${emptyLabel}</option>`].concat((items || []).map(item => `<option value="${item.id}">${item.label || item.name || item.id}</option>`)).join('');
  }
  function ensureNpcDbFallback(targetIndex) {
    if (!targetIndex) targetIndex = H.normalizeIndex({});
    if (!Array.isArray(targetIndex.npcDatabases)) targetIndex.npcDatabases = [];
    if (!targetIndex.npcDatabases.some(db => db.id === DEFAULT_NPC_DB_ENTRY.id)) {
      targetIndex.npcDatabases.unshift({ ...DEFAULT_NPC_DB_ENTRY });
      log('NPC DB fallback injected because the manifest had none or was cached stale.', 'warn');
    }
    return H.normalizeIndex(targetIndex, text('indexUrl') || '../../config/map-builder-index.json');
  }

  function syncMapForm() {
    state.map.id = norm(text('mapId'), 'map');
    state.map.cols = Math.max(8, Math.min(240, Math.round(number('mapCols', 48))));
    state.map.rows = Math.max(8, Math.min(240, Math.round(number('mapRows', 32))));
  }

  async function reloadIndex() {
    try {
      index = await H.loadIndex(text('indexUrl') || '../../config/map-builder-index.json');
      index = ensureNpcDbFallback(index);
      $('npcDbSelect').innerHTML = optionRows(index.npcDatabases, 'No NPC DB indexed');
      $('housePieceSel').innerHTML = optionRows(index.housePieces, 'Placement-derived highland');
      $('wallRecipeSel').innerHTML = optionRows(index.wallRecipes, 'roughbrick_default');
      $('indexSummary').textContent = `${index.npcDatabases.length} NPC DBs · ${index.housePieces.length} house pieces · ${index.wallRecipes.length} wall recipes · ${index.furniture.length} furniture · ${index.distantLandscape.length} distant landscape`;
      if (!$('npcDbSelect').value && index.npcDatabases[0]) $('npcDbSelect').value = index.npcDatabases[0].id;
      log('Loaded map-builder index.');
    } catch (err) {
      index = ensureNpcDbFallback(null);
      $('npcDbSelect').innerHTML = optionRows(index.npcDatabases, 'No NPC DB indexed');
      $('housePieceSel').innerHTML = optionRows(index.housePieces, 'Placement-derived highland');
      $('wallRecipeSel').innerHTML = optionRows(index.wallRecipes, 'roughbrick_default');
      $('indexSummary').textContent = `Fallback active · ${index.npcDatabases.length} NPC DBs`;
      log(`Index load failed, using fallback DB entry: ${err.message}`, 'warn');
    }
    await loadNpcDb(true);
    updateAll();
  }

  async function loadNpcDb(silent = false) {
    index = ensureNpcDbFallback(index);
    const selectedId = $('npcDbSelect').value || DEFAULT_NPC_DB_ENTRY.id;
    const entry = (index?.npcDatabases || []).find(db => db.id === selectedId) || index?.npcDatabases?.[0] || DEFAULT_NPC_DB_ENTRY;
    try {
      npcDb = await H.loadNpcDatabase(entry);
      $('npcSelect').innerHTML = optionRows(npcDb.npcs, 'npc_001');
      if (!silent) log(`Loaded NPC DB with ${npcDb.npcs.length} NPCs.`);
      else logger.log(`Loaded NPC DB with ${npcDb.npcs.length} NPCs.`);
    } catch (err) {
      npcDb = { npcs: [], npcById: {} };
      $('npcSelect').innerHTML = '<option value="npc_001">npc_001</option>';
      log(`NPC database load failed: ${err.message}`, 'error');
    }
    updateAll();
  }

  function parseSize() {
    const match = String($('houseSize').value || '').match(/(\d+)\s*[x,]\s*(\d+)/i);
    return { width: match ? Number(match[1]) : 6, depth: match ? Number(match[2]) : 5 };
  }

  function addHouseAt(x = null, y = null) {
    syncMapForm();
    const size = parseSize();
    const house = {
      id: norm(text('houseId'), 'house'),
      label: text('houseLabel') || 'House',
      footprintType: 'house',
      x: Math.max(0, Math.min(state.map.cols - 1, x ?? Math.round(number('houseX', 0)))),
      y: Math.max(0, Math.min(state.map.rows - 1, y ?? Math.round(number('houseY', 0)))),
      width: Math.max(1, size.width),
      depth: Math.max(1, size.depth),
      rotationDeg: 0,
      door: { side: 'south', offset: Math.floor(size.width / 2) },
      pieceId: $('housePieceSel').value || 'placement_derived_highland',
      wallRecipeId: $('wallRecipeSel').value || 'roughbrick_default'
    };
    if (state.houses.some(existing => existing.id === house.id)) house.id = `house_${Date.now().toString(36)}`;
    house.width = Math.min(house.width, state.map.cols - house.x);
    house.depth = Math.min(house.depth, state.map.rows - house.y);
    state.houses.push(house);
    log(`Added house ${house.id}.`);
    updateAll();
  }

  function newPath() {
    const id = norm(text('pathId'), 'npc_path');
    const path = { id, npcId: norm($('npcSelect').value || 'npc_001', 'npc'), label: id, behavior: 'walk_route', nodes: [] };
    if (state.npcPaths.some(existing => existing.id === path.id)) path.id = `npc_path_${Date.now().toString(36)}`;
    state.npcPaths.push(path);
    activePathId = path.id;
    mode = 'path';
    $('modePill').textContent = 'Mode: path nodes';
    log(`Created path ${path.id}.`);
    updateAll();
  }

  function addNodeAt(x, y) {
    if (!activePathId) newPath();
    const path = state.npcPaths.find(item => item.id === activePathId);
    if (!path) return;
    path.nodes.push({ x, y, label: `node_${path.nodes.length + 1}` });
    log(`Added node to ${path.id}.`);
    updateAll();
  }

  function loadStarter() {
    state.houses = [
      { id: 'house_player', label: 'Player House', footprintType: 'player_house', x: 7, y: 18, width: 6, depth: 5, rotationDeg: 0, door: { side: 'south', offset: 2 }, pieceId: 'placement_derived_highland', wallRecipeId: 'roughbrick_default' },
      { id: 'supply_shop', label: 'Supply Shop', footprintType: 'shop', x: 24, y: 7, width: 8, depth: 5, rotationDeg: 0, door: { side: 'south', offset: 4 }, pieceId: 'placement_derived_highland', wallRecipeId: 'roughbrick_default' }
    ];
    state.npcPaths = [
      { id: 'path_shopkeeper_day', npcId: 'npc_shopkeeper', label: 'Shopkeeper day route', behavior: 'patrol_loop', nodes: [{ x: 28, y: 12, label: 'door' }, { x: 30, y: 11, label: 'counter' }, { x: 27, y: 11, label: 'shelf' }] }
    ];
    activePathId = state.npcPaths[0].id;
    mode = 'house';
    $('modePill').textContent = 'Mode: house';
    log('Loaded starter integrated map.');
    updateAll();
    fitView();
  }

  function makeBundle() {
    syncMapForm();
    return H.buildMapBundle(state, index || ensureNpcDbFallback(null), npcDb);
  }

  function updateLists() {
    $('houseList').innerHTML = state.houses.map(h => `<div class="item"><b>${h.label || h.id}</b><br>${h.id} · ${h.width}x${h.depth} · piece ${h.pieceId} · wall ${h.wallRecipeId}</div>`).join('');
    $('pathList').innerHTML = state.npcPaths.map(p => `<div class="item"><b>${p.label || p.id}</b><br>${p.id} · npc ${p.npcId} · ${p.nodes.length} nodes</div>`).join('');
  }

  function updatePreview() {
    const bundle = makeBundle();
    const missing = bundle.derived?.missing || {};
    const missingCount = Object.values(missing).flat().filter(Boolean).length;
    $('missingPill').textContent = missingCount ? `Missing refs: ${missingCount}` : 'Missing: none';
    $('countPill').textContent = `${state.houses.length} houses · ${state.npcPaths.length} paths · ${npcDb.npcs?.length || 0} NPCs`;
    $('jsonPreview').value = JSON.stringify(bundle, null, 2);
  }

  function worldToScreen(x, y) { return { x: x * cam.zoom + cam.x, y: y * cam.zoom + cam.y }; }
  function screenToWorld(x, y) { return { x: (x - cam.x) / cam.zoom, y: (y - cam.y) / cam.zoom }; }
  function draw() {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = '#07101a';
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    for (let x = 0; x <= state.map.cols; x++) { const p = worldToScreen(x, 0); ctx.beginPath(); ctx.moveTo(p.x, cam.y); ctx.lineTo(p.x, cam.y + state.map.rows * cam.zoom); ctx.stroke(); }
    for (let y = 0; y <= state.map.rows; y++) { const p = worldToScreen(0, y); ctx.beginPath(); ctx.moveTo(cam.x, p.y); ctx.lineTo(cam.x + state.map.cols * cam.zoom, p.y); ctx.stroke(); }
    state.houses.forEach(h => {
      const p = worldToScreen(h.x, h.y);
      ctx.fillStyle = 'rgba(139,92,246,.58)';
      ctx.fillRect(p.x, p.y, h.width * cam.zoom, h.depth * cam.zoom);
      ctx.strokeStyle = 'rgba(255,255,255,.65)';
      ctx.strokeRect(p.x, p.y, h.width * cam.zoom, h.depth * cam.zoom);
      const door = H.deriveDoorTile(h);
      const d = worldToScreen(door.x, door.y);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(d.x + cam.zoom * .25, d.y + cam.zoom * .25, cam.zoom * .5, cam.zoom * .5);
    });
    state.npcPaths.forEach(path => {
      ctx.strokeStyle = 'rgba(56,189,248,.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      path.nodes.forEach((node, i) => { const p = worldToScreen(node.x + .5, node.y + .5); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      path.nodes.forEach(node => { const p = worldToScreen(node.x + .5, node.y + .5); ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4, cam.zoom * .22), 0, Math.PI * 2); ctx.fill(); });
      ctx.lineWidth = 1;
    });
  }

  function updateAll() { updateLists(); updatePreview(); draw(); }
  function resizeCanvas() { const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1)); const r = canvas.getBoundingClientRect(); canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function fitView() { const r = canvas.getBoundingClientRect(); cam.zoom = Math.max(8, Math.min((r.width - 48) / state.map.cols, (r.height - 48) / state.map.rows)); cam.x = Math.round((r.width - state.map.cols * cam.zoom) / 2); cam.y = Math.round((r.height - state.map.rows * cam.zoom) / 2); draw(); }

  canvas.addEventListener('click', event => {
    const r = canvas.getBoundingClientRect();
    const p = screenToWorld(event.clientX - r.left, event.clientY - r.top);
    const x = Math.max(0, Math.min(state.map.cols - 1, Math.floor(p.x)));
    const y = Math.max(0, Math.min(state.map.rows - 1, Math.floor(p.y)));
    if (mode === 'path') addNodeAt(x, y);
    else addHouseAt(x, y);
  });

  $('reloadIndexBtn').addEventListener('click', reloadIndex);
  $('loadNpcDbBtn').addEventListener('click', () => loadNpcDb(false));
  $('seedBtn').addEventListener('click', loadStarter);
  $('addHouseBtn').addEventListener('click', () => addHouseAt());
  $('newPathBtn').addEventListener('click', newPath);
  $('modePathBtn').addEventListener('click', () => { mode = 'path'; $('modePill').textContent = 'Mode: path nodes'; log('Canvas taps now add path nodes.'); });
  $('fitBtn').addEventListener('click', fitView);
  $('downloadBtn').addEventListener('click', () => { const blob = new Blob([JSON.stringify(makeBundle(), null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${state.map.id}_bundle.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); log('Bundle download started.'); });
  $('copyBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(makeBundle(), null, 2)); log('Copied bundle.'); } catch (_err) { $('jsonPreview').select(); log('Clipboard blocked; preview selected.', 'warn'); } });
  window.addEventListener('resize', () => { resizeCanvas(); fitView(); });
  window.addEventListener('error', event => log(`${event.message} @ ${event.lineno}:${event.colno}`, 'error'));
  window.addEventListener('unhandledrejection', event => log(event.reason?.stack || String(event.reason), 'error'));

  resizeCanvas();
  reloadIndex().then(() => { loadStarter(); fitView(); });
})();
