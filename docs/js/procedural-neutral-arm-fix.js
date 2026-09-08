// Procedural Animation Editor: exact unarmed-NPC hand parity.
//
// Normal weaponless NPCs do not render generated upper/forearms. Their arms are
// already painted into the PNG-plane character; the runtime adds only GLB hands.
// This editor bridge therefore does not solve, draw, or infer a neutral arm chain.
// It loads the same direct-hand runtime stack as gameplay, adopts the current
// preview avatar into that stack, and hides the editor-only duplicate hands/arm
// guides while no procedural limb mode owns them.
(function (global) {
  'use strict';

  if (global.HobunjiProceduralNeutralArms?.installed) return;

  const SELF_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : new URL('./procedural-neutral-arm-fix.js', location.href); // Same-revision base used for every runtime parity dependency below.
  const DANCE_ROOT_SUFFIX = '_procedural_arms'; // Editor-only Dance arm visualization hidden in ordinary neutral.
  const CARRY_ROOT_SUFFIX = '_carry_arms'; // Editor-only Carry arm visualization hidden in ordinary neutral.
  const GROUND_GUIDE_ROOT = 'ProceduralGroundRestNativeGuides'; // Ground/Rest debug chain hidden when Ground/Rest does not own the limbs.
  const FRAME_DRIVER_GRACE_FRAMES = 6; // Gives the real frame driver a few renders to adopt avatars built after its wrapper loads before the editor falls back to direct attach.

  const state = { // Runtime-parity binding, visibility ownership, and mobile diagnostics.
    THREE: null,
    runtimeReady: false,
    scene: null,
    priorSceneBeforeRender: null,
    hookInstalled: false,
    model: null,
    rig: null,
    rigOwner: null,
    handParent: null,
    adoptAttempts: 0,
    lastMode: null,
    hiddenNodes: new Set(),
    originalVisibility: new WeakMap(),
    lastLoggedModel: null,
    debug: { installed: true, runtimeReady: false, mode: 'loading-runtime' },
  };

  function editorLog(message, level = 'info', extra = null) {
    const logger = global.HobunjiGameplayBackdrop?.log; // Existing copyable Diagnostics surface keeps this usable on mobile.
    if (logger) { logger(message, level, extra); return; }
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
    console[method]?.(message, extra ?? '');
  }

  function resolveScript(relativePath) {
    return new URL(relativePath, SELF_URL).href; // Preserves commit-pinned RawGitHack/GitHub revision instead of falling back to main.
  }

  function scriptAlreadyPresent(url) {
    const target = new URL(url, location.href).href.split('#')[0];
    return [...document.scripts].some(script => {
      if (!script.src) return false;
      try { return new URL(script.src, location.href).href.split('#')[0] === target; }
      catch (_) { return false; }
    });
  }

  function loadScript(relativePath, ready = null) {
    if (ready?.()) return Promise.resolve();
    const src = resolveScript(relativePath);
    if (scriptAlreadyPresent(src)) {
      if (ready?.()) return Promise.resolve();
      return new Promise(resolve => requestAnimationFrame(() => resolve()));
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = false;
      script.src = src;
      script.dataset.hobunjiProceduralNeutralParity = '1';
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${relativePath}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  async function loadRuntimeHandStack() {
    // This order mirrors held-action-animations.js / gameplay hand bootstrap.
    const modules = await global.PNGPlaneAvatar?.loadThreeModules?.();
    state.THREE = modules?.THREE || global.THREE || null;
    if (!state.THREE) throw new Error('Procedural editor Three.js instance is unavailable.');
    if (!global.THREE) global.THREE = state.THREE; // Late forearm-alignment runtime reads window.THREE at module evaluation.

    await loadScript('../config/hand-shoulder-points.js', () => !!global.HobunjiHandShoulderPoints);
    await loadScript('../config/hand-shoulder-pose-profiles.js');
    await loadScript('procedural-hand-foot-material-roles.js');
    await loadScript('hand-tool-grips.js', () => !!global.HobunjiHandToolGrips);
    await loadScript('hand-grip-modes.js', () => !!global.HobunjiHandGripModes);
    await loadScript('hand-shoulder-pose-runtime.js', () => !!global.HobunjiHandShoulderPoseRuntime);
    await loadScript('portrait-arm-cloud-mask.js');
    await loadScript('portrait-hand-shoulder-scan.js', () => !!global.PortraitHandShoulderScan);
    await loadScript('portrait-hand-shoulder-scan-species.js');
    await loadScript('procedural-hand-attachments.js', () => !!global.ProceduralHandAttachments?.attach);
    await loadScript('procedural-hand-outline-parity.js', () => !!global.ProceduralHandAttachments?.attach?.__hobunjiHandOutlineParityWrapped);
    await loadScript('attachment-rig-latest-authored-snapshot.js');
    await loadScript('procedural-hand-scale-free-world.js', () => !!global.ProceduralHandScaleFreeWorld);
    await loadScript('procedural-hand-shoulder-aim.js', () => !!global.ProceduralHandAttachments?.attach?.__hobunjiShoulderAimWrapped);
    await loadScript('procedural-hand-frame-driver.js', () => !!global.ProceduralHandFrameDriver);
    await loadScript('procedural-hand-forearm-alignment-runtime.js', () => !!global.ProceduralHandForearmAlignmentRuntime);

    state.runtimeReady = !!global.ProceduralHandAttachments?.attach && !!global.ProceduralHandFrameDriver;
    if (!state.runtimeReady) throw new Error('Runtime direct-hand stack loaded incompletely.');
  }

  function currentModel() {
    return global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
  }

  function selectedNpc() {
    return global.HobunjiGameplayBackdrop?.getSelectedNpc?.() || {};
  }

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  }

  function runtimeIdentity(model) {
    const npc = selectedNpc(); // Same appearance/profile data supplied to PNGPlaneAvatar when the preview actor was built.
    const appearance = npc.appearance || npc.profile?.appearance || npc.fighter?.appearance || {};
    return {
      speciesId: normalizeKey(appearance.speciesId || appearance.species || npc.species || model?.userData?.speciesId || 'mao-ao'),
      gender: normalizeGender(appearance.gender || npc.gender || model?.userData?.gender || 'male'),
      bodyColors: appearance.bodyColors || npc.profile?.bodyColors || npc.bodyColors || null,
      profile: npc.profile || npc.fighter || null,
    };
  }

  function runtimeHandParent(model) {
    // The editor's floor-relative locomotion root is model.parent.parent.parent,
    // matching its Ground/Rest Manual IK bridge and the authoring-preview hook
    // supported by ProceduralHandFrameDriver.attachPending().
    return model?.userData?.proceduralHandParent || model?.parent?.parent?.parent || model?.parent || null;
  }

  function cleanupBoundModel() {
    restoreHiddenNodes();
    if (state.model && state.rigOwner === 'editor-parity-fallback' && state.rig) {
      try { state.rig.dispose?.(); }
      catch (error) { editorLog(`[Neutral arms] Runtime fallback rig dispose failed: ${error?.message || error}`, 'warn'); }
      if (state.model.userData?.proceduralHandRig === state.rig) state.model.userData.proceduralHandRig = null;
    }
    state.model = null;
    state.rig = null;
    state.rigOwner = null;
    state.handParent = null;
    state.adoptAttempts = 0;
    state.lastMode = null;
  }

  function adoptExistingRig(model) {
    const rig = model?.userData?.proceduralHandRig || null; // Future preview avatars are normally attached by the real frame driver wrapper itself.
    if (!rig) return null;
    state.rig = rig;
    state.rigOwner = rig.__hobunjiProceduralEditorRuntimeParity ? 'editor-parity-fallback' : 'frame-driver';
    state.handParent = rig.parent || runtimeHandParent(model);
    return rig;
  }

  function attachCurrentAvatarThroughRuntime(model) {
    const hands = global.ProceduralHandAttachments;
    if (!hands?.attach || !state.THREE || !model?.parent) return null;
    const identity = runtimeIdentity(model);
    const handParent = runtimeHandParent(model);
    if (!handParent) return null;
    model.userData ||= {};
    model.userData.proceduralHandParent = handParent; // Exact authoring-preview escape hatch consumed by the real frame driver.
    const rig = hands.attach(state.THREE, handParent, {
      speciesId: identity.speciesId,
      gender: identity.gender,
      bodyColors: identity.bodyColors,
      profile: identity.profile,
      sourceCanvas: model.userData?.sourceCanvas || null,
      modelHeight: model.userData?.portraitModelHeight,
      handAttachX: model.userData?.handAttachX,
      handAttachY: model.userData?.handAttachY,
      avatarRoot: model,
      name: model.name || 'avatar',
    });
    if (!rig) return null;
    Object.defineProperty(rig, '__hobunjiProceduralEditorRuntimeParity', { value: true, configurable: true });
    model.userData.proceduralHandRig = rig;
    state.rig = rig;
    state.rigOwner = 'editor-parity-fallback';
    state.handParent = handParent;
    return rig;
  }

  function ensureModelRig(model) {
    if (state.model !== model) {
      cleanupBoundModel();
      state.model = model;
      state.adoptAttempts = 0;
    }
    if (state.rig && model?.userData?.proceduralHandRig === state.rig) return state.rig;
    if (adoptExistingRig(model)) return state.rig;

    // The frame driver wraps PNGPlaneAvatar builds. Give it a few exact syncs
    // before directly attaching only the avatar that predates that wrapper.
    global.ProceduralHandFrameDriver?.syncNow?.();
    if (adoptExistingRig(model)) return state.rig;
    if (state.adoptAttempts++ < FRAME_DRIVER_GRACE_FRAMES) return null;
    return attachCurrentAvatarThroughRuntime(model);
  }

  function currentMode() {
    if (global.ProceduralGroundRestManualBridge?.getDebug?.()?.active) return 'ground-manual';
    const groundPose = global.HobunjiProceduralLimbPoseAuthor?.getDebug?.()?.pose || 'normal';
    if (groundPose !== 'normal') return 'ground-preset';
    if (global.ProceduralCarryWalkMode?.getDebug?.()?.enabled) return 'carry';
    if (global.ProceduralDanceMode?.getDebug?.()?.enabled) return 'dance';
    return 'neutral';
  }

  function directEditorHandRoot(model) {
    const expected = `${model?.name || 'Avatar'}_procedural_hands`; // buildExperimentalHandsForAvatar() parents this duplicate root directly under the model.
    return model?.children?.find?.(child => child?.name === expected && child !== state.rig?.group) || null;
  }

  function findNamedRoot(model, name) {
    return model?.getObjectByName?.(name) || null;
  }

  function groundGuideRoot(model) {
    const locomotion = runtimeHandParent(model); // Same locomotion root that owns Ground/Rest's guide hierarchy.
    return locomotion?.getObjectByName?.(GROUND_GUIDE_ROOT) || null;
  }

  function hideNode(node) {
    if (!node || state.hiddenNodes.has(node)) return;
    state.originalVisibility.set(node, node.visible !== false);
    state.hiddenNodes.add(node);
    node.visible = false;
  }

  function restoreNode(node) {
    if (!node || !state.hiddenNodes.has(node)) return;
    node.visible = state.originalVisibility.get(node) !== false;
    state.hiddenNodes.delete(node);
  }

  function restoreHiddenNodes() {
    for (const node of [...state.hiddenNodes]) restoreNode(node);
  }

  function applyVisibilityForMode(model, mode) {
    if (mode !== state.lastMode) {
      restoreHiddenNodes(); // Return ownership cleanly before applying the next mode's visibility contract.
      state.lastMode = mode;
    }
    const runtimeGroup = state.rig?.group || null;
    const duplicateHands = directEditorHandRoot(model);
    const danceArms = findNamedRoot(model, `${model.name || 'Avatar'}${DANCE_ROOT_SUFFIX}`);
    const carryArms = findNamedRoot(model, `${model.name || 'Avatar'}${CARRY_ROOT_SUFFIX}`);
    const groundGuides = groundGuideRoot(model);

    if (mode === 'neutral') {
      restoreNode(runtimeGroup); // Real game hand stack is the only extra 3D limb geometry in ordinary neutral.
      hideNode(duplicateHands); // The editor's separately loaded GLB hand markers are not the runtime rig.
      hideNode(danceArms); // Painted PNG arms remain visible; virtual arm chains do not.
      hideNode(carryArms);
      hideNode(groundGuides);
    } else {
      hideNode(runtimeGroup); // Explicit authoring modes retain their existing draggable/generated hand/arm presentation without double hands.
      restoreNode(duplicateHands);
      restoreNode(danceArms);
      restoreNode(carryArms);
      restoreNode(groundGuides);
    }

    return { runtimeGroup, duplicateHands, danceArms, carryArms, groundGuides };
  }

  function applyExactStationaryIdle(model, rig) {
    if (!rig) return;
    if (state.rigOwner === 'frame-driver') {
      global.ProceduralHandFrameDriver?.syncNow?.(); // Use gameplay's own idle/walk fallback when the real manager owns this avatar.
      return;
    }

    // Current preview avatar existed before the frame-driver wrapper loaded, so
    // reproduce only the frame driver's stationary fallback and still feed it
    // through the REAL wrapped setSideIdle() shoulder/scale/orientation stack.
    const modelHeight = Math.max(0.1, Number(model?.userData?.portraitModelHeight) || 0.9);
    const timeSeconds = performance.now() / 1000;
    for (const side of ['left', 'right']) {
      const idleBreath = Math.sin(timeSeconds * 2.15 + (side === 'left' ? 0 : Math.PI)) * modelHeight * 0.0035;
      rig.setSideIdle?.(side, {
        position: { x: 0, y: idleBreath, z: 0 },
        rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
      });
    }
  }

  function vectorRecord(vector) {
    if (!vector) return null;
    return {
      x: Number((Number(vector.x) || 0).toFixed(5)),
      y: Number((Number(vector.y) || 0).toFixed(5)),
      z: Number((Number(vector.z) || 0).toFixed(5)),
    };
  }

  function quaternionRecord(quaternion) {
    if (!quaternion) return null;
    return {
      x: Number((Number(quaternion.x) || 0).toFixed(5)),
      y: Number((Number(quaternion.y) || 0).toFixed(5)),
      z: Number((Number(quaternion.z) || 0).toFixed(5)),
      w: Number((Number(quaternion.w) || 1).toFixed(5)),
    };
  }

  function socketSnapshot(side) {
    const socket = state.rig?.group?.getObjectByName?.(`${side}_hand_socket`) || null; // Actual runtime socket, not the editor duplicate wrapper.
    return socket ? { position: vectorRecord(socket.position), quaternion: quaternionRecord(socket.quaternion), visible: socket.visible !== false } : null;
  }

  function updateParityBeforeRender() {
    if (!state.runtimeReady) return;
    const model = currentModel();
    if (!model) {
      if (state.model) cleanupBoundModel();
      return;
    }
    const rig = ensureModelRig(model);
    const mode = currentMode();
    if (!rig) {
      state.debug = { installed: true, runtimeReady: true, mode, rigOwner: 'waiting-for-frame-driver', adoptAttempts: state.adoptAttempts };
      return;
    }

    const visibility = applyVisibilityForMode(model, mode);
    if (mode === 'neutral') applyExactStationaryIdle(model, rig);

    state.debug = {
      installed: true,
      runtimeReady: true,
      mode,
      source: 'ProceduralHandAttachments + ProceduralHandFrameDriver + procedural-hand-shoulder-aim',
      armPresentation: mode === 'neutral' ? 'painted PNG-plane arm sprites; no generated neutral arm chain' : 'procedural authoring mode owns limbs',
      rigOwner: state.rigOwner,
      handParent: state.handParent?.name || state.handParent?.type || null,
      duplicateEditorHandsHidden: mode === 'neutral' ? visibility.duplicateHands?.visible === false : null,
      danceArmGuideHidden: mode === 'neutral' ? visibility.danceArms?.visible === false : null,
      carryArmGuideHidden: mode === 'neutral' ? visibility.carryArms?.visible === false : null,
      left: socketSnapshot('left'),
      right: socketSnapshot('right'),
    };

    if (mode === 'neutral' && state.lastLoggedModel !== model) {
      state.lastLoggedModel = model;
      editorLog('[Neutral arms] Runtime unarmed-NPC parity active: painted sprite arms + real procedural hand rig; editor virtual neutral arms hidden.', 'info', state.debug);
    }
  }

  function installSceneHook() {
    const scene = global.HobunjiGameplayBackdrop?.getScene?.() || null;
    if (!scene) return false;
    if (state.scene === scene && state.hookInstalled) return true;
    if (state.scene && state.hookInstalled && state.scene.onBeforeRender === state.boundBeforeRender) {
      state.scene.onBeforeRender = state.priorSceneBeforeRender || null;
    }
    state.scene = scene;
    state.priorSceneBeforeRender = typeof scene.onBeforeRender === 'function' ? scene.onBeforeRender : null;
    state.boundBeforeRender = function proceduralUnarmedNpcParityBeforeRender() {
      state.priorSceneBeforeRender?.apply(this, arguments);
      try { updateParityBeforeRender(); }
      catch (error) {
        state.debug = { ...state.debug, error: String(error?.message || error) };
        editorLog(`[Neutral arms] Runtime NPC parity update failed: ${error?.stack || error}`, 'error');
      }
    };
    scene.onBeforeRender = state.boundBeforeRender;
    state.hookInstalled = true;
    return true;
  }

  async function bootstrap() {
    try {
      await loadRuntimeHandStack();
      state.debug = { installed: true, runtimeReady: true, mode: 'waiting-for-preview' };
      editorLog('[Neutral arms] Loaded gameplay unarmed-hand runtime stack for procedural-editor parity.', 'info');
    } catch (error) {
      state.debug = { installed: true, runtimeReady: false, mode: 'runtime-load-failed', error: String(error?.message || error) };
      editorLog(`[Neutral arms] Runtime hand stack failed to load: ${error?.stack || error}`, 'error');
      return;
    }

    let attempts = 0;
    const seekScene = () => {
      if (installSceneHook()) return;
      if (attempts++ < 2400) requestAnimationFrame(seekScene);
      else editorLog('[Neutral arms] Timed out waiting for procedural-editor scene.', 'error');
    };
    requestAnimationFrame(seekScene);
  }

  global.HobunjiProceduralNeutralArms = Object.freeze({
    installed: true,
    mode: 'runtime-unarmed-npc-parity',
    getDebug: () => JSON.parse(JSON.stringify(state.debug)),
    resolveNeutralFrame(model = currentModel()) {
      if (!model || state.model !== model || !state.rig) return null;
      return {
        source: 'runtime-hand-sockets',
        rigOwner: state.rigOwner,
        left: socketSnapshot('left'),
        right: socketSnapshot('right'),
      };
    },
  });

  bootstrap();
})(window);
