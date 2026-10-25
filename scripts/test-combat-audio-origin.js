// Regression: ravine height must affect combat origins, not just horizontal map range.
const fs = require('node:fs'); // Loads the shipped audio implementation rather than a copied test model.
const vm = require('node:vm'); // Executes the browser-owned audio module with an instrumented media stub.
const assert = require('node:assert/strict'); // Keeps distance and loudness comparisons explicit.

const TILE = 64; // Runtime tile-to-world scaling under test.
const area = 'map_western_slope'; // Shared test scene; a separate scene must not leak enemy cues.
const player = { x: 0, y: 0, height: 0 }; // Audio listener at the rim of the test ravine.
const played = []; // Captures actual HTMLAudioElement playback volumes, including the native fallback path.
class FakeAudio {
  constructor(src) { this.src = src; this.dataset = {}; this.paused = true; this.ended = false; this.readyState = 4; this.networkState = 1; this.volume = 1; }
  load() {}
  cloneNode() { return new FakeAudio(this.src); }
  addEventListener() {}
  pause() { this.paused = true; }
  play() { this.paused = false; played.push({ url: this.src, volume: this.volume }); return Promise.resolve(); }
}
const combatSfx = {
  enabled: true,
  weaponSwing1: { url: 'swing.mp3', volume: 1, preload: true },
  weaponHitSharpMedium: { url: 'hit.mp3', volume: 1, preload: true },
  counterShieldBlock: { url: 'block.mp3', volume: 1, preload: true },
  rangedImpact: { url: 'impact.mp3', volume: 1, preload: true },
  creatureClawHit: { url: 'claw.mp3', volume: 1, preload: true },
};
const window = { SCRATCHBONES_CONFIG: { game: { audio: { enabled: true, sfxVolume: 1, combatSfx } } } }; // Native audio settings match normal gameplay defaults.
const context = { window, Audio: FakeAudio, performance: { now: () => 10 }, setTimeout: () => 0, Math };
vm.runInNewContext(fs.readFileSync('docs/js/audio-system.js', 'utf8'), context, { filename: 'audio-system.js' });
window.AudioSystem.init({
  TILE, player, getCurrentArea: () => area, worldSurfaceY: () => 0,
  getActorWorldY: actor => actor.height ?? (actor.x >= 6 * TILE ? -8 : 0), // Point-based hits use the terrain height in the far ravine instead of the absent actor.height.
  audioUrlFailed: () => false, isRealMediaError: () => false, markAudioUrlFailed: () => {},
});
const audio = window.AudioSystem;
const rim = { id: 'rim', x: 0, y: 0, areaId: area, height: 0 }; // Local enemy baseline for unattenuated one-shots.
const bottom = { id: 'bottom', x: 0, y: 0, areaId: area, height: -8 }; // Eight vertical tiles below the listener at the same x/z.
const opposite = { id: 'far-side', x: TILE * 6, y: 0, areaId: area, height: -8 }; // Diagonal acoustic path across and down a ravine.
const elsewhere = { id: 'other-area', x: 0, y: 0, areaId: 'map_eastern_mire', height: 0 }; // Tests world-area isolation.
const near = audio.combatAudioSpatial(rim, { earshotTiles: 14 });
const deep = audio.combatAudioSpatial(bottom, { earshotTiles: 14 });
const far = audio.combatAudioSpatial(opposite, { earshotTiles: 14 });
assert.equal(near.gain, 1, 'nearby NPC sounds remain clear and locally loud');
assert.equal(deep.verticalDistancePx, 8 * TILE, 'vertical distance is measured in world height converted into map pixels');
assert(Math.abs(deep.distance - 8 * TILE) < 0.001, 'depth counts even with zero horizontal separation');
assert(Math.abs(far.distance / TILE - 10) < 0.001, 'full 3D distance uses both horizontal and vertical legs');
assert(near.gain > deep.gain && deep.gain > far.gain, 'acoustic gain falls with actual 3D separation');
assert(audio.combatAudioSpatial(elsewhere).gain === 0, 'combatants in another loaded area are inaudible');
assert(audio.creatureAudioSpatial(opposite).extraWetBoost > audio.creatureAudioSpatial(rim).extraWetBoost, 'more distant sources receive the existing far-field reverb boost');
assert.equal(audio.creatureAudioSpatial(opposite, { acousticDistancePx: 4 * TILE }).distance, 4 * TILE, 'authored elevation-aware acoustic overrides are not double-counted');

