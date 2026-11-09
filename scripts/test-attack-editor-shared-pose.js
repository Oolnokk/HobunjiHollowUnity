#!/usr/bin/env node
'use strict';

// The attack-animation editor must play poses through the same SharedAttackPose timeline, rest poses and
// mirroring rule the game uses for the player and every enemy. Executes the editor's real poseAt /
// STYLE_NEUTRAL_POSE / flipPose against the real module.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
assert.match(html, /js\/combat\/shared-attack-pose\.js\?v=[A-Za-z0-9_-]+/, 'editor loads the shared module');

const slice = (from, to) => { const a = html.indexOf(from); const b = html.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} block`); return html.slice(a, b); };
const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('docs/js/combat/shared-attack-pose.js', 'utf8'), sandbox);
const SAP = sandbox.window.SharedAttackPose;
const wholeFunction = name => { const a = html.indexOf(`function ${name}(`); const b = html.indexOf('\n}\n', a); assert.ok(a > 0 && b > a, `${name} source`); return html.slice(a, b + 2); };
vm.runInContext(`
const SharedAttackPose = window.SharedAttackPose;
${slice('function defaultPose(', '\n') }
${slice('const STYLE_NEUTRAL_POSE', 'function neutralPoseFor')}
${wholeFunction('flipPose')}
${wholeFunction('sinkPctForPhase')}
var anim;
`, sandbox);
vm.runInContext(slice('function poseAt(t) {', 'function applyPoseToRig'), sandbox);
vm.runInContext('globalThis.__editor = { STYLE_NEUTRAL_POSE, poseAt, flipPose, setAnim(a) { anim = a; } };', sandbox);
const editor = sandbox.__editor;

// Rest poses are the game's (plus the editor-only drink preview), as independent copies.
for (const [style, pose] of Object.entries(SAP.STYLE_NEUTRAL_POSE)) {
  assert.deepEqual({ ...editor.STYLE_NEUTRAL_POSE[style] }, { ...pose }, `${style} rest pose matches the game`);
  assert.ok(!Object.isFrozen(editor.STYLE_NEUTRAL_POSE[style]) && editor.STYLE_NEUTRAL_POSE[style] !== pose, `${style} is an editable copy`);
}
assert.ok(editor.STYLE_NEUTRAL_POSE.drink, 'editor-only drink preview rest pose remains');

// Every phase of poseAt equals the game's sampled channels (degrees) for the same timeline.
const authored = {
  neutral: { x: 0.1, y: 0, z: 0.16, pitch: 0, yaw: 10, bodyYaw: 0, roll: 20, scale: 1, bodySink: 6 },
  windup: { x: 0.3, y: 0.1, z: 0.2, pitch: 30, yaw: 40, bodyYaw: -60, roll: 50, bodySink: 14 },
  strike: { x: -0.2, y: 0.2, z: 0.4, pitch: -30, yaw: -40, bodyYaw: 70, roll: -50, bodySink: 3 },
};
const out = SAP.createSample();
for (const sequence of ['attack', 'load', 'fire']) {
  editor.setAnim({ sequence, windupFrac: 0.2, strikeFrac: 0.4, holdFrac: 0.6, poses: authored });
  for (const t of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1]) {
    const { pose, phase } = editor.poseAt(t);
    assert.ok(phase, 'phase label');
    SAP.samplePose(out, { neutral: authored.neutral, windup: authored.windup, strike: authored.strike }, SAP.STYLE_NEUTRAL_POSE.sweep, t, 0.2, 0.4, 0.6, 1, 1, sequence);
    const close = (a, b, key) => assert.ok(Math.abs(a - b) < 1e-9, `${sequence}@${t} ${key}: editor ${a} vs game ${b}`);
    close(pose.x, out.x, 'x'); close(pose.y, out.y, 'y'); close(pose.z, out.z, 'z');
    close(pose.pitch * Math.PI / 180, out.pitchRad, 'pitch'); close(pose.yaw * Math.PI / 180, out.yawRad, 'yaw');
    close(pose.roll * Math.PI / 180, out.rollRad, 'roll'); close(pose.bodyYaw * Math.PI / 180, out.bodyYawRad, 'bodyYaw');
    close(pose.bodySink, out.bodySink, 'bodySink'); // The legs fold on the same lerp the game plays.
  }
}
editor.setAnim({ sequence: 'attack', windupFrac: 0.2, strikeFrac: 0.4, holdFrac: 0.6, poses: { ...authored, strike: { ...authored.strike, secondaryGrip: { enabled: true } } } });
assert.deepEqual(editor.poseAt(0.5).pose.secondaryGrip, { enabled: true }, 'hold phase keeps the strike pose object (grip fields)');
assert.equal(editor.poseAt(0.5).phase, 'hold');

// Backhand mirroring negates exactly the game's mirrored channels.
const flipped = editor.flipPose({ x: 1, y: 2, z: 3, pitch: 4, yaw: 5, bodyYaw: 6, roll: 7 });
for (const key of SAP.POSE_KEYS) assert.equal(flipped[key], SAP.MIRRORED_POSE_KEYS[key] ? -({ x: 1, y: 2, z: 3, pitch: 4, yaw: 5, bodyYaw: 6, roll: 7 })[key] : ({ x: 1, y: 2, z: 3, pitch: 4, yaw: 5, bodyYaw: 6, roll: 7 })[key], `flip ${key}`);

console.log('attack editor shared pose tests passed');
