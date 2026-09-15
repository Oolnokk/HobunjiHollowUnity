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
    getWorldPosition(out) {
      return out.copy(worldOffset(this));
    },
  };
}

function makeHand(name, x, y, z = 0) {
  return makeNode(name, new Vector3(x, y, z));
}

// Reproduce the actual editor hierarchy that the old regression missed:
// character floor root -> portrait model lifted by +height/2 -> generated hands root -> hands.
// Attachment-profile shoulder/posterior coordinates belong to floorRoot, NOT model.
const floorRoot = makeNode('LocomotionFloorRoot');
floorRoot.userData.hobunjiCharacterRigScaleState = {
  factor: { x: 1.1, y: 0.95 },
  groundRelative: true,
  coordinateSpace: 'character-floor-parent',
};

const model = makeNode('Preview', new Vector3(0, 0.5, 0));
model.userData = {
  portraitModelHeight: 1,
  portraitModelWidth: 0.9,
  handAttachX: -0.2,
  handAttachY: 0.45,
  proceduralHandParent: floorRoot,
  experimentalFeet: { speciesId: 'test-species', gender: 'male' },
};
floorRoot.add(model);

const handsRoot = makeNode('Preview_procedural_hands');
model.add(handsRoot);
// These start in the old editor's reversed convention. The construction bridge should normalize them.
const left = makeHand('Preview_LeftHand', -0.2, 0.45);
const right = makeHand('Preview_RightHand', 0.2, 0.45);
handsRoot.add(left, right);

const scene = { name: 'Scene', type: 'Scene', onBeforeRender: null };
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

// The construction bridge must normalize the generated wrapper sides to gameplay before idle claiming.
assert(Math.abs(left.position.x - 0.2) < 1e-9, 'left generated hand should be normalized to gameplay left=-handAttachX');
assert(Math.abs(right.position.x + 0.2) < 1e-9, 'right generated hand should be normalized to gameplay right=+handAttachX');

scene.onBeforeRender();

// Canonical LEFT floor target at t=0 is (0.25, 0.20, 0.003):
// posterior 0.30 - arm length 0.10 + idleY 0, with a 0.003 idle Z.
// Because the portrait model is lifted +0.5, the hand wrapper under that portrait
// must be at y=-0.30 so its FLOOR/WORLD Y is 0.20. This is the regression that
// specifically catches the old "locked to shoulders" double-lift bug.
assert(Math.abs(left.position.x - 0.25) < 1e-9, 'left hand-parent X should match floor-relative canonical shoulder X');
assert(Math.abs(left.position.y + 0.3) < 1e-9, 'lifted portrait must subtract +height/2 when converting floor target to hand-parent local Y');
assert(Math.abs(left.position.z - 0.003) < 1e-9, 'left idle hand should retain shared idle depth breathing');
const leftWorld = left.getWorldPosition(new Vector3());
assert(Math.abs(leftWorld.y - 0.2) < 1e-9, 'left hand world/floor Y must equal posterior minus arm length, not portrait lift plus that value');
assert(Math.abs(leftWorld.y - 0.6) > 0.25, 'left hand must be visibly below its 0.6 floor-relative shoulder instead of pinned near it');

const expectedRightFloorY = 0.2 + 0.0045 * Math.sin(0.28);
const rightWorld = right.getWorldPosition(new Vector3());
assert(Math.abs(right.position.x + 0.3) < 1e-9, 'right hand-parent X should match canonical right shoulder X');
assert(Math.abs(rightWorld.y - expectedRightFloorY) < 1e-9, 'right world/floor Y should use the phase-split idle fallback without re-adding portrait lift');
assert(Math.abs(right.position.z - (0.003 * Math.cos(0.28))) < 1e-9, 'right idle depth should match the shared frame-driver phase');

