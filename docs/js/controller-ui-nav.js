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
  const REPEAT_INITIAL_MS = 380;
  const REPEAT_RATE_MS = 140;
  const BTN_CONFIRM = 0;   // A
  const BTN_CANCEL = 1;    // B
  const BTN_TAB_PREV = 4;  // LB
  const BTN_TAB_NEXT = 5;  // RB
  const BTN_OPEN_MENU = 8; // Back/Select — unbound in gameplay, free for this
  const BTN_DPAD_UP = 12, BTN_DPAD_DOWN = 13, BTN_DPAD_LEFT = 14, BTN_DPAD_RIGHT = 15;

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
    if (btn) btn.click();
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
    const hasCancel = !!panel.querySelector('[data-ctrl-cancel]');
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
    const pad = Array.from(pads).find(Boolean);
    if (!pad) { prevButtons.clear(); menuOpenEdge = false; return; }
    padEverSeen = true;

    if (!isActive()) {
      // Nothing to navigate — the only job left is offering a way to open
      // the pause menu at all from a controller with no keyboard nearby.
      const openDown = !!pad.buttons[BTN_OPEN_MENU]?.pressed;
      if (openDown && !menuOpenEdge) document.getElementById('menuBtn')?.click();
      menuOpenEdge = openDown;
      prevButtons.clear();
      return;
    }
    menuOpenEdge = false;

    now = now || performance.now();
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    pollDirection('left', ax <= -DEADZONE || !!pad.buttons[BTN_DPAD_LEFT]?.pressed, now, () => move('left'));
    pollDirection('right', ax >= DEADZONE || !!pad.buttons[BTN_DPAD_RIGHT]?.pressed, now, () => move('right'));
    pollDirection('up', ay <= -DEADZONE || !!pad.buttons[BTN_DPAD_UP]?.pressed, now, () => move('up'));
    pollDirection('down', ay >= DEADZONE || !!pad.buttons[BTN_DPAD_DOWN]?.pressed, now, () => move('down'));

    const down = new Set();
    pad.buttons.forEach((b, i) => { if (b?.pressed) down.add(i); });
    const pressed = i => down.has(i) && !prevButtons.has(i);
    if (pressed(BTN_CONFIRM)) activate();
    if (pressed(BTN_CANCEL)) cancel();
    if (pressed(BTN_TAB_PREV)) cycleTabs(-1);
    if (pressed(BTN_TAB_NEXT)) cycleTabs(1);
    prevButtons = down;
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
      case 'ArrowLeft': move('left'); break;
      case 'ArrowRight': move('right'); break;
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
        case 'up': case 'down': case 'left': case 'right': move(action); break;
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
