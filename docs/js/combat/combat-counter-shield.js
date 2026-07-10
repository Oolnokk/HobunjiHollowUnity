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

  const DRAIN_PER_S = 20;
  const MIN_STAMINA_TO_RAISE = 6;
  const COUNTER_COOLDOWN_S = 0.62;
  const COUNTER_DAMAGE_MUL = 4.4; // ~62 vs the demo's 14-damage baseline
  const COUNTER_RANGE_MUL = 1.7;
  const COUNTER_HALF_CONE_DEG = 8;
  // x1.5 on top of the global knockback-base doubling — the riposte is one
  // of the four attacks called out for an extra "even more" bump.
  const COUNTER_KNOCKBACK_MUL = 2.25;

  // Held guard stance — a forward-braced thrust-style hold (z pushes the
  // weapon out front, like readying a jab) but played with anim:'sweep' so
  // updateToolMesh's sprite-plane twist renders the blade crosswise instead
  // of edge-on. This deliberately recreates the look the old sweep-on-thrust
  // 90-degree rotation bug used to produce by accident — a sweep-style
  // weapon held out in a thrust pose reads as a raised cross-body block.
  const BLOCK_POSE = {
    neutral: { x: 0, y: 0,    z: 0.16, pitch: 0,  yaw: 0, bodyYaw: 0 },
    windup:  { x: 0, y: 0.05, z: 0.30, pitch: 14, yaw: 0, bodyYaw: -20 },
    strike:  { x: 0, y: 0.05, z: 0.30, pitch: 14, yaw: 0, bodyYaw: -20 },
  };
  const BLOCK_WINDUP_S = 0.12, BLOCK_STRIKE_S = 0.12;

  function now() { return performance.now() / 1000; }

  function register() {
    let active = false;
    let lastCounterAt = -99;
    // Set whenever a riposte fires, to the moment its full cosmetic swing
    // (windup+strike+post-strike hold+return-tail — mirrors game.js's
    // triggerWeaponSwingVisual math) will have finished; onHoldUpdate uses
    // it to bring the guard stance back up afterward without cutting the
    // riposte's own animation short.
    let reassertBlockAt = -1;

    function raiseBlockPose(deps) {
      deps.triggerWeaponHoldVisual(BLOCK_WINDUP_S + BLOCK_STRIKE_S, {
        anim: 'sweep',
        pose: BLOCK_POSE,
        windupFrac: BLOCK_WINDUP_S / (BLOCK_WINDUP_S + BLOCK_STRIKE_S),
        strikeFrac: 1,
      });
    }

    function tryAbsorb(amount) {
      if (!active) return false;
      const deps = window.Combat.deps;
      const effects = window.CombatProgression?.getEffects(deps.currentWeaponKey(), 'counterShield') || { afflictions: {}, stats: {} };
      const staminaCost = Math.max(MIN_STAMINA_TO_RAISE, amount * 0.5) * (1 + (effects.stats.absorbMul || 0));
      // Never refuses — like the source demo's dodge reaction, blocking a
      // big hit can overdraw straight into Exhausted (see resource-
      // system.js's spendStamina) instead of failing to absorb the hit.
      window.ResourceSystem?.spendStamina(deps.player, staminaCost, 'Counter Shield block');
      deps.showToast(`Blocked! (-${Math.round(staminaCost)} stamina)`, true);
      deps.spawnBurstEffect({ color: '#40ccff', rangePx: deps.TILE * 1.8 });
      triggerCounter(effects);
      return true;
    }

    function triggerCounter(effects) {
      const t = now();
      const cooldownS = COUNTER_COOLDOWN_S * (1 + (effects.stats.cooldownMul || 0));
      if (t - lastCounterAt < cooldownS) return;
      lastCounterAt = t;
      const deps = window.Combat.deps;
      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * COUNTER_DAMAGE_MUL * (1 + (effects.stats.damageMul || 0)));
      const rangePx = baseAbil.rangePx * COUNTER_RANGE_MUL;
      const halfConeRad = COUNTER_HALF_CONE_DEG * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * COUNTER_KNOCKBACK_MUL;
      const COUNTER_WINDUP_S = 0.035, COUNTER_STRIKE_S = 0.16, COUNTER_HOLD_S = 1;
      // Riposte is a snap stab — mirror the shovel's straight thrust. This
      // replaces the held block pose for the riposte's own cosmetic
      // duration; see reassertBlockAt below for bringing the guard back up.
      const counterDurationS = COUNTER_WINDUP_S + COUNTER_STRIKE_S;
      deps.triggerWeaponSwingVisual(counterDurationS, {
        anim: 'thrust',
        windupFrac: COUNTER_WINDUP_S / counterDurationS,
        strikeFrac: 1,
        holdS: COUNTER_HOLD_S,
        afflictionIds: Object.keys(effects.afflictions),
        coneRangePx: rangePx,
        coneHalfConeRad: halfConeRad,
        coneAngle: deps.player.angle,
      });
      // Mirrors triggerWeaponSwingVisual's own auto-return-tail formula
      // (strikeFrac===1 here, so it always reserves one) so the block pose
      // doesn't reappear until the riposte's full animation — including its
      // post-strike hold and eased return — has actually finished playing.
      const counterReturnTailS = Math.max(0.12, counterDurationS * 0.35);
      reassertBlockAt = now() + counterDurationS + counterReturnTailS + COUNTER_HOLD_S;

      window.Combat.beginStagedAction({
        windupS: COUNTER_WINDUP_S,
        strikeS: COUNTER_STRIKE_S,
        recoverS: 0,
        onStrike: () => {
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!deps.inCone(deps.player.x, deps.player.y, deps.player.angle, c.x, c.y, rangePx, halfConeRad)) continue;
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, { tag: 'sharp', afflictionBonuses: effects.afflictions });
            hits++;
            lastName = c.def.label;
          }
          if (hits > 0) {
            deps.showToast(`Shield Counter Riposte: hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`, true);
            deps.awardWeaponMasteryXp();
          }
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
      reassertBlockAt = -1;
      window.Combat.setPlayerDamageInterceptor(tryAbsorb);
      deps.showToast('Counter Shield raised: blocks and counters on contact.', true);
      raiseBlockPose(deps);
    }

    function onHoldUpdate(_slot, dt) {
      if (!active) return;
      const deps = window.Combat.deps;
      const drainMul = 1 + (window.CombatProgression?.getEffects(deps.currentWeaponKey(), 'counterShield')?.stats.drainMul || 0);
      window.ResourceSystem?.spendStamina(deps.player, Math.min(deps.player.stamina, DRAIN_PER_S * drainMul * dt), 'Counter Shield (holding)');
      if (deps.player.stamina <= 0) {
        active = false;
        window.Combat.setPlayerDamageInterceptor(null);
        deps.showToast('Counter Shield dropped: stamina empty.', false);
        return;
      }
      if (reassertBlockAt > 0 && now() >= reassertBlockAt) {
        reassertBlockAt = -1;
        raiseBlockPose(deps);
      }
    }

    function onHoldEnd() {
      if (!active) return;
      active = false;
      reassertBlockAt = -1;
      window.Combat.deps.cancelWeaponSwingHold();
      window.Combat.setPlayerDamageInterceptor(null);
      window.Combat.deps.showToast('Counter Shield lowered.', false);
    }

    window.Combat.abilities.register('counterShield', { label: 'Counter Shield', slotFamily: 'hold', category: 'defensiveHold', onHoldStart, onHoldUpdate, onHoldEnd });
  }

  register();
})();
