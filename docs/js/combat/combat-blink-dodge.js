// Combat Blink Dodge — the weapon tool's other hold-slot defensive option.
// The first movement input produces one invulnerable hop, then uninterrupted
// movement builds into a speed boost instead of auto-repeating hops. A sudden
// >90° input reversal while the hold remains active earns another hop without
// resetting that speed buildup. Registers under the 'hold' slot family beside
// combat-counter-shield.js so either can occupy hold1 or hold2.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-blink-dodge.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const PASSIVE_DRAIN_BASE_PER_S = 2.2; // Used by passiveDrainPerS() as Blink's stamina drain at normal 1.0x movement speed.
  const PASSIVE_DRAIN_QUANTUM = 0.1; // Used by spendPassiveDrain() to survive ResourceSystem's tenth-point stamina rounding without frame-rate-dependent loss.
  const ZIP_COST = 20;
  const ZIP_DISTANCE_PX = 82;
  const ZIP_INVULN_S = 0.16;
  const ZIP_COOLDOWN_S = 0.18;
  const MOVE_SPEED_MAX_MUL = 1.7; // Used by speedMul() as the fully-built Blink movement ceiling before mastery bonuses.
  const MOVE_SPEED_BUILD_S = 1.5; // Used by onHoldUpdate() to reach the movement-speed ceiling during one uninterrupted input.
  const REVERSAL_DOT_THRESHOLD = 0; // Used by onHoldUpdate() so crossing into the opposite (>90°) input hemisphere counts as a reversal.
  const MOVE_INPUT_EPSILON = 0.001; // Used by movementInput() to reject stick noise and zero-length directions.

  const blinkRuntimeDebug = { // Updated by the hold state machine and exposed through HobunjiDodgeFeedback for mobile-readable diagnostics.
    active: false,
    movementHeld: false,
    speedBuildS: 0,
    speedBuildProgress: 0,
    speedMul: 1,
    passiveDrainPerS: PASSIVE_DRAIN_BASE_PER_S,
    passiveDrainCarry: 0,
    hopCount: 0,
    lastHopReason: null,
    lastHopAtMs: null,
    inputDot: null,
    pendingReversal: false,
  };

  // Base dodge polish. game.js already charges 18 stamina and grants a real
  // 380 ms invulnerability window; this module only adds the requested
  // somersault presentation and raises the effective cost to 30 without
  // duplicating or replacing the existing i-frame path.
  const BASE_DODGE_EXTRA_STAMINA_COST = 12; // Used on each ordinary dodge start; 18 + 12 = 30 total stamina.
  const BASE_DODGE_SOMERSAULT_DUR_S = 0.22; // Used by the prone-recovery roll playback so it ends with dodge movement.
  let baseDodgeWasActive = false; // Used by updateBaseDodgeEnhancements to detect only the rising edge of player.dodging.
  let iframeMissCount = 0; // Used by HobunjiDodgeFeedback.getDebug() to confirm iframe-hit attempts reached this shared combat seam.
  let lastIframeMissAtMs = null; // Used by HobunjiDodgeFeedback.getDebug() to timestamp the most recent visible miss popup.

  function now() { return performance.now() / 1000; }

  function showIframeMissPopup() {
    iframeMissCount += 1;
    lastIframeMissAtMs = performance.now();
    // WorldPopupText's damage kind is the exact Float+ animation used for
    // ordinary damage numbers. A non-zero placeholder amount is required by
    // showChange's API, while `text` replaces the rendered number entirely.
    window.WorldPopupText?.showChange('damage', 1, { text: 'miss' });
  }

  function installIframeMissFeedback() {
    // Enemy combat modules all receive game.js's closure-private damagePlayer
    // through Combat.init(deps). Decorate that one injected seam before Combat
    // stores it, so a hit that intersects during invulnUntil gets the same
    // damage Float+ presentation without duplicating checks in every attack.
    const originalInit = window.Combat.init;
    if (originalInit?.__hobunjiIframeMissFeedback) return;
    const enhancedInit = function iframeMissAwareCombatInit(injectedDeps) {
      const originalDamagePlayer = injectedDeps?.damagePlayer;
      if (typeof originalDamagePlayer === 'function' && !originalDamagePlayer.__hobunjiIframeMissFeedback) {
        const iframeAwareDamagePlayer = function iframeAwareDamagePlayer(...args) {
          const player = injectedDeps.player;
          if (player && performance.now() < (Number(player.invulnUntil) || 0)) {
            showIframeMissPopup();
            return;
          }
          return originalDamagePlayer.apply(this, args);
        };
        iframeAwareDamagePlayer.__hobunjiIframeMissFeedback = true;
        injectedDeps.damagePlayer = iframeAwareDamagePlayer;
      }
      return originalInit(injectedDeps);
    };
    enhancedInit.__hobunjiIframeMissFeedback = true;
    window.Combat.init = enhancedInit;
  }

  function updateBaseDodgeEnhancements() {
    const deps = window.Combat.deps;
    const player = deps?.player;
    if (!player) return;

    const dodging = !!player.dodging;
    if (dodging && !baseDodgeWasActive) {
      // Reuse the same non-blocking spend path as game.js's base dodge so the
      // larger cost can still overdraw into Exhausted instead of refusing the
      // action at low stamina.
      if (window.ResourceSystem) {
        window.ResourceSystem.spendStamina(player, BASE_DODGE_EXTRA_STAMINA_COST, 'dodge somersault');
      } else {
        player.stamina = Math.max(0, player.stamina - BASE_DODGE_EXTRA_STAMINA_COST);
      }

      // This is the exact procedural 360° recovery arc used when the player
      // exits prone, just time-compressed to the ordinary dodge duration so
      // the visual roll does not lengthen the dodge or increase its travel.
      window.ImpactRagdollPlayback?.beginRecoveryArc(BASE_DODGE_SOMERSAULT_DUR_S);
    }
    baseDodgeWasActive = dodging;
  }

  function installBaseDodgeEnhancements() {
    // Combat.update is already the per-frame combat seam game.js calls. Wrap
    // it once here instead of adding a second requestAnimationFrame loop or
    // reaching into game.js's closure-private performDodge implementation.
    const originalUpdate = window.Combat.update;
    if (originalUpdate?.__hobunjiBaseDodgeEnhancements) return;
    const enhancedUpdate = function enhancedCombatUpdate(dt) {
      originalUpdate(dt);
      updateBaseDodgeEnhancements();
    };
    enhancedUpdate.__hobunjiBaseDodgeEnhancements = true;
    window.Combat.update = enhancedUpdate;
  }

  function register() {
    let active = false; // Used by every hold callback to distinguish an equipped hold from an inactive ability.
    let movementHeld = false; // Used to grant exactly one hop when a fresh movement input begins.
    let speedBuildS = 0; // Used by speedMul() to build speed only across one uninterrupted movement input.
    let previousInputX = 0; // Used with previousInputY to detect sudden hemisphere-crossing direction changes.
    let previousInputY = 0; // Used with previousInputX to detect sudden hemisphere-crossing direction changes.
    let pendingHop = null; // Used to preserve a reversal detected during the short anti-jitter hop cooldown.
    let nextZipAt = -99; // Used by reversal hops to retain the existing progression-controlled zip cooldown.
    let passiveDrainCarry = 0; // Used by spendPassiveDrain() to retain sub-0.1 stamina costs that ResourceSystem would otherwise round away each frame.

    // Blink Dodge deals no damage of its own, so its whole upgrade tree
    // (see combat-progression.js) is movement/stamina stat bonuses rather
    // than afflictions — read once per relevant call instead of cached,
    // same as every other ability, so a level chosen mid-hold takes effect
    // on the very next hop.
    function effects() {
      const toolKey = window.Combat.deps?.currentWeaponKey?.() || 'none';
      return window.CombatProgression?.getEffects(toolKey, 'blinkDodge') || { afflictions: {}, stats: {} };
    }

    function movementInput(deps) {
      const strength = Math.max(0, Math.min(1, Number(deps.player.inputStrength) || 0)); // Used to distinguish real movement from idle/stick noise.
      const rawX = Number(deps.player.inputX) || 0; // Used below as the game-resolved world-space movement X component.
      const rawY = Number(deps.player.inputY) || 0; // Used below as the game-resolved world-space movement Y component.
      const length = Math.hypot(rawX, rawY); // Used to normalize defensive input even if another movement system supplied a non-unit vector.
      if (strength <= MOVE_INPUT_EPSILON || length <= MOVE_INPUT_EPSILON) {
        return { active: false, x: 0, y: 0, strength: 0 };
      }
      return { active: true, x: rawX / length, y: rawY / length, strength };
    }

    function speedMul() {
      if (!active || !movementHeld) {
        blinkRuntimeDebug.speedMul = 1;
        return 1;
      }
      const stats = effects().stats; // Used to preserve the existing Brisk Footwork mastery bonus on the new speed ceiling.
      const progress = Math.min(1, speedBuildS / MOVE_SPEED_BUILD_S); // Used to map uninterrupted input time onto the authored buildup duration.
      const eased = progress * progress * (3 - 2 * progress); // Used to make the boost grow smoothly rather than snapping linearly.
      const maxMul = MOVE_SPEED_MAX_MUL * (1 + (stats.walkSpeedMul || 0)); // Used as this tool's mastery-adjusted maximum movement multiplier.
      const multiplier = 1 + (maxMul - 1) * eased; // Used by Combat.getMovementSpeedMul() in game.js's normal locomotion path.
      blinkRuntimeDebug.speedBuildProgress = progress;
      blinkRuntimeDebug.speedMul = multiplier;
      return multiplier;
    }

    function passiveDrainPerS() {
      const idleDrainMul = 1 + (effects().stats.idleDrainMul || 0); // Used to preserve the existing Blink stamina-efficiency progression choice.
      const movementMul = movementHeld ? speedMul() : 1; // Used to scale passive cost with the live built movement boost while stationary hold stays at baseline.
      const drainPerS = PASSIVE_DRAIN_BASE_PER_S * idleDrainMul * movementMul; // Used by spendPassiveDrain() as the exact continuous drain rate for this frame.
      blinkRuntimeDebug.passiveDrainPerS = drainPerS;
      return drainPerS;
    }

    function spendPassiveDrain(deps, dt) {
      const safeDt = Math.max(0, Number(dt) || 0); // Used to keep a malformed frame delta from adding negative or NaN stamina debt.
      passiveDrainCarry += passiveDrainPerS() * safeDt;
      const quanta = Math.floor((passiveDrainCarry + 1e-9) / PASSIVE_DRAIN_QUANTUM); // Used to convert accumulated fractional cost into stable tenth-point ResourceSystem spends.
      if (quanta > 0) {
        const spendAmount = quanta * PASSIVE_DRAIN_QUANTUM; // Used as the authored amount passed through normal stamina perks/alchemy/affliction handling.
        passiveDrainCarry = Math.max(0, passiveDrainCarry - spendAmount);
        if (window.ResourceSystem) {
          window.ResourceSystem.spendStamina(deps.player, Math.min(deps.player.stamina, spendAmount), 'Blink Dodge (passive)');
        } else {
          deps.player.stamina = Math.max(0, deps.player.stamina - Math.min(deps.player.stamina, spendAmount));
        }
      }
      blinkRuntimeDebug.passiveDrainCarry = passiveDrainCarry;
    }

    function resetMovementInputState() {
      movementHeld = false;
      speedBuildS = 0;
      previousInputX = 0;
      previousInputY = 0;
      pendingHop = null;
      blinkRuntimeDebug.movementHeld = false;
      blinkRuntimeDebug.speedBuildS = 0;
      blinkRuntimeDebug.speedBuildProgress = 0;
      blinkRuntimeDebug.speedMul = 1;
      blinkRuntimeDebug.passiveDrainPerS = PASSIVE_DRAIN_BASE_PER_S * (1 + (effects().stats.idleDrainMul || 0));
      blinkRuntimeDebug.inputDot = null;
      blinkRuntimeDebug.pendingReversal = false;
    }

    function performHop(deps, input, reason, ignoreCooldown = false) {
      const t = now(); // Used to enforce the old mastery-controlled zip cooldown only between continuous-input reversal hops.
      if (!ignoreCooldown && t < nextZipAt) return false;

      const stats = effects().stats; // Used for the existing Blink Dodge distance/cost/iframe/cooldown progression choices.
      const zipDistancePx = ZIP_DISTANCE_PX * (1 + (stats.zipDistanceMul || 0)); // Used as the one-hop displacement magnitude.
      const desiredX = deps.player.x + input.x * zipDistancePx; // Used by the existing axis-separated occupancy test.
      const desiredY = deps.player.y + input.y * zipDistancePx; // Used by the existing axis-separated occupancy test.
      if (deps.canPlayerOccupy(desiredX, deps.player.y)) deps.player.x = desiredX;
      if (deps.canPlayerOccupy(deps.player.x, desiredY)) deps.player.y = desiredY;

      // Never refuses for lack of stamina — overspending pushes into
      // Exhausted instead (see resource-system.js's spendStamina), same as
      // this game's base dodge (game.js's performDodge).
      window.ResourceSystem?.spendStamina(deps.player, ZIP_COST * (1 + (stats.zipCostMul || 0)), 'Blink Dodge hop');
      const invulnMs = ZIP_INVULN_S * (1 + (stats.invulnMul || 0)) * 1000; // Used to extend the player's shared iframe deadline for this hop.
      deps.player.invulnUntil = Math.max(deps.player.invulnUntil || 0, performance.now() + invulnMs);
      nextZipAt = t + ZIP_COOLDOWN_S * (1 + (stats.zipCooldownMul || 0));

      blinkRuntimeDebug.hopCount += 1;
      blinkRuntimeDebug.lastHopReason = reason;
      blinkRuntimeDebug.lastHopAtMs = performance.now();
      return true;
    }

    function flushPendingHop(deps) {
      if (!pendingHop || now() < nextZipAt) return;
      const hop = pendingHop; // Used once here so clearing the queue cannot discard the stored reversal vector before the hop consumes it.
      pendingHop = null;
      blinkRuntimeDebug.pendingReversal = false;
      performHop(deps, hop, hop.reason);
    }

    function stopHold(message) {
      const wasActive = active; // Used to avoid duplicate end toasts if stamina already dropped the hold on a previous frame.
      active = false;
      resetMovementInputState();
      passiveDrainCarry = 0;
      blinkRuntimeDebug.passiveDrainCarry = 0;
      blinkRuntimeDebug.active = false;
      window.Combat.setMovementSpeedMul(null);
      if (wasActive && message) window.Combat.deps.showToast(message, false);
    }

    function onHoldStart() {
      active = true;
      resetMovementInputState();
      passiveDrainCarry = 0;
      nextZipAt = -99;
      blinkRuntimeDebug.passiveDrainCarry = 0;
      blinkRuntimeDebug.active = true;
      window.Combat.setMovementSpeedMul(speedMul);
      window.Combat.deps.showToast('Blink Dodge active: hop, build speed, reverse sharply to hop again.', true);
    }

    function onHoldUpdate(_slot, dt) {
      if (!active) return;
      const deps = window.Combat.deps; // Used for the live player, collision checks, and toast path throughout this hold tick.
      const input = movementInput(deps); // Used by the one-hop input edge, speed buildup, and reversal detector below.
      if (!input.active) {
        resetMovementInputState();
        spendPassiveDrain(deps, dt);
        if (deps.player.stamina <= 0) stopHold('Blink Dodge dropped: stamina empty.');
        return;
      }

      if (!movementHeld) {
        movementHeld = true;
        previousInputX = input.x;
        previousInputY = input.y;
        blinkRuntimeDebug.movementHeld = true;
        blinkRuntimeDebug.inputDot = null;
        // A fresh movement press always earns its one hop. Releasing movement
        // deliberately resets the speed buildup, so rapid tapping cannot keep
        // the fast locomotion state even though each press can still blink.
        performHop(deps, input, 'input-start', true);
      } else {
        flushPendingHop(deps);
        const inputDot = previousInputX * input.x + previousInputY * input.y; // Used to detect a single-frame crossing into the opposite input hemisphere.
        blinkRuntimeDebug.inputDot = inputDot;
        if (inputDot < REVERSAL_DOT_THRESHOLD) {
          if (!performHop(deps, input, 'hemisphere-reversal')) {
            pendingHop = { x: input.x, y: input.y, reason: 'hemisphere-reversal' };
            blinkRuntimeDebug.pendingReversal = true;
          }
        }
        previousInputX = input.x;
        previousInputY = input.y;
      }

      speedBuildS = Math.min(MOVE_SPEED_BUILD_S, speedBuildS + Math.max(0, Number(dt) || 0));
      blinkRuntimeDebug.speedBuildS = speedBuildS;
      speedMul(); // Keeps the mobile debug snapshot current even before game.js asks Combat for this frame's movement multiplier.
      spendPassiveDrain(deps, dt);
      if (deps.player.stamina <= 0) stopHold('Blink Dodge dropped: stamina empty.');
    }

    function onHoldEnd() {
      stopHold('Blink Dodge ended.');
    }

    window.Combat.abilities.register('blinkDodge', { label: 'Blink Dodge', slotFamily: 'hold', category: 'defensiveHold', onHoldStart, onHoldUpdate, onHoldEnd });
  }

  window.HobunjiDodgeFeedback = Object.freeze({
    getDebug() {
      const player = window.Combat?.deps?.player;
      const remainingIframeMs = player
        ? Math.max(0, (Number(player.invulnUntil) || 0) - performance.now())
        : 0;
      return {
        iframeMissCount,
        lastIframeMissAtMs,
        remainingIframeMs,
        dodging: !!player?.dodging,
        blink: {
          ...blinkRuntimeDebug,
          tuning: {
            speedBuildS: MOVE_SPEED_BUILD_S,
            maxSpeedMul: MOVE_SPEED_MAX_MUL,
            passiveDrainBasePerS: PASSIVE_DRAIN_BASE_PER_S,
            passiveDrainQuantum: PASSIVE_DRAIN_QUANTUM,
            reversalDotThreshold: REVERSAL_DOT_THRESHOLD,
            hopCooldownS: ZIP_COOLDOWN_S,
          },
        },
      };
    },
  });

  installIframeMissFeedback();
  installBaseDodgeEnhancements();
  register();
})();
