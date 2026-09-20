const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const helperSource = fs.readFileSync('docs/js/species-pose-scaling.js', 'utf8');
const sandbox = { window: {}, console };
vm.runInNewContext(helperSource, sandbox, { filename: 'species-pose-scaling.js' });
const api = sandbox.window.HobunjiSpeciesPoseScale;

assert(api, 'shared species pose scaler must load');
assert.strictEqual(api.MAO_AO_ARM_LENGTH, 0.558);
assert.strictEqual(api.scaleForPose(0.73, 9), 0.73, 'explicit weapon orbit scale must win over anatomical arm length');
assert.strictEqual(api.resolveScale('mao-ao', 'male', 9), 1, "Mao'ao male authored orbit must be exactly 1");
assert.strictEqual(api.resolveScale('mao-ao', 'female', 9), 0.9, "Mao'ao female authored orbit must be exactly 0.9");
assert.strictEqual(api.resolveScale('engh-sho', 'male', 9), 0.7, 'Engh-sho male authored orbit must be exactly 0.7');
assert.strictEqual(api.resolveScale('engh-sho', 'female', 9), 0.65, 'Engh-sho female authored orbit must be exactly 0.65');
assert.strictEqual(api.resolveScale('kenkari', 'male', 9), 0.5, 'Kenkari male authored orbit must be exactly 0.5');
assert.strictEqual(api.resolveScale('kenkari', 'female', 9), 0.4, 'Kenkari female authored orbit must be exactly 0.4');
assert.strictEqual(api.resolveScale('rakakoan', 'male', 9), 0.5, "Rakako'an male authored orbit must be exactly 0.5");
assert.strictEqual(api.resolveScale('rakakoan', 'female', 9), 0.4, "Rakako'an female authored orbit must be exactly 0.4");
assert.strictEqual(api.resolveScale('mashtzarr', 'male', 9), 0.8, 'Mashtzarr male authored orbit must be exactly 0.8');
assert.strictEqual(api.resolveScale('mashtzarr', 'female', 9), 0.65, 'Mashtzarr female authored orbit must be exactly 0.65');
assert.strictEqual(api.resolveScale('tletingan', 'male', 0.1), 0.5, 'Tletingan male authored orbit must be exactly 0.5');
assert.strictEqual(api.resolveScale('tletingan', 'female', 0.1), 0.47, 'Tletingan female authored orbit must be exactly 0.47');
assert(Math.abs(api.scaleForPose(null, 0.612) - (0.612 / 0.558)) < 1e-12, 'missing explicit orbit may use arm length only as a legacy fallback');

api.setScale('kenkari', 'female', 0.72);
assert.strictEqual(api.resolveScale('kenkari', 'female', 99), 0.72, 'editor-authored orbit scale must update independently from anatomy');
assert.strictEqual(api.getConfig().species.kenkari.female, 0.72, 'edited orbit scale must be exportable');

const raw = { x: -0.21, y: 0.77, z: 0.19 };
const centroid = { x: 0.03, y: 0.41, z: -0.02 };
const mao = { ...raw };
api.scalePointAroundCentroid(mao, centroid.x, centroid.y, centroid.z, 99, 1);
assert.deepStrictEqual(mao, raw, 'explicit scale-1 point must use the exact fast path');

for (const orbitScale of [0.65, 1.25]) {
  const point = { ...raw };
  api.scalePointAroundCentroid(point, centroid.x, centroid.y, centroid.z, 999, orbitScale);
  for (const axis of ['x', 'z']) {
    const expected = centroid[axis] + (raw[axis] - centroid[axis]) * orbitScale;
    assert(Math.abs(point[axis] - expected) < 1e-12, `${axis} displacement must scale by explicit horizontal orbit scale`);
  }
  assert.strictEqual(point.y, raw.y, 'poseOrbitScale must never change Y');
  api.unscalePointAroundCentroid(point, centroid.x, centroid.y, centroid.z, 0.001, orbitScale);
  for (const axis of ['x', 'y', 'z']) {
    assert(Math.abs(point[axis] - raw[axis]) < 1e-12, `horizontal orbit inverse round-trip failed on ${axis}`);
  }
}

