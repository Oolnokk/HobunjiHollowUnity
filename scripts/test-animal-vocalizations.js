#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/animal-vocalizations.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, Math, Date }, { filename: 'animal-vocalizations.js' });

let clock = 0;
const rendered = [];
window.AnimalVocalizations.init({
  random: () => 0.5,
  hasVoice: c => c.creatureKey !== 'unsupported',
  renderUtterance: (c, opts) => { rendered.push({ at: clock, id: c.id, ...opts }); return true; },
});

function creature(id, creatureKey = 'gar-wolf') {
  return { id, creatureKey, health: 10, state: 'idle' };
}
function tick(c, seconds, opts) {
  clock += seconds;
  window.AnimalVocalizations.tickCreature(c, seconds, opts);
}

const chatterer = creature('chatter');
tick(chatterer, 8);
tick(chatterer, 0.3);
tick(chatterer, 0.3);
tick(chatterer, 0.3);
const chatter = rendered.filter(x => x.id === 'chatter');
assert.equal(chatter.length, 4, 'passive chatter should produce a multi-call group');
assert.ok(chatter.every(x => x.volume >= 0.16 && x.volume <= 0.26), 'chatter stays quiet');
assert.ok(chatter.every(x => x.rate > 1.18), 'chatter is played at a quick tempo/pitch');
assert.deepEqual(chatter.map(x => Number(x.at.toFixed(2))), [8, 8.3, 8.6, 8.9], 'chatter rhythm is scheduler-driven');

const warningCreature = creature('warning');
const warningStart = clock;
assert.equal(window.AnimalVocalizations.companionDiscovery(warningCreature, 'animal-den'), true);
tick(warningCreature, 0.26);
tick(warningCreature, 0.26);
tick(warningCreature, 0.52);
const warning = rendered.filter(x => x.id === 'warning');
assert.equal(warning.length, 3, 'warning should repeat three times');
assert.ok(warning.every(x => x.volume === 0.94), 'warning is loud');
assert.deepEqual(warning.map(x => Number((x.at - warningStart).toFixed(2))), [0, 0.52, 1.04], 'warning repeats evenly');

const growler = creature('growl');
assert.equal(window.AnimalVocalizations.threatGrowl(growler, 'attack-telegraph'), true);
const growl = rendered.filter(x => x.id === 'growl');
assert.equal(growl.length, 1, 'threat growl is one utterance, not a warning pattern');
assert.ok(growl[0].rate < 0.7, 'threat growl is low-pitched and slow');
assert.equal(growl[0].rateContour.length, 3, 'threat growl carries a sliding rate/pitch contour');

const prioritized = creature('priority');
assert.equal(window.AnimalVocalizations.warning(prioritized, 'territorial-boundary'), true);
assert.equal(window.AnimalVocalizations.threatGrowl(prioritized, 'attack'), false, 'growl cannot interrupt a warning');
assert.equal(window.AnimalVocalizations.companionDiscovery(creature('none', 'unsupported'), 'treasure'), false, 'unsupported species can use caller fallback');

const banditSource = fs.readFileSync(path.join(root, 'docs/js/bandit-camps.js'), 'utf8');
assert.doesNotMatch(banditSource, /AudioSystem/, 'perception producer must not call the audio renderer');
assert.match(banditSource, /requestCompanionDiscovery\?\.\(c, 'bandit-camp'\)/);
assert.match(banditSource, /requestCompanionDiscovery\?\.\(c, 'animal-den'\)/);
assert.doesNotMatch(source, /new Audio\s*\(|window\.AudioSystem/, 'semantic coordinator must remain audio-backend agnostic');

const gameSource = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
assert.match(gameSource, /AnimalVocalizations\?\.tickCreature\?\.\(c, dt\)/, 'hostile cadence drives passive chatter');
assert.match(gameSource, /requestThreatGrowl:/, 'combat receives an explicit growl intent');
const audioSource = fs.readFileSync(path.join(root, 'docs/js/audio-system.js'), 'utf8');
const barkBody = audioSource.match(/function playCreatureBark\(c\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert.doesNotMatch(barkBody, /AnimalVocalizations|growl/, 'legacy bark renderer stays separate from threat growls');

for (const name of [
  'sfx_dabinggi-hound1.ogg', 'sfx_dabinggi-hound2.ogg', 'sfx_drenkirra1.ogg', 'sfx_drenkirra2.ogg',
  'sfx_gar-wolf1.ogg', 'sfx_gar-wolf2.ogg', 'sfx_grehlr1.ogg', 'sfx_grehlr2.ogg',
  'sfx_nelk1.ogg', "sfx_uumkao'ii1.ogg", "sfx_uumkao'ii2.ogg",
]) assert.ok(fs.existsSync(path.join(root, 'docs/assets/audio/sfx', name)), `missing voice asset: ${name}`);

console.log('animal vocalization tests passed');
