(() => {
  'use strict';
  // combat-main: feature-owned classic scripts in the original parser execution order.
  // Player tap/hold timing is loaded before combat input. The array stays JSON-compatible for the classic-group validator.
  const scriptUrls = [
    "js/input-hold-timing.js?v=20261116tapHoldAudit2",
    "js/combat/weapon-shape-stats.js?v=20261109grappledonor1",
    "js/combat/combat-core.js?v=20261115h07ca528",
    "js/combat/enemy-search-ai.js?v=20261110h608e181",
    "js/combat/impact-blend-library.js?v=20260828b",
    "js/combat/impact-ragdoll-playback.js?v=20261024h5f9cf28",
    "js/combat/combat-enemy-telegraph.js?v=20261009he463e76",
    "js/combat/combat-animal-attacks.js?v=20261110attackFxInst1",
    "js/combat/combat-voorg-ass-rear-kick.js?v=20261110attackFxInst1",
    "js/combat/combat-attach.js?v=20261101h47c5427",
    "js/combat/combat-loadout.js?v=20261117toolStanceWalk1",
    "js/combat/combat-progression.js?v=20261114packbooks2",
    "js/combat/combat-attack-events.js?v=20261027shape2",
    "js/combat/companion-offense.js?v=20261104scent1439c",
    "js/companion-combat-response.js?v=20261110decf5f6ae3",
    "js/combat/enemy-pet-targeting.js?v=20261114enemyPetAggro1",
    "js/combat/animal-scent-targeting.js?v=20261104scent1439c",
    "js/combat/combat-input.js?v=20261117hypedInput2",
    "js/combat/attack-pose-templates.js?v=20261115h01bf772",
    "js/combat/combat-combo.js?v=20261117hypedCombo3",
    "js/combat/combat-quickattacks.js?v=20261117hypedQuick3",
    "js/combat/combat-mounted.js?v=20261116mountedCombat1",
    "js/combat/combat-counter-shield.js?v=20261106trinkets20",
    "js/combat/combat-blink-dodge.js?v=20261115hc8b1508",
    "js/combat/combat-charged-breaker.js?v=20261117hypedCharge4",
    "js/combat/combat-flurry.js?v=20261117hypedFlurry3",
    "js/combat/combat-loadout-ui.js?v=20261116windupCharge1",
    "js/combat/combat-enchantments.js?v=20261116decouple2",
    "js/combat/fey-illusions.js?v=20261117feySensory4",
    "js/combat/fey-hyped-attacks.js?v=20261117hypedNpc5",
    "js/combat/weapon-enchantment-vfx.js?v=20261116feyFireflies2",
    "js/combat/loadout-weapon-preview.js?v=20261029maskSlots2"
]; // Versioned modules evaluated before gameplay boot.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // Parser-time writing preserves blocking evaluation and dependencies of the former inline registrations.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
