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
let autoStartAudio = true; // Disabled by the delayed-start regression below to simulate mobile OGG preparation latency.
const pendingAudioStarts = [];
window.AnimalVocalizations.init({
  random: () => 0.5,
  hasVoice: c => c.creatureKey !== 'unsupported',
  renderUtterance: (c, opts) => {
    rendered.push({ at: clock, id: c.id, ...opts });
    if (autoStartAudio) opts.onStarted();
    else pendingAudioStarts.push(opts.onStarted);
    return true;
  },
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
assert.equal(window.AnimalVocalizations.scalePulse(growler), 1, 'pulse begins at the authored scale');
tick(growler, 0.045, { threatened: true });
assert.ok(window.AnimalVocalizations.scalePulse(growler) > 1
  && window.AnimalVocalizations.scalePulse(growler) <= 1.025, 'generic envelope retains an optional tiny scale-pulse utility');
assert.ok(window.AnimalVocalizations.headNodOffsetDeg(growler) < 0
  && window.AnimalVocalizations.headNodOffsetDeg(growler) >= -4, 'rendered utterance produces a slight upward nod in the animal rig convention');
assert.ok(window.AnimalVocalizations.debugSnapshot().maxHeadNodDeg < 0, 'mobile diagnostics expose the signed upward nod angle');
tick(growler, 0.2, { threatened: true });
assert.equal(window.AnimalVocalizations.scalePulse(growler), 1, 'pulse settles exactly to authored scale');
assert.equal(window.AnimalVocalizations.headNodOffsetDeg(growler), 0, 'nod settles without leaving a neck offset');

const delayed = creature('delayed');
autoStartAudio = false;
assert.equal(window.AnimalVocalizations.threatGrowl(delayed, 'mobile-buffer-test'), true);
tick(delayed, 0.09, { threatened: true });
assert.equal(window.AnimalVocalizations.headNodOffsetDeg(delayed), 0, 'nod must not begin while audio is still preparing');
assert.equal(pendingAudioStarts.length, 1, 'renderer retains one actual-start callback');
pendingAudioStarts.shift()();
tick(delayed, 0.045, { threatened: true });
assert.ok(window.AnimalVocalizations.headNodOffsetDeg(delayed) < 0, 'upward nod begins from the actual audible playback event');
autoStartAudio = true;

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
assert.match(gameSource, /setHeadAdditiveRotation\?\.\(vocalHeadNodDeg\)/, 'utterance nod is applied as a separate neck layer');
assert.doesNotMatch(gameSource, /renderedScaleY = scaleY \* vocalPulseScale/, 'vocalizations must not scale the animal body');
const avatarSource = fs.readFileSync(path.join(root, 'docs/js/png-plane-avatar.js'), 'utf8');
assert.match(avatarSource, /degrees \+ state\.additiveDeg/, 'head rig composes additive animation over the current base neck pose');
assert.match(avatarSource, /setHeadAdditiveRotation/, 'head rig exposes a reusable additive animation API');
const audioSource = fs.readFileSync(path.join(root, 'docs/js/audio-system.js'), 'utf8');
assert.match(audioSource, /addEventListener\?\.\('playing', notifyStarted/, 'visual beat listens for actual audible media playback');
assert.match(audioSource, /playResult\.then\(notifyStarted\)/, 'play promise resolution covers mobile event-order differences');
const barkBody = audioSource.match(/function playCreatureBark\(c\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert.doesNotMatch(barkBody, /AnimalVocalizations|growl/, 'legacy bark renderer stays separate from threat growls');

for (const name of [
  'sfx_dabinggi-hound1.ogg', 'sfx_dabinggi-hound2.ogg', 'sfx_drenkirra1.ogg', 'sfx_drenkirra2.ogg',
  'sfx_gar-wolf1.ogg', 'sfx_gar-wolf2.ogg', 'sfx_grehlr1.ogg', 'sfx_grehlr2.ogg',
  'sfx_nelk1.ogg', "sfx_uumkao'ii1.ogg", "sfx_uumkao'ii2.ogg",
]) assert.ok(fs.existsSync(path.join(root, 'docs/assets/audio/sfx', name)), `missing voice asset: ${name}`);

console.log('animal vocalization tests passed');
