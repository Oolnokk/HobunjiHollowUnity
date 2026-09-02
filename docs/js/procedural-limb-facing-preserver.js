// Procedural Animation Editor Ground / Carry lazy bootstrap.
//
// This legacy filename is intentionally retained because procedural-impact-tabs.js
// already loads it. It does only one job now: keep Ground / Carry explicitly
// opt-in, then load the isolated pose author when the user asks for it. It does
// NOT patch avatar construction, Euler methods, selection handlers, or the
// existing procedural animator.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbFacingPreserver) return;

  const SCRIPT_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null; // Resolves the branch-paired docs root for the pose-author request.
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL) : new URL('../../', location.href); // Keeps GitHack/branch previews on the selected revision.
  const BOOT_BUTTON_ID = 'limbPoseLazyBootstrapBtn'; // Temporary HUD entry shown before the optional author is loaded.
  const REAL_BUTTON_ID = 'limbPoseQuickBtn'; // Canonical button created by the real pose author after activation.
  const AUTHOR_SCRIPT_ID = 'proceduralLimbPoseAuthorExplicitScript'; // Prevents duplicate explicit author loads after rapid taps.
  const MAX_BUTTON_WAIT_FRAMES = 180; // Bounds HUD startup polling so this adapter never creates a permanent animation-frame loop.
  let activating = false; // Prevents rapid mobile taps from launching duplicate author requests.

  const dormantAuthorSentinel = Object.freeze({ // Makes procedural-impact-tabs skip its legacy eager author load until explicit activation.
    version: 0,
    dormant: true,
    reason: 'Ground / Carry is explicit opt-in so the legacy procedural animator remains authoritative.',
  });
  if (!window.HobunjiProceduralLimbPoseAuthor) window.HobunjiProceduralLimbPoseAuthor = dormantAuthorSentinel;

  function status(message, good = true) { // Mirrors load/failure state into the existing mobile-visible status pill.
    const pill = document.getElementById('statusPill'); // Existing animator HUD status element used instead of DevTools-only logging.
    if (pill) {
      pill.textContent = message;
      pill.className = good ? 'pill good' : 'pill warn';
    }
    (good ? console.info : console.warn)(`[Ground / Carry] ${message}`);
  }

  function openRealAuthor() { // Opens the author through its public API once asynchronous setup has finished.
    const author = window.HobunjiProceduralLimbPoseAuthor; // Current global becomes the real author after its script executes.
    if (author && author !== dormantAuthorSentinel && typeof author.openPanel === 'function') {
      author.openPanel();
      status('Ground / Carry opened. Normal animator remains untouched until a pose is selected.');
      return true;
    }
    const button = document.getElementById(REAL_BUTTON_ID); // DOM fallback supports an older/newer compatible author API.
    if (button) {
      button.click();
      status('Ground / Carry opened.');
      return true;
    }
    return false;
  }

  function waitForRealAuthor(attempt = 0) { // Bounded wait accommodates the author loading its own Three.js/hand dependencies.
    if (openRealAuthor()) return;
    if (attempt < MAX_BUTTON_WAIT_FRAMES) requestAnimationFrame(() => waitForRealAuthor(attempt + 1));
    else status('Ground / Carry loaded, but its panel did not finish initializing.', false);
  }

  function restoreBootstrapAfterFailure() { // Reinstalls the dormant contract so a failed network request can be retried safely.
    activating = false;
    window.HobunjiProceduralLimbPoseAuthor = dormantAuthorSentinel;
    document.getElementById(BOOT_BUTTON_ID)?.remove();
    ensureBootstrapButton();
  }

  function activateGroundCarry() { // Explicit activation is the only path that loads code capable of authoring poses.
    if (activating) return;
    const liveAuthor = window.HobunjiProceduralLimbPoseAuthor; // Reuses an already-loaded author rather than adding another script.
    if (liveAuthor && liveAuthor !== dormantAuthorSentinel) {
      openRealAuthor();
      return;
    }
    activating = true;
    const bootButton = document.getElementById(BOOT_BUTTON_ID); // Current lightweight HUD button removed once the real author owns that slot.
    if (bootButton) {
      bootButton.disabled = true;
      bootButton.textContent = 'Loading Ground / Carry…';
    }
    status('Loading Ground / Carry…');

    if (window.HobunjiProceduralLimbPoseAuthor === dormantAuthorSentinel) delete window.HobunjiProceduralLimbPoseAuthor;
    const existing = document.getElementById(AUTHOR_SCRIPT_ID); // A previous in-flight request should only be awaited, never duplicated.
    if (existing) {
      waitForRealAuthor();
      return;
    }

    const script = document.createElement('script'); // Loads the branch-paired author only after the user opts into this workspace.
    script.id = AUTHOR_SCRIPT_ID;
    script.src = new URL('js/procedural-limb-pose-author.js?v=20260902c', DOCS_BASE).href;
    script.defer = true;
    script.onload = () => {
      bootButton?.remove();
      waitForRealAuthor();
    };
    script.onerror = () => {
      script.remove();
      restoreBootstrapAfterFailure();
      status('Ground / Carry pose author failed to load.', false);
    };
    document.head.appendChild(script);
  }

  function ensureBootstrapButton(attempt = 0) { // Adds the lightweight opt-in button once the existing procedural HUD exists.
    if (document.getElementById(REAL_BUTTON_ID) || document.getElementById(BOOT_BUTTON_ID)) return true;
    const actionRow = document.querySelector('#animationHud .animationHudActions'); // Existing mobile-visible playback action row.
    if (!actionRow) {
      if (attempt < MAX_BUTTON_WAIT_FRAMES) requestAnimationFrame(() => ensureBootstrapButton(attempt + 1));
      return false;
    }
    const button = document.createElement('button'); // Explicit opt-in entry; creating it does not alter avatar or animation state.
    button.id = BOOT_BUTTON_ID;
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Ground / Carry';
    button.title = 'Open optional ground/rest and heavy-carry authoring';
    button.addEventListener('click', activateGroundCarry);
    actionRow.appendChild(button);
    return true;
  }

  window.HobunjiProceduralLimbFacingPreserver = Object.freeze({
    version: 9,
    mode: 'lazy-ground-carry-bootstrap',
    activateGroundCarry,
    ensureBootstrapButton,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ensureBootstrapButton(), { once: true });
  else ensureBootstrapButton();
})();