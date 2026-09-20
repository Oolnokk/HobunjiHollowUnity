'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const configSource = read('docs/config/hand-model-profiles.js');
const shoulderPointConfigSource = read('docs/config/hand-shoulder-points.js');
const shoulderPoseProfilesSource = read('docs/config/hand-shoulder-pose-profiles.js');
const handSource = read('docs/js/procedural-hand-attachments.js');
const handOutlineSource = read('docs/js/procedural-hand-outline-parity.js');
const gltfLoaderSource = read('docs/js/GLTFLoader.js');
const driverSource = read('docs/js/procedural-hand-frame-driver.js');
const gripConfigSource = read('docs/js/hand-tool-grips.js');
const editorUiSource = read('docs/js/attack-editor-hand-configurator.js');
const inverseEditorSource = read('docs/js/attack-editor-hand-inverse-configurator.js');
const directEditorSource = read('docs/js/attack-editor-hand-direct-attachments.js');
const gripModeSource = read('docs/js/hand-grip-modes.js');
const gripEditorSource = read('docs/js/attack-editor-hand-grip-mode.js');
const shoulderScanSource = read('docs/js/portrait-hand-shoulder-scan.js');
const shoulderScanSpeciesSource = read('docs/js/portrait-hand-shoulder-scan-species.js');
const shoulderPoseRuntimeSource = read('docs/js/hand-shoulder-pose-runtime.js');
const shoulderAimSource = read('docs/js/procedural-hand-shoulder-aim.js');
const scaleFreeHandSource = read('docs/js/procedural-hand-scale-free-world.js'); // Verifies calibration payload survives the world/local placement wrapper.
const attackEditorSource = read('docs/tools/attack-animation-editor/index.html'); // Verifies the isolated tab hides animation/tool presentation.
const shoulderControlsSource = read('docs/js/attack-editor-hand-shoulder-controls.js');
const animationAuthorSource = read('docs/tools/animation-author/index.html');
const npcPreviewSource = read('docs/js/npc-avatar-preview-utils.js');
const heldSource = read('docs/js/held-action-animations.js');
const bridgeSource = read('docs/js/player-body-attachment-bridge.js');
const weaponScaleSource = read('docs/js/weapon-png-scale.js');
const materialRoleSource = read('docs/js/procedural-hand-foot-material-roles.js');
const attachmentRigProfileSource = read('docs/config/attachment-rig-profiles.js'); // Executed below against the Animation Author's config-late loading order.
const proceduralFeetSource = read('docs/js/procedural-leg-animation.js'); // Validates the shared gameplay/shoulder-rig foot runtime and nested-tool asset resolution.
const furnitureAuthorSource = read('docs/tools/furniture-avatar-author/index.html'); // Guards the legacy seated-avatar fallback after body scales become gender maps.
const npcDatabase = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json')); // Confirms child anatomy is driven by authored NPC metadata rather than a name-only runtime exception.
const pngAvatarSource = read('docs/js/png-plane-avatar.js'); // Executes the real child-scale classifier against Garanki's authored record below.

function readGlbJson(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath)); // Used to validate the actual bundled parrot primitive/material layout below.
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    if (type === 0x4E4F534A) return JSON.parse(buffer.toString('utf8', offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  throw new Error(`${relativePath} has no glTF JSON chunk`);
}

const parrotGlbJson = readGlbJson('docs/assets/models/hands/hand_parrot.glb');

const storage = new Map();
const sandbox = {
  window: {
    SCRATCHBONES_CONFIG: {
      game: {
        appearanceEditor: { species: {} },
        assets: { pngPlaneAvatar: { proceduralFeet: { footScale: { default: 1, 'mao-ao': { male: 0.7, female: 0.65 } } } } },
      },
    },
  },
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
};
sandbox.window.localStorage = sandbox.localStorage;
vm.runInNewContext(configSource, sandbox, { filename: 'hand-model-profiles.js' });
const profiles = sandbox.window.HobunjiHandModelProfiles;
assert(profiles, 'profile manager should be installed');
assert.strictEqual(profiles.data.schema, 'hobunji_hand_model_profiles.v1');
assert.strictEqual(profiles.data.sourceBasis.handedness, 'left');
assert.strictEqual(profiles.modelKeyForSpecies('mao-ao'), 'feline');
assert.strictEqual(profiles.modelKeyForSpecies('kenkari'), 'parrot');
assert.strictEqual(profiles.modelKeyForSpecies('rakakoan'), 'parrot');
assert.strictEqual(profiles.data.models.parrot.glb, 'assets/models/hands/hand_parrot.glb');
assert.strictEqual(profiles.speciesScaleFor('mao-ao', 'male'), 0.7, 'hand size should still inherit foot scale by default');
assert.strictEqual(profiles.modelScaleFor('mao-ao'), 1.85, 'ordinary hand GLBs sit halfway between their original and over-small balanced size');
assert(Math.abs(profiles.modelScaleFor('kenkari') - 2.775) < 1e-12, 'parrot hand GLBs retain their relative larger basis at 92.5% size');
assert.strictEqual(profiles.data.models.feline.mirrorX, true, 'Mao\'ao keeps the normal source-X mirror');
assert.strictEqual(profiles.data.models.parrot.mirrorX, false, 'Kenkari/Rakako\'an parrot hands must use the opposite mirror');

for (const [key, model] of Object.entries(profiles.data.models)) {
  assert.deepStrictEqual({ ...model.handFromTool.position }, { x: -0.04, y: 0.05, z: -0.04 }, `${key} must inherit the newly calibrated Mao'ao tool-relative hand position`);
  assert.deepStrictEqual({ ...model.handFromTool.rotationDeg }, { pitch: 0, yaw: 0, roll: -180 }, `${key} must inherit the newly calibrated Mao'ao child-local right-angle orientation`);
  assert.deepStrictEqual({ ...model.handFromTool.rotationCorrectionDeg }, { x: 0, y: 0, z: 0 }, `${key} must start with zero fixed-basis XYZ correction`);
  const q = model.handFromTool.rotationQuaternion;
  assert(q && [q.x, q.y, q.z, q.w].every(Number.isFinite), `${key} must expose an authoritative normalized rotation quaternion`);
  assert(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-12, `${key} hand quaternion must stay normalized`);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(model, 'shoulderAim'), false, `${key} must not retain model-level shoulder aim settings`);
}

