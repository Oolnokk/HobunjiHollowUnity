(() => {
  'use strict';

  if (Number(window.ClothingWeightDodgePolicy?.version) >= 1) return;

  const VERSION = 1;
  let installed = false; // Used to prevent wrapping Combat.update more than once.
  let lastApplied = null; // Used by mobile-visible diagnostics to show the latest out-of-combat dodge adjustment.

  function applyDodgeWeight(player, efficacy) {
    const beforeDodgeT = Number(player?.dodgeT); // Used to report and scale the current ordinary dodge duration/travel window.
    const beforeInvulnUntil = Number(player?.invulnUntil); // Used to report and scale only the remaining iframe window.
    const now = performance.now(); // Used as the common origin for the remaining invulnerability calculation.

    if (Number.isFinite(beforeDodgeT)) player.dodgeT = Math.max(0, beforeDodgeT * efficacy);
    const iframeRemaining = Math.max(0, (Number.isFinite(beforeInvulnUntil) ? beforeInvulnUntil : 0) - now);
    if (iframeRemaining > 0) player.invulnUntil = now + iframeRemaining * efficacy;
    player._armorWeightDodgeEfficacy = efficacy;

    lastApplied = {
      at: Date.now(),
      efficacy,
      beforeDodgeT: Number.isFinite(beforeDodgeT) ? beforeDodgeT : null,
      afterDodgeT: Number.isFinite(Number(player.dodgeT)) ? Number(player.dodgeT) : null,
      beforeIframeMs: iframeRemaining,
      afterIframeMs: Math.max(0, (Number(player.invulnUntil) || 0) - now),
    };
  }

  function install() {
    if (installed) return true;
    const combat = window.Combat; // Used as the authoritative per-frame seam already wrapped by the clothing system.
    const clothing = window.ClothingWeavingSystem; // Used for the same total-weight efficacy and combat-state calculation as the main system.
    if (!combat?.update || !clothing?.armorStats || !clothing?.combatActive) return false;

    const originalUpdate = combat.update.bind(combat); // Preserves the main clothing wrapper and every pre-existing combat update beneath this policy.
    let wasDodging = !!combat.deps?.player?.dodging; // Used to apply the correction once per newly-started dodge, never every frame.

    combat.update = function clothingWeightAllDodgeUpdate(dt) {
      const result = originalUpdate(dt);
      const player = window.Combat?.deps?.player; // Used after the original update so the live dodge state/timers are authoritative.
      const dodging = !!player?.dodging; // Used with wasDodging to detect the rising edge of a dodge.

      // ClothingWeavingSystem already applies the weight penalty to a dodge
      // started during its combat grace window. Fill only the complementary
      // case here so armor weight remains an inherent dodge tradeoff without
      // double-scaling combat dodges. Movement burden remains combat-only.
      if (player && dodging && !wasDodging && !clothing.combatActive(player)) {
        const efficacy = clothing.armorStats().dodgeEfficacy; // Used as the single shared weight-derived dodge multiplier.
        applyDodgeWeight(player, efficacy);
      }

      wasDodging = dodging;
      return result;
    };
    combat.update.__clothingWeightAllDodgePolicy = true;
    installed = true;
    return true;
  }

  function debugSnapshot() {
    const player = window.Combat?.deps?.player; // Used to expose current mobile-readable dodge state without devtools.
    return {
      version: VERSION,
      installed,
      combatActive: window.ClothingWeavingSystem?.combatActive?.(player) ?? null,
      dodging: !!player?.dodging,
      efficacy: window.ClothingWeavingSystem?.armorStats?.().dodgeEfficacy ?? null,
      lastApplied: lastApplied ? { ...lastApplied } : null,
    };
  }

  window.ClothingWeightDodgePolicy = Object.freeze({ version: VERSION, install, debugSnapshot });
  window.__clothingWeightDodgeDebug = debugSnapshot;
  install();
})();