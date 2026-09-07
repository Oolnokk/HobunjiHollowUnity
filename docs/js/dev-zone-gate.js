// Dev-only gate for unfinished wilderness zones.
// Loaded before game.js so input capture can stop a blocked entrance before the runtime transition handler receives it.
(() => {
  'use strict';

  if (window.DevZoneGate?.installed) return;

  const BLOCKED_ZONE_IDS = new Set(['map_eastern_mire', 'map_western_slope']); // Used to identify unfinished zone destinations that require Dev Mode.
  const TRAVEL_ACTION_IDS = Object.freeze(['interact', 'dodge', 'action1', 'action2', 'action3', 'action4']); // Used to match every configured input that can execute a highlighted world transition.
  const TOAST_TEXT = 'That zone is under construction.'; // Used for the blocked-entry toast requested for non-dev play.
  const TOAST_MS = 2200; // Used to match the existing game's short toast lifetime.
  let toastTimer = 0; // Used to replace the previous hide timer when the player retries an entrance.
  let controllerAttemptDown = false; // Used to emit one toast per controller press instead of once per polling frame.

  function devModeEnabled() {
    const devModeToggle = document.getElementById('settingDevMode'); // Existing authoritative Settings checkbox mirrored from the game's s_devMode state.
    return !!devModeToggle?.checked;
  }

  function pendingBlockedTransition() {
    if (devModeEnabled()) return null;
    let transition = null; // Used to hold the game's currently highlighted map-transition descriptor.
    try { transition = window.__climbDebug?.getPendingSpotTransition?.() || null; } catch (_) {}
    if (!transition || transition.target !== 'zone' || !BLOCKED_ZONE_IDS.has(transition.targetMapId)) return null;
    return transition;
  }

  function showConstructionToast() {
    const toast = document.getElementById('toast'); // Existing toast element reused instead of introducing a second notification surface.
    if (!toast) return;
    toast.textContent = TOAST_TEXT;
    toast.classList.remove('ok');
    toast.classList.add('fail', 'show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('show', 'fail');
      toastTimer = 0;
    }, TOAST_MS);
  }

  function blockEvent(event, source) {
    const transition = pendingBlockedTransition(); // Used to ensure unrelated interact inputs remain untouched.
    if (!transition) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    showConstructionToast();
    window.__farmLog?.(`[dev-zone-gate] blocked ${source} entry into ${transition.targetMapId}; Dev Mode is off.`, 'info', 'world');
    return true;
  }

  function inputConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.input || {};
  }

  function defaultActionBinding(actionId, device) {
    const action = (inputConfig().actions || []).find(entry => entry?.id === actionId); // Used to resolve the shipped binding when the player has not remapped it.
    return action?.[device] || null;
  }

  function savedInputBindings() {
    const config = inputConfig(); // Used to locate the same input-binding storage key as the live game.
    try { return JSON.parse(localStorage.getItem(config.storageKey || 'scratchbones.inputBindings.v1') || 'null') || {}; }
    catch (_) { return {}; }
  }

  function actionBinding(actionId, device) {
    const saved = savedInputBindings(); // Used to prefer the player's remapped binding over the default.
    return saved?.[device]?.[actionId] || defaultActionBinding(actionId, device);
  }

  function actionForDesktopCode(code) {
    return TRAVEL_ACTION_IDS.find(actionId => actionBinding(actionId, 'desktop') === code) || null;
  }

  function pointerIsTravelControl(event) {
    const button = event.target instanceof Element ? event.target.closest('button') : null; // Used to recognize the mobile context/action controls without swallowing menu clicks.
    return !!button && (button.id === 'dodgeBtn' || /^btnAction\d+$/.test(button.id));
  }

  window.addEventListener('keydown', event => {
    if (event.repeat || !actionForDesktopCode(event.code)) return;
    blockEvent(event, `desktop:${event.code}`);
  }, true);

  document.addEventListener('pointerdown', event => {
    if (!pointerIsTravelControl(event)) return;
    blockEvent(event, `pointer:${event.target?.id || 'action'}`);
  }, true);

  document.addEventListener('click', event => {
    if (!pointerIsTravelControl(event)) return;
    if (pendingBlockedTransition()) blockEvent(event, `click:${event.target?.id || 'action'}`);
  }, true);

  function neutralizeControllerBinding(buttons, axes, binding) {
    if (!binding) return false;
    const buttonMatch = /^Button(\d+)$/.exec(binding); // Used to map configured ButtonN bindings onto Gamepad.buttons indices.
    let wasDown = false; // Used to report whether this binding represented the player's current attempt.
    let buttonIndex = -1; // Used for normal buttons and the named trigger aliases below.
    if (buttonMatch) buttonIndex = Number(buttonMatch[1]);
    else if (binding === 'LeftTrigger') buttonIndex = 6;
    else if (binding === 'RightTrigger') buttonIndex = 7;
    if (buttonIndex >= 0 && buttons[buttonIndex]) {
      wasDown = !!buttons[buttonIndex].pressed || Number(buttons[buttonIndex].value) > 0.5;
      buttons[buttonIndex] = { pressed: false, touched: false, value: 0 };
      return wasDown;
    }
    const axisIndex = binding === 'RightStickLeft' || binding === 'RightStickRight' ? 2
      : binding === 'RightStickUp' || binding === 'RightStickDown' ? 3
      : -1; // Used to neutralize configured right-stick action bindings while leaving movement axes alone.
    if (axisIndex >= 0) {
      const axisValue = Number(axes[axisIndex] || 0); // Used to detect a directional action press before neutralizing that axis.
      wasDown = binding === 'RightStickLeft' || binding === 'RightStickUp' ? axisValue <= -0.55 : axisValue >= 0.55;
      axes[axisIndex] = 0;
    }
    return wasDown;
  }

  function installControllerGate() {
    if (typeof navigator.getGamepads !== 'function' || navigator.getGamepads.__devZoneGateWrapped) return false;
    const originalGetGamepads = navigator.getGamepads.bind(navigator); // Used to preserve the browser's real gamepad snapshots outside blocked entrances.
    const wrappedGetGamepads = function getGamepadsWithDevZoneGate() {
      const gamepads = originalGetGamepads(); // Used as the unmodified source snapshot for this poll.
      if (!pendingBlockedTransition()) {
        controllerAttemptDown = false;
        return gamepads;
      }
      let anyAttemptDown = false; // Used to collapse multiple configured controller actions into one toast edge.
      const gatedPads = Array.from(gamepads || [], gamepad => { // Used to return per-pad proxies with only travel controls neutralized.
        if (!gamepad) return gamepad;
        const buttons = Array.from(gamepad.buttons || []); // Used as a shallow copy so the native Gamepad snapshot is never mutated.
        const axes = Array.from(gamepad.axes || []); // Used as a shallow copy for configured stick-action neutralization.
        for (const actionId of TRAVEL_ACTION_IDS) {
          if (neutralizeControllerBinding(buttons, axes, actionBinding(actionId, 'controller'))) anyAttemptDown = true;
        }
        return new Proxy(gamepad, {
          get(target, property) {
            if (property === 'buttons') return buttons;
            if (property === 'axes') return axes;
            const value = Reflect.get(target, property, target); // Used to retain all normal native Gamepad metadata/getters.
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      });
      if (anyAttemptDown && !controllerAttemptDown) {
        showConstructionToast();
        const transition = pendingBlockedTransition(); // Used only for the mobile-friendly debug log message.
        window.__farmLog?.(`[dev-zone-gate] blocked controller entry into ${transition?.targetMapId || 'unfinished zone'}; Dev Mode is off.`, 'info', 'world');
      }
      controllerAttemptDown = anyAttemptDown;
      return gatedPads;
    };
    wrappedGetGamepads.__devZoneGateWrapped = true;
    try {
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: wrappedGetGamepads });
      return true;
    } catch (error) {
      window.__farmLog?.(`[dev-zone-gate] controller gate could not wrap navigator.getGamepads: ${error?.message || error}`, 'warn', 'world');
      return false;
    }
  }

  const controllerGateInstalled = installControllerGate(); // Exposed in getDebug() so controller coverage can be checked without devtools.
  window.DevZoneGate = Object.freeze({
    installed: true,
    blockedZoneIds: Object.freeze([...BLOCKED_ZONE_IDS]),
    getDebug: () => ({
      devMode: devModeEnabled(),
      pendingTransition: pendingBlockedTransition(),
      controllerGateInstalled,
      desktopBindings: Object.fromEntries(TRAVEL_ACTION_IDS.map(actionId => [actionId, actionBinding(actionId, 'desktop')])),
      controllerBindings: Object.fromEntries(TRAVEL_ACTION_IDS.map(actionId => [actionId, actionBinding(actionId, 'controller')])),
      recentChange: 'Eastern Mire and Western Incline require Dev Mode; blocked entrance interactions show the under-construction toast.',
    }),
  });

  window.__farmLog?.('[dev-zone-gate] initialized: Eastern Mire and Western Incline are Dev Mode-only.', 'info', 'world');
})();
