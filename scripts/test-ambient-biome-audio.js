'use strict';

const assert = require('node:assert/strict'); // Supplies deterministic regression assertions for the standalone runtime helper.
const fs = require('node:fs'); // Reads the shipped helper source without requiring a browser bundle.
const path = require('node:path'); // Resolves the repository-relative helper path on every platform.
const vm = require('node:vm'); // Executes the browser IIFE against a small fake runtime.

const ROOT = path.resolve(__dirname, '..'); // Anchors test paths to the patch/repository root.
const SOURCE_PATH = path.join(ROOT, 'docs/js/ambient-biome-audio.js'); // Points at the runtime helper under test.
const source = fs.readFileSync(SOURCE_PATH, 'utf8'); // Loads the exact source that ships to the browser.

const loaderSource = fs.readFileSync(path.join(ROOT, 'docs/js/input-settings-panel.js'), 'utf8'); // Reads the existing runtime-helper bootstrap integration point.
assert.match(loaderSource, /'js\/ambient-biome-audio\.js'/, 'input settings bootstrap should load the ambience helper after game initialization');
for (const fileName of ['bgs_nightbugs1.wav', 'bgs_cloudforest.wav', 'bgs_cloudforest_night.wav', 'bgs_river.wav']) {
  const wavPath = path.join(ROOT, 'docs/assets/audio/sfx/bgs', fileName); // Points at each converted repository asset expected by AUDIO_URLS.
  const header = fs.readFileSync(wavPath).subarray(0, 12); // Validates the RIFF/WAVE signature without loading the full recordings into memory.
  assert.equal(header.subarray(0, 4).toString('ascii'), 'RIFF', `${fileName} should be a RIFF file`);
  assert.equal(header.subarray(8, 12).toString('ascii'), 'WAVE', `${fileName} should be a WAVE file`);
}

class FakeAudio {
  static instances = []; // Retains created media elements so tests can inspect persistent-loop behavior.

  constructor(url) {
    this.src = url;
    this.url = url;
    this.loop = false;
    this.preload = '';
    this.volume = 0;
    this.paused = true;
    this.readyState = 4;
    this.currentTime = 0;
    this.listeners = new Map();
    FakeAudio.instances.push(this);
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  load() {}

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

function makeGrid(size = 16) {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'GRASS' }))); // Builds a compact mutable terrain grid for proximity tests.
  grid[5][5] = { type: 'RIVER' };
  grid[5][6] = { type: 'STREAM' };
  return grid;
}

function target(snapshot, id) {
  return snapshot.layers[id]?.targetVolume || 0; // Reads one layer's requested mix rather than its in-progress fade volume.
}

const grid = makeGrid(); // Represents the loaded wilderness/town terrain for every test area.
const state = {
  area: 'map_southern_cloud_forest',
  night: false,
  raining: false,
}; // Drives map/time/weather transitions without recreating the helper.
const config = {
  enabled: true,
  bgsFadeMs: 0,
  bgs: {
    birdsVolume: 0.25,
    nightbugsVolume: 0.34,
    cloudforestVolume: 0.30,
    cloudforestNightVolume: 0.36,
    riverVolume: 0.42,
    riverRangeTiles: 9,
    riverFullVolumeRadiusTiles: 1.5,
  },
}; // Mirrors the live AudioSystem config object that both mixers mutate/read.
const player = { x: 5.5 * 64, y: 5.5 * 64 }; // Starts the player directly on a river tile.
const documentListeners = new Map(); // Tracks installed unlock handlers so disposal can be verified.
let intervalCallback = null; // Captures the low-frequency timer callback without starting a real Node timer.
let gridResolveCount = 0; // Proves the area grid is not repeatedly resolved while the player remains in one tile.
let nowMs = 1000; // Advances fade timestamps deterministically between manual updates.

const context = {
  Audio: FakeAudio,
  console,
  Date,
  Math,
  Promise,
  performance: { now: () => (nowMs += 250) },
  setInterval(callback) {
    intervalCallback = callback;
    return 17;
  },
  clearInterval(id) {
    assert.equal(id, 17);
  },
  document: {
    baseURI: 'https://example.test/',
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (documentListeners.get(type) === handler) documentListeners.delete(type);
    },
  },
  window: {
    __farmLog() {},
    Music: { isNightTime: () => state.night },
    AudioSystem: { gameAudioConfig: () => config },
    Combat: {
      deps: {
        TILE: 64,
        player,
        calendar: { get isRaining() { return state.raining; } },
        TileType: { RIVER: 'RIVER', STREAM: 'STREAM', WATERFALL: 'WATERFALL' },
        WATERWAY_TYPES: new Set(['RIVER', 'STREAM', 'WATERFALL']),
        getCurrentArea: () => state.area,
        _isZoneArea: area => area.startsWith('map_'),
        npcGridForArea() {
          gridResolveCount++;
          return grid;
        },
      },
    },
  },
}; // Supplies only the browser/game APIs consumed by the helper.
context.window.window = context.window;
context.window.document = context.document;
context.window.performance = context.performance;
context.window.setInterval = context.setInterval;
context.window.clearInterval = context.clearInterval;
context.globalThis = context;

