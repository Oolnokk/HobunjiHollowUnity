(() => {
  'use strict';
  // combat-enemies: feature-owned classic scripts in the original parser execution order.
  const scriptUrls = [
    "js/combat/ranged-weapons.js?v=20261126spiritHealAudit1",
    "js/combat/ranged-hud-reticle.js?v=20261114musicReticleMerge1",
    "js/combat/melee-hud-reticle.js?v=20261125deepAudit1",
    "js/combat/enemy-loadout-rules.js?v=20261127ruinViewer1",
    "js/combat/npc-duel-staging.js?v=20261122h2eade76",
    "js/combat/combat-bandit.js?v=20261127ruinSkeletonAudit3",
    "js/combat/ghoul-special-variants.js?v=20261127ruinSkeletonAudit3",
    "js/combat/bandit-rank-wardrobe.js?v=20261031rankwardrobe1",
    "js/combat/combat-ghoul-wyrm-witches.js?v=20261027hcd7121b",
    "js/combat/combat-minion.js?v=20261127ruinViewer1",
    "js/combat/combat-maskbound-guardian.js?v=20261031headtakerguardian6",
    "js/combat/combat-enemy-dodge.js?v=20261127-ruin-skeletons",
    "js/combat/combat-maskbound-headtaker.js?v=20261126neckPlanarIntegration1",
    "js/combat/combat-lich.js?v=20261118pursuitRetreat1",
    "js/combat/combat-special-liches.js?v=20261118combatOrbit1"
]; // Versioned modules evaluated before gameplay boot.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // Parser-time writing preserves blocking evaluation and dependencies of the former inline registrations.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
