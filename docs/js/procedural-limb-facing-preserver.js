// Procedural Animation Editor Ground / Carry / Manual lazy bootstrap.
// Keeps optional limb authoring dormant until explicitly opened. It also loads
// the tiny Fine Hood compatibility adapter eagerly so the editor and in-game
// avatars share the same no-camera-facing-headwear rule.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbFacingPreserver) return;

  const SCRIPT_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL) : new URL('../../', location.href);
  const BOOT_BUTTON_ID = 'limbPoseLazyBootstrapBtn';
  const REAL_BUTTON_ID = 'limbPoseQuickBtn';
  const AUTHOR_SCRIPT_ID = 'proceduralLimbPoseAuthorExplicitScript';
  const HEADWEAR_SCRIPT_ID = 'proceduralFineHoodFacingDisableScript';
  const MAX_BUTTON_WAIT_FRAMES = 180;
  let activating = false;

  const dormantAuthorSentinel = Object.freeze({
    version: 0,
    dormant: true,
    reason: 'Ground / Carry / Manual is explicit opt-in so the normal procedural animator remains authoritative.',
  });
  if (!window.HobunjiProceduralLimbPoseAuthor) window.HobunjiProceduralLimbPoseAuthor = dormantAuthorSentinel;

  function loadHeadwearVisibilityFix() {
    if (window.HobunjiFineHoodTrimHeadFacing || document.getElementById(HEADWEAR_SCRIPT_ID)) return;
    const script = document.createElement('script');
    script.id = HEADWEAR_SCRIPT_ID;
    script.src = new URL('js/fine-hood-trim-head-facing.js?v=20260902d', DOCS_BASE).href;
    script.defer = true;
    script.onerror = () => console.warn('[Ground / Carry / Manual] Fine Hood camera-facing visibility fix failed to load.');
    document.head.appendChild(script);
  }

  function status(message, good = true) {
    const pill = document.getElementById('statusPill');
    if (pill) { pill.textContent = message; pill.className = good ? 'pill good' : 'pill warn'; }
    (good ? console.info : console.warn)(`[Ground / Carry / Manual] ${message}`);
  }

  function openRealAuthor() {
    const author = window.HobunjiProceduralLimbPoseAuthor;
    if (author && author !== dormantAuthorSentinel && typeof author.openPanel === 'function') {
      author.openPanel();
      status('Limb author opened. Normal animator remains untouched until a mode is selected.');
      return true;
    }
    const button = document.getElementById(REAL_BUTTON_ID);
    if (button) { button.click(); status('Limb author opened.'); return true; }
    return false;
  }

  function waitForRealAuthor(attempt = 0) {
    if (openRealAuthor()) return;
    if (attempt < MAX_BUTTON_WAIT_FRAMES) requestAnimationFrame(() => waitForRealAuthor(attempt + 1));
    else status('Limb author loaded, but its panel did not finish initializing.', false);
  }

  function restoreBootstrapAfterFailure() {
    activating = false;
    window.HobunjiProceduralLimbPoseAuthor = dormantAuthorSentinel;
    document.getElementById(BOOT_BUTTON_ID)?.remove();
    ensureBootstrapButton();
  }

  function activateGroundCarry() {
    if (activating) return;
    const liveAuthor = window.HobunjiProceduralLimbPoseAuthor;
    if (liveAuthor && liveAuthor !== dormantAuthorSentinel) { openRealAuthor(); return; }
    activating = true;
    const bootButton = document.getElementById(BOOT_BUTTON_ID);
    if (bootButton) { bootButton.disabled = true; bootButton.textContent = 'Loading Limb Author…'; }
    status('Loading Ground / Carry / Manual…');
    if (window.HobunjiProceduralLimbPoseAuthor === dormantAuthorSentinel) delete window.HobunjiProceduralLimbPoseAuthor;
    const existing = document.getElementById(AUTHOR_SCRIPT_ID);
    if (existing) { waitForRealAuthor(); return; }
    const script = document.createElement('script');
    script.id = AUTHOR_SCRIPT_ID;
    script.src = new URL('js/procedural-limb-pose-author.js?v=20260902d', DOCS_BASE).href;
    script.defer = true;
    script.onload = () => { bootButton?.remove(); waitForRealAuthor(); };
    script.onerror = () => { script.remove(); restoreBootstrapAfterFailure(); status('Limb pose author failed to load.', false); };
    document.head.appendChild(script);
  }

  function ensureBootstrapButton(attempt = 0) {
    if (document.getElementById(REAL_BUTTON_ID) || document.getElementById(BOOT_BUTTON_ID)) return true;
    const actionRow = document.querySelector('#animationHud .animationHudActions');
    if (!actionRow) {
      if (attempt < MAX_BUTTON_WAIT_FRAMES) requestAnimationFrame(() => ensureBootstrapButton(attempt + 1));
      return false;
    }
    const button = document.createElement('button');
    button.id = BOOT_BUTTON_ID;
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Limb Author';
    button.title = 'Open ground/rest, heavy carry, and manual IK authoring';
    button.addEventListener('click', activateGroundCarry);
    actionRow.appendChild(button);
    return true;
  }

  window.HobunjiProceduralLimbFacingPreserver = Object.freeze({
    version: 10,
    mode: 'lazy-limb-author-bootstrap',
    activateGroundCarry,
    ensureBootstrapButton,
  });

  loadHeadwearVisibilityFix();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ensureBootstrapButton(), { once: true });
  else ensureBootstrapButton();
})();
