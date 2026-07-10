// Combat combo streak — tracks consecutive landed combo-attack hits (the
// weapon tool's tap-slot 3-step combos in combat-combo.js) and turns that
// streak into a power/lunge multiplier for the kit's heavy releases: each
// combo's 3rd/finisher step (Cleave, Long Lunge — see combat-combo.js's
// `heavy` flag) and Charged Breaker's hold release (combat-charged-
// breaker.js). Landing a combo hit grows the streak; whiffing one resets it
// to zero. Heavy attacks are deliberately tuned down to only barely
// outdamage/outlunge a bare combo hit at streak 0 — the streak earns a
// heavy attack's real payoff, rather than every heavy swing hitting hard on
// its own regardless of what led into it.
//
// #comboStreakHud (index.html) renders the current streak as big "xN" text
// in the KhymeryyanRomanLetters+Numbers display font, on the screen's side —
// see style.css's #comboStreakHud rules. It shakes (CSS .shake, replayed via
// a class remove/reflow/re-add) whenever the number grows or vanishes.
(() => {
  "use strict";
  if (!window.Combat) { console.error('combat-combo-streak.js requires combat-core.js to load first'); return; }

  const PER_HIT_BONUS = 0.15;
  const MAX_STREAK = 13; // caps the multiplier a little above x3

  let streak = 0;
  let el = null;

  function ensureEl() {
    if (!el) el = document.getElementById('comboStreakHud');
    return el;
  }

  function shake(node) {
    node.classList.remove('shake');
    void node.offsetWidth; // restart the CSS animation from a clean state
    node.classList.add('shake');
  }

  function render() {
    const node = ensureEl();
    if (!node) return;
    if (streak > 0) {
      node.textContent = 'x' + streak;
      node.classList.add('visible');
    } else {
      node.classList.remove('visible');
    }
    shake(node);
  }

  // landed: true if the combo attack that just resolved hit at least one
  // creature; false if it connected with nothing.
  function registerHit(landed) {
    if (landed) {
      if (streak >= MAX_STREAK) return; // already capped — no visible change
      streak++;
      render();
    } else if (streak > 0) {
      streak = 0;
      render();
    }
  }

  // Read by heavy attacks (combat-combo.js's heavy steps, combat-charged-
  // breaker.js) to scale their damage/lunge on top of their own tuned-down
  // base numbers.
  function multiplier() {
    return 1 + streak * PER_HIT_BONUS;
  }

  window.Combat.comboStreak = { registerHit, multiplier, get: () => streak };
})();
