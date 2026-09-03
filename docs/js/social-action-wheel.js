(() => {
  'use strict';

  if (window.SocialActionWheel?.installed) return;

  const THREE = window.THREE;
  if (!THREE) return;

  const DEFAULTS = Object.freeze({
    desktopOpen: 'Shift+KeyQ',
    controllerOpen: 'Button13',
    outerButtonIcon: '☺',
    wheelRadiusPx: 190,
    wheelInnerRadiusPx: 68,
    danceBpm: 104,
    danceGroove: 72,
    mobileOuterAnglesDeg: Object.freeze({
      btnWeaponSwitch: 170,
      toolBtn: 160,
      itemBtn: 150,
      btnCallMount: 140,
      btnUtilityMenu: 130,
      btnSocialActions: 120,
    }),
  });

  // Runtime-overridable config. Defining SCRATCHBONES_CONFIG.game.socialActions
  // before this module loads replaces any of these defaults without touching game.js.
  const gameConfig = window.SCRATCHBONES_CONFIG?.game || {};
  gameConfig.socialActions = Object.assign({}, DEFAULTS, gameConfig.socialActions || {});
  const cfg = gameConfig.socialActions;

  // D-pad Down used to be the mount default. Social Actions now owns it;
  // only the untouched old default is cleared so custom mount bindings survive.
  const inputActions = gameConfig.input?.actions;
  if (Array.isArray(inputActions)) {
    const mount = inputActions.find(action => action.id === 'toggleMount');
    if (mount?.controller === DEFAULTS.controllerOpen) mount.controller = null;
    if (!inputActions.some(action => action.id === 'socialWheel')) {
      inputActions.push({
        id: 'socialWheel',
        label: 'Social Actions',
        desktop: cfg.desktopOpen || DEFAULTS.desktopOpen,
        controller: cfg.controllerOpen || DEFAULTS.controllerOpen,
      });
    }
  }

  const DANCE_STYLES = Object.freeze({
    'side-step': Object.freeze({ label: 'Side Step', intensity: 1.00, stepFactor: 1.00 }),
    'gentle-twirl': Object.freeze({ label: 'Gentle Twirl', intensity: 1.18, stepFactor: 0.88 }),
    'loose-sway': Object.freeze({ label: 'Loose Sway', intensity: 0.96, stepFactor: 0.48 }),
  });
  const ARM_STYLES = Object.freeze({
    'overhead-punch': 'Overhead Punch',
    'tpose-jiggle': 'T-Pose Jiggle',
  });

  const ACTIONS = Object.freeze([
    { id: 'kurraya', icon: '♫', label: 'Play Kurraya', kind: 'kurraya' },
    { id: 'side-step-punch', icon: '↔', label: 'Side Step · Punch', kind: 'dance', style: 'side-step', armStyle: 'overhead-punch' },
    { id: 'side-step-tpose', icon: '↔', label: 'Side Step · T-Pose', kind: 'dance', style: 'side-step', armStyle: 'tpose-jiggle' },
    { id: 'gentle-twirl-punch', icon: '↻', label: 'Gentle Twirl · Punch', kind: 'dance', style: 'gentle-twirl', armStyle: 'overhead-punch' },
    { id: 'gentle-twirl-tpose', icon: '↻', label: 'Gentle Twirl · T-Pose', kind: 'dance', style: 'gentle-twirl', armStyle: 'tpose-jiggle' },
    { id: 'loose-sway-punch', icon: '〰', label: 'Loose Sway · Punch', kind: 'dance', style: 'loose-sway', armStyle: 'overhead-punch' },
    { id: 'loose-sway-tpose', icon: '〰', label: 'Loose Sway · T-Pose', kind: 'dance', style: 'loose-sway', armStyle: 'tpose-jiggle' },
  ]);

  const state = {
    open: false,
    latched: false,
    openSource: null,
    selectedIndex: -1,
    lock: null,
    danceLock: null,
    dance: null,
    playerLegHandles: new Set(),
    handRigs: new Set(),
    hooksInstalled: false,
    renderHookInstalled: false,
    priorGamepad: new Map(),
    debug: {
      lastChange: 'Added centered Social Actions wheel with curated procedural dance presets.',
      lastOpenSource: null,
      lastAction: null,
      controllerOpenBinding: null,
      desktopOpenBinding: null,
      playerLegRig: false,
      playerHandRig: false,
    },
  };

  let overlay = null;
  let wheel = null;
  let centerLabel = null;
  let debugOutput = null;
  let mobileButton = null;

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function smootherstep01(value) {
    const t = clamp01(value);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function grooveScale(groove) {
    const safeGroove = Math.max(0, Number(groove) || 0);
    const curveRate = 52;
    return Math.expm1(safeGroove / curveRate) / Math.expm1(100 / curveRate);
  }

  function tactusBpm(rawBpm) {
    let bpm = Number(rawBpm) || DEFAULTS.danceBpm;
    while (bpm > 122) bpm /= 2;
    while (bpm < 58) bpm *= 2;
    return bpm;
  }

  function currentBindings() {
    return window.InputBindings?.getCurrentBindings?.() || null;
  }

  function binding(device, actionId, fallback = null) {
    return currentBindings()?.[device]?.[actionId] || fallback;
  }

  function parseDesktopChord(raw) {
    const tokens = String(raw || '').split('+').map(token => token.trim()).filter(Boolean);
    const code = tokens.pop() || '';
    const modifiers = new Set(tokens.map(token => token.toLowerCase()));
    return { code, shift: modifiers.has('shift'), ctrl: modifiers.has('ctrl') || modifiers.has('control'), alt: modifiers.has('alt'), meta: modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command') };
  }

  function matchesDesktopBinding(event, rawBinding) {
    const parsed = parseDesktopChord(rawBinding);
    if (!parsed.code || event.code !== parsed.code) return false;
    return event.shiftKey === parsed.shift
      && event.ctrlKey === parsed.ctrl
      && event.altKey === parsed.alt
      && event.metaKey === parsed.meta;
  }

  function isDescendantOf(node, ancestor) {
    let cursor = node;
    while (cursor) {
      if (cursor === ancestor) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  function currentPlayerMesh() {
    return window.PlayerBodyTransformComposer?.getPlayerMesh?.() || null;
  }

  function playerLegHandle() {
    const playerMesh = currentPlayerMesh();
    if (!playerMesh) return null;
    for (const handle of state.playerLegHandles) {
      if (handle?.group && isDescendantOf(handle.group, playerMesh)) return handle;
    }
    return null;
  }

  function playerHandRig() {
    const playerMesh = currentPlayerMesh();
    if (!playerMesh) return null;
    for (const rig of state.handRigs) {
      if (rig?.group && isDescendantOf(rig.group, playerMesh)) return rig;
      if (rig?.parent && isDescendantOf(rig.parent, playerMesh)) return rig;
    }
    return null;
  }

  function installRigHooks() {
    if (state.hooksInstalled) return;
    const legs = window.ProceduralLegAnimation;
    const hands = window.ProceduralHandAttachments;
    let touched = false;

    if (legs?.attach && !legs.attach.__socialActionWheelWrapped) {
      const original = legs.attach.bind(legs);
      const wrapped = function socialWheelLegAttach(THREEArg, parent, options = {}) {
        const handle = original(THREEArg, parent, options);
        if (handle) {
          state.playerLegHandles.add(handle);
          const originalDispose = typeof handle.dispose === 'function' ? handle.dispose.bind(handle) : null;
          handle.dispose = function socialWheelLegDispose() {
            state.playerLegHandles.delete(handle);
            return originalDispose?.();
          };
        }
        return handle;
      };
      wrapped.__socialActionWheelWrapped = true;
      wrapped.__socialActionWheelOriginal = original;
      legs.attach = wrapped;
      touched = true;
    }

    if (hands?.attach && !hands.attach.__socialActionWheelWrapped) {
      const original = hands.attach.bind(hands);
      const wrapped = function socialWheelHandAttach(THREEArg, parent, options = {}) {
        const rig = original(THREEArg, parent, options);
        if (rig) {
          state.handRigs.add(rig);
          const originalDispose = typeof rig.dispose === 'function' ? rig.dispose.bind(rig) : null;
          rig.dispose = function socialWheelHandDispose() {
            state.handRigs.delete(rig);
            return originalDispose?.();
          };
        }
        return rig;
      };
      wrapped.__socialActionWheelWrapped = true;
      wrapped.__socialActionWheelOriginal = original;
      hands.attach = wrapped;
      touched = true;
    }

    state.hooksInstalled = !!(window.ProceduralLegAnimation?.attach && window.ProceduralHandAttachments?.attach);
    if (touched) updateDebug();
  }

  function frontPlaneDimensions(model) {
    let plane = null;
    model?.traverse?.(node => {
      if (!plane && node.isMesh && (node.userData?.hobunjiPlaneFace || /_front_plane$/.test(node.name || ''))) plane = node;
    });
    const parameters = plane?.geometry?.parameters || {};
    const width = Number(model?.userData?.portraitModelWidth) || Number(parameters.width) || 0.9;
    const height = Number(model?.userData?.portraitModelHeight) || Number(parameters.height) || width;
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function deriveLegBend(root, chain, targetWorld) {
    if (!window.LegBones?.solveTwoBoneLeg || !root || !chain?.hip || !chain?.thigh || !targetWorld) return { x: 0, z: 0 };
    root.updateMatrixWorld(true);
    const targetLocal = root.worldToLocal(targetWorld.clone());
    const straight = window.LegBones.solveTwoBoneLeg(THREE, { hip: chain.hip.position, foot: targetLocal });
    const bendQuaternion = straight.thighQuaternion.clone().invert().multiply(chain.thigh.quaternion.clone());
    const bendEuler = new THREE.Euler().setFromQuaternion(bendQuaternion, 'XYZ');
    return { x: THREE.MathUtils.radToDeg(bendEuler.x), z: THREE.MathUtils.radToDeg(bendEuler.z) };
  }

  function captureLeg(root, side) {
    const hip = root?.getObjectByName?.(`${side}_hip`);
    const thigh = root?.getObjectByName?.(`${side}_thigh`);
    const calf = root?.getObjectByName?.(`${side}_calf`);
    const foot = root?.getObjectByName?.(`${side}_foot`);
    if (!hip || !thigh || !calf || !foot) return null;
    root.updateMatrixWorld(true);
    const anchorWorld = foot.getWorldPosition(new THREE.Vector3());
    return {
      hip, thigh, calf, foot,
      bend: deriveLegBend(root, { hip, thigh }, anchorWorld),
      anchorWorld: anchorWorld.clone(),
      contactWorldY: anchorWorld.y,
      baseFootQuaternion: foot.quaternion.clone(),
    };
  }

  function captureDanceRig() {
    const handle = playerLegHandle();
    const root = handle?.group || null;
    if (!root) return null;
    const left = captureLeg(root, 'left');
    const right = captureLeg(root, 'right');
    return left && right ? { root, left, right } : null;
  }

  function captureHandState() {
    const rig = playerHandRig();
    if (!rig?.group) return null;
    const left = rig.group.getObjectByName?.('left_hand_socket');
    const right = rig.group.getObjectByName?.('right_hand_socket');
    if (!left || !right) return null;
    return {
      rig,
      left,
      right,
      leftBasePosition: left.position.clone(),
      rightBasePosition: right.position.clone(),
      leftBaseQuaternion: left.quaternion.clone(),
      rightBaseQuaternion: right.quaternion.clone(),
      jiggle: { left: 0, right: 0, leftVel: 0, rightVel: 0 },
    };
  }

  function springStep(pos, vel, target, stiffness, dampingLambda, dt) {
    const accel = (target - pos) * stiffness - vel * dampingLambda;
    const nextVel = vel + accel * dt;
    return { pos: pos + nextVel * dt, vel: nextVel };
  }

  function danceMotion(style, localBeat, mappedIntensity) {
    const phase = localBeat * Math.PI * 2;
    const alternatingWeight = Math.sin(phase * 0.5);
    const fourBeatSway = Math.sin(phase * 0.25);
    const beatPulse = Math.pow(Math.max(0, Math.cos(phase)), 4);
    let tangentShift = 0;
    let bounce = 0;
    let bodySway = 0;
    let twirlRotation = 0;

    if (style === 'side-step') {
      tangentShift = alternatingWeight * 0.30 * mappedIntensity;
      bounce = beatPulse * 0.12 * mappedIntensity;
      bodySway = fourBeatSway * 0.22 * mappedIntensity;
    } else if (style === 'gentle-twirl') {
      tangentShift = alternatingWeight * 0.14 * mappedIntensity;
      bounce = beatPulse * 0.12 * mappedIntensity;
      bodySway = fourBeatSway * 0.20 * mappedIntensity;
      const cycle = ((localBeat % 8) + 8) % 8;
      const turnProgress = clamp01((cycle - 4.5) / 2);
      twirlRotation = mappedIntensity >= 0.56
        ? Math.PI * 2 * smootherstep01(turnProgress)
        : Math.sin(turnProgress * Math.PI) * 0.8 * mappedIntensity;
    } else {
      tangentShift = alternatingWeight * 0.18 * mappedIntensity;
      bounce = beatPulse * 0.09 * mappedIntensity;
      bodySway = fourBeatSway * 0.36 * mappedIntensity;
    }

    return { phase, tangentShift, bounce, bodySway, twirlRotation };
  }

  function solveLegToWorld(dance, side, targetWorld, toeYaw = 0, toeRoll = 0) {
    const leg = dance.rig?.[side];
    const root = dance.rig?.root;
    if (!leg || !root || !window.LegBones?.solveTwoBoneLeg) return;
    root.updateMatrixWorld(true);
    const targetLocal = root.worldToLocal(targetWorld.clone());
    const solved = window.LegBones.solveTwoBoneLeg(THREE, {
      hip: leg.hip.position,
      foot: targetLocal,
      bendDegX: leg.bend.x,
      bendDegZ: leg.bend.z,
    });
    leg.thigh.quaternion.copy(solved.thighQuaternion);
    leg.calf.position.set(0, -solved.thighLength, 0);
    leg.calf.quaternion.copy(solved.calfLocalQuaternion);
    leg.foot.position.set(0, -solved.calfLength, 0);
    leg.foot.quaternion.copy(leg.baseFootQuaternion).multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, toeYaw, toeRoll, 'YXZ'))
    );
  }

  function applyDanceLegs(dance, localBeat, mappedIntensity, motion) {
    if (!dance.rig) return;
    const beatIndex = Math.floor(localBeat);
    const swingSide = beatIndex % 2 === 0 ? 'left' : 'right';
    const swingProgress = ((localBeat % 1) + 1) % 1;

    if (dance.previousBeatIndex !== beatIndex) {
      if (dance.previousSwingSide && dance.lastLandingWorld[dance.previousSwingSide]) {
        dance.rig[dance.previousSwingSide].anchorWorld.copy(dance.lastLandingWorld[dance.previousSwingSide]);
      }
      dance.previousBeatIndex = beatIndex;
      dance.previousSwingSide = swingSide;
    }

    const styleStep = DANCE_STYLES[dance.style]?.stepFactor ?? 0.5;
    const supportStrength = styleStep * clamp01(mappedIntensity);
    const dimensions = dance.dimensions;
    const baseLift = dimensions.height * (0.018 + 0.045 * clamp01(mappedIntensity)) * Math.max(0.25, supportStrength);
    const hipRoll = Math.sin(motion.phase * 0.5) * mappedIntensity * THREE.MathUtils.degToRad(14);

    for (const side of ['left', 'right']) {
      const leg = dance.rig[side];
      const hipWorld = leg.hip.getWorldPosition(new THREE.Vector3());
      const landingWorld = leg.anchorWorld.clone().lerp(
        new THREE.Vector3(hipWorld.x, leg.contactWorldY, hipWorld.z),
        clamp01(supportStrength),
      );
      dance.lastLandingWorld[side] = landingWorld.clone();

      const targetWorld = leg.anchorWorld.clone();
      if (side === swingSide && supportStrength > 0.01) {
        targetWorld.lerp(landingWorld, smootherstep01(swingProgress));
        const hipLift = Math.abs(Math.sin(hipRoll)) * dimensions.width * 0.16;
        targetWorld.y = leg.contactWorldY + Math.sin(Math.PI * swingProgress) * baseLift + hipLift;
      }
      solveLegToWorld(dance, side, targetWorld);
    }
  }

  function applyDanceHands(dance, localBeat, motion, dt) {
    const hands = dance.hands;
    if (!hands) return;
    const dims = dance.dimensions;
    const reach = dims.height * 0.62;

    const setSocket = (socket, position, baseQuaternion) => {
      socket.position.copy(position);
      socket.quaternion.copy(baseQuaternion);
      socket.visible = true;
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
    };

    if (dance.armStyle === 'tpose-jiggle') {
      const spread = dims.width * 0.62;
      for (const side of ['left', 'right']) {
        const socket = hands[side];
        const base = side === 'left' ? hands.leftBasePosition : hands.rightBasePosition;
        const sign = Math.sign(base.x) || (side === 'left' ? 1 : -1);
        const target = motion.bodySway * dims.width * 0.9;
        const step = springStep(hands.jiggle[side], hands.jiggle[`${side}Vel`], target, 90, 9, dt);
        hands.jiggle[side] = step.pos;
        hands.jiggle[`${side}Vel`] = step.vel;
        const shoulderY = base.y + dims.height * 0.10;
        const targetPos = new THREE.Vector3(base.x * 0.62 + sign * spread + hands.jiggle[side], shoulderY, base.z);
        setSocket(socket, targetPos, side === 'left' ? hands.leftBaseQuaternion : hands.rightBaseQuaternion);
      }
      return;
    }

    const punchPhase = ((localBeat % 1) + 1) % 1;
    const extend = Math.pow(Math.max(0, Math.sin(Math.PI * punchPhase)), 0.4);
    for (const side of ['left', 'right']) {
      const socket = hands[side];
      const base = side === 'left' ? hands.leftBasePosition : hands.rightBasePosition;
      const shoulder = new THREE.Vector3(base.x * 0.62, base.y + dims.height * 0.10, base.z);
      const cocked = new THREE.Vector3(shoulder.x, shoulder.y + reach * 0.12, shoulder.z + dims.height * 0.08);
      const extended = new THREE.Vector3(shoulder.x * 0.5, shoulder.y + reach, shoulder.z);
      setSocket(socket, cocked.lerp(extended, extend), side === 'left' ? hands.leftBaseQuaternion : hands.rightBaseQuaternion);
    }
  }

  function restoreHands(hands) {
    if (!hands) return;
    hands.left.position.copy(hands.leftBasePosition);
    hands.right.position.copy(hands.rightBasePosition);
    hands.left.quaternion.copy(hands.leftBaseQuaternion);
    hands.right.quaternion.copy(hands.rightBaseQuaternion);
    hands.left.updateMatrix?.();
    hands.right.updateMatrix?.();
  }

  function startDance(style, armStyle) {
    if (!DANCE_STYLES[style] || !ARM_STYLES[armStyle]) return false;
    stopDance('replace');

    const model = currentPlayerMesh();
    if (!model) {
      toast('Player rig is not ready yet.', false);
      return false;
    }

    const now = performance.now();
    state.dance = {
      style,
      armStyle,
      startedAt: now,
      lastNow: now,
      dimensions: frontPlaneDimensions(model),
      rig: captureDanceRig(),
      hands: captureHandState(),
      previousBeatIndex: null,
      previousSwingSide: null,
      lastLandingWorld: { left: null, right: null },
    };

    state.danceLock = window.CharacterActionLocks?.acquire?.({
      owner: 'social-dance',
      reason: `${DANCE_STYLES[style].label} / ${ARM_STYLES[armStyle]}`,
      participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }],
    }) || null;

    state.debug.lastAction = `Dance: ${DANCE_STYLES[style].label} + ${ARM_STYLES[armStyle]}`;
    toast(`${DANCE_STYLES[style].label} · ${ARM_STYLES[armStyle]} — Dodge to stop`, true);
    updateDebug();
    return true;
  }

  function stopDance(reason = 'cancel') {
    const dance = state.dance;
    if (!dance) return false;
    restoreHands(dance.hands);
    state.dance = null;
    window.PlayerBodyTransformComposer?.clearChannel?.('social-dance');
    state.danceLock?.release?.();
    state.danceLock = null;
    if (reason !== 'replace') {
      state.debug.lastAction = `Dance stopped (${reason})`;
      updateDebug();
    }
    return true;
  }

  function applyDanceFrame(now) {
    const dance = state.dance;
    if (!dance) return;
    const model = currentPlayerMesh();
    if (!model) {
      stopDance('player rig lost');
      return;
    }

    if (!dance.rig) dance.rig = captureDanceRig();
    if (!dance.hands) dance.hands = captureHandState();

    const dt = Math.max(0, Math.min(0.05, (now - dance.lastNow) / 1000));
    dance.lastNow = now;
    const bpm = tactusBpm(cfg.danceBpm);
    const localBeat = (now - dance.startedAt) / (60000 / bpm);
    const mappedIntensity = grooveScale(cfg.danceGroove) * (DANCE_STYLES[dance.style]?.intensity ?? 1);
    const motion = danceMotion(dance.style, localBeat, mappedIntensity);
    const sizeScale = dance.dimensions.width / 0.9;

    window.PlayerBodyTransformComposer?.setChannel?.('social-dance', {
      priority: 60,
      rotation: { pitch: 0, yaw: motion.twirlRotation, roll: motion.bodySway },
      translation: { x: motion.tangentShift * sizeScale, y: motion.bounce * sizeScale, z: 0 },
    });

    applyDanceLegs(dance, localBeat, mappedIntensity, motion);
    applyDanceHands(dance, localBeat, motion, dt);
    state.debug.playerLegRig = !!dance.rig;
    state.debug.playerHandRig = !!dance.hands;
  }

  function installRenderHook() {
    if (state.renderHookInstalled || !THREE.WebGLRenderer) return;
    const proto = THREE.WebGLRenderer.prototype;
    const originalRender = proto.render;
    if (originalRender.__socialActionWheelRenderHook) {
      state.renderHookInstalled = true;
      return;
    }
    function socialActionWheelRender(scene, camera) {
      const dance = state.dance;
      let handSnapshot = null;
      if (dance?.hands) {
        handSnapshot = {
          leftPos: dance.hands.left.position.clone(),
          rightPos: dance.hands.right.position.clone(),
          leftQuat: dance.hands.left.quaternion.clone(),
          rightQuat: dance.hands.right.quaternion.clone(),
        };
      }
      if (dance) applyDanceFrame(performance.now());
      try {
        return originalRender.call(this, scene, camera);
      } finally {
        if (dance?.hands && handSnapshot) {
          dance.hands.left.position.copy(handSnapshot.leftPos);
          dance.hands.right.position.copy(handSnapshot.rightPos);
          dance.hands.left.quaternion.copy(handSnapshot.leftQuat);
          dance.hands.right.quaternion.copy(handSnapshot.rightQuat);
        }
      }
    }
    socialActionWheelRender.__socialActionWheelRenderHook = true;
    socialActionWheelRender.__socialActionWheelOriginal = originalRender;
    proto.render = socialActionWheelRender;
    state.renderHookInstalled = true;
  }

  function toast(message, good = true) {
    const gameToast = window.ProceduralHandAttachments?.gameDeps?.showToast;
    if (typeof gameToast === 'function') gameToast(message, good);
    else window.__farmLog?.(`[Social Actions] ${message}`, good ? 'info' : 'warn');
  }

  function performAction(action) {
    if (!action) return;
    state.debug.lastAction = action.label;
    if (action.kind === 'kurraya') {
      stopDance('kurraya');
      if (!window.MusicMinigame?.beginPlayerSession) {
        toast('Kurraya performance is not ready.', false);
        return;
      }
      window.MusicMinigame.beginPlayerSession();
      updateDebug();
      return;
    }
    if (action.kind === 'dance') startDance(action.style, action.armStyle);
  }

  function sectorPolygon(index, count) {
    const step = 360 / count;
    const start = -90 + index * step - step / 2;
    const end = start + step;
    const points = ['50% 50%'];
    const samples = 8;
    for (let i = 0; i <= samples; i++) {
      const angle = THREE.MathUtils.degToRad(start + (end - start) * (i / samples));
      const x = 50 + Math.cos(angle) * 50;
      const y = 50 + Math.sin(angle) * 50;
      points.push(`${x.toFixed(3)}% ${y.toFixed(3)}%`);
    }
    return `polygon(${points.join(',')})`;
  }

  function injectStyles() {
    if (document.getElementById('socialActionWheelStyles')) return;
    const style = document.createElement('style');
    style.id = 'socialActionWheelStyles';
    const outerRules = Object.entries(cfg.mobileOuterAnglesDeg || DEFAULTS.mobileOuterAnglesDeg)
      .map(([id, deg]) => `#${id}{right:calc(-1*cos(${Number(deg)}deg)*var(--ar2))!important;bottom:calc(sin(${Number(deg)}deg)*var(--ar2))!important;}`)
      .join('\n');
    style.textContent = `
#socialActionOverlay{position:fixed;inset:0;z-index:12050;background:rgba(0,0,0,.28);display:none;touch-action:none;user-select:none}
#socialActionOverlay.open{display:block}
#socialActionWheel{position:absolute;left:50%;top:50%;width:min(${Number(cfg.wheelRadiusPx)*2}px,82vmin);height:min(${Number(cfg.wheelRadiusPx)*2}px,82vmin);transform:translate(-50%,-50%);border-radius:50%;overflow:hidden;background:rgba(8,15,20,.91);box-shadow:0 0 0 2px rgba(255,255,255,.24),0 18px 70px rgba(0,0,0,.68)}
.socialActionSector{position:absolute;inset:0;border:0;padding:0;background:rgba(255,255,255,.045);pointer-events:none}
.socialActionSector.active{background:rgba(255,231,135,.28)}
.socialActionSector .socialActionLabel{position:absolute;left:50%;top:50%;width:112px;transform:translate(-50%,-50%);text-align:center;color:#fff;font:700 12px/1.12 "Pixelify Sans",system-ui,sans-serif;text-shadow:0 2px 4px #000}
.socialActionSector .socialActionIcon{display:block;font-size:26px;line-height:1;margin-bottom:5px}
#socialActionWheelCenter{position:absolute;left:50%;top:50%;width:34%;height:34%;transform:translate(-50%,-50%);border-radius:50%;display:grid;place-items:center;text-align:center;padding:12px;box-sizing:border-box;background:rgba(4,8,11,.96);box-shadow:0 0 0 2px rgba(255,255,255,.20);color:#fff;font:700 13px/1.2 "Pixelify Sans",system-ui,sans-serif;pointer-events:none}
#socialActionWheelDebug{position:fixed;left:50%;top:calc(50% + min(${Number(cfg.wheelRadiusPx)}px,41vmin) + 14px);transform:translateX(-50%);max-width:min(92vw,520px);padding:6px 9px;border-radius:8px;background:rgba(0,0,0,.72);color:#d7e9ff;font:11px/1.25 "DM Mono",monospace;pointer-events:none}
#btnSocialActions{position:absolute}
#btnSocialActions .abt-icon{font-size:1.25em}
${outerRules}
`;
    document.head.appendChild(style);
  }

  function buildUi() {
    if (overlay) return;
    injectStyles();

    overlay = document.createElement('div');
    overlay.id = 'socialActionOverlay';
    overlay.setAttribute('aria-hidden', 'true');

    wheel = document.createElement('div');
    wheel.id = 'socialActionWheel';
    wheel.setAttribute('role', 'menu');
    wheel.setAttribute('aria-label', 'Social actions');

    const radius = Math.min(Number(cfg.wheelRadiusPx) || DEFAULTS.wheelRadiusPx, 190);
    ACTIONS.forEach((action, index) => {
      const sector = document.createElement('button');
      sector.type = 'button';
      sector.className = 'socialActionSector';
      sector.dataset.socialIndex = String(index);
      sector.setAttribute('aria-label', action.label);
      sector.style.clipPath = sectorPolygon(index, ACTIONS.length);

      const step = Math.PI * 2 / ACTIONS.length;
      const angle = -Math.PI / 2 + index * step;
      const label = document.createElement('span');
      label.className = 'socialActionLabel';
      label.style.transform = `translate(-50%,-50%) translate(${Math.cos(angle) * radius * 0.62}px,${Math.sin(angle) * radius * 0.62}px)`;
      label.innerHTML = `<span class="socialActionIcon">${action.icon}</span>${action.label}`;
      sector.appendChild(label);
      wheel.appendChild(sector);
    });

    centerLabel = document.createElement('div');
    centerLabel.id = 'socialActionWheelCenter';
    centerLabel.textContent = 'Social Actions';
    wheel.appendChild(centerLabel);

    debugOutput = document.createElement('output');
    debugOutput.id = 'socialActionWheelDebug';

    overlay.append(wheel, debugOutput);
    document.body.appendChild(overlay);

    overlay.addEventListener('pointermove', event => {
      if (!state.open) return;
      selectFromPoint(event.clientX, event.clientY);
      event.preventDefault();
    }, { passive: false });

    overlay.addEventListener('pointerdown', event => {
      if (!state.open) return;
      selectFromPoint(event.clientX, event.clientY);
      if (state.latched && state.selectedIndex >= 0) {
        event.preventDefault();
        commitSelection();
      }
    });

    createMobileButton();
    updateDebug();
  }

  function createMobileButton() {
    if (document.getElementById('btnSocialActions')) {
      mobileButton = document.getElementById('btnSocialActions');
      return;
    }
    const anchor = document.getElementById('btnUtilityMenu') || document.getElementById('btnCallMount');
    const parent = anchor?.parentElement;
    if (!parent) return;
    mobileButton = document.createElement('button');
    mobileButton.id = 'btnSocialActions';
    mobileButton.className = 'abt';
    mobileButton.setAttribute('aria-label', 'Social actions');
    mobileButton.innerHTML = `<span class="abt-icon">${cfg.outerButtonIcon || DEFAULTS.outerButtonIcon}</span>`;
    anchor.insertAdjacentElement('afterend', mobileButton);

    mobileButton.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
    }, true);
    mobileButton.addEventListener('pointerup', event => {
      event.preventDefault();
      event.stopPropagation();
      if (state.open) closeWheel(false);
      else openWheel('mobile', true);
    }, true);
  }

  function wheelCenter() {
    const rect = wheel?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width / 2 } : null;
  }

  function selectFromVector(x, y) {
    const magnitude = Math.hypot(x, y);
    if (magnitude < 0.28) {
      setSelected(-1);
      return;
    }
    const angle = Math.atan2(y, x);
    const normalized = (angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    const step = Math.PI * 2 / ACTIONS.length;
    setSelected(Math.round(normalized / step) % ACTIONS.length);
  }

  function selectFromPoint(clientX, clientY) {
    const center = wheelCenter();
    if (!center) return;
    const dx = clientX - center.x;
    const dy = clientY - center.y;
    const distance = Math.hypot(dx, dy);
    const inner = Math.min(Number(cfg.wheelInnerRadiusPx) || DEFAULTS.wheelInnerRadiusPx, center.radius * 0.55);
    if (distance < inner) {
      setSelected(-1);
      return;
    }
    selectFromVector(dx / center.radius, dy / center.radius);
  }

  function setSelected(index) {
    const next = Number.isInteger(index) && index >= 0 && index < ACTIONS.length ? index : -1;
    if (state.selectedIndex === next) return;
    state.selectedIndex = next;
    wheel?.querySelectorAll('.socialActionSector').forEach((sector, i) => sector.classList.toggle('active', i === next));
    centerLabel.textContent = next >= 0 ? ACTIONS[next].label : 'Social Actions';
    updateDebug();
  }

  function acquireWheelLock() {
    state.lock?.release?.();
    state.lock = window.CharacterActionLocks?.acquire?.({
      owner: 'social-action-wheel',
      reason: 'Choosing social action',
      participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }],
    }) || null;
  }

  function openWheel(source, latched = false) {
    if (window.MusicMinigame?.state?.active) return false;
    if (!overlay) buildUi();
    if (!overlay) return false;
    if (state.open) return true;

    state.open = true;
    state.latched = !!latched;
    state.openSource = source;
    state.selectedIndex = -1;
    state.debug.lastOpenSource = source;
    acquireWheelLock();

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    mobileButton?.classList.add('active');
    setSelected(-1);
    updateDebug();
    return true;
  }

  function closeWheel(commit = false) {
    if (!state.open) return false;
    const action = commit && state.selectedIndex >= 0 ? ACTIONS[state.selectedIndex] : null;
    state.open = false;
    state.latched = false;
    state.openSource = null;
    state.selectedIndex = -1;
    state.lock?.release?.();
    state.lock = null;
    overlay?.classList.remove('open');
    overlay?.setAttribute('aria-hidden', 'true');
    mobileButton?.classList.remove('active');
    if (action) performAction(action);
    updateDebug();
    return true;
  }

  function commitSelection() {
    return closeWheel(true);
  }

  function cancelWheelOrDance(reason = 'dodge') {
    if (state.open) return closeWheel(false);
    return stopDance(reason);
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const dodgeBinding = binding('desktop', 'dodge', 'KeyX');
    if ((state.open || state.dance) && matchesDesktopBinding(event, dodgeBinding)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelWheelOrDance('dodge');
      return;
    }

    const configured = binding('desktop', 'socialWheel', cfg.desktopOpen || DEFAULTS.desktopOpen);
    if (matchesDesktopBinding(event, configured)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openWheel('keyboard', false);
    }
  }

  function onKeyUp(event) {
    if (!state.open || state.openSource !== 'keyboard') return;
    const configured = binding('desktop', 'socialWheel', cfg.desktopOpen || DEFAULTS.desktopOpen);
    const parsed = parseDesktopChord(configured);
    if (event.code !== parsed.code) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    commitSelection();
  }

  function buttonIndex(code) {
    const match = /^Button(\d+)$/.exec(String(code || ''));
    return match ? Number(match[1]) : -1;
  }

  function pollGamepads() {
    installRigHooks();
    installRenderHook();

    const pads = navigator.getGamepads?.() || [];
    for (const pad of pads) {
      if (!pad) continue;
      const previous = state.priorGamepad.get(pad.index) || [];
      const current = pad.buttons.map(button => !!button?.pressed);
      const openCode = binding('controller', 'socialWheel', cfg.controllerOpen || DEFAULTS.controllerOpen);
      const dodgeCode = binding('controller', 'dodge', 'Button1');
      const openIndex = buttonIndex(openCode);
      const dodgeIndex = buttonIndex(dodgeCode);

      const openNow = openIndex >= 0 && current[openIndex];
      const openBefore = openIndex >= 0 && previous[openIndex];
      if (openNow && !openBefore) openWheel('controller', false);

      if (state.open && state.openSource === 'controller') {
        const x = Number(pad.axes?.[0]) || 0;
        const y = Number(pad.axes?.[1]) || 0;
        selectFromVector(x, y);
        if (!openNow && openBefore) commitSelection();
      }

      if ((state.open || state.dance) && dodgeIndex >= 0 && current[dodgeIndex] && !previous[dodgeIndex]) {
        cancelWheelOrDance('dodge');
      }

      state.priorGamepad.set(pad.index, current);
    }

    requestAnimationFrame(pollGamepads);
  }

  function bindMobileDodge() {
    const dodge = document.getElementById('dodgeBtn');
    if (!dodge || dodge.__socialActionCancelBound) return;
    dodge.__socialActionCancelBound = true;
    dodge.addEventListener('pointerdown', event => {
      if (!state.open && !state.dance) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelWheelOrDance('dodge');
    }, true);
  }

  function clearLegacyMountConflict() {
    const bindings = currentBindings();
    if (!bindings?.controller) return;
    const socialBinding = bindings.controller.socialWheel || cfg.controllerOpen || DEFAULTS.controllerOpen;
    if (socialBinding === DEFAULTS.controllerOpen && bindings.controller.toggleMount === DEFAULTS.controllerOpen) {
      bindings.controller.toggleMount = null;
      window.InputBindings?.saveInputBindings?.();
    }
  }

  function updateDebug() {
    if (!debugOutput) return;
    const desktopOpen = binding('desktop', 'socialWheel', cfg.desktopOpen || DEFAULTS.desktopOpen);
    const controllerOpen = binding('controller', 'socialWheel', cfg.controllerOpen || DEFAULTS.controllerOpen);
    state.debug.desktopOpenBinding = desktopOpen;
    state.debug.controllerOpenBinding = controllerOpen;
    debugOutput.textContent = `${state.debug.lastChange} | Open: ${desktopOpen} / ${controllerOpen} | Dodge cancels | ${state.dance ? `Dancing ${state.dance.style}+${state.dance.armStyle}` : 'Not dancing'} | Legs:${state.debug.playerLegRig ? 'yes' : 'pending'} Hands:${state.debug.playerHandRig ? 'yes' : 'pending'}`;
  }

  function boot() {
    buildUi();
    bindMobileDodge();
    clearLegacyMountConflict();
    installRigHooks();
    installRenderHook();

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', () => { if (state.open && !state.latched) closeWheel(false); });

    setInterval(() => {
      bindMobileDodge();
      clearLegacyMountConflict();
      createMobileButton();
      updateDebug();
    }, 1000);

    requestAnimationFrame(pollGamepads);
  }

  window.SocialActionWheel = {
    installed: true,
    open: openWheel,
    close: closeWheel,
    cancel: cancelWheelOrDance,
    startDance,
    stopDance,
    get actions() { return ACTIONS.slice(); },
    getDebug() {
      return {
        ...state.debug,
        open: state.open,
        latched: state.latched,
        selectedIndex: state.selectedIndex,
        selectedAction: state.selectedIndex >= 0 ? ACTIONS[state.selectedIndex]?.id : null,
        dancing: state.dance ? { style: state.dance.style, armStyle: state.dance.armStyle } : null,
        approvedDanceStyles: Object.keys(DANCE_STYLES),
        approvedArmStyles: Object.keys(ARM_STYLES),
      };
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();