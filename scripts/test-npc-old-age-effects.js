const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(repoRoot, 'docs', 'config', 'npc-age-effects.js');
const runtimePath = path.join(repoRoot, 'docs', 'js', 'npc-age-effects-runtime.js');
const posturePath = path.join(repoRoot, 'docs', 'js', 'npc-age-body-posture.js');
const toolPath = path.join(repoRoot, 'docs', 'tools', 'age-effect', 'index.html');
const loaderPath = path.join(repoRoot, 'docs', 'js', 'combat', 'combat-config-loader.js');
const gamePath = path.join(repoRoot, 'docs', 'game.js'); // Live makeNpcWalker is the source of truth for 3D preview assembly.
const postureSource = fs.readFileSync(posturePath, 'utf8');
const toolSource = fs.readFileSync(toolPath, 'utf8');
const loaderSource = fs.readFileSync(loaderPath, 'utf8');
const gameSource = fs.readFileSync(gamePath, 'utf8');

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
        A: { hex: '#000000' },
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
require(posturePath); // No THREE/leg runtime in this shim: color/profile guard installs, then 3D setup exits.

const config = global.HobunjiNpcAgeEffectConfig;
const oldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'teacup_unumanuk', name: 'Eldress Teacup' });
const veryOldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'kaboku_kunji', name: 'Kaboku Kunji' });
const leafVeryOldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'leaf', name: 'Leaf' });
const pahuVeryOldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'pahu', name: 'Pahu' });
const unaffectedEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'gorobi_ginju', name: 'Gorobi Ginju' });
const bogusPlaceholderEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'vul_sigrid', name: 'Vul Sigrid' });
const agedProfile = NpcAvatarPreview.buildProfileFromNpcExport({ id: 'father_hunundi_hodu', name: 'Father Hunundi' });
const tuned = config.effectFromPreset('old', { torsoPitchDeg: 12.5, headDropPx: 7, amount: 55, verticalOffsetReductionPct: 13 });

assert.equal(oldEffect?.headDropPx, 10, 'Old uses the authored 10 px head drop');
assert.equal(oldEffect?.amount, 70, 'Old uses the reference Old color amount');
assert.equal(oldEffect?.torsoPitchDeg, 4, 'Old carries an independent age-driven torso pitch');
assert.equal(oldEffect?.verticalOffsetReductionPct, 1.5, 'Old reduces the normal standing lift by 1.5 percent');
assert.equal(veryOldEffect?.headDropPx, 19, 'Very Old uses the authored 19 px head drop');
assert.equal(veryOldEffect?.amount, 100, 'Very Old uses the strongest reference color amount');
assert.equal(veryOldEffect?.torsoPitchDeg, 9, 'Very Old carries the stronger age-driven torso pitch');
assert.equal(veryOldEffect?.verticalOffsetReductionPct, 3, 'Very Old reduces the normal standing lift by 3 percent');
assert.equal(leafVeryOldEffect?.presetId, 'veryOld', 'Leaf is assigned to the Very Old preset');
assert.equal(leafVeryOldEffect?.headDropPx, 19, 'Leaf receives the Very Old head drop');
assert.equal(leafVeryOldEffect?.verticalOffsetReductionPct, 3, 'Leaf receives the Very Old standing-height reduction');
assert.equal(pahuVeryOldEffect?.presetId, 'veryOld', 'Pahu is assigned to the Very Old preset');
assert.equal(pahuVeryOldEffect?.headDropPx, 19, 'Pahu receives the Very Old head drop');
assert.equal(pahuVeryOldEffect?.verticalOffsetReductionPct, 3, 'Pahu receives the Very Old standing-height reduction');
assert.equal(unaffectedEffect, null, 'NPCs outside the exact allowlist remain unaffected');
assert.equal(bogusPlaceholderEffect, null, 'Vul Sigrid remains rejected as a bogus placeholder');
assert.equal(tuned.torsoPitchDeg, 12.5, 'tool tuning can override torso pitch without mutating the shared default');
assert.equal(tuned.headDropPx, 7, 'tool tuning can override portrait head drop independently');
assert.equal(tuned.amount, 55, 'tool tuning can override color age amount independently');
assert.equal(tuned.verticalOffsetReductionPct, 13, 'tool tuning can override standing-height reduction independently');
assert.equal(agedProfile.bodyColors.A.hex, '#000000', 'pure black body/outline slots stay exactly black through age brightening/desaturation');
assert.equal(agedProfile.__hobunjiNpcAgeEffect?.agedSlots?.A?.agedHex, '#000000', 'age debug metadata reports the preserved black result');
assert.notEqual(agedProfile.bodyColors.B.hex, '#4488cc', 'non-black biological body slot B is aged');
assert.notEqual(agedProfile.bodyColors.C.hex, '#88cc44', 'non-black biological body slot C is aged');
assert.equal(agedProfile.bodyColors.CLOTH.hex, '#123456', 'non-body/clothing tint slots remain unchanged');
assert.equal(agedProfile.__hobunjiNpcAgeEffect?.presetLabel, 'Old', 'profile exposes combined runtime age debug metadata');

