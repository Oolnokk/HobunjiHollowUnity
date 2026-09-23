const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/banubu-snore.js', 'utf8'); // Runtime under test.
const audioSource = fs.readFileSync('docs/js/audio-system.js', 'utf8'); // Structural guard for the elevation-aware renderer seam.
const playbackSource = fs.readFileSync('docs/js/animal-voice-independent-playback.js', 'utf8'); // Structural guard for one-ninth tempo support and adapter forwarding.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Confirms the runtime actually ships in the game.
const pixelProbeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Confirms mobile diagnostics ship with the feature.

let now = 1000; // Simulated performance clock used to verify measured snore duration and the following pause.
let phase = 'night'; // Simulated shared fishing time-of-day used by the night-only gate.
let scheduled = null; // Captures the one shared RuntimeFrameScheduler callback registered by the runtime.
const calls = []; // Captures animal voice requests so origin/tuning/distance can be asserted without real audio.
const logs = []; // Captures status changes to ensure diagnostics do not require a browser console.

const TILE = 64; // Matches a normal game tile in the mocked runtime.
const CHUNK_TILES = 16; // Matches WildernessChunks' canonical chunk size.
const entrance = { // Authoritative live transition intentionally far from the locale anchor below.
  id: 'sp_locale_locale_banubu_shrine',
  col: 20,
  row: 21,
  targetMapId: 'map_i_den_banubu',
  generatedLocaleId: 'locale_banubu_shrine',
};
const layout = {
  transitions: [entrance],
  localeInstances: [{ localeId: 'locale_banubu_shrine', x: 80, y: 80 }],
};
const player = {
  x: (24.5) * TILE,
  y: (22.5) * TILE,
};
const playerMesh = { position: { y: 9 } }; // Live feet elevation used to make vertical separation audible.
const grid = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => ({ surfaceY: 0 })));
grid[entrance.row][entrance.col] = { surfaceY: 6 };

const windowObject = {
  Combat: {
    deps: {
      TILE,
      player,
      zoneLayouts: new Map([['map_northern_cliffs', layout]]),
      getCurrentArea: () => 'map_northern_cliffs',
      getActiveGrid: () => grid,
      tileSurfaceYInArea: tile => Number(tile?.surfaceY) || 0,
    },
  },
  WildernessChunks: { constants: { CHUNK_TILES } },
  PlayerBodyTransformComposer: { getPlayerMesh: () => playerMesh },
  Fishing: { timeOfDay: () => phase },
  AnimalVocalizations: {
    profileForDebug: () => ({
      chatter: {
        volume: 0.31,
        utterances: [{ tempo: 0.6, pitchSemitones: -9 }],
        allowedClips: ['sfx_grunt-rattle.ogg'],
      },
      clipTuning: {},
      sizePitchSemitones: { large: 0 },
    }),
  },
  AnimalVoiceIndependentPlayback: { isInstalled: () => true },
  AudioSystem: {
    playAnimalVoiceUtterance(sourceEntity, options) {
      calls.push({ sourceEntity: { ...sourceEntity }, options });
      options.signal?.addEventListener('abort', () => options.onFinished(), { once: true }); // Mimics the independent voice renderer's cancellation callback.
      return true;
    },
  },
  RuntimeFrameScheduler: {
    register(id, callback, options) {
      assert.equal(id, 'banubu-night-snore');
      assert.equal(options.phase, 'post-game');
      scheduled = callback;
      return () => { scheduled = null; };
    },
  },
  __farmLog: message => logs.push(message),
};
windowObject.window = windowObject;

const context = {
  window: windowObject,
  performance: { now: () => now },
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  Map,
  AbortController,
  console,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'banubu-snore.js' });

assert.equal(typeof scheduled, 'function', 'Banubu snore runtime must register with the shared frame scheduler');
scheduled({ timestamp: now });
assert.equal(calls.length, 1, 'nighttime player inside the two-chunk gate should queue a snore');

const first = calls[0];
assert.equal(first.sourceEntity.creatureKey, 'grehlr', 'snore must reuse Grehlr voice identity');
assert.equal(first.sourceEntity.x, (entrance.col + 0.5) * TILE, 'sound X must originate at the live entrance transition, not locale anchor');
assert.equal(first.sourceEntity.y, (entrance.row + 0.5) * TILE, 'sound Y must originate at the live entrance transition, not locale anchor');
assert.notEqual(first.sourceEntity.x, (layout.localeInstances[0].x + 0.5) * TILE, 'locale anchor must never be used as the snore origin');
assert.equal(first.options.tempo, 1 / 9, 'Banubu snore must request three times the previous one-third-tempo duration');
assert.deepEqual(first.options.allowedClips, ['sfx_grunt-rattle.ogg'], 'snore must use the authored Grehlr passive chatter clip');
assert.equal(first.options.pitchSemitones, -9, 'snore must retain the authored Grehlr passive chatter pitch');
assert.equal(first.options.meaning, 'chatter', 'snore remains ambient chatter for the shared voice concurrency policy');

const horizontalPx = Math.hypot(first.sourceEntity.x - player.x, first.sourceEntity.y - player.y);
assert(first.options.acousticDistancePx > horizontalPx, 'elevation must increase acoustic distance beyond flat tile distance');
assert.equal(first.options.earshotTiles, CHUNK_TILES * 5, 'smooth attenuation range is independent from the stricter two-chunk activation gate');

