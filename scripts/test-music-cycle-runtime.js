'use strict';

const assert = require('node:assert/strict'); // Checks public playback behavior without replacing scheduler helpers.
const fs = require('node:fs'); // Reads the shipped module, config, and cue manifests.
const path = require('node:path'); // Resolves fixture URLs relative to the real docs root.
const vm = require('node:vm'); // Runs the entire music module with a controllable browser boundary.

async function createRuntime(area = 'map_northern_cliffs') {
  const docs = path.join(__dirname, '../docs'); // Root used by the real cue-index loader.
  const live = { now: 1000, area, hour: 14, combat: false, media: [], logs: [], requests: [], failures: new Map() }; // Controls browser time, network failures, area, and media-event ordering.
  class Media extends EventTarget {
    constructor(url) {
      super();
      Object.assign(this, { src: url, currentTime: 0, duration: 180, paused: true, ended: false, volume: 1, muted: false, readyState: 4 });
      live.media.push(this);
    }
    load() {}
    play() { this.paused = false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); }
    pause() { this.paused = true; }
    complete(dispatch = true) {
      this.currentTime = this.duration;
      this.ended = true;
      this.paused = true;
      if (dispatch) this.dispatchEvent(new Event('ended'));
    }
  }
  const window = { addEventListener() {} }; // Browser namespace receives the production Music API.
  const statusButton = { addEventListener(_event, handler) { this.click = handler; } }; // Captures the real in-game report button handler.
  const statusOutput = { hidden: true, textContent: '' }; // Models the visible/mobile-selectable report if copying fails.
  const context = vm.createContext({
    window, Audio: Media, URL, console, location: { href: 'https://example.test/docs/' },
    document: { baseURI: 'https://example.test/docs/', addEventListener() {}, scripts: [], createElement: () => ({}), head: { appendChild() {} }, getElementById: id => id === 'debugMusicStatusBtn' ? statusButton : id === 'musicDiagnosticsStatus' ? statusOutput : null },
    navigator: { clipboard: { async writeText(text) { live.copied = text; } } },
    performance: { now: () => live.now },
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    fetch: async url => {
      const file = new URL(url, 'https://example.test/docs/').pathname.replace(/^\/docs\//, ''); // Maps actual resolved requests to shipped manifests.
      live.requests.push(file);
      if (live.failures.has(file)) return { ok: false, status: live.failures.get(file) };
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8')) };
    },
  }); // Only browser I/O is mocked; loading, selection, transport, and transitions run unchanged.
  vm.runInContext('Math.random = () => 0.999;', context); // Top roll draws the rarest (longest, 16 s) authored inter-cue gap so the clock checks are reproducible.
  for (const file of ['config/scratchbones-config.js', 'js/condition-registry.js', 'js/music-system.js']) {
    vm.runInContext(fs.readFileSync(path.join(docs, file), 'utf8'), context, { filename: file });
  }
  const config = window.SCRATCHBONES_CONFIG.game.assets.audio; // Uses actual Northern Cliffs authoring and cue timing.
  window.AudioSystem = { gameAudioConfig: () => ({ ...config, startupBgm: null }) };
  window.Music.init({
    getCurrentArea: () => live.area, getHour: () => live.hour, getPaused: () => false, getGameStarted: () => true,
    player: { x: 64, y: 64 }, TILE: 64, // Positional door-audio regression uses a listener one tile from its source.
    isPlayerInCombat: () => live.combat, _isZoneArea: () => true,
    EXTERIOR_ZONES: { map_northern_cliffs: {}, map_western_slope: {} }, getWorkspaceMaps: () => [],
    calendar: { day: 1, weather: 'clear', isRaining: false }, MORNING_HOUR: 6,
    clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    debugLog: message => live.logs.push(message),
  });
  return { live, window, statusButton, statusOutput };
}

