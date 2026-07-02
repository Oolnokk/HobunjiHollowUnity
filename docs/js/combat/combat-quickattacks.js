// Combat quick attacks — the weapon tool's tap-slot conditional techniques,
// ported from the sandbox's triggerQuickAttack()/getQuickConditions(). Each
// technique registers under the 'tap' slot family (same family as the 3-step
// combo in combat-combo.js) so any one of them can occupy tap1 or tap2.
//
// The sandbox evaluates its conditions against a single fixed "dummy"
// target; this game has many hostiles at once, so conditions are evaluated
// against deps.findAutoTarget() (the nearest live hostile within lock-on
// range) while the actual strike still hits every creature in the swing's
// cone, matching combat-combo.js's hit-resolution precedent.
//
// "enemyStriking" (Opportunist Jab's bonus) needs a per-creature windup/
// strike telegraph flag that doesn't exist yet — hostile attacks currently
// land instantly (see game.js's updateHostiles). It's checked here against
// c.telegraphState === 'strike' so it starts working for free once that
// flag is introduced without any rework to this file.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-quickattacks.js requires combat-core.js + combat-loadout.js to load first'); return; }

  function now() { return performance.now() / 1000; }

  // Mirrors the sandbox's getQuickConditions(), evaluated against the
  // player's current auto-target rather than a fixed dummy.
  function getConditions(deps, target) {
    if (!target) return { enemyStriking: false, exhausted: false, behind: false, lowHealth: false };
    const toPlayerX = deps.player.x - target.x;
    const toPlayerY = deps.player.y - target.y;
    const dist = Math.max(0.001, Math.hypot(toPlayerX, toPlayerY));
    const forwardX = Math.cos(target.facing || 0);
    const forwardY = Math.sin(target.facing || 0);
    const behindDot = forwardX * (toPlayerX / dist) + forwardY * (toPlayerY / dist);
    return {
      enemyStriking: target.telegraphState === 'strike',
      exhausted: target.stamina <= target.maxStamina * 0.20,
      behind: behindDot < -0.35,
      lowHealth: target.health > 0 && target.health <= target.maxHealth * 0.30,
    };
  }

  // technique(deps, target, cond) -> { name, damageMul, staminaCost, halfConeDeg, rangeMul, knockbackMul, sourceText, windupS, strikeS }
  const TECHNIQUES = {
    opportunistJab: {
      label: 'Opportunist Jab',
      build(deps, target, cond) {
        let damageMul = 0.5, knockbackMul = 0.9, sourceText = 'no condition bonus';
        if (cond.enemyStriking) { damageMul = 3.2; knockbackMul = 1.9; sourceText = 'bonus: target was in strike stage'; }
        return { name: 'Opportunist Jab', damageMul, halfConeDeg: 16, rangeMul: 0.95, knockbackMul, sourceText };
      },
    },
    exhaustCutter: {
      label: 'Exhaust Cutter',
      build(deps, target, cond) {
        let damageMul = 0.57, knockbackMul = 1.0, sourceText = 'no condition bonus';
        if (cond.exhausted) { damageMul = 3.1; knockbackMul = 2.0; sourceText = 'bonus: target stamina was empty'; }
        return { name: 'Exhaust Cutter', damageMul, halfConeDeg: 18, rangeMul: 1.0, knockbackMul, sourceText };
      },
    },
    backstabFlick: {
      label: 'Backstab Flick',
      build(deps, target, cond) {
        let damageMul = 0.57, knockbackMul = 1.0, sourceText = 'no condition bonus';
        if (cond.behind) { damageMul = 3.6; knockbackMul = 2.4; sourceText = 'bonus: player was behind target'; }
        return { name: 'Backstab Flick', damageMul, halfConeDeg: 39, rangeMul: 1.25, knockbackMul, sourceText };
      },
    },
    mercySpike: {
      label: 'Mercy Spike',
      build(deps, target, cond) {
        let damageMul = 0.43, knockbackMul = 0.85, sourceText = 'no condition bonus';
        if (cond.lowHealth) { damageMul = 3.9; knockbackMul = 1.65; sourceText = 'bonus: target was below 30% health'; }
        return { name: 'Mercy Spike', damageMul, halfConeDeg: 14, rangeMul: 1.5, knockbackMul, sourceText };
      },
    },
  };

  const WINDUP_S = 0.075;
  const STRIKE_S = 0.105;
  const COST_BASE = 7;
  const COST_BONUS = 12;
  const HOLD_S = 1; // post-strike pause before easing back to neutral
  // Farther forward step than the 3-hit combo's, layered under the jab —
  // see game.js's beginCombatLunge. Expressed as a TILE multiple.
  const LUNGE_TILE_MUL = 1.4;

  function registerQuickAttack(id, def) {
    let busyAction = null;

    function onTap() {
      if (busyAction) return; // previous strike's windup/strike hasn't resolved yet
      const deps = window.Combat.deps;
      const target = deps.findAutoTarget();
      const cond = getConditions(deps, target);
      const tech = def.build(deps, target, cond);
      const cost = tech.sourceText === 'no condition bonus' ? COST_BASE : COST_BONUS;

      if (deps.player.stamina < cost) {
        deps.showToast('Too winded to swing!', false);
        return;
      }
      deps.player.stamina = Math.max(0, deps.player.stamina - cost);
      // All quick attacks are aimed jabs — mirror the shovel's straight thrust.
      deps.triggerWeaponSwingVisual(WINDUP_S + STRIKE_S, {
        anim: 'thrust',
        windupFrac: WINDUP_S / (WINDUP_S + STRIKE_S),
        strikeFrac: 1,
        holdS: HOLD_S,
      });
      deps.beginCombatLunge(deps.TILE * LUNGE_TILE_MUL, WINDUP_S + STRIKE_S);

      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * tech.damageMul);
      const rangePx = baseAbil.rangePx * tech.rangeMul;
      const halfConeRad = tech.halfConeDeg * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * tech.knockbackMul;

      busyAction = window.Combat.beginStagedAction({
        windupS: WINDUP_S,
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
          const msg = hits > 0
            ? `${tech.name}: ${tech.sourceText} — hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`
            : `${tech.name}: ${tech.sourceText}, but connects with nothing.`;
          deps.showToast(msg, hits > 0);
        },
        onComplete: () => { busyAction = null; },
        onCancel: () => { busyAction = null; },
      });
    }

    window.Combat.abilities.register(id, { label: def.label, slotFamily: 'tap', onTap });
  }

  for (const id of Object.keys(TECHNIQUES)) registerQuickAttack(id, TECHNIQUES[id]);
})();
