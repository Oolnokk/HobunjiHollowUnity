// Procedural Animation Editor: modern-main Ground / Rest limb authoring.
// Uses the editor's existing PNG avatar, native hand sockets and native
// ProceduralLegAnimation hierarchy. Carry remains a separate locomotion mode.
(function () {
  'use strict';

  if (window.HobunjiProceduralLimbPoseAuthor?.version >= 5) return;

  const PANEL_ID = 'proceduralGroundRestPanel';
  const BUTTON_ID = 'proceduralGroundRestQuickBtn';
  const STYLE_ID = 'proceduralGroundRestStyles';
  const GUIDE_SUFFIX = '_ground_rest_guides';
  const POSES = Object.freeze({
    normal: 'Normal / movement',
    manual: 'Manual IK',
    crossLegged: 'Cross-legged',
    kneel: 'Kneeling',
    sideLeanLeft: 'Side lean · left',
    sideLeanRight: 'Side lean · right',
    lieSideLeft: 'Lie on side · left',
    lieSideRight: 'Lie on side · right',
    lieBack: 'Lie on back',
  });

  const state = {
    THREE: null,
    pose: 'normal',
    model: null,
    bodyBase: null,
    feetRig: null,
    hands: null,
    arms: null,
    guideRoot: null,
    manual: null,
    renderHookInstalled: false,
    priorRender: null,
    debug: {},
  };

  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }

  function log(message, level = 'info', extra = null) {
    const logger = window.HobunjiGameplayBackdrop?.log;
    if (logger) { logger(message, level, extra); return; }
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(message, extra ?? '');
  }

  function dimensions(model) {
    const width = Math.max(0.05, Number(model?.userData?.portraitModelWidth) || 0.9);
    const height = Math.max(0.05, Number(model?.userData?.portraitModelHeight) || width);
    return { width, height };
  }

  function selectedIdentity(model) {
    const live = window.HobunjiProceduralArmAnchors?.identityFor?.(model);
    if (live) return { species: live.speciesId, gender: live.gender };
    const npc = window.HobunjiGameplayBackdrop?.getSelectedNpc?.() || {};
    const source = npc.appearance || npc.profile?.appearance || {};
    return {
      species: source.speciesId || source.species || model?.userData?.speciesId || 'mao-ao',
      gender: source.gender || model?.userData?.gender || 'male',
    };
  }

  function anatomy(model) {
    const identity = selectedIdentity(model);
    return {
      ...identity,
      ...(window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES?.resolve?.(identity.species, identity.gender) || {}),
    };
  }

  function findFeetRoot(model) {
    let root = null;
    model?.traverse?.(node => {
      if (!root && /_procedural_feet$/.test(String(node.name || ''))) root = node;
    });
    return root;
  }

  function captureFeet(model) {
    const root = findFeetRoot(model);
    if (!root) return null;
    const sides = {};
    for (const side of ['left', 'right']) {
      const hip = root.getObjectByName?.(`${side}_hip`);
      const thigh = root.getObjectByName?.(`${side}_thigh`);
      const calf = root.getObjectByName?.(`${side}_calf`);
      const foot = root.getObjectByName?.(`${side}_foot`);
      if (!hip || !thigh || !calf || !foot) return null;
      sides[side] = {
        hip, thigh, calf, foot,
        upperLength: Math.max(0.001, Math.abs(Number(calf.position.y)) || hip.position.distanceTo(calf.position)),
        lowerLength: Math.max(0.001, Math.abs(Number(foot.position.y)) || calf.position.distanceTo(foot.position)),
        base: {
          thighQ: thigh.quaternion.clone(),
          calfQ: calf.quaternion.clone(),
          calfP: calf.position.clone(),
          footP: foot.position.clone(),
          footQ: foot.quaternion.clone(),
        },
      };
    }
    return { root, ...sides };
  }

  function captureHands(THREE, model) {
    const bridge = window.HobunjiProceduralArmAnchors;
    const left = bridge?.captureHand?.(THREE, model, 'left');
    const right = bridge?.captureHand?.(THREE, model, 'right');
    return left && right ? { left, right } : null;
  }

  function armData(THREE, model, side, hand, profile) {
    const dims = dimensions(model);
    const bridge = window.HobunjiProceduralArmAnchors;
    const resolved = bridge?.resolveShoulderInModel?.(THREE, model, side);
    const shoulder = resolved?.position || new THREE.Vector3(side === 'left' ? -dims.width * 0.22 : dims.width * 0.22, dims.height * 0.45, 0);
    const idle = hand.modelPosition?.clone?.() || bridge?.nodePositionInModel?.(THREE, model, hand.node) || new THREE.Vector3();
    const referenceReach = Math.max(dims.height * 0.20, shoulder.distanceTo(idle));
    const fraction = clamp(profile.upperArmFraction ?? 0.52, 0.35, 0.70);
    return {
      shoulder,
      shoulderSource: resolved?.source || 'fallback',
      idle,
      upperLength: referenceReach * fraction,
      lowerLength: referenceReach * (1 - fraction),
      referenceReach,
      referenceHeight: dims.height,
    };
  }

  function renderingThree(scene) {
    if (window.THREE?.Line && window.THREE?.BufferGeometry && window.THREE?.LineBasicMaterial) return window.THREE;
    const line = scene?.getObjectByName?.('LegBonesDebug')?.children?.find?.(node => node?.isLine);
    if (!line) return null;
    return { Line: line.constructor, BufferGeometry: line.geometry.constructor, LineBasicMaterial: line.material.constructor };
  }

  function buildArmGuides(THREE, model, scene, profile) {
    if (!state.hands) return null;
    const RT = renderingThree(scene);
    if (!RT) return null;
    const root = new model.constructor();
    root.name = `${model.name || 'Avatar'}${GUIDE_SUFFIX}`;
    model.add(root);
    const out = { root };
    for (const side of ['left', 'right']) {
      const data = armData(THREE, model, side, state.hands[side], profile);
      const line = new RT.Line(
        new RT.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
        new RT.LineBasicMaterial({ color: side === 'left' ? 0x6ba9ff : 0xc89bff, transparent: true, opacity: 0.9, depthTest: false })
      );
      line.renderOrder = 999;
      line.name = `${side}GroundRestArmGuide`;
      root.add(line);
      out[side] = { ...data, line };
    }
    return out;
  }

  // Shoulder roots are data, not cached scene nodes. Resolve them every frame
  // through the modern portrait-anchor space so body scaling, Y offsets and
  // species/gender/profile changes immediately propagate into the arm solver.
  function refreshArmAnchors(THREE, model) {
    if (!state.arms) return;
    const bridge = window.HobunjiProceduralArmAnchors;
    const profile = anatomy(model);
    const dims = dimensions(model);
    for (const side of ['left', 'right']) {
      const arm = state.arms[side];
      if (!arm) continue;
      const resolved = bridge?.resolveShoulderInModel?.(THREE, model, side);
      if (resolved?.position) {
        arm.shoulder.copy(resolved.position);
        arm.shoulderSource = resolved.source;
      }
      const scale = dims.height / Math.max(0.001, arm.referenceHeight || dims.height);
      const reach = Math.max(dims.height * 0.20, (arm.referenceReach || dims.height * 0.45) * scale);
      const fraction = clamp(profile.upperArmFraction ?? 0.52, 0.35, 0.70);
      arm.upperLength = reach * fraction;
      arm.lowerLength = reach * (1 - fraction);
    }
  }

  function restoreBody() {
    if (!state.model || !state.bodyBase) return;
    state.model.position.copy(state.bodyBase.position);
    state.model.quaternion.copy(state.bodyBase.quaternion);
    state.model.scale.copy(state.bodyBase.scale);
  }

  function restoreHands() {
    const bridge = window.HobunjiProceduralArmAnchors;
    if (!state.hands || !bridge?.restoreHand) return;
    bridge.restoreHand(state.hands.left);
    bridge.restoreHand(state.hands.right);
  }

  function restoreFeet() {
    if (!state.feetRig) return;
    for (const side of ['left', 'right']) {
      const leg = state.feetRig[side];
      leg.thigh.quaternion.copy(leg.base.thighQ);
      leg.calf.position.copy(leg.base.calfP);
      leg.calf.quaternion.copy(leg.base.calfQ);
      leg.foot.position.copy(leg.base.footP);
      leg.foot.quaternion.copy(leg.base.footQ);
    }
  }

  function releaseModel() {
    state.manual?.setActive?.(false);
    restoreBody(); restoreHands(); restoreFeet();
    state.guideRoot?.removeFromParent?.();
    state.model = null; state.bodyBase = null; state.feetRig = null; state.hands = null; state.arms = null; state.guideRoot = null;
  }

  function bindModel(THREE, model, scene) {
    if (state.model === model && state.bodyBase) {
      if (!state.feetRig) state.feetRig = captureFeet(model);
      if (!state.hands) state.hands = captureHands(THREE, model);
      if (!state.arms && state.hands) {
        state.arms = buildArmGuides(THREE, model, scene, anatomy(model));
        state.guideRoot = state.arms?.root || null;
      }
      return;
    }
    releaseModel();
    state.model = model;
    if (!model) return;
    state.bodyBase = { position: model.position.clone(), quaternion: model.quaternion.clone(), scale: model.scale.clone() };
    state.feetRig = captureFeet(model);
    state.hands = captureHands(THREE, model);
    state.arms = state.hands ? buildArmGuides(THREE, model, scene, anatomy(model)) : null;
    state.guideRoot = state.arms?.root || null;
  }

  function poseBody(THREE, pose, model) {
    const dims = dimensions(model);
    const profile = anatomy(model);
    const torsoRadius = dims.height * Number(profile.torsoRadiusHeightFraction || 0.155);
    const map = {
      crossLegged: { p: [0, -dims.height * 0.26, 0.02], r: [0, 0, 0] },
      kneel: { p: [0, -dims.height * 0.18, -dims.height * 0.03], r: [-6, 0, 0] },
      sideLeanLeft: { p: [-torsoRadius * 0.45, -dims.height * 0.23, 0], r: [0, 0, 24] },
      sideLeanRight: { p: [torsoRadius * 0.45, -dims.height * 0.23, 0], r: [0, 0, -24] },
      lieSideLeft: { p: [-torsoRadius * 0.15, -dims.height * 0.36, 0], r: [0, 0, 82] },
      lieSideRight: { p: [torsoRadius * 0.15, -dims.height * 0.36, 0], r: [0, 0, -82] },
      lieBack: { p: [0, -dims.height * 0.37, -dims.height * 0.05], r: [-82, 0, 0] },
    };
    const entry = map[pose];
    if (!entry) return;
    const offset = new THREE.Vector3(...entry.p).applyQuaternion(state.bodyBase.quaternion);
    model.position.copy(state.bodyBase.position).add(offset);
    model.quaternion.copy(state.bodyBase.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
      entry.r[0] * Math.PI / 180, entry.r[1] * Math.PI / 180, entry.r[2] * Math.PI / 180, 'YXZ'
    )));
    model.updateMatrixWorld(true);
  }

  function targetLayout(THREE, pose, model) {
    const h = dimensions(model).height;
    const floor = state.feetRig?.left?.foot?.position?.y || 0;
    const sign = pose.endsWith('Right') ? 1 : -1;
    if (pose === 'crossLegged') return {
      left: { foot: new THREE.Vector3(h * 0.13, floor, h * 0.09), pole: new THREE.Vector3(-h * 0.38, h * 0.08, h * 0.15) },
      right: { foot: new THREE.Vector3(-h * 0.13, floor, h * 0.06), pole: new THREE.Vector3(h * 0.38, h * 0.08, h * 0.15) },
    };
    if (pose === 'kneel') return {
      left: { foot: new THREE.Vector3(-h * 0.09, floor, -h * 0.24), pole: new THREE.Vector3(-h * 0.12, h * 0.08, h * 0.23) },
      right: { foot: new THREE.Vector3(h * 0.09, floor, -h * 0.24), pole: new THREE.Vector3(h * 0.12, h * 0.08, h * 0.23) },
    };
    if (pose.startsWith('sideLean')) return {
      left: { foot: new THREE.Vector3(-sign * h * 0.06, floor, h * 0.22), pole: new THREE.Vector3(-h * 0.30, h * 0.10, h * 0.16) },
      right: { foot: new THREE.Vector3(sign * h * 0.18, floor, h * 0.12), pole: new THREE.Vector3(h * 0.30, h * 0.10, h * 0.16) },
    };
    if (pose.startsWith('lieSide')) return {
      left: { foot: new THREE.Vector3(-h * 0.05, floor, h * 0.29), pole: new THREE.Vector3(-h * 0.16, h * 0.10, h * 0.14) },
      right: { foot: new THREE.Vector3(h * 0.05, floor, h * 0.11), pole: new THREE.Vector3(h * 0.16, h * 0.10, h * 0.14) },
    };
    if (pose === 'lieBack') return {
      left: { foot: new THREE.Vector3(-h * 0.10, floor, h * 0.34), pole: new THREE.Vector3(-h * 0.13, h * 0.20, h * 0.17) },
      right: { foot: new THREE.Vector3(h * 0.10, floor, h * 0.34), pole: new THREE.Vector3(h * 0.13, h * 0.20, h * 0.17) },
    };
    return null;
  }

  function solveLeg(THREE, side, layout) {
    const rig = state.feetRig;
    const leg = rig?.[side];
    if (!leg || !layout || !window.LegBones?.solveFixedTwoBoneChain) return null;
    const solved = window.LegBones.solveFixedTwoBoneChain(THREE, {
      root: leg.hip.position,
      target: layout.foot,
      upperLength: leg.upperLength,
      lowerLength: leg.lowerLength,
      pole: layout.pole,
    });
    leg.thigh.quaternion.copy(solved.upperQuaternion);
    leg.calf.position.set(0, -solved.upperLength, 0);
    leg.calf.quaternion.copy(solved.lowerLocalQuaternion);
    leg.foot.position.set(0, -solved.lowerLength, 0);
    return solved;
  }

  function handTargets(THREE, pose, model, legs) {
    const h = dimensions(model).height;
    const profile = anatomy(model);
    const torso = h * Number(profile.torsoRadiusHeightFraction || 0.155);
    if (pose === 'crossLegged' || pose === 'kneel') return {
      left: legs.left?.joint?.clone?.().add(new THREE.Vector3(0, h * 0.06, 0)) || state.arms.left.idle.clone(),
      right: legs.right?.joint?.clone?.().add(new THREE.Vector3(0, h * 0.06, 0)) || state.arms.right.idle.clone(),
    };
    if (pose.startsWith('sideLean')) {
      const onLeft = pose.endsWith('Left');
      return onLeft
        ? { left: new THREE.Vector3(-h * 0.30, -h * 0.16, h * 0.02), right: new THREE.Vector3(torso * 0.25, -h * 0.05, h * 0.08) }
        : { left: new THREE.Vector3(-torso * 0.25, -h * 0.05, h * 0.08), right: new THREE.Vector3(h * 0.30, -h * 0.16, h * 0.02) };
    }
    if (pose.startsWith('lieSide')) {
      const onLeft = pose.endsWith('Left');
      return onLeft
        ? { left: new THREE.Vector3(-h * 0.20, -h * 0.10, -h * 0.02), right: new THREE.Vector3(h * 0.05, -h * 0.12, h * 0.15) }
        : { left: new THREE.Vector3(-h * 0.05, -h * 0.12, h * 0.15), right: new THREE.Vector3(h * 0.20, -h * 0.10, -h * 0.02) };
    }
    if (pose === 'lieBack') return {
      left: new THREE.Vector3(-h * 0.20, -h * 0.20, h * 0.02),
      right: new THREE.Vector3(h * 0.20, -h * 0.20, h * 0.02),
    };
    return null;
  }

  function solveArm(THREE, side, target) {
    const arm = state.arms?.[side];
    if (!arm || !target || !window.LegBones?.solveFixedTwoBoneChain) return null;
    const dims = dimensions(state.model);
    const pole = arm.shoulder.clone().add(new THREE.Vector3(side === 'left' ? -dims.width * 0.25 : dims.width * 0.25, 0, -dims.height * 0.08));
    const solved = window.LegBones.solveFixedTwoBoneChain(THREE, {
      root: arm.shoulder,
      target,
      upperLength: arm.upperLength,
      lowerLength: arm.lowerLength,
      pole,
    });
    const a = arm.line.geometry.attributes.position;
    a.setXYZ(0, arm.shoulder.x, arm.shoulder.y, arm.shoulder.z);
    a.setXYZ(1, solved.joint.x, solved.joint.y, solved.joint.z);
    a.setXYZ(2, solved.solvedTarget.x, solved.solvedTarget.y, solved.solvedTarget.z);
    a.needsUpdate = true;
    window.HobunjiProceduralArmAnchors?.applyHandTarget?.(THREE, state.model, side, solved.solvedTarget, solved.joint);
    return solved;
  }

  function renderGroundFrame() {
    const model = window.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
    const scene = window.HobunjiGameplayBackdrop?.getScene?.() || null;
    const THREE = state.THREE;
    if (!model || !THREE || state.pose === 'normal') {
      if (state.pose === 'normal' && state.model) releaseModel();
      return;
    }
    bindModel(THREE, model, scene);
    refreshArmAnchors(THREE, model);
    if (state.pose === 'manual') {
      state.manual?.update?.();
      updateDebug();
      return;
    }
    restoreBody(); restoreHands(); restoreFeet();
    poseBody(THREE, state.pose, model);
    // Body pose changes the model's world transform but the shoulder coordinates
    // remain model-local. Resolve again after pose application so parent/model
    // conversions use the final transform for this frame.
    refreshArmAnchors(THREE, model);
    const layout = targetLayout(THREE, state.pose, model);
    const legs = { left: solveLeg(THREE, 'left', layout?.left), right: solveLeg(THREE, 'right', layout?.right) };
    const hands = handTargets(THREE, state.pose, model, legs);
    const arms = hands ? { left: solveArm(THREE, 'left', hands.left), right: solveArm(THREE, 'right', hands.right) } : {};
    model.updateMatrixWorld(true);
    state.debug = {
      pose: state.pose,
      nativeHands: { left: !!state.hands?.left?.node, right: !!state.hands?.right?.node },
      nativeProceduralFeet: !!state.feetRig,
      identity: selectedIdentity(model),
      shoulderUpdate: 'live-every-frame',
      shoulders: {
        left: state.arms?.left ? { source: state.arms.left.shoulderSource, x: state.arms.left.shoulder.x, y: state.arms.left.shoulder.y, z: state.arms.left.shoulder.z } : null,
        right: state.arms?.right ? { source: state.arms.right.shoulderSource, x: state.arms.right.shoulder.x, y: state.arms.right.shoulder.y, z: state.arms.right.shoulder.z } : null,
      },
      legs: { left: legs.left?.reachable ?? null, right: legs.right?.reachable ?? null },
      arms: { left: arms.left?.reachable ?? null, right: arms.right?.reachable ?? null },
      carryOwnedExternally: true,
    };
    updateDebug();
  }

  async function ensureManual() {
    if (state.manual || !window.ProceduralLimbManualAuthor?.create || !state.model || !state.THREE) return state.manual;
    const THREE = state.THREE;
    state.manual = await window.ProceduralLimbManualAuthor.create({
      THREE,
      getScene: () => window.HobunjiGameplayBackdrop?.getScene?.(),
      getCamera: () => window.HobunjiGameplayBackdrop?.getCamera?.(),
      getRenderer: () => window.HobunjiGameplayBackdrop?.getRenderer?.(),
      getLocomotionRoot: () => state.model,
      getOrbitControls: () => null,
      getCurrentAnchors: () => {
        refreshArmAnchors(THREE, state.model);
        const shoulders = {
          left: state.arms?.left?.shoulder?.clone(),
          right: state.arms?.right?.shoulder?.clone(),
        };
        const hips = {};
        for (const side of ['left', 'right']) {
          const p = state.feetRig?.[side]?.hip?.getWorldPosition?.(new THREE.Vector3()) || new THREE.Vector3();
          state.model.worldToLocal(p); hips[side] = p;
        }
        return { shoulders, hips };
      },
      getLiveFoot: side => {
        const p = state.feetRig?.[side]?.foot?.getWorldPosition?.(new THREE.Vector3()) || null;
        if (p) state.model.worldToLocal(p);
        return p;
      },
      solveManualArm: (side, shoulder, hand, elbow) => {
        refreshArmAnchors(THREE, state.model);
        return window.LegBones.solveFixedTwoBoneChain(THREE, {
          root: shoulder,
          target: hand,
          upperLength: state.arms[side].upperLength,
          lowerLength: state.arms[side].lowerLength,
          pole: elbow,
        });
      },
      solveManualLeg: (side, hip, foot, knee) => {
        const root = state.feetRig.root;
        const hipRoot = root.worldToLocal(state.model.localToWorld(hip.clone()));
        const footRoot = root.worldToLocal(state.model.localToWorld(foot.clone()));
        const kneeRoot = root.worldToLocal(state.model.localToWorld(knee.clone()));
        return window.LegBones.solveFixedTwoBoneChain(THREE, {
          root: hipRoot,
          target: footRoot,
          upperLength: state.feetRig[side].upperLength,
          lowerLength: state.feetRig[side].lowerLength,
          pole: kneeRoot,
        });
      },
      applyManualArm: (side, shoulder, solved) => {
        if (!solved) return;
        solveArm(THREE, side, solved.solvedTarget);
      },
      applyManualLeg: (side, hip, solved) => {
        const leg = state.feetRig?.[side];
        if (!leg || !solved) return;
        leg.thigh.quaternion.copy(solved.upperQuaternion);
        leg.calf.position.set(0, -solved.upperLength, 0);
        leg.calf.quaternion.copy(solved.lowerLocalQuaternion);
        leg.foot.position.set(0, -solved.lowerLength, 0);
      },
      drawManualSide: () => {},
    });
    return state.manual;
  }

  async function setPose(pose, options = {}) {
    const next = POSES[pose] ? pose : 'normal';
    if (next !== 'normal') window.ProceduralCarryWalkMode?.setEnabled?.(false);
    state.pose = next;
    if (next === 'normal') {
      state.manual?.setActive?.(false);
      releaseModel();
      if (!options.preservePlayback) window.HobunjiGameplayBackdrop?.setMovementPlayback?.(true);
    } else {
      window.ProceduralDanceMode?.setEnabled?.(false);
      window.HobunjiGameplayBackdrop?.setMovementPlayback?.(false);
      const model = window.HobunjiGameplayBackdrop?.getAvatarModel?.();
      if (model && state.THREE) {
        bindModel(state.THREE, model, window.HobunjiGameplayBackdrop?.getScene?.());
        refreshArmAnchors(state.THREE, model);
      }
      if (next === 'manual') {
        await ensureManual();
        state.manual?.setActive?.(true);
      } else state.manual?.setActive?.(false);
    }
    syncUi();
    return state.pose;
  }

  function resetPose(options = {}) { return setPose('normal', options); }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `#${PANEL_ID}{position:absolute;z-index:34;right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:min(420px,calc(100vw - 16px));max-height:min(68dvh,620px);overflow:auto;padding:10px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(7,16,26,.97)}#${PANEL_ID}[hidden]{display:none!important}#${PANEL_ID} .groundGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}#${PANEL_ID} pre{max-height:180px;overflow:auto;font-size:10px}@media(max-width:700px){#${PANEL_ID}{left:4px;right:4px;bottom:4px;width:auto;max-height:48dvh}}`;
    document.head.appendChild(style);
  }

  function installPanel() {
    if (document.getElementById(PANEL_ID)) return true;
    const root = document.getElementById('gameModalOverlayRoot') || document.body;
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.hidden = true;
    panel.innerHTML = `<div style="display:flex;gap:7px;align-items:center;margin-bottom:8px"><b>Ground / Rest</b><span class="pill" style="margin-left:auto">Live shoulders + native hands/feet</span><button id="groundRestClose" class="secondary">×</button></div><div class="groundGrid">${Object.entries(POSES).map(([id,label]) => `<button type="button" class="secondary" data-ground-pose="${id}">${label}</button>`).join('')}</div><p class="muted small">Carry is a movement mode beside Regular/Drunken, not a ground pose.</p><pre id="groundRestDebug">Normal movement.</pre>`;
    root.appendChild(panel);
    document.getElementById('groundRestClose').onclick = () => { panel.hidden = true; };
    panel.addEventListener('click', event => {
      const button = event.target.closest('[data-ground-pose]');
      if (button) setPose(button.dataset.groundPose);
    });
    return true;
  }

  function installButton() {
    if (document.getElementById(BUTTON_ID)) return true;
    const actions = document.querySelector('#animationHud .animationHudActions');
    if (!actions) return false;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Ground / Rest';
    button.onclick = () => {
      installPanel();
      document.getElementById(PANEL_ID).hidden = false;
      syncUi();
    };
    actions.appendChild(button);
    return true;
  }

  function syncUi() {
    document.querySelectorAll('[data-ground-pose]').forEach(button => button.classList.toggle('active', button.dataset.groundPose === state.pose));
    const quick = document.getElementById(BUTTON_ID);
    if (quick) quick.classList.toggle('active', state.pose !== 'normal');
  }

  function updateDebug() {
    const pre = document.getElementById('groundRestDebug');
    if (pre) pre.textContent = JSON.stringify(state.debug, null, 2);
  }

  function installRenderHook() {
    if (state.renderHookInstalled) return true;
    const renderer = window.HobunjiGameplayBackdrop?.getRenderer?.();
    if (!renderer?.render) return false;
    state.priorRender = renderer.render.bind(renderer);
    renderer.render = function proceduralGroundRestRender(scene, camera) {
      renderGroundFrame();
      return state.priorRender(scene, camera);
    };
    state.renderHookInstalled = true;
    return true;
  }

  async function bootstrap() {
    injectStyles();
    try {
      state.THREE = (await window.PNGPlaneAvatar?.loadThreeModules?.())?.THREE || window.THREE || null;
    } catch (error) {
      log(`[Ground / Rest] Could not resolve Three.js: ${error.message}`, 'error');
    }
    let tries = 0;
    function frame() {
      installPanel(); installButton(); installRenderHook();
      if ((!state.renderHookInstalled || !document.getElementById(BUTTON_ID)) && tries++ < 600) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.HobunjiProceduralLimbPoseAuthor = {
    version: 5,
    mode: 'modern-main-ground-rest-live-shoulders',
    shoulderSource: 'live-attachment-rig-every-frame',
    setPose,
    resetPose,
    openPanel: () => {
      installPanel();
      document.getElementById(PANEL_ID).hidden = false;
      syncUi();
    },
    getDebug: () => ({ ...state.debug, pose: state.pose }),
  };

  bootstrap();
})();
