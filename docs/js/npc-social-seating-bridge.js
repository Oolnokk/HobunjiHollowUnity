(() => {
  'use strict';
  if (Number(window.NpcSocialSeating?.version) >= 2) return;

  const activities = window.NpcActivities;
  const scheduling = window.NpcScheduling;
  if (!activities?.resolveDestination || !scheduling?.findStationsByRole) return;

  const RELATION_TYPES = Object.freeze(['partner', 'family', 'friend']);
  const lastDecisionByNpc = new Map();
  const decisionCacheByNpc = new Map();
  let relationCacheSource = null;
  let relationCache = new Map();

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function socialConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.socialRelationships || window.HobunjiNpcSocialRelationsConfig || {};
  }

  function seatingConfig() {
    return socialConfig().seating || {};
  }

  function pairKey(a, b) {
    return [String(a || ''), String(b || '')].sort().join('|');
  }

  function relationMap() {
    const relations = socialConfig().relationships || [];
    if (relations === relationCacheSource) return relationCache;
    const next = new Map();
    for (const relation of relations) {
      const type = String(relation?.type || '');
      const members = Array.isArray(relation?.members) ? relation.members.filter(Boolean) : [];
      if (!RELATION_TYPES.includes(type) || members.length < 2) continue;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const key = pairKey(members[i], members[j]);
          if (!next.has(key)) next.set(key, new Set());
          next.get(key).add(type);
        }
      }
    }
    relationCacheSource = relations;
    relationCache = next;
    return next;
  }

  function relationTags(a, b) {
    return relationMap().get(pairKey(a, b)) || new Set();
  }

  function currentNowMinutes(callerCtx) {
    if (Number.isFinite(callerCtx?.now?.nowMin)) return callerCtx.now.nowMin;
    const hour = Number(window.CalendarSystem?.getHour?.());
    return Number.isFinite(hour) ? Math.round(hour * 60) : 720;
  }

  function currentDay(callerCtx) {
    if (Number.isFinite(callerCtx?.now?.day)) return callerCtx.now.day;
    const debugDay = Number(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay);
    return Number.isFinite(debugDay) ? Math.floor(debugDay) : 0;
  }

  function daypartForMinutes(nowMin) {
    const m = ((Math.round(numberOr(nowMin, 720)) % 1440) + 1440) % 1440;
    if (m < 300) return 'lateNight';
    if (m < 420) return 'dawn';
    if (m < 660) return 'morning';
    if (m < 780) return 'midday';
    if (m < 1020) return 'afternoon';
    if (m < 1260) return 'evening';
    return 'night';
  }

  function dailySigned(npcId, day, salt) {
    const seeded = Number(window.NpcAgenda?.dailySeed?.(npcId, day, salt));
    if (Number.isFinite(seeded)) return seeded * 2 - 1;
    let h = 2166136261;
    const text = `${npcId || 'npc'}|${Math.floor(day) || 0}|${salt}`;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) / 4294967296) * 2 - 1;
  }

  function effectiveRelationshipWeights(rec, beat, callerCtx) {
    const cfg = seatingConfig();
    const weights = { ...cfg.baseRelationshipWeights };
    const activity = String(beat?.activity || '');
    const daypart = daypartForMinutes(currentNowMinutes(callerCtx));
    const activityAdjust = cfg.activityAdjustments?.[activity] || {};
    const daypartAdjust = cfg.daypartAdjustments?.[daypart] || {};
    const perBeat = beat?.preferences?.socialSeating?.relationshipWeights || {};
    const day = currentDay(callerCtx);
    const variation = Math.max(0, numberOr(cfg.dailyVariation, 0));

    for (const type of RELATION_TYPES) {
      weights[type] = numberOr(weights[type], 0)
        + numberOr(activityAdjust[type], 0)
        + numberOr(daypartAdjust[type], 0)
        + numberOr(perBeat[type], 0)
        + dailySigned(rec?.id, day, `social-seat:${type}`) * variation;
    }
    return { weights, daypart, activity };
  }

  // Runtime path: use the already-exposed live walker array in one O(N) pass.
  // The old implementation called listNpcIds() and then npcSnapshot(id), whose
  // npcSnapshot itself did npcWalkers.find(...). Because schedule resolution is
  // called for every NPC every frame, that became an accidental O(N^3) hot path.
  // The debug-tools fallback stays solely for headless tests/older boot order.
  function liveNpcSnapshots(area, selfId) {
    const walkers = Array.isArray(window._npcWalkers) ? window._npcWalkers : null;
    if (walkers) {
      const out = [];
      for (const walker of walkers) {
        const npcId = walker?.rec?.id;
        if (!npcId || npcId === selfId || walker.area !== area) continue;
        out.push({
          npcId,
          snap: {
            area: walker.area,
            state: walker.state,
            x: walker.root?.position?.x,
            z: walker.root?.position?.z,
            currentScheduleTarget: walker.currentScheduleTarget ? { ...walker.currentScheduleTarget } : null,
          },
        });
      }
      return out;
    }

    const debug = window.__farmDebugTools;
    if (!debug?.listNpcIds || !debug?.npcSnapshot) return [];
    const out = [];
    for (const npcId of debug.listNpcIds() || []) {
      if (!npcId || npcId === selfId) continue;
      const snap = debug.npcSnapshot(npcId);
      if (!snap || snap.area !== area) continue;
      out.push({ npcId, snap });
    }
    return out;
  }

  function npcAnchor(snapshot) {
    const target = snapshot?.currentScheduleTarget;
    if (Number.isFinite(target?.c) && Number.isFinite(target?.r)) {
      return { x: target.c + 0.5, z: target.r + 0.5, stationId: target.stationId || null };
    }
    if (Number.isFinite(snapshot?.x) && Number.isFinite(snapshot?.z)) {
      return { x: snapshot.x, z: snapshot.z, stationId: null };
    }
    return null;
  }

  function seatPoint(station) {
    return { x: numberOr(station?.c, 0) + 0.5, z: numberOr(station?.r, 0) + 0.5 };
  }

  function stationIdOf(station) {
    return station?.stationId || station?.id || null;
  }

  function playerOccupiedStationId(area) {
    const furniture = window.__hobunjiFurnitureDebug;
    const sit = furniture?.sitState;
    if (!sit || sit.phase === 'out') return null;
    const playerArea = furniture?.getCurrentArea?.() || area || null;
    if (!playerArea || (area && playerArea !== area)) return null;
    const col = Number(sit.col), row = Number(sit.row);
    if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
    return `furniture_chair_${playerArea}_${col}_${row}`;
  }

  function isOccupied(station, snapshots, playerSeatId) {
    const stationId = stationIdOf(station);
    if (!stationId) return false;
    if (playerSeatId && stationId === playerSeatId) return true;
    return snapshots.some(entry => entry.snap?.currentScheduleTarget?.stationId === stationId);
  }

  function targetIsSeat(target) {
    return !!target && (target.pose === 'sit' || target.roles?.includes?.('sit') || /^furniture_chair_/.test(String(target.stationId || '')));
  }

  function seatRoleRequest(rec, beat, result) {
    const target = result?.target;
    if (!targetIsSeat(target)) return null;
    const config = socialConfig();
    const redirect = config.fixedSeatRoleRedirects?.[rec?.id];
    if (redirect && (redirect.stationIds || []).includes(target.stationId)) {
      return { role: redirect.role || 'sit', area: redirect.area || target.area, source: 'fixed-seat-redirect' };
    }

    const personal = config.npcSeatPreferences?.[rec?.id];
    if (personal?.alwaysReactive) {
      return { role: 'sit', area: target.area, source: 'npc-seat-preference' };
    }

    if (beat?.activity === 'sit') return { role: 'sit', area: target.area, source: 'sit-activity' };
    if (beat?.destinationRole) {
      return { role: beat.destinationRole, area: beat.destinationArea || target.area, source: 'role-seat' };
    }
    return null;
  }

  function candidateSeats(roleRequest) {
    const role = roleRequest?.role || 'sit';
    const area = roleRequest?.area;
    let candidates = scheduling.findStationsByRole(role, area ? { area } : {}) || [];
    if (!candidates.length && role === 'sit') {
      candidates = scheduling.findStationsByRole('sit', area ? { area } : {}) || [];
    }
    return candidates.filter(targetIsSeat);
  }

  function scoreCandidate(station, rec, beat, callerCtx, snapshots, scoring) {
    const cfg = seatingConfig();
    const { weights, daypart, activity } = scoring;
    const relationRadius = Math.max(0.1, numberOr(cfg.relationRadiusTiles, 5));
    const falloff = Math.max(0.1, numberOr(cfg.distanceFalloffTiles, relationRadius));
    const point = seatPoint(station);
    let score = 0;
    const reasons = [];

    for (const other of snapshots) {
      const anchor = npcAnchor(other.snap);
      if (!anchor) continue;
      const d = Math.hypot(point.x - anchor.x, point.z - anchor.z);
      if (d > relationRadius) continue;
      const proximity = clamp01(1 - d / falloff);
      const tags = relationTags(rec?.id, other.npcId);
      for (const type of tags) {
        const contribution = numberOr(weights[type], 0) * proximity;
        score += contribution;
        if (Math.abs(contribution) >= 0.25) reasons.push(`${type}:${other.npcId}:${contribution.toFixed(1)}`);
      }

      const genericPrefs = rec?.socialPreferences || {};
      if (genericPrefs.preferNpcIds?.includes?.(other.npcId)) {
        const bonus = 6 * proximity;
        score += bonus;
        reasons.push(`prefer:${other.npcId}:${bonus.toFixed(1)}`);
      }
      if (genericPrefs.avoidNpcIds?.includes?.(other.npcId)) {
        const penalty = -18 * proximity;
        score += penalty;
        reasons.push(`avoid:${other.npcId}:${penalty.toFixed(1)}`);
      }
    }

    const personal = socialConfig().npcSeatPreferences?.[rec?.id] || {};
    const preferredIds = personal.preferredNpcIds || [];
    const preferredPresent = snapshots.filter(entry => preferredIds.includes(entry.npcId) && npcAnchor(entry.snap));
    if (preferredPresent.length) {
      const radius = Math.max(0.1, numberOr(personal.preferredRadiusTiles, relationRadius));
      let best = 0;
      let bestId = null;
      for (const other of preferredPresent) {
        const anchor = npcAnchor(other.snap);
        const d = Math.hypot(point.x - anchor.x, point.z - anchor.z);
        const proximity = clamp01(1 - d / radius);
        if (proximity > best) { best = proximity; bestId = other.npcId; }
      }
      const bonus = numberOr(personal.preferredNpcBonus, 0) * best;
      score += bonus;
      if (bonus) reasons.push(`preferred:${bestId}:${bonus.toFixed(1)}`);
    } else if (personal.whenPreferredAbsent === 'solitude') {
      let nearest = Infinity;
      for (const other of snapshots) {
        const anchor = npcAnchor(other.snap);
        if (!anchor) continue;
        nearest = Math.min(nearest, Math.hypot(point.x - anchor.x, point.z - anchor.z));
      }
      if (Number.isFinite(nearest)) {
        const cap = Math.max(0.1, numberOr(cfg.solitudeDistanceCapTiles, 12));
        const bonus = Math.min(nearest, cap) * numberOr(personal.solitudeWeight, 0);
        score += bonus;
        reasons.push(`solitude:${bonus.toFixed(1)}`);
      }
    }

    const perBeat = beat?.preferences?.socialSeating || {};
    if (Array.isArray(perBeat.preferNpcIds) && perBeat.preferNpcIds.length) {
      for (const other of snapshots) {
        if (!perBeat.preferNpcIds.includes(other.npcId)) continue;
        const anchor = npcAnchor(other.snap);
        if (!anchor) continue;
        const d = Math.hypot(point.x - anchor.x, point.z - anchor.z);
        const proximity = clamp01(1 - d / relationRadius);
        const bonus = numberOr(perBeat.preferredNpcBonus, 10) * proximity;
        score += bonus;
        reasons.push(`beat-prefer:${other.npcId}:${bonus.toFixed(1)}`);
      }
    }

    const noiseScale = Math.max(0, numberOr(cfg.deterministicTieNoise, 0));
    const stationId = stationIdOf(station) || `${station?.c},${station?.r}`;
    const noise = dailySigned(rec?.id, currentDay(callerCtx), `social-seat:station:${stationId}`) * noiseScale;
    score += noise;

    return { station, score, reasons, weights, daypart, activity };
  }

  function reseatWithRequest(result, beat, callerCtx, request) {
    const rec = callerCtx?.rec;
    let candidates = candidateSeats(request);
    if (candidates.length < 2) return result;

    const area = request.area || result.target.area;
    const snapshots = liveNpcSnapshots(area, rec.id);
    const playerSeatId = playerOccupiedStationId(area);
    const free = candidates.filter(station => !isOccupied(station, snapshots, playerSeatId));
    if (free.length) candidates = free;
    if (!candidates.length) return result;

    const scoring = effectiveRelationshipWeights(rec, beat, callerCtx);
    const scored = candidates.map(station => scoreCandidate(station, rec, beat, callerCtx, snapshots, scoring));
    scored.sort((a, b) => b.score - a.score || String(stationIdOf(a.station)).localeCompare(String(stationIdOf(b.station))));
    const chosen = scored[0];
    if (!chosen?.station) return result;

    const originalTarget = result.target;
    const replacement = {
      ...originalTarget,
      ...chosen.station,
      stationId: stationIdOf(chosen.station),
      activity: originalTarget.activity,
      routeId: originalTarget.routeId || null,
      socialSeatSource: request.source,
      socialSeatScore: Math.round(chosen.score * 100) / 100,
      socialSeatDaypart: chosen.daypart,
    };

    lastDecisionByNpc.set(rec.id, {
      npcId: rec.id,
      source: request.source,
      role: request.role,
      area: area || replacement.area,
      beatId: beat?.id || null,
      activity: beat?.activity || null,
      daypart: chosen.daypart,
      relationshipWeights: { ...chosen.weights },
      originalStationId: originalTarget.stationId || null,
      chosenStationId: replacement.stationId,
      playerOccupiedStationId: playerSeatId,
      candidates: scored.map(entry => ({
        stationId: stationIdOf(entry.station),
        c: entry.station.c,
        r: entry.station.r,
        score: Math.round(entry.score * 100) / 100,
        reasons: [...entry.reasons],
      })),
    });

    return { ...result, target: replacement };
  }

  function reseat(result, beat, callerCtx) {
    if (result?.status !== activities.STATUS?.READY || !result.target) return result;
    const cfg = seatingConfig();
    if (cfg.enabled === false) return result;
    const rec = callerCtx?.rec;
    if (!rec?.id) return result;
    const request = seatRoleRequest(rec, beat, result);
    if (!request) return result;
    return reseatWithRequest(result, beat, callerCtx, request);
  }

  function runtimeNowMs() {
    return Number(window.performance?.now?.()) || Date.now();
  }

  function reevaluateMs() {
    const seconds = Math.max(0.05, numberOr(seatingConfig().reevaluateSeconds, 1));
    return seconds * 1000;
  }

  function cacheKeyFor(result, beat, callerCtx, request) {
    const target = result?.target || {};
    const area = request?.area || target.area || '';
    return [
      beat?.id || '', beat?.activity || '', request?.source || '', request?.role || '', area,
      stationIdOf(target) || '', target.c ?? '', target.r ?? '',
      currentDay(callerCtx), daypartForMinutes(currentNowMinutes(callerCtx)),
      playerOccupiedStationId(area) || '',
    ].join('|');
  }

  function reseatCached(result, beat, callerCtx) {
    if (result?.status !== activities.STATUS?.READY || !result.target) return result;
    if (seatingConfig().enabled === false) return result;
    const rec = callerCtx?.rec;
    if (!rec?.id) return result;
    const request = seatRoleRequest(rec, beat, result);
    if (!request) return result;

    // Headless regression tests and very-early boot do not expose the live
    // walker array. Keep those calls uncached so mocked occupancy changes are
    // observed immediately; the real game always exposes window._npcWalkers.
    if (!Array.isArray(window._npcWalkers)) {
      return reseatWithRequest(result, beat, callerCtx, request);
    }

    const key = cacheKeyFor(result, beat, callerCtx, request);
    const now = runtimeNowMs();
    const cached = decisionCacheByNpc.get(rec.id);
    if (cached && cached.key === key && now < cached.expiresAt) {
      return { ...result, target: { ...cached.target } };
    }

    const resolved = reseatWithRequest(result, beat, callerCtx, request) || result;
    decisionCacheByNpc.set(rec.id, {
      key,
      expiresAt: now + reevaluateMs(),
      target: { ...(resolved.target || result.target) },
    });
    return resolved;
  }

  const originalResolveDestination = activities.resolveDestination.bind(activities);
  activities.resolveDestination = function resolveDestinationWithSocialSeating(beat, callerCtx) {
    const result = originalResolveDestination(beat, callerCtx);
    try { return reseatCached(result, beat, callerCtx) || result; }
    catch (error) {
      window.__farmLog?.(`[social seating] ${callerCtx?.rec?.id || 'npc'} reseat failed: ${error?.message || error}`, 'warn');
      return result;
    }
  };

  function debugSnapshot(npcId) {
    const decision = lastDecisionByNpc.get(String(npcId || ''));
    return decision ? JSON.parse(JSON.stringify(decision)) : null;
  }

  function invalidateCache(npcId = null) {
    if (npcId) decisionCacheByNpc.delete(String(npcId));
    else decisionCacheByNpc.clear();
    relationCacheSource = null;
  }

  window.NpcSocialSeating = {
    version: 2,
    relationTags: (a, b) => [...relationTags(a, b)],
    effectiveRelationshipWeights,
    debugSnapshot,
    reseat,
    invalidateCache,
  };

  if (window.__farmDebugTools) {
    window.__farmDebugTools.socialSeatSnapshot = debugSnapshot;
  }
})();