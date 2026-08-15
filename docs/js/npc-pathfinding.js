(() => {
  'use strict';

  // NPC walkability/beeline checks and the area-graph search that resolves
  // how an NPC gets from one map to another — pulled out of game.js's ~25k-
  // line closure following the same window.<Namespace> + init(deps) pattern
  // as js/npc-scheduling.js (which owns "where should this NPC be" instead
  // of "can it actually walk there").
  //
  // Pulled out specifically because isNpcTileWalkable was the site of a real
  // bug this session: it checked a building-interior tile against the
  // outdoor FARM grid first, before ever reaching its own building-grid
  // check — a building's (c,r) values are a completely separate coordinate
  // space from the farm's, so a normal interior tile could get rejected
  // purely by coincidence with whatever's built on the farm at that same
  // raw coordinate. That silently broke station-wander and grid-path
  // routing for any building NPC unlucky enough to land on a blocked farm
  // tile — seen as an NPC arriving, then never moving again, every
  // wander-tile pick or path attempt failing and silently retrying forever.
  // Keeping this logic in one focused file, instead of interleaved among
  // combat/dialogue/rendering elsewhere in the monolith, is meant to make
  // the next one of these easier to spot.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // `area`'s own tile grid may live behind reassignable variables (grid/
  // townGrid get replaced wholesale on new-game/reset) — deps exposes those
  // as getters; interiorGrid, TileType, and worldObjects are stable
  // references the whole session, passed straight through.
  function isNpcTileWalkable(area, c, r) {
    if (deps.isBuildingArea(area)) {
      const bg = deps.npcGridForArea(area);
      if (!bg?.[r]?.[c] || deps.isSolid(bg[r][c].type)) return false;
      return !deps.furnitureBlocksMovementAt(area, c + 0.5, r + 0.5);
    }
    const g = area === 'interior' ? deps.getInteriorGrid() : area === 'town' ? deps.getTownGrid() : deps.getGrid();
    const tile = g[r]?.[c];
    if (!tile || deps.isSolid(tile.type) || tile.crop || tile.type === deps.TileType.TRENCH || tile.type === deps.TileType.RIVER || tile.type === deps.TileType.STREAM) return false;
    if (area === 'farm' && (deps.worldObjects.has(c + ',' + r) || deps.isHouseFootprint(c, r))) return false;
    if (area !== 'town' && deps.furnitureBlocksMovementAt(area, c + 0.5, r + 0.5)) return false;
    if (area === 'town' && deps.isTownBuildingCollisionTile(c, r)) return false;
    if (deps.isZoneArea(area) && deps.isTownBuildingCollisionTile(c, r, area)) return false;
    return true;
  }

  function canNpcBeeline(area, fromX, fromZ, targetC, targetR, allowOccupiedTarget = false) {
    const tx = targetC + 0.5, tz = targetR + 0.5;
    const dist = Math.hypot(tx - fromX, tz - fromZ);
    const step = deps.npcMovementConfig().beelineSampleStepTiles ?? 0.25;
    const samples = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const c = Math.floor(fromX + (tx - fromX) * t);
      const r = Math.floor(fromZ + (tz - fromZ) * t);
      if (!isNpcTileWalkable(area, c, r) && !(allowOccupiedTarget && c === targetC && r === targetR)) return false;
    }
    return true;
  }

  // One-hop links reachable directly from `area`, in the shape
  // { toArea, exit:{c,r}, spawn:{c,r} } — the raw edges of the area graph
  // findNpcAreaLink() searches below. Mirrors the exact matching rules the
  // single-hop version of this code used to use, so existing direct links
  // (town↔building, building→town, farm↔interior) behave identically.
  function areaLinksFrom(area) {
    const pool = deps.npcTransitionPool(area);
    const links = [];
    for (const t of pool) {
      if (t.target === 'building' && t.targetMapId) {
        if (!deps.buildingScenes.has(t.targetMapId)) deps.loadBuildingScene(t.targetMapId); // warm it up before an NPC reaches the door
        const bi = deps.buildingScenes.get(t.targetMapId);
        const spawn = bi ? deps.buildingSpawnFromExit(bi, bi.cols, bi.rows)
          : { col: t.targetCol ?? 0, row: t.targetRow ?? 0 };
        links.push({ toArea: t.targetMapId, exit: { c: t.col, r: t.row }, spawn: { c: spawn.col, r: spawn.row } });
      } else if (t.target === 'exit_building') {
        const townSpot = deps.npcTransitionPool('town').find(x => x.target === 'building' && x.targetMapId === area);
        const spawn = townSpot ? { c: townSpot.col, r: townSpot.row } : { c: t.targetCol ?? 0, r: t.targetRow ?? 0 };
        links.push({ toArea: 'town', exit: { c: t.col, r: t.row }, spawn });
      } else if (t.target && t.target !== 'zone' && Number.isFinite(t.targetCol) && Number.isFinite(t.targetRow)) {
        links.push({ toArea: t.target, exit: { c: t.col, r: t.row }, spawn: { c: t.targetCol, r: t.targetRow } });
      }
    }
    return links;
  }

  // Resolves the door an NPC should walk to in order to leave `fromArea`
  // toward `toArea`, plus the spot they should appear at once they arrive —
  // i.e. the Spot doubles as both the movement target on the way out and
  // the spawn point on the way in, so NPCs are never warped straight to
  // their final schedule target through a wall. `toArea` may be several
  // hops away (e.g. town → a building's ground floor → one of its
  // upstairs rooms) — this does a short BFS over the area graph and
  // returns only the *first* hop; the caller re-resolves on arrival,
  // which naturally chains the walk leg by leg instead of skipping
  // straight to the final room.
  function findNpcAreaLink(fromArea, toArea) {
    if (fromArea === toArea) return null;
    const visited = new Set([fromArea]);
    const queue = [{ area: fromArea, firstHop: null }];
    while (queue.length) {
      const { area, firstHop } = queue.shift();
      for (const link of areaLinksFrom(area)) {
        const hop = firstHop || link;
        if (link.toArea === toArea) return hop;
        if (!visited.has(link.toArea)) {
          visited.add(link.toArea);
          queue.push({ area: link.toArea, firstHop: hop });
        }
      }
    }
    return null;
  }

  window.NpcPathfinding = {
    init,
    isNpcTileWalkable,
    canNpcBeeline,
    areaLinksFrom,
    findNpcAreaLink,
  };
})();

