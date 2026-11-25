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
    PUZZLE_CAVE: 'puzzle_cave', // A compact one-challenge cavern, separate from a multiwing ruin.
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
    [TYPES.PUZZLE_CAVE]: 'Puzzle Cave',
    [TYPES.BANDIT_HIDEOUT]: 'Bandit Hideout',
    [TYPES.ANIMAL_DEN]: 'Animal Den',
    [TYPES.NONE]: 'Uninhabited',
  });

  const CONTENTS_WEIGHTS = Object.freeze([
    [TYPES.ORE_MINE, 26],
    [TYPES.MUSHROOM_CAVE, 22],
    [TYPES.TRAPPED_CACHE, 18],
    [TYPES.CATACOMB, 18],
    [TYPES.RUIN_ENTRANCE, 16], // Ordinary cave contents; independent Puzzle Caves never consume these slots.
  ]);

  const INHABITANT_WEIGHTS = Object.freeze([
    [TYPES.ANIMAL_DEN, 70],
    [TYPES.NONE, 12],
    [TYPES.BANDIT_HIDEOUT, 18],
  ]);
  const MIN_DEN_SHARE = 0.65; // Per-zone floor on inhabited ordinary cave anchors; preserves wilderness homes without adding entrances or new AI.
  const SECONDARY_POCKET_CHANCE = 0.8; // Large ordinary caves may reuse spare navigable floor for a few ore rocks or mushrooms, never extra actors.
  const MIN_SECONDARY_POCKET_TILES = 18; // Only meaningful unused cave-floor space is eligible after nests, exits, walls and primary content reserve theirs.
  const SECONDARY_POCKET_RADIUS_TILES = 5; // A secondary resource activity belongs in one connected room, not four unrelated corners of the cavern.
  const SECONDARY_POCKET_ANCHOR_ATTEMPTS = 24; // Bounded one-shot local room search, never an extra per-frame job.

  const PROFILE_SCHEMA = 4; // Den-balance migration keeps cave IDs and contents while updating legacy inhabitant allocation.
  const MUSHROOM_REAGENT_KEY = 'duskcapMushroom'; // Legacy fallback for isolated previews before AlchemySystem has loaded.
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
  const RUIN_TRIGGER_RADIUS_TILES = 0.90; // Used by the deep ruin threshold; entering is deliberately close-range.
  const CAVE_RUNTIME_INTERVAL_S = 0.12; // Used to keep cave proximity checks cheap on mobile while still feeling immediate.
  const CACHE_RELIC_CHANCE = 0.28; // Used by cache loot; Harlyao relic logic already owns enchanted-weapon construction/persistence.
  const CACHE_NARCOTIC_CHANCE = 0.35; // Used by cache loot; AlchemySystem authors the actual narcotic recipe item.

  const sitesByZone = new Map(); // zoneId -> ordinary cave profiles used by ecology filtering, map labels, and diagnostics.
  const outdoorPuzzleSitesByZone = new Map(); // Independently generated cliff Puzzle Caves; never placed in wildlife dens.
  const rockPuzzleSitesByParent = new Map(); // Hidden-door Puzzle Caves attached to a separate ordinary-cave parent map.
  const sitesByMapId = new Map(); // cavern map id -> cave profile used while decorating/loading interiors.
  const plansByMapId = new Map(); // cavern map id -> generated feature positions used by runtime traps/cache/bandits/ruin thresholds.
  const runtimeStateBySignature = new Map(); // site signature -> current-world persistent-ish discovery/interaction state.
  const banditSpawnPromises = new Map(); // map id -> in-flight BanditCombat creation promise, preventing duplicate async spawns.
  const banditPopulatedMaps = new Set(); // Session-only map ids that actually spawned a hideout; used to distinguish kills from a fresh page reload.
  const ruinTransitionMaps = new Set(); // Map ids currently transitioning into a ruin; prevents repeated proximity triggers during the fade/generation handoff.
  let ruinLicensePromptAtMs = 0; // Throttles the missing-Stone warning while the player stands inside the automatic cave threshold.
  const mushroomMeshesByMapId = new Map(); // map id -> (cluster id -> scene group), so a pick can remove exactly that cluster.
  const propMeshesByMapId = new Map(); // Map id -> scene and built authored props; the live chest/ruin threshold can be sensed without scanning the cave shell.
  const puzzleChallengesByMapId = new Map(); // Map id -> single instantiated playable challenge, scene owner and disposal lifecycle.
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

  function exteriorPuzzleKind(profile) {
    if (profile?.source !== 'independent_cliff') return null;
    return hashSeed(String(profile.signature) + ':outdoor-song') % 2 === 0 ? 'timedMelody' : 'cavePressurePlate';
  } // The cave generator and cliff entrance agree on the one deterministic exterior challenge type.

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
    const inhabitant = weightedPick(makeRng(`${signature}:inhabitant`), INHABITANT_WEIGHTS); // Wildlife ecology belongs exclusively to ordinary cave anchors.
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

  const MAX_OUTDOOR_PUZZLE_CAVES = 24; // Upper bound for independent entrances in a wilderness zone.
  const MIN_OUTDOOR_PUZZLE_CAVES = 4; // Favor several doors where enough genuine balconies exist.
  const OUTDOOR_PUZZLE_DENSITY = 0.72; // Independent per-balcony roll, with a minimum floor.
  const ROCK_PUZZLE_CHANCE = 0.8; // Extra hidden doors only appear when an ordinary cave actually has a mineable separator.

  function puzzleProfile(zoneId, denId, signature, source, extra = {}) {
    const mapId = caveMapId(zoneId, denId); // Shared cavern loader and return-zone registration; no wildlife den anchor is created.
    return {
      schema: PROFILE_SCHEMA, id: 'puzzle_' + denId, zoneId, denId, mapId, signature,
      contents: TYPES.PUZZLE_CAVE, inhabitant: TYPES.NONE,
      layers: [TYPES.PUZZLE_CAVE], exteriorLabel: 'Small Stone Door',
      discoveredLabel: 'Puzzle Cave', source, ...extra,
    };
  }

  function outdoorPuzzleSeclusion(zoneId, shelves, sourceGrid = null) {
    const layout = zoneLayout(zoneId); // Retained as a fallback for headless tools.
    const grid = sourceGrid || wildlifeDeps?.zoneScenes?.get?.(zoneId)?.grid || layout?.grid; // Prefer the current cliff network's real grid even before the zone scene is registered.
    const scorer = window.WildernessSeclusion; // Shared with generated ruin/shrine sites; loaded before the cave system.
    if (!Array.isArray(grid) || !grid.length || !scorer?.sampleVisibility) return null;
    const rows = grid.length, cols = grid[0]?.length || 0; // Grid bounds for the bounded 16-direction LOS probe.
    if (!cols) return null;
    const options = {
      cols, rows, getTile: (c, r) => grid[r]?.[c] || null,
      canStand: tile => !!tile && !tile.incline && !tile.borderEscarpment && !tile.distantBoundaryLandscape
        && !['rock', 'wall', 'river', 'stream', 'waterfall'].includes(tile.type),
      blocksSight: tile => !!tile && (tile.incline || tile.borderEscarpment || tile.distantBoundaryLandscape
        || ['rock', 'wall'].includes(tile.type)),
      elevation: tile => Number(tile?.elevTier) || 0,
    }; // Ground observers and steep cliff masses are identified by the already-built route grid.
    return shelves.map(shelf => ({
      shelf,
      visibility: scorer.sampleVisibility(options, Math.floor(shelf.x), Math.floor(shelf.z)),
    }));
  }

  function registerOutdoorPuzzleSites(zoneId, balconies = [], terrainGrid = null) {
    const key = String(zoneId || ''); // Separate zone key avoids ever replacing an ordinary den/cave profile.
    const candidates = (balconies || []).filter(shelf =>
      shelf?.base?.footprint?.length && shelf?.footprint?.length >= 2
      && Number.isFinite(shelf.y) && shelf.y > 0
      && Number(shelf.width) >= 1.7 && Number(shelf.depth) >= 1
      && shelf.normal && shelf.tangent
    ).slice().sort((a,b) => String(a.id).localeCompare(String(b.id)));
    const rng = makeRng(key + ':puzzle-cliffs:' + currentStateIdentity()); // Same saved world/cycle rolls identical independent gates.
    for(let index=candidates.length-1;index>0;index--) {
      const other=Math.floor(rng()*(index+1)); // Stable Fisher-Yates scatter, so the 24-door cap does not cluster in the first grid row.
      [candidates[index],candidates[other]]=[candidates[other],candidates[index]];
    }
    const rolled = candidates.filter(() => rng() < OUTDOOR_PUZZLE_DENSITY).slice(0, MAX_OUTDOOR_PUZZLE_CAVES);
    for(const shelf of candidates) {
      if(rolled.length >= Math.min(MIN_OUTDOOR_PUZZLE_CAVES, candidates.length, MAX_OUTDOOR_PUZZLE_CAVES)) break;
      if(!rolled.includes(shelf)) rolled.push(shelf);
    }
    ensureStateLoaded(); // Read this cycle's pre-upgrade solved cave records before choosing new cave ids.
    const legacySignatureFor = shelf => key + ':puzzle-cliff:' + String(shelf.id); // Original identity must survive a code update within the same Shift.
    const retainedLegacy = candidates.filter(shelf => runtimeStateBySignature.has(legacySignatureFor(shelf))); // Existing player progress wins over a new concealment preference.
    const ranked = outdoorPuzzleSeclusion(key, candidates, terrainGrid); // Re-rank valid real balcony positions, never invent unwalkable entrances.
    const rankedById = new Map(); // Selected profiles carry the measured seclusion for mobile debugging.
    let selected = rolled; // No runtime grid (e.g. unit tests): retain the existing deterministic roll.
    if(ranked?.length) {
      const rankRng = makeRng(key + ':concealed-cliffs:' + currentStateIdentity()); // Dedicated stream preserves existing density rolls.
      for(const entry of ranked) {
        entry.priority = entry.visibility.concealmentScore * 5 + rankRng() * 1.2;
        rankedById.set(entry.shelf.id, entry.visibility);
      }
      ranked.sort((a,b) => b.priority-a.priority || String(a.shelf.id).localeCompare(String(b.shelf.id)));
      const chosen = []; // Keep secret entrances spatially scattered instead of filling one extremely secluded ledge cluster.
      for (const entry of ranked) {
        if (chosen.length >= rolled.length) break;
        if (chosen.some(previous => Math.hypot(previous.shelf.x-entry.shelf.x, previous.shelf.z-entry.shelf.z) < 7)) continue;
        chosen.push(entry);
      }
      for (const entry of ranked) {
        if (chosen.length >= rolled.length) break;
        if (!chosen.includes(entry)) chosen.push(entry); // Keep the established density when terrain has too few separated shelves.
      }
      selected = chosen.map(entry => entry.shelf);
    }
    if (retainedLegacy.length) {
      const saved = new Set(retainedLegacy.map(shelf => shelf.id)); // Earlier cave solves must not disappear just because visibility ranking was upgraded.
      selected = [...retainedLegacy, ...selected.filter(shelf => !saved.has(shelf.id))].slice(0, rolled.length);
    }
    const cycleIdentity = currentStateIdentity(); // New Shift incarnation owns fresh cave map IDs and unopened treasure.
    const sites = selected.map(shelf => {
      const oldSignature = legacySignatureFor(shelf); // Pre-upgrade save key is already isolated by the world|cycle cave-state payload.
      const existing = runtimeStateBySignature.has(oldSignature); // Preserve its map id and opened gate in this current Shift only.
      const denId = 'puzzle_cliff_' + hashSeed(existing ? key + ':' + shelf.id : cycleIdentity + ':' + key + ':' + shelf.id).toString(36);
      return puzzleProfile(key, denId, existing ? oldSignature : cycleIdentity + ':' + key + ':puzzle-cliff:' + String(shelf.id),
        'independent_cliff', { shelfId:shelf.id, mouthAnchor:{x:Math.floor(shelf.x),y:Math.floor(shelf.z)},
          seclusion: rankedById.get(shelf.id) || null });
    });
    const newIds = new Set(sites.map(site => site.mapId)); // All previous-cycle cave interiors not in this set must be retired.
    let retired = 0; // Coalesce world-save writes when many old puzzle caves disappear in one Shift.
    for(const old of outdoorPuzzleSitesByZone.get(key) || []) {
      if(newIds.has(old.mapId)) continue;
      resetCave(old.mapId, { skipSave: true }); // Remove entrance, challenges and cached interiors, not just the cliff doorway.
      retired++;
    }
    if(retired) persistState();
    outdoorPuzzleSitesByZone.set(key, sites);
    for(const site of sites) sitesByMapId.set(site.mapId,site);
    return clone(sites);
  }

  function registerRockPuzzleSite(parent, tile = null) {
    const denId = 'puzzle_rock_' + hashSeed(parent.signature).toString(36); // One separate secret cavern per ordinary parent cave.
    const state = stateFor(parent); // Persist the reciprocal tile for loading directly inside a previously discovered secret cave.
    const remembered = state.rockPuzzleDoorReturn || null;
    const back = tile || remembered || {col:0,row:0}; // A reserved profile is harmless until the parent actually has a valid mined wall.
    const site = puzzleProfile(parent.zoneId, denId, parent.signature + ':puzzle-rock',
      'independent_rock', {parentMapId:parent.mapId,returnCol:back.col,returnRow:back.row});
    if(tile) {
      rockPuzzleSitesByParent.set(parent.mapId,site);
      if(!remembered || remembered.col!==tile.col || remembered.row!==tile.row) {
        state.rockPuzzleDoorReturn = {col:tile.col,row:tile.row};
        persistState(true); // Saved player can return to the real hidden doorway after reloading inside the side cave.
      }
    } else if(remembered) rockPuzzleSitesByParent.set(parent.mapId,site);
    sitesByMapId.set(site.mapId,site);
    return site;
  }

  function forceAnimalProfile(profile) {
    profile.inhabitant = TYPES.ANIMAL_DEN;
    profile.layers = profileLayers(profile.contents, profile.inhabitant);
    profile.discoveredLabel = caveTitle(profile.contents, profile.inhabitant);
    return profile;
  }

  // One assignment path for both freshly generated workspaces and cached
  // Tothal layouts (which skip the generator capture). Preserve all old cave
  // identities, contents and animal dens when migrating schema-3 workspaces.
  function assignZoneProfiles(zoneId, dens) {
    const key = String(zoneId || '');
    const profiles = dens.map(den => {
      const prior = den?.caveSite; // Existing cave identity, loot signature and contents must survive a den-density update.
      if (prior?.mapId && (prior.schema === PROFILE_SCHEMA || prior.schema === 3)) {
        return { ...clone(prior), schema: PROFILE_SCHEMA }; // Migration never rerolls a known cave or takes a den away.
      }
      return rollProfile(key, den);
    });
    const ordinary = profiles.filter(profile => profile.contents !== TYPES.PUZZLE_CAVE); // Separate authored puzzle caves cannot become nests.
    const minimum = Math.ceil(ordinary.length * MIN_DEN_SHARE); // Shared floor applies to every wilderness zone, independent of its cave count.
    let missing = minimum - ordinary.filter(profile => profile.inhabitant === TYPES.ANIMAL_DEN).length; // Number of existing cave interiors to share with wildlife.
    if (missing > 0) {
      ensureStateLoaded(); // Check explored sites if a new, as-yet-untagged cave rolls a bandit hideout.
      const existingBandits = new Set(dens.filter(den => den?.caveSite?.inhabitant === TYPES.BANDIT_HIDEOUT)
        .map(den => String(den.caveSite.mapId))); // Protect old hideouts even if their world-save discovery flags have not yet been restored.
      const candidates = ordinary.filter(profile => {
        const state = runtimeStateBySignature.get(profile.signature); // A cave the player has already entered must not gain a new hostile family mid-save.
        return profile.inhabitant !== TYPES.ANIMAL_DEN
          && !state?.discovered && !state?.occupantsCleared
          && (profile.inhabitant === TYPES.NONE || !existingBandits.has(String(profile.mapId)));
      });
      candidates.sort((a, b) =>
        Number(a.inhabitant !== TYPES.NONE) - Number(b.inhabitant !== TYPES.NONE)
        || hashSeed(a.signature + ':den-balance') - hashSeed(b.signature + ':den-balance')
        || a.signature.localeCompare(b.signature)); // Fill empty space before touching undiscovered bandits; stable across loads and den order.
      for (const profile of candidates) {
        if (missing <= 0) break;
        forceAnimalProfile(profile);
        missing--;
      }
    }
    for (let index = 0; index < dens.length; index++) {
      const den = dens[index]; // Existing compatibility record consumed by terrain/collision/turnover systems.
      const profile = profiles[index]; // Cave semantic metadata attached without changing den ids or coordinates.
      den.caveSite = clone(profile);
      den.isAnimalDen = profile.inhabitant === TYPES.ANIMAL_DEN;
      sitesByMapId.set(profile.mapId, profile);
    }
    sitesByZone.set(key, profiles);
    for(const profile of profiles) if(profile.contents!==TYPES.PUZZLE_CAVE) registerRockPuzzleSite(profile); // Reserve recoverable identities without counting unopened/invalid secret doors.
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
    if (!sitesByMapId.has(id) && id.startsWith('map_i_den_')) {
      wildlifeDeps?.zoneLayouts?.forEach?.((layout, zoneId) => {
        if (!sitesByMapId.has(id) && layout?.dens?.length) zoneSites(zoneId);
      });
    }
    const profile = sitesByMapId.get(id); // Resolve independent child maps without treating them as animal-den anchors.
    if(!profile)return null;
    if(profile.source === 'independent_rock') {
      const parent = sitesByMapId.get(profile.parentMapId); // Parent signature owns the persistent reciprocal doorway coordinates.
      const remembered = parent ? stateFor(parent).rockPuzzleDoorReturn : null;
      if(remembered) {
        profile.returnCol = remembered.col;
        profile.returnRow = remembered.row;
      } // A world save restored after workspace registration must not return the player to unwalkable 0,0.
    }
    return clone(profile);
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

  function findMineableSeparator(mapData, reservedKeys = null, criticalKeys = [], requiredHiddenKey = null) {
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
      if (criticalKeys.some(key => far.has(key) || blocked.has(key))) continue; // Preserve mandatory nest/inhabitant objectives on the entrance side.
      if (requiredHiddenKey && !far.has(requiredHiddenKey)) continue; // Optional hidden-ruin mode demands an actual wall between the entrance and its authored threshold.
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

  function installMineableSeparator(mapData, rng, blockedKeys, plan, tryHideRuin = false) {
    const critical = []; // Required encounter/transition centers that must remain reachable without mining the wall.
    if (mapData.nestCol != null && mapData.nestRow != null) {
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) critical.push(tileKey(mapData.nestCol + dc, mapData.nestRow + dr));
    }
    for (const spawn of mapData.creatureSpawns || []) critical.push(tileKey(spawn.col, spawn.row));
    const ruinKey = plan.ruinEntrance ? tileKey(plan.ruinEntrance.col, plan.ruinEntrance.row) : null; // Existing full-sized ruin threshold, not a newly improvised miniature doorway.
    // The outer rim is NOT a competing placed feature: every corridor cut has
    // solid rock at both ends, so including rim keys in distance clearance
    // rejected virtually all realistic chokepoints (the old tests lacked rims).
    const walkable = new Set(floorTiles(mapData).map(tile => tileKey(tile.col, tile.row))); // Authoritative passable cave-floor coordinates.
    const reservations = new Set([...blockedKeys].filter(key => walkable.has(key))); // Dynamic objectives/ores only; protect those without penalizing adjacent cave walls.
    // Prefer concealing a properly carved ruin portal when the rock cut genuinely
    // separates it from the player. Otherwise keep the old near-side ruin safety.
    const hiddenRuinCut = tryHideRuin && ruinKey
      ? findMineableSeparator(mapData, reservations, critical, ruinKey) : null; // Candidate must have the existing doorway in its unreachable far component.
    if (ruinKey && !hiddenRuinCut) critical.push(ruinKey);
    const separator = hiddenRuinCut || findMineableSeparator(mapData, reservations, critical);
    if (!separator) return false;
    const existing = new Set((mapData.oreRocks || []).map(rock => tileKey(rock.col, rock.row)));
    const thickWall = thickenSeparator(separator, mapData.oreRocks || [], reservations); // Shared five-layer blastable barrier for every cave history.
    const occupied = new Set([...reservations, ...existing, ...thickWall.map(tile => tileKey(tile.col, tile.row))]); // Reward clearance is measured against real objects and barrier rocks, not surrounding bedrock.
    const hidden = new Set(separator.farKeys);
    const hasRewardSpace = (hiddenRuinCut && ruinKey && hidden.has(ruinKey))
      || floorTiles(mapData).some(tile => hidden.has(tileKey(tile.col, tile.row)) && hasFeatureClearance(tile, occupied, 2)); // An existing authentic ruin doorway IS a worthwhile reward; otherwise reserve clear space for the cache/door.
    if (!hasRewardSpace) return false; // Never seal an empty or inaccessible extension.
    // The excavatable wall is plain stone; only separate cave resource mounds roll ores.
    rng(); // Consume the former wall-ore roll to preserve later seeded cave rewards and placements.
    mapData.oreRocks = [...(mapData.oreRocks || []), ...thickWall.filter(cell => !existing.has(tileKey(cell.col, cell.row))).map(cell => ({
      col: cell.col, row: cell.row, oreKind: 'stone', caveSeparator: true, caveSeparatorLayer: cell.layer,
    }))];
    for (const cell of thickWall) blockedKeys.add(tileKey(cell.col, cell.row));
    plan.separator = { col: separator.col, row: separator.row, cells: thickWall, oreKind: 'stone', nearKeys: separator.nearKeys, farKeys: separator.farKeys };
    return true;
  }

  function discardUnrewardedSeparator(mapData, blockedKeys, plan) {
    if (!plan.separator) return;
    const wallKeys = new Set(plan.separator.cells.map(cell => tileKey(cell.col, cell.row))); // Exact new mineable tiles to retract when no meaningful far-side reward fits.
    mapData.oreRocks = (mapData.oreRocks || []).filter(rock => !rock.caveSeparator || !wallKeys.has(tileKey(rock.col, rock.row)));
    for (const key of wallKeys) blockedKeys.delete(key); // Restore floor eligibility without disturbing the ordinary cave's original ore/resource placements.
    plan.separator = null; // Never leave a purposeless destructible partition in the generated map.
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
    plan.mineRocks = mapData.oreRocks.filter(rock => !rock.caveSeparator).map(rock => ({ col: rock.col, row: rock.row, oreKind: rock.oreKind })); // Excavatable stone walls do not count as ore deposits.
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

  function addPuzzleCaveLayer(mapData, candidates, blockedKeys, plan, rng) {
    // One compact, carved chamber is reserved before cave sculpting, rather than
    // placing a gate against unknown collision or accidentally clipping the rim.
    const far = sortTilesByDistance(candidates, mapData.exitCol, mapData.exitRow);
    const preferredCenter = far.find(tile => hasFeatureClearance(tile, blockedKeys, 2.2)
      && Math.hypot(tile.col-mapData.exitCol,tile.row-mapData.exitRow)>=4); // Spacious rooms retain the existing natural puzzle choices.
    const fallbackTile = !preferredCenter ? far[0] : null; // A cramped or feature-blocked cave still deserves its one solvable challenge.
    const center = preferredCenter || (fallbackTile
      ? {col:Math.max(5,fallbackTile.col),row:Math.max(5,fallbackTile.row)}
      : null); // Keep the nine-tile chamber inside positive map coordinates and attached to the furthest known floor tile.
    if (!center) return false; // A cave without any walkable floor cannot host an interaction.
    const room = {id:'puzzle-cave-chamber',col:center.col-4,row:center.row-4,width:9,depth:9};
    plan.clearanceFootprints.push(room); // The existing CavernGenerator builds the floor/ceiling/walls in one pass.
    const shape = window.CavernGenerator?.caveShape?.() || {base:1.5,full:2.5}; // Canonical ordinary height used to demand at least twice as much puzzle headroom.
    mapData.cavernTallTiles = [[center.col, center.row]]; // Raise the whole 9x9 chamber, then ease the roof back to the regular tunnel height.
    mapData.cavernPuzzleCeilingScale = Math.max(shape.full, shape.base * 2.5); // Extra headroom plus a raised minimum roof facet guarantees physical clearance, not just nominal volume height.
    const exteriorMusic = exteriorPuzzleKind(plan.profile) === 'timedMelody'; // A musical cliff gate never leads into a second music challenge.
    const prefersFire = rng() < .43; // Consume the original seeded puzzle-choice draw, preserving the downstream difficulty and reward layout.
    plan.puzzleCave = {id:'puzzle-cave:'+String(mapData.id || plan.profile.mapId),
      col:center.col,row:center.row,room,kind:!preferredCenter ? 'cavePressurePlate' : (exteriorMusic || prefersFire ? 'fireSconces' : 'timedMelody'),difficulty:1+Math.floor(rng()*5)}; // Tiny caves use one simple plate; normal chambers retain their seeded challenge variety.
    plan.puzzleTreasure={id:'puzzle-cave-reward:'+String(mapData.id||plan.profile.mapId),
      col:center.col,row:center.row+3,tier:2}; // The bronze chest occupies the deep reward alcove, with real walking space behind the unbreakable, puzzle-locked wall.
    mapData.cavePuzzleTreasure=clone(plan.puzzleTreasure); // The chest has a real tile, a visible model and a separately claimable persistent reward.
    addProp(mapData,{...plan.puzzleTreasure,key:'ruinDungeonChestT2'}); // Reveal this normal chest only after the puzzle is solved.
    for(const [col,row] of window.CavernSculptor.expandFootprint([], [room]))
      blockedKeys.add(tileKey(col,row)); // No later features or occupant spawns can obstruct the score.
    mapData.cavePuzzle = clone(plan.puzzleCave); // Diagnostics and interior tools see the same planned room.
    return true;
  }

  function addCacheLayer(mapData, rng, candidates, blockedKeys, plan, chestOnly = false, allowNearSide = false) {
    // When there is a real sealed extension, the cache must be on the far side.
    // Caves lacking a safe separator preserve the existing accessible deep-cache fallback.
    if (plan.separator) {
      if (allowNearSide) {
        const near = new Set(plan.separator.nearKeys); // Real accessible floor; never silently fall back to a blocked hidden room.
        candidates = candidates.filter(tile => near.has(tileKey(tile.col, tile.row)));
      } else candidates = extensionTiles(candidates, plan);
    } // A secondary cache's fallback chest, crates and traps all remain on the accessible side of the secret door.
    const distant = sortTilesByDistance(candidates, mapData.exitCol, mapData.exitRow, true); // Deepest chamber candidates make the cache feel intentionally hidden.
    const cacheTile = distant.find(tile => hasFeatureClearance(tile, blockedKeys, 2));
    if (!cacheTile) return false;
    blockedKeys.add(tileKey(cacheTile.col, cacheTile.row));
    plan.cache = { id: `cave_cache_${mapData.id}`, col: cacheTile.col, row: cacheTile.row, tier: 2 };
    mapData.caveCache = clone(plan.cache);
    addProp(mapData, { id: plan.cache.id, key: 'ruinDungeonChestT2', col: cacheTile.col, row: cacheTile.row, rotY: Math.floor(rng() * 4) * 90 });
    if (chestOnly) return true; // A surprise cache complements ore/crypt/mushrooms without filling the hidden room with ordinary cache traps/crates.

    const rockKeys = new Set((mapData.oreRocks || []).map(rock => tileKey(rock.col, rock.row))); // Mineable partitions are still solid walls while intact.
    const walkableKeys = new Set(floorTiles(mapData).filter(tile => !rockKeys.has(tileKey(tile.col, tile.row)))
      .map(tile => tileKey(tile.col, tile.row))); // Real wall/floor boundaries, including the secret cache's mineable wall.
    const trapCandidates = candidates.filter(tile => {
      const d = Math.hypot(tile.col - cacheTile.col, tile.row - cacheTile.row);
      return d >= 1.1 && d <= 4.5 && !blockedKeys.has(tileKey(tile.col, tile.row))
        && !!window.CaveTripwireTraps?.spanFor?.(tile, walkableKeys, rockKeys);
    }); // Each rope physically spans two rock walls; no invisible radius-only hazards.
    const trapCount = trapCandidates.length ? 1 + (rng() < 0.45 ? 1 : 0) : 0;
    plan.traps = pickSpacedTiles(rng, trapCandidates, trapCount, blockedKeys, 2).map((tile, index) => ({
      id: `${plan.cache.id}_trap_${index + 1}`, col: tile.col, row: tile.row,
      kind: 'swingingShattercask', span: window.CaveTripwireTraps.spanFor(tile, walkableKeys, rockKeys),
    }));
    mapData.caveTraps = clone(plan.traps);
    // Fill the deep chamber with mundane supplies, but leave the chest approach and traps clear.
    const crateCandidates=candidates.filter(tile=>{
      const distance=Math.hypot(tile.col-cacheTile.col,tile.row-cacheTile.row);
      return distance>=1.4&&distance<=4&&!blockedKeys.has(tileKey(tile.col,tile.row));
    });
    const crates=pickSpacedTiles(rng,crateCandidates,Math.min(4,Math.max(2,Math.floor(crateCandidates.length/3))),blockedKeys,1.15);
    for(const [index,tile] of crates.entries()) {
      const id=plan.cache.id+'_crate_'+(index+1);
      addProp(mapData,{id,key:'crateStack',col:tile.col,row:tile.row,rotY:Math.floor(rng()*4)*90});
    }
    return true;
  }

  const COFFIN_DIRECTIONS = Object.freeze([[0,1],[1,0],[0,-1],[-1,0]]); // Local +Z is the safe exit, opposite the sliding lid.
  const COFFIN_HALF_LENGTH = .83, COFFIN_HALF_WIDTH = .48; // Authored plinth 1.66 x .96.
  const COFFIN_LID_EXTENT = 1.08, COFFIN_HEIGHT = .56; // Conservative bounds for the tilted open lid.
  const COFFIN_OPEN_S = .8, COFFIN_REACH_TILES = 1.65; // Authored animation duration and interaction range.
  const COFFIN_RISE_S=.7, COFFIN_WALK_TILES_S=1.65; // Deliberate standing transition followed by ordinary walking pace.
  const COFFIN_FLOOR_Y=.0541, COFFIN_RIM_Y=.41585; // Fallback authored plinth and south-panel top for headless/late asset loads.

  function coffinOpenBounds(coffin){
    const [dc,dr]=COFFIN_DIRECTIONS[coffin.rotY/90];
    const x=coffin.col+.5,z=coffin.row+.5;
    const alongX=Math.abs(dr)*COFFIN_HALF_LENGTH,alongZ=Math.abs(dc)*COFFIN_HALF_LENGTH;
    return {minX:x-alongX+Math.min(-dc*COFFIN_LID_EXTENT,dc*COFFIN_HALF_WIDTH),maxX:x+alongX+Math.max(-dc*COFFIN_LID_EXTENT,dc*COFFIN_HALF_WIDTH),
      minZ:z-alongZ+Math.min(-dr*COFFIN_LID_EXTENT,dr*COFFIN_HALF_WIDTH),maxZ:z+alongZ+Math.max(-dr*COFFIN_LID_EXTENT,dr*COFFIN_HALF_WIDTH)};
  }

  function addCatacombLayer(mapData,rng,candidates,blockedKeys,plan){
    const target=clamp(Math.round(candidates.length/9),6,11);
    const tiles=floorTiles(mapData),floor=new Set(tiles.map(tile=>tileKey(tile.col,tile.row)));
    const components=[]; // Preserve every connected floor component, including annexes behind mineable barriers.
    const unvisited=new Set(floor);
    while(unvisited.size){const component=bfsKeys(unvisited.values().next().value,floor);components.push(component);for(const key of component)unvisited.delete(key);}
    const originalBlocked=new Set(blockedKeys);
    const eligible=candidates.filter(tile=>{
      if(!hasFeatureClearance(tile,originalBlocked,1.4))return false;
      for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++)if(!floor.has(tileKey(tile.col+dc,tile.row+dr)))return false;
      return true;
    });
    const hidden=extensionTiles(eligible,plan);
    function layout(random){
      const chosen=[],reserved=new Set(originalBlocked),occupied=new Set(); // Occupied includes the lid's maximum sweep at walking clearance.
      function place(pool,limit){
        pool=[...pool];
        while(pool.length&&chosen.length<limit){
          const tile=pool.splice(Math.floor(random()*pool.length),1)[0];
          if(reserved.has(tileKey(tile.col,tile.row)))continue;
          const directions=COFFIN_DIRECTIONS.map(([dc,dr],i)=>({dc,dr,i}));
          const offset=Math.floor(random()*directions.length);
          for(let attempt=0;attempt<directions.length;attempt++){
            const {dc,dr,i}=directions[(offset+attempt)%directions.length];
            const coffin={id:'cave_coffin_'+(chosen.length+1),col:tile.col,row:tile.row,rotY:i*90,exitCol:tile.col+dc,exitRow:tile.row+dr};
            const bounds=coffinOpenBounds(coffin);
            if(chosen.some(other=>{const b=coffinOpenBounds(other);return bounds.minX<b.maxX+.05&&bounds.maxX>b.minX-.05&&bounds.minZ<b.maxZ+.05&&bounds.maxZ>b.minZ-.05;}))continue;
            const open={openedCoffins:[coffin.id]},footprint=[];
            for(let x=tile.col-1;x<=tile.col+1;x++)for(let z=tile.row-1;z<=tile.row+1;z++)
              if(coffinBlocksBox(coffin,open,x+.5,z+.5,.32,null))footprint.push(tileKey(x,z));
            if(footprint.some(key=>reserved.has(key)))continue; // Do not cover another tomb, exit, mineral, nest or reserved escape.
            const exits=[{col:coffin.exitCol,row:coffin.exitRow},
              {col:coffin.exitCol+dr,row:coffin.exitRow-dc},{col:coffin.exitCol-dr,row:coffin.exitRow+dc}]
              .filter(p=>floor.has(tileKey(p.col,p.row))&&!reserved.has(tileKey(p.col,p.row))&&!footprint.includes(tileKey(p.col,p.row)));
            if(!exits.length||exits[0].col!==coffin.exitCol||exits[0].row!==coffin.exitRow)continue;
            const nextOccupied=new Set([...occupied,...footprint]);
            if(components.some(component=>{
              const remaining=[...component].filter(key=>!nextOccupied.has(key));
              return remaining.length&&bfsKeys(remaining[0],component,nextOccupied).size!==remaining.length;
            }))continue; // Opening every lid must still leave a continuous route around the tombs.
            coffin.exits=exits.slice(0,2); // Reserve a second emergence tile when possible so the player need not move off the primary one.
            chosen.push(coffin);
            for(const key of footprint){occupied.add(key);reserved.add(key);}
            for(const p of coffin.exits)reserved.add(tileKey(p.col,p.row));
            break;
          }
        }
      }
      place(hidden,1);
      place(eligible,target);
      return {chosen,reserved};
    }
    let best=layout(rng);
    for(let attempt=1;attempt<7&&best.chosen.length<target;attempt++){
      const candidate=layout(makeRng(mapData.id+':coffin-layout:'+attempt));
      if(candidate.chosen.length>best.chosen.length)best=candidate;
    }
    const chosen=best.chosen;
    for(const key of best.reserved)blockedKeys.add(key);
    plan.coffins=chosen;
    for(const coffin of chosen)addProp(mapData,{id:coffin.id,key:'ruinSanctumCoffin',col:coffin.col,row:coffin.row,rotY:coffin.rotY});
    const occupied=Math.min(10,chosen.length>=6?chosen.length-1:chosen.length);
    plan.bodies=chosen.slice(0,occupied).map((coffin,index)=>({
      id:'cave_body_'+(index+1),coffinId:coffin.id,col:coffin.col,row:coffin.row,
      yaw:coffin.rotY*Math.PI/180,exitCol:coffin.exitCol,exitRow:coffin.exitRow,exits:coffin.exits,
    }));
    mapData.caveBodies=clone(plan.bodies);
  }

  function coffinProgress(coffin,state) {
    if(!coffin)return 1;
    if(Number.isFinite(coffin.openStartedAt))return clamp((caveClock-coffin.openStartedAt)/COFFIN_OPEN_S,0,1);
    return (state.openedCoffins||[]).includes(coffin.id)?1:0;
  }

  function coffinForBody(plan,body){return plan.coffins.find(coffin=>coffin.id===body.coffinId);}

  function restoreCoffinState(plan,state) {
    // Old saves only recorded searched bodies. Retain their spent rewards and reveal those lids.
    for(const body of plan.bodies||[])if((state.lootedBodies||[]).includes(body.id)){
      state.openedCoffins||=[];
      if(!state.openedCoffins.includes(body.coffinId))state.openedCoffins.push(body.coffinId);
    }
  }

  function coffinSupportId(mapId,coffin,partId){return 'cave-coffin:'+mapId+':'+coffin.id+':'+partId;}

  function registerCoffinSupports(mapId,coffin,group,data,state){
    const api=window.HobunjiWalkableElevation;
    const parts=data.parts||[]; // Same authored geometry as the visible coffin; register floor and individual rims, not a fictitious solid deck.
    const [dc,dr]=COFFIN_DIRECTIONS[coffin.rotY/90];
    const floor=parts.find(p=>p.id==='plinth')?.transform;
    if(floor)coffin.floorY=Number(floor.y)+Number(floor.sy)/2;
    coffin.solidParts=[]; // Finite-height collision uses the same authored bounds as walkable support.
    for(const part of parts){
      const p=part.transform,id=coffinSupportId(mapId,coffin,part.id);
      if(!p)continue;
      const x=coffin.col+.5+p.x*dr+p.z*dc,z=coffin.row+.5-p.x*dc+p.z*dr;
      const hx=(Math.abs(dr)*p.sx+Math.abs(dc)*p.sz)/2,hz=(Math.abs(dc)*p.sx+Math.abs(dr)*p.sz)/2;
      const bounds={minX:x-hx,maxX:x+hx,minZ:z-hz,maxZ:z+hz,baseY:p.y-p.sy/2,topY:p.y+p.sy/2};
      coffin.solidParts.push({id:part.id,...bounds});
      if(part.id==='lid'&&(state.openedCoffins||[]).includes(coffin.id)){api?.unregister?.(id);continue;}
      api?.registerBox?.(bounds,{id,kind:'cave-coffin',area:mapId,owner:group,sourceId:coffin.id,sourceKey:'ruinSanctumCoffin'});
    }
    const motion=data.puzzle?.motion?.parts?.lid?.on; // Tilted lid's conservative world-space bounds.
    if(motion){
      const angle=motion.rx*Math.PI/180,hx=motion.sx/2,hz=Math.abs(Math.cos(angle))*motion.sz/2+Math.abs(Math.sin(angle))*motion.sy/2;
      const hy=Math.abs(Math.cos(angle))*motion.sy/2+Math.abs(Math.sin(angle))*motion.sz/2;
      const x=coffin.col+.5+motion.x*dr+motion.z*dc,z=coffin.row+.5-motion.x*dc+motion.z*dr;
      const wx=Math.abs(dr)*hx+Math.abs(dc)*hz,wz=Math.abs(dc)*hx+Math.abs(dr)*hz;
      coffin.openLidBounds={minX:x-wx,maxX:x+wx,minZ:z-wz,maxZ:z+wz,baseY:motion.y-hy,topY:motion.y+hy};
    }
    coffin.supportParts=parts.map(p=>p.id); // Used to unregister every surface during cave renewal or rebuild.
  }

  function unregisterCoffinSupports(mapId,plan){
    for(const coffin of plan?.coffins||[])for(const part of coffin.supportParts||[])
      window.HobunjiWalkableElevation?.unregister?.(coffinSupportId(mapId,coffin,part));
  }

  function coffinFloorY(coffin){return Number.isFinite(coffin?.floorY)?coffin.floorY:COFFIN_FLOOR_Y;}

  function syncCoffinVisual(mapId,coffin,state) {
    const group=propMeshesByMapId.get(mapId)?.groups?.get(coffin.id);
    const progress=coffinProgress(coffin,state);
    if(!group||group.userData.caveCoffinProgress===progress)return;
    const motion=group.userData.caveCoffinMotion;
    const lid=group.userData.puzzlePartMeshes?.get?.('lid')||group.userData.meshById?.get?.('lid');
    if(lid&&motion?.off&&motion?.on){
      const a=motion.off,b=motion.on; // Shipped furniture asset defines actual travel and tilt.
      const lerp=key=>Number(a[key])+(Number(b[key])-Number(a[key]))*progress;
      lid.position.set(lerp('x'),lerp('y'),lerp('z'));
      lid.rotation.set(lerp('rx')*Math.PI/180,lerp('ry')*Math.PI/180,lerp('rz')*Math.PI/180);
      lid.updateMatrixWorld?.(true);
    }
    group.userData.caveCoffinProgress=progress;
  }

  function coffinBlocksBox(coffin,state,x,z,half,worldY) {
    const opened=(state.openedCoffins||[]).includes(coffin.id);
    if(worldY!=null&&coffin.solidParts?.length){
      const overlaps=b=>worldY>=b.baseY&&worldY<=b.topY&&x+half>b.minX&&x-half<b.maxX&&z+half>b.minZ&&z-half<b.maxZ;
      if(coffin.solidParts.some(b=>(b.id!=='lid'||!opened)&&overlaps(b)))return true;
      if(opened&&coffin.openLidBounds){
        const b=coffin.openLidBounds,closed=coffin.solidParts.find(part=>part.id==='lid');
        // While sliding, reserve the whole swept envelope; afterward use the actual displaced lid.
        if(Number.isFinite(coffin.openStartedAt)&&closed)return overlaps({minX:Math.min(b.minX,closed.minX),maxX:Math.max(b.maxX,closed.maxX),minZ:Math.min(b.minZ,closed.minZ),maxZ:Math.max(b.maxZ,closed.maxZ),baseY:Math.min(b.baseY,closed.baseY),topY:Math.max(b.topY,closed.topY)});
        return overlaps(b);
      }
      return false;
    }
    if(worldY!=null&&worldY>COFFIN_HEIGHT)return false;
    const dx=x-(coffin.col+.5),dz=z-(coffin.row+.5);
    const [dc,dr]=COFFIN_DIRECTIONS[Math.round(coffin.rotY/90)%4];
    const along=dx*dr-dz*dc,across=dx*dc+dz*dr;
    return Math.abs(along)<COFFIN_HALF_LENGTH+half&&across<COFFIN_HALF_WIDTH+half&&across>-(opened?COFFIN_LID_EXTENT:COFFIN_HALF_WIDTH)-half;
  }

  function openCoffin(mapId,coffin,state) {
    if(!coffin||Number.isFinite(coffin.openStartedAt)||(state.openedCoffins||[]).includes(coffin.id))return false;
    const tile=Number(wildlifeDeps?.TILE)||32;
    const opened={openedCoffins:[coffin.id]}; // Test the full lid sweep before making it solid.
    function wouldTrap(actor,half){
      return actor&&Number.isFinite(actor.x)&&Number.isFinite(actor.y)&&
        coffinBlocksBox(coffin,opened,actor.x/tile,actor.y/tile,half,null)&&
        !coffinBlocksBox(coffin,state,actor.x/tile,actor.y/tile,half,null);
    }
    const player=wildlifeDeps?.player; // A closed lid is now a real walkable support: don't pull it out from beneath the player.
    const lid=coffin.solidParts?.find(part=>part.id==='lid');
    if(lid&&player&&Number.isFinite(player.physicalFeetY)&&Math.abs(player.physicalFeetY-lid.topY)<.08&&
      player.x/tile>=lid.minX-.12&&player.x/tile<=lid.maxX+.12&&player.y/tile>=lid.minZ-.12&&player.y/tile<=lid.maxZ+.12)return false;
    if(wouldTrap(player,.3))return false;
    for(const set of [wildlifeDeps?.hostileObjects,wildlifeDeps?.companionObjects])
      for(const actor of set||[])if(actor.areaId===mapId&&actor.health>0&&wouldTrap(actor,.32))return false; // Do not trap another cave inhabitant under a moving lid.
    for(const record of bodiesByMapId.get(mapId)||[])if(record.emergence&&wouldTrap(record.entity,.32))return false; // Staged actors are not in the hostile registry yet.
    coffin.openStartedAt=caveClock;
    state.openedCoffins||=[];
    state.openedCoffins.push(coffin.id);
    window.HobunjiWalkableElevation?.unregister?.(coffinSupportId(mapId,coffin,'lid')); // A moving lid cannot remain an invisible standing surface.
    const group=propMeshesByMapId.get(mapId)?.groups?.get(coffin.id);
    window.RuinInteractionAudio?.activator?.(group||null,{size:1.58,position:{x:coffin.col+.5,y:.4,z:coffin.row+.5}}); // Same cue as a successful ruin push block.
    persistState(true);
    return true;
  }

  function registerCoffinCollision(mapId,plan,state) {
    const id='cave-coffins:'+mapId;
    window.AreaFootprintBlockers?.remove?.(id);
    if(!plan?.coffins?.length)return;
    window.AreaFootprintBlockers?.register?.(id,{area:mapId,
      enabled:()=>plansByMapId.get(mapId)===plan, // Reject a stale scene's provider after plan replacement.
      blocksBox:(x,z,half,worldY)=>{
        const current=runtimeStateBySignature.get(plan.profile.signature)||state; // Save restore can replace a state object without rebuilding its scene.
        return plan.coffins.some(coffin=>coffinBlocksBox(coffin,current,x,z,half,worldY));
      },
    }); // Cached footprint data; no scene traversal.
  }

  function setBodySealed(entity,sealed) {
    entity._caveCoffinSealed=sealed;
    if(entity.avatarRef?.group)entity.avatarRef.group.visible=!sealed;
    if(entity.groundShadow)entity.groundShadow.visible=false;
    const corpses=devSpawnerDeps?.corpseObjects;
    if(sealed)corpses?.delete?.(entity);
    else corpses?.add?.(entity);
  }

  function caveMushroomKeys(zoneId, signature, count) {
    const defs = window.AlchemySystem?.REAGENT_DEFS; // One shared alchemy catalog defines every cave fungus, pigment, habitat and reaction.
    const keys = (window.AlchemySystem?.reagentsForZone?.(zoneId) || [])
      .filter(key => defs?.[key]?.form === 'mushroom'); // Never roll grass-like wild herbs as cave mushrooms.
    if (!keys.length) return Array(count).fill(MUSHROOM_REAGENT_KEY); // Headless tests and older preview tools retain the established Duskcap.
    const rng = makeRng(`${signature}:cave-mushroom-species`); // Dedicated stream preserves original cave floor placement/treasure.
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)); // Deterministic Fisher-Yates guarantees every local fungus appears before repeats.
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return Array.from({length: count}, (_, i) => keys[i % keys.length]); // Each large mushroom cave has several actual distinct native species.
  }

  function addMushroomLayer(mapData, rng, candidates, blockedKeys, plan) {
    const count = clamp(Math.round(candidates.length / 9), 6, 12); // Cluster count scaled to the cave, bounded for mobile scene cost.
    const hidden = pickSpacedTiles(rng, extensionTiles(candidates, plan), 1, blockedKeys, 1.6); // Secret grotto is worth finding.
    const tiles = [...hidden, ...pickSpacedTiles(rng, candidates, count - hidden.length, blockedKeys, 1.6)];
    const mushroomKeys = caveMushroomKeys(plan.profile.zoneId, plan.profile.signature, tiles.length); // All patches use their parent wilderness biome's native species.
    plan.mushrooms = tiles.map((tile, index) => ({ id: `cave_mushroom_${index + 1}`, col: tile.col, row: tile.row, reagentKey: mushroomKeys[index], size: 0.8 + rng() * 0.6 }));
    mapData.caveMushrooms = clone(plan.mushrooms);
  }

  // Optional second activity for the portions of ordinary caves not already
  // occupied by the den, original contents, a sealed-room reward or a bandit.
  // Reuse the normal ore and mushroom records: there is no new runtime entity,
  // renderer, save flag, cave entrance, or per-frame work.
  function addSecondaryPocket(mapData, profile, candidates, blockedKeys, plan) {
    if (profile.contents === TYPES.PUZZLE_CAVE) return;
    const rng = makeRng(`${profile.signature}:secondary-pocket`); // Independent seed means existing primary cave loot and encounters do not reshuffle.
    if (rng() >= SECONDARY_POCKET_CHANCE) return;
    const rockKeys = new Set((mapData.oreRocks || []).map(rock => tileKey(rock.col, rock.row))); // Natural rocks and mineable walls are already occupied.
    const reserved = new Set([...blockedKeys, ...rockKeys]); // Do not place resources on another feature or an animal nest.
    const near = plan.separator ? new Set(plan.separator.nearKeys) : null; // Secondary rewards remain reachable before mining any secret separator.
    const clearanceBlocked = new Set(); // One-time 2-tile dilation of reserved floor: O(reservations), not O(candidates × reservations) string parses.
    for (const key of reserved) {
      const [col, row] = key.split(',').map(Number);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      for (let dy = Math.floor(row) - 2; dy <= Math.ceil(row) + 2; dy++)
        for (let dx = Math.floor(col) - 2; dx <= Math.ceil(col) + 2; dx++)
          if (Math.hypot(dx - col, dy - row) < 2) clearanceBlocked.add(tileKey(dx,dy));
    }
    const free = candidates.filter(tile => (!near || near.has(tileKey(tile.col, tile.row)))
      && !clearanceBlocked.has(tileKey(tile.col, tile.row)));
    if (free.length < MIN_SECONDARY_POCKET_TILES) return;
    const count = clamp(Math.floor(free.length / 35), 2, 4); // A small pocket, not a second full-density ore field or mushroom forest.
    const freeByKey = new Map(free.map(tile => [tileKey(tile.col, tile.row), tile])); // Reachable, unoccupied floor for bounded one-room flood fills.
    const anchors = [...free]; // One-time deterministic Fisher-Yates trial order, independent from original cave generation.
    for (let i = anchors.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [anchors[i], anchors[j]] = [anchors[j], anchors[i]];
    }
    let tiles = []; // Best reachable local cluster, never resources scattered across unrelated cave branches.
    for (const anchor of anchors.slice(0, SECONDARY_POCKET_ANCHOR_ATTEMPTS)) {
      const queue = [anchor], visited = new Set([tileKey(anchor.col, anchor.row)]); // Four-neighbor flood fill cannot cross unwalkable gaps or reserved objectives.
      for (let i = 0; i < queue.length; i++) {
        const here = queue[i];
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const col = here.col + dx, row = here.row + dy, key = tileKey(col,row);
          if (visited.has(key) || Math.hypot(col - anchor.col, row - anchor.row) > SECONDARY_POCKET_RADIUS_TILES) continue;
          const tile = freeByKey.get(key);
          if (!tile) continue;
          visited.add(key);
          queue.push(tile);
        }
      }
      if (queue.length < 8) continue; // Narrow leftover slivers should not masquerade as a distinct gathering room.
      const trial = pickSpacedTiles(rng, queue, count, new Set(reserved), 2.2); // Copies reservations because each trial must be independent.
      if (trial.length > tiles.length) tiles = trial;
      if (tiles.length >= count) break;
    }
    if (tiles.length < 2) return; // A one-rock outlier is not a second cave activity.
    const kind = [TYPES.ORE_MINE, TYPES.CATACOMB, TYPES.RUIN_ENTRANCE].includes(profile.contents) ? 'mushrooms' : 'ore';
    if (kind === 'mushrooms') {
      const mushroomKeys = caveMushroomKeys(profile.zoneId, profile.signature + ':secondary', tiles.length); // Additional rooms use the same native fungus catalog.
      plan.mushrooms.push(...tiles.map((tile, index) => ({
        id: `cave_secondary_mushroom_${index + 1}`, col: tile.col, row: tile.row,
        reagentKey: mushroomKeys[index], size: 0.8 + rng() * 0.6,
      })));
      mapData.caveMushrooms = clone(plan.mushrooms); // Existing regrowth and harvest code owns both primary and secondary clusters.
    } else {
      const rocks = tiles.map(tile => ({ col: tile.col, row: tile.row, oreKind: mineOreKind(rng) })); // Existing mining interaction/loot path.
      mapData.oreRocks = [...(mapData.oreRocks || []), ...rocks];
      plan.mineRocks.push(...rocks.map(rock => ({ ...rock })));
    }
    for (const tile of tiles) blockedKeys.add(tileKey(tile.col, tile.row)); // Shared object footprint avoids later feature overlap if layer ordering changes.
    plan.secondaryPocket = { kind, count: tiles.length }; // Mobile debug field without a new gameplay/save subsystem.
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
  // Mushroom clusters reuse ReagentPlants' dedicated mushroom.png materials,
  // three crossed sprites per tile; harvested clusters follow the original regrowth window.
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
    const trapProfile = sitesByMapId.get(String(mapId)); // Save identity shared with hidden-cache lockpicking and trap one-shot flags.
    window.CaveTripwireTraps?.build?.(mapId, mapData, scene, trapProfile ? stateFor(trapProfile) : null);
    buildMushroomClusters(mapId, mapData, scene);
    buildPuzzleCaveChallenge(mapId,mapData,scene); // Puzzle rooms are physical challenges, not authored furniture-only props.
    const id = String(mapId); // Shared key with the mushroom index and cave profile.
    const propRecord = { scene, groups: new Map() }; // Replaced on rebuild; late async furniture loads cannot register in a stale cave.
    for(const [propId,group] of propMeshesByMapId.get(id)?.groups||[])if(group.userData?.caveSiteProp?.key==='crateStack')
      window.CratePiles?.unregisterPile?.(id,propId);
    propMeshesByMapId.set(id, propRecord);
    const plan=plansByMapId.get(id),state=trapProfile?stateFor(trapProfile):null;
    if(plan&&state){unregisterCoffinSupports(id,plan);restoreCoffinState(plan,state);registerCoffinCollision(id,plan,state);}
    const A = window.AuthoredFurniture;
    if (!A?.load || !A?.buildGroup || !scene || !mapData?.caveProps?.length) return Promise.resolve(0);
    return Promise.all(mapData.caveProps.map(prop => Promise.resolve(A.load(prop.key)).then(data => {
      if (!data || propMeshesByMapId.get(id) !== propRecord) {
        if (!data) window.__farmLog?.(`[cave-sites] prop ${prop.key} has no authored data.`, 'warn');
        return 0;
      }
      const group = A.buildGroup(prop.alwaysOpen ? {...data,puzzle:null} : data);
      if(prop.alwaysOpen) {
        const slab = group.userData?.meshById?.get?.('cliff_door_slab'); // Hidden stone door is already open after the surrounding mineable wall is cleared.
        const openPose = data.puzzle?.motion?.parts?.cliff_door_slab?.on;
        if(slab && openPose) {slab.position.y = openPose.y;slab.scale.z = openPose.sz;}
      }
      group.position.set(prop.col + 0.5 + (Number(prop.offsetX)||0), 0, prop.row + 0.5 + (Number(prop.offsetZ)||0)); // Secret rock doors offset away from mined walls; other furniture stays at its authored tile centre.
      group.rotation.y = (Number(prop.rotY) || 0) * Math.PI / 180;
      group.scale.set(Number(prop.scaleX) || 1, 1, Number(prop.scaleZ) || 1); // Ruin rear tunnels extend into the solid rim while fitting the three-tile doorway width.
      group.userData.caveSiteProp = { mapId, id: prop.id, key: prop.key };
      scene.add(group);
      propRecord.groups.set(prop.id, group); // Only actual, scene-attached props become candidate Sense Mode targets.
      if(prop.key==='ruinSanctumCoffin'&&plan&&state){
        group.userData.caveCoffinMotion=data.puzzle?.motion?.parts?.lid;
        const coffin=plan.coffins.find(item=>item.id===prop.id);
        if(coffin){registerCoffinSupports(id,coffin,group,data,state);syncCoffinVisual(id,coffin,state);}
      }
      if(prop.id===plansByMapId.get(id)?.puzzleTreasure?.id)syncPuzzleTreasureVisual(id); // Late-loaded chests obey the already saved solve/claim state.
      if(prop.key==='crateStack'){
        const profile=sitesByMapId.get(id); // Cache cave crate counts in its existing world-save state.
        const saved=profile?stateFor(profile):null;
        const count=saved?.crateCounts?.[prop.id]??prop.crateCount??3;
        window.CratePiles?.registerPile?.({id:prop.id,mapId:id,group,scene,lootable:true,persistViaParent:true,
          count,onChange:remaining=>{
            prop.crateCount=remaining;
            if(saved){saved.crateCounts||={};saved.crateCounts[prop.id]=remaining;persistState(true);}
          },
        });
      }
      return 1;
    }))).then(built => built.reduce((sum, n) => sum + n, 0));
  }

  function syncPuzzleTreasureVisual(mapId) {
    const profile=sitesByMapId.get(String(mapId)),plan=plansByMapId.get(String(mapId)); // Live cave reward is identified by its own plan, not ordinary cache-open state.
    if(!profile||!plan?.puzzleTreasure)return;
    const chest=propMeshesByMapId.get(String(mapId))?.groups?.get(plan.puzzleTreasure.id);
    if(chest)chest.visible=!!stateFor(profile).puzzleSolved&&!stateFor(profile).puzzleRewardClaimed;
  }

  function grantPuzzleCaveReward(profile, plan, state) {
    if(!state.puzzleSolved||state.puzzleRewardClaimed)return false;
    const defs=window.TrinketSystem?.DEFINITIONS||{}; // Source of truth from the benefit/drawback trinket PR.
    const entries=window.LootRolling?.getLootPools?.()?.puzzleCave?.entries||[];
    const tier=Number(state.puzzleRewardTier)||1;
    const available=entries.some(entry=>Number(entry.tier)===tier && defs[String(entry.itemKey||'').replace(/^trinket_/,'')]);
    if(!available||typeof window.TrinketSystem?.claimLoot!=='function'){
      if(!state.puzzleRewardPending){
        state.puzzleRewardPending=true; // Never spend a solved cave's reward before the actual benefit/drawback trinkets can be granted.
        persistState(true);
        wildlifeDeps?.showToast?.('Puzzle Cave treasure is sealed until its trinkets are available.',false);
        window.__farmLog?.('[puzzle-cave] reward pending registered trinket tier '+tier,'warn');
      }
      return false; // Reentering a cave must not endlessly rewrite saves or spam diagnostics while the parent PR is absent.
    }
    try{
      const gained=window.LootRolling?.rollLootPool?.('puzzleCave',{rewardTier:tier,zoneId:profile.zoneId})||{};
      if(!Object.keys(gained).length)return false;
      const parts=window.TrinketSystem.claimLoot(gained,'puzzleCave')||[];
      if(!parts.length)return false; // Retry after inventory support becomes available; do not consume reward.
      state.puzzleRewardClaimed=true;state.puzzleRewardPending=false;
      persistState();
      syncPuzzleTreasureVisual(profile.mapId); // Consuming the reward hides the single authored chest without removing unrelated cache meshes.
      wildlifeDeps?.showToast?.('Puzzle Cave treasure: '+parts.join(', '),true);
      return true;
    }catch(error){
      if(!state.puzzleRewardPending){state.puzzleRewardPending=true;persistState(true);}
      window.__farmLog?.('[puzzle-cave] treasure delivery failed; saved as pending: '+String(error?.message||error),'warn');
      return false; // A failed gear/save integration never consumes the cave's earned reward.
    }
  }

  function buildPuzzleCaveChallenge(mapId,mapData,scene) {
    const key=String(mapId);
    const previous=puzzleChallengesByMapId.get(key);
    if(previous){previous.challenge?.dispose?.();puzzleChallengesByMapId.delete(key);}
    const plan=plansByMapId.get(key),profile=sitesByMapId.get(key);
    if(!plan?.puzzleCave||!profile||!scene)return null;
    const creator=window.RuinLayerChallenges?.compose;
    if(typeof creator!=='function'){
      window.__farmLog?.('[puzzle-cave] RuinLayerChallenges is unavailable while building '+key,'warn');
      return null;
    }
    const puzzle=plan.puzzleCave;
    const state=stateFor(profile);
    const room={x:puzzle.col+.5-4.5,z:puzzle.row+.5-4.5,w:9,d:9}; // One 9x9 carved cave chamber, centered on the actual floor tile.
    const exteriorMusic = exteriorPuzzleKind(profile) === 'timedMelody'; // Enforce different interior/exterior puzzle mechanics even on restored or legacy maps.
    const musicAvailable = typeof window.PuzzleCaveMelody?.generate === 'function' && typeof window.PuzzleCaveMelody?.createSession === 'function';
    const fireAvailable = typeof window.PersistentGroundFire?.intersects === 'function'; // Use the existing active-area fire hit-test; absent fire support must fall back to the one-step plate before mounting a gate.
    let kind = puzzle.kind; // The available runtime may substitute another puzzle without changing the cave's persisted layout seed.
    if (kind === 'timedMelody' && (exteriorMusic || !musicAvailable)) kind = 'cavePressurePlate'; // Do not substitute fire: melody maps need not contain the two guaranteed flame charges.
    if (kind === 'fireSconces' && !fireAvailable) kind = 'cavePressurePlate'; // No working fire runtime must never make the cave reward unobtainable.
    if (!['timedMelody','fireSconces','cavePressurePlate'].includes(kind)) kind = 'cavePressurePlate';
    try {
      const compose = challengeKind => creator({
        THREE:window.THREE,parent:scene,room,id:puzzle.id,kind:challengeKind,y:0,area:key,authoredCliffDoor:true,
        caveRoofHeight:Math.max(9,Number(mapData.mesh?.vaultCeiling?.topY)||0), // Seals the sculpted wall up to the new vaulted ceiling instead of leaving a jumpable gap.
        songOptions:{difficulty:puzzle.difficulty}, // Deterministic 1–2-measure challenge range, not a universal easy one-measure song.
        isActive:()=>String(wildlifeDeps?.getCurrentArea?.()||'')===key && puzzleChallengesByMapId.get(key)?.scene===scene,
        onSolved:()=>{
          state.puzzleSolved=true;
          state.puzzleRewardTier=Math.max(Number(state.outdoorPuzzleTier)||1,challenge.song?.rewardTier||2); // Outside song difficulty also influences the exclusive cave reward.
          persistState();
          syncPuzzleTreasureVisual(key); // The gated chest appears where the slab just opened, rather than granting invisible loot.
          wildlifeDeps?.showToast?.('Stone door opened! Claim the chest beyond it.',true);
        },
        getPlayerPosition:()=>{
          const p=wildlifeDeps?.player,t=Number(wildlifeDeps?.TILE)||32;
          return p?{x:Number(p.x)/t,z:Number(p.y)/t}:null;
        },
        getPlayerY:()=>0, // Cave interiors are flat, level-zero generated slices.
        onMusicUnavailable:()=>wildlifeDeps?.showToast?.('Equip an instrument to attempt the stone song.',false),
      });
      let challenge;
      try { challenge = compose(kind); }
      catch(error) {
        if (kind === 'cavePressurePlate') throw error;
        window.__farmLog?.('[puzzle-cave] '+kind+' unavailable; using one-step pressure plate: '+error.message,'warn');
        kind = 'cavePressurePlate'; // A broken optional puzzle can never make the cave treasure permanently inaccessible.
        challenge = compose(kind);
      }
      if(state.puzzleSolved){
        challenge.solved=true;challenge.doorRise=1;
        challenge.plateSignal?.setActive?.(true); // Restore the permanently completed plate's indicator, not just the raised physical gate.
        challenge.door.position.y+=challenge.kind==='timedMelody'?3.6:3.5; // Restore the raised slab immediately, including fallback pressure-plate caves.
        for(const sconce of challenge.sconces||[]){sconce.lit=true;sconce.flame.visible=true;} // Solved fire gates keep their lit torches after re-entry.
        syncPuzzleTreasureVisual(key); // A saved solution reveals an unclaimed chest on re-entry, but never automatically consumes it.
      }
      // RuinLayerChallenges.compose owns the ONE active-area-scoped gate blocker and
      // removes it in challenge.dispose(). Registering another here leaked an
      // always-enabled collider into other maps with matching X/Z coordinates.
      puzzleChallengesByMapId.set(key,{scene,challenge}); // Scene ownership ensures no duplicates after interior regeneration.
      return challenge;
    }catch(error){
      window.__farmLog?.('[puzzle-cave] challenge build failed: '+error.message,'warn');
      return null;
    }
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
      if ((key === 'ruinSanctumCoffin' && !(state.openedCoffins||[]).includes(group.userData.caveSiteProp.id)) || key === 'ruinEntranceDoor' ||
        (key === 'ruinDungeonChestT2' && (group.userData.caveSiteProp.id === plansByMapId.get(mapId)?.puzzleTreasure?.id
          ? state.puzzleSolved&&!state.puzzleRewardClaimed : !state.cacheOpened))) roots.push(group); // Puzzle chest is sensed only after the gate opens.
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
      banditSpawns: [], bodies: [], traps: [], coffins: [], mineRocks: [], mushrooms: [], cache: null, ruinEntrance: null, puzzleCave: null, puzzleTreasure:null,
    }; // Runtime-only plan mirrors map decorations and drives mechanics that cannot live in static building map data.
    if (profile.contents === TYPES.RUIN_ENTRANCE) addRuinLayer(mapData, rng,
      allTiles.filter(tile => Math.hypot(tile.col - Number(mapData.exitCol), tile.row - Number(mapData.exitRow)) >= 3), blockedKeys, plan);
    if (profile.contents === TYPES.PUZZLE_CAVE)
      addPuzzleCaveLayer(mapData, allTiles, blockedKeys, plan, rng); // Dedicated cave gets its one challenge; ordinary caves may have separate hidden doors.
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
    const wantsRockPuzzle = contents !== TYPES.PUZZLE_CAVE && awayFromEntrance.length >= MIN_OPTIONAL_EXTENSION_FLOOR
      && makeRng(profile.signature + ':puzzle-rock-roll')() < ROCK_PUZZLE_CHANCE; // Independent of ordinary cave contents and inhabitants.
    if (contents !== TYPES.PUZZLE_CAVE && (wantsRockPuzzle || contents === TYPES.TRAPPED_CACHE || (awayFromEntrance.length >= MIN_OPTIONAL_EXTENSION_FLOOR && extensionRng() < (EXTENSION_CHANCES[contents] || 0)))) {
      const hideRuin = contents === TYPES.RUIN_ENTRANCE && !!plan.ruinEntrance
        && makeRng(`${profile.signature}:secret-ruin-roll`)() < 0.65; // Stable hidden-ruin choice, independent of ordinary cave encounter/loot rolls.
      installMineableSeparator(mapData, extensionRng, blockedKeys, plan, hideRuin);
    }
    const hiddenRuin = !!(plan.separator && plan.ruinEntrance
      && plan.separator.farKeys.includes(tileKey(plan.ruinEntrance.col, plan.ruinEntrance.row))); // The real ruin door itself already fulfills the destructible wall's discovery promise.
    // Reserve the secret destination BEFORE mushrooms, ore, bodies or bandits take its floor.
    // Hidden Puzzle Caves are the existing 80% roll; every other mined partition earns
    // a full chest rather than relying on mundane resource rolls beyond the rock wall.
    if (wantsRockPuzzle && plan.separator && !hiddenRuin) {
      const far = new Set(plan.separator.farKeys); // Only the rock wall's hidden side can contain the secret doorway.
      const rocks = new Set((mapData.oreRocks || []).map(rock => tileKey(rock.col,rock.row)));
      const wall = plan.separator.cells; // Existing five-layer mining barrier protects the puzzle entrance.
      const candidates = awayFromEntrance.filter(tile =>
        far.has(tileKey(tile.col,tile.row)) && !rocks.has(tileKey(tile.col,tile.row))
        && hasFeatureClearance(tile,blockedKeys,1.55)
        && !(mapData.exits || []).some(exit => (exit.tiles || []).some(pair => tileKey(pair[0],pair[1]) === tileKey(tile.col,tile.row)))
      ).sort((a,b) => {
        const distanceToWall = tile => Math.min(...wall.map(c => (tile.col-c.col)**2+(tile.row-c.row)**2));
        return distanceToWall(a)-distanceToWall(b) || a.col-b.col || a.row-b.row;
      });
      if(candidates.length) {
        const tile = candidates[0]; // First safe supported far-side floor tile, adjacent to the mined-through chamber.
        const child = registerRockPuzzleSite(profile,tile); // Dedicated puzzle map; ordinary cave loot and occupancy remain untouched.
        const nearestRock = wall.slice().sort((a,b) =>
          ((a.col-tile.col)**2+(a.row-tile.row)**2)-((b.col-tile.col)**2+(b.row-tile.row)**2))[0]; // Model faces the mineable barrier rather than an arbitrary compass direction.
        const facing = nearestRock ? Math.atan2(nearestRock.col-tile.col,nearestRock.row-tile.row)*180/Math.PI+180 : 0; // Local +Z of cliffDoor faces the room, away from the mined rock face.
        plan.puzzleDoor = {id:'rock-puzzle-door-'+child.denId,col:tile.col,row:tile.row,targetMapId:child.mapId};
        mapData.exits.push({
          id:plan.puzzleDoor.id,label:'Hidden Stone Door',tiles:[[tile.col,tile.row]],
          targetMap:child.mapId,targetSpotId:'den_exit',spawnCol:0,spawnRow:0,generateDoor:false, // Resolve the child's actual generated entrance instead of spawning at tile 0,0.
        }); // Native building-to-building transitions, not NPC triggers or cave replacements.
        const awayX=nearestRock?tile.col-nearestRock.col:0,awayZ=nearestRock?tile.row-nearestRock.row:0; // Normal from the mineable wall toward walkable cave floor.
        const awayLength=Math.hypot(awayX,awayZ)||1; // Protect the degenerate case of a same-cell separator while offsetting the visual.
        addProp(mapData,{id:plan.puzzleDoor.id,key:'cliffDoor',col:tile.col,row:tile.row,
          rotY:facing,offsetX:awayX/awayLength*.22,offsetZ:awayZ/awayLength*.22,alwaysOpen:true}); // Keep normal door dimensions and stand it proud of the rock, matching outdoor entrances.
        blockedKeys.add(tileKey(tile.col,tile.row));
      }
    }
    if (plan.separator && contents !== TYPES.TRAPPED_CACHE && !plan.puzzleDoor && !hiddenRuin) {
      const rewardRng = makeRng(`${profile.signature}:hidden-separator-cache`); // Independent stream keeps original cave loot and encounter rolls reproducible.
      if (!addCacheLayer(mapData, rewardRng, extensionTiles(allTiles, plan), blockedKeys, plan, true)) {
        discardUnrewardedSeparator(mapData, blockedKeys, plan); // Prefer no wall at all over blasting through stone to an empty chamber.
        window.__farmLog?.(`[cave-sites] ${mapId}: removed unrewarded partition.`, 'warn');
      }
    }
    if (contents === TYPES.ORE_MINE) addMineLayer(mapData, rng, awayFromEntrance, blockedKeys, plan);
    else if (contents === TYPES.TRAPPED_CACHE) {
      if (!addCacheLayer(mapData, rng, awayFromEntrance, blockedKeys, plan) && plan.separator) {
        if (plan.puzzleDoor) {
          // The secret door is already the guaranteed discovery. Do not erase its wall
          // merely because this cave history's *extra* cache cannot fit behind it.
          addCacheLayer(mapData, rng, awayFromEntrance, blockedKeys, plan, false, true);
        } else {
          discardUnrewardedSeparator(mapData, blockedKeys, plan); // Without any destination, retract the wall and keep an accessible cache.
          addCacheLayer(mapData, rng, awayFromEntrance, blockedKeys, plan);
        }
      }
    }
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
    if (contents===TYPES.PUZZLE_CAVE && plan.puzzleCave?.kind==='fireSconces'){
      // A single charge can ignite only one distant sconce if the player misses the
      // midpoint. Provide two expendable charges on guaranteed navigable chamber
      // floor, so Fire Flasks are an alternative rather than a softlock requirement.
      const chamber=plan.puzzleCave; // Authoritative carved room and entrance-side supply center.
      const floorKeys=new Set(allTiles.map(tile=>tileKey(tile.col,tile.row))); // New floor after CavernGenerator expanded the room.
      const rockKeys=new Set((mapData.oreRocks||[]).map(rock=>tileKey(rock.col,rock.row))); // Avoid pre-existing cave ore.
      const supplyCandidates=[
        {col:chamber.col-2,row:chamber.row-2},{col:chamber.col+2,row:chamber.row-2},
        {col:chamber.col-2,row:chamber.row-1},{col:chamber.col+2,row:chamber.row-1},
        {col:chamber.col-1,row:chamber.row-3},{col:chamber.col+1,row:chamber.row-3},
        ...sortTilesByDistance(freeChargeTiles,chamber.col,chamber.row,false),
      ]; // Spawn in front of the southern stone gate; fall back to existing unreserved cave tiles.
      for(const tile of supplyCandidates){
        if(plan.shattercasks.length>=2)break;
        const key=tileKey(tile.col,tile.row);
        if(!floorKeys.has(key)||rockKeys.has(key)||
          (mapData.exits||[]).some(exit=>(exit.tiles||[]).some(pair=>tileKey(pair[0],pair[1])===key))||
          plan.shattercasks.some(charge=>Math.hypot(charge.col-tile.col,charge.row-tile.row)<2))continue;
        plan.shattercasks.push({id:'puzzle-flame-charge-'+(plan.shattercasks.length+1),
          col:tile.col,row:tile.row,kind:'flameShattercask',guaranteed:true});
        blockedKeys.add(key); // Occupies actual cave floor; never spawned within a wall or cave exit.
      }
      if(plan.shattercasks.length<2)window.__farmLog?.(
        '[puzzle-cave] not enough clear floor for both flame charges; crafted Fire Flasks remain usable','warn');
    }
    if (contents!==TYPES.PUZZLE_CAVE && (profile.inhabitant === TYPES.BANDIT_HIDEOUT || rng()<.38) && freeChargeTiles.length) {
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

    addSecondaryPocket(mapData, profile, awayFromEntrance, blockedKeys, plan); // After all existing objectives/inhabitants so spare rooms are the only candidates.

    if(profile.contents === TYPES.PUZZLE_CAVE && Number.isFinite(mapData.exitCol) && Number.isFinite(mapData.exitRow)) {
      mapData.entrySpots = {
        ...(mapData.entrySpots || {}),
        den_exit: { col: mapData.exitCol, row: mapData.exitRow },
      }; // Cached and freshly generated Puzzle Caves use the same guaranteed-walkable SDF entrance instead of falling back to (0,0).
    }
    if(profile.contents === TYPES.PUZZLE_CAVE && profile.parentMapId && mapData.exits?.length) {
      const exit = mapData.exits[0]; // Reciprocal transition returns into the ordinary cave, not out to the wilderness.
      exit.targetMap = profile.parentMapId;
      exit.targetSpotId = 'rock-puzzle-door-' + profile.denId; // Reciprocal owner resolves the parent's hidden-door exit even after a fresh scene load.
      exit.spawnCol = Number(profile.returnCol) || 0;
      exit.spawnRow = Number(profile.returnRow) || 0;
      exit.label = 'Back to the cave';
    }

    const secret = hiddenRuin ? plan.ruinEntrance : (plan.puzzleDoor || plan.cache); // Final reward destination chosen before saving the cave plan.
    plan.hiddenReward = plan.separator && secret ? {
      id: secret.id, col: secret.col, row: secret.row,
      type: hiddenRuin ? 'ruin_entrance' : plan.puzzleDoor ? 'puzzle_cave' : 'cache',
    } : null; // Mobile debug snapshot records an actual reward, not merely the rolled cave contents.
    plan.outerRimTileCount = mapData.outerRimTiles?.length || 0;
    plan.wallHeightScale = mapData.cavernCarvedHeightScale || window.CavernGenerator?.caveShape?.().base || mapData.wallHeightScale || 1; // Peak carved height (ruin caves: at the door).

    mapData.name = window.WildlifeSpawn?.denTurnoverStateForCavern?.(mapId)?.name || 'Unexplored cave';
    mapData.caveSite = clone(profile);
    mapData.caveSitePlan = {
      shattercasks: clone(plan.shattercasks), separatorRock: plan.separator ? { col: plan.separator.col, row: plan.separator.row, cells: clone(plan.separator.cells), oreKind: plan.separator.oreKind } : null,
      banditSpawns: clone(plan.banditSpawns), bodies: clone(plan.bodies), traps: clone(plan.traps), cache: clone(plan.cache),
      coffins: clone(plan.coffins), ruinEntrance: clone(plan.ruinEntrance), puzzleCave: clone(plan.puzzleCave), puzzleDoor:clone(plan.puzzleDoor), mushrooms: clone(plan.mushrooms), mineRockCount: plan.mineRocks.length,
      extension: plan.separator ? { contentType: contents, hiddenTiles: plan.separator.farKeys.length, rewardType:plan.hiddenReward?.type || null } : null,
      secondaryPocket: plan.secondaryPocket || null, // Lightweight reuse of leftover cave floor; report for the mobile Cave Site inspector.
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
    for(const sites of outdoorPuzzleSitesByZone.values())for(const site of sites)sitesByMapId.delete(site.mapId);
    for(const site of rockPuzzleSitesByParent.values())sitesByMapId.delete(site.mapId);
    outdoorPuzzleSitesByZone.clear(); // A restored world must reroll its own cliff doors, not inherit the prior world's entrance registry.
    rockPuzzleSitesByParent.clear(); // The restored parent profiles lazily recreate the correct hidden-door identities.
    savedCaveState = saved && typeof saved === 'object' && typeof saved.identity === 'string' && saved.sites && typeof saved.sites === 'object' ? clone(saved) : null;
    stateIdentity = null; // Next access reloads from the restored payload (or the legacy key).
    runtimeStateBySignature.clear();
    for(const profiles of sitesByZone.values())for(const profile of profiles)
      if(profile.contents!==TYPES.PUZZLE_CAVE) registerRockPuzzleSite(profile); // Rebind any already-loaded parent maps to their newly restored reciprocal door state.
  }
  function init(injectedDeps) { saveDeps = injectedDeps || null; }

  function stateFor(profile) {
    ensureStateLoaded();
    if (!runtimeStateBySignature.has(profile.signature)) runtimeStateBySignature.set(profile.signature, { discovered: false, cacheOpened: false, triggeredTraps: [], occupantsCleared: false, ruinEntered: false, mushroomsPickedDay: {}, lootedBodies: [] });
    return runtimeStateBySignature.get(profile.signature);
  }

  function exteriorPuzzleState(mapId) {
    const site=sitesByMapId.get(String(mapId)); // Exterior cliff-gate and interior loot share the same persistent cave signature.
    if(!site)return {solved:false,tier:1};
    const state=stateFor(site);
    return {solved:!!state.outdoorPuzzleSolved ||
      (exteriorPuzzleKind(site)==='cavePressurePlate' && !!state.discovered),
      tier:Number(state.outdoorPuzzleTier)||1}; // Older non-music doors were automatically open; an already-entered cave stays open after the plate update.
  }

  function markExteriorPuzzleSolved(mapId,rewardTier) {
    const site=sitesByMapId.get(String(mapId)); // One solved record per generated cave incarnation, not per render.
    if(!site)return false;
    const state=stateFor(site);
    if(state.outdoorPuzzleSolved)return false;
    state.outdoorPuzzleSolved=true;
    state.outdoorPuzzleTier=Math.max(1,Math.min(5,Math.floor(Number(rewardTier)||1)));
    if(!state.puzzleRewardClaimed)state.puzzleRewardTier=Math.max(Number(state.puzzleRewardTier)||1,state.outdoorPuzzleTier);
    persistState();
    return true;
  }

  function syncTransitionLabels(zoneId) {
    if (!zoneSites(zoneId).length) return 0;
    const byMapId = sitesByMapId; // Cave lookup used to rename old den transitions without changing ids/targets.
    let changed = 0;
    const layout = zoneLayout(zoneId);
    for (const transition of layout?.transitions || []) {
      if(transition?.puzzleCaveOnly)continue; // Inert cliff-door labels never become wildlife Den-Mother cave labels.
      if (!byMapId.has(transition?.targetMapId)) continue;
      const label = window.WildlifeSpawn?.denTurnoverStateForCavern?.(transition.targetMapId)?.name || 'Unexplored cave'; // Exterior labels reveal the name only after entry.
      if (transition.label !== label) { transition.label = label; changed++; }
    }
    const info = wildlifeDeps?.zoneScenes?.get?.(zoneId);
    for (const transition of info?.transitions || []) {
      if(transition?.puzzleCaveOnly)continue; // Preserve dedicated stone-door labels in the live scene.
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

  function resetCave(mapId, options = {}) {
    ensureStateLoaded();
    const profile = sitesByMapId.get(mapId); // Old signature's discovery/loot state must not follow the relocated cave slot.
    if (profile) runtimeStateBySignature.delete(profile.signature);
    const child = rockPuzzleSitesByParent.get(mapId); // A relocated parent may not leave a walkable secret door behind.
    if(child){
      runtimeStateBySignature.delete(child.signature);
      sitesByMapId.delete(child.mapId);
      rockPuzzleSitesByParent.delete(mapId);
    }
    for (const record of bodiesByMapId.get(mapId) || []) {
      const resident = record.rising || record.entity?._caveCoffinSealed || wildlifeDeps?.hostileObjects?.has?.(record.entity) || devSpawnerDeps?.corpseObjects?.has?.(record.entity); // Wildlife renewal may already have removed this entity through the shared despawn owner.
      wildlifeDeps?.hostileObjects?.delete?.(record.entity);
      devSpawnerDeps?.corpseObjects?.delete?.(record.entity);
      if (resident) devSpawnerDeps?.despawnCreature?.(record.entity);
    }
    window.PuzzleCaveEntrances?.forgetCave?.(mapId); // A relocated cave's old elevated entrance must be retired with its old save signature.
    puzzleChallengesByMapId.get(mapId)?.challenge?.dispose?.();
    puzzleChallengesByMapId.delete(mapId); // Retire the timed puzzle's listeners and authored meshes with the cavern.
    window.CavernOreRocks?.forgetMap?.(mapId); // Tear down the fused cave wall and its mineable indices when a relocated cave is retired.
    unregisterCoffinSupports(mapId,plansByMapId.get(mapId));
    plansByMapId.delete(mapId);
    window.AreaFootprintBlockers?.remove?.('cave-coffins:'+mapId);
    window.CaveTripwireTraps?.dispose?.(mapId); // The old cave's string meshes, pendulum, and physical cask cannot survive relocation.
    bodiesByMapId.delete(mapId);
    bodySpawnPromises.delete(mapId);
    banditSpawnPromises.delete(mapId);
    banditPopulatedMaps.delete(mapId);
    for (const oldGroup of mushroomMeshesByMapId.get(mapId)?.values() || []) oldGroup.parent?.remove(oldGroup);
    mushroomMeshesByMapId.delete(mapId);
    for(const [propId,group] of propMeshesByMapId.get(mapId)?.groups||[])if(group.userData?.caveSiteProp?.key==='crateStack')
      window.CratePiles?.unregisterPile?.(mapId,propId);
    propMeshesByMapId.delete(mapId); // Do not retain props for an erased or relocated cave.
    mushroomScenesByMapId.delete(mapId);
    mushroomVisualDayByMapId.delete(mapId);
    ruinTransitionMaps.delete(mapId);
    sitesByMapId.delete(mapId);
    if (!options.skipSave) persistState(); // Bulk Tothal retirement writes once after the whole set is replaced.
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
    // A tripwire releases a real hanging Burden via HangingRopes; there is no
    // direct, invisible damagePlayer trap remaining. The persistent triggeredTraps
    // ids still belong to the original cave save so revisits never re-arm one.
    window.CaveTripwireTraps?.tick?.(profile.mapId, state, wildlifeDeps?.player,
      Number(wildlifeDeps?.TILE) || 32, CAVE_RUNTIME_INTERVAL_S, () => persistState(true));
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

  // Native cave mushrooms follow the same getButtons/onAction contract as wild
  // ReagentPlants, but live on cavern tiles and are picked only when aimed at.
  function objectAt(mapId, col, row) {
    const id = String(mapId); // Used to select only this cave's authored clusters.
    const plan = plansByMapId.get(id);
    if (!plan || String(wildlifeDeps?.getCurrentArea?.() || '') !== id) return null;
    const profile = sitesByMapId.get(id); // The cave profile validates both cache and Duskcap world interactions.
    const coffin=plan.coffins?.find(item=>item.col===col&&item.row===row);
    if(profile&&coffin){
      const state=stateFor(profile);
      if(coffinProgress(coffin,state)<1&&caveDistanceTiles(coffin)<=COFFIN_REACH_TILES){
        return {id:coffin.id,type:'treasure_chest',col,row,label:'Stone Coffin',
          promptRoot:propMeshesByMapId.get(id)?.groups?.get(coffin.id)||null,
          getButtons:()=>Number.isFinite(coffin.openStartedAt)?[]:[{icon:'🪨',label:'Open Coffin',action:'obj_open_cave_coffin',style:'primary',allowed:true}],
          onAction(action){
            if(action!=='obj_open_cave_coffin'||String(wildlifeDeps?.getCurrentArea?.()||'')!==id||
              plansByMapId.get(id)!==plan||caveDistanceTiles(coffin)>COFFIN_REACH_TILES)return {ok:false,message:'The coffin is out of reach.'};
            const opened=openCoffin(id,coffin,stateFor(profile));
            return {ok:opened,message:opened?'':'Move clear of the lid or wait for it to open.',deferMemberSave:true};
          },
        };
      }
    }
    const treasure=plan.puzzleTreasure; // The physical puzzle reward has its own visible chest and one-shot claim action.
    if(profile&&treasure&&treasure.col===col&&treasure.row===row&&stateFor(profile).puzzleSolved
      &&!stateFor(profile).puzzleRewardClaimed&&caveDistanceTiles(treasure)<=CACHE_OPEN_RADIUS_TILES){
      return {
        id:treasure.id,type:'treasure_chest',col,row,label:'🎁 Puzzle Cave Treasure',
        getButtons:()=>[{icon:'🎁',label:'Claim Puzzle Treasure',action:'obj_claim_puzzle_treasure',style:'primary',allowed:true}],
        onAction(action){
          if(action!=='obj_claim_puzzle_treasure')return {ok:false,message:'Unknown action.'};
          const saved=stateFor(profile); // Validate again on button press so an old touch prompt can never duplicate gear.
          if(String(wildlifeDeps?.getCurrentArea?.()||'')!==id||plansByMapId.get(id)!==plan
            ||!saved.puzzleSolved||saved.puzzleRewardClaimed||caveDistanceTiles(treasure)>CACHE_OPEN_RADIUS_TILES)
            return {ok:false,message:'The puzzle treasure is out of reach.'};
          const claimed=grantPuzzleCaveReward(profile,plan,saved);
          return {ok:claimed,message:claimed?'':'The treasure remains sealed; check the cave diagnostics.',deferMemberSave:!claimed};
        },
      };
    }
    const cache = plan.cache; // The authored chest now requires an explicit press instead of proximity auto-loot.
    if (profile && cache && cache.col === col && cache.row === row && !stateFor(profile).cacheOpened
      && caveDistanceTiles(cache) <= CACHE_OPEN_RADIUS_TILES) {
      return {
        id: cache.id, type: 'treasure_chest', col, row, label: '🗝️ Hidden Cave Cache',
        getButtons: () => [{ icon: '🗝️', label: 'Pick Cave Cache Lock', action: 'obj_pick_cave_cache', style: 'primary', allowed: true }],
        onAction(action) {
          if (action !== 'obj_pick_cave_cache') return { ok: false, message: 'Unknown action.' };
          const valid = () => String(wildlifeDeps?.getCurrentArea?.() || '') === id
            && plansByMapId.get(id) === plan && !stateFor(profile).cacheOpened
            && caveDistanceTiles(cache) <= CACHE_OPEN_RADIUS_TILES;
          if (!valid()) return { ok: false, message: 'The cache is out of reach.' };
          const started = window.ChestLockpicking?.open?.({
            id: cache.id, title: 'Hidden Cave Cache', tier: cache.tier || 2,
            valid,
            onSuccess: () => grantCacheLoot(profile, plan, stateFor(profile)), // Keep the original saved cave loot path.
          });
          return { ok: false, message: started ? '' : 'Lockpicking unavailable.', deferMemberSave: true };
        },
      };
    }
    if (!plan.mushrooms?.length) return null;
    const mushroom = plan.mushrooms.find(item => item.col === col && item.row === row);
    if (!mushroom || caveDistanceTiles(mushroom) > MUSHROOM_INTERACT_RADIUS_TILES) return null;
    if (!profile || !mushroomAvailable(stateFor(profile), mushroom)) return null;
    const meshes = mushroomMeshesByMapId.get(id);
    if (meshes && !meshes.has(mushroom.id)) return null;
    const def = window.AlchemySystem?.REAGENT_DEFS?.[mushroom.reagentKey];
    const label = def?.label || 'Cave Mushroom';
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
          || (meshes && !meshes.has(mushroom.id))) return { ok: false, message: 'The mushroom is not ready to pick.' };
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
    restoreCoffinState(plan,state);
    const looted = new Set(state.lootedBodies || []);
    const records=[]; // Kept outside the async body so a rejected portrait build can dispose already-created occupants.
    const promise = (async () => {
      for (const body of plan.bodies) {
        const x = (body.col + 0.5) * tileSize, y = (body.row + 0.5) * tileSize;
        const entity = await makeSkeleton(mapId, x, y, { state: 'idle', caveBodyId: body.id });
        if (wildlifeDeps?.getCurrentArea?.() !== mapId || plansByMapId.get(mapId) !== plan) { if (entity) devSpawnerDeps?.despawnCreature?.(entity); break; }
        if (!entity) continue;
        const group=entity.avatarRef?.group,authoredScaleY=group?.scale?.y; // Shared corpse settling resets scale.y to one; keep the authored humanoid silhouette.
        window.CreatureDeath.settleAsCorpse(entity, { yaw: body.yaw, roll:0 });
        if(group?.scale&&Number.isFinite(authoredScaleY))group.scale.y=authoredScaleY;
        if(group?.position)group.position.y+=coffinFloorY(coffinForBody(plan,body)); // The corpse lies on the actual elevated plinth, not below it.
        if (looted.has(body.id)) entity.corpseLooted = true;
        setBodySealed(entity,coffinProgress(coffinForBody(plan,body),state)<1);
        records.push({ body, entity, riser: Math.random() < BODY_RISE_CHANCE, armedAt: null, delay: 0, rising: false, risen: false });
      }
      if(plansByMapId.get(mapId)===plan&&wildlifeDeps?.getCurrentArea?.()===mapId)bodiesByMapId.set(mapId,records);
      else for(const record of records){devSpawnerDeps?.corpseObjects?.delete?.(record.entity);devSpawnerDeps?.despawnCreature?.(record.entity);} // Leaving mid-load cannot cache a partial population.
      window.__farmLog?.(`[cave-sites] laid out ${records.length} skeleton bodies in ${mapId} (${records.filter(r => r.riser).length} restless).`, 'world');
    })().catch(error => {
      for(const record of records){devSpawnerDeps?.corpseObjects?.delete?.(record.entity);devSpawnerDeps?.despawnCreature?.(record.entity);}
      window.__farmLog?.(`[cave-sites] body spawn failed for ${mapId}: ${error.message}`, 'warn');
    })
      .finally(() => { if (bodySpawnPromises.get(mapId) === promise) bodySpawnPromises.delete(mapId); });
    bodySpawnPromises.set(mapId, promise);
  }

  // A restless body gets up the same way the sanctum lich raises its dead: a
  // fresh skeleton from the same roster replaces the corpse where it lies.
  function emergenceActors(mapId,record){
    const actors=[wildlifeDeps?.player]; // Staged actors are not registered with combat AI yet.
    for(const set of [wildlifeDeps?.hostileObjects,wildlifeDeps?.companionObjects])
      for(const actor of set||[])if(actor.areaId===mapId&&actor.health>0&&actor!==record.entity)actors.push(actor);
    for(const other of bodiesByMapId.get(mapId)||[])if(other!==record&&other.emergence)actors.push(other.entity);
    return actors;
  }
  function emergencePathClear(mapId,record,tx,ty){
    const tile=Number(wildlifeDeps?.TILE)||32,actor=record.entity;
    const dx=tx-actor.x,dy=ty-actor.y,span=dx*dx+dy*dy;
    for(const other of emergenceActors(mapId,record)){
      if(!other||!Number.isFinite(other.x)||!Number.isFinite(other.y))continue;
      const u=span>0?clamp(((other.x-actor.x)*dx+(other.y-actor.y)*dy)/span,0,1):0;
      const gap=Math.hypot(other.x-(actor.x+dx*u),other.y-(actor.y+dy*u));
      const startGap=Math.hypot(other.x-actor.x,other.y-actor.y);
      if(gap<tile*.7&&!(startGap<tile*.7&&Math.hypot(other.x-tx,other.y-ty)>startGap&&u===0))return false; // Permit moving away from existing overlap, never toward another body.
    }
    return true;
  }
  function clearEmergenceExit(mapId,record,preferred=null){
    const tile=Number(wildlifeDeps?.TILE)||32;
    const exits=preferred?[preferred]:(record.body.exits||[{col:record.body.exitCol,row:record.body.exitRow}]);
    return exits.find(p=>{
      const x=(p.col+.5)*tile,y=(p.row+.5)*tile;
      if(window.AreaFootprintBlockers?.blocksBox?.(mapId,x/tile,y/tile,.32,null))return false;
      if(emergenceActors(mapId,record).some(actor=>actor&&Math.hypot(x-actor.x,y-actor.y)<tile*.7))return false;
      return emergencePathClear(mapId,record,x,y);
    })||null;
  }

  const smoothCoffinStep=t=>{t=clamp(t,0,1);return t*t*(3-2*t);}; // No abrupt angular or height velocity at either end of the rise.
  const shortestCoffinYaw=(from,to)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));

  async function raiseBody(mapId, record) {
    if(!clearEmergenceExit(mapId,record))return;
    record.rising=true;
    const corpse=record.entity;
    corpse._caveBodyRising=true;
    const base=corpse.rosterRecord||null;
    const roster=base?(corpse.corpseLooted?{...base,equippedCosmetics:[],cosmeticSlots:{},appliedDyes:{},metalArmorItems:[]}:base):null;
    const tile=Number(wildlifeDeps?.TILE)||32,body=record.body;
    const x=(body.col+.5)*tile,y=(body.row+.5)*tile;
    let minion;
    try{minion=await makeSkeleton(mapId,x,y,{state:'chase',caveBodyId:body.id},roster);}
    catch(error){window.__farmLog?.('[cave-sites] skeleton emergence failed: '+error.message,'warn');}
    if(!minion||wildlifeDeps?.getCurrentArea?.()!==mapId||!bodiesByMapId.get(mapId)?.includes(record)){
      if(minion)devSpawnerDeps?.despawnCreature?.(minion);
      record.rising=false;corpse._caveBodyRising=false;return;
    }
    if(corpse.corpseLooted)minion.corpseLooted=true;
    const group=minion.avatarRef?.group,old=corpse.avatarRef?.group;
    const coffin=coffinForBody(plansByMapId.get(mapId),body);
    const floor=coffinFloorY(coffin);
    const half=Number(minion.groundLift??minion.halfHeight)||.5;
    const startY=Number.isFinite(old?.position?.y)?old.position.y:floor+half*.12;
    const startYaw=Number.isFinite(old?.rotation?.y)?old.rotation.y:body.yaw;
    const startRoll=Number.isFinite(old?.rotation?.z)?old.rotation.z:Math.PI/2;
    if(group){
      group.position.set(x/tile,startY,y/tile);
      group.rotation.set(0,startYaw,startRoll);
      if(minion.avatarRef.frontPlane)minion.avatarRef.frontPlane.rotation.y=Math.PI/2;
      if(minion.avatarRef.backPlane)minion.avatarRef.backPlane.rotation.y=-Math.PI/2;
      minion.avatarRef.legs?.update?.(0,0,true);
    }
    if(minion.groundShadow)minion.groundShadow.visible=false;
    for(const holder of [minion._banditToolHolder,minion._banditRangedToolHolder,minion._banditFlaskToolHolder])if(holder)holder.visible=false; // Never expose scene-sibling equipment at its uninitialized transform.
    minion._caveBodyRising=true;
    devSpawnerDeps?.corpseObjects?.delete?.(corpse);
    devSpawnerDeps?.despawnCreature?.(corpse);
    record.entity=minion;
    record.emergence={phase:'rise',elapsed:0,x,y,floor,half,startY,startYaw,startRoll,exit:null,walk:0}; // No hostile AI until the complete staged exit.
  }

  function emergenceSurface(mapId,record,exit,p){
    const e=record.emergence,body=record.body;
    const dx=exit.col-body.col,dz=exit.row-body.row;
    const [dc,dr]=COFFIN_DIRECTIONS[coffinForBody(plansByMapId.get(mapId),body).rotY/90];
    const across=Math.abs(dx*dc+dz*dr)||1;
    const rimPoint=.35/across; // South panel's authored local center; sample its actual walkable top.
    const api=window.HobunjiWalkableElevation;
    const rim=api?.worldSurfaceTopAt?.(body.col+.5+dx*rimPoint,body.row+.5+dz*rimPoint,COFFIN_RIM_Y,mapId)??COFFIN_RIM_Y;
    const tile=record.entity.areaGrid?.[exit.row]?.[exit.col]; // Match the native combat renderer's ground datum at handoff.
    const terrain=tile?Number(wildlifeDeps?.tileSurfaceYInArea?.(tile,mapId))||0:0;
    const ground=api?.worldSurfaceTopAt?.(exit.col+.5,exit.row+.5,terrain,mapId)??terrain;
    // Step up over the panel and down onto ordinary floor. Blend the narrow vertical ledge instead of snapping.
    if(p<.12)return e.floor+(rim-e.floor)*smoothCoffinStep(p/.12);
    const clearAt=.8; // Authored plinth extends .48 tiles plus .32 walking half-width on the exit axis.
    if(p<clearAt)return rim;
    return rim+(ground-rim)*smoothCoffinStep((p-clearAt)/(1-clearAt));
  }

  function animateEmergence(mapId,record,dt){
    const e=record.emergence,c=record.entity;
    if(!e||!record.rising)return;
    const tile=Number(wildlifeDeps?.TILE)||32,g=c.avatarRef?.group;
    if(e.phase==='rise'){
      const consumed=Math.min(dt,COFFIN_RISE_S-e.elapsed); // Do not spend the same frame time on both the rise and the walk.
      e.elapsed+=consumed;
      dt-=consumed;
      const p=smoothCoffinStep(e.elapsed/COFFIN_RISE_S);
      if(g){g.position.set(e.x/tile,e.startY+(e.floor+e.half-e.startY)*p,e.y/tile);g.rotation.set(0,e.startYaw,e.startRoll*(1-p));}
      c.avatarRef?.legs?.update?.(consumed,0,false,undefined,{combat:true});
      c.avatarRef?.syncHandFrame?.();
      if(e.elapsed<COFFIN_RISE_S)return;
      e.phase='wait'; // The upright skeleton can wait inside its open coffin if the route is occupied.
      c.groupRot=e.startYaw;c.pngRot=e.startYaw;
    }
    if(e.phase==='wait'){
      e.exit=clearEmergenceExit(mapId,record);
      if(!e.exit)return;
      e.phase='walk';e.walk=0;
    }
    if(e.phase!=='walk'||dt<=0)return;
    const exit=e.exit,tx=(exit.col+.5)*tile,ty=(exit.row+.5)*tile;
    const distance=Math.hypot(tx-e.x,ty-e.y),direction=Math.atan2(ty-e.y,tx-e.x);
    const clear=!!clearEmergenceExit(mapId,record,exit);
    const step=dt*COFFIN_WALK_TILES_S*tile/Math.max(1,distance);
    const old=e.walk;
    const next=clamp(e.walk+(clear?step:-step),0,1);
    if(clear||emergencePathClear(mapId,record,e.x+(tx-e.x)*next,e.y+(ty-e.y)*next))e.walk=next; // Retreat only along a clear route.
    c.x=e.x+(tx-e.x)*e.walk;c.y=e.y+(ty-e.y)*e.walk;
    c.vx=dt>0?(tx-e.x)*(e.walk-old)/dt:0;c.vy=dt>0?(ty-e.y)*(e.walk-old)/dt:0;
    c.facing=direction;
    const targetYaw=-(direction+(c.def?.aimAngleOffset||0))+Math.PI/2;
    c.groupRot+=shortestCoffinYaw(c.groupRot,targetYaw)*Math.min(1,dt*10);c.pngRot=c.groupRot;
    if(g){g.position.set(c.x/tile,emergenceSurface(mapId,record,exit,e.walk)+e.half,c.y/tile);g.rotation.set(0,c.groupRot,0);}
    c.avatarRef?.legs?.update?.(dt,Math.hypot(c.vx,c.vy)/tile,false,undefined,{combat:true});
    c.avatarRef?.syncHandFrame?.();
    if(c._banditToolHolder)c._banditToolHolder.visible=true;
    window.BanditCombat?.updateToolMesh?.(c);
    if(!clear&&e.walk===0){e.phase='wait';e.exit=null;return;}
    if(e.walk<1)return;
    c.vx=0;c.vy=0;c.homeX=c.x;c.homeY=c.y;
    c._caveBodyRising=false;c.state='chase';
    if(c.groundShadow){c.groundShadow.visible=true; c.groundShadow.position?.set?.(c.x/tile,emergenceSurface(mapId,record,exit,1)+.01,c.y/tile);}
    wildlifeDeps?.hostileObjects?.add(c);
    record.emergence=null;record.rising=false;record.risen=true;
    window.BanditCombat?.setCombatExpression?.(c,true); // After registry handoff so the native alert callback sees a live hostile.
    window.__farmLog?.(`[cave-sites] ${record.body.id} stood and walked out in ${mapId}.`,'world');
  }

  function updateBodies(profile, plan, state) {
    const records = bodiesByMapId.get(profile.mapId);
    if (!records?.length) return;
    let lootedChanged = false;
    for (const record of records) {
      const coffin=coffinForBody(plan,record.body);
      if(record.entity?._caveCoffinSealed){
        const progress=coffinProgress(coffin,state);
        if(progress>=1)setBodySealed(record.entity,false);
        else if(progress>0&&record.entity.avatarRef?.group)record.entity.avatarRef.group.visible=true; // Reveal the body under the moving lid, but keep loot sealed until it stops.
      }
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
      if(caveClock-record.armedAt>=record.delay&&distance<=BODY_RISE_MAX_DISTANCE_TILES){
        if(coffinProgress(coffin,state)<1){openCoffin(profile.mapId,coffin,state);continue;}
        if(!clearEmergenceExit(profile.mapId,record))continue; // Wait instead of interrupting a search for a rise that cannot happen safely.
        if(window.CorpseHoldLoot?.debugSnapshot?.()?.holdId==='corpse_'+record.entity.id)window.CorpseHoldLoot.interrupt();
        raiseBody(profile.mapId,record);
      }
    }
    if (lootedChanged) persistState();
  }

  function canSearchBody(entity){
    if(!entity?.caveBodyId||entity.state!=='corpse'||entity.corpseLooted||entity._caveBodyRising||entity._caveCoffinSealed)return false;
    const mapId=entity.caveSiteMapId,player=wildlifeDeps?.player,tile=Number(wildlifeDeps?.TILE)||32;
    if(wildlifeDeps?.getCurrentArea?.()!==mapId||!player||Math.hypot(player.x-entity.x,player.y-entity.y)>tile*2.25)return false;
    const profile=sitesByMapId.get(mapId);
    return !!profile&&!!bodiesByMapId.get(mapId)?.some(record=>record.entity===entity)&&
      !(stateFor(profile).lootedBodies||[]).includes(entity.caveBodyId); // Validate the exact live record, not merely its reusable body ID.
  }

  function recordBodyLooted(entity){
    if(!entity?.caveBodyId)return false;
    const mapId=entity.caveSiteMapId,profile=sitesByMapId.get(mapId);
    if(!profile||!bodiesByMapId.get(mapId)?.some(record=>record.entity===entity))return false;
    const state=stateFor(profile);
    state.lootedBodies||=[];
    if(state.lootedBodies.includes(entity.caveBodyId))return false;
    state.lootedBodies.push(entity.caveBodyId);
    persistState(true); // Mark before the shared loot action schedules its save.
    return true;
  }

  function maybeEnterRuin(profile, plan, state) {
    if (!plan.ruinEntrance || ruinTransitionMaps.has(profile.mapId) || caveDistanceTiles(plan.ruinEntrance) > RUIN_TRIGGER_RADIUS_TILES) return;
    if (!window.DelversGuild?.hasStone?.()) {
      if (Date.now() - ruinLicensePromptAtMs > 8000) {
        ruinLicensePromptAtMs = Date.now();
        wildlifeDeps?.showToast?.("A Delver's Stone is required to unlock the Harlyao ruin beyond this cave.", false);
      }
      return;
    }
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
    Promise.resolve(ruin.generate(plan.ruinEntrance.seed, { site: true, tier: 'cave', label: 'Ancient Ruin', returnAnchor }))
      .then(ok => {
        if (!ok) wildlifeDeps?.showToast?.('The ancient passage cannot be entered right now.', false);
      })
      .catch(error => {
        window.__farmLog?.(`[cave-sites] ruin transition failed for ${profile.mapId}: ${error.message}`, 'warn');
      })
      .finally(() => ruinTransitionMaps.delete(profile.mapId));
  }

  function tickPuzzleRuntime(dt = 0) {
    const elapsed=Math.max(0,Number(dt)||0);
    const mapId=String(wildlifeDeps?.getCurrentArea?.() || ''); // Every music input and active cave scene is scoped to this map.
    window.PuzzleCaveEntrances?.update?.(elapsed,mapId); // Music/door transitions must keep moving even when the dev switch freezes NPC AI.
    const activePuzzle=puzzleChallengesByMapId.get(mapId)?.challenge;
    if(activePuzzle){activePuzzle.tick(elapsed);activePuzzle.animate?.(elapsed);} // 100 BPM sixteenth-note windows need the unthrottled gameplay clock.
  }
  function updateCurrentCaveRuntime(dt = 0) {
    const elapsed=Math.max(0,Number(dt)||0);
    caveClock += elapsed;
    tickPuzzleRuntime(elapsed); // Legacy wildlife wrapper owns cave ecology; the puzzle clock can also run independently when AI is disabled.
    const mapId=String(wildlifeDeps?.getCurrentArea?.() || '');
    const coffinPlan=plansByMapId.get(mapId),coffinProfile=coffinPlan?.coffins?.length&&sitesByMapId.get(mapId);
    if(coffinProfile){
      for(const record of bodiesByMapId.get(mapId)||[])if(record.emergence)animateEmergence(mapId,record,elapsed); // Only staged actors in the active map need per-frame interpolation.
      const saved=stateFor(coffinProfile);
      for(const coffin of coffinPlan.coffins)if(Number.isFinite(coffin.openStartedAt)){
        const progress=coffinProgress(coffin,saved);
        syncCoffinVisual(mapId,coffin,saved);
        if(progress>=1)delete coffin.openStartedAt; // Saved openedCoffins is the settled authority; no permanent per-frame animation work.
      }
    }
    caveRuntimeTimer -= elapsed;
    if (caveRuntimeTimer > 0) return;
    caveRuntimeTimer = CAVE_RUNTIME_INTERVAL_S;
    const plan = plansByMapId.get(mapId); // Only caverns decorated this session have a plan; checked first so open-world ticks do no profile work.
    const profile = plan && sitesByMapId.get(mapId);
    if (!profile) { lastCaveArea = null; window.CaveTripwireTraps?.suspend?.(); return; } // Area changes reset the crossing segment; returning to the same cave cannot fire from its last position.
    const state = stateFor(profile);
    if(state.puzzleRewardPending&&!state.puzzleRewardClaimed &&
      window.TrinketSystem?.claimLoot && window.LootRolling?.getLootPools?.()?.puzzleCave?.entries?.some(
        item=>Number(item.tier)===(Number(state.puzzleRewardTier)||1) &&
        window.TrinketSystem.DEFINITIONS?.[String(item.itemKey||'').replace(/^trinket_/,'')])) {
      grantPuzzleCaveReward(profile,plan,state); // Deliver a sealed prize when its definitions become available, even without leaving this cave.
    }
    markDiscovered(profile, state);
    ensureOccupants(profile, plan, state);
    triggerTraps(profile, plan, state);
    syncPuzzleTreasureVisual(mapId); // Update visibility when an attempted claim was pending a late loot-definition load.
    // Hidden caches are awarded through the explicit lockpicking interaction, never proximity alone.
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
    wrapInit(wildlife, deps => {
      wildlifeDeps = deps; // The original wildlife adapter remains the single authority for player/scene/area state.
      window.PuzzleCaveEntrances?.init?.(deps); // Reuses existing state rather than building another parallel game runtime.
    }, '__caveSiteInitWrapped');
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
    const cliffSites = zones.flatMap(id => outdoorPuzzleSitesByZone.get(id) || []); // Debug only the selected zone(s), not stale entrances from other regions.
    const rockSites = [...rockPuzzleSitesByParent.values()].filter(site => zones.includes(site.zoneId)); // Count hidden doors separately from ordinary caves.
    return {
      ready: integrationsInstalled,
      currentArea,
      latestChange: 'Restless catacomb skeletons stand up inside raised coffins, step over the rim and walk to a free tile before fighting.',
      groundFire: window.PersistentGroundFire?.debugSnapshot?.() || null,
      caveTripwires: window.CaveTripwireTraps?.debugSnapshot?.(currentArea) || null, // Mobile-friendly armed/disarmed/rope state.
      cliffEntrances: window.PuzzleCaveEntrances?.debugSnapshot?.() || null, // Mobile-accessible outside score, raised support and gate lock state. // Mobile-safe inspection of active fire without devtools.
      zoneCount: zones.length,
      caveCount: sites.length, // Ordinary caves only.
      animalDenCount: sites.filter(site => site.inhabitant === TYPES.ANIMAL_DEN).length, // Mobile check for den density across all requested wilderness zones.
      mixedUseCount: sites.filter(site => site.inhabitant !== TYPES.NONE && site.contents !== TYPES.PUZZLE_CAVE).length, // Inhabited caves still retain their independent content layer.
      puzzleCaveCount: cliffSites.length + rockSites.length, // Separate from the ordinary cave count.
      outdoorPuzzleCaveCount:cliffSites.length,
      outdoorSiteVisibility:cliffSites.map(site => ({ mapId:site.mapId, shelfId:site.shelfId, seclusion:site.seclusion || null })), // Phone-readable Shift sightline diagnostics.
      rockPuzzleCaveCount:rockSites.length,
      caves: sites.map(site => ({ mapId: site.mapId, zoneId: site.zoneId, denId: site.denId, contents: site.contents, inhabitant: site.inhabitant, label: site.discoveredLabel })),
      currentPlan: plansByMapId.has(currentArea) ? clone({
        profile: plansByMapId.get(currentArea).profile,
        outerRimTileCount: plansByMapId.get(currentArea).outerRimTileCount,
        wallHeightScale: plansByMapId.get(currentArea).wallHeightScale,
        clearanceFootprints: plansByMapId.get(currentArea).clearanceFootprints,
        separator: plansByMapId.get(currentArea).separator && { col: plansByMapId.get(currentArea).separator.col, row: plansByMapId.get(currentArea).separator.row, cells: plansByMapId.get(currentArea).separator.cells, oreKind: plansByMapId.get(currentArea).separator.oreKind },
        banditSpawns: plansByMapId.get(currentArea).banditSpawns,
        bodies: plansByMapId.get(currentArea).bodies,
        bodyStates: (bodiesByMapId.get(currentArea) || []).map(record => ({ id: record.body.id, riser: record.riser, armed: record.armedAt != null, risen: record.risen, emergence: record.emergence?.phase||null, walkProgress: record.emergence?.walk??null, looted: !!record.entity?.corpseLooted, state: record.entity?.state || null })),
        shattercasks: plansByMapId.get(currentArea).shattercasks,
        traps: plansByMapId.get(currentArea).traps,
        cache: plansByMapId.get(currentArea).cache,
        hiddenReward: plansByMapId.get(currentArea).hiddenReward, // Direct mobile diagnostic for the room/door/chest that justifies a destructible barrier.
        puzzleDoor: plansByMapId.get(currentArea).puzzleDoor,
        coffins: plansByMapId.get(currentArea).coffins.map(coffin=>({...coffin,progress:coffinProgress(coffin,stateFor(sitesByMapId.get(currentArea)))})),
        ruinEntrance: plansByMapId.get(currentArea).ruinEntrance,
        puzzleCave: plansByMapId.get(currentArea).puzzleCave,
        puzzleTreasure: plansByMapId.get(currentArea).puzzleTreasure, // Mobile diagnostics show the reward chest tile even if a model fails to load.
        puzzleProgress: puzzleChallengesByMapId.get(currentArea)?.challenge?.melodyState||null,
        puzzleActiveKind: puzzleChallengesByMapId.get(currentArea)?.challenge?.kind||null, // Mobile diagnostics show pressure-plate runtime fallback even when the seeded kind was music/fire.
        mushrooms: plansByMapId.get(currentArea).mushrooms,
        secondaryPocket: plansByMapId.get(currentArea).secondaryPocket || null,
      }) : null,
      currentState: profileForMapId(currentArea) ? clone(stateFor(profileForMapId(currentArea))) : null,
    };
  }

  window.CaveSiteSystem = Object.freeze({
    TYPES,
    TYPE_LABELS,
    applyWorkspaceProfiles,
    registerOutdoorPuzzleSites,
    exteriorPuzzleState,markExteriorPuzzleSolved,exteriorPuzzleKind,
    sitesForZone,
    outdoorPuzzleSitesForZone: zoneId => clone(outdoorPuzzleSitesByZone.get(String(zoneId || '')) || []), // Public, read-only generated cliff-door positions for terrain-grounded quests.
    profileForMapId,
    isAnimalDenSite,
    decorateCavernMapData,
    syncTransitionLabels,
    updateCurrentCaveRuntime,
    tickPuzzleRuntime, // Independent authoring/puzzle clock for Dev Testing Switchbox NPC-free mode.
    installIntegrations,
    debugSnapshot,
    buildInteriorProps,
    senseTargets,
    objectAt,
    canSearchBody,
    recordBodyLooted,
    resetCave,
    isZoneOccupied,
    mapLabelFor,
    init,
    serialize,
    restore,
    __test: Object.freeze({
      rollProfile,
      forceAnimalProfile,
      caveMushroomKeys, // Testable zone-native fungus selection without extra visual or interior generation.
      addSecondaryPocket, // Test spare-room reuse without building a whole cave scene.
      addPuzzleCaveLayer,
      grantPuzzleCaveReward, // Testable exactly-once reward escrow, also called by completed cave challenges.
      puzzleChallengesByMapId,
      findMineableSeparator,
      thickenSeparator,
      installMineableSeparator,
      addCacheLayer, // Isolated regression coverage for a bonus cache that cannot fit behind an otherwise valid hidden Puzzle Cave door.
      EXTENSION_CHANCES,
      MIN_OPTIONAL_EXTENSION_FLOOR,
      floorTiles,
      caveTitle,
      plansByMapId,
      sitesByZone,
      sitesByMapId,
      outdoorPuzzleSitesByZone,
      rockPuzzleSitesByParent,
      registerRockPuzzleSite,
      hashSeed,
      generatedCaveName,
      runtimeStateBySignature,
      ensureStateLoaded,
      persistState,
      banditPopulatedMaps,
      bodiesByMapId,
      bodySpawnPromises,
      coffinBlocksBox,
      coffinProgress,
      registerCoffinSupports,
      unregisterCoffinSupports,
      clearEmergenceExit,
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
