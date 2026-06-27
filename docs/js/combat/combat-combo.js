// Combat combo — the weapon tool's tap-slot 3-step combo, ported from the
// sandbox's swingCombo/pokeCombo. Both register under the 'tap' slot family
// so either can occupy tap1 or tap2; only one is bound per slot at a time
// (combat-loadout.js's DEFAULT_LOADOUT starts tap1 on 'swingCombo').
//
// Damage/range numbers are scaled off the existing 'cut' weapon ability
// (see combatConfig().weaponAbilities.cut in scratchbones-config.js) rather
// than the sandbox's raw pixel/radius prism values, since this game's tile
// scale is unrelated to the sandbox's arena scale. Hit detection reuses the
// game's existing inCone() cone test the same way the legacy cut/slash swing
// does — there's no z-height/prism collision here, per the porting scope.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-combo.js requires combat-core.js + combat-loadout.js to load first'); return; }

  // Mirrors the sandbox's 0.92s window: tap again within this long and the
  // combo advances to its next step; wait longer and it resets to step 1.
  const COMBO_RESET_S = 0.9;

  // anim/dirSign pick the cosmetic swing shape per the attack-animation-editor's
  // "Hatchet — Swing (sweep)" preset: Forehand Swing is that preset as-is,
  // Backhand Swing is the same preset flipped across the midline (dirSign:-1),
  // and Cleave reuses the Forehand pose with more power instead of a separate
  // overhead-chop animation.
  const SWING_STEPS = [
    { name: 'Forehand Swing', damageMul: 1.0, halfConeDeg: 26, rangeMul: 1.0,  knockbackMul: 1.0, staminaCost: 10, windupS: 0.16, strikeS: 0.10, anim: 'sweep', dirSign: 1 },
    { name: 'Backhand Swing', damageMul: 1.25, halfConeDeg: 30, rangeMul: 1.05, knockbackMul: 1.15, staminaCost: 12, windupS: 0.19, strikeS: 0.10, anim: 'sweep', dirSign: -1 },
    { name: 'Cleave',         damageMul: 1.8, halfConeDeg: 42, rangeMul: 1.15, knockbackMul: 1.6,  staminaCost: 18, windupS: 0.30, strikeS: 0.13, returnS: 0.35, anim: 'sweep', dirSign: 1, power: 1.3 },
  ];

  // Long Lunge's power>1 drives game.js's thrust pose to rotate the body and
  // push the weapon out farther than the first two (plain) pokes, per the
  // demo's "third one rotates even farther, pushes even farther forward" spec.
  const POKE_STEPS = [
    { name: 'Short Thrust', damageMul: 0.95, halfConeDeg: 9,  rangeMul: 1.15, knockbackMul: 0.9, staminaCost: 8,  windupS: 0.12, strikeS: 0.09, anim: 'thrust', dirSign: 1 },
    { name: 'Step Thrust',  damageMul: 1.15, halfConeDeg: 9,  rangeMul: 1.35, knockbackMul: 1.1, staminaCost: 10, windupS: 0.16, strikeS: 0.10, anim: 'thrust', dirSign: 1 },
    { name: 'Long Lunge',   damageMul: 1.7,  halfConeDeg: 10, rangeMul: 1.65, knockbackMul: 1.9, staminaCost: 16, windupS: 0.27, strikeS: 0.12, returnS: 0.35, anim: 'thrust', dirSign: 1, power: 1.35 },
  ];

  function now() { return performance.now() / 1000; }

  function registerCombo(id, label, steps) {
    let comboIndex = 0;
    let lastTapAt = -99;
    let busyAction = null;

    function onTap() {
      if (busyAction) return; // previous step's windup/strike hasn't resolved yet
      const deps = window.Combat.deps;
      const t = now();
      if (t - lastTapAt > COMBO_RESET_S) comboIndex = 0;
      lastTapAt = t;
      const step = steps[comboIndex % steps.length];
      comboIndex = (comboIndex + 1) % steps.length;

      if (deps.player.stamina < step.staminaCost) {
        deps.showToast('Too winded to swing!', false);
        return;
      }
      deps.player.stamina = Math.max(0, deps.player.stamina - step.staminaCost);
      // returnS (set on a combo's final step) stretches the cosmetic swing's
      // tail so a finisher eases back to neutral instead of snapping — earlier
      // steps have no returnS, so they keep snapping (masked by the next tap).
      const totalVisual = step.windupS + step.strikeS + (step.returnS || 0);
      deps.triggerWeaponSwingVisual(totalVisual, {
        anim: step.anim,
        dirSign: step.dirSign,
        windupFrac: step.windupS / totalVisual,
        strikeFrac: (step.windupS + step.strikeS) / totalVisual,
        power: step.power || 1,
      });

      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * step.damageMul);
      const rangePx = baseAbil.rangePx * step.rangeMul;
      const halfConeRad = step.halfConeDeg * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * step.knockbackMul;

      busyAction = window.Combat.beginStagedAction({
        windupS: step.windupS,
        strikeS: step.strikeS,
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
          const msg = hits > 0
            ? (hits > 1 ? `${step.name}: hit ${hits} creatures!` : `${step.name}: hit the ${lastName}!`)
            : `${step.name} connects with nothing.`;
          deps.showToast(msg, hits > 0);
        },
        onComplete: () => { busyAction = null; },
        onCancel: () => { busyAction = null; },
      });
    }

    window.Combat.abilities.register(id, { label, slotFamily: 'tap', onTap });
  }

  registerCombo('swingCombo', '3-Swing Combo', SWING_STEPS);
  registerCombo('pokeCombo', '3-Poke Combo', POKE_STEPS);
})();
