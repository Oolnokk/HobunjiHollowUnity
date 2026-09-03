// Procedural Animation Editor extension: ground/rest poses, heavy upright carry,
// and manual limb IK. The editor's existing avatar renderer/locomotion remains
// authoritative; this module only takes explicit ownership when a non-Normal
// mode is selected.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbPoseAuthor) return;

  const SCRIPT_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL) : new URL('../../', location.href);
  const STORAGE_KEY = 'hobunji.proceduralLimbPoseAuthor.v3';
  const PANEL_ID = 'proceduralLimbPosePanel';
  const STYLE_ID = 'proceduralLimbPoseStyles';
  const GUIDE_ROOT_NAME = 'ProceduralLimbPoseGuides';
  const CARRY_OBJECT_NAME = 'ProceduralCarryObjectProxy';

  const POSE_LABELS = Object.freeze({
    normal: 'Normal animator (off)',
    manual: 'Manual IK',
    crossLegged: 'Cross-legged',
    kneel: 'Kneeling',
    sideLeanLeft: 'Side lean · left',
    sideLeanRight: 'Side lean · right',
    lieSideLeft: 'Lie on side · left',
    lieSideRight: 'Lie on side · right',
    lieBack: 'Lie on back',
    carryUpright: 'Walk · keep heavy object upright',
  });

  const CARRY_MOVEMENT = Object.freeze({
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

  const runtime = {
    THREE: null,
    handThree: null,
    backdrop: null,
    model: null,
    poseRoot: null,
    avatarLiftRoot: null,
    locomotionRoot: null,
    feetRig: null,
    handRig: null,
    guideRoot: null,
    guideMeshes: {},
    carryObject: null,
    manual: null,
    manualCreating: null,
    baseline: null,
    movementBaseline: null,
    speciesId: 'mao-ao',
    gender: 'male',
    modelHeight: 0.9,
    modelWidth: 0.9,
    floorLift: 0.45,
    posteriorY: 0.3,
    anatomy: null,
    poseId: 'normal',
    showGuides: true,
    carryWeight: 0.86,
    carryAwkwardness: 0.82,
    carryObjectHeightFraction: 0.72,
    carryObjectWidthFraction: 0.48,
    carryObjectDepthFraction: 0.24,
    priorLocomotionWorldPosition: null,
    priorTime: performance.now(),
    lastSolve: null,
    lastDebug: null,
    pendingOpen: false,
  };

  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
  function normalizeSpecies(value) { return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''); }
  function normalizeGender(value) { return String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male'; }

  function loadScript(relativePath, ready) {
    if (ready?.()) return Promise.resolve();
    const src = new URL(relativePath, DOCS_BASE).href;
    const existing = [...document.scripts].find(script => script.src === src);
    if (existing) return new Promise((resolve, reject) => {
      if (ready?.()) return resolve();
      existing.addEventListener('load', () => ready?.() ? resolve() : reject(new Error(`Loaded ${relativePath} without expected API`)), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${relativePath}`)), { once: true });
    });
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => ready?.() ? resolve() : reject(new Error(`Loaded ${relativePath} without expected API`));
      script.onerror = () => reject(new Error(`Failed to load ${relativePath}`));
      document.head.appendChild(script);
    });
  }

  async function ensureDependencies() {
    await loadScript('config/procedural-anatomy-profiles.js?v=20260902d', () => Boolean(window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES));
    await loadScript('js/leg-bones.js?v=20260902d', () => typeof window.LegBones?.solveSubdividedChain === 'function');
    await loadScript('config/hand-model-profiles.js?v=20260902d', () => Boolean(window.HobunjiHandModelProfiles));
    await loadScript('js/procedural-hand-attachments.js?v=20260902d', () => Boolean(window.ProceduralHandAttachments));
    await loadScript('js/procedural-limb-manual-author.js?v=20260902d', () => Boolean(window.ProceduralLimbManualAuthor));
    if (!window.PNGPlaneAvatar?.loadThreeModules) throw new Error('PNGPlaneAvatar.loadThreeModules is unavailable.');
    const modules = await window.PNGPlaneAvatar.loadThreeModules();
    runtime.THREE = modules.THREE;
    const configuredThreeUrl = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.threeModuleUrl || 'https://esm.sh/three@0.128.0';
    const version = configuredThreeUrl.match(/three@([0-9.]+)/)?.[1] || '0.128.0';
    try {
      const loaderModule = await import(`https://esm.sh/three@${version}/examples/jsm/loaders/GLTFLoader.js?deps=three@${version}`);
      runtime.handThree = Object.assign({}, runtime.THREE, { GLTFLoader: loaderModule.GLTFLoader });
    } catch (error) {
      runtime.handThree = runtime.THREE;
      console.warn('[Limb pose author] GLTFLoader unavailable; generated hand fallback remains usable.', error);
    }
  }

  function selectedIdentity() {
    const npc = runtime.backdrop?.getSelectedNpc?.() || {};
    const appearance = npc.appearance || npc.fighter?.appearance || npc.profile?.fighter || npc;
    return {
      speciesId: normalizeSpecies(appearance.speciesId || appearance.species || npc.speciesId || npc.species || 'mao-ao'),
      gender: normalizeGender(appearance.gender || npc.gender || 'male'),
      bodyColors: appearance.bodyColors || npc.bodyColors || {},
    };
  }

  function profileForIdentity(speciesId, gender) {
    const aliases = window.HOBUNJI_TRANSFORM_SPECIES_ALIASES || {};
    const canonical = aliases[speciesId] || speciesId;
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    return characters[`${speciesId}::${gender}`] || characters[`${canonical}::${gender}`] || null;
  }

  function posteriorYFor(profile, modelHeight, model) {
    const resolved = Number(profile?.resolvedPosteriorPosition?.y);
    if (Number.isFinite(resolved)) return resolved;
    const rule = profile?.posteriorRule || {};
    const percentFromFloor = Number(rule.heightPercentFromFloor);
    if (Number.isFinite(percentFromFloor)) return modelHeight * percentFromFloor / 100;
    const handAttachY = Number(model?.userData?.handAttachY);
    const shared = window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(rule, modelHeight, handAttachY);
    if (Number.isFinite(shared)) return shared;
    const offset = Number(rule.heightPercentOffset);
    return (Number.isFinite(handAttachY) ? handAttachY : modelHeight / 2) + modelHeight * (Number.isFinite(offset) ? offset : -18) / 100;
  }

  function shoulderFloorPoint(profile, side) {
    const anchorName = side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder';
    const p = profile?.anchors?.[anchorName]?.position;
    if (![p?.x, p?.y, p?.z].every(value => Number.isFinite(Number(value)))) return null;
    return { x: Number(p.x), y: Number(p.y), z: Number(p.z) };
  }

  function savedState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function saveState(next) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {} }
  function readStoredProfile() { return savedState().anatomy?.[`${runtime.speciesId}::${runtime.gender}`] || {}; }
  function writeStoredProfile(values) {
    const state = savedState();
    state.anatomy = state.anatomy || {};
    state.anatomy[`${runtime.speciesId}::${runtime.gender}`] = values;
    saveState(state);
  }

  function walkObjects(root, visitor) {
    if (!root) return;
    if (typeof root.traverse === 'function') { root.traverse(visitor); return; }
    visitor(root);
    for (const child of root.children || []) walkObjects(child, visitor);
  }

  function findNamedObject(root, names) {
    const wanted = new Set(names.map(name => String(name).toLowerCase()));
    let found = null;
    walkObjects(root, object => { if (!found && wanted.has(String(object?.name || '').toLowerCase())) found = object; });
    return found;
  }

  function discoverFeetRig() {
    const root = runtime.locomotionRoot;
    if (!root) return null;
    const sides = {};
    for (const side of ['left', 'right']) {
      const hip = findNamedObject(root, [`${side}_hip`, `${side}Hip`]);
      const thigh = hip ? findNamedObject(hip, [`${side}_thigh`, `${side}Thigh`]) : findNamedObject(root, [`${side}_thigh`, `${side}Thigh`]);
      const calf = thigh ? findNamedObject(thigh, [`${side}_calf`, `${side}Calf`]) : findNamedObject(root, [`${side}_calf`, `${side}Calf`]);
      const foot = calf ? findNamedObject(calf, [`${side}_foot`, `${side}Foot`]) : findNamedObject(root, [`${side}_foot`, `${side}Foot`, `${side}FootMesh`]);
      sides[side] = { hip, thigh, calf, foot };
    }
    return { root: sides.left.hip?.parent || sides.right.hip?.parent || null, ...sides };
  }

  function objectPointInLocomotion(object) {
    if (!object || !runtime.locomotionRoot) return null;
    const point = new runtime.THREE.Vector3();
    object.updateWorldMatrix?.(true, false);
    object.getWorldPosition?.(point);
    runtime.locomotionRoot.updateWorldMatrix?.(true, false);
    runtime.locomotionRoot.worldToLocal(point);
    return point;
  }

  function contactYForSide(side) {
    const analysis = runtime.model?.userData?.experimentalFeet || {};
    const named = Number(analysis[`${side}ContactY`]);
    if (Number.isFinite(named)) return named;
    const shared = Number(analysis.contactRadiusY);
    if (Number.isFinite(shared)) return shared;
    const footRadius = Number(runtime.feetRig?.[side]?.foot?.userData?.contactRadiusY);
    if (Number.isFinite(footRadius)) return footRadius;
    return runtime.modelHeight * 0.025;
  }

  function resolvedAnatomy() {
    const tuned = window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES?.resolve?.(runtime.speciesId, runtime.gender) || {};
    const settings = { ...tuned, ...readStoredProfile() };
    const upperArmFraction = clamp(settings.upperArmFraction ?? 0.52, 0.35, 0.68);
    const legLengths = ['left', 'right'].map(side => Math.max(runtime.modelHeight * 0.20, runtime.posteriorY - contactYForSide(side)));
    const totalLegLength = legLengths.reduce((sum, value) => sum + value, 0) / legLengths.length;
    return {
      ...settings,
      upperArmFraction,
      upperLegLength: totalLegLength * 0.5,
      lowerLegLength: totalLegLength * 0.5,
      upperArmRadius: runtime.modelHeight * Number(settings.upperArmRadiusHeightFraction || 0.045),
      forearmRadius: runtime.modelHeight * Number(settings.forearmRadiusHeightFraction || 0.038),
      thighRadius: runtime.modelHeight * Number(settings.thighRadiusHeightFraction || 0.065),
      calfRadius: runtime.modelHeight * Number(settings.calfRadiusHeightFraction || 0.052),
      torsoRadius: runtime.modelHeight * Number(settings.torsoRadiusHeightFraction || 0.155),
      armLengthSource: 'live shoulder → hand target span, subdivided before elbow bend',
      legLengthSource: 'runtime posterior → procedural-foot contact',
    };
  }

  function snapshotTransform(object) {
    if (!object) return null;
    return { object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() };
  }
  function restoreSnapshot(snapshot) {
    const object = snapshot?.object;
    if (!object?.parent && object !== runtime.poseRoot) return;
    object.position.copy(snapshot.position);
    object.quaternion.copy(snapshot.quaternion);
    object.scale.copy(snapshot.scale);
    object.updateMatrixWorld?.(true);
  }
  function captureBaseline() {
    runtime.feetRig = discoverFeetRig();
    const standingHipX = Object.fromEntries(['left', 'right'].map(side => {
      const point = objectPointInLocomotion(runtime.feetRig?.[side]?.hip);
      return [side, point && Number.isFinite(point.x) ? point.x : (side === 'left' ? -1 : 1) * runtime.modelWidth * 0.08];
    }));
    runtime.baseline = {
      poseRoot: snapshotTransform(runtime.poseRoot),
      standingHipX,
      legs: Object.fromEntries(['left', 'right'].map(side => [side, {
        hip: snapshotTransform(runtime.feetRig?.[side]?.hip),
        thigh: snapshotTransform(runtime.feetRig?.[side]?.thigh),
        calf: snapshotTransform(runtime.feetRig?.[side]?.calf),
        foot: snapshotTransform(runtime.feetRig?.[side]?.foot),
      }])),
    };
  }
  function restoreBaseline() {
    restoreSnapshot(runtime.baseline?.poseRoot);
    for (const side of ['left', 'right']) {
      const leg = runtime.baseline?.legs?.[side];
      restoreSnapshot(leg?.hip); restoreSnapshot(leg?.thigh); restoreSnapshot(leg?.calf); restoreSnapshot(leg?.foot);
    }
    runtime.baseline = null;
  }

  function captureMovementInputs() {
    if (runtime.movementBaseline) return;
    runtime.movementBaseline = {};
    for (const id of Object.keys(CARRY_MOVEMENT)) {
      const input = document.getElementById(id);
      if (input) runtime.movementBaseline[id] = input.value;
    }
  }
  function dispatchMovementValue(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function restoreMovementInputs() {
    if (!runtime.movementBaseline) return;
    for (const [id, value] of Object.entries(runtime.movementBaseline)) dispatchMovementValue(id, value);
    runtime.movementBaseline = null;
  }

  function setHandsVisible(visible) { runtime.handRig?.setSideVisible?.('left', visible); runtime.handRig?.setSideVisible?.('right', visible); }
  function setGuidesVisible(visible) { if (runtime.guideRoot) runtime.guideRoot.visible = Boolean(visible && runtime.showGuides); }

  function poseRootFloorPoint(point) { return new runtime.THREE.Vector3(point.x, point.y - runtime.floorLift, point.z); }
  function floorPointToLocomotion(point) {
    const local = poseRootFloorPoint(point);
    runtime.poseRoot.updateWorldMatrix(true, false);
    runtime.poseRoot.localToWorld(local);
    runtime.locomotionRoot.updateWorldMatrix(true, false);
    runtime.locomotionRoot.worldToLocal(local);
    return local;
  }
  function locomotionPointToParent(point, parent) {
    const converted = point.clone();
    runtime.locomotionRoot.updateWorldMatrix(true, false); runtime.locomotionRoot.localToWorld(converted);
    parent.updateWorldMatrix?.(true, false); parent.worldToLocal(converted);
    return converted;
  }
  function locomotionQuaternionToParent(quaternion, parent) {
    const spaceWorld = runtime.locomotionRoot.getWorldQuaternion(new runtime.THREE.Quaternion());
    const desiredWorld = spaceWorld.multiply(quaternion.clone());
    const parentWorld = parent.getWorldQuaternion(new runtime.THREE.Quaternion());
    return parentWorld.invert().multiply(desiredWorld).normalize();
  }

  function makeGuideMaterial(opacity = 0.55) { return new runtime.THREE.MeshBasicMaterial({ color: 0x6ba9ff, transparent: true, opacity, depthTest: false, depthWrite: false }); }
  function disposeGuideRoot() {
    if (!runtime.guideRoot) return;
    runtime.guideRoot.traverse(child => { child.geometry?.dispose?.(); child.material?.dispose?.(); });
    runtime.guideRoot.parent?.remove(runtime.guideRoot);
    runtime.guideRoot = null; runtime.guideMeshes = {}; runtime.carryObject = null;
  }
  function ensureGuideRoot() {
    if (runtime.guideRoot?.parent === runtime.locomotionRoot) return;
    disposeGuideRoot();
    const THREE = runtime.THREE;
    const root = new THREE.Group(); root.name = GUIDE_ROOT_NAME; root.renderOrder = 80; runtime.locomotionRoot.add(root); runtime.guideRoot = root;
    for (const side of ['left', 'right']) {
      for (const joint of ['shoulder', 'elbow', 'hand', 'hip', 'knee', 'foot']) {
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), makeGuideMaterial(joint === 'shoulder' || joint === 'hip' ? 0.7 : 0.5));
        sphere.name = `${side}_${joint}_guide`; sphere.renderOrder = 80; root.add(sphere); runtime.guideMeshes[`${side}.${joint}`] = sphere;
      }
      for (const segment of ['upperArm', 'forearm', 'thigh', 'calf']) {
        const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), makeGuideMaterial(0.25));
        cylinder.name = `${side}_${segment}_guide`; cylinder.renderOrder = 79; root.add(cylinder); runtime.guideMeshes[`${side}.${segment}`] = cylinder;
      }
    }
    const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), makeGuideMaterial(0.12)); torso.name = 'torso_radius_guide'; root.add(torso); runtime.guideMeshes.torso = torso;
    setGuidesVisible(false);
  }
  function positionSphere(key, point, radius) {
    const mesh = runtime.guideMeshes[key]; if (!mesh || !point) return;
    mesh.position.copy(point); mesh.scale.setScalar(Math.max(0.008, radius)); mesh.visible = true;
  }
  function positionSegment(key, a, b, radius) {
    const mesh = runtime.guideMeshes[key]; if (!mesh || !a || !b) return;
    const direction = b.clone().sub(a); const length = direction.length();
    if (length < 1e-6) { mesh.visible = false; return; }
    mesh.visible = true; mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.scale.set(Math.max(0.006, radius), length, Math.max(0.006, radius));
    mesh.quaternion.setFromUnitVectors(new runtime.THREE.Vector3(0, 1, 0), direction.normalize());
  }

  function bodyPoseFor(poseId) {
    const radius = runtime.anatomy.torsoRadius, h = runtime.modelHeight;
    return ({
      crossLegged: { posteriorHeight: radius * 0.92, x: 0, z: 0, pitch: 0, roll: 0 },
      kneel: { posteriorHeight: radius * 1.12, x: 0, z: -h * 0.035, pitch: -6, roll: 0 },
      sideLeanLeft: { posteriorHeight: radius * 1.12, x: -radius * 0.55, z: 0, pitch: 0, roll: 24 },
      sideLeanRight: { posteriorHeight: radius * 1.12, x: radius * 0.55, z: 0, pitch: 0, roll: -24 },
      lieSideLeft: { posteriorHeight: radius * 0.95, x: -radius * 0.28, z: 0, pitch: 0, roll: 82 },
      lieSideRight: { posteriorHeight: radius * 0.95, x: radius * 0.28, z: 0, pitch: 0, roll: -82 },
      lieBack: { posteriorHeight: radius * 0.92, x: 0, z: -h * 0.05, pitch: -82, roll: 0 },
    })[poseId] || null;
  }
  function applyGroundBodyPose(poseId) {
    const pose = bodyPoseFor(poseId), base = runtime.baseline?.poseRoot;
    if (!pose || !base || base.object !== runtime.poseRoot) return;
    const horizontal = new runtime.THREE.Vector3(pose.x, 0, pose.z).applyQuaternion(base.quaternion);
    runtime.poseRoot.position.copy(base.position).add(horizontal); runtime.poseRoot.position.y += pose.posteriorHeight - runtime.posteriorY;
    const delta = new runtime.THREE.Quaternion().setFromEuler(new runtime.THREE.Euler(runtime.THREE.MathUtils.degToRad(pose.pitch), 0, runtime.THREE.MathUtils.degToRad(pose.roll), 'YXZ'));
    runtime.poseRoot.quaternion.copy(base.quaternion).multiply(delta).normalize(); runtime.poseRoot.scale.copy(base.scale); runtime.poseRoot.updateMatrixWorld(true);
  }

  function standingHipX(side) {
    const captured = Number(runtime.baseline?.standingHipX?.[side]); if (Number.isFinite(captured)) return captured;
    const live = objectPointInLocomotion(runtime.feetRig?.[side]?.hip); if (live && Number.isFinite(live.x)) return live.x;
    return (side === 'left' ? -1 : 1) * runtime.modelWidth * 0.08;
  }
  function currentAnchors() {
    const profile = profileForIdentity(runtime.speciesId, runtime.gender);
    const left = shoulderFloorPoint(profile, 'left') || { x: -runtime.modelWidth * 0.18, y: runtime.modelHeight * 0.68, z: 0 };
    const right = shoulderFloorPoint(profile, 'right') || { x: runtime.modelWidth * 0.18, y: runtime.modelHeight * 0.68, z: 0 };
    return {
      shoulders: { left: floorPointToLocomotion(left), right: floorPointToLocomotion(right) },
      hips: {
        left: floorPointToLocomotion({ x: standingHipX('left'), y: runtime.posteriorY, z: 0 }),
        right: floorPointToLocomotion({ x: standingHipX('right'), y: runtime.posteriorY, z: 0 }),
      },
    };
  }

  function solveArm(shoulder, hand, pole, joint = null) {
    return window.LegBones.solveSubdividedChain(runtime.THREE, {
      root: shoulder,
      target: hand,
      joint,
      jointFraction: runtime.anatomy.upperArmFraction,
      pole,
      bendRatio: joint ? 0 : 0.16,
    });
  }
  function solveLegFixed(hip, foot, pole) {
    return window.LegBones.solveFixedTwoBoneChain(runtime.THREE, { root: hip, target: foot, upperLength: runtime.anatomy.upperLegLength, lowerLength: runtime.anatomy.lowerLegLength, pole });
  }
  function solveManualLeg(hip, foot, knee) {
    return window.LegBones.solveSubdividedChain(runtime.THREE, { root: hip, target: foot, joint: knee, jointFraction: 0.5 });
  }

  function groundTargets(poseId, hips) {
    const h = runtime.modelHeight, floorLeft = contactYForSide('left'), floorRight = contactYForSide('right'), side = poseId.endsWith('Right') ? 1 : -1;
    if (poseId === 'crossLegged') return { feet: { left: new runtime.THREE.Vector3(h * 0.12, floorLeft, h * 0.08), right: new runtime.THREE.Vector3(-h * 0.12, floorRight, h * 0.05) }, poles: { left: new runtime.THREE.Vector3(-h * 0.38, floorLeft + h * 0.08, h * 0.15), right: new runtime.THREE.Vector3(h * 0.38, floorRight + h * 0.08, h * 0.15) } };
    if (poseId === 'kneel') return { feet: { left: new runtime.THREE.Vector3(hips.left.x, floorLeft, -h * 0.23), right: new runtime.THREE.Vector3(hips.right.x, floorRight, -h * 0.23) }, poles: { left: new runtime.THREE.Vector3(hips.left.x - h * 0.03, floorLeft + h * 0.07, h * 0.24), right: new runtime.THREE.Vector3(hips.right.x + h * 0.03, floorRight + h * 0.07, h * 0.24) } };
    if (poseId.startsWith('sideLean')) return { feet: { left: new runtime.THREE.Vector3(-side * h * 0.05, floorLeft, h * 0.22), right: new runtime.THREE.Vector3(side * h * 0.17, floorRight, h * 0.12) }, poles: { left: new runtime.THREE.Vector3(-h * 0.30, floorLeft + h * 0.11, h * 0.16), right: new runtime.THREE.Vector3(h * 0.30, floorRight + h * 0.11, h * 0.16) } };
    if (poseId.startsWith('lieSide')) return { feet: { left: new runtime.THREE.Vector3(-h * 0.05, floorLeft, h * 0.28), right: new runtime.THREE.Vector3(h * 0.05, floorRight, h * 0.10) }, poles: { left: new runtime.THREE.Vector3(-h * 0.16, floorLeft + h * 0.10, h * 0.14), right: new runtime.THREE.Vector3(h * 0.16, floorRight + h * 0.10, h * 0.14) } };
    if (poseId === 'lieBack') return { feet: { left: new runtime.THREE.Vector3(-h * 0.10, floorLeft, h * 0.33), right: new runtime.THREE.Vector3(h * 0.10, floorRight, h * 0.33) }, poles: { left: new runtime.THREE.Vector3(-h * 0.13, floorLeft + h * 0.20, h * 0.17), right: new runtime.THREE.Vector3(h * 0.13, floorRight + h * 0.20, h * 0.17) } };
    return null;
  }

  function handTargets(poseId, shoulders, legSolve) {
    const h = runtime.modelHeight, floor = Math.min(contactYForSide('left'), contactYForSide('right')), torso = runtime.anatomy.torsoRadius;
    if (poseId === 'crossLegged' || poseId === 'kneel') return {
      left: { target: legSolve.left.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.25, 0)), pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.20, -h * 0.03, -h * 0.08)) },
      right: { target: legSolve.right.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.25, 0)), pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.20, -h * 0.03, -h * 0.08)) },
    };
    if (poseId.startsWith('sideLean')) {
      const leftSupport = poseId.endsWith('Left');
      const support = new runtime.THREE.Vector3((leftSupport ? -1 : 1) * h * 0.29, floor + runtime.anatomy.forearmRadius, h * 0.02);
      const rest = new runtime.THREE.Vector3((leftSupport ? 1 : -1) * torso * 0.25, floor + torso * 1.75, h * 0.08);
      return leftSupport ? { left: { target: support, pole: support.clone().add(new runtime.THREE.Vector3(-h * .12, h * .12, -h * .05)) }, right: { target: rest, pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * .16, 0, -h * .08)) } } : { left: { target: rest, pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * .16, 0, -h * .08)) }, right: { target: support, pole: support.clone().add(new runtime.THREE.Vector3(h * .12, h * .12, -h * .05)) } };
    }
    if (poseId.startsWith('lieSide')) {
      const onLeft = poseId.endsWith('Left');
      const lower = new runtime.THREE.Vector3((onLeft ? -1 : 1) * h * 0.19, floor + torso * 1.2, -h * 0.02);
      const upper = new runtime.THREE.Vector3((onLeft ? 1 : -1) * h * 0.04, floor + torso * 1.15, h * 0.14);
      return onLeft ? { left: { target: lower, pole: lower.clone().add(new runtime.THREE.Vector3(-h * .12, h * .08, 0)) }, right: { target: upper, pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * .14, 0, -h * .08)) } } : { left: { target: upper, pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * .14, 0, -h * .08)) }, right: { target: lower, pole: lower.clone().add(new runtime.THREE.Vector3(h * .12, h * .08, 0)) } };
    }
    if (poseId === 'lieBack') return {
      left: { target: new runtime.THREE.Vector3(-h * 0.18, floor + runtime.anatomy.forearmRadius, h * 0.02), pole: new runtime.THREE.Vector3(-h * 0.28, floor + h * 0.08, -h * 0.03) },
      right: { target: new runtime.THREE.Vector3(h * 0.18, floor + runtime.anatomy.forearmRadius, h * 0.02), pole: new runtime.THREE.Vector3(h * 0.28, floor + h * 0.08, -h * 0.03) },
    };
    return null;
  }

  function applySolvedLeg(side, hipTarget, solved) {
    const chain = runtime.feetRig?.[side]; if (!chain || !solved) return false;
    if (chain.hip && chain.thigh && chain.calf && chain.foot) {
      chain.hip.position.copy(locomotionPointToParent(hipTarget, chain.hip.parent)); chain.hip.updateMatrixWorld?.(true);
      chain.thigh.quaternion.copy(locomotionQuaternionToParent(solved.upperQuaternion, chain.thigh.parent));
      chain.calf.position.set(0, -solved.upperLength, 0); chain.calf.quaternion.copy(solved.lowerLocalQuaternion);
      chain.foot.position.set(0, -solved.lowerLength, 0); chain.foot.rotation.x = 0; chain.hip.updateMatrixWorld?.(true); return true;
    }
    if (chain.foot?.parent) { chain.foot.position.copy(locomotionPointToParent(solved.solvedTarget, chain.foot.parent)); chain.foot.updateMatrixWorld?.(true); return true; }
    return false;
  }

  function placeRealHand(side, shoulder, solved) {
    if (!runtime.handRig || !solved) return;
    const handWorld = solved.solvedTarget.clone(); runtime.locomotionRoot.localToWorld(handWorld);
    const shoulderWorld = shoulder.clone(); runtime.locomotionRoot.localToWorld(shoulderWorld);
    const q = new runtime.handThree.Quaternion().setFromUnitVectors(new runtime.handThree.Vector3(0, 1, 0), shoulderWorld.clone().sub(handWorld).normalize());
    runtime.handRig.placeHandWorld(side, handWorld, q);
  }

  function drawSide(side, shoulder, arm, hip, leg) {
    positionSphere(`${side}.shoulder`, shoulder, runtime.anatomy.upperArmRadius * 1.15);
    positionSphere(`${side}.elbow`, arm.joint, Math.max(runtime.anatomy.upperArmRadius, runtime.anatomy.forearmRadius));
    positionSphere(`${side}.hand`, arm.solvedTarget, runtime.anatomy.forearmRadius * 0.9);
    positionSegment(`${side}.upperArm`, shoulder, arm.joint, runtime.anatomy.upperArmRadius);
    positionSegment(`${side}.forearm`, arm.joint, arm.solvedTarget, runtime.anatomy.forearmRadius);
    positionSphere(`${side}.hip`, hip, runtime.anatomy.thighRadius * 1.1);
    positionSphere(`${side}.knee`, leg.joint, Math.max(runtime.anatomy.thighRadius, runtime.anatomy.calfRadius));
    positionSphere(`${side}.foot`, leg.solvedTarget, runtime.anatomy.calfRadius * 0.85);
    positionSegment(`${side}.thigh`, hip, leg.joint, runtime.anatomy.thighRadius);
    positionSegment(`${side}.calf`, leg.joint, leg.solvedTarget, runtime.anatomy.calfRadius);
  }
  function updateTorsoGuide() {
    const torso = runtime.guideMeshes.torso; if (!torso) return;
    const center = floorPointToLocomotion({ x: 0, y: runtime.posteriorY + runtime.anatomy.torsoRadius * 0.35, z: 0 });
    torso.position.copy(center); torso.scale.set(runtime.anatomy.torsoRadius, runtime.anatomy.torsoRadius * 1.25, runtime.anatomy.torsoRadius * 0.78);
  }

  function ensureCarryObject() {
    if (runtime.carryObject?.parent === runtime.guideRoot) return runtime.carryObject;
    const THREE = runtime.THREE;
    const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.28, wireframe: true, depthTest: false }));
    object.name = CARRY_OBJECT_NAME; object.renderOrder = 78; runtime.guideRoot.add(object); runtime.carryObject = object; return object;
  }
  function updateCarryPose(now, shoulders) {
    const h = runtime.modelHeight, w = runtime.modelWidth, object = ensureCarryObject();
    const dt = Math.max(0.001, Math.min(0.05, (now - runtime.priorTime) / 1000));
    const currentWorld = runtime.locomotionRoot.getWorldPosition(new runtime.THREE.Vector3());
    const prior = runtime.priorLocomotionWorldPosition || currentWorld.clone();
    const speed = currentWorld.distanceTo(prior) / dt; runtime.priorLocomotionWorldPosition = currentWorld.clone(); runtime.priorTime = now;
    const motion = clamp(speed / 2.4, 0, 1), time = now / 1000;
    const swayX = Math.sin(time * 2.15) * h * 0.022 * runtime.carryAwkwardness * (0.35 + motion);
    const swayY = Math.sin(time * 3.05 + 0.7) * h * 0.010 * runtime.carryAwkwardness * motion;
    const center = floorPointToLocomotion({ x: swayX, y: runtime.posteriorY + h * 0.12 + swayY, z: h * (0.26 + runtime.carryWeight * 0.05) });
    object.position.copy(center); object.scale.set(w * runtime.carryObjectWidthFraction, h * runtime.carryObjectHeightFraction, w * runtime.carryObjectDepthFraction);
    object.rotation.set(-0.05 * runtime.carryWeight + Math.sin(time * 1.7) * 0.035 * runtime.carryAwkwardness, 0, Math.sin(time * 2.4) * 0.055 * runtime.carryAwkwardness * (0.4 + motion)); object.visible = true; object.updateMatrixWorld(true);
    const leftGrip = new runtime.THREE.Vector3(-0.5, 0.14, 0.52), rightGrip = new runtime.THREE.Vector3(0.5, -0.12, 0.52);
    object.localToWorld(leftGrip); object.localToWorld(rightGrip); runtime.locomotionRoot.worldToLocal(leftGrip); runtime.locomotionRoot.worldToLocal(rightGrip);
    return { left: { target: leftGrip, pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.24, h * 0.02, -h * 0.08)) }, right: { target: rightGrip, pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.24, -h * 0.02, -h * 0.08)) } };
  }

  function seedFromLastSolve() {
    const solve = runtime.lastSolve; if (!solve) return null;
    const sides = {};
    for (const side of ['left', 'right']) {
      const arm = solve.arms?.[side], leg = solve.legs?.[side];
      if (!arm || !leg) continue;
      sides[side] = {
        hand: arm.solvedTarget, elbow: arm.joint,
        foot: leg.solvedTarget, knee: leg.joint,
      };
    }
    return Object.keys(sides).length ? { sides } : null;
  }

  function openPhysicsWorkspace() {
    const panel = document.getElementById('footingPanel');
    if (panel) panel.open = true;
    document.getElementById('impactAuthoringTab')?.click?.();
    const status = document.getElementById('statusPill');
    if (status) { status.textContent = 'Manual IK released. Pose frozen; physics controls are ready.'; status.className = 'pill good'; }
  }

  async function ensureManualInstance() {
    if (runtime.manual) return runtime.manual;
    if (runtime.manualCreating) return runtime.manualCreating;
    runtime.manualCreating = window.ProceduralLimbManualAuthor.create({
      THREE: runtime.THREE,
      getScene: () => runtime.backdrop?.getScene?.(),
      getCamera: () => runtime.backdrop?.getCamera?.(),
      getRenderer: () => runtime.backdrop?.getRenderer?.(),
      getOrbitControls: () => runtime.backdrop?.getControls?.() || null,
      getLocomotionRoot: () => runtime.locomotionRoot,
      getModelHeight: () => runtime.modelHeight,
      getCurrentAnchors: currentAnchors,
      getLiveFoot: side => objectPointInLocomotion(runtime.feetRig?.[side]?.foot),
      solveManualArm: (_side, shoulder, hand, elbow) => solveArm(shoulder, hand, null, elbow),
      solveManualLeg: (_side, hip, foot, knee) => solveManualLeg(hip, foot, knee),
      applyManualArm: (side, shoulder, arm) => placeRealHand(side, shoulder, arm),
      applyManualLeg: (side, hip, leg) => applySolvedLeg(side, hip, leg),
      drawManualSide: drawSide,
      updateTorsoGuide,
      setHandsVisible,
      setGuidesVisible,
      onDebug: debug => { runtime.lastDebug = { identity: `${runtime.speciesId}::${runtime.gender}`, pose: 'manual', ...debug }; },
      onReleaseToPhysics: openPhysicsWorkspace,
    }).then(instance => { runtime.manual = instance; runtime.manualCreating = null; return instance; });
    return runtime.manualCreating;
  }

  async function startManual(seed) {
    const manual = await ensureManualInstance();
    if (runtime.poseId !== 'manual') return;
    await manual.start(seed);
    runtime.lastDebug = { identity: `${runtime.speciesId}::${runtime.gender}`, pose: 'manual', ownership: 'manual handles → IK; physics off' };
  }
  function releaseManualToPhysics() { if (runtime.poseId === 'manual') runtime.manual?.releaseToPhysics?.(); renderDebug(); }
  function resumeManual() { if (runtime.poseId === 'manual') runtime.manual?.resume?.(); renderDebug(); }

  function updatePoseFrame(now) {
    if (runtime.poseId === 'normal') return;
    if (!runtime.model || !runtime.poseRoot || !runtime.locomotionRoot || !runtime.anatomy) return;
    runtime.feetRig = discoverFeetRig();
    if (runtime.poseId === 'manual') { runtime.manual?.update?.(now); return; }
    if (runtime.poseId !== 'carryUpright') applyGroundBodyPose(runtime.poseId);
    const anchors = currentAnchors(), shoulders = anchors.shoulders, hips = anchors.hips;
    let legSolve = {}, handPose = null;
    if (runtime.poseId === 'carryUpright') {
      handPose = updateCarryPose(now, shoulders);
      for (const side of ['left', 'right']) {
        const liveFoot = objectPointInLocomotion(runtime.feetRig?.[side]?.foot) || new runtime.THREE.Vector3(standingHipX(side), contactYForSide(side), 0);
        const pole = hips[side].clone().add(new runtime.THREE.Vector3((side === 'left' ? -1 : 1) * runtime.modelHeight * .08, 0, runtime.modelHeight * .20));
        legSolve[side] = solveLegFixed(hips[side], liveFoot, pole);
      }
    } else {
      if (runtime.carryObject) runtime.carryObject.visible = false;
      const targets = groundTargets(runtime.poseId, hips); if (!targets) return;
      legSolve = { left: solveLegFixed(hips.left, targets.feet.left, targets.poles.left), right: solveLegFixed(hips.right, targets.feet.right, targets.poles.right) };
      applySolvedLeg('left', hips.left, legSolve.left); applySolvedLeg('right', hips.right, legSolve.right);
      handPose = handTargets(runtime.poseId, shoulders, legSolve);
    }
    if (!handPose) return;
    const armSolve = { left: solveArm(shoulders.left, handPose.left.target, handPose.left.pole), right: solveArm(shoulders.right, handPose.right.target, handPose.right.pole) };
    for (const side of ['left', 'right']) { placeRealHand(side, shoulders[side], armSolve[side]); drawSide(side, shoulders[side], armSolve[side], hips[side], legSolve[side]); }
    updateTorsoGuide(); setHandsVisible(true); setGuidesVisible(true);
    runtime.lastSolve = { arms: armSolve, legs: legSolve };
    runtime.lastDebug = {
      identity: `${runtime.speciesId}::${runtime.gender}`, pose: runtime.poseId,
      ownership: runtime.poseId === 'carryUpright' ? 'hands/object only; legacy body + gait authoritative' : 'ground body + existing leg chain; legacy playback paused',
      armConstruction: 'shoulder → hand span first; then subdivide at upperArmFraction; elbow bends subdivision toward pole',
      armSpans: Object.fromEntries(['left', 'right'].map(side => [side, { shoulderToHand: armSolve[side].requestedDistance, bicep: armSolve[side].upperLength, forearm: armSolve[side].lowerLength }])),
      legLengthSource: runtime.anatomy.legLengthSource,
      hands: runtime.handRig?.getDebug?.() || null,
    };
  }

  function renderDebug() {
    const pre = document.getElementById('limbPoseDebug'); if (!pre) return;
    if (runtime.poseId === 'normal') pre.textContent = JSON.stringify({ identity: `${runtime.speciesId}::${runtime.gender}`, pose: 'normal', ownership: 'none' }, null, 2);
    else pre.textContent = runtime.lastDebug ? JSON.stringify(runtime.lastDebug, null, 2) : 'Waiting for avatar…';
  }
  function animationLoop(now) {
    try { updatePoseFrame(now); } catch (error) { runtime.lastDebug = { pose: runtime.poseId, error: String(error?.stack || error) }; }
    if (Math.floor(now / 250) !== Math.floor((now - 16) / 250)) renderDebug();
    requestAnimationFrame(animationLoop);
  }

  function numberField(id, label, min, max, step) { return `<div><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}"></div>`; }
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `#${PANEL_ID}:not([open]){display:none!important}#${PANEL_ID}[open]{position:absolute!important;z-index:12;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));width:min(490px,calc(100vw - 16px));display:grid!important;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:15px;background:rgba(7,16,26,.985);box-shadow:0 22px 70px rgba(0,0,0,.62)}#${PANEL_ID}>summary{min-height:48px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.12);cursor:pointer;font-weight:850}#${PANEL_ID} .limbPoseBody{min-height:0;overflow:auto;padding:10px;display:grid;gap:10px}#${PANEL_ID} .limbPoseGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#${PANEL_ID} .full{grid-column:1/-1}#${PANEL_ID} .limbPoseCard{border:1px solid rgba(255,255,255,.11);border-radius:12px;padding:9px;background:rgba(255,255,255,.035)}#${PANEL_ID} .limbPoseCard h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;color:var(--muted)}#${PANEL_ID} .limbPoseActions{display:flex;gap:7px;flex-wrap:wrap}#${PANEL_ID} .limbPoseActions button{flex:1 1 120px}#${PANEL_ID} pre{max-height:180px;font-size:10px}@media(max-width:700px){#${PANEL_ID}[open]{top:auto;right:max(4px,env(safe-area-inset-right));left:max(4px,env(safe-area-inset-left));bottom:max(4px,env(safe-area-inset-bottom));width:auto;height:min(58dvh,650px)}}`;
    document.head.appendChild(style);
  }
  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);
    injectStyles();
    const panel = document.createElement('details'); panel.id = PANEL_ID;
    panel.innerHTML = `<summary>Ground / Carry / Manual IK</summary><div class="limbPoseBody">
      <div class="limbPoseCard"><h3>Mode</h3><div class="limbPoseGrid"><div class="full"><label for="limbPoseSelect">Pose mode</label><select id="limbPoseSelect">${Object.entries(POSE_LABELS).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></div><div class="full"><label><input id="limbPoseShowGuides" type="checkbox" checked> Show limb guides</label></div></div><div class="authorHelp">Normal owns nothing. Manual IK pauses procedural playback and lets you grab hands, feet, elbows, and knees directly in the viewport.</div></div>
      <div class="limbPoseCard"><h3>Manual IK</h3><div class="limbPoseActions"><button id="limbManualStart" class="good" type="button">Edit current pose manually</button><button id="limbManualResume" class="secondary" type="button">Resume IK</button><button id="limbManualPhysics" class="secondary" type="button">Release pose to Physics</button></div><div class="authorHelp">Colored spheres are draggable targets. Hands/feet are end effectors; elbows/knees are exact joint handles. Releasing freezes the pose and opens the existing Impact/physics authoring controls; physics is not turned on automatically.</div></div>
      <div class="limbPoseCard"><h3>Species + gender anatomy</h3><div id="limbPoseIdentity" class="small muted"></div><div class="limbPoseGrid">${numberField('limbUpperArmFraction','Bicep share of shoulder→hand span',0.35,0.68,0.01)}${numberField('limbUpperArmRadius','Upper-arm radius · height fraction',0.015,0.12,0.001)}${numberField('limbForearmRadius','Forearm radius · height fraction',0.012,0.10,0.001)}${numberField('limbThighRadius','Thigh radius · height fraction',0.02,0.14,0.001)}${numberField('limbCalfRadius','Calf radius · height fraction',0.015,0.12,0.001)}${numberField('limbTorsoRadius','Torso radius · height fraction',0.06,0.30,0.002)}</div><div class="authorHelp">Arms are no longer measured from a standing free-hand anchor. Each frame starts with the actual shoulder→hand bone, subdivides that span, then applies the elbow bend.</div></div>
      <div class="limbPoseCard"><h3>Heavy upright object</h3><div class="limbPoseGrid">${numberField('limbCarryWeight','Weight',0,1,0.01)}${numberField('limbCarryAwkwardness','Awkwardness',0,1,0.01)}${numberField('limbCarryHeight','Object height · avatar height',0.3,1.4,0.01)}${numberField('limbCarryWidth','Object width · avatar width',0.25,1.1,0.01)}</div><div class="limbPoseActions"><button id="limbApplyCarryMovement" class="good" type="button">Apply heavy carry walk</button></div></div>
      <div class="limbPoseActions"><button id="limbResetPose" class="secondary" type="button">Return to Normal</button><button id="limbDownloadJson" class="secondary" type="button">Download pose JSON</button></div><div class="limbPoseCard"><h3>Mobile debug</h3><pre id="limbPoseDebug">Waiting for avatar…</pre></div></div>`;
    return panel;
  }
  function addQuickButton(panel) {
    const row = document.querySelector('#animationHud .animationHudActions'); if (!row || document.getElementById('limbPoseQuickBtn')) return;
    const button = document.createElement('button'); button.id = 'limbPoseQuickBtn'; button.type = 'button'; button.className = 'secondary'; button.textContent = 'Ground / Carry';
    button.addEventListener('click', () => { panel.open = !panel.open; button.classList.toggle('active', panel.open); }); panel.addEventListener('toggle', () => button.classList.toggle('active', panel.open)); row.appendChild(button);
  }
  function attachPanel(panel) {
    const root = runtime.backdrop?.modalRoot || document.getElementById('gameModalOverlayRoot'); if (!root) return;
    if (!root.contains(panel)) root.appendChild(panel); new MutationObserver(() => { if (!root.contains(panel)) root.appendChild(panel); }).observe(root, { childList: true });
  }
  function sliderValue(id, fallback) { const value = Number(document.getElementById(id)?.value); return Number.isFinite(value) ? value : fallback; }
  function syncInputs() {
    const a = runtime.anatomy; if (!a) return;
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.value=Number(v).toFixed(3); };
    set('limbUpperArmFraction',a.upperArmFraction); set('limbUpperArmRadius',a.upperArmRadiusHeightFraction); set('limbForearmRadius',a.forearmRadiusHeightFraction); set('limbThighRadius',a.thighRadiusHeightFraction); set('limbCalfRadius',a.calfRadiusHeightFraction); set('limbTorsoRadius',a.torsoRadiusHeightFraction);
    set('limbCarryWeight',runtime.carryWeight); set('limbCarryAwkwardness',runtime.carryAwkwardness); set('limbCarryHeight',runtime.carryObjectHeightFraction); set('limbCarryWidth',runtime.carryObjectWidthFraction);
    const select=document.getElementById('limbPoseSelect'); if(select) select.value=runtime.poseId; const guides=document.getElementById('limbPoseShowGuides'); if(guides) guides.checked=runtime.showGuides;
    const identity=document.getElementById('limbPoseIdentity'); if(identity) identity.textContent=`${runtime.speciesId} · ${runtime.gender} · arms: live shoulder→hand subdivision · leg ${(a.upperLegLength+a.lowerLegLength).toFixed(3)} (${a.legLengthSource})`;
  }
  function readAnatomyInputs() {
    const values = {
      upperArmFraction: clamp(sliderValue('limbUpperArmFraction', runtime.anatomy?.upperArmFraction || .52), .35, .68),
      upperArmRadiusHeightFraction: clamp(sliderValue('limbUpperArmRadius', runtime.anatomy?.upperArmRadiusHeightFraction || .045), .015, .12),
      forearmRadiusHeightFraction: clamp(sliderValue('limbForearmRadius', runtime.anatomy?.forearmRadiusHeightFraction || .038), .012, .10),
      thighRadiusHeightFraction: clamp(sliderValue('limbThighRadius', runtime.anatomy?.thighRadiusHeightFraction || .065), .02, .14),
      calfRadiusHeightFraction: clamp(sliderValue('limbCalfRadius', runtime.anatomy?.calfRadiusHeightFraction || .052), .015, .12),
      torsoRadiusHeightFraction: clamp(sliderValue('limbTorsoRadius', runtime.anatomy?.torsoRadiusHeightFraction || .155), .06, .30),
    };
    writeStoredProfile(values); runtime.anatomy = resolvedAnatomy(); syncInputs();
  }

  function setPose(nextPoseId) {
    const next = POSE_LABELS[nextPoseId] ? nextPoseId : 'normal', previous = runtime.poseId;
    const manualSeed = next === 'manual' ? seedFromLastSolve() : null;
    if (previous === 'manual') runtime.manual?.stop?.();
    if (previous !== 'normal') restoreBaseline();
    if (previous === 'carryUpright' && next !== 'carryUpright') restoreMovementInputs();
    if (runtime.carryObject) runtime.carryObject.visible = false;
    setHandsVisible(false); setGuidesVisible(false); runtime.priorLocomotionWorldPosition = null; runtime.priorTime = performance.now(); runtime.poseId = next; runtime.lastSolve = null;
    if (next === 'normal') runtime.lastDebug = { identity: `${runtime.speciesId}::${runtime.gender}`, pose: 'normal', ownership: 'none' };
    else if (next === 'carryUpright') {
      captureMovementInputs(); for (const [id,value] of Object.entries(CARRY_MOVEMENT)) dispatchMovementValue(id,value); runtime.backdrop?.setMovementPlayback?.(true);
      const badge=document.getElementById('animationPresetBadge'); if(badge) badge.textContent='Heavy upright carry';
    } else {
      captureBaseline(); runtime.backdrop?.setMovementPlayback?.(false);
      if (next === 'manual') startManual(manualSeed).catch(error => { runtime.lastDebug={ pose:'manual', error:String(error?.stack||error) }; });
    }
    const select=document.getElementById('limbPoseSelect'); if(select) select.value=next; renderDebug(); return next;
  }
  function applyCarryMovement() { setPose('carryUpright'); }
  function resetPose() { setPose('normal'); }

  function exportObject() {
    return {
      schema: 'hobunji-procedural-limb-pose-library.v3', speciesId: runtime.speciesId, gender: runtime.gender,
      anatomy: { ...readStoredProfile(), computed: { armLengthSource: runtime.anatomy?.armLengthSource || null, upperArmFraction: runtime.anatomy?.upperArmFraction || null, upperLegLength: runtime.anatomy?.upperLegLength || null, lowerLegLength: runtime.anatomy?.lowerLegLength || null, legLengthSource: runtime.anatomy?.legLengthSource || null } },
      currentPose: runtime.poseId,
      manual: runtime.manual?.snapshot?.() || null,
      groundPoseIds: Object.keys(POSE_LABELS).filter(id => !['normal','manual','carryUpright'].includes(id)),
      carryUpright: { movement: CARRY_MOVEMENT, weight: runtime.carryWeight, awkwardness: runtime.carryAwkwardness, objectHeightFraction: runtime.carryObjectHeightFraction, objectWidthFraction: runtime.carryObjectWidthFraction, objectDepthFraction: runtime.carryObjectDepthFraction, bodyOwnership: 'legacy procedural animator' },
      armSolver: 'LegBones.solveSubdividedChain: shoulder→hand span first, then elbow subdivision',
      automaticLegSolver: 'LegBones.solveFixedTwoBoneChain', manualSolver: 'LegBones.solveSubdividedChain with exact dragged joints',
    };
  }
  function downloadExport() {
    const blob=new Blob([JSON.stringify(exportObject(),null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url; link.download=`hobunji_limb_pose_${runtime.speciesId}_${runtime.gender}.json`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function wirePanel(panel) {
    if (panel.dataset.limbPoseWired === 'true') return; panel.dataset.limbPoseWired='true';
    document.getElementById('limbPoseSelect').addEventListener('change',e=>setPose(e.target.value));
    document.getElementById('limbPoseShowGuides').addEventListener('change',e=>{runtime.showGuides=Boolean(e.target.checked);setGuidesVisible(runtime.poseId!=='normal');});
    for (const id of ['limbUpperArmFraction','limbUpperArmRadius','limbForearmRadius','limbThighRadius','limbCalfRadius','limbTorsoRadius']) document.getElementById(id).addEventListener('change',readAnatomyInputs);
    for (const [id,key,min,max] of [['limbCarryWeight','carryWeight',0,1],['limbCarryAwkwardness','carryAwkwardness',0,1],['limbCarryHeight','carryObjectHeightFraction',.3,1.4],['limbCarryWidth','carryObjectWidthFraction',.25,1.1]]) document.getElementById(id).addEventListener('input',()=>{runtime[key]=clamp(sliderValue(id,runtime[key]),min,max);const state=savedState();state.carry={weight:runtime.carryWeight,awkwardness:runtime.carryAwkwardness,height:runtime.carryObjectHeightFraction,width:runtime.carryObjectWidthFraction,depth:runtime.carryObjectDepthFraction};saveState(state);});
    document.getElementById('limbApplyCarryMovement').addEventListener('click',applyCarryMovement); document.getElementById('limbResetPose').addEventListener('click',resetPose); document.getElementById('limbDownloadJson').addEventListener('click',downloadExport);
    document.getElementById('limbManualStart').addEventListener('click',()=>setPose('manual')); document.getElementById('limbManualResume').addEventListener('click',resumeManual); document.getElementById('limbManualPhysics').addEventListener('click',releaseManualToPhysics);
  }
  function readCarryState() {
    const carry=savedState().carry||{}; runtime.carryWeight=clamp(carry.weight??runtime.carryWeight,0,1); runtime.carryAwkwardness=clamp(carry.awkwardness??runtime.carryAwkwardness,0,1); runtime.carryObjectHeightFraction=clamp(carry.height??runtime.carryObjectHeightFraction,.3,1.4); runtime.carryObjectWidthFraction=clamp(carry.width??runtime.carryObjectWidthFraction,.25,1.1); runtime.carryObjectDepthFraction=clamp(carry.depth??runtime.carryObjectDepthFraction,.1,.8);
  }

  async function attachCurrentAvatar() {
    if (runtime.poseId !== 'normal') resetPose();
    runtime.backdrop=window.HobunjiGameplayBackdrop; runtime.model=runtime.backdrop?.getAvatarModel?.()||null;
    if (!runtime.model || runtime.backdrop?.getPreviewMode?.() !== 'npc') return;
    const identity=selectedIdentity(); runtime.speciesId=identity.speciesId; runtime.gender=identity.gender;
    runtime.modelHeight=Number(runtime.model.userData?.portraitModelHeight)||Number(runtime.model.userData?.gameModelHeight)||.9; runtime.modelWidth=Number(runtime.model.userData?.portraitModelWidth)||runtime.modelHeight; runtime.floorLift=Number(runtime.model.userData?.gameGrounding?.avatarHeightHalfLift)||runtime.modelHeight/2;
    runtime.poseRoot=runtime.model.parent||null; runtime.avatarLiftRoot=runtime.poseRoot?.parent||null; runtime.locomotionRoot=runtime.avatarLiftRoot?.parent||null; if(!runtime.poseRoot||!runtime.locomotionRoot)return;
    const profile=profileForIdentity(runtime.speciesId,runtime.gender); runtime.posteriorY=posteriorYFor(profile,runtime.modelHeight,runtime.model); runtime.feetRig=discoverFeetRig(); runtime.anatomy=resolvedAnatomy();
    runtime.manual?.dispose?.(); runtime.manual=null; runtime.manualCreating=null; runtime.handRig?.dispose?.();
    runtime.handRig=window.ProceduralHandAttachments?.attach?.(runtime.handThree||runtime.THREE,runtime.poseRoot,{name:'procedural_pose_author',avatarRoot:runtime.model,speciesId:runtime.speciesId,gender:runtime.gender,modelHeight:runtime.modelHeight,bodyColors:identity.bodyColors})||null;
    ensureGuideRoot(); setHandsVisible(false); setGuidesVisible(false); runtime.poseId='normal'; runtime.baseline=null; runtime.movementBaseline=null; runtime.lastSolve=null; syncInputs();
    runtime.lastDebug={attached:`${runtime.speciesId}::${runtime.gender}`,pose:'normal',ownership:'none',handRig:Boolean(runtime.handRig),armConstruction:'dynamic shoulder→hand subdivision'}; renderDebug();
  }
  function openPanel() { const panel=document.getElementById(PANEL_ID); if(panel){panel.open=true;runtime.pendingOpen=false;document.getElementById('limbPoseQuickBtn')?.classList.add('active');return true;}runtime.pendingOpen=true;return false; }

  async function start() {
    await ensureDependencies();
    runtime.backdrop=await new Promise(resolve=>{if(window.HobunjiGameplayBackdrop)return resolve(window.HobunjiGameplayBackdrop);window.addEventListener('hobunji-backdrop-api-ready',e=>resolve(e.detail||window.HobunjiGameplayBackdrop),{once:true});});
    readCarryState(); const panel=buildPanel(); attachPanel(panel); addQuickButton(panel); wirePanel(panel); await attachCurrentAvatar();
    window.addEventListener('hobunji-backdrop-avatar-changed',()=>setTimeout(()=>attachCurrentAvatar().catch(console.error),0));
    window.addEventListener('hobunji-backdrop-creature-changed',()=>{if(runtime.poseId!=='normal')resetPose();runtime.manual?.dispose?.();runtime.manual=null;runtime.handRig?.dispose?.();runtime.handRig=null;disposeGuideRoot();runtime.model=null;});
    requestAnimationFrame(animationLoop); if(runtime.pendingOpen)openPanel(); console.info('[Limb pose author] Ground/rest + carry + manual IK ready in Normal/no-ownership mode.');
  }

  window.HobunjiProceduralLimbPoseAuthor = {
    version: 3, openPanel, setPose, getDebug:()=>runtime.lastDebug, getExport:exportObject, refreshAvatar:attachCurrentAvatar,
    applyCarryMovement, enterManual:()=>setPose('manual'), releaseManualToPhysics, resumeManual, resetPose,
  };

  start().catch(error=>{console.error('[Limb pose author] Failed to initialize:',error);runtime.lastDebug={initializationError:String(error?.stack||error)};});
})();
