// Procedural cave-site layer promoted from the older one-den-per-cavern model.
//
// Existing wilderness "dens" remain the compatibility anchor that owns a cave
// mouth, transition, map id, collision footprint, and Den-Mother ecology. This
// module rolls each anchor two deterministic layers — contents (ore-rich,
// mushrooms, hidden cache, catacomb, ruin entrance) and inhabitant (animal
// den, bandits, none) — and decorates CavernGenerator's existing shell instead
// of inventing a second interior/dungeon pipeline. Only caves inhabited by an
// animal den are exposed to WildlifeSpawn's den lifecycle.
(() => {
  'use strict';

  if (window.CaveSiteSystem) return;

  // Every cave rolls two independent layers: what is in it (contents) and who
  // lives there (inhabitant). Both are deterministic per cave anchor.
  const TYPES = Object.freeze({
    // Contents
    ORE_MINE: 'ore_mine',
    TRAPPED_CACHE: 'trapped_cache',
    CATACOMB: 'catacomb',
    RUIN_ENTRANCE: 'ruin_entrance',
    MUSHROOM_CAVE: 'mushroom_cave',
    // Inhabitants
    BANDIT_HIDEOUT: 'bandit_hideout',
    ANIMAL_DEN: 'animal_den',
    NONE: 'none',
  });

  const TYPE_LABELS = Object.freeze({
    [TYPES.ORE_MINE]: 'Ore-rich Cave',
    [TYPES.TRAPPED_CACHE]: 'Hidden Cache',
    [TYPES.CATACOMB]: 'Ancient Catacomb',
    [TYPES.RUIN_ENTRANCE]: 'Ancient Ruin Entrance',
    [TYPES.MUSHROOM_CAVE]: 'Mushroom Cave',
    [TYPES.BANDIT_HIDEOUT]: 'Bandit Hideout',
    [TYPES.ANIMAL_DEN]: 'Animal Den',
    [TYPES.NONE]: 'Uninhabited',
  });

  const CONTENTS_WEIGHTS = Object.freeze([
    [TYPES.ORE_MINE, 26],
    [TYPES.MUSHROOM_CAVE, 22],
    [TYPES.TRAPPED_CACHE, 18],
    [TYPES.CATACOMB, 18],
    [TYPES.RUIN_ENTRANCE, 16],
  ]);

  const INHABITANT_WEIGHTS = Object.freeze([
    [TYPES.ANIMAL_DEN, 45],
    [TYPES.NONE, 33],
    [TYPES.BANDIT_HIDEOUT, 22],
  ]);

  const PROFILE_SCHEMA = 2; // contents + inhabitant layers; den.caveSite tags from older schemas are rerolled.
  const MUSHROOM_REAGENT_KEY = 'duskcapMushroom'; // AlchemySystem reagent the mushroom cave grows (the game's only mushroom item).
  const MUSHROOM_INTERACT_RADIUS_TILES = 1.55; // Used only for aimed, explicit cave-cluster pickup; walking across a cluster never harvests it.
  const MUSHROOM_REGROW_DAYS = 3; // Picked clusters regrow after this many in-game days.
  const SKELETON_SPECIES_ID = 'mao-ao-skeleton'; // Catacomb bodies (js/mao-ao-skeleton-species-runtime.js).
  const SKELETON_NAME = "Mao'ao Skeleton";
  const SKELETON_LOOT_POOL = 'caveSkeletonBody'; // docs/config/loot/loot-pools.json grave goods.
  const BODY_LOOT_HOLD_S = 2; // Short hold per body (js/corpse-hold-loot.js).
  const BODY_RISE_CHANCE = 0.2; // Per body, rolled fresh each visit: most bodies stay bodies.
  const BODY_RISE_ARM_RADIUS_TILES = 4.5; // Walking this close arms a riser's timer...
  const BODY_RISE_DELAY_S = Object.freeze([3, 12]); // ...which fires after a random delay, once the player has relaxed...
  const BODY_RISE_MAX_DISTANCE_TILES = 9; // ...provided they are still around to see it.
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
  const mushroomMeshesByMapId = new Map(); // map id -> (cluster id -> scene group), so a pick can remove exactly that cluster.
  const propMeshesByMapId = new Map(); // Map id -> scene and built authored props; the live chest/ruin threshold can be sensed without scanning the cave shell.
  const mushroomScenesByMapId = new Map(); // Retains the cave scene for visual regrowth after the in-game day changes.
  const mushroomVisualDayByMapId = new Map(); // Last day each cave's mushroom visuals were reconciled.
  const bodiesByMapId = new Map(); // map id -> catacomb body records { body, entity, riser, armedAt, delay, rising, risen } for this page session.
  const bodySpawnPromises = new Map(); // map id -> in-flight body population.
  let lastCaveArea = null; // Arrival banners run once per cave entry, including returning to a known cave.
  let ruinParentZone = null; // Keeps a cave's wilderness protected while the player explores its connected generated ruin.
  let caveClock = 0; // Seconds of cave runtime; drives riser delays without wall-clock reads.
  let wildlifeDeps = null; // Captured from WildlifeSpawn.init; used for current area/player/hostile collection and damage helpers.
  let devSpawnerDeps = null; // Captured from DevSpawner.init; used for the existing generalized loot grant helper.
  let caveRuntimeTimer = 0; // Throttles interior proximity/runtime work to CAVE_RUNTIME_INTERVAL_S.
  let stateIdentity = null; // World|Tothal-cycle key used to reload the correct cave discovery/loot state.
  let savedCaveState = null; // { version, identity, sites } — the world-save payload (see ensureStateLoaded).
  let saveDeps = null; // { save } from game.js; persistState() asks the game to write the world save.
  let deferredSaveQueued = false; // Coalesces expensive world-save serialization across quick mushroom picks.
  let deferredSaveGeneration = 0; // Prevents an old world's idle save from firing after restore().
  const CAVE_SAVE_VERSION = 2;
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

  function caveTitle(contents, inhabitant) {
    const contentsLabel = TYPE_LABELS[contents] || 'Cave';
    return inhabitant && inhabitant !== TYPES.NONE ? `${contentsLabel} — ${TYPE_LABELS[inhabitant] || inhabitant}` : contentsLabel;
  }

  function profileLayers(contents, inhabitant) {
    return [contents, inhabitant].filter(type => type && type !== TYPES.NONE);
  }

  function rollProfile(zoneId, den) {
    const signature = caveSignature(zoneId, den); // Stable site identity used by deterministic profile generation and persistence.
    // Separate streams so retuning one layer's weights never reshuffles the other.
    const contents = weightedPick(makeRng(`${signature}:contents`), CONTENTS_WEIGHTS);
    const inhabitant = weightedPick(makeRng(`${signature}:inhabitant`), INHABITANT_WEIGHTS);
    return {
      schema: PROFILE_SCHEMA,
      id: `cave_${String(den?.id || 'site')}`,
      zoneId: String(zoneId || ''),
      denId: String(den?.id || ''),
      mapId: caveMapId(zoneId, den?.id),
      signature,
      contents,
      inhabitant,
      layers: profileLayers(contents, inhabitant), // Flat list kept for diagnostics.
      exteriorLabel: 'Cave',
      discoveredLabel: caveTitle(contents, inhabitant),
      mouthAnchor: den?.mouthAnchor ? clone(den.mouthAnchor) : null,
      source: 'promoted_den_anchor',
    };
  }

  function forceAnimalProfile(profile) {
    profile.inhabitant = TYPES.ANIMAL_DEN;
    profile.layers = profileLayers(profile.contents, profile.inhabitant);
    profile.discoveredLabel = caveTitle(profile.contents, profile.inhabitant);
    return profile;
  }

  // One assignment path for both freshly generated workspaces and cached
  // Tothal layouts (which skip the generator capture), so a zone's caves get
  // the same profiles either way. Dens already tagged keep their profile.
  function assignZoneProfiles(zoneId, dens) {
    const key = String(zoneId || '');
    const profiles = dens.map(den => den?.caveSite?.mapId && den.caveSite.schema === PROFILE_SCHEMA ? clone(den.caveSite) : rollProfile(key, den)); // One cave profile per existing den anchor, preserving all old geometry/map ids.
    if (profiles.length && !profiles.some(profile => profile.inhabitant === TYPES.ANIMAL_DEN)) {
      const rng = makeRng(`${key}:animal-den-preservation`); // Stable slot selection guarantees legacy animal ecology survives the promotion to generic caves.
      forceAnimalProfile(profiles[Math.floor(rng() * profiles.length)]);
    }
    for (let index = 0; index < dens.length; index++) {
      const den = dens[index]; // Existing compatibility record consumed by terrain/collision/turnover systems.
      const profile = profiles[index]; // Cave semantic metadata attached without changing den ids or coordinates.
      den.caveSite = clone(profile);
      den.isAnimalDen = profile.inhabitant === TYPES.ANIMAL_DEN;
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
    if (dens && !filteringDens && (!sitesByZone.has(key) || sitesByZone.get(key).length !== dens.length || dens.some(den => !den?.caveSite?.mapId || den.caveSite.schema !== PROFILE_SCHEMA))) {
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
    return (profileOrDen?.inhabitant || profileOrDen?.caveSite?.inhabitant) === TYPES.ANIMAL_DEN;
  }

  function floorTiles(mapData) {
    const solid = new Set([...(mapData?.outerRimTiles || []), ...(mapData?.colliders || [])].map(tile => tileKey(tile[0], tile[1]))); // Every placement/connectivity helper ignores explicitly solid cells, even in imported map data.
    return (mapData?.floor || []).map(tile => Array.isArray(tile)
      ? { col: Number(tile[0]), row: Number(tile[1]) }
      : { col: Number(tile?.col ?? tile?.c), row: Number(tile?.row ?? tile?.r) })
      .filter(tile => Number.isFinite(tile.col) && Number.isFinite(tile.row) && !solid.has(tileKey(tile.col, tile.row)));
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

  const MAX_SEPARATOR_WIDTH = 6; // Widest corridor a breakable rock partition can span; its full cross-section must be mined or blasted to gain entry.
  const SEPARATOR_DEPTH = 5; // Five successive mineable-rock strata obstruct a sealed chamber.
  const MIN_HIDDEN_TILES = 12; // Smallest chamber worth walling off.
  const MIN_HIDDEN_RATIO = 0.05; // ...as a share of the cave floor; real caverns are mostly one big chamber with side pockets.
  const MAX_HIDDEN_RATIO = 0.58; // Never wall off most of the cave.
  const MIN_OPTIONAL_EXTENSION_FLOOR = 80; // Smaller caves keep the full original enemy/resource budget; Hidden Cache walls retain their original eligibility.
  const EXTENSION_CHANCES = Object.freeze({ // Independent rolls spread mineable side chambers across cave histories without removing their defining encounters.
    [TYPES.ORE_MINE]: 0.62,
    [TYPES.MUSHROOM_CAVE]: 0.58,
    [TYPES.CATACOMB]: 0.55,
    [TYPES.RUIN_ENTRANCE]: 0.42,
  });

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

  function findMineableSeparator(mapData, reservedKeys = null, criticalKeys = []) {
    const tiles = floorTiles(mapData);
    const floorSet = new Set(tiles.map(tile => tileKey(tile.col, tile.row))); // Full connected cave footprint used by cut testing.
    const exitCol = Number(mapData?.exitCol) || 0, exitRow = Number(mapData?.exitRow) || 0;
    const entranceKey = nearestFloorKey(tiles, exitCol, exitRow); // Entrance-side seed used to classify the near chamber.
    if (!entranceKey || floorSet.size < 22) return null;
    const reachable = bfsKeys(entranceKey, floorSet).size; // Baseline connectivity; parts already sealed from the entrance never count as "behind" a cut.
    const candidates = []; // Corridor cuts that split off a meaningful secondary chamber.
    for (const cut of corridorCuts(floorSet)) {
      if (cut.keys.includes(entranceKey)) continue;
      if (reservedKeys && cut.cells.some(cell => !hasFeatureClearance(cell, reservedKeys, 1.4))) continue;
      if (cut.cells.some(cell => Math.hypot(cell.col - exitCol, cell.row - exitRow) < 5)) continue;
      const blocked = new Set(cut.keys);
      const near = bfsKeys(entranceKey, floorSet, blocked); // Entrance-side component once the cut becomes mineable rock.
      const usable = reachable - cut.keys.length;
      if (near.size >= usable) continue;
      const far = new Set([...floorSet].filter(candidate => !blocked.has(candidate) && !near.has(candidate))); // Sealed component revealed after mining through.
      if (criticalKeys.some(key => far.has(key) || blocked.has(key))) continue; // No den nest, creature spawn or ruin doorway may be gated behind optional rock.
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

  function thickenSeparator(separator, existingRocks, reservedKeys = new Set()) {
    const occupied = new Set(existingRocks.map(rock => tileKey(rock.col, rock.row))); // Keep the original ore set untouched outside the chosen barrier.
    const front = new Set(separator.nearKeys); // Entrance-side component determines which way the wall should grow.
    const back = new Set(separator.farKeys); // Hidden-side component receives additional rock layers.
    const axis = separator.cells.length > 1
      ? (separator.cells[0].col !== separator.cells[1].col ? 'col' : 'row')
      : null; // Width orientation is orthogonal to the direction into the hidden room.
    const directions = axis === 'col' ? [[0,1],[0,-1]]
      : axis === 'row' ? [[1,0],[-1,0]] : [[0,1],[0,-1],[1,0],[-1,0]];
    const first = separator.cells[0]; // One direction must face the sealed component rather than the player.
    const direction = directions.find(([dx,dy]) => back.has(tileKey(first.col+dx,first.row+dy)))
      || directions.find(([dx,dy]) => !front.has(tileKey(first.col+dx,first.row+dy)))
      || directions[0];
    const cells = [...separator.cells.map(c => ({ ...c, layer:1 }))]; // Preserve the pre-existing first wall exactly.
    const blockedColumns = new Set(); // Each wall column stops at its first obstruction, avoiding floating rock strata beyond a gap.
    for (let layer = 2; layer <= SEPARATOR_DEPTH; layer++) {
      for (let index = 0; index < separator.cells.length; index++) {
        if (blockedColumns.has(index)) continue;
        const base = separator.cells[index];
        const col = base.col + direction[0] * (layer-1), row = base.row + direction[1] * (layer-1);
        const key = tileKey(col,row);
        if (!back.has(key) || occupied.has(key) || !hasFeatureClearance({col,row},reservedKeys,1.4)
          || existingRocks.some(ore=>Math.hypot(ore.col-col,ore.row-row)<1.4)) {
          blockedColumns.add(index); // Deeper layers cannot jump over another resource or an objective.
          continue;
        }
        cells.push({ col, row, layer });
        occupied.add(key);
      }
    }
    return cells;
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

  function hasFeatureClearance(tile, blockedKeys, minDistance = 1.4) {
    for (const key of blockedKeys) {
      const [col, row] = key.split(',').map(Number); // Reserved feature centres used for spacing across all cave layers.
      if (Math.hypot(col - tile.col, row - tile.row) < minDistance) return false;
    }
    return true;
  }

  function pickSpacedTiles(rng, candidates, count, blockedKeys = new Set(), minDistance = 2) {
    const pool = [...candidates]; // Mutable candidate pool used to choose deterministic spaced feature positions.
    const chosen = []; // Final feature tiles used by coffins, bandits, ore, traps, etc.
    while (pool.length && chosen.length < count) {
      const index = Math.floor(rng() * pool.length); // Deterministic candidate index for this feature roll.
      const tile = pool.splice(index, 1)[0];
      const key = tileKey(tile.col, tile.row);
      if (!hasFeatureClearance(tile, blockedKeys, minDistance)) continue;
      if (chosen.some(other => Math.hypot(other.col - tile.col, other.row - tile.row) < minDistance)) continue;
      chosen.push(tile);
      blockedKeys.add(key);
    }
    return chosen;
  }

  function mineOreKind(rng) {
    return weightedPick(rng, [['stone', 32], ['copper', 24], ['tinCopper', 12], ['mushistonite', 7], ['tin', 4], ['lead', 9], ['arsenic', 6], ['silver', 8], ['gold', 3]]); // Rock looks drawn from game.js ORE_DEFS (no iron in this world).
  }

  function extensionTiles(candidates, plan) {
    if (!plan.separator) return [];
    const hidden = new Set(plan.separator.farKeys); // Spatially restrict the first guaranteed reward to the extension, not the main cave.
    return candidates.filter(tile => hidden.has(tileKey(tile.col, tile.row)));
  }

  function installMineableSeparator(mapData, rng, blockedKeys, plan) {
    const critical = []; // Required encounter/transition centers that must remain reachable without mining the wall.
    if (mapData.nestCol != null && mapData.nestRow != null) {
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) critical.push(tileKey(mapData.nestCol + dc, mapData.nestRow + dr));
    }
    for (const spawn of mapData.creatureSpawns || []) critical.push(tileKey(spawn.col, spawn.row));
    if (plan.ruinEntrance) critical.push(tileKey(plan.ruinEntrance.col, plan.ruinEntrance.row));
    // The outer rim is NOT a competing placed feature: every corridor cut has
    // solid rock at both ends, so including rim keys in distance clearance
    // rejected virtually all realistic chokepoints (the old tests lacked rims).
    const walkable = new Set(floorTiles(mapData).map(tile => tileKey(tile.col, tile.row))); // Authoritative passable cave-floor coordinates.
    const reservations = new Set([...blockedKeys].filter(key => walkable.has(key))); // Dynamic objectives/ores only; protect those without penalizing adjacent cave walls.
    const separator = findMineableSeparator(mapData, reservations, critical);
    if (!separator) return false;
    const existing = new Set((mapData.oreRocks || []).map(rock => tileKey(rock.col, rock.row)));
    const thickWall = thickenSeparator(separator, mapData.oreRocks || [], reservations); // Shared five-layer blastable barrier for every cave history.
    const occupied = new Set([...reservations, ...existing, ...thickWall.map(tile => tileKey(tile.col, tile.row))]); // Reward clearance is measured against real objects and barrier rocks, not surrounding bedrock.
    const hidden = new Set(separator.farKeys);
    const hasRewardSpace = floorTiles(mapData).some(tile => hidden.has(tileKey(tile.col, tile.row)) && hasFeatureClearance(tile, occupied, 2));
    if (!hasRewardSpace) return false; // Never seal an empty or inaccessible extension.
    const wallKind = mineOreKind(rng); // Uses standard mineable ore and shattercask interactions, no special interaction button.
    mapData.oreRocks = [...(mapData.oreRocks || []), ...thickWall.filter(cell => !existing.has(tileKey(cell.col, cell.row))).map(cell => ({
      col: cell.col, row: cell.row, oreKind: wallKind, caveSeparator: true, caveSeparatorLayer: cell.layer,
    }))];
    for (const cell of thickWall) blockedKeys.add(tileKey(cell.col, cell.row));
    plan.separator = { col: separator.col, row: separator.row, cells: thickWall, oreKind: wallKind, nearKeys: separator.nearKeys, farKeys: separator.farKeys };
    return true;
  }

  function addMineLayer(mapData, rng, candidates, blockedKeys, plan) {
    const target = clamp(Math.round(candidates.length * 0.16), 7, 15); // Mineable extension walls don't count against the cave's normal ore reward budget.
    const naturalCount = (mapData.oreRocks || []).filter(rock => !rock.caveSeparator).length;
    const localBlocked = new Set([...blockedKeys, ...(mapData.oreRocks || []).map(rock => tileKey(rock.col, rock.row))]);
    const needed = Math.max(0, target - naturalCount);
    const behind = pickSpacedTiles(rng, extensionTiles(candidates, plan), Math.min(3, needed), localBlocked, 1.45); // A mined side chamber holds worthwhile ore.
    const elsewhere = pickSpacedTiles(rng, candidates, needed - behind.length, localBlocked, 1.45);
    const extra = [...behind, ...elsewhere];
    mapData.oreRocks = [...(mapData.oreRocks || []), ...extra.map(tile => ({ col: tile.col, row: tile.row, oreKind: mineOreKind(rng) }))];
    plan.mineRocks = mapData.oreRocks.map(rock => ({ col: rock.col, row: rock.row, oreKind: rock.oreKind }));
    for (const rock of mapData.oreRocks) blockedKeys.add(tileKey(rock.col, rock.row));
  }

  function addBanditLayer(mapData, rng, candidates, blockedKeys, plan) {
    const count = clamp(2 + Math.floor(rng() * 3), 2, 4); // Small hideout population reused by BanditCombat at runtime.
    const picks = pickSpacedTiles(rng, sortTilesByDistance(candidates, mapData.exitCol, mapData.exitRow, true).slice(0, Math.max(8, Math.floor(candidates.length * 0.7))), count, blockedKeys, 2.2);
    // Extra cave charges reserve space near entrances. Keep the hideout's
    // established minimum bandit population by broadening its candidate pool
    // instead of overlapping those explosives or shrinking every encounter.
    if (picks.length < Math.min(count,2)) {
      picks.push(...pickSpacedTiles(rng,candidates.filter(tile=>!blockedKeys.has(tileKey(tile.col,tile.row))),
        Math.min(count,2)-picks.length,blockedKeys,1.45));
    }
    plan.banditSpawns = picks.map((tile, index) => ({ col: tile.col, row: tile.row, rank: index === picks.length - 1 && picks.length >= 3 ? 'lieutenant' : 'grunt', tier: 1 + (rng() < 0.25 ? 1 : 0) }));
    mapData.caveBanditSpawns = clone(plan.banditSpawns);
  }

  function addCacheLayer(mapData, rng, candidates, blockedKeys, plan) {
    // When there is a real sealed extension, the cache must be on the far side.
    // Caves lacking a safe separator preserve the existing accessible deep-cache fallback.
    if (plan.separator) candidates = extensionTiles(candidates, plan);
    const distant = sortTilesByDistance(candidates, mapData.exitCol, mapData.exitRow, true); // Deepest chamber candidates make the cache feel intentionally hidden.
    const cacheTile = distant.find(tile => hasFeatureClearance(tile, blockedKeys, 2));
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
    const hidden = pickSpacedTiles(rng, extensionTiles(candidates, plan), 1, blockedKeys, 2.15); // At least one tomb is worth excavating toward.
    const coffins = [...hidden, ...pickSpacedTiles(rng, candidates, count - hidden.length, blockedKeys, 2.15)];
    plan.coffins = coffins.map((tile, index) => ({ id: `cave_coffin_${index + 1}`, col: tile.col, row: tile.row, rotY: Math.floor(rng() * 4) * 90 }));
    for (const coffin of plan.coffins) addProp(mapData, { id: coffin.id, key: 'ruinSanctumCoffin', col: coffin.col, row: coffin.row, rotY: coffin.rotY });

    // Mao'ao skeleton bodies lie among the coffins: lootable with a short
    // hold, and now and then one gets back up (see updateBodies).
    const bodyCandidates = candidates.filter(tile => !blockedKeys.has(tileKey(tile.col, tile.row)));
    const targetBodies = clamp(Math.round(candidates.length / 14), 8, 16); // Keep the existing catacomb population even when a branch is walled off.
    let bodies = []; // Best deterministic nonoverlapping placement of the scattered corpses.
    for (let attempt = 0; attempt < 10 && bodies.length < targetBodies; attempt++) {
      const tryBlocked = new Set(blockedKeys); // Trial picks must not reserve cells until their layout wins.
      const bodyRng = attempt === 0 ? rng : makeRng(`${mapData.id}:catacomb-body-layout:${attempt}`); // Stable alternate distributions avoid unlucky greedy packing in compact caves.
      const trial = pickSpacedTiles(bodyRng, bodyCandidates, targetBodies, tryBlocked, 1.4);
      if (trial.length > bodies.length) bodies = trial;
    }
    for (const tile of bodies) blockedKeys.add(tileKey(tile.col, tile.row));
    plan.bodies = bodies.map((tile, index) => ({ id: `cave_body_${index + 1}`, col: tile.col, row: tile.row, yaw: rng() * Math.PI * 2 }));
    mapData.caveBodies = clone(plan.bodies);
  }

  function addMushroomLayer(mapData, rng, candidates, blockedKeys, plan) {
    const count = clamp(Math.round(candidates.length / 9), 6, 12); // Cluster count scaled to the cave, bounded for mobile scene cost.
    const hidden = pickSpacedTiles(rng, extensionTiles(candidates, plan), 1, blockedKeys, 1.6); // Secret grotto is worth finding.
    const tiles = [...hidden, ...pickSpacedTiles(rng, candidates, count - hidden.length, blockedKeys, 1.6)];
    plan.mushrooms = tiles.map((tile, index) => ({ id: `cave_mushroom_${index + 1}`, col: tile.col, row: tile.row, reagentKey: MUSHROOM_REAGENT_KEY, size: 0.8 + rng() * 0.6 }));
    mapData.caveMushrooms = clone(plan.mushrooms);
  }

  function addRuinLayer(mapData, rng, candidates, blockedKeys, plan) {
    const floorSet = new Set(window.CavernSculptor.expandFootprint(mapData.floor, plan.clearanceFootprints).map(tile => tile.join(','))); // Include the planned nest room when checking that the rear tunnel stays in rock.
    const occupiedKeys = new Set([...blockedKeys].filter(key => floorSet.has(key))); // The doorway may abut its own reserved rim, but must keep clearance from actual cave features.
    const hasNest = mapData.nestCol != null && mapData.nestRow != null; // Animal objective is a 2x2 footprint; its centre defines the occupied end.
    const anchorCol = hasNest ? Number(mapData.nestCol) + 0.5 : Number(mapData.exitCol); // Opposite-end scoring anchor.
    const anchorRow = hasNest ? Number(mapData.nestRow) + 0.5 : Number(mapData.exitRow); // Opposite-end scoring anchor.
    const distant = sortTilesByDistance(candidates, anchorCol, anchorRow, true); // Prefer the opposite end from the nest, or deep end for bandit/uninhabited caves.
    for (const tile of distant) {
      if (hasNest && Math.hypot(tile.col - anchorCol, tile.row - anchorRow) < 6) continue;
      for (const [dc, dr, rotY] of [[0, 1, 0], [1, 0, 90], [0, -1, 180], [-1, 0, 270]]) {
        const clearing = []; // Entire doorway footprint plus approach, reserved before inhabitants are placed.
        for (let depth = 0; depth <= 5; depth++) for (let side = -3; side <= 3; side++) {
          clearing.push({ col: tile.col + dc * depth + dr * side, row: tile.row + dr * depth - dc * side });
        }
        if (!clearing.every(cell => cell.col >= 1 && cell.row >= 1 && hasFeatureClearance(cell, occupiedKeys, 1.4))) continue;
        const tunnelTiles = []; // The long rear passage must enter solid rock without crossing another playable tunnel.
        for (let depth = 1; depth <= 6; depth++) for (let side = -1; side <= 1; side++) tunnelTiles.push({ col: tile.col - dc * depth + dr * side, row: tile.row - dr * depth - dc * side });
        if (tunnelTiles.some(cell => floorSet.has(tileKey(cell.col, cell.row)))) continue;
        plan.ruinEntrance = { id: `cave_ruin_${mapData.id}`, col: tile.col, row: tile.row, rotY, clearanceTiles: clearing, tunnelTiles, seed: hashSeed(`${plan.profile.signature}:ruin`) };
        plan.clearanceFootprints.push({ id: 'ruin-approach', tiles: clearing.map(cell => [cell.col, cell.row]) });
        // Clear natural rocks in the approach halo and prevent later layers from filling it.
        mapData.oreRocks = (mapData.oreRocks || []).filter(rock => clearing.every(cell => Math.hypot(rock.col - cell.col, rock.row - cell.row) >= 1.4));
        for (const cell of clearing) blockedKeys.add(tileKey(cell.col, cell.row));
        mapData.caveRuinEntrance = clone(plan.ruinEntrance);
        addProp(mapData, { id: plan.ruinEntrance.id, key: 'ruinEntranceDoor', col: tile.col, row: tile.row, rotY });
        addProp(mapData, { id: plan.ruinEntrance.id + '_tunnel', key: 'ruinEntranceTunnel', col: tile.col - dc * 1.2, row: tile.row - dr * 1.2, rotY, scaleX: 0.75, scaleZ: 1.5, embedded: true });
        mapData.wallHeightScale = window.CavernGenerator?.caveShape?.().full || 2.5; // Full carved height at the door (docs/config/cave-shape.js); kept for save/diagnostic readers.
        mapData.cavernTallTiles = [[tile.col, tile.row]]; // The clearance recarve lifts the roof to full height around the door and eases it down away from it.
        return;
      }
    }
    window.__farmLog?.(`[cave-sites] ${mapData.id}: no safe ruin doorway footprint; threshold omitted.`, 'warn');
  }

  function addProp(mapData, prop) {
    mapData.caveProps = Array.isArray(mapData.caveProps) ? mapData.caveProps : [];
    mapData.caveProps.push(prop);
  }

  // Called by game.js's loadBuildingScene cavern branch once the interior
  // scene exists. The cave's props are authored furniture JSON (the same
  // pieces DevRandomRuin/RuinSites build), loaded on demand and placed on
  // their tile centres.
  // Mushroom clusters reuse the wild reagent-plant mesh (ReagentPlants), three
  // to a tile; clusters picked within the regrow window are skipped.
  function buildMushroomClusters(mapId, mapData, scene) {
    const id = String(mapId); // Used to track this cave's current visual groups, scene and day consistently.
    for (const oldGroup of mushroomMeshesByMapId.get(id)?.values() || []) oldGroup.parent?.remove(oldGroup);
    const meshes = new Map();
    mushroomMeshesByMapId.set(id, meshes);
    if (scene) mushroomScenesByMapId.set(id, scene);
    mushroomVisualDayByMapId.set(id, currentDay());
    const build = window.ReagentPlants?.buildReagentPlantMesh;
    const profile = sitesByMapId.get(id);
    if (!build || !scene || !mapData?.caveMushrooms?.length) return 0;
    const state = profile ? stateFor(profile) : null;
    const rng = makeRng(`${mapId}:mushroom-visuals`);
    for (const mushroom of mapData.caveMushrooms) {
      if (state && !mushroomAvailable(state, mushroom)) continue;
      const group = new window.THREE.Group();
      for (let i = 0; i < 3; i++) {
        const stalk = build(mushroom.reagentKey);
        if (!stalk) continue;
        stalk.position.set((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6);
        stalk.scale.multiplyScalar(Number(mushroom.size) || 1);
        group.add(stalk);
      }
      if (!group.children.length) continue;
      group.position.set(mushroom.col + 0.5, 0, mushroom.row + 0.5);
      group.userData.caveSiteMushroom = { mapId, id: mushroom.id };
      scene.add(group);
      meshes.set(mushroom.id, group);
    }
    return meshes.size;
  }

  function buildInteriorProps(mapId, mapData, scene) {
    buildMushroomClusters(mapId, mapData, scene);
    const id = String(mapId); // Shared key with the mushroom index and cave profile.
    const propRecord = { scene, groups: new Map() }; // Replaced on rebuild; late async furniture loads cannot register in a stale cave.
    propMeshesByMapId.set(id, propRecord);
    const A = window.AuthoredFurniture;
    if (!A?.load || !A?.buildGroup || !scene || !mapData?.caveProps?.length) return Promise.resolve(0);
    return Promise.all(mapData.caveProps.map(prop => Promise.resolve(A.load(prop.key)).then(data => {
      if (!data || propMeshesByMapId.get(id) !== propRecord) {
        if (!data) window.__farmLog?.(`[cave-sites] prop ${prop.key} has no authored data.`, 'warn');
        return 0;
      }
      const group = A.buildGroup(data);
      group.position.set(prop.col + 0.5, 0, prop.row + 0.5);
      group.rotation.y = (Number(prop.rotY) || 0) * Math.PI / 180;
      group.scale.set(Number(prop.scaleX) || 1, 1, Number(prop.scaleZ) || 1); // Ruin rear tunnels extend into the solid rim while fitting the three-tile doorway width.
      group.userData.caveSiteProp = { mapId, id: prop.id, key: prop.key };
      scene.add(group);
      propRecord.groups.set(prop.id, group); // Only actual, scene-attached props become candidate Sense Mode targets.
      return 1;
    }))).then(built => built.reduce((sum, n) => sum + n, 0));
  }

  function senseTargets(scene) {
    if (!scene) return [];
    const mapId = String(wildlifeDeps?.getCurrentArea?.() || ''); // Prevent highlights from another cached cave scene.
    const profile = sitesByMapId.get(mapId);
    if (!profile) return [];
    const state = stateFor(profile); // Looted caches and picked mushrooms stop registering as interactable.
    const roots = []; // Only registered gameplay objects, not all authored scenery or invisible traps.
    if (mushroomScenesByMapId.get(mapId) === scene) {
      for (const [id, group] of mushroomMeshesByMapId.get(mapId) || []) {
        const mushroom = plansByMapId.get(mapId)?.mushrooms?.find(item => item.id === id);
        if (mushroom && mushroomAvailable(state, mushroom) && group.parent === scene) roots.push(group);
      }
    }
    const props = propMeshesByMapId.get(mapId);
    if (props?.scene === scene) for (const group of props.groups.values()) {
      if (group.parent !== scene) continue;
      const key = group.userData?.caveSiteProp?.key;
      if (key === 'ruinEntranceDoor' || (key === 'ruinDungeonChestT2' && !state.cacheOpened)) roots.push(group);
    }
    return roots;
  }

  function decorateCavernMapData(mapId, mapData) {
    const profile = profileForMapId(mapId);
    if (!profile || !mapData) return mapData;
    const rng = makeRng(`${profile.signature}:interior`); // Feature stream isolated from profile selection, stable across reloads.
    const solidTiles = new Set([...(mapData.outerRimTiles || []), ...(mapData.colliders || [])].map(tile => tileKey(tile[0], tile[1]))); // Static walls and the untouchable rim never enter any feature pool.
    let allTiles = floorTiles(mapData).filter(tile => !solidTiles.has(tileKey(tile.col, tile.row))); // Rebuilt after the locale carver expands objective rooms.
    const clearanceFootprints = []; // Nest and doorway requests are collected before a single shared geometry rebuild.
    const blockedKeys = new Set(solidTiles); // Reserved logical tiles preventing generated layers from stacking physical features or occupying the rim.
    for (const exit of mapData.exits || []) for (const tile of exit.tiles || []) blockedKeys.add(tileKey(tile[0], tile[1]));
    for (const item of [...(mapData.furniture || []), ...(mapData.caveProps || [])]) blockedKeys.add(tileKey(item.col, item.row));
    if (profile.inhabitant === TYPES.ANIMAL_DEN && mapData.nestCol != null && mapData.nestRow != null) {
      mapData.nestCol = Math.max(4, Number(mapData.nestCol));
      mapData.nestRow = Math.max(4, Number(mapData.nestRow));
      const nestRoom = { id: 'nest-room', col: mapData.nestCol - 3, row: mapData.nestRow - 3, width: 8, depth: 8 }; // Three tiles of maneuvering room on every side of the 2x2 nest.
      clearanceFootprints.push(nestRoom);
      for (const [col, row] of window.CavernSculptor.expandFootprint([], [nestRoom])) blockedKeys.add(tileKey(col, row));
      for (const spawn of mapData.creatureSpawns || []) blockedKeys.add(tileKey(spawn.col, spawn.row));
    }

    if (profile.inhabitant !== TYPES.ANIMAL_DEN) {
      mapData.nestCol = null;
      mapData.nestRow = null;
      mapData.denMotherKind = null;
      mapData.creatureSpawns = [];
    }

    const rockReservations = new Set(blockedKeys); // Keep natural rocks clear of objectives and one another before generating extra layers.
    mapData.oreRocks = (mapData.oreRocks || []).filter(rock => {
      if (!hasFeatureClearance(rock, rockReservations, 1.4)) return false;
      rockReservations.add(tileKey(rock.col, rock.row));
      return true;
    });
    if (profile.contents !== TYPES.RUIN_ENTRANCE) for (const rock of mapData.oreRocks) blockedKeys.add(tileKey(rock.col, rock.row));

    const plan = {
      profile: clone(profile),
      clearanceFootprints,
      separator: null,
      shattercasks: [], // Deterministic explosives spawned outside separator walls and occasionally elsewhere in caves.
      banditSpawns: [], bodies: [], traps: [], coffins: [], mineRocks: [], mushrooms: [], cache: null, ruinEntrance: null,
    }; // Runtime-only plan mirrors map decorations and drives mechanics that cannot live in static building map data.
    if (profile.contents === TYPES.RUIN_ENTRANCE) addRuinLayer(mapData, rng,
      allTiles.filter(tile => Math.hypot(tile.col - Number(mapData.exitCol), tile.row - Number(mapData.exitRow)) >= 3), blockedKeys, plan);
    if (clearanceFootprints.length) {
      window.CavernGenerator.expandCavernMapData(mapData, clearanceFootprints, makeRng(`${profile.signature}:clearance`));
      for (const key of solidTiles) blockedKeys.delete(key);
      for (const tile of mapData.outerRimTiles) blockedKeys.add(tileKey(tile[0], tile[1]));
      for (const [col, row] of window.CavernSculptor.expandFootprint([], clearanceFootprints)) blockedKeys.add(tileKey(col, row));
      allTiles = floorTiles(mapData);
    }
    const awayFromEntrance = allTiles.filter(tile => Math.hypot(tile.col - Number(mapData.exitCol), tile.row - Number(mapData.exitRow)) >= 3);

    // Decide whether to partition an existing branch before distributing its content.
    // Keep extension rolls separate from the ordinary cave's RNG so adding them
    // doesn't reshuffle loot in caves where no suitable chokepoint exists.
    const contents = profile.contents;
    const extensionRng = makeRng(`${profile.signature}:extension`); // Stable optional annex roll per cave incarnation.
    if (contents === TYPES.TRAPPED_CACHE || (awayFromEntrance.length >= MIN_OPTIONAL_EXTENSION_FLOOR && extensionRng() < (EXTENSION_CHANCES[contents] || 0))) {
      installMineableSeparator(mapData, extensionRng, blockedKeys, plan);
    }
    if (contents === TYPES.ORE_MINE) addMineLayer(mapData, rng, awayFromEntrance, blockedKeys, plan);
    else if (contents === TYPES.TRAPPED_CACHE) addCacheLayer(mapData, rng, awayFromEntrance, blockedKeys, plan);
    else if (contents === TYPES.CATACOMB) addCatacombLayer(mapData, rng, awayFromEntrance, blockedKeys, plan);
    else if (contents === TYPES.MUSHROOM_CAVE) addMushroomLayer(mapData, rng, awayFromEntrance, blockedKeys, plan);
    else if (contents === TYPES.RUIN_ENTRANCE && plan.separator) {
      // The ruin doorway remains accessible, but a little mineral pocket can hide behind a separate wall.
      const hidden = pickSpacedTiles(rng, extensionTiles(awayFromEntrance, plan), 2, blockedKeys, 1.6);
      mapData.oreRocks.push(...hidden.map(tile => ({ col: tile.col, row: tile.row, oreKind: mineOreKind(rng) })));
      plan.mineRocks = hidden.map(tile => ({ col: tile.col, row: tile.row, oreKind: mapData.oreRocks.find(rock => rock.col === tile.col && rock.row === tile.row).oreKind }));
    }
    // Guaranteed entrance-side charge beside every mineable hidden-room wall.
    if (plan.separator) {
      const wall = plan.separator.cells;
      const rockKeys = new Set((mapData.oreRocks || []).map(rock => tileKey(rock.col, rock.row)));
      const fronts = awayFromEntrance.filter(tile => plan.separator.nearKeys.includes(tileKey(tile.col,tile.row))
        && !blockedKeys.has(tileKey(tile.col,tile.row)) && !rockKeys.has(tileKey(tile.col,tile.row)));
      fronts.sort((a,b) => Math.min(...wall.map(c => (a.col-c.col)**2+(a.row-c.row)**2))
        - Math.min(...wall.map(c => (b.col-c.col)**2+(b.row-c.row)**2)));
      if (fronts.length) {
        plan.shattercasks.push({ id:'wall-charge', col:fronts[0].col, row:fronts[0].row, guaranteed:true });
        blockedKeys.add(tileKey(fronts[0].col,fronts[0].row)); // Bandit and trap placement cannot overlap the accessible blast charge.
      }
    }
    // A few ordinary caves also contain loose charges; never consume reserved content tiles.
    const freeChargeTiles = awayFromEntrance.filter(tile => !blockedKeys.has(tileKey(tile.col,tile.row))
      && !plan.shattercasks.some(charge => Math.hypot(charge.col-tile.col,charge.row-tile.row)<4));
    if ((profile.inhabitant === TYPES.BANDIT_HIDEOUT || rng()<.38) && freeChargeTiles.length) {
      const tile = freeChargeTiles[Math.floor(rng()*freeChargeTiles.length)];
      plan.shattercasks.push({id:'loose-charge',col:tile.col,row:tile.row});
      blockedKeys.add(tileKey(tile.col,tile.row));
    }
    mapData.caveShattercasks = clone(plan.shattercasks);
    if (profile.inhabitant === TYPES.BANDIT_HIDEOUT) {
      let reachable = plan.separator ? tilePoolFromKeys(awayFromEntrance, plan.separator.nearKeys) : awayFromEntrance;
      if (plan.ruinEntrance) {
        const ruin = plan.ruinEntrance; // Ruin end stays free of the hideout, including its reserved approach.
        const farthest = Math.max(...reachable.map(tile => Math.hypot(tile.col - ruin.col, tile.row - ruin.row)), 0); // Cave span determines the opposite-end bandit region.
        reachable = reachable.filter(tile => Math.hypot(tile.col - ruin.col, tile.row - ruin.row) >= Math.max(5, farthest * 0.65));
      }
      for (const rock of mapData.oreRocks || []) blockedKeys.add(tileKey(rock.col, rock.row));
      addBanditLayer(mapData, rng, reachable, blockedKeys, plan);
    }

    plan.outerRimTileCount = mapData.outerRimTiles?.length || 0;
    plan.wallHeightScale = mapData.cavernCarvedHeightScale || window.CavernGenerator?.caveShape?.().base || mapData.wallHeightScale || 1; // Peak carved height (ruin caves: at the door).

    mapData.name = window.WildlifeSpawn?.denTurnoverStateForCavern?.(mapId)?.name || 'Unexplored cave';
    mapData.caveSite = clone(profile);
    mapData.caveSitePlan = {
      shattercasks: clone(plan.shattercasks), separatorRock: plan.separator ? { col: plan.separator.col, row: plan.separator.row, cells: clone(plan.separator.cells), oreKind: plan.separator.oreKind } : null,
      banditSpawns: clone(plan.banditSpawns), bodies: clone(plan.bodies), traps: clone(plan.traps), cache: clone(plan.cache),
      coffins: clone(plan.coffins), ruinEntrance: clone(plan.ruinEntrance), mushrooms: clone(plan.mushrooms), mineRockCount: plan.mineRocks.length,
      extension: plan.separator ? { contentType: contents, hiddenTiles: plan.separator.farKeys.length } : null,
    };
    plansByMapId.set(String(mapId), plan);
    window.__farmLog?.(`[cave-sites] built ${mapId}: ${profile.contents}+${profile.inhabitant} separator=${plan.separator ? `${plan.separator.col},${plan.separator.row}` : 'none'} ore=${mapData.oreRocks?.length || 0} bandits=${plan.banditSpawns.length} traps=${plan.traps.length}`, 'world');
    return mapData;
  }

  function currentStateIdentity() {
    const worldId = String(window.__hobunjiPlayerProfile?.worldId || window.__hobunjiPlayerProfile?.playerId || 'session'); // World/profile id used to isolate cave interaction state.
    let cycle = 1; // Tothal cycle used because procedural cave anchors/profiles regenerate with wilderness terrain.
    try { cycle = Number(window.CalendarSystem?.tothalCycle?.() || 1); } catch (_) { /* CalendarSystem throws until its init() has run during boot. */ }
    return `${worldId}|${cycle}`;
  }

  // Before cave progress joined the world save it lived under its own
  // localStorage key, which cloud/folder saves never carried. Still read once
  // so existing progress is adopted into the save.
  function legacySaveStateKey(identity) { return `hobunji.caveSites.v1:${identity}`; }

  // Cave discovery/cache/trap/cleared flags travel in the world save
  // (member.caveSiteState in game.js's saveMemberWorldData). `savedCaveState`
  // is that payload: set by restore(), replaced on every real change, and
  // returned as-is by serialize() — so a save made before the calendar is
  // ready (wrong Tothal cycle) can never overwrite real progress with nothing.
  function ensureStateLoaded() {
    const identity = currentStateIdentity();
    if (stateIdentity === identity) return;
    stateIdentity = identity;
    runtimeStateBySignature.clear();
    if (identity.startsWith('session|')) return;
    let sites = savedCaveState?.identity === identity ? savedCaveState.sites : null;
    if (!sites && typeof localStorage !== 'undefined') {
      try {
        const legacy = JSON.parse(localStorage.getItem(legacySaveStateKey(identity)) || 'null');
        if (legacy && typeof legacy === 'object') { sites = legacy; savedCaveState = { version: CAVE_SAVE_VERSION, identity, sites: clone(legacy) }; }
      } catch (error) {
        window.__farmLog?.(`[cave-sites] legacy state load failed: ${error.message}`, 'warn');
      }
    }
    for (const [signature, state] of Object.entries(sites || {})) runtimeStateBySignature.set(signature, clone(state) || {});
  }

  function saveCaveStateToWorld() {
    try {
      saveDeps?.save?.();
    } catch (error) {
      window.__farmLog?.(`[cave-sites] state save failed: ${error.message}`, 'warn');
    }
  }

  function persistState(deferWorldSave = false) {
    ensureStateLoaded();
    if (!stateIdentity || stateIdentity.startsWith('session|')) return;
    savedCaveState = { version: CAVE_SAVE_VERSION, identity: stateIdentity, sites: clone(Object.fromEntries(runtimeStateBySignature)) };
    if (!deferWorldSave) { saveCaveStateToWorld(); return; }
    if (deferredSaveQueued) return;
    deferredSaveQueued = true;
    const generation = deferredSaveGeneration; // Used to reject a queued callback when a different world is restored.
    const flush = () => {
      deferredSaveQueued = false;
      if (generation === deferredSaveGeneration) saveCaveStateToWorld();
    };
    // Save the small cave-state snapshot now, but serialize the whole world
    // only during browser idle time so harvesting never blocks the pickup frame.
    if (typeof requestIdleCallback === 'function') requestIdleCallback(flush, { timeout: 3000 });
    else setTimeout(flush, 500);
  }

  function serialize() { return savedCaveState ? clone(savedCaveState) : null; }
  function restore(saved) {
    deferredSaveGeneration++;
    deferredSaveQueued = false;
    savedCaveState = saved && typeof saved === 'object' && typeof saved.identity === 'string' && saved.sites && typeof saved.sites === 'object' ? clone(saved) : null;
    stateIdentity = null; // Next access reloads from the restored payload (or the legacy key).
    runtimeStateBySignature.clear();
  }
  function init(injectedDeps) { saveDeps = injectedDeps || null; }

  function stateFor(profile) {
    ensureStateLoaded();
    if (!runtimeStateBySignature.has(profile.signature)) runtimeStateBySignature.set(profile.signature, { discovered: false, cacheOpened: false, triggeredTraps: [], occupantsCleared: false, ruinEntered: false, mushroomsPickedDay: {}, lootedBodies: [] });
    return runtimeStateBySignature.get(profile.signature);
  }

  function syncTransitionLabels(zoneId) {
    if (!zoneSites(zoneId).length) return 0;
    const byMapId = sitesByMapId; // Cave lookup used to rename old den transitions without changing ids/targets.
    let changed = 0;
    const layout = zoneLayout(zoneId);
    for (const transition of layout?.transitions || []) {
      if (!byMapId.has(transition?.targetMapId)) continue;
      const label = window.WildlifeSpawn?.denTurnoverStateForCavern?.(transition.targetMapId)?.name || 'Unexplored cave'; // Exterior labels reveal the name only after entry.
      if (transition.label !== label) { transition.label = label; changed++; }
    }
    const info = wildlifeDeps?.zoneScenes?.get?.(zoneId);
    for (const transition of info?.transitions || []) {
      if (!byMapId.has(transition?.targetMapId)) continue;
      const label = window.WildlifeSpawn?.denTurnoverStateForCavern?.(transition.targetMapId)?.name || 'Unexplored cave'; // Exterior labels reveal the name only after entry.
      if (transition.label !== label) { transition.label = label; changed++; }
    }
    return changed;
  }

  function withAnimalOnlyDens(zoneId, callback) {
    const layout = zoneLayout(zoneId);
    if (!layout || !Array.isArray(layout.dens)) return callback();
    zoneSites(zoneId); // Ensures older layouts receive caveSite metadata before filtering.
    const originalDens = layout.dens; // Full cave-anchor compatibility list restored immediately after legacy wildlife code completes.
    layout.dens = originalDens.filter(den => isAnimalDenSite(den));
    layout.caveAnchors = originalDens; // Every cave footprint, for wildlife code that must avoid all caves (den relocation) while it only sees animal dens.
    filteringDens = true;
    try { return callback(); }
    finally { layout.dens = originalDens; delete layout.caveAnchors; filteringDens = false; }
  }

  function caveDistanceTiles(target) {
    const player = wildlifeDeps?.player;
    const tileSize = Number(wildlifeDeps?.TILE) || 32;
    if (!player || !target) return Infinity;
    return Math.hypot(player.x / tileSize - (target.col + 0.5), player.y / tileSize - (target.row + 0.5));
  }

  function generatedCaveName(profile) {
    const prefixes = ['Whispering', 'Hollow', 'Broken', 'Mossy', 'Sunken', 'Echoing', 'Shrouded', 'Twisted', 'Silent', 'Weeping', 'Cold', 'Hidden', 'Winding', 'Damp', 'Forgotten', 'Shattered']; // Descriptive name parts shared by all cave contents.
    const places = ['Stone', 'Root', 'Tooth', 'Vein', 'Lantern', 'Shadow', 'Water', 'Bone', 'Thorn', 'Ash', 'Claw', 'Ember', 'Mist', 'Crag', 'Moon', 'Flint']; // Second name part keeps the generated name independent of undiscovered inhabitants/loot.
    const generation = window.WildlifeSpawn?.denTurnoverStateForCavern?.(profile.mapId)?.generation || 0; // Renewed cave slots receive a fresh deterministic name.
    const rng = makeRng(`${profile.signature}:name:${generation}`);
    return `${prefixes[Math.floor(rng() * prefixes.length)]} ${places[Math.floor(rng() * places.length)]} Cave`;
  }

  function mapLabelFor(mapId) {
    const record = window.WildlifeSpawn?.denTurnoverStateForCavern?.(mapId); // The discovery record is authoritative for both the name and timer visibility.
    if (!record?.name) return 'Unexplored cave';
    return record.stage === 'ready' ? `${record.name} is about to collapse` : `${record.name} will collapse in ${record.daysRemaining} days`;
  }

  function isZoneOccupied(zoneId) {
    return ruinParentZone === zoneId && wildlifeDeps?.getCurrentArea?.() === window.DevRandomRuin?.getState?.()?.mapId;
  }

  function resetCave(mapId) {
    ensureStateLoaded();
    const profile = sitesByMapId.get(mapId); // Old signature's discovery/loot state must not follow the relocated cave slot.
    if (profile) runtimeStateBySignature.delete(profile.signature);
    for (const record of bodiesByMapId.get(mapId) || []) {
      const resident = wildlifeDeps?.hostileObjects?.has?.(record.entity) || devSpawnerDeps?.corpseObjects?.has?.(record.entity); // Wildlife renewal may already have removed this entity through the shared despawn owner.
      wildlifeDeps?.hostileObjects?.delete?.(record.entity);
      devSpawnerDeps?.corpseObjects?.delete?.(record.entity);
      if (resident) devSpawnerDeps?.despawnCreature?.(record.entity);
    }
    plansByMapId.delete(mapId);
    bodiesByMapId.delete(mapId);
    bodySpawnPromises.delete(mapId);
    banditSpawnPromises.delete(mapId);
    banditPopulatedMaps.delete(mapId);
    for (const oldGroup of mushroomMeshesByMapId.get(mapId)?.values() || []) oldGroup.parent?.remove(oldGroup);
    mushroomMeshesByMapId.delete(mapId);
    propMeshesByMapId.delete(mapId); // Do not retain props for an erased or relocated cave.
    mushroomScenesByMapId.delete(mapId);
    mushroomVisualDayByMapId.delete(mapId);
    ruinTransitionMaps.delete(mapId);
    sitesByMapId.delete(mapId);
    persistState();
  }

  function markDiscovered(profile, state) {
    const record = window.WildlifeSpawn?.enterCave?.(profile.mapId, state.name || generatedCaveName(profile)); // Only physical entry creates an individual timer.
    const name = record?.name || state.name || generatedCaveName(profile); // Stable cave identity shown on arrival and remembered in the map key.
    if (lastCaveArea !== profile.mapId) {
      wildlifeDeps?.showZoneBanner?.(name.toUpperCase());
      lastCaveArea = profile.mapId;
    }
    if (state.discovered && state.name === name) return;
    state.name = name;
    state.discovered = true;
    persistState();
    const den = zoneLayout(profile.zoneId)?.dens?.find(candidate => String(candidate.id) === String(profile.denId)); // Entered caves become map landmarks even without companion perception.
    if (den) window.WildernessMap?.rememberDiscoveredThreat?.(`den:${profile.zoneId}:${profile.denId}`, { discoveryKey:`den:${profile.zoneId}:${profile.denId}`, kind:'den', zoneId:profile.zoneId, denKey:`${profile.zoneId}:${profile.denId}`, col:Number(den.mouthAnchor?.x ?? den.x) + 0.5, row:Number(den.mouthAnchor?.y ?? den.y) + 0.5, label:name });
    wildlifeDeps?.showToast?.(name, false);
    window.__farmLog?.(`[cave-sites] entered ${name}: ${profile.contents}+${profile.inhabitant}`, 'world');
  }

  function occupantSpawns(plan) {
    return [...(plan.banditSpawns || [])];
  }

  // Bandit hideout inhabitants are built by BanditCombat.makeEntity, spawned
  // once per page session while the player is in the cave and marked cleared
  // once every one of them has died.
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
      if (wildlifeDeps?.getCurrentArea?.() !== mapId || plansByMapId.get(mapId) !== plan) return;
      const tileSize = Number(wildlifeDeps?.TILE) || 32;
      let spawned = 0; // Number of actual entities created for this cave in the current page session.
      for (const spawn of spawns) {
        const x = (spawn.col + 0.5) * tileSize;
        const y = (spawn.row + 0.5) * tileSize;
        const opts = { zoneId: mapId, extra: { homeX: x, homeY: y, state: 'idle', caveSiteMapId: mapId } };
        const entity = await window.BanditCombat.makeEntity(cfg, spawn.rank || 'grunt', spawn.tier || 1, x, y, opts);
        if (wildlifeDeps?.getCurrentArea?.() !== mapId || plansByMapId.get(mapId) !== plan) { if (entity) devSpawnerDeps?.despawnCreature?.(entity); break; }
        if (!entity) continue;
        entity.caveSiteMapId = mapId;
        entity.caveSiteSignature = profile.signature;
        hostileObjects.add(entity);
        spawned++;
      }
      if (spawned > 0 && plansByMapId.get(mapId) === plan) banditPopulatedMaps.add(mapId);
      window.__farmLog?.(`[cave-sites] populated ${mapId} with ${spawned}/${spawns.length} occupant(s).`, 'world');
    })().catch(error => window.__farmLog?.(`[cave-sites] occupant spawn failed for ${mapId}: ${error.message}`, 'warn'))
      .finally(() => { if (banditSpawnPromises.get(mapId) === promise) banditSpawnPromises.delete(mapId); });
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
    const gained = window.LootRolling?.rollLootPool?.('dungeonChest_tier2', { masterySource: 'caveCache', zoneId: profile.zoneId }) || {}; // Cache mastery uses the wilderness pool rather than the inherited ruin chest pool.
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

  function currentDay() {
    return Number(wildlifeDeps?.calendar?.day) || 0;
  }

  function mushroomAvailable(state, mushroom) {
    const picked = state?.mushroomsPickedDay?.[mushroom.id];
    return picked == null || currentDay() - Number(picked) >= MUSHROOM_REGROW_DAYS;
  }

  // Cave Duskcaps follow the same getButtons/onAction contract as wild
  // ReagentPlants, but live on cavern tiles and are picked only when aimed at.
  function objectAt(mapId, col, row) {
    const id = String(mapId); // Used to select only this cave's authored clusters.
    const plan = plansByMapId.get(id);
    if (!plan?.mushrooms?.length || String(wildlifeDeps?.getCurrentArea?.() || '') !== id) return null;
    const mushroom = plan.mushrooms.find(item => item.col === col && item.row === row);
    if (!mushroom || caveDistanceTiles(mushroom) > MUSHROOM_INTERACT_RADIUS_TILES) return null;
    const profile = sitesByMapId.get(id);
    if (!profile || !mushroomAvailable(stateFor(profile), mushroom)) return null;
    const meshes = mushroomMeshesByMapId.get(id);
    if (meshes && !meshes.has(mushroom.id)) return null;
    const def = window.AlchemySystem?.REAGENT_DEFS?.[mushroom.reagentKey];
    const label = def?.label || 'Duskcap Mushroom';
    return {
      id: mushroom.id, type: 'reagent_plant', col, row,
      mesh: meshes?.get(mushroom.id) || null, reagentKey: mushroom.reagentKey,
      label: `${def?.icon || '🍄'} ${label}`,
      getButtons() {
        return [{ icon: def?.icon || '🍄', label: `Pick ${label}`, action: 'obj_pick_cave_mushroom', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_pick_cave_mushroom') return { ok: false, message: 'Unknown action.' };
        // Re-evaluate on press: a cached button cannot re-pick a harvested
        // cluster, interact across the cave, or target a previous scene.
        if (String(wildlifeDeps?.getCurrentArea?.() || '') !== id
          || caveDistanceTiles(mushroom) > MUSHROOM_INTERACT_RADIUS_TILES
          || !mushroomAvailable(stateFor(profile), mushroom)
          || (meshes && !meshes.has(mushroom.id))) return { ok: false, message: 'The Duskcap is not ready to pick.' };
        const bonus = Math.random() < (wildlifeDeps?.bonusYieldChance?.('foraging') || 0) ? 1 : 0;
        const doubleRank = window.PerkSystem?.rank?.('foraging', 'doubleForageables') || 0;
        const amount = (1 + bonus) * (doubleRank > 0 ? 2 : 1);
        // Standard reagent picks update inventory + the item scroll only.
        // Avoid DevSpawner.grantLoot here: its generic dungeon reward path
        // also rebuilds the entire inventory grid on every single Duskcap.
        const granted = saveDeps?.grantReagent?.(mushroom.reagentKey, amount); // Lightweight game-owned inventory mutation, or null in isolated preview tools.
        const parts = granted == null
          ? (devSpawnerDeps?.grantLoot?.({ [mushroom.reagentKey]: amount }) || [])
          : (granted > 0 ? [`${def?.icon || '🍄'}×${granted}`] : []);
        if (granted === 0) return { ok: false, message: `Cannot carry more ${label}.` };
        const liveState = stateFor(profile); // Used to migrate older cave saves that have no per-mushroom harvest map.
        liveState.mushroomsPickedDay = liveState.mushroomsPickedDay || {};
        liveState.mushroomsPickedDay[mushroom.id] = currentDay();
        wildlifeDeps?.awardForagingXp?.();
        const group = meshes?.get(mushroom.id);
        group?.parent?.remove(group);
        meshes?.delete(mushroom.id);
        persistState(true);
        window.AudioSystem?.playObjectSfx?.(window.AudioSystem?.objectSfxConfig?.()?.harvest);
        return {
          ok: true, deferMemberSave: true,
          message: parts.length ? `Picked ${parts.join(', ')}${bonus ? ' (Foraging bonus)' : ''}.` : `Picked ${amount} ${label}.`,
        };
      },
    };
  }

  function makeSkeleton(mapId, x, y, extra, roster = null) {
    const tileSize = Number(wildlifeDeps?.TILE) || 32;
    return window.MinionCombat.makeEntity({
      speciesId: SKELETON_SPECIES_ID,
      name: SKELETON_NAME,
      tier: 1,
      x, y,
      zoneId: mapId,
      weaponMetalKey: 'nativeCopper',
      roster: roster || undefined,
      defOverride: { label: SKELETON_NAME, lootPool: SKELETON_LOOT_POOL, aggroRangePx: tileSize * 8, leashRangePx: tileSize * 30 },
      extra: { homeX: x, homeY: y, caveSiteMapId: mapId, keepCorpseAfterLoot: true, lootHoldSeconds: BODY_LOOT_HOLD_S, ...extra },
    });
  }

  // Lays every catacomb body out as a settled corpse once per page session
  // (cave scenes and their entities live for the session). Bodies already
  // searched this Tothal cycle come back searched.
  function ensureBodies(profile, plan, state) {
    const mapId = profile.mapId;
    if (!plan.bodies?.length || bodiesByMapId.has(mapId) || bodySpawnPromises.has(mapId)) return;
    if (!window.MinionCombat?.makeEntity || !window.CreatureDeath?.settleAsCorpse) return;
    const tileSize = Number(wildlifeDeps?.TILE) || 32;
    const looted = new Set(state.lootedBodies || []);
    const promise = (async () => {
      const records = [];
      for (const body of plan.bodies) {
        const x = (body.col + 0.5) * tileSize, y = (body.row + 0.5) * tileSize;
        const entity = await makeSkeleton(mapId, x, y, { state: 'idle', caveBodyId: body.id });
        if (wildlifeDeps?.getCurrentArea?.() !== mapId || plansByMapId.get(mapId) !== plan) { if (entity) devSpawnerDeps?.despawnCreature?.(entity); break; }
        if (!entity) continue;
        window.CreatureDeath.settleAsCorpse(entity, { yaw: body.yaw });
        if (looted.has(body.id)) entity.corpseLooted = true;
        records.push({ body, entity, riser: Math.random() < BODY_RISE_CHANCE, armedAt: null, delay: 0, rising: false, risen: false });
      }
      if (plansByMapId.get(mapId) === plan) bodiesByMapId.set(mapId, records);
      window.__farmLog?.(`[cave-sites] laid out ${records.length} skeleton bodies in ${mapId} (${records.filter(r => r.riser).length} restless).`, 'world');
    })().catch(error => window.__farmLog?.(`[cave-sites] body spawn failed for ${mapId}: ${error.message}`, 'warn'))
      .finally(() => { if (bodySpawnPromises.get(mapId) === promise) bodySpawnPromises.delete(mapId); });
    bodySpawnPromises.set(mapId, promise);
  }

  // A restless body gets up the same way the sanctum lich raises its dead: a
  // fresh skeleton from the same roster replaces the corpse where it lies.
  async function raiseBody(mapId, record) {
    record.rising = true;
    const corpse = record.entity;
    const base = corpse.rosterRecord || null;
    const roster = base ? (corpse.corpseLooted ? { ...base, equippedCosmetics: [], cosmeticSlots: {}, appliedDyes: {} } : base) : null; // Searched bodies rise without the rags the player took.
    const minion = await makeSkeleton(mapId, corpse.x, corpse.y, { state: 'chase', caveBodyId: record.body.id }, roster);
    if (!minion || wildlifeDeps?.getCurrentArea?.() !== mapId || !bodiesByMapId.get(mapId)?.includes(record)) { if (minion) devSpawnerDeps?.despawnCreature?.(minion); record.rising = false; return; }
    if (corpse.corpseLooted) minion.corpseLooted = true; // Killing it again yields nothing new.
    devSpawnerDeps?.corpseObjects?.delete?.(corpse);
    devSpawnerDeps?.despawnCreature?.(corpse);
    wildlifeDeps?.hostileObjects?.add(minion);
    record.entity = minion;
    record.rising = false;
    record.risen = true;
    window.__farmLog?.(`[cave-sites] ${record.body.id} rose in ${mapId}.`, 'world');
  }

  function updateBodies(profile, plan, state) {
    const records = bodiesByMapId.get(profile.mapId);
    if (!records?.length) return;
    let lootedChanged = false;
    for (const record of records) {
      if (record.entity?.corpseLooted && !(state.lootedBodies || []).includes(record.body.id)) {
        state.lootedBodies = [...(state.lootedBodies || []), record.body.id];
        lootedChanged = true;
      }
      if (!record.riser || record.risen || record.rising || record.entity?.state !== 'corpse') continue;
      const distance = caveDistanceTiles(record.body);
      if (record.armedAt == null) {
        if (distance > BODY_RISE_ARM_RADIUS_TILES) continue;
        record.armedAt = caveClock;
        record.delay = BODY_RISE_DELAY_S[0] + Math.random() * (BODY_RISE_DELAY_S[1] - BODY_RISE_DELAY_S[0]);
        continue;
      }
      if (caveClock - record.armedAt >= record.delay && distance <= BODY_RISE_MAX_DISTANCE_TILES) raiseBody(profile.mapId, record);
    }
    if (lootedChanged) persistState();
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
    const anchor = den?.approachAnchor || den?.mouthAnchor || profile.mouthAnchor || { x: 1, y: 1 }; // Cliff dens' mouth is the entry transition itself; return in front of it.
    const tileSize = Number(wildlifeDeps?.TILE) || 32;
    ruinParentZone = profile.zoneId;
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
    caveClock += Number(dt) || 0;
    caveRuntimeTimer -= Number(dt) || 0;
    if (caveRuntimeTimer > 0) return;
    caveRuntimeTimer = CAVE_RUNTIME_INTERVAL_S;
    const mapId = String(wildlifeDeps?.getCurrentArea?.() || '');
    const plan = plansByMapId.get(mapId); // Only caverns decorated this session have a plan; checked first so open-world ticks do no profile work.
    const profile = plan && sitesByMapId.get(mapId);
    if (!profile) { lastCaveArea = null; return; }
    const state = stateFor(profile);
    markDiscovered(profile, state);
    ensureOccupants(profile, plan, state);
    triggerTraps(profile, plan, state);
    grantCacheLoot(profile, plan, state);
    // The cave scene is cached across visits: restore missing stalks after
    // their three-day regrowth window, without rebuilding the cave each tick.
    if (mushroomVisualDayByMapId.has(mapId) && mushroomVisualDayByMapId.get(mapId) !== currentDay()) {
      mushroomVisualDayByMapId.set(mapId, currentDay());
      const meshes = mushroomMeshesByMapId.get(mapId);
      if (plan.mushrooms?.some(item => mushroomAvailable(state, item) && !meshes?.has(item.id))) {
        buildMushroomClusters(mapId, { caveMushrooms: plan.mushrooms }, mushroomScenesByMapId.get(mapId));
      }
    }
    ensureBodies(profile, plan, state);
    updateBodies(profile, plan, state);
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
      latestChange: 'Procedural caves and mines are carved 1.5x tall (2.5x around ruin doors, easing down away from them) under a low-poly roof of irregular flat facets, with faceted, gently concave walls, so the stretch-to-fit rock texture finds many large surfaces. Walls land on tile edges, and any walkable tile still inside rendered rock becomes solid, so cave geometry and collision agree. Nests keep 8x8 rooms and ruin doors 7x6 approaches.',
      zoneCount: zones.length,
      caveCount: sites.length,
      caves: sites.map(site => ({ mapId: site.mapId, zoneId: site.zoneId, denId: site.denId, contents: site.contents, inhabitant: site.inhabitant, label: site.discoveredLabel })),
      currentPlan: plansByMapId.has(currentArea) ? clone({
        profile: plansByMapId.get(currentArea).profile,
        outerRimTileCount: plansByMapId.get(currentArea).outerRimTileCount,
        wallHeightScale: plansByMapId.get(currentArea).wallHeightScale,
        clearanceFootprints: plansByMapId.get(currentArea).clearanceFootprints,
        separator: plansByMapId.get(currentArea).separator && { col: plansByMapId.get(currentArea).separator.col, row: plansByMapId.get(currentArea).separator.row, cells: plansByMapId.get(currentArea).separator.cells, oreKind: plansByMapId.get(currentArea).separator.oreKind },
        banditSpawns: plansByMapId.get(currentArea).banditSpawns,
        bodies: plansByMapId.get(currentArea).bodies,
        bodyStates: (bodiesByMapId.get(currentArea) || []).map(record => ({ id: record.body.id, riser: record.riser, armed: record.armedAt != null, risen: record.risen, looted: !!record.entity?.corpseLooted, state: record.entity?.state || null })),
        shattercasks: plansByMapId.get(currentArea).shattercasks,
        traps: plansByMapId.get(currentArea).traps,
        cache: plansByMapId.get(currentArea).cache,
        coffins: plansByMapId.get(currentArea).coffins,
        ruinEntrance: plansByMapId.get(currentArea).ruinEntrance,
        mushrooms: plansByMapId.get(currentArea).mushrooms,
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
    senseTargets,
    objectAt,
    resetCave,
    isZoneOccupied,
    mapLabelFor,
    init,
    serialize,
    restore,
    __test: Object.freeze({
      rollProfile,
      forceAnimalProfile,
      findMineableSeparator,
      thickenSeparator,
      installMineableSeparator,
      EXTENSION_CHANCES,
      MIN_OPTIONAL_EXTENSION_FLOOR,
      floorTiles,
      caveTitle,
      plansByMapId,
      sitesByZone,
      sitesByMapId,
      hashSeed,
      generatedCaveName,
      runtimeStateBySignature,
      ensureStateLoaded,
      persistState,
      banditPopulatedMaps,
      bodiesByMapId,
      bodySpawnPromises,
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
