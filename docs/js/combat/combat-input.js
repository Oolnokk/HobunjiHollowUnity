// Combat input — tap-vs-hold detection for the weapon tool's two inputs
// (desktop left/right click, mobile's two weapon action-bar buttons), and
// dispatch into whichever ability the player's loadout has bound to the
// resulting slot (tap1/tap2/hold1/hold2).
//
// Tap/hold disambiguation: on press, start a timer. If released before
// HOLD_THRESHOLD_S, it's a tap — fires at release, so quick taps never pay
// any added latency. If still held when the threshold passes, the bound
// hold ability starts immediately and keeps updating every frame until
// release ends it.
(() => {
  "use strict";
  if (!window.Combat?.loadout) { console.error('combat-input.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const HOLD_THRESHOLD_S = 0.16;

  function makeSlotState() {
    return { down: false, downAt: 0, holding: false };
  }
  const slots = { 1: makeSlotState(), 2: makeSlotState() };

  function now() {
    return performance.now() / 1000;
  }

  // Legacy fallback for tap slots only: fires the weapon tool's existing
  // cut/slash swing exactly as it behaved before any loadout ability claimed
  // that slot. There's no equivalent legacy behavior for hold slots, since
  // the weapon tool never had a hold action before this system existed.
  function legacyTapFallback(slotIndex) {
    const deps = window.Combat.deps;
    if (!deps?.fireLegacyWeaponAction) return;
    deps.fireLegacyWeaponAction(slotIndex);
  }

  function abilityForSlot(slotId) {
    const abilityId = window.Combat.loadout.getSlot(slotId);
    return abilityId ? window.Combat.abilities.get(abilityId) : null;
  }

  // No weapon action (tap or hold — attacks and defensive stances alike)
  // while swimming in a river/stream (see game.js's isPlayerSwimming) —
  // single choke point for every ability, instead of each one checking it.
  function blockedBySwimming() {
    const deps = window.Combat.deps;
    if (!deps?.isPlayerSwimming?.()) return false;
    deps.showToast?.("Can't fight while swimming!", false);
    return true;
  }

  // Same choke point, for the Footing/impact stagger lockout (see combat-
  // core.js's isStaggered/beginStagger, set from game.js's damagePlayer) —
  // reeling from a hit blocks starting any weapon action, tap or hold alike
  // (combo/quick-attack/charged-breaker/flurry/counter-shield's riposte also
  // each carry their own isStaggered guard at their actual attack-commit
  // point, since a hold ability like Charged Breaker can still be staggered
  // AFTER startHold already passed this check but before it releases).
  function blockedByStagger() {
    const deps = window.Combat.deps;
    if (!window.Combat.isStaggered(deps?.player)) return false;
    deps?.showToast?.("Staggered!", false);
    return true;
  }

  function fireTap(slotIndex) {
    if (blockedBySwimming() || blockedByStagger()) return;
    const slotId = 'tap' + slotIndex;
    const ability = abilityForSlot(slotId);
    if (ability?.onTap) {
      ability.onTap({ slotIndex, slotId });
      return;
    }
    legacyTapFallback(slotIndex);
  }

  function startHold(slotIndex) {
    if (blockedBySwimming() || blockedByStagger()) return;
    const slotId = 'hold' + slotIndex;
    const ability = abilityForSlot(slotId);
    if (ability?.onHoldStart) ability.onHoldStart({ slotIndex, slotId });
  }

  function updateHold(slotIndex, dt) {
    const slotId = 'hold' + slotIndex;
    const ability = abilityForSlot(slotId);
    if (ability?.onHoldUpdate) ability.onHoldUpdate({ slotIndex, slotId }, dt);
  }

  function endHold(slotIndex) {
    const slotId = 'hold' + slotIndex;
    const ability = abilityForSlot(slotId);
    if (ability?.onHoldEnd) ability.onHoldEnd({ slotIndex, slotId });
  }

  // Call on pointerdown/touch-start for the given slot (1 or 2).
  function pressStart(slotIndex) {
    const s = slots[slotIndex];
    if (!s || s.down) return;
    s.down = true;
    s.downAt = now();
    s.holding = false;
  }

  // Call on pointerup/touch-end for the given slot.
  function pressEnd(slotIndex) {
    const s = slots[slotIndex];
    if (!s || !s.down) return;
    if (s.holding) {
      endHold(slotIndex);
    } else {
      fireTap(slotIndex);
    }
    s.down = false;
    s.holding = false;
  }

  // Resets a slot's press state without firing a tap or hold-end — for
  // input paths (like the mobile action bar's drag-to-aim) that take over
  // firing themselves and need to disarm the tap/hold timer mid-press.
  function cancelPress(slotIndex) {
    const s = slots[slotIndex];
    if (!s) return;
    s.down = false;
    s.holding = false;
  }

  // Ticked once per frame from Combat.update(dt) (wired in combat-core.js).
  function update(dt) {
    for (const slotIndex of [1, 2]) {
      const s = slots[slotIndex];
      if (!s.down) continue;
      if (!s.holding) {
        if (now() - s.downAt >= HOLD_THRESHOLD_S) {
          s.holding = true;
          startHold(slotIndex);
        }
      } else {
        updateHold(slotIndex, dt);
      }
    }
  }

  window.Combat.input = {
    pressStart,
    pressEnd,
    cancelPress,
    fireTap,
    update,
  };

  // Piggyback on the existing per-frame Combat.update(dt) hook rather than
  // asking game.js for a second one.
  const _coreUpdate = window.Combat.update;
  window.Combat.update = function (dt) {
    _coreUpdate(dt);
    update(dt);
  };
})();