audio.playWeaponSlashSfx(1, 0);
assert.equal(played.at(-1).volume, 1, 'the player keeps the original close-range weapon-swing mix');
audio.playWeaponSlashSfx(1, 0, bottom);
assert(played.at(-1).volume < 0.1, 'the same swing eight tiles below the player must not sound like their own swing');
const beforeFarSwing = played.length; // Records that a sound outside the short-range melee earshot must not start.
audio.playWeaponSlashSfx(1, 0, opposite);
assert.equal(played.length, beforeFarSwing, 'opposite cliff melee is inaudible beyond the nine-tile earshot');
const beforeOtherArea = played.length; // Ensures area mismatch never starts another audio voice.
audio.playWeaponSlashSfx(1, 0, elsewhere);
assert.equal(played.length, beforeOtherArea, 'another area cannot trigger an enemy swing on the player');
audio.playWeaponHitSfx('sharp', 0, 0, area, 1, 'medium');
assert.equal(played.at(-1).volume, 1, 'a point-blank impact retains original gain');
audio.playWeaponHitSfx('sharp', 0, 0, area, 1, 'medium');
audio.playCounterShieldBlockSfx(opposite.x, opposite.y, area);
assert.equal(played.at(-1).url, 'hit.mp3', 'out-of-earshot shield block is suppressed');
audio.playRangedImpactSfx(TILE * 3, 0, area);
assert.equal(played.at(-1).url, 'impact.mp3', 'nearby projectile impact is still audible');
assert(played.at(-1).volume < 1, 'projectile impact has 3D distance reduction');
audio.playCreatureSfxAt(bottom, combatSfx.creatureClawHit, 1);
assert(played.at(-1).volume < 0.1, 'animal attacks from the ravine bottom are reduced too');
const snapshot = audio.combatSfxDebugSnapshot();
assert.equal(snapshot.spatial.source, 'bottom', 'mobile origin diagnostics identify the current source');
assert.equal(snapshot.spatial.verticalTiles, 8, 'mobile diagnostics expose ravine height difference');

const core = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8'); // Confirms NPC staged actions now pass their real attacker as the sound source.
assert.match(core, /playWeaponSlashSfx\?\.\(action\.data\?\.sfxPitch, action\.data\?\.comboStep, action\.data\?\.attacker \|\| deps\?\.player\)/);
const game = fs.readFileSync('docs/game.js', 'utf8'); // Ensures the audio module actually receives terrain and rendered actor heights.
assert.match(game, /AudioSystem\?\.init\(\{[\s\S]*?getActorWorldY: \(actor\) => window\.Combat\?\.deps\?\.getActorWorldY\?\.\(actor\)/);
const vocals = fs.readFileSync('docs/js/combat/combat-vocalizations.js', 'utf8'); // Checks normal, charge and native fallback voices share attenuation.
assert.match(vocals, /plan\.modulation\.gain \* Number\(audio\.sfxVolume \?\? 1\) \* spatial\.gain/);
assert.match(vocals, /mod\.gain \* Number\(audio\.sfxVolume \?\? 1\) \* spatial\.gain/);
assert.match(vocals, /lowpassHz: spatial\.lowpassHz/);
const playback = fs.readFileSync('docs/js/animal-voice-independent-playback.js', 'utf8'); // Distant dry-path treble must be filtered without removing diffuse echoes.
assert.match(playback, /if \(lowpass\) master\.connect\(lowpass\)/);
assert.match(playback, /dryOutput\.connect\(panner\)/);
console.log('combat audio origin: 3D falloff, world-area gating, player parity, mobile diagnostics and all vocal/swing pathways OK');
