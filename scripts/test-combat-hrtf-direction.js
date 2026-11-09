// Validates the actual decoded weapon HRTF graph, not just distance math.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const TILE = 64; // Shared in-game pixel-to-tile scaling.
const area = 'map_western_slope'; // Rejects cues from inactive areas.
const player = { x: 0, y: 0, height: 0 }; // Listener remains on the player.
const events = { native: [], panners: [], starts: [], fetches: [], gains: [] }; // Capture decoder starts and the live distance gain graph.
let fakeNow = 1000; // Simulated wall clock to verify bounded retry without slowing the entire regression suite.
let interruptNextStart = false; // AudioContext can interrupt between node allocation and start, especially on mobile.
const n = () => ({ connect(to) { return to; }, disconnect() {} });
class FakeContext {
  constructor() { this.state = 'running'; this.destination = n(); this.currentTime = 0; this.sampleRate = 44100; }
  createGain() {
    const item = { ...n(), gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} } };
    events.gains.push(item);
    return item;
  }
  createPanner() {
    const p = { ...n(), positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } };
    events.panners.push(p);
    return p;
  }
  createStereoPanner() { return { ...n(), pan: { value: 0 } }; }
  createBiquadFilter() { return { ...n(), frequency: { value: 0 }, Q: { value: 0 } }; }
  createBufferSource() {
    const source = { ...n(), playbackRate: { value: 1 }, start() {
      if (interruptNextStart) { interruptNextStart = false; throw new Error('AudioContext interrupted while starting'); }
      events.starts.push(source);
    }, stop() {} };
    return source;
  }
  decodeAudioData() { return Promise.resolve({ duration: 0.2 }); }
  resume() { return Promise.resolve(); }
}
class FakeAudio {
  constructor(src) { this.src = src; this.dataset = {}; this.paused = true; this.ended = false; this.readyState = 4; this.networkState = 1; }
  load() {}
  addEventListener() {}
  pause() { this.paused = true; }
  play() { events.native.push(this.src); this.paused = false; return Promise.resolve(); }
}
const cues = {
  enabled: true,
  weaponSwing1: { url: 'swing.mp3', volume: 1, preload: true },
  rangedFire: { url: 'fire.mp3', volume: 1 },
  creatureClawHit: { url: 'claw.mp3', volume: 1 },
  weaponHitSharpMedium: { url: 'hit.mp3', volume: 1, preload: true },
  counterShieldBlock: { url: 'block.mp3', volume: 1, preload: true },
};
let audioTick = null; // Captures the real shared frame-scheduler callback for moving emitters.
const window = { AudioContext: FakeContext, addEventListener() {},
  RuntimeFrameScheduler: { register(id, callback) { if (id === 'combat-spatial-listener') audioTick = callback; } },
  HobunjiDrenkirraPellet: { sfx: { spit: { url: 'spit.mp3', volume: 0.9 }, splat: { url: 'splat.mp3', volume: 0.9 } } }, // These cues do not belong to the main manifest.
  SCRATCHBONES_CONFIG: { game: { audio: { enabled: true, sfxVolume: 1, combatSfx: cues } } } }; // Browser audio configuration.
