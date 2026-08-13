// Combat blink dodge — the weapon tool's other hold-slot defensive option,
// ported from the sandbox's beginDefensiveHold()/tryBlinkZip(). While held,
// any movement input is converted into short invulnerable teleport zips
// instead of normal walking; idle stamina drains slowly even without
// zipping. Registers under the 'hold' slot family alongside
// combat-counter-shield.js so either can occupy hold1 or hold2.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-blink-dodge.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const IDLE_DRAIN_PER_S = 2.2;
  const ZIP_COST = 20;
  const ZIP_DISTANCE_PX = 82;
  const ZIP_INVULN_S = 0.16;
  const ZIP_COOLDOWN_S = 0.18;
  const WALK_SPEED_MUL = 0.66; // mirrors the demo's 118/178 ratio while active

  // Base dodge polish. game.js already charges 18 stamina and grants a real
  // 380 ms invulnerability window; this module only adds the requested
  // somersault presentation and raises the effective cost to 30 without
  // duplicating or replacing the existing i-frame path.
  const BASE_DODGE_EXTRA_STAMINA_COST = 12; // Used on each ordinary dodge start; 18 + 12 = 30 total stamina.
  const BASE_DODGE_SOMERSAULT_DUR_S = 0.22; // Used by the prone-recovery roll playback so it ends with dodge movement.
  let baseDodgeWasActive = false; // Used by updateBaseDodgeEnhancements to detect only the rising edge of player.dodging.

  function now() { return performance.now() / 1000; }

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
    let active = false;
    let nextZipAt = -99;

    // Blink Dodge deals no damage of its own, so its whole upgrade tree
    // (see combat-progression.js) is movement/stamina stat bonuses rather
    // than afflictions — read once per relevant call instead of cached,
    // same as every other ability, so a level chosen mid-hold takes effect
    // on the very next zip.
    function effects() {
      const toolKey = window.Combat.deps?.currentWeaponKey?.() || 'none';
      return window.CombatProgression?.getEffects(toolKey, 'blinkDodge') || { afflictions: {}, stats: {} };
    }

    function speedMul() {
      if (!active) return 1;
      return WALK_SPEED_MUL * (1 + (effects().stats.walkSpeedMul || 0));
    }

    function tryZip(deps) {
      const t = now();
      if (t < nextZipAt) return;
      const moving = (deps.player.inputStrength || 0) > 0.001;
      if (!moving) return;

      const stats = effects().stats;
      const zipDistancePx = ZIP_DISTANCE_PX * (1 + (stats.zipDistanceMul || 0));
      const dirX = deps.player.inputX, dirY = deps.player.inputY;
      const desiredX = deps.player.x + dirX * zipDistancePx;
      const desiredY = deps.player.y + dirY * zipDistancePx;
      if (deps.canPlayerOccupy(desiredX, deps.player.y)) deps.player.x = desiredX;
      if (deps.canPlayerOccupy(deps.player.x, desiredY)) deps.player.y = desiredY;

      // Never refuses for lack of stamina — overspending pushes into
      // Exhausted instead (see resource-system.js's spendStamina), same as
      // this game's base dodge (game.js's performDodge).
      window.ResourceSystem?.spendStamina(deps.player, ZIP_COST * (1 + (stats.zipCostMul || 0)), 'Blink Dodge zip');
      const invulnMs = ZIP_INVULN_S * (1 + (stats.invulnMul || 0)) * 1000;
      deps.player.invulnUntil = Math.max(deps.player.invulnUntil || 0, performance.now() + invulnMs);
      nextZipAt = t + ZIP_COOLDOWN_S * (1 + (stats.zipCooldownMul || 0));
    }

    function onHoldStart() {
      active = true;
      nextZipAt = now();
      window.Combat.setMovementSpeedMul(speedMul);
      window.Combat.deps.showToast('Blink Dodge active: movement becomes short invulnerable zips.', true);
    }

    function onHoldUpdate(_slot, dt) {
      if (!active) return;
      const deps = window.Combat.deps;
      const idleDrainMul = 1 + (effects().stats.idleDrainMul || 0);
      window.ResourceSystem?.spendStamina(deps.player, Math.min(deps.player.stamina, IDLE_DRAIN_PER_S * idleDrainMul * dt), 'Blink Dodge (idle)');
      if (deps.player.stamina <= 0) {
        active = false;
        window.Combat.setMovementSpeedMul(null);
        deps.showToast('Blink Dodge dropped: stamina empty.', false);
        return;
      }
      tryZip(deps);
    }

    function onHoldEnd() {
      if (!active) return;
      active = false;
      window.Combat.setMovementSpeedMul(null);
      window.Combat.deps.showToast('Blink Dodge ended.', false);
    }

    window.Combat.abilities.register('blinkDodge', { label: 'Blink Dodge', slotFamily: 'hold', category: 'defensiveHold', onHoldStart, onHoldUpdate, onHoldEnd });
  }

  installBaseDodgeEnhancements();
  register();
})();
