// Player bandaging: a free, interruptible eight-second heal triggered by a quick
// Potion Select tap. Time and vulnerability are the cost; no inventory item is consumed.
(function (global) {
  'use strict';

  if (global.BandageSystem?.installed) return;

  const PLAYER_ID = 'player';
  const DURATION_MS = 8000; // Used by the accelerating heal curve and completion check.
  const REFERENCE_START_FRACTION = 0.01; // Used to author the requested 1% -> 20% midpoint timing.
  const REFERENCE_MID_FRACTION = 0.20; // Used to solve the curve exponent at exactly four seconds.
  const CURVE_EXPONENT = Math.log((REFERENCE_MID_FRACTION - REFERENCE_START_FRACTION) / (1 - REFERENCE_START_FRACTION)) / Math.log(0.5); // Used by every bandage heal sample.
  const ARM_ROLL_HZ = 1.35; // Used by the pre-render hand layer while bandaging.
  const SENTINEL_RENDER_ORDER = -99980; // Runs after normal hand sync (-100000) and social-dance blending (-99990).
  const BANDAGE_START_SFX_KEY = 'bandageStart'; // Resolves the authored one-shot start cue through the shared combat-SFX config.
  const BANDAGE_LOOP_SFX_KEY = 'bandageLoop'; // Resolves the authored rolling loop through the shared combat-SFX config.
  const DEFAULT_LOOP_OVERLAP_MS = 120; // Starts each loop slightly early so adjacent recordings cross over instead of hard-seaming.

  const state = {
    active: false,
    player: null,
    elapsedMs: 0, // Advances only by gameLoop's simulation delta; used by healing, hand motion, and diagnostics.
    paused: false, // Stops audio while gameplay is paused and restarts the loop on resume.
    startHealth: 0,
    startMaxHealth: 0,
    lastAttackReceivedAt: -Infinity,
    actionLock: null,
    handRig: null,
    sentinel: null,
    sentinelParent: null,
    poseFrameId: -1,
    handBase: {
      left: { px:0, py:0, pz:0, qx:0, qy:0, qz:0, qw:1 },
      right: { px:0, py:0, pz:0, qx:0, qy:0, qz:0, qw:1 },
    }, // Reused by the render sentinel so repeated camera passes never accumulate hand transforms.
    lastEnd: null,
    lastError: null,
    healEvents: 0,
    poseApplications: 0,
    audioGeneration: 0,
    audioTimer: null,
    audioVoices: new Set(), // Tracks currently audible bandage voices so interruption/completion can stop them immediately.
    audioStartPlays: 0,
    audioLoopPlays: 0,
    audioOverlapMs: DEFAULT_LOOP_OVERLAP_MS,
    audioLastError: null,
  };

  const now = () => performance.now();
  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const round1 = value => Math.round((Number(value) || 0) * 10) / 10;

  function dep(name) {
    for (const bag of [global.ProceduralHandAttachments?.gameDeps, global.Combat?.deps]) {
      if (bag && bag[name] != null) return bag[name];
    }
    return null;
  }

  function currentPlayer() {
    return global.Combat?.deps?.player || dep('player') || null;
  }

  function currentPlayerMesh() {
    return global.PlayerBodyTransformComposer?.getPlayerMesh?.() || dep('playerMesh') || null;
  }

  function effectiveMaxHealth(player) {
    return Math.max(0, Number(global.ResourceSystem?.getEffectiveMax?.(player, 'health')) || Number(player?.maxHealth) || 0);
  }

  function curveProgress(elapsedMs) {
    return Math.pow(clamp01(elapsedMs / DURATION_MS), CURVE_EXPONENT);
  }

  function sampleCurve(elapsedMs, startFraction = REFERENCE_START_FRACTION) {
    const start = clamp01(startFraction);
    return start + (1 - start) * curveProgress(elapsedMs);
  }

  function targetHealth(elapsedMs, maxHealth = state.startMaxHealth) {
    const max = Math.max(0, Number(maxHealth) || 0);
    const start = Math.min(max, Math.max(0, Number(state.startHealth) || 0));
    return start + (max - start) * curveProgress(elapsedMs);
  }

  function emit(type, detail = {}) {
    global.dispatchEvent?.(new CustomEvent('hobunji-bandage-change', { detail:{ type, ...detail } }));
  }

  function isUnder(node, ancestor) {
    for (let cursor = node; cursor; cursor = cursor.parent) if (cursor === ancestor) return true;
    return false;
  }

  function discoverHandRig() {
    const playerMesh = currentPlayerMesh();
    if (!playerMesh) return null;
    if (state.handRig && (isUnder(state.handRig.group, playerMesh) || isUnder(state.handRig.parent, playerMesh))) return state.handRig;
    let found = playerMesh.userData?.proceduralHandRig || null;
    playerMesh.traverse?.(node => {
      if (!found && node?.userData?.proceduralHandRig) found = node.userData.proceduralHandRig;
    });
    state.handRig = found;
    return found;
  }

  function playerDimensions() {
    const playerMesh = currentPlayerMesh();
    let plane = null;
    playerMesh?.traverse?.(node => {
      if (!plane && node?.isMesh && (node.userData?.hobunjiPlaneFace || /_front_plane$/.test(node.name || ''))) plane = node;
    });
    const params = plane?.geometry?.parameters || {};
    const width = Number(playerMesh?.userData?.portraitModelWidth) || Number(params.width) || 0.9;
    const height = Number(playerMesh?.userData?.portraitModelHeight) || Number(params.height) || width;
    return { width:Math.max(0.05, width), height:Math.max(0.05, height) };
  }

  function captureHandBase(rig) {
    const left = rig?.group?.getObjectByName?.('left_hand_socket');
    const right = rig?.group?.getObjectByName?.('right_hand_socket');
    if (!left || !right) return null;
    for (const [side, socket] of [['left', left], ['right', right]]) {
      const base = state.handBase[side];
      base.px = socket.position.x; base.py = socket.position.y; base.pz = socket.position.z;
      base.qx = socket.quaternion.x; base.qy = socket.quaternion.y; base.qz = socket.quaternion.z; base.qw = socket.quaternion.w;
    }
    return { left, right };
  }

  function applyArmRoll(t = now()) {
    if (!state.active) return false;
    const rig = discoverHandRig();
    if (!rig) return false;
    const frameId = global.RuntimeFrameScheduler?.frameId?.() ?? Math.floor(t); // Reuses one baseline across repeated render passes in the same browser frame.
    let sockets;
    if (state.poseFrameId !== frameId) {
      sockets = captureHandBase(rig);
      if (!sockets) return false;
      state.poseFrameId = frameId;
    } else {
      sockets = {
        left: rig.group?.getObjectByName?.('left_hand_socket'),
        right: rig.group?.getObjectByName?.('right_hand_socket'),
      };
      if (!sockets.left || !sockets.right) return false;
    }

    const dimensions = playerDimensions();
    const phase = state.elapsedMs * 0.001 * Math.PI * 2 * ARM_ROLL_HZ;
    for (const side of ['left', 'right']) {
      const socket = sockets[side];
      const base = state.handBase[side];
      const sign = side === 'left' ? -1 : 1;
      const sidePhase = phase + (side === 'right' ? Math.PI : 0);
      socket.position.set(base.px, base.py, base.pz);
      socket.quaternion.set(base.qx, base.qy, base.qz, base.qw);
      socket.position.x *= 0.44;
      socket.position.y += dimensions.height * (0.105 + 0.057 * Math.sin(sidePhase));
      socket.position.z += dimensions.height * (0.055 + 0.045 * Math.cos(sidePhase));
      socket.rotateX(-0.42 + 0.16 * Math.cos(sidePhase));
      socket.rotateY(sign * 0.16 * Math.sin(sidePhase));
      socket.rotateZ(sign * (0.58 + 0.22 * Math.cos(sidePhase)));
      socket.visible = true;
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
    }
    state.poseApplications++;
    return true;
  }

  function disposeSentinel() {
    const sentinel = state.sentinel;
    if (!sentinel) return;
    sentinel.parent?.remove?.(sentinel);
    sentinel.geometry?.dispose?.();
    sentinel.material?.dispose?.();
    state.sentinel = null;
    state.sentinelParent = null;
  }

  function ensureSentinel() {
    const THREE = global.THREE;
    const playerMesh = currentPlayerMesh();
    if (!THREE || !playerMesh) return false;
    if (state.sentinel && state.sentinelParent === playerMesh) return true;
    disposeSentinel();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0.0001,0,0, 0,0.0001,0], 3));
    const material = new THREE.MeshBasicMaterial({ depthTest:false, depthWrite:false });
    material.colorWrite = false;
    const sentinel = new THREE.Mesh(geometry, material);
    sentinel.name = 'player_bandage_arm_roll_sync';
    sentinel.frustumCulled = false;
    sentinel.renderOrder = SENTINEL_RENDER_ORDER;
    sentinel.onBeforeRender = () => { if (state.active) applyArmRoll(); };
    playerMesh.add(sentinel);
    state.sentinel = sentinel;
    state.sentinelParent = playerMesh;
    return true;
  }

  function combatSfxEntry(key) {
    return global.AudioSystem?.combatSfxConfig?.()?.[key] || null;
  }

  function stopBandageAudio() {
    state.audioGeneration++;
    if (state.audioTimer != null) {
      clearTimeout(state.audioTimer);
      state.audioTimer = null;
    }
    for (const voice of state.audioVoices) {
      try {
        voice.pause?.();
        if (Number.isFinite(Number(voice.currentTime))) voice.currentTime = 0;
      } catch (_) {}
    }
    state.audioVoices.clear();
  }

  function trackBandageVoice(voice) {
    if (!voice) return null;
    state.audioVoices.add(voice);
    const forget = () => state.audioVoices.delete(voice);
    voice.addEventListener?.('ended', forget, { once:true });
    voice.addEventListener?.('error', forget, { once:true });
    return voice;
  }

  function scheduleBandageContinuation(voice, generation, next) {
    const loopCfg = combatSfxEntry(BANDAGE_LOOP_SFX_KEY) || {};
    const overlapMs = Math.max(0, Number(loopCfg.overlapMs) || DEFAULT_LOOP_OVERLAP_MS);
    state.audioOverlapMs = overlapMs;
    const requestedAt = now();
    let scheduled = false;
    const schedule = () => {
      if (scheduled || !state.active || state.audioGeneration !== generation) return;
      const durationS = Number(voice?.duration);
      const playbackRate = Math.max(0.01, Number(voice?.playbackRate) || 1);
      if (!(durationS > 0) || !Number.isFinite(durationS)) return;
      scheduled = true;
      const elapsedMs = Math.max(0, now() - requestedAt);
      const delayMs = Math.max(0, (durationS * 1000 / playbackRate) - overlapMs - elapsedMs);
      state.audioTimer = setTimeout(() => {
        state.audioTimer = null;
        if (!state.active || state.audioGeneration !== generation) return;
        next();
      }, delayMs);
    };
    schedule();
    if (!scheduled) {
      voice?.addEventListener?.('loadedmetadata', schedule, { once:true });
      voice?.addEventListener?.('durationchange', schedule, { once:true });
    }
  }

  function playBandageLoop(generation) {
    if (!state.active || state.audioGeneration !== generation) return false;
    const voice = trackBandageVoice(global.AudioSystem?.playCombatSfxKey?.(BANDAGE_LOOP_SFX_KEY));
    if (!voice) {
      state.audioLastError = 'bandage-loop-unavailable';
      return false;
    }
    state.audioLoopPlays++;
    scheduleBandageContinuation(voice, generation, () => playBandageLoop(generation));
    return true;
  }

  function startBandageAudio() {
    stopBandageAudio();
    const generation = state.audioGeneration;
    state.audioLastError = null;
    const voice = trackBandageVoice(global.AudioSystem?.playCombatSfxKey?.(BANDAGE_START_SFX_KEY));
    if (!voice) {
      state.audioLastError = 'bandage-start-unavailable';
      return playBandageLoop(generation);
    }
    state.audioStartPlays++;
    scheduleBandageContinuation(voice, generation, () => playBandageLoop(generation));
    return true;
  }

  function releaseOwnership() {
    state.actionLock?.release?.();
    state.actionLock = null;
  }

  function finish(reason, extra = {}) {
    if (!state.active) return false;
    state.active = false;
    stopBandageAudio();
    releaseOwnership();
    state.poseFrameId = -1;
    state.lastEnd = { reason, at:Date.now(), elapsedMs:state.elapsedMs, ...extra };
    emit(reason === 'complete' ? 'complete' : 'cancel', { reason, ...extra });
    global.ProceduralHandFrameDriver?.syncNow?.();
    return true;
  }

  function cancel(reason = 'cancelled', extra = {}) {
    return finish(reason, extra);
  }

  function start(options = {}) {
    if (state.active) return false;
    const player = currentPlayer();
    const maxHealth = effectiveMaxHealth(player);
    const health = Math.max(0, Number(player?.health) || 0);
    if (!player || !(maxHealth > 0)) {
      state.lastError = 'player-health-unavailable';
      return false;
    }
    if (!(health > 0)) {
      state.lastError = 'player-down';
      return false;
    }
    if (health >= maxHealth - 0.05) {
      state.lastError = 'full-health';
      state.lastEnd = { reason:'full-health', at:Date.now(), elapsedMs:0 };
      return false;
    }
    const actionLock = global.CharacterActionLocks?.acquire?.({
      owner: 'bandaging',
      reason: 'Bandaging occupies both hands',
      participants: [{ id:PLAYER_ID, channels:['tools', 'actions'] }],
    });
    if (!actionLock) {
      state.lastError = 'action-lock-unavailable';
      return false;
    }

    state.active = true;
    state.player = player;
    state.elapsedMs = 0;
    state.paused = false;
    state.startHealth = health;
    state.startMaxHealth = maxHealth;
    state.lastAttackReceivedAt = Number(player.lastAttackReceivedAt) || -Infinity;
    state.actionLock = actionLock;
    state.poseFrameId = -1;
    state.lastError = null;
    state.lastEnd = null;
    ensureSentinel();
    discoverHandRig();
    startBandageAudio();
    emit('start', { source:String(options.source || 'potion-select-tap'), health, maxHealth });
    return true;
  }

  function update(dt, paused = false) {
    if (!state.active) return false;
    if (paused) {
      if (!state.paused) stopBandageAudio();
      state.paused = true;
      return true;
    }
    if (state.paused) {
      state.paused = false;
      playBandageLoop(state.audioGeneration);
    }
    const player = currentPlayer();
    if (!player || player !== state.player) return cancel('player-changed');
    if (!(Number(player.health) > 0)) return cancel('player-down');
    const receivedAt = Number(player.lastAttackReceivedAt) || -Infinity;
    if (receivedAt > state.lastAttackReceivedAt) return cancel('hit', { damageReason:'attack-timestamp' });

    ensureSentinel();
    const maxHealth = effectiveMaxHealth(player);
    if (!(maxHealth > 0)) return cancel('health-unavailable');
    if (player.health >= maxHealth - 0.05) return finish('complete');

    const deltaSeconds = Number(dt); // Rejects malformed deltas instead of poisoning the active healing clock.
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return false;
    state.elapsedMs = Math.min(DURATION_MS, state.elapsedMs + deltaSeconds * 1000);
    const elapsedMs = state.elapsedMs;
    const desired = Math.min(maxHealth, targetHealth(elapsedMs, maxHealth));
    const before = Number(player.health) || 0;
    if (desired > before) {
      player.health = round1(desired);
      global.ResourceSystem?.enforceCaps?.(player);
      const delta = round1((Number(player.health) || 0) - before);
      if (delta > 0) {
        state.healEvents++;
        global.dispatchEvent?.(new CustomEvent('hobunji-resource-change', {
          detail:{ entity:player, delta, reason:'bandage', immediate:false },
        }));
      }
    }
    if (elapsedMs >= DURATION_MS || player.health >= maxHealth - 0.05) {
      player.health = maxHealth;
      global.ResourceSystem?.enforceCaps?.(player);
      return finish('complete');
    }
    return true;
  }

  function onResourceChange(event) {
    if (!state.active) return;
    const detail = event?.detail || {};
    if (detail.entity !== state.player || !(Number(detail.delta) < 0) || detail.immediate !== true) return;
    cancel('hit', { damageReason:String(detail.reason || 'damage') });
  }

  // Gameplay healing belongs to gameLoop; the render sentinel only applies the current hand pose.
  global.addEventListener?.('hobunji-resource-change', onResourceChange);

  global.BandageSystem = Object.freeze({
    installed: true,
    start,
    cancel,
    update,
    sampleCurve,
    get active() { return state.active; },
    debugSnapshot() {
      const elapsedMs = state.active ? state.elapsedMs : state.lastEnd?.elapsedMs || 0;
      const maxHealth = state.active && state.player ? effectiveMaxHealth(state.player) : state.startMaxHealth;
      return {
        active: state.active,
        paused: state.active && state.paused,
        clock: 'gameplay-delta',
        cost: 'time-and-interruption-only',
        durationMs: DURATION_MS,
        midpointMs: DURATION_MS / 2,
        curveExponent: CURVE_EXPONENT,
        reference: { startFraction:REFERENCE_START_FRACTION, midpointFraction:REFERENCE_MID_FRACTION, endFraction:1 },
        elapsedMs,
        curveProgress: curveProgress(elapsedMs),
        startHealth: state.startHealth,
        startMaxHealth: state.startMaxHealth,
        currentHealth: state.player ? Number(state.player.health) || 0 : null,
        currentMaxHealth: maxHealth || null,
        actionLocked: !!state.actionLock,
        playerHandCaptured: !!state.handRig,
        hasPreRenderSentinel: !!state.sentinel,
        poseApplications: state.poseApplications,
        healEvents: state.healEvents,
        audio: {
          activeVoices: state.audioVoices.size,
          startPlays: state.audioStartPlays,
          loopPlays: state.audioLoopPlays,
          overlapMs: state.audioOverlapMs,
          lastError: state.audioLastError,
        },
        lastEnd: state.lastEnd && { ...state.lastEnd },
        lastError: state.lastError,
      };
    },
  });
})(window);

