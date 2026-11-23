#!/usr/bin/env node
'use strict';

// Full Character Scale must face the same way as gameplay. The lineup camera
// sits at +Z looking at portrait fronts, so toes and the Longoran hunch must
// also point +Z. A preview-only reversal (spine sign -1 + mirrored foot depth)
// was verified in headless screenshots to show heels under every face and to
// make Longorans lurch backward, so the lineup must not opt into it. The
// opt-in mechanism itself stays tested below for isolation from gameplay.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const comparison = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Lineup call sites.
const feetSource = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8'); // Actual shared foot runtime, not a test-side copy.
const spineSource = fs.readFileSync('docs/js/character-spine.js', 'utf8'); // Actual gameplay/shared spine solver.

assert.doesNotMatch(comparison, /previewForwardSign\s*=\s*-1/, 'the lineup keeps the gameplay spine forward direction');
assert.doesNotMatch(comparison, /previewReverseFootDepth:\s*true/, 'lineup feet keep gameplay toe direction (toes toward the camera, like the faces)');
assert.match(comparison, /attachPreviewPants\(entry, avatar\.front\)/, 'initial lineup covers the hip-to-foot span with pants like gameplay');
assert.match(comparison, /attachPreviewPants\(entry\); \/\/ Disposing the old leg handle/, 'rebuilt Longoran feet get their pants back');
assert.match(feetSource, /alignPreviewFootFacing\(THREE, leftMesh, options\.previewReverseFootDepth\)/,
  'opt-in preview orientation still covers asynchronously loaded GLBs');
assert.match(feetSource, /alignPreviewFootFacing\(THREE, rightMesh, options\.previewReverseFootDepth\)/,
  'both anatomical feet receive the same opt-in correction');

function extract(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'production function ' + name + ' exists');
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, 'function ' + name + ' is well-formed');
  return source.slice(start, end);
}
class Group {
  constructor() { this.children = []; this.scale = { x: 1, y: 1, z: 1 }; this.parent = null; }
  add(child) { if (child.parent) child.parent.remove(child); child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(value => value !== child); child.parent = null; }
}
const orientFoot = vm.runInNewContext('(' + extract(feetSource, 'alignPreviewFootFacing') + ')');
for (const isPreview of [false, true]) {
  const foot = new Group(); // IK-controlled ankle root whose handedness and pose must remain untouched.
  const toe = new Group(); // Visual toe points along the source foot mesh's local -Z.
  toe.position = { x: 0.2, y: 0, z: -0.3 };
  foot.add(toe);
  const corrected = orientFoot({ Group }, foot, isPreview);
  assert.equal(corrected, foot);
  assert.equal(foot.scale.x, 1, 'left/right handedness and rig transforms never change');
  assert.equal(foot.scale.z, 1, 'ankle IK parent is not mirrored');
  if (isPreview) {
    assert.equal(foot.children.length, 1, 'one visual transform is inserted only in the author preview');
    const visual = foot.children[0];
    assert.equal(visual.scale.z, -1, 'foot geometry reverses forward/back along Z');
    assert.equal(visual.scale.x, 1, 'the local anatomical X coordinate is not reversed');
    assert.equal(toe.parent, visual, 'the same toe geometry is retained');
  } else assert.equal(foot.children[0], toe, 'gameplay does not receive a new transform');
}

const win = {};
vm.runInNewContext(spineSource, { window: win });
const spine = win.HobunjiCharacterSpine;
assert.ok(spine && typeof spine.applyToRig === 'function', 'production spine solver loads');
function bone(initial) {
  return { position: { ...initial, set(x, y, z) { Object.assign(this, { x, y, z }); } },
    userData: {}, updateMatrix() {} };
}
const H = 1;
const spineBase = { x: 0, y: 0.2 };
const posterior = -0.32;
const layout = spine.layoutFor(spineBase.x, spineBase.y, H, posterior, 0, 0.21);
function makeRig(reversed) {
  return {
    splineNodes: layout.offsets.map((offset, i) => bone(i === 0 ? layout.nodes[0] : offset)),
    neckLocal: { x: 0, y: .21 }, spineBase, spinePosteriorY: posterior,
    previewForwardSign: reversed ? -1 : 1,
  };
}
function tipZ(rig) {
  return rig.splineNodes.reduce((sum, b) => sum + b.position.z, 0);
}
const normal = makeRig(false), preview = makeRig(true);
spine.applyToRig(normal, spine.profileFor(.65, 0, 1), H);
spine.applyToRig(preview, spine.profileFor(.65, 0, 1), H);
assert.ok(tipZ(normal) > 0, 'normal gameplay spine remains in its original forward direction');
assert.ok(tipZ(preview) < 0, 'lineup hunch curves the other way');
assert.ok(Math.abs(tipZ(normal) + tipZ(preview)) < 1e-9,
  'preview sign reverses depth only, preserving the same hunch magnitude');
const first = tipZ(preview);
spine.applyNeckReach(preview, -.04, H, .65);
assert.ok(tipZ(preview) < 0, 'recalculation after head scaling keeps the preview-facing sign');
spine.applyNeckReach(preview, -.04, H, .65);
assert.equal(tipZ(preview), first, 'repeated scale and hunch evaluation does not accumulate direction errors');
assert.equal(preview.splineNodes[0].position.z, 0, 'the pelvis remains pinned');
console.log('Full Character Scale facing: lineup matches gameplay (+Z face, toes, hunch), pants attached; opt-in preview reversal stays isolated PASS');
