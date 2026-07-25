// Temporary locales: locales stamped into an *already-generated* wilderness
// zone by scanning for an existing site, rather than reserving space before
// terrain generates (see stampLocale/stampLocales in wilderness-map-
// generator.js for the "fixed" counterpart this deliberately mirrors the
// vocabulary of). A temporary locale doesn't invent new ground: it finds a
// rectangle matching its own footprint that is (1) all one elevation,
// (2) free of anything "unique" (dens, caves, structures, other stamped
// locales), and (3) free of river/path/water tiles -- clears whatever
// flora/resource clutter is sitting there, paints the locale's own tiles/
// objects in, and remembers exactly what it cleared so the site can be
// released back to normal later without a full zone regeneration.
//
// Authored the same way as any other locale (docs/tools/locale-editor/),
// distinguished only by `placement.mode === 'temporary'`. Bandit camps are
// the first consumer (see docs/js/bandit-gang-generator.js and docs/config/
// bandits/bandit-gang-config.json) but this module has no bandit-specific
// code in it -- it just places/clears/releases footprints.
//
// Operates on a generic "zone" object shaped like the wilderness
// generator's own workspace/map: { cols, rows, tiles: tiles[y][x], objects,
// entry: {x,y} }, where a tile carries { height|elevation, water, path,
// ramp, waterfall, occupiedBy } and an object carries { id, type, x, y, w,
// h, occupiedBy-marking already applied to its tiles }. game.js's
// _zoneLayouts cache entries are exactly this shape (they *are* the
// generator's own workspace/map, kept around after generateZoneWorkspace
// returns), so this module can run against them directly at runtime, long
// after the zone first generated.
(function (root) {
  'use strict';

  // Object types that a temporary locale is allowed to bulldoze on its way
  // in (flora/resource clutter placed by placeFloraAndResources). Anything
  // NOT in this list is treated as unique/blocking and the site search
  // avoids it entirely -- dens, caves, structures, other locales' carrier
  // objects, etc. Deliberately an allowlist (not a blocklist of "unique"
  // types) so an unrecognized future object type defaults to blocking
  // rather than silently getting bulldozed.
  const DEFAULT_CLEARABLE_TYPES = new Set([
    'copse', 'tree', 'bush', 'fruitBush', 'shrub', 'vegetation',
    'diggableRockOre', 'rock', 'rockOutcrop', 'resourceNode', 'flora'
  ]);

  function tileHeight(t) { return (t && (t.height ?? t.elevation)) || 0; }

  function tileAt(zone, x, y) {
    if (x < 0 || y < 0 || x >= zone.cols || y >= zone.rows) return null;
    return (zone.tiles && zone.tiles[y]) ? (zone.tiles[y][x] || null) : null;
  }

  function objectAt(zone, id) {
    return (zone.objects || []).find(o => o.id === id) || null;
  }

  // Footprint bbox of a locale's painted tiles, exactly like
  // wilderness-map-generator.js's localeFootprintBBox.
  function footprintBBox(locale) {
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    for (const key of Object.keys(locale.tiles || {})) {
      const [c, r] = key.split(',').map(Number);
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
    }
    if (!Number.isFinite(minC)) return null;
    return { minC, minR, w: maxC - minC + 1, h: maxR - minR + 1 };
  }

  function isBlocked(zone, x, y, clearableTypes) {
    const t = tileAt(zone, x, y);
    if (!t) return true;
    if (t.water || t.path || t.ramp || t.waterfall || t.invisiblePath) return true;
    if (!t.occupiedBy) return false;
    const obj = objectAt(zone, t.occupiedBy);
    // An occupied tile with no resolvable object (e.g. a locale's own
    // reserved-but-not-yet-painted buffer) is treated as blocking -- safest
    // default when the occupant can't be identified.
    if (!obj) return true;
    if (obj.localeMeta) return true; // another locale's carrier -- never bulldoze
    return !clearableTypes.has(obj.type);
  }

  function siteFits(zone, x, y, w, h, requireFlat, clearableTypes) {
    let targetH = null;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (isBlocked(zone, xx, yy, clearableTypes)) return false;
        if (requireFlat) {
          const th = tileHeight(tileAt(zone, xx, yy));
          if (targetH === null) targetH = th;
          else if (Math.abs(th - targetH) > 0.05) return false;
        }
      }
    }
    return true;
  }

  // Exhaustive scan, shuffled by the given rng so repeated calls (placing
  // several camp instances in one zone) don't all cluster on the first hit
  // — the footprint is small and instances are rare enough per zone that
  // scanning every candidate is cheap and (unlike random sampling) never
  // misses a real spot that exists.
  function findSite(zone, locale, opts = {}) {
    const bbox = footprintBBox(locale);
    if (!bbox) return null;
    const placement = locale.placement || {};
    const clearance = Math.max(0, Math.round(opts.clearanceTiles ?? placement.clearanceTiles ?? 2));
    const requireFlat = (opts.requiresFlatGround ?? placement.requiresFlatGround) !== false;
    const clearableTypes = opts.clearableTypes || DEFAULT_CLEARABLE_TYPES;
    const minDistFromEntry = Math.max(0, Number(opts.minDistanceFromEntry ?? placement.minDistanceFromEntry) || 0);
    const w = bbox.w + clearance * 2, h = bbox.h + clearance * 2;
    if (w > zone.cols || h > zone.rows) return null;

    const rng = opts.rng || Math.random;
    const candidates = [];
    for (let y = 0; y <= zone.rows - h; y++) {
      for (let x = 0; x <= zone.cols - w; x++) candidates.push({ x, y });
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }
    for (const c of candidates) {
      if (minDistFromEntry > 0 && zone.entry) {
        const dist = Math.hypot((c.x + w / 2) - zone.entry.x, (c.y + h / 2) - zone.entry.y);
        if (dist < minDistFromEntry) continue;
      }
      if (siteFits(zone, c.x, c.y, w, h, requireFlat, clearableTypes)) {
        return { x: c.x, y: c.y, w, h, clearance, bbox };
      }
    }
    return null;
  }

  function markOccupied(zone, id, x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const t = tileAt(zone, xx, yy);
        if (t) t.occupiedBy = id;
      }
    }
  }

  function clearOccupied(zone, x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const t = tileAt(zone, xx, yy);
        if (t) t.occupiedBy = null;
      }
    }
  }

  let _instanceSeq = 0;

  // Places `locale` into `zone` at a freshly-found site, clearing and
  // snapshotting any flora it bulldozes so release() can put it all back.
  // Returns an "instance" record — the caller (bandit-gang-generator.js)
  // is expected to persist this alongside its own bookkeeping (which tents
  // are still alive, etc) and hand it back to release() later.
  function stamp(zone, locale, opts = {}) {
    const site = findSite(zone, locale, opts);
    if (!site) return null;
    const { x: spotX, y: spotY, w: paddedW, h: paddedH, clearance, bbox } = site;
    const anchorX = spotX + clearance - bbox.minC;
    const anchorY = spotY + clearance - bbox.minR;
    const instanceId = opts.instanceId || `templocale_${locale.id}_${Date.now().toString(36)}_${(_instanceSeq++).toString(36)}`;

    // Snapshot every object fully/partially inside the padded rect that's
    // about to be bulldozed (flora/resource clutter only -- findSite already
    // refused any site with a blocking object in it), plus a per-tile
    // snapshot of occupiedBy/height flags so release() can restore both the
    // objects and the exact tile state a fresh generation would have left.
    const clearableTypes = opts.clearableTypes || DEFAULT_CLEARABLE_TYPES;
    const removedObjects = [];
    const seen = new Set();
    for (let yy = spotY; yy < spotY + paddedH; yy++) {
      for (let xx = spotX; xx < spotX + paddedW; xx++) {
        const t = tileAt(zone, xx, yy);
        const occId = t && t.occupiedBy;
        if (!occId || seen.has(occId)) continue;
        seen.add(occId);
        const obj = objectAt(zone, occId);
        if (obj && clearableTypes.has(obj.type)) removedObjects.push(obj);
      }
    }
    for (const obj of removedObjects) {
      const idx = zone.objects.indexOf(obj);
      if (idx >= 0) zone.objects.splice(idx, 1);
      clearOccupied(zone, obj.x, obj.y, obj.w || 1, obj.h || 1);
    }

    const tileSnapshot = {};
    for (const key of Object.keys(locale.tiles || {})) {
      const [c, r] = key.split(',').map(Number);
      const wx = anchorX + c, wy = anchorY + r;
      const t = tileAt(zone, wx, wy);
      if (!t) continue;
      tileSnapshot[`${wx},${wy}`] = { path: !!t.path, water: !!t.water, terrain: t.terrain, waterfall: !!t.waterfall };
    }

    markOccupied(zone, instanceId, spotX, spotY, paddedW, paddedH);

    for (const [key, tileDef] of Object.entries(locale.tiles || {})) {
      const [c, r] = key.split(',').map(Number);
      const tile = tileAt(zone, anchorX + c, anchorY + r);
      if (!tile) continue;
      if (tileDef.type === 'path') tile.path = true;
      else if (tileDef.type === 'river' || tileDef.type === 'stream') { tile.water = true; tile.terrain = tileDef.type; }
      else if (tileDef.type === 'waterfall') tile.waterfall = true;
    }

    const stampedObjectIds = [];
    for (const objDef of (locale.objects || [])) {
      const worldX = anchorX + objDef.col, worldY = anchorY + objDef.row;
      const id = `${instanceId}_${objDef.id}`;
      const stamped = {
        id, type: objDef.kind === 'tent' ? 'tent' : objDef.kind,
        key: objDef.key, label: objDef.label,
        x: worldX, y: worldY, w: objDef.w, h: objDef.h, rot: objDef.rot || 0,
        temporaryLocaleInstanceId: instanceId,
        interactable: objDef.interactable ? { ...objDef.interactable } : null,
        destroyed: false,
      };
      zone.objects.push(stamped);
      markOccupied(zone, id, worldX, worldY, objDef.w, objDef.h);
      stampedObjectIds.push(id);
    }

    const instance = {
      id: instanceId,
      localeId: locale.id,
      category: locale.category,
      anchorX, anchorY,
      site: { x: spotX, y: spotY, w: paddedW, h: paddedH },
      stampedObjectIds,
      removedObjectSnapshots: removedObjects.map(o => ({ ...o })),
      tileSnapshot,
      createdAt: Date.now(),
    };
    return instance;
  }

  // Undoes stamp(): removes every object the instance placed, clears the
  // reservation, restores the tile flags and flora objects that were there
  // before -- functionally identical to what a fresh generation would have
  // produced for that footprint, without re-running the whole generator.
  function release(zone, instance) {
    if (!instance) return;
    clearOccupied(zone, instance.site.x, instance.site.y, instance.site.w, instance.site.h);
    zone.objects = (zone.objects || []).filter(o => o.temporaryLocaleInstanceId !== instance.id);

    for (const [key, snap] of Object.entries(instance.tileSnapshot || {})) {
      const [x, y] = key.split(',').map(Number);
      const t = tileAt(zone, x, y);
      if (!t) continue;
      t.path = snap.path; t.water = snap.water; t.terrain = snap.terrain; t.waterfall = snap.waterfall;
    }
    for (const obj of (instance.removedObjectSnapshots || [])) {
      zone.objects.push({ ...obj });
      markOccupied(zone, obj.id, obj.x, obj.y, obj.w || 1, obj.h || 1);
    }
  }

  // Convenience: every tent-kind object this instance placed that's still
  // standing (destroyed=false). A camp counts as "cleared" once this is empty.
  function livingTents(zone, instance) {
    return (zone.objects || []).filter(o =>
      o.temporaryLocaleInstanceId === instance.id && o.type === 'tent' && !o.destroyed);
  }

  root.TemporaryLocales = {
    footprintBBox, findSite, stamp, release, livingTents,
    DEFAULT_CLEARABLE_TYPES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
