// Shared interaction exclusions for the four authored Great Fey. Quest dialogue,
// scripted turn-ins, and ordinary Talk are intentionally not covered.
(() => {
  'use strict';
  if (window.NpcInteractionPolicy) return;

  const PASSIVE_GREAT_FEY_IDS = new Set([
    'banubu', 'hiki_hiki', 'mother_rahayobi', 'nohuknuk',
    'hiki-hiki', 'hikihiki', 'old_man_nohuknuk',
  ]); // Used by gifting, ambient dialogue, social reactions, and animal recognition to skip the same speakers.

  function isPassiveGreatFey(recOrId) {
    const id = typeof recOrId === 'string' ? recOrId : recOrId?.id; // Accepts authored records or the ID supplied by a reaction/gesture event.
    return PASSIVE_GREAT_FEY_IDS.has(String(id || '').toLowerCase());
  }

  window.NpcInteractionPolicy = Object.freeze({ isPassiveGreatFey });
})();