assert.match(postureSource, /BODY_CHANNEL = 'age-posture'/, 'age torso pitch owns a named animation-composer channel');
assert.match(postureSource, /PlayerBodyTransformComposer\?\.setChannel\(BODY_CHANNEL/, 'player-compatible age posture composes through PlayerBodyTransformComposer');
assert.match(postureSource, /translation: \{ x: 0, y: lowerY, z: 0 \}/, 'player-compatible age posture publishes standing-height reduction through the same composer channel');
assert.match(postureSource, /options\?\.ageBodyRoot \|\| options\?\.drunkBodyRoot \|\| options\?\.avatarRoot/, 'NPC age posture reuses the isolated body root before falling back to the avatar root');
assert.match(postureSource, /return -\(modelHeight \* 0\.5\) \* reduction/, 'age standing-height reduction is proportional to the normal modelHeight/2 standing lift');
assert.match(postureSource, /bodyRoot\.position\.y -= state\.bodyLowerY/, 'NPC age lowering removes only its previous-frame Y delta before recomposition');
assert.match(postureSource, /bodyRoot\.position\.y \+= state\.bodyLowerY/, 'NPC age lowering is applied only to the body root so procedural feet stay planted');
assert.match(postureSource, /bodyRoot\.quaternion\.multiply\(state\.bodyTilt\.clone\(\)\.invert\(\)\)/, 'NPC age rotation removes only its previous-frame quaternion before recomposition');
assert.match(postureSource, /state\.neckCounter\.setFromEuler\(new THREE\.Euler\(-pitchRad, 0, 0, 'YXZ'\)\)/, 'age neck counter is the exact opposite of torso pitch');
assert.match(postureSource, /neck\.quaternion\.multiply\(state\.neckCounter\)/, 'age neck counter composes additively onto existing neck motion');
assert.match(postureSource, /clearNeckDelta\(\)/, 'previous-frame age neck counter is removed before recomposition instead of accumulating');
assert.match(postureSource, /aged \? \{ \.\.\.options, neckRig: true \} : options/, 'aged PNG avatars force the existing neck rig so runtime counter-pitch is available');
assert.match(postureSource, /function preservePureBlackAgeSlots\(profile\)/, 'age integration has an explicit exact-black preservation guard');
assert.match(postureSource, /record\.agedHex = '#000000'/, 'black preservation keeps visual-tool/debug swatches aligned with the render target');
assert.match(postureSource, /previousAttach = legApi\.attach\.bind\(legApi\)/, 'age posture decorates the existing procedural animation stack instead of replacing it');

// Capture the live makeNpcWalker assembly contract before asserting the tool mirrors it.
assert.match(gameSource, /previewPortraitCanvasSize \?\? 200/, 'live NPCs use the configured portrait backing size with 200px fallback');
assert.match(gameSource, /avatarGroup\.position\.set\(0, avatarHeight \/ 2, 0\)/, 'live NPC avatar starts at its resolved half-height standing lift');
assert.match(gameSource, /NpcCharacterState\?\.attachAlcoholPose\?\.\(THREE, root, avatarGroup, rec\?\.id\)/, 'live NPC avatar is parented through the standard alcohol-pose group');
assert.match(gameSource, /ProceduralLegAnimation\?\.attach\(THREE, root, \{[\s\S]*?drunkBodyRoot: avatarGroup/, 'live NPC feet attach to the floor root while body posture targets avatarGroup');

assert.match(toolSource, /Hobunji Age Effect Tool/, 'combined age tool has its own first-class tools page');
assert.match(toolSource, /config\/attachment-rig-profiles\.js/, 'Age Tool loads the same authored species/gender attachment coordinates used by live hands and feet');
assert.match(toolSource, /png-plane-avatar\.js/, '3D preview uses the same PNG-plane avatar runtime as gameplay');
assert.match(toolSource, /procedural-leg-animation\.js/, '3D preview uses gameplay procedural feet');
assert.match(toolSource, /held-action-animations\.js/, '3D preview boots the gameplay automatic hand runtime');
assert.match(toolSource, /npc-character-state\.js/, 'Age Tool loads the same NPC alcohol-pose hierarchy helper as makeNpcWalker');
assert.match(toolSource, /drunk-locomotion\.js[\s\S]*npc-age-body-posture\.js/, 'Age Tool wraps procedural legs in the same drunk-then-age order as gameplay');
assert.match(toolSource, /const PORTRAIT_SIZE = AVATAR_CFG\.previewPortraitCanvasSize \?\? 200/, 'Age Tool uses the exact live configured portrait backing size instead of editor-only 256px');
assert.match(toolSource, /worldModelWidth \?\? 0\.9/, 'Age Tool uses the live in-game world model base');
assert.match(toolSource, /modelWidth: MODEL_W,[\s\S]*modelHeight: MODEL_W,[\s\S]*anchorZ: 0,[\s\S]*alphaTest: AVATAR_CFG\.worldAlphaTest \?\? 0\.01/, 'PNG avatar build mirrors makeNpcWalker world sizing/anchor/alpha options');
assert.match(toolSource, /currentAvatar\.position\.set\(0, normalPortraitLiftY, 0\)/, 'Age Tool starts from the same resolved half-height standing lift as live NPCs');
assert.match(toolSource, /NpcCharacterState\?\.attachAlcoholPose\?\.\(THREE, currentRoot, currentAvatar, currentNpc\.id\)/, 'Age Tool uses the same root -> alcohol pose -> avatar hierarchy as live NPCs');
assert.match(toolSource, /ProceduralLegAnimation\?\.attach\(THREE, currentRoot, \{[\s\S]*?portraitSize: PORTRAIT_SIZE,[\s\S]*?drunkLossProvider: \(\) => 0,[\s\S]*?drunkBodyRoot: currentAvatar/, 'Age Tool feet use the live floor-root attach contract and body-root option');
assert.doesNotMatch(toolSource, /avatarRoot: currentAvatar/, 'Age Tool does not invent a non-game avatarRoot leg option');
assert.doesNotMatch(toolSource, /suppressAgeBodyPosture: true/, 'Age Tool runs the actual age leg decorator instead of suppressing it and recreating posture manually');
assert.doesNotMatch(toolSource, /proceduralHandParent\s*=/, 'Age Tool does not reparent automatic hands into an editor-only transform layer');
assert.doesNotMatch(toolSource, /HobunjiNpcAgeBodyPosture\?\.applyPreview/, 'Age Tool does not apply an editor-only duplicate age posture transform');
assert.doesNotMatch(toolSource, /ProceduralHandAttachments\.attach\(/, 'Age Tool never manually attaches a duplicate hand rig');
assert.match(toolSource, /avatar\?\.userData\?\.proceduralHandRig/, 'Age Tool reads the single hand rig owned by ProceduralHandFrameDriver');
assert.match(toolSource, /ProceduralHandFrameDriver\?\.syncNow\?\.\(\)/, 'Age Tool synchronizes the shared automatic hand driver after live-style parenting');
assert.match(toolSource, /currentFeet\?\.getStandingPoseDebug\?\.\(\)/, 'Age Tool exposes the runtime feet solver rendered-bottom diagnostics');
assert.match(toolSource, /handParent: currentHands\?\.parent\?\.name/, 'Age Tool reports actual hand-parent hierarchy for visual parity debugging');
assert.match(toolSource, /feetParent: currentFeet\?\.group\?\.parent\?\.name/, 'Age Tool reports actual foot-parent hierarchy for visual parity debugging');
assert.match(toolSource, /HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS/, 'Age Tool debug reports whether the authored attachment profile actually loaded');
assert.match(toolSource, /Standing vertical offset reduction \(%\)/, 'visual tool exposes the age standing-height reduction percentage');
assert.match(toolSource, /verticalOffsetReductionRange[^>]*step="0\.5"/, 'height-reduction slider can represent the authored 1.5 percent Old preset exactly');
assert.match(toolSource, /ensurePortraitCosmetics\?\.\(\{ assetBase: '\.\.\/\.\.\/assets\/', configBase: '\.\.\/\.\.\/config\/' \}\)/, 'Age Tool initializes the shared portrait cosmetics cache before building NPC profiles');

assert.match(loaderSource, /config\/npc-age-effects\.js\?v=20260903/, 'gameplay loads the shared age config');
assert.match(loaderSource, /drunk-locomotion\.js\?v=20260812a[\s\S]*npc-age-body-posture\.js\?v=20260903/, 'age torso/neck/height layer decorates the gameplay animation stack after drunk locomotion');
assert.doesNotMatch(loaderSource, /npc-old-age-effects\.js/, 'superseded one-off old-age module is no longer loaded');

console.log('Combined NPC age effect tests passed');
