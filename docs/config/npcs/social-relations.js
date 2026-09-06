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
    // Seat choice does not need frame-rate reactivity. Re-score periodically
    // (and immediately when the player's occupied chair changes) instead of
    // re-running relationship/occupancy scoring once per NPC every frame.
    reevaluateSeconds: 1,
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

  window.HobunjiNpcSocialRelationsConfig = root.game.socialRelationships;
})();