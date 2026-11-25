(() => {
  'use strict';
  // combat-main: feature-owned classic scripts in the original parser execution order.
  // Player tap/hold timing is loaded before combat input. The array stays JSON-compatible for the classic-group validator.
  const scriptUrls = [
    "js/input-hold-timing.js?v=20261116tapHoldAudit2",
    "js/combat/weapon-shape-stats.js?v=20261122hShapeFootingOnce",
    "js/combat/combat-core.js?v=20261125enemyClassAudit2",
    "js/combat/enemy-search-ai.js?v=20261110h608e181",
    "js/combat/impact-blend-library.js?v=20260828b",
    "js/combat/impact-ragdoll-playback.js?v=20261123proneQuatNorm3",
    "js/combat/combat-enemy-telegraph.js?v=20261009he463e76",
    "js/combat/combat-animal-attacks.js?v=20261123companionAudit4",
    "js/combat/combat-voorg-ass-rear-kick.js?v=20261123companionAudit4",
    "js/combat/combat-attach.js?v=20261122swarmRescue2",
    "js/combat/combat-loadout.js?v=20261118torchThrowScaled2",
    "js/combat/combat-progression.js?v=20261114packbooks2",
    "js/combat/combat-attack-events.js?v=20261027shape2",
    "js/combat/companion-offense.js?v=20261123companionAudit3",
    "js/companion-combat-response.js?v=20261123companionAudit3",
    "js/combat/enemy-pet-targeting.js?v=20261123companionAudit3",
    "js/combat/animal-scent-targeting.js?v=20261123companionAudit4",
    "js/combat/combat-input.js?v=20261123autoTargetDisabled1",
    "js/combat/attack-pose-templates.js?v=20261115h01bf772",
    "js/combat/combat-combo.js?v=20261117hypedCombo3",
    "js/combat/combat-quickattacks.js?v=20261125deepAudit1",
    "js/combat/combat-mounted.js?v=20261116mountedCombat1",
    "js/combat/combat-counter-shield.js?v=20261106trinkets20",
    "js/combat/combat-blink-dodge.js?v=20261118ghostOptIn1",
    "js/combat/combat-charged-breaker.js?v=20261117hypedCharge4",
    "js/combat/combat-flurry.js?v=20261117hypedFlurry3",
    "js/combat/combat-loadout-ui.js?v=20261123ha2c1378",
    "js/combat/combat-enchantments.js?v=20261123companionAudit3",
    "js/combat/fey-illusions.js?v=20261117feySensory4",
    "js/combat/fey-hyped-attacks.js?v=20261117hypedCreature6",
    "js/combat/weapon-enchantment-vfx.js?v=20261117flailEnchants1",
    "js/combat/loadout-weapon-preview.js?v=20261118instrumentSubtabPreview1"
]; // Versioned modules evaluated before gameplay boot.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // Parser-time writing preserves blocking evaluation and dependencies of the former inline registrations.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
