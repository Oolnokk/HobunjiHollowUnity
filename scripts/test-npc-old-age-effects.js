const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const configPath = path.join(repoRoot, 'docs', 'config', 'npc-age-effects.js');
const runtimePath = path.join(repoRoot, 'docs', 'js', 'npc-age-effects-runtime.js');
const posturePath = path.join(repoRoot, 'docs', 'js', 'npc-age-body-posture.js');
const postureSource = read('docs/js/npc-age-body-posture.js');
const npcStateSource = read('docs/js/npc-character-state.js');
const toolSource = read('docs/tools/age-effect/index.html');
const loaderSource = read('docs/js/combat/combat-config-loader.js');
const gameSource = read('docs/game.js');

global.window = global;
global.THREE = {}; // Lets the event-driven age module install its non-3D profile guard in this source-level Node shim.
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
require(posturePath);

const config = global.HobunjiNpcAgeEffectConfig;
const oldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'teacup_unumanuk', name: 'Eldress Teacup' });
const veryOldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'kaboku_kunji', name: 'Kaboku Kunji' });
const leafVeryOldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'leaf', name: 'Leaf' });
const pahuVeryOldEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'pahu', name: 'Pahu' });
const unaffectedEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'gorobi_ginju', name: 'Gorobi Ginju' });
const bogusPlaceholderEffect = NpcAvatarPreview.resolveAgeEffect({ id: 'vul_sigrid', name: 'Vul Sigrid' });
const agedProfile = NpcAvatarPreview.buildProfileFromNpcExport({ id: 'father_hunundi_hodu', name: 'Father Hunundi' });
const tuned = config.effectFromPreset('old', {
  torsoPitchDeg: 12.5,
  headDropPx: 7,
  amount: 55,
  verticalOffsetReductionPct: 13,
});

assert.equal(oldEffect?.headDropPx, 10, 'Old uses the authored 10 px head drop');
assert.equal(oldEffect?.amount, 70, 'Old uses the reference Old color amount');
assert.equal(oldEffect?.torsoPitchDeg, 4, 'Old carries an independent age-driven torso pitch');
assert.equal(oldEffect?.verticalOffsetReductionPct, 1.5, 'Old reduces the normal standing lift by 1.5 percent');
assert.equal(veryOldEffect?.headDropPx, 19, 'Very Old uses the user-approved 19 px head drop');
assert.equal(veryOldEffect?.amount, 100, 'Very Old uses the strongest reference color amount');
assert.equal(veryOldEffect?.torsoPitchDeg, 9, 'Very Old carries the stronger age-driven torso pitch');
assert.equal(veryOldEffect?.verticalOffsetReductionPct, 3, 'Very Old reduces the normal standing lift by 3 percent');
assert.equal(leafVeryOldEffect?.presetId, 'veryOld', 'Leaf is assigned to the Very Old preset');
assert.equal(leafVeryOldEffect?.headDropPx, 19, 'Leaf receives the Very Old 19 px head drop');
assert.equal(pahuVeryOldEffect?.presetId, 'veryOld', 'Pahu is assigned to the Very Old preset');
assert.equal(pahuVeryOldEffect?.headDropPx, 19, 'Pahu receives the Very Old 19 px head drop');
assert.equal(unaffectedEffect, null, 'NPCs outside the exact allowlist remain unaffected');
assert.equal(bogusPlaceholderEffect, null, 'Vul Sigrid remains rejected as a bogus placeholder');
assert.equal(tuned.torsoPitchDeg, 12.5, 'tool tuning can override torso pitch without mutating defaults');
assert.equal(tuned.headDropPx, 7, 'tool tuning can override portrait head drop independently');
assert.equal(tuned.amount, 55, 'tool tuning can override color age amount independently');
assert.equal(tuned.verticalOffsetReductionPct, 13, 'tool tuning can override standing-height reduction independently');
assert.equal(agedProfile.bodyColors.A.hex, '#000000', 'configured exact black remains exactly black');
assert.equal(agedProfile.__hobunjiNpcAgeEffect?.agedSlots?.A?.agedHex, '#000000', 'age metadata reports preserved black');
assert.notEqual(agedProfile.bodyColors.B.hex, '#4488cc', 'non-black biological body slot B is aged');
assert.notEqual(agedProfile.bodyColors.C.hex, '#88cc44', 'non-black biological body slot C is aged');
assert.equal(agedProfile.bodyColors.CLOTH.hex, '#123456', 'non-body/clothing tint slots remain unchanged');

// NpcCharacterState must remain the stock state/blackout adapter. Age owns no
// second general-purpose transform compositor here.
assert.match(npcStateSource, /poseGroup\.add\(avatarGroup\)/, 'stock NPC state directly parents the avatar into its alcohol pose');
assert.doesNotMatch(npcStateSource, /BODY_COMPOSER_STATE|setBodyTransformChannel|composeBodyChannels|clearBodyTransformChannel/, 'NpcCharacterState does not duplicate body transform composition');