// Synthetic rigger-height fixture: portrait model height and whole-character
// rigScaleY jointly define vertical proportions; head/hand/foot settings do not.
sandbox.window.SCRATCHBONES_CONFIG = {
  game: { assets: { pngPlaneAvatar: { worldModelWidth: 0.9, portraitScaleBySpecies: { 'mao-ao': { male: 1 } } } } },
};
sandbox.window.HobunjiCharacterRigScaleDefaults = {
  scaleFor(species, gender) {
    return String(species) === 'mao-ao' && String(gender) === 'male'
      ? { x: 1, y: 0.99, head: 3, offsetY: 0.4 }
      : { x: 1, y: 1, head: 1, offsetY: 0 };
  },
};
const height = api.heightMetrics('engh-sho', 'male', 0.72, 0.8);
assert(Math.abs(height.referenceHeight - 0.891) < 1e-12, 'Mao-ao male reference height must compose portrait model height with rigger Y');
assert(Math.abs(height.effectiveHeight - 0.576) < 1e-12, 'target rendered height must compose portrait model height with rigger Y');
assert(Math.abs(height.heightRatio - (0.576 / 0.891)) < 1e-12, 'vertical pose scale must be proportional to rendered character height');

const splitRaw = { x: 0.5, y: 0.6, z: -0.25 };
const splitPoint = { ...splitRaw };
api.transformPosePoint(splitPoint, {
  cx: 0, cz: 0, floorY: 0, baseY: 0.4,
  speciesId: 'engh-sho', gender: 'male',
  modelHeight: 0.72, rigScaleY: 0.8,
  armLength: 999, poseOrbitScale: 0.5,
});
assert(Math.abs(splitPoint.x - 0.25) < 1e-12, 'X must use authored horizontal orbit scale');
assert(Math.abs(splitPoint.z + 0.125) < 1e-12, 'Z must use authored horizontal orbit scale');
assert(Math.abs(splitPoint.y - (0.32 + 0.2 * (0.576 / 0.891))) < 1e-12, 'Y must use rigger-scaled hand anchor plus rendered-height-scaled authored Y displacement');
api.untransformPosePoint(splitPoint, {
  cx: 0, cz: 0, floorY: 0, baseY: 0.4,
  speciesId: 'engh-sho', gender: 'male',
  modelHeight: 0.72, rigScaleY: 0.8,
  armLength: 999, poseOrbitScale: 0.5,
});
for (const axis of ['x', 'y', 'z']) assert(Math.abs(splitPoint[axis] - splitRaw[axis]) < 1e-12, `full split transform inverse failed on ${axis}`);

const orbitConfig = JSON.parse(fs.readFileSync('docs/config/combat/species-pose-orbit-scales.json', 'utf8'));
assert.strictEqual(orbitConfig.schema, 'hobunji_species_pose_orbit_scales.v1');
assert.deepStrictEqual(orbitConfig.species, {
  'mao-ao': { male: 1, female: 0.9 },
  'engh-sho': { male: 0.7, female: 0.65 },
  kenkari: { male: 0.5, female: 0.4 },
  rakakoan: { male: 0.5, female: 0.4 },
  mashtzarr: { male: 0.8, female: 0.65 },
  tletingan: { male: 0.5, female: 0.47 },
}, 'repo defaults must exactly match the complete authored species+gender orbit table');

const game = fs.readFileSync('docs/game.js', 'utf8');
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const ranged = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8');
const npc = fs.readFileSync('docs/js/npc-held-equipment-v4.js', 'utf8');
const png = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const localDb = fs.readFileSync('docs/js/local-db-overrides.js', 'utf8');
const lifePreview = fs.readFileSync('docs/js/onboarding-character-creation-life-preview.js', 'utf8');
const weaponPreview = fs.readFileSync('docs/js/onboarding-character-creation-weapon-view-fix.js', 'utf8');
const heldActions = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');
const idleConfig = fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8');

