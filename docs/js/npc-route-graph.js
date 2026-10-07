// Authored NPC Route normalization + route-graph construction, extracted
// from game.js. Pure functions: game.js's thin hoisted wrappers
// (normalizeRoutes / isRouteSegmentDry / buildRouteGraph) pass in the two
// closure helpers these need — normalizeNpcArea and isNpcTileWalkable —
// so nothing here depends on init order.
(() => {
  'use strict';
  if (window.NpcRouteGraph) return;

  function normalizeRoutes(routes, legacyPaths = [], normalizeNpcArea = area => area || 'farm') {
    const out = (routes || []).filter(r => r && Array.isArray(r.nodes) && r.nodes.length > 0)
      .map(r => ({ id: r.id, label: r.label || 'Route', area: normalizeNpcArea(r.area || 'farm'), nodes: r.nodes.map(n => [n[0], n[1]]) }));
    if (!out.length) (legacyPaths || []).forEach(p => out.push({ id: 'legacy_' + (p.id || p.label || out.length), label: p.label || 'Legacy route', area: normalizeNpcArea(p.area || 'farm'), nodes: p.nodes.map(n => [n[0], n[1]]) }));
    return out;
  }

  // Whether the straight segment between two route nodes stays on dry,
  // walkable ground (no river crossing) — sampled the same way as
  // canNpcBeeline so authored route edges respect the same rules.
  function isRouteSegmentDry(area, c1, r1, c2, r2, isNpcTileWalkable) {
    const x1 = c1 + 0.5, z1 = r1 + 0.5, x2 = c2 + 0.5, z2 = r2 + 0.5;
    const dist = Math.hypot(x2 - x1, z2 - z1);
    const samples = Math.max(1, Math.ceil(dist / 0.5));
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const c = Math.floor(x1 + (x2 - x1) * t);
      const r = Math.floor(z1 + (z2 - z1) * t);
      if (!isNpcTileWalkable(area, c, r)) return false;
    }
    return true;
  }

  function buildRouteGraph(routes, isNpcTileWalkable) {
    const nodes = new Map();
    const key = (area, c, r) => area + ':' + c + ',' + r;
    const ensure = (area, c, r) => {
      const k = key(area, c, r);
      if (!nodes.has(k)) nodes.set(k, { key: k, area, c, r, edges: new Set(), routeIds: new Set() });
      return nodes.get(k);
    };
    routes.forEach(route => {
      const area = route.area || 'farm';
      let prev = null;
      (route.nodes || []).forEach(([c, r]) => {
        const node = ensure(area, c, r);
        if (route.id) node.routeIds.add(route.id);
        // Skip edges that wade through a river — NPCs following this route
        // will detour via any other dry edge instead of crossing the water.
        if (prev && isRouteSegmentDry(area, prev.c, prev.r, c, r, isNpcTileWalkable)) { prev.edges.add(node.key); node.edges.add(prev.key); }
        prev = node;
      });
    });
    return { nodes };
  }

  window.NpcRouteGraph = Object.freeze({ normalizeRoutes, isRouteSegmentDry, buildRouteGraph });
})();
