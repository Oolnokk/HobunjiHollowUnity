// Combat charged breaker — the weapon tool's hold-slot heavy release,
// ported from the sandbox's beginPowerHold()/endPowerHold() chargedBreaker
// branch. Holding charges up (no effect while held beyond the visual cue);
// releasing before the minimum charge wastes the press, releasing later
// scales damage/range/knockback/stamina-cost up to a cap. Registers under
// the 'hold' slot family alongside combat-flurry.js so either can occupy
// hold1 or hold2.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-charged-breaker.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const MIN_READY_S = 0.62;
  const MAX_CHARGE_S = 1.75;
  const COST_MIN = 28, COST_MAX = 50;
  const DAMAGE_MUL_MIN = 3.3, DAMAGE_MUL_MAX = 6.6; // ~46-92 vs the demo's 14-damage baseline
  // x1.5 on top of the global knockback-base doubling — charged breaker is
  // one of the four attacks called out for an extra "even more" bump.
  const KNOCKBACK_MUL_MIN = 1.275, KNOCKBACK_MUL_MAX = 2.4;
  const RANGE_MUL_MIN = 1.4, RANGE_MUL_MAX = 1.9;
  const HALF_CONE_DEG = 55; // wide burst, doesn't scale with charge
  // Sweep-style heavy finisher — a farther-back windup than any combo step
  // and a strike with noticeably more follow-through (power above Cleave's
  // 1.3), so the breaker reads as the biggest swing in the kit rather than
  // a generic overhead chop.
  const WINDUP_S = 0.52, STRIKE_S = 0.30;
  const POWER = 1.7;
  const HOLD_S = 1; // post-strike pause before easing back to neutral
  // Big anime-style forward leap on release, far beyond the combo/quick-
  // attack steps — see game.js's beginCombatLunge. LUNGE_HOP_UNITS is a
  // cosmetic vertical arc peak in world-Y units (not pixels).
  const LUNGE_TILE_MUL = 7.2; // 3x — 75% of prior 9.6 (four times the base forward lunge)
  const LUNGE_HOP_UNITS = 0.45;

  function now() { return performance.now() / 1000; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function register() {
    let startedAt = -1;

    function onHoldStart() {
      startedAt = now();
      window.Combat.deps.showToast('Charged Breaker charging — release to strike.', true);
      // Power attack — reuses the shared sweep pose (same one combo's
      // Cleave/Backhand steps use) instead of the vertical chop, but wound
      // back farther and scaled up via power so the finisher still reads as
      // distinct from a regular swing. Plays the raise (windup) immediately
      // and holds there for as long as the button stays down —
      // releaseWeaponSwingHold() (below, on release) lets it carry on into
      // the slam, however long the hold turned out to be.
      window.Combat.deps.triggerWeaponHoldVisual(WINDUP_S + STRIKE_S, {
        anim: 'sweep',
        pose: window.Combat.poses.SWEEP_POSE,
        windupFrac: WINDUP_S / (WINDUP_S + STRIKE_S),
        strikeFrac: 1,
        power: POWER,
        holdS: HOLD_S,
      });
    }

    function onHoldEnd() {
      if (startedAt < 0) return;
      const held = now() - startedAt;
      startedAt = -1;
      const deps = window.Combat.deps;
      if (held < MIN_READY_S) {
        deps.cancelWeaponSwingHold();
        deps.showToast(`Charged Breaker released too early (${held.toFixed(2)}s, needed ${MIN_READY_S}s).`, false);
        return;
      }
      const chargeT = Math.min(1, Math.max(0, (held - MIN_READY_S) / (MAX_CHARGE_S - MIN_READY_S)));
      const cost = lerp(COST_MIN, COST_MAX, chargeT);
      if (deps.player.stamina < cost) {
        deps.cancelWeaponSwingHold();
        deps.showToast('Too winded to unleash it!', false);
        return;
      }
      deps.player.stamina = Math.max(0, deps.player.stamina - cost);
      // The windup already played out while held — releasing now just lets
      // the in-progress swing continue straight into its slam.
      deps.releaseWeaponSwingHold();
      // Leap forward into the slam itself, timed to the strike phase.
      deps.beginCombatLunge(deps.TILE * LUNGE_TILE_MUL, STRIKE_S, LUNGE_HOP_UNITS);

      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * lerp(DAMAGE_MUL_MIN, DAMAGE_MUL_MAX, chargeT));
      const rangePx = baseAbil.rangePx * lerp(RANGE_MUL_MIN, RANGE_MUL_MAX, chargeT);
      const halfConeRad = HALF_CONE_DEG * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * lerp(KNOCKBACK_MUL_MIN, KNOCKBACK_MUL_MAX, chargeT);

      window.Combat.beginStagedAction({
        windupS: 0,
        strikeS: STRIKE_S,
        recoverS: 0,
        onStrike: () => {
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!deps.inCone(deps.player.x, deps.player.y, deps.player.angle, c.x, c.y, rangePx, halfConeRad)) continue;
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS);
            hits++;
            lastName = c.def.label;
          }
          deps.spawnCombatTrailEffect({ rangePx, halfConeRad, angle: deps.player.angle, ok: hits > 0 });
          const pct = Math.round(chargeT * 100);
          const msg = hits > 0
            ? `Charged Breaker (${pct}% charge): hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`
            : `Charged Breaker (${pct}% charge) connects with nothing.`;
          deps.showToast(msg, hits > 0);
        },
      });
    }

    window.Combat.abilities.register('chargedBreaker', { label: 'Charged Breaker', slotFamily: 'hold', onHoldStart, onHoldEnd });
  }

  register();
})();
