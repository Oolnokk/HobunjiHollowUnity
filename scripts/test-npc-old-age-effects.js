const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..'); // Resolves shared config/runtime/tool files from the repository root below.
const configPath = path.join(repoRoot, 'docs', 'config', 'npc-age-effects.js'); // Shared source of runtime and visual-tool age values.
const runtimePath = path.join(repoRoot, 'docs', 'js', 'npc-age-effects-runtime.js'); // Config-driven portrait aging wrapper tested in the Node shim.
const posturePath = path.join(repoRoot, 'docs', 'js', 'npc-age-body-posture.js'); // Animation-composer age torso layer source-checked below.
const toolPath = path.join(repoRoot, 'docs', 'tools', 'age-effect', 'index.html'); // Combined visual tool source-checked for gameplay hands/feet parity.
const loaderPath = path.join(repoRoot, 'docs', 'js', 'combat', 'combat-config-loader.js'); // Parser-blocking gameplay wiring checked below.
const postureSource = fs.readFileSync(posturePath, 'utf8'); // Used for composer/NPC non-accumulation integration assertions.
const toolSource = fs.readFileSync(toolPath, 'utf8'); // Used for exact runtime preview dependency assertions.
const loaderSource = fs.readFileSync(loaderPath, 'utf8'); // Used for module load-order assertions.

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
      fighter: { speciesId: 'mao-ao', gender: 'male' },
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

require(configPath);
require(runtimePath);

const config = global.HobunjiNpcAgeEffectConfig;
const oldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'teacup_unumanuk', name: 'Eldress Teacup' }); // Verifies exact Old assignment from the shared config.
const veryOldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'kaboku_kunji', name: 'Kaboku Kunji' }); // Verifies exact Very Old assignment and stronger posture.
const unaffectedEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'gorobi_ginju', name: 'Gorobi Ginju' }); // Guards against accidentally aging the normal NPC roster.
const bogusPlaceholderEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'vul_sigrid', name: 'Vul Sigrid' }); // Prevents the discarded generic-fantasy placeholder from returning.
const agedProfile = NpcAvatarPreview.buildProfileFromNpcExport({ id: 'father_hunundi_hodu', name: 'Father Hunundi' }); // Verifies shared gameplay profile construction ages body colors selectively.
const tuned = config.effectFromPreset('old', { torsoPitchDeg: 12.5, headDropPx: 7, amount: 55 }); // Verifies the visual tool can make non-mutating tuned preset copies.

assert.equal(oldEffect?.headDropPx, 4, 'Old uses the authored 4 px head drop');
assert.equal(oldEffect?.amount, 70, 'Old uses the reference Old color amount');
assert.equal(oldEffect?.torsoPitchDeg, 4, 'Old now carries an independent age-driven torso pitch');
assert.equal(veryOldEffect?.headDropPx, 9, 'Very Old uses the authored 9 px head drop');
assert.equal(veryOldEffect?.amount, 100, 'Very Old uses the strongest reference color amount');
assert.equal(veryOldEffect?.torsoPitchDeg, 9, 'Very Old carries the stronger age-driven torso pitch');
assert.equal(unaffectedEffect, null, 'NPCs outside the exact allowlist remain unaffected');
assert.equal(bogusPlaceholderEffect, null, 'Vul Sigrid remains rejected as a bogus placeholder');
assert.equal(tuned.torsoPitchDeg, 12.5, 'tool tuning can override torso pitch without mutating the shared default');
assert.equal(tuned.headDropPx, 7, 'tool tuning can override portrait head drop independently');
assert.equal(tuned.amount, 55, 'tool tuning can override color age amount independently');
assert.notEqual(agedProfile.bodyColors.A.hex, '#cc8844', 'biological body slot A is aged');
assert.notEqual(agedProfile.bodyColors.B.hex, '#4488cc', 'biological body slot B is aged');
assert.notEqual(agedProfile.bodyColors.C.hex, '#88cc44', 'biological body slot C is aged');
assert.equal(agedProfile.bodyColors.CLOTH.hex, '#123456', 'non-body/clothing tint slots remain unchanged');
assert.equal(agedProfile.__hobunjiNpcAgeEffect?.presetLabel, 'Old', 'profile exposes combined runtime age debug metadata');

assert.match(postureSource, /BODY_CHANNEL = 'age-posture'/, 'age torso pitch owns a named animation-composer channel');
assert.match(postureSource, /PlayerBodyTransformComposer\?\.setChannel\(BODY_CHANNEL/, 'player-compatible age posture composes through PlayerBodyTransformComposer');
assert.match(postureSource, /options\?\.ageBodyRoot \|\| options\?\.drunkBodyRoot \|\| options\?\.avatarRoot/, 'NPC age posture reuses the isolated body root before falling back to the avatar root');
assert.match(postureSource, /bodyRoot\.quaternion\.multiply\(state\.bodyTilt\.clone\(\)\.invert\(\)\)/, 'NPC age rotation removes only its previous-frame quaternion before recomposition');
assert.match(postureSource, /previousAttach = legApi\.attach\.bind\(legApi\)/, 'age posture decorates the existing procedural animation stack instead of replacing it');

assert.match(toolSource, /Hobunji Age Effect Tool/, 'combined age tool has its own first-class tools page');
assert.match(toolSource, /png-plane-avatar\.js/, '3D preview uses the same PNG-plane avatar runtime as gameplay');
assert.match(toolSource, /procedural-leg-animation\.js/, '3D preview uses gameplay procedural feet');
assert.match(toolSource, /held-action-animations\.js/, '3D preview boots the gameplay hand runtime');
assert.match(toolSource, /ProceduralHandAttachments\.attach/, '3D preview actually attaches modeled gameplay hands');
assert.match(toolSource, /ProceduralLegAnimation\.attach/, '3D preview actually attaches gameplay feet');
assert.match(toolSource, /standingPosteriorY/, 'torso preview pivots around the gameplay floor-relative posterior');
assert.match(toolSource, /torsoPitchDeg/, 'visual tool exposes the new animation-composer torso control');
assert.match(toolSource, /ensurePortraitCosmetics\?\.\(\{assetBase:'\.\.\/\.\.\/assets\/',configBase:'\.\.\/\.\.\/config\/'\}\)/, 'Age Effect Tool initializes the shared portrait cosmetics cache before building NPC profiles');
assert.match(toolSource, /if\(!profile\)throw new Error\(`Could not build portrait profile/, 'Age Effect Tool reports profile boot/data failures before reading bodyColors');

assert.match(loaderSource, /config\/npc-age-effects\.js\?v=20260903a[\s\S]*npc-age-effects-runtime\.js\?v=20260903a/, 'gameplay loads shared age config before portrait runtime');
assert.match(loaderSource, /drunk-locomotion\.js\?v=20260812a[\s\S]*npc-age-body-posture\.js\?v=20260903a/, 'age torso layer decorates the animation stack after drunk locomotion');
assert.doesNotMatch(loaderSource, /npc-old-age-effects\.js/, 'superseded one-off old-age module is no longer loaded');

console.log('Combined NPC age effect tests passed');
