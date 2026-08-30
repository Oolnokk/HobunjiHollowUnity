(() => {
  'use strict';

  // Wilderness fog-of-war (per-zone, bit-packed, world+year scoped),
  // discovered-locale tracking, map waypoints, and the full Map panel.
  // Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as its
  // sibling systems. _zoneLayouts/tothalWorldId/currentTothalYear stay
  // behind in game.js on purpose — all three are shared across many
  // wilderness/Tothal-Shift systems, not owned by the map alone — and come
  // in through deps, along with WMAP_ZONE_LABELS, which the Tasks panel
  // and BountyBoard also read.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // ── Fixed locale landmarks (docs/tools/locale-editor/, docs/config/locales/) ──
  // Leaf & Pahu's House ("Little Swamp House" in TOTHAL_PRESERVED_TRANSITIONS,
  // game.js) has a fixed, non-relocating anchor -- a real building interior
  // is meant to be authored at that same fixed spot later, so its position
  // never changes and the wilderness map can just list it here as a
  // constant. Everything else -- the Researcher's Tent and the Great Fey
  // shrines -- gets stamped fresh into the regenerated wilderness by the
  // generator itself (see stampLocales in wilderness-map-generator.js):
  // their location genuinely reshuffles with the rest of the terrain on
  // every Tothal Shift, which is why the map only shows their *current*
  // position once you've found them before (or always, for the Tent -- see
  // its alwaysVisibleOnMap placement flag).
  const FIXED_LOCALE_LANDMARKS = [
    { localeId: 'locale_leaf_pahu_house', name: "Leaf & Pahu's House", category: 'dwelling', zoneId: 'map_eastern_mire', col: 34, row: 29 },
  ];

  // Bit-packed per-tile fog-of-war, one Uint8Array per zone (year+dims
  // scoped -- discarded and rebuilt fresh whenever a Tothal Shift changes
  // either). Discovered locales are separate and persist forever (see
  // below): finding a place is remembered even after a shift moves it or
  // regenerates the terrain fog around it.
  const FOG_REVEAL_RADIUS = 7; // tiles, Chebyshev-ish (circular) around the player
  const _fogCache = new Map(); // zoneId -> { year, cols, rows, bits: Uint8Array }

  function _fogStorageKey(worldId, zoneId) { return `hobunji_zone_fog_v1_${worldId}_${zoneId}`; }

  function _bitsToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function _base64ToBits(b64, minBytes) {
    const bin = atob(b64);
    const bytes = new Uint8Array(Math.max(bin.length, minBytes));
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function _loadZoneFog(zoneId) {
    const layout = deps._zoneLayouts.get(zoneId);
    if (!layout) return null;
    const year = deps.currentTothalYear();
    const cached = _fogCache.get(zoneId);
    if (cached && cached.year === year && cached.cols === layout.cols && cached.rows === layout.rows) return cached;
    const worldId = deps.tothalWorldId() || 'default';
    let entry = null;
    try {
      const raw = localStorage.getItem(_fogStorageKey(worldId, zoneId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.year === year && parsed.cols === layout.cols && parsed.rows === layout.rows) {
          entry = { year, cols: parsed.cols, rows: parsed.rows, bits: _base64ToBits(parsed.bits, Math.ceil(parsed.cols * parsed.rows / 8)) };
        }
      }
    } catch {}
    if (!entry) entry = { year, cols: layout.cols, rows: layout.rows, bits: new Uint8Array(Math.ceil(layout.cols * layout.rows / 8)) };
    _fogCache.set(zoneId, entry);
    return entry;
  }

  function _saveZoneFog(zoneId) {
    const entry = _fogCache.get(zoneId);
    if (!entry) return;
    const worldId = deps.tothalWorldId() || 'default';
    try {
      localStorage.setItem(_fogStorageKey(worldId, zoneId), JSON.stringify({ year: entry.year, cols: entry.cols, rows: entry.rows, bits: _bitsToBase64(entry.bits) }));
    } catch {}
  }

  function _fogIsRevealed(entry, c, r) {
    if (!entry || c < 0 || r < 0 || c >= entry.cols || r >= entry.rows) return false;
    const idx = r * entry.cols + c;
    return (entry.bits[idx >> 3] & (1 << (idx & 7))) !== 0;
  }
  function _fogReveal(entry, c, r) {
    if (c < 0 || r < 0 || c >= entry.cols || r >= entry.rows) return false;
    const idx = r * entry.cols + c;
    const byte = idx >> 3, bit = 1 << (idx & 7);
    if (entry.bits[byte] & bit) return false;
    entry.bits[byte] |= bit;
    return true;
  }

  // ── Discovered locales (world-scoped, persists across Tothal Shifts) ──
  function _loadDiscoveredLocales() {
    const worldId = deps.tothalWorldId();
    if (!worldId) return {};
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      return (meta?.worlds || []).find(w => w.id === worldId)?.discoveredLocales ?? {};
    } catch { return {}; }
  }
  function _saveDiscoveredLocales(discovered) {
    const worldId = deps.tothalWorldId();
    if (!worldId) return;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const world = (meta?.worlds || []).find(w => w.id === worldId);
      if (!world) return;
      world.discoveredLocales = discovered;
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
    } catch {}
  }

  // All currently-placed locale instances this session, fixed + randomly
  // stamped: [{ localeId, name, category, zoneId, col, row, fixed, alwaysVisible }].
  function _allLocaleInstances() {
    const out = FIXED_LOCALE_LANDMARKS.map(f => ({ localeId: f.localeId, name: f.name, category: f.category, zoneId: f.zoneId, col: f.col, row: f.row, fixed: true, alwaysVisible: false }));
    for (const zoneId of (typeof WildernessMapGenerator !== 'undefined' ? WildernessMapGenerator.zoneMapIds() : [])) {
      const layout = deps._zoneLayouts.get(zoneId);
      for (const inst of (layout?.localeInstances || [])) {
        out.push({ localeId: inst.localeId, name: inst.name, category: inst.category, zoneId, col: inst.x, row: inst.y, fixed: false, alwaysVisible: !!inst.alwaysVisible });
      }
    }
    return out;
  }

  // Called whenever fog newly reveals ground in `zoneId` -- checks every
  // locale instance currently placed there against the just-revealed
  // radius and flags it discovered forever. Discovery only ever records
  // *that* a locale was found, never *where* -- the map always draws
  // discovered locales from _allLocaleInstances()'s live current placement,
  // so "current location... if you've discovered them before" holds even
  // after a later Tothal Shift moves it, with no need to physically
  // revisit it again first.
  function _checkLocaleDiscovery(zoneId, pc, pr) {
    const discovered = _loadDiscoveredLocales();
    let changed = false;
    for (const inst of _allLocaleInstances()) {
      if (inst.zoneId !== zoneId || discovered[inst.localeId]) continue;
      const dist = Math.hypot(inst.col - pc, inst.row - pr);
      if (dist > FOG_REVEAL_RADIUS) continue;
      discovered[inst.localeId] = { name: inst.name, category: inst.category, firstDiscoveredYear: deps.currentTothalYear() };
      changed = true;
      deps.showToast(`Discovered: ${inst.name}`, true);
    }
    if (changed) _saveDiscoveredLocales(discovered);
  }

  let _lastFogRevealTile = null;
  function updateZoneFogAroundPlayer() {
    const currentArea = deps.getCurrentArea();
    if (!deps._isZoneArea(currentArea)) return;
    const zoneId = currentArea;
    const entry = _loadZoneFog(zoneId);
    if (!entry) return;
    const player = deps.player;
    const pc = Math.floor(player.x / deps.TILE), pr = Math.floor(player.y / deps.TILE);
    if (_lastFogRevealTile && _lastFogRevealTile.zoneId === zoneId && _lastFogRevealTile.c === pc && _lastFogRevealTile.r === pr) return;
    _lastFogRevealTile = { zoneId, c: pc, r: pr };
    let changed = false;
    const R = FOG_REVEAL_RADIUS, R2 = R * R;
    for (let dr = -R; dr <= R; dr++) {
      for (let dc = -R; dc <= R; dc++) {
        if (dc * dc + dr * dr > R2) continue;
        if (_fogReveal(entry, pc + dc, pr + dr)) changed = true;
      }
    }
    if (changed) { _saveZoneFog(zoneId); }
    _checkLocaleDiscovery(zoneId, pc, pr);
  }

  // ── Wilderness map rendering (shared by the minimap widget and the
  // full-screen Map pane) ─────────────────────────────────────────────
  const WMAP_TERRAIN_COLORS = {
    grass: '#2f6b3a', weeds: '#3f7a3f', shrub: '#265a30', path: '#b8956a',
    rock: '#6b6f76', river: '#2f6fb8', stream: '#4f9bd9', waterfall: '#bfe9f7',
    tilled: '#5a4327', raised: '#7a6248', trench: '#2a1f16', paddy: '#33628a', ramp: '#8f8460',
  };
  const WMAP_LOCALE_COLORS = { dwelling: '#7fe89a', great_fey_shrine: '#c084fc', story_poi: '#6ec6f0', misc: '#f0f0f0' };
  let _waypointCacheWorldId = null; // Used to avoid parsing the full save-meta JSON on every 30 Hz compass update.
  let _waypointCache; // `undefined` means this world's waypoint has not been loaded yet; null means it has no waypoint.
  let _threatDiscoveryCacheWorldId = null; // Used with the year below so den/camp discoveries survive reloads without leaking across worlds or Shifts.
  let _threatDiscoveryCacheYear = null;
  let _threatDiscoveryCache;

  function _worldSaveRecord() {
    const worldId = deps.tothalWorldId();
    if (!worldId) return null;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const world = (meta?.worlds || []).find(w => w.id === worldId);
      return world ? { meta, world } : null;
    } catch { return null; }
  }

  function _loadWaypoint() {
    const worldId = deps.tothalWorldId() || null;
    if (_waypointCacheWorldId !== worldId) {
      _waypointCacheWorldId = worldId;
      _waypointCache = undefined;
    }
    if (_waypointCache === undefined) _waypointCache = _worldSaveRecord()?.world?.mapWaypoint || null;
    const saved = _waypointCache;
    if (!saved) return null;
    // Temporary camps and dens move when the Tothal Shift rebuilds the
    // wilderness. Never point the compass at an obsolete previous-year tile.
    if (saved.source === 'threat' && saved.year !== deps.currentTothalYear()) {
      _saveWaypoint(null);
      return null;
    }
    return saved;
  }

  function _saveWaypoint(waypoint) {
    const record = _worldSaveRecord();
    if (!record) return;
    if (waypoint) record.world.mapWaypoint = waypoint;
    else delete record.world.mapWaypoint;
    try {
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(record.meta));
      _waypointCacheWorldId = deps.tothalWorldId() || null;
      _waypointCache = waypoint ? { ...waypoint } : null;
    } catch {}
  }

  function _loadDiscoveredThreats() {
    const worldId = deps.tothalWorldId() || null;
    const year = deps.currentTothalYear();
    if (_threatDiscoveryCacheWorldId === worldId && _threatDiscoveryCacheYear === year && _threatDiscoveryCache) return _threatDiscoveryCache;
    const record = _worldSaveRecord();
    const saved = record?.world?.discoveredThreats;
    _threatDiscoveryCacheWorldId = worldId;
    _threatDiscoveryCacheYear = year;
    _threatDiscoveryCache = saved?.year === year && saved.markers && typeof saved.markers === 'object'
      ? { ...saved.markers }
      : {};
    if (record && saved && saved.year !== year) {
      record.world.discoveredThreats = { year, markers: {} };
      try { localStorage.setItem('hobunjiSaveMeta', JSON.stringify(record.meta)); } catch {}
    }
    return _threatDiscoveryCache;
  }

  function _saveDiscoveredThreats(markers) {
    const record = _worldSaveRecord();
    if (!record) return;
    const year = deps.currentTothalYear();
    const clean = { ...markers };
    record.world.discoveredThreats = { year, markers: clean };
    try {
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(record.meta));
      _threatDiscoveryCacheWorldId = deps.tothalWorldId() || null;
      _threatDiscoveryCacheYear = year;
      _threatDiscoveryCache = clean;
    } catch {}
  }

  function rememberDiscoveredThreat(threatKey, info) {
    if (!threatKey || !info || !Number.isFinite(info.col) || !Number.isFinite(info.row)) return;
    const markers = _loadDiscoveredThreats();
    markers[threatKey] = {
      kind: info.kind === 'den' ? 'den' : 'camp',
      zoneId: info.zoneId, col: info.col, row: info.row,
      label: info.label || (info.kind === 'den' ? 'Animal Den' : 'Bandit Camp'),
    };
    _saveDiscoveredThreats(markers);
  }

  function forgetDiscoveredThreat(threatKey) {
    if (!threatKey) return;
    const markers = _loadDiscoveredThreats();
    if (markers[threatKey]) {
      delete markers[threatKey];
      _saveDiscoveredThreats(markers);
    }
    clearWaypointForThreat(threatKey);
  }

  function _reconcileDiscoveredThreatKind(zoneId, kind, activeThreats) {
    const markers = _loadDiscoveredThreats();
    const activeByKey = new Map((activeThreats || []).map(threat => [threat.discoveryKey, threat]));
    let changed = false;
    for (const [key, marker] of Object.entries(markers)) {
      if (marker.kind !== kind || marker.zoneId !== zoneId) continue;
      const active = activeByKey.get(key);
      if (!active) {
        delete markers[key];
        clearWaypointForThreat(key);
        changed = true;
        continue;
      }
      if (marker.col !== active.col || marker.row !== active.row) {
        markers[key] = { ...marker, col: active.col, row: active.row, label: active.label || marker.label };
        changed = true;
      }
    }
    if (changed) _saveDiscoveredThreats(markers);
  }

  function reconcileDiscoveredCamps(zoneId, activeCamps) {
    _reconcileDiscoveredThreatKind(zoneId, 'camp', activeCamps);
  }

  function _visibleLandmarks(zoneId) {
    const discovered = _loadDiscoveredLocales();
    const landmarks = [];
    for (const inst of _allLocaleInstances()) {
      if (inst.zoneId !== zoneId || (!inst.alwaysVisible && !discovered[inst.localeId])) continue;
      landmarks.push({
        id: `locale:${inst.localeId}`, source: 'locale', localeId: inst.localeId,
        label: inst.name, category: inst.category || 'misc', zoneId,
        col: inst.col + 0.5, row: inst.row + 0.5,
      });
    }
    const threats = new Map(Object.entries(_loadDiscoveredThreats()));
    for (const [runtimeKey, info] of window.BanditCamps?.perceivedThreats || []) {
      threats.set(info.discoveryKey || runtimeKey, info);
    }
    for (const [key, info] of threats) {
      if (info.zoneId !== zoneId) continue;
      landmarks.push({
        id: `threat:${key}`, source: 'threat', threatKey: key,
        label: info.label || (info.kind === 'den' ? 'Animal Den' : 'Bandit Camp'),
        category: info.kind === 'den' ? 'den' : 'camp', zoneId,
        col: info.col, row: info.row, year: deps.currentTothalYear(),
      });
    }
    return landmarks;
  }

  function _resolvedWaypoint() {
    const saved = _loadWaypoint();
    if (!saved) return null;
    if (saved.source === 'locale') {
      const live = _allLocaleInstances().find(inst => inst.localeId === saved.localeId);
      return live ? { ...saved, zoneId: live.zoneId, col: live.col + 0.5, row: live.row + 0.5, label: live.name } : saved;
    }
    const liveThreat = [...(window.BanditCamps?.perceivedThreats || [])]
      .find(([runtimeKey, info]) => (info.discoveryKey || runtimeKey) === saved.threatKey)?.[1];
    const rememberedThreat = _loadDiscoveredThreats()[saved.threatKey];
    const resolvedThreat = liveThreat || rememberedThreat;
    return resolvedThreat ? { ...saved, zoneId: resolvedThreat.zoneId, col: resolvedThreat.col, row: resolvedThreat.row, label: resolvedThreat.label || saved.label } : saved;
  }

  function _sameWaypoint(a, b) { return !!a && !!b && a.id === b.id; }

  function setWaypoint(landmark) {
    if (!landmark || !Number.isFinite(landmark.col) || !Number.isFinite(landmark.row)) return;
    const saved = {
      id: landmark.id, source: landmark.source, label: landmark.label,
      zoneId: landmark.zoneId, col: landmark.col, row: landmark.row,
      category: landmark.category || 'misc',
      ...(landmark.localeId ? { localeId: landmark.localeId } : {}),
      ...(landmark.threatKey ? { threatKey: landmark.threatKey, year: deps.currentTothalYear() } : {}),
    };
    _saveWaypoint(saved);
    deps.showToast(`Compass waypoint: ${saved.label}`, true);
    renderWildernessMapPanel();
  }

  function clearWaypoint({ silent = false } = {}) {
    const previous = _loadWaypoint();
    if (!previous) return;
    _saveWaypoint(null);
    if (!silent) deps.showToast('Compass waypoint cleared.', false);
    renderWildernessMapPanel();
  }

  function clearWaypointForThreat(threatKey) {
    const waypoint = _loadWaypoint();
    if (waypoint?.source === 'threat' && waypoint.threatKey === threatKey) clearWaypoint({ silent: true });
  }

  function getCompassWaypoint() {
    const waypoint = _resolvedWaypoint();
    return waypoint ? { ...waypoint } : null;
  }

  let _mapMarkerHits = []; // Used by the map canvas click handler to select the landmark whose rendered marker was tapped.

  function _drawWildernessMapOnCanvas(canvas, zoneId, opts = {}) {
    _mapMarkerHits = [];
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, h);
    const layout = zoneId ? deps._zoneLayouts.get(zoneId) : null;
    if (!layout) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Not yet explored', w / 2, h / 2);
      return;
    }
    const cols = layout.cols, rows = layout.rows;
    const scaleX = w / cols, scaleY = h / rows;
    const entry = _loadZoneFog(zoneId);
    const revealedTiles = new Map(); // Used for anti-aliased region boundaries after all terrain fills are painted.
    for (const tile of layout.tiles) {
      if (!_fogIsRevealed(entry, tile.c, tile.r)) continue;
      ctx.fillStyle = WMAP_TERRAIN_COLORS[tile.type] || WMAP_TERRAIN_COLORS.grass;
      ctx.fillRect(tile.c * scaleX, tile.r * scaleY, scaleX + 0.35, scaleY + 0.35);
      const elevation = Number(tile.elevTier ?? tile.elevation ?? 0) || 0;
      if (elevation > 0) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.18, elevation * 0.035)})`;
        ctx.fillRect(tile.c * scaleX, tile.r * scaleY, scaleX + 0.35, scaleY + 0.35);
      }
      revealedTiles.set(`${tile.c},${tile.r}`, { ...tile, elevation });
    }

    // Thin black seams separate adjacent terrain regions on the same
    // elevation; heavier seams describe actual elevation changes. Painting
    // vector paths over a high-resolution square canvas keeps both much less
    // blocky than the former floor/ceil-per-tile renderer.
    const sameElevationEdges = new Path2D();
    const elevationEdges = new Path2D();
    const addEdge = (path, x1, y1, x2, y2) => { path.moveTo(x1, y1); path.lineTo(x2, y2); };
    for (const tile of revealedTiles.values()) {
      const right = revealedTiles.get(`${tile.c + 1},${tile.r}`);
      const down = revealedTiles.get(`${tile.c},${tile.r + 1}`);
      if (right && (right.type !== tile.type || right.elevation !== tile.elevation)) {
        addEdge(right.elevation === tile.elevation ? sameElevationEdges : elevationEdges,
          (tile.c + 1) * scaleX, tile.r * scaleY, (tile.c + 1) * scaleX, (tile.r + 1) * scaleY);
      }
      if (down && (down.type !== tile.type || down.elevation !== tile.elevation)) {
        addEdge(down.elevation === tile.elevation ? sameElevationEdges : elevationEdges,
          tile.c * scaleX, (tile.r + 1) * scaleY, (tile.c + 1) * scaleX, (tile.r + 1) * scaleY);
      }
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.78)'; ctx.lineWidth = Math.max(1.25, Math.min(scaleX, scaleY) * 0.2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(sameElevationEdges);
    ctx.strokeStyle = 'rgba(0,0,0,0.94)'; ctx.lineWidth = Math.max(2, Math.min(scaleX, scaleY) * 0.34);
    ctx.stroke(elevationEdges);
    ctx.restore();

    const markerR = Math.max(3, Math.min(scaleX, scaleY) * 1.4);
    const discovered = _loadDiscoveredLocales();
    const selectedWaypoint = _resolvedWaypoint();
    const interactiveLandmarks = new Map(_visibleLandmarks(zoneId).map(landmark => [landmark.id, landmark]));
    for (const inst of _allLocaleInstances()) {
      if (inst.zoneId !== zoneId) continue;
      if (!inst.alwaysVisible && !discovered[inst.localeId]) continue;
      const mx = (inst.col + 0.5) * scaleX, my = (inst.row + 0.5) * scaleY;
      ctx.beginPath();
      ctx.arc(mx, my, markerR, 0, Math.PI * 2);
      ctx.fillStyle = WMAP_LOCALE_COLORS[inst.category] || WMAP_LOCALE_COLORS.misc;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.stroke();
      const landmark = interactiveLandmarks.get(`locale:${inst.localeId}`);
      if (landmark) _mapMarkerHits.push({ landmark, x: mx, y: my, radius: Math.max(12, markerR * 1.8) });
    }
    // Dens/camps sensed by a companion are remembered for this world and
    // Tothal year, so their danger markers survive a page reload. Destroyed
    // camps are removed; dens remain geographic discoveries until the next
    // Shift even while their current pack is dead.
    const threatMarkerR = Math.max(4, markerR * 1.2);
    for (const landmark of interactiveLandmarks.values()) {
      if (landmark.source !== 'threat') continue;
      const mx = landmark.col * scaleX, my = landmark.row * scaleY;
      ctx.beginPath();
      ctx.arc(mx, my, threatMarkerR, 0, Math.PI * 2);
      ctx.fillStyle = landmark.category === 'den' ? '#8f805b' : '#c0392b';
      ctx.fill();
      ctx.strokeStyle = '#2a0d0a'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff2d0';
      ctx.font = `bold ${Math.max(7, Math.round(threatMarkerR * 1.1))}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(landmark.category === 'den' ? '▲' : '!', mx, my + 0.5);
      _mapMarkerHits.push({ landmark, x: landmark.col * scaleX, y: landmark.row * scaleY, radius: Math.max(12, threatMarkerR * 1.8) });
    }
    // An accepted bounty's target camp, once its actual location is known
    // (see updateBountyTracking, game.js) -- a gold skull marker so it
    // reads as "wanted target" rather than the red ! of a sensed threat or
    // an ordinary discovered-locale dot. Stays up until the camp is
    // confirmed destroyed, at which point the bounty completes and this is
    // pruned from _bountyMarkers itself.
    const bountyMarkerR = Math.max(4, markerR * 1.25);
    for (const info of window.BountyBoard.markers.values()) {
      if (info.zoneId !== zoneId) continue;
      const mx = info.col * scaleX, my = info.row * scaleY;
      ctx.beginPath();
      ctx.arc(mx, my, bountyMarkerR, 0, Math.PI * 2);
      ctx.fillStyle = '#e0b23c';
      ctx.fill();
      ctx.strokeStyle = '#4a3308'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#2a1c05';
      ctx.font = `bold ${Math.max(7, Math.round(bountyMarkerR * 1.1))}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('☠', mx, my + 0.5);
    }
    // Garanki Gabu's live position, drawn as his own portrait (the same
    // baked head-with-cosmetics canvas his world model and dialogue
    // portrait use — see makeNpcWalker's avatarFrontCanvas, game.js)
    // instead of a plain dot, so he reads as a person to go find rather
    // than another static map marker. Tracks whichever zone he's actually
    // in right now, independent of which zone tab the player happens to be
    // standing in or viewing.
    const garanki = deps.npcWalkers.find(w => w.rec?.id === 'garanki_gabu');
    if (garanki && garanki.area === zoneId && garanki.avatarFrontCanvas) {
      const gx = garanki.root.position.x * scaleX, gy = garanki.root.position.z * scaleY;
      const gr = Math.max(4, markerR * 1.3);
      ctx.save();
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(garanki.avatarFrontCanvas, gx - gr, gy - gr, gr * 2, gr * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.strokeStyle = '#f0d060'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (opts.showPlayer) {
      const player = deps.player;
      const mx = (player.x / deps.TILE) * scaleX, my = (player.y / deps.TILE) * scaleY;
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(3, markerR * 0.8), 0, Math.PI * 2);
      ctx.fillStyle = '#f9e28a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (selectedWaypoint?.zoneId === zoneId) {
      const mx = selectedWaypoint.col * scaleX, my = selectedWaypoint.row * scaleY;
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(7, markerR * 1.9), 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, markerR * 0.45); ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(9, markerR * 2.35), 0, Math.PI * 2);
      ctx.strokeStyle = '#58d8ff'; ctx.lineWidth = Math.max(2, markerR * 0.35); ctx.stroke();
    }
  }

  function _renderLandmarkList(zoneId) {
    const listEl = document.getElementById('wmapLandmarkList');
    const statusTextEl = document.getElementById('wmapWaypointStatusText');
    const clearButton = document.getElementById('wmapWaypointClearBtn');
    if (!listEl || !statusTextEl || !clearButton) return;
    const selected = _resolvedWaypoint();
    statusTextEl.textContent = selected
      ? `Compass waypoint: ${selected.label}${selected.zoneId !== zoneId ? ` (${deps.WMAP_ZONE_LABELS[selected.zoneId] || selected.zoneId})` : ''}`
      : 'No compass waypoint selected.';
    clearButton.hidden = !selected;
    clearButton.onclick = selected ? () => clearWaypoint() : null;
    const landmarks = _visibleLandmarks(zoneId);
    listEl.replaceChildren();
    if (!landmarks.length) {
      listEl.innerHTML = '<div class="wmap-gathering-empty">No discovered locations in this region yet.</div>';
      return;
    }
    for (const landmark of landmarks) {
      const row = document.createElement('div');
      row.className = 'wmap-landmark-row';
      const label = document.createElement('div');
      label.className = 'wmap-landmark-label';
      const dot = document.createElement('i');
      dot.style.background = landmark.category === 'den' ? '#d7c59a'
        : landmark.category === 'camp' ? '#ef6657'
        : (WMAP_LOCALE_COLORS[landmark.category] || WMAP_LOCALE_COLORS.misc);
      label.append(dot, document.createTextNode(landmark.label));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wmap-waypoint-btn';
      const active = _sameWaypoint(selected, landmark);
      button.classList.toggle('active', active);
      button.textContent = active ? 'Clear' : 'Set waypoint';
      button.addEventListener('click', () => active ? clearWaypoint() : setWaypoint(landmark));
      row.append(label, button);
      listEl.appendChild(row);
    }
  }

  let _wmapActiveZone = null;
  function renderWildernessMapPanel() {
    const tabsEl = document.getElementById('wmapZoneTabs');
    const canvas = document.getElementById('wildernessMapCanvas');
    if (!tabsEl || !canvas) return;
    const currentArea = deps.getCurrentArea();
    const zoneIds = (typeof WildernessMapGenerator !== 'undefined') ? WildernessMapGenerator.zoneMapIds() : [];
    if (!zoneIds.length) { tabsEl.innerHTML = ''; _drawWildernessMapOnCanvas(canvas, null); return; }
    if (!_wmapActiveZone || !zoneIds.includes(_wmapActiveZone)) {
      _wmapActiveZone = deps._isZoneArea(currentArea) ? currentArea : zoneIds[0];
    }
    tabsEl.innerHTML = '';
    for (const zoneId of zoneIds) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wmap-zone-tab' + (zoneId === _wmapActiveZone ? ' active' : '');
      btn.textContent = deps.WMAP_ZONE_LABELS[zoneId] || zoneId;
      btn.addEventListener('click', () => { _wmapActiveZone = zoneId; renderWildernessMapPanel(); });
      tabsEl.appendChild(btn);
    }
    _drawWildernessMapOnCanvas(canvas, _wmapActiveZone, { showPlayer: currentArea === _wmapActiveZone });
    _renderLandmarkList(_wmapActiveZone);
  }

  function _bindMapCanvas() {
    const canvas = document.getElementById('wildernessMapCanvas');
    if (!canvas || canvas.dataset.waypointBound === '1') return;
    canvas.dataset.waypointBound = '1';
    canvas.addEventListener('click', event => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * canvas.width / rect.width;
      const y = (event.clientY - rect.top) * canvas.height / rect.height;
      const hit = _mapMarkerHits
        .map(candidate => ({ candidate, distance: Math.hypot(candidate.x - x, candidate.y - y) }))
        .filter(entry => entry.distance <= entry.candidate.radius)
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      if (!hit) return;
      const selected = _resolvedWaypoint();
      _sameWaypoint(selected, hit.landmark) ? clearWaypoint() : setWaypoint(hit.landmark);
    });
  }

  const originalInit = init;
  init = function initWithMapControls(injectedDeps) {
    originalInit(injectedDeps);
    _bindMapCanvas();
  };

  window.WildernessMap = {
    init,
    updateFogAroundPlayer: updateZoneFogAroundPlayer,
    renderMapPanel: renderWildernessMapPanel,
    setWaypoint,
    clearWaypoint,
    clearWaypointForThreat,
    rememberDiscoveredThreat,
    forgetDiscoveredThreat,
    reconcileDiscoveredCamps,
    getDiscoveredThreats: () => ({ ..._loadDiscoveredThreats() }),
    getCompassWaypoint,
    getDebug: () => ({ activeZone: _wmapActiveZone, waypoint: _resolvedWaypoint(), visibleLandmarks: _wmapActiveZone ? _visibleLandmarks(_wmapActiveZone).length : 0, rememberedThreats: Object.keys(_loadDiscoveredThreats()).length }),
  };
})();
