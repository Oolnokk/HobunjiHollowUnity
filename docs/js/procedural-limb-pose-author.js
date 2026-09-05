// Procedural Animation Editor: Ground / Rest limb authoring against the
// editor's ACTUAL hierarchy.
//
// The editor does not use the runtime *_procedural_feet hip/thigh/calf tree.
// Its body is model <- poseRoot <- avatarLiftRoot <- locomotionRoot, while its
// real authoring feet are sibling *_ExperimentalFeet assemblies and its visible
// hand wrappers are children of the PNG model. Ground poses therefore solve
// virtual knees/elbows but drive those existing feet/hands directly.
(function () {
  'use strict';

  if (window.HobunjiProceduralLimbPoseAuthor?.version >= 5) return;

  const PANEL_ID = 'proceduralGroundRestPanel';
  const BUTTON_ID = 'proceduralGroundRestQuickBtn';
  const STYLE_ID = 'proceduralGroundRestStyles';
  const GUIDE_ROOT_NAME = 'ProceduralGroundRestNativeGuides';
  const DOWN = Object.freeze({ x: 0, y: -1, z: 0 });
  const POSES = Object.freeze({
    normal: 'Normal / movement',
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
    poseRoot: null,
    avatarLiftRoot: null,
    locomotionRoot: null,
    bodyBase: null,
    modelHeight: 0.9,
    modelWidth: 0.9,
    floorLift: 0.45,
    posteriorY: 0.3,
    profile: null,
    anatomy: null,
    feet: null,
    hands: null,
    guideRoot: null,
    renderHookInstalled: false,
    priorRender: null,
    overlayObserver: null,
    debug: {},
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function log(message, level = 'info', extra = null) {
    const logger = window.HobunjiGameplayBackdrop?.log;
    if (logger) { logger(message, level, extra); return; }
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(message, extra ?? '');
  }

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  }

  function selectedIdentity(model) {
    const npc = window.HobunjiGameplayBackdrop?.getSelectedNpc?.() || {};
    const appearance = npc.appearance || npc.profile?.appearance || npc.fighter?.appearance || {};
    return {
      species: normalizeSpecies(appearance.speciesId || appearance.species || npc.species || model?.userData?.speciesId || 'mao-ao'),
      gender: normalizeGender(appearance.gender || npc.gender || model?.userData?.gender || 'male'),
    };
  }

  function profileFor(identity) {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    const alias = typeof window.hobunjiTransformSpeciesId === 'function'
      ? normalizeSpecies(window.hobunjiTransformSpeciesId(identity.species))
      : identity.species === 'rakakoan' ? 'kenkari' : identity.species === 'ghoul' ? 'mao-ao' : identity.species;
    return characters[`${identity.species}::${identity.gender}`]
      || characters[`${alias}::${identity.gender}`]
      || null;
  }

  function posteriorYFor(model, profile) {
    const analysis = model?.userData?.experimentalFeet || {};
    const modelHeight = state.modelHeight;
    const handAttachY = Number(model?.userData?.handAttachY);
    const baseY = Number.isFinite(handAttachY) ? handAttachY : modelHeight / 2;
    const resolved = Number(profile?.resolvedPosteriorPosition?.y);
    if (Number.isFinite(resolved)) return resolved;
    const math = window.HOBUNJI_ATTACHMENT_RIG_MATH;
    if (math?.characterPosteriorY && profile?.posteriorRule) {
      const value = Number(math.characterPosteriorY(profile.posteriorRule, modelHeight, baseY));
      if (Number.isFinite(value)) return value;
    }
    const analysisHeight = Number(analysis.gameModelHeight);
    const percent = Number(profile?.posteriorRule?.heightPercentFromFloor);
    if (Number.isFinite(percent)) return (Number.isFinite(analysisHeight) ? analysisHeight : modelHeight) * percent / 100;
    return baseY + modelHeight * (Number(profile?.posteriorRule?.heightPercentOffset) || -18) / 100;
  }

  function shoulderFloorPoint(side) {
    const key = side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder';
    const p = state.profile?.anchors?.[key]?.position;
    if (p && [p.x, p.y, p.z].every(value => Number.isFinite(Number(value)))) {
      return new state.THREE.Vector3(Number(p.x), Number(p.y), Number(p.z));
    }
    const sign = side === 'left' ? -1 : 1;
    return new state.THREE.Vector3(sign * state.modelWidth * 0.18, state.modelHeight * 0.68, 0);
  }

  function resolveAnatomy() {
    const identity = selectedIdentity(state.model);
    const tuned = window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES?.resolve?.(identity.species, identity.gender) || {};
    const armOffset = Number(state.profile?.anatomy?.armLengthHeightPercentOffset) || 0;
    const freeHandY = state.posteriorY - state.modelHeight * armOffset / 100;
    const armLengths = ['left', 'right'].map(side => {
      const shoulder = shoulderFloorPoint(side);
      return Math.max(state.modelHeight * 0.20, Math.hypot(shoulder.y - freeHandY, shoulder.z));
    });
    const totalArmLength = (armLengths[0] + armLengths[1]) * 0.5;
    const upperArmFraction = clamp(tuned.upperArmFraction ?? 0.52, 0.35, 0.70);
    const analysis = state.model?.userData?.experimentalFeet || {};
    const leftIdle = analysis.leftIdle || { x: -state.modelWidth * 0.08, y: 0, z: 0 };
    const totalLegLength = Math.max(state.modelHeight * 0.20, Math.hypot(
      Number(leftIdle.x) || 0,
      state.posteriorY - (Number(leftIdle.y) || 0),
      Number(leftIdle.z) || 0,
    ));
    return {
      ...tuned,
      totalArmLength,
      upperArmLength: totalArmLength * upperArmFraction,
      lowerArmLength: totalArmLength * (1 - upperArmFraction),
      upperLegLength: totalLegLength * 0.5,
      lowerLegLength: totalLegLength * 0.5,
      upperArmRadius: state.modelHeight * Number(tuned.upperArmRadiusHeightFraction || 0.045),
      forearmRadius: state.modelHeight * Number(tuned.forearmRadiusHeightFraction || 0.038),
      thighRadius: state.modelHeight * Number(tuned.thighRadiusHeightFraction || 0.065),
      calfRadius: state.modelHeight * Number(tuned.calfRadiusHeightFraction || 0.052),
      torsoRadius: state.modelHeight * Number(tuned.torsoRadiusHeightFraction || 0.155),
    };
  }

  function floorPointToLocomotion(point) {
    const local = point.clone();
    local.y -= state.floorLift;
    state.poseRoot.updateWorldMatrix?.(true, false);
    state.poseRoot.localToWorld(local);
    state.locomotionRoot.updateWorldMatrix?.(true, false);
    state.locomotionRoot.worldToLocal(local);
    return local;
  }

  function locomotionPointToModel(point) {
    const out = point.clone();
    state.locomotionRoot.updateWorldMatrix?.(true, false);
    state.locomotionRoot.localToWorld(out);
    state.model.updateWorldMatrix?.(true, false);
    state.model.worldToLocal(out);
    return out;
  }

  function locomotionPointToFeet(point) {
    const out = point.clone();
    state.locomotionRoot.updateWorldMatrix?.(true, false);
    state.locomotionRoot.localToWorld(out);
    state.feet?.root?.updateWorldMatrix?.(true, false);
    state.feet?.root?.worldToLocal?.(out);
    return out;
  }

  function captureFeet() {
    const root = state.locomotionRoot?.getObjectByName?.(`${state.model.name || 'Avatar'}_ExperimentalFeet`)
      || state.locomotionRoot?.children?.find?.(child => /_ExperimentalFeet$/.test(String(child.name || '')))
      || null;
    if (!root) return null;
    const left = root.getObjectByName?.(`${state.model.name || 'Avatar'}_LeftFoot`)
      || root.children?.find?.(child => /LeftFoot$/i.test(String(child.name || '')))
      || null;
    const right = root.getObjectByName?.(`${state.model.name || 'Avatar'}_RightFoot`)
      || root.children?.find?.(child => /RightFoot$/i.test(String(child.name || '')))
      || null;
    if (!left || !right) return null;
    const analysis = state.model.userData?.experimentalFeet || root.userData?.experimentalFeet || {};
    return {
      root,
      analysis,
      left: { node: left, baseP: left.position.clone(), baseQ: left.quaternion.clone(), baseS: left.scale.clone() },
      right: { node: right, baseP: right.position.clone(), baseQ: right.quaternion.clone(), baseS: right.scale.clone() },
    };
  }

  function captureHands() {
    const left = state.model?.getObjectByName?.(`${state.model.name || 'Avatar'}_LeftHand`) || null;
    const right = state.model?.getObjectByName?.(`${state.model.name || 'Avatar'}_RightHand`) || null;
    const capture = node => node ? { node, baseP: node.position.clone(), baseQ: node.quaternion.clone(), baseS: node.scale.clone() } : null;
    return { left: capture(left), right: capture(right) };
  }

  function restoreBody() {
    if (!state.poseRoot || !state.bodyBase) return;
    state.poseRoot.position.copy(state.bodyBase.position);
    state.poseRoot.quaternion.copy(state.bodyBase.quaternion);
    state.poseRoot.scale.copy(state.bodyBase.scale);
  }

  function restoreFeet() {
    if (!state.feet) return;
    for (const side of ['left', 'right']) {
      const rec = state.feet[side];
      rec.node.position.copy(rec.baseP);
      rec.node.quaternion.copy(rec.baseQ);
      rec.node.scale.copy(rec.baseS);
    }
  }

  function restoreHands() {
    if (!state.hands) return;
    for (const side of ['left', 'right']) {
      const rec = state.hands[side];
      if (!rec) continue;
      rec.node.position.copy(rec.baseP);
      rec.node.quaternion.copy(rec.baseQ);
      rec.node.scale.copy(rec.baseS);
    }
  }

  function disposeGuides() {
    if (!state.guideRoot) return;
    state.guideRoot.traverse?.(node => {
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const material of materials) material.dispose?.();
    });
    state.guideRoot.removeFromParent?.();
    state.guideRoot = null;
  }

  function ensureGuides() {
    if (state.guideRoot?.parent === state.locomotionRoot) return state.guideRoot;
    disposeGuides();
    const THREE = state.THREE;
    const root = new THREE.Group();
    root.name = GUIDE_ROOT_NAME;
    for (const side of ['left', 'right']) {
      const material = new THREE.LineBasicMaterial({ color: side === 'left' ? 0x6ba9ff : 0xc89bff, transparent: true, opacity: 0.9, depthTest: false });
      for (const limb of ['arm', 'leg']) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), material.clone());
        line.name = `${side}_${limb}_ground_rest_guide`;
        line.renderOrder = 999;
        root.add(line);
      }
    }
    state.locomotionRoot.add(root);
    state.guideRoot = root;
    return root;
  }

  function updateGuide(side, limb, rootPoint, solved) {
    const line = state.guideRoot?.getObjectByName?.(`${side}_${limb}_ground_rest_guide`);
    const attr = line?.geometry?.attributes?.position;
    if (!attr || !solved) return;
    attr.setXYZ(0, rootPoint.x, rootPoint.y, rootPoint.z);
    attr.setXYZ(1, solved.joint.x, solved.joint.y, solved.joint.z);
    attr.setXYZ(2, solved.solvedTarget.x, solved.solvedTarget.y, solved.solvedTarget.z);
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere?.();
  }

  function bindModel(model) {
    if (state.model === model && state.poseRoot?.parent && state.locomotionRoot?.parent) {
      if (!state.feet) state.feet = captureFeet();
      if (!state.hands?.left && !state.hands?.right) state.hands = captureHands();
      return true;
    }
    restoreBody(); restoreFeet(); restoreHands(); disposeGuides();
    state.model = model;
    state.poseRoot = model?.parent || null;
    state.avatarLiftRoot = state.poseRoot?.parent || null;
    state.locomotionRoot = state.avatarLiftRoot?.parent || null;
    if (!model || !state.poseRoot || !state.avatarLiftRoot || !state.locomotionRoot) return false;
    state.modelHeight = Math.max(0.05, Number(model.userData?.portraitModelHeight) || Number(model.userData?.gameModelHeight) || 0.9);
    state.modelWidth = Math.max(0.05, Number(model.userData?.portraitModelWidth) || state.modelHeight);
    state.floorLift = Number(model.userData?.gameGrounding?.avatarHeightHalfLift);
    if (!Number.isFinite(state.floorLift)) state.floorLift = Number(state.avatarLiftRoot.position?.y) || state.modelHeight / 2;
    const identity = selectedIdentity(model);
    state.profile = profileFor(identity);
    state.posteriorY = posteriorYFor(model, state.profile);
    state.anatomy = resolveAnatomy();
    state.bodyBase = { position: state.poseRoot.position.clone(), quaternion: state.poseRoot.quaternion.clone(), scale: state.poseRoot.scale.clone() };
    state.feet = captureFeet();
    state.hands = captureHands();
    ensureGuides();
    return true;
  }

  function bodyPose(pose) {
    const h = state.modelHeight;
    const radius = state.anatomy?.torsoRadius || h * 0.155;
    const poses = {
      crossLegged: { posteriorHeight: radius * 0.92, x: 0, z: 0, pitch: 0, roll: 0 },
      kneel: { posteriorHeight: radius * 1.12, x: 0, z: -h * 0.035, pitch: -6, roll: 0 },
      sideLeanLeft: { posteriorHeight: radius * 1.12, x: -radius * 0.55, z: 0, pitch: 0, roll: 24 },
      sideLeanRight: { posteriorHeight: radius * 1.12, x: radius * 0.55, z: 0, pitch: 0, roll: -24 },
      lieSideLeft: { posteriorHeight: radius * 0.95, x: -radius * 0.28, z: 0, pitch: 0, roll: 82 },
      lieSideRight: { posteriorHeight: radius * 0.95, x: radius * 0.28, z: 0, pitch: 0, roll: -82 },
      lieBack: { posteriorHeight: radius * 0.92, x: 0, z: -h * 0.05, pitch: -82, roll: 0 },
    };
    return poses[pose] || null;
  }

  function applyBodyPose(pose) {
    const entry = bodyPose(pose);
    if (!entry || !state.poseRoot || !state.bodyBase) return;
    const THREE = state.THREE;
    state.poseRoot.position.copy(state.bodyBase.position).add(new THREE.Vector3(entry.x, entry.posteriorHeight - state.posteriorY, entry.z));
    state.poseRoot.quaternion.copy(state.bodyBase.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(entry.pitch), 0, THREE.MathUtils.degToRad(entry.roll), 'YXZ'
    )));
    state.poseRoot.scale.copy(state.bodyBase.scale);
    state.poseRoot.updateMatrixWorld(true);
  }

  function footContactY() {
    const analysis = state.feet?.analysis || state.model?.userData?.experimentalFeet || {};
    return (Number(analysis.groundLocalY) || 0) + (Number(analysis.contactRadiusY) || state.modelHeight * 0.025);
  }

  function legTargets(pose, hips) {
    const THREE = state.THREE;
    const h = state.modelHeight;
    const floor = footContactY();
    const sign = pose.endsWith('Right') ? 1 : -1;
    if (pose === 'crossLegged') return {
      left: { foot: new THREE.Vector3(h * 0.12, floor, h * 0.08), pole: new THREE.Vector3(-h * 0.38, floor + h * 0.08, h * 0.15) },
      right: { foot: new THREE.Vector3(-h * 0.12, floor, h * 0.05), pole: new THREE.Vector3(h * 0.38, floor + h * 0.08, h * 0.15) },
    };
    if (pose === 'kneel') return {
      left: { foot: new THREE.Vector3(hips.left.x, floor, -h * 0.23), pole: new THREE.Vector3(hips.left.x - h * 0.03, floor + h * 0.07, h * 0.24) },
      right: { foot: new THREE.Vector3(hips.right.x, floor, -h * 0.23), pole: new THREE.Vector3(hips.right.x + h * 0.03, floor + h * 0.07, h * 0.24) },
    };
    if (pose.startsWith('sideLean')) return {
      left: { foot: new THREE.Vector3(-sign * h * 0.05, floor, h * 0.22), pole: new THREE.Vector3(-h * 0.30, floor + h * 0.11, h * 0.16) },
      right: { foot: new THREE.Vector3(sign * h * 0.17, floor, h * 0.12), pole: new THREE.Vector3(h * 0.30, floor + h * 0.11, h * 0.16) },
    };
    if (pose.startsWith('lieSide')) return {
      left: { foot: new THREE.Vector3(-h * 0.05, floor, h * 0.28), pole: new THREE.Vector3(-h * 0.16, floor + h * 0.10, h * 0.14) },
      right: { foot: new THREE.Vector3(h * 0.05, floor, h * 0.10), pole: new THREE.Vector3(h * 0.16, floor + h * 0.10, h * 0.14) },
    };
    if (pose === 'lieBack') return {
      left: { foot: new THREE.Vector3(-h * 0.10, floor, h * 0.33), pole: new THREE.Vector3(-h * 0.13, floor + h * 0.20, h * 0.17) },
      right: { foot: new THREE.Vector3(h * 0.10, floor, h * 0.33), pole: new THREE.Vector3(h * 0.13, floor + h * 0.20, h * 0.17) },
    };
    return null;
  }

  function handTargets(pose, shoulders, legs) {
    const THREE = state.THREE;
    const h = state.modelHeight;
    const floor = footContactY();
    const torso = state.anatomy?.torsoRadius || h * 0.155;
    if (pose === 'crossLegged') return {
      left: { target: legs.left.joint.clone().add(new THREE.Vector3(0, state.anatomy.thighRadius * 1.2, h * 0.015)), pole: shoulders.left.clone().add(new THREE.Vector3(-h * 0.20, -h * 0.05, -h * 0.08)) },
      right: { target: legs.right.joint.clone().add(new THREE.Vector3(0, state.anatomy.thighRadius * 1.2, h * 0.015)), pole: shoulders.right.clone().add(new THREE.Vector3(h * 0.20, -h * 0.05, -h * 0.08)) },
    };
    if (pose === 'kneel') return {
      left: { target: legs.left.joint.clone().add(new THREE.Vector3(0, state.anatomy.thighRadius * 1.35, -h * 0.03)), pole: shoulders.left.clone().add(new THREE.Vector3(-h * 0.18, -h * 0.03, -h * 0.04)) },
      right: { target: legs.right.joint.clone().add(new THREE.Vector3(0, state.anatomy.thighRadius * 1.35, -h * 0.03)), pole: shoulders.right.clone().add(new THREE.Vector3(h * 0.18, -h * 0.03, -h * 0.04)) },
    };
    if (pose.startsWith('sideLean')) {
      const leftSupport = pose.endsWith('Left');
      const support = new THREE.Vector3((leftSupport ? -1 : 1) * h * 0.29, floor + state.anatomy.forearmRadius, h * 0.02);
      const rest = new THREE.Vector3((leftSupport ? 1 : -1) * torso * 0.25, floor + torso * 1.75, h * 0.08);
      return leftSupport
        ? { left: { target: support, pole: new THREE.Vector3(-h * 0.27, floor + h * 0.15, -h * 0.04) }, right: { target: rest, pole: shoulders.right.clone().add(new THREE.Vector3(h * 0.15, -h * 0.03, -h * 0.08)) } }
        : { left: { target: rest, pole: shoulders.left.clone().add(new THREE.Vector3(-h * 0.15, -h * 0.03, -h * 0.08)) }, right: { target: support, pole: new THREE.Vector3(h * 0.27, floor + h * 0.15, -h * 0.04) } };
    }
    if (pose.startsWith('lieSide')) {
      const onLeft = pose.endsWith('Left');
      const lower = new THREE.Vector3((onLeft ? -1 : 1) * h * 0.19, floor + torso * 1.2, -h * 0.02);
      const upper = new THREE.Vector3((onLeft ? 1 : -1) * h * 0.04, floor + torso * 1.15, h * 0.14);
      return onLeft
        ? { left: { target: lower, pole: new THREE.Vector3(-h * 0.26, floor + h * 0.06, 0) }, right: { target: upper, pole: shoulders.right.clone().add(new THREE.Vector3(h * 0.14, -h * 0.05, -h * 0.08)) } }
        : { left: { target: upper, pole: shoulders.left.clone().add(new THREE.Vector3(-h * 0.14, -h * 0.05, -h * 0.08)) }, right: { target: lower, pole: new THREE.Vector3(h * 0.26, floor + h * 0.06, 0) } };
    }
    if (pose === 'lieBack') return {
      left: { target: new THREE.Vector3(-h * 0.18, floor + state.anatomy.forearmRadius, h * 0.02), pole: new THREE.Vector3(-h * 0.28, floor + h * 0.08, -h * 0.03) },
      right: { target: new THREE.Vector3(h * 0.18, floor + state.anatomy.forearmRadius, h * 0.02), pole: new THREE.Vector3(h * 0.28, floor + h * 0.08, -h * 0.03) },
    };
    return null;
  }

  function solveLeg(side, hip, target) {
    const solved = window.LegBones?.solveFixedTwoBoneChain?.(state.THREE, {
      root: hip,
      target: target.foot,
      upperLength: state.anatomy.upperLegLength,
      lowerLength: state.anatomy.lowerLegLength,
      pole: target.pole,
    }) || null;
    if (!solved) return null;
    const foot = state.feet?.[side]?.node;
    if (foot) foot.position.copy(locomotionPointToFeet(solved.solvedTarget));
    updateGuide(side, 'leg', hip, solved);
    return solved;
  }

  function solveArm(side, shoulder, target) {
    const solved = window.LegBones?.solveFixedTwoBoneChain?.(state.THREE, {
      root: shoulder,
      target: target.target,
      upperLength: state.anatomy.upperArmLength,
      lowerLength: state.anatomy.lowerArmLength,
      pole: target.pole,
    }) || null;
    if (!solved) return null;
    const hand = state.hands?.[side]?.node;
    if (hand) {
      const endpoint = locomotionPointToModel(solved.solvedTarget);
      const joint = locomotionPointToModel(solved.joint);
      hand.position.copy(endpoint);
      const forearm = endpoint.clone().sub(joint);
      if (forearm.lengthSq() > 1e-10) hand.quaternion.setFromUnitVectors(new state.THREE.Vector3(DOWN.x, DOWN.y, DOWN.z), forearm.normalize());
    }
    updateGuide(side, 'arm', shoulder, solved);
    return solved;
  }

  function applyPoseFrame() {
    const model = window.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
    if (state.pose === 'normal' || !model || !state.THREE) return;
    if (!bindModel(model)) return;
    restoreBody(); restoreFeet(); restoreHands();
    applyBodyPose(state.pose);
    ensureGuides();

    const analysis = state.feet?.analysis || model.userData?.experimentalFeet || {};
    const leftIdle = analysis.leftIdle || { x: -state.modelWidth * 0.08, y: 0, z: 0 };
    const rightIdle = analysis.rightIdle || { x: state.modelWidth * 0.08, y: 0, z: 0 };
    const hips = {
      left: floorPointToLocomotion(new state.THREE.Vector3(Number(leftIdle.x) || -state.modelWidth * 0.08, state.posteriorY, 0)),
      right: floorPointToLocomotion(new state.THREE.Vector3(Number(rightIdle.x) || state.modelWidth * 0.08, state.posteriorY, 0)),
    };
    const targets = legTargets(state.pose, hips);
    if (!targets) return;
    const legs = {
      left: solveLeg('left', hips.left, targets.left),
      right: solveLeg('right', hips.right, targets.right),
    };
    if (!legs.left || !legs.right) return;

    const shoulders = {
      left: floorPointToLocomotion(shoulderFloorPoint('left')),
      right: floorPointToLocomotion(shoulderFloorPoint('right')),
    };
    const hands = handTargets(state.pose, shoulders, legs);
    const arms = hands ? {
      left: solveArm('left', shoulders.left, hands.left),
      right: solveArm('right', shoulders.right, hands.right),
    } : { left: null, right: null };

    state.debug = {
      pose: state.pose,
      hierarchy: {
        model: state.model?.name || null,
        poseRoot: state.poseRoot?.name || '(unnamed poseRoot)',
        locomotionRoot: state.locomotionRoot?.name || '(unnamed locomotionRoot)',
        experimentalFeet: state.feet?.root?.name || null,
      },
      shoulders: {
        source: state.profile ? 'attachment-rig profile' : 'species-scaled fallback',
        left: shoulders.left.toArray(),
        right: shoulders.right.toArray(),
      },
      nativeHands: { left: !!state.hands?.left, right: !!state.hands?.right },
      nativeFeet: { left: !!state.feet?.left, right: !!state.feet?.right },
      reach: {
        leftLeg: legs.left?.reachable ?? null,
        rightLeg: legs.right?.reachable ?? null,
        leftArm: arms.left?.reachable ?? null,
        rightArm: arms.right?.reachable ?? null,
      },
    };
    updateDebug();
  }

  function releaseModel() {
    restoreBody(); restoreFeet(); restoreHands(); disposeGuides();
    state.model = null;
    state.poseRoot = null;
    state.avatarLiftRoot = null;
    state.locomotionRoot = null;
    state.bodyBase = null;
    state.feet = null;
    state.hands = null;
    state.profile = null;
    state.anatomy = null;
  }

  async function setPose(pose, options = {}) {
    const next = POSES[pose] ? pose : 'normal';
    if (next !== 'normal') window.ProceduralCarryWalkMode?.setEnabled?.(false);
    state.pose = next;
    if (next === 'normal') {
      releaseModel();
      if (!options.preservePlayback) window.HobunjiGameplayBackdrop?.setMovementPlayback?.(true);
      setStatus('Ground / Rest off · ordinary movement restored');
    } else {
      window.ProceduralDanceMode?.setEnabled?.(false);
      window.HobunjiGameplayBackdrop?.setMovementPlayback?.(false);
      const model = window.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
      if (model && state.THREE) bindModel(model);
      try {
        applyPoseFrame();
        setStatus(`${POSES[next]} selected · editor-native poseRoot / ExperimentalFeet path`);
      } catch (error) {
        state.debug = { pose: next, error: String(error?.stack || error) };
        updateDebug();
        setStatus(`${POSES[next]} failed · ${error?.message || error}`, 'bad');
        log(`[Ground / Rest] ${error?.stack || error}`, 'error');
      }
    }
    syncUi();
    return state.pose;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `#${PANEL_ID}{position:fixed;z-index:10045;right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:min(420px,calc(100vw - 16px));max-height:min(68dvh,620px);overflow:auto;padding:10px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(7,16,26,.97);box-shadow:0 18px 52px rgba(0,0,0,.55)}#${PANEL_ID}[hidden]{display:none!important}#${PANEL_ID} .groundGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}#${PANEL_ID} pre{max-height:180px;overflow:auto;font-size:10px}@media(max-width:700px){#${PANEL_ID}{left:4px;right:4px;bottom:4px;width:auto;max-height:48dvh}}`;
    document.head.appendChild(style);
  }

  function installPanel() {
    const root = document.getElementById('gameModalOverlayRoot') || document.body;
    let panel = document.getElementById(PANEL_ID);
    if (panel) {
      if (panel.parentElement !== root) root.appendChild(panel);
      return true;
    }
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.hidden = true;
    panel.innerHTML = `<div style="display:flex;gap:7px;align-items:center;margin-bottom:8px"><b>Ground / Rest</b><span class="pill" style="margin-left:auto">Editor-native feet + hands</span><button id="groundRestClose" class="secondary" type="button">×</button></div><div class="groundGrid">${Object.entries(POSES).map(([id,label]) => `<button type="button" class="secondary" data-ground-pose="${id}">${label}</button>`).join('')}</div><p class="muted small">Ground poses pause ordinary locomotion and drive the editor's poseRoot, ExperimentalFeet, and existing hand wrappers directly.</p><pre id="groundRestDebug">Normal movement.</pre>`;
    root.appendChild(panel);
    document.getElementById('groundRestClose').onclick = () => { panel.hidden = true; };
    panel.querySelectorAll('[data-ground-pose]').forEach(button => {
      button.onclick = () => setPose(button.dataset.groundPose);
    });
    return true;
  }

  function installOverlayObserver() {
    const root = document.getElementById('gameModalOverlayRoot');
    if (!root || state.overlayObserver) return Boolean(root);
    state.overlayObserver = new MutationObserver(() => {
      if (!document.getElementById(PANEL_ID)) installPanel();
      installButton();
    });
    state.overlayObserver.observe(root, { childList: true });
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
      const panel = document.getElementById(PANEL_ID);
      panel.hidden = !panel.hidden;
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
    if (pre) pre.textContent = JSON.stringify({ ...state.debug, pose: state.pose }, null, 2);
  }

  function setStatus(message, kind = 'good') {
    const status = document.getElementById('statusPill');
    if (!status) return;
    status.textContent = message;
    status.className = `pill ${kind}`;
  }

  function installRenderHook() {
    if (state.renderHookInstalled) return true;
    const renderer = window.HobunjiGameplayBackdrop?.getRenderer?.();
    if (!renderer?.render) return false;
    state.priorRender = renderer.render.bind(renderer);
    renderer.render = function proceduralGroundRestNativeRender(scene, camera) {
      if (state.pose !== 'normal') {
        try { applyPoseFrame(); }
        catch (error) {
          state.debug = { pose: state.pose, error: String(error?.stack || error) };
          updateDebug();
          setStatus(`Ground / Rest render error · ${error?.message || error}`, 'bad');
          log(`[Ground / Rest] ${error?.stack || error}`, 'error');
          state.pose = 'normal';
          releaseModel();
        }
      }
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
    let attempts = 0;
    function frame() {
      installPanel();
      installOverlayObserver();
      installButton();
      installRenderHook();
      if ((!state.renderHookInstalled || !document.getElementById(BUTTON_ID) || !state.overlayObserver) && attempts++ < 600) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.HobunjiProceduralLimbPoseAuthor = {
    version: 5,
    mode: 'editor-native-pose-root-experimental-feet',
    setPose,
    resetPose: options => setPose('normal', options),
    openPanel: () => {
      installPanel();
      document.getElementById(PANEL_ID).hidden = false;
      syncUi();
    },
    getDebug: () => ({ ...state.debug, pose: state.pose }),
  };

  bootstrap();
})();