first.options.onStarted();
now = 11500;
first.options.onFinished();
const completed = windowObject.BanubuSnore.debugSnapshot();
assert.equal(completed.originSource, 'entrance transition', 'mobile diagnostics must identify the authoritative entrance origin');
assert.equal(completed.chunkDistance, 0, 'mock player and entrance begin in the same chunk');
assert.equal(Math.round(completed.lastDurationMs), 10500, 'diagnostics measure the actual rendered slowed-call duration');
assert.equal(completed.phase, 'short next', 'the second breath follows the long call immediately');
assert.equal(completed.lastPauseMs, null, 'there is no pause between the long and short snores');

now = 11501;
scheduled({ timestamp: now });
assert.equal(calls.length, 2, 'the short snore begins immediately after the long one');
assert.equal(calls[1].options.tempo, 1, 'the second snore uses the original utterance duration');
assert.equal(calls[1].options.pitchSemitones, -7, 'the short snore is two semitones higher');
calls[1].options.onStarted();
now = 13501;
calls[1].options.onFinished();
assert.equal(windowObject.BanubuSnore.debugSnapshot().lastPauseMs, 12500, 'silence equals the sum of both audible durations');
now = 26000;
scheduled({ timestamp: now });
assert.equal(calls.length, 2, 'the next pair cannot begin before the full silence');
now = 26001;
scheduled({ timestamp: now });
assert.equal(calls.length, 3, 'the next pair begins with a long snore after the summed pause');
assert.equal(calls[2].options.tempo, 1 / 9);

calls[2].options.onStarted();
phase = 'day';
now = 26100;
calls[2].options.onFinished();
now = 26200;
scheduled({ timestamp: now });
assert.equal(calls.length, 3, 'daytime must suppress Banubu snoring outdoors');

let talking = false; // Simulates Banubu dialogue while the player is indoors.
windowObject.Combat.deps.isDialogueOpen = () => talking;
windowObject.Combat.deps.getCurrentArea = () => 'map_i_den_banubu';
player.x = 6.5 * TILE;
player.y = 6.5 * TILE;
now = 26450;
scheduled({ timestamp: now });
assert.equal(calls.length, 4, 'Banubu should snore indoors even during daytime');
assert.equal(calls[3].sourceEntity.x, 6.5 * TILE, 'indoor snoring comes from his sleeping station');
assert.equal(calls[3].sourceEntity.y, 5.5 * TILE, 'indoor snoring comes from his sleeping station');
assert.equal(calls[3].options.earshotTiles, 16, 'indoor snoring uses a room-scale earshot');
assert.equal(calls[3].options.tempo, 1, 'the short follow-up resumes indoors when daylight interrupted it outdoors');
talking = true;
now = 26550;
scheduled({ timestamp: now });
assert(calls[3].options.signal.aborted, 'starting dialogue must cancel a snore already in progress');
calls[3].options.onFinished(); // A stale audio completion must not turn the cancelled short snore into a pause.
assert.match(windowObject.BanubuSnore.debugSnapshot().status, /paused for dialogue/);
windowObject.Combat.deps.getCurrentArea = () => 'map_northern_cliffs';
talking = false;

phase = 'night';
player.x = (64.5) * TILE; // Entrance chunk=1, player chunk=4 -> three chunks away.
now = 26850;
scheduled({ timestamp: now });
assert.equal(calls.length, 4, 'player more than two chunks away must not hear a new snore');
assert.match(windowObject.BanubuSnore.debugSnapshot().status, /outside two-chunk range/, 'debug state must explain the chunk-range suppression');

assert(audioSource.includes('function animalVoiceAcousticDistancePx(c, opts = {})'), 'AudioSystem must accept an acoustic-distance override');
assert(audioSource.includes('const distance = animalVoiceAcousticDistancePx(c, opts);'), 'animal voice volume falloff must consume acoustic distance');
assert(playbackSource.includes('const MIN_TEMPO = 1 / 9;'), 'independent animal playback must permit exact one-ninth tempo');
assert(playbackSource.includes('0.25, 9);'), 'WSOLA must retain the full tripled duration after pitch compensation');
assert(playbackSource.includes('creatureAudioSpatial?.(c, opts)'), 'processed animal playback must forward acoustic distance to spatial reverb');
assert(playbackSource.includes('let completed = false;'), 'animal voice adapter must guard terminal callbacks so renderer cleanup cannot double-complete a snore');
assert(playbackSource.includes('onError: error => complete(error)'), 'animal voice adapter must route playback errors through the single completion bridge');
assert(playbackSource.includes('onFinished: () => complete()'), 'animal voice adapter must forward successful processed playback completion to the caller');
assert(!playbackSource.includes('onFinished: release'), 'animal voice adapter must not swallow the caller onFinished callback');
assert(indexSource.includes('js/banubu-snore.js?v=20260923snorepair1'), 'game index must load the Banubu snore runtime');
assert(pixelProbeSource.includes('Banubu snore:'), 'Pixel Probe must expose Banubu snore diagnostics on mobile');
assert(logs.length > 0, 'runtime status changes should also reach the existing in-game audio log');

console.log('Banubu night snore regression checks passed.');
