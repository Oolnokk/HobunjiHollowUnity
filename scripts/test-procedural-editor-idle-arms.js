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

function worldOffset(node) {
  const out = new Vector3();
  for (let cursor = node; cursor; cursor = cursor.parent) {
    out.x += Number(cursor.position?.x) || 0;
    out.y += Number(cursor.position?.y) || 0;
    out.z += Number(cursor.position?.z) || 0;
  }
  return out;
}

function makeNode(name, position = new Vector3()) {
  return {
    isObject3D: true,
    name,
    type: 'Group',
    position,
    scale: new Vector3(1, 1, 1),
    userData: {},
    children: [],
    parent: null,
    add(...objects) {
      for (const object of objects) {
        if (object.parent) object.parent.children = object.parent.children.filter(child => child !== object);
        object.parent = this;
        this.children.push(object);
      }
      return this;
    },
    traverse(callback) {
      const visit = node => {
        callback(node);
        for (const child of node.children || []) visit(child);
      };
      visit(this);
    },
    getObjectByName(wanted) {
      let found = null;
      this.traverse(node => { if (!found && node.name === wanted) found = node; });
      return found;
    },
    updateMatrix() {},
    updateWorldMatrix() {},
    updateMatrixWorld() {},
    localToWorld(point) {
      const offset = worldOffset(this);
      point.x += offset.x; point.y += offset.y; point.z += offset.z;
      return point;
    },
    worldToLocal(point) {
      const offset = worldOffset(this);
      point.x -= offset.x; point.y -= offset.y; point.z -= offset.z;
      return point;
    },
    getWorldPosition(out) { return out.copy(worldOffset(this)); },
  };
}

// Reproduce the REAL procedural editor hierarchy seen in mobile Diagnostics:
// DirectionalPoseRoot -> portrait model at local Y=0 -> generated hands root -> hands.
// Full Character Scale instead lifts the portrait by +modelHeight/2, so parity must
// synthesize that lift rather than trusting the editor model's current zero Y.
const poseRoot = makeNode('Preview_DirectionalPoseRoot', new Vector3(0, -0.1, 0));
const model = makeNode('Preview', new Vector3(0, 0, 0));
model.userData = {
  portraitModelHeight: 1,
  portraitModelWidth: 0.9,
  handAttachX: -0.2,
  handAttachY: 0.45,
  experimentalFeet: { speciesId: 'test-species', gender: 'male' },
};
poseRoot.add(model);
const handsRoot = makeNode('Preview_procedural_hands');
model.add(handsRoot);
const left = makeNode('Preview_LeftHand', new Vector3(-0.2, 0.45, 0));
const right = makeNode('Preview_RightHand', new Vector3(0.2, 0.45, 0));
handsRoot.add(left, right);

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
const scene = { name: 'Scene', type: 'Scene', onBeforeRender: null };
const frames = [];
const diagnostics = [];
let danceDebug = { enabled: false, armStyle: 'none' };
const windowObject = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: { 'test-species::male': profile } },
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
frames.shift()();
assert.strictEqual(typeof scene.onBeforeRender, 'function', 'adapter should attach final pre-render parity hook');

// The editor creates the wrappers in its old reversed side convention; normalize them first.
assert(Math.abs(left.position.x - 0.2) < 1e-9, 'left generated hand should normalize to gameplay left=-handAttachX');
assert(Math.abs(right.position.x + 0.2) < 1e-9, 'right generated hand should normalize to gameplay right=+handAttachX');
scene.onBeforeRender();

// Canonical floor Y = 0.30 posterior - 0.10 arm = 0.20. The REAL editor model is
// at local Y=0, but Full Character Scale would lift it +0.50. Therefore the hand
// wrapper must be at -0.30 relative to the editor portrait, not +0.20.
assert(Math.abs(left.position.x - 0.25) < 1e-9, 'left hand X should use canonical shoulder X');
assert(Math.abs(left.position.y + 0.30) < 1e-9, 'virtual Full Character Scale portrait lift must be subtracted even though actual editor portrait Y is zero');
assert(Math.abs(left.position.z - 0.003) < 1e-9, 'left idle Z should preserve shared breathing');
const expectedRightFloorY = 0.20 + 0.0045 * Math.sin(0.28);
assert(Math.abs(right.position.y - (expectedRightFloorY - 0.5)) < 1e-9, 'right hand should use the same virtual +height/2 portrait lift');

