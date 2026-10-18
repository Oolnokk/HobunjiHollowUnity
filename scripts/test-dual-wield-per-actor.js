#!/usr/bin/env node
'use strict';

// The dual-wield visuals are per actor: the player keeps its own state and every humanoid that holds a dual-wield
// weapon gets its own, driven by that actor's published holder and grip state. Executes the real module with
// minimal doubles; the transform-following duplicates themselves need real three.js and are covered by the
// headless run documented in docs/architecture/shared-attack-pose.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registered = [];
const sandbox = {
  console,
  performance: { now: () => 1000 },
  location: { pathname: '/index.html' },
  window: {
    HobunjiHandToolGrips: { currentDualWieldAnimationState: () => ({ influence: 0, idleBlend: 0 }), currentSecondaryGripAnimationState: () => null, setEditorIdlePreview: () => false },
    RuntimeFrameScheduler: { register: (id, fn, options) => registered.push({ id, fn, options }) },
  },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('docs/js/dual-wield-weapon-visuals.js', 'utf8'), sandbox, { filename: 'dual-wield-weapon-visuals.js' });
const visuals = sandbox.window.HobunjiDualWieldWeaponVisuals;
assert.ok(visuals, 'module installs');

// The scheduler runs the all-actor sync, not just the player's.
assert.equal(registered.length, 1); assert.equal(registered[0].id, 'dual-wield-weapon-visuals'); assert.equal(registered[0].options.phase, 'pre-render');

const socket = { position: { x: 1 }, quaternion: { x: 0 } };
function actorRecord(grip, withHolder = true) {
  const holder = { parent: {}, children: [] };
  const avatarRoot = { parent: {}, userData: { proceduralHandToolHolder: withHolder ? holder : null, proceduralHandAnimationGrip: grip } };
  return { avatarRoot, holder };
}

// An actor that is not dual-wielding costs nothing and leaves its hand socket untouched.
{
  const rest = actorRecord({ dualWieldInfluence: 0, dualWieldIdleBlend: 0 });
  rest.holder.children = [{ visible: true, userData: { toolPlane: { isObject3D: true, parent: rest.holder } } }];
  assert.equal(visuals.transformSocketForHand(rest, 'right', socket), socket);
  assert.equal(visuals.debugSnapshot().actorStates, 0, 'no duplicates are built for a one-handed actor');
}
// An actor with no animated holder falls back to the player's context (and so to nothing in this fixture).
{
  const none = actorRecord(null, false);
  assert.equal(visuals.transformSocketForHand(none, 'left', socket), socket);
}
// The all-actor sync runs without throwing when nothing is active, and the player's explicit sync is unaffected.
registered[0].fn();
assert.equal(visuals.syncNow(), null);
assert.equal(visuals.debugSnapshot().active, false);
visuals.resetPoseHistory(actorRecord(null));

console.log('dual wield per-actor tests passed');
