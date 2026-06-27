// Combat counter shield — the weapon tool's hold-slot defensive stance,
// ported from the sandbox's beginDefensiveHold()/applyHit() counterShield
// branch. While held it drains stamina every frame; any hit that would
// otherwise damage the player is absorbed instead (paying stamina for the
// block) and immediately answered with a high-damage riposte on a short
// cooldown. Registers under the 'hold' slot family alongside
// combat-blink-dodge.js so either can occupy hold1 or hold2.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-counter-shield.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const DRAIN_PER_S = 13;
  const MIN_STAMINA_TO_RAISE = 4;
  const COUNTER_COOLDOWN_S = 0.62;
  const COUNTER_DAMAGE_MUL = 4.4; // ~62 vs the demo's 14-damage baseline
  const COUNTER_RANGE_MUL = 1.7;
  const COUNTER_HALF_CONE_DEG = 8;
  const COUNTER_KNOCKBACK_MUL = 1.5;

  function now() { return performance.now() / 1000; }

  function register() {
    let active = false;
    let lastCounterAt = -99;

    function tryAbsorb(amount) {
      if (!active) return false;
      const deps = window.Combat.deps;
      const staminaCost = Math.max(MIN_STAMINA_TO_RAISE, amount * 0.35);
      deps.player.stamina = Math.max(0, deps.player.stamina - staminaCost);
      deps.showToast(`Blocked! (-${Math.round(staminaCost)} stamina)`, true);
      triggerCounter();
      return true;
    }

    function triggerCounter() {
      const t = now();
      if (t - lastCounterAt < COUNTER_COOLDOWN_S) return;
      lastCounterAt = t;
      const deps = window.Combat.deps;
      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * COUNTER_DAMAGE_MUL);
      const rangePx = baseAbil.rangePx * COUNTER_RANGE_MUL;
      const halfConeRad = COUNTER_HALF_CONE_DEG * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * COUNTER_KNOCKBACK_MUL;
      const COUNTER_WINDUP_S = 0.035, COUNTER_STRIKE_S = 0.16;
      // Riposte is a snap stab — mirror the shovel's straight thrust.
      deps.triggerWeaponSwingVisual(COUNTER_WINDUP_S + COUNTER_STRIKE_S, {
        anim: 'thrust',
        windupFrac: COUNTER_WINDUP_S / (COUNTER_WINDUP_S + COUNTER_STRIKE_S),
        strikeFrac: 1,
      });

      window.Combat.beginStagedAction({
        windupS: COUNTER_WINDUP_S,
        strikeS: COUNTER_STRIKE_S,
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
          if (hits > 0) deps.showToast(`Shield Counter Riposte: hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`, true);
        },
      });
    }

    function onHoldStart() {
      const deps = window.Combat.deps;
      if (deps.player.stamina <= MIN_STAMINA_TO_RAISE) {
        deps.showToast('Counter Shield failed: no stamina.', false);
        return;
      }
      active = true;
      window.Combat.setPlayerDamageInterceptor(tryAbsorb);
      deps.showToast('Counter Shield raised: blocks and counters on contact.', true);
    }

    function onHoldUpdate(_slot, dt) {
      if (!active) return;
      const deps = window.Combat.deps;
      deps.player.stamina = Math.max(0, deps.player.stamina - DRAIN_PER_S * dt);
      if (deps.player.stamina <= 0) {
        active = false;
        window.Combat.setPlayerDamageInterceptor(null);
        deps.showToast('Counter Shield dropped: stamina empty.', false);
      }
    }

    function onHoldEnd() {
      if (!active) return;
      active = false;
      window.Combat.setPlayerDamageInterceptor(null);
      window.Combat.deps.showToast('Counter Shield lowered.', false);
    }

    window.Combat.abilities.register('counterShield', { label: 'Counter Shield', slotFamily: 'hold', onHoldStart, onHoldUpdate, onHoldEnd });
  }

  register();
})();