const firstDebug = windowObject.HobunjiProceduralEditorIdleArms.getDebug();
assert.strictEqual(firstDebug.floorSpace.coordinateSpace, 'character-floor-parent', 'debug must name the canonical Full Character Scale coordinate space');
assert.strictEqual(firstDebug.floorSpace.floorParent, 'LocomotionFloorRoot', 'debug must expose the resolved floor-relative visual parent');
assert(Math.abs(firstDebug.floorSpace.portraitLiftY - 0.5) < 1e-9, 'debug must expose the portrait +height/2 lift that caused the original bug');
assert(Math.abs(firstDebug.left.targetFloorLocal.y - 0.2) < 1e-9, 'debug must expose canonical floor-local hand Y');
assert(Math.abs(firstDebug.left.targetHandParentLocal.y + 0.3) < 1e-9, 'debug must separately expose converted hand-parent-local Y');
assert(Math.abs(firstDebug.left.verticalArmDropFloor - 0.4) < 1e-9, 'debug should show the actual shoulder-to-hand drop in floor space');
assert.strictEqual(firstDebug.fullCharacterScaleAppliedByParent, true, 'full-character scale should be recognized as a parent transform, not baked into rig coordinates');
assert.strictEqual(firstDebug.left.reason, 'claimed-gameplay-idle', 'default generated hand should be claimed from gameplay idle');
assert(diagnostics.some(entry => /Full Character Scale coordinate space/.test(entry.message)), 'resolved profile diagnostic should explicitly call out Full Character Scale coordinate parity');
assert(diagnostics.some(entry => /Idle-arm parity diagnostic/.test(entry.message) && entry.extra?.left?.targetFloorLocal), 'mobile diagnostics should include floor/local/world target values');

// Full Character Scale must not be manually multiplied into authored local rig coordinates.
// The adapter may only apply the baked avatar-size ratio (1.0 here); the floor parent's
// x/y scale remains a hierarchy transform.
const canonical = windowObject.HobunjiProceduralEditorIdleArms.getCanonicalTarget('left', 0);
assert(Math.abs(canonical.floorTarget.x - 0.25) < 1e-9, 'parent full-character X scale must not rewrite authored shoulder X');
assert(Math.abs(canonical.floorTarget.y - 0.2) < 1e-9, 'parent full-character Y scale must not rewrite posterior/arm local Y');
assert(Math.abs(canonical.handParentTarget.y + 0.3) < 1e-9, 'canonical API should report the converted target under the lifted portrait hierarchy');

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

// Explicit writers still win per side.
left.position.set(0.7, 0.7, 0.7);
scene.onBeforeRender();
assert.deepStrictEqual([left.position.x, left.position.y, left.position.z], [0.7, 0.7, 0.7], 'idle fallback must yield when another animation writer moves a hand');
assert.strictEqual(windowObject.HobunjiProceduralEditorIdleArms.getDebug().left.owns, false, 'debug state should expose per-side ownership loss');

danceDebug = { enabled: true, armStyle: 'raise-reach' };
right.position.set(-0.8, 0.9, 0.4);
scene.onBeforeRender();
assert.deepStrictEqual([right.position.x, right.position.y, right.position.z], [-0.8, 0.9, 0.4], 'explicit Dance arm styles must remain higher priority than idle');
assert.match(windowObject.HobunjiProceduralEditorIdleArms.getDebug().reason, /^dance:/, 'debug state should identify explicit Dance ownership');

danceDebug = { enabled: false, armStyle: 'none' };
scene.onBeforeRender();
assert(Math.abs(left.position.y + 0.3) < 1e-9, 'ending Dance should reacquire the floor-correct canonical left idle');
assert(Math.abs(right.position.x + 0.3) < 1e-9, 'ending Dance should restore canonical right shoulder X');

windowObject.HobunjiProceduralEditorIdleArms.logNow();
assert(diagnostics.some(entry => entry.extra?.hook?.attachCount >= 2), 'manual/current diagnostic dump should report hook integrity and canonical placement values');

assert.match(loaderSource, /procedural-editor-idle-arm-parity\.js/, 'procedural editor Dance loader must load the idle-arm parity adapter');
assert.match(source, /character-floor-parent/, 'idle-arm adapter must explicitly use the Full Character Scale floor-relative coordinate contract');
assert.match(source, /floorTargetInHandParent/, 'floor-relative canonical target must be converted into the actual generated-hand parent');
assert.match(source, /HOBUNJI_ATTACHMENT_RIG_MATH\?\.characterPosteriorY/, 'editor idle arms must reuse the canonical posterior resolver');
assert.match(source, /armLengthHeightPercentOffset/, 'editor idle arms must consume authored species/gender arm-length setting');
assert.match(source, /hand\.position\.copy\(target\)/, 'editor idle arms must drive existing generated hand wrappers instead of creating duplicate hands');
assert.match(source, /explicit-animation-owner/, 'editor idle arms must retain explicit animation ownership diagnostics');

console.log('procedural editor idle arms: Full Character Scale floor-space + portrait-lift regression + ownership diagnostics PASS');
