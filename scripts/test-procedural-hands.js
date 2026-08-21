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
const driverSource = read('docs/js/procedural-hand-frame-driver.js');
const gripConfigSource = read('docs/js/hand-tool-grips.js');
const editorUiSource = read('docs/js/attack-editor-hand-configurator.js');
const directEditorSource = read('docs/js/attack-editor-hand-direct-attachments.js');
const gripModeSource = read('docs/js/hand-grip-modes.js');
const gripEditorSource = read('docs/js/attack-editor-hand-grip-mode.js');
const shoulderScanSource = read('docs/js/portrait-hand-shoulder-scan.js');
const shoulderScanSpeciesSource = read('docs/js/portrait-hand-shoulder-scan-species.js');
const shoulderPoseRuntimeSource = read('docs/js/hand-shoulder-pose-runtime.js');
const shoulderAimSource = read('docs/js/procedural-hand-shoulder-aim.js');
const shoulderControlsSource = read('docs/js/attack-editor-hand-shoulder-controls.js');
const animationAuthorShoulderSource = read('docs/js/animation-author-hand-shoulder-points.js');
const npcPreviewSource = read('docs/js/npc-avatar-preview-utils.js');
const heldSource = read('docs/js/held-action-animations.js');
const bridgeSource = read('docs/js/player-body-attachment-bridge.js');
const weaponScaleSource = read('docs/js/weapon-png-scale.js');
const materialRoleSource = read('docs/js/procedural-hand-foot-material-roles.js');

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
assert.strictEqual(profiles.modelScaleFor('mao-ao'), 1.7, 'ordinary hand GLBs use the 85%-balanced model default');
assert.strictEqual(profiles.modelScaleFor('kenkari'), 2.55, 'parrot hand GLBs retain their relative larger basis at 85% size');
assert.strictEqual(profiles.data.models.feline.mirrorX, true, 'Mao\'ao keeps the normal source-X mirror');
assert.strictEqual(profiles.data.models.parrot.mirrorX, false, 'Kenkari/Rakako\'an parrot hands must use the opposite mirror');