async function run() {
  const { live, window } = await createRuntime(); // Full production module used by the original media-event regression.
  await window.Music.loadAudioCueIndexes();
  window.Music.resetAmbientCueTimer();
  window.Music.updateAmbientCues();
  const song = live.media.at(-1); // Actual media element allocated by the production transport.
  assert.match(song.src, /bgm_what_the_winds_carry\.mp3$/);
  assert.equal(song.loop, false);
  assert.equal(song.crossOrigin, 'anonymous', 'CORS is set before CDN audio can be routed into Web Audio');
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
  live.now += 15000;
  window.Music.updateAmbientCues();
  assert.equal(live.media.at(-1), cue, 'the drawn sixteen-second inter-cue gap is honored');
  live.now += 1001;
  window.Music.updateAmbientCues();
  const secondCue = live.media.at(-1); // A second motif verifies that B remains a series of cues.
  assert.match(secondCue.src, /northern_cliffs\/mas\d+\.ogg$/);
  assert.notEqual(secondCue.src, cue.src);
  live.now += 110000;
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
  assert.ok(live.logs.some(line => line.includes('schedulerRevision=cue-load-retry-2')), 'mobile diagnostics identify the updated scheduler');
  assert.ok(window.Music.getMusicDebugState().cuePlayback.started > 0, 'the report counts actual playing events');

  const recovery = await createRuntime(); // A failed initial regional manifest fetch reproduces the user's suspected skipped B stage.
  const northernPath = 'assets/audio/music/cues/northern_cliffs/index.json'; // Targets one library while the general library succeeds.
  recovery.live.failures.set(northernPath, 503);
  await recovery.window.Music.loadAudioCueIndexes();
  assert.equal(recovery.window.Music.getMusicDebugState().manifest.status, 'failed');
  assert.match(recovery.window.Music.getMusicDebugState().manifest.errors.join(), /HTTP 503/);
  await recovery.statusButton.click();
  assert.equal(recovery.statusOutput.hidden, false, 'the diagnostic report is visible without devtools');
  assert.equal(recovery.live.copied, recovery.statusOutput.textContent, 'the button copies the same report it displays');
  assert.match(recovery.live.copied, /HTTP 503/, 'the copy contains the exact manifest failure');
  assert.equal(recovery.window.Music.getMusicDebugState().manifest.loaded.join(), 'general', 'one failed library cannot discard another successful library');
  recovery.window.Music.updateAmbientCues();
  recovery.live.media.at(-1).complete();
  recovery.window.Music.updateAmbientCues();
  assert.equal(recovery.window.Music.getMusicDebugState().stage, 'cue_wait', 'a failed manifest must not immediately restart the same song');
  assert.equal(recovery.live.media.length, 1, 'there is no replacement song while waiting for a cue manifest retry');
  recovery.live.now += 15000;
  recovery.live.failures.delete(northernPath);
  await recovery.window.Music.loadAudioCueIndexes();
  recovery.window.Music.updateAmbientCues();
  assert.match(recovery.live.media.at(-1).src, /northern_cliffs\/mas\d+\.ogg$/, 'a recovered manifest starts a cue in the existing B stage');
  assert.equal(recovery.live.requests.filter(file => file.includes('/general/')).length, 1, 'successful libraries are not fetched again on retry');
  assert.equal(recovery.window.Music.getMusicDebugState().manifest.attempts, 2);

  const registryFailure = await createRuntime(); // The top-level registry can fail independently of the regional file.
  registryFailure.live.failures.set('assets/audio/music/cues/index.json', 404);
  await registryFailure.window.Music.loadAudioCueIndexes();
  assert.match(registryFailure.window.Music.getMusicDebugState().manifest.errors.join(), /registry: HTTP 404/);
  registryFailure.live.now += 15000;
  registryFailure.live.failures.clear();
  await registryFailure.window.Music.loadAudioCueIndexes();
  assert.equal(registryFailure.window.Music.getMusicDebugState().pool.total, 14, 'registry failure recovers without reloading the game');

  const slope = await createRuntime('map_western_slope'); // Unauthored daytime music must fall straight through from A to regional cues in B.
  await slope.window.Music.loadAudioCueIndexes();
  slope.window.Music.updateAmbientCues();
  assert.equal(slope.live.media.length, 0, 'stage A does not invent a daytime song for Western Slope');
  assert.equal(slope.window.Music.getMusicDebugState().stage, 'cue_wait', 'no eligible song proceeds directly to stage B');
  slope.window.Music.updateAmbientCues();
  const slopeCue = slope.live.media.at(-1); // The first audio is a regional cue without a song or song-length wait.
  assert.match(slopeCue.src, /northern_cliffs\/mas\d+\.ogg$/);
  slopeCue.error = { code: 2, message: 'transient network error' };
  slopeCue.dispatchEvent(new Event('error'));
  assert.equal(slope.window.Music.audioUrlFailed(slopeCue.src), true);
  assert.match(slope.window.Music.getMusicDebugState().cuePlayback.lastError, /media code=2.*transient network error/);
  slope.live.now += 30000;
  assert.equal(slope.window.Music.audioUrlFailed(slopeCue.src), false, 'temporary network errors do not blacklist cues for the entire session');
  slope.live.now += 120000;
  slope.window.Music.updateAmbientCues();
  slope.window.Music.updateAmbientCues();
  assert.ok(slope.live.media.every(media => /northern_cliffs\/mas\d+\.ogg$/.test(media.src)), 'later daytime cycles also skip A and play only authored regional cues');

  const slopeNight = await createRuntime('map_western_slope'); // The authored night song still plays in its existing time window.
  slopeNight.live.hour = 22;
  await slopeNight.window.Music.loadAudioCueIndexes();
  slopeNight.window.Music.updateAmbientCues();
  assert.match(slopeNight.live.media.at(-1).src, /bgm_snow_and_darkness\.m4a$/);

  const ruin = await createRuntime('map_i_dev_random_ruin'); // Exercises the real music scheduler with the Great Door's unlock signal.
  let greatDoorUnlocked = false; // Simulates the sanctum composer switching from sealed to awake; used by the scheduler bridge.
  ruin.window.DevRandomRuinSanctum = { isGreatDoorUnlocked: () => greatDoorUnlocked };
  ruin.window.Music.updateAmbientCues();
  const ruinSong = ruin.live.media.at(-1); // Current ruin BGM must relinquish ownership once the Great Door awakens.
  assert.match(ruinSong.src, /bgm_of_bygone_Kings\.ogg$/);
  const doorSource = ruin.window.Music.registerFurnitureSfxSource('map_i_dev_random_ruin', 1, 1, {
    url: 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg', rangeTiles: 16, volume: .8,
  }); // Matches the actual positional BGS registered by awakenDoor().
  greatDoorUnlocked = true;
  ruin.window.Music.updateAmbientCues();
  assert.equal(ruin.window.Music.ambientDiagnostics().bgm, null, 'unlocking retires the selected ruin BGM slot');
  assert.equal(ruinSong._musicTarget, 0, 'unlocked Great Door fades the old BGM to silence');
  assert.equal(ruin.window.Music.ambientDiagnostics().ruinVaultSilenced, true, 'ambient snapshot exposes the source of soundtrack silence');
  assert.equal(ruin.window.Music.getMusicDebugState().ruinVaultSilenced, true, 'mobile-copyable music report identifies Great Door suppression');
  ruin.window.Music.updateFurnitureSfxSources();
  assert.equal(doorSource.audio.paused, false, 'unlocked door positional audio remains able to play');
  assert.ok(doorSource.audio.volume > 0, 'nearby player hears the positional door source');
  ruin.live.now += 10000;
  ruin.window.Music.updateAmbientCues();
  assert.equal(ruin.live.media.filter(sound => /bgm_of_bygone_Kings/.test(sound.src)).length, 1, 'later scheduler ticks cannot restart the ruin score');
  ruin.live.area = 'map_northern_cliffs';
  ruin.window.Music.updateAmbientCues();
  assert.equal(ruin.window.Music.ambientDiagnostics().ruinVaultSilenced, false, 'other maps are not silenced by an unlocked Great Door');
  assert.match(ruin.window.Music.ambientDiagnostics().bgm || '', /bgm_what_the_winds_carry/, 'leaving the ruin resumes normal area music');
  ruin.live.area = 'map_i_dev_random_ruin';
  ruin.window.Music.updateAmbientCues();
  assert.equal(ruin.window.Music.ambientDiagnostics().bgm, null, 'returning to the unlocked ruin remains silent');
  greatDoorUnlocked = false;
  ruin.live.now += 10000;
  ruin.window.Music.updateAmbientCues();
  assert.match(ruin.window.Music.ambientDiagnostics().bgm || '', /bgm_of_bygone_Kings/, 'a fresh sealed ruin is allowed to play its score');

  const unsupported = await createRuntime(); // A whole library of unplayable media must leave an explicit explanation in the copied report.
  await unsupported.window.Music.loadAudioCueIndexes();
  unsupported.window.Music.updateAmbientCues();
  unsupported.live.media.at(-1).complete();
  for (let attempt = 0; attempt < 14; attempt++) { // Exercises each authored cue once before returning to song selection.
    unsupported.window.Music.updateAmbientCues();
    const failedCue = unsupported.live.media.at(-1); // Current cue owns the error callback being tested.
    assert.match(failedCue.src, /northern_cliffs\/mas\d+\.ogg$/);
    failedCue.error = { code: 4, message: 'unsupported media' };
    failedCue.dispatchEvent(new Event('error'));
    unsupported.live.now += 3000;
  }
  unsupported.window.Music.updateAmbientCues();
  assert.equal(unsupported.window.Music.getMusicDebugState().pool.failed, 14);
  assert.match(unsupported.window.Music.getMusicDebugState().cuePlayback.lastPhaseExit, /no playable cues:.*pool=14 failed=14/);
  console.log('music-cycle-runtime: event ordering, real config/manifests, HTTP recovery, playback reporting, ruin vault BGM handoff, and Western Slope day/night passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
