#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const filterSource = fs.readFileSync(path.join(root, 'docs/js/animal-voice-call-clip-filter.js'), 'utf8');
const vocalSource = fs.readFileSync(path.join(root, 'docs/js/animal-vocalizations.js'), 'utf8');
const editorSource = fs.readFileSync(path.join(root, 'docs/js/animal-voice-analysis-editor.js'), 'utf8');

assert.doesNotThrow(() => new vm.Script(filterSource), 'call-clip filter parses as JavaScript');
assert.doesNotThrow(() => new vm.Script(vocalSource), 'semantic animal vocal scheduler still parses');
assert.doesNotThrow(() => new vm.Script(editorSource), 'animal voice editor extension still parses');

const chosen = [];
const window = {
  AudioSystem: {
    playAnimalVoiceUtterance(c) {
      const pools = {
        drenkirra: ['sfx_drenkirra1.ogg', 'sfx_drenkirra2.ogg'],
        grehlr: ['sfx_grehlr1.ogg', 'sfx_grehlr2.ogg'],
      };
      const pool = pools[c.creatureKey] || [];
      if (!pool.length) return false;
      chosen.push(pool[Math.floor(Math.random() * pool.length)]);
      return true;
    },
  },
  setInterval() {},
};
vm.runInNewContext(filterSource, { window, Math, URL, document: { baseURI: 'https://example.test/' } }, { filename: 'animal-voice-call-clip-filter.js' });

const drenkirra = { creatureKey: 'drenkirra' };
assert.equal(window.AudioSystem.playAnimalVoiceUtterance(drenkirra, {
  meaning: 'warning',
  allowedClips: ['sfx_drenkirra2.ogg'],
}), true);
assert.equal(chosen.at(-1), 'sfx_drenkirra2.ogg', 'single allowed recording forces that exact source clip');

const beforeSilent = chosen.length;
assert.equal(window.AudioSystem.playAnimalVoiceUtterance(drenkirra, {
  meaning: 'growl',
  allowedClips: [],
}), false, 'explicit empty allowlist makes that call type silent');
assert.equal(chosen.length, beforeSilent, 'silent call never reaches the underlying renderer');

assert.equal(window.AudioSystem.playAnimalVoiceUtterance(drenkirra, { meaning: 'chatter' }), true, 'missing allowlist preserves legacy all-clips behavior');
assert.equal(window.AnimalVoiceCallClipFilter.debugSnapshot().filteredCalls > 0, true, 'filter diagnostics count constrained calls');
assert.equal(window.AnimalVoiceCallClipFilter.debugSnapshot().suppressedCalls, 1, 'filter diagnostics count explicit silent calls');

assert.match(vocalSource, /animal-voice-call-clip-filter\.js/, 'semantic scheduler loads the dedicated call-clip filter');
assert.match(vocalSource, /allowedClips:\s*authoredAllowedClips/, 'each rendered utterance carries the effective call-specific allowlist');
assert.match(editorSource, /Call recording assignments/, 'Animals editor exposes the per-call recording matrix');
assert.match(editorSource, /data-call-clip-kind/, 'matrix stores independent checkbox state for chatter, warning and growl');
assert.match(editorSource, /No recordings enabled for \$\{kind\}/, 'preview refuses to play when a call has no enabled recordings');

console.log('animal voice call clip allowlist checks passed');
