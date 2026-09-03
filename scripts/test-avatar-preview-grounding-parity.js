'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const pngAvatar = read('docs/js/png-plane-avatar.js');
const author = read('docs/tools/animation-author/index.html');
const authorFix = read('docs/js/animation-author-preview-grounding-fix.js');
const cutsceneDirector = read('docs/tools/cutscene-director/index.html');

assert.match(pngAvatar, /const assemblyY = \(placementRatio - 0\.5\) \* modelHeight/,
  'PNG avatar builder must continue grounding the portrait internally from portraitVerticalPlacementRatio');

// These are the exact stale assumptions found during the parity audit. Keep
// them visible until each consumer is migrated, then invert these assertions.
assert.match(author, /const groundLiftY = modelHeight \/ 2/,
  'Animation Author currently contains the obsolete extra half-height preview lift');
assert.match(author, /\.5 \+ metrics\.placementRatio - \(finiteNumber\(pixelY\) \+ \.5\) \/ metrics\.pixelHeight/,
  'Animation Author currently contains the matching +half-height portrait-to-floor conversion error');
assert.match(cutsceneDirector, /avatarGroup\.position\.set\(0, avatarHeight\/2, 0\)/,
  'Cutscene Director currently contains the same obsolete half-height preview lift');

assert.match(authorFix, /groundLiftY: 0/,
  'isolated author preview repair must restore gameplay floor-root grounding');
assert.match(authorFix, /y: modelHeight \* \(placementRatio - \(finite\(pixelY\) \+ \.5\) \/ pixelHeight\)/,
  'portrait pixel conversion must cancel the two half-height terms exactly');
assert.doesNotMatch(authorFix, /placementRatio \+ \.5/,
  'fixed portrait-to-floor conversion must not retain an extra half-height');

console.log('avatar preview grounding parity regression guards passed');
