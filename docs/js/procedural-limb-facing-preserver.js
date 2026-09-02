// Procedural Animation Editor Ground / Carry bootstrap + avatar-preview parity.
//
// The Attack Animation Editor is the known-good character preview. It opts
// into PNGPlaneAvatar's neck-rigged/skinned portrait assembly, while the older
// Procedural Movement Animator historically omitted that option and therefore
// stayed on the rigid two-Mesh front/back path. This adapter fixes that at the
// shared avatar-construction seam without rewriting the 2 MB editor HTML.
//
// Responsibilities:
//   1. make procedural NPC preview builds request the same `neckRig: true`
//      assembly used by the Attack Animation Editor;
//   2. rebuild the already-selected startup NPC once through that corrected
//      construction path so the first visible preview is fixed too;
//   3. leave creatures and unrelated tools untouched;
//   4. keep Ground / Carry lazy-loaded and preserve the legacy animator's
//      established pose-root yaw when the optional pose author is activated;
//   5. load the branch-paired fixed two-bone solver Ground / Carry requires.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbFacingPreserver) return;

  const SCRIPT_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null; // Used to keep new dependencies on this exact GitHack branch/commit.
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL) : new URL('../../', location.href); // Resolves docs/ beside this bootstrap script.
  const BOOT_BUTTON_ID = 'limbPoseLazyBootstrapBtn'; // Temporary entry button used before the heavy Ground / Carry author is loaded.
  const REAL_BUTTON_ID = 'limbPoseQuickBtn'; // Existing button created by procedural-limb-pose-author.js after explicit activation.
  const AUTHOR_SCRIPT_ID = 'proceduralLimbPoseAuthorExplicitScript'; // Prevents duplicate explicit author loads.
  const PARITY_FLAG = '__hobunjiProceduralAttackPreviewParity'; // Marks the wrapped shared avatar builder so repeated bootstrap passes never double-wrap it.
  const baselines = new WeakMap(); // Stores the old animator's exact pose-root yaw before Ground / Carry can write to it.
  const wrappedRotations = new WeakMap(); // Stores original Euler.set methods so each pose root is wrapped once.
  let activating = false; // Prevents rapid taps from launching duplicate dependency/author requests.
  let initialParityRefreshDone = false; // Ensures the selected startup NPC is rebuilt only once after the builder is wrapped.

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
    (good ? console.info : console.warn)(`[Procedural preview] ${message}`);
  }

  function currentBackdrop() { // Centralizes access to the public preview API used by parity diagnostics and Ground / Carry.
    return window.HobunjiGameplayBackdrop || null;
  }

  function currentAvatarModel() { // Returns only character/NPC preview models; creature preview construction is intentionally untouched.
    const backdrop = currentBackdrop();
    if (!backdrop || backdrop.getPreviewMode?.() !== 'npc') return null;
    return backdrop.getAvatarModel?.() || null;
  }

  function currentPoseRoot() { // Reads only the public preview API; no giant-editor private state is reached into.
    return currentAvatarModel()?.parent || null;
  }

  function isProceduralNpcBuild(options) { // Matches the editor's repository-NPC build signature without affecting unrelated raw portrait callers.
    return Boolean(options?.npcRecord || options?.profile || options?.appearance);
  }

  function installAttackEditorAvatarParity() { // Forces the known-good Attack Editor assembly mode at the shared PNGPlaneAvatar construction seam.
    const avatarApi = window.PNGPlaneAvatar;
    const currentBuild = avatarApi?.buildSinglePlaneAvatarModel;
    if (typeof currentBuild !== 'function') return false;
    if (currentBuild[PARITY_FLAG]) return true;

    const wrappedBuild = function proceduralAttackPreviewParityBuild(THREE, sourceCanvas, options = {}) {
      const npcBuild = isProceduralNpcBuild(options); // Creatures use another API; generic raw portrait utilities remain opt-in as before.
      const buildOptions = npcBuild && options.neckRig !== true
        ? { ...options, neckRig: true }
        : options; // Mirrors Attack Animation Editor's explicit `neckRig: true` without disturbing an already-authored true value.
      const avatarRoot = currentBuild.call(this, THREE, sourceCanvas, buildOptions); // Preserves every wrapper already installed around the shared builder.
      if (npcBuild && avatarRoot?.userData) {
        avatarRoot.userData.proceduralPreviewParity = {
          referenceTool: 'attack-animation-editor',
          neckRigRequested: true,
          neckRigAvailable: Boolean(avatarRoot.userData.neckRig?.available),
        }; // Mobile/debug-readable proof of which construction path was requested and whether head detection succeeded.
      }
      return avatarRoot;
    };
    wrappedBuild[PARITY_FLAG] = true;
    wrappedBuild.__hobunjiOriginalBuild = currentBuild; // Keeps the wrapper chain inspectable and reversible during debugging.
    avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;
    console.info('[Procedural preview] NPC avatar builder now matches Attack Animation Editor neck-rig mode.');
    return true;
  }

  function refreshSelectedNpcThroughParity(attempt = 0) { // Reuses the editor's own selected-card handler so no duplicate avatar/render pipeline is introduced.
    if (initialParityRefreshDone) return;
    if (!installAttackEditorAvatarParity()) {
      if (attempt < 240) requestAnimationFrame(() => refreshSelectedNpcThroughParity(attempt + 1));
      return;
    }

    const backdrop = currentBackdrop();
    const model = currentAvatarModel();
    if (!backdrop || !model) {
      if (attempt < 240) requestAnimationFrame(() => refreshSelectedNpcThroughParity(attempt + 1));
      return;
    }

    if (model.userData?.neckRig?.available) {
      initialParityRefreshDone = true;
      model.userData.proceduralPreviewParity = {
        ...(model.userData.proceduralPreviewParity || {}),
        referenceTool: 'attack-animation-editor',
        neckRigRequested: true,
        neckRigAvailable: true,
        startupRebuildNeeded: false,
      };
      status('Avatar preview matches Attack Editor · skinned neck rig active');
      return;
    }

    const selectedCard = document.querySelector('#npcList .npcCard.selected'); // Uses the already-wired repository NPC selection handler to perform one canonical rebuild.
    if (!selectedCard) {
      if (attempt < 240) requestAnimationFrame(() => refreshSelectedNpcThroughParity(attempt + 1));
      return;
    }

    initialParityRefreshDone = true; // Set before click so synchronous selection handlers cannot recurse into another startup rebuild.
    selectedCard.click();
    status('Rebuilding avatar preview through Attack Editor neck-rig path…');
  }

  function reportParityForFreshAvatar() { // Gives mobile users a visible diagnostic after each ordinary NPC selection/rebuild.
    const model = currentAvatarModel();
    if (!model) return;
    const parity = model.userData?.proceduralPreviewParity;
    const neckRigAvailable = Boolean(model.userData?.neckRig?.available);
    if (parity?.neckRigRequested && neckRigAvailable) {
      status('Avatar preview matches Attack Editor · skinned neck rig active');
    } else if (parity?.neckRigRequested) {
      status('Attack-style neck rig requested, but this portrait could not detect a neck pivot.', false);
    }
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
      status('Ground / Carry opened · Attack-style avatar preview retained');
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
    status('Loading Ground / Carry on top of the Attack-style avatar preview…');
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
    button.title = 'Load Ground / Carry without changing the procedural animator until explicitly opened';
    button.addEventListener('click', activateGroundCarry);
    actionRow.appendChild(button);
    return true;
  }

  function bootstrapFrame() { // Waits for the old animator HUD/avatar while keeping the parity wrapper installed for every subsequent NPC rebuild.
    installAttackEditorAvatarParity();
    ensureBootstrapButton();
    requestAnimationFrame(bootstrapFrame);
  }

  window.addEventListener('hobunji-backdrop-api-ready', () => {
    installAttackEditorAvatarParity();
    requestAnimationFrame(() => refreshSelectedNpcThroughParity());
  });

  window.addEventListener('hobunji-backdrop-avatar-changed', () => {
    // Fresh ordinary NPC selections now come through the wrapped constructor.
    // Ground / Carry, when active, still captures each new pose-root yaw before
    // its next zero-yaw pose write.
    if (window.HobunjiProceduralLimbPoseAuthor && window.HobunjiProceduralLimbPoseAuthor !== dormantAuthorSentinel) protectLegacyYaw();
    requestAnimationFrame(reportParityForFreshAvatar);
  });

  window.HobunjiProceduralLimbFacingPreserver = {
    version: 8,
    mode: 'attack-editor-avatar-parity-lazy-ground-carry',
    activateGroundCarry,
    ensureBranchFixedLegSolver,
    installAttackEditorAvatarParity,
    refreshSelectedNpcThroughParity,
    protectLegacyYaw,
    getBaselineYaw: () => {
      const root = currentPoseRoot();
      return root ? baselines.get(root) ?? null : null;
    },
    getPreviewParityDebug: () => {
      const model = currentAvatarModel();
      return model ? {
        neckRigAvailable: Boolean(model.userData?.neckRig?.available),
        parity: model.userData?.proceduralPreviewParity || null,
      } : null;
    },
  };

  installAttackEditorAvatarParity();
  requestAnimationFrame(() => refreshSelectedNpcThroughParity());
  requestAnimationFrame(bootstrapFrame);
})();
