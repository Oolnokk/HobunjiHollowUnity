#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const capture = source('docs/js/held-seed-desktop-capture.js'); // Used to pin the PC-specific direct Plant interception.
const loader = source('docs/js/combat/combat-config-loader.js'); // Used to ensure the capture installs after the public held-seed dispatcher exists.

assert.match(capture, /window\.addEventListener\('keydown', capturePlantKey, true\)/,
  'desktop Plant interception runs at window capture time before game.js input routing');
assert.match(capture, /currentDesktopBinding\(plant\.slot\)/,
  'desktop Plant interception follows the configured semantic action slot');
assert.match(capture, /saved\?\.desktop\?\.\[actionId\] \|\| authored/,
  'desktop Plant interception honors user-remapped keys before authored defaults');
assert.match(capture, /HobunjiHeldSeedActionBridge[\s\S]*?dispatchPlant\?\.\(plant\.action\)/,
  'desktop capture delegates crop mutation to the existing direct held-seed dispatcher');
assert.match(capture, /event\.preventDefault\(\);[\s\S]*?event\.stopImmediatePropagation\(\);/,
  'claimed Plant input cannot continue into game.js and re-enter the hidden tool queue');
assert.match(capture, /typingTarget\(event\.target\)/,
  'typing into text controls cannot accidentally plant seeds');

const heldIndex = loader.indexOf('held-seed-action-bridge.js');
const desktopIndex = loader.indexOf('held-seed-desktop-capture.js?v=20260814a');
const alcoholIndex = loader.indexOf('alcohol-gameplay-bridge.js');
assert.ok(heldIndex >= 0 && desktopIndex > heldIndex && alcoholIndex > desktopIndex,
  'desktop seed capture loads immediately after the held-seed dispatcher and before later held-item providers');

console.log('desktop held-seed capture tests passed');
