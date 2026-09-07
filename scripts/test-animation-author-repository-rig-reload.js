'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8');
const portraitXDefaults = fs.readFileSync('docs/js/character-scale-portrait-x-authored-defaults.js', 'utf8');
const portraitXGameplay = fs.readFileSync('docs/js/character-scale-portrait-x-game-runtime.js', 'utf8');

assert.match(source, /document\.getElementById\('sourceSha'\)/,
  'rig bootstrap must read the exact repository commit already resolved by Animation Author');
assert.match(source, /cdn\.jsdelivr\.net\/gh\/\$\{encodeURIComponent\(owner\)\}\/\$\{encodeURIComponent\(repo\)\}@\$\{sha\}/,
  'repository rig/runtime scripts must be pinned to the resolved SHA instead of the mutable requested ref');
assert.match(source, /\.\.\/config\/attachment-rig-profiles\.js\?v=20260907repo1/,
  'exact repository attachment-rig profiles must replace the page-paired static rig data');

const exactRigIndex = source.indexOf("../config/attachment-rig-profiles.js?v=20260907repo1");
const scaleDefaultsIndex = source.indexOf("../config/character-rig-scale-defaults.js?v=20260905d");
const scaleRuntimeIndex = source.indexOf("character-rig-scale.js?v=20260904i");
const portraitXDefaultsIndex = source.indexOf("character-scale-portrait-x-authored-defaults.js?v=20260907a");
const portraitXRuntimeIndex = source.indexOf("character-scale-portrait-x-offset.js?v=20260907b");
const portraitXGameplayIndex = source.indexOf("character-scale-portrait-x-game-runtime.js?v=20260907a");
assert(exactRigIndex >= 0 && scaleDefaultsIndex > exactRigIndex && scaleRuntimeIndex > scaleDefaultsIndex,
  'repository rig profiles must load before scale defaults/runtime so controls and preview resolve the same anatomy');
assert(portraitXDefaultsIndex > scaleRuntimeIndex && portraitXRuntimeIndex > portraitXDefaultsIndex,
  'authored portrait X defaults must populate the shared profiles before portrait-X runtime/editor support reads them');
assert(portraitXGameplayIndex > portraitXRuntimeIndex,
  'gameplay portrait X bridge must load after the shared portrait-X API exists');

const profiles = {
  'mao-ao::male': { anatomy: {} },
  'mao-ao::female': { anatomy: {} },
  'engh-sho::male': { anatomy: {} },
  'engh-sho::female': { anatomy: {} },
  'kenkari::male': { anatomy: {} },
};
const windowObject = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: profiles },
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
};
windowObject.window = windowObject;
vm.runInNewContext(portraitXDefaults, windowObject, { filename: 'character-scale-portrait-x-authored-defaults.js' });
assert.strictEqual(profiles['mao-ao::male'].anatomy.portraitOffsetX, -0.08, 'Mao-ao male portrait X must default to -8%');
assert.strictEqual(profiles['mao-ao::female'].anatomy.portraitOffsetX, -0.04, 'Mao-ao female portrait X must default to -4%');
assert.strictEqual(profiles['engh-sho::male'].anatomy.portraitOffsetX, -0.07, 'Engh-sho male portrait X must default to -7%');
assert.strictEqual(profiles['engh-sho::female'].anatomy.portraitOffsetX, -0.04, 'Engh-sho female portrait X must default to -4%');
assert.strictEqual(profiles['kenkari::male'].anatomy.portraitOffsetX, undefined, 'unrequested species must keep their existing portrait X default');

let gameplayApply = null;
const gameplayParent = { userData: {} };
const gameplayWindow = {
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  HobunjiCharacterRigScale: {
    scaleFor(species, gender) {
      return { portraitOffsetX: species === 'mao-ao' && gender === 'male' ? -0.08 : 0 };
    },
    applyPortraitXOffset(parent, species, gender, resolved) {
      gameplayApply = { parent, species, gender, resolved };
      return true;
    },
  },
  ProceduralHandAttachments: {
    attach(_THREE, parent, options) {
      return { parent, options, originalResult: true };
    },
  },
};
gameplayWindow.window = gameplayWindow;
const gameplayContext = {
  window: gameplayWindow,
  setInterval: () => 1,
  clearInterval: () => {},
};
vm.runInNewContext(portraitXGameplay, gameplayContext, { filename: 'character-scale-portrait-x-game-runtime.js' });
const handResult = gameplayWindow.ProceduralHandAttachments.attach({}, gameplayParent, { speciesId: 'mao-ao', gender: 'male' });
assert.strictEqual(handResult.originalResult, true, 'gameplay bridge must preserve the original hand attach return value');
assert.strictEqual(gameplayApply.parent, gameplayParent, 'gameplay bridge must apply the portrait shift inside the live floor-relative character parent');
assert.strictEqual(gameplayApply.species, 'mao-ao', 'gameplay bridge must use the runtime species identity from hand attachment');
assert.strictEqual(gameplayApply.gender, 'male', 'gameplay bridge must use the runtime gender identity from hand attachment');
assert.strictEqual(gameplayApply.resolved.portraitOffsetX, -0.08, 'gameplay bridge must pass the authored portrait offset into the shared runtime');
assert.strictEqual(gameplayParent.userData.hobunjiPortraitXGameplayRuntime.applied, true, 'gameplay bridge must expose successful application on the character parent');
assert.strictEqual(gameplayWindow.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.fullCharacterPortraitXGameplay.installed, true,
  'gameplay diagnostics must confirm the hand-attachment portrait-X hook is installed');

assert.match(source, /const RIG_DRAFT_KEYS = Object\.freeze\(\[/,
  'manual repository reload must explicitly define the local rig/scale drafts it discards');
for (const key of [
  'hobunjiAttachmentRigProfiles.v2',
  'hobunjiFullCharacterRigScales.v2',
  'hobunjiFullCharacterRigScales.v1',
]) {
  assert(source.includes(`'${key}'`), `manual Load repository must clear stale ${key}`);
}
assert.match(source, /localStorage\.setItem\(SOURCE_SETTINGS_KEY, JSON\.stringify\(settings\)\)/,
  'changed repository controls must be saved before the clean page reload');
assert.match(source, /button\.addEventListener\('click',[\s\S]*?event\.stopImmediatePropagation\(\)[\s\S]*?location\.reload\(\)/,
  'Load repository must intercept the stale in-page reload path and restart from clean repository state');
assert.match(source, /animationAuthorRepositoryRigSource/,
  'mobile diagnostics must expose which repository SHA/base supplied rig and scale data');
assert.match(source, /character-scale-portrait-x-offset\.js\?v=20260907b', localBase/,
  'the PR-local portrait X extension must remain available even when the selected repository ref does not contain it yet');
assert.match(source, /character-scale-portrait-x-game-runtime\.js\?v=20260907a', localBase/,
  'the gameplay portrait X bridge must stay page-paired with the PR build');
assert.match(source, /maoao-arm-tint-runtime\.js\?v=20260907a/,
  'rebasing the Full Character Scale branch must preserve the merged Mao-ao arm tint runtime');
assert.match(source, /shoulder-camera-character-framing\.js\?v=20260907a/,
  'rebasing the Full Character Scale branch must preserve the merged species-relative shoulder camera runtime');

console.log('Animation Author exact repository rig reload + gameplay portrait X regression passed');
