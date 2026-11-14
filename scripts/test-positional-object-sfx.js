// Regression: world object sounds use combat HRTF + the existing area reverb, not a private echo engine.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const TILE = 64; // World tile-to-pixel scale shared with AudioSystem.
const AREA = 'map_i_dev_random_ruin'; // Generated ruins must resolve to the cavern acoustic profile.
const events = { panners: [], sources: [], wet: [], native: [], fetches: [] }; // Graph evidence for HRTF, reversal, wet sends and mobile fallback.
const node = () => ({ connect(other) { return other; }, disconnect() {} }); // Minimal Web Audio node contract used by all routes.

class FakeAudio {
  constructor(url) { this.src = url; this.dataset = {}; this.paused = true; this.ended = false; this.readyState = 4; this.networkState = 1; }
  load() {}
  cloneNode() { return new FakeAudio(this.src); }
  addEventListener() {}
  pause() { this.paused = true; }
  play() { events.native.push({ url: this.src, volume: this.volume }); this.paused = false; return Promise.resolve(); }
}
const decodedBuffer = () => ({ numberOfChannels: 1, length: 4, sampleRate: 44100, duration: 0.2,
  getChannelData: () => new Float32Array([1, 2, 3, 4]) }); // The reverse test can identify a real channel reversal.

class FakeContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = node(); }
  createGain() { return { ...node(), gain: { value: 1, setTargetAtTime(value) { this.value = value; },
    setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; } } }; }
  createPanner() { const result = { ...node(), positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }; events.panners.push(result); return result; }
  createStereoPanner() { return { ...node(), pan: { value: 0 } }; }
  createBiquadFilter() { return { ...node(), frequency: { value: 0 }, Q: { value: 0 } }; }
  createBufferSource() { const result = { ...node(), playbackRate: { value: 1 },
    start() { events.sources.push(result); }, stop() {} }; return result; }
  createOscillator() { return { ...node(), type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    start() {}, stop() {} }; }
  createBuffer(count, length, sampleRate) { const channels = Array.from({ length: count }, () => new Float32Array(length));
    return { numberOfChannels: count, length, sampleRate, duration: length / sampleRate, getChannelData(index) { return channels[index]; } }; }
  decodeAudioData() { return Promise.resolve(decodedBuffer()); }
  resume() { return Promise.resolve(); }
}

const objectSfx = { enabled: true,
  witchBombBlast: { url: 'witch.mp3', volume: 0.95, preload: true },
  shattercaskBlast: { url: 'shatter.mp3', volume: 0.95, preload: true },
  dig: { url: 'dig.mp3', volume: 0.8, preload: true },
  harvest: { url: 'harvest.mp3', volume: 0.9 },
  puzzleComplete: { url: 'stone.mp3', volume: 0.8, preload: true, generatedStoneKchunk: true },
};
const window = { AudioContext: FakeContext, addEventListener() {},
  SCRATCHBONES_CONFIG: { game: { input: { targeting: { orbitRadiusTiles: 0.62 } },
    audio: { enabled: true, sfxVolume: 1, objectSfx } } },
  EnvironmentalReverb: { connectWetNode(ctx, source, opts) {
    events.wet.push(opts); return { send: node(), profile: { decayS: 1.95, preDelayMs: 31 } };
  } },
  __hobunjiFurnitureDebug: { playerState: { x: 0, y: 0 }, targetAimAngleDeg: 90 },
};
const camera = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, updateMatrixWorld() {} };
const fetcher = url => { events.fetches.push(url); return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) }); };
vm.runInNewContext(fs.readFileSync('docs/js/audio-system.js', 'utf8'), {
  window, Audio: FakeAudio, fetch: fetcher, performance: { now: () => 1000 }, setTimeout() {}, Math,
}, { filename: 'audio-system.js' });
window.AudioSystem.init({
  TILE, player: { x: 0, y: 0, height: 0 }, camera, getCurrentArea: () => AREA,
  getActorWorldY: actor => actor.height ?? 0, worldSurfaceY: () => 0,
  audioUrlFailed: () => false, isRealMediaError: () => false, markAudioUrlFailed() {},
});

