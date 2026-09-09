'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-safe-area-runtime.js', 'utf8'); // Runtime under test: rescue hostile + hidden-audio suppression.
let banditEnsureCalls = 0; // Proves ordinary camp seeding never runs in the scripted rescue area.
let encounterCalls = 0; // Proves road-ambush updates never run there either.
let wildlifeCalls = 0; // Proves den/nest spawning never runs there.
let banditMarked = 0; // Proves entering the rescue area is not queued for camp rerolls.
let forgotten = 0; // Proves stale bandit state is explicitly discarded.
let despawned = 0; // Counts hostiles physically removed from the rescue set.
let animalVoiceCalls = 0; // Counts calls that reach the underlying animal voice runtime.

const banditApi = {
  init(deps) { this.deps = deps; },
  ensureCurrentZoneCamps() { banditEnsureCalls++; },
  updateRandomEncounters() { encounterCalls++; },
  updateTentInteraction() {},
  updateCompanionPerception() {},
  markZoneEntered() { banditMarked++; },
  forgetZoneState() { forgotten++; },
};
const wildlifeApi = {
  init(deps) { this.deps = deps; },
  updateHostileSpawning() { wildlifeCalls++; },
  onZoneEntered() { wildlifeCalls++; },
};
const animalVoiceApi = {
  tickCreature() { animalVoiceCalls++; return true; },
  companionDiscovery() { animalVoiceCalls++; return true; },
  threatGrowl() { animalVoiceCalls++; return true; },
  warning() { animalVoiceCalls++; return true; },
};
const audioApi = {
  gameAudioConfig() { return { enabled: true, sfxVolume: 0.72, musicVolume: 0.61 }; },
};

const rescueBandit = { id: 'bandit', areaId: 'map_prologue_rescue', banditCampInstanceId: 'camp1' };
const rescueWolf = { id: 'wolf', areaId: 'map_prologue_rescue' };
const authoredActor = { id: 'authored', areaId: 'map_prologue_rescue', prologueAuthored: true };
const elsewhere = { id: 'elsewhere', areaId: 'map_southern_cloud_forest' };
const hostileObjects = new Set([rescueBandit, rescueWolf, authoredActor, elsewhere]);
const sharedDeps = {
  hostileObjects,
  getCurrentArea: () => 'map_prologue_rescue',
  despawnCreature() { despawned++; },
};

const windowObject = {
  __hobunjiPrologueHiddenSetup: true,
  BanditCamps: banditApi,
  WildlifeSpawn: wildlifeApi,
  AnimalVocalizations: animalVoiceApi,
  AudioSystem: audioApi,
  GridTileAccessors: { getCurrentArea: () => 'map_prologue_rescue' },
  PrologueRescueZoneCompat: { debugSnapshot: () => ({ suppressProceduralPopulation: true }) },
};
const context = { window: windowObject, console };
context.window.window = context.window;
vm.runInNewContext(source, context, { filename: 'prologue-safe-area-runtime.js' });

windowObject.BanditCamps.init(sharedDeps);
windowObject.WildlifeSpawn.init(sharedDeps);
assert.equal(windowObject.PrologueSafeAreaRuntime.isSuppressedArea(), true, 'rescue area must be classified as population-suppressed');

windowObject.BanditCamps.ensureCurrentZoneCamps();
windowObject.BanditCamps.updateRandomEncounters(1);
windowObject.BanditCamps.markZoneEntered('map_prologue_rescue');
windowObject.WildlifeSpawn.updateHostileSpawning(1);
windowObject.WildlifeSpawn.onZoneEntered('map_prologue_rescue');

assert.equal(banditEnsureCalls, 0, 'bandit camp seeding must never run in rescue');
assert.equal(encounterCalls, 0, 'bandit road encounters must never run in rescue');
assert.equal(banditMarked, 0, 'rescue entry must never queue bandit rerolls');
assert.equal(wildlifeCalls, 0, 'wildlife den/nest spawning must never run in rescue');
assert.ok(forgotten > 0, 'stale bandit state must be discarded while rescue is active');
assert.equal(hostileObjects.has(rescueBandit), false, 'already-created rescue bandit must be purged');
assert.equal(hostileObjects.has(rescueWolf), false, 'already-created rescue wildlife must be purged');
assert.equal(hostileObjects.has(authoredActor), true, 'future explicitly authored prologue hostiles/actors are exempt from procedural purge');
assert.equal(hostileObjects.has(elsewhere), true, 'hostiles in unrelated maps must remain untouched');
assert.ok(despawned >= 2, 'purged procedural rescue hostiles must be despawned from rendering too');

const proceduralGarWolf = { id: 'garwolf', areaId: 'map_prologue_rescue', prologueAuthored: false };
const authoredGarWolf = { id: 'authored-garwolf', areaId: 'map_prologue_rescue', prologueAuthored: true };
assert.equal(windowObject.AnimalVocalizations.warning(proceduralGarWolf, 'test'), false, 'procedural rescue animal calls must be suppressed');
assert.equal(windowObject.AnimalVocalizations.warning(authoredGarWolf, 'test'), false, 'even authored rescue animals must stay silent while the loading screen covers setup');
assert.equal(animalVoiceCalls, 0, 'hidden setup must not reach the underlying animal voice renderer');

const hiddenAudio = windowObject.AudioSystem.gameAudioConfig();
assert.equal(hiddenAudio.sfxVolume, 0, 'hidden prologue setup must expose a temporary zero SFX gain');
assert.equal(hiddenAudio.musicVolume, 0.61, 'hidden setup must not mutate unrelated audio settings');

windowObject.__hobunjiPrologueHiddenSetup = false;
assert.equal(windowObject.AnimalVocalizations.warning(proceduralGarWolf, 'test'), false, 'procedural wildlife stays silent even after reveal because it does not belong in the scripted set');
assert.equal(windowObject.AnimalVocalizations.warning(authoredGarWolf, 'test'), true, 'future authored rescue animals may vocalize after reveal');
assert.equal(animalVoiceCalls, 1, 'only the revealed authored animal call reaches the underlying voice runtime');
assert.equal(windowObject.AudioSystem.gameAudioConfig().sfxVolume, 0.72, 'real user SFX gain restores immediately after hidden setup ends');

const debug = windowObject.PrologueSafeAreaRuntime.debugSnapshot();
assert.ok(debug.animalVoiceCallsBlocked >= 3, 'debug snapshot counts hidden/procedural animal calls blocked');
assert.ok(debug.hiddenAudioQueries >= 1, 'debug snapshot counts muted hidden audio config reads');

console.log('prologue scripted-area population + hidden-audio suppression regression passed');