const debug = windowObject.HobunjiProceduralEditorIdleArms.getDebug();
assert.strictEqual(debug.fullScaleSpace.actualEditorPortraitLocalY, 0, 'diagnostic must prove the procedural editor portrait is actually at zero');
assert(Math.abs(debug.fullScaleSpace.fullCharacterScalePortraitLiftY - 0.5) < 1e-9, 'diagnostic must expose synthesized Full Character Scale +height/2 lift');
assert(Math.abs(debug.left.targetFloorLocal.y - 0.20) < 1e-9, 'debug must expose canonical Full Character Scale floor Y');
assert(Math.abs(debug.left.targetHandParentLocal.y + 0.30) < 1e-9, 'debug must expose converted procedural-editor hand-parent Y');
assert(Math.abs(debug.left.positionFullScaleFloorLocal.y - 0.20) < 1e-9, 'rendered hand should map back to canonical floor Y after virtual lift');
assert(Math.abs(debug.left.verticalArmDropFloor - (0.6 / 0.9 - 0.20)) < 1e-9, 'debug should report actual shoulder-to-hand drop in canonical floor space');
assert(diagnostics.some(entry => /Full Character Scale portrait lift/.test(entry.message)), 'mobile Diagnostics should name the source parity rule');

const canonical = windowObject.HobunjiProceduralEditorIdleArms.getCanonicalTarget('left', 0);
assert(Math.abs(canonical.virtualPortraitLiftY - 0.5) < 1e-9, 'canonical API should expose virtual portrait lift');
assert(Math.abs(canonical.floorTarget.y - 0.20) < 1e-9, 'canonical API should expose floor target before editor conversion');
assert(Math.abs(canonical.handParentTarget.y + 0.30) < 1e-9, 'canonical API should expose actual generated-hand target after conversion');

// Explicit writers still win per side, and ending explicit Dance reacquires canonical idle.
left.position.set(0.7, 0.7, 0.7);
scene.onBeforeRender();
assert.deepStrictEqual([left.position.x, left.position.y, left.position.z], [0.7, 0.7, 0.7], 'idle fallback must yield to another animation writer');
assert.strictEqual(windowObject.HobunjiProceduralEditorIdleArms.getDebug().left.owns, false, 'debug should expose per-side ownership loss');
danceDebug = { enabled: true, armStyle: 'raise-reach' };
right.position.set(-0.8, 0.9, 0.4);
scene.onBeforeRender();
assert.deepStrictEqual([right.position.x, right.position.y, right.position.z], [-0.8, 0.9, 0.4], 'explicit Dance arms must retain ownership');
danceDebug = { enabled: false, armStyle: 'none' };
scene.onBeforeRender();
assert(Math.abs(left.position.y + 0.30) < 1e-9, 'ending explicit Dance should reacquire corrected left idle');
assert(Math.abs(right.position.y - (expectedRightFloorY - 0.5)) < 1e-9, 'ending explicit Dance should reacquire corrected right idle');

// A later editor writer may replace scene.onBeforeRender; polling must recover and chain it.
let replacementCalls = 0;
scene.onBeforeRender = () => { replacementCalls += 1; };
frames.shift()();
assert.strictEqual(scene.onBeforeRender.__hobunjiProceduralEditorIdleArms, true, 'idle-arm hook should recover after replacement');
scene.onBeforeRender();
assert.strictEqual(replacementCalls, 1, 'recovered hook should preserve the replaced callback');

assert.match(loaderSource, /procedural-editor-idle-arm-parity\.js/, 'procedural editor loader must keep loading idle-arm parity');
assert.match(source, /virtualPortraitLiftY/, 'adapter must explicitly model Full Character Scale portrait lift');
assert.match(source, /height \/ 2/, 'adapter must use Full Character Scale modelHeight/2 lift contract');
assert.match(source, /fullScaleFloorToHandParent/, 'canonical floor target must bridge through virtual lifted portrait into actual hand parent');
assert.match(source, /HOBUNJI_ATTACHMENT_RIG_MATH\?\.characterPosteriorY/, 'editor idle arms must reuse canonical posterior resolver');
assert.match(source, /armLengthHeightPercentOffset/, 'editor idle arms must consume authored arm-length setting');
assert.match(source, /hand\.position\.copy\(target\)/, 'editor idle arms must drive existing generated hand wrappers');

console.log('procedural editor idle arms: real zero-Y editor hierarchy + virtual Full Character Scale lift PASS');
