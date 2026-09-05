'use strict';

const assert = require('assert');
const fs = require('fs');

const snapshot = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot-core.js', 'utf8');
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

const snapshotIndex = bootstrap.indexOf('attachment-rig-latest-authored-snapshot.js?v=20260904a');
const solverIndex = bootstrap.indexOf('procedural-hand-scale-free-world.js?v=20260904posteriorlive1');
assert(snapshotIndex >= 0 && solverIndex > snapshotIndex,
  'latest authored snapshot must load before the portrait/hand solver');

console.log('Latest authored rig snapshot and zero-export guards passed');
