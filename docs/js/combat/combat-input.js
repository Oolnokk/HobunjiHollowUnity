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
  const AUTO_TARGET_STORAGE_KEY = 'hobunjiMeleeAutoTargetEnabled'; // Used to persist the player-facing auto-target preference across sessions.
  let autoTargetEnabled = false; // Gates whether attacks enter the existing transient melee alignment/target-lock path.
  let autoTargetControl = null; // Cached Settings checkbox used to keep the injected UI synchronized with runtime state.
  try {
    autoTargetEnabled = localStorage.getItem(AUTO_TARGET_STORAGE_KEY) === 'true';
  } catch (_) {}

  function makeSlotState() {
    return {
      down: false, downAt: 0, holding: false,
      alignmentRequest: null, // Cancel handle for an offensive hold that is still aligning before windup.
      holdAbility: null, // Ability captured at the hold threshold so loadout swaps cannot change the pending action.
      holdStarted: false, // Distinguishes a real hold windup from one still waiting for alignment.
      releaseQueued: false, // Preserves an early release until transient alignment completes.
    };
  }
  const slots = { 1: makeSlotState(), 2: makeSlotState() };
  let lastAlignmentHandoff = { phase: 'idle', startedAtMs: 0, releasedAtMs: 0 };

  function now() {
    return performance.now() / 1000;
  }

  function autoTargetSettingsSnapshot() {
    return {
      enabled: autoTargetEnabled,
      defaultEnabled: false,
      storageKey: AUTO_TARGET_STORAGE_KEY,
      controlMounted: !!autoTargetControl,
    };
  }

  function setAutoTargetEnabled(enabled, options = {}) {
    const nextEnabled = !!enabled; // Normalized preference used by the attack-alignment gate and Settings checkbox.
    const persist = options.persist !== false; // Allows regression/debug callers to change runtime state without writing browser storage.
    autoTargetEnabled = nextEnabled;
    if (autoTargetControl) autoTargetControl.checked = autoTargetEnabled;
    if (persist) {
      try { localStorage.setItem(AUTO_TARGET_STORAGE_KEY, autoTargetEnabled ? 'true' : 'false'); }
      catch (_) {}
    }
    return autoTargetEnabled;
  }

  function mountAutoTargetSetting() {
    const existingControl = document.getElementById('settingMeleeAutoTarget'); // Reuses an already-mounted control if Settings rerenders around this module.
    if (existingControl) {
      autoTargetControl = existingControl;
      autoTargetControl.checked = autoTargetEnabled;
      return true;
    }

    const settingsPane = document.querySelector('#mpSettings .settings-pane'); // Existing Settings column that receives the Combat section.
    if (!settingsPane) return false;
    const cameraZoomRow = document.getElementById('settingZoom')?.closest('.settings-row') || null; // Stable Camera-section row used only as an insertion anchor.
    const cameraSectionTitle = cameraZoomRow?.previousElementSibling || null; // Existing Camera heading kept after the injected Combat section.
    const insertBefore = cameraSectionTitle?.parentElement === settingsPane ? cameraSectionTitle : null; // Falls back to appending if Settings markup changes.

    const sectionTitle = document.createElement('div'); // Combat heading visually groups the new player-facing targeting preference.
    sectionTitle.className = 'settings-section-title';
    sectionTitle.style.marginTop = '10px';
    sectionTitle.textContent = 'Combat';

    const row = document.createElement('label'); // Standard Settings row matching the existing toggle presentation and controller navigation hooks.
    row.className = 'settings-row';
    row.innerHTML = '<div class="settings-label">' +
      '<div class="settings-name">Auto-target</div>' +
      '<div class="settings-desc">Briefly turns you toward one nearby enemy before a melee attack. Off keeps your current facing and reticle aim fully manual.</div>' +
      '</div>' +
      '<span class="settings-toggle"><input type="checkbox" id="settingMeleeAutoTarget"><span class="toggle-slider"></span></span>';

    settingsPane.insertBefore(sectionTitle, insertBefore);
    settingsPane.insertBefore(row, insertBefore);
    autoTargetControl = row.querySelector('#settingMeleeAutoTarget');
    if (!autoTargetControl) return false;
    autoTargetControl.checked = autoTargetEnabled;
    autoTargetControl.addEventListener('change', () => setAutoTargetEnabled(autoTargetControl.checked));
    return true;
  }

  // Read-only state bridge for HUD presentation. Gameplay still owns every
  // transition below; callers cannot mutate the internal slot objects.
  function getState(slotIndex) {
    const s = slots[slotIndex];
    if (!s) return null;
    return {
      slotIndex,
      down: s.down,
      holding: s.holding,
      downForS: s.down ? Math.max(0, now() - s.downAt) : 0,
      holdThresholdS: HOLD_THRESHOLD_S,
    };
  }

  // Announces only real state-machine transitions so the arch coin-flip can
  // happen on the same frame the input becomes a hold on every device.
  function emitState(slotIndex, reason) {
    const detail = getState(slotIndex);
    if (!detail) return;
    detail.reason = reason;
    window.dispatchEvent(new CustomEvent('hobunji-combat-input-state', { detail }));
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

  function runAfterAttackAlignment(callback) {
    if (!autoTargetEnabled) {
      const bypassedAtMs = performance.now(); // Diagnostic timestamp proving the attack skipped target acquisition rather than aligning invisibly.
      lastAlignmentHandoff = { phase: 'disabled-bypass', startedAtMs: bypassedAtMs, releasedAtMs: bypassedAtMs };
      callback();
      return null;
    }
    const requestAlignment = window.Combat.deps?.requestMeleeAttackAlignment;
    if (!requestAlignment) { callback(); return null; }
    let attackStarted = false;
    const startAttackOnce = () => {
      if (attackStarted) return;
      attackStarted = true;
      lastAlignmentHandoff = { phase: 'windup-started', startedAtMs: performance.now(), releasedAtMs: 0 };
      callback();
    };
    const handle = requestAlignment(startAttackOnce);
    if (!handle?.runAttack) {
      if (attackStarted) lastAlignmentHandoff = { phase: 'immediate', startedAtMs: performance.now(), releasedAtMs: performance.now() };
      return handle || null;
    }
    const finishAlignment = handle.runAttack.bind(handle);
    const cancelAlignment = handle.cancel?.bind(handle);
    let releaseQueued = false;
    lastAlignmentHandoff = { phase: 'aligning', startedAtMs: 0, releasedAtMs: 0 };
    handle.runAttack = () => {
      if (releaseQueued) return;
      releaseQueued = true;
      startAttackOnce();
      requestAnimationFrame(() => {
        lastAlignmentHandoff = { phase: 'released-after-windup', startedAtMs: lastAlignmentHandoff.startedAtMs, releasedAtMs: performance.now() };
        finishAlignment();
      });
    };
    handle.cancel = () => {
      lastAlignmentHandoff = { phase: 'cancelled', startedAtMs: lastAlignmentHandoff.startedAtMs, releasedAtMs: performance.now() };
      cancelAlignment?.();
    };
    return handle;
  }

  function fireTap(slotIndex) {
    if (blockedByStagger()) return;
    const slotId = 'tap' + slotIndex;
    const ability = abilityForSlot(slotId);
    runAfterAttackAlignment(() => {
      if (ability?.onTap) ability.onTap({ slotIndex, slotId });
      else legacyTapFallback(slotIndex);
    });
  }

  function startHold(slotIndex) {
    const s = slots[slotIndex];
    if (!s || blockedByStagger()) return;
    const slotId = 'hold' + slotIndex;
    const ability = abilityForSlot(slotId);
    s.holdAbility = ability;
    s.holdStarted = false;
    s.releaseQueued = false;
    const start = () => {
      s.alignmentRequest = null;
      if ((!s.down && !s.releaseQueued) || !ability?.onHoldStart) return;
      s.holdStarted = true;
      ability.onHoldStart({ slotIndex, slotId });
      if (s.releaseQueued) {
        ability.onHoldEnd?.({ slotIndex, slotId });
        s.holdStarted = false;
        s.releaseQueued = false;
      }
    };
    if (ability?.category === 'offensiveHold') {
      let resolvedSynchronously = false;
      const handle = runAfterAttackAlignment(() => { resolvedSynchronously = true; start(); });
      if (!resolvedSynchronously) s.alignmentRequest = handle;
    } else {
      start();
    }
  }

  function updateHold(slotIndex, dt) {
    const s = slots[slotIndex];
    if (!s?.holdStarted) return;
    const slotId = 'hold' + slotIndex;
    s.holdAbility?.onHoldUpdate?.({ slotIndex, slotId }, dt);
  }

  function endHold(slotIndex) {
    const s = slots[slotIndex];
    if (!s) return;
    const slotId = 'hold' + slotIndex;
    if (s.alignmentRequest && !s.holdStarted) {
      s.releaseQueued = true;
      return;
    }
    if (s.holdStarted) s.holdAbility?.onHoldEnd?.({ slotIndex, slotId });
    s.holdStarted = false;
    s.releaseQueued = false;
    s.holdAbility = null;
  }

  // Call on pointerdown/touch-start for the given slot (1 or 2).
  function pressStart(slotIndex) {
    const s = slots[slotIndex];
    if (!s || s.down) return;
    s.down = true;
    s.downAt = now();
    s.holding = false;
    s.alignmentRequest?.cancel?.();
    s.alignmentRequest = null;
    s.holdAbility = null;
    s.holdStarted = false;
    s.releaseQueued = false;
    emitState(slotIndex, 'press-start');
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
    emitState(slotIndex, 'press-end');
  }

  // Resets a slot's press state without firing a tap or hold-end — for
  // input paths (like the mobile action bar's drag-to-aim) that take over
  // firing themselves and need to disarm the tap/hold timer mid-press.
  function cancelPress(slotIndex) {
    const s = slots[slotIndex];
    if (!s) return;
    s.alignmentRequest?.cancel?.();
    s.alignmentRequest = null;
    s.down = false;
    s.holding = false;
    s.holdAbility = null;
    s.holdStarted = false;
    s.releaseQueued = false;
    emitState(slotIndex, 'press-cancel');
  }

  // Ends an already-started hold, but never turns a canceled pending press
  // into a tap. Used when the browser loses ownership of the physical input.
  function abortPress(slotIndex) {
    const s = slots[slotIndex];
    if (!s || !s.down) return;
    if (s.holding) endHold(slotIndex);
    s.alignmentRequest?.cancel?.();
    s.alignmentRequest = null;
    s.down = false;
    s.holding = false;
    s.holdAbility = null;
    s.holdStarted = false;
    s.releaseQueued = false;
    emitState(slotIndex, 'press-abort');
  }

  function abortAllPresses() {
    for (const slotIndex of [1, 2]) abortPress(slotIndex);
  }

  // Ticked once per frame from Combat.update(dt) (wired in combat-core.js).
  function update(dt) {
    for (const slotIndex of [1, 2]) {
      const s = slots[slotIndex];
      if (!s.down) continue;
      if (!s.holding) {
        if (now() - s.downAt >= HOLD_THRESHOLD_S) {
          s.holding = true;
          emitState(slotIndex, 'hold-threshold');
          startHold(slotIndex);
        }
      } else {
        updateHold(slotIndex, dt);
      }
    }
  }

  window.Combat.input = {
    HOLD_THRESHOLD_S,
    pressStart,
    pressEnd,
    cancelPress,
    abortPress,
    abortAllPresses,
    fireTap,
    getState,
    isAutoTargetEnabled: () => autoTargetEnabled,
    setAutoTargetEnabled,
    autoTargetSettingsSnapshot,
    mountAutoTargetSetting,
    alignmentHandoffSnapshot: () => ({ ...lastAlignmentHandoff }),
    update,
  };

  // Piggyback on the existing per-frame Combat.update(dt) hook rather than
  // asking game.js for a second one.
  const _coreUpdate = window.Combat.update;
  window.Combat.update = function (dt) {
    _coreUpdate(dt);
    update(dt);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAutoTargetSetting, { once: true });
  } else {
    mountAutoTargetSetting();
  }

  // A lost release must not leave a defensive stance or charging heavy alive.
  window.addEventListener('blur', abortAllPresses);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) abortAllPresses();
  });
})();
