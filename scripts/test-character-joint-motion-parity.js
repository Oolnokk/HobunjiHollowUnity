'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/character-joint-motion-parity.js'), 'utf8');
const editorBootstrap = fs.readFileSync(path.join(root, 'docs/js/procedural-dance-mode.js'), 'utf8');
const preservedEditorAdapter = fs.readFileSync(path.join(root, 'docs/js/procedural-dance-mode-base.js'), 'utf8');
const latestBootstrap = fs.readFileSync(path.join(root, 'docs/js/attachment-rig-latest-authored-snapshot.js'), 'utf8');
const latestSnapshot = fs.readFileSync(path.join(root, 'docs/js/attachment-rig-latest-authored-snapshot-core.js'), 'utf8');
const maoShoulders = fs.readFileSync(path.join(root, 'docs/js/character-rig-maoao-authored-20260905.js'), 'utf8');
const danceCore = fs.readFileSync(path.join(root, 'docs/js/procedural-dance-mode-core.js'), 'utf8');

function position(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
    clone() { return position(this.x, this.y, this.z); },
  };
}

const leftHip = { position: position(0.1, 0.1, 0) };
const rightHip = { position: position(-0.1, 0.1, 0) };
const legGroup = {
  name: 'player_procedural_feet',
  getObjectByName(name) {
    if (name === 'left_hip') return leftHip;
    if (name === 'right_hip') return rightHip;
    return null;
  },
};
let updateCalls = 0;
const rawHandle = {
  group: legGroup,
  update() { updateCalls += 1; },
  dispose() {},
  getStandingPoseDebug() { return { posteriorY: 0.1 }; },
  standingPosteriorY: 0.1,
};

const profiles = {
  'mao-ao::male': {
    species: 'mao-ao',
    gender: 'male',
    posteriorRule: { heightPercentFromFloor: 47.59386702606408 },
    anchors: {
      shoulderPerch: { position: { x: 0.282, y: 0.6234902368619534, z: 0 } },
      leftHandShoulder: { position: { x: 0.1525554542608865, y: 0.6292184955362587, z: 0 } },
      rightHandShoulder: { position: { x: -0.22929652083051758, y: 0.6455541403639915, z: 0 } },
    },
    anatomy: { portraitScale: 1 },
    handShoulderRule: { runtimeBaseWidth: 0.9 },
    shoulderPerchRule: { portraitModelHeight: 0.9 },
  },
};

