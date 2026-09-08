// Presentation bridge for the rescue prologue dialogue test.
//
// PrologueDialogueRuntime owns scripted speakers/lines, but ordinary NPC
// dialogue in game.js normally owns two closure-private pieces of presentation
// state: the camera mode/target and the dialogue panel's persistent open state.
// The prologue actors are intentionally synthetic rather than scheduled walkers,
// so this bridge adapts only those presentation edges without moving the player
// or introducing a second camera implementation.
(() => {
  'use strict';

  const RESCUE_MAP_ID = 'map_prologue_rescue'; // Limits all overrides to the first scripted rescue scene.
  const SHOULDER_MODE = 'shoulderSurf'; // Final camera mode for every visible rescue dialogue frame.
  const RETRY_MS = 80; // Used to attach GUI observers after the body markup exists.

  let rawCameraDeps = null; // Original FarmAnimals camera/player deps used to invoke game.js's real setters.
  let aimDeps = null; // ClimbSystem deps provide game.js's real targetAimAngle setter when available.
  let requestedSpeakerTarget = null; // Last prologue actor target intercepted before it can move the camera anchor.
  let lastSpeakerNpcId = null; // Prevents redundant Shoulder Cam recenter events while one line remains active.
  let dialogueObserver = null; // Reasserts the dialogue shell if game.js closes it because its scheduled-walker flag is false.
  let arcObserver = null; // Keeps the ordinary action arch hidden for the synthetic dialogue session.
  let observerRetry = 0; // Temporary DOM-ready retry id.
  let recenterCount = 0; // Mobile-readable count of automatic speaker camera turns.
  let guiReassertions = 0; // Mobile-readable count of synthetic-session GUI repairs.
  let lastYawRad = null; // Most recent speaker yaw applied through the ordinary aiming setters.
  let lastStatus = 'boot'; // Mobile-readable bridge status.
  let lastError = null; // Most recent presentation failure.

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
    const player = aimDeps?.player || rawCameraDeps?.player || null;
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

  function dispatchShoulderRecenter() {
    const toggle = document.getElementById('settingShoulderSurf'); // Existing game.js listener owns the private camera azimuth/recenter state.
    if (!toggle) return false;
    toggle.checked = true;
    try {
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (_) {
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
    try {
      // These are the same ordinary gameplay-facing setters used by climbing
      // and other interaction staging. Updating them before Shoulder Cam's own
      // recenter event lets its private azimuth initialize toward the speaker.
      aimDeps?.setFacingAngle?.(yaw);
      rawCameraDeps?.setFacingAngle?.(yaw);
      aimDeps?.setTargetAimAngle?.(yaw);
      if (player) player.angle = yaw;

      // The speaker is a LOOK direction, not the camera's orbit anchor. Clear
      // the generic target before enabling Shoulder Cam so the camera stays at
      // the player's shoulder rather than moving out toward the NPC.
      rawCameraDeps?.setCameraTarget?.(null);
      rawCameraDeps?.setCameraMode?.(SHOULDER_MODE);
      const recentered = dispatchShoulderRecenter();
      rawCameraDeps?.setCameraMode?.(SHOULDER_MODE); // The final mode is authoritative even if a settings listener was unavailable.

      lastSpeakerNpcId = speakerId;
      lastYawRad = yaw;
      recenterCount += 1;
      lastError = null;
      lastStatus = recentered ? `shoulder-recenter:${speakerId || 'speaker'}` : `shoulder-mode:${speakerId || 'speaker'}`;
      debugLog(`Shoulder Cam → ${speakerId || 'speaker'} (${(yaw * 180 / Math.PI).toFixed(1)}°)`);
      return true;
    } catch (error) {
      lastError = String(error?.message || error);
      lastStatus = `recenter-error:${lastError}`;
      debugLog(lastStatus, 'warn');
      return false;
    }
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

  function wrapFarmAnimals(api) {
    if (!api?.init || api.__prologueShoulderPresentationWrapped) return api;
    const originalInit = api.init.bind(api);
    api.init = function prologueShoulderPresentationFarmInit(injectedDeps = {}) {
      const source = injectedDeps || {};
      rawCameraDeps = source; // Retained for recenterTowardSpeaker and post-test debug only.
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
            requestedSpeakerTarget = target; // Used to turn the shoulder camera without making this actor the camera anchor.
            const result = originalSetCameraTarget?.(null);
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
      aimDeps = injectedDeps || null; // Supplies setTargetAimAngle/setFacingAngle without duplicating game.js camera-input state.
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
    let stored = null; // Used until the parser-time namespace assignment occurs.
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
      enforceDialogueGui();
      const state = snapshot();
      if (state?.speakerNpcId && state.speakerNpcId !== lastSpeakerNpcId) recenterTowardSpeaker(speakerRoot(state.speakerNpcId));
      if (rawCameraDeps?.getCameraMode?.() !== SHOULDER_MODE) rawCameraDeps?.setCameraMode?.(SHOULDER_MODE);
    } else {
      lastSpeakerNpcId = null;
      requestedSpeakerTarget = null;
    }
    requestAnimationFrame(tick);
  }

  chainGlobal('FarmAnimals', wrapFarmAnimals);
  chainGlobal('ClimbSystem', wrapClimbSystem);

  observerRetry = setInterval(() => {
    if (installGuiObservers()) {
      clearInterval(observerRetry);
      observerRetry = 0;
    }
  }, RETRY_MS);
  if (document.readyState !== 'loading') installGuiObservers();
  else document.addEventListener('DOMContentLoaded', installGuiObservers, { once: true });

  // Register after the parser/game bootstrap task so this presentation pass
  // runs after the ordinary game camera update on subsequent animation frames.
  setTimeout(() => requestAnimationFrame(tick), 0);

  window.PrologueDialoguePresentationBridge = Object.freeze({
    version: 1,
    enforceNow: enforceDialogueGui,
    recenterNow: () => recenterTowardSpeaker(speakerRoot()),
    debugSnapshot: () => ({
      version: 1,
      currentArea: currentArea(),
      sessionActive: prologueSessionActive(),
      speakerNpcId: snapshot()?.speakerNpcId || null,
      cameraDepsReady: !!rawCameraDeps,
      aimDepsReady: !!aimDeps,
      cameraMode: rawCameraDeps?.getCameraMode?.() || null,
      requestedSpeakerTarget: requestedSpeakerTarget?.userData?.prologueNpcId || null,
      lastSpeakerNpcId,
      lastYawDeg: Number.isFinite(lastYawRad) ? lastYawRad * 180 / Math.PI : null,
      dialogueGuiOpen: !!document.getElementById('npcDialogue')?.classList?.contains?.('open'),
      recenterCount,
      guiReassertions,
      lastStatus,
      lastError,
    }),
  });
})();
