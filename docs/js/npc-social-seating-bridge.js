(() => {
  'use strict';
  if (Number(window.NpcSocialSeating?.version) >= 1) return;

  const activities = window.NpcActivities; // Existing resolver being decorated rather than replaced.
  const scheduling = window.NpcScheduling; // Existing station registry remains authoritative for valid seats.
  if (!activities?.resolveDestination || !scheduling?.findStationsByRole) return;

  const RELATION_TYPES = Object.freeze(['partner', 'family', 'friend']);
  const lastDecisionByNpc = new Map(); // Mobile-friendly debug history for the most recent reseat decision.
  let relationCacheKey = '';
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
    const key = JSON.stringify(relations);
    if (key === relationCacheKey) return relationCache;
    const next = new Map();
    for (const relation of relations) {
      const type = String(relation?.type || '');
      const members = Array.isArray(relation?.members) ? relation.members.filter(Boolean) : [];
      if (!RELATION_TYPES.includes(type) || members.length < 2) continue;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const key2 = pairKey(members[i], members[j]);
          if (!next.has(key2)) next.set(key2, new Set());
          next.get(key2).add(type);
        }
      }
    }
    relationCacheKey = key;
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

  function debugNpcSnapshots(area, selfId) {
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

  function isOccupied(station, snapshots) {
    const stationId = station?.stationId || station?.id;
    if (!stationId) return false;
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
    // A fixed exact-chair migration or always-reactive personal preference
    // deliberately means "any seat here". If a semantic sub-role has no
    // candidates, never broaden it silently; that would let work/story roles
    // drift into unrelated chairs.
    if (!candidates.length && role === 'sit') {
      candidates = scheduling.findStationsByRole('sit', area ? { area } : {}) || [];
    }
    return candidates.filter(targetIsSeat);
  }

  function scoreCandidate(station, rec, beat, callerCtx, snapshots) {
    const cfg = seatingConfig();
    const { weights, daypart, activity } = effectiveRelationshipWeights(rec, beat, callerCtx);
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
    const stationId = station?.stationId || station?.id || `${station?.c},${station?.r}`;
    const noise = dailySigned(rec?.id, currentDay(callerCtx), `social-seat:station:${stationId}`) * noiseScale;
    score += noise;

    return { station, score, reasons, weights, daypart, activity };
  }

  function reseat(result, beat, callerCtx) {
    if (result?.status !== activities.STATUS?.READY || !result.target) return result;
    const cfg = seatingConfig();
    if (cfg.enabled === false) return result;
    const rec = callerCtx?.rec;
    if (!rec?.id) return result;

    const request = seatRoleRequest(rec, beat, result);
    if (!request) return result;
    let candidates = candidateSeats(request);
    if (candidates.length < 2) return result;

    const snapshots = debugNpcSnapshots(request.area || result.target.area, rec.id);
    const free = candidates.filter(station => !isOccupied(station, snapshots));
    if (free.length) candidates = free;
    if (!candidates.length) return result;

    const scored = candidates.map(station => scoreCandidate(station, rec, beat, callerCtx, snapshots));
    scored.sort((a, b) => b.score - a.score || String(a.station.stationId || a.station.id).localeCompare(String(b.station.stationId || b.station.id)));
    const chosen = scored[0];
    if (!chosen?.station) return result;

    const originalTarget = result.target;
    const replacement = {
      ...originalTarget,
      ...chosen.station,
      stationId: chosen.station.stationId || chosen.station.id,
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
      area: request.area || replacement.area,
      beatId: beat?.id || null,
      activity: beat?.activity || null,
      daypart: chosen.daypart,
      relationshipWeights: { ...chosen.weights },
      originalStationId: originalTarget.stationId || null,
      chosenStationId: replacement.stationId,
      candidates: scored.map(entry => ({
        stationId: entry.station.stationId || entry.station.id,
        c: entry.station.c,
        r: entry.station.r,
        score: Math.round(entry.score * 100) / 100,
        reasons: [...entry.reasons],
      })),
    });

    return { ...result, target: replacement };
  }

  const originalResolveDestination = activities.resolveDestination.bind(activities);
  activities.resolveDestination = function resolveDestinationWithSocialSeating(beat, callerCtx) {
    const result = originalResolveDestination(beat, callerCtx);
    try { return reseat(result, beat, callerCtx) || result; }
    catch (error) {
      window.__farmLog?.(`[social seating] ${callerCtx?.rec?.id || 'npc'} reseat failed: ${error?.message || error}`, 'warn');
      return result;
    }
  };

  function debugSnapshot(npcId) {
    const decision = lastDecisionByNpc.get(String(npcId || ''));
    return decision ? JSON.parse(JSON.stringify(decision)) : null;
  }

  window.NpcSocialSeating = {
    version: 1,
    relationTags: (a, b) => [...relationTags(a, b)],
    effectiveRelationshipWeights,
    debugSnapshot,
    reseat,
  };

  if (window.__farmDebugTools) {
    window.__farmDebugTools.socialSeatSnapshot = debugSnapshot;
  }
})();
