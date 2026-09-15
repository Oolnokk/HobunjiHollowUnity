'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/procedural-editor-idle-arm-parity.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'docs/js/procedural-dance-mode.js'), 'utf8');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
}

function makeHand(name, x, y, z = 0) {
  return {
    name,
    position: new Vector3(x, y, z),
    parent: null,
    children: [],
    updateMatrix() {},
    updateMatrixWorld() {},
  };
}

// Keep one already-existing pair at the historical procedural-editor sign convention
// so the compatibility acquisition path remains covered too.
const left = makeHand('Preview_LeftHand', -0.2, 0.45);
const right = makeHand('Preview_RightHand', 0.2, 0.45);
const torso = {
  name: 'torso',
  children: [],
  userData: {},
  material: { map: { image: { src: 'https://example.test/portraitsprites/torso_test-species_m.png' } } },
};
const model = {
  name: 'Preview',
  position: new Vector3(),
  scale: new Vector3(1, 1, 1),
  userData: { portraitModelHeight: 1, portraitModelWidth: 0.9, handAttachX: -0.2, handAttachY: 0.45 },
  children: [left, right, torso],
  parent: null,
  add(...objects) {
    for (const object of objects) { object.parent = this; this.children.push(object); }
    return this;
  },
  getObjectByName(name) {
    let found = null;
    this.traverse(node => { if (!found && node.name === name) found = node; });
    return found;
  },
  traverse(callback) {
    const visit = node => {
      callback(node);
      for (const child of node.children || []) visit(child);
    };
    visit(this);
  },
  updateMatrixWorld() {},
  localToWorld(point) { return point; },
  worldToLocal(point) { return point; },
};
left.parent = model;
right.parent = model;
torso.parent = model;

const scene = { name: 'Scene', onBeforeRender: null };
const frames = [];
let danceDebug = { enabled: false, armStyle: 'none' };
const diagnostics = [];
const profile = {
  species: 'test-species',
  gender: 'male',
  posteriorRule: { heightPercentFromFloor: 30 },
  handShoulderRule: { runtimeBaseWidth: 0.9 },
  anchors: {
    leftHandShoulder: { position: { x: 0.25, y: 0.6, z: 0 } },
    rightHandShoulder: { position: { x: -0.3, y: 0.6, z: 0 } },
  },
  anatomy: { armLengthHeightPercentOffset: 10 },
};
const windowObject = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: {
    characters: { 'test-species::male': profile },
    characterTransformAliases: {},
  },
  HOBUNJI_ATTACHMENT_RIG_MATH: {
    characterPosteriorY(rule, modelHeight) { return modelHeight * rule.heightPercentFromFloor / 100; },
  },
  HobunjiGameplayBackdrop: {
    getScene() { return scene; },
    getAvatarModel() { return model; },
    log(message, level, extra) { diagnostics.push({ message, level, extra }); },
  },
  ProceduralDanceMode: { getDebug() { return danceDebug; } },
};
const sandbox = {
  window: windowObject,
  performance: { now: () => 0 },
  requestAnimationFrame(callback) { frames.push(callback); },
  console,
};

vm.runInNewContext(source, sandbox, { filename: 'procedural-editor-idle-arm-parity.js' });
assert.strictEqual(windowObject.HobunjiProceduralEditorIdleArms?.installed, true, 'idle-arm parity adapter should expose a debug/sync API');
assert.strictEqual(frames.length, 1, 'idle-arm parity adapter should schedule its hook-integrity loop');
frames.shift()();
assert.strictEqual(typeof scene.onBeforeRender, 'function', 'idle-arm parity adapter should attach a final scene pre-render hook');

