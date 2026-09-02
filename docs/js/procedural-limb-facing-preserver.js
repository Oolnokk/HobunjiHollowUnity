// Procedural Animation Editor Ground / Carry bootstrap.
//
// IMPORTANT: the pre-Ground/Carry animator already owns portrait assembly,
// front/back culling, camera orientation, and the avatar's baseline transform.
// This adapter deliberately does NOT touch portrait materials or mesh
// visibility. Its only responsibilities are:
//   1. leave the old animator completely untouched until Ground / Carry is
//      explicitly opened;
//   2. load the branch-paired fixed two-bone solver the new poses require;
//   3. preserve the old animator's established pose-root yaw while the new
//      pose author adds pitch/roll.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbFacingPreserver) return;

  const SCRIPT_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null; // Used to keep new dependencies on this exact GitHack branch/commit.
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL) : new URL('../../', location.href); // Resolves docs/ beside this bootstrap script.
  const BOOT_BUTTON_ID = 'limbPoseLazyBootstrapBtn'; // Temporary entry button used before the heavy Ground / Carry author is loaded.
  const REAL_BUTTON_ID = 'limbPoseQuickBtn'; // Existing button created by procedural-limb-pose-author.js after explicit activation.
  const AUTHOR_SCRIPT_ID = 'proceduralLimbPoseAuthorExplicitScript'; // Prevents duplicate explicit author loads.
  const baselines = new WeakMap(); // Stores the old animator's exact pose-root yaw before Ground / Carry can write to it.
  const wrappedRotations = new WeakMap(); // Stores original Euler.set methods so each pose root is wrapped once.
  let activating = false; // Prevents rapid taps from launching duplicate dependency/author requests.

  // A sentinel intentionally makes procedural-impact-tabs.js skip its old
  // eager author load. It is removed only after the user explicitly taps the
  // Ground / Carry bootstrap button below.
  const dormantAuthorSentinel = Object.freeze({ version: 0, dormant: true, reason: 'Ground / Carry is explicit opt-in so the legacy animator remains authoritative.' });
  window.HobunjiProceduralLimbPoseAuthor = dormantAuthorSentinel;

  function status(message, good = true) { // Reuses the animator's mobile-visible status pill instead of requiring DevTools.
    const pill = document.getElementById('statusPill');
    if (pill) {
      pill.textContent = message;
      pill.className = good ? 'pill good' : 'pill warn';
    }
    (good ? console.info : console.warn)(`[Ground / Carry] ${message}`);
  }

  function currentPoseRoot() { // Reads only the public preview API; no giant-editor private state is reached into.
    const backdrop = window.HobunjiGameplayBackdrop;
    if (!backdrop || backdrop.getPreviewMode?.() !== 'npc') return null;
    return backdrop.getAvatarModel?.()?.parent || null;
  }

  function protectLegacyYaw(poseRoot = currentPoseRoot()) { // Keeps Ground / Carry's zero-yaw writes relative to the animator's already-correct facing.
    if (!poseRoot?.rotation) return null;
    const rotation = poseRoot.rotation;
    if (wrappedRotations.has(rotation)) return poseRoot;

    const baselineYaw = Number.isFinite(Number(rotation.y)) ? Number(rotation.y) : 0; // Exact old-tool yaw captured immediately before explicit Ground / Carry activation.
    const originalSet = rotation.set;
    baselines.set(poseRoot, baselineYaw);
    wrappedRotations.set(rotation, originalSet);
    poseRoot.userData = poseRoot.userData || {};
    poseRoot.userData.hobunjiGroundCarryBaselineYaw = baselineYaw;

    rotation.set = function groundCarryRelativeEulerSet(x, y, z, order) {
      const requestedYaw = Number(y);
      const authorIsActive = window.HobunjiProceduralLimbPoseAuthor && window.HobunjiProceduralLimbPoseAuthor !== dormantAuthorSentinel;
      const groundCarryZeroYaw = authorIsActive && Number.isFinite(requestedYaw) && Math.abs(requestedYaw) < 1e-8;
      return originalSet.call(this, x, groundCarryZeroYaw ? baselineYaw : y, z, order);
    };
    return poseRoot;
  }

  function ensureBranchFixedLegSolver() { // Main still has only solveTwoBoneLeg; Ground / Carry needs the branch-paired fixed-length solver.
    if (typeof window.LegBones?.solveFixedTwoBoneChain === 'function') return Promise.resolve(true);
    const src = new URL('js/leg-bones.js?v=20260902-groundcarry-legacybase', DOCS_BASE).href;
    const existing = [...document.scripts].find(script => script.src === src);
    if (existing) return new Promise(resolve => {
      if (typeof window.LegBones?.solveFixedTwoBoneChain === 'function') return resolve(true);
      existing.addEventListener('load', () => resolve(typeof window.LegBones?.solveFixedTwoBoneChain === 'function'), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
    });
    return new Promise(resolve => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve(typeof window.LegBones?.solveFixedTwoBoneChain === 'function');
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  function waitForRealButton(attempt = 0) { // Opens the real Ground / Carry panel after its author finishes asynchronous setup.
    const real = document.getElementById(REAL_BUTTON_ID);
    if (real) {
      real.click();
      status('Ground / Carry opened · legacy portrait renderer untouched');
      return;
    }
    if (attempt < 120) requestAnimationFrame(() => waitForRealButton(attempt + 1));
    else status('Ground / Carry loaded, but its panel button was not created.', false);
  }

  async function activateGroundCarry() { // The only path that is allowed to load the new pose author.
    if (activating) return;
    activating = true;
    const bootButton = document.getElementById(BOOT_BUTTON_ID);
    if (bootButton) {
      bootButton.disabled = true;
      bootButton.textContent = 'Loading Ground / Carry…';
    }

    protectLegacyYaw(); // Capture the old animator's facing before any new pose code exists.
    status('Loading Ground / Carry on top of the legacy animator…');
    const solverReady = await ensureBranchFixedLegSolver();
    if (!solverReady) {
      activating = false;
      if (bootButton) {
        bootButton.disabled = false;
        bootButton.textContent = 'Ground / Carry';
      }
      status('Ground / Carry fixed-length leg solver failed to load.', false);
      return;
    }

    if (window.HobunjiProceduralLimbPoseAuthor === dormantAuthorSentinel) delete window.HobunjiProceduralLimbPoseAuthor;
    bootButton?.remove(); // Frees the canonical quick-button slot before the real author creates its own button.

    const existing = document.getElementById(AUTHOR_SCRIPT_ID);
    if (existing) {
      waitForRealButton();
      return;
    }

    const script = document.createElement('script');
    script.id = AUTHOR_SCRIPT_ID;
    script.src = new URL('js/procedural-limb-pose-author.js?v=20260902-legacybase', DOCS_BASE).href;
    script.defer = true;
    script.onload = () => {
      protectLegacyYaw();
      waitForRealButton();
    };
    script.onerror = () => {
      activating = false;
      window.HobunjiProceduralLimbPoseAuthor = dormantAuthorSentinel;
      ensureBootstrapButton();
      status('Ground / Carry pose author failed to load.', false);
    };
    document.head.appendChild(script);
  }

  function ensureBootstrapButton() { // Adds a lightweight opt-in entry without loading or running any Ground / Carry pose code.
    if (document.getElementById(REAL_BUTTON_ID) || document.getElementById(BOOT_BUTTON_ID)) return true;
    const actionRow = document.querySelector('#animationHud .animationHudActions');
    if (!actionRow) return false;
    const button = document.createElement('button');
    button.id = BOOT_BUTTON_ID;
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Ground / Carry';
    button.title = 'Load Ground / Carry without changing the legacy animator until explicitly opened';
    button.addEventListener('click', activateGroundCarry);
    actionRow.appendChild(button);
    return true;
  }

  function bootstrapFrame() { // Waits for the old animator HUD/avatar and otherwise leaves its render/update loop completely alone.
    ensureBootstrapButton();
    requestAnimationFrame(bootstrapFrame);
  }

  window.addEventListener('hobunji-backdrop-avatar-changed', () => {
    // Do not alter the fresh avatar. If Ground / Carry has already been
    // explicitly activated, capture the fresh old-tool yaw before its next
    // zero-yaw pose write.
    if (window.HobunjiProceduralLimbPoseAuthor && window.HobunjiProceduralLimbPoseAuthor !== dormantAuthorSentinel) protectLegacyYaw();
  });

  window.HobunjiProceduralLimbFacingPreserver = {
    version: 7,
    mode: 'legacy-renderer-preserving-lazy-bootstrap',
    activateGroundCarry,
    ensureBranchFixedLegSolver,
    protectLegacyYaw,
    getBaselineYaw: () => {
      const root = currentPoseRoot();
      return root ? baselines.get(root) ?? null : null;
    },
  };

  requestAnimationFrame(bootstrapFrame);
})();
