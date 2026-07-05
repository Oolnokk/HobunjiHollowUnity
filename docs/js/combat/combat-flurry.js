// Combat accelerating flurry — the weapon tool's other hold-slot heavy
// option, ported from the sandbox's beginPowerHold()/updatePowerHold()
// acceleratingFlurry branch. While held, strikes fire automatically on a
// timer that speeds up and grows stronger (and pricier) with each hit,
// until stamina runs out or the button's released. Registers under the
// 'hold' slot family alongside combat-charged-breaker.js so either can
// occupy hold1 or hold2.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-flurry.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const FIRST_STRIKE_DELAY_S = 0.38;
  const COST_BASE = 5, COST_PER_STRIKE = 1.5;
  const DAMAGE_MUL_BASE = 0.43, DAMAGE_MUL_PER_STRIKE = 0.17; // ~6/14 base, +2.4/14 per strike
  // x1.5 on top of the global knockback-base doubling — flurry is one of the
  // four attacks called out for an extra "even more" bump, and this curve is
  // also how its knockback keeps growing alongside its own attack speed.
  const KNOCKBACK_MUL_BASE = 0.255, KNOCKBACK_MUL_PER_STRIKE = 0.054;
  const HALF_CONE_DEG_BASE = 29, HALF_CONE_DEG_MAX_GROWTH = 22;
  const HALF_CONE_DEG_GROWTH_PER_STRIKE = 1.4;
  const SIDE_OFFSET_DEG = 15; // alternates left/right each strike, mirrors the demo's swing-side wobble
  const WINDUP_S = 0.035, STRIKE_S = 0.085;
  const NEXT_STRIKE_MIN_S = 0.10, NEXT_STRIKE_BASE_S = 0.42, NEXT_STRIKE_DECAY_PER_STRIKE = 0.026;
  // Flurry has no automatic forward lunge (unlike every other attack) — in
  // its place, holding it grants a movement-speed bonus that ramps up with
  // the same strike count that drives its attack-speed/knockback curves.
  const MOVE_SPEED_MUL_BASE = 1.15, MOVE_SPEED_MUL_PER_STRIKE = 0.05, MOVE_SPEED_MUL_MAX = 1.9;
  // Post-strike pause before easing back to neutral — irrelevant for all but
  // the flurry's last strike, since every earlier one gets pre-empted by the
  // next strike's trigger before its hold would ever show.
  const HOLD_S = 1;

  function now() { return performance.now() / 1000; }

  function register() {
    let active = false;
    let count = 0;
    let nextStrikeAt = -99;

    function speedMul() {
      return active ? Math.min(MOVE_SPEED_MUL_MAX, MOVE_SPEED_MUL_BASE + count * MOVE_SPEED_MUL_PER_STRIKE) : 1;
    }

    function fireStrike(deps) {
      const cost = COST_BASE + count * COST_PER_STRIKE;
      if (deps.player.stamina < cost) {
        active = false;
        deps.showToast('Flurry stopped: stamina ran out.', false);
        return;
      }
      deps.player.stamina = Math.max(0, deps.player.stamina - cost);
      // Alternates side every strike — mirror the hatchet's sweep, flipping
      // direction in sync with the existing left/right hit-cone wobble.
      const dirSign = count % 2 === 0 ? -1 : 1;
      deps.triggerWeaponSwingVisual(WINDUP_S + STRIKE_S, {
        anim: 'sweep',
        dirSign,
        windupFrac: WINDUP_S / (WINDUP_S + STRIKE_S),
        strikeFrac: 1,
        // Same authored pose as the hatchet's Forehand/Backhand Swing combo
        // steps, so every sweep-style attack reads as the same swing.
        pose: window.Combat.poses.SWEEP_POSE,
        holdS: HOLD_S,
      });

      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * (DAMAGE_MUL_BASE + count * DAMAGE_MUL_PER_STRIKE));
      const rangePx = baseAbil.rangePx;
      const halfConeDeg = HALF_CONE_DEG_BASE + Math.min(HALF_CONE_DEG_MAX_GROWTH, count * HALF_CONE_DEG_GROWTH_PER_STRIKE);
      const knockbackPxS = baseAbil.knockbackPxS * (KNOCKBACK_MUL_BASE + count * KNOCKBACK_MUL_PER_STRIKE);
      const sideDeg = dirSign * SIDE_OFFSET_DEG;
      const strikeAngle = deps.player.angle + sideDeg * Math.PI / 180;
      const strikeIndex = count + 1;

      window.Combat.beginStagedAction({
        windupS: WINDUP_S,
        strikeS: STRIKE_S,
        recoverS: 0,
        onStrike: () => {
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!deps.inCone(deps.player.x, deps.player.y, strikeAngle, c.x, c.y, rangePx, halfConeDeg * Math.PI / 180)) continue;
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS);
            hits++;
            lastName = c.def.label;
          }
          deps.spawnCombatTrailEffect({ rangePx, halfConeRad: halfConeDeg * Math.PI / 180, angle: strikeAngle, ok: hits > 0 });
          if (hits > 0) deps.showToast(`Flurry Strike ${strikeIndex}: hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`, true);
        },
      });

      count += 1;
      nextStrikeAt = now() + Math.max(NEXT_STRIKE_MIN_S, NEXT_STRIKE_BASE_S - count * NEXT_STRIKE_DECAY_PER_STRIKE);
    }

    function onHoldStart() {
      active = true;
      count = 0;
      nextStrikeAt = now() + FIRST_STRIKE_DELAY_S;
      window.Combat.setMovementSpeedMul(speedMul);
      window.Combat.deps.showToast('Accelerating Flurry started.', true);
    }

    function onHoldUpdate() {
      if (!active) return;
      if (now() < nextStrikeAt) return;
      fireStrike(window.Combat.deps);
    }

    function onHoldEnd() {
      if (!active) return;
      active = false;
      window.Combat.setMovementSpeedMul(null);
      const n = count;
      window.Combat.deps.showToast(`Accelerating Flurry ended after ${n} strike${n === 1 ? '' : 's'}.`, false);
      count = 0;
    }

    window.Combat.abilities.register('acceleratingFlurry', { label: 'Accelerating Flurry', slotFamily: 'hold', onHoldStart, onHoldUpdate, onHoldEnd });
  }

  register();
})();
