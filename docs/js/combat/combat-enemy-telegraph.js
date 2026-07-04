// Combat enemy telegraph — gives hostile/companion bite attacks a genuine
// windup-then-strike state machine instead of instant on-contact damage,
// ported from the sandbox's dummy-AI attack (triggerDummyAttack: windup
// 0.54s, strike 0.20s — the sandbox's only enemy-side attack timing, reused
// here for both hostiles and companions). Sets creature.telegraphState
// ('windup'|'strike'|null) so game.js can tint the creature during it (a
// visible tell) and so the strike only lands if the target is still in
// range at the strike frame, not the frame the windup began — that's what
// makes it genuinely dodgeable. Also gives combat-quickattacks.js's
// Opportunist Jab a real enemyStriking signal to read, instead of the
// always-false placeholder it had before this module existed.
(() => {
  "use strict";
  if (!window.Combat) { console.error('combat-enemy-telegraph.js requires combat-core.js to load first'); return; }

  function start(c, { windupS, strikeS, onStrike }) {
    c._telegraph = { t: 0, windupS, strikeS, onStrike, struck: false };
    c.telegraphState = 'windup';
    window.Combat.deps?.playCreatureBark?.(c);
  }

  function update(c, dt) {
    const tg = c._telegraph;
    if (!tg) return false;
    tg.t += dt;
    if (!tg.struck && tg.t >= tg.windupS) {
      tg.struck = true;
      c.telegraphState = 'strike';
      tg.onStrike();
    }
    if (tg.t >= tg.windupS + tg.strikeS) {
      c._telegraph = null;
      c.telegraphState = null;
      return false;
    }
    return true;
  }

  function isBusy(c) { return !!c._telegraph; }

  function cancel(c) {
    c._telegraph = null;
    c.telegraphState = null;
  }

  window.Combat.telegraph = { start, update, isBusy, cancel };
})();
