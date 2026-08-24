(() => {
  'use strict';

  // Loading-screen reason owned only by this bridge, so boot/Tothal coverage can overlap safely.
  const COVER_REASON = 'wilderness-scene-build';
  // Every gameplay action that can execute the currently highlighted world-interaction/travel button.
  const TRAVEL_ACTION_IDS = ['interact', 'dodge', 'action1', 'action2', 'action3', 'action4'];
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
  // Tracks whether any controller input capable of executing travel was already down last frame.
  let controllerTravelWasDown = false;
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

  function actionForBinding(binding, device) {
    if (!binding) return null;
    return TRAVEL_ACTION_IDS.find(actionId => actionBinding(actionId, device) === binding) || null;
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

  function controllerTravelDown() {
    if (!navigator.getGamepads) return null;
    const bindings = TRAVEL_ACTION_IDS
      .map(actionId => ({ actionId, binding: actionBinding(actionId, 'controller') }))
      .filter(entry => entry.binding);
    for (const gamepad of navigator.getGamepads()) {
      if (!gamepad) continue;
      for (const entry of bindings) {
        if (controllerBindingDown(gamepad, entry.binding)) return entry;
      }
    }
    return null;
  }

  function frameWatch(now) {
    const frameGap = Math.max(0, now - lastFrameAt);
    lastFrameAt = now;

    if (coverActive && frameGap >= LONG_FRAME_MS && now - lastLongFrameLogAt >= 3000) {
      lastLongFrameLogAt = now;
      log(`Main-thread stall during wilderness scene build: ${Math.round(frameGap)} ms`, 'warn');
    }

    const controllerTravel = controllerTravelDown();
    if (controllerTravel && !controllerTravelWasDown && pendingZoneTransition()) {
      beginCover(`controller ${controllerTravel.actionId}:${controllerTravel.binding}`);
    }
    controllerTravelWasDown = !!controllerTravel;
    requestAnimationFrame(frameWatch);
  }

  // Mobile travel can be fired by the context/dodge control or by whichever arch action slot currently owns use_spot.
  document.addEventListener('pointerdown', event => {
    if (!pendingZoneTransition()) return;
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;
    if (button.id === 'dodgeBtn' || /^btnAction\d+$/.test(button.id)) beginCover(`pointer ${button.id}`);
  }, true);

  // Desktop input is remappable. Cover every binding that can dispatch Interact/context or an active action slot.
  window.addEventListener('keydown', event => {
    if (event.repeat || !pendingZoneTransition()) return;
    const actionId = actionForBinding(event.code, 'desktop');
    if (actionId) beginCover(`desktop ${actionId}:${event.code}`);
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
      desktopBindings: Object.fromEntries(TRAVEL_ACTION_IDS.map(id => [id, actionBinding(id, 'desktop')])),
      controllerBindings: Object.fromEntries(TRAVEL_ACTION_IDS.map(id => [id, actionBinding(id, 'controller')])),
    }),
  };

  log('Wilderness loading bridge initialized; recent change: cover Interact, Dodge/context, action-slot, mobile, and controller wilderness travel inputs.');
})();