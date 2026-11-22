// Shared generated-object footprint ownership for wilderness locale placement and live camp clearings.
// A multi-tile boulder is one object: never keep orphaned rendered/collision tiles
// when a later locale displaces any part of its footprint.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WildernessObjectFootprints = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isBoulder(tile) {
    return !!tile && (tile.generatedObjectType === 'undiggableBoulder'
      || tile.rockKind === 'undiggableBoulder' || !!tile.boulderId);
  }

  function boulderCells(zone, startC, startR) {
    const rows = zone?.tiles; // Source grid used by the temporary-camp migration/clearing adapter.
    const origin = rows?.[startR]?.[startC]; // Seed must still belong to the original solid formation.
    if (!isBoulder(origin)) return [];
    const groupId = origin.boulderId || null; // Exact ID separates independently generated touching rocks.
    const visited = new Set(); // Four-connected seed expansion; never scan every zone tile per camp.
    const queue = [[startC, startR]]; // BFS worklist of candidates belonging to this one formation.
    const cells = []; // Only positively matched tiles are returned to the caller.
    for (let i = 0; i < queue.length; i++) {
      const [c, r] = queue[i]; // Next candidate in the bounded flood fill.
      if (c < 0 || r < 0 || c >= (zone?.cols || 0) || r >= (zone?.rows || 0)) continue;
      const key = c + ',' + r; // Deduplicates queue entries near turns and forks.
      if (visited.has(key)) continue;
      visited.add(key);
      const tile = rows?.[r]?.[c]; // Retains the source tile before a camp temporarily paints grass.
      if (!isBoulder(tile) || (tile.boulderId || null) !== groupId) continue;
      cells.push([c, r]);
      queue.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    return cells;
  }

  function localeBlocksSite(instance, col, row, margin = 1.5) {
    const x = col + 0.5, z = row + 0.5; // Proposed scenery center in final wilderness tile units.
    const pad = Math.max(0, Number(margin) || 0); // Visual overhang margin shared by locale-aware landmark placement.
    let hasBox = false; // Legacy locales lacking footprint metadata retain their old anchor-radius safeguard.
    const matches = box => {
      if (!box || ![box.x, box.y, box.w, box.h].every(value => Number.isFinite(Number(value)))) return false;
      const bx = Number(box.x), by = Number(box.y), w = Number(box.w), h = Number(box.h); // Rectangle dimensions are already in final world tile units.
      if (w <= 0 || h <= 0) return false;
      hasBox = true;
      return x >= bx - pad && x <= bx + w + pad && z >= by - pad && z <= by + h + pad;
    };
    if (matches(instance?.footprint)) return true; // Authored painted floor, not merely the entrance or locale anchor.
    if (matches(instance?.footprint ? null : instance)) return true; // Pre-metadata saves have top-left + size.
    for (const object of instance?.objects || []) {
      if (matches(object)) return true; // Furniture and auxiliary structures can protrude outside painted floor.
    }
    if (hasBox) return false;
    const anchorX = Number(instance?.x ?? instance?.col), anchorY = Number(instance?.y ?? instance?.row); // Older locale instances may have only an anchor.
    return Number.isFinite(anchorX) && Number.isFinite(anchorY) && Math.hypot(col - anchorX, row - anchorY) < 6; // Preserve the original seed's anchor-only compatibility policy.
  }

  function clearExportedObjects(workspace, objectIds) {
    const ids = new Set([...(objectIds || [])].filter(id => id !== undefined && id !== null && id !== '')); // All selected generated objects are cleared by identity.
    if (!ids.size) return { objects: 0, tiles: 0 };
    let tiles = 0; // Diagnostic count of every root/plateau overlay changed.
    for (const map of workspace?.maps || []) {
      for (const tile of Object.values(map?.tiles || {})) {
        if (!ids.has(tile?.generatedObjectId)) continue;
        // These tile types are object overlays, not permanent terrain. Preserve
        // plateau and elevation metadata so the underlying ground remains intact.
        if (tile.type === 'rock' || tile.type === 'shrub' || tile.type === 'weeds') tile.type = 'grass';
        delete tile.generatedObjectId;
        delete tile.generatedObjectType;
        delete tile.generatedObjectOreKind;
        delete tile.floraKind;
        delete tile.rockKind;
        delete tile.boulderId;
        tiles++;
      }
    }
    if (Array.isArray(workspace?.objects)) workspace.objects = workspace.objects.filter(object => !ids.has(object?.id));
    if (Array.isArray(workspace?.furniture)) workspace.furniture = workspace.furniture.filter(object => !ids.has(object?.generatedObjectId) && !ids.has(object?.id));
    return { objects: ids.size, tiles };
  }

  return { isBoulder, boulderCells, localeBlocksSite, clearExportedObjects };
});
