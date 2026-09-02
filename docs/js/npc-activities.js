(() => {
  'use strict';

  // NPC Activities: the reusable behavior packages an agenda beat points at
  // (design doc §11/§12/§13/§15). An activity's only job is
  // resolveDestination(ctx) → an explicit { status, target, reason } result
  // — never a bare null (design doc §19). Agenda beats don't know how their
  // activity actually finds a place in the world; this registry is where
  // that lives, so a beat can say "work" or `destinationRole: 'smith-work'`
  // instead of a literal station id.
  //
  // Every built-in activity here resolves to the exact same target shape
  // npc-scheduling.js's resolveNpcStationTarget already produces (spread
  // straight through `stationTarget()` below) — that's the contract
  // game.js's makeNpcWalker.update() has always consumed
  // (target.area/c/r/stationId/label/pose/toolKey/wanderRadiusTiles/...),
  // so nothing downstream of the planner needs to change.
  //
  // init(deps) is called once from game.js with read-only world/station
  // knowledge (deps.resolveNpcStationTarget, deps.findStationsByRole, ...).
  // Everything else about a specific resolution — which NPC, which beat,
  // whether they already have a walker, which opportunity the free-time
  // planner picked — arrives per-call in `ctx`, built by
  // npc-activity-planner.js.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const STATUS = Object.freeze({
    READY: 'READY',
    WAITING_FOR_WORLD: 'WAITING_FOR_WORLD',
    NO_PLAN: 'NO_PLAN',
    ACTIVITY_UNAVAILABLE: 'ACTIVITY_UNAVAILABLE',
    INVALID_CONTENT: 'INVALID_CONTENT',
  });
  function ready(target, reason) { return { status: STATUS.READY, target, reason: reason || 'resolved' }; }
  function noPlan(reason) { return { status: STATUS.NO_PLAN, target: null, reason: reason || 'no eligible beat' }; }
  function invalidContent(reason) { return { status: STATUS.INVALID_CONTENT, target: null, reason }; }
  function unavailable(reason) { return { status: STATUS.ACTIVITY_UNAVAILABLE, target: null, reason }; }
  function waitingForWorld(area, reason) { return { status: STATUS.WAITING_FOR_WORLD, target: null, reason, area }; }

  // Distinguishes "the building this station lives in just hasn't loaded
  // this session yet" from "this station doesn't exist" (design doc §20) —
  // same warm-up-and-wait behavior npc-scheduling.js's own
  // resolveNpcScheduleTarget already used for missing stationIds, just
  // reusable for role lookups too.
  function waitingOrUnavailable(area, reason) {
    const a = area ? deps.normalizeNpcArea(area) : null;
    if (a && deps.isBuildingArea(a) && !deps.buildingScenes.has(a)) {
      deps.loadBuildingScene(a);
      return waitingForWorld(a, reason);
    }
    return unavailable(reason);
  }

  function stationTarget(station, ctx) {
    return { ...station, activity: ctx.beat?.activityLabel || ctx.beat?.activity || station.label || '' };
  }

  // Deterministic (not Math.random()) pick among several equally-valid
  // candidates. resolveDestination is called fresh every planner tick with
  // no memoization — an NPC's chosen bench/station must stay the same
  // tick-to-tick or they'd visibly flicker between candidates every frame,
  // so ties are always broken by the same daily seed rather than chance.
  function pickDeterministic(list, npcId, day, salt) {
    if (!list.length) return null;
    const idx = Math.floor(window.NpcAgenda.dailySeed(npcId, day, salt) * list.length) % list.length;
    return list[idx];
  }

  function goToStation(ctx) {
    const stationId = ctx.beat.destinationStationId;
    if (!stationId) return invalidContent('goToStation activity requires beat.destinationStationId');
    const station = deps.resolveNpcStationTarget(stationId);
    if (station) return ready(stationTarget(station, ctx));
    return waitingOrUnavailable(ctx.beat.destinationArea, `station "${stationId}" not found`);
  }

  // Is some *other* NPC already resolved to this exact station? One-tick-
  // stale-tolerant, same as every other "does this look free" read in this
  // system (design doc §29's chat-availability check, most notably) — not a
  // reservation, just a bias toward not visibly stacking two NPCs on one
  // spot when other equally-valid spots are sitting empty.
  function isStationOccupied(station, ctx) {
    const stationId = station.stationId || station.id;
    const others = deps.listNpcWalkersInArea?.(station.area) || [];
    return others.some(w => w.rec?.id && w.rec.id !== ctx.npcId && w.currentScheduleTarget?.stationId === stationId);
  }

  function goToRole(ctx, roleOverride) {
    const role = roleOverride || ctx.beat.destinationRole;
    if (!role) return invalidContent('activity requires beat.destinationRole (or destinationStationId)');
    const area = ctx.beat.destinationArea ? deps.normalizeNpcArea(ctx.beat.destinationArea) : null;
    let candidates = deps.findStationsByRole(role, area ? { area } : {});
    if (!candidates.length) return waitingOrUnavailable(area, `no station advertises role "${role}"${area ? ` in ${area}` : ''}`);
    if (!area && ctx.walker) {
      // No area pinned down by the beat — prefer staying in whichever area
      // this NPC is already in over teleport-y cross-map picks, but don't
      // treat "none local" as failure; the full candidate list is still valid.
      const local = candidates.filter(c => c.area === ctx.walker.area);
      if (local.length) candidates = local;
    }
    // Prefer an empty spot over one someone else is already at (design doc
    // §16 — this is exactly what makes "the Khibu living room" work as one
    // shared destinationRole for several chairs instead of every visitor
    // needing their own dedicated station id: whoever resolves this role
    // second just lands on a different untaken seat). Only actually
    // narrows anything when a role has more than one candidate and at
    // least one is free; a single-occupant role like a specific NPC's own
    // work station is completely unaffected.
    const untaken = candidates.filter(c => !isStationOccupied(c, ctx));
    if (untaken.length) candidates = untaken;
    candidates = [...candidates].sort((a, b) => String(a.stationId || a.id).localeCompare(String(b.stationId || b.id)));
    const chosen = pickDeterministic(candidates, ctx.npcId, ctx.now?.day, `${ctx.beat.id}:role`);
    return ready(stationTarget(chosen, ctx));
  }

  function goToStationOrRole(ctx, roleOverride) {
    if (ctx.beat.destinationStationId) return goToStation(ctx);
    if (ctx.beat.destinationRole || roleOverride) return goToRole(ctx, roleOverride);
    return invalidContent(`activity "${ctx.beat.activity}" requires destinationStationId or destinationRole`);
  }

  // ── Registry ──────────────────────────────────────────────────────────
  const registry = new Map();
  function register(key, def) { registry.set(key, def); }
  function get(key) { return registry.get(key) || null; }

  function resolveDestination(beat, callerCtx) {
    const def = get(beat.activity);
    if (!def) return invalidContent(`unknown activity "${beat.activity}" — not registered in NpcActivities`);
    const ctx = { ...callerCtx, beat, deps };
    try { return def.resolveDestination(ctx) || noPlan('activity produced no result'); }
    catch (e) { return invalidContent(`activity "${beat.activity}" threw during resolution: ${e?.message || e}`); }
  }

  // ── Built-in activities ──────────────────────────────────────────────
  // Wraps the entire original, battle-tested legacy resolver
  // (resolveLegacyNpcScheduleTarget in npc-scheduling.js) as one activity,
  // so any NPC with no authored `agenda` still gets planned through this
  // exact pipeline — see design doc §52. This is the compatibility bridge:
  // 100% of existing scheduleHooks/sharedSchedules/positionRedirect/
  // defaultStationId/defaultPosition/legacy-path behavior keeps working
  // unmodified; the planner just no longer treats this activity returning
  // null as "freeze forever" once the NPC actually has a walker (see
  // npc-activity-planner.js's hasExistingWalker gate for why *before* first
  // spawn a null still means null, not a synthesized wander).
  register('legacyScheduleActivity', {
    resolveDestination(ctx) {
      const target = ctx.legacyResolve ? ctx.legacyResolve(ctx.rec) : null;
      return target ? ready(target, 'legacy schedule') : noPlan('legacy schedule: no rule matched now');
    },
  });

  register('goToStation', { resolveDestination: goToStation });
  register('goToRole', { resolveDestination: goToRole });
  register('work', { resolveDestination: ctx => goToStationOrRole(ctx) });
  register('eat', { resolveDestination: ctx => goToStationOrRole(ctx, 'eat') });
  register('drink', { resolveDestination: ctx => goToStationOrRole(ctx, 'drink') });
  register('sleep', { resolveDestination: ctx => goToStationOrRole(ctx, 'sleep') });
  register('shop', { resolveDestination: ctx => goToStationOrRole(ctx, 'shop') });
  register('performMusic', { resolveDestination: ctx => goToStationOrRole(ctx, 'music-performance') });
  // Right up at the front of the crowd — distinct from watchPerformance's
  // personality-varied hang-back distance (design doc §25: "walk right up"
  // is its own listed reaction, not just the close end of watching).
  // A full "bring your own instrument and back up the player" flow already
  // exists (js/music-minigame.js's leader/backup join, driven by
  // INSTRUMENT_NPC_DEFS in npc-scheduling.js), but only in the direction of
  // the player joining an NPC's own lead — there's no session hook today
  // for an NPC to join the *player's* lead the way this reaction implies.
  // Actually wiring that up is a real music-minigame.js session change,
  // deliberately left for later rather than bolted on here; for now an
  // interested NPC (instrument-owner or not) just gets to the front.
  register('joinPerformance', {
    resolveDestination(ctx) {
      if (ctx.beat.destinationRole) return goToRole(ctx, ctx.beat.destinationRole);
      const stim = ctx.opportunityStimulus;
      if (!stim || !ctx.walker) return goToRole(ctx, 'watch-performance');
      const dir = pickDeterministic([[0.7, 0.5], [-0.7, 0.5], [0.7, -0.5], [-0.7, -0.5]], ctx.npcId, ctx.now?.day, `join:${stim.id}`);
      return ready({
        area: stim.area, c: Math.floor(stim.x + dir[0]), r: Math.floor(stim.z + dir[1]),
        pose: 'stand', id: `join-${stim.id}`, activity: ctx.beat.activityLabel || 'joining the crowd',
      }, 'joining the crowd up front');
    },
  });

  // "Just be here" — an authored resting-place (goToStation) if given, else
  // (only meaningful for an already-spawned NPC) stay exactly where they
  // are, which is the honest state for e.g. "day off, at home" when no
  // single tile has been authored for it.
  register('idle', {
    resolveDestination(ctx) {
      if (ctx.beat.destinationStationId || ctx.beat.destinationRole) return goToStationOrRole(ctx);
      if (!ctx.walker) return invalidContent('idle activity with no destination needs an existing walker to "stay put" at');
      const p = ctx.walker.root.position;
      return ready({
        area: ctx.walker.area, c: Math.floor(p.x), r: Math.floor(p.z),
        pose: 'stand', activity: ctx.beat.activityLabel || ctx.beat.activity || 'idle',
      }, 'staying put');
    },
  });

  // Intentional breaks (design doc §21) and any other "no fixed idea what
  // to do, figure it out" beat both just ask the free-time planner —
  // exactly the unification design doc §44 asks for (breaks, schedule
  // gaps, and activity failures should never be bespoke one-off systems).
  register('break', { resolveDestination: ctx => ctx.planner.runFreeTime(ctx) });
  register('freeTime', { resolveDestination: ctx => ctx.planner.runFreeTime(ctx) });

  // Relationship/preference-aware destination choice (design doc §16/§28) —
  // generalizes the bespoke Kaboku "visit family, or avoid Kinami at the
  // inn" presenceChoices hack in schedule-overrides.json into live scoring
  // any NPC's agenda can opt into via `beat.preferences`, instead of a
  // precompiled per-weekday rule list.
  function socialize(ctx) {
    const prefs = ctx.beat.preferences || {};
    const preferArea = prefs.preferArea ? deps.normalizeNpcArea(prefs.preferArea) : null;
    const presentAmong = ids => (ids || []).some(id => {
      const w = deps.findNpcWalker(id);
      return !!w && (!preferArea || w.area === preferArea);
    });
    const preferredPresent = presentAmong(prefs.preferNpcIds);
    const avoidedPresent = presentAmong(prefs.avoidNpcIds);
    if (preferredPresent && !avoidedPresent && (prefs.preferStationId || prefs.preferRole)) {
      const res = goToStationOrRole({
        ...ctx,
        beat: { ...ctx.beat, destinationStationId: prefs.preferStationId, destinationRole: prefs.preferRole, destinationArea: prefs.preferArea },
      });
      if (res.status === STATUS.READY) return { ...res, reason: 'preferred company present' };
    }
    if (prefs.fallbackStationId || prefs.fallbackRole) {
      const res = goToStationOrRole({
        ...ctx,
        beat: { ...ctx.beat, destinationStationId: prefs.fallbackStationId, destinationRole: prefs.fallbackRole, destinationArea: prefs.fallbackArea },
      });
      if (res.status === STATUS.READY) return { ...res, reason: avoidedPresent ? 'avoiding someone' : 'preferred company absent' };
    }
    // No usable preferences configured, or nothing they pointed at
    // resolved — "go socialize" with no further instructions just means
    // "go find something/someone", i.e. free time.
    return ctx.planner.runFreeTime(ctx);
  }
  register('socialize', { resolveDestination: socialize });
  register('visit', { resolveDestination: socialize });

  // ── Free-time opportunity primitives ────────────────────────────────
  // These double as the concrete resolvers the free-time planner's
  // opportunity scorer calls once it has already decided *which* option
  // won (design doc §16/§42) — the scorer stashes its choice on ctx
  // (opportunityStationId / opportunityPartnerId / opportunityStimulus) so
  // picking WHO/WHAT and resolving a WORLD POSITION for them stay separate
  // concerns. They're also independently registered so an author can point
  // an ordinary agenda beat straight at one (e.g. `activity: 'wander'`).

  register('wander', {
    resolveDestination(ctx) {
      if (!ctx.walker) return invalidContent('wander requires an existing walker (no position to wander around)');
      const p = ctx.walker.root.position;
      const cfg = window.SCRATCHBONES_CONFIG?.game?.movement?.npc?.freeTimeWanderRadiusTiles;
      return ready({
        area: ctx.walker.area, c: Math.floor(p.x), r: Math.floor(p.z),
        pose: 'stand', wanderRadiusTiles: Number.isFinite(cfg) ? cfg : 2.5, wanderMode: 'radius',
        id: 'freetime-wander', activity: ctx.beat.activityLabel || 'wandering',
      }, 'local wander (terminal fallback)');
    },
  });

  register('sit', {
    resolveDestination(ctx) {
      if (!ctx.walker) return invalidContent('sit requires an existing walker');
      if (ctx.opportunityStationId) {
        const s = deps.resolveNpcStationTarget(ctx.opportunityStationId);
        if (s) return ready(stationTarget(s, ctx), 'sitting');
      }
      return goToRole(ctx, 'sit');
    },
  });

  register('chat', {
    resolveDestination(ctx) {
      if (!ctx.walker) return invalidContent('chat requires an existing walker');
      const partnerId = ctx.opportunityPartnerId;
      const partner = partnerId ? deps.findNpcWalker(partnerId) : null;
      if (!partner) return unavailable('no available chat partner nearby');
      // A live invitation (design doc §29) fixes one shared meeting point
      // both sides resolve toward, instead of each independently walking
      // toward wherever the other currently happens to be (which could
      // chase a moving target forever if both are doing that at once).
      // Falls back to "stand next to wherever they are right now" when
      // there's no invitation in play — an authored agenda beat can still
      // point `chat` straight at a specific partner with no negotiation.
      const meet = ctx.opportunityMeetingPoint;
      const baseX = meet ? meet.x : partner.root.position.x;
      const baseZ = meet ? meet.z : partner.root.position.z;
      const area = meet ? meet.area : partner.area;
      // Both sides agree on opposite offsets without negotiating which one
      // to take by comparing ids the same way on both ends — deterministic
      // and symmetric, so they land facing each other instead of stacking.
      const side = String(ctx.npcId) < String(partnerId) ? 1 : -1;
      const offset = pickDeterministic([[side * 0.75, 0.35], [side * 0.75, -0.35]], ctx.npcId, ctx.now?.day, `chat:${partnerId}`);
      return ready({
        area, c: Math.floor(baseX + offset[0]), r: Math.floor(baseZ + offset[1]),
        pose: 'stand', id: `chat-with-${partnerId}`, activity: ctx.beat.activityLabel || 'chatting',
      }, meet ? `chatting with ${partner.rec?.name || partnerId} (invited)` : `chatting with ${partner.rec?.name || partnerId}`);
    },
  });

  // Reaction variety by personality (design doc §25: "watch from afar" and
  // "walk right up" are both on the list, not just one fixed distance) —
  // shyer/less sociable NPCs hang back further, bolder/more sociable ones
  // come in close. Direction is deterministic per (npc, stimulus instance)
  // same as every other opportunity pick, so it doesn't flicker tick to tick.
  function watchPerformanceImpl(ctx) {
    if (ctx.beat.destinationRole) return goToRole(ctx, ctx.beat.destinationRole);
    const stim = ctx.opportunityStimulus;
    if (stim && ctx.walker) {
      const personality = ctx.rec?.personality || {};
      const shyness = Math.max(0, Math.min(1, personality.shyness ?? 0.3));
      const sociability = Math.max(0, Math.min(1, personality.sociability ?? 0.5));
      const boldness = Math.max(0, Math.min(1, sociability * 0.7 + (1 - shyness) * 0.3));
      const dist = 3.0 - boldness * 1.8; // ~1.2 tiles (up close) .. ~3.0 tiles (from afar)
      const dir = pickDeterministic([[1, 0.6], [-1, 0.6], [1, -0.6], [-1, -0.6]], ctx.npcId, ctx.now?.day, `watch:${stim.id}`);
      const mag = Math.hypot(dir[0], dir[1]) || 1;
      const label = boldness > 0.62 ? 'watching up close' : boldness < 0.38 ? 'watching from afar' : 'watching a performance';
      return ready({
        area: stim.area, c: Math.floor(stim.x + (dir[0] / mag) * dist), r: Math.floor(stim.z + (dir[1] / mag) * dist),
        pose: 'stand', id: `watch-${stim.id}`, activity: ctx.beat.activityLabel || label,
      }, label);
    }
    return goToRole(ctx, 'watch-performance');
  }
  register('watchPerformance', { resolveDestination: watchPerformanceImpl });

  window.NpcActivities = {
    init,
    STATUS,
    register,
    get,
    resolveDestination,
    // Exposed for the planner's free-time scorer and for tests.
    ready, noPlan, invalidContent, unavailable, waitingForWorld,
    pickDeterministic, isStationOccupied,
  };
})();