const maoTransform = JSON.stringify({
  position: { x: -0.07, y: -0.13, z: 0.21 },
  rotationDeg: { pitch: 90, yaw: -90, roll: 0 },
});
for (const [key, model] of Object.entries(profiles.data.models)) {
  assert.strictEqual(JSON.stringify(model.handFromTool), maoTransform, `${key} must use the Mao'ao tool-relative hand setup`);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(model, 'shoulderAim'), false, `${key} must not retain model-level shoulder aim settings`);
}
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
assert.match(driverSource, /placeHandWorld\?\.\('right'/, 'right hand must follow primary tool grip');
assert.match(driverSource, /secondaryGripForTool/, 'driver must support an optional second grip');
assert.match(driverSource, /applyFallbackSide\(record, 'left'\)/, 'left hand must use locomotion fallback on one-handed tools');
assert.match(driverSource, /profile: options\.profile \|\| null/, 'avatar profile must be retained for post-build shoulder scanning');
assert.match(driverSource, /profile: record\.profile/, 'hand attachment must receive the original avatar profile');
assert.doesNotMatch(driverSource, /clampDeltaWorld|armLength|elbow/, 'driver must never perform arm reach correction');

const gripSandbox = { window: {}, localStorage: sandbox.localStorage };
gripSandbox.window.localStorage = sandbox.localStorage;
vm.runInNewContext(gripConfigSource, gripSandbox, { filename: 'hand-tool-grips.js' });
const grips = gripSandbox.window.HobunjiHandToolGrips;
assert(grips, 'secondary grip config manager should be installed');
assert.strictEqual(grips.secondaryGripForTool('hatchet'), null, 'hatchet must start with its second-hand grip disabled');
assert.strictEqual(grips.secondaryGripForTool('bronzehoe'), null, 'hoe must start with its second-hand grip disabled');
assert.strictEqual(grips.secondaryGripForTool('pickshovel'), null, 'other tools must remain one-handed unless authored');

assert.match(gripModeSource, /palm-parallel/, 'palm-parallel grip mode must remain');
assert.match(gripModeSource, /palm-perpendicular/, 'palm-perpendicular grip mode must remain');
assert.match(gripModeSource, /multiplyQuat\(rotationQuaternion, inverseQuat\(fineQ\)\)/, 'grip rotations must derive a rigid quaternion delta');
assert.match(gripEditorSource, /handGripModeSelect/, 'Attack Editor must keep the grip-mode dropdown');
assert.match(gripEditorSource, /JSON\.parse\(jsonView\.value\)/, 'grip export must compose with later JSON extensions instead of bypassing them');
assert.match(directEditorSource, /handSecondaryGripEnabled/, 'Attack Editor must expose secondary grip enablement');
assert.match(directEditorSource, /handSecondaryGripPositionFields/, 'Attack Editor must expose secondary grip position');
assert.match(directEditorSource, /handSecondaryGripRotationFields/, 'Attack Editor must expose secondary grip orientation');

assert.match(editorUiSource, /Final hand size = <b>model scale × species\/gender scale<\/b>/, 'editor must retain scale authoring');
assert.match(editorUiSource, /hand-model-profiles\.json/, 'editor must retain reusable hand profile export');
assert.match(heldSource, /hand-shoulder-points\.js/, 'bootstrap must load manual shoulder coordinates');
assert.match(heldSource, /hand-shoulder-pose-profiles\.js/, 'bootstrap must load individually-authored animation shoulder profiles');
assert.match(heldSource, /hand-shoulder-pose-runtime\.js/, 'bootstrap must load per-pose interpolation before hand aiming');
assert.match(heldSource, /portrait-hand-shoulder-scan-species\.js/, 'bootstrap must let fallback scans resolve by species/gender');
assert.match(heldSource, /procedural-hand-attachments\.js/, 'bootstrap must load the direct hand runtime');
assert.match(heldSource, /hand-tool-grips\.js/, 'bootstrap must load tool grip sockets');
assert.match(heldSource, /procedural-hand-shoulder-aim\.js/, 'bootstrap must load hand-only shoulder compass');
assert.match(heldSource, /attack-editor-hand-shoulder-controls\.js/, 'Attack Editor must load per-pose shoulder and arm-preview controls');
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
assert.doesNotMatch(shoulderAimSource, /PlaneGeometry|solveTwoBoneArm|elbow|reach clamp/i, 'hand compass must not animate arm sprites or reintroduce IK');

assert.match(shoulderControlsSource, /const PHASES = \['neutral', 'windup', 'strike'\]/, 'Attack Editor must expose all three pose phases');
assert.match(shoulderControlsSource, /\['pitch','yaw','roll'\]\.map/, 'Attack Editor must expose all three shoulder axes');
assert.match(shoulderControlsSource, /`handShoulderAim_\$\{phase\}_\$\{axis\}`/, 'Attack Editor must give each pose-axis checkbox a stable id');
assert.match(shoulderControlsSource, /shoulderAim = \{ \.\.\.poseAim\[phase\] \}/, 'per-pose checkbox state must be serialized inside each pose');
assert.match(shoulderControlsSource, /poseRuntime\.weightsAt/, 'Attack Editor preview must use the same smooth pose interpolation');
assert.match(shoulderControlsSource, /handHideArmSpritesPreview/, 'Attack Editor must retain preview-only arm hiding');
assert.match(shoulderControlsSource, /previewApi\.renderProfileToCanvas/, 'arm hiding should be scoped to the Attack Editor preview adapter');
assert.doesNotMatch(shoulderControlsSource, /global\.renderPortraitProfile\s*=|global\.renderProfile\s*=/, 'preview arm hiding must not monkeypatch global portrait renderers');

// Animation Author companion lives in the existing attachment-rig section and lets
// each side be placed directly on the canonical 200x200 front portrait.
assert.match(animationAuthorShoulderSource, /maaRigLibrarySection/, 'shoulder author UI must mount inside Attachment Rig Coordinates');
assert.match(animationAuthorShoulderSource, /frontCanvas/, 'manual shoulder placement must use the existing front portrait');
assert.match(animationAuthorShoulderSource, /Set 0,0 fallback/, 'each side must have an explicit automatic-fallback reset');
assert.match(animationAuthorShoulderSource, /200×200 portrait coordinates/, 'author UI must explain the coordinate basis');
assert.match(animationAuthorShoulderSource, /panel\.offsetParent == null/, 'portrait clicks must only place shoulders while Attachment Rig Coordinates is visible');
assert.match(npcPreviewSource, /animation-author-hand-shoulder-points\.js/, 'Animation Author runtime must load the shoulder companion panel');

assert.match(materialRoleSource, /MAT_None_7a4e2e: 'keratin'/, 'parrot first export material must be flipped to keratin');
assert.match(materialRoleSource, /MAT_EyeSurface_0c0c0c: 'body'/, 'parrot second export material must be flipped to body');

assert.match(weaponScaleSource, /BASE_WEAPON_PNG_SCALE = 1\.15/, 'unscaled weapon PNG baseline must be 1.15x');
for (const key of ['hatchet', 'bronzehoe', 'pickshovel', 'fishingspear', 'fishingmace']) {
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
