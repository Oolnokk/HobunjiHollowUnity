// Shared condition-axis schema + evaluators.
//
// This used to be hand-duplicated between docs/game.js (DLG_CONDITION_AXES,
// _dlgAxisMatch, _dlgEntryEligible, _dlgEntrySpecificity, _pickBestEntry) and
// docs/tools/dialogue-editor/index.html (CONDITION_AXES, CONDITION_CATEGORIES,
// emptyConditions, normalizeConditions) — the same drift risk as the
// furniture-def duplication between game.js and the interior-author tool.
// Now it's the one place both the dialogue system and the Loot & Shop
// Editor/runtime (and any future condition-gated system) read from.
//
// A "conditions bag" has this shape: one array per axis (empty = unrestricted,
// non-empty = OR within the axis), plus an optional numeric relationship
// range. AND applies across axes. `excludeConditions` uses the same shape as
// a "no-fly" bag: if ANY of its set axes matches, the entry is skipped
// regardless of what the require side says.
//
// `world` objects passed to entryEligible/pickBestEntry only need to include
// the axes that are meaningful to that caller — an axis absent from `world`
// is treated as not applicable (never disqualifies an entry), so callers
// with no concept of e.g. "stations" or "relationship" (loot pools, shop
// stock) can omit them rather than faking a value.
(function () {
  'use strict';

  const AXES = ['weekdays', 'seasons', 'weather', 'timesOfDay', 'encounter', 'maps', 'stations', 'playerSpecies'];

  const WEEKDAYS       = ['Anan', 'Hronu', 'Kruru', 'Muunu', 'Naru', 'Tothu', 'Uung'];
  const SEASONS        = ['Stormtide', 'Deadgrass', 'Longpour', 'Coldmuck'];
  const WEATHERS       = ['clear', 'rain', 'storm'];
  const TIMES_OF_DAY   = ['dawn', 'day', 'dusk', 'night'];
  const ENCOUNTERS     = ['first', 'returning'];
  // Mirrors game.js's NPC_SPECIES_IDS — the game treats player and NPC
  // species as the same taxonomy (both read/write appearance.speciesId).
  const PLAYER_SPECIES = ['mao-ao', 'tletingan', 'kenkari', 'engh-sho', 'rakakoan'];

  // Station labels are authored with their nice display casing (e.g.
  // "Carpentry Work") — normalize both sides the same way the existing
  // on-duty station checks in game.js do, so whitespace/case drift between
  // the two can't silently break a condition.
  function normalizeStationLabel(label) {
    return String(label || '').trim().toLowerCase();
  }

  function emptyConditions() {
    return {
      weekdays: [], seasons: [], weather: [], timesOfDay: [], encounter: [],
      maps: [], stations: [], playerSpecies: [],
      relationship: { min: null, max: null },
    };
  }

  function normalizeConditions(c) {
    c = c || {};
    return {
      weekdays:      Array.isArray(c.weekdays)      ? c.weekdays      : [],
      seasons:       Array.isArray(c.seasons)       ? c.seasons       : [],
      weather:       Array.isArray(c.weather)       ? c.weather       : [],
      timesOfDay:    Array.isArray(c.timesOfDay)    ? c.timesOfDay    : [],
      encounter:     Array.isArray(c.encounter)     ? c.encounter     : [],
      maps:          Array.isArray(c.maps)          ? c.maps          : [],
      stations:      Array.isArray(c.stations)      ? c.stations      : [],
      playerSpecies: Array.isArray(c.playerSpecies) ? c.playerSpecies : [],
      relationship: {
        min: c.relationship?.min ?? null,
        max: c.relationship?.max ?? null,
      },
    };
  }

  function axisValueMatches(vals, axis, value) {
    if (!vals || !vals.length) return false;
    if (axis === 'stations') return vals.some(v => normalizeStationLabel(v) === value);
    return vals.includes(value);
  }

  function axisMatch(bag, axis, value) {
    const vals = bag?.[axis];
    return !vals || !vals.length || axisValueMatches(vals, axis, value);
  }

  function entryEligible(entry, world) {
    world = world || {};
    const c = entry.conditions || {};
    for (const axis of AXES) {
      if (!(axis in world)) continue;
      if (!axisMatch(c, axis, world[axis])) return false;
    }
    const rel = c.relationship;
    if (rel && (rel.min != null || rel.max != null) && world.relationship != null) {
      if (rel.min != null && world.relationship < rel.min) return false;
      if (rel.max != null && world.relationship > rel.max) return false;
    }
    // No-fly conditions: the entry is skipped if ANY set exclude axis
    // matches the current world state, regardless of the require side.
    const x = entry.excludeConditions || {};
    for (const axis of AXES) {
      if (!(axis in world)) continue;
      if (axisValueMatches(x[axis], axis, world[axis])) return false;
    }
    const xrel = x.relationship;
    if (xrel && (xrel.min != null || xrel.max != null) && world.relationship != null) {
      const inExcludedBand =
        (xrel.min == null || world.relationship >= xrel.min) &&
        (xrel.max == null || world.relationship <= xrel.max);
      if (inExcludedBand) return false;
    }
    return true;
  }

  function entrySpecificity(entry) {
    const c = entry.conditions || {};
    let n = 0;
    for (const axis of AXES) if (c[axis] && c[axis].length) n++;
    const rel = c.relationship;
    if (rel && (rel.min != null || rel.max != null)) n++;
    return n;
  }

  // Shared by dialogue-tree selection and phrase-pool entry resolution:
  // among entries whose conditions are met (and no-fly conditions aren't),
  // the most specifically-targeted one that has never been heard before
  // always wins. Once every entry matching the exact current combination has
  // been heard at least once, selection among the remaining eligible entries
  // is randomized instead of repeating the same priority order every time.
  // `entries` is any list of { id, conditions, excludeConditions, priority? };
  // `heard` is the array of already-heard ids to check/rank against.
  function pickBestEntry(entries, world, heard) {
    heard = heard || [];
    const eligible = (entries || []).filter(e => entryEligible(e, world));
    if (!eligible.length) return null;
    const unheard = eligible.filter(e => !heard.includes(e.id));
    if (unheard.length) {
      return unheard.slice().sort((a, b) =>
        entrySpecificity(b) - entrySpecificity(a) ||
        (b.priority || 0) - (a.priority || 0) ||
        String(a.id).localeCompare(String(b.id)))[0];
    }
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  // Loot/shop selector for pickMode:'independent' pools — every eligible
  // entry is rolled independently against its own chance (default 1 =
  // always rolled, matching the pre-migration creature/bandit loot tables).
  function rollIndependentEligible(entries, world, rng) {
    rng = rng || Math.random;
    return (entries || []).filter(e => entryEligible(e, world) && rng() < (e.chance != null ? e.chance : 1));
  }

  // Loot/shop selector for pickMode:'single' pools — picks exactly one
  // eligible entry, weighted by `weight` (default 1).
  function pickWeightedEligible(entries, world, rng) {
    rng = rng || Math.random;
    const eligible = (entries || []).filter(e => entryEligible(e, world));
    const total = eligible.reduce((s, e) => s + (e.weight != null ? e.weight : 1), 0);
    if (!eligible.length || total <= 0) return null;
    let r = rng() * total;
    for (const e of eligible) {
      r -= (e.weight != null ? e.weight : 1);
      if (r <= 0) return e;
    }
    return eligible[eligible.length - 1];
  }

  window.ConditionRegistry = {
    AXES,
    WEEKDAYS, SEASONS, WEATHERS, TIMES_OF_DAY, ENCOUNTERS, PLAYER_SPECIES,
    normalizeStationLabel,
    emptyConditions, normalizeConditions,
    axisValueMatches, axisMatch,
    entryEligible, entrySpecificity,
    pickBestEntry,
    rollIndependentEligible, pickWeightedEligible,
  };
})();

// The friendship weapon-visit feature is shared by the live game and Dialogue
// Editor, so bootstrap it from this already-shared pre-game dependency instead
// of adding another copy of its script-order contract to both HTML entrypoints.
(function loadWeaponTrustVisitFeature() {
  if (typeof document === 'undefined') return;
  const self = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = self ? new URL('../', self) : new URL('./', location.href);
  const scripts = [
    new URL('config/weapon-trust-visits.js?v=20260902c', docsBase).href,
    new URL('js/weapon-trust-visits.js?v=20260902c', docsBase).href,
  ];
  for (const src of scripts) {
    if ([...document.scripts].some(script => script.src === src)) continue;
    if (document.readyState === 'loading' && document.currentScript) document.write(`<script src="${src}"><\/script>`);
    else {
      const script = document.createElement('script');
      script.async = false;
      script.src = src;
      document.head.appendChild(script);
    }
  }
})();
