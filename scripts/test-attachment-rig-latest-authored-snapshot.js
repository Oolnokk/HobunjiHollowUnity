'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const snapshot = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot-core.js', 'utf8');
const armLengthZero = fs.readFileSync('docs/js/character-rig-arm-length-zero.js', 'utf8');
const sharedBootstrap = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8');
const bootstrap = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');

assert.match(snapshot, /2026-09-04T02:12:48\.704Z/, 'latest authored snapshot must identify the supplied export');
assert.match(snapshot, /"mao-ao::male"[\s\S]*"leftHandShoulder":\{"x":0\.18901455966160707,"y":0\.6441947637751073,"z":0\}/,
  'Mao-ao male must use the supplied latest left shoulder');
assert.match(snapshot, /"mao-ao::male"[\s\S]*"rightHandShoulder":\{"x":-0\.21163248394065837,"y":0\.6455541403639915,"z":0\}/,
  'Mao-ao male must use the supplied latest right shoulder');
assert.match(snapshot, /zeroPosition\(anchor\.position\)/,
  'export guard must recognize zero posterior placeholders');
assert.match(snapshot, /live-resolved-posterior/,
  'export guard must prefer the live resolved posterior when available');
assert.match(snapshot, /posteriorRule\.heightPercentFromFloor/,
  'export guard must derive a nonzero posterior when the live value is unavailable');
assert.match(snapshot, /allZero[\s\S]*runtime\.creatures\?\.\[kind\]\?\.groundOffsets/,
  'zero creature ground-offset exports must be replaced from runtime/master data');
assert.match(snapshot, /zeroPosteriorPositionsIgnored: true/,
  'the supplied zero posterior positions must never be promoted as authored values');
assert.match(snapshot, /zeroCreatureGroundOffsetsIgnored: true/,
  'the supplied zero creature ground offsets must never be promoted as authored values');

const rigLibrary = {
  characters: {
    'tletingan::male': { anatomy: { armLengthHeightPercentOffset: 6 } },
    'tletingan::female': { anatomy: { armLengthHeightPercentOffset: 5 } },
    'mao-ao::male': { anatomy: { armLengthHeightPercentOffset: 5 } },
    'mao-ao::female': { anatomy: { armLengthHeightPercentOffset: 5 } },
    'kenkari::female': { anatomy: { armLengthHeightPercentOffset: 2.5 } },
    'mashtzarr::male': { anatomy: { armLengthHeightPercentOffset: 4 } },
    'engh-sho::female': { anatomy: { armLengthHeightPercentOffset: 2 } },
    'engh-sho::male': {},
  },
};
const armContext = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: rigLibrary,
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  setInterval() { return 1; },
  clearInterval() {},
};
armContext.window = armContext;
vm.runInContext(armLengthZero, vm.createContext(armContext), { filename: 'character-rig-arm-length-zero.js' });
for (const [key, profile] of Object.entries(rigLibrary.characters)) {
  assert.strictEqual(profile.anatomy.armLengthHeightPercentOffset, 0, `${key} arm-length offset must normalize to zero`);
}
assert.match(armContext.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.armLengthZero, /^character-arm-length-zero-2026-09-07-v1:8$/,
  'arm-length normalizer diagnostics must report every loaded character profile');
rigLibrary.characters['mao-ao::female'].anatomy.armLengthHeightPercentOffset = 12;
armContext.HobunjiCharacterArmLengthZero.applyToLibrary();
assert.strictEqual(rigLibrary.characters['mao-ao::female'].anatomy.armLengthHeightPercentOffset, 0,
  'manual/retry normalization must restore a stale arm-length value to zero');

const snapshotCoreIndex = sharedBootstrap.indexOf('attachment-rig-latest-authored-snapshot-core.js?v=20260904a');
const maoAuthoringIndex = sharedBootstrap.indexOf('character-rig-maoao-authored-20260905.js?v=20260905b');
const armZeroIndex = sharedBootstrap.indexOf('character-rig-arm-length-zero.js?v=20260907a');
const scaleIndex = sharedBootstrap.indexOf('character-rig-scale.js?v=20260904i');
assert(snapshotCoreIndex >= 0 && maoAuthoringIndex > snapshotCoreIndex && armZeroIndex > maoAuthoringIndex && scaleIndex > armZeroIndex,
  'zero arm-length normalization must load after stale authored offsets and before downstream rig consumers');

const snapshotIndex = bootstrap.indexOf('attachment-rig-latest-authored-snapshot.js?v=20260904a');
const solverIndex = bootstrap.indexOf('procedural-hand-scale-free-world.js?v=20260904posteriorlive1');
assert(snapshotIndex >= 0 && solverIndex > snapshotIndex,
  'latest authored snapshot must load before the portrait/hand solver');

console.log('Latest authored rig snapshot, zero arm-length normalization, and zero-export guards passed');
