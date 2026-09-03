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

// The Animation Author's configured Three.js build predates Object3D's newer
// removeFromParent() helper, while the stacked actor cleanup wrappers call it.
// Install the standard equivalent at the shared Three-module loader boundary
// so clear/remove cannot fail halfway through restoring or replacing actors.
assert.match(author, /actor\.root\.removeFromParent\(\)/,
  'regression fixture must retain the cleanup call that needs legacy-Three compatibility');
assert.match(transformDumpBootstrap, /Object3D\?\.prototype/,
  'Animation Author compatibility must patch the exact Object3D prototype returned by its Three loader');
assert.match(transformDumpBootstrap, /this\.parent && typeof this\.parent\.remove === 'function'/,
  'removeFromParent compatibility must delegate to the existing parent.remove child-detach primitive');
assert.match(transformDumpBootstrap, /PNGPlaneAvatar[\s\S]*loadThreeModules/,
  'compatibility must install at the shared PNGPlaneAvatar Three loader boundary before scene creation');

console.log('Animation Author preview rig-space isolation and legacy Object3D cleanup guards passed');
