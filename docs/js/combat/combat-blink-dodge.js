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

  function now() { return performance.now() / 1000; }

  function register() {
    let active = false;
    let nextZipAt = -99;

    function speedMul() { return active ? WALK_SPEED_MUL : 1; }

    function tryZip(deps) {
      const t = now();
      if (t < nextZipAt) return;
      const moving = (deps.player.inputStrength || 0) > 0.001;
      if (!moving) return;

      const dirX = deps.player.inputX, dirY = deps.player.inputY;
      const desiredX = deps.player.x + dirX * ZIP_DISTANCE_PX;
      const desiredY = deps.player.y + dirY * ZIP_DISTANCE_PX;
      if (deps.canPlayerOccupy(desiredX, deps.player.y)) deps.player.x = desiredX;
      if (deps.canPlayerOccupy(deps.player.x, desiredY)) deps.player.y = desiredY;

      // Never refuses for lack of stamina — overspending pushes into
      // Exhausted instead (see resource-system.js's spendStamina), same as
      // this game's base dodge (game.js's performDodge).
      window.ResourceSystem?.spendStamina(deps.player, ZIP_COST, 'Blink Dodge zip');
      deps.player.invulnUntil = Math.max(deps.player.invulnUntil || 0, performance.now() + ZIP_INVULN_S * 1000);
      nextZipAt = t + ZIP_COOLDOWN_S;
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
      window.ResourceSystem?.spendStamina(deps.player, Math.min(deps.player.stamina, IDLE_DRAIN_PER_S * dt), 'Blink Dodge (idle)');
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

    window.Combat.abilities.register('blinkDodge', { label: 'Blink Dodge', slotFamily: 'hold', onHoldStart, onHoldUpdate, onHoldEnd });
  }

  register();
})();