vm.runInNewContext(source, context, { filename: SOURCE_PATH });
const api = context.window.HobunjiAmbientBgs; // Exposes manual updates and diagnostics exactly as mobile runtime does.
assert.ok(api?.installed, 'ambient helper should install');
assert.equal(typeof intervalCallback, 'function', 'helper should use one low-frequency timer');
assert.equal(FakeAudio.instances.length, 2, 'initial load should fetch only the active cloud-forest and river WAVs');

let snapshot = api.debugSnapshot(); // Captures the initial southern-cloud-forest daytime mix.
assert.equal(target(snapshot, 'cloudforest'), 0.30, 'cloud forest day ambience should replace generic birds');
assert.equal(target(snapshot, 'cloudforestNight'), 0, 'night forest ambience should remain silent during day');
assert.equal(target(snapshot, 'nightbugs'), 0, 'generic nightbugs should not double the cloud-forest bed');
assert.ok(target(snapshot, 'river') > 0.4, 'river should be loud directly beside water in the cloud forest');
assert.equal(config.bgs.birdsVolume, 0, 'built-in generic birds should be suppressed in the cloud forest');
assert.equal(config.bgs.nightbugsVolume, 0, 'built-in old nightbugs should always be handed off to the converted WAV');

state.night = true;
api.updateNow();
snapshot = api.debugSnapshot();
assert.equal(target(snapshot, 'cloudforest'), 0, 'day forest ambience should fade out at night');
assert.equal(target(snapshot, 'cloudforestNight'), 0.36, 'night forest ambience should use its authored volume');
assert.equal(target(snapshot, 'nightbugs'), 0, 'generic bugs should remain suppressed in the cloud forest at night');
assert.equal(FakeAudio.instances.length, 3, 'night transition should lazily fetch the cloud-forest-night WAV once');

state.area = 'map_western_slope';
api.updateNow();
snapshot = api.debugSnapshot();
assert.equal(target(snapshot, 'nightbugs'), 0.34, 'generic converted nightbugs should play in other exterior zones at night');
assert.equal(target(snapshot, 'cloudforestNight'), 0, 'cloud-forest ambience must not leak to another zone');
assert.equal(target(snapshot, 'river'), 0, 'river ambience must be restricted to the requested maps');
assert.equal(config.bgs.birdsVolume, 0.25, 'generic bird volume should be restored immediately outside the cloud forest');
assert.equal(FakeAudio.instances.length, 4, 'the generic nightbugs WAV should load only when first needed');

state.area = 'town';
state.night = false;
player.x = 5.5 * 64;
player.y = 5.5 * 64;
api.updateNow();
const scansAtTownEntry = api.debugSnapshot().riverScanCount; // Establishes the scan count after entering an allowed map/tile.
const resolvesAtTownEntry = gridResolveCount; // Establishes how often the area-grid resolver ran on entry.
api.updateNow();
player.x = 5.9 * 64;
player.y = 5.1 * 64;
api.updateNow();
assert.equal(api.debugSnapshot().riverScanCount, scansAtTownEntry, 'river grid scan should stay cached within one tile');
assert.equal(gridResolveCount, resolvesAtTownEntry, 'area grid should stay cached within one tile');
player.x = 6.1 * 64;
api.updateNow();
assert.equal(api.debugSnapshot().riverScanCount, scansAtTownEntry + 1, 'crossing a tile boundary should refresh the local water cache once');
assert.equal(gridResolveCount, resolvesAtTownEntry + 1, 'crossing a tile boundary should resolve the current grid once');

state.raining = true;
state.night = true;
api.updateNow();
snapshot = api.debugSnapshot();
assert.equal(target(snapshot, 'nightbugs'), 0, 'rain should suppress wildlife ambience like the existing BGS mixer');
assert.ok(target(snapshot, 'river') > 0, 'river proximity ambience should remain audible during rain');

api.dispose();
assert.equal(config.bgs.birdsVolume, 0.25, 'dispose should restore the original bird volume');
assert.equal(config.bgs.nightbugsVolume, 0.34, 'dispose should restore the original nightbugs volume');
assert.equal(documentListeners.size, 0, 'dispose should remove all gesture-unlock listeners');

console.log('ambient-biome-audio regression checks passed');
