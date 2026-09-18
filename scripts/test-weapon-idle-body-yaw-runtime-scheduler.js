#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership migration of weapon-idle-body-yaw-runtime.js:
// its self-recursive sync() loop (including the early "waiting for runtime"
// reschedule) becomes a single RuntimeFrameScheduler registration on the
// pre-render phase, since it writes into the PlayerBodyTransformComposer's
// 'weapon-idle-stance-body-yaw' channel that must be fresh immediately before
// render-time composer application. This module is only ever dynamically
// loaded by held-action-animations.js in the shipped game (the
// `else if (!isAnimationAuthor)` branch), never by a docs/tools/* editor
// page, so it needs no requestAnimationFrame fallback at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/weapon-idle-body-yaw-runtime.js', 'utf8');
assert(source.includes("global.RuntimeFrameScheduler.register('weapon-idle-body-yaw-sync', sync"), 'sync must register with the scheduler');
assert(!/global\.requestAnimationFrame\(/.test(source), 'this single-context module must have no remaining raw requestAnimationFrame call');

function buildFixture({ withRuntime = true } = {}) {
  const registered = new Map();
  let idleSnapshot = { active: false, yawDeg: 0, reason: 'idle' };
  let swimming = false;
  const channels = new Map();
  const player = { id: 'player-mesh' };
  const windowObject = {
    RuntimeFrameScheduler: {
      register(id, fn, options) { registered.set(id, { fn, options }); },
    },
    PlayerBodyTransformComposer: withRuntime ? {
      getPlayerMesh() { return player; },
      setChannel(name, value) { channels.set(name, value); },
      clearChannel(name) { channels.delete(name); },
    } : undefined,
    WeaponToolStances: withRuntime ? {
      idleBodyYawSnapshot(state) { return Object.assign(state, idleSnapshot); },
    } : undefined,
    Combat: withRuntime ? {
      deps: { isPlayerSwimming: () => swimming },
    } : undefined,
  };
  const sandbox = { window: windowObject };
  vm.runInNewContext(source, sandbox, { filename: 'weapon-idle-body-yaw-runtime.js' });
  return {
    windowObject,
    registered,
    channels,
    setSnapshot: value => { idleSnapshot = value; },
    setSwimming: value => { swimming = !!value; },
  };
}

// --- Registration shape -----------------------------------------------------
{
  const { registered } = buildFixture();
  const entry = registered.get('weapon-idle-body-yaw-sync');
  assert(entry, 'sync registers under a stable id');
  assert.equal(entry.options.owner, 'WeaponIdleBodyYawRuntime');
  assert.equal(entry.options.phase, 'pre-render', 'writes into the PlayerBodyTransformComposer channel, so it must run on the pre-render phase');
}

// --- Waiting-for-runtime path no longer needs a reschedule -----------------
{
  const { registered, windowObject } = buildFixture({ withRuntime: false });
  const entry = registered.get('weapon-idle-body-yaw-sync');
  assert.doesNotThrow(() => entry.fn(), 'sync must tolerate missing composer/stances without throwing');
  assert.equal(windowObject.WeaponIdleBodyYawRuntime.getDebug().reason, 'waiting-for-runtime');
}

// --- Active idle yaw is pushed into the composer channel --------------------
{
  const { registered, channels, setSnapshot } = buildFixture();
  setSnapshot({ active: true, yawDeg: 12.5, reason: 'idle-active' });
  registered.get('weapon-idle-body-yaw-sync').fn();
  const channel = channels.get('weapon-idle-stance-body-yaw');
  assert(channel, 'active idle yaw sets the composer channel');
  assert.equal(channel.mode, 'additive');
  assert.ok(Math.abs(channel.rotation.yaw - (12.5 * Math.PI / 180)) < 1e-9);
}

// --- Clearing when no longer active -----------------------------------------
{
  const { registered, channels, setSnapshot } = buildFixture();
  setSnapshot({ active: true, yawDeg: 12.5, reason: 'idle-active' });
  registered.get('weapon-idle-body-yaw-sync').fn();
  assert(channels.has('weapon-idle-stance-body-yaw'));
  setSnapshot({ active: false, yawDeg: 0, reason: 'idle-inactive' });
  registered.get('weapon-idle-body-yaw-sync').fn();
  assert(!channels.has('weapon-idle-stance-body-yaw'), 'inactive snapshot clears the composer channel');
}


// --- Swimming owns whole-body yaw --------------------------------------------
{
  const { registered, channels, windowObject, setSnapshot, setSwimming } = buildFixture();
  setSnapshot({ active: true, yawDeg: 12.5, reason: 'idle-active' });
  registered.get('weapon-idle-body-yaw-sync').fn();
  assert(channels.has('weapon-idle-stance-body-yaw'));
  setSwimming(true);
  registered.get('weapon-idle-body-yaw-sync').fn();
  assert(!channels.has('weapon-idle-stance-body-yaw'), 'swimming clears the weapon-idle body-yaw channel');
  const debug = windowObject.WeaponIdleBodyYawRuntime.getDebug();
  assert.equal(debug.active, false);
  assert.equal(debug.reason, 'swimming', 'debug reports that swim facing owns body yaw');
}

// --- getDebug reflects last applied state -----------------------------------
{
  const { registered, windowObject, setSnapshot } = buildFixture();
  setSnapshot({ active: true, yawDeg: 7, reason: 'idle-active' });
  registered.get('weapon-idle-body-yaw-sync').fn();
  const debug = windowObject.WeaponIdleBodyYawRuntime.getDebug();
  assert.equal(debug.active, true);
  assert.equal(debug.yawDeg, 7);
  assert.equal(debug.reason, 'idle-active');
}

console.log('weapon idle body yaw runtime scheduler migration passed');
