#!/usr/bin/env node
'use strict';

// Regression for the Stage 1 RAF-ownership migration: this module used to
// retry install() on a permanent per-frame RAF loop until window.AudioSystem
// (and its playSfx method) appeared. It now hooks AudioSystem's assignment
// once via the repo's standard chainGlobal late-hook idiom instead (see
// docs/architecture/runtime-frame-scheduler.md's ownership audit).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/crossbow-strike-audio-trim.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'the crossbow trim installer must no longer own a direct requestAnimationFrame( call site');
assert(source.includes("chainGlobal('AudioSystem', install)"), 'the installer must hook AudioSystem\'s assignment instead of polling for it');

function freshContext() {
  const context = { window: {}, console: { error: () => {} } };
  vm.createContext(context);
  return context;
}

// Case 1: AudioSystem (with playSfx already present) exists before this
// module loads — install must happen synchronously, with no RAF at all.
{
  const context = freshContext();
  let originalCalls = 0;
  context.window.AudioSystem = { playSfx: function original() { originalCalls++; } };
  vm.runInContext(source, context, { filename: 'crossbow-strike-audio-trim.js' });
  assert.equal(context.window.HobunjiCrossbowStrikeAudioTrim.installed, true, 'installs immediately when AudioSystem already exists');
  assert.equal(context.window.AudioSystem.playSfx.__hobunjiCrossbowTrimWrapped, true, 'wraps the real playSfx method');
}

// Case 2: AudioSystem is assigned AFTER this module loads (the real shipped
// load order, since audio-system.js currently loads later than this file) —
// the chained property setter must catch that later assignment and install
// exactly once, with no polling loop needed to "catch up".
{
  const context = freshContext();
  vm.runInContext(source, context, { filename: 'crossbow-strike-audio-trim.js' });
  assert.equal(context.window.HobunjiCrossbowStrikeAudioTrim.installed, false, 'does not install before AudioSystem exists');

  let originalCalls = 0;
  context.window.AudioSystem = { playSfx: function original() { originalCalls++; } };
  assert.equal(context.window.HobunjiCrossbowStrikeAudioTrim.installed, true, 'the chained setter installs the moment AudioSystem is assigned');
  assert.equal(context.window.AudioSystem.playSfx.__hobunjiCrossbowTrimWrapped, true, 'wraps the real playSfx method once it exists');

  // Re-assigning AudioSystem again (e.g. a hot-reload path) must not
  // double-wrap or throw — install() is idempotent, matching its old
  // polling-loop guard (`audio.playSfx.__hobunjiCrossbowTrimWrapped`).
  const wrappedOnce = context.window.AudioSystem.playSfx;
  context.window.AudioSystem = context.window.AudioSystem;
  assert.equal(context.window.AudioSystem.playSfx, wrappedOnce, 're-assigning the same AudioSystem does not re-wrap playSfx');
}

// Case 3: AudioSystem exists but never gains a real playSfx (the actual
// current shipped state, since nothing in docs/js assigns AudioSystem.playSfx
// today) — the module must simply stay uninstalled forever without ever
// requesting a browser frame to keep retrying, matching the "same eventual
// outcome, none of the wasted per-frame cost" migration goal.
{
  const context = freshContext();
  context.window.AudioSystem = { playOneShotSfx: () => {} }; // No playSfx at all.
  vm.runInContext(source, context, { filename: 'crossbow-strike-audio-trim.js' });
  assert.equal(context.window.HobunjiCrossbowStrikeAudioTrim.installed, false, 'stays uninstalled when AudioSystem never exposes playSfx, same as the old polling loop would eventually');
}

console.log('crossbow strike audio trim chainGlobal migration passed');
