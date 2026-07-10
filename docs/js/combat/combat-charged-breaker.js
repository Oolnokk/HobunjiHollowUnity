// Combat charged breaker — the weapon tool's hold-slot heavy release,
// ported from the sandbox's beginPowerHold()/endPowerHold() chargedBreaker
// branch. Holding continuously drains stamina (see CHARGE_DRAIN_PER_S) as
// well as charging up; releasing before the minimum charge wastes the
// press, releasing later scales damage/range/knockback up to a cap — and
// running out of stamina mid-charge forces an early release at whatever
// charge had been reached, so the player's stamina pool caps how strong a
// held breaker can get just as much as how long they hold the button.
// Registers under the 'hold' slot family alongside combat-flurry.js so
// either can occupy hold1 or hold2.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-charged-breaker.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const MIN_READY_S = 0.62;
  const MAX_CHARGE_S = 1.75;
  // Drained continuously every frame the button is held, on top of the
  // release cost below — running dry mid-charge forces an early release at
  // whatever charge level had been reached so far (see onHoldUpdate/
  // releaseNow), so how much stamina the player actually has to spend
  // directly caps how strong a held breaker can get, not just how long
  // they're willing to hold the button.
  const CHARGE_DRAIN_PER_S = 18;
  const COST_MIN = 16, COST_MAX = 28;
  // Barely stronger than a combo hit on its own (1.05-1.3x, roughly
  // Forehand Swing to Cleave's own base) — same "heavy attacks are tuned
  // down, the combo streak is the real payoff" rule as Cleave/Long Lunge
  // (see combat-combo.js). Scaled further by comboStreak.multiplier() at
  // release time, below.
  const DAMAGE_MUL_MIN = 1.05, DAMAGE_MUL_MAX = 1.3;
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
  // Forward leap on release — see game.js's beginCombatLunge. Matched to the
  // combo's own longest step lunge (Forehand Swing/Short Thrust's 2.0 tiles)
  // rather than a bespoke bigger number, per the same "barely stronger than
  // a combo attack" baseline as the damage multipliers above; scaled further
  // by comboStreak.multiplier() at release time, below. LUNGE_HOP_UNITS is a
  // cosmetic vertical arc peak in world-Y units (not pixels).
  const LUNGE_TILE_MUL = 2.0;
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

    // held: actual seconds the button was down for when this fires.
    // forced: true if it fired because stamina ran dry mid-charge rather
    // than the player releasing normally — the continuous hold-drain
    // already spent everything, so there's no separate release cost to
    // collect (and nothing left to collect it from).
    function releaseNow(held, forced) {
      startedAt = -1;
      const deps = window.Combat.deps;
      if (held < MIN_READY_S) {
        deps.cancelWeaponSwingHold();
        deps.showToast(forced
          ? 'Charged Breaker fizzled: stamina ran out before it was ready.'
          : `Charged Breaker released too early (${held.toFixed(2)}s, needed ${MIN_READY_S}s).`, false);
        return;
      }
      const chargeT = Math.min(1, Math.max(0, (held - MIN_READY_S) / (MAX_CHARGE_S - MIN_READY_S)));
      // Every affliction this slam can inflict, and every stat bonus on top
      // of the base numbers below, comes from the player's own chosen
      // upgrades (see combat-progression.js) — a fresh, unleveled breaker
      // deals plain damage with no afflictions at all.
      const effects = window.CombatProgression?.getEffects(deps.currentWeaponKey(), 'chargedBreaker') || { afflictions: {}, stats: {} };
      // Never refuses for lack of stamina once it's ready to release —
      // overspending pushes into Exhausted instead of fizzling the slam
      // (see resource-system.js's spendStamina). Exhausted's reduced speed
      // then slows the slam itself down, same as the source demo's
      // cooldown-slowing rule.
      if (!forced) {
        const cost = lerp(COST_MIN, COST_MAX, chargeT) * (1 + (effects.stats.staminaCostMul || 0));
        window.ResourceSystem?.spendStamina(deps.player, cost, 'Charged Breaker');
      }
      // The windup already played out while held — releasing now just lets
      // the in-progress swing continue straight into its slam.
      deps.releaseWeaponSwingHold();

      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      // Charged Breaker isn't a combo hit itself (see combat-combo-streak.js
      // — only the tap combos build/reset the streak), but its own damage
      // and lunge scale with whatever streak is currently banked, same as
      // Cleave/Long Lunge.
      const streakMul = window.Combat.comboStreak?.multiplier() ?? 1;
      const damage = Math.round(baseAbil.damage * lerp(DAMAGE_MUL_MIN, DAMAGE_MUL_MAX, chargeT) * streakMul * (1 + (effects.stats.damageMul || 0)));
      const rangePx = baseAbil.rangePx * lerp(RANGE_MUL_MIN, RANGE_MUL_MAX, chargeT) * (1 + (effects.stats.rangeMul || 0));
      const halfConeRad = HALF_CONE_DEG * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * lerp(KNOCKBACK_MUL_MIN, KNOCKBACK_MUL_MAX, chargeT) * (1 + (effects.stats.knockbackMul || 0));
      const timeScale = 1 / (window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1);
      const strikeS = STRIKE_S * timeScale;
      // Leap forward into the slam itself, timed to the strike phase —
      // stops early the instant a hostile is inside the slam's own hit
      // cone instead of always covering the full lunge distance.
      deps.beginCombatLunge(deps.TILE * LUNGE_TILE_MUL * streakMul * (1 + (effects.stats.lungeMul || 0)), strikeS, LUNGE_HOP_UNITS, { rangePx, halfConeRad });

      window.Combat.beginStagedAction({
        windupS: 0,
        strikeS,
        recoverS: 0,
        onStrike: () => {
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!deps.inCone(deps.player.x, deps.player.y, deps.player.angle, c.x, c.y, rangePx, halfConeRad)) continue;
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, { tag: 'blunt', heavy: true, afflictionBonuses: effects.afflictions });
            hits++;
            lastName = c.def.label;
          }
          deps.spawnCombatTrailEffect({ rangePx, halfConeRad, angle: deps.player.angle, ok: hits > 0 });
          const pct = Math.round(chargeT * 100);
          const msg = hits > 0
            ? `Charged Breaker (${pct}% charge): hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`
            : `Charged Breaker (${pct}% charge) connects with nothing.`;
          deps.showToast(msg, hits > 0);
          if (hits > 0) deps.awardWeaponMasteryXp();
        },
      });
    }

    function onHoldUpdate(_slot, dt) {
      if (startedAt < 0) return;
      const deps = window.Combat.deps;
      const drain = Math.min(deps.player.stamina, CHARGE_DRAIN_PER_S * dt);
      window.ResourceSystem?.spendStamina(deps.player, drain, 'Charged Breaker (charging)');
      if (deps.player.stamina <= 0) releaseNow(now() - startedAt, true);
    }

    function onHoldEnd() {
      if (startedAt < 0) return; // already force-released by onHoldUpdate when stamina ran out
      releaseNow(now() - startedAt, false);
    }

    window.Combat.abilities.register('chargedBreaker', { label: 'Charged Breaker', slotFamily: 'hold', category: 'offensiveHold', onHoldStart, onHoldUpdate, onHoldEnd });
  }

  register();
})();