const raf = [];
const windowObject = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: profiles },
  HOBUNJI_ATTACHMENT_RIG_MATH: {
    characterPosteriorY(rule, modelHeight) { return modelHeight * Number(rule?.heightPercentFromFloor || 0) / 100; },
  },
};
const sandbox = {
  window: windowObject,
  document: {
    currentScript: { src: 'https://example.test/docs/js/character-joint-motion-parity.js' },
    getElementById() { return null; },
    createElement() { throw new Error('game-path test must not dynamically load preview scripts'); },
  },
  location: { href: 'https://example.test/docs/index.html', pathname: '/docs/index.html' },
  performance: { now: () => 123 },
  requestAnimationFrame(callback) { raf.push(callback); return raf.length; },
  cancelAnimationFrame() {},
  console,
  URL,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(source, sandbox, { filename: 'character-joint-motion-parity.js' });

assert.strictEqual(windowObject.HobunjiCharacterJointMotionParity?.installed, true, 'joint parity API should install');

// The sidecar loads before ProceduralLegAnimation in gameplay. Assignment must be
// intercepted and attach() wrapped so the existing handle follows CURRENT profile Y.
windowObject.ProceduralLegAnimation = {
  attach(_THREE, _parent, _options) { return rawHandle; },
};
const avatarRoot = { userData: { portraitModelHeight: 0.9, handAttachY: 0.423 }, parent: null };
const handle = windowObject.ProceduralLegAnimation.attach(null, null, {
  name: 'player', speciesId: 'mao-ao', gender: 'male', modelHeight: 0.9, handAttachY: 0.423, avatarRoot,
});
const expectedInitial = 0.9 * 47.59386702606408 / 100;
assert(Math.abs(leftHip.position.y - expectedInitial) < 1e-12, 'left hip must initialize from current species+gender posterior Y');
assert(Math.abs(rightHip.position.y - expectedInitial) < 1e-12, 'right hip must initialize from current species+gender posterior Y');
assert(Math.abs(handle.standingPosteriorY - expectedInitial) < 1e-12, 'standingPosteriorY must be a live posterior getter');

// Simulate a late authored snapshot/profile edit after the leg handle already exists.
profiles['mao-ao::male'].posteriorRule.heightPercentFromFloor = 52.5;
leftHip.position.y = 0.01;
rightHip.position.y = 0.01;
handle.update(1 / 60, 4, false, null);
assert.strictEqual(updateCalls, 1, 'wrapped update must preserve the original leg update');
assert(Math.abs(leftHip.position.y - 0.4725) < 1e-12, 'left hip must follow a posterior rule that changed after attach');
assert(Math.abs(rightHip.position.y - 0.4725) < 1e-12, 'right hip must follow a posterior rule that changed after attach');
assert(Math.abs(handle.standingPosteriorY - 0.4725) < 1e-12, 'standing posterior getter must not freeze attach-time Y');
const poseDebug = handle.getStandingPoseDebug();
assert(Math.abs(poseDebug.livePosteriorY - 0.4725) < 1e-12, 'mobile diagnostics must expose the live posterior Y');
assert.strictEqual(poseDebug.posteriorSource, 'species+gender-current-profile');

// Restore the real latest male value before the shoulder/perch sanity test.
profiles['mao-ao::male'].posteriorRule.heightPercentFromFloor = 47.59386702606408;
const sanity = windowObject.HobunjiCharacterJointMotionParity.maoAoShoulderSanity('male');
assert(sanity, 'Mao-ao male shoulder/perch sanity diagnostic should resolve');
assert(Math.abs(sanity.leftDeltaFromPerch) < 0.01, 'Mao-ao male left hand shoulder Y should be near shoulder-pet perch Y');
assert(Math.abs(sanity.rightDeltaFromPerch) < 0.03, 'Mao-ao male right hand shoulder Y should be near shoulder-pet perch Y');
assert.strictEqual(sanity.likelyAuthoringError, false, 'close Mao-ao male shoulder/perch Ys prove this is an interpretation bug, not a shoulder authoring bug');

// The current authored files must retain those intended values; this catches a future
// regression that accidentally tests only our VM fixture instead of repository data.
assert.match(latestSnapshot, /'mao-ao::male'[\s\S]*heightPercentFromFloor:\s*47\.59386702606408/,
  'latest authored snapshot must provide Mao-ao male posterior Y');
assert.match(maoShoulders, /'mao-ao::male'[\s\S]*leftHandShoulder:[\s\S]*y:\s*0\.6292184955362587[\s\S]*rightHandShoulder:[\s\S]*y:\s*0\.6455541403639915/,
  'latest Mao-ao shoulder authoring must remain close to the shoulder-pet perch');

// Preview bootstrap must install shared joint parity BEFORE the preserved Dance adapter,
// which itself remains the existing generated-feet/idle-hand integration rather than a rewrite.
const jointIndex = editorBootstrap.indexOf('character-joint-motion-parity.js');
const baseIndex = editorBootstrap.indexOf('procedural-dance-mode-base.js');
assert(jointIndex >= 0 && baseIndex > jointIndex, 'procedural editor must load joint parity before its existing Dance adapter');
assert.match(preservedEditorAdapter, /installEditorGeneratedFeetDanceBridge/, 'preserved Dance adapter must still install the generated-feet bridge');
assert.match(latestBootstrap, /character-rig-maoao-authored-20260905\.js[\s\S]*character-joint-motion-parity\.js/,
  'game bootstrap must install joint parity after latest rig + Mao shoulder authoring');

// Guard the exact bad preview heuristic. It can remain as the pre-correction Dance
// implementation for compatibility, but the shared sidecar must explicitly replace its
// shoulder origin with authored anchors before rendering.
assert.match(danceCore, /SHOULDER_X_FRACTION\s*=\s*0\.62/, 'test fixture expects the legacy Dance shoulder heuristic to still exist upstream');
assert.match(source, /resolveShoulderForRig/, 'game Dance correction must resolve authored shoulder anchors');
assert.match(source, /correctPreviewDanceShoulders/, 'preview Dance correction must resolve authored shoulder anchors');
assert.match(source, /patchPreviewHipLines/, 'preview movement hip bridge must follow the live posterior profile');
assert.match(source, /profilePercentFromFloor/, 'diagnostics must expose which authored posterior percent drove the hip');
assert.match(source, /maoAoShoulderSanity/, 'diagnostics must expose shoulder-perch versus hand-shoulder Y comparison');

console.log('character joint motion parity: live posterior hips + authored Dance shoulders + Mao-ao perch sanity PASS');
