// Ruin-entrance locale expansion for the Tothal Shift.
//
// docs/config/locales/locale_ruin_entrance.json is authored once, facing
// north (cliff along its south edge). Every Tothal Shift this turns it into a
// handful of per-zone copies, each rotated to one of the four cliff facings,
// with ids that include the Tothal cycle so every shift's ruins are new
// discoveries rather than inheriting last month's map markers. The copies go
// through the ordinary terrain-aware locale placement untouched.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RuinSiteLocales = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const CATEGORY = 'ruin_entrance';
  const FACINGS = ['north', 'east', 'south', 'west'];
  const SIDES = FACINGS; // Connector sides rotate exactly like facings.

  const round = value => Math.round(value * 1e6) / 1e6; // Fractional slot positions must survive four quarter turns exactly.
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function hashString(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function rotateDirection(direction, steps) {
    const index = FACINGS.indexOf(direction);
    return index < 0 ? direction : FACINGS[(index + steps) % 4];
  }

  // One clockwise quarter turn of a rows-tall grid: (c, r) -> (rows - 1 - r, c)
  // for a unit cell. Objects keep their top-left anchor convention, so a w x h
  // footprint's new top-left is (rows - (r + h), c).
  function rotateCellKey(key, rows) {
    const [c, r] = String(key).split(',').map(Number);
    return `${rows - 1 - r},${c}`;
  }

  function rotateRuleMap(map, rows, rotateFacing) {
    if (!map) return map;
    const out = {};
    for (const [key, rule] of Object.entries(map)) {
      const next = clone(rule);
      if (rotateFacing && next && next.facing && next.facing !== 'any') next.facing = rotateDirection(next.facing, 1);
      out[rotateCellKey(key, rows)] = next;
    }
    return out;
  }

  function rotateOnce(locale) {
    const rows = Number(locale.rows) || 1, cols = Number(locale.cols) || 1;
    const out = clone(locale);
    out.cols = rows; out.rows = cols;
    out.tiles = rotateRuleMap(locale.tiles, rows, false);
    out.terrainAnchors = rotateRuleMap(locale.terrainAnchors, rows, true);
    out.embeddedTiles = rotateRuleMap(locale.embeddedTiles, rows, true);
    out.objects = (locale.objects || []).map(object => {
      const w = Number(object.w) || 1, h = Number(object.h) || 1;
      const next = clone(object);
      next.col = round(rows - ((Number(object.row) || 0) + h));
      next.row = Number(object.col) || 0;
      next.w = h; next.h = w;
      next.rot = ((Number(object.rot) || 0) + 90) % 360;
      if (next.visual?.facing) next.visual.facing = rotateDirection(next.visual.facing, 1);
      return next;
    });
    out.connectors = (locale.connectors || []).map(connector => ({
      ...clone(connector),
      col: round(rows - 1 - (Number(connector.row) || 0)),
      row: Number(connector.col) || 0,
      side: rotateDirection(connector.side, 1),
    }));
    if (out.placement) {
      out.placement.terrainAnchors = rotateRuleMap(locale.placement.terrainAnchors, rows, true);
      out.placement.embeddedTiles = rotateRuleMap(locale.placement.embeddedTiles, rows, true);
      const fallback = locale.placement.terrainFallback;
      if (fallback) {
        out.placement.terrainFallback = {
          ...clone(fallback),
          terrainAnchors: (fallback.terrainAnchors || []).map(key => rotateCellKey(key, rows)),
          embeddedTiles: (fallback.embeddedTiles || []).map(key => rotateCellKey(key, rows)),
        };
      }
    }
    return out;
  }

  function rotateToFacing(locale, facing) {
    const from = FACINGS.indexOf(locale.objects?.find(o => o.visual?.facing)?.visual?.facing || 'north');
    const to = FACINGS.indexOf(facing);
    let out = clone(locale);
    const steps = ((to - Math.max(0, from)) % 4 + 4) % 4;
    for (let i = 0; i < steps; i++) out = rotateOnce(out);
    return out;
  }

  // Replaces each ruin_entrance template in `defs` with per-zone rotated
  // copies for this Tothal cycle. Other locales pass through untouched.
  function expandLocaleDefs(defs, cycle, zoneIds, worldId = '') {
    const out = [];
    for (const def of defs || []) {
      if (def?.category !== CATEGORY) { out.push(def); continue; }
      const perZone = Math.max(0, Math.min(4, Math.round(Number(def.ruinSite?.copiesPerZone ?? 2))));
      const excluded = new Set(def.ruinSite?.excludeZones || []);
      (zoneIds || []).forEach((zoneId, zoneIndex) => {
        if (excluded.has(zoneId)) return;
        const start = hashString(`${worldId}|${cycle}|${zoneId}`) % 4;
        for (let k = 0; k < perZone; k++) {
          const facing = FACINGS[(start + k) % 4]; // Distinct facings per zone widen the set of cliffs a copy can fit.
          const copy = rotateToFacing(def, facing);
          copy.id = `${def.id}_c${cycle}_${zoneIndex + 1}_${k + 1}`;
          copy.templateId = def.id;
          copy.singleton = true;
          copy.placement = { ...(copy.placement || {}), allowedZones: [zoneId], maxInstances: 1 };
          copy.ruinSite = { ...(copy.ruinSite || {}), cycle, facing, zoneId };
          out.push(copy);
        }
      });
    }
    return out;
  }

  function isRuinEntranceLocale(locale) {
    return locale?.category === CATEGORY;
  }

  return { CATEGORY, FACINGS, hashString, rotateOnce, rotateToFacing, expandLocaleDefs, isRuinEntranceLocale };
});