const quatDotAbs = (a, b) => Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
const mulQ = (a, b) => ({
  x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
  y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
  z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
  w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
});
const invQ = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const normQ = q => {
  const n = Math.hypot(q.x,q.y,q.z,q.w) || 1;
  return { x:q.x/n, y:q.y/n, z:q.z/n, w:q.w/n };
};
const axisOfRelative = (from, to) => {
  let q = normQ(mulQ(to, invQ(from)));
  if (q.w < 0) q = { x:-q.x,y:-q.y,z:-q.z,w:-q.w };
  const n = Math.hypot(q.x,q.y,q.z) || 1;
  return { x:q.x/n, y:q.y/n, z:q.z/n };
};
const axisDotAbs = (a,b) => Math.abs(a.x*b.x + a.y*b.y + a.z*b.z);
const rightVisualTwist = { x: 0, y: 1, z: 0, w: 0 }; // 180° local-Y group rotation used by the rendered right GLB.
const finalRightQ = handQ => normQ(mulQ(handQ, rightVisualTwist));
function rotateVectorByQuatForTest(vector, rawQuat) {
  const q = normQ(rawQuat); // Normalized preserved model base used to derive the expected solo slider axis.
  const tx = 2 * (q.y * vector.z - q.z * vector.y); // Quaternion-vector cross term used only by the axis regression.
  const ty = 2 * (q.z * vector.x - q.x * vector.z); // Quaternion-vector cross term used only by the axis regression.
  const tz = 2 * (q.x * vector.y - q.y * vector.x); // Quaternion-vector cross term used only by the axis regression.
  return {
    x: vector.x + q.w * tx + (q.y * tz - q.z * ty),
    y: vector.y + q.w * ty + (q.z * tx - q.x * tz),
    z: vector.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

const baseCalibration = profiles.normalizeHandTransform(profiles.data.models.feline.handFromTool);
function renderedAxisResponse(correctionDeg, axis, deltaDeg = 0.5) {
  const baseline = profiles.normalizeHandTransform({
    ...baseCalibration,
    rotationCorrectionDeg: { ...correctionDeg },
  }); // Recreates the exact stored calibration frame at the requested combined correction.
  const perturbedCorrection = { ...correctionDeg }; // Used below to model moving exactly one visible slider while the other two stay fixed.
  perturbedCorrection[axis] = (Number(perturbedCorrection[axis]) || 0) + deltaDeg;
  const perturbed = profiles.normalizeHandTransform({
    ...baseCalibration,
    rotationCorrectionDeg: perturbedCorrection,
  }); // Produces the quaternion the real frame driver consumes after that one-slider edit.
  return axisOfRelative(
    finalRightQ(baseline.rotationQuaternion),
    finalRightQ(perturbed.rotationQuaternion),
  );
}

for (const singularCase of [
  { correction: { x: 0, y: 90, z: 0 }, pair: ['x', 'z'], label: 'Y=+90° must not collapse X onto Z' },
  { correction: { x: 90, y: 0, z: 0 }, pair: ['y', 'z'], label: 'X=+90° must not collapse Y onto Z' },
  { correction: { x: 0, y: 0, z: 90 }, pair: ['x', 'y'], label: 'Z=+90° must not collapse X onto Y' },
  { correction: { x: 120, y: -95, z: 70 }, pair: ['x', 'z'], label: 'mixed large corrections must keep X and Z physically distinct' },
]) {
  const axisA = renderedAxisResponse(singularCase.correction, singularCase.pair[0]); // Physical rendered-hand response to the first slider in this regression case.
  const axisB = renderedAxisResponse(singularCase.correction, singularCase.pair[1]); // Physical rendered-hand response to the second slider; must remain separate from axisA.
  assert(
    axisDotAbs(axisA, axisB) < 0.1,
    `${singularCase.label}; |axis dot|=${axisDotAbs(axisA, axisB).toFixed(6)}`,
  );
}

for (const axis of ['x', 'y', 'z']) {
  const response = renderedAxisResponse({ x: 0, y: 0, z: 0 }, axis, 20); // Confirms each solo control still behaves as a real single-axis rotation, not an arbitrary quaternion component.
  const expected = {
    x: rotateVectorByQuatForTest({ x: 1, y: 0, z: 0 }, baseCalibration.rotationBaseQuaternion),
    y: rotateVectorByQuatForTest({ x: 0, y: 1, z: 0 }, baseCalibration.rotationBaseQuaternion),
    z: rotateVectorByQuatForTest({ x: 0, y: 0, z: 1 }, baseCalibration.rotationBaseQuaternion),
  }[axis];
  assert(axisDotAbs(response, expected) > 0.999, `solo ${axis.toUpperCase()} correction must rotate about the preserved model-basis ${axis.toUpperCase()} axis`);
}
assert.match(configSource, /orthogonalCorrectionQuaternion/, 'hand calibration must use the gimbal-free orthogonal quaternion coordinate mapping');
assert.match(configSource, /Math\.tan\(numberOrZero\(correctionDeg\.x\) \* Math\.PI \/ 720\)/, 'X correction must use the quarter-angle stereographic quaternion coordinate');
assert.match(configSource, /rotationQuaternion = normalizeQuat\(multiplyQuat\(rotationBaseQuaternion, correctionQuaternion\)\)/, 'live correction must compose in the preserved hand-model basis without sequential XYZ multiplication');
assert.match(configSource, /rotationCorrectionDeg/, 'hand profiles must retain explicit visible XYZ correction values');
const legacyRotationVectorRefs = configSource.match(/rotationCorrectionVectorDeg/g) || [];
assert.strictEqual(legacyRotationVectorRefs.length, 2, 'retired rotation-vector storage may remain only as the one-shot migration read/delete pair');
assert.match(configSource, /legacyRotationVectorQuaternion\(legacyRaw\?\.rotationCorrectionVectorDeg \|\| \{\}\)/, 'migration must still read the retired rotation-vector field once to preserve old saves');
assert.match(configSource, /delete model\.handFromTool\.rotationCorrectionVectorDeg/, 'migration must delete the retired rotation-vector field after preserving its visible orientation');

const liveCalibrationStorage = new Map();
const liveCalibrationWindow = {
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: { species: {} },
      assets: { pngPlaneAvatar: { proceduralFeet: { footScale: { default: 1 } } } },
    },
  },
  location: { pathname: '/docs/tools/attack-animation-editor/index.html' },
  document: { getElementById: id => id === 'toolSpriteSelect' ? { value: 'hatchet' } : null },
  HobunjiHandToolGrips: { gripModeForTool: () => null },
};
const liveCalibrationSandbox = {
  window: liveCalibrationWindow,
  location: liveCalibrationWindow.location,
  document: liveCalibrationWindow.document,
  localStorage: {
    getItem: key => liveCalibrationStorage.get(key) || null,
    setItem: (key, value) => liveCalibrationStorage.set(key, String(value)),
    removeItem: key => liveCalibrationStorage.delete(key),
  },
};
liveCalibrationWindow.localStorage = liveCalibrationSandbox.localStorage;
vm.runInNewContext(configSource, liveCalibrationSandbox, { filename: 'hand-model-profiles-live-calibration.js' });
vm.runInNewContext(gripModeSource, liveCalibrationSandbox, { filename: 'hand-grip-modes-live-calibration.js' });
const liveProfiles = liveCalibrationWindow.HobunjiHandModelProfiles;
const liveModes = liveCalibrationWindow.HobunjiHandGripModes;
const profileEvents = [];
liveProfiles.subscribe((_data, change) => profileEvents.push(change));
const sharedDefaultModels = liveProfiles.defaultData.models;
for (const modelKey of ['pachyderm', 'sloth', 'feline', 'parrot']) {
  const transform = sharedDefaultModels[modelKey].handFromTool;
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(transform.position)),
    { x: -0.04, y: 0.05, z: -0.04 },
    `${modelKey} must inherit the new Mao'ao-calibrated shared GLB position baseline`,
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(transform.rotationDeg)),
    { pitch: 0, yaw: 0, roll: -180 },
    `${modelKey} must inherit the new Mao'ao-calibrated child-local right-angle orientation`,
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(transform.rotationCorrectionDeg)),
    { x: 0, y: 0, z: 0 },
    `${modelKey} shared baseline must start with zero correction coordinates`,
  );
}
const v1MigrationProbe = liveProfiles.clone();
v1MigrationProbe.alignmentPreset = 'all-species-direction-90--90-0-v1';
v1MigrationProbe.models.pachyderm.mirrorX = false; // A deliberately non-default handedness proves the v1→v2 calibration migration does not reset unrelated per-model setup.
for (const model of Object.values(v1MigrationProbe.models)) {
  model.handFromTool = {
    position: { x: -0.07, y: -0.13, z: 0.21 },
    rotationDeg: { pitch: 90, yaw: -90, roll: 0 },
  };
}
liveProfiles.replace(v1MigrationProbe);
for (const modelKey of ['pachyderm', 'sloth', 'feline', 'parrot']) {
  const transform = liveProfiles.data.models[modelKey].handFromTool;
  assert.strictEqual(transform.position.x, -0.04, `${modelKey} v1→v2 migration must apply shared Mao'ao X`);
  assert.strictEqual(transform.position.y, 0.05, `${modelKey} v1→v2 migration must apply shared Mao'ao Y`);
  assert.strictEqual(transform.position.z, -0.04, `${modelKey} v1→v2 migration must apply shared Mao'ao Z`);
  assert.strictEqual(transform.rotationDeg.pitch, 0, `${modelKey} v1→v2 migration must snap shared local pitch`);
  assert.strictEqual(transform.rotationDeg.yaw, 0, `${modelKey} v1→v2 migration must snap shared local yaw`);
  assert.strictEqual(transform.rotationDeg.roll, -180, `${modelKey} v1→v2 migration must snap shared local roll`);
}
assert.strictEqual(liveProfiles.data.models.pachyderm.mirrorX, false, 'v1→v2 calibration migration must preserve an existing per-model mirror choice');
const beforeLiveCalibration = liveModes.effectiveFrameForModel('feline', 'palm-parallel');
liveProfiles.updateModelHandTransform('feline', transform => { transform.position.x += 0.5; });
const afterLivePosition = liveModes.effectiveFrameForModel('feline', 'palm-parallel');
assert.notStrictEqual(afterLivePosition.position.x, beforeLiveCalibration.position.x, 'store-backed position edit must immediately change the effective preview frame');
liveProfiles.updateModelHandTransform('feline', transform => { transform.rotationCorrectionDeg.z = 35; });
const afterLiveRotation = liveModes.effectiveFrameForModel('feline', 'palm-parallel');
assert(quatDotAbs(afterLivePosition.rotationQuaternion, afterLiveRotation.rotationQuaternion) < 0.999, 'store-backed rotation edit must immediately change the effective preview quaternion');
assert(profileEvents.some(change => change?.kind === 'hand-transform' && change?.modelKey === 'feline'), 'hand-transform updates must notify live preview subscribers');
const historyScaleBefore = Number(liveProfiles.data.models.feline.scale);
const historyPresetBefore = liveProfiles.data.modelScalePreset;
const historySnapshot = liveProfiles.clone();
liveProfiles.replace(historySnapshot);
assert.strictEqual(Number(liveProfiles.data.models.feline.scale), historyScaleBefore, 'profile snapshot restore must not multiply model scale');
assert.strictEqual(liveProfiles.data.modelScalePreset, historyPresetBefore, 'profile snapshot restore must preserve the current scale migration marker');
assert.doesNotMatch(gripModeSource, /profiles\.handTransformForSpecies\s*=/, 'Grip Mode must not monkey-patch the profile resolver');
assert.match(gripModeSource, /multiplyQuat\(modeQ, calibrationQ\)/, 'Grip Mode must compose before Hand Model Calibration');
assert.match(gripModeSource, /rotateVectorByQuat\(cp, modeQ\)/, 'calibration translation must be transformed by Grip Mode using ordinary rigid composition');

