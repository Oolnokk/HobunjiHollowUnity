const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..'); // Resolves the browser module and loader from the repository root below.
const modulePath = path.join(repoRoot, 'docs', 'js', 'npc-old-age-effects.js'); // Browser aging module loaded into the Node shim for resolver/color tests.
const loaderPath = path.join(repoRoot, 'docs', 'js', 'combat', 'combat-config-loader.js'); // Loader text checked to ensure gameplay actually installs the module.
const loaderSource = fs.readFileSync(loaderPath, 'utf8'); // Used for the parser-blocking registration assertion below.

global.window = global;
global.SCRATCHBONES_CONFIG = {
  game: {
    appearanceEditor: { species: {} },
    dyes: { swatchBase: '#7dc89a' },
  },
};
global.NpcAvatarPreview = {
  buildProfileFromNpcExport() {
    return {
      fighter: { speciesId: 'mao-ao' },
      bodyColors: {
        A: { hex: '#cc8844' },
        B: { hex: '#4488cc' },
        C: { hex: '#88cc44' },
        CLOTH: { hex: '#123456' },
      },
    };
  },
  async renderProfileToCanvas() { return true; },
};

require(modulePath);

const oldEffect = NpcAvatarPreview.resolveOldAgeEffect({ id: 'teacup_unumanuk', name: 'Eldress Teacup' }); // Verifies the authored Old preset assignment.
const veryOldEffect = NpcAvatarPreview.resolveOldAgeEffect({ id: 'kaboku_kunji', name: 'Kaboku Kunji' }); // Verifies the authored Very Old preset assignment.
const unaffectedEffect = NpcAvatarPreview.resolveOldAgeEffect({ id: 'gorobi_ginju', name: 'Gorobi Ginju' }); // Guards against accidentally aging the general NPC roster.
const placeholderEffect = NpcAvatarPreview.resolveOldAgeEffect({ id: 'vul_sigrid', name: 'Vul Sigrid' }); // Regression guard for the bogus placeholder name removed from the preview mapping.
const agedProfile = NpcAvatarPreview.buildProfileFromNpcExport({ id: 'father_hunundi_hodu', name: 'Father Hunundi' }); // Verifies shared profile construction applies body-color aging selectively.

assert.equal(oldEffect?.posturePixels, 4, 'Old uses the reference 4 px head drop');
assert.equal(oldEffect?.amount, 70, 'Old uses the reference Old color amount');
assert.equal(veryOldEffect?.posturePixels, 9, 'Very Old uses the reference 9 px head drop');
assert.equal(veryOldEffect?.amount, 100, 'Very Old uses the strongest/Ancient reference color amount');
assert.equal(unaffectedEffect, null, 'NPCs outside the exact preset allowlist remain unaffected');
assert.equal(placeholderEffect, null, 'the bogus Vul Sigrid placeholder is not treated as a real NPC preset');
assert.notEqual(agedProfile.bodyColors.A.hex, '#cc8844', 'biological body slot A is aged');
assert.notEqual(agedProfile.bodyColors.B.hex, '#4488cc', 'biological body slot B is aged');
assert.notEqual(agedProfile.bodyColors.C.hex, '#88cc44', 'biological body slot C is aged');
assert.equal(agedProfile.bodyColors.CLOTH.hex, '#123456', 'non-body/clothing tint slots remain unchanged');
assert.equal(agedProfile.__hobunjiNpcOldAgeEffect?.bandLabel, 'Old', 'profile exposes its runtime age debug metadata');
assert.match(loaderSource, /npc-old-age-effects\.js\?v=20260903a/, 'gameplay loader installs the selective old-age module before game init');

console.log('NPC old-age effects tests passed');
