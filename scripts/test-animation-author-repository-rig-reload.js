'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8');

assert.match(source, /document\.getElementById\('sourceSha'\)/,
  'rig bootstrap must read the exact repository commit already resolved by Animation Author');
assert.match(source, /cdn\.jsdelivr\.net\/gh\/\$\{encodeURIComponent\(owner\)\}\/\$\{encodeURIComponent\(repo\)\}@\$\{sha\}/,
  'repository rig/runtime scripts must be pinned to the resolved SHA instead of the mutable requested ref');
assert.match(source, /\.\.\/config\/attachment-rig-profiles\.js\?v=20260907repo1/,
  'exact repository attachment-rig profiles must replace the page-paired static rig data');

const exactRigIndex = source.indexOf("../config/attachment-rig-profiles.js?v=20260907repo1");
const scaleDefaultsIndex = source.indexOf("../config/character-rig-scale-defaults.js?v=20260905d");
const scaleRuntimeIndex = source.indexOf("character-rig-scale.js?v=20260904i");
assert(exactRigIndex >= 0 && scaleDefaultsIndex > exactRigIndex && scaleRuntimeIndex > scaleDefaultsIndex,
  'repository rig profiles must load before scale defaults/runtime so controls and preview resolve the same anatomy');

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
assert.match(source, /maoao-arm-tint-runtime\.js\?v=20260907a/,
  'rebasing the Full Character Scale branch must preserve the merged Mao-ao arm tint runtime');
assert.match(source, /shoulder-camera-character-framing\.js\?v=20260907a/,
  'rebasing the Full Character Scale branch must preserve the merged species-relative shoulder camera runtime');

console.log('Animation Author exact repository rig reload regression passed');
