// Shared tap reliability for every Hobunji page (the game, the tools hub and every authoring tool).
//
// Phones in "desktop site" mode ignore <meta name="viewport">, so the browser lays the page out at ~980px and
// keeps double-tap-to-zoom on. Every tap then waits ~300ms to see whether it is the first half of a double tap.
// With no visible response the player taps again, and that second tap zooms the page instead of reaching the
// button, so buttons look like they "do not register taps". `touch-action: manipulation` keeps panning and
// pinch-zoom but removes double-tap zoom and the click delay, and it applies to the whole page when set on the
// root. Elements that need raw touch input (canvases, joysticks) keep their own, stricter `touch-action: none`.
//
// This file is the single owner of that rule: pages include it instead of repeating the CSS.
(() => {
  'use strict';

  const STYLE_ID = 'hobunjiTapReliability';
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    'html,body{touch-action:manipulation}',
    'button,[role="button"],summary,label,select,a,input[type="button"],input[type="submit"],input[type="checkbox"],input[type="radio"]{touch-action:manipulation;-webkit-tap-highlight-color:rgba(107,169,255,.35)}',
  ].join('\n');

  // First in <head> so a page's own, more specific touch-action rules (e.g. on a canvas) still win.
  (document.head || document.documentElement).prepend(style);
})();
