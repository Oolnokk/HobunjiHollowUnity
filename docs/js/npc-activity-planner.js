(() => {
  'use strict';

  // NPC Activity Planner: the orchestrator (design doc §46's "activity
  // scoring, replanning, interruptions, fallbacks, free-time behavior,
  // personality modifiers"). This is the module npc-scheduling.js's
  // resolveNpcScheduleTarget bridge actually calls.
  //
  // Responsibilities, in the order a single resolveNpcTarget() call walks
  // through them:
  //   1. Ask npc-agenda.js which of this NPC's beats are eligible right now.
  //   2. If a compelling nearby social stimulus exists and the top beat
  //      isn't critical, suspend it in favor of free time (which will very
  //      likely — but isn't guaranteed to — pick watchPerformance itself).
  //   3. Otherwise try to resolve the top beat, then lower-priority
  //      eligible beats, via npc-activities.js.
  //   4. Anything that doesn't resolve falls through to the free-time
  //      planner, which — for an NPC that actually has a walker — always
  //      returns *something* (worst case: local wander). A destination
  //      target is never bare null for an NPC already living in the world.
  //
  // One deliberate simplification, called out because it's easy to assume
  // otherwise from the design doc's "SUSPEND WORK ↓ WATCH PERFORMANCE ↓ ...
  // ↓ RESUME WORK" diagram (§22): there is no persistent suspended-activity
  // state machine here. Every call recomputes the best current beat fresh
  // from scratch (exactly like the legacy resolver already did every
  // tick) and only *additionally* asks "is something more interesting
  // happening right now". "Resume" isn't a stored transition — it's simply
  // what happens automatically the next tick the interruption gate doesn't
  // fire, because the same time-window beat is, again, the best eligible
  // one. memory.suspendedBeatId exists purely so the debug panel and logs
  // can say what's suspended; nothing reads it to decide behavior. This is
  // the "keep the math simple, don't build a heavy simulation" tradeoff
  // design doc §42/§55 explicitly asks for.
  //
  // The one place real cross-tick state *does* change behavior is
  // memory.offscreenCache (design doc §2/§54): an NPC the player currently
  // cannot see gets a full fresh replan only every OFFSCREEN_RECHECK_INTERVAL_MS,
  // not every call — this redesign adds real planning work on top of what
  // the legacy resolver already did every frame for every NPC regardless of
  // area, so without this the net effect would be *more* off-screen cost,
  // the opposite of what §54 asks for. A visible NPC (or one with no walker
  // yet) is never throttled.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function nowMs() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function currentGameMinutes() { return Math.round(window.CalendarSystem.getHour() * 60); }

  // A no-agenda NPC's one and only beat: "whatever the legacy resolver
  // says". obligation 'duty' matches the legacy system's own behavior —
  // always follow the schedule rigidly — as closely as an obligation label
  // can; the point of this tier isn't to *change* legacy behavior, it's to
  // make its failures recoverable instead of freezing (see the
  // hasExistingWalker branch below).
  const LEGACY_BEATS = Object.freeze([Object.freeze({
    id: 'legacy', activity: 'legacyScheduleActivity', obligation: 'duty', alwaysEligible: true, activityLabel: '',
  })]);

  function getBeatsForRec(rec) {
    return (Array.isArray(rec?.agenda) && rec.agenda.length) ? rec.agenda : LEGACY_BEATS;
  }

  // ── Per-NPC short-term memory (design doc §32) ──────────────────────
  // Ephemeral, in-memory only (never persisted/saved) — ordinary
  // moment-to-moment activity state is exactly what design doc §4 says
  // should *not* survive beyond the current session. A page reload clears
  // it, same as every other runtime-only NPC walker state today.
  const memoryByNpcId = new Map();
  function getMemory(npcId) {
    let m = memoryByNpcId.get(npcId);
    if (!m) {
      m = {
        lastActivityId: null, lastPartnerId: null, lastBeatId: null, lastObligation: null,
        lastStatus: null, lastSource: null, lastReason: '', lastReplanAtMin: null,
        recentStationIds: [], suspendedBeatId: null,
        lastInterruptCheckMs: 0, lastInterruptResult: null,
        noticedStimulusId: null, noticedAtMs: 0,
        cooldownUntilMs: {}, lastOpportunityScores: [],
      };
      memoryByNpcId.set(npcId, m);
    }
    return m;
  }

  const COOLDOWN_MS = 4000; // How long a specific failed beat is skipped before retrying — long enough not to spam loadBuildingScene/logs every frame, short enough that a WAITING_FOR_WORLD beat picks back up quickly once its area finishes loading.
  const OFFSCREEN_RECHECK_INTERVAL_MS = 2500; // How stale a cached target may get for an NPC the player currently cannot see (design doc §2/§54) — imperceptible off-screen, but keeps a full replan from running every frame for every NPC in the game regardless of visibility.
  function isOnCooldown(memory, beatId, t) { return (memory.cooldownUntilMs[beatId] || 0) > t; }
  function setCooldown(memory, beatId, t) { memory.cooldownUntilMs[beatId] = t + COOLDOWN_MS; }

  // Logged once per exact (npc, beat, status, reason) tuple, ever — an
  // authoring bug (a renamed station, a typo'd role) doesn't fix itself by
  // waiting, so re-logging it every few seconds forever would only be
  // noise (design doc §50: "do not spam continuously every frame").
  const _loggedFailureKeys = new Set();
  function logFailure(npcId, beat, res) {
    const key = `${npcId}|${beat.id}|${res.status}|${res.reason}`;
    if (_loggedFailureKeys.has(key)) return;
    _loggedFailureKeys.add(key);
    const level = res.status === 'WAITING_FOR_WORLD' ? 'info' : 'warn';
    window.__farmLog?.(`[planner] ${npcId}: "${beat.activity}" (beat "${beat.id}") → ${res.status}${res.reason ? ` — ${res.reason}` : ''}`, level);
  }

  function buildCtx(rec, walker) {
    const day = deps.calendar.day;
    const weekdayName = window.CalendarSystem.currentWeekdayName();
    const nowMin = currentGameMinutes();
    return {
      rec, npcId: rec?.id, walker, area: walker?.area || null,
      now: { nowMin, day, weekdayName },
      planner: window.NpcActivityPlanner,
    };
  }

  // ── Stimulus interruption gate (design doc §22-25) ──────────────────
  const INTERRUPT_CHECK_INTERVAL_MS = 500; // Throttled — never a per-frame stimulus scan (design doc §54).
  const INTEREST_THRESHOLD = 0.28;
  // A crowd should gather gradually — "one NPC looks over, one approaches,
  // another sits nearby..." (design doc §43) — not everyone converging the
  // instant a stimulus clears the interest bar. NOTICE_DELAY_BASE_MS..+SPREAD_MS
  // is how long an NPC "sits with" a compelling stimulus before actually
  // committing, individually varied per (npc, stimulus instance) so the
  // most drawn-in react first and the rest trickle in over the next few
  // seconds instead of all at once.
  const NOTICE_DELAY_BASE_MS = 600;
  const NOTICE_DELAY_SPREAD_MS = 5000;
  function checkStimulusInterruption(rec, walker, topBeat, memory) {
    const t = nowMs();
    if (t - memory.lastInterruptCheckMs < INTERRUPT_CHECK_INTERVAL_MS) return memory.lastInterruptResult;
    memory.lastInterruptCheckMs = t;
    window.NpcSocialStimuli?.pollPlayerMusic?.();
    const pos = walker.root.position;
    const found = window.NpcSocialStimuli?.strongestNear?.(walker.area, pos.x, pos.z);
    if (!found) { memory.noticedStimulusId = null; memory.lastInterruptResult = null; return null; }
    const personality = rec?.personality || {};
    const musicalInterest = clamp01(personality.musicalInterest ?? 0.5);
    const sociability = clamp01(personality.sociability ?? 0.5);
    const obligationResistance = window.NpcAgenda.obligationWeight(topBeat.obligation) / window.NpcAgenda.obligationWeight('critical');
    const interest = found.proximity * found.stimulus.strength * (0.5 + 0.5 * musicalInterest) * (0.7 + 0.3 * sociability) - obligationResistance * 0.4;
    if (interest <= INTEREST_THRESHOLD) { memory.noticedStimulusId = null; memory.lastInterruptResult = null; return null; }

    const stimId = found.stimulus.id;
    if (memory.noticedStimulusId !== stimId) { memory.noticedStimulusId = stimId; memory.noticedAtMs = t; }
    const noticeDelayMs = NOTICE_DELAY_BASE_MS + window.NpcAgenda.dailySeed(rec?.id, 0, `notice:${stimId}`) * NOTICE_DELAY_SPREAD_MS * (1 - 0.5 * clamp01(interest));
    const result = (t - memory.noticedAtMs >= noticeDelayMs) ? found : null;
    memory.lastInterruptResult = result;
    return result;
  }

  // ── Free-time planner (design doc §16/§42/§44) ──────────────────────
  // Every gap, break, failure, or spontaneous moment funnels through here.
  // Opportunity primitives (never call back into runFreeTime — see the
  // module comment above about avoiding recursion) each contribute a
  // scored candidate; the highest wins, with `wander` always present as an
  // unconditional floor so this function can never come back empty
  // (design doc §17's terminal-fallback invariant).
  const FREE_TIME_BASE = { wander: 5, sit: 12, chat: 18, watchPerformance: 22 };
  const FREE_TIME_LABELS = { wander: 'Wandering', sit: 'Sitting', chat: 'Chatting', watchPerformance: 'Watching a performance' };
  function seedNoise(npcId, day, salt) { return (window.NpcAgenda.dailySeed(npcId, day, `freetime:${salt}`) - 0.5) * 4; }

  function relationshipBonus(rec, otherId) {
    const prefs = rec?.socialPreferences;
    if (!prefs) return 0;
    if (prefs.preferNpcIds?.includes(otherId)) return 8;
    if (prefs.avoidNpcIds?.includes(otherId)) return -20;
    return 0;
  }

  // ── NPC-to-NPC invitations (design doc §29/§30) ─────────────────────
  // A real, if minimal, invite/accept exchange instead of one NPC just
  // unilaterally walking at another: whoever's free-time scorer picks
  // "chat with X" first proposes a single shared meeting point (both ends
  // resolve toward the *same* fixed spot — see npc-activities.js's chat
  // activity — rather than each independently chasing wherever the other
  // currently stands); the invited NPC's own next planner tick sees it
  // and, only if they're actually free to, can accept it as a high-scoring
  // opportunity of their own. Neither side blocks or waits on the other —
  // an unanswered invitation just expires and each side's own free-time
  // scoring carries on as normal, so there's no deadlock or synchronous
  // handshake to get stuck on, matching every other "recompute fresh every
  // tick" decision in this file.
  const pendingInvitations = new Map(); // toNpcId -> { fromId, x, z, area, createdAtMs }
  const INVITATION_TTL_MS = 6000; // Comfortably longer than either side's own free-time re-evaluation cadence, so a normal round-trip has time to land.
  function liveInvitationTo(npcId) {
    const inv = pendingInvitations.get(npcId);
    if (!inv || nowMs() - inv.createdAtMs > INVITATION_TTL_MS) return null;
    return inv;
  }
  function proposeInvitationTo(fromId, toWalker, fromPos) {
    const existing = pendingInvitations.get(toWalker.rec.id);
    // Reuse the same meeting point on every tick a still-live invitation is
    // outstanding, rather than recomputing a fresh midpoint each time (which
    // would make the inviter's own walk target jitter around while waiting).
    if (existing && existing.fromId === fromId && nowMs() - existing.createdAtMs <= INVITATION_TTL_MS) return existing;
    const tp = toWalker.root.position;
    const inv = { fromId, x: (fromPos.x + tp.x) / 2, z: (fromPos.z + tp.z) / 2, area: toWalker.area, createdAtMs: nowMs() };
    pendingInvitations.set(toWalker.rec.id, inv);
    return inv;
  }

  function runFreeTime(ctx, opts = {}) {
    const { npcId, walker } = ctx;
    const day = ctx.now?.day;
    const memory = getMemory(npcId);
    const personality = ctx.rec?.personality || {};
    const candidates = [{ key: 'wander', score: FREE_TIME_BASE.wander + seedNoise(npcId, day, 'wander') }];

    // Off-screen NPCs skip the rich (station/partner/stimulus-scanning)
    // evaluation entirely — nobody can see the result, so it's pure cost
    // with no payoff (design doc §3/§54). They still always get a valid
    // wander fallback from the line above.
    const isVisible = !!walker && walker.area === deps.getCurrentArea();
    if (isVisible) {
      const pos = walker.root.position;
      const found = ctx.opportunityStimulus ? { stimulus: ctx.opportunityStimulus, proximity: 1 } : window.NpcSocialStimuli?.strongestNear?.(walker.area, pos.x, pos.z);

      const allSitStations = deps.findStationsByRole?.('sit', { area: walker.area }) || [];
      // Prefer an empty seat over one someone else is already using, same
      // bias as goToRole — falls back to the full list if every seat in the
      // area happens to be taken, so it's still always able to sit somewhere.
      const untakenSitStations = allSitStations.filter(s => !window.NpcActivities.isStationOccupied(s, ctx));
      const sitStations = untakenSitStations.length ? untakenSitStations : allSitStations;
      if (sitStations.length) {
        let nearest = null, nearestD = Infinity;
        for (const s of sitStations) {
          const d = Math.hypot(pos.x - (s.c + 0.5), pos.z - (s.r + 0.5));
          if (d < nearestD) { nearestD = d; nearest = s; }
        }
        if (nearest && nearestD <= 10) {
          const rep = memory.lastActivityId === 'sit' ? -6 : 0;
          // A free bench near an ongoing performance is a much more
          // attractive seat than a random one — "another walks out of
          // nearby activity, sits nearby" (design doc §43) falls out of
          // this naturally: sit and watchPerformance just compete on score
          // like any other pair of opportunities, no separate mechanism.
          let stimBonus = 0;
          if (found) {
            const s = found.stimulus;
            const dStim = Math.hypot((nearest.c + 0.5) - s.x, (nearest.r + 0.5) - s.z);
            if (dStim <= (s.radius || 8)) stimBonus = 10 * (1 - dStim / (s.radius || 8));
          }
          candidates.push({
            key: 'sit', stationId: nearest.stationId || nearest.id,
            score: FREE_TIME_BASE.sit + (personality.restfulness ?? 0.5) * 6 - nearestD * 0.4 + rep + stimBonus + seedNoise(npcId, day, 'sit'),
          });
        }
      }

      // Someone already invited ME — accepting is a strong, personal signal
      // that generally beats a spontaneous pick of my own, so it's scored
      // with a flat bonus on top of the normal chat math rather than
      // competing on proximity/sociability alone.
      const incoming = liveInvitationTo(npcId);
      if (incoming) {
        const fromWalker = deps.findNpcWalker(incoming.fromId);
        if (fromWalker) {
          const rep = memory.lastPartnerId === incoming.fromId ? -8 : 0;
          candidates.push({
            key: 'chat', partnerId: incoming.fromId, meetingPoint: incoming,
            score: FREE_TIME_BASE.chat + 15 + (personality.sociability ?? 0.5) * 6 + relationshipBonus(ctx.rec, incoming.fromId) + rep + seedNoise(npcId, day, 'chat-accept'),
          });
        }
      }

      const others = (deps.listNpcWalkersInArea?.(walker.area) || []).filter(w => w.rec?.id && w.rec.id !== npcId);
      let bestPartner = null, bestPartnerD = Infinity;
      for (const w of others) {
        // currentScheduleTarget.obligation is whatever that NPC's own
        // planner tick last settled on — up to one frame stale if this
        // frame hasn't reached them yet. That's fine for "does this person
        // look free to chat", which is inherently a loose/organic read —
        // the actual accept/decline happens on their own tick above, via
        // liveInvitationTo, not by trusting this snapshot as a guarantee.
        const obligation = w.currentScheduleTarget?.obligation;
        const availability = obligation ? 1 - window.NpcAgenda.obligationWeight(obligation) / window.NpcAgenda.obligationWeight('critical') : 0.6;
        if (availability < 0.15) continue;
        const d = Math.hypot(pos.x - w.root.position.x, pos.z - w.root.position.z);
        if (d <= 9 && d < bestPartnerD) { bestPartnerD = d; bestPartner = w; }
      }
      if (bestPartner) {
        const rep = memory.lastPartnerId === bestPartner.rec.id ? -8 : 0;
        const invitation = proposeInvitationTo(npcId, bestPartner, pos);
        candidates.push({
          key: 'chat', partnerId: bestPartner.rec.id, meetingPoint: invitation,
          score: FREE_TIME_BASE.chat + (personality.sociability ?? 0.5) * 10 + relationshipBonus(ctx.rec, bestPartner.rec.id) - bestPartnerD * 0.5 + rep + seedNoise(npcId, day, 'chat'),
        });
      }

      if (found) {
        const rep = memory.lastActivityId === 'watching-performance' ? -4 : 0;
        candidates.push({
          key: 'watchPerformance', stimulus: found.stimulus,
          score: FREE_TIME_BASE.watchPerformance * found.proximity * (0.4 + 0.6 * clamp01(personality.musicalInterest ?? 0.5)) + rep + seedNoise(npcId, day, 'watch'),
        });
      }
    }

    if (opts.preferOpportunity) {
      const c = candidates.find(c => c.key === opts.preferOpportunity);
      if (c) c.score += 1000; // A stimulus-interrupt call already decided watchPerformance should win the tie against e.g. an equally-scored chat.
    }
    candidates.sort((a, b) => b.score - a.score);
    memory.lastOpportunityScores = candidates.map(c => ({ key: c.key, score: Math.round(c.score * 10) / 10 }));

    for (const chosen of candidates) {
      const beat = window.NpcAgenda.normalizeAgendaBeat(
        { id: `freetime-${chosen.key}`, activity: chosen.key, obligation: 'leisure', activityLabel: FREE_TIME_LABELS[chosen.key] || chosen.key }, 0);
      const res = window.NpcActivities.resolveDestination(beat, {
        ...ctx, opportunityStationId: chosen.stationId, opportunityPartnerId: chosen.partnerId, opportunityStimulus: chosen.stimulus, opportunityMeetingPoint: chosen.meetingPoint,
      });
      if (res.status === window.NpcActivities.STATUS.READY) {
        memory.lastPartnerId = chosen.partnerId || null;
        return res;
      }
      // wander is always last (lowest guaranteed base score) and can only
      // fail this way if there's genuinely no walker to wander around —
      // i.e. runFreeTime was reached without a live NPC at all, which
      // resolveNpcTarget's hasExistingWalker gate is specifically meant to
      // prevent. Keep looping the (short) candidate list regardless so a
      // transient failure of a *higher*-scored opportunity still tries the
      // next one instead of giving up immediately.
    }
    return window.NpcActivities.noPlan('free-time: no opportunity (including wander) could resolve — no walker?');
  }

  // ── Main entry point ─────────────────────────────────────────────────
  function finalize(memory, result, source, beat, walker) {
    const target = result?.target || null;
    if (target) {
      target.semanticActivity = target.semanticActivity || target.activity || beat?.activity || 'idle';
      target.obligation = beat?.obligation || 'leisure';
      target.plannerStatus = result.status;
      target.plannerReason = result.reason || '';
      target.plannerSource = source;
      target.beatId = beat?.id || null;
    }
    // Always refreshed, whether or not this NPC is currently visible — so
    // the off-screen throttle above has an up-to-date answer ready the
    // instant this NPC drops out of view.
    memory.offscreenCache = { target: target ? { ...target } : null, area: walker?.area ?? null, at: nowMs() };
    memory.lastStatus = result?.status || null;
    memory.lastSource = source;
    memory.lastReason = result?.reason || '';
    memory.lastBeatId = beat?.id || null;
    memory.lastObligation = target?.obligation || null;
    if (target) {
      memory.lastActivityId = target.semanticActivity;
      if (target.stationId) memory.recentStationIds = [target.stationId, ...memory.recentStationIds.filter(s => s !== target.stationId)].slice(0, 3);
    }
    return target;
  }

  function resolveNpcTarget(rec, extra = {}) {
    const { legacyResolve } = extra;
    const npcId = rec?.id;
    let hasExistingWalker = !!extra.hasExistingWalker;
    let walker = hasExistingWalker ? deps.findNpcWalker(npcId) : null;
    if (hasExistingWalker && !walker) hasExistingWalker = false; // defensive — treat as pre-spawn if the lookup disagrees.

    // Off-screen throttle (design doc §2/§54): a walker nobody can see still
    // needs *some* valid target every frame (its own update() keeps moving
    // it toward one, and things like catchNpcsOnPlayerAreaTransition read
    // it), but nothing requires that target to be freshly replanned every
    // single frame — nobody is watching closely enough to notice a couple
    // seconds of lag. A visible NPC (or one with no walker yet) always gets
    // a fully fresh resolution below; this only ever shortcuts the
    // expensive path for NPCs the player currently cannot see. Returns a
    // shallow clone, never the cached object itself, so this stays
    // consistent with every other branch here always handing back a target
    // nothing downstream should assume it can safely mutate long-term.
    if (hasExistingWalker && walker.area !== deps.getCurrentArea()) {
      const memory = getMemory(npcId);
      const cache = memory.offscreenCache;
      if (cache && cache.area === walker.area && (nowMs() - cache.at) < OFFSCREEN_RECHECK_INTERVAL_MS) {
        return cache.target ? { ...cache.target } : null;
      }
    }

    const ctx0 = buildCtx(rec, walker);
    const beats = getBeatsForRec(rec);
    const eligible = window.NpcAgenda.pickEligibleBeats(beats, ctx0.now);

    // ── Pre-spawn: preserve existing semantics exactly ──────────────────
    // spawnScheduledNpcs()/_retrySpawnDeferredNpcs() already have a
    // purpose-built "keep retrying every second, give up after ~30s"
    // mechanism for a null result — see npc-scheduling.js's bridge for the
    // full reasoning. Two things must NOT change here:
    //   - an NPC authored with genuinely no schedule content at all
    //     (no rules, no defaults, no agenda — several quest/story NPCs in
    //     the roster are like this on purpose) must keep never spawning;
    //   - an NPC whose real first destination just hasn't loaded yet must
    //     keep waiting for it, not pop into existence at a generic wander
    //     tile and only *then* start walking to where they actually belong.
    // So: no free-time synthesis before an NPC has ever had a walker — free
    // time/wander fundamentally can't produce one anyway (every opportunity
    // in runFreeTime, wander included, needs a live walker position to
    // resolve around). That means an agenda whose eligible beat *right at
    // boot* is a pure free-time beat (activity:'break', or 'idle' with no
    // destination — see design doc §44's break/gap/leisure beats) would
    // otherwise defer this NPC forever if the player happens to load during
    // exactly that window. legacyResolve is the fix: every converted NPC
    // still carries its original scheduleHooks untouched specifically as
    // this safety net (its defaultStationId/defaultPosition/legacy path),
    // so falling back to it here — same as a no-agenda NPC already does —
    // guarantees a sane bootstrap position without inventing one.
    if (!hasExistingWalker) {
      if (!(Array.isArray(rec?.agenda) && rec.agenda.length)) return legacyResolve ? legacyResolve(rec) : null;
      for (const beat of eligible) {
        const res = window.NpcActivities.resolveDestination(beat, { ...ctx0, legacyResolve });
        if (res.status === window.NpcActivities.STATUS.READY) return res.target;
      }
      return legacyResolve ? legacyResolve(rec) : null;
    }

    // ── Live: this NPC already exists in the world ──────────────────────
    const memory = getMemory(npcId);
    memory.lastReplanAtMin = ctx0.now.nowMin;
    const topBeat = eligible[0] || null;

    if (topBeat && topBeat.obligation !== 'critical' && walker.area === deps.getCurrentArea()) {
      const interrupt = checkStimulusInterruption(rec, walker, topBeat, memory);
      if (interrupt) {
        memory.suspendedBeatId = topBeat.id;
        const result = runFreeTime({ ...ctx0, legacyResolve, opportunityStimulus: interrupt.stimulus }, { preferOpportunity: 'watchPerformance' });
        return finalize(memory, result, 'stimulus-interrupt', topBeat, walker);
      }
    }
    memory.suspendedBeatId = null;

    let attempts = 0;
    for (const beat of eligible) {
      if (attempts >= 4) break; // Bounded — this loop can never spin unboundedly even with a pathological agenda.
      if (isOnCooldown(memory, beat.id, nowMs())) continue;
      attempts++;
      const res = window.NpcActivities.resolveDestination(beat, { ...ctx0, legacyResolve });
      if (res.status === window.NpcActivities.STATUS.READY) return finalize(memory, res, beat === topBeat ? 'agenda' : 'agenda-fallback', beat, walker);
      if (res.status !== window.NpcActivities.STATUS.NO_PLAN) {
        logFailure(npcId, beat, res);
        setCooldown(memory, beat.id, nowMs());
      }
    }

    const free = runFreeTime({ ...ctx0, legacyResolve });
    return finalize(memory, free, eligible.length ? 'activity-failure-fallback' : 'free-time', null, walker);
  }

  // ── Debug (design doc §49) ───────────────────────────────────────────
  function debugSnapshot(npcId) {
    const walker = deps.findNpcWalker(npcId);
    if (!walker) return null;
    const rec = walker.rec;
    const memory = memoryByNpcId.get(npcId) || null;
    const ctx = buildCtx(rec, walker);
    const eligible = window.NpcAgenda.pickEligibleBeats(getBeatsForRec(rec), ctx.now);
    const topBeat = eligible[0] || null;
    return {
      npcId, name: rec?.name || npcId, area: walker.area,
      hasAgenda: Array.isArray(rec?.agenda) && rec.agenda.length > 0,
      currentActivity: walker.currentScheduleTarget?.semanticActivity || walker.currentScheduleTarget?.activity || '(none)',
      source: memory?.lastSource || '(none)',
      status: memory?.lastStatus || '(none)',
      failureReason: memory?.lastReason || '',
      intendedBeatId: topBeat?.id || null,
      intendedActivityLabel: topBeat ? (topBeat.activityLabel || topBeat.activity) : null,
      intendedWindow: topBeat ? window.NpcAgenda.resolveBeatWindow(topBeat, { npcId, day: ctx.now.day }) : null,
      suspendedBeatId: memory?.suspendedBeatId || null,
      lastReplanAtMin: memory?.lastReplanAtMin ?? null,
      dailySeed: window.NpcAgenda.dailySeed(npcId, ctx.now.day, 'debug'),
      recentStationIds: memory?.recentStationIds || [],
      opportunityScores: memory?.lastOpportunityScores || [],
    };
  }

  window.NpcActivityPlanner = { init, resolveNpcTarget, runFreeTime, debugSnapshot };
})();
