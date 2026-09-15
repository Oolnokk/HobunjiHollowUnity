'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const audioSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'audio-system.js'), 'utf8');
const played = []; // Used below to prove hard and Western Slope snow routing select the authored recorded-footstep files.
const createdAudio = []; // Used below to prove repeated footsteps reuse startup-preloaded voices instead of constructing disposable Audio elements.
const logs = []; // Used below to prove the mobile-readable surface-change diagnostic is emitted without a browser console.

class FakeAudio {
  constructor(url = '') {
    this.url = url;
    this.src = url;
    this.dataset = {};
    this.readyState = 4;
    this.networkState = 1;
    this.paused = true;
    this.ended = false;
    this.volume = 1;
    this.playbackRate = 1;
    this.currentTime = 0;
    createdAudio.push(this);
  }
  load() {}
  play() {
    this.paused = false;
    if (this.url || this.src) played.push(this.url || this.src);
    return Promise.resolve();
  }
  pause() { this.paused = true; }
  cloneNode() { return new FakeAudio(this.url || this.src); }
  addEventListener() {}
}

const TileType = Object.freeze({
  GRASS: 'grass',
  WEEDS: 'weeds',
  PATH: 'path',
  RIVER: 'river',
  STREAM: 'stream',
  WATERFALL: 'waterfall',
  PADDY: 'paddy',
  RAMP: 'ramp',
  TILLED: 'tilled',
  RAISED: 'raised',
  TRENCH: 'trench',
  ROCK: 'rock',
  SHRUB: 'shrub',
  CLIFF: 'cliff',
});

const deterministicMath = Object.create(Math); // Forces repeated recorded footsteps to choose the first URL so pool reuse is directly testable.
deterministicMath.random = () => 0;

const context = {
  Audio: FakeAudio,
  document: { addEventListener() {} },
  performance: { now: () => 1234 },
  setTimeout,
  clearTimeout,
  console,
  Math: deterministicMath,
  window: {
    SCRATCHBONES_CONFIG: {
      game: {
        audio: {
          enabled: true,
          sfxVolume: 1,
          footsteps: {
            enabled: true,
            volume: 1,
            surfaces: {
              grass: { urls: ['grass.mp3'] },
              gravel: { urls: ['gravel.mp3'] },
              water: { urls: ['water.mp3'] },
            },
          },
          objectSfx: {},
          combatSfx: {},
        },
      },
    },
    __farmLog: message => logs.push(message),
  },
};
context.window.window = context.window;
vm.runInNewContext(audioSource, context, { filename: 'audio-system.js' });

context.window.AudioSystem.init({
  TILE: 32,
  MAX_WATER: 8,
  TileType,
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  _isBuildingArea: area => String(area).startsWith('building:'),
  npcGridForArea: () => null,
  getCurrentArea: () => 'map_hobunji_town',
  player: { x: 0, y: 0 },
  audioUrlFailed: () => false,
  isRealMediaError: () => false,
  markAudioUrlFailed: () => {},
});

const audio = context.window.AudioSystem;
assert.strictEqual(audio.footstepSurfaceKey('map_hobunji_town', TileType.PATH), 'hard', 'roads should use hardstep');
assert.strictEqual(audio.footstepSurfaceKey('map_i_den_map_northern_cliffs_1', TileType.GRASS), 'hard', 'dens should use hardstep');
assert.strictEqual(audio.footstepSurfaceKey('map_i_town_mine_f_005', TileType.GRASS), 'hard', 'mine floors should use hardstep');
assert.strictEqual(audio.footstepSurfaceKey('map_i_town_mine_safe', TileType.GRASS), 'hard', 'mine safe room should use hardstep');
assert.strictEqual(audio.footstepSurfaceKey('building:general_store', TileType.GRASS), 'hard', 'building interiors should use hardstep');
assert.strictEqual(audio.footstepSurfaceKey('interior', TileType.GRASS), 'hard', 'generic interior areas should use hardstep');
assert.strictEqual(audio.footstepSurfaceKey('map_hobunji_town', TileType.GRASS), 'grass', 'ordinary grass should remain grassstep');
assert.strictEqual(audio.footstepSurfaceKey('map_hobunji_town', TileType.RIVER), 'water', 'water should remain waterstep');