assert.doesNotMatch(configSource, /shoulderAimForSpecies|shoulderAimDefaults|DEFAULT_SHOULDER_AIM/, 'shoulder axis settings must no longer live in species/model profiles');
assert.match(configSource, /delete model\.shoulderAim/, 'legacy local hand profiles must strip obsolete model-level shoulderAim data');

// Shoulder point defaults are deliberately unauthored 0,0 for every current species/gender.
const shoulderSandbox = { window: {}, localStorage: sandbox.localStorage };
shoulderSandbox.window.localStorage = sandbox.localStorage;
vm.runInNewContext(shoulderPointConfigSource, shoulderSandbox, { filename: 'hand-shoulder-points.js' });
const shoulderPoints = shoulderSandbox.window.HobunjiHandShoulderPoints;
assert(shoulderPoints, 'manual shoulder point profile manager should install');
assert.strictEqual(shoulderPoints.coordinateSpace, 'portrait-200px');
for (const species of ['mao-ao','engh-sho','tletingan','mashtzarr','kenkari','rakakoan']) {
  for (const gender of ['male','female']) {
    for (const side of ['left','right']) {
      const point = shoulderPoints.pointFor(species, gender, side);
      assert.strictEqual(point.x, 0, `${species}/${gender}/${side} shoulder X should start at fallback sentinel 0`);
      assert.strictEqual(point.y, 0, `${species}/${gender}/${side} shoulder Y should start at fallback sentinel 0`);
      assert.strictEqual(shoulderPoints.isAuthored(point), false, '0,0 must mean automatic fallback');
    }
  }
}

