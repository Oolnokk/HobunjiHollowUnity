// Social Action gameplay adapter: capability checks plus additive dance-over-walk limbs.
// The SocialActionWheel owns selection/body motion. This file keeps existing locomotion
// authoritative, snapshots the ordinary feet/hands pose, then reapplies the selected
// dance as a final pre-render layer. That lets the player walk while dancing.
(function (global) {
  'use strict';

  if (global.SocialActionDanceRuntime?.installed) return;

  const PLAYER_ID = 'player';
  const KURRAYA_KEY = 'kurraya';
  const DANCE_STIM_ID = 'player-dance';
  const WEAPON_IDLE_CHANNEL = 'weapon-idle-stance-body-yaw';
  const STYLE = Object.freeze({
    'side-step': { intensity: 1.00, legAmount: 1.00 },
    'gentle-twirl': { intensity: 1.18, legAmount: 0.82 },
    'loose-sway': { intensity: 0.96, legAmount: 0.48 },
  });

  const state = {
    legHandle: null,
    handRig: null,
    legBase: null,
    handBase: null,
    sentinel: null,
    sentinelParent: null,
    danceKey: null,
    danceStartedAt: 0,
    danceLock: null,
    lastDancing: false,
    toolHolder: null,
    toolHolderVisible: null,
    lastStimAt: 0,
    legApplications: 0,
    handApplications: 0,
    lastLegSpeed: 0,
  };

  const now = () => performance.now();
  const danceInfo = () => global.SocialActionWheel?.getDebug?.()?.dancing || null;
  const dancing = () => !!danceInfo();
  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));

  function dep(name) {
    for (const bag of [global.ProceduralHandAttachments?.gameDeps, global.Combat?.deps]) {
      if (bag && bag[name] != null) return bag[name];
    }
    return null;
  }

  function currentPlayerMesh() {
    return global.PlayerBodyTransformComposer?.getPlayerMesh?.() || dep('playerMesh') || null;
  }

  function isUnder(node, ancestor) {
    for (let cursor = node; cursor; cursor = cursor.parent) if (cursor === ancestor) return true;
    return false;
  }

  function ownsKurraya() {
    return Number(dep('inventory')?.[KURRAYA_KEY]) > 0;
  }

  function toast(message, good = true) {
    const showToast = dep('showToast');
    if (typeof showToast === 'function') showToast(message, good);
    else global.__farmLog?.(`[Social Actions] ${message}`, good ? 'info' : 'warn');
  }

  function chainGlobal(name, install) {
    const existing = global[name];
    if (existing) { install(existing); return; }
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
    const oldGet = descriptor?.get, oldSet = descriptor?.set;
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

  function grooveScale(groove) {
    const g = Math.max(0, Number(groove) || 0), rate = 52;
    return Math.expm1(g / rate) / Math.expm1(100 / rate);
  }

  function clock(t = now()) {
    const info = danceInfo();
    if (!info) return null;
    const key = `${info.style || ''}|${info.armStyle || ''}`;
    if (!state.danceStartedAt || state.danceKey !== key) {
      state.danceStartedAt = t;
      state.danceKey = key;
    }
    const cfg = global.SCRATCHBONES_CONFIG?.game?.socialActions || {};
    let bpm = Number(cfg.danceBpm) || 104;
    while (bpm > 122) bpm /= 2;
    while (bpm < 58) bpm *= 2;
    const beat = (t - state.danceStartedAt) / (60000 / bpm);
    const phase = beat * Math.PI * 2;
    const style = STYLE[info.style] || STYLE['loose-sway'];
    const intensity = grooveScale(cfg.danceGroove ?? 72) * style.intensity;
    const fourBeatSway = Math.sin(phase * 0.25);
    return { info, style, beat, phase, intensity, fourBeatSway };
  }

  function dimensions() {
    const player = currentPlayerMesh();
    let plane = null;
    player?.traverse?.(node => {
      if (!plane && node?.isMesh && (node.userData?.hobunjiPlaneFace || /_front_plane$/.test(node.name || ''))) plane = node;
    });
    const p = plane?.geometry?.parameters || {};
    const width = Number(player?.userData?.portraitModelWidth) || Number(p.width) || 0.9;
    const height = Number(player?.userData?.portraitModelHeight) || Number(p.height) || width;
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function captureLegBase(handle) {
    const THREE = global.THREE, bones = global.LegBones, root = handle?.group;
    if (!THREE || !bones?.solveTwoBoneLeg || !root) return null;
    root.updateMatrixWorld(true);
    const out = {};
    for (const side of ['left', 'right']) {
      const hip = root.getObjectByName?.(`${side}_hip`);
      const thigh = root.getObjectByName?.(`${side}_thigh`);
      const calf = root.getObjectByName?.(`${side}_calf`);
      const foot = root.getObjectByName?.(`${side}_foot`);
      if (!hip || !thigh || !calf || !foot) return null;
      const target = root.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
      const straight = bones.solveTwoBoneLeg(THREE, { hip: hip.position, foot: target });
      const bendQ = straight.thighQuaternion.clone().invert().multiply(thigh.quaternion.clone());
      const bendE = new THREE.Euler().setFromQuaternion(bendQ, 'XYZ');
      out[side] = {
        hip, thigh, calf, foot, target,
        bendX: THREE.MathUtils.radToDeg(bendE.x),
        bendZ: THREE.MathUtils.radToDeg(bendE.z),
        footQuaternion: foot.quaternion.clone(),
      };
    }
    state.legBase = out;
    return out;
  }

  function applyLegLayer(t = now()) {
    const THREE = global.THREE, bones = global.LegBones, handle = state.legHandle;
    const c = clock(t), base = state.legBase || captureLegBase(handle);
    if (!THREE || !bones?.solveTwoBoneLeg || !handle?.group || !c || !base) return false;
    const d = dimensions();
    const swingSide = Math.floor(c.beat) % 2 === 0 ? 'left' : 'right';
    const swingT = ((c.beat % 1) + 1) % 1;
    const arc = Math.pow(Math.max(0, Math.sin(Math.PI * swingT)), 1.25);
    const amount = c.style.legAmount * clamp01(c.intensity);
    const alt = Math.sin(c.phase * 0.5);

    for (const side of ['left', 'right']) {
      const b = base[side], target = b.target.clone();
      const sign = side === 'left' ? -1 : 1;
      if (c.info.style === 'side-step' && side === swingSide) {
        target.x += (alt >= 0 ? 1 : -1) * d.width * 0.12 * arc * amount;
        target.y += d.height * 0.055 * arc * amount;
      } else if (c.info.style === 'gentle-twirl' && side === swingSide) {
        target.x += sign * d.width * 0.065 * arc * amount;
        target.z += (alt >= 0 ? 1 : -1) * d.height * 0.035 * arc * amount;
        target.y += d.height * 0.047 * arc * amount;
      } else if (c.info.style === 'loose-sway') {
        target.x += sign * c.fourBeatSway * d.width * 0.055 * amount;
        if (side === swingSide) target.y += d.height * 0.025 * arc * amount;
      }
      const solved = bones.solveTwoBoneLeg(THREE, {
        hip: b.hip.position, foot: target, bendDegX: b.bendX, bendDegZ: b.bendZ,
      });
      b.thigh.quaternion.copy(solved.thighQuaternion);
      b.calf.position.set(0, -solved.thighLength, 0);
      b.calf.quaternion.copy(solved.calfLocalQuaternion);
      b.foot.position.set(0, -solved.calfLength, 0);
      b.foot.quaternion.copy(b.footQuaternion);
    }
    handle.group.updateMatrixWorld(true);
    state.legApplications++;
    return true;
  }

  function captureHandBase(rig) {
    const left = rig?.group?.getObjectByName?.('left_hand_socket');
    const right = rig?.group?.getObjectByName?.('right_hand_socket');
    if (!left || !right) return null;
    state.handBase = {
      left: { socket: left, position: left.position.clone(), quaternion: left.quaternion.clone() },
      right: { socket: right, position: right.position.clone(), quaternion: right.quaternion.clone() },
    };
    return state.handBase;
  }

  function applyHandLayer(t = now()) {
    const c = clock(t), base = state.handBase || captureHandBase(state.handRig);
    if (!c || !base) return false;
    const d = dimensions();
    const beatT = ((c.beat % 1) + 1) % 1;
    for (const side of ['left', 'right']) {
      const b = base[side], socket = b.socket;
      const sign = Math.sign(b.position.x) || (side === 'left' ? -1 : 1);
      socket.position.copy(b.position);
      socket.quaternion.copy(b.quaternion);
      if (c.info.armStyle === 'tpose-jiggle') {
        socket.position.x += sign * d.width * 0.32;
        socket.position.y += d.height * (0.08 + 0.035 * Math.sin(c.phase + (side === 'right' ? Math.PI : 0)));
        socket.position.z += c.fourBeatSway * d.height * 0.035;
        socket.rotateZ(sign * (0.10 + 0.06 * Math.sin(c.phase * 0.5)));
      } else {
        const sidePhase = side === 'right' ? (beatT + 0.5) % 1 : beatT;
        const punch = Math.pow(Math.max(0, Math.sin(Math.PI * sidePhase)), 0.45);
        socket.position.x *= 1 - 0.32 * punch;
        socket.position.y += d.height * (0.10 + 0.48 * punch);
        socket.position.z += d.height * (0.045 - 0.055 * punch);
        socket.rotateX(-0.35 * punch);
      }
      socket.visible = true;
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
    }
    state.handApplications++;
    return true;
  }

  function wrapLegHandle(handle) {
    if (!handle || handle.__socialDanceBaseCapture) return handle;
    const originalUpdate = handle.update?.bind(handle);
    if (originalUpdate) handle.update = function socialDanceCaptureWalkingFeet(...args) {
      const result = originalUpdate(...args);
      state.lastLegSpeed = Math.max(0, Number(args[1]) || 0);
      captureLegBase(handle);
      return result;
    };
    const originalDispose = handle.dispose?.bind(handle);
    if (originalDispose) handle.dispose = function socialDanceDisposeLeg(...args) {
      if (state.legHandle === handle) { state.legHandle = null; state.legBase = null; }
      return originalDispose(...args);
    };
    Object.defineProperty(handle, '__socialDanceBaseCapture', { value: true, configurable: true });
    return handle;
  }

  function patchLegApi(api) {
    if (!api?.attach || api.attach.__socialDanceRuntimeWrapped) return;
    const original = api.attach.bind(api);
    api.attach = function socialDanceLegAttach(THREE, parent, options = {}) {
      const handle = original(THREE, parent, options);
      if (handle && String(options.name || '').toLowerCase() === PLAYER_ID) state.legHandle = wrapLegHandle(handle);
      return handle;
    };
    api.attach.__socialDanceRuntimeWrapped = true;
  }

  function isPlayerHandRig(rig) {
    const player = currentPlayerMesh();
    return rig === state.handRig || (!!player && (isUnder(rig?.group, player) || isUnder(rig?.parent, player)));
  }

  function wrapHandRig(rig) {
    if (!rig || rig.__socialDanceBaseCapture) return rig;
    for (const method of ['useIdlePose', 'setSideIdle', 'placeHandWorld']) {
      const original = rig[method]?.bind(rig);
      if (!original) continue;
      rig[method] = function socialDanceCaptureWalkingHands(...args) {
        const result = original(...args);
        if (isPlayerHandRig(rig)) { state.handRig = rig; captureHandBase(rig); }
        return result;
      };
    }
    Object.defineProperty(rig, '__socialDanceBaseCapture', { value: true, configurable: true });
    return rig;
  }

  function patchHandApi(api) {
    if (!api?.attach || api.attach.__socialDanceRuntimeWrapped) return;
    const original = api.attach.bind(api);
    api.attach = function socialDanceHandAttach(THREE, parent, options = {}) {
      const rig = original(THREE, parent, options);
      if (!rig) return rig;
      wrapHandRig(rig);
      if (String(options.name || '').toLowerCase() === PLAYER_ID || isPlayerHandRig(rig)) state.handRig = rig;
      return rig;
    };
    api.attach.__socialDanceRuntimeWrapped = true;
  }

  function discoverHandRig() {
    const player = currentPlayerMesh();
    if (!player) return null;
    if (state.handRig && isPlayerHandRig(state.handRig)) return wrapHandRig(state.handRig);
    let found = null;
    player.traverse?.(node => { if (!found && node?.userData?.proceduralHandRig) found = node.userData.proceduralHandRig; });
    if (found) state.handRig = wrapHandRig(found);
    return state.handRig;
  }

  function ensureSentinel() {
    const THREE = global.THREE, player = currentPlayerMesh();
    if (!THREE || !player) return;
    if (state.sentinel && state.sentinelParent === player) return;
    state.sentinel?.parent?.remove?.(state.sentinel);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0.0001,0,0, 0,0.0001,0], 3));
    const material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    material.colorWrite = false;
    const sentinel = new THREE.Mesh(geometry, material);
    sentinel.name = 'player_social_dance_blend_sync';
    sentinel.frustumCulled = false;
    sentinel.renderOrder = -99990; // After the normal hand driver's -100000 sync, before visible hands/feet.
    sentinel.onBeforeRender = () => {
      if (!dancing()) return;
      applyLegLayer();
      applyHandLayer();
    };
    player.add(sentinel);
    state.sentinel = sentinel;
    state.sentinelParent = player;
  }

  function patchComposer(api) {
    if (!api?.setChannel || api.setChannel.__socialDanceRuntimeWrapped) return;
    const originalSet = api.setChannel.bind(api), originalClear = api.clearChannel?.bind(api);
    api.setChannel = function socialDanceComposerSet(name, contribution) {
      if (name === WEAPON_IDLE_CHANNEL && dancing()) { originalClear?.(WEAPON_IDLE_CHANNEL); return false; }
      return originalSet(name, contribution);
    };
    api.setChannel.__socialDanceRuntimeWrapped = true;
  }

  function patchMusic(api) {
    if (!api?.beginPlayerSession || api.beginPlayerSession.__socialKurrayaOwnershipGuard) return;
    const original = api.beginPlayerSession.bind(api);
    api.beginPlayerSession = function ownedKurrayaSession(...args) {
      if (!ownsKurraya()) { toast('You need a Kurraya before you can play one.', false); return false; }
      return original(...args);
    };
    api.beginPlayerSession.__socialKurrayaOwnershipGuard = true;
  }

  function syncKurrayaWedge() {
    const sector = document.querySelector?.('.socialActionSector[data-social-index="0"]');
    if (!sector) return;
    const owned = ownsKurraya();
    sector.classList.toggle('blocked', !owned);
    sector.setAttribute('aria-disabled', owned ? 'false' : 'true');
    const label = sector.querySelector?.('.socialActionLabel');
    if (label) label.style.opacity = owned ? '' : '0.34';
  }

  function beginDanceOwnership() {
    const locks = global.CharacterActionLocks?.getDebug?.() || [];
    const old = locks.find(lock => lock?.owner === 'social-dance');
    if (old?.token) global.CharacterActionLocks?.release?.(old.token);
    state.danceLock = global.CharacterActionLocks?.acquire?.({
      owner: 'social-dance-locomotion-blend',
      reason: 'Dance layer keeps movement available',
      participants: [{ id: PLAYER_ID, channels: ['tools', 'actions'] }],
    }) || null;
    const putAway = dep('putAwayHeldEquipment');
    if (typeof putAway === 'function') putAway();
  }

  function suppressHeldVisual() {
    global.PlayerBodyTransformComposer?.clearChannel?.(WEAPON_IDLE_CHANNEL);
    const holder = dep('toolHolder');
    if (!holder) return;
    if (state.toolHolder !== holder) {
      state.toolHolder = holder;
      state.toolHolderVisible = holder.visible !== false;
    }
    holder.visible = false;
  }

  function endDanceOwnership() {
    state.danceLock?.release?.();
    state.danceLock = null;
    if (state.toolHolder && state.toolHolderVisible != null) state.toolHolder.visible = !!state.toolHolderVisible;
    state.toolHolder = null;
    state.toolHolderVisible = null;
    state.danceKey = null;
    state.danceStartedAt = 0;
    global.NpcSocialStimuli?.clear?.(DANCE_STIM_ID);
  }

  function emitDanceStimulus(t) {
    if (t - state.lastStimAt < 500) return;
    const api = global.NpcSocialStimuli, player = currentPlayerMesh(), THREE = global.THREE;
    const getArea = dep('getCurrentArea');
    const area = typeof getArea === 'function' ? getArea() : null;
    if (!api?.emit || !player || !THREE || !area) return;
    const p = player.getWorldPosition(new THREE.Vector3());
    api.emit({ id: DANCE_STIM_ID, type: 'dance', area, x: p.x, z: p.z, radius: 9, strength: 0.72, durationMs: 1300, sourceIsPlayer: true });
    state.lastStimAt = t;
  }

  function visibleDebug() {
    const output = document.getElementById?.('socialActionWheelDebug');
    if (!output) return;
    const render = global.SocialActionR128RenderBridge?.getDebug?.() || {};
    const base = String(output.textContent || '').replace(/\s*\| Runtime:r128=.*$/, '');
    output.textContent = `${base} | Runtime:r128=${global.SocialActionR128RenderBridge?.installed ? 'yes' : 'no'} dispatch=${render.dispatchCount || 0} move=${state.danceLock ? 'blend' : 'off'} leg=${state.legApplications} hand=${state.handApplications}`;
  }

  function frame(t) {
    discoverHandRig();
    ensureSentinel();
    const active = dancing();
    if (active && !state.lastDancing) beginDanceOwnership();
    if (active) { suppressHeldVisual(); emitDanceStimulus(t); clock(t); }
    else if (state.lastDancing) endDanceOwnership();
    state.lastDancing = active;
    syncKurrayaWedge();
    global.requestAnimationFrame(frame);
  }

  chainGlobal('ProceduralLegAnimation', patchLegApi);
  chainGlobal('ProceduralHandAttachments', patchHandApi);
  chainGlobal('PlayerBodyTransformComposer', patchComposer);
  chainGlobal('MusicMinigame', patchMusic);

  const style = document.createElement('style');
  style.textContent = '.socialActionSector.blocked{filter:grayscale(1)}.socialActionSector.blocked.active{background:rgba(255,255,255,.055)!important}';
  document.head.appendChild(style);
  global.setInterval?.(visibleDebug, 500);

  global.SocialActionDanceRuntime = {
    installed: true,
    ownsKurraya,
    getDebug: () => ({
      dancing: dancing(),
      playerLegCaptured: !!state.legHandle,
      playerHandCaptured: !!state.handRig,
      movementBlend: !!state.danceLock,
      lastLegSpeed: state.lastLegSpeed,
      legApplications: state.legApplications,
      handApplications: state.handApplications,
      hasPreRenderSentinel: !!state.sentinel,
    }),
  };
  global.requestAnimationFrame(frame);
})(window);
