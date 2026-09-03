'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const author = read('docs/tools/animation-author/index.html');
const patch = read('docs/js/animation-author-preview-rig-space-fix.js');
const wrapper = read('docs/tools/animation-author-rig-space-test/index.html');
const pixelProbe = read('docs/js/pixel-probe.js');

// Reproduce the precise mismatch this patch guards: the old editor builds
// character rig anchors under visualOffset, while gameplay treats them as data
// composed through the player's body/floor root.
assert.match(author, /actor\.visualOffset\.add\(anchor\)/,
  'baseline Animation Author still contains the visualOffset anchor parent that the late guard must supersede');
assert.match(pixelProbe, /game resolves attachment anchors as data rather than scene objects[\s\S]*live player root/i,
  'gameplay diagnostic must retain the player-root attachment-coordinate contract');

assert.match(patch, /CharacterRigFloorRoot_/,
  'preview repair must introduce an explicit character floor/body rig root');
assert.match(patch, /'posterior', 'shoulderPerch', 'leftHandShoulder', 'rightHandShoulder'/,
  'all character attachment/hand shoulder coordinates must share the clean floor/body root');
assert.match(patch, /actor\.attachmentAlignment\.add\(root\)/,
  'character rig root must be a sibling of visualOffset below attachmentAlignment');
assert.match(patch, /reparentPreservingLocal\(anchor, root\)/,
  'authored local anchor coordinates must survive preview-parent removal unchanged');
assert.match(patch, /return transformMatrixFromSnapshot\(transformSnapshot\(anchor\)\)/,
  'character attachment alignment must no longer multiply visualOffset into the anchor matrix');
assert.doesNotMatch(patch, /transformSnapshot\(actor\.visualOffset\)[\s\S]{0,120}transformSnapshot\(anchor\)/,
  'fixed character anchor composition must not reintroduce visualOffset');
assert.match(patch, /proceduralHandRig\?\.group/,
  'existing procedural hands must migrate to the same clean floor/body root');
assert.match(patch, /rigFeetPreview\?\.group/,
  'procedural feet must migrate to the same clean floor/body root');
assert.match(patch, /isNpcActor\(actor\)/,
  'repair must remain character-only so creature saddle/grip size-scale ancestry is untouched');
assert.match(wrapper, /animation-author-preview-rig-space-fix\.js/,
  'isolated visual A\/B wrapper must inject the preview-space repair');

console.log('Animation Author preview rig-space regression guards passed');
