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

  // Short forward step layered under each combo swing's windup/strike —
  // see game.js's beginCombatLunge. Expressed as a TILE multiple so it scales
  // with the game's tile size rather than a raw pixel constant. x5'd from
  // its original 0.8 — combo's hit range is the shortest of the three
  // lunge-enabled attacks (built off the base 'cut' range, same as Quick
  // Attacks), so it needs the most help closing distance. Safe to lunge
  // this far now that lunges stop early the instant a hostile enters the
  // step's own hit cone instead of always covering the full distance (see
  // game.js's beginCombatLunge/updateMovement).
  const LUNGE_TILE_MUL = 4.0;

  // "Forehand Swing" — authored in the attack-animation editor as a full
  // 6-channel pose (yaw winds the tool back/through, bodyYaw turns the
  // whole torso into the swing). All three sweep combo steps below share
  // this exact pose object: Forehand Swing plays it as-is, Backhand Swing
  // mirrors it (dirSign:-1 negates x/yaw/bodyYaw — same convention as the
  // editor's flipPose()), and Cleave reuses it unmirrored but scaled up
  // (power:1.3) and slowed down for a heavier finisher, instead of any of
  // them needing a separate bespoke animation. game.js's pose-driven swing
  // branch (updateToolMesh) applies this generically.
  const SWEEP_POSE = {
    neutral: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0,   bodyYaw: 0 },
    windup:  { x: 0, y: 0, z: 0, pitch: 0, yaw: -42, bodyYaw: -90 },
    strike:  { x: 0, y: 0, z: 0, pitch: 0, yaw: 20,  bodyYaw: 120 },
  };

  // holdS: how long (seconds) the swing dwells at its strike pose before
  // easing back to neutral — a per-step config knob, not an engine default.
  // dmgTag/heavy feed the resource-afflictions system (docs/js/combat/
  // resource-system.js): sweeping steps tag as Blunt (bruise + winded
  // stamina), thrusting steps as Sharp (bleed + wounded stamina); each
  // combo's 3rd/finisher step also consumes the target's Bruised Health
  // for bonus damage, same as the demo's Heavy Attack rule.
  const SWING_STEPS = [
    { name: 'Forehand Swing', damageMul: 1.0, halfConeDeg: 26, rangeMul: 1.0,  knockbackMul: 1.0, staminaCost: 16, windupS: 0.23,  strikeS: 0.07,  anim: 'sweep', dirSign: 1,  pose: SWEEP_POSE, holdS: 1, dmgTag: 'blunt' },
    { name: 'Backhand Swing', damageMul: 1.25, halfConeDeg: 30, rangeMul: 1.05, knockbackMul: 1.15, staminaCost: 19, windupS: 0.23,  strikeS: 0.07,  anim: 'sweep', dirSign: -1, pose: SWEEP_POSE, holdS: 1, dmgTag: 'blunt' },
    // Cleave is the combo's 3rd step — gets an extra x1.5 knockback bump
    // (2.4) on top of the global knockback-base doubling, same as charged
    // breaker/riposte/flurry; the first two steps stay at their plain mul.
    { name: 'Cleave',         damageMul: 1.8, halfConeDeg: 42, rangeMul: 1.15, knockbackMul: 2.4,  staminaCost: 28, windupS: 0.345, strikeS: 0.105, returnS: 0.30, anim: 'sweep', dirSign: 1, power: 1.3, pose: SWEEP_POSE, holdS: 1, dmgTag: 'blunt', heavy: true },
  ];

  // Long Lunge's power>1 drives game.js's thrust pose to rotate the body and
  // push the weapon out farther than the first two (plain) pokes, per the
  // demo's "third one rotates even farther, pushes even farther forward" spec.
  const POKE_STEPS = [
    { name: 'Short Thrust', damageMul: 0.95, halfConeDeg: 9,  rangeMul: 1.15, knockbackMul: 0.9, staminaCost: 13,  windupS: 0.12, strikeS: 0.09, anim: 'thrust', dirSign: 1, holdS: 1, dmgTag: 'sharp' },
    { name: 'Step Thrust',  damageMul: 1.15, halfConeDeg: 9,  rangeMul: 1.35, knockbackMul: 1.1, staminaCost: 16, windupS: 0.16, strikeS: 0.10, anim: 'thrust', dirSign: 1, holdS: 1, dmgTag: 'sharp' },
    // Long Lunge is the poke combo's 3rd step — same extra x1.5 bump as Cleave.
    { name: 'Long Lunge',   damageMul: 1.7,  halfConeDeg: 10, rangeMul: 1.65, knockbackMul: 2.85, staminaCost: 25, windupS: 0.27, strikeS: 0.12, returnS: 0.35, anim: 'thrust', dirSign: 1, power: 1.35, holdS: 1, dmgTag: 'sharp', heavy: true },
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

      // Never refuses for lack of stamina — overspending pushes into
      // Exhausted (see resource-system.js's spendStamina) instead of
      // blocking the swing. Exhausted's reduced speed (getExhaustionSpeed)
      // then slows this swing's own windup/strike/return down instead,
      // same as the source demo's "the same multiplier slows attack
      // cooldown" rule.
      window.ResourceSystem?.spendStamina(deps.player, step.staminaCost, step.name);
      const timeScale = 1 / (window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1);
      const windupS = step.windupS * timeScale;
      const strikeS = step.strikeS * timeScale;
      const returnS = (step.returnS || 0) * timeScale;

      // returnS (set on a combo's final step) stretches the cosmetic swing's
      // tail so a finisher eases back to neutral instead of snapping — earlier
      // steps have no returnS, so they keep snapping (masked by the next tap).
      const totalVisual = windupS + strikeS + returnS;
      deps.triggerWeaponSwingVisual(totalVisual, {
        anim: step.anim,
        dirSign: step.dirSign,
        windupFrac: windupS / totalVisual,
        strikeFrac: (windupS + strikeS) / totalVisual,
        power: step.power || 1,
        pose: step.pose,
        holdS: step.holdS || 0,
      });
      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * step.damageMul);
      const rangePx = baseAbil.rangePx * step.rangeMul;
      const halfConeRad = step.halfConeDeg * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * step.knockbackMul;

      // Short step forward, timed to land alongside the swing's own
      // windup+strike rather than the cosmetic hold/return tail — stops
      // early the moment a hostile is inside this step's own hit cone
      // instead of always covering the full lunge distance (see
      // game.js's beginCombatLunge/updateMovement).
      deps.beginCombatLunge(deps.TILE * LUNGE_TILE_MUL, windupS + strikeS, 0, { rangePx, halfConeRad });

      busyAction = window.Combat.beginStagedAction({
        windupS,
        strikeS,
        recoverS: 0,
        onStrike: () => {
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!deps.inCone(deps.player.x, deps.player.y, deps.player.angle, c.x, c.y, rangePx, halfConeRad)) continue;
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, { tag: step.dmgTag, heavy: step.heavy });
            hits++;
            lastName = c.def.label;
          }
          deps.spawnCombatTrailEffect({ rangePx, halfConeRad, angle: deps.player.angle, ok: hits > 0 });
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

  // Shared with other sweep-style abilities (e.g. combat-flurry.js) so every
  // sweeping attack uses this same authored pose rather than each falling
  // back to updateToolMesh's older hardcoded default sweep arc.
  window.Combat.poses = { SWEEP_POSE };
})();
