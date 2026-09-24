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
  //   data-ctrl-panel   on the panel/modal's root element, OR standard modal
  //                     semantics role="dialog" aria-modal="true". Semantic
  //                     dialogs are discovered automatically unless nested
  //                     inside an explicit data-ctrl-panel owner.
  //                     Visible panels are watched for display/opacity/
  //                     visibility changes; the instant one becomes visible
  //                     it gets controller focus, and focus returns to the
  //                     underlying panel when it closes.
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

  const EXPLICIT_PANEL_SELECTOR = '[data-ctrl-panel]';
  const SEMANTIC_PANEL_SELECTOR = '[role="dialog"][aria-modal="true"]';
  const PANEL_SELECTOR = `${EXPLICIT_PANEL_SELECTOR}, ${SEMANTIC_PANEL_SELECTOR}`;
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
  const CONE_HALF_ANGLE = 34 * Math.PI / 180; // Narrow first-pass intent cone cast from the focused control's center along the physical stick vector.
  const WIDE_CONE_HALF_ANGLE = 58 * Math.PI / 180; // One forgiving retry before falling back to the forward half-plane, preventing dead ends in irregular layouts.
  const CONE_EDGE_FORGIVENESS = 12; // Pixels added around candidate bounds so wide/short controls can be hit by the cone even when their center sits just outside it.
  const STICK_DIRECTION_RESET_COS = Math.cos(25 * Math.PI / 180); // A deliberate ~25° direction change while held counts as a fresh navigation gesture instead of waiting for repeat.
  const UI_ACTIONS = Object.freeze({
    open: 'uiOpenMenu', confirm: 'uiConfirm', cancel: 'uiCancel', tabPrev: 'uiTabPrev', tabNext: 'uiTabNext',
    up: 'uiUp', down: 'uiDown', left: 'uiLeft', right: 'uiRight',
  }); // Used to keep every discrete menu action routed through the configurable controller binding layer.

  function configuredControllerBinding(actionId) {
    const currentBindings = window.InputBindings?.getCurrentBindings?.()?.controller; // Used to prefer the player's saved binding, including an explicit Unbound value.
    if (currentBindings && Object.prototype.hasOwnProperty.call(currentBindings, actionId)) return currentBindings[actionId];
    const defaults = window.InputBindings?.getDefaultBindings?.('controller'); // Keeps controller-only action schema/defaults owned by InputBindings.
    return defaults && Object.prototype.hasOwnProperty.call(defaults, actionId) ? defaults[actionId] : null;
  }

  // Reads this frame's shared analog snapshot rather than re-deriving each
  // action's value from the raw Gamepad object on every call.
  function controllerActionDown(frame, actionId) {
    const bindingCode = configuredControllerBinding(actionId); // Used to resolve this menu action without relying on a physical Gamepad button index.
    return Boolean(bindingCode) && frame.isDown(bindingCode, { stickThreshold: NAV_PRESS });
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
  const knownPanels = new Set(); // Reused by visibility reconciliation so gameplay never scans the entire DOM for panel roots.
  let currentTarget = null;

  // Registered panel roots are ordinarily appended directly to <body>, so
  // unlike isVisible() above — which has to walk ancestors for a nav target
  // that can sit many levels deep inside a hidden .mp-pane — checking the
  // panel's own computed style is already the full answer, no ancestor walk
  // needed. Reconciliation is mutation-driven; isActive() itself stays a
  // constant-time hot-path read.
  function panelVisible(el) {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function visiblePanels() {
    const visible = [];
    for (const panel of knownPanels) {
      if (!panel?.isConnected) {
        knownPanels.delete(panel);
        continue;
      }
      if (panelVisible(panel)) visible.push(panel);
    }
    return visible;
  }

  function activePanel() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  // This is a gameplay hot path: game.js asks every frame and controller
  // polling may ask again. Panel mutations keep `stack` current, so this read
  // must not query the DOM or force computed style/layout.
  function isActive() {
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
      // Declared through the shared registry, which emits the owner-change
      // event; nothing else needs to infer menu ownership by patching isActive.
      if (!prevTop && newTop) window.ControllerInput?.setOwner?.('menu');
      if (prevTop && !newTop && window.ControllerInput?.owner === 'menu') window.ControllerInput.setOwner('gameplay');
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

  function navigationTargets(panel) {
    // Modal dialogs own focus; otherwise visible panel roots are peers even
    // when their controls live in different DOM containers.
    const modal = panel.matches(SEMANTIC_PANEL_SELECTOR) || panel.getAttribute('aria-modal') === 'true';
    if (modal) return targetsInPanel(panel);
    const peers = visiblePanels().filter(other => !other.matches(SEMANTIC_PANEL_SELECTOR) && other.getAttribute('aria-modal') !== 'true'); // Used to gather controls across visible menu containers.
    return [...new Set(peers.flatMap(targetsInPanel))];
  }

  function belongsToNavigation(el, panel) {
    return navigationTargets(panel).includes(el);
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
    if (currentTarget && isNavTarget(currentTarget) && belongsToNavigation(currentTarget, panel)) return;
    setFocus(pickDefaultTarget(panel));
  }

  // ── spatial navigation ──────────────────────────────────────────────
  // Navigation is vector-based rather than reducing an analog throw to four
  // independent cardinal presses. Imagine a narrow invisible cone projected
  // from the current control's center along the stick direction: candidates
  // whose rectangles intersect that cone compete first, then a wider cone,
  // then the forward half-plane as a no-dead-end fallback.
  function rectCenter(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function visibleTargetRect(el) {
    const rect = el.getBoundingClientRect(); // Used as the starting screen-space bounds before scroll clipping.
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor); // Used to identify ancestors that clip descendants after scrolling.
      if (!/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) continue;
      const bounds = ancestor.getBoundingClientRect(); // Used to exclude controls outside the visible part of a scrolled section.
      left = Math.max(left, bounds.left);
      top = Math.max(top, bounds.top);
      right = Math.min(right, bounds.right);
      bottom = Math.min(bottom, bounds.bottom);
      if (right <= left || bottom <= top) return null;
    }
    return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
  }

  function rayDistance(origin, rect, dir) {
    let enter = -Infinity, exit = Infinity;
    for (const [position, velocity, min, max] of [
      [origin.x, dir.x, rect.left, rect.right],
      [origin.y, dir.y, rect.top, rect.bottom],
    ]) {
      if (Math.abs(velocity) < 1e-6) {
        if (position < min || position > max) return null;
        continue;
      }
      const near = (min - position) / velocity, far = (max - position) / velocity;
      enter = Math.max(enter, Math.min(near, far));
      exit = Math.min(exit, Math.max(near, far));
    }
    return exit >= Math.max(0, enter) ? Math.max(0, enter) : null;
  }

  function normalizedDirection(x, y) {
    const magnitude = Math.hypot(Number(x) || 0, Number(y) || 0);
    if (magnitude <= 1e-6) return null;
    return { x: (Number(x) || 0) / magnitude, y: (Number(y) || 0) / magnitude, magnitude };
  }

  function coneMetrics(curRect, candRect, dir, halfAngle) {
    const cur = rectCenter(curRect), cand = rectCenter(candRect);
    const dx = cand.x - cur.x, dy = cand.y - cur.y;
    const forward = dx * dir.x + dy * dir.y;
    if (forward <= 1) return null;
    const lateral = Math.abs(dx * -dir.y + dy * dir.x);
    const halfProjection = Math.abs(dir.y) * candRect.width * 0.5 + Math.abs(dir.x) * candRect.height * 0.5; // Candidate extent perpendicular to the ray, so the cone hits the visible rectangle rather than requiring its center inside.
    const edgeGap = Math.max(0, lateral - halfProjection);
    const coneLimit = forward * Math.tan(halfAngle) + CONE_EDGE_FORGIVENESS;
    if (edgeGap > coneLimit) return null;
    const anglePenalty = edgeGap / Math.max(1, forward); // Strongly prefers something centered on the intended ray when two controls are similarly near.
    return { forward, lateral, edgeGap, score: forward + edgeGap * 2.8 + anglePenalty * 160 };
  }

  function halfPlaneScore(curRect, candRect, dir) {
    const cur = rectCenter(curRect), cand = rectCenter(candRect);
    const dx = cand.x - cur.x, dy = cand.y - cur.y;
    const forward = dx * dir.x + dy * dir.y;
    if (forward <= 1) return null;
    const lateral = Math.abs(dx * -dir.y + dy * dir.x);
    return forward + lateral * 2.2;
  }

  function bestVectorCandidate(targets, curRect, dir, halfAngle = null) {
    let best = null, bestScore = Infinity;
    for (const cand of targets) {
      if (cand === currentTarget) continue;
      const candRect = visibleTargetRect(cand);
      if (!candRect) continue;
      const metrics = halfAngle == null
        ? { score: halfPlaneScore(curRect, candRect, dir) }
        : coneMetrics(curRect, candRect, dir, halfAngle);
      const score = metrics?.score;
      if (!Number.isFinite(score)) continue;
      if (score < bestScore) { bestScore = score; best = cand; }
    }
    return best;
  }

  function firstRayCandidate(targets, curRect, dir) {
    const origin = rectCenter(curRect); // Used as the starting point for a stick-directed screen-space ray.
    let best = null, nearest = Infinity;
    for (const cand of targets) {
      if (cand === currentTarget) continue;
      const rect = visibleTargetRect(cand); // Only the visible portion of a control may intercept the ray.
      if (!rect) continue;
      const center = rectCenter(rect); // Used to reject a control whose center is behind the selected control.
      if ((center.x - origin.x) * dir.x + (center.y - origin.y) * dir.y <= 1) continue;
      const distance = rayDistance(origin, rect, dir); // Used to select the first intersected control regardless of its container.
      if (distance !== null && distance < nearest) { nearest = distance; best = cand; }
    }
    return best;
  }

  function moveVector(x, y) {
    const panel = activePanel();
    if (!panel) return false;
    refreshFocusIfStale();
    const targets = navigationTargets(panel);
    if (!targets.length) return false;
    if (!currentTarget) { setFocus(pickDefaultTarget(panel)); return true; }
    const dir = normalizedDirection(x, y);
    if (!dir) return false;
    const curRect = visibleTargetRect(currentTarget) || currentTarget.getBoundingClientRect();
    const best = firstRayCandidate(targets, curRect, dir)
      || bestVectorCandidate(targets, curRect, dir, CONE_HALF_ANGLE)
      || bestVectorCandidate(targets, curRect, dir, WIDE_CONE_HALF_ANGLE)
      || bestVectorCandidate(targets, curRect, dir, null);
    if (!best) return false;
    setFocus(best);
    return true;
  }

  function move(dir) {
    switch (dir) {
      case 'left': return moveVector(-1, 0);
      case 'right': return moveVector(1, 0);
      case 'up': return moveVector(0, -1);
      case 'down': return moveVector(0, 1);
      default: return false;
    }
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

  function moveVectorOrAdjust(x, y) {
    const horizontalIntent = Math.abs(x) >= Math.abs(y) * 1.15; // Prevents a diagonal meant for another row from accidentally changing a slider/select value.
    if (horizontalIntent && Math.abs(x) > 0.01 && adjustFocusedControl(x < 0 ? -1 : 1)) return true;
    return moveVector(x, y);
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

  // ── gamepad polling (shared authority; cheap when idle) ─────────────
  const dirState = { up: mkDirState(), down: mkDirState(), left: mkDirState(), right: mkDirState() };
  const stickState = { down: false, next: 0, x: 0, y: 0 }; // One analog gesture state prevents diagonals from causing two cardinal moves in the same frame.
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

  function resetStickState() {
    stickState.down = false;
    stickState.next = 0;
    stickState.x = 0;
    stickState.y = 0;
  }

  function pollStickVector(rawX, rawY, now) {
    const magnitude = Math.hypot(rawX, rawY);
    if (magnitude < NAV_PRESS) { resetStickState(); return; }
    const x = rawX / Math.max(magnitude, 1e-6), y = rawY / Math.max(magnitude, 1e-6);
    const directionChanged = stickState.down && (x * stickState.x + y * stickState.y) < STICK_DIRECTION_RESET_COS;
    if (!stickState.down || directionChanged) {
      stickState.down = true;
      stickState.x = x;
      stickState.y = y;
      stickState.next = now + REPEAT_INITIAL_MS;
      moveVectorOrAdjust(x, y);
      return;
    }
    stickState.x = x;
    stickState.y = y;
    if (now >= stickState.next) {
      stickState.next = now + REPEAT_RATE_MS;
      moveVectorOrAdjust(x, y);
    }
  }

  let prevButtons = new Set();
  let menuOpenEdge = false;
  let lastGamepadPollAt = 0; // Used to keep analog right-stick menu scrolling independent of display refresh rate.

  function pollGamepad(frame) {
    const now = frame.now;
    if (!frame.focused) return;
    const pad = frame.pad; // Resolved once per frame by the shared polling authority.
    if (!pad) { prevButtons.clear(); menuOpenEdge = false; resetStickState(); return; }
    padEverSeen = true;

    if (window.InputSettingsPanel?.isControllerListening?.()) {
      prevButtons.clear();
      menuOpenEdge = false;
      resetStickState();
      return;
    }

    if (!isActive()) {
      resetStickState();
      // Nothing to navigate — the only job left is offering a way to open
      // the pause menu at all from a controller with no keyboard nearby.
      const openDown = controllerActionDown(frame, UI_ACTIONS.open); // Used to let the configured Menu Open/Close action own this edge instead of a fixed View/Share button.
      if (openDown && !menuOpenEdge) {
        document.getElementById('menuBtn')?.click();
        prevButtons = new Set([UI_ACTIONS.open]); // Prevents the same held configured open press from immediately closing the menu on its next active frame.
      } else if (!openDown) prevButtons.clear();
      menuOpenEdge = openDown;
      return;
    }
    menuOpenEdge = false;

    const navStick = window.ControllerInput?.normalizeStick?.(pad.axes[0], pad.axes[1], DEADZONE, 1) || { x: pad.axes[0] || 0, y: pad.axes[1] || 0 };
    const rawAx = Number(pad.axes[0]) || 0, rawAy = Number(pad.axes[1]) || 0; // Used to preserve the physical analog direction before cone scoring.
    const digitalLeft = controllerActionDown(frame, UI_ACTIONS.left);
    const digitalRight = controllerActionDown(frame, UI_ACTIONS.right);
    const digitalUp = controllerActionDown(frame, UI_ACTIONS.up);
    const digitalDown = controllerActionDown(frame, UI_ACTIONS.down);
    const digitalDirectionActive = digitalLeft || digitalRight || digitalUp || digitalDown;
    pollDirection('left', digitalLeft, now, () => moveOrAdjust('left'));
    pollDirection('right', digitalRight, now, () => moveOrAdjust('right'));
    pollDirection('up', digitalUp, now, () => move('up'));
    pollDirection('down', digitalDown, now, () => move('down'));
    if (digitalDirectionActive) resetStickState();
    else pollStickVector(rawAx, rawAy, now); // One true-vector decision per analog gesture/repeat; diagonals never double-step.

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

    const downActions = new Set(Object.values(UI_ACTIONS).filter(actionId => controllerActionDown(frame, actionId))); // Used as semantic edge state so remapping never depends on physical Gamepad indices.
    const actionPressed = actionId => downActions.has(actionId) && !prevButtons.has(actionId); // Used to edge-trigger menu actions once per configured press.
    if (actionPressed(UI_ACTIONS.confirm)) activate();
    if (actionPressed(UI_ACTIONS.cancel)) cancel();
    if (actionPressed(UI_ACTIONS.tabPrev)) cycleTabs(-1);
    if (actionPressed(UI_ACTIONS.tabNext)) cycleTabs(1);
    if (actionPressed(UI_ACTIONS.open)) cancel();
    prevButtons = downActions;
  }
  window.ControllerInput?.subscribe?.('controller-ui-nav', pollGamepad, window.ControllerInput.PRIORITY.menuNav);

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
    if (panel && isNavTarget(event.target) && belongsToNavigation(event.target, panel)) {
      if (currentTarget && currentTarget !== event.target) currentTarget.classList.remove('ctrl-nav-focus');
      currentTarget = event.target;
      currentTarget.classList.add('ctrl-nav-focus');
    }
  }, true);

  // ── panel discovery: MutationObserver (open/close via class/style/attr) ──
  // Split in two so ordinary UI churn doesn't pay for panel-visibility
  // tracking: structuralObserver watches the whole body (subtree+childList,
  // no attributes) purely to notice a panel node itself being
  // added/removed — e.g. cooking-system.js building its layer fresh. Actual
  // visibility toggles (class/style/aria-hidden/hidden) are watched only on
  // the handful of registered panel roots themselves via attrObserver,
  // since panelVisible() above already only ever looks at a panel's own
  // computed style, never an ancestor's. A single document-wide attribute
  // observer used to re-run reconcileStack (a full querySelectorAll +
  // getComputedStyle/getBoundingClientRect pass) on every class/style
  // mutation anywhere in the entire game UI — item icons, tooltips, HUD
  // updates, hover states — which showed up as ~5% of total frame time
  // spent just in querySelectorAll during ordinary inventory browsing.
  let reconcileQueued = false;
  let visibilityEarlyTimer = 0; // Catches the first rendered frame of an opening opacity transition without restoring continuous polling.
  let visibilitySettleTimer = 0; // Rechecks after opacity transitions without polling layout throughout gameplay.
  function scheduleReconcile() {
    if (reconcileQueued) return;
    reconcileQueued = true;
    queueMicrotask(() => {
      reconcileQueued = false;
      reconcileStack();
    });
  }
  function scheduleVisibilitySettle() {
    clearTimeout(visibilityEarlyTimer);
    clearTimeout(visibilitySettleTimer);
    visibilityEarlyTimer = setTimeout(() => {
      visibilityEarlyTimer = 0;
      reconcileStack();
    }, 32);
    visibilitySettleTimer = setTimeout(() => {
      visibilitySettleTimer = 0;
      reconcileStack();
    }, 240);
  }
  function isControllerPanel(panel) {
    if (!panel?.matches?.(PANEL_SELECTOR)) return false;
    if (panel.matches(SEMANTIC_PANEL_SELECTOR) && !panel.matches(EXPLICIT_PANEL_SELECTOR) && panel.parentElement?.closest?.(EXPLICIT_PANEL_SELECTOR)) return false; // An explicit outer owner wins so a semantic dialog nested inside it cannot create a duplicate stack layer.
    return true;
  }
  function registerPanel(panel) {
    if (!isControllerPanel(panel)) return false;
    const added = !knownPanels.has(panel);
    knownPanels.add(panel);
    watchPanelAttributes(panel);
    return added;
  }
  function registerPanelsIn(node) {
    if (!node || node.nodeType !== 1) return false;
    let changed = registerPanel(node);
    for (const panel of node.querySelectorAll?.(PANEL_SELECTOR) || []) changed = registerPanel(panel) || changed;
    return changed;
  }
  const structuralObserver = new MutationObserver((records) => {
    let panelTreeChanged = false;
    for (const record of records) {
      for (const node of record.addedNodes) panelTreeChanged = registerPanelsIn(node) || panelTreeChanged;
      for (const node of record.removedNodes) {
        if (node.nodeType === 1 && (node.matches?.(PANEL_SELECTOR) || node.querySelector?.(PANEL_SELECTOR))) panelTreeChanged = true;
      }
    }
    if (panelTreeChanged) scheduleReconcile();
  });
  const attrObserver = new MutationObserver(() => {
    scheduleReconcile();
    scheduleVisibilitySettle();
  });
  const attrWatchedPanels = new WeakSet();
  function watchPanelAttributes(panel) {
    if (attrWatchedPanels.has(panel)) return;
    attrWatchedPanels.add(panel);
    attrObserver.observe(panel, { attributes: true, attributeFilter: ['class', 'style', 'aria-hidden', 'hidden'] });
  }
  function startObserving() {
    structuralObserver.observe(document.body, { childList: true, subtree: true });
    document.body.addEventListener('transitionend', (event) => {
      if (event.target?.matches?.(PANEL_SELECTOR)) scheduleReconcile();
    }, true);
  }
  function boot() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    registerPanelsIn(document.body);
    startObserving();
    reconcileStack();
  }
  boot();

  window.ControllerUI = {
    isActive,
    activePanel,
    focusedElement: () => currentTarget,
    navigateVector: (x, y) => moveVectorOrAdjust(Number(x) || 0, Number(y) || 0), // Mobile/headless diagnostic seam for reproducing exact diagonal intent without a physical pad.
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
        knownPanels: knownPanels.size,
        panelId: panel?.id || panel?.className || null,
        targetTag: currentTarget?.tagName || null,
        targetId: currentTarget?.id || null,
        targetText: (currentTarget?.textContent || '').trim().slice(0, 40),
        navigationMode: 'vector-cone',
        coneHalfAngleDeg: Math.round(CONE_HALF_ANGLE * 180 / Math.PI),
      };
    },
  };
})();
