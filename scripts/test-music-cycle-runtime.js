'use strict';

const assert = require('node:assert/strict'); // Checks public playback behavior without replacing scheduler helpers.
const fs = require('node:fs'); // Reads the shipped module, config, and cue manifests.
const path = require('node:path'); // Resolves fixture URLs relative to the real docs root.
const vm = require('node:vm'); // Runs the entire music module with a controllable browser boundary.

async function run() {
  const docs = path.join(__dirname, '../docs'); // Root used by the real cue-index loader.
  const live = { now: 1000, area: 'map_northern_cliffs', combat: false, media: [], logs: [] }; // Controls browser time, area, and media-event ordering.
  class Media extends EventTarget {
    constructor(url) {
      super();
      Object.assign(this, { src: url, currentTime: 0, duration: 180, paused: true, ended: false, volume: 1, muted: false, readyState: 4 });
      live.media.push(this);
    }
    load() {}
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    complete(dispatch = true) {
      this.currentTime = this.duration;
      this.ended = true;
      this.paused = true;
      if (dispatch) this.dispatchEvent(new Event('ended'));
    }
  }
  const window = { addEventListener() {} }; // Browser namespace receives the production Music API.
  const context = vm.createContext({
    window, Audio: Media, URL, console, location: { href: 'https://example.test/docs/' },
    document: { baseURI: 'https://example.test/docs/', addEventListener() {}, scripts: [], createElement: () => ({}), head: { appendChild() {} } },
    performance: { now: () => live.now },
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    fetch: async url => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(docs, url), 'utf8')) }),
  }); // Only browser I/O is mocked; loading, selection, transport, and transitions run unchanged.
  for (const file of ['config/scratchbones-config.js', 'js/condition-registry.js', 'js/music-system.js']) {
    vm.runInContext(fs.readFileSync(path.join(docs, file), 'utf8'), context, { filename: file });
  }
  const config = window.SCRATCHBONES_CONFIG.game.assets.audio; // Uses actual Northern Cliffs authoring and cue timing.
  window.AudioSystem = { gameAudioConfig: () => ({ ...config, startupBgm: null }) };
  window.Music.init({
    getCurrentArea: () => live.area, getHour: () => 14, getPaused: () => false, getGameStarted: () => true,
    isPlayerInCombat: () => live.combat, _isZoneArea: () => true,
    EXTERIOR_ZONES: { map_northern_cliffs: {}, map_western_slope: {} }, getWorkspaceMaps: () => [],
    calendar: { day: 1, weather: 'clear', isRaining: false }, MORNING_HOUR: 6,
    clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    debugLog: message => live.logs.push(message),
  });
  await window.Music.loadAudioCueIndexes();
  window.Music.resetAmbientCueTimer();
  window.Music.updateAmbientCues();
  const song = live.media.at(-1); // Actual media element allocated by the production transport.
  assert.match(song.src, /bgm_what_the_winds_carry\.mp3$/);
  assert.equal(song.loop, false);
  song.complete(false); // Browser state can report ended before its queued ended event is dispatched.
  window.Music.updateAmbientCues();
  const cue = live.media.at(-1); // The next scheduler frame must enter B even when the event is delayed.
  assert.match(cue.src, /northern_cliffs\/mas\d+\.ogg$/, 'ended-state polling must not restart the Northern Cliffs song');
  assert.equal(song._musicRetired, true, 'polling completion retires the old transport');
  song.dispatchEvent(new Event('ended')); // A later native event must be harmless after polling already completed A.
  assert.equal(live.media.at(-1), cue);
  live.now += 1000;
  cue.complete(false);
  window.Music.updateAmbientCues();
  assert.equal(live.media.at(-1), cue, 'polling a completed cue must retain the authored quiet gap');
  assert.equal(cue._musicRetired, true, 'polling completion retires the cue');
  cue.dispatchEvent(new Event('ended'));
  live.now += 19000;
  window.Music.updateAmbientCues();
  assert.equal(live.media.at(-1), cue, 'the shortest authored inter-cue gap is still twenty seconds');
  live.now += 26001;
  window.Music.updateAmbientCues();
  const secondCue = live.media.at(-1); // A second motif verifies that B remains a series of cues.
  assert.match(secondCue.src, /northern_cliffs\/mas\d+\.ogg$/);
  assert.notEqual(secondCue.src, cue.src);
  live.now += 80000;
  window.Music.updateAmbientCues();
  assert.equal(live.media.at(-1), secondCue, 'a playing final cue finishes after the phase deadline');
  secondCue.complete(false);
  window.Music.updateAmbientCues();
  const nextSong = live.media.at(-1); // Stage C must resume song selection only after the final cue finishes.
  assert.match(nextSong.src, /bgm_what_the_winds_carry\.mp3$/);
  secondCue.dispatchEvent(new Event('ended'));
  window.Music.updateAmbientCues();
  assert.equal(live.media.at(-1), nextSong, 'a stale cue event cannot advance or replace the next song');
  nextSong.complete(); // Also exercise the ordinary event-first completion order.
  window.Music.updateAmbientCues();
  assert.match(live.media.at(-1).src, /northern_cliffs\/mas\d+\.ogg$/);
  live.media.at(-1).complete(); // Exercise event-first cue completion as well as song completion.
  window.Music.updateAmbientCues();
  assert.equal(live.media.filter(media => !media._musicRetired).length, 0, 'the event-first cue enters a silent gap without overlapping or restarting music');
  window.Music.logAudioTickDiagnostics();
  assert.ok(live.logs.some(line => line.includes('cuePool=14')), 'mobile diagnostics report the loaded Northern Cliffs library');
  assert.ok(live.logs.some(line => line.includes('schedulerRevision=ended-handoff-1')), 'mobile diagnostics identify the updated scheduler');
  console.log('music-cycle-runtime: full module, real config/manifests, delayed and immediate ended events passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
