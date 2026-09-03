const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..'); // Resolves shared config/runtime/tool files from the repository root below.
const configPath = path.join(repoRoot, 'docs', 'config', 'npc-age-effects.js'); // Shared source of runtime and visual-tool age values.
const runtimePath = path.join(repoRoot, 'docs', 'js', 'npc-age-effects-runtime.js'); // Config-driven portrait aging wrapper tested in the Node shim.
const posturePath = path.join(repoRoot, 'docs', 'js', 'npc-age-body-posture.js'); // Animation-composer age torso layer + final age profile guards.
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
        A: { hex: '#000000' }, // Exact black body/line slot must never be brightened or desaturated by age.
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
require(posturePath); // With no THREE/leg runtime in this Node shim, this installs the color/profile guard then exits before 3D composition setup.

const config = global.HobunjiNpcAgeEffectConfig;
const oldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'teacup_unumanuk', name: 'Eldress Teacup' }); // Verifies exact Old assignment from the shared config.
const veryOldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'kaboku_kunji', name: 'Kaboku Kunji' }); // Verifies exact Very Old assignment and stronger posture.
const unaffectedEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'gorobi_ginju', name: 'Gorobi Ginju' }); // Guards against accidentally aging the normal NPC roster.
const bogusPlaceholderEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'vul_sigrid', name: 'Vul Sigrid' }); // Prevents the discarded generic-fantasy placeholder from returning.
const agedProfile = NpcAvatarPreview.buildProfileFromNpcExport({ id: 'father_hunundi_hodu', name: 'Father Hunundi' }); // Verifies shared gameplay profile construction ages body colors selectively.
const tuned = config.effectFromPreset('old', { torsoPitchDeg: 12.5, headDropPx: 7, amount: 55 }); // Verifies the visual tool can make non-mutating tuned preset copies.

assert.equal(oldEffect?.headDropPx, 10, 'Old uses the proportionally increased 10 px head drop');
assert.equal(oldEffect?.amount, 70, 'Old uses the reference Old color amount');
assert.equal(oldEffect?.torsoPitchDeg, 4, 'Old carries an independent age-driven torso pitch');
assert.equal(veryOldEffect?.headDropPx, 22, 'Very Old uses the authored 22 px head drop');
assert.equal(veryOldEffect?.amount, 100, 'Very Old uses the strongest reference color amount');
assert.equal(veryOldEffect?.torsoPitchDeg, 9, 'Very Old carries the stronger age-driven torso pitch');
assert.equal(unaffectedEffect, null, 'NPCs outside the exact allowlist remain unaffected');
assert.equal(bogusPlaceholderEffect, null, 'Vul Sigrid remains rejected as a bogus placeholder');
assert.equal(tuned.torsoPitchDeg, 12.5, 'tool tuning can override torso pitch without mutating the shared default');
assert.equal(tuned.headDropPx, 7, 'tool tuning can override portrait head drop independently');
assert.equal(tuned.amount, 55, 'tool tuning can override color age amount independently');
assert.equal(agedProfile.bodyColors.A.hex, '#000000', 'pure black body/outline slots stay exactly black through age brightening/desaturation');
assert.equal(agedProfile.__hobunjiNpcAgeEffect?.agedSlots?.A?.agedHex, '#000000', 'age debug metadata reports the preserved black result');
assert.notEqual(agedProfile.bodyColors.B.hex, '#4488cc', 'non-black biological body slot B is aged');
assert.notEqual(agedProfile.bodyColors.C.hex, '#88cc44', 'non-black biological body slot C is aged');
assert.equal(agedProfile.bodyColors.CLOTH.hex, '#123456', 'non-body/clothing tint slots remain unchanged');
assert.equal(agedProfile.__hobunjiNpcAgeEffect?.presetLabel, 'Old', 'profile exposes combined runtime age debug metadata');

