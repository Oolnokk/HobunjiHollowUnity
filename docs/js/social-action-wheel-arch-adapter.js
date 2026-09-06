// Social Action Wheel input/presentation adapter.
//
// Keeps the centered Social Actions wheel as its own visualization, while
// making its controls and HUD treatment follow the game's held selection
// arches: hold to open, wheel/directional movement while held, release to
// commit, and a hold-drag-release mobile path. This intentionally drives the
// existing SocialActionWheel public API/DOM instead of duplicating action or
// dance logic.
(() => {
  'use strict';

  if (window.SocialActionWheelArchAdapter?.installed) return;

  const DEFAULT_HOLD_MS = 350;
  const desktopHold = { down: false, opened: false, timer: null, code: null }; // Pairs one desktop social-selector press with its delayed open/release commit lifecycle.
  const mobileHold = { pointerId: null, opened: false, timer: null, x: 0, y: 0 }; // Tracks the outer-ring Social Actions button through the same hold-drag-release lifecycle as other held selectors.
  const debug = {
    lastChange: 'Social Actions now uses selection-arch hold/wheel/release controls and HUD styling.',
    desktopHeld: false,
    mobileHeld: false,
    lastInput: null,
    wheelSteps: 0,
  }; // Exposed and mirrored into the wheel's visible debug strip for mobile testing.

  function socialConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.socialActions || {};
  }

  function currentBindings() {
    return window.InputBindings?.getCurrentBindings?.() || null;
  }

  function desktopBinding() {
    return currentBindings()?.desktop?.socialWheel || socialConfig().desktopOpen || 'Shift+KeyQ';
  }

  function parseDesktopChord(raw) {
    const tokens = String(raw || '').split('+').map(token => token.trim()).filter(Boolean);
    const code = tokens.pop() || '';
    const modifiers = new Set(tokens.map(token => token.toLowerCase()));
    return {
      code,
      shift: modifiers.has('shift'),
      ctrl: modifiers.has('ctrl') || modifiers.has('control'),
      alt: modifiers.has('alt'),
      meta: modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command'),
    };
  }

  function matchesDesktopBinding(event, rawBinding) {
    const parsed = parseDesktopChord(rawBinding);
    if (!parsed.code || event.code !== parsed.code) return false;
    return event.shiftKey === parsed.shift
      && event.ctrlKey === parsed.ctrl
      && event.altKey === parsed.alt
      && event.metaKey === parsed.meta;
  }

  function holdMs() {
    const configured = Number(socialConfig().holdOpenMs ?? window.SCRATCHBONES_CONFIG?.game?.desktopControls?.tapWindowMs);
    return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_HOLD_MS;
  }

  function claim(event) {
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function wheelApi() {
    return window.SocialActionWheel || null;
  }

  function wheelIsOpen() {
    return Boolean(wheelApi()?.getDebug?.()?.open);
  }

  function openHeldWheel(source) {
    const api = wheelApi();
    if (!api?.open) return false;
    const opened = api.open(source, false) !== false;
    if (opened) updateAdapterDebug();
    return opened;
  }

  function wheelElements() {
    return {
      overlay: document.getElementById('socialActionOverlay'),
      wheel: document.getElementById('socialActionWheel'),
    };
  }

  function dispatchSelectionPoint(clientX, clientY) {
    const { overlay } = wheelElements();
    if (!overlay || !wheelIsOpen()) return false;
    let event;
    const init = { bubbles: true, cancelable: true, clientX, clientY, pointerType: 'mouse', pointerId: 9401 };
    if (typeof PointerEvent === 'function') event = new PointerEvent('pointermove', init);
    else event = new MouseEvent('mousemove', init);
    overlay.dispatchEvent(event);
    return true;
  }

  function selectIndex(index) {
    const api = wheelApi();
    const actions = api?.actions || [];
    const { wheel } = wheelElements();
    if (!wheel || !actions.length) return false;
    const safeIndex = ((Number(index) || 0) % actions.length + actions.length) % actions.length;
    const rect = wheel.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.37;
    const angle = -Math.PI / 2 + safeIndex * (Math.PI * 2 / actions.length);
    return dispatchSelectionPoint(
      rect.left + rect.width / 2 + Math.cos(angle) * radius,
      rect.top + rect.height / 2 + Math.sin(angle) * radius,
    );
  }

  function cycleSelectionFromWheel(deltaY) {
    const api = wheelApi();
    const actions = api?.actions || [];
    if (!actions.length || Number(deltaY) === 0) return false;
    const current = Number(api.getDebug?.()?.selectedIndex);
    const direction = Number(deltaY) > 0 ? -1 : 1; // Matches Q+wheel selection arches: wheel-down moves toward the previous entry.
    const next = Number.isInteger(current) && current >= 0
      ? (current + direction + actions.length) % actions.length
      : (direction < 0 ? actions.length - 1 : 0);
    if (!selectIndex(next)) return false;
    debug.wheelSteps++;
    debug.lastInput = `desktop wheel -> ${actions[next]?.id || next}`;
    updateAdapterDebug();
    return true;
  }

  function clearDesktopTimer() {
    if (!desktopHold.timer) return;
    clearTimeout(desktopHold.timer);
    desktopHold.timer = null;
  }

  function beginDesktopHold(event) {
    if (desktopHold.down || event.repeat) return;
    desktopHold.down = true;
    desktopHold.opened = false;
    desktopHold.code = parseDesktopChord(desktopBinding()).code;
    debug.desktopHeld = true;
    debug.lastInput = 'desktop hold started';
    desktopHold.timer = setTimeout(() => {
      desktopHold.timer = null;
      if (!desktopHold.down) return;
      desktopHold.opened = openHeldWheel('keyboard');
      debug.lastInput = desktopHold.opened ? 'desktop hold opened wheel' : 'desktop hold open blocked';
      updateAdapterDebug();
    }, holdMs());
    updateAdapterDebug();
  }

  function finishDesktopHold(event, cancel = false) {
    if (!desktopHold.down || event.code !== desktopHold.code) return false;
    desktopHold.down = false;
    debug.desktopHeld = false;
    clearDesktopTimer();
    const shouldClose = desktopHold.opened || wheelIsOpen();
    desktopHold.opened = false;
    desktopHold.code = null;
    if (shouldClose) wheelApi()?.close?.(!cancel);
    debug.lastInput = cancel ? 'desktop hold cancelled' : shouldClose ? 'desktop release committed' : 'desktop tap ignored';
    updateAdapterDebug();
    return true;
  }

  function onKeyDown(event) {
    if (!matchesDesktopBinding(event, desktopBinding())) return;
    beginDesktopHold(event);
    claim(event); // Registered before SocialActionWheel.boot(), so this replaces its immediate-open desktop path.
  }

  function onKeyUp(event) {
    if (!desktopHold.down || event.code !== desktopHold.code) return;
    finishDesktopHold(event, false);
    claim(event);
  }

  function onWheel(event) {
    if (!desktopHold.down) return;
    clearDesktopTimer();
    if (!desktopHold.opened) desktopHold.opened = openHeldWheel('keyboard'); // A wheel notch while held opens immediately, matching the Q item selector.
    if (desktopHold.opened) cycleSelectionFromWheel(event.deltaY);
    claim(event);
  }

  function socialButtonFromEvent(event) {
    const target = event.target;
    if (target?.id === 'btnSocialActions') return target;
    return target?.closest?.('#btnSocialActions') || null;
  }

  function clearMobileTimer() {
    if (!mobileHold.timer) return;
    clearTimeout(mobileHold.timer);
    mobileHold.timer = null;
  }

  function resetMobileHold(cancel = true) {
    clearMobileTimer();
    if (mobileHold.opened && wheelIsOpen()) wheelApi()?.close?.(!cancel);
    mobileHold.pointerId = null;
    mobileHold.opened = false;
    debug.mobileHeld = false;
    updateAdapterDebug();
  }

  function onPointerDown(event) {
    if (!socialButtonFromEvent(event) || mobileHold.pointerId !== null) return;
    mobileHold.pointerId = event.pointerId;
    mobileHold.opened = false;
    mobileHold.x = event.clientX;
    mobileHold.y = event.clientY;
    debug.mobileHeld = true;
    debug.lastInput = 'mobile hold started';
    mobileHold.timer = setTimeout(() => {
      mobileHold.timer = null;
      if (mobileHold.pointerId === null) return;
      mobileHold.opened = openHeldWheel('mobile');
      debug.lastInput = mobileHold.opened ? 'mobile hold opened wheel' : 'mobile hold open blocked';
      updateAdapterDebug();
    }, holdMs());
    updateAdapterDebug();
    claim(event); // Prevents the older tap-to-latch target listeners from seeing this pointer sequence.
  }

  function onPointerMove(event) {
    if (event.pointerId !== mobileHold.pointerId) return;
    mobileHold.x = event.clientX;
    mobileHold.y = event.clientY;
    if (mobileHold.opened) dispatchSelectionPoint(event.clientX, event.clientY);
    claim(event);
  }

  function onPointerUp(event) {
    if (event.pointerId !== mobileHold.pointerId) return;
    clearMobileTimer();
    if (mobileHold.opened) {
      dispatchSelectionPoint(event.clientX, event.clientY);
      wheelApi()?.close?.(true);
      debug.lastInput = 'mobile release committed';
    } else {
      debug.lastInput = 'mobile tap ignored'; // Held selection controls have no separate social-action tap behavior.
    }
    mobileHold.pointerId = null;
    mobileHold.opened = false;
    debug.mobileHeld = false;
    updateAdapterDebug();
    claim(event);
  }

  function onPointerCancel(event) {
    if (event.pointerId !== mobileHold.pointerId) return;
    debug.lastInput = 'mobile hold cancelled';
    resetMobileHold(true);
    claim(event);
  }

  function onBlur() {
    if (desktopHold.down) {
      const fakeRelease = { code: desktopHold.code };
      finishDesktopHold(fakeRelease, true);
    }
    if (mobileHold.pointerId !== null) resetMobileHold(true);
  }

  function injectHudSkin() {
    if (document.getElementById('socialActionWheelArchSkin')) return;
    const style = document.createElement('style');
    style.id = 'socialActionWheelArchSkin';
    style.textContent = `
#socialActionOverlay{background:rgba(0,0,0,.42)!important}
#socialActionWheel{
  background:var(--glass)!important;
  border:2px solid var(--border-bright)!important;
  backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;
  box-shadow:0 3px 18px rgba(0,0,0,.48)!important;
}
.socialActionSector{background:transparent!important}
.socialActionSector.active{background:rgba(249,226,138,.075)!important}
.socialActionSector .socialActionLabel{
  width:clamp(54px,9vmin,68px)!important;height:clamp(54px,9vmin,68px)!important;
  box-sizing:border-box;border-radius:50%;padding:5px!important;
  background:var(--glass)!important;border:2px solid var(--border-bright)!important;
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  color:var(--text)!important;
  font:600 6.5px/1.05 'KhymeryyanRomanLetters+Numbers','Pixelify Sans',monospace!important;
  letter-spacing:.04em;text-transform:uppercase;text-shadow:0 1px 4px rgba(0,0,0,.9)!important;
  box-shadow:0 3px 14px rgba(0,0,0,.45);
  scale:1;transition:scale .08s,background .08s,border-color .08s;
}
.socialActionSector.active .socialActionLabel{
  background:rgba(249,226,138,.18)!important;border-color:rgba(249,226,138,.6)!important;scale:1.18;
}
.socialActionSector .socialActionIcon{font-size:1.4em!important;line-height:1!important;margin:0!important;color:var(--text)!important}
#socialActionWheelCenter{
  width:28%!important;height:28%!important;padding:8px!important;
  background:var(--glass-2)!important;border:2px solid var(--border-bright)!important;
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  box-shadow:0 3px 14px rgba(0,0,0,.45)!important;
  color:var(--text)!important;
  font:600 8px/1.15 'KhymeryyanRomanLetters+Numbers','Pixelify Sans',monospace!important;
  letter-spacing:.05em;text-transform:uppercase;
}
#socialActionWheelDebug{
  border:1px solid var(--border-bright)!important;border-radius:10px!important;
  background:var(--glass-2)!important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  color:var(--muted)!important;font:9px/1.3 'DM Mono',monospace!important;
  box-shadow:0 3px 12px rgba(0,0,0,.35);
}
#socialActionWheelDebug::after{content:attr(data-arch-adapter);display:block;margin-top:3px;color:rgba(249,226,138,.72)}
`;
    document.head.appendChild(style);
  }

  function updateAdapterDebug() {
    const output = document.getElementById('socialActionWheelDebug');
    if (output) {
      output.dataset.archAdapter = `Arch controls | desktop:${debug.desktopHeld ? 'held' : 'idle'} mobile:${debug.mobileHeld ? 'held' : 'idle'} wheelSteps:${debug.wheelSteps} | ${debug.lastInput || 'ready'}`;
    }
  }

  function finishBoot() {
    injectHudSkin();
    updateAdapterDebug();
  }

  // Install the input interceptors immediately. social-action-wheel.js is
  // parsed just before this adapter and defers its own keyboard listeners to
  // DOMContentLoaded, so these capture listeners become authoritative first.
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerCancel, true);
  window.addEventListener('blur', onBlur);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', finishBoot, { once: true });
  else finishBoot();

  window.SocialActionWheelArchAdapter = Object.freeze({
    installed: true,
    getDebug: () => ({ ...debug, holdMs: holdMs(), desktopBinding: desktopBinding(), wheelOpen: wheelIsOpen() }),
  });
})();
