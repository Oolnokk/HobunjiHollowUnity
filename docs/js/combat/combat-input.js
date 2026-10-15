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
  const AUTO_TARGET_STORAGE_KEY = 'hobunjiMobileAutoTargetEnabled'; // Compatibility key; enabled state is never restored automatically.
  let autoTargetEnabled = false; // Targeting requires an explicit tap or hold in this session.
  let autoTargetControl = null; // Cached Settings checkbox synchronized with runtime state.

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
  const queuedAttacks = new Map(); // At most one buffered start per weapon input; repeated taps refresh that slot instead of building a backlog.
  let lastAlignmentHandoff = { phase: 'idle', startedAtMs: 0, releasedAtMs: 0 };

  function now() {
    return performance.now() / 1000;
  }

  function isAutoTargetEnabled() {
    return !window.matchMedia?.('(pointer: fine)').matches && autoTargetEnabled;
  }

  function autoTargetSettingsSnapshot() {
    return {
      enabled: isAutoTargetEnabled(),
      preferenceEnabled: autoTargetEnabled,
      mobileOnly: true,
      defaultEnabled: false,
      storageKey: AUTO_TARGET_STORAGE_KEY,
      controlMounted: !!autoTargetControl,
    };
  }

  function setAutoTargetEnabled(enabled, options = {}) {
    const nextEnabled = !!enabled; // Normalized preference used by the attack-alignment gate and Settings checkbox.
    const persist = options.persist !== false; // Allows regression/debug callers to change runtime state without writing browser storage.
    const changed = autoTargetEnabled !== nextEnabled; // Emits a targeting transition only when the preference actually changes.
    autoTargetEnabled = nextEnabled;
    if (autoTargetControl) autoTargetControl.checked = autoTargetEnabled;
    if (persist) {
      try { localStorage.setItem(AUTO_TARGET_STORAGE_KEY, autoTargetEnabled ? 'true' : 'false'); }
      catch (_) {}
    }
    if (changed) window.dispatchEvent(new CustomEvent('hobunji-auto-target-change'));
    return isAutoTargetEnabled();
  }

  function mountAutoTargetSetting() {
    if (window.matchMedia?.('(pointer: fine)').matches) return false;
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
      '<div class="settings-desc">Mobile only. Starts off and switches off when combat ends or your weapon is put away. Gradually turns the camera toward your target, more slowly up close. Drag heavy or ranged attack buttons to aim manually. Tap TARGET to toggle; hold and drag to choose prey or an enemy.</div>' +
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
      holdStarted: s.holdStarted,
      alignmentPending: !!s.alignmentRequest,
      releaseQueued: s.releaseQueued,
      attackQueued: queuedAttacks.has(slotIndex),
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
  function blockedByActionLock() {
    return !!(window.CharacterActionLocks?.isLocked?.('player', 'actions') || window.CharacterActionLocks?.isLocked?.('player', 'tools'));
  }

  function blockedByStagger() {
    const deps = window.Combat.deps;
    if (!window.Combat.isStaggered(deps?.player)) return false;
    deps?.showToast?.("Staggered!", false);
    return true;
  }

  function runAfterAttackAlignment(callback, slotIndex) {
    if ((window.CombatVocalizations?.attackStartDelayS?.() || 0) > 0) {
      const request = { // Re-enters alignment only after the shared grunt/attack duration allows another start.
        callback,
        queuedAtMs: now() * 1000,
        cancel() { if (queuedAttacks.get(slotIndex) === request) queuedAttacks.delete(slotIndex); },
      };
      queuedAttacks.set(slotIndex, request);
      emitState(slotIndex, 'attack-queued');
      return request;
    }

    if (!isAutoTargetEnabled()) {
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
    window.BandageSystem?.cancel?.('attack');
    if (blockedByActionLock() || blockedByStagger()) return;
    const slotId = 'tap' + slotIndex;
    const ability = abilityForSlot(slotId);
    runAfterAttackAlignment(() => {
      if (blockedByActionLock() || blockedByStagger() || window.Combat.deps?.player?.prone) return;
      if (ability?.onTap) ability.onTap({ slotIndex, slotId });
      else legacyTapFallback(slotIndex);
    }, slotIndex);
  }

  function startHold(slotIndex) {
    const s = slots[slotIndex];
    if (!s || blockedByActionLock() || blockedByStagger()) return;
    const slotId = 'hold' + slotIndex;
    const ability = abilityForSlot(slotId);
    s.holdAbility = ability;
    s.holdStarted = false;
    s.releaseQueued = false;
    const start = () => {
      s.alignmentRequest = null;
      if (blockedByActionLock() || blockedByStagger() || window.Combat.deps?.player?.prone || (!s.down && !s.releaseQueued) || !ability?.onHoldStart) return;
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
      const handle = runAfterAttackAlignment(() => { resolvedSynchronously = true; start(); }, slotIndex);
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

  function endHold(slotIndex, cancelled = false) {
    const s = slots[slotIndex];
    if (!s) return;
    const slotId = 'hold' + slotIndex;
    if (s.alignmentRequest && !s.holdStarted) {
      s.releaseQueued = true;
      return;
    }
    if (s.holdStarted) {
      const finish = cancelled ? (s.holdAbility?.onHoldCancel || s.holdAbility?.onHoldEnd) : s.holdAbility?.onHoldEnd; // Canceled holds use cleanup without release attacks when the ability supports it.
      try {
        finish?.({ slotIndex, slotId, cancelled });
      } finally {
        s.holdStarted = false;
        s.releaseQueued = false;
        s.holdAbility = null;
      }
    }
    s.holdStarted = false;
    s.releaseQueued = false;
    s.holdAbility = null;
  }

  // Call on pointerdown/touch-start for the given slot (1 or 2).
  function pressStart(slotIndex) {
    window.BandageSystem?.cancel?.('attack');
    const s = slots[slotIndex];
    if (!s || s.down || blockedByActionLock()) return;
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
    if (blockedByActionLock()) { abortPress(slotIndex); return; }
    try {
      if (s.holding) endHold(slotIndex);
      else fireTap(slotIndex);
    } finally {
      s.down = false;
      s.holding = false;
      emitState(slotIndex, 'press-end');
    }
  }

  // Disarms a press without firing a tap or release attack. Equipment
  // stowing uses the same cancellation cleanup as physical input loss.
  function cancelPress(slotIndex) {
    // Disarming a started hold must also release the ability's stance/windup.
    abortPress(slotIndex);
  }

  // Ends an already-started hold, but never turns a canceled pending press
  // into a tap. Used when the browser loses ownership of the physical input.
  function abortPress(slotIndex) {
    queuedAttacks.get(slotIndex)?.cancel();
    const s = slots[slotIndex];
    if (!s || (!s.down && !s.holdStarted && !s.alignmentRequest)) return;
    try {
      if (s.holdStarted) endHold(slotIndex, true);
    } finally {
      try {
        s.alignmentRequest?.cancel?.();
      } finally {
        s.alignmentRequest = null;
        s.down = false;
        s.holding = false;
        s.holdAbility = null;
        s.holdStarted = false;
        s.releaseQueued = false;
        emitState(slotIndex, 'press-abort');
      }
    }
  }

  function abortAllPresses() {
    try { abortPress(1); }
    finally { abortPress(2); }
  }

  // A buffered start belongs to the swing it was queued behind: drop it once the
  // weapon is no longer out (tool switch, held bag item) or it has waited far
  // longer than any attack (e.g. queued at a doorway, then Combat.update paused
  // inside an interior), so it can never land as an invisible hit later.
  const QUEUED_ATTACK_MAX_AGE_MS = 4000;
  function dropStaleQueuedAttacks() {
    const deps = window.Combat.deps;
    const tool = deps?.getActiveTool?.(); // Hosts without the dep (headless harnesses) are treated as weapon-out.
    const weaponOut = (tool === undefined || tool === 'weapon') && deps?.getHeldMode?.() !== 'item';
    const nowMs = now() * 1000;
    for (const [slotIndex, request] of [...queuedAttacks]) {
      if (weaponOut && nowMs - request.queuedAtMs <= QUEUED_ATTACK_MAX_AGE_MS) continue;
      request.cancel();
      if (slots[slotIndex]?.alignmentRequest === request) slots[slotIndex].alignmentRequest = null;
      emitState(slotIndex, 'attack-queue-dropped');
    }
  }

  // Ticked once per frame from Combat.update(dt) (wired in combat-core.js).
  function update(dt) {
    if (blockedByActionLock()) { abortAllPresses(); return; }
    if (window.Combat.deps?.player?.prone || window.Combat.isStaggered(window.Combat.deps?.player)) {
      abortAllPresses();
      return;
    }
    if (queuedAttacks.size) dropStaleQueuedAttacks();
    if (queuedAttacks.size && !(window.CombatVocalizations?.attackStartDelayS?.() > 0)) {
      const [slotIndex, request] = queuedAttacks.entries().next().value; // Drain one start per frame so it can establish its own duration gate.
      queuedAttacks.delete(slotIndex);
      const wasPendingHold = slots[slotIndex]?.alignmentRequest === request; // Transfer cancellation ownership if the buffered hold now needs target alignment.
      const alignment = runAfterAttackAlignment(request.callback, slotIndex);
      if (wasPendingHold && slots[slotIndex].alignmentRequest === request) slots[slotIndex].alignmentRequest = alignment;
      emitState(slotIndex, 'attack-dequeued');
    }
    for (const slotIndex of [1, 2]) {
      const s = slots[slotIndex];
      if (!s.down) continue;
      if (window.Combat.deps?.player?.prone) {
        abortPress(slotIndex);
        continue;
      }
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
    queueSnapshot: () => [...queuedAttacks.keys()],
    isAutoTargetEnabled,
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
