(() => {
  'use strict';

  // Authored NPC-to-NPC relationship tags and social seating policy.
  //
  // Keep these concepts separate:
  //   partner — romantic/domestic partner weighting
  //   family  — blood/adoptive/in-law family weighting
  //   friend  — chosen friendship weighting
  //
  // The seating runtime reads this through the existing
  // SCRATCHBONES_CONFIG.game.socialRelationships root, shared with Rapport,
  // drinks, gifting, and dance/social inhibition. Everything here is data:
  // weights, radii, relationship pairs, fixed-seat migrations, and per-NPC
  // quirks can be tuned without changing the seating algorithm.

  const root = window.SCRATCHBONES_CONFIG = window.SCRATCHBONES_CONFIG || {};
  root.game = root.game || {};
  const authored = root.game.socialRelationships || {};

  const DEFAULT_SEATING = Object.freeze({
    enabled: true,
    relationRadiusTiles: 5,
    distanceFalloffTiles: 5,
    dailyVariation: 2.25,
    deterministicTieNoise: 0.2,
    solitudeDistanceCapTiles: 12,
    baseRelationshipWeights: Object.freeze({
      partner: 14,
      family: 11,
      friend: 8,
    }),
    // Beat/activity shifts: meals skew family/partner, explicitly social
    // beats skew friendship, while generic sitting stays comparatively mild.
    activityAdjustments: Object.freeze({
      socialize: Object.freeze({ partner: 3, family: 2, friend: 7 }),
      visit: Object.freeze({ partner: 3, family: 5, friend: 5 }),
      eat: Object.freeze({ partner: 6, family: 7, friend: -1 }),
      drink: Object.freeze({ partner: 3, family: 1, friend: 8 }),
      break: Object.freeze({ partner: 2, family: 2, friend: 4 }),
      freeTime: Object.freeze({ partner: 2, family: 2, friend: 3 }),
      sit: Object.freeze({ partner: 3, family: 2, friend: 2 }),
      idle: Object.freeze({ partner: 2, family: 1, friend: 0 }),
      goToRole: Object.freeze({ partner: 1, family: 1, friend: 1 }),
    }),
    // Time-of-day shifts are intentionally broad social rhythms, not hard
    // schedule rules. They only bias among otherwise valid seats.
    daypartAdjustments: Object.freeze({
      lateNight: Object.freeze({ partner: 7, family: 1, friend: -2 }),
      dawn: Object.freeze({ partner: 3, family: 3, friend: -1 }),
      morning: Object.freeze({ partner: 2, family: 4, friend: -1 }),
      midday: Object.freeze({ partner: 1, family: 2, friend: 2 }),
      afternoon: Object.freeze({ partner: 1, family: 1, friend: 4 }),
      evening: Object.freeze({ partner: 5, family: 4, friend: 3 }),
      night: Object.freeze({ partner: 6, family: 2, friend: 0 }),
    }),
  });

  // Explicit pair tags. A pair can gain another tag later without changing
  // any runtime code, but current authoring avoids redundant partner+family
  // double-counting for the same pair.
  const DEFAULT_RELATIONSHIPS = Object.freeze([
    // Partners already represented as shared households/families.
    { type: 'partner', members: ['gorobi_ginju', 'gikali_ginju'] },
    { type: 'partner', members: ['dzibim_khibu', 'dzahiri_khibu'] },
    { type: 'partner', members: ['kaboku_kunji', 'kinami_kunji'] },

    // Families — kept distinct from partner and friend tags.
    { type: 'family', members: ['kzubug', 'sloomi'] },
    { type: 'family', members: ['gorobi_ginju', 'aliri_ginju'] },
    { type: 'family', members: ['gorobi_ginju', 'gantami_ginju'] },
    { type: 'family', members: ['gikali_ginju', 'aliri_ginju'] },
    { type: 'family', members: ['gikali_ginju', 'gantami_ginju'] },
    { type: 'family', members: ['aliri_ginju', 'gantami_ginju'] },
    { type: 'family', members: ['dzibim_khibu', 'nashka_khibu'] },
    { type: 'family', members: ['dzahiri_khibu', 'nashka_khibu'] },
    { type: 'family', members: ['kaboku_kunji', 'nashka_khibu'] },
    { type: 'family', members: ['teacup_unumanuk', 'spearhead_unumanuk'] },
    { type: 'family', members: ['teacup_unumanuk', 'oddclaw_unumanuk'] },
    { type: 'family', members: ['spearhead_unumanuk', 'oddclaw_unumanuk'] },
    { type: 'family', members: ['namui_u_hakaru', 'takua_ao_hakaru'] },

    // Friends. Namu'i + Sloomi is intentionally authored here rather than
    // as a bespoke schedule exception, so all social systems can reuse it.
    { type: 'friend', members: ['leaf', 'pahu'] },
    { type: 'friend', members: ['furunji_funji', 'foroji_funji'] },
    { type: 'friend', members: ['namui_u_hakaru', 'father_hunundi_hodu'] },
    { type: 'friend', members: ['takua_ao_hakaru', 'father_hunundi_hodu'] },
    { type: 'friend', members: ['namui_u_hakaru', 'sloomi'] },
  ]);

  const DEFAULT_NPC_SEAT_PREFERENCES = Object.freeze({
    takua_ao_hakaru: Object.freeze({
      // Taku'a first tries to sit near Namu'i. When she is not present in
      // the seating area, he instead chooses the valid free seat with the
      // strongest solitude score — i.e. as far from other NPCs as practical.
      alwaysReactive: true,
      preferredNpcIds: ['namui_u_hakaru'],
      preferredNpcBonus: 40,
      preferredRadiusTiles: 6,
      whenPreferredAbsent: 'solitude',
      solitudeWeight: 5,
    }),
  });

  const DEFAULT_FIXED_SEAT_ROLE_REDIRECTS = Object.freeze({
    // Leaf and Pahu used to target these exact inn stools. The seating bridge
    // treats those authored targets as "sit somewhere in this inn" instead,
    // preserving the schedule beat while making the chair choice reactive.
    leaf: Object.freeze({
      stationIds: ['furniture_chair_map_i_inn_15_11'],
      area: 'map_i_inn',
      role: 'sit',
    }),
    pahu: Object.freeze({
      stationIds: ['furniture_chair_map_i_inn_4_8', 'furniture_chair_map_i_inn_3_11'],
      area: 'map_i_inn',
      role: 'sit',
    }),

    // The five Spirit Counsel attendees each used to target one fixed floor
    // spot in the old counsel-ring formation (station_temple_counsel_ring_1
    // through _5 — see map_i_temple.json's scheduleHooks-authored stations).
    // The ring formation is gone now that the room's spirit_communion layout
    // moves the benches to the walls and puts a campfire where the ring
    // used to sit — this redirects each of their still-authored ring
    // stationIds to "any free bench in the temple" instead, same idea as
    // Leaf/Pahu above. Every one of those benches carries its own `lookAt`
    // at the campfire (see map_i_temple.json's spirit_communion furniture),
    // so wherever the seating bridge actually seats them, their gaze
    // follows automatically — no per-NPC lookAt authoring needed here.
    binding_hatayap: Object.freeze({
      stationIds: ['station_temple_counsel_ring_1'],
      area: 'map_i_temple',
      role: 'sit',
    }),
    spearhead_unumanuk: Object.freeze({
      stationIds: ['station_temple_counsel_ring_2'],
      area: 'map_i_temple',
      role: 'sit',
    }),
    oddclaw_unumanuk: Object.freeze({
      stationIds: ['station_temple_counsel_ring_3'],
      area: 'map_i_temple',
      role: 'sit',
    }),
    tooth_hatayap: Object.freeze({
      stationIds: ['station_temple_counsel_ring_4'],
      area: 'map_i_temple',
      role: 'sit',
    }),
    bird_bone: Object.freeze({
      stationIds: ['station_temple_counsel_ring_5'],
      area: 'map_i_temple',
      role: 'sit',
    }),
  });

  function mergeNested(base, override) {
    const out = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)
        && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        out[key] = mergeNested(base[key], value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  const authoredRelationships = Array.isArray(authored.relationships) ? authored.relationships : [];
  const relationships = authored.replaceDefaultRelationships
    ? authoredRelationships
    : [...DEFAULT_RELATIONSHIPS, ...authoredRelationships];

  root.game.socialRelationships = {
    ...authored,
    seating: mergeNested(DEFAULT_SEATING, authored.seating || {}),
    relationships,
    npcSeatPreferences: {
      ...DEFAULT_NPC_SEAT_PREFERENCES,
      ...(authored.npcSeatPreferences || {}),
    },
    fixedSeatRoleRedirects: {
      ...DEFAULT_FIXED_SEAT_ROLE_REDIRECTS,
      ...(authored.fixedSeatRoleRedirects || {}),
    },
  };

  // Community schedules sit beside socialRelationships rather than inside it.
  // This backfills the Temple Service record that the 2026-07 schedule
  // migration authored, but which is absent from the current NPC database.
  const DEFAULT_COMMUNITY_SCHEDULES = Object.freeze([Object.freeze({ // Used by the planner bridge below when ordinary NPC agendas should yield to a village event.
    id: 'shared_temple_service',
    label: 'Temple Service',
    appliesToTag: 'villager',
    day: 'Anan',
    from: '09:00',
    to: '11:00',
    area: 'map_i_temple',
    stationIds: Object.freeze(Array.from({ length: 11 }, (_, i) => `station_temple_pew_${i + 1}`)),
    excludeNpcIds: Object.freeze(['father_hunundi_hodu', 'talisman_hatayap', 'bowstring_hatayap', 'hammerhead_tuhupnuk']),
    interruptsPersonalSchedule: true,
  })]);
  const authoredCommunitySchedules = Array.isArray(root.game.communitySchedules) ? root.game.communitySchedules : []; // Lets later authored config replace a default event by id without editing runtime code.
  const communitySchedulesById = new Map(DEFAULT_COMMUNITY_SCHEDULES.map(schedule => [schedule.id, schedule])); // Deduplicates defaults and authored overrides for planner lookup.
  for (const schedule of authoredCommunitySchedules) {
    if (schedule?.id) communitySchedulesById.set(schedule.id, schedule);
  }
  root.game.communitySchedules = [...communitySchedulesById.values()];

  // The grid-footprint migration accidentally dropped pew_1..pew_5 while
  // leaving the shared service pointed at all eleven historical ids. These
  // stations recreate the lost half of the bench anchors at runtime; the map
  // may safely re-author them later because existing ids are never replaced.
  const TEMPLE_PEW_BACKFILL = Object.freeze([ // Used by ensureTempleServiceStations before a service target is allocated.
    Object.freeze({ id: 'station_temple_pew_1', label: 'Seated for Temple Service', area: 'map_i_temple', col: 13, row: 7, rotY: 90, pose: 'sit', furnitureKey: 'benchFurniture', seatIndex: 1, roles: ['sit', 'temple_service'] }),
    Object.freeze({ id: 'station_temple_pew_2', label: 'Seated for Temple Service', area: 'map_i_temple', col: 5, row: 9, rotY: 270, pose: 'sit', furnitureKey: 'benchFurniture', seatIndex: 0, roles: ['sit', 'temple_service'] }),
    Object.freeze({ id: 'station_temple_pew_3', label: 'Seated for Temple Service', area: 'map_i_temple', col: 13, row: 9, rotY: 90, pose: 'sit', furnitureKey: 'benchFurniture', seatIndex: 1, roles: ['sit', 'temple_service'] }),
    Object.freeze({ id: 'station_temple_pew_4', label: 'Seated for Temple Service', area: 'map_i_temple', col: 5, row: 11, rotY: 270, pose: 'sit', furnitureKey: 'benchFurniture', seatIndex: 0, roles: ['sit', 'temple_service'] }),
    Object.freeze({ id: 'station_temple_pew_5', label: 'Seated for Temple Service', area: 'map_i_temple', col: 13, row: 11, rotY: 90, pose: 'sit', furnitureKey: 'benchFurniture', seatIndex: 1, roles: ['sit', 'temple_service'] }),
  ]);
  let allocationWindowKey = ''; // Resets collision-free pew assignments whenever the active event/day changes.
  const stationIdByNpc = new Map(); // Keeps each NPC on the same pew across repeated planner ticks within one service.
  const npcIdByStation = new Map(); // Prevents two eligible villagers from being assigned the same pew while free pews remain.

  function parseMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/); // Parses authored HH:MM boundaries for community schedule windows.
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function minutesNow() {
    const hour = Number(window.CalendarSystem?.getHour?.()); // Reads the same live game clock used by NPC scheduling.
    return Number.isFinite(hour) ? Math.floor(hour * 60) : NaN;
  }

  function withinWindow(now, start, end) {
    if (![now, start, end].every(Number.isFinite)) return false;
    if (start === end) return true;
    return start < end ? now >= start && now < end : now >= start || now < end;
  }

  function stableIndex(text, count) {
    let hash = 2166136261; // Gives each NPC a stable first-choice pew before linear collision probing.
    for (const ch of String(text || 'npc')) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return count > 0 ? (hash >>> 0) % count : 0;
  }

  function activeCommunityScheduleForNpc(rec) {
    const weekday = window.CalendarSystem?.currentWeekdayName?.(); // Used to reject community events that are not active on today's weekday.
    const now = minutesNow(); // Used with each event's time bounds below.
    for (const schedule of root.game.communitySchedules || []) {
      if (!schedule?.interruptsPersonalSchedule) continue;
      if (schedule.day && weekday !== schedule.day) continue;
      if (!withinWindow(now, parseMinutes(schedule.from), parseMinutes(schedule.to))) continue;
      if (schedule.appliesToTag && !(rec?.tags || []).includes(schedule.appliesToTag)) continue;
      if ((schedule.excludeNpcIds || []).includes(rec?.id)) continue;
      return schedule;
    }
    return null;
  }

  function ensureTempleServiceStations(schedule) {
    const scheduling = window.NpcScheduling; // Registers only missing historical pew ids in the scheduler's authoritative station map.
    if (!scheduling?.registerNpcStations || !scheduling?.stationsById) return;
    if (schedule?.id !== 'shared_temple_service') return;
    const missing = TEMPLE_PEW_BACKFILL.filter(station => !scheduling.stationsById.has(station.id)); // Avoids overwriting any map-authored replacement station.
    if (missing.length) scheduling.registerNpcStations(missing, 'map_i_temple');
  }

  function allocateStationId(schedule, npcId, validIds) {
    const rawDay = Number(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay); // Makes one allocation pool per in-game day even when weekday names repeat.
    const dayKey = Number.isFinite(rawDay) ? Math.floor(rawDay) : String(window.CalendarSystem?.currentWeekdayName?.() || 'day');
    const nextWindowKey = `${schedule.id}|${dayKey}`; // Used to clear stale pew ownership at the next service/day.
    if (allocationWindowKey !== nextWindowKey) {
      allocationWindowKey = nextWindowKey;
      stationIdByNpc.clear();
      npcIdByStation.clear();
    }
    const prior = stationIdByNpc.get(npcId); // Reuses an already-issued valid pew on every subsequent planner tick.
    if (prior && validIds.includes(prior)) return prior;
    const start = stableIndex(npcId, validIds.length); // Spreads first choices, then probes so collisions do not stack villagers on one bench.
    for (let offset = 0; offset < validIds.length; offset++) {
      const id = validIds[(start + offset) % validIds.length];
      if (npcIdByStation.has(id)) continue;
      stationIdByNpc.set(npcId, id);
      npcIdByStation.set(id, npcId);
      return id;
    }
    return validIds[start] || null;
  }

  function resolveCommunityScheduleTarget(rec) {
    const schedule = activeCommunityScheduleForNpc(rec); // Decides whether this NPC should interrupt their normal agenda for a village event.
    if (!schedule) return null;
    ensureTempleServiceStations(schedule);
    const scheduling = window.NpcScheduling; // Resolves the chosen station through the same normalized registry as ordinary schedules.
    const validIds = (schedule.stationIds || []).filter(id => !!scheduling?.resolveNpcStationTarget?.(id)); // Drops stale ids instead of allowing the event to fail entirely.
    if (!validIds.length) return null;
    const stationId = allocateStationId(schedule, rec?.id || 'npc', validIds); // Gives this villager a stable, collision-free pew for the current service.
    const target = scheduling.resolveNpcStationTarget(stationId); // Supplies furniture/pose metadata from the authoritative station registry.
    return target ? {
      ...target,
      activity: schedule.label || schedule.id || 'Community Event',
      communityScheduleId: schedule.id,
      interruptsPersonalSchedule: true,
    } : null;
  }

  function communityScheduleDebugSnapshot(npcId) {
    const rec = npcId ? { id: String(npcId), tags: ['villager'] } : null; // Lets mobile diagnostics inspect one id even when only the id is convenient to paste.
    const active = rec ? activeCommunityScheduleForNpc(rec) : null; // Reports eligibility against the current clock/day.
    return {
      weekday: window.CalendarSystem?.currentWeekdayName?.() || null,
      hour: Number(window.CalendarSystem?.getHour?.()),
      schedules: (root.game.communitySchedules || []).map(schedule => ({
        id: schedule.id,
        label: schedule.label,
        day: schedule.day,
        from: schedule.from,
        to: schedule.to,
        appliesToTag: schedule.appliesToTag || null,
        interruptsPersonalSchedule: !!schedule.interruptsPersonalSchedule,
        stationIds: [...(schedule.stationIds || [])],
        registeredStationIds: (schedule.stationIds || []).filter(id => window.NpcScheduling?.stationsById?.has?.(id)),
      })),
      npcId: rec?.id || null,
      activeScheduleId: active?.id || null,
      assignedStationId: rec ? stationIdByNpc.get(rec.id) || null : null,
      latestChange: 'Morning Temple Service now interrupts ordinary villager routines; lost pews 1-5 are backfilled at runtime.',
    };
  }

  function installCommunitySchedulePlannerBridge() {
    const planner = window.NpcActivityPlanner; // Decorated below so target overrides/visitor lifecycle still outrank community events in NpcScheduling.
    if (!planner?.resolveNpcTarget || planner.__communityScheduleBridgeInstalled) return;
    const originalResolveNpcTarget = planner.resolveNpcTarget.bind(planner); // Preserves all ordinary agenda/free-time/legacy resolution outside an active community event.
    planner.resolveNpcTarget = function resolveNpcTargetWithCommunitySchedule(rec, options) {
      const communityTarget = resolveCommunityScheduleTarget(rec); // Checked before ordinary agenda beats so morning service actually gathers villagers.
      if (communityTarget) return communityTarget;
      return originalResolveNpcTarget(rec, options);
    };
    planner.__communityScheduleBridgeInstalled = true;
  }

  installCommunitySchedulePlannerBridge();

  window.HobunjiNpcSocialRelationsConfig = root.game.socialRelationships;
  window.NpcCommunitySchedules = { // Exposes the bridge for headless tests and mobile-friendly diagnostics.
    schedules: root.game.communitySchedules,
    activeForNpc: activeCommunityScheduleForNpc,
    resolveTarget: resolveCommunityScheduleTarget,
    debugSnapshot: communityScheduleDebugSnapshot,
  };
  if (window.__farmDebugTools) {
    window.__farmDebugTools.communityScheduleSnapshot = communityScheduleDebugSnapshot;
  }
})();