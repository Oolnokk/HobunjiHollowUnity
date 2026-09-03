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
const attachmentRigMaster = read('docs/config/attachment-rig-profiles.js');
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

// A commit-pinned RawGitHack page is already authoritative about which
// repository revision its dependent runtime/config files should use. The
// internal GitHub commits endpoint can return 403 on mobile, so pin the saved
// ref to the 40-hex URL SHA before readSettings() can fall back to an older ref.
assert.match(transformDumpBootstrap, /\[0-9a-f\]\{40\}/i,
  'production bootstrap must recognize only unambiguous 40-character commit-pinned page refs');
assert.match(transformDumpBootstrap, /hobunjiNpcPlaneAvatarRepoViewer\.source\.v1/,
  'commit-page pinning must update the same repository settings record Animation Author reads');
assert.match(transformDumpBootstrap, /ref: sha/,
  'commit-page pinning must make the current page SHA the requested repository ref');

// V15.25 can synthesize hand shoulders from stale V15.23 perches and publish
// them into the mutable runtime mirror before a later layer tries to use that
// mirror as canonical input. The immutable master must remain a separate source
// of truth, and production should repair only exact historical fingerprints.
assert.match(attachmentRigMaster, /HOBUNJI_ATTACHMENT_RIG_MASTER\s*=\s*deepFreeze\(master\)/,
  'attachment rig config must expose an immutable canonical master independent of its editable runtime mirror');
assert.match(transformDumpBootstrap, /HOBUNJI_ATTACHMENT_RIG_MASTER\?\.profiles\?\.characters/,
  'stale shoulder repair must source replacements from the immutable master, not HOBUNJI_ATTACHMENT_RIG_PROFILES');
assert.match(transformDumpBootstrap, /'mao-ao::male': \[-0\.29650716367602115, 0\.6947557240731601, 0\]/,
  'regression guard must recognize the exact V15.23 Mao-ao male shoulder-perch fingerprint');
assert.match(transformDumpBootstrap, /scaledTuple\(legacyPerch, 0\.9\)/,
  'stale detector must recognize the 0.9-scaled V15.23 perch seen in the live rigger dump');
assert.match(transformDumpBootstrap, /legacyLeft[\s\S]*legacyRight/,
  'stale detector must recognize the symmetric shoulders synthesized from that old perch');
assert.match(transformDumpBootstrap, /hobunji_attachment_rig_character_master_sync\.json/,
  'repaired profiles must go back through the existing Animation Author import surface');
assert.match(transformDumpBootstrap, /animationAuthorCanonicalShoulderSync/,
  'mobile diagnostics must expose the canonical-shoulder repair state');

console.log('Animation Author preview isolation, cleanup, pinned-ref, and immutable-master shoulder guards passed');