const camera = { matrixWorld: { elements: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }, updateMatrixWorld() {} }; // Identity camera faces negative Z.
const fetcher = url => {
  events.fetches.push(url);
  if (url === 'splat.mp3' && events.fetches.filter(v => v === 'splat.mp3').length === 1) return Promise.reject(new Error('offline transient'));
  return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) });
};
vm.runInNewContext(fs.readFileSync('docs/js/audio-system.js', 'utf8'), { window, Audio: FakeAudio, fetch: fetcher, performance: { now: () => fakeNow }, Date: { now: () => fakeNow }, setTimeout() {}, Math });
window.AudioSystem.init({
  TILE, player, camera, getCurrentArea: () => area, worldSurfaceY: x => x >= 5 * TILE ? -3 : 0,
  getActorWorldY: c => c.height ?? (c.x >= 5 * TILE ? -3 : 0),
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)), MAX_WATER: 3,
  audioUrlFailed: () => false, isRealMediaError: () => false, markAudioUrlFailed() {},
});
const audio = window.AudioSystem;
const right = { x: 3 * TILE, y: 0, height: -2, areaId: area }; // Attacker to the right and below.
const front = { x: 0, y: -4 * TILE, height: 0, areaId: area }; // Enemy in front.
const rear = { x: 0, y: 4 * TILE, height: 0, areaId: area }; // Enemy behind.
(async () => {
  for (let i = 0; i < 65; i++) await Promise.resolve(); // Flush the bounded preload/decode queue.
  assert(events.fetches.includes('fire.mp3'), 'non-preloaded ranged recordings warm in advance');
  assert(events.fetches.includes('claw.mp3'), 'creature attack recordings warm in advance');
  assert(audio.combatSfxDebugSnapshot().decoded >= 6, 'configured and special positional combat samples finished decoding');
  assert(events.fetches.includes('spit.mp3'), 'bespoke Drenkirra spit must be predecoded before its first combat action');
  assert.equal(audio.combatSfxDebugSnapshot().decodeFailures, 1, 'initial failed splat remains observable and retryable');

  audio.playWeaponSlashSfx(1, 0, right);
  assert.equal(events.native.length, 0, 'remote weapon does not use the centered native fallback');
  let p = events.panners.at(-1);
  assert.equal(p.panningModel, 'HRTF');
  assert.equal(p.rolloffFactor, 0, 'falloff is already handled by world distance calculation');
  assert.equal(p.positionX.value, 3, 'source on right emits from right');
  assert.equal(p.positionY.value, -2, 'ravine sound retains lower world position');
  const firstWeaponLevel = events.gains.at(-1).gain; // Last freshly allocated GainNode belongs to this decoded combat swing.
  const nearVolume = firstWeaponLevel.value;
  assert.equal(typeof audioTick, 'function', 'live positions are updated from the shared frame scheduler');
  assert.equal(audio.combatSfxDebugSnapshot().activeRoutes, 1, 'active attack owns one tracked directional route');
  right.x = 4 * TILE;
  audioTick({ timestamp: 1000 });
  assert.equal(p.positionX.value, 4, 'already-playing audio follows its emitting enemy');
  assert(firstWeaponLevel.value < nearVolume, 'moving an active sound farther away reduces its volume without restarting it');
  right.x = 3 * TILE;
  audioTick({ timestamp: 1100 });
  assert.equal(p.positionX.value, 3, 'source moves back without waiting for another sound event');
  assert(Math.abs(firstWeaponLevel.value - nearVolume) < 1e-9, 'moving the sound back restores its original distance gain');
  events.starts[0].onended();
  assert.equal(audio.combatSfxDebugSnapshot().activeRoutes, 0, 'finished sound releases its live positional route');
  audio.playWeaponSlashSfx(1, 0, front);
  assert.equal(events.panners.at(-1).positionZ.value, -4, 'front and back remain distinguishable');
  audio.playWeaponSlashSfx(1, 0, rear);
  assert.equal(events.panners.at(-1).positionZ.value, 4);
  camera.matrixWorld.elements = [0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]; // Turn the camera ninety degrees.
  audio.playWeaponSlashSfx(1, 0, right);
  p = events.panners.at(-1);
  assert.equal(p.positionX.value, 0, 'camera turn rotates the listener-relative right axis');
  assert.equal(p.positionZ.value, 3, 'right-hand source becomes a source behind');
  const beforeOther = events.starts.length; // Tracks off-area playback suppression.
  audio.playWeaponSlashSfx(1, 0, { ...right, areaId: 'map_eastern_mire' });
  assert.equal(events.starts.length, beforeOther);
  audio.playWeaponHitSfx('sharp', 6 * TILE, 0, area, 1, 'medium');
  p = events.panners.at(-1);
  assert.equal(p.positionY.value, -3, 'point-based weapon hit takes height from terrain');
  assert.equal(p.positionZ.value, 6, 'point-based hit also respects camera orientation');
  audio.playCounterShieldBlockSfx(right.x, right.y, area);
  audio.playCreatureSfxAt(right, cues.creatureClawHit, 1);
  assert.equal(audio.combatSfxDebugSnapshot().nativeFallbacks, 0, 'no weapon or claw HRTF fallbacks after preloading');
  assert.equal(audio.combatSfxDebugSnapshot().backend, 'hrtf');
  assert(events.starts.length >= 7, 'multiple categories emitted Web Audio sources');
  audio.playWeaponSlashSfx(1, 0);
  assert.equal(events.native.length, 1, 'player local swing remains immediate');
  const pelletSpatial = audio.combatAudioSpatial(right, { earshotTiles: 9 });
  audio.playOneShotSfx(window.HobunjiDrenkirraPellet.sfx.splat, pelletSpatial.gain, 1, pelletSpatial);
  assert.equal(events.fetches.filter(v => v === 'splat.mp3').length, 1, 'failed asset respects retry cooldown, no fetch storm');
  assert.equal(events.native.length, 2, 'a transient decoding failure falls back to immediate native sound');
  fakeNow += 4500; // Exceed initial four-second retry backoff.
  audio.playOneShotSfx(window.HobunjiDrenkirraPellet.sfx.splat, pelletSpatial.gain, 1, pelletSpatial);
  assert.equal(events.native.length, 3, 'retrying decode does not block this combat sound');
  for (let i = 0; i < 32; i++) await Promise.resolve();
  assert.equal(events.fetches.filter(v => v === 'splat.mp3').length, 2, 'the next attack retries transiently failed decoding');
  audio.playOneShotSfx(window.HobunjiDrenkirraPellet.sfx.splat, pelletSpatial.gain, 1, pelletSpatial);
  assert.equal(audio.combatSfxDebugSnapshot().specialCombatDecoded, 2, 'Drenkirra splat switches to real HRTF after retry');
  assert.equal(events.native.length, 3, 'recovered positional sound avoids the centered native transport');
  const routesBeforeInterruption = audio.combatSfxDebugSnapshot().activeRoutes;
  interruptNextStart = true;
  audio.playWeaponSlashSfx(1, 0, right);
  assert.equal(events.native.length, 4, 'interrupted Web Audio falls back to immediate native combat playback');
  assert.equal(audio.combatSfxDebugSnapshot().activeRoutes, routesBeforeInterruption, 'failed Web Audio start disposes its HRTF route');
  assert.match(audio.combatSfxDebugSnapshot().spatialError, /interrupted while starting/, 'diagnostics disclose failed 3D start');

  const human = fs.readFileSync('docs/js/combat/combat-vocalizations.js', 'utf8'); // Shared HRTF path is used by charge grunts too.
  assert.match(human, /connectCombatSpatialDry\?\.\(ctx, dryOutput, \{/); // Timed charges now pass live-distance gain metadata into their HRTF route.
  assert.match(human, /position3d: spatial\.position3d/);
  assert.match(human, /__combatVocalDistanceGain = distanceGain/, 'long grunts have a dedicated distance gain independent from charge fade');
  assert.match(human, /connectWetNode\?\.\(ctx, distanceGain/, 'wet charge reflections also attenuate with source distance');
  const wildlife = fs.readFileSync('docs/js/animal-voice-independent-playback.js', 'utf8'); // Animal voices share front/back and height.
  assert.match(wildlife, /if \(opts\.position3d\) spatialRoute/);
  const pellet = fs.readFileSync('docs/js/combat/combat-drenkirra-pellet.js', 'utf8'); // Bespoke Drenkirra attacks cannot bypass HRTF.
  assert.match(pellet, /playOneShotSfx\(cfg, spatial\.gain, 1, spatial\)/);
  const game = fs.readFileSync('docs/game.js', 'utf8'); // Wild creatures and humanoid walkers pass world-space footstep positions.
  assert.match(game, /playFootstepSfx\(c\.areaId, tile, spatial\.gain, spatial\.panX, \{ source: c \}\)/);
  assert.match(game, /playFootstepSfx\(this\.area, tile, spatial\.gain, spatial\.panX, \{ source \}\)/);
  console.log('combat 3D HRTF source direction, elevation, camera rotation and shared cue routing: OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
