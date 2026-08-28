#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/animal-vocalizations.js'), 'utf8');
const independentPlaybackSource = fs.readFileSync(path.join(root, 'docs/js/animal-voice-independent-playback.js'), 'utf8');
const analysisEditorSource = fs.readFileSync(path.join(root, 'docs/js/animal-voice-analysis-editor.js'), 'utf8');
const overheadText = [];
const window = {
  AmbientDialogue: {
    show: (rootObject, text, opts) => { overheadText.push({ rootObject, text, opts }); return {}; },
  },
};
assert.doesNotThrow(() => new vm.Script(independentPlaybackSource), 'independent animal playback module parses as JavaScript');
assert.doesNotThrow(() => new vm.Script(analysisEditorSource), 'animal voice analysis editor module parses as JavaScript');
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

function creature(id, creatureKey = 'gar-wolf', sizeClass = 'medium') {
  return {
    id, creatureKey, health: 10, state: 'idle', genotype: { sizeClass },
    avatarRef: { group: { id: `${id}-group` } },
  };
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
assert.ok(chatter.every(x => x.tempo > 1.18 && x.tempo < 1.56), 'chatter tempo uses its independent quick range');
assert.ok(chatter.every(x => x.pitchSemitones > 2.86 && x.pitchSemitones < 7.7), 'chatter pitch uses its independent raised range');
assert.ok(chatter.every(x => x.rate === x.tempo), 'legacy fallback rate mirrors tempo only instead of re-coupling authored pitch');
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
assert.ok(warning.every(x => x.tempo >= 0.96 && x.tempo <= 1.06), 'warning tempo remains near neutral');
assert.ok(warning.every(x => x.pitchSemitones >= -0.71 && x.pitchSemitones <= 1.01), 'warning pitch is independently near neutral');
assert.deepEqual(warning.map(x => Number((x.at - warningStart).toFixed(2))), [0, 0.52, 1.04], 'warning repeats evenly');

const growler = creature('growl');
assert.equal(window.AnimalVocalizations.threatGrowl(growler, 'attack-telegraph'), true);
const growl = rendered.filter(x => x.id === 'growl');
assert.equal(growl.length, 1, 'threat growl is one utterance, not a warning pattern');
assert.ok(growl[0].tempo < 0.7, 'threat growl keeps its deliberately slow tempo');
assert.ok(growl[0].pitchSemitones < -6, 'threat growl independently lowers pitch');
assert.equal(growl[0].tempoContour.length, 3, 'threat growl carries its own tempo contour');
assert.equal(growl[0].pitchContourSemitones.length, 3, 'threat growl carries a separate pitch contour');
assert.notDeepEqual(Array.from(growl[0].tempoContour), Array.from(growl[0].pitchContourSemitones), 'tempo and pitch contours are no longer one shared playback-rate curve');
assert.equal(window.AnimalVocalizations.scalePulse(growler), 1, 'pulse begins at the authored scale');
tick(growler, 0.045, { threatened: true });
assert.ok(window.AnimalVocalizations.scalePulse(growler) > 1
  && window.AnimalVocalizations.scalePulse(growler) <= 1.025, 'generic envelope retains an optional tiny scale-pulse utility');
assert.ok(window.AnimalVocalizations.headNodOffsetDeg(growler) < 0
  && window.AnimalVocalizations.headNodOffsetDeg(growler) >= -10, 'rendered utterance produces the authored 10-degree upward nod in the animal rig convention');
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

window.AnimalVocalizations.setAuthoredProfiles({
  'gar-wolf': {
    sizePitchSemitones: { small: 3, medium: 0, large: -4 },
    warning: {
      repeats: 2, intervalMs: 300,
      volumeMin: 0.6, volumeMax: 0.6,
      tempoMin: 1.1, tempoMax: 1.1,
      pitchMinSemitones: 5, pitchMaxSemitones: 5,
    },
    growl: { tempoContour: [1, 1.4, 0.8], pitchContourSemitones: [0, -2, 1] },
    discoveryText: { 'animal-den': ['Den! Den!'] },
  },
});
const authoredProfile = window.AnimalVocalizations.profileForDebug(creature('profile'));
assert.equal(authoredProfile.warning.repeats, 2, 'species warning repeat count comes from authored profile');
assert.equal(authoredProfile.warning.intervalMs, 300, 'species warning rhythm comes from authored profile');
assert.deepEqual(Array.from(authoredProfile.growl.tempoContour), [1, 1.4, 0.8], 'species growl tempo contour comes from authored profile');
assert.deepEqual(Array.from(authoredProfile.growl.pitchContourSemitones), [0, -2, 1], 'species growl pitch contour is authored separately');
assert.deepEqual({ ...authoredProfile.sizePitchSemitones }, { small: 3, medium: 0, large: -4 }, 'species carries one Small/Medium/Large pitch-offset map shared by every vocal intent');

const authoredSmall = creature('authored-small', 'gar-wolf', 'small');
const authoredStart = clock;
assert.equal(window.AnimalVocalizations.companionDiscovery(authoredSmall, 'animal-den'), true);
tick(authoredSmall, 0.3, { threatened: false });
const authoredCalls = rendered.filter(x => x.id === 'authored-small');
assert.equal(authoredCalls.length, 2, 'authored warning repeat count drives rendered utterances');
assert.deepEqual(authoredCalls.map(x => Number((x.at - authoredStart).toFixed(2))), [0, 0.3], 'authored warning interval drives cadence');
assert.ok(authoredCalls.every(x => x.volume === 0.6 && x.tempo === 1.1), 'authored warning volume and tempo drive playback');
assert.ok(authoredCalls.every(x => x.pitchSemitones === 8), 'Small size offset adds +3 semitones after the authored +5 pitch');
assert.ok(authoredCalls.every(x => x.sizePitchSemitones === 3), 'render payload exposes the applied size-class pitch offset for diagnostics');
assert.equal(overheadText.at(-1)?.text, 'Den! Den!', 'reason-specific animal text is shown with the audible warning');
assert.equal(window.AnimalVocalizations.debugSnapshot().textRendered > 0, true, 'mobile diagnostics count authored overhead animal text');

const large = creature('authored-large', 'gar-wolf', 'large');
assert.equal(window.AnimalVocalizations.warning(large, 'size-test', { repeats: 1 }), true);
const largeCall = rendered.find(x => x.id === 'authored-large');
assert.equal(largeCall.tempo, 1.1, 'Large size does not change authored tempo');
assert.equal(largeCall.pitchSemitones, 1, 'Large size applies its -4 semitone offset to the same +5 base pitch');
assert.equal(window.AnimalVocalizations.creatureSizeClass(large), 'large', 'runtime reads canonical genotype.sizeClass');
window.AnimalVocalizations.setAuthoredProfiles({});

window.AnimalVocalizations.setAuthoredProfiles({
  'gar-wolf': { warning: { rateMin: 1.25, rateMax: 1.25 } },
});
const migrated = window.AnimalVocalizations.profileForDebug(creature('legacy-profile')).warning;
assert.equal(migrated.tempoMin, 1.25, 'old coupled rateMin migrates to tempoMin');
assert.ok(Math.abs(migrated.pitchMinSemitones - 12 * Math.log2(1.25)) < 0.0001, 'old coupled rateMin also migrates to its equivalent pitch so old authoring keeps its sound');
window.AnimalVocalizations.setAuthoredProfiles({});

const prioritized = creature('priority');
assert.equal(window.AnimalVocalizations.warning(prioritized, 'territorial-boundary'), true);
assert.equal(window.AnimalVocalizations.threatGrowl(prioritized, 'attack'), false, 'growl cannot interrupt a warning');
assert.equal(window.AnimalVocalizations.companionDiscovery(creature('none', 'unsupported'), 'treasure'), false, 'unsupported species can use caller fallback');

const banditSource = fs.readFileSync(path.join(root, 'docs/js/bandit-camps.js'), 'utf8');
assert.doesNotMatch(banditSource, /AudioSystem/, 'perception producer must not call the audio renderer');
assert.match(banditSource, /requestCompanionDiscovery\?\.\(c, 'bandit-camp'\)/);
assert.match(banditSource, /requestCompanionDiscovery\?\.\(c, 'animal-den'\)/);
assert.doesNotMatch(source, /new Audio\s*\(|window\.AudioSystem/, 'semantic coordinator must remain audio-backend agnostic');
assert.match(source, /animal-voice-independent-playback\.js/, 'semantic coordinator requests the separate independent playback adapter without taking ownership of Audio objects');
assert.match(source, /config\/dialogue\/ambient-dialogue\.json/, 'semantic coordinator reads per-species authoring from the existing ambient dialogue config');
assert.match(source, /AmbientDialogue\.show/, 'semantic coordinator can associate an audible utterance with authored overhead text');

assert.match(independentPlaybackSource, /preservesPitch\s*=\s*enabled/, 'independent renderer keeps a pitch-preserving native fallback');
assert.match(independentPlaybackSource, /wsolaStretch/, 'independent renderer uses WSOLA for higher-quality time stretching');
assert.match(independentPlaybackSource, /resampleChannels/, 'independent renderer separates pitch by resampling before WSOLA duration compensation');
assert.match(independentPlaybackSource, /yinFrame/, 'voice analyzer uses YIN-style fundamental-frequency detection');
assert.match(independentPlaybackSource, /spectralCentroid/, 'voice analyzer measures spectral brightness as well as F0');
assert.match(independentPlaybackSource, /pitchReliable/, 'voice analyzer can reject noisy or unpitched material');
assert.match(independentPlaybackSource, /clipPitchByKey/, 'playback owns a per-recording baseline pitch-normalization layer');
assert.match(independentPlaybackSource, /setNormalizationProfiles/, 'editor/runtime can refresh per-recording normalization without coupling the semantic scheduler');
assert.match(independentPlaybackSource, /capturePreparedAnimalElement/, 'adapter reuses AudioSystem selection/falloff instead of duplicating its private mixing logic');
assert.doesNotMatch(independentPlaybackSource, /ANIMAL_VOICE_POOLS/, 'independent renderer does not duplicate AudioSystem species clip pools');
assert.match(analysisEditorSource, /Analyze & apply normalization/, 'Animals editor exposes one-tap pool frequency analysis');
assert.match(analysisEditorSource, /MAX_AUTO_SHIFT_ST = 6/, 'automatic normalization refuses extreme source-mismatch pitch shifts');
assert.match(analysisEditorSource, /VOICE_CLIPS\[voiceKey\(animal\.id\)\]/, 'analysis editor reuses the existing editor voice pool instead of duplicating clip lists');

const gameSource = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
assert.match(gameSource, /AnimalVocalizations\?\.tickCreature\?\.\(c, dt\)/, 'hostile cadence drives passive chatter');
assert.match(gameSource, /requestThreatGrowl:/, 'combat receives an explicit growl intent');
assert.match(gameSource, /setHeadAdditiveRotation\?\.\(vocalHeadNodDeg\)/, 'utterance nod is applied as a separate neck layer');
assert.doesNotMatch(gameSource, /renderedScaleY = scaleY \* vocalPulseScale/, 'vocalizations must not scale the animal body');
const avatarSource = fs.readFileSync(path.join(root, 'docs/js/png-plane-avatar.js'), 'utf8');
assert.match(avatarSource, /degrees \+ state\.additiveDeg/, 'head rig composes additive animation over the current base neck pose');
assert.match(avatarSource, /setHeadAdditiveRotation/, 'head rig exposes a reusable additive animation API');
const audioSource = fs.readFileSync(path.join(root, 'docs/js/audio-system.js'), 'utf8');
assert.match(audioSource, /addEventListener\?\.\('playing', notifyStarted/, 'legacy AudioSystem still owns its audible-start event and remains usable as fallback');
const barkBody = audioSource.match(/function playCreatureBark\(c\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert.doesNotMatch(barkBody, /AnimalVocalizations|growl/, 'legacy bark renderer stays separate from threat growls');

for (const name of [
  'sfx_dabinggi-hound1.ogg', 'sfx_dabinggi-hound2.ogg', 'sfx_drenkirra1.ogg', 'sfx_drenkirra2.ogg',
  'sfx_gar-wolf1.ogg', 'sfx_gar-wolf2.ogg', 'sfx_grehlr1.ogg', 'sfx_grehlr2.ogg',
  'sfx_nelk1.ogg', "sfx_uumkao'ii1.ogg", "sfx_uumkao'ii2.ogg",
]) assert.ok(fs.existsSync(path.join(root, 'docs/assets/audio/sfx', name)), `missing voice asset: ${name}`);

console.log('animal vocalization tests passed');
