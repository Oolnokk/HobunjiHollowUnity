// Fetches docs/config/combat/attack-values.json once at boot and pushes each
// section into the combat-*.js module that owns it, via the applyXConfig
// functions those modules expose (see combat-combo.js's applyComboConfig for
// the general in-place-mutation pattern every one of them follows). Runs
// after every combat-*.js file has already registered its synchronous
// hardcoded defaults, so those defaults are what's actually in play until
// this fetch resolves — same "synchronous fallback, async override" shape
// as docs/game.js's loadLootShopConfig().
//
// The full parsed config is also stashed on window.__attackValuesConfig so
// game.js's weaponAbility()/CREATURE_DB attack-field merge (which don't have
// their own combat-*.js-style module to push into) can read it directly, and
// so the attack-animation-editor tool's live-preview can inspect the exact
// values currently in effect.
//
// Routed through window.LocalDBOverrides.loadDatabase() (see docs/js/local-
// db-overrides.js) instead of a bare fetch so the "Database Source" toggle on
// the onboarding save-select screen can swap in a locally-saved edit of this
// file without touching the repo copy — falls back to a direct fetch if that
// module somehow isn't loaded.
(function () {
  'use strict';
  const _load = window.LocalDBOverrides
    ? window.LocalDBOverrides.loadDatabase('attackValues')
    : fetch('config/combat/attack-values.json').then(r => r.ok ? r.json() : null);
  window.__attackValuesConfigPromise = _load
    .then(cfg => {
      if (!cfg) return null;
      window.__attackValuesConfig = cfg;
      window.Combat?.applyComboConfig?.(cfg.combo);
      window.Combat?.applyQuickAttackConfig?.(cfg.quickAttacks);
      window.Combat?.applyChargedBreakerConfig?.(cfg.chargedBreaker);
      window.Combat?.applyFlurryConfig?.(cfg.flurry);
      window.Combat?.applyCounterShieldConfig?.(cfg.counterShield);
      window.Combat?.animalAttacks?.applyConfig?.(cfg.creatureAttacks);
      window.dispatchEvent(new CustomEvent('hobunji-attack-values-loaded', { detail: cfg }));
      return cfg;
    })
    .catch(() => null);
})();
