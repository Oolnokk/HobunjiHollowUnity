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
assert.strictEqual(api.resolveScale('kenkari', 'female', 9), 1, 'Kenkari female authored orbit must be independent from arm length');
assert(Math.abs(api.resolveScale('tletingan', 'male', 0.1) - (0.612 / 0.558)) < 1e-12, 'default Tletingan male orbit must preserve the prior visible ratio until re-authored');
assert(Math.abs(api.resolveScale('tletingan', 'female', 0.1) - (0.603 / 0.558)) < 1e-12, 'default Tletingan female orbit must preserve the prior visible ratio until re-authored');
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
  for (const axis of ['x', 'y', 'z']) {
    const expected = centroid[axis] + (raw[axis] - centroid[axis]) * orbitScale;
    assert(Math.abs(point[axis] - expected) < 1e-12, `${axis} displacement must scale uniformly by explicit orbit scale`);
  }
  api.unscalePointAroundCentroid(point, centroid.x, centroid.y, centroid.z, 0.001, orbitScale);
  for (const axis of ['x', 'y', 'z']) {
    assert(Math.abs(point[axis] - raw[axis]) < 1e-12, `editor inverse round-trip failed on ${axis}`);
  }
}

const orbitConfig = JSON.parse(fs.readFileSync('docs/config/combat/species-pose-orbit-scales.json', 'utf8'));
assert.strictEqual(orbitConfig.schema, 'hobunji_species_pose_orbit_scales.v1');
assert.strictEqual(orbitConfig.species['mao-ao'].male, 1);
assert.strictEqual(orbitConfig.species['mao-ao'].female, 1);
assert(Math.abs(orbitConfig.species.tletingan.male - (0.612 / 0.558)) < 1e-12);
assert(Math.abs(orbitConfig.species.tletingan.female - (0.603 / 0.558)) < 1e-12);
for (const speciesId of ['engh-sho', 'kenkari', 'rakakoan', 'mashtzarr']) {
  assert.strictEqual(orbitConfig.species[speciesId].male, 1);
  assert.strictEqual(orbitConfig.species[speciesId].female, 1);
}

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
assert.match(game, /scalePointAroundCentroid\(point, cx, cy, cz, playerArmLength, playerPoseOrbitScale\)/, 'player finished point must receive explicit orbit scale');
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
assert.match(editor, /unscalePointAroundCentroid[\s\S]*currentPoseOrbitScale/, 'editor gizmo inverse must use the same explicit orbit scale');
assert.match(editor, /scalePointAroundCentroid[\s\S]*currentPoseOrbitScale/, 'editor preview forward transform must use the same explicit orbit scale');

assert.doesNotMatch(helperSource, /Math\.hypot|lengthSq|setLength/, 'shared pose scaler must remain uniform centroid orbit math, not a reach clamp');
assert.doesNotMatch(heldActions, /HobunjiSpeciesPoseScale/, 'timing/rotation action data must remain independent of translation scaling');
assert.doesNotMatch(idleConfig, /armLength|poseOrbitScale|poseCentroid|SpeciesPoseScale/i, 'authored idle pose data must not contain species scaling');

const tletingan = JSON.parse(fs.readFileSync('docs/config/species/tletingan.json', 'utf8'));
assert.strictEqual(tletingan.male.armLength, 0.612, 'anatomical arm length must remain intact');
assert.strictEqual(tletingan.female.armLength, 0.603, 'anatomical arm length must remain intact');

console.log('species/gender authored pose orbit scaling regression: ok');
