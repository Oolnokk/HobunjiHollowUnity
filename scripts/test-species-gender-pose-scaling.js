const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const helperSource = fs.readFileSync('docs/js/species-pose-scaling.js', 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(helperSource, sandbox, { filename: 'species-pose-scaling.js' });
const api = sandbox.window.HobunjiSpeciesPoseScale;

assert(api, 'shared species pose scaler must load');
assert.strictEqual(api.MAO_AO_ARM_LENGTH, 0.558);
assert.strictEqual(api.scaleForArmLength(0.558), 1, "Mao'ao must remain exactly scale 1");
assert(Math.abs(api.scaleForArmLength(0.612) - (0.612 / 0.558)) < 1e-12, 'Tletingan male ratio must be exactly 0.612/0.558');
assert(Math.abs(api.scaleForArmLength(0.603) - (0.603 / 0.558)) < 1e-12, 'Tletingan female ratio must be exactly 0.603/0.558');

const raw = { x: -0.21, y: 0.77, z: 0.19 };
const centroid = { x: 0.03, y: 0.41, z: -0.02 };
const mao = { ...raw };
api.scalePointAroundCentroid(mao, centroid.x, centroid.y, centroid.z, 0.558);
assert.deepStrictEqual(mao, raw, "Mao'ao point must be bit-for-bit unchanged by the scale-1 fast path");

for (const reach of [0.612, 0.603]) {
  const point = { ...raw };
  const ratio = reach / 0.558;
  api.scalePointAroundCentroid(point, centroid.x, centroid.y, centroid.z, reach);
  for (const axis of ['x', 'y', 'z']) {
    const expected = centroid[axis] + (raw[axis] - centroid[axis]) * ratio;
    assert(Math.abs(point[axis] - expected) < 1e-12, `${axis} displacement must scale uniformly around centroid`);
  }
  api.unscalePointAroundCentroid(point, centroid.x, centroid.y, centroid.z, reach);
  for (const axis of ['x', 'y', 'z']) {
    assert(Math.abs(point[axis] - raw[axis]) < 1e-12, `editor inverse round-trip failed on ${axis}`);
  }
}

const game = fs.readFileSync('docs/game.js', 'utf8');
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const ranged = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8');
const npc = fs.readFileSync('docs/js/npc-held-equipment-v4.js', 'utf8');
const png = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const portrait = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');
const heldActions = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');
const idleConfig = fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8');

assert.match(png, /poseCentroidY = modelHeight \* 0\.5 \+ assemblyY/, 'centroid must include the avatar hierarchy assemblyY offset');
assert.match(png, /scaledArmLength = armLength == null \? null : armLength \* \(modelHeight \/ 0\.9\)/, 'rendered reach must remain separate from canonical attack reach');
assert.match(portrait, /armLength: Number\.isFinite\(Number\(genderData\.armLength\)\)/, 'species arm length must survive portrait/profile construction');
assert.match(game, /scaleToolWorldPointAroundPlayerCentroid\(toolHolder\.position\)/, 'player attack/ranged paths must transform the finished point');
assert.match(game, /playerPoseCentroidY/, 'player must consume cached visual centroid metadata');
assert.match(bandit, /scaleBanditToolPositionAroundCentroid\(c, holder\)/, 'bandit melee must use the same transform rule');
assert.match(ranged, /HobunjiSpeciesPoseScale\?\.scalePointAroundCentroid/, 'bandit ranged must use the shared transform rule');
assert.match(npc, /Preserve the exact pre-arm-length Mao'ao path/, "Mao'ao NPC path must preserve the old direct-copy path");
assert.match(editor, /unscalePointAroundCentroid/, 'editor gizmo must inverse-transform before writing authored x/y/z');
assert.match(editor, /lastAuthoredPose/, 'editor must expose authored and scaled positions in visible diagnostics');

assert.doesNotMatch(helperSource, /Math\.hypot|lengthSq|setLength/, 'shared pose scaler must not implement a spherical reach clamp');
assert.doesNotMatch(helperSource, /Math\.max\s*\(\s*-?1|Math\.min\s*\(\s*1/, 'shared pose scaler must not map authored axes into a +/-1 coordinate range');
assert.doesNotMatch(heldActions, /HobunjiSpeciesPoseScale/, 'timing/rotation action data must remain independent of translation scaling');
assert.doesNotMatch(idleConfig, /armLength|poseCentroid|SpeciesPoseScale/i, 'authored idle pose data must not be rewritten by species scaling');

const tletingan = JSON.parse(fs.readFileSync('docs/config/species/tletingan.json', 'utf8'));
assert.strictEqual(tletingan.male.armLength, 0.612);
assert.strictEqual(tletingan.female.armLength, 0.603);
for (const path of ['mao-ao', 'engh-sho', 'kenkari', 'mashtzarr']) {
  const data = JSON.parse(fs.readFileSync(`docs/config/species/${path}.json`, 'utf8'));
  assert.strictEqual(data.male.armLength, 0.558);
  assert.strictEqual(data.female.armLength, 0.558);
}

console.log('species/gender centroid pose scaling regression: ok');
