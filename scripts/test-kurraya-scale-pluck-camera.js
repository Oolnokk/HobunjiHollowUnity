'use strict';

const assert = require('node:assert/strict'); // Assertions for the shipped Kurraya scale, pluck-pattern, and camera integration.
const fs = require('node:fs'); // Reads the production owners instead of duplicating their implementation.
const vm = require('node:vm'); // Executes the small camera bridge against injected gameplay seams.

const lyre = fs.readFileSync('docs/assets/minigames/lyre-performance.html', 'utf8'); // Real hosted Kurraya engine.
const music = fs.readFileSync('docs/js/music-minigame.js', 'utf8'); // Real host controls and controller ownership.
const cameraSource = fs.readFileSync('docs/js/camera-look-clamp.js', 'utf8'); // Shared camera clamp + Kurraya gameplay-camera bridge.

for (const patternId of ['strum-down-4', 'strum-alternating-8', 'strum-pop-8']) {
  assert.match(lyre, new RegExp(`['"]${patternId}['"]`), `${patternId} remains authored in the hosted pattern library`);
  assert.match(music, new RegExp(`['"]${patternId}['"]`), `${patternId} remains selectable from the host pattern loadout`);
}
assert.match(lyre, /const PAD_ROOT_REGISTER_OFFSET = -24\b/, 'the accompaniment stays two octaves below the melody tonic');
assert.match(lyre, /function scaleSafeMidi\(midi\)/, 'accompaniment pitches are fitted to the active scale');
assert.match(lyre, /function lowKurrayaChordMidis\(midi = rootPadTargetMidi\(\)\)/, 'the low accompaniment is still authored as sampled Kurraya notes');
assert.match(lyre, /return \[root, scaleSafeMidi\(root \+ 7\)\]/, 'the sampled low chord prefers a scale-safe fifth');
assert.match(lyre, /createVoiceNodes\(pitch, 0\.72 \/ Math\.sqrt\(chordMidis\.length\), now, 1\)/, 'the low chord goes through the ordinary pitch-shifted Kurraya sampler');
assert.match(lyre, /async useGameplayFootstepMetronome\(urls\)/, 'the hosted bridge can still accept gameplay footstep samples when a host provides them');
assert.match(music, /setAutoPickSlot\?\.\(sector, (?:event\.target\.)?value\)/, 'the visible plucking-pattern selector edits the selected left-stick sector');
assert.match(music, /gameplay camera owner reads RS/, 'music keeps right stick reserved for camera look instead of manual strumming');
assert.doesNotMatch(music, /bridge\.rightStick\(rx, ry, 'host-gamepad-right-stick'\)/, 'controller right stick is not routed back into Kurraya strumming');

let fishingDeps = null; // Captures the camera dependency bag after the bridge wraps Fishing.init.
let actionArcDeps = null; // Captures Character View dependencies after the bridge wraps ActionArcUI.init.
let musicDeps = null; // Captures the MusicMinigame dependency bag after the bridge replaces staged camera callbacks.
let controllerSubscriber = null; // Captures the shared ControllerInput callback so the test can drive one right-stick frame.
let pointerLockRequests = 0; // Verifies Character View asks the existing pointer-lock owner to resume desktop mouse look.
const storage = new Map([
  ['scratchbones.controllerLookSensitivity.v1', '1.25'],
  ['scratchbones.controllerInvertY.v1', '0'],
]);
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
};
const window = {
  SCRATCHBONES_CONFIG: {
    game: {
      input: { deadzone: 0.24, controllerLookResponse: 1.45, controllerLookDegPerSec: 190, controllerLookVerticalScale: 0.8 },
      desktopControls: { cameraRotateClampDeg: 45, cameraRotateUpClampDeg: 45 },
    },
  },
  Fishing: { init(deps) { fishingDeps = deps; } },
  ActionArcUI: { init(deps) { actionArcDeps = deps; } },
  MusicMinigame: {
    state: { active: true },
    init(deps) { musicDeps = deps; },
  },
  ControllerInput: {
    PRIORITY: { music: 40 },
    normalizeStick(x, y) { return { x: Number(x) || 0, y: Number(y) || 0, magnitude: Math.hypot(Number(x) || 0, Number(y) || 0) }; },
    subscribe(name, fn, priority) {
      assert.equal(name, 'kurraya-camera-look');
      assert.equal(priority, 41);
      controllerSubscriber = fn;
      return () => {};
    },
  },
  ShoulderCamPointerLock: { request() { pointerLockRequests++; } },
  __farmLog() {},
};
const context = vm.createContext({ window, localStorage, Object, Number, Math });
vm.runInContext(cameraSource, context, { filename: 'camera-look-clamp.js' });

let mode = 'shoulderSurf'; // Existing gameplay camera mode must survive the performance unchanged.
let target = { id: 'pre-performance-target' }; // Existing target is restored after the performance closes.
let offsets = { azimuthDeg: 12, angleDeg: -5 }; // Right-stick look mutates these authoritative gameplay offsets.
const cameraDeps = {
  getCameraMode: () => mode,
  setCameraMode: value => { mode = value; },
  getCameraTarget: () => target,
  setCameraTarget: value => { target = value; },
  getCameraOrientationOffsets: () => ({ ...offsets }),
  setCameraOrientationOffsets: value => { offsets = { ...value }; },
};
const characterViewMode = { enabled: false }; // Mirrors the mutable object injected into ActionArcUI by game.js.
const characterDeps = {
  characterViewMode,
  setCharacterViewMode(enabled) { characterViewMode.enabled = !!enabled; },
};
window.Fishing.init(cameraDeps);
window.ActionArcUI.init(characterDeps);
window.MusicMinigame.init({ beginMusicCamera() { throw new Error('staged camera should be replaced'); }, endMusicCamera() { throw new Error('staged camera should be replaced'); } });
assert.equal(fishingDeps, cameraDeps);
assert.equal(actionArcDeps, characterDeps);
assert.ok(musicDeps?.beginMusicCamera && musicDeps?.endMusicCamera, 'MusicMinigame receives gameplay-camera callbacks');
assert.ok(controllerSubscriber, 'Kurraya camera subscribes to the shared controller frame');

musicDeps.beginMusicCamera('foroji');
assert.equal(mode, 'shoulderSurf', 'Kurraya does not switch into the old staged music camera');
assert.equal(target, null, 'Character View follows the player rather than an NPC midpoint target');
assert.equal(characterViewMode.enabled, true, 'Kurraya locks into Character View while playing');
assert.equal(pointerLockRequests, 1, 'desktop mouse look is re-requested through the existing pointer-lock owner');

controllerSubscriber({ pad: { axes: [0, 0, 0.6, -0.4] }, dt: 1 / 60 });
assert.ok(offsets.azimuthDeg < 12, 'right stick yaw turns the live gameplay camera');
assert.ok(offsets.angleDeg < -5, 'right stick pitch turns the live gameplay camera with the normal sign convention');
const debug = window.KurrayaCameraRuntime.getDebug();
assert.equal(debug.active, true);
assert.equal(debug.characterView, true);
assert.equal(debug.controllerLook.active, true);

musicDeps.endMusicCamera();
assert.equal(mode, 'shoulderSurf', 'pre-performance camera mode is restored');
assert.deepEqual(target, { id: 'pre-performance-target' }, 'pre-performance camera target is restored');
assert.equal(characterViewMode.enabled, false, 'pre-performance Character View state is restored');
console.log('Kurraya patterns, sampled low chord, and Character View camera bridge passed.');
