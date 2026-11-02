'use strict';

const assert = require('node:assert/strict'); // Checks the real scheduler, audio gate, and independent playback adapter together.
const fs = require('node:fs'); // Reads shipped modules and authored voice data.
const path = require('node:path'); // Resolves repository files for this regression.
const vm = require('node:vm'); // Runs browser modules with deterministic audio/time substitutes.
const root = path.resolve(__dirname, '..'); // Repository root for fixture reads.
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Loads the same code/data used by the game.
const config = JSON.parse(read('docs/config/dialogue/ambient-dialogue.json')); // Existing authored Puktuk calls are the regression fixture.
const played = []; // Records actual native starts, including the independent renderer's fallback.
let now = 0; // Advances past the normal area-entry audio grace period.
class FakeAudio {
  constructor(src) { this.src = src; this.dataset = {}; this.listeners = {}; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  load() {}
  pause() { this.paused = true; }
  cloneNode() { return new FakeAudio(this.src); }
  play() {
    this.paused = false;
    played.push(this.src);
    this.listeners.playing?.();
    return Promise.resolve();
  }
}
const window = {
  HTMLMediaElement: FakeAudio,
  CreatureTextureCache: { create: () => ({}) }, // FarmAnimals creates its texture-residency cache at module load; this test exercises only its audio/frame loop.
}; // Lets the real adapter intercept native preparation before starting its chosen recording.
const context = vm.createContext({ window, Audio: FakeAudio, Math, Date: { now: () => now }, performance: { now: () => now } }); // No WebAudio context forces the supported native fallback.
for (const file of ['audio-system.js', 'animal-vocalizations.js', 'animal-voice-independent-playback.js', 'farm-animals.js']) {
  vm.runInContext(read(`docs/js/${file}`), context, { filename: file });
}
window.AudioSystem.init({ TILE: 64, player: { x: 0, y: 0 }, getCurrentArea: () => 'farm' });
window.AnimalVocalizations.init({
  random: () => 0,
  hasVoice: c => window.AudioSystem.hasAnimalVoice(c),
  renderUtterance: (c, opts) => window.AudioSystem.playAnimalVoiceUtterance(c, opts),
});
window.AnimalVocalizations.setAuthoredProfiles(config.animalVocalizations);
const creature = key => ({ creatureKey: key, health: 10, areaId: 'farm', state: 'idle', x: 0, y: 0 }); // Matches live wild/companion entity fields.
assert.equal(window.AudioSystem.hasAnimalVoice(creature('puktuk')), true, 'authored Puktuk is eligible without a legacy species pool');
assert.equal(window.AudioSystem.hasAnimalVoice({ animalKey: 'uumkaoii' }), true, 'farm Uumkao’ii is eligible through its animalKey and legacy voice pool');
assert.equal(window.AudioSystem.hasAnimalVoice({ animalKey: 'drenkirra' }), true, 'farm Drenkirra resolves its authored voice profile through animalKey');
assert.equal(window.AudioSystem.hasAnimalVoice(creature('puktuk-wild-den-mother')), true, 'den mothers resolve their canonical authored profile');
assert.equal(window.AudioSystem.hasAnimalVoice(creature('unsupported')), false, 'unknown animals stay silent');

// Start the ordinary grace period, then use both gameplay scheduling paths.
window.AudioSystem.playAnimalVoiceUtterance(creature('puktuk'), { allowedClips: ['sfx_bark-yap.ogg'] });
now = 5000;
for (const stableRole of [undefined, 'companion']) {
  const c = { ...creature('puktuk'), stableRole }; // Wild and whistled companion cases share the same authored scheduler.
  const start = played.length; // Counts each authored passive utterance after native preparation.
  window.AnimalVocalizations.tickCreature(c, 11, { allowPassive: stableRole !== 'mount' });
  window.AnimalVocalizations.tickCreature(c, 0.4);
  assert.equal(played.length - start, 2, 'both Puktuk chatter beats reach real playback');
  assert.ok(played.slice(start).every(url => url.endsWith('/sfx_bark-yap.ogg')), 'uses the authored Puktuk call');
}
const farmAnimal = { id: 'farm-uumkaoii', livestockId: 'livestock-1', animalKey: 'uumkaoii', wx: 0.5, wz: 0.5, wy: 0.4, avatarRef: { group: { position: { y: 0.4 } } }, tick() {}, update() {} }; // Mirrors the actual FarmAnimals entity shape.
window.FarmAnimals.init({
  TILE: 64,
  animalObjects: [farmAnimal],
  setWorldLivestockFrameCache() {},
  loadWorldLivestock: () => [],
  getCurrentArea: () => 'farm',
});
const farmVoiceStart = played.length;
window.FarmAnimals.updateAnimalMeshes(11);
window.FarmAnimals.updateAnimalMeshes(0.4);
assert.equal(played.length - farmVoiceStart, 2, 'farm livestock produces repeated passive chatter through the shared scheduler and real playback');
assert.equal(farmAnimal._voiceActor.avatarRef, farmAnimal.avatarRef, 'farm vocalization actor carries its live sprite height into spatial audio');
assert.ok(played.slice(farmVoiceStart).every(url => url.includes('/sfx_grunt-rattle.ogg') || url.includes('/sfx_chirp-rattle.ogg')), 'farm Uumkao’ii uses its existing species-specific vocal assets');
assert.equal(window.AnimalVocalizations.releaseCreature(farmAnimal._voiceActor), true, 'despawn releases the farm actor from the vocalization scheduler');
assert.equal(window.AnimalVocalizations.releaseCreature(farmAnimal._voiceActor), false, 'releasing an already-despawned actor is harmless');
assert.equal((read('docs/js/farm-animals.js').match(/releaseCreature\?\./g) || []).length, 2, 'both farm livestock constructors release their scheduler actors on reset');

const start = played.length; // Silence/range/combat/mount guards must still suppress playback.
assert.equal(window.AudioSystem.playAnimalVoiceUtterance(creature('puktuk'), { allowedClips: [] }), false);
assert.equal(window.AudioSystem.playAnimalVoiceUtterance({ ...creature('puktuk'), x: 10000 }, { allowedClips: ['sfx_bark-yap.ogg'] }), false);
assert.equal(window.AudioSystem.playAnimalVoiceUtterance({ ...creature('puktuk'), areaId: 'elsewhere' }, { allowedClips: ['sfx_bark-yap.ogg'] }), false);
window.AnimalVocalizations.tickCreature({ ...creature('puktuk'), state: 'chase' }, 20);
window.AnimalVocalizations.tickCreature(creature('puktuk'), 20, { allowPassive: false });
assert.equal(played.length, start, 'existing suppression rules are preserved');
window.SCRATCHBONES_CONFIG = { game: { audio: { enabled: false } } };
assert.equal(window.AudioSystem.playAnimalVoiceUtterance(creature('puktuk'), { allowedClips: ['sfx_bark-yap.ogg'] }), false, 'audio disable still applies');
window.SCRATCHBONES_CONFIG.game.audio.enabled = true;
window.AnimalVocalizations.setAuthoredProfiles({});
assert.equal(window.AudioSystem.hasAnimalVoice(creature('gar-wolf')), true, 'legacy voice eligibility survives missing authored data');
assert.equal(window.AudioSystem.playAnimalVoiceUtterance(creature('gar-wolf')), true, 'legacy recordings still prepare and play');
assert.equal(window.AudioSystem.hasAnimalVoice(creature('puktuk')), false, 'profile replacement invalidates previous authored eligibility');
console.log('Authored animal voice routing checks passed.');