(async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve(); // Complete bounded two-at-a-time preloading without a clock.
  const audio = window.AudioSystem;
  audio.playObjectSfxKeyAt('witchBombBlast', 3, 0, AREA, -2, { earshotTiles: 18 });
  assert.equal(events.native.length, 0, 'decoded world explosion must not use a centered HTMLAudioElement');
  assert.equal(events.sources.length, 1, 'first preloaded Witch-bomb blast starts immediately');
  assert.equal(events.panners[0].panningModel, 'HRTF');
  assert.equal(events.panners[0].positionX.value, 3, 'blast is to the right');
  assert.equal(events.panners[0].positionY.value, -2, 'shaft platforms keep their vertical origin');
  assert.equal(events.wet.length, 1, 'exactly one wet send, not duplicate HTML media reverb');
  assert.equal(events.wet[0].area, AREA, 'echo belongs to the actual ruin acoustic space');
  const sourceSnapshot = audio.objectSfxDebugSnapshot().last; // Copyable in-game debug captures the keyed source without console access.
  assert.equal(sourceSnapshot.source.worldY, -2);

  audio.playObjectSfxKeyAt('witchBombBlast', 4, 0, AREA, 5, { earshotTiles: 18, reverse: true });
  for (let i = 0; i < 12; i++) await Promise.resolve(); // First Kanthic reverse conversion is async and cached.
  assert.equal(events.sources.length, 2, 'Kanthic blast still plays after reversing');
  assert.deepEqual(Array.from(events.sources[1].buffer.getChannelData(0)), [4, 3, 2, 1], 'audio sample is actually reversed');
  assert.equal(events.panners[1].positionY.value, 5, 'reversed blast is still positioned vertically');
  assert.equal(events.wet.length, 2, 'reverse plays into the same single environmental send');
  audio.playObjectSfxKeyAt('shattercaskBlast', 2, 2, 'map_other', 0);
  assert.equal(events.sources.length, 2, 'explosions in another map are inaudible');
  audio.playObjectSfxKeyAt('shattercaskBlast', 2, -3, AREA, 1);
  assert.equal(events.panners.at(-1).positionZ.value, -3, 'Shattercasks are directional too');

  audio.playObjectSfxKey('dig'); // Legacy tool stage sends no explicit source; the authored reticle is the real contact.
  assert(Math.abs(events.panners.at(-1).positionZ.value - 0.62) < 0.001, 'old tool cues infer the aimed tile direction');
  const nativeCount = events.native.length;
  audio.playObjectSfx(objectSfx.harvest, 1, 1, null, audio.objectSfxSourceAt(6, 0, AREA));
  assert.equal(events.native.length, nativeCount + 1, 'unloaded world cue has immediate native fallback');
  assert(events.native.at(-1).volume < 0.9, 'native fallback is still distance-attenuated');

  const wetBeforeStone = events.wet.length;
  audio.playObjectSfxKey('puzzleComplete', 1, 1, audio.objectSfxSourceAt(2, 1, AREA, 3));
  assert.equal(events.wet.length, wetBeforeStone + 2, 'recorded and procedural stone layers each join the same ruin bus');
  assert.equal(events.panners.at(-1).positionY.value, 3, 'procedural stone layer also stays directional');

  const reverbWindow = { SCRATCHBONES_CONFIG: { game: { audio: { environmentalReverb: {} } } } };
  vm.runInNewContext(fs.readFileSync('docs/js/environmental-reverb.js', 'utf8'), {
    window: reverbWindow, Math,
  }, { filename: 'environmental-reverb.js' });
  const profile = reverbWindow.EnvironmentalReverb.profileForArea(AREA);
  assert.equal(profile.preset, 'cavern', 'random ruins cannot silently fall back to ordinary interior acoustics');
  assert(profile.decayS > 1.8, 'existing cavern profile provides the long ruin echo tail');

  for (const path of ['docs/js/hronal-witch-bombs.js', 'docs/js/shattercasks.js']) {
    assert.match(fs.readFileSync(path, 'utf8'), /playObjectSfxKeyAt/, path + ' must pass its blast origin to AudioSystem');
  }
  console.log('positional object SFX, reverse Kanthic blast, ruin reverb, native fallback and tool contact: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