assert.match(postureSource, /BODY_CHANNEL = 'age-posture'/, 'age torso pitch owns a named animation-composer channel');
assert.match(postureSource, /PlayerBodyTransformComposer\?\.setChannel\(BODY_CHANNEL/, 'player-compatible age posture composes through PlayerBodyTransformComposer');
assert.match(postureSource, /options\?\.ageBodyRoot \|\| options\?\.drunkBodyRoot \|\| options\?\.avatarRoot/, 'NPC age posture reuses the isolated body root before falling back to the avatar root');
assert.match(postureSource, /bodyRoot\.quaternion\.multiply\(state\.bodyTilt\.clone\(\)\.invert\(\)\)/, 'NPC age rotation removes only its previous-frame quaternion before recomposition');
assert.match(postureSource, /state\.neckCounter\.setFromEuler\(new THREE\.Euler\(-pitchRad, 0, 0, 'YXZ'\)\)/, 'age neck counter is the exact opposite of torso pitch');
assert.match(postureSource, /neck\.quaternion\.multiply\(state\.neckCounter\)/, 'age neck counter composes additively onto existing neck motion');
assert.match(postureSource, /clearNeckDelta\(\)/, 'previous-frame age neck counter is removed before recomposition instead of accumulating');
assert.match(postureSource, /aged \? \{ \.\.\.options, neckRig: true \} : options/, 'aged PNG avatars force the existing neck rig so runtime counter-pitch is available');
assert.match(postureSource, /function preservePureBlackAgeSlots\(profile\)/, 'age integration has an explicit exact-black preservation guard');
assert.match(postureSource, /record\.agedHex = '#000000'/, 'black preservation keeps visual-tool/debug swatches aligned with the render target');
assert.match(postureSource, /previousAttach = legApi\.attach\.bind\(legApi\)/, 'age posture decorates the existing procedural animation stack instead of replacing it');

assert.match(toolSource, /Hobunji Age Effect Tool/, 'combined age tool has its own first-class tools page');
assert.match(toolSource, /png-plane-avatar\.js/, '3D preview uses the same PNG-plane avatar runtime as gameplay');
assert.match(toolSource, /procedural-leg-animation\.js/, '3D preview uses gameplay procedural feet');
assert.match(toolSource, /held-action-animations\.js/, '3D preview boots the gameplay automatic hand runtime');
assert.match(toolSource, /const PORTRAIT_SIZE = 256/, 'Age Effect Tool uses the same square portrait backing size as Attack Animation Editor');
assert.match(toolSource, /worldModelWidth \?\? 0\.9/, 'Age Effect Tool uses the same in-game world model base as Attack Animation Editor');
assert.match(toolSource, /modelWidth: MODEL_W,[\s\S]*modelHeight: MODEL_W/, 'PNG portrait build uses the Attack Animation Editor square model sizing contract before species scaling');
assert.match(toolSource, /currentAvatar\.position\.y = modelHeight \/ 2/, 'Age Effect Tool lifts the portrait root by half its resolved runtime height exactly like Attack Animation Editor');
assert.match(toolSource, /currentAvatar\.userData\.proceduralHandParent = bodyContent/, 'the single automatic hand rig is parented to the torso content so it follows age pitch');
assert.match(toolSource, /avatar\?\.userData\?\.proceduralHandRig/, 'Age Effect Tool reads the hand rig created by ProceduralHandFrameDriver rather than creating another pair');
assert.match(toolSource, /ProceduralHandFrameDriver\?\.syncNow\?\.\(\)/, 'Age Effect Tool synchronizes the shared automatic hand driver after parenting the portrait');
assert.doesNotMatch(toolSource, /ProceduralHandAttachments\.attach\(/, 'Age Effect Tool never manually attaches a second duplicate hand rig');
assert.match(toolSource, /ProceduralLegAnimation\.attach/, '3D preview actually attaches gameplay feet');
assert.match(toolSource, /standingPosteriorY/, 'torso preview pivots around the gameplay floor-relative posterior');
assert.match(toolSource, /torsoPitchDeg/, 'visual tool exposes the animation-composer torso control');
assert.match(toolSource, /ensurePortraitCosmetics\?\.\(\{ assetBase: '\.\.\/\.\.\/assets\/', configBase: '\.\.\/\.\.\/config\/' \}\)/, 'Age Effect Tool initializes the shared portrait cosmetics cache before building NPC profiles');
assert.match(toolSource, /if \(!profile\) throw new Error\(`Could not build portrait profile/, 'Age Effect Tool reports profile boot/data failures before reading bodyColors');

assert.match(loaderSource, /config\/npc-age-effects\.js\?v=20260903/, 'gameplay loads the shared age config');
assert.match(loaderSource, /drunk-locomotion\.js\?v=20260812a[\s\S]*npc-age-body-posture\.js\?v=20260903/, 'age torso/neck layer decorates the animation stack after drunk locomotion');
assert.doesNotMatch(loaderSource, /npc-old-age-effects\.js/, 'superseded one-off old-age module is no longer loaded');

console.log('Combined NPC age effect tests passed');