assert.match(png, /root\.userData\.poseOrbitScale = poseOrbitScale/, 'avatar must cache explicit orbit scale separately from arm length');
assert.match(png, /HobunjiSpeciesPoseScale\?\.resolveScale/, 'avatar construction must resolve species+gender orbit from authored config');
assert.match(game, /let playerPoseOrbitScale = 1/, 'player must cache explicit pose orbit scale');
assert.match(game, /scaleForPose\?\.\(playerPoseOrbitScale, playerArmLength\)/, 'player final pose scale must prefer explicit orbit over anatomy');
assert.match(game, /transformPosePoint\(point, \{[\s\S]*baseY,[\s\S]*modelHeight: playerAvatarModelHeight[\s\S]*poseOrbitScale: playerPoseOrbitScale/, 'player finished point must split horizontal orbit from rigger-derived vertical height mapping');
assert.match(bandit, /poseOrbitScale/, 'bandit melee must propagate explicit orbit scale');
assert.match(bandit, /scaleForPose/, 'bandit melee debug/result scale must not derive primarily from arm length');
assert.match(ranged, /poseOrbitScale/, 'bandit ranged must use explicit orbit scale');
assert.match(npc, /poseOrbitScale/, 'NPC held equipment must use explicit orbit scale');
assert.match(lifePreview, /poseOrbitScale/, 'onboarding life preview must use explicit orbit scale');
assert.match(weaponPreview, /poseOrbitScale/, 'onboarding weapon view must use explicit orbit scale');
assert.match(localDb, /speciesPoseOrbitScales/, 'local database override system must expose orbit-scale authoring for in-game testing');

assert.match(editor, /id="poseOrbitScale"/, 'Attack Editor must expose a species+gender orbit scale field');
assert.match(editor, /orbitScalesDownloadBtn/, 'Attack Editor must export the authored orbit-scale database');
assert.match(editor, /setOverride\('speciesPoseOrbitScales'/, 'Attack Editor must save orbit scales as a testable local game override');
assert.match(editor, /setScale\?\.\(\$\('avatarSpecies'\)\.value, \$\('avatarGender'\)\.value, value\)/, 'editor scale control must edit the selected species+gender only');
assert.match(editor, /currentPoseOrbitScale/, 'editor preview and diagnostics must use the authored orbit value');
assert.match(editor, /untransformPosePoint[\s\S]*currentAvatarModelHeight[\s\S]*currentPoseOrbitScale/, 'editor gizmo inverse must undo both horizontal orbit and rigger-height Y mapping');
assert.match(editor, /transformPosePoint[\s\S]*currentAvatarModelHeight[\s\S]*currentPoseOrbitScale/, 'editor preview must apply horizontal orbit and rigger-height Y mapping');
assert.match(editor, /characterBodyScaleRoot/, 'Attack Editor must keep CharacterRigScale on the body root instead of double-scaling the weapon hierarchy');
assert.match(editor, /character-rig-scale-defaults\.js/, 'Attack Editor must consume the same character-rigger height defaults as Multi-Avatar Animation Author');

assert.doesNotMatch(helperSource, /Math\.hypot|lengthSq|setLength/, 'shared pose scaler must remain direct per-axis mapping, not a reach clamp');
assert.match(helperSource, /Y must never be derived from poseOrbitScale again/, 'shared helper must document the XZ-orbit/Y-height ownership split');
assert.match(helperSource, /head scale\/Y offset, age hunch, hand[\s\S]*foot scale/i, 'vertical weapon scaling must explicitly exclude head-only and attachment-only scale controls');
assert.doesNotMatch(heldActions, /HobunjiSpeciesPoseScale/, 'timing/rotation action data must remain independent of translation scaling');
assert.doesNotMatch(idleConfig, /armLength|poseOrbitScale|poseCentroid|SpeciesPoseScale/i, 'authored idle pose data must not contain species scaling');

const tletingan = JSON.parse(fs.readFileSync('docs/config/species/tletingan.json', 'utf8'));
assert.strictEqual(tletingan.male.armLength, 0.612, 'anatomical arm length must remain intact');
assert.strictEqual(tletingan.female.armLength, 0.603, 'anatomical arm length must remain intact');

console.log('species/gender authored pose orbit scaling regression: ok');
