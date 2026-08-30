(() => {
  'use strict';

  // Universal 2D UI element editor. Lets a player/dev pick any DOM element
  // in the whole page (HUD, menus, dialogue, tooltips, panels — literally
  // anything, since selection works off click targets, not a hand-
  // maintained registry) and override its visual properties live.
  //
  // Flow: Settings → Dev Tools → "UI Edit Mode" toggle shows a small
  // collapsed tab pinned top-left. Click the tab to arm picking — the
  // next click anywhere selects that element instead of triggering it.
  // The tab expands in place into a field list for the selected element.
  // Edits are saved for the rest of the play session (sessionStorage —
  // cleared when the game/tab is closed), and can be exported from
  // Settings as the full JSON config or a diff against the shipped
  // defaults (docs/config/ui/ui-element-editor-overrides.json).
  //
  // Self-contained on purpose: no dependency on game.js internals.

  const SESSION_KEY = 'hobunji_ui_element_editor_overrides_v1';
  const SHOW_TOGGLE_KEY = 'hobunji_ui_element_editor_show_v1';
  const BASE_CONFIG_URL = 'config/ui/ui-element-editor-overrides.json';

  const FIELD_DEFS = [
    { key: 'text',           label: 'Text Content',    type: 'textarea', leafOnly: true },
    { key: 'fontSize',       label: 'Font Size',        type: 'number', unit: 'px', min: 0,    max: 300, step: 1,    cssProp: 'fontSize' },
    { key: 'fontWeight',     label: 'Font Weight',      type: 'select', options: ['', '300', '400', '500', '600', '700', '800', '900'] },
    { key: 'fontFamily',     label: 'Font Family',      type: 'text',   cssProp: 'fontFamily' },
    { key: 'color',          label: 'Text Color',       type: 'color',  cssProp: 'color' },
    { key: 'textStrokeWidth',label: 'Outline Width',    type: 'number', unit: 'px', min: 0, max: 20, step: 0.5, cssProp: 'webkitTextStrokeWidth' },
    { key: 'textStrokeColor',label: 'Outline Color',    type: 'color',  cssProp: 'webkitTextStrokeColor' },
    { key: 'backgroundColor',label: 'Background Color', type: 'color',  cssProp: 'backgroundColor' },
    { key: 'borderColor',    label: 'Border Color',     type: 'color',  cssProp: 'borderColor' },
    { key: 'borderWidth',    label: 'Border Width',     type: 'number', unit: 'px', min: 0,    max: 60,  step: 1,    cssProp: 'borderWidth' },
    { key: 'borderRadius',   label: 'Border Radius',    type: 'number', unit: 'px', min: 0,    max: 300, step: 1,    cssProp: 'borderRadius' },
    { key: 'opacity',        label: 'Opacity',          type: 'number', unit: '',   min: 0,    max: 1,   step: 0.05, cssProp: 'opacity' },
    { key: 'padding',        label: 'Padding',          type: 'text',   cssProp: 'padding' },
    { key: 'width',          label: 'Width',            type: 'text' },
    { key: 'height',         label: 'Height',           type: 'text' },
    { key: 'letterSpacing',  label: 'Letter Spacing',   type: 'number', unit: 'px', min: -20,  max: 60,  step: 0.5,  cssProp: 'letterSpacing' },
    { key: 'lineHeight',     label: 'Line Height',      type: 'number', unit: '',   min: 0,    max: 6,   step: 0.05, cssProp: 'lineHeight' },
    { key: 'textAlign',      label: 'Text Align',       type: 'select', options: ['', 'left', 'center', 'right', 'justify'] },
    { key: 'translateX',     label: 'Offset X',         type: 'number', unit: 'px', min: -2000, max: 2000, step: 1, hideWhenFloating: true },
    { key: 'translateY',     label: 'Offset Y',         type: 'number', unit: 'px', min: -2000, max: 2000, step: 1, hideWhenFloating: true },
    { key: 'hidden',         label: 'Hidden',           type: 'checkbox' },
  ];

  const CSS_PROP_MAP = {
    fontSize: 'font-size', fontWeight: 'font-weight', fontFamily: 'font-family',
    color: 'color', backgroundColor: 'background-color', borderColor: 'border-color',
    borderWidth: 'border-width', borderRadius: 'border-radius', opacity: 'opacity',
    padding: 'padding', width: 'width', height: 'height', left: 'left', top: 'top',
    letterSpacing: 'letter-spacing', lineHeight: 'line-height', textAlign: 'text-align',
    textStrokeWidth: '-webkit-text-stroke-width', textStrokeColor: '-webkit-text-stroke-color',
  };

  // Elements taken out of document flow ("floating") can be dragged and
  // resized directly on screen instead of only through numeric fields.
  function isFloating(el) {
    const p = getComputedStyle(el).position;
    return p === 'fixed' || p === 'absolute' || p === 'sticky';
  }

  let overrides = { version: 1, elements: {} };
  let baseline = { version: 1, elements: {} };

  let root = null, hoverBox = null, selectBox = null, tabEl = null, tabLabel = null, tabBody = null;
  let shown = false;
  let mode = 'collapsed'; // 'collapsed' | 'picking' | 'expanded'
  let selectedEl = null, selectedSelector = null;
  let instanceSelector = null, classSelector = null, targetMode = 'instance';
  let rafHandle = null, saveTimer = null, mutationScheduled = false;
  let observer = null;
  let listenersOn = false;

  const styleTag = document.createElement('style');
  styleTag.id = 'uiEditorOverrideStyle';
  (document.head || document.documentElement).appendChild(styleTag);

  // The game's own aim-mode code can re-request pointer lock on its own
  // (e.g. a click into the 3D viewport while picking) — immediately kick
  // it back out for as long as we're trying to pick, since a locked
  // pointer means frozen MouseEvent.clientX/clientY and picking breaks.
  document.addEventListener('pointerlockchange', () => {
    if (mode === 'picking' && document.pointerLockElement) document.exitPointerLock();
  });

  // ── persistence (session-only: cleared when the game/tab is closed) ──
  function deepClone(obj) { return JSON.parse(JSON.stringify(obj || {})); }

  function loadOverridesFromStorage() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.elements) return parsed;
    } catch {}
    return null;
  }

  async function loadBaseline() {
    try {
      const res = await fetch(BASE_CONFIG_URL);
      if (res.ok) {
        const json = await res.json();
        if (json && json.elements) return json;
      }
    } catch {}
    return { version: 1, elements: {} };
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(overrides)); } catch {}
    }, 250);
  }

  // ── selector generation ─────────────────────────────────────────────
  // classWide=false (default) pins to this exact element via :nth-of-type
  // at every ambiguous level — good for one-off/instance edits (nudging a
  // specific item icon). classWide=true drops those qualifiers so the
  // selector matches every sibling with the same tag+class shape instead
  // — good for template-wide edits (every inventory slot, the currency
  // readout regardless of which number is showing), still scoped under
  // the nearest id-rooted ancestor so it doesn't leak elsewhere in the page.
  function getStableSelector(el, classWide) {
    if (el === document.body) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const cls = Array.from(node.classList || []).filter(c => c && !c.startsWith('ui-editor'));
      if (cls.length) part += '.' + cls.map(c => CSS.escape(c)).join('.');
      if (!classWide) {
        const parent = node.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
          if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // ── applying overrides ──────────────────────────────────────────────
  function buildCss(elements) {
    let out = '';
    for (const [selector, props] of Object.entries(elements)) {
      const decls = [];
      for (const [key, cssProp] of Object.entries(CSS_PROP_MAP)) {
        if (props[key] != null && props[key] !== '') decls.push(`${cssProp}: ${props[key]} !important`);
      }
      if (props.borderColor) decls.push('border-style: solid !important');
      if (props.translateX != null || props.translateY != null) {
        decls.push(`transform: translate(${props.translateX || '0px'}, ${props.translateY || '0px'}) !important`);
      }
      if (props.hidden) decls.push('display: none !important');
      if (decls.length) out += `${selector} { ${decls.join('; ')}; }\n`;
    }
    return out;
  }

  function hasTextOverrides() {
    return Object.values(overrides.elements).some(p => p.text != null);
  }

  function applyTextOverrides() {
    if (!hasTextOverrides()) return;
    if (observer) observer.disconnect();
    for (const [selector, props] of Object.entries(overrides.elements)) {
      if (props.text == null) continue;
      let matches;
      try { matches = document.querySelectorAll(selector); } catch { continue; }
      matches.forEach(elm => {
        if (elm.closest && elm.closest('#uiEditorRoot')) return;
        if (elm.textContent !== props.text) elm.textContent = props.text;
      });
    }
    updateObserverState();
  }

  function updateObserverState() {
    if (!observer) {
      observer = new MutationObserver(() => {
        if (mutationScheduled) return;
        mutationScheduled = true;
        requestAnimationFrame(() => { mutationScheduled = false; applyTextOverrides(); });
      });
    }
    if (shown && hasTextOverrides()) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      observer.disconnect();
    }
  }

  function applyAll() {
    styleTag.textContent = buildCss(overrides.elements);
    applyTextOverrides();
    updateObserverState();
  }

  function setOverrideProp(selector, key, value) {
    if (!overrides.elements[selector]) overrides.elements[selector] = {};
    overrides.elements[selector][key] = value;
    applyAll();
    scheduleSave();
  }

  function clearOverrideProp(selector, key) {
    const entry = overrides.elements[selector];
    if (!entry) return;
    delete entry[key];
    if (Object.keys(entry).length === 0) delete overrides.elements[selector];
    applyAll();
    scheduleSave();
  }

  function resetAll() {
    overrides.elements = {};
    applyAll(); scheduleSave();
    if (selectedEl) renderFields(selectedEl, selectedSelector);
  }

  // ── inspector fields ─────────────────────────────────────────────────
  function rgbToHex(rgbStr) {
    if (!rgbStr) return '#000000';
    if (rgbStr.startsWith('#')) return rgbStr;
    const m = rgbStr.match(/rgba?\(([^)]+)\)/);
    if (!m) return '#000000';
    const [r, g, b] = m[1].split(',').map(s => parseFloat(s.trim()));
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, '0')).join('');
  }

  function placeholderFor(el, cs, def) {
    if (def.key === 'width') return Math.round(el.getBoundingClientRect().width) + 'px';
    if (def.key === 'height') return Math.round(el.getBoundingClientRect().height) + 'px';
    if (def.key === 'translateX' || def.key === 'translateY') return '0';
    if (def.cssProp) return cs[def.cssProp] || '';
    return '';
  }

  function handleControlInput(el, selector, def, control) {
    if (def.type === 'checkbox') {
      if (control.checked) setOverrideProp(selector, def.key, true);
      else clearOverrideProp(selector, def.key);
      return;
    }
    if (def.type === 'color') { setOverrideProp(selector, def.key, control.value); return; }
    const raw = control.value;
    if (raw.trim() === '') { clearOverrideProp(selector, def.key); return; }
    if (def.type === 'number') { setOverrideProp(selector, def.key, raw + (def.unit || '')); return; }
    setOverrideProp(selector, def.key, raw);
  }

  function renderFields(el, selector) {
    const container = document.getElementById('uiEditorFields');
    if (!container) return;
    container.innerHTML = '';
    const ov = overrides.elements[selector] || {};
    const cs = getComputedStyle(el);
    FIELD_DEFS.forEach(def => {
      if (def.leafOnly && el.children.length > 0) return;
      if (def.hideWhenFloating && isFloating(el)) return;
      const row = document.createElement('div');
      row.className = 'ui-editor-field-row';
      const label = document.createElement('label');
      label.className = 'ui-editor-field-label';
      label.textContent = def.label;
      row.appendChild(label);

      if (def.type === 'select') {
        const control = document.createElement('select');
        def.options.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt; o.textContent = opt === '' ? 'Default' : opt;
          control.appendChild(o);
        });
        control.value = ov[def.key] || '';
        control.addEventListener('change', () => handleControlInput(el, selector, def, control));
        row.appendChild(control);
      } else if (def.type === 'checkbox') {
        const control = document.createElement('input');
        control.type = 'checkbox';
        control.checked = !!ov[def.key];
        control.addEventListener('change', () => handleControlInput(el, selector, def, control));
        row.appendChild(control);
      } else if (def.type === 'color') {
        const control = document.createElement('input');
        control.type = 'color';
        control.value = ov[def.key] || rgbToHex(cs[def.cssProp]);
        control.addEventListener('input', () => handleControlInput(el, selector, def, control));
        row.appendChild(control);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button'; clearBtn.className = 'ui-editor-clear-btn'; clearBtn.title = 'Clear override';
        clearBtn.textContent = '×';
        clearBtn.addEventListener('click', () => { clearOverrideProp(selector, def.key); renderFields(el, selector); });
        row.appendChild(clearBtn);
      } else if (def.type === 'textarea') {
        const control = document.createElement('textarea');
        control.rows = 2;
        control.value = ov[def.key] != null ? ov[def.key] : el.textContent.trim();
        control.addEventListener('input', () => handleControlInput(el, selector, def, control));
        row.appendChild(control);
      } else {
        const control = document.createElement('input');
        control.type = def.type === 'number' ? 'number' : 'text';
        if (def.type === 'number') {
          if (def.min != null) control.min = def.min;
          if (def.max != null) control.max = def.max;
          control.step = def.step || 1;
        }
        const existing = ov[def.key];
        control.value = existing != null ? (def.type === 'number' ? parseFloat(existing) : existing) : '';
        control.placeholder = placeholderFor(el, cs, def);
        control.addEventListener('input', () => handleControlInput(el, selector, def, control));
        row.appendChild(control);
      }
      container.appendChild(row);
    });

    if (isFloating(el)) {
      const relRow = document.createElement('div');
      relRow.className = 'ui-editor-field-row';
      const relLabel = document.createElement('label'); relLabel.className = 'ui-editor-field-label'; relLabel.textContent = 'Scale to Screen (%)';
      const relCb = document.createElement('input'); relCb.type = 'checkbox'; relCb.checked = !!ov.relative;
      relCb.addEventListener('change', () => { if (relCb.checked) setOverrideProp(selector, 'relative', true); else clearOverrideProp(selector, 'relative'); });
      relRow.appendChild(relLabel); relRow.appendChild(relCb);
      container.appendChild(relRow);

      const aspRow = document.createElement('div');
      aspRow.className = 'ui-editor-field-row';
      const aspLabel = document.createElement('label'); aspLabel.className = 'ui-editor-field-label'; aspLabel.textContent = 'Lock Aspect (1:1 Scale)';
      const aspCb = document.createElement('input'); aspCb.type = 'checkbox'; aspCb.checked = !!ov.lockAspect;
      aspCb.addEventListener('change', () => { if (aspCb.checked) setOverrideProp(selector, 'lockAspect', true); else clearOverrideProp(selector, 'lockAspect'); });
      aspRow.appendChild(aspLabel); aspRow.appendChild(aspCb);
      container.appendChild(aspRow);

      const hint = document.createElement('div');
      hint.className = 'ui-editor-drag-hint';
      hint.textContent = 'Drag the yellow outline to move it. Drag a corner handle to resize. "Scale to Screen" stores position/size as a % of the screen so it holds up across resolutions; unchecked stores fixed pixels.';
      container.appendChild(hint);
    }
    updateDraggability();
  }

  function selectParent() {
    if (!selectedEl || !selectedEl.parentElement) return;
    if (selectedEl.parentElement === document.documentElement) return;
    selectElement(selectedEl.parentElement);
  }

  function updateSelectedPathDisplay() {
    const pathEl = document.getElementById('uiEditorSelectedPath');
    if (pathEl) pathEl.textContent = selectedSelector;
  }

  function updateTargetRow() {
    const row = document.getElementById('uiEditorTargetRow');
    const select = document.getElementById('uiEditorTargetMode');
    if (!row || !select) return;
    row.hidden = classSelector === instanceSelector;
    select.value = targetMode;
  }

  function onTargetModeChange(value) {
    if (!selectedEl) return;
    targetMode = value === 'class' ? 'class' : 'instance';
    selectedSelector = targetMode === 'class' ? classSelector : instanceSelector;
    updateSelectedPathDisplay();
    renderFields(selectedEl, selectedSelector);
  }

  function selectElement(el) {
    selectedEl = el;
    instanceSelector = getStableSelector(el, false);
    classSelector = getStableSelector(el, true);
    targetMode = 'instance';
    selectedSelector = instanceSelector;
    updateSelectedPathDisplay();
    updateTargetRow();
    renderFields(el, selectedSelector);
    setMode('expanded');
  }

  // ── highlight boxes ─────────────────────────────────────────────────
  function updateHoverBox(el) {
    const r = el.getBoundingClientRect();
    Object.assign(hoverBox.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  function updateSelectBox() {
    if (!selectBox) return;
    if (!selectedEl || !document.body.contains(selectedEl)) { selectBox.style.display = 'none'; return; }
    const r = selectedEl.getBoundingClientRect();
    Object.assign(selectBox.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  function tick() {
    if (!shown) return;
    updateSelectBox();
    rafHandle = requestAnimationFrame(tick);
  }

  // ── drag-to-move / drag-to-resize (floating elements only) ──────────
  let dragState = null;

  function updateDraggability() {
    if (!selectBox) return;
    const on = mode === 'expanded' && !!selectedEl && isFloating(selectedEl);
    selectBox.classList.toggle('draggable', on);
  }

  function toStoredUnit(px, axis, relative) {
    if (!relative) return Math.round(px) + 'px';
    const denom = axis === 'x' ? window.innerWidth : window.innerHeight;
    return (px / denom * 100).toFixed(3) + '%';
  }

  function onSelectBoxPointerDown(e) {
    if (!(mode === 'expanded' && selectedEl && isFloating(selectedEl))) return;
    const handle = e.target.closest('.ui-editor-handle');
    startDrag(handle ? handle.dataset.handle : 'move', e);
  }

  function startDrag(kind, e) {
    e.preventDefault(); e.stopPropagation();
    const el = selectedEl;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const scaleX = rect.width / (el.offsetWidth || rect.width || 1);
    const scaleY = rect.height / (el.offsetHeight || rect.height || 1);
    const parsedLeft = parseFloat(cs.left), parsedTop = parseFloat(cs.top);
    dragState = {
      kind, startX: e.clientX, startY: e.clientY,
      startLeft: Number.isNaN(parsedLeft) ? rect.left : parsedLeft,
      startTop: Number.isNaN(parsedTop) ? rect.top : parsedTop,
      startWidth: el.offsetWidth, startHeight: el.offsetHeight,
      aspect: el.offsetWidth / (el.offsetHeight || 1),
      scaleX: scaleX || 1, scaleY: scaleY || 1,
      lastLeft: null, lastTop: null, lastWidth: null, lastHeight: null,
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
  }

  function onDragMove(e) {
    if (!dragState || !selectedEl) return;
    const ov = overrides.elements[selectedSelector] || {};
    const lockAspect = !!ov.lockAspect;
    const dx = (e.clientX - dragState.startX) / dragState.scaleX;
    const dy = (e.clientY - dragState.startY) / dragState.scaleY;
    let left = dragState.startLeft, top = dragState.startTop;
    let width = dragState.startWidth, height = dragState.startHeight;
    const k = dragState.kind;
    if (k === 'move') {
      left += dx; top += dy;
    } else {
      if (k.includes('e')) width = dragState.startWidth + dx;
      if (k.includes('w')) { width = dragState.startWidth - dx; left = dragState.startLeft + dx; }
      if (k.includes('s')) height = dragState.startHeight + dy;
      if (k.includes('n')) { height = dragState.startHeight - dy; top = dragState.startTop + dy; }
      if (lockAspect) {
        height = width / dragState.aspect;
        if (k.includes('n')) top = dragState.startTop + (dragState.startHeight - height);
      }
      width = Math.max(4, width); height = Math.max(4, height);
    }
    selectedEl.style.setProperty('left', left + 'px', 'important');
    selectedEl.style.setProperty('top', top + 'px', 'important');
    if (dragState.kind !== 'move') {
      selectedEl.style.setProperty('width', width + 'px', 'important');
      selectedEl.style.setProperty('height', height + 'px', 'important');
    }
    dragState.lastLeft = left; dragState.lastTop = top; dragState.lastWidth = width; dragState.lastHeight = height;
  }

  function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    if (!dragState || !selectedEl) { dragState = null; return; }
    const el = selectedEl, selector = selectedSelector;
    const ov = overrides.elements[selector] || {};
    const relative = !!ov.relative;
    const { lastLeft, lastTop, lastWidth, lastHeight, kind } = dragState;
    if (lastLeft != null) {
      setOverrideProp(selector, 'left', toStoredUnit(lastLeft, 'x', relative));
      setOverrideProp(selector, 'top', toStoredUnit(lastTop, 'y', relative));
      if (kind !== 'move') {
        setOverrideProp(selector, 'width', toStoredUnit(lastWidth, 'x', relative));
        setOverrideProp(selector, 'height', toStoredUnit(lastHeight, 'y', relative));
      }
    }
    el.style.removeProperty('left'); el.style.removeProperty('top');
    el.style.removeProperty('width'); el.style.removeProperty('height');
    dragState = null;
    if (selectedEl === el) renderFields(el, selector);
  }

  // ── mode state machine ──────────────────────────────────────────────
  function setMode(newMode) {
    mode = newMode;
    // The game's character-view aim mode holds the pointer locked to the
    // 3D viewport, which freezes MouseEvent.clientX/clientY at 0 — fatal
    // for elementFromPoint-based picking. Release it so real cursor
    // coordinates come back; there's nothing to aim at while picking anyway.
    if (mode === 'picking' && document.pointerLockElement) document.exitPointerLock();
    if (tabBody) tabBody.hidden = mode !== 'expanded';
    if (tabEl) {
      tabEl.classList.toggle('picking', mode === 'picking');
      tabEl.classList.toggle('expanded', mode === 'expanded');
    }
    if (tabLabel) tabLabel.textContent = mode === 'picking' ? 'Click a target…' : 'UI Edit';
    document.body.classList.toggle('ui-editor-picking', mode === 'picking');
    if (mode !== 'picking' && hoverBox) hoverBox.style.display = 'none';
    updateSelectBox();
    updateDraggability();
  }

  function onTabHeadClick() {
    if (mode === 'picking' || mode === 'expanded') { setMode('collapsed'); return; }
    if (selectedSelector) setMode('expanded');
    else setMode('picking');
  }

  // ── input capture ───────────────────────────────────────────────────
  function isInOwnRoot(target) { return !!(target && target.closest && target.closest('#uiEditorRoot')); }

  // While picking, a CSS rule forces pointer-events:auto everywhere so
  // click-through HUD chrome (see isFloating's neighboring comment —
  // e.g. the status pill, deliberately pointer-events:none so clicks
  // fall through to the world) becomes hit-testable. That same override
  // can also expose an otherwise-invisible closed modal/overlay that's
  // still laid out full-size with opacity:0 — without this, the first
  // one of those under the cursor would swallow every click. Resolve by
  // walking past anything that isn't actually visible, punching a
  // temporary hole through it and re-testing what's underneath.
  // opacity:0 isn't inherited in computed-style terms — a canvas inside a
  // closed, fully transparent modal still reports its own opacity as "1",
  // so invisibility has to be checked up the whole ancestor chain, not
  // just on the hit element itself.
  function isEffectivelyVisible(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return false;
      node = node.parentElement;
    }
    return true;
  }

  function resolvePickTarget(x, y) {
    const punched = [];
    let el = document.elementFromPoint(x, y);
    let guard = 0;
    while (el && guard++ < 8) {
      if (isInOwnRoot(el)) { el = null; break; }
      if (isEffectivelyVisible(el)) break;
      const prevVal = el.style.getPropertyValue('pointer-events');
      const prevPriority = el.style.getPropertyPriority('pointer-events');
      punched.push({ el, prevVal, prevPriority });
      el.style.setProperty('pointer-events', 'none', 'important');
      el = document.elementFromPoint(x, y);
    }
    punched.forEach(p => {
      if (p.prevVal) p.el.style.setProperty('pointer-events', p.prevVal, p.prevPriority);
      else p.el.style.removeProperty('pointer-events');
    });
    return el;
  }

  function onMouseMove(e) {
    if (mode !== 'picking') return;
    const el = resolvePickTarget(e.clientX, e.clientY);
    if (!el) { hoverBox.style.display = 'none'; return; }
    updateHoverBox(el);
  }

  function onBlockCapture(e) {
    if (mode !== 'picking' || isInOwnRoot(e.target)) return;
    e.preventDefault(); e.stopPropagation();
  }

  function onClickCapture(e) {
    if (isInOwnRoot(e.target)) return;
    if (mode !== 'picking') return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const el = resolvePickTarget(e.clientX, e.clientY);
    if (el) selectElement(el);
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    if (mode === 'picking' || mode === 'expanded') setMode('collapsed');
  }

  // ── export / import ─────────────────────────────────────────────────
  function download(filename, dataObj) {
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() {
    download('hobunji-ui-overrides.json', { version: 1, generatedAt: new Date().toISOString(), elements: overrides.elements });
  }

  function computeDiff() {
    const baseEls = (baseline && baseline.elements) || {};
    const diff = {};
    for (const [selector, props] of Object.entries(overrides.elements)) {
      const baseProps = baseEls[selector] || {};
      const changed = {};
      for (const [k, v] of Object.entries(props)) {
        if (baseProps[k] !== v) changed[k] = v;
      }
      for (const k of Object.keys(baseProps)) {
        if (!(k in props)) changed[k] = null;
      }
      if (Object.keys(changed).length) diff[selector] = changed;
    }
    return diff;
  }

  function exportDiff() {
    download('hobunji-ui-overrides.diff.json', { version: 1, generatedAt: new Date().toISOString(), baseVersion: (baseline && baseline.version) || 1, elements: computeDiff() });
  }

  // ── DOM build ────────────────────────────────────────────────────────
  function buildDom() {
    root = document.createElement('div');
    root.id = 'uiEditorRoot';
    root.className = 'ui-editor-root';
    root.hidden = true;
    root.innerHTML = `
      <div id="uiEditorHoverBox" class="ui-editor-box ui-editor-hover-box"></div>
      <div id="uiEditorSelectBox" class="ui-editor-box ui-editor-select-box">
        <div class="ui-editor-handle" data-handle="nw"></div>
        <div class="ui-editor-handle" data-handle="ne"></div>
        <div class="ui-editor-handle" data-handle="se"></div>
        <div class="ui-editor-handle" data-handle="sw"></div>
      </div>
      <div id="uiEditorTab" class="ui-editor-tab">
        <div class="ui-editor-tab-head" id="uiEditorTabHead">
          <span class="ui-editor-tab-icon">🖌</span>
          <span class="ui-editor-tab-label" id="uiEditorTabLabel">UI Edit</span>
        </div>
        <div class="ui-editor-tab-body" id="uiEditorTabBody" hidden>
          <div class="ui-editor-selected-path" id="uiEditorSelectedPath">No element selected</div>
          <div class="ui-editor-field-row" id="uiEditorTargetRow" hidden title="This element repeats (siblings share its shape) — choose whether edits apply to just this one or to every element like it, e.g. one inventory item icon vs. every item slot, or this instance of the gold count vs. however the currency text always looks">
            <label class="ui-editor-field-label">Apply to</label>
            <select id="uiEditorTargetMode">
              <option value="instance">This one only</option>
              <option value="class">All like this</option>
            </select>
          </div>
          <div class="ui-editor-toolbar">
            <button type="button" id="uiEditorPickAgainBtn" class="settings-small-btn">Pick New</button>
            <button type="button" id="uiEditorParentBtn" class="settings-small-btn" title="Select this element's parent — useful for containers with no exposed area of their own, like a panel whose header/content fill it edge to edge">Parent ↑</button>
            <button type="button" id="uiEditorResetElBtn" class="settings-small-btn">Reset This</button>
          </div>
          <div class="ui-editor-fields" id="uiEditorFields"></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    hoverBox = root.querySelector('#uiEditorHoverBox');
    selectBox = root.querySelector('#uiEditorSelectBox');
    tabEl = root.querySelector('#uiEditorTab');
    tabLabel = root.querySelector('#uiEditorTabLabel');
    tabBody = root.querySelector('#uiEditorTabBody');
    selectBox.addEventListener('pointerdown', onSelectBoxPointerDown);

    root.querySelector('#uiEditorTabHead').addEventListener('click', onTabHeadClick);
    root.querySelector('#uiEditorTargetMode').addEventListener('change', (e) => onTargetModeChange(e.target.value));
    root.querySelector('#uiEditorPickAgainBtn').addEventListener('click', (e) => { e.stopPropagation(); setMode('picking'); });
    root.querySelector('#uiEditorParentBtn').addEventListener('click', (e) => { e.stopPropagation(); selectParent(); });
    root.querySelector('#uiEditorResetElBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedSelector) return;
      delete overrides.elements[selectedSelector];
      applyAll(); scheduleSave();
      renderFields(selectedEl, selectedSelector);
    });
  }

  // ── visibility (driven by the Settings toggle) ─────────────────────
  function updateListeners() {
    const want = shown;
    if (want === listenersOn) return;
    listenersOn = want;
    if (want) {
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mousedown', onBlockCapture, true);
      document.addEventListener('pointerdown', onBlockCapture, true);
      document.addEventListener('click', onClickCapture, true);
      document.addEventListener('keydown', onKeyDown, true);
      rafHandle = requestAnimationFrame(tick);
    } else {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mousedown', onBlockCapture, true);
      document.removeEventListener('pointerdown', onBlockCapture, true);
      document.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (rafHandle) cancelAnimationFrame(rafHandle);
    }
    updateObserverState();
  }

  function setShown(val) {
    shown = !!val;
    if (root) root.hidden = !shown;
    if (!shown) { setMode('collapsed'); document.body.classList.remove('ui-editor-picking'); }
    updateListeners();
  }

  function wireSettingsButton() {
    const cb = document.getElementById('settingUiEditMode');
    if (cb) {
      let stored = false;
      try { stored = localStorage.getItem(SHOW_TOGGLE_KEY) === '1'; } catch {}
      cb.checked = stored;
      setShown(stored);
      cb.addEventListener('change', () => {
        try { localStorage.setItem(SHOW_TOGGLE_KEY, cb.checked ? '1' : '0'); } catch {}
        setShown(cb.checked);
      });
    }
    const jsonBtn = document.getElementById('uiEditorExportJsonBtn');
    if (jsonBtn) jsonBtn.addEventListener('click', exportJson);
    const diffBtn = document.getElementById('uiEditorExportDiffBtn');
    if (diffBtn) diffBtn.addEventListener('click', exportDiff);
    const resetAllBtn = document.getElementById('uiEditorResetAllBtn');
    if (resetAllBtn) resetAllBtn.addEventListener('click', () => {
      if (!confirm('Reset ALL UI element overrides made this session?')) return;
      resetAll();
    });
  }
  function wireSettingsButtonWhenReady() {
    if (document.getElementById('settingUiEditMode')) { wireSettingsButton(); return; }
    document.addEventListener('DOMContentLoaded', wireSettingsButton, { once: true });
  }

  function ensureDom() {
    if (root) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', ensureDom, { once: true }); return; }
    buildDom();
  }

  (async function init() {
    ensureDom();
    const stored = loadOverridesFromStorage();
    baseline = await loadBaseline();
    overrides = stored || { version: 1, elements: deepClone(baseline.elements) };
    applyAll();
    wireSettingsButtonWhenReady();
  })();

  window.UIElementEditor = { setShown, exportJson, exportDiff, resetAll };
})();
