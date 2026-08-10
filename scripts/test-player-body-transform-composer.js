#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const loader = read('docs/js/combat/combat-config-loader.js');
const composer = read('docs/js/player-body-transform-composer.js');
const impact = read('docs/js/combat/impact-ragdoll-playback.js');
const drunk = read('docs/js/drunk-locomotion.js');
const alcohol = read('docs/js/alcohol-gameplay-bridge.js');

for (const modulePath of [
  'js/player-body-transform-composer.js',
  'js/drunk-locomotion.js',
  'js/alcohol-gameplay-bridge.js',
]) {
  assert.ok(loader.includes(modulePath), `${modulePath} is bootstrapped before game.js`);
}

assert.ok(composer.includes("setChannel"), 'composer exposes named transform channels');
assert.ok(composer.includes("registerExternalRootProvider"), 'composer owns body-bound attachment providers');
assert.ok(composer.includes("currentOwnedRoots"), 'composer rediscovers current visual roots instead of pinning stale avatar objects');
assert.ok(composer.includes("mode === 'override'"), 'composer supports physical-state override channels');

assert.ok(impact.includes("BODY_CHANNEL = 'ragdoll'"), 'impact publishes a ragdoll body channel');
assert.ok(impact.includes('PlayerBodyTransformComposer?.setChannel'), 'impact uses the composer');
assert.ok(impact.includes('PlayerBodyTransformComposer?.clearChannel'), 'impact clears ownership instead of zeroing shared rotation');
assert.doesNotMatch(impact, /playerMeshRef\s*\.\s*rotation/, 'impact never writes playerMesh rotation');
assert.doesNotMatch(impact, /playerMeshRef\s*\.\s*position/, 'impact never writes playerMesh position');

assert.ok(drunk.includes("BODY_CHANNEL = 'drunk'"), 'drunk gait publishes a drunk body channel');
assert.ok(drunk.includes("DRUNK_FOOTING_ID = 'drunkenFooting'"), 'drunk gait keys off the alcohol affliction, not generic Footing loss');
assert.ok(drunk.includes('foot.rotation.y += yaw'), 'drunk foot yaw is additive to the current frame pose');
assert.ok(drunk.includes('foot.rotation.z += roll'), 'drunk foot roll is additive to the current frame pose');
assert.doesNotMatch(drunk, /__drunkBaseRotation/, 'drunk feet no longer cache and restore stale base rotations');

assert.ok(alcohol.includes("registerExternalRootProvider('equippedTool'"), 'tool visuals register through the composer');
assert.ok(alcohol.includes("registerExternalRootProvider('shoulderPets'"), 'shoulder pets register through the composer');
assert.doesNotMatch(alcohol, /WebGLRenderer\.prototype/, 'alcohol integration no longer owns renderer transforms');
assert.doesNotMatch(alcohol, /__hobunjiDrunkBridgeDevDeps/, 'alcohol integration keeps its dependency adapter private');

console.log('Player body transform composer ownership checks passed.');
