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

  let MIN_READY_S = 0.62;
  let MAX_CHARGE_S = 1.75;
  // Drained continuously every frame the button is held, on top of the
  // release cost below — running dry mid-charge forces an early release at
  // whatever charge level had been reached so far (see onHoldUpdate/
  // releaseNow), so how much stamina the player actually has to spend
  // directly caps how strong a held breaker can get, not just how long
  // they're willing to hold the button.
  let CHARGE_DRAIN_PER_S = 18;
  let COST_MIN = 16, COST_MAX = 28;
  // Barely stronger than a combo hit on its own (1.05-1.3x, roughly
  // Forehand Swing to Cleave's own base) — same "heavy attacks are tuned
  // down, the combo streak is the real payoff" rule as Cleave/Long Lunge
  // (see combat-combo.js). Scaled further by comboStreak.multiplier() at
  // release time, below.
  let DAMAGE_MUL_MIN = 1.05, DAMAGE_MUL_MAX = 1.3;
  // x1.5 on top of the global knockback-base doubling — charged breaker is
  // one of the four attacks called out for an extra "even more" bump.
  let KNOCKBACK_MUL_MIN = 1.275, KNOCKBACK_MUL_MAX = 2.4;
  let RANGE_MUL_MIN = 1.4, RANGE_MUL_MAX = 1.9;
  let HALF_CONE_DEG = 55; // wide burst, doesn't scale with charge
  // Sweep-style heavy finisher — a farther-back windup than any combo step
  // and a strike with noticeably more follow-through (power above Cleave's
  // 1.3), so the breaker reads as the biggest swing in the kit rather than
  // a generic overhead chop.
  let WINDUP_S = 0.52, STRIKE_S = 0.30;
  let POWER = 1.7;
  let HOLD_S = 1; // post-strike pause before easing back to neutral
  // Forward leap on release — see game.js's beginCombatLunge. Matched to the
  // combo's own longest step lunge (Forehand Swing/Short Thrust's 2.0 tiles)
  // rather than a bespoke bigger number, per the same "barely stronger than
  // a combo attack" baseline as the damage multipliers above; scaled further
  // by comboStreak.multiplier() at release time, below. LUNGE_HOP_UNITS is a
  // cosmetic vertical arc peak in world-Y units (not pixels).
  let LUNGE_TILE_MUL = 2.0;
  let LUNGE_HOP_UNITS = 0.45;

  function now() { return performance.now() / 1000; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Player Charged Breaker uses the same three-layer additive flame recipe
  // as combat-enemy-telegraph.js's enemy heavy tell. Keeping the specs and
  // ResourceRings color lookup identical makes player/enemy heavies read as
  // the same combat language while this module's own authoritative hold /
  // fizzle / release lifecycle decides exactly when the player's version is
  // visible.
  const PLAYER_HEAVY_FIRE_LAYER_SPECS = [
    { count: 12, size: 0.12, opacity: 0.58, rise: 0.78, radius: 0.10, speed: 1.55 },
    { count: 9, size: 0.19, opacity: 0.27, rise: 0.92, radius: 0.15, speed: 1.18 },
    { count: 6, size: 0.065, opacity: 0.82, rise: 1.04, radius: 0.18, speed: 1.95 },
  ]; // Used to construct the player's layered weapon-fire particles.
  const PLAYER_HEAVY_FIRE_NEUTRAL_COLOR = 0xffc85a; // Used when an unleveled heavy has no affliction color yet.
  const PLAYER_HEAVY_FIRE_MAX_COLORS = 4; // Caps color layers to the same ceiling as enemy heavy telegraphs.
  let playerHeavyFireGroup = null; // Reused Three.js group attached to the player's live weapon holder.
  let playerHeavyFireHolder = null; // Tracks holder replacement/reparenting after equipment/avatar rebuilds.
  let playerHeavyFireActive = false; // Controls whether the per-frame particle animation should be visible.
  let playerHeavyAfflictionIds = []; // Exposed in the mobile-friendly snapshot and used to detect color-set changes.
  let playerHeavyParticleTexture = null; // Lazily created shared soft-alpha map for all player heavy particles.

  function makePlayerHeavyParticleTexture() {
    const canvas = document.createElement('canvas'); // Supplies the same soft radial alpha falloff used by enemy heavy flames.
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d'); // Draws the texture once; particle motion happens in Three.js afterward.
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16); // Creates a hot center fading cleanly to transparent.
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,.9)');
    gradient.addColorStop(0.68, 'rgba(255,255,255,.32)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    const texture = new THREE.CanvasTexture(canvas); // Shared by every PointsMaterial in the player's heavy fire group.
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  function playerHeavyTrailColor(id) {
    const raw = window.ResourceRings?.AFFLICTION_COLORS?.[id]; // Reads the exact palette already used by weapon trails/resource rings.
    if (raw == null) return PLAYER_HEAVY_FIRE_NEUTRAL_COLOR;
    const neonize = window.ResourceRings?.neonizeColor; // Applies the same vivid-not-white transform as weapon trails.
    return typeof neonize === 'function' ? neonize(raw) : raw;
  }

  function playerHeavyAfflictionsForBonuses(bonuses) {
    const entries = Object.entries(bonuses || {}).filter(([, mul]) => Number(mul) > 0); // Keeps only afflictions this pending hit can actually apply.
    entries.sort((a, b) => Number(b[1]) - Number(a[1]));
    return entries.slice(0, PLAYER_HEAVY_FIRE_MAX_COLORS).map(([id]) => id);
  }

  function makePlayerHeavyFireLayer(color, spec, colorIndex, layerIndex) {
    const positions = new Float32Array(spec.count * 3); // Mutated in place every frame for this flame/spark layer.
    const geometry = new THREE.BufferGeometry(); // Owns the dynamic position buffer for this one layer.
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    if (!playerHeavyParticleTexture) playerHeavyParticleTexture = makePlayerHeavyParticleTexture();
    const material = new THREE.PointsMaterial({ // Matches the enemy heavy tell's additive unlit particle treatment.
      color,
      size: spec.size,
      map: playerHeavyParticleTexture,
      transparent: true,
      opacity: spec.opacity,
      alphaTest: 0.015,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material); // Lives under toolHolder so every lick follows the player's real weapon swing.
    points.frustumCulled = false;
    points.renderOrder = 4;
    const seeds = Array.from({ length: spec.count }, (_, pointIndex) => { // Stable deterministic phases prevent visible per-frame random teleporting.
      const n = (pointIndex + 1) * 12.9898 + (colorIndex + 1) * 78.233 + (layerIndex + 1) * 37.719; // Separates every particle/color/layer path.
      const fract = value => value - Math.floor(value); // Converts the deterministic sine samples into repeatable 0..1 seeds.
      return {
        phase: fract(Math.sin(n) * 43758.5453),
        angle: fract(Math.sin(n * 1.71) * 15731.743) * Math.PI * 2,
        radius: (0.25 + fract(Math.sin(n * 2.13) * 24634.634) * 0.75) * spec.radius,
        wobble: 1.4 + fract(Math.sin(n * 3.07) * 56445.234) * 2.2,
        speed: spec.speed * (0.82 + fract(Math.sin(n * 4.11) * 12415.873) * 0.36),
      };
    });
    points.userData.playerHeavyFire = { spec, seeds, positions, layerIndex, colorIndex };
    return points;
  }

  function disposePlayerHeavyFireGroup() {
    if (!playerHeavyFireGroup) return;
    for (const points of playerHeavyFireGroup.children) { // Releases per-layer geometry/material while retaining the one shared texture.
      points.geometry?.dispose?.();
      points.material?.dispose?.();
    }
    playerHeavyFireGroup.parent?.remove(playerHeavyFireGroup);
    playerHeavyFireGroup = null;
    playerHeavyFireHolder = null;
  }

  function ensurePlayerHeavyFireGroup(afflictionBonuses) {
    const ids = playerHeavyAfflictionsForBonuses(afflictionBonuses); // Determines the exact trail-matched colors for this Charged Breaker.
    const signature = (ids.length ? ids : [null]).join('|'); // Used to reuse the particle group when the pending affliction set is unchanged.
    const currentSignature = playerHeavyFireGroup?.userData.afflictionSignature || null; // Avoids rebuilding geometry every time the attack is held.
    if (!playerHeavyFireGroup || currentSignature !== signature) {
      disposePlayerHeavyFireGroup();
      const group = new THREE.Group(); // Collects every color/layer under one weapon-relative transform.
      group.name = 'player-heavy-attack-fire-telegraph';
      const colorIds = ids.length ? ids : [null]; // Gives a plain heavy a neutral gold fire tell even without upgrade afflictions.
      colorIds.forEach((id, colorIndex) => {
        const color = id ? playerHeavyTrailColor(id) : PLAYER_HEAVY_FIRE_NEUTRAL_COLOR; // Matches the existing weapon-trail palette.
        PLAYER_HEAVY_FIRE_LAYER_SPECS.forEach((spec, layerIndex) => group.add(makePlayerHeavyFireLayer(color, spec, colorIndex, layerIndex)));
      });
      group.userData.afflictionSignature = signature;
      group.visible = false;
      playerHeavyFireGroup = group;
    }
    playerHeavyAfflictionIds = ids.slice();
    const holder = window.Combat.deps?.toolHolder?.() || null; // Uses the same moving holder as the player's visible weapon mesh.
    if (holder && playerHeavyFireHolder !== holder) {
      playerHeavyFireGroup.parent?.remove(playerHeavyFireGroup);
      holder.add(playerHeavyFireGroup);
      playerHeavyFireHolder = holder;
    }
    return !!holder;
  }

  function startPlayerHeavyFire(afflictionBonuses) {
    playerHeavyFireActive = true;
    ensurePlayerHeavyFireGroup(afflictionBonuses);
    if (playerHeavyFireGroup) playerHeavyFireGroup.visible = true;
  }

  function stopPlayerHeavyFire() {
    playerHeavyFireActive = false;
    if (playerHeavyFireGroup) playerHeavyFireGroup.visible = false;
  }

  function updatePlayerHeavyFire() {
    if (!playerHeavyFireActive || !playerHeavyFireGroup) return;
    const holder = window.Combat.deps?.toolHolder?.() || null; // Reparents after any runtime weapon/avatar holder rebuild during the tell.
    if (!holder) { playerHeavyFireGroup.visible = false; return; }
    if (playerHeavyFireHolder !== holder) {
      playerHeavyFireGroup.parent?.remove(playerHeavyFireGroup);
      holder.add(playerHeavyFireGroup);
      playerHeavyFireHolder = holder;
    }
    playerHeavyFireGroup.visible = true;
    const timeS = now(); // Drives only cosmetic rise/wobble/pulse animation; gameplay timing remains in Charged Breaker below.
    for (const points of playerHeavyFireGroup.children) {
      const data = points.userData.playerHeavyFire; // Supplies this layer's stable seeds and dynamic position buffer.
      if (!data) continue;
      const colorOffset = data.colorIndex * 0.07; // Interleaves multiple affliction colors instead of stacking identical paths.
      for (let i = 0; i < data.seeds.length; i++) {
        const seed = data.seeds[i]; // Drives one particle's repeatable licking/rising path.
        const life = (timeS * seed.speed + seed.phase + colorOffset) % 1; // Loops its upward travel independently of neighboring particles.
        const envelope = 1 - life * 0.62; // Narrows the plume toward its upper tip.
        const angle = seed.angle + Math.sin(timeS * seed.wobble + seed.phase * 6.28) * 0.52; // Adds side-to-side flame lick without random jitter.
        const base = i * 3; // Indexes this particle's xyz triplet in the shared Float32Array.
        data.positions[base] = Math.cos(angle) * seed.radius * envelope + Math.sin(timeS * 4.1 + i) * 0.018;
        data.positions[base + 1] = -0.30 + life * data.spec.rise + Math.sin(timeS * 5.7 + seed.phase * 8) * 0.025;
        data.positions[base + 2] = Math.sin(angle) * seed.radius * envelope + Math.cos(timeS * 3.6 + i * 0.7) * 0.018;
      }
      points.geometry.attributes.position.needsUpdate = true;
      points.material.opacity = data.spec.opacity * (0.84 + Math.sin(timeS * 8 + data.layerIndex * 1.7) * 0.12);
    }
  }

  function register() {
    let startedAt = -1;

    function onHoldStart() {
      startedAt = now();
      window.Combat.deps.showToast('Charged Breaker charging — release to strike.', true);
      // Which afflictions the eventual slam can inflict doesn't depend on
      // how long it's charged for — safe to read here at raise time rather
      // than waiting for release.
      const effects = window.CombatProgression?.getEffects(window.Combat.deps.currentWeaponKey(), 'chargedBreaker') || { afflictions: {}, stats: {} };
      startPlayerHeavyFire(effects.afflictions);
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
        afflictionIds: Object.keys(effects.afflictions),
        afflictions: effects.afflictions,
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
      // Footing/impact stagger lockout — see combat-combo.js's matching
      // guard. A stagger landing mid-charge still cancels the hold (see
      // combat-core.js's cancelAllStaged, called from damagePlayer), so this
      // only matters for the rare case of releasing in the same instant a
      // new stagger begins.
      if (window.Combat.isStaggered(deps.player)) { stopPlayerHeavyFire(); deps.cancelWeaponSwingHold(); return; }
      if (held < MIN_READY_S) {
        stopPlayerHeavyFire();
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
      startPlayerHeavyFire(effects.afflictions);
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
      // The windup's own trigger call (onHoldStart, above) fired before the
      // charge-scaled range was known — set the swing's cone trail now that
      // it is, so the slam's own trail actually matches its real reach.
      deps.setCombatSwingCone(rangePx, halfConeRad, deps.player.angle);
      // Leap forward into the slam itself, timed to the strike phase —
      // stops early the instant a hostile is inside the slam's own hit
      // cone instead of always covering the full lunge distance.
      deps.beginCombatLunge(deps.TILE * LUNGE_TILE_MUL * streakMul * (1 + (effects.stats.lungeMul || 0)), strikeS, LUNGE_HOP_UNITS, { rangePx, halfConeRad });

      window.Combat.beginStagedAction({
        windupS: 0,
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
            // Sharp/blunt comes from whichever tool occupies the weapon
            // slot (see combat-combo.js's matching comment) -- this used to
            // hardcode 'blunt' regardless of the equipped weapon.
            deps.damageCreature(c, damage, deps.player.x, deps.player.y, knockbackPxS, { tag: deps.currentWeaponDamageType(), heavy: true, afflictionBonuses: effects.afflictions });
            deps.playWeaponHitSfx?.(deps.currentWeaponDamageType(), c.x, c.y, c.areaId, undefined, 'huge');
            hits++;
            lastName = c.def.label;
          }
          const pct = Math.round(chargeT * 100);
          const msg = hits > 0
            ? `Charged Breaker (${pct}% charge): hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`
            : vegetationCleared > 0
              ? `Charged Breaker (${pct}% charge): cut ${vegetationCleared} vegetation tile${vegetationCleared === 1 ? '' : 's'} into mulch.`
            : `Charged Breaker (${pct}% charge) connects with nothing.`;
          // silent: same reasoning as combat-combo.js — every swing already
          // has its own weapon swing/impact sfx.
          deps.showToast(msg, hits > 0 || vegetationCleared > 0, true);
          if (hits > 0) deps.awardWeaponMasteryXp();
        },
        onComplete: stopPlayerHeavyFire,
        onCancel: stopPlayerHeavyFire,
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

  // Ticks after combat-input's own wrapper, so a newly-entered hold or a
  // forced stamina release updates the player's telegraph on that same frame.
  const previousCombatUpdate = window.Combat.update; // Preserves the existing core/input/enemy-telegraph update chain.
  window.Combat.update = function chargedBreakerPlayerTelegraphUpdate(dt) {
    previousCombatUpdate(dt);
    updatePlayerHeavyFire();
  };

  // Mobile-friendly debug seam; unlike the scene objects themselves this is
  // read-only and safe to copy from an in-game debug report.
  window.Combat.chargedBreakerPlayerTelegraph = {
    snapshot: () => ({
      active: playerHeavyFireActive,
      afflictionIds: playerHeavyAfflictionIds.slice(),
      holderReady: !!playerHeavyFireHolder,
      groupVisible: !!playerHeavyFireGroup?.visible,
    }),
  };

  // Read-only data export for game.js's bandit AI — see combat-combo.js's
  // matching comment. A bandit's own charged breaker fires at a fixed
  // charge fraction (game.js picks one) rather than modeling a real
  // press-and-hold, so only the multiplier curves/cone/timing are needed
  // here, not the charge-loop mechanics themselves.
  window.Combat.chargedBreakerData = {
    DAMAGE_MUL_MIN, DAMAGE_MUL_MAX, KNOCKBACK_MUL_MIN, KNOCKBACK_MUL_MAX,
    RANGE_MUL_MIN, RANGE_MUL_MAX, HALF_CONE_DEG, WINDUP_S, STRIKE_S,
    LUNGE_TILE_MUL, LUNGE_HOP_UNITS, POWER,
  };

  // Applies docs/config/combat/attack-values.json's `chargedBreaker` section
  // — see combat-combo.js's applyComboConfig for the general pattern.
  window.Combat.applyChargedBreakerConfig = function (cfg) {
    if (!cfg) return;
    if (cfg.MIN_READY_S != null) MIN_READY_S = cfg.MIN_READY_S;
    if (cfg.MAX_CHARGE_S != null) MAX_CHARGE_S = cfg.MAX_CHARGE_S;
    if (cfg.CHARGE_DRAIN_PER_S != null) CHARGE_DRAIN_PER_S = cfg.CHARGE_DRAIN_PER_S;
    if (cfg.COST_MIN != null) COST_MIN = cfg.COST_MIN;
    if (cfg.COST_MAX != null) COST_MAX = cfg.COST_MAX;
    if (cfg.DAMAGE_MUL_MIN != null) DAMAGE_MUL_MIN = cfg.DAMAGE_MUL_MIN;
    if (cfg.DAMAGE_MUL_MAX != null) DAMAGE_MUL_MAX = cfg.DAMAGE_MUL_MAX;
    if (cfg.KNOCKBACK_MUL_MIN != null) KNOCKBACK_MUL_MIN = cfg.KNOCKBACK_MUL_MIN;
    if (cfg.KNOCKBACK_MUL_MAX != null) KNOCKBACK_MUL_MAX = cfg.KNOCKBACK_MUL_MAX;
    if (cfg.RANGE_MUL_MIN != null) RANGE_MUL_MIN = cfg.RANGE_MUL_MIN;
    if (cfg.RANGE_MUL_MAX != null) RANGE_MUL_MAX = cfg.RANGE_MUL_MAX;
    if (cfg.HALF_CONE_DEG != null) HALF_CONE_DEG = cfg.HALF_CONE_DEG;
    if (cfg.WINDUP_S != null) WINDUP_S = cfg.WINDUP_S;
    if (cfg.STRIKE_S != null) STRIKE_S = cfg.STRIKE_S;
    if (cfg.POWER != null) POWER = cfg.POWER;
    if (cfg.HOLD_S != null) HOLD_S = cfg.HOLD_S;
    if (cfg.LUNGE_TILE_MUL != null) LUNGE_TILE_MUL = cfg.LUNGE_TILE_MUL;
    if (cfg.LUNGE_HOP_UNITS != null) LUNGE_HOP_UNITS = cfg.LUNGE_HOP_UNITS;
    Object.assign(window.Combat.chargedBreakerData, {
      DAMAGE_MUL_MIN, DAMAGE_MUL_MAX, KNOCKBACK_MUL_MIN, KNOCKBACK_MUL_MAX,
      RANGE_MUL_MIN, RANGE_MUL_MAX, HALF_CONE_DEG, WINDUP_S, STRIKE_S,
      LUNGE_TILE_MUL, LUNGE_HOP_UNITS, POWER,
    });
  };
})();