// Age integrates at avatar construction + the existing NPC assembly seam only.
assert.match(postureSource, /const avatarApi = window\.PNGPlaneAvatar/, 'age posture extends the canonical PNGPlaneAvatar renderer');
assert.match(postureSource, /effect \? \{ \.\.\.options, neckRig: true \} : options/, 'aged avatars force the existing canonical neck rig');
assert.match(postureSource, /const bodyRoot = new THREEArg\.Group\(\)/, 'aged NPCs get one minimal static visual parent');
assert.match(postureSource, /poseGroup\.add\(bodyRoot\);[\s\S]*bodyRoot\.add\(avatarGroup\)/, 'age body root is inserted beneath the stock alcohol pose and above the avatar');
assert.match(postureSource, /avatarGroup\.userData\.hobunjiAgeBodyRoot = bodyRoot/, 'the avatar exposes its age visual root without putting composition into NpcCharacterState');
assert.match(postureSource, /bodyRoot\.position\.copy\(pivot\)\.sub\(pivot\.clone\(\)\.applyQuaternion\(rotation\)\)/, 'static body pitch rotates around the authored posterior pivot');
assert.match(postureSource, /bodyRoot\.position\.y \+= lowerY/, 'standing-height reduction is applied once to the static age body root');
assert.match(postureSource, /counterBone\.add\(neckJoint\)/, 'age counter pitch is a parent bone so ordinary neck writers keep the child joint');
assert.match(postureSource, /composition\.neckCounterPitchMultiplier, -1/, 'neck pitch uses the centralized equal-and-opposite multiplier');
assert.match(postureSource, /perFrameAgeWork: false/, 'age explicitly reports no per-frame age work');
assert.match(postureSource, /npcTransformComposer: false/, 'age explicitly reports that it did not introduce an NPC transform composer');
assert.doesNotMatch(postureSource, /setBodyTransformChannel|composeBodyChannels|clearBodyTransformChannel/, 'age no longer calls the removed NPC composer API');
assert.doesNotMatch(postureSource, /previousAttach\s*=\s*legApi\.attach|handle\.update\s*=|requestAnimationFrame\s*\(|setInterval\s*\(|setTimeout\s*\(/, 'age posture adds no gait wrapper or age-specific frame/timer loop');

// Capture the live makeNpcWalker assembly contract before asserting the tool mirrors it.
assert.match(gameSource, /previewPortraitCanvasSize \?\? 200/, 'live NPCs use the configured portrait backing size with 200px fallback');
assert.match(gameSource, /avatarGroup\.position\.set\(0, avatarHeight \/ 2, 0\)/, 'live NPC avatar starts at its resolved half-height standing lift');
assert.match(gameSource, /NpcCharacterState\?\.attachAlcoholPose\?\.\(THREE, root, avatarGroup, rec\?\.id\)/, 'live NPC avatar uses the stock alcohol-pose assembly seam');
assert.match(gameSource, /ProceduralLegAnimation\?\.attach\(THREE, root, \{[\s\S]*?drunkBodyRoot: avatarGroup/, 'live procedural feet remain attached to the floor root');

assert.match(toolSource, /Hobunji Age Effect Tool/, 'combined age tool has its own first-class tools page');
assert.match(toolSource, /config\/attachment-rig-profiles\.js/, 'Age Tool loads authored species/gender attachment coordinates');
assert.match(toolSource, /png-plane-avatar\.js/, '3D preview uses the canonical PNG-plane avatar runtime');
assert.match(toolSource, /procedural-leg-animation\.js/, '3D preview uses gameplay procedural feet');
assert.match(toolSource, /held-action-animations\.js/, '3D preview boots the gameplay automatic hand runtime');
assert.match(toolSource, /npc-character-state\.js/, 'Age Tool uses the same NPC state/alcohol-pose helper as makeNpcWalker');
assert.match(toolSource, /const PORTRAIT_SIZE = AVATAR_CFG\.previewPortraitCanvasSize \?\? 200/, 'Age Tool uses the live portrait backing-size setting');
assert.match(toolSource, /currentAvatar\.position\.set\(0, normalPortraitLiftY, 0\)/, 'Age Tool starts from the live half-height standing lift');
assert.match(toolSource, /NpcCharacterState\?\.attachAlcoholPose\?\.\(THREE, currentRoot, currentAvatar, currentNpc\.id\)/, 'Age Tool passes through the exact age-aware runtime assembly seam');
assert.match(toolSource, /ProceduralLegAnimation\?\.attach\(THREE, currentRoot, \{[\s\S]*?drunkLossProvider: \(\) => 0,[\s\S]*?drunkBodyRoot: currentAvatar/, 'Age Tool leaves feet on the live floor root and disables drunk sway for age inspection');
assert.doesNotMatch(toolSource, /proceduralHandParent\s*=/, 'Age Tool does not invent an editor-only hand parent');
assert.doesNotMatch(toolSource, /ProceduralHandAttachments\.attach\(/, 'Age Tool never manually attaches a duplicate hand rig');
assert.match(toolSource, /avatar\?\.userData\?\.proceduralHandRig/, 'Age Tool reads the single hand rig owned by ProceduralHandFrameDriver');
assert.match(toolSource, /currentFeet\?\.getStandingPoseDebug\?\.\(\)/, 'Age Tool exposes runtime feet diagnostics');
assert.match(toolSource, /verticalOffsetReductionRange[^>]*type="range"/, 'standing height remains authorable through the config-driven control');

assert.match(loaderSource, /config\/npc-age-effects\.js\?v=20260903/, 'gameplay loads the shared age config');
assert.match(loaderSource, /npc-age-body-posture\.js\?v=20260903/, 'gameplay loads the event-driven age posture integration');
assert.doesNotMatch(loaderSource, /npc-old-age-effects\.js/, 'superseded one-off old-age module is no longer loaded');

console.log('Combined NPC age effect tests passed');
