// Presentation bridge for the rescue prologue dialogue test.
//
// PrologueDialogueRuntime owns scripted speakers/lines, but the actual rendered
// shoulder-camera orbit/target/input state lives inside game.js. This bridge
// adapts those private edges through the game's existing injected setters,
// Shoulder Cam settings listener, and __climbDebug camera functions. The result
// stays a real player-anchored Shoulder Cam: scripted speakers only choose its
// look direction; they never become camera anchors.
(() => {
  'use strict';

  const RESCUE_MAP_ID = 'map_prologue_rescue';
  const SHOULDER_MODE = 'shoulderSurf';
  const RETRY_MS = 80;
  const DIALOGUE_DISTANCE_TILES = 1.8; // Noticeable dialogue push-in from the ordinary 2.6-tile shoulder distance.
  const DIALOGUE_FOV_DEG = 50; // Slightly narrower than ordinary Shoulder Cam (55°) without becoming a detached close-up.
  const DIALOGUE_FOLLOW_LERP = 1; // Scripted dialogue must not visibly lerp inward from the previous map/camera target.

  let rawCameraDeps = null;
  let aimDeps = null;
  let requestedSpeakerTarget = null;
  let lastSpeakerNpcId = null;
  let dialogueObserver = null;
  let arcObserver = null;
  let observerRetry = 0;
  let recenterCount = 0;
  let guiReassertions = 0;
  let renderedTargetSnaps = 0;
  let inputBlocks = 0;
  let takeoverStarts = 0;
  let takeoverActive = false;
  let savedShoulderConfig = null;
  let lastYawRad = null;
  let lastStatus = 'boot';
  let lastError = null;

  function debugLog(message, level = 'info') {
    const logger = window.__farmLog;
    if (typeof logger === 'function') {
      try { logger(`[prologue-presentation] ${message}`, level, 'camera'); return; } catch (_) {}
    }
    console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](`[prologue-presentation] ${message}`);
  }

  function snapshot() {
    try { return window.PrologueDialogueRuntime?.debugSnapshot?.() || null; }
    catch (_) { return null; }
  }

  function currentArea() {
    try { return window.GridTileAccessors?.getCurrentArea?.() || snapshot()?.currentArea || null; }
    catch (_) { return snapshot()?.currentArea || null; }
  }

  function prologueSessionActive() {
    const state = snapshot();
    return currentArea() === RESCUE_MAP_ID
      && state?.sessionActive === true
      && state?.testFinished !== true;
  }

  function speakerRoot(npcId = snapshot()?.speakerNpcId) {
    const id = String(npcId || '');
    if (!id) return requestedSpeakerTarget?.userData?.prologueActor ? requestedSpeakerTarget : null;
    if (requestedSpeakerTarget?.userData?.prologueNpcId === id) return requestedSpeakerTarget;
    const scene = window.GridTileAccessors?.getActiveScene?.();
    let found = null;
    if (scene?.children) {
      const stack = [...scene.children];
      while (stack.length && !found) {
        const node = stack.shift();
        if (node?.userData?.prologueNpcId === id) found = node;
        else if (node?.children?.length) stack.push(...node.children);
      }
    }
    return found;
  }

  function playerAndTile() {
    const player = aimDeps?.player || rawCameraDeps?.player || window.__climbDebug?.getPlayer?.() || null;
    const tile = Number(aimDeps?.TILE ?? rawCameraDeps?.TILE) || 1;
    return { player, tile };
  }

  function yawToward(root) {
    const { player, tile } = playerAndTile();
    const tx = Number(root?.position?.x);
    const tz = Number(root?.position?.z);
    const px = Number(player?.x) / tile;
    const pz = Number(player?.y) / tile;
    if (![tx, tz, px, pz].every(Number.isFinite)) return null;
    return Math.atan2(tz - pz, tx - px);
  }

  function shoulderConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.[SHOULDER_MODE] || null;
  }

  function saveShoulderConfig() {
    if (savedShoulderConfig) return;
    const cfg = shoulderConfig();
    if (!cfg) return;
    savedShoulderConfig = {};
    for (const key of ['distanceTiles', 'fovDeg', 'followLerp', 'freeRotate']) {
      savedShoulderConfig[key] = { own: Object.prototype.hasOwnProperty.call(cfg, key), value: cfg[key] };
    }
  }

  function applyDialogueShoulderConfig() {
    const cfg = shoulderConfig();
    if (!cfg) return false;
    saveShoulderConfig();
    cfg.distanceTiles = DIALOGUE_DISTANCE_TILES;
    cfg.fovDeg = DIALOGUE_FOV_DEG;
    cfg.followLerp = DIALOGUE_FOLLOW_LERP;
    cfg.freeRotate = false;
    return true;
  }

  function restoreShoulderConfig() {
    if (!savedShoulderConfig) return false;
    const cfg = shoulderConfig();
    if (!cfg) { savedShoulderConfig = null; return false; }
    for (const [key, record] of Object.entries(savedShoulderConfig)) {
      if (record.own) cfg[key] = record.value;
      else delete cfg[key];
    }
    savedShoulderConfig = null;
    return true;
  }

  function dispatchShoulderRecenter() {
    const toggle = document.getElementById('settingShoulderSurf');
    if (!toggle) return false;
    toggle.checked = true;
    try {
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function snapRenderedCameraToPlayer() {
    if (!prologueSessionActive()) return false;
    try {
      rawCameraDeps?.setCameraTarget?.(null);
      rawCameraDeps?.setCameraMode?.(SHOULDER_MODE);
      applyDialogueShoulderConfig();
      window.__climbDebug?.snapCameraTarget?.();
      window.__climbDebug?.updateCameraPosition?.();
      renderedTargetSnaps += 1;
      return true;
    } catch (error) {
      lastError = String(error?.message || error);
      lastStatus = `rendered-camera-snap-error:${lastError}`;
      return false;
    }
  }

  function recenterTowardSpeaker(root = speakerRoot()) {
    if (!root || !prologueSessionActive()) return false;
    const state = snapshot();
    const speakerId = state?.speakerNpcId || root?.userData?.prologueNpcId || null;
    const yaw = yawToward(root);
    if (!Number.isFinite(yaw)) {
      lastStatus = 'speaker-yaw-unavailable';
      return false;
    }

    const { player } = playerAndTile();
    const priorFacing = Number(rawCameraDeps?.getFacingAngle?.());
    const priorPlayerAngle = Number(player?.angle);
    try {
      // Shoulder Cam's native setting listener owns cameraAzimuthOffsetDeg.
      // Feed it the desired speaker bearing only for the synchronous recenter
      // call, then restore character facing immediately. This rotates the
      // camera without turning or relocating the player.
      if (Number.isFinite(priorFacing)) rawCameraDeps?.setFacingAngle?.(yaw);
      else aimDeps?.setFacingAngle?.(yaw);
      if (player) player.angle = yaw;

      rawCameraDeps?.setCameraTarget?.(null);
      rawCameraDeps?.setCameraMode?.(SHOULDER_MODE);
      applyDialogueShoulderConfig();
      const recentered = dispatchShoulderRecenter();

      if (Number.isFinite(priorFacing)) rawCameraDeps?.setFacingAngle?.(priorFacing);
      if (player && Number.isFinite(priorPlayerAngle)) player.angle = priorPlayerAngle;

      snapRenderedCameraToPlayer();
      lastSpeakerNpcId = speakerId;
      lastYawRad = yaw;
      recenterCount += 1;
      lastError = null;
      lastStatus = recentered ? `shoulder-focus:${speakerId || 'speaker'}` : `shoulder-mode:${speakerId || 'speaker'}`;
      debugLog(`Shoulder Cam focus → ${speakerId || 'speaker'} (${(yaw * 180 / Math.PI).toFixed(1)}°), ${DIALOGUE_DISTANCE_TILES.toFixed(1)} tiles`);
      return true;
    } catch (error) {
      if (Number.isFinite(priorFacing)) rawCameraDeps?.setFacingAngle?.(priorFacing);
      if (player && Number.isFinite(priorPlayerAngle)) player.angle = priorPlayerAngle;
      lastError = String(error?.message || error);
      lastStatus = `recenter-error:${lastError}`;
      debugLog(lastStatus, 'warn');
      return false;
    }
  }

  function beginCameraTakeover() {
    if (takeoverActive || !prologueSessionActive()) return takeoverActive;
    takeoverActive = true;
    takeoverStarts += 1;
    applyDialogueShoulderConfig();
    try {
      if (document.pointerLockElement && typeof document.exitPointerLock === 'function') document.exitPointerLock();
    } catch (_) {}
    rawCameraDeps?.setCameraTarget?.(null);
    rawCameraDeps?.setCameraMode?.(SHOULDER_MODE);
    const focused = recenterTowardSpeaker(speakerRoot());
    if (!focused) snapRenderedCameraToPlayer();
    lastStatus = focused ? lastStatus : 'shoulder-takeover';
    return true;
  }

  function endCameraTakeover() {
    if (!takeoverActive && !savedShoulderConfig) return false;
    takeoverActive = false;
    restoreShoulderConfig();
    try { window.__climbDebug?.updateCameraPosition?.(); } catch (_) {}
    lastStatus = 'released';
    return true;
  }

  function enforceDialogueGui() {
    if (!prologueSessionActive()) return false;
    const dialogue = document.getElementById('npcDialogue');
    if (!dialogue) return false;
    let changed = false;
    if (!dialogue.classList.contains('open')) { dialogue.classList.add('open'); changed = true; }
    if (dialogue.getAttribute?.('aria-hidden') !== 'false') { dialogue.setAttribute('aria-hidden', 'false'); changed = true; }

    const arc = document.getElementById('arcContainer');
    if (arc && !arc.classList.contains('arc-hidden')) { arc.classList.add('arc-hidden'); changed = true; }
    const continueBtn = document.getElementById('npcDialogueContinue');
    const leaveBtn = document.getElementById('npcDialogueLeave');
    if (continueBtn?.style?.display === 'none') { continueBtn.style.display = ''; changed = true; }
    if (leaveBtn?.style?.display === 'none') { leaveBtn.style.display = ''; changed = true; }

    if (changed) guiReassertions += 1;
    return true;
  }

  function installGuiObservers() {
    const dialogue = document.getElementById('npcDialogue');
    const arc = document.getElementById('arcContainer');
    if (!dialogue || typeof MutationObserver !== 'function') return false;
    if (!dialogueObserver) {
      dialogueObserver = new MutationObserver(enforceDialogueGui);
      dialogueObserver.observe(dialogue, { attributes: true, attributeFilter: ['class', 'aria-hidden', 'style'] });
    }
    if (arc && !arcObserver) {
      arcObserver = new MutationObserver(enforceDialogueGui);
      arcObserver.observe(arc, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    return true;
  }

  function isDialogueUiTarget(target) {
    const dialogue = document.getElementById('npcDialogue');
    return !!dialogue && !!target && (target === dialogue || dialogue.contains?.(target));
  }

  function blockCameraInput(event) {
    if (!prologueSessionActive() || isDialogueUiTarget(event.target)) return;
    inputBlocks += 1;
    if (event.cancelable !== false) {
      try { event.preventDefault(); } catch (_) {}
    }
    try { event.stopImmediatePropagation(); } catch (_) {}
    try { event.stopPropagation(); } catch (_) {}
  }

  function installInputLock() {
    if (typeof window.addEventListener !== 'function') return;
    window.addEventListener('mousemove', blockCameraInput, true);
    window.addEventListener('pointermove', blockCameraInput, true);
    window.addEventListener('pointerdown', blockCameraInput, true);
    window.addEventListener('touchmove', blockCameraInput, { capture: true, passive: false });
    window.addEventListener('wheel', blockCameraInput, { capture: true, passive: false });
  }

  function wrapFarmAnimals(api) {
    if (!api?.init || api.__prologueShoulderPresentationWrapped) return api;
    const originalInit = api.init.bind(api);
    api.init = function prologueShoulderPresentationFarmInit(injectedDeps = {}) {
      const source = injectedDeps || {};
      rawCameraDeps = source;
      const originalSetCameraMode = source.setCameraMode;
      const originalSetCameraTarget = source.setCameraTarget;
      const bridgedDeps = {
        ...source,
        setCameraMode(mode) {
          const dialogueMode = source.cameraConfig?.()?.dialogueMode || 'npcDialogue';
          const requested = prologueSessionActive() && mode === dialogueMode ? SHOULDER_MODE : mode;
          return originalSetCameraMode?.(requested);
        },
        setCameraTarget(target) {
          if (prologueSessionActive() && target?.userData?.prologueActor) {
            requestedSpeakerTarget = target;
            const result = originalSetCameraTarget?.(null);
            beginCameraTakeover();
            recenterTowardSpeaker(target);
            return result;
          }
          return originalSetCameraTarget?.(target);
        },
      };
      rawCameraDeps = { ...source, setCameraMode: originalSetCameraMode, setCameraTarget: originalSetCameraTarget };
      return originalInit(bridgedDeps);
    };
    Object.defineProperty(api, '__prologueShoulderPresentationWrapped', { value: true, configurable: true });
    return api;
  }

  function wrapClimbSystem(api) {
    if (!api?.init || api.__prologueShoulderPresentationWrapped) return api;
    const originalInit = api.init.bind(api);
    api.init = function prologueShoulderPresentationClimbInit(injectedDeps) {
      aimDeps = injectedDeps || null;
      return originalInit(injectedDeps);
    };
    Object.defineProperty(api, '__prologueShoulderPresentationWrapped', { value: true, configurable: true });
    return api;
  }

  function chainGlobal(name, installer) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get.call(window); },
        set(value) {
          descriptor.set.call(window, value);
          const installed = descriptor.get.call(window);
          if (installed) installer(installed);
        },
      });
      const existing = descriptor.get.call(window);
      if (existing) installer(existing);
      return;
    }
    if (window[name]) { installer(window[name]); return; }
    let stored = null;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return stored; },
      set(value) { stored = installer(value); },
    });
  }

  function tick() {
    const active = prologueSessionActive();
    if (active) {
      beginCameraTakeover();
      enforceDialogueGui();
      applyDialogueShoulderConfig();
      const state = snapshot();
      if (state?.speakerNpcId && state.speakerNpcId !== lastSpeakerNpcId) recenterTowardSpeaker(speakerRoot(state.speakerNpcId));
      if (rawCameraDeps?.getCameraMode?.() !== SHOULDER_MODE) rawCameraDeps?.setCameraMode?.(SHOULDER_MODE);
      rawCameraDeps?.setCameraTarget?.(null);
      // Authoritative rendered-camera fix: discard any stale farm/previous-map
      // follow target and apply the scripted shoulder zoom every visible frame.
      snapRenderedCameraToPlayer();
    } else {
      endCameraTakeover();
      lastSpeakerNpcId = null;
      requestedSpeakerTarget = null;
    }
    requestAnimationFrame(tick);
  }

  chainGlobal('FarmAnimals', wrapFarmAnimals);
  chainGlobal('ClimbSystem', wrapClimbSystem);
  installInputLock();

  observerRetry = setInterval(() => {
    if (installGuiObservers()) {
      clearInterval(observerRetry);
      observerRetry = 0;
    }
  }, RETRY_MS);
  if (document.readyState !== 'loading') installGuiObservers();
  else document.addEventListener('DOMContentLoaded', installGuiObservers, { once: true });

  // Start after the parser/game bootstrap task so our camera snap runs after
  // game.js's ordinary per-frame camera update, immediately before the next
  // visible frame uses the corrected player-anchored shoulder state.
  setTimeout(() => requestAnimationFrame(tick), 0);

  window.PrologueDialoguePresentationBridge = Object.freeze({
    version: 2,
    enforceNow: enforceDialogueGui,
    recenterNow: () => recenterTowardSpeaker(speakerRoot()),
    syncCameraNow: () => {
      if (!prologueSessionActive()) { endCameraTakeover(); return false; }
      beginCameraTakeover();
      return snapRenderedCameraToPlayer();
    },
    debugSnapshot: () => ({
      version: 2,
      currentArea: currentArea(),
      sessionActive: prologueSessionActive(),
      takeoverActive,
      speakerNpcId: snapshot()?.speakerNpcId || null,
      cameraDepsReady: !!rawCameraDeps,
      aimDepsReady: !!aimDeps,
      cameraMode: rawCameraDeps?.getCameraMode?.() || null,
      requestedSpeakerTarget: requestedSpeakerTarget?.userData?.prologueNpcId || null,
      lastSpeakerNpcId,
      lastYawDeg: Number.isFinite(lastYawRad) ? lastYawRad * 180 / Math.PI : null,
      dialogueGuiOpen: !!document.getElementById('npcDialogue')?.classList?.contains?.('open'),
      dialogueDistanceTiles: takeoverActive ? shoulderConfig()?.distanceTiles ?? null : null,
      dialogueFovDeg: takeoverActive ? shoulderConfig()?.fovDeg ?? null : null,
      activeCameraAzimuthDeg: Number(window.__hobunjiFurnitureDebug?.activeCameraAzimuthDeg) || null,
      cameraDebug: window.__climbDebug?.getCameraDebug?.() || null,
      recenterCount,
      renderedTargetSnaps,
      inputBlocks,
      takeoverStarts,
      guiReassertions,
      lastStatus,
      lastError,
    }),
  });
})();
