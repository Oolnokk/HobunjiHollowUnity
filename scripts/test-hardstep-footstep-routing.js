'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const audioSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'audio-system.js'), 'utf8');
const played = []; // Used below to prove PATH/den/mine routing selects one of the authored hardstep files.
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
});

const context = {
  Audio: FakeAudio,
  document: { addEventListener() {} },
  performance: { now: () => 1234 },
  setTimeout,
  clearTimeout,
  console,
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
assert.strictEqual(audio.footstepSurfaceKey('building:general_store', TileType.PATH), 'gravel', 'ordinary building interiors should remain gravel');
assert.strictEqual(audio.footstepSurfaceKey('map_hobunji_town', TileType.GRASS), 'grass', 'ordinary grass should remain grassstep');
assert.strictEqual(audio.footstepSurfaceKey('map_hobunji_town', TileType.RIVER), 'water', 'water should remain waterstep');

played.length = 0;
audio.playFootstepSfx('map_hobunji_town', { type: TileType.PATH, water: 0 });
assert.strictEqual(played.length, 1, 'a dry road step should play exactly one primary surface clip');
assert.match(played[0], /^assets\/audio\/sfx\/footsteps\/hardstep_[123]\.mp3$/, 'road step should pick from the authored hardstep pool');
const debug = audio.footstepSfxDebugSnapshot();
assert.strictEqual(debug.surfaceKey, 'hard', 'debug snapshot should expose the resolved hard surface');
assert.strictEqual(debug.url, played[0], 'debug snapshot should expose the selected hardstep file');
assert.ok(logs.some(line => line.includes('surface=hard')), 'surface changes should be visible in the in-game debug log');

console.log('Hardstep footstep routing regression: PASS');
