'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const pngAvatar = read('docs/js/png-plane-avatar.js');
const author = read('docs/tools/animation-author/index.html');
const authorFix = read('docs/js/animation-author-preview-grounding-fix.js');
const transformDumpBootstrap = read('docs/js/transform-dump-utils.js');

assert.match(pngAvatar, /const assemblyY = \(placementRatio - 0\.5\) \* modelHeight/,
  'PNG avatar builder must retain its authored portrait placement inside the avatar model');

// Animation Author intentionally raises the RepositoryAvatarBox by half the
// model height. This is presentation geometry: the floor-relative rig origin
// stays at Y=0 while the visible portrait is centered at its real displayed
// character height. Do not confuse that preview lift with an attachment offset.
assert.match(author, /const groundLiftY = modelHeight \/ 2/,
  'Animation Author must retain the intentional half-height RepositoryAvatarBox presentation lift');
assert.match(author, /presentation\.position\.y = metrics\.groundLiftY/,
  'RepositoryAvatarBox must continue applying the intentional preview-height lift');

// The old experimental A/B repair remains available only to its dedicated test
// wrapper. It is based on the opposite grounding assumption and must never be
// injected into production Animation Author boot.
assert.match(authorFix, /groundLiftY: 0/,
  'experimental grounding A/B patch remains identifiable by its zero-lift behavior');
assert.doesNotMatch(transformDumpBootstrap, /animation-author-preview-grounding-fix\.js/,
  'production shared transform utility must not inject the experimental zero-lift patch');

console.log('Animation Author portrait presentation grounding contract guards passed');
