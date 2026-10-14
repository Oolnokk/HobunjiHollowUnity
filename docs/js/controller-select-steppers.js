// ◀ / ▶ confirm-only steppers beside dropdowns and numeric controls in the game UI.
//
// Native <select> popups are mouse/touch-only, so a controller can't open
// one. Left/right never changes a dropdown directly (it only moves focus);
// the value changes only when the player focuses ◀ or ▶ and presses
// Confirm. The decorated control itself is marked data-ctrl-skip so focus
// steps straight from ◀ to ▶; mouse/touch can still open it normally. The combat loadout pane
// solved this locally with explicit previous/next buttons on each side of its
// dropdowns (js/combat/combat-loadout-ui.js); this module applies that same
// pattern to every dropdown and numeric input in the game page — pause-menu tabs, world-
// interaction panels (loom, incubator, shops, color pools, ...), onboarding —
// including ones built after this file loads.
//
// Each select is wrapped in a .select-stepper flex row:
//   [◀] <select> [▶]
// The arrows are role="button" spans rather than <button>s on purpose: a
// <button> is a labelable element, so inside the common
// `<label>Text <select>` markup it would steal the label's click and cycle
// the dropdown whenever the label text was clicked. ControllerUI already
// navigates [role="button"]/[tabindex] and activates them with .click().
//
// Dropdown stepping wraps and skips disabled options; numeric stepping
// respects native min/max/step bounds. Both use confirmed arrows
// and fires the same input+change events a real pick does, so every owning
// module's existing change handler stays the single authority. When that
// handler rerenders its panel and the focused arrow is replaced, focus is
// handed to the matching arrow on the replacement select so a controller
// player can keep pressing Confirm.
//
// Opt-outs: `multiple`/`size>1` list boxes, and any select (or ancestor)
// marked data-no-select-stepper — used by panels that already render their
// own arrows (the combat loadout).
(() => {
  'use strict';

  if (window.SelectSteppers?.installed) return;

  const SKIP_SELECTOR = '[data-no-select-stepper]';
  const CONTROL_SELECTOR = 'select, input[type="number"], input[type="range"]'; // Shared discovery and rerender lookup for confirm-only value controls.
  const PANEL_SELECTOR = '[data-ctrl-panel], [role="dialog"]'; // Used to scope focus-restore lookups to the panel that owned the stepped select.
  const KEY_ATTRS = ['id', 'name', 'data-field', 'data-part', 'data-ob-slot', 'data-ob-equip-cat', 'aria-label']; // Used to find the same logical select again after its owner rerenders.
  const LAYOUT_PROPS = ['flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'width', 'min-width', 'max-width', 'align-self', 'justify-self', 'grid-column', 'grid-area', 'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom']; // Inline placement moves from the select to its wrapper so the row keeps its slot in the parent layout.
  const wrapped = new WeakMap(); // select -> { wrap, prev, next }
  let decoratedCount = 0;
  let lastStep = null; // Exposed through debugState() for headless/mobile diagnosis.

  function injectStyles() {
    if (document.getElementById('selectStepperStyles')) return;
    const style = document.createElement('style');
    style.id = 'selectStepperStyles';
    style.textContent = `
      .select-stepper { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0; vertical-align: middle; }
      .select-stepper.select-stepper-block { display: flex; width: 100%; }
      .select-stepper > select, .select-stepper > input { flex: 1 1 auto; min-width: 0; }
      .select-stepper-btn {
        flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
        min-width: 24px; height: 24px; padding: 0 4px; box-sizing: border-box;
        font-size: 11px; line-height: 1; cursor: pointer; user-select: none;
        color: inherit; background: rgba(255,255,255,.08);
        border: 1px solid rgba(255,255,255,.22); border-radius: 6px;
      }
      .select-stepper-btn:hover { background: rgba(255,255,255,.16); }
      .select-stepper-btn[aria-disabled="true"] { opacity: .35; cursor: default; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function eligible(select) {
    if (!select || !select.matches(CONTROL_SELECTOR) || !select.isConnected) return false;
    if (wrapped.has(select)) return false;
    if (select.multiple || Number(select.size) > 1) return false;
    if (select.closest(SKIP_SELECTOR)) return false;
    return true;
  }

  function enabledOptions(select) {
    return Array.from(select.options || []).filter(option => !option.disabled);
  }

  // Wraps around and skips disabled options; fires input+change only when
  // the value actually moved.
  function step(select, delta) {
    if (!select || select.disabled || select.readOnly) return false;
    if (select.tagName === 'INPUT') {
      const before = select.value; // Used to avoid events when a numeric control is already at its bound.
      if (select.step === 'any') {
        const min = select.min === '' ? (select.type === 'range' ? 0 : -Infinity) : Number(select.min); // Numeric bounds retain the range input's native defaults.
        const max = select.max === '' ? (select.type === 'range' ? 100 : Infinity) : Number(select.max); // Used to clamp explicit unit steps for continuous inputs.
        select.value = String(Math.max(min, Math.min(max, (Number(select.value) || 0) + (delta < 0 ? -1 : 1))));
      } else {
        try { delta < 0 ? select.stepDown() : select.stepUp(); } catch (_) { return false; }
      }
      if (select.value === before) return false;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      lastStep = { id: select.id || null, delta: delta < 0 ? -1 : 1, value: select.value, label: 'numeric value' };
      return true;
    }
    const options = enabledOptions(select);
    if (!options.length) return false;
    const current = options.indexOf(select.options[select.selectedIndex]);
    const dir = delta < 0 ? -1 : 1;
    const nextIndex = current < 0 ? (dir < 0 ? options.length - 1 : 0) : (current + dir + options.length) % options.length;
    const next = options[nextIndex];
    if (!next || next === select.options[select.selectedIndex]) return false;
    select.value = next.value;
    if (select.selectedIndex < 0 || select.options[select.selectedIndex] !== next) next.selected = true; // Duplicate option values: select the exact option stepped to.
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    lastStep = { id: select.id || null, delta: dir, value: select.value, label: (next.textContent || '').trim().slice(0, 40) };
    return true;
  }

  function isFullWidth(select, cs) {
    if (cs.display === 'block' || cs.display === 'flex' || cs.display === 'grid') return true;
    if (/%$/.test(cs.width || '')) return true; // Unrendered (display:none subtree) computed width still reports the authored percentage.
    const parent = select.parentElement;
    if (!parent || !select.offsetWidth) return false;
    const pcs = getComputedStyle(parent);
    if (pcs.display.includes('flex') || pcs.display.includes('grid')) return false; // Flex/grid items size from the container, not from their own width.
    const inner = parent.clientWidth - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
    return inner > 0 && select.offsetWidth >= inner - 1;
  }

  function makeArrow(select, dir) {
    const btn = document.createElement('span');
    btn.className = 'select-stepper-btn ' + (dir < 0 ? 'select-stepper-prev' : 'select-stepper-next');
    btn.setAttribute('role', 'button');
    btn.tabIndex = 0;
    btn.textContent = dir < 0 ? '◀' : '▶';
    const name = select.getAttribute('aria-label') || select.title || '';
    const action = select.tagName === 'INPUT' ? (dir < 0 ? 'Decrease' : 'Increase') : (dir < 0 ? 'Previous' : 'Next'); // Accessible labels match numeric versus dropdown stepping.
    btn.setAttribute('aria-label', action + (name ? ' ' + name : select.tagName === 'INPUT' ? ' value' : ' option'));
    btn.title = action + (select.tagName === 'INPUT' ? ' value' : ' option');
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation(); // A click on the arrow is not a click on whatever row/card the dropdown sits in.
      if (btn.getAttribute('aria-disabled') === 'true') return;
      onArrow(select, btn, dir);
    });
    btn.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      btn.click();
    });
    return btn;
  }

  function syncState(select) {
    const entry = wrapped.get(select);
    if (!entry) return;
    const disabled = select.disabled || select.readOnly || (select.tagName === 'SELECT' && enabledOptions(select).length < 2);
    for (const btn of [entry.prev, entry.next]) {
      const want = disabled ? 'true' : 'false';
      if (btn.getAttribute('aria-disabled') !== want) btn.setAttribute('aria-disabled', want);
    }
    const hidden = select.hidden || select.style.display === 'none'; // Owners that hide the dropdown itself must hide its arrows too.
    const wantDisplay = hidden ? 'none' : '';
    if (entry.wrap.style.display !== wantDisplay) entry.wrap.style.display = wantDisplay;
  }

  const selectObserver = typeof MutationObserver === 'function'
    ? new MutationObserver((records) => {
      const seen = new Set();
      for (const record of records) {
        const select = record.target.matches?.(CONTROL_SELECTOR) ? record.target : record.target.closest?.(CONTROL_SELECTOR);
        if (select && !seen.has(select)) { seen.add(select); syncState(select); }
      }
    })
    : null;

  function decorate(select) {
    if (!eligible(select)) return false;
    const parent = select.parentNode;
    if (!parent) return false;
    const cs = getComputedStyle(select);
    const wrap = document.createElement('span');
    wrap.className = 'select-stepper';
    if (isFullWidth(select, cs)) wrap.classList.add('select-stepper-block');
    for (const prop of LAYOUT_PROPS) {
      const value = select.style.getPropertyValue(prop);
      if (!value) continue;
      wrap.style.setProperty(prop, value);
      select.style.removeProperty(prop);
    }
    const prev = makeArrow(select, -1);
    const next = makeArrow(select, 1);
    const hadFocus = document.activeElement === select;
    parent.insertBefore(wrap, select);
    wrap.append(prev, select, next);
    if (!select.hasAttribute('data-ctrl-skip')) select.setAttribute('data-ctrl-skip', ''); // Controller focus goes to the arrows, not the unopenable native select.
    if (hadFocus) { try { select.focus({ preventScroll: true }); } catch (_) {} }
    wrapped.set(select, { wrap, prev, next });
    decoratedCount += 1;
    syncState(select);
    selectObserver?.observe(select, { attributes: true, attributeFilter: ['disabled', 'readonly', 'hidden', 'style'], childList: true, subtree: true });
    return true;
  }

  function decorateWithin(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches?.(CONTROL_SELECTOR)) { decorate(node); return; }
    if (!node.querySelectorAll) return;
    for (const select of node.querySelectorAll(CONTROL_SELECTOR)) decorate(select);
  }

  // ── focus hand-off across owner rerenders ───────────────────────────
  function locatorFor(select) {
    const root = select.closest(PANEL_SELECTOR) || document.body;
    const attrs = {};
    for (const attr of KEY_ATTRS) {
      const value = select.getAttribute(attr);
      if (value) attrs[attr] = value;
    }
    return { root, attrs, className: select.className || '', index: Array.from(root.querySelectorAll(CONTROL_SELECTOR)).indexOf(select) };
  }

  function findReplacement(loc) {
    const root = loc.root.isConnected ? loc.root : document.body;
    const all = Array.from(root.querySelectorAll(CONTROL_SELECTOR));
    if (loc.attrs.id) {
      const byId = document.getElementById(loc.attrs.id);
      if (byId?.matches(CONTROL_SELECTOR)) return byId;
    }
    const keyed = Object.entries(loc.attrs).filter(([attr]) => attr !== 'id');
    if (keyed.length) {
      const matches = all.filter(select => keyed.every(([attr, value]) => select.getAttribute(attr) === value));
      if (matches.length === 1) return matches[0];
    }
    const candidate = all[loc.index];
    return candidate && (candidate.className || '') === loc.className ? candidate : null;
  }

  function restoreFocus(loc, dir) {
    const select = findReplacement(loc);
    if (!select) return;
    decorate(select);
    const entry = wrapped.get(select);
    const target = entry && (dir < 0 ? entry.prev : entry.next);
    const focusEl = target && target.getAttribute('aria-disabled') !== 'true' ? target : null;
    if (!focusEl) return;
    try { focusEl.focus({ preventScroll: true }); } catch (_) {} // ControllerUI's focusin listener adopts this as its highlighted target.
  }

  function onArrow(select, btn, dir) {
    const hadFocus = document.activeElement === btn || window.ControllerUI?.focusedElement?.() === btn;
    const loc = hadFocus ? locatorFor(select) : null;
    step(select, dir);
    if (!loc) return;
    const check = () => { if (!btn.isConnected) restoreFocus(loc, dir); };
    check();
    if (btn.isConnected) {
      // Some owners rerender on a microtask/next frame rather than synchronously.
      queueMicrotask(check);
      requestAnimationFrame(check);
    }
  }

  // ── boot ────────────────────────────────────────────────────────────
  let structuralObserver = null;
  function boot() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    injectStyles();
    decorateWithin(document.body);
    structuralObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && !node.classList?.contains('select-stepper')) decorateWithin(node);
        }
      }
    });
    structuralObserver.observe(document.body, { childList: true, subtree: true });
  }
  boot();

  window.SelectSteppers = {
    installed: true,
    step,
    decorate,
    refresh: () => decorateWithin(document.body),
    debugState: () => ({ decoratedCount, observing: Boolean(structuralObserver), lastStep }),
  };
})();