assert.match(handSource, /authored origin/i, 'direct hand runtime must preserve the GLB authored origin');
assert.doesNotMatch(handSource, /solveTwoBoneArm|shoulderNode|upper_arm/, 'direct hand runtime must contain no arm-chain implementation');
assert.match(handSource, /THREE\.DoubleSide/, 'direct runtime must keep hand backface culling disabled');
assert.match(handSource, /animation-author.*esm\.sh\/three@\$\{version\}\/examples\/jsm\/loaders\/GLTFLoader\.js/s, 'Animation Author must use an absolute version-matched GLTFLoader module URL');
assert.match(handSource, /RIGHT_SHOULDER_AXIS_TWIST_DEG = 180/, 'right hand must twist 180 degrees around its shoulder-pointing local axis');
assert.match(handSource, /side === 'right'.*group\.rotation\.y = THREE\.MathUtils\.degToRad\(RIGHT_SHOULDER_AXIS_TWIST_DEG\)/, 'right-hand twist must be applied around visual local +Y without changing shoulder aim');
assert.match(handSource, /modelKey === 'parrot' && role === 'body'/, 'Kenkari-family modeled wing continuation must be identified independently of its talons');
assert.match(handSource, /depthWrite: !isParrotWingLayer/, 'portrait clothing must be able to occlude the parrot body-colored wing continuation');
assert.match(handSource, /ownedMaterials\.every\(material => material\?\.userData\?\.hobunjiHandRole === 'body'\)/, 'the repository GLTFLoader\'s already-separated parrot body primitive must be tagged directly');
assert.match(handSource, /hobunjiPortraitOccludedWingLayer: true,[\s\S]*hobunjiOutlineOccluderDepthReplay: true,[\s\S]*layers\.enable\(OUTLINE_OCCLUDER_DEPTH_LAYER\)/, 'the body-colored parrot hand must join both shell rendering and the portrait-aware pre-shell depth replay');
assert.doesNotMatch(handSource, /hobunjiPortraitOccludedWingLayer: true, noOutline: true/, 'the visible body-colored parrot hand must not be excluded from shell rendering with its covered wing continuation');
assert.match(handSource, /function configureParrotBodyShell[\s\S]*keratinMaxY[\s\S]*trimmedShellIndexBelowY/, 'the continuous parrot body/wing primitive must derive a hand-only shell boundary from its separate keratin digits');
assert.match(handSource, /hobunjiShellIndexStorage/, 'the alternate shell index must remain owned by the cloned geometry for GPU cleanup');
assert.match(handSource, /parrotBodyShellTrim: activeVisual/, 'mobile diagnostics must expose the source and retained body-shell triangle counts');
assert.match(handOutlineSource, /hobunjiPortraitOccludedWingLayer === true\) return false/, 'portrait-occluded wing mesh must stay out of the held-object foreground replay');
assert.match(handOutlineSource, /return 'occluder-depth'/, 'the parrot body primitive depth replay must be recognized as a secondary hand render pass');
assert.match(handOutlineSource, /lockedOccluderDepthDraws/, 'mobile diagnostics must confirm that the pre-shell hand depth replay uses the visible hand transform');
assert.match(handOutlineSource, /passKind === 'shell'.*hobunjiShellIndex/s, 'only the shell pass may swap to the trimmed body-coloured hand index');
assert.match(handOutlineSource, /restoreIndex.*setIndex/s, 'the full body/wing geometry index must be restored immediately after each shell draw');
assert.match(driverSource, /placeHandWorld\?\.\('right'/, 'right hand must follow primary tool grip');
assert.match(driverSource, /const primarySocket = toolSocketWorld\(record, toolHolder, primaryGrip\)/, 'frame driver must retain the raw weapon grip target before Grip Mode and hand-model calibration');
assert.match(driverSource, /placePaperHandGuideWorld\?\.\(primarySocket\.position, primarySocket\.quaternion\)[\s\S]*handSocketAfterGripMode\(record, primarySocket\)/, 'locked paper hand must be placed on the raw target before Grip Mode moves the socket');
assert.match(handSource, /right_hand_paper_reference_socket/, 'paper-hand reference must own a socket separate from the calibrated right-hand socket');
assert.match(handSource, /const calibration = new THREE\.Group\(\);[\s\S]*calibration\.name = `\$\{side\}_hand_calibration`/, 'each hand socket must own a dedicated child calibration node');
assert.match(handSource, /rec\.calibration\.add\(visual\)/, 'rendered hand visuals must live below the calibration child, not directly on the shoulder-owned socket');
assert.match(handSource, /applyToolCalibration\(side, null\)/, 'free-hand fallback must disable held-item calibration without rebuilding the GLB');
assert.match(handSource, /function placeHandWorld\(side, worldPosition, worldQuaternion, modelCalibration = null\)[\s\S]*applyToolCalibration\(side, modelCalibration\)/, 'held-item placement must apply the exact calibration supplied by the frame driver');
assert.match(driverSource, /function modelCalibrationForRecord\(record\)[\s\S]*const modelKey = modelKeyForRecord\(record\)/, 'frame driver must use one authoritative selected model identity for calibration');
assert.match(driverSource, /const modelCalibration = modelCalibrationForRecord\(record\)[\s\S]*placeHandWorld\?\.\('right', primary\.position, primary\.quaternion, modelCalibration\)/, 'right-hand placement must pass the selected model calibration explicitly into the rig');
assert.doesNotMatch(handSource, /function normalizedToolCalibration\(|syncToolCalibration\(|setToolCalibrationEnabled\(/, 'attachment rig must not maintain a second species-resolved calibration path');
assert.doesNotMatch(shoulderAimSource, /toolCalibrationLocal|hand_calibration/, 'shoulder-follow must not read or write the model-calibration child at all');
assert.match(shoulderAimSource, /currentTop\.copy\(localTop\)\.applyQuaternion\(authoredQuaternion\)/, 'shoulder-follow must solve only from the generic hand socket frame');
assert.match(shoulderAimSource, /calibrationOwnership: 'ignored-child-layer'/, 'shoulder diagnostics must make the ownership boundary visible');
assert.match(handSource, /lockedTo: 'raw-primary-grip-frame-before-grip-mode-and-hand-model-calibration'/, 'paper-hand diagnostics must identify the raw target before both downstream hand layers');
assert.match(editorUiSource, /id="handModelCalibrationTab"/, '3D hand editor must expose a dedicated Calibrate GLB tab');
assert.match(editorUiSource, /No attack animation, tool transform, Grip Mode, shoulder targeting, character-facing rotation, or animation-derived hand transform/, 'calibration tab must explicitly exclude the normal animation transform stack');
assert.match(driverSource, /function inHandCalibrationMode\(\)[\s\S]*HobunjiAttackEditorHandCalibrationMode\?\.active === true/, 'frame driver must have an explicit isolated calibration mode');
assert.match(driverSource, /function syncCalibrationWorkspace\(record,[\s\S]*worldQuaternion\.identity\(\)[\s\S]*placeCalibrationPreviewWorld/, 'calibration mode must use a fixed neutral world quaternion instead of an animation/tool frame');
assert.match(driverSource, /if \(inHandCalibrationMode\(\)\) \{[\s\S]*syncCalibrationWorkspace\(record\)/, 'render-time hand authority must remain on the calibration workspace while that tab is active');
assert.match(handSource, /function placeCalibrationPreviewWorld\(worldPosition, worldQuaternion, modelCalibration = null\)/, 'attachment rig must expose a dedicated calibration placement path that bypasses placeHandWorld wrappers');
assert.match(handSource, /sockets\.left\.socket\.visible = false/, 'calibration workspace must hide the unrelated left hand');
assert.match(handSource, /calibrationMode \? -1 : \(sourceIsLeft \? -1 : 1\)/, 'calibration paper handedness must stay fixed while GLB mirror settings change only the model');
assert.match(handSource, /calibrationMode \? \(Number\(values\.speciesScale\) \|\| 1\) : \(Number\(values\.effectiveScale\) \|\| 1\)/, 'calibration paper size must exclude model scale so GLB scale can be judged against it');
assert.match(scaleFreeHandSource, /scaleFreePlaceHandWorld\(side, worldPosition, worldQuaternion, modelCalibration = null\)[\s\S]*applyToolCalibration\?\.\(side, modelCalibration\)/, 'scale-free wrapper must forward and apply the fourth model-calibration argument');
assert.match(shoulderAimSource, /shoulderAimPlaceHandWorld\(side, worldPosition, worldQuaternion, modelCalibration = null\)[\s\S]*originalPlaceHandWorld\(side, worldPosition, worldQuaternion, modelCalibration\)/, 'shoulder wrapper must forward the fourth model-calibration argument unchanged');
assert.match(gripConfigSource, /secondarySpanBlendWorld\(side, worldPosition, worldQuaternion, modelCalibration = null\)[\s\S]*originalPlaceHandWorld\(side, worldPosition, worldQuaternion, modelCalibration\)/, 'off-hand span wrapper must forward the fourth model-calibration argument unchanged');
assert.match(attackEditorSource, /setHandCalibrationPresentation\(active\)[\s\S]*toolBase\.visible = !handCalibrationPresentationActive/, 'calibration tab must hide the animation-derived held-item presentation');
assert.match(attackEditorSource, /if \(handCalibrationPresentationActive\) return;[\s\S]*const action = currentAction\(\)/, 'calibration tab must suppress hitbox/combat overlays');

assert.match(driverSource, /secondaryGripForTool/, 'driver must support an optional second grip');
assert.match(driverSource, /applyFallbackSide\(record, 'left'\)/, 'left hand must use locomotion fallback on one-handed tools');
assert.match(driverSource, /profile: options\.profile \|\| null/, 'avatar profile must be retained for post-build shoulder scanning');
assert.match(driverSource, /profile: record\.profile/, 'hand attachment must receive the original avatar profile');
assert.doesNotMatch(driverSource, /clampDeltaWorld|armLength|elbow/, 'driver must never perform arm reach correction');
const garanki = npcDatabase.npcs.find(npc => npc.id === 'garanki_gabu');
assert(garanki?.tags?.includes('child'), 'Garanki must use the shared child avatar/anatomy scale marker');
assert.strictEqual(garanki.ageBand, 'child', 'Garanki child classification must remain visible in authoring tools');
const pngAvatarSandbox = { window: { SCRATCHBONES_CONFIG: { game: { appearanceEditor: { species: {} }, assets: { pngPlaneAvatar: { portraitScaleBySpecies: { 'mao-ao': 1, 'engh-sho': { default: 0.95, male: 1.1, female: 0.9 } }, childScaleMultiplier: 0.5, childMarkers: { roles: ['child'], tags: ['child'] } } } } } } }; // Mirrors legacy and gender-specific production scales without constructing Three.js meshes.
vm.runInNewContext(pngAvatarSource, pngAvatarSandbox, { filename: 'png-plane-avatar.js' });
assert.strictEqual(pngAvatarSandbox.window.PNGPlaneAvatar.avatarScaleMultiplierFor({ npcRecord: garanki }), 0.5, 'Garanki must resolve to the configured child anatomy multiplier');
assert.strictEqual(pngAvatarSandbox.window.PNGPlaneAvatar.avatarScaleMultiplierFor({ speciesId: 'engh-sho', gender: 'male' }), 1.1, 'male portrait scale must resolve independently');
assert.strictEqual(pngAvatarSandbox.window.PNGPlaneAvatar.avatarScaleMultiplierFor({ speciesId: 'engh-sho', gender: 'female' }), 0.9, 'female portrait scale must resolve independently');
assert.match(furnitureAuthorSource, /seatedPortraitScaleMultiplier\(species,gender\)/, 'furniture avatar fallback must accept gender-specific portrait scales');
assert.match(furnitureAuthorSource, /entry\[String\(gender\|\|''\).*\?\?entry\.default/, 'furniture avatar fallback must preserve the species default when a gender override is absent');
assert.match(proceduralFeetSource, /__HobunjiProceduralFeetDocsBase/, 'nested author tools must provide an explicit docs root to the gameplay feet runtime');
assert.match(proceduralFeetSource, /function loaderForThree/, 'shoulder-rig feet must load their actual GLBs with the author preview’s Three.js version');

const gripSandbox = { window: { requestAnimationFrame: () => 0 }, localStorage: sandbox.localStorage };
gripSandbox.window.localStorage = sandbox.localStorage;
vm.runInNewContext(gripConfigSource, gripSandbox, { filename: 'hand-tool-grips.js' });
const snapTestQuat = (() => {
  const d = Math.PI / 180;
  const qYaw = { x: 0, y: Math.sin(12.34 * d / 2), z: 0, w: Math.cos(12.34 * d / 2) };
  const qPitch = { x: Math.sin(9.22 * d / 2), y: 0, z: 0, w: Math.cos(9.22 * d / 2) };
  const qRoll = { x: 0, y: 0, z: Math.sin(-177.34 * d / 2), w: Math.cos(-177.34 * d / 2) };
  const multiply = (a, b) => ({
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
  });
  return multiply(multiply(qYaw, qPitch), qRoll);
})();
const snappedDumpRotation = sandbox.window.HobunjiHandModelProfiles.snapQuaternionToRightAngles(snapTestQuat);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(snappedDumpRotation.rotationDeg)),
  { pitch: 0, yaw: 0, roll: -180 },
  'mao-ao dump local calibration 9.22/12.34/-177.34 must snap exactly to child-local 0/0/-180',
);
const grips = gripSandbox.window.HobunjiHandToolGrips;
assert(grips, 'secondary grip config manager should be installed');
const expectedPrimaryRotations = {
  hatchet: { pitch: -90, yaw: 90, roll: 180 },
  hoe: { pitch: 0, yaw: 0, roll: 0 },
  bshuakauitl: { pitch: 0, yaw: 0, roll: 0 },
  pickshovel: { pitch: 0, yaw: 0, roll: 0 },
  daggersword: { pitch: 0, yaw: 180, roll: 0 },
  plainssword: { pitch: 0, yaw: 0, roll: 0 },
  dagger: { pitch: 0, yaw: 0, roll: 0 },
  kylie: { pitch: 0, yaw: 18, roll: 0 },
  warcleaver: { pitch: 0, yaw: 0, roll: 0 },
  fishingspear: { pitch: 0, yaw: 0, roll: 0 },
};
for (const [toolKey, expectedRotation] of Object.entries(expectedPrimaryRotations)) {
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(grips.authoredPrimaryGripForTool(toolKey).rotationDeg)),
    expectedRotation,
    `${toolKey} must use the committed user-authored primary grip rotation`,
  );
}
const oldRotationDraft = grips.clone();
delete oldRotationDraft.primaryRotationPreset;
oldRotationDraft.tools.hatchet.primaryGrip.position = { x: 0.123, y: -0.456, z: 0.789 };
oldRotationDraft.tools.hatchet.primaryGrip.rotationDeg = { pitch: 11, yaw: 22, roll: 33 };
oldRotationDraft.tools.kylie.primaryGrip.rotationDeg = { pitch: -44, yaw: -55, roll: -66 };
const oldHatchetScale = oldRotationDraft.tools.hatchet.toolScale;
const oldHatchetSpan = JSON.parse(JSON.stringify(oldRotationDraft.tools.hatchet.secondaryGripSpan));
grips.replace(oldRotationDraft);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(grips.authoredPrimaryGripForTool('hatchet').position)),
  { x: 0.123, y: -0.456, z: 0.789 },
  'rotation migration must preserve authored primary grip position',
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(grips.authoredPrimaryGripForTool('hatchet').rotationDeg)),
  expectedPrimaryRotations.hatchet,
  'old grip drafts must migrate hatchet to the committed rotation table',
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(grips.authoredPrimaryGripForTool('kylie').rotationDeg)),
  expectedPrimaryRotations.kylie,
  'old grip drafts must migrate every listed weapon rotation, not only hatchet',
);
assert.strictEqual(grips.toolScaleForTool('hatchet'), oldHatchetScale, 'rotation migration must preserve tool scale');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(grips.data.tools.hatchet.secondaryGripSpan)),
  oldHatchetSpan,
  'rotation migration must preserve the off-hand span',
);
assert.strictEqual(grips.secondaryGripForTool('hatchet'), null, 'hatchet must start with its second-hand grip disabled');
assert.strictEqual(grips.secondaryGripForTool('bronzehoe'), null, 'hoe must start with its second-hand grip disabled');
assert.strictEqual(grips.secondaryGripForTool('pickshovel'), null, 'other tools must remain one-handed unless authored');
const authoredHatchetGrip = grips.authoredPrimaryGripForTool('hatchet');
const effectiveHatchetGrip = grips.primaryGripForTool('hatchet');
const hatchetGripScale = grips.toolScaleForTool('hatchet');
assert.strictEqual(effectiveHatchetGrip.position.x, authoredHatchetGrip.position.x * hatchetGripScale, 'primary grip target X must scale with the visible weapon instead of moving the weapon back to the hand');
assert.strictEqual(effectiveHatchetGrip.position.y, authoredHatchetGrip.position.y * hatchetGripScale, 'primary grip target Y must scale with the visible weapon');
assert.strictEqual(effectiveHatchetGrip.position.z, authoredHatchetGrip.position.z * hatchetGripScale, 'primary grip target Z must scale with the visible weapon');
assert.match(gripConfigSource, /grip authoring moves the RIGHT HAND to that frame and never inverse-moves the weapon/, 'shared grip contract must keep weapon animation authoritative');
assert.doesNotMatch(gripConfigSource, /function primaryGripForTool\(\) \{ return identityTransform\(\); \}/, 'primary hand target must no longer be discarded at runtime');

