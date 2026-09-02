(() => {
  'use strict';

  // Player health/stamina/footing regen tick and the vitals-bar HUD refresh,
  // extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its siblings. `player` is a `const` object never
  // reassigned wholesale (only its properties mutate), so it's passed by
  // direct reference like the other stable object dependencies below.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // Looked up lazily (on first refreshVitalsHud() call, not at module-load
  // time) since this script tag loads in <head> before <body> exists —
  // game.js itself got away with a top-level document.getElementById()
  // only because it's the very last script tag, running after the whole
  // document (including these elements) is already parsed.
  let _vbHealthFill = null, _vbStaminaFill = null, _vbFootingFill = null, _vbElsResolved = false;
  // Rounded so idle frames (no regen/damage delta, sub-1% drift) don't
  // rewrite the same style.width value every frame.
  let _vbLastHealthPct = -1, _vbLastStaminaPct = -1, _vbLastFootingPct = -1;
  function refreshVitalsHud() {
    if (!_vbElsResolved) {
      _vbElsResolved = true;
      _vbHealthFill  = document.getElementById('vbHealthFill');
      _vbStaminaFill = document.getElementById('vbStaminaFill');
      _vbFootingFill = document.getElementById('vbFootingFill');
    }
    if (_vbHealthFill) {
      const pct = Math.round(Math.max(0, Math.min(100, deps.player.health / deps.player.maxHealth * 100)));
      if (pct !== _vbLastHealthPct) { _vbLastHealthPct = pct; _vbHealthFill.style.width = `${pct}%`; }
    }
    if (_vbStaminaFill) {
      const pct = Math.round(Math.max(0, Math.min(100, deps.player.stamina / deps.player.maxStamina * 100)));
      if (pct !== _vbLastStaminaPct) { _vbLastStaminaPct = pct; _vbStaminaFill.style.width = `${pct}%`; }
    }
    if (_vbFootingFill && deps.player.maxFooting) {
      const pct = Math.round(Math.max(0, Math.min(100, deps.player.footing / deps.player.maxFooting * 100)));
      if (pct !== _vbLastFootingPct) { _vbLastFootingPct = pct; _vbFootingFill.style.width = `${pct}%`; }
    }
  }

  function updatePlayerVitals(dt) {
    // Health/Stamina regen, Exhausted/black-stamina recovery, and every
    // affliction's own tick (bleed/poison/congealed/recovery/puke) —
    // see docs/js/combat/resource-system.js. Passing the existing
    // per-second constants keeps un-afflicted regen feeling the same
    // as before this system existed; quiet rest now doubles it.
    const tickResult = window.ResourceSystem?.tick(deps.player, dt, {
      staminaRegenPerSec: deps.PLAYER_STAMINA_REGEN * window.CookingSystem.getStaminaRegenMultiplier(),
      healthRegenPerSec: deps.PLAYER_HEALTH_REGEN,
    });
    if (tickResult?.puked) deps.showToast('You feel queasy...', false);
    if (deps.player.dodgeCooldownT > 0) deps.player.dodgeCooldownT = Math.max(0, deps.player.dodgeCooldownT - dt);
    refreshVitalsHud();
  }

  window.PlayerVitals = {
    init,
    updatePlayerVitals,
    refreshVitalsHud,
  };
})();
