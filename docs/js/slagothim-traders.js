(() => {
  'use strict';

  // Slagothim trade caravans.
  //
  // Once Town Value reaches 1, small groups of Slagothim traders start coming
  // up the southern road (the Southern Cloud Forest's trade exit, carved by
  // wilderness-map-generator.js's chooseTradeExit) on an unreliable daily
  // roll that gets likelier as Town Value rises. A caravan follows the roads:
  // through the Cloud Forest (stopping at a Porakaneki camp near the road),
  // into town to set up at the market, usually on out to one other wilderness
  // zone's Porakaneki camp and back, then home down the southern road. It
  // only travels by day and camps where it stands at night.
  //
  // Balance: the caravan is meant to be met, not hunted. Its arrival is
  // announced the moment it enters the region (with an ETA to the market),
  // it stops at the market for a long, announced window, its stock is fixed
  // for the whole trip (meeting it on the road sells nothing the market
  // stall wouldn't), and goods carry a steep markup. A player in the same
  // zone is told when it passes the stretch of road nearest them and gets a
  // compass marker inside COMPASS_RADIUS_TILES, so there is never a reason
  // to walk the roads looking for one.
  //
  // Simulation is abstract (leg index + distance along a road polyline,
  // advanced by world time) everywhere. Only while the player shares the
  // caravan's area and is within MATERIALIZE_RADIUS_TILES are its members
  // built as real NPC walkers (game.js's makeNpcWalker, held with
  // pause = Infinity and steered along the same polyline), which gives them
  // the normal Talk interaction plus a Trade button (see actionButtonFor).
  //
  // game.js wires this in with one init(deps) call; state is saved with the
  // member's world data (serialize/restore) like TownMine's.

  const SCHEDULER_ID = 'slagothim-traders';
  const CLOUD_FOREST = 'map_southern_cloud_forest';
  const DESTINATION_ZONES = Object.freeze(['map_northern_cliffs', 'map_western_slope', 'map_eastern_mire']);
  const TRADE_ACTION = 'npc_slagothim_trade';
  const PANEL_ID = 'slagothimTradePanel';
  const SAVE_VERSION = 1;

  const TUNING = Object.freeze({
    MIN_TOWN_VALUE: 1, // Caravans never appear before the town has grown at least once.
    DAILY_CHANCE_BASE: 0.15, // Chance per world day at Town Value 1…
    DAILY_CHANCE_PER_TOWN_VALUE: 0.06, // …plus this per Town Value above 1…
    DAILY_CHANCE_MAX: 0.7, // …capped so caravans never become clockwork.
    MAX_ACTIVE_CARAVANS: 1,
    MAX_ACTIVE_CARAVANS_HIGH: 2, // At HIGH_TOWN_VALUE and above two may be on the roads at once.
    HIGH_TOWN_VALUE: 5,
    ARRIVAL_HOUR_MIN: 7, // The daily roll happens at a seeded hour in this window.
    ARRIVAL_HOUR_MAX: 13,
    TRAVEL_START_HOUR: 6, // Caravans walk only between these hours and camp in place otherwise.
    TRAVEL_END_HOUR: 20,
    WALK_TILES_PER_SECOND: 1.2, // Real-time walking pace; converted to tiles per game hour via the calendar day length.
    MARKET_STOP_HOURS: 4,
    RETURN_MARKET_STOP_HOURS: 1.5,
    CAMP_STOP_HOURS: 1.5,
    CAMP_DETOUR_MAX_TILES: 45, // A road camp further than this from the road is skipped.
    RETURN_DIRECTLY_CHANCE: 0.3, // Some caravans go straight home after the market.
    MEMBERS_MIN: 3,
    MEMBERS_MAX: 4,
    MEMBER_SPACING_TILES: 1.4,
    MATERIALIZE_RADIUS_TILES: 70,
    RELEASE_RADIUS_TILES: 90,
    COMPASS_RADIUS_TILES: 60,
    PRICE_MARKUP: 2.2, // Over an item's ordinary sale value.
    HIGH_BAR_COUNT_WEIGHTS: Object.freeze([0.7, 0.25, 0.05]), // 0 / 1 / 2 bars above the Town Value metal ceiling.
    HIGH_BAR_PRICE_PER_TIER: 70,
    HIGH_BAR_PRICE_BASE: 40,
    TRINKET_CHANCE: 0.06,
    TRINKET_CHANCE_PER_TOWN_VALUE: 0.01,
    TRINKET_CHANCE_MAX: 0.15,
    RELIC_CHANCE: 0.04,
    RELIC_CHANCE_PER_TOWN_VALUE: 0.01,
    RELIC_CHANCE_MAX: 0.12,
    RELIC_PRICE_BASE: 700,
    RELIC_PRICE_PER_ENCHANTMENT: 220,
    TRINKET_PRICE_BASE: 260,
    TRINKET_PRICE_PER_ATTUNEMENT: 160,
  });

  // Fish catalog rows keep the authored lowercase season words.
  const FISH_SEASON_NAMES = Object.freeze({ spring: 'Stormtide', summer: 'Deadgrass', fall: 'Longpour', winter: 'Coldmuck' });
  const WET_SEASONS = Object.freeze(['Stormtide', 'Longpour']); // Seasonal produce tagged 'Wet Season' / 'Dry Season'.
  // Tile costs for road-following routes. Missing => blocked.
  const TILE_COST = Object.freeze({ path: 1, ramp: 1.5, grass: 3, weeds: 3.5, tilled: 4, river: 16, stream: 10 });
  const INCLINE_EXTRA_COST = 8; // Cliff walls are climbable but a caravan avoids them.
  const FALLBACK_NAMES = Object.freeze(['Tlaxo', 'Huemac', 'Itzal', 'Chimal', 'Xoco', 'Nenetl', 'Ocelo', 'Teyol']);

  let deps = null;
  let schedulerRegistered = false;
  let lastWorldHours = null;
  let passCheckAccum = 0;
  const gridCache = new Map(); // area -> routing grid (rebuilt when the zone layout/town grid object changes).
  const state = {
    lastRollDay: null,
    seq: 0,
    caravans: [],
    notices: 0,
    lastReason: 'boot',
  };

  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  function hashSeed(text) {
    let h = 2166136261 >>> 0;
    for (const ch of String(text || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seededRng(text) {
    let a = hashSeed(text) || 0x9e3779b9;
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const pick = (rng, list) => list[Math.floor(rng() * list.length)];
  const intRoll = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  function shuffled(rng, list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  // ── World clock / town value ────────────────────────────────────────
  function worldHours() {
    const calendar = deps?.calendar;
    if (!calendar) return null;
    return (num(calendar.day, 1) + num(calendar.time01, 0)) * 24;
  }
  const hourOfDay = hours => ((hours % 24) + 24) % 24;
  function isTravelHour(hours) {
    const h = hourOfDay(hours);
    return h >= TUNING.TRAVEL_START_HOUR && h < TUNING.TRAVEL_END_HOUR;
  }
  function hoursUntilTravel(hours) {
    const h = hourOfDay(hours);
    return h < TUNING.TRAVEL_START_HOUR ? TUNING.TRAVEL_START_HOUR - h : 24 - h + TUNING.TRAVEL_START_HOUR;
  }
  function tilesPerHour() {
    const dayLength = num(window.CalendarSystem?.constants?.TARGET_DAY_LENGTH_SECONDS, 672);
    return TUNING.WALK_TILES_PER_SECOND * dayLength / 24;
  }
  function townValue() { return Math.max(0, Math.floor(num(window.TownMine?.getTownValue?.(), 0))); }
  function dailySpawnChance(value = townValue()) {
    if (value < TUNING.MIN_TOWN_VALUE) return 0;
    return clamp(TUNING.DAILY_CHANCE_BASE + (value - TUNING.MIN_TOWN_VALUE) * TUNING.DAILY_CHANCE_PER_TOWN_VALUE, 0, TUNING.DAILY_CHANCE_MAX);
  }
  function maxActiveCaravans(value = townValue()) {
    return value >= TUNING.HIGH_TOWN_VALUE ? TUNING.MAX_ACTIVE_CARAVANS_HIGH : TUNING.MAX_ACTIVE_CARAVANS;
  }
  function currentSeasonName() {
    try { return String(window.CalendarSystem?.currentSeason?.()?.name || 'Stormtide'); }
    catch (_) { return 'Stormtide'; }
  }
  function worldSeedLabel() {
    try { return String(deps?.tothalWorldId?.() || 'world'); } catch (_) { return 'world'; }
  }
  function formatClock(hours) {
    const h = Math.floor(hourOfDay(hours));
    const suffix = h < 12 ? 'AM' : 'PM';
    return `${((h + 11) % 12) + 1} ${suffix}`;
  }
  function areaLabel(area) {
    if (area === 'town') return 'Hobunji Hollow';
    return deps?.EXTERIOR_ZONES?.[area]?.label || area;
  }
  function currentArea() { return deps?.getCurrentArea?.() || null; }

  // ── Routing grids ───────────────────────────────────────────────────
  function gridForArea(area) {
    if (!deps) return null;
    if (area === 'town') {
      const townGrid = deps.getTownGrid?.();
      if (!Array.isArray(townGrid) || !townGrid.length) return null;
      const cached = gridCache.get('town');
      if (cached?.source === townGrid) return cached;
      const rows = townGrid.length, cols = townGrid[0]?.length || 0;
      const cost = new Float32Array(cols * rows).fill(-1);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!deps.isTownTileWalkable?.(c, r)) continue;
        cost[r * cols + c] = townGrid[r][c]?.type === 'path' ? 1 : 3;
      }
      const grid = { area, source: townGrid, cols, rows, cost, tier: null, incline: null, routes: new Map() };
      gridCache.set('town', grid);
      return grid;
    }
    const layout = deps.getZoneLayout?.(area);
    if (!layout?.tiles?.length || !layout.cols || !layout.rows) return null;
    const cached = gridCache.get(area);
    if (cached?.source === layout) return cached;
    return buildZoneGrid(area, layout);
  }

  function buildZoneGrid(area, layout) {
    const { cols, rows } = layout;
    const cost = new Float32Array(cols * rows).fill(-1);
    const tier = new Int16Array(cols * rows);
    const incline = new Uint8Array(cols * rows);
    for (const tile of layout.tiles) {
      if (!(tile?.c >= 0 && tile.c < cols && tile.r >= 0 && tile.r < rows)) continue;
      const index = tile.r * cols + tile.c;
      const base = TILE_COST[tile.type];
      tier[index] = num(tile.elevTier, 0);
      incline[index] = tile.incline ? 1 : 0;
      if (base == null) continue;
      cost[index] = base + (tile.incline ? INCLINE_EXTRA_COST : 0);
    }
    const block = (x, y, w = 1, h = 1) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      for (let r = Math.floor(y); r < Math.floor(y) + Math.max(1, Math.ceil(h)); r++) {
        for (let c = Math.floor(x); c < Math.floor(x) + Math.max(1, Math.ceil(w)); c++) {
          if (c >= 0 && c < cols && r >= 0 && r < rows) cost[r * cols + c] = -1;
        }
      }
    };
    for (const building of (layout.buildings || [])) block(building.gridX, building.gridZ, building.footprintW ?? building.w ?? 1, building.footprintD ?? building.h ?? 1);
    for (const den of (layout.dens || [])) block(den.x, den.y, den.w, den.h);
    for (const instance of (layout.localeInstances || [])) for (const object of (instance.objects || [])) block(object.x, object.y, object.w, object.h);
    const grid = { area, source: layout, cols, rows, cost, tier, incline, routes: new Map() };
    gridCache.set(area, grid);
    return grid;
  }

  const passable = (grid, c, r) => c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && grid.cost[r * grid.cols + c] >= 0;
  function stepAllowed(grid, a, b) {
    if (!grid.tier) return true;
    return grid.tier[a] === grid.tier[b] || grid.incline[a] === 1 || grid.incline[b] === 1;
  }

  function snapToPassable(grid, c, r, maxRadius = 18) {
    const c0 = Math.round(num(c, 0)), r0 = Math.round(num(r, 0));
    let best = null, bestScore = Infinity;
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        const cc = c0 + dc, rr = r0 + dr;
        if (!passable(grid, cc, rr)) continue;
        const score = Math.hypot(dc, dr) + (grid.cost[rr * grid.cols + cc] > 1 ? 0.5 : 0); // Prefer landing on a road tile.
        if (score < bestScore) { bestScore = score; best = { c: cc, r: rr }; }
      }
      if (best) return best;
    }
    return null;
  }

  // Weighted A* over a routing grid. Road tiles are cheap, open ground costs
  // more and fords/cliff walls much more, so the result follows the roads
  // wherever they go and only strikes out across country to bridge gaps.
  const DIR_DC = Int8Array.from([1, -1, 0, 0, 1, 1, -1, -1]);
  const DIR_DR = Int8Array.from([0, 0, 1, -1, 1, -1, 1, -1]);
  const DIR_LEN = Float64Array.from([1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2]);
  const HEURISTIC_WEIGHT = 1.15; // Slightly greedy: road tiles cost 1, so this stays close to optimal while expanding far fewer nodes.
  function findRoute(grid, from, to) {
    const { cols, rows, cost } = grid;
    if (!passable(grid, from.c, from.r) || !passable(grid, to.c, to.r)) return null;
    const total = cols * rows;
    const start = from.r * cols + from.c, goal = to.r * cols + to.c;
    if (start === goal) return [start];
    const tc = to.c, tr = to.r;
    const g = new Float64Array(total).fill(Infinity);
    const came = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    let capacity = 4096, size = 0;
    let heapNode = new Int32Array(capacity), heapPri = new Float64Array(capacity);
    const push = (node, priority) => {
      if (size === capacity) {
        capacity *= 2;
        const nodes = new Int32Array(capacity); nodes.set(heapNode); heapNode = nodes;
        const pri = new Float64Array(capacity); pri.set(heapPri); heapPri = pri;
      }
      let i = size++;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heapPri[parent] <= priority) break;
        heapNode[i] = heapNode[parent]; heapPri[i] = heapPri[parent];
        i = parent;
      }
      heapNode[i] = node; heapPri[i] = priority;
    };
    const pop = () => {
      const top = heapNode[0];
      size -= 1;
      if (size > 0) {
        const node = heapNode[size], priority = heapPri[size];
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          if (l >= size) break;
          const m = l + 1 < size && heapPri[l + 1] < heapPri[l] ? l + 1 : l;
          if (heapPri[m] >= priority) break;
          heapNode[i] = heapNode[m]; heapPri[i] = heapPri[m];
          i = m;
        }
        heapNode[i] = node; heapPri[i] = priority;
      }
      return top;
    };
    g[start] = 0;
    push(start, 0);
    while (size > 0) {
      const current = pop();
      if (closed[current]) continue;
      closed[current] = 1;
      if (current === goal) break;
      const cc = current % cols, cr = (current - cc) / cols;
      const gc = g[current], costCurrent = cost[current];
      for (let d = 0; d < 8; d++) {
        const dc = DIR_DC[d], dr = DIR_DR[d];
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = nr * cols + nc;
        const costNext = cost[next];
        if (costNext < 0 || closed[next]) continue;
        if (d >= 4 && (cost[cr * cols + nc] < 0 || cost[nr * cols + cc] < 0)) continue;
        if (!stepAllowed(grid, current, next)) continue;
        const candidate = gc + DIR_LEN[d] * (costCurrent + costNext) * 0.5;
        if (candidate < g[next]) {
          g[next] = candidate; came[next] = current;
          const hc = Math.abs(nc - tc), hr = Math.abs(nr - tr);
          push(next, candidate + HEURISTIC_WEIGHT * ((hc > hr ? hc : hr) + 0.41421356 * (hc > hr ? hr : hc)));
        }
      }
    }
    if (!closed[goal]) return null;
    const out = [];
    for (let node = goal; node !== -1; node = came[node]) { out.push(node); if (node === start) break; }
    return out.reverse();
  }

  function polylineFromIndices(grid, indices) {
    const points = [];
    for (const index of indices) {
      const point = { x: index % grid.cols + 0.5, z: ((index / grid.cols) | 0) + 0.5 };
      const n = points.length;
      if (n >= 2) {
        const a = points[n - 2], b = points[n - 1];
        if (Math.sign(b.x - a.x) === Math.sign(point.x - b.x) && Math.sign(b.z - a.z) === Math.sign(point.z - b.z)) points[n - 1] = point; // Collinear: extend the segment.
        else points.push(point);
      } else points.push(point);
    }
    return points;
  }

  function cachedRoute(grid, from, to) {
    const key = `${from.c},${from.r}>${to.c},${to.r}`;
    if (grid.routes.has(key)) return grid.routes.get(key);
    const indices = findRoute(grid, from, to);
    const points = indices ? polylineFromIndices(grid, indices) : [{ x: from.c + 0.5, z: from.r + 0.5 }, { x: to.c + 0.5, z: to.r + 0.5 }];
    const route = { points, ok: !!indices };
    grid.routes.set(key, route);
    return route;
  }

  function withLengths(points) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    return { points, cum, length: cum[cum.length - 1] || 0 };
  }

  function pointAt(route, distance) {
    const { points, cum } = route;
    if (!points.length) return { x: 0, z: 0, dx: 0, dz: 1 };
    const d = clamp(distance, 0, route.length);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i)];
    const segment = (cum[i] ?? 0) - (cum[i - 1] ?? 0);
    const t = segment > 1e-6 ? (d - cum[i - 1]) / segment : 0;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    return { x: a.x + dx * t, z: a.z + dz * t, dx: dx / len, dz: dz / len };
  }

  // ── Itinerary ───────────────────────────────────────────────────────
  function resolvePoint(grid, area, spec) {
    const zones = deps?.EXTERIOR_ZONES || {};
    let c = null, r = null;
    if (area === 'town') {
      if (spec.k === 'townGate') { c = zones[spec.zone]?.townReturnCol; r = zones[spec.zone]?.townReturnRow; }
      else if (spec.k === 'market') {
        const gates = [CLOUD_FOREST, ...DESTINATION_ZONES].map(id => zones[id]).filter(z => Number.isFinite(z?.townReturnCol));
        c = gates.reduce((sum, z) => sum + z.townReturnCol, 0) / Math.max(1, gates.length);
        r = gates.reduce((sum, z) => sum + z.townReturnRow, 0) / Math.max(1, gates.length);
      }
    } else {
      const layout = grid.source;
      if (spec.k === 'tradeExit') {
        const exit = layout.tradeExit;
        if (exit) { c = exit.col; r = exit.row - (exit.side === 'south' ? 2 : 0); }
        else { c = grid.cols / 2; r = grid.rows - 3; }
      } else if (spec.k === 'zoneGate') {
        c = layout.toTownExit?.col ?? zones[area]?.entryCol;
        r = layout.toTownExit?.row ?? zones[area]?.entryRow;
      }
    }
    if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
    return snapToPassable(grid, c, r, spec.k === 'market' ? 12 : 18);
  }

  function campSitesFor(area) {
    try { return window.PorakanekiCamps?.occupiedSites?.(area) || []; } catch (_) { return []; }
  }

  function chooseCampStop(grid, area, basePoints, anyDistance) {
    let best = null;
    for (const site of campSitesFor(area)) {
      const center = { x: site.x + site.w / 2, z: site.y + site.h / 2 };
      let distance = Infinity;
      for (let i = 0; i < basePoints.length; i++) distance = Math.min(distance, Math.hypot(basePoints[i].x - center.x, basePoints[i].z - center.z));
      if (!anyDistance && distance > TUNING.CAMP_DETOUR_MAX_TILES) continue;
      if (!best || distance < best.distance) best = { site, distance };
    }
    if (!best) return null;
    const { site } = best;
    // Stand just outside the camp footprint, on whichever side faces the road.
    return snapToPassable(grid, site.x + site.w / 2, site.y + site.h + 1, 10);
  }

  function buildItinerary(rng) {
    const legs = [
      { area: CLOUD_FOREST, from: { k: 'tradeExit' }, to: { k: 'zoneGate' }, camp: true },
      { area: 'town', from: { k: 'townGate', zone: CLOUD_FOREST }, to: { k: 'market' }, stopHours: TUNING.MARKET_STOP_HOURS, stopKind: 'market' },
    ];
    const destination = rng() < TUNING.RETURN_DIRECTLY_CHANCE ? null : pick(rng, DESTINATION_ZONES);
    if (destination) {
      legs.push(
        { area: 'town', from: { k: 'market' }, to: { k: 'townGate', zone: destination }, departing: destination },
        { area: destination, from: { k: 'zoneGate' }, to: { k: 'zoneGate' }, camp: true, campAny: true },
        { area: 'town', from: { k: 'townGate', zone: destination }, to: { k: 'market' }, stopHours: TUNING.RETURN_MARKET_STOP_HOURS, stopKind: 'market' },
      );
    }
    legs.push(
      { area: 'town', from: { k: 'market' }, to: { k: 'townGate', zone: CLOUD_FOREST }, departing: 'home' },
      { area: CLOUD_FOREST, from: { k: 'zoneGate' }, to: { k: 'tradeExit' } },
    );
    return { legs, destination };
  }

  // Lazily-built road polyline for one leg, cached on the caravan until the
  // area's grid object changes (a Tothal Shift reshaping the zone).
  function legRoute(caravan, legIndex = caravan.legIndex) {
    const leg = caravan.legs[legIndex];
    if (!leg) return null;
    const grid = gridForArea(leg.area);
    if (!grid) return null;
    caravan._routes ||= new Map();
    const cached = caravan._routes.get(legIndex);
    if (cached && cached.grid === grid) return cached;
    const a = resolvePoint(grid, leg.area, leg.from), b = resolvePoint(grid, leg.area, leg.to);
    if (!a || !b) return null;
    const base = cachedRoute(grid, a, b);
    let points = base.points;
    const pauses = [];
    if (leg.camp) {
      const campStop = chooseCampStop(grid, leg.area, base.points, !!leg.campAny);
      if (campStop) {
        const first = cachedRoute(grid, a, campStop), second = cachedRoute(grid, campStop, b);
        const firstLen = withLengths(first.points).length;
        points = [...first.points, ...second.points.slice(1)];
        pauses.push({ at: firstLen, hours: TUNING.CAMP_STOP_HOURS, kind: 'camp' });
      } else if (leg.campAny) {
        pauses.push({ at: 0, hours: TUNING.CAMP_STOP_HOURS, kind: 'rest' }); // No camp in that zone this generation: rest at the gate and turn back.
      }
    }
    const route = { grid, ...withLengths(points), pauses };
    if (leg.stopHours) pauses.push({ at: route.length, hours: leg.stopHours, kind: leg.stopKind || 'stop' });
    caravan._routes.set(legIndex, route);
    if (caravan.legIndex === legIndex && caravan.dist > route.length) caravan.dist = route.length; // A reshaped zone can shorten the road under a caravan mid-leg.
    return route;
  }

  // ── Stock ───────────────────────────────────────────────────────────
  function itemPrice(key, markup = TUNING.PRICE_MARKUP) {
    const def = deps?.ITEM_DEFS?.[key];
    const base = num(deps?.BASE_PRICES?.[key], num(def?.sellPrice, 4));
    return Math.max(5, Math.ceil(Math.max(1, base) * markup));
  }
  function itemEntry(key, qty, price, extra = {}) {
    const def = deps?.ITEM_DEFS?.[key] || {};
    return { id: `item:${key}`, kind: 'item', key, qty, price, icon: def.icon || '📦', label: def.label || key, desc: def.desc || '', ...extra };
  }

  function outOfSeasonFish(season) {
    return (window.FishCatalog?.entries || []).filter(fish => {
      const raw = String(fish?.seasons || 'any');
      if (raw === 'any') return false;
      const seasons = raw.split(',').map(s => FISH_SEASON_NAMES[s.trim()] || s.trim());
      return !seasons.includes(season) && deps?.ITEM_DEFS?.[fish.key];
    });
  }
  function outOfSeasonProduce(season) {
    const wetNow = WET_SEASONS.includes(season);
    const wantedTag = wetNow ? 'Dry Season' : 'Wet Season';
    return Object.entries(deps?.ITEM_DEFS || {})
      .filter(([, def]) => Array.isArray(def?.tags) && def.tags.includes(wantedTag) && num(def.sellPrice, 0) > 0)
      .map(([key]) => key);
  }

  function rollStock(rng, value = townValue()) {
    const stock = [];
    const season = currentSeasonName();
    for (const fish of shuffled(rng, outOfSeasonFish(season)).slice(0, intRoll(rng, 2, 3))) {
      stock.push(itemEntry(fish.key, intRoll(rng, 1, 3), itemPrice(fish.key), { note: 'Out of season here' }));
    }
    for (const key of shuffled(rng, outOfSeasonProduce(season)).slice(0, intRoll(rng, 1, 2))) {
      stock.push(itemEntry(key, intRoll(rng, 2, 4), itemPrice(key), { note: 'Out of season here' }));
    }
    const metals = deps?.VERDIGRIS_METAL_KEYS || [];
    const ceiling = num(window.TownMine?.maximumMetalTierForTownValue?.(value), value + 1);
    if (metals.length && rng() < 0.5) {
      const tier = intRoll(rng, 1, Math.min(ceiling, metals.length));
      const key = deps.metalBarItemKey?.(metals[tier - 1]);
      if (key && deps.ITEM_DEFS?.[key]) stock.push(itemEntry(key, intRoll(rng, 2, 4), itemPrice(key)));
    }
    // Bars above the Town Value metal ceiling: usually none, sometimes one, rarely two.
    const roll = rng();
    const weights = TUNING.HIGH_BAR_COUNT_WEIGHTS;
    const highCount = roll < weights[0] ? 0 : roll < weights[0] + weights[1] ? 1 : 2;
    for (let i = 0; i < highCount; i++) {
      const tier = ceiling + 1 + (rng() < 0.3 ? 1 : 0);
      const metalKey = metals[tier - 1];
      const key = metalKey && deps.metalBarItemKey?.(metalKey);
      if (!key || !deps.ITEM_DEFS?.[key]) continue;
      const existing = stock.find(entry => entry.key === key);
      if (existing) { existing.qty += 1; continue; }
      stock.push(itemEntry(key, 1, TUNING.HIGH_BAR_PRICE_BASE + TUNING.HIGH_BAR_PRICE_PER_TIER * tier, { note: 'Not yet found in the Hollow', rare: true }));
    }
    const trinketChance = Math.min(TUNING.TRINKET_CHANCE_MAX, TUNING.TRINKET_CHANCE + value * TUNING.TRINKET_CHANCE_PER_TOWN_VALUE);
    const trinkets = Object.values(window.TrinketSystem?.DEFINITIONS || {}).filter(def => def.source === 'harlyaoRuin');
    if (trinkets.length && rng() < trinketChance) {
      const def = pick(rng, trinkets);
      stock.push({ id: `trinket:${def.id}`, kind: 'trinket', trinketId: def.id, qty: 1, rare: true,
        price: TUNING.TRINKET_PRICE_BASE + TUNING.TRINKET_PRICE_PER_ATTUNEMENT * num(def.attunementCost, 1),
        icon: def.icon || '📿', label: def.displayName || def.id, desc: def.description || '', note: 'Salvaged from a Harlyao ruin' });
    }
    const relicChance = Math.min(TUNING.RELIC_CHANCE_MAX, TUNING.RELIC_CHANCE + value * TUNING.RELIC_CHANCE_PER_TOWN_VALUE);
    if (window.HarlyaoRelics?.makeRelic && rng() < relicChance) {
      const relic = window.HarlyaoRelics.makeRelic();
      const shape = window.HarlyaoRelics.SHAPES?.[relic.shape] || {};
      const count = (relic.enchantments?.base || []).length + Object.keys(relic.enchantments?.flourishes || {}).length;
      stock.push({ id: `relic:${relic.uid}`, kind: 'relic', relic, qty: 1, rare: true,
        price: TUNING.RELIC_PRICE_BASE + TUNING.RELIC_PRICE_PER_ENCHANTMENT * count,
        icon: shape.icon || '🗡️', label: `Bound ${shape.label || 'Harlyao Relic'}`,
        desc: `An enchanted blade still bound to its dead Harlyao owner (${count} enchantment${count === 1 ? '' : 's'}). Garanki Gabu can unbind it.`,
        note: 'Enchanted' });
    }
    return stock;
  }

  // ── Caravans ────────────────────────────────────────────────────────
  function memberName(seedText, gender) {
    try {
      const name = window.SCRATCHBONES_NAME_GENERATOR?.generateIdentityFromSeed?.(seedText, gender, 'slagothim');
      if (name) return name;
    } catch (_) { /* fall back below */ }
    return FALLBACK_NAMES[hashSeed(seedText) % FALLBACK_NAMES.length];
  }

  function createCaravan(day) {
    const id = `caravan_${day}_${++state.seq}`;
    const rng = seededRng(`${worldSeedLabel()}:${id}`);
    const { legs, destination } = buildItinerary(rng);
    const memberCount = intRoll(rng, TUNING.MEMBERS_MIN, TUNING.MEMBERS_MAX);
    const members = [];
    for (let i = 0; i < memberCount; i++) {
      const gender = rng() < 0.5 ? 'male' : 'female';
      members.push({ index: i, gender, name: memberName(`${worldSeedLabel()}:${id}:${i}`, gender), roster: null });
    }
    return {
      id, day, legs, destination, members,
      legIndex: 0, dist: 0, pauseIdx: 0, pauseLeft: 0,
      stock: rollStock(rng),
      announced: false, done: false,
      passNoticeLeg: -1,
    };
  }

  function activeLeg(caravan) { return caravan.legs[caravan.legIndex] || null; }
  function caravanArea(caravan) { return activeLeg(caravan)?.area || null; }
  function isStopped(caravan, atHours) {
    return caravan.pauseLeft > 0 || !isTravelHour(atHours);
  }

  // Advances one caravan from world time `fromHours` by `hours`. `hooks`
  // receives leg/stop events (omitted for ETA dry-runs).
  function advance(caravan, fromHours, hours, hooks = null) {
    let t = fromHours, left = Math.max(0, hours), guard = 0;
    const speed = tilesPerHour();
    while (left > 1e-7 && !caravan.done && guard++ < 512) {
      const route = legRoute(caravan);
      if (!route) return false; // Area not loaded/generated yet: hold position.
      if (caravan.pauseLeft > 0) {
        const use = Math.min(left, caravan.pauseLeft);
        caravan.pauseLeft -= use; left -= use; t += use;
        if (caravan.pauseLeft <= 1e-7) { caravan.pauseLeft = 0; hooks?.onStopEnd?.(caravan, route.pauses[caravan.pauseIdx - 1]); }
        continue;
      }
      if (!isTravelHour(t)) {
        const use = Math.min(left, hoursUntilTravel(t));
        left -= use; t += use;
        continue;
      }
      const nextPause = route.pauses[caravan.pauseIdx];
      const target = nextPause ? Math.min(nextPause.at, route.length) : route.length;
      const hoursToNight = TUNING.TRAVEL_END_HOUR - hourOfDay(t);
      const travel = Math.max(0, Math.min(left * speed, target - caravan.dist, hoursToNight * speed));
      caravan.dist += travel;
      const used = travel / speed;
      left -= used; t += used;
      if (caravan.dist >= target - 1e-6) {
        caravan.dist = target;
        if (nextPause) {
          caravan.pauseIdx += 1;
          caravan.pauseLeft = nextPause.hours;
          hooks?.onStop?.(caravan, nextPause, t);
        } else {
          const from = caravan.legIndex;
          caravan.legIndex += 1; caravan.dist = 0; caravan.pauseIdx = 0; caravan.pauseLeft = 0;
          if (caravan.legIndex >= caravan.legs.length) { caravan.done = true; hooks?.onDone?.(caravan); }
          else hooks?.onLeg?.(caravan, from, t);
        }
      } else if (travel <= 1e-9 && hoursToNight <= 1e-9) {
        t += 1e-4; // Exactly at TRAVEL_END_HOUR: let the night branch take over.
      }
    }
    return true;
  }

  // Hours until the caravan next reaches a market stop (dry run on a copy).
  function hoursUntilMarket(caravan, nowHours) {
    const copy = { ...caravan, done: false };
    let elapsed = 0;
    let reached = null;
    const hooks = { onStop: (_c, pause, at) => { if (pause.kind === 'market' && reached == null) reached = at; } };
    for (let step = 0; step < 96 && reached == null && !copy.done; step++) {
      if (!advance(copy, nowHours + elapsed, 1, hooks)) return null;
      elapsed += 1;
    }
    return reached == null ? null : reached - nowHours;
  }

  // ── Notifications ───────────────────────────────────────────────────
  function notify(message) {
    state.notices += 1;
    deps?.showToast?.(message, true);
    window.__farmLog?.(`[slagothim] ${message}`, 'info');
  }

  function bearingWord(dx, dz) {
    const words = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];
    const angle = Math.atan2(dz, dx); // +z is south on the map.
    return words[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
  }

  const hooks = {
    onStop(caravan, pause, atHours) {
      if (pause.kind !== 'market') return;
      notify(`⚖ The Slagothim caravan has set up at the town market until about ${formatClock(atHours + pause.hours)}.`);
    },
    onStopEnd(caravan, pause) {
      if (pause?.kind !== 'market') return;
      const next = caravan.legs[caravan.legIndex + 1]; // A market stop sits at the end of its leg; the departure is the next one.
      const where = next?.departing === 'home' || !next?.departing ? 'the southern road home' : `the ${areaLabel(next.departing)}`;
      notify(`⚖ The Slagothim caravan is packing up at the market and heading for ${where}.`);
    },
    onLeg(caravan) {
      const leg = activeLeg(caravan);
      if (leg && leg.area === currentArea() && leg.area !== 'town') notify(`⚖ A Slagothim caravan has come into the ${areaLabel(leg.area)} along the road.`);
    },
    onDone(caravan) {
      window.__farmLog?.(`[slagothim] ${caravan.id} left the region by the southern road.`, 'info');
    },
  };

  function announceArrival(caravan, nowHours) {
    caravan.announced = true;
    const eta = hoursUntilMarket(caravan, nowHours);
    const when = eta == null ? '' : ` They should reach the town market around ${formatClock(nowHours + eta)}${eta > 20 ? ' tomorrow' : ''}.`;
    notify(`⚖ A Slagothim trade caravan has come up the southern road into the ${areaLabel(CLOUD_FOREST)}.${when}`);
  }

  // "It's passing the bit of road closest to you": computed against the
  // player's nearest point on the caravan's current leg, once per leg, only
  // when the player is in the same area but too far for the compass marker.
  function checkClosestPass(caravan, playerTile) {
    const leg = activeLeg(caravan);
    if (!leg || leg.area !== currentArea() || caravan.passNoticeLeg === caravan.legIndex || !playerTile) return;
    const route = legRoute(caravan);
    if (!route || route.length < 1) return;
    let best = Infinity, bestAt = 0;
    for (let d = 0; d <= route.length; d += 2) {
      const p = pointAt(route, d);
      const distance = Math.hypot(p.x - playerTile.col, p.z - playerTile.row);
      if (distance < best) { best = distance; bestAt = d; }
    }
    if (caravan.dist + 0.01 < bestAt) { caravan._passArmedLeg = caravan.legIndex; return; }
    caravan.passNoticeLeg = caravan.legIndex;
    if (caravan._passArmedLeg !== caravan.legIndex) return; // Already past that stretch when the player arrived: nothing to announce.
    const here = pointAt(route, caravan.dist);
    const distance = Math.hypot(here.x - playerTile.col, here.z - playerTile.row);
    if (distance <= TUNING.COMPASS_RADIUS_TILES) return; // Already on the compass.
    notify(`⚖ A Slagothim caravan is passing along the road about ${Math.round(distance)} tiles to the ${bearingWord(here.x - playerTile.col, here.z - playerTile.row)}.`);
  }

  // ── Walkers ─────────────────────────────────────────────────────────
  function memberRecord(caravan, member) {
    const roster = member.roster || { appearance: { speciesId: 'tletingan', gender: member.gender, cosmetics: {} }, equippedCosmetics: [], appliedDyes: {} };
    const greeting = pick(Math.random, [
      'Goods from past the southern road, friend. Have a look.',
      'Hobunji Hollow is growing. Good — growing towns buy.',
      'We go where the roads are kind. Yours are getting kinder.',
      'Fish from other seasons, metal from other hills. Take a look.',
    ]);
    return {
      id: `slagothim_trader:${caravan.id}:${member.index}`,
      name: member.name,
      species: 'Tletingan',
      gender: member.gender,
      relationship: false,
      appearance: roster.appearance,
      equippedCosmetics: roster.equippedCosmetics || [],
      appliedDyes: roster.appliedDyes || {},
      schedule: [], schedules: [], scheduleHooks: {},
      dialogueTrees: [{
        id: 'slagothim_trader_greeting', label: 'Slagothim Trader', trigger: 'interact', priority: 0,
        entryNode: 'slagothim_trader_greeting_1',
        conditions: { weekdays: [], seasons: [], weather: [], timesOfDay: [], encounter: [], maps: [], stations: [], playerSpecies: [], relationship: { min: null, max: null } },
        excludeConditions: { weekdays: [], seasons: [], weather: [], timesOfDay: [], encounter: [], maps: [], stations: [], playerSpecies: [], relationship: { min: null, max: null } },
        nodes: [{ id: 'slagothim_trader_greeting_1', type: 'text', text: greeting, next: null, expression: 'neutral' }],
      }],
      slagothimTrader: true,
    };
  }

  async function rollMemberRoster(member) {
    if (member.roster) return member.roster;
    try {
      const base = await window.BanditCombat?.loadGangConfig?.();
      const roster = base && window.BanditCombat?.rollRoster
        ? await window.BanditCombat.rollRoster({ ...base, speciesWeights: { tletingan: 1 } }, 'grunt', member.name)
        : null;
      if (roster?.appearance) {
        if (roster.appearance.gender && roster.appearance.gender !== member.gender) {
          member.gender = roster.appearance.gender; // Clothing was rolled for this body; keep the name matching it.
          member.name = memberName(`${member.name}:${member.gender}`, member.gender);
        }
        member.roster = { appearance: roster.appearance, equippedCosmetics: roster.equippedCosmetics || [], appliedDyes: roster.appliedDyes || {} };
      }
    } catch (error) {
      window.__farmLog?.(`[slagothim] roster roll failed: ${error.message}`, 'warn');
    }
    return member.roster;
  }

  async function materialize(caravan) {
    if (caravan._walkers || caravan._building) return;
    const area = caravanArea(caravan);
    const route = legRoute(caravan);
    if (!area || !route || !deps?.makeNpcWalker) return;
    caravan._building = true;
    const generation = caravan._generation = (caravan._generation || 0) + 1;
    const walkers = [];
    try {
      for (const member of caravan.members) {
        await rollMemberRoster(member);
        const spot = memberTarget(caravan, member.index, route);
        const walker = await deps.makeNpcWalker(memberRecord(caravan, member), { area, c: Math.floor(spot.x), r: Math.floor(spot.z) });
        if (!walker) continue;
        walker.pause = Infinity; // Steered by this module; never the schedule/wander AI.
        walker._slagothimTrader = true;
        walker._slagothimCaravanId = caravan.id;
        walker.root.position.x = spot.x; walker.root.position.z = spot.z;
        walkers.push(walker);
      }
    } catch (error) {
      window.__farmLog?.(`[slagothim] materialize failed: ${error.message}`, 'warn');
    } finally {
      caravan._building = false;
    }
    const stillWanted = caravan._generation === generation && caravanArea(caravan) === area && state.caravans.includes(caravan) && area === currentArea();
    for (const walker of walkers) deps.npcWalkers?.push(walker);
    if (!stillWanted) { walkers.forEach(walker => deps.despawnNpcWalker?.(walker)); return; }
    caravan._walkers = walkers;
    caravan._walkerArea = area;
  }

  function release(caravan) {
    caravan._generation = (caravan._generation || 0) + 1; // Invalidates an in-flight build.
    for (const walker of (caravan._walkers || [])) {
      if (!deps?.despawnNpcWalker?.(walker)) walker.root?.parent?.remove?.(walker.root);
    }
    caravan._walkers = null;
    caravan._walkerArea = null;
  }

  // Desired tile-space position for one member: single file behind the
  // leader while walking, a loose ring around the leader while stopped.
  function memberTarget(caravan, index, route, nowHours = worldHours()) {
    const lead = pointAt(route, caravan.dist);
    if (isStopped(caravan, nowHours ?? 0)) {
      if (index === 0) return { x: lead.x, z: lead.z, moving: false };
      const angle = (index / Math.max(1, caravan.members.length - 1)) * Math.PI * 2;
      return { x: lead.x + Math.cos(angle) * 1.2, z: lead.z + Math.sin(angle) * 1.2, moving: false };
    }
    const along = pointAt(route, caravan.dist - index * TUNING.MEMBER_SPACING_TILES);
    const side = index === 0 ? 0 : (index % 2 ? 0.35 : -0.35);
    return { x: along.x - along.dz * side, z: along.z + along.dx * side, dx: along.dx, dz: along.dz, moving: true };
  }

  function steerWalkers(caravan, dt, nowHours, playerTile) {
    const route = legRoute(caravan);
    if (!route || !caravan._walkers) return;
    const area = caravanArea(caravan);
    caravan._walkers.forEach((walker, index) => {
      const target = memberTarget(caravan, index, route, nowHours);
      const root = walker.root;
      const dx = target.x - root.position.x, dz = target.z - root.position.z;
      const gap = Math.hypot(dx, dz);
      if (gap > 6) { root.position.x = target.x; root.position.z = target.z; } // Caught up after a big time jump.
      else if (gap > 0.01) {
        const step = Math.min(gap, Math.max(TUNING.WALK_TILES_PER_SECOND * 1.6, gap * 2) * dt);
        root.position.x += dx / gap * step; root.position.z += dz / gap * step;
      }
      root.position.y = num(deps.npcSurfaceY?.(area, Math.floor(root.position.x), Math.floor(root.position.z)), root.position.y);
      let facing = null;
      if (gap > 0.05) facing = -Math.atan2(dz, dx) + Math.PI / 2;
      else if (playerTile && Math.hypot(playerTile.col - root.position.x, playerTile.row - root.position.z) < 4) {
        facing = -Math.atan2(playerTile.row - root.position.z, playerTile.col - root.position.x) + Math.PI / 2;
      }
      if (facing != null) walker.applyFacingDeadzone?.(facing, 0.15);
    });
  }

  function syncPresence(caravan, dt, nowHours, playerTile) {
    const area = caravanArea(caravan);
    const route = area ? legRoute(caravan) : null;
    let wanted = false;
    if (route && area === currentArea() && playerTile) {
      const lead = pointAt(route, caravan.dist);
      const distance = Math.hypot(lead.x - playerTile.col, lead.z - playerTile.row);
      wanted = distance <= (caravan._walkers ? TUNING.RELEASE_RADIUS_TILES : TUNING.MATERIALIZE_RADIUS_TILES);
    }
    if (caravan._walkers && (!wanted || caravan._walkerArea !== area)) release(caravan);
    if (wanted && !caravan._walkers) materialize(caravan);
    if (caravan._walkers) steerWalkers(caravan, dt, nowHours, playerTile);
  }

  // ── Spawning ────────────────────────────────────────────────────────
  function rollHourForDay(day) {
    const rng = seededRng(`${worldSeedLabel()}:slagothim-roll:${day}`);
    return TUNING.ARRIVAL_HOUR_MIN + rng() * (TUNING.ARRIVAL_HOUR_MAX - TUNING.ARRIVAL_HOUR_MIN);
  }

  function maybeRollSpawn(nowHours) {
    const day = Math.floor(nowHours / 24);
    if (state.lastRollDay != null && day <= state.lastRollDay) return null;
    if (hourOfDay(nowHours) < rollHourForDay(day)) return null;
    if (!gridForArea(CLOUD_FOREST)) return null; // Keep today's roll pending until the zone has generated.
    state.lastRollDay = day;
    const value = townValue();
    const rng = seededRng(`${worldSeedLabel()}:slagothim-spawn:${day}`);
    const chance = dailySpawnChance(value);
    const roll = rng();
    if (roll >= chance) { state.lastReason = `day ${day}: no caravan (roll ${roll.toFixed(2)} vs ${chance.toFixed(2)}, TV ${value})`; return null; }
    if (state.caravans.length >= maxActiveCaravans(value)) { state.lastReason = `day ${day}: roads full`; return null; }
    return spawnCaravan(day, nowHours);
  }

  function spawnCaravan(day = Math.floor((worldHours() ?? 24) / 24), nowHours = worldHours()) {
    if (!gridForArea(CLOUD_FOREST)) { state.lastReason = 'cloud forest not generated yet'; return null; }
    const caravan = createCaravan(day);
    state.caravans.push(caravan);
    state.lastReason = `day ${day}: ${caravan.id} spawned (${caravan.destination || 'market only'})`;
    if (nowHours != null) announceArrival(caravan, nowHours);
    deps?.save?.();
    return caravan;
  }

  // ── Frame update ────────────────────────────────────────────────────
  function update(dt) {
    if (!deps) return;
    const nowHours = worldHours();
    if (nowHours == null) return;
    if (lastWorldHours == null || nowHours < lastWorldHours - 1e-6 || nowHours - lastWorldHours > 24 * 30) lastWorldHours = nowHours;
    const elapsed = nowHours - lastWorldHours;
    lastWorldHours = nowHours;
    if (elapsed > 0) {
      for (const caravan of state.caravans) advance(caravan, nowHours - elapsed, elapsed, hooks);
    }
    maybeRollSpawn(nowHours);
    const finished = state.caravans.filter(caravan => caravan.done);
    if (finished.length) {
      finished.forEach(release);
      state.caravans = state.caravans.filter(caravan => !caravan.done);
      deps.save?.();
    }
    const playerTile = deps.getPlayerTile?.() || null;
    checkRegionEdge(playerTile);
    passCheckAccum += Math.max(0, num(dt, 0));
    const checkPass = passCheckAccum >= 0.5;
    if (checkPass) passCheckAccum = 0;
    for (const caravan of state.caravans) {
      syncPresence(caravan, Math.max(0, num(dt, 0)), nowHours, playerTile);
      if (checkPass) checkClosestPass(caravan, playerTile);
    }
  }

  // The southern road runs on past the border escarpment, but the Hollow's
  // playable region ends here; say so once per approach.
  let regionEdgeNoticeShown = false;
  function checkRegionEdge(playerTile) {
    const exit = currentArea() === CLOUD_FOREST ? deps.getZoneLayout?.(CLOUD_FOREST)?.tradeExit : null;
    if (!exit || !playerTile) { regionEdgeNoticeShown = false; return; }
    const distance = Math.hypot(exit.col + 0.5 - playerTile.col, exit.row + 0.5 - playerTile.row);
    if (distance > 14) regionEdgeNoticeShown = false;
    else if (distance < 6 && !regionEdgeNoticeShown) {
      regionEdgeNoticeShown = true;
      deps.showToast?.('The southern road runs on out of the Hollow\'s lands — this is as far as you go. Slagothim caravans come and go this way.', false);
    }
  }

  // ── Compass / interaction ───────────────────────────────────────────
  function compassTargets(areaId) {
    const playerTile = deps?.getPlayerTile?.();
    if (!playerTile) return [];
    const out = [];
    for (const caravan of state.caravans) {
      if (caravanArea(caravan) !== areaId) continue;
      const route = legRoute(caravan);
      if (!route) continue;
      const lead = pointAt(route, caravan.dist);
      if (Math.hypot(lead.x - playerTile.col, lead.z - playerTile.row) > TUNING.COMPASS_RADIUS_TILES) continue;
      out.push({ id: `slagothim:${caravan.id}`, source: 'slagothim-caravan', label: 'Slagothim caravan', col: lead.x, row: lead.z, symbol: '⚖', color: '#e9a64b', priority: 1 });
    }
    return out;
  }

  function caravanForWalker(walker) {
    if (!walker?._slagothimTrader) return null;
    return state.caravans.find(caravan => caravan.id === walker._slagothimCaravanId) || null;
  }
  function isTraderWalker(walker) { return !!walker?._slagothimTrader; }
  function actionButtonFor(walker) {
    const caravan = caravanForWalker(walker);
    if (!caravan) return null;
    return { icon: '⚖', label: 'Trade', action: TRADE_ACTION, style: 'primary', allowed: true, worldInteraction: true };
  }

  // ── Trade panel ─────────────────────────────────────────────────────
  let openCaravanId = null;
  function esc(text) {
    return deps?.esc ? deps.esc(String(text ?? '')) : String(text ?? '').replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
  }
  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.style.cssText = 'position:fixed;inset:0;z-index:18000;background:rgba(8,10,13,.78);display:none;align-items:center;justify-content:center;padding:16px;font:14px system-ui;color:#eee';
    panel.innerHTML = '<section style="width:min(620px,96vw);max-height:88vh;overflow:auto;background:#2a2620;border:2px solid #8a6a3a;border-radius:12px;padding:16px;box-shadow:0 18px 60px #000"><div style="display:flex;align-items:center;gap:12px"><h2 data-title style="margin:0;flex:1;font-size:18px">Slagothim Caravan</h2><button data-close type="button" style="font-size:16px;padding:6px 12px">Close</button></div><p data-summary style="color:#cbb;margin:8px 0 4px"></p><div data-gold style="margin:4px 0 10px;font-weight:600"></div><div data-list class="supply-list"></div></section>';
    panel.querySelector('[data-close]').addEventListener('click', closePanel);
    panel.addEventListener('click', event => { if (event.target === panel) closePanel(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && panel.style.display !== 'none') closePanel(); });
    document.body.appendChild(panel);
    return panel;
  }
  function closePanel() {
    const panel = typeof document !== 'undefined' ? document.getElementById(PANEL_ID) : null;
    if (panel) panel.style.display = 'none';
    openCaravanId = null;
  }
  function openTrade(walker) {
    const caravan = caravanForWalker(walker) || state.caravans.find(c => c.id === openCaravanId);
    if (!caravan) return false;
    openCaravanId = caravan.id;
    try { if (document.pointerLockElement) document.exitPointerLock?.(); } catch (_) { /* ignore */ }
    ensurePanel().style.display = 'flex';
    renderPanel();
    return true;
  }
  function renderPanel() {
    const panel = document.getElementById(PANEL_ID);
    const caravan = state.caravans.find(c => c.id === openCaravanId);
    if (!panel || !caravan) { closePanel(); return; }
    const leader = caravan.members[0]?.name || 'the traders';
    panel.querySelector('[data-title]').textContent = `⚖ ${leader}'s Caravan`;
    panel.querySelector('[data-summary]').textContent = 'Slagothim traders from past the southern road. What they carry is all they have until they come back another day.';
    panel.querySelector('[data-gold]').textContent = `Ganang: ${num(deps?.inventory?.gold, 0)}g`;
    const list = panel.querySelector('[data-list]');
    list.innerHTML = '';
    const available = caravan.stock.filter(entry => entry.qty > 0);
    if (!available.length) {
      list.innerHTML = '<div style="color:#bbb;padding:8px">They have sold everything they brought.</div>';
      return;
    }
    for (const entry of available) {
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">${esc(entry.icon)}</div>
        <div class="sh-info">
          <div class="sh-name">${esc(entry.label)}${entry.rare ? ' <span style="color:#e9a64b">★</span>' : ''}</div>
          <div class="sh-desc">${entry.note ? `${esc(entry.note)}. ` : ''}${esc(entry.desc || '')} In stock: ${entry.qty}</div>
          <div class="sh-price">${entry.price}g</div>
        </div>
        <button class="shop-buy-btn" type="button">Buy</button>`;
      row.querySelector('button').addEventListener('click', () => { buy(caravan.id, entry.id); });
      list.appendChild(row);
    }
  }

  function buy(caravanId, entryId) {
    const caravan = state.caravans.find(c => c.id === caravanId);
    const entry = caravan?.stock.find(e => e.id === entryId);
    if (!caravan || !entry || entry.qty < 1 || !deps?.inventory) return { ok: false, reason: 'unavailable' };
    const gold = num(deps.inventory.gold, 0);
    if (gold < entry.price) { deps.showToast?.('Not enough ganang.', false); return { ok: false, reason: 'gold' }; }
    if (entry.kind === 'item') {
      const owned = num(deps.inventory[entry.key], 0);
      if (owned >= 99) { deps.showToast?.('You cannot carry any more of that.', false); return { ok: false, reason: 'full' }; }
      deps.inventory[entry.key] = owned + 1;
    } else if (entry.kind === 'trinket') {
      if (!window.TrinketSystem?.grant?.(entry.trinketId, 'slagothim')) { deps.showToast?.('That trinket is not available.', false); return { ok: false, reason: 'trinket' }; }
    } else if (entry.kind === 'relic') {
      if (!window.HarlyaoRelics?.grantBoundRelic?.(entry.relic)) { deps.showToast?.('That blade is not available.', false); return { ok: false, reason: 'relic' }; }
    }
    deps.inventory.gold = gold - entry.price;
    entry.qty -= 1;
    deps.showToast?.(`Bought ${entry.label} for ${entry.price}g.`, true);
    deps.buildInventoryGrid?.();
    deps.refreshActionBar?.();
    deps.save?.();
    if (openCaravanId === caravanId) renderPanel();
    return { ok: true };
  }

  // ── Persistence ─────────────────────────────────────────────────────
  function serialize() {
    return {
      version: SAVE_VERSION,
      lastRollDay: state.lastRollDay,
      seq: state.seq,
      caravans: state.caravans.map(caravan => ({
        id: caravan.id, day: caravan.day, legs: caravan.legs, destination: caravan.destination,
        members: caravan.members.map(member => ({ index: member.index, gender: member.gender, name: member.name, roster: member.roster || null })),
        legIndex: caravan.legIndex, dist: caravan.dist, pauseIdx: caravan.pauseIdx, pauseLeft: caravan.pauseLeft,
        stock: caravan.stock, announced: caravan.announced, passNoticeLeg: caravan.passNoticeLeg,
      })),
    };
  }
  function restore(saved) {
    state.caravans.forEach(release);
    state.caravans = [];
    state.lastRollDay = saved?.lastRollDay ?? null;
    state.seq = Math.max(0, Math.floor(num(saved?.seq, 0)));
    for (const raw of (Array.isArray(saved?.caravans) ? saved.caravans : [])) {
      if (!Array.isArray(raw?.legs) || !raw.legs.length || !Array.isArray(raw.members)) continue;
      state.caravans.push({
        id: String(raw.id), day: num(raw.day, 0), legs: raw.legs, destination: raw.destination || null,
        members: raw.members.map((member, index) => ({ index, gender: member.gender === 'female' ? 'female' : 'male', name: String(member.name || FALLBACK_NAMES[index % FALLBACK_NAMES.length]), roster: member.roster || null })),
        legIndex: clamp(Math.floor(num(raw.legIndex, 0)), 0, raw.legs.length - 1),
        dist: Math.max(0, num(raw.dist, 0)), pauseIdx: Math.max(0, Math.floor(num(raw.pauseIdx, 0))), pauseLeft: Math.max(0, num(raw.pauseLeft, 0)),
        stock: Array.isArray(raw.stock) ? raw.stock.filter(entry => entry && entry.id && num(entry.qty, 0) >= 0) : [],
        announced: !!raw.announced, done: false, passNoticeLeg: num(raw.passNoticeLeg, -1),
      });
    }
    lastWorldHours = null;
    closePanel();
  }

  function debugSnapshot() {
    const nowHours = worldHours();
    return {
      townValue: townValue(),
      dailyChance: dailySpawnChance(),
      maxActive: maxActiveCaravans(),
      lastRollDay: state.lastRollDay,
      nextRollHour: nowHours == null ? null : Number(rollHourForDay(Math.floor(nowHours / 24)).toFixed(2)),
      notices: state.notices,
      lastReason: state.lastReason,
      cloudForestLayout: (() => {
        const layout = deps?.getZoneLayout?.(CLOUD_FOREST);
        return layout ? { cols: layout.cols, rows: layout.rows, tiles: layout.tiles?.length || 0, tradeExit: layout.tradeExit || null, toTownExit: layout.toTownExit || null } : null;
      })(),
      caravans: state.caravans.map(caravan => {
        const route = caravan._routes?.get(caravan.legIndex) || null;
        const lead = route ? pointAt(route, caravan.dist) : null;
        return {
          id: caravan.id, destination: caravan.destination, area: caravanArea(caravan),
          leg: `${caravan.legIndex + 1}/${caravan.legs.length}`, dist: Number(caravan.dist.toFixed(1)),
          routeLength: route ? Number(route.length.toFixed(1)) : null, pauses: route?.pauses?.map(p => `${p.kind}@${p.at.toFixed(0)}`) || [],
          pauseLeft: Number(caravan.pauseLeft.toFixed(2)), stopped: nowHours != null ? isStopped(caravan, nowHours) : null,
          tile: lead ? { col: Number(lead.x.toFixed(1)), row: Number(lead.z.toFixed(1)) } : null,
          walkers: caravan._walkers?.length || 0,
          stock: caravan.stock.map(entry => `${entry.label}×${entry.qty}@${entry.price}g`),
        };
      }),
    };
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    gridCache.clear();
    if (!schedulerRegistered && window.RuntimeFrameScheduler?.register) {
      window.RuntimeFrameScheduler.register(SCHEDULER_ID, frame => update(Math.max(0, num(frame?.deltaMs, 0)) / 1000), {
        phase: 'pre-game',
        owner: 'SlagothimTraders',
        description: 'Advances Slagothim trade caravans along the roads and steers their materialized walkers.',
      });
      schedulerRegistered = true;
    }
  }

  window.SlagothimTraders = Object.freeze({
    TUNING,
    TRADE_ACTION,
    init,
    update,
    serialize,
    restore,
    compassTargets,
    actionButtonFor,
    isTraderWalker,
    openTrade,
    closePanel,
    buy,
    spawnCaravan, // Dev/testing: force a caravan in at the southern road now.
    debugSnapshot,
    __test: Object.freeze({ dailySpawnChance, maxActiveCaravans, findRoute, buildZoneGrid, gridForArea, legRoute, advance, pointAt, rollStock, buildItinerary, createCaravan, hoursUntilMarket, isTravelHour, hoursUntilTravel, tilesPerHour, maybeRollSpawn, state, gridCache, outOfSeasonFish, outOfSeasonProduce, checkClosestPass, memberTarget }),
  });
})();
