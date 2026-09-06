'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'docs/js/ambient-biome-audio.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

const loaderSource = fs.readFileSync(path.join(ROOT, 'docs/js/input-settings-panel.js'), 'utf8');
assert.match(loaderSource, /'js\/ambient-biome-audio\.js'/, 'input settings bootstrap should load the ambience helper after game initialization');
for (const fileName of ['bgs_nightbugs1.ogg', 'bgs_cloudforest.ogg', 'bgs_cloudforest_night.ogg', 'bgs_river.ogg']) {
  const oggPath = path.join(ROOT, 'docs/assets/audio/sfx/bgs', fileName);
  assert.equal(fs.existsSync(oggPath), true, `${fileName} should exist`);
  const header = fs.readFileSync(oggPath).subarray(0, 4);
  assert.equal(header.toString('ascii'), 'OggS', `${fileName} should be an Ogg file`);
}

class FakeAudio {
  static instances = [];

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
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'GRASS' })));
  grid[5][5] = { type: 'RIVER' };
  grid[5][6] = { type: 'STREAM' };
  return grid;
}

function target(snapshot, id) {
  return snapshot.layers[id]?.targetVolume || 0;
}

const grid = makeGrid();
const state = {
  area: 'map_southern_cloud_forest',
  night: false,
  raining: false,
};
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
};
const player = { x: 5.5 * 64, y: 5.5 * 64 };
const documentListeners = new Map();
let intervalCallback = null;
let gridResolveCount = 0;
let nowMs = 1000;

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
};
context.window.window = context.window;
context.window.document = context.document;
context.window.performance = context.performance;
context.window.setInterval = context.setInterval;
context.window.clearInterval = context.clearInterval;
context.globalThis = context;

vm.runInNewContext(source, context, { filename: SOURCE_PATH });
const api = context.window.HobunjiAmbientBgs;
assert.ok(api?.installed, 'ambient helper should install');
assert.equal(typeof intervalCallback, 'function', 'helper should use one low-frequency timer');
assert.equal(FakeAudio.instances.length, 2, 'initial load should fetch only the active cloud-forest and river Ogg files');

let snapshot = api.debugSnapshot();
assert.equal(target(snapshot, 'cloudforest'), 0.30, 'cloud forest day ambience should replace generic birds');
assert.equal(target(snapshot, 'cloudforestNight'), 0, 'night forest ambience should remain silent during day');
assert.equal(target(snapshot, 'nightbugs'), 0, 'generic nightbugs should not double the cloud-forest bed');
assert.ok(target(snapshot, 'river') > 0.4, 'river should be loud directly beside water in the cloud forest');
assert.equal(config.bgs.birdsVolume, 0, 'built-in generic birds should be suppressed in the cloud forest');
assert.equal(config.bgs.nightbugsVolume, 0, 'built-in old nightbugs should always be handed off to the converted Ogg');

state.night = true;
api.updateNow();
snapshot = api.debugSnapshot();
assert.equal(target(snapshot, 'cloudforest'), 0, 'day forest ambience should fade out at night');
assert.equal(target(snapshot, 'cloudforestNight'), 0.36, 'night forest ambience should use its authored volume');
assert.equal(target(snapshot, 'nightbugs'), 0, 'generic bugs should remain suppressed in the cloud forest at night');
assert.equal(FakeAudio.instances.length, 3, 'night transition should lazily fetch the cloud-forest-night Ogg file once');

state.area = 'map_western_slope';
api.updateNow();
snapshot = api.debugSnapshot();
assert.equal(target(snapshot, 'nightbugs'), 0.34, 'generic converted nightbugs should play in other exterior zones at night');
assert.equal(target(snapshot, 'cloudforestNight'), 0, 'cloud-forest ambience must not leak to another zone');
assert.equal(target(snapshot, 'river'), 0, 'river ambience must be restricted to the requested maps');
assert.equal(config.bgs.birdsVolume, 0.25, 'generic bird volume should be restored immediately outside the cloud forest');
assert.equal(FakeAudio.instances.length, 4, 'the generic nightbugs Ogg file should load only when first needed');

state.area = 'town';
state.night = false;
player.x = 5.5 * 64;
player.y = 5.5 * 64;
api.updateNow();
const scansAtTownEntry = api.debugSnapshot().riverScanCount;
const resolvesAtTownEntry = gridResolveCount;
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
