// NPC social inhibition + performance reaction runtime.
//
// Adds one broad personality axis — inhibition/self-consciousness — without
// replacing the existing shyness/sociability/musical-interest traits. Every
// NPC gets a stable base inhibition from either authored/explicit data or a
// deterministic bio/tag heuristic. Live context then raises/lowers that base
// before one stable per-encounter willingness draw decides whether they join
// a dance, merely watch, or keep doing what they were doing.
//
// This module deliberately wraps the existing planner/stimulus/render APIs
// instead of adding a second movement controller. The planner still owns
// destinations and schedule recovery; this layer only substitutes a social
// dance destination when the inhibition equation says yes and adds a visual
// render-time dance/facing layer once the walker reaches it.
(function (global) {
  'use strict';

  if (global.NpcSocialInhibition?.installed) return;

  const THREE = global.THREE;
  const STYLE = Object.freeze({
    'side-step': { intensity: 1.00, legAmount: 1.00 },
    'gentle-twirl': { intensity: 1.18, legAmount: 0.82 },
    'loose-sway': { intensity: 0.96, legAmount: 0.48 },
  });
  const DANCE_STYLES = Object.freeze(Object.keys(STYLE));
  const ARM_STYLES = Object.freeze(['overhead-punch', 'tpose-jiggle']);

  // These are deliberate character reads from the current NPC database bios.
  // Every other NPC still receives a description-derived value through
  // deriveBaseInhibition(), so adding a new database entry never leaves the
  // system without a personality value. An authored rec.personality.inhibition
  // always wins over both this table and the heuristic.
  const BASE_OVERRIDES = Object.freeze({
    garanki_gabu: 32,          // cheerful, curious, oblivious to social risk
    gorobi_ginju: 58,          // friendly but proud/competitive patriarch
    gikali_ginju: 76,          // explicitly anxious and competition-conscious
    aliri_ginju: 62,           // dutiful, competitive, watches her brother
    gantami_ginju: 14,         // habitual little rascal
    leaf: 82,                  // quiet, restrained, grumpy recluse
    pahu: 12,                  // silly, warm festival-lover who pulls Leaf out
    furunji_funji: 64,         // warm but worn-down widowed shopkeeper
    foroji_funji: 8,           // bard who actively chooses music over inheritance
    kzubug: 64,                // gentle older smith, strongly responsibility-minded
    sloomi: 51,                // soft-spoken, but fierce when emotionally engaged
    hreesh: 38,                // blunt innkeeper; low concern for looking proper
    jubmir: 57,                // caring trader carrying a concealed noble identity
    father_hunundi_hodu: 81,   // priest/protector: high responsibility and decorum
    namui_u_hakaru: 69,        // wanted, deliberately trying to live an honest life
    takua_ao_hakaru: 65,       // wanted, actively seeking honest work/responsibility
    kaboku_kunji: 66,          // kind, giving older man who avoids household conflict
    kinami_kunji: 90,          // status-conscious gossip who polices other people's behavior
    teacup_unumanuk: 83,       // clan eldress and nightly religious leader
    spearhead_unumanuk: 86,    // watch captain/father; safety and duty first
    oddclaw_unumanuk: 34,      // young animal-loving watch member challenging his father
    dzibim_khibu: 57,
    dzahiri_khibu: 54,
    nashka_khibu: 43,
  });

  const state = {
    plannerDeps: null,
    plannerTarget: null,
    stimuliTarget: null,
    renderHookInstalled: false,
    evaluations: new Map(),
    encounterState: new Map(),
    lastLoggedDecision: new Map(),
    renderCount: 0,
    facingApplications: 0,
    danceApplications: 0,
    frameApplied: false, // True while this frame's presentation is applied and awaiting its deferred revert.
    frameSnapshots: [],
  };

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, Number(value) || 0));
  const clamp01 = value => clamp(value, 0, 1);
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function socialConfig() {
    return global.SCRATCHBONES_CONFIG?.game?.socialActions || {};
  }

  function cfgNumber(key, fallback, lo = -Infinity, hi = Infinity) {
    const value = Number(socialConfig()[key]);
    return Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
  }

  function recText(rec) {
    return `${rec?.bio || ''} ${(rec?.tags || []).join(' ')} ${rec?.role || ''} ${rec?.ageBand || ''}`.toLowerCase();
  }

  function deriveBaseInhibition(rec) {
    let score = 52;
    const reasons = ['neutral adult baseline 52'];
    const text = recText(rec);
    const add = (pattern, amount, reason) => {
      if (!pattern.test(text)) return;
      score += amount;
      reasons.push(`${amount >= 0 ? '+' : ''}${amount} ${reason}`);
    };

    add(/\b(child|little brother|little sister)\b/, -14, 'childlike spontaneity');
    add(/\b(young|younger)\b/, -5, 'youth');
    add(/\b(old|elder|eldress|late middle aged|late-middle-aged)\b/, 7, 'age/responsibility');
    add(/\b(cheerful|silly|rascal|festival lover|festival-lover|bard|performer|busk|play(?:s|ing)? music)\b/, -16, 'playful/performative temperament');
    add(/\b(warm|blunt|outgoing|oblivious)\b/, -5, 'low social self-monitoring');
    add(/\b(quiet|soft-spoken|restrained|reserved|shy)\b/, 10, 'reserved temperament');
    add(/\b(anxious|self-conscious|nervous)\b/, 18, 'anxiety/self-consciousness');
    add(/\b(dutiful|responsible|captain|chief|priest|eldress|protective|single mother|parent|father|mother)\b/, 12, 'duty/protectiveness');
    add(/\b(shopkeep|shopkeeper|farmer|smith|carpenter|researcher|watch member|waitress|hunter|woodcutter)\b/, 6, 'occupational responsibility');
    add(/\b(wanted|honest life|honest work|nobility|noble|secretly|concealed)\b/, 8, 'reputation/safety stakes');
    add(/\b(gossip|status|proper|respectab)\b/, 14, 'social-conformity concern');
    add(/\b(worn down|widower|widowed|grief|plague|sacrific)\b/, 6, 'caution from life experience');
    add(/\b(murdered|banished|outlaw|criminal)\b/, -5, 'low conventional conformity');

    return { base: Math.round(clamp(score, 5, 95)), source: 'bio-derived', reasons };
  }

  function profileFor(rec) {
    const authored = Number(rec?.personality?.inhibition);
    if (Number.isFinite(authored)) {
      return { base: Math.round(clamp(authored, 1, 100)), source: 'authored', reasons: ['rec.personality.inhibition'] };
    }
    const override = BASE_OVERRIDES[rec?.id];
    if (Number.isFinite(override)) {
      return { base: override, source: 'bio-reviewed override', reasons: ['hand-reviewed from current NPC database bio'] };
    }
    return deriveBaseInhibition(rec);
  }

  function ensureProfile(rec) {
    const profile = profileFor(rec);
    if (!rec) return profile;
    try {
      rec.personality = rec.personality || {};
      if (!Number.isFinite(Number(rec.personality.inhibition))) rec.personality.inhibition = profile.base;
    } catch (_) {}
    return profile;
  }

  function heartLevel(npcId) {
    return clamp(Number(global.DialogueContent?.getNpcDlgState?.(npcId)?.favor) || 0, -5, 14);
  }

  function drunkenness100(npcId) {
    const fraction = Number(global.HobunjiDrunkGameplayBridge?.npcDrunkFraction?.(npcId));
    return clamp((Number.isFinite(fraction) ? fraction : 0) * 100, 0, 100);
  }

  function gameHour() {
    const hour = Number(global.CalendarSystem?.getHour?.());
    return Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 12;
  }

  function deterministic01(npcId, day, salt) {
    const seeded = global.NpcAgenda?.dailySeed?.(npcId, day, salt);
    if (Number.isFinite(seeded)) return clamp01(seeded);
    let h = 2166136261;
    const text = `${npcId}|${day}|${salt}`;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }

  function activityText(target) {
    return `${target?.semanticActivity || ''} ${target?.activity || ''} ${target?.label || ''}`.toLowerCase();
  }

  function workContext(target, walker) {
    const text = activityText(target);
    const leisure = /sleep|eat|drink|break|free|wander|chat|visit|watch|dance|rest|sit|music|inn guest|home/.test(text);
    const obviousWork = /work|shop|farm|smith|carpent|guard|watch captain|priest|service|reviewing|examining|research|waitress|tending|counter|shelv|mine|mining|hunt|woodcut|fish/.test(text);
    const obligation = String(target?.obligation || '').toLowerCase();
    const working = obviousWork || (!leisure && obligation === 'duty') || (!!walker?.stationToolMesh && !leisure);
    const planning = !working && obligation === 'plan';
    return { working, planning, critical: obligation === 'critical' };
  }

  function nearbySocialCounts(walker, stimulus) {
    const others = state.plannerDeps?.listNpcWalkersInArea?.(walker?.area) || [];
    const radius = cfgNumber('danceAudienceCountRadiusTiles', 6.5, 1, 20);
    let watchers = 0, dancers = 0;
    for (const other of others) {
      if (!other?.rec?.id || other.rec.id === walker?.rec?.id) continue;
      if (Math.hypot(other.root.position.x - stimulus.x, other.root.position.z - stimulus.z) > radius) continue;
      const target = other.currentScheduleTarget;
      if (target?.socialDance) dancers++;
      else if (target?.socialLookAt || /watching a performance|watching up close|watching from afar/i.test(activityText(target))) watchers++;
    }
    return { watchers, dancers };
  }

  function encounterRecord(npcId, stimulusId, inside) {
    const key = `${npcId}|${stimulusId}`;
    let rec = state.encounterState.get(key);
    if (!rec) {
      rec = { inside: false, serial: 0 };
      state.encounterState.set(key, rec);
    }
    if (inside && !rec.inside) rec.serial++;
    rec.inside = !!inside;
    return rec;
  }

  function markNpcOutsideAllStimuli(npcId) {
    const prefix = `${npcId}|`;
    for (const [key, rec] of state.encounterState) if (key.startsWith(prefix)) rec.inside = false;
  }

  function isNearby(stimulus, x, z) {
    if (!stimulus || !Number.isFinite(stimulus.x) || !Number.isFinite(stimulus.z)) return null;
    const radius = Math.max(0.01, Number(stimulus.radius) || 8);
    const distance = Math.hypot(x - stimulus.x, z - stimulus.z);
    if (distance > radius) return null;
    return { distance, proximity: clamp01(1 - distance / radius), radius };
  }

  function chooseStimulus(walker) {
    if (!walker?.root || !global.NpcSocialStimuli?.getActive) return null;
    global.NpcSocialStimuli.pollPlayerMusic?.();
    const x = walker.root.position.x, z = walker.root.position.z;
    const nearby = [];
    for (const stimulus of global.NpcSocialStimuli.getActive(walker.area)) {
      if (!['music', 'dance'].includes(stimulus.type)) continue;
      if (stimulus.sourceNpcId && stimulus.sourceNpcId === walker.rec?.id) continue;
      const near = isNearby(stimulus, x, z);
      if (!near) continue;
      nearby.push({ stimulus, ...near, score: (Number(stimulus.strength) || 0.6) * near.proximity });
    }
    if (!nearby.length) { markNpcOutsideAllStimuli(walker.rec?.id); return null; }

    // A player physically dancing up to somebody is a social invitation, so
    // it gets evaluated even when louder music is also present. This is what
    // allows a disliked player's approach to make an existing dancer stop.
    const inviteRadius = cfgNumber('dancePlayerInvitationRadiusTiles', 3.25, 0.5, 10);
    const closePlayerDance = nearby
      .filter(item => item.stimulus.type === 'dance' && item.stimulus.sourceIsPlayer && item.distance <= inviteRadius)
      .sort((a, b) => b.score - a.score)[0];
    const chosen = closePlayerDance || nearby.sort((a, b) => b.score - a.score)[0];
    for (const item of nearby) encounterRecord(walker.rec?.id, item.stimulus.id, true);
    return chosen;
  }

  function evaluate(rec, walker, stimulusInfo, underlyingTarget) {
    const profile = ensureProfile(rec);
    const stimulus = stimulusInfo?.stimulus;
    const day = Number(state.plannerDeps?.calendar?.day) || 0;
    const encounter = encounterRecord(rec?.id, stimulus?.id, true);
    const modifiers = [];
    let effective = profile.base;

    // Drunkenness is not an arbitrary subtraction: it linearly maps this
    // individual's own base inhibition toward 1, exactly preserving the
    // user's requested 1..base relationship.
    const drunk = drunkenness100(rec?.id);
    const drunkAdjustedBase = 1 + (profile.base - 1) * (1 - drunk / 100);
    modifiers.push({ key: 'drunkenness', amount: drunkAdjustedBase - profile.base, detail: `${Math.round(drunk)} / 100` });
    effective = drunkAdjustedBase;

    const work = workContext(underlyingTarget, walker);
    if (work.working) { effective += 22; modifiers.push({ key: 'at-work', amount: 22 }); }
    else if (work.planning) { effective += 10; modifiers.push({ key: 'responsibility-plan', amount: 10 }); }

    const hour = gameHour();
    if (hour >= 19 || hour < 5) { effective -= 8; modifiers.push({ key: 'night', amount: -8 }); }
    else if (hour >= 17) { effective -= 4; modifiers.push({ key: 'evening', amount: -4 }); }
    else if (hour >= 9 && hour < 17) { effective += 2; modifiers.push({ key: 'public-daytime', amount: 2 }); }

    const personality = rec?.personality || {};
    const musicalInterest = clamp01(personality.musicalInterest ?? 0.5);
    const sociability = clamp01(personality.sociability ?? 0.5);
    const shyness = clamp01(personality.shyness ?? 0.3);
    const musicTrait = (0.5 - musicalInterest) * 16;
    const socialTrait = (0.5 - sociability) * 8;
    const shyTrait = (shyness - 0.5) * 10;
    if (Math.abs(musicTrait) > 0.01) { effective += musicTrait; modifiers.push({ key: 'musical-interest', amount: musicTrait }); }
    if (Math.abs(socialTrait) > 0.01) { effective += socialTrait; modifiers.push({ key: 'sociability', amount: socialTrait }); }
    if (Math.abs(shyTrait) > 0.01) { effective += shyTrait; modifiers.push({ key: 'shyness', amount: shyTrait }); }

    if (stimulus?.type === 'music') {
      const pull = -14 * clamp01(stimulus.strength ?? 0.8) * (0.65 + 0.35 * stimulusInfo.proximity);
      effective += pull;
      modifiers.push({ key: 'music', amount: pull });
    } else if (stimulus?.type === 'dance') {
      effective -= 6;
      modifiers.push({ key: 'someone-else-dancing', amount: -6 });
    }

    const counts = nearbySocialCounts(walker, stimulus);
    const watcherPenalty = Math.min(20, counts.watchers * 5);
    const dancerBonus = -Math.min(24, counts.dancers * 8);
    if (watcherPenalty) { effective += watcherPenalty; modifiers.push({ key: 'spectators', amount: watcherPenalty, detail: String(counts.watchers) }); }
    if (dancerBonus) { effective += dancerBonus; modifiers.push({ key: 'other-dancers', amount: dancerBonus, detail: String(counts.dancers) }); }

    const alreadyDancing = !!walker?.currentScheduleTarget?.socialDance;
    if (alreadyDancing) { effective -= 12; modifiers.push({ key: 'already-dancing-inertia', amount: -12 }); }

    const inviteRadius = cfgNumber('dancePlayerInvitationRadiusTiles', 3.25, 0.5, 10);
    const closePlayerInvite = stimulus?.type === 'dance' && stimulus.sourceIsPlayer && stimulusInfo.distance <= inviteRadius;
    const hearts = closePlayerInvite ? heartLevel(rec?.id) : 0;
    if (closePlayerInvite) {
      const relationshipAmount = -3 * hearts; // Exact requested rule; negative hearts therefore increase inhibition.
      effective += relationshipAmount;
      modifiers.push({ key: 'player-dance-invitation', amount: relationshipAmount, detail: `${hearts} hearts × -3` });
    }

    // Inn/festival/social spaces make expressive behavior less conspicuous,
    // but working there still carries the +22 duty penalty above.
    if (/inn|tavern|festival|square/.test(`${walker?.area || ''} ${activityText(underlyingTarget)}`)) {
      effective -= 5;
      modifiers.push({ key: 'social-venue', amount: -5 });
    }

    effective = clamp(effective, 1, 99);
    const willingnessDraw = deterministic01(rec?.id, day, `dance:${stimulus?.id}:${encounter.serial}`) * 100;
    const blocked = work.critical || global.HobunjiDrunkGameplayBridge?.isNpcBlackedOut?.(rec?.id) || false;
    const dance = !blocked && willingnessDraw >= effective;
    const result = {
      npcId: rec?.id,
      name: rec?.name || rec?.id,
      stimulusId: stimulus?.id,
      stimulusType: stimulus?.type,
      baseInhibition: profile.base,
      baseSource: profile.source,
      drunkenness: drunk,
      effectiveInhibition: Math.round(effective * 10) / 10,
      willingnessDraw: Math.round(willingnessDraw * 10) / 10,
      danceProbability: Math.round((100 - effective) * 10) / 10,
      dance,
      blocked,
      atWork: work.working,
      hearts: closePlayerInvite ? hearts : null,
      closePlayerInvite,
      watchers: counts.watchers,
      otherDancers: counts.dancers,
      modifiers: modifiers.map(item => ({ ...item, amount: Math.round(item.amount * 10) / 10 })),
      encounter: encounter.serial,
      profileReasons: profile.reasons,
    };
    state.evaluations.set(rec?.id, result);

    const decisionKey = `${result.stimulusId}|${result.encounter}|${result.dance}|${result.effectiveInhibition}|${result.willingnessDraw}`;
    if (state.lastLoggedDecision.get(rec?.id) !== decisionKey) {
      state.lastLoggedDecision.set(rec?.id, decisionKey);
      global.__farmLog?.(`[inhibition] ${result.name}: base ${result.baseInhibition} → ${result.effectiveInhibition}; willingness ${result.willingnessDraw} → ${result.dance ? 'DANCE' : 'watch/continue'}`, 'social');
    }
    return result;
  }

  function deterministicDancePresentation(rec, stimulus) {
    const day = Number(state.plannerDeps?.calendar?.day) || 0;
    const style = STYLE[stimulus?.danceStyle] ? stimulus.danceStyle
      : DANCE_STYLES[Math.floor(deterministic01(rec?.id, day, `dance-style:${stimulus?.id}`) * DANCE_STYLES.length) % DANCE_STYLES.length];
    const armStyle = ARM_STYLES.includes(stimulus?.armStyle) ? stimulus.armStyle
      : ARM_STYLES[Math.floor(deterministic01(rec?.id, day, `dance-arms:${stimulus?.id}`) * ARM_STYLES.length) % ARM_STYLES.length];
    return { style, armStyle };
  }

  function danceDestination(rec, walker, stimulus, underlyingTarget) {
    const prior = walker?.currentScheduleTarget;
    const presentation = deterministicDancePresentation(rec, stimulus);
    if (prior?.socialDance?.stimulusId === stimulus.id) {
      return {
        ...prior,
        socialDance: { ...prior.socialDance, ...presentation, sourceX: stimulus.x, sourceZ: stimulus.z },
        socialLookAt: { stimulusId: stimulus.id, x: stimulus.x, z: stimulus.z },
        suspendedObligation: underlyingTarget?.obligation || prior.suspendedObligation || null,
      };
    }
    const day = Number(state.plannerDeps?.calendar?.day) || 0;
    const angle = deterministic01(rec?.id, day, `dance-pos-angle:${stimulus.id}`) * Math.PI * 2;
    const distance = 1.55 + deterministic01(rec?.id, day, `dance-pos-radius:${stimulus.id}`) * 1.15;
    const x = stimulus.x + Math.cos(angle) * distance;
    const z = stimulus.z + Math.sin(angle) * distance;
    return {
      area: stimulus.area,
      c: Math.floor(x),
      r: Math.floor(z),
      pose: 'stand',
      id: `dance-${stimulus.id}-${rec?.id}`,
      activity: 'dancing',
      semanticActivity: 'joinDance',
      obligation: 'leisure',
      plannerStatus: 'READY',
      plannerReason: 'inhibition equation accepted dance opportunity',
      plannerSource: 'social-inhibition',
      socialDance: {
        stimulusId: stimulus.id,
        sourceX: stimulus.x,
        sourceZ: stimulus.z,
        sourceIsPlayer: !!stimulus.sourceIsPlayer,
        sourceNpcId: stimulus.sourceNpcId || null,
        ...presentation,
      },
      socialLookAt: { stimulusId: stimulus.id, x: stimulus.x, z: stimulus.z },
      suspendedObligation: underlyingTarget?.obligation || null,
    };
  }

  function annotateWatchingTarget(target, stimulus) {
    if (!target || !stimulus) return target;
    const watching = /^watch-/.test(String(target.id || '')) || /watching a performance|watching up close|watching from afar/.test(activityText(target));
    if (!watching) return target;
    return {
      ...target,
      socialLookAt: { stimulusId: stimulus.id, x: stimulus.x, z: stimulus.z },
      socialWatching: true,
    };
  }

  function patchPlanner(api) {
    if (!api || api.__npcSocialInhibitionWrapped) return;
    state.plannerTarget = api;
    if (typeof api.init === 'function' && !api.init.__npcSocialInhibitionWrapped) {
      const originalInit = api.init.bind(api);
      api.init = function npcSocialInhibitionPlannerInit(injectedDeps) {
        state.plannerDeps = injectedDeps || state.plannerDeps;
        return originalInit(injectedDeps);
      };
      api.init.__npcSocialInhibitionWrapped = true;
    }
    if (typeof api.resolveNpcTarget === 'function') {
      const originalResolve = api.resolveNpcTarget.bind(api);
      api.resolveNpcTarget = function inhibitionAwareNpcTarget(rec, extra = {}) {
        const underlying = originalResolve(rec, extra);
        if (!extra?.hasExistingWalker || !state.plannerDeps) return underlying;
        const walker = state.plannerDeps.findNpcWalker?.(rec?.id);
        if (!walker || walker.area !== state.plannerDeps.getCurrentArea?.()) return underlying;
        ensureProfile(rec);
        const selected = chooseStimulus(walker);
        if (!selected) return underlying;
        const work = workContext(underlying, walker);
        if (work.critical) return annotateWatchingTarget(underlying, selected.stimulus);
        const decision = evaluate(rec, walker, selected, underlying);
        if (decision.dance) return danceDestination(rec, walker, selected.stimulus, underlying);
        return annotateWatchingTarget(underlying, selected.stimulus);
      };
    }
    api.__npcSocialInhibitionWrapped = true;
  }

  function patchStimuli(api) {
    if (!api?.emit || api.__npcSocialDanceMetadataWrapped) return;
    state.stimuliTarget = api;
    const originalEmit = api.emit.bind(api);
    api.emit = function metadataPreservingStimulus(stimulus) {
      let enriched = stimulus;
      if (stimulus?.type === 'dance' && stimulus.sourceIsPlayer && (!stimulus.danceStyle || !stimulus.armStyle)) {
        let active = null;
        try { active = global.SocialActionWheel?.getDebug?.()?.dancing || null; } catch (_) {}
        enriched = { ...stimulus, danceStyle: stimulus.danceStyle || active?.style || null, armStyle: stimulus.armStyle || active?.armStyle || null };
      }
      const record = originalEmit(enriched);
      if (record && enriched) {
        if (enriched.danceStyle) record.danceStyle = enriched.danceStyle;
        if (enriched.armStyle) record.armStyle = enriched.armStyle;
        if (enriched.rhythmSource) record.rhythmSource = enriched.rhythmSource;
      }
      return record;
    };
    api.__npcSocialDanceMetadataWrapped = true;
  }

  function chainGlobal(name, patcher) {
    const current = global[name];
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : current;
    const oldGet = descriptor?.get, oldSet = descriptor?.set;
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return oldGet ? oldGet.call(global) : stored; },
        set(value) {
          if (oldSet) oldSet.call(global, value); else stored = value;
          const resolved = oldGet ? oldGet.call(global) : stored;
          if (resolved) patcher(resolved);
        },
      });
    } catch (_) {}
  }

  function activeStimulusFor(target, area) {
    const id = target?.socialLookAt?.stimulusId || target?.socialDance?.stimulusId;
    if (!id) return null;
    return global.NpcSocialStimuli?.getActive?.(area)?.find(stimulus => stimulus.id === id) || null;
  }

  function angleToward(fromX, fromZ, toX, toZ) {
    return Math.atan2(toZ - fromZ, toX - fromX) + Math.PI / 2;
  }

  function shortestAngleDelta(from, to) {
    let delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function arrivedForSocialPose(walker, target) {
    if (!walker?.root || !target) return false;
    if (walker.state === 'idle') return true;
    if (!Number.isFinite(target.c) || !Number.isFinite(target.r)) return false;
    return Math.hypot(walker.root.position.x - (target.c + 0.5), walker.root.position.z - (target.r + 0.5)) <= 0.72;
  }

  function applyFacing(walker, target, stimulus) {
    if (!walker?.root || !target?.socialLookAt || !arrivedForSocialPose(walker, target)) return;
    const look = stimulus || target.socialLookAt;
    if (!Number.isFinite(look.x) || !Number.isFinite(look.z)) return;
    const desired = angleToward(walker.root.position.x, walker.root.position.z, look.x, look.z);
    const current = Number.isFinite(walker.rot) ? walker.rot : walker.root.rotation.y;
    const amount = clamp01(cfgNumber('npcPerformanceFacingLerp', 0.22, 0.01, 1));
    const next = current + shortestAngleDelta(current, desired) * amount;
    walker.rot = next;
    walker.root.rotation.y = next;
    walker.root.updateMatrixWorld?.(true);
    state.facingApplications++;
  }

  function grooveScale(groove) {
    const g = Math.max(0, Number(groove) || 0), rate = 52;
    return Math.expm1(g / rate) / Math.expm1(100 / rate);
  }

  function smootherstep01(value) {
    const t = clamp01(value);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function danceMotion(style, beat, intensity) {
    const phase = beat * Math.PI * 2;
    const alternatingWeight = Math.sin(phase * 0.5);
    const fourBeatSway = Math.sin(phase * 0.25);
    const beatPulse = Math.pow(Math.max(0, Math.cos(phase)), 4);
    let tangentShift = 0, bounce = 0, bodySway = 0, twirlRotation = 0;
    if (style === 'side-step') {
      tangentShift = alternatingWeight * 0.30 * intensity;
      bounce = beatPulse * 0.12 * intensity;
      bodySway = fourBeatSway * 0.22 * intensity;
    } else if (style === 'gentle-twirl') {
      tangentShift = alternatingWeight * 0.14 * intensity;
      bounce = beatPulse * 0.12 * intensity;
      bodySway = fourBeatSway * 0.20 * intensity;
      const cycle = ((beat % 8) + 8) % 8;
      const turnProgress = clamp01((cycle - 4.5) / 2);
      twirlRotation = intensity >= 0.56
        ? Math.PI * 2 * smootherstep01(turnProgress)
        : Math.sin(turnProgress * Math.PI) * 0.8 * intensity;
    } else {
      tangentShift = alternatingWeight * 0.18 * intensity;
      bounce = beatPulse * 0.09 * intensity;
      bodySway = fourBeatSway * 0.36 * intensity;
    }
    return { phase, fourBeatSway, tangentShift, bounce, bodySway, twirlRotation };
  }

  function walkerDimensions(walker) {
    const height = Math.max(0.05, Number(walker?.avatarHeight) || 0.9);
    const width = Math.max(0.05, Number(walker?.avatarWidth) || height * 0.72 || 0.9);
    return { width, height };
  }

  function captureLegChain(root, side) {
    if (!THREE || !global.LegBones?.solveTwoBoneLeg || !root) return null;
    const hip = root.getObjectByName?.(`${side}_hip`);
    const thigh = root.getObjectByName?.(`${side}_thigh`);
    const calf = root.getObjectByName?.(`${side}_calf`);
    const foot = root.getObjectByName?.(`${side}_foot`);
    if (!hip || !thigh || !calf || !foot) return null;
    root.updateMatrixWorld?.(true);
    const target = root.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
    const straight = global.LegBones.solveTwoBoneLeg(THREE, { hip: hip.position, foot: target });
    const bendQ = straight.thighQuaternion.clone().invert().multiply(thigh.quaternion.clone());
    const bendE = new THREE.Euler().setFromQuaternion(bendQ, 'XYZ');
    return {
      hip, thigh, calf, foot, target,
      bendX: THREE.MathUtils.radToDeg(bendE.x), bendZ: THREE.MathUtils.radToDeg(bendE.z),
      snapshot: {
        thighQ: thigh.quaternion.clone(), calfPos: calf.position.clone(), calfQ: calf.quaternion.clone(),
        footPos: foot.position.clone(), footQ: foot.quaternion.clone(),
      },
    };
  }

  function applyLegDance(walker, presentation, beat, motion, dimensions, snapshots) {
    const root = walker?.legs?.group;
    if (!root || !global.LegBones?.solveTwoBoneLeg || !THREE) return;
    const chains = { left: captureLegChain(root, 'left'), right: captureLegChain(root, 'right') };
    if (!chains.left || !chains.right) return;
    const styleDef = STYLE[presentation.style] || STYLE['loose-sway'];
    const swingSide = Math.floor(beat) % 2 === 0 ? 'left' : 'right';
    const swingT = ((beat % 1) + 1) % 1;
    const arc = Math.pow(Math.max(0, Math.sin(Math.PI * swingT)), 1.25);
    const amount = styleDef.legAmount;
    const alt = Math.sin(beat * Math.PI);
    for (const side of ['left', 'right']) {
      const chain = chains[side], target = chain.target.clone();
      const sign = side === 'left' ? -1 : 1;
      if (presentation.style === 'side-step' && side === swingSide) {
        target.x += (alt >= 0 ? 1 : -1) * dimensions.width * 0.12 * arc * amount;
        target.y += dimensions.height * 0.055 * arc * amount;
      } else if (presentation.style === 'gentle-twirl' && side === swingSide) {
        target.x += sign * dimensions.width * 0.065 * arc * amount;
        target.z += (alt >= 0 ? 1 : -1) * dimensions.height * 0.035 * arc * amount;
        target.y += dimensions.height * 0.047 * arc * amount;
      } else if (presentation.style === 'loose-sway') {
        target.x += sign * motion.fourBeatSway * dimensions.width * 0.055 * amount;
        if (side === swingSide) target.y += dimensions.height * 0.025 * arc * amount;
      }
      const solved = global.LegBones.solveTwoBoneLeg(THREE, {
        hip: chain.hip.position, foot: target, bendDegX: chain.bendX, bendDegZ: chain.bendZ,
      });
      chain.thigh.quaternion.copy(solved.thighQuaternion);
      chain.calf.position.set(0, -solved.thighLength, 0);
      chain.calf.quaternion.copy(solved.calfLocalQuaternion);
      chain.foot.position.set(0, -solved.calfLength, 0);
      chain.foot.quaternion.copy(chain.snapshot.footQ);
    }
    root.updateMatrixWorld?.(true);
    snapshots.push(() => {
      for (const chain of Object.values(chains)) {
        chain.thigh.quaternion.copy(chain.snapshot.thighQ);
        chain.calf.position.copy(chain.snapshot.calfPos);
        chain.calf.quaternion.copy(chain.snapshot.calfQ);
        chain.foot.position.copy(chain.snapshot.footPos);
        chain.foot.quaternion.copy(chain.snapshot.footQ);
      }
      root.updateMatrixWorld?.(true);
    });
  }

  function applyHandDance(walker, presentation, beat, motion, dimensions, snapshots) {
    let left = null, right = null;
    walker?.root?.traverse?.(node => {
      if (node?.name === 'left_hand_socket') left = node;
      else if (node?.name === 'right_hand_socket') right = node;
    });
    if (!left || !right) return;
    const bases = {
      left: { socket: left, pos: left.position.clone(), quat: left.quaternion.clone() },
      right: { socket: right, pos: right.position.clone(), quat: right.quaternion.clone() },
    };
    const beatT = ((beat % 1) + 1) % 1;
    for (const side of ['left', 'right']) {
      const base = bases[side], socket = base.socket;
      const sign = Math.sign(base.pos.x) || (side === 'left' ? -1 : 1);
      if (presentation.armStyle === 'tpose-jiggle') {
        socket.position.x += sign * dimensions.width * 0.32;
        socket.position.y += dimensions.height * (0.08 + 0.035 * Math.sin(motion.phase + (side === 'right' ? Math.PI : 0)));
        socket.position.z += motion.fourBeatSway * dimensions.height * 0.035;
        socket.rotateZ(sign * (0.10 + 0.06 * Math.sin(motion.phase * 0.5)));
      } else {
        const sidePhase = side === 'right' ? (beatT + 0.5) % 1 : beatT;
        const punch = Math.pow(Math.max(0, Math.sin(Math.PI * sidePhase)), 0.45);
        socket.position.x *= 1 - 0.32 * punch;
        socket.position.y += dimensions.height * (0.10 + 0.48 * punch);
        socket.position.z += dimensions.height * (0.045 - 0.055 * punch);
        socket.rotateX(-0.35 * punch);
      }
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
    }
    snapshots.push(() => {
      for (const base of Object.values(bases)) {
        base.socket.position.copy(base.pos);
        base.socket.quaternion.copy(base.quat);
        base.socket.updateMatrix?.();
        base.socket.updateMatrixWorld?.(true);
      }
    });
  }

  function applyDancePresentation(walker, target, stimulus, timeMs, snapshots) {
    if (!target?.socialDance || !arrivedForSocialPose(walker, target)) return;
    const presentation = target.socialDance;
    const session = `${presentation.stimulusId || 'dance'}:${presentation.style}:${presentation.armStyle}`;
    const beat = Number(global.SocialRhythmClock?.dancerBeatAt?.(walker.rec?.id, timeMs, session));
    if (!Number.isFinite(beat)) return;
    const styleDef = STYLE[presentation.style] || STYLE['loose-sway'];
    const mappedIntensity = grooveScale(socialConfig().danceGroove ?? 72) * styleDef.intensity;
    const motion = danceMotion(presentation.style, beat, mappedIntensity);
    const dimensions = walkerDimensions(walker);
    const body = walker.alcoholPoseGroup || walker.root;
    if (body) {
      const basePos = body.position.clone(), baseQuat = body.quaternion.clone();
      const sizeScale = dimensions.width / 0.9;
      body.position.x += motion.tangentShift * sizeScale;
      body.position.y += motion.bounce * sizeScale;
      body.rotateY(motion.twirlRotation);
      body.rotateZ(motion.bodySway);
      body.updateMatrixWorld?.(true);
      snapshots.push(() => {
        body.position.copy(basePos);
        body.quaternion.copy(baseQuat);
        body.updateMatrixWorld?.(true);
      });
    }
    if (walker.stationToolMesh) {
      const visible = walker.stationToolMesh.visible;
      walker.stationToolMesh.visible = false;
      snapshots.push(() => { walker.stationToolMesh.visible = visible; });
    }
    applyLegDance(walker, presentation, beat, motion, dimensions, snapshots);
    applyHandDance(walker, presentation, beat, motion, dimensions, snapshots);
    state.danceApplications++;
  }

  function applyAllNpcPresentation() {
    const snapshots = [];
    if (!state.plannerDeps?.listNpcWalkersInArea) return snapshots;
    const area = state.plannerDeps.getCurrentArea?.();
    const walkers = state.plannerDeps.listNpcWalkersInArea(area) || [];
    const t = nowMs();
    for (const walker of walkers) {
      const target = walker?.currentScheduleTarget;
      if (!target?.socialLookAt && !target?.socialDance) continue;
      const stimulus = activeStimulusFor(target, walker.area);
      if (stimulus) {
        if (target.socialLookAt) { target.socialLookAt.x = stimulus.x; target.socialLookAt.z = stimulus.z; }
        if (target.socialDance) { target.socialDance.sourceX = stimulus.x; target.socialDance.sourceZ = stimulus.z; }
      }
      applyFacing(walker, target, stimulus);
      applyDancePresentation(walker, target, stimulus, t, snapshots);
    }
    return snapshots;
  }

  function installRenderHook() {
    if (state.renderHookInstalled || !THREE?.WebGLRenderer?.prototype) return;
    const proto = THREE.WebGLRenderer.prototype;
    const original = proto.render;
    if (typeof original !== 'function') return;
    if (original.__npcSocialInhibitionRenderHook) { state.renderHookInstalled = true; return; }
    function npcSocialInhibitionRender(scene, camera) {
      // A single visual frame drives renderer.render() multiple times when
      // outlines are on (color pass, shell/target/material-ID/depth outline
      // passes, final composite -- see game.js's s_outlines block), all
      // synchronously back to back. Applying/reverting per internal render()
      // call recomputed the exact same facing/dance transforms up to 6x for
      // one visual frame; apply once for the whole synchronous frame instead,
      // and defer the revert to a microtask so every pass within the frame
      // (outlines included) still sees the same posed transforms.
      if (!state.frameApplied) {
        state.frameApplied = true;
        state.frameSnapshots = applyAllNpcPresentation();
        Promise.resolve().then(() => {
          state.frameApplied = false;
          const snapshots = state.frameSnapshots;
          state.frameSnapshots = [];
          for (let i = snapshots.length - 1; i >= 0; i--) {
            try { snapshots[i](); } catch (_) {}
          }
        });
      }
      state.renderCount++;
      return original.call(this, scene, camera);
    }
    npcSocialInhibitionRender.__npcSocialInhibitionRenderHook = true;
    npcSocialInhibitionRender.__npcSocialInhibitionOriginal = original;
    proto.render = npcSocialInhibitionRender;
    state.renderHookInstalled = true;
  }

  chainGlobal('NpcActivityPlanner', patchPlanner);
  chainGlobal('NpcSocialStimuli', patchStimuli);
  installRenderHook();
  global.setInterval?.(installRenderHook, 500);

  global.NpcSocialInhibition = Object.freeze({
    installed: true,
    baseOverrides: BASE_OVERRIDES,
    profileFor,
    ensureProfile,
    evaluate,
    getDebug(npcId) {
      if (npcId) return state.evaluations.get(String(npcId)) || null;
      return {
        renderHookInstalled: state.renderHookInstalled,
        renderCount: state.renderCount,
        facingApplications: state.facingApplications,
        danceApplications: state.danceApplications,
        activeEvaluations: [...state.evaluations.values()],
      };
    },
  });
})(window);
