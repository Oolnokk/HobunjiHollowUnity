// Procedural Animation Editor: upright heavy-object carry locomotion mode.
//
// Carry is deliberately NOT a second locomotion simulator. It selects the
// editor's existing Regular movement preset, leaves its movement/turning/
// authored feet completely authoritative, and adds only a constrained
// torso + shoulder/elbow/hand/object layer immediately before render. This is
// the same extension pattern used by procedural-dance-mode.js.
(function () {
  'use strict';

  if (window.ProceduralCarryWalkMode?.installed) return;

  const STYLE_ID = 'proceduralCarryWalkStyles';
  const PANEL_ID = 'proceduralCarryWalkPanel';
  const BUTTON_ID = 'proceduralCarryQuickBtn';
  const MOVEMENT_BUTTON_ID = 'animationCarryBtn';
  const STORAGE_KEY = 'hobunji.proceduralCarryWalk.v1';
  const OBJECT_NAME = 'ProceduralCarryUprightObject';
  const ARM_ROOT_SUFFIX = '_carry_arms';
  const DOWN = Object.freeze({ x: 0, y: -1, z: 0 });
  const DEFAULTS = Object.freeze({
    weight: 0.86,
    awkwardness: 0.82,
    objectHeightFraction: 0.72,
    objectWidthFraction: 0.48,
    objectDepthFraction: 0.24,
    showGuides: true,
  });
  const CARRY_REGULAR_TUNING = Object.freeze({
    animationSpeed: 1.35,
    animationSprintMultiplier: 1.15,
    animationAcceleration: 4.2,
    animationTurnAcceleration: 3.1,
    animationDeceleration: 7.5,
    animationTurnResponse: 3.8,
    animationBob: 0.012,
    animationSway: 0.11,
    animationDrift: 0.02,
    animationIrregularity: 0.08,
    animationStumble: 0,
  });

  const state = {
    enabled: false,
    options: { ...DEFAULTS },
    THREE: null,
    model: null,
    bodyBase: null,
    hands: null,
    arms: null,
    object: null,
    previousWorld: null,
    previousTime: performance.now(),
    renderHookInstalled: false,
    renderer: null,
    priorRender: null,
    originalApplyMovementPreset: null,
    uiInstalled: false,
    debug: {},
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function editorLog(message, level = 'info', extra = null) {
    const log = window.HobunjiGameplayBackdrop?.log;
    if (log) { log(message, level, extra); return; }
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(message, extra ?? '');
  }

  function loadOptions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (parsed && typeof parsed === 'object') state.options = {
        ...DEFAULTS,
        weight: clamp(parsed.weight ?? DEFAULTS.weight, 0, 1),
        awkwardness: clamp(parsed.awkwardness ?? DEFAULTS.awkwardness, 0, 1),
        objectHeightFraction: clamp(parsed.objectHeightFraction ?? DEFAULTS.objectHeightFraction, 0.2, 1.5),
        objectWidthFraction: clamp(parsed.objectWidthFraction ?? DEFAULTS.objectWidthFraction, 0.15, 1.5),
        objectDepthFraction: clamp(parsed.objectDepthFraction ?? DEFAULTS.objectDepthFraction, 0.05, 1),
        showGuides: parsed.showGuides !== false,
      };
    } catch (_) {}
  }

  function saveOptions() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.options)); } catch (_) {}
  }

  function dimensions(model) {
    return {
      width: Math.max(0.05, Number(model?.userData?.portraitModelWidth) || 0.9),
      height: Math.max(0.05, Number(model?.userData?.portraitModelHeight) || 0.9),
    };
  }

  function anatomyProfile(model) {
    const selected = window.HobunjiGameplayBackdrop?.getSelectedNpc?.() || {};
    const appearance = selected.appearance || selected.profile?.appearance || {};
    const species = appearance.speciesId || appearance.species || model?.userData?.speciesId || 'mao-ao';
    const gender = appearance.gender || model?.userData?.gender || 'male';
    const resolved = window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES?.resolve?.(species, gender) || {};
    return { species, gender, ...resolved };
  }

  function nativeHand(model, side) {
    return model?.getObjectByName?.(`${model.name || 'Avatar'}_${side === 'left' ? 'Left' : 'Right'}Hand`) || null;
  }

  function captureHands(model) {
    const left = nativeHand(model, 'left');
    const right = nativeHand(model, 'right');
    if (!left || !right) return null;
    const capture = hand => ({
      mesh: hand,
      position: hand.position.clone(),
      quaternion: hand.quaternion.clone(),
      scale: hand.scale.clone(),
    });
    return { left: capture(left), right: capture(right) };
  }

  function restoreHands() {
    if (!state.hands) return;
    for (const side of ['left', 'right']) {
      const hand = state.hands[side];
      if (!hand?.mesh) continue;
      hand.mesh.position.copy(hand.position);
      hand.mesh.quaternion.copy(hand.quaternion);
      hand.mesh.scale.copy(hand.scale);
    }
  }

  function findRenderingThree(scene) {
    if (window.THREE?.Line && window.THREE?.BufferGeometry && window.THREE?.LineBasicMaterial) return window.THREE;
    const sampleLine = scene?.getObjectByName?.('LegBonesDebug')?.children?.find?.(node => node?.isLine);
    if (!sampleLine) return null;
    return {
      Line: sampleLine.constructor,
      BufferGeometry: sampleLine.geometry.constructor,
      LineBasicMaterial: sampleLine.material.constructor,
    };
  }

  function shoulderAndLengths(THREE, model, side, handCapture, anatomy) {
    const dims = dimensions(model);
    const handAttachX = Number(model.userData?.handAttachX);
    const handAttachY = Number(model.userData?.handAttachY);
    const idle = handCapture.position.clone();
    const fallbackX = side === 'left' ? dims.width * 0.28 : -dims.width * 0.28;
    const shoulder = new THREE.Vector3(
      (Number.isFinite(handAttachX) ? (side === 'left' ? -handAttachX : handAttachX) : fallbackX) * 0.62,
      (Number.isFinite(handAttachY) ? handAttachY : dims.height * 0.45) + dims.height * 0.10,
      0
    );
    const directReach = Math.max(dims.height * 0.20, shoulder.distanceTo(idle));
    const upperFraction = clamp(anatomy.upperArmFraction ?? 0.52, 0.35, 0.7);
    return {
      shoulder,
      upperLength: directReach * upperFraction,
      lowerLength: directReach * (1 - upperFraction),
      idle,
    };
  }

  function buildArmGuides(THREE, renderingTHREE, model) {
    if (!state.hands || !renderingTHREE) return null;
    const anatomy = anatomyProfile(model);
    const GroupCtor = model.constructor;
    const root = new GroupCtor();
    root.name = `${model.name || 'Avatar'}${ARM_ROOT_SUFFIX}`;
    model.add(root);
    const sides = {};
    for (const side of ['left', 'right']) {
      const chain = shoulderAndLengths(THREE, model, side, state.hands[side], anatomy);
      const line = new renderingTHREE.Line(
        new renderingTHREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
        new renderingTHREE.LineBasicMaterial({ color: side === 'left' ? 0xffb36b : 0xff6ba8, transparent: true, opacity: 0.86, depthTest: false })
      );
      line.name = `${side}CarryArmGuide`;
      line.renderOrder = 999;
      root.add(line);
      sides[side] = { ...chain, line };
    }
    return { root, anatomy, ...sides };
  }

  function makeObject(THREE, model) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.28, wireframe: true, depthTest: false, depthWrite: false })
    );
    mesh.name = OBJECT_NAME;
    mesh.renderOrder = 997;
    model.add(mesh);
    return mesh;
  }

  function restoreBody() {
    if (!state.model || !state.bodyBase) return;
    state.model.position.copy(state.bodyBase.position);
    state.model.quaternion.copy(state.bodyBase.quaternion);
    state.model.scale.copy(state.bodyBase.scale);
  }

  function releaseModel() {
    restoreBody();
    restoreHands();
    state.arms?.root?.removeFromParent?.();
    state.object?.removeFromParent?.();
    state.model = null;
    state.bodyBase = null;
    state.hands = null;
    state.arms = null;
    state.object = null;
    state.previousWorld = null;
  }

  function bindModel(THREE, model, scene) {
    if (state.model === model && state.bodyBase) {
      if (!state.hands) state.hands = captureHands(model);
      if (!state.arms && state.hands) state.arms = buildArmGuides(THREE, findRenderingThree(scene), model);
      if (!state.object) state.object = makeObject(THREE, model);
      return;
    }
    releaseModel();
    state.model = model;
    if (!model) return;
    state.bodyBase = { position: model.position.clone(), quaternion: model.quaternion.clone(), scale: model.scale.clone() };
    state.hands = captureHands(model);
    state.arms = state.hands ? buildArmGuides(THREE, findRenderingThree(scene), model) : null;
    state.object = makeObject(THREE, model);
    state.previousTime = performance.now();
    state.previousWorld = model.getWorldPosition(new THREE.Vector3());
  }

  function solveArm(THREE, side, targetLocal, poleLocal) {
    // The final Ground/Carry hand owner uses the real authored shoulder and real
    // procedural hand socket. Avoid solving this same arm a second time here.
    if (window.ProceduralGroundCarryHandBinding?.installed) return null;
    const arm = state.arms?.[side];
    const hand = state.hands?.[side]?.mesh;
    if (!arm || !hand || !window.LegBones?.solveFixedTwoBoneChain) return null;
    const solved = window.LegBones.solveFixedTwoBoneChain(THREE, {
      root: arm.shoulder,
      target: targetLocal,
      upperLength: arm.upperLength,
      lowerLength: arm.lowerLength,
      pole: poleLocal,
    });
    const positions = arm.line.geometry.attributes.position;
    positions.setXYZ(0, arm.shoulder.x, arm.shoulder.y, arm.shoulder.z);
    positions.setXYZ(1, solved.joint.x, solved.joint.y, solved.joint.z);
    positions.setXYZ(2, solved.solvedTarget.x, solved.solvedTarget.y, solved.solvedTarget.z);
    positions.needsUpdate = true;
    arm.line.visible = state.options.showGuides;
    hand.position.copy(solved.solvedTarget);
    const forearm = solved.solvedTarget.clone().sub(solved.joint);
    if (forearm.lengthSq() > 1e-10) hand.quaternion.setFromUnitVectors(new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z), forearm.normalize());
    return solved;
  }

  function renderCarryFrame(now) {
    const backdrop = window.HobunjiGameplayBackdrop;
    const model = backdrop?.getAvatarModel?.() || null;
    const scene = backdrop?.getScene?.() || null;
    const THREE = state.THREE;
    if (!state.enabled || !model || !THREE) {
      if (!state.enabled && state.model) releaseModel();
      return;
    }
    bindModel(THREE, model, scene);
    restoreBody();
    if (!state.hands) state.hands = captureHands(model);
    if (!state.arms && state.hands) state.arms = buildArmGuides(THREE, findRenderingThree(scene), model);
    if (!state.hands || !state.arms || !state.object) return;

    const dims = dimensions(model);
    const dt = Math.max(0.001, Math.min(0.05, (now - state.previousTime) / 1000));
    const world = model.getWorldPosition(new THREE.Vector3());
    const speed = state.previousWorld ? world.distanceTo(state.previousWorld) / dt : 0;
    state.previousWorld = world.clone();
    state.previousTime = now;
    const motion = clamp(speed / Math.max(0.1, 1.35), 0, 1.5);
    const weight = state.options.weight;
    const awkward = state.options.awkwardness;
    const swayPhase = now * 0.001 * (2.3 + motion * 1.8);
    const sway = Math.sin(swayPhase) * awkward * (0.018 + motion * 0.028);
    const lag = Math.sin(swayPhase * 0.63 + 0.8) * weight * motion * dims.height * 0.025;

    const bodyDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (4 + weight * 6 + motion * awkward * 3) * Math.PI / 180,
      0,
      sway * 0.6,
      'YXZ'
    ));
    model.quaternion.copy(state.bodyBase.quaternion).multiply(bodyDelta);

    const objectH = dims.height * state.options.objectHeightFraction;
    const objectW = dims.width * state.options.objectWidthFraction;
    const objectD = dims.width * state.options.objectDepthFraction;
    const center = new THREE.Vector3(0, dims.height * 0.43 + objectH * 0.12, dims.height * 0.22 + lag);
    state.object.position.copy(center);
    state.object.scale.set(objectW, objectH, objectD);
    state.object.rotation.set(-(4 + weight * 6) * Math.PI / 180, sway * 0.28, -sway);
    state.object.visible = true;

    const leftTarget = center.clone().add(new THREE.Vector3(-objectW * 0.48, objectH * 0.17, -objectD * 0.52));
    const rightTarget = center.clone().add(new THREE.Vector3(objectW * 0.43, -objectH * 0.14, -objectD * 0.50));
    const leftPole = state.arms.left.shoulder.clone().add(new THREE.Vector3(-dims.width * 0.24, -dims.height * 0.03, -dims.height * 0.10));
    const rightPole = state.arms.right.shoulder.clone().add(new THREE.Vector3(dims.width * 0.24, -dims.height * 0.02, -dims.height * 0.08));
    const leftSolve = solveArm(THREE, 'left', leftTarget, leftPole);
    const rightSolve = solveArm(THREE, 'right', rightTarget, rightPole);
    model.updateMatrixWorld(true);

    const finalOwner = window.ProceduralGroundCarryHandBinding?.getDebug?.() || null;
    state.debug = {
      active: true,
      baseLocomotion: 'regular',
      movementEngine: 'existing-procedural-animator',
      nativeFeetUntouched: true,
      nativeHands: { left: !!state.hands.left?.mesh, right: !!state.hands.right?.mesh },
      species: state.arms.anatomy?.species,
      gender: state.arms.anatomy?.gender,
      speed,
      object: { width: objectW, height: objectH, depth: objectD, lag },
      armReach: finalOwner?.left && finalOwner?.right
        ? { owner: 'authored-shoulder-final-socket', leftSource: finalOwner.left.source, rightSource: finalOwner.right.source }
        : {
            left: leftSolve ? { reachable: leftSolve.reachable, distance: leftSolve.solvedDistance } : null,
            right: rightSolve ? { reachable: rightSolve.reachable, distance: rightSolve.solvedDistance } : null,
          },
    };
    updateDebugReadout();
  }

  function applyExistingRegularPreset() {
    const api = window.HobunjiGameplayBackdrop;
    if (state.originalApplyMovementPreset) state.originalApplyMovementPreset('regular');
    else if (typeof api?.applyMovementPreset === 'function') api.applyMovementPreset('regular');
    else document.getElementById('animationRegularBtn')?.click?.();
  }

  function applyCarryTuning() {
    for (const [id, value] of Object.entries(CARRY_REGULAR_TUNING)) {
      const control = document.getElementById(id);
      if (!control) continue;
      control.value = String(value);
      control.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function syncPresetUi() {
    const carryButton = document.getElementById(MOVEMENT_BUTTON_ID);
    if (carryButton) carryButton.classList.toggle('active', state.enabled);
    const select = document.getElementById('animationPresetSelect');
    if (select && state.enabled) select.value = 'carry';
    const badge = document.getElementById('animationPresetBadge');
    if (badge && state.enabled) badge.textContent = 'Heavy upright carry';
  }

  function setEnabled(value, options = {}) {
    const next = Boolean(value);
    if (next === state.enabled && !options.force) return state.enabled;
    state.enabled = next;
    if (next) {
      window.ProceduralDanceMode?.setEnabled?.(false);
      window.HobunjiProceduralLimbPoseAuthor?.resetPose?.({ preservePlayback: true });
      if (!options.skipPreset) applyExistingRegularPreset();
      applyCarryTuning();
      window.HobunjiGameplayBackdrop?.setMovementPlayback?.(true);
      window.ProceduralGroundCarryHandBinding?.ensureActiveBinding?.();
      editorLog('[Carry walk] Enabled on top of the existing Regular locomotion preset.', 'info');
    } else {
      releaseModel();
      editorLog('[Carry walk] Disabled; native hand/body transforms restored.', 'info');
    }
    syncPresetUi();
    updatePanel();
    return state.enabled;
  }

  function installPresetBridge() {
    const api = window.HobunjiGameplayBackdrop;
    if (!api || api.__carryMovementPresetBridge) return false;
    if (typeof api.applyMovementPreset === 'function') {
      state.originalApplyMovementPreset = api.applyMovementPreset.bind(api);
      api.applyMovementPreset = function carryAwareMovementPreset(name) {
        if (name === 'carry') {
          state.originalApplyMovementPreset('regular');
          setEnabled(true, { skipPreset: true, force: true });
          return;
        }
        if (state.enabled) setEnabled(false, { force: true });
        return state.originalApplyMovementPreset(name);
      };
    }
    api.__carryMovementPresetBridge = true;
    return true;
  }

  function installMovementUi() {
    if (document.getElementById(MOVEMENT_BUTTON_ID)) return true;
    const regular = document.getElementById('animationRegularBtn');
    const drunk = document.getElementById('animationDrunkenBtn');
    const select = document.getElementById('animationPresetSelect');
    if (!regular && !drunk && !select) return false;
    if (select && !select.querySelector('option[value="carry"]')) {
      const option = document.createElement('option');
      option.value = 'carry';
      option.textContent = 'Carry upright';
      select.appendChild(option);
      select.addEventListener('change', event => {
        if (event.target.value === 'carry') setEnabled(true);
        else if (state.enabled) setEnabled(false);
      });
    }
    const button = document.createElement('button');
    button.id = MOVEMENT_BUTTON_ID;
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Carry';
    button.title = 'Use Regular walk locomotion while keeping a heavy awkward object upright with both arms';
    button.addEventListener('click', () => setEnabled(!state.enabled));
    const anchor = drunk || regular;
    anchor?.parentElement?.insertBefore(button, anchor.nextSibling);
    regular?.addEventListener('click', () => { if (state.enabled) setEnabled(false); });
    drunk?.addEventListener('click', () => { if (state.enabled) setEnabled(false); });
    return true;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${PANEL_ID}{position:absolute;z-index:35;right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:min(430px,calc(100vw - 16px));max-height:min(70dvh,650px);overflow:auto;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(7,16,26,.97);padding:10px;box-shadow:0 18px 52px rgba(0,0,0,.55)}
#${PANEL_ID}[hidden]{display:none!important}#${PANEL_ID} .carryGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}#${PANEL_ID} .carryRow{display:flex;gap:7px;align-items:center;margin-bottom:8px}#${PANEL_ID} pre{max-height:180px;overflow:auto;font-size:10px}
@media(max-width:700px){#${PANEL_ID}{left:max(4px,env(safe-area-inset-left));right:max(4px,env(safe-area-inset-right));bottom:max(4px,env(safe-area-inset-bottom));width:auto;max-height:48dvh}.carryGrid{grid-template-columns:1fr!important}}
`;
    document.head.appendChild(style);
  }

  function installPanel() {
    if (document.getElementById(PANEL_ID)) return true;
    const root = document.getElementById('gameModalOverlayRoot') || document.body;
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.hidden = true;
    panel.innerHTML = `<div class="carryRow"><b>Carry walk</b><span style="margin-left:auto" class="pill">Regular locomotion + constrained upper body</span><button id="carryClose" class="secondary">×</button></div>
<div class="carryGrid">
<label>Weight <input id="carryWeight" type="range" min="0" max="1" step="0.01"></label>
<label>Awkwardness <input id="carryAwkward" type="range" min="0" max="1" step="0.01"></label>
<label>Object height <input id="carryHeight" type="range" min="0.2" max="1.5" step="0.01"></label>
<label>Object width <input id="carryWidth" type="range" min="0.15" max="1.5" step="0.01"></label>
<label>Object depth <input id="carryDepth" type="range" min="0.05" max="1" step="0.01"></label>
<label><input id="carryGuides" type="checkbox"> Show arm guides</label></div>
<div class="carryRow"><button id="carryEnable" class="good">Enable Carry</button><button id="carryReset" class="secondary">Reset tuning</button></div>
<pre id="carryDebug">Carry inactive.</pre>`;
    root.appendChild(panel);
    document.getElementById('carryClose').onclick = () => { panel.hidden = true; };
    document.getElementById('carryEnable').onclick = () => setEnabled(!state.enabled);
    document.getElementById('carryReset').onclick = () => { state.options = { ...DEFAULTS }; saveOptions(); updatePanel(); };
    const fields = {
      carryWeight: ['weight', Number], carryAwkward: ['awkwardness', Number],
      carryHeight: ['objectHeightFraction', Number], carryWidth: ['objectWidthFraction', Number],
      carryDepth: ['objectDepthFraction', Number], carryGuides: ['showGuides', el => el.checked],
    };
    for (const [id, [key, reader]] of Object.entries(fields)) {
      const el = document.getElementById(id);
      el.addEventListener('input', () => { state.options[key] = reader === Number ? Number(el.value) : reader(el); saveOptions(); updatePanel(); });
    }
    return true;
  }

  function updateDebugReadout() {
    const pre = document.getElementById('carryDebug');
    if (pre) pre.textContent = JSON.stringify(state.debug, null, 2);
  }

  function updatePanel() {
    const setValue = (id, value) => { const el = document.getElementById(id); if (el) el.value = String(value); };
    setValue('carryWeight', state.options.weight);
    setValue('carryAwkward', state.options.awkwardness);
    setValue('carryHeight', state.options.objectHeightFraction);
    setValue('carryWidth', state.options.objectWidthFraction);
    setValue('carryDepth', state.options.objectDepthFraction);
    const guides = document.getElementById('carryGuides'); if (guides) guides.checked = state.options.showGuides;
    const enable = document.getElementById('carryEnable'); if (enable) enable.textContent = state.enabled ? 'Disable Carry' : 'Enable Carry';
    syncPresetUi();
  }

  function openPanel() {
    installPanel();
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.hidden = false;
    updatePanel();
  }

  function installQuickButton() {
    if (document.getElementById(BUTTON_ID)) return true;
    const actions = document.querySelector('#animationHud .animationHudActions');
    if (!actions) return false;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Carry';
    button.addEventListener('click', openPanel);
    actions.appendChild(button);
    return true;
  }

  function installRenderHook() {
    if (state.renderHookInstalled) return true;
    const renderer = window.HobunjiGameplayBackdrop?.getRenderer?.();
    if (!renderer?.render) return false;
    state.renderer = renderer;
    state.priorRender = renderer.render.bind(renderer);
    renderer.render = function proceduralCarryRender(scene, camera) {
      renderCarryFrame(performance.now());
      return state.priorRender(scene, camera);
    };
    state.renderHookInstalled = true;
    editorLog('[Carry walk] Final-frame hook installed; Regular locomotion remains authoritative.', 'info');
    return true;
  }

  async function bootstrap() {
    loadOptions();
    injectStyles();
    try {
      const modules = await window.PNGPlaneAvatar?.loadThreeModules?.();
      state.THREE = modules?.THREE || window.THREE || null;
    } catch (error) {
      editorLog(`[Carry walk] Could not load Three.js module: ${error.message}`, 'error');
    }
    let attempts = 0;
    function frame() {
      installPresetBridge();
      const movementUiReady = installMovementUi(); // Tracks the movement-preset button/dropdown integration used by uiInstalled.
      const panelReady = installPanel(); // Tracks the tuning panel integration used by uiInstalled.
      const quickButtonReady = installQuickButton(); // Tracks the HUD shortcut integration used by uiInstalled.
      state.uiInstalled = Boolean(movementUiReady && panelReady && quickButtonReady);
      installRenderHook();
      if ((!state.renderHookInstalled || !state.uiInstalled) && attempts++ < 600) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.ProceduralCarryWalkMode = {
    installed: true,
    mode: 'regular-locomotion-upper-body-overlay',
    setEnabled,
    applyPreset: () => setEnabled(true),
    openPanel,
    getDebug: () => ({ ...state.debug, enabled: state.enabled, options: { ...state.options }, uiInstalled: state.uiInstalled }),
  };

  bootstrap();
})();
