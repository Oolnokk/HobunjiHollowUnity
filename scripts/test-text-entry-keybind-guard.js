#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const guardSource = source('docs/js/text-entry-keybind-guard.js'); // Used to execute the shared text-entry/global-keybind barrier in a tiny DOM mock.
const loaderSource = source('docs/js/combat/combat-config-loader.js'); // Used to pin the guard before gameplay keyboard modules.
const indexSource = source('docs/index.html'); // Used to prove the bootstrap itself executes before game.js registers its global shortcuts.
const listeners = new Map(); // Used to capture the guard's document listeners without requiring a browser or jsdom.
const documentMock = {
  activeElement: null,
  addEventListener(type, listener, options) {
    listeners.set(type, { listener, options });
  },
};
const windowMock = {}; // Used as the browser-global API surface populated by the guard module.

vm.runInNewContext(guardSource, {
  window: windowMock,
  document: documentMock,
  console,
});

assert.ok(windowMock.HobunjiTextInputGuard,
  'shared text-entry guard exposes a reusable runtime/debug API');
assert.equal(listeners.get('keydown')?.options, false,
  'keydown suppression is intentionally bubble-phase so the focused input handles the key first');
assert.equal(listeners.get('keyup')?.options, false,
  'keyup suppression is intentionally bubble-phase so the focused input handles the release first');

const input = { // Used to model the animal/farm text field that must own M or any other bound key.
  tagName: 'INPUT',
  id: 'animalName',
  closest() { return this; },
};
let stopped = 0; // Used to prove global gameplay propagation is cancelled for a text-entry keydown.
let prevented = 0; // Used to prove native text entry itself is never cancelled.
listeners.get('keydown').listener({
  type: 'keydown',
  target: input,
  code: 'KeyM',
  key: 'm',
  stopImmediatePropagation() { stopped += 1; },
  preventDefault() { prevented += 1; },
});
assert.equal(stopped, 1,
  'M from a focused name input is stopped before global gameplay/menu keybind listeners');
assert.equal(prevented, 0,
  'the guard does not preventDefault, so the typed character still reaches the input');

const editable = { tagName: 'DIV', id: 'customEditor', isContentEditable: true }; // Used to model richer future text editors.
const editableChild = { // Used to prove descendants inside contenteditable regions are protected too.
  tagName: 'SPAN',
  closest() { return editable; },
};
stopped = 0;
listeners.get('keyup').listener({
  type: 'keyup',
  target: editableChild,
  code: 'Space',
  key: ' ',
  stopImmediatePropagation() { stopped += 1; },
});
assert.equal(stopped, 1,
  'keyup from a contenteditable descendant cannot leak into held/release gameplay actions');

const ordinaryTarget = { // Used to prove normal world/gameplay keyboard input is unaffected when the player is not editing.
  tagName: 'DIV',
  closest() { return null; },
};
documentMock.activeElement = null;
stopped = 0;
listeners.get('keydown').listener({
  type: 'keydown',
  target: ordinaryTarget,
  code: 'KeyM',
  key: 'm',
  stopImmediatePropagation() { stopped += 1; },
});
assert.equal(stopped, 0,
  'the same M key continues to reach gameplay shortcuts when no editor owns keyboard focus');

const bodyTarget = { tagName: 'BODY', closest() { return null; } }; // Used to model WebViews that retarget keyboard events away from the focused control.
documentMock.activeElement = input;
stopped = 0;
listeners.get('keydown').listener({
  type: 'keydown',
  target: bodyTarget,
  code: 'KeyQ',
  key: 'q',
  stopImmediatePropagation() { stopped += 1; },
});
assert.equal(stopped, 1,
  'activeElement fallback protects text editing even when a browser/WebView retargets the event');

const debug = windowMock.HobunjiTextInputGuard.getDebug(); // Used to pin the mobile-safe diagnostic surface for regression reports.
assert.equal(debug.blockedKeydowns, 2,
  'debug state counts protected keydowns');
assert.equal(debug.blockedKeyups, 1,
  'debug state counts protected keyups');
assert.equal(debug.lastBlocked.code, 'KeyQ',
  'debug state reports the most recently blocked gameplay key');

const guardIndex = loaderSource.indexOf('text-entry-keybind-guard.js'); // Used to verify registration order against later gameplay keyboard adapters.
const heldActionIndex = loaderSource.indexOf('held-seed-action-bridge.js'); // Used as a known document-keydown gameplay listener that must register later.
const heldDesktopIndex = loaderSource.indexOf('held-seed-desktop-capture.js'); // Used as the capture-phase adapter that already has its own typing-target guard.
assert.ok(guardIndex >= 0 && heldActionIndex > guardIndex && heldDesktopIndex > guardIndex,
  'shared guard loads before held-item keyboard gameplay adapters');

const loaderIndex = indexSource.indexOf('js/combat/combat-config-loader.js'); // Used to pin the parser-blocking bootstrap ahead of game.js.
const gameIndex = indexSource.indexOf('game.js?v='); // Used to pin registration order for legacy global menu/gameplay shortcuts.
assert.ok(loaderIndex >= 0 && gameIndex > loaderIndex,
  'the guard bootstrap runs before game.js can register legacy global shortcuts such as the menu key');

console.log('text-entry gameplay keybind guard tests passed');
