(() => {
  'use strict';

  // Loading-screen reason owned only by this bridge, so boot/Tothal coverage can overlap safely.
  const COVER_REASON = 'wilderness-scene-build';
  // Safety release if a requested travel never changes areas; prevents a bad transition from trapping input forever.
  const ENTRY_TIMEOUT_MS = 60000;
  // A frame gap at or above this threshold is useful evidence of the synchronous first-visit zone build on mobile.
  const LONG_FRAME_MS = 750;

  // Current transition-cover poll timer; only one zone entry can be active at a time.
  let entryPollTimer = 0;
  // Monotonic generation invalidates an older poll if another zone-entry attempt supersedes it.
  let entryGeneration = 0;
  // True while this bridge owns COVER_REASON and should report long main-thread stalls.
  let coverActive = false;
  // Last requestAnimationFrame timestamp used to measure main-thread stalls without devtools.
  let lastFrameAt = performance.now();
  // Last controller dodge state provides an edge trigger rather than retriggering every held frame.
  let controllerDodgeWasDown = false;
  // Last long-frame report time prevents one recovery from spamming the mobile Debug log.
  let lastLongFrameLogAt = 0;

  function log(message, level = 'info') {
    try { window.__farmLog?.(`[loading-screen] ${message}`, level); } catch (_) {}
  }

  function loadingScreen() {
    return window.HobunjiLoadingScreen || null;
  }

  function pendingZoneTransition() {
    try {
      const transition = window.__climbDebug?.getPendingSpotTransition?.();
      return transition?.target === 'zone' && transition.targetMapId ? transition : null;
    } catch (_) {
      return null;
    }
  }

  function currentArea() {
    try { return window.__climbDebug?.getCurrentArea?.() || null; } catch (_) { return null; }
  }

  function finishCover(generation, outcome) {
    if (generation !== entryGeneration) return;
    if (entryPollTimer) {
      clearTimeout(entryPollTimer);
      entryPollTimer = 0;
    }
    coverActive = false;
    loadingScreen()?.setProgress?.(100);
    // Leave two browser paints between the completed synchronous scene build and revealing gameplay.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation !== entryGeneration) return;
      loadingScreen()?.hide?.(COVER_REASON);
      log(`Wilderness scene cover released: ${outcome}`);
    }));
  }

  function beginCover(inputSource) {
    const transition = pendingZoneTransition();
    const screen = loadingScreen();
    if (!transition || !screen) return false;

    const targetMapId = transition.targetMapId;
    const sourceArea = currentArea();
    const generation = ++entryGeneration;
    const startedAt = performance.now();

    if (entryPollTimer) clearTimeout(entryPollTimer);
    coverActive = true;
    screen.show?.(COVER_REASON);
    screen.setProgress?.(12);
    log(`Wilderness scene cover armed from ${inputSource}: ${sourceArea || '(unknown)'} -> ${targetMapId}`);

    const poll = () => {
      if (generation !== entryGeneration) return;
      const area = currentArea();
      if (area === targetMapId) {
        finishCover(generation, `entered ${targetMapId}`);
        return;
      }
      if (performance.now() - startedAt >= ENTRY_TIMEOUT_MS) {
        log(`Wilderness scene cover timed out waiting for ${targetMapId}; releasing`, 'warn');
        finishCover(generation, `timeout for ${targetMapId}`);
        return;
      }
      entryPollTimer = setTimeout(poll, 50);
    };
    entryPollTimer = setTimeout(poll, 50);
    return true;
  }

  function inputConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.input || {};
  }

  function defaultActionBinding(actionId, device) {
    const action = (inputConfig().actions || []).find(entry => entry?.id === actionId);
    return action?.[device] || null;
  }

  function savedInputBindings() {
    const cfg = inputConfig();
    try { return JSON.parse(localStorage.getItem(cfg.storageKey || 'scratchbones.inputBindings.v1') || 'null') || {}; }
    catch (_) { return {}; }
  }

  function actionBinding(actionId, device) {
    return savedInputBindings()?.[device]?.[actionId] || defaultActionBinding(actionId, device);
  }

  function controllerBindingDown(gamepad, binding) {
    if (!gamepad || !binding) return false;
    const threshold = Number(inputConfig().axisPressThreshold) || 0.55;
    const buttonMatch = /^Button(\d+)$/.exec(binding);
    if (buttonMatch) return !!gamepad.buttons?.[Number(buttonMatch[1])]?.pressed;
    if (binding === 'LeftTrigger') return (gamepad.buttons?.[6]?.value || 0) >= threshold;
    if (binding === 'RightTrigger') return (gamepad.buttons?.[7]?.value || 0) >= threshold;
    const axis = binding === 'RightStickLeft' || binding === 'RightStickRight' ? Number(gamepad.axes?.[2] || 0)
      : binding === 'RightStickUp' || binding === 'RightStickDown' ? Number(gamepad.axes?.[3] || 0)
      : 0;
    if (binding === 'RightStickLeft' || binding === 'RightStickUp') return axis <= -threshold;
    if (binding === 'RightStickRight' || binding === 'RightStickDown') return axis >= threshold;
    return false;
  }

  function controllerDodgeDown() {
    const binding = actionBinding('dodge', 'controller');
    if (!binding || !navigator.getGamepads) return false;
    for (const gamepad of navigator.getGamepads()) {
      if (controllerBindingDown(gamepad, binding)) return true;
    }
    return false;
  }

  function frameWatch(now) {
    const frameGap = Math.max(0, now - lastFrameAt);
    lastFrameAt = now;

    if (coverActive && frameGap >= LONG_FRAME_MS && now - lastLongFrameLogAt >= 3000) {
      lastLongFrameLogAt = now;
      log(`Main-thread stall during wilderness scene build: ${Math.round(frameGap)} ms`, 'warn');
    }

    const dodgeDown = controllerDodgeDown();
    if (dodgeDown && !controllerDodgeWasDown && pendingZoneTransition()) beginCover('controller dodge');
    controllerDodgeWasDown = dodgeDown;
    requestAnimationFrame(frameWatch);
  }

  // Mobile's dodge/context button is the actual transition input when standing on a travel spot.
  document.addEventListener('pointerdown', event => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button?.id === 'dodgeBtn') beginCover('mobile context');
  }, true);

  // Desktop bindings are user-remappable; consult the same saved binding data as game.js instead of hardcoding X.
  window.addEventListener('keydown', event => {
    if (event.repeat || !pendingZoneTransition()) return;
    const dodgeBinding = actionBinding('dodge', 'desktop');
    if (dodgeBinding && event.code === dodgeBinding) beginCover(`desktop ${event.code}`);
  }, true);

  requestAnimationFrame(frameWatch);

  // Mobile-friendly inspection hook; mirrors the project's existing debug globals without requiring devtools.
  window.HobunjiLoadingWildernessBridge = {
    pendingZoneTransition,
    beginCover: () => beginCover('debug'),
    getDebug: () => ({
      coverActive,
      currentArea: currentArea(),
      pendingTransition: pendingZoneTransition(),
      desktopDodgeBinding: actionBinding('dodge', 'desktop'),
      controllerDodgeBinding: actionBinding('dodge', 'controller'),
    }),
  };

  log('Wilderness loading bridge initialized; recent change: cover the real context/dodge transition before first-visit zone scene construction.');
})();