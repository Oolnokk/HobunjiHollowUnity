// ============================================================
// PANEL UI
// Shared helpers for the dev tools (docs/tools/*): collapsible
// side panels, drag-to-resize edges/corners, and a scroll-fix
// helper for long panels whose content used to get clipped.
// ============================================================
(function (global) {
  'use strict';

  const STYLE_ID = 'panelUiSharedStyles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.panelUiGutter{flex-shrink:0;position:relative;z-index:5;touch-action:none;user-select:none}
.panelUiGutter.panelUiGutter-x{width:9px;cursor:ew-resize}
.panelUiGutter.panelUiGutter-y{height:9px;cursor:ns-resize}
.panelUiGutter::before{content:"";position:absolute;background:rgba(255,255,255,.08);transition:background .12s}
.panelUiGutter-x::before{top:0;bottom:0;left:3px;width:3px;border-radius:3px}
.panelUiGutter-y::before{left:0;right:0;top:3px;height:3px;border-radius:3px}
.panelUiGutter:hover::before,.panelUiGutter.panelUiDragging::before{background:rgba(106,167,255,.6)}
.panelUiCollapseBtn.act{background:rgba(106,167,255,.3)}
.panelUiWinGrip{position:absolute;z-index:30;touch-action:none;display:flex;align-items:center;justify-content:center;
  color:rgba(255,255,255,.4);font-size:10px;line-height:1;opacity:.75}
.panelUiWinGrip:hover{opacity:1;color:rgba(106,167,255,.9)}
.panelUiWinGrip-se{right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize}
.panelUiWinGrip-sw{left:0;bottom:0;width:18px;height:18px;cursor:nesw-resize}
.panelUiWinGrip-ne{right:0;top:0;width:18px;height:18px;cursor:nesw-resize}
.panelUiWinGrip-nw{left:0;top:0;width:18px;height:18px;cursor:nwse-resize}
.panelUiWinGripEdge{position:absolute;z-index:29;touch-action:none;background:transparent;transition:background .12s}
.panelUiWinGripEdge:hover{background:rgba(106,167,255,.3)}
.panelUiDragScroll{touch-action:none!important;cursor:grab;-webkit-user-select:none;user-select:none}
.panelUiDragScroll.panelUiDragging{cursor:grabbing;scroll-behavior:auto!important}
.panelUiDragScroll input,.panelUiDragScroll select,.panelUiDragScroll button,.panelUiDragScroll textarea,.panelUiDragScroll label{-webkit-user-select:auto;user-select:auto}
.panelUiWinGripEdge-e{top:0;right:0;width:8px;height:100%;cursor:ew-resize}
.panelUiWinGripEdge-w{top:0;left:0;width:8px;height:100%;cursor:ew-resize}
.panelUiWinGripEdge-s{left:0;bottom:0;height:8px;width:100%;cursor:ns-resize}
.panelUiWinGripEdge-n{left:0;top:0;height:8px;width:100%;cursor:ns-resize}
`;
    document.head.appendChild(style);
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function px(n) { return Math.round(n) + 'px'; }

  // ---- Collapsible docked panel -----------------------------------------
  // Adds a toggle button (placed in `toolbar`) that shrinks `panel` to zero
  // width/height, remembering the expanded size and persisting the
  // collapsed state across reloads.
  function makeCollapsible(panel, opts) {
    opts = opts || {};
    injectStyles();
    const axis = opts.axis === 'y' ? 'y' : 'x';
    const sizeProp = axis === 'x' ? 'width' : 'height';
    const paddingProps = axis === 'x' ? ['paddingLeft', 'paddingRight'] : ['paddingTop', 'paddingBottom'];
    const storageKey = opts.storageKey || ('panelUiCollapsed:' + location.pathname + ':' + (panel.id || ''));
    const expandedLabel = opts.label || '☰ Hide';
    const collapsedLabel = opts.collapsedLabel || (opts.label ? opts.label.replace(/Hide/, 'Show') : '☰ Show');

    let collapsed = false;
    try { collapsed = localStorage.getItem(storageKey) === '1'; } catch (_) {}
    let expandedSize = null;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = (opts.btnClass || 'secondary') + ' panelUiCollapseBtn';
    btn.title = opts.title || 'Show/hide this panel';
    if (opts.toolbar) {
      if (opts.before) opts.toolbar.insertBefore(btn, opts.before);
      else opts.toolbar.appendChild(btn);
    }

    function apply(animate) {
      if (animate) {
        panel.style.transition = sizeProp + ' .16s ease, min-' + sizeProp + ' .16s ease, padding .16s ease, border-width .16s ease, opacity .16s ease';
        setTimeout(() => { panel.style.transition = ''; }, 220);
      }
      if (collapsed) {
        if (!expandedSize) expandedSize = panel.style[sizeProp] || getComputedStyle(panel)[sizeProp];
        panel.dataset.panelUiExpandedSize = expandedSize;
        panel.style[sizeProp] = '0px';
        panel.style['min' + sizeProp[0].toUpperCase() + sizeProp.slice(1)] = '0px';
        paddingProps.forEach(p => { panel.style[p] = '0px'; });
        panel.style.borderWidth = '0px';
        panel.style.opacity = '0';
        panel.style.overflow = 'hidden';
        panel.setAttribute('aria-hidden', 'true');
        btn.textContent = collapsedLabel;
        btn.classList.add('act');
      } else {
        panel.style[sizeProp] = panel.dataset.panelUiExpandedSize || expandedSize || '';
        panel.style['min' + sizeProp[0].toUpperCase() + sizeProp.slice(1)] = '';
        paddingProps.forEach(p => { panel.style[p] = ''; });
        panel.style.borderWidth = '';
        panel.style.opacity = '';
        panel.style.overflow = '';
        panel.removeAttribute('aria-hidden');
        btn.textContent = expandedLabel;
        btn.classList.remove('act');
      }
    }
    apply(false);

    btn.addEventListener('click', () => {
      collapsed = !collapsed;
      apply(true);
      try { localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch (_) {}
      if (opts.onToggle) opts.onToggle(collapsed);
    });

    return {
      button: btn,
      isCollapsed: () => collapsed,
      setCollapsed(next) {
        if (next === collapsed) return;
        collapsed = next;
        apply(true);
        try { localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch (_) {}
      }
    };
  }

  // ---- Drag-to-resize edge for a docked flex panel -----------------------
  // Inserts a thin draggable gutter next to `panel` (a flex child) so its
  // width (or height) can be dragged instead of only set from CSS.
  function makeResizableEdge(panel, opts) {
    opts = opts || {};
    injectStyles();
    const axis = opts.axis === 'y' ? 'y' : 'x';
    const edge = opts.edge || (axis === 'x' ? 'right' : 'bottom');
    const sizeProp = axis === 'x' ? 'width' : 'height';
    const storageKey = opts.storageKey || ('panelUiSize:' + location.pathname + ':' + (panel.id || ''));
    const cs = getComputedStyle(panel);
    const minSize = opts.min != null ? opts.min : (parseFloat(axis === 'x' ? cs.minWidth : cs.minHeight) || 120);
    const rawMax = axis === 'x' ? cs.maxWidth : cs.maxHeight;
    const parsedMax = parseFloat(rawMax);
    const maxSize = opts.max != null ? opts.max :
      (Number.isFinite(parsedMax) ? parsedMax : Math.round((axis === 'x' ? window.innerWidth : window.innerHeight) * 0.85));

    const gutter = document.createElement('div');
    gutter.className = 'panelUiGutter panelUiGutter-' + axis;
    gutter.setAttribute('aria-hidden', 'true');
    gutter.title = 'Drag to resize';

    if (edge === 'right' || edge === 'bottom') panel.insertAdjacentElement('afterend', gutter);
    else panel.insertAdjacentElement('beforebegin', gutter);

    try {
      const saved = parseFloat(localStorage.getItem(storageKey));
      if (Number.isFinite(saved)) panel.style[sizeProp] = px(clamp(saved, minSize, maxSize));
    } catch (_) {}

    let dragging = false, startPos = 0, startSize = 0;

    gutter.addEventListener('pointerdown', (e) => {
      if (panel.getAttribute('aria-hidden') === 'true') return;
      dragging = true;
      gutter.classList.add('panelUiDragging');
      startPos = axis === 'x' ? e.clientX : e.clientY;
      startSize = panel.getBoundingClientRect()[sizeProp];
      gutter.setPointerCapture(e.pointerId);
      document.body.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    gutter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const pos = axis === 'x' ? e.clientX : e.clientY;
      const delta = pos - startPos;
      const signedDelta = (edge === 'right' || edge === 'bottom') ? delta : -delta;
      const next = clamp(startSize + signedDelta, minSize, maxSize);
      panel.style[sizeProp] = px(next);
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      gutter.classList.remove('panelUiDragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(storageKey, parseFloat(panel.style[sizeProp])); } catch (_) {}
    }
    gutter.addEventListener('pointerup', endDrag);
    gutter.addEventListener('pointercancel', endDrag);

    return { gutter };
  }

  // Splits a grid-template-columns/rows value into per-track strings,
  // respecting parens (so "minmax(300px, 400px) 1fr" stays 2 tracks).
  function splitGridTemplate(str) {
    const tracks = [];
    let depth = 0, cur = '';
    for (const ch of String(str).trim()) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ' ' && depth === 0) {
        if (cur) tracks.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur) tracks.push(cur);
    return tracks;
  }

  // ---- Drag-to-resize edge for a CSS Grid column ------------------------
  // For layouts built with `display:grid` (rather than flex) whose column
  // sizes are set via grid-template-columns. Overlays a thin drag handle on
  // `targetEl`'s inner edge (no DOM reordering, so the grid's implicit
  // column count never changes) and rewrites just that column's track to a
  // concrete pixel width on drag, leaving every other track untouched.
  function makeResizableGridColumn(container, targetEl, opts) {
    opts = opts || {};
    injectStyles();
    const edge = opts.edge || 'right';
    const storageKey = opts.storageKey || ('panelUiGridCol:' + location.pathname + ':' + (targetEl.id || ''));
    const cs = getComputedStyle(targetEl);
    const min = opts.min != null ? opts.min : (parseFloat(cs.minWidth) || 200);
    const max = opts.max != null ? opts.max : Math.round(window.innerWidth * 0.6);
    // Don't assume targetEl's DOM child-index maps 1:1 to a column-track
    // index — a sibling that spans every column (e.g. a header with
    // grid-column:1/-1) would throw that off. Instead match targetEl's own
    // left edge against each track's resolved left offset.
    let idx = opts.columnIndex;
    if (idx == null) {
      const cs2 = getComputedStyle(container);
      const tracks0 = splitGridTemplate(cs2.gridTemplateColumns);
      const colGap = parseFloat(cs2.columnGap) || 0;
      const containerLeft = container.getBoundingClientRect().left + (parseFloat(cs2.paddingLeft) || 0) + (parseFloat(cs2.borderLeftWidth) || 0);
      const targetLeft = targetEl.getBoundingClientRect().left;
      let acc = 0;
      idx = tracks0.length - 1;
      for (let i = 0; i < tracks0.length; i++) {
        if (Math.abs(containerLeft + acc - targetLeft) < 2) { idx = i; break; }
        acc += (parseFloat(tracks0[i]) || 0) + colGap;
      }
    }
    if (idx < 0) return null;

    if (getComputedStyle(targetEl).position === 'static') targetEl.style.position = 'relative';
    const gutter = document.createElement('div');
    gutter.className = 'panelUiGutter panelUiGutter-x';
    gutter.title = 'Drag to resize';
    Object.assign(gutter.style, { position: 'absolute', top: '0', bottom: '0', [edge]: '0', zIndex: '5' });
    targetEl.appendChild(gutter);

    function applyWidth(wpx) {
      const list = splitGridTemplate(getComputedStyle(container).gridTemplateColumns);
      list[idx] = px(wpx);
      container.style.gridTemplateColumns = list.join(' ');
    }

    try {
      const saved = parseFloat(localStorage.getItem(storageKey));
      if (Number.isFinite(saved)) applyWidth(clamp(saved, min, max));
    } catch (_) {}

    let dragging = false, startX = 0, startW = 0;
    gutter.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = targetEl.getBoundingClientRect().width;
      gutter.setPointerCapture(e.pointerId);
      gutter.classList.add('panelUiDragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    gutter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const delta = e.clientX - startX;
      const signed = edge === 'right' ? delta : -delta;
      applyWidth(clamp(startW + signed, min, max));
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      gutter.classList.remove('panelUiDragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(storageKey, targetEl.getBoundingClientRect().width); } catch (_) {}
    }
    gutter.addEventListener('pointerup', endDrag);
    gutter.addEventListener('pointercancel', endDrag);

    return { gutter };
  }

  // ---- Drag-to-resize corner/edge grips for a floating window ------------
  // `el` should already be position:fixed/absolute (a modal card, popover,
  // or floating drawer). Adds one corner grip (default bottom-right) that
  // drags the element's width/height, matching whichever side of the box
  // is actually pinned in its CSS (right/bottom vs left/top).
  function makeResizableBox(el, opts) {
    opts = opts || {};
    injectStyles();
    const corner = opts.corner || 'se';
    const axis = opts.axis || 'both'; // 'both' | 'x' | 'y' — which dimensions this grip drags
    const growRight = corner.indexOf('e') !== -1;
    const growDown = corner.indexOf('s') !== -1;
    const storageKey = opts.storageKey || null;
    const cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
    // Some of these tools pin size with `!important`; setProperty(...,'important')
    // is the only way an inline override reliably beats that.
    const setImportant = (prop, val) => el.style.setProperty(prop, val, 'important');

    const numOrFallback = (v, fallback) => (Number.isFinite(v) ? v : fallback);
    const minWidth = opts.minWidth != null ? opts.minWidth : numOrFallback(parseFloat(cs.minWidth), 220);
    const minHeight = opts.minHeight != null ? opts.minHeight : numOrFallback(parseFloat(cs.minHeight), 140);
    const maxWidth = opts.maxWidth != null ? opts.maxWidth : Math.round(window.innerWidth * 0.96);
    const maxHeight = opts.maxHeight != null ? opts.maxHeight : Math.round(window.innerHeight * 0.94);

    const grip = document.createElement('div');
    if (axis === 'both') {
      grip.className = 'panelUiWinGrip panelUiWinGrip-' + corner;
      grip.textContent = '⇲';
    } else if (axis === 'x') {
      grip.className = 'panelUiWinGripEdge panelUiWinGripEdge-' + (growRight ? 'e' : 'w');
    } else {
      grip.className = 'panelUiWinGripEdge panelUiWinGripEdge-' + (growDown ? 's' : 'n');
    }
    grip.title = 'Drag to resize';
    el.appendChild(grip);

    // A stylesheet max-width/max-height (often !important on these floating
    // panels) would silently cap an explicit inline size once past it — max-
    // height always wins over height in the box-size computation regardless
    // of !important on the latter. So neutralize the CSS cap and replace it
    // with our own JS-enforced min/max, pinning `lockedSize` (the box's
    // current, still-capped rendered size) as the explicit value first so
    // nothing jumps the moment this runs.
    function neutralizeCaps(lockedSize) {
      if (axis !== 'y') {
        setImportant('width', px(lockedSize.width));
        setImportant('max-width', 'none');
        setImportant('min-width', minWidth + 'px');
      }
      if (axis !== 'x') {
        setImportant('height', px(lockedSize.height));
        setImportant('max-height', 'none');
        setImportant('min-height', minHeight + 'px');
      }
    }

    let dragging = false, startX = 0, startY = 0, startW = 0, startH = 0;
    grip.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const r = el.getBoundingClientRect();
      startW = r.width; startH = r.height;
      // Many of these panels are hidden (display:none) until the user opens
      // them, so we can't safely snapshot/neutralize their CSS size caps at
      // setup time — do it now instead, on the first real drag, right after
      // reading the box's natural (still CSS-capped) size above.
      neutralizeCaps({ width: startW, height: startH });
      grip.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
      e.preventDefault();
      e.stopPropagation();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (axis !== 'y') {
        const dx = growRight ? (e.clientX - startX) : (startX - e.clientX);
        setImportant('width', px(clamp(startW + dx, minWidth, maxWidth)));
      }
      if (axis !== 'x') {
        const dy = growDown ? (e.clientY - startY) : (startY - e.clientY);
        setImportant('height', px(clamp(startH + dy, minHeight, maxHeight)));
      }
      if (opts.onResize) opts.onResize(el);
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      if (storageKey) {
        try { localStorage.setItem(storageKey, JSON.stringify({ w: el.style.width, h: el.style.height })); } catch (_) {}
      }
    }
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);

    if (storageKey) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        if (saved && (saved.w || saved.h)) {
          neutralizeCaps({
            width: saved.w ? parseFloat(saved.w) : el.getBoundingClientRect().width,
            height: saved.h ? parseFloat(saved.h) : el.getBoundingClientRect().height
          });
          if (opts.onResize) opts.onResize(el);
        }
      } catch (_) {}
    }

    return { grip };
  }

  // ---- Scroll-fix for long panels that were clipped instead of scrolling -
  // Guarantees the element can actually scroll (overflow-y:auto), walks a
  // few flex/grid ancestors setting min-height:0 so they don't force the
  // panel to overflow past its box instead of scrolling internally, and
  // stops wheel events from bubbling into a 3D viewport's zoom/pan handler.
  function fixScroll(el, opts) {
    opts = opts || {};
    const axis = opts.axis || 'y';
    if (axis === 'y') el.style.overflowY = 'auto';
    else el.style.overflowX = 'auto';
    el.style.webkitOverflowScrolling = 'touch';
    el.style.overscrollBehavior = 'contain';

    if (opts.fixAncestorChain !== false) {
      let node = el;
      let hops = opts.maxAncestors || 6;
      while (node && hops-- > 0) {
        const ncs = getComputedStyle(node);
        if (ncs.display.indexOf('flex') !== -1 || ncs.display.indexOf('grid') !== -1) {
          node.style[axis === 'y' ? 'minHeight' : 'minWidth'] = '0';
        }
        const parent = node.parentElement;
        if (!parent) break;
        const pcs = getComputedStyle(parent);
        if (pcs.overflowY === 'auto' || pcs.overflowY === 'scroll') break;
        node = parent;
      }
    }
    el.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
  }

  // ---- Touch hold-and-drag scrolling for panels floating over a canvas --
  // Mouse wheel already scrolls any overflow-y:auto panel for free, but a
  // panel that floats (position:fixed) over a WebGL canvas that owns touch
  // gestures (orbit/pan/zoom) can end up unable to take over touch-scroll
  // reliably from the browser's native handling. This installs an explicit
  // pointer-drag-to-scroll for touch input only — mouse/pen are untouched.
  function installTouchDragScroll(scroller) {
    if (!scroller || scroller.dataset.panelUiTouchDragInstalled === 'true') return;
    scroller.dataset.panelUiTouchDragInstalled = 'true';
    scroller.classList.add('panelUiDragScroll');

    let pointerId = null;
    let startY = 0;
    let startX = 0;
    let startScrollTop = 0;
    let dragging = false;
    let suppressNextClick = false;

    const reset = () => {
      if (pointerId !== null && scroller.hasPointerCapture?.(pointerId)) {
        try { scroller.releasePointerCapture(pointerId); } catch (_) {}
      }
      pointerId = null;
      dragging = false;
      scroller.classList.remove('panelUiDragging');
    };

    scroller.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      // Range sliders (and similar) need their own horizontal drag gesture.
      if (event.target.closest('input[type="range"]')) return;
      pointerId = event.pointerId;
      startY = event.clientY;
      startX = event.clientX;
      startScrollTop = scroller.scrollTop;
      dragging = false;
    }, { passive: true });

    scroller.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'touch' || event.pointerId !== pointerId) return;
      const deltaY = event.clientY - startY;
      const deltaX = event.clientX - startX;
      if (!dragging) {
        if (Math.abs(deltaY) < 6 || Math.abs(deltaY) < Math.abs(deltaX)) return;
        dragging = true;
        suppressNextClick = true;
        scroller.classList.add('panelUiDragging');
        try { scroller.setPointerCapture(event.pointerId); } catch (_) {}
      }
      event.preventDefault();
      event.stopPropagation();
      scroller.scrollTop = startScrollTop - deltaY;
    }, { passive: false });

    scroller.addEventListener('pointerup', (event) => {
      if (event.pointerId !== pointerId) return;
      if (dragging) {
        event.preventDefault();
        event.stopPropagation();
      }
      reset();
    }, { passive: false });
    scroller.addEventListener('pointercancel', reset, { passive: true });
    scroller.addEventListener('lostpointercapture', reset, { passive: true });

    scroller.addEventListener('click', (event) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  global.PanelUI = { makeCollapsible, makeResizableEdge, makeResizableGridColumn, makeResizableBox, fixScroll, installTouchDragScroll, injectStyles };
})(window);

// The attack editor has a small extension for shared tool/weapon idle stances.
// Load it only there so the generic PanelUI helper remains harmless elsewhere.
if (/\/tools\/attack-animation-editor\/(?:index\.html)?$/.test(location.pathname)) {
  const idleStanceScript = document.createElement('script');
  idleStanceScript.src = '../../js/attack-idle-stance-editor.js?v=20260814a';
  idleStanceScript.defer = true;
  document.head.appendChild(idleStanceScript);
}
