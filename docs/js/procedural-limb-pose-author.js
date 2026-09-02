// Procedural Animation Editor extension: species-aware ground/rest limb posing
// and a two-hand awkward-upright carry overlay.
//
// Integration rule: while Pose = Normal this extension owns no avatar transform,
// feet, hands, or movement settings. Ground poses pause the legacy animator and
// compose from its captured transform; heavy carry leaves the legacy body/gait
// animator in charge and only adds hand/object targets plus temporary movement
// slider values.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbPoseAuthor) return;

  const SCRIPT_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null; // Resolves branch-paired dependencies from this adapter's own URL.
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL) : new URL('../../', location.href); // Shared docs root used for anatomy, solver, and hand modules.
  const STORAGE_KEY = 'hobunji.proceduralLimbPoseAuthor.v2'; // Persists only authoring thickness/carry values, never active ownership state.
  const PANEL_ID = 'proceduralLimbPosePanel'; // Stable modal id reused across preview UI rebuilds.
  const STYLE_ID = 'proceduralLimbPoseStyles'; // Prevents duplicate CSS if adapters execute twice.
  const GUIDE_ROOT_NAME = 'ProceduralLimbPoseGuides'; // Stable scene name used to isolate/dispose author-only helpers.
  const CARRY_OBJECT_NAME = 'ProceduralCarryObjectProxy'; // Stable debug name for the author-only heavy-object proxy.

  const POSE_LABELS = Object.freeze({ // Drives both the selector and exported normalized pose ids.
    normal: 'Normal animator (off)',
    crossLegged: 'Cross-legged',
    kneel: 'Kneeling',
    sideLeanLeft: 'Side lean · left',
    sideLeanRight: 'Side lean · right',
    lieSideLeft: 'Lie on side · left',
    lieSideRight: 'Lie on side · right',
    lieBack: 'Lie on back',
    carryUpright: 'Walk · keep heavy object upright',
  });

  const CARRY_MOVEMENT = Object.freeze({ // Existing movement controls temporarily receive these values while heavy carry is active.
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

  const runtime = { // Mutable adapter state shared by UI events and the animation-frame update.
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
    lastDebug: null,
    pendingOpen: false,
  };

  function normalizeSpecies(value) { // Matches attachment-rig/profile keys when reading the currently selected NPC.
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) { // Maps all authoring records to canonical male/female rig keys.
    return String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male';
  }

  function clamp(value, min, max) { // Bounds sliders, persisted values, and IK-derived ratios before they reach Three.js transforms.
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function loadScript(relativePath, ready) { // Loads one branch-paired dependency once and verifies its expected global afterward.
    if (ready?.()) return Promise.resolve();
    const src = new URL(relativePath, DOCS_BASE).href; // Absolute URL lets duplicate checks survive GitHack/query-string execution.
    const existing = [...document.scripts].find(script => script.src === src); // Existing request reused rather than duplicated.
    if (existing) return new Promise((resolve, reject) => {
      if (ready?.()) return resolve();
      existing.addEventListener('load', () => ready?.() ? resolve() : reject(new Error(`Loaded ${relativePath} without expected API`)), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${relativePath}`)), { once: true });
    });
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); // Dependency element appended to the tool document head.
      script.src = src;
      script.onload = () => ready?.() ? resolve() : reject(new Error(`Loaded ${relativePath} without expected API`));
      script.onerror = () => reject(new Error(`Failed to load ${relativePath}`));
      document.head.appendChild(script);
    });
  }

  async function ensureDependencies() { // Makes anatomy, fixed IK, and direct hand attachments available before constructing a pose rig.
    await loadScript('config/procedural-anatomy-profiles.js?v=20260902c', () => Boolean(window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES));
    await loadScript('js/leg-bones.js?v=20260902c', () => typeof window.LegBones?.solveFixedTwoBoneChain === 'function');
    await loadScript('config/hand-model-profiles.js?v=20260902c', () => Boolean(window.HobunjiHandModelProfiles));
    await loadScript('js/procedural-hand-attachments.js?v=20260902c', () => Boolean(window.ProceduralHandAttachments));
    if (!window.PNGPlaneAvatar?.loadThreeModules) throw new Error('PNGPlaneAvatar.loadThreeModules is unavailable.');
    const modules = await window.PNGPlaneAvatar.loadThreeModules(); // Returns the exact Three.js module instance used by this preview.
    runtime.THREE = modules.THREE;
    const configuredThreeUrl = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.threeModuleUrl || 'https://esm.sh/three@0.165.0'; // Keeps GLTFLoader on the preview's Three.js version.
    const version = configuredThreeUrl.match(/three@([0-9.]+)/)?.[1] || '0.165.0'; // Version used only for the optional hand GLB loader import.
    try {
      const loaderModule = await import(`https://esm.sh/three@${version}/examples/jsm/loaders/GLTFLoader.js?deps=three@${version}`); // GLTFLoader paired to the exact preview Three.js version.
      runtime.handThree = Object.assign({}, runtime.THREE, { GLTFLoader: loaderModule.GLTFLoader });
    } catch (error) {
      runtime.handThree = runtime.THREE;
      console.warn('[Limb pose author] GLTFLoader unavailable; generated hand fallback remains usable.', error);
    }
  }

  function selectedIdentity() { // Extracts species/gender/body colors from the public selected NPC record.
    const npc = runtime.backdrop?.getSelectedNpc?.() || {}; // Current preview NPC returned through the editor API.
    const appearance = npc.appearance || npc.fighter?.appearance || npc.profile?.fighter || npc; // Covers current and legacy NPC export shapes.
    return {
      speciesId: normalizeSpecies(appearance.speciesId || appearance.species || npc.speciesId || npc.species || 'mao-ao'),
      gender: normalizeGender(appearance.gender || npc.gender || 'male'),
      bodyColors: appearance.bodyColors || npc.bodyColors || {},
    };
  }

  function profileForIdentity(speciesId, gender) { // Reads the canonical attachment-rig shoulder/posterior/anatomy record.
    const aliases = window.HOBUNJI_TRANSFORM_SPECIES_ALIASES || {}; // Ghoul/Rakakoan aliases remain live-linked to their canonical parent rigs.
    const canonicalSpecies = aliases[speciesId] || speciesId; // Parent transform key used only when a direct alias profile is absent.
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Canonical source of shoulder/posterior/arm-length data.
    return characters[`${speciesId}::${gender}`] || characters[`${canonicalSpecies}::${gender}`] || null;
  }

  function posteriorYFor(profile, modelHeight, model) { // Resolves the same floor-relative posterior used by runtime legs and chair seating.
    const resolved = Number(profile?.resolvedPosteriorPosition?.y); // Preferred live value when an authoring tool has published one.
    if (Number.isFinite(resolved)) return resolved;
    const rule = profile?.posteriorRule || {}; // Current v9+ profile rule or legacy offset rule.
    const percentFromFloor = Number(rule.heightPercentFromFloor); // Direct floor-relative percentage when authored.
    if (Number.isFinite(percentFromFloor)) return modelHeight * percentFromFloor / 100;
    const handAttachY = Number(model?.userData?.handAttachY); // Legacy reference shared with runtime hand/posterior math.
    const shared = window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(rule, modelHeight, handAttachY); // Canonical legacy resolver when available.
    if (Number.isFinite(shared)) return shared;
    const offset = Number(rule.heightPercentOffset); // Last-resort old-profile vertical offset.
    return (Number.isFinite(handAttachY) ? handAttachY : modelHeight / 2) + modelHeight * (Number.isFinite(offset) ? offset : -18) / 100;
  }

  function shoulderFloorPoint(profile, side) { // Returns one canonical floor-relative shoulder target from attachment-rig-profiles.js.
    const anchorName = side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder'; // Maps author side to the existing rig anchor name.
    const position = profile?.anchors?.[anchorName]?.position; // Authored floor-relative shoulder coordinate used by runtime hands.
    if (![position?.x, position?.y, position?.z].every(value => Number.isFinite(Number(value)))) return null;
    return { x: Number(position.x), y: Number(position.y), z: Number(position.z) };
  }

  function savedState() { // Reads tool-only tuning while tolerating stale/corrupt local storage.
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  function saveState(next) { // Persists authoring values without persisting pose ownership across reloads.
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
  }

  function readStoredProfile(speciesId, gender) { // Returns only radius/elbow overrides for the current species+gender key.
    return savedState().anatomy?.[`${speciesId}::${gender}`] || {};
  }

  function writeStoredProfile(values) { // Saves current anatomy fields under the displayed species+gender key.
    const state = savedState(); // Existing tuning retained for other species and carry settings.
    state.anatomy = state.anatomy || {};
    state.anatomy[`${runtime.speciesId}::${runtime.gender}`] = values;
    saveState(state);
  }

  function walkObjects(root, visitor) { // Small traversal helper works with Three.js traverse() or plain child arrays in test/debug harnesses.
    if (!root) return;
    if (typeof root.traverse === 'function') { root.traverse(visitor); return; }
    visitor(root);
    for (const child of root.children || []) walkObjects(child, visitor);
  }

  function findNamedObject(root, names) { // Locates existing runtime/editor leg nodes without assuming they are direct children.
    const wanted = new Set(names.map(name => String(name).toLowerCase())); // Lower-case names permit editor/runtime capitalization differences.
    let found = null; // First matching object is returned after one traversal.
    walkObjects(root, object => {
      if (!found && wanted.has(String(object?.name || '').toLowerCase())) found = object;
    });
    return found;
  }

  function discoverFeetRig() { // Reuses the real procedural hip→thigh→calf→foot hierarchy instead of moving a duplicate/direct foot proxy.
    const root = runtime.locomotionRoot; // Existing preview locomotion subtree containing procedural legs/feet.
    if (!root) return null;
    const sides = {};
    for (const side of ['left', 'right']) {
      const hip = findNamedObject(root, [`${side}_hip`, `${side}Hip`]); // Runtime procedural-leg-animation canonical hip.
      const thigh = hip ? findNamedObject(hip, [`${side}_thigh`, `${side}Thigh`]) : findNamedObject(root, [`${side}_thigh`, `${side}Thigh`]); // Existing upper-bone pivot.
      const calf = thigh ? findNamedObject(thigh, [`${side}_calf`, `${side}Calf`]) : findNamedObject(root, [`${side}_calf`, `${side}Calf`]); // Existing lower-bone pivot.
      const foot = calf ? findNamedObject(calf, [`${side}_foot`, `${side}Foot`]) : findNamedObject(root, [`${side}_foot`, `${side}Foot`, `${side}FootMesh`]); // Existing real foot visual, including editor capitalization.
      sides[side] = { hip, thigh, calf, foot }; // Side record is used by baseline capture, posing, and carry diagnostics.
    }
    const feetRoot = sides.left.hip?.parent || sides.right.hip?.parent || sides.left.foot?.parent || sides.right.foot?.parent || null; // Shared procedural-feet root when available.
    return { root: feetRoot, ...sides };
  }

  function objectPointInLocomotion(object) { // Converts an existing object's local origin into locomotion-root coordinates.
    if (!object || !runtime.locomotionRoot) return null;
    const point = new runtime.THREE.Vector3(); // Temporary origin transformed from object world into locomotion local.
    object.updateWorldMatrix?.(true, false);
    object.getWorldPosition?.(point);
    runtime.locomotionRoot.updateWorldMatrix?.(true, false);
    runtime.locomotionRoot.worldToLocal(point);
    return point;
  }

  function contactYForSide(side) { // Matches runtime seated-leg anatomy: posterior-to-foot-contact defines fixed full leg length.
    const analysis = runtime.model?.userData?.experimentalFeet || {}; // Editor metadata may expose exact contact radii/targets.
    const named = Number(analysis[`${side}ContactY`]); // Per-side contact height, when published.
    if (Number.isFinite(named)) return named;
    const shared = Number(analysis.contactRadiusY); // Older editor metadata exposed one shared contact radius.
    if (Number.isFinite(shared)) return shared;
    const footRadius = Number(runtime.feetRig?.[side]?.foot?.userData?.contactRadiusY); // Runtime procedural-foot mesh stores its local bottom offset here.
    if (Number.isFinite(footRadius)) return footRadius;
    return runtime.modelHeight * 0.025; // Conservative fallback for future/unrecognized foot assemblies.
  }

  function resolvedAnatomy(profile) { // Combines canonical arm/leg lengths with editable elbow split and thickness ratios.
    const tuned = window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES?.resolve?.(runtime.speciesId, runtime.gender) || {}; // Canonical per-species/gender thickness defaults.
    const stored = readStoredProfile(runtime.speciesId, runtime.gender); // User-authored local overrides for the displayed species.
    const settings = { ...tuned, ...stored }; // Complete settings shown by the UI/export.
    const leftShoulder = shoulderFloorPoint(profile, 'left'); // One canonical shoulder for total-arm measurement.
    const rightShoulder = shoulderFloorPoint(profile, 'right'); // Other shoulder; averaging tolerates authored asymmetry.
    const armOffset = Number(profile?.anatomy?.armLengthHeightPercentOffset) || 0; // Existing arm-length extension below posterior.
    const freeHandY = runtime.posteriorY - runtime.modelHeight * armOffset / 100; // Matches procedural-hand-shoulder-aim.js's free-hand anchor.
    const armLengths = [leftShoulder, rightShoulder].filter(Boolean).map(shoulder => Math.hypot(shoulder.y - freeHandY, shoulder.z)); // Shoulder X is intentionally omitted because free-hand X equals that shoulder's X.
    const totalArmLength = armLengths.length ? armLengths.reduce((sum, value) => sum + value, 0) / armLengths.length : runtime.modelHeight * 0.36; // Proportional fallback for unauthored future species.
    const upperArmFraction = clamp(settings.upperArmFraction ?? 0.52, 0.35, 0.68); // Editable elbow split while preserving total arm length.
    const legLengths = ['left', 'right'].map(side => Math.max(runtime.modelHeight * 0.20, runtime.posteriorY - contactYForSide(side))); // Exact same posterior→contact anatomy rule used by runtime seated legs.
    const totalLegLength = legLengths.reduce((sum, value) => sum + value, 0) / legLengths.length; // Symmetric fixed length averaged across left/right contact meshes.
    return {
      ...settings,
      totalArmLength,
      upperArmLength: totalArmLength * upperArmFraction,
      forearmLength: totalArmLength * (1 - upperArmFraction),
      upperLegLength: totalLegLength * 0.5,
      lowerLegLength: totalLegLength * 0.5,
      upperArmRadius: runtime.modelHeight * Number(settings.upperArmRadiusHeightFraction || 0.045),
      forearmRadius: runtime.modelHeight * Number(settings.forearmRadiusHeightFraction || 0.038),
      thighRadius: runtime.modelHeight * Number(settings.thighRadiusHeightFraction || 0.065),
      calfRadius: runtime.modelHeight * Number(settings.calfRadiusHeightFraction || 0.052),
      torsoRadius: runtime.modelHeight * Number(settings.torsoRadiusHeightFraction || 0.155),
      armLengthSource: profile ? 'attachment-rig shoulder → posterior/free-hand anchor' : 'model-height fallback',
      legLengthSource: 'runtime posterior → procedural-foot contact',
    };
  }

  function snapshotTransform(object) { // Captures one exact existing transform so ground-pose ownership can be reversed cleanly.
    if (!object) return null;
    return { object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() };
  }

  function restoreSnapshot(snapshot) { // Restores only still-live objects; preview rebuilds discard stale snapshots naturally.
    const object = snapshot?.object; // Original Three.js node captured before Ground / Carry took ownership.
    if (!object?.parent && object !== runtime.poseRoot) return;
    object.position.copy(snapshot.position);
    object.quaternion.copy(snapshot.quaternion);
    object.scale.copy(snapshot.scale);
    object.updateMatrix?.();
    object.updateMatrixWorld?.(true);
  }

  function captureBaseline() { // Captures editor body/leg transforms and standing hip spacing immediately before a ground pose owns them.
    runtime.feetRig = discoverFeetRig();
    const standingHipX = Object.fromEntries(['left', 'right'].map(side => { // Stable pre-pose hip X prevents frame-to-frame feedback after the real hips move.
      const point = objectPointInLocomotion(runtime.feetRig?.[side]?.hip); // Existing species/gender stance after torso-width scanning.
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
    }; // Baseline is never written while Normal is active; it exists only for leaving an authored ground pose safely.
  }

  function restoreBaseline() { // Gives body and existing leg nodes back exactly as they were when this workspace took ownership.
    restoreSnapshot(runtime.baseline?.poseRoot);
    for (const side of ['left', 'right']) {
      const leg = runtime.baseline?.legs?.[side]; // Side-specific snapshot of the actual existing procedural leg chain.
      restoreSnapshot(leg?.hip);
      restoreSnapshot(leg?.thigh);
      restoreSnapshot(leg?.calf);
      restoreSnapshot(leg?.foot);
    }
    runtime.baseline = null;
  }

  function captureMovementInputs() { // Saves pre-carry movement sliders so Reset/Normal can undo the carry preset instead of leaving it behind.
    if (runtime.movementBaseline) return;
    runtime.movementBaseline = {};
    for (const id of Object.keys(CARRY_MOVEMENT)) {
      const input = document.getElementById(id); // Existing procedural animator input that owns this setting.
      if (input) runtime.movementBaseline[id] = input.value;
    }
  }

  function dispatchMovementValue(id, value) { // Updates one existing procedural movement control through its own listener/state path.
    const input = document.getElementById(id); // Existing editor control remains the sole movement-setting authority.
    if (!input) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function restoreMovementInputs() { // Restores only movement fields Ground / Carry actually changed.
    if (!runtime.movementBaseline) return;
    for (const [id, value] of Object.entries(runtime.movementBaseline)) dispatchMovementValue(id, value);
    runtime.movementBaseline = null;
  }

  function setHandsVisible(visible) { // Author-created hand rig is invisible in Normal so it cannot duplicate/fight the editor's normal hand system.
    runtime.handRig?.setSideVisible?.('left', visible);
    runtime.handRig?.setSideVisible?.('right', visible);
  }

  function setGuidesVisible(visible) { // Hides all author-only scene helpers when Normal is active or guide display is disabled.
    if (runtime.guideRoot) runtime.guideRoot.visible = Boolean(visible && runtime.showGuides);
  }

  function poseRootFloorPoint(point) { // Converts floor-relative rig coordinates into the current pose-root's centered local coordinates.
    return new runtime.THREE.Vector3(point.x, point.y - runtime.floorLift, point.z); // AvatarLiftRoot already supplies the model-height half lift.
  }

  function floorPointToLocomotion(point) { // Applies current body pose then converts a floor-relative anchor into locomotion-root coordinates.
    const local = poseRootFloorPoint(point); // Canonical anchor in poseRoot local coordinates before body transform.
    runtime.poseRoot.updateWorldMatrix(true, false);
    runtime.poseRoot.localToWorld(local);
    runtime.locomotionRoot.updateWorldMatrix(true, false);
    runtime.locomotionRoot.worldToLocal(local);
    return local;
  }

  function locomotionPointToParent(point, parent) { // Converts one locomotion-local target to the local space expected by an existing leg node's parent.
    const converted = point.clone(); // Copy prevents callers' solved target vectors from being mutated during coordinate conversion.
    runtime.locomotionRoot.updateWorldMatrix(true, false);
    runtime.locomotionRoot.localToWorld(converted);
    parent.updateWorldMatrix?.(true, false);
    parent.worldToLocal(converted);
    return converted;
  }

  function locomotionQuaternionToParent(quaternion, parent) { // Converts a bone orientation solved in locomotion coordinates into an existing node's parent-local quaternion.
    const spaceWorld = runtime.locomotionRoot.getWorldQuaternion(new runtime.THREE.Quaternion()); // World basis of the solver's coordinate space.
    const desiredWorld = spaceWorld.multiply(quaternion.clone()); // Desired bone orientation in world space.
    const parentWorld = parent.getWorldQuaternion(new runtime.THREE.Quaternion()); // Existing leg parent basis that local quaternion must cancel.
    return parentWorld.invert().multiply(desiredWorld).normalize();
  }

  function makeGuideMaterial(opacity = 0.55) { // Shared transparent guide material; guide visibility is controlled separately by the UI checkbox.
    return new runtime.THREE.MeshBasicMaterial({ color: 0x6ba9ff, transparent: true, opacity, depthTest: false, depthWrite: false });
  }

  function disposeGuideRoot() { // Removes only authoring helpers while leaving avatar, real legs/feet, hands, and editor gizmos intact.
    if (!runtime.guideRoot) return;
    runtime.guideRoot.traverse(child => { child.geometry?.dispose?.(); child.material?.dispose?.(); });
    runtime.guideRoot.parent?.remove(runtime.guideRoot);
    runtime.guideRoot = null;
    runtime.guideMeshes = {};
    runtime.carryObject = null;
  }

  function ensureGuideRoot() { // Builds reusable spheres/cylinders for shoulder/elbow/knee/radius visualization.
    if (runtime.guideRoot?.parent === runtime.locomotionRoot) return;
    disposeGuideRoot();
    const THREE = runtime.THREE; // Three.js constructors used for authoring-only anatomy helpers.
    const root = new THREE.Group(); // Lives beside procedural feet so solved anchors share locomotion coordinates.
    root.name = GUIDE_ROOT_NAME;
    root.renderOrder = 80;
    runtime.locomotionRoot.add(root);
    runtime.guideRoot = root;
    for (const side of ['left', 'right']) {
      for (const joint of ['shoulder', 'elbow', 'hand', 'hip', 'knee', 'foot']) {
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), makeGuideMaterial(joint === 'shoulder' || joint === 'hip' ? 0.7 : 0.5)); // Joint marker later scaled to authored radius.
        sphere.name = `${side}_${joint}_guide`;
        sphere.renderOrder = 80;
        root.add(sphere);
        runtime.guideMeshes[`${side}.${joint}`] = sphere;
      }
      for (const segment of ['upperArm', 'forearm', 'thigh', 'calf']) {
        const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), makeGuideMaterial(0.25)); // Segment proxy later fitted between solved endpoints.
        cylinder.name = `${side}_${segment}_guide`;
        cylinder.renderOrder = 79;
        root.add(cylinder);
        runtime.guideMeshes[`${side}.${segment}`] = cylinder;
      }
    }
    const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), makeGuideMaterial(0.12)); // Clearance proxy centered around the posterior/body core.
    torso.name = 'torso_radius_guide';
    root.add(torso);
    runtime.guideMeshes.torso = torso;
    setGuidesVisible(false);
  }

  function positionSphere(key, point, radius) { // Places/scales one anatomy joint marker in locomotion coordinates.
    const mesh = runtime.guideMeshes[key]; // Existing reusable guide mesh for this side/joint.
    if (!mesh) return;
    mesh.position.copy(point);
    mesh.scale.setScalar(Math.max(0.008, radius));
  }

  function positionSegment(key, a, b, radius) { // Fits one cylinder between solved two-bone endpoints while preserving thickness settings.
    const mesh = runtime.guideMeshes[key]; // Existing reusable guide mesh for this side/segment.
    if (!mesh) return;
    const direction = b.clone().sub(a); // Segment vector used for midpoint, length, and orientation.
    const length = direction.length(); // Physical solved segment length.
    if (length < 1e-6) { mesh.visible = false; return; }
    mesh.visible = true;
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(Math.max(0.006, radius), length, Math.max(0.006, radius));
    mesh.quaternion.setFromUnitVectors(new runtime.THREE.Vector3(0, 1, 0), direction.normalize());
  }

  function bodyPoseFor(poseId) { // Resolves ground-rest torso offset/rotation around the authored posterior.
    const radius = runtime.anatomy.torsoRadius; // Species/gender torso clearance used to keep body art off the ground.
    const h = runtime.modelHeight; // Scales rest offsets consistently across species.
    const poses = {
      crossLegged: { posteriorHeight: radius * 0.92, x: 0, z: 0, pitch: 0, roll: 0 },
      kneel: { posteriorHeight: radius * 1.12, x: 0, z: -h * 0.035, pitch: -6, roll: 0 },
      sideLeanLeft: { posteriorHeight: radius * 1.12, x: -radius * 0.55, z: 0, pitch: 0, roll: 24 },
      sideLeanRight: { posteriorHeight: radius * 1.12, x: radius * 0.55, z: 0, pitch: 0, roll: -24 },
      lieSideLeft: { posteriorHeight: radius * 0.95, x: -radius * 0.28, z: 0, pitch: 0, roll: 82 },
      lieSideRight: { posteriorHeight: radius * 0.95, x: radius * 0.28, z: 0, pitch: 0, roll: -82 },
      lieBack: { posteriorHeight: radius * 0.92, x: 0, z: -h * 0.05, pitch: -82, roll: 0 },
    }; // Carry intentionally absent: the legacy animator owns body/gait throughout heavy carry.
    return poses[poseId] || null;
  }

  function applyGroundBodyPose(poseId) { // Composes rest pitch/roll/offset on top of the exact captured legacy transform; yaw/scale are never zeroed.
    const pose = bodyPoseFor(poseId); // Selected normalized torso rest pose.
    const base = runtime.baseline?.poseRoot; // Exact legacy pose captured before this ground pose took ownership.
    if (!pose || !base || base.object !== runtime.poseRoot) return;
    const horizontalOffset = new runtime.THREE.Vector3(pose.x, 0, pose.z).applyQuaternion(base.quaternion); // Body-space side/forward shift follows the preserved facing direction.
    runtime.poseRoot.position.copy(base.position).add(horizontalOffset);
    runtime.poseRoot.position.y += pose.posteriorHeight - runtime.posteriorY;
    const delta = new runtime.THREE.Quaternion().setFromEuler(new runtime.THREE.Euler(runtime.THREE.MathUtils.degToRad(pose.pitch), 0, runtime.THREE.MathUtils.degToRad(pose.roll), 'YXZ')); // Ground-only local pitch/roll delta.
    runtime.poseRoot.quaternion.copy(base.quaternion).multiply(delta).normalize();
    runtime.poseRoot.scale.copy(base.scale);
    runtime.poseRoot.updateMatrixWorld(true);
  }

  function solveLimb(root, target, upperLength, lowerLength, pole) { // Shared fixed-length solver used for both generated elbows and ground knees.
    return window.LegBones.solveFixedTwoBoneChain(runtime.THREE, { root, target, upperLength, lowerLength, pole });
  }

  function standingHipX(side) { // Uses the pre-pose species stance during ground poses so moving the real hip cannot feed back into next frame's target.
    const captured = Number(runtime.baseline?.standingHipX?.[side]); // Stable hip X captured before Ground / Carry moved any leg node.
    if (Number.isFinite(captured)) return captured;
    const current = objectPointInLocomotion(runtime.feetRig?.[side]?.hip); // Carry/Normal fallback reads the live existing stance without owning it.
    if (current && Number.isFinite(current.x)) return current.x;
    return (side === 'left' ? -1 : 1) * runtime.modelWidth * 0.08;
  }

  function groundTargets(poseId, hips) { // Produces species-scaled foot targets and knee poles for each non-seat rest pose.
    const h = runtime.modelHeight; // Shared species scale basis for normalized rest offsets.
    const floorLeft = contactYForSide('left'); // Left foot center height that keeps its existing visual flush with floor.
    const floorRight = contactYForSide('right'); // Right foot center height that keeps its existing visual flush with floor.
    const side = poseId.endsWith('Right') ? 1 : -1; // Mirroring sign for side-rest poses.
    if (poseId === 'crossLegged') return {
      feet: { left: new runtime.THREE.Vector3(h * 0.12, floorLeft, h * 0.08), right: new runtime.THREE.Vector3(-h * 0.12, floorRight, h * 0.05) },
      poles: { left: new runtime.THREE.Vector3(-h * 0.38, floorLeft + h * 0.08, h * 0.15), right: new runtime.THREE.Vector3(h * 0.38, floorRight + h * 0.08, h * 0.15) },
    };
    if (poseId === 'kneel') return {
      feet: { left: new runtime.THREE.Vector3(hips.left.x, floorLeft, -h * 0.23), right: new runtime.THREE.Vector3(hips.right.x, floorRight, -h * 0.23) },
      poles: { left: new runtime.THREE.Vector3(hips.left.x - h * 0.03, floorLeft + h * 0.07, h * 0.24), right: new runtime.THREE.Vector3(hips.right.x + h * 0.03, floorRight + h * 0.07, h * 0.24) },
    };
    if (poseId.startsWith('sideLean')) return {
      feet: { left: new runtime.THREE.Vector3(-side * h * 0.05, floorLeft, h * 0.22), right: new runtime.THREE.Vector3(side * h * 0.17, floorRight, h * 0.12) },
      poles: { left: new runtime.THREE.Vector3(-h * 0.30, floorLeft + h * 0.11, h * 0.16), right: new runtime.THREE.Vector3(h * 0.30, floorRight + h * 0.11, h * 0.16) },
    };
    if (poseId.startsWith('lieSide')) return {
      feet: { left: new runtime.THREE.Vector3(-h * 0.05, floorLeft, h * 0.28), right: new runtime.THREE.Vector3(h * 0.05, floorRight, h * 0.10) },
      poles: { left: new runtime.THREE.Vector3(-h * 0.16, floorLeft + h * 0.10, h * 0.14), right: new runtime.THREE.Vector3(h * 0.16, floorRight + h * 0.10, h * 0.14) },
    };
    if (poseId === 'lieBack') return {
      feet: { left: new runtime.THREE.Vector3(-h * 0.10, floorLeft, h * 0.33), right: new runtime.THREE.Vector3(h * 0.10, floorRight, h * 0.33) },
      poles: { left: new runtime.THREE.Vector3(-h * 0.13, floorLeft + h * 0.20, h * 0.17), right: new runtime.THREE.Vector3(h * 0.13, floorRight + h * 0.20, h * 0.17) },
    };
    return null;
  }

  function applySolvedLeg(side, hipTarget, solved) { // Writes fixed IK onto the editor/runtime's existing hip→thigh→calf→foot hierarchy.
    const chain = runtime.feetRig?.[side]; // Existing real procedural leg nodes discovered recursively from the preview hierarchy.
    if (!chain || !solved) return false;
    if (chain.hip && chain.thigh && chain.calf && chain.foot) {
      const hipLocal = locomotionPointToParent(hipTarget, chain.hip.parent); // Posed hip converted into the feet root's coordinate space.
      chain.hip.position.copy(hipLocal);
      chain.hip.updateMatrixWorld?.(true);
      chain.thigh.quaternion.copy(locomotionQuaternionToParent(solved.upperQuaternion, chain.thigh.parent));
      chain.calf.position.set(0, -solved.upperLength, 0);
      chain.calf.quaternion.copy(solved.lowerLocalQuaternion);
      chain.foot.position.set(0, -solved.lowerLength, 0);
      chain.foot.rotation.x = 0;
      chain.hip.updateMatrixWorld?.(true);
      return true;
    }
    if (chain.foot?.parent) {
      chain.foot.position.copy(locomotionPointToParent(solved.solvedTarget, chain.foot.parent)); // Compatibility fallback for a future/editor direct-foot assembly.
      chain.foot.updateMatrixWorld?.(true);
      return true;
    }
    return false;
  }

  function handTargets(poseId, shoulders, legSolve) { // Places hands on knees/floor/body while fixed-length generated elbows preserve species anatomy.
    const h = runtime.modelHeight; // Scales pose-specific target offsets.
    const floor = Math.min(contactYForSide('left'), contactYForSide('right')); // Shared support surface for planted hands.
    const torso = runtime.anatomy.torsoRadius; // Keeps resting hands clear of the body proxy.
    if (poseId === 'crossLegged') return {
      left: { target: legSolve.left.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.2, h * 0.015)), pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.20, -h * 0.05, -h * 0.08)) },
      right: { target: legSolve.right.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.2, h * 0.015)), pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.20, -h * 0.05, -h * 0.08)) },
    };
    if (poseId === 'kneel') return {
      left: { target: legSolve.left.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.35, -h * 0.03)), pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.18, -h * 0.03, -h * 0.04)) },
      right: { target: legSolve.right.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.35, -h * 0.03)), pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.18, -h * 0.03, -h * 0.04)) },
    };
    if (poseId.startsWith('sideLean')) {
      const supportLeft = poseId.endsWith('Left'); // Selects the arm that bears body weight against the floor.
      const supportTarget = new runtime.THREE.Vector3((supportLeft ? -1 : 1) * h * 0.29, floor + runtime.anatomy.forearmRadius, h * 0.02); // Palm planted outside torso radius.
      const restTarget = new runtime.THREE.Vector3((supportLeft ? 1 : -1) * torso * 0.25, floor + torso * 1.75, h * 0.08); // Free hand across lap/torso.
      return supportLeft
        ? { left: { target: supportTarget, pole: new runtime.THREE.Vector3(-h * 0.27, floor + h * 0.15, -h * 0.04) }, right: { target: restTarget, pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.15, -h * 0.03, -h * 0.08)) } }
        : { left: { target: restTarget, pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.15, -h * 0.03, -h * 0.08)) }, right: { target: supportTarget, pole: new runtime.THREE.Vector3(h * 0.27, floor + h * 0.15, -h * 0.04) } };
    }
    if (poseId.startsWith('lieSide')) {
      const onLeft = poseId.endsWith('Left'); // Chooses the lower arm whose hand supports the head/upper body.
      const headRest = new runtime.THREE.Vector3((onLeft ? -1 : 1) * h * 0.19, floor + torso * 1.2, -h * 0.02); // Lower hand near head/upper torso.
      const upperRest = new runtime.THREE.Vector3((onLeft ? 1 : -1) * h * 0.04, floor + torso * 1.15, h * 0.14); // Upper hand in front of body.
      return onLeft
        ? { left: { target: headRest, pole: new runtime.THREE.Vector3(-h * 0.26, floor + h * 0.06, 0) }, right: { target: upperRest, pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.14, -h * 0.05, -h * 0.08)) } }
        : { left: { target: upperRest, pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.14, -h * 0.05, -h * 0.08)) }, right: { target: headRest, pole: new runtime.THREE.Vector3(h * 0.26, floor + h * 0.06, 0) } };
    }
    if (poseId === 'lieBack') return {
      left: { target: new runtime.THREE.Vector3(-h * 0.18, floor + runtime.anatomy.forearmRadius, h * 0.02), pole: new runtime.THREE.Vector3(-h * 0.28, floor + h * 0.08, -h * 0.03) },
      right: { target: new runtime.THREE.Vector3(h * 0.18, floor + runtime.anatomy.forearmRadius, h * 0.02), pole: new runtime.THREE.Vector3(h * 0.28, floor + h * 0.08, -h * 0.03) },
    };
    return null;
  }

  function ensureCarryObject() { // Creates one authoring-only proxy box used by the upright carry style.
    if (runtime.carryObject?.parent === runtime.guideRoot) return runtime.carryObject;
    const THREE = runtime.THREE; // Three.js constructors used for proxy geometry/material.
    const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.28, wireframe: true, depthTest: false })); // Asset-agnostic awkward-object stand-in.
    object.name = CARRY_OBJECT_NAME;
    object.renderOrder = 78;
    runtime.guideRoot.add(object);
    runtime.carryObject = object;
    return object;
  }

  function updateCarryPose(now, shoulders) { // Keeps both hands locked to a swaying upright object while legacy locomotion remains authoritative.
    const h = runtime.modelHeight; // Scales object height/forward offset to the selected species.
    const w = runtime.modelWidth; // Scales object width to the selected avatar width.
    const object = ensureCarryObject(); // Authoring proxy whose opposing grips drive both hands.
    const dt = Math.max(0.001, Math.min(0.05, (now - runtime.priorTime) / 1000)); // Stable speed estimate after tab throttling.
    const currentWorld = runtime.locomotionRoot.getWorldPosition(new runtime.THREE.Vector3()); // World locomotion position avoids false zero speed from a root whose local position never changes.
    const priorWorld = runtime.priorLocomotionWorldPosition || currentWorld.clone(); // Previous frame world point used only for carry struggle intensity.
    const speed = currentWorld.distanceTo(priorWorld) / dt; // Approximate movement intensity without reaching into editor-private state.
    runtime.priorLocomotionWorldPosition = currentWorld.clone();
    runtime.priorTime = now;
    const motion = clamp(speed / 2.4, 0, 1); // Normalized walking intensity for counter-sway.
    const time = now / 1000; // Continuous phase source for small balance corrections.
    const swayX = Math.sin(time * 2.15) * h * 0.022 * runtime.carryAwkwardness * (0.35 + motion); // Slow side correction visible even at low speed.
    const swayY = Math.sin(time * 3.05 + 0.7) * h * 0.010 * runtime.carryAwkwardness * motion; // Smaller vertical struggle avoids floaty bob.
    const center = floorPointToLocomotion({ x: swayX, y: runtime.posteriorY + h * 0.12 + swayY, z: h * (0.26 + runtime.carryWeight * 0.05) }); // Object center follows the live legacy body transform.
    object.position.copy(center);
    object.scale.set(w * runtime.carryObjectWidthFraction, h * runtime.carryObjectHeightFraction, w * runtime.carryObjectDepthFraction);
    object.rotation.set(-0.05 * runtime.carryWeight + Math.sin(time * 1.7) * 0.035 * runtime.carryAwkwardness, 0, Math.sin(time * 2.4) * 0.055 * runtime.carryAwkwardness * (0.4 + motion));
    object.visible = true;
    object.updateMatrixWorld(true);
    const leftGrip = new runtime.THREE.Vector3(-0.5, 0.14, 0.52); // High left grip stabilizes the top of the awkward object.
    const rightGrip = new runtime.THREE.Vector3(0.5, -0.12, 0.52); // Low right grip creates asymmetrical heavy-carry posture.
    object.localToWorld(leftGrip);
    object.localToWorld(rightGrip);
    runtime.locomotionRoot.worldToLocal(leftGrip);
    runtime.locomotionRoot.worldToLocal(rightGrip);
    return {
      left: { target: leftGrip, pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.24, h * 0.02, -h * 0.08)) },
      right: { target: rightGrip, pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.24, -h * 0.02, -h * 0.08)) },
      speed,
      motion,
    };
  }

  function placeRealHand(side, shoulder, solved) { // Moves the author-created real/fallback hand to the fixed-length IK endpoint.
    if (!runtime.handRig || !solved) return;
    const handWorld = solved.solvedTarget.clone(); // Locomotion-local endpoint converted below for ProceduralHandAttachments.placeHandWorld().
    runtime.locomotionRoot.localToWorld(handWorld);
    const shoulderWorld = shoulder.clone(); // Same-space shoulder gives the wrist-to-shoulder +Y direction.
    runtime.locomotionRoot.localToWorld(shoulderWorld);
    const quaternion = new runtime.handThree.Quaternion().setFromUnitVectors(new runtime.handThree.Vector3(0, 1, 0), shoulderWorld.clone().sub(handWorld).normalize()); // Direct shoulder-facing hand frame; authored right-hand mirror remains inside visual.
    runtime.handRig.placeHandWorld(side, handWorld, quaternion);
  }

  function updateLimbGuides(side, shoulder, arm, hip, leg) { // Draws radius-aware solved segments/joints for one body side.
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

  function updateTorsoGuide() { // Shows the body-clearance radius that authored limbs should avoid.
    const torso = runtime.guideMeshes.torso; // Reusable author-only sphere proxy.
    if (!torso) return;
    const center = floorPointToLocomotion({ x: 0, y: runtime.posteriorY + runtime.anatomy.torsoRadius * 0.35, z: 0 }); // Core center slightly above posterior.
    torso.position.copy(center);
    torso.scale.set(runtime.anatomy.torsoRadius, runtime.anatomy.torsoRadius * 1.25, runtime.anatomy.torsoRadius * 0.78);
  }

  function updatePoseFrame(now) { // Solves/renders only while an authored pose owns something; Normal returns before touching the avatar.
    if (runtime.poseId === 'normal') return;
    if (!runtime.model || !runtime.poseRoot || !runtime.locomotionRoot || !runtime.anatomy || !window.LegBones?.solveFixedTwoBoneChain) return;
    runtime.feetRig = discoverFeetRig(); // Refreshes references after async GLB foot swaps or avatar hierarchy rebuilds.
    if (runtime.poseId !== 'carryUpright') applyGroundBodyPose(runtime.poseId); // Ground poses own body root only after playback was paused and baseline captured.
    const profile = profileForIdentity(runtime.speciesId, runtime.gender); // Canonical shoulder/posterior record for current character.
    const leftShoulderFloor = shoulderFloorPoint(profile, 'left') || { x: -runtime.modelWidth * 0.18, y: runtime.modelHeight * 0.68, z: 0 }; // Future unauthored-rig fallback.
    const rightShoulderFloor = shoulderFloorPoint(profile, 'right') || { x: runtime.modelWidth * 0.18, y: runtime.modelHeight * 0.68, z: 0 }; // Mirrored fallback.
    const shoulders = { left: floorPointToLocomotion(leftShoulderFloor), right: floorPointToLocomotion(rightShoulderFloor) }; // Live posed shoulders used by arm IK.
    const hipFloorY = runtime.posteriorY; // Canonical floor-relative posterior/hip height.
    const hips = {
      left: floorPointToLocomotion({ x: standingHipX('left'), y: hipFloorY, z: 0 }),
      right: floorPointToLocomotion({ x: standingHipX('right'), y: hipFloorY, z: 0 }),
    }; // Pre-pose standing hip X values transformed through current authored/legacy body pose.

    let legSolve = null; // Ground modes drive existing leg hierarchy; carry computes guide-only knees from live real feet.
    let handPose = null; // Hand targets/poles for selected ground or carry mode.
    if (runtime.poseId === 'carryUpright') {
      handPose = updateCarryPose(now, shoulders);
      legSolve = {};
      for (const side of ['left', 'right']) {
        const liveFoot = objectPointInLocomotion(runtime.feetRig?.[side]?.foot) || new runtime.THREE.Vector3(standingHipX(side), contactYForSide(side), 0); // Existing gait endpoint; never overwritten in carry.
        const pole = hips[side].clone().add(new runtime.THREE.Vector3((side === 'left' ? -1 : 1) * runtime.modelHeight * 0.08, 0, runtime.modelHeight * 0.20)); // Guide-only knee bend pole.
        legSolve[side] = solveLimb(hips[side], liveFoot, runtime.anatomy.upperLegLength, runtime.anatomy.lowerLegLength, pole);
      }
    } else {
      if (runtime.carryObject) runtime.carryObject.visible = false;
      const targets = groundTargets(runtime.poseId, hips); // Fixed foot endpoints/knee poles for selected rest pose.
      if (!targets) return;
      legSolve = {
        left: solveLimb(hips.left, targets.feet.left, runtime.anatomy.upperLegLength, runtime.anatomy.lowerLegLength, targets.poles.left),
        right: solveLimb(hips.right, targets.feet.right, runtime.anatomy.upperLegLength, runtime.anatomy.lowerLegLength, targets.poles.right),
      };
      applySolvedLeg('left', hips.left, legSolve.left);
      applySolvedLeg('right', hips.right, legSolve.right);
      handPose = handTargets(runtime.poseId, shoulders, legSolve);
    }

    if (!handPose) return;
    const armSolve = {
      left: solveLimb(shoulders.left, handPose.left.target, runtime.anatomy.upperArmLength, runtime.anatomy.forearmLength, handPose.left.pole),
      right: solveLimb(shoulders.right, handPose.right.target, runtime.anatomy.upperArmLength, runtime.anatomy.forearmLength, handPose.right.pole),
    }; // Generated elbows preserve existing total arm length while targets move between poses.
    placeRealHand('left', shoulders.left, armSolve.left);
    placeRealHand('right', shoulders.right, armSolve.right);
    updateLimbGuides('left', shoulders.left, armSolve.left, hips.left, legSolve.left);
    updateLimbGuides('right', shoulders.right, armSolve.right, hips.right, legSolve.right);
    updateTorsoGuide();
    setHandsVisible(true);
    setGuidesVisible(true);
    runtime.lastDebug = {
      identity: `${runtime.speciesId}::${runtime.gender}`,
      pose: runtime.poseId,
      ownership: runtime.poseId === 'carryUpright' ? 'hands/object only; legacy body + gait authoritative' : 'ground body + existing leg chain; legacy playback paused',
      model: { width: runtime.modelWidth, height: runtime.modelHeight, floorLift: runtime.floorLift, posteriorY: runtime.posteriorY },
      existingLegChain: {
        left: Boolean(runtime.feetRig?.left?.hip && runtime.feetRig?.left?.thigh && runtime.feetRig?.left?.calf && runtime.feetRig?.left?.foot),
        right: Boolean(runtime.feetRig?.right?.hip && runtime.feetRig?.right?.thigh && runtime.feetRig?.right?.calf && runtime.feetRig?.right?.foot),
      },
      anatomy: {
        armLengthSource: runtime.anatomy.armLengthSource,
        totalArmLength: runtime.anatomy.totalArmLength,
        upperArmLength: runtime.anatomy.upperArmLength,
        forearmLength: runtime.anatomy.forearmLength,
        legLengthSource: runtime.anatomy.legLengthSource,
        upperLegLength: runtime.anatomy.upperLegLength,
        lowerLegLength: runtime.anatomy.lowerLegLength,
        upperArmRadius: runtime.anatomy.upperArmRadius,
        forearmRadius: runtime.anatomy.forearmRadius,
        thighRadius: runtime.anatomy.thighRadius,
        calfRadius: runtime.anatomy.calfRadius,
        torsoRadius: runtime.anatomy.torsoRadius,
      },
      reach: { leftArm: armSolve.left.reachable, rightArm: armSolve.right.reachable, leftLeg: legSolve.left.reachable, rightLeg: legSolve.right.reachable },
      hands: runtime.handRig?.getDebug?.() || null,
    };
  }

  function renderDebug() { // Mirrors useful runtime state into the visible panel for mobile testing without DevTools.
    const pre = document.getElementById('limbPoseDebug'); // Existing debug <pre> created by buildPanel().
    if (!pre) return;
    if (runtime.poseId === 'normal') {
      pre.textContent = JSON.stringify({ identity: `${runtime.speciesId}::${runtime.gender}`, pose: 'normal', ownership: 'none', note: 'Ground / Carry is not writing avatar, leg, hand, or movement transforms.' }, null, 2);
      return;
    }
    pre.textContent = runtime.lastDebug ? JSON.stringify(runtime.lastDebug, null, 2) : 'Waiting for avatar…';
  }

  function animationLoop(now) { // Keeps active carry grips/ground anatomy synchronized while remaining a no-op in Normal.
    try { updatePoseFrame(now); } catch (error) {
      runtime.lastDebug = { pose: runtime.poseId, error: String(error?.stack || error) }; // Surfaces integration failures in mobile-visible debug UI.
    }
    if ((Math.floor(now / 250) !== Math.floor((now - 16) / 250))) renderDebug();
    requestAnimationFrame(animationLoop);
  }

  function numberField(id, label, min, max, step) { // Builds one reusable numeric anatomy/carry control for the modal.
    return `<div><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}"></div>`;
  }

  function injectStyles() { // Adds a compact, touch-friendly modal suitable for mobile authoring.
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Owns only this adapter's modal styles.
    style.id = STYLE_ID;
    style.textContent = `
#${PANEL_ID}:not([open]){display:none!important}
#${PANEL_ID}[open]{position:absolute!important;z-index:12;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));width:min(470px,calc(100vw - 16px));display:grid!important;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:15px;background:rgba(7,16,26,.985);box-shadow:0 22px 70px rgba(0,0,0,.62)}
#${PANEL_ID}>summary{min-height:48px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.12);cursor:pointer;font-weight:850;background:linear-gradient(180deg,rgba(22,37,56,.99),rgba(11,20,31,.99))}
#${PANEL_ID} .limbPoseBody{min-height:0;overflow:auto;padding:10px;display:grid;gap:10px;-webkit-overflow-scrolling:touch}
#${PANEL_ID} .limbPoseGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#${PANEL_ID} .limbPoseGrid .full{grid-column:1/-1}
#${PANEL_ID} .limbPoseCard{border:1px solid rgba(255,255,255,.11);border-radius:12px;padding:9px;background:rgba(255,255,255,.035)}
#${PANEL_ID} .limbPoseCard h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;color:var(--muted);letter-spacing:.4px}
#${PANEL_ID} .limbPoseActions{display:flex;gap:7px;flex-wrap:wrap}
#${PANEL_ID} .limbPoseActions button{flex:1 1 120px}
#${PANEL_ID} pre{max-height:180px;font-size:10px}
@media(max-width:700px){#${PANEL_ID}[open]{top:auto;right:max(4px,env(safe-area-inset-right));left:max(4px,env(safe-area-inset-left));bottom:max(4px,env(safe-area-inset-bottom));width:auto;height:min(55dvh,620px)}}`;
    document.head.appendChild(style);
  }

  function buildPanel() { // Creates the Ground / Carry workspace without rewriting the giant embedded editor HTML.
    if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);
    injectStyles();
    const panel = document.createElement('details'); // Modal restored if preview UI clears injected overlay children.
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <summary>Ground / Carry anatomy</summary>
      <div class="limbPoseBody">
        <div class="limbPoseCard">
          <h3>Pose</h3>
          <div class="limbPoseGrid">
            <div class="full"><label for="limbPoseSelect">Procedural pose</label><select id="limbPoseSelect">${Object.entries(POSE_LABELS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></div>
            <div class="full"><label><input id="limbPoseShowGuides" type="checkbox" checked> Show shoulder / elbow / knee / radius guides</label></div>
          </div>
          <div class="authorHelp">Normal is a true off state: this workspace does not write body, feet, hands, or movement settings until you select a pose.</div>
        </div>
        <div class="limbPoseCard">
          <h3>Species + gender anatomy</h3>
          <div id="limbPoseIdentity" class="small muted"></div>
          <div class="limbPoseGrid">
            ${numberField('limbUpperArmFraction', 'Upper arm share of total arm', 0.35, 0.68, 0.01)}
            ${numberField('limbUpperArmRadius', 'Upper-arm radius · height fraction', 0.015, 0.12, 0.001)}
            ${numberField('limbForearmRadius', 'Forearm radius · height fraction', 0.012, 0.10, 0.001)}
            ${numberField('limbThighRadius', 'Thigh radius · height fraction', 0.02, 0.14, 0.001)}
            ${numberField('limbCalfRadius', 'Calf radius · height fraction', 0.015, 0.12, 0.001)}
            ${numberField('limbTorsoRadius', 'Torso radius · height fraction', 0.06, 0.30, 0.002)}
          </div>
          <div class="authorHelp">Arm length comes from the authored shoulders/posterior/arm-length offset. Leg length follows the runtime's existing posterior→foot-contact rule. These controls only tune elbow split and thickness.</div>
        </div>
        <div class="limbPoseCard">
          <h3>Heavy upright object</h3>
          <div class="limbPoseGrid">
            ${numberField('limbCarryWeight', 'Weight', 0, 1, 0.01)}
            ${numberField('limbCarryAwkwardness', 'Awkwardness', 0, 1, 0.01)}
            ${numberField('limbCarryHeight', 'Object height · avatar height', 0.3, 1.4, 0.01)}
            ${numberField('limbCarryWidth', 'Object width · avatar width', 0.25, 1.1, 0.01)}
          </div>
          <div class="limbPoseActions"><button id="limbApplyCarryMovement" class="good" type="button">Apply heavy carry walk</button></div>
        </div>
        <div class="limbPoseActions"><button id="limbResetPose" class="secondary" type="button">Return to Normal</button><button id="limbDownloadJson" class="secondary" type="button">Download pose JSON</button></div>
        <div class="limbPoseCard"><h3>Mobile debug</h3><pre id="limbPoseDebug">Waiting for avatar…</pre></div>
      </div>`;
    return panel;
  }

  function addQuickButton(panel) { // Adds an always-visible entry beside existing procedural playback controls.
    const actionRow = document.querySelector('#animationHud .animationHudActions'); // Existing mobile-visible procedural movement action row.
    if (!actionRow || document.getElementById('limbPoseQuickBtn')) return;
    const button = document.createElement('button'); // Opens/closes this extension without setup-panel scrolling.
    button.id = 'limbPoseQuickBtn';
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Ground / Carry';
    button.addEventListener('click', () => { panel.open = !panel.open; button.classList.toggle('active', panel.open); });
    panel.addEventListener('toggle', () => button.classList.toggle('active', panel.open));
    actionRow.appendChild(button);
  }

  function attachPanel(panel) { // Keeps modal alive across editor preview UI rebuilds that replace overlay children.
    const modalRoot = runtime.backdrop?.modalRoot || document.getElementById('gameModalOverlayRoot'); // Public backdrop root preferred when available.
    if (!modalRoot) return;
    if (!modalRoot.contains(panel)) modalRoot.appendChild(panel);
    const observer = new MutationObserver(() => { if (!modalRoot.contains(panel)) modalRoot.appendChild(panel); }); // Restores only this adapter-owned panel after preview cleanup.
    observer.observe(modalRoot, { childList: true });
  }

  function sliderValue(id, fallback) { // Reads one number input while guarding against blank/invalid mobile edits.
    const value = Number(document.getElementById(id)?.value); // Current DOM value entered by author.
    return Number.isFinite(value) ? value : fallback;
  }

  function syncInputsFromAnatomy() { // Loads current species/gender defaults or saved overrides into controls.
    const a = runtime.anatomy; // Complete resolved anatomy record for current avatar.
    if (!a) return;
    document.getElementById('limbUpperArmFraction').value = Number(a.upperArmFraction).toFixed(3);
    document.getElementById('limbUpperArmRadius').value = Number(a.upperArmRadiusHeightFraction).toFixed(3);
    document.getElementById('limbForearmRadius').value = Number(a.forearmRadiusHeightFraction).toFixed(3);
    document.getElementById('limbThighRadius').value = Number(a.thighRadiusHeightFraction).toFixed(3);
    document.getElementById('limbCalfRadius').value = Number(a.calfRadiusHeightFraction).toFixed(3);
    document.getElementById('limbTorsoRadius').value = Number(a.torsoRadiusHeightFraction).toFixed(3);
    document.getElementById('limbCarryWeight').value = runtime.carryWeight.toFixed(2);
    document.getElementById('limbCarryAwkwardness').value = runtime.carryAwkwardness.toFixed(2);
    document.getElementById('limbCarryHeight').value = runtime.carryObjectHeightFraction.toFixed(2);
    document.getElementById('limbCarryWidth').value = runtime.carryObjectWidthFraction.toFixed(2);
    document.getElementById('limbPoseSelect').value = runtime.poseId;
    document.getElementById('limbPoseShowGuides').checked = runtime.showGuides;
    const identity = document.getElementById('limbPoseIdentity'); // Visible source/length summary above numeric controls.
    if (identity) identity.textContent = `${runtime.speciesId} · ${runtime.gender} · arm ${a.totalArmLength.toFixed(3)} (${a.armLengthSource}) · leg ${(a.upperLegLength + a.lowerLegLength).toFixed(3)} (${a.legLengthSource})`;
  }

  function readAnatomyInputs() { // Applies editable thickness/elbow split without changing canonical shoulder/posterior/length data.
    const values = {
      upperArmFraction: clamp(sliderValue('limbUpperArmFraction', runtime.anatomy?.upperArmFraction || 0.52), 0.35, 0.68),
      upperArmRadiusHeightFraction: clamp(sliderValue('limbUpperArmRadius', runtime.anatomy?.upperArmRadiusHeightFraction || 0.045), 0.015, 0.12),
      forearmRadiusHeightFraction: clamp(sliderValue('limbForearmRadius', runtime.anatomy?.forearmRadiusHeightFraction || 0.038), 0.012, 0.10),
      thighRadiusHeightFraction: clamp(sliderValue('limbThighRadius', runtime.anatomy?.thighRadiusHeightFraction || 0.065), 0.02, 0.14),
      calfRadiusHeightFraction: clamp(sliderValue('limbCalfRadius', runtime.anatomy?.calfRadiusHeightFraction || 0.052), 0.015, 0.12),
      torsoRadiusHeightFraction: clamp(sliderValue('limbTorsoRadius', runtime.anatomy?.torsoRadiusHeightFraction || 0.155), 0.06, 0.30),
    }; // Stored values remain normalized fractions so scaling changes remain proportional.
    writeStoredProfile(values);
    runtime.anatomy = resolvedAnatomy(profileForIdentity(runtime.speciesId, runtime.gender));
    syncInputsFromAnatomy();
  }

  function setPose(nextPoseId) { // Central ownership transition ensures Normal, ground, and carry cannot leave stale transforms fighting each other.
    const next = POSE_LABELS[nextPoseId] ? nextPoseId : 'normal'; // Unknown values always fail safe to the no-op Normal mode.
    const previous = runtime.poseId; // Previous mode determines which owned state must be restored before transition.
    if (previous !== 'normal') restoreBaseline();
    if (previous === 'carryUpright' && next !== 'carryUpright') restoreMovementInputs();
    if (runtime.carryObject) runtime.carryObject.visible = false;
    setHandsVisible(false);
    setGuidesVisible(false);
    runtime.priorLocomotionWorldPosition = null;
    runtime.priorTime = performance.now();
    runtime.poseId = next;

    if (next === 'normal') {
      runtime.lastDebug = { identity: `${runtime.speciesId}::${runtime.gender}`, pose: 'normal', ownership: 'none' };
    } else if (next === 'carryUpright') {
      captureMovementInputs();
      for (const [id, value] of Object.entries(CARRY_MOVEMENT)) dispatchMovementValue(id, value);
      runtime.backdrop?.setMovementPlayback?.(true);
      const badge = document.getElementById('animationPresetBadge'); // Existing HUD badge communicates temporary carry preset ownership.
      if (badge) badge.textContent = 'Heavy upright carry';
    } else {
      captureBaseline();
      runtime.backdrop?.setMovementPlayback?.(false);
    }
    const select = document.getElementById('limbPoseSelect'); // Keeps programmatic transitions synchronized with visible selector.
    if (select) select.value = next;
    renderDebug();
  }

  function applyCarryMovement() { // Button shortcut selects carry through the same ownership-safe transition as the dropdown.
    setPose('carryUpright');
  }

  function resetPose() { // True reset: enters Normal, restores any owned baseline/settings, and next animation frame remains a no-op.
    setPose('normal');
  }

  function exportObject() { // Builds portable schema containing normalized anatomy settings and procedural pose rules.
    const stored = readStoredProfile(runtime.speciesId, runtime.gender); // Only explicit author overrides are written back, not computed world lengths.
    return {
      schema: 'hobunji-procedural-limb-pose-library.v2',
      speciesId: runtime.speciesId,
      gender: runtime.gender,
      anatomy: {
        ...stored,
        computed: {
          totalArmLength: runtime.anatomy?.totalArmLength || null,
          upperArmLength: runtime.anatomy?.upperArmLength || null,
          forearmLength: runtime.anatomy?.forearmLength || null,
          upperLegLength: runtime.anatomy?.upperLegLength || null,
          lowerLegLength: runtime.anatomy?.lowerLegLength || null,
          armLengthSource: runtime.anatomy?.armLengthSource || null,
          legLengthSource: runtime.anatomy?.legLengthSource || null,
        },
      },
      currentPose: runtime.poseId,
      groundPoseIds: Object.keys(POSE_LABELS).filter(id => id !== 'normal' && id !== 'carryUpright'),
      carryUpright: {
        movement: CARRY_MOVEMENT,
        weight: runtime.carryWeight,
        awkwardness: runtime.carryAwkwardness,
        objectHeightFraction: runtime.carryObjectHeightFraction,
        objectWidthFraction: runtime.carryObjectWidthFraction,
        objectDepthFraction: runtime.carryObjectDepthFraction,
        gripRule: 'two hands remain locked to opposing object-side grips; generated elbows preserve species+gender arm length',
        bodyOwnership: 'legacy procedural animator',
      },
      solver: 'LegBones.solveFixedTwoBoneChain',
      legApplication: 'existing hip → thigh → calf → foot hierarchy',
      shoulderSource: 'HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[species::gender].anchors.left/rightHandShoulder',
      posteriorSource: 'attachment-rig posteriorRule / resolvedPosteriorPosition',
    };
  }

  function downloadExport() { // Downloads current settings directly from the browser, including on mobile.
    const blob = new Blob([JSON.stringify(exportObject(), null, 2)], { type: 'application/json' }); // Portable authoring JSON payload.
    const url = URL.createObjectURL(blob); // Temporary download URL released after click.
    const link = document.createElement('a'); // One-shot hidden anchor because editor exposes no downloadJson API.
    link.href = url;
    link.download = `hobunji_limb_pose_${runtime.speciesId}_${runtime.gender}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function wirePanel(panel) { // Connects touch/keyboard controls to live pose state once.
    if (panel.dataset.limbPoseWired === 'true') return;
    panel.dataset.limbPoseWired = 'true';
    document.getElementById('limbPoseSelect').addEventListener('change', event => setPose(event.target.value));
    document.getElementById('limbPoseShowGuides').addEventListener('change', event => {
      runtime.showGuides = Boolean(event.target.checked);
      setGuidesVisible(runtime.poseId !== 'normal');
    });
    for (const id of ['limbUpperArmFraction', 'limbUpperArmRadius', 'limbForearmRadius', 'limbThighRadius', 'limbCalfRadius', 'limbTorsoRadius']) document.getElementById(id).addEventListener('change', readAnatomyInputs);
    for (const [id, key, min, max] of [
      ['limbCarryWeight', 'carryWeight', 0, 1], ['limbCarryAwkwardness', 'carryAwkwardness', 0, 1],
      ['limbCarryHeight', 'carryObjectHeightFraction', 0.3, 1.4], ['limbCarryWidth', 'carryObjectWidthFraction', 0.25, 1.1],
    ]) document.getElementById(id).addEventListener('input', () => {
      runtime[key] = clamp(sliderValue(id, runtime[key]), min, max);
      const state = savedState(); // Carry tuning persisted independently from active pose ownership.
      state.carry = { weight: runtime.carryWeight, awkwardness: runtime.carryAwkwardness, height: runtime.carryObjectHeightFraction, width: runtime.carryObjectWidthFraction, depth: runtime.carryObjectDepthFraction };
      saveState(state);
    });
    document.getElementById('limbApplyCarryMovement').addEventListener('click', applyCarryMovement);
    document.getElementById('limbResetPose').addEventListener('click', resetPose);
    document.getElementById('limbDownloadJson').addEventListener('click', downloadExport);
  }

  function readCarryState() { // Restores only tuning values; active pose always starts Normal after tool/page load.
    const carry = savedState().carry || {}; // Stored mobile authoring values from prior session.
    runtime.carryWeight = clamp(carry.weight ?? runtime.carryWeight, 0, 1);
    runtime.carryAwkwardness = clamp(carry.awkwardness ?? runtime.carryAwkwardness, 0, 1);
    runtime.carryObjectHeightFraction = clamp(carry.height ?? runtime.carryObjectHeightFraction, 0.3, 1.4);
    runtime.carryObjectWidthFraction = clamp(carry.width ?? runtime.carryObjectWidthFraction, 0.25, 1.1);
    runtime.carryObjectDepthFraction = clamp(carry.depth ?? runtime.carryObjectDepthFraction, 0.1, 0.8);
  }

  async function attachCurrentAvatar() { // Rebuilds only this extension's optional hands/guides when editor changes NPC/species/gender.
    if (runtime.poseId !== 'normal') resetPose(); // Restore old avatar ownership before references are replaced by a preview rebuild.
    runtime.backdrop = window.HobunjiGameplayBackdrop;
    runtime.model = runtime.backdrop?.getAvatarModel?.() || null;
    if (!runtime.model || runtime.backdrop?.getPreviewMode?.() !== 'npc') return;
    const identity = selectedIdentity(); // Current species/gender/body colors used by profiles and hand visuals.
    runtime.speciesId = identity.speciesId;
    runtime.gender = identity.gender;
    runtime.modelHeight = Number(runtime.model.userData?.portraitModelHeight) || Number(runtime.model.userData?.gameModelHeight) || 0.9;
    runtime.modelWidth = Number(runtime.model.userData?.portraitModelWidth) || runtime.modelHeight;
    runtime.floorLift = Number(runtime.model.userData?.gameGrounding?.avatarHeightHalfLift) || runtime.modelHeight / 2;
    runtime.poseRoot = runtime.model.parent || null;
    runtime.avatarLiftRoot = runtime.poseRoot?.parent || null;
    runtime.locomotionRoot = runtime.avatarLiftRoot?.parent || null;
    if (!runtime.poseRoot || !runtime.locomotionRoot) return;
    const profile = profileForIdentity(runtime.speciesId, runtime.gender); // Canonical rig profile used for posterior/shoulders/arm length.
    runtime.posteriorY = posteriorYFor(profile, runtime.modelHeight, runtime.model);
    runtime.feetRig = discoverFeetRig();
    runtime.anatomy = resolvedAnatomy(profile);
    runtime.handRig?.dispose?.();
    runtime.handRig = window.ProceduralHandAttachments?.attach?.(runtime.handThree || runtime.THREE, runtime.poseRoot, {
      name: 'procedural_pose_author',
      avatarRoot: runtime.model,
      speciesId: runtime.speciesId,
      gender: runtime.gender,
      modelHeight: runtime.modelHeight,
      bodyColors: identity.bodyColors,
    }) || null; // Real hand GLBs when available; generated fallback otherwise.
    ensureGuideRoot();
    setHandsVisible(false);
    setGuidesVisible(false);
    runtime.poseId = 'normal';
    runtime.baseline = null;
    runtime.movementBaseline = null;
    syncInputsFromAnatomy();
    runtime.lastDebug = {
      attached: `${runtime.speciesId}::${runtime.gender}`,
      pose: 'normal',
      ownership: 'none',
      handRig: Boolean(runtime.handRig),
      existingLegChain: {
        left: Boolean(runtime.feetRig?.left?.hip && runtime.feetRig?.left?.thigh && runtime.feetRig?.left?.calf && runtime.feetRig?.left?.foot),
        right: Boolean(runtime.feetRig?.right?.hip && runtime.feetRig?.right?.thigh && runtime.feetRig?.right?.calf && runtime.feetRig?.right?.foot),
      },
    };
    renderDebug();
  }

  function openPanel() { // Public lazy-bootstrap entry that works even if called just before panel construction completes.
    const panel = document.getElementById(PANEL_ID); // Existing author panel once startup dependencies/UI are ready.
    if (panel) {
      panel.open = true;
      runtime.pendingOpen = false;
      document.getElementById('limbPoseQuickBtn')?.classList.add('active');
      return true;
    }
    runtime.pendingOpen = true;
    return false;
  }

  async function start() { // Installs the extension after editor public API and branch-paired dependencies are ready.
    await ensureDependencies();
    const waitForBackdrop = () => new Promise(resolve => {
      if (window.HobunjiGameplayBackdrop) return resolve(window.HobunjiGameplayBackdrop);
      window.addEventListener('hobunji-backdrop-api-ready', event => resolve(event.detail || window.HobunjiGameplayBackdrop), { once: true });
    }); // Avoids racing the large embedded editor initialization.
    runtime.backdrop = await waitForBackdrop();
    readCarryState();
    const panel = buildPanel(); // Touch-friendly workspace created once.
    attachPanel(panel);
    addQuickButton(panel);
    wirePanel(panel);
    await attachCurrentAvatar();
    window.addEventListener('hobunji-backdrop-avatar-changed', () => setTimeout(() => attachCurrentAvatar().catch(console.error), 0));
    window.addEventListener('hobunji-backdrop-creature-changed', () => {
      if (runtime.poseId !== 'normal') resetPose();
      runtime.handRig?.dispose?.();
      runtime.handRig = null;
      disposeGuideRoot();
      runtime.model = null;
    });
    requestAnimationFrame(animationLoop);
    if (runtime.pendingOpen) openPanel();
    console.info('[Limb pose author] Ground/rest anatomy + heavy upright carry workspace ready in Normal/no-ownership mode.');
  }

  window.HobunjiProceduralLimbPoseAuthor = {
    version: 2,
    openPanel,
    setPose,
    getDebug: () => runtime.lastDebug,
    getExport: exportObject,
    refreshAvatar: attachCurrentAvatar,
    applyCarryMovement,
    resetPose,
  };

  start().catch(error => {
    console.error('[Limb pose author] Failed to initialize:', error);
    runtime.lastDebug = { initializationError: String(error?.stack || error) };
  });
})();