const westernSlopeSnowTypes = [ // Mirrors EnvironmentSurfaceMicroPlateau LAND_TYPES; every entry should sound like the snow cap actually rendered above it.
  TileType.GRASS, TileType.WEEDS, TileType.PATH, TileType.TILLED, TileType.TRENCH,
  TileType.RAISED, TileType.PADDY, TileType.ROCK, TileType.SHRUB, TileType.CLIFF, TileType.RAMP,
];
for (const type of westernSlopeSnowTypes) {
  assert.strictEqual(audio.footstepSurfaceKey('map_western_slope', type), 'snow', `Western Slope ${type} should use snowstep`);
}
assert.strictEqual(audio.footstepSurfaceKey('map_western_slope', TileType.RIVER), 'water', 'Western Slope river should remain waterstep');
assert.strictEqual(audio.footstepSurfaceKey('map_western_slope', TileType.STREAM), 'water', 'Western Slope stream should remain waterstep');
assert.strictEqual(audio.footstepSurfaceKey('map_western_slope', TileType.WATERFALL), 'water', 'Western Slope waterfall should remain waterstep');
assert.strictEqual(audio.footstepSurfaceKey('map_i_den_map_western_slope_1', TileType.GRASS), 'hard', 'Western Slope den interiors should remain hardstep');

assert.match(audioSource, /HARD_FOOTSTEP_TARGET_DBFS\s*=\s*-6\b/, 'hardstep source should declare the requested -6 dBFS normalization target');
assert.match(audioSource, /hardFootstepNormalizationGainByUrl/, 'hardstep source should cache per-file normalization gains');
assert.match(audioSource, /SNOW_FOOTSTEP_URLS/, 'snowstep source should own and preload the authored Western Slope recordings');
assert.match(audioSource, /footstepAudioPools/, 'recorded footsteps should have a reusable media pool');
assert.match(audioSource, /installFootstepAudioUnlock/, 'recorded footsteps should prime their persistent voices from real user gestures');
assert.match(audioSource, /playbackFailures/, 'mobile diagnostics should expose native media playback failures instead of swallowing them');

const createdAfterInit = createdAudio.length;
played.length = 0;
audio.playFootstepSfx('map_hobunji_town', { type: TileType.PATH, water: 0 });
audio.playFootstepSfx('map_hobunji_town', { type: TileType.PATH, water: 0 });
assert.strictEqual(played.length, 2, 'two dry road steps should each issue one primary recorded-footstep playback');
assert.match(played[0], /^assets\/audio\/sfx\/footsteps\/hardstep_1\.mp3$/, 'deterministic road step should use the first authored hardstep');
assert.strictEqual(played[1], played[0], 'deterministic repeated step should request the same hardstep recording');
assert.strictEqual(createdAudio.length, createdAfterInit, 'repeated footsteps should reuse the preloaded pool instead of allocating new Audio elements');
let debug = audio.footstepSfxDebugSnapshot();
assert.strictEqual(debug.surfaceKey, 'hard', 'debug snapshot should expose the resolved hard surface');
assert.strictEqual(debug.url, played[1], 'debug snapshot should expose the selected hardstep file');
assert.ok(debug.playbackRequests >= 2, 'debug snapshot should count actual media playback requests');
assert.ok(debug.poolUrlCount >= 12, 'startup should preload snow/hard plus configured grass/gravel/water recording pools');
assert.ok(logs.some(line => line.includes('surface=hard')), 'hard surface changes should be visible in the in-game debug log');

played.length = 0;
audio.playFootstepSfx('map_western_slope', { type: TileType.GRASS, water: 8 });
assert.strictEqual(played.length, 1, 'a snow-covered Western Slope tile should play only its snow contact surface, not a water moisture layer');
assert.match(played[0], /^assets\/audio\/sfx\/footsteps\/sfx_snowstep_1\.mp3$/, 'deterministic Western Slope step should use the first authored snowstep');
assert.strictEqual(createdAudio.length, createdAfterInit, 'snow footsteps should reuse their startup-preloaded pool');
debug = audio.footstepSfxDebugSnapshot();
assert.strictEqual(debug.surfaceKey, 'snow', 'debug snapshot should expose the resolved snow surface');
assert.strictEqual(debug.url, played[0], 'debug snapshot should expose the selected snowstep file');
assert.ok(logs.some(line => line.includes('surface=snow')), 'snow surface changes should be visible in the in-game debug log');

const strideState = {}; // Used to prove the player cadence accumulator still reaches a footfall after enough actual distance.
assert.strictEqual(audio.footstepAdvance(strideState, 20, 50), false, 'partial stride should not fire early');
assert.strictEqual(audio.footstepAdvance(strideState, 31, 50), true, 'crossing the stride distance should fire a footstep');

console.log('Hardstep/snowstep footstep routing/playback regression: PASS');
