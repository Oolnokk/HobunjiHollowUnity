// Loads authored combat values after the synchronous combat defaults exist.
(() => {
  'use strict';

  const load = window.LocalDBOverrides
    ? window.LocalDBOverrides.loadDatabase('attackValues')
    : fetch('config/combat/attack-values.json').then(response => response.ok ? response.json() : null);

  window.__attackValuesConfigPromise = load.then(config => {
    if (!config) return null;
    window.__attackValuesConfig = config;
    window.Combat?.applyComboConfig?.(config.combo);
    window.Combat?.applyQuickAttackConfig?.(config.quickAttacks);
    window.Combat?.applyChargedBreakerConfig?.(config.chargedBreaker);
    window.Combat?.applyFlurryConfig?.(config.flurry);
    window.Combat?.applyCounterShieldConfig?.(config.counterShield);
    window.Combat?.animalAttacks?.applyConfig?.(config.creatureAttacks);
    window.dispatchEvent(new CustomEvent('hobunji-attack-values-loaded', { detail: config }));
    return config;
  }).catch(() => null);
})();

// Compatibility bootstrap for runtime modules extracted from this loader and
// impact-ragdoll-playback.js. index.html already loads this file at the exact
// parser-blocking point those integrations need: after their core dependencies
// exist, but before game.js constructs the player rig and initializes late
// systems. Keep the bootstrap tiny so each behavior remains independently
// owned/testable. A future index cleanup can replace these entries with normal
// script tags without changing any module API.
(() => {
  'use strict';

  const modules = [
    ['js/player-body-transform-composer.js?v=20260810a', () => !!window.PlayerBodyTransformComposer],
    ['js/player-body-attachment-bridge.js?v=20260810a', () => !!window.PlayerBodyAttachmentBridge],
    ['js/drunk-locomotion.js?v=20260810a', () => !!window.HobunjiDrunkWalk],
    ['js/alcohol-gameplay-bridge.js?v=20260810a', () => !!window.HobunjiDrunkGameplayBridge],
  ];

  function loadModule(src, alreadyLoaded) {
    if (alreadyLoaded()) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}"></` + 'script>');
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.head.appendChild(script);
  }

  for (const [src, alreadyLoaded] of modules) loadModule(src, alreadyLoaded);
})();