// Reproduce the editor's current hand builder after the bridge has seen the avatar.
// The builder supplies the old reversed sides; the root.add boundary must normalize
// them immediately, before any render/parity frame runs.
const generatedHandsRoot = {
  name: 'Preview_procedural_hands',
  children: [],
  parent: null,
  add(...objects) {
    for (const object of objects) { object.parent = this; this.children.push(object); }
    return this;
  },
  updateMatrixWorld() {},
  worldToLocal(point) { return point; },
};
model.add(generatedHandsRoot);
const generatedLeft = makeHand('Generated_LeftHand', -0.2, 0.45);
const generatedRight = makeHand('Generated_RightHand', 0.2, 0.45);
generatedHandsRoot.add(generatedLeft);
generatedHandsRoot.add(generatedRight);
assert.strictEqual(generatedLeft.position.x, 0.2, 'new LeftHand wrappers should be corrected at construction to gameplay left=-handAttachX');
assert.strictEqual(generatedRight.position.x, -0.2, 'new RightHand wrappers should be corrected at construction to gameplay right=+handAttachX');
assert(diagnostics.some(entry => /Corrected newly generated editor hand/.test(entry.message)), 'construction-side correction should be visible in mobile Diagnostics');

scene.onBeforeRender();
assert(Math.abs(left.position.x - 0.25) < 1e-9, 'left idle hand should use the canonical left shoulder X');
assert(Math.abs(left.position.y - 0.2) < 1e-9, 'left idle hand should use posterior Y minus authored arm length at zero idle phase');
assert(Math.abs(left.position.z - 0.003) < 1e-9, 'left idle hand should include the shared idle forward/back breathing offset');
assert(Math.abs(right.position.x + 0.3) < 1e-9, 'right idle hand should use the canonical right shoulder X');
assert(Math.abs(right.position.y - (0.2 + 0.0045 * Math.sin(0.28))) < 1e-9, 'right idle hand should include the shared phase-split idle breathing offset');
assert(Math.abs(right.position.z - (0.003 * Math.cos(0.28))) < 1e-9, 'right idle hand should include the shared phase-split idle depth offset');

const firstDebug = windowObject.HobunjiProceduralEditorIdleArms.getDebug();
assert.strictEqual(firstDebug.identitySource, 'avatar-asset-url', 'portrait asset filenames should recover species/gender when editor model metadata does not publish identity');
assert.strictEqual(firstDebug.left.atLegacyIdleDefault, true, 'already-existing reversed LeftHand should remain an acquireable compatibility default');
assert.strictEqual(firstDebug.right.atLegacyIdleDefault, true, 'already-existing reversed RightHand should remain an acquireable compatibility default');
assert.strictEqual(firstDebug.left.reason, 'claimed-legacy-reversed-idle', 'debug state should identify compatibility acquisition rather than call it the normal editor convention');
assert.strictEqual(firstDebug.generationBridge.installed, true, 'debug state should expose that the generated-hand construction bridge is installed');
assert.strictEqual(firstDebug.generationBridge.correctedCount, 2, 'debug state should count both generated wrappers normalized at construction');
assert.strictEqual(firstDebug.posteriorY, 0.3, 'debug state should expose canonical posterior Y');
assert.strictEqual(firstDebug.armLengthWorldY, -0.1, 'debug state should expose the literal authored arm-length Y contribution');
assert(diagnostics.some(entry => /Resolved gameplay\/Attack Editor free-hand profile/.test(entry.message)), 'resolved species/gender/profile should be visible in the editor Diagnostics panel');
assert(diagnostics.some(entry => /Idle-arm parity diagnostic/.test(entry.message) && entry.extra?.left?.atLegacyIdleDefault), 'mobile Diagnostics should include hand positions, targets, compatibility acquisition, and ownership state');

// Rig-coordinate shoulders are authored against the 0.9 runtime width. A half-width
// preview like Garanki's 0.45-wide model must therefore halve shoulder X before placement.
model.userData.portraitModelWidth = 0.45;
const halfScaleTarget = windowObject.HobunjiProceduralEditorIdleArms.getCanonicalTarget('left', 0);
assert(Math.abs(halfScaleTarget.x - 0.125) < 1e-9, '0.45-wide preview should scale a 0.25 authored shoulder X by 0.5');
assert(Math.abs(halfScaleTarget.shoulderScale - 0.5) < 1e-9, 'debug target should expose the shoulder coordinate scale');
model.userData.portraitModelWidth = 0.9;

