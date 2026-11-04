// Player-only combat-movement trinket hooks. Installed over Combat before game.js initializes.
(() => {
  'use strict';
  if (window.SpecializedCombatTrinketHooks) return;
  const EPSILON = 1e-5; // Used to detect a new knockback impulse without reapplying resistance every frame.
  let lastDodge = false; // Tracks the player dodge's leading edge across Combat.update calls.
  let lastKnockback = null; // Snapshot of last movement impulse, used for direct-game damage fallback.
  let protectedFromCombatDamage = false; // Prevents double-scaling when the Combat.deps damage adapter already reduced the impulse.
  let lastEvent = null; // Exposed through mobile diagnostics for movement tests.

  function modifier(key) {
    const player = window.Combat?.deps?.player; // Only the local equipment wearer's active modifiers count.
    if (!player) return 1;
    const value = Number(window.ResourceSystem?.statModifier?.(player, key));
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function onDodge(player) {
    const mul = modifier('dodgeEfficacy'); // Multiplies the existing outfit penalty rather than replacing it.
    if (!player || mul === 1) return;
    const now = performance.now(); // Common base for the remaining dodge invulnerability.
    if (Number.isFinite(player.dodgeT)) player.dodgeT = Math.max(0, player.dodgeT * mul);
    const remaining = Math.max(0, (Number(player.invulnUntil) || 0) - now);
    if (remaining > 0) player.invulnUntil = now + remaining * mul;
    lastEvent = { kind: 'dodge', multiplier: mul };
  }

  function onNewUnwrappedKnockback(player) {
    if (!player || protectedFromCombatDamage) return;
    const mul = modifier('knockbackDistance'); // Applied only to the impulse, never damage, Footing, or stagger.
    if (mul === 1) return;
    const vx = Number(player.knockbackVX), vy = Number(player.knockbackVY);
    if (Number.isFinite(vx)) player.knockbackVX = vx * mul;
    if (Number.isFinite(vy)) player.knockbackVY = vy * mul;
    lastEvent = { kind: 'knockback-fallback', multiplier: mul };
  }

  const combat = window.Combat; // Existing Combat instance is established before this script loads.
  if (!combat?.update || !combat?.init) return;
  const originalInit = combat.init.bind(combat); // Preserves all earlier Combat initialization extensions.
  combat.init = function specializedCombatTrinketInit(injected) {
    if (injected && typeof injected.damagePlayer === 'function' && !injected.damagePlayer.__specializedTrinketKnockback) {
      const originalDamage = injected.damagePlayer; // Original hit handler still owns Health, Footing and stagger.
      const wrappedDamage = function specializedCombatTrinketDamagePlayer(amount, fromX, fromY, knockbackPxS, ...rest) {
        const mul = modifier('knockbackDistance'); // Knockback only; incoming damage and Footing are unchanged.
        if (mul !== 1 && Number.isFinite(Number(knockbackPxS)) && Number(knockbackPxS) > 0) {
          protectedFromCombatDamage = true; // Skips post-update fallback for this same hit.
          lastEvent = { kind: 'knockback', multiplier: mul };
          return originalDamage.call(this, amount, fromX, fromY, knockbackPxS * mul, ...rest);
        }
        return originalDamage.call(this, amount, fromX, fromY, knockbackPxS, ...rest);
      };
      wrappedDamage.__specializedTrinketKnockback = true;
      injected.damagePlayer = wrappedDamage;
    }
    return originalInit(injected);
  };
  combat.init.__specializedCombatTrinkets = true;

  const originalUpdate = combat.update.bind(combat); // Other systems may wrap this later; all see the same player state.
  combat.update = function specializedCombatTrinketUpdate(dt) {
    const result = originalUpdate(dt);
    const player = combat.deps?.player; // Evaluated after original update to recognize the authoritative new pose/impulse.
    const dodging = !!player?.dodging;
    if (dodging && !lastDodge) onDodge(player);
    lastDodge = dodging;

    const t = Math.max(0, Number(player?.knockbackT) || 0);
    const vx = Number(player?.knockbackVX) || 0, vy = Number(player?.knockbackVY) || 0;
    const previous = lastKnockback;
    const changedImpulse = t > 0 && (previous?.t <= 0 || (!previous && t > 0) ||
      (Math.hypot(vx, vy) > Math.hypot(previous?.vx || 0, previous?.vy || 0) + EPSILON));
    if (changedImpulse) onNewUnwrappedKnockback(player); // Covers direct game.js hits not routed through Combat.deps.
    lastKnockback = player ? { t, vx: Number(player.knockbackVX) || 0, vy: Number(player.knockbackVY) || 0 } : null;
    protectedFromCombatDamage = false;
    return result;
  };
  combat.update.__specializedCombatTrinkets = true;
  window.SpecializedCombatTrinketHooks = Object.freeze({
    debugSnapshot: () => ({ lastDodge, lastKnockback, lastEvent, dodgeMultiplier: modifier('dodgeEfficacy'), knockbackMultiplier: modifier('knockbackDistance') }),
  });
  window.__specializedCombatTrinketDebug = () => window.SpecializedCombatTrinketHooks.debugSnapshot(); // Mobile diagnostics without DevTools.
})();
