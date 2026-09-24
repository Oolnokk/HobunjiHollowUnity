(() => {
  'use strict';
  if (window.HobunjiNpcClothingPatterns) return;

  const TANKAN_GUARD_EMBLEM = Object.freeze({
    repoPatternId: 'tankan_guard_emblem',
    motifUrl: 'assets/patterns/motif_white_bronze_sun.png', // Reuses the raw White Bronze Sun motif; the independent repo pattern below owns the guard-specific placement.
    motifScale: 0.59,
    motifRotationDeg: 0,
    tiling: false,
    invert: false,
    motifThinPx: -5,
    frameShape: 'square',
    frameX: -16,
    frameY: -186,
    frameRotationDeg: 0,
    frameScale: 6,
    meshScale: 1.94,
    meshRotationDeg: 0,
    overpassClearanceMultiplier: 3,
  }); // Synchronous snapshot of the authored Tankan Guard Emblem avoids first-avatar-bake races with the async repo pattern loader.

  const npcs = Object.freeze({
    oddclaw_unumanuk: Object.freeze({
      defaultClothing: Object.freeze({
        overwear: Object.freeze({ cosmeticId: 'rugged_poncho', slot: 'overwear', colorA: Object.freeze({ dyeId: 'dye:CLOTH:pale_green_blue' }) }),
      }),
      forcedOverpassBySlot: Object.freeze({
        overwear: Object.freeze({
          label: 'Tankan Guard Emblem',
          pattern: TANKAN_GUARD_EMBLEM,
          roles: Object.freeze(['poncho']),
          fallbackColorC: Object.freeze({ dyeId: 'dye:CLOTH:smoky_green_blue' }),
        }),
      }),
    }),
    spearhead_unumanuk: Object.freeze({
      defaultClothing: Object.freeze({
        overwear: Object.freeze({ cosmeticId: 'rugged_poncho', slot: 'overwear', colorA: Object.freeze({ dyeId: 'dye:CLOTH:pale_green_blue' }) }),
      }),
      forcedOverpassBySlot: Object.freeze({
        overwear: Object.freeze({
          label: 'Tankan Guard Emblem',
          pattern: TANKAN_GUARD_EMBLEM,
          roles: Object.freeze(['poncho']),
          fallbackColorC: Object.freeze({ dyeId: 'dye:CLOTH:muted_yellow_orange' }),
        }),
      }),
    }),
  }); // defaultClothing entries may also carry colorC/weaving, giving any authored NPC starting outfit the same pattern data shape as player garments.

  window.HobunjiNpcClothingPatterns = Object.freeze({
    version: 1,
    tankanGuardEmblem: TANKAN_GUARD_EMBLEM,
    npcs,
  });
})();