assert.match(gripModeSource, /palm-parallel/, 'palm-parallel grip mode must remain');
assert.match(gripModeSource, /palm-perpendicular/, 'palm-perpendicular grip mode must remain');
assert.match(gripModeSource, /normalizedCalibration\.rotationQuaternion/, 'grip composition must consume the authoritative quaternion-native hand calibration');
assert.match(gripModeSource, /const rotationQuaternion = normalizeQuat\(multiplyQuat\(modeQ, calibrationQ\)\)/, 'Grip Mode must compose before Hand Model Calibration without Euler re-entry');
assert.doesNotMatch(gripModeSource, /targetRotation\s*=\s*\{[\s\S]*br\.pitch/, 'grip mode must not add calibration Euler channels at the X=90° singularity');
assert.match(inverseEditorSource, /rotationCorrectionDeg\[field\.key\]/, 'Attack Editor hand-model rotation controls must author fixed-basis XYZ corrections');
assert.match(inverseEditorSource, /GLB local X rotation correction°/, 'calibration rotation UI must explicitly present GLB-local axes');
assert.match(inverseEditorSource, /Snap local rotation to 90°/, 'calibration tab must expose a local right-angle snap control');
assert.match(inverseEditorSource, /rotationBaseQuaternion = \{ \.\.\.snapped\.quaternion \}/, 'right-angle snap must bake the snapped child-local quaternion as the new model base');
assert.match(inverseEditorSource, /rotationCorrectionDeg = \{ x: 0, y: 0, z: 0 \}/, 'right-angle snap must zero correction coordinates after baking the final local orientation');
assert.match(inverseEditorSource, /Reads the calibration CHILD's local quaternion only/, 'user-facing orientation display must explicitly exclude parent/world rotation');
assert.doesNotMatch(inverseEditorSource, /transform\.rotationDeg\[field\.key\]\s*=\s*value/, 'Attack Editor must never directly edit the legacy singular Euler orientation');
assert.match(gripEditorSource, /handGripModeSelect/, 'Attack Editor must keep the grip-mode dropdown');
assert.match(gripEditorSource, /JSON\.parse\(jsonView\.value\)/, 'grip export must compose with later JSON extensions instead of bypassing them');
assert.match(directEditorSource, /handSecondaryGripEnabled/, 'Attack Editor must expose secondary grip enablement');
assert.match(directEditorSource, /handSecondaryGripPositionFields/, 'Attack Editor must expose secondary grip position');
assert.match(directEditorSource, /handSecondaryGripRotationFields/, 'Attack Editor must expose secondary grip orientation');
assert.match(directEditorSource, /blue marker is where the right hand is being told to grip/i, 'Attack Editor must explain the blue weapon marker as a right-hand target');
assert.match(directEditorSource, /X rotation°/, 'grip orientation must use X/Y/Z rotation labels instead of pitch/yaw/roll terminology');
assert.match(directEditorSource, /weapon will not move/i, 'grip picking must make its hand-moving semantics explicit');

assert.match(editorUiSource, /GLB size \/ handedness[\s\S]*Model scale/, 'editor must retain model-scale authoring inside the dedicated GLB calibration tab');
assert.match(editorUiSource, /hand-model-profiles\.json/, 'editor must retain reusable hand profile export');
assert.match(heldSource, /hand-shoulder-points\.js/, 'bootstrap must load manual shoulder coordinates');
assert.match(heldSource, /hand-shoulder-pose-profiles\.js/, 'bootstrap must load individually-authored animation shoulder profiles');
assert.match(heldSource, /hand-shoulder-pose-runtime\.js/, 'bootstrap must load per-pose interpolation before hand aiming');
assert.match(heldSource, /portrait-hand-shoulder-scan-species\.js/, 'bootstrap must let fallback scans resolve by species/gender');
assert.match(heldSource, /procedural-hand-attachments\.js/, 'bootstrap must load the direct hand runtime');
assert.match(heldSource, /hand-tool-grips\.js/, 'bootstrap must load tool grip sockets');
assert.match(heldSource, /procedural-hand-shoulder-aim\.js/, 'bootstrap must load hand-only shoulder compass');
assert.match(heldSource, /attack-editor-hand-shoulder-controls\.js/, 'Attack Editor must load per-pose shoulder and arm-preview controls');
assert.match(heldSource, /attack-editor-history\.js/, 'Attack Editor bootstrap must load global Undo/Redo after hand/grip extensions');
assert.match(heldSource, /weapon-png-scale\.js/, 'game bootstrap must load baseline weapon PNG scaling');
assert.doesNotMatch(heldSource, /portrait-arm-compass\.js|procedural-hand-compass-aim\.js/, 'scrapped rotating-arm compass must not return to bootstrap');
assert.doesNotMatch(heldSource, /arm-bones\.js|procedural-arm-animation\.js|portrait-biceps|forearm-follow|arm-length/, 'bootstrap must not load deleted arm systems');
assert.match(bridgeSource, /ProceduralHandAttachments\?\.installGameRuntime/, 'gameplay dependency bridge must target direct hands');

// Fallback shoulder detection: largest connected mass -> top third -> recropped bounds center.
assert.match(shoulderScanSource, /largestOpaqueComponent/, 'fallback must isolate the main connected opaque arm mass');
assert.match(shoulderScanSource, /recropTopThird/, 'fallback must crop main mass to its top third');
assert.match(shoulderScanSource, /\(bounds\.minX \+ bounds\.maxX\) \/ 2/, 'fallback X must be recropped bounds center');
assert.match(shoulderScanSource, /\(bounds\.minY \+ bounds\.maxY\) \/ 2/, 'fallback Y must be recropped bounds center');
assert.match(shoulderScanSource, /mode: 'raw-arm-main-mass-top-third'/, 'fallback debug must identify the new algorithm');
assert.doesNotMatch(shoulderScanSource, /renderPortraitProfile\s*=|renderProfile\s*=|__hobunjiHandShoulderScanWrapped/, 'shoulder scanner must never wrap the portrait renderer');
assert.doesNotMatch(shoulderScanSource, /PlaneGeometry|pivot\.rotation|arm_compass_sprite/, 'shoulder scan must never create or rotate arm visuals');
assert.match(shoulderScanSpeciesSource, /scanSpecies/, 'fallback must resolve arm art directly from species/gender when needed');

// Per-pose influence is continuous, and an ungripped left hand deliberately keeps idle Pitch+Roll.
assert.match(shoulderPoseRuntimeSource, /function weightsAt/, 'pose runtime must interpolate authored shoulder boxes');
assert.match(shoulderPoseRuntimeSource, /secondaryGripActive/, 'pose runtime must distinguish a gripping vs idle left hand');
assert.match(shoulderPoseRuntimeSource, /side === 'left'.*!secondaryGripActive/s, 'ungripped left hand must use idle shoulder behavior during active animation');
assert.match(shoulderPoseRuntimeSource, /__rangedDebug\?\.playerAction/, 'ranged load/fire must use their real action timeline');
assert.match(shoulderPoseRuntimeSource, /combatNeutralWeight/, 'committed melee defaults must follow the exact neutral lerp weight');
assert.match(shoulderPoseRuntimeSource, /__weaponToolStanceVisualHooks/, 'runtime must wait until the melee visual wrapper exists before capturing raw authored pose metadata');
assert.match(shoulderPoseRuntimeSource, /triggerWeaponSwingVisual/, 'runtime must preserve custom per-pose melee shoulderAim metadata before numeric pose normalization');
assert.match(shoulderPoseRuntimeSource, /hasAuthoredPoseAim\(rawPose\)/, 'custom authored melee shoulder boxes must override the default animation profile');
assert.match(shoulderPoseRuntimeSource, /hasAuthoredPoseAim\(configuredPose\)/, 'configured ranged pose shoulder boxes must override the default animation profile');

for (const key of ['melee:thrust','melee:chop','melee:sweep','ranged:crossbow:load','ranged:crossbow:fire','ranged:scatterbow:load','ranged:scatterbow:fire','held:drink']) {
  assert(shoulderPoseProfilesSource.includes(`'${key}'`), `${key} must have its own authored shoulder pose profile`);
}
assert.match(shoulderPoseProfilesSource, /pitch: true, yaw: false, roll: true/, 'idle endpoints must align Pitch + Roll');
assert.match(shoulderPoseProfilesSource, /pitch: false, yaw: false, roll: true/, 'active endpoints must align Roll only');

assert.match(shoulderAimSource, /new THREE\.Vector3\(0, 1, 0\)/, 'GLB local +Y/top must be treated as the wrist direction');
assert.match(shoulderAimSource, /HobunjiHandShoulderPoints/, 'manual shoulder points must override fallback scan');
assert.match(shoulderAimSource, /manual-portrait-200px/, 'debug must distinguish manually authored shoulder points');
assert.match(shoulderAimSource, /rotationVector\.x \* weights\.pitch/, 'Pitch shoulder influence must blend smoothly');
assert.match(shoulderAimSource, /rotationVector\.y \* weights\.yaw/, 'Yaw shoulder influence must blend smoothly');
assert.match(shoulderAimSource, /rotationVector\.z \* weights\.roll/, 'Roll shoulder influence must blend smoothly');
assert.match(shoulderAimSource, /scanState = 'error'/, 'scan failures must be isolated from avatar rebuild and exposed in debug state');
assert.match(shoulderAimSource, /freeSide = \{ left: true, right: true \}/, 'shoulder edits must track which hands are available for idle-position feedback');
assert.match(shoulderAimSource, /freeSide\[side\].*alignFreeHandToFallbackAnchor\(side\)/s, 'manual shoulder edits must move free idle hands to shoulder X and posterior Y in the live preview');
assert.match(shoulderAimSource, /armLengthHeightPercentOffset/, 'free-hand fallback must read the exported species/gender arm-length offset');
assert.match(shoulderAimSource, /return Number\.isFinite\(authored\) \? -modelHeight \* authored \/ 100 : 0/, 'positive arm length must push a free hand below the posterior by a portrait-height percentage');
assert.doesNotMatch(shoulderAimSource, /PlaneGeometry|solveTwoBoneArm|elbow|reach clamp/i, 'hand compass must not animate arm sprites or reintroduce IK');

assert.match(shoulderControlsSource, /const PHASES = \['neutral', 'windup', 'strike'\]/, 'Attack Editor must expose all three pose phases');
assert.match(shoulderControlsSource, /\[\['pitch','X'\],\['yaw','Y'\],\['roll','Z'\]\]/, 'Attack Editor must expose all three shoulder rotation axes with X/Y/Z labels');
assert.match(shoulderControlsSource, /`handShoulderAim_\$\{phase\}_\$\{axis\}`/, 'Attack Editor must give each pose-axis checkbox a stable id');
assert.match(shoulderControlsSource, /shoulderAim = \{ \.\.\.poseAim\[phase\] \}/, 'per-pose checkbox state must be serialized inside each pose');
assert.match(shoulderControlsSource, /poseRuntime\.weightsAt/, 'Attack Editor preview must use the same smooth pose interpolation');
assert.match(shoulderControlsSource, /handHideArmSpritesPreview/, 'Attack Editor must retain preview-only arm hiding');
assert.match(shoulderControlsSource, /previewApi\.renderProfileToCanvas/, 'arm hiding should be scoped to the Attack Editor preview adapter');
assert.doesNotMatch(shoulderControlsSource, /global\.renderPortraitProfile\s*=|global\.renderProfile\s*=/, 'preview arm hiding must not monkeypatch global portrait renderers');

// Hand shoulder targets are ordinary attachment-rig coordinates and therefore use
// the same actor anchors, axes helpers, TransformControls, numeric fields, and reset flow.
assert.match(animationAuthorSource, /HAND_SHOULDER_ANCHORS_V1525 = Object\.freeze\(\['leftHandShoulder', 'rightHandShoulder'\]\)/, 'rig profiles must expose one shoulder target for each hand');
assert.match(animationAuthorSource, /return \['posterior', \.\.\.HAND_SHOULDER_ANCHORS_V1525, 'shoulderPerch'\]/, 'character rig dropdown must include both shoulder targets');
assert.match(animationAuthorSource, /new THREE\.AxesHelper\(\.22\)/, 'hand shoulder targets must use the standard rig axes helper');
assert.match(animationAuthorSource, /actor\.rigAnchors\[name\] = anchor/, 'hand shoulder targets must be normal actor rig anchors for gizmo attachment');
assert.match(animationAuthorSource, /profile\.anchors\[anchorName\] = defaultHandShoulderSnapshotV1525/, 'standard reset must restore a shoulder target default');
assert.match(animationAuthorSource, /publishCharacterHandShouldersV1525/, 'gizmo edits must feed the live idle-hand renderer');
assert.match(animationAuthorSource, /proceduralHandParent = actor\.visualOffset/, 'rigger hands must share the floor-relative parent used by posterior and shoulder anchors');
assert.match(animationAuthorSource, /resolvedPosteriorPosition = structuredCloneSafe\(transformSnapshot\(actor\.rigAnchors\.posterior\)\.position\)/, 'rigger must publish the exact displayed posterior coordinate to the hand runtime');
assert.match(animationAuthorSource, /idle hands render at matching shoulder X and derived posterior Y/, 'rig inspector must explain live hand placement');
assert.doesNotMatch(npcPreviewSource, /animation-author-hand-shoulder-points\.js/, 'Animation Author must not load the retired portrait-click companion workflow');
assert.match(animationAuthorSource, /'js\/held-action-animations\.js'/, 'Animation Author must load the shared idle-hand runtime');
assert.match(animationAuthorSource, /await window\.HobunjiHandRuntimeReady/, 'Animation Author must wait for the hand frame driver before building avatars');
assert.match(animationAuthorSource, /AUTHOR_HAND_RUNTIME_SCRIPT = new URL\('\.\.\/\.\.\/js\/held-action-animations\.js/, 'Animation Author hand preview must use the runtime paired with the author page rather than a stale selected ref');
assert.match(animationAuthorSource, /AUTHOR_FEET_RUNTIME_SCRIPT = new URL\('\.\.\/\.\.\/js\/procedural-leg-animation\.js/, 'Animation Author feet preview must use the runtime paired with the author page rather than a stale selected ref');
assert.match(animationAuthorSource, /authorPairedRuntimeUrl \|\| rawUrl\(path\)/, 'only paired hand/feet preview runtimes should bypass the selected repository runtime ref');
assert.match(animationAuthorSource, /installShoulderRigFeetPreviewV1529/, 'shoulder rig must attach the gameplay feet preview to character actors');
assert.match(animationAuthorSource, /ProceduralLegAnimation\.attach\(state\.three\.THREE, actor\.visualOffset/, 'feet must share the floor-relative parent used by hands and rig anchors');
assert.match(animationAuthorSource, /rigFeetPreview\?\.dispose/, 'actor removal must dispose shoulder-rig foot resources');
for (const controlId of ['maaSpeciesYOffset', 'maaSpeciesPortraitScale', 'maaSpeciesHandScale', 'maaSpeciesFootScale', 'maaArmLengthOffset']) {
  assert(animationAuthorSource.includes(`id="${controlId}"`), `Shoulder Rig must expose ${controlId} as a live species/gender anatomy control`);
}
assert.match(animationAuthorSource, /profile\.anatomy\[field\] = convert\(entered\)/, 'anatomy control edits must write into the selected attachment-rig profile');
assert.match(animationAuthorSource, /data\.anatomySemantics =/, 'attachment-rig export must document its bundled anatomy fields');
assert.match(animationAuthorSource, /hobunji\.attachment-rig-profiles\.v9/, 'floor-relative posterior and anatomy-bearing rig profiles must use the v9 schema');
assert.match(animationAuthorSource, /document\.title = 'Hobunji Animation Author V15\.39'/, 'the published author title must identify the fixed floor-relative posterior build');
assert.match(animationAuthorSource, /function canonicalCharacterRigProfilesV1537\(\)/, 'Animation Author must normalize its final character library from the shared gameplay profiles');
assert.match(animationAuthorSource, /installCanonicalCharacterRigProfilesV1537\(animationAuthor\.attachmentRigProfiles\)/, 'canonical gameplay character profiles must replace stale embedded rigger snapshots during bootstrap');
assert.match(animationAuthorSource, /installCanonicalCharacterRigProfilesV1537\(DEFAULT_ATTACHMENT_RIG_PROFILE_LIBRARY_V1516\)/, 'rig-library reset must restore canonical calibrated character profiles instead of older embedded defaults');
assert.match(animationAuthorSource, /animationAuthorAnchorPositionMaxDelta = maximumPositionDelta/, 'mobile diagnostics must report any remaining rigger-to-runtime anchor position divergence on every axis');
assert.match(animationAuthorSource, /animationAuthorPosteriorPercentMaxDelta = maximumPosteriorPercentDelta/, 'mobile diagnostics must report any remaining derived posterior-Y divergence');
assert.match(animationAuthorSource, /grid\.position\.y = animationAuthor\.mode === 'rig' \? 0 : ANIMATION_AUTHOR_LEGACY_GRID_Y_V1538/, 'Shoulder Rig must show gameplay floor Y=0 instead of the legacy portrait-viewer grid at -0.55');
assert.match(animationAuthorSource, /id="maaRigVerticalParity"/, 'Shoulder Rig must expose mobile-readable portrait, shoulder, foot, and floor Y measurements');
assert.match(animationAuthorSource, /getStandingPoseDebug/, 'Shoulder Rig diagnostics must consume rendered procedural-foot bounds instead of assuming their visual bottom');
assert.match(proceduralFeetSource, /function footBoundsInRoot\(foot\)/, 'the shared foot runtime must measure rendered geometry in avatar floor space');
assert.match(proceduralFeetSource, /HOBUNJI_ATTACHMENT_RIG_MATH\?\.characterPosteriorY/, 'procedural legs must resolve their hip/posterior with the shared floor-relative rule');
assert.match(proceduralFeetSource, /group: root, update, dispose, applyRecordedLegPose, getStandingPoseDebug/, 'game and rigger feet handles must expose the same standing-pose diagnostic');
assert(animationAuthorSource.lastIndexOf('installCanonicalCharacterRigProfilesV1537(animationAuthor.attachmentRigProfiles)') > animationAuthorSource.indexOf('installApprovedRigLibraryV1524(animationAuthor.attachmentRigProfiles'), 'canonical character profiles must install after the V15.24 full-library replacement');
assert.match(animationAuthorSource, /if \(options\.fromAutosave\)[\s\S]*installCanonicalCharacterRigProfilesV1537\(animationAuthor\.attachmentRigProfiles\)/, 'autosave restoration must not reintroduce pre-calibration embedded character coordinates');
assert.match(animationAuthorSource, /rigReferenceOnly = true/, 'reference NPC must be explicitly marked as comparison-only');
assert.match(animationAuthorSource, /absent from animationAuthor\.actors, selection, gizmos, and exports/, 'reference NPC must remain outside every interactive/exported actor path');
assert.match(animationAuthorSource, /id="maaRandomizeReferenceNpc"/, 'Shoulder Rig must offer one-button reference NPC randomization');
assert.match(animationAuthorSource, /const scaleRoot = actor\?\.visualOffset/, 'body-scale input must target the common portrait, hand, foot, anchor, and rig-box parent');
assert.match(animationAuthorSource, /scaleRoot\.scale\.copy\(actor\.rigBodyVisualOffsetBaseScaleV1535\)\.multiplyScalar\(ratio\)/, 'body-scale input must scale the complete character presentation root');
assert.doesNotMatch(animationAuthorSource, /presentation\.scale\.copy\(actor\.rigBodyPresentationBaseScaleV1532\)/, 'body-scale input must not leave hands, feet, and anchors behind by scaling only the portrait carrier');
assert.doesNotMatch(animationAuthorSource, /rigBodyBoxBaseScaleV1531/, 'whole-root scaling must not double-scale the child rig preview box');
assert.doesNotMatch(animationAuthorSource, /actor\.model\.scale\.copy\(actor\.rigBodyModelBaseScaleV1531\)/, 'body-scale input must not mutate the runtime-managed portrait model');
assert.match(animationAuthorSource, /actor\.rigBuiltAvatarScaleV1533 = builtModelWidth \/ baseModelWidth/, 'body-scale reconciliation must measure the scale actually built into the replacement model');
assert.match(animationAuthorSource, /function animationAuthorAvatarBaseWidthV1536\(\)/, 'Animation Author must share one gameplay-width resolver across portrait builds and scale diagnostics');
assert.match(animationAuthorSource, /pngPlaneAvatar\?\.worldModelWidth/, 'Animation Author must use the same configured base avatar width as gameplay');
assert.strictEqual((animationAuthorSource.match(/modelWidth: previewBaseWidth/g) || []).length, 3, 'repository viewer, editable actor, and reference NPC must all build at gameplay width');
assert.strictEqual((animationAuthorSource.match(/modelHeight: previewBaseWidth/g) || []).length, 3, 'all three character preview paths must preserve square base dimensions like game.js');
assert.match(animationAuthorSource, /const targetScale = requestedRigActorAvatarScaleV1534\(actor, portraitScale\)/, 'live body-scale preview must use the entered species\/gender scale instead of re-reading the prior resolver value');
assert.match(animationAuthorSource, /return desiredScale \* childScale/, 'live body-scale preview must retain the real avatar builder\'s child multiplier');
assert.doesNotMatch(animationAuthorSource, /const targetScale = resolvedRigActorAvatarScaleV1533/, 'live body-scale preview must not discard the entered value for a configured resolver result');
assert.match(animationAuthorSource, /portraitModelWidth\) \|\| 1\) \* actorScaleX/, 'reference NPC spacing must include the editable character root\'s live X scale');
assert.match(animationAuthorSource, /previewRigActorBodyScaleV1531\(actor, anatomy\.portraitScale\)/, 'every newly rebuilt rig actor must reapply its measured carrier correction');
assert.match(animationAuthorSource, /id="maaBodyScaleDiagnostic"/, 'Shoulder Rig must expose built, target, and carrier scale diagnostics without DevTools');
const liveBodyScaleHelperSource = animationAuthorSource.match(/function requestedRigActorAvatarScaleV1534\([\s\S]*?\n\}/)?.[0]; // Executes the authored helper so a static call-site assertion cannot hide a constant preview ratio.
assert(liveBodyScaleHelperSource, 'live body-scale target helper must remain directly testable');
const liveBodyScaleSandbox = {
  state: { npcs: [{ id: 'adult' }, { id: 'child', role: 'child' }] },
  window: {
    PNGPlaneAvatar: { isChildAvatar: options => options.npcRecord?.role === 'child' },
    SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { childScaleMultiplier: 0.8 } } } },
  },
}; // Models the adult and child branches of the real PNGPlaneAvatar builder without requiring a WebGL scene.
vm.runInNewContext(`${liveBodyScaleHelperSource}\nthis.liveBodyScaleResults = [
  requestedRigActorAvatarScaleV1534({ source: { type: 'npc', id: 'adult', species: 'mashtzarr', gender: 'male' } }, 1.35),
  requestedRigActorAvatarScaleV1534({ source: { type: 'npc', id: 'child', species: 'engh-sho', gender: 'male' } }, 1.35),
];`, liveBodyScaleSandbox, { filename: 'animation-author-live-body-scale-helper.js' });
assert.deepStrictEqual(Array.from(liveBodyScaleSandbox.liveBodyScaleResults), [1.35, 1.08], 'entered body scale must remain authoritative while child avatars retain their 0.8 multiplier');
assert.match(animationAuthorSource, /rigReferencePreserveDuringActorSwapV1532 = !!preservedReference/, 'rig NPC replacement must guard its reference from the shared actor clear');
assert.match(animationAuthorSource, /if \(!rigReferencePreserveDuringActorSwapV1532\) disposeRigReferenceNpcV1531\(\)/, 'ordinary project clears must still dispose the reference NPC');
assert.match(animationAuthorSource, /positionRigReferenceNpcV1532\(actor\)/, 'a preserved reference NPC must be repositioned beside the newly selected rig actor');
assert.match(animationAuthorSource, /attachmentProfileReady = window\.applyHobunjiAttachmentRigProfileCorrections\?\.\(\)/, 'Animation Author must apply deferred attachment-profile corrections after its repository config loads');
assert.match(animationAuthorSource, /Attachment rig profile corrections could not find/, 'deferred config failures must appear in the author\'s built-in Diagnostics panel');
assert.match(heldSource, /isAnimationAuthor/, 'hand bootstrap must distinguish the lightweight Animation Author preview from the full game runtime');
assert.match(heldSource, /window\.HobunjiHandRuntimeReady = ready/, 'dynamic repository tools need an explicit hand-runtime readiness signal');
assert.match(heldSource, /ready\.then\(\(\) => window\.applyHobunjiAttachmentRigProfileCorrections\?\.\(\)\)/, 'hand bootstrap must apply exported hand scales once the profile manager is available');
assert.match(heldSource, /selfUrl && selfUrl\.protocol !== 'blob:'/, 'blob-executed bootstraps must not pass a null base into the URL constructor');
assert.match(attachmentRigProfileSource, /SCRATCHBONES_CONFIG\?\.game\?\.assets\?\.pngPlaneAvatar/, 'attachment profiles must tolerate Animation Author loading the shared config later');
assert.match(attachmentRigProfileSource, /HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS/, 'delayed attachment-profile setup must expose a mobile-visible diagnostics state');

const attachmentProfileWindow = {}; // Represents Animation Author before its repository configuration script has executed.
const attachmentProfileSandbox = {
  window: attachmentProfileWindow,
};
vm.runInNewContext(attachmentRigProfileSource, attachmentProfileSandbox, { filename: 'attachment-rig-profiles.js' });
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.schema, 'hobunji.attachment-rig-profiles.v10');
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.anatomyProfiles, 'pending');
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.authoredCharacterProfiles, 10);
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.suppliedCharacterProfiles, 14);
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.exactSuppliedProfiles, 10);
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.parrotSharedProfiles, 2);
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.anchorPositionScale, 1);
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.posteriorCoordinateSpace, 'floor-relative');
const authoredCharacterProfiles = attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters; // Verifies the exact posterior and shoulder values shipped to gameplay and the author.
assert.deepStrictEqual(Array.from(['x', 'y', 'z'], axis => authoredCharacterProfiles['mashtzarr::male'].anchors.shoulderPerch.position[axis]), [-0.3150161025604807, 0.504441432761613, 0], 'v9 must use the exact main-branch Mashtzarr shoulder perch');
assert.deepStrictEqual(Array.from(['x', 'y', 'z'], axis => authoredCharacterProfiles['mashtzarr::male'].anchors.leftHandShoulder.position[axis]), [0.2938287377558306, 0.471474644548211, 0], 'v9 must use the exact main-branch left hand shoulder');
assert.deepStrictEqual(Array.from(['x', 'y', 'z'], axis => authoredCharacterProfiles['engh-sho::female'].anchors.rightHandShoulder.position[axis]), [-0.24815066240089945, 0.46042886220274515, 0], 'v9 must retain gender-specific hand anchors');
assert.strictEqual(authoredCharacterProfiles['mashtzarr::male'].posteriorRule.heightPercentFromFloor, 28.18802021075617, 'v9 posterior coordinates recover the calibrated floor height instead of preserving the corrupted zero');
assert.strictEqual(authoredCharacterProfiles['rakakoan::male'], authoredCharacterProfiles['kenkari::male'], 'Rakakoan male transforms must alias Kenkari male by object identity');
assert.strictEqual(authoredCharacterProfiles['rakakoan::female'], authoredCharacterProfiles['kenkari::female'], 'Rakakoan female transforms must alias Kenkari female by object identity');
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures.drenkirra.anchors.shoulderGrip.position.y, -0.11914729549653388, 'v9 must include the exact main-branch Drenkirra shoulder grip');
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures['gar-wolf'].anchors.shoulderGrip.position.z, 0.07486897921502367, 'v9 must include the exact main-branch Gar-wolf shoulder grip');
assert.strictEqual(
  attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_MATH.characterPosteriorY(authoredCharacterProfiles['rakakoan::male'].posteriorRule, 0.675, 0.023625),
  attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_MATH.characterPosteriorY(authoredCharacterProfiles['kenkari::male'].posteriorRule, 0.675, 0.037125),
  'shared Rakakoan/Kenkari posterior profiles must resolve identically even when portrait bottom pixels differ'
);
assert.strictEqual(
  attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_MATH.characterPosteriorY({ heightPercentOffset: 0 }, 0.9, 0),
  0,
  'legacy posterior fallback must preserve a legitimate zero hand/base Y instead of replacing it with half-height'
);
attachmentProfileWindow.SCRATCHBONES_CONFIG = { game: { assets: { pngPlaneAvatar: {
  portraitScaleBySpecies: {}, portraitVerticalPlacement: {}, proceduralFeet: { footScale: { default: 1 } },
} } } };
const appliedHandScales = {};
attachmentProfileWindow.HobunjiHandModelProfiles = {
  data: { speciesScaleOverrides: appliedHandScales },
  mutate(mutator) { mutator(this.data); },
};
attachmentProfileWindow.applyHobunjiAttachmentRigProfileCorrections();
assert.strictEqual(attachmentProfileWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.portraitScaleBySpecies.mashtzarr.male, 1.18);
assert.strictEqual(attachmentProfileWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.portraitScaleBySpecies.mashtzarr.female, 1.18);
assert.deepStrictEqual(
  { ...attachmentProfileWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.portraitVerticalPlacement.mashtzarr },
  { male: 0.755, female: 0.79 },
);
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.anatomyProfiles, 'applied');
assert.strictEqual(attachmentProfileWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.portraitVerticalPlacement['engh-sho'].male, 1.005, 'profile correction must apply exported portrait Y placement');
assert.strictEqual(attachmentProfileWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.portraitScaleBySpecies['engh-sho'].male, 0.95, 'profile correction must apply exported gender-specific body scale');
assert.strictEqual(attachmentProfileWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale['engh-sho'].male, 1.275, 'profile correction must apply exported foot scale');
assert.strictEqual(appliedHandScales['engh-sho'].male, 1.15, 'profile correction must apply exported hand scale after that runtime loads');
assert.match(proceduralFeetSource, /!isGaiting && state\.wasGaiting[\s\S]*placeIdleTarget\('left'[\s\S]*placeIdleTarget\('right'/, 'stopping movement must immediately snap both procedural feet out of the last stride pose');

const authorPreviewUrl = new URL('https://raw.githack.com/Oolnokk/HobunjiHollowUnity/example/docs/tools/animation-author/index.html'); // Mirrors the immutable per-commit test URL used for this author.
const authorDocsBase = new URL('../../', authorPreviewUrl);
assert.strictEqual(authorDocsBase.pathname, '/Oolnokk/HobunjiHollowUnity/example/docs/');
assert.strictEqual(new URL('assets/portraitsprites/arm-R_mao-ao_m.png', authorDocsBase).pathname, '/Oolnokk/HobunjiHollowUnity/example/docs/assets/portraitsprites/arm-R_mao-ao_m.png');
assert(!new URL('assets/portraitsprites/arm-R_mao-ao_m.png', authorDocsBase).pathname.includes('/docs/docs/'), 'author hand asset paths must never duplicate the docs root');

assert.match(materialRoleSource, /MAT_None_7a4e2e: 'keratin'/, 'parrot first export material must be flipped to keratin');
assert.match(materialRoleSource, /MAT_EyeSurface_0c0c0c: 'body'/, 'parrot second export material must be flipped to body');
assert.strictEqual(parrotGlbJson.meshes?.[0]?.primitives?.length, 2, 'parrot GLB must retain separate keratin and body-wing primitives');
assert.deepStrictEqual(parrotGlbJson.materials.map(material => material.name), ['MAT_None_7a4e2e', 'MAT_EyeSurface_0c0c0c']);
assert.match(gltfLoaderSource, /meshes\.push\( mesh \)/, 'bundled GLTFLoader must continue creating one runtime mesh per primitive');

assert.match(weaponScaleSource, /BASE_WEAPON_PNG_SCALE = 1\.15/, 'unscaled weapon PNG baseline must be 1.15x');
// bronzehoe (and every other crafted-metal hoe tier) is normalized to its base
// shape key 'hoe' via HobunjiHandToolGrips.toolKeyFor before the eligibility
// check, so all metal tiers share one shape entry instead of listing each item key.
for (const key of ['hatchet', 'hoe', 'pickshovel', 'fishingspear', 'fishingmace']) {
  assert(weaponScaleSource.includes(`'${key}'`), `${key} must receive the baseline weapon PNG scale`);
}
assert.match(weaponScaleSource, /holderScale <= 1\.0001/, 'already enlarged weapon animations must not receive another 1.15 multiplier');
assert.doesNotMatch(weaponScaleSource, /crossbow|scatterbow/, 'already enlarged ranged weapons must not be placed in the 1.15 eligibility list');

for (const removed of [
  'docs/js/arm-bones.js',
  'docs/js/procedural-arm-animation.js',
  'docs/js/procedural-hand-portrait-shoulders.js',
  'docs/js/procedural-arm-portrait-biceps.js',
  'docs/js/procedural-hand-forearm-follow.js',
  'docs/js/procedural-hand-arm-length.js',
  'docs/js/portrait-arm-compass.js',
  'docs/js/procedural-hand-compass-aim.js',
]) assert(!fs.existsSync(path.join(root, removed)), `${removed} should be physically removed`);

console.log('procedural hands: per-pose shoulder lerp + manual/fallback shoulder points + direct sockets PASS');
