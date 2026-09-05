(() => {
  'use strict';

  // NPC scheduling: resolving what an NPC should be doing/where they should
  // be right now (resolveNpcScheduleTarget), the station registry that backs
  // it (registerNpcStations/resolveNpcStationTarget), and the on-duty check
  // other systems poll to see if a scheduled NPC has actually arrived
  // (isNpcOnDutyAtStation/listInstrumentPerformers, used by js/music-
  // minigame.js's ambient performance ticker).
  //
  // Pulled out of game.js's ~25k-line closure after two real bugs turned out
  // to live here and took real digging to find, both in resolveNpcScheduleTarget:
  // one where a schedule-overrides.json positionRedirect silently dropped a
  // station's toolKey/label metadata (an NPC still walked to the right tile
  // but never equipped their instrument or registered as on-duty), and one
  // in the walker's own wander-state handling (see game.js's makeNpcWalker)
  // that skipped the same toolKey-equip/on-duty logic entirely whenever a
  // station's wanderRadiusTiles put an NPC into 'station-wander' state.
  // Keeping this logic in one focused file — instead of interleaved among
  // combat/dialogue/rendering/pathfinding in the monolith — is meant to make
  // the next one of these easier to spot.
  //
  // window.__farmDebugTools (below) exists specifically so a bug like either
  // of those can be reproduced and verified in seconds via a headless test,
  // instead of waiting out a real (or simulated) day/night cycle — see
  // jumpTime/forceNpcToTestStation/forceNpcToRedirectedTestStation.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function npcMovementConfig() { return window.SCRATCHBONES_CONFIG?.game?.movement?.npc || {}; }

  function normalizeStationLabel(label) {
    return String(label || '').trim().toLowerCase();
  }

  // Registry of NPCs who perform an instrument at a specific station — each
  // NPC's own station/time window still lives in their scheduleHooks (see
  // hobunji-starter-npc-database.json); this just says which of their
  // stations counts as "performing" and which song they lead there. Add
  // future instrument NPCs here — js/music-minigame.js's leader/backup logic
  // treats every entry identically (whoever started playing first in a given
  // area leads, everyone else who joins falls in as backup — see
  // listInstrumentPerformers).
  const INSTRUMENT_NPC_DEFS = [
    // Foroji busks in the square on his day off (Naru) and plays the inn at
    // night after his shop shift the rest of the week — two stations, same
    // NPC, same song; only one can ever be on duty at once so
    // listInstrumentPerformers below never double-counts him.
    { npcId: 'foroji_funji', stationLabel: 'Playing Music in the Square', songId: 'when-the-kininjis-bloom' },
    { npcId: 'foroji_funji', stationLabel: 'Playing Music at the Inn', songId: 'when-the-kininjis-bloom' },
  ];

  // Generalizes the same idle/station/label gate the general-store and
  // carpenter "is this NPC on duty" checks use, for any station label
  // instead of one hardcoded shop.
  function isNpcOnDutyAtStation(walker, stationLabel) {
    const target = walker?.currentScheduleTarget || null;
    const label = normalizeStationLabel(target?.label);
    const isAtStation = walker?.state === 'idle' && target && Number.isFinite(target.c) && Number.isFinite(target.r)
      && Math.hypot(walker.root.position.x - (target.c + 0.5), walker.root.position.z - (target.r + 0.5)) <= (npcMovementConfig().arrivalRadiusTiles ?? 0.18);
    return isAtStation && label === normalizeStationLabel(stationLabel);
  }

  // Every INSTRUMENT_NPC_DEFS entry currently on duty — read by js/music-
  // minigame.js's ambient-performance ticker (who should be playing
  // ambiently right now) and by the player's own "Play" action (is there
  // someone nearby already leading to join instead).
  function listInstrumentPerformers() {
    const out = [];
    for (const def of INSTRUMENT_NPC_DEFS) {
      const walker = deps.npcWalkers.find(w => w.rec?.id === def.npcId);
      if (walker && isNpcOnDutyAtStation(walker, def.stationLabel)) {
        out.push({ npcId: def.npcId, name: walker.rec?.name || def.npcId, area: walker.area, songId: def.songId });
      }
    }
    return out;
  }

  function parseNpcTimeMinutes(t) { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function currentGameMinutes() { return Math.round(window.CalendarSystem.getHour() * 60); }
  function isNowWithinNpcRuleWindow(now, start, end) {
    if (start === null || end === null) return false;
    if (start <= end) return now >= start && now < end;
    return now >= start || now < end;
  }

  // A rule may restrict itself to one or more weekdays via "day" (single
  // name) or "days" (array); rules with neither run every day.
  function isNpcRuleActiveOnDay(rule) {
    if (rule.day) return rule.day === window.CalendarSystem.currentWeekdayName();
    if (rule.days) return rule.days.includes(window.CalendarSystem.currentWeekdayName());
    return true;
  }

  function hashNpcIdToIndex(id, mod) {
    let h = 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % mod;
  }

  const npcStationsById = new Map(); // stationId → { id, label, area, c, r, rotY, pose, toolKey, toolIntervalSec, ... }

  // Optional ambient gaze target — see game.js's _applyNpcAmbientLook, which
  // reads this off whatever station an idling/seated NPC currently resolves
  // to and aims their neck joint at it (e.g. the temple's spirit_communion
  // benches/eldress station all point at the campfire's tile). `col`/`row`
  // are in the station's own area; `height` (world units above that tile's
  // floor) is optional and defaults to a low, fire-appropriate value.
  function normalizeStationLookAt(lookAt) {
    if (!lookAt || !Number.isFinite(lookAt.col) || !Number.isFinite(lookAt.row)) return null;
    return { col: lookAt.col, row: lookAt.row, height: Number.isFinite(lookAt.height) ? lookAt.height : undefined };
  }

  function normalizeNpcStation(station, fallbackArea) {
    if (!station || !station.id) return null;
    const c = station.c ?? station.col;
    const r = station.r ?? station.row;
    if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
    return {
      id: station.id,
      label: station.label || station.id,
      area: deps.normalizeNpcArea(station.area || station.mapId || fallbackArea || 'farm'),
      c, r,
      rotY: Number.isFinite(station.rotY) ? station.rotY : 0,
      pose: station.pose || 'stand',
      furnitureKey: station.furnitureKey
        || deps.getDecorativeFurnitureKeyByItemKey(station.sourceFurnitureKey)
        || (deps.decorativeFurnitureDefs[station.sourceFurnitureKey] ? station.sourceFurnitureKey : ''),
      seatIndex: Number.isFinite(station.seatIndex) ? station.seatIndex : 0,
      toolKey: station.toolKey || '',
      toolIntervalSec: Number.isFinite(station.toolIntervalSec) ? station.toolIntervalSec : 0,
      toolAnimStyle: station.toolAnimStyle || '',
      // Multi-tile wander footprint around this station's root tile — see
      // game.js's makeNpcWalker's _updateStationWander/_pickStationWanderTile.
      // wanderMode 'radius' (default) samples a random offset within
      // wanderRadiusTiles of (c,r); 'shape' instead picks uniformly among the
      // hand-painted wanderShapeTiles (each a [dc,dr] offset from (c,r),
      // authored in the Map Editor's station paint tool) — lets an author
      // cover an irregular region a circle can't express (an L-shaped yard, a
      // field that hugs a path, etc). Neither set (radius 0, empty shape)
      // keeps the plain behavior: an NPC freezes exactly at (c,r). A toolKey
      // station never wanders regardless (see game.js's makeNpcWalker) — an
      // NPC has to actually stay at their tool/instrument to use it.
      wanderRadiusTiles: Number.isFinite(station.wanderRadiusTiles) ? Math.max(0, station.wanderRadiusTiles) : 0,
      wanderMode: station.wanderMode === 'shape' ? 'shape' : 'radius',
      wanderShapeTiles: Array.isArray(station.wanderShapeTiles)
        ? station.wanderShapeTiles.filter(t => Array.isArray(t) && Number.isFinite(t[0]) && Number.isFinite(t[1]))
        : [],
      // Semantic destination roles this station advertises (design doc
      // §13/§14 — "Stations Become World Affordances"), e.g. 'music-
      // performance' or 'sit'. Optional and purely additive: a station with
      // no roles authored is simply never returned by findStationsByRole
      // below, and every existing exact-stationId lookup is unaffected.
      roles: Array.isArray(station.roles) ? station.roles.filter(r => typeof r === 'string' && r) : [],
      lookAt: normalizeStationLookAt(station.lookAt),
    };
  }
  function registerNpcStations(stations, fallbackArea) {
    (stations || []).forEach(st => {
      const normalized = normalizeNpcStation(st, fallbackArea);
      if (normalized) npcStationsById.set(normalized.id, normalized);
    });
  }
  function resolveNpcStationTarget(stationId) {
    const station = npcStationsById.get(stationId);
    return station ? { ...station, stationId: station.id } : null;
  }

  // Every registered station advertising `role`, optionally narrowed to one
  // area — the semantic counterpart to resolveNpcStationTarget's exact-id
  // lookup, used by npc-activities.js's goToRole so an agenda beat can say
  // "any music-performance spot" instead of a literal station id (design
  // doc §15). Returned objects have the same shape resolveNpcStationTarget
  // produces (station data + `stationId`).
  function findStationsByRole(role, { area } = {}) {
    const out = [];
    for (const station of npcStationsById.values()) {
      if (!station.roles || !station.roles.includes(role)) continue;
      if (area && station.area !== area) continue;
      out.push({ ...station, stationId: station.id });
    }
    return out;
  }

  const _scheduleFallbackLogKeys = new Set();
  function logScheduleFallbackOnce(rec, kind, area, c, r) {
    const minuteBucket = Math.floor(currentGameMinutes() / 10);
    const key = [rec?.id || 'npc', kind, deps.getCurrentArea(), area, c, r, minuteBucket].join('|');
    if (_scheduleFallbackLogKeys.has(key)) return;
    _scheduleFallbackLogKeys.add(key);
    window.__farmLog?.(`[schedule] ${rec?.id || 'npc'}: no rule matched (playerMap=${deps.getCurrentArea()}) → fallback ${kind} area=${area} c=${c} r=${r}`, 'warn');
  }

  // The original, unmodified resolver: scheduleHooks.rules[] (time+day
  // windowed, stationId or raw c/r with sourceStationId metadata restore) →
  // shared schedules → defaultStationId → defaultPosition → legacy world
  // path → null. Every existing NPC's authored content still runs through
  // this exact function, unchanged — it's now the "legacyScheduleActivity"
  // activity's implementation (see npc-activities.js) and the sole resolver
  // for any NPC with no authored `agenda`. Renamed (from
  // resolveNpcScheduleTarget) so that name could become the new
  // agenda/planner-aware bridge below without disturbing this function's
  // own logic at all.
  function resolveLegacyNpcScheduleTarget(rec) {
    const hooks = rec?.scheduleHooks || {};
    const now = currentGameMinutes();
    for (const rule of hooks.rules || []) {
      if (rule.contentIncomplete) continue; // flagged by the Schedule Editor / migration — not a real target yet
      if (!isNpcRuleActiveOnDay(rule)) continue;
      const start = parseNpcTimeMinutes(rule.start ?? rule.from);
      const end   = parseNpcTimeMinutes(rule.end   ?? rule.to);
      const ruleActive = isNowWithinNpcRuleWindow(now, start, end);
      if (ruleActive && rule.stationId) {
        const stationTarget = resolveNpcStationTarget(rule.stationId);
        if (stationTarget) return { ...stationTarget, routeId: rule.routeId || null, activity: rule.activity || '' };
        // The station's building scene may simply not have been visited/loaded
        // yet this session (its npcStations only register once it loads) —
        // warm it up so the lookup succeeds on a later tick, and throttle the
        // warning instead of spamming it every tick until that load completes.
        const missingArea = deps.normalizeNpcArea(rule.area ?? rule.mapId ?? hooks.defaultMapId ?? 'town');
        if (deps.isBuildingArea(missingArea) && !deps.buildingScenes.has(missingArea)) deps.loadBuildingScene(missingArea);
        const warnKey = `${rec?.id || 'npc'}|${rule.stationId}`;
        if (!_scheduleFallbackLogKeys.has(warnKey)) {
          _scheduleFallbackLogKeys.add(warnKey);
          window.__farmLog?.(`[schedule] ${rec?.id || 'npc'}: stationId "${rule.stationId}" not found (warming up ${missingArea})`, 'warn');
        }
      }
      const c = rule.c ?? rule.position?.c;
      const r = rule.r ?? rule.position?.r;
      const area = deps.normalizeNpcArea(rule.area ?? rule.mapId ?? hooks.defaultMapId ?? 'town');
      if (ruleActive && Number.isFinite(c) && Number.isFinite(r)) {
        // A positionRedirect (see local-db-overrides.js's _applyPositionRedirect)
        // moves a station-backed rule to a raw c/r without rewriting the map file —
        // it deletes rule.stationId, so this branch runs instead of the stationId
        // one above, and a bare {area,c,r} target carries none of the original
        // station's label/toolKey/pose/etc. That's fine for plain wandering rules,
        // but for a redirected rule it silently drops everything that made the
        // station meaningful (an NPC still walks to the right tile but never picks
        // up their toolKey item or matches any label-based on-duty check, e.g.
        // isNpcOnDutyAtStation/listInstrumentPerformers). The redirect preserves
        // sourceStationId exactly so it can be re-attached here.
        const sourceStation = rule.sourceStationId ? npcStationsById.get(rule.sourceStationId) : null;
        if (sourceStation) {
          const { id: _id, c: _sc, r: _sr, area: _sarea, ...stationMetadata } = sourceStation;
          return { ...stationMetadata, area, c, r, routeId: rule.routeId || null, activity: rule.activity || '' };
        }
        return { area, c, r, routeId: rule.routeId || null, activity: rule.activity || '' };
      }
    }
    for (const shared of deps.getSharedSchedules()) {
      if (!shared || shared.contentIncomplete) continue;
      const start = parseNpcTimeMinutes(shared.from), end = parseNpcTimeMinutes(shared.to);
      if (window.CalendarSystem.currentWeekdayName() !== shared.day) continue;
      if (!isNowWithinNpcRuleWindow(now, start, end)) continue;
      if (shared.appliesToTag && !(rec?.tags || []).includes(shared.appliesToTag)) continue;
      if ((shared.excludeNpcIds || []).includes(rec?.id)) continue;
      const ids = shared.stationIds || [];
      if (!ids.length) continue;
      const target = resolveNpcStationTarget(ids[hashNpcIdToIndex(rec?.id, ids.length)]);
      if (target) return { ...target, activity: shared.label || shared.id || 'Shared Event' };
    }
    if (hooks.defaultStationId) {
      const stationTarget = resolveNpcStationTarget(hooks.defaultStationId);
      if (stationTarget) return stationTarget;
      window.__farmLog?.(`[schedule] ${rec?.id || 'npc'}: defaultStationId "${hooks.defaultStationId}" not found`, 'warn');
    }
    // contentIncomplete NPCs (flagged by the migration/Schedule Editor — e.g.
    // a defaultPosition that was only ever a {0,0} placeholder) skip the
    // raw-position fallback entirely rather than spawn at a made-up tile;
    // they fall through to "no target" below, which game.js's
    // spawnScheduledNpcs()/_retrySpawnDeferredNpcs() already treat as "defer
    // and retry" instead of a visible glitch.
    if (!hooks.contentIncomplete && hooks.defaultPosition && Number.isFinite(hooks.defaultPosition.c) && Number.isFinite(hooks.defaultPosition.r)) {
      const defArea = deps.normalizeNpcArea(hooks.defaultPosition.area || hooks.defaultMapId || 'town');
      logScheduleFallbackOnce(rec, 'defaultPosition', defArea, hooks.defaultPosition.c, hooks.defaultPosition.r);
      return { ...hooks.defaultPosition, area: defArea };
    }
    const legacy = deps.getWorldNpcPaths().find(p => p.npcId === rec?.id);
    if (legacy?.nodes?.length) { const [c, r] = legacy.nodes[legacy.nodes.length - 1]; const legArea = deps.normalizeNpcArea(legacy.area || 'farm'); logScheduleFallbackOnce(rec, 'legacy path', legArea, c, r); return { area: legArea, c, r, legacyPath: legacy }; }
    return null;
  }

  function hasExistingNpcWalker(rec) {
    return (deps.npcWalkers || []).some(w => w.rec?.id === rec?.id);
  }

  // The real entry point every call site in game.js uses (spawnScheduledNpcs,
  // _retrySpawnDeferredNpcs, the walker's own per-frame update(), and
  // catchNpcsOnPlayerAreaTransition). Delegates to
  // window.NpcActivityPlanner — the Agenda + Activity Planner redesign —
  // when it's loaded, which is what actually fixes the "NPC freezes forever
  // because an authored destination is missing/renamed/unavailable"
  // failure mode: resolveLegacyNpcScheduleTarget above still runs
  // unmodified as that planner's fallback tier for any NPC with no
  // authored `agenda`, but a null result from it no longer has to mean
  // "walker stays frozen in place" for an NPC that's already spawned — see
  // npc-activity-planner.js's resolveNpcTarget for the full replan/
  // free-time/wander fallback chain, and its module comment for exactly
  // why *pre-spawn* resolution (hasExistingWalker === false) deliberately
  // keeps returning bare null, unchanged, instead of synthesizing a first
  // appearance out of nowhere.
  //
  // Falls back to calling resolveLegacyNpcScheduleTarget directly if the
  // planner module didn't load for any reason, so a missing/broken script
  // tag degrades to exactly today's behavior rather than breaking every NPC.
  function resolveNpcScheduleTarget(rec) {
    if (!window.NpcActivityPlanner) return resolveLegacyNpcScheduleTarget(rec);
    return window.NpcActivityPlanner.resolveNpcTarget(rec, {
      legacyResolve: resolveLegacyNpcScheduleTarget,
      hasExistingWalker: hasExistingNpcWalker(rec),
    }) || null;
  }

  // ── Dev/test-only scheduling hooks ────────────────────────────────────
  // Lets headless tests (and manual console poking) validate the NPC
  // station-arrival/perform pipeline — pathfind to a station, go idle, pick
  // up its toolKey mesh, register as on-duty for listInstrumentPerformers/
  // ambient audio — in seconds instead of waiting out a real day/night cycle
  // for a schedule window to arrive (this sandbox's clock has been measured
  // running ~65x slower than real time under software rendering, so "just
  // wait" isn't a realistic option here). Works on any existing NPC and any
  // station (test or authored), so the same handful of calls cover any
  // future "does the scheduling system actually work" question, not just
  // instrument performance. Always-on, matching window.__farmLog's existing
  // always-available debug surface — not gated behind a dev-mode flag.
  window.__farmDebugTools = {
    // Jumps the calendar directly rather than waiting real time out.
    jumpTime(day, time01) {
      if (Number.isFinite(day)) deps.calendar.day = Math.max(1, Math.round(day));
      if (Number.isFinite(time01)) deps.calendar.time01 = Math.max(0, Math.min(0.999, time01));
      return { day: deps.calendar.day, time01: deps.calendar.time01, hour: window.CalendarSystem?.getHour?.() };
    },
    // Registers an ad-hoc station and pins npcId to it via an always-active
    // rule prepended to their schedule, overriding whatever their real
    // schedule currently says. Station/rule ids are namespaced 'test_' so
    // they're easy to spot and never collide with authored content. Returns
    // false if the NPC doesn't exist.
    forceNpcToTestStation(npcId, { area, c, r, toolKey = '', toolIntervalSec = 2.4, toolAnimStyle = '', label = 'Test Station', rotY = 0, wanderMode, wanderRadiusTiles, wanderShapeTiles } = {}) {
      const walker = deps.npcWalkers.find(w => w.rec?.id === npcId);
      if (!walker) return false;
      const targetArea = area || walker.area;
      const stationId = `test_station_${npcId}`;
      registerNpcStations([{ id: stationId, label, area: targetArea, c, r, rotY, pose: 'stand', toolKey, toolIntervalSec, toolAnimStyle, wanderMode, wanderRadiusTiles, wanderShapeTiles }], targetArea);
      const hooks = walker.rec.scheduleHooks || (walker.rec.scheduleHooks = { rules: [] });
      hooks.rules = (hooks.rules || []).filter(r => r.id !== `test_rule_${npcId}`);
      hooks.rules.unshift({ id: `test_rule_${npcId}`, from: '00:00', to: '23:59', mapId: targetArea, stationId, activity: label });
      return true;
    },
    // Undoes forceNpcToTestStation, letting the NPC's real schedule resume.
    clearNpcTestStation(npcId) {
      const walker = deps.npcWalkers.find(w => w.rec?.id === npcId);
      if (!walker?.rec?.scheduleHooks?.rules) return false;
      walker.rec.scheduleHooks.rules = walker.rec.scheduleHooks.rules.filter(r => r.id !== `test_rule_${npcId}`);
      npcStationsById.delete(`test_station_${npcId}`);
      return true;
    },
    // Reproduces exactly what local-db-overrides.js's _applyPositionRedirect
    // does to a rule (registers a real station with metadata, then points a
    // rule at a raw c/r with sourceStationId set and stationId deleted)
    // without needing a real schedule-overrides.json entry or waiting for a
    // matching day/time — for testing resolveNpcScheduleTarget's handling of
    // that exact shape directly.
    forceNpcToRedirectedTestStation(npcId, { area, c, r, toolKey = '', toolIntervalSec = 2.4, toolAnimStyle = '', label = 'Redirected Test Station', rotY = 0 } = {}) {
      const walker = deps.npcWalkers.find(w => w.rec?.id === npcId);
      if (!walker) return false;
      const targetArea = area || walker.area;
      const sourceStationId = `test_source_station_${npcId}`;
      registerNpcStations([{ id: sourceStationId, label, area: targetArea, c: c + 25, r: r + 25, rotY, pose: 'stand', toolKey, toolIntervalSec, toolAnimStyle }], targetArea);
      const hooks = walker.rec.scheduleHooks || (walker.rec.scheduleHooks = { rules: [] });
      hooks.rules = (hooks.rules || []).filter(rule => rule.id !== `test_rule_${npcId}`);
      hooks.rules.unshift({ id: `test_rule_${npcId}`, from: '00:00', to: '23:59', mapId: targetArea, sourceStationId, c, r, activity: label });
      return true;
    },
    listNpcIds() { return deps.npcWalkers.map(w => w.rec?.id).filter(Boolean); },
    npcSnapshot(npcId) {
      const walker = deps.npcWalkers.find(w => w.rec?.id === npcId);
      if (!walker) return null;
      return {
        area: walker.area, state: walker.state,
        x: walker.root?.position?.x, z: walker.root?.position?.z,
        stationToolKey: walker.stationToolKey || null,
        currentScheduleTarget: walker.currentScheduleTarget ? { ...walker.currentScheduleTarget } : null,
      };
    },
  };

  window.NpcScheduling = {
    init,
    normalizeStationLabel,
    isNpcOnDutyAtStation,
    listInstrumentPerformers,
    registerNpcStations,
    resolveNpcStationTarget,
    findStationsByRole,
    resolveNpcScheduleTarget,
    // The unwrapped original resolver, exposed for the Agenda/Activity
    // Planner's own "legacyScheduleActivity" activity and for tests —
    // everyone else should keep calling resolveNpcScheduleTarget above.
    resolveLegacyNpcScheduleTarget,
    // Exposed directly (not copied) so external code that only ever read/
    // wrote through this exact Map keeps doing so unchanged.
    stationsById: npcStationsById,
  };
})();
