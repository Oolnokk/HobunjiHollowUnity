// Dance-view camera adapter.
//
// Shoulder Cam already supports continuous camera orbit, while Character View
// is the existing gameplay mode that freezes the player's facing so the camera
// can actually travel around and look back at the character. This adapter joins
// those two existing behaviors for Social Actions:
//   1) while the player is dancing and standing still, remember the current
//      camera yaw as the standing-view baseline;
//   2) once camera yaw travels past the configured threshold (90° by default),
//      enter the existing Character View mode; and
//   3) let Character View's existing movement-input rule turn itself off again.
// No camera transform, movement input, or player-facing logic is duplicated here.
(function (global) {
  'use strict';

  if (global.SocialActionCameraRuntime?.installed) return;

  const DEFAULT_TRIGGER_DEG = 90;
  const DEFAULT_STATIONARY_SPEED_THRESHOLD = 1;
  const state = {
    actionArcDeps: null,
    sentinel: null,
    sentinelParent: null,
    baselineYawRad: null,
    lastYawDeltaDeg: 0,
    danceKey: null,
    autoCharacterView: false,
    entries: 0,
    baselineResets: 0,
    lastReason: 'boot',
    cameraSamples: 0,
  };

  let cameraForward = null;

  function cfg() {
    const authored = global.SCRATCHBONES_CONFIG?.game?.socialActions || {};
    const triggerRaw = Number(authored.danceFreeCamTriggerDeg);
    const speedRaw = Number(authored.danceFreeCamStationarySpeedThreshold);
    return {
      triggerDeg: Number.isFinite(triggerRaw)
        ? Math.max(1, Math.min(179, Math.abs(triggerRaw)))
        : DEFAULT_TRIGGER_DEG,
      stationarySpeedThreshold: Number.isFinite(speedRaw)
        ? Math.max(0, speedRaw)
        : DEFAULT_STATIONARY_SPEED_THRESHOLD,
      exitOnDanceEnd: authored.danceFreeCamExitOnDanceEnd !== false,
    };
  }

  function danceInfo() {
    try { return global.SocialActionWheel?.getDebug?.()?.dancing || null; }
    catch (_) { return null; }
  }

  function currentPlayerMesh() {
    return global.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || state.actionArcDeps?.playerMesh
      || global.ProceduralHandAttachments?.gameDeps?.playerMesh
      || null;
  }

  function resetBaseline(reason) {
    if (state.baselineYawRad != null) state.baselineResets++;
    state.baselineYawRad = null;
    state.lastYawDeltaDeg = 0;
    state.lastReason = reason;
  }

  function patchActionArcUi(api) {
    if (!api?.init || api.init.__socialDanceCameraDepsWrapped) return;
    const original = api.init;
    api.init = function socialDanceCameraActionArcInit(injectedDeps, ...rest) {
      state.actionArcDeps = injectedDeps || null;
      return original.call(this, injectedDeps, ...rest);
    };
    api.init.__socialDanceCameraDepsWrapped = true;
  }

  function chainGlobal(name, install) {
    const existing = global[name];
    if (existing) { install(existing); return; }
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    Object.defineProperty(global, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return oldGet ? oldGet.call(global) : stored; },
      set(value) {
        if (oldSet) oldSet.call(global, value); else stored = value;
        const resolved = oldGet ? oldGet.call(global) : stored;
        if (resolved) install(resolved);
      },
    });
  }

  function playerIsMoving() {
    const player = state.actionArcDeps?.player;
    if (!player) return false;
    const speed = Math.hypot(Number(player.vx) || 0, Number(player.vy) || 0);
    const forced = !!player.dodging
      || !!player.lunging
      || (Number(player.knockbackT) || 0) > 0;
    return forced || speed > cfg().stationarySpeedThreshold;
  }

  function shortestYawDeltaRad(next, previous) {
    return Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
  }

  function cameraYawRad(camera) {
    const THREE = global.THREE;
    if (!THREE || !camera?.getWorldDirection) return null;
    if (!cameraForward) cameraForward = new THREE.Vector3();
    camera.getWorldDirection(cameraForward);
    cameraForward.y = 0;
    if (cameraForward.lengthSq() < 1e-8) return null;
    cameraForward.normalize();
    return Math.atan2(cameraForward.x, cameraForward.z);
  }

  function setAutoCharacterView(enabled, reason) {
    const deps = state.actionArcDeps;
    const characterView = deps?.characterViewMode;
    const setCharacterViewMode = deps?.setCharacterViewMode;
    if (!characterView || typeof setCharacterViewMode !== 'function') return false;
    setCharacterViewMode(!!enabled, reason);
    const applied = characterView.enabled === !!enabled;
    if (enabled && applied) {
      state.autoCharacterView = true;
      state.entries++;
      state.lastReason = reason;
    } else if (!enabled && applied) {
      state.autoCharacterView = false;
      state.lastReason = reason;
    }
    return applied;
  }

  function finishDanceIfNeeded() {
    if (danceInfo()) return;
    const characterView = state.actionArcDeps?.characterViewMode;
    if (state.autoCharacterView && characterView?.enabled && cfg().exitOnDanceEnd) {
      setAutoCharacterView(false, 'social-dance-ended');
    }
    state.autoCharacterView = false;
    state.danceKey = null;
    resetBaseline('not-dancing');
  }

  function sampleCamera(camera) {
    state.cameraSamples++;
    const info = danceInfo();
    const deps = state.actionArcDeps;
    const characterView = deps?.characterViewMode;
    if (!info || !characterView || typeof deps?.setCharacterViewMode !== 'function') {
      if (!info) finishDanceIfNeeded();
      return;
    }

    const key = `${info.style || ''}|${info.armStyle || ''}`;
    if (state.danceKey !== key) {
      state.danceKey = key;
      state.autoCharacterView = false;
      resetBaseline('dance-start');
    }

    // If Character View was manually enabled, leave it completely alone.
    if (characterView.enabled && !state.autoCharacterView) {
      resetBaseline('manual-character-view');
      return;
    }

    // Character View's own updateMovement() disables itself from keyboard,
    // controller, touch, dodge/lunge, or forced movement. Observe that edge
    // and make the next stationary frame establish a fresh baseline.
    if (!characterView.enabled && state.autoCharacterView) {
      state.autoCharacterView = false;
      resetBaseline('movement-reset');
    }

    if (characterView.enabled) return;
    if (playerIsMoving()) {
      resetBaseline('moving');
      return;
    }

    const yaw = cameraYawRad(camera);
    if (yaw == null) return;
    if (state.baselineYawRad == null) {
      state.baselineYawRad = yaw;
      state.lastYawDeltaDeg = 0;
      state.lastReason = 'stationary-baseline';
      return;
    }

    const deltaDeg = Math.abs(shortestYawDeltaRad(yaw, state.baselineYawRad)) * 180 / Math.PI;
    state.lastYawDeltaDeg = deltaDeg;
    if (deltaDeg > cfg().triggerDeg) {
      setAutoCharacterView(true, 'social-dance-free-cam');
    }
  }

  function ensureSentinel() {
    const THREE = global.THREE;
    const player = currentPlayerMesh();
    if (!THREE || !player) return;
    if (state.sentinel && state.sentinelParent === player) return;

    if (!state.sentinel) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0,
        0.0001, 0, 0,
        0, 0.0001, 0,
      ], 3));
      const material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
      material.colorWrite = false;
      state.sentinel = new THREE.Mesh(geometry, material);
      state.sentinel.name = 'player_social_dance_camera_sync';
      state.sentinel.frustumCulled = false;
      state.sentinel.renderOrder = -99970;
      state.sentinel.onBeforeRender = (_renderer, _scene, camera) => sampleCamera(camera);
    }

    state.sentinel.parent?.remove?.(state.sentinel);
    player.add(state.sentinel);
    state.sentinelParent = player;
  }

  function frame() {
    ensureSentinel();
    finishDanceIfNeeded();
    global.requestAnimationFrame(frame);
  }

  chainGlobal('ActionArcUI', patchActionArcUi);

  global.SocialActionCameraRuntime = Object.freeze({
    installed: true,
    getDebug() {
      const characterView = state.actionArcDeps?.characterViewMode;
      return {
        dancing: !!danceInfo(),
        depsCaptured: !!state.actionArcDeps,
        characterViewEnabled: !!characterView?.enabled,
        autoCharacterView: state.autoCharacterView,
        baselineYawDeg: state.baselineYawRad == null ? null : state.baselineYawRad * 180 / Math.PI,
        yawDeltaDeg: state.lastYawDeltaDeg,
        triggerDeg: cfg().triggerDeg,
        stationary: !playerIsMoving(),
        entries: state.entries,
        baselineResets: state.baselineResets,
        cameraSamples: state.cameraSamples,
        lastReason: state.lastReason,
      };
    },
  });

  global.requestAnimationFrame(frame);
})(window);
