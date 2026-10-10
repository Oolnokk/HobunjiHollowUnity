// Procedural cave-site layer promoted from the older one-den-per-cavern model.
//
// Existing wilderness "dens" remain the compatibility anchor that owns a cave
// mouth, transition, map id, collision footprint, and Den-Mother ecology. This
// module assigns each anchor a deterministic cave history/occupancy profile and
// decorates CavernGenerator's existing shell instead of inventing a second
// interior/dungeon pipeline. Only cave profiles containing animal_den are
// exposed to WildlifeSpawn's den lifecycle.
(() => {
  'use strict';

  if (window.CaveSiteSystem) return;

  const TYPES = Object.freeze({
    EMPTY: 'empty',
    ANIMAL_DEN: 'animal_den',
    BANDIT_HIDEOUT: 'bandit_hideout',
    TRAPPED_CACHE: 'trapped_cache',
    CATACOMB: 'catacomb',
    ORE_MINE: 'ore_mine',
    RUIN_ENTRANCE: 'ruin_entrance',
  });

  const TYPE_LABELS = Object.freeze({
    [TYPES.EMPTY]: 'Natural Cave',
    [TYPES.ANIMAL_DEN]: 'Animal Den',
    [TYPES.BANDIT_HIDEOUT]: 'Bandit Hideout',
    [TYPES.TRAPPED_CACHE]: 'Hidden Cache',
    [TYPES.CATACOMB]: 'Ancient Catacomb',
    [TYPES.ORE_MINE]: 'Ore-rich Cave',
    [TYPES.RUIN_ENTRANCE]: 'Ancient Ruin Entrance',
  });

  const PRIMARY_WEIGHTS = Object.freeze([
    [TYPES.ANIMAL_DEN, 35],
    [TYPES.ORE_MINE, 15],
    [TYPES.BANDIT_HIDEOUT, 13],
    [TYPES.TRAPPED_CACHE, 10],
    [TYPES.CATACOMB, 10],
    [TYPES.RUIN_ENTRANCE, 9],
    [TYPES.EMPTY, 8],
  ]);

  const COMPATIBLE_SECONDARIES = Object.freeze({
    [TYPES.ANIMAL_DEN]: [], // Legacy Den-Mother collapse/relocation stays isolated so clearing wildlife can never erase an unrelated secondary history.
    [TYPES.BANDIT_HIDEOUT]: [TYPES.TRAPPED_CACHE, TYPES.ORE_MINE, TYPES.CATACOMB, TYPES.RUIN_ENTRANCE],
    [TYPES.TRAPPED_CACHE]: [TYPES.CATACOMB, TYPES.ORE_MINE, TYPES.RUIN_ENTRANCE, TYPES.BANDIT_HIDEOUT],
    [TYPES.CATACOMB]: [TYPES.ORE_MINE, TYPES.RUIN_ENTRANCE, TYPES.BANDIT_HIDEOUT],
    [TYPES.ORE_MINE]: [TYPES.CATACOMB, TYPES.RUIN_ENTRANCE, TYPES.TRAPPED_CACHE, TYPES.BANDIT_HIDEOUT],
    [TYPES.RUIN_ENTRANCE]: [TYPES.ORE_MINE, TYPES.CATACOMB, TYPES.BANDIT_HIDEOUT],
    [TYPES.EMPTY]: [],
  });

  const SECONDARY_CHANCE = 0.28; // Used by profile rolls; mixed histories should be notable rather than the majority of caves.
  const CACHE_OPEN_RADIUS_TILES = 1.05; // Used by runtime proximity interaction for hidden caches without adding another central getWorldObjectAt branch.
  const TRAP_TRIGGER_RADIUS_TILES = 0.48; // Used by one-shot pressure/trip hazards around cache approaches.
  const RUIN_TRIGGER_RADIUS_TILES = 0.90; // Used by the deep ruin threshold; entering is deliberately close-range.
  const CAVE_RUNTIME_INTERVAL_S = 0.12; // Used to keep cave proximity checks cheap on mobile while still feeling immediate.
  const CACHE_RELIC_CHANCE = 0.28; // Used by cache loot; Harlyao relic logic already owns enchanted-weapon construction/persistence.
  const CACHE_NARCOTIC_CHANCE = 0.35; // Used by cache loot; AlchemySystem authors the actual narcotic recipe item.

  const sitesByZone = new Map(); // zoneId -> cave profiles used by ecology filtering, map labels, and diagnostics.
  const sitesByMapId = new Map(); // cavern map id -> cave profile used while decorating/loading interiors.
  const plansByMapId = new Map(); // cavern map id -> generated feature positions used by runtime traps/cache/bandits/ruin thresholds.
  const runtimeStateBySignature = new Map(); // site signature -> current-world persistent-ish discovery/interaction state.
  const banditSpawnPromises = new Map(); // map id -> in-flight BanditCombat creation promise, preventing duplicate async spawns.
  const banditPopulatedMaps = new Set(); // Session-only map ids that actually spawned a hideout; used to distinguish kills from a fresh page reload.
  const ruinTransitionMaps = new Set(); // Map ids currently transitioning into a ruin; prevents repeated proximity triggers during the fade/generation handoff.
  let wildlifeDeps = null; // Captured from WildlifeSpawn.init; used for current area/player/hostile collection and damage helpers.
  let devSpawnerDeps = null; // Captured from DevSpawner.init; used for the existing generalized loot grant helper.
  let caveRuntimeTimer = 0; // Throttles interior proximity/runtime work to CAVE_RUNTIME_INTERVAL_S.
  let stateIdentity = null; // World|Tothal-cycle key used to reload the correct cave discovery/loot state.
  let integrationsInstalled = false; // Prevents double-wrapping subsystem APIs across hot reloads/tests.
  let filteringDens = false; // True while withAnimalOnlyDens has swapped layout.dens for its filtered view; sitesForZone must not re-sync from that view.

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const tileKey = (col, row) => `${Number(col)},${Number(row)}`;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function hashSeed(text) {
    let h = 2166136261 >>> 0; // FNV-like seed used only when WildernessMapGenerator.makeRng is unavailable in isolated tools/tests.
    for (const ch of String(text || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h || 1;
  }

  function fallbackRng(seedText) {
    let a = hashSeed(seedText); // Stateful fallback stream used by deterministic generation helpers outside full game boot.
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seedText) {
    return window.WildernessMapGenerator?.makeRng?.(String(seedText)) || fallbackRng(seedText);
  }

  function weightedPick(rng, entries) {
    const total = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry[1]) || 0), 0); // Total positive weight used to normalize this choice.
    if (!(total > 0)) return entries[0]?.[0] ?? null;
    let roll = rng() * total; // Remaining weighted interval used while walking candidate entries.
    for (const [value, weightRaw] of entries) {
      const weight = Math.max(0, Number(weightRaw) || 0); // Sanitized candidate weight used to decrement the roll.
      if (roll < weight) return value;
      roll -= weight;
    }
    return entries[entries.length - 1]?.[0] ?? null;
  }

  function caveMapId(zoneId, denId) {
    return window.WildlifeSpawn?.denCavernMapId?.(zoneId, denId) || `map_i_den_${zoneId}_${denId}`;
  }

  function caveSignature(zoneId, den) {
    return `${zoneId}:${String(den?.id || 'cave')}:${Number(den?.x) || 0},${Number(den?.y) || 0}`;
  }

  function caveTitle(layers) {
    const meaningful = (layers || []).filter(type => type !== TYPES.EMPTY); // Occupancy/history layers used to build the post-discovery label.
    if (!meaningful.length) return TYPE_LABELS[TYPES.EMPTY];
    if (meaningful.length === 1) return TYPE_LABELS[meaningful[0]] || 'Cave';
    return `Cave — ${meaningful.map(type => TYPE_LABELS[type] || type).join(' / ')}`;
  }

  function rollProfile(zoneId, den) {
    const signature = caveSignature(zoneId, den); // Stable site identity used by deterministic profile generation and persistence.
    const rng = makeRng(`${signature}:profile`); // Dedicated profile stream so later feature rolls cannot reshuffle cave types.
    const primary = weightedPick(rng, PRIMARY_WEIGHTS);
    const secondaryPool = COMPATIBLE_SECONDARIES[primary] || []; // Allowed second histories that can coexist with the primary cave use.
    const secondary = secondaryPool.length && rng() < SECONDARY_CHANCE
      ? secondaryPool[Math.floor(rng() * secondaryPool.length)]
      : null;
    const layers = [...new Set([primary, secondary].filter(Boolean))];
    return {
      id: `cave_${String(den?.id || 'site')}`,
      zoneId: String(zoneId || ''),
      denId: String(den?.id || ''),
      mapId: caveMapId(zoneId, den?.id),
      signature,
      primary,
      secondary,
      layers,
      exteriorLabel: 'Cave',
      discoveredLabel: caveTitle(layers),
      mineableSeparator: !!secondary,
      mouthAnchor: den?.mouthAnchor ? clone(den.mouthAnchor) : null,
      source: 'promoted_den_anchor',
    };
  }

  function forceAnimalProfile(profile) {
    profile.primary = TYPES.ANIMAL_DEN;
    profile.secondary = null;
    profile.layers = [TYPES.ANIMAL_DEN];
    profile.mineableSeparator = false;
    profile.discoveredLabel = caveTitle(profile.layers);
    return profile;
  }

  // One assignment path for both freshly generated workspaces and cached
  // Tothal layouts (which skip the generator capture), so a zone's caves get
  // the same profiles either way. Dens already tagged keep their profile.
  function assignZoneProfiles(zoneId, dens) {
    const key = String(zoneId || '');
    const profiles = dens.map(den => den?.caveSite?.mapId ? clone(den.caveSite) : rollProfile(key, den)); // One cave profile per existing den anchor, preserving all old geometry/map ids.
    if (profiles.length && !profiles.some(profile => profile.layers.includes(TYPES.ANIMAL_DEN))) {
      const rng = makeRng(`${key}:animal-den-preservation`); // Stable slot selection guarantees legacy animal ecology survives the promotion to generic caves.
      forceAnimalProfile(profiles[Math.floor(rng() * profiles.length)]);
    }
    for (let index = 0; index < dens.length; index++) {
      const den = dens[index]; // Existing compatibility record consumed by terrain/collision/turnover systems.
      const profile = profiles[index]; // Cave semantic metadata attached without changing den ids or coordinates.
      den.caveSite = clone(profile);
      den.isAnimalDen = profile.layers.includes(TYPES.ANIMAL_DEN);
      sitesByMapId.set(profile.mapId, profile);
    }
    sitesByZone.set(key, profiles);
    return profiles;
  }

  function applyWorkspaceProfiles(zoneId, workspace) {
    const dens = Array.isArray(workspace?.animalDens)
      ? workspace.animalDens
      : Array.isArray(workspace?.dens) ? workspace.dens : [];
    const profiles = assignZoneProfiles(zoneId, dens);
    if (workspace) workspace.caveSites = profiles.map(profile => clone(profile)); // Explicit semantic list for future systems/editor migration; `animalDens` remains compatibility data.
    if (profiles.length) window.__farmLog?.(`[cave-sites] ${zoneId}: ${profiles.length} cave(s) — ${profiles.map(profile => profile.layers.join('+')).join(', ')}`, 'world');
    return clone(profiles);
  }

  function zoneLayout(zoneId) {
    return wildlifeDeps?.zoneLayouts?.get?.(String(zoneId || '')) || null;
  }

  // Live (uncloned) profile list for internal per-frame callers.
  function zoneSites(zoneId) {
    const key = String(zoneId || '');
    const dens = Array.isArray(zoneLayout(key)?.dens) ? zoneLayout(key).dens : null; // Current runtime layout used to repair cached workspaces lacking caveSite tags.
    // A zone regenerated (Tothal Shift) or a den relocated by turnover since
    // the last assignment leaves untagged/changed anchors — re-sync from the
    // live layout so labels/filters never act on a stale list.
    if (dens && !filteringDens && (!sitesByZone.has(key) || sitesByZone.get(key).length !== dens.length || dens.some(den => !den?.caveSite?.mapId))) {
      return assignZoneProfiles(key, dens);
    }
    return sitesByZone.get(key) || [];
  }

  function sitesForZone(zoneId) {
    return clone(zoneSites(zoneId));
  }

  function profileForMapId(mapId) {
    const id = String(mapId || '');
    if (sitesByMapId.has(id)) return clone(sitesByMapId.get(id));
    if (!id.startsWith('map_i_den_')) return null; // Only den caverns can be cave sites; skip the layout scan for every other area (called each runtime tick).
    wildlifeDeps?.zoneLayouts?.forEach?.((layout, zoneId) => {
      if (!sitesByMapId.has(id) && layout?.dens?.length) zoneSites(zoneId);
    });
    return clone(sitesByMapId.get(id) || null);
  }

  function isAnimalDenSite(profileOrDen) {
    const layers = profileOrDen?.layers || profileOrDen?.caveSite?.layers || [];
    return Array.isArray(layers) && layers.includes(TYPES.ANIMAL_DEN);
  }

  function floorTiles(mapData) {
    return (mapData?.floor || []).map(tile => Array.isArray(tile)
      ? { col: Number(tile[0]), row: Number(tile[1]) }
      : { col: Number(tile?.col ?? tile?.c), row: Number(tile?.row ?? tile?.r) })
      .filter(tile => Number.isFinite(tile.col) && Number.isFinite(tile.row));
  }

  function neighborsOf(key, floorSet) {
    const [col, row] = key.split(',').map(Number); // Candidate tile coordinate used for four-way cave-floor connectivity.
    return [[1,0],[-1,0],[0,1],[0,-1]]
      .map(([dc, dr]) => tileKey(col + dc, row + dr))
      .filter(next => floorSet.has(next));
  }

  function nearestFloorKey(tiles, col, row) {
    let best = null; // Closest logical floor tile to a map marker/entrance that may itself sit just outside carved floor.
    let bestDist = Infinity; // Squared grid distance used to avoid unnecessary sqrt calls.
    for (const tile of tiles) {
      const dist = (tile.col - col) ** 2 + (tile.row - row) ** 2;
      if (dist < bestDist) { bestDist = dist; best = tileKey(tile.col, tile.row); }
    }
    return best;
  }

  function bfsKeys(startKey, floorSet, blocked = null) {
    if (!startKey || !floorSet.has(startKey) || blocked?.has(startKey)) return new Set();
    const seen = new Set([startKey]); // Reachable logical cave-floor cells from this start with the mined-wall candidate cells removed.
    const queue = [startKey]; // FIFO work list used for four-way connectivity.
    for (let index = 0; index < queue.length; index++) {
      const key = queue[index]; // Current floor cell whose neighbors will be explored.
      for (const next of neighborsOf(key, floorSet)) {
        if (blocked?.has(next) || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  }

  const MAX_SEPARATOR_WIDTH = 6; // Widest opening a mineable wall may span. Mining any one rock opens it, so width costs the player nothing; generated cavern chambers join through 3-6 tile openings.
  const MIN_HIDDEN_TILES = 12; // Smallest chamber worth walling off.
  const MIN_HIDDEN_RATIO = 0.05; // ...as a share of the cave floor; real caverns are mostly one big chamber with side pockets.
  const MAX_HIDDEN_RATIO = 0.58; // Never wall off most of the cave.

  // Straight wall-to-wall cuts across a corridor: a run of 1..MAX floor cells
  // along a row or column whose two ends both touch non-floor. Filling such a
  // run with ore rocks seals whatever lies beyond it.
  function corridorCuts(floorSet) {
    const cuts = new Map(); // Sorted cell-key list -> cut, deduplicating runs found from every cell they contain.
    for (const key of floorSet) {
      const [col, row] = key.split(',').map(Number);
      for (const [dc, dr] of [[1, 0], [0, 1]]) {
        if (floorSet.has(tileKey(col - dc, row - dr))) continue; // Only start runs at the wall on the low side.
        const cells = [];
        let c = col, r = row;
        while (floorSet.has(tileKey(c, r)) && cells.length <= MAX_SEPARATOR_WIDTH) { cells.push({ col: c, row: r }); c += dc; r += dr; }
        if (!cells.length || cells.length > MAX_SEPARATOR_WIDTH) continue; // Too wide to be a corridor wall.
        const keys = cells.map(cell => tileKey(cell.col, cell.row));
        cuts.set(keys.join('|'), { cells, keys });
      }
    }
    return [...cuts.values()];
  }

  function findMineableSeparator(mapData) {
    const tiles = floorTiles(mapData);
    const floorSet = new Set(tiles.map(tile => tileKey(tile.col, tile.row))); // Full connected cave footprint used by cut testing.
    const exitCol = Number(mapData?.exitCol) || 0, exitRow = Number(mapData?.exitRow) || 0;
    const entranceKey = nearestFloorKey(tiles, exitCol, exitRow); // Entrance-side seed used to classify the near chamber.
    if (!entranceKey || floorSet.size < 22) return null;
    const reachable = bfsKeys(entranceKey, floorSet).size; // Baseline connectivity; parts already sealed from the entrance never count as "behind" a cut.
    const candidates = []; // Corridor cuts that split off a meaningful secondary chamber.
    for (const cut of corridorCuts(floorSet)) {
      if (cut.keys.includes(entranceKey)) continue;
      if (cut.cells.some(cell => Math.hypot(cell.col - exitCol, cell.row - exitRow) < 5)) continue;
      const blocked = new Set(cut.keys);
      const near = bfsKeys(entranceKey, floorSet, blocked); // Entrance-side component once the cut becomes mineable rock.
      const usable = reachable - cut.keys.length;
      if (near.size >= usable) continue;
      const far = new Set([...floorSet].filter(candidate => !blocked.has(candidate) && !near.has(candidate))); // Sealed component revealed after mining through.
      const farRatio = far.size / Math.max(1, usable); // Portion behind the wall; rejects trivial closets and most-of-map lockouts.
      if (far.size < MIN_HIDDEN_TILES || farRatio < MIN_HIDDEN_RATIO || farRatio > MAX_HIDDEN_RATIO) continue;
      const mid = cut.cells[Math.floor(cut.cells.length / 2)];
      candidates.push({
        col: mid.col, row: mid.row, key: cut.keys.join('|'), cells: cut.cells,
        nearKeys: [...near], farKeys: [...far],
        // Prefer a big hidden chamber behind a narrow wall far from the entrance.
        score: far.size - (cut.cells.length - 1) * 3 + Math.hypot(mid.col - exitCol, mid.row - exitRow) * 0.35,
      });
    }
    candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    return candidates[0] || null;
  }

  function sortTilesByDistance(tiles, col, row, descending = true) {
    return [...tiles].sort((a, b) => {
      const da = (a.col - col) ** 2 + (a.row - row) ** 2;
      const db = (b.col - col) ** 2 + (b.row - row) ** 2;
      return descending ? db - da : da - db;
    });
  }

  function tilePoolFromKeys(allTiles, keys) {
    if (!keys?.length) return allTiles;
    const allowed = new Set(keys); // Region key set used to place a history layer on one side of a mineable partition.
    const filtered = allTiles.filter(tile => allowed.has(tileKey(tile.col, tile.row)));
    return filtered.length ? filtered : allTiles;
  }

  function pickSpacedTiles(rng, candidates, count, blockedKeys = new Set(), minDistance = 2) {
    const pool = [...candidates]; // Mutable candidate pool used to choose deterministic spaced feature positions.
    const chosen = []; // Final feature tiles used by coffins, bandits, ore, traps, etc.
    while (pool.length && chosen.length < count) {
      const index = Math.floor(rng() * pool.length); // Deterministic candidate index for this feature roll.
      const tile = pool.splice(index, 1)[0];
      const key = tileKey(tile.col, tile.row);
      if (blockedKeys.has(key)) continue;
      if (chosen.some(other => Math.hypot(other.col - tile.col, other.row - tile.row) < minDistance)) continue;
      chosen.push(tile);
      blockedKeys.add(key);
    }
    return chosen;
  }

  function mineOreKind(rng) {
    return weightedPick(rng, [['stone', 32], ['copper', 24], ['tin', 18], ['iron', 15], ['silver', 8], ['gold', 3]]); // Existing ore-rock kinds reused for richer cave mines.
  }

  function layerRegions(profile, mapData, separator, allTiles) {
    if (!separator || profile.layers.length < 2) return new Map(profile.layers.map(type => [type, allTiles]));
    const nearTiles = tilePoolFromKeys(allTiles, separator.nearKeys); // Entrance-side chamber used by the primary history unless animal-den placement dictates otherwise.
    const farTiles = tilePoolFromKeys(allTiles, separator.farKeys); // Mined-through chamber used by the secondary history.
    const regions = new Map();
    const animalType = profile.layers.includes(TYPES.ANIMAL_DEN) ? TYPES.ANIMAL_DEN : null; // Animal layer whose existing nest location must stay on the side where CavernGenerator put it.
    if (animalType && Number.isFinite(Number(mapData.nestCol)) && Number.isFinite(Number(mapData.nestRow))) {
      const nestKey = tileKey(mapData.nestCol, mapData.nestRow); // Existing safe 2x2 Den-Mother/nest location used to choose the animal's partition.
      const animalFar = new Set(separator.farKeys).has(nestKey);
      regions.set(animalType, animalFar ? farTiles : nearTiles);
      for (const type of profile.layers) if (type !== animalType) regions.set(type, animalFar ? nearTiles : farTiles);
      return regions;
    }
    regions.set(profile.layers[0], nearTiles);
    if (profile.layers[1]) regions.set(profile.layers[1], farTiles);
    return regions;
  }

  function addMineLayer(mapData, rng, candidates, blockedKeys, plan) {
    const target = clamp(Math.round(candidates.length * 0.16), 7, 15); // Ore-rich layer density while preserving walkable floor and mobile object budgets.
    const existing = new Set((mapData.oreRocks || []).map(rock => tileKey(rock.col, rock.row))); // Existing natural ore tiles that must not be duplicated.
    const localBlocked = new Set([...blockedKeys, ...existing]);
    const extra = pickSpacedTiles(rng, candidates, Math.max(0, target - existing.size), localBlocked, 1.45);
    mapData.oreRocks = [...(mapData.oreRocks || []), ...extra.map(tile => ({ col: tile.col, row: tile.row, oreKind: mineOreKind(rng) }))];
    plan.mineRocks = mapData.oreRocks.map(rock => ({ col: rock.col, row: rock.row, oreKind: rock.oreKind }));
    for (const rock of mapData.oreRocks) blockedKeys.add(tileKey(rock.col, rock.row));
  }

  function addBanditLayer(mapData, rng, candidates, blockedKeys, plan) {
    const count = clamp(2 + Math.floor(rng() * 3), 2, 4); // Small hideout population reused by BanditCombat at runtime.
    const picks = pickSpacedTiles(rng, sortTilesByDistance(candidates, mapData.exitCol, mapData.exitRow, true).slice(0, Math.max(8, Math.floor(candidates.length * 0.7))), count, blockedKeys, 2.2);
    plan.banditSpawns = picks.map((tile, index) => ({ col: tile.col, row: tile.row, rank: index === picks.length - 1 && picks.length >= 3 ? 'lieutenant' : 'grunt', tier: 1 + (rng() < 0.25 ? 1 : 0) }));
    mapData.caveBanditSpawns = clone(plan.banditSpawns);
  }

  function addCacheLayer(mapData, rng, candidates, blockedKeys, plan) {
    const distant = sortTilesByDistance(candidates, mapData.exitCol, mapData.exitRow, true); // Deepest chamber candidates make the cache feel intentionally hidden.
    const cacheTile = distant.find(tile => !blockedKeys.has(tileKey(tile.col, tile.row)));
    if (!cacheTile) return;
    blockedKeys.add(tileKey(cacheTile.col, cacheTile.row));
    plan.cache = { id: `cave_cache_${mapData.id}`, col: cacheTile.col, row: cacheTile.row, tier: 2 };
    mapData.caveCache = clone(plan.cache);
    addProp(mapData, { id: plan.cache.id, key: 'ruinDungeonChestT2', col: cacheTile.col, row: cacheTile.row, rotY: Math.floor(rng() * 4) * 90 });

    const trapCandidates = candidates.filter(tile => {
      const d = Math.hypot(tile.col - cacheTile.col, tile.row - cacheTile.row);
      return d >= 1.1 && d <= 4.5 && !blockedKeys.has(tileKey(tile.col, tile.row));
    }); // Nearby approach tiles used for actual one-shot cave hazards.
    const trapCount = trapCandidates.length ? 1 + (rng() < 0.45 ? 1 : 0) : 0;
    plan.traps = pickSpacedTiles(rng, trapCandidates, trapCount, blockedKeys, 2).map((tile, index) => ({ id: `${plan.cache.id}_trap_${index + 1}`, col: tile.col, row: tile.row, damage: 9 + Math.floor(rng() * 7), tag: rng() < 0.5 ? 'sharp' : 'blunt' }));
    mapData.caveTraps = clone(plan.traps);
  }

  function addCatacombLayer(mapData, rng, candidates, blockedKeys, plan) {
    const count = clamp(Math.round(candidates.length / 11), 3, 7); // Coffin density scaled to chamber size but bounded for mobile scene cost.
    const coffins = pickSpacedTiles(rng, candidates, count, blockedKeys, 2.15);
    plan.coffins = coffins.map((tile, index) => ({ id: `cave_coffin_${index + 1}`, col: tile.col, row: tile.row, rotY: Math.floor(rng() * 4) * 90 }));
    for (const coffin of plan.coffins) addProp(mapData, { id: coffin.id, key: 'ruinSanctumCoffin', col: coffin.col, row: coffin.row, rotY: coffin.rotY });

    if (!plan.profile.layers.includes(TYPES.ANIMAL_DEN)) {
      const ghoulCandidates = candidates.filter(tile => !blockedKeys.has(tileKey(tile.col, tile.row)));
      const ghouls = pickSpacedTiles(rng, ghoulCandidates, Math.min(3, Math.max(1, Math.floor(coffins.length / 2))), blockedKeys, 2.5);
      // Ghouls are a humanoid species, not a CREATURE_DB creature — they spawn
      // at runtime through BanditCombat exactly like Town Mine floor ghouls.
      plan.ghoulSpawns = ghouls.map((tile, index) => ({ col: tile.col, row: tile.row, rank: 'grunt', tier: 1, ghoul: true, gender: index % 2 ? 'female' : 'male' }));
      mapData.caveGhoulSpawns = clone(plan.ghoulSpawns);
    }
  }

  function addRuinLayer(mapData, rng, candidates, blockedKeys, plan) {
    const distant = sortTilesByDistance(candidates, mapData.exitCol, mapData.exitRow, true); // Deep chamber used as the threshold into the existing random-ruin generator.
    const tile = distant.find(candidate => !blockedKeys.has(tileKey(candidate.col, candidate.row)));
    if (!tile) return;
    blockedKeys.add(tileKey(tile.col, tile.row));
    // DevRandomRuin.generate coerces its seed with Number(seed)>>>0, so the
    // descriptive cave identity is hashed to a stable uint32 here.
    plan.ruinEntrance = { id: `cave_ruin_${mapData.id}`, col: tile.col, row: tile.row, seed: hashSeed(`${plan.profile.signature}:ruin`) };
    mapData.caveRuinEntrance = clone(plan.ruinEntrance);
    addProp(mapData, { id: plan.ruinEntrance.id, key: 'ruinEntranceDoor', col: tile.col, row: tile.row, rotY: Math.floor(rng() * 4) * 90 });
  }

  function addProp(mapData, prop) {
    mapData.caveProps = Array.isArray(mapData.caveProps) ? mapData.caveProps : [];
    mapData.caveProps.push(prop);
  }

  // Called by game.js's loadBuildingScene cavern branch once the interior
  // scene exists. The cave's props are authored furniture JSON (the same
  // pieces DevRandomRuin/RuinSites build), loaded on demand and placed on
  // their tile centres.
  function buildInteriorProps(mapId, mapData, scene) {
    const A = window.AuthoredFurniture;
    if (!A?.load || !A?.buildGroup || !scene || !mapData?.caveProps?.length) return Promise.resolve(0);
    return Promise.all(mapData.caveProps.map(prop => Promise.resolve(A.load(prop.key)).then(data => {
      if (!data) { window.__farmLog?.(`[cave-sites] prop ${prop.key} has no authored data.`, 'warn'); return 0; }
      const group = A.buildGroup(data);
      group.position.set(prop.col + 0.5, 0, prop.row + 0.5);
      group.rotation.y = (Number(prop.rotY) || 0) * Math.PI / 180;
      group.userData.caveSiteProp = { mapId, id: prop.id, key: prop.key };
      scene.add(group);
      return 1;
    }))).then(built => built.reduce((sum, n) => sum + n, 0));
  }

  function decorateCavernMapData(mapId, mapData) {
    const profile = profileForMapId(mapId);
    if (!profile || !mapData) return mapData;
    const rng = makeRng(`${profile.signature}:interior`); // Feature stream isolated from profile selection, stable across reloads.
    const allTiles = floorTiles(mapData);
    const blockedKeys = new Set(); // Reserved logical tiles preventing generated layers from stacking physical features.
    for (const rock of mapData.oreRocks || []) blockedKeys.add(tileKey(rock.col, rock.row));
    for (const exit of mapData.exits || []) for (const tile of exit.tiles || []) blockedKeys.add(tileKey(tile[0], tile[1]));
    if (Number.isFinite(Number(mapData.nestCol)) && Number.isFinite(Number(mapData.nestRow))) blockedKeys.add(tileKey(mapData.nestCol, mapData.nestRow));

    if (!profile.layers.includes(TYPES.ANIMAL_DEN)) {
      mapData.nestCol = null;
      mapData.nestRow = null;
      mapData.denMotherKind = null;
      mapData.creatureSpawns = [];
    }

    let separator = profile.mineableSeparator ? findMineableSeparator(mapData) : null; // Existing ore-rock mechanic becomes the optional mine-through wall between histories.
    if (separator) {
      const separatorKind = mineOreKind(rng); // Ordinary ore kind means all existing mining/tool/loot/regrowth interaction code remains authoritative.
      const existing = new Set((mapData.oreRocks || []).map(rock => tileKey(rock.col, rock.row)));
      const wall = separator.cells.filter(cell => !existing.has(tileKey(cell.col, cell.row))).map(cell => ({ col: cell.col, row: cell.row, oreKind: separatorKind, caveSeparator: true }));
      mapData.oreRocks = [...(mapData.oreRocks || []), ...wall];
      for (const cell of separator.cells) blockedKeys.add(tileKey(cell.col, cell.row));
      separator = { ...separator, oreKind: separatorKind };
    }

    const plan = {
      profile: clone(profile),
      separator: separator ? { col: separator.col, row: separator.row, cells: separator.cells, oreKind: separator.oreKind, nearKeys: separator.nearKeys, farKeys: separator.farKeys } : null,
      banditSpawns: [], ghoulSpawns: [], traps: [], coffins: [], mineRocks: [], cache: null, ruinEntrance: null,
    }; // Runtime-only plan mirrors map decorations and drives mechanics that cannot live in static building map data.
    const regions = layerRegions(profile, mapData, separator, allTiles);

    for (const type of profile.layers) {
      const candidates = (regions.get(type) || allTiles).filter(tile => Math.hypot(tile.col - Number(mapData.exitCol), tile.row - Number(mapData.exitRow)) >= 3);
      if (type === TYPES.ORE_MINE) addMineLayer(mapData, rng, candidates, blockedKeys, plan);
      else if (type === TYPES.BANDIT_HIDEOUT) addBanditLayer(mapData, rng, candidates, blockedKeys, plan);
      else if (type === TYPES.TRAPPED_CACHE) addCacheLayer(mapData, rng, candidates, blockedKeys, plan);
      else if (type === TYPES.CATACOMB) addCatacombLayer(mapData, rng, candidates, blockedKeys, plan);
      else if (type === TYPES.RUIN_ENTRANCE) addRuinLayer(mapData, rng, candidates, blockedKeys, plan);
    }

    mapData.name = profile.discoveredLabel;
    mapData.caveSite = clone(profile);
    mapData.caveSitePlan = {
      separatorRock: plan.separator ? { col: plan.separator.col, row: plan.separator.row, cells: clone(plan.separator.cells), oreKind: plan.separator.oreKind } : null,
      banditSpawns: clone(plan.banditSpawns), ghoulSpawns: clone(plan.ghoulSpawns), traps: clone(plan.traps), cache: clone(plan.cache),
      coffins: clone(plan.coffins), ruinEntrance: clone(plan.ruinEntrance), mineRockCount: plan.mineRocks.length,
    };
    plansByMapId.set(String(mapId), plan);
    window.__farmLog?.(`[cave-sites] built ${mapId}: ${profile.layers.join('+')} separator=${plan.separator ? `${plan.separator.col},${plan.separator.row}` : 'none'} ore=${mapData.oreRocks?.length || 0} bandits=${plan.banditSpawns.length} traps=${plan.traps.length}`, 'world');
    return mapData;
  }

  function currentStateIdentity() {
    const worldId = String(window.__hobunjiPlayerProfile?.worldId || window.__hobunjiPlayerProfile?.playerId || 'session'); // World/profile id used to isolate cave interaction state.
    let cycle = 1; // Tothal cycle used because procedural cave anchors/profiles regenerate with wilderness terrain.
    try { cycle = Number(window.CalendarSystem?.tothalCycle?.() || 1); } catch (_) { /* CalendarSystem throws until its init() has run during boot. */ }
    return `${worldId}|${cycle}`;
  }

  function saveStateKey(identity) { return `hobunji.caveSites.v1:${identity}`; }

  function ensureStateLoaded() {
    const identity = currentStateIdentity();
    if (stateIdentity === identity) return;
    stateIdentity = identity;
    runtimeStateBySignature.clear();
    if (identity.startsWith('session|') || typeof localStorage === 'undefined') return;
    try {
      const saved = JSON.parse(localStorage.getItem(saveStateKey(identity)) || '{}'); // Persisted discovery/cache/trap/cleared flags for this world and Tothal cave generation.
      for (const [signature, state] of Object.entries(saved || {})) runtimeStateBySignature.set(signature, state || {});
    } catch (error) {
      window.__farmLog?.(`[cave-sites] state load failed: ${error.message}`, 'warn');
    }
  }

  function persistState() {
    ensureStateLoaded();
    if (!stateIdentity || stateIdentity.startsWith('session|') || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(saveStateKey(stateIdentity), JSON.stringify(Object.fromEntries(runtimeStateBySignature)));
    } catch (error) {
      window.__farmLog?.(`[cave-sites] state save failed: ${error.message}`, 'warn');
    }
  }

  function stateFor(profile) {
    ensureStateLoaded();
    if (!runtimeStateBySignature.has(profile.signature)) runtimeStateBySignature.set(profile.signature, { discovered: false, cacheOpened: false, triggeredTraps: [], occupantsCleared: false, ruinEntered: false });
    return runtimeStateBySignature.get(profile.signature);
  }

  function syncTransitionLabels(zoneId) {
    if (!zoneSites(zoneId).length) return 0;
    const byMapId = sitesByMapId; // Cave lookup used to rename old den transitions without changing ids/targets.
    let changed = 0;
    const layout = zoneLayout(zoneId);
    for (const transition of layout?.transitions || []) {
      if (!byMapId.has(transition?.targetMapId)) continue;
      if (transition.label !== 'Cave') { transition.label = 'Cave'; changed++; }
    }
    const info = wildlifeDeps?.zoneScenes?.get?.(zoneId);
    for (const transition of info?.transitions || []) {
      if (!byMapId.has(transition?.targetMapId)) continue;
      if (transition.label !== 'Cave') { transition.label = 'Cave'; changed++; }
    }
    return changed;
  }

  function withAnimalOnlyDens(zoneId, callback) {
    const layout = zoneLayout(zoneId);
    if (!layout || !Array.isArray(layout.dens)) return callback();
    zoneSites(zoneId); // Ensures older layouts receive caveSite metadata before filtering.
    const originalDens = layout.dens; // Full cave-anchor compatibility list restored immediately after legacy wildlife code completes.
    layout.dens = originalDens.filter(den => isAnimalDenSite(den));
    filteringDens = true;
    try { return callback(); }
    finally { layout.dens = originalDens; filteringDens = false; }
  }

  function caveDistanceTiles(target) {
    const player = wildlifeDeps?.player;
    const tileSize = Number(wildlifeDeps?.TILE) || 32;
    if (!player || !target) return Infinity;
    return Math.hypot(player.x / tileSize - (target.col + 0.5), player.y / tileSize - (target.row + 0.5));
  }

  function markDiscovered(profile, state) {
    if (state.discovered) return;
    state.discovered = true;
    persistState();
    wildlifeDeps?.showZoneBanner?.(profile.discoveredLabel.toUpperCase());
    wildlifeDeps?.showToast?.(profile.layers.includes(TYPES.EMPTY) ? 'This cave appears naturally empty.' : profile.discoveredLabel, false);
    window.__farmLog?.(`[cave-sites] discovered ${profile.signature}: ${profile.layers.join('+')}`, 'world');
  }

  function occupantSpawns(plan) {
    return [...(plan.banditSpawns || []), ...(plan.ghoulSpawns || [])];
  }

  // Bandit hideouts and catacomb ghouls are both humanoids built by
  // BanditCombat.makeEntity (ghouls with the same roster/def overrides Town
  // Mine floors use), spawned once per page session while the player is in
  // the cave and marked cleared once every one of them has died.
  function ensureOccupants(profile, plan, state) {
    const spawns = occupantSpawns(plan); // Logical tiles for every humanoid this cave history owns.
    if (!spawns.length || state.occupantsCleared) return;
    const mapId = profile.mapId;
    const hostileObjects = wildlifeDeps?.hostileObjects;
    if (!hostileObjects) return;
    for (const entity of hostileObjects) if (entity?.caveSiteMapId === mapId && entity.health > 0) return; // Hideout still active.
    if (banditPopulatedMaps.has(mapId)) {
      state.occupantsCleared = true;
      persistState();
      window.__farmLog?.(`[cave-sites] cave occupants cleared: ${mapId}`, 'world');
      return;
    }
    if (banditSpawnPromises.has(mapId) || !window.BanditCombat?.loadGangConfig || !window.BanditCombat?.makeEntity) return;

    const promise = (async () => {
      const cfg = await window.BanditCombat.loadGangConfig(); // Existing gang config owns species/clothing/weapons instead of cave code duplicating bandit construction.
      if (wildlifeDeps?.getCurrentArea?.() !== mapId) return;
      const tileSize = Number(wildlifeDeps?.TILE) || 32;
      let spawned = 0; // Number of actual entities created for this cave in the current page session.
      for (const spawn of spawns) {
        const x = (spawn.col + 0.5) * tileSize;
        const y = (spawn.row + 0.5) * tileSize;
        const opts = { zoneId: mapId, extra: { homeX: x, homeY: y, state: 'idle', caveSiteMapId: mapId } };
        if (spawn.ghoul) {
          opts.rosterOverride = {
            name: 'Ghoul',
            appearance: { speciesId: 'ghoul', gender: spawn.gender || 'male', cosmetics: {}, randomSeed: `cave-ghoul:${profile.signature}:${spawn.col}:${spawn.row}` },
            equippedCosmetics: [],
            appliedDyes: {},
          };
          opts.defOverride = { label: 'Ghoul', maxHealth: 34, maxStamina: 55, attackDamage: 6, rangedWeaponKey: null, aggroRangePx: tileSize * 8, leashRangePx: tileSize * 30 };
        }
        const entity = await window.BanditCombat.makeEntity(cfg, spawn.rank || 'grunt', spawn.tier || 1, x, y, opts);
        if (wildlifeDeps?.getCurrentArea?.() !== mapId) break;
        if (!entity) continue;
        entity.caveSiteMapId = mapId;
        entity.caveSiteSignature = profile.signature;
        hostileObjects.add(entity);
        spawned++;
      }
      if (spawned > 0) banditPopulatedMaps.add(mapId);
      window.__farmLog?.(`[cave-sites] populated ${mapId} with ${spawned}/${spawns.length} occupant(s).`, 'world');
    })().catch(error => window.__farmLog?.(`[cave-sites] occupant spawn failed for ${mapId}: ${error.message}`, 'warn'))
      .finally(() => banditSpawnPromises.delete(mapId));
    banditSpawnPromises.set(mapId, promise);
  }

  function triggerTraps(profile, plan, state) {
    if (!plan.traps?.length) return;
    const triggered = new Set(state.triggeredTraps || []); // Persisted trap ids that must remain harmless on revisits/reloads.
    for (const trap of plan.traps) {
      if (triggered.has(trap.id) || caveDistanceTiles(trap) > TRAP_TRIGGER_RADIUS_TILES) continue;
      triggered.add(trap.id);
      state.triggeredTraps = [...triggered];
      const tileSize = Number(wildlifeDeps?.TILE) || 32;
      wildlifeDeps?.damagePlayer?.(trap.damage, (trap.col + 0.5) * tileSize, (trap.row + 0.5) * tileSize, 0, { tag: trap.tag || 'sharp', caveTrap: true });
      wildlifeDeps?.showToast?.('A concealed cave trap snaps!', false);
      window.__farmLog?.(`[cave-sites] trap ${trap.id} triggered for ${trap.damage} ${trap.tag} damage.`, 'world');
      persistState();
    }
  }

  function narcoticRecipe() {
    const defs = Object.values(window.AlchemySystem?.RECIPE_DEFS || {}); // Existing authored alchemy recipes searched by metadata/name; no cave-only narcotic item definitions.
    return defs.find(def => /narcotic|rush|frenzy/i.test(`${def?.id || ''} ${def?.label || ''} ${(def?.tags || []).join?.(' ') || ''}`)) || null;
  }

  function grantCacheLoot(profile, plan, state) {
    if (!plan.cache || state.cacheOpened || caveDistanceTiles(plan.cache) > CACHE_OPEN_RADIUS_TILES) return;
    state.cacheOpened = true;
    const gained = window.LootRolling?.rollLootPool?.('dungeonChest_tier2') || {}; // Existing dungeon chest pool supplies ordinary treasure/trinket entries.
    const parts = [];
    const trinkets = window.TrinketSystem?.claimLoot?.(gained, 'caveCache') || []; // Existing trinket claim path converts trinket_* loot entries into gear correctly.
    parts.push(...trinkets);
    const granted = devSpawnerDeps?.grantLoot?.(gained) || []; // Existing generalized loot grant handles ordinary item/gold entries when available.
    parts.push(...granted);

    const rng = makeRng(`${profile.signature}:cache-specials`); // Stable special-loot stream prevents rerolls if the game reloads after opening state is saved.
    if (rng() < CACHE_RELIC_CHANCE && window.HarlyaoRelics?.grantBoundRelic) {
      const relicKey = window.HarlyaoRelics.grantBoundRelic(); // Existing bound relic system constructs/persists an enchanted weapon; enchantment legality is not altered here.
      if (relicKey) parts.push('enchanted relic weapon');
    }
    if (rng() < CACHE_NARCOTIC_CHANCE) {
      const recipe = narcoticRecipe(); // Existing narcotic recipe selected without hardcoding a deprecated/renamed item key.
      const itemKey = recipe && window.AlchemySystem?.ensureRecipeItemDef?.(recipe.id, 1);
      if (itemKey && devSpawnerDeps?.grantLoot) parts.push(...(devSpawnerDeps.grantLoot({ [itemKey]: 1 }) || []));
    }

    persistState();
    wildlifeDeps?.showToast?.(parts.length ? `Hidden cache: ${parts.join(', ')}` : 'You open the hidden cache.', true);
    window.__farmLog?.(`[cave-sites] opened cache ${plan.cache.id}: ${JSON.stringify(gained)}`, 'world');
  }

  function maybeEnterRuin(profile, plan, state) {
    if (!plan.ruinEntrance || ruinTransitionMaps.has(profile.mapId) || caveDistanceTiles(plan.ruinEntrance) > RUIN_TRIGGER_RADIUS_TILES) return;
    const ruin = window.DevRandomRuin;
    if (!ruin?.generate) {
      wildlifeDeps?.showToast?.('An ancient worked passage continues beyond the cave.', false);
      return;
    }
    state.ruinEntered = true; // Discovery/history flag only; revisiting the same threshold remains allowed after returning from the ruin.
    persistState();
    ruinTransitionMaps.add(profile.mapId);
    const den = zoneLayout(profile.zoneId)?.dens?.find(candidate => String(candidate.id) === String(profile.denId)); // Exterior cave anchor used as the safe existing return destination after the ruin.
    const anchor = den?.mouthAnchor || profile.mouthAnchor || { x: 1, y: 1 };
    const tileSize = Number(wildlifeDeps?.TILE) || 32;
    const returnAnchor = { area: profile.zoneId, x: (Number(anchor.x) + 0.5) * tileSize, y: (Number(anchor.y) + 0.5) * tileSize };
    Promise.resolve(ruin.generate(plan.ruinEntrance.seed, { site: true, label: 'Ancient Ruin', returnAnchor }))
      .then(ok => {
        if (!ok) wildlifeDeps?.showToast?.('The ancient passage cannot be entered right now.', false);
      })
      .catch(error => {
        window.__farmLog?.(`[cave-sites] ruin transition failed for ${profile.mapId}: ${error.message}`, 'warn');
      })
      .finally(() => ruinTransitionMaps.delete(profile.mapId));
  }

  function updateCurrentCaveRuntime(dt = 0) {
    caveRuntimeTimer -= Number(dt) || 0;
    if (caveRuntimeTimer > 0) return;
    caveRuntimeTimer = CAVE_RUNTIME_INTERVAL_S;
    const mapId = String(wildlifeDeps?.getCurrentArea?.() || '');
    const plan = plansByMapId.get(mapId); // Only caverns decorated this session have a plan; checked first so open-world ticks do no profile work.
    const profile = plan && sitesByMapId.get(mapId);
    if (!profile) return;
    const state = stateFor(profile);
    markDiscovered(profile, state);
    ensureOccupants(profile, plan, state);
    triggerTraps(profile, plan, state);
    grantCacheLoot(profile, plan, state);
    maybeEnterRuin(profile, plan, state);
  }

  function wrapInit(api, capture, marker) {
    if (!api?.init || api[marker]) return;
    api[marker] = true;
    const previous = api.init; // Existing subsystem initializer preserved verbatim after cave integration captures its dependency bag.
    api.init = function caveSiteWrappedInit(injectedDeps, ...args) {
      capture(injectedDeps);
      return previous.call(this, injectedDeps, ...args);
    };
  }

  function installIntegrations() {
    const wildlife = window.WildlifeSpawn;
    const cavern = window.CavernGenerator;

    // Capture init dependency bags as soon as each subsystem exists. This is
    // intentionally independent of the cavern/wildlife wrappers below so a
    // parser-order difference cannot let game.js initialize one subsystem
    // before CaveSiteSystem has captured the shared runtime helpers.
    wrapInit(wildlife, deps => { wildlifeDeps = deps; }, '__caveSiteInitWrapped');
    wrapInit(window.DevSpawner, deps => { devSpawnerDeps = deps; }, '__caveSiteInitWrapped');

    if (cavern && !cavern.__caveSiteSynthesisWrapped && typeof cavern.synthesizeCavernMapData === 'function') {
      cavern.__caveSiteSynthesisWrapped = true;
      const previousSynthesize = cavern.synthesizeCavernMapData.bind(cavern); // Existing cavern shell/ore/wildlife generator remains authoritative.
      cavern.synthesizeCavernMapData = function caveSiteSynthesize(mapId, ...args) {
        return decorateCavernMapData(mapId, previousSynthesize(mapId, ...args));
      };
    }

    if (wildlife && !wildlife.__caveSiteUpdateWrapped && typeof wildlife.updateHostileSpawning === 'function') {
      wildlife.__caveSiteUpdateWrapped = true;
      const previousUpdate = wildlife.updateHostileSpawning.bind(wildlife); // Legacy exterior ecology tick reused only against cave profiles that actually contain a den.
      wildlife.updateHostileSpawning = function caveSiteWildlifeUpdate(dt) {
        const area = String(wildlifeDeps?.getCurrentArea?.() || '');
        const isZone = !!wildlifeDeps?._isZoneArea?.(area);
        const result = isZone ? withAnimalOnlyDens(area, () => previousUpdate(dt)) : previousUpdate(dt);
        if (isZone) syncTransitionLabels(area); // Turnover can recreate a legacy 'dark burrow' label during the tick; normalize it back to the generic cave label immediately.
        updateCurrentCaveRuntime(dt);
        return result;
      };
    }

    if (wildlife && !wildlife.__caveSiteZoneEnteredWrapped && typeof wildlife.onZoneEntered === 'function') {
      wildlife.__caveSiteZoneEnteredWrapped = true;
      const previousEntered = wildlife.onZoneEntered.bind(wildlife); // Existing turnover synchronization runs on animal-den caves only.
      wildlife.onZoneEntered = function caveSiteZoneEntered(zoneId, ...args) {
        const result = withAnimalOnlyDens(zoneId, () => previousEntered(zoneId, ...args));
        syncTransitionLabels(zoneId);
        return result;
      };
    }

    if (wildlife && !wildlife.__caveSiteCensusWrapped && typeof wildlife.denNestCensus === 'function') {
      wildlife.__caveSiteCensusWrapped = true;
      const previousCensus = wildlife.denNestCensus.bind(wildlife); // Existing den/nest debug metrics retained and augmented with total generic cave counts.
      wildlife.denNestCensus = function caveSiteDenNestCensus(zoneId) {
        const sites = sitesForZone(zoneId);
        const animalSites = sites.filter(site => isAnimalDenSite(site));
        const result = withAnimalOnlyDens(zoneId, () => previousCensus(zoneId));
        return { ...result, denCount: animalSites.length, caveCount: sites.length, caveTypes: sites.map(site => site.layers.join('+')) };
      };
    }

    const ready = !!(wildlife?.__caveSiteUpdateWrapped && cavern?.__caveSiteSynthesisWrapped); // Core integration readiness shown in mobile diagnostics.
    if (ready && !integrationsInstalled) {
      integrationsInstalled = true;
      window.__farmLog?.('[cave-sites] integrations installed: cavern decorator + animal-only den ecology + cave runtime.', 'world');
    }
    return ready;
  }

  function debugSnapshot(zoneId = null) {
    ensureStateLoaded();
    const zones = zoneId ? [String(zoneId)] : [...sitesByZone.keys()]; // Requested/all registered zones included in the mobile-readable diagnostic snapshot.
    const sites = zones.flatMap(id => sitesForZone(id));
    const currentArea = String(wildlifeDeps?.getCurrentArea?.() || '');
    return {
      ready: integrationsInstalled,
      currentArea,
      latestChange: 'Legacy den anchors are now generic caves with deterministic occupancy/history layers; only animal-den caves participate in den ecology.',
      zoneCount: zones.length,
      caveCount: sites.length,
      caves: sites.map(site => ({ mapId: site.mapId, zoneId: site.zoneId, denId: site.denId, layers: site.layers, separator: !!site.mineableSeparator, label: site.discoveredLabel })),
      currentPlan: plansByMapId.has(currentArea) ? clone({
        profile: plansByMapId.get(currentArea).profile,
        separator: plansByMapId.get(currentArea).separator && { col: plansByMapId.get(currentArea).separator.col, row: plansByMapId.get(currentArea).separator.row, cells: plansByMapId.get(currentArea).separator.cells, oreKind: plansByMapId.get(currentArea).separator.oreKind },
        banditSpawns: plansByMapId.get(currentArea).banditSpawns,
        ghoulSpawns: plansByMapId.get(currentArea).ghoulSpawns,
        traps: plansByMapId.get(currentArea).traps,
        cache: plansByMapId.get(currentArea).cache,
        coffins: plansByMapId.get(currentArea).coffins,
        ruinEntrance: plansByMapId.get(currentArea).ruinEntrance,
      }) : null,
      currentState: profileForMapId(currentArea) ? clone(stateFor(profileForMapId(currentArea))) : null,
    };
  }

  window.CaveSiteSystem = Object.freeze({
    TYPES,
    TYPE_LABELS,
    applyWorkspaceProfiles,
    sitesForZone,
    profileForMapId,
    isAnimalDenSite,
    decorateCavernMapData,
    syncTransitionLabels,
    updateCurrentCaveRuntime,
    installIntegrations,
    debugSnapshot,
    buildInteriorProps,
    __test: Object.freeze({
      rollProfile,
      forceAnimalProfile,
      findMineableSeparator,
      floorTiles,
      caveTitle,
      plansByMapId,
      sitesByZone,
      sitesByMapId,
      hashSeed,
    }),
  });

  // index.html loads this after wildlife-spawn.js, dev-spawner.js and
  // cavern-generator.js but before game.js, so the wrappers are in place
  // before game.js calls any of their init()s. The listeners are fallbacks
  // for preview/tool pages that create those globals later.
  if (!installIntegrations() && typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', installIntegrations, { once: true });
    window.addEventListener?.('load', installIntegrations, { once: true });
  }
})();
