(() => {
  'use strict';
  // combat-enemies: feature-owned classic scripts in the original parser execution order.
  const scriptUrls = [
    "js/combat/ranged-weapons.js?v=20261113inputrouter1",
    "js/combat/ranged-hud-reticle.js?v=20261114musicReticleMerge1",
    "js/combat/melee-hud-reticle.js?v=20261114musicReticleMerge1",
    "js/combat/enemy-loadout-rules.js?v=20261101playerhead3",
    "js/combat/combat-bandit.js?v=20261114uniformRigAreaDuelMerge1",
    "js/combat/ghoul-special-variants.js?v=20261031ghoulvar1",
    "js/combat/bandit-rank-wardrobe.js?v=20261031rankwardrobe1",
    "js/combat/combat-ghoul-wyrm-witches.js?v=20261027hcd7121b",
    "js/combat/combat-minion.js?v=20261103harlyaoDemolitionist1",
    "js/combat/combat-maskbound-guardian.js?v=20261031headtakerguardian6",
    "js/combat/combat-enemy-dodge.js?v=20261017h21bbf84",
    "js/combat/combat-maskbound-headtaker.js?v=20261101h33d9d71",
    "js/combat/combat-lich.js?v=20261108harlyao2",
    "js/combat/combat-special-liches.js?v=20261104azgarlu2"
]; // Versioned modules evaluated before gameplay boot.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // Parser-time writing preserves blocking evaluation and dependencies of the former inline registrations.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