// Foliage-furniture runtime bootstrap. This file loads immediately before
// game.js, so parser-time synchronous insertion lets the renderer/adapter wrap
// the existing wilderness/furniture module init() calls before gameplay boot.
(() => {
  'use strict';
  if (typeof document === 'undefined' || window.FoliageFurnitureRuntime) return;
  const currentUrl = document.currentScript?.src || ''; // Used to resolve sibling runtime modules on any host/branch.
  const sibling = name => currentUrl ? new URL(name, currentUrl).toString() : `js/${name}`;
  const rendererUrl = sibling('foliage-furniture-renderer.js?v=20260815a');
  const runtimeUrl = sibling('foliage-furniture-runtime.js?v=20260815a');
  if (document.readyState === 'loading') {
    document.write('<script src="' + rendererUrl.replace(/"/g, '&quot;') + '"><\\/script>');
    document.write('<script src="' + runtimeUrl.replace(/"/g, '&quot;') + '"><\\/script>');
    return;
  }
  const load = (url) => new Promise((resolve, reject) => { // Fallback used only when this module is loaded after parser-time boot in a tool/test harness.
    const script = document.createElement('script'); script.src = url; script.async = false; script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${url}`)); document.head.appendChild(script);
  });
  load(rendererUrl).then(() => load(runtimeUrl)).catch(error => console.error('[FoliageFurnitureRuntime]', error));
})();
