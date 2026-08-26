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
  let COMBO_RESET_S = 0.9;

  // The combo's hit cone (scaled off the shared 'cut' ability's rangePx —
  // see baseAbil below) read as oversized in practice; shrink it here
  // rather than touching 'cut' itself, since flurry/charged breaker/
  // counter-shield all scale off that same shared base and weren't
  // reported as too big. Lunge distance is compensated the other way
  // (bigger, not smaller) so closing the gap still feels aggressive even
  // with the tighter hit cone.
  let RANGE_SCALE = 0.6;
  let LUNGE_SCALE = 1.5;

  // Populated by attack-values.json through applyComboConfig below. Keeping
  // the fallback empty means an unavailable config produces no override and
  // the shared SFX pipeline retains its neutral pitch.
  const SFX_PITCH_BY_STEP = [];

  // Short forward step layered under each combo swing's windup/strike — see
  // game.js's beginCombatLunge. Expressed as a TILE multiple (per-step
  // `lungeMul` below) so it scales with the game's tile size rather than a
  // raw pixel constant. Originally a flat 0.8 for every step; the 1st step
  // of each combo now lunges 2.0 tiles (half of an earlier 5x pass) while
  // the 2nd/3rd (already-longer-ranged, heavier-knockback) steps lunge only
  // 1.0 tile (a quarter of that same pass) so a combo doesn't keep flinging
  // the player forward step after step. Safe to lunge this far at all now
  // that lunges stop early the instant a hostile enters the step's own hit
  // cone instead of always covering the full distance (see game.js's
  // beginCombatLunge/updateMovement).

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
  // heavy feeds the resource-afflictions system (docs/js/combat/resource-
  // system.js) — each combo's 3rd/finisher step consumes the target's
  // Bruised Health for bonus damage, same as the demo's Heavy Attack rule.
  // dmgTag below is now UNUSED by onTap (kept only as reference data on
  // each step) — sharp/blunt used to be tagged per combo family (sweeping
  // Blunt, thrusting Sharp) regardless of the actual equipped weapon, which
  // silently mistagged the two real weapons where animation style and
  // material disagree (hatchet: sweep-animated but a sharp weapon;
  // pick-shovel: thrust-animated but blunt). onTap now reads
  // deps.currentWeaponDamageType() instead, matching what the weapon's own
  // loadout/mastery screen already shows for its affliction options.
  // Forehand/Backhand knockbackMul is deliberately low — a combo's own early
  // hits used to shove a target most of the way out of the next step's
  // range/cone before it could land, which is what actually made 2nd/3rd
  // combo hits feel unreliable (more than cone width or auto-aim ever was).
  // Keeping the opening hits closer to a stagger than a launch, and saving
  // the big shove for Cleave, means the combo has something left to hit by
  // the time the finisher's own knockbackMul (2.4) fires.
  const SWING_STEPS = [
    { name: 'Forehand Swing', damageMul: 1.0, halfConeDeg: 26, rangeMul: 1.0,  knockbackMul: 0.45, staminaCost: 16, windupS: 0.23,  strikeS: 0.07,  anim: 'sweep', dirSign: 1,  pose: SWEEP_POSE, holdS: 1, dmgTag: 'blunt', lungeMul: 2.0 },
    { name: 'Backhand Swing', damageMul: 1.25, halfConeDeg: 30, rangeMul: 1.05, knockbackMul: 0.55, staminaCost: 19, windupS: 0.23,  strikeS: 0.07,  anim: 'sweep', dirSign: -1, pose: SWEEP_POSE, holdS: 1, dmgTag: 'blunt', lungeMul: 1.0 },
    // Cleave is the combo's 3rd step and its `heavy` flag — see the `heavy`
    // handling in onTap below — barely outdamages Backhand Swing on its own
    // (1.35 vs 1.25); its actual payoff scales with comboStreak.multiplier(),
    // built by landing steps 1-2 first (see combat-combo-streak.js). Keeps
    // an extra x1.5 knockback bump (2.4) on top of the global knockback-base
    // doubling, same as charged breaker/riposte/flurry — knockback isn't
    // part of the streak scaling, just damage/lunge.
    { name: 'Cleave',         damageMul: 1.35, halfConeDeg: 42, rangeMul: 1.15, knockbackMul: 2.4,  staminaCost: 28, windupS: 0.345, strikeS: 0.105, returnS: 0.30, anim: 'sweep', dirSign: 1, power: 1.3, pose: SWEEP_POSE, holdS: 1, dmgTag: 'blunt', heavy: true, lungeMul: 1.0 },
  ];

  // Long Lunge's power>1 drives game.js's thrust pose to rotate the body and
  // push the weapon out farther than the first two (plain) pokes, per the
  // demo's "third one rotates even farther, pushes even farther forward" spec.
  // Same low-early-knockback rationale as SWING_STEPS above. Step/Long
  // Thrust's cone also widens a little over Short Thrust's — by the time
  // those land, the target has already reacted to (or been nudged by) the
  // opener, so the follow-ups bias toward forgiving the combo continuing
  // over staying razor-precise.
  const POKE_STEPS = [
    { name: 'Short Thrust', damageMul: 0.95, halfConeDeg: 9,  rangeMul: 1.15, knockbackMul: 0.4, staminaCost: 13,  windupS: 0.12, strikeS: 0.09, anim: 'thrust', dirSign: 1, holdS: 1, dmgTag: 'sharp', lungeMul: 2.0 },
    { name: 'Step Thrust',  damageMul: 1.15, halfConeDeg: 12, rangeMul: 1.35, knockbackMul: 0.5, staminaCost: 16, windupS: 0.16, strikeS: 0.10, anim: 'thrust', dirSign: 1, holdS: 1, dmgTag: 'sharp', lungeMul: 1.0 },
    // Long Lunge is the poke combo's 3rd step and its `heavy` flag — barely
    // outdamages Step Thrust on its own (1.25 vs 1.15); its real payoff
    // scales with comboStreak.multiplier() the same way Cleave's does (see
    // onTap below). Same extra x1.5 knockback bump as Cleave, also excluded
    // from the streak scaling.
    { name: 'Long Lunge',   damageMul: 1.25, halfConeDeg: 13, rangeMul: 1.65, knockbackMul: 2.85, staminaCost: 25, windupS: 0.27, strikeS: 0.12, returnS: 0.35, anim: 'thrust', dirSign: 1, power: 1.35, holdS: 1, dmgTag: 'sharp', heavy: true, lungeMul: 1.0 },
  ];

  function now() { return performance.now() / 1000; }

  function registerCombo(id, label, steps) {
    let comboIndex = 0;
    let lastTapAt = -99;
    let busyAction = null;

    function onTap() {
      if (busyAction) return; // previous step's windup/strike hasn't resolved yet
      const deps = window.Combat.deps;
      // Footing/impact stagger lockout (see combat-core.js's isStaggered/
      // beginStagger, set by game.js's damagePlayer) — a staggered player
      // can't start a new combo step until it clears.
      if (window.Combat.isStaggered(deps.player)) return;
      const t = now();
      if (t - lastTapAt > COMBO_RESET_S) comboIndex = 0;
      lastTapAt = t;
      // Preserve the selected zero-based step before advancing the combo so
      // strike-time consumers receive the identity/pitch of this attack,
      // rather than the next attack in the sequence.
      const comboStep = comboIndex % steps.length;
      const step = steps[comboStep];
      const configuredPitch = SFX_PITCH_BY_STEP[comboStep];
      const sfxPitch = Number.isFinite(configuredPitch) && configuredPitch > 0 ? configuredPitch : undefined;
      comboIndex = (comboIndex + 1) % steps.length;

      // Every affliction this combo can inflict, and every stat bonus on top
      // of the base numbers below, comes from the player's own chosen
      // upgrades on the equipped weapon's own mastery track (see combat-
      // progression.js) — a fresh, unleveled combo deals plain damage with
      // no afflictions at all.
      const effects = window.CombatProgression?.getEffects(deps.currentWeaponKey(), id) || { afflictions: {}, stats: {} };
      // Sharp/blunt is determined by whichever tool occupies the weapon
      // slot (see TOOL_ITEM_DEFS' own dmgType, and weaponDamageTypeForTool)
      // -- not by step.dmgTag, a per-combo-family value (swingCombo always
      // 'blunt', pokeCombo always 'sharp') that mismatches two of the four
      // real weapons (hatchet is sweep-animated but sharp; pick-shovel is
      // thrust-animated but blunt). The loadout/mastery screen already
      // shows each weapon's real afflictions this way; combat itself needs
      // to match it, for both the affliction dealt and the impact sound.
      const dmgType = deps.currentWeaponDamageType();

      // Never refuses for lack of stamina — overspending pushes into
      // Exhausted (see resource-system.js's spendStamina) instead of
      // blocking the swing. Exhausted's reduced speed (getExhaustionSpeed)
      // then slows this swing's own windup/strike/return down instead,
      // same as the source demo's "the same multiplier slows attack
      // cooldown" rule.
      window.ResourceSystem?.spendStamina(deps.player, step.staminaCost * (1 + (effects.stats.staminaCostMul || 0)), step.name);
      const timeScale = 1 / (window.ResourceSystem?.getExhaustionSpeed(deps.player) ?? 1);
      const windupS = step.windupS * timeScale;
      const strikeS = step.strikeS * timeScale;
      const returnS = (step.returnS || 0) * timeScale;

      const baseAbil = deps.weaponAbility('cut') || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      // Only the combo's heavy finisher (Cleave/Long Lunge) reads the streak
      // multiplier — steps 1-2 stay at their plain damageMul regardless of
      // streak, since they're what build the streak in the first place (see
      // combat-combo-streak.js).
      const streakMul = step.heavy ? (window.Combat.comboStreak?.multiplier() ?? 1) : 1;
      const damage = Math.round(baseAbil.damage * step.damageMul * streakMul * (1 + (effects.stats.damageMul || 0)));
      const rangePx = baseAbil.rangePx * step.rangeMul * RANGE_SCALE * (1 + (effects.stats.rangeMul || 0));
      const halfConeRad = step.halfConeDeg * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * step.knockbackMul * (1 + (effects.stats.knockbackMul || 0));

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
        afflictionIds: Object.keys(effects.afflictions),
        afflictions: effects.afflictions,
        coneRangePx: rangePx,
        coneHalfConeRad: halfConeRad,
        coneAngle: deps.player.angle,
      });

      // Short step forward, timed to land alongside the swing's own
      // windup+strike rather than the cosmetic hold/return tail — stops
      // early the moment a hostile is inside this step's own hit cone
      // instead of always covering the full lunge distance (see
      // game.js's beginCombatLunge/updateMovement).
      deps.beginCombatLunge(deps.TILE * step.lungeMul * LUNGE_SCALE * streakMul * (1 + (effects.stats.lungeMul || 0)), windupS + strikeS, 0, { rangePx, halfConeRad });

      busyAction = window.Combat.beginStagedAction({
        windupS,
        strikeS,
        recoverS: 0,
        onStrike: () => {
          const vegetationCleared = deps.clearVegetationInAttackCone?.(deps.player.x, deps.player.y, deps.player.angle, rangePx, halfConeRad) || 0; // Used for accurate hit feedback when the cone only cuts growth.
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!window.Combat.meleeHit(deps.player, c, {
              rangePx, halfConeRad,
              yaw: deps.player.angle,
              pitch: deps.getPlayerMeleeAimPitch?.() || 0,
            })) continue;
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, { tag: dmgType, heavy: step.heavy, afflictionBonuses: effects.afflictions });
            deps.playWeaponHitSfx?.(dmgType, c.x, c.y, c.areaId, sfxPitch);
            hits++;
            lastName = c.def.label;
          }
          const msg = hits > 0
            ? (hits > 1 ? `${step.name}: hit ${hits} creatures!` : `${step.name}: hit the ${lastName}!`)
            : vegetationCleared > 0
              ? `${step.name}: cut ${vegetationCleared} vegetation tile${vegetationCleared === 1 ? '' : 's'} into mulch.`
            : `${step.name} connects with nothing.`;
          // silent: every swing already has its own weaponSlash/creatureClawHit
          // sfx — the generic confirm/error chime on top of that, on every
          // single hit or miss, was redundant and noisy.
          deps.showToast(msg, hits > 0 || vegetationCleared > 0, true);
          window.Combat.comboStreak?.registerHit(hits > 0);
          if (hits > 0) deps.awardWeaponMasteryXp();
        },
        onComplete: () => { busyAction = null; },
        onCancel: () => { busyAction = null; },
        data: { comboId: id, comboStep, sfxPitch },
      });
    }

    window.Combat.abilities.register(id, { label, slotFamily: 'tap', category: 'combo', onTap });
  }

  registerCombo('swingCombo', '3-Swing Combo', SWING_STEPS);
  registerCombo('pokeCombo', '3-Poke Combo', POKE_STEPS);

  // Shared with other sweep-style abilities (e.g. combat-flurry.js) so every
  // sweeping attack uses this same authored pose rather than each falling
  // back to updateToolMesh's older hardcoded default sweep arc.
  window.Combat.poses = { SWEEP_POSE };
  // Read-only data export — lets a non-player attacker (game.js's bandit AI)
  // deal damage using these exact same step numbers without this module
  // needing to know anything about who's swinging. onTap above stays the
  // only thing that actually executes a PLAYER swing; this is just the data.
  // Keyed by the same ability ids ('swingCombo'/'pokeCombo') a loadout slot
  // stores, not the raw step-array constant names, so a lookup by loadout
  // value works directly.
  window.Combat.comboData = { swingCombo: SWING_STEPS, pokeCombo: POKE_STEPS, sfxPitchByStep: SFX_PITCH_BY_STEP, RANGE_SCALE, LUNGE_SCALE, COMBO_RESET_S };

  // Applies docs/config/combat/attack-values.json's `combo` section (called
  // by combat-config-loader.js once it's fetched, after this module has
  // already finished registering). Mutates SWING_STEPS/POKE_STEPS' CONTENTS
  // in place (not reassigning the const bindings) since onTap's `steps`
  // parameter and window.Combat.comboData both hold live references to
  // these exact arrays, not a snapshot — splicing keeps every existing
  // reference pointing at the same (now-updated) array. Each step's `pose`
  // isn't part of the JSON schema (pose/timing stays the attack-animation
  // editor's separate concern) so it's re-attached here rather than lost.
  window.Combat.applyComboConfig = function (cfg) {
    if (!cfg) return;
    if (Array.isArray(cfg.swingCombo)) SWING_STEPS.splice(0, SWING_STEPS.length, ...cfg.swingCombo.map(s => ({ ...s, pose: SWEEP_POSE })));
    if (Array.isArray(cfg.pokeCombo)) POKE_STEPS.splice(0, POKE_STEPS.length, ...cfg.pokeCombo.map(s => ({ ...s })));
    if (Array.isArray(cfg.sfxPitchByStep)) SFX_PITCH_BY_STEP.splice(0, SFX_PITCH_BY_STEP.length, ...cfg.sfxPitchByStep);
    if (cfg.RANGE_SCALE != null) RANGE_SCALE = cfg.RANGE_SCALE;
    if (cfg.LUNGE_SCALE != null) LUNGE_SCALE = cfg.LUNGE_SCALE;
    if (cfg.COMBO_RESET_S != null) COMBO_RESET_S = cfg.COMBO_RESET_S;
    window.Combat.comboData.RANGE_SCALE = RANGE_SCALE;
    window.Combat.comboData.LUNGE_SCALE = LUNGE_SCALE;
    window.Combat.comboData.COMBO_RESET_S = COMBO_RESET_S;
  };
})();
