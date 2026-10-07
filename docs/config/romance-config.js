// Dating / marriage / family tuning — read by js/romance-system.js,
// js/npc-command-wheel.js and js/romance-family.js. Everything here is data:
// change a number or a like list without touching the runtime modules.
(() => {
  'use strict';

  const DAYS_PER_MONTH = 28; // Mirrors CalendarSystem.constants.DAYS_PER_MONTH so month-based timings below read naturally.

  const config = {
    schema: 'hobunji_romance.v1',

    // ── Romance points ───────────────────────────────────────────────────
    // Romance is a second, date-only relationship pool that behaves like
    // Rapport (it settles into permanent Favor at midnight and resets) but
    // with a much higher cap, a negative floor, and 5x Rapport's conversion
    // weight. NpcRapport.settle owns the midnight conversion.
    romanceMin: -100,
    romanceMax: 400,
    romanceConversionMultiplier: 5, // × socialRelationships.rapportToFavorRate (0.10) → 0.5 Favor per Romance point.

    // ── Dates ────────────────────────────────────────────────────────────
    dateDurationHours: 4, // In-game hours a date lasts before the NPC heads home.
    minHeartsToAskOut: 2, // Completed positive Favor hearts (40 Favor each) required before an NPC will say yes.
    datesPerNpcPerDay: 1,
    likeAwareRadiusTiles: 14, // The date must be this close (same area) to notice an activity they like.
    followDistanceTiles: 1.7, // How far behind the player a following date stops.
    followCatchUpDistanceTiles: 4, // Beyond this, a following date walks faster (see followMaxSpeedMultiplier).
    followMaxSpeedMultiplier: 3.2,
    baseLikeRomance: 14, // Romance granted the first time the date sees an activity they like.
    repeatLikeDecay: 0.6, // Each repeat of the same liked activity on the same date is worth this fraction of the previous.
    minRepeatLikeRomance: 2,
    likeCooldownGameMinutes: 6, // The same liked activity can't score twice within this many in-game minutes.
    dateCompletedRomance: 10, // Bonus for seeing a date through to the end with your date still beside you.

    // Characters only lose Romance from this select set of things. `who` is
    // 'all' or a list of npc ids; `amount` is negative Romance.
    losses: [
      { id: 'date_abandoned', label: 'left them waiting', who: 'all', amount: -25 }, // Date ran out while they were told to Wait and you were elsewhere.
      { id: 'date_dismissed_early', label: 'cut the date short', who: 'all', amount: -10 }, // Dismissed before half the date's time was up.
      { id: 'barbarian_killed', label: 'killed a barbarian', who: ['tooth_hatayap', 'namui_u_hakaru', 'takua_ao_hakaru'], amount: -20 },
      { id: 'nest_stolen', label: 'stole from a nest', who: ['aliri_ginju', 'foroji_funji', 'jubmir'], amount: -15 },
    ],

    // ── Likes ────────────────────────────────────────────────────────────
    // Like ids map to activity rules in js/romance-system.js (LIKE_RULES).
    likes: {
      tooth_hatayap: ['fish_caught', 'drink_offered', 'dancing', 'kill_non_barbarian'],
      aliri_ginju: ['dancing', 'crop_harvested', 'farm_animal_petted', 'farm_animal_harvested', 'herb_picked', 'meal_cooked'],
      nashka_khibu: ['tree_felled', 'rock_broken', 'chest_opened', 'bandit_or_predator_killed'],
      sloomi: ['ore_mined', 'tree_felled', 'herb_picked', 'chest_opened', 'meal_cooked', 'potion_brewed'],
      namui_u_hakaru: ['kill_non_barbarian', 'fish_caught', 'chest_opened', 'meal_cooked', 'drink_offered', 'dancing'],
      oddclaw_unumanuk: ['bandit_killed', 'nest_stolen', 'farm_animal_petted', 'farm_animal_harvested', 'buried_chest_opened'],
      foroji_funji: ['drink_offered', 'kurraya_played', 'herb_picked', 'farm_animal_petted', 'farm_animal_harvested', 'crop_harvested'],
      jubmir: ['drink_offered', 'animal_petted', 'farm_animal_harvested', 'herb_picked', 'meal_cooked'],
      takua_ao_hakaru: ['kill_non_barbarian', 'fish_caught', 'chest_opened', 'drink_offered'],
    },
    likeLabels: {
      fish_caught: 'catching a fish',
      drink_offered: 'being offered a drink',
      dancing: 'dancing',
      kill_non_barbarian: 'a good kill',
      crop_harvested: 'harvesting a crop',
      farm_animal_petted: 'petting a farm animal',
      animal_petted: 'petting an animal',
      farm_animal_harvested: 'harvesting from livestock',
      herb_picked: 'gathering an herb',
      meal_cooked: 'cooking a meal',
      tree_felled: 'cutting down a tree',
      rock_broken: 'breaking a rock',
      chest_opened: 'opening a treasure chest',
      buried_chest_opened: 'digging up buried treasure',
      bandit_or_predator_killed: 'taking down a bandit or predator',
      bandit_killed: 'taking down a bandit',
      ore_mined: 'digging up ore',
      potion_brewed: 'brewing a potion',
      kurraya_played: 'playing the kurraya',
      nest_stolen: 'stealing from a nest',
    },

    // ── Marriage ─────────────────────────────────────────────────────────
    minHeartsToPropose: 10,
    minDatesToPropose: 3,
    weddingDelayDays: 1, // The ceremony can happen from this many days after the proposal.
    weddingHours: { start: 8, end: 20 }, // Arriving at the Life Temple in this window starts the ceremony.
    templeAreaId: 'map_i_temple',
    officiantNpcId: 'father_hunundi_hodu',
    spouse: {
      sleepHours: { start: 22, end: 7 },
      townAfternoon: { start: 12, end: 17, daysOfWeekMod: 3 }, // Visits town (their old schedule) on roughly every third day's afternoon.
      farmWanderRadiusTiles: 6,
      seatBlockMinutes: 90, // How long the spouse sticks with one chair before picking another.
    },

    // ── Family ───────────────────────────────────────────────────────────
    family: {
      announceAfterDays: 3 * DAYS_PER_MONTH,
      birthAfterDays: 6 * DAYS_PER_MONTH,
      basketDays: 1 * DAYS_PER_MONTH,
      toddlingDays: 5 * DAYS_PER_MONTH, // Toddling Footing eases 99 → 0 over this span after leaving the basket.
      independentAfterDays: 12 * DAYS_PER_MONTH, // Age (from birth) at which children walk normally and leave the house.
      eggLayingSpecies: ['kenkari'],
      childScale: 0.62,
      vatEfficacyMultiplier: 2,
    },
  };

  window.SCRATCHBONES_CONFIG = window.SCRATCHBONES_CONFIG || {};
  window.SCRATCHBONES_CONFIG.game = window.SCRATCHBONES_CONFIG.game || {};
  window.SCRATCHBONES_CONFIG.game.romance = Object.assign(config, window.SCRATCHBONES_CONFIG.game.romance || {});
  window.HobunjiRomanceConfig = window.SCRATCHBONES_CONFIG.game.romance;
})();
