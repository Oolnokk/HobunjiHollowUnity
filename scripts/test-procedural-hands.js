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
assert.match(animationAuthorSource, /hobunji\.attachment-rig-profiles\.v8/, 'gender-scaled anatomy-bearing rig profiles must use the v8 schema');
assert.match(animationAuthorSource, /document\.title = 'Hobunji Animation Author V15\.33'/, 'the published author title must identify the measured-scale reconciliation build');
assert.match(animationAuthorSource, /rigReferenceOnly = true/, 'reference NPC must be explicitly marked as comparison-only');
assert.match(animationAuthorSource, /absent from animationAuthor\.actors, selection, gizmos, and exports/, 'reference NPC must remain outside every interactive/exported actor path');
assert.match(animationAuthorSource, /id="maaRandomizeReferenceNpc"/, 'Shoulder Rig must offer one-button reference NPC randomization');
assert.match(animationAuthorSource, /presentation\.scale\.copy\(actor\.rigBodyPresentationBaseScaleV1532\)\.multiplyScalar\(ratio\)/, 'body-scale input must preview on the stable presentation carrier');
assert.doesNotMatch(animationAuthorSource, /actor\.model\.scale\.copy\(actor\.rigBodyModelBaseScaleV1531\)/, 'body-scale input must not mutate the runtime-managed portrait model');
assert.match(animationAuthorSource, /actor\.rigBuiltAvatarScaleV1533 = builtModelWidth \/ baseModelWidth/, 'body-scale reconciliation must measure the scale actually built into the replacement model');
assert.match(animationAuthorSource, /const targetScale = resolvedRigActorAvatarScaleV1533\(actor, desiredScale\)/, 'body-scale reconciliation must compare built geometry against the live PNG-avatar resolver');
assert.match(animationAuthorSource, /previewRigActorBodyScaleV1531\(actor, anatomy\.portraitScale\)/, 'every newly rebuilt rig actor must reapply its measured carrier correction');
assert.match(animationAuthorSource, /id="maaBodyScaleDiagnostic"/, 'Shoulder Rig must expose built, target, and carrier scale diagnostics without DevTools');
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
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.mashtzarrPortraitCorrection, 'pending');
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.anatomyProfiles, 'pending');
assert.strictEqual(attachmentProfileWindow.HOBUNJI_AUTHORED_CHARACTER_RIG_UPDATES.count, 12);
assert.strictEqual(attachmentProfileWindow.HOBUNJI_AUTHORED_CHARACTER_RIG_UPDATES.exactSuppliedProfiles, 10);
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.authoredCharacterProfiles, 12);
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.parrotSharedProfiles, 2);
const authoredCharacterProfiles = attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters; // Verifies the exact posterior and shoulder values shipped to gameplay and the author.
const expectedAuthoredRigs = {
  'mashtzarr::male': [0.6880202107561688, 0.2938287377558306, 0.471474644548211, -0.3481292844745114, 0.5072329547240978, 0.755, 1.18, 0.925, 1.175, 0],
  'tletingan::male': [8.329594593937665, 0.22770354382724423, 0.42663710735156957, -0.2448354156580218, 0.4465232083661127, 0.645, 0.85, 0.9, 1, 6],
  'kenkari::male': [7.633738099540614, 0.17819817802695415, 0.27810760526210354, -0.18055321970300925, 0.37969897363327487, 0.51, 0.75, 1, 1, 0],
  'rakakoan::male': [7.633738099540614, 0.17819817802695415, 0.27810760526210354, -0.18055321970300925, 0.37969897363327487, 0.51, 0.75, 1, 1, 0],
  'mao-ao::male': [-9.686481272760854, 0.19067248465844266, 0.6947557240731601, -0.28087406205430004, 0.6455541403639915, 0.95, 1, 1.1, 1.05, 0],
  'engh-sho::male': [-12.036557901087457, 0.2721813782445264, 0.6838406837818225, -0.28930388062923146, 0.7000103424366998, 1.005, 0.95, 1.15, 1.275, 0],
  'mao-ao::female': [-4.30199269420537, 0.1771042396564939, 0.6511546407522855, -0.23898599170593354, 0.646996571654354, 0.925, 1, 1, 1.025, 0],
  'engh-sho::female': [-8.338179933841042, 0.20505349784094706, 0.4967497459859368, -0.24815066240089945, 0.46042886220274515, 0.975, 0.95, 1.225, 1.325, 0],
  'mashtzarr::female': [-1.540326776219386, 0.30553153725919435, 0.39823082948935073, -0.2938000697183753, 0.37168801102709437, 0.79, 1.18, 0.9, 1.125, 0],
  'kenkari::female': [14.996754350465022, 0.1629792650553279, 0.29929878500014695, -0.16564616738866406, 0.25011972083640993, 0.51, 0.75, 0.925, 1, 0],
  'rakakoan::female': [14.996754350465022, 0.1629792650553279, 0.29929878500014695, -0.16564616738866406, 0.25011972083640993, 0.51, 0.75, 0.925, 1, 0],
  'tletingan::female': [-1.3735593215106594, 0.19339659287777322, 0.38426858848533485, -0.19326419458235525, 0.38220450093854685, 0.62, 0.85, 0.925, 1.025, 5],
};
for (const [key, [posterior, leftX, leftY, rightX, rightY, placement, bodyScale, handScale, footScale, armLength]] of Object.entries(expectedAuthoredRigs)) {
  const profile = authoredCharacterProfiles[key];
  assert.strictEqual(profile.posteriorRule.heightPercentOffset, posterior, `${key} must retain its authored posterior offset`);
  assert.strictEqual(profile.anchors.leftHandShoulder.position.x, leftX, `${key} must retain its authored left shoulder X`);
  assert.strictEqual(profile.anchors.leftHandShoulder.position.y, leftY, `${key} must retain its reviewed left shoulder Y`);
  assert.strictEqual(profile.anchors.rightHandShoulder.position.x, rightX, `${key} must retain its authored right shoulder X`);
  assert.strictEqual(profile.anchors.rightHandShoulder.position.y, rightY, `${key} must retain its reviewed right shoulder Y`);
  assert.strictEqual(profile.anatomy.portraitVerticalPlacementRatio, placement, `${key} must export its supplied gender-specific portrait Y placement`);
  assert.strictEqual(profile.shoulderPerchRule.portraitVerticalPlacementRatio, placement, `${key} legacy Y metadata must match anatomy`);
  assert.strictEqual(profile.anatomy.portraitScale, bodyScale, `${key} must export an independent body scale`);
  assert.strictEqual(profile.anatomy.handScale, handScale, `${key} must export its supplied hand scale`);
  assert.strictEqual(profile.anatomy.footScale, footScale, `${key} must export its supplied foot scale`);
  assert.strictEqual(profile.anatomy.armLengthHeightPercentOffset, armLength, `${key} must export its supplied free-hand arm length`);
}
assert.strictEqual(authoredCharacterProfiles['rakakoan::male'].handShoulderRule.sharedFrom, 'kenkari::male');
assert.strictEqual(authoredCharacterProfiles['rakakoan::female'].handShoulderRule.sharedFrom, 'kenkari::female');
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
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.mashtzarrPortraitCorrection, 'applied');
assert.strictEqual(attachmentProfileWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.anatomyProfiles, 'applied');
assert.strictEqual(attachmentProfileWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.portraitVerticalPlacement['engh-sho'].male, 1.005, 'profile correction must apply exported portrait Y placement');
assert.strictEqual(attachmentProfileWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.portraitScaleBySpecies['engh-sho'].male, 0.95, 'profile correction must apply exported gender-specific body scale');
assert.strictEqual(attachmentProfileWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale['engh-sho'].male, 1.275, 'profile correction must apply exported foot scale');
assert.strictEqual(appliedHandScales['engh-sho'].male, 1.15, 'profile correction must apply exported hand scale after that runtime loads');

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
