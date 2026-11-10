// Fortified bandit strongholds — an alternative bandit-camp presentation, not an extra spawn.
// Scene geometry uses ProceduralFurniture's existing textured-part material pipeline.
// Cave generation, occupants and saves remain owned by CaveSiteSystem.
(() => {
  'use strict';
  if (window.BanditStrongholds) return;

  const DEFAULT_REPLACEMENT_FRACTION = 0.25; // Used when the gang config omits stronghold tuning.
  const siteRegistrations = new Map(); // Map id -> exterior camp record, for teardown and mobile diagnostics.
  const interiorScenes = new Map(); // Map id -> already-installed prop group, avoiding duplicate draws on reentry.
  const latest = { event: 'not seeded', failed: 0 }; // Latest useful on-device diagnostic; no console required.
  const WOOD = Object.freeze({ color: '#60452c', materialRole: 'wood', materialTexture: 'carved_smooth.png' });
  const DARK_WOOD = Object.freeze({ color: '#493725', materialRole: 'wood', materialTexture: 'carved_smooth.png' });
  const STONE = Object.freeze({ color: '#777267', materialRole: 'stone', materialTexture: 'carved_smooth.png' });

  function hash(text) {
    let value = 2166136261 >>> 0; // FNV-1a site selection never consumes the combat/spawn RNG.
    for (const ch of String(text)) { value ^= ch.charCodeAt(0); value = Math.imul(value, 16777619) >>> 0; }
    return value >>> 0;
  }

  function replacementFraction(cfg) {
    const raw = Number(cfg?.fortifiedStrongholds?.replacementFraction);
    return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : DEFAULT_REPLACEMENT_FRACTION;
  }

  function shouldFortify(zoneId, slot, cfg) {
    const cycle = Number(window.CalendarSystem?.tothalCycle?.() || 0); // Tothal changes may generate a new set of camps.
    const roll = hash('fortified-camp-v1:' + zoneId + ':' + slot + ':' + cycle) / 4294967296;
    return roll < replacementFraction(cfg);
  }

  function part(name, x, y, z, sx, sy, sz, surface = WOOD, kind = 'box') {
    return { id: name, name, kind, ...surface, transform: { x, y, z, sx, sy, sz } };
  }

  function registerRecipes() {
    const catalog = window.ProceduralFurniture?.CATALOG;
    if (!catalog) return false;
    if (catalog.fortifiedWatchtower) return true;
    const planks = [
      part('tower-deck', 0, 1.45, 0, 1.75, .18, 1.75),
      part('tower-crossbar-n', 0, 2.12, -.81, 1.75, .11, .14),
      part('tower-crossbar-s', 0, 2.12, .81, 1.75, .11, .14),
      part('tower-crossbar-w', -.81, 2.12, 0, .14, .11, 1.75),
      part('tower-crossbar-e', .81, 2.12, 0, .14, .11, 1.75),
      part('tower-roof', 0, 2.75, 0, 1.9, .13, 1.9, DARK_WOOD),
      part('tower-ladder', .2, .7, .85, .45, 1.38, .08, DARK_WOOD),
    ];
    for (const sx of [-.7, .7]) for (const sz of [-.7, .7]) {
      planks.push(part('tower-post-' + sx + '-' + sz, sx, 1.32, sz, .15, 2.64, .15));
    }
    catalog.fortifiedWatchtower = planks;
    catalog.fortifiedLowRail = [
      part('rail-low-plank-a', 0, .48, 0, 1.85, .29, .16),
      part('rail-low-plank-b', 0, .79, 0, 1.85, .24, .16, DARK_WOOD),
      part('rail-post-left', -.83, .55, 0, .14, 1.1, .18),
      part('rail-post-right', .83, .55, 0, .14, 1.1, .18),
    ];
    catalog.fortifiedHighCover = [
      part('cover-plank-low', 0, .40, 0, 1.85, .52, .2),
      part('cover-plank-middle', 0, .95, 0, 1.85, .52, .2, DARK_WOOD),
      part('cover-plank-upper', 0, 1.5, 0, 1.85, .52, .2),
      part('cover-post-left', -.8, .94, 0, .19, 1.88, .25),
      part('cover-post-right', .8, .94, 0, .19, 1.88, .25),
    ];
    catalog.fortifiedCaveArch = [
      part('arch-stone-left', -.91, 1, .06, .52, 2.04, .7, STONE),
      part('arch-stone-right', .91, 1, .06, .52, 2.04, .7, STONE),
      part('arch-stone-lintel', 0, 2.14, .06, 2.36, .5, .7, STONE),
      part('arch-wood-lintel', 0, 1.79, -.18, 1.4, .15, .18),
      part('arch-wood-side-left', -.61, .86, -.21, .14, 1.71, .18),
      part('arch-wood-side-right', .61, .86, -.21, .14, 1.71, .18),
    ]; // Intentionally no black portal plane: the native cave transition renders the opening.
    return true;
  }

  function siteProps(rec) {
    const site = rec?.instance?.site;
    if (!site || site.w < 5 || site.h < 5) return [];
    const cx = Math.floor(site.x + site.w / 2);
    const cy = Math.floor(site.y + site.h / 2);
    const minX = site.x, maxX = site.x + site.w - 1;
    const minY = site.y, maxY = site.y + site.h - 1;
    const coord = (key, x, y, rotate = 0) => ({
      id: rec.instance.id + ':' + key, key, x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)), w: 1, h: 1, rotY: rotate,
      strongholdProp: true,
    });
    return [
      coord('fortifiedCaveArch', cx, cy),
      coord('fortifiedWatchtower', minX + 1, minY + 1),
      coord('fortifiedWatchtower', maxX - 1, minY + 1),
      coord('fortifiedLowRail', cx - 2, cy + 1),
      coord('fortifiedLowRail', cx + 2, cy + 1),
      coord('fortifiedHighCover', minX + 1, cy),
      coord('fortifiedHighCover', maxX - 1, cy),
    ];
  }

  function upsertEntrance(rec, deps, mapId) {
    const site = rec.instance.site;
    const col = Math.floor(site.x + site.w / 2);
    const row = Math.floor(site.y + site.h / 2);
    const id = 'bandit_fortified_' + rec.discoverySlot + '_enter';
    const transition = { id, col, row, label: 'Fortified Cave Stronghold',
      target: 'building', targetMapId: mapId };
    const layout = deps.zoneLayouts?.get?.(rec.zoneId);
    if (!layout) return false;
    const set = list => {
      if (!Array.isArray(list)) return;
      const index = list.findIndex(t => t?.id === id);
      if (index >= 0) list[index] = transition; else list.push(transition);
    };
    layout.transitions ||= [];
    set(layout.transitions);
    const live = deps.zoneScenes?.get?.(rec.zoneId);
    if (live?.transitions) set(live.transitions); // Cached wilderness scenes need their own runtime transition.
    const ground = live?.grid?.[row]?.[col];
    if (live?.scene && window.THREE && !live.scene.children.some(child => child.userData?.banditStrongholdTransitionId === id)) {
      const THREE = window.THREE;
      const ring = new THREE.Mesh(new THREE.RingGeometry(.22, .36, 24),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      const surface = Number(deps.tileSurfaceYInArea?.(ground, rec.zoneId));
      ring.position.set(col + .5, (Number.isFinite(surface) ? surface : 0) + .02, row + .5);
      ring.userData.banditStrongholdTransitionId = id;
      window.EnvironmentSurfaceMicroPlateau?.bindGroundProjection?.(ring);
      live.scene.add(ring);
    }
    return true;
  }

  function upgradeCamp(rec, deps) {
    if (!rec || !deps || !registerRecipes()) return false;
    if (!siteProps(rec).length) return false;
    const site = window.CaveSiteSystem?.registerFortifiedStronghold?.(rec.zoneId, rec.discoverySlot);
    if (!site?.mapId) return false;
    if (!upsertEntrance(rec, deps, site.mapId)) return false;
    for (const prop of rec.props) if (prop.type === 'tent') prop.destroyed = true; // Physical walls replace the Simple Hydra tent stage.
    const props = siteProps(rec);
    rec.props.push(...props);
    rec.instance.stampedObjectIds.push(...props.map(prop => prop.id)); // Same locale release lifecycle as existing camp furniture.
    rec.stronghold = { mapId: site.mapId, slot: rec.discoverySlot, entrance: site.mapId };
    siteRegistrations.set(site.mapId, { zoneId: rec.zoneId, slot: rec.discoverySlot, instanceId: rec.instance.id });
    latest.event = 'fortified ' + rec.zoneId + ' slot ' + rec.discoverySlot;
    window.__farmLog?.('[bandit-stronghold] ' + latest.event, 'world');
    return true;
  }

  function removeCamp(rec, deps) {
    const mapId = rec?.stronghold?.mapId;
    if (!mapId) return;
    const id = 'bandit_fortified_' + rec.discoverySlot + '_enter';
    const layout = deps?.zoneLayouts?.get?.(rec.zoneId);
    const live = deps?.zoneScenes?.get?.(rec.zoneId);
    for (const holder of [layout, live]) {
      if (holder?.transitions) holder.transitions = holder.transitions.filter(t => t?.id !== id);
    }
    for (const ring of [...(live?.scene?.children || [])]) if (ring.userData?.banditStrongholdTransitionId === id) {
      live.scene.remove(ring); ring.geometry?.dispose(); ring.material?.dispose();
    }
    siteRegistrations.delete(mapId);
    window.CaveSiteSystem?.forgetFortifiedStronghold?.(mapId);
  }

  function buildInteriorProps(mapId, mapData, scene) {
    if (!scene || !mapData?.caveSite?.fortifiedStronghold || !registerRecipes()) return 0;
    const previous = interiorScenes.get(mapId);
    if (previous?.scene === scene) return previous.group.children.length;
    if (previous) previous.scene.remove(previous.group);
    const THREE = window.THREE;
    if (!THREE) return 0;
    const group = new THREE.Group(); // A single parent owns every decorative barricade; no extra frame loop.
    group.name = 'fortified-bandit-interior';
    const floor = (mapData.floor || []).filter(tile => Array.isArray(tile) && tile.length >= 2);
    const exitCol = Number(mapData.exitCol) || 0, exitRow = Number(mapData.exitRow) || 0;
    const candidates = floor.map(([col, row]) => ({ col, row, distance: Math.hypot(col - exitCol, row - exitRow) }))
      .filter(tile => tile.distance >= 4 && tile.distance <= 12)
      .sort((a,b) => a.distance-b.distance || a.col-b.col || a.row-b.row);
    const selected = [];
    for (const tile of candidates) {
      if (selected.length >= 4) break;
      if (selected.some(other => Math.hypot(other.col-tile.col,other.row-tile.row)<3)) continue;
      selected.push(tile);
      const key = selected.length % 2 ? 'fortifiedLowRail' : 'fortifiedHighCover';
      const piece = window.ProceduralFurniture.buildFurnitureGroup(key);
      piece.position.set(tile.col+.5, Number(mapData.floorSurfaceY)||0, tile.row+.5);
      piece.rotation.y = (tile.col < exitCol ? -1 : 1) * Math.PI/2;
      group.add(piece);
    }
    scene.add(group);
    interiorScenes.set(mapId, { scene, group });
    latest.event = 'interior barricades ' + selected.length + ' (' + mapId + ')';
    return selected.length;
  }

  function debugSnapshot() {
    return { ...latest, replacementDefault: DEFAULT_REPLACEMENT_FRACTION,
      activeSites: [...siteRegistrations.entries()].map(([mapId, site]) => ({ mapId, ...site })),
      interiorMaps: [...interiorScenes.keys()], style: 'ProceduralFurniture shared carved_smooth wood/stone' };
  }

  window.BanditStrongholds = Object.freeze({
    shouldFortify, replacementFraction, registerRecipes, upgradeCamp, removeCamp,
    buildInteriorProps, debugSnapshot, __test: Object.freeze({ hash, siteProps }),
  });
  registerRecipes();
})();