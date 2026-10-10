// Shared tap reliability for every Hobunji page (the game, the tools hub and every authoring tool).
//
// 1. Double-tap zoom. Phones in "desktop site" mode ignore <meta name="viewport">, so the browser lays the page out
//    at ~980px and keeps double-tap-to-zoom on. Every tap then waits ~300ms to see whether it is the first half of a
//    double tap. With no visible response the player taps again, and that second tap zooms the page instead of
//    reaching the button, so buttons look like they "do not register taps". `touch-action: manipulation` keeps
//    panning and pinch-zoom but removes double-tap zoom and the click delay, and it applies to the whole page when
//    set on the root. Elements that need raw touch input (canvases, joysticks) keep their own `touch-action: none`.
//
// 2. Collapsed menus. A closed <details> must not keep a laid-out body. Pages style bodies with rules like
//    `display: flex !important` (an ID selector no plain rule can outrank), which keeps a full-size box for the closed
//    menu; where that box sits on a higher
//    z-index than the UI beneath it (the editor's setup drawer is z-index 70 above the Pants panel at 20) a browser
//    that hides it only visually still hands it the taps. `display: none` removes the box so it cannot take input.
//
// 3. Tap tracer (opt-in). Open any page with ?tapdebug=1 (stored in localStorage; ?tapdebug=0 turns it off) to see,
//    on screen, what every touch actually landed on, whether a click followed, and whether the page zoomed. That is
//    the evidence needed when taps fail on a real device that cannot be reproduced elsewhere.
//
// This file is the single owner of these rules: pages include it instead of repeating the CSS.
(() => {
  'use strict';

  const STYLE_ID = 'hobunjiTapReliability';
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    'html,body{touch-action:manipulation}',
    'button,[role="button"],summary,label,select,a,input[type="button"],input[type="submit"],input[type="checkbox"],input[type="radio"]{touch-action:manipulation;-webkit-tap-highlight-color:rgba(107,169,255,.35)}',
    // Plain rule for engines without cascade layers...
    'details:not([open])>:not(summary){display:none!important}',
    // ...and the same rule in a layer: for !important, layered rules beat UNLAYERED ones whatever their specificity, so this
    // also wins over a page's own `#id .body { display:flex !important }`.
    '@layer hobunjiTapReliability{details:not([open])>:not(summary){display:none!important}}',
  ].join('\n');

  // First in <head> so a page's own, more specific touch-action rules (e.g. on a canvas) still win.
  (document.head || document.documentElement).prepend(style);

  // ---- tap tracer ----------------------------------------------------------
  const TAP_SLOP_PX = 20;
  const NO_CLICK_AFTER_MS = 700;

  function describe(el) {
    if (!el || !el.tagName) return '(nothing)';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  }

  function hiddenReason(el) { // Why this hit target should not be taking touches, or ''.
    if (!el || !el.closest) return '';
    const details = el.closest('details:not([open])');
    const summary = el.closest('summary');
    if (details && !(summary && summary.parentElement === details)) return 'INSIDE A CLOSED MENU (' + describe(details) + ')';
    let opacity = 1;
    try { opacity = Number(window.getComputedStyle(el).opacity); } catch (_) { /* leave 1 */ }
    return opacity < 0.05 ? 'INVISIBLE ELEMENT (opacity 0)' : '';
  }

  function installTapTracer() {
    const lines = [];
    const box = document.createElement('div');
    box.id = 'hobunjiTapDebug';
    box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:2147483647;max-width:calc(100% - 12px);pointer-events:none;font:11px/1.35 ui-monospace,Menlo,monospace;color:#d8ffe8;background:rgba(3,10,16,.93);border:1px solid rgba(110,255,170,.55);border-radius:8px;padding:6px 8px;white-space:pre-wrap;word-break:break-all';
    (document.body || document.documentElement).appendChild(box);
    const scale = () => (window.visualViewport && window.visualViewport.scale) || 1;
    const show = text => {
      lines.push(text);
      while (lines.length > 7) lines.shift();
      box.textContent = 'TAP TRACER (add ?tapdebug=0 to turn off)\n' + lines.join('\n');
    };
    let seq = 0;
    let tap = null;

    window.addEventListener('pointerdown', event => {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      tap = { id: ++seq, at: performance.now(), x: event.clientX, y: event.clientY, scale: scale(), target: describe(event.target), clicked: false, ended: false, timer: null };
      const hidden = hiddenReason(hit);
      show(`#${tap.id} DOWN ${event.pointerType || '?'} ${Math.round(tap.x)},${Math.round(tap.y)} zoom=${tap.scale.toFixed(2)} -> ${tap.target}${hit && hit !== event.target ? ' (hit-test: ' + describe(hit) + ')' : ''}${hidden ? '\n   !!! ' + hidden : ''}`);
    }, true);

    window.addEventListener('pointerup', event => {
      if (!tap || tap.ended) return;
      tap.ended = true;
      const moved = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
      show(`#${tap.id} UP after ${Math.round(performance.now() - tap.at)}ms moved ${Math.round(moved)}px -> ${describe(event.target)}${event.defaultPrevented ? ' [defaultPrevented]' : ''}`);
      const current = tap;
      if (moved <= TAP_SLOP_PX) {
        current.timer = setTimeout(() => {
          if (!current.clicked) show(`#${current.id} NO CLICK ${NO_CLICK_AFTER_MS}ms after a clean tap on ${current.target}: the tap was lost`);
          if (Math.abs(scale() - current.scale) > 0.01) show(`#${current.id} PAGE ZOOM CHANGED ${current.scale.toFixed(2)} -> ${scale().toFixed(2)} (double-tap zoom happened)`);
        }, NO_CLICK_AFTER_MS);
      }
    }, true);

    window.addEventListener('pointercancel', () => {
      if (tap) { tap.ended = true; show(`#${tap.id} POINTERCANCEL: the browser took this gesture (scroll or zoom), so no click`); }
    }, true);

    window.addEventListener('click', event => {
      if (!tap) return;
      tap.clicked = true;
      show(`#${tap.id} CLICK ok -> ${describe(event.target)}`);
    }, true);

    window.addEventListener('dblclick', () => show('DBLCLICK seen'), true);
  }

  function tracerWanted() {
    try {
      const flag = new URLSearchParams(window.location.search).get('tapdebug');
      if (flag === '1') window.localStorage.setItem('hobunjiTapDebug', '1');
      else if (flag === '0') window.localStorage.removeItem('hobunjiTapDebug');
      return window.localStorage.getItem('hobunjiTapDebug') === '1';
    } catch (_) {
      return false;
    }
  }

  window.HobunjiTapReliability = Object.freeze({ describe, hiddenReason, installTapTracer });
  if (tracerWanted()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installTapTracer, { once: true });
    else installTapTracer();
  }
})();
