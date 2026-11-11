#!/usr/bin/env node
'use strict';

// Combat poses may author a flexible flail connector multiplier without touching
// rigid weapons, head size, or the existing geometric rope-length authority.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {}; // The real shared attack sampler is browser-global; isolate it for Node regression tests.
vm.runInNewContext(fs.readFileSync('docs/js/combat/shared-attack-pose.js', 'utf8'), { window });
const SAP = window.SharedAttackPose; // Samples the same clock used by the player, NPCs and attack preview.
const WF = 0.16, SF = 0.28, HF = 0.68; // Phase times used to assert exactly where the length interpolation lands.
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-10,
  `${label}: expected ${expected}, got ${actual}`);

assert.equal(SAP.validFlailLength(undefined), 1, 'missing connector defaults to the weapon-author length');
assert.equal(SAP.validFlailLength(NaN), 1, 'invalid authored length cannot corrupt physics');
assert.equal(SAP.validFlailLength(-40), 0.1, 'minimum reach prevents zero-length pendulums');
assert.equal(SAP.validFlailLength(200), 3, 'oversized reach is bounded');

const light = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, bodyYaw: 0, flailLengthScale: 0.6 }; // Authoritative light-weapon Neutral, independent from a particular flail design.
const baked = SAP.bakeStanceSequence('sweep', null, -1, 1, light, { meleeSpacing: false }); // Legacy attack receives the same authored Light idle.
assert.equal(baked.neutral.flailLengthScale, 0.6, 'initial Neutral is shortened by 40%');
assert.equal(baked.returnNeutral.flailLengthScale, 0.6, 'return Neutral is also shortened');
assert.equal(baked.windup.flailLengthScale, 1, 'unspecified Windup extends to natural length');
assert.equal(baked.strike.flailLengthScale, 1, 'unspecified Strike keeps natural length');

const pose = {
  neutral: baked.neutral, windup: baked.windup, strike: baked.strike,
  returnNeutral: baked.returnNeutral,
};
for (const [t, expected] of [[0, 0.6], [WF/2, 0.8], [WF, 1], [SF, 1], [HF, 1], [(HF+1)/2, 0.8], [1, 0.6]]) {
  close(SAP.flailLengthScaleAt(pose, t, WF, SF, HF), expected, `pose reach t=${t}`);
  const sampled = SAP.samplePose(SAP.createSample(), pose, SAP.STYLE_NEUTRAL_POSE.sweep,
    t, WF, SF, HF, -1); // Mirroring flips the attack, never the connector's length.
  close(sampled.flailLengthScale, expected, `mirrored pose reach t=${t}`);
}
const untouchedEndpoints = { neutral: { flailLengthScale: 0.6 }, windup: {}, strike: {} }; // Only Neutral was edited; untouched slider values must still describe 1× attack reach.
close(SAP.flailLengthScaleAt(untouchedEndpoints, WF, WF, SF, HF), 1, 'unmodified windup slider stays natural length');
close(SAP.flailLengthScaleAt(untouchedEndpoints, SF, WF, SF, HF), 1, 'unmodified strike slider stays natural length');
const custom = { neutral: { flailLengthScale: 0.6 }, windup: { flailLengthScale: 0.3 },
  strike: { flailLengthScale: 1.5 } }; // Every phase may extend or shorten its own connector.
close(SAP.flailLengthScaleAt(custom, WF, WF, SF, HF), 0.3, 'authored windup');
close(SAP.flailLengthScaleAt(custom, SF, WF, SF, HF), 1.5, 'authored strike');
close(SAP.flailLengthScaleAt(custom, WF, WF, SF, HF, 'attack', 0.5), 0.45,
  'partial held release scales length change around Neutral');
close(SAP.flailLengthScaleAt(custom, 1, WF, SF, HF, 'load'), 0.6,
  'load sequences return to the neutral connector length');
assert.equal(SAP.sampleLegacyThrust(SAP.createSample(), 0.3, WF, SF, HF).flailLengthScale, 1,
  'legacy weapons never inherit a previous pose sample');

const config = JSON.parse(fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8')); // Committed stance is the player's default, not a preview-only override.
assert.equal(config.stances.lightWeapon.flailLengthScale, 0.6);
const visual = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8'); // The single flail renderer owns rope, contact point and physics projection.
assert.match(visual, /chainScaleY \*= state\.flailLengthScale/, 'physical and visible connector share the same length multiplier');
assert.match(visual, /const authoredChainScaleY = chainScaleY/, 'rope width retains its independently authored scale');
assert.match(visual, /state\.physicsLength = Math\.max\(0\.01, chainSpan\.length\(\) \* attachmentScale\)/,
  'pendulum uses actual newly shortened connector length');
assert.match(visual, /const endWorld = .*bottomLocal/, 'flail head follows the shortened connector endpoint');
assert.match(visual, /if \(!state\.chain \|\| !state\.headRoot\)/, 'ordinary non-flail weapon visuals bypass length changes');

const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8'); // Editor is the user-facing authoring surface.
assert.match(editor, /key: 'flailLengthScale'.*min: 0\.1, max: 3/, 'all combat keyframes expose the reach slider');
assert.match(editor, /flailLengthScale: SharedAttackPose\.flailLengthScaleAt\(anim\.poses, sampleT/,
  'editor scrubbing uses gameplay-length sampling instead of a second timing implementation');
assert.match(editor, /anim\.poses\[phase\]\.flailLengthScale = SharedAttackPose\.validFlailLength\(raw\?\.flailLengthScale\)/,
  'imports restore authored connector length while old exports retain full length');
console.log('flail pose connector length: PASS (shared lerp, Light neutral, authoring, preview, physics)');
