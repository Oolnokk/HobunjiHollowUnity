'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Executes the production duplicate builder below.
const dual = fs.readFileSync('docs/js/dual-wield-weapon-visuals.js', 'utf8');
const grips = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const driver = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8');
const held = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
const runtimeEntries = ['docs/index.html', 'docs/tools/animation-author/index.html', 'docs/tools/attack-animation-editor/index.html']; // All entry points must request the current shared hand bootstrap.
assert.match(dual, /const DUPLICATE_Z_GAP = 0\.30/, 'dual weapons use the requested 0.30 total plane-normal gap');
assert.match(dual, /const MAIN_HAND_LAG_MS = 45/, 'main-hand duplicate keeps the requested small transform lag');
assert.match(dual, /plane\.add\(offRoot\)[\s\S]*plane\.add\(mainRoot\)/, 'both visible weapon roots are children of the hidden original plane');
assert.match(dual, /record\.material\.visible = false/, 'original weapon material is hidden without hiding child duplicates');
assert.match(dual, /duplicate\.position\.set\?\.\(0, 0, side === 'main' \? -HALF_Z_SEPARATION : HALF_Z_SEPARATION\)/, 'only visible child weapons receive the equal/opposite local sprite-plane-normal offsets');
assert.doesNotMatch(dual, /offsetWorld\.set\(0, 0, -HALF_Z_SEPARATION\)/, 'main root no longer carries the sandwich offset');
assert.match(dual, /desiredWorldPosition\.copy\(basePosition\)/, 'main root replays only the delayed source transform');
assert.match(dual, /delayedParentPose[\s\S]*MAIN_HAND_LAG_MS/, 'main root replays delayed translation + rotation without inheriting sprite scale twice');
assert.match(dual, /current\.plane\.updateWorldMatrix\?\.\(true, false\)[\s\S]*current\.offRoot\.updateMatrixWorld\?\.\(true\)[\s\S]*current\.mainRoot\.updateMatrixWorld\?\.\(true\)/, 'duplicate world matrices are current before either hand reads its weapon socket');
assert.match(dual, /root\.scale\.set\(1, 1, 1\)/, 'dual roots stay unit-scale so the hidden parent is the sole sprite-scale authority');
assert.match(dual, /idleStancePoses/, 'dual presentation consumes explicit main/offhand idle stance poses');
assert.doesNotMatch(dual, /requestAnimationFrame/, 'dual-wield visuals must share the scheduler/hand-sync owners instead of starting a second frame loop');
assert.match(dual, /transformSocketForHand/, 'dual visual layer exposes per-hand socket transforms');
assert.match(dual, /const weapon = side === 'right' \? current\.mainMesh : current\.offMesh/, 'each hand resolves its socket from its visible child weapon');
assert.match(dual, /planeLocalPosition = socketFrame\.position\.clone\(\)\.applyMatrix4\(inversePlaneWorld\)[\s\S]*planeLocalPosition\.clone\(\)\.applyMatrix4\(weapon\.matrixWorld\)/, 'child grip position is reconstructed in original-plane local space and resolved through the visible child weapon matrix');
assert.match(dual, /mirrorQuaternionAcrossLocalX[\s\S]*source\.x, -source\.y, -source\.z, source\.w/, 'offhand grip orientation mirrors the proper frame across child-local X instead of losing the reflection in quaternion decomposition');
assert.match(dual, /mirroredChild = side === 'left'[\s\S]*mirrorQuaternionAcrossLocalX\(planeLocalQ/, 'the offhand receives the flipped grip frame independently of the forward-facing sprite');
assert.match(dual, /duplicate\.scale\.set\?\.\(1, 1, 1\)/, 'both weapon copies preserve the source blade facing; the idle offhand pose owns its rotation');
assert.match(driver, /const primarySocket = toolSocketWorld\(record, toolHolder, primaryGrip\)/, 'the original fixed 1H socket remains the canonical grip before Dual Wield remapping');
assert.match(driver, /owners\.right = 'primary-grip'[\s\S]*if \(dualWield\) owners\.right = 'dual-wield-main-grip'/, 'Dual Wield refines ordinary main-hand ownership without weakening primary-grip fallback authority');
assert.match(driver, /transformSocketForHand\?\.\(record, 'right'/, 'right hand follows the lagged main duplicate');
assert.match(driver, /transformSocketForHand\?\.\(record, 'left'/, 'left hand follows the offhand duplicate');
assert.match(driver, /offhandBaseSocket = toolSocketWorld\(record, toolHolder, primaryGrip\)/, 'both duplicated weapons use the same fixed 1H grip frame');
assert.match(grips, /dualWieldStateForTool/, 'shared grip state exposes Dual Wield as a melee hand mode');
assert.match(grips, /defaultTwoHand = sequence === 'attack'/, 'ordinary melee attacks default to 2H');
assert(held.includes('dual-wield-weapon-visuals.js'), 'held-action bootstrap loads dual-wield visuals');
const heldActionTokens = runtimeEntries.map(path => {
  const html = fs.readFileSync(path, 'utf8');
  return html.match(/held-action-animations\.js\?v=([A-Za-z0-9_-]+)/)?.[1] || null;
});
assert(heldActionTokens.every(token => token && token === heldActionTokens[0]), 'game and authoring pages must use the same fresh held-action bootstrap token');
assert.match(editor, /loadEditorAnimationGrip\?\.\(\{ sequence: preset\.sequence \|\| 'attack', style: preset\.style, still: preset\.still, poses: anim\.poses \}\)/, 'switching Actions reloads per-attack hand-mode metadata');
console.log('dual wield: transform-following roots, child-local grip frames with proper offhand reflection, child-only sandwich offsets, main-hand lag, default 2H, and independent editor flags PASS');

// Execute the mesh builder: a negative offhand X scale reverses an asymmetric axe blade.
class DuplicateMesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = { set(x, y, z) { Object.assign(this, { x, y, z }); } };
    this.scale = { set(x, y, z) { Object.assign(this, { x, y, z }); } };
    this.quaternion = { identity() {} };
    this.layers = { mask: 1 };
  }
}
const builderSource = dual.slice(dual.indexOf('  function makeDuplicateMesh('), dual.indexOf('  function makeRoot(')); // Isolates the unchanged production factory dependencies.
const builder = vm.runInNewContext(`(${builderSource.trim()})`, {
  HALF_Z_SEPARATION: 0.15,
  cloneOwnedMaterial: material => ({ ...material }),
}); // Calls the actual factory for both anatomical sides.
const sourcePlane = new DuplicateMesh({ axeBlade: true }, {}); // Shared source geometry must retain its authored handedness.
for (const side of ['main', 'off']) {
  const copy = builder(sourcePlane, side); // The visible weapon tested against the same blade geometry.
  assert.equal(copy.geometry, sourcePlane.geometry);
  assert.equal(copy.scale.x, 1, `${side} axe blade must face the authored direction`);
  assert.equal(copy.scale.y, 1);
  assert.equal(copy.scale.z, 1);
  assert.equal(copy.position.z, side === 'main' ? -0.15 : 0.15);
}

class GripQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
  clone() { return new GripQuaternion(this.x, this.y, this.z, this.w); }
  invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this; }
  normalize() { return this; }
  multiply(q) {
    const { x, y, z, w } = this; // Preserves the input rotation during quaternion composition.
    return this.set(w*q.x + x*q.w + y*q.z - z*q.y, w*q.y - x*q.z + y*q.w + z*q.x,
      w*q.z + x*q.y - y*q.x + z*q.w, w*q.w - x*q.x - y*q.y - z*q.z);
  }
}
class GripPoint {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  clone() { return new GripPoint(this.x, this.y, this.z); }
  applyMatrix4(matrix) { this.z += matrix.z || 0; return this; }
}
const gripMatrix = z => ({ z, clone() { return gripMatrix(this.z); }, invert() { this.z *= -1; return this; } }); // Translation-only fixture isolates the hand direction from the weapon position.
const gripWeapon = z => ({ matrixWorld: gripMatrix(z), quaternion: new GripQuaternion(), scale: { x: 1 }, updateMatrixWorld() {} }); // Both visible sprites retain the corrected forward facing.
const gripState = { influence: 1, idleBlend: 0, plane: { matrixWorld: gripMatrix(0), quaternion: new GripQuaternion() }, mainMesh: gripWeapon(-0.15), offMesh: gripWeapon(0.15) }; // Supplies a live dual pair to the production socket resolver.
const mirrorStart = dual.indexOf('  function mirrorQuaternionAcrossLocalX('); // Bounds of the production direction conversion.
const mirrorEnd = dual.indexOf('  function currentPlanePose(', mirrorStart);
const socketStart = dual.indexOf('  function transformSocketForHand('); // Bounds of the production per-hand dispatch.
const socketEnd = dual.indexOf('  function resetPoseHistory(', socketStart);
const socketResolver = vm.runInNewContext(`${dual.slice(mirrorStart, mirrorEnd)}\n(${dual.slice(socketStart, socketEnd).trim()})`, {
  syncNow: () => gripState,
  state: null,
  ACTIVE_EPSILON: 0.0001,
  hierarchyWorldQuaternion: (node, target) => target.set(node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w),
  DUPLICATE_Z_GAP: 0.30,
  MAIN_HAND_LAG_MS: 45,
}); // Exercises the real branch selecting the offhand frame even though neither weapon is reflected.
const authoredSocket = { position: new GripPoint(-0.04, -0.04, -0.1), quaternion: new GripQuaternion(0.5, -0.5, 0.5, 0.5) }; // A normalized nontrivial grip makes yaw/roll reversal observable.
const rightGrip = socketResolver({}, 'right', authoredSocket); // Main hand keeps the authored direction.
const leftGrip = socketResolver({}, 'left', authoredSocket); // Offhand flips its grip while remaining on its own visible weapon.
assert.deepEqual([rightGrip.quaternion.x, rightGrip.quaternion.y, rightGrip.quaternion.z, rightGrip.quaternion.w], [0.5, -0.5, 0.5, 0.5]);
assert.deepEqual([leftGrip.quaternion.x, leftGrip.quaternion.y, leftGrip.quaternion.z, leftGrip.quaternion.w], [0.5, 0.5, -0.5, 0.5]);
assert.equal(leftGrip.dualWield.mirroredGripFrame, true);
assert.equal(rightGrip.dualWield.mirroredGripFrame, false);
assert.equal(leftGrip.position.x, authoredSocket.position.x);
assert(Math.abs(leftGrip.position.z - (authoredSocket.position.z + 0.15)) < 1e-9);
assert.equal(authoredSocket.quaternion.y, -0.5, 'offhand conversion must not mutate the shared authored grip');