// A later render-stage writer can replace scene.onBeforeRender. The polling loop
// must notice and re-chain it rather than silently stopping after first attach.
let replacementCalls = 0;
scene.onBeforeRender = () => { replacementCalls += 1; };
assert(frames.length >= 1, 'hook-integrity loop should continue after initial attach');
frames.shift()();
assert.strictEqual(scene.onBeforeRender.__hobunjiProceduralEditorIdleArms, true, 'idle-arm hook should automatically reattach after another writer replaces it');
scene.onBeforeRender();
assert.strictEqual(replacementCalls, 1, 'reattached idle-arm hook should preserve and chain the later editor callback');
assert(diagnostics.some(entry => /hook was replaced/.test(entry.message)), 'hook replacement/recovery should be visible in mobile Diagnostics');

left.position.set(0.7, 0.7, 0.7);
scene.onBeforeRender();
assert.deepStrictEqual([left.position.x, left.position.y, left.position.z], [0.7, 0.7, 0.7], 'idle fallback must yield when an explicit animation writer moves a hand');
assert.strictEqual(windowObject.HobunjiProceduralEditorIdleArms.getDebug().left.owns, false, 'debug state should expose per-side ownership loss');

danceDebug = { enabled: true, armStyle: 'raise-reach' };
right.position.set(-0.8, 0.9, 0.4);
scene.onBeforeRender();
assert.deepStrictEqual([right.position.x, right.position.y, right.position.z], [-0.8, 0.9, 0.4], 'explicit Dance arm styles must remain higher priority than the idle default');
assert.match(windowObject.HobunjiProceduralEditorIdleArms.getDebug().reason, /^dance:/, 'debug state should identify explicit Dance ownership');

danceDebug = { enabled: false, armStyle: 'none' };
scene.onBeforeRender();
assert(Math.abs(left.position.y - 0.2) < 1e-9, 'ending an explicit Dance arm pose should reacquire canonical idle ownership immediately');
assert(Math.abs(right.position.x + 0.3) < 1e-9, 'ending an explicit Dance arm pose should restore the canonical right-hand shoulder X immediately');

windowObject.HobunjiProceduralEditorIdleArms.logNow();
assert(diagnostics.some(entry => entry.extra?.hook?.attachCount >= 2), 'manual/current diagnostic dump should report hook integrity plus canonical placement values');

assert.match(loaderSource, /procedural-editor-idle-arm-parity\.js/, 'procedural editor Dance loader must load the idle-arm parity adapter');
assert.match(source, /HOBUNJI_ATTACHMENT_RIG_MATH\?\.characterPosteriorY/, 'editor idle arms must reuse the canonical posterior resolver');
assert.match(source, /armLengthHeightPercentOffset/, 'editor idle arms must consume the authored species/gender arm-length setting');
assert.match(source, /npcId/, 'editor idle arms must use the live NPC id when preview metadata omits species/gender');
assert.match(source, /npc-database/, 'editor idle arms must support NPC-database identity resolution');
assert.match(source, /repositoryCommit/, 'NPC identity lookup must stay pinned to the preview repository revision');
assert.match(source, /side === 'left' \? -x : x/, 'normal generated/editor idle convention must exactly match gameplay left=-handAttachX/right=+handAttachX');
assert.match(source, /side === 'left' \? x : -x/, 'old reversed editor convention should remain only as compatibility acquisition');
assert.match(source, /hobunjiGameplaySideHandRootAdd/, 'new generated wrappers must be normalized at their construction boundary, not only after a render frame');
assert.match(source, /currentWidth \/ authoredWidth/, 'authored shoulder X must scale from the 0.9 runtime basis to the current preview width');
assert.match(source, /avatar-asset-url/, 'editor idle arms should retain portrait-asset identity recovery as a no-fetch fallback');
assert.match(source, /hand\.position\.copy\(target\)/, 'editor idle arms must drive the existing generated hand wrapper instead of creating a duplicate hand rig');
assert.match(source, /explicit-animation-owner/, 'editor idle arms must retain explicit animation ownership diagnostics');
assert.match(source, /hook was replaced/, 'editor idle arms must self-heal if another editor writer replaces the final hook');

console.log('procedural editor idle arms: construction-side parity + legacy compatibility + NPC identity + scaled shoulders + diagnostics PASS');
