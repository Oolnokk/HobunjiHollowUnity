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
const directEditorSource = read('docs/js/attack-editor-hand-direct-attachments.js');
const gripModeSource = read('docs/js/hand-grip-modes.js');
const gripEditorSource = read('docs/js/attack-editor-hand-grip-mode.js');
const shoulderScanSource = read('docs/js/portrait-hand-shoulder-scan.js');
const shoulderScanSpeciesSource = read('docs/js/portrait-hand-shoulder-scan-species.js');
const shoulderPoseRuntimeSource = read('docs/js/hand-shoulder-pose-runtime.js');
const shoulderAimSource = read('docs/js/procedural-hand-shoulder-aim.js');
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
assert.match(handSource, /animation-author.*esm\.sh\/three@\$\{version\}\/examples\/jsm\/loaders\/GLTFLoader\.js/s, 'Animation Author must use an absolute version-matched GLTFLoader module URL');
assert.match(handSource, /RIGHT_SHOULDER_AXIS_TWIST_DEG = 180/, 'right hand must twist 180 degrees around its shoulder-pointing local axis');
assert.match(handSource, /side === 'right'.*group\.rotation\.y = THREE\.MathUtils\.degToRad\(RIGHT_SHOULDER_AXIS_TWIST_DEG\)/, 'right-hand twist must be applied around visual local +Y without changing shoulder aim');
assert.match(handSource, /modelKey === 'parrot' && role === 'body'/, 'Kenkari-family modeled wing continuation must be identified independently of its talons');
assert.match(handSource, /depthWrite: !isParrotWingLayer/, 'portrait clothing must be able to occlude the parrot body-colored wing continuation');
assert.match(handSource, /ownedMaterials\.every\(material => material\?\.userData\?\.hobunjiHandRole === 'body'\)/, 'the repository GLTFLoader\'s already-separated parrot body primitive must be tagged directly');
assert.match(handSource, /hobunjiPortraitOccludedWingLayer: true, noOutline: true/, 'portrait-covered wing continuation must retain its occlusion tag and not leak a 3D shell outline through clothing');
assert.match(handOutlineSource, /hobunjiPortraitOccludedWingLayer === true\) return false/, 'portrait-occluded wing mesh must stay out of the held-object foreground replay');
assert.match(driverSource, /placeHandWorld\?\.\('right'/, 'right hand must follow primary tool grip');
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
assert.match(shoulderAimSource, /freeSide = \{ left: true, right: true \}/, 'shoulder edits must track which hands are available for idle-position feedback');
assert.match(shoulderAimSource, /freeSide\[side\].*alignFreeHandToFallbackAnchor\(side\)/s, 'manual shoulder edits must move free idle hands to shoulder X and posterior Y in the live preview');
assert.match(shoulderAimSource, /armLengthHeightPercentOffset/, 'free-hand fallback must read the exported species/gender arm-length offset');
assert.match(shoulderAimSource, /return Number\.isFinite\(authored\) \? -modelHeight \* authored \/ 100 : 0/, 'positive arm length must push a free hand below the posterior by a portrait-height percentage');
assert.doesNotMatch(shoulderAimSource, /PlaneGeometry|solveTwoBoneArm|elbow|reach clamp/i, 'hand compass must not animate arm sprites or reintroduce IK');

assert.match(shoulderControlsSource, /const PHASES = \['neutral', 'windup', 'strike'\]/, 'Attack Editor must expose all three pose phases');
assert.match(shoulderControlsSource, /\['pitch','yaw','roll'\]\.map/, 'Attack Editor must expose all three shoulder axes');
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
  requestedRigActorAvatarScaleV1534({ source: { type: 'npc', id: 'child'