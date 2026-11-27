(() => {
  'use strict';
  // combat-main: feature-owned classic scripts in the original parser execution order.
  // Player tap/hold timing is loaded before combat input. The array stays JSON-compatible for the classic-group validator.
  const scriptUrls = [
    "js/input-hold-timing.js?v=20261116tapHoldAudit2",
    "js/combat/weapon-shape-stats.js?v=20261122hShapeFootingOnce",
    "js/combat/combat-core.js?v=20261126h4f3f709",
    "js/combat/enemy-search-ai.js?v=20261110h608e181",
    "js/combat/impact-blend-library.js?v=20260828b",
    "js/combat/impact-ragdoll-playback.js?v=20261123proneQuatNorm3",
    "js/combat/combat-enemy-telegraph.js?v=20261009he463e76",
    "js/combat/combat-animal-attacks.js?v=20261126h583b393",
    "js/combat/combat-voorg-ass-rear-kick.js?v=20261126h5232b66",
    "js/combat/combat-attach.js?v=20261126h901bb94",
    "js/combat/combat-loadout.js?v=20261126groundFit2",
    "js/combat/combat-progression.js?v=20261114packbooks2",
    "js/combat/combat-attack-events.js?v=20261027shape2",
    "js/combat/companion-offense.js?v=20261123companionAudit3",
    "js/companion-combat-response.js?v=20261123companionAudit3",
    "js/combat/enemy-pet-targeting.js?v=20261126hb5752b4",
    "js/combat/animal-scent-targeting.js?v=20261123companionAudit4",
    "js/combat/combat-input.js?v=20261123autoTargetDisabled1",
    "js/combat/attack-pose-templates.js?v=20261115h01bf772",
    "js/combat/combat-combo.js?v=20261126h0b2c6f0",
    "js/combat/combat-quickattacks.js?v=20261126planarRebase1",
    "js/combat/combat-mounted.js?v=20261126planarRebase1",
    "js/combat/combat-counter-shield.js?v=20261126planarRebase1",
    "js/combat/combat-blink-dodge.js?v=20261126planarRebase1",
    "js/combat/combat-charged-breaker.js?v=20261126h22fa9c0",
    "js/combat/combat-flurry.js?v=20261126planarRebase1",
    "js/combat/combat-loadout-ui.js?v=20261123ha2c1378",
    "js/combat/combat-enchantments.js?v=20261127ruinSkeletonAudit2",
    "js/combat/fey-illusions.js?v=20261126planarRebase1",
    "js/combat/fey-hyped-attacks.js?v=20261117hypedCreature6",
    "js/combat/weapon-enchantment-vfx.js?v=20261117flailEnchants1",
    "js/combat/loadout-weapon-preview.js?v=20261118instrumentSubtabPreview1"
]; // Versioned modules evaluated before gameplay boot.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // Parser-time writing preserves blocking evaluation and dependencies of the former inline registrations.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
