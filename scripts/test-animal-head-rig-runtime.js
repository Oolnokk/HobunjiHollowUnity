#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const speciesSource = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');

assert.match(avatarSource, /function applyAnimalHeadRig\([\s\S]{0,1800}avatarRef\.updateHeadRotation =/,
  'the painted-weight avatar runtime exposes a smoothed head-rotation API');
const rigTableStart = speciesSource.indexOf('const ANIMAL_HEAD_RIGS =');
const rigTable = speciesSource.slice(rigTableStart, rigTableStart + 120000);
assert.ok(rigTableStart >= 0
  && rigTable.includes('"dabinggi-hound"')
  && rigTable.includes('"gar-wolf"')
  && rigTable.includes('"drenkirra"')
  && rigTable.includes('"grehlr"'),
  'the authored species rig table includes the four animal families');
assert.ok(indexSource.indexOf('js/png-plane-avatar.js') < indexSource.indexOf('js/creature-genetics.js')
  && indexSource.indexOf('js/creature-genetics.js') < indexSource.indexOf('js/creature-genetics-render.js'),
  'the head-rig runtime loads before the species bridge and game startup');

console.log('Animal head-rig runtime regression checks passed.');
