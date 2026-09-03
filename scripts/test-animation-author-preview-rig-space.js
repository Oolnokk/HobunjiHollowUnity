'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const author = read('docs/tools/animation-author/index.html');
const patch = read('docs/js/animation-author-preview-rig-space-fix.js');
const wrapper = read('docs/tools/animation-author-rig-space-test/index.html');
const transformDumpBootstrap = read('docs/js/transform-dump-utils.js');
const pixelProbe = read('docs/js/pixel-probe.js');

// Keep the alternative coordinate-space implementation available for isolated
// A/B testing, but do not promote it into the real author until it preserves
// every calibrated character anchor. A live Mao-ao test showed that enabling
// it in production caused V15.23 shoulder-perch defaults to be reapplied and
// rebuilt both hand shoulders symmetrically.
assert.match(author, /actor\.visualOffset\.add\(anchor\)/,
  'production Animation Author keeps its current calibrated anchor parentage');
assert.match(pixelProbe, /game resolves attachment anchors as data rather than scene objects[\s\S]*live player root/i,
  'gameplay diagnostic retains the player-root attachment-coordinate contract');

assert.match(patch, /CharacterRigFloorRoot_/,
  'experimental preview-space implementation must remain available for isolated testing');
assert.match(patch, /'posterior', 'shoulderPerch', 'leftHandShoulder', 'rightHandShoulder'/,
  'experimental implementation still covers the complete character anchor set');
assert.match(wrapper, /animation-author-preview-rig-space-fix\.js/,
  'dedicated visual A\/B wrapper must continue to inject the experimental repair');
assert.doesNotMatch(transformDumpBootstrap, /animation-author-preview-rig-space-fix\.js/,
  'production shared transform utility must not inject the experimental rig-space repair');

console.log('Animation Author preview rig-space isolation guards passed');
