(() => {
  'use strict';

  const Preview = window.WildernessLabPreview;
  if (!Preview || Preview.__wildernessLabExportedObjectIndexInstalled) return;
  Preview.__wildernessLabExportedObjectIndexInstalled = true;

  function worldOffsetForMap(map, mapsById, cache, visiting = new Set()) {
    if (!map?.isSubmap) return { c: 0, r: 0 };
    if (cache.has(map.id)) return cache.get(map.id);
    if (visiting.has(map.id)) return { c: Number(map.anchorC) || 0, r: Number(map.anchorR) || 0 };
    visiting.add(map.id);
    const parent = mapsById.get(map.parentMapId);
    const parentOffset = parent ? worldOffsetForMap(parent, mapsById, cache, visiting) : { c: 0, r: 0 }; // Parent offset keeps this correct if generated plateau submaps ever become nested.
    const offset = {
      c: parentOffset.c + (Number(map.anchorC) || 0),
      r: parentOffset.r + (Number(map.anchorR) || 0),
    };
    cache.set(map.id, offset);
    visiting.delete(map.id);
    return offset;
  }

  function reconstructGeneratedObjects(workspace) {
    const maps = Array.isArray(workspace?.maps) ? workspace.maps : [];
    const mapsById = new Map(maps.map(map => [map.id, map])); // Map lookup resolves submap anchors into root-map world coordinates.
    const offsetCache = new Map(); // Cached map offsets avoid recalculating parent chains for every generated tile.
    const byId = new Map(); // generatedObjectId -> aggregate world-space footprint across every encoded tile.
    let taggedTiles = 0; // Debug count distinguishes "no generated data" from a marker-rendering failure.

    for (const map of maps) {
      const offset = worldOffsetForMap(map, mapsById, offsetCache);
      for (const [key, tile] of Object.entries(map?.tiles || {})) {
        const type = tile?.generatedObjectType;
        if (!type) continue;
        const match = /^(\d+),(\d+)$/.exec(key);
        if (!match) continue;
        taggedTiles++;
        const c = Number(match[1]) + offset.c;
        const r = Number(match[2]) + offset.r;
        const id = tile.generatedObjectId || `${map.id}:${key}:${type}`; // Fallback keeps malformed legacy records visible instead of dropping them.
        let record = byId.get(id);
        if (!record) {
          record = { id, type, minC: c, maxC: c, minR: r, maxR: r, tileCount: 0 }; // Aggregated bounds rebuild the object's world footprint from its exported tile encoding.
          byId.set(id, record);
        }
        record.minC = Math.min(record.minC, c);
        record.maxC = Math.max(record.maxC, c);
        record.minR = Math.min(record.minR, r);
        record.maxR = Math.max(record.maxR, r);
        record.tileCount++;
      }
    }

    const objects = [...byId.values()].map(record => ({
      id: record.id,
      type: record.type,
      x: record.minC,
      y: record.minR,
      w: Math.max(1, record.maxC - record.minC + 1),
      h: Math.max(1, record.maxR - record.minR + 1),
      recoveredFromExportTiles: true,
      recoveredTileCount: record.tileCount,
    }));
    return { objects, taggedTiles };
  }

  const originalRenderWorkspace = Preview.renderWorkspace.bind(Preview); // Terrain preview stays authoritative; this adapter only restores generator object metadata for the later cube-marker pass.
  Preview.renderWorkspace = (workspace, rootId, winterSettings) => {
    const recovered = reconstructGeneratedObjects(workspace);
    try {
      Object.defineProperty(workspace, 'objects', {
        configurable: true,
        writable: true,
        enumerable: false,
        value: recovered.objects,
      }); // Non-enumerable keeps Export workspace JSON identical while satisfying the marker renderer's expected object array.
    } catch (_) {
      workspace.objects = recovered.objects;
    }
    window.__wildernessLabRecoveredObjectStats = {
      objectCount: recovered.objects.length,
      taggedTiles: recovered.taggedTiles,
      counts: recovered.objects.reduce((counts, object) => {
        counts[object.type] = (counts[object.type] || 0) + 1;
        return counts;
      }, {}),
    };
    console.log('[WildernessLab] recovered generated objects from exported tile metadata:', window.__wildernessLabRecoveredObjectStats);
    return originalRenderWorkspace(workspace, rootId, winterSettings);
  };

  Preview.getRecoveredObjectStats = () => window.__wildernessLabRecoveredObjectStats || null;
})();