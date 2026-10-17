'use strict';
// The sweep style's -90° in-plane twist belongs to the swing, not to a resting stance. The Attack Editor cancels it at
// every sweep-style Neutral, so a tool slot (axe) drawn in its idle stance must cancel it too; otherwise the axe sits
// turned 90° about its own face in game while the hands use the editor's grip frame.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

global.window = { __farmLog() {}, Combat: { deps: {} } };
global.localStorage = { getItem() { return null; } };
global.fetch = async () => { throw new Error('offline test'); };
global.performance = { now: () => 1000 };
vm.runInThisContext(fs.readFileSync('docs/js/weapon-tool-stances.js', 'utf8'), { filename: 'weapon-tool-stances.js' });
const weight = window.WeaponToolStances.sweepTwistCancelWeight;

const sweep = { animStyle: 'sweep' }, thrust = { animStyle: 'thrust' };
assert.equal(weight('axe', sweep, null, true), 1, 'axe at rest in its stance cancels the twist fully');
assert.equal(weight('harpoon', sweep, null, true), 1, 'any tool slot with a sweep style does');
assert.equal(weight('axe', sweep, null, false), 0, 'a tool mid-swing (stance suppressed) keeps the swing twist');
assert.equal(weight('axe', thrust, null, true), 0, 'non-sweep tools have no twist to cancel');
assert.equal(weight('weapon', sweep, null, false), 1, 'idle weapon is unchanged');
assert.equal(weight('weapon', thrust, null, false), 0, 'idle non-sweep weapon is unchanged');
console.log('tool slot sweep twist cancel ok');
