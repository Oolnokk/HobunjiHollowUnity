(() => {
  'use strict';

  // Universal controller (gamepad) navigation for every floating menu/panel
  // in the game — the pause menu and every one of its tabs (Inventory,
  // Crafting, the shop/Alchemy panes, Settings, ...), NPC dialogue and its
  // choice buttons, the hearth/campfire cooking UI, the clothing dye panel,
  // the house layout modal, and any panel built after this file was written.
  //
  // How a new panel opts in (this is the whole contract — nothing else to
  // wire up):
  //   data-ctrl-panel   on the panel/modal's root element. Any element
  //                     carrying this attribute is watched for visibility
  //                     (display/opacity/visibility, whatever mechanism the
  //                     panel already uses to show/hide itself — this file
  //                     never needs to know which). The instant it becomes
  //                     visible it's pushed onto a panel stack and gets
  //                     controller focus; the instant it's hidden again it's
  //                     popped and focus returns to whatever's under it.
  //   data-ctrl-cancel  optional, on the panel's own close/back/leave
  //                     button. Gamepad B (and keyboard) clicks it.
  //   data-ctrl-tabs    optional, on a row of sibling tab/category buttons
  //                     (e.g. the pause menu's own top tab bar). Gamepad
  //                     LB/RB (and Tab/Shift+Tab) step through its children.
  //   data-ctrl-default optional, on the element that should receive focus
  //                     first. Unset panels just focus the topmost-leftmost
  //                     focusable thing instead (or whatever already has
  //                     real DOM focus, e.g. an auto-focused search box).
  //   data-ctrl-item    optional, opts a non-natively-interactive element
  //                     (a plain <div> with an onclick, say) into
  //                     navigation. Real buttons/links/inputs/[role=button]/
  //                     [tabindex] are discovered automatically — most
  //                     panels in this game need this on precisely nothing,
  //                     since almost everything here is already a <button>.
  //   data-ctrl-skip    optional, the opposite of data-ctrl-item — pulls an
  //                     otherwise-focusable element (or an especially risky
  //                     one, e.g. the pause menu's "reset farm" button) out
  //                     of controller navigation.
  //
  // Self-contained on purpose, same as ui-element-editor.js/cooking-system.js
  // etc.: no dependency on game.js internals. The one line of coupling runs
  // the other direction — game.js's own pollControllerInput() checks
  // window.ControllerUI.isActive() and stands down for the frame so the two
  // don't fight over the same button presses.

  const PANEL_SELECTOR = '[data-ctrl-panel]';
  const TABS_SELECTOR = '[data-ctrl-tabs]';
  const NAV_SELECTOR = [
    'button', 'a[href]', 'input', 'select', 'textarea',
    '[role="button"]', '[tabindex]', '[data-ctrl-item]',
  ].join(', ');
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'number', 'password', 'tel', 'date', 'time', 'datetime-local', 'month', 'week']);

  const DEADZONE = Number(window.SCRATCHBONES_CONFIG?.game?.input?.gamepadDeadzone) || 0.5;
  const NAV_PRESS = Number(window.SCRATCHBONES_CONFIG?.game?.input?.axisPressThreshold) || 0.55;
  const REPEAT_INITIAL_MS = 380;
  const REPEAT_RATE_MS = 140;
  const UI_ACTIONS = Object.freeze({
    open: 'uiOpenMenu', confirm: 'uiConfirm', cancel: 'uiCancel', tabPrev: 'uiTabPrev', tabNext: 'uiTabNext',
    up: 'uiUp', down: 'uiDown', left: 'uiLeft', right: 'uiRight',
  }); // Used to keep every discrete menu action routed through the configurable controller binding layer.

  function configuredControllerBinding(actionId) {
    const currentBindings = window.InputBindings?.getCurrentBindings?.()?.controller; // Used to prefer the player's saved binding, including an explicit Unbound value.
    if (currentBindings && Object.prototype.hasOwnProperty.call(currentBindings, actionId)) return currentBindings[actionId];
    const actionDefinition = window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find(action => action.id === actionId); // Used as the shipped fallback before saved bindings have initialized.
    return actionDefinition?.controller || null;
  }

  function controllerActionDown(gamepad, actionId) {
    const bindingCode = configuredControllerBinding(actionId); // Used to resolve this menu action without relying on a physical Gamepad button index.
    return window.ControllerInput?.isBindingPressed?.(gamepad, bindingCode, { stickThreshold: NAV_PRESS }) || false;
  }

  // ── visibility ──────────────────────────────────────────────────────
  // Panels in this game hide themselves three different ways (display:none
  // toggled by a class, opacity+pointer-events fade, or plain aria-hidden
  // semantics layered on one of the other two) — rather than special-case
  // each, walk the ancestor chain checking the actual rendered result, the
  // same technique ui-element-editor.js already uses to see through a
  // closed-but-still-laid-out modal.
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      node = node.parentElement;
    }
    return true;
  }

  function isDisabled(el) {
    return !!(el.disabled || el.getAttribute?.('aria-disabled') === 'true');
  }

  function isTextEditable(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
    return false;
  }

  // ── panel stack ─────────────────────────────────────────────────────
  let stack = [];
  const lastFocusedByPanel = new WeakMap();
  let currentTarget = null;

  function visiblePanels() {
    return Array.from(document.querySelectorAll(PANEL_SELECTOR)).filter(isVisible);
  }

  function activePanel() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  // Reconciling is cheap (a handful of tagged panels at most) and every
  // caller — game.js's per-frame gate, our own keydown handler, external
  // test hooks — wants an up-to-the-instant answer rather than whatever the
  // last background poll tick happened to see, so just check fresh every
  // time instead of trusting a cached stack between ticks.
  function isActive() {
    reconcileStack();
    return stack.length > 0;
  }

  function reconcileStack() {
    const current = visiblePanels();
    const currentSet = new Set(current);
    const prevTop = activePanel();

    stack = stack.filter(p => currentSet.has(p));
    for (const p of current) {
      if (!stack.includes(p)) stack.push(p);
    }

    const newTop = activePanel();
    if (newTop !== prevTop) {
      if (prevTop) lastFocusedByPanel.set(prevTop, currentTarget);
      if (newTop) activatePanel(newTop);
      else deactivateAll();
      if (!prevTop && newTop) window.dispatchEvent(new CustomEvent('hobunji-controller-owner-change', { detail: { owner: 'menu' } }));
      if (prevTop && !newTop) window.dispatchEvent(new CustomEvent('hobunji-controller-owner-change', { detail: { owner: 'gameplay' } }));
    }
  }

  function activatePanel(panel) {
    updateHintBar(panel);
    // A real mouse click leaves its target as document.activeElement even
    // after the panel closes around it (nothing blurs it), so a panel
    // closed by clicking its own close button would otherwise "remember"
    // that close button and hand it right back as next open's starting
    // focus — one A press later the panel closes itself again before the
    // player can do anything. Same reasoning as pickDefaultTarget's own
    // cancel-avoidance below, just needed here too since these two
    // fast-paths bypass it.
    const notCancel = el => el && !el.hasAttribute('data-ctrl-cancel') && el;
    const remembered = lastFocusedByPanel.get(panel);
    const startFocus =
      notCancel(document.activeElement && panel.contains(document.activeElement) && isNavTarget(document.activeElement) && document.activeElement)
      || notCancel(remembered && panel.contains(remembered) && isVisible(remembered) && !isDisabled(remembered) && remembered)
      || pickDefaultTarget(panel);
    setFocus(startFocus, { scroll: false });
  }

  function deactivateAll() {
    setFocus(null);
    hideHintBar();
  }

  // ── target discovery ────────────────────────────────────────────────
  function isNavTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[data-ctrl-skip]')) return false;
    if (isDisabled(el)) return false;
    if (el.hasAttribute('tabindex') && Number(el.getAttribute('tabindex')) < 0 && !el.hasAttribute('data-ctrl-item')) return false;
    return isVisible(el);
  }

  function targetsInPanel(panel) {
    return Array.from(panel.querySelectorAll(NAV_SELECTOR)).filter(isNavTarget);
  }

  function pickDefaultTarget(panel) {
    const explicit = panel.querySelector('[data-ctrl-default]');
    if (explicit && isNavTarget(explicit)) return explicit;
    const targets = targetsInPanel(panel);
    // Never default-focus the panel's own close/cancel button — a stray A
    // press on first opening a panel shouldn't be able to instantly back
    // back out of it again.
    const preferred = targets.filter(el => !el.hasAttribute('data-ctrl-cancel'));
    const pool = preferred.length ? preferred : targets;
    if (!pool.length) return null;
    return pool.reduce((best, el) => {
      if (!best) return el;
      const a = el.getBoundingClientRect(), b = best.getBoundingClientRect();
      if (Math.abs(a.top - b.top) > 4) return a.top < b.top ? el : best;
      return a.left < b.left ? el : best;
    }, null);
  }

  // ── focus application ───────────────────────────────────────────────
  function setFocus(el, opts = {}) {
    if (currentTarget && currentTarget !== el) currentTarget.classList.remove('ctrl-nav-focus');
    currentTarget = el || null;
    if (!currentTarget) return;
    currentTarget.classList.add('ctrl-nav-focus');
    if (!currentTarget.hasAttribute('tabindex') && currentTarget.tabIndex < 0) currentTarget.tabIndex = -1;
    try { currentTarget.focus({ preventScroll: true }); } catch { /* not every candidate supports real focus */ }
    if (opts.scroll !== false) {
      try { currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
    }
  }

  function refreshFocusIfStale() {
    const panel = activePanel();
    if (!panel) return;
    if (currentTarget && isNavTarget(currentTarget) && panel.contains(currentTarget)) return;
    setFocus(pickDefaultTarget(panel));
  }

  // ── spatial navigation ──────────────────────────────────────────────
  function isInDirection(curRect, candRect, dir) {
    const eps = 1;
    switch (dir) {
      case 'right': return candRect.left >= curRect.left + eps;
      case 'left': return candRect.right <= curRect.right - eps;
      case 'down': return candRect.top >= curRect.top + eps;
      case 'up': return candRect.bottom <= curRect.bottom - eps;
      default: return false;
    }
  }

  function directionScore(curRect, candRect, dir) {
    const curCX = curRect.left + curRect.width / 2, curCY = curRect.top + curRect.height / 2;
    const candCX = candRect.left + candRect.width / 2, candCY = candRect.top + candRect.height / 2;
    let primary, perpendicular;
    if (dir === 'left' || dir === 'right') { primary = Math.abs(candCX - curCX); perpendicular = Math.abs(candCY - curCY); }
    else { primary = Math.abs(candCY - curCY); perpendicular = Math.abs(candCX - curCX); }
    return primary + perpendicular * 2.2;
  }

  function move(dir) {
    const panel = activePanel();
    if (!panel) return;
    refreshFocusIfStale();
    const targets = targetsInPanel(panel);
    if (!targets.length) return;
    if (!currentTarget) { setFocus(pickDefaultTarget(panel)); return; }
    const curRect = currentTarget.getBoundingClientRect();
    let best = null, bestScore = Infinity;
    for (const cand of targets) {
      if (cand === currentTarget) continue;
      const candRect = cand.getBoundingClientRect();
      if (!isInDirection(curRect, candRect, dir)) continue;
      const score = directionScore(curRect, candRect, dir);
      if (score < bestScore) { bestScore = score; best = cand; }
    }
    if (best) setFocus(best);
  }

  function dispatchControlChange(control) {
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function adjustFocusedControl(delta) {
    refreshFocusIfStale();
    const control = currentTarget;
    if (!control) return false;
    if (control.tagName === 'SELECT') {
      const enabledOptions = Array.from(control.options || []).filter(option => !option.disabled); // Used to keep controller adjustment out of disabled placeholder choices.
      const current = enabledOptions.indexOf(control.options[control.selectedIndex]);
      if (!enabledOptions.length) return false;
      const next = enabledOptions[Math.max(0, Math.min(enabledOptions.length - 1, (current < 0 ? 0 : current) + delta))]; // Used for deterministic left/right select changes without opening a mouse-oriented native picker.
      if (!next || next === control.options[control.selectedIndex]) return true;
      control.value = next.value;
      dispatchControlChange(control);
      return true;
    }
    if (control.tagName === 'INPUT' && (control.type === 'range' || control.type === 'number')) {
      const step = control.step && control.step !== 'any' ? Number(control.step) : 1; // Used to respect the same granularity mouse/keyboard users receive.
      const min = control.min === '' ? -Infinity : Number(control.min);
      const max = control.max === '' ? Infinity : Number(control.max);
      const next = Math.max(min, Math.min(max, (Number(control.value) || 0) + (Number.isFinite(step) ? step : 1) * delta));
      control.value = String(next);
      dispatchControlChange(control);
      return true;
    }
    return false;
  }

  function moveOrAdjust(dir) {
    const delta = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    if (delta && adjustFocusedControl(delta)) return;
    move(dir);
  }

  // ── activate / cancel / tabs ────────────────────────────────────────
  function activate() {
    const panel = activePanel();
    if (!panel) return;
    refreshFocusIfStale();
    if (!currentTarget) return;
    if (currentTarget.tagName === 'SELECT') { currentTarget.focus(); return; }
    if (isTextEditable(currentTarget)) { currentTarget.blur(); return; }
    if (currentTarget.tagName === 'INPUT' && (currentTarget.type === 'checkbox' || currentTarget.type === 'radio')) {
      currentTarget.click();
      return;
    }
    currentTarget.click();
  }

  function cancel() {
    const panel = activePanel();
    if (!panel) return;
    const btn = Array.from(panel.querySelectorAll('[data-ctrl-cancel]')).find(isNavTarget);
    if (btn) { btn.click(); return; }
    // Panels added later occasionally omit data-ctrl-cancel. Give B a safe,
    // universal fallback through the same Escape path their keyboard close
    // handlers already support rather than leaving controller users trapped.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }

  function findTabGroup(panel) {
    const groups = Array.from(panel.querySelectorAll(TABS_SELECTOR));
    if (!groups.length) return null;
    if (currentTarget) {
      const containing = groups.find(g => g.contains(currentTarget));
      if (containing) return containing;
    }
    return groups[0];
  }

  function cycleTabs(delta) {
    const panel = activePanel();
    if (!panel) return;
    const group = findTabGroup(panel);
    if (!group) return;
    const items = Array.from(group.children).filter(el => isNavTarget(el) || (el.matches?.(NAV_SELECTOR) && isVisible(el) && !isDisabled(el)));
    if (!items.length) return;
    let idx = items.findIndex(el => el === currentTarget || el.classList.contains('active'));
    if (idx < 0) idx = 0;
    const next = items[(idx + delta + items.length) % items.length];
    next.click();
    setFocus(next);
  }

  // ── on-screen button hint bar ───────────────────────────────────────
  let hintEl = null;
  function ensureHintEl() {
    if (hintEl) return hintEl;
    hintEl = document.createElement('div');
    hintEl.className = 'ctrl-nav-hint-bar';
    hintEl.setAttribute('aria-hidden', 'true');
    hintEl.innerHTML =
      '<span class="ctrl-nav-hint"><span class="ctrl-nav-glyph ctrl-nav-glyph-a">A</span>Select</span>' +
      '<span class="ctrl-nav-hint"><span class="ctrl-nav-glyph ctrl-nav-glyph-b">B</span>Back</span>' +
      '<span class="ctrl-nav-hint ctrl-nav-hint-tabs"><span class="ctrl-nav-glyph">LB/RB</span>Switch Tabs</span>';
    document.body.appendChild(hintEl);
    return hintEl;
  }

  let padEverSeen = false;
  window.addEventListener('gamepadconnected', () => { padEverSeen = true; updateHintBar(activePanel()); });

  function updateHintBar(panel) {
    if (!panel || !padEverSeen) { hideHintBar(); return; }
    const el = ensureHintEl();
    el.classList.toggle('ctrl-nav-hint-bar-visible', true);
    const hasTabs = !!panel.querySelector(TABS_SELECTOR);
    const hasCancel = true; // B always works: explicit close button first, universal Escape fallback otherwise.
    el.querySelector('.ctrl-nav-hint-tabs').style.display = hasTabs ? '' : 'none';
    const bBtn = el.querySelectorAll('.ctrl-nav-hint')[1];
    if (bBtn) bBtn.style.display = hasCancel ? '' : 'none';
  }

  function hideHintBar() {
    if (hintEl) hintEl.classList.remove('ctrl-nav-hint-bar-visible');
  }

  // ── gamepad polling (always running — cheap when idle) ─────────────
  const dirState = { up: mkDirState(), down: mkDirState(), left: mkDirState(), right: mkDirState() };
  function mkDirState() { return { down: false, next: 0 }; }
  function pollDirection(name, isDown, now, fire) {
    const st = dirState[name];
    if (isDown) {
      if (!st.down) { st.down = true; st.next = now + REPEAT_INITIAL_MS; fire(); }
      else if (now >= st.next) { st.next = now + REPEAT_RATE_MS; fire(); }
    } else {
      st.down = false;
    }
  }

  let prevButtons = new Set();
  let menuOpenEdge = false;
  let lastReconcileAt = 0;
  let lastGamepadPollAt = 0; // Used to keep analog right-stick menu scrolling independent of display refresh rate.
  const RECONCILE_POLL_MS = 120;

  function pollGamepad(now) {
    requestAnimationFrame(pollGamepad);
    // Panels in this game mostly close via a CSS opacity transition (e.g.
    // #menuPanel's `transition: opacity 0.2s`), not an instant display:none
    // — the MutationObserver below fires the instant the class/attribute
    // changes, which is mid-transition, so isVisible() can still read a
    // not-quite-zero opacity right then and miss the close entirely with
    // nothing left to ever re-check it. A cheap periodic re-check (this
    // already-always-running frame loop) closes that gap without giving up
    // the MutationObserver's instant response for ordinary display:none
    // toggles, which have no such lag.
    if (!now || now - lastReconcileAt >= RECONCILE_POLL_MS) {
      lastReconcileAt = now || performance.now();
      reconcileStack();
    }
    if (!document.hasFocus()) return;
    const pads = navigator.getGamepads?.() || [];
    const pad = window.ControllerInput?.pickActiveGamepad?.(pads, pollGamepad.activePadIndex) || Array.from(pads).find(Boolean);
    if (!pad) { prevButtons.clear(); menuOpenEdge = false; return; }
    pollGamepad.activePadIndex = pad.index; // Keeps navigation on one pad until another receives deliberate input.
    padEverSeen = true;

    if (window.InputSettingsPanel?.isControllerListening?.()) {
      prevButtons.clear();
      menuOpenEdge = false;
      return;
    }

    if (!isActive()) {
      // Nothing to navigate — the only job left is offering a way to open
      // the pause menu at all from a controller with no keyboard nearby.
      const openDown = controllerActionDown(pad, UI_ACTIONS.open); // Used to let the configured Menu Open/Close action own this edge instead of a fixed View/Share button.
      if (openDown && !menuOpenEdge) {
        document.getElementById('menuBtn')?.click();
        prevButtons = new Set([UI_ACTIONS.open]); // Prevents the same held configured open press from immediately closing the menu on its next active frame.
      } else if (!openDown) prevButtons.clear();
      menuOpenEdge = openDown;
      return;
    }
    menuOpenEdge = false;

    now = now || performance.now();
    const navStick = window.ControllerInput?.normalizeStick?.(pad.axes[0], pad.axes[1], DEADZONE, 1) || { x: pad.axes[0] || 0, y: pad.axes[1] || 0 };
    const rawAx = Number(pad.axes[0]) || 0, rawAy = Number(pad.axes[1]) || 0; // Used for predictable digital navigation thresholds while navStick remains the diagnostic/analog value.
    pollDirection('left', rawAx <= -NAV_PRESS || controllerActionDown(pad, UI_ACTIONS.left), now, () => moveOrAdjust('left'));
    pollDirection('right', rawAx >= NAV_PRESS || controllerActionDown(pad, UI_ACTIONS.right), now, () => moveOrAdjust('right'));
    pollDirection('up', rawAy <= -NAV_PRESS || controllerActionDown(pad, UI_ACTIONS.up), now, () => move('up'));
    pollDirection('down', rawAy >= NAV_PRESS || controllerActionDown(pad, UI_ACTIONS.down), now, () => move('down'));
    const scrollStick = window.ControllerInput?.normalizeStick?.(pad.axes[2], pad.axes[3], DEADZONE, 1.3) || { y: 0 };
    window.dispatchEvent(new CustomEvent('hobunji-controller-ui-snapshot', { detail: { pad, move: navStick, look: scrollStick } })); // Keeps the in-game debug line live while paused gameplay polling is suspended.
    const scrollDt = lastGamepadPollAt ? Math.min(0.05, Math.max(0, (now - lastGamepadPollAt) / 1000)) : 1 / 60; // Caps resume spikes after a backgrounded tab.
    lastGamepadPollAt = now;
    if (Math.abs(scrollStick.y) > 0.02) {
      const panel = activePanel();
      let scrollHost = currentTarget;
      while (scrollHost && scrollHost !== panel && scrollHost.scrollHeight <= scrollHost.clientHeight) scrollHost = scrollHost.parentElement;
      if (!scrollHost || !panel?.contains(scrollHost) || scrollHost.scrollHeight <= scrollHost.clientHeight) {
        scrollHost = panel ? Array.from(panel.querySelectorAll('.mp-pane, .settings-pane, .cooking-body')).find(element => element.scrollHeight > element.clientHeight) : null;
      }
      scrollHost ||= panel; // Used to scroll the nearest useful menu region with the right stick without scanning every descendant each frame.
      if (scrollHost) scrollHost.scrollTop += scrollStick.y * 720 * scrollDt;
    }

    const downActions = new Set(Object.values(UI_ACTIONS).filter(actionId => controllerActionDown(pad, actionId))); // Used as semantic edge state so remapping never depends on physical Gamepad indices.
    const actionPressed = actionId => downActions.has(actionId) && !prevButtons.has(actionId); // Used to edge-trigger menu actions once per configured press.
    if (actionPressed(UI_ACTIONS.confirm)) activate();
    if (actionPressed(UI_ACTIONS.cancel)) cancel();
    if (actionPressed(UI_ACTIONS.tabPrev)) cycleTabs(-1);
    if (actionPressed(UI_ACTIONS.tabNext)) cycleTabs(1);
    if (actionPressed(UI_ACTIONS.open)) cancel();
    prevButtons = downActions;
  }
  requestAnimationFrame(pollGamepad);

  // ── keyboard (arrow-key nav + Enter/Tab) ────────────────────────────
  // Registered on the capture phase so it runs (and can stop propagation)
  // before game.js's own bubble-phase keydown handler ever sees the event
  // — the same technique cooking-system.js already uses for its Escape
  // handling. Escape itself is deliberately left untouched: every panel in
  // this game already closes correctly on Escape via its own handler.
  window.addEventListener('keydown', (event) => {
    if (!isActive()) return;
    if (isTextEditable(document.activeElement)) return;
    switch (event.key) {
      case 'ArrowUp': move('up'); break;
      case 'ArrowDown': move('down'); break;
      case 'ArrowLeft': moveOrAdjust('left'); break;
      case 'ArrowRight': moveOrAdjust('right'); break;
      case 'Enter': case ' ': activate(); break;
      case 'Tab': cycleTabs(event.shiftKey ? -1 : 1); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // Keep the tracked focus target in sync with real mouse/touch clicks too,
  // so switching input devices mid-session (controller ↔ mouse) never
  // leaves the highlighted target pointing somewhere stale.
  document.addEventListener('focusin', (event) => {
    const panel = activePanel();
    if (panel && panel.contains(event.target) && isNavTarget(event.target)) {
      if (currentTarget && currentTarget !== event.target) currentTarget.classList.remove('ctrl-nav-focus');
      currentTarget = event.target;
      currentTarget.classList.add('ctrl-nav-focus');
    }
  }, true);

  // ── panel discovery: MutationObserver (open/close via class/style/attr) ──
  const observer = new MutationObserver(() => reconcileStack());
  function startObserving() {
    observer.observe(document.body, {
      attributes: true, attributeFilter: ['class', 'style', 'aria-hidden', 'hidden'],
      subtree: true, childList: true,
    });
  }
  function boot() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    startObserving();
    reconcileStack();
  }
  boot();

  window.ControllerUI = {
    isActive,
    activePanel,
    focusedElement: () => currentTarget,
    // Test/debug seams — let headless verification drive navigation without
    // faking the full Gamepad API.
    press(action) {
      reconcileStack();
      switch (action) {
        case 'up': case 'down': move(action); break;
        case 'left': case 'right': moveOrAdjust(action); break;
        case 'confirm': activate(); break;
        case 'cancel': cancel(); break;
        case 'tabPrev': cycleTabs(-1); break;
        case 'tabNext': cycleTabs(1); break;
      }
    },
    debugState() {
      reconcileStack();
      const panel = activePanel();
      return {
        stackDepth: stack.length,
        panelId: panel?.id || panel?.className || null,
        targetTag: currentTarget?.tagName || null,
        targetId: currentTarget?.id || null,
        targetText: (currentTarget?.textContent || '').trim().slice(0, 40),
      };
    },
  };
})();
