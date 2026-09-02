(() => {
  'use strict';

  // NPC Agenda: the "flexible life" half of the Agenda + Activity Planner
  // redesign (see the design doc referenced in the PR this shipped with —
  // "NPC Schedule / Agenda / Activity System Redesign"). This module owns
  // exactly the things section 46 assigns to it and nothing else:
  //
  //   - agenda beat normalization (defaults, stable ids)
  //   - daily deterministic variation (dailySeed)
  //   - time/daypart matching (dayparts, window/jitter resolution)
  //   - "which beats are eligible right now" selection
  //
  // It does NOT know about stations, walkers, THREE, or the DOM — pure
  // data-in/data-out so it's cheap to unit test (see
  // scripts/test-npc-agenda.js) and safe to load in any order relative to
  // the rendering stack. npc-activity-planner.js is the only caller.
  //
  // An authored agenda beat looks like:
  //   {
  //     id: 'work',                     // stable id (defaults to `${activity}#${index}`)
  //     activity: 'work',               // key into window.NpcActivities' registry
  //     daypart: ['morning','afternoon']// OR a single daypart name, OR:
  //     window: ['08:00','16:00'],      // an exact clock range (either form, not both)
  //     duration: ['4h','6h'],          // optional — see resolveBeatWindow's jitter
  //     jitter: true,                   // optional — jitter a window with no duration range
  //     obligation: 'duty',             // critical|duty|plan|leisure (default 'plan')
  //     destinationRole: 'smith-work',  // semantic destination (preferred — see npc-activities.js)
  //     destinationStationId: '',       // exact station id (for genuinely unique/story spots)
  //     destinationArea: '',            // optional area hint for role search
  //     day / days / daysExcept: ...,   // same weekday filtering as legacy scheduleHooks rules
  //     activityLabel: 'Smithing',      // human label — feeds legacy-compatible `activity` string
  //     preferences: {},                // activity-specific hints (see e.g. npc-activities.js's `socialize`)
  //     interruptibility: 0..1,         // optional override of the activity's default
  //   }
  //
  // "08:00-16:00 does not mean stand in one place continuously from 08:00 to
  // 16:00 — it means this is an appropriate period for this activity to
  // occur" (design doc §6). Concretely: the window/daypart just decides
  // *eligibility*; what the NPC is actually doing tile-by-tile during that
  // window is npc-activities.js's and the station's own wander config's job.

  const OBLIGATION_LEVELS = ['critical', 'duty', 'plan', 'leisure'];
  const OBLIGATION_WEIGHT = { critical: 3000, duty: 2000, plan: 1000, leisure: 100 };
  function obligationWeight(level) { return OBLIGATION_WEIGHT[level] ?? OBLIGATION_WEIGHT.plan; }
  function isValidObligation(level) { return OBLIGATION_LEVELS.includes(level); }

  // Default interruptibility by obligation when neither the beat nor the
  // activity registers its own — higher = easier to pull away from (design
  // doc §22: "critical... very low", "work... medium", "break... extremely
  // high").
  const OBLIGATION_DEFAULT_INTERRUPTIBILITY = { critical: 0, duty: 0.35, plan: 0.6, leisure: 0.9 };
  function defaultInterruptibility(level) { return OBLIGATION_DEFAULT_INTERRUPTIBILITY[level] ?? 0.6; }

  // Dayparts (design doc §7) — plain minute-of-day ranges, half-open
  // [start,end). Deliberately not configurable per-NPC/species: these are a
  // shared vocabulary authors point at, same as the weekday names in
  // calendar-system.js/condition-registry.js.
  const DAYPARTS = [
    { id: 'lateNight', startMin: 0, endMin: 300 },     // 00:00-05:00
    { id: 'dawn', startMin: 300, endMin: 420 },        // 05:00-07:00
    { id: 'morning', startMin: 420, endMin: 660 },     // 07:00-11:00
    { id: 'midday', startMin: 660, endMin: 780 },      // 11:00-13:00
    { id: 'afternoon', startMin: 780, endMin: 1020 },  // 13:00-17:00
    { id: 'evening', startMin: 1020, endMin: 1260 },   // 17:00-21:00
    { id: 'night', startMin: 1260, endMin: 1440 },     // 21:00-24:00
  ];
  const DAYPARTS_BY_ID = new Map(DAYPARTS.map(d => [d.id, d]));
  function daypartRange(id) { return DAYPARTS_BY_ID.get(id) || null; }

  function minutesToClock(min) {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  function parseTimeToMinutes(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  // Accepts '4h', '90m', '1h30m', or a raw finite number of minutes.
  function parseDurationToMinutes(v) {
    if (Number.isFinite(v)) return Math.max(0, v);
    const s = String(v || '').trim();
    if (!s) return null;
    const hm = s.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?$/i);
    if (hm && (hm[1] || hm[2])) return (Number(hm[1]) || 0) * 60 + (Number(hm[2]) || 0);
    const bare = Number(s);
    return Number.isFinite(bare) ? Math.max(0, bare) : null;
  }

  // Small deterministic hash → [0,1). Same shape as npc-scheduling.js's
  // hashNpcIdToIndex but salted per-purpose so unrelated jitter draws (e.g.
  // a beat's start vs its duration) don't move in lockstep, and re-derived
  // fresh from (npcId, day, salt) every call rather than cached — "same day
  // + same NPC + same salt always gives the same answer" is the only
  // property callers rely on (design doc §10/§35's determinism invariant).
  function dailySeed(npcId, day, salt = '') {
    let h = 2166136261;
    const s = `${npcId || 'npc'}|${Math.floor(day) || 0}|${salt}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // Fold to an unsigned 32-bit value, then to [0,1).
    return (h >>> 0) / 4294967296;
  }

  function isWithinWindow(nowMin, startMin, endMin) {
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return false;
    if (startMin === endMin) return true; // a zero-width window means "all day" rather than "never" — no author means to author an unreachable beat.
    if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
    return nowMin >= startMin || nowMin < endMin; // overnight wrap, e.g. 22:00-06:00
  }

  // Resolves a beat's *outer*, unjittered window from either `window`
  // (exact clock strings) or `daypart` (a single name, or a [from,to] pair
  // meaning "start of `from` through end of `to`", e.g. ['morning',
  // 'afternoon'] per the design doc's own Work example).
  function resolveOuterWindow(beat) {
    if (Array.isArray(beat.window) && beat.window.length === 2) {
      const startMin = parseTimeToMinutes(beat.window[0]);
      const endMin = parseTimeToMinutes(beat.window[1]);
      if (Number.isFinite(startMin) && Number.isFinite(endMin)) return { startMin, endMin };
      return null;
    }
    if (beat.daypart) {
      const parts = Array.isArray(beat.daypart) ? beat.daypart : [beat.daypart, beat.daypart];
      const from = daypartRange(parts[0]);
      const to = daypartRange(parts[1] ?? parts[0]);
      if (from && to) return { startMin: from.startMin, endMin: to.endMin };
      return null;
    }
    return null; // no time restriction authored — caller decides how to treat that (see normalizeAgendaBeat's alwaysEligible).
  }

  // Applies design doc §10's daily variation on top of an outer window:
  //   - a `duration: [min,max]` range picks a target length inside that
  //     range, then slides the whole span to a random-but-deterministic
  //     start point that still fits inside the outer window (the "Work
  //     08:21→13:47 on day 14, 07:52→14:03 on day 15" example).
  //   - `jitter: true` with no duration range instead nudges each edge
  //     independently by up to `jitterMinutes` (default 20), clamped inside
  //     the outer window.
  //   - neither → the outer window is returned unchanged (exact authoring,
  //     the right choice for anything another system keys off of, e.g. shop
  //     hours).
  function applyDailyVariation(beat, outer, npcId, day) {
    const span = outer.endMin >= outer.startMin ? outer.endMin - outer.startMin : (outer.endMin + 1440 - outer.startMin);
    if (Array.isArray(beat.duration) && beat.duration.length === 2) {
      const minD = parseDurationToMinutes(beat.duration[0]);
      const maxD = parseDurationToMinutes(beat.duration[1]);
      if (Number.isFinite(minD) && Number.isFinite(maxD) && maxD >= minD && span > 0) {
        const lo = Math.min(minD, span), hi = Math.min(Math.max(maxD, lo), span);
        const targetLen = lo + (hi - lo) * dailySeed(npcId, day, `${beat.id}:dur`);
        const slack = Math.max(0, span - targetLen);
        const startOffset = slack * dailySeed(npcId, day, `${beat.id}:start`);
        const startMin = (outer.startMin + startOffset) % 1440;
        const endMin = (startMin + targetLen) % 1440;
        return { startMin, endMin };
      }
    }
    if (beat.jitter && span > 0) {
      const jitterMinutes = Number.isFinite(beat.jitterMinutes) ? Math.max(0, beat.jitterMinutes) : 20;
      const maxJitter = Math.min(jitterMinutes, Math.floor(span / 2));
      const startJ = (dailySeed(npcId, day, `${beat.id}:jstart`) * 2 - 1) * maxJitter;
      const endJ = (dailySeed(npcId, day, `${beat.id}:jend`) * 2 - 1) * maxJitter;
      return { startMin: (outer.startMin + startJ + 1440) % 1440, endMin: (outer.endMin + endJ + 1440) % 1440 };
    }
    return outer;
  }

  // Final {startMin,endMin} for a beat on a given (npcId, day) — the only
  // window-resolution entry point other modules should call.
  function resolveBeatWindow(beat, { npcId, day } = {}) {
    const outer = resolveOuterWindow(beat);
    if (!outer) return null;
    return applyDailyVariation(beat, outer, npcId, day);
  }

  function isBeatActiveOnDay(beat, weekdayName) {
    if (beat.day) return beat.day === weekdayName;
    if (Array.isArray(beat.days) && beat.days.length) return beat.days.includes(weekdayName);
    if (Array.isArray(beat.daysExcept) && beat.daysExcept.length) return !beat.daysExcept.includes(weekdayName);
    return true;
  }

  // True if `beat` should be considered a live candidate right now. Beats
  // with no window/daypart authored at all (`alwaysEligible`, e.g. the
  // single legacy-compatibility beat or an authored "idle at home"
  // catch-all) are always time-eligible; the planner's obligation-weight
  // ordering is what keeps them from starving anything more specific.
  function isBeatActiveNow(beat, { npcId, day, weekdayName, nowMin } = {}) {
    if (!isBeatActiveOnDay(beat, weekdayName)) return false;
    if (beat.alwaysEligible) return true;
    const win = resolveBeatWindow(beat, { npcId, day });
    if (!win) return beat.window == null && beat.daypart == null; // no time info authored at all → treat as always-on, same as alwaysEligible.
    return isWithinWindow(nowMin, win.startMin, win.endMin);
  }

  function normalizeAgendaBeat(raw, index) {
    const activity = String(raw?.activity || 'idle');
    const obligation = isValidObligation(raw?.obligation) ? raw.obligation : 'plan';
    return {
      ...raw,
      id: raw?.id || `${activity}#${index}`,
      activity,
      obligation,
      activityLabel: raw?.activityLabel || raw?.activity || '',
      preferences: raw?.preferences || {},
      interruptibility: Number.isFinite(raw?.interruptibility) ? raw.interruptibility : defaultInterruptibility(obligation),
    };
  }

  // Every currently time/day-eligible beat, highest obligation first (ties
  // keep authoring order — same "first matching rule wins" precedence the
  // legacy scheduleHooks.rules[] resolver already used, so converting an
  // NPC to authored agenda beats doesn't surprise anyone used to that
  // convention).
  function pickEligibleBeats(beats, ctx) {
    return beats
      .map((b, i) => normalizeAgendaBeat(b, i))
      .filter(b => isBeatActiveNow(b, ctx))
      .sort((a, b) => obligationWeight(b.obligation) - obligationWeight(a.obligation));
  }

  window.NpcAgenda = {
    OBLIGATION_LEVELS,
    obligationWeight,
    isValidObligation,
    defaultInterruptibility,
    DAYPARTS,
    daypartRange,
    minutesToClock,
    parseTimeToMinutes,
    parseDurationToMinutes,
    dailySeed,
    isWithinWindow,
    resolveBeatWindow,
    isBeatActiveOnDay,
    isBeatActiveNow,
    normalizeAgendaBeat,
    pickEligibleBeats,
  };
})